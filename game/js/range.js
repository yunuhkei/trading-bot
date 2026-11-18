'use strict';
// The Kill House: a walled, floodlit yard full of cover for testing gunplay.
// Enemies come in waves. Built instead of the island unless the page is opened with #island.
(function () {
  const T = THREE, W = G.world;
  const R = (G.range = { wave: 0, left: 0, state: 'idle', t: 0 });
  const X = 46, Z = 36; // half-size of the yard
  R.bounds = { X, Z };
  R.cover = [];

  function canvasTex(w, h, draw, rep) {
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    draw(c.getContext('2d'), w, h);
    const t = new T.CanvasTexture(c); t.colorSpace = T.SRGBColorSpace;
    if (rep) { t.wrapS = t.wrapT = T.RepeatWrapping; t.repeat.set(rep[0], rep[1]); }
    t.anisotropy = 4;
    return t;
  }
  const noise = (x, w, h, base, spread, n, a) => {
    x.fillStyle = base; x.fillRect(0, 0, w, h);
    for (let k = 0; k < n; k++) {
      const g = (spread[0] + Math.random() * spread[1]) | 0;
      x.fillStyle = `rgba(${g},${g},${g},${a})`;
      x.fillRect(Math.random() * w, Math.random() * h, 1 + Math.random() * 3, 1 + Math.random() * 3);
    }
  };

  R.build = function (scene) {
    W.arena = true;
    W.radialTex = (function () {
      const c = document.createElement('canvas'); c.width = c.height = 64;
      const x = c.getContext('2d'), g = x.createRadialGradient(32, 32, 0, 32, 32, 32);
      g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.35, 'rgba(255,255,255,0.45)'); g.addColorStop(1, 'rgba(255,255,255,0)');
      x.fillStyle = g; x.fillRect(0, 0, 64, 64);
      return new T.CanvasTexture(c);
    })();

    // floor: stained concrete with painted lanes
    const floorTex = canvasTex(512, 512, (x, w, h) => {
      noise(x, w, h, '#8a8884', [90, 70], 14000, 0.35);
      for (let k = 0; k < 18; k++) {
        const px = Math.random() * w, py = Math.random() * h, r = 20 + Math.random() * 70;
        const g = x.createRadialGradient(px, py, 0, px, py, r);
        g.addColorStop(0, 'rgba(40,38,34,0.35)'); g.addColorStop(1, 'rgba(40,38,34,0)');
        x.fillStyle = g; x.fillRect(px - r, py - r, r * 2, r * 2);
      }
      x.strokeStyle = 'rgba(30,30,30,0.5)'; x.lineWidth = 2;
      for (let k = 0; k <= 4; k++) { x.beginPath(); x.moveTo(k * 128, 0); x.lineTo(k * 128, h); x.stroke(); x.beginPath(); x.moveTo(0, k * 128); x.lineTo(w, k * 128); x.stroke(); }
    }, [X / 8, Z / 8]);
    const floor = new T.Mesh(new T.PlaneGeometry(X * 2 + 20, Z * 2 + 20), new T.MeshStandardMaterial({ map: floorTex, roughness: 0.92, metalness: 0 }));
    floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true;
    scene.add(floor);
    for (const [x0, z0, x1, z1] of [[-X + 6, Z - 10, X - 6, Z - 9.85], [-X + 6, -Z + 9.85, X - 6, -Z + 10]]) {
      const m = new T.Mesh(new T.PlaneGeometry(x1 - x0, z1 - z0), new T.MeshBasicMaterial({ color: 0xc8a030 }));
      m.rotation.x = -Math.PI / 2; m.position.set((x0 + x1) / 2, 0.01, (z0 + z1) / 2); scene.add(m);
    }

    // walls: corrugated steel
    const wallTex = canvasTex(256, 256, (x, w, h) => {
      noise(x, w, h, '#5a6068', [70, 60], 3000, 0.3);
      for (let k = 0; k < w; k += 16) { x.fillStyle = 'rgba(0,0,0,0.22)'; x.fillRect(k, 0, 4, h); x.fillStyle = 'rgba(255,255,255,0.06)'; x.fillRect(k + 8, 0, 3, h); }
      for (let k = 0; k < 14; k++) { x.fillStyle = 'rgba(90,50,20,0.25)'; x.fillRect(Math.random() * w, Math.random() * h * 0.3 + h * 0.6, 3 + Math.random() * 6, 20 + Math.random() * 90); }
    }, null);
    const wallMat = new T.MeshStandardMaterial({ map: wallTex, roughness: 0.75, metalness: 0.3 });
    const WH = 9;
    const wall = (cx, cz, sx, sz) => {
      const t = wallTex.clone(); t.needsUpdate = true; t.wrapS = t.wrapT = T.RepeatWrapping; t.repeat.set(Math.max(sx, sz) / 6, WH / 6);
      const m = new T.Mesh(new T.BoxGeometry(sx, WH, sz), new T.MeshStandardMaterial({ map: t, roughness: 0.75, metalness: 0.3 }));
      m.position.set(cx, WH / 2, cz); m.receiveShadow = true; scene.add(m);
      W.addBox({ minX: cx - sx / 2, maxX: cx + sx / 2, minZ: cz - sz / 2, maxZ: cz + sz / 2, h: WH });
    };
    wall(0, -Z - 0.5, X * 2 + 2, 1); wall(0, Z + 0.5, X * 2 + 2, 1); wall(-X - 0.5, 0, 1, Z * 2); wall(X + 0.5, 0, 1, Z * 2);
    void wallMat;

    // cover
    const crateTex = canvasTex(128, 128, (x, w, h) => {
      noise(x, w, h, '#8a6a44', [90, 60], 1500, 0.3);
      x.strokeStyle = '#4a3420'; x.lineWidth = 8; x.strokeRect(4, 4, w - 8, h - 8);
      x.lineWidth = 6; x.beginPath(); x.moveTo(8, 8); x.lineTo(w - 8, h - 8); x.stroke();
      for (let k = 1; k < 4; k++) { x.fillStyle = 'rgba(40,25,10,0.35)'; x.fillRect(0, (k * h) / 4, w, 2); }
    }, null);
    const concTex = canvasTex(128, 64, (x, w, h) => {
      noise(x, w, h, '#a29e96', [110, 70], 1500, 0.35);
      x.fillStyle = '#c8a030'; for (let k = -1; k < 6; k++) { x.save(); x.translate(k * 26, 0); x.transform(1, 0, 0.6, 1, 0, 0); x.fillRect(0, h - 14, 12, 14); x.restore(); }
    }, null);
    const mats = {
      crate: new T.MeshStandardMaterial({ map: crateTex, roughness: 0.85 }),
      conc: new T.MeshStandardMaterial({ map: concTex, roughness: 0.95 }),
      pillar: new T.MeshStandardMaterial({ color: 0x6e6a64, roughness: 0.9 }),
      cont: new T.MeshStandardMaterial({ color: 0x7a2e1e, roughness: 0.6, metalness: 0.4 }),
      cont2: new T.MeshStandardMaterial({ color: 0x1f4a6a, roughness: 0.6, metalness: 0.4 }),
    };
    const box = (mat, cx, cz, sx, sy, sz, y0 = 0) => {
      const m = new T.Mesh(new T.BoxGeometry(sx, sy, sz), mat);
      m.position.set(cx, y0 + sy / 2, cz); m.castShadow = true; m.receiveShadow = true; scene.add(m);
      const b = { minX: cx - sx / 2, maxX: cx + sx / 2, minZ: cz - sz / 2, maxZ: cz + sz / 2, h: y0 + sy };
      W.addBox(b);
      return b;
    };
    const covers = [];
    const barrier = (x, z, along) => covers.push(box(mats.conc, x, z, along ? 4 : 0.7, 1.05, along ? 0.7 : 4));
    const crate = (x, z, n = 1) => { for (let k = 0; k < n; k++) box(mats.crate, x, z, 1.25, 1.25, 1.25, k * 1.25); covers.push({ minX: x - 0.625, maxX: x + 0.625, minZ: z - 0.625, maxZ: z + 0.625, h: n * 1.25 }); };
    const pillar = (x, z) => covers.push(box(mats.pillar, x, z, 1.3, 9, 1.3));
    barrier(-12, 15, true); barrier(12, 15, true); barrier(0, 7, true); barrier(-21, -1, false); barrier(21, -1, false);
    barrier(0, -9, true); barrier(-11, -18, true); barrier(11, -18, true); barrier(-33, 2, false); barrier(33, 4, false);
    crate(-6, 21); crate(6, 21); crate(-26, 9); crate(26, 9); crate(-5, -3); crate(5.5, -3.5); crate(-18, -24); crate(18, -24);
    crate(-14, 4, 2); crate(14, 4, 2); crate(-29, -13, 2); crate(29, -13, 2); crate(0, -25, 2); crate(-7, 11, 2);
    pillar(-20, 19); pillar(20, 19); pillar(-8, -14); pillar(8, -14);
    covers.push(box(mats.cont, -36, 22, 2.6, 2.7, 8)); covers.push(box(mats.cont2, 36, -24, 2.6, 2.7, 8)); covers.push(box(mats.cont2, -38, -26, 8, 2.7, 2.6));
    R.coverBoxes = covers;
    buildCoverPoints(covers);

    // floodlights on the walls + strong key light with shadows
    const lampMat = new T.MeshBasicMaterial({ color: 0xfff2d8 });
    for (const [x, z] of [[-30, -Z], [0, -Z], [30, -Z], [-30, Z], [0, Z], [30, Z], [-X, -12], [-X, 12], [X, -12], [X, 12]]) {
      const m = new T.Mesh(new T.BoxGeometry(2.2, 0.5, 0.9), lampMat);
      m.position.set(x * 0.985, 8.2, z * 0.985); scene.add(m);
      const g = new T.Mesh(new T.CircleGeometry(9, 20).rotateX(-Math.PI / 2), new T.MeshBasicMaterial({ color: 0xffe0b0, map: W.radialTex, transparent: true, opacity: 0.18, blending: T.AdditiveBlending, depthWrite: false }));
      g.position.set(x * 0.8, 0.02, z * 0.8); scene.add(g);
    }
    W.hemi = new T.HemisphereLight(0xc8d0e0, 0x3a3630, 1.6);
    scene.add(W.hemi);
    const sun = new T.DirectionalLight(0xfff0dc, 2.4);
    sun.position.set(-25, 45, 30); sun.target.position.set(0, 0, 0);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    const sc = sun.shadow.camera; sc.left = -55; sc.right = 55; sc.top = 45; sc.bottom = -45; sc.near = 5; sc.far = 120;
    sun.shadow.bias = -0.0006; sun.shadow.normalBias = 0.03;
    scene.add(sun, sun.target);
    R.sun = sun;
    const fill = new T.DirectionalLight(0x9fb0d0, 0.6); fill.position.set(30, 20, -30); scene.add(fill);

    scene.background = new T.Color(0x1a2030);
    scene.fog = new T.Fog(0x1a2030, 80, 220);
    // a stars-only sky over the open yard
    const N = 400, pos = new Float32Array(N * 3);
    for (let k = 0; k < N; k++) { const a = Math.random() * 6.28, e = Math.random() * 1.3 + 0.2, r = 300; pos[k * 3] = Math.cos(a) * Math.cos(e) * r; pos[k * 3 + 1] = Math.sin(e) * r; pos[k * 3 + 2] = Math.sin(a) * Math.cos(e) * r; }
    const sg = new T.BufferGeometry(); sg.setAttribute('position', new T.BufferAttribute(pos, 3));
    scene.add(new T.Points(sg, new T.PointsMaterial({ color: 0xc8d4ff, size: 1.5, sizeAttenuation: false, fog: false })));

    // the world module's ground/weather/map, as they apply in here
    W.groundY = () => 0;
    W.update = function () {};
    W.setRainDensity = function () {};
    W.setQuality = function (low) { R.sun.castShadow = !low; };
    W.drawMap = function (canvas, scale) {
      const M = W.MAP, w = Math.round((M.x1 - M.x0) * scale), h = Math.round((M.z1 - M.z0) * scale);
      canvas.width = w; canvas.height = h;
      const x = canvas.getContext('2d');
      const m = (px, pz) => [(px - M.x0) * scale, (pz - M.z0) * scale];
      x.fillStyle = '#07090d'; x.fillRect(0, 0, w, h);
      const [a, b] = m(-X, -Z); x.fillStyle = '#2b2a28'; x.fillRect(a, b, X * 2 * scale, Z * 2 * scale);
      x.fillStyle = '#5a5650';
      for (const bx of W.boxes) { const [p, q] = m(bx.minX, bx.minZ); x.fillRect(p, q, (bx.maxX - bx.minX) * scale, (bx.maxZ - bx.minZ) * scale); }
    };
    W.inCity = () => true;
    W.cityDist = () => 0;
    W.randomSidewalkPoint = () => null;
    W.randomRoadPoint = () => null;
    W.roads = []; W.roadSamples = []; W.shops.length = 0;

    // a parked car to hide behind (and blow up)
    const car = G.actors.spawnCar(23, -8, 0.5, { persistent: true, color: '#2a3a4a' });
    car.persistent = true;
    R.car = car;
  };

  // spots next to each piece of cover where someone can hide
  function buildCoverPoints(covers) {
    for (const b of covers) {
      const cx = (b.minX + b.maxX) / 2, cz = (b.minZ + b.maxZ) / 2, hx = (b.maxX - b.minX) / 2, hz = (b.maxZ - b.minZ) / 2;
      const low = b.h < 1.6;
      const add = (x, z, nx, nz) => {
        if (Math.abs(x) > X - 1.5 || Math.abs(z) > Z - 1.5) return;
        R.cover.push({ x, z, nx, nz, low, box: b, taken: null });
      };
      for (const s of [-1, 1]) {
        const along = hz > 1.4 ? [-hz + 0.6, hz - 0.6] : [0];
        for (const o of along) add(cx + s * (hx + 0.75), cz + o, s, 0);
        const along2 = hx > 1.4 ? [-hx + 0.6, hx - 0.6] : [0];
        for (const o of along2) add(cx + o, cz + s * (hz + 0.75), 0, s);
      }
    }
  }

  // ---------------------------------------------------------------- waves
  const ENEMY_SPAWNS = [[-30, -31], [0, -31], [30, -31], [-40, -10], [40, -14], [-16, -30], [16, -30]];
  R.start = function () {
    R.wave = 0; R.state = 'break'; R.t = 2.5;
    G.inv.give('shotgun', 36); G.inv.give('smg', 180); G.inv.give('rifle', 30);
    G.inv.select('pistol');
    G.resetPlayer(0, 29, Math.PI);
    G.hud.objective('Kill House · Get ready');
  };
  function spawnWave() {
    R.wave++;
    const n = Math.min(3 + R.wave, 10);
    R.left = n;
    for (let k = 0; k < n; k++) {
      const [x, z] = ENEMY_SPAWNS[k % ENEMY_SPAWNS.length];
      const kind = R.wave >= 2 && k % 3 === 0 ? 'cop' : 'saint';
      G.actors.spawn(kind, x + G.R(-2, 2), z + G.R(-1, 1), { hostile: true, mission: true, rot: 0 });
    }
    G.hud.objective(`Kill House · Wave <b>${R.wave}</b> · <b>${n}</b> left`);
    G.hud.toast('Wave ' + R.wave);
  }
  R.onKill = function (c) {
    if (!c.mission || R.state !== 'fight') return;
    R.left = Math.max(0, R.left - 1);
    G.hud.objective(R.left ? `Kill House · Wave <b>${R.wave}</b> · <b>${R.left}</b> left` : `Kill House · Wave <b>${R.wave}</b> cleared`);
  };
  R.update = function (dt) {
    R.t -= dt;
    if (R.state === 'break' && R.t <= 0) { spawnWave(); R.state = 'fight'; }
    else if (R.state === 'fight' && R.left <= 0) {
      R.state = 'break'; R.t = 6;
      G.hud.say('Wave cleared. Ammo restocked. Next wave in a few seconds.', 4);
      const inv = G.inv;
      inv.reserve.shotgun = Math.max(inv.reserve.shotgun, 30); inv.reserve.smg = Math.max(inv.reserve.smg, 150); inv.reserve.rifle = Math.max(inv.reserve.rifle, 25);
      G.player.armor = Math.max(G.player.armor || 0, 50);
      // clear old bodies so the yard doesn't fill up
      for (let k = G.chars.length - 1; k >= 0; k--) if (!G.chars[k].alive && G.time - G.chars[k].diedAt > 4) G.actors.remove(G.chars[k]);
    }
  };
  R.respawn = function () {
    G.gore.clear();
    for (let k = G.chars.length - 1; k >= 0; k--) G.actors.remove(G.chars[k]);
    G.loot.clear();
    G.setHeat(0);
    R.start();
  };
})();
