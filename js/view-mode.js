// ── Shared view mode toggle ──
// Four modes: side-by-side | reality | ideal | overlay
// Call setupViewMode() after both maps are initialized in a section.

function setupViewMode({ barId, panelsId, getRealityMap, getIdealMap, buildOverlayLayer }) {
  const bar    = document.getElementById(barId);
  const panels = document.getElementById(panelsId);
  if (!bar || !panels) return;

  const MODES = [
    { key: 'side-by-side', label: 'Side by side' },
    { key: 'reality',      label: 'Reality only' },
    { key: 'ideal',        label: 'Ideal only'   },
    { key: 'overlay',      label: 'Overlay'       },
  ];

  MODES.forEach(({ key, label }) => {
    const btn = document.createElement('button');
    btn.className    = 'view-mode-btn' + (key === 'side-by-side' ? ' active' : '');
    btn.dataset.mode = key;
    btn.textContent  = label;
    btn.addEventListener('click', () => activate(key));
    bar.appendChild(btn);
  });

  let overlayLayer = null;

  function activate(mode) {
    bar.querySelectorAll('.view-mode-btn').forEach(b =>
      b.classList.toggle('active', b.dataset.mode === mode)
    );
    panels.dataset.mode = mode;

    const realityMap = getRealityMap?.();
    const idealMap   = getIdealMap?.();

    if (mode === 'overlay') {
      if (overlayLayer) {
        realityMap?.removeLayer(overlayLayer);
        overlayLayer = null;
      }
      if (buildOverlayLayer && realityMap) {
        overlayLayer = buildOverlayLayer(realityMap);
      }
    } else {
      if (overlayLayer && realityMap) {
        realityMap.removeLayer(overlayLayer);
        overlayLayer = null;
      }
    }

    // Invalidate map sizes after CSS layout change
    setTimeout(() => {
      realityMap?.invalidateSize();
      idealMap?.invalidateSize();
    }, 80);
  }
}