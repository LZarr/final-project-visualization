// ── Integrated Theory Comparison ──
// Single map with toggleable layers from all three theories.
// Includes a "convergence" layer that scores each tract by how many
// theoretical patterns it simultaneously exhibits.
// City and county always labeled and treated as distinct.

let tcMap, tcLayers = {}, tcGeojson = null;

async function initTheoryComparison() {
  const mapEl = document.getElementById('tc-map');
  mapEl.innerHTML = '<div class="loading-msg">Loading comparison data…</div>';

  try {
    const [geojson, demoData] = await Promise.all([
      fetchBothGeoJSON(),
      fetchDemographics(),
    ]);

    const joined = joinDataToGeoJSON(geojson, demoData);
    tcGeojson = joined;
    mapEl.innerHTML = '';
    renderTCMap(joined);

  } catch (err) {
    mapEl.innerHTML = `<div class="error-msg">Could not load comparison data.<br><small>${err.message}</small></div>`;
    console.error('Theory comparison error:', err);
  }
}

// ── Convergence scoring ──
// Each tract gets a score 0–3 based on how many theory-predicted patterns it shows:
//   +1 (Park & Burgess): high vacancy AND near the Zone of Transition (2–4 km from downtown)
//   +1 (Jacobs): low vacancy (proxy for mixed-use vitality) in city tracts
//   +1 (Lacy): high %Black + high income in county tracts

function computeConvergenceScores(geojson) {
  // Pre-compute county income/Black thresholds for Lacy criterion
  const countyFeatures = geojson.features.filter(
    f => f.properties.geography === 'county' && f.properties._hasData
  );
  const incomes   = countyFeatures.map(f => f.properties.median_income).filter(v => v != null).sort((a,b)=>a-b);
  const pctBlacks = countyFeatures.map(f => f.properties.pct_black).filter(v => v != null).sort((a,b)=>a-b);
  const incomeCutHi   = incomes[Math.floor(incomes.length * 2/3)]   ?? Infinity;
  const pctBlackCutHi = pctBlacks[Math.floor(pctBlacks.length * 2/3)] ?? Infinity;

  return geojson.features.map(f => {
    const p    = f.properties;
    const geom = f.geometry;
    if (!p._hasData || !geom) return { ...f, properties: { ...p, convergence: 0, convergence_reasons: [] } };

    // Centroid
    const ring = geom.type === 'Polygon'
      ? geom.coordinates[0]
      : geom.coordinates[0][0];
    const lats = ring.map(c => c[1]);
    const lons = ring.map(c => c[0]);
    const lat  = lats.reduce((a,b)=>a+b,0)/lats.length;
    const lon  = lons.reduce((a,b)=>a+b,0)/lons.length;

    // Distance to downtown (km)
    const R = 6371;
    const [clat, clon] = CONCENTRIC_ZONE_CENTER;
    const dLat = (lat - clat) * Math.PI/180;
    const dLon = (lon - clon) * Math.PI/180;
    const a = Math.sin(dLat/2)**2 + Math.cos(clat*Math.PI/180)*Math.cos(lat*Math.PI/180)*Math.sin(dLon/2)**2;
    const dist = R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));

    let score = 0;
    const reasons = [];

    // Park & Burgess criterion: tract in Zone of Transition (2–7 km) with high vacancy
    if (p.geography === 'city' && dist >= 2 && dist <= 7 && p.vacancy_rate != null && p.vacancy_rate > 20) {
      score++;
      reasons.push('Transition zone distress (Park & Burgess)');
    }

    // Jacobs criterion: city tract with low vacancy (active streetscape proxy)
    if (p.geography === 'city' && p.vacancy_rate != null && p.vacancy_rate < 8) {
      score++;
      reasons.push('Low vacancy — street activity (Jacobs)');
    }

    // Lacy criterion: county tract with high %Black and high income (middle-class sorting)
    if (p.geography === 'county' && p.median_income != null && p.pct_black != null
        && p.median_income >= incomeCutHi && p.pct_black >= pctBlackCutHi) {
      score++;
      reasons.push('Black middle-class suburban tract (Lacy)');
    }

    return { ...f, properties: { ...p, convergence: score, convergence_reasons: reasons } };
  });
}

