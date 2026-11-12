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

- Batch 12: racer AI, 3 races, 2 death races, rare street racers (`69_racers.js`); police sent for 15 s after a crime.
- Batch 11: road rage (3 events), 8 speed traps, 4 jump spots, 5 drift zones (`69_spots.js`).
- Batch 10: events (8 time trials, 4 escapes) from map markers and garages, records and ghosts, money that buys cars and garages (`68_events.js`, `revents.js`).
- Batch 9: patrols only near towns (one per 110 s), one-lane spike strips with a cop beside them.
- Batch 8: five new towns joined at two points each, the northern highway (no more dead-end canyon), 18 roadside stops.
- Batch 7: 14 drive-through repair shops (`pickRepairs`, `repairStep`, `rrepair.js`).
- Batch 6: crashes roll and flip the car (and traffic), lights stay on the lamps, lamp posts fall (`42_tumble.js`, `rcrash.js`).
- Batch 5: flat tyres 7.8 s, car order, look-around camera, police you can lose (last seen place, own top speeds, lights off on patrol), taps do no damage, more traffic.

## Next (agreed with the owner, in this order)
13. Natural cities: irregular outlines, main roads into an old centre, neighbourhoods at their own angles, curving streets, outskirts that thin out; small towns first, then the big cities.
- Later: online multiplayer (an update or a part 2).

## Known, not fixed
- Death racers ram hard (24 hits in 30 s on a slow bot): feel-test. Racers drive on the route's line and ignore you otherwise (no blocking).
- East highway: with the default traffic seed one car waits over 25 s to turn left into Hesperia's `hs2` across the busy divided highway (other seeds fine). The road bot at 34 m/s clips the signal pole on the Mojave Works boulevard and rolls.
- The far north band (snow mountains), the east mesa and the map edges are still empty country (the play area is the middle); the house roofs at roadside stops sit a little off-centre. High tier triangles downtown are within 1k of the limit.
- A fallen lamp post's sun shadow (High tier) still stands; traffic drives through a fallen post. Only street lamp posts fall (not signal or power poles).
- The road bot clips a lamp post on `sfnv1` after a long flight over a crest, and at 34 m/s a signal pole on `sfp` and `mojp` (one hit each).
- The whole map now holds 485k furniture triangles (rails, lights, shelters; it was under 200k). Only near cells are drawn and the frame budget is unchanged, but it is about 20 MB more buffer memory: watch the iPhone SE for reloads.
- Ring / `sc2` junction: an occasional queue on the side road (dissolved by the jam rule).
- The CC cars have no opening panels (bonnet, doors) and the cabin is Close Call's tall glass box.
- The supercars still share one cabin and one basic loft: noses, tails, lamps, creases and paint now differ, the glasshouse does not.
- The helicopter is built from boxes (reads fine at 30-45 m, plain close up); a burst tyre is not shown on the wheel itself (sparks only).
- Brakes and cornering do not share the tyre (arcade, left as it is).
