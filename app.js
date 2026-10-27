/* Dancing with the SARs: Caspian Sea
   Real sky (star catalogue, Milky Way, Sun, Moon) around a day/night Earth.
   The camera orbits the Earth; the Earth itself never rotates, so the
   Caspian always stays centred. Users can only zoom.
   Requires: three.js r158 (global), astro.js (window.Astro). */
'use strict';

(function () {

  /* ── Constants ─────────────────────────────────────────────── */
  const DEG = Math.PI / 180;
  const A = window.Astro;

  const CASPIAN = { lon: 50.7, lat: 41.8 };                  // view centre
  const CASPIAN_BBOX = { w: 46.5, s: 36.4, e: 55.0, n: 47.5 }; // ASF search area
  const INTRO_MS = 3000;
  const START_DIST = 11;      // Earth radii, far away
  const END_DIST = 1.55;      // zoomed on the Caspian
  const MIN_DIST = 1.08;
  const MAX_DIST = 11;
  const PLAY_MS = 1600;
  const DAY_MS = 86400000;

  const SUN_RENDER_DIST = 600;
  const SKY_RADIUS = 2000;
  const MILKY_RADIUS = 3000;

  const ASF_BASE = 'https://api.daac.asf.alaska.edu/services/search/param';
  const VERTEX_URL = 'https://search.asf.alaska.edu/';

  const NIGHT_TEX = 'https://unpkg.com/three-globe@2.31.2/example/img/earth-night.jpg'; // city-light source texture

  const STAR_URLS = [
    'https://cdn.jsdelivr.net/gh/ofrohn/d3-celestial@master/data/stars.6.json',
    'https://raw.githubusercontent.com/ofrohn/d3-celestial/master/data/stars.6.json'
  ];
  const MW_URLS = [
    'https://dieghernan.github.io/celestial_data/data/mw.min.geojson',
    'https://cdn.jsdelivr.net/gh/ofrohn/d3-celestial@master/data/mw.json',
    'https://raw.githubusercontent.com/ofrohn/d3-celestial/master/data/mw.json'
  ];

  /* ── DOM ────────────────────────────────────────────────────── */
  const $ = s => document.querySelector(s);
  const globeEl = $('#globe-container');
  const introOv = $('#intro-overlay');
  const mainHead = $('#main-head');
  const toolbar = $('#toolbar');
  const historyBtn = $('#history-btn');
  const historyClose = $('#history-close');
  const timeline = $('#timeline');
  const dateRange = $('#date-range');
  const playBtn = $('#play-btn');
  const playIcon = $('#play-icon');
  const pauseIcon = $('#pause-icon');
  const dateBadge = $('#current-date-badge');
  const tickLabels = $('#tick-labels');
  const tickMarks = $('#tick-marks');
  const nisarPanel = $('#nisar-panel');
  const nisarImg = $('#nisar-img');
  const nisarNoImg = $('#nisar-no-img');
  const emptyIcon = $('#nisar-empty-icon');
  const emptyTitle = $('#nisar-empty-title');
  const emptyBody = $('#nisar-empty-body');
  const nisarDL = $('#nisar-date-label');
  const nisarType = $('#nisar-type');
  const nisarLink = $('#nisar-link');
  const statusMsg = $('#status-msg');
  const statusBar = $('#status-bar');

  let statusTimer = null;
  function setStatus(msg, ms) {
    statusMsg.textContent = msg;
    statusBar.hidden = !msg;
    clearTimeout(statusTimer);
    if (msg && ms) statusTimer = setTimeout(() => setStatus(''), ms);
  }

  /* ── Geometry helpers ───────────────────────────────────────── */
  /* One formula for both geography and the sky: longitude / right
     ascension 0 sits on +x, north is +y, east runs toward -z.
     This matches how THREE.SphereGeometry wraps an equirectangular
     texture, so the Earth map, the stars and the Sun all agree. */
  function sphToVec3(lonRad, latRad, r) {
    return new THREE.Vector3(
      r * Math.cos(latRad) * Math.cos(lonRad),
      r * Math.sin(latRad),
      -r * Math.cos(latRad) * Math.sin(lonRad)
    );
  }
  const lerp = (a, b, t) => a + (b - a) * t;
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const easeInOut = t => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

  /* ════════════════════════════════════════════════════════════
     1. SCENE
  ════════════════════════════════════════════════════════════ */
  let renderer, scene, camera, sky, sunGroupItems = {}, moonMesh, moonLight;
  const earthUniforms = {
    dayMap: { value: null },
    nightMap: { value: null },
    hasNight: { value: 1 },
    cityMap: { value: null },
    hasCity: { value: 0 },
    sunDir: { value: new THREE.Vector3(1, 0, 0) }
  };
  const atmUniforms = { sunDir: earthUniforms.sunDir };
  const starUniforms = { uPR: { value: 1 } };

  let W = window.innerWidth, H = window.innerHeight;

  function initScene() {
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(W, H);
    renderer.setClearColor(0x000000, 1);
    renderer.domElement.style.touchAction = 'none';
    globeEl.appendChild(renderer.domElement);
    starUniforms.uPR.value = renderer.getPixelRatio();

    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(45, W / H, 0.05, 4000);

    // The sky group holds everything that lives in inertial space.
    // It is rotated each frame by minus the sidereal time, so that in
    // the Earth-fixed frame the stars, Sun and Moon sit where they
    // really are right now.
    sky = new THREE.Group();
    scene.add(sky);

    buildEarth();
    buildAtmosphere();
    buildSun();
    buildMoon();
  }

  function placeholderTexture(r, g, b) {
    const t = new THREE.DataTexture(new Uint8Array([r, g, b, 255]), 1, 1);
    t.needsUpdate = true;
    return t;
  }

  function makeVectorEarthTextures() {
    const width = 2048, height = 1024;
    const dayCanvas = document.createElement('canvas');
    const nightCanvas = document.createElement('canvas');
    const cityCanvas = document.createElement('canvas');
    [dayCanvas, nightCanvas, cityCanvas].forEach(c => { c.width = width; c.height = height; });
    const dayCtx = dayCanvas.getContext('2d');
    const nightCtx = nightCanvas.getContext('2d');
    const cityCtx = cityCanvas.getContext('2d');

    const paintBase = (ctx, ocean, land, border, graticule) => {
      ctx.fillStyle = ocean;
      ctx.fillRect(0, 0, width, height);
      if (typeof WORLD === 'undefined' || !window.topojson || !window.d3) return false;
      const projection = d3.geoEquirectangular()
        .scale(width / (2 * Math.PI)).translate([width / 2, height / 2]);
      const path = d3.geoPath(projection, ctx);
      const countries = topojson.feature(WORLD, WORLD.objects.countries);
      const mesh = topojson.mesh(WORLD, WORLD.objects.countries, (a, b) => a !== b);
      if (graticule) {
        ctx.beginPath(); path(d3.geoGraticule10());
        ctx.strokeStyle = 'rgba(11,61,145,0.34)'; ctx.lineWidth = 1; ctx.stroke();
      }
      ctx.beginPath(); path(countries); ctx.fillStyle = land; ctx.fill();
      ctx.beginPath(); path(mesh); ctx.strokeStyle = border; ctx.lineWidth = 1.4; ctx.stroke();
      return true;
    };

    const hasCountries = paintBase(dayCtx, '#0A2660', '#2B5CB5', '#071A3A', true);
    paintBase(nightCtx, '#020812', '#07172B', '#0B3D91', false);
    cityCtx.clearRect(0, 0, width, height);
    if (!hasCountries) {
      dayCtx.fillStyle = '#2B5CB5'; dayCtx.fillRect(0, 0, width, height);
      nightCtx.fillStyle = '#020812'; nightCtx.fillRect(0, 0, width, height);
      setStatus('Country boundaries unavailable; showing a simplified globe.', 7000);
    }

    const dayTex = new THREE.CanvasTexture(dayCanvas);
    const nightTex = new THREE.CanvasTexture(nightCanvas);
    const cityTex = new THREE.CanvasTexture(cityCanvas);
    [dayTex, nightTex, cityTex].forEach(tex => {
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.needsUpdate = true;
      tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
    });

    // Turn NASA's night imagery into a transparent light-only layer.
    const loader = new THREE.TextureLoader();
    loader.setCrossOrigin('anonymous');
    loader.load(NIGHT_TEX, tex => {
      try {
        const c = document.createElement('canvas'); c.width = width; c.height = height;
        const cx = c.getContext('2d', { willReadFrequently: true });
        cx.drawImage(tex.image, 0, 0, width, height);
        const pixels = cx.getImageData(0, 0, width, height);
        const data = pixels.data;
        for (let i = 0; i < data.length; i += 4) {
          const lum = Math.max(data[i], data[i + 1], data[i + 2]);
          if (lum < 52) data[i + 3] = 0;
          else {
            data[i] = 220; data[i + 1] = 226; data[i + 2] = 235;
            data[i + 3] = Math.round(clamp((lum - 42) / 150, 0, 0.92) * 255);
          }
        }
        cx.putImageData(pixels, 0, 0);
        cityTex.dispose();
        earthUniforms.cityMap.value = new THREE.CanvasTexture(c);
        earthUniforms.cityMap.value.colorSpace = THREE.SRGBColorSpace;
        earthUniforms.cityMap.value.anisotropy = renderer.capabilities.getMaxAnisotropy();
        earthUniforms.cityMap.value.needsUpdate = true;
        earthUniforms.hasCity.value = 1;
      } catch (err) {
        setStatus('City lights could not be processed in this browser.', 7000);
      }
      tex.dispose();
    }, undefined, () => setStatus('Night-light imagery is unavailable.', 7000));
    return { dayTex, nightTex };
  }

  function buildEarth() {
    earthUniforms.dayMap.value = placeholderTexture(10, 30, 70);
    earthUniforms.nightMap.value = placeholderTexture(0, 0, 0);
    earthUniforms.cityMap.value = placeholderTexture(0, 0, 0);
    const textures = makeVectorEarthTextures();
    earthUniforms.dayMap.value = textures.dayTex;
    earthUniforms.nightMap.value = textures.nightTex;

    const mat = new THREE.ShaderMaterial({
      uniforms: earthUniforms,
      vertexShader: \`
        varying vec3 vN; varying vec2 vUv; varying vec3 vP;
        void main() {
          vUv = uv; vN = normalize(normal); vP = position;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }\`,
      fragmentShader: \`
        uniform sampler2D dayMap; uniform sampler2D nightMap; uniform sampler2D cityMap;
        uniform float hasNight; uniform float hasCity; uniform vec3 sunDir;
        varying vec3 vN; varying vec2 vUv; varying vec3 vP;
        void main() {
          vec3 n = normalize(vN);
          vec3 s = normalize(sunDir);
          float d = dot(n, s);
          float dayMix = smoothstep(-0.10, 0.13, d);
          vec3 day = texture2D(dayMap, vUv).rgb;
          vec3 night = texture2D(nightMap, vUv).rgb;
          vec4 cities = texture2D(cityMap, vUv);
          vec3 dayCol = day * (0.30 + 0.90 * max(d, 0.0));
          vec3 nightCol = night * 0.92 + cities.rgb * cities.a * hasCity * 2.2;
          vec3 col = mix(nightCol, dayCol, dayMix);
          float twilight = smoothstep(-0.18, -0.02, d) * (1.0 - dayMix);
          col += vec3(0.04, 0.08, 0.16) * twilight;
          vec3 v = normalize(cameraPosition - vP);
          float rim = pow(1.0 - max(dot(n, v), 0.0), 3.0);
          col += vec3(0.04, 0.20, 0.48) * rim * 0.38 * clamp(d + 0.35, 0.0, 1.0);
          gl_FragColor = vec4(col, 1.0);
        }\`
    });
    scene.add(new THREE.Mesh(new THREE.SphereGeometry(1, 128, 96), mat));
  }
  function buildAtmosphere() {
    const mat = new THREE.ShaderMaterial({
      uniforms: atmUniforms,
      side: THREE.BackSide,
      blending: THREE.AdditiveBlending,
      transparent: true,
      depthWrite: false,
      vertexShader: `
        varying vec3 vN; varying vec3 vW;
        void main() {
          vN = normalize(normalMatrix * normal);
          vW = normalize(position);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: `
        uniform vec3 sunDir; varying vec3 vN; varying vec3 vW;
        void main() {
          float i = pow(max(0.0, 0.72 - dot(vN, vec3(0.0, 0.0, 1.0))), 3.5);
          float lit = clamp(dot(vW, normalize(sunDir)) + 0.4, 0.06, 1.0);
          gl_FragColor = vec4(0.25, 0.55, 1.0, 1.0) * i * lit * 1.5;
        }`
    });
    scene.add(new THREE.Mesh(new THREE.SphereGeometry(1.12, 64, 48), mat));
  }

  function glowTexture() {
    const c = document.createElement('canvas');
    c.width = c.height = 256;
    const x = c.getContext('2d');
    const g = x.createRadialGradient(128, 128, 0, 128, 128, 128);
    g.addColorStop(0, 'rgba(255,244,214,1)');
    g.addColorStop(0.12, 'rgba(255,226,160,0.55)');
    g.addColorStop(0.4, 'rgba(255,190,90,0.12)');
    g.addColorStop(1, 'rgba(255,170,60,0)');
    x.fillStyle = g;
    x.fillRect(0, 0, 256, 256);
    return new THREE.CanvasTexture(c);
  }

  function buildSun() {
    // Real angular size: about 0.53 degrees across, scaled by Earth-Sun distance.
    const disc = new THREE.Mesh(
      new THREE.SphereGeometry(1, 32, 16),
      new THREE.MeshBasicMaterial({ color: 0xfff4d8 })
    );
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({
      map: glowTexture(), blending: THREE.AdditiveBlending,
      transparent: true, depthWrite: false
    }));
    sky.add(disc, glow);
    sunGroupItems = { disc, glow };
  }

  function buildMoon() {
    moonMesh = new THREE.Mesh(
      new THREE.SphereGeometry(1737.4 / A.EARTH_RADIUS_KM, 48, 24),
      new THREE.MeshStandardMaterial({ color: 0xa6a49f, roughness: 1, metalness: 0 })
    );
    sky.add(moonMesh);
    moonLight = new THREE.DirectionalLight(0xffffff, 3.2);
    scene.add(moonLight);
    scene.add(new THREE.AmbientLight(0x1a2233, 0.35));
  }

  /* ── Real stars ─────────────────────────────────────────────── */
  async function fetchJSON(urls, timeoutMs) {
    for (const url of urls) {
      try {
        const ac = new AbortController();
        const id = setTimeout(() => ac.abort(), timeoutMs || 20000);
        const res = await fetch(url, { signal: ac.signal });
        clearTimeout(id);
        if (res.ok) return await res.json();
      } catch (e) { /* try next source */ }
    }
    return null;
  }

  function kelvinToRGB(k) {
    const t = k / 100;
    let r, g, b;
    if (t <= 66) { r = 255; g = 99.4708025861 * Math.log(t) - 161.1195681661; }
    else { r = 329.698727446 * Math.pow(t - 60, -0.1332047592); g = 288.1221695283 * Math.pow(t - 60, -0.0755148492); }
    if (t >= 66) b = 255; else if (t <= 19) b = 0; else b = 138.5177312231 * Math.log(t - 10) - 305.0447927307;
    return [clamp(r, 0, 255) / 255, clamp(g, 0, 255) / 255, clamp(b, 0, 255) / 255];
  }

  function bvToRGB(bv) {
    const k = 4600 * (1 / (0.92 * bv + 1.7) + 1 / (0.92 * bv + 0.62));
    const [r, g, b] = kelvinToRGB(clamp(k, 2500, 30000));
    const w = 0.5; // eyes see stars as pale, so blend toward white
    return [lerp(r, 1, w), lerp(g, 1, w), lerp(b, 1, w)];
  }

  async function loadStars() {
    setStatus('Loading star catalogue');
    const data = await fetchJSON(STAR_URLS);
    if (!data || !Array.isArray(data.features)) {
      setStatus('Star catalogue could not be loaded, so the sky is empty.', 8000);
      return;
    }
    const n = data.features.length;
    const pos = new Float32Array(n * 3);
    const col = new Float32Array(n * 3);
    const size = new Float32Array(n);
    let k = 0;
    for (const f of data.features) {
      const c = f.geometry && f.geometry.coordinates;
      if (!c) continue;
      const mag = parseFloat(f.properties && f.properties.mag);
      if (!isFinite(mag)) continue;
      let bv = parseFloat(f.properties.bv);
      if (!isFinite(bv)) bv = 0.6;
      // Catalogue coordinates are [right ascension in degrees, declination].
      const v = sphToVec3(c[0] * DEG, c[1] * DEG, SKY_RADIUS);
      pos.set([v.x, v.y, v.z], k * 3);
      const [r, g, b] = bvToRGB(bv);
      const bright = clamp(1.15 - mag * 0.12, 0.3, 1);
      col.set([r * bright, g * bright, b * bright], k * 3);
      size[k] = Math.max(1.0, 3.6 - mag * 0.42);
      k++;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos.subarray(0, k * 3), 3));
    geo.setAttribute('aColor', new THREE.BufferAttribute(col.subarray(0, k * 3), 3));
    geo.setAttribute('aSize', new THREE.BufferAttribute(size.subarray(0, k), 1));
    const mat = new THREE.ShaderMaterial({
      uniforms: starUniforms,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      vertexShader: `
        attribute float aSize; attribute vec3 aColor; varying vec3 vC; uniform float uPR;
        void main() {
          vC = aColor; gl_PointSize = aSize * uPR;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: `
        varying vec3 vC;
        void main() {
          float d = length(gl_PointCoord - vec2(0.5));
          float a = smoothstep(0.5, 0.05, d);
          gl_FragColor = vec4(vC, a);
        }`
    });
    const pts = new THREE.Points(geo, mat);
    pts.frustumCulled = false;
    pts.renderOrder = -1;
    sky.add(pts);
    setStatus(`${k.toLocaleString('en-US')} real stars loaded`, 4000);
  }

  /* ── Real Milky Way (outline data painted to a sky texture) ── */
  async function loadMilkyWay() {
    const data = await fetchJSON(MW_URLS);
    if (!data || !Array.isArray(data.features)) return;

    const CW = 2048, CH = 1024;
    const cv = document.createElement('canvas');
    cv.width = CW; cv.height = CH;
    const ctx = cv.getContext('2d');
    if ('filter' in ctx) ctx.filter = 'blur(5px)';
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = 'rgba(168,184,232,0.07)';

    for (const f of data.features) {
      const g = f.geometry;
      if (!g) continue;
      const polys = g.type === 'MultiPolygon' ? g.coordinates : g.type === 'Polygon' ? [g.coordinates] : [];
      for (const poly of polys) {
        const path = new Path2D();
        for (const ring of poly) {
          // unwrap longitudes so rings crossing the +-180 seam stay continuous
          let prev = null;
          const pts = ring.map(([lo, la]) => {
            if (prev !== null) {
              while (lo - prev > 180) lo -= 360;
              while (prev - lo > 180) lo += 360;
            }
            prev = lo;
            return [lo, la];
          });
          for (const off of [-360, 0, 360]) {
            pts.forEach(([lo, la], i) => {
              const x = ((lo + off + 180) / 360) * CW;
              const y = ((90 - la) / 180) * CH;
              if (i === 0) path.moveTo(x, y); else path.lineTo(x, y);
            });
            path.closePath();
          }
        }
        ctx.fill(path, 'evenodd');
      }
    }

    const tex = new THREE.CanvasTexture(cv);
    const mesh = new THREE.Mesh(
      new THREE.SphereGeometry(MILKY_RADIUS, 64, 32),
      new THREE.MeshBasicMaterial({ map: tex, side: THREE.BackSide, transparent: true, depthWrite: false })
    );
    mesh.renderOrder = -2;
    sky.add(mesh);
  }

  /* ── Per-frame real-time sky ────────────────────────────────── */
  const Y_AXIS = new THREE.Vector3(0, 1, 0);

  function updateSky() {
    const jd = A.julianDate(Date.now());
    const theta = A.gmst(jd);
    sky.rotation.y = -theta;

    const sun = A.sunEq(jd);
    const sunVec = sphToVec3(sun.ra, sun.dec, 1);

    // Sun position in inertial space, with its true angular size
    const angRadius = (0.2666 * DEG) / sun.au;
    const r = SUN_RENDER_DIST * Math.tan(angRadius);
    sunGroupItems.disc.position.copy(sunVec).multiplyScalar(SUN_RENDER_DIST);
    sunGroupItems.disc.scale.setScalar(r);
    sunGroupItems.glow.position.copy(sunGroupItems.disc.position);
    sunGroupItems.glow.scale.setScalar(r * 22);

    // Sun direction in the Earth-fixed frame, used for day/night shading
    const fixed = sunVec.clone().applyAxisAngle(Y_AXIS, -theta);
    earthUniforms.sunDir.value.copy(fixed);
    moonLight.position.copy(fixed).multiplyScalar(50);

    const moon = A.moonEq(jd);
    moonMesh.position.copy(sphToVec3(moon.ra, moon.dec, moon.distEarthRadii));
  }

  /* ════════════════════════════════════════════════════════════
     2. CAMERA: opening animation and zoom-only controls
  ════════════════════════════════════════════════════════════ */
  let phase = 'intro';          // intro, explore
  let introStart = 0;
  let fadeStarted = false;
  let dist = START_DIST;
  let distTarget = END_DIST;

  function placeCamera(lonDeg, latDeg, d) {
    camera.position.copy(sphToVec3(lonDeg * DEG, latDeg * DEG, d));
    camera.up.set(0, 1, 0);
    camera.lookAt(0, 0, 0);
  }

  function stepIntro(now) {
    const t = clamp((now - introStart) / INTRO_MS, 0, 1);
    const e = easeInOut(t);
    // start over longitude 0, orbit one full turn, finish above the Caspian
    placeCamera(lerp(0, 360 + CASPIAN.lon, e), lerp(0, CASPIAN.lat, e), lerp(START_DIST, END_DIST, e));

    if (t > 0.78 && !fadeStarted) {
      fadeStarted = true;
      introOv.classList.add('fade-out');
      setTimeout(() => { introOv.hidden = true; }, 700);
    }
    if (t >= 1) {
      phase = 'explore';
      dist = END_DIST;
      distTarget = END_DIST;
      mainHead.hidden = false;
      toolbar.hidden = false;
      loadNisar();
    }
  }

  function setZoom(d) { distTarget = clamp(d, MIN_DIST, MAX_DIST); }

  function addZoomControls() {
    const el = renderer.domElement;

    el.addEventListener('wheel', e => {
      e.preventDefault();
      if (phase !== 'explore') return;
      setZoom(distTarget * Math.exp(e.deltaY * 0.0012));
    }, { passive: false });

    const pointers = new Map();
    let pinch = null;
    const pinchDist = () => {
      const [a, b] = [...pointers.values()];
      return Math.hypot(a.x - b.x, a.y - b.y) || 1;
    };
    el.addEventListener('pointerdown', e => {
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pointers.size === 2) pinch = { d: pinchDist(), z: distTarget };
    });
    el.addEventListener('pointermove', e => {
      if (!pointers.has(e.pointerId)) return;
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pointers.size === 2 && pinch && phase === 'explore') setZoom(pinch.z * pinch.d / pinchDist());
    });
    const release = e => {
      pointers.delete(e.pointerId);
      if (pointers.size < 2) pinch = null;
    };
    el.addEventListener('pointerup', release);
    el.addEventListener('pointercancel', release);

    window.addEventListener('keydown', e => {
      if (e.key === 'Escape') closeHistory();
      const inField = e.target && e.target.tagName === 'INPUT';
      if (phase !== 'explore' || inField) return;
      if (e.key === '+' || e.key === '=') setZoom(distTarget / 1.18);
      if (e.key === '-' || e.key === '_') setZoom(distTarget * 1.18);
    });
  }

  /* ════════════════════════════════════════════════════════════
     3. NISAR DATA (ASF search API) AND HISTORY TIMELINE
  ════════════════════════════════════════════════════════════ */
  let days = [];                // one entry per acquisition day, ascending
  let currentIdx = -1;
  let nisarState = 'idle';      // idle, loading, ready, empty, error
  let playTimer = null;
  let isPlaying = false;

  const firstBrowse = p => {
    if (Array.isArray(p.browse)) return p.browse.find(Boolean) || null;
    return typeof p.browse === 'string' ? p.browse : null;
  };
  const dayMs = iso => Date.parse(iso.slice(0, 10) + 'T00:00:00Z');
  const fmtDate = ms => new Date(ms).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });

  function groupByDay(features) {
    const map = new Map();
    for (const p of features) {
      const st = String(p.startTime || '');
      if (st.length < 10) continue;
      const key = st.slice(0, 10);
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(p);
    }
    return [...map.entries()]
      .sort((a, b) => (a[0] < b[0] ? -1 : 1))
      .map(([date, items]) => ({
        date,
        ms: dayMs(date),
        items,
        pick: items.find(firstBrowse) || items[0],
        levels: [...new Set(items.map(i => i.processingLevel).filter(Boolean))]
      }));
  }

  async function loadNisar() {
    if (nisarState === 'loading' || nisarState === 'ready') return;
    nisarState = 'loading';
    renderPanelState();

    const b = CASPIAN_BBOX;
    const wkt = `POLYGON((${b.w} ${b.s},${b.e} ${b.s},${b.e} ${b.n},${b.w} ${b.n},${b.w} ${b.s}))`;
    const url = `${ASF_BASE}?dataset=NISAR&processingLevel=GCOV,GUNW&intersectsWith=${encodeURIComponent(wkt)}&maxResults=250&output=geojson`;

    try {
      const ac = new AbortController();
      const id = setTimeout(() => ac.abort(), 15000);
      const res = await fetch(url, { signal: ac.signal });
      clearTimeout(id);
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const json = await res.json();
      days = groupByDay((json.features || []).map(f => f.properties || {}));
      nisarState = days.length ? 'ready' : 'empty';
    } catch (e) {
      days = [];
      nisarState = 'error';
    }

    if (nisarState === 'ready') {
      buildTimeline();
      selectDay(days.length - 1);
      setStatus(`${days.length} NISAR acquisition dates found over the Caspian Sea`, 4000);
    } else {
      renderPanelState();
      dateBadge.textContent = 'None';
      dateRange.disabled = true;
      playBtn.disabled = true;
    }
  }

  function setEmpty(icon, title, body) {
    emptyIcon.className = 'ph ' + icon;
    emptyTitle.textContent = title;
    emptyBody.textContent = body;
    nisarImg.removeAttribute('src');
    nisarImg.hidden = true;
    nisarNoImg.hidden = false;
  }

  function renderPanelState() {
    if (nisarState === 'loading') {
      nisarDL.textContent = 'Searching';
      nisarType.textContent = 'ASF archive';
      setEmpty('ph-circle-notch', 'Searching the ASF archive', 'Looking for NISAR products over the Caspian Sea.');
    } else if (nisarState === 'empty') {
      nisarDL.textContent = 'None found';
      nisarType.textContent = 'No product';
      setEmpty('ph-magnifying-glass', 'No NISAR products found', 'The archive has no GCOV or GUNW products for this area yet. Check back after the next data release.');
    } else if (nisarState === 'error') {
      nisarDL.textContent = 'Unavailable';
      nisarType.textContent = 'No product';
      setEmpty('ph-warning', 'Could not reach the ASF archive', 'The search failed or was blocked by the browser. Reload the page to try again.');
    }
  }

  function buildTimeline() {
    const t0 = days[0].ms;
    const span = Math.max(1, (days[days.length - 1].ms - t0) / DAY_MS);
    days.forEach(d => { d.offset = (d.ms - t0) / DAY_MS; });

    dateRange.min = 0;
    dateRange.max = span;
    dateRange.step = 1;
    dateRange.disabled = days.length < 2;
    playBtn.disabled = days.length < 2;

    tickMarks.replaceChildren();
    days.forEach(d => {
      const t = document.createElement('span');
      t.className = 'tick';
      t.style.setProperty('--p', (d.offset / span).toFixed(5));
      tickMarks.appendChild(t);
      d.el = t;
    });
    buildLabels(span);
  }

  function buildLabels(span) {
    tickLabels.replaceChildren();
    const t0 = days[0].ms;
    const t1 = days[days.length - 1].ms;
    const longSpan = span > 540;
    const marks = [];
    const cur = new Date(Date.UTC(new Date(t0).getUTCFullYear(), new Date(t0).getUTCMonth() + 1, 1));
    while (cur.getTime() <= t1) {
      const jan = cur.getUTCMonth() === 0;
      if (!longSpan || jan) {
        marks.push({
          ms: cur.getTime(),
          text: longSpan
            ? String(cur.getUTCFullYear())
            : cur.toLocaleDateString('en-GB', jan ? { month: 'short', year: 'numeric', timeZone: 'UTC' } : { month: 'short', timeZone: 'UTC' })
        });
      }
      cur.setUTCMonth(cur.getUTCMonth() + 1);
    }
    let use = marks;
    if (marks.length > 6) {
      const k = Math.ceil(marks.length / 6);
      use = marks.filter((_, i) => i % k === 0);
    }
    if (!use.length) {
      use = days.length > 1
        ? [{ ms: t0, text: fmtDate(t0) }, { ms: t1, text: fmtDate(t1) }]
        : [{ ms: t0, text: fmtDate(t0) }];
    }
    for (const m of use) {
      const s = document.createElement('span');
      s.textContent = m.text;
      s.style.setProperty('--p', t1 > t0 ? ((m.ms - t0) / (t1 - t0)).toFixed(5) : '0');
      tickLabels.appendChild(s);
    }
  }

  function selectDay(idx) {
    if (!days.length) return;
    idx = clamp(idx, 0, days.length - 1);
    currentIdx = idx;
    const d = days[idx];
    dateRange.value = d.offset;

    days.forEach((x, i) => x.el && x.el.classList.toggle('is-selected', i === idx));

    dateBadge.textContent = fmtDate(d.ms);
    nisarDL.textContent = fmtDate(d.ms);
    nisarType.textContent = `${d.levels.join(', ') || 'NISAR'} (${d.items.length})`;

    const p = d.pick;
    const name = p.granuleName || p.sceneName || p.fileID;
    nisarLink.href = name ? `${VERTEX_URL}#/?granule=${encodeURIComponent(name)}` : VERTEX_URL;

    const url = firstBrowse(p);
    if (!url) {
      setEmpty('ph-image', 'No browse image for this date', 'This product has no preview. Open it in ASF Vertex to see its footprint, or pick another date.');
      return;
    }
    nisarNoImg.hidden = true;
    nisarImg.hidden = false;
    nisarImg.onerror = () => setEmpty('ph-image', 'The preview did not load', 'The archive may require an Earthdata login for this preview. Open it in ASF Vertex.');
    nisarImg.src = url;
  }

  dateRange.addEventListener('input', () => {
    if (!days.length) return;
    const v = +dateRange.value;
    let best = 0, bd = Infinity;
    days.forEach((d, i) => {
      const dd = Math.abs(d.offset - v);
      if (dd < bd) { bd = dd; best = i; }
    });
    selectDay(best);          // snaps the thumb to the nearest real acquisition
  });

  /* ── Open / close the history bar (button at the top) ── */
  function openHistory() {
    timeline.hidden = false;
    nisarPanel.hidden = false;
    historyBtn.setAttribute('aria-expanded', 'true');
    historyBtn.classList.add('is-active');
    if (nisarState === 'idle') loadNisar(); else if (nisarState !== 'ready') renderPanelState();
  }
  function closeHistory() {
    stopPlay();
    timeline.hidden = true;
    nisarPanel.hidden = true;
    historyBtn.setAttribute('aria-expanded', 'false');
    historyBtn.classList.remove('is-active');
  }
  historyBtn.addEventListener('click', () => (timeline.hidden ? openHistory() : closeHistory()));
  historyClose.addEventListener('click', closeHistory);

  /* ── Play / pause through the acquisition dates ── */
  playBtn.addEventListener('click', () => (isPlaying ? stopPlay() : startPlay()));
  function startPlay() {
    if (days.length < 2) return;
    isPlaying = true;
    playIcon.hidden = true;
    pauseIcon.hidden = false;
    stepPlay();
  }
  function stopPlay() {
    isPlaying = false;
    playIcon.hidden = false;
    pauseIcon.hidden = true;
    clearTimeout(playTimer);
  }
  function stepPlay() {
    if (!isPlaying) return;
    selectDay((currentIdx + 1) % days.length);
    playTimer = setTimeout(stepPlay, PLAY_MS);
  }

  /* ════════════════════════════════════════════════════════════
     4. LOOP, RESIZE, BOOT
  ════════════════════════════════════════════════════════════ */
  function frame(now) {
    requestAnimationFrame(frame);
    updateSky();
    if (phase === 'intro') {
      stepIntro(now);
    } else {
      dist += (distTarget - dist) * 0.14;
      placeCamera(CASPIAN.lon, CASPIAN.lat, dist);
    }
    renderer.render(scene, camera);
  }

  window.addEventListener('resize', () => {
    W = window.innerWidth; H = window.innerHeight;
    if (!renderer) return;
    renderer.setSize(W, H);
    camera.aspect = W / H;
    camera.updateProjectionMatrix();
  });

  function boot() {
    try {
      initScene();
    } catch (e) {
      setStatus('WebGL is not available in this browser.');
      return;
    }
    addZoomControls();
    updateSky();
    placeCamera(0, 0, START_DIST);
    loadStars();
    loadMilkyWay();
    setTimeout(() => { introStart = performance.now(); requestAnimationFrame(frame); }, 400);
  }

  if (typeof THREE === 'undefined' || !A) {
    setStatus('Could not load the 3D libraries. Check your connection and reload.');
  } else {
    boot();
  }

})();
