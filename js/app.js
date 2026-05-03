// ── App entry point ──
// Initializes all four visualizations after DOM is ready.
// Each viz handles its own loading state and error display.

document.addEventListener('DOMContentLoaded', () => {

  // Check for API key — show a banner if still placeholder
  if (!CENSUS_API_KEY || CENSUS_API_KEY === 'YOUR_CENSUS_API_KEY') {
    showAPIKeyBanner();
  }

  // Initialize each section as it scrolls into view (IntersectionObserver)
  // This avoids hammering the Census API on page load for all sections at once.
  const sections = [
    { id: 'concentric-zones', init: initConcentricZones,  initialized: false },
    { id: 'jacobs-vitality',  init: initJacobsVitality,   initialized: false },
    { id: 'lacy-suburbs',     init: initLacySuburbs,       initialized: false },
    { id: 'theory-comparison',init: initTheoryComparison,  initialized: false },
  ];

  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (!entry.isIntersecting) return;
      const section = sections.find(s => s.id === entry.target.id);
      if (section && !section.initialized) {
        section.initialized = true;
        section.init().catch(err => console.error(`Init error [${section.id}]:`, err));
        observer.unobserve(entry.target);
      }
    });
  }, { threshold: 0.1 });

  sections.forEach(s => {
    const el = document.getElementById(s.id);
    if (el) observer.observe(el);
  });
});

// ── API key banner ──
function showAPIKeyBanner() {
  const banner = document.createElement('div');
  banner.style.cssText = `
    position: fixed; bottom: 0; left: 0; right: 0;
    background: #fff3cd; color: #856404;
    border-top: 2px solid #ffc107;
    padding: 0.7rem 1.5rem;
    font-family: system-ui, sans-serif;
    font-size: 0.82rem;
    z-index: 9999;
    display: flex; justify-content: space-between; align-items: center;
  `;
  banner.innerHTML = `
    <span>
      <strong>Census API key not set.</strong>
      Open <code>js/config.js</code> and replace <code>YOUR_CENSUS_API_KEY</code>
      with a free key from
      <a href="https://api.census.gov/data/key_signup.html" target="_blank" rel="noopener">
        api.census.gov/data/key_signup.html
      </a>.
      Maps will not load until the key is set.
    </span>
    <button onclick="this.parentElement.remove()" style="
      background: none; border: none; font-size: 1.1rem;
      cursor: pointer; color: #856404; padding: 0 0.5rem;
    ">✕</button>
  `;
  document.body.appendChild(banner);
}