// ── Integrated Theory Comparison ──
// Single map with toggleable layers from all three theories.
// City and county always labeled and treated as distinct.

let tcMap, tcLayers = {};

async function initTheoryComparison() {
  const mapEl = document.getElementById('tc-map');
  mapEl.innerHTML = '<div class="loading-msg">Loading comparison data…</div>';

  try {
    const [geojson, demoData] = await Promise.all([
      fetchBothGeoJSON(),
      fetchDemographics(),
    ]);

    const joined = joinDataToGeoJSON(geojson, demoData);
    mapEl.innerHTML = '';
    renderTCMap(joined);

  } catch (err) {
    mapEl.innerHTML = `<div class="error-msg">Could not load comparison data.<br><small>${err.message}</small></div>`;
    console.error('Theory comparison error:', err);
  }
}

function renderTCMap(geojson) {
  tcMap = L.map('tc-map', { center: MAP_CENTER, zoom: 11 });

  L.tileLayer('https://{s}.basemaps.cartocdn.com/light_nolabels/{z}/{x}/{y}{r}.png', {
    attribution: '© OpenStreetMap, © CartoDB',
  }).addTo(tcMap);

  L.tileLayer('https://{s}.basemaps.cartocdn.com/light_only_labels/{z}/{x}/{y}{r}.png', {
    attribution: '',
  }).addTo(tcMap);

  // ── Layer: Concentric zones (% Black choropleth) ──
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
  }).addTo(tcMap);

  // ── Layer: Vacancy rate ──
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

  // ── Layer: High % Black + high income tracts (Lacy) ──
  // Show only St. Louis County tracts in the top income + high Black bivariate cell
  const countyFeatures = geojson.features.filter(f =>
    f.properties.geography === 'county' &&
    f.properties._hasData
  );

  if (countyFeatures.length) {
    const incomes = countyFeatures
      .map(f => f.properties.median_income)
      .filter(v => v != null)
      .sort((a, b) => a - b);
    const pctBlacks = countyFeatures
      .map(f => f.properties.pct_black)
      .filter(v => v != null)
      .sort((a, b) => a - b);

    const incomeCutHi   = incomes[Math.floor(incomes.length * 2 / 3)];
    const pctBlackCutHi = pctBlacks[Math.floor(pctBlacks.length * 2 / 3)];

    tcLayers.lacy = L.geoJSON({
      type: 'FeatureCollection',
      features: countyFeatures.filter(f =>
        f.properties.median_income != null &&
        f.properties.pct_black     != null &&
        f.properties.median_income >= incomeCutHi &&
        f.properties.pct_black     >= pctBlackCutHi
      ),
    }, {
      style: {
        fillColor:   '#3b4994',
        fillOpacity: 0.7,
        color:       '#1a2050',
        weight:      1.5,
      },
      onEachFeature: tcPopup,
    });
  } else {
    tcLayers.lacy = L.layerGroup();
  }

  // ── Layer: Concentric rings ──
  const ringGroup = L.layerGroup();
  const center = L.latLng(CONCENTRIC_ZONE_CENTER[0], CONCENTRIC_ZONE_CENTER[1]);
  CONCENTRIC_ZONE_RADII.forEach((r, i) => {
    L.circle(center, {
      radius:    r * 1000,
      color:     '#444',
      weight:    1.5,
      opacity:   0.7,
      fill:      false,
      dashArray: '6 4',
    })
    .bindTooltip(CONCENTRIC_ZONE_LABELS[i], { direction: 'right', opacity: 0.9 })
    .addTo(ringGroup);
  });
  tcLayers.rings = ringGroup;
  ringGroup.addTo(tcMap);

  // ── Wiring checkboxes ──
  document.getElementById('tc-zones').addEventListener('change', e => {
    toggleLayer('zones', e.target.checked);
    updateTCFinding();
  });
  document.getElementById('tc-vitality').addEventListener('change', e => {
    // Vitality layer is POI data from Jacobs viz; reuse if already loaded
    if (e.target.checked) {
      if (!tcLayers.vitality) buildVitalityLayer(geojson);
      else tcLayers.vitality.addTo(tcMap);
    } else if (tcLayers.vitality) {
      tcMap.removeLayer(tcLayers.vitality);
    }
    updateTCFinding();
  });
  document.getElementById('tc-lacy').addEventListener('change', e => {
    toggleLayer('lacy', e.target.checked);
    updateTCFinding();
  });
  document.getElementById('tc-vacancy').addEventListener('change', e => {
    toggleLayer('vacancy', e.target.checked);
    updateTCFinding();
  });

  addTCLegend();
  updateTCFinding();
}

