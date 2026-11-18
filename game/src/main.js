// Boot and the one loop. The world, the player, the cars, the crowd, the police and the jobs are
// built once; each frame takes the input, advances the simulation in fixed 1/60 s steps so the
// handling never depends on the display's refresh rate, and paints the result. The game moves
// between four screens — title, play, paused and wasted — and every job or death writes the
// player's money and progress to localStorage.
//
// Two addresses change the mood: `?rain=1` starts the game under a shower (T toggles it), and
// `?shot=city|chase|mission|night` stages one photograph of the real game for the screenshots — it
// drives the same systems for a fixed number of steps and then holds still, so a plain page load
// shows the scene without a mouse or a pointer lock. The title screen opens on a five-second pan
// from street level out over downtown before it settles into its slow orbit.

import { SAVE_KEY, CRIME, PLAYER, CAR, CITY, HALF } from './config.js';
import { blockCenter, createWorld } from './world.js';
import {
  createInput, ACTION_ENTER_CAR, ACTION_PAUSE, ACTION_SAVE_QUIT, ACTION_START, ACTION_TOGGLE_RAIN,
} from './input.js';
import { createAudio } from './audio.js';
import { createVehicleSystem } from './vehicles.js';
import { createPedestrians } from './pedestrians.js';
import { createPolice } from './police.js';
import { createMissions } from './missions.js';
import { createPlayer } from './player.js';
import { createHud } from './hud.js';
import { createEffects } from './effects.js';
import { stageShot } from './shots.js';
import { runSelfTest } from './selftest.js';

const STEP = 1 / 60;
const params = new URLSearchParams(window.location.search);
const shotName = params.get('shot');

const canvas = document.getElementById('game');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.6));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = params.get('shadows') !== '0';
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.NoToneMapping;
renderer.toneMappingExposure = 1.0;

const scene = new THREE.Scene();
const world = createWorld(scene);
world.setTimeOfDay(0);
const audio = createAudio();
const hud = createHud();
const effects = createEffects(scene);
const input = createInput(canvas);

const state = {
  mode: 'menu',
  time: 0,
  menuTime: 0,
  money: 0,
  wanted: 0,
  heat: 0,
  completed: [],
  jobs: 0,
  deaths: 0,
  hasSave: false,
  rain: params.get('rain') === '1',
  forcedNight: params.get('night') === '1' ? 1 : 0,
};

const ctx = { scene, world, state, audio, hud, effects, input };
ctx.vehicles = createVehicleSystem(ctx);
ctx.pedestrians = createPedestrians(ctx);
ctx.player = createPlayer(ctx);
ctx.police = createPolice(ctx);
ctx.missions = createMissions(ctx);

const { vehicles, pedestrians, player, police, missions } = ctx;

// ---- weather ----
/** Turn the shower on or off: sky, fog, wet asphalt, the drops and the hiss all follow. */
function setRain(on) {
  state.rain = Boolean(on);
  world.setRain(state.rain);
  effects.setRain(state.rain);
  if (state.rain) audio.rainStart();
  else audio.rainStop();
  hud.toast(state.rain ? 'Rain over the bay' : 'The rain moves on', 'good');
}

if (state.rain) {
  world.setRain(true);
  effects.setRain(true);
}

// ---- where the player starts, and where the clinic puts them back ----
const clinic = blockCenter(2, 2);
const startSpot = blockCenter(3, 4);

function spawnPlayer(x, z, yaw = 0) {
  player.spawn(x, z, yaw);
  player.cameraYaw = yaw;
  const resolved = world.collideCircle(x, z, PLAYER.radius);
  player.state.x = resolved.x;
  player.state.z = resolved.z;
}

spawnPlayer(startSpot.x, startSpot.z + 26, 0);

// ---- saving ----
function loadSave() {
  try {
    const raw = window.localStorage.getItem(SAVE_KEY);
    if (!raw) return;
    const data = JSON.parse(raw);
    state.money = Number(data.money) || 0;
    state.completed = Array.isArray(data.completed) ? data.completed.filter((id) => typeof id === 'string') : [];
    state.jobs = state.completed.length;
    state.deaths = Number(data.deaths) || 0;
    state.hasSave = true;
    if (typeof data.x === 'number' && typeof data.z === 'number') {
      spawnPlayer(data.x, data.z, Number(data.yaw) || 0);
    }
    hud.setSaveNote(`CONTINUE FROM SAVE · $${state.money.toLocaleString('en-US')} · ${state.completed.length} / 3 JOBS`);
  } catch {
    state.hasSave = false;
  }
}

function save() {
  try {
    window.localStorage.setItem(SAVE_KEY, JSON.stringify({
      money: state.money,
      completed: state.completed,
      deaths: state.deaths,
      x: Math.round(player.state.x * 10) / 10,
      z: Math.round(player.state.z * 10) / 10,
      yaw: Math.round(player.state.yaw * 100) / 100,
      version: 1,
    }));
    state.hasSave = true;
  } catch {
    // Private windows can refuse storage: progress then lasts this visit only.
  }
}

loadSave();

// ---- crime, damage and the things shots have in common ----
ctx.onShot = (origin, hit, point) => {
  police.report(CRIME.gunshot);
  pedestrians.panic(origin.x, origin.z, 46);
  if (!hit) {
    effects.sparks(point.x, point.y, point.z, { x: 0, y: 1, z: 0 }, 4, 0xd8d2c4);
    return;
  }
  if (hit.kind === 'ped') {
    pedestrians.kill(hit.target);
    effects.blood(hit.target.x, 1.2, hit.target.z);
    police.report(CRIME.pedKilled);
    state.money += 15;
    hud.toast('Civilian down · +$15', 'bad');
  } else if (hit.kind === 'officer') {
    police.damageOfficer(hit.target, 34);
  } else if (hit.kind === 'crew') {
    missions.damageCrew(hit.target, 34);
  } else if (hit.kind === 'car') {
    police.damageCar(hit.target, 30);
  }
};

ctx.onMissionDone = () => {
  save();
  hud.setJobs(state.completed.length);
};

// ---- screens ----
function startGame() {
  hud.showMenu(false);
  hud.setPlaying(true);
  hud.showWasted(false);
  hud.showPause(false);
  audio.unlock();
  if (state.rain) audio.rainStart();
  state.mode = 'play';
  if (state.hasSave) hud.toast('Save loaded — back on the street', 'good');
  else hud.toast('Vice Coast · press F at any car to take it', 'good');
}

function pauseGame() {
  state.mode = 'pause';
  hud.showPause(true);
  save();
  audio.engineStop();
}

function resumeGame() {
  state.mode = 'play';
  hud.showPause(false);
}

function wastePlayer() {
  state.mode = 'wasted';
  state.deaths += 1;
  hud.showWasted(true);
  hud.setArmed(false);
  audio.engineStop();
  if (player.state.car) {
    player.state.car.driver = 'none';
    player.state.car = null;
  }
}

function respawn() {
  hud.showWasted(false);
  hud.setPlaying(true);
  police.clear();
  missions.reset();
  state.wanted = 0;
  state.heat = 0;
  state.money = Math.max(0, state.money - 100);
  spawnPlayer(clinic.x, clinic.z + 26, 0);
  state.mode = 'play';
  hud.toast('The clinic patched you up · -$100', 'bad');
  save();
}

// ---- getting in and out of cars ----
function toggleCar() {
  if (player.state.car) {
    const car = player.state.car;
    car.driver = 'none';
    const side = car.heading + Math.PI / 2;
    const x = car.x + Math.sin(side) * 2.2;
    const z = car.z + Math.cos(side) * 2.2;
    player.state.car = null;
    player.state.x = x;
    player.state.z = z;
    player.group.visible = true;
    audio.engineStop();
    hud.toast('On foot');
    return;
  }
  const car = vehicles.nearest(player.state.x, player.state.z, CAR.enterReach);
  if (!car) {
    hud.toast('No car close enough', 'bad');
    return;
  }
  if (car.driver === 'traffic') {
    police.report(CRIME.carjack);
    hud.toast('Carjacked · +wanted', 'bad');
    pedestrians.panic(car.x, car.z, 30);
  }
  car.driver = 'player';
  car.vx = 0;
  car.vz = 0;
  player.state.car = car;
  player.state.x = car.x;
  player.state.z = car.z;
  audio.engineStart();
  hud.toast(`${car.tag === 'salt-car' ? 'Cobalt GT' : 'Hotwired'} — shift for the handbrake`);
}

