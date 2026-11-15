'use strict';
// Arsenal: weapons, inventory, money, armor, loot drops, shops, and saving.
(function () {
  const T = THREE, W = G.world;

  // ---------------------------------------------------------------- weapons
  // dmg is per pellet. acc(d) is the chance a pellet lands on the aimed target at distance d.
  const WEAPONS = (G.WEAPONS = {
    fists: { name: 'Fists', melee: true, rate: 0.42, dmg: [20, 28], range: 1.9, aim: 3 },
    pistol: { name: 'Pistol', spread: 0.02, aimSpread: 0.004, bloom: 0.012, bloomMax: 0.05, kick: 0.028, rate: 0.27, mag: 12, reload: 1.3, pellets: 1, dmg: [36, 48], spread: 0.015, power: 4, range: 70, aim: 36, vol: 1, acc: (d) => G.clamp(1.03 - d * 0.012, 0.6, 0.97), drive: true },
    shotgun: { name: 'Shotgun', spread: 0.09, aimSpread: 0.065, bloom: 0, bloomMax: 0, kick: 0.07, rate: 0.85, mag: 6, reload: 2.1, pellets: 7, dmg: [13, 19], spread: 0.11, power: 9, range: 30, aim: 22, vol: 1.4, acc: (d) => G.clamp(1.15 - d / 16, 0.05, 0.92) },
    smg: { name: 'SMG', spread: 0.04, aimSpread: 0.016, bloom: 0.006, bloomMax: 0.07, kick: 0.012, rate: 0.085, mag: 30, reload: 1.6, pellets: 1, dmg: [15, 21], spread: 0.045, power: 2.6, range: 55, aim: 34, vol: 0.65, auto: true, acc: (d) => G.clamp(0.95 - d * 0.014, 0.4, 0.88), drive: true },
    rifle: { name: 'Rifle', spread: 0.02, aimSpread: 0.0012, bloom: 0.03, bloomMax: 0.05, kick: 0.075, zoom: true, rate: 0.95, mag: 5, reload: 2.3, pellets: 1, dmg: [95, 125], spread: 0.003, power: 7.5, range: 140, aim: 85, vol: 1.6, acc: (d) => G.clamp(1.0 - d * 0.003, 0.82, 0.99) },
  });
  const ORDER = ['fists', 'pistol', 'shotgun', 'smg', 'rifle'];

  const inv = (G.inv = {
    owned: { fists: true, pistol: true }, cur: 'pistol',
    mag: { pistol: 12, shotgun: 0, smg: 0, rifle: 0 },
    reserve: { pistol: Infinity, shotgun: 0, smg: 0, rifle: 0 },
  });
  G.money = 0;
  inv.weapon = () => WEAPONS[inv.cur];
  inv.hasAmmo = (k) => k === 'fists' || inv.mag[k] > 0 || inv.reserve[k] > 0;
  inv.give = function (k, ammo) {
    const firstTime = !inv.owned[k];
    inv.owned[k] = true;
    if (k !== 'fists' && k !== 'pistol') {
      if (firstTime) { inv.mag[k] = Math.min(WEAPONS[k].mag, ammo); ammo -= inv.mag[k]; }
      inv.reserve[k] += Math.max(0, ammo);
    }
    return firstTime;
  };
  inv.select = function (k) {
    if (!inv.owned[k] || k === inv.cur) return false;
    inv.cur = k; G.player.reloadT = 0;
    G.audio.click();
    return true;
  };
  inv.cycle = function (dir = 1) {
    let i = ORDER.indexOf(inv.cur);
    for (let n = 0; n < ORDER.length; n++) {
      i = (i + dir + ORDER.length) % ORDER.length;
      const k = ORDER[i];
      if (inv.owned[k] && inv.hasAmmo(k)) { inv.select(k); return; }
    }
  };
  inv.reset = function () {
    inv.owned = { fists: true, pistol: true }; inv.cur = 'pistol';
    inv.mag = { pistol: 12, shotgun: 0, smg: 0, rifle: 0 };
    inv.reserve = { pistol: Infinity, shotgun: 0, smg: 0, rifle: 0 };
  };

  // ---------------------------------------------------------------- money
  G.addMoney = function (n, quiet) {
    G.money = Math.max(0, Math.round(G.money + n));
    if (!quiet && n > 0) G.hud.notice('+$' + n);
  };

  // ---------------------------------------------------------------- loot
  const pickups = [];
  const PK = {
    cash: { color: 0x3dff88, size: [0.32, 0.12, 0.2] },
    ammo: { color: 0xffd04a, size: [0.3, 0.22, 0.22] },
    weapon: { color: 0xeae2cc, size: [0.75, 0.14, 0.22] },
    armor: { color: 0x4aa8ff, size: [0.4, 0.45, 0.14] },
  };
  const pkGeo = new T.BoxGeometry(1, 1, 1);
  const pkMats = {};
  function spawnPickup(type, x, z, data) {
    const s = PK[type].size;
    const m = new T.Mesh(pkGeo, pkMats[type] || (pkMats[type] = new T.MeshBasicMaterial({ color: PK[type].color })));
    m.scale.set(s[0], s[1], s[2]);
    const glow = new T.Mesh(new T.CircleGeometry(0.7, 12).rotateX(-Math.PI / 2), new T.MeshBasicMaterial({ color: PK[type].color, map: W.radialTex, transparent: true, opacity: 0.6, blending: T.AdditiveBlending, depthWrite: false }));
    const gy = W.groundY(x, z);
    m.position.set(x, gy + 0.5, z); glow.position.set(x, gy + 0.03, z);
    G.scene.add(m, glow);
    pickups.push({ type, x, z, gy, m, glow, data, born: G.time, phase: Math.random() * 6 });
  }
  G.loot = {
    drop(c) {
      const r = () => G.R(-0.8, 0.8);
      if (c.kind === 'saint') {
        G.loot.spawn('cash', c.x + r(), c.z + r(), { amount: Math.round(G.R(60, 140)) });
        const roll = Math.random();
        if (roll < 0.45) G.loot.spawn(inv.owned.smg ? 'ammo' : 'weapon', c.x + r(), c.z + r(), { weapon: 'smg', ammo: 60 });
        else if (roll < 0.75) G.loot.spawn(inv.owned.shotgun ? 'ammo' : 'weapon', c.x + r(), c.z + r(), { weapon: 'shotgun', ammo: 12 });
        if (Math.random() < 0.15) G.loot.spawn('armor', c.x + r(), c.z + r(), { amount: 40 });
      } else if (c.kind === 'cop') {
        G.loot.spawn('cash', c.x + r(), c.z + r(), { amount: Math.round(G.R(20, 60)) });
        if (Math.random() < 0.4) G.loot.spawn(inv.owned.shotgun ? 'ammo' : 'weapon', c.x + r(), c.z + r(), { weapon: 'shotgun', ammo: 8 });
      } else if (c.kind === 'ped' && Math.random() < 0.6) {
        G.loot.spawn('cash', c.x + r(), c.z + r(), { amount: Math.round(G.R(5, 40)) });
      }
    },
    spawn: spawnPickup,
    update(dt) {
      const pl = G.player;
      for (let k = pickups.length - 1; k >= 0; k--) {
        const p = pickups[k];
        p.phase += dt * 2.5;
        p.m.position.y = p.gy + 0.5 + Math.sin(p.phase) * 0.08;
        p.m.rotation.y += dt * 1.6;
        const d = Math.hypot(pl.x - p.x, pl.z - p.z);
        const old = G.time - p.born > 90 || d > 160;
        if (pl.alive && d < (pl.car ? 3.2 : 1.6)) collect(p);
        else if (!old) continue;
        G.scene.remove(p.m, p.glow);
        pickups.splice(k, 1);
      }
    },
    clear() { for (const p of pickups) G.scene.remove(p.m, p.glow); pickups.length = 0; },
  };
  function collect(p) {
    G.audio.click();
    if (p.type === 'cash') G.addMoney(p.data.amount);
    else if (p.type === 'armor') { G.player.armor = Math.min(100, (G.player.armor || 0) + p.data.amount); G.hud.notice('+' + p.data.amount + ' armor'); }
    else {
      const first = inv.give(p.data.weapon, p.data.ammo);
      const name = WEAPONS[p.data.weapon].name;
      G.hud.notice(first ? name + '. Picked up' : '+' + p.data.ammo + ' ' + name + ' ammo');
      if (first) inv.select(p.data.weapon);
    }
  }

  // ---------------------------------------------------------------- shops
  const STOCK = [
    { id: 'shotgun', name: 'Pump shotgun', desc: 'Close range. Puts people on the floor.', price: 450, weapon: 'shotgun', ammo: 18 },
    { id: 'smg', name: 'Submachine gun', desc: 'Fully automatic. Works from a car window.', price: 800, weapon: 'smg', ammo: 90 },
    { id: 'rifle', name: 'Hunting rifle', desc: 'Long range, one shot, one body.', price: 1500, weapon: 'rifle', ammo: 15 },
    { id: 'shells', name: 'Shotgun shells ×12', desc: '', price: 60, ammoFor: 'shotgun', ammo: 12 },
    { id: 'smgammo', name: 'SMG magazines ×60', desc: '', price: 80, ammoFor: 'smg', ammo: 60 },
    { id: 'rifleammo', name: 'Rifle rounds ×10', desc: '', price: 120, ammoFor: 'rifle', ammo: 10 },
    { id: 'armor', name: 'Body armor', desc: 'Soaks up most of a bullet. Wears out.', price: 250, armor: 100 },
    { id: 'medkit', name: 'Medkit', desc: 'Patches you up to full.', price: 100, heal: true },
  ];
  G.shops = W.shops;
  G.shopAt = function (x, z) {
    for (const s of G.shops) if (Math.hypot(s.x - x, s.z - z) < 2.8) return s;
    return null;
  };
  let openShop = null;
  G.openShop = function (shop) {
    openShop = shop;
    G.shopOpen = true;
    G.resetInput();
    if (document.pointerLockElement) document.exitPointerLock();
    renderShop();
    document.getElementById('shop').hidden = false;
  };
  G.closeShop = function () {
    openShop = null; G.shopOpen = false;
    document.getElementById('shop').hidden = true;
    G.resetInput();
    G.saveGame('shop');
  };
  function canBuy(it) {
    if (G.money < it.price) return [false, 'Not enough cash'];
    if (it.weapon && inv.owned[it.weapon]) return [false, 'Owned'];
    if (it.ammoFor && !inv.owned[it.ammoFor]) return [false, 'Need the gun'];
    if (it.armor && (G.player.armor || 0) >= 100) return [false, 'Full'];
    if (it.heal && G.player.hp >= 100) return [false, 'Healthy'];
    return [true, '$' + it.price];
  }
  function buy(it) {
    const [ok] = canBuy(it);
    if (!ok) return;
    G.money -= it.price;
    if (it.weapon) { inv.give(it.weapon, it.ammo); inv.select(it.weapon); }
    if (it.ammoFor) inv.reserve[it.ammoFor] += it.ammo;
    if (it.armor) G.player.armor = 100;
    if (it.heal) G.player.hp = 100;
    G.audio.click();
    G.story.onPurchase && G.story.onPurchase(it);
    renderShop();
  }
  function renderShop() {
    const list = document.getElementById('shopList');
    document.getElementById('shopName').textContent = openShop.name;
    document.getElementById('shopCash').textContent = '$' + G.money.toLocaleString();
    list.textContent = '';
    for (const it of STOCK) {
      const row = document.createElement('div');
      row.className = 'shop-row';
      const [ok, label] = canBuy(it);
      const info = document.createElement('div');
      const nm = document.createElement('b'); nm.textContent = it.name;
      info.appendChild(nm);
      if (it.desc) { const ds = document.createElement('span'); ds.textContent = it.desc; info.appendChild(ds); }
      const btn = document.createElement('button');
      btn.className = 'buy'; btn.textContent = label; btn.disabled = !ok;
      btn.addEventListener('click', () => buy(it));
      row.append(info, btn);
      list.appendChild(row);
    }
  }

  // ---------------------------------------------------------------- saving
  const KEY = 'save';
  G.saveGame = function (why) {
    if (!G.running || !G.story.checkpoint) return;
    const p = G.player;
    const data = {
      v: 1, at: Date.now(), why,
      cp: G.story.checkpoint, flags: G.story.flags || {},
      money: G.money, armor: Math.round(p.armor || 0),
      inv: { owned: inv.owned, cur: inv.cur, mag: inv.mag, reserve: Object.fromEntries(Object.entries(inv.reserve).map(([k, v]) => [k, v === Infinity ? -1 : v])) },
      stats: G.stats,
    };
    G.store.set(KEY, data);
    return data;
  };
  G.loadSave = () => G.store.get(KEY, null);
  G.applySave = function (data) {
    G.money = data.money || 0;
    G.player.armor = data.armor || 0;
    inv.owned = Object.assign({ fists: true, pistol: true }, data.inv.owned);
    inv.cur = data.inv.cur || 'pistol';
    inv.mag = Object.assign({ pistol: 12, shotgun: 0, smg: 0, rifle: 0 }, data.inv.mag);
    inv.reserve = { pistol: Infinity, shotgun: 0, smg: 0, rifle: 0 };
    for (const [k, v] of Object.entries(data.inv.reserve || {})) inv.reserve[k] = v < 0 ? Infinity : v;
    Object.assign(G.stats, data.stats || {});
  };
  G.clearSave = () => { try { localStorage.removeItem('hs_' + KEY); } catch (e) { /* blocked */ } };
  // a copyable backup, in case the browser forgets
  G.saveCode = function () {
    const d = G.saveGame('code') || G.loadSave();
    if (!d) return '';
    return 'HS1-' + btoa(unescape(encodeURIComponent(JSON.stringify(d))));
  };
  G.loadCode = function (code) {
    try {
      const raw = code.trim();
      if (!raw.startsWith('HS1-')) return false;
      const d = JSON.parse(decodeURIComponent(escape(atob(raw.slice(4)))));
      if (!d || d.v !== 1 || !d.cp) return false;
      G.store.set(KEY, d);
      return true;
    } catch (e) { return false; }
  };
})();
