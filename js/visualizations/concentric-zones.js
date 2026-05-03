// ── Concentric Zone Model (Park & Burgess) ──
// Choropleth of St. Louis (city + county) with theoretical concentric rings overlay.

let czMap, czIdealMap, czGeoLayer, czIdealGeoLayer, czLegend, czCircles = [];

// ── Module-level geo helpers (also used by ideal map builder) ──

function czDistKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat/2)**2 + Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.sin(dLon/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

function czCentroid(feature) {
  const coords = feature.geometry?.coordinates;
  if (!coords) return null;
  const ring = Array.isArray(coords[0][0][0]) ? coords[0][0] : coords[0];
  const lons = ring.map(c => c[0]);
  const lats = ring.map(c => c[1]);
  return [lats.reduce((a,b)=>a+b,0)/lats.length, lons.reduce((a,b)=>a+b,0)/lons.length];
}

async function initConcentricZones() {
  const container = document.getElementById('cz-map');
  container.innerHTML = '<div class="loading-msg">Loading Census data…</div>';

  try {
    const [geojson, data] = await Promise.all([
      fetchBothGeoJSON(),
      fetchDemographics(),
    ]);
    const joined = joinDataToGeoJSON(geojson, data);
    container.innerHTML = '';
    renderCZMap(joined);
    renderCZIdealMap(joined);
    setupViewMode({
      barId:          'cz-view-bar',
      panelsId:       'cz-panels',
      getRealityMap:  () => czMap,
      getIdealMap:    () => czIdealMap,
      buildOverlayLayer: map => buildCZOverlayLayer(joined, map),
    });
  } catch (err) {
    container.innerHTML = `<div class="error-msg">Could not load data.<br><small>${err.message}</small></div>`;
    console.error('Concentric Zones error:', err);
  }
}

function renderCZMap(geojson) {
  czMap = L.map('cz-map', { center: MAP_CENTER, zoom: MAP_ZOOM });

  L.tileLayer('https://{s}.basemaps.cartocdn.com/light_nolabels/{z}/{x}/{y}{r}.png', {
    attribution: '© OpenStreetMap, © CartoDB',
    maxZoom: 18,
  }).addTo(czMap);

  // City/county boundary labels tile layer (labels only, on top)
  L.tileLayer('https://{s}.basemaps.cartocdn.com/light_only_labels/{z}/{x}/{y}{r}.png', {
    attribution: '',
    maxZoom: 18,
    pane: 'overlayPane',
  }).addTo(czMap);

  czGeoLayer = L.geoJSON(geojson, {
    style: f => czStyle(f, getCurrentCZLayer()),
    onEachFeature: czOnEachFeature,
  }).addTo(czMap);

  addCZRings();
  addCZLegend();
  updateCZFinding(geojson);

  document.getElementById('cz-layer-select').addEventListener('change', () => {
    const layer = getCurrentCZLayer();
    czGeoLayer.setStyle(f => czStyle(f, layer));
    if (czIdealGeoLayer) czIdealGeoLayer.setStyle(f => czIdealStyle(f, layer));
    updateCZLegend(layer);
    updateCZFinding(geojson);
  });

  document.getElementById('cz-show-rings').addEventListener('change', e => {
    czCircles.forEach(c => e.target.checked ? c.addTo(czMap) : czMap.removeLayer(c));
  });
}

function getCurrentCZLayer() {
  return document.getElementById('cz-layer-select').value;
}

// ── Color scales ──

const CZ_SCALES = {
  pct_white:      d3.scaleSequential(d3.interpolateBlues).domain([0, 100]),
  pct_black:      d3.scaleSequential(d3.interpolateOranges).domain([0, 100]),
  median_income:  d3.scaleSequential(d3.interpolateGreens).domain([0, 120000]),
  gini:           d3.scaleSequential(d3.interpolateReds).domain([0.25, 0.65]),
};

const CZ_LABELS = {
  pct_white:      '% White',
  pct_black:      '% Black or African American',
  median_income:  'Median Household Income',
  gini:           'Gini Index (income inequality)',
};

function czStyle(feature, layerKey) {
  const val = feature.properties[layerKey];
  const scale = CZ_SCALES[layerKey];
  const isCity = feature.properties.geography === 'city';

  return {
    fillColor:   (val != null && !isNaN(val)) ? scale(val) : '#ccc',
    fillOpacity: 0.72,
    color:       isCity ? '#2b4d8c' : '#888',
    weight:      isCity ? 1.5 : 0.6,
    opacity:     1,
  };
}

function czOnEachFeature(feature, layer) {
  const p = feature.properties;
  layer.on({
    mouseover(e) {
      e.target.setStyle({ fillOpacity: 0.9, weight: 2 });
      const geo = p.geography === 'city' ? 'St. Louis City' : 'St. Louis County';
      const income = p.median_income != null
        ? `$${p.median_income.toLocaleString()}`
        : 'N/A (suppressed)';
      layer.bindPopup(`
        <strong>${p.NAME}</strong>
        <br><em>${geo}</em>
        <br>% Black: ${p.pct_black != null ? p.pct_black.toFixed(1) + '%' : 'N/A'}
        <br>% White: ${p.pct_white != null ? p.pct_white.toFixed(1) + '%' : 'N/A'}
        <br>Median income: ${income}
        <br>Gini: ${p.gini != null ? p.gini.toFixed(3) : 'N/A'}
        <br>Vacancy: ${p.vacancy_rate != null ? p.vacancy_rate.toFixed(1) + '%' : 'N/A'}
      `).openPopup();
    },
    mouseout(e) {
      czGeoLayer.resetStyle(e.target);
      layer.closePopup();
    },
  });
}

// ── Concentric rings ──

function addCZRings() {
  const center = L.latLng(CONCENTRIC_ZONE_CENTER[0], CONCENTRIC_ZONE_CENTER[1]);
  czCircles = CONCENTRIC_ZONE_RADII.map((r, i) => {
    const circle = L.circle(center, {
      radius:      r * 1000,
      color:       '#555',
      weight:      1.5,
      opacity:     0.6,
      fill:        false,
      dashArray:   '6 4',
      className:   'cz-ring',
    });
    circle.bindTooltip(CONCENTRIC_ZONE_LABELS[i], {
      permanent:  false,
      direction:  'right',
      className:  'leaflet-tooltip',
      opacity:    0.9,
    });
    return circle.addTo(czMap);
  });
}

// ── Legend ──

function addCZLegend() {
  czLegend = L.control({ position: 'bottomright' });
  czLegend.onAdd = () => {
    const div = L.DomUtil.create('div', 'map-legend');
    div.id = 'cz-legend-inner';
    updateCZLegend(getCurrentCZLayer(), div);
    return div;
  };
  czLegend.addTo(czMap);
}

function updateCZLegend(layerKey, div) {
  div = div || document.getElementById('cz-legend-inner');
  if (!div) return;
  const scale = CZ_SCALES[layerKey];
  const [lo, hi] = scale.domain();
  const label = CZ_LABELS[layerKey];
  const fmt = layerKey === 'median_income'
    ? v => `$${Math.round(v / 1000)}k`
    : v => layerKey === 'gini' ? v.toFixed(2) : Math.round(v) + '%';

  // Build a small gradient bar
  const steps = 6;
  const colors = Array.from({ length: steps }, (_, i) =>
    scale(lo + (hi - lo) * i / (steps - 1))
  );

  div.innerHTML = `
    <h4>${label}</h4>
    <div class="legend-gradient">
      <div class="legend-gradient-bar"
           style="background: linear-gradient(to right, ${colors.join(',')})"></div>
      <div class="legend-gradient-labels">
        <span>${fmt(lo)}</span><span>${fmt(hi)}</span>
      </div>
    </div>
    <div style="margin-top:0.6rem; font-size:0.7rem; color:#555">
      <span style="border-bottom:2px solid #2b4d8c">—</span> City boundary &nbsp;
      <span style="border-bottom:1px dashed #888">- -</span> County tracts
    </div>
  `;
}

// ── Finding panel ──

function updateCZFinding(geojson) {
  const layer = getCurrentCZLayer();
  const el = document.getElementById('cz-finding');

  // Compute mean value for inner vs outer tracts using ring radii as a rough split
  // "Inner" = within 4km of city center; "Outer" = beyond 7km
  const center = CONCENTRIC_ZONE_CENTER;
  const features = geojson.features.filter(f => f.properties._hasData);

  const inner = [], outer = [];
  features.forEach(f => {
    const c = czCentroid(f);
    if (!c) return;
    const d = czDistKm(center[0], center[1], c[0], c[1]);
    const val = f.properties[layer];
    if (val == null) return;
    if (d < 4) inner.push(val);
    if (d > 7) outer.push(val);
  });

  const mean = arr => arr.length ? arr.reduce((a,b)=>a+b,0)/arr.length : null;
  const innerMean = mean(inner);
  const outerMean = mean(outer);

  if (!innerMean || !outerMean) {
    el.innerHTML = '<p>Load data to see findings.</p>';
    return;
  }

  const fmt = layer === 'median_income'
    ? v => `$${Math.round(v).toLocaleString()}`
    : v => v.toFixed(1) + (layer === 'gini' ? '' : '%');

  const diff = ((outerMean - innerMean) / innerMean * 100).toFixed(0);
  const direction = outerMean > innerMean ? 'higher' : 'lower';
  const label = CZ_LABELS[layer];

  el.innerHTML = `
    <p><strong>Pattern check — ${label}:</strong>
    Inner zones (within 4km of downtown) average <strong>${fmt(innerMean)}</strong>;
    outer zones (beyond 7km) average <strong>${fmt(outerMean)}</strong>
    — ${Math.abs(+diff)}% ${direction} toward the periphery.
    ${layer === 'pct_black' && outerMean < innerMean
      ? ' This inverts the Park & Burgess expectation of outward racial succession — St. Louis shows concentrated Black population near the core, a pattern shaped by decades of redlining and urban renewal displacement.'
      : layer === 'median_income' && outerMean > innerMean
      ? ' The income gradient broadly follows the concentric model, though the separation of the independent city from the county creates a discontinuity not present in the original Chicago framework.'
      : ''}
    </p>
  `;
}

// ── Ideal map: Park & Burgess ──
// Each tract is colored purely by its distance from downtown, producing the
// smooth concentric gradient the theory predicts. No real Census data — illustrative only.

// Zone index by distance from center (mirrors CONCENTRIC_ZONE_RADII)
function czZoneIndex(distKm) {
  for (let i = 0; i < CONCENTRIC_ZONE_RADII.length; i++) {
    if (distKm < CONCENTRIC_ZONE_RADII[i]) return i;
  }
  return CONCENTRIC_ZONE_RADII.length; // beyond outer ring
}

// Ideal color: maps zone to the same scale as the reality map so comparison is direct.
// For income: inner = low, outer = high (as theory predicts).
// For %Black: theory implies decreasing toward periphery (zone of transition nearest core).
function czIdealValue(distKm, layerKey) {
  const zoneCount = CONCENTRIC_ZONE_RADII.length + 1;
  const zi = czZoneIndex(distKm);
  const t = zi / (zoneCount - 1); // 0 = innermost, 1 = outermost
  const scales = {
    pct_white:     t * 100,             // increases outward
    pct_black:     (1 - t) * 80,        // decreases outward
    median_income: t * 120000,          // increases outward
    gini:          0.55 - t * 0.2,      // higher inequality near core
  };
  return scales[layerKey] ?? 0;
}

function czIdealStyle(feature, layerKey) {
  const c = czCentroid(feature);
  if (!c) return { fillColor: '#ddd', fillOpacity: 0.7, color: '#aaa', weight: 0.5 };
  const dist  = czDistKm(CONCENTRIC_ZONE_CENTER[0], CONCENTRIC_ZONE_CENTER[1], c[0], c[1]);
  const val   = czIdealValue(dist, layerKey);
  const scale = CZ_SCALES[layerKey];
  return {
    fillColor:   scale(val),
    fillOpacity: 0.72,
    color:       '#aaa',
    weight:      0.5,
    opacity:     1,
  };
}

function renderCZIdealMap(geojson) {
  czIdealMap = L.map('cz-ideal-map', { center: MAP_CENTER, zoom: MAP_ZOOM });

  L.tileLayer('https://{s}.basemaps.cartocdn.com/light_nolabels/{z}/{x}/{y}{r}.png', {
    attribution: '© OpenStreetMap, © CartoDB',
    maxZoom: 18,
  }).addTo(czIdealMap);

  L.tileLayer('https://{s}.basemaps.cartocdn.com/light_only_labels/{z}/{x}/{y}{r}.png', {
    attribution: '', maxZoom: 18,
  }).addTo(czIdealMap);

  const layerKey = getCurrentCZLayer();
  czIdealGeoLayer = L.geoJSON(geojson, {
    style: f => czIdealStyle(f, layerKey),
    onEachFeature(feature, layer) {
      const c = czCentroid(feature);
      if (!c) return;
      const dist = czDistKm(CONCENTRIC_ZONE_CENTER[0], CONCENTRIC_ZONE_CENTER[1], c[0], c[1]);
      const zi   = czZoneIndex(dist);
      const zoneName = CONCENTRIC_ZONE_LABELS[zi] || 'Beyond commuter zone';
      layer.on('mouseover', () => {
        layer.bindPopup(
          `<strong>${feature.properties.NAME}</strong><br>
           <em>Theoretical zone: ${zoneName}</em><br>
           Distance from downtown: ${dist.toFixed(1)} km<br>
           <small style="color:#888">Values are illustrative — derived from distance, not Census data.</small>`
        ).openPopup();
      });
      layer.on('mouseout', () => layer.closePopup());
    },
  }).addTo(czIdealMap);

  // Add rings to ideal map too — they define the zones
  const center = L.latLng(CONCENTRIC_ZONE_CENTER[0], CONCENTRIC_ZONE_CENTER[1]);
  CONCENTRIC_ZONE_RADII.forEach((r, i) => {
    L.circle(center, {
      radius: r * 1000, color: '#444', weight: 1.5,
      opacity: 0.7, fill: false, dashArray: '6 4',
    })
    .bindTooltip(CONCENTRIC_ZONE_LABELS[i], { direction: 'right', opacity: 0.9 })
    .addTo(czIdealMap);
  });

  // Ideal-map legend note
  const legend = L.control({ position: 'bottomright' });
  legend.onAdd = () => {
    const div = L.DomUtil.create('div', 'map-legend');
    div.innerHTML = `
      <h4 style="color:#7a5200">Ideal (illustrative)</h4>
      <p style="font-size:0.7rem;color:#666;max-width:130px;line-height:1.4">
        Colors derived from distance to downtown only — what the theory predicts, not what exists.</p>
    `;
    return div;
  };
  legend.addTo(czIdealMap);
}

// ── Overlay layer: ideal zones drawn on top of the reality map ──
function buildCZOverlayLayer(geojson, map) {
  return L.geoJSON(geojson, {
    style(feature) {
      const c = czCentroid(feature);
      if (!c) return { fill: false, stroke: false };
      const dist  = czDistKm(CONCENTRIC_ZONE_CENTER[0], CONCENTRIC_ZONE_CENTER[1], c[0], c[1]);
      const zi    = czZoneIndex(dist);
      // Draw zone boundary lines only — no fill, so reality choropleth shows through
      const zoneColors = ['#e41a1c','#ff7f00','#4daf4a','#377eb8','#984ea3','#555'];
      return {
        fill:    false,
        color:   zoneColors[zi] ?? '#555',
        weight:  2,
        opacity: 0.7,
      };
    },
    onEachFeature(feature, layer) {
      const c = czCentroid(feature);
      if (!c) return;
      const dist = czDistKm(CONCENTRIC_ZONE_CENTER[0], CONCENTRIC_ZONE_CENTER[1], c[0], c[1]);
      const zi   = czZoneIndex(dist);
      layer.bindTooltip(`Theoretical zone: ${CONCENTRIC_ZONE_LABELS[zi] || 'Beyond commuter zone'}`,
        { sticky: true, opacity: 0.85 });
    },
  }).addTo(map);
}