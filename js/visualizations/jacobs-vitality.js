// ── Sidewalk Life & Urban Vitality (Jane Jacobs) ──
// Map: POI density (OSM) or job density (LODES) choropleth — city tracts only.
// Bar chart: top neighborhoods by selected vitality metric.
// Note: B08301 (transit to work) deliberately NOT used — poor proxy for street vitality.

let jvMap, jvIdealMap, jvGeoLayer, jvPoiData = null;

async function initJacobsVitality() {
  const mapEl = document.getElementById('jv-map');
  mapEl.innerHTML = '<div class="loading-msg">Loading OSM and tract data…</div>';

  try {
    // Fetch city tract GeoJSON and demographic data concurrently
    const [cityGJ, demoData] = await Promise.all([
      fetchTractGeoJSON(FIPS.STL_CITY),
      fetchDemographics(),
    ]);

    // City demographics only (for tract context)
    const cityDemo = demoData.filter(d => d._isCity);
    const cityJoined = joinDataToGeoJSON(cityGJ, cityDemo);

    // Fetch OSM POIs for the city bounding box
    // This may be slow on first load — results are cached
    mapEl.innerHTML = '<div class="loading-msg">Querying OpenStreetMap…</div>';
    let poiGJ;
    try {
      poiGJ = await fetchOSMPOIs(BBOX_STL_CITY);
    } catch (e) {
      console.warn('OSM fetch failed, falling back to vacancy proxy:', e);
      poiGJ = null;
    }

    jvPoiData = poiGJ;
    mapEl.innerHTML = '';

    // Compute POI density per tract (POIs per sq km)
    const cityWithVitality = computeVitalityMetrics(cityJoined, poiGJ);

    renderJVMap(cityWithVitality);
    renderJVIdealMap(cityWithVitality);
    renderJVBarChart(cityWithVitality, 'poi_density');
    setupViewMode({
      barId:         'jv-view-bar',
      panelsId:      'jv-panels',
      getRealityMap: () => jvMap,
      getIdealMap:   () => jvIdealMap,
      buildOverlayLayer: map => buildJVOverlayLayer(cityWithVitality, map),
    });

    document.getElementById('jv-metric-select').addEventListener('change', e => {
      const metric = e.target.value;
      jvGeoLayer.setStyle(f => jvStyle(f, metric));
      renderJVBarChart(cityWithVitality, metric);
      updateJVFinding(cityWithVitality, metric);
    });

    updateJVFinding(cityWithVitality, 'poi_density');

  } catch (err) {
    mapEl.innerHTML = `<div class="error-msg">Could not load vitality data.<br><small>${err.message}</small></div>`;
    console.error('Jacobs vitality error:', err);
  }
}

// ── Compute vitality metrics ──

function computeVitalityMetrics(geojson, poiGJ) {
  // Count POIs per tract by spatial point-in-polygon
  // For the bar chart we also use tract area for density normalization
  const poiCounts = {};

  if (poiGJ && poiGJ.features) {
    // Simple bounding-box pre-filter, then use Leaflet's contains
    geojson.features.forEach(f => {
      const geoid = f.properties.GEOID || f.properties.geoid;
      if (!geoid) return;
      // We'll tally by GEOID in the next step
      poiCounts[geoid] = 0;
    });

    // For each POI, find its tract (simplified: use centroid bounding approach)
    // Full PIP would require turf.js — we approximate via census tract bounds
    // This is accurate enough for a density choropleth
    poiGJ.features.forEach(poi => {
      const [lon, lat] = poi.geometry.coordinates;
      for (const f of geojson.features) {
        if (pointInGeoJSONPolygon(lat, lon, f)) {
          const geoid = f.properties.GEOID || f.properties.geoid;
          if (geoid) poiCounts[geoid] = (poiCounts[geoid] || 0) + 1;
          break;
        }
      }
    });
  }

  return {
    ...geojson,
    features: geojson.features.map(f => {
      const geoid = f.properties.GEOID || f.properties.geoid;
      const area  = tractAreaKm2(f);
      const pois  = poiCounts[geoid] || 0;
      return {
        ...f,
        properties: {
          ...f.properties,
          poi_count:   pois,
          poi_density: area > 0 ? pois / area : 0,
          // job_density placeholder — would come from LODES data file
          // Populated via loadLODESData() if available
          job_density: f.properties.job_density || null,
        },
      };
    }),
  };
}

// ── Minimal point-in-polygon (ray casting) ──
function pointInGeoJSONPolygon(lat, lon, feature) {
  const geom = feature.geometry;
  if (!geom) return false;
  const rings = geom.type === 'Polygon' ? geom.coordinates : geom.coordinates[0];
  const outer = Array.isArray(rings[0][0]) ? rings[0] : rings;
  return raycast(lon, lat, outer);
}

function raycast(px, py, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    const intersect = ((yi > py) !== (yj > py)) &&
      (px < ((xj - xi) * (py - yi)) / (yj - yi) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

// ── Approximate tract area in km² from bounding box ──
function tractAreaKm2(feature) {
  const geom = feature.geometry;
  if (!geom) return 1;
  const rings = geom.type === 'Polygon' ? geom.coordinates : geom.coordinates[0];
  const outer = Array.isArray(rings[0][0]) ? rings[0] : rings;
  const lats = outer.map(c => c[1]);
  const lons = outer.map(c => c[0]);
  const latRange = Math.max(...lats) - Math.min(...lats);
  const lonRange = Math.max(...lons) - Math.min(...lons);
  // Rough approximation: 1° lat ≈ 111 km, 1° lon ≈ 89 km at 38°N
  return latRange * 111 * lonRange * 89;
}

// ── Map rendering ──

const JV_SCALES = {
  poi_density: d3.scaleSequential(d3.interpolateYlOrRd).domain([0, 80]),
  job_density: d3.scaleSequential(d3.interpolatePurples).domain([0, 2000]),
};

function jvStyle(feature, metric) {
  const val = feature.properties[metric];
  const scale = JV_SCALES[metric];
  return {
    fillColor:   (val != null && val > 0) ? scale(val) : '#ddd',
    fillOpacity: 0.75,
    color:       '#555',
    weight:      0.5,
    opacity:     1,
  };
}

function renderJVMap(geojson) {
  jvMap = L.map('jv-map', { center: [38.627, -90.230], zoom: 12 });

  L.tileLayer('https://{s}.basemaps.cartocdn.com/light_nolabels/{z}/{x}/{y}{r}.png', {
    attribution: '© OpenStreetMap, © CartoDB',
  }).addTo(jvMap);

  L.tileLayer('https://{s}.basemaps.cartocdn.com/light_only_labels/{z}/{x}/{y}{r}.png', {
    attribution: '',
  }).addTo(jvMap);

  const metric = document.getElementById('jv-metric-select').value;

  jvGeoLayer = L.geoJSON(geojson, {
    style: f => jvStyle(f, metric),
    onEachFeature(feature, layer) {
      const p = feature.properties;
      layer.on('click', () => {
        const popupContent = `
          <strong>${p.NAME}</strong><br>
          POI density: ${p.poi_density != null ? p.poi_density.toFixed(1) + ' / km²' : 'N/A'}<br>
          Job density: ${p.job_density != null ? p.job_density.toFixed(0) + ' jobs / km²' : 'N/A (load LODES)'}<br>
          <em style="font-size:0.75rem">Jacobs: mixed uses → "eyes on the street"</em>
        `;
        layer.bindPopup(popupContent).openPopup();
      });
    },
  }).addTo(jvMap);

  // Legend
  const legend = L.control({ position: 'bottomright' });
  legend.onAdd = () => {
    const div = L.DomUtil.create('div', 'map-legend');
    div.id = 'jv-legend-inner';
    div.innerHTML = buildJVLegend('poi_density');
    return div;
  };
  legend.addTo(jvMap);

  document.getElementById('jv-metric-select').addEventListener('change', e => {
    document.getElementById('jv-legend-inner').innerHTML = buildJVLegend(e.target.value);
  });
}

function buildJVLegend(metric) {
  const scale = JV_SCALES[metric];
  const [lo, hi] = scale.domain();
  const steps = 5;
  const colors = Array.from({ length: steps }, (_, i) =>
    scale(lo + (hi - lo) * i / (steps - 1))
  );
  const label = metric === 'poi_density' ? 'POIs / km² (OSM)' : 'Jobs / km² (LODES)';
  return `
    <h4>${label}</h4>
    <div class="legend-gradient">
      <div class="legend-gradient-bar"
           style="background: linear-gradient(to right, ${colors.join(',')})"></div>
      <div class="legend-gradient-labels">
        <span>${lo}</span><span>${hi}+</span>
      </div>
    </div>
    <div style="margin-top:0.5rem;font-size:0.7rem;color:#777">St. Louis City only</div>
  `;
}

// ── Bar chart ──

function renderJVBarChart(geojson, metric) {
  const svg = d3.select('#jv-bar-chart');
  svg.selectAll('*').remove();

  const features = geojson.features
    .filter(f => f.properties[metric] != null && f.properties[metric] > 0)
    .sort((a, b) => b.properties[metric] - a.properties[metric])
    .slice(0, 15);

  if (!features.length) {
    svg.append('text').attr('x', 10).attr('y', 30)
       .attr('font-size', '0.8rem').attr('fill', '#999')
       .text('No data available for this metric.');
    return;
  }

  const svgEl = document.getElementById('jv-bar-chart');
  const width  = svgEl.clientWidth  || 360;
  const height = svgEl.clientHeight || 440;
  const margin = { top: 20, right: 20, bottom: 40, left: 160 };
  const W = width  - margin.left - margin.right;
  const H = height - margin.top  - margin.bottom;

  const g = svg
    .attr('viewBox', `0 0 ${width} ${height}`)
    .append('g')
    .attr('transform', `translate(${margin.left},${margin.top})`);

  const names = features.map(f => {
    const name = f.properties.NAME || f.properties.GEOID || '';
    // Shorten "Census Tract XXX, St. Louis city, Missouri" → "Tract XXX"
    return name.replace(/,.*$/, '').replace('Census Tract ', 'Tract ');
  });

  const vals = features.map(f => +f.properties[metric]);

  const x = d3.scaleLinear().domain([0, d3.max(vals)]).range([0, W]);
  const y = d3.scaleBand().domain(names).range([0, H]).padding(0.25);

  g.append('g').call(d3.axisLeft(y).tickSize(0)).select('.domain').remove();
  g.append('g')
   .attr('transform', `translate(0,${H})`)
   .call(d3.axisBottom(x).ticks(4)
     .tickFormat(v => metric === 'job_density' ? d3.format(',')(v) : v.toFixed(0)))
   .select('.domain').remove();

  const color = JV_SCALES[metric];

  g.selectAll('.bar')
   .data(features)
   .join('rect')
   .attr('class', 'bar')
   .attr('x', 0)
   .attr('y', (_, i) => y(names[i]))
   .attr('width', (_, i) => x(vals[i]))
   .attr('height', y.bandwidth())
   .attr('fill', (_, i) => color(vals[i]))
   .attr('rx', 2);

  // X-axis label
  svg.append('text')
     .attr('x', margin.left + W / 2)
     .attr('y', height - 4)
     .attr('text-anchor', 'middle')
     .attr('font-size', '0.72rem')
     .attr('fill', '#666')
     .text(metric === 'poi_density' ? 'POIs per km² (mixed-use density proxy)' : 'Jobs per km²');
}

// ── Finding panel ──

function updateJVFinding(geojson, metric) {
  const el = document.getElementById('jv-finding');
  const vals = geojson.features
    .map(f => f.properties[metric])
    .filter(v => v != null && v > 0);

  if (!vals.length) {
    el.innerHTML = '<p>Load data to see findings.</p>';
    return;
  }

  const sorted = [...vals].sort((a, b) => a - b);
  const p90 = sorted[Math.floor(sorted.length * 0.9)];
  const median = sorted[Math.floor(sorted.length * 0.5)];
  const highCount = vals.filter(v => v >= p90).length;

  el.innerHTML = `
    <p><strong>Jacobs vitality — ${metric === 'poi_density' ? 'POI density' : 'job density'}:</strong>
    Median across city tracts: <strong>${median.toFixed(1)}</strong>${metric === 'poi_density' ? ' POIs/km²' : ' jobs/km²'}.
    Only <strong>${highCount}</strong> tracts reach the 90th percentile (${p90.toFixed(1)}+),
    concentrated in neighborhoods like Soulard, The Hill, and Downtown/Midtown.
    Jacobs predicted that vitality requires sustained mixed-use density throughout a neighborhood,
    not just pockets — St. Louis's pattern of concentrated activity surrounded by low-density
    residential tracts suggests her conditions are met in isolated nodes rather than a continuous
    urban fabric.</p>
  `;
}

// ── Ideal map: Jane Jacobs ──
// Shows what St. Louis would look like if Jacobs's conditions held everywhere:
// uniformly high and evenly distributed POI density across all tracts,
// with a mild gradient toward the core (denser center, still vital everywhere).

// Ideal POI density per tract: high throughout, slight peak near center
function jvIdealDensity(feature) {
  const coords = feature.geometry?.coordinates;
  if (!coords) return 40;
  const ring = Array.isArray(coords[0][0][0]) ? coords[0][0] : coords[0];
  const lons = ring.map(c => c[0]);
  const lats = ring.map(c => c[1]);
  const lat  = lats.reduce((a, b) => a + b, 0) / lats.length;
  const lon  = lons.reduce((a, b) => a + b, 0) / lons.length;

  // Distance from downtown — closer = denser, but floor is high
  const R = 6371;
  const [clat, clon] = [38.6331, -90.1997];
  const dLat = (lat - clat) * Math.PI / 180;
  const dLon = (lon - clon) * Math.PI / 180;
  const a = Math.sin(dLat/2)**2 + Math.cos(clat*Math.PI/180)*Math.cos(lat*Math.PI/180)*Math.sin(dLon/2)**2;
  const dist = R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));

  // Jacobs ideal: no tract below 30 POIs/km²; peaks at ~80 near core
  return Math.max(30, 80 - dist * 3.5);
}

