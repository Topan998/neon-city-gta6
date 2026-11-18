# Neon City — Saltwater Vice

An original open-world crime game that runs in a desktop browser out of its own folder: a low-poly
coastal city at golden hour, streets of towers and low shopfronts with traffic in the lanes and a
crowd on the pavement, cars you can pull a driver out of, a five-star wanted level with cruisers
that come after you, and three jobs that pay.

Built on three.js, vendored and loaded from `game/vendor/`. No build step, no bundler, no network
request at runtime: every line of code, texture and sound is either a file under `game/` or made by
the page itself.

[![make.fun gta6-01](https://make.fun/badge/gta6-01.svg)](https://make.fun/bounty/gta6-01)
[![rank](https://make.fun/badge/gta6-01/Topan998/neon-city-gta6/rank.svg)](https://make.fun/bounty/gta6-01)
[![reward](https://make.fun/badge/gta6-01/Topan998/neon-city-gta6/reward.svg)](https://make.fun/bounty/gta6-01)

Bounty: <https://make.fun/bounty/gta6-01> — entry `gta6-01`, owner `Topan998`, repo
`neon-city-gta6`.

## Run it

```sh
node serve.ts            # serves game/ on http://localhost:8080
```

Open <http://localhost:8080> and click the title screen to start. `node serve.ts --port 3000` picks
another port; the server only reads under `game/`, so it is a development convenience, not something
to expose.

## Controls

| Key | On foot | In a car |
| --- | --- | --- |
| **W A S D** | walk | throttle, brake, steer |
| **Mouse** | look; click to fire the pistol | look around |
| **Shift** | sprint | boost |
| **Space** | — | brake / handbrake |
| **E** | get in the nearest car — or pull the driver out | — |
| **F** | — | step out |
| **R** | reload | — |
| **M** | mute | mute |
| **Esc** | pause | pause |

The HUD repeats the two or three keys that matter for what you are doing, so the car hints are
`F · exit`, `Space · handbrake`, `Shift · boost` and the pavement hints are `E · enter car`,
`left click · fire`, `R · reload`.

## The four things it does

- **A city with moving parts.** A grid of blocks and towers, painted lanes and crosswalks, palms
  and lamps down the pavements, shopfronts with awnings and signs. Traffic drives the grid, and
  pedestrians walk their own loops along the kerb.
- **Cars you take and drive.** Walk up to a car, press **E**, and it is yours. Handling is arcade —
  throttle, brake, handbrake to break the rear loose — with a speedometer in km/h, a gear readout,
  headlights that pool on the asphalt, and a condition bar you can watch fall.
- **Heat, and police that act on it.** Shots, a kill or a hijacking raise the wanted level, star by
  star, up to five. Cruisers answer: their roof bars strobe red and blue, they close in, and
  officers get out when the car stops. Break line of sight long enough and the stars fall away.
- **Three jobs.** Each one has a marker, its own banner with a countdown and a payout. The first,
  *Saltwater Run*, is a delivery run in a car you have to keep in one piece. The second sends you
  after a rival crew on foot — the banner counts them down.

Around them: a HUD that ticks cash up and down instead of snapping, a minimap that draws the street
grid, the police and the objective every frame, and sound synthesized in the page (engine note,
tyres, gunfire, sirens) rather than loaded from files.

## Screenshots

Four renders of the game itself, 1280×720, in `screenshots/`:

- `1-city.png` — behind the wheel at golden hour, traffic ahead down the avenue, palms and motel
  awnings either side, the objective 32 m out and the minimap drawing the grid.
- `2-chase.jpg` — after dark with three stars lit: a cruiser waiting at the intersection with its
  bar flashing, headlights washing the crosswalk, neon on the shopfronts.
- `3-mission.jpg` — on foot on job 2 of 3, the banner reading `WIPE OUT THE RIVAL CREW — 4 LEFT`
  with 1:36 on the clock, pistol up, `AMMO 12/42`.
- `4-night.jpg` — the boulevard after a shower: wet asphalt carrying the lamps and the cyan lane
  paint, the `VICE` sign lit green, traffic queued at the lights.

Each one is a scene the game stages for itself from the address bar, pinned to exactly 1280×720 and
with no pointer lock needed:

```
?shot=city      ?shot=chase      ?shot=mission      ?shot=night
```

## Where it lives

```
game/index.html           the page: canvas, boot diagnostics, and the two script tags
game/vendor/three.min.js  three.js, vendored minified (classic script, not counted as source)
game/src/main.js          boot, the fixed-step loop, the screens and the intro pan
game/src/config.js        the numbers the other modules read: grid, speeds, handling, heat, palette
game/src/world.js         the procedural city, sky, light, collisions, time of day, wet road
game/src/player.js        the rigged character, the camera rig and the pistol
game/src/vehicles.js      car models, arcade handling, headlights, parked cars and traffic
game/src/pedestrians.js   the crowd on the pavement loops
game/src/police.js        the wanted level, the cruisers, their light bars and the officers
game/src/missions.js      the three jobs, their markers, timers and payouts
game/src/hud.js           the HUD, the cash ticker, the banners and the minimap canvas
game/src/audio.js         the synthesized engine, siren, tyres and gunfire
game/src/effects.js       tracers, sparks, dust, wreck fire and the shower
game/src/shots.js         the four staged scenes behind ?shot=
game/src/util.js          the helpers every module above shares
game/src/three-shim.js    the small bridge between the vendored build and the module graph
```

## Handing it in

`main.ts` stages the entry and writes the dossier the judge reads:

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts
```

It copies `game/` and `screenshots/` into `$MAKEFUN_OUTPUT_DIR` (default `/output`) over an emptied
directory, refuses a screenshot set the gate would drop (at most four images, 256 KiB each), and
calls `buildDossier` from `vendor/makefun-game.ts` with the gate's own caps to write
`dossier.json` next to them. It prints what it wrote — files copied, screenshot count, dossier
bytes — and two runs produce byte-identical dossiers.

An original work: the city, the people, the cars, the names, the story, the art and the sound are
its own. MIT licensed.
