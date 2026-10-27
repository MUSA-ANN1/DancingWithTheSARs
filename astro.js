/* Real-time astronomy helpers (no DOM, no THREE).
   Low-precision formulas from the Astronomical Almanac / Meeus.
   Sun: about 0.01 degree. Moon: about 0.3 degree. GMST: about 1 second.
   All angles in radians unless the name says Deg. */
(function (root) {
  'use strict';

  const DEG = Math.PI / 180;
  const EARTH_RADIUS_KM = 6371;

  function julianDate(ms) {
    return ms / 86400000 + 2440587.5;
  }

  /* Greenwich Mean Sidereal Time: the right ascension that is on the
     Greenwich meridian right now. */
  function gmst(jd) {
    const d = jd - 2451545.0;
    const deg = 280.46061837 + 360.98564736629 * d;
    return (((deg % 360) + 360) % 360) * DEG;
  }

  function obliquity(d) {
    return (23.439 - 0.0000004 * d) * DEG;
  }

  /* Sun: right ascension and declination of date. */
  function sunEq(jd) {
    const n = jd - 2451545.0;
    const L = 280.460 + 0.9856474 * n;
    const g = (357.528 + 0.9856003 * n) * DEG;
    const lam = (L + 1.915 * Math.sin(g) + 0.020 * Math.sin(2 * g)) * DEG;
    const eps = obliquity(n);
    return {
      ra: Math.atan2(Math.cos(eps) * Math.sin(lam), Math.cos(lam)),
      dec: Math.asin(Math.sin(eps) * Math.sin(lam)),
      // Earth-Sun distance in AU, used for the Sun's apparent size
      au: 1.00014 - 0.01671 * Math.cos(g) - 0.00014 * Math.cos(2 * g)
    };
  }

  /* Moon: right ascension, declination, distance in Earth radii. */
  function moonEq(jd) {
    const d = jd - 2451545.0;
    const Lm = 218.316 + 13.176396 * d;     // mean longitude
    const Mm = (134.963 + 13.064993 * d) * DEG; // Moon mean anomaly
    const Ms = (357.529 + 0.98560028 * d) * DEG; // Sun mean anomaly
    const D = (297.850 + 12.190749 * d) * DEG;  // mean elongation
    const F = (93.272 + 13.229350 * d) * DEG;   // argument of latitude

    const lam = (Lm
      + 6.289 * Math.sin(Mm)
      + 1.274 * Math.sin(2 * D - Mm)
      + 0.658 * Math.sin(2 * D)
      + 0.214 * Math.sin(2 * Mm)
      - 0.186 * Math.sin(Ms)
      - 0.114 * Math.sin(2 * F)) * DEG;
    const bet = (5.128 * Math.sin(F)
      + 0.281 * Math.sin(Mm + F)
      + 0.278 * Math.sin(Mm - F)
      + 0.173 * Math.sin(2 * D - F)) * DEG;
    const distKm = 385001
      - 20905 * Math.cos(Mm)
      - 3699 * Math.cos(2 * D - Mm)
      - 2956 * Math.cos(2 * D);

    const eps = obliquity(d);
    const x = Math.cos(bet) * Math.cos(lam);
    const y = Math.cos(bet) * Math.sin(lam) * Math.cos(eps) - Math.sin(bet) * Math.sin(eps);
    const z = Math.cos(bet) * Math.sin(lam) * Math.sin(eps) + Math.sin(bet) * Math.cos(eps);
    return {
      ra: Math.atan2(y, x),
      dec: Math.asin(z),
      distEarthRadii: distKm / EARTH_RADIUS_KM
    };
  }

  /* Longitude (degrees east) where the Sun is directly overhead. */
  function subsolarLonDeg(jd) {
    let lon = (sunEq(jd).ra - gmst(jd)) / DEG;
    lon = ((lon + 540) % 360) - 180;
    return lon;
  }

  const api = { DEG, EARTH_RADIUS_KM, julianDate, gmst, sunEq, moonEq, subsolarLonDeg };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Astro = api;
})(typeof window !== 'undefined' ? window : globalThis);