function handleActions(actions) {
  if (actions & ACTION_START) {
    if (state.mode === 'menu') startGame();
    else if (state.mode === 'wasted') respawn();
    else if (state.mode === 'pause') resumeGame();
  }
  if (actions & ACTION_PAUSE) {
    if (state.mode === 'play') pauseGame();
    else if (state.mode === 'pause') resumeGame();
  }
  if (actions & ACTION_ENTER_CAR && state.mode === 'play') toggleCar();
  if (actions & ACTION_TOGGLE_RAIN && state.mode === 'play') setRain(!state.rain);
  if (actions & ACTION_SAVE_QUIT && state.mode === 'pause') {
    save();
    state.mode = 'menu';
    hud.showPause(false);
    hud.showMenu(true);
    hud.setPlaying(false);
  }
}

/** Traffic and police are solid: shove them apart, and let the hits be heard. */
function separateCars() {
  const car = player.state.car;
  if (!car) return;
  for (const other of vehicles.cars) {
    if (other === car) continue;
    const dx = other.x - car.x;
    const dz = other.z - car.z;
    const distance = Math.hypot(dx, dz);
    if (distance > 3.3 || distance < 0.001) continue;
    const push = (3.3 - distance) * 0.6;
    other.x += (dx / distance) * push;
    other.z += (dz / distance) * push;
    other.mesh.position.set(other.x, 0, other.z);
    car.vx -= (dx / distance) * 3.4;
    car.vz -= (dz / distance) * 3.4;
    if (car.speed > 7 && state.time - (car.lastBump ?? 0) > 0.4) {
      car.lastBump = state.time;
      audio.impact();
      effects.sparks((car.x + other.x) / 2, 0.9, (car.z + other.z) / 2, { x: 0, y: 1, z: 0 }, 6);
    }
  }
}

// One reusable point for the systems that just need to know where the action is.
const focusPoint = { x: 0, z: 0 };

// ---- the simulation step ----
function tick(dt) {
  state.time += dt;
  const actions = input.takeActions();
  handleActions(actions);
  if (state.mode !== 'play') return;

  const car = player.state.car;
  focusPoint.x = player.state.x;
  focusPoint.z = player.state.z;
  if (car) {
    const throttle = input.forward();
    const steer = input.strafe();
    vehicles.step(car, dt, { throttle, steer, handbrake: input.sprint() });
    player.state.x = car.x;
    player.state.z = car.z;
    focusPoint.x = car.x;
    focusPoint.z = car.z;
    audio.setEngine(car.speed, throttle);
    if (input.takeFire()) {
      // Firing from the driver's seat is a window-shot: the pistol still works.
      player.shoot(input, state.time);
    }
  } else if (input.takeFire()) {
    player.shoot(input, state.time);
  }

  player.update(dt, input, state.time);
  world.update(dt, focusPoint);
  vehicles.update(dt);
  pedestrians.update(dt, player);
  separateCars();
  police.update(dt);
  missions.update(dt);
  effects.update(dt);
  effects.updateRain(dt, focusPoint);
  player.updateCamera(dt, input);

  if (!player.state.alive && state.mode === 'play') wastePlayer();

  hud.setMoney(state.money);
  hud.setJobs(state.completed.length);
  hud.setWanted(state.wanted);
  hud.setHealth(player.state.health);
  hud.setArmed(!player.state.car);
  hud.setSpeed(player.state.car ? player.state.car.speed * 3.6 : 0, Boolean(player.state.car));
  hud.setHint(player.state.car
    ? 'F leave car · SHIFT handbrake · T rain'
    : 'F enter car · LMB fire · SHIFT sprint · T rain');
  hud.drawMap({
    x: player.state.x,
    z: player.state.z,
    heading: player.state.car ? player.state.car.heading : player.state.yaw,
    cars: vehicles.cars,
    officers: police.officers,
    crew: missions.crew,
    markers: missions.markers,
  });
}

/** The title screen's backdrop: a five-second pan up from the avenue into a slow orbit downtown. */
function menuCamera(dt) {
  state.time += dt;
  state.menuTime = Math.min(5, state.menuTime + dt);
  const t = state.menuTime / 5;
  const ease = t * t * (3 - 2 * t);
  const orbit = state.time * 0.06;
  const radius = 118;
  const camera = player.camera;
  const orbitX = Math.cos(orbit) * radius;
  const orbitZ = Math.sin(orbit) * radius;
  camera.position.set(
    -7 + (orbitX + 7) * ease,
    4.2 + (58 - 4.2) * ease,
    -150 + (orbitZ + 150) * ease,
  );
  camera.lookAt(0, 9 - 3 * (1 - ease), -150 + 150 * ease);
  menuFocus.x = camera.position.x * 0.3;
  menuFocus.z = camera.position.z * 0.3;
  world.update(dt, menuFocus);
  vehicles.update(dt);
  pedestrians.update(dt, player);
  effects.update(dt);
  effects.updateRain(dt, menuFocus);
}

const menuFocus = { x: 0, z: 0 };

// ---- the loop ----
let accumulator = 0;
let last = performance.now();
let frames = 0;

function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.12, (now - last) / 1000);
  last = now;
  frames += 1;

  if (state.mode === 'menu') {
    menuCamera(dt);
  } else if (state.mode === 'play') {
    accumulator += dt;
    let steps = 0;
    while (accumulator >= STEP && steps < 6) {
      tick(STEP);
      accumulator -= STEP;
      steps += 1;
    }
    if (steps === 6) accumulator = 0;
  } else {
    accumulator = 0;
    // A staged photograph is held exactly as it was left: no camera drift, no re-settling, so two
    // renders of the same scene are identical down to the byte.
  }

  renderer.render(scene, player.camera);
  if (frames === 2) window.__shotReady = true;
}

window.addEventListener('resize', () => {
  renderer.setSize(window.innerWidth, window.innerHeight);
  player.camera.aspect = window.innerWidth / window.innerHeight;
  player.camera.updateProjectionMatrix();
});

// ---- the screenshot path: stage a scene, then hold the frame ----
const api = {
  scene, world, state, audio, hud, effects, input, renderer,
  vehicles, pedestrians, player, police, missions, ctx,
  step: (dt) => tick(dt),
  camera: player.camera,
  startGame,
  toggleCar,
  save,
};

// A handle for the browser console and for the screenshot runs, which read the live scene.
window.__game = api;

if (params.get('selftest') === '1') {
  input.goSimulated();
  hud.showMenu(false);
  hud.setPlaying(true);
  state.mode = 'play';
  runSelfTest(api);
}

if (shotName) {
  input.goSimulated();
  // A still cannot show an animation in motion: freeze the CSS so two renders match to the byte.
  document.body.classList.add('shot');
  hud.showMenu(false);
  hud.setPlaying(true);
  hud.showWasted(false);
  hud.showPause(false);
  state.mode = 'play';
  stageShot(shotName, api);
  state.mode = 'cinema';
  // Nothing moves after a staged scene: draw the shadow map once and then reuse it.
  renderer.shadowMap.autoUpdate = false;
  renderer.shadowMap.needsUpdate = true;
  hud.setMoney(state.money, true);
  hud.setJobs(state.completed.length);
  hud.setWanted(state.wanted);
  hud.setHealth(player.state.health);
  hud.setArmed(!player.state.car);
  hud.setSpeed(player.state.car ? player.state.car.speed * 3.6 : 0, Boolean(player.state.car));
  hud.setHint(player.state.car
    ? 'F leave car · SHIFT handbrake · T rain'
    : 'F enter car · LMB fire · SHIFT sprint · T rain');
  hud.drawMap({
    x: player.state.x,
    z: player.state.z,
    heading: player.state.car ? player.state.car.heading : player.state.yaw,
    cars: vehicles.cars,
    officers: police.officers,
    crew: missions.crew,
    markers: missions.markers,
  });
} else {
  hud.showMenu(true);
  hud.setPlaying(false);
}

requestAnimationFrame(frame);
