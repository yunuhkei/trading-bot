'use strict';
// Traffic: civilian drivers on the city grid and the island's roads, and police who drive to you.
(function () {
  const W = G.world, A = G.actors;
  const T = (G.traffic = {});
  const NB = W.NB, LANE = 3.5, CLANE = 2.8;

  // ---------------------------------------------------------------- city street graph
  const node = (k, m) => ({ k, m, x: W.roadLine(k), z: W.roadLine(m) });
  function edgeOK(k1, m1, k2, m2) {
    if (k2 < 0 || m2 < 0 || k2 > NB || m2 > NB) return false;
    if (m1 === m2) { const k = Math.min(k1, k2); return W.isActive(k, m1 - 1) || W.isActive(k, m1); } // east-west street
    const m = Math.min(m1, m2); return W.isActive(k1 - 1, m) || W.isActive(k1, m); // north-south street
  }
  function neighbors(n) {
    const out = [];
    for (const [a, b] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (edgeOK(n.k, n.m, n.k + a, n.m + b)) out.push(node(n.k + a, n.m + b));
    return out;
  }
  function laneLine(from, to) {
    const dx = to.x - from.x, dz = to.z - from.z, len = Math.hypot(dx, dz) || 1;
    const ux = dx / len, uz = dz / len, rx = -uz, rz = ux;
    return { x0: from.x + rx * LANE, z0: from.z + rz * LANE, ux, uz, len };
  }
  function pickNext(ai, car, chase) {
    const opts = neighbors(ai.to).filter((n) => !(n.k === ai.from.k && n.m === ai.from.m));
    const list = opts.length ? opts : neighbors(ai.to);
    if (!list.length) return null;
    if (chase) {
      const p = G.player;
      list.sort((a, b) => Math.hypot(a.x - p.x, a.z - p.z) - Math.hypot(b.x - p.x, b.z - p.z));
      return list[0];
    }
    return G.pick(list);
  }

  // ---------------------------------------------------------------- spawning
  function farFromCars(x, z) { return !G.cars.some((c) => Math.hypot(c.x - x, c.z - z) < 9); }
  function spawnCity(rmin, rmax, opts) {
    const p = G.player;
    const k0 = W.roadIndex(p.x), m0 = W.roadIndex(p.z);
    for (let tries = 0; tries < 30; tries++) {
      const from = node(G.clamp(k0 + ((Math.random() * 7) | 0) - 3, 0, NB), G.clamp(m0 + ((Math.random() * 7) | 0) - 3, 0, NB));
      const ns = neighbors(from);
      if (!ns.length) continue;
      const to = G.pick(ns), L = laneLine(from, to), s = G.R(10, L.len - 14);
      const x = L.x0 + L.ux * s, z = L.z0 + L.uz * s, d = Math.hypot(x - p.x, z - p.z);
      if (d < rmin || d > rmax || !farFromCars(x, z)) continue;
      const car = A.spawnCar(x, z, Math.atan2(L.ux, L.uz), Object.assign({ lights: true }, opts));
      car.ai = { mode: 'city', from, to, ctrl: { gas: false, brakeIn: false, handbrake: false, steer: 0 }, stuckT: 0, panicT: 0, honkT: 0 };
      return car;
    }
    return null;
  }
  function spawnCountry(rmin, rmax, opts) {
    const p = G.player;
    for (let tries = 0; tries < 40; tries++) {
      const road = G.pick(W.roads), idx = (Math.random() * road.pts.length) | 0, q = road.pts[idx];
      if (q.lock) continue;
      const d = Math.hypot(q.x - p.x, q.z - p.z);
      if (d < rmin || d > rmax) continue;
      const dir = Math.random() < 0.5 ? 1 : -1, tx = q.tx * dir, tz = q.tz * dir;
      const x = q.x - tz * CLANE, z = q.z + tx * CLANE;
      if (!farFromCars(x, z)) continue;
      const car = A.spawnCar(x, z, Math.atan2(tx, tz), Object.assign({ lights: true }, opts));
      car.ai = { mode: 'road', road, idx, dir, ctrl: { gas: false, brakeIn: false, handbrake: false, steer: 0 }, stuckT: 0, panicT: 0, honkT: 0 };
      return car;
    }
    return null;
  }
  T.spawn = function (rmin, rmax, opts) {
    const inCity = W.cityDist(G.player.x, G.player.z) < 90;
    return (inCity ? spawnCity(rmin, rmax, opts) : null) || spawnCountry(rmin, rmax, opts) || (inCity ? null : spawnCity(rmin, rmax, opts));
  };
  // a squad car that drives to you, lights and siren on
  T.spawnCop = function () {
    const car = T.spawn(70, 120, { cop: true });
    if (!car) return null;
    car.sirenOn = true; car.ai.cop = true; car.ai.crew = 2;
    return car;
  };

  // gunfire nearby: drivers panic
  T.alarm = function (x, z, r) {
    for (const car of G.cars) if (car.ai && !car.ai.cop && Math.hypot(car.x - x, car.z - z) < r) car.ai.panicT = G.R(6, 10);
  };

  // dragged out of the driver's seat
  T.carjack = function (car) {
    if (!car.ai) return;
    const crew = car.ai.cop ? car.ai.crew || 1 : 1;
    car.ai = null;
    const lx = Math.cos(car.heading), lz = -Math.sin(car.heading);
    for (let k = 0; k < crew; k++) {
      const s = k ? -1 : 1, x = car.x + lx * s * (car.hw + 1.1), z = car.z + lz * s * (car.hw + 1.1);
      if (car.cop) A.spawn('cop', x, z, { hostile: true, rot: car.heading });
      else { const c = A.spawn('ped', x, z, { rot: car.heading }); if (c) { c.fleeT = 14; c.tx = car.x; c.tz = car.z; } }
    }
    if (car.cop) G.addHeat(1);
  };

  function dismount(car) {
    const crew = car.ai.crew || 2;
    car.ai = null; car.speed = 0;
    const lx = Math.cos(car.heading), lz = -Math.sin(car.heading);
    for (let k = 0; k < crew; k++) {
      const s = k ? -1 : 1;
      A.spawn('cop', car.x + lx * s * (car.hw + 1.1), car.z + lz * s * (car.hw + 1.1), { hostile: true, rot: car.heading });
    }
  }

  // ---------------------------------------------------------------- driving
  function steerTo(car, tx, tz) {
    const want = Math.atan2(tx - car.x, tz - car.z);
    return G.wrapAngle(want - car.heading);
  }
  // anything in the way, within `range` metres ahead?
  function blocked(car, range, ignorePeople) {
    const fx = Math.sin(car.heading), fz = Math.cos(car.heading);
    for (const o of G.cars) {
      if (o === car) continue;
      const dx = o.x - car.x, dz = o.z - car.z, lz = dx * fx + dz * fz;
      if (lz < 1 || lz > range) continue;
      if (Math.abs(dx * fz - dz * fx) < 2.6) return o === (G.player.car) ? 'player' : 'car';
    }
    if (!ignorePeople) {
      const pl = G.player;
      const list = pl.alive && !pl.car ? G.chars.concat([pl]) : G.chars;
      for (const c of list) {
        if (!c.alive) continue;
        const dx = c.x - car.x, dz = c.z - car.z, lz = dx * fx + dz * fz;
        if (lz < 0.5 || lz > range * 0.75) continue;
        if (Math.abs(dx * fz - dz * fx) < 1.9) return 'person';
      }
    }
    return null;
  }

  function think(car, dt) {
    const ai = car.ai, c = ai.ctrl, pl = G.player;
    let tx, tz, want = ai.mode === 'city' ? 10 : 15;
    const chase = ai.cop;
    const dPl = Math.hypot(pl.x - car.x, pl.z - car.z);
    if (chase) {
      want = 21;
      if (G.wanted.level <= 0) { ai.cop = false; car.sirenOn = false; want = 10; }
      else if (dPl < 45 && W.hasLOS(car.x, car.z, pl.x, pl.z)) ai.direct = true;
      else if (dPl > 70) ai.direct = false;
    }
    if (chase && ai.direct) {
      tx = pl.x; tz = pl.z;
      if (!pl.car && dPl < 16 && Math.abs(car.speed) < 6) { dismount(car); return; }
      if (!pl.car) want = G.clamp(dPl - 8, 0, 18);
    } else if (ai.mode === 'city') {
      let L = laneLine(ai.from, ai.to);
      let s = (car.x - L.x0) * L.ux + (car.z - L.z0) * L.uz;
      if (s > L.len - 9) {
        const next = pickNext(ai, car, chase);
        if (next) { ai.from = ai.to; ai.to = next; L = laneLine(ai.from, ai.to); s = (car.x - L.x0) * L.ux + (car.z - L.z0) * L.uz; }
      }
      const ahead = G.clamp(s + 11, 0, L.len);
      tx = L.x0 + L.ux * ahead; tz = L.z0 + L.uz * ahead;
      if (W.cityDist(car.x, car.z) > 30 && chase) ai.direct = true;
    } else {
      const P = ai.road.pts;
      while (true) {
        const q = P[ai.idx];
        if (!q || Math.hypot(q.x - car.x, q.z - car.z) > 9) break;
        ai.idx += ai.dir;
      }
      if (chase) {
        const a = P[G.clamp(ai.idx + 12, 0, P.length - 1)], b = P[G.clamp(ai.idx - 12, 0, P.length - 1)];
        const want2 = Math.hypot(a.x - pl.x, a.z - pl.z) < Math.hypot(b.x - pl.x, b.z - pl.z) ? 1 : -1;
        if (want2 !== ai.dir) { ai.dir = want2; }
      }
      if (ai.idx < 0 || ai.idx >= P.length || P[ai.idx].lock) {
        if (dPl > 80) { car.despawn = true; return; }
        ai.dir = -ai.dir; ai.idx = G.clamp(ai.idx + ai.dir * 2, 0, P.length - 1);
      }
      const q = P[G.clamp(ai.idx + ai.dir * 2, 0, P.length - 1)];
      const ux = q.tx * ai.dir, uz = q.tz * ai.dir;
      tx = q.x - uz * CLANE; tz = q.z + ux * CLANE;
    }
    const diff = steerTo(car, tx, tz);
    want *= G.clamp(1 - Math.abs(diff) * 0.9, 0.35, 1);
    if (ai.panicT > 0) { ai.panicT -= dt; want = 20; }
    const ob = blocked(car, chase ? 9 : 14, ai.panicT > 0 || chase);
    if (ob && !(chase && ob === 'player')) {
      want = 0;
      ai.honkT -= dt;
      if (ai.honkT <= 0 && Math.abs(car.speed) < 1 && dPl < 40) { G.audio.honk && G.audio.honk(G.clamp(1 - dPl / 40, 0, 1)); ai.honkT = G.R(2, 5); }
    }
    // stuck against something: back up and try again
    if (ai.reverseT > 0) {
      ai.reverseT -= dt;
      c.gas = false; c.brakeIn = true; c.handbrake = false; c.steer = diff > 0 ? 1 : -1;
      return;
    }
    if (want > 1 && Math.abs(car.speed) < 0.6 && !ob) { ai.stuckT += dt; if (ai.stuckT > 2.5) { ai.stuckT = 0; ai.reverseT = 1.4; } }
    else ai.stuckT = 0;
    c.steer = G.clamp(-diff * 2.4, -1, 1);
    c.gas = car.speed < want - 0.8;
    c.brakeIn = car.speed > want + 2 && car.speed > 0.6;
    c.handbrake = want === 0 && car.speed < 2;
  }

  // ---------------------------------------------------------------- per frame
  let spawnT = 0;
  T.update = function (dt) {
    const pl = G.player;
    for (let k = G.cars.length - 1; k >= 0; k--) {
      const car = G.cars[k];
      if (!car.ai || car.wrecked || car.driver) continue;
      think(car, dt);
      if (car.despawn) A.removeCar(car);
    }
    spawnT -= dt;
    if (spawnT > 0) return;
    spawnT = 0.8;
    let city = 0, any = 0;
    for (let k = G.cars.length - 1; k >= 0; k--) {
      const car = G.cars[k];
      if (!car.ai || car.ai.cop) continue;
      const d = Math.hypot(car.x - pl.x, car.z - pl.z);
      if (d > 180) { A.removeCar(car); continue; }
      any++;
      if (car.ai.mode === 'city') city++;
    }
    const want = W.cityDist(pl.x, pl.z) < 90 ? (G.qualityLevel === 'low' ? 6 : 10) : 4;
    if (any < want) T.spawn(70, 140);
  };
})();
