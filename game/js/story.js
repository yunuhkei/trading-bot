'use strict';
// Story: Hollow Saints, Chapter One — "Hymn for the Drowned".
(function () {
  const S = (G.story = { stage: null, data: {}, checkpoint: null, flags: {} });
  const START = { x: 146, z: -175 };
  const LAUNDRO = { x: 30, z: -50.5 };
  const MARS = { x: 30, z: -49.3 };
  const MOTEL = { x: -191.5, z: 150 };
  S.START = START;
  const PAWN = { x: -30, z: -50.3 };
  // safehouses: rest here to heal and save (once the story unlocks them)
  const SAFEHOUSES = [{ id: 'motel', name: 'Calvary Motel, room 9', x: -192.2, z: 150, flag: 'motel' }];

  const INTRO = [
    { h: 'Port Calvary · 3:12 a.m.', t: 'Six years ago, Detective Elias Crowe was convicted of executing a witness in an interview room on the fourth floor of the Ninth Precinct.\n\nHe says he didn\'t do it. He also says he doesn\'t remember that night.' },
    { h: 'The Harbor Line', t: 'Tonight his prison transport was rammed off the road. The guards were shot where they sat.\n\nThe shooters wore badges. A patrol car rolled past and they ran, mid-job. Their car is still idling at the curb.' },
    { h: 'Marisol Ortega', t: 'Someone wants Crowe dead before he remembers. One person might know why: Mars, the informant he kept alive when nobody else would.\n\nShe runs a laundromat on Vesper Street, under the pink sign.' },
  ];
  const TITLE = { title: true, h: 'Hollow Saints', t: 'Chapter One — Hymn for the Drowned' };
  const MARS_CARDS = [
    { h: 'St. Agnes Wash', t: 'Mars is propped against the laundromat door under the buzzing neon. Three shots. Someone hung a tin halo around her neck.\n\nThe Saints\' calling card. They knew you would come here.' },
    { h: '', t: 'Her fist is still closed around something.\n\nThen you hear boots in the alley. White masks. Hollow halos.' },
  ];
  const END_CARDS = [
    { h: 'Calvary Motel · Room 9', t: 'Blinds shut. Rain on the roof. You read the ledger by the light from the parking lot.\n\nPage one: Captain Augustine Hale. The man who testified against you. Forty thousand a month, every month, for six years.' },
    { h: '', t: 'Under Hale: a deputy mayor, two judges, the bishop of St. Jude\'s, and a column of badge numbers. Eleven names in all.\n\nThe Hollow Saints.' },
    { h: '', t: 'The last page is in your handwriting. It is dated the night of the killing.\n\n"Forgive me, Mars. I put her in the water where they told me to."\n\nYou don\'t remember writing it.' },
  ];

  const dist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);

  S.start = function (save) {
    // the dead: the guards at the wreck, and Mars at her door
    G.actors.spawn('guard', 146.5, -183.5, { dead: true, persistent: true, rot: 2.2 });
    G.actors.spawn('guard', 154.5, -177.2, { dead: true, persistent: true, rot: -0.6 });
    S.mars = G.actors.spawn('mars', MARS.x, MARS.z, { dead: true, persistent: true, pose: 'sit', rot: Math.PI });
    const car = G.actors.spawnCar(138, -182.2, Math.PI / 2 + 0.25, { color: '#141619', persistent: true, lights: true });
    car.idling = true;
    G.stats.start = G.time;
    if (save && save.cp) {
      G.applySave(save);
      S.flags = save.flags || {};
      S.checkpoint = save.cp;
      S.respawn(true);
      G.hud.say('Welcome back.', 2.5);
      return;
    }
    S.go('intro');
  };
  S.safehouseAt = function (x, z) {
    for (const h of SAFEHOUSES) if (S.flags[h.flag] && Math.hypot(h.x - x, h.z - z) < 2.6) return h;
    return null;
  };
  S.useSafehouse = function (h) {
    if (G.wanted.level > 0) { G.hud.say('Not with cops on you. Lose them first.', 3); return; }
    G.player.hp = 100;
    S.checkpoint = { x: h.x + 2, z: h.z, stage: S.stage === 'rest' ? 'free' : S.stage, heat: 0, rot: Math.PI / 2 };
    if (S.stage === 'rest') { S.go('restDone'); return; }
    G.saveGame('safehouse');
    G.hud.toast('Saved');
    G.hud.say('Rested at ' + h.name + '. Game saved.', 3);
  };
  S.onPurchase = function (it) {
    if (S.stage === 'pawn' && (it.weapon || it.armor)) S.go('rest');
  };
  function checkpoint(cp) { S.checkpoint = cp; G.saveGame('checkpoint'); }

  S.go = function (id) {
    S.stage = id;
    const st = STAGES[id];
    if (st && st.enter) st.enter();
  };
  S.update = function (dt) {
    const st = STAGES[S.stage];
    if (st && st.update) st.update(dt);
  };

  S.respawn = function (fromSave) {
    const cp = S.checkpoint || { x: START.x, z: START.z, stage: 'find', heat: 0 };
    for (let k = G.chars.length - 1; k >= 0; k--) {
      const c = G.chars[k];
      if (c.kind === 'cop' || c.kind === 'saint') G.actors.remove(c);
    }
    for (let k = G.cars.length - 1; k >= 0; k--) {
      const car = G.cars[k];
      if (car.cop || car.mission) G.actors.removeCar(car);
    }
    G.resetPlayer(cp.x, cp.z, cp.rot || 0);
    G.setHeat(0);
    G.loot.clear();
    if (!fromSave) {
      const bill = Math.min(Math.round(G.money * 0.1), 300);
      if (bill > 0) { G.money -= bill; setTimeout(() => G.hud.say('Back-alley doctor took $' + bill + '.', 3), 300); }
    }
    S.go(cp.stage);
    if (cp.heat) G.setHeat(cp.heat);
  };

  function spawnSaint(x, z) {
    G.actors.spawn('saint', x, z, { hostile: true, mission: true });
  }

  const STAGES = {
    intro: {
      enter() {
        G.hud.cards(INTRO, () => G.hud.cards([TITLE], () => S.go('find')));
      },
    },
    find: {
      enter() {
        checkpoint({ x: START.x, z: START.z, stage: 'find', heat: 0, rot: -2.4 });
        G.hud.objective('Find Marisol at the <b>St. Agnes</b> laundromat');
        G.setWaypoint(LAUNDRO.x, LAUNDRO.z);
        G.hud.say('Take their car. Follow the marker.', 5);
      },
      update() {
        if (dist(G.player, LAUNDRO) < 7) S.go('mars');
      },
    },
    mars: {
      enter() {
        G.setWaypoint(null);
        G.hud.cards(MARS_CARDS, () => S.go('fight'));
      },
    },
    fight: {
      enter() {
        checkpoint({ x: 20, z: -57, stage: 'fight', heat: 0, rot: 0 });
        S.data.killed = 0; S.data.total = 6; S.data.wave2 = false;
        G.suppressShotHeat = true;
        spawnSaint(12, -60); spawnSaint(48, -60.5); spawnSaint(-0.5, -40); spawnSaint(60.5, -36);
        S.objFight();
        G.hud.say('Saints. Four of them. Don\'t let them flank you.', 4);
      },
      update() {
        if (!S.data.wave2 && S.data.killed >= 3) {
          S.data.wave2 = true;
          const van = G.actors.spawnCar(30, -63, -Math.PI / 2, { van: true, color: '#0b0b0d', lights: true });
          van.mission = true;
          spawnSaint(28, -59.8); spawnSaint(32.5, -59.8);
          G.hud.say('A black van. No plates. Two more.', 4);
        }
        if (S.data.killed >= S.data.total) {
          G.suppressShotHeat = false;
          S.go('ledger');
        }
      },
    },
    ledger: {
      enter() {
        G.hud.objective('Take what Mars was holding');
        G.setWaypoint(MARS.x, MARS.z - 1.2);
        G.hud.say('Quiet again. Just the rain and the dryers.', 4);
      },
      update() {
        if (!G.player.car && dist(G.player, MARS) < 2.4) {
          G.audio.click();
          G.hud.say('A pocket ledger. Dates, payments, badge numbers.', 4.5);
          setTimeout(() => G.hud.say('Dispatch has your location. The Saints own the radio.', 4.5), 4600);
          S.go('escape');
          G.setHeat(3);
        }
      },
    },
    escape: {
      enter() {
        checkpoint({ x: 30, z: -57, stage: 'escape', heat: 2, rot: Math.PI });
        G.hud.objective('Get to the <b>Calvary Motel</b>, room 9');
        G.setWaypoint(MOTEL.x, MOTEL.z);
        S.data.nagT = 0;
      },
      update(dt) {
        S.data.nagT -= dt;
        if (dist(G.player, MOTEL) < 7) {
          if (G.wanted.level > 0) {
            if (S.data.nagT <= 0) { G.hud.say('Not with cops on you. Lose them first.', 3.5); S.data.nagT = 6; }
          } else S.go('end');
        }
      },
    },
    end: {
      enter() {
        G.setWaypoint(null);
        G.setHeat(0);
        const s = G.stats, mins = Math.floor((G.time - s.start) / 60), secs = Math.floor((G.time - s.start) % 60);
        const tally = {
          h: 'Chapter One complete',
          t: `Time  ${mins}:${String(secs).padStart(2, '0')}\nSaints put down  ${s.saints}\nPolice killed  ${s.cops}\nBystanders killed  ${s.civs}\n\nChapter Two: The Bishop's Garden. Coming soon.`,
        };
        G.hud.objective('');
        G.hud.cards(END_CARDS.concat([tally]), () => {
          S.flags.motel = true; S.flags.ch1 = true;
          G.addMoney(1000);
          G.hud.say('There was cash in the ledger\'s lining. $1,000.', 4);
          S.go('pawn');
        });
      },
    },
    // Mission 1.2, "Room 9": arm up, then rest. Teaches the shop and saving.
    pawn: {
      enter() {
        checkpoint({ x: MOTEL.x + 3, z: MOTEL.z, stage: 'pawn', heat: 0, rot: Math.PI / 2 });
        G.hud.objective('Room 9 · Buy something at the <b>pawn shop</b> on Vesper St.');
        G.setWaypoint(PAWN.x, PAWN.z);
      },
    },
    rest: {
      enter() {
        checkpoint({ x: -30, z: -54, stage: 'rest', heat: 0, rot: Math.PI });
        G.hud.objective('Room 9 · Go back to the motel and <b>rest</b>');
        G.setWaypoint(MOTEL.x - 0.7, MOTEL.z);
        G.hud.say('Room 9. Tap REST at the door to heal and save.', 4);
      },
    },
    restDone: {
      enter() {
        G.setWaypoint(null);
        G.hud.cards([{ h: 'Room 9', t: 'You sleep with the shotgun across your chest and the chair under the door handle.\n\nAt 2 a.m. the phone rings. A woman\'s voice: "You knew my sister. Mars. Meet me at the garage behind St. Jude\'s. Come alone, cop."\n\nShe hangs up before you can ask how she got the number.' }], () => S.go('free'));
      },
    },
    free: {
      enter() {
        checkpoint({ x: MOTEL.x + 3, z: MOTEL.z, stage: 'free', heat: 0, rot: Math.PI / 2 });
        G.hud.objective('Free roam · Chapter Two is coming');
        G.setWaypoint(null);
      },
    },
  };

  S.objFight = function () {
    G.hud.objective(`Kill the Saints' enforcers <b>${S.data.killed}/${S.data.total}</b>`);
  };
  S.onKill = function (c) {
    if (c.mission && c.kind === 'saint' && S.stage === 'fight') {
      S.data.killed++;
      S.objFight();
    }
  };
})();
