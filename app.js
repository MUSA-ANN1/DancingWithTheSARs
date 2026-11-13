'use strict';

(function () {

  const DEG = Math.PI / 180;
  const A = window.Astro;

  const CASPIAN = { lon: 50.7, lat: 41.8 };
  const INTRO_MS = 6500;
  const START_DIST = 11;
  const END_DIST = 1.55;
  const MIN_DIST = 1.08;
  const MAX_DIST = 11;
  const PLAY_MS = 1600;
  const DAY_MS = 86400000;

  const SUN_RENDER_DIST = 600;
  const SKY_RADIUS = 2000;
  const MILKY_RADIUS = 3000;

  const VERTEX_URL = 'https://search.asf.alaska.edu/';

  const STAR_URLS = [
    'https://cdn.jsdelivr.net/gh/ofrohn/d3-celestial@master/data/stars.6.json',
    'https://raw.githubusercontent.com/ofrohn/d3-celestial/master/data/stars.6.json'
  ];
  const MW_URLS = [
    'https://dieghernan.github.io/celestial_data/data/mw.min.geojson',
    'https://cdn.jsdelivr.net/gh/ofrohn/d3-celestial@master/data/mw.json',
    'https://raw.githubusercontent.com/ofrohn/d3-celestial/master/data/mw.json'
  ];

  const $ = s => document.querySelector(s);
  const globeEl = $('#globe-container');
  const introOv = $('#intro-overlay');
  const mainHead = $('#main-head');
  const toolbar = $('#toolbar');
  const menuBtn = $('#menu-btn');
  const historyBtn = $('#history-btn');
  const menuPanel = $('#menu-panel');
  const settingsBtn = $('#settings-btn');
  const settingsClose = $('#settings-close');
  const settingsPanel = $('#settings-panel');
  const themeInputs = Array.from(document.querySelectorAll('input[name="earth-theme"]'));
  const historyClose = $('#history-close');
  const timeline = $('#timeline');
  const nisarPanel = $('#nisar-panel');
  const panelBody = $('#panel-body');
  const panelToggle = $('#panel-toggle');
  const panelReopen = $('#panel-reopen');
  const compareImg = $('#compare-img');
  const comparisonButtons = Array.from(document.querySelectorAll('.comparison-option'));
  const nisarNoImg = $('#nisar-no-img');
  const emptyIcon = $('#nisar-empty-icon');
  const emptyTitle = $('#nisar-empty-title');
  const emptyBody = $('#nisar-empty-body');
  const readoutLabel = $('#readout-label');
  const readoutDate = $('#readout-date');
  const factProduct = $('#fact-product');
  const factArea = $('#fact-area');
  const explanation = $('#comparison-explanation');
  const nisarLink = $('#nisar-link');
  const calStatus = $('#calendar-status');
  const calTitle = $('#cal-title');
  const calGrid = $('#cal-grid');
  const calPrev = $('#cal-prev');
  const calNext = $('#cal-next');
  const datePrev = $('#date-prev');
  const dateNext = $('#date-next');
  const dateList = $('#calendar-dates');
  const calEmpty = $('#calendar-empty');
  const calEmptyIcon = $('#calendar-empty-icon');
  const calEmptyTitle = $('#calendar-empty-title');
  const calEmptyBody = $('#calendar-empty-body');
  const calParts = Array.from(document.querySelectorAll('.cal-month, .cal-weekdays, #cal-grid, .cal-jump, .list-title, #calendar-dates'));
  const changeLegend = $('#change-legend');
  const changeLabel = $('#change-label');
  const statusMsg = $('#status-msg');
  const statusBar = $('#status-bar');

  let statusTimer = null;
  function setStatus(msg, ms) {
    statusMsg.textContent = msg;
    statusBar.hidden = !msg;
    clearTimeout(statusTimer);
    if (msg && ms) statusTimer = setTimeout(() => setStatus(''), ms);
  }

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

  let renderer, scene, camera, sky, sunGroupItems = {}, moonMesh, moonLight;
  const earthUniforms = {
    dayMap: { value: null },
    nightMap: { value: null },
    hasNight: { value: 1 },
    themeMode: { value: 0 },
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

    sky = new THREE.Group();
    scene.add(sky);

    buildEarth();
    buildCountryBorders();
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
    [dayCanvas, nightCanvas].forEach(c => { c.width = width; c.height = height; });
    const dayCtx = dayCanvas.getContext('2d');
    const nightCtx = nightCanvas.getContext('2d');

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

    if (!hasCountries) {
      dayCtx.fillStyle = '#2B5CB5'; dayCtx.fillRect(0, 0, width, height);
      nightCtx.fillStyle = '#020812'; nightCtx.fillRect(0, 0, width, height);
      setStatus('Country boundaries unavailable; showing a simplified globe.', 7000);
    }

    const dayTex = new THREE.CanvasTexture(dayCanvas);
    const nightTex = new THREE.CanvasTexture(nightCanvas);
    [dayTex, nightTex].forEach(tex => {
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.needsUpdate = true;
      tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
    });

    return { dayTex, nightTex, dayCanvas, nightCanvas };
  }

  async function loadInlandLakes(dayCanvas, nightCanvas, dayTex, nightTex) {

    const sources = {
      lakes: 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_10m_lakes.geojson',
      marine: 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_10m_geography_marine_polys.geojson',
      coastline: 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_10m_coastline.geojson'
    };
    const fetchGeoJSON = async (url, label) => {
      const response = await fetch(url);
      if (!response.ok) throw new Error(label + ' data request failed (' + response.status + ')');
      return response.json();
    };
    const width = dayCanvas.width, height = dayCanvas.height;
    const projection = d3.geoEquirectangular()
      .scale(width / (2 * Math.PI)).translate([width / 2, height / 2]);
    const paintGeoJSON = (canvas, geojson, fill, stroke, lineWidth, fillPolygons = true) => {
      const ctx = canvas.getContext('2d');
      const path = d3.geoPath(projection, ctx);
      ctx.save();
      ctx.beginPath();
      path(geojson);
      if (fillPolygons && fill) {
        ctx.fillStyle = fill;
        ctx.fill();
      }
      if (stroke) {
        ctx.strokeStyle = stroke;
        ctx.lineWidth = lineWidth;
        ctx.stroke();
      }
      ctx.restore();
    };

    const [lakes, marine, coastline] = await Promise.all([
      fetchGeoJSON(sources.lakes, 'Lake').catch(error => { console.warn('Lake layer unavailable:', error); return null; }),
      fetchGeoJSON(sources.marine, 'Marine-area').catch(error => { console.warn('Marine-area layer unavailable:', error); return null; }),
      fetchGeoJSON(sources.coastline, 'Coastline').catch(error => { console.warn('Coastline layer unavailable:', error); return null; })
    ]);

    if (marine) {

      paintGeoJSON(dayCanvas, marine, '#0B2863', '#123B78', 1.0, true);
      paintGeoJSON(nightCanvas, marine, '#031020', '#104080', 1.0, true);
    }
    if (lakes) {
      paintGeoJSON(dayCanvas, lakes, '#0B2B68', '#12365F', 1.4, true);
      paintGeoJSON(nightCanvas, lakes, '#0D1F38', '#10479C', 1.4, true);
    }
    if (coastline) {

      paintGeoJSON(dayCanvas, coastline, null, 'rgba(35, 83, 145, 0.72)', 1.0, false);
      paintGeoJSON(nightCanvas, coastline, null, 'rgba(18, 76, 156, 0.68)', 1.0, false);
    }
    dayTex.needsUpdate = true;
    nightTex.needsUpdate = true;
  }

  function buildEarth() {
    earthUniforms.dayMap.value = placeholderTexture(10, 30, 70);
    earthUniforms.nightMap.value = placeholderTexture(0, 0, 0);
    const textures = makeVectorEarthTextures();
    earthUniforms.dayMap.value = textures.dayTex;
    earthUniforms.nightMap.value = textures.nightTex;
    loadInlandLakes(textures.dayCanvas, textures.nightCanvas, textures.dayTex, textures.nightTex);

    const mat = new THREE.ShaderMaterial({
      uniforms: earthUniforms,
      vertexShader: `
        varying vec3 vN; varying vec2 vUv; varying vec3 vP;
        void main() {
          vUv = uv; vN = normalize(normal); vP = position;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: `
        uniform sampler2D dayMap; uniform sampler2D nightMap;
        uniform float hasNight; uniform float themeMode; uniform vec3 sunDir;
        varying vec3 vN; varying vec2 vUv; varying vec3 vP;
        void main() {
          vec3 n = normalize(vN);
          vec3 s = normalize(sunDir);
          float d = dot(n, s);
          float dayMix = smoothstep(-0.10, 0.13, d);
          vec3 day = texture2D(dayMap, vUv).rgb;
          vec3 night = texture2D(nightMap, vUv).rgb;
          vec3 dayCol = day * (0.30 + 0.90 * max(d, 0.0));
          vec3 nightCol = night;
          vec3 col = mix(nightCol, dayCol, dayMix);
          float twilight = smoothstep(-0.18, -0.02, d) * (1.0 - dayMix);
          col += vec3(0.04, 0.08, 0.16) * twilight;

          vec3 v = normalize(cameraPosition - vP);
          float rim = pow(1.0 - max(dot(n, v), 0.0), 3.0);
          if (themeMode < 0.5) {
            col += vec3(0.04, 0.20, 0.48) * rim * 0.38 * clamp(d + 0.35, 0.0, 1.0);
          }
          gl_FragColor = vec4(col, 1.0);
        }`
    });
    scene.add(new THREE.Mesh(new THREE.SphereGeometry(1, 128, 96), mat));
    buildCaspianHighlight();
  }
  function buildCountryBorders() {

    if (typeof WORLD === 'undefined' || !window.topojson) return;

    const mesh = topojson.mesh(WORLD, WORLD.objects.countries, (a, b) => a !== b);
    const positions = [];
    const radius = 1.003;

    for (const line of (mesh.coordinates || [])) {
      for (let i = 1; i < line.length; i++) {
        const [lonA, latA] = line[i - 1];
        const [lonB, latB] = line[i];
        const a = sphToVec3(lonA * DEG, latA * DEG, radius);
        const b = sphToVec3(lonB * DEG, latB * DEG, radius);
        positions.push(a.x, a.y, a.z, b.x, b.y, b.z);
      }
    }

    if (!positions.length) return;
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    const borders = new THREE.LineSegments(
      geometry,
      new THREE.LineBasicMaterial({
        color: 0x071A3A,
        transparent: true,
        opacity: 0.88,
        depthTest: true,
        depthWrite: false
      })
    );
    borders.renderOrder = 4;
    scene.add(borders);
  }

  function buildCaspianHighlight() {

    const shore = window.CASPIAN_SHORELINE || [
      [47.0, 48.0], [49.4, 47.2], [51.8, 46.8], [53.5, 45.8],
      [53.9, 44.2], [53.2, 42.5], [52.8, 40.7], [52.1, 39.0],
      [51.5, 37.8], [50.1, 36.7], [49.0, 37.2], [48.5, 38.6],
      [48.0, 40.0], [47.3, 41.2], [46.7, 42.8], [47.0, 44.2],
      [48.0, 45.4], [48.2, 46.6]
    ];

    const seaShape = new THREE.Shape();
    seaShape.moveTo(shore[0][0], shore[0][1]);
    for (let i = 1; i < shore.length; i++) {
      seaShape.lineTo(shore[i][0], shore[i][1]);
    }
    seaShape.closePath();

    const fillGeometry = new THREE.ShapeGeometry(seaShape, 2);
    const positions = fillGeometry.attributes.position;
    const vertex = new THREE.Vector3();
    for (let i = 0; i < positions.count; i++) {
      vertex.set(positions.getX(i), positions.getY(i), 0);
      const p = sphToVec3(vertex.x * DEG, vertex.y * DEG, 1.006);
      positions.setXYZ(i, p.x, p.y, p.z);
    }
    positions.needsUpdate = true;
    fillGeometry.computeVertexNormals();

    const fill = new THREE.Mesh(
      fillGeometry,
      new THREE.MeshBasicMaterial({
        color: 0x0B3D91,
        transparent: true,
        opacity: 0.72,
        side: THREE.DoubleSide,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -2
      })
    );
    fill.renderOrder = 10;
    fill.material.depthTest = false;
    scene.add(fill);

    const borderPositions = [];
    for (let i = 0; i < shore.length; i++) {
      const a = shore[i];
      const b = shore[(i + 1) % shore.length];
      const p1 = sphToVec3(a[0] * DEG, a[1] * DEG, 1.003);
      const p2 = sphToVec3(b[0] * DEG, b[1] * DEG, 1.003);
      borderPositions.push(p1.x, p1.y, p1.z, p2.x, p2.y, p2.z);
    }

    const borderGeometry = new THREE.BufferGeometry();
    borderGeometry.setAttribute(
      'position',
      new THREE.Float32BufferAttribute(borderPositions, 3)
    );
    const outline = new THREE.LineSegments(
      borderGeometry,
      new THREE.LineBasicMaterial({
        color: 0x071A3A,
        transparent: true,
        opacity: 0.88,
        depthTest: true,
        depthWrite: false
      })
    );
    outline.renderOrder = 4;
    scene.add(outline);
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

  async function fetchJSON(urls, timeoutMs) {
    for (const url of urls) {
      try {
        const ac = new AbortController();
        const id = setTimeout(() => ac.abort(), timeoutMs || 20000);
        const res = await fetch(url, { signal: ac.signal });
        clearTimeout(id);
        if (res.ok) return await res.json();
      } catch (e) {  }
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
    const w = 0.5;
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

  const Y_AXIS = new THREE.Vector3(0, 1, 0);

  function updateSky() {
    const jd = A.julianDate(Date.now());
    const theta = A.gmst(jd);
    sky.rotation.y = -theta;

    const sun = A.sunEq(jd);
    const sunVec = sphToVec3(sun.ra, sun.dec, 1);

    const angRadius = (0.2666 * DEG) / sun.au;
    const r = SUN_RENDER_DIST * Math.tan(angRadius);
    sunGroupItems.disc.position.copy(sunVec).multiplyScalar(SUN_RENDER_DIST);
    sunGroupItems.disc.scale.setScalar(r);
    sunGroupItems.glow.position.copy(sunGroupItems.disc.position);
    sunGroupItems.glow.scale.setScalar(r * 22);

    const fixed = sunVec.clone().applyAxisAngle(Y_AXIS, -theta);
    const theme = earthUniforms.themeMode.value;
    if (theme > 0.5 && theme < 1.5) {
      earthUniforms.sunDir.value.copy(sphToVec3(CASPIAN.lon * DEG, CASPIAN.lat * DEG, 1)).normalize();
    } else if (theme >= 1.5) {
      earthUniforms.sunDir.value.copy(sphToVec3(CASPIAN.lon * DEG, CASPIAN.lat * DEG, 1)).normalize().negate();
    } else {
      earthUniforms.sunDir.value.copy(fixed);
    }
    moonLight.position.copy(fixed).multiplyScalar(50);

    const moon = A.moonEq(jd);
    moonMesh.position.copy(sphToVec3(moon.ra, moon.dec, moon.distEarthRadii));
  }

  let phase = 'intro';
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
      showMainUI();
    }
  }

  function setZoom(d) { distTarget = clamp(d, MIN_DIST, MAX_DIST); }

  const THEME_STORAGE_KEY = 'dancing-with-the-sars-earth-theme';
  function setEarthTheme(theme, persist = true) {
    const modes = { default: 0, light: 1, dark: 2 };
    if (!(theme in modes)) theme = 'default';
    earthUniforms.themeMode.value = modes[theme];
    themeInputs.forEach(input => { input.checked = input.value === theme; });
    document.documentElement.dataset.earthTheme = theme;
    if (persist) {
      try { localStorage.setItem(THEME_STORAGE_KEY, theme); } catch (_) {}
    }
  }
  function closeMenu() {
    menuPanel.hidden = true;
    menuBtn.setAttribute('aria-expanded', 'false');
  }
  function closeSettings() {
    settingsPanel.hidden = true;
    settingsBtn.setAttribute('aria-expanded', 'false');
  }
  menuBtn.addEventListener('click', () => {
    const opening = menuPanel.hidden;
    closeSettings();
    menuPanel.hidden = !opening;
    menuBtn.setAttribute('aria-expanded', String(opening));
  });
  settingsBtn.addEventListener('click', () => {
    closeMenu();
    closeHistory();
    settingsPanel.hidden = !settingsPanel.hidden;
    settingsBtn.setAttribute('aria-expanded', String(!settingsPanel.hidden));
  });
  settingsClose.addEventListener('click', closeSettings);
  themeInputs.forEach(input => input.addEventListener('change', () => {
    if (input.checked) setEarthTheme(input.value);
  }));
  document.addEventListener('click', event => {
    if (!event.target.closest('#toolbar') && !event.target.closest('#settings-panel')) {
      closeMenu();
      closeSettings();
    }
  });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape') { closeMenu(); closeSettings(); }
  });
  try { setEarthTheme(localStorage.getItem(THEME_STORAGE_KEY) || 'default', false); }
  catch (_) { setEarthTheme('default', false); }

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


  // ---------------------------------------------------------------------
  // Processed data (data branch). Layout, as published by server/caspian_mosaic.py:
  //   regions/caspian-sea/index.json              region-level pair index { pairs: [{ id, folder, before, after, pol, updated, images }] }
  //   regions/caspian-sea/pairs/<id>/meta.json    per-pair metadata (windows, stats, bbox, images)
  //   regions/caspian-sea/pairs/<id>/*.png        per-pair images, file names from meta.images
  //   regions/caspian-sea/meta.json               newest pair only, kept for backward compatibility
  const REGION_ID = 'caspian-sea';
  const REGION_BASE = 'https://raw.githubusercontent.com/MUSA-ANN1/DancingWithTheSARs/data/regions/' + REGION_ID + '/';
  const DATA_TREE = 'https://github.com/MUSA-ANN1/DancingWithTheSARs/tree/data/regions/' + REGION_ID + '/';
  const ACCENT_RGB = [252, 61, 33];

  const compareFigure = $('#compare-figure');
  const compareBar = $('.compare-bar');
  const readoutEl = $('.readout');
  const factsEl = $('.facts');
  const pairBtn = $('#pair-btn');
  const pairBtnLabel = $('#pair-btn-label');
  const datasetTabs = Array.from(document.querySelectorAll('.dataset-tab'));
  const datasetPlaceholder = $('#dataset-placeholder');
  const placeholderTitle = $('#dataset-placeholder-title');
  const placeholderBody = $('#dataset-placeholder-body');

  let pairs = [];                            // date pairs, oldest first (by after date, then before date)
  let pairIdx = -1;                          // selected pair
  let meta = null;                           // meta.json of the selected pair
  const metaCache = new Map();               // pair folder -> meta.json
  let dayPairs = new Map();                  // UTC day ms -> indices of pairs that start or end on that day
  let mosaicSide = 'before';
  let pairsState = 'idle';
  let calYear = new Date().getUTCFullYear();
  let calMonth = new Date().getUTCMonth();
  let imgToken = 0;
  let selectToken = 0;

  const ISO_RE = /^\d{4}-\d{2}-\d{2}$/;
  const isoDay = v => (typeof v === 'string' && ISO_RE.test(v.slice(0, 10)) && Number.isFinite(Date.parse(v.slice(0, 10) + 'T00:00:00Z'))) ? v.slice(0, 10) : null;
  const dayMs = iso => Date.parse(String(iso).slice(0, 10) + 'T00:00:00Z');
  const fmtDate = ms => new Date(ms).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
  const fmtIso = iso => fmtDate(dayMs(iso));
  const num = n => Number(n).toLocaleString('en-GB');

  function fmtRange(a, b) {
    if (!a) return 'No date yet';
    if (!b || a === b) return fmtIso(a);
    const da = new Date(dayMs(a)), db = new Date(dayMs(b));
    const part = d => d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
    return da.getUTCFullYear() === db.getUTCFullYear()
      ? `${part(da)} to ${part(db)} ${db.getUTCFullYear()}`
      : `${fmtIso(a)} to ${fmtIso(b)}`;
  }

  function fmtArea(b) {
    const f = v => Number(v).toFixed(1);
    return `${f(b[0])} to ${f(b[2])}°E, ${f(b[1])} to ${f(b[3])}°N`;
  }

  // Only relative folders / plain file names from the data branch are followed.
  function safeFolder(f) {
    if (f === '' || f === undefined || f === null) return '';
    if (typeof f !== 'string' || f.includes('..') || !/^[A-Za-z0-9_\-./]+$/.test(f) || f.startsWith('/')) return null;
    return f.endsWith('/') ? f : f + '/';
  }
  const safeFile = name => (typeof name === 'string' && /^[A-Za-z0-9_\-.]+$/.test(name) && !name.includes('..')) ? name : null;

  function normalizePair(p) {
    if (!p || typeof p !== 'object') return null;
    const before = isoDay(p.before), after = isoDay(p.after), folder = safeFolder(p.folder);
    if (!before || !after || folder === null) return null;
    return {
      id: String(p.id || folder || 'latest'),
      folder,
      before,
      after,
      pol: typeof p.pol === 'string' ? p.pol : null,
      images: (p.images && typeof p.images === 'object') ? p.images : {}
    };
  }
  const pairBase = pair => REGION_BASE + pair.folder;
  function imageFile(pair, pairMeta, key) {
    return safeFile(pairMeta && pairMeta.images && pairMeta.images[key])
      || safeFile(pair.images[key])
      || key + '.png';
  }

  function paintEmpty(icon, title, body) {
    emptyIcon.className = 'ph ' + icon;
    emptyTitle.textContent = title;
    emptyBody.textContent = body;
    compareImg.hidden = true;
    nisarNoImg.hidden = false;
  }
  function setPanelEmpty(icon, title, body) {
    imgToken++;
    compareImg.removeAttribute('src');
    paintEmpty(icon, title, body);
  }
  function setPanelImage(url, alt) {
    const token = ++imgToken;
    compareImg.alt = alt;
    if (compareImg.hidden) paintEmpty('ph-circle-notch', 'Loading image', 'Fetching the radar preview.');
    compareImg.onload = () => {
      if (token !== imgToken) return;
      nisarNoImg.hidden = true;
      compareImg.hidden = false;
    };
    compareImg.onerror = () => {
      if (token !== imgToken) return;
      paintEmpty('ph-warning', 'This image did not load',
        'The server may be updating. Try again in a minute, or pick another date pair.');
    };
    compareImg.src = url;
  }

  // Slide the comparison panel off-canvas while keeping its arrow handle reachable.
  function setPanelCollapsed(collapsed) {
    nisarPanel.classList.toggle('is-collapsed', collapsed);
    panelReopen.hidden = !collapsed;
    panelToggle.setAttribute('aria-expanded', String(!collapsed));
    panelToggle.setAttribute('aria-label', collapsed ? 'Show comparison panel' : 'Hide comparison panel');
    panelToggle.querySelector('i').className = 'ph ' + (collapsed ? 'ph-caret-right' : 'ph-caret-left');
  }
  panelReopen.addEventListener('click', event => {
    event.preventDefault();
    event.stopPropagation();
    setPanelCollapsed(false);
  });
  panelToggle.addEventListener('click', event => {
    event.preventDefault();
    event.stopPropagation();
    const isClosed = nisarPanel.classList.contains('is-collapsed');
    setPanelCollapsed(!isClosed);
  });

  // Dataset tabs. GRACE-FO and Sentinel-2 are UI placeholders until their data is supplied.
  function setDataset(name) {
    const tab = datasetTabs.find(t => t.dataset.dataset === name) || datasetTabs[0];
    datasetTabs.forEach(t => {
      const on = t === tab;
      t.classList.toggle('is-active', on);
      t.setAttribute('aria-selected', String(on));
      t.tabIndex = on ? 0 : -1;
    });
    const isNisar = tab.dataset.dataset === 'nisar';
    [compareFigure, compareBar, readoutEl, factsEl, explanation, nisarLink].forEach(el => { el.hidden = !isNisar; });
    datasetPlaceholder.hidden = isNisar;
    if (!isNisar) {
      const label = tab.dataset.label || tab.textContent.trim();
      placeholderTitle.textContent = `${label} data not added yet`;
      placeholderBody.textContent = `${label} will be connected to this comparison later. No ${label} observations are shown yet.`;
      closeHistory();
    }
  }
  datasetTabs.forEach((tab, i) => {
    tab.addEventListener('click', () => setDataset(tab.dataset.dataset));
    tab.addEventListener('keydown', e => {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      e.preventDefault();
      e.stopPropagation();
      const next = datasetTabs[(i + (e.key === 'ArrowRight' ? 1 : -1) + datasetTabs.length) % datasetTabs.length];
      next.focus();
      setDataset(next.dataset.dataset);
    });
  });

  function mosaicText() {
    const base = 'NISAR radar backscatter over the Caspian basin, merged from repeat passes. Dark is smooth water, bright is rougher surface.';
    if (!meta) return base;
    const s = meta.stats || {};
    const db = (s.confidence_rules && s.confidence_rules.minimum_temporal_difference_db) || 3;
    const n = (s.retreat_candidate_pixels || 0) + (s.advance_candidate_pixels || 0);
    const change = n > 0
      ? ` Red marks ${num(n)} shoreline pixels that changed by ${db} dB or more.`
      : ` No shoreline pixels changed by ${db} dB or more.`;
    return base + change + ' Screening result, not a confirmed shoreline change.';
  }

  function showMosaic(side) {
    mosaicSide = side;
    comparisonButtons.forEach(b => {
      const on = b.dataset.image === side;
      b.classList.toggle('is-active', on);
      b.setAttribute('aria-pressed', String(on));
    });
    readoutLabel.textContent = side === 'before' ? 'Before' : 'After';
    const pair = pairs[pairIdx];
    nisarLink.href = DATA_TREE + (pair ? pair.folder : '');
    explanation.textContent = mosaicText();
    markSelection();

    if (!meta || !pair) {
      readoutDate.textContent = 'No date yet';
      setPanelEmpty('ph-warning', 'Comparison not available',
        'The processed radar mosaics could not be reached. Reload the page in a minute.');
      return;
    }
    const win = side === 'before' ? meta.before_date_window : meta.after_date_window;
    const one = (side === 'before' ? meta.before : meta.after) || pair[side];
    readoutDate.textContent = Array.isArray(win) && win.length >= 2 ? fmtRange(win[0], win[1]) : fmtRange(one);
    factProduct.textContent = ['GitHub processed GCOV', meta.pol].filter(Boolean).join(' · ');
    factArea.textContent = Array.isArray(meta.bbox) ? fmtArea(meta.bbox) : 'Caspian Sea basin';
    setPanelImage(pairBase(pair) + imageFile(pair, meta, side),
      `GitHub-processed NISAR radar mosaic of the Caspian Sea, ${side} composite of the ${fmtRange(pair.before, pair.after)} pair`);
  }
  comparisonButtons.forEach(b => b.addEventListener('click', () => {
    if (pairIdx < 0) return showMosaic(b.dataset.image);
    selectPair(pairIdx, b.dataset.image);
  }));

  async function loadPairIndex() {
    let list = null;
    const index = await fetchJSON([REGION_BASE + 'index.json']);
    if (index && Array.isArray(index.pairs)) list = index.pairs;
    if (!list || !list.length) {
      // Backward compatibility: the region-level meta.json holds the newest pair
      // and, in the new layout, an available_pairs copy of the index.
      const root = await fetchJSON([REGION_BASE + 'meta.json']);
      if (root && Array.isArray(root.available_pairs) && root.available_pairs.length) {
        list = root.available_pairs;
      } else if (root && root.before && root.after) {
        list = [{ id: root.pair_id || 'latest', folder: '', before: root.before, after: root.after, pol: root.pol, images: root.images }];
        metaCache.set('', root);
      }
    }
    const seen = new Set();
    pairs = (list || [])
      .map(normalizePair)
      .filter(p => p && !seen.has(p.folder) && seen.add(p.folder))
      .sort((a, b) => a.after.localeCompare(b.after) || a.before.localeCompare(b.before));
    dayPairs = new Map();
    pairs.forEach((p, i) => {
      [p.before, p.after].forEach(iso => {
        const ms = dayMs(iso);
        const arr = dayPairs.get(ms) || [];
        if (!arr.includes(i)) arr.push(i);
        dayPairs.set(ms, arr);
      });
    });
  }

  async function loadPairMeta(pair) {
    if (metaCache.has(pair.folder)) return metaCache.get(pair.folder);
    const m = await fetchJSON([pairBase(pair) + 'meta.json']);
    if (m && typeof m === 'object') { metaCache.set(pair.folder, m); return m; }
    return null;
  }

  async function selectPair(idx, side) {
    if (!pairs.length) return;
    idx = clamp(idx, 0, pairs.length - 1);
    const token = ++selectToken;
    const changedPair = idx !== pairIdx;
    pairIdx = idx;
    if (side) mosaicSide = side;
    const pair = pairs[idx];
    pairBtnLabel.textContent = fmtRange(pair.before, pair.after);
    calYear = new Date(dayMs(pair[mosaicSide])).getUTCFullYear();
    calMonth = new Date(dayMs(pair[mosaicSide])).getUTCMonth();
    if (panelBody.hidden && !timeline.hidden) setPanelCollapsed(false);

    meta = metaCache.get(pair.folder) || null;
    if (!meta) {
      markSelection();
      readoutLabel.textContent = mosaicSide === 'before' ? 'Before' : 'After';
      readoutDate.textContent = fmtIso(pair[mosaicSide]);
      setPanelEmpty('ph-circle-notch', 'Loading date pair', 'Reading the processing details for this date pair.');
      const loaded = await loadPairMeta(pair);
      if (token !== selectToken) return;
      meta = loaded;
      if (!meta) setStatus('This date pair could not be loaded.', 6000);
    }
    showMosaic(mosaicSide);
    if (changedPair || !changeMesh) updateChangeOverlay();
    const row = dateList.querySelector(`.date-row[data-idx="${idx}"]`);
    if (row && !timeline.hidden) row.scrollIntoView({ block: 'nearest' });
  }

  // Calendar day: a day may end one pair and start the next. Keep the selected
  // pair when it contains the day, otherwise open the newest pair that does.
  function selectDate(ms) {
    const list = dayPairs.get(ms);
    if (!list || !list.length) return;
    const iso = new Date(ms).toISOString().slice(0, 10);
    const idx = list.includes(pairIdx) ? pairIdx : Math.max(...list);
    const pair = pairs[idx];
    selectPair(idx, pair.before === iso ? 'before' : 'after');
  }

  
  let changeMesh = null;
  let overlayToken = 0;

  function clearChangeOverlay() {
    if (!changeMesh) return;
    scene.remove(changeMesh);
    changeMesh.geometry.dispose();
    if (changeMesh.material.map) changeMesh.material.map.dispose();
    changeMesh.material.dispose();
    changeMesh = null;
  }

  function updateChangeOverlay() {
    const token = ++overlayToken;
    const pair = pairs[pairIdx];
    if (!meta || !pair || !Array.isArray(meta.bbox)) {
      clearChangeOverlay();
      changeLegend.hidden = true;
      return;
    }
    const bbox = meta.bbox.slice(0, 4);
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      if (token !== overlayToken) return;
      clearChangeOverlay();
      try { buildChangeOverlay(img, bbox); }
      catch (e) { setStatus('The change layer could not be drawn.', 6000); }
    };
    img.onerror = () => {
      if (token !== overlayToken) return;
      clearChangeOverlay();
      changeLegend.hidden = true;
      setStatus('The change layer could not be loaded.', 6000);
    };
    img.src = pairBase(pair) + imageFile(pair, meta, 'change');
  }

  function buildChangeOverlay(img, bbox) {
    const w = img.naturalWidth, h = img.naturalHeight;
    const src = document.createElement('canvas');
    src.width = w; src.height = h;
    const sx = src.getContext('2d', { willReadFrequently: true });
    sx.drawImage(img, 0, 0);
    const px = sx.getImageData(0, 0, w, h);
    let changed = 0;
    for (let i = 0; i < px.data.length; i += 4) {
      const on = px.data[i + 3] > 0;
      if (on) changed++;
      
      px.data[i] = ACCENT_RGB[0]; px.data[i + 1] = ACCENT_RGB[1]; px.data[i + 2] = ACCENT_RGB[2];
      px.data[i + 3] = on ? 255 : 0;
    }
    sx.putImageData(px, 0, 0);

    changeLegend.hidden = false;
    changeLegend.classList.toggle('is-empty', changed === 0);
    changeLabel.textContent = changed ? 'Change' : 'No change detected';
    if (!changed) return;

    
    const out = document.createElement('canvas');
    out.width = w; out.height = h;
    const ox = out.getContext('2d');
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) ox.drawImage(src, dx, dy);

    const tex = new THREE.CanvasTexture(out);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = renderer.capabilities.getMaxAnisotropy();

    
    const [west, south, east, north] = bbox;
    const nx = 96, ny = 128;
    const pos = new Float32Array((nx + 1) * (ny + 1) * 3);
    const uv = new Float32Array((nx + 1) * (ny + 1) * 2);
    let k = 0, m = 0;
    for (let j = 0; j <= ny; j++) {
      const lat = north - (north - south) * (j / ny);
      for (let i = 0; i <= nx; i++) {
        const lon = west + (east - west) * (i / nx);
        const p = sphToVec3(lon * DEG, lat * DEG, 1.009);
        pos[k++] = p.x; pos[k++] = p.y; pos[k++] = p.z;
        uv[m++] = i / nx; uv[m++] = 1 - j / ny;
      }
    }
    const idx = [];
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        const a = j * (nx + 1) + i, b = a + 1, c = a + nx + 1, d = c + 1;
        idx.push(a, c, b, b, c, d);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    geo.setIndex(idx);
    changeMesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
      map: tex, transparent: true, depthWrite: false, side: THREE.DoubleSide,
      polygonOffset: true, polygonOffsetFactor: -4
    }));
    changeMesh.renderOrder = 12;
    changeMesh.frustumCulled = false;
    scene.add(changeMesh);
  }

  
  function showCalendarState(kind, title, body) {
    const empty = !!kind;
    calParts.forEach(el => { el.hidden = empty; });
    calEmpty.hidden = !empty;
    if (!empty) return;
    calEmptyIcon.className = 'ph ' + (kind === 'loading' ? 'ph-circle-notch' : kind === 'error' ? 'ph-warning' : 'ph-magnifying-glass');
    calEmptyTitle.textContent = title;
    calEmptyBody.textContent = body;
  }

  function renderCalendar() {
    if (!pairs.length) return;
    const first = new Date(Date.UTC(calYear, calMonth, 1));
    calTitle.textContent = first.toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' });
    const lead = (first.getUTCDay() + 6) % 7;                       
    const count = new Date(Date.UTC(calYear, calMonth + 1, 0)).getUTCDate();
    const pair = pairs[pairIdx];
    const selected = pair ? [dayMs(pair.before), dayMs(pair.after)] : [];
    calGrid.replaceChildren();
    for (let i = 0; i < lead; i++) {
      const blank = document.createElement('span');
      blank.className = 'cal-blank';
      calGrid.appendChild(blank);
    }
    for (let d = 1; d <= count; d++) {
      const ms = Date.UTC(calYear, calMonth, d);
      const list = dayPairs.get(ms);
      const cell = document.createElement('button');
      cell.type = 'button';
      cell.className = 'cal-day';
      cell.textContent = String(d);
      if (!list) {
        cell.disabled = true;
        cell.setAttribute('aria-label', `${fmtDate(ms)}, no data`);
      } else {
        cell.classList.add('has-data');
        cell.setAttribute('aria-label', `${fmtDate(ms)}, NISAR date pair ${list.length > 1 ? 'dates' : 'date'} available`);
        cell.setAttribute('aria-pressed', String(selected.includes(ms)));
        cell.addEventListener('click', () => selectDate(ms));
      }
      calGrid.appendChild(cell);
    }
    const earliest = Math.min(...pairs.map(p => dayMs(p.before)));
    const firstMonth = new Date(earliest);
    const key = calYear * 12 + calMonth;
    calPrev.disabled = key <= firstMonth.getUTCFullYear() * 12 + firstMonth.getUTCMonth();
    const now = new Date();
    const currentMonthKey = now.getUTCFullYear() * 12 + now.getUTCMonth();
    calNext.disabled = key >= currentMonthKey;
  }

  function shiftMonth(delta) {
    const d = new Date(Date.UTC(calYear, calMonth + delta, 1));
    calYear = d.getUTCFullYear();
    calMonth = d.getUTCMonth();
    renderCalendar();
  }
  calPrev.addEventListener('click', () => shiftMonth(-1));
  calNext.addEventListener('click', () => shiftMonth(1));

  function buildList() {
    dateList.replaceChildren();
    for (let i = pairs.length - 1; i >= 0; i--) {
      const p = pairs[i];
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'date-row';
      row.dataset.idx = String(i);
      const when = document.createElement('span');
      when.textContent = fmtRange(p.before, p.after);
      const count = document.createElement('span');
      count.className = 'count';
      count.textContent = p.pol || 'GCOV';
      row.append(when, count);
      row.addEventListener('click', () => selectPair(i, mosaicSide));
      dateList.appendChild(row);
    }
  }

  function markSelection() {
    dateList.querySelectorAll('.date-row').forEach(row => {
      row.setAttribute('aria-pressed', String(Number(row.dataset.idx) === pairIdx));
    });
    if (pairs.length) {
      renderCalendar();
      datePrev.disabled = pairIdx <= 0;
      dateNext.disabled = pairIdx === pairs.length - 1;
    }
  }

  function stepPair(dir) {
    if (!pairs.length) return;
    const next = pairIdx < 0 ? pairs.length - 1 : pairIdx + dir;
    if (next < 0 || next >= pairs.length) return;
    selectPair(next, mosaicSide);
  }
  datePrev.addEventListener('click', () => stepPair(-1));
  dateNext.addEventListener('click', () => stepPair(1));
  document.addEventListener('keydown', e => {
    if (timeline.hidden || (e.target && e.target.tagName === 'INPUT')) return;
    if (e.key === 'ArrowLeft') { e.preventDefault(); stepPair(-1); }
    if (e.key === 'ArrowRight') { e.preventDefault(); stepPair(1); }
  });

  
  // The historical-imagery card now opens from the comparison panel's date-pair button.
  function openHistory() {
    closeMenu();
    closeSettings();
    const pair = pairs[pairIdx];
    if (pair) {
      calYear = new Date(dayMs(pair[mosaicSide])).getUTCFullYear();
      calMonth = new Date(dayMs(pair[mosaicSide])).getUTCMonth();
      renderCalendar();
    }
    timeline.hidden = false;
    pairBtn.setAttribute('aria-expanded', 'true');
    historyBtn.setAttribute('aria-expanded', 'true');
  }
  function closeHistory() {
    timeline.hidden = true;
    pairBtn.setAttribute('aria-expanded', 'false');
    historyBtn.setAttribute('aria-expanded', 'false');
  }
  pairBtn.addEventListener('click', () => (timeline.hidden ? openHistory() : closeHistory()));
  historyClose.addEventListener('click', closeHistory);
  historyBtn.addEventListener('click', () => (timeline.hidden ? openHistory() : closeHistory()));

  
  function showMainUI() {
    mainHead.hidden = false;
    toolbar.hidden = false;
    nisarPanel.hidden = false;
    initData();
  }

  async function initData() {
    pairsState = 'loading';
    pairBtnLabel.textContent = 'Loading date pairs';
    calStatus.textContent = 'Loading processed date pairs';
    showCalendarState('loading', 'Loading processed date pairs',
      'Reading the date-pair index published by the NISAR processing runs.');
    setPanelEmpty('ph-circle-notch', 'Loading comparison', 'Fetching the latest radar mosaics.');

    await loadPairIndex();

    if (!pairs.length) {
      pairsState = 'error';
      pairBtnLabel.textContent = 'No date pairs';
      calStatus.textContent = 'No processed date pairs available';
      showCalendarState('error', 'No processed date pairs available',
        'The processed data index could not be reached or lists no date pairs.');
      meta = null;
      showMosaic('before');
      setStatus('Processed NISAR mosaics are unavailable right now.', 6000);
      return;
    }

    pairsState = 'ready';
    const earliest = pairs.reduce((m, p) => (p.before < m ? p.before : m), pairs[0].before);
    const latest = pairs.reduce((m, p) => (p.after > m ? p.after : m), pairs[0].after);
    calStatus.textContent = `${pairs.length} date ${pairs.length === 1 ? 'pair' : 'pairs'} · ${fmtIso(earliest)} to ${fmtIso(latest)}`;
    showCalendarState(null);
    buildList();
    selectPair(pairs.length - 1, 'before');
  }

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