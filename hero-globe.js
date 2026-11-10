(() => {
  const host = document.getElementById('hero-globe');
  if (!host || !window.THREE) return;

  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const W = 2048, H = 1024;
  const globe = new THREE.Group();
  const sunDirection = new THREE.Vector3(-0.55, 0.32, 0.77).normalize();

  function makeTextures() {
    const dayCanvas = document.createElement('canvas');
    const nightCanvas = document.createElement('canvas');
    [dayCanvas, nightCanvas].forEach(canvas => { canvas.width = W; canvas.height = H; });
    const day = dayCanvas.getContext('2d');
    const night = nightCanvas.getContext('2d');

    const paint = (ctx, ocean, land, border, graticule) => {
      ctx.fillStyle = ocean;
      ctx.fillRect(0, 0, W, H);
      if (!window.WORLD || !window.d3 || !window.topojson) return false;
      const projection = d3.geoEquirectangular().scale(W / (2 * Math.PI)).translate([W / 2, H / 2]);
      const path = d3.geoPath(projection, ctx);
      const countries = topojson.feature(WORLD, WORLD.objects.countries);
      const borders = topojson.mesh(WORLD, WORLD.objects.countries, (a, b) => a !== b);
      if (graticule) {
        ctx.beginPath(); path(d3.geoGraticule10());
        ctx.strokeStyle = 'rgba(11,61,145,0.34)'; ctx.lineWidth = 1; ctx.stroke();
      }
      ctx.beginPath(); path(countries); ctx.fillStyle = land; ctx.fill();
      ctx.beginPath(); path(borders); ctx.strokeStyle = border; ctx.lineWidth = 1.4; ctx.stroke();
      return true;
    };

    const hasCountries = paint(day, '#0A2660', '#2B5CB5', '#071A3A', true);
    paint(night, '#020812', '#07172B', '#0B3D91', false);
    if (!hasCountries) {
      day.fillStyle = '#2B5CB5'; day.fillRect(0, 0, W, H);
      night.fillStyle = '#020812'; night.fillRect(0, 0, W, H);
    }

    const dayMap = new THREE.CanvasTexture(dayCanvas);
    const nightMap = new THREE.CanvasTexture(nightCanvas);
    [dayMap, nightMap].forEach(texture => {
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.anisotropy = renderer.capabilities.getMaxAnisotropy();
      texture.needsUpdate = true;
    });
    return { dayMap, nightMap, dayCanvas, nightCanvas };
  }

  async function addGeographicDetails(textures) {
    const sources = [
      ['https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_10m_lakes.geojson', '#0B2B68', '#12365F', '#0D1F38', '#10479C', true],
      ['https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_10m_geography_marine_polys.geojson', '#0B2863', '#123B78', '#031020', '#104080', true],
      ['https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_10m_coastline.geojson', null, 'rgba(35,83,145,0.72)', null, 'rgba(18,76,156,0.68)', false]
    ];
    const projection = d3.geoEquirectangular().scale(W / (2 * Math.PI)).translate([W / 2, H / 2]);
    await Promise.all(sources.map(async ([url, dayFill, dayStroke, nightFill, nightStroke, fill]) => {
      try {
        const response = await fetch(url);
        if (!response.ok) return;
        const data = await response.json();
        const paint = (canvas, fillColor, strokeColor) => {
          const ctx = canvas.getContext('2d');
          const path = d3.geoPath(projection, ctx);
          ctx.save(); ctx.beginPath(); path(data);
          if (fill && fillColor) { ctx.fillStyle = fillColor; ctx.fill(); }
          if (strokeColor) { ctx.strokeStyle = strokeColor; ctx.lineWidth = 1.2; ctx.stroke(); }
          ctx.restore();
        };
        paint(textures.dayCanvas, dayFill, dayStroke);
        paint(textures.nightCanvas, nightFill, nightStroke);
      } catch (error) { console.warn('Earth detail layer unavailable:', error); }
    }));
    textures.dayMap.needsUpdate = true;
    textures.nightMap.needsUpdate = true;
  }


  function addCaspianHighlight() {
    const shore = window.CASPIAN_SHORELINE;
    if (!Array.isArray(shore) || shore.length < 3) return;
    const shape = new THREE.Shape();
    shape.moveTo(shore[0][0], shore[0][1]);
    for (let i = 1; i < shore.length; i++) shape.lineTo(shore[i][0], shore[i][1]);
    shape.closePath();

    const geometry = new THREE.ShapeGeometry(shape, 2);
    const vertices = geometry.attributes.position;
    const point = new THREE.Vector3();
    for (let i = 0; i < vertices.count; i++) {
      point.set(vertices.getX(i), vertices.getY(i), 0);
      const lon = point.x * Math.PI / 180;
      const lat = point.y * Math.PI / 180;
      const r = 1.006;
      vertices.setXYZ(i, r * Math.cos(lat) * Math.cos(lon), r * Math.sin(lat), -r * Math.cos(lat) * Math.sin(lon));
    }
    vertices.needsUpdate = true;
    geometry.computeVertexNormals();
    const fill = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({
      color: 0x0B3D91, transparent: true, opacity: 0.72,
      side: THREE.DoubleSide, depthWrite: false, depthTest: false,
      polygonOffset: true, polygonOffsetFactor: -2
    }));
    fill.renderOrder = 10;
    globe.add(fill);
  }

  function addCountryBorders() {
    if (!window.WORLD || !window.topojson) return;
    const mesh = topojson.mesh(WORLD, WORLD.objects.countries, (a, b) => a !== b);
    const positions = [];
    for (const line of (mesh.coordinates || [])) {
      for (let i = 1; i < line.length; i++) {
        const point = ([lon, lat]) => new THREE.Vector3(
          Math.cos(lat * Math.PI / 180) * Math.cos(lon * Math.PI / 180),
          Math.sin(lat * Math.PI / 180),
          -Math.cos(lat * Math.PI / 180) * Math.sin(lon * Math.PI / 180)
        ).multiplyScalar(1.003);
        const a = point(line[i - 1]), b = point(line[i]);
        positions.push(a.x, a.y, a.z, b.x, b.y, b.z);
      }
    }
    if (!positions.length) return;
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    const lines = new THREE.LineSegments(geometry, new THREE.LineBasicMaterial({
      color: 0x071A3A, transparent: true, opacity: 0.88, depthWrite: false
    }));
    lines.renderOrder = 4;
    globe.add(lines);
  }

  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
  } catch (error) {
    host.classList.add('hero__globe--fallback');
    return;
  }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setClearColor(0x000000, 0);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  host.appendChild(renderer.domElement);
  renderer.domElement.setAttribute('aria-hidden', 'true');

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 30);
  camera.position.set(0, 0, 3.1);
  scene.add(globe);

  const textures = makeTextures();
  const earthUniforms = {
    dayMap: { value: textures.dayMap },
    nightMap: { value: textures.nightMap },
    sunDir: { value: sunDirection },
    themeMode: { value: 0 }
  };
  const earthMaterial = new THREE.ShaderMaterial({
    uniforms: earthUniforms,
    vertexShader: `
      varying vec3 vN; varying vec2 vUv; varying vec3 vP;
      void main() {
        vUv = uv; vN = normalize(normal); vP = position;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: `
      uniform sampler2D dayMap; uniform sampler2D nightMap;
      uniform float themeMode; uniform vec3 sunDir;
      varying vec3 vN; varying vec2 vUv; varying vec3 vP;
      void main() {
        vec3 n = normalize(vN);
        float d = dot(n, normalize(sunDir));
        float dayMix = smoothstep(-0.10, 0.13, d);
        vec3 day = texture2D(dayMap, vUv).rgb;
        vec3 night = texture2D(nightMap, vUv).rgb;
        vec3 dayCol = day * (0.30 + 0.90 * max(d, 0.0));
        vec3 col = mix(night, dayCol, dayMix);
        float twilight = smoothstep(-0.18, -0.02, d) * (1.0 - dayMix);
        col += vec3(0.04, 0.08, 0.16) * twilight;
        vec3 viewDir = normalize(cameraPosition - vP);
        float rim = pow(1.0 - max(dot(n, viewDir), 0.0), 3.0);
        if (themeMode < 0.5) col += vec3(0.04, 0.20, 0.48) * rim * 0.38 * clamp(d + 0.35, 0.0, 1.0);
        gl_FragColor = vec4(col, 1.0);
      }`
  });
  const earth = new THREE.Mesh(new THREE.SphereGeometry(1, 128, 96), earthMaterial);
  globe.add(earth);

  const atmosphere = new THREE.Mesh(
    new THREE.SphereGeometry(1.12, 64, 48),
    new THREE.ShaderMaterial({
      uniforms: { sunDir: earthUniforms.sunDir },
      side: THREE.BackSide,
      blending: THREE.AdditiveBlending,
      transparent: true,
      depthWrite: false,
      vertexShader: `
        varying vec3 vN; varying vec3 vW;
        void main() {
          vN = normalize(normalMatrix * normal); vW = normalize(position);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: `
        uniform vec3 sunDir; varying vec3 vN; varying vec3 vW;
        void main() {
          float intensity = pow(max(0.0, 0.72 - dot(vN, vec3(0.0,0.0,1.0))), 3.5);
          float lit = clamp(dot(vW, normalize(sunDir)) + 0.4, 0.06, 1.0);
          gl_FragColor = vec4(0.25,0.55,1.0,1.0) * intensity * lit * 1.5;
        }`
    })
  );
  globe.add(atmosphere);
  addCountryBorders();
  addCaspianHighlight();
  addGeographicDetails(textures);

  function resize() {
    const rect = host.getBoundingClientRect();
    const w = Math.max(1, Math.round(rect.width));
    const h = Math.max(1, Math.round(rect.height));
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  const observer = new ResizeObserver(resize);
  observer.observe(host);
  resize();

  const clock = new THREE.Clock();
  function render() {
    requestAnimationFrame(render);
    const delta = Math.min(clock.getDelta(), 0.05);
    if (!reducedMotion) globe.rotation.y += delta * 0.075;
    renderer.render(scene, camera);
  }
  render();
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) clock.stop();
    else clock.start();
  });
})();

(() => {
  const link = document.querySelector('.enter[href="globe.html"]');
  if (!link) return;
  link.addEventListener('click', event => {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    if (reducedMotionPreference()) return;
    event.preventDefault();
    link.classList.add('is-opening');
    link.setAttribute('aria-label', 'Opening the globe');
    window.setTimeout(() => { window.location.href = link.href; }, 620);
  });
  function reducedMotionPreference() {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }
})();