function toggleLayer(name, on) {
  const layer = tcLayers[name];
  if (!layer) return;
  if (on) layer.addTo(tcMap);
  else tcMap.removeLayer(layer);
}

function buildVitalityLayer(geojson) {
  // Show city tracts with high-vacancy as rough inverse vitality proxy
  // (full OSM POI layer would require re-fetching — cross-viz data sharing)
  const cityHighVacancy = {
    type: 'FeatureCollection',
    features: geojson.features.filter(f =>
      f.properties.geography === 'city' &&
      f.properties.vacancy_rate != null &&
      f.properties.vacancy_rate < 10  // low vacancy = higher vitality
    ),
  };

  tcLayers.vitality = L.geoJSON(cityHighVacancy, {
    style: { fillColor: '#e7b800', fillOpacity: 0.5, color: '#b08800', weight: 0.8 },
    onEachFeature: tcPopup,
  }).addTo(tcMap);
}

function tcPopup(feature, layer) {
  const p = feature.properties;
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

function addTCLegend() {
  const legend = L.control({ position: 'bottomright' });
  legend.onAdd = () => {
    const div = L.DomUtil.create('div', 'map-legend');
    div.innerHTML = `
      <h4>Layers</h4>
      <div class="legend-item"><span class="legend-swatch" style="background:${d3.interpolateOranges(0.6)}"></span> % Black (Zones)</div>
      <div class="legend-item"><span class="legend-swatch" style="background:#e7b800"></span> Low vacancy (Jacobs)</div>
      <div class="legend-item"><span class="legend-swatch" style="background:#3b4994"></span> Black middle-class (Lacy)</div>
      <div class="legend-item"><span class="legend-swatch" style="background:${d3.interpolateReds(0.6)}"></span> High vacancy</div>
      <div style="margin-top:0.5rem;font-size:0.7rem;color:#555">
        <span style="border-bottom:2px solid #2b4d8c">——</span> City boundary<br>
        <span style="color:#444">- - -</span> Concentric rings
      </div>
    `;
    return div;
  };
  legend.addTo(tcMap);
}

// ── Finding panel ──

function updateTCFinding() {
  const el = document.getElementById('tc-finding');
  const active = [];
  if (document.getElementById('tc-zones')?.checked)   active.push('concentric zones');
  if (document.getElementById('tc-vitality')?.checked) active.push('Jacobs vitality');
  if (document.getElementById('tc-lacy')?.checked)     active.push('Lacy's Black middle-class tracts');
  if (document.getElementById('tc-vacancy')?.checked)  active.push('vacancy rate');

  if (!active.length) {
    el.innerHTML = '<p>Select layers above to compare theories spatially.</p>';
    return;
  }

  el.innerHTML = `
    <p><strong>Active layers:</strong> ${active.join(', ')}.</p>
    <p>Look for convergence zones — where high vacancy (Jacobs's anti-vitality) overlaps with
    the transition zone ring (Park &amp; Burgess) and low Black middle-class presence (Lacy).
    In St. Louis, these tend to cluster in the near-north side of the independent city,
    historically shaped by urban renewal demolition and freeway construction in the 1950s–70s.
    The city–county boundary (visible as the heavier blue tract borders) marks where
    suburban sorting dynamics abruptly shift — a discontinuity none of the three theories
    fully anticipate.</p>
  `;
}