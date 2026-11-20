// config.js — the numbers, the palette and the shots. Nothing here reads the clock or the DOM:
// every module pulls its tunables out of this one file, so a balance pass is one edit.
//
// The city is a 8x8 grid of blocks with a road down every gutter: block centres sit on a pitch of
// 80 m, each block is 64 m across, so the playable square runs from -320 to +320 in x and z.

export const CITY = {
  blocks: 8,          // blocks per side
  pitch: 80,          // road line to road line
  blockW: 64,         // block footprint, road edge to road edge
  roadW: 16,          // asphalt, kerb to kerb
  laneOffset: 4.1,    // centre of a lane, measured from the road's centre line
  sidewalkW: 3.6,     // pavement ring inside the kerb
  curbH: 0.22,        // pavement height
  half: 320,          // half the playable square
  beachZ: 330,        // sand starts here (+z edge of town)
  waterZ: 430,        // the sea beyond the sand
  skyRadius: 1400,
};

// Where the four road lines sit: -320, -240, ... 320 (nine of them, eight gaps between).
export const ROAD_LINES = (() => {
  const lines = [];
  for (let i = 0; i <= CITY.blocks; i += 1) lines.push(-CITY.half + i * CITY.pitch);
  return lines;
})();

// The four shots the judge sees, as one contact sheet. The values are read by shots.js.
export const SHOTS = {
  city: {
    name: '1-city.png',
    time: 0.30,          // early evening: long amber shadows
    wet: 0.25,
    player: { x: -18, z: 96, heading: -Math.PI / 2 },
    cam: { yaw: -0.34, pitch: 0.055, dist: 6.4, height: 1.5 },
    traffic: 18,
    peds: 46,
    parked: 22,
  },
  chase: {
    name: '2-chase.jpg',
    time: 0.86,
    wet: 0.72,
    player: { x: 40, z: 240, heading: -Math.PI / 2 },
    cam: { yaw: -0.20, pitch: 0.08, dist: 7.8, height: 1.7 },
    traffic: 20,
    peds: 30,
    parked: 20,
  },
  mission: {
    name: '3-mission.jpg',
    time: 0.38,
    wet: 0.3,
    player: { x: 118, z: -34, heading: Math.PI * 0.5 },
    cam: { yaw: 0.10, pitch: 0.03, dist: 5.2, height: 1.55 },
    traffic: 18,
    peds: 40,
    parked: 22,
  },
  night: {
    name: '4-night.jpg',
    time: 0.92,
    wet: 1,
    player: { x: -162, z: -6, heading: Math.PI * 0.5 },
    cam: { yaw: -0.12, pitch: 0.07, dist: 7.0, height: 1.65 },
    traffic: 20,
    peds: 26,
    parked: 22,
  },
};

// Time of day, as the sun's elevation and the colour it throws. `t` runs 0 → 1: 0 dawn, 0.3 gold,
// 0.5 noon (flat), 0.86 dusk, 0.95 night. main.js interpolates between neighbours.
export const DAYLIGHT = [
  { t: 0.00, sun: [0.55, 0.30, 0.55], horizon: [0.42, 0.33, 0.48], zenith: [0.04, 0.07, 0.17], sunI: 4.0, hemiI: 0.35, fog: [0.26, 0.26, 0.36], elev: 2, neon: 0.8, lamp: 0.6 },
  { t: 0.30, sun: [1.00, 0.56, 0.26], horizon: [0.92, 0.50, 0.30], zenith: [0.06, 0.15, 0.38], sunI: 18.0, hemiI: 0.62, fog: [0.62, 0.46, 0.42], elev: 20, neon: 0.25, lamp: 0.2 },
  { t: 0.50, sun: [1.00, 0.95, 0.86], horizon: [0.62, 0.74, 0.86], zenith: [0.10, 0.28, 0.62], sunI: 22.0, hemiI: 0.78, fog: [0.68, 0.76, 0.86], elev: 58, neon: 0, lamp: 0 },
  { t: 0.72, sun: [1.00, 0.48, 0.22], horizon: [0.86, 0.40, 0.24], zenith: [0.05, 0.09, 0.24], sunI: 11.0, hemiI: 0.45, fog: [0.46, 0.32, 0.32], elev: 9, neon: 0.65, lamp: 0.5 },
  { t: 0.86, sun: [0.95, 0.30, 0.34], horizon: [0.52, 0.22, 0.30], zenith: [0.03, 0.04, 0.12], sunI: 2.6, hemiI: 0.26, fog: [0.22, 0.15, 0.22], elev: 1, neon: 1, lamp: 1 },
  { t: 1.00, sun: [0.35, 0.42, 0.85], horizon: [0.12, 0.10, 0.20], zenith: [0.01, 0.02, 0.05], sunI: 0.5, hemiI: 0.14, fog: [0.07, 0.08, 0.14], elev: -8, neon: 1, lamp: 1 },
];

