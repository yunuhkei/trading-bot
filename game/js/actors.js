'use strict';
// Actors: people (peds, cops, Saints), cars, AI, and hit effects.
(function () {
  const T = THREE, W = G.world;
  const A = (G.actors = {});
  G.chars = [];
  G.cars = [];

  const mats = {};
  const mat = (hex) => mats[hex] || (mats[hex] = new T.MeshLambertMaterial({ color: hex }));
  const basic = (hex) => mats['b' + hex] || (mats['b' + hex] = new T.MeshBasicMaterial({ color: hex }));
  const geo = {
    leg: new T.BoxGeometry(0.2, 0.86, 0.22).translate(0, -0.43, 0),
    arm: new T.BoxGeometry(0.14, 0.66, 0.15).translate(0, -0.33, 0),
    hand: new T.BoxGeometry(0.11, 0.12, 0.12).translate(0, -0.71, 0),
    torso: new T.BoxGeometry(0.5, 0.68, 0.28),
    coat: new T.BoxGeometry(0.55, 1.06, 0.32),
    head: new T.BoxGeometry(0.25, 0.28, 0.26),
    hair: new T.BoxGeometry(0.27, 0.08, 0.28),
    hood: new T.BoxGeometry(0.31, 0.33, 0.25),
    cap: new T.BoxGeometry(0.28, 0.08, 0.29),
    brim: new T.BoxGeometry(0.27, 0.03, 0.12),
    mask: new T.BoxGeometry(0.23, 0.26, 0.03),
    eye: new T.BoxGeometry(0.05, 0.03, 0.01),
    halo: new T.TorusGeometry(0.2, 0.022, 6, 18),
    badge: new T.BoxGeometry(0.07, 0.07, 0.02),
    gun: new T.BoxGeometry(0.06, 0.28, 0.1).translate(0, -0.84, 0.04),
    pool: new T.CircleGeometry(1, 14).rotateX(-Math.PI / 2),
  };
  const poolMat = new T.MeshBasicMaterial({ color: 0x3e0508, transparent: true, opacity: 0.92, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 });
  const BURNT = new T.MeshLambertMaterial({ color: 0x111111 });

  const PED_TOPS = ['#2b2f36', '#3b2f2a', '#4a4038', '#22303a', '#523233', '#39402f', '#6b5f50', '#1e1e22', '#5a5040', '#30283a', '#5c3b2b', '#3e4a52'];
  const PED_PANTS = ['#16171b', '#22252b', '#2c2a26', '#1d2430', '#35302a'];
  const SKINS = ['#8d5a3b', '#c08a63', '#e0b18f', '#5a3a28', '#a8714f', '#d49b78', '#6e4630'];
  const HAIR = ['#120e0b', '#2a1d14', '#3a3a3a', '#5a4630', '#1a1a1a', '#6a6a6a'];

  function outfit(kind) {
    switch (kind) {
      case 'player': return { shirt: '#3b2b20', long: true, pants: '#18191d', skin: '#a8714f', hair: '#1a1410', gun: true };
      case 'cop': return { shirt: '#1c2a4d', pants: '#121829', skin: G.pick(SKINS), cap: '#0d0f14', gun: true, badge: true };
      case 'saint': return { shirt: '#141417', long: true, pants: '#0c0c0e', skin: '#cfc9bb', hood: '#0e0e10', mask: true, halo: true, gun: true };
      case 'guard': return { shirt: '#3c4234', pants: '#2a2d25', skin: G.pick(SKINS), cap: '#22251e' };
      case 'mars': return { shirt: '#5a1f2e', pants: '#1d1b22', skin: '#9a6446', hair: '#0e0b0a', tinHalo: true };
      default: {
        const long = Math.random() < 0.35;
        return {
          shirt: G.pick(PED_TOPS), long, pants: G.pick(PED_PANTS), skin: G.pick(SKINS),
          hood: Math.random() < 0.2 ? G.pick(PED_TOPS) : null, cap: Math.random() < 0.12 ? '#1a1a1a' : null, hair: G.pick(HAIR),
        };
      }
    }
  }

  function buildHuman(o) {
    const g = new T.Group(); g.rotation.order = 'YXZ';
    const body = new T.Group(); g.add(body);
    const legL = new T.Group(); legL.position.set(0.12, 0.9, 0); legL.add(new T.Mesh(geo.leg, mat(o.pants)));
    const legR = new T.Group(); legR.position.set(-0.12, 0.9, 0); legR.add(new T.Mesh(geo.leg, mat(o.pants)));
    body.add(legL, legR);
    const torso = new T.Mesh(o.long ? geo.coat : geo.torso, mat(o.shirt));
    torso.position.y = o.long ? 1.06 : 1.24;
    body.add(torso);
    const armL = new T.Group(); armL.position.set(0.33, 1.52, 0);
    const armR = new T.Group(); armR.position.set(-0.33, 1.52, 0);
    for (const a of [armL, armR]) { a.add(new T.Mesh(geo.arm, mat(o.shirt))); a.add(new T.Mesh(geo.hand, mat(o.skin))); }
    if (o.gun) armR.add(new T.Mesh(geo.gun, mat('#0b0b0c')));
    body.add(armL, armR);
    const head = new T.Mesh(geo.head, mat(o.skin)); head.position.y = 1.74;
    body.add(head);
    if (o.hair && !o.hood && !o.cap) { const h = new T.Mesh(geo.hair, mat(o.hair)); h.position.y = 1.9; body.add(h); }
    if (o.hood) { const h = new T.Mesh(geo.hood, mat(o.hood)); h.position.set(0, 1.77, -0.045); body.add(h); }
    if (o.cap) {
      const c = new T.Mesh(geo.cap, mat(o.cap)); c.position.y = 1.9;
      const b = new T.Mesh(geo.brim, mat(o.cap)); b.position.set(0, 1.87, 0.18);
      body.add(c, b);
    }
    if (o.mask) {
      const m = new T.Mesh(geo.mask, basic('#b9b2a2')); m.position.set(0, 1.74, 0.14);
      const e1 = new T.Mesh(geo.eye, basic('#000000')); e1.position.set(0.055, 1.78, 0.156);
      const e2 = new T.Mesh(geo.eye, basic('#000000')); e2.position.set(-0.055, 1.78, 0.156);
      body.add(m, e1, e2);
    }
    if (o.halo) { const h = new T.Mesh(geo.halo, basic('#efe4c2')); h.rotation.x = Math.PI / 2; h.position.y = 2.06; body.add(h); }
    if (o.tinHalo) { const h = new T.Mesh(geo.halo, mat('#8a8a86')); h.rotation.x = Math.PI / 2 - 0.3; h.position.set(0, 1.5, 0.04); h.scale.setScalar(0.9); body.add(h); }
    if (o.badge) { const b = new T.Mesh(geo.badge, basic('#c9a24a')); b.position.set(0.12, 1.42, 0.145); body.add(b); }
    return { group: g, body, legL, legR, armL, armR, head, torso };
  }

  A.spawn = function (kind, x, z, opts = {}) {
    const parts = buildHuman(outfit(kind));
    G.scene.add(parts.group);
    const hp = kind === 'saint' ? 110 : kind === 'cop' ? 90 : kind === 'player' ? 100 : 40;
    const c = {
      kind, parts, mesh: parts.group, x, z, rot: opts.rot !== undefined ? opts.rot : Math.random() * Math.PI * 2,
      hp, maxHp: hp, alive: true, deadT: 0, phase: Math.random() * 6,
      hostile: !!opts.hostile, mission: !!opts.mission, persistent: !!opts.persistent,
      fireCD: G.R(0.8, 1.6), los: false, losT: Math.random() * 0.3, navT: 0, nav: null, strafeT: 0, strafeDir: 0,
      range: kind === 'cop' ? 22 : 18, fleeT: 0, tx: 0, tz: 0, walk: G.R(1.0, 1.5), pool: null, fvx: 0, fvz: 0, fling: 0,
      born: G.time || 0,
    };
    if (kind === 'ped') {
      const r = opts.ring || W.nearestRing(x, z);
      c.ri = r.i; c.rj = r.j; c.rs = r.s; c.rdir = Math.random() < 0.5 ? 1 : -1;
    }
    c.mesh.position.set(x, W.groundY(x, z), z);
    c.mesh.rotation.y = c.rot;
    if (opts.dead) {
      c.alive = false; c.prop = true; c.deadT = 5;
      if (opts.pose === 'sit') poseSit(c); else poseDead(c, 1);
      addPool(c, opts.pose === 'sit' ? 0.9 : 1.15, opts.pose === 'sit' ? 0.35 : -0.9);
    }
    if (kind !== 'player') G.chars.push(c);
    return c;
  };

  A.remove = function (c) {
    G.scene.remove(c.mesh);
    if (c.pool) G.scene.remove(c.pool);
    const k = G.chars.indexOf(c);
    if (k >= 0) G.chars.splice(k, 1);
  };

  function addPool(c, size, back) {
    const p = new T.Mesh(geo.pool, poolMat);
    const fx = Math.sin(c.rot), fz = Math.cos(c.rot);
    p.position.set(c.x + fx * back, W.groundY(c.x, c.z) + 0.02, c.z + fz * back);
    p.scale.setScalar(size);
    p.userData.target = size;
    G.scene.add(p);
    c.pool = p;
  }

  function poseDead(c, t) {
    const p = c.parts, e = t * t;
    c.mesh.rotation.x = (-Math.PI / 2) * e;
    c.mesh.position.y = W.groundY(c.x, c.z) + 0.14 * e;
    p.legL.rotation.x = 0.25 * e; p.legR.rotation.x = -0.1 * e;
    p.armL.rotation.x = -0.3 * e; p.armR.rotation.x = -0.6 * e;
    p.armL.rotation.z = 1.1 * e; p.armR.rotation.z = -0.9 * e;
    p.body.position.y = 0;
  }
  function poseSit(c) {
    const p = c.parts;
    c.mesh.rotation.x = -0.28;
    p.body.position.y = -0.72;
    p.body.position.z = -0.1;
    p.legL.rotation.x = -1.45; p.legR.rotation.x = -1.35;
    p.armL.rotation.x = -0.2; p.armR.rotation.x = -0.5; p.armR.rotation.z = -0.25;
    p.head.rotation.x = 0.55; p.head.rotation.z = 0.25;
  }
  A.poseDead = poseDead;

  A.animate = function (c, dt, speed, aiming) {
    const p = c.parts;
    c.phase += dt * Math.max(speed, 0.0) * 2.7;
    const amp = Math.min(1, speed / 3) * 0.75;
    const s = Math.sin(c.phase) * amp;
    p.legL.rotation.x = s; p.legR.rotation.x = -s;
    if (aiming) {
      p.armR.rotation.x = -1.5; p.armR.rotation.z = 0;
      p.armL.rotation.x = -1.3; p.armL.rotation.z = -0.4;
    } else {
      p.armL.rotation.x = -s * 0.8; p.armR.rotation.x = s * 0.8;
      p.armL.rotation.z = 0; p.armR.rotation.z = 0;
    }
    p.body.position.y = Math.abs(Math.cos(c.phase)) * 0.06 * amp;
  };

  A.kill = function (c, fromX, fromZ) {
    c.alive = false; c.deadT = 0; c.hp = 0; c.diedAt = G.time;
    if (fromX !== undefined) c.rot = Math.atan2(fromX - c.x, fromZ - c.z);
    c.mesh.rotation.y = c.rot;
  };

  A.updateDead = function (c, dt) {
    if (c.prop) return;
    c.deadT += dt;
    if (c.fling > 0) {
      c.fling -= dt;
      c.x += c.fvx * dt; c.z += c.fvz * dt;
      c.fvx *= 1 - 2.5 * dt; c.fvz *= 1 - 2.5 * dt;
      W.collide(c, 0.3);
    }
    if (c.deadT < 0.7 || c.fling > 0) {
      poseDead(c, Math.min(1, c.deadT / 0.45));
      c.mesh.position.x = c.x; c.mesh.position.z = c.z;
    }
    if (!c.pool && c.deadT > 0.6 && c.fling <= 0) { addPool(c, 0.1, -0.9); c.pool.userData.target = G.R(0.9, 1.4); }
    if (c.pool && c.pool.scale.x < c.pool.userData.target) c.pool.scale.setScalar(Math.min(c.pool.userData.target, c.pool.scale.x + dt * 0.3));
  };

  function moveChar(c, vx, vz, dt) {
    c.x += vx * dt; c.z += vz * dt;
    W.collide(c, 0.35);
    A.pushFromCars(c, 0.35);
  }
  function place(c) {
    c.mesh.position.set(c.x, W.groundY(c.x, c.z), c.z);
    c.mesh.rotation.y = c.rot;
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
      if (c.fleeT <= 0) { const r = W.nearestRing(c.x, c.z); c.ri = r.i; c.rj = r.j; c.rs = r.s; }
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
    A.animate(c, dt, speed, false);
    place(c);
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
      A.animate(c, dt, speed, false); place(c);
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
      if (!c.los) {
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
    A.animate(c, dt, speed, aiming);
    place(c);
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
      if (!c.alive) { A.updateDead(c, dt); continue; }
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
    g.position.set(x, 0, z); g.rotation.y = heading;
    G.scene.add(g);
    const car = {
      mesh: g, x, z, heading, speed: 0, steer: 0, hp: opts.hp || 100, cop, van, driver: null, wheels, parts, beam,
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
    for (const car of G.cars) updateCar(car, dt, car.driver === G.player ? input : null);
  };

  function updateCar(car, dt, ctrl) {
    if (car.wrecked) {
      car.burnT -= dt;
      if (car.burnT > 0 && Math.random() < dt * 30) G.fx.fire.emit(car.x + G.R(-0.8, 0.8), 1.2, car.z + G.R(-1.5, 1.5), 1, 0.4, 1.5, 0.9);
      return;
    }
    if (ctrl) {
      const thr = ctrl.my;
      if (thr > 0.05) {
        if (car.speed < -0.5) car.speed += 30 * thr * dt;
        else car.speed += 14 * thr * dt * (1 - Math.max(0, car.speed) / 31);
      } else if (thr < -0.05) {
        if (car.speed > 0.5) car.speed += 28 * thr * dt;
        else car.speed = Math.max(-9, car.speed + 9 * thr * dt);
      } else car.speed *= 1 - 0.55 * dt;
      if (ctrl.brake) car.speed *= 1 - 3.2 * dt;
      car.steer = G.lerp(car.steer, ctrl.mx, Math.min(1, dt * 6));
      const sp = Math.abs(car.speed);
      const rate = car.steer * 2.0 * Math.min(1, sp / 7) / (1 + sp / 28) * (ctrl.brake ? 1.5 : 1);
      car.heading -= rate * Math.sign(car.speed) * dt;
    } else {
      car.speed *= 1 - 1.6 * dt;
      if (Math.abs(car.speed) < 0.05) car.speed = 0;
      car.steer *= 1 - 3 * dt;
    }
    const fx = Math.sin(car.heading), fz = Math.cos(car.heading);
    if (car.speed !== 0) {
      car.x += fx * car.speed * dt; car.z += fz * car.speed * dt;
      // buildings: two circles along the body
      let bumped = false;
      for (const o of [car.hl - 1.05, -(car.hl - 1.05)]) {
        const p = { x: car.x + fx * o, z: car.z + fz * o };
        const px = p.x, pz = p.z;
        if (W.collide(p, car.hw + 0.12)) { car.x += p.x - px; car.z += p.z - pz; bumped = true; }
      }
      if (bumped) {
        const sp = Math.abs(car.speed);
        if (sp > 4) {
          if (car.driver) { G.shake(Math.min(0.8, sp / 25)); G.audio.thud(Math.min(1, sp / 20)); }
          if (sp > 9) A.damageCar(car, sp * 1.4);
          car.speed *= -0.28;
        } else car.speed *= 0.6;
      }
      // other cars
      for (const o of G.cars) {
        if (o === car) continue;
        const dx = o.x - car.x, dz = o.z - car.z, d2 = dx * dx + dz * dz;
        if (d2 > 30) continue;
        const ofx = Math.sin(o.heading), ofz = Math.cos(o.heading);
        for (const a of [car.hl - 1.05, -(car.hl - 1.05)]) {
          for (const b of [o.hl - 1.05, -(o.hl - 1.05)]) {
            const ax = car.x + fx * a, az = car.z + fz * a, bx = o.x + ofx * b, bz = o.z + ofz * b;
            const ex = bx - ax, ez = bz - az, d = Math.hypot(ex, ez), m = car.hw + o.hw + 0.1;
            if (d < m && d > 1e-4) {
              const push = (m - d) / d * 0.5;
              car.x -= ex * push; car.z -= ez * push; o.x += ex * push; o.z += ez * push;
              const sp = Math.abs(car.speed);
              if (sp > 3) {
                o.speed += car.speed * 0.35 * (ofx * fx + ofz * fz);
                if (car.driver) { G.shake(Math.min(0.6, sp / 30)); G.audio.thud(Math.min(1, sp / 25)); }
                if (sp > 9) { A.damageCar(car, sp * 0.8); A.damageCar(o, sp * 1.2); }
                car.speed *= 0.55;
              }
            }
          }
        }
        o.mesh.position.set(o.x, 0, o.z);
      }
      // people
      const sp = Math.abs(car.speed);
      for (const c of G.chars) {
        if (!c.alive) continue;
        const dx = c.x - car.x, dz = c.z - car.z;
        if (dx * dx + dz * dz > 12) continue;
        const lz = dx * fx + dz * fz, lx = dx * fz - dz * fx;
        if (Math.abs(lx) < car.hw + 0.3 && Math.abs(lz) < car.hl + 0.3) {
          if (sp > 5) {
            G.damageChar(c, 30 + sp * 6, car.x - fx * 3, car.z - fz * 3, car.driver === G.player);
            if (!c.alive) { c.fling = 0.6; c.fvx = fx * car.speed * 0.7 + G.R(-2, 2); c.fvz = fz * car.speed * 0.7 + G.R(-2, 2); }
            G.audio.thud(0.6);
            car.speed *= 0.9;
          } else A.pushFromCars(c, 0.35);
        }
      }
    }
    car.mesh.position.set(car.x, 0, car.z);
    car.mesh.rotation.y = car.heading;
    car.mesh.rotation.z = -car.steer * Math.min(1, Math.abs(car.speed) / 25) * 0.05;
    const spin = car.speed * dt / 0.36;
    for (const w of car.wheels) w.rotation.x += spin;
  }

  A.damageCar = function (car, amt) {
    if (car.wrecked) return;
    car.hp -= amt;
    if (car.hp <= 0) A.explode(car);
  };

  A.explode = function (car) {
    car.wrecked = true; car.hp = 0; car.speed *= 0.3; car.burnT = 25; car.sirenOn = false;
    car.mesh.traverse((m) => { if (m.isMesh && m !== car.beam) m.material = BURNT; });
    car.beam.visible = false;
    G.fx.boom(car.x, car.z);
    G.audio.boom();
    G.shake(1);
    for (const c of G.chars) {
      if (!c.alive) continue;
      const d = Math.hypot(c.x - car.x, c.z - car.z);
      if (d < 6) {
        G.damageChar(c, 200 * (1 - d / 6) + 30, car.x, car.z, car.lastDriver === G.player);
        if (!c.alive) { const l = d || 1; c.fling = 0.5; c.fvx = (c.x - car.x) / l * 9; c.fvz = (c.z - car.z) / l * 9; }
      }
    }
    const pl = G.player;
    if (pl.car === car) { G.exitCar(true); G.damagePlayer(55, car.x, car.z, true); }
    else {
      const d = Math.hypot(pl.x - car.x, pl.z - car.z);
      if (d < 6) G.damagePlayer(70 * (1 - d / 6), car.x, car.z, true);
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
    FX.bloodP = new Particles(scene, 260, 0x6a0509, 0.14, false, 1);
    FX.sparkP = new Particles(scene, 120, 0xffc070, 0.16, true, 0.6);
    FX.fire = new Particles(scene, 220, 0xff6a1a, 1.2, true, -0.2);
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
  FX.blood = function (x, y, z, fromX, fromZ) {
    let dx = x - fromX, dz = z - fromZ; const l = Math.hypot(dx, dz) || 1; dx /= l; dz /= l;
    FX.bloodP.emit(x, y, z, 10, 1.6, 2.2, 0.9, dx, dz, 2.6);
  };
  FX.spark = function (x, y, z, n = 6) { FX.sparkP.emit(x, y, z, n, 3, 3, 0.3); };
  FX.boom = function (x, z) {
    FX.flash(x, 2, z, 8); FX.lightT = 0.35;
    FX.fire.emit(x, 1, z, 60, 6, 7, 1.1);
    FX.sparkP.emit(x, 1, z, 40, 14, 9, 0.8);
  };
  FX.update = function (dt) {
    FX.bloodP.update(dt); FX.sparkP.update(dt); FX.fire.update(dt);
    for (const t of FX.tracers) {
      if (t.life > 0) { t.life -= dt; t.l.material.opacity = Math.max(0, t.life / 0.07) * 0.9; }
    }
    if (FX.lightT > 0) { FX.lightT -= dt; if (FX.lightT <= 0) FX.light.intensity = 0; }
    else FX.light.intensity *= 0.5;
  };
})();
