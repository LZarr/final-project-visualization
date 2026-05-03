// ── Black Middle-Class Suburban Identity (Karyn Lacy) ──
// Bivariate choropleth — St. Louis County ONLY (FIPS 29189).
// Dimensions: % Black population × median household income.
// Goal: reveal spatial sorting of middle-class Black households into different
// municipalities than white households at equivalent income levels.

let lacyMap, lacyGeoLayer;

async function initLacySuburbs() {
  const mapEl = document.getElementById('lacy-map');
  mapEl.innerHTML = '<div class="loading-msg">Loading St. Louis County tract data…</div>';

  try {
    const [countyGJ, demoData] = await Promise.all([
      fetchTractGeoJSON(FIPS.STL_COUNTY),
      fetchDemographics(),
    ]);

    // County only — city explicitly excluded
    const countyDemo = demoData.filter(d => d._isCounty);
    const joined = joinDataToGeoJSON(countyGJ, countyDemo);
    const withTerciles = computeBivariateTerciles(joined);

    mapEl.innerHTML = '';
    renderLacyMap(withTerciles);
    renderBivariateLegend();
    updateLacyFinding(withTerciles);

  } catch (err) {
    mapEl.innerHTML = `<div class="error-msg">Could not load county data.<br><small>${err.message}</small></div>`;
    console.error('Lacy suburbs error:', err);
  }
}

// ── Bivariate tercile assignment ──

function computeBivariateTerciles(geojson) {
  const features = geojson.features.filter(f => f.properties._hasData);

  // Extract valid income and %Black values
  const incomes = features
    .map(f => f.properties.median_income)
    .filter(v => v != null)
    .sort((a, b) => a - b);

  const pctBlacks = features
    .map(f => f.properties.pct_black)
    .filter(v => v != null)
    .sort((a, b) => a - b);

  function tercile(vals) {
    return [
      vals[Math.floor(vals.length / 3)],
      vals[Math.floor(2 * vals.length / 3)],
    ];
  }

  const incomeCuts   = tercile(incomes);
  const pctBlackCuts = tercile(pctBlacks);

  function assignTercile(val, cuts) {
    if (val == null) return null;
    if (val <= cuts[0]) return 0;
    if (val <= cuts[1]) return 1;
    return 2;
  }

  return {
    ...geojson,
    features: geojson.features.map(f => {
      const p = f.properties;
      const incomeT   = assignTercile(p.median_income, incomeCuts);
      const pctBlackT = assignTercile(p.pct_black,     pctBlackCuts);
      const color = (incomeT != null && pctBlackT != null)
        ? BIVARIATE_COLORS[incomeT][pctBlackT]
        : '#e0e0e0';
      return {
        ...f,
        properties: {
          ...p,
          income_tercile:    incomeT,
          pct_black_tercile: pctBlackT,
          bivariate_color:   color,
          income_cut_lo:     incomeCuts[0],
          income_cut_hi:     incomeCuts[1],
          pct_black_cut_lo:  pctBlackCuts[0],
          pct_black_cut_hi:  pctBlackCuts[1],
        },
      };
    }),
  };
}

// ── Map ──

// Notable municipalities to label — these are the key Lacy-relevant places
const NOTABLE_MUNICIPALITIES = [
  { name: 'Ferguson',       lat: 38.744, lon: -90.305, note: 'Majority Black, middle-income' },
  { name: 'University City', lat: 38.662, lon: -90.335, note: 'Racially mixed, middle-income' },
  { name: 'Ladue',          lat: 38.638, lon: -90.378, note: 'Predominantly white, high-income' },
  { name: 'Clayton',        lat: 38.643, lon: -90.342, note: 'County seat, predominantly white, high-income' },
  { name: 'Florissant',     lat: 38.789, lon: -90.322, note: 'Majority Black, working-to-middle income' },
  { name: 'Creve Coeur',    lat: 38.660, lon: -90.440, note: 'Predominantly white, high-income' },
];

function renderLacyMap(geojson) {
  // Center on St. Louis County (slightly west of the city)
  lacyMap = L.map('lacy-map', { center: [38.640, -90.380], zoom: 11 });

  L.tileLayer('https://{s}.basemaps.cartocdn.com/light_nolabels/{z}/{x}/{y}{r}.png', {
    attribution: '© OpenStreetMap, © CartoDB',
  }).addTo(lacyMap);

  L.tileLayer('https://{s}.basemaps.cartocdn.com/light_only_labels/{z}/{x}/{y}{r}.png', {
    attribution: '',
  }).addTo(lacyMap);

  lacyGeoLayer = L.geoJSON(geojson, {
    style(feature) {
      return {
        fillColor:   feature.properties.bivariate_color || '#e0e0e0',
        fillOpacity: 0.78,
        color:       '#aaa',
        weight:      0.5,
        opacity:     1,
      };
    },
    onEachFeature(feature, layer) {
      const p = feature.properties;
      layer.on({
        mouseover(e) {
          e.target.setStyle({ weight: 2, color: '#333' });
          const income = p.median_income != null
            ? `$${p.median_income.toLocaleString()}`
            : 'N/A';
          const incomeLabel = p.income_tercile != null
            ? ['Low-income tercile', 'Middle-income tercile', 'High-income tercile'][p.income_tercile]
            : 'No data';
          const blackLabel = p.pct_black_tercile != null
            ? ['Low % Black', 'Mid % Black', 'High % Black'][p.pct_black_tercile]
            : 'No data';

          const tooltip = document.getElementById('lacy-tooltip');
          tooltip.classList.remove('hidden');
          tooltip.innerHTML = `
            <strong>${p.NAME || 'Tract'}</strong><br>
            Median income: ${income}<br>
            % Black: ${p.pct_black != null ? p.pct_black.toFixed(1) + '%' : 'N/A'}<br>
            <em>${incomeLabel} · ${blackLabel}</em>
          `;
          // Position near mouse
          const mapRect = document.getElementById('lacy-map').getBoundingClientRect();
          const mouseEvent = e.originalEvent;
          tooltip.style.left = (mouseEvent.clientX - mapRect.left + 12) + 'px';
          tooltip.style.top  = (mouseEvent.clientY - mapRect.top  - 10) + 'px';
        },
        mousemove(e) {
          const mapRect = document.getElementById('lacy-map').getBoundingClientRect();
          const tooltip = document.getElementById('lacy-tooltip');
          tooltip.style.left = (e.originalEvent.clientX - mapRect.left + 12) + 'px';
          tooltip.style.top  = (e.originalEvent.clientY - mapRect.top  - 10) + 'px';
        },
        mouseout(e) {
          lacyGeoLayer.resetStyle(e.target);
          document.getElementById('lacy-tooltip').classList.add('hidden');
        },
      });
    },
  }).addTo(lacyMap);

  // Municipality markers
  NOTABLE_MUNICIPALITIES.forEach(m => {
    L.circleMarker([m.lat, m.lon], {
      radius: 5,
      color: '#333',
      weight: 1.5,
      fillColor: '#fff',
      fillOpacity: 0.9,
    })
    .bindTooltip(`<strong>${m.name}</strong><br><em>${m.note}</em>`, {
      permanent: false,
      direction: 'right',
    })
    .addTo(lacyMap);
  });
}

// ── Bivariate legend ──

function renderBivariateLegend() {
  const container = document.getElementById('lacy-legend');
  const size = 18; // px per cell
  const pad  = 2;
  const totalSize = size * 3 + pad * 2;

  const svg = d3.select(container)
    .append('svg')
    .attr('width',  totalSize + 80)
    .attr('height', totalSize + 60);

  // 3×3 color grid
  BIVARIATE_COLORS.forEach((row, i) => {
    row.forEach((color, j) => {
      svg.append('rect')
         .attr('x', j * (size + pad))
         .attr('y', (2 - i) * (size + pad))  // flip y so high income is at top
         .attr('width',  size)
         .attr('height', size)
         .attr('fill', color)
         .attr('rx', 2);
    });
  });

  // Axis labels
  svg.append('text')
     .attr('x', totalSize / 2)
     .attr('y', totalSize + 14)
     .attr('text-anchor', 'middle')
     .attr('font-size', '0.7rem')
     .attr('fill', '#555')
     .text('% Black population →');

  svg.append('text')
     .attr('transform', `rotate(-90)`)
     .attr('x', -(totalSize / 2))
     .attr('y', totalSize + 42)
     .attr('text-anchor', 'middle')
     .attr('font-size', '0.7rem')
     .attr('fill', '#555')
     .text('Median income →');

  // Corner annotations
  const corners = [
    { x: 0,          y: totalSize + 28, text: 'Low' },
    { x: totalSize,  y: totalSize + 28, text: 'High', anchor: 'end' },
  ];
  corners.forEach(c => {
    svg.append('text')
       .attr('x', c.x)
       .attr('y', c.y)
       .attr('text-anchor', c.anchor || 'start')
       .attr('font-size', '0.62rem')
       .attr('fill', '#888')
       .text(c.text);
  });

  // Add label above
  d3.select(container)
    .insert('div', 'svg')
    .style('font-size', '0.75rem')
    .style('font-family', 'system-ui, sans-serif')
    .style('color', '#444')
    .style('margin-bottom', '0.3rem')
    .text('Bivariate map: income × race (St. Louis County tracts)');
}

// ── Finding panel ──

function updateLacyFinding(geojson) {
  const el = document.getElementById('lacy-finding');
  const features = geojson.features.filter(f => f.properties._hasData);

  // Count tracts in the "high income + high %Black" cell (top-right of bivariate matrix)
  const highIncomeHighBlack = features.filter(
    f => f.properties.income_tercile === 2 && f.properties.pct_black_tercile === 2
  ).length;
  const highIncomeTotal = features.filter(
    f => f.properties.income_tercile === 2
  ).length;

  const pct = highIncomeTotal > 0
    ? ((highIncomeHighBlack / highIncomeTotal) * 100).toFixed(0)
    : '—';

  el.innerHTML = `
    <p><strong>Lacy's argument — spatial test:</strong>
    Of <strong>${highIncomeTotal}</strong> high-income tracts in St. Louis County,
    only <strong>${highIncomeHighBlack}</strong> (${pct}%) are also in the high % Black tercile.
    The dark purple cells on the map — representing majority-Black, high-income tracts — are
    concentrated in a narrow band of municipalities (notably University City, parts of Florissant)
    rather than distributed evenly across the county's affluent areas.
    This spatial sorting is precisely what Lacy documents: middle-class Black families in St. Louis
    County are not simply integrated into the county's wealthiest suburbs; they occupy
    a distinct — and more limited — set of places, navigating racial identity in spaces
    that are often majority-Black even at middle-class income levels.</p>
  `;
}