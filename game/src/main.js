// main.js — boot, the fixed-step loop, input, the modes (title, play, pause, shot), spawning,
// the save file and the ?shot= path that stages a frame for the screenshot harness.
//
// The game object is passed to every module rather than imported by them, so the modules only
// depend on the shape of this object and never on each other's internals.

const THREE = window.THREE;

import { CITY, CAMERA, RENDER, PLAYER, SAVE_KEY, CRIME_HEAT } from './config.js';
import { clamp, mulberry32 } from './util.js';
import { World } from './world.js';
import { Fleet } from './vehicles.js';
import { Player } from './player.js';
import { Crowd } from './pedestrians.js';
import { Police } from './police.js';
import { Missions } from './missions.js';
import { Activities } from './activities.js';
import { Hud } from './hud.js';
import { Audio } from './audio.js';
import { Effects } from './effects.js';
import { stageShot } from './shots.js';

const params = new URLSearchParams(location.search);
const shotName = params.get('shot');
const isShot = !!shotName;

class Game {
  constructor() {
    this.canvas = document.getElementById('scene');
    this.seed = Number(params.get('seed') ?? 20261120);
    this.rng = mulberry32(this.seed);
    this.time = 0;
    this.money = 1240;
    this.paused = false;
    this.started = false;
    this.mode = 'foot';
    this.frame = 0;
    this.accumulator = 0;
    this.fixedStep = 1 / 60;
    this.nearestCar = null;
    this.lastTime = 0;
    this.input = {
      forward: false, back: false, left: false, right: false,
      run: false, sprint: false, handbrake: false,
    };
    this.config = { crime: CRIME_HEAT };

    this.buildRenderer();
    this.buildScene();
    this.buildSystems();
    this.bindInput();

    if (isShot) this.startShot();
    else this.startPlayable();
  }

  // -------------------------------------------------------------------------------------------
  // Boot
  // -------------------------------------------------------------------------------------------

