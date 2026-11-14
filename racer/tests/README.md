# Racer tests

Headless checks for the Racer (the browser tests run without traffic unless they ask for it, so the driving numbers are measured on an empty road; `rtraffic`, `rtrhit`, `rtrperf`, `rtrshot` turn it on): they load the built game (`Racer_Prototype.html`) in Chromium with software GL (Playwright) and drive the real physics, or
analyse the road data in Node. They cannot measure real phone frame rate or heat, so test on a phone as well.

```
python3 racer/build.py            # the tests load the BUILT file, always build first
racer/tests/run_quick.sh          # build + everything below except the long road bots (a few minutes)
racer/tests/run_quick.sh --bots   # also drives every road at 24 and 34 m/s (about 25 minutes)
node racer/tests/<name>.js        # one test; RFILE=/path/to/other.html tests another build; RACER_OUT=dir changes where screenshots go (default: $TMPDIR/racer-tests)
```

| script | what it checks |
|---|---|
| `rnet.js` | **the road network audit** (Node, 2 s): every road end sits on another road (no gap to the asphalt, no height step over 0.16 m, joins at 60 degrees or more, the mouth corners lie on the parent road even where it climbs), the only dead ends are the planned ones, no same-level crossing away from a junction, nothing lying on top of something else outside the junction boxes, the lane graph (every lane has a way on, no dead-end u-turns, one strongly connected piece), and an A* route between every pair of the places in `PLACES`, both ways, continuous and without silly detours |
| `rbudget.js` | **frame budgets**: draw calls and triangles of the world (no traffic, deterministic) at 13 places on the three tiers, against what the build that held 60 fps on an iPhone SE drew (commit c02a69c: Low 143 draws / 112k triangles, Medium 206 / 158k, High 238 / 165k; limits 146 / 113k, 210 / 160k, 240 / 167k); traffic is reported too. `RFILE=old.html` measures another build |
| `rsig.js` | **traffic lights**: (Node) how many intersections and approaches, the two phases are never open at once, the all-red gap, cycle lengths, every place has lights; (browser, `SECS=120`) traffic at four signalised places: cars that cross a stop line on green / late yellow / red (a red runner fails), both phases flow, queues form, the longest wait, wrecks, jams |
| `rccars.js` | the Close Call cars: every design builds (finite, sane size, nothing under the ground, triangles), the 24 drivable ones are in the roster and drive and brake like their kind |
| `rvar.js` | traffic variety: 20 kinds of vehicle, bus stops, near / far triangle counts, and 120 s at downtown, Las Vegas, the ring and Big Pines: which vehicles drive there, buses stopping at stops, refuse trucks stopping, wrecks, jams, CPU |
| `rtops.js` | several bird's-eye pictures in one load: `node racer/tests/rtops.js '[[x,z,height,"name"],...]'` |
| `netcheck.js` | road network in Node: roads lying on top of each other, dead ends, disconnected pieces (older and looser than `rnet.js`; its 'overlaps' now list the junction boxes, which is expected) |
| `lanecheck.js` | lane graph in Node: lane centres sit exactly where `laneInfo` puts them, no NaN, every lane has a way on, the road directions form one strongly connected piece, no road end sits at a different height from the road it joins |
| `rtraffic.js` | traffic only, car pinned beside the road, 90 s at ten places (downtown, Valley, ring, mountain pass, coast, east highway, Big Pines, harbour, Palm Springs, Mulholland): cars alive vs target, wreck rate, far-off-lane, off-road, stuck for 25 s, deadlock breaker uses, CPU per tick. `SEED=n` `SECS=n` `ONLY=a,b` |
| `rtrhit.js` | player against traffic: A collision physics on synthetic bodies (momentum, energy 1/2 mu (1-e^2) v^2, spin-out, tap), B real hits (energy and zone recorded), C a bot drives through busy traffic on three roads |
| `rgfx.js` | graphics: the three tiers render without GL errors (post target, bloom buffers, shadow map sizes), the picture is gloomy (mean brightness, low saturation, nothing blown out or crushed) at four places, lamps and neon exist, the nearest-lamp search matches brute force, the shadow map holds casters and its grid does not shimmer, sparks / spray / glows / sirens, the quality governor rules with made-up frame costs (down fast, up only with room, no flapping, never flat out), the probe, the GFX button |
| `rgfxcost.js` | what each effect costs, one switched on at a time, three places, in SwiftShader (relative weight, not phone milliseconds): `QUICK=1 node racer/tests/rgfxcost.js` |
| `rcam.js` | camera smoothness: drives with the game's own frame timing and measures how steadily the car sits in the picture while going straight, tapping nitro (on and off), a drift tap, a long drift, lifting off; and the framing at 0 / 30 / 70 m/s (the car fills 14-42 % of the width, its tyres are never cut off by the bottom edge) |
| `rnav.js` | navigation: routes between 12 pairs across the whole map (found, continuous, sane length, a few ms), progress along a route, arriving, rerouting after a wrong turn, the touchable map (drag, pinch, limits, tap a road, SET / CLEAR WAYPOINT), the path drawn on the road; the cop rules (110 mph past a cop is nothing, 125 mph is a chase; speeding alone is nothing; crashing into a car, hitting a cop) and a 100 s chase at 60 m/s (the cops stay on you, the heat never drops) |
| `rcars.js` | the 30 cars: every body builds (finite, valid, 5.5-10k triangles, size of its spec), all 30 measured on flat ground (0-100, top speed, 100-0, cornering at 100 km/h) against the real figures with rank correlations, the starter keeps the old feel, the menu (browse / locked / unlock hook / save / paint), dents on the generated bodies, smooth traffic cars with LOD and per-car dents |
| `rcarshot.js` | screenshots of cars from the front, side, rear, above (`node racer/tests/rcarshot.js 0 5 12`; `ANGLES=side,top W=800 H=450 COLS=2`) |
| `rdamage.js` | damage: zones fill from energy, health, damage does NOT change the driving, dents move vertices (and never open cracks), repair restores the pristine mesh, wrecked rule; the health bar is one energy pool (a 25 m/s hit costs 9 %, a crushed zone alone does not wreck you, nine 25 m/s hits are survived, two 60 m/s hits wreck) |
| `rsafe.js` | safe houses: pads in front of every garage door, only Home owned, servicing repairs and clears heat, locked garage does nothing, wrecked / busted respawn at the nearest owned pad, save and load |
| `rboost.js` | earning nitro (batch 27): repair shops fill it, the wrong side of the road, near misses, jumps, takedowns, holding top speed; it flows in gradually |
| `rcurb.js` | curbs (batch 27): crossing onto a sidewalk does not turn, rock, slow or trip the car |
| `rspin.js` | wheel spin (batch 35): the wheels of all 23 traffic-type vehicles change with the wheel angle, a full turn looks like zero, the same angle draws the same picture |
| `rmedian.js` | the raised median (batch 33): whole over most of a divided road, open at every junction box and U-turn gap, 15 cm up on the top and a gentle ramp for the wheels, 24 crossings at 27 and 49 mph do not turn, tip or slow the car |
| `rcoast.js` | coasting (batch 28): off the gas the car slows like a real car in gear and keeps rolling |
| `rram.js` | ramming (batch 29): driving into racers and police cars costs you nothing; civilians still damage you |
| `rtrail.js` | getting away (batch 30): dirt trails off the highways, chasers only appear behind you, cops follow you onto the grass |
| `rcops.js` | cops: heat thresholds, patrols are rare (never more than the preset allows), chase catches a 30 m/s player, boxed in = BUSTED, escape by line of sight, roadblock, Medium rams, garage clears heat, difficulty table |
| `rheat.js` | the start of a run (batch 3): from the real start a bot waits 3 s, pulls out and drives normally on the ring for `MIN` minutes (3) with traffic and cops on: the heat stays 0, no cop chases, at most 4 different patrol cars are met; every impact and crime is printed |
| `rpolice.js` | police overhaul (batch 3; 8 added in batch 5: patrols never pop up in view, light bars off on patrol, you can lose one star by driving away flat out): the star table, whose fault a crash is (a cop or a civilian that runs into you is no crime), a 45 s chase at every star (chasers, vehicle types, roadblock size, helicopters, spike strips), the helicopter (arrives, stays within 220 m, 75 s of fuel, keeps you wanted on its own), spike strips (burst, 4 s of half grip, back to normal, laid on the road ahead), minimap shows police only, a cop nose-on to a wall backs out, no police car is ever inside a building |
| `rlooks.js` | supercars and looks (batch 4): 30 different pairs of head and tail lamps, no two cars with the same nose and tail outline, paint finishes (solid / metallic / pearl / matte), a readable plate of its own for every car, the seam numbers for the shader, unit normals with the creases, triangle counts; and pixels read back from a render: white is not burnt out and has form, silver has depth, a solid red is a deep red, matte is flatter than metallic |
| `rcrash.js` | crashes (batch 6): a car hitting your side at 115 km/h rolls you (180 degrees), you end up a car again (landed or righted), with real damage and never under the ground; a forced roll ends on the roof and is righted; sliding sideways into a kerb rolls the car; a lane bot driving normally (drift taps included) never tumbles on the ring, downtown or Mulholland; a parked car T-boned at 108 km/h is thrown onto its side, at 43 km/h only knocked; the head lamp glow is on the nose and turns with the body; a lamp post falls at 58 km/h and stays up at 13 |
| `rrepair.js` | drive-through repair shops (batch 7): at least 10 on the map, the bay and its approaches clear of colliders, no guard rail between the road and any shop, and a bot that leaves the road 40 m before and drives through is fixed at every shop without hitting anything |
| `revents.js` | events and money (batch 10): 12 events on roads, the marker card, a bot drives the Ring Sprint trial through every checkpoint (medal, prize, record, ghost; a second start shows the ghost, QUIT pays nothing), an escape at two stars (lost out of sight: paid; still wanted at the end: OUT OF TIME), busted in an escape (failed, fined), buying a car and a garage, the event list in your garage; batch 11: road rage (a row of standing cars in your lane: every wreck counts and adds 4 s, no police, results), a speed trap, a jump spot and a drift zone record and pay; batch 12: a race against 4 racers finishes with a place and the racers drive the route, a death race (they ram you; T-boning one wrecks it, +500), a street racer offers a race and RACE! starts it |
| `rparts.js` | visible damage: all 30 cars have bonnet, doors, bumpers, mirrors (index runs add up), a front hit opens the bonnet and breaks the lights, hard hits tear it and the bumper off, pieces fall to the road, rest and go, doors open on the side that was hit and come off after more hits, glass cracks next to the damaged zone, repair puts it all back, **driving is identical with a wrecked body**, traffic and police cars open the panel nearest a hit, no GL error |
| `rscenery.js` | scenery: counts of poles, gantries, billboards, signs, tree belts, bushes, cacti, turbines, gas stations, pylons; nothing new stands on a road; triangle totals; build time; the same scenery on a second load |
| `renv.js` | weather / time of day: every preset renders with no GL error and the sky cube map is drawn, the picture is not blown out or crushed, the day is more colourful than the overcast look, the road is dry / wet as it should be, the SKY button cycles and is saved, the foliage atlas is a cut-out, leaves move in the wind |
| `rcarlook.js` | car looks: all 30 player cars have mesh grille, indicators, plate with characters, head and tail lights; triangle counts stay sane (11-14k player, 6-7k traffic); traffic bodies have indicators, lamps, glass and a plate; traffic paint albedo is realistic; a frame at speed draws with no GL error; glows dim in daylight; every car has gloss black panels; the car menu switches to the studio look and closing it restores the weather; the showroom frame draws with no GL error |
| `rdrift3.js` | repeated drift taps build up: one tap 10 degrees, three 20, five 48, points x50, slow taps do not build, the build-up fades |
| `rtrperf.js` | draw calls, triangles and CPU per traffic tick with and without traffic at five camera spots |
| `rtrshot.js` | screenshots of the traffic at places (`rtrshot.js '[["sfnu3",0.43]]' name`) |
| `raudit.js` | which lane markings each road really renders (decodes the road shader's style number per sample) versus what it should |
| `rbot.js` | a pure-pursuit bot drives every road (`SPD=24`, `ONLY=ring,sh`) with real collisions: stuck, off-road, buried wheels, falls, hits, flights |
| `rphys.js` | the handling review, as the game is PLAYED (road assist on): A steering (gain against stick position, a small stick held, step response, a quick dab, hands off), B the pivot point and turning circle at low speed, C grip and slide (limit, drift tap, release, grass), D braking and reverse, E throttle steps, F walls at 8-90 degrees (speed kept, nose along the wall, energy), G jump landings (with and without steering at take-off), H ground following, I guard rails, J curbs. `HNDMODE=classic node racer/tests/rphys.js` prints the old handling's numbers |
| `rhandle.js` `rturn.js` `rdriftspd.js` `rdrift2.js` `rdrive.js` | the FEEL: cornering grip, handbrake drift, brake distance, turn-around times, drift pedal tap and hold, 0-100 |
| `renergy.js` | energy logic on synthetic ground: coasting over a hill, ballistic flight, crest launch threshold, landings on slopes |
| `rjump.js` | drives the jump hills at several speeds: air time, flight length, buried wheels after landing |
| `rpen.js` | how far wheels/bumpers poke below the ground on hills and steep streets |
| `rload.js` `rfinal.js` `rtouch2.js` | boot without errors on 667x375 and 568x320, touch controls, minimap tap |
| `mapview2.js` | stats per road (length, min radius, grade), crossings, overview picture of the whole map |
| `rgal.js` `rtop.js` `rjshot.js` `rdtoast.js` | screenshots: chase camera at a point on a road (`rgal.js '[["ring",0.3]]' name 667 375`), bird's-eye view (`rtop.js x z height name`), mid-jump HUD, drift readout stages |
| `dbg_ov.js` `dbg_rad.js` `dbg_pts.js` `dbg_hit.js` | helpers: where two roads overlap, where a curve is tighter than wanted, sample points of a road, colliders near a point |

## Baseline (build at commit "any slide is a drift ..."): the driving must still match this after any change

The point of keeping these numbers is to prove the DRIVING FEEL did not change when other things (traffic, damage, map, graphics) are added.
Small differences from rounding are fine; a change of more than about 10 percent is a change of feel and needs a reason.

* `rhandle` (on the straight, jump hills avoided): half-right at 100 km/h 1.22 g, at 200 km/h 1.55 g, both about 0.4 deg of slip; slalom at 150 km/h 3.27 g;
  handbrake drift at 120 km/h peaks at 26 deg slip and recovers to under 3 deg in 0.48 s; 200 to 0 km/h brake takes 2.32 s.
* `rturn` (full stick + handbrake): 170 deg in 0.75 s at 30 and 45 mph, 1.20 s at 60, 1.67 s at 80, 1.99 s at 100, 2.88 s at 140.
* `rdrift2` (steer 0): a 0.25 s tap gives a 22 deg slide at 63 mph (14 deg at 94 mph) that is over 0.4 s after release; holding brakes harder over time:
  deceleration per half second 14, 21.5, then 25 m/s^2 (63 mph: 14 then 21; 94 mph: 13, 20, 25).
* `renergy`: coasting over a 30 m hill keeps kinetic + potential + drag work within 3.7 percent; a ramp jump keeps its energy in the air (836 to 821 J/kg) and a flat landing keeps its horizontal speed
  apart from the 'bottoming out' scrub above 12 m/s; the crest launch happens within about 10 percent of `v^2/R = g` (R 80 m: leaves at 108 mph, theory 98; R 150 m: leaves at 148 mph, theory 134);
  landing at 25 m/s on a 30 percent up slope leaves 20.7 m/s, on a 30 percent down slope 26.0.
* `rjump`: no flight at 49 and 67 mph; from 81 mph three flights of about 0.87 s and 31 m; 101 mph about 1.1 s and 49 m; 134 mph 1.1-1.3 s and 63 m; no buried wheels after landing.
* `rbot` at 24 and 34 m/s: all 81 roads completed, no stuck, no falls; the only 'below-road' frames (1-8) are on the steepest San Francisco streets; flights only on the jump hills and the San Francisco crests.
* `rpen` worst wheel below ground: Nob Hill crest 12 cm, Russian Hill 5 cm, mountain 6 cm, Mulholland 27 cm, mountain pass 11 cm, steep street sfsu4 51 cm (1 percent of frames over 25 cm);
  the 'off-road up Twin Peaks' case starts against a street's cut bank and shows 140 cm (known, not a hill-climb failure).
* `netcheck`: 4 short 'overlaps' that are T-junction widths and Lombard Street's ends, 2 dead ends (the pier head), one connected group (135 roads since the wider county was added).
* `raudit`: every road renders the markings it should (0.6 km without lane markings = Lombard Street and the pier, which are patches). It re-implements the shader's decode, so also LOOK at `rgal.js` screenshots after touching the road shader.
* `rdrive`: steering sign and response, nitro, head-on into a building, off the pass into a slope, dropped in the sea; its 'speed after 30 s' number is not meaningful (the car has no steering input and leaves the road).

## Traffic baseline (phase 2 build): these should not get worse

* `lanecheck`: 482 lane edges, 2,377 links, 434 lane-km, built in about 0.1 s; one strongly connected piece (264 of 264 road directions); 0 height steps.
* `rtrhit`: all checks pass. Head-on 20 m/s into a parked 1,300 kg car: momentum kept to 0.00 %, energy 126 kJ = 1/2 mu (1-e^2) v^2, speeds after 7.9 and 13.1 m/s as theory says. Real hits: a sedan at 24 m/s closing records 182 kJ on the front zone, a van 236 kJ, a hatch at 10 m/s 28 kJ.
* `rtraffic` (90 s, seed 20240601): wreck rate (cars wrecked per cars spawned) 0 to 1.7 % at nine places, downtown (the SF grid with the diagonal Market Street, the hardest junctions) about 2-4 % and is the known weak spot: the corners where Market Street meets the boulevard sometimes jam (a jam is dissolved after 12-22 s) and a car can wander up to about 11 m from its lane while it cuts a corner there. No car off the road anywhere. CPU of one 60 Hz traffic tick on this machine: about 0.3 ms with 56 cars (downtown), 0.1 ms on a highway.
* `rtrperf`: traffic adds 4 draw calls and about 5k triangles in town; boot adds about 0.1 s for the lane graph.
* `renergy` T1 is back to 3.7 % (the test now switches off the real map's colliders: a tree or house at z=0 had been stopping its test car since the world got bigger).
* The feel tests (`rhandle`, `rturn`, `rdrift2`, `rjump`, `rpen`) give exactly the same numbers as before traffic was added.

## Graphics baseline (phase 4 build)

* The feel tests (`rhandle`, `rturn`, `rdrift2`, `rjump`, `rpen`, `renergy`) give exactly the same numbers as before the graphics work; `rdamage`, `rsafe`, `rcops`, `rtrhit`, `lanecheck` and `rgfx` pass.
* `rgfx`: all three tiers render with no GL errors; the picture at four places has a mean brightness of 0.36-0.51 and a mean saturation of 0.13-0.25 (the old sunny look was clearly more saturated), nothing clipped or crushed; 1,271 lamps and 125 neon signs; the shadow map holds casters and the grid does not move when the car moves by 5 and 11 cm (texel 9 cm on High).
* Cost of each effect (`QUICK=1 node racer/tests/rgfxcost.js`; **SwiftShader, the CPU draws the frame**, 667 x 375 at scale 1, median of 4 frames at 3 places, about +-4 ms of noise out of 85-120 ms): a post pass with FXAA +2-6 ms (+3 %), speed blur +4-5 ms, bloom +1-5 ms (it works on quarter-size buffers), shadows Medium (512, cars) +9-10 ms (+11 %), shadows High (1024, cars and props) +19-23 ms (+22 %), wet-road lights 8 instead of 1 +14 ms (the heaviest per-pixel effect in software; a phone GPU does the 8-light loop far faster than a CPU), the third cloud octave +4 ms, glows and light pools +0-2 ms and no extra draw calls (they share one buffer; the whole fx pass is 4-8 draws). Whole tiers, against drawing straight to the canvas: Low +8 %, Medium +32 %, High +43 %. These are RELATIVE weights; they say nothing about a phone.
* Draw calls and triangles at the same places (with traffic): Low 44-131 draws and 66-106k tris, Medium about 70-200 and 100-135k, High 80-230 draws and 105-140k tris.
* **Not measured**: any real phone. The tier ratios (1 : 1.35 : 1.9) and the governor limits (9.5 ms up, 13.5 ms down) are design values; check the FPS panel (`FPS` button: it shows the tier, the probe's measured frame cost, and which effects are on) on the phone and adjust `GFXT` and `GOV` in `src/31_gfx.js`.

## Cars baseline (the car / camera / road smoothing build)

* The feel tests (`rhandle`, `rturn`, `rdrift2`, `rjump`, `rpen`, `renergy`) are unchanged for the starter car (its handling numbers are identical to the old ones; `rcars` checks that). The camera and the nitro ease are NOT in those numbers: they only move the camera and ramp the boost.
* `rcars` (flat ground, the starter): 0-100 km/h in 2.33 s, top speed 260 km/h after 90 s (the model's asymptote), 100-0 in 16.4 m, steady cornering at 100 km/h full lock 2.57 g. The other cars: top 229-333 km/h, 0-100 1.6-2.95 s, braking 12.0-18.9 m, cornering 2.26-3.64 g; the order follows the real figures (rank correlation 0.99 top speed, 0.98 acceleration, 1.00 braking, 0.97 grip).
* `rcam`: with the game's own frame timing the car's place in the picture changes by 0.015-0.03 m from one frame to the next going straight or tapping nitro (it was 0.7 m going straight and 1.2 m with a nitro tap), 0.02-0.03 m / 0.2 degrees in a drift.
* Roads: no crest or dip tighter than 35 m radius outside the designed jump hills (`node` scan of the profiles: before the smoothing 88 places under 45 m, the worst 16 m on the mountain pass).
* Not measured: any real phone. 5-10k triangles for the player's car and about 2.8k for each nearby traffic car are a bigger load than before (about 9.5k for the old car, 200 per traffic car): see the quality tiers, the traffic LOD distance is 34 m on Low.
* The test harness (`rlib.js`) loads the game with `env=overcast` unless a test asks for another weather, so the older tests, which were written for the gloomy look, measure what they always did; `renv.js` covers all three looks.

## Handling review baseline (`rphys`, the starter car)

| | classic (`?hnd=classic`) | new |
|---|---|---|
| A1 yaw gain at 12 % / 6 % of the stick, relative to full stick, 40 m/s | 0.26 / 0.01 | 1 / 1 |
| A1 the same at 65 m/s | 0.21 / -0.12 | 1 / 1 |
| A2 12 % stick held at 30 m/s: heading after 1.5 s / 3 s | 5.5 / 7.1 deg | 8.6 / 17.4 deg |
| A3 step response (63 % / 90 % of the yaw rate) | 0.11 / 0.20 s | same |
| B full lock at 5 m/s: radius, rear axle sliding sideways | 2.0 m, 3.6 m/s | 4.4 m, 0.1 m/s |
| C1 limit at 100 km/h | 2.75 g, 1 deg slip | same |
| D1 100-0 km/h | 15.8 m | same |
| D2 reverse top speed (8 s) | 47.7 m/s | 10.4 m/s |
| E biggest step in acceleration | 1.9 m/s2 at 14 m/s | 0.29 |
| F wall at 15 deg, 55 m/s: speed kept after 1.5 s, nose off the wall, impacts | 0.62, 18 deg, 20 | 0.98, 0 deg, 7 |
| F wall at 25 / 40 / 60 / 90 deg, 55 m/s | 0.41 / 0.11 / 0.01 / 0 | 0.83 / 0.60 / 0.01 / 0.01 |
| G2 slide after a jump taken with 60 % stick | 15.5 deg | 7 deg |
| H Mulholland at 25 m/s: mean / worst gap to the ground | 3.2 / 4 cm | same |

`rcars.js` has two failures that are older than this review (body numbers and body size checks); they are listed in `racer/TODO.md`.

## Network baseline (world logic 1a)

* `rnet`: all pass. 246 road ends, 244 on a road, 2 planned dead ends (the pier head); worst height step at an end 0.11 m (that is the lift between overlapping roads), worst mouth corner 0.16 m; 486 lane edges, 2,461 turns (1,184 left, 1,186 right), 0 dead-end u-turns, 266 of 266 road directions strongly connected; 90 routes between the 10 places (1.5 ms each), worst detour The Valley to Palm Springs 2.9 km for 1.0 km.
* Before the fix the same audit gave: 30 road ends 1 m short of the asphalt, 3 height steps of 0.32-0.56 m, joins at 1-12 degrees, 25 lane directions with no left turn at their end, 4 dead-end u-turns.
* `rbot` at 24 m/s on the 25 roads that changed: all completed, no off-road, no falls, no hits. `rtraffic` (60 s) on the ring, the coast road and the east highway: 0-1.2 % wrecked, nothing stuck.

## World 1b / 1c baseline (curbs, landings, three cities)

* `rbudget` (world only, worst place per tier): Low 136 draws / 95k triangles, Medium 188 / 135k, High 212 / 145k. The old build: 143 / 112k, 206 / 158k, 238 / 165k. Downtown went from 143 draws / 112k triangles to 128 / 93k on Low although it gained curbs and sidewalks (the road LOD and the 256 m building cells pay for them); the new cities: Las Vegas 69 / 84k, Sacramento 108 / 89k, San Jose 136 / 89k on Low.
* `rphys` J: curb 15 cm; all four wheels up at 20 degrees costs 3.6 % at 9 m/s, 11 % at 15 m/s, 7.6 % at 30 m/s; shake 0.04 / 0.10 / 0.17.
* `rpen` (old build -> now): steep street sfsu4 51 -> 32 cm, Twin Peaks road 79 -> 46 cm, off-road up Twin Peaks 136 -> 85 cm, sfnv1 36 -> 33 cm, Nob Hill crest 12 -> 15 cm, Mulholland 25 -> 27 cm, mountain pass 11 cm.
* `rtraffic` (60 s): downtown 1.0 % wrecked (was 2-4 %), worst lane deviation 8.8 m (was 11 m; 44 m before the grid edges were cleaned up), no jam dissolved; Las Vegas 0 %, Sacramento 1.3 %, San Jose 0 %; Valley, Big Pines, Palm Springs 0-0.8 %.
* `rnet`: 13 places, 156 routes, all pass; `lanecheck`: 332 of 332 road directions strongly connected. `rbot` at 24 m/s on the 22 new or changed roads: all clean. `rsafe`: 20 garages.

## Traffic lights baseline (world 1d)

* `rsig`: 429 intersections, 1,503 approaches, cycles 30.4-32.4 s, all-red 1.2 s; 90-120 s at downtown, the Valley, Las Vegas, Sacramento: 41-132 stop-line crossings, 0 on red, both phases flow, queues of 2-3 cars, longest wait 15-25 s, 0 wrecks, 0 jams.
* `rtraffic` (60 s) with the lights: 0 % wrecked at downtown, the Valley, the ring, Big Pines, Palm Springs (downtown was 1 %), worst lane deviation 5.6 m downtown (was 8.8), deadlock breaker downtown 6 (was 10). Speed against the limit drops in town (0.52-0.64, was 0.86-0.90) because cars now wait at reds.
* `rbudget` (world): Low 138 draws / 100k triangles, Medium 190 / 149k, High 214 / 160k: the poles and heads are about +5k triangles on Low and +15k on High where the lights are densest, and no draw calls (they are merged into the furniture cells).

## Guard rails baseline (world 1e)

* `rphys` I (on the Geary highway, assist off, gas held): speed kept 1 s after touching the rail at 6 / 12 / 25 / 45 / 75 degrees: 35 m/s 1.31 / 1.14 / 0.99 / 0.64 / 0 (over 1 = the gas keeps pulling), 60 m/s 1.00 / 0.97 / 0.87 / 0.55 / 0; the car ends up along the rail (0-4 degrees) up to 45 degrees; damage 53 / 221 / 924 kJ at 6 / 25 / 75 degrees and 35 m/s, 63 / 538 / 2576 kJ at 60 m/s.
* `rbot` at 34 m/s on the 15 railed roads: all completed, no hits, no stuck (flights only on the jump hills). `rjump`, `rcops`, `rnav`, `rdamage`, `rsafe` (20 garages), `rgfx`, `renergy` pass; `rbudget` world Low 138 / 100k, High 214 / 160k (the rails and posts add no draw calls).

## Traffic variety baseline (batch 2)

* `rvar` (120 s): 19 kinds of vehicle downtown and in Las Vegas, 17 on the ring, 14 in Big Pines; refuse trucks stopped 18 / 16 / 9 times downtown / Las Vegas / Big Pines, a bus stopped at a stop in Las Vegas; wrecked 2 of 220 downtown, 0 of 137 in Las Vegas, 4 of 375 on the ring; CPU per traffic tick 0.29-0.36 ms. Near bodies 0.8-7k triangles, far bodies 184-238.
* `rccars`: 26 designs, 4.6-6.4k triangles with wheels, built in 1-6 ms; 24 drivable cars, 0-100 km/h 1.6-3.4 s, 100-0 15-18.5 m.
* `rbudget` with traffic: Low 143 draws / 106k triangles, Medium 200 / 158k, High 224 / 172k (the build at c02a69c: 148 / 116k, 216 / 180k, 246 / 196k).
* Known: on the ring a queue sometimes forms where the Sacramento road (`sc2`) meets it (no light, cars on the side road give way to the ring); it is dissolved by the jam rule after 12 s out of sight. `rcars` checks the 30 generated cars only, `rparts` the openable panels of the first 5 traffic types only (the new bodies have none).

## Police baseline (batch 3)

* `rheat` (3 min, default seed): 4.6 km driven, heat 0 throughout, 0 chase samples, 4 patrol cars met, no crime logged (the bot took 3 knocks: a traffic car, a wall, a rail).
* `rpolice` chase at 34 m/s on the ring, Forgiving: 1 star 2 chasers (patrol cars only), 2 stars 4 (patrol + interceptor), 3 stars 5 and a roadblock of 3 (one left out for the gap), 4 stars 6, a roadblock of 4, 1 helicopter and 3 spike strips in 45 s, 5 stars 8 (interceptors, SUVs, SWAT), a roadblock of 5, 3 helicopters.
* Helicopter: there at once, within 220 m in 100 % of the samples (furthest 217 m), never lower than 32 m, leaves after 75 s, the next one 25 s later. Spike strip: 4.01 s of burst tyres, a 1 s turn at 30 m/s is 15.1 degrees against 31.3 (48 %), 31.3 again afterwards.
* A cop against a wall reverses out; 5,700 position samples of police closing in on a car parked downtown: 0 inside a building.
* Changed expectations: `rcops` 2 (patrols rare instead of frequent), `rnav` (speeding past a cop is 1 star, hitting one 2), `rparts` 8 (the police car is a Close Call body without opening panels).

## Looks baseline (batch 4)

* `rlooks`: 30 lamp pairs (9 head kinds, 11 tail kinds), closest two noses 2.1 cm apart at their worst station and closest two tails 1.6 cm, never both under 2.5 cm; 8 solid, 12 metallic, 7 pearl, 3 matte; bodies 11,196-14,186 triangles.
* Flank pixels in the day preset: white mean 211 / 255 with 0.5 % burnt out (spread 41), silver mean 176 (spread 29, from 10 to 255), solid red 191 / 12 / 40, matte grey spread 11.
* `rcars` passes completely (its material check was stale: it allowed 17 materials, there are 21). `rtraffic`: a car in a shared turn may be 7.5 m from the line (6 on a straight); after the walking-pace bump rule: 0-2 wrecks per place, all 13 places pass.

## Full run at the end of the four batches (frozen build)

* All 34 tests of `run_quick.sh` pass, plus `rtraffic` (13 places, 90 s each: 0 failures) and `rbot` on all 169 roads at 24 and 34 m/s (every road completed).
* Three things the full run found, and what was done: `rscenery` 5 (the furniture limit was older than the guard rails, traffic lights and bus shelters: 485k triangles in the whole map, limit now 520k; the per-frame cost is `rbudget`'s job and is unchanged); `rcam` drift / driftHold (a 3 s slide on the ring now ends against a guard rail, so the test lifts the ring's rails for those two scenarios: the camera itself was not touched and gives its old numbers again); `rbot` Lombard (a lamp post of one hairpin leg stood in the lane of the next since the sidewalks of 1b: lamp posts are now never put on asphalt, Lombard is clean at both speeds).
* Left as they are: `rbot` clips one post on `sfnv1` (after a 1.5 s flight over a San Francisco crest), and at 34 m/s one signal pole on `sfp` and on `mojp`. `rtops.js` is a picture tool (it needs a list of places), not a test.

## Batch 5 baseline

* `rpolice`: flats last 7.8 s, a 1 s turn at 30 m/s on flat tyres is under 70 % of normal; 3 patrols in 2 minutes parked, none in sight distance, 0 light samples; lost after 20.5 s flat out at one star.
* `rheat`: 3 minutes from the start with the denser traffic: heat 0, no chase, 3 patrols, 4.3 km driven.
* Damage per wall hit (health lost): 18 km/h 0 % (was 0.8), 25 km/h 0 % (1.5), 36 km/h 1.8 % (3), 54 km/h 6.8 % (same), 90 km/h 18.9 % (same).
* `rcars`: the roster check is now the order (slowest to fastest) and the starter by id; the saved car is `curId`.

## Crash baseline (batch 6)

* `rcrash`: side hit at 32 m/s: rolled 177-180 degrees, 14-16 ground hits, 27-33 % of the health, a car again after 7-10 s; a forced roll at 26 m/s: 179 degrees, a car again after 2.1 s; a parked car T-boned at 30 m/s: thrown 2.1 m up, rests on its side; lamp post at 16 m/s: falls to 85 degrees, the car goes on at 13.4 m/s.
* No tumble in normal driving: lane bot 2.5 km on the ring at up to 150 km/h with drift taps, 0.5 km downtown, 1.5 km on Mulholland. `rphys`, `rdamage`, `rcam`, `rparts`, `rjump`, `rgfx`, `rsafe`, `rbudget`, `rheat` pass; `rtraffic` (downtown, valley, ring) and `rbot` at 34 m/s (ring, Lombard, sfnv1, sfp, Mulholland) unchanged.

## Repair shop baseline (batch 7)

* `rrepair`: 14 shops, at least 1,124 m apart; at every one the bot (from the road, 13 m/s) is fixed 2.5-3.5 s after the start, at most a scrape under 11 km/h on a wall. `rbudget` unchanged (the shops are in the prop cells), `rbot` at 34 m/s on the eight roads with shops: all completed, no hits.

## Map baseline (batch 8)

* 219 roads, one connected network, no new dead ends; `netcheck`: no new road overlaps its parent (the junction mouths are the usual 52-56 m, the old exceptions are unchanged); `rnet`, `lanecheck`, `rsig`, `rsafe`, `rrepair` pass.
* `rtraffic` (90 s) at Gilroy, Tahoe, Bishop, the northern highway and the east highway: all pass (0-2 wrecks, 4.5 m worst off lane). `rbot` at 24 and 34 m/s on the 10 new roads and the 5 new boulevards: all completed, no hits, no flights.
* `rbudget` with the new towns and stops: Low downtown 135 draws / 102k triangles (limit 146 / 113k), Medium 195 / 154k (210 / 160k), High 221 / 166k (240 / 167k: close to the limit).

## Full run after batches 5-8 (frozen build)

* 37 tests of `run_quick.sh` plus `rtraffic` (17 places, 90 s) and `rbot` on all 219 roads at 24 and 34 m/s. All pass after these updates: `rscenery` (furniture 537k triangles in the whole map, limit now 600k; build 9.2-9.6 s here, limit now 10 s, from 8.6 s before the new towns, stops and shops), `rpolice` 6 (the minimap check now ignores the repair-shop crosses), `rcrash` 5 (a traffic car is thrown from 120 kJ, not 90: a 43 km/h T-bone sometimes tipped it 42 degrees), `rvar` (downtown with the denser traffic a taxi queued 33 s at a light, no deadlock and no dissolved jam: the limit is now 40 s).
* Left as they are: `rtraffic` east highway with the default seed has one car waiting over 25 s to turn left into `hs2` across the busy highway (seeds 1 and 2 pass); `rbot` at 34 m/s clips the known signal pole on `mojp` and now rolls over there (it used to scrape past).

## Events baseline (batch 10)

* `revents`: Ring Sprint 3.3 km, 11 checkpoints: a careful bot (48 m/s, slows for bends) finishes in 71.2 s, bronze (gold 59.6 s), paid 3,000, ghost 711 samples. Escape at two stars: 4 chasers, gone 17.6 s after getting away unseen, paid 4,000. Busted in an escape: fine 8 %. Car prices 1,500-241,500.
* Updated for the new economy: `rcars` (only the starter is owned at the start), `rsafe` (other garages cost 15,000; with 5,000 you cannot buy one).

## Road rage and spots baseline (batch 11)

* `revents` 7: driving down a lane of 8 standing cars at 17 m/s the bot wrecks 4 (+16 s). 8: speed trap 214 km/h, jump 36-50 m off the ring's humps, drift zone 1,885 points; each first record pays 500.

## Racers baseline (batch 12)

* `revents` 9: Desert Race 2.7 km, the racers at 1,181-1,526 m after 30 s (43-54 m/s), the careful bot (46 m/s) 3rd or 4th in 1:31-1:37. 10: in a death race the racers hit a bot at 86 km/h 24 times in 30 s; T-boning one at 115 km/h wrecks it. 11: a street racer appears 180-220 m ahead and offers a race to Palm Springs.


## Natural towns baseline (batch 13)

* The Node map tests (`netcheck`, `lanecheck`, `rnet`, `rsig`, `mapview2`, the `dbg_*` helpers) now also load `20_organic.js`.
* `netcheck`: 13 overlaps (the same junction mouths as before), 2 dead ends (pier head), one connected group. `lanecheck`: 448 road directions, all one piece, no step at any road end. `rnet` 5: two new roads (`gl3` Gilroy - Pacifica, `in3` Indio - Palm Springs) keep every route under 2.6x (worst Indio -> Harbor 2,408 m for 753 m).
* `rtraffic` (60 s): Gilroy, Tahoe, Bishop ok (one car waited over 25 s at Bishop's west gate); `harbour` 4 wrecks of 109 (3.7 %) is the same as at batch 12 (not the towns).
* `rbudget`: Low 138 / 102k, Medium 196 / 154k, High 224 / 167k (downtown, unchanged by the towns).
* `revents` 8: the drift-zone bot now has the traffic cleared off its line (a car in its way sent it back to the garage).

## Older towns baseline (batch 14)

* `netcheck` / `lanecheck`: one network, 460 road directions all connected, no steps. `rnet` all passed. `rbudget`: Low 138 / 102k, Medium 193 / 154k, High 217 / 166k. `rscenery`, `rsafe`, `rnav`, `rrepair` ok. `rtraffic` (60 s): 17 places ok, harbour as at batch 12.
* `revents` 4 and 9: the traffic is now kept off the standing car (escape) and off the race bot's line (it does not dodge cars): with the new towns' traffic a car bumped the parked car up to 4 stars, and the race bot T-boned a car on the east highway and rolled.

## Natural cities baseline (batches 15-16), full run

* Full run on the batch 16 build: every test passes after these updates. `rsig` measures one car's continuous wait at one light (it used to add up every wait of a car slot, and slots are reused) and reports where the longest wait is; `rpolice` 7 counts only buildings (a lamp post where the cop was put down does not count); `revents` keeps traffic off the race (the bot and the racers); city test spots use the avenues (`vegm`, `sacm`, `sjm`).
* `rheat` (default seed): the bot used to T-bone a car pulling out of Mulholland onto the ring and get two stars; now the turning car gives way and is to blame if it does not.
* `rsig` now and then: a car on `sacau2` waits through one green at the Sacramento avenue (47 s; limit 40).

## Crash cam baseline (batch 17)

* `rcrashcam`: a hard roll at 100 km/h starts the cinematic after 0.25 s (slow motion x0.3, the camera stays at its spot); 1.2 s of world time later the car is back on the road 35 m back, upright, at 24 m/s, shield 3 s; the shield blocks damage and tumbles and blinks the car; a 40 m/s head-on hit starts it; a slow roll onto the side does not; `CC.enabled=false` keeps the old behaviour. Added to `run_quick.sh`.
* `rcrash` runs with `CC.enabled=false` (it measures the tumble physics itself).

* Batch 18: `rdamage` 2 and 3 now check that a hard landing (16 m/s) does no damage and moves no vertex.

## Dashboard baseline (batch 19)

* `rdash` (new, in `run_quick.sh`): the HUD has only the hazard pause, the pedals, drift, nitro and the map; the pause console has DRIVE, the FPS and assist rockers, GARAGE / MAP / RESET CAR and the graphics and sky knobs, and each works; GARAGE on the road sets the route; parked on the home pad the card offers ENTER GARAGE / EVENTS / DRIVE ON; inside, the car is in the garage room with the car menu; leaving puts it back on the pad; the car menu does not open on the road.
* `renv` and `rgfx` check the sky and graphics knobs of the console (the SKY and GFX buttons are gone); `revents` 6 opens EVENTS from the garage card.

## Upgrades baseline (batch 20)

* `rupg` (new, in `run_quick.sh`): stage-1 prices for the Kestrel S 2,500 / 2,000 / 1,750 / 2,000 / 1,500 (the fastest car's engine 24,250); no money -> "NEED $2,500"; engine +4 % top speed and +7 % pull per stage (x1.12 at stage 3), MAX after three; tyres +4 % grip, brakes +9 % braking, saved per car; nitro stage 2 burns 0.19 of the tank in a second of boost instead of 0.29; armour stage 3 leaves 0.83 health for the same damage instead of 0.73; the garage page draws and its BUY keys work.

* Batch 21: `rdash` 2 expects the MPH rocker in the console. The tests start with `?fixed`, so they keep the ring start (the game itself starts at a random spot). `rcam` driftHold failed once while ten tests ran in a row (jerk 0.028 m) and passed on its own (0.020 m).

* Batch 22: `rlane` (new, in `run_quick.sh`): from between two lanes on the ring at 63 mph it settles within 0.03 m of a lane centre, the other carriageway the same, the mountain pass at 40 mph within 0.2 m for 14 s, a city street started on the wrong side ends in its own lane, holding the steering it lets go, switched off it does nothing. Tests start with `?fixed` and lane assist off; the game itself starts with it on.

* Batch 23: `rparts` 3 checks that on the road six hard front hits leave the bonnet (at most 0.28 rad) and the bumper on, the deepest dent 10 cm; parts coming off is checked with the crash cam on. `rcrashcam` 1 checks the car comes back with front dents of at most 6 cm, 3 cm elsewhere, no part missing, the doors ajar.

* Batch 24: `rwear` (new, in `run_quick.sh`): a chasing cop is destroyed by four 60 kJ hits, a racer by three, a cop pushing you ten times at 30 kJ does not wear, a light tap leaves it chasing. `rcrashcam` waits up to 20 s for the movie to end (a hard roll at 100 km/h now plays about 6 s of game time). `rparts` 5 checks the left door on the road. `rcops` 4 (bust while parked) passes again: being rammed while parked no longer starts the crash cam, and pinning does not wear the cops.

* Batch 25: `rcrashcam` 6: a roll starting at 45 mph plays no movie; a tap in the first 1.5 s does not skip, after it the movie fades out in 0.45 s. `rheat` was flaky (one run in two) because tumbles used `Math.random`; they use `TR.rng` now and the run repeats (passes).
* Batch 26: `rsafe` end screen: wrecked at 45 mph, the car stops and never backs up, pedals let go at the garage. `rcops` 4 was flaky (the pack of cops wore itself out before boxing you in); 4 of 4 runs pass now.
* Batch 27: new `rboost` (nitro: repair fill, wrong side, near miss, jump, takedown, gradual fill, top speed) and `rcurb` (31 curb crossings: no turn, rocking under 0.8 rad/s, no speed lost, no trip; the old build fails it). `revents` 7 is TAKEDOWN (6 racers ahead, light traffic, only racers count, a stuck racer is put back on the route). `rcops` 5 is the mile rule; `rpolice` 2 needs a witness, 8 escape at 72 m/s takes 128 s. `rdamage` 5/6: one crash takes at most 24 %, four leave 4 %, the fifth wrecks. `rcrash` 3: a kerb no longer trips the car. `rcrashcam` 6: the movie starts with the roll. `rsafe`: garages sit on levelled ground (`flattenGarages`, 21_terrain.js; the mountain-pass garage was on a 4.7 m slope). `rnav`: the crash is in front of a parked patrol.
* Batch 28: new `rcoast` (off the gas on the flattest stretch of the ring: 1.35 m/s lost in the first second at 70 mph, 47 mph after 10 s, 30 mph rolls to 14 mph; the old build stops dead in 6 s).
* Batch 29: new `rram` (ramming a cop, a racer and a SWAT truck at 90 mph: no damage, roll or movie; a civilian at 56 mph still 151 kJ). `rlane` 4: in the oncoming lane it holds you there; in your own lane, in your own (samples on the street itself, not the cross street at a junction).
* Batch 30: new `rtrail` (11 trails joined at both ends, in the lane graph, no rails; no traffic on a trail in 40 s; 15 chasers in 70 s with a turn onto another highway, none ahead (roadblocks excluded); parked 120 m out in a field, the cops reach you in 7.6 s, in the old build they never got closer than 124 m).
