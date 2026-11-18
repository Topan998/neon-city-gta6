// config.js — every tunable of Neon City in one place: palette, city metrics, physics numbers,
// time-of-day presets and the four screenshot stagings.
//
// The whole game is deterministic: one seed feeds the world, traffic, crowds and the shots, so a
// reload looks the same and a screenshot renders the same bytes twice.

export const SEED = 0x5ea51de;

export const CITY = {
  blocks: 8, // 8x8 city blocks
  pitch: 44, // metres between road centre lines
  road: 12, // carriageway width
  walk: 4, // sidewalk width on each side of a road
  lot: 24, // buildable lot width (pitch - road - 2 * walk)
  curb: 0.17, // sidewalk height above the road
  lane: 3.05, // lane centre offset from the road centre line
  half: 176, // world extent: blocks * pitch / 2
  ground: 900, // ground plane size
};

// Where block (i, j) has its centre. Blocks sit between the roads, not on them.
CITY.origin = -CITY.half + CITY.road / 2 + CITY.walk + CITY.lot / 2; // -154
CITY.blockCenter = (i, j) => ({
  x: CITY.origin + i * CITY.pitch,
  z: CITY.origin + j * CITY.pitch,
});
CITY.roadLine = (i) => -CITY.half + i * CITY.pitch;

export const PHYSICS = {
  gravity: 22,
  player: {
    walk: 2.9,
    run: 6.4,
    accel: 14,
    turn: 9.5,
    eye: 1.72,
    radius: 0.42,
    health: 100,
    respawn: 4,
  },
  car: {
    topSpeed: 41,
    reverseSpeed: 10,
    accel: 15.5,
    brake: 32,
    engineBrake: 3.2,
    steer: 2.05, // rad/s at full lock, scaled down with speed
    grip: 7.4, // lateral velocity damping, per second
    handbrakeGrip: 1.25,
    handbrakeBrake: 9,
    mass: 1,
    bump: 0.55, // restitution on car-to-car contact
  },
  police: {
    topSpeed: 45,
    accel: 18,
    steer: 2.2,
    ramForce: 7,
  },
  wanted: {
    decayDelay: 9, // seconds out of sight before the level starts to fall
    decayRate: 0.055, // stars per second once it does
  },
  traffic: {
    count: 26,
    speedMin: 8.5,
    speedMax: 14,
    stopDistance: 9.5,
    followGap: 8.2,
  },
  peds: {
    count: 42,
    walkMin: 1.15,
    walkMax: 1.75,
    fleeSpeed: 5.1,
    fleeRadius: 11,
  },
};

export const PALETTE = {
  asphalt: 0x2b2c30,
  asphaltWet: 0x1b1d22,
  sidewalk: 0x9a958c,
  curb: 0xb0aaa0,
  concrete: 0xb7b3ab,
  windowGlass: 0x2a3742,
  roof: 0x5c5a56,

  sky: {
    day: { top: 0x3d78b4, horizon: 0xbcd2e2, ground: 0x8f9aa3, sun: 0xfff4dc },
    golden: { top: 0x2f5f92, horizon: 0xf3c489, ground: 0x8d7a68, sun: 0xffd9a0 },
    dusk: { top: 0x1d2c4d, horizon: 0xd8735a, ground: 0x5a4a52, sun: 0xffb073 },
    night: { top: 0x050b18, horizon: 0x1d2b45, ground: 0x0d1219, sun: 0x8fa6c8 },
  },

  sun: {
    day: { color: 0xfff6e2, intensity: 3.9, elevation: 58, azimuth: 138 },
    golden: { color: 0xffb977, intensity: 4.0, elevation: 19, azimuth: 14 },
    dusk: { color: 0xff9457, intensity: 2.2, elevation: 7, azimuth: 292 },
    night: { color: 0x93aed8, intensity: 0.26, elevation: 38, azimuth: 300 },
  },

  ambient: {
    day: { sky: 0xbcd4ea, ground: 0x6d6660, intensity: 0.62 },
    golden: { sky: 0xffd6b0, ground: 0x6a5a4e, intensity: 0.46 },
    dusk: { sky: 0xff9f78, ground: 0x3d3445, intensity: 0.34 },
    night: { sky: 0x35507d, ground: 0x121720, intensity: 0.55 },
  },

  cars: [
    0xc9c4bb, 0x1d2023, 0x7c1f24, 0x244a63, 0x2f5c3c, 0xb09040, 0x6e6f74, 0xd9d4c8,
    0x4b2d5c, 0x1f3a5a,
  ],
  police: { body: 0xe8e9ec, accent: 0x1b2a4a },
  neon: [0xff3d7f, 0x36e2ff, 0xffc24b, 0x8f5cff, 0x56ff9d, 0xff6a3d],
  clothes: [
    0x2c3138, 0x8d3b34, 0x35586b, 0xb3a68c, 0x4c5a3d, 0x6b4a6d, 0xd8cfbd, 0x1f2529,
    0xc06a3a, 0x3f3f5a,
  ],
  skin: [0xe8c4a2, 0xd2a374, 0xa9734a, 0x7a4f32, 0x5a3722, 0xf0d3b6],
};

