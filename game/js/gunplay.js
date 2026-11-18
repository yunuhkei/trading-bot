'use strict';
// Gunplay: real 3D bullets. Every shot is a ray tested against cover (with height) and against
// each person's head, torso, arms and legs. Plus muzzle flash, shell casings, bullet holes,
// dust, hit markers, and enemy fire that cover actually stops.
(function () {
  const T = THREE, W = G.world;
  const GP = (G.gun = {});
  const J = G.body.J;
  // [part, joint A, joint B, radius, damage multiplier, joint to push]
  const HITBOX = [
    ['head', J.HEAD, J.HEAD, 0.135, 3.5, J.HEAD, 'head'],
    ['torso', J.PELVIS, J.NECK, 0.2, 1, J.NECK, 'torso'],
    ['arm', J.SHL, J.ELL, 0.075, 0.55, J.ELL, 'larm'], ['arm', J.ELL, J.HAL, 0.065, 0.5, J.HAL, 'lfore'],
    ['arm', J.SHR, J.ELR, 0.075, 0.55, J.ELR, 'rarm'], ['arm', J.ELR, J.HAR, 0.065, 0.5, J.HAR, 'rfore'],
    ['leg', J.HPL, J.KNL, 0.1, 0.65, J.KNL, 'lup'], ['leg', J.KNL, J.FTL, 0.075, 0.6, J.KNL, 'lleg'],
    ['leg', J.HPR, J.KNR, 0.1, 0.65, J.KNR, 'rup'], ['leg', J.KNR, J.FTR, 0.075, 0.6, J.KNR, 'rleg'],
  ];

  // closest hit of a ray (o + d·t, |d| = 1) on anyone's body, alive or dead
  GP.rayBodies = function (ox, oy, oz, dx, dy, dz, maxT, exclude) {
    let best = null, bt = maxT;
    for (const c of G.body.list) {
      if (c === exclude || !c.body || !c.body.visible) continue;
      const j = c.body.j;
      // broad phase: skip anyone nowhere near the line
      const px = j[0] - ox, py = j[1] - oy, pz = j[2] - oz, along = px * dx + py * dy + pz * dz;
      if (along < -1.5 || along > bt + 1.5) continue;
      const qx = px - dx * along, qy = py - dy * along, qz = pz - dz * along;
      if (qx * qx + qy * qy + qz * qz > 4.5) continue;
      for (const hb of HITBOX) {
        if (c.body.severed && G.gore.isOff(c, hb[6])) continue; // that part isn't there any more
        const a = hb[1] * 3, b = hb[2] * 3, r = hb[3];
        const ux = j[b] - j[a], uy = j[b + 1] - j[a + 1], uz = j[b + 2] - j[a + 2];
        const wx = ox - j[a], wy = oy - j[a + 1], wz = oz - j[a + 2];
        const B = dx * ux + dy * uy + dz * uz, Cc = ux * ux + uy * uy + uz * uz;
        const D = dx * wx + dy * wy + dz * wz, E = ux * wx + uy * wy + uz * wz;
        const den = Cc - B * B;
        let tc = Cc < 1e-8 ? 0 : den < 1e-8 ? 0 : (E - B * D) / den;
        tc = tc < 0 ? 0 : tc > 1 ? 1 : tc;
        const sc = B * tc - D;
        if (sc < 0 || sc > bt) continue;
        const ex = ox + dx * sc - (j[a] + ux * tc), ey = oy + dy * sc - (j[a + 1] + uy * tc), ez = oz + dz * sc - (j[a + 2] + uz * tc);
        const d2 = ex * ex + ey * ey + ez * ez;
        if (d2 > r * r) continue;
        const t = sc - Math.sqrt(r * r - d2);
        if (t < bt) { bt = Math.max(0, t); best = { c, t: bt, part: hb[0], mult: hb[4], joint: hb[5], bone: hb[6] }; }
      }
    }
    return best;
  };

  // where a gun's barrel ends, from the shooter's hands
  GP.muzzle = function (c, k) {
    const j = c.body.j;
    const hr = J.HAR * 3, hl = J.HAL * 3, er = J.ELR * 3;
    let dx, dy, dz;
    if (k !== 'pistol' && Math.hypot(j[hl] - j[hr], j[hl + 1] - j[hr + 1], j[hl + 2] - j[hr + 2]) > 0.12) { dx = j[hl] - j[hr]; dy = j[hl + 1] - j[hr + 1]; dz = j[hl + 2] - j[hr + 2]; }
    else { dx = j[hr] - j[er]; dy = j[hr + 1] - j[er + 1]; dz = j[hr + 2] - j[er + 2]; }
    const l = Math.hypot(dx, dy, dz) || 1, len = { pistol: 0.2, smg: 0.4, shotgun: 0.74, rifle: 0.88 }[k] || 0.3;
    return { x: j[hr] + (dx / l) * len, y: j[hr + 1] + (dy / l) * len + 0.07, z: j[hr + 2] + (dz / l) * len, dx: dx / l, dy: dy / l, dz: dz / l };
  };

  // ---------------------------------------------------------------- effects
  let flash, casings, holes, dust;
  GP.init = function (scene) {
    // muzzle flash: a star-shaped glow
    const fc = document.createElement('canvas'); fc.width = fc.height = 64;
    const x = fc.getContext('2d');
    const g = x.createRadialGradient(32, 32, 0, 32, 32, 30);
    g.addColorStop(0, 'rgba(255,250,220,1)'); g.addColorStop(0.25, 'rgba(255,200,90,0.9)'); g.addColorStop(1, 'rgba(255,120,20,0)');
    x.fillStyle = g;
    for (let k = 0; k < 5; k++) { x.save(); x.translate(32, 32); x.rotate((k / 5) * Math.PI * 2); x.beginPath(); x.moveTo(0, -4); x.lineTo(30, 0); x.lineTo(0, 4); x.closePath(); x.fill(); x.restore(); }
    x.beginPath(); x.arc(32, 32, 12, 0, 6.3); x.fill();
    flash = new T.Sprite(new T.SpriteMaterial({ map: new T.CanvasTexture(fc), blending: T.AdditiveBlending, depthWrite: false, transparent: true }));
    flash.visible = false; flash.scale.set(0.5, 0.5, 1);
    scene.add(flash);
    flash.userData.t = 0;
    // brass
    const cm = new T.InstancedMesh(new T.CylinderGeometry(0.0065, 0.0065, 0.03, 6), new T.MeshStandardMaterial({ color: 0xc8a040, metalness: 0.85, roughness: 0.35 }), 90);
    cm.instanceMatrix.setUsage(T.DynamicDrawUsage); cm.instanceMatrix.array.fill(0); cm.frustumCulled = false;
    scene.add(cm);
    casings = { mesh: cm, n: 90, next: 0, p: new Float32Array(270), v: new Float32Array(270), r: new Float32Array(270), life: new Float32Array(90), hit: new Uint8Array(90) };
    // bullet holes
    const hc = document.createElement('canvas'); hc.width = hc.height = 64;
    const y = hc.getContext('2d');
    const hg = y.createRadialGradient(32, 32, 2, 32, 32, 30);
    hg.addColorStop(0, 'rgba(5,5,5,1)'); hg.addColorStop(0.22, 'rgba(15,14,12,0.95)'); hg.addColorStop(0.4, 'rgba(60,56,50,0.55)'); hg.addColorStop(1, 'rgba(60,56,50,0)');
    y.fillStyle = hg; y.fillRect(0, 0, 64, 64);
    y.strokeStyle = 'rgba(20,20,20,0.6)'; y.lineWidth = 1.5;
    for (let k = 0; k < 6; k++) { const a = Math.random() * 6.3; y.beginPath(); y.moveTo(32 + Math.cos(a) * 8, 32 + Math.sin(a) * 8); y.lineTo(32 + Math.cos(a) * (16 + Math.random() * 12), 32 + Math.sin(a) * (16 + Math.random() * 12)); y.stroke(); }
    const ht = new T.CanvasTexture(hc); ht.colorSpace = T.SRGBColorSpace;
    const hm = new T.InstancedMesh(new T.PlaneGeometry(1, 1), new T.MeshBasicMaterial({ map: ht, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 }), 240);
    hm.instanceMatrix.setUsage(T.DynamicDrawUsage); hm.instanceMatrix.array.fill(0); hm.frustumCulled = false; hm.count = 0;
    scene.add(hm);
    holes = { mesh: hm, next: 0, n: 240 };
    // dust and chips where bullets land
    const N = 160, pos = new Float32Array(N * 3);
    for (let k = 0; k < N; k++) pos[k * 3 + 1] = -50;
    const dg = new T.BufferGeometry(); dg.setAttribute('position', new T.BufferAttribute(pos, 3));
    const dp = new T.Points(dg, new T.PointsMaterial({ color: 0xb8b0a0, size: 0.18, map: W.radialTex, transparent: true, opacity: 0.6, depthWrite: false }));
    dp.frustumCulled = false; scene.add(dp);
    dust = { geo: dg, pos, vel: new Float32Array(N * 3), life: new Float32Array(N), n: N, next: 0 };
  };

  const q1 = new T.Quaternion(), q2 = new T.Quaternion(), mtx = new T.Matrix4(), vp = new T.Vector3(), vs = new T.Vector3(), vn = new T.Vector3(), ZAX = new T.Vector3(0, 0, 1);
  function hole(x, y, z, nx, ny, nz) {
    const i = holes.next; holes.next = (holes.next + 1) % holes.n;
    vn.set(nx, ny, nz);
    q1.setFromUnitVectors(ZAX, vn); q2.setFromAxisAngle(vn, Math.random() * 6.28); q2.multiply(q1);
    const s = G.R(0.07, 0.11);
    mtx.compose(vp.set(x + nx * 0.006, y + ny * 0.006, z + nz * 0.006), q2, vs.set(s, s, 1));
    holes.mesh.setMatrixAt(i, mtx);
    holes.mesh.instanceMatrix.needsUpdate = true;
    if (holes.mesh.count < i + 1) holes.mesh.count = i + 1;
  }
  function puff(x, y, z, nx, ny, nz, n) {
    for (let k = 0; k < n; k++) {
      const i = dust.next; dust.next = (dust.next + 1) % dust.n;
      dust.pos[i * 3] = x; dust.pos[i * 3 + 1] = y; dust.pos[i * 3 + 2] = z;
      dust.vel[i * 3] = nx * G.R(0.5, 2) + G.R(-0.6, 0.6); dust.vel[i * 3 + 1] = ny * G.R(0.5, 2) + G.R(0, 0.8); dust.vel[i * 3 + 2] = nz * G.R(0.5, 2) + G.R(-0.6, 0.6);
      dust.life[i] = G.R(0.3, 0.7);
    }
  }
  function ejectCasing(c, m) {
    const i = casings.next; casings.next = (casings.next + 1) % casings.n;
    const rx = -(m.dz || 0), rz = m.dx || 0; // to the shooter's right
    casings.p[i * 3] = m.x - (m.dx || 0) * 0.15; casings.p[i * 3 + 1] = m.y; casings.p[i * 3 + 2] = m.z - (m.dz || 0) * 0.15;
    casings.v[i * 3] = rx * G.R(1.5, 2.6) + G.R(-0.4, 0.4); casings.v[i * 3 + 1] = G.R(1.6, 2.8); casings.v[i * 3 + 2] = rz * G.R(1.5, 2.6) + G.R(-0.4, 0.4);
    casings.r[i * 3] = Math.random() * 6; casings.r[i * 3 + 1] = Math.random() * 6; casings.r[i * 3 + 2] = Math.random() * 6;
    casings.life[i] = 10; casings.hit[i] = 0;
  }

  GP.update = function (dt) {
    if (flash.visible) { flash.userData.t -= dt; if (flash.userData.t <= 0) flash.visible = false; }
    const e = new T.Euler(), q = new T.Quaternion(), arr = casings;
    let any = false;
    for (let i = 0; i < arr.n; i++) {
      if (arr.life[i] <= 0) continue;
      any = true;
      arr.life[i] -= dt;
      const o = i * 3, gy = W.groundY(arr.p[o], arr.p[o + 2]) + 0.007;
      if (arr.hit[i] < 3) {
        arr.v[o + 1] -= 9.8 * dt;
        arr.p[o] += arr.v[o] * dt; arr.p[o + 1] += arr.v[o + 1] * dt; arr.p[o + 2] += arr.v[o + 2] * dt;
        arr.r[o] += dt * 18; arr.r[o + 2] += dt * 11;
        if (arr.p[o + 1] < gy) {
          arr.p[o + 1] = gy; arr.v[o + 1] *= -0.35; arr.v[o] *= 0.5; arr.v[o + 2] *= 0.5;
          if (!arr.hit[i]) G.audio.tink(Math.max(0, 1 - Math.hypot(arr.p[o] - G.camera.position.x, arr.p[o + 2] - G.camera.position.z) / 15));
          arr.hit[i]++;
          if (arr.hit[i] >= 3) { arr.r[o] = Math.PI / 2; }
        }
      }
      mtx.compose(vp.set(arr.p[o], arr.p[o + 1], arr.p[o + 2]), q.setFromEuler(e.set(arr.r[o], arr.r[o + 1], arr.r[o + 2])), vs.set(1, 1, 1));
      if (arr.life[i] <= 0) mtx.makeScale(0, 0, 0);
      arr.mesh.setMatrixAt(i, mtx);
    }
    if (any) arr.mesh.instanceMatrix.needsUpdate = true;
    let anyD = false;
    for (let i = 0; i < dust.n; i++) {
      if (dust.life[i] <= 0) continue;
      anyD = true; dust.life[i] -= dt;
      const o = i * 3;
      if (dust.life[i] <= 0) { dust.pos[o + 1] = -50; continue; }
      dust.vel[o] *= 1 - 3 * dt; dust.vel[o + 1] = dust.vel[o + 1] * (1 - 3 * dt) - 1.5 * dt; dust.vel[o + 2] *= 1 - 3 * dt;
      dust.pos[o] += dust.vel[o] * dt; dust.pos[o + 1] += dust.vel[o + 1] * dt; dust.pos[o + 2] += dust.vel[o + 2] * dt;
    }
    if (anyD || dust.dirty) { dust.geo.attributes.position.needsUpdate = true; dust.dirty = anyD; }
  };

  // ---------------------------------------------------------------- firing
  const rand = () => Math.random() * 2 - 1;
  // fire one trigger pull. o = muzzle; (ax, ay, az) = point aimed at; spread = cone half-angle (radians)
  GP.fire = function (opt) {
    const { k, w, shooter, spread } = opt;
    const m = opt.muzzle;
    let dx0 = opt.ax - m.x, dy0 = opt.ay - m.y, dz0 = opt.az - m.z;
    const l0 = Math.hypot(dx0, dy0, dz0) || 1; dx0 /= l0; dy0 /= l0; dz0 /= l0;
    const hits = new Map(), corpseHits = new Map();
    let anyHit = false, killed = false, head = false;
    for (let n = 0; n < w.pellets; n++) {
      let dx = dx0 + rand() * spread, dy = dy0 + rand() * spread * 0.7, dz = dz0 + rand() * spread;
      const l = Math.hypot(dx, dy, dz); dx /= l; dy /= l; dz /= l;
      const wall = W.raycast3(m.x, m.y, m.z, dx, dy, dz, w.range);
      const body = GP.rayBodies(m.x, m.y, m.z, dx, dy, dz, wall.t, shooter);
      let et = wall.t;
      if (body) {
        et = body.t;
        const px = m.x + dx * et, py = m.y + dy * et, pz = m.z + dz * et;
        if (body.c.alive) {
          const h = hits.get(body.c) || { dmg: 0, dx: 0, dz: 0, part: body.part, joint: body.joint, n: 0, px, py, pz, bones: {}, t: et };
          h.dmg += G.R(w.dmg[0], w.dmg[1]) * body.mult; h.dx += dx; h.dz += dz; h.n++;
          h.bones[body.bone] = (h.bones[body.bone] || 0) + 1;
          if (body.part === 'head') { h.part = 'head'; h.joint = body.joint; }
          hits.set(body.c, h);
        } else {
          G.body.push(body.c, body.joint, dx * w.power * 0.8, 1 + dy * 2, dz * w.power * 0.8, 0.1);
          G.blood.spray(px, py, pz, dx, dz, 0.6, body.part === 'head');
          G.body.addBlood(body.c, 0.1);
          const ch = corpseHits.get(body.c) || { bones: {}, dx, dz, t: et, px, py, pz };
          ch.bones[body.bone] = (ch.bones[body.bone] || 0) + 1;
          corpseHits.set(body.c, ch);
        }
      } else if (wall.hit) {
        const px = m.x + dx * et, py = m.y + dy * et, pz = m.z + dz * et;
        hole(px, py, pz, wall.nx, wall.ny, wall.nz);
        puff(px, py, pz, wall.nx, wall.ny, wall.nz, 3);
        G.fx.spark(px, py, pz, 3);
        if (Math.random() < 0.3) G.audio.ric(Math.max(0, 1 - Math.hypot(px - G.camera.position.x, pz - G.camera.position.z) / 40));
      }
      G.fx.tracer(m.x, m.y, m.z, m.x + dx * Math.min(et, 120), m.y + dy * Math.min(et, 120), m.z + dz * Math.min(et, 120));
    }
    for (const [c, h] of hits) {
      const l = Math.hypot(h.dx, h.dz) || 1;
      const isHead = h.part === 'head';
      const power = w.power * (w.pellets > 1 ? Math.min(1, 0.35 + h.n / w.pellets) : 1) * (isHead ? 1.3 : 1);
      G.damageChar(c, h.dmg, m.x, m.z, shooter === G.player, { kind: 'bullet', dx: h.dx / l, dz: h.dz / l, power, joint: h.joint, head: isHead, y: h.py });
      if (c.alive) {
        if (h.part === 'leg') c.limpT = 1.6;
        if (h.part === 'arm') c.fireCD = Math.max(c.fireCD || 0, 0.7);
      }
      anyHit = true; killed = killed || !c.alive; head = head || isHead;
      G.gore.onBulletHit(c, k, h.bones, h.t, h.dx / l, h.dz / l, h.px, h.py, h.pz);
      killed = killed || !c.alive;
    }
    for (const [c, ch] of corpseHits) G.gore.onBulletHit(c, k, ch.bones, ch.t, ch.dx, ch.dz, ch.px, ch.py, ch.pz);
    // flash, brass, sound
    flash.position.set(m.x + dx0 * 0.08, m.y + dy0 * 0.08, m.z + dz0 * 0.08);
    const fs = k === 'shotgun' || k === 'rifle' ? 0.75 : k === 'smg' ? 0.42 : 0.5;
    flash.scale.set(fs * G.R(0.8, 1.2), fs * G.R(0.8, 1.2), 1);
    flash.material.rotation = Math.random() * 6.3;
    flash.visible = true; flash.userData.t = 0.045;
    if (k !== 'shotgun' || opt.pump) ejectCasing(shooter, m);
    return { anyHit, killed, head };
  };

  // where the crosshair (screen centre) points: the first thing the camera ray touches
  GP.aimPoint = function (camera, exclude) {
    const o = camera.position, d = new T.Vector3();
    camera.getWorldDirection(d);
    const wall = W.raycast3(o.x, o.y, o.z, d.x, d.y, d.z, 160);
    const body = GP.rayBodies(o.x, o.y, o.z, d.x, d.y, d.z, wall.t, exclude);
    const t = body ? body.t : wall.t;
    return { x: o.x + d.x * t, y: o.y + d.y * t, z: o.z + d.z * t, body, t };
  };

  // an enemy shoots at the player: cover between them stops the bullet
  GP.enemyShot = function (c, d, acc) {
    const pl = G.player, k = c.weaponK || 'pistol';
    const m = c.body ? GP.muzzle(c, k) : { x: c.x, y: 1.45, z: c.z };
    const crouched = pl.crouch && !pl.car;
    const ty = (pl.car ? pl.car.y + 1.2 : W.groundY(pl.x, pl.z) + (crouched ? 0.85 : 1.3)) + G.R(-0.15, 0.25);
    let tx = pl.x, tz = pl.z;
    const hit = Math.random() < acc;
    if (!hit) { const a = Math.random() * 6.28, r = G.R(0.6, 1.8); tx += Math.cos(a) * r; tz += Math.sin(a) * r; }
    let dx = tx - m.x, dy = ty + (hit ? 0 : G.R(-0.5, 0.8)) - m.y, dz = tz - m.z;
    const l = Math.hypot(dx, dy, dz) || 1; dx /= l; dy /= l; dz /= l;
    const wall = W.raycast3(m.x, m.y, m.z, dx, dy, dz, 120);
    const blocked = wall.t < l - 0.4;
    const et = blocked ? wall.t : hit ? l : Math.min(wall.t, l + 25);
    G.fx.tracer(m.x, m.y, m.z, m.x + dx * et, m.y + dy * et, m.z + dz * et);
    flash.position.set(m.x, m.y, m.z); flash.scale.set(0.45, 0.45, 1); flash.visible = true; flash.userData.t = 0.045;
    if (blocked || (!hit && wall.hit && wall.t < l + 25)) {
      const px = m.x + dx * et, py = m.y + dy * et, pz = m.z + dz * et;
      hole(px, py, pz, wall.nx, wall.ny, wall.nz); puff(px, py, pz, wall.nx, wall.ny, wall.nz, 3); G.fx.spark(px, py, pz, 3);
    }
    if (!blocked && !hit) {
      // a near miss: you hear it go past
      const cx = pl.x - m.x, cz = pl.z - m.z, along = cx * dx + cz * dz;
      const perp = Math.hypot(cx - dx * along, cz - dz * along);
      if (perp < 2.5 && along > 0) G.audio.whiz(1 - perp / 2.5);
    }
    if (c.body) ejectCasing(c, m);
    return hit && !blocked;
  };

  // ---------------------------------------------------------------- HUD bits
  let hmT = 0;
  GP.hitmark = function (kill, head) {
    const el = document.getElementById('hitmark');
    el.className = kill ? (head ? 'kill head' : 'kill') : 'hit';
    el.hidden = false; hmT = kill ? 0.35 : 0.14;
    G.audio.tick(kill);
  };
  GP.hudUpdate = function (dt) {
    if (hmT > 0) { hmT -= dt; if (hmT <= 0) document.getElementById('hitmark').hidden = true; }
  };
})();
