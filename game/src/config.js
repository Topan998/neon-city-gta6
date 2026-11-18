// Every number the city and its people are built from, in one place: the street grid, the player's
// speeds and walk cycle, the cars' handling, the police's aggression, the mission rewards, the
// weather and the palette. Tuning the game means editing this file, not hunting through the systems.
//
// The walk-cycle numbers are in metres per stride, not seconds: a cycle advances with distance
// travelled, so the legs stay in step whether the body is walking, jogging or sprinting.

/** The street grid: `grid` blocks a side, each cell `cell` metres across with a `road`-wide street. */
export const CITY = {
  grid: 8,
  cell: 70,
  road: 14,
  walk: 4,
  seed: 20261119,
};

export const HALF = (CITY.grid * CITY.cell) / 2;
export const ROAD_HALF = CITY.road / 2;
export const BLOCK_HALF = (CITY.cell - CITY.road) / 2;
export const LOT_HALF = BLOCK_HALF - CITY.walk;
export const BOUNDS = HALF + ROAD_HALF - 2;

export const PLAYER = {
  walk: 4.4,
  sprint: 8.4,
  accel: 46,
  radius: 0.42,
  height: 1.78,
  eye: 1.62,
  health: 100,
  regen: 5.5,
  regenDelay: 7,
  carReach: 3.4,
  // The walk cycle: one full stride (both legs) per `stride` metres walked, with the cadence
  // tightening as the body speeds up. `swing` is the peak leg angle in radians.
  stride: 2.5,
  runStride: 3.1,
  swing: 0.62,
  armSwing: 0.48,
  bob: 0.045,
  lean: 0.055,
  turnRate: 9.5,
};

export const CAMERA = {
  fov: 62,
  distance: 5.2,
  height: 1.35,
  shoulder: 0.78,
  lookAhead: 3.2,
  mouse: 0.0022,
  pitchMin: -0.72,
  pitchMax: 0.58,
  carDistance: 7.6,
  carHeight: 2.6,
  carPitch: -0.17,
};

export const CAR = {
  maxSpeed: 33,
  reverse: 9,
  accel: 15,
  brake: 26,
  drag: 0.42,
  rollResist: 1.6,
  grip: 7.2,
  driftGrip: 1.25,
  turn: 1.15,
  radius: 1.25,
  enterReach: 3.6,
};

export const TRAFFIC = {
  count: 22,
  speed: 9.5,
  speedJitter: 3.5,
  lane: 3.3,
};

export const PEDS = {
  count: 220,
  speed: 1.35,
  speedJitter: 0.5,
  // A person on the pavement now and then stops at the corner: a short beat, never a freeze.
  pauseChance: 0.45,
  pauseMin: 0.35,
  pauseMax: 1.5,
  stride: 1.55,
  swing: 0.55,
};

export const WANTED = {
  stars: [0, 20, 45, 75, 110, 150],
  decay: 2.6,
  decayDelay: 9,
  maxCars: 4,
  // The first cruiser of a fresh chase appears this far behind the player instead of off-screen.
  firstSpawn: 26,
};

export const CRIME = {
  gunshot: 4,
  pedKilled: 26,
  copKilled: 55,
  carjack: 12,
  copCarWrecked: 40,
  ramPlayer: 6,
};

export const MISSIONS = {
  rewards: [850, 1200, 2000],
  deliveryTime: 110,
  crewCount: 5,
};

export const WEATHER = {
  // `?rain=1`: a light shower, a darker sky and a wet road.
  drops: 900,
  area: 46,
  top: 22,
  fall: 26,
  // How much of the wet-road sheen is on when it is merely night (0) versus raining (1).
  sheenNight: 0.45,
};

export const SAVE_KEY = 'neon-city.save.v1';

/** The city's paint: sun-bleached coral, mint and sand, with glass towers behind it. */
export const PALETTE = {
  skyTopDay: 0x1668c4,
  skyBottomDay: 0xf7e6c9,
  skyTopNight: 0x070f2a,
  skyBottomNight: 0x2b2f5c,
  skyTopStorm: 0x1b2a3a,
  skyBottomStorm: 0x6a6f78,
  fogDay: 0xe4e0d4,
  fogNight: 0x121a33,
  fogStorm: 0x5f6773,
  sunDay: 0xfff4da,
  sunNight: 0x8fa8d8,
  asphalt: 0x4b4d52,
  sidewalk: 0xc8bfae,
  facade: [
    0xf7d9ae, 0xf5bfa2, 0xeda184, 0x9fded0, 0x8fd2dc, 0xf6e6bd,
    0xdcc2ef, 0xc6e0a2, 0xf9b9a6, 0xb9dcea, 0xefae90, 0xf7e3c8,
  ],
  tower: [0xa8c4d2, 0x93b6c8, 0xbccbd2, 0x8fb0c4],
  car: [0xef5b6b, 0x2fbfa0, 0xf7c04a, 0x4a7bd0, 0xe8e8ec, 0x2a2f3a, 0xb46ad8, 0xf08a3c],
  police: 0x1a2436,
  ped: [0xf2b8a0, 0x8fd3c4, 0xf5d98a, 0x9ab8e8, 0xe8a0c0, 0xc8d8a0, 0xf0f0f0],
};