function renderTCMap(geojson) {
  tcMap = L.map('tc-map', { center: MAP_CENTER, zoom: 11 });

  L.tileLayer('https://{s}.basemaps.cartocdn.com/light_nolabels/{z}/{x}/{y}{r}.png', {
    attribution: '© OpenStreetMap, © CartoDB',
  }).addTo(tcMap);
  L.tileLayer('https://{s}.basemaps.cartocdn.com/light_only_labels/{z}/{x}/{y}{r}.png', {
    attribution: '',
  }).addTo(tcMap);

  // ── Convergence layer (default ON) ──
  const scoredFeatures = computeConvergenceScores(geojson);
  const convergenceGJ  = { type: 'FeatureCollection', features: scoredFeatures };

  const convergenceColors = ['#f7f7f7', '#fc8d59', '#d73027', '#7f0000'];
  const convergenceLabels = [
    'No theory pattern',
    'One theory pattern',
    'Two theory patterns',
    'All three patterns',
  ];

  tcLayers.convergence = L.geoJSON(convergenceGJ, {
    style(f) {
      const score = f.properties.convergence || 0;
      const isCity = f.properties.geography === 'city';
      return {
        fillColor:   convergenceColors[score],
        fillOpacity: score === 0 ? 0.15 : 0.7,
        color:       isCity ? '#2b4d8c' : '#aaa',
        weight:      isCity ? 1.5 : 0.5,
      };
    },
    onEachFeature(feature, layer) {
      const p = feature.properties;
      const geo = p.geography === 'city' ? 'STL City' : 'STL County';
      const income = p.median_income != null ? `$${p.median_income.toLocaleString()}` : 'N/A';
      const reasons = p.convergence_reasons?.length
        ? '<br><em>' + p.convergence_reasons.join('<br>') + '</em>'
        : '';
      layer.on('click', () => {
        layer.bindPopup(`
          <strong>${p.NAME || 'Tract'}</strong> <em>(${geo})</em><br>
          Convergence score: <strong>${p.convergence}/3</strong>${reasons}<br>
          % Black: ${p.pct_black != null ? p.pct_black.toFixed(1) + '%' : 'N/A'}<br>
          Median income: ${income}<br>
          Vacancy: ${p.vacancy_rate != null ? p.vacancy_rate.toFixed(1) + '%' : 'N/A'}
        `).openPopup();
      });
    },
  }).addTo(tcMap);

  // ── Layer: Concentric rings ──
  const ringGroup = L.layerGroup();
  const center = L.latLng(CONCENTRIC_ZONE_CENTER[0], CONCENTRIC_ZONE_CENTER[1]);
  CONCENTRIC_ZONE_RADII.forEach((r, i) => {
    L.circle(center, {
      radius: r * 1000, color: '#444', weight: 1.5,
      opacity: 0.7, fill: false, dashArray: '6 4',
    })
    .bindTooltip(CONCENTRIC_ZONE_LABELS[i], { direction: 'right', opacity: 0.9 })
    .addTo(ringGroup);
  });
  tcLayers.rings = ringGroup;
  ringGroup.addTo(tcMap);

  // ── Additional individual layers (toggleable) ──

  // % Black choropleth
  tcLayers.zones = L.geoJSON(geojson, {
    style(f) {
      const val = f.properties.pct_black;
      const color = d3.scaleSequential(d3.interpolateOranges).domain([0, 100]);
      return {
        fillColor:   val != null ? color(val) : '#ccc',
        fillOpacity: 0.55,
        color:       f.properties.geography === 'city' ? '#2b4d8c' : '#aaa',
        weight:      f.properties.geography === 'city' ? 1.5 : 0.5,
      };
    },
    onEachFeature: tcPopup,
  });

  // Vacancy rate
  tcLayers.vacancy = L.geoJSON(geojson, {
    style(f) {
      const val = f.properties.vacancy_rate;
      const color = d3.scaleSequential(d3.interpolateReds).domain([0, 40]);
      return {
        fillColor:   val != null ? color(val) : '#ccc',
        fillOpacity: 0.55,
        color:       '#666',
        weight:      0.5,
      };
    },
    onEachFeature: tcPopup,
  });

  // Lacy: high %Black + high income county tracts
  const countyFeatures = geojson.features.filter(
    f => f.properties.geography === 'county' && f.properties._hasData
  );
  if (countyFeatures.length) {
    const incomes   = countyFeatures.map(f => f.properties.median_income).filter(v => v != null).sort((a,b)=>a-b);
    const pctBlacks = countyFeatures.map(f => f.properties.pct_black).filter(v => v != null).sort((a,b)=>a-b);
    const incomeCutHi   = incomes[Math.floor(incomes.length * 2/3)];
    const pctBlackCutHi = pctBlacks[Math.floor(pctBlacks.length * 2/3)];
    tcLayers.lacy = L.geoJSON({
      type: 'FeatureCollection',
      features: countyFeatures.filter(f =>
        f.properties.median_income >= incomeCutHi &&
        f.properties.pct_black     >= pctBlackCutHi
      ),
    }, {
      style: { fillColor: '#3b4994', fillOpacity: 0.7, color: '#1a2050', weight: 1.5 },
      onEachFeature: tcPopup,
    });
  } else {
    tcLayers.lacy = L.layerGroup();
  }

  // ── Checkbox wiring ──
  document.getElementById('tc-convergence').addEventListener('change', e => {
    toggleLayer('convergence', e.target.checked);
    updateTCFinding(scoredFeatures);
  });
  document.getElementById('tc-zones').addEventListener('change', e => {
    toggleLayer('zones', e.target.checked);
    updateTCFinding(scoredFeatures);
  });
  document.getElementById('tc-lacy').addEventListener('change', e => {
    toggleLayer('lacy', e.target.checked);
    updateTCFinding(scoredFeatures);
  });
  document.getElementById('tc-vacancy').addEventListener('change', e => {
    toggleLayer('vacancy', e.target.checked);
    updateTCFinding(scoredFeatures);
  });

  addTCLegend(convergenceColors, convergenceLabels);
  updateTCFinding(scoredFeatures);
}

