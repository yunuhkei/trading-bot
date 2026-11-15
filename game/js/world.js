'use strict';
// World: the island of Port Calvary. A ragged city on the south shore with a harbor, hills and
// forest in the middle, a lighthouse on the east cape, and snowy mountains and the village of
// Whitepine in the far north. Also collision, weather, sky and the map.
(function () {
  const T = THREE;
  const P = 60, NB = 8, HALF = 240;
  const MAP = { x0: -840, z0: -1320, x1: 840, z1: 464 };
  const CELL = 8, NX = (MAP.x1 - MAP.x0) / CELL + 1, NZ = (MAP.z1 - MAP.z0) / CELL + 1;
  const SEA = -1.2;
  const ISL = { cx: 0, cz: -470, rx: 720, rz: 800 };
  const VIL = { x: -80, z: -1030, y: 50 };
  const W = (G.world = { P, NB, HALF, MAP, SEA, VIL, boxes: [], signs: [], lotSpots: [], decks: [], roads: [], roadSamples: [], blinkers: [] });
  const rng = G.mulberry32(911);
  const rr = (a, b) => a + rng() * (b - a);
  const rpick = (arr) => arr[(rng() * arr.length) | 0];
  const clamp = G.clamp;
  const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

  W.blockCenter = (i) => (i - 3.5) * P;
  W.blockIndex = (v) => Math.max(0, Math.min(NB - 1, Math.floor((v + HALF) / P)));
  W.roadLine = (k) => k * P - HALF;
  W.roadIndex = (v) => Math.max(0, Math.min(NB, Math.round((v + HALF) / P)));

  const SPECIAL = { '4,3': 'laundromat', '0,6': 'motel', '5,5': 'church', '2,4': 'park', '6,1': 'lot' };
  W.SPECIAL = SPECIAL;
  // blocks left empty so the city has a ragged edge instead of a square
  const EMPTY = new Set(['0,0', '1,0', '2,0', '0,1', '0,2', '7,1', '7,5', '7,6', '7,7', '6,7', '5,7', '0,7']);
  W.isActive = (i, j) => i >= 0 && j >= 0 && i < NB && j < NB && !EMPTY.has(i + ',' + j);
  const ACTIVE = [];
  for (let i = 0; i < NB; i++) for (let j = 0; j < NB; j++) {
    if (!W.isActive(i, j)) continue;
    const cx = W.blockCenter(i), cz = W.blockCenter(j);
    ACTIVE.push({ i, j, x0: cx - 30, x1: cx + 30, z0: cz - 30, z1: cz + 30 });
  }
  // distance from the built-up city (blocks plus their streets)
  function cityDist(x, z) {
    if (x < -360 || x > 360 || z < -360 || z > 360) return 999;
    let best = 1e9;
    for (const r of ACTIVE) {
      const dx = Math.max(r.x0 - x, 0, x - r.x1), dz = Math.max(r.z0 - z, 0, z - r.z1);
      const d = dx * dx + dz * dz;
      if (d < best) best = d;
    }
    return Math.sqrt(best);
  }
  W.cityDist = cityDist;
  W.inCity = (x, z) => cityDist(x, z) < 6;

  const _c = new T.Color();
  const lin = (hex, k = 1) => { _c.set(hex); return [_c.r * k, _c.g * k, _c.b * k]; };
  W.lin = lin;

  // ------------------------------------------------------------ noise
  function hash2(ix, iz) {
    let h = (Math.imul(ix, 374761393) + Math.imul(iz, 668265263) + 1013904223) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  }
  function vnoise(x, z) {
    const ix = Math.floor(x), iz = Math.floor(z), fx = x - ix, fz = z - iz;
    const u = fx * fx * (3 - 2 * fx), v = fz * fz * (3 - 2 * fz);
    const a = hash2(ix, iz), b = hash2(ix + 1, iz), c = hash2(ix, iz + 1), d = hash2(ix + 1, iz + 1);
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  }
  function fbm(x, z, o) { let s = 0, a = 0.5, f = 1, n = 0; for (let k = 0; k < o; k++) { s += a * vnoise(x * f, z * f); n += a; a *= 0.5; f *= 2.03; } return s / n; }
  function ridged(x, z, o) { let s = 0, a = 0.5, f = 1, n = 0; for (let k = 0; k < o; k++) { const r = 1 - Math.abs(2 * vnoise(x * f + 17, z * f + 31) - 1); s += a * r * r; n += a; a *= 0.5; f *= 2.1; } return s / n; }

  // > 0 on land (roughly: fraction of the island radius inland), < 0 at sea
  function landF(x, z) {
    const dx = (x - ISL.cx) / ISL.rx, dz = (z - ISL.cz) / ISL.rz;
    const d = Math.hypot(dx, dz), th = Math.atan2(dz, dx);
    const south = Math.exp(-Math.pow(G.wrapAngle(th - Math.PI / 2) / 0.55, 2));
    const wob = (0.11 * Math.sin(3 * th + 1.3) + 0.07 * Math.sin(5 * th + 0.4) + 0.045 * Math.sin(9 * th + 2.1) +
      0.16 * (vnoise(Math.cos(th) * 2.5 + 10, Math.sin(th) * 2.5 + 10) - 0.5)) * (1 - 0.85 * south);
    let L = 1 + wob - d;
    const cd = cityDist(x, z);
    if (cd < 70) L = Math.max(L, ((70 - cd) / 70) * 0.12);
    return L;
  }
  W.landF = landF;
  const northF = (z) => clamp((-z - 420) / 520, 0, 1);
  // how snowy it is (0..1). Pass x too and the snow line wanders instead of running straight.
  W.snowAt = (z, x) => smooth(-660, -800, x === undefined ? z : z + (vnoise(x / 140 + 3, 7.7) - 0.5) * 230 + (vnoise(x / 45, 2.2) - 0.5) * 60);

  function natural(x, z, plateau) {
    const L = landF(x, z);
    if (L <= 0) return Math.max(-24, SEA - 0.8 + L * 70);
    let h = -1.8 + 3.8 * smooth(0, 0.07, L);
    const inland = smooth(0.05, 0.22, L);
    h += (fbm(x / 240 + 5, z / 240 + 9, 4) - 0.4) * 34 * inland;
    const nf = northF(z);
    if (nf > 0) {
      const valley = smooth(30, 210, Math.abs(x + 60 * Math.sin(z / 170)));
      h += nf * nf * (55 + 190 * ridged(x / 300, z / 300, 4)) * (0.22 + 0.78 * valley) * smooth(0.03, 0.3, L);
    }
    if (plateau) {
      const dv = Math.hypot(x - VIL.x, z - VIL.z);
      if (dv < 170) h = G.lerp(VIL.y, h, smooth(75, 170, dv));
      if (W.lighthouse) { const dl = Math.hypot(x - W.lighthouse.x, z - W.lighthouse.z); if (dl < 40) h = G.lerp(W.lighthouse.y, h, smooth(14, 40, dl)); }
    }
    return h;
  }

  // ------------------------------------------------------------ heightmap
  const HM = new Float32Array(NX * NZ);
  function hm(x, z) {
    const fx = (x - MAP.x0) / CELL, fz = (z - MAP.z0) / CELL;
    if (fx < 0 || fz < 0 || fx >= NX - 1 || fz >= NZ - 1) return -24;
    const ix = Math.floor(fx), iz = Math.floor(fz), u = fx - ix, v = fz - iz, i = iz * NX + ix;
    const a = HM[i], b = HM[i + 1], c = HM[i + NX], d = HM[i + NX + 1];
    return u + v <= 1 ? a + (b - a) * u + (c - a) * v : d + (c - d) * (1 - u) + (b - d) * (1 - v);
  }
  W.terrainH = hm;

  // ------------------------------------------------------------ collision grid
  const GC = 40, GNX = Math.ceil((MAP.x1 - MAP.x0) / GC), GNZ = Math.ceil((MAP.z1 - MAP.z0) / GC);
  const grid = new Array(GNX * GNZ);
  for (let k = 0; k < grid.length; k++) grid[k] = [];
  const gx = (x) => clamp(Math.floor((x - MAP.x0) / GC), 0, GNX - 1);
  const gz = (z) => clamp(Math.floor((z - MAP.z0) / GC), 0, GNZ - 1);
  function addBox(b) {
    W.boxes.push(b);
    for (let a = gx(b.minX - 2.5); a <= gx(b.maxX + 2.5); a++) for (let c = gz(b.minZ - 2.5); c <= gz(b.maxZ + 2.5); c++) grid[c * GNX + a].push(b);
  }
  W.addBox = addBox;
  let stamp = 1;
  function boxesIn(x0, z0, x1, z1, out) {
    stamp++;
    out.length = 0;
    for (let a = gx(x0); a <= gx(x1); a++) for (let c = gz(z0); c <= gz(z1); c++) {
      for (const b of grid[c * GNX + a]) if (b._s !== stamp) { b._s = stamp; out.push(b); }
    }
    return out;
  }
  const near = [];
  // ------------------------------------------------------------ geometry builder
  class Builder {
    constructor() { this.p = []; this.n = []; this.u = []; this.c = []; this.i = []; this.v = 0; this.flatRoof = false; }
    quad(a, b, c, d, nx, ny, nz, ua, ub, uc, ud, col) {
      this.p.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2], d[0], d[1], d[2]);
      for (let k = 0; k < 4; k++) { this.n.push(nx, ny, nz); this.c.push(col[0], col[1], col[2]); }
      this.u.push(ua[0], ua[1], ub[0], ub[1], uc[0], uc[1], ud[0], ud[1]);
      const v = this.v;
      this.i.push(v, v + 1, v + 2, v, v + 2, v + 3);
      this.v += 4;
    }
    box(cx, cy, cz, sx, sy, sz, col, S = 0, ou = 0, ov = 0) {
      const x0 = cx - sx / 2, x1 = cx + sx / 2, y0 = cy - sy / 2, y1 = cy + sy / 2, z0 = cz - sz / 2, z1 = cz + sz / 2;
      const f = S ? (u, v) => [u / S + ou, v / S + ov] : () => [0.002, 0.002];
      this.quad([x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1], 1, 0, 0, f(-z1, y0), f(-z0, y0), f(-z0, y1), f(-z1, y1), col);
      this.quad([x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], -1, 0, 0, f(z0, y0), f(z1, y0), f(z1, y1), f(z0, y1), col);
      this.quad([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], 0, 0, 1, f(x0, y0), f(x1, y0), f(x1, y1), f(x0, y1), col);
      this.quad([x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0], 0, 0, -1, f(-x1, y0), f(-x0, y0), f(-x0, y1), f(-x1, y1), col);
      const g = this.flatRoof || !S ? () => [0.002, 0.002] : (u, v) => [u / S, v / S];
      this.quad([x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0], 0, 1, 0, g(x0, -z1), g(x1, -z1), g(x1, -z0), g(x0, -z0), col);
    }
    disc(x, y, z, r, col) {
      this.quad([x - r, y, z + r], [x + r, y, z + r], [x + r, y, z - r], [x - r, y, z - r], 0, 1, 0, [0, 0], [1, 0], [1, 1], [0, 1], col);
    }
    geometry() {
      const g = new T.BufferGeometry();
      g.setAttribute('position', new T.Float32BufferAttribute(this.p, 3));
      g.setAttribute('normal', new T.Float32BufferAttribute(this.n, 3));
      g.setAttribute('uv', new T.Float32BufferAttribute(this.u, 2));
      g.setAttribute('color', new T.Float32BufferAttribute(this.c, 3));
      g.setIndex(this.i);
      g.computeBoundingSphere();
      return g;
    }
  }

  function cnv(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
  function tex(c, repeat) {
    const t = new T.CanvasTexture(c);
    t.colorSpace = T.SRGBColorSpace;
    if (repeat) { t.wrapS = t.wrapT = T.RepeatWrapping; }
    return t;
  }
  function makeWallTextures() {
    const N = 512, cells = 8, cs = N / cells;
    const a = cnv(N, N), x = a.getContext('2d');
    const e = cnv(N, N), y = e.getContext('2d');
    x.fillStyle = '#6b6b6b'; x.fillRect(0, 0, N, N);
    for (let k = 0; k < 5000; k++) {
      const g = (60 + Math.random() * 70) | 0;
      x.fillStyle = `rgba(${g},${g},${g},0.25)`;
      x.fillRect(Math.random() * N, Math.random() * N, 2 + Math.random() * 5, 2 + Math.random() * 5);
    }
    for (let k = 0; k < 70; k++) {
      x.fillStyle = 'rgba(15,15,15,0.18)';
      x.fillRect(Math.random() * N, Math.random() * N, 2 + Math.random() * 4, 40 + Math.random() * 220);
    }
    y.fillStyle = '#000'; y.fillRect(0, 0, N, N);
    const warm = ['#ffcf7a', '#ffb85c', '#ffe2a8', '#f5a35a', '#ffd9a0'];
    for (let cx = 0; cx < cells; cx++) {
      for (let cy = 0; cy < cells; cy++) {
        const wx = cx * cs + 12, wy = cy * cs + 14, ww = cs - 24, wh = cs - 28;
        x.fillStyle = '#2c2c2c'; x.fillRect(wx - 3, wy + wh, ww + 6, 5); // sill
        const r = Math.random();
        if (r < 0.26) {
          const c = r < 0.03 ? '#8fc3ff' : r < 0.045 ? '#ff5a5a' : warm[(Math.random() * warm.length) | 0];
          x.fillStyle = c; x.fillRect(wx, wy, ww, wh);
          y.fillStyle = c; y.fillRect(wx, wy, ww, wh);
          if (Math.random() < 0.5) {
            y.fillStyle = 'rgba(0,0,0,0.45)';
            for (let l = 0; l < wh; l += 6) y.fillRect(wx, wy + l, ww, 2);
          }
          if (Math.random() < 0.3) { y.fillStyle = 'rgba(0,0,0,0.7)'; y.fillRect(wx + ww * 0.3, wy + wh * 0.35, ww * 0.25, wh * 0.65); }
        } else {
          const g = x.createLinearGradient(0, wy, 0, wy + wh);
          g.addColorStop(0, '#202a38'); g.addColorStop(1, '#0c1016');
          x.fillStyle = g; x.fillRect(wx, wy, ww, wh);
          if (Math.random() < 0.08) { x.fillStyle = '#05070a'; x.fillRect(wx, wy, ww, wh); } // boarded
        }
      }
    }
    const wt = tex(a, true), et = tex(e, true);
    return { wt, et };
  }
  function makeAsphalt() {
    const N = 256, c = cnv(N, N), x = c.getContext('2d');
    x.fillStyle = '#3a3c41'; x.fillRect(0, 0, N, N);
    for (let k = 0; k < 9000; k++) {
      const g = (40 + Math.random() * 40) | 0;
      x.fillStyle = `rgba(${g},${g},${g + 4},0.5)`;
      x.fillRect(Math.random() * N, Math.random() * N, 1 + Math.random() * 2, 1 + Math.random() * 2);
    }
    for (let k = 0; k < 6; k++) { // wet patches
      const px = Math.random() * N, py = Math.random() * N, r = 20 + Math.random() * 50;
      const g = x.createRadialGradient(px, py, 0, px, py, r);
      g.addColorStop(0, 'rgba(10,12,16,0.55)'); g.addColorStop(1, 'rgba(10,12,16,0)');
      x.fillStyle = g; x.fillRect(px - r, py - r, r * 2, r * 2);
    }
    x.strokeStyle = 'rgba(15,15,18,0.6)'; x.lineWidth = 1;
    for (let k = 0; k < 5; k++) {
      x.beginPath(); let px = Math.random() * N, py = Math.random() * N; x.moveTo(px, py);
      for (let s = 0; s < 8; s++) { px += (Math.random() - 0.5) * 30; py += (Math.random() - 0.5) * 30; x.lineTo(px, py); }
      x.stroke();
    }
    return tex(c, true);
  }
  function makeNoise() {
    const N = 128, c = cnv(N, N), x = c.getContext('2d');
    x.fillStyle = '#a0a0a0'; x.fillRect(0, 0, N, N);
    for (let k = 0; k < 2500; k++) {
      const g = (110 + Math.random() * 90) | 0;
      x.fillStyle = `rgba(${g},${g},${g},0.45)`;
      x.fillRect(Math.random() * N, Math.random() * N, 1 + Math.random() * 3, 1 + Math.random() * 3);
    }
    x.fillStyle = 'rgba(40,40,40,0.5)';
    x.fillRect(0, 0, N, 2); x.fillRect(0, 0, 2, N); // slab seams
    return tex(c, true);
  }
  function makeRadial() {
    const c = cnv(64, 64), x = c.getContext('2d');
    const g = x.createRadialGradient(32, 32, 0, 32, 32, 32);
    g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.35, 'rgba(255,255,255,0.45)'); g.addColorStop(1, 'rgba(255,255,255,0)');
    x.fillStyle = g; x.fillRect(0, 0, 64, 64);
    return new T.CanvasTexture(c);
  }
  function neonTex(text, color) {
    const fs = 84, font = `700 ${fs}px "Barlow Condensed", Impact, "Arial Narrow", sans-serif`;
    const m = cnv(4, 4).getContext('2d'); m.font = font;
    const w = Math.ceil(m.measureText(text).width) + 70, h = 130;
    const c = cnv(w, h), x = c.getContext('2d');
    x.font = font; x.textAlign = 'center'; x.textBaseline = 'middle';
    x.shadowColor = color; x.shadowBlur = 26; x.fillStyle = color;
    x.fillText(text, w / 2, h / 2 + 4); x.shadowBlur = 12; x.fillText(text, w / 2, h / 2 + 4);
    x.shadowBlur = 0; x.lineWidth = 2.5; x.strokeStyle = 'rgba(255,255,255,0.75)';
    x.strokeText(text, w / 2, h / 2 + 4);
    return { t: tex(c, false), aspect: w / h };
  }

  // ------------------------------------------------------------ palettes
  const TINTS = ['#8a8580', '#7a6e66', '#73594d', '#5f6670', '#8c7d6a', '#57524f', '#7d6b5e', '#4f5a5f', '#9a8f84', '#6d5146'].map((h) => lin(h));
  const SIDEWALK = lin('#55575d'), CORNICE = lin('#2e2f33'), JUNK = lin('#3a3b3f'), POLE = lin('#1d1f23');
  const STONE = lin('#6c6862'), TRUNK = lin('#2a1f18'), CONC = lin('#46484c');
  const STORE = ['#5a3d14', '#2c4a52', '#4d1f1f', '#2a4a34', '#4a3a5a', '#5a4a2a'].map((h) => lin(h));
  const AWN = ['#4a1010', '#103a2a', '#1f2a4a', '#3a2a10'].map((h) => lin(h));
  const SIGNS = ['LIQUOR', 'PAWN', 'BAIL BONDS', 'OPEN 24H', 'BAR', 'HOTEL', 'CHECKS CASHED', 'NOODLES', 'PHARMACY', 'DINER', 'TATTOO', 'KARAOKE', 'LOANS', 'GOLD BOUGHT', 'PALM READER', 'CLUB VESPER', 'DONUTS', 'DOLLAR+'];
  const NEON = ['#ff2a4a', '#2ae0ff', '#ff9a1f', '#b54bff', '#3dff88', '#ff4fd8', '#ffe14a'];

  let walls, plain, glow, lamps, scene;

  function addBuilding(i, j, x0, x1, z0, z1, h, o = {}) {
    const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2, sx = x1 - x0, sz = z1 - z0;
    const tint = o.tint ? lin(o.tint) : rpick(TINTS);
    walls.box(cx, h / 2, cz, sx, h, sz, tint, 24, rng(), 0);
    plain.box(cx, h + 0.2, cz, sx + 0.4, 0.4, sz + 0.4, CORNICE, 4);
    const n = (rng() * 3) | 0;
    for (let k = 0; k < n && sx > 5 && sz > 5; k++) {
      const bw = rr(1.2, 3), bd = rr(1.2, 3), bh = rr(0.8, 2.4);
      plain.box(rr(x0 + 2, x1 - 2), h + 0.4 + bh / 2, rr(z0 + 2, z1 - 2), bw, bh, bd, JUNK, 4);
    }
    if (h > 18 && sx > 6 && sz > 6 && rng() < 0.22) {
      const tx = rr(x0 + 3, x1 - 3), tz = rr(z0 + 3, z1 - 3);
      for (const [a, b] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) plain.box(tx + a, h + 1.5, tz + b, 0.15, 3, 0.15, POLE, 0);
      plain.box(tx, h + 4.2, tz, 2.6, 2.6, 2.6, lin('#3b2c22'), 4);
    }
    if (h > 55) lamps.box(cx, h + 1.2, cz, 0.35, 0.35, 0.35, lin('#ff1a1a'));
    const b = { minX: x0, maxX: x1, minZ: z0, maxZ: z1, h };
    addBox(b);
    if (!o.noFacade && i >= 0) decorateFacades(i, j, b);
    return b;
  }

  function decorateFacades(i, j, b) {
    const bcx = W.blockCenter(i), bcz = W.blockCenter(j);
    const faces = [];
    if (b.maxX - bcx > 15.5) faces.push([1, 0]);
    if (bcx - b.minX > 15.5) faces.push([-1, 0]);
    if (b.maxZ - bcz > 15.5) faces.push([0, 1]);
    if (bcz - b.minZ > 15.5) faces.push([0, -1]);
    for (const [nx, nz] of faces) {
      const a0 = nx ? b.minZ : b.minX, a1 = nx ? b.maxZ : b.maxX;
      const len = a1 - a0, mid = (a0 + a1) / 2;
      const fx = nx > 0 ? b.maxX : b.minX, fz = nz > 0 ? b.maxZ : b.minZ;
      if (rng() < 0.5) {
        const col = rpick(STORE), w = len * 0.7;
        if (nx) lamps.box(fx + nx * 0.05, 1.5, mid, 0.06, 2.1, w, col);
        else lamps.box(mid, 1.5, fz + nz * 0.05, w, 2.1, 0.06, col);
        if (rng() < 0.5) {
          const ac = rpick(AWN);
          if (nx) plain.box(fx + nx * 0.7, 2.9, mid, 1.4, 0.12, w, ac, 0);
          else plain.box(mid, 2.9, fz + nz * 0.7, w, 0.12, 1.4, ac, 0);
        }
        const gx = nx ? fx + nx * 2.2 : mid, gz = nz ? fz + nz * 2.2 : mid;
        glow.disc(gx, 0.16, gz, Math.min(4.5, w * 0.5), [col[0] * 1.8, col[1] * 1.8, col[2] * 1.8]);
      }
      if (rng() < 0.3) {
        const text = rpick(SIGNS), color = rpick(NEON);
        const pos = mid + rr(-len * 0.2, len * 0.2);
        addSign(text, color, nx ? fx : pos, rr(4.2, 6.5), nz ? fz : pos, nx, nz, 1.2, rng() < 0.3 ? 0.06 : 0);
      }
    }
  }

  function addSign(text, color, x, y, z, nx, nz, height, flick, opts = {}) {
    const { t, aspect } = neonTex(text, color);
    const w = height * aspect;
    const m = new T.Mesh(new T.PlaneGeometry(w, height),
      new T.MeshBasicMaterial({ map: t, transparent: true, blending: T.AdditiveBlending, depthWrite: false, fog: opts.fog !== false }));
    m.position.set(x + nx * 0.14, y, z + nz * 0.14);
    m.rotation.y = Math.atan2(nx, nz);
    scene.add(m);
    if (!opts.noBoard) {
      plain.box(x + nx * 0.07, y, z + nz * 0.07, Math.abs(nz) > 0.5 ? w + 0.3 : 0.1, height + 0.3, Math.abs(nx) > 0.5 ? w + 0.3 : 0.1, lin('#121316'), 0);
    }
    const gc = lin(color, 0.35);
    if (!opts.noPool) glow.disc(x + nx * 2.4, 0.17, z + nz * 2.4, Math.max(2.5, w * 0.55), gc);
    if (flick) W.signs.push({ m, flick, t: 0, on: true });
    return m;
  }

  function addLamps(i, j) {
    const cx = W.blockCenter(i), cz = W.blockCenter(j);
    const spots = [[21, -11, 1, 0], [21, 11, 1, 0], [-21, -11, -1, 0], [-21, 11, -1, 0], [-11, 21, 0, 1], [11, 21, 0, 1], [-11, -21, 0, -1], [11, -21, 0, -1]];
    for (const [lx, lz, nx, nz] of spots) {
      const x = cx + lx, z = cz + lz;
      plain.box(x, 3.1, z, 0.16, 6.2, 0.16, POLE, 0);
      plain.box(x + nx * 0.8, 6.15, z + nz * 0.8, nx ? 1.6 : 0.1, 0.1, nz ? 1.6 : 0.1, POLE, 0);
      const hx = x + nx * 1.5, hz = z + nz * 1.5;
      const r = rng();
      if (r < 0.15) { plain.box(hx, 6.05, hz, 0.5, 0.16, 0.42, lin('#202020'), 0); continue; }
      const cold = r > 0.86;
      lamps.box(hx, 6.02, hz, 0.55, 0.12, 0.42, cold ? lin('#e4f2ff') : lin('#ffd08a'));
      glow.disc(hx, 0.18, hz, 6.5, cold ? lin('#7fa8d8', 0.22) : lin('#ffa040', 0.32));
    }
  }

  function buildCityBlock(i, j, x0, x1, z0, z1) {
    const w = x1 - x0, d = z1 - z0, r = rng(), lots = [];
    if (r < 0.22) lots.push([x0, x1, z0, z1]);
    else if (r < 0.6) {
      if (w >= d) { const c = x0 + w * rr(0.38, 0.62); lots.push([x0, c - 1, z0, z1], [c + 1, x1, z0, z1]); }
      else { const c = z0 + d * rr(0.38, 0.62); lots.push([x0, x1, z0, c - 1], [x0, x1, c + 1, z1]); }
    } else {
      const cx = x0 + w * rr(0.38, 0.62), cz = z0 + d * rr(0.38, 0.62);
      lots.push([x0, cx - 1, z0, cz - 1], [cx + 1, x1, z0, cz - 1], [x0, cx - 1, cz + 1, z1], [cx + 1, x1, cz + 1, z1]);
    }
    const bx = W.blockCenter(i), bz = W.blockCenter(j);
    const df = Math.max(0, 1 - Math.hypot(bx - 20, bz + 10) / 230);
    for (const L of lots) addBuilding(i, j, L[0], L[1], L[2], L[3], 9 + rr(0, 14) + df * df * rr(10, 62));
  }

  const trees = [];
  function buildPark(i, j) {
    const cx = W.blockCenter(i), cz = W.blockCenter(j);
    plain.box(cx, 0.15, cz, 38, 0.08, 38, lin('#1a281b'), 3);
    plain.box(cx, 0.2, cz, 3, 0.04, 38, lin('#4a463f'), 3);
    plain.box(cx, 0.2, cz, 38, 0.04, 3, lin('#4a463f'), 3);
    // headless saint on a plinth
    plain.box(cx, 0.9, cz, 2.4, 1.4, 2.4, STONE, 3);
    plain.box(cx, 2.5, cz, 0.8, 1.8, 0.55, STONE, 3);
    plain.box(cx - 0.55, 2.7, cz + 0.2, 0.25, 1.1, 0.25, STONE, 3);
    plain.box(cx + 0.55, 3.35, cz + 0.1, 0.25, 0.25, 0.9, STONE, 3);
    const pb = { minX: cx - 1.2, maxX: cx + 1.2, minZ: cz - 1.2, maxZ: cz + 1.2, h: 3.4 };
    addBox(pb);
    for (let k = 0; k < 26; k++) {
      const lx = rr(-17, 17), lz = rr(-17, 17);
      if (Math.abs(lx) < 3.5 || Math.abs(lz) < 3.5) continue;
      const x = cx + lx, z = cz + lz;
      plain.box(x, 1.2, z, 0.35, 2.4, 0.35, TRUNK, 0);
      trees.push([x, z, rr(0.8, 1.3)]);
      const tb = { minX: x - 0.3, maxX: x + 0.3, minZ: z - 0.3, maxZ: z + 0.3, h: 6 };
      addBox(tb);
    }
    for (const s of [-1, 1]) {
      plain.box(cx + s * 6, 0.45, cz + 2.2, 2.2, 0.12, 0.6, lin('#2a1f16'), 0);
      plain.box(cx + 2.2, 0.45, cz + s * 8, 0.6, 0.12, 2.2, lin('#2a1f16'), 0);
    }
    // burn barrel
    plain.box(cx - 9, 0.55, cz - 2.6, 0.7, 0.9, 0.7, lin('#3a2416'), 0);
    lamps.box(cx - 9, 1.05, cz - 2.6, 0.5, 0.12, 0.5, lin('#ff7a1a'));
    glow.disc(cx - 9, 0.22, cz - 2.6, 4, lin('#ff6a10', 0.4));
  }

  function buildLot(i, j) {
    const cx = W.blockCenter(i), cz = W.blockCenter(j);
    plain.box(cx, 0.14, cz, 42, 0.06, 42, lin('#222428'), 4);
    for (const row of [-9, 9]) {
      for (let lx = -16; lx <= 16; lx += 4) {
        plain.box(cx + lx, 0.18, cz + row, 0.12, 0.02, 5, lin('#8a8a80'), 0);
        if (lx < 16) W.lotSpots.push({ x: cx + lx + 2, z: cz + row, h: row < 0 ? 0 : Math.PI });
      }
    }
    for (let a = -19; a <= 19; a += 3.8) {
      for (const [x, z] of [[cx + a, cz + 19], [cx - 19, cz + a], [cx + 19, cz + a]]) plain.box(x, 0.9, z, 0.08, 1.8, 0.08, POLE, 0);
      if (Math.abs(a) > 5) plain.box(cx + a, 0.9, cz - 19, 0.08, 1.8, 0.08, POLE, 0);
    }
    plain.box(cx, 1.75, cz + 19, 38, 0.06, 0.06, POLE, 0);
    plain.box(cx - 19, 1.75, cz, 0.06, 0.06, 38, POLE, 0);
    plain.box(cx + 19, 1.75, cz, 0.06, 0.06, 38, POLE, 0);
    addBuilding(i, j, cx + 13, cx + 16.5, cz - 16.5, cz - 13, 3.2, { noFacade: true, tint: '#5a5a52' });
    lamps.box(cx + 13 - 0.04, 1.6, cz - 14.7, 0.06, 1, 2, lin('#c8d8a8', 0.5));
    addSign('PARK $5', '#ffe14a', cx, 3.8, cz - 21.5, 0, -1, 1, 0.1, {});
  }

  function buildLaundromat(i, j) {
    const cx = W.blockCenter(i), cz = W.blockCenter(j);
    addBuilding(i, j, cx - 8, cx + 8, cz - 18, cz - 8, 7, { noFacade: true, tint: '#7d7468' });
    addBuilding(i, j, cx - 18, cx - 10, cz - 18, cz - 8, 15);
    addBuilding(i, j, cx + 10, cx + 18, cz - 18, cz - 8, 22);
    addBuilding(i, j, cx - 18, cx - 1, cz - 6, cz + 18, 34);
    addBuilding(i, j, cx + 1, cx + 18, cz - 6, cz + 18, 48);
    const fz = cz - 18;
    lamps.box(cx, 1.7, fz - 0.05, 13, 2.4, 0.06, lin('#a8e0ee', 0.36));
    for (let k = -5; k <= 5; k += 2) plain.box(cx + k, 1.2, fz - 0.08, 1.1, 1.1, 0.04, lin('#d8dcdc'), 0); // washer doors
    glow.disc(cx, 0.16, fz - 2.5, 5.5, lin('#7fd8ff', 0.3));
    addSign('ST. AGNES WASH', '#ff4fd8', cx, 5.3, fz, 0, -1, 1.5, 0.05);
    addSign('COIN-OP · OPEN 24H', '#2ae0ff', cx + 5.5, 3.3, fz, 0, -1, 0.6, 0, { noPool: true });
  }

  function buildMotel(i, j) {
    const cx = W.blockCenter(i), cz = W.blockCenter(j);
    addBuilding(i, j, cx + 6, cx + 16, cz - 16, cz + 16, 7, { noFacade: true, tint: '#8a7a66' });
    addBuilding(i, j, cx - 18, cx + 3, cz - 18, cz - 2, 20);
    addBuilding(i, j, cx - 18, cx + 3, cz, cz + 18, 26);
    const fx = cx + 16;
    plain.box(fx + 0.9, 3.4, cz, 1.8, 0.15, 32, lin('#2a2520'), 0); // walkway roof
    for (let k = 0; k < 7; k++) {
      const z = cz - 12 + k * 4;
      const room9 = k === 3;
      lamps.box(fx + 0.04, 1.1, z, 0.06, 2.0, 1.0, room9 ? lin('#c88a3a', 0.8) : lin('#4a3a22', 0.6));
      lamps.box(fx + 0.1, 2.7, z + 0.9, 0.2, 0.2, 0.2, lin('#ffd08a'));
      glow.disc(fx + 1.5, 0.16, z, 2.6, lin('#ffb060', room9 ? 0.45 : 0.22));
      lamps.box(fx + 0.05, 1.4, z + 1.9, 0.06, 1.2, 1.6, lin('#2a1a10', 0.7)); // curtained window
    }
    addSign('9', '#ffb44a', fx, 2.55, cz, 1, 0, 0.5, 0, { noPool: true, noBoard: true });
    plain.box(cx + 19, 4.5, cz - 17, 0.35, 9, 0.35, POLE, 0);
    addSign('CALVARY MOTEL', '#ff2a4a', cx + 19, 8.6, cz - 17, 1, 0, 1.4, 0.03);
    addSign('VACANCY', '#ff9a1f', cx + 19, 7.2, cz - 17, 1, 0, 0.7, 0.25, { noPool: true });
  }

  function buildChurch(i, j) {
    const cx = W.blockCenter(i), cz = W.blockCenter(j);
    addBuilding(i, j, cx - 7, cx + 7, cz - 10, cz + 14, 15, { noFacade: true, tint: '#5b5550' });
    addBuilding(i, j, cx - 3.5, cx + 3.5, cz - 16, cz - 10, 36, { noFacade: true, tint: '#55504b' });
    plain.box(cx, 40, cz - 13, 2.2, 8, 2.2, lin('#2a2826'), 0);
    for (let k = -8; k <= 10; k += 6) {
      lamps.box(cx - 7.05, 7, cz + k, 0.06, 5, 1.4, lin('#5a1830', 0.6));
      lamps.box(cx + 7.05, 7, cz + k, 0.06, 5, 1.4, lin('#183a5a', 0.6));
    }
    addSign('JESUS SAVES', '#ff2030', cx, 10, cz - 16, 0, -1, 1.6, 0.04);
    for (let gx = -17; gx <= 17; gx += 3) {
      if (Math.abs(gx) < 9.5) continue;
      for (let gz = -14; gz <= 16; gz += 3) plain.box(cx + gx, 0.65, cz + gz, 0.8, 1.0 + rng() * 0.5, 0.22, STONE, 3);
    }
  }

  // ------------------------------------------------------------ roads (shared helpers)
  function resample(pts, step) {
    const out = [{ x: pts[0].x, z: pts[0].z }];
    let carry = 0;
    for (let k = 1; k < pts.length; k++) {
      const a = pts[k - 1], b = pts[k];
      const L = Math.hypot(b.x - a.x, b.z - a.z);
      let s = step - carry;
      while (s <= L) { const t = s / L; out.push({ x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t }); s += step; }
      carry = L - (s - step);
    }
    const l = pts[pts.length - 1];
    if (Math.hypot(out[out.length - 1].x - l.x, out[out.length - 1].z - l.z) > step * 0.3) out.push({ x: l.x, z: l.z });
    return out;
  }
  function catmull(ctrl, step) {
    const dense = [];
    for (let k = 0; k < ctrl.length - 1; k++) {
      const p0 = ctrl[Math.max(0, k - 1)], p1 = ctrl[k], p2 = ctrl[k + 1], p3 = ctrl[Math.min(ctrl.length - 1, k + 2)];
      for (let t = 0; t < 1; t += 0.05) {
        const t2 = t * t, t3 = t2 * t;
        const f = (a, b, c, d) => 0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
        dense.push({ x: f(p0.x, p1.x, p2.x, p3.x), z: f(p0.z, p1.z, p2.z, p3.z) });
      }
    }
    dense.push(ctrl[ctrl.length - 1]);
    return resample(dense, step);
  }
  function marchCoast(th, Lstop) {
    let px = ISL.cx, pz = ISL.cz;
    for (let s = 0.25; s < 1.5; s += 0.004) {
      const x = ISL.cx + Math.cos(th) * s * ISL.rx, z = ISL.cz + Math.sin(th) * s * ISL.rz;
      if (landF(x, z) < Lstop) return { x: px, z: pz };
      px = x; pz = z;
    }
    return { x: px, z: pz };
  }

  function planRoads() {
    const roads = [];
    // the mountain road: north out of the city, up the valley to Whitepine
    roads.push({ name: 'mountain', pts: catmull([{ x: 0, z: -246 }, { x: 0, z: -290 }, { x: 22, z: -380 }, { x: 18, z: -470 }, { x: -18, z: -560 }, { x: -42, z: -650 }, { x: -50, z: -745 }, { x: -62, z: -840 }, { x: -48, z: -925 }, { x: -70, z: -985 }], 5) });
    // Whitepine's loop
    const loop = [];
    for (let k = 0; k <= 40; k++) { const a = (k / 40) * Math.PI * 2; loop.push({ x: VIL.x + Math.cos(a) * 46, z: VIL.z + Math.sin(a) * 46 }); }
    roads.push({ name: 'village', pts: resample(loop, 5) });
    // the coast road: a loop just inland of the shore, broken where it meets the city
    const ring = [];
    for (let k = 0; k < 180; k++) ring.push(marchCoast((k / 180) * Math.PI * 2, 0.085));
    for (let pass = 0; pass < 4; pass++) {
      const c = ring.map((p) => ({ x: p.x, z: p.z }));
      for (let k = 0; k < ring.length; k++) {
        const a = c[(k + ring.length - 1) % ring.length], b = c[(k + 1) % ring.length];
        ring[k].x = (a.x + c[k].x * 2 + b.x) / 4; ring[k].z = (a.z + c[k].z * 2 + b.z) / 4;
      }
    }
    const keep = ring.map((p) => cityDist(p.x, p.z) > 55);
    let start = keep.indexOf(false);
    if (start < 0) start = 0;
    const gates = [{ x: -252, z: 0 }, { x: 252, z: 0 }, { x: 0, z: -252 }, { x: -252, z: -60 }, { x: 252, z: 60 }];
    const nearestGate = (p) => gates.reduce((b, g) => (Math.hypot(g.x - p.x, g.z - p.z) < Math.hypot(b.x - p.x, b.z - p.z) ? g : b));
    let run = [];
    const flush = () => {
      if (run.length > 6) {
        const a = nearestGate(run[0]), b = nearestGate(run[run.length - 1]);
        roads.push({ name: 'coast', pts: resample([a].concat(run, [b]), 5) });
      }
      run = [];
    };
    for (let n = 1; n <= ring.length; n++) {
      const k = (start + n) % ring.length;
      if (keep[k]) run.push(ring[k]); else flush();
    }
    flush();
    // out to the lighthouse on the east cape
    const lh = marchCoast(-0.32, 0.03);
    W.lighthouse = { x: lh.x, z: lh.z, y: 0 };
    const dx = lh.x - 252, dz = lh.z, dl = Math.hypot(dx, dz);
    roads.push({ name: 'lighthouse', pts: catmull([{ x: 252, z: 0 }, { x: 300, z: -10 }, { x: 252 + dx * 0.5, z: dz * 0.5 - 20 }, { x: lh.x - (dx / dl) * 30, z: lh.z - (dz / dl) * 30 }], 5) });
    return roads;
  }

  // give each road a height: follow the land, smoothed, never steeper than 11%
  function profileRoad(road) {
    const p = road.pts;
    for (const q of p) { q.lock = cityDist(q.x, q.z) < 9; q.y = q.lock ? 0 : Math.max(hm(q.x, q.z), SEA + 1.2); }
    for (let pass = 0; pass < 10; pass++) {
      const ys = p.map((q) => q.y);
      for (let k = 0; k < p.length; k++) {
        if (p[k].lock) continue;
        let s = 0, n = 0;
        for (let m = -3; m <= 3; m++) { const q = ys[k + m]; if (q !== undefined) { s += q; n++; } }
        p[k].y = s / n;
      }
    }
    const g = 0.11 * 5;
    for (let k = 1; k < p.length; k++) if (!p[k].lock) p[k].y = clamp(p[k].y, p[k - 1].y - g, p[k - 1].y + g);
    for (let k = p.length - 2; k >= 0; k--) if (!p[k].lock) p[k].y = clamp(p[k].y, p[k + 1].y - g, p[k + 1].y + g);
    for (let k = 0; k < p.length; k++) {
      const a = p[Math.max(0, k - 1)], b = p[Math.min(p.length - 1, k + 1)];
      const l = Math.hypot(b.x - a.x, b.z - a.z) || 1;
      p[k].tx = (b.x - a.x) / l; p[k].tz = (b.z - a.z) / l;
      p[k].y = Math.max(p[k].y, SEA + 0.9);
    }
  }

  // ------------------------------------------------------------ terrain
  function buildHeights(roads) {
    for (let iz = 0; iz < NZ; iz++) {
      for (let ix = 0; ix < NX; ix++) {
        const x = MAP.x0 + ix * CELL, z = MAP.z0 + iz * CELL;
        let h = natural(x, z, true);
        const cd = cityDist(x, z);
        if (cd < 60) h = G.lerp(-0.08, h, smooth(6, 60, cd));
        if (x > -192 && x < 72 && z > 244 && z < 296) h = Math.min(h, -0.4); // under the quay
        HM[iz * NX + ix] = h;
      }
    }
    for (const r of roads) profileRoad(r);
    // cut the roads into the land
    const bestD = new Float32Array(NX * NZ).fill(1e9), bestY = new Float32Array(NX * NZ);
    const R = 26;
    for (const r of roads) for (const q of r.pts) {
      const ix0 = Math.max(0, Math.floor((q.x - R - MAP.x0) / CELL)), ix1 = Math.min(NX - 1, Math.ceil((q.x + R - MAP.x0) / CELL));
      const iz0 = Math.max(0, Math.floor((q.z - R - MAP.z0) / CELL)), iz1 = Math.min(NZ - 1, Math.ceil((q.z + R - MAP.z0) / CELL));
      for (let iz = iz0; iz <= iz1; iz++) for (let ix = ix0; ix <= ix1; ix++) {
        const d = Math.hypot(MAP.x0 + ix * CELL - q.x, MAP.z0 + iz * CELL - q.z);
        const i = iz * NX + ix;
        if (d < bestD[i]) { bestD[i] = d; bestY[i] = q.y; }
      }
    }
    for (let i = 0; i < HM.length; i++) {
      if (bestD[i] >= R) continue;
      const x = MAP.x0 + (i % NX) * CELL, z = MAP.z0 + Math.floor(i / NX) * CELL;
      if (cityDist(x, z) < 6) continue;
      HM[i] = G.lerp(bestY[i] - 0.05, HM[i], smooth(8, R, bestD[i]));
    }
    W.roadDist = bestD;
  }

  function terrainColor(x, z, h, slope) {
    const L = landF(x, z), nf = northF(z), n = vnoise(x / 18, z / 18);
    if (h < SEA - 0.3) return lin('#2c3a38');
    if (L < 0.075 && h < 2.6 && cityDist(x, z) > 40) return lin(n > 0.5 ? '#a8966a' : '#9c8b62');
    const snow = h > 105 - nf * 45 || W.snowAt(z, x) > 0.6;
    if (snow) return slope > 1.1 ? lin('#6a6e74') : lin(n > 0.5 ? '#dfe6ee' : '#cfd8e2');
    if (slope > 0.85) return lin(n > 0.5 ? '#5d5a55' : '#4f4c48');
    if (cityDist(x, z) < 10) return lin('#3a3b3a');
    const f = fbm(x / 150, z / 150, 2);
    if (f > 0.55) return lin(n > 0.5 ? '#253a22' : '#2a4126');
    return lin(n > 0.5 ? '#3a5430' : '#41592f');
  }

  function buildTerrainMesh() {
    const pos = new Float32Array(NX * NZ * 3), colr = new Float32Array(NX * NZ * 3);
    for (let iz = 0; iz < NZ; iz++) for (let ix = 0; ix < NX; ix++) {
      const i = iz * NX + ix, x = MAP.x0 + ix * CELL, z = MAP.z0 + iz * CELL, h = HM[i];
      pos[i * 3] = x; pos[i * 3 + 1] = h; pos[i * 3 + 2] = z;
      const hx = HM[Math.min(i + 1, HM.length - 1)] - HM[Math.max(i - 1, 0)], hz = HM[Math.min(i + NX, HM.length - 1)] - HM[Math.max(i - NX, 0)];
      const c = terrainColor(x, z, h, Math.hypot(hx, hz) / (2 * CELL));
      colr[i * 3] = c[0]; colr[i * 3 + 1] = c[1]; colr[i * 3 + 2] = c[2];
    }
    const idx = new Uint32Array((NX - 1) * (NZ - 1) * 6);
    let k = 0;
    for (let iz = 0; iz < NZ - 1; iz++) for (let ix = 0; ix < NX - 1; ix++) {
      const a = iz * NX + ix, b = a + 1, c = a + NX, d = c + 1;
      idx[k++] = a; idx[k++] = c; idx[k++] = b; idx[k++] = b; idx[k++] = c; idx[k++] = d;
    }
    const g = new T.BufferGeometry();
    g.setAttribute('position', new T.BufferAttribute(pos, 3));
    g.setAttribute('color', new T.BufferAttribute(colr, 3));
    g.setIndex(new T.BufferAttribute(idx, 1));
    g.computeVertexNormals();
    const m = new T.Mesh(g, new T.MeshLambertMaterial({ vertexColors: true }));
    scene.add(m);
  }

  // ------------------------------------------------------------ city streets
  function buildCityStreets(roadsB) {
    const C = lin('#ffffff');
    const q = (x0, z0, x1, z1) => roadsB.quad([x0, 0.012, z1], [x1, 0.012, z1], [x1, 0.012, z0], [x0, 0.012, z0], 0, 1, 0, [x0 / 5, -z1 / 5], [x1 / 5, -z1 / 5], [x1 / 5, -z0 / 5], [x0 / 5, -z0 / 5], C);
    const DASH = lin('#9a7a22', 0.8);
    for (let k = 0; k <= NB; k++) {
      const r = W.roadLine(k);
      for (let m = 0; m < NB; m++) {
        const a = W.roadLine(m) + 8, b = W.roadLine(m + 1) - 8;
        if (W.isActive(k - 1, m) || W.isActive(k, m)) { // street running north-south
          q(r - 8, a, r + 8, b);
          for (let s = a + 3; s < b - 3; s += 8) plain.box(r, 0.02, s + 1.5, 0.16, 0.02, 3, DASH, 0);
        }
        if (W.isActive(m, k - 1) || W.isActive(m, k)) { // street running east-west
          q(a, r - 8, b, r + 8);
          for (let s = a + 3; s < b - 3; s += 8) plain.box(s + 1.5, 0.02, r, 3, 0.02, 0.16, DASH, 0);
        }
      }
      for (let m = 0; m <= NB; m++) {
        const z = W.roadLine(m);
        if (W.isActive(k - 1, m - 1) || W.isActive(k, m - 1) || W.isActive(k - 1, m) || W.isActive(k, m)) q(r - 8, z - 8, r + 8, z + 8);
      }
    }
  }

  // ------------------------------------------------------------ country roads
  function buildRoadMeshes(roads, roadsB) {
    const C = lin('#ffffff'), DASH = lin('#c8a030', 0.7), EDGE = lin('#b8b8b0', 0.55);
    let lampS = 0;
    for (const r of roads) {
      const p = r.pts;
      let s = 0;
      for (let k = 0; k < p.length - 1; k++) {
        const a = p[k], b = p[k + 1];
        const ay = (a.lock ? 0.015 : a.y + 0.12), by = (b.lock ? 0.015 : b.y + 0.12);
        const anx = -a.tz, anz = a.tx, bnx = -b.tz, bnz = b.tx, w = 6;
        const L1 = [a.x + anx * w, ay, a.z + anz * w], R1 = [a.x - anx * w, ay, a.z - anz * w];
        const L2 = [b.x + bnx * w, by, b.z + bnz * w], R2 = [b.x - bnx * w, by, b.z - bnz * w];
        const ds = Math.hypot(b.x - a.x, b.z - a.z);
        if (!(a.lock && b.lock)) {
          roadsB.quad(L1, L2, R2, R1, 0, 1, 0, [0, s / 6], [0, (s + ds) / 6], [2.4, (s + ds) / 6], [2.4, s / 6], C);
          if (k % 2 === 0) {
            const mx = (a.x + b.x) / 2, mz = (a.z + b.z) / 2, my = (ay + by) / 2 + 0.015;
            plain.box(mx, my, mz, Math.abs(a.tz) * 0.16 + Math.abs(a.tx) * 3, 0.02, Math.abs(a.tx) * 0.16 + Math.abs(a.tz) * 3, DASH, 0);
          }
          for (const side of [-1, 1]) {
            const ex = (a.x + b.x) / 2 + anx * side * 5.6, ez = (a.z + b.z) / 2 + anz * side * 5.6;
            plain.box(ex, (ay + by) / 2 + 0.012, ez, Math.abs(a.tz) * 0.14 + Math.abs(a.tx) * ds, 0.02, Math.abs(a.tx) * 0.14 + Math.abs(a.tz) * ds, EDGE, 0);
          }
        }
        s += ds;
        lampS += ds;
        if (lampS > 70 && !a.lock && r.name !== 'village') {
          lampS = 0;
          const side = (k & 1) ? 1 : -1, lx = a.x + anx * side * 7.4, lz = a.z + anz * side * 7.4, gy = hm(lx, lz);
          plain.box(lx, gy + 3.2, lz, 0.16, 6.4, 0.16, POLE, 0);
          const hx = a.x + anx * side * 5.8, hz = a.z + anz * side * 5.8;
          plain.box((lx + hx) / 2, gy + 6.3, (lz + hz) / 2, Math.abs(hx - lx) + 0.1, 0.1, Math.abs(hz - lz) + 0.1, POLE, 0);
          const cold = W.snowAt(a.z) > 0.3;
          lamps.box(hx, gy + 6.15, hz, 0.5, 0.12, 0.5, cold ? lin('#e4f2ff') : lin('#ffd08a'));
          glow.disc(hx, ay + 0.06, hz, 7, cold ? lin('#7fa8d8', 0.25) : lin('#ffa040', 0.3));
        }
        W.roadSamples.push({ x: a.x, z: a.z, y: a.y, tx: a.tx, tz: a.tz, lock: a.lock });
      }
    }
  }

  // ------------------------------------------------------------ harbor
  function buildHarbor() {
    const deckY = 0.25;
    plain.box(-60, -1.7, 270, 252, 3.6, 44, lin('#55575c'), 4); // quay
    W.decks.push({ minX: -186, maxX: 66, minZ: 248, maxZ: 292, y: 0.1 });
    const WOOD = lin('#4a3a2a'), POST = lin('#2a2420');
    for (const px of [-150, -90, -30, 30]) {
      plain.box(px, deckY - 0.2, 332, 8, 0.4, 80, WOOD, 3);
      W.decks.push({ minX: px - 4, maxX: px + 4, minZ: 292, maxZ: 372, y: deckY });
      for (let z = 296; z <= 370; z += 8) for (const s of [-1, 1]) plain.box(px + s * 3.6, -2.4, z, 0.5, 5, 0.5, POST, 0);
      for (let z = 300; z <= 368; z += 24) {
        lamps.box(px + 3.6, deckY + 4.2, z, 0.4, 0.15, 0.4, lin('#ffd08a'));
        plain.box(px + 3.6, deckY + 2.1, z, 0.12, 4.2, 0.12, POLE, 0);
        glow.disc(px + 3.6, deckY + 0.05, z, 4.5, lin('#ffa040', 0.3));
      }
    }
    // moored freighter between the first two piers
    plain.box(-120, 0.8, 334, 15, 7, 64, lin('#2a1c1a'), 4);
    plain.box(-120, 4.4, 334, 15.4, 0.4, 64.4, lin('#5a1a14'), 0);
    walls.box(-120, 9, 360, 12, 9, 10, lin('#8a8a84'), 24, 0.3, 0);
    plain.box(-120, 16, 362, 2, 5, 2, lin('#3a3a3a'), 0);
    addBox({ minX: -127.5, maxX: -112.5, minZ: 302, maxZ: 366, h: 14 });
    // containers and cranes on the quay
    const CONT = ['#7a2a1a', '#1f3a5a', '#2a5a3a', '#8a6a2a', '#5a2a4a'].map((h) => lin(h));
    for (let k = 0; k < 7; k++) {
      const x = -176 + k * 7, levels = 1 + (rng() * 3) | 0;
      for (let l = 0; l < levels; l++) plain.box(x, 0.12 + 1.3 + l * 2.6, 279, 2.4, 2.6, 6, rpick(CONT), 0);
      addBox({ minX: x - 1.2, maxX: x + 1.2, minZ: 276, maxZ: 282, h: levels * 2.6 });
    }
    for (const cx of [-60, 10]) {
      for (const s of [-1, 1]) { plain.box(cx + s * 6, 13, 276, 1.2, 26, 1.2, lin('#8a6a1a'), 0); plain.box(cx + s * 6, 13, 288, 1.2, 26, 1.2, lin('#8a6a1a'), 0); addBox({ minX: cx + s * 6 - 0.6, maxX: cx + s * 6 + 0.6, minZ: 275.4, maxZ: 276.6, h: 26 }); }
      plain.box(cx, 26.5, 296, 14, 1.6, 50, lin('#8a6a1a'), 0);
      W.blinkers.push(addBlinker(cx, 27.6, 320, 0xff2020));
    }
    addSign('PORT OF CALVARY', '#2ae0ff', -60, 6, 270.2, 0, -1, 1.4, 0.03, { noBoard: false });
  }

  // ------------------------------------------------------------ shops
  W.shops = [];
  function buildShops() {
    // Vesper St. pawn shop, on block (3,3) facing the street the laundromat is on
    const x = W.blockCenter(3), fz = W.blockCenter(3) - 18;
    lamps.box(x, 1.6, fz - 0.06, 7, 2.3, 0.06, lin('#c8a050', 0.55));
    addSign('PAWN · GUNS', '#3dff88', x, 4.4, fz, 0, -1, 1.2, 0.04);
    glow.disc(x, 0.16, fz - 2.3, 2.4, lin('#3dff88', 0.45));
    W.shops.push({ id: 'pawn', name: 'Vesper St. Pawn & Guns', x, z: fz - 2.3 });
  }

  // ------------------------------------------------------------ Whitepine
  const roofs = [];
  function buildVillage() {
    const vy = VIL.y;
    const WOODS = ['#6a4a32', '#5a3a26', '#7a5a3e', '#4a3424'];
    const cabin = (x, z, w, d, h) => {
      const gy = hm(x, z);
      walls.box(x, gy + h / 2 - 0.5, z, w, h + 1, d, lin(rpick(WOODS)), 24, rng(), 0);
      roofs.push([x, gy + h + 0.5 + Math.max(w, d) * 0.22, z, Math.max(w, d) * 0.78, Math.max(w, d) * 0.45]);
      plain.box(x + w * 0.3, gy + h + 1.8, z, 0.6, 2.4, 0.6, lin('#3a3632'), 0);
      lamps.box(x, gy + 1.2, z + d / 2 + 0.05, 1.2, 1.8, 0.06, lin('#c88a3a', 0.55));
      glow.disc(x, gy + 0.1, z + d / 2 + 1.5, 3, lin('#ffb060', 0.3));
      addBox({ minX: x - w / 2, maxX: x + w / 2, minZ: z - d / 2, maxZ: z + d / 2, h: gy + h + 2 });
    };
    for (let k = 0; k < 11; k++) {
      const a = (k / 11) * Math.PI * 2 + 0.3, r = k % 2 ? 66 : 70;
      cabin(VIL.x + Math.cos(a) * r, VIL.z + Math.sin(a) * r, rr(6, 8), rr(5, 7), rr(3.6, 4.6));
    }
    // the lodge in the middle of the loop
    const lx = VIL.x, lz = VIL.z + 4, lw = 20, ld = 12, lh = 8;
    walls.box(lx, vy + lh / 2 - 0.5, lz, lw, lh + 1, ld, lin('#5a3a26'), 24, 0.2, 0);
    roofs.push([lx, vy + lh + 0.5 + 4.2, lz, 15, 8.4]);
    addBox({ minX: lx - lw / 2, maxX: lx + lw / 2, minZ: lz - ld / 2, maxZ: lz + ld / 2, h: vy + 14 });
    lamps.box(lx, vy + 1.6, lz - ld / 2 - 0.05, 12, 2.4, 0.06, lin('#d8a050', 0.6));
    glow.disc(lx, vy + 0.1, lz - ld / 2 - 3, 6, lin('#ffb060', 0.35));
    addSign('WHITEPINE LODGE', '#ff9a1f', lx, vy + 5.8, lz - ld / 2, 0, -1, 1.5, 0.02);
    // gas station at the bottom of the loop, where the mountain road arrives
    const gx2 = VIL.x + 32, gz2 = VIL.z + 32;
    plain.box(gx2, vy + 5, gz2, 12, 0.5, 8, lin('#d8d8d0'), 0);
    for (const [a, b] of [[-5, -3], [5, -3], [-5, 3], [5, 3]]) plain.box(gx2 + a, vy + 2.5, gz2 + b, 0.4, 5, 0.4, lin('#c8c8c0'), 0);
    lamps.box(gx2, vy + 4.7, gz2, 10, 0.1, 6, lin('#e8f0ff', 0.7));
    glow.disc(gx2, vy + 0.12, gz2, 9, lin('#bfd8ff', 0.35));
    addSign('GAS · 24H', '#3dff88', gx2, vy + 6, gz2 - 4.1, 0, -1, 1, 0.08, { noPool: true });
    W.shops.push({ id: 'whitepine', name: 'Whitepine Gas & General', x: gx2, z: gz2 });
    for (let k = 0; k < 6; k++) {
      const a = (k / 6) * Math.PI * 2;
      const x = VIL.x + Math.cos(a) * 38, z = VIL.z + Math.sin(a) * 38, gy = hm(x, z);
      plain.box(x, gy + 3, z, 0.16, 6, 0.16, POLE, 0);
      lamps.box(x, gy + 6, z, 0.5, 0.12, 0.5, lin('#e4f2ff'));
      glow.disc(x, gy + 0.12, z, 6.5, lin('#7fa8d8', 0.25));
    }
    W.villageSpots = [];
    for (let k = 0; k < 16; k++) { const a = rng() * 6.28, r = rr(14, 34); W.villageSpots.push({ x: VIL.x + Math.cos(a) * r, z: VIL.z + Math.sin(a) * r }); }
  }

  // ------------------------------------------------------------ landmarks
  function addBlinker(x, y, z, color) {
    const m = new T.Mesh(new T.SphereGeometry(0.5, 8, 6), new T.MeshBasicMaterial({ color, fog: false }));
    m.position.set(x, y, z); scene.add(m);
    return { m, t: rng() * 2 };
  }
  function buildLighthouse() {
    const L = W.lighthouse;
    L.y = Math.max(hm(L.x, L.z), 2);
    const g = new T.Group();
    const white = new T.MeshLambertMaterial({ color: 0xe8e4dc }), red = new T.MeshLambertMaterial({ color: 0x9a1a1a });
    const tower = new T.Mesh(new T.CylinderGeometry(2.2, 3.2, 26, 14), white); tower.position.y = 13;
    const b1 = new T.Mesh(new T.CylinderGeometry(2.62, 2.75, 3, 14), red); b1.position.y = 9;
    const b2 = new T.Mesh(new T.CylinderGeometry(2.35, 2.45, 3, 14), red); b2.position.y = 19;
    const lamp = new T.Mesh(new T.CylinderGeometry(2.1, 2.1, 3, 12), new T.MeshBasicMaterial({ color: 0xfff0b0, fog: false })); lamp.position.y = 27.5;
    const cap = new T.Mesh(new T.ConeGeometry(2.8, 2.6, 12), red); cap.position.y = 30.3;
    g.add(tower, b1, b2, lamp, cap);
    const beamGeo = new T.CylinderGeometry(0.4, 9, 160, 12, 1, true).rotateZ(Math.PI / 2).translate(80, 0, 0);
    const beamMat = new T.MeshBasicMaterial({ color: 0xfff2c0, transparent: true, opacity: 0.16, blending: T.AdditiveBlending, depthWrite: false, side: T.DoubleSide, fog: false });
    W.beam = new T.Mesh(beamGeo, beamMat); W.beam.position.y = 27.5;
    g.add(W.beam);
    g.position.set(L.x, L.y, L.z);
    scene.add(g);
    addBox({ minX: L.x - 3.2, maxX: L.x + 3.2, minZ: L.z - 3.2, maxZ: L.z + 3.2, h: L.y + 30 });
    const hx = L.x - 9, hz = L.z + 6, hy = hm(hx, hz);
    walls.box(hx, hy + 2, hz, 7, 5, 6, lin('#a8a49c'), 24, 0.6, 0);
    roofs.push([hx, hy + 6, hz, 5.4, 2.4]);
    addBox({ minX: hx - 3.5, maxX: hx + 3.5, minZ: hz - 3, maxZ: hz + 3, h: hy + 7 });
    // radio tower on the hill north-west of the city
    const tx = -380, tz = -470, ty = hm(tx, tz);
    for (const [a, b] of [[-1.2, -1.2], [1.2, -1.2], [0, 1.2]]) plain.box(tx + a, ty + 24, tz + b, 0.3, 48, 0.3, lin('#8a8a8a'), 0);
    for (let y = 4; y < 48; y += 4) plain.box(tx, ty + y, tz, 2.6, 0.15, 2.6, lin('#6a6a6a'), 0);
    W.blinkers.push(addBlinker(tx, ty + 49, tz, 0xff2020));
    addBox({ minX: tx - 1.5, maxX: tx + 1.5, minZ: tz - 1.5, maxZ: tz + 1.5, h: ty + 48 });
  }

  // ------------------------------------------------------------ forests
  function buildForests() {
    const pts = [];
    for (let k = 0; k < 9000 && pts.length < 1900; k++) {
      const x = rr(MAP.x0 + 20, MAP.x1 - 20), z = rr(MAP.z0 + 20, MAP.z1 - 20);
      const L = landF(x, z);
      if (L < 0.07) continue;
      if (cityDist(x, z) < 30) continue;
      const fx = Math.floor((x - MAP.x0) / CELL), fz = Math.floor((z - MAP.z0) / CELL);
      if (W.roadDist[fz * NX + fx] < 12) continue;
      if (Math.hypot(x - VIL.x, z - VIL.z) < 85) continue;
      if (Math.hypot(x - W.lighthouse.x, z - W.lighthouse.z) < 35) continue;
      const h = hm(x, z);
      if (h < 1.2 || h > 150) continue;
      const slope = Math.abs(hm(x + 4, z) - hm(x - 4, z)) + Math.abs(hm(x, z + 4) - hm(x, z - 4));
      if (slope > 7) continue;
      const dens = fbm(x / 150, z / 150, 2) + northF(z) * 0.15;
      if (dens < 0.5 && rng() > 0.06) continue;
      pts.push([x, h, z, rr(0.8, 1.6), W.snowAt(z, x) > 0.4 || h > 80]);
    }
    const crown = new T.InstancedMesh(new T.ConeGeometry(1.9, 5, 7), new T.MeshLambertMaterial({ color: 0xffffff }), pts.length);
    const trunk = new T.InstancedMesh(new T.BoxGeometry(0.4, 2.6, 0.4), new T.MeshLambertMaterial({ color: 0x3a2a1e }), pts.length);
    const d = new T.Object3D(), c = new T.Color();
    pts.forEach(([x, h, z, s, snowy], k) => {
      d.position.set(x, h + 1.2 * s, z); d.scale.set(s, s, s); d.rotation.set(0, k, 0); d.updateMatrix(); trunk.setMatrixAt(k, d.matrix);
      d.position.set(x, h + 4.6 * s, z); d.updateMatrix(); crown.setMatrixAt(k, d.matrix);
      crown.setColorAt(k, snowy ? c.set(rng() > 0.5 ? '#d8e2e6' : '#bccac8') : c.set(rpick(['#1d3320', '#22391f', '#2a4226', '#1a2e1c'])));
      addBox({ minX: x - 0.3, maxX: x + 0.3, minZ: z - 0.3, maxZ: z + 0.3, h: h + 8 });
    });
    scene.add(crown, trunk);
  }

  // ------------------------------------------------------------ sky
  function buildSky() {
    const N = 700, pos = new Float32Array(N * 3);
    for (let k = 0; k < N; k++) {
      const a = rng() * 6.283, e = Math.asin(rng() * 0.95 + 0.05), r = 1300;
      pos[k * 3] = Math.cos(a) * Math.cos(e) * r; pos[k * 3 + 1] = Math.sin(e) * r; pos[k * 3 + 2] = Math.sin(a) * Math.cos(e) * r;
    }
    const g = new T.BufferGeometry(); g.setAttribute('position', new T.BufferAttribute(pos, 3));
    W.stars = new T.Points(g, new T.PointsMaterial({ color: 0xc8d4ff, size: 1.6, sizeAttenuation: false, fog: false, transparent: true, opacity: 0.8 }));
    W.stars.frustumCulled = false;
    W.moon = new T.Mesh(new T.CircleGeometry(38, 24), new T.MeshBasicMaterial({ color: 0xe8e4d4, fog: false }));
    scene.add(W.stars, W.moon);
  }

  // ------------------------------------------------------------ build
  W.build = function (sc) {
    scene = sc;
    walls = new Builder(); walls.flatRoof = true;
    plain = new Builder(); glow = new Builder(); lamps = new Builder();
    const roadsB = new Builder();
    const { wt, et } = makeWallTextures();
    W.radialTex = makeRadial();

    VIL.y = natural(VIL.x, VIL.z, false);
    const roads = planRoads();
    W.lighthouse.y = Math.max(natural(W.lighthouse.x, W.lighthouse.z, false), 2);
    buildHeights(roads);
    W.roads = roads;
    buildTerrainMesh();

    for (const r of ACTIVE) {
      const { i, j } = r;
      const cx = W.blockCenter(i), cz = W.blockCenter(j);
      plain.box(cx, 0.06, cz, 44, 0.12, 44, SIDEWALK, 3);
      const type = SPECIAL[i + ',' + j] || 'city';
      if (type === 'city') buildCityBlock(i, j, cx - 18, cx + 18, cz - 18, cz + 18);
      else if (type === 'park') buildPark(i, j);
      else if (type === 'lot') buildLot(i, j);
      else if (type === 'laundromat') buildLaundromat(i, j);
      else if (type === 'motel') buildMotel(i, j);
      else if (type === 'church') buildChurch(i, j);
      addLamps(i, j);
    }
    buildCityStreets(roadsB);
    buildRoadMeshes(roads, roadsB);
    buildHarbor();
    buildShops();
    buildVillage();
    buildLighthouse();
    buildForests();
    buildWreck(150, -180.5);

    const asphalt = makeAsphalt();
    scene.add(new T.Mesh(roadsB.geometry(), new T.MeshLambertMaterial({ map: asphalt, color: 0xa4a7ae, polygonOffset: true, polygonOffsetFactor: -1 })));
    const wallMat = new T.MeshLambertMaterial({ map: wt, emissiveMap: et, emissive: 0xffffff, emissiveIntensity: 0.95, vertexColors: true });
    scene.add(new T.Mesh(walls.geometry(), wallMat));
    scene.add(new T.Mesh(plain.geometry(), new T.MeshLambertMaterial({ map: makeNoise(), vertexColors: true })));
    scene.add(new T.Mesh(lamps.geometry(), new T.MeshBasicMaterial({ vertexColors: true })));
    const gm = new T.Mesh(glow.geometry(), new T.MeshBasicMaterial({ map: W.radialTex, vertexColors: true, transparent: true, blending: T.AdditiveBlending, depthWrite: false }));
    gm.renderOrder = 1;
    scene.add(gm);

    // pitched roofs (snowy up north)
    if (roofs.length) {
      const rm = new T.InstancedMesh(new T.ConeGeometry(1, 1, 4).rotateY(Math.PI / 4), new T.MeshLambertMaterial({ color: 0xffffff }), roofs.length);
      const d = new T.Object3D(), c = new T.Color();
      roofs.forEach(([x, y, z, r, h], k) => {
        d.position.set(x, y, z); d.scale.set(r, h, r); d.updateMatrix(); rm.setMatrixAt(k, d.matrix);
        rm.setColorAt(k, W.snowAt(z) > 0.4 ? c.set('#dde4ec') : c.set('#5a4a3e'));
      });
      scene.add(rm);
    }
    if (trees.length) {
      const tm = new T.InstancedMesh(new T.ConeGeometry(1.9, 4.6, 6), new T.MeshLambertMaterial({ color: 0x1b2a1d }), trees.length);
      const d = new T.Object3D();
      trees.forEach(([x, z, s], k) => { d.position.set(x, 3.6 * s + 0.6, z); d.scale.set(s, s, s); d.rotation.y = k; d.updateMatrix(); tm.setMatrixAt(k, d.matrix); });
      scene.add(tm);
    }

    // the sea
    const water = new T.Mesh(new T.PlaneGeometry(6000, 6000), new T.MeshPhongMaterial({ color: 0x0f2c3a, specular: 0x6a8aa0, shininess: 70, transparent: true, opacity: 0.92 }));
    water.rotation.x = -Math.PI / 2; water.position.y = SEA;
    scene.add(water);

    // church cross: visible through the fog, the one landmark you can steer by
    const cross = new T.Group();
    const cm = new T.MeshBasicMaterial({ color: 0xff2030, fog: false });
    const v = new T.Mesh(new T.BoxGeometry(0.35, 3.2, 0.35), cm); v.position.y = 45.6;
    const hbar = new T.Mesh(new T.BoxGeometry(1.8, 0.35, 0.35), cm); hbar.position.y = 46.3;
    cross.add(v, hbar); cross.position.set(W.blockCenter(5), 0, W.blockCenter(5) - 13);
    scene.add(cross);

    W.hemi = new T.HemisphereLight(0x7487b0, 0x2a2630, 2.3);
    scene.add(W.hemi);
    const moon = new T.DirectionalLight(0x9aa8d8, 1.1);
    moon.position.set(-60, 120, 40);
    scene.add(moon);
    W.moonDir = new T.Vector3(-0.35, 0.42, -0.84).normalize();

    scene.fog = new T.Fog(0x182030, 30, 420);
    buildSky();
    buildRain();
  };

  function buildWreck(x, z) {
    const g = new T.Group();
    const body = new T.Mesh(new T.BoxGeometry(2.3, 2.3, 5.6), new T.MeshLambertMaterial({ color: 0x2c312c }));
    body.position.y = 1.15;
    const stripe = new T.Mesh(new T.BoxGeometry(2.34, 0.3, 5.64), new T.MeshLambertMaterial({ color: 0x6a5a20 }));
    stripe.position.y = 1.4;
    const grille = new T.Mesh(new T.BoxGeometry(1.9, 0.5, 0.1), new T.MeshLambertMaterial({ color: 0x111111 }));
    grille.position.set(0, 1.6, 2.81);
    g.add(body, stripe, grille);
    g.position.set(x, 0.35, z);
    g.rotation.set(0, 0.7, 0.3);
    scene.add(g);
    addBox({ minX: x - 2.6, maxX: x + 2.6, minZ: z - 2.6, maxZ: z + 2.6, h: 2.6 });
    plain.box(x - 9, 0.025, z + 0.8, 12, 0.02, 0.3, lin('#101010'), 0);
    plain.box(x - 9, 0.025, z - 0.9, 12, 0.02, 0.3, lin('#101010'), 0);
    glow.disc(x, 0.04, z, 7, lin('#ff6a20', 0.35));
    const N = 50, pos = new Float32Array(N * 3);
    W.fire = { x, z, N, pos, life: new Float32Array(N), geo: new T.BufferGeometry() };
    W.fire.geo.setAttribute('position', new T.BufferAttribute(pos, 3));
    const pts = new T.Points(W.fire.geo, new T.PointsMaterial({ map: W.radialTex, color: 0xff7a2a, size: 1.3, transparent: true, blending: T.AdditiveBlending, depthWrite: false }));
    pts.frustumCulled = false;
    scene.add(pts);
    W.fireLight = new T.PointLight(0xff7a2a, 40, 22, 2);
    W.fireLight.position.set(x, 2.5, z);
    scene.add(W.fireLight);
  }
  // ------------------------------------------------------------ weather
  let rainN = 1400, rainDraw = 1400, rainPos, rainGeo, drops, rainMat;
  const SNOWN = 1300;
  let snowPos, snowGeo, snowMat, snowDraw = SNOWN;
  function buildRain() {
    rainPos = new Float32Array(rainN * 6);
    drops = new Float32Array(rainN * 3);
    for (let k = 0; k < rainN; k++) { drops[k * 3] = (Math.random() - 0.5) * 50; drops[k * 3 + 1] = Math.random() * 22; drops[k * 3 + 2] = (Math.random() - 0.5) * 50; }
    rainGeo = new T.BufferGeometry();
    rainGeo.setAttribute('position', new T.BufferAttribute(rainPos, 3));
    rainMat = new T.LineBasicMaterial({ color: 0x9fb2d0, transparent: true, opacity: 0.3 });
    const rain = new T.LineSegments(rainGeo, rainMat);
    rain.frustumCulled = false;
    scene.add(rain);
    snowPos = new Float32Array(SNOWN * 3);
    for (let k = 0; k < SNOWN; k++) { snowPos[k * 3] = (Math.random() - 0.5) * 60; snowPos[k * 3 + 1] = Math.random() * 26; snowPos[k * 3 + 2] = (Math.random() - 0.5) * 60; }
    snowGeo = new T.BufferGeometry();
    snowGeo.setAttribute('position', new T.BufferAttribute(snowPos, 3));
    snowMat = new T.PointsMaterial({ color: 0xf2f6ff, size: 0.16, map: W.radialTex, transparent: true, opacity: 0, depthWrite: false });
    const snow = new T.Points(snowGeo, snowMat);
    snow.frustumCulled = false; snow.visible = false;
    snowGeo.userData.pts = snow;
    scene.add(snow);
  }
  let lowQ = false;
  W.setRainDensity = function (f) {
    rainDraw = Math.floor(rainN * f); snowDraw = Math.floor(SNOWN * f);
    if (rainGeo) { rainGeo.setDrawRange(0, rainDraw * 2); snowGeo.setDrawRange(0, snowDraw); }
  };
  W.setQuality = function (low) { lowQ = low; W.setRainDensity(low ? 0.45 : 1); };

  const FOG_CITY = new T.Color(0x182030), FOG_SNOW = new T.Color(0x2c3444), fogC = new T.Color();
  let boltT = 8 + Math.random() * 10, flashT = 0, flashSeq = 0, snowMix = 0, cityMix = 1;
  W.update = function (dt, cam) {
    const sn = W.snowAt(cam.z);
    snowMix += (sn - snowMix) * Math.min(1, dt * 0.8);
    const cm = 1 - smooth(20, 220, cityDist(cam.x, cam.z));
    cityMix += (cm - cityMix) * Math.min(1, dt * 0.6);

    // rain (fades out as you climb into the snow)
    const wind = 2.2;
    rainMat.opacity = 0.3 * (1 - snowMix);
    if (snowMix < 0.98) {
      for (let k = 0; k < rainDraw; k++) {
        const o = k * 3;
        let x = drops[o], y = drops[o + 1], z = drops[o + 2];
        y -= 24 * dt; x += wind * dt;
        if (y < 0) { y += 22; x = cam.x + (Math.random() - 0.5) * 50; z = cam.z + (Math.random() - 0.5) * 50; }
        if (x - cam.x > 25) x -= 50; else if (x - cam.x < -25) x += 50;
        if (z - cam.z > 25) z -= 50; else if (z - cam.z < -25) z += 50;
        drops[o] = x; drops[o + 1] = y; drops[o + 2] = z;
        const p = k * 6;
        rainPos[p] = x; rainPos[p + 1] = y + cam.y - 8; rainPos[p + 2] = z;
        rainPos[p + 3] = x - wind * 0.03; rainPos[p + 4] = y + cam.y - 8 + 0.75; rainPos[p + 5] = z;
      }
      rainGeo.attributes.position.needsUpdate = true;
    }
    // snow
    snowMat.opacity = 0.9 * snowMix;
    snowGeo.userData.pts.visible = snowMix > 0.02;
    if (snowMix > 0.02) {
      const t = G.time || 0;
      for (let k = 0; k < snowDraw; k++) {
        const o = k * 3;
        let x = snowPos[o], y = snowPos[o + 1], z = snowPos[o + 2];
        y -= (1.4 + (k % 7) * 0.12) * dt;
        x += (Math.sin(t * 0.7 + k) * 0.6 + 0.8) * dt; z += Math.cos(t * 0.5 + k * 1.3) * 0.5 * dt;
        if (y < cam.y - 10) { y += 26; x = cam.x + (Math.random() - 0.5) * 60; z = cam.z + (Math.random() - 0.5) * 60; }
        if (x - cam.x > 30) x -= 60; else if (x - cam.x < -30) x += 60;
        if (z - cam.z > 30) z -= 60; else if (z - cam.z < -30) z += 60;
        snowPos[o] = x; snowPos[o + 1] = y; snowPos[o + 2] = z;
      }
      snowGeo.attributes.position.needsUpdate = true;
    }

    // fog: thick in the rainy city, long views over open country, hazy in the snow
    const fog = scene.fog;
    const far = G.lerp(G.lerp(900, 520, snowMix), 360, cityMix) * (lowQ ? 0.7 : 1);
    fog.far = far; fog.near = far * 0.06;
    fogC.copy(FOG_CITY).lerp(FOG_SNOW, snowMix);
    fog.color.copy(fogC);
    scene.background.copy(fogC);

    // sky follows the camera
    W.stars.position.copy(cam);
    W.stars.material.opacity = 0.8 * (1 - cityMix * 0.6);
    W.moon.position.set(cam.x + W.moonDir.x * 1200, cam.y + W.moonDir.y * 1200, cam.z + W.moonDir.z * 1200);
    W.moon.lookAt(cam);

    // lightning (not in the snow)
    boltT -= dt;
    if (boltT <= 0) {
      boltT = 14 + Math.random() * 26;
      if (snowMix < 0.5) { flashSeq = 2; flashT = 0; G.audio.thunder(0.8 + Math.random() * 2); }
    }
    if (flashSeq > 0) {
      flashT += dt;
      W.hemi.intensity = flashT < 0.07 ? 7 : 2.3;
      if (flashT > 0.16) { flashSeq--; flashT = 0; }
    } else W.hemi.intensity = 2.3 + snowMix * 0.5;

    for (const s of W.signs) {
      s.t -= dt;
      if (s.t <= 0) {
        if (s.on && Math.random() < s.flick * 6) { s.on = false; s.t = 0.04 + Math.random() * 0.18; }
        else { s.on = true; s.t = 0.1 + Math.random() * 0.6; }
        s.m.material.opacity = s.on ? 1 : 0.12;
      }
    }
    for (const b of W.blinkers) { b.t += dt; b.m.visible = b.t % 1.6 < 0.5; }
    if (W.beam) W.beam.rotation.y += dt * 0.9;

    if (W.fire) {
      const f = W.fire;
      for (let k = 0; k < f.N; k++) {
        f.life[k] -= dt;
        if (f.life[k] <= 0) {
          f.life[k] = 0.5 + Math.random() * 0.8;
          f.pos[k * 3] = f.x + (Math.random() - 0.5) * 2.4; f.pos[k * 3 + 1] = 1 + Math.random() * 1.5; f.pos[k * 3 + 2] = f.z + (Math.random() - 0.5) * 2.4;
        }
        f.pos[k * 3 + 1] += dt * 2.6; f.pos[k * 3] += dt * 0.8;
      }
      f.geo.attributes.position.needsUpdate = true;
      W.fireLight.intensity = 30 + Math.random() * 22;
    }
  };

  // ------------------------------------------------------------ queries
  W.groundY = function (x, z) {
    const fi = Math.floor((x + HALF) / P), fj = Math.floor((z + HALF) / P);
    if (fi >= 0 && fj >= 0 && fi < NB && fj < NB && W.isActive(fi, fj)) {
      const bx = W.blockCenter(fi), bz = W.blockCenter(fj);
      return Math.abs(x - bx) < 22 && Math.abs(z - bz) < 22 ? 0.12 : 0;
    }
    for (const d of W.decks) if (x > d.minX && x < d.maxX && z > d.minZ && z < d.maxZ) return d.y;
    if (x > -280 && x < 280 && z > -280 && z < 280 && cityDist(x, z) < 8.5) return 0;
    return hm(x, z);
  };
  W.collide = function (o, r) {
    let hit = false;
    if (o.x < MAP.x0 + 10) { o.x = MAP.x0 + 10; hit = true; } else if (o.x > MAP.x1 - 10) { o.x = MAP.x1 - 10; hit = true; }
    if (o.z < MAP.z0 + 10) { o.z = MAP.z0 + 10; hit = true; } else if (o.z > MAP.z1 - 10) { o.z = MAP.z1 - 10; hit = true; }
    // keep out of deep water: walk back uphill
    let g = W.groundY(o.x, o.z);
    for (let it = 0; it < 6 && g < SEA + 0.3; it++) {
      const sx = W.groundY(o.x + 2, o.z) - W.groundY(o.x - 2, o.z), sz = W.groundY(o.x, o.z + 2) - W.groundY(o.x, o.z - 2);
      let l = Math.hypot(sx, sz);
      let ux = sx, uz = sz;
      if (l < 1e-3) { ux = ISL.cx - o.x; uz = ISL.cz - o.z; l = Math.hypot(ux, uz) || 1; }
      o.x += (ux / l) * 0.8; o.z += (uz / l) * 0.8;
      g = W.groundY(o.x, o.z);
      hit = true;
    }
    const list = boxesIn(o.x - r, o.z - r, o.x + r, o.z + r, near);
    for (let k = 0; k < list.length; k++) {
      const b = list[k];
      const cx = o.x < b.minX ? b.minX : o.x > b.maxX ? b.maxX : o.x;
      const cz = o.z < b.minZ ? b.minZ : o.z > b.maxZ ? b.maxZ : o.z;
      const dx = o.x - cx, dz = o.z - cz, d2 = dx * dx + dz * dz;
      if (d2 >= r * r) continue;
      hit = true;
      if (d2 > 1e-8) {
        const d = Math.sqrt(d2), push = (r - d) / d;
        o.x += dx * push; o.z += dz * push;
      } else {
        const l = o.x - b.minX, rgt = b.maxX - o.x, bk = o.z - b.minZ, fr = b.maxZ - o.z;
        const m = Math.min(l, rgt, bk, fr);
        if (m === l) o.x = b.minX - r; else if (m === rgt) o.x = b.maxX + r; else if (m === bk) o.z = b.minZ - r; else o.z = b.maxZ + r;
      }
    }
    return hit;
  };
  const rayList = [];
  function rayCore(ox, oz, dx, dz, maxT, wantNormal) {
    let best = maxT, nx = 0, nz = 0;
    const ex = ox + dx * maxT, ez = oz + dz * maxT;
    const list = boxesIn(Math.min(ox, ex), Math.min(oz, ez), Math.max(ox, ex), Math.max(oz, ez), rayList);
    for (let k = 0; k < list.length; k++) {
      const b = list[k];
      let t0 = 0, t1 = best, axis = 0;
      if (Math.abs(dx) < 1e-9) { if (ox < b.minX || ox > b.maxX) continue; }
      else {
        let ta = (b.minX - ox) / dx, tb = (b.maxX - ox) / dx;
        if (ta > tb) { const s = ta; ta = tb; tb = s; }
        if (ta > t0) { t0 = ta; axis = 1; } if (tb < t1) t1 = tb;
        if (t0 > t1) continue;
      }
      if (Math.abs(dz) < 1e-9) { if (oz < b.minZ || oz > b.maxZ) continue; }
      else {
        let ta = (b.minZ - oz) / dz, tb = (b.maxZ - oz) / dz;
        if (ta > tb) { const s = ta; ta = tb; tb = s; }
        if (ta > t0) { t0 = ta; axis = 2; } if (tb < t1) t1 = tb;
        if (t0 > t1) continue;
      }
      if (t0 < best && (!wantNormal || axis)) { best = t0; nx = axis === 1 ? -Math.sign(dx) : 0; nz = axis === 2 ? -Math.sign(dz) : 0; }
    }
    return wantNormal ? (best < maxT ? { t: best, nx, nz } : null) : best;
  }
  // full 3D: cover has height (a bullet can pass over a crate), and the ground stops it too
  const ray3List = [];
  W.raycast3 = function (ox, oy, oz, dx, dy, dz, maxT) {
    let best = maxT, nx = 0, ny = 0, nz = 0;
    if (dy < -1e-4) {
      const gy = W.groundY(ox + dx * Math.min(maxT, 20), oz + dz * Math.min(maxT, 20));
      const tg = (gy - oy) / dy;
      if (tg > 0 && tg < best) { best = tg; nx = 0; ny = 1; nz = 0; }
    }
    const ex = ox + dx * best, ez = oz + dz * best;
    const list = boxesIn(Math.min(ox, ex), Math.min(oz, ez), Math.max(ox, ex), Math.max(oz, ez), ray3List);
    for (let k = 0; k < list.length; k++) {
      const b = list[k];
      let t0 = 0, t1 = best, axis = 0;
      const slab = (o, d, mn, mx, ax) => {
        if (Math.abs(d) < 1e-9) return o >= mn && o <= mx;
        let ta = (mn - o) / d, tb = (mx - o) / d;
        if (ta > tb) { const s = ta; ta = tb; tb = s; }
        if (ta > t0) { t0 = ta; axis = ax; }
        if (tb < t1) t1 = tb;
        return t0 <= t1;
      };
      if (!slab(ox, dx, b.minX, b.maxX, 1) || !slab(oy, dy, b.minY || 0, b.h, 2) || !slab(oz, dz, b.minZ, b.maxZ, 3)) continue;
      if (axis && t0 < best) {
        best = t0;
        nx = axis === 1 ? -Math.sign(dx) : 0; ny = axis === 2 ? -Math.sign(dy) : 0; nz = axis === 3 ? -Math.sign(dz) : 0;
      }
    }
    return { t: best, hit: best < maxT, nx, ny, nz };
  };
  W.hasLOS3 = function (ax, ay, az, bx, by, bz) {
    const dx = bx - ax, dy = by - ay, dz = bz - az, d = Math.hypot(dx, dy, dz) || 1e-4;
    return W.raycast3(ax, ay, az, dx / d, dy / d, dz / d, d).t >= d - 0.05;
  };
  W.raycast = (ox, oz, dx, dz, maxT) => rayCore(ox, oz, dx, dz, maxT, false);
  W.rayNormal = (ox, oz, dx, dz, maxT) => rayCore(ox, oz, dx, dz, maxT, true);
  W.hasLOS = function (ax, az, bx, bz) {
    const dx = bx - ax, dz = bz - az, d = Math.hypot(dx, dz);
    if (d < 0.01) return true;
    return W.raycast(ax, az, dx / d, dz / d, d) >= d - 0.05;
  };
  W.inBuilding = function (x, y, z, pad) {
    if (y < W.groundY(x, z) + pad * 0.6) return true;
    const list = boxesIn(x - pad, z - pad, x + pad, z + pad, near);
    for (const b of list) {
      if (x > b.minX - pad && x < b.maxX + pad && z > b.minZ - pad && z < b.maxZ + pad && y < b.h + pad) return true;
    }
    return false;
  };
  W.ringPos = function (i, j, s) {
    const cx = W.blockCenter(i), cz = W.blockCenter(j);
    s = ((s % 160) + 160) % 160;
    const side = Math.floor(s / 40), t = s - side * 40 - 20;
    if (side === 0) return { x: cx + t, z: cz - 20 };
    if (side === 1) return { x: cx + 20, z: cz + t };
    if (side === 2) return { x: cx - t, z: cz + 20 };
    return { x: cx - 20, z: cz - t };
  };
  W.nearestRing = function (x, z) {
    const i = W.blockIndex(x), j = W.blockIndex(z);
    const lx = x - W.blockCenter(i), lz = z - W.blockCenter(j);
    const c = (v) => Math.max(-20, Math.min(20, v));
    const cand = [
      [Math.hypot(lx - c(lx), lz + 20), c(lx) + 20],
      [Math.hypot(lx - 20, lz - c(lz)), 40 + c(lz) + 20],
      [Math.hypot(lx + c(-lx), lz - 20), 80 + c(-lx) + 20],
      [Math.hypot(lx + 20, lz + c(-lz)), 120 + c(-lz) + 20],
    ];
    cand.sort((a, b) => a[0] - b[0]);
    return { i, j, s: cand[0][1] };
  };
  W.randomSidewalkPoint = function (px, pz, rmin, rmax) {
    if (cityDist(px, pz) > rmax) return null;
    const bi = W.blockIndex(px), bj = W.blockIndex(pz);
    for (let k = 0; k < 25; k++) {
      const i = bi + ((Math.random() * 5) | 0) - 2, j = bj + ((Math.random() * 5) | 0) - 2;
      if (!W.isActive(i, j)) continue;
      const s = Math.random() * 160, p = W.ringPos(i, j, s);
      const d = Math.hypot(p.x - px, p.z - pz);
      if (d >= rmin && d <= rmax) return { x: p.x, z: p.z, i, j, s };
    }
    return null;
  };
  W.randomRoadPoint = function (px, pz, rmin, rmax, parked) {
    if (cityDist(px, pz) < rmax) {
      const off = parked ? 6.3 : 3.5;
      for (let k = 0; k < 30; k++) {
        const alongZ = Math.random() < 0.5;
        const base = alongZ ? px : pz, other = alongZ ? pz : px;
        const ri = W.roadIndex(base) + ((Math.random() * 5) | 0) - 2;
        if (ri < 0 || ri > NB) continue;
        const r = W.roadLine(ri);
        const a = clamp(other + (Math.random() * 2 - 1) * rmax, -234, 234);
        const m = (((a + HALF) % P) + P) % P;
        if (m < 12 || m > P - 12) continue;
        const seg = Math.floor((a + HALF) / P);
        if (alongZ ? !(W.isActive(ri - 1, seg) || W.isActive(ri, seg)) : !(W.isActive(seg, ri - 1) || W.isActive(seg, ri))) continue;
        const fwd = Math.random() < 0.5;
        let x, z, h;
        if (alongZ) { h = fwd ? 0 : Math.PI; x = r + (fwd ? -off : off); z = a; }
        else { h = fwd ? Math.PI / 2 : -Math.PI / 2; z = r + (fwd ? off : -off); x = a; }
        if (parked && (Math.abs(x) > 244 || Math.abs(z) > 244)) continue;
        const d = Math.hypot(x - px, z - pz);
        if (d >= rmin && d <= rmax) return { x, z, h };
      }
    }
    // out in the country: anywhere along the island's roads
    const S = W.roadSamples;
    for (let k = 0; k < 60; k++) {
      const q = S[(Math.random() * S.length) | 0];
      if (q.lock) continue;
      const d = Math.hypot(q.x - px, q.z - pz);
      if (d < rmin || d > rmax) continue;
      const fwd = Math.random() < 0.5, off = parked ? 4.6 : 2.8;
      const nx = -q.tz, nz = q.tx, side = fwd ? -1 : 1;
      return { x: q.x + nx * off * side, z: q.z + nz * off * side, h: Math.atan2(q.tx, q.tz) + (fwd ? 0 : Math.PI) };
    }
    return null;
  };

  // ------------------------------------------------------------ map
  W.drawMap = function (canvas, scale) {
    const w = Math.round((MAP.x1 - MAP.x0) * scale), h = Math.round((MAP.z1 - MAP.z0) * scale);
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext('2d');
    const img = ctx.createImageData(w, h), d = img.data;
    for (let py = 0; py < h; py++) {
      const z = MAP.z0 + py / scale;
      for (let px = 0; px < w; px++) {
        const x = MAP.x0 + px / scale, ht = hm(x, z), o = (py * w + px) * 4;
        let r, g, b;
        if (ht < SEA) { r = 10; g = 24; b = 34; }
        else if (W.snowAt(z, x) > 0.6 || ht > 100) { const s = clamp(ht / 200, 0, 1); r = 160 - s * 40; g = 170 - s * 40; b = 182 - s * 36; }
        else if (ht < 2 && landF(x, z) < 0.08) { r = 92; g = 84; b = 60; }
        else { const s = clamp(ht / 120, 0, 1); r = 30 + s * 40; g = 44 + s * 30; b = 30 + s * 30; }
        d[o] = r; d[o + 1] = g; d[o + 2] = b; d[o + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    const m = (x, z) => [(x - MAP.x0) * scale, (z - MAP.z0) * scale];
    ctx.strokeStyle = '#3e4552'; ctx.lineWidth = 11 * scale; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    for (const r of W.roads) { ctx.beginPath(); r.pts.forEach((p, k) => { const [a, b] = m(p.x, p.z); if (k) ctx.lineTo(a, b); else ctx.moveTo(a, b); }); ctx.stroke(); }
    ctx.fillStyle = '#2b303a';
    for (const r of ACTIVE) { const [a, b] = m(r.x0, r.z0); ctx.fillRect(a, b, 60 * scale, 60 * scale); }
    for (const r of ACTIVE) {
      const type = SPECIAL[r.i + ',' + r.j];
      ctx.fillStyle = type === 'park' ? '#16261a' : type === 'lot' ? '#1a1c20' : '#14171d';
      const [a, b] = m(r.x0 + 8, r.z0 + 8); ctx.fillRect(a, b, 44 * scale, 44 * scale);
    }
    ctx.fillStyle = '#272c37';
    for (const bx of W.boxes) { if (bx.maxX - bx.minX < 1.5) continue; const [a, b] = m(bx.minX, bx.minZ); ctx.fillRect(a, b, (bx.maxX - bx.minX) * scale, (bx.maxZ - bx.minZ) * scale); }
    ctx.fillStyle = '#4a3e30';
    for (const dk of W.decks) { const [a, b] = m(dk.minX, dk.minZ); ctx.fillRect(a, b, (dk.maxX - dk.minX) * scale, (dk.maxZ - dk.minZ) * scale); }
    ctx.fillStyle = '#b3121e';
    const [cx, cz] = m(90, 77); ctx.fillRect(cx - 1.5 * scale, cz - 4 * scale, 3 * scale, 8 * scale); ctx.fillRect(cx - 3 * scale, cz - 2 * scale, 6 * scale, 2 * scale);
    if (W.lighthouse) { const [a, b] = m(W.lighthouse.x, W.lighthouse.z); ctx.fillStyle = '#fff0b0'; ctx.beginPath(); ctx.arc(a, b, 4 * scale + 1, 0, 6.3); ctx.fill(); }
  };
})();
