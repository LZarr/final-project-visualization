// ── Census API Configuration ──
// Get a free key at: https://api.census.gov/data/key_signup.html
// Replace the string below with your key, then save.
const CENSUS_API_KEY = 'YOUR_CENSUS_API_KEY';

// ACS 5-year vintage to use (update as newer data becomes available)
const ACS_VINTAGE = '2023';

// FIPS codes — St. Louis city and county are ALWAYS treated as distinct geographies
const FIPS = {
  STATE: '29',
  STL_CITY:   '510',   // Independent city — not part of any county
  STL_COUNTY: '189',   // St. Louis County — 88 municipalities
};

// Census ACS base URL
const ACS_BASE = `https://api.census.gov/data/${ACS_VINTAGE}/acs/acs5`;

// Census TIGER cartographic boundary GeoJSON (2023, 1:500k — good for web display)
const TIGER_BASE = 'https://raw.githubusercontent.com/uscensusbureau/citysdk/master/v2/GeoJSON/500k/2023';

// Census LODES (LEHD Origin-Destination Employment Statistics) — workplace area characteristics
// WAC = Workplace Area Characteristics; S000 = all jobs; JT00 = all job types
const LODES_BASE = 'https://lehd.ces.census.gov/data/lodes/LODES8/mo/wac';

// OpenStreetMap Overpass API
const OVERPASS_API = 'https://overpass-api.de/api/interpreter';

// Map center and zoom for St. Louis metro area (covers both city and county)
const MAP_CENTER = [38.627, -90.308];
const MAP_ZOOM   = 11;

// Concentric zone radii in kilometers, centered on City Hall (downtown STL)
// These are the theoretical rings — not meant to be empirically calibrated
const CONCENTRIC_ZONE_CENTER = [38.6331, -90.1997]; // City Hall
const CONCENTRIC_ZONE_RADII  = [2, 4, 7, 11, 16];   // km
const CONCENTRIC_ZONE_LABELS = [
  'Central Business District',
  'Zone of Transition',
  'Working-Class Residential',
  'Middle-Class Residential',
  'Commuter Zone',
];

// Bivariate color matrix for Lacy visualization (3×3)
// Rows: income tercile (low → high); Cols: % Black tercile (low → high)
// Colors from a standard bivariate scheme (Joshua Stevens palette)
const BIVARIATE_COLORS = [
  ['#e8e8e8', '#ace4e4', '#5ac8c8'],  // low income
  ['#dfb0d6', '#a5add3', '#5698b9'],  // mid income
  ['#be64ac', '#8c62aa', '#3b4994'],  // high income
];