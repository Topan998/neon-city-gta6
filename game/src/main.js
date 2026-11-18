// main.js — boot, the renderer and the world around it, the loop, input, modes and the `?shot=` path.
//
// Everything hangs off one Game object: the renderer and sky, the world, traffic, the crowd, the
// player and their car, police, jobs, the HUD, audio and effects. The loop runs a fixed 1/60 s step
// with an accumulator so physics and animation are stable at any frame rate, and a shot renders the
// same bytes twice because nothing in that path reads the clock.

import THREE from './three-shim.js';
import { SEED, CITY, RENDER, TOD, PALETTE, SHOTS, PHYSICS, CAMERA } from './config.js';
import { RNG, clamp, lerp, damp, angleDamp, TAU, DEG, makeCanvas } from './util.js';
import { World } from './world.js';
import { Traffic, createPlayerCar } from './vehicles.js';
import { Player, GameCamera } from './player.js';
import { Pedestrians } from './pedestrians.js';
import { Police } from './police.js';
import { Missions } from './missions.js';
import { Hud } from './hud.js';
import { Audio } from './audio.js';
import { Effects } from './effects.js';
import { stageShot } from './shots.js';

const FIXED = 1 / 60;
const SAVE_KEY = 'neon-city-saltwater-vice';

const SKY_VERT = `
varying vec3 vWorld;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorld = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const SKY_FRAG = `
uniform vec3 uTop;
uniform vec3 uHorizon;
uniform vec3 uGround;
uniform vec3 uSunColor;
uniform vec3 uSunDir;
uniform float uHaze;
varying vec3 vWorld;

