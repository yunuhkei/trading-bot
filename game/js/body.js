'use strict';
// Bodies: instanced low-poly people, procedural animation, Verlet ragdolls, and blood.
// Every person is 15 joints. Alive, the joints come from a walk/aim pose; dead, they are
// physics particles held together by bone constraints. Body parts are boxes drawn between joints.
(function () {
  const T = THREE, W = G.world;
  const B = (G.body = {});
  const PARTS = 23, MAXB = 90, STEP = 1 / 60;
  const PELVIS = 0, NECK = 1, HEAD = 2, SHL = 3, SHR = 4, ELL = 5, ELR = 6, HAL = 7, HAR = 8,
    HPL = 9, HPR = 10, KNL = 11, KNR = 12, FTL = 13, FTR = 14;
  B.J = { PELVIS, NECK, HEAD, SHL, SHR, ELL, ELR, HAL, HAR, HPL, HPR, KNL, KNR, FTL, FTR };
  const RAD = [0.11, 0.1, 0.13, 0.08, 0.08, 0.06, 0.06, 0.05, 0.05, 0.09, 0.09, 0.07, 0.07, 0.06, 0.06];
  const RIGID = [[PELVIS, NECK], [NECK, HEAD], [SHL, SHR], [SHL, NECK], [SHR, NECK], [SHL, PELVIS], [SHR, PELVIS],
    [HPL, HPR], [HPL, PELVIS], [HPR, PELVIS], [HPL, NECK], [HPR, NECK], [SHL, HPR], [SHR, HPL], [SHL, HPL], [SHR, HPR],
    [SHL, ELL], [ELL, HAL], [SHR, ELR], [ELR, HAR], [HPL, KNL], [KNL, FTL], [HPR, KNR], [KNR, FTR]];
  // minimum distances (× body height) so limbs bend but never fold through themselves
  const MINS = [[HEAD, SHL, 0.25], [HEAD, SHR, 0.25], [HEAD, PELVIS, 0.62], [SHL, HAL, 0.24], [SHR, HAR, 0.24],
    [HPL, FTL, 0.5], [HPR, FTR, 0.5], [KNL, KNR, 0.1], [FTL, FTR, 0.1], [HEAD, HPL, 0.6], [HEAD, HPR, 0.6], [ELL, PELVIS, 0.12], [ELR, PELVIS, 0.12]];

  let mesh, haloMesh, M, HM;
  const free = [], list = [];
  B.list = list;
  const col = new T.Color(), BLOODC = new T.Color('#4a0508');

  B.init = function (scene) {
    mesh = new T.InstancedMesh(new T.BoxGeometry(1, 1, 1), new T.MeshLambertMaterial({ color: 0xffffff }), PARTS * MAXB);
    mesh.instanceMatrix.setUsage(T.DynamicDrawUsage);
    mesh.setColorAt(0, col.set(0xffffff));
    M = mesh.instanceMatrix.array; M.fill(0);
    mesh.frustumCulled = false; mesh.count = 0;
    scene.add(mesh);
    haloMesh = new T.InstancedMesh(new T.TorusGeometry(0.2, 0.024, 6, 20), new T.MeshBasicMaterial({ color: 0xffffff }), MAXB);
    haloMesh.instanceMatrix.setUsage(T.DynamicDrawUsage);
    haloMesh.setColorAt(0, col.set(0xffffff));
    HM = haloMesh.instanceMatrix.array; HM.fill(0);
    haloMesh.frustumCulled = false; haloMesh.count = 0;
    scene.add(haloMesh);
    for (let k = MAXB - 1; k >= 0; k--) free.push(k);
    initBlood(scene);
  };
  B.hasFree = () => free.length > 0;

  // ---------------------------------------------------------------- creation
  B.create = function (c, o) {
    const slot = free.pop();
    if (slot === undefined) return false;
    c.body = {
      slot, o, h: o.h || G.R(0.93, 1.07), w: o.w || G.R(0.92, 1.14),
      j: new Float32Array(45), jp: new Float32Array(45), rag: null, posed: false,
      vis: new Uint8Array(PARTS), bloody: 0, visible: true, written: false, trailD: 0, lx: c.x, lz: c.z,
    };
    list.push(c);
    B.recolor(c);
    return true;
  };
  B.release = function (c) {
    const b = c.body;
    if (!b) return;
    M.fill(0, b.slot * PARTS * 16, (b.slot + 1) * PARTS * 16);
    HM.fill(0, b.slot * 16, b.slot * 16 + 16);
    mesh.instanceMatrix.needsUpdate = true; haloMesh.instanceMatrix.needsUpdate = true;
    free.push(b.slot);
    const k = list.indexOf(c);
    if (k >= 0) list.splice(k, 1);
    c.body = null;
  };
  // back on their feet: drop the ragdoll (and, unless soft, the blood) and pose again
  B.revive = function (c, soft) {
    const b = c.body;
    if (!b) return;
    if (!soft) { b.rag = null; b.posed = false; b.bloody = 0; b.pooled = false; c.headshot = false; c.bigPool = false; B.recolor(c); }
    b.written = false;
  };
  B.setVisible = function (c, v) { if (c.body) { c.body.visible = v; c.body.written = false; } };

  const BLOODMIX = { 0: 0.75, 1: 0.45, 2: 0.3, 3: 0.55, 6: 0.55, 15: 0.5, 22: 0.6 };
  B.recolor = function (c) {
    const b = c.body, o = b.o, base = b.slot * PARTS;
    const shade = (hex, k) => { col.set(hex); col.multiplyScalar(k); return '#' + col.getHexString(); };
    const C = [
      o.shirt, o.long ? o.shirt : o.pants, o.skin, o.shirt, o.shirt, o.skin, o.shirt, o.shirt, o.skin,
      o.pants, o.pants, o.shoes, o.pants, o.pants, o.shoes,
      o.long ? o.shirt : null,
      o.hood || o.cap || o.hair || null, o.cap || null,
      o.mask ? '#d9d3c4' : shade(o.skin, 0.88),
      o.mask ? '#030303' : '#160f0c', o.mask ? '#030303' : '#160f0c',
      o.gun ? '#0c0c0d' : null,
      o.badge ? '#c9a24a' : o.long ? shade(o.shirt, 0.7) : null,
    ];
    for (let k = 0; k < PARTS; k++) {
      b.vis[k] = C[k] ? 1 : 0;
      if (!C[k]) continue;
      col.set(C[k]);
      const m = BLOODMIX[k];
      if (m && b.bloody > 0) col.lerp(BLOODC, Math.min(1, b.bloody) * m);
      mesh.setColorAt(base + k, col);
    }
    mesh.instanceColor.needsUpdate = true;
    if (o.halo || o.tinHalo) { haloMesh.setColorAt(b.slot, col.set(o.halo ? '#f1e6c4' : '#8c8c88')); haloMesh.instanceColor.needsUpdate = true; }
  };
  B.addBlood = function (c, amt) {
    if (!c.body) return;
    c.body.bloody = Math.min(1, c.body.bloody + amt);
    B.recolor(c);
  };

  // ---------------------------------------------------------------- living pose
  B.pose = function (c, dt, speed, aiming) {
    const b = c.body;
    if (!b || b.rag) return;
    b.lastDt = dt;
    if (b.posed) b.jp.set(b.j);
    c.phase += dt * speed * 2.6;
    const amp = Math.min(1, speed / 4.5);
    const ph = c.phase;
    const bob = Math.abs(Math.cos(ph)) * 0.045 * amp + Math.sin(G.time * 2.1 + c.born) * 0.004;
    if (c.flinch > 0) c.flinch = Math.max(0, c.flinch - dt * 2.5);
    const lean = Math.min(0.2, speed * 0.022) - (c.flinch || 0) * 0.5;
    const r = c.rot, s = Math.sin(r), co = Math.cos(r);
    const bx = c.x, by = W.groundY(c.x, c.z), bz = c.z, h = b.h, w = b.w, j = b.j;
    const put = (k, lx, ly, lz) => {
      lx *= w; ly *= h; lz *= h;
      const o = k * 3;
      j[o] = bx + co * lx + s * lz; j[o + 1] = by + ly; j[o + 2] = bz - s * lx + co * lz;
    };
    put(PELVIS, 0, 0.95 + bob, 0);
    put(NECK, 0, 1.45 + bob, lean * 0.5);
    put(HEAD, 0, 1.66 + bob, lean * 0.72 + 0.01);
    put(SHL, 0.2, 1.42 + bob, lean * 0.47);
    put(SHR, -0.2, 1.42 + bob, lean * 0.47);
    for (let side = 0; side < 2; side++) {
      const sg = side === 0 ? 1 : -1, p = side === 0 ? ph : ph + Math.PI;
      const a = Math.sin(p) * 0.6 * amp, bend = Math.max(0, Math.sin(p - 1.3)) * 1.1 * amp + 0.04;
      const hy = 0.92 + bob, ky = hy - 0.43 * Math.cos(a), kz = 0.43 * Math.sin(a);
      let fy = ky - 0.43 * Math.cos(a - bend);
      const fz = kz + 0.43 * Math.sin(a - bend);
      if (fy < 0.07) fy = 0.07;
      put(side === 0 ? HPL : HPR, sg * 0.1, hy, 0);
      put(side === 0 ? KNL : KNR, sg * 0.11, ky, kz);
      put(side === 0 ? FTL : FTR, sg * 0.11, fy, fz);
    }
    const lz = lean * 0.47;
    if (aiming) {
      put(ELR, -0.13, 1.37 + bob, 0.27 + lz); put(HAR, -0.04, 1.4 + bob, 0.53 + lz);
      put(ELL, 0.12, 1.3 + bob, 0.22 + lz); put(HAL, 0.0, 1.37 + bob, 0.5 + lz);
    } else {
      const panic = c.fleeT > 0 ? 1 : 0;
      for (let side = 0; side < 2; side++) {
        const sg = side === 0 ? 1 : -1, p = side === 0 ? ph + Math.PI : ph;
        const sa = Math.sin(p) * (0.55 + panic * 0.4) * amp, eb = 0.12 + 0.95 * amp + panic * 0.5;
        const sy = 1.42 + bob, ey = sy - 0.29 * Math.cos(sa), ez = lz + 0.29 * Math.sin(sa);
        const hy = ey - 0.27 * Math.cos(sa + eb), hz = ez + 0.27 * Math.sin(sa + eb);
        put(side === 0 ? ELL : ELR, sg * 0.23, ey, ez);
        put(side === 0 ? HAL : HAR, sg * 0.24, hy, hz);
      }
    }
    if (!b.posed) { b.jp.set(j); b.posed = true; }
  };

  // ---------------------------------------------------------------- ragdoll
  function dist(p, a, b) {
    const dx = p[b * 3] - p[a * 3], dy = p[b * 3 + 1] - p[a * 3 + 1], dz = p[b * 3 + 2] - p[a * 3 + 2];
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
  }
  B.startRag = function (c) {
    const b = c.body;
    if (b.rag) return b.rag;
    const p = Float32Array.from(b.j), o = new Float32Array(45);
    const fd = Math.max(b.lastDt || STEP, 1 / 120);
    for (let i = 0; i < 45; i++) {
      const v = G.clamp((b.j[i] - b.jp[i]) / fd, -14, 14);
      o[i] = p[i] - v * STEP;
    }
    const rigid = new Float32Array(RIGID.length);
    RIGID.forEach((r, k) => { rigid[k] = dist(p, r[0], r[1]); });
    b.rag = { p, o, rigid, still: 0, t: 0, sleep: false, acc: 0 };
    b.written = false;
    return b.rag;
  };
  // add velocity (m/s) to one joint (k) and a share of it to the rest of the body
  B.push = function (c, k, vx, vy, vz, spread) {
    const r = B.startRag(c);
    r.sleep = false; r.still = 0; r.t = Math.min(r.t, 6);
    c.body.written = false;
    for (let i = 0; i < 15; i++) {
      const f = k < 0 || i === k ? 1 : spread;
      r.o[i * 3] -= vx * f * STEP; r.o[i * 3 + 1] -= vy * f * STEP; r.o[i * 3 + 2] -= vz * f * STEP;
    }
  };
  B.pushJoint = function (c, i, vx, vy, vz) {
    const r = B.startRag(c);
    r.sleep = false; r.still = 0; c.body.written = false;
    r.o[i * 3] -= vx * STEP; r.o[i * 3 + 1] -= vy * STEP; r.o[i * 3 + 2] -= vz * STEP;
  };

  const tmp = { x: 0, z: 0 };
  function step(c, r) {
    const p = r.p, o = r.o, g = 9.8 * STEP * STEP, h = c.body.h;
    for (let i = 0; i < 45; i += 3) {
      const vx = (p[i] - o[i]) * 0.996, vy = (p[i + 1] - o[i + 1]) * 0.996, vz = (p[i + 2] - o[i + 2]) * 0.996;
      o[i] = p[i]; o[i + 1] = p[i + 1]; o[i + 2] = p[i + 2];
      p[i] += vx; p[i + 1] += vy - g; p[i + 2] += vz;
    }
    for (let it = 0; it < 5; it++) {
      for (let k = 0; k < RIGID.length; k++) {
        const a = RIGID[k][0] * 3, b = RIGID[k][1] * 3;
        const dx = p[b] - p[a], dy = p[b + 1] - p[a + 1], dz = p[b + 2] - p[a + 2];
        const d = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1e-5;
        const f = (d - r.rigid[k]) / d * 0.5;
        p[a] += dx * f; p[a + 1] += dy * f; p[a + 2] += dz * f;
        p[b] -= dx * f; p[b + 1] -= dy * f; p[b + 2] -= dz * f;
      }
      for (let k = 0; k < MINS.length; k++) {
        const a = MINS[k][0] * 3, b = MINS[k][1] * 3, m = MINS[k][2] * h;
        const dx = p[b] - p[a], dy = p[b + 1] - p[a + 1], dz = p[b + 2] - p[a + 2];
        const d = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1e-5;
        if (d >= m) continue;
        const f = (d - m) / d * 0.5;
        p[a] += dx * f; p[a + 1] += dy * f; p[a + 2] += dz * f;
        p[b] -= dx * f; p[b + 1] -= dy * f; p[b + 2] -= dz * f;
      }
      for (let i = 0; i < 15; i++) {
        const q = i * 3, gy = W.groundY(p[q], p[q + 2]) + RAD[i];
        if (p[q + 1] < gy) p[q + 1] = gy;
        if (p[q + 1] < 30) {
          tmp.x = p[q]; tmp.z = p[q + 2];
          if (W.collide(tmp, RAD[i])) { p[q] = tmp.x; p[q + 2] = tmp.z; }
        }
      }
    }
    let moved = 0;
    for (let i = 0; i < 15; i++) {
      const q = i * 3, gy = W.groundY(p[q], p[q + 2]) + RAD[i];
      if (p[q + 1] <= gy + 0.004) { // ground friction
        o[q] = p[q] - (p[q] - o[q]) * 0.55;
        o[q + 2] = p[q + 2] - (p[q + 2] - o[q + 2]) * 0.55;
      }
      const m = Math.abs(p[q] - o[q]) + Math.abs(p[q + 1] - o[q + 1]) + Math.abs(p[q + 2] - o[q + 2]);
      if (m > moved) moved = m;
    }
    r.t += STEP;
    if (moved < 0.0016) r.still += STEP; else r.still = 0;
    if (r.still > 0.5 || r.t > 12) r.sleep = true;
  }
  B.settle = function (c, steps) {
    const r = B.startRag(c);
    for (let k = 0; k < steps && !r.sleep; k++) step(c, r);
    c.body.j.set(r.p);
    c.x = (r.p[0] + r.p[3]) / 2; c.z = (r.p[2] + r.p[5]) / 2;
  };

  // nearest dead body along a ray in x/z
  B.rayDead = function (ox, oz, dx, dz, maxT) {
    let best = null, bt = maxT;
    for (const c of list) {
      const b = c.body;
      if (c.alive || !b.rag || !b.visible) continue;
      const p = b.rag.p;
      for (const k of [PELVIS, NECK, HEAD, KNL, KNR]) {
        const vx = p[k * 3] - ox, vz = p[k * 3 + 2] - oz;
        const t = vx * dx + vz * dz;
        if (t < 0 || t > bt) continue;
        if (Math.abs(vx * dz - vz * dx) < 0.32) { bt = t; best = { c, t, k }; }
      }
    }
    return best;
  };
  B.jointPos = function (c, k) {
    const j = c.body.j;
    return { x: j[k * 3], y: j[k * 3 + 1], z: j[k * 3 + 2] };
  };

  // a moving car shoves any dead body under or against it
  B.carSweep = function (car, vx, vz) {
    const sp = Math.hypot(vx, vz);
    if (sp < 1.5) return;
    const fx = Math.sin(car.heading), fz = Math.cos(car.heading);
    for (const c of list) {
      if (c.alive || !c.body || !c.body.rag) continue;
      const dx0 = c.x - car.x, dz0 = c.z - car.z;
      if (dx0 * dx0 + dz0 * dz0 > 16) continue;
      const r = c.body.rag, p = r.p;
      let hit = false;
      for (let i = 0; i < 15; i++) {
        const q = i * 3, dx = p[q] - car.x, dz = p[q + 2] - car.z;
        const lz = dx * fx + dz * fz, lx = dx * fz - dz * fx;
        if (Math.abs(lx) < car.hw + 0.15 && Math.abs(lz) < car.hl + 0.15 && p[q + 1] < 1.3) {
          const up = 1.5 + sp * 0.12 + Math.random() * 1.5;
          r.o[q] = p[q] - (vx * 0.9 + G.R(-1, 1)) * STEP;
          r.o[q + 1] = p[q + 1] - up * STEP;
          r.o[q + 2] = p[q + 2] - (vz * 0.9 + G.R(-1, 1)) * STEP;
          hit = true;
        }
      }
      if (hit) {
        r.sleep = false; r.still = 0; c.body.written = false;
        if (Math.random() < 0.3) G.blood.splat(c.x + G.R(-1, 1), W.groundY(c.x, c.z) + 0.012, c.z + G.R(-1, 1), 0, 1, 0, G.R(0.3, 0.7));
      }
    }
  };

  // ---------------------------------------------------------------- render
  const P = new T.Vector3(), N = new T.Vector3(), H = new T.Vector3(), SL = new T.Vector3(), SR = new T.Vector3();
  const up = new T.Vector3(), ax = new T.Vector3(), fw = new T.Vector3();
  const hx = new T.Vector3(), hy = new T.Vector3(), hz = new T.Vector3();
  const lX = new T.Vector3(), lY = new T.Vector3(), lZ = new T.Vector3();
  const A = new T.Vector3(), Bv = new T.Vector3(), C = new T.Vector3();
  const jv = (j, k, v) => v.set(j[k * 3], j[k * 3 + 1], j[k * 3 + 2]);
  function setM(arr, i, px, py, pz, X, Y, Z, sx, sy, sz) {
    const o = i * 16;
    arr[o] = X.x * sx; arr[o + 1] = X.y * sx; arr[o + 2] = X.z * sx; arr[o + 3] = 0;
    arr[o + 4] = Y.x * sy; arr[o + 5] = Y.y * sy; arr[o + 6] = Y.z * sy; arr[o + 7] = 0;
    arr[o + 8] = Z.x * sz; arr[o + 9] = Z.y * sz; arr[o + 10] = Z.z * sz; arr[o + 11] = 0;
    arr[o + 12] = px; arr[o + 13] = py; arr[o + 14] = pz; arr[o + 15] = 1;
  }
  function basisAlong(a, b) { // lY along a→b, lX from the body's side axis
    lY.subVectors(b, a);
    const len = lY.length() || 1e-4;
    lY.multiplyScalar(1 / len);
    lX.copy(ax).addScaledVector(lY, -ax.dot(lY));
    let l = lX.length();
    if (l < 1e-3) { lX.copy(fw).addScaledVector(lY, -fw.dot(lY)); l = lX.length() || 1; }
    lX.multiplyScalar(1 / l);
    lZ.crossVectors(lX, lY);
    return len;
  }
  function headPart(base, k, ox, oy, oz, sx, sy, sz, b) {
    if (!b.vis[k]) { M.fill(0, (base + k) * 16, (base + k + 1) * 16); return; }
    setM(M, base + k, H.x + hx.x * ox + hy.x * oy + hz.x * oz, H.y + hx.y * ox + hy.y * oy + hz.y * oz, H.z + hx.z * ox + hy.z * oy + hz.z * oz, hx, hy, hz, sx, sy, sz);
  }
  function torsoPart(base, k, ox, oy, oz, sx, sy, sz, b) {
    if (!b.vis[k]) { M.fill(0, (base + k) * 16, (base + k + 1) * 16); return; }
    setM(M, base + k, P.x + ax.x * ox + up.x * oy + fw.x * oz, P.y + ax.y * ox + up.y * oy + fw.y * oz, P.z + ax.z * ox + up.z * oy + fw.z * oz, ax, up, fw, sx, sy, sz);
  }

  function writeBody(c) {
    const b = c.body, j = b.j, base = b.slot * PARTS, o = b.o, w = b.w, h = b.h;
    if (!b.visible) {
      M.fill(0, base * 16, (base + PARTS) * 16);
      HM.fill(0, b.slot * 16, b.slot * 16 + 16);
      return;
    }
    jv(j, PELVIS, P); jv(j, NECK, N); jv(j, HEAD, H); jv(j, SHL, SL); jv(j, SHR, SR);
    up.subVectors(N, P);
    const tl = up.length() || 1e-4;
    up.multiplyScalar(1 / tl);
    ax.subVectors(SL, SR);
    ax.addScaledVector(up, -ax.dot(up));
    if (ax.lengthSq() < 1e-6) ax.set(1, 0, 0);
    ax.normalize();
    fw.crossVectors(ax, up);
    // torso, pelvis, coat skirt, collar/badge
    torsoPart(base, 0, 0, tl * 0.5 + 0.03, 0, 0.4 * w, tl + 0.12, 0.23 * w, b);
    torsoPart(base, 1, 0, -0.05, 0, 0.36 * w, 0.2, 0.24 * w, b);
    torsoPart(base, 15, 0, -0.27 * h, -0.005, 0.44 * w, 0.52 * h, 0.28 * w, b);
    if (o.badge) torsoPart(base, 22, 0.1 * w, tl * 0.75, 0.122 * w, 0.06, 0.06, 0.015, b);
    else torsoPart(base, 22, 0, tl + 0.02, -0.01, 0.44 * w, 0.08, 0.27 * w, b);
    // head
    hy.subVectors(H, N).normalize();
    hx.copy(ax).addScaledVector(hy, -ax.dot(hy)).normalize();
    hz.crossVectors(hx, hy);
    headPart(base, 2, 0, 0, 0, 0.23, 0.27, 0.25, b);
    if (o.hood) headPart(base, 16, 0, 0.02, -0.035, 0.29, 0.33, 0.24, b);
    else if (o.cap) headPart(base, 16, 0, 0.135, 0, 0.26, 0.07, 0.27, b);
    else headPart(base, 16, 0, 0.125, -0.012, 0.25, 0.06, 0.27, b);
    headPart(base, 17, 0, 0.105, 0.17, 0.25, 0.025, 0.11, b);
    if (o.mask) headPart(base, 18, 0, 0, 0.128, 0.22, 0.25, 0.02, b);
    else headPart(base, 18, 0, -0.015, 0.13, 0.04, 0.06, 0.04, b);
    const ez = o.mask ? 0.14 : 0.127;
    headPart(base, 19, 0.055, 0.035, ez, 0.045, 0.028, 0.012, b);
    headPart(base, 20, -0.055, 0.035, ez, 0.045, 0.028, 0.012, b);
    // arms
    const limb = (k, ja, jb, sw, sd, ext) => {
      jv(j, ja, A); jv(j, jb, Bv);
      const len = basisAlong(A, Bv);
      C.addVectors(A, Bv).multiplyScalar(0.5);
      setM(M, base + k, C.x, C.y, C.z, lX, lY, lZ, sw, len + ext, sd);
    };
    const hand = (k, at) => {
      jv(j, at, A);
      setM(M, base + k, A.x + lY.x * 0.055, A.y + lY.y * 0.055, A.z + lY.z * 0.055, lX, lY, lZ, 0.085, 0.11, 0.1);
    };
    limb(3, SHL, ELL, 0.12 * w, 0.13 * w, 0.05); limb(4, ELL, HAL, 0.1 * w, 0.11 * w, 0.03); hand(5, HAL);
    limb(6, SHR, ELR, 0.12 * w, 0.13 * w, 0.05); limb(7, ELR, HAR, 0.1 * w, 0.11 * w, 0.03); hand(8, HAR);
    if (b.vis[21]) setM(M, base + 21, A.x + lY.x * 0.1 + lZ.x * 0.02, A.y + lY.y * 0.1 + lZ.y * 0.02, A.z + lY.z * 0.1 + lZ.z * 0.02, lX, lY, lZ, 0.05, 0.24, 0.12);
    else M.fill(0, (base + 21) * 16, (base + 22) * 16);
    // legs
    const foot = (k, kn, ft) => {
      jv(j, kn, A); jv(j, ft, Bv);
      basisAlong(Bv, A); // lY points up the shin
      setM(M, base + k, Bv.x + lZ.x * 0.07 - lY.x * 0.03, Bv.y + lZ.y * 0.07 - lY.y * 0.03, Bv.z + lZ.z * 0.07 - lY.z * 0.03, lX, lY, lZ, 0.11 * w, 0.08, 0.27);
    };
    limb(9, HPL, KNL, 0.15 * w, 0.17 * w, 0.06); limb(10, KNL, FTL, 0.12 * w, 0.13 * w, 0.02); foot(11, KNL, FTL);
    limb(12, HPR, KNR, 0.15 * w, 0.17 * w, 0.06); limb(13, KNR, FTR, 0.12 * w, 0.13 * w, 0.02); foot(14, KNR, FTR);
    // halo
    if (o.halo) setM(HM, b.slot, H.x + hy.x * 0.33, H.y + hy.y * 0.33, H.z + hy.z * 0.33, hz, hx, hy, 1, 1, 1);
    else if (o.tinHalo) setM(HM, b.slot, N.x - up.x * 0.04 + fw.x * 0.03, N.y - up.y * 0.04 + fw.y * 0.03, N.z - up.z * 0.04 + fw.z * 0.03, fw, ax, up, 0.85, 0.85, 0.85);
  }

  B.update = function (dt) {
    let maxSlot = 0;
    for (const c of list) {
      const b = c.body;
      if (b.slot + 1 > maxSlot) maxSlot = b.slot + 1;
      if (b.rag) {
        const r = b.rag;
        if (!r.sleep) {
          r.acc += dt;
          let n = 0;
          while (r.acc >= STEP && n < 3) { step(c, r); r.acc -= STEP; n++; }
          if (n === 3) r.acc = 0;
          b.j.set(r.p);
          c.x = (r.p[0] + r.p[3]) / 2; c.z = (r.p[2] + r.p[5]) / 2;
          b.written = false;
        }
        if (!b.pooled && (r.sleep || r.t > 1.4)) {
          b.pooled = true;
          const gy = W.groundY(c.x, c.z);
          BL.pool(c.x, gy, c.z, G.R(1.0, 1.6) * (c.bigPool ? 1.4 : 1));
          if (c.headshot) BL.pool(r.p[6], gy, r.p[8], G.R(0.5, 0.8));
        }
        if (b.written) continue;
        if (r.sleep) b.written = true;
      } else if (c.alive && c.hp < c.maxHp * 0.75 && b.visible) {
        b.trailD += Math.hypot(c.x - b.lx, c.z - b.lz);
        if (b.trailD > 1.1) { b.trailD = 0; BL.splat(c.x + G.R(-0.2, 0.2), W.groundY(c.x, c.z) + 0.012, c.z + G.R(-0.2, 0.2), 0, 1, 0, G.R(0.1, 0.22)); }
      } else if (!b.visible && b.written) continue;
      b.lx = c.x; b.lz = c.z;
      writeBody(c);
      if (!b.visible) b.written = true;
    }
    mesh.count = maxSlot * PARTS;
    haloMesh.count = maxSlot;
    mesh.instanceMatrix.needsUpdate = true;
    haloMesh.instanceMatrix.needsUpdate = true;
    BL.update(dt);
  };

  // ---------------------------------------------------------------- blood
  const BL = (G.blood = {});
  let splatMesh, poolMesh, splatI = 0, poolI = 0, dropGeo, dropPos, dropVel, dropLife, mistGeo, mistPos, mistVel, mistLife;
  const SPLATS = 700, POOLS = 140, DROPS = 500, MISTS = 180;
  const growing = [];
  const q1 = new T.Quaternion(), q2 = new T.Quaternion(), mtx = new T.Matrix4(), vpos = new T.Vector3(), vsc = new T.Vector3(), vn = new T.Vector3();
  const ZAX = new T.Vector3(0, 0, 1);

  function splatTexture(pool) {
    const c = document.createElement('canvas'); c.width = c.height = 128;
    const x = c.getContext('2d');
    const blob = (cx, cy, r, n) => { for (let k = 0; k < n; k++) { const a = Math.random() * 6.28, d = Math.random() * r * 0.6; x.beginPath(); x.arc(cx + Math.cos(a) * d, cy + Math.sin(a) * d, r * (0.45 + Math.random() * 0.45), 0, 6.28); x.fill(); } };
    if (pool) {
      x.fillStyle = 'rgba(58,2,6,0.97)';
      blob(64, 64, 46, 14);
      const g = x.createRadialGradient(52, 50, 2, 58, 58, 40);
      g.addColorStop(0, 'rgba(150,30,35,0.4)'); g.addColorStop(1, 'rgba(150,30,35,0)');
      x.globalCompositeOperation = 'source-atop'; x.fillStyle = g; x.fillRect(0, 0, 128, 128);
    } else {
      x.fillStyle = 'rgba(105,4,10,0.95)';
      blob(64, 64, 22, 9);
      for (let k = 0; k < 26; k++) {
        const a = Math.random() * 6.28, d = 24 + Math.random() * 36, r = 1 + Math.random() * 5;
        x.beginPath(); x.arc(64 + Math.cos(a) * d, 64 + Math.sin(a) * d, r, 0, 6.28); x.fill();
      }
      x.strokeStyle = 'rgba(105,4,10,0.9)'; x.lineCap = 'round';
      for (let k = 0; k < 7; k++) {
        const a = Math.random() * 6.28, d = 30 + Math.random() * 28;
        x.lineWidth = 2 + Math.random() * 4;
        x.beginPath(); x.moveTo(64, 64); x.lineTo(64 + Math.cos(a) * d, 64 + Math.sin(a) * d); x.stroke();
      }
    }
    const t = new T.CanvasTexture(c); t.colorSpace = T.SRGBColorSpace;
    return t;
  }
  B.splatCanvas = null;

  function initBlood(scene) {
    const plane = new T.PlaneGeometry(1, 1);
    const mk = (tex, cap) => {
      const m = new T.InstancedMesh(plane, new T.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 }), cap);
      m.instanceMatrix.setUsage(T.DynamicDrawUsage);
      m.setColorAt(0, col.set(0xffffff));
      m.instanceMatrix.array.fill(0);
      m.frustumCulled = false; m.renderOrder = 2;
      scene.add(m);
      return m;
    };
    const st = splatTexture(false);
    B.splatCanvas = st.image;
    splatMesh = mk(st, SPLATS);
    poolMesh = mk(splatTexture(true), POOLS);
    splatMesh.count = 0; poolMesh.count = 0;
    poolMesh.renderOrder = 1;
    const pts = (cap, color, size, opacity) => {
      const pos = new Float32Array(cap * 3);
      for (let k = 0; k < cap; k++) pos[k * 3 + 1] = -50;
      const geo = new T.BufferGeometry(); geo.setAttribute('position', new T.BufferAttribute(pos, 3));
      const p = new T.Points(geo, new T.PointsMaterial({ color, size, map: W.radialTex, transparent: true, opacity, depthWrite: false }));
      p.frustumCulled = false; scene.add(p);
      return { geo, pos, vel: new Float32Array(cap * 3), life: new Float32Array(cap), next: 0 };
    };
    const d = pts(DROPS, 0x8a0610, 0.11, 1);
    dropGeo = d.geo; dropPos = d.pos; dropVel = d.vel; dropLife = d.life;
    const m = pts(MISTS, 0x9a1018, 0.55, 0.55);
    mistGeo = m.geo; mistPos = m.pos; mistVel = m.vel; mistLife = m.life;
  }
  let dropNext = 0, mistNext = 0;
  function addDrop(x, y, z, vx, vy, vz) {
    const i = dropNext; dropNext = (dropNext + 1) % DROPS;
    dropPos[i * 3] = x; dropPos[i * 3 + 1] = y; dropPos[i * 3 + 2] = z;
    dropVel[i * 3] = vx; dropVel[i * 3 + 1] = vy; dropVel[i * 3 + 2] = vz;
    dropLife[i] = 2.5;
  }
  function addMist(x, y, z, vx, vy, vz) {
    const i = mistNext; mistNext = (mistNext + 1) % MISTS;
    mistPos[i * 3] = x; mistPos[i * 3 + 1] = y; mistPos[i * 3 + 2] = z;
    mistVel[i * 3] = vx; mistVel[i * 3 + 1] = vy; mistVel[i * 3 + 2] = vz;
    mistLife[i] = G.R(0.15, 0.35);
  }

  BL.splat = function (x, y, z, nx, ny, nz, size, tone) {
    const i = splatI; splatI = (splatI + 1) % SPLATS;
    vn.set(nx, ny, nz);
    q1.setFromUnitVectors(ZAX, vn);
    q2.setFromAxisAngle(vn, Math.random() * 6.28);
    q2.multiply(q1);
    vpos.set(x + nx * 0.012 + (ny ? 0 : 0), y + (ny ? (i % 12) * 0.0006 : 0), z + nz * 0.012);
    vsc.set(size, size * G.R(0.8, 1.2), 1);
    mtx.compose(vpos, q2, vsc);
    splatMesh.setMatrixAt(i, mtx);
    const t = tone || G.R(0.6, 1);
    splatMesh.setColorAt(i, col.setRGB(t, t * 0.9, t * 0.9));
    splatMesh.instanceMatrix.needsUpdate = true; splatMesh.instanceColor.needsUpdate = true;
    if (splatMesh.count < i + 1) splatMesh.count = i + 1;
  };
  BL.pool = function (x, y, z, target) {
    const i = poolI; poolI = (poolI + 1) % POOLS;
    for (let k = growing.length - 1; k >= 0; k--) if (growing[k].i === i) growing.splice(k, 1);
    growing.push({ i, x, y: y + 0.008 + (i % 8) * 0.0005, z, s: 0.15, target, rot: Math.random() * 6.28 });
    poolMesh.setColorAt(i, col.setRGB(1, 1, 1)); poolMesh.instanceColor.needsUpdate = true;
    if (poolMesh.count < i + 1) poolMesh.count = i + 1;
  };
  // a bullet hit: exit spray along the shot, back spatter, a red mist, and a splash on any wall behind
  BL.spray = function (x, y, z, dx, dz, power, head) {
    power = power || 1;
    const n = Math.round((head ? 30 : 16) * power);
    const a0 = Math.atan2(dx, dz);
    for (let k = 0; k < n; k++) {
      const a = a0 + G.R(-0.45, 0.45), s = G.R(1.5, 6) * power;
      addDrop(x, y, z, Math.sin(a) * s, G.R(-0.6, 2.4), Math.cos(a) * s);
    }
    for (let k = 0; k < 5; k++) {
      const a = a0 + Math.PI + G.R(-0.6, 0.6), s = G.R(0.8, 2.2);
      addDrop(x, y, z, Math.sin(a) * s, G.R(0, 1.5), Math.cos(a) * s);
    }
    const nm = head ? 16 : 8;
    for (let k = 0; k < nm; k++) addMist(x, y, z, dx * G.R(0.5, 2.5) + G.R(-0.7, 0.7), G.R(-0.3, 0.8), dz * G.R(0.5, 2.5) + G.R(-0.7, 0.7));
    const hit = W.rayNormal(x, z, dx, dz, 3.6);
    if (hit) {
      const hy2 = G.clamp(y + G.R(-0.35, 0.4), 0.35, 2.7);
      BL.splat(x + dx * hit.t, hy2, z + dz * hit.t, hit.nx, 0, hit.nz, G.R(0.6, 1.2) * power * (head ? 1.5 : 1));
    }
    const d = G.R(0.4, 1.3), gx = x + dx * d, gz = z + dz * d;
    BL.splat(gx, W.groundY(gx, gz) + 0.012, gz, 0, 1, 0, G.R(0.35, 0.75) * power);
  };

  BL.update = function (dt) {
    let anyD = false;
    for (let i = 0; i < DROPS; i++) {
      if (dropLife[i] <= 0) continue;
      anyD = true;
      const q = i * 3;
      dropLife[i] -= dt;
      dropVel[q + 1] -= 9.8 * dt;
      dropPos[q] += dropVel[q] * dt; dropPos[q + 1] += dropVel[q + 1] * dt; dropPos[q + 2] += dropVel[q + 2] * dt;
      const gy = W.groundY(dropPos[q], dropPos[q + 2]);
      if (dropPos[q + 1] <= gy + 0.02 || dropLife[i] <= 0) {
        if (dropLife[i] > 0 && Math.random() < 0.35) BL.splat(dropPos[q], gy + 0.012, dropPos[q + 2], 0, 1, 0, G.R(0.07, 0.2));
        dropLife[i] = 0; dropPos[q + 1] = -50;
      }
    }
    if (anyD || BL.dDirty) { dropGeo.attributes.position.needsUpdate = true; BL.dDirty = anyD; }
    let anyM = false;
    for (let i = 0; i < MISTS; i++) {
      if (mistLife[i] <= 0) continue;
      anyM = true;
      const q = i * 3;
      mistLife[i] -= dt;
      if (mistLife[i] <= 0) { mistPos[q + 1] = -50; continue; }
      mistPos[q] += mistVel[q] * dt; mistPos[q + 1] += mistVel[q + 1] * dt; mistPos[q + 2] += mistVel[q + 2] * dt;
      mistVel[q] *= 1 - 4 * dt; mistVel[q + 2] *= 1 - 4 * dt;
    }
    if (anyM || BL.mDirty) { mistGeo.attributes.position.needsUpdate = true; BL.mDirty = anyM; }
    if (growing.length) {
      for (let k = growing.length - 1; k >= 0; k--) {
        const g = growing[k];
        g.s = Math.min(g.target, g.s + dt * 0.28 * (1.15 - g.s / g.target));
        vpos.set(g.x, g.y, g.z);
        q1.setFromAxisAngle(vn.set(1, 0, 0), -Math.PI / 2);
        q2.setFromAxisAngle(vn.set(0, 1, 0), g.rot).multiply(q1);
        vsc.set(g.s, g.s * 0.85, 1);
        mtx.compose(vpos, q2, vsc);
        poolMesh.setMatrixAt(g.i, mtx);
        if (g.s >= g.target) growing.splice(k, 1);
      }
      poolMesh.instanceMatrix.needsUpdate = true;
    }
  };
})();
