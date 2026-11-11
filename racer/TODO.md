# Racer: where the work stands

Branch `claude/close-call-game-updates-n6s64g`. Build `python3 racer/build.py`, tests `node racer/tests/<name>.js`. Never open a pull request, never modify `Close_Call.html` / `Close_Call.backup.html`.

## Done
- Handling review (`PHYS`, `deflect()` in `src/40_car.js`, test `rphys.js`, old behaviour with `?hnd=classic` or the HANDLING switch in the car menu).

## Next (in this order, one commit each)
1. World logic: a road audit + fixes + test, b curbs and sidewalks, c more cities, d traffic lights, e guard rails (metal: slide, sparks).
2. Traffic variety (bus, garbage truck, van, taxi, pickup), better civilian cars, the Close Call car models.
3. Police overhaul (models, AI, rarer, heat 0 at the start, star table, spike strips, helicopters, minimap shows police only).
4. Supercars and looks (creases, distinct nose / tail, paint types, plates, seams).
5. Full suite on a frozen build, READMEs, final report.

## Known, not fixed
- `rcars.js`: two checks fail and already failed before this work ("every body is made of finite numbers ..." and "every body is the length, width and height of its spec"). To look at in batch 4.
- Brakes and cornering do not share the tyre (arcade, left as it is).
