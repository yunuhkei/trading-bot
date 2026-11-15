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
  const scene = (G.scene = new T.Scene());
  const FOG = 0x0b0e15;
  scene.background = new T.Color(FOG);
  scene.fog = new T.FogExp2(FOG, 0.016);
  const camera = (G.camera = new T.PerspectiveCamera(62, 1, 0.1, 280));

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
    scene.fog.density = low ? 0.021 : 0.016;
    G.maxPeds = low ? 13 : 22;
    W.setRainDensity(low ? 0.45 : 1);
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
    Object.assign(player, { hp: 100, ammo: 12, mag: 12, reloadT: 0, fireCD: 0, car: null, lastHurt: -99, aimHold: 0, moving: 0 });
  }

  G.resetPlayer = function (x, z, rot) {
    if (player.car) G.exitCar(true);
    player.x = x; player.z = z; player.rot = rot; camYaw = rot; camPitch = 0.3;
    player.hp = 100; player.alive = true; player.ammo = player.mag; player.reloadT = 0;
    player.mesh.visible = true; player.mesh.rotation.x = 0;
    A.poseDead(player, 0);
    if (player.pool) { scene.remove(player.pool); player.pool = null; }
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
    player.car = car; car.driver = player; car.lastDriver = player;
    if (!car.lightsOn) A.setLights(car, true);
    player.mesh.visible = false;
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
    player.mesh.visible = true;
    player.rot = car.heading;
  };

  function startReload() {
    if (player.reloadT > 0 || player.ammo === player.mag) return;
    player.reloadT = 1.3;
    G.audio.click();
  }

  function computeAim() {
    aimTarget = null;
    if (player.car || !player.alive) return;
    const fx = Math.sin(camYaw), fz = Math.cos(camYaw);
    let best = null, bestS = 1e9;
    for (const c of G.chars) {
      if (!c.alive) continue;
      const dx = c.x - player.x, dz = c.z - player.z, d = Math.hypot(dx, dz);
      if (d > 36 || d < 0.3) continue;
      const cos = (dx * fx + dz * fz) / d;
      const hostile = c.hostile;
      if (cos < (hostile ? 0.84 : 0.94)) continue;
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

  function playerShoot() {
    player.fireCD = 0.27; player.ammo--; player.aimHold = 0.9;
    const fx = Math.sin(player.rot), fz = Math.cos(player.rot);
    const ox = player.x + fx * 0.6 - fz * 0.28, oz = player.z + fz * 0.6 + fx * 0.28, oy = 1.45 + W.groundY(player.x, player.z);
    let dx, dz, forced = null;
    if (aimTarget) {
      const t = aimTarget, d = Math.hypot(t.x - ox, t.z - oz) || 1;
      dx = (t.x - ox) / d; dz = (t.z - oz) / d;
      const p = G.clamp(1.03 - d * 0.012, 0.62, 0.97);
      if (Math.random() < p) forced = t;
      else { const a = Math.atan2(dx, dz) + (Math.random() < 0.5 ? -1 : 1) * G.R(0.05, 0.1); dx = Math.sin(a); dz = Math.cos(a); }
    } else {
      const a = camYaw + G.R(-0.015, 0.015);
      dx = Math.sin(a); dz = Math.cos(a);
    }
    const wallT = W.raycast(ox, oz, dx, dz, 70);
    let hit = forced ? { c: forced, t: Math.hypot(forced.x - ox, forced.z - oz) } : A.rayChars(ox, oz, dx, dz, wallT, null);
    let ex, ey, ez;
    if (hit) {
      ex = hit.c.x; ez = hit.c.z; ey = 1.3;
      const head = Math.random() < 0.12;
      G.damageChar(hit.c, head ? 120 : G.R(36, 48), player.x, player.z, true);
      if (head && !hit.c.alive) G.hud.toast('Headshot');
    } else {
      ex = ox + dx * wallT; ez = oz + dz * wallT; ey = oy - 0.1;
      if (wallT < 70) G.fx.spark(ex, ey, ez, 6);
    }
    G.fx.tracer(ox, oy, oz, ex, ey, ez);
    G.fx.flash(ox, oy + 0.1, oz, 1);
    G.audio.shot(1);
    A.alarm(player.x, player.z, 45);
    if (!G.suppressShotHeat && G.wanted.level < 1 && witnesses(25)) G.addHeat(1);
  }

  // ---------------------------------------------------------------- damage
  G.damageChar = function (c, amt, fx, fz, byPlayer) {
    if (!c.alive) return;
    c.hp -= amt;
    G.fx.blood(c.x, 1.3, c.z, fx, fz);
    if (c.kind === 'ped') { c.fleeT = 14; c.tx = fx; c.tz = fz; }
    if (c.kind === 'cop' && byPlayer) G.addHeat(G.wanted.level < 2 ? 2 - G.wanted.level : 0.3);
    if (c.hp <= 0) G.killChar(c, fx, fz, byPlayer);
    else if (c.hostile) c.fireCD = Math.max(c.fireCD, 0.35);
  };
  G.killChar = function (c, fx, fz, byPlayer) {
    A.kill(c, fx, fz);
    if (!byPlayer) return;
    G.stats.kills++;
    if (c.kind === 'ped') { G.stats.civs++; G.addHeat(G.wanted.level < 1 ? 1 : 0.5); }
    else if (c.kind === 'cop') { G.stats.cops++; G.addHeat(1); }
    else if (c.kind === 'saint') { G.stats.saints++; G.story.onKill(c); }
  };
  G.damagePlayer = function (amt, fx, fz, direct) {
    if (!player.alive) return;
    if (player.car && !direct) { A.damageCar(player.car, amt * 0.9); amt *= 0.35; }
    player.hp -= amt;
    player.lastHurt = G.time;
    G.hud.hurt(Math.min(1, amt / 25));
    G.shake(0.25);
    if (player.hp <= 0) {
      player.hp = 0; player.alive = false; deathT = 0;
      if (player.car) G.exitCar(true);
      A.kill(player, fx, fz);
      G.resetInput();
    }
  };

  // ---------------------------------------------------------------- wanted
  G.addHeat = function (n) {
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
    for (const car of G.cars) if (car.cop) car.sirenOn = false;
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
      if (n < MAXCOPS[stars]) {
        const rp = W.randomRoadPoint(player.x, player.z, 45, 75, false);
        if (rp) {
          const car = A.spawnCar(rp.x, rp.z, rp.h, { cop: true, lights: true });
          car.sirenOn = true;
          const fx = Math.sin(rp.h), fz = Math.cos(rp.h), lx = Math.cos(rp.h), lz = -Math.sin(rp.h);
          for (const s of [1, -1]) {
            const x = rp.x + lx * s * 1.9, z = rp.z + lz * s * 1.9 + 0 * fz + 0 * fx;
            A.spawn('cop', x, z, { hostile: true, rot: rp.h });
          }
        }
      }
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
        if (!car.cop && !car.wrecked) civ++;
      }
      if (civ < 9) {
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
    computeAim();
    player.aimHold -= dt;
    if (input.fire) player.aimHold = 0.7;
    const aiming = player.aimHold > 0;
    if (aiming) speed = Math.min(speed, 3.8);
    player.moving = speed;
    player.x += vx * speed * dt; player.z += vz * speed * dt;
    W.collide(player, 0.36);
    A.pushFromCars(player, 0.36);
    let face = null;
    if (aiming) face = aimTarget ? Math.atan2(aimTarget.x - player.x, aimTarget.z - player.z) : camYaw;
    else if (speed > 0) face = Math.atan2(vx, vz);
    if (face !== null) player.rot = G.angleLerp(player.rot, face, Math.min(1, dt * (aiming ? 20 : 10)));
    A.animate(player, dt, speed, aiming);
    player.mesh.position.set(player.x, W.groundY(player.x, player.z), player.z);
    player.mesh.rotation.y = player.rot;

    if (player.reloadT > 0) { player.reloadT -= dt; if (player.reloadT <= 0) player.ammo = player.mag; }
    if (input.reload) startReload();
    player.fireCD -= dt;
    if (input.fire && player.fireCD <= 0 && player.reloadT <= 0) {
      if (player.ammo > 0) playerShoot(); else { startReload(); player.fireCD = 0.3; }
    }
    if (input.action) { const car = nearestCar(3.8); if (car) enterCar(car); }
  }

  function updateDriving() {
    const car = player.car;
    player.x = car.x; player.z = car.z; player.moving = Math.abs(car.speed);
    player.mesh.position.set(car.x, 0, car.z);
    if (input.action) G.exitCar(false);
  }

  // ---------------------------------------------------------------- camera
  const camPos = new T.Vector3();
  const fill = new T.PointLight(0xc9d2ee, 26, 20, 1.4);
  scene.add(fill);
  function updateCamera(dt) {
    let px, pz, py, dist;
    const car = player.car;
    if (car) {
      px = car.x; pz = car.z; py = 1.9; dist = 8.6;
      if (lookIdle > 1.1 && Math.abs(car.speed) > 2) {
        camYaw = G.angleLerp(camYaw, car.heading, Math.min(1, dt * 2.4));
        camPitch = G.lerp(camPitch, 0.26, Math.min(1, dt * 2));
      }
    } else {
      px = player.x; pz = player.z; py = 1.62 + W.groundY(px, pz); dist = 4.3;
      if (!player.alive) { dist = 6.5; camPitch = G.lerp(camPitch, 0.9, Math.min(1, dt * 1.5)); camYaw += dt * 0.25; }
    }
    const fx = Math.sin(camYaw), fz = Math.cos(camYaw), rx = -Math.cos(camYaw), rz = Math.sin(camYaw);
    const sh = car || !player.alive ? 0 : 0.55;
    const ax = px + rx * sh, az = pz + rz * sh;
    const cp = Math.cos(camPitch), sp = Math.sin(camPitch);
    const cx = ax - fx * dist * cp, cy = py + dist * sp + (car ? 0.6 : 0.15), cz = az - fz * dist * cp;
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
    camera.lookAt(ax + fx * 3, py + (car ? 0.1 : 0.05), az + fz * 3);
    // soft key light just behind the camera so people read as people, not silhouettes
    fill.position.set(px - fx * 2.5 - rx * 1.5, py + 2.6, pz - fz * 2.5 - rz * 1.5);
  }

  // title-screen camera: a slow drift past the burning wreck
  function titleCamera(t) {
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
    hp: $('hpFill'), ammo: $('ammo'), stars: $('stars'), obj: $('objective'), sub: $('subtitle'), toast: $('toast'),
    ret: $('reticle'), arrow: $('wpArrow'), wpDist: $('wpDist'), wp: $('wp'), vig: $('vignette'),
    act: $('btnAct'), fire: $('btnFire'), brake: $('btnBrake'), reload: $('btnReload'),
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
  let toastT = 0;
  hud.toast = (text) => { el.toast.textContent = text; el.toast.hidden = false; toastT = 1.2; };
  let hurtV = 0;
  hud.hurt = (a) => { hurtV = Math.min(1, hurtV + 0.35 + a * 0.4); };
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
  const BK = 1.6, BS = 520 * BK; base.width = base.height = BS;
  function drawBaseMap() {
    const b = base.getContext('2d');
    b.fillStyle = '#0a0d12'; b.fillRect(0, 0, BS, BS);
    const m = (v) => (v + 260) * BK;
    b.fillStyle = '#2b303a';
    b.fillRect(m(-248), m(-248), 496 * BK, 496 * BK);
    for (let i = 0; i < W.NB; i++) for (let j = 0; j < W.NB; j++) {
      const cx = W.blockCenter(i), cz = W.blockCenter(j), type = W.SPECIAL[i + ',' + j];
      b.fillStyle = type === 'park' ? '#16261a' : type === 'lot' ? '#1a1c20' : '#14171d';
      b.fillRect(m(cx - 22), m(cz - 22), 44 * BK, 44 * BK);
    }
    b.fillStyle = '#232833';
    for (const bx of W.boxes) b.fillRect(m(bx.minX), m(bx.minZ), (bx.maxX - bx.minX) * BK, (bx.maxZ - bx.minZ) * BK);
    b.fillStyle = '#b3121e';
    b.fillRect(m(88.5), m(73), 3 * BK, 6 * BK); b.fillRect(m(87), m(74.5), 6 * BK, 1.5 * BK);
  }
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
    const X = (player.x + 260) * BK, Y = (player.z + 260) * BK;
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
    const ammo = player.reloadT > 0 ? 'RELOADING' : player.ammo + ' / ' + player.mag;
    if (ammo !== last.ammo) { el.ammo.textContent = ammo; last.ammo = ammo; }
    const stars = Math.ceil(G.wanted.level - 0.01);
    if (stars !== last.stars) { starEls.forEach((s, k) => s.classList.toggle('on', k < stars)); last.stars = stars; }
    if (G.wanted.evading !== last.ev) { el.stars.classList.toggle('evading', !!G.wanted.evading); last.ev = G.wanted.evading; }
    if (subT > 0) { subT -= dt; if (subT <= 0) el.sub.hidden = true; }
    if (toastT > 0) { toastT -= dt; if (toastT <= 0) el.toast.hidden = true; }
    hurtV = Math.max(0, hurtV - dt * 0.9);
    const low = player.alive && player.hp < 30 ? 0.35 + Math.sin(G.time * 5) * 0.1 : 0;
    el.vig.style.opacity = Math.max(hurtV, low).toFixed(3);

    // context button
    let act = '';
    if (player.alive) {
      if (player.car) act = 'EXIT';
      else if (nearestCar(3.8)) act = 'CAR';
    }
    if (act !== last.act) { el.act.textContent = act || 'CAR'; el.act.classList.toggle('dim', !act); last.act = act; }
    const inCar = !!player.car;
    if (inCar !== last.car) {
      el.fire.hidden = inCar; el.reload.hidden = inCar; el.brake.hidden = !inCar;
      last.car = inCar;
    }

    // aim reticle
    if (aimTarget && player.alive && !player.car) {
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

  const joyUI = {
    joyShow(x, y) { el.joyBase.hidden = false; el.joyBase.style.transform = `translate(${x}px, ${y}px)`; el.joyKnob.style.transform = 'translate(0px, 0px)'; },
    joyKnob(dx, dy) { el.joyKnob.style.transform = `translate(${dx}px, ${dy}px)`; },
    joyHide() { el.joyBase.hidden = true; },
  };

  // ---------------------------------------------------------------- menus
  function setPaused(p) {
    if (!G.running || G.cardMode || !player.alive) p = false;
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
    G.bindHold(el.fire, (v) => G.setFireTouch(v));
    G.bindHold(el.brake, (v) => G.setBrakeTouch(v));
    G.bindHold(el.act, (v) => { if (v) input.action = true; });
    G.bindHold(el.reload, (v) => { if (v) input.reload = true; });
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
    $('retryBtn').addEventListener('click', () => { G.story.respawn(); });
    $('startBtn').addEventListener('click', startGame);
  }

  function startGame() {
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
    G.story.start();
    perfStart = G.time;
  }

  // ---------------------------------------------------------------- loop
  let lastT = performance.now(), perfStart = -1, perfN = 0, perfSum = 0;
  function update(dt) {
    G.time += dt;
    G.readInput();
    const sens = input.usingTouch ? 0.0062 : 0.0026;
    if (input.lookDX || input.lookDY) lookIdle = 0; else lookIdle += dt;
    camYaw -= input.lookDX * sens;
    camPitch = G.clamp(camPitch + input.lookDY * sens, -0.3, 1.1);

    if (player.alive) {
      if (player.car) updateDriving(); else updateOnFoot(dt);
      if (G.time - player.lastHurt > 4 && player.hp < 100) player.hp = Math.min(100, player.hp + 8 * dt);
    } else {
      A.updateDead(player, dt);
      deathT += dt;
      if (deathT > 1.6 && $('death').hidden) $('death').hidden = false;
    }
    A.updateCars(dt, input);
    A.updateChars(dt);
    populate(dt);
    updateWanted(dt);
    G.story.update(dt);
    updateCamera(dt);
    W.update(dt, camera.position);
    G.fx.update(dt);
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
      populate(dt);
    } else if (!G.paused && !G.cardMode) {
      update(dt);
    } else {
      G.clearEdges();
    }
    renderer.render(scene, camera);
  }

  // ---------------------------------------------------------------- boot
  function boot() {
    W.build(scene);
    scene.add(beam);
    G.fx.init(scene);
    makePlayer();
    drawBaseMap();
    bindUI();
    applyQuality();
    for (let k = 0; k < 16; k++) { const p = W.randomSidewalkPoint(150, -180, 10, 80); if (p) A.spawn('ped', p.x, p.z, { ring: p }); }
    $('loading').hidden = true;
    $('startBtn').disabled = false;
    requestAnimationFrame((t) => { lastT = t; frame(t); });
  }
  const fontsReady = document.fonts && document.fonts.load
    ? Promise.all([document.fonts.load('700 84px "Barlow Condensed"'), document.fonts.ready]).catch(() => {})
    : Promise.resolve();
  Promise.race([fontsReady, new Promise((r) => setTimeout(r, 1800))]).then(boot);
})();