function toggleLayer(name, on) {
  const layer = tcLayers[name];
  if (!layer) return;
  if (on) layer.addTo(tcMap);
  else tcMap.removeLayer(layer);
}

function tcPopup(feature, layer) {
  const p   = feature.properties;
  const geo = p.geography === 'city' ? 'STL City' : 'STL County';
  layer.on('click', () => {
    const income = p.median_income != null ? `$${p.median_income.toLocaleString()}` : 'N/A';
    layer.bindPopup(`
      <strong>${p.NAME || 'Tract'}</strong> <em>(${geo})</em><br>
      % Black: ${p.pct_black != null ? p.pct_black.toFixed(1) + '%' : 'N/A'}<br>
      Median income: ${income}<br>
      Vacancy: ${p.vacancy_rate != null ? p.vacancy_rate.toFixed(1) + '%' : 'N/A'}<br>
      Gini: ${p.gini != null ? p.gini.toFixed(3) : 'N/A'}
    `).openPopup();
  });
}

// ── Legend ──

function addTCLegend(convergenceColors, convergenceLabels) {
  const legend = L.control({ position: 'bottomright' });
  legend.onAdd = () => {
    const div = L.DomUtil.create('div', 'map-legend');
    div.innerHTML = `
      <h4>Convergence score</h4>
      ${convergenceColors.map((c, i) => `
        <div class="legend-item">
          <span class="legend-swatch" style="background:${c};opacity:${i===0?0.4:1}"></span>
          ${convergenceLabels[i]}
        </div>`).join('')}
      <div style="margin-top:0.6rem;border-top:1px solid #ddd;padding-top:0.4rem">
        <h4>Other layers</h4>
        <div class="legend-item"><span class="legend-swatch" style="background:${d3.interpolateOranges(0.6)}"></span> % Black</div>
        <div class="legend-item"><span class="legend-swatch" style="background:#3b4994"></span> Black middle-class (Lacy)</div>
        <div class="legend-item"><span class="legend-swatch" style="background:${d3.interpolateReds(0.6)}"></span> Vacancy rate</div>
      </div>
      <div style="margin-top:0.5rem;font-size:0.7rem;color:#555">
        <span style="border-bottom:2px solid #2b4d8c">——</span> City boundary &nbsp;
        <span>- - -</span> Concentric rings
      </div>
    `;
    return div;
  };
  legend.addTo(tcMap);
}

// ── Finding panel ──

function updateTCFinding(scoredFeatures) {
  const el = document.getElementById('tc-finding');

  const score2 = scoredFeatures.filter(f => f.properties.convergence === 2).length;
  const score3 = scoredFeatures.filter(f => f.properties.convergence === 3).length;
  const total  = scoredFeatures.filter(f => f.properties._hasData).length;

  el.innerHTML = `
    <p><strong>Where do the theories converge?</strong>
    Of ${total} tracts with data, <strong>${score2}</strong> match two theory patterns simultaneously
    and <strong>${score3}</strong> match all three — shown in dark red on the map.
    Click any tract to see which patterns it satisfies.</p>

    <p><strong>How the score works:</strong> Each tract earns one point per theory whose
    predicted pattern it exhibits —
    (1) <em>Park &amp; Burgess</em>: high vacancy in the Zone of Transition (2–7 km from downtown);
    (2) <em>Jacobs</em>: low vacancy in city tracts, signaling active street life;
    (3) <em>Lacy</em>: high-income, majority-Black tract in St. Louis County.
    Note that criteria (1) and (2) are mutually exclusive within the city,
    so a score of 3 requires a county tract satisfying both a Burgess pattern and Lacy's criterion.</p>

    <p><strong>Key finding:</strong> The most theoretically dense zones — where multiple frameworks
    point to the same geography — cluster along the inner city&ndash;county boundary.
    The near-north side of St. Louis city satisfies the Park &amp; Burgess transition zone
    prediction but defies Jacobs (high vacancy, not vitality).
    The suburban corridor running through Ferguson and University City satisfies Lacy&rsquo;s
    sorting pattern. The city&ndash;county boundary itself, an administrative artifact
    unique to St. Louis, creates a discontinuity none of the three theories anticipate.</p>
  `;
}