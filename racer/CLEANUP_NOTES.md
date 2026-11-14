# Racer: state of the build, for the clean-up prompt

Written after batch 44. Branch `claude/close-call-game-updates-n6s64g`. Never open a pull request; never modify `Close_Call.html` / `Close_Call.backup.html` (reading them to port models is fine).

## How to work on it
- Source: `racer/src/NN_*.js` + `template.html`. Build: `python3 racer/build.py` -> `Racer_Prototype.html`.
- Tests: `node racer/tests/<name>.js` (`RFILE=<copy.html>` runs a frozen build; `RACER_OUT=<dir>` for screenshots). Quick list: `racer/tests/run_quick.sh`.
- Docs to keep in step: `racer/README.md` (one "Batch N" line each, ascending), `racer/tests/README.md`, `racer/TODO.md`.
- Publish: `python3 racer/tools/fragment.py Racer_Prototype.html <scratchpad>/art/racer-prototype.html`, then the Artifact tool on the existing artifact URL.
- Looks: `?look=burn` (default, Burnout), `?look=real`, `?look=cine`, `?look=classic` (cheapest). Quality tiers Low / Medium / High / Auto.

## The art pass (jobs 1-8 of `NEXT_PROMPT_REALISM.md`)
| Job | Batch | State |
|---|---|---|
| 1 median on divided roads | 33 | done (`rmedian.js`) |
| 2 asphalt | 34 | done: oil strips, tar cracks, repair patches, worn paint |
| 3 terrain | 37, 43 | done; a cobblestone-blotch regression on dry fields was fixed in 43 |
| 4 trees and grass | 38 | colours and birch only; **no new tree shapes** (the High triangle budget blocks more) |
| 5 buildings | 39, 44 | new window tile; shopfronts (glass band, awning, cornice) on ~196 buildings. **Tower upper floors, row houses and most other building kinds are still plain boxes** |
| 6 lighting and post | 40 | grade, blur, fringe, sun shafts, contact shading. **Contact shading is an approximation, not depth-based SSAO** |
| 7 cars | 35, 36, 41 | wheels spin on all 23 vehicle types, cleaner bodies, Burnout paint, glass, lamps. **Supercars share one cabin; the cop car, interceptor and police SUV reuse Close Call bodies with police paint and light bars, not their own designs** |
| 8 night | 42 | night preset with stars, lit windows |

Also this session: crash smoke no longer blinds, the car lasts much longer (`DMG_POOL`), chase camera raised, nitro flames.

## Verified vs not verified
- Verified: boots with no page errors; after batch 44 I re-ran `rscenery`, `rlooks`, `rgfx`, `rcarlook` and `rbudget` (all pass apart from the noisy build-time bar below). The full `run_quick.sh` suite was last run in full during batches 41-43, not after batch 44. `rbudget` passes on all three tiers (High downtown 167k triangles against a 167k limit); screenshots of day, night, gameplay and the car line-up were looked at.
- **Not verified: the real phone.** Everything was measured in Chromium with software GL, so numbers are relative only. The owner reports 60 fps on an iPhone SE with an earlier build; the Burnout look plus shopfronts have not been run on it. First thing to check: frame rate and reloads (the whole map holds ~485k furniture triangles, about 20 MB more buffer memory).
- Shader compile on real iOS GPUs is untested.

## Known failures (all also fail on a build from before batch 32, so not from the art work)
- `rtrail.js` check 4: parked 120 m out in a field, the cops reach you across the grass in 6-13 s.
- `rtraffic.js`: one car 10 m off its lane on the ring (`sc2`), sometimes the coast road too.
- `rscenery.js` check 6 (world build time) is noisy on the test box: the same build measured 8.9-10.9 s, so the bar is now 12 s.

## Rough edges seen while looking at screenshots
- Shopfronts are a flat glass band and a thin awning: no door, no sign, no interior, same on every side.
- Downtown towers: only the podium (7-13 m) gets a shopfront; above it the tower is a plain textured box.
- Garbage truck cab: flat white face with a black slab bumper; the box vans and SWAT truck are boxy.
- The Close Call cars have no opening panels and keep Close Call's tall glass cabin (cabins taller than 0.46 m above the body were lowered 20 %).
- Speed blur smears building edges at high speed (by design, but it is strong on High).
- Autopilot test runs (`play.js` style) freeze the camera after a crash because the crash cinematic is driven by the frame loop, not `worldStep`. Not a game bug.

## Still open from `TODO.md` ("Known, not fixed")
Sacramento one-green wait, straight downtown/Valley grids, death racers ram hard, a car waiting 25 s to turn into Hesperia, empty far-north band and east mesa, fallen lamp post shadow, helicopter built from boxes, burst tyre not shown on the wheel, story for the start position, online multiplayer.

## Things the owner asked for earlier that this file cannot confirm are right
Cops (look, AI, stars, roadblocks, helicopters, spike strips), minimap showing police only, physics feel, more cities, curbs, road connectivity, traffic lights, buses and garbage trucks, rare cops, metal guard-rail slide, civilian upgrades, Close Call models. Batches 2, 3, 9, 12-16 and the "World logic" lines in `TODO.md` cover them, but whether each one *feels* right has only been judged by tests and screenshots. The owner should say which still feel wrong.

## Good order for a clean-up
1. Run on the phone; fix anything that stutters or reloads (drop shopfront sides or shadow range before dropping features).
2. Fix the three known test failures or decide to retire those checks.
3. Whatever the owner finds wrong in play (list it by place and car).
4. Then art: tower upper floors and shop details, tree shapes, SSAO, cop and supercar bodies, in that order of visible payoff per triangle.