void main() {
  vec3 dir = normalize(vWorld - cameraPosition);
  float h = dir.y;
  vec3 col = mix(uGround, uHorizon, smoothstep(-0.18, 0.04, h));
  col = mix(col, uTop, smoothstep(0.0, 0.62, h));

  float sun = max(dot(dir, normalize(uSunDir)), 0.0);
  col += uSunColor * pow(sun, 700.0) * 2.6;
  col += uSunColor * pow(sun, 18.0) * 0.35 * uHaze;
  col += uHorizon * (1.0 - smoothstep(0.0, 0.12, abs(h))) * 0.25 * uHaze;

  // A little banding noise keeps the gradient from looking like a flat ramp.
  float n = fract(sin(dot(dir.xy, vec2(12.9898, 78.233))) * 43758.5453);
  col += (n - 0.5) * 0.006;

  gl_FragColor = vec4(col, 1.0);
}
`;

export class Game {
  constructor() {
    this.canvas = document.getElementById('scene');
    this.clockName = 'golden';
    this.time = 0;
    this.accumulator = 0;
    this.lastTime = 0;
    this.started = false;
    this.paused = false;
    this.frozen = false;
    this.money = 1500;
    this.mouseYaw = 0;
    this.mousePitch = -0.06;
    this.cameraYaw = 0;
    this.orbitBias = 0;
    this.firing = false;
    this.fireCooldown = 0;
    this.threat = { x: 0, z: 0, radius: 0 };
    this.saveTimer = 0;
    this.shotName = null;
    this.keys = new Set();
    this.tick = this.tick.bind(this);
    this.onResize = this.onResize.bind(this);

    this.setupRenderer();
    this.setupScene();
    this.setupSystems();
    this.bindInput();

    const params = new URLSearchParams(window.location.search);
    const shot = params.get('shot');
    if (shot && SHOTS[shot]) {
      this.shotName = shot;
      this.beginShot(shot);
    } else {
      this.loadProgress();
      this.hud.showStart();
      this.cameraRig.update(1, this.player, true);
      this.render();
    }

    requestAnimationFrame(this.tick);
    window.addEventListener('resize', this.onResize);
    window.__game = this;
  }

  // ------------------------------------------------------------------ setup

  setupRenderer() {
    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: true,
      powerPreference: 'high-performance',
      stencil: false,
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, RENDER.maxPixelRatio));
    this.renderer.setSize(window.innerWidth, window.innerHeight, false);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = RENDER.exposure;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.info.autoReset = true;
  }

  setupScene() {
    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.FogExp2(0xe6b994, 0.0021);

    this.camera = new THREE.PerspectiveCamera(
      RENDER.fov,
      window.innerWidth / Math.max(1, window.innerHeight),
      RENDER.near,
      RENDER.far,
    );
    this.camera.position.set(0, 4, 8);

    // Sky dome: one shader, a vertical gradient and a sun disc with a haze halo.
    this.skyUniforms = {
      uTop: { value: new THREE.Color(0x2f5f92) },
      uHorizon: { value: new THREE.Color(0xf3c489) },
      uGround: { value: new THREE.Color(0x8d7a68) },
      uSunColor: { value: new THREE.Color(0xffd9a0) },
      uSunDir: { value: new THREE.Vector3(0.3, 0.2, -0.9) },
      uHaze: { value: 1 },
    };
    const skyMat = new THREE.ShaderMaterial({
      uniforms: this.skyUniforms,
      vertexShader: SKY_VERT,
      fragmentShader: SKY_FRAG,
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
    });
    const skyGeo = new THREE.SphereGeometry(1200, 32, 20);
    this.sky = new THREE.Mesh(skyGeo, skyMat);
    this.sky.frustumCulled = false;
    this.sky.renderOrder = -10;
    this.scene.add(this.sky);

    // Sun with a tight, soft shadow frustum that follows the player.
    this.sun = new THREE.DirectionalLight(0xfff4dc, 3);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(RENDER.shadowMap, RENDER.shadowMap);
    const d = RENDER.shadowExtent;
    this.sun.shadow.camera.left = -d / 2;
    this.sun.shadow.camera.right = d / 2;
    this.sun.shadow.camera.top = d / 2;
    this.sun.shadow.camera.bottom = -d / 2;
    this.sun.shadow.camera.near = 1;
    this.sun.shadow.camera.far = 420;
    this.sun.shadow.bias = -0.0005;
    this.sun.shadow.normalBias = 0.02;
    this.sun.shadow.camera.updateProjectionMatrix();
    this.scene.add(this.sun);
    this.scene.add(this.sun.target);

    this.hemi = new THREE.HemisphereLight(0xbcd4ea, 0x6d6660, 1.1);
    this.scene.add(this.hemi);

    this.sunDir = new THREE.Vector3(0.3, 0.4, -0.85).normalize();
    this.env = null;
  }

  setupSystems() {
    const seed = SEED;
    this.rng = new RNG(seed);

    this.world = new World(this.scene, new RNG(seed ^ 0x9e3779b9));
    this.traffic = new Traffic(this.scene, this.world, new RNG(seed + 71), PHYSICS.traffic.count);
    this.peds = new Pedestrians(this.scene, this.world, new RNG(seed + 131), PHYSICS.peds.count);

    this.player = new Player(this.scene, this.world, new RNG(seed + 17));
    const start = this.world.nearestSidewalkPoint(8, 70);
    this.player.place(start.x, start.z, -Math.PI / 2);
    this.mouseYaw = -Math.PI / 2;
    this.cameraYaw = -Math.PI / 2;

    this.playerCar = createPlayerCar(this.scene, this.world);
    this.playerCar.place(3.05, 74, -Math.PI / 2);
    this.driveCar = this.playerCar;

    this.cameraRig = new GameCamera(this.camera);
    this.cameraRig.configure('foot');
    this.cameraRig.yaw = this.cameraYaw;
    this.cameraRig.pitch = this.mousePitch;

    this.effects = new Effects(this.scene, this.camera, new RNG(seed + 211));
    this.audio = new Audio();
    this.hud = new Hud(document.body);
    this.police = new Police(this.scene, this.world, new RNG(seed + 307), this.audio, this.effects);
    this.missions = new Missions(this.scene, this.world, new RNG(seed + 401), this.effects, this.audio, this.police);

    this.player.onFootstep = (speed) => this.audio.footstep(speed);
    this.police.onStars = (stars) => {
      if (stars > 0) this.hud.message(`WANTED LEVEL ${stars}`, stars >= 4 ? 'bad' : 'job');
      else this.hud.message('YOU LOST THEM', 'good');
    };
    this.missions.onBanner = (text, tone) => this.hud.message(text, tone);
    this.missions.onReward = (amount) => {
      this.money += amount;
      this.hud.setMoney(this.money);
      this.saveProgress();
    };

    this.setTimeOfDay('golden');
    this.hud.setMoney(this.money);
  }

  setTimeOfDay(name) {
    const preset = TOD[name];
    const sky = PALETTE.sky[preset.sky];
    const sun = PALETTE.sun[preset.sky];
    const amb = PALETTE.ambient[preset.sky];
    this.clockName = name;

    this.skyUniforms.uTop.value.setHex(sky.top);
    this.skyUniforms.uHorizon.value.setHex(sky.horizon);
    this.skyUniforms.uGround.value.setHex(sky.ground);
    this.skyUniforms.uSunColor.value.setHex(sky.sun);
    this.skyUniforms.uHaze.value = name === 'night' ? 0.35 : name === 'dusk' ? 0.9 : 1.0;

    const az = sun.azimuth * DEG;
    const el = sun.elevation * DEG;
    this.sunDir.set(
      Math.cos(el) * Math.sin(az),
      Math.sin(el),
      Math.cos(el) * Math.cos(az),
    ).normalize();
    this.skyUniforms.uSunDir.value.copy(this.sunDir);

    this.sun.color.setHex(sun.color);
    this.sun.intensity = sun.intensity;
    this.hemi.color.setHex(amb.sky);
    this.hemi.groundColor.setHex(amb.ground);
    this.hemi.intensity = amb.intensity;

    this.scene.fog.color.setHex(preset.fog);
    this.scene.fog.density = preset.fogDensity;
    this.renderer.toneMappingExposure = preset.exposure;

    this.world.setTimeOfDay(name, preset);
    if (this.playerCar) this.playerCar.setLighting(preset);
    for (const car of this.police ? this.police.cruisers : []) car.setLighting && car.setLighting(preset);
    this.preset = preset;

    this.buildEnvironment(preset.sky, sun);
  }

  // A tiny equirectangular gradient feeds scene.environment for the wet-road and paint reflections.
  buildEnvironment(skyKey, sun) {
    const { canvas, ctx } = makeCanvas(256, 128);
    const sky = PALETTE.sky[skyKey];
    const top = new THREE.Color(sky.top);
    const horizon = new THREE.Color(sky.horizon);
    const ground = new THREE.Color(sky.ground);
    const gradient = ctx.createLinearGradient(0, 0, 0, 128);
    gradient.addColorStop(0, `#${top.getHexString()}`);
    gradient.addColorStop(0.48, `#${horizon.getHexString()}`);
    gradient.addColorStop(0.52, `#${horizon.getHexString()}`);
    gradient.addColorStop(1, `#${ground.getHexString()}`);
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 256, 128);

    // Sun glow on the horizon at its azimuth.
    const u = ((sun.azimuth + 180) % 360) / 360;
    const g = ctx.createRadialGradient(u * 256, 62, 0, u * 256, 62, 46);
    const sunCol = new THREE.Color(PALETTE.sky[skyKey].sun).getStyle();
    g.addColorStop(0, sunCol);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.globalAlpha = 0.85;
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 256, 128);
    ctx.globalAlpha = 1;

    const tex = new THREE.CanvasTexture(canvas);
    tex.mapping = THREE.EquirectangularReflectionMapping;
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.needsUpdate = true;
    if (this.env) this.env.dispose();
    this.env = tex;
    this.scene.environment = tex;
  }

  // ------------------------------------------------------------------ input

  bindInput() {
    const canvas = this.canvas;

    window.addEventListener('keydown', (e) => {
      if (['Space', 'Tab', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
      this.keys.add(e.code);
      if (e.code === 'Escape') {
        if (this.started) this.setPaused(!this.paused);
      }
      if (e.code === 'Enter' && !this.started) this.begin();
      if (e.code === 'KeyM') {
        this.muted = !this.muted;
        this.audio.setMuted(this.muted);
        this.hud.message(this.muted ? 'AUDIO MUTED' : 'AUDIO ON');
      }
      if (e.code === 'KeyR' && this.started && !this.paused) {
        if (this.player.inCar) this.player.reload();
      }
      if (e.code === 'KeyE' && this.started && !this.paused && !this.player.inCar) this.enterNearestCar();
      if (e.code === 'KeyF' && this.started && !this.paused && this.player.inCar) this.exitCar();
    });

    window.addEventListener('keyup', (e) => this.keys.delete(e.code));

    canvas.addEventListener('mousedown', (e) => {
      if (!this.started) {
        this.begin();
        return;
      }
      if (e.button === 0) this.firing = true;
      if (e.button === 2) this.aiming = true;
      if (document.pointerLockElement !== canvas) canvas.requestPointerLock?.();
    });
    window.addEventListener('mouseup', (e) => {
      if (e.button === 0) this.firing = false;
      if (e.button === 2) this.aiming = false;
    });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());

    document.addEventListener('mousemove', (e) => {
      if (document.pointerLockElement !== canvas) return;
      const dx = e.movementX || 0;
      const dy = e.movementY || 0;
      this.mouseYaw -= dx * 0.0023;
      this.mousePitch = clamp(this.mousePitch - dy * 0.0018, -0.55, 0.42);
      this.orbitBias = clamp(this.orbitBias - dx * 0.0018, -1.1, 1.1);
    });

    document.addEventListener('pointerlockchange', () => {
      if (document.pointerLockElement === canvas) {
        if (this.paused) this.setPaused(false);
      }
    });

    // Start screen click anywhere.
    this.hud.startScreen.addEventListener('click', () => this.begin());
  }

  begin() {
    if (this.started) return;
    this.started = true;
    this.hud.hideStart();
    this.audio.ensure();
    this.audio.resume();
    this.audio.startEngine();
    this.audio.setCityMood(0);
    this.canvas.requestPointerLock?.();
    this.hud.message('FIND THE MARKER — PRESS E TO TAKE A CAR', 'job');
  }

  setPaused(paused) {
    this.paused = paused;
    this.hud.setPaused(paused);
    if (paused && document.pointerLockElement) document.exitPointerLock();
    if (!paused) this.canvas.requestPointerLock?.();
    if (this.audio.ready) this.audio.setMuted(paused ? true : false);
  }

  buildControls() {
    const k = this.keys;
    const fwd = (k.has('KeyW') || k.has('ArrowUp') ? 1 : 0) - (k.has('KeyS') || k.has('ArrowDown') ? 1 : 0);
    const strafe = (k.has('KeyD') || k.has('ArrowRight') ? 1 : 0) - (k.has('KeyA') || k.has('ArrowLeft') ? 1 : 0);
    const run = k.has('ShiftLeft') || k.has('ShiftRight');
    const inCar = !!this.player.inCar;
    if (inCar) {
      return {
        fwd: 0,
        strafe: 0,
        run: false,
        aim: false,
        firing: false,
        throttle: Math.max(0, fwd) + (this.keys.has('KeyW') ? 0 : 0),
        brake: Math.max(0, -fwd),
        steer: -strafe,
        handbrake: run || k.has('Space'),
      };
    }
    return {
      fwd,
      strafe,
      run,
      aim: this.firing || !!this.aiming,
      firing: this.firing,
      throttle: 0,
      brake: 0,
      steer: 0,
      handbrake: false,
    };
  }

  enterNearestCar() {
    let best = null;
    let bestD = 5.2;
    const candidates = this.traffic.cars.slice();
    for (const car of candidates) {
      if (!car.root.visible) continue;
      const d = Math.hypot(car.x - this.player.x, car.z - this.player.z);
      if (d < bestD) {
        bestD = d;
        best = car;
      }
    }
    if (!best) {
      const d = Math.hypot(this.playerCar.x - this.player.x, this.playerCar.z - this.player.z);
      if (d < bestD) best = this.playerCar;
    }
    if (!best) {
      this.hud.message('NO CAR CLOSE ENOUGH');
      return;
    }

    if (best !== this.playerCar) {
      // Hijack: take the traffic car out of the lane brain and let the player steer it.
      best.ai = null;
      const idx = this.traffic.cars.indexOf(best);
      if (idx >= 0) this.traffic.cars.splice(idx, 1);
      this.driveCar = best;
      this.police.crime(0.8);
    } else {
      this.driveCar = this.playerCar;
    }
    this.player.enterCar(best);
    this.cameraRig.configure('car');
    this.audio.startEngine();
    this.hud.setHint('F · EXIT   SPACE · HANDBRAKE   SHIFT · BOOST');
  }

  exitCar() {
    if (!this.player.inCar) return;
    this.player.exitCar();
    this.cameraRig.configure('foot');
    this.hud.setHint('E · ENTER CAR   LEFT CLICK · FIRE   R · RELOAD');
  }

  // ---------------------------------------------------------------- shots

  beginShot(name) {
    this.started = true;
    this.paused = false;
    this.hud.hideStart();
    // A fixed 1280x720 viewport, independent of the window the renderer happens to get.
    document.documentElement.classList.add('shot-mode');
    this.renderer.setSize(1280, 720, false);
    this.camera.aspect = 1280 / 720;
    this.camera.updateProjectionMatrix();
    const ok = stageShot(this, name);
    if (!ok) {
      this.hud.showStart();
      this.started = false;
    }
  }

  // ------------------------------------------------------------- simulation

  simulate(dt, controls) {
    this.time += dt;
    const world = this.world;
    const player = this.player;
    const car = player.inCar;

    world.update(dt, this.time);

    if (car) {
      car.setInput(controls.throttle, controls.brake, controls.steer, controls.handbrake);
      car.step(dt);
      car.updateVisual(dt);
      this.effects.tyreSmoke(car, dt);
      player.x = car.x;
      player.z = car.z;
      player.y = 0;
      player.yaw = car.yaw;
      this.cameraYaw = angleDamp(this.cameraYaw, car.yaw + this.orbitBias, 5.5, dt);
      this.orbitBias = damp(this.orbitBias, 0, 0.8, dt);
      this.audio.setEngine(clamp(Math.abs(car.speed) / PHYSICS.car.topSpeed, 0, 1), controls.throttle);
      this.player.phase = 0;
    } else {
      player.cameraYaw = this.cameraYaw;
      player.update(dt, controls, this.effects);
      this.audio.setEngine(0, 0);
    }

    this.tryFire(dt, controls);

    const body = car || player;
    this.police.update(dt, player, this.driveCar, this.traffic);
    this.traffic.update(dt, body, this.police.cruisers.filter((c) => c.active));
    this.traffic.resolve([body, ...this.police.cruisers.filter((c) => c.active)]);
    this.peds.update(dt, car, player, this.threat);
    this.missions.update(dt, player, this.driveCar, this.threat);

    // Threat decays after gunfire.
    if (this.threat.radius > 0) this.threat.radius = Math.max(0, this.threat.radius - dt * 6);

    this.effects.update(dt);

    // Camera.
    this.cameraRig.yaw = this.cameraYaw;
    this.cameraRig.pitch = this.mousePitch;
    if (this.effects.shake > 0) this.cameraRig.addShake(this.effects.shake * 0.3);
    this.cameraRig.update(dt, car || player);

    // Player death and respawn.
    if (!player.alive) {
      player.respawnTimer -= dt;
      if (player.respawnTimer <= 0) {
        player.respawn();
        this.police.clear();
        this.money = Math.max(0, this.money - 150);
        this.hud.setMoney(this.money);
        this.hud.message('WASTED — 150 DOLLARS IN HOSPITAL BILLS', 'bad');
      }
    }

    // Time of day drifts over a run: golden hour, dusk, night.
    if (this.time > 240 && this.clockName !== 'night') this.setTimeOfDay('night');
    else if (this.time > 100 && this.time <= 240 && this.clockName === 'golden') this.setTimeOfDay('dusk');

    this.updateHud(dt);
    this.audio.setCityMood(this.police.stars);

    this.saveTimer += dt;
    if (this.saveTimer > 12) {
      this.saveTimer = 0;
      this.saveProgress();
    }

  }

  tryFire(dt, controls) {
    if (this.player.inCar) {
      this.fireCooldown = Math.max(0, this.fireCooldown - dt);
      return;
    }
    this.fireCooldown = Math.max(0, this.fireCooldown - dt);
    if (!controls.firing || this.fireCooldown > 0 || !this.player.alive) return;
    this.fireCooldown = 0.145;

    if (!this.player.fire()) {
      this.audio.click();
      return;
    }

    this.player.aim = 1;
    const yaw = this.cameraYaw;
    const fx = Math.cos(yaw);
    const fz = -Math.sin(yaw);
    const muzzle = this.player.muzzle();
    this.effects.muzzle(muzzle.x, muzzle.y, muzzle.z, fx, fz);
    this.effects.addShake(0.22);
    this.audio.gunshot(0.95);
    this.police.crime(0.55, this.player.x, this.player.z);
    this.peds.alarm(this.player.x, this.player.z, 32);
    this.threat.x = this.player.x;
    this.threat.z = this.player.z;
    this.threat.radius = 26;

    this.missions.onShot(this.player.x, this.player.z, fx, fz, () => {
      this.hud.message('RIVAL DOWN', 'good');
    });
  }

  updateHud(dt) {
    const player = this.player;
    const car = player.inCar;
    const state = {
      money: this.money,
      stars: this.police.stars,
      rising: this.police.rising,
      health: player.health,
      maxHealth: player.maxHealth,
      mode: car ? 'car' : 'foot',
      speedKmh: car ? car.speedKmh() : 0,
      clip: player.clip,
      ammo: player.ammo,
      jobIndex: this.missions.active ? this.missions.active.index : this.missions.index,
      jobsDone: this.missions.completed.size,
      statusLine: this.missions.statusLine(),
      timeLeft: this.missions.active ? this.missions.timeLeft : 0,
      marker: {
        x: this.missions.marker.x,
        z: this.missions.marker.z,
        visible: this.missions.markerGroup.visible,
        label: 'OBJECTIVE',
      },
      player: { x: car ? car.x : player.x, z: car ? car.z : player.z, yaw: car ? car.yaw : player.yaw },
      traffic: this.traffic.cars.filter((c) => c.root.visible).slice(0, 18),
      policeCars: this.police.cruisers.filter((c) => c.active),
      camera: this.camera,
      cameraYaw: this.cameraYaw,
    };
    this.hud.update(dt, state);
  }

  // --------------------------------------------------------------- progress

  saveProgress() {
    if (this.shotName) return;
    try {
      const data = {
        money: this.money,
        jobs: Array.from(this.missions.completed),
        x: this.player.x,
        z: this.player.z,
        health: this.player.health,
      };
      localStorage.setItem(SAVE_KEY, JSON.stringify(data));
    } catch (err) {
      /* storage can be disabled; the game still runs */
    }
  }

  loadProgress() {
    try {
      const raw = localStorage.getItem(SAVE_KEY);
      if (!raw) return;
      const data = JSON.parse(raw);
      if (typeof data.money === 'number') this.money = clamp(data.money, 0, 9e9);
      if (Array.isArray(data.jobs)) {
        this.missions.completed = new Set(data.jobs);
        this.missions.index = Math.min(data.jobs.length, 3);
        if (this.missions.index < 3) this.missions.setGate(this.missions.index);
        else {
          this.missions.markerGroup.visible = false;
          this.missions.hideMarker();
        }
      }
      if (typeof data.x === 'number' && typeof data.z === 'number') {
        const spot = this.world.nearestSidewalkPoint(data.x, data.z);
        this.player.place(spot.x, spot.z, this.player.yaw);
      }
      this.hud.setMoney(this.money);
    } catch (err) {
      /* a corrupt save is the same as no save */
    }
  }

  // ------------------------------------------------------------------ loop

  onResize() {
    if (this.shotName) return;
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.camera.aspect = w / Math.max(1, h);
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h, false);
  }

  tick(nowMs) {
    requestAnimationFrame(this.tick);
    const now = nowMs / 1000;
    if (!this.lastTime) this.lastTime = now;
    let delta = now - this.lastTime;
    this.lastTime = now;
    if (!Number.isFinite(delta)) delta = 0;
    delta = Math.min(0.1, Math.max(0, delta));

    if (!this.frozen) {
      if (this.started && !this.paused) {
        this.accumulator += delta;
        let steps = 0;
        while (this.accumulator >= FIXED && steps < 5) {
          this.simulate(FIXED, this.buildControls());
          this.accumulator -= FIXED;
          steps++;
        }
      }
      this.render();
    } else {
      this.render();
    }
  }

  render() {
    // Keep the sky centred on the camera and the shadow frustum on the player.
    const target = this.player.inCar ? this.player.inCar : this.player;
    this.sky.position.set(this.camera.position.x, 0, this.camera.position.z);
    const sx = target.x;
    const sz = target.z;
    this.sun.target.position.set(sx, 0, sz);
    this.sun.position.set(
      sx + this.sunDir.x * 170,
      Math.max(12, this.sunDir.y * 170),
      sz + this.sunDir.z * 170,
    );
    this.sun.target.updateMatrixWorld();
    this.renderer.render(this.scene, this.camera);
  }
}

function boot() {
  try {
    const game = new Game();
    game.lastTime = 0;
    return game;
  } catch (err) {
    console.error('Neon City failed to boot', err);
    const el = document.getElementById('boot-error');
    if (el) {
      el.style.display = 'block';
      el.textContent = `Neon City failed to boot: ${err && err.message ? err.message : err}`;
    }
    return null;
  }
}

const game = boot();
export default game;
