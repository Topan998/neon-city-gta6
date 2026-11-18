// player.js — the character rig, its animation, and the third-person camera.
//
// The rig is a plain hierarchy of boxes: hips, torso, head, two-segment arms and legs, shoes. A
// phase clock drives a walk/run cycle with knee lift, counter-swinging arms, a lean into speed and a
// small vertical bob; an aim pose overrides the arms when the trigger is held. The camera trails over
// the shoulder, damped, with a little bob and a punch of shake from effects.js.

import THREE from './three-shim.js';
import { CAMERA, CITY, PHYSICS, PALETTE } from './config.js';
import { TAU, clamp, lerp, damp, angleDamp, angleDiff, smoothstep, RNG } from './util.js';

const P = PHYSICS.player;

function box(w, h, d, mat) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

export class Player {
  constructor(scene, world, rng) {
    this.scene = scene;
    this.world = world;
    this.rng = rng || new RNG(7);

    this.x = 0;
    this.z = 0;
    this.y = CITY.curb;
    this.yaw = 0;
    this.speed = 0;
    this.health = P.health;
    this.maxHealth = P.health;
    this.alive = true;
    this.inCar = null;
    this.respawnTimer = 0;
    this.phase = 0;
    this.aim = 0;
    this.recoil = 0;
    this.cameraYaw = 0;
    this.cameraPitch = -0.06;
    this.stepAccumulator = 0;
    this.onFootstep = null;
    this.ammo = 42;
    this.clip = 12;

    this.build();
  }

  build() {
    const skinMat = new THREE.MeshStandardMaterial({ color: PALETTE.skin[1], roughness: 0.68, metalness: 0.02 });
    const jacketMat = new THREE.MeshStandardMaterial({ color: 0x232a33, roughness: 0.62, metalness: 0.08 });
    const jeansMat = new THREE.MeshStandardMaterial({ color: 0x2c3747, roughness: 0.82, metalness: 0.03 });
    const shoeMat = new THREE.MeshStandardMaterial({ color: 0x14161a, roughness: 0.55, metalness: 0.1 });
    const hairMat = new THREE.MeshStandardMaterial({ color: 0x1a1512, roughness: 0.85, metalness: 0.02 });
    this.mats = { skin: skinMat, jacket: jacketMat, jeans: jeansMat, shoe: shoeMat, hair: hairMat };

    const root = new THREE.Group();
    root.name = 'player';
    this.root = root;
    this.scene.add(root);

    // The body group carries the bob so the rig's pivots stay on clean numbers.
    const body = new THREE.Group();
    root.add(body);
    this.body = body;

    this.hips = new THREE.Group();
    this.hips.position.y = 0.94;
    body.add(this.hips);

    const pelvis = box(0.44, 0.24, 0.26, jeansMat);
    pelvis.position.y = 0.02;
    this.hips.add(pelvis);

    // Torso, tapering to the shoulders.
    const torso = box(0.5, 0.56, 0.3, jacketMat);
    torso.position.y = 0.42;
    this.hips.add(torso);
    const chest = box(0.54, 0.2, 0.32, jacketMat);
    chest.position.y = 0.68;
    this.hips.add(chest);

    // Neck and head.
    const neck = box(0.13, 0.1, 0.13, skinMat);
    neck.position.y = 0.8;
    this.hips.add(neck);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.145, 14, 12), skinMat);
    head.scale.set(0.94, 1.05, 0.98);
    head.position.y = 0.94;
    head.castShadow = true;
    this.hips.add(head);
    this.head = head;

    const hair = new THREE.Mesh(new THREE.SphereGeometry(0.152, 12, 10, 0, TAU, 0, 1.5), hairMat);
    hair.position.y = 0.955;
    hair.scale.set(1, 1.02, 1.02);
    this.hips.add(hair);

    // Arms: shoulder pivot -> upper arm -> elbow -> forearm -> hand.
    this.arms = [];
    for (const side of [-1, 1]) {
      const shoulder = new THREE.Group();
      shoulder.position.set(side * 0.31, 0.68, 0);
      this.hips.add(shoulder);
      const upper = box(0.12, 0.3, 0.13, jacketMat);
      upper.position.y = -0.15;
      shoulder.add(upper);
      const elbow = new THREE.Group();
      elbow.position.y = -0.3;
      shoulder.add(elbow);
      const fore = box(0.105, 0.28, 0.115, jacketMat);
      fore.position.y = -0.14;
      elbow.add(fore);
      const hand = box(0.1, 0.11, 0.1, skinMat);
      hand.position.y = -0.3;
      elbow.add(hand);
      this.arms.push({ side, shoulder, elbow });
    }

    // Legs: hip pivot -> thigh -> knee -> shin -> shoe.
    this.legs = [];
    for (const side of [-1, 1]) {
      const hip = new THREE.Group();
      hip.position.set(side * 0.13, -0.02, 0);
      this.hips.add(hip);
      const thigh = box(0.17, 0.42, 0.18, jeansMat);
      thigh.position.y = -0.21;
      hip.add(thigh);
      const knee = new THREE.Group();
      knee.position.y = -0.42;
      hip.add(knee);
      const shin = box(0.15, 0.4, 0.16, jeansMat);
      shin.position.y = -0.2;
      knee.add(shin);
      const shoe = box(0.17, 0.1, 0.29, shoeMat);
      shoe.position.set(0, -0.42, 0.05);
      knee.add(shoe);
      this.legs.push({ side, hip, knee });
    }

    // A small petrol-blue jacket detail so the back reads at a distance.
    const stripe = box(0.52, 0.06, 0.31, new THREE.MeshStandardMaterial({ color: 0x7a2f3a, roughness: 0.6 }));
    stripe.position.y = 0.62;
    this.hips.add(stripe);

    // Muzzle offset in front of the right hand, used by effects and the shot code.
    this.gun = new THREE.Group();
    const gunBody = box(0.06, 0.09, 0.26, new THREE.MeshStandardMaterial({ color: 0x181a1d, metalness: 0.7, roughness: 0.35 }));
    gunBody.position.set(0, 0, 0.1);
    this.gun.add(gunBody);
    this.gun.position.set(0.16, 0.62, 0.22);
    this.gun.visible = false;
    this.hips.add(this.gun);
  }

  place(x, z, yaw = 0) {
    this.x = x;
    this.z = z;
    this.y = this.world.groundHeight(x, z);
    this.yaw = yaw;
    this.cameraYaw = yaw;
    this.sync();
  }

  sync() {
    this.root.position.set(this.x, this.y, this.z);
    this.root.rotation.y = this.yaw;
  }

  get forwardX() {
    return Math.cos(this.yaw);
  }
  get forwardZ() {
    return -Math.sin(this.yaw);
  }

  // Input: {fwd, strafe, run, aim, fire} in camera space.
  update(dt, input, effects) {
    if (this.inCar) {
      this.root.visible = false;
      return;
    }
    this.root.visible = true;

    const camYaw = this.cameraYaw;
    const cfx = Math.cos(camYaw);
    const cfz = -Math.sin(camYaw);
    const crx = Math.sin(camYaw);
    const crz = Math.cos(camYaw);

    let mx = cfx * input.fwd + crx * input.strafe;
    let mz = cfz * input.fwd + crz * input.strafe;
    const mag = Math.hypot(mx, mz);
    if (mag > 1e-3) {
      mx /= mag;
      mz /= mag;
    }
    const wishSpeed = (input.run ? P.run : P.walk) * Math.min(1, mag);
    const moving = mag > 0.05;

    if (moving) {
      const targetYaw = Math.atan2(-mz, mx);
      this.yaw = angleDamp(this.yaw, targetYaw, 11, dt);
    }

    const accel = moving ? P.accel : P.accel * 1.8;
    this.speed = damp(this.speed, wishSpeed, accel, dt);

    if (this.speed > 0.01) {
      this.x += Math.cos(this.yaw) * this.speed * dt;
      this.z += -Math.sin(this.yaw) * this.speed * dt;
    }

    // Keep the walker out of the buildings and inside the city.
    const push = this.world.buildingPush(this.x, this.z, P.radius);
    if (push) {
      this.x += push.x;
      this.z += push.z;
      this.speed *= 0.5;
    }
    const lim = CITY.half - 6;
    this.x = clamp(this.x, -lim, lim);
    this.z = clamp(this.z, -lim, lim);

    // Ground height: kerbs are a step, not a wall.
    const gy = this.world.groundHeight(this.x, this.z);
    this.y = damp(this.y, gy, 14, dt);

    // Animation clock.
    const stride = input.run ? 2.05 : 1.55;
    this.phase += (this.speed / stride) * TAU * dt;
    this.aim = damp(this.aim, input.aim ? 1 : 0, 12, dt);
    this.recoil = Math.max(0, this.recoil - dt * 5.5);

    this.animate(dt, input);

    this.sync();

    // Footsteps, roughly twice a stride.
    this.stepAccumulator += this.speed * dt;
    if (this.stepAccumulator > (input.run ? 1.35 : 0.95)) {
      this.stepAccumulator = 0;
      if (this.onFootstep) this.onFootstep(this.speed);
      if (effects) effects.dust(this.x, this.y + 0.04, this.z, 0.4);
    }
  }

  animate(dt, input) {
    const speedN = clamp(this.speed / P.run, 0, 1.2);
    const swing = lerp(0.52, 0.92, clamp(this.speed / P.run, 0, 1));
    const bob = Math.abs(Math.sin(this.phase)) * (0.02 + speedN * 0.05);
    const lean = speedN * 0.16;

    this.body.position.y = bob;
    this.hips.rotation.x = lean * 0.55;
    this.hips.rotation.z = Math.sin(this.phase) * 0.02 * speedN;

    for (const leg of this.legs) {
      const p = this.phase + (leg.side > 0 ? 0 : Math.PI);
      const s = Math.sin(p);
      const c = Math.cos(p);
      leg.hip.rotation.x = s * swing;
      // Knees bend only on the way through, never backwards.
      const bend = Math.max(0, -c) * (0.55 + speedN * 0.75);
      leg.knee.rotation.x = -bend - 0.04;
      leg.hip.rotation.z = leg.side * 0.03;
    }

    for (const arm of this.arms) {
      const p = this.phase + (arm.side > 0 ? Math.PI : 0);
      const s = Math.sin(p);
      const armSwing = s * swing * 0.75;
      const aimBlend = this.aim;
      // Aim: both arms up and forward, elbows bent; the right one carries the gun.
      const aimShoulder = arm.side > 0 ? -1.25 : -1.05;
      const aimElbow = arm.side > 0 ? -0.25 : -0.55;
      arm.shoulder.rotation.x = lerp(armSwing, aimShoulder, aimBlend);
      arm.shoulder.rotation.y = lerp(0, arm.side > 0 ? -0.22 : 0.45, aimBlend);
      arm.elbow.rotation.x = lerp(-0.22 - Math.max(0, s) * 0.3, aimElbow, aimBlend);
      arm.shoulder.rotation.z = arm.side * (0.06 + speedN * 0.05);
    }

    // Recoil kicks the upper body back for a few frames.
    this.hips.rotation.x += this.recoil * 0.12;
    this.gun.visible = this.aim > 0.15;
    this.gun.position.set(0.16, 0.62 + Math.sin(this.phase) * 0.01, 0.22);
    this.gun.rotation.x = -this.recoil * 0.4;
  }

  muzzle(out = new THREE.Vector3()) {
    const yaw = this.yaw;
    const fx = Math.cos(yaw);
    const fz = -Math.sin(yaw);
    out.set(this.x + fx * 0.55, this.y + 1.32, this.z + fz * 0.55);
    return out;
  }

  fire() {
    if (this.clip <= 0) {
      if (this.ammo <= 0) return false;
      this.clip = Math.min(12, this.ammo);
      this.ammo -= this.clip;
      return false;
    }
    this.clip -= 1;
    this.recoil = 1;
    return true;
  }

  reload() {
    const need = 12 - this.clip;
    if (need <= 0 || this.ammo <= 0) return;
    const take = Math.min(need, this.ammo);
    this.clip += take;
    this.ammo -= take;
  }

  damage(amount, source) {
    if (!this.alive) return;
    this.health = clamp(this.health - amount, 0, this.maxHealth);
    this.lastHit = source || null;
    if (this.health <= 0) this.die();
  }

  die() {
    this.alive = false;
    this.speed = 0;
    this.respawnTimer = P.respawn;
    if (this.inCar) this.exitCar(true);
  }

  respawn() {
    this.alive = true;
    this.health = this.maxHealth;
    this.respawnTimer = 0;
    this.ammo = 42;
    this.clip = 12;
    const spot = this.world.randomSidewalkPoint(this.rng);
    this.place(spot.x, spot.z, 0);
  }

  enterCar(car) {
    this.inCar = car;
    this.root.visible = false;
    this.speed = 0;
  }

  exitCar(force = false) {
    const car = this.inCar;
    if (!car) return;
    this.inCar = null;
    // Step out on the kerb side.
    const side = car.rightX * 2.1;
    const sideZ = car.rightZ * 2.1;
    const spot = this.world.nearestSidewalkPoint(car.x + side, car.z + sideZ);
    this.place(spot.x, spot.z, car.yaw);
    this.root.visible = true;
    if (!force) car.speed = 0;
  }
}

