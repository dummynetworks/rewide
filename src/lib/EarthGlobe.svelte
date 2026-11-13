<script>
  import { onMount } from 'svelte';
  import * as THREE from 'three';

  let canvas;
  let { onTelemetryChange } = $props();

  onMount(() => {
    const context = canvas?.getContext('2d', { alpha: false });
    if (!canvas || !context) {
      onTelemetryChange?.({ state: 'unavailable' });
      return;
    }

    let renderer;
    let resizeObserver;
    let animationFrame = 0;
    let disposed = false;
    let width = 0;
    let height = 0;
    let previousFrameTime = 0;
    let lastRenderTime = 0;
    let texture;
    let globe;
    let telemetry = [];

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x000000);

    const camera = new THREE.PerspectiveCamera(37, 1, 0.1, 50);
    camera.position.set(0, 0, 3.7);

    const textureCanvas = document.createElement('canvas');
    textureCanvas.width = 2048;
    textureCanvas.height = 1024;
    const textureContext = textureCanvas.getContext('2d');

    const sampleCanvas = document.createElement('canvas');
    const sampleContext = sampleCanvas.getContext('2d', { willReadFrequently: true });

    if (!textureContext || !sampleContext) {
      onTelemetryChange?.({ state: 'unavailable' });
      return;
    }

    function drawPolygon(rings) {
      textureContext.beginPath();

      for (const ring of rings) {
        if (!Array.isArray(ring) || ring.length < 3) continue;

        ring.forEach(([longitude, latitude], index) => {
          const x = ((longitude + 180) / 360) * textureCanvas.width;
          const y = ((90 - latitude) / 180) * textureCanvas.height;

          if (index === 0) textureContext.moveTo(x, y);
          else textureContext.lineTo(x, y);
        });

        textureContext.closePath();
      }

      textureContext.fill('evenodd');
      textureContext.stroke();
    }

    function colorForInternetUse(value, minimum, maximum) {
      const range = maximum - minimum;
      const normalized = range > 0
        ? Math.max(0, Math.min(1, (value - minimum) / range))
        : 1;
      const amount = Math.pow(normalized, 0.82);
      const low = [16, 25, 33];
      const high = [220, 236, 244];
      const channels = low.map((channel, index) =>
        Math.round(channel + ((high[index] - channel) * amount))
      );
      return 'rgb(' + channels.join(',') + ')';
    }

    function paintMap(geoJson) {
      // Keep the ocean distinct from the page's pure-black background.
      textureContext.fillStyle = '#0b2940';
      textureContext.fillRect(0, 0, textureCanvas.width, textureCanvas.height);

      const values = telemetry
        .map((item) => item.value)
        .filter(Number.isFinite);
      const minimum = values.length ? Math.min(...values) : 0;
      const maximum = values.length ? Math.max(...values) : 0;
      const distribution = new Map(
        telemetry.map((item) => [item.code, item.value]),
      );
      textureContext.lineJoin = 'round';
      textureContext.lineWidth = 0.65;
      textureContext.strokeStyle = 'rgba(185, 210, 220, 0.16)';

      for (const feature of geoJson.features ?? []) {
        const properties = feature.properties ?? {};
        const code = properties.ISO_A3_EH ?? properties.ISO_A3 ?? '';
        const value = distribution.get(code);
        const fill = Number.isFinite(value)
          ? colorForInternetUse(value, minimum, maximum)
          : '#1d2931';

        textureContext.fillStyle = fill;

        if (feature.geometry?.type === 'Polygon') {
          drawPolygon(feature.geometry.coordinates);
        } else if (feature.geometry?.type === 'MultiPolygon') {
          for (const polygon of feature.geometry.coordinates) {
            drawPolygon(polygon);
          }
        }
      }

      texture.needsUpdate = true;
    }

    function drawDotMask() {
      renderer.render(scene, camera);

      const spacing = width < 600 ? 7.2 : 7.8;
      const sampleWidth = Math.max(1, Math.ceil(width / spacing));
      const sampleHeight = Math.max(1, Math.ceil(height / spacing));

      if (sampleCanvas.width !== sampleWidth || sampleCanvas.height !== sampleHeight) {
        sampleCanvas.width = sampleWidth;
        sampleCanvas.height = sampleHeight;
      }

      sampleContext.clearRect(0, 0, sampleWidth, sampleHeight);
      sampleContext.drawImage(renderer.domElement, 0, 0, sampleWidth, sampleHeight);

      const pixels = sampleContext.getImageData(0, 0, sampleWidth, sampleHeight).data;

      context.setTransform(
        canvas.width / width, 0,
        0, canvas.height / height,
        0, 0,
      );
      context.fillStyle = '#000000';
      context.fillRect(0, 0, width, height);

      for (let y = 0; y < sampleHeight; y += 1) {
        for (let x = 0; x < sampleWidth; x += 1) {
          const index = ((y * sampleWidth) + x) * 4;
          const red = pixels[index];
          const green = pixels[index + 1];
          const blue = pixels[index + 2];
          const brightness = (red + green + blue) / 3;

          if (brightness < 5) continue;

          // Keep the grid complete: encode the statistic through dot size, not skipped dots.
          // Ocean has no country statistic, so it uses a smaller fixed dot.
          const isOcean = (blue - red) > 36;
          const normalizedValue = Math.max(
            0,
            Math.min(1, (brightness - 24) / 209),
          );
          const radius = isOcean
            ? 1.55
            : 1.45 + (normalizedValue * 2.25);
          const centerX = (x + 0.5) * spacing;
          const centerY = (y + 0.5) * spacing;

          context.fillStyle = 'rgb(' + red + ',' + green + ',' + blue + ')';
          context.beginPath();
          context.arc(centerX, centerY, radius, 0, Math.PI * 2);
          context.fill();
        }
      }
    }

    function resize() {
      const bounds = canvas.parentElement.getBoundingClientRect();
      width = Math.max(1, bounds.width);
      height = Math.max(1, bounds.height);

      const pixelRatio = Math.min(window.devicePixelRatio || 1, 1.5);
      canvas.width = Math.round(width * pixelRatio);
      canvas.height = Math.round(height * pixelRatio);

      renderer.setPixelRatio(1);
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      drawDotMask();
    }

    function renderFrame(time) {
      if (disposed) return;
      animationFrame = window.requestAnimationFrame(renderFrame);

      if (time - lastRenderTime < 1000 / 30) return;

      const delta = previousFrameTime
        ? Math.min((time - previousFrameTime) / 1000, 0.08)
        : 0;

      previousFrameTime = time;
      lastRenderTime = time;

      globe.rotation.y += delta * 0.025;
      drawDotMask();
    }

    function start() {
      if (disposed || document.hidden || animationFrame) return;
      previousFrameTime = 0;
      animationFrame = window.requestAnimationFrame(renderFrame);
    }

    function stop() {
      if (animationFrame) window.cancelAnimationFrame(animationFrame);
      animationFrame = 0;
      previousFrameTime = 0;
    }

    function handleVisibility() {
      if (document.hidden) stop();
      else start();
    }

    async function loadData() {
      try {
        const mapResponse = await fetch('/earth-countries.geojson', {
          cache: 'force-cache',
        });
        if (!mapResponse.ok) throw new Error('Geographic data unavailable');

        const geoJson = await mapResponse.json();
        paintMap(geoJson);
        drawDotMask();

        try {
          const telemetryResponse = await fetch('/api/earth', {
            headers: { Accept: 'application/json' },
            cache: 'no-store',
          });

          if (telemetryResponse.ok) {
            const payload = await telemetryResponse.json();
            telemetry = Array.isArray(payload.countries) ? payload.countries : [];
            if (telemetry.length === 0) {
              throw new Error('World Bank returned no country observations');
            }
            paintMap(geoJson);
            onTelemetryChange?.({
              state: 'ready',
              source: payload.source,
              indicator: payload.indicator,
              earliestYear: payload.earliestYear,
              latestYear: payload.latestYear,
            });
          } else {
            onTelemetryChange?.({ state: 'unavailable' });
          }
        } catch {
          onTelemetryChange?.({ state: 'unavailable' });
        }
      } catch {
        onTelemetryChange?.({ state: 'unavailable' });
      }

      if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        start();
      } else {
        drawDotMask();
      }
    }

    try {
      renderer = new THREE.WebGLRenderer({
        antialias: true,
        alpha: false,
        powerPreference: 'high-performance',
        preserveDrawingBuffer: true,
      });
    } catch {
      onTelemetryChange?.({ state: 'unavailable' });
      return;
    }

    renderer.setPixelRatio(1);
    renderer.setClearColor(0x000000, 1);
    renderer.outputColorSpace = THREE.SRGBColorSpace;

    texture = new THREE.CanvasTexture(textureCanvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = renderer.capabilities.getMaxAnisotropy();

    const geometry = new THREE.SphereGeometry(1.08, 160, 160);
    const material = new THREE.MeshBasicMaterial({
      map: texture,
      toneMapped: false,
    });

    globe = new THREE.Mesh(geometry, material);
    globe.rotation.y = -Math.PI / 2;
    scene.add(globe);

    resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(canvas.parentElement);
    resize();

    document.addEventListener('visibilitychange', handleVisibility);
    void loadData();

    return () => {
      disposed = true;
      stop();
      resizeObserver?.disconnect();
      document.removeEventListener('visibilitychange', handleVisibility);
      geometry.dispose();
      material.dispose();
      texture.dispose();
      renderer.dispose();
    };
  });
</script>

<canvas
  bind:this={canvas}
  class="earth-canvas"
  role="img"
  aria-label="A slowly rotating three-dimensional Earth. Its WebGL rendering is converted into a two-dimensional dotted grid through Canvas."
></canvas>

<style>
  .earth-canvas {
    display: block;
    width: 100%;
    height: 100%;
    background: #000;
  }
</style>
