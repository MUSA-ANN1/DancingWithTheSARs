/* ============================================================
   DancingWithTheSARs – Caspian Sea Edition
   app.js  –  space background · Three.js globe · opening animation
              real-time sun · NISAR date slider
   ============================================================ */
'use strict';

(function () {

  /* ── Constants ─────────────────────────────────────────────── */
  const CASPIAN_LON = 51.0;   // centre of Caspian Sea
  const CASPIAN_LAT = 42.0;
  const ANIM_DURATION = 2800;  // ms total opening animation
  const INTRO_HOLD = 600;    // ms extra hold before zoom starts
  const PLAY_SPEED = 1600;   // ms per tick when playing
  const ASF_BASE = 'https://api.daac.asf.alaska.edu/services/search/param';
  const VERTEX_URL = 'https://search.asf.alaska.edu/';
  // Current local time passed in by the environment: 2026-10-26T22:37:42+05:00
  // We use Date.now() for the live sun.
  const NOW = new Date('2026-10-26T22:37:42+05:00');  // seed from env; updates live

  /* ── Utility ────────────────────────────────────────────────── */
  const $ = s => document.querySelector(s);
  const setStatus = msg => { const el = $('#status-msg'); if (el) el.textContent = msg; };

  /* ── Element refs ────────────────────────────────────────────── */
  const starsCv = $('#stars');
  const globeEl = $('#globe-container');
  const introOv = $('#intro-overlay');
  const mainHead = $('#main-head');
  const timeline = $('#timeline');
  const dateRange = $('#date-range');
  const playBtn = $('#play-btn');
  const playIcon = $('#play-icon');
  const pauseIcon = $('#pause-icon');
  const dateBadge = $('#current-date-badge');
  const tickLbls = $('#tick-labels');
  const nisarPanel = $('#nisar-panel');
  const nisarImg = $('#nisar-img');
  const nisarNoImg = $('#nisar-no-img');
  const nisarDL = $('#nisar-date-label');
  const nisarType = $('#nisar-type');
  const nisarLink = $('#nisar-link');

  /* ════════════════════════════════════════════════════════════
     1. STAR-FIELD + SUN (2D canvas behind the globe)
  ════════════════════════════════════════════════════════════ */

  const starsCtx = starsCv.getContext('2d');
  let starsW = 0, starsH = 0;

  // Star data: [x_frac, y_frac, radius, opacity, twinkle_offset]
  const STARS = [];
  function makeStars(n) {
    STARS.length = 0;
    for (let i = 0; i < n; i++) {
      STARS.push([
        Math.random(),           // x fraction
        Math.random(),           // y fraction
        Math.random() * 1.6 + 0.2,  // radius 0.2–1.8
        Math.random() * 0.7 + 0.3,  // base opacity
        Math.random() * Math.PI * 2  // twinkle phase
      ]);
    }
  }

  // A few bright "cluster" stars with blue/yellow tint
  const BRIGHT = [];
  function makeBright(n) {
    BRIGHT.length = 0;
    const colors = ['#c8e6fa', '#fffbe6', '#ffddc1', '#d0f0ff', '#ffe8a3'];
    for (let i = 0; i < n; i++) {
      BRIGHT.push({
        xf: Math.random(), yf: Math.random(),
        r: Math.random() * 1.8 + 1.0,
        col: colors[Math.floor(Math.random() * colors.length)],
        phase: Math.random() * Math.PI * 2
      });
    }
  }

  function resizeStars() {
    starsW = starsCv.width = window.innerWidth;
    starsH = starsCv.height = window.innerHeight;
  }

  function drawStars(t) {
    starsCtx.clearRect(0, 0, starsW, starsH);

    // Milky-way faint band
    const bx = starsW * 0.35, by = 0, bw = starsW * 0.35, bh = starsH;
    const mlk = starsCtx.createLinearGradient(bx, by, bx + bw, by + bh);
    mlk.addColorStop(0, 'rgba(30,40,80,0)');
    mlk.addColorStop(0.4, 'rgba(30,40,80,0.25)');
    mlk.addColorStop(0.6, 'rgba(30,40,80,0.25)');
    mlk.addColorStop(1, 'rgba(30,40,80,0)');
    starsCtx.fillStyle = mlk;
    starsCtx.fillRect(0, 0, starsW, starsH);

    // Regular stars
    const ts = t * 0.00045;
    for (const [xf, yf, r, op, ph] of STARS) {
      const twinkle = 0.55 + 0.45 * Math.sin(ts + ph);
      starsCtx.beginPath();
      starsCtx.arc(xf * starsW, yf * starsH, r, 0, Math.PI * 2);
      starsCtx.fillStyle = `rgba(220,235,255,${op * twinkle})`;
      starsCtx.fill();
    }

    // Bright stars with glow
    for (const s of BRIGHT) {
      const twinkle = 0.7 + 0.3 * Math.sin(ts * 1.3 + s.phase);
      const x = s.xf * starsW, y = s.yf * starsH;
      const grd = starsCtx.createRadialGradient(x, y, 0, x, y, s.r * 4);
      grd.addColorStop(0, s.col);
      grd.addColorStop(0.3, s.col.replace(')', `,${0.4 * twinkle})`).replace('rgb', 'rgba').replace('##', 'rgba(').replace('#c8e6fa', `rgba(200,230,250,${0.4 * twinkle})`).replace('#fffbe6', `rgba(255,251,230,${0.4 * twinkle})`).replace('rgba(rgba', 'rgba'));
      grd.addColorStop(1, 'rgba(0,0,0,0)');
      starsCtx.beginPath();
      starsCtx.arc(x, y, s.r, 0, Math.PI * 2);
      starsCtx.fillStyle = `rgba(255,255,240,${0.9 * twinkle})`;
      starsCtx.fill();
    }

    drawSun(t);
  }

  /* ── Real-time Sun ─── */
  let sunPos = { x: starsW * 0.8, y: starsH * 0.15 };

  function updateSun() {
    // SunCalc gives azimuth (N-clock) & altitude (rad) for Caspian lat/lon
    const pos = SunCalc.getPosition(new Date(), CASPIAN_LAT, CASPIAN_LON);
    const az = pos.azimuth + Math.PI;  // radians from N
    const alt = pos.altitude;           // radians above horizon
    // Map to screen: sun below horizon → push off-screen top
    const progress = Math.max(0, Math.min(1, (alt + 0.3) / 1.0));
    // azimuth → x fraction (0=N, π=S wraps to east/west)
    const xFrac = (az / (2 * Math.PI) + 0.5) % 1;
    sunPos = {
      x: xFrac * starsW,
      y: (1 - progress) * starsH * 0.55 + starsH * 0.03
    };
  }

  function drawSun(t) {
    const { x, y } = sunPos;
    const pulsate = 1 + 0.03 * Math.sin(t * 0.0012);
    // Outer glow
    let g = starsCtx.createRadialGradient(x, y, 0, x, y, 160 * pulsate);
    g.addColorStop(0, 'rgba(255,220,100,0.18)');
    g.addColorStop(0.35, 'rgba(255,160,40,0.07)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    starsCtx.beginPath();
    starsCtx.arc(x, y, 160 * pulsate, 0, Math.PI * 2);
    starsCtx.fillStyle = g;
    starsCtx.fill();
    // Corona glow
    g = starsCtx.createRadialGradient(x, y, 0, x, y, 55 * pulsate);
    g.addColorStop(0, 'rgba(255,240,180,0.95)');
    g.addColorStop(0.4, 'rgba(255,200,80,0.6)');
    g.addColorStop(0.75, 'rgba(255,140,30,0.18)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    starsCtx.beginPath();
    starsCtx.arc(x, y, 55 * pulsate, 0, Math.PI * 2);
    starsCtx.fillStyle = g;
    starsCtx.fill();
    // Core disc
    g = starsCtx.createRadialGradient(x, y, 0, x, y, 12 * pulsate);
    g.addColorStop(0, 'rgba(255,255,220,1)');
    g.addColorStop(0.6, 'rgba(255,230,130,0.9)');
    g.addColorStop(1, 'rgba(255,190,60,0)');
    starsCtx.beginPath();
    starsCtx.arc(x, y, 12 * pulsate, 0, Math.PI * 2);
    starsCtx.fillStyle = g;
    starsCtx.fill();
  }

  /* ════════════════════════════════════════════════════════════
     2. THREE.JS GLOBE
  ════════════════════════════════════════════════════════════ */
  const THREE = window.THREE;
  let renderer, scene, camera, globeMesh, atmosphereMesh, caspianLine;
  let W = window.innerWidth, H = window.innerHeight;
  let isDragging = false, prevMouse = { x: 0, y: 0 };
  let globeRotX = 0, globeRotY = 0;  // current rotation (rad)
  let targetRotX = 0, targetRotY = 0;
  const GLOBE_RADIUS = 1.0;

  // Lon/lat → 3D XYZ on unit sphere
  function lonLatToVec3(lon, lat, r) {
    const phi = (90 - lat) * Math.PI / 180;
    const theta = (lon + 180) * Math.PI / 180;
    return new THREE.Vector3(
      -r * Math.sin(phi) * Math.cos(theta),
      r * Math.cos(phi),
      r * Math.sin(phi) * Math.sin(theta)
    );
  }

  function initThree() {
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(W, H);
    renderer.setClearColor(0x000000, 0);
    globeEl.appendChild(renderer.domElement);

    scene = new THREE.Scene();

    // Camera
    camera = new THREE.PerspectiveCamera(45, W / H, 0.1, 100);
    camera.position.set(0, 0, 4);  // start far

    // Lights
    const ambient = new THREE.AmbientLight(0x334466, 0.6);
    scene.add(ambient);
    const sunLight = new THREE.DirectionalLight(0xfff5d0, 1.8);
    sunLight.position.set(5, 3, 5);
    scene.add(sunLight);

    // Globe sphere
    const geo = new THREE.SphereGeometry(GLOBE_RADIUS, 64, 64);

    // Load earth texture
    const loader = new THREE.TextureLoader();
    loader.crossOrigin = 'anonymous';

    // Day texture via public NASA CDN
    const dayTex = loader.load(
      'https://unpkg.com/three-globe@2.31.2/example/img/earth-blue-marble.jpg',
      () => { /* loaded */ },
      undefined,
      () => {
        // Fallback: solid colored sphere
        mat.color.set(0x1a4a9a);
      }
    );

    const mat = new THREE.MeshPhongMaterial({
      map: dayTex,
      specular: new THREE.Color(0x333355),
      shininess: 12,
    });

    globeMesh = new THREE.Mesh(geo, mat);
    scene.add(globeMesh);

    // Atmosphere glow
    const atmGeo = new THREE.SphereGeometry(GLOBE_RADIUS * 1.025, 64, 64);
    const atmMat = new THREE.MeshPhongMaterial({
      color: 0x4fc3f7,
      transparent: true,
      opacity: 0.08,
      side: THREE.BackSide,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    atmosphereMesh = new THREE.Mesh(atmGeo, atmMat);
    scene.add(atmosphereMesh);

    // Outer glow ring
    const outerGeo = new THREE.SphereGeometry(GLOBE_RADIUS * 1.065, 64, 64);
    const outerMat = new THREE.MeshPhongMaterial({
      color: 0x1a6bb5,
      transparent: true,
      opacity: 0.04,
      side: THREE.BackSide,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    scene.add(new THREE.Mesh(outerGeo, outerMat));

    buildCaspianOutline();

    // Drag to rotate (after animation)
    addDragHandlers();
  }

  /* ── Caspian Sea Outline ─────────────────────────────────── */
  // Simplified Caspian coastline polygon (lon, lat) clockwise from north
  const CASPIAN_COORDS = [
    [54.0, 51.5], [53.1, 50.3], [52.5, 49.4], [52.8, 48.5], [53.3, 47.4],
    [53.7, 46.5], [54.2, 45.5], [50.3, 44.9], [49.9, 44.0], [50.4, 43.2],
    [51.3, 42.5], [51.9, 41.7], [53.1, 40.9], [53.6, 40.2], [53.8, 39.4],
    [53.5, 38.5], [52.6, 37.4], [51.0, 36.8], [50.2, 37.2], [50.0, 38.1],
    [49.5, 39.0], [49.2, 40.0], [49.1, 41.0], [48.7, 41.9], [48.7, 42.8],
    [49.0, 43.8], [49.4, 44.5], [49.0, 45.4], [48.5, 46.3], [48.7, 47.2],
    [49.2, 47.9], [49.9, 48.7], [50.4, 49.5], [51.0, 50.3], [51.8, 51.0],
    [54.0, 51.5]
  ];

  function buildCaspianOutline() {
    const pts = CASPIAN_COORDS.map(([lon, lat]) =>
      lonLatToVec3(lon, lat, GLOBE_RADIUS * 1.004)
    );
    const geo = new THREE.BufferGeometry().setFromPoints(pts);

    // Glowing line
    const mat = new THREE.LineBasicMaterial({
      color: 0x4fc3f7,
      linewidth: 2,
      transparent: true,
      opacity: 0.9,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    caspianLine = new THREE.Line(geo, mat);
    caspianLine.visible = false;  // revealed after animation
    scene.add(caspianLine);

    // Filled "water" as separate transparent mesh
    // Simple fan triangulation around centroid
    const centroid = lonLatToVec3(CASPIAN_LON, CASPIAN_LAT, GLOBE_RADIUS * 1.002);
    const fillPts = [centroid, ...pts];
    const indices = [];
    for (let i = 1; i < fillPts.length - 1; i++) {
      indices.push(0, i, i + 1);
    }
    const fillGeo = new THREE.BufferGeometry().setFromPoints(fillPts);
    fillGeo.setIndex(indices);
    fillGeo.computeVertexNormals();

    const fillMat = new THREE.MeshBasicMaterial({
      color: 0x1a6dcc,
      transparent: true,
      opacity: 0.28,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.FrontSide,
    });
    const fillMesh = new THREE.Mesh(fillGeo, fillMat);
    fillMesh.visible = false;
    scene.add(fillMesh);

    // Store ref for reveal
    caspianLine._fill = fillMesh;
  }

  /* ── Drag handlers ────────────────────────────────────────── */
  let dragEnabled = false;
  let lastTouchDist = null;

  function addDragHandlers() {
    const el = renderer.domElement;

    el.addEventListener('pointerdown', e => {
      if (!dragEnabled) return;
      isDragging = true;
      prevMouse = { x: e.clientX, y: e.clientY };
      el.setPointerCapture(e.pointerId);
    });

    el.addEventListener('pointermove', e => {
      if (!isDragging || !dragEnabled) return;
      const dx = e.clientX - prevMouse.x;
      const dy = e.clientY - prevMouse.y;
      prevMouse = { x: e.clientX, y: e.clientY };
      targetRotY += dx * 0.005;
      targetRotX += dy * 0.005;
      targetRotX = Math.max(-Math.PI / 2.5, Math.min(Math.PI / 2.5, targetRotX));
    });

    el.addEventListener('pointerup', () => { isDragging = false; });
    el.addEventListener('pointercancel', () => { isDragging = false; });

    el.addEventListener('wheel', e => {
      if (!dragEnabled) return;
      e.preventDefault();
      const z = camera.position.z + e.deltaY * 0.003;
      camera.position.z = Math.max(1.3, Math.min(5, z));
    }, { passive: false });
  }

  /* ════════════════════════════════════════════════════════════
     3. OPENING ANIMATION
  ════════════════════════════════════════════════════════════ */
  // We need the globe initially positioned facing lon=0, lat=0
  // (centre of spin). Target is Caspian (lon=51, lat=42).
  // Globe's internal rotation: rotY rotates in longitude, rotX in latitude.

  // lon=51 → rotY = 51 * π/180
  // lat=42 → rotX = -42 * π/180  (negative because +X tilts north down)
  const TARGET_ROTY = -51 * Math.PI / 180;
  const TARGET_ROTX = 42 * Math.PI / 180;

  const TARGET_CAM_Z = 1.85;  // final zoomed-in z
  const INITIAL_CAM_Z = camera ? camera.position.z : 4;

  let animDone = false;

  function runOpeningAnimation() {
    const startTime = performance.now();
    let phase = 'spin';  // spin → zoom

    // Disable drag
    dragEnabled = false;

    // Globe starts at rotY=0, rotX=0
    globeMesh.rotation.set(0, 0, 0);

    function tick(now) {
      const elapsed = now - startTime;

      if (phase === 'spin') {
        // Spin 360° over ANIM_DURATION*0.55, ease-in-out
        const t = Math.min(1, elapsed / (ANIM_DURATION * 0.55));
        const e = easeInOut(t);
        globeMesh.rotation.y = e * Math.PI * 2;
        atmosphereMesh.rotation.y = globeMesh.rotation.y;

        if (t >= 1) {
          phase = 'zoom';
        }
        requestAnimationFrame(tick);

      } else if (phase === 'zoom') {
        // Zoom-in + rotate to Caspian over remaining time
        const zoomStart = ANIM_DURATION * 0.45;
        const zoomElapsed = elapsed - zoomStart;
        const zoomDur = ANIM_DURATION * 0.65;
        const t = Math.max(0, Math.min(1, zoomElapsed / zoomDur));
        const e = easeInOut(t);

        globeMesh.rotation.y = Math.PI * 2 + TARGET_ROTY * e;   // continue spin→target
        globeMesh.rotation.x = TARGET_ROTX * e;
        atmosphereMesh.rotation.set(globeMesh.rotation.x, globeMesh.rotation.y, 0);

        // Camera zoom in
        camera.position.z = lerp(4, TARGET_CAM_Z, e);

        if (t >= 1) {
          // Animation done
          phase = 'done';
          globeMesh.rotation.y = Math.PI * 2 + TARGET_ROTY;
          globeMesh.rotation.x = TARGET_ROTX;
          targetRotY = globeMesh.rotation.y;
          targetRotX = globeMesh.rotation.x;
          camera.position.z = TARGET_CAM_Z;

          // Reveal Caspian outline
          if (caspianLine) {
            caspianLine.visible = true;
            caspianLine._fill.visible = true;
          }

          // Fade out intro overlay
          introOv.classList.add('fade-out');
          setTimeout(() => {
            introOv.style.display = 'none';
            mainHead.hidden = false;
            timeline.hidden = false;
            dragEnabled = true;
            animDone = true;
            loadNisarDates();
          }, 800);
          return;
        }
        requestAnimationFrame(tick);
      }
    }
    requestAnimationFrame(tick);
  }

  /* ── Easing helpers ─── */
  function easeInOut(t) {
    return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
  }
  function lerp(a, b, t) { return a + (b - a) * t; }

  /* ════════════════════════════════════════════════════════════
     4. NISAR DATA (ASF API)
  ════════════════════════════════════════════════════════════ */
  let nisarItems = [];   // sorted by date asc
  let playTimer = null;
  let isPlaying = false;

  async function loadNisarDates() {
    setStatus('Searching ASF archive for Caspian Sea NISAR products…');
    nisarPanel.hidden = true;

    const wkt = encodeURIComponent(`POINT(${CASPIAN_LON.toFixed(3)} ${CASPIAN_LAT.toFixed(3)})`);
    const url = `${ASF_BASE}?dataset=NISAR&processingLevel=GCOV,GUNW&intersectsWith=${wkt}&maxResults=100&output=geojson`;

    let items = [];
    try {
      const ac = new AbortController();
      const tid = setTimeout(() => ac.abort(), 14000);
      const res = await fetch(url, { signal: ac.signal });
      clearTimeout(tid);
      if (res.ok) {
        const json = await res.json();
        items = (json.features || []).map(f => f.properties);
      }
    } catch (e) {
      // Network / CORS – use demo placeholders
      items = [];
    }

    // Sort ascending by startTime
    items.sort((a, b) => String(a.startTime).localeCompare(String(b.startTime)));

    if (!items.length) {
      // Demo placeholder data so the UI is still visible
      items = buildDemoItems();
      setStatus('No live NISAR products found — showing demo dates');
    } else {
      setStatus(`${items.length} NISAR products found for Caspian Sea`);
    }

    nisarItems = items;
    buildSlider();
    selectDate(nisarItems.length - 1);  // show newest by default
    nisarPanel.hidden = false;
    setTimeout(() => setStatus(''), 3000);
  }

  function buildDemoItems() {
    // Synthetic placeholder dates for display when API returns nothing
    const base = new Date('2025-08-15');
    const out = [];
    for (let i = 0; i < 24; i++) {
      const d = new Date(base);
      d.setDate(d.getDate() + i * 15);
      out.push({
        startTime: d.toISOString().slice(0, 10),
        processingLevel: Math.random() > 0.5 ? 'GCOV' : 'GUNW',
        browse: null,
        url: VERTEX_URL,
        sceneName: `DEMO-CASPIAN-${String(i + 1).padStart(3, '0')}`
      });
    }
    return out;
  }

  /* ── Build slider ─── */
  function buildSlider() {
    const n = nisarItems.length;
    if (!n) return;

    dateRange.min = 0;
    dateRange.max = n - 1;
    dateRange.value = n - 1;

    // Tick labels: first, last, and ~5 evenly spaced
    tickLbls.innerHTML = '';
    const positions = new Set();
    positions.add(0);
    positions.add(n - 1);
    const step = Math.max(1, Math.floor(n / 6));
    for (let i = step; i < n - 1; i += step) positions.add(i);

    positions.forEach(i => {
      const pct = i / (n - 1) * 100;
      const span = document.createElement('span');
      span.style.left = `${pct}%`;
      span.textContent = String(nisarItems[i].startTime || '').slice(0, 7);  // YYYY-MM
      tickLbls.appendChild(span);
    });

    // Slider fill gradient update
    updateSliderFill();

    dateRange.addEventListener('input', () => {
      updateSliderFill();
      selectDate(+dateRange.value);
    });
  }

  function updateSliderFill() {
    const pct = dateRange.max > 0
      ? ((+dateRange.value - +dateRange.min) / (+dateRange.max - +dateRange.min)) * 100
      : 0;
    dateRange.style.setProperty('--pct', `${pct}%`);
    dateRange.style.background =
      `linear-gradient(to right, #4fc3f7 ${pct}%, rgba(79,195,247,0.2) ${pct}%)`;
  }

  function selectDate(idx) {
    if (!nisarItems.length) return;
    idx = Math.max(0, Math.min(nisarItems.length - 1, idx));
    dateRange.value = idx;
    updateSliderFill();

    const item = nisarItems[idx];
    const dateStr = String(item.startTime || '').slice(0, 10);
    dateBadge.textContent = dateStr;
    nisarDL.textContent = dateStr;
    nisarType.textContent = item.processingLevel || '—';

    // Update link
    if (item.url && item.url !== VERTEX_URL) {
      nisarLink.href = item.url;
    } else {
      nisarLink.href = VERTEX_URL;
    }

    // Browse image
    const browseUrl = item.browse && item.browse[0];
    if (browseUrl) {
      nisarImg.classList.add('loading');
      nisarImg.style.display = 'block';
      nisarNoImg.classList.remove('visible');
      nisarImg.onload = () => nisarImg.classList.remove('loading');
      nisarImg.onerror = () => {
        nisarImg.style.display = 'none';
        nisarNoImg.classList.add('visible');
      };
      nisarImg.src = browseUrl;
    } else {
      nisarImg.src = '';
      nisarImg.style.display = 'none';
      nisarNoImg.classList.add('visible');
    }
  }

  /* ── Play / Pause ─── */
  playBtn.addEventListener('click', () => {
    if (isPlaying) {
      stopPlay();
    } else {
      startPlay();
    }
  });

  function startPlay() {
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
    let next = +dateRange.value + 1;
    if (next > +dateRange.max) next = 0;
    selectDate(next);
    playTimer = setTimeout(stepPlay, PLAY_SPEED);
  }

  /* ════════════════════════════════════════════════════════════
     5. MAIN RENDER LOOP
  ════════════════════════════════════════════════════════════ */
  let caspianGlowPhase = 0;

  function renderLoop(t) {
    requestAnimationFrame(renderLoop);

    // Stars + sun
    drawStars(t);

    // Smooth globe rotation (damped)
    if (animDone) {
      globeMesh.rotation.y += (targetRotY - globeMesh.rotation.y) * 0.08;
      globeMesh.rotation.x += (targetRotX - globeMesh.rotation.x) * 0.08;
      atmosphereMesh.rotation.set(globeMesh.rotation.x, globeMesh.rotation.y, 0);
    }

    // Caspian outline pulsing glow
    if (caspianLine && caspianLine.visible) {
      caspianGlowPhase += 0.03;
      caspianLine.material.opacity = 0.7 + 0.3 * Math.sin(caspianGlowPhase);
    }

    renderer.render(scene, camera);
  }

  /* ════════════════════════════════════════════════════════════
     6. RESIZE
  ════════════════════════════════════════════════════════════ */
  function onResize() {
    W = window.innerWidth;
    H = window.innerHeight;
    resizeStars();
    if (renderer) {
      renderer.setSize(W, H);
      camera.aspect = W / H;
      camera.updateProjectionMatrix();
    }
  }
  window.addEventListener('resize', onResize);

  /* ════════════════════════════════════════════════════════════
     7. BOOT
  ════════════════════════════════════════════════════════════ */
  function boot() {
    resizeStars();
    makeStars(2200);
    makeBright(60);
    updateSun();
    setInterval(updateSun, 30000);  // refresh sun position every 30s

    initThree();

    // Begin renderLoop immediately so stars/globe appear
    requestAnimationFrame(renderLoop);

    // Short delay then kick off opening animation
    setTimeout(runOpeningAnimation, 500);
    setStatus('Preparing Caspian Sea view…');
  }

  // Wait for THREE to be available
  if (typeof THREE === 'undefined') {
    window.addEventListener('load', boot);
  } else {
    boot();
  }

})();
