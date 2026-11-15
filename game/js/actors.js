'use strict';
// Actors: people (peds, cops, Saints) and their AI, cars, and effects.
// Bodies, ragdolls and blood live in body.js.
(function () {
  const T = THREE, W = G.world;
  const A = (G.actors = {});
  G.chars = [];
  G.cars = [];

  const mats = {};
  const mat = (hex) => mats[hex] || (mats[hex] = new T.MeshLambertMaterial({ color: hex }));
  const basic = (hex) => mats['b' + hex] || (mats['b' + hex] = new T.MeshBasicMaterial({ color: hex }));
  const BURNT = new T.MeshLambertMaterial({ color: 0x141414 });

  const PED_TOPS = ['#3b4350', '#5a4436', '#6a5a48', '#2f4454', '#743838', '#4f5a3c', '#8a7a62', '#2a2a30', '#7a6a50', '#4a3c58', '#8a4f34', '#556672', '#9a8f7a', '#2c5a5a', '#6b2a3a'];
  const PED_PANTS = ['#1c1d22', '#2c3038', '#3c3830', '#26324a', '#4a4236', '#5a5a5e'];
  const SHOES = ['#121212', '#2a1c12', '#3a3a3a', '#d8d8d0', '#4a2a1a'];
  const SKINS = ['#8d5a3b', '#c08a63', '#e0b18f', '#5a3a28', '#a8714f', '#d49b78', '#6e4630', '#f0c8a8'];
  const HAIR = ['#120e0b', '#2a1d14', '#3a3a3a', '#5a4630', '#1a1a1a', '#8a8a8a', '#6a3a1a', '#b08a50'];

  function outfit(kind) {
    switch (kind) {
      case 'player': return { shirt: '#4a3626', long: true, pants: '#1e2026', shoes: '#141210', skin: '#b07a58', hair: '#1a1410', gun: true, h: 1.04, w: 1.06 };
      case 'cop': return { shirt: '#24365e', pants: '#151c30', shoes: '#0c0c0c', skin: G.pick(SKINS), cap: '#10131a', gun: true, badge: true };
      case 'saint': return { shirt: '#1a1a1e', long: true, pants: '#101012', shoes: '#0a0a0a', skin: '#cfc9bb', hood: '#121215', mask: true, halo: true, gun: true };
      case 'guard': return { shirt: '#4a5240', pants: '#33372c', shoes: '#141414', skin: G.pick(SKINS), cap: '#2a2d24' };
      case 'mars': return { shirt: '#7a2a3e', pants: '#24222a', shoes: '#1a1012', skin: '#9a6446', hair: '#0e0b0a', tinHalo: true, h: 0.95, w: 0.95 };
      case 'local': return Object.assign(outfit('ped'), { long: true, cap: Math.random() < 0.5 ? G.pick(['#7a1a1a', '#2a3a2a', '#d8d0c0']) : null, hood: Math.random() < 0.3 ? '#3a3a40' : null });
      default: {
        const long = Math.random() < 0.3;
        return {
          shirt: G.pick(PED_TOPS), long, pants: G.pick(PED_PANTS), shoes: G.pick(SHOES), skin: G.pick(SKINS),
          hood: Math.random() < 0.18 ? G.pick(PED_TOPS) : null, cap: Math.random() < 0.12 ? G.pick(['#1a1a1a', '#7a1a1a', '#1a2a4a']) : null,
          hair: Math.random() < 0.08 ? null : G.pick(HAIR),
        };
      }
    }
  }

  // make room in the body pool: oldest corpse first, then the farthest bystander
  function freeSlot() {
    let old = null;
    for (const c of G.chars) if (!c.alive && !c.prop && (!old || c.diedAt < old.diedAt)) old = c;
    if (old) { A.remove(old); return; }
    let far = null, fd = 0;
    for (const c of G.chars) {
      if (c.kind !== 'ped' || c.mission || c.persistent) continue;
      const d = Math.hypot(c.x - G.player.x, c.z - G.player.z);
      if (d > fd) { fd = d; far = c; }
    }
    if (far) A.remove(far);
  }

  A.spawn = function (kind, x, z, opts = {}) {
    const hp = kind === 'saint' ? 110 : kind === 'cop' ? 90 : kind === 'player' ? 100 : 40;
    const c = {
      kind, x, z, rot: opts.rot !== undefined ? opts.rot : Math.random() * Math.PI * 2,
      hp, maxHp: hp, alive: true, phase: Math.random() * 6, flinch: 0,
      hostile: !!opts.hostile, mission: !!opts.mission, persistent: !!opts.persistent,
      fireCD: G.R(0.8, 1.6), los: false, losT: Math.random() * 0.3, navT: 0, nav: null, strafeT: 0, strafeDir: 0,
      range: kind === 'cop' ? 22 : 18, fleeT: 0, tx: 0, tz: 0, walk: G.R(1.0, 1.5), born: Math.random() * 100,
    };
    if (!G.body.hasFree() && G.player) freeSlot();
    if (!G.body.create(c, outfit(kind))) return null;
    if (opts.anchor) c.anchor = opts.anchor;
    if (kind === 'local') c.kind = 'ped';
    if (c.kind === 'ped' && !c.anchor) {
      const r = opts.ring || W.nearestRing(x, z);
      c.ri = r.i; c.rj = r.j; c.rs = r.s; c.rdir = Math.random() < 0.5 ? 1 : -1;
    }
    G.body.pose(c, 0.016, 0, false);
    if (opts.dead) {
      c.alive = false; c.prop = true; c.diedAt = -1;
      G.body.startRag(c);
      const fx = Math.sin(c.rot), fz = Math.cos(c.rot);
      G.body.push(c, G.body.J.NECK, -fx * (opts.fall || 3), 0, -fz * (opts.fall || 3), 0.2);
      G.body.settle(c, 600);
      G.blood.pool(c.x, W.groundY(c.x, c.z), c.z, G.R(1.2, 1.7));
      c.body.pooled = true;
      G.body.addBlood(c, 0.8);
    }
    if (kind !== 'player') G.chars.push(c);
    return c;
  };

  A.remove = function (c) {
    G.body.release(c);
    const k = G.chars.indexOf(c);
    if (k >= 0) G.chars.splice(k, 1);
  };

  // death: hand the body to physics, pushed the way the hit pushed it
  A.kill = function (c, hit) {
    c.alive = false; c.hp = 0; c.diedAt = G.time;
    if (!c.body) return;
    const B = G.body, J = B.J;
    B.startRag(c);
    hit = hit || { kind: 'bullet', dx: 0, dz: 1, power: 3 };
    if (hit.kind === 'car') {
      const vx = hit.vx, vz = hit.vz, sp = Math.hypot(vx, vz);
      B.push(c, -1, vx * 0.75, 2.2 + sp * 0.13, vz * 0.75, 1);
      for (const k of [J.KNL, J.KNR, J.FTL, J.FTR]) B.pushJoint(c, k, vx * 0.45, 1.5 + sp * 0.12, vz * 0.45);
      B.pushJoint(c, J.HEAD, -vx * 0.2, 0.5, -vz * 0.2);
      c.bigPool = true;
    } else if (hit.kind === 'blast') {
      for (let i = 0; i < 15; i++) B.pushJoint(c, i, hit.dx * G.R(7, 12) + G.R(-2.5, 2.5), G.R(5, 9), hit.dz * G.R(7, 12) + G.R(-2.5, 2.5));
      c.bigPool = true;
    } else {
      const pw = hit.power || 4;
      B.push(c, hit.joint !== undefined ? hit.joint : J.NECK, hit.dx * pw, 0.9, hit.dz * pw, 0.3);
      B.pushJoint(c, Math.random() < 0.5 ? J.KNL : J.KNR, hit.dx * G.R(-1, 1.5), 0, hit.dz * G.R(-1, 1.5));
      if (hit.head) c.headshot = true;
    }
  };

  function moveChar(c, vx, vz, dt) {
    c.x += vx * dt; c.z += vz * dt;
    W.collide(c, 0.35);
    A.pushFromCars(c, 0.35);
  }

  A.pushFromCars = function (c, r) {
    for (const car of G.cars) {
      const dx = c.x - car.x, dz = c.z - car.z;
      if (dx * dx + dz * dz > 14) continue;
      const fx = Math.sin(car.heading), fz = Math.cos(car.heading);
      const lz = dx * fx + dz * fz, lx = dx * fz - dz * fx;
      const hx = car.hw + r, hz = car.hl + r;
      if (Math.abs(lx) < hx && Math.abs(lz) < hz) {
        const px = hx - Math.abs(lx), pz = hz - Math.abs(lz);
        if (px < pz) { const s = (lx >= 0 ? 1 : -1) * px; c.x += fz * s; c.z += -fx * s; }
        else { const s = (lz >= 0 ? 1 : -1) * pz; c.x += fx * s; c.z += fz * s; }
      }
    }
  };

  // ---------------------------------------------------------------- AI
  A.alarm = function (x, z, radius) {
    if (G.traffic) G.traffic.alarm(x, z, radius);
    const r2 = radius * radius;
    for (const c of G.chars) {
      if (!c.alive || c.kind !== 'ped') continue;
      const dx = c.x - x, dz = c.z - z;
      if (dx * dx + dz * dz < r2) { c.fleeT = G.R(9, 16); c.tx = x; c.tz = z; }
    }
  };

  function updatePed(c, dt) {
    let speed;
    if (c.fleeT > 0) {
      c.fleeT -= dt;
      let ax = c.x - c.tx, az = c.z - c.tz;
      const l = Math.hypot(ax, az) || 1;
      ax /= l; az /= l;
      const wob = Math.sin(G.time * 1.7 + c.phase) * 0.4;
      const vx = ax + az * wob, vz = az - ax * wob;
      speed = 5.4;
      c.rot = G.angleLerp(c.rot, Math.atan2(vx, vz), Math.min(1, dt * 8));
      moveChar(c, Math.sin(c.rot) * speed, Math.cos(c.rot) * speed, dt);
      if (c.fleeT <= 0 && !c.anchor) { const r = W.nearestRing(c.x, c.z); c.ri = r.i; c.rj = r.j; c.rs = r.s; }
    } else if (c.anchor) {
      if (c.idleT > 0) { c.idleT -= dt; speed = 0; }
      else {
        if (!c.goal || Math.hypot(c.goal.x - c.x, c.goal.z - c.z) < 1) {
          c.goal = { x: c.anchor.x + G.R(-9, 9), z: c.anchor.z + G.R(-9, 9) };
          c.idleT = G.R(1, 7);
        }
        speed = c.walk;
        c.rot = G.angleLerp(c.rot, Math.atan2(c.goal.x - c.x, c.goal.z - c.z), Math.min(1, dt * 5));
        moveChar(c, Math.sin(c.rot) * speed, Math.cos(c.rot) * speed, dt);
      }
    } else {
      if (c.idleT > 0) { c.idleT -= dt; speed = 0; }
      else {
        let tp = W.ringPos(c.ri, c.rj, c.rs);
        let dx = tp.x - c.x, dz = tp.z - c.z;
        if (dx * dx + dz * dz < 4) { c.rs += c.rdir * 2; tp = W.ringPos(c.ri, c.rj, c.rs); dx = tp.x - c.x; dz = tp.z - c.z; }
        speed = c.walk;
        c.rot = G.angleLerp(c.rot, Math.atan2(dx, dz), Math.min(1, dt * 5));
        moveChar(c, Math.sin(c.rot) * speed, Math.cos(c.rot) * speed, dt);
        if (Math.random() < dt * 0.04) c.idleT = G.R(2, 6);
      }
    }
    G.body.pose(c, dt, speed, false);
  }

  function pickNav(c, tx, tz) {
    const ex = W.roadIndex(c.x), ez = W.roadIndex(c.z);
    let best = null, bestS = 1e9;
    for (let a = -2; a <= 2; a++) {
      for (let b = -2; b <= 2; b++) {
        const kx = ex + a, kz = ez + b;
        if (kx < 0 || kz < 0 || kx > W.NB || kz > W.NB) continue;
        const x = W.roadLine(kx), z = W.roadLine(kz);
        const de = Math.hypot(x - c.x, z - c.z);
        if (de < 3) continue;
        if (!W.hasLOS(c.x, c.z, x, z)) continue;
        const s = Math.hypot(x - tx, z - tz) + de * 0.3;
        if (s < bestS) { bestS = s; best = { x, z }; }
      }
    }
    return best;
  }

  function updateHostile(c, dt) {
    const pl = G.player;
    const tx = pl.x, tz = pl.z;
    const dx = tx - c.x, dz = tz - c.z, d = Math.hypot(dx, dz);
    let speed = 0, aiming = false, vx = 0, vz = 0;
    if (!c.hostile) {
      // a calm cop drifts away from you and goes back on patrol
      const l = d || 1;
      speed = 1.6;
      c.rot = G.angleLerp(c.rot, Math.atan2(-dx / l, -dz / l), Math.min(1, dt * 3));
      moveChar(c, Math.sin(c.rot) * speed, Math.cos(c.rot) * speed, dt);
      G.body.pose(c, dt, speed, false);
      return;
    }
    c.losT -= dt;
    if (c.losT <= 0) {
      const had = c.los;
      c.los = pl.alive && W.hasLOS(c.x, c.z, tx, tz);
      c.losT = 0.25;
      if (c.los && !had) c.fireCD = Math.max(c.fireCD, G.R(0.5, 0.9));
    }
    if (c.los && d < c.range && pl.alive) {
      aiming = true;
      c.rot = G.angleLerp(c.rot, Math.atan2(dx, dz), Math.min(1, dt * 10));
      c.strafeT -= dt;
      if (c.strafeT <= 0) { c.strafeDir = G.pick([-1, 0, 1]); c.strafeT = G.R(0.8, 2.2); }
      const nx = dx / d, nz = dz / d;
      vx = -nz * c.strafeDir * 1.7; vz = nx * c.strafeDir * 1.7;
      if (d > c.range * 0.65) { vx += nx * 1.6; vz += nz * 1.6; }
      if (d < 5) { vx -= nx * 1.8; vz -= nz * 1.8; }
      speed = Math.hypot(vx, vz);
      c.fireCD -= dt;
      if (c.fireCD <= 0) { c.fireCD = G.R(0.75, 1.5) * (c.kind === 'cop' ? 1.1 : 1); hostileShoot(c, d); }
    } else if (pl.alive) {
      c.navT -= dt;
      let gx = tx, gz = tz;
      if (!c.los && W.inCity(c.x, c.z)) {
        if (c.navT <= 0 || (c.nav && Math.hypot(c.nav.x - c.x, c.nav.z - c.z) < 2.5)) { c.nav = pickNav(c, tx, tz); c.navT = 0.7; }
        if (c.nav) { gx = c.nav.x; gz = c.nav.z; }
      }
      const ax = gx - c.x, az = gz - c.z, l = Math.hypot(ax, az) || 1;
      speed = 4.7;
      vx = (ax / l) * speed; vz = (az / l) * speed;
      c.rot = G.angleLerp(c.rot, Math.atan2(vx, vz), Math.min(1, dt * 8));
    }
    // keep a little distance from each other
    for (const o of G.chars) {
      if (o === c || !o.alive || !o.hostile) continue;
      const ox = c.x - o.x, oz = c.z - o.z, d2 = ox * ox + oz * oz;
      if (d2 < 1.4 && d2 > 1e-4) { const k = (1.2 - Math.sqrt(d2)) * 3; vx += ox * k; vz += oz * k; }
    }
    moveChar(c, vx, vz, dt);
    G.body.pose(c, dt, speed, aiming);
  }

  function hostileShoot(c, d) {
    const pl = G.player;
    const fx = Math.sin(c.rot), fz = Math.cos(c.rot);
    const ox = c.x + fx * 0.6 - fz * 0.25, oz = c.z + fz * 0.6 + fx * 0.25;
    let p = G.clamp(0.52 - d * 0.014, 0.14, 0.52);
    if (pl.car) p *= Math.abs(pl.car.speed) > 10 ? 0.45 : 0.8;
    else if (pl.moving > 6) p *= 0.65;
    const hit = Math.random() < p;
    let ex = pl.x, ez = pl.z, ey = 1.3;
    if (!hit) { ex += G.R(-1.6, 1.6); ez += G.R(-1.6, 1.6); ey = G.R(0.4, 2.4); }
    G.fx.tracer(ox, 1.45, oz, ex, ey, ez);
    G.fx.flash(ox, 1.5, oz, 0.7);
    const pd = Math.hypot(G.camera.position.x - c.x, G.camera.position.z - c.z);
    G.audio.shot(G.clamp(1 - pd / 70, 0.05, 0.75));
    if (hit) G.damagePlayer(G.R(7, 11), c.x, c.z);
    else G.fx.spark(ex, ey, ez, 4);
  }

  A.updateChars = function (dt) {
    for (let k = G.chars.length - 1; k >= 0; k--) {
      const c = G.chars[k];
      if (!c.alive) continue;
      if (c.kind === 'ped') updatePed(c, dt);
      else if (c.kind === 'cop' || c.kind === 'saint') updateHostile(c, dt);
    }
  };

  // Nearest character along a ray (x/z only; everyone is about 1.8 m tall).
  A.rayChars = function (ox, oz, dx, dz, maxT, exclude) {
    let best = null, bt = maxT;
    for (const c of G.chars) {
      if (!c.alive || c === exclude) continue;
      const vx = c.x - ox, vz = c.z - oz;
      const t = vx * dx + vz * dz;
      if (t < 0 || t > bt) continue;
      const perp = Math.abs(vx * dz - vz * dx);
      if (perp < 0.42) { bt = t; best = c; }
    }
    return best ? { c: best, t: bt } : null;
  };
  // ---------------------------------------------------------------- cars
  const CAR_COLORS = ['#5a1a1a', '#1f2a3a', '#3a3a36', '#2a3a2a', '#6a5a3a', '#202022', '#4a4a50', '#5a3a1a', '#2a2240', '#7a7a72'];
  const carGeo = {
    body: new T.BoxGeometry(1.9, 0.62, 4.4),
    cabin: new T.BoxGeometry(1.66, 0.55, 2.2),
    wheel: new T.CylinderGeometry(0.36, 0.36, 0.26, 10).rotateZ(Math.PI / 2),
    lamp: new T.BoxGeometry(0.4, 0.14, 0.05),
    vanBody: new T.BoxGeometry(2.1, 1.7, 5.2),
    vanGlass: new T.BoxGeometry(1.9, 0.6, 0.06),
    bar: new T.BoxGeometry(0.55, 0.13, 0.3),
    doorPanel: new T.BoxGeometry(1.93, 0.42, 1.9),
    beam: new T.PlaneGeometry(4.2, 11).rotateX(-Math.PI / 2),
  };
  const headOn = basic('#fff4d6'), headOff = mat('#3a3a34'), tailOn = basic('#ff2020'), tailOff = mat('#4a0a0a');
  const barRed = basic('#ff1a2a'), barBlue = basic('#2a5aff'), barDim = mat('#202024');

  A.spawnCar = function (x, z, heading, opts = {}) {
    const g = new T.Group();
    const cop = !!opts.cop, van = !!opts.van;
    const color = opts.color || (cop ? '#101114' : G.pick(CAR_COLORS));
    const parts = { heads: [], tails: [], bars: [] };
    let hl = 2.25, hw = 1.0;
    if (van) {
      const b = new T.Mesh(carGeo.vanBody, mat(color)); b.position.y = 1.2; g.add(b);
      const gl = new T.Mesh(carGeo.vanGlass, mat('#0a0d12')); gl.position.set(0, 1.6, 2.61); g.add(gl);
      hl = 2.65; hw = 1.1;
    } else {
      const b = new T.Mesh(carGeo.body, mat(color)); b.position.y = 0.66; g.add(b);
      const cab = new T.Mesh(carGeo.cabin, mat('#0b0e13')); cab.position.set(0, 1.24, -0.25); g.add(cab);
      if (cop) {
        const dp = new T.Mesh(carGeo.doorPanel, mat('#d8d8d2')); dp.position.set(0, 0.66, -0.1); g.add(dp);
        for (const s of [-1, 1]) { const bar = new T.Mesh(carGeo.bar, s < 0 ? barRed : barBlue); bar.position.set(s * 0.3, 1.58, -0.25); g.add(bar); parts.bars.push(bar); }
      }
    }
    const wz = van ? 1.7 : 1.35, wx = van ? 1.0 : 0.92;
    const wheels = [];
    for (const [sx, sz] of [[-1, 1], [1, 1], [-1, -1], [1, -1]]) {
      const w = new T.Mesh(carGeo.wheel, mat('#0a0a0a')); w.position.set(sx * wx, 0.36, sz * wz); g.add(w); wheels.push(w);
    }
    for (const s of [-1, 1]) {
      const h = new T.Mesh(carGeo.lamp, headOff); h.position.set(s * 0.62, van ? 0.9 : 0.7, hl - 0.06); g.add(h); parts.heads.push(h);
      const t = new T.Mesh(carGeo.lamp, tailOff); t.position.set(s * 0.62, van ? 0.9 : 0.72, -hl + 0.06); g.add(t); parts.tails.push(t);
    }
    const beam = new T.Mesh(carGeo.beam, new T.MeshBasicMaterial({ map: W.radialTex, color: 0xfff0c8, transparent: true, opacity: 0.55, blending: T.AdditiveBlending, depthWrite: false }));
    beam.position.set(0, 0.06, hl + 5); beam.visible = false; g.add(beam);
    g.rotation.order = 'YXZ';
    g.position.set(x, W.groundY(x, z), z); g.rotation.y = heading;
    G.scene.add(g);
    const car = {
      mesh: g, x, z, y: W.groundY(x, z), pitch: 0, roll: 0, heading, speed: 0, slip: 0, steer: 0, hp: opts.hp || 100, cop, van, driver: null, wheels, parts, beam,
      hl, hw, wrecked: false, persistent: !!opts.persistent, lightsOn: false, burnT: 0, born: G.time || 0,
    };
    if (opts.lights) A.setLights(car, true);
    G.cars.push(car);
    return car;
  };

  A.setLights = function (car, on) {
    car.lightsOn = on;
    for (const h of car.parts.heads) h.material = on ? headOn : headOff;
    for (const t of car.parts.tails) t.material = on ? tailOn : tailOff;
    car.beam.visible = on;
  };

  A.removeCar = function (car) {
    G.scene.remove(car.mesh);
    const k = G.cars.indexOf(car);
    if (k >= 0) G.cars.splice(k, 1);
  };

  let barT = 0, barPhase = false;
  A.updateCars = function (dt, input) {
    barT -= dt;
    if (barT <= 0) {
      barT = 0.18; barPhase = !barPhase;
      for (const car of G.cars) {
        if (!car.cop || car.wrecked) continue;
        const on = car.sirenOn;
        car.parts.bars[0].material = on && barPhase ? barRed : barDim;
        car.parts.bars[1].material = on && !barPhase ? barBlue : barDim;
      }
    }
    for (const car of G.cars) updateCar(car, dt, car.driver === G.player ? input : car.ai && !car.wrecked ? car.ai.ctrl : null);
  };

  // Car physics: forward speed + sideways slip. Tyres bleed slip off (grip); the handbrake
  // drops grip so the back steps out and you drift.
  function updateCar(car, dt, ctrl) {
    if (car.wrecked) {
      car.burnT -= dt;
      if (car.burnT > 0 && Math.random() < dt * 30) G.fx.fire.emit(car.x + G.R(-0.8, 0.8), 1.2, car.z + G.R(-1.5, 1.5), 1, 0.4, 1.5, 0.9);
      if (car.burnT > 0 && Math.random() < dt * 12) G.fx.smoke.emit(car.x, 2, car.z, 1, 0.6, 1.2, 2.5);
      return;
    }
    let dh = 0, grip = 6;
    car.braking = false;
    if (ctrl) {
      const gas = ctrl.gas, brk = ctrl.brakeIn, hb = ctrl.handbrake;
      if (gas) { if (car.speed < -0.5) car.speed += 32 * dt; else car.speed += 15 * dt * (1 - Math.max(0, car.speed) / 32); }
      if (brk) {
        if (car.speed > 0.5) { car.speed -= 30 * dt; car.braking = true; }
        else car.speed = Math.max(-10, car.speed - 11 * dt);
      }
      if (!gas && !brk) car.speed *= 1 - 0.45 * dt;
      grip = 9;
      if (hb) { car.speed *= 1 - 1.3 * dt; grip = 1.1; car.braking = true; }
      car.steer = G.lerp(car.steer, ctrl.steer, Math.min(1, dt * 8));
      const sp = Math.abs(car.speed);
      dh = -car.steer * 2.1 * Math.min(1, sp / 6) / (1 + sp / 32) * (hb ? 1.8 : 1) * Math.sign(car.speed) * dt;
    } else {
      car.speed *= 1 - 1.6 * dt;
      car.steer *= 1 - 3 * dt;
    }
    if (car.pitch) car.speed -= 9.8 * Math.sin(car.pitch) * dt * 0.85;
    if (dh) {
      // the body turns; the momentum doesn't (yet)
      car.heading += dh;
      const c = Math.cos(dh), s = Math.sin(dh), vf = car.speed, vs = car.slip;
      car.speed = vf * c + vs * s; car.slip = -vf * s + vs * c;
    }
    const ns = car.slip * Math.exp(-grip * dt), lost = car.slip * car.slip - ns * ns;
    car.slip = ns;
    if (car.speed !== 0) car.speed = Math.sign(car.speed) * Math.sqrt(car.speed * car.speed + lost * (grip > 3 ? 0.9 : 0.3));
    if (Math.abs(car.speed) < 0.05 && !ctrl) car.speed = 0;
    if (Math.abs(car.slip) < 0.02) car.slip = 0;

    const fx = Math.sin(car.heading), fz = Math.cos(car.heading), sx = Math.cos(car.heading), sz = -Math.sin(car.heading);
    let vx = fx * car.speed + sx * car.slip, vz = fz * car.speed + sz * car.slip;
    if (ctrl && Math.abs(car.slip) > 3.2 && Math.random() < dt * 40) {
      for (const side of [-1, 1]) G.fx.smoke.emit(car.x - fx * 1.4 + sx * side * 0.9, 0.3, car.z - fz * 1.4 + sz * side * 0.9, 1, 0.8, 0.8, 1.2);
    }
    if (vx !== 0 || vz !== 0) {
      car.x += vx * dt; car.z += vz * dt;
      let bumped = false;
      for (const o of [car.hl - 1.05, -(car.hl - 1.05)]) {
        const p = { x: car.x + fx * o, z: car.z + fz * o };
        const px = p.x, pz = p.z;
        if (W.collide(p, car.hw + 0.12)) { car.x += p.x - px; car.z += p.z - pz; bumped = true; }
      }
      const sp = Math.hypot(vx, vz);
      if (bumped) {
        if (sp > 4) {
          if (car.driver) { G.shake(Math.min(0.8, sp / 25)); G.audio.thud(Math.min(1, sp / 20)); }
          if (sp > 9) A.damageCar(car, sp * 1.4);
          car.speed *= -0.28; car.slip *= 0.4;
        } else { car.speed *= 0.6; car.slip *= 0.6; }
      }
      // other cars
      for (const o of G.cars) {
        if (o === car) continue;
        const dx = o.x - car.x, dz = o.z - car.z;
        if (dx * dx + dz * dz > 30) continue;
        const ofx = Math.sin(o.heading), ofz = Math.cos(o.heading);
        for (const a of [car.hl - 1.05, -(car.hl - 1.05)]) {
          for (const b of [o.hl - 1.05, -(o.hl - 1.05)]) {
            const ax = car.x + fx * a, az = car.z + fz * a, bx = o.x + ofx * b, bz = o.z + ofz * b;
            const ex = bx - ax, ez = bz - az, d = Math.hypot(ex, ez), m = car.hw + o.hw + 0.1;
            if (d < m && d > 1e-4) {
              const push = (m - d) / d * 0.5;
              car.x -= ex * push; car.z -= ez * push; o.x += ex * push; o.z += ez * push;
              if (sp > 3) {
                o.speed += (vx * ofx + vz * ofz) * 0.35;
                o.slip += (vx * Math.cos(o.heading) - vz * Math.sin(o.heading)) * 0.35;
                if (car.driver) { G.shake(Math.min(0.6, sp / 30)); G.audio.thud(Math.min(1, sp / 25)); }
                if (sp > 9) { A.damageCar(car, sp * 0.8); A.damageCar(o, sp * 1.2); }
                car.speed *= 0.55; car.slip *= 0.55;
              }
            }
          }
        }
        o.mesh.position.set(o.x, o.y, o.z);
      }
      // people
      for (const c of G.chars) {
        if (!c.alive) continue;
        const dx = c.x - car.x, dz = c.z - car.z;
        if (dx * dx + dz * dz > 12) continue;
        const lz = dx * fx + dz * fz, lx = dx * fz - dz * fx;
        if (Math.abs(lx) < car.hw + 0.3 && Math.abs(lz) < car.hl + 0.3) {
          if (sp > 5) {
            G.damageChar(c, 30 + sp * 6, car.x - fx * 3, car.z - fz * 3, car.driver === G.player, { kind: 'car', vx, vz });
            G.audio.thud(0.7);
            car.speed *= 0.9;
          } else A.pushFromCars(c, 0.35);
        }
      }
      G.body.carSweep(car, vx, vz);
    }
    // sit on the ground and tilt with it
    const hf = W.groundY(car.x + fx * 1.7, car.z + fz * 1.7), hb = W.groundY(car.x - fx * 1.7, car.z - fz * 1.7);
    const hl = W.groundY(car.x + sx * 0.9, car.z + sz * 0.9), hr = W.groundY(car.x - sx * 0.9, car.z - sz * 0.9);
    const ty = Math.max((hf + hb + hl + hr) / 4, W.groundY(car.x, car.z));
    car.y = car.y + (ty - car.y) * Math.min(1, dt * 18);
    car.pitch = G.lerp(car.pitch, Math.atan2(hf - hb, 3.4), Math.min(1, dt * 10));
    car.roll = G.lerp(car.roll, Math.atan2(hl - hr, 1.8), Math.min(1, dt * 10));
    car.mesh.position.set(car.x, car.y, car.z);
    car.mesh.rotation.set(-car.pitch, car.heading, car.roll - car.steer * Math.min(1, Math.abs(car.speed) / 25) * 0.05 + car.slip * 0.006);
    const spin = car.speed * dt / 0.36;
    for (const w of car.wheels) w.rotation.x += spin;
    if (car.lightsOn) for (const t of car.parts.tails) t.scale.set(car.braking ? 1.3 : 1, car.braking ? 1.6 : 1, 1);
  }

  A.damageCar = function (car, amt) {
    if (car.wrecked) return;
    car.hp -= amt;
    if (car.hp <= 0) A.explode(car);
  };

  A.explode = function (car) {
    car.wrecked = true; car.hp = 0; car.speed *= 0.3; car.slip *= 0.3; car.burnT = 25; car.sirenOn = false;
    car.mesh.traverse((m) => { if (m.isMesh && m !== car.beam) m.material = BURNT; });
    car.beam.visible = false;
    G.fx.boom(car.x, car.z);
    G.audio.boom();
    G.shake(1);
    const byPlayer = car.lastDriver === G.player;
    for (const c of G.chars) {
      const d = Math.hypot(c.x - car.x, c.z - car.z);
      if (d > 7) continue;
      const l = d || 1, dx = (c.x - car.x) / l, dz = (c.z - car.z) / l;
      if (c.alive) G.damageChar(c, 200 * (1 - d / 7) + 30, car.x, car.z, byPlayer, { kind: 'blast', dx, dz });
      else if (c.body) for (let i = 0; i < 15; i++) G.body.pushJoint(c, i, dx * G.R(5, 9), G.R(4, 7), dz * G.R(5, 9));
    }
    const pl = G.player;
    if (pl.car === car) { G.exitCar(true); G.damagePlayer(55, car.x, car.z, true, 'blast'); }
    else {
      const d = Math.hypot(pl.x - car.x, pl.z - car.z);
      if (d < 7) G.damagePlayer(75 * (1 - d / 7), car.x, car.z, true, 'blast');
    }
    for (const o of G.cars) {
      if (o === car || o.wrecked) continue;
      const d = Math.hypot(o.x - car.x, o.z - car.z);
      if (d < 5) A.damageCar(o, 60 * (1 - d / 5));
    }
  };

  // ---------------------------------------------------------------- effects
  class Particles {
    constructor(scene, cap, color, size, additive, grav) {
      this.cap = cap; this.grav = grav; this.next = 0;
      this.pos = new Float32Array(cap * 3); this.vel = new Float32Array(cap * 3); this.life = new Float32Array(cap);
      for (let k = 0; k < cap; k++) this.pos[k * 3 + 1] = -50;
      this.geo = new T.BufferGeometry();
      this.geo.setAttribute('position', new T.BufferAttribute(this.pos, 3));
      const m = new T.PointsMaterial({ color, size, map: W.radialTex, transparent: true, depthWrite: false, blending: additive ? T.AdditiveBlending : T.NormalBlending });
      this.pts = new T.Points(this.geo, m); this.pts.frustumCulled = false;
      scene.add(this.pts);
    }
    emit(x, y, z, n, spread, up, life, dx = 0, dz = 0, push = 0) {
      for (let k = 0; k < n; k++) {
        const i = this.next; this.next = (this.next + 1) % this.cap;
        this.pos[i * 3] = x; this.pos[i * 3 + 1] = y; this.pos[i * 3 + 2] = z;
        this.vel[i * 3] = (Math.random() - 0.5) * spread + dx * push;
        this.vel[i * 3 + 1] = Math.random() * up;
        this.vel[i * 3 + 2] = (Math.random() - 0.5) * spread + dz * push;
        this.life[i] = life * (0.5 + Math.random() * 0.5);
      }
    }
    update(dt) {
      let any = false;
      for (let i = 0; i < this.cap; i++) {
        if (this.life[i] <= 0) continue;
        any = true;
        this.life[i] -= dt;
        const o = i * 3;
        if (this.life[i] <= 0) { this.pos[o + 1] = -50; continue; }
        this.vel[o + 1] -= 9.8 * this.grav * dt;
        this.pos[o] += this.vel[o] * dt; this.pos[o + 1] += this.vel[o + 1] * dt; this.pos[o + 2] += this.vel[o + 2] * dt;
        if (this.pos[o + 1] < 0.03 && this.grav > 0) { this.pos[o + 1] = 0.03; this.vel[o] = this.vel[o + 1] = this.vel[o + 2] = 0; }
      }
      if (any || this.dirty) { this.geo.attributes.position.needsUpdate = true; this.dirty = any; }
    }
  }

  const FX = (G.fx = {});
  FX.init = function (scene) {
    FX.sparkP = new Particles(scene, 120, 0xffc070, 0.16, true, 0.6);
    FX.fire = new Particles(scene, 220, 0xff6a1a, 1.2, true, -0.2);
    FX.smoke = new Particles(scene, 160, 0x9a9aa0, 1.5, false, -0.04);
    FX.smoke.pts.material.opacity = 0.35;
    FX.tracers = [];
    for (let k = 0; k < 16; k++) {
      const g = new T.BufferGeometry(); g.setAttribute('position', new T.BufferAttribute(new Float32Array(6), 3));
      const l = new T.Line(g, new T.LineBasicMaterial({ color: 0xffd58a, transparent: true, opacity: 0 }));
      l.frustumCulled = false; scene.add(l);
      FX.tracers.push({ l, life: 0 });
    }
    FX.ti = 0;
    FX.light = new T.PointLight(0xffb060, 0, 14, 2);
    FX.light.position.set(0, -10, 0);
    scene.add(FX.light);
    FX.lightT = 0;
  };
  FX.tracer = function (ax, ay, az, bx, by, bz) {
    const t = FX.tracers[FX.ti]; FX.ti = (FX.ti + 1) % FX.tracers.length;
    const a = t.l.geometry.attributes.position.array;
    a[0] = ax; a[1] = ay; a[2] = az; a[3] = bx; a[4] = by; a[5] = bz;
    t.l.geometry.attributes.position.needsUpdate = true;
    t.life = 0.07; t.l.material.opacity = 0.9;
  };
  FX.flash = function (x, y, z, power = 1) {
    FX.light.position.set(x, y, z);
    FX.light.intensity = Math.max(FX.light.intensity, 40 * power);
    FX.lightT = 0.05 + 0.05 * power;
  };
  FX.spark = function (x, y, z, n = 6) { FX.sparkP.emit(x, y, z, n, 3, 3, 0.3); };
  FX.boom = function (x, z) {
    FX.flash(x, 2, z, 8); FX.lightT = 0.35;
    FX.fire.emit(x, 1, z, 60, 6, 7, 1.1);
    FX.sparkP.emit(x, 1, z, 40, 14, 9, 0.8);
  };
  FX.update = function (dt) {
    FX.smoke.update(dt); FX.sparkP.update(dt); FX.fire.update(dt);
    for (const t of FX.tracers) {
      if (t.life > 0) { t.life -= dt; t.l.material.opacity = Math.max(0, t.life / 0.07) * 0.9; }
    }
    if (FX.lightT > 0) { FX.lightT -= dt; if (FX.lightT <= 0) FX.light.intensity = 0; }
    else FX.light.intensity *= 0.5;
  };
})();