// ------------------------------------------------------------------ camera

export class GameCamera {
  constructor(camera) {
    this.camera = camera;
    this.yaw = 0;
    this.pitch = -0.06;
    this.distance = CAMERA.foot.distance;
    this.height = CAMERA.foot.height;
    this.shoulder = CAMERA.foot.shoulder;
    this.pos = new THREE.Vector3();
    this.lookAt = new THREE.Vector3();
    this.target = new THREE.Vector3();
    this.shake = 0;
    this.bobPhase = 0;
    this.mode = 'foot';
    this.initialised = false;
  }

  configure(mode) {
    this.mode = mode;
    const cfg = mode === 'car' ? CAMERA.car : CAMERA.foot;
    this.desiredDistance = cfg.distance;
    this.desiredHeight = cfg.height;
    this.desiredShoulder = cfg.shoulder;
    this.lookHeight = cfg.lookHeight;
  }

  addShake(amount) {
    this.shake = Math.min(1.6, this.shake + amount);
  }

  snap(target, yaw) {
    this.yaw = yaw;
    this.update(0.016, target, true);
  }

  update(dt, target, instant = false) {
    this.distance = instant ? this.desiredDistance : damp(this.distance, this.desiredDistance, 5, dt);
    this.height = instant ? this.desiredHeight : damp(this.height, this.desiredHeight, 5, dt);
    this.shoulder = instant ? this.desiredShoulder : damp(this.shoulder, this.desiredShoulder, 5, dt);

    this.bobPhase += dt * 9;
    const bob = this.mode === 'foot' ? Math.sin(this.bobPhase) * CAMERA.bob * (target.speed / 4) : 0;

    const yaw = this.yaw;
    const fx = Math.cos(yaw);
    const fz = -Math.sin(yaw);
    const rx = Math.sin(yaw);
    const rz = Math.cos(yaw);

    const anchorY = target.y + this.lookHeight;
    this.target.set(target.x, anchorY, target.z);

    const px = target.x - fx * this.distance + rx * this.shoulder;
    const pz = target.z - fz * this.distance + rz * this.shoulder;
    const py = target.y + this.height + bob;

    if (instant || !this.initialised) {
      this.pos.set(px, py, pz);
      this.initialised = true;
    } else {
      const k = 1 - Math.exp(-CAMERA.follow * dt);
      this.pos.x += (px - this.pos.x) * k;
      this.pos.y += (py - this.pos.y) * k;
      this.pos.z += (pz - this.pos.z) * k;
    }

    this.camera.position.copy(this.pos);

    // Shake decays fast and is applied in camera space.
    this.shake = Math.max(0, this.shake - dt * 2.2);
    if (this.shake > 0.001) {
      const s = this.shake * 0.35;
      this.camera.position.x += Math.sin(this.bobPhase * 7.3) * s;
      this.camera.position.y += Math.cos(this.bobPhase * 5.1) * s;
      this.camera.position.z += Math.sin(this.bobPhase * 3.7) * s * 0.5;
    }

    this.lookAt.set(
      target.x + fx * 3.2,
      anchorY + Math.sin(this.pitch) * 4.4 + 0.15 + (this.mode === 'car' ? 1.35 : 0),
      target.z + fz * 3.2,
    );
    this.camera.lookAt(this.lookAt);

    if (this.shake > 0.001) {
      this.camera.rotation.z += Math.sin(this.bobPhase * 9.1) * this.shake * 0.012;
    }
  }
}

export function createPlayer(scene, world, rng) {
  return new Player(scene, world, rng);
}
