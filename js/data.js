// ── Data fetching and caching ──
// All Census queries split by FIPS.STL_CITY and FIPS.STL_COUNTY explicitly.

const DataCache = {};

function cacheKey(...parts) { return parts.join('|'); }

async function fetchJSON(url) {
  const cached = DataCache[url];
  if (cached) return cached;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Fetch failed: ${res.status} ${url}`);
  const data = await res.json();
  DataCache[url] = data;
  return data;
}

// ── Census ACS helpers ──

/**
 * Fetch ACS variables for all tracts in a given county (or independent city).
 * @param {string} county  FIPS county code — use FIPS.STL_CITY or FIPS.STL_COUNTY
 * @param {string[]} vars  ACS variable names, e.g. ['B02001_001E', 'B19013_001E']
 * @returns {Object[]} Array of row objects keyed by variable name
 */
async function fetchACSTracts(county, vars) {
  const varList = ['NAME', ...vars].join(',');
  const url = `${ACS_BASE}?get=${varList}&for=tract:*&in=state:${FIPS.STATE}%20county:${county}&key=${CENSUS_API_KEY}`;
  const raw = await fetchJSON(url);
  const [header, ...rows] = raw;
  return rows.map(row => {
    const obj = {};
    header.forEach((col, i) => { obj[col] = row[i]; });
    // Attach a stable tract GEOID: state + county + tract
    obj.GEOID = `${FIPS.STATE}${obj.county}${obj.tract}`;
    obj._isCity   = obj.county === FIPS.STL_CITY;
    obj._isCounty = obj.county === FIPS.STL_COUNTY;
    return obj;
  });
}

/**
 * Fetch ACS data for both St. Louis city and county, returning a combined array.
 * Each row carries _isCity / _isCounty flags for downstream filtering.
 */
async function fetchACSBoth(vars) {
  const [cityRows, countyRows] = await Promise.all([
    fetchACSTracts(FIPS.STL_CITY,   vars),
    fetchACSTracts(FIPS.STL_COUNTY, vars),
  ]);
  return [...cityRows, ...countyRows];
}

// ── Derived demographic variables ──

/**
 * Fetch racial composition + income + gini + vacancy for all tracts.
 * Returns rows with computed fields attached.
 */
async function fetchDemographics() {
  const key = cacheKey('demographics');
  if (DataCache[key]) return DataCache[key];

  const vars = [
    'B02001_001E',  // Total population
    'B02001_002E',  // White alone
    'B02001_003E',  // Black or African American alone
    'B19013_001E',  // Median household income
    'B19083_001E',  // Gini index
    'B25002_001E',  // Total housing units
    'B25002_003E',  // Vacant housing units
  ];

  const rows = await fetchACSBoth(vars);

  const processed = rows.map(r => {
    const total     = +r['B02001_001E'] || 0;
    const white     = +r['B02001_002E'] || 0;
    const black     = +r['B02001_003E'] || 0;
    const income    = +r['B19013_001E'];      // -666666666 if suppressed
    const gini      = +r['B19083_001E'];
    const units     = +r['B25002_001E'] || 0;
    const vacant    = +r['B25002_003E'] || 0;

    return {
      ...r,
      total_pop:      total,
      pct_white:      total > 0 ? (white / total) * 100 : null,
      pct_black:      total > 0 ? (black / total) * 100 : null,
      median_income:  income < 0 ? null : income,   // null = suppressed
      gini:           gini <= 0  ? null : gini,
      vacancy_rate:   units > 0  ? (vacant / units) * 100 : null,
    };
  });

  DataCache[key] = processed;
  return processed;
}

// ── GeoJSON tract boundaries ──
// Served from /data/ — downloaded from TIGERweb and committed to the repo.
// City (510) and county (189) are separate files; never merged into one.

const GEOJSON_FILES = {
  [FIPS.STL_CITY]:   'data/stl-city-tracts.geojson',
  [FIPS.STL_COUNTY]: 'data/stl-county-tracts.geojson',
};

async function fetchTractGeoJSON(county) {
  const key = cacheKey('geojson', county);
  if (DataCache[key]) return DataCache[key];

  const path = GEOJSON_FILES[county];
  if (!path) throw new Error(`No GeoJSON file configured for county FIPS: ${county}`);

  const geojson = await fetchJSON(path);
  DataCache[key] = geojson;
  return geojson;
}

/**
 * Fetch and merge tract GeoJSON for both city and county.
 * Features carry a 'geography' property: 'city' or 'county'.
 */
async function fetchBothGeoJSON() {
  const [cityGJ, countyGJ] = await Promise.all([
    fetchTractGeoJSON(FIPS.STL_CITY),
    fetchTractGeoJSON(FIPS.STL_COUNTY),
  ]);

  const cityFeatures   = (cityGJ.features   || []).map(f => ({ ...f, properties: { ...f.properties, geography: 'city'   } }));
  const countyFeatures = (countyGJ.features || []).map(f => ({ ...f, properties: { ...f.properties, geography: 'county' } }));

  return {
    type: 'FeatureCollection',
    features: [...cityFeatures, ...countyFeatures],
  };
}

// ── Join Census data onto GeoJSON features ──

/**
 * Attach Census row data to GeoJSON features by GEOID.
 * Features that don't match get null data fields.
 */
function joinDataToGeoJSON(geojson, dataRows) {
  const byGEOID = {};
  dataRows.forEach(r => { byGEOID[r.GEOID] = r; });

  return {
    ...geojson,
    features: geojson.features.map(f => {
      const geoid = f.properties.GEOID || f.properties.geoid || f.properties.GEO_ID;
      const row   = byGEOID[geoid] || null;
      return {
        ...f,
        properties: { ...f.properties, ...(row || {}), _hasData: !!row },
      };
    }),
  };
}

// ── OpenStreetMap POI density ──

/**
 * Query the Overpass API for amenity/shop/tourism POIs within a bounding box.
 * Returns a GeoJSON FeatureCollection of points.
 * bbox: [south, west, north, east]
 */
async function fetchOSMPOIs(bbox) {
  const [s, w, n, e] = bbox;
  // Query for amenity, shop, and office nodes — proxies for mixed-use activity
  const query = `
    [out:json][timeout:30];
    (
      node["amenity"](${s},${w},${n},${e});
      node["shop"](${s},${w},${n},${e});
      node["office"](${s},${w},${n},${e});
    );
    out body;
  `;
  const key = cacheKey('osm', bbox.join(','));
  if (DataCache[key]) return DataCache[key];

  const res = await fetch(OVERPASS_API, {
    method: 'POST',
    body: `data=${encodeURIComponent(query)}`,
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  });
  if (!res.ok) throw new Error(`Overpass API error: ${res.status}`);
  const json = await res.json();

  const features = (json.elements || []).map(el => ({
    type: 'Feature',
    geometry: { type: 'Point', coordinates: [el.lon, el.lat] },
    properties: { id: el.id, type: el.tags?.amenity || el.tags?.shop || el.tags?.office || 'unknown', tags: el.tags },
  }));

  const result = { type: 'FeatureCollection', features };
  DataCache[key] = result;
  return result;
}

// ── St. Louis bounding boxes ──
// Used for Overpass queries — deliberately separate for city vs. county
const BBOX_STL_CITY   = [38.532, -90.320, 38.770, -90.183];  // [S, W, N, E]
const BBOX_STL_COUNTY = [38.393, -90.739, 38.893, -90.117];
const BBOX_STL_BOTH   = [38.393, -90.739, 38.893, -90.117];  // union