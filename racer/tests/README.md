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
| `netcheck.js` | road network in Node: roads lying on top of each other, dead ends, disconnected pieces |
| `lanecheck.js` | lane graph in Node: lane centres sit exactly where `laneInfo` puts them, no NaN, every lane has a way on, the road directions form one strongly connected piece, no road end sits at a different height from the road it joins |
| `rtraffic.js` | traffic only, car pinned beside the road, 90 s at ten places (downtown, Valley, ring, mountain pass, coast, east highway, Big Pines, harbour, Palm Springs, Mulholland): cars alive vs target, wreck rate, far-off-lane, off-road, stuck for 25 s, deadlock breaker uses, CPU per tick. `SEED=n` `SECS=n` `ONLY=a,b` |
| `rtrhit.js` | player against traffic: A collision physics on synthetic bodies (momentum, energy 1/2 mu (1-e^2) v^2, spin-out, tap), B real hits (energy and zone recorded), C a bot drives through busy traffic on three roads |
| `rtrperf.js` | draw calls, triangles and CPU per traffic tick with and without traffic at five camera spots |
| `rtrshot.js` | screenshots of the traffic at places (`rtrshot.js '[["sfnu3",0.43]]' name`) |
| `raudit.js` | which lane markings each road really renders (decodes the road shader's style number per sample) versus what it should |
| `rbot.js` | a pure-pursuit bot drives every road (`SPD=24`, `ONLY=ring,sh`) with real collisions: stuck, off-road, buried wheels, falls, hits, flights |
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
