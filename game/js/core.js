'use strict';
// Core: shared namespace, math helpers, input (touch + keyboard/mouse), procedural audio.
(function () {
  const G = (window.G = {});

  G.mulberry32 = function (a) {
    return function () {
      a |= 0; a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  };
  G.R = (a, b) => a + Math.random() * (b - a);
  G.clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  G.lerp = (a, b, t) => a + (b - a) * t;
  G.wrapAngle = (a) => {
    a = (a + Math.PI) % (Math.PI * 2);
    if (a < 0) a += Math.PI * 2;
    return a - Math.PI;
  };
  G.angleLerp = (a, b, t) => a + G.wrapAngle(b - a) * t;
  G.pick = (arr) => arr[(Math.random() * arr.length) | 0];
  G.store = {
    get(k, d) { try { const v = localStorage.getItem('hs_' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem('hs_' + k, JSON.stringify(v)); } catch (e) { /* storage blocked */ } },
  };

  // ---------------------------------------------------------------- input
  const input = (G.input = {
    mx: 0, my: 0, lookDX: 0, lookDY: 0,
    fire: false, action: false, reload: false, sprint: false,
    gas: false, brakeIn: false, handbrake: false, steer: 0,
    usingTouch: false,
  });
  const keys = {};
  const joy = { id: null, ox: 0, oy: 0, x: 0, y: 0 };
  const look = { id: null, x: 0, y: 0 };
  const JR = 56;
  const touch = { fire: false, gas: false, brake: false, hand: false, left: false, right: false };
  let mouseFire = false, ui = null, area = null, runOn = false, aimOn = false, mouseAim = false, crouchOn = false;
  G.toggleAim = () => { aimOn = !aimOn; return aimOn; };
  G.setAim = (v) => { aimOn = v; };
  G.toggleCrouch = () => { crouchOn = !crouchOn; return crouchOn; };
  G.setCrouch = (v) => { crouchOn = v; };
  // RUN is a toggle so the right thumb stays free for aiming
  G.toggleRun = () => { runOn = !runOn; return runOn; };
  G.isRunning = () => runOn;

  G.initInput = function (el, uiHooks) {
    area = el; ui = uiHooks;
    el.addEventListener('pointerdown', (e) => {
      if (G.blockInput) return;
      if (e.pointerType === 'mouse') {
        if (document.pointerLockElement !== el && el.requestPointerLock) {
          try { const p = el.requestPointerLock(); if (p && p.catch) p.catch(() => {}); } catch (_) { /* refused */ }
        }
        if (e.button === 0) mouseFire = true;
        if (e.button === 2) mouseAim = true;
        return;
      }
      e.preventDefault();
      if (!input.usingTouch) { input.usingTouch = true; document.body.classList.add('touch'); }
      if (!G.driving && e.clientX < window.innerWidth * 0.42 && joy.id === null) {
        joy.id = e.pointerId; joy.ox = e.clientX; joy.oy = e.clientY; joy.x = joy.y = 0;
        ui && ui.joyShow(joy.ox, joy.oy);
      } else if (look.id === null) {
        look.id = e.pointerId; look.x = e.clientX; look.y = e.clientY;
      }
      try { el.setPointerCapture(e.pointerId); } catch (_) { /* ignore */ }
    }, { passive: false });

    el.addEventListener('pointermove', (e) => {
      if (e.pointerType === 'mouse') {
        if (document.pointerLockElement === el || e.buttons) {
          const mx = e.movementX || 0, my = e.movementY || 0;
          // browsers sometimes report the whole cursor jump when the mouse is captured: ignore it
          if (Math.abs(mx) < 250 && Math.abs(my) < 250) { input.lookDX += mx; input.lookDY += my; }
        }
        return;
      }
      if (e.pointerId === joy.id) {
        let dx = e.clientX - joy.ox, dy = e.clientY - joy.oy;
        const l = Math.hypot(dx, dy);
        if (l > JR) { dx *= JR / l; dy *= JR / l; }
        joy.x = dx / JR; joy.y = -dy / JR;
        ui && ui.joyKnob(dx, dy);
      } else if (e.pointerId === look.id) {
        input.lookDX += e.clientX - look.x; input.lookDY += e.clientY - look.y;
        look.x = e.clientX; look.y = e.clientY;
      }
    });
    const end = (e) => {
      if (e.pointerType === 'mouse') { if (e.button === 0) mouseFire = false; if (e.button === 2) mouseAim = false; return; }
      if (e.pointerId === joy.id) { joy.id = null; joy.x = joy.y = 0; ui && ui.joyHide(); }
      if (e.pointerId === look.id) look.id = null;
    };
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
    window.addEventListener('mouseup', (e) => { if (e.button === 0) mouseFire = false; if (e.button === 2) mouseAim = false; });
    el.addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener('blur', () => G.resetInput());
    window.addEventListener('keydown', (e) => {
      keys[e.code] = true;
      if (!e.repeat) {
        if (e.code === 'KeyF' || e.code === 'KeyE') input.action = true;
        if (e.code === 'KeyR') input.reload = true;
        if (e.code === 'KeyC' || e.code === 'ControlLeft') { crouchOn = !crouchOn; G.onCrouchKey && G.onCrouchKey(crouchOn); }
        if (e.code === 'KeyP' || e.code === 'Escape') G.onPauseKey && G.onPauseKey();
      }
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
    });
    window.addEventListener('keyup', (e) => { keys[e.code] = false; });
  };

  G.bindHold = function (el, onChange) {
    el.addEventListener('pointerdown', (e) => {
      e.preventDefault(); e.stopPropagation();
      if (!input.usingTouch && e.pointerType !== 'mouse') { input.usingTouch = true; document.body.classList.add('touch'); }
      onChange(true);
      try { el.setPointerCapture(e.pointerId); } catch (_) { /* ignore */ }
    });
    const up = () => onChange(false);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    el.addEventListener('contextmenu', (e) => e.preventDefault());
  };
  G.setTouch = (name, v) => { touch[name] = v; };

  G.readInput = function () {
    if (joy.id !== null) {
      input.mx = joy.x; input.my = joy.y;
      input.sprint = runOn || Math.hypot(joy.x, joy.y) > 0.93;
    } else {
      const kx = (keys.KeyD || keys.ArrowRight ? 1 : 0) - (keys.KeyA || keys.ArrowLeft ? 1 : 0);
      const ky = (keys.KeyW || keys.ArrowUp ? 1 : 0) - (keys.KeyS || keys.ArrowDown ? 1 : 0);
      const l = Math.hypot(kx, ky) || 1;
      input.mx = kx / l; input.my = ky / l;
      input.sprint = runOn || !!(keys.ShiftLeft || keys.ShiftRight);
    }
    input.fire = mouseFire || touch.fire || !!keys.KeyJ;
    input.aim = aimOn || mouseAim;
    input.crouch = crouchOn;
    input.gas = touch.gas || !!(keys.KeyW || keys.ArrowUp);
    input.brakeIn = touch.brake || !!(keys.KeyS || keys.ArrowDown);
    input.handbrake = touch.hand || !!keys.Space;
    input.steer = (touch.right || keys.KeyD || keys.ArrowRight ? 1 : 0) - (touch.left || keys.KeyA || keys.ArrowLeft ? 1 : 0);
  };
  G.clearEdges = function () { input.action = false; input.reload = false; input.lookDX = 0; input.lookDY = 0; };
  G.resetInput = function () {
    for (const k in keys) keys[k] = false;
    mouseFire = false;
    for (const k in touch) touch[k] = false;
    joy.id = null; joy.x = joy.y = 0; look.id = null;
    ui && ui.joyHide();
    G.clearEdges();
  };

  // ---------------------------------------------------------------- audio
  const A = (G.audio = { ctx: null, muted: G.store.get('muted', false) });
  A.init = function () {
    if (A.ctx) { if (A.ctx.resume) A.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    let ctx;
    try { ctx = A.ctx = new AC(); } catch (e) { return; }
    A.master = ctx.createGain();
    A.master.gain.value = A.muted ? 0 : 0.85;
    A.master.connect(ctx.destination);
    const len = ctx.sampleRate * 2;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    A.noise = buf;
    // the yard's echo: a generated impulse response (decaying, slightly stereo noise)
    const irLen = Math.floor(ctx.sampleRate * 1.6), ir = ctx.createBuffer(2, irLen, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d2 = ir.getChannelData(ch);
      for (let i = 0; i < irLen; i++) { const t = i / irLen; d2[i] = (Math.random() * 2 - 1) * Math.pow(1 - t, 3.2) * (i < ctx.sampleRate * 0.012 ? 0 : 1); }
    }
    A.verb = ctx.createConvolver(); A.verb.buffer = ir;
    A.verbIn = ctx.createGain(); A.verbIn.gain.value = 0.5;
    A.verbIn.connect(A.verb).connect(A.master);
    // rain bed
    const rain = ctx.createBufferSource(); rain.buffer = buf; rain.loop = true;
    const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 600;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 4200;
    const rg = ctx.createGain(); rg.gain.value = 0.06;
    rain.connect(hp).connect(lp).connect(rg).connect(A.master); rain.start();
    // low city hum
    const hum = ctx.createOscillator(); hum.frequency.value = 46;
    const hg = ctx.createGain(); hg.gain.value = 0.02;
    hum.connect(hg).connect(A.master); hum.start();
    // engine
    A.eng = ctx.createOscillator(); A.eng.type = 'sawtooth'; A.eng.frequency.value = 40;
    A.engF = ctx.createBiquadFilter(); A.engF.type = 'lowpass'; A.engF.frequency.value = 260;
    A.engG = ctx.createGain(); A.engG.gain.value = 0;
    A.eng.connect(A.engF).connect(A.engG).connect(A.master); A.eng.start();
    // siren
    A.sir = ctx.createOscillator(); A.sir.type = 'triangle'; A.sir.frequency.value = 700;
    A.sirG = ctx.createGain(); A.sirG.gain.value = 0;
    A.sir.connect(A.sirG).connect(A.master); A.sir.start();
  };
  A.setMuted = function (m) {
    A.muted = m; G.store.set('muted', m);
    if (A.master) A.master.gain.setTargetAtTime(m ? 0 : 0.85, A.ctx.currentTime, 0.05);
  };
  function burst(vol, f0, f1, dur, type) {
    if (!A.ctx || A.muted || vol < 0.01) return;
    const ctx = A.ctx, t = ctx.currentTime;
    const s = ctx.createBufferSource(); s.buffer = A.noise;
    const f = ctx.createBiquadFilter(); f.type = type || 'lowpass';
    f.frequency.setValueAtTime(f0, t); f.frequency.exponentialRampToValueAtTime(f1, t + dur * 0.6);
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    s.connect(f).connect(g).connect(A.master);
    s.start(t, Math.random() * 1.2, dur + 0.05);
  }
  function thump(vol, f0, f1, dur) {
    if (!A.ctx || A.muted || vol < 0.01) return;
    const ctx = A.ctx, t = ctx.currentTime;
    const o = ctx.createOscillator();
    o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(f1, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g).connect(A.master); o.start(t); o.stop(t + dur + 0.05);
  }
  A.shot = (vol = 1) => A.gun('pistol', vol);
  // a layered gunshot: crack (transient), body (filtered blast), thump (low end), mechanism click, echo
  const GUNS = {
    pistol: { crack: 0.7, body: 0.75, bodyF: [3200, 260], bodyT: 0.16, low: [140, 42, 0.16, 0.6], click: 0.12, verb: 0.35 },
    smg: { crack: 0.55, body: 0.55, bodyF: [4200, 420], bodyT: 0.1, low: [170, 60, 0.1, 0.4], click: 0.1, verb: 0.25 },
    shotgun: { crack: 0.8, body: 1.0, bodyF: [2400, 120], bodyT: 0.34, low: [85, 28, 0.32, 1.0], click: 0, verb: 0.5 },
    rifle: { crack: 1.0, body: 0.9, bodyF: [5200, 200], bodyT: 0.28, low: [110, 32, 0.26, 0.85], click: 0.08, verb: 0.65 },
  };
  A.gun = function (kind, vol = 1) {
    if (!A.ctx || A.muted || vol < 0.02) return;
    const g = GUNS[kind] || GUNS.pistol, ctx = A.ctx, t = ctx.currentTime;
    const out = ctx.createGain(); out.gain.value = vol;
    out.connect(A.master);
    const send = ctx.createGain(); send.gain.value = g.verb; out.connect(send).connect(A.verbIn);
    // crack
    const c = ctx.createBufferSource(); c.buffer = A.noise;
    const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 2200;
    const cg = ctx.createGain(); cg.gain.setValueAtTime(g.crack, t); cg.gain.exponentialRampToValueAtTime(0.001, t + 0.035);
    c.connect(hp).connect(cg).connect(out); c.start(t, Math.random(), 0.05);
    // body
    const b = ctx.createBufferSource(); b.buffer = A.noise;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.Q.value = 0.8;
    lp.frequency.setValueAtTime(g.bodyF[0], t); lp.frequency.exponentialRampToValueAtTime(g.bodyF[1], t + g.bodyT);
    const bg = ctx.createGain(); bg.gain.setValueAtTime(g.body, t + 0.002); bg.gain.exponentialRampToValueAtTime(0.001, t + g.bodyT * 1.3);
    b.connect(lp).connect(bg).connect(out); b.start(t, Math.random(), g.bodyT * 1.4);
    // thump
    const o = ctx.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(g.low[0], t); o.frequency.exponentialRampToValueAtTime(g.low[1], t + g.low[2]);
    const og = ctx.createGain(); og.gain.setValueAtTime(g.low[3], t); og.gain.exponentialRampToValueAtTime(0.001, t + g.low[2] * 1.2);
    o.connect(og).connect(out); o.start(t); o.stop(t + g.low[2] * 1.3);
    // the action cycling
    if (g.click) metal(g.click * vol, 2800, 0.02, 0.012);
  };
  function metal(vol, f, dur, delay) {
    if (!A.ctx || A.muted || vol < 0.01) return;
    const ctx = A.ctx, t = ctx.currentTime + (delay || 0);
    const s2 = ctx.createBufferSource(); s2.buffer = A.noise;
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = f; bp.Q.value = 7;
    const g = ctx.createGain(); g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0005, t + dur);
    s2.connect(bp).connect(g).connect(A.master); s2.start(t, Math.random(), dur + 0.02);
  }
  // reloads and pumps: a few metallic clicks and clacks at the right moments
  A.mech = function (kind) {
    const seq = {
      magOut: [[0.35, 1800, 0.04, 0], [0.25, 900, 0.06, 0.05]],
      magIn: [[0.45, 1300, 0.05, 0], [0.3, 2600, 0.03, 0.04]],
      rack: [[0.4, 2200, 0.05, 0], [0.5, 1500, 0.06, 0.12]],
      pump: [[0.5, 900, 0.07, 0], [0.55, 1200, 0.07, 0.16]],
      shell: [[0.3, 1600, 0.04, 0]],
      dry: [[0.35, 3200, 0.025, 0]],
    }[kind] || [];
    for (const [v, f, d, dl] of seq) metal(v, f, d, dl);
  };
  A.thud = (vol = 1) => { burst(0.5 * vol, 900, 120, 0.25); thump(0.5 * vol, 90, 30, 0.18); };
  A.click = () => burst(0.25, 3000, 1500, 0.05, 'highpass');
  A.boom = () => { burst(1, 2000, 60, 1.8); thump(1, 80, 20, 1.2); };
  A.tink = (vol) => { // a shell casing hitting concrete
    if (!A.ctx || A.muted || !(vol >= 0.05)) return;
    const ctx = A.ctx, t = ctx.currentTime, o = ctx.createOscillator(), g = ctx.createGain();
    o.type = 'sine'; o.frequency.setValueAtTime(G.R(3800, 5200), t);
    g.gain.setValueAtTime(0.05 * vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.09);
    o.connect(g).connect(A.master); o.start(t); o.stop(t + 0.1);
  };
  A.tick = (kill) => { // hit marker
    if (!A.ctx || A.muted) return;
    const ctx = A.ctx, t = ctx.currentTime, o = ctx.createOscillator(), g = ctx.createGain();
    o.type = 'square'; o.frequency.setValueAtTime(kill ? 1300 : 2100, t);
    g.gain.setValueAtTime(kill ? 0.08 : 0.05, t); g.gain.exponentialRampToValueAtTime(0.0001, t + (kill ? 0.12 : 0.05));
    o.connect(g).connect(A.master); o.start(t); o.stop(t + 0.13);
  };
  A.splat = (vol) => { // flesh tearing: a wet low thud and a squelch
    if (!A.ctx || A.muted || vol < 0.05) return;
    burst(0.7 * vol, 700, 90, 0.22);
    const ctx = A.ctx, t = ctx.currentTime, s = ctx.createBufferSource(); s.buffer = A.noise;
    const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.Q.value = 3;
    f.frequency.setValueAtTime(380, t); f.frequency.exponentialRampToValueAtTime(1500, t + 0.12);
    const g = ctx.createGain(); g.gain.setValueAtTime(0.5 * vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.2);
    s.connect(f).connect(g).connect(A.master); s.start(t, Math.random(), 0.25);
  };
  A.ric = (vol) => burst(0.25 * vol, 5000, 1800, 0.12, 'bandpass');
  A.whiz = (vol) => { // a bullet passing close
    if (!A.ctx || A.muted || vol < 0.05) return;
    const ctx = A.ctx, t = ctx.currentTime, s = ctx.createBufferSource(); s.buffer = A.noise;
    const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.Q.value = 6;
    f.frequency.setValueAtTime(2600, t); f.frequency.exponentialRampToValueAtTime(900, t + 0.18);
    const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.35 * vol, t + 0.05); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.2);
    s.connect(f).connect(g).connect(A.master); s.start(t, Math.random(), 0.25);
  };
  A.honk = (vol) => {
    if (!A.ctx || A.muted || vol < 0.03) return;
    const ctx = A.ctx, t = ctx.currentTime;
    for (const f of [392, 494]) {
      const o = ctx.createOscillator(); o.type = 'square'; o.frequency.value = f;
      const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.06 * vol, t + 0.03); g.gain.setValueAtTime(0.06 * vol, t + 0.32); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.4);
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 1400;
      o.connect(lp).connect(g).connect(A.master); o.start(t); o.stop(t + 0.42);
    }
  };
  A.thunder = (delay) => {
    setTimeout(() => { burst(0.55, 500, 40, 3.2); thump(0.4, 55, 22, 2.2); }, delay * 1000);
  };
  A.update = function (engineOn, speed, sirenVol, time) {
    if (!A.ctx) return;
    const t = A.ctx.currentTime, s = Math.abs(speed);
    A.eng.frequency.setTargetAtTime(32 + s * 3.4 + (engineOn ? 6 : 0), t, 0.08);
    A.engF.frequency.setTargetAtTime(220 + s * 22, t, 0.1);
    A.engG.gain.setTargetAtTime(engineOn ? 0.05 + s * 0.0015 : 0, t, 0.15);
    A.sir.frequency.setTargetAtTime(720 + 260 * Math.sin(time * Math.PI * 1.6), t, 0.03);
    A.sirG.gain.setTargetAtTime(sirenVol * 0.03, t, 0.2);
  };
})();