  buildRenderer() {
    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: true,
      powerPreference: 'high-performance',
      stencil: false,
    });
    this.renderer.setPixelRatio(isShot ? 1 : Math.min(window.devicePixelRatio || 1, 1.5));
    this.renderer.setSize(this.width(), this.height(), false);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = RENDER.exposure;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.setClearColor(0x05070a, 1);
  }

  width() {
    return isShot ? 1280 : window.innerWidth;
  }

  height() {
    return isShot ? 720 : window.innerHeight;
  }

  buildScene() {
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(CAMERA.fov, this.width() / this.height(), CAMERA.near, CAMERA.far);
    this.camera.position.set(0, 2, 6);
    if (isShot) {
      document.documentElement.classList.add('shot-mode');
      this.canvas.style.width = '1280px';
      this.canvas.style.height = '720px';
    }
  }

  buildSystems() {
    this.world = new World(this.scene, this.seed);
    this.world.makeEnvironment(this.renderer);
    this.effects = new Effects(this);
    this.audio = new Audio();
    this.fleet = new Fleet(this);
    this.vehicles = this.fleet.cars;
    this.crowd = new Crowd(this);
    this.hud = new Hud(this);
    this.player = new Player(this);
    this.police = new Police(this);
    this.missions = new Missions(this);
    this.activities = new Activities(this);

    // start on the pavement above the main avenue, facing the city
    this.player.setPosition(-40, 84, Math.PI / 2);
    this.player.cameraYaw = Math.PI / 2;
    this.player.cameraPitch = 0.05;
    this.populate(18, 34);
  }

  /** A first street: traffic, parked cars and people around the player. */
  populate(cars = 16, peds = 34) {
    for (let i = 0; i < cars; i += 1) this.fleet.addTraffic();
    for (let i = 0; i < 14; i += 1) {
      const p = this.world.pavementPoint(this.rng, this.player.pos.x, this.player.pos.z, 90);
      this.fleet.addParked(p.x, p.z, Math.round(this.rng() * 4) * (Math.PI / 2));
    }
    for (let i = 0; i < peds; i += 1) this.crowd.spawn(this.player.pos.x, this.player.pos.z, { radius: 80 });
    this.activities.offerFare();
  }

  // -------------------------------------------------------------------------------------------
  // Modes
  // -------------------------------------------------------------------------------------------

  startPlayable() {
    this.hud.showStart(true);
    this.hud.showPause(false);
    this.load();
    this.loop();
  }

  startShot() {
    // No intro, no pointer lock: stage the frame, render it, and stop.
    this.started = true;
    this.hud.showStart(false);
    this.hud.showPause(false);
    this.state = 'shot';
    const report = stageShot(this, shotName);
    // Dev hooks: nudge the staged camera from the address bar while tuning a frame.
    if (params.has('cam')) {
      const v = params.get('cam').split(',').map(Number);
      this.camera.position.set(v[0], v[1], v[2]);
      this.camera.lookAt(new THREE.Vector3(v[3], v[4], v[5]));
    }
    if (params.has('fov')) {
      this.camera.fov = Number(params.get('fov'));
      this.camera.updateProjectionMatrix();
    }
    if (params.has('pl')) {
      const v = params.get('pl').split(',').map(Number);
      this.player.setPosition(v[0], v[1], v[2]);
    }
    console.log('STAGED', shotName, JSON.stringify(report));
    this.renderFrame();
    console.log('RENDER1 done');
    let frames = 0;
    const settle = () => {
      frames += 1;
      this.renderFrame();
      console.log('SETTLE', frames);
      if (frames < 3) requestAnimationFrame(settle);
      else {
        document.title = `SHOT ${shotName} ok — ${report.cars} cars, ${report.peds} people`;
        window.__shotReady = true;
      }
    };
    requestAnimationFrame(settle);
  }

  beginPlay() {
    if (this.started) return;
    this.started = true;
    this.audio.start();
    this.hud.showStart(false);
    this.canvas.focus();
    this.requestPointerLock();
    this.hud.toast('WELCOME TO NEON CITY');
    this.hud.say([
      { who: 'dessy', colour: '#31e6ff', text: 'New in town? The pier pays cash. The rest pays attention.' },
    ]);
  }

  requestPointerLock() {
    if (isShot) return;
    try {
      this.canvas.requestPointerLock?.();
    } catch (err) {
      // pointer lock can be refused; the game still plays
    }
  }

  setPaused(paused) {
    this.paused = paused;
    this.hud.showPause(paused);
    if (!paused) this.requestPointerLock();
  }

  setMode(mode) {
    this.mode = mode;
  }

  // -------------------------------------------------------------------------------------------
  // Input
  // -------------------------------------------------------------------------------------------

  bindInput() {
    const held = this.input;
    const map = {
      KeyW: 'forward', ArrowUp: 'forward',
      KeyS: 'back', ArrowDown: 'back',
      KeyA: 'left', ArrowLeft: 'left',
      KeyD: 'right', ArrowRight: 'right',
      ShiftLeft: 'sprint', ShiftRight: 'sprint',
      Space: 'handbrake',
    };
    window.addEventListener('keydown', (e) => {
      if (map[e.code]) {
        held[map[e.code]] = true;
        if (e.code === 'Space') e.preventDefault();
      }
      if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') held.run = true;
      if (e.repeat) return;
      switch (e.code) {
        case 'KeyE':
          this.tryEnterCar();
          break;
        case 'KeyF':
          this.player.exitCar();
          break;
        case 'KeyR':
          this.player.reload();
          break;
        case 'KeyM': {
          this.audio.start();
          const muted = this.audio.toggleMute();
          this.hud.toast(muted ? 'MUTED' : 'SOUND ON');
          break;
        }
        case 'Escape':
          if (this.started && !isShot) this.setPaused(!this.paused);
          break;
        default:
          break;
      }
      if (!this.started && (e.code === 'Enter' || e.code === 'Space')) this.beginPlay();
    });
    window.addEventListener('keyup', (e) => {
      if (map[e.code]) held[map[e.code]] = false;
      if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') held.run = false;
    });

    this.canvas.addEventListener('mousedown', (e) => {
      if (!this.started) {
        this.beginPlay();
        return;
      }
      if (isShot || this.paused) return;
      if (e.button === 0) this.player.tryFire();
    });
    window.addEventListener('mousemove', (e) => {
      if (isShot || !this.started || this.paused) return;
      if (document.pointerLockElement !== this.canvas) return;
      this.player.cameraYaw -= e.movementX * CAMERA.mouseSensitivity;
      this.player.cameraPitch = clamp(this.player.cameraPitch + e.movementY * CAMERA.mouseSensitivity, -0.45, 0.8);
    });
    document.addEventListener('pointerlockchange', () => {
      if (!isShot && this.started && document.pointerLockElement !== this.canvas && !this.paused) {
        this.setPaused(true);
      }
    });
    this.canvas.addEventListener('click', () => {
      if (!this.started) this.beginPlay();
      else if (!isShot && document.pointerLockElement !== this.canvas) this.requestPointerLock();
    });
    window.addEventListener('resize', () => {
      if (isShot) return;
      this.renderer.setSize(this.width(), this.height(), false);
      this.camera.aspect = this.width() / this.height();
      this.camera.updateProjectionMatrix();
    });
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this.audio.suspend();
      else this.audio.resume();
    });
  }

  tryEnterCar() {
    if (this.player.inCar) return;
    const near = this.fleet.nearest(this.player.pos, 4.6);
    if (near) {
      this.player.enterCar(near.car);
      this.crowd.scare(this.player.pos.x, this.player.pos.z, 22, 0.6);
    } else {
      this.hud.toast('NO CAR NEARBY');
    }
  }

  // -------------------------------------------------------------------------------------------
  // Simulation
  // -------------------------------------------------------------------------------------------

  /** One fixed step of everything. Shots call this directly, the loop calls it on a timer. */
  stepSim(dt, input) {
    this.time += dt;
    this.frame += 1;

    if (this.player.alive) this.player.update(dt, input);
    else this.player.tick(dt);
    if (this.player.alive) this.player.tick(dt);

    this.fleet.update(dt);
    this.crowd.update(dt);
    this.police.update(dt);
    this.missions.update(dt);
    this.activities.update(dt);
    this.effects.update(dt);
    this.world.update(dt, this.time, this.player.inCar ? this.player.inCar.pos : this.player.pos);

    this.nearestCar = this.player.inCar ? null : this.fleet.nearest(this.player.pos, 5);
    if (this.frame % 30 === 0) this.fleet.keepNear(this.player.pos);
    this.hud.update(dt);
  }

  loop() {
    const tick = () => {
      requestAnimationFrame(tick);
      const now = performance.now();
      if (!this.lastTime) this.lastTime = now;
      let delta = (now - this.lastTime) / 1000;
      this.lastTime = now;
      delta = Math.min(delta, 0.1);
      if (!this.paused && this.started) {
        this.accumulator += delta;
        let steps = 0;
        while (this.accumulator >= this.fixedStep && steps < 4) {
          this.stepSim(this.fixedStep, this.input);
          this.accumulator -= this.fixedStep;
          steps += 1;
        }
        if (steps === 0) this.hud.update(delta);
      }
      this.renderFrame();
    };
    requestAnimationFrame(tick);
  }

  renderFrame() {
    this.renderer.render(this.scene, this.camera);
  }

  // -------------------------------------------------------------------------------------------
  // Hooks the other modules call
  // -------------------------------------------------------------------------------------------

  addMoney(amount) {
    this.money = Math.max(0, this.money + amount);
    this.save();
  }

  toast(text) {
    this.hud.toast(text);
  }

  /** A gunshot from the player: find the first thing the bullet meets. */
  onGunshot(originPos, dir) {
    const origin = new THREE.Vector3(originPos.x, 1.35, originPos.z);
    const shotDir = new THREE.Vector3(dir.x, 0, dir.z).normalize();
    const policeHit = this.police.hitTest(origin, shotDir, 70);
    let pedT = Infinity;
    let ped = null;
    for (const person of this.crowd.people) {
      if (!person.alive) continue;
      const dx = person.pos.x - origin.x;
      const dz = person.pos.z - origin.z;
      const t = dx * shotDir.x + dz * shotDir.z;
      const perp = Math.abs(dx * shotDir.z - dz * shotDir.x);
      if (t > 0 && t < pedT && perp < 1.0) {
        pedT = t;
        ped = person;
      }
    }
    if (policeHit && policeHit.t < pedT) {
      this.police.applyHit(policeHit, 36);
      this.effects.tracer(origin, origin.clone().add(shotDir.clone().multiplyScalar(policeHit.t)));
      return;
    }
    if (ped) {
      this.effects.tracer(origin, origin.clone().add(shotDir.clone().multiplyScalar(pedT)));
      this.crowd.hit(ped, origin.x, origin.z);
      return;
    }
    for (const car of this.fleet.cars) {
      const dx = car.pos.x - origin.x;
      const dz = car.pos.z - origin.z;
      const t = dx * shotDir.x + dz * shotDir.z;
      if (t > 0 && t < 60) {
        const perp = Math.abs(dx * shotDir.z - dz * shotDir.x);
        if (perp < 1.7) {
          car.damage(8);
          this.effects.sparks(car.pos.x, 0.9, car.pos.z, 5);
          this.effects.tracer(origin, new THREE.Vector3(car.pos.x, 0.9, car.pos.z));
          return;
        }
      }
    }
    this.effects.tracer(origin, origin.clone().add(shotDir.clone().multiplyScalar(45)));
  }

  onKill(kind, person) {
    this.missions.noteKill(kind, person);
    if (kind !== 'rival') this.hud.toast(kind === 'officer' ? 'OFFICER DOWN' : 'CIVILIAN DOWN');
  }

  onCarWrecked(car) {
    this.hud.toast('CAR WRECKED');
    this.effects.sparks(car.pos.x, 1, car.pos.z, 22, 0xff7a2a);
    this.audio.impact(1);
  }

  // -------------------------------------------------------------------------------------------
  // Save file
  // -------------------------------------------------------------------------------------------

  save() {
    if (isShot) return;
    try {
      const data = {
        money: Math.round(this.money),
        missions: this.missions.serialize(),
        activities: this.activities.serialize(),
        pos: [this.player.pos.x, this.player.pos.z],
        seed: this.seed,
      };
      localStorage.setItem(SAVE_KEY, JSON.stringify(data));
    } catch (err) {
      // private mode: the game just does not remember
    }
  }

  load() {
    try {
      const raw = localStorage.getItem(SAVE_KEY);
      if (!raw) return;
      const data = JSON.parse(raw);
      if (typeof data.money === 'number') this.money = data.money;
      this.missions.restore(data.missions);
      this.activities.restore(data.activities);
      if (Array.isArray(data.pos)) {
        const [x, z] = data.pos;
        if (Number.isFinite(x) && Number.isFinite(z)) this.player.setPosition(x, z, Math.PI / 2);
      }
    } catch (err) {
      // a corrupt save is not worth a modal
    }
  }
}

// ---- boot -------------------------------------------------------------------------------------

const game = new Game();
window.__game = game;
window.__shotReady = false;

// A shot that never renders should still tell the harness what went wrong.
setTimeout(() => {
  if (isShot && !window.__shotReady) {
    document.title = `SHOT ${shotName} TIMEOUT — ${(window.__bootErrors ?? []).join(' | ')}`;
  }
}, 25000);
