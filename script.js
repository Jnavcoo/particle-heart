/* ==========================================================================
   Particle Heart Animation
   HTML5 Canvas + Vanilla JS, tanpa library eksternal.

   Pipeline render:
   1. Partikel digambar ke canvas "scene" (transparan) memakai sprite glow
      yang sudah dirender di awal + composite 'lighter' (cahaya menyatu).
   2. Scene di-downscale bertingkat (1/2, 1/4, 1/8, 1/16) lalu ditambahkan
      kembali dengan 'lighter' -> efek bloom murah tanpa shadowBlur.
   3. Hasil akhir disusun di canvas utama di atas background #050505.
   ========================================================================== */
(() => {
  'use strict';

  const canvas = document.getElementById('heart');
  if (!canvas) return;
  const mctx = canvas.getContext('2d');
  if (!mctx) return;

  const scene = document.createElement('canvas');
  const sctx = scene.getContext('2d');

  /* ---------------------------------------------------------------- Config */
  const CONFIG = {
    bg: '#050505',
    beatPeriod: 1.55,        // detik per detak (lub-dub)
    beatScale: 0.06,         // amplitudo pembesaran hati
    beatPush: 0.9,           // dorongan radial riak per partikel (unit hati)
    maxDesktop: 3200,
    maxMobile: 1700,
    burstDesktop: 220,
    burstMobile: 110,
  };

  const TAU = Math.PI * 2;
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const rand = (a, b) => a + Math.random() * (b - a);

  /* --------------------------------------------------------------- Palette */
  // urutan: hotPink, deepPink, magenta, crimson, red, softWhite, lightPink
  const COLORS = [
    [255, 105, 180],
    [255, 20, 147],
    [232, 30, 205],
    [225, 20, 65],
    [255, 45, 55],
    [255, 244, 248],
    [255, 182, 208],
  ];
  const COLOR_CSS = COLORS.map(([r, g, b]) => `rgb(${r},${g},${b})`);
  const OUTLINE_W = [22, 14, 8, 6, 12, 18, 20]; // kontur: lebih terang
  const FILL_W = [18, 24, 14, 16, 16, 4, 8];    // isi: lebih dalam/merah

  function weightedPicker(weights) {
    const total = weights.reduce((a, b) => a + b, 0);
    return () => {
      let r = Math.random() * total;
      for (let i = 0; i < weights.length; i++) {
        r -= weights[i];
        if (r <= 0) return i;
      }
      return weights.length - 1;
    };
  }
  const pickOutline = weightedPicker(OUTLINE_W);
  const pickFill = weightedPicker(FILL_W);

  // Sprite glow per warna (dirender sekali)
  const SPRITES = COLORS.map(([R, G, B]) => {
    const n = 64;
    const c = document.createElement('canvas');
    c.width = c.height = n;
    const g = c.getContext('2d');
    const r = n / 2;
    const wr = Math.round(R + (255 - R) * 0.6);
    const wg = Math.round(G + (255 - G) * 0.6);
    const wb = Math.round(B + (255 - B) * 0.6);
    const grad = g.createRadialGradient(r, r, 0, r, r, r);
    grad.addColorStop(0, `rgba(${wr},${wg},${wb},1)`);
    grad.addColorStop(0.14, `rgba(${wr},${wg},${wb},0.95)`);
    grad.addColorStop(0.22, `rgba(${R},${G},${B},0.75)`);
    grad.addColorStop(0.45, `rgba(${R},${G},${B},0.2)`);
    grad.addColorStop(0.75, `rgba(${R},${G},${B},0.05)`);
    grad.addColorStop(1, `rgba(${R},${G},${B},0)`);
    g.fillStyle = grad;
    g.fillRect(0, 0, n, n);
    return c;
  });
  const WHITE_SPRITE = SPRITES[5];

  /* ----------------------------------------------------- Heart geometry
     x = 16 sin^3(t)
     y = 13 cos t - 5 cos 2t - 2 cos 3t - cos 4t        (y ke atas)
     Rentang y: -17 .. 12  -> pusat visual di y = -2.5                  */
  const CY = -2.5;
  const heartXY = (t) => [
    16 * Math.pow(Math.sin(t), 3),
    13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t),
  ];

  const CONTOUR_N = 720;
  const contour = [];
  const cum = new Float32Array(CONTOUR_N + 1);
  for (let i = 0; i <= CONTOUR_N; i++) {
    const p = heartXY((i / CONTOUR_N) * TAU);
    contour.push([p[0], p[1] - CY]);
    if (i > 0) {
      cum[i] =
        cum[i - 1] +
        Math.hypot(contour[i][0] - contour[i - 1][0], contour[i][1] - contour[i - 1][1]);
    }
  }
  const CONTOUR_LEN = cum[CONTOUR_N];

  // titik di kontur dengan jarak merata (arc-length)
  function sampleContour(u) {
    const target = u * CONTOUR_LEN;
    let lo = 0;
    let hi = CONTOUR_N;
    while (lo < hi - 1) {
      const mid = (lo + hi) >> 1;
      if (cum[mid] <= target) lo = mid;
      else hi = mid;
    }
    const seg = cum[hi] - cum[lo] || 1;
    const f = (target - cum[lo]) / seg;
    return [
      contour[lo][0] + (contour[hi][0] - contour[lo][0]) * f,
      contour[lo][1] + (contour[hi][1] - contour[lo][1]) * f,
    ];
  }

  function insideHeart(x, y) {
    let inside = false;
    for (let i = 0, j = CONTOUR_N - 1; i < CONTOUR_N; j = i++) {
      const xi = contour[i][0];
      const yi = contour[i][1];
      const xj = contour[j][0];
      const yj = contour[j][1];
      if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  }

  /* -------------------------------------------------------------- Particles */
  let particles = [];

  function makeParticle(isOutline) {
    let hx;
    let hy;
    if (isOutline) {
      const p = sampleContour(Math.random());
      // pita tipis di sekitar kontur (sedikit ke dalam)
      const s = 1 - Math.pow(Math.random(), 3) * 0.1 + rand(-0.008, 0.008);
      hx = p[0] * s;
      hy = p[1] * s;
    } else {
      do {
        hx = rand(-16.5, 16.5);
        hy = rand(-14.7, 14.7);
      } while (!insideHeart(hx, hy));
    }

    const len = Math.hypot(hx, hy);
    let dx;
    let dy;
    if (len < 2) {
      const a = rand(0, TAU);
      dx = Math.cos(a);
      dy = Math.sin(a);
    } else {
      dx = hx / len;
      dy = hy / len;
    }

    const bright = Math.random() < 0.09;
    const excursive = Math.random() < 0.32;
    return {
      hx,
      hy,
      dx,
      dy,
      dist: Math.min(1, len / 17),
      size: (isOutline ? rand(0.5, 1.4) : rand(0.45, 1.25)) * (bright ? 1.7 : 1),
      alpha: bright ? 1 : isOutline ? rand(0.55, 1) : rand(0.35, 0.9),
      ci: isOutline ? pickOutline() : pickFill(),
      bright,
      trail: Math.random() < 0.08,
      tp: rand(0, TAU),
      ts: rand(0.8, 3.2),
      ax: rand(0.08, 0.38),
      fx: rand(0.35, 1.1),
      fy: rand(0.35, 1.1),
      p1: rand(0, TAU),
      p2: rand(0, TAU),
      eAmp: excursive ? rand(0.7, 2.6) : rand(0.05, 0.25),
      eSpd: rand(0.25, 0.7),
      ePh: rand(0, TAU),
      ox: 0,
      oy: 0,
      sx: 0,
      sy: 0,
      has: false,
    };
  }

  function buildParticles(count) {
    const list = new Array(count);
    for (let i = 0; i < count; i++) list[i] = makeParticle(Math.random() < 0.28);
    return list;
  }

  /* ----------------------------------------------------------------- Bursts */
  const burstPool = [];
  function makeBurstPool(n) {
    burstPool.length = 0;
    for (let i = 0; i < n; i++) {
      burstPool.push({ alive: false, x: 0, y: 0, vx: 0, vy: 0, life: 0, max: 1, size: 1, ci: 0, ph: 0 });
    }
  }
  let burstCursor = 0;

  function spawnBurst(gs) {
    if (!particles.length) return;
    let slot = null;
    for (let k = 0; k < burstPool.length; k++) {
      const b = burstPool[(burstCursor + k) % burstPool.length];
      if (!b.alive) {
        slot = b;
        burstCursor = (burstCursor + k + 1) % burstPool.length;
        break;
      }
    }
    if (!slot) return;
    let p = particles[(Math.random() * activeCount) | 0];
    for (let tries = 0; tries < 4 && p.dist < 0.45; tries++) p = particles[(Math.random() * activeCount) | 0];
    const ang = Math.atan2(-p.dy, p.dx) + rand(-0.55, 0.55);
    const speed = S * rand(1.4, 4.6);
    slot.alive = true;
    slot.x = cx + p.hx * gs * S;
    slot.y = cy - p.hy * gs * S;
    slot.vx = Math.cos(ang) * speed;
    slot.vy = Math.sin(ang) * speed;
    slot.max = slot.life = rand(1.1, 2.6);
    slot.size = rand(0.6, 1.5);
    slot.ci = pickOutline();
    slot.ph = rand(0, TAU);
  }

  /* ----------------------------------------------------------------- State */
  let W = 1;
  let H = 1;
  let dpr = 1;
  let cw = 1;
  let ch = 1;
  let cx = 0;
  let cy = 0;
  let S = 10;           // piksel CSS per unit hati
  let sizeScale = 1;
  let small = false;
  let activeCount = 0;
  let quality = 1;      // diturunkan otomatis bila frame lambat
  let time = 0;
  let lastNow = 0;
  let lastBeatIdx = -1;
  let spawnAcc = 0;
  let emaDt = 1 / 60;
  let frameCount = 0;

  const motionQuery = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
  let reduced = !!(motionQuery && motionQuery.matches);
  if (motionQuery) {
    const onChange = (e) => {
      reduced = e.matches;
      computeActive();
      if (reduced) burstPool.forEach((b) => (b.alive = false));
    };
    if (motionQuery.addEventListener) motionQuery.addEventListener('change', onChange);
    else if (motionQuery.addListener) motionQuery.addListener(onChange);
  }

  const blooms = [];
  const BLOOM_ALPHA = [0, 0.22, 0.38, 0.45]; // level 1/2 hanya sebagai perantara

  function isSmallDevice() {
    const coarse = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
    return Math.min(window.innerWidth, window.innerHeight) < 620 || !!coarse;
  }

  function computeActive() {
    const max = particles.length;
    let base = clamp(Math.round((W * H) / 420), small ? 1100 : 900, max);
    const cores = navigator.hardwareConcurrency || 8;
    if (cores <= 4) base *= 0.8;
    if (reduced) base *= 0.6;
    activeCount = clamp(Math.round(base * quality), 200, max);
  }

  function layout() {
    W = Math.max(1, window.innerWidth);
    H = Math.max(1, window.innerHeight);
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    cw = Math.max(1, Math.round(W * dpr));
    ch = Math.max(1, Math.round(H * dpr));

    canvas.width = cw;
    canvas.height = ch;
    scene.width = cw;
    scene.height = ch;
    sctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    blooms.length = 0;
    for (let k = 0; k < 4; k++) {
      const c = document.createElement('canvas');
      c.width = Math.max(2, Math.ceil(cw / Math.pow(2, k + 1)));
      c.height = Math.max(2, Math.ceil(ch / Math.pow(2, k + 1)));
      const g = c.getContext('2d');
      if (g) g.imageSmoothingQuality = 'high';
      blooms.push({ c, g });
    }
    mctx.imageSmoothingEnabled = true;
    mctx.imageSmoothingQuality = 'high';

    // Skala berbasis tinggi/lebar agar bentuk tidak rusak di layar apa pun
    S = Math.min((W * 0.66) / 32, (H * 0.6) / 29);
    cx = W / 2;
    cy = H / 2;
    sizeScale = clamp(S / 11, 0.55, 1.4);

    const nowSmall = isSmallDevice();
    const targetMax = nowSmall ? CONFIG.maxMobile : CONFIG.maxDesktop;
    if (particles.length !== targetMax) {
      small = nowSmall;
      particles = buildParticles(targetMax);
      makeBurstPool(nowSmall ? CONFIG.burstMobile : CONFIG.burstDesktop);
    } else {
      small = nowSmall;
      burstPool.forEach((b) => (b.alive = false));
      particles.forEach((p) => (p.has = false));
    }
    computeActive();
  }

  /* -------------------------------------------------------------- Heartbeat
     Dua denyut (lub-dub) memakai bump cosine -> easing alami, tanpa patahan. */
  const bump = (x) => (x <= -1 || x >= 1 ? 0 : 0.5 * (1 + Math.cos(Math.PI * x)));
  function heartbeat(t, period) {
    let p = (t % period) / period;
    if (p < 0) p += 1;
    return bump((p - 0.12) / 0.13) + 0.62 * bump((p - 0.35) / 0.15);
  }

  /* ------------------------------------------------------------------ Frame */
  function frame(now) {
    requestAnimationFrame(frame);

    let dt = (now - lastNow) / 1000;
    lastNow = now;
    if (!(dt > 0)) dt = 1 / 60;
    dt = Math.min(dt, 0.05);
    time += dt;

    // Adaptive quality: turunkan jumlah partikel bila frame berat
    emaDt += (dt - emaDt) * 0.05;
    if (++frameCount % 90 === 0) {
      if (emaDt > 0.026 && quality > 0.45) {
        quality = Math.max(0.45, quality * 0.85);
        computeActive();
      } else if (emaDt < 0.0175 && quality < 1 && frameCount % 360 === 0) {
        quality = Math.min(1, quality * 1.08);
        computeActive();
      }
    }

    const m = reduced ? 0.25 : 1;
    const period = reduced ? 3.2 : CONFIG.beatPeriod;
    const beatAmp = reduced ? 0.02 : CONFIG.beatScale;
    const push = reduced ? 0.12 : CONFIG.beatPush;

    const g = heartbeat(time, period);
    const gs = 1 + beatAmp * g + 0.007 * Math.sin(time * 0.9) * m;

    // Bersihkan scene dengan fade -> jejak cahaya lembut
    sctx.globalAlpha = 1;
    if (reduced) {
      sctx.globalCompositeOperation = 'source-over';
      sctx.clearRect(0, 0, W, H);
    } else {
      sctx.globalCompositeOperation = 'destination-out';
      sctx.fillStyle = 'rgba(0,0,0,0.32)';
      sctx.fillRect(0, 0, W, H);
    }
    sctx.globalCompositeOperation = 'lighter';
    sctx.lineCap = 'round';

    const ease = 1 - Math.exp(-dt * 5);

    for (let i = 0; i < activeCount; i++) {
      const p = particles[i];

      // riak denyut merambat dari pusat keluar
      const bp = heartbeat(time - p.dist * 0.2, period);
      const e = Math.sin(time * p.eSpd + p.ePh);
      const exc = e > 0 ? p.eAmp * e * e * e : 0; // keluar lalu kembali ke posisi awal
      const radial = exc * m + bp * push * (0.4 + p.dist);

      const wx = Math.sin(time * p.fx + p.p1) * p.ax + Math.sin(time * p.fx * 2.3 + p.p2) * p.ax * 0.35;
      const wy = Math.cos(time * p.fy + p.p2) * p.ax + Math.cos(time * p.fy * 1.9 + p.p1) * p.ax * 0.35;

      const tx = wx * m + p.dx * radial;
      const ty = wy * m + p.dy * radial;
      p.ox += (tx - p.ox) * ease;
      p.oy += (ty - p.oy) * ease;

      const X = cx + (p.hx * gs + p.ox) * S;
      const Y = cy - (p.hy * gs + p.oy) * S;

      const tw = 0.7 + 0.3 * Math.sin(time * p.ts + p.tp);
      let a = p.alpha * tw * (0.8 + 0.35 * g) * 0.62;
      if (a > 1) a = 1;
      const r = p.size * sizeScale * (1 + 0.2 * g) * (0.88 + 0.12 * tw);

      // jejak cahaya pendek pada partikel tertentu
      if (p.trail && !reduced && p.has) {
        const ddx = X - p.sx;
        const ddy = Y - p.sy;
        const d2 = ddx * ddx + ddy * ddy;
        if (d2 > 0.8 && d2 < 900) {
          sctx.globalAlpha = a * 0.8;
          sctx.strokeStyle = COLOR_CSS[p.ci];
          sctx.lineWidth = Math.max(0.6, r * 0.9);
          sctx.beginPath();
          sctx.moveTo(p.sx, p.sy);
          sctx.lineTo(X, Y);
          sctx.stroke();
        }
      }
      p.sx = X;
      p.sy = Y;
      p.has = true;

      const dia = r * 6.5;
      sctx.globalAlpha = a;
      sctx.drawImage(SPRITES[p.ci], X - dia / 2, Y - dia / 2, dia, dia);

      if (p.bright) {
        // halo lebar + inti putih untuk partikel paling terang
        const hd = r * 15;
        sctx.globalAlpha = a * 0.26;
        sctx.drawImage(SPRITES[p.ci], X - hd / 2, Y - hd / 2, hd, hd);
        const cd = r * 3.4;
        sctx.globalAlpha = Math.min(1, a * 1.1);
        sctx.drawImage(WHITE_SPRITE, X - cd / 2, Y - cd / 2, cd, cd);
      }
    }

    /* ---- Burst: pancaran energi dari area hati ---- */
    if (!reduced) {
      const beatIdx = Math.floor((time - 0.12 * period) / period);
      if (beatIdx !== lastBeatIdx) {
        if (lastBeatIdx !== -1) {
          const n = small ? 12 : 26;
          for (let k = 0; k < n; k++) spawnBurst(gs);
        }
        lastBeatIdx = beatIdx;
      }
      spawnAcc += dt * (small ? 7 : 14);
      while (spawnAcc >= 1) {
        spawnAcc -= 1;
        spawnBurst(gs);
      }

      const drag = Math.exp(-dt * 1.1);
      for (let i = 0; i < burstPool.length; i++) {
        const b = burstPool[i];
        if (!b.alive) continue;
        b.life -= dt;
        if (b.life <= 0) {
          b.alive = false;
          continue;
        }
        b.vx = b.vx * drag + Math.cos(time * 3 + b.ph) * dt * S * 1.2;
        b.vy = b.vy * drag + Math.sin(time * 2.6 + b.ph) * dt * S * 1.2;
        b.x += b.vx * dt;
        b.y += b.vy * dt;

        const t01 = 1 - b.life / b.max;
        const fadeIn = t01 < 0.08 ? t01 / 0.08 : 1;
        const a = fadeIn * Math.pow(1 - t01, 1.4);
        const r = b.size * sizeScale;

        // ekor cahaya sebanding dengan kecepatan
        sctx.globalAlpha = a * 0.65;
        sctx.strokeStyle = COLOR_CSS[b.ci];
        sctx.lineWidth = Math.max(0.6, r * 0.9);
        sctx.beginPath();
        sctx.moveTo(b.x - b.vx * 0.09, b.y - b.vy * 0.09);
        sctx.lineTo(b.x, b.y);
        sctx.stroke();

        const dia = r * 7;
        sctx.globalAlpha = a * 0.85;
        sctx.drawImage(SPRITES[b.ci], b.x - dia / 2, b.y - dia / 2, dia, dia);
      }
    }

    sctx.globalAlpha = 1;
    sctx.globalCompositeOperation = 'source-over';

    compose(g);
  }

  /* ----------------------------------------------------------------- Compose */
  function compose(g) {
    mctx.setTransform(1, 0, 0, 1, 0, 0);
    mctx.globalCompositeOperation = 'source-over';
    mctx.globalAlpha = 1;
    mctx.fillStyle = CONFIG.bg;
    mctx.fillRect(0, 0, cw, ch);

    // cahaya ambient lembut di belakang hati, ikut berdenyut
    const rad = S * 24 * (1 + 0.04 * g) * dpr;
    const grd = mctx.createRadialGradient(cx * dpr, cy * dpr, 0, cx * dpr, cy * dpr, rad);
    grd.addColorStop(0, `rgba(255,30,110,${(0.12 + 0.08 * g).toFixed(3)})`);
    grd.addColorStop(0.5, 'rgba(190,10,90,0.045)');
    grd.addColorStop(1, 'rgba(120,0,60,0)');
    mctx.fillStyle = grd;
    mctx.fillRect(0, 0, cw, ch);

    mctx.drawImage(scene, 0, 0);

    // bloom: downscale bertingkat, lalu tambahkan kembali
    let src = scene;
    for (let k = 0; k < blooms.length; k++) {
      const b = blooms[k];
      b.g.globalCompositeOperation = 'source-over';
      b.g.clearRect(0, 0, b.c.width, b.c.height);
      b.g.drawImage(src, 0, 0, b.c.width, b.c.height);
      src = b.c;
    }
    mctx.globalCompositeOperation = 'lighter';
    const pulse = 0.85 + 0.3 * g;
    for (let k = 1; k < blooms.length; k++) {
      mctx.globalAlpha = BLOOM_ALPHA[k] * pulse;
      mctx.drawImage(blooms[k].c, 0, 0, cw, ch);
    }
    mctx.globalAlpha = 1;
    mctx.globalCompositeOperation = 'source-over';
  }

  /* ------------------------------------------------------------------ Resize */
  let resizePending = false;
  function scheduleResize() {
    if (resizePending) return;
    resizePending = true;
    requestAnimationFrame(() => {
      resizePending = false;
      layout();
    });
  }

  window.addEventListener('resize', scheduleResize);
  window.addEventListener('orientationchange', scheduleResize);
  if (typeof ResizeObserver !== 'undefined') {
    new ResizeObserver(scheduleResize).observe(document.documentElement);
  }
  document.addEventListener('visibilitychange', () => {
    lastNow = performance.now();
  });

  /* ------------------------------------------------------------------- Start */
  layout();
  lastNow = performance.now();
  requestAnimationFrame(frame);
})();
