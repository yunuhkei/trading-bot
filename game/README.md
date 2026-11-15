# Hollow Saints

A gritty open-city crime game that runs in the browser, built for phones first. Three.js, no build step.

**Chapter One: Hymn for the Drowned.** Elias Crowe, a detective framed for murder six years ago, escapes when his prison transport is ambushed. He goes looking for the one informant who might know why. The Hollow Saints, a brotherhood of cops, judges and clergy who run Port Calvary, got to her first.

## Run it locally

```
cd game
python3 -m http.server 8000
```

Open http://localhost:8000. On a phone on the same Wi-Fi, use your computer's local IP instead of `localhost`.

## Controls

| | Phone | Keyboard |
|---|---|---|
| Move | Left thumb (push all the way to sprint) | WASD |
| Look | Drag with right thumb | Mouse |
| Shoot | FIRE (auto-aims at whoever is in front of you) | Click |
| Car in / out | CAR | F |
| Reload | RELOAD | R |
| Brake (in a car) | BRAKE | Space |
| Pause | ❚❚ | P |

## Files

- `js/core.js`: input (touch joystick, mouse, keys) and procedural audio
- `js/world.js`: city generation, collision, rain, lightning, neon
- `js/actors.js`: people, cars, AI, hit effects
- `js/story.js`: Chapter One mission flow and story text
- `js/main.js`: game loop, player, combat, wanted level, camera, HUD

## Publishing

`node tools/build.js` bundles everything into one self-contained page at `dist/index.html`. That single file is what gets published, because some embedded viewers block a page from loading its own separate script files.
