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

## Next (in this order, one commit each)
4. Supercars and looks (creases, distinct nose / tail, paint types, plates, seams).
5. Full suite on a frozen build, READMEs, final report.

## Known, not fixed
- Ring / `sc2` junction: an occasional queue on the side road (dissolved by the jam rule) and low-speed bumps between a car turning in and one on the ring. `rtraffic` (150 s a place) is not clean since batch 2: valley, ring and San Jose show a car 6.1-6.4 m off its lane (limit 6; long vehicles in a turn) and, depending on the run, 2-13 low-speed wrecks at such merges. Not caused by the police work (same on the batch 2 build).
- The CC cars have no opening panels (bonnet, doors) and the cabin is Close Call's tall glass box.
- `rcars.js`: two checks fail and already failed before this work ("every body is made of finite numbers ..." and "every body is the length, width and height of its spec"). To look at in batch 4.
- The helicopter is built from boxes (reads fine at 30-45 m, plain close up); a burst tyre is not shown on the wheel itself (sparks only).
- Brakes and cornering do not share the tyre (arcade, left as it is).
