# Racer prototype

A free-roam arcade racer in **one self-contained HTML file** (`Racer_Prototype.html`, no libraries, no network).
It is built from the modules in `racer/src` by `python3 racer/build.py` (the output is committed so you can just open it).

* **Map**: one fixed county (about 6 km square), roads authored in plan view only (`src/20_map.js`), heights follow the land and the land is carved around the roads:
  a ~10 km highway ring with sweeping bends (and a long straight), a mountain pass with switchbacks, a twisty coast road (Highway 1 style) with an overpass,
  a long straight on the southern plains, an east link, and the county's districts, inspired by San Francisco and California:
  **Downtown** = two street grids (one axis-aligned, one rotated to follow the diagonal **Market Street**, like SF), a tower district with a pyramid tower,
  Victorian row houses on **Nob Hill / Russian Hill** (grades over 20 percent) with a hairpin **Lombard Street** block, **Twin Peaks** with a winding road,
  **Golden Gate Park** (a long green strip with a lake and a park drive); **the Valley** = LA style wide palm-lined boulevards with strip malls, parking lots and stucco houses;
  **Mulholland** = a very twisty ridge road in the hills. Roads that cross do so on real overpasses (found and built automatically, `fixCrossings`).
  Collision: guardrails on all divided highways (except junctions), on cliffs and bridges; buildings (also the rotated ones), poles, trees and bridge piers are solid
  (with height ranges, so the deck of a bridge is not blocked by what is under it); steep banks are walls. Everything is deterministic.
* **Rendering**: terrain is a GPU clip-map (6 rings, one draw each) displaced from a 16-bit height texture; roads are ribbons with analytic
  lane markings; buildings/trees/barriers are merged per 128 m cell and culled by distance + frustum; sky, fog and water are shaders.
  About 40-110 draw calls and 60-90k triangles per frame. No shadows or reflections. A render-scale governor keeps frame time near 16 ms.
* **Car**: the Surge Sport mesh baked from the Close Call garage (`src/car_nitro.js`, made with `tools/`), wheels separate so they spin and steer.
* **Driving** (`HND` constants at the top of `src/40_car.js`): grip first, like the Need for Speed arcade games. Steering is limited by a tyre budget
  (about 1.4-2.3 g), so at speed full lock runs wide instead of sliding. The handbrake starts a drift: the stick picks the slide angle, a stability assist
  holds it and straightens the car when you let go. Speed is shown in mph. Tuned like a sports car: firm brakes (60 mph to a stop in about 1.2 s), quick turn-in, and a handbrake drift that builds in under 0.3 s and keeps turning the car's path at any speed. The handbrake is also a brake: a slide sheds speed, and the slide angle the stick can ask for grows as the car slows, so a full-stick handbrake turns the car right round (about 170 degrees in 0.75 s at 30-45 mph, 1 s at 60, 2 s at 100); a half stick stays a controlled drift. Cars stay glued to the road (small bumps never cut the grip), braking is firm but not instant,
  the body leans and dives. Nitro is filled by drifting and is a latch: one tap starts it, it runs until the tank is empty (tap again or brake to stop). Building, barrier and bank collisions, respawn.
* **Controls**: touch (drag the left half to steer; GAS and BRAKE pedals bottom right, DRIFT above brake, NITRO above gas; tap the minimap (top left) for the world map;
  AUTO = automatic gas) or keyboard (arrows/WASD, Space drift, Shift nitro, R respawn, M map, G auto-gas, F fps, P pause).

Modules, in load order: `00_util` math/noise, `10_gl` GL helpers and all shaders, `20_map` roads + terrain function,
`21_terrain` height map/carving/ground colours, `22_build` static geometry + spatial queries, `30_render` frame, `40_car` car/physics/camera/effects,
`50_ui` input/HUD/minimap/audio/quality, `90_main` boot + loop.

`tools/` documents how the car was extracted from the garage (needs the Close Call test harness; not needed to build the racer).