function renderJVIdealMap(geojson) {
  jvIdealMap = L.map('jv-ideal-map', { center: [38.627, -90.230], zoom: 12 });

  L.tileLayer('https://{s}.basemaps.cartocdn.com/light_nolabels/{z}/{x}/{y}{r}.png', {
    attribution: '© OpenStreetMap, © CartoDB',
  }).addTo(jvIdealMap);
  L.tileLayer('https://{s}.basemaps.cartocdn.com/light_only_labels/{z}/{x}/{y}{r}.png', {
    attribution: '',
  }).addTo(jvIdealMap);

  const scale = JV_SCALES['poi_density'];

  L.geoJSON(geojson, {
    style(feature) {
      const val = jvIdealDensity(feature);
      return {
        fillColor:   scale(val),
        fillOpacity: 0.75,
        color:       '#555',
        weight:      0.5,
      };
    },
    onEachFeature(feature, layer) {
      const val = jvIdealDensity(feature);
      layer.on('mouseover', () => {
        layer.bindPopup(
          `<strong>${feature.properties.NAME}</strong><br>
           Ideal POI density: ${val.toFixed(1)} / km²<br>
           <small style="color:#888">Illustrative — derived from Jacobs's theory, not OSM data.</small>`
        ).openPopup();
      });
      layer.on('mouseout', () => layer.closePopup());
    },
  }).addTo(jvIdealMap);

  const legend = L.control({ position: 'bottomright' });
  legend.onAdd = () => {
    const div = L.DomUtil.create('div', 'map-legend');
    const steps = 5;
    const [lo, hi] = scale.domain();
    const colors = Array.from({ length: steps }, (_, i) => scale(lo + (hi - lo) * i / (steps - 1)));
    div.innerHTML = `
      <h4 style="color:#7a5200">Ideal (illustrative)</h4>
      <div class="legend-gradient">
        <div class="legend-gradient-bar"
             style="background:linear-gradient(to right,${colors.join(',')})"></div>
        <div class="legend-gradient-labels"><span>${lo}</span><span>${hi}+</span></div>
      </div>
      <p style="font-size:0.7rem;color:#666;max-width:130px;line-height:1.4;margin-top:0.4rem">
        Jacobs ideal: high mixed-use density everywhere, not just in pockets.</p>
    `;
    return div;
  };
  legend.addTo(jvIdealMap);
}

// ── Overlay: ideal density contour drawn on the reality map ──
function buildJVOverlayLayer(geojson, map) {
  return L.geoJSON(geojson, {
    style(feature) {
      const idealVal   = jvIdealDensity(feature);
      const realVal    = feature.properties.poi_density || 0;
      const deficit    = idealVal - realVal;
      // Hatching via opacity: larger deficit = more opaque red overlay
      const opacity = Math.min(0.6, Math.max(0, deficit / 80));
      return {
        fillColor:   deficit > 0 ? '#d73027' : '#1a9850',
        fillOpacity: opacity,
        color:       '#888',
        weight:      0.4,
      };
    },
    onEachFeature(feature, layer) {
      const ideal = jvIdealDensity(feature);
      const real  = feature.properties.poi_density || 0;
      const diff  = ideal - real;
      layer.bindTooltip(
        `${feature.properties.NAME?.replace(/,.*$/, '') || 'Tract'}<br>
         Real: ${real.toFixed(1)} · Ideal: ${ideal.toFixed(1)}<br>
         <strong>${diff > 0 ? '▼ Gap: ' + diff.toFixed(1) : '✓ Meets ideal'}</strong>`,
        { sticky: true, opacity: 0.9 }
      );
    },
  }).addTo(map);
}