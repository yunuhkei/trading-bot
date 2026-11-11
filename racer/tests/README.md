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
| `rcops.js` | cops: heat thresholds, patrol presence, chase catches a 30 m/s player, boxed in = BUSTED, escape by line of sight, roadblock, Medium rams, garage clears heat, difficulty table |
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
