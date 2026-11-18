# Neon City — Saltwater Vice

An original open-world crime game that runs in a desktop browser from its own files: a sunlit
coastal grid of eight by eight blocks, pastel towers with lit windows, palms down the pavement,
traffic, a walking crowd, a wanted level with cruisers that hunt you, three jobs and a pistol.

It is built on three.js (vendored, minified) with no build step and no network request: every
script, texture and sound is either a file under `game/` or made at runtime.

[![make.fun gta6-01](https://make.fun/badge/gta6-01.svg)](https://make.fun/c/gta6-01)
[![rank](https://make.fun/badge/gta6-01/Topan998/neon-city-gta6/rank.svg)](https://make.fun/c/gta6-01)
[![reward](https://make.fun/badge/gta6-01/Topan998/neon-city-gta6/reward.svg)](https://make.fun/c/gta6-01)

Bounty: <https://make.fun/bounty/gta6-01>

## Play it

```sh
node serve.ts          # serves game/ on http://localhost:8080
```

Then open <http://localhost:8080> and press **Enter**.

| | |
| --- | --- |
| **W A S D** | walk, run the lanes, drive |
| **Mouse** | look around (click the canvas to lock the pointer) |
| **F** | get into the nearest car, or get out |
| **Left click** | fire the pistol |
| **Shift** | sprint on foot, handbrake in a car |
| **T** | rain on, rain off |
| **Esc / P** | pause, and save |
| **Enter** | start, resume, or wake up after a wipeout |

Add `?rain=1` to the address to start under a shower, and `?shot=city|chase|mission|night` to load
one of the four staged photographs without a pointer lock.

## What is in it

- **A city, not a street.** 64 blocks of buildings between nine streets a side, with pavements and
  kerbs, lane paint and crosswalks, street lamps on every corner and mid-block, palms down every
  sidewalk, neon signs over the shopfronts, and a sea and sand promenade on the east edge. Day turns
  to night: windows light up, the lamps pool warm light on the pavement, the signboards glow, and the
  asphalt holds a sheen once it is wet.
- **Bodies that move.** The player and the crowd are rigged, not posed: arms and legs hang off hip
  and shoulder pivots and swing from a phase advanced by the metres travelled, so the cadence
  tightens from a walk into a run, the torso bobs and leans, the shoulders counter-swing and the
  heading eases around instead of snapping. People on the pavement keep their own pace and now and
  then stop for a beat at a corner.
- **Police that read on screen.** A cruiser's roof bar alternates red and blue on a timer with a
  pulsing glow underneath, the first car of a new chase is put down the road behind you instead of
  the far horizon, the wanted stars thump when a star is earned, and a short siren wail announces it.
- **On foot and behind the wheel.** A third-person camera over the right shoulder that pulls in when
  a wall gets between it and you, a car handling model with a handbrake that breaks the rear loose,
  and physics that shove you off a building rather than through it.
- **A living street.** Traffic drives the grid and turns at intersections; 220 people walk the
  pavement loops, duck when a gun goes off, and go down when one is aimed at them.
- **Heat.** Every shot, kill and carjacking raises it. Stars appear, cruisers close in, ram you, and
  pour out officers with pistols when you are on foot. Break line of sight and the heat bleeds away;
  a wipeout sends you to the clinic with less money and a clean record.
- **Three jobs and a story.** *Salt Run* (steal the gold Cobalt GT and deliver it to the locks),
  *Cobalt Sweep* (wipe out the five Cobalt Kings at their hangout) and *Three Star Exit* (take a
  three-star level and outrun the net to the marina). Each pays, each is saved.
- **A HUD that reads.** Cash that counts up or down to a new total instead of snapping, a job
  counter, pulsing wanted stars, condition, a speedometer, an objective banner with its timer, and a
  minimap that draws the street grid, the blocks, the police, the markers and your arrow every frame.
- **Weather.** `?rain=1` (or **T**) darkens the sky, pulls the fog in, drops a light shower and turns
  the road into something that carries the lamps — the night photograph uses the same wet road.
- **Sound made from nothing.** A WebAudio engine that follows the throttle, a pistol crack, tyres,
  impacts, rain, a two-tone siren that rises as the cruisers close, and a chime when a job pays.

## Where it lives

```
game/index.html          the page: canvas, HUD markup, styles, the two script tags
game/vendor/three.min.js three.js, vendored minified (not counted as source)
game/src/main.js         boot, the fixed-step loop, screens, saving, weather, the intro pan
game/src/config.js       every tunable number: grid, speeds, gait, handling, heat, palette
game/src/world.js        the procedural city, sky, light, collisions, time of day, wet road
game/src/player.js       the rigged character, the camera rig and the pistol
game/src/vehicles.js     car models, arcade handling, headlights, parked cars and traffic
game/src/pedestrians.js  the instanced, walking crowd on the pavement loops
game/src/police.js       the wanted level, the cruisers, their light bars and the officers
game/src/missions.js     the three jobs, their markers, crew and payouts
game/src/hud.js          the HUD, the cash ticker, the toasts and the minimap canvas
game/src/audio.js        the synthesized engine, siren, rain and gunfire
game/src/effects.js      tracers, sparks, blood, dust, wreck fireballs and the shower
game/src/shots.js        the four staged scenes behind ?shot=
game/src/selftest.js     a headless run of the systems behind ?selftest=1
game/src/shape.js        geometry helpers, including the limb pivots and the ground disc
game/src/random.js       the seeded generator that makes every load the same city
game/src/input.js        keyboard, mouse, pointer lock and the queued actions
```

`main.ts` copies `game/` and `screenshots/` to `$MAKEFUN_OUTPUT_DIR` (or `/output`), checks the four
screenshots against the gate's size cap, and writes the dossier the judge reads:

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts
```

## Screenshots

The four images in `screenshots/` are renders of the game itself, taken from a headless Chromium
against the local server, each one a scene the game stages by itself:

- `1-city.png` — on foot, mid-stride on the avenue, traffic and palms running to the towers
- `2-chase.png` — three stars, a cruiser alongside with its bar lit red, another closing behind
- `3-mission.png` — the Salt Run banner, the drop beacon ahead and the speedometer reading
- `4-night.png` — the boulevard after dark, windows lit, lamps pooled on a wet road

Each scene is reachable from the address bar: `?shot=city`, `?shot=chase`, `?shot=mission`,
`?shot=night`. They are deterministic — two renders of the same scene are byte-identical, which is
what lets the shots be checked with `cmp`. `?selftest=1` walks, steals a car, drives, fires, calls
the police and reports what happened in the page's status line.

An original work: its city, characters, cars, names, story, art and sound are its own. MIT licensed.
