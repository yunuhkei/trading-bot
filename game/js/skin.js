'use strict';
// Skinned characters: a real rigged, motion-captured model (three.js "Soldier", Mixamo rig) for
// every person. Animation clips (idle / walk / run) are blended by speed; on top of that we pose
// the arms for two-handed weapon grips and aiming, crouch with planted feet, and kick for recoil.
// When someone dies, the Verlet ragdoll in body.js drives the skeleton bone by bone.
(function () {
  const T = THREE;
  const S = (G.skin = { ready: false });
  const J = () => G.body.J;
  const BONES = {
    hips: 'Hips', spine: 'Spine', spine1: 'Spine1', spine2: 'Spine2', neck: 'Neck', head: 'Head',
    lsh: 'LeftShoulder', larm: 'LeftArm', lfore: 'LeftForeArm', lhand: 'LeftHand',
    rsh: 'RightShoulder', rarm: 'RightArm', rfore: 'RightForeArm', rhand: 'RightHand',
    lup: 'LeftUpLeg', lleg: 'LeftLeg', lfoot: 'LeftFoot', rup: 'RightUpLeg', rleg: 'RightLeg', rfoot: 'RightFoot',
  };
  let template = null, clips = {}, scale = 1;

  function b64ToBuffer(b64) {
    const bin = atob(b64), n = bin.length, out = new Uint8Array(n);
    for (let i = 0; i < n; i++) out[i] = bin.charCodeAt(i);
    return out.buffer;
  }
  S.load = function () {
    return new Promise((resolve) => {
      const ADD = window.THREE_ADDONS;
      if (!ADD || !ADD.GLTFLoader) { resolve(false); return; }
      const done = (gltf) => {
        try {
          template = gltf.scene;
          // feet on the ground, 1.8 m tall
          template.updateMatrixWorld(true);
          const box = new T.Box3().setFromObject(template);
          const h = box.max.y - box.min.y;
          scale = h > 0.1 ? 1.8 / h : 1;
          template.traverse((o) => {
            if (o.isMesh) { o.castShadow = true; o.receiveShadow = false; o.frustumCulled = false; }
          });
          for (const clip of gltf.animations) {
            // run in place: drop the hips' forward/sideways drift, keep the bob
            for (const tr of clip.tracks) {
              if (/Hips\.position$/.test(tr.name)) {
                const v = tr.values, x0 = v[0], z0 = v[2];
                for (let i = 0; i < v.length; i += 3) { v[i] = x0; v[i + 2] = z0; }
              }
            }
            clips[clip.name.toLowerCase()] = clip;
          }
          S.ready = !!(clips.idle && clips.walk && clips.run);
          resolve(S.ready);
        } catch (e) { console.error(e); resolve(false); }
      };
      const fail = (e) => { console.error('model failed to load', e); resolve(false); };
      try {
        const loader = new ADD.GLTFLoader();
        if (window.__MODELS && window.__MODELS.soldier) loader.parse(b64ToBuffer(window.__MODELS.soldier), '', done, fail);
        else loader.load('models/Soldier.glb', done, undefined, fail);
      } catch (e) { fail(e); }
    });
  };

  // per-faction tint over the model's own textures
  const TINT = { player: 0xd0b8a0, saint: 0x2c2c32, cop: 0xffffff, guard: 0xb0b8a0, mars: 0xc09098, ped: 0xffffff, local: 0xe0d8d0 };
  S.make = function (c, kind) {
    const root = window.THREE_ADDONS.clone(template);
    root.scale.setScalar(scale * (c.body.h || 1));
    const bones = {};
    root.traverse((o) => {
      if (o.isBone) {
        const n = o.name.replace(/^mixamorig[:]?/, '');
        for (const k in BONES) if (BONES[k] === n) bones[k] = o;
      }
    });
    const mats = [];
    const tint = new T.Color(c.kind === 'ped' && kind !== 'local' ? G.pick([0xffffff, 0xe8e0d8, 0xd0d4e0, 0xe0d4c0, 0xb8b8b8]) : TINT[kind] || 0xffffff);
    root.traverse((o) => {
      if (!o.isMesh) return;
      const m = Array.isArray(o.material) ? o.material.map((x) => x.clone()) : o.material.clone();
      o.material = m;
      (Array.isArray(m) ? m : [m]).forEach((x) => { x.color = tint.clone(); x.userData.base = tint.clone(); mats.push(x); });
    });
    const mixer = new T.AnimationMixer(root);
    const acts = {};
    for (const k of ['idle', 'walk', 'run']) {
      const a = mixer.clipAction(clips[k]);
      a.play(); a.setEffectiveWeight(k === 'idle' ? 1 : 0);
      a.time = Math.random() * clips[k].duration;
      acts[k] = a;
    }
    G.scene.add(root);
    c.body.skin = { root, bones, mixer, acts, mats, w: { idle: 1, walk: 0, run: 0 } };
    return true;
  };
  S.remove = function (c) {
    const s = c.body && c.body.skin;
    if (!s) return;
    G.scene.remove(s.root);
    for (const m of s.mats) m.dispose();
    s.mixer.stopAllAction();
  };
  S.revive = function (c) {
    const s = c.body.skin;
    s.rag0 = null;
    for (const k in s.acts) { s.acts[k].reset(); s.acts[k].play(); }
    for (const m of s.mats) m.color.copy(m.userData.base);
  };
  S.setVisible = (c, v) => { if (c.body && c.body.skin) c.body.skin.root.visible = v; };
  S.tintBlood = function (c) {
    const s = c.body.skin, red = new T.Color(0x4a0508);
    for (const m of s.mats) m.color.copy(m.userData.base).lerp(red, Math.min(0.55, c.body.bloody * 0.55));
  };

  // ---------------------------------------------------------------- bone helpers
  const va = new T.Vector3(), vb = new T.Vector3(), vc = new T.Vector3(), vd = new T.Vector3();
  const qa = new T.Quaternion(), qb = new T.Quaternion(), qc = new T.Quaternion();
  const m4 = new T.Matrix4(), m5 = new T.Matrix4();
  const wpos = (o, v) => v.setFromMatrixPosition(o.matrixWorld);
  // set a bone's world rotation, keeping the hierarchy consistent
  function setWorldQuat(bone, q) {
    bone.parent.getWorldQuaternion(qc);
    bone.quaternion.copy(qc.invert().multiply(q));
    bone.updateMatrixWorld(true);
  }
  // swing a bone so its child lands along the direction toward `target` (world)
  function aim(bone, child, target) {
    wpos(bone, va); wpos(child, vb);
    vc.subVectors(vb, va).normalize();
    vd.subVectors(target, va);
    if (vd.lengthSq() < 1e-8) return;
    vd.normalize();
    qa.setFromUnitVectors(vc, vd);
    bone.getWorldQuaternion(qb);
    setWorldQuat(bone, qa.multiply(qb));
  }

  // ---------------------------------------------------------------- living pose
  // two-bone IK in world space: shoulder a, hand target c, lengths, pole direction
  function ik(a, c, l1, l2, pole, out) {
    const d = vd.subVectors(c, a);
    let dist = d.length() || 1e-4;
    const max = (l1 + l2) * 0.999;
    if (dist > max) { d.multiplyScalar(max / dist); dist = max; }
    const u = d.clone().divideScalar(dist);
    const aa = (l1 * l1 - l2 * l2 + dist * dist) / (2 * dist), h = Math.sqrt(Math.max(0, l1 * l1 - aa * aa));
    const p = pole.clone().addScaledVector(u, -pole.dot(u)).normalize();
    out.copy(a).addScaledVector(u, aa).addScaledVector(p, h);
  }
  const LONG = { shotgun: 1, smg: 1, rifle: 1 };
  const tmpE = new T.Vector3(), tmpH = new T.Vector3(), pole = new T.Vector3();
  function local(c, x, y, z, out) { // character space (x left, y up, z forward) -> world
    const s = Math.sin(c.rot), co = Math.cos(c.rot), root = c.body.skin.root;
    return out.set(root.position.x + co * x + s * z, root.position.y + y, root.position.z - s * x + co * z);
  }
  function boneLen(a, b) { wpos(a, va); wpos(b, vb); return va.distanceTo(vb); }

  S.pose = function (c, dt, speed, aiming) {
    const b = c.body, s = b.skin, B = s.bones;
    b.lastDt = dt;
    if (b.posed) b.jp.set(b.j);
    b.crouch = G.lerp(b.crouch || 0, c.crouch ? 1 : 0, Math.min(1, dt * 10));
    if (c.flinch > 0) c.flinch = Math.max(0, c.flinch - dt * 3);
    if (c.recoil > 0) c.recoil = Math.max(0, c.recoil - dt * 9);
    // animation blend by speed
    const w = s.w, target = { idle: G.clamp(1 - speed / 1.4, 0, 1), walk: speed < 1.4 ? speed / 1.4 : G.clamp(1 - (speed - 3) / 2, 0, 1), run: G.clamp((speed - 3) / 2, 0, 1) };
    let sum = 0;
    for (const k in w) { w[k] = G.lerp(w[k], target[k], Math.min(1, dt * 8)); sum += w[k]; }
    for (const k in w) s.acts[k].setEffectiveWeight(w[k] / (sum || 1));
    s.acts.walk.timeScale = G.clamp(speed / 1.5, 0.6, 2.2);
    s.acts.run.timeScale = G.clamp(speed / 5.4, 0.7, 1.6);
    s.mixer.update(dt);
    const root = s.root, cr = b.crouch;
    root.position.set(c.x, W().groundY(c.x, c.z) - cr * 0.34 * b.h, c.z);
    root.rotation.set(0, c.rot + Math.PI, 0); // the model faces -z
    root.updateMatrixWorld(true);

    // crouch: hips drop, legs fold with the feet planted where the animation put them
    if (cr > 0.02) {
      for (const [up, leg, foot, side] of [[B.lup, B.lleg, B.lfoot, 1], [B.rup, B.rleg, B.rfoot, -1]]) {
        const l1 = boneLen(up, leg), l2 = boneLen(leg, foot);
        wpos(up, tmpH);
        const f = wpos(foot, new T.Vector3()); f.y += cr * 0.34 * b.h;
        // trailing leg back, leading leg a little forward
        const k = side < 0 ? -0.25 * cr : 0.1 * cr;
        f.x += Math.sin(c.rot) * k; f.z += Math.cos(c.rot) * k;
        pole.set(Math.sin(c.rot), 0.15, Math.cos(c.rot));
        ik(tmpH, f, l1, l2, pole, tmpE);
        aim(up, leg, tmpE);
        aim(leg, foot, f);
      }
    }
    // upper body: lean into recoil, flinch back when hit, crouch hunch, aim pitch
    const pitch = (c.aimPitch || 0) * (aiming ? 1 : 0);
    const back = (c.flinch || 0) * 0.35 + (c.recoil || 0) * 0.08;
    if (back || pitch || cr) {
      const side = local(c, 1, 0, 0, new T.Vector3()).sub(root.position).normalize();
      qa.setFromAxisAngle(side, (cr * 0.25 - back + pitch) * 0.5);
      B.spine1.getWorldQuaternion(qb); setWorldQuat(B.spine1, qa.multiply(qb));
      qa.setFromAxisAngle(side, (pitch - back * 0.5) * 0.5);
      B.spine2.getWorldQuaternion(qb); setWorldQuat(B.spine2, qa.multiply(qb));
    }
    // arms: weapon stances (same targets as the procedural rig, in character space)
    const weap = c.weaponK;
    if (weap || c.punchT > 0) {
      wpos(B.rarm, va); const shY = va.y - root.position.y;
      const fwd = Math.cos(pitch), upk = -Math.sin(pitch);
      let hl, hr, poleL = [0.6, -1, -0.3], poleR = [-0.6, -1, -0.3];
      const rc = c.recoil || 0;
      if (c.punchT > 0) { hr = [-0.08, shY + 0.05, 0.6]; hl = [0.14, shY - 0.08, 0.25]; }
      else if (LONG[weap]) {
        if (aiming) { hr = [-0.1, shY - 0.13 + rc * 0.03, 0.22 - rc * 0.06]; hl = [0.03, shY - 0.11 + rc * 0.04, 0.55 - rc * 0.05]; }
        else { hr = [-0.15, shY - 0.36, 0.2]; hl = [0.03, shY - 0.25, 0.46]; }
        poleR = [-1, -0.6, -0.4]; poleL = [0.8, -1, 0];
        if (c.reloading) { hl = [0.0, shY - 0.32, 0.28]; hr = [-0.12, shY - 0.3, 0.26]; }
      } else if (aiming) {
        hr = [-0.05, shY - 0.03 + rc * 0.05, 0.5 - rc * 0.07]; hl = [0.0, shY - 0.06 + rc * 0.04, 0.47 - rc * 0.06];
        if (c.reloading) { hr = [-0.06, shY - 0.25, 0.3]; hl = [0.02, shY - 0.22, 0.28]; }
      }
      if (hr) {
        // tilt the stance with the aim pitch
        const tilt = (p) => [p[0], shY + (p[1] - shY) * fwd + p[2] * upk, p[2] * fwd - (p[1] - shY) * upk];
        if (aiming) { hr = tilt(hr); hl = tilt(hl); }
        for (const [arm, fore, hand, t, pl] of [[B.rarm, B.rfore, B.rhand, hr, poleR], [B.larm, B.lfore, B.lhand, hl, poleL]]) {
          const l1 = boneLen(arm, fore), l2 = boneLen(fore, hand);
          wpos(arm, tmpH);
          const tgt = local(c, t[0], t[1], t[2], new T.Vector3());
          local(c, pl[0], pl[1], pl[2], pole).sub(root.position).normalize();
          ik(tmpH, tgt, l1, l2, pole, tmpE);
          aim(arm, fore, tmpE);
          aim(fore, hand, tgt);
        }
      }
    }
    readJoints(c);
    if (!b.posed) { b.jp.set(b.j); b.posed = true; }
  };
  function W() { return G.world; }

  // the 15 physics/hitbox joints, read off the skeleton
  function readJoints(c) {
    const B = c.body.skin.bones, j = c.body.j, K = J();
    const put = (k, o) => { wpos(o, va); j[k * 3] = va.x; j[k * 3 + 1] = va.y; j[k * 3 + 2] = va.z; };
    put(K.PELVIS, B.hips); put(K.NECK, B.neck);
    wpos(B.head, va); wpos(B.neck, vb);
    vc.subVectors(va, vb).normalize();
    j[K.HEAD * 3] = va.x + vc.x * 0.1; j[K.HEAD * 3 + 1] = va.y + vc.y * 0.1; j[K.HEAD * 3 + 2] = va.z + vc.z * 0.1;
    put(K.SHL, B.larm); put(K.ELL, B.lfore); put(K.HAL, B.lhand);
    put(K.SHR, B.rarm); put(K.ELR, B.rfore); put(K.HAR, B.rhand);
    put(K.HPL, B.lup); put(K.KNL, B.lleg); put(K.FTL, B.lfoot);
    put(K.HPR, B.rup); put(K.KNR, B.rleg); put(K.FTR, B.rfoot);
  }
  S.readJoints = readJoints;

  // ---------------------------------------------------------------- ragdoll
  // remember the pose at the moment of death; afterwards each frame bend the skeleton to the particles
  const u0 = new T.Vector3(), s0 = new T.Vector3(), f0 = new T.Vector3(), u1 = new T.Vector3(), s1 = new T.Vector3(), f1 = new T.Vector3();
  function frame(j, K, up, side, fw) {
    up.set(j[K.NECK * 3] - j[K.PELVIS * 3], j[K.NECK * 3 + 1] - j[K.PELVIS * 3 + 1], j[K.NECK * 3 + 2] - j[K.PELVIS * 3 + 2]).normalize();
    side.set(j[K.SHL * 3] - j[K.SHR * 3], j[K.SHL * 3 + 1] - j[K.SHR * 3 + 1], j[K.SHL * 3 + 2] - j[K.SHR * 3 + 2]);
    side.addScaledVector(up, -side.dot(up)).normalize();
    fw.crossVectors(side, up);
  }
  S.startRag = function (c) {
    const s = c.body.skin, K = J();
    s.mixer.stopAllAction();
    s.root.updateMatrixWorld(true);
    readJoints(c);
    frame(c.body.j, K, u0, s0, f0);
    s.rag0 = { hipsQ: s.bones.hips.getWorldQuaternion(new T.Quaternion()), B0: new T.Matrix4().makeBasis(s0.clone(), u0.clone(), f0.clone()) };
  };
  S.driveRag = function (c, p) {
    const s = c.body.skin, B = s.bones, K = J();
    if (!s.rag0) S.startRag(c);
    // hips: place at the pelvis particle and turn the torso to match the particle frame
    frame(p, K, u1, s1, f1);
    m4.makeBasis(s1, u1, f1).multiply(m5.copy(s.rag0.B0).transpose());
    qa.setFromRotationMatrix(m4).multiply(s.rag0.hipsQ);
    vd.set(p[K.PELVIS * 3], p[K.PELVIS * 3 + 1], p[K.PELVIS * 3 + 2]);
    B.hips.parent.updateMatrixWorld(true);
    B.hips.position.copy(B.hips.parent.worldToLocal(vd.clone()));
    setWorldQuat(B.hips, qa);
    const P = (k) => new T.Vector3(p[k * 3], p[k * 3 + 1], p[k * 3 + 2]);
    // spine follows the torso; the neck points at the head
    aim(B.spine2, B.neck, P(K.NECK));
    aim(B.neck, B.head, P(K.HEAD).addScaledVector(vc.subVectors(P(K.HEAD), P(K.NECK)).normalize(), -0.1));
    aim(B.larm, B.lfore, P(K.ELL)); aim(B.lfore, B.lhand, P(K.HAL));
    aim(B.rarm, B.rfore, P(K.ELR)); aim(B.rfore, B.rhand, P(K.HAR));
    aim(B.lup, B.lleg, P(K.KNL)); aim(B.lleg, B.lfoot, P(K.FTL));
    aim(B.rup, B.rleg, P(K.KNR)); aim(B.rleg, B.rfoot, P(K.FTR));
  };
})();
