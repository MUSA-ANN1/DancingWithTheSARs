(() => {
  const host = document.getElementById('hero-globe');
  if (!host || !window.THREE) return;

  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const width = 2048, height = 1024;

  function makeEarthTexture() {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');

    ctx.fillStyle = '#0A2660';
    ctx.fillRect(0, 0, width, height);

    if (window.WORLD && window.d3 && window.topojson) {
      const projection = d3.geoEquirectangular()
        .scale(width / (2 * Math.PI))
        .translate([width / 2, height / 2]);
      const path = d3.geoPath(projection, ctx);
      const countries = topojson.feature(WORLD, WORLD.objects.countries);
      const borders = topojson.mesh(WORLD, WORLD.objects.countries, (a, b) => a !== b);

      ctx.beginPath();
      path(d3.geoGraticule10());
      ctx.strokeStyle = 'rgba(92, 157, 224, 0.18)';
      ctx.lineWidth = 1.2;
      ctx.stroke();

      ctx.beginPath();
      path(countries);
      ctx.fillStyle = '#2B5CB5';
      ctx.fill();

      ctx.beginPath();
      path(borders);
      ctx.strokeStyle = '#071A3A';
      ctx.lineWidth = 1.5;
      ctx.stroke();
    } else {
      ctx.fillStyle = '#2B5CB5';
      ctx.fillRect(0, 0, width, height);
    }

    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 8;
    texture.needsUpdate = true;
    return texture;
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
  const camera = new THREE.PerspectiveCamera(34, 1, 0.1, 30);
  camera.position.set(0, 0, 3.25);

  const earth = new THREE.Mesh(
    new THREE.SphereGeometry(1, 128, 96),
    new THREE.MeshPhongMaterial({
      map: makeEarthTexture(),
      shininess: 12,
      specular: new THREE.Color('#18345e')
    })
  );
  earth.rotation.z = -0.12;
  scene.add(earth);

  scene.add(new THREE.AmbientLight(0x9dbce8, 1.15));
  const sun = new THREE.DirectionalLight(0xffffff, 2.0);
  sun.position.set(-3, 2, 4);
  scene.add(sun);

  const atmosphere = new THREE.Mesh(
    new THREE.SphereGeometry(1.045, 96, 64),
    new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      side: THREE.BackSide,
      vertexShader: `
        varying vec3 vNormal;
        varying vec3 vView;
        void main() {
          vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
          vNormal = normalize(normalMatrix * normal);
          vView = normalize(-mvPosition.xyz);
          gl_Position = projectionMatrix * mvPosition;
        }
      `,
      fragmentShader: `
        varying vec3 vNormal;
        varying vec3 vView;
        void main() {
          float rim = pow(1.0 - max(dot(normalize(vNormal), normalize(vView)), 0.0), 2.2);
          gl_FragColor = vec4(0.10, 0.42, 0.92, rim * 0.48);
        }
      `
    })
  );
  earth.add(atmosphere);

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
    if (!reducedMotion) earth.rotation.y += delta * 0.105;
    renderer.render(scene, camera);
  }
  render();

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) clock.stop();
    else clock.start();
  });
})();