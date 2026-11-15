'use strict';
// Bodies: people, procedural animation, Verlet ragdolls, and blood.
// Every person is 15 joints. Alive, the joints come from an animated pose (walk cycle, leg and arm
// IK, aim stances, crouch, recoil); dead, they are physics particles held together by bone
// constraints. The body is drawn from rounded parts placed between the joints, all instanced,
// so a crowd costs about a dozen draw calls.
(function () {
  const T = THREE, W = G.world;
  const B = (G.body = {});
  const MAXB = 90, STEP = 1 / 60;
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

  // ---------------------------------------------------------------- part meshes
  // how many instances of each shape one person uses
  const PER = { limb: 9, ball: 21, torso: 1, pelvis: 1, head: 1, skirt: 1, hair: 1, box: 16, barrel: 3, halo: 1 };
  const meshes = {};
  const free = [], list = [];
  B.list = list;
  const col = new T.Color(), BLOODC = new T.Color('#4a0508');

  function lathe(profile, flatten, segs) {
    const g = new T.LatheGeometry(profile.map(([r, y]) => new T.Vector2(r, y)), segs || 16);
    g.scale(1, 1, flatten);
    g.computeVertexNormals();
    return g;
  }
  function headGeo() {
    const g = new T.SphereGeometry(0.5, 18, 14);
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      let x = p.getX(i), y = p.getY(i), z = p.getZ(i);
      if (y < 0) { const k = 1 + y * 0.32; x *= k; z *= 1 + y * 0.12; } // jaw narrows
      if (z < 0) z *= 1.06; // back of the skull
      y *= 1.14;
      p.setXYZ(i, x, y, z);
    }
    g.computeVertexNormals();
    return g;
  }
  B.init = function (scene) {
    const geos = {
      limb: new T.CylinderGeometry(0.42, 0.5, 1, 12, 1, false),
      ball: new T.SphereGeometry(0.5, 12, 9),
      torso: lathe([[0, -0.5], [0.4, -0.5], [0.41, -0.32], [0.39, -0.12], [0.45, 0.12], [0.5, 0.3], [0.47, 0.42], [0.36, 0.49], [0.12, 0.5], [0, 0.5]], 0.6),
      pelvis: lathe([[0, -0.5], [0.34, -0.5], [0.46, -0.2], [0.47, 0.15], [0.42, 0.5], [0, 0.5]], 0.68),
      head: headGeo(),
      skirt: new T.CylinderGeometry(0.47, 0.6, 1, 14, 1, true).scale(1, 1, 0.7),
      hair: new T.SphereGeometry(0.5, 16, 10, 0, Math.PI * 2, 0, Math.PI * 0.58),
      box: new T.BoxGeometry(1, 1, 1),
      barrel: new T.CylinderGeometry(0.5, 0.5, 1, 10),
      halo: new T.TorusGeometry(0.2, 0.024, 6, 24),
    };
    for (const k in PER) {
      const mat = k === 'halo' ? new T.MeshBasicMaterial({ color: 0xffffff })
        : new T.MeshStandardMaterial({ color: 0xffffff, roughness: k === 'barrel' || k === 'box' ? 0.55 : 0.78, metalness: k === 'barrel' ? 0.5 : 0, side: k === 'skirt' || k === 'hair' ? T.DoubleSide : T.FrontSide });
      const m = new T.InstancedMesh(geos[k], mat, PER[k] * MAXB);
      m.instanceMatrix.setUsage(T.DynamicDrawUsage);
      m.setColorAt(0, col.set(0xffffff));
      m.instanceMatrix.array.fill(0);
      m.frustumCulled = false; m.count = 0;
      m.castShadow = k !== 'halo';
      scene.add(m);
      meshes[k] = m;
    }
    for (let k = MAXB - 1; k >= 0; k--) free.push(k);
    initBlood(scene);
  };
  B.hasFree = () => free.length > 0;

  // ---------------------------------------------------------------- creation
  B.create = function (c, o) {
    const slot = free.pop();
    if (slot === undefined) return false;
    c.body = {
      slot, o, h: o.h || G.R(0.94, 1.06), w: o.w || G.R(0.92, 1.12),
      j: new Float32Array(45), jp: new Float32Array(45), rag: null, posed: false,
      bloody: 0, visible: true, written: false, trailD: 0, lx: c.x, lz: c.z, crouch: 0,
    };
    list.push(c);
    if (G.skin && G.skin.ready && (G.MODE === 'range' || c.kind !== 'ped')) G.skin.make(c, o.kind || c.kind);
    B.recolor(c);
    return true;
  };
  function hideAll(slot) {
    for (const k in PER) { const n = PER[k]; meshes[k].instanceMatrix.array.fill(0, slot * n * 16, (slot + 1) * n * 16); meshes[k].instanceMatrix.needsUpdate = true; }
  }
  B.release = function (c) {
    const b = c.body;
    if (!b) return;
    hideAll(b.slot);
    if (b.skin) G.skin.remove(c);
    free.push(b.slot);
    const k = list.indexOf(c);
    if (k >= 0) list.splice(k, 1);
    c.body = null;
  };
  // back on their feet: drop the ragdoll (and, unless soft, the blood) and pose again
  B.revive = function (c, soft) {
    const b = c.body;
    if (!b) return;
    if (!soft) { b.rag = null; b.posed = false; b.bloody = 0; b.pooled = false; c.headshot = false; c.bigPool = false; if (b.skin) G.skin.revive(c); B.recolor(c); }
    b.written = false;
  };
  B.setVisible = function (c, v) { if (c.body) { c.body.visible = v; c.body.written = false; if (c.body.skin) G.skin.setVisible(c, v); } };

  // colours for every part, per person. [mesh, local index, colour key, how much blood soaks it]
  const shade = (hex, k) => { col.set(hex); col.multiplyScalar(k); return '#' + col.getHexString(); };
  function partColors(o) {
    const skin = o.skin, top = o.shirt, legs = o.pants, shoe = o.shoes || '#141414';
    const hairC = o.hood || o.cap || o.hair || null;
    const brow = o.hair ? shade(o.hair, 0.8) : shade(skin, 0.45);
    return [
      ['limb', 0, top, 0.5], ['limb', 1, top, 0.3], ['limb', 2, top, 0.5], ['limb', 3, top, 0.3], // upper arms, forearms
      ['limb', 4, legs, 0.2], ['limb', 5, legs, 0.1], ['limb', 6, legs, 0.2], ['limb', 7, legs, 0.1], // thighs, shins
      ['limb', 8, skin, 0.4], // neck
      ['ball', 0, top, 0.5], ['ball', 1, top, 0.5], ['ball', 2, top, 0.3], ['ball', 3, top, 0.3], // shoulders, elbows
      ['ball', 4, legs, 0.1], ['ball', 5, legs, 0.1], // knees
      ['ball', 6, o.gloves || skin, 0.3], ['ball', 7, o.gloves || skin, 0.3], ['ball', 8, o.gloves || skin, 0.2], ['ball', 9, o.gloves || skin, 0.2], // hands, thumbs
      ['ball', 10, shoe, 0], ['ball', 11, shoe, 0], // shoes
      ['ball', 12, o.mask ? null : '#e8e4dc', 0], ['ball', 13, o.mask ? null : '#e8e4dc', 0], // eye whites
      ['ball', 14, o.mask ? '#020202' : (o.eyes || '#2a1c12'), 0], ['ball', 15, o.mask ? '#020202' : (o.eyes || '#2a1c12'), 0], // irises
      ['ball', 16, o.mask || o.hood ? null : shade(skin, 0.93), 0.2], ['ball', 17, o.mask || o.hood ? null : shade(skin, 0.93), 0.2], // ears
      ['ball', 18, o.mask ? null : shade(skin, 0.96), 0.3], // nose
      ['ball', 19, o.beard ? o.hair : null, 0.3], ['ball', 20, null, 0],
      ['torso', 0, top, 0.75], ['pelvis', 0, o.long ? top : legs, 0.45], ['head', 0, skin, 0.35],
      ['skirt', 0, o.long ? top : null, 0.5], ['hair', 0, hairC, 0.2],
      ['box', 0, o.mask ? null : brow, 0], ['box', 1, o.mask ? null : brow, 0], // brows
      ['box', 2, o.mask ? null : shade(skin, 0.55), 0.3], // mouth
      ['box', 3, o.long ? null : '#1a1410', 0], // belt
      ['box', 4, o.badge ? '#c9a24a' : o.long ? shade(top, 0.75) : null, 0.4], // badge or collar
      ['box', 5, '#0a0a0a', 0], ['box', 6, '#0a0a0a', 0], // soles
      ['box', 7, o.cap || null, 0], // cap brim
      ['box', 8, o.mask ? '#d8d2c4' : null, 0.3], // mask plate
      ['box', 9, '#121214', 0], ['box', 10, '#121214', 0], ['box', 11, '#1a1a1c', 0], ['box', 12, '#3a2a1c', 0], // gun parts
      ['box', 13, o.tie || null, 0.4], ['box', 14, null, 0], ['box', 15, null, 0],
      ['barrel', 0, '#1c1c1e', 0], ['barrel', 1, '#2a2a2c', 0], ['barrel', 2, '#101012', 0],
      ['halo', 0, o.halo ? '#f1e6c4' : o.tinHalo ? '#8c8c88' : null, 0],
    ];
  }
  B.recolor = function (c) {
    const b = c.body, slot = b.slot;
    b.vis = {};
    const SKIN_KEEP = { halo0: 1, box8: 1, box7: 1, box9: 1, box10: 1, box11: 1, box12: 1, barrel0: 1, barrel1: 1, barrel2: 1, hair0: b.o.hood || b.o.cap };
    if (b.skin) G.skin.tintBlood(c);
    for (const [mk, k, hex, soak] of partColors(b.o)) {
      const key = mk + k;
      b.vis[key] = !!hex && (!b.skin || !!SKIN_KEEP[key]);
      if (!hex) continue;
      col.set(hex);
      if (soak && b.bloody > 0) col.lerp(BLOODC, Math.min(1, b.bloody) * soak);
      meshes[mk].setColorAt(slot * PER[mk] + k, col);
      meshes[mk].instanceColor.needsUpdate = true;
    }
    b.written = false;
  };
  B.addBlood = function (c, amt) {
    if (!c.body) return;
    c.body.bloody = Math.min(1, c.body.bloody + amt);
    B.recolor(c);
  };

  // ---------------------------------------------------------------- living pose
  // two-bone IK: from root a toward target c, bone lengths l1/l2, bending toward `pole`
  function ik(ax, ay, az, cx, cy, cz, l1, l2, px, py, pz, out) {
    let dx = cx - ax, dy = cy - ay, dz = cz - az;
    let d = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1e-4;
    const max = (l1 + l2) * 0.999;
    if (d > max) { const k = max / d; dx *= k; dy *= k; dz *= k; d = max; }
    const ux = dx / d, uy = dy / d, uz = dz / d;
    const a = (l1 * l1 - l2 * l2 + d * d) / (2 * d), h = Math.sqrt(Math.max(0, l1 * l1 - a * a));
    const pd = px * ux + py * uy + pz * uz;
    let qx = px - ux * pd, qy = py - uy * pd, qz = pz - uz * pd;
    const ql = Math.sqrt(qx * qx + qy * qy + qz * qz) || 1;
    qx /= ql; qy /= ql; qz /= ql;
    out[0] = ax + ux * a + qx * h; out[1] = ay + uy * a + qy * h; out[2] = az + uz * a + qz * h;
    out[3] = ax + dx; out[4] = ay + dy; out[5] = az + dz;
  }
  const L = new Float32Array(45), tmpK = new Float32Array(6);
  const LONG = { shotgun: 1, smg: 1, rifle: 1 };
  B.pose = function (c, dt, speed, aiming) {
    const b = c.body;
    if (!b || b.rag) return;
    if (b.skin) { G.skin.pose(c, dt, speed, aiming); return; }
    b.lastDt = dt;
    if (b.posed) b.jp.set(b.j);
    c.phase += dt * speed * 2.5;
    const amp = Math.min(1, speed / 4.5), run = Math.min(1, Math.max(0, (speed - 3) / 4));
    b.crouch = G.lerp(b.crouch, c.crouch ? 1 : 0, Math.min(1, dt * 10));
    const cr = b.crouch, ph = c.phase;
    if (c.flinch > 0) c.flinch = Math.max(0, c.flinch - dt * 3);
    if (c.recoil > 0) c.recoil = Math.max(0, c.recoil - dt * 9);
    const bob = Math.abs(Math.cos(ph)) * 0.05 * amp + Math.sin(G.time * 2.1 + c.born) * 0.004;
    const lean = Math.min(0.22, speed * 0.024) + cr * 0.14 - (c.flinch || 0) * 0.35;
    const hipY = 0.93 - cr * 0.36 + bob - amp * 0.02;
    // pelvis, spine, head, shoulders (local: x = left, y = up, z = forward)
    const set = (k, x, y, z) => { L[k * 3] = x; L[k * 3 + 1] = y; L[k * 3 + 2] = z; };
    set(PELVIS, 0, hipY + 0.03, -cr * 0.08);
    const sz = lean * 0.5 - cr * 0.02;
    set(NECK, 0, hipY + 0.52 - cr * 0.02, sz);
    set(HEAD, 0, hipY + 0.73 - cr * 0.02, sz + 0.03 + lean * 0.2);
    set(SHL, 0.2, hipY + 0.49, sz - 0.01);
    set(SHR, -0.2, hipY + 0.49, sz - 0.01);
    // legs: feet follow a stride path, knees by IK (bending forward)
    for (let side = 0; side < 2; side++) {
      const sg = side === 0 ? 1 : -1, p = side === 0 ? ph : ph + Math.PI;
      const stride = 0.28 + run * 0.16;
      let fz = Math.sin(p) * stride * amp + cr * 0.06 * sg;
      let fy = 0.075 + Math.max(0, Math.cos(p)) * (0.1 + run * 0.12) * amp;
      const fx = sg * (0.11 + cr * 0.04);
      if (cr > 0.5 && sg < 0) { fz -= 0.25 * cr; fy += 0.0; } // one knee back when crouched
      const hx = sg * 0.1;
      set(side === 0 ? HPL : HPR, hx, hipY, -cr * 0.06);
      ik(hx, hipY, -cr * 0.06, fx, fy, fz, 0.44, 0.44, 0, 0.1, 1, tmpK);
      set(side === 0 ? KNL : KNR, tmpK[0], tmpK[1], tmpK[2]);
      set(side === 0 ? FTL : FTR, tmpK[3], Math.max(0.07, tmpK[4]), tmpK[5]);
    }
    // arms: hands go to a stance target, elbows by IK
    const shy = hipY + 0.49, rc = (c.recoil || 0);
    let hl, hr, poleL = [0.6, -1, -0.3], poleR = [-0.6, -1, -0.3];
    const weap = c.weaponK;
    if (c.punchT > 0) {
      hr = [-0.08, shy + 0.05, sz + 0.6]; hl = [0.14, shy - 0.08, sz + 0.25];
    } else if (weap && LONG[weap]) {
      if (aiming) { hr = [-0.1, shy - 0.12 + rc * 0.03, sz + 0.24 - rc * 0.06]; hl = [0.02, shy - 0.1 + rc * 0.04, sz + 0.56 - rc * 0.05]; }
      else { hr = [-0.14, shy - 0.36, sz + 0.2]; hl = [0.03, shy - 0.26, sz + 0.46]; }
      poleR = [-1, -0.6, -0.4]; poleL = [0.8, -1, 0];
      if (c.reloading) { hl = [0.0, shy - 0.32, sz + 0.28]; hr = [-0.12, shy - 0.3, sz + 0.26]; }
    } else if (aiming && weap) {
      hr = [-0.04, shy - 0.02 + rc * 0.05, sz + 0.52 - rc * 0.07]; hl = [0.0, shy - 0.05 + rc * 0.04, sz + 0.49 - rc * 0.06];
      if (c.reloading) { hr = [-0.06, shy - 0.25, sz + 0.32]; hl = [0.02, shy - 0.22, sz + 0.3]; }
    } else {
      const panic = c.fleeT > 0 ? 1 : 0;
      const out = [];
      for (let side = 0; side < 2; side++) {
        const sg = side === 0 ? 1 : -1, p = side === 0 ? ph + Math.PI : ph;
        const sw = Math.sin(p) * (0.32 + panic * 0.25) * amp;
        const bend = 0.12 + 0.6 * amp + panic * 0.4;
        out.push([sg * (0.24 - amp * 0.02), shy - 0.52 + bend * 0.12 + Math.abs(sw) * 0.08, sz + sw * 0.55 + bend * 0.08]);
      }
      hl = out[0]; hr = out[1];
    }
    ik(0.2, shy, sz, hl[0], hl[1], hl[2], 0.29, 0.27, poleL[0], poleL[1], poleL[2], tmpK);
    set(ELL, tmpK[0], tmpK[1], tmpK[2]); set(HAL, tmpK[3], tmpK[4], tmpK[5]);
    ik(-0.2, shy, sz, hr[0], hr[1], hr[2], 0.29, 0.27, poleR[0], poleR[1], poleR[2], tmpK);
    set(ELR, tmpK[0], tmpK[1], tmpK[2]); set(HAR, tmpK[3], tmpK[4], tmpK[5]);
    // to world space (body size, facing, ground height)
    const r = c.rot, s = Math.sin(r), co = Math.cos(r), h = b.h, w = b.w, j = b.j;
    const bx = c.x, by = W.groundY(c.x, c.z), bz = c.z;
    for (let k = 0; k < 15; k++) {
      const lx = L[k * 3] * w, ly = L[k * 3 + 1] * h, lz = L[k * 3 + 2] * h;
      j[k * 3] = bx + co * lx + s * lz; j[k * 3 + 1] = by + ly; j[k * 3 + 2] = bz - s * lx + co * lz;
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
    if (b.skin) G.skin.startRag(c);
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
    if (c.body.skin) G.skin.driveRag(c, r.p);
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
  const gX = new T.Vector3(), gY = new T.Vector3(), gZ = new T.Vector3();
  const A = new T.Vector3(), Bv = new T.Vector3(), C = new T.Vector3(), V = new T.Vector3();
  const jv = (j, k, v) => v.set(j[k * 3], j[k * 3 + 1], j[k * 3 + 2]);
  let slotNow = 0, visNow = null;
  function put(mk, k, px, py, pz, X, Y, Z, sx, sy, sz) {
    const arr = meshes[mk].instanceMatrix.array, o = (slotNow * PER[mk] + k) * 16;
    if (!visNow[mk + k]) { arr.fill(0, o, o + 16); return; }
    arr[o] = X.x * sx; arr[o + 1] = X.y * sx; arr[o + 2] = X.z * sx; arr[o + 3] = 0;
    arr[o + 4] = Y.x * sy; arr[o + 5] = Y.y * sy; arr[o + 6] = Y.z * sy; arr[o + 7] = 0;
    arr[o + 8] = Z.x * sz; arr[o + 9] = Z.y * sz; arr[o + 10] = Z.z * sz; arr[o + 11] = 0;
    arr[o + 12] = px; arr[o + 13] = py; arr[o + 14] = pz; arr[o + 15] = 1;
  }
  const hide = (mk, k) => { const o = (slotNow * PER[mk] + k) * 16; meshes[mk].instanceMatrix.array.fill(0, o, o + 16); };
  function basisAlong(a, b, ref) { // lY along a→b, lX from a reference side axis
    lY.subVectors(b, a);
    const len = lY.length() || 1e-4;
    lY.multiplyScalar(1 / len);
    lX.copy(ref).addScaledVector(lY, -ref.dot(lY));
    let l = lX.length();
    if (l < 1e-3) { lX.copy(fw).addScaledVector(lY, -fw.dot(lY)); l = lX.length() || 1; }
    lX.multiplyScalar(1 / l);
    lZ.crossVectors(lX, lY);
    return len;
  }
  // a part in a frame: origin O plus offsets along the frame's axes
  function inFrame(mk, k, O, X, Y, Z, ox, oy, oz, sx, sy, sz) {
    put(mk, k, O.x + X.x * ox + Y.x * oy + Z.x * oz, O.y + X.y * ox + Y.y * oy + Z.y * oz, O.z + X.z * ox + Y.z * oy + Z.z * oz, X, Y, Z, sx, sy, sz);
  }
  function limb(k, ja, jb, j, r0, ext, ballK, ballR) {
    jv(j, ja, A); jv(j, jb, Bv);
    const len = basisAlong(A, Bv, ax);
    C.addVectors(A, Bv).multiplyScalar(0.5);
    put('limb', k, C.x, C.y, C.z, lX, lY, lZ, r0, len + ext, r0 * 0.92);
    if (ballK >= 0) put('ball', ballK, A.x, A.y, A.z, lX, lY, lZ, ballR, ballR, ballR);
  }

  // guns, built in the right hand's frame. gY = barrel direction, gZ = "down" from the gun's view
  function drawGun(weap) {
    const gunParts = ['box9', 'box10', 'box11', 'box12', 'barrel0', 'barrel1', 'barrel2'];
    if (!weap) { for (const p of gunParts) hide(p.replace(/\d+$/, ''), +p.match(/\d+$/)[0]); return; }
    // grip origin = right hand; for long guns aim the barrel at the left hand
    const O = A; // right hand position (already loaded)
    const g = (mk, k, f, u, s, sx, sy, sz) => inFrame(mk, k, O, gX, gY, gZ, s, f, -u, sx, sy, sz);
    const hideP = (mk, k) => hide(mk, k);
    if (weap === 'pistol') {
      g('box', 9, 0.07, 0.07, 0, 0.034, 0.19, 0.045); g('box', 10, 0.0, 0.0, 0, 0.03, 0.055, 0.11);
      hideP('box', 11); hideP('box', 12); hideP('barrel', 0); hideP('barrel', 1); hideP('barrel', 2);
    } else if (weap === 'smg') {
      g('box', 9, 0.09, 0.06, 0, 0.05, 0.3, 0.08); g('box', 10, 0.0, 0.0, 0, 0.032, 0.06, 0.11); g('box', 11, 0.12, -0.05, 0, 0.03, 0.045, 0.16);
      g('box', 12, -0.12, 0.04, 0, 0.035, 0.16, 0.05);
      g('barrel', 0, 0.3, 0.07, 0, 0.032, 0.16, 0.032); hideP('barrel', 1); hideP('barrel', 2);
    } else if (weap === 'shotgun') {
      g('box', 9, 0.06, 0.05, 0, 0.05, 0.22, 0.08); g('box', 10, 0.0, -0.01, 0, 0.032, 0.06, 0.1); hideP('box', 11);
      g('box', 12, -0.22, 0.0, 0, 0.045, 0.3, 0.1);
      g('barrel', 0, 0.44, 0.075, 0, 0.044, 0.58, 0.044); g('barrel', 1, 0.36, 0.03, 0, 0.06, 0.18, 0.06); hideP('barrel', 2);
    } else if (weap === 'rifle') {
      g('box', 9, 0.07, 0.05, 0, 0.05, 0.3, 0.08); g('box', 10, 0.0, -0.01, 0, 0.032, 0.06, 0.1); g('box', 11, 0.08, -0.05, 0, 0.03, 0.05, 0.08);
      g('box', 12, -0.26, 0.0, 0, 0.045, 0.32, 0.11);
      g('barrel', 0, 0.56, 0.065, 0, 0.03, 0.62, 0.03); g('barrel', 1, 0.1, 0.135, 0, 0.05, 0.28, 0.05); g('barrel', 2, 0.42, 0.065, 0, 0.022, 0.06, 0.022);
    }
  }

  function writeBody(c) {
    const b = c.body, j = b.j, o = b.o, w = b.w, h = b.h;
    slotNow = b.slot; visNow = b.vis;
    if (!b.visible) { hideAll(b.slot); return; }
    jv(j, PELVIS, P); jv(j, NECK, N); jv(j, HEAD, H); jv(j, SHL, SL); jv(j, SHR, SR);
    up.subVectors(N, P);
    const tl = up.length() || 1e-4;
    up.multiplyScalar(1 / tl);
    ax.subVectors(SL, SR); ax.addScaledVector(up, -ax.dot(up));
    if (ax.lengthSq() < 1e-6) ax.set(1, 0, 0);
    ax.normalize();
    fw.crossVectors(ax, up);
    // torso, hips, coat tail, belt, collar or badge
    inFrame('torso', 0, P, ax, up, fw, 0, tl * 0.56, 0, 0.45 * w, tl + 0.16, 0.44 * w);
    inFrame('pelvis', 0, P, ax, up, fw, 0, -0.03, -0.005, 0.37 * w, 0.24, 0.37 * w);
    inFrame('skirt', 0, P, ax, up, fw, 0, -0.29 * h, -0.01, 0.47 * w, 0.58 * h, 0.47 * w);
    inFrame('box', 3, P, ax, up, fw, 0, 0.07, 0.0, 0.37 * w, 0.05, 0.26 * w);
    if (o.badge) inFrame('box', 4, P, ax, up, fw, 0.085 * w, tl * 0.82, 0.13 * w, 0.055, 0.06, 0.012);
    else inFrame('box', 4, P, ax, up, fw, 0, tl + 0.04, -0.015, 0.34 * w, 0.1, 0.25 * w);
    inFrame('box', 13, P, ax, up, fw, 0, tl * 0.62, 0.128 * w, 0.045, tl * 0.55, 0.012);
    // neck and head
    hy.subVectors(H, N).normalize();
    hx.copy(ax).addScaledVector(hy, -ax.dot(hy)).normalize();
    hz.crossVectors(hx, hy);
    V.copy(H).addScaledVector(hy, -0.1);
    jv(j, NECK, A);
    { const len = basisAlong(A, V, ax); C.addVectors(A, V).multiplyScalar(0.5); put('limb', 8, C.x, C.y, C.z, lX, lY, lZ, 0.105, len + 0.04, 0.11); }
    inFrame('head', 0, H, hx, hy, hz, 0, 0.0, 0.0, 0.205, 0.235, 0.228);
    // face
    inFrame('ball', 12, H, hx, hy, hz, 0.044, 0.022, 0.098, 0.036, 0.024, 0.02);
    inFrame('ball', 13, H, hx, hy, hz, -0.044, 0.022, 0.098, 0.036, 0.024, 0.02);
    const iz = o.mask ? 0.124 : 0.106;
    inFrame('ball', 14, H, hx, hy, hz, 0.044, 0.021, iz, 0.017, 0.017, 0.012);
    inFrame('ball', 15, H, hx, hy, hz, -0.044, 0.021, iz, 0.017, 0.017, 0.012);
    inFrame('box', 0, H, hx, hy, hz, 0.046, 0.054, 0.104, 0.05, 0.012, 0.014);
    inFrame('box', 1, H, hx, hy, hz, -0.046, 0.054, 0.104, 0.05, 0.012, 0.014);
    inFrame('ball', 18, H, hx, hy, hz, 0, -0.008, 0.112, 0.034, 0.058, 0.042);
    inFrame('box', 2, H, hx, hy, hz, 0, -0.064, 0.098, 0.048, 0.009, 0.012);
    inFrame('ball', 16, H, hx, hy, hz, 0.104, 0.0, -0.004, 0.024, 0.056, 0.04);
    inFrame('ball', 17, H, hx, hy, hz, -0.104, 0.0, -0.004, 0.024, 0.056, 0.04);
    inFrame('ball', 19, H, hx, hy, hz, 0, -0.082, 0.07, 0.135, 0.05, 0.085);
    hide('ball', 20);
    if (o.mask) inFrame('box', 8, H, hx, hy, hz, 0, -0.005, 0.11, 0.17, 0.22, 0.02);
    else hide('box', 8);
    if (o.hood) inFrame('hair', 0, H, hx, hy, hz, 0, -0.03, -0.025, 0.27, 0.36, 0.29);
    else if (o.cap) { inFrame('hair', 0, H, hx, hy, hz, 0, 0.055, -0.005, 0.226, 0.22, 0.24); inFrame('box', 7, H, hx, hy, hz, 0, 0.078, 0.13, 0.19, 0.016, 0.1); }
    else inFrame('hair', 0, H, hx, hy, hz, 0, 0.02, -0.012, 0.222, 0.27, 0.246);
    if (!o.cap) hide('box', 7);
    // arms
    limb(0, SHL, ELL, j, 0.118 * w, 0.03, 0, 0.13 * w);
    limb(1, ELL, HAL, j, 0.098 * w, 0.02, 2, 0.1 * w);
    jv(j, HAL, A);
    inFrame('ball', 6, A, lX, lY, lZ, 0, 0.055, 0.005, 0.07, 0.11, 0.045);
    inFrame('ball', 8, A, lX, lY, lZ, -0.03, 0.03, 0.025, 0.028, 0.055, 0.028);
    limb(2, SHR, ELR, j, 0.118 * w, 0.03, 1, 0.13 * w);
    limb(3, ELR, HAR, j, 0.098 * w, 0.02, 3, 0.1 * w);
    jv(j, HAR, A);
    inFrame('ball', 7, A, lX, lY, lZ, 0, 0.055, 0.005, 0.07, 0.11, 0.045);
    inFrame('ball', 9, A, lX, lY, lZ, 0.03, 0.03, 0.025, 0.028, 0.055, 0.028);
    // the gun: barrel toward the left hand for long guns (when the hands are apart), else along the forearm
    const weap = c.weaponK;
    if (weap) {
      jv(j, HAR, A); jv(j, HAL, Bv);
      const longGun = weap !== 'pistol';
      if (longGun && A.distanceTo(Bv) > 0.12) gY.subVectors(Bv, A).normalize();
      else { jv(j, ELR, C); gY.subVectors(A, C).normalize(); if (!c.alive || weap === 'pistol') { /* along forearm */ } }
      gX.copy(ax).addScaledVector(gY, -ax.dot(gY));
      if (gX.lengthSq() < 1e-6) gX.copy(fw);
      gX.normalize();
      gZ.crossVectors(gX, gY);
      visNow.box9 = visNow.box10 = visNow.box11 = visNow.box12 = visNow.barrel0 = visNow.barrel1 = visNow.barrel2 = true;
      drawGun(weap);
    } else drawGun(null);
    // legs
    limb(4, HPL, KNL, j, 0.165 * w, 0.06, -1, 0);
    limb(5, KNL, FTL, j, 0.125 * w, 0.02, 4, 0.13 * w);
    limb(6, HPR, KNR, j, 0.165 * w, 0.06, -1, 0);
    limb(7, KNR, FTR, j, 0.125 * w, 0.02, 5, 0.13 * w);
    for (const [kn, ft, shoe, sole] of [[KNL, FTL, 10, 5], [KNR, FTR, 11, 6]]) {
      jv(j, kn, A); jv(j, ft, Bv);
      basisAlong(Bv, A, ax); // lY up the shin
      inFrame('ball', shoe, Bv, lX, lY, lZ, 0, -0.025, 0.06, 0.12 * w, 0.1, 0.29);
      inFrame('box', sole, Bv, lX, lY, lZ, 0, -0.07, 0.06, 0.115 * w, 0.025, 0.28);
    }
    // halo
    if (o.halo) inFrame('halo', 0, H, hz, hx, hy, 0, 0, 0.33, 1, 1, 1);
    else if (o.tinHalo) inFrame('halo', 0, N, fw, ax, up, 0.03, 0, -0.04, 0.85, 0.85, 0.85);
    else hide('halo', 0);
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
          if (b.skin) G.skin.driveRag(c, r.p);
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
    for (const k in PER) {
      meshes[k].count = maxSlot * PER[k];
      meshes[k].instanceMatrix.needsUpdate = true;
    }
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
