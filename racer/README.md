# Racer prototype

A free-roam arcade racer in **one self-contained HTML file** (`Racer_Prototype.html`, no libraries, no network).
It is built from the modules in `racer/src` by `python3 racer/build.py` (the output is committed so you can just open it).

* **Map**: one fixed county (about 6 km square), roads authored in plan view only (`src/20_map.js`), heights follow the land and the land is carved around the roads:
  a ~10 km highway ring with sweeping bends (and a long straight), a mountain pass with switchbacks, a twisty coast road (Highway 1 style) with an overpass,
  a long straight on the southern plains, an east link, and the county's districts, inspired by San Francisco and California:
  **Downtown** = two street grids (one axis-aligned, one rotated to follow the diagonal **Market Street**, like SF), a tower district with a pyramid tower,
  Victorian row houses on **Nob Hill / Russian Hill** (grades over 20 percent) with a hairpin **Lombard Street** block, **Twin Peaks** with a winding road,
  **Golden Gate Park** (a long green strip with a lake and a park drive); **the Valley** = LA style wide palm-lined boulevards with strip malls, parking lots and stucco houses;
  **Mulholland** = a very twisty ridge road in the hills; **Santa Cruz** = a beach town on the south coast (bungalows, motels, a boardwalk with a Ferris wheel,
  lifeguard towers, umbrellas and a pier you can drive out on); **Palm Springs** = a desert resort town of wide palm boulevards (mid-century hotels round pools,
  a golf course, villas with pools).
  **Network** (one connected road system, checked by a script that reports roads lying on top of each other, dead ends and disconnected pieces): every district is ringed
  by a boulevard (`perimeter()`), every street of the district ends on it, and the highways join the boulevards: Geary and the park drive meet downtown's boulevard,
  the boulevard road runs from downtown across the hills to the ring, the Valley joins it and the ring, the coast road runs from Market Street's south-west end
  round the coast to the southern highway (past the Santa Cruz link), the east link joins the ring to the southern highway, Palm Springs joins the east link and the southern
  highway, Mulholland runs from the ring to the boulevard road and the mountain pass leaves the ring and returns to it. Branches leave a road along its side and peel away
  (`rampPts`) or end as a T on its edge (`edgePt`), so no road is built on top of another; where roads really cross (coast road over the ring) there is an overpass
  (found and built automatically, `fixCrossings`).
  Collision: there are no guardrails for now (`RAILS=false` in `src/21_terrain.js` brings back the highway, cliff and bridge rails); buildings (also the rotated ones), poles, trees and bridge piers are solid
  (with height ranges, so the deck of a bridge is not blocked by what is under it); steep banks are walls.
  Hills: the road-surface lookup picks the nearest road segment at the car's own level (never by height alone, which made the ground a staircase), every city street takes
  its height from one shared smoothed height field (so crossing streets are flush), connector roads blend to the street they join, the body height follows the ground
  closely and the ground cannot launch the car faster than the slope allows. `racer` tests that measure this live in the session scratchpad, not in the repo. Everything is deterministic.
* **Rendering**: terrain is a GPU clip-map (6 rings, one draw each) displaced from a 16-bit height texture; roads are ribbons with analytic
  lane markings; buildings/trees/barriers are merged per 128 m cell and culled by distance + frustum; sky, fog and water are shaders.
  About 40-110 draw calls and 60-90k triangles per frame. No shadows or reflections. A render-scale governor keeps frame time near 16 ms.
* **Car**: the Surge Sport mesh baked from the Close Call garage (`src/car_nitro.js`, made with `tools/`), wheels separate so they spin and steer.
* **Driving** (`HND` constants at the top of `src/40_car.js`): grip first, like the Need for Speed arcade games. Steering is limited by a tyre budget
  (about 1.4-2.3 g), so at speed full lock runs wide instead of sliding. Speed is shown in mph. Tuned like a sports car: firm brakes (60 mph to a stop in about 1.2 s) and quick turn-in.
  **Drift pedal**: a *tap* kicks the tail out (a slide of about 15-25 degrees towards the way you steer, or the side you last steered when the stick is centred) that carries on for about
  half a second after the finger lifts, then a stability assist straightens the car; the stick picks a bigger slide angle. The *longer you hold* it the harder it brakes (a light drag at first, the full 24 m/s^2
  locked-wheel brake after 1.2 s), and the slide angle the stick can ask for grows as the car slows, so a full-stick hold turns the car right round (about 170 degrees in 1.2 s at 60 mph, 2 s at 100, 2.9 s at 140).
  **Energy**: everything is per unit mass, with speed measured along the ground. Gravity pulls the car along the slope exactly (`a = -g m/(1+m^2)`, also sideways down a camber), so climbing turns speed into height
  and descending turns height into speed (coasting over a 30 m hill loses exactly `g h` plus drag; the test sums kinetic + potential + drag work to within 4 %). Brakes, the drift and bumps turn kinetic energy into heat.
  **Air**: the car follows the ground only while the ground pushes up on it. Over a crest of vertical curvature k the ground needs a downward acceleration of `k v^2`; once that is more than gravity the tyres lose the road and
  the car flies on ballistically with the velocity it had (energy conserved, only a little air drag; the engine revs freely and the nose follows the arc). It lands as soon as it meets the ground again: the part of the velocity that points into the ground is
  absorbed (that energy, half the normal speed squared, is lost: shake, camera bob and a small extra scrub above 12 m/s), the rest is kept, so a flat landing keeps all its horizontal speed, a landing on a down slope turns the fall into
  forward speed and one on an up slope loses some. Crossing a crest of height h and length L launches a car above about `sqrt(g L^2 / (2 pi^2 h))`; there are three groups of *jump hills* (6 m, 68 m crests, about 68 mph to take off,
  a 1 s / 50 m flight at 100 mph) on the ring's south straight, the southern highway (two groups) and the east link, marked JUMPS on the map. Also off any bank or bridge edge, and over real hills on the mountain roads.
  Cars stay on the road over small bumps, the body leans and dives. Nitro is filled by drifting and is a latch: one tap starts it, it runs until the tank is empty (tap again or brake to stop). Building, barrier and bank collisions, respawn.
* **Controls**: touch (drag the left half to steer; GAS and BRAKE pedals bottom right, DRIFT above brake, NITRO above gas; tap the minimap (top left) for the world map;
  AUTO = automatic gas) or keyboard (arrows/WASD, Space drift, Shift nitro, R respawn, M map, G auto-gas, F fps, P pause).

Modules, in load order: `00_util` math/noise, `10_gl` GL helpers and all shaders, `20_map` roads + terrain function,
`21_terrain` height map/carving/ground colours, `22_build` static geometry + spatial queries, `30_render` frame, `40_car` car/physics/camera/effects,
`50_ui` input/HUD/minimap/audio/quality, `90_main` boot + loop.

`tools/` documents how the car was extracted from the garage (needs the Close Call test harness; not needed to build the racer).
