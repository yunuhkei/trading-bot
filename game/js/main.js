'use strict';
// Main: renderer, player, combat, wanted level, spawning, camera, HUD, menus.
(function () {
  const T = THREE, W = G.world, A = G.actors, input = G.input;
  const $ = (id) => document.getElementById(id);

  window.addEventListener('error', (e) => {
    const el = $('err');
    if (el) { el.hidden = false; el.textContent = 'Something broke: ' + (e.message || e.error); }
  });

  // ---------------------------------------------------------------- renderer
  const canvas = $('c');
  let renderer;
  try {
    renderer = new T.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
  } catch (e) {
    $('err').hidden = false;
    $('err').textContent = 'This browser could not start WebGL, which the game needs.';
    return;
  }
  // the Kill House gunplay test by default; #island plays the story on the island
  G.MODE = location.hash === '#island' ? 'island' : 'range';
  const RANGE = G.MODE === 'range';
  if (RANGE) { renderer.shadowMap.enabled = true; renderer.shadowMap.type = T.PCFSoftShadowMap; }
  const scene = (G.scene = new T.Scene());
  const FOG = 0x182030;
  scene.background = new T.Color(FOG);
  scene.fog = new T.FogExp2(FOG, 0.012);
  const camera = (G.camera = new T.PerspectiveCamera(62, 1, 0.1, 1700));

  G.time = 0; G.running = false; G.cardMode = false; G.paused = false;
  G.stats = { start: 0, kills: 0, civs: 0, cops: 0, saints: 0 };
  G.wanted = { level: 0, lastSeen: 0 };
  G.quality = G.store.get('quality', 'auto');
  G.qualityLevel = G.quality === 'low' ? 'low' : 'high';
  G.maxPeds = 22;

  function resize() {
    const w = window.innerWidth, h = window.innerHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.fov = w < h ? 75 : 62;
    camera.updateProjectionMatrix();
  }
  function applyQuality() {
    const low = G.qualityLevel === 'low';
    renderer.setPixelRatio(low ? 1 : Math.min(window.devicePixelRatio || 1, 1.6));
    G.maxPeds = low ? 13 : 22;
    W.setQuality(low);
    resize();
    const b = $('qBtn'); if (b) b.textContent = 'Graphics: ' + (low ? 'Low' : 'High');
  }
  window.addEventListener('resize', resize);

  // ---------------------------------------------------------------- shake
  let shakeAmt = 0;
  G.shake = (a) => { shakeAmt = Math.max(shakeAmt, a); };

  // ---------------------------------------------------------------- player
  let player, camYaw = -2.4, camPitch = 0.32, lookIdle = 0, aimTarget = null, deathT = 0;

  function makePlayer() {
    player = G.player = A.spawn('player', G.story.START.x, G.story.START.z, { rot: -2.4 });
    Object.assign(player, { hp: 100, armor: 0, reloadT: 0, fireCD: 0, car: null, lastHurt: -99, aimHold: 0, moving: 0, punchT: 0, bloom: 0, aimMode: false, crouch: false });
  }

  G.resetPlayer = function (x, z, rot) {
    if (player.car) G.exitCar(true);
    player.x = x; player.z = z; player.rot = rot; camYaw = rot; camPitch = 0.3;
    player.hp = 100; player.alive = true; player.reloadT = 0; G.inv.mag.pistol = 12;
    if (!G.inv.hasAmmo(G.inv.cur)) G.inv.cur = 'pistol';
    G.body.revive(player);
    setDriving(false);
    deathT = 0;
    $('death').hidden = true;
    G.resetInput();
  };

  function nearestCar(r) {
    let best = null, bd = r;
    for (const car of G.cars) {
      if (car.wrecked) continue;
      const d = Math.hypot(car.x - player.x, car.z - player.z);
      if (d < bd) { bd = d; best = car; }
    }
    return best;
  }
  function enterCar(car) {
    if (car.ai) G.traffic.carjack(car);
    player.car = car; car.driver = player; car.lastDriver = player;
    if (!car.lightsOn) A.setLights(car, true);
    G.body.setVisible(player, false);
    setDriving(true);
    car.persistent = true;
    G.hud.say(car.cop ? 'A squad car. They will notice.' : '', car.cop ? 3 : 0);
    if (car.cop) G.addHeat(1);
  }
  G.exitCar = function (force) {
    const car = player.car;
    if (!car) return;
    if (!force && Math.abs(car.speed) > 8) return;
    const lx = Math.cos(car.heading), lz = -Math.sin(car.heading);
    let placed = false;
    for (const s of [1, -1]) {
      const x = car.x + lx * s * (car.hw + 0.9), z = car.z + lz * s * (car.hw + 0.9);
      if (!W.inBuilding(x, 1, z, 0.4)) { player.x = x; player.z = z; placed = true; break; }
    }
    if (!placed) { player.x = car.x; player.z = car.z; W.collide(player, 0.4); }
    car.driver = null; player.car = null;
    G.body.setVisible(player, true);
    G.body.revive(player, true);
    setDriving(false);
    player.rot = car.heading;
  };

  // the gun in your hands right now (in a car only one-handed guns work)
  function activeWeapon() {
    let k = G.inv.cur;
    if (player.car && !G.WEAPONS[k].drive) k = G.inv.owned.smg && G.inv.hasAmmo('smg') ? 'smg' : 'pistol';
    return k;
  }
  function startReload(k) {
    k = k || activeWeapon();
    const w = G.WEAPONS[k], inv = G.inv;
    if (w.melee || player.reloadT > 0 || inv.mag[k] >= w.mag || inv.reserve[k] <= 0) return false;
    player.reloadT = w.reload; player.reloadK = k;
    G.audio.click();
    return true;
  }
  function tickReload(dt) {
    if (player.reloadT <= 0) return;
    player.reloadT -= dt;
    if (player.reloadT <= 0) {
      const k = player.reloadK, w = G.WEAPONS[k], inv = G.inv;
      const take = Math.min(w.mag - inv.mag[k], inv.reserve[k]);
      inv.mag[k] += take; inv.reserve[k] -= take;
    }
  }
  // pull the trigger: fire, punch, reload, or switch to something that still has bullets
  function tryFire(fromCar) {
    const k = activeWeapon(), w = G.WEAPONS[k], inv = G.inv;
    if (player.fireCD > 0 || player.reloadT > 0) return;
    if (w.melee) { punch(); return; }
    if (inv.mag[k] > 0) { inv.mag[k]--; if (fromCar) driveBy(k); else playerShoot(k); return; }
    if (startReload(k)) return;
    G.audio.click(); player.fireCD = 0.35;
    if (!fromCar) { inv.cycle(1); G.hud.say('Out of ammo.', 1.5); }
  }
  function punch() {
    player.fireCD = G.WEAPONS.fists.rate; player.punchT = 0.22; player.aimHold = 0.5;
    const fx = Math.sin(player.rot), fz = Math.cos(player.rot);
    let best = null, bd = G.WEAPONS.fists.range;
    for (const c of G.chars) {
      if (!c.alive) continue;
      const dx = c.x - player.x, dz = c.z - player.z, d = Math.hypot(dx, dz);
      if (d < bd && (dx * fx + dz * fz) / (d || 1) > 0.4) { bd = d; best = c; }
    }
    if (!best) { G.audio.thud(0.15); return; }
    const dx = (best.x - player.x) / (bd || 1), dz = (best.z - player.z) / (bd || 1);
    G.audio.thud(0.6);
    G.shake(0.12);
    best.hp -= G.R(20, 28);
    best.flinch = 1;
    if (best.kind === 'ped') { best.fleeT = 12; best.tx = player.x; best.tz = player.z; }
    if (best.kind === 'cop') G.addHeat(G.wanted.level < 1 ? 1 : 0.2);
    if (best.hp <= 0) G.killChar(best, { kind: 'bullet', dx, dz, power: 5, joint: G.body.J.HEAD }, true);
    else if (Math.random() < 0.3) G.blood.spray(best.x, 1.6, best.z, dx, dz, 0.35, false);
  }

  function computeAim() {
    aimTarget = null;
    if (!player.alive) return;
    const inCar = !!player.car;
    const fx = Math.sin(camYaw), fz = Math.cos(camYaw);
    let best = null, bestS = 1e9;
    for (const c of G.chars) {
      if (!c.alive) continue;
      const dx = c.x - player.x, dz = c.z - player.z, d = Math.hypot(dx, dz);
      if (d > G.WEAPONS[activeWeapon()].aim || d < 0.3) continue;
      const cos = (dx * fx + dz * fz) / d;
      const hostile = c.hostile;
      if (cos < (inCar ? (hostile ? 0.45 : 0.75) : hostile ? 0.84 : 0.94)) continue;
      const ang = Math.acos(Math.min(1, cos));
      const s = ang * 22 + d * (hostile ? 0.45 : 1.4) - (hostile ? 25 : 0);
      if (s < bestS && W.hasLOS(player.x, player.z, c.x, c.z)) { bestS = s; best = c; }
    }
    aimTarget = best;
  }

  function witnesses(r) {
    for (const c of G.chars) {
      if (c.alive && (c.kind === 'ped' || c.kind === 'cop') && Math.hypot(c.x - player.x, c.z - player.z) < r) return true;
    }
    return false;
  }

  // one trigger pull. Aim mode: wherever the crosshair points. Hip fire: at the auto-aim target.
  const HEADJ = G.body.J.HEAD, NECKJ = G.body.J.NECK, PELVJ = G.body.J.PELVIS;
  function shootFrom(muzzle, k, fromCar) {
    const w = G.WEAPONS[k];
    player.fireCD = w.rate; player.aimHold = 0.9; player.recoil = 1;
    let ax, ay, az, spread;
    if (player.aimMode && !fromCar) {
      const p = G.gun.aimPoint(camera, player);
      ax = p.x; ay = p.y; az = p.z;
      spread = w.aimSpread + player.bloom * 0.6 + (player.moving > 0.5 ? w.aimSpread * 1.5 : 0);
    } else if (aimTarget && aimTarget.body) {
      const j = aimTarget.body.j, d = Math.hypot(aimTarget.x - muzzle.x, aimTarget.z - muzzle.z);
      const head = Math.random() < (d < 8 ? 0.16 : 0.08);
      if (head) { ax = j[HEADJ * 3]; ay = j[HEADJ * 3 + 1]; az = j[HEADJ * 3 + 2]; }
      else { ax = (j[NECKJ * 3] + j[PELVJ * 3]) / 2; ay = (j[NECKJ * 3 + 1] + j[PELVJ * 3 + 1]) / 2; az = (j[NECKJ * 3 + 2] + j[PELVJ * 3 + 2]) / 2; }
      // hip fire: auto-aim lands by the gun's accuracy, otherwise it's a near miss
      if (Math.random() > w.acc(d) * (fromCar ? 0.85 : 1)) { const a = Math.random() * 6.28; ax += Math.cos(a) * G.R(0.35, 0.7); az += Math.sin(a) * G.R(0.35, 0.7); ay += G.R(-0.3, 0.4); }
      spread = w.pellets > 1 ? w.spread : w.aimSpread;
    } else {
      ax = muzzle.x + Math.sin(camYaw) * 40; ay = muzzle.y - 0.2; az = muzzle.z + Math.cos(camYaw) * 40;
      spread = w.spread + player.bloom;
    }
    const res = G.gun.fire({ k, w, shooter: player, muzzle, ax, ay, az, spread, pump: true });
    if (res.anyHit) G.gun.hitmark(res.killed, res.head);
    if (res.head && res.killed) G.hud.toast('Headshot');
    // recoil: the view kicks up, spread blooms
    const kick = w.kick * (player.aimMode ? 1 : 0.5) * (player.crouch ? 0.7 : 1);
    recoilPitch += kick; camYaw += (Math.random() - 0.5) * kick * 0.6;
    player.bloom = Math.min(w.bloomMax, player.bloom + w.bloom);
    G.audio.shot(w.vol);
    if (k === 'shotgun' || k === 'rifle') { G.audio.thud(0.5); G.shake(0.14); }
    A.alarm(player.x, player.z, k === 'rifle' ? 70 : 45);
    if (!G.suppressShotHeat && G.wanted.level < 1 && witnesses(25)) G.addHeat(1);
  }
  function playerShoot(k) { shootFrom(G.gun.muzzle(player, k), k, false); }
  // shooting out of the driver's window, toward the target
  function driveBy(k) {
    const car = player.car;
    let tx = aimTarget ? aimTarget.x : car.x + Math.sin(camYaw) * 10, tz = aimTarget ? aimTarget.z : car.z + Math.cos(camYaw) * 10;
    const dx = tx - car.x, dz = tz - car.z, l = Math.hypot(dx, dz) || 1;
    shootFrom({ x: car.x + (dx / l) * 1.3, y: car.y + 1.35, z: car.z + (dz / l) * 1.3, dx: dx / l, dy: 0, dz: dz / l }, k, true);
  }

  // ---------------------------------------------------------------- damage
  G.damageChar = function (c, amt, fx, fz, byPlayer, hit) {
    if (!c.alive) return;
    c.hp -= amt;
    let dx = c.x - fx, dz = c.z - fz;
    const l = Math.hypot(dx, dz) || 1; dx /= l; dz /= l;
    hit = hit || { kind: 'bullet', dx, dz, power: 4 };
    if (hit.kind === 'bullet') {
      G.blood.spray(c.x, hit.y || (hit.head ? 1.66 : 1.25), c.z, hit.dx || dx, hit.dz || dz, hit.head ? 1.3 : 1, hit.head);
      G.body.addBlood(c, hit.head ? 0.5 : 0.3);
      c.flinch = 1;
    } else {
      const sdx = hit.kind === 'car' ? hit.vx : dx, sdz = hit.kind === 'car' ? hit.vz : dz, sl = Math.hypot(sdx, sdz) || 1;
      G.blood.spray(c.x, 1.0, c.z, sdx / sl, sdz / sl, 1.6, false);
      G.body.addBlood(c, 0.7);
    }
    if (c.kind === 'ped') { c.fleeT = 14; c.tx = fx; c.tz = fz; }
    if (c.kind === 'cop' && byPlayer) G.addHeat(G.wanted.level < 2 ? 2 - G.wanted.level : 0.3);
    c.hurtT = 0.6;
    if (c.hp <= 0) G.killChar(c, hit, byPlayer);
    else if (c.hostile) c.fireCD = Math.max(c.fireCD, 0.35);
  };
  G.killChar = function (c, hit, byPlayer) {
    A.kill(c, hit);
    G.loot.drop(c);
    if (!byPlayer) return;
    G.stats.kills++;
    if (c.kind === 'ped') { G.stats.civs++; if (!RANGE) G.addHeat(G.wanted.level < 1 ? 1 : 0.5); }
    else if (c.kind === 'cop') { G.stats.cops++; if (!RANGE) G.addHeat(1); }
    else if (c.kind === 'saint') { G.stats.saints++; G.story.onKill(c); }
    if (RANGE) G.range.onKill(c);
  };
  G.damagePlayer = function (amt, fx, fz, direct, kind) {
    if (!player.alive) return;
    if (player.car && !direct) { A.damageCar(player.car, amt * 0.9); amt *= 0.35; }
    if (player.armor > 0 && kind !== 'blast') {
      const soak = Math.min(player.armor, amt * 0.7);
      player.armor -= soak; amt -= soak;
    }
    player.hp -= amt;
    player.lastHurt = G.time;
    let dx = player.x - fx, dz = player.z - fz;
    const l = Math.hypot(dx, dz) || 1; dx /= l; dz /= l;
    if (!player.car) {
      G.blood.spray(player.x, 1.3, player.z, dx, dz, 0.7, false);
      G.body.addBlood(player, 0.12);
      player.flinch = 0.7;
    }
    G.hud.hurt(Math.min(1, amt / 25));
    G.hud.hitFrom(fx, fz);
    G.shake(0.25);
    if (player.hp <= 0) {
      player.hp = 0; player.alive = false; deathT = 0;
      if (player.car) G.exitCar(true);
      A.kill(player, kind === 'blast' ? { kind: 'blast', dx, dz } : { kind: 'bullet', dx, dz, power: 4.5, joint: G.body.J.NECK });
      G.resetInput();
    }
  };

  // ---------------------------------------------------------------- wanted
  G.addHeat = function (n) {
    if (RANGE) return;
    const w = G.wanted;
    const before = Math.ceil(w.level - 0.01);
    w.level = Math.min(5, Math.max(w.level + n, n > 0 ? 1 : 0));
    w.lastSeen = G.time;
    if (Math.ceil(w.level - 0.01) > before) G.hud.flashStars();
    for (const c of G.chars) if (c.kind === 'cop' && c.alive) c.hostile = true;
  };
  G.setHeat = function (n) {
    G.wanted.level = n; G.wanted.lastSeen = G.time;
    if (n > 0) { for (const c of G.chars) if (c.kind === 'cop' && c.alive) c.hostile = true; }
    else calmCops();
    G.hud.flashStars();
  };
  function calmCops() {
    for (const c of G.chars) if (c.kind === 'cop') { c.hostile = false; c.leaving = true; }
    for (const car of G.cars) if (car.cop) { car.sirenOn = false; if (car.ai) car.ai.cop = false; }
  }
  const MAXCOPS = [0, 2, 4, 6, 8, 10];
  let copT = 0;
  function updateWanted(dt) {
    const w = G.wanted;
    const stars = Math.ceil(w.level - 0.01);
    w.evading = false;
    if (stars <= 0) { w.level = 0; return; }
    let seen = false;
    for (const c of G.chars) {
      if (c.kind !== 'cop' || !c.alive || !c.hostile) continue;
      const d = Math.hypot(c.x - player.x, c.z - player.z);
      if (d < 14 || (d < 48 && c.los)) { seen = true; break; }
    }
    if (!seen) for (const car of G.cars) {
      if (!car.ai || !car.ai.cop) continue;
      const d = Math.hypot(car.x - player.x, car.z - player.z);
      if (d < 18 || (d < 45 && W.hasLOS(car.x, car.z, player.x, player.z))) { seen = true; break; }
    }
    if (seen) w.lastSeen = G.time;
    const since = G.time - w.lastSeen;
    w.evading = since > 2.5;
    if (since > 7 + stars * 2.2) {
      w.level = stars - 1; w.lastSeen = G.time;
      G.hud.flashStars();
      if (w.level <= 0) { w.level = 0; calmCops(); G.hud.say('They lost you.', 2.5); }
    }
    copT -= dt;
    if (copT <= 0 && player.alive) {
      copT = 3.2;
      let n = 0;
      for (const c of G.chars) if (c.kind === 'cop' && c.alive && c.hostile) n++;
      for (const car of G.cars) if (car.ai && car.ai.cop) n += car.ai.crew || 2;
      if (n < MAXCOPS[stars]) G.traffic.spawnCop();
    }
  }

  // ---------------------------------------------------------------- spawning
  let pedT = 0, carT = 0;
  function populate(dt) {
    pedT -= dt; carT -= dt;
    const px = player.x, pz = player.z;
    if (pedT <= 0) {
      pedT = 0.3;
      let peds = 0, dead = 0;
      for (let k = G.chars.length - 1; k >= 0; k--) {
        const c = G.chars[k];
        const d = Math.hypot(c.x - px, c.z - pz);
        if (!c.persistent && !c.mission) {
          const far = c.kind === 'cop' ? (c.hostile ? 140 : 70) : 125;
          if (d > far) { A.remove(c); continue; }
        }
        if (c.kind === 'ped') { if (c.alive) peds++; else dead++; }
      }
      if (dead > 26) {
        const old = G.chars.filter((c) => !c.alive && !c.prop).sort((a, b) => a.diedAt - b.diedAt)[0];
        if (old) A.remove(old);
      }
      const dv = Math.hypot(px - W.VIL.x, pz - W.VIL.z);
      if (dv < 230) {
        let locals = 0;
        for (const c of G.chars) if (c.anchor && c.alive) locals++;
        if (locals < 9) { const sp = G.pick(W.villageSpots); A.spawn('local', sp.x, sp.z, { anchor: sp }); }
      }
      if (peds < G.maxPeds) {
        const p = W.randomSidewalkPoint(px, pz, G.running ? 45 : 8, 95);
        if (p) A.spawn('ped', p.x, p.z, { ring: p });
      }
    }
    if (carT <= 0) {
      carT = 1;
      let civ = 0;
      for (let k = G.cars.length - 1; k >= 0; k--) {
        const car = G.cars[k];
        const d = Math.hypot(car.x - px, car.z - pz);
        if (!car.driver && !car.persistent && !car.mission && d > (car.wrecked ? 110 : 165)) { A.removeCar(car); continue; }
        if (!car.cop && !car.wrecked && !car.ai) civ++;
      }
      if (civ < 5) {
        const p = W.randomRoadPoint(px, pz, 55, 115, true);
        if (p && !G.cars.some((c) => Math.hypot(c.x - p.x, c.z - p.z) < 6)) A.spawnCar(p.x, p.z, p.h);
      }
    }
  }

  // ---------------------------------------------------------------- per-frame player
  function updateOnFoot(dt) {
    const fx = Math.sin(camYaw), fz = Math.cos(camYaw), rx = -Math.cos(camYaw), rz = Math.sin(camYaw);
    const mag = Math.min(1, Math.hypot(input.mx, input.my));
    let vx = fx * input.my + rx * input.mx, vz = fz * input.my + rz * input.mx;
    const vl = Math.hypot(vx, vz);
    let speed = 0;
    if (vl > 0.05) { vx /= vl; vz /= vl; speed = input.sprint ? 7.8 : 5.3 * (input.usingTouch ? Math.max(0.3, mag) : 1); }
    player.aimMode = !!input.aim && activeWeapon() !== 'fists';
    if (input.sprint && player.crouch && speed > 0) { G.setCrouch(false); syncToggles(); }
    player.crouch = !!input.crouch;
    if (player.aimMode) aimTarget = null; else computeAim();
    player.aimHold -= dt;
    if (input.fire) player.aimHold = 0.7;
    const aiming = player.aimHold > 0 || player.aimMode;
    if (aiming) speed = Math.min(speed, player.aimMode ? 2.8 : 3.8);
    if (player.crouch) speed = Math.min(speed, 2.2);
    player.bloom = Math.max(0, player.bloom - dt * 0.14);
    player.moving = speed;
    player.x += vx * speed * dt; player.z += vz * speed * dt;
    W.collide(player, 0.36);
    A.pushFromCars(player, 0.36);
    let face = null;
    if (player.aimMode) face = camYaw;
    else if (aiming) face = aimTarget ? Math.atan2(aimTarget.x - player.x, aimTarget.z - player.z) : camYaw;
    else if (speed > 0) face = Math.atan2(vx, vz);
    if (face !== null) player.rot = G.angleLerp(player.rot, face, Math.min(1, dt * (player.aimMode ? 30 : aiming ? 20 : 10)));
    if (player.aimMode) aimAssist(dt);
    player.weaponK = activeWeapon() === 'fists' ? null : activeWeapon();
    player.reloading = player.reloadT > 0;
    G.body.pose(player, dt, speed, aiming || !!player.reloading);

    tickReload(dt);
    if (input.reload) startReload();
    player.fireCD -= dt; player.punchT -= dt;
    if (input.fire) tryFire(false);
    if (input.action) {
      const shop = G.shopAt(player.x, player.z), safe = G.story.safehouseAt(player.x, player.z), car = nearestCar(3.8);
      if (shop) G.openShop(shop);
      else if (safe) G.story.useSafehouse(safe);
      else if (car) enterCar(car);
    }
  }

  function updateDriving(dt) {
    const car = player.car;
    player.x = car.x; player.z = car.z; player.moving = Math.hypot(car.speed, car.slip);
    if (input.action) { G.exitCar(false); return; }
    computeAim();
    tickReload(dt);
    if (input.reload) startReload();
    player.fireCD -= dt;
    if (input.fire) tryFire(true);
  }
  function setDriving(v) {
    G.driving = v;
    document.body.classList.toggle('driving', v);
    G.resetInput();
  }

  // ---------------------------------------------------------------- camera
  const camPos = new T.Vector3();
  let aimBlend = 0, recoilPitch = 0;
  // in aim mode, the crosshair drifts gently onto a nearby enemy (stronger on a touch screen)
  const apv = new T.Vector3();
  function aimAssist(dt) {
    const strength = input.usingTouch ? 1 : 0.35;
    let best = null, bd = 70;
    for (const c of G.chars) {
      if (!c.alive || !c.hostile || !c.body) continue;
      const j = c.body.j, k = G.body.J.NECK;
      apv.set(j[k * 3], j[k * 3 + 1] - 0.1, j[k * 3 + 2]).project(camera);
      if (apv.z > 1) continue;
      const sx = apv.x * window.innerWidth / 2, sy = apv.y * window.innerHeight / 2, d = Math.hypot(sx, sy);
      if (d < bd) { bd = d; best = [sx, sy]; }
    }
    if (!best) return;
    camYaw -= (best[0] / window.innerWidth) * dt * 3.2 * strength;
    camPitch -= (best[1] / window.innerHeight) * dt * 2.4 * strength;
  }
  const fill = new T.PointLight(0xd6dcf2, 34, 22, 1.3);
  scene.add(fill);
  function updateCamera(dt) {
    let px, pz, py, dist;
    const car = player.car;
    if (car) {
      px = car.x; pz = car.z; py = car.y + 1.9; dist = 8.6;
      if (lookIdle > 1.1 && Math.abs(car.speed) > 2) {
        camYaw = G.angleLerp(camYaw, car.heading, Math.min(1, dt * 2.4));
        camPitch = G.lerp(camPitch, 0.26, Math.min(1, dt * 2));
      }
    } else {
      px = player.x; pz = player.z; py = 1.62 + W.groundY(px, pz) - (player.crouch ? 0.42 : 0); dist = 4.3;
      if (!player.alive) { dist = 6.5; camPitch = G.lerp(camPitch, 0.9, Math.min(1, dt * 1.5)); camYaw += dt * 0.25; }
    }
    const fx = Math.sin(camYaw), fz = Math.cos(camYaw), rx = -Math.cos(camYaw), rz = Math.sin(camYaw);
    // aim mode: tight over the right shoulder, looking exactly where the crosshair is
    const aimT = player.aimMode && !car && player.alive ? 1 : 0;
    aimBlend += (aimT - aimBlend) * Math.min(1, dt * 12);
    recoilPitch *= Math.pow(0.0005, dt);
    const sh = car || !player.alive ? 0 : 0.55 + aimBlend * 0.2;
    const ax = px + rx * sh, az = pz + rz * sh;
    const look = camPitch - recoilPitch;
    const cp = Math.cos(look), sp = Math.sin(look);
    const d2 = G.lerp(dist, 2.15, aimBlend);
    const cx = ax - fx * d2 * cp, cy = py + d2 * sp + (car ? 0.6 : G.lerp(0.15, 0.22, aimBlend)), cz = az - fz * d2 * cp;
    // looking down a scope: your own body would block the view
    const scoped = !car && player.alive && aimBlend > 0.6 && !!(G.WEAPONS[activeWeapon()] || {}).zoom;
    if (scoped !== !!player.scoped) { player.scoped = scoped; G.body.setVisible(player, !scoped); }
    const wantFov = (camera.aspect < 1 ? 75 : 62) - aimBlend * ((G.WEAPONS[activeWeapon()] || {}).zoom ? 34 : 16);
    if (Math.abs(camera.fov - wantFov) > 0.05) { camera.fov = wantFov; camera.updateProjectionMatrix(); }
    let tFree = 1;
    for (let k = 1; k <= 12; k++) {
      const t = k / 12;
      if (W.inBuilding(ax + (cx - ax) * t, py + (cy - py) * t, az + (cz - az) * t, 0.3)) { tFree = (k - 1) / 12; break; }
    }
    tFree = Math.max(tFree, 0.12);
    camPos.set(ax + (cx - ax) * tFree, Math.max(0.5, py + (cy - py) * tFree), az + (cz - az) * tFree);
    if (shakeAmt > 0.001) {
      camPos.x += (Math.random() - 0.5) * shakeAmt * 0.5; camPos.y += (Math.random() - 0.5) * shakeAmt * 0.5;
      shakeAmt *= Math.pow(0.02, dt);
    }
    camera.position.copy(camPos);
    if (aimBlend > 0.01) {
      // look along the aim line (pitch included) so the crosshair is honest
      const lp = look - 0.22;
      const tx = ax + fx * 3, ty = py + (car ? 0.1 : 0.05), tz = az + fz * 3;
      const ex = camPos.x + fx * Math.cos(lp) * 10, ey = camPos.y - Math.sin(lp) * 10, ez = camPos.z + fz * Math.cos(lp) * 10;
      camera.lookAt(G.lerp(tx, ex, aimBlend), G.lerp(ty, ey, aimBlend), G.lerp(tz, ez, aimBlend));
    } else camera.lookAt(ax + fx * 3, py + (car ? 0.1 : 0.05), az + fz * 3);
    // soft key light just behind the camera so people read as people, not silhouettes
    fill.position.set(px - fx * 2.5 - rx * 1.5, py + 2.6, pz - fz * 2.5 - rz * 1.5);
  }

  // title-screen camera: a slow drift past the burning wreck
  function titleCamera(t) {
    if (RANGE) {
      const a = t * 0.06;
      camera.position.set(Math.sin(a) * 38, 14, Math.cos(a) * 30);
      camera.lookAt(0, 1, 0);
      return;
    }
    const a = t * 0.05;
    camera.position.set(150 + Math.sin(a) * 16, 4.5 + Math.sin(t * 0.13), -180 + Math.cos(a) * 16);
    camera.lookAt(150, 2.2, -180);
  }

  // ---------------------------------------------------------------- waypoint
  let waypoint = null;
  const beam = new T.Mesh(new T.CylinderGeometry(0.9, 0.9, 70, 12, 1, true),
    new T.MeshBasicMaterial({ color: 0xe8b34a, transparent: true, opacity: 0.22, blending: T.AdditiveBlending, depthWrite: false, side: T.DoubleSide, fog: false }));
  beam.visible = false;
  G.setWaypoint = function (x, z) {
    if (x === null || x === undefined) { waypoint = null; beam.visible = false; return; }
    waypoint = { x, z };
    beam.position.set(x, 35, z); beam.visible = true;
  };

  // ---------------------------------------------------------------- HUD
  const hud = (G.hud = {});
  const el = {
    hp: $('hpFill'), ammo: $('ammo'), wname: $('wname'), money: $('money'), armor: $('armorFill'), armorBar: $('armorBar'), notice: $('notice'), stars: $('stars'), obj: $('objective'), sub: $('subtitle'), toast: $('toast'),
    ret: $('reticle'), arrow: $('wpArrow'), wpDist: $('wpDist'), wp: $('wp'), vig: $('vignette'),
    act: $('btnAct'), fire: $('btnFire'), reload: $('btnReload'), blood: $('bloodScreen'),
    joyBase: $('joyBase'), joyKnob: $('joyKnob'), cards: $('cards'), cardH: $('cardH'), cardT: $('cardT'), cardNext: $('cardNext'),
  };
  for (let k = 0; k < 5; k++) { const s = document.createElement('i'); el.stars.appendChild(s); }
  const starEls = Array.from(el.stars.children);

  hud.objective = (html) => {
    el.obj.innerHTML = html;
    el.obj.hidden = !html;
    el.obj.classList.remove('pulse'); void el.obj.offsetWidth; el.obj.classList.add('pulse');
  };
  let subT = 0;
  hud.say = (text, sec = 4) => {
    if (!text) return;
    el.sub.textContent = text; el.sub.hidden = false; subT = sec;
  };
  let noticeT = 0;
  hud.notice = (text) => { el.notice.textContent = text; el.notice.hidden = false; el.notice.classList.remove('pop'); void el.notice.offsetWidth; el.notice.classList.add('pop'); noticeT = 1.6; };
  let toastT = 0;
  hud.toast = (text) => { el.toast.textContent = text; el.toast.hidden = false; toastT = 1.2; };
  let hurtV = 0;
  const bctx = el.blood.getContext('2d');
  let bloodAlpha = 0;
  hud.hurt = (a) => {
    hurtV = Math.min(1, hurtV + 0.35 + a * 0.4);
    // blood spatters across the screen and slowly fades
    const W2 = el.blood.width = el.blood.width || 640, H2 = el.blood.height = el.blood.height || 360;
    const img = G.body.splatCanvas;
    if (!img) return;
    const n = 1 + (Math.random() * 2) | 0;
    for (let k = 0; k < n; k++) {
      const edge = Math.random() < 0.5;
      const x = edge ? (Math.random() < 0.5 ? 0 : W2) + G.R(-60, 60) : G.R(0, W2), y = edge ? G.R(0, H2) : (Math.random() < 0.5 ? 0 : H2) + G.R(-50, 50);
      const sz = G.R(140, 280) * (0.6 + a);
      bctx.globalAlpha = 0.85;
      bctx.save(); bctx.translate(x, y); bctx.rotate(Math.random() * 6.28);
      bctx.drawImage(img, -sz / 2, -sz / 2, sz, sz);
      bctx.restore();
    }
    bloodAlpha = 1;
  };
  hud.flashStars = () => { el.stars.classList.remove('flash'); void el.stars.offsetWidth; el.stars.classList.add('flash'); };

  // story cards with a typewriter reveal
  let cardList = null, cardIdx = 0, cardDone = null, typed = 0, typeFull = '', typeTimer = 0;
  hud.cards = function (list, done) {
    cardList = list; cardIdx = 0; cardDone = done;
    G.cardMode = true; G.resetInput();
    if (document.pointerLockElement) document.exitPointerLock();
    el.cards.hidden = false;
    showCard();
  };
  function showCard() {
    const c = cardList[cardIdx];
    el.cards.classList.toggle('title', !!c.title);
    el.cardH.textContent = c.h || '';
    el.cardH.hidden = !c.h;
    typeFull = c.t; typed = c.title ? typeFull.length : 0;
    el.cardT.textContent = typeFull.slice(0, typed);
    el.cardNext.classList.toggle('ready', typed >= typeFull.length);
    clearInterval(typeTimer);
    if (typed < typeFull.length) {
      typeTimer = setInterval(() => {
        typed = Math.min(typeFull.length, typed + 2);
        el.cardT.textContent = typeFull.slice(0, typed);
        if (typed >= typeFull.length) { clearInterval(typeTimer); el.cardNext.classList.add('ready'); }
      }, 22);
    }
  }
  function advanceCard() {
    if (!cardList) return;
    if (typed < typeFull.length) {
      typed = typeFull.length; clearInterval(typeTimer);
      el.cardT.textContent = typeFull; el.cardNext.classList.add('ready');
      return;
    }
    cardIdx++;
    if (cardIdx >= cardList.length) {
      el.cards.hidden = true; G.cardMode = false;
      const d = cardDone; cardList = null; cardDone = null;
      G.resetInput();
      if (d) d();
    } else showCard();
  }
  el.cards.addEventListener('pointerup', (e) => { e.preventDefault(); advanceCard(); });
  window.addEventListener('keydown', (e) => {
    if (cardList && (e.code === 'Space' || e.code === 'Enter' || e.code === 'KeyF')) { e.preventDefault(); advanceCard(); }
  });

  // minimap
  const mm = $('minimap'), mctx = mm.getContext('2d');
  const MM = 160; mm.width = MM; mm.height = MM;
  const base = document.createElement('canvas');
  const BK = 0.8;
  function drawBaseMap() { W.drawMap(base, BK); }
  function mapXY(dx, dz, z) {
    const c = Math.cos(camYaw), s = Math.sin(camYaw);
    return [(-dx * c + dz * s) * z, -(dx * s + dz * c) * z];
  }
  function drawMinimap() {
    const z = 1.25, h = MM / 2;
    mctx.setTransform(1, 0, 0, 1, 0, 0);
    mctx.clearRect(0, 0, MM, MM);
    mctx.save();
    mctx.beginPath(); mctx.arc(h, h, h - 2, 0, Math.PI * 2); mctx.clip();
    mctx.fillStyle = '#07090d'; mctx.fillRect(0, 0, MM, MM);
    const c = Math.cos(camYaw), s = Math.sin(camYaw), k = z / BK;
    const a = -c * k, cc = s * k, b = -s * k, d = -c * k;
    const X = (player.x - W.MAP.x0) * BK, Y = (player.z - W.MAP.z0) * BK;
    mctx.setTransform(a, b, cc, d, h - (a * X + cc * Y), h - (b * X + d * Y));
    mctx.drawImage(base, 0, 0);
    mctx.setTransform(1, 0, 0, 1, 0, 0);
    for (const ch of G.chars) {
      if (!ch.alive || !ch.hostile) continue;
      const [x, y] = mapXY(ch.x - player.x, ch.z - player.z, z);
      if (Math.abs(x) > h || Math.abs(y) > h) continue;
      mctx.fillStyle = ch.kind === 'cop' ? (G.time % 0.5 < 0.25 ? '#ff3344' : '#3d7bff') : '#ff3344';
      mctx.beginPath(); mctx.arc(h + x, h + y, 3, 0, Math.PI * 2); mctx.fill();
    }
    if (waypoint) {
      let [x, y] = mapXY(waypoint.x - player.x, waypoint.z - player.z, z);
      const l = Math.hypot(x, y), lim = h - 9;
      if (l > lim) { x *= lim / l; y *= lim / l; }
      mctx.fillStyle = '#e8b34a'; mctx.strokeStyle = '#07090d'; mctx.lineWidth = 2;
      mctx.beginPath(); mctx.arc(h + x, h + y, 5, 0, Math.PI * 2); mctx.fill(); mctx.stroke();
    }
    // player arrow (always points up: the map turns with the camera)
    const pa = (player.car ? player.car.heading : player.rot) - camYaw;
    mctx.translate(h, h); mctx.rotate(-pa);
    mctx.fillStyle = '#efe6cc';
    mctx.beginPath(); mctx.moveTo(0, -7); mctx.lineTo(5, 5); mctx.lineTo(0, 2); mctx.lineTo(-5, 5); mctx.closePath(); mctx.fill();
    mctx.restore();
    const g = mctx.createRadialGradient(h, h, h * 0.7, h, h, h);
    g.addColorStop(0, 'rgba(7,9,13,0)'); g.addColorStop(1, 'rgba(7,9,13,0.85)');
    mctx.fillStyle = g; mctx.beginPath(); mctx.arc(h, h, h - 2, 0, Math.PI * 2); mctx.fill();
  }

  const proj = new T.Vector3();
  let last = { hp: -1, ammo: '', stars: -1, ev: null, act: '', car: null };
  let mmFrame = 0;
  hud.update = function (dt) {
    const hp = Math.round(player.hp);
    if (hp !== last.hp) { el.hp.style.width = hp + '%'; el.hp.classList.toggle('low', hp < 30); last.hp = hp; }
    const k = activeWeapon(), w = G.WEAPONS[k], inv = G.inv;
    const ammo = w.melee ? '' : player.reloadT > 0 ? 'RELOADING' : inv.mag[k] + ' / ' + (inv.reserve[k] === Infinity ? '∞' : inv.reserve[k]);
    if (ammo !== last.ammo) { el.ammo.textContent = ammo; last.ammo = ammo; }
    if (w.name !== last.wname) { el.wname.textContent = w.name; last.wname = w.name; }
    if (G.money !== last.money) { el.money.textContent = '$' + G.money.toLocaleString(); last.money = G.money; }
    const ar = Math.round(player.armor || 0);
    if (ar !== last.armor) { el.armor.style.width = ar + '%'; el.armorBar.hidden = ar <= 0; last.armor = ar; }
    if (noticeT > 0) { noticeT -= dt; if (noticeT <= 0) el.notice.hidden = true; }
    const stars = Math.ceil(G.wanted.level - 0.01);
    if (stars !== last.stars) { starEls.forEach((s, k) => s.classList.toggle('on', k < stars)); last.stars = stars; }
    if (G.wanted.evading !== last.ev) { el.stars.classList.toggle('evading', !!G.wanted.evading); last.ev = G.wanted.evading; }
    if (subT > 0) { subT -= dt; if (subT <= 0) el.sub.hidden = true; }
    if (toastT > 0) { toastT -= dt; if (toastT <= 0) el.toast.hidden = true; }
    hurtV = Math.max(0, hurtV - dt * 0.9);
    const low = player.alive && player.hp < 30 ? 0.35 + Math.sin(G.time * 5) * 0.1 : 0;
    el.vig.style.opacity = Math.max(hurtV, low).toFixed(3);
    if (bloodAlpha > 0) {
      bloodAlpha = Math.max(0, bloodAlpha - dt * 0.35);
      el.blood.style.opacity = Math.min(1, bloodAlpha * 1.5).toFixed(3);
      if (bloodAlpha === 0) bctx.clearRect(0, 0, el.blood.width, el.blood.height);
    }

    // context button
    let act = '';
    if (player.alive && !player.car) {
      if (G.shopAt(player.x, player.z)) act = 'SHOP';
      else if (G.story.safehouseAt(player.x, player.z)) act = 'REST';
      else if (nearestCar(3.8)) act = 'CAR';
    }
    if (act !== last.act) { el.act.textContent = act || 'CAR'; el.act.classList.toggle('dim', !act); last.act = act; }

    // aim reticle
    if (aimTarget && player.alive) {
      proj.set(aimTarget.x, 1.35, aimTarget.z).project(camera);
      if (proj.z < 1) {
        el.ret.hidden = false;
        el.ret.style.transform = `translate(${((proj.x + 1) / 2) * window.innerWidth}px, ${((1 - proj.y) / 2) * window.innerHeight}px)`;
        el.ret.classList.toggle('hostile', !!aimTarget.hostile);
      } else el.ret.hidden = true;
    } else el.ret.hidden = true;

    // waypoint compass
    if (waypoint && player.alive) {
      const [x, y] = mapXY(waypoint.x - player.x, waypoint.z - player.z, 1);
      el.wp.hidden = false;
      el.arrow.style.transform = `rotate(${Math.atan2(x, -y)}rad)`;
      el.wpDist.textContent = Math.round(Math.hypot(waypoint.x - player.x, waypoint.z - player.z)) + ' m';
    } else el.wp.hidden = true;

    if ((mmFrame++ & 1) === 0) drawMinimap();
  };

  // crosshair: shows in aim mode; the gap is the gun's current spread
  function updateCrosshair(dt) {
    const xh = $('xhair');
    const show = player.aimMode && player.alive;
    if (xh.hidden === show) xh.hidden = !show;
    if (show) {
      const w = G.WEAPONS[activeWeapon()];
      const sp = (w.aimSpread || 0) + player.bloom * 0.6 + (player.moving > 0.5 ? (w.aimSpread || 0) * 1.5 : 0);
      const gap = Math.round(5 + sp * 900);
      if (gap !== xh._gap) { xh.style.setProperty('--gap', gap + 'px'); xh._gap = gap; }
      xh.classList.toggle('scope', !!w.zoom);
    }
    if (dmgT > 0) { dmgT -= dt; $('dmgdir').style.opacity = Math.max(0, dmgT / 1.2).toFixed(2); }
  }
  let dmgT = 0;
  hud.hitFrom = function (fx, fz) {
    if (fx === undefined) return;
    const a = Math.atan2(fx - player.x, fz - player.z), rel = G.wrapAngle(a - camYaw);
    $('dmgdir').style.transform = `translate(-50%, -50%) rotate(${-rel}rad)`;
    dmgT = 1.2;
  };
  function syncToggles() {
    $('btnAim').classList.toggle('on', !!G.input.aim);
    $('btnCrouch').classList.toggle('on', !!G.input.crouch);
  }
  G.onCrouchKey = () => setTimeout(syncToggles, 0);

  const joyUI = {
    joyShow(x, y) { el.joyBase.hidden = false; el.joyBase.style.transform = `translate(${x}px, ${y}px)`; el.joyKnob.style.transform = 'translate(0px, 0px)'; },
    joyKnob(dx, dy) { el.joyKnob.style.transform = `translate(${dx}px, ${dy}px)`; },
    joyHide() { el.joyBase.hidden = true; },
  };

  // ---------------------------------------------------------------- menus
  function setPaused(p) {
    if (!G.running || G.cardMode || G.shopOpen || !player.alive) p = false;
    G.paused = p;
    $('pause').hidden = !p;
    $('confirmRestart').hidden = true;
    G.resetInput();
    if (p && document.pointerLockElement) document.exitPointerLock();
  }
  G.onPauseKey = () => setPaused(!G.paused);
  let hadLock = false;
  document.addEventListener('pointerlockchange', () => {
    const locked = !!document.pointerLockElement;
    if (hadLock && !locked && G.running && !G.cardMode && player.alive && !G.paused) setPaused(true);
    hadLock = locked;
  });
  document.addEventListener('visibilitychange', () => { if (document.hidden) setPaused(true); });

  function bindUI() {
    G.initInput($('touch'), joyUI);
    G.bindHold(el.fire, (v) => G.setTouch('fire', v));
    G.bindHold($('btnShoot'), (v) => G.setTouch('fire', v));
    G.bindHold($('btnGas'), (v) => G.setTouch('gas', v));
    G.bindHold($('btnBrake'), (v) => G.setTouch('brake', v));
    G.bindHold($('btnHand'), (v) => G.setTouch('hand', v));
    G.bindHold($('btnLeft'), (v) => G.setTouch('left', v));
    G.bindHold($('btnRight'), (v) => G.setTouch('right', v));
    G.bindHold(el.act, (v) => { if (v) input.action = true; });
    G.bindHold($('btnExit'), (v) => { if (v) input.action = true; });
    G.bindHold(el.reload, (v) => { if (v) input.reload = true; });
    const runBtn = $('btnRun');
    G.bindHold(runBtn, (v) => { if (v) runBtn.classList.toggle('on', G.toggleRun()); });
    $('btnPause').addEventListener('click', () => setPaused(true));
    $('resumeBtn').addEventListener('click', () => setPaused(false));
    const sb = $('soundBtn');
    const syncSound = () => { sb.textContent = 'Sound: ' + (G.audio.muted ? 'Off' : 'On'); };
    syncSound();
    sb.addEventListener('click', () => { G.audio.init(); G.audio.setMuted(!G.audio.muted); syncSound(); });
    $('qBtn').addEventListener('click', () => {
      G.qualityLevel = G.qualityLevel === 'low' ? 'high' : 'low';
      G.quality = G.qualityLevel; G.store.set('quality', G.quality);
      applyQuality();
    });
    $('restartBtn').addEventListener('click', () => { $('confirmRestart').hidden = false; });
    $('restartNo').addEventListener('click', () => { $('confirmRestart').hidden = true; });
    $('restartYes').addEventListener('click', () => location.reload());
    $('retryBtn').addEventListener('click', () => { if (RANGE) G.range.respawn(); else G.story.respawn(); });
    $('modeBtn').addEventListener('click', () => { location.hash = RANGE ? 'island' : 'range'; location.reload(); });
    $('startBtn').addEventListener('click', () => startGame(null));
    $('continueBtn').addEventListener('click', () => startGame(G.loadSave()));
    $('newBtn').addEventListener('click', () => { $('confirmNew').hidden = false; });
    $('newNo').addEventListener('click', () => { $('confirmNew').hidden = true; });
    $('newYes').addEventListener('click', () => { G.clearSave(); startGame(null); });
    G.bindHold($('btnWeapon'), (v) => { if (v) G.inv.cycle(1); });
    G.bindHold($('btnAim'), (v) => { if (v) { $('btnAim').classList.toggle('on', G.toggleAim()); } });
    G.bindHold($('btnCrouch'), (v) => { if (v) { $('btnCrouch').classList.toggle('on', G.toggleCrouch()); } });
    window.addEventListener('keydown', (e) => {
      if (!G.running || G.paused || G.cardMode || G.shopOpen) return;
      if (e.code === 'KeyQ') G.inv.cycle(1);
      const n = ['Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5'].indexOf(e.code);
      if (n >= 0) G.inv.select(['fists', 'pistol', 'shotgun', 'smg', 'rifle'][n]);
    });
    window.addEventListener('wheel', (e) => { if (G.running && !G.paused && !G.shopOpen && !G.cardMode) G.inv.cycle(e.deltaY > 0 ? 1 : -1); }, { passive: true });
    $('shopClose').addEventListener('click', () => G.closeShop());
    // backup save code
    $('codeBtn').addEventListener('click', () => {
      const box = $('codeBox'); box.hidden = false;
      $('codeText').value = G.saveCode();
      $('codeMsg').textContent = 'Copy this somewhere safe. Paste it back here to restore your game.';
    });
    $('codeCopy').addEventListener('click', () => {
      const t = $('codeText'); t.select();
      const done = () => { $('codeMsg').textContent = 'Copied.'; };
      try { navigator.clipboard.writeText(t.value).then(done).catch(() => { $('codeMsg').textContent = 'Select the text and copy it yourself.'; }); }
      catch (e) { $('codeMsg').textContent = 'Select the text and copy it yourself.'; }
    });
    $('codeLoad').addEventListener('click', () => {
      if (G.loadCode($('codeText').value)) { $('codeMsg').textContent = 'Loaded. Restarting…'; setTimeout(() => location.reload(), 600); }
      else $('codeMsg').textContent = 'That code did not work. Check it was copied in full.';
    });
  }

  function startGame(save) {
    G.audio.init();
    try {
      const de = document.documentElement;
      if (input.usingTouch || matchMedia('(pointer: coarse)').matches) {
        const p = de.requestFullscreen && de.requestFullscreen({ navigationUI: 'hide' });
        if (p && p.then) p.then(() => { try { screen.orientation.lock('landscape').catch(() => {}); } catch (_) { /* unsupported */ } }).catch(() => {});
      }
    } catch (_) { /* fullscreen refused */ }
    $('title').hidden = true;
    $('hud').hidden = false;
    G.running = true;
    for (let k = G.chars.length - 1; k >= 0; k--) if (G.chars[k].kind === 'ped' && Math.hypot(G.chars[k].x - player.x, G.chars[k].z - player.z) < 30) A.remove(G.chars[k]);
    if (RANGE) G.range.start(); else G.story.start(save);
    perfStart = G.time;
  }

  // ---------------------------------------------------------------- loop
  let lastT = performance.now(), perfStart = -1, perfN = 0, perfSum = 0;
  function update(dt) {
    G.time += dt;
    G.readInput();
    const sens = (input.usingTouch ? 0.0062 : 0.0026) * (player.aimMode ? (G.WEAPONS[activeWeapon()].zoom ? 0.35 : 0.55) : 1);
    if (input.lookDX || input.lookDY) lookIdle = 0; else lookIdle += dt;
    camYaw -= input.lookDX * sens;
    camPitch = G.clamp(camPitch + input.lookDY * sens, player.aimMode ? -0.45 : -0.3, 1.1);

    if (player.alive) {
      if (player.car) updateDriving(dt); else updateOnFoot(dt);
      if (G.time - player.lastHurt > 4 && player.hp < 100) player.hp = Math.min(100, player.hp + 8 * dt);
    } else {
      deathT += dt;
      if (deathT > 1.6 && $('death').hidden) $('death').hidden = false;
    }
    if (!RANGE) G.traffic.update(dt);
    A.updateCars(dt, input);
    A.updateChars(dt);
    G.body.update(dt);
    if (RANGE) G.range.update(dt);
    else { populate(dt); updateWanted(dt); G.story.update(dt); }
    updateCamera(dt);
    W.update(dt, camera.position);
    G.fx.update(dt);
    G.loot.update(dt);
    G.gun.update(dt);
    G.gun.hudUpdate(dt);
    updateCrosshair(dt);
    let siren = 0;
    if (G.wanted.level > 0) {
      for (const car of G.cars) if (car.sirenOn) siren = Math.max(siren, 1 - Math.hypot(car.x - player.x, car.z - player.z) / 90);
    }
    G.audio.update(!!player.car, player.car ? player.car.speed : 0, Math.max(0, siren), G.time);
    hud.update(dt);
    G.clearEdges();

    // drop to low graphics once if the phone is struggling
    if (perfStart >= 0 && G.quality === 'auto' && G.qualityLevel === 'high') {
      const t = G.time - perfStart;
      if (t > 3 && t < 9) { perfN++; perfSum += dt; }
      if (t >= 9 && perfN > 0) {
        if (perfSum / perfN > 1 / 36) { G.qualityLevel = 'low'; applyQuality(); hud.say('Switched to lower graphics for smoother play. Change it in the pause menu.', 4); }
        perfStart = -1;
      }
    }
  }

  function frame(now) {
    requestAnimationFrame(frame);
    const dt = Math.min(0.05, (now - lastT) / 1000);
    lastT = now;
    if (!G.running) {
      G.time += dt;
      titleCamera(G.time);
      W.update(dt, camera.position);
      A.updateChars(dt);
      G.body.update(dt);
      if (!RANGE) populate(dt);
    } else if (!G.paused && !G.cardMode && !G.shopOpen) {
      update(dt);
    } else {
      G.clearEdges();
    }
    renderer.render(scene, camera);
  }

  // ---------------------------------------------------------------- boot
  function boot() {
    if (RANGE) G.range.build(scene); else W.build(scene);
    scene.add(beam);
    G.fx.init(scene);
    G.body.init(scene);
    G.gun.init(scene);
    makePlayer();
    drawBaseMap();
    bindUI();
    applyQuality();
    if (!RANGE) for (let k = 0; k < 16; k++) { const p = W.randomSidewalkPoint(150, -180, 10, 80); if (p) A.spawn('ped', p.x, p.z, { ring: p }); }
    if (RANGE) {
      document.querySelector('.chapter').textContent = 'Kill House · Gunplay test';
      document.querySelector('.tagline').textContent = 'Waves of Saints and cops in a floodlit yard full of cover. Aim, crouch, and stay alive.';
      $('modeBtn').textContent = 'Play the story (island)';
    }
    $('loading').hidden = true;
    $('startBtn').disabled = false;
    const sv = RANGE ? null : G.loadSave();
    if (sv) { $('startBtn').hidden = true; $('saveRow').hidden = false; $('saveInfo').textContent = 'Saved ' + new Date(sv.at).toLocaleString(); }
    requestAnimationFrame((t) => { lastT = t; frame(t); });
  }
  const fontsReady = document.fonts && document.fonts.load
    ? Promise.all([document.fonts.load('700 84px "Barlow Condensed"'), document.fonts.ready]).catch(() => {})
    : Promise.resolve();
  Promise.race([fontsReady, new Promise((r) => setTimeout(r, 1800))]).then(boot);
})();
