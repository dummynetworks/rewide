<script>
  import { onMount } from 'svelte';

  let canvas;
  let mapStatus = $state('loading');

  onMount(() => {
    const context = canvas?.getContext('2d', { alpha: false });
    if (!canvas || !context) {
      mapStatus = 'unavailable';
      return;
    }

    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    let points = [];
    let width = 0;
    let height = 0;
    let rotation = -0.22;
    let frame = 0;
    let previousTime = 0;
    let disposed = false;
    let observer;

    function buildLandPoints(geoJson) {
      const mapWidth = 1440;
      const mapHeight = 720;
      const mask = document.createElement('canvas');
      mask.width = mapWidth;
      mask.height = mapHeight;

      const maskContext = mask.getContext('2d', { willReadFrequently: true });
      if (!maskContext) throw new Error('Canvas mask could not be created');

      maskContext.fillStyle = '#fff';

      function drawPolygon(rings) {
        maskContext.beginPath();

        for (const ring of rings) {
          if (!Array.isArray(ring) || ring.length < 3) continue;

          ring.forEach(([longitude, latitude], index) => {
            const x = ((longitude + 180) / 360) * mapWidth;
            const y = ((90 - latitude) / 180) * mapHeight;

            if (index === 0) maskContext.moveTo(x, y);
            else maskContext.lineTo(x, y);
          });

          maskContext.closePath();
        }

        maskContext.fill('evenodd');
      }

      for (const feature of geoJson.features ?? []) {
        const geometry = feature.geometry;
        if (!geometry) continue;

        if (geometry.type === 'Polygon') {
          drawPolygon(geometry.coordinates);
        } else if (geometry.type === 'MultiPolygon') {
          for (const polygon of geometry.coordinates) drawPolygon(polygon);
        }
      }

      const pixels = maskContext.getImageData(0, 0, mapWidth, mapHeight).data;
      const generated = [];
      const step = 2.15;

      for (let latitude = -82; latitude <= 82; latitude += step) {
        const y = Math.min(mapHeight - 1, Math.max(0, Math.floor(((90 - latitude) / 180) * mapHeight)));

        for (let longitude = -179; longitude < 180; longitude += step) {
          const x = Math.min(mapWidth - 1, Math.max(0, Math.floor(((longitude + 180) / 360) * mapWidth)));
          const alpha = pixels[((y * mapWidth) + x) * 4 + 3];

          if (alpha > 96) {
            generated.push({
              latitude: latitude * (Math.PI / 180),
              longitude: longitude * (Math.PI / 180),
            });
          }
        }
      }

      return generated;
    }

    function resizeCanvas() {
      const bounds = canvas.getBoundingClientRect();
      const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);

      width = Math.max(1, bounds.width);
      height = Math.max(1, bounds.height);
      canvas.width = Math.round(width * pixelRatio);
      canvas.height = Math.round(height * pixelRatio);
      context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
      draw();
    }

    function draw() {
      if (!width || !height) return;

      const centerX = width / 2;
      const centerY = height / 2;
      const radius = Math.min(width * 0.43, height * 0.43);

      context.clearRect(0, 0, width, height);
      context.fillStyle = '#101820';
      context.fillRect(0, 0, width, height);

      const atmosphere = context.createRadialGradient(
        centerX, centerY, radius * 0.55,
        centerX, centerY, radius * 1.55,
      );
      atmosphere.addColorStop(0, 'rgba(79, 112, 132, 0.13)');
      atmosphere.addColorStop(0.66, 'rgba(49, 78, 96, 0.055)');
      atmosphere.addColorStop(1, 'rgba(16, 24, 32, 0)');
      context.fillStyle = atmosphere;
      context.fillRect(0, 0, width, height);

      const sphere = context.createRadialGradient(
        centerX - radius * 0.38,
        centerY - radius * 0.42,
        radius * 0.05,
        centerX,
        centerY,
        radius * 1.08,
      );
      sphere.addColorStop(0, '#1b2b35');
      sphere.addColorStop(0.72, '#14232c');
      sphere.addColorStop(1, '#0b141b');

      context.beginPath();
      context.arc(centerX, centerY, radius, 0, Math.PI * 2);
      context.fillStyle = sphere;
      context.fill();

      context.save();
      context.beginPath();
      context.arc(centerX, centerY, radius, 0, Math.PI * 2);
      context.clip();

      context.strokeStyle = 'rgba(171, 197, 209, 0.105)';
      context.lineWidth = 0.7;
      context.beginPath();
      context.ellipse(centerX, centerY, radius, radius * 0.29, -0.08, 0, Math.PI * 2);
      context.stroke();

      context.beginPath();
      context.ellipse(centerX, centerY, radius * 0.38, radius, 0, 0, Math.PI * 2);
      context.stroke();

      context.beginPath();
      context.ellipse(centerX, centerY, radius * 0.76, radius, 0, 0, Math.PI * 2);
      context.stroke();

      for (const point of points) {
        const longitude = point.longitude + rotation;
        const latitude = point.latitude;
        const cosLatitude = Math.cos(latitude);
        const x = Math.sin(longitude) * cosLatitude;
        const y = Math.sin(latitude);
        const z = Math.cos(longitude) * cosLatitude;

        if (z <= 0.015) continue;

        const depth = 0.26 + (z * 0.74);
        const pointX = centerX + (x * radius);
        const pointY = centerY - (y * radius);
        const pointRadius = 0.58 + (depth * 0.56);

        context.globalAlpha = 0.22 + (depth * 0.72);
        context.fillStyle = '#c0d2d9';
        context.beginPath();
        context.arc(pointX, pointY, pointRadius, 0, Math.PI * 2);
        context.fill();
      }

      context.globalAlpha = 1;
      context.restore();

      context.beginPath();
      context.arc(centerX, centerY, radius, 0, Math.PI * 2);
      context.strokeStyle = 'rgba(185, 211, 222, 0.34)';
      context.lineWidth = 1;
      context.stroke();

      context.beginPath();
      context.arc(centerX, centerY, radius + 5, 0, Math.PI * 2);
      context.strokeStyle = 'rgba(150, 181, 196, 0.10)';
      context.lineWidth = 1;
      context.stroke();
    }

    function animate(time) {
      if (disposed) return;

      if (previousTime) {
        const elapsed = Math.min((time - previousTime) / 1000, 0.05);
        rotation += elapsed * 0.055;
      }

      previousTime = time;
      draw();
      frame = window.requestAnimationFrame(animate);
    }

    function startAnimation() {
      if (disposed || document.hidden || reducedMotion.matches || frame) return;
      previousTime = 0;
      frame = window.requestAnimationFrame(animate);
    }

    function stopAnimation() {
      if (frame) window.cancelAnimationFrame(frame);
      frame = 0;
      previousTime = 0;
    }

    function handleVisibility() {
      if (document.hidden) stopAnimation();
      else startAnimation();
    }

    function handleMotionPreference() {
      if (reducedMotion.matches) {
        stopAnimation();
        draw();
      } else {
        startAnimation();
      }
    }

    observer = new ResizeObserver(resizeCanvas);
    observer.observe(canvas);
    resizeCanvas();

    document.addEventListener('visibilitychange', handleVisibility);
    reducedMotion.addEventListener('change', handleMotionPreference);

    async function loadLandData() {
      try {
        const response = await fetch('/earth-land.geojson', { cache: 'force-cache' });
        if (!response.ok) throw new Error('Land data request failed');

        const geoJson = await response.json();
        points = buildLandPoints(geoJson);

        if (!points.length) throw new Error('No land points were generated');

        mapStatus = 'ready';
        draw();
        startAnimation();
      } catch {
        mapStatus = 'unavailable';
        draw();
      }
    }

    void loadLandData();

    return () => {
      disposed = true;
      stopAnimation();
      observer?.disconnect();
      document.removeEventListener('visibilitychange', handleVisibility);
      reducedMotion.removeEventListener('change', handleMotionPreference);
    };
  });
</script>

<div class="earth-view">
  <canvas
    bind:this={canvas}
    class="earth-canvas"
    role="img"
    aria-label="A slowly rotating dotted globe, with land points drawn from Natural Earth geographic data."
  ></canvas>
  <span class="sr-only">
    {#if mapStatus === 'ready'}
      Geographic land mask loaded. Live network telemetry is not connected.
    {:else if mapStatus === 'loading'}
      Loading geographic land data.
    {:else}
      Geographic land data could not be loaded.
    {/if}
  </span>
</div>

<style>
  .earth-view {
    position: absolute;
    inset: 0;
    overflow: hidden;
    background: #101820;
  }

  .earth-canvas {
    display: block;
    width: 100%;
    height: 100%;
  }

  .sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
    white-space: nowrap;
    clip-path: inset(50%);
  }
</style>