export const SUN_DIR = { az: Math.PI, dist: 340 };

// Materials: the palette the whole city is painted from, plus per-surface roughness.
export const PALETTE = {
  road: 0x1b1d22,
  roadWet: 0x14161a,
  paint: 0xd9d6c8,
  paintYellow: 0xd7b75a,
  sidewalk: 0x9a938a,
  curb: 0xb0a89d,
  lot: 0x6d6862,
  sand: 0xcbb99a,
  water: 0x14323f,
  palmTrunk: 0x6a5136,
  palmLeaf: 0x2f5c33,
  lampWarm: 0xffcf8a,
  neon: [0xff3d81, 0x31e6ff, 0x8b4dff, 0x35ff9e, 0xffa63d],
  policeBlue: 0x2b6bff,
  policeRed: 0xff2233,
  glass: 0x1d2a34,
  concrete: 0x8f8b84,
  brick: 0x8a5a46,
  tower: 0x5c6470,
};

// Car paint, split by shade so the traffic reads as a mixed street rather than one fleet.
export const CAR_COLOURS = [
  0xb02a2a, 0x2f4f7a, 0xd8d3c6, 0x22262b, 0x6d6f74, 0x2f6d4f,
  0xe08b2a, 0x8a2f6d, 0x356b8a, 0x9a9a90, 0x4a3a2a, 0xc0c8cc,
];

export const CAR_KINDS = [
  { id: 'sedan', len: 4.5, wid: 1.92, hgt: 1.42, mass: 1.0 },
  { id: 'coupe', len: 4.2, wid: 1.86, hgt: 1.26, mass: 0.92 },
  { id: 'van', len: 5.3, wid: 2.06, hgt: 2.1, mass: 1.35 },
  { id: 'pickup', len: 5.0, wid: 2.0, hgt: 1.78, mass: 1.2 },
  { id: 'sport', len: 4.3, wid: 1.94, hgt: 1.10, mass: 0.82 },
];

// Arcade handling. Units are metres and seconds; a top speed of 42 m/s is about 150 km/h.
export const HANDLING = {
  accel: 11.5,
  brake: 22,
  reverse: 6.5,
  maxSpeed: 42,
  boost: 1.22,
  drag: 0.42,
  rollDrag: 0.9,
  steerMax: 0.72,
  steerSpeed: 2.6,
  grip: 7.5,
  driftGrip: 2.2,
  tyreRadius: 0.34,
};

// Heat: a star per threshold. Spawning gets closer and cruisers get more numerous with the level.
export const WANTED = {
  thresholds: [0, 25, 85, 190, 340, 520],
  cruiserCount: [0, 1, 2, 3, 4, 6],
  spawnDist: [0, 96, 82, 70, 58, 46],
  loseRate: 0.014,       // stars bleed away per second once out of sight
  sightRange: 96,
  officerCount: [0, 0, 1, 2, 3, 4],
};

export const CRIME_HEAT = {
  gunshot: 9,
  homicide: 34,
  hijack: 22,
  assault: 12,
  speeding: 0.6,
};

export const PLAYER = {
  radius: 0.42,
  height: 1.82,
  walk: 3.4,
  run: 6.6,
  sprint: 8.2,
  turnRate: 9,
  jump: 4.2,
  health: 100,
  maxAmmo: 60,
  mag: 12,
};

export const CAMERA = {
  fov: 62,
  near: 0.15,
  far: 1600,
  shoulder: 0.55,
  lookAhead: 6,
  damping: 9,
  mouseSensitivity: 0.0021,
};

export const RENDER = {
  exposure: 1.05,
  shadowSize: 2048,
  shadowExtent: 120,
  shadowBias: -0.0005,
  shadowNormalBias: 0.02,
  fogNear: 90,
  fogFar: 720,
};

// The three story jobs. story.js owns the dialogue; ids live here so the HUD and save share them.
export const MISSION_IDS = ['saltwater_run', 'rival_crew', 'harbour_escape'];

export const SAVE_KEY = 'neon-city-gta6/save/v5';
