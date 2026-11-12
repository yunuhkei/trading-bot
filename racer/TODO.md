# Racer: where the work stands

Branch `claude/close-call-game-updates-n6s64g`. Build `python3 racer/build.py`, tests `node racer/tests/<name>.js`. Never open a pull request, never modify `Close_Call.html` / `Close_Call.backup.html`.

## Done
- Handling review (`PHYS`, `deflect()` in `src/40_car.js`, test `rphys.js`, old behaviour with `?hnd=classic` or the HANDLING switch in the car menu).

- World logic 1a: road audit, joins rebuilt (`tJoin`, `JUNC`, cross slope `r.cf`, junction boxes, crossroads, `las`), test `rnet.js`.

- World logic 1b: curbs and sidewalks (`r.sw`, `swOn`, `RQ.cb`), city crossings as landings (`cityLand`), one street family per grid edge, road LOD, `rbudget.js`.
- World logic 1c: Las Vegas, Sacramento, San Jose (`makeTown` kinds vegas / cap / tech in `22_build.js`), their roads and garages.
- World logic 1d: traffic lights (`src/24_signals.js`, `SIG`, `sigState`), test `rsig.js`.
- World logic 1e: metal guard rails (`RAILS`, `RAIL_IN`, rail block in `carStep`, sparks `41_fx`, scrape sound `50_ui`, damage src 4).
- Batch 2: Close Call cars (`73_ccars.js`, 24 drivable, names marked CC to be picked), traffic variety (bus + bus stops, refuse truck, delivery van, taxi, pickup, 10 CC civilians), paint glint; tests `rccars.js`, `rvar.js`.
- Batch 3: police overhaul (`64_cops.js` fault rule, `STARS`, `copAhead`, stuck recovery; `67_police.js` helicopters and spike strips; interceptor, SUV, SWAT truck; minimap police only), tests `rheat.js`, `rpolice.js`. **Waiting for approval: a spike strip halves the grip for 4 s (the one exception to "damage never affects driving").**
- Batch 4: supercars and looks (`CAR_STYLE`, creases / end shapes in `cgBody`, new lamps, `cgPlate` block font, paint finishes `uPt`, shader seams `uSm`, test `rlooks.js`); traffic: walking-pace bumps are not wrecks.

- Batch 7: 14 drive-through repair shops (`pickRepairs`, `repairStep`, `rrepair.js`).
- Batch 6: crashes roll and flip the car (and traffic), lights stay on the lamps, lamp posts fall (`42_tumble.js`, `rcrash.js`).
- Batch 5: flat tyres 7.8 s, car order, look-around camera, police you can lose (last seen place, own top speeds, lights off on patrol), taps do no damage, more traffic.

## Next (owner's list, in this order)
8. The map: towns and places along the empty highways, the cities connected properly.
- Still not decided: money / how cars are earned, the real names of the CC cars.

## Known, not fixed
- A fallen lamp post's sun shadow (High tier) still stands; traffic drives through a fallen post. Only street lamp posts fall (not signal or power poles).
- The road bot clips a lamp post on `sfnv1` after a long flight over a crest, and at 34 m/s a signal pole on `sfp` and `mojp` (one hit each).
- The whole map now holds 485k furniture triangles (rails, lights, shelters; it was under 200k). Only near cells are drawn and the frame budget is unchanged, but it is about 20 MB more buffer memory: watch the iPhone SE for reloads.
- Ring / `sc2` junction: an occasional queue on the side road (dissolved by the jam rule).
- The CC cars have no opening panels (bonnet, doors) and the cabin is Close Call's tall glass box.
- The supercars still share one cabin and one basic loft: noses, tails, lamps, creases and paint now differ, the glasshouse does not.
- The helicopter is built from boxes (reads fine at 30-45 m, plain close up); a burst tyre is not shown on the wheel itself (sparks only).
- Brakes and cornering do not share the tyre (arcade, left as it is).
