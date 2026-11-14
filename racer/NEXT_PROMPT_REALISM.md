# Prompt for the next session: Racer realistic art pass

Copy everything below the line into a new Claude Code session on the `yunuhkei/trading-bot` repository.

---

You are continuing **Racer**, a single-file WebGL arcade racer for phones, in the repo `yunuhkei/trading-bot`. Work on branch `claude/close-call-game-updates-n6s64g` (pull it first) and push there.

## Hard rules
- Never open a pull request.
- Never modify `Close_Call.html` or `Close_Call.backup.html`.
- The output must stay **one self-contained HTML file**, with no network loads at runtime. The only external assets are the embedded fonts in `racer/assets/fonts`.
- It must stay **deterministic** for the tests: no `Math.random` in the simulation; use `mulberry` / `TR.rng`.
- **Phone budgets.** The weakest target is an iPhone SE at 60 fps. `node racer/tests/rbudget.js` enforces about Low 146 draws / 113k tris and Medium 210 / 160k per frame (the governor's fall-back tiers). **(Batch 45: the owner lifted the polygon budget on High; its numbers in `rbudget` are a regression guard only. New heavy art goes in the High-only detail categories 3 and 4, see README batch 45.)** Heavier work goes in the higher graphics tiers (`GFXT` in `31_gfx.js`) or a new Ultra tier that the frame-time governor only picks on strong devices.
- **Damage is looks only**: damage never changes how the car drives.
- The owner wants short, plain reports. Save usage.

## How the project works
- `racer/src/NN_*.js` modules are concatenated in filename order into `racer/src/template.html`.
- Build with `python3 racer/build.py`, which writes `Racer_Prototype.html` and inlines the fonts.
- Tests are Playwright scripts: `node racer/tests/<name>.js`. Use `RFILE=<copy.html>` to test an older build. `bash racer/tests/run_quick.sh` runs everything (about 40 min; run it in the background). Long runs belong in the background.
- Docs to update every batch: `racer/README.md` (one "Batch N" line), `racer/tests/README.md`, and `racer/TODO.md`.
- Commit messages are "Racer batch N: ...". Push with `git push -u origin claude/close-call-game-updates-n6s64g`, retrying on network errors.
- Publish the playable build:
  1. Run `python3 racer/tools/fragment.py Racer_Prototype.html <scratchpad>/art/racer-prototype.html`.
  2. Publish it with the Artifact tool to the existing URL https://claude.ai/artifact/63Zjfobwm2DFwh4Gtm5yKz (read it first if this session has not published it).
  3. Send the owner screenshots of what changed.
- Screenshots: launch with `racer/tests/rlib.js` (`L.launch({q:'go=1&scale=1&fixed=1&env=day', w:960, h:540})`). Hide the HUD with `document.getElementById('hud').style.display='none'`, set `gfxSetMode('high')`, place the car with `RACER.carPlace(...)`, then call `RACER.camStep` and `RACER.renderOnce(RACER.UI.cw, RACER.UI.ch)`.

## The decision: go realistic
The owner chose a **realistic** art direction. Batch 31 added a test switch: `LOOK` in `racer/src/10_gl.js`, chosen with `?look=real` or `?look=cine`. It is compiled into every shader as `#define LOOK n`. The realistic look currently does the following:
- natural tone mapping
- olive grass with dry-earth patches and a stronger ground bump (terrain shader)
- desaturated foliage (prop shader)
- blue aerial perspective and a warm Mie glow around the sun (`fogm`)
- a harder sun with less fill light (`setEnvU` in `30_render.js`)

Comparison shots are in that conversation. Start by making the realistic look the **default** (`LOOK` 1 when there is no URL parameter, and keep `?look=classic` for the old one). Then work through the list below, roughly in this order, a batch at a time, with before and after screenshots of the same three scenes:
- `ring` at f .33 at sunset
- `ring` at f .62 at midday
- `sfnu3` downtown at f .45

## Jobs
1. **A raised median on the divided highways (style 1 and 4 roads).** Today the median is a flat grey strip with a yellow line each side, drawn in the road shader (`rdF` in `10_gl.js`; `x0 = 1.35` is the median half width, see `laneInfo` in `00_util.js`). The owner wants a **curb in the middle like a sidewalk**: a raised concrete median about 15 cm high, with curb faces on both sides and a paved top, which could later carry a planted strip or a low barrier.
   - Build it as real geometry in `buildRoadMeshes` (`22_build.js`), like the city sidewalks (`r.sw`, `swOn`, `CURB_H`, `buildSidewalks`). Cut it at junctions and crossovers wherever another road's asphalt crosses it.
   - Driving: the car's wheels use `gw()` and `groundAt()` with `RQS.soft`. Curbs must stay a gentle ramp plus a rumble (batch 27), and must never jolt, trip or roll the car (`racer/tests/rcurb.js`).
   - Traffic and cops: they keep to their lanes; the lane graph is in `23_lanes.js`.
   - Check `rlane`, `rcurb`, `rtraffic`, `rbudget` and `raudit`.
2. **Asphalt that looks real** (road shader):
   - lighter, worn grey asphalt with aggregate
   - darker oily centres in each lane
   - tyre marks
   - patched repairs and tar-sealed cracks
   - painted lines that are slightly worn, broken and less saturated (realistic yellow is a dull ochre)
   - wet sheen that follows the weather
   - procedural only; no texture files
3. **Terrain:**
   - mix grass, dry grass, earth and rock by slope, height and noise
   - richer close-up detail with a normal from noise
   - darker gullies
   - beaches and sand by the sea
   - keep `rbudget` happy
4. **Trees and grass.** The current trees are chunky low-poly cones and balls (`ptree`, `pcrown`, `pcone` in `22_build.js`) with a leaf atlas (`uFol`). Make them:
   - many leaf-card clusters on branching trunks, with wind sway
   - several species: pine, oak, palm, desert
   - LOD by distance
   - more grass tufts close up, fading with distance

   Mind the draw and triangle budgets: instance them or merge them into the existing category meshes.
5. **Buildings:**
   - window frames and recesses
   - ledges and cornices
   - storefronts at street level with awnings and signs
   - rooftop units
   - a darker, dirtier material at the ground floor
   - glass that reflects the sky (`envl`)
   - procedural, with variety per district (city, LA valley, desert resort, towns, industry)
6. **Lighting and post:**
   - screen-space ambient occlusion (contact shadows) on the higher tiers; the post pass is in `31_gfx.js`
   - better shadow range and softness
   - sun shafts
   - a subtle colour grade tuned on the three test scenes
7. **Cars:**
   - better paint (clear coat, flakes)
   - tyres with sidewalls and rims with depth
   - glass with interior shading
   - headlight and tail-light glass
   - the car models are generated in `70_carmesh.js`, `71_cars.js`, `72_roster.js` and `73_ccars.js`
8. **Later:** a night mode with working headlights and streetlights.

## Things that must keep working
Run the related tests after each change, and the whole `run_quick.sh` before you finish a batch.
- the game features from batches 1–30: police, events, Takedown, nitro, garages, trails, damage, crash movie, lane assist
- the HUD and fonts
- every test in `run_quick.sh`, including `rbudget` (draws and triangles), `rgfx`, `renv`, `rlooks`, `rcarlook`, `rscenery`, `rcurb`, `rtrail` and `rcoast`

Flaky failures seen so far: `rvar` (Big Pines wrecks) and `rpolice` 7 (a cop inside a building once). Rerun them before chasing them.
