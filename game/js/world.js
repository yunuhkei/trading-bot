'use strict';
// World: procedural city of Port Calvary, collision, rain, lightning, neon.
(function () {
  const T = THREE;
  const P = 60, NB = 8, HALF = 240, LIMIT = 246;
  const W = (G.world = { P, NB, HALF, LIMIT, boxes: [], blockBoxes: [], signs: [], lotSpots: [] });
  const rng = G.mulberry32(911);
  const rr = (a, b) => a + rng() * (b - a);
  const rpick = (arr) => arr[(rng() * arr.length) | 0];

  W.blockCenter = (i) => (i - 3.5) * P;
  W.blockIndex = (v) => Math.max(0, Math.min(NB - 1, Math.floor((v + HALF) / P)));
  W.roadLine = (k) => k * P - HALF;
  W.roadIndex = (v) => Math.max(0, Math.min(NB, Math.round((v + HALF) / P)));
  for (let i = 0; i < NB; i++) { W.blockBoxes.push([]); for (let j = 0; j < NB; j++) W.blockBoxes[i].push([]); }

  const SPECIAL = { '4,3': 'laundromat', '0,6': 'motel', '5,5': 'church', '2,4': 'park', '6,1': 'lot' };
  W.SPECIAL = SPECIAL;

  const _c = new T.Color();
  const lin = (hex, k = 1) => { _c.set(hex); return [_c.r * k, _c.g * k, _c.b * k]; };
  W.lin = lin;

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

  // ------------------------------------------------------------ textures
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
    W.boxes.push(b);
    if (i >= 0) W.blockBoxes[i][j].push(b);
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
    W.boxes.push(pb); W.blockBoxes[i][j].push(pb);
    for (let k = 0; k < 26; k++) {
      const lx = rr(-17, 17), lz = rr(-17, 17);
      if (Math.abs(lx) < 3.5 || Math.abs(lz) < 3.5) continue;
      const x = cx + lx, z = cz + lz;
      plain.box(x, 1.2, z, 0.35, 2.4, 0.35, TRUNK, 0);
      trees.push([x, z, rr(0.8, 1.3)]);
      const tb = { minX: x - 0.3, maxX: x + 0.3, minZ: z - 0.3, maxZ: z + 0.3, h: 6 };
      W.boxes.push(tb); W.blockBoxes[i][j].push(tb);
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

  // ------------------------------------------------------------ build
  W.build = function (sc) {
    scene = sc;
    walls = new Builder(); walls.flatRoof = true;
    plain = new Builder(); glow = new Builder(); lamps = new Builder();
    const { wt, et } = makeWallTextures();
    W.radialTex = makeRadial();

    // ground
    const asphalt = makeAsphalt(); asphalt.repeat.set(112, 112);
    const ground = new T.Mesh(new T.PlaneGeometry(560, 560), new T.MeshLambertMaterial({ map: asphalt, color: 0xa4a7ae }));
    ground.rotation.x = -Math.PI / 2;
    scene.add(ground);

    for (let i = 0; i < NB; i++) {
      for (let j = 0; j < NB; j++) {
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
    }

    // road dashes
    const DASH = lin('#9a7a22', 0.8);
    for (let k = 0; k <= NB; k++) {
      const r = W.roadLine(k);
      for (let s = -246; s < 246; s += 8) {
        const m = (((s + 1.5 + HALF) % P) + P) % P;
        if (m < 10 || m > P - 10) continue;
        plain.box(r, 0.012, s + 1.5, 0.16, 0.02, 3, DASH, 0);
        plain.box(s + 1.5, 0.012, r, 3, 0.02, 0.16, DASH, 0);
      }
    }
    // perimeter wall + skyline beyond
    const L = LIMIT + 2.5;
    plain.box(0, 1.6, -L, 2 * L + 2, 3.2, 1.2, CONC, 4);
    plain.box(0, 1.6, L, 2 * L + 2, 3.2, 1.2, CONC, 4);
    plain.box(-L, 1.6, 0, 1.2, 3.2, 2 * L + 2, CONC, 4);
    plain.box(L, 1.6, 0, 1.2, 3.2, 2 * L + 2, CONC, 4);
    for (let side = 0; side < 4; side++) {
      for (let t = -280; t <= 280; t += rr(16, 26)) {
        const d = 266 + rr(0, 12), s = rr(12, 22), h = rr(14, 48);
        const [x, z] = side === 0 ? [t, -d] : side === 1 ? [t, d] : side === 2 ? [-d, t] : [d, t];
        addBuilding(-1, -1, x - s / 2, x + s / 2, z - s / 2, z + s / 2, h, { noFacade: true });
      }
    }
    W.boxes.splice(0); // skyline + everything re-added below from block lists
    for (let i = 0; i < NB; i++) for (let j = 0; j < NB; j++) for (const b of W.blockBoxes[i][j]) W.boxes.push(b);

    // wreck of the prison transport at the start
    buildWreck(150, -180.5);

    const wallMat = new T.MeshLambertMaterial({ map: wt, emissiveMap: et, emissive: 0xffffff, emissiveIntensity: 0.95, vertexColors: true });
    scene.add(new T.Mesh(walls.geometry(), wallMat));
    const nz = makeNoise();
    scene.add(new T.Mesh(plain.geometry(), new T.MeshLambertMaterial({ map: nz, vertexColors: true })));
    scene.add(new T.Mesh(lamps.geometry(), new T.MeshBasicMaterial({ vertexColors: true })));
    const gm = new T.Mesh(glow.geometry(), new T.MeshBasicMaterial({ map: W.radialTex, vertexColors: true, transparent: true, blending: T.AdditiveBlending, depthWrite: false }));
    gm.renderOrder = 1;
    scene.add(gm);

    // trees
    if (trees.length) {
      const cone = new T.ConeGeometry(1.9, 4.6, 6);
      const tm = new T.InstancedMesh(cone, new T.MeshLambertMaterial({ color: 0x1b2a1d }), trees.length);
      const d = new T.Object3D();
      trees.forEach(([x, z, s], k) => { d.position.set(x, 3.6 * s + 0.6, z); d.scale.set(s, s, s); d.rotation.y = k; d.updateMatrix(); tm.setMatrixAt(k, d.matrix); });
      scene.add(tm);
    }

    // church cross: visible through the fog, the one landmark you can steer by
    const cross = new T.Group();
    const cm = new T.MeshBasicMaterial({ color: 0xff2030, fog: false });
    const v = new T.Mesh(new T.BoxGeometry(0.35, 3.2, 0.35), cm); v.position.y = 45.6;
    const hbar = new T.Mesh(new T.BoxGeometry(1.8, 0.35, 0.35), cm); hbar.position.y = 46.3;
    cross.add(v, hbar); cross.position.set(W.blockCenter(5), 0, W.blockCenter(5) - 13);
    scene.add(cross);

    // lights
    W.hemi = new T.HemisphereLight(0x7487b0, 0x2a2630, 2.3);
    scene.add(W.hemi);
    const moon = new T.DirectionalLight(0x9aa8d8, 1.1);
    moon.position.set(-60, 120, 40);
    scene.add(moon);

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
    const b = { minX: x - 2.6, maxX: x + 2.6, minZ: z - 2.6, maxZ: z + 2.6, h: 2.6 };
    W.blockBoxes[W.blockIndex(x)][W.blockIndex(z)].push(b);
    plain.box(x - 9, 0.015, z + 0.8, 12, 0.02, 0.3, lin('#101010'), 0); // skid marks
    plain.box(x - 9, 0.015, z - 0.9, 12, 0.02, 0.3, lin('#101010'), 0);
    glow.disc(x, 0.03, z, 7, lin('#ff6a20', 0.35));
    // fire
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

  // ------------------------------------------------------------ rain
  let rainN = 1400, rainDraw = 1400, rainPos, rainGeo, drops;
  function buildRain() {
    rainPos = new Float32Array(rainN * 6);
    drops = new Float32Array(rainN * 3);
    for (let k = 0; k < rainN; k++) {
      drops[k * 3] = (Math.random() - 0.5) * 50; drops[k * 3 + 1] = Math.random() * 22; drops[k * 3 + 2] = (Math.random() - 0.5) * 50;
    }
    rainGeo = new T.BufferGeometry();
    rainGeo.setAttribute('position', new T.BufferAttribute(rainPos, 3));
    const rain = new T.LineSegments(rainGeo, new T.LineBasicMaterial({ color: 0x9fb2d0, transparent: true, opacity: 0.3 }));
    rain.frustumCulled = false;
    scene.add(rain);
  }
  W.setRainDensity = function (f) { rainDraw = Math.floor(rainN * f); if (rainGeo) rainGeo.setDrawRange(0, rainDraw * 2); };

  let boltT = 8 + Math.random() * 10, flashT = 0, flashSeq = 0;
  W.update = function (dt, cam) {
    const wind = 2.2;
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

    // lightning
    boltT -= dt;
    if (boltT <= 0) { boltT = 14 + Math.random() * 26; flashSeq = 2; flashT = 0; G.audio.thunder(0.8 + Math.random() * 2); }
    if (flashSeq > 0) {
      flashT += dt;
      const on = flashT < 0.07;
      W.hemi.intensity = on ? 7 : 2.3;
      if (flashT > 0.16) { flashSeq--; flashT = 0; }
    } else W.hemi.intensity = 2.3;

    for (const s of W.signs) {
      s.t -= dt;
      if (s.t <= 0) {
        if (s.on && Math.random() < s.flick * 6) { s.on = false; s.t = 0.04 + Math.random() * 0.18; }
        else { s.on = true; s.t = 0.1 + Math.random() * 0.6; }
        s.m.material.opacity = s.on ? 1 : 0.12;
      }
    }

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
    const bx = W.blockCenter(W.blockIndex(x)), bz = W.blockCenter(W.blockIndex(z));
    return Math.abs(x - bx) < 22 && Math.abs(z - bz) < 22 ? 0.12 : 0;
  };
  W.collide = function (o, r) {
    let hit = false;
    if (o.x < -LIMIT) { o.x = -LIMIT; hit = true; } else if (o.x > LIMIT) { o.x = LIMIT; hit = true; }
    if (o.z < -LIMIT) { o.z = -LIMIT; hit = true; } else if (o.z > LIMIT) { o.z = LIMIT; hit = true; }
    const list = W.blockBoxes[W.blockIndex(o.x)][W.blockIndex(o.z)];
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
  W.raycast = function (ox, oz, dx, dz, maxT) {
    let best = maxT;
    const list = W.boxes;
    for (let k = 0; k < list.length; k++) {
      const b = list[k];
      let t0 = 0, t1 = best;
      if (Math.abs(dx) < 1e-9) { if (ox < b.minX || ox > b.maxX) continue; }
      else {
        let ta = (b.minX - ox) / dx, tb = (b.maxX - ox) / dx;
        if (ta > tb) { const s = ta; ta = tb; tb = s; }
        if (ta > t0) t0 = ta; if (tb < t1) t1 = tb;
        if (t0 > t1) continue;
      }
      if (Math.abs(dz) < 1e-9) { if (oz < b.minZ || oz > b.maxZ) continue; }
      else {
        let ta = (b.minZ - oz) / dz, tb = (b.maxZ - oz) / dz;
        if (ta > tb) { const s = ta; ta = tb; tb = s; }
        if (ta > t0) t0 = ta; if (tb < t1) t1 = tb;
        if (t0 > t1) continue;
      }
      if (t0 < best) best = t0;
    }
    return best;
  };
  // like raycast, but also reports which face was hit (for wall decals)
  W.rayNormal = function (ox, oz, dx, dz, maxT) {
    let best = maxT, nx = 0, nz = 0;
    for (const b of W.boxes) {
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
      if (axis && t0 < best) { best = t0; nx = axis === 1 ? -Math.sign(dx) : 0; nz = axis === 2 ? -Math.sign(dz) : 0; }
    }
    return best < maxT ? { t: best, nx, nz } : null;
  };
  W.hasLOS = function (ax, az, bx, bz) {
    const dx = bx - ax, dz = bz - az, d = Math.hypot(dx, dz);
    if (d < 0.01) return true;
    return W.raycast(ax, az, dx / d, dz / d, d) >= d - 0.05;
  };
  W.inBuilding = function (x, y, z, pad) {
    if (Math.abs(x) > LIMIT + 4 || Math.abs(z) > LIMIT + 4) return y < 3.5;
    const list = W.blockBoxes[W.blockIndex(x)][W.blockIndex(z)];
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
    const bi = W.blockIndex(px), bj = W.blockIndex(pz);
    for (let k = 0; k < 25; k++) {
      const i = bi + ((Math.random() * 5) | 0) - 2, j = bj + ((Math.random() * 5) | 0) - 2;
      if (i < 0 || j < 0 || i >= NB || j >= NB) continue;
      const s = Math.random() * 160, p = W.ringPos(i, j, s);
      const d = Math.hypot(p.x - px, p.z - pz);
      if (d >= rmin && d <= rmax) return { x: p.x, z: p.z, i, j, s };
    }
    return null;
  };
  W.randomRoadPoint = function (px, pz, rmin, rmax, parked) {
    const off = parked ? 6.3 : 3.5;
    for (let k = 0; k < 30; k++) {
      const alongZ = Math.random() < 0.5;
      const base = alongZ ? px : pz, other = alongZ ? pz : px;
      let ri = W.roadIndex(base) + ((Math.random() * 5) | 0) - 2;
      if (ri < (parked ? 1 : 0) || ri > (parked ? NB - 1 : NB)) continue;
      const r = W.roadLine(ri);
      const a = G.clamp(other + (Math.random() * 2 - 1) * rmax, -234, 234);
      const m = (((a + HALF) % P) + P) % P;
      if (m < 12 || m > P - 12) continue;
      const fwd = Math.random() < 0.5;
      let x, z, h;
      if (alongZ) { h = fwd ? 0 : Math.PI; x = r + (fwd ? -off : off); z = a; }
      else { h = fwd ? Math.PI / 2 : -Math.PI / 2; z = r + (fwd ? off : -off); x = a; }
      const d = Math.hypot(x - px, z - pz);
      if (d >= rmin && d <= rmax) return { x, z, h };
    }
    return null;
  };
})();
