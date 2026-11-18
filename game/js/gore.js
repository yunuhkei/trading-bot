'use strict';
// Gore: dismemberment, head bursts, gibs, bleeding stumps.
// A limb comes off when a hit is strong enough (close shotgun, rifle, explosion, a fast car).
// On rigged characters the severed piece is the model's real arm/leg/head: a copy of the model
// with everything except that limb collapsed, flying under its own physics.
(function () {
  const T = THREE, W = G.world, J = G.body.J;
  const GO = (G.gore = {});
  GO.on = G.store.get('gore', true);
  GO.setOn = (v) => { GO.on = v; G.store.set('gore', v); };

  // each limb: the joint it comes off at, the joint at its far end, the hitbox joints it takes along
  const LIMBS = {
    head: { from: J.NECK, to: J.HEAD, color: 'skin' },
    larm: { from: J.SHL, to: J.ELL, end: J.HAL, color: 'shirt' }, lfore: { from: J.ELL, to: J.HAL, color: 'shirt' },
    rarm: { from: J.SHR, to: J.ELR, end: J.HAR, color: 'shirt' }, rfore: { from: J.ELR, to: J.HAR, color: 'shirt' },
    lup: { from: J.HPL, to: J.KNL, end: J.FTL, color: 'pants' }, lleg: { from: J.KNL, to: J.FTL, color: 'pants' },
    rup: { from: J.HPR, to: J.KNR, end: J.FTR, color: 'pants' }, rleg: { from: J.KNR, to: J.FTR, color: 'pants' },
  };
  const PARENT = { lfore: 'larm', rfore: 'rarm', lleg: 'lup', rleg: 'rup' };
  GO.isOff = (c, key) => !!(c.body && c.body.severed && key && (c.body.severed[key] || c.body.severed[PARENT[key]]));

  // parts of the procedural (non-rigged) body that go with each limb
  const PARTS = {
    head: ['head0', 'hair0', 'box0', 'box1', 'box2', 'box7', 'box8', 'ball12', 'ball13', 'ball14', 'ball15', 'ball16', 'ball17', 'ball18', 'ball19', 'halo0', 'limb8'],
    larm: ['limb0', 'limb1', 'ball2', 'ball6', 'ball8'], lfore: ['limb1', 'ball6', 'ball8'],
    rarm: ['limb2', 'limb3', 'ball3', 'ball7', 'ball9', 'box9', 'box10', 'box11', 'box12', 'barrel0', 'barrel1', 'barrel2'],
    rfore: ['limb3', 'ball7', 'ball9', 'box9', 'box10', 'box11', 'box12', 'barrel0', 'barrel1', 'barrel2'],
    lup: ['limb4', 'limb5', 'ball4', 'ball10', 'box5'], lleg: ['limb5', 'ball10', 'box5'],
    rup: ['limb6', 'limb7', 'ball5', 'ball11', 'box6'], rleg: ['limb7', 'ball11', 'box6'],
  };
  const SKIN_HEAD_PARTS = ['halo0', 'box8', 'hair0', 'box7'];
  const GUN_PARTS = ['box9', 'box10', 'box11', 'box12', 'barrel0', 'barrel1', 'barrel2'];
  // called after body.js works out which parts are visible: severed ones stay hidden
  GO.applyVis = function (c) {
    const b = c.body;
    if (!b.severed) return;
    for (const k in b.severed) {
      const list = b.skin ? (k === 'head' ? SKIN_HEAD_PARTS : k === 'rarm' || k === 'rfore' ? GUN_PARTS : []) : PARTS[k];
      for (const p of list) b.vis[p] = false;
    }
  };

  // ---------------------------------------------------------------- pieces in flight
  const gibs = [];
  let chunkMesh, chunks;
  GO.init = function (scene) {
    chunkMesh = new T.InstancedMesh(new T.IcosahedronGeometry(0.05, 0), new T.MeshStandardMaterial({ color: 0xffffff, roughness: 0.35 }), 160);
    chunkMesh.instanceMatrix.setUsage(T.DynamicDrawUsage); chunkMesh.instanceMatrix.array.fill(0);
    chunkMesh.setColorAt(0, new T.Color(0xffffff));
    chunkMesh.frustumCulled = false; chunkMesh.castShadow = true;
    scene.add(chunkMesh);
    chunks = { n: 160, next: 0, p: new Float32Array(480), v: new Float32Array(480), r: new Float32Array(480), s: new Float32Array(160), life: new Float32Array(160), rest: new Uint8Array(160) };
  };
  const CHUNK_COLORS = [0x6a0a10, 0x8a1a1a, 0x4a0408, 0xb04a4a, 0xd8c8b0, 0x5a1010].map((h) => new T.Color(h));
  function spawnChunks(x, y, z, dx, dz, n, force) {
    for (let k = 0; k < n; k++) {
      const i = chunks.next; chunks.next = (chunks.next + 1) % chunks.n;
      chunks.p[i * 3] = x; chunks.p[i * 3 + 1] = y; chunks.p[i * 3 + 2] = z;
      const sp = G.R(1.5, 6) * force;
      chunks.v[i * 3] = dx * sp + G.R(-2.5, 2.5); chunks.v[i * 3 + 1] = G.R(1, 5); chunks.v[i * 3 + 2] = dz * sp + G.R(-2.5, 2.5);
      chunks.r[i * 3] = Math.random() * 6; chunks.r[i * 3 + 1] = Math.random() * 6; chunks.r[i * 3 + 2] = Math.random() * 6;
      chunks.s[i] = G.R(0.6, 1.8); chunks.life[i] = 30; chunks.rest[i] = 0;
      chunkMesh.setColorAt(i, G.pick(CHUNK_COLORS));
    }
    chunkMesh.instanceColor.needsUpdate = true;
  }

  // a capsule-shaped limb for bodies that aren't rigged
  const capGeo = new T.CylinderGeometry(0.06, 0.07, 1, 10), endGeo = new T.SphereGeometry(0.075, 10, 8);
  const meatMat = new T.MeshStandardMaterial({ color: 0x7a0a10, roughness: 0.3 });
  function capsuleGib(c, key, len) {
    const o = c.body.o, g = new T.Group();
    const col = key === 'head' ? o.skin : LIMBS[key].color === 'shirt' ? o.shirt : o.pants;
    const mat = new T.MeshStandardMaterial({ color: col, roughness: 0.75 });
    if (key === 'head') {
      const h = new T.Mesh(new T.SphereGeometry(0.12, 14, 10), mat); h.scale.set(1, 1.15, 1.05); h.position.y = 0.12; g.add(h);
      if (o.hair || o.hood || o.cap) { const hr = new T.Mesh(new T.SphereGeometry(0.125, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.55), new T.MeshStandardMaterial({ color: o.hood || o.cap || o.hair, roughness: 0.8 })); hr.position.y = 0.14; g.add(hr); }
    } else {
      const m = new T.Mesh(capGeo, mat); m.scale.set(1, len, 1); m.position.y = len / 2; g.add(m);
    }
    const stump = new T.Mesh(endGeo, meatMat); g.add(stump);
    g.traverse((x) => { if (x.isMesh) x.castShadow = true; });
    G.scene.add(g);
    return { obj: g, mats: [mat] };
  }

  // ---------------------------------------------------------------- cutting
  const v1 = new T.Vector3(), v2 = new T.Vector3(), qx = new T.Quaternion(), qy = new T.Quaternion();
  const jp = (c, k) => { const j = c.body.j; return new T.Vector3(j[k * 3], j[k * 3 + 1], j[k * 3 + 2]); };
  GO.sever = function (c, key, dx, dz, power) {
    if (!GO.on || !c.body || GO.isOff(c, key)) return false;
    const b = c.body, L = LIMBS[key];
    if (!b.rag) G.body.startRag(c);
    b.severed = b.severed || {};
    const from = jp(c, L.from), to = jp(c, L.to);
    const dir = v1.subVectors(to, from).normalize().clone();
    // the flying piece
    let gib;
    if (b.skin) gib = G.skin.gib(c, key);
    else {
      const len = from.distanceTo(L.end !== undefined ? jp(c, L.end) : to) + 0.05;
      gib = capsuleGib(c, key, len);
      // point the capsule along the limb
      gib.obj.position.copy(from);
      gib.obj.quaternion.setFromUnitVectors(new T.Vector3(0, 1, 0), dir);
    }
    b.severed[key] = true;
    if (b.skin) G.skin.cut(c, key);
    G.body.recolor(c);
    const p = b.skin ? gib.bone.getWorldPosition(new T.Vector3()) : from.clone();
    const q = b.skin ? gib.bone.getWorldQuaternion(new T.Quaternion()) : gib.obj.quaternion.clone();
    const sp = power * G.R(0.6, 1.1);
    if (b.skin) { const hp = gib.hips.parent; gib.hips.position.copy(hp.worldToLocal(gib.bone.getWorldPosition(new T.Vector3()))); gib.root.updateMatrixWorld(true); }
    gibs.push({
      gib, skin: !!b.skin, p, q,
      v: new T.Vector3(dx * sp + dir.x * 2 + G.R(-1, 1), G.R(2, 4.5), dz * sp + dir.z * 2 + G.R(-1, 1)),
      w: new T.Vector3(G.R(-12, 12), G.R(-12, 12), G.R(-12, 12)),
      t: 0, sleep: false, landed: false, dripT: 0,
    });
    while (gibs.length > 14) removeGib(gibs.shift());
    // the wound
    G.blood.spray(from.x, from.y, from.z, dx, dz, 1.5, key === 'head');
    G.blood.spray(from.x, from.y, from.z, -dir.x, -dir.z, 0.8, false);
    G.body.addBlood(c, 0.35);
    stumps.push({ c, from: L.from, to: L.to, t: G.R(3.5, 5.5), acc: 0 });
    G.audio.splat(Math.max(0.15, 1 - Math.hypot(from.x - G.camera.position.x, from.z - G.camera.position.z) / 30));
    return true;
  };
  // the head comes apart instead of coming off
  GO.burstHead = function (c, dx, dz) {
    if (!GO.on || !c.body || GO.isOff(c, 'head')) return false;
    const b = c.body;
    if (!b.rag) G.body.startRag(c);
    b.severed = b.severed || {};
    const h = jp(c, J.HEAD), n = jp(c, J.NECK);
    b.severed.head = true;
    if (b.skin) G.skin.cut(c, 'head');
    G.body.recolor(c);
    spawnChunks(h.x, h.y, h.z, dx, dz, 26, 1);
    for (let k = 0; k < 3; k++) G.blood.spray(h.x, h.y, h.z, dx + G.R(-0.3, 0.3), dz + G.R(-0.3, 0.3), 2.2, true);
    for (let k = 0; k < 6; k++) {
      const a = Math.random() * 6.28, r = G.R(0.6, 2.4), x = h.x + dx * r + Math.cos(a) * 0.6, z = h.z + dz * r + Math.sin(a) * 0.6;
      G.blood.splat(x, W.groundY(x, z) + 0.012, z, 0, 1, 0, G.R(0.3, 0.8));
    }
    G.body.addBlood(c, 0.5);
    c.headshot = true; c.bigPool = true;
    stumps.push({ c, from: J.NECK, to: J.HEAD, t: G.R(4, 6), acc: 0 });
    G.audio.splat(Math.max(0.2, 1 - Math.hypot(n.x - G.camera.position.x, n.z - G.camera.position.z) / 30) * 1.3);
    return true;
  };
  // a point-blank blast to the body: no limb, just a lot of mess
  GO.gutShot = function (c, x, y, z, dx, dz) {
    if (!GO.on) return;
    spawnChunks(x, y, z, dx, dz, 10, 0.7);
    G.blood.spray(x, y, z, dx, dz, 2, false);
    G.body.addBlood(c, 0.4);
    c.bigPool = true;
  };
  function removeGib(g) {
    G.scene.remove(g.skin ? g.gib.root : g.gib.obj);
    for (const m of g.gib.mats) m.dispose();
  }

  // ---------------------------------------------------------------- when to cut
  const LIMB_KEYS = ['larm', 'rarm', 'lfore', 'rfore', 'lup', 'rup', 'lleg', 'rleg'];
  // a weapon hit that killed (or landed on a corpse): bones = { boneKey: pellets that hit it }
  function severing(weap, key, n, dist) {
    if (key === 'torso') return false;
    if (weap === 'shotgun') return n >= 3 && dist <= 9;
    if (weap === 'rifle') return true;
    return false;
  }
  GO.onBulletHit = function (c, weap, bones, dist, dx, dz, x, y, z) {
    if (!GO.on || !c.body) return;
    if (c.alive) {
      // a hit hard enough to take a limb off is a fatal one
      let fatal = false;
      for (const key in bones) if (severing(weap, key, bones[key], dist)) fatal = true;
      if (!fatal) return;
      G.damageChar(c, 9999, x - dx * 2, z - dz * 2, true, { kind: 'bullet', dx, dz, power: 6, joint: G.body.J.NECK });
      if (c.alive) return;
    }
    for (const key in bones) {
      const n = bones[key];
      if (key === 'torso') { if (weap === 'shotgun' && n >= 5 && dist < 4) GO.gutShot(c, x, y, z, dx, dz); continue; }
      if (weap === 'shotgun') {
        if (n < 3 || dist > 9) continue;
        if (key === 'head') { if (dist < 6) GO.burstHead(c, dx, dz); else GO.sever(c, 'head', dx, dz, 5); }
        else GO.sever(c, key, dx, dz, 6);
      } else if (weap === 'rifle') {
        if (key === 'head') { if (Math.random() < 0.55) GO.burstHead(c, dx, dz); else GO.sever(c, 'head', dx, dz, 6); }
        else GO.sever(c, key, dx, dz, 5);
      } else if ((weap === 'smg' || weap === 'pistol') && key === 'head' && dist < 3 && Math.random() < 0.25) {
        GO.burstHead(c, dx, dz);
      }
    }
  };
  // explosions take people apart
  GO.blast = function (c, dx, dz, dist) {
    if (!GO.on || !c.body || dist > 5) return;
    const n = dist < 2.5 ? 3 : dist < 4 ? 2 : 1;
    const keys = LIMB_KEYS.slice().sort(() => Math.random() - 0.5);
    for (let k = 0; k < n; k++) GO.sever(c, keys[k], dx + G.R(-0.5, 0.5), dz + G.R(-0.5, 0.5), 9);
    if (dist < 2.5 && Math.random() < 0.4) GO.burstHead(c, dx, dz);
    spawnChunks(c.x, 1, c.z, dx, dz, 8, 1.2);
  };
  // hit by a car going very fast
  GO.runOver = function (c, vx, vz) {
    const sp = Math.hypot(vx, vz);
    if (!GO.on || sp < 18 || Math.random() > 0.5) return;
    GO.sever(c, G.pick(LIMB_KEYS), vx / sp, vz / sp, sp * 0.5);
  };

  // ---------------------------------------------------------------- per frame
  const stumps = [];
  const tmpP = { x: 0, z: 0 }, e3 = new T.Euler(), mtx = new T.Matrix4(), vp = new T.Vector3(), vs = new T.Vector3(), qq = new T.Quaternion();
  GO.update = function (dt) {
    // flying pieces
    for (const g of gibs) {
      if (g.sleep) continue;
      g.t += dt;
      g.v.y -= 9.8 * dt;
      g.p.addScaledVector(g.v, dt);
      const wl = g.w.length();
      if (wl > 1e-3) { qx.setFromAxisAngle(v2.copy(g.w).divideScalar(wl), wl * dt); g.q.premultiply(qx); }
      tmpP.x = g.p.x; tmpP.z = g.p.z;
      if (W.collide(tmpP, 0.1)) { g.p.x = tmpP.x; g.p.z = tmpP.z; g.v.x *= -0.3; g.v.z *= -0.3; }
      const gy = W.groundY(g.p.x, g.p.z) + 0.07;
      if (g.p.y < gy) {
        g.p.y = gy;
        if (!g.landed || Math.abs(g.v.y) > 2) {
          G.blood.splat(g.p.x, gy - 0.058, g.p.z, 0, 1, 0, G.R(0.25, 0.55));
          if (!g.landed) G.audio.thud(Math.max(0, 0.5 - Math.hypot(g.p.x - G.camera.position.x, g.p.z - G.camera.position.z) / 40));
          g.landed = true;
        }
        g.v.y *= -0.28; g.v.x *= 0.55; g.v.z *= 0.55; g.w.multiplyScalar(0.55);
        if (Math.abs(g.v.y) < 0.5 && Math.hypot(g.v.x, g.v.z) < 0.3) { g.sleep = true; G.blood.pool(g.p.x, gy - 0.07, g.p.z, G.R(0.35, 0.6)); }
      }
      // drips from the cut end while it flies
      g.dripT -= dt;
      if (g.dripT <= 0 && g.t < 2.5) { g.dripT = 0.05; G.blood.drop(g.p.x, g.p.y, g.p.z, G.R(-0.5, 0.5), G.R(-0.5, 0.5), G.R(-0.5, 0.5)); }
      if (g.skin) {
        const root = g.gib.root, bone = g.gib.bone;
        bone.position.copy(root.worldToLocal(vp.copy(g.p)));
        root.getWorldQuaternion(qq);
        bone.quaternion.copy(qq.invert().multiply(g.q));
        // the rest of this copy is collapsed to nothing; keep it at the cut so the skin closes there
        // instead of stretching back to where the body was
        root.updateMatrixWorld(true);
        const hp = g.gib.hips.parent;
        g.gib.hips.position.copy(hp.worldToLocal(vp.copy(g.p)));
        g.gib.hips.updateMatrixWorld(true);
      } else { g.gib.obj.position.copy(g.p); g.gib.obj.quaternion.copy(g.q); }
    }
    // bleeding stumps
    for (let k = stumps.length - 1; k >= 0; k--) {
      const s = stumps[k];
      s.t -= dt;
      if (s.t <= 0 || !s.c.body) { stumps.splice(k, 1); continue; }
      s.acc += dt;
      const rate = 0.04 + (1 - Math.min(1, s.t / 5)) * 0.08;
      while (s.acc > rate) {
        s.acc -= rate;
        const j = s.c.body.j;
        let ux = j[s.to * 3] - j[s.from * 3], uy = j[s.to * 3 + 1] - j[s.from * 3 + 1], uz = j[s.to * 3 + 2] - j[s.from * 3 + 2];
        const l = Math.hypot(ux, uy, uz) || 1; ux /= l; uy /= l; uz /= l;
        // pulses: the heart is still going for a moment
        const pulse = 0.5 + 0.5 * Math.max(0, Math.sin(G.time * 8));
        const f = Math.min(1, s.t / 3) * (1.2 + pulse * 2.2);
        G.blood.drop(j[s.from * 3], j[s.from * 3 + 1], j[s.from * 3 + 2], ux * f + G.R(-0.3, 0.3), uy * f + G.R(0, 0.8), uz * f + G.R(-0.3, 0.3));
      }
    }
    // meat
    let any = false;
    for (let i = 0; i < chunks.n; i++) {
      if (chunks.life[i] <= 0) continue;
      any = true;
      chunks.life[i] -= dt;
      const o = i * 3;
      if (!chunks.rest[i]) {
        chunks.v[o + 1] -= 9.8 * dt;
        chunks.p[o] += chunks.v[o] * dt; chunks.p[o + 1] += chunks.v[o + 1] * dt; chunks.p[o + 2] += chunks.v[o + 2] * dt;
        chunks.r[o] += dt * 9; chunks.r[o + 1] += dt * 7;
        const gy = W.groundY(chunks.p[o], chunks.p[o + 2]) + 0.03;
        if (chunks.p[o + 1] < gy) {
          chunks.p[o + 1] = gy; chunks.v[o + 1] *= -0.25; chunks.v[o] *= 0.4; chunks.v[o + 2] *= 0.4;
          if (Math.abs(chunks.v[o + 1]) < 0.4) { chunks.rest[i] = 1; if (Math.random() < 0.5) G.blood.splat(chunks.p[o], gy - 0.018, chunks.p[o + 2], 0, 1, 0, G.R(0.1, 0.25)); }
        }
      }
      const sc = chunks.s[i] * Math.min(1, chunks.life[i] / 3);
      mtx.compose(vp.set(chunks.p[o], chunks.p[o + 1], chunks.p[o + 2]), qq.setFromEuler(e3.set(chunks.r[o], chunks.r[o + 1], chunks.r[o + 2])), vs.set(sc, sc * 0.8, sc));
      chunkMesh.setMatrixAt(i, mtx);
    }
    if (any || chunks.dirty) { chunkMesh.instanceMatrix.needsUpdate = true; chunks.dirty = any; }
  };
  GO.clear = function () {
    while (gibs.length) removeGib(gibs.pop());
    stumps.length = 0;
    chunks.life.fill(0); chunkMesh.instanceMatrix.array.fill(0); chunkMesh.instanceMatrix.needsUpdate = true;
  };
})();
