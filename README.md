# Neon City — Saltwater Vice

An open-world crime game that plays in a desktop browser straight out of its own folder. Neon City is
a low-poly coastal town laid out as eight blocks by eight, roads down every gutter, palms and lamps
along the pavements, and a beach with the sea along the +z edge of the map. Around you the place
keeps moving: traffic works the lanes, people walk their loops, and the police answer what you do to
them.

No build step, no bundler, no network request at runtime. three.js is vendored under
`game/vendor/`, every other line of code, texture and sound is a file under `game/` or something the
page makes for itself.

[![make.fun gta6-01](https://make.fun/badge/gta6-01.svg)](https://make.fun/bounty/gta6-01)
[![rank](https://make.fun/badge/gta6-01/Topan998/neon-city-gta6/rank.svg)](https://make.fun/bounty/gta6-01)
[![reward](https://make.fun/badge/gta6-01/Topan998/neon-city-gta6/reward.svg)](https://make.fun/bounty/gta6-01)

Bounty page: <https://make.fun/bounty/gta6-01> — entry `gta6-01`, owner `Topan998`, repo
`neon-city-gta6`.

## Playing it

```sh
node serve.ts
```

Then open <http://localhost:8080> and click the title card. `node serve.ts --port 3000` moves the
port. The server only ever reads inside `game/`, so it is a convenience for working on the game — it
is not meant to face the internet.

## Controls

| Input | On foot | Behind the wheel |
| --- | --- | --- |
| **W A S D** | walk | throttle, brake, steer |
| **Mouse** | look around; left click fires the pistol | look around |
| **Shift** | sprint | boost |
| **Space** | — | handbrake |
| **E** | get into the nearest car, or drag its driver out | — |
| **F** | — | step out |
| **R** | reload | — |
| **M** | mute | mute |
| **Esc** | pause | pause |

The HUD keeps the two or three keys that matter in view: on foot `WASD · walk`, `SHIFT · run`,
`LMB · fire`, `E · enter car`; in a car `F · exit`, `SPACE · handbrake`, `SHIFT · boost`.

## What is in the city

- **The place itself.** Eight by eight blocks on an 80 m pitch, sixteen metres of asphalt between
  kerbs, painted lanes, crosswalks, shopfronts with awnings and signs, towers, palms, street lamps,
  a motel strip and a beach. The clock runs from dawn to night; the roads darken and reflect when it
  rains.
- **Traffic and a crowd.** Cars drive the grid on their own, turning at corners and queueing behind
  what is in front. Pedestrians walk the pavement rings in both directions, and they scatter when
  something loud happens nearby.
- **Cars you take.** Walk up to any car, press **E**, and it is yours — including the cab of a
  traffic car whose driver you may prefer to remove first. Handling is arcade: throttle, brake, a
  handbrake that breaks the rear loose, a top speed near 150 km/h, headlights that pool on the
  tarmac, and a condition bar that falls as you hit things.
- **A wanted level, and police who act on it.** A gunshot, a hijacking, a body or a long stretch at
  speed all add heat; heat buys stars, one to five. Cruisers come in numbers that match the stars
  and spawn closer the hotter it gets, their roof bars strobing red and blue, and officers get out
  when the car stops. Stay out of sight long enough and the stars burn down on their own.
- **Three story missions.** *Saltwater Run* is a delivery with a clock and a car you are asked to
  keep whole. *Bad Business* puts you on foot against Marco's crew on a street corner. *Harbour
  Lights* wants a loaded car on a barge before the tide. Each has a marker on the street, its own
  dialogue banner, an objective with a count or a countdown, a payout, and it unlocks the next.
- **Two ways to earn between them.** Taxi fares: park inside the green pickup ring at walking pace
  and a drop-off appears across town against a clock, paying by distance and by how much time is
  left. Stunt jumps: eight glowing rings hang over the roads; take one above 9 m/s, roughly
  straight through, and it pays once (350 to 600) and stays paid.
- **A HUD that knows what you are doing.** Cash that ticks rather than snaps, the job line, the
  stars, vitals or car condition, a speedometer and gear when driving, the dialogue banner, the
  objective with its clock, the key hints, and a rotating minimap drawing the street grid, the
  objective, the taxi, the open jump rings and the police every frame.
- **A save file.** Money, missions already finished, jumps already taken, fares done and where you
  were standing are written to `localStorage` (`neon-city-gta6/save/v5`) as you earn and as you
  finish a job; the next visit picks up there.
- **Sound made in the page.** Engine note by gear and throttle, tyre scrub, gunfire, sirens,
  stingers — synthesized with the Web Audio API rather than loaded from files.

## Screenshots

Four renders of the game running, 1280×720, in `screenshots/`:

- `1-city.png` (the cover) — early evening on a busy avenue: both directions of traffic filled, cars
  parked nose to tail, a crowd on the kerb, `COLLECT THE CASE · 32 M` on the objective line.
- `2-chase.jpg` — dusk on wet tarmac with three stars lit, a cruiser sitting off the back bumper
  with its bar throwing red and blue, headlights washing over the crosswalk, `LOSE THE CRUISERS`.
- `3-mission.jpg` — job two on foot: Marco's line still in the dialogue banner, `WIPE OUT THE RIVAL
  CREW — 4 LEFT` with `1:36` on the clock, the muzzle flash of a shot leaving the pistol, the crew
  standing across the street, vitals at 74%.
- `4-night.jpg` — after heavy rain on the boulevard: `VICE`, `MOTEL`, `RAMEN`, `CLUB`, `LIQUOR` and
  `ARCADE` burning over the shopfronts, the asphalt carrying every lamp and sign, `REACH THE BARGE
  · 268 M`.

Each frame is a scene the game stages for itself from the address bar, fixed at 1280×720 and without
asking for pointer lock:

```
?shot=city      ?shot=chase      ?shot=mission      ?shot=night
```

## Where it lives

```
game/index.html            the page: canvas, boot diagnostics, the three script tags
game/vendor/three.min.js   three.js r160, vendored minified (a classic script, not counted as source)
game/src/main.js           boot, the fixed-step loop, input, modes, save/load, the ?shot= path
game/src/config.js         the numbers: city grid, handling, heat, palette, shots, save key
game/src/world.js          the procedural city, sky, sun, shadows, collisions, wet roads, neon
game/src/player.js         the rigged character, the camera rig, the pistol
game/src/vehicles.js       car models, arcade handling, traffic AI, headlights, parked cars
game/src/pedestrians.js    the crowd, its pavement loops and its reactions
game/src/police.js         heat, stars, cruisers, light bars, officers on foot
game/src/story.js          the cast, the three jobs and every line of dialogue (data only)
game/src/missions.js       the marker, the runner, the timers, the payout, the chain
game/src/activities.js     taxi fares and the stunt jump rings
game/src/hud.js            money, job, stars, condition, speedo, minimap, banners, screens
game/src/audio.js          synthesized engine, tyres, gunfire, sirens, stingers
game/src/effects.js        muzzle flashes, tracers, sparks, dust, wreck fire, rain
game/src/shots.js          the four staged frames behind ?shot=
game/src/util.js           math, noise, materials and canvas textures shared by all of the above
serve.ts                   a static server for game/ (development only)
main.ts                    the hand-in: stages the entry and writes the dossier
vendor/makefun-game.ts     make.fun's dossier library, copied in and imported as-is
```

## Handing it in

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts
```

`main.ts` runs `game/` and `screenshots/` into `$MAKEFUN_OUTPUT_DIR` (default `/output`), wiping the
previous copies of those two names first, then calls `buildDossier` from `vendor/makefun-game.ts` on
the staged copy and writes `dossier.json` beside it — the game's sources in load order as text, the
screenshots base64'd with their hashes. It passes the gate's own limits (163840 bytes of text, four
screenshots of at most 262144 bytes each, 993 entries and 50331648 bytes in `game/`, 1000 bytes to a
path), so an entry the scorer would refuse fails here by name instead; it prints what it wrote —
files copied, screenshots, dossier bytes — and two runs into two directories produce byte-identical
dossiers.

The city, the people, the cars, the names, the story, the art and the sound are original work.
MIT licensed.