export const RENDER = {
  exposure: 1.12,
  shadowMap: 2048,
  shadowExtent: 120,
  fov: 62,
  near: 0.25,
  far: 1600,
  maxPixelRatio: 1,
};

export const CAMERA = {
  foot: { distance: 5.0, height: 2.55, shoulder: 0.72, lookHeight: 1.5 },
  car: { distance: 8.6, height: 3.9, shoulder: 0.0, lookHeight: 1.4 },
  orbit: { min: -0.42, max: 0.24 }, // pitch limits
  follow: 7.5, // damping lambda
  bob: 0.035,
};

// Time of day presets: sky colours, sun, fog, wetness and how hard the windows and neon burn.
export const TOD = {
  day: {
    sky: 'day',
    fog: 0xb9cad9,
    fogDensity: 0.0016,
    exposure: 1.0,
    windowGlow: 0.06,
    neonGlow: 0.35,
    wet: 0.12,
    lampGlow: 0.0,
    headlights: 0,
  },
  golden: {
    sky: 'golden',
    fog: 0xe6b994,
    fogDensity: 0.0021,
    exposure: 0.98,
    windowGlow: 0.16,
    neonGlow: 0.7,
    wet: 0.22,
    lampGlow: 0.25,
    headlights: 0.15,
  },
  dusk: {
    sky: 'dusk',
    fog: 0x9c6a6a,
    fogDensity: 0.0026,
    exposure: 1.12,
    windowGlow: 0.85,
    neonGlow: 1.35,
    wet: 0.35,
    lampGlow: 1.0,
    headlights: 1.0,
  },
  night: {
    sky: 'night',
    fog: 0x121b2c,
    fogDensity: 0.0034,
    exposure: 1.22,
    windowGlow: 1.25,
    neonGlow: 1.75,
    wet: 0.85,
    lampGlow: 1.35,
    headlights: 1.0,
  },
};

// The four staged screenshots. Each entry is a recipe used by shots.js: seed, time of day, where
// the player stands, what the camera does, and which HUD pieces are on.
export const SHOTS = {
  city: {
    tod: 'golden',
    seed: 1101,
    player: { x: -3.05, z: 58, angle: -Math.PI / 2 },
    car: { x: -3.05, z: 58, angle: -Math.PI / 2, speed: 9 },
    camera: { distance: 10.2, height: 3.15, yaw: 0.1, pitch: -0.045 },
    traffic: 16,
    peds: 22,
    stars: 0,
    hud: { minimap: true, speedo: true, banner: null },
    weather: 'haze',
  },
  chase: {
    tod: 'dusk',
    seed: 2202,
    player: { x: 3.05, z: -62, angle: Math.PI / 2 },
    car: { x: 3.05, z: -62, angle: Math.PI / 2, speed: 20 },
    camera: { distance: 19.0, height: 5.4, yaw: 0.18, pitch: -0.125 },
    traffic: 10,
    peds: 14,
    stars: 3,
    hud: { minimap: true, speedo: true, banner: 'WANTED LEVEL 3 — LOSE THE COPS' },
    weather: 'wet',
  },
  mission: {
    tod: 'dusk',
    seed: 3303,
    player: { x: 80, z: -100, angle: -Math.PI / 2 },
    car: { x: 84.95, z: -106, angle: -Math.PI / 2, speed: 0 },
    camera: { distance: 5.6, height: 2.75, yaw: 0.06, pitch: -0.05 },
    traffic: 12,
    peds: 18,
    stars: 0,
    hud: {
      minimap: true,
      speedo: true,
      banner: 'JOB 2 OF 3 — WIPE OUT THE RIVAL CREW',
      marker: { x: 88, z: -56 },
    },
    weather: 'dusk',
    onFoot: true,
  },
  night: {
    tod: 'night',
    seed: 4404,
    player: { x: -91.05, z: 30, angle: -Math.PI / 2 },
    car: { x: -91.05, z: 30, angle: -Math.PI / 2, speed: 12 },
    camera: { distance: 9.6, height: 3.45, yaw: 0.02, pitch: -0.075 },
    traffic: 12,
    peds: 12,
    stars: 0,
    hud: { minimap: true, speedo: true, banner: null },
    weather: 'wet',
  },
};

export const MISSIONS = [
  {
    id: 'delivery',
    name: 'Saltwater Run',
    brief: 'Deliver the coupe to the docks before the tide turns.',
    objective: 'DELIVER THE CAR TO THE DOCKS',
    duration: 150,
    reward: 2400,
    target: { x: 132, z: -132 },
  },
  {
    id: 'crew',
    name: 'Rival Crew',
    brief: 'A crew from the east side is muscling in on the strip. Wipe them out.',
    objective: 'WIPE OUT THE RIVAL CREW',
    duration: 180,
    reward: 3800,
    target: { x: -110, z: 66 },
  },
  {
    id: 'survive',
    name: 'Three Stars',
    brief: 'Stay alive for ninety seconds with the whole precinct on you.',
    objective: 'SURVIVE THE CHASE',
    duration: 90,
    reward: 5200,
    target: null,
  },
];

export const HUD = {
  pad: 26,
  minimap: 168,
  stars: 5,
  bannerTime: 3.4,
};

export const AUDIO = { master: 0.55, engine: 0.16, siren: 0.3, gun: 0.4 };
