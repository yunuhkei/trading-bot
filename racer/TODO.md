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

- Batch 25: crash movie only for very big crashes; tap to skip after 1.5 s; tumbles seeded.
- Batch 26: no reversing on the WRECKED / BUSTED screen; cop packs no longer wear themselves out (rcops 4 flaky).
- Batch 27: UI fonts, no mid-event pop-ups, QUIT EVENT in pause; crash cap 24 %, scratches after the movie, rolls only with the movie; curbs a rumble; nitro rewards; TAKEDOWN; racer respawn and race traffic; garage buildings; cop lock-on and the mile rule.
- Batch 28: realistic coasting (engine braking instead of a 4.5 m/s2 stop).
- Batch 29: lane assist holds oncoming lanes; ramming racers and cops is free.
- Batch 30: dirt trails off the highways; chasers only spawn behind; cops chase across the grass; fewer roadblocks.
- Batch 43: terrain cobblestone fix, speed-blur colour ghosts fixed, shafts and contact shading on High only.
- Batch 44: shopfronts on ~190 town/downtown buildings (glass band, awning, cornice). Still plain: the upper floors of towers, row houses, other kinds of building
- Batch 45: High has no polygon cap (detail categories 3 and 4, built on first use of High); towers step back; sidewalk props; fuller trees; Low/Medium limits unchanged. Not measured: a real phone on High (software-GL +0-18 %), the one-off detail build (about 0.6 s all at once in the software box, spread over ~90 frames while driving)
- Batch 46: Auto starts on High (tier shown on screen), near-road trees on High, deeper sky / thinner haze / more saturation, a lower warmer DAY sun. The owner said batch 45 'looks the same': the honest reasons were High-only, small, hidden by motion blur, and Auto parked on Medium. Still to judge on the phone.
- Batch 47: photographed asphalt, ground and building facades (CC0: Poly Haven, ambientCG). The road and ground gain is modest (neutral detail layers); the facades are the visible change. Next in the same line: real tree and prop models (Poly Haven has 522 CC0 models, Quaternius low-poly packs), a real HDRI sky, brick / plaster for the low buildings, storefront atlas.
- Batches 37-42: terrain, trees (birch, colours), building window tile, sun shafts and contact shading, traffic lower-body shading, night mode in the SKY cycle.
- Known: `rtrail.js` check 4 (parked 120 m out in a field: the cops reach you across the grass, `offRoad` false, 6-13 s) fails the same way on the build from before batch 32. `rphys.js` J asserted that a curb jolts the car (stale since batch 27): now asserts a rumble only.
- Known: `rtraffic.js` fails on the ring (one car 10 m off its lane on `sc2`) and sometimes on the coast road: both fail identically on the build from before batch 32, so not from the art work.
- Batch 36: the Burnout look is the default (`?look=real` / `?look=classic` / `?look=cine`); Close Call cabins fixed (no pinched ends, 20 % lower).
- Batch 35: every vehicle's wheels spin (`rspin.js`).
- Batch 34: worn realistic asphalt (oil strips, tar cracks, repair patches, chipped ochre paint).
- Batch 33: raised median on divided highways (15 cm concrete, cut at junctions and U-turn gaps, `rmedian.js`).
- Batch 32: the realistic look is the default (`?look=classic` for the old one).
- Batch 31: test looks (?look=real / ?look=cine) for choosing the art direction.
- Batch 24: the crash movie plays until the car stops; harder crash damage in it; cops and racers wear down and are destroyed (test `rwear`).
- Batch 23: damage looks light on the road (wild only in the crash cam); after the crash cam the car comes back slightly smashed at the front with the doors ajar.
- Batch 22: lane assist (LANE rocker, on by default; test `rlane`).
- Batch 21: miles by default (MPH rocker for km), a map key and clickable map icons, a random start, a garage camera you can drag (`54_ux.js`).
- Batch 20: upgrades in the garage (engine, tyres, brakes, nitro, armour; three stages each, per car; `53_upg.js`).
- Batch 19: the dashboard UI (instrument-cluster HUD, pause console with everything from the top-right bar), cars changed inside a garage room you drive into (`52_dash.js`).
- Batch 18: landing a jump does no damage.
- Batch 17: wild crashes become a slow-motion cinematic, then the car is back on the road where it was 1.5 s before, with a 3 s spawn shield (`43_crash.js`).
- Batch 16 (also): traffic pulling out gives way to the player and takes the blame; Vegas Run and Desert Race routes adjusted to the new towns.
- Batch 16: Downtown, the Valley, Santa Cruz, Palm Springs with irregular outlines and outskirts; spawn and turn fixes at lights; a cop wrecking itself on you is not your crime.
- Batch 15: Las Vegas, Sacramento, San Jose natural: an avenue through the centre between two neighbourhoods at their own angles, irregular outline, whole blocks for the city buildings, cut blocks lined with shops and houses (`makeOrganicCity`).
- Batch 14: the older towns (Pacifica, Fresno, Barstow, Big Pines) and the industrial areas (Harbour, Mojave Works) natural too; the square suburb scatter round them removed.
- Batch 13: natural small towns (Gilroy, Indio, Hesperia, Tahoe, Bishop): irregular outline, bent streets, main streets to the gates, lots along the streets thinning out past the edge (`20_organic.js`).
- Batch 12: racer AI, 3 races, 2 death races, rare street racers (`69_racers.js`); police sent for 15 s after a crime.
- Batch 11: road rage (3 events), 8 speed traps, 4 jump spots, 5 drift zones (`69_spots.js`).
- Batch 10: events (8 time trials, 4 escapes) from map markers and garages, records and ghosts, money that buys cars and garages (`68_events.js`, `revents.js`).
- Batch 9: patrols only near towns (one per 110 s), one-lane spike strips with a cop beside them.
- Batch 8: five new towns joined at two points each, the northern highway (no more dead-end canyon), 18 roadside stops.
- Batch 7: 14 drive-through repair shops (`pickRepairs`, `repairStep`, `rrepair.js`).
- Batch 6: crashes roll and flip the car (and traffic), lights stay on the lamps, lamp posts fall (`42_tumble.js`, `rcrash.js`).
- Batch 5: flat tyres 7.8 s, car order, look-around camera, police you can lose (last seen place, own top speeds, lights off on patrol), taps do no damage, more traffic.

## Next (agreed with the owner, in this order)
- A story for where the player starts (the start is random for now).
- Later: online multiplayer (an update or a part 2).

## Known, not fixed
- Sacramento: now and then a car on a street that meets the avenue waits through one green (47 s at `sacau2`, the signal test allows 40).
- Downtown and the Valley: their street grids are still straight (only the outlines are irregular); the grids of the natural towns and cities bend.
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
