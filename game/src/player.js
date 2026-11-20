// player.js — the man you play. A jointed rig with a walk and a run cycle, a third-person camera
// on pointer lock, a pistol, a health bar, and the enter/exit-car hand-off with the fleet.
//
// The rig is built from boxes on pivot groups: thighs and shins swing and bend, arms counter-swing,
// the head follows the camera's pitch a little, and the whole thing leans into a sprint.

const THREE = window.THREE;

import { PLAYER, CAMERA, CAR_KINDS } from './config.js';
import {
  TAU, clamp, lerp, damp, dampAngle, angleDelta, smoothstep, standard, GeoBuilder,
} from './util.js';

const SKIN = [0xd9a877, 0xc48a5e, 0x8d5a3b, 0xe6bc90, 0x6b4327];
const JACKETS = [0x2b3a4a, 0x6a2f2f, 0x2f4a35, 0x3a3a42, 0x4a3a24, 0x1f2a33];
const JEANS = [0x2b3340, 0x3a3f4a, 0x4a4438, 0x22262c];
const SNEAKERS = [0xe8e8e8, 0x2a2a2a, 0xd04a3a, 0x3a5a8a];

/** One limb: a pivot group with a box hanging under it, so rotations look like joints. */
function limb(parent, { w, h, d, x, y, z, colour, mat }) {
  const pivot = new THREE.Group();
  pivot.position.set(x, y, z);
  const geo = new THREE.BoxGeometry(w, h, d);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.y = -h / 2;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  pivot.add(mesh);
  parent.add(pivot);
  return { pivot, mesh };
}

/**
 * The player character. `game` is the running game object; the rig is added to the scene on
 * construction and the camera is owned here too.
 */
export class Player {
  constructor(game) {
    this.game = game;
    this.rng = game.rng;
    this.pos = new THREE.Vector3(0, 0, 0);
    this.vel = new THREE.Vector2(0, 0);
    this.heading = 0;
    this.speed = 0;
    this.health = PLAYER.health;
    this.ammo = PLAYER.mag;
    this.reserve = PLAYER.maxAmmo;
    this.reloading = 0;
    this.aiming = false;
    this.walkPhase = 0;
    this.inCar = null;
    this.alive = true;
    this.fireCooldown = 0;
    this.stepTimer = 0;
    this.cameraYaw = 0;
    this.cameraPitch = 0.04;
    this.cameraDist = 5.4;
    this.shake = 0;
    this.deadTimer = 0;

    this.buildRig();
    this.buildPistol();
  }

  buildRig() {
    const skin = SKIN[Math.floor(this.rng() * SKIN.length)];
    const jacket = JACKETS[Math.floor(this.rng() * JACKETS.length)];
    const jeans = JEANS[Math.floor(this.rng() * JEANS.length)];
    const shoes = SNEAKERS[Math.floor(this.rng() * SNEAKERS.length)];
    this.colours = { skin, jacket, jeans, shoes };

    this.matSkin = standard({ color: skin, roughness: 0.72, metalness: 0.02 });
    this.matJacket = standard({ color: jacket, roughness: 0.55, metalness: 0.12 });
    this.matJeans = standard({ color: jeans, roughness: 0.85, metalness: 0.04 });
    this.matShoe = standard({ color: shoes, roughness: 0.6, metalness: 0.06 });
    this.matHair = standard({ color: 0x1d1712, roughness: 0.9, metalness: 0.02 });

    const root = new THREE.Group();
    root.name = 'player';
    this.root = root;

    // hips and torso
    const hips = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.22, 0.24), this.matJeans);
    hips.position.y = 0.94;
    hips.castShadow = true;
    hips.receiveShadow = true;
    root.add(hips);

    const torso = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.56, 0.26), this.matJacket);
    torso.position.y = 1.33;
    torso.castShadow = true;
    torso.receiveShadow = true;
    root.add(torso);
    this.torso = torso;

    // shoulders and neck
    const shoulders = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.14, 0.28), this.matJacket);
    shoulders.position.y = 1.6;
    shoulders.castShadow = true;
    root.add(shoulders);

    const neck = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.1, 0.13), this.matSkin);
    neck.position.y = 1.7;
    root.add(neck);

    // head: a box with hair over the top and a hint of a face
    const head = new THREE.Group();
    head.position.y = 1.83;
    const skull = new THREE.Mesh(new THREE.BoxGeometry(0.23, 0.26, 0.24), this.matSkin);
    skull.castShadow = true;
    head.add(skull);
    const hair = new THREE.Mesh(new THREE.BoxGeometry(0.245, 0.11, 0.25), this.matHair);
    hair.position.y = 0.09;
    hair.castShadow = true;
    head.add(hair);
    const nose = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.05, 0.05), this.matSkin);
    nose.position.set(0, -0.01, 0.13);
    head.add(nose);
    root.add(head);
    this.head = head;

    // arms: upper arm pivot at the shoulder, forearm pivot at the elbow
    this.armR = limb(root, { w: 0.13, h: 0.28, d: 0.14, x: 0.28, y: 1.59, z: 0, colour: jacket, mat: this.matJacket });
    this.armL = limb(root, { w: 0.13, h: 0.28, d: 0.14, x: -0.28, y: 1.59, z: 0, colour: jacket, mat: this.matJacket });
    this.foreR = limb(this.armR.pivot, { w: 0.11, h: 0.27, d: 0.12, x: 0, y: -0.28, z: 0, colour: skin, mat: this.matSkin });
    this.foreL = limb(this.armL.pivot, { w: 0.11, h: 0.27, d: 0.12, x: 0, y: -0.28, z: 0, colour: skin, mat: this.matSkin });

    // legs
    this.thighR = limb(root, { w: 0.17, h: 0.42, d: 0.18, x: 0.11, y: 0.88, z: 0, colour: jeans, mat: this.matJeans });
    this.thighL = limb(root, { w: 0.17, h: 0.42, d: 0.18, x: -0.11, y: 0.88, z: 0, colour: jeans, mat: this.matJeans });
    this.shinR = limb(this.thighR.pivot, { w: 0.15, h: 0.42, d: 0.16, x: 0, y: -0.42, z: 0, colour: jeans, mat: this.matJeans });
    this.shinL = limb(this.thighL.pivot, { w: 0.15, h: 0.42, d: 0.16, x: 0, y: -0.42, z: 0, colour: jeans, mat: this.matJeans });
    this.footR = limb(this.shinR.pivot, { w: 0.16, h: 0.1, d: 0.28, x: 0, y: -0.42, z: 0.05, colour: shoes, mat: this.matShoe });
    this.footL = limb(this.shinL.pivot, { w: 0.16, h: 0.1, d: 0.28, x: 0, y: -0.42, z: 0.05, colour: shoes, mat: this.matShoe });

    this.game.scene.add(root);
  }

  /** A small blocky pistol, held in the right hand, only visible on foot. */
  buildPistol() {
    const g = new THREE.Group();
    const dark = standard({ color: 0x22242a, roughness: 0.45, metalness: 0.7 });
    const slide = new THREE.Mesh(new THREE.BoxGeometry(0.055, 0.055, 0.24), dark);
    slide.position.z = 0.06;
    g.add(slide);
    const grip = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.13, 0.06), standard({ color: 0x14161a, roughness: 0.8 }));
    grip.position.set(0, -0.08, -0.03);
    grip.rotation.x = 0.22;
    g.add(grip);
    const muzzle = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.03, 0.02), new THREE.MeshBasicMaterial({ color: 0xffd9a0 }));
    muzzle.position.z = 0.19;
    g.add(muzzle);
    this.muzzleFlash = muzzle;
    muzzle.visible = false;
    g.position.set(0, -0.06, 0.14);
    this.foreR.pivot.add(g);
    this.pistol = g;
  }

  /** Put the man on the pavement at a spot. */
  setPosition(x, z, heading = this.heading) {
    const y = this.game.world.groundY(x, z);
    this.pos.set(x, y, z);
    this.heading = heading;
    this.vel.set(0, 0);
    this.syncRig(0.016);
    this.updateCamera(0.016, true);
  }

  get forward() {
    return new THREE.Vector2(Math.sin(this.heading), Math.cos(this.heading));
  }

  /** Read the input state into motion, then animate. Runs on foot only. */
  update(dt, input) {
    if (this.inCar) {
      this.updateInCar(dt, input);
      return;
    }
    const wishX = (input.right ? 1 : 0) - (input.left ? 1 : 0);
    const wishZ = (input.forward ? 1 : 0) - (input.back ? 1 : 0);
    const camYaw = this.cameraYaw;
    // movement is relative to where the camera looks
    const fwd = new THREE.Vector2(Math.sin(camYaw), Math.cos(camYaw));
    const right = new THREE.Vector2(Math.cos(camYaw), -Math.sin(camYaw));
    let moveX = fwd.x * wishZ + right.x * wishX;
    let moveZ = fwd.y * wishZ + right.y * wishX;
    const mag = Math.hypot(moveX, moveZ);
    if (mag > 0.001) {
      moveX /= mag;
      moveZ /= mag;
    }
    const running = input.run && mag > 0.01;
    const sprint = input.sprint && running;
    const targetSpeed = mag > 0.01 ? (sprint ? PLAYER.sprint : running ? PLAYER.run : PLAYER.walk) : 0;
    const accel = mag > 0.01 ? 14 : 12;
    this.speed = damp(this.speed, targetSpeed, accel, dt);

    if (this.aiming) {
      // standing and shooting: turn the body to face where the camera looks
      this.heading = dampAngle(this.heading, this.cameraYaw, 12, dt);
    }
    if (mag > 0.01) {
      const want = Math.atan2(moveX, moveZ);
      this.heading = dampAngle(this.heading, want, PLAYER.turnRate, dt);
      this.vel.set(moveX * this.speed, moveZ * this.speed);
    } else {
      this.vel.multiplyScalar(Math.exp(-10 * dt));
    }

    this.pos.x += this.vel.x * dt;
    this.pos.z += this.vel.y * dt;
    const fixed = this.game.world.resolveCircle(this.pos.x, this.pos.z, PLAYER.radius);
    this.pos.x = fixed.x;
    this.pos.z = fixed.z;
    this.pos.x = clamp(this.pos.x, -318, 318);
    this.pos.z = clamp(this.pos.z, -318, 318);
    const gy = this.game.world.groundY(this.pos.x, this.pos.z);
    this.pos.y = damp(this.pos.y, gy, 16, dt);

    // footsteps
    if (this.speed > 0.6) {
      this.stepTimer -= dt * (this.speed / 3.4);
      if (this.stepTimer <= 0) {
        this.stepTimer = 0.52;
        this.game.audio?.footstep(this.speed > PLAYER.walk + 0.6);
        this.game.effects?.dust(this.pos.x, this.pos.y + 0.05, this.pos.z);
      }
    } else {
      this.stepTimer = 0.2;
    }

    this.animate(dt);
    this.updateWeapon(dt);
    this.syncRig(dt);
    this.updateCamera(dt);
  }

  /** Walk / run cycle: knees lift, arms counter-swing, the body bobs. */
  animate(dt) {
    const speed = this.speed;
    const moving = speed > 0.25;
    const stride = clamp(speed / PLAYER.run, 0.25, 1.35);
    if (moving) this.walkPhase += dt * (3.4 + speed * 0.85);
    const p = this.walkPhase;
    const swing = moving ? Math.sin(p) * (0.55 + stride * 0.45) : 0;
    const counter = moving ? Math.sin(p + Math.PI) * (0.5 + stride * 0.4) : 0;

    // legs
    this.thighR.pivot.rotation.x = swing;
    this.thighL.pivot.rotation.x = counter;
    // knees bend most as the leg comes forward
    const kneeR = moving ? Math.max(0, -Math.sin(p + 0.7)) * (0.7 + stride * 0.5) : 0.05;
    const kneeL = moving ? Math.max(0, -Math.sin(p + Math.PI + 0.7)) * (0.7 + stride * 0.5) : 0.05;
    this.shinR.pivot.rotation.x = kneeR;
    this.shinL.pivot.rotation.x = kneeL;
    this.footR.pivot.rotation.x = -kneeR * 0.4 + swing * 0.25;
    this.footL.pivot.rotation.x = -kneeL * 0.4 + counter * 0.25;

    // arms swing opposite the legs; the right arm holds the pistol out when aiming
    const aimRight = this.aiming ? -1.45 : counter * 0.8;
    this.armR.pivot.rotation.x = damp(this.armR.pivot.rotation.x, aimRight, 14, dt);
    this.armL.pivot.rotation.x = damp(this.armL.pivot.rotation.x, this.aiming ? -1.1 : swing * 0.8, 14, dt);
    this.armR.pivot.rotation.z = damp(this.armR.pivot.rotation.z, this.aiming ? 0.15 : 0.12, 10, dt);
    this.armL.pivot.rotation.z = -0.12;
    this.foreR.pivot.rotation.x = damp(this.foreR.pivot.rotation.x, this.aiming ? -0.1 : -0.45 - Math.abs(swing) * 0.2, 12, dt);
    this.foreL.pivot.rotation.x = -0.45;

    // torso lean and bob
    const bob = moving ? Math.abs(Math.sin(p)) * 0.035 * stride : 0;
    this.root.position.y = this.pos.y + bob;
    this.torso.rotation.x = damp(this.torso.rotation.x, moving ? clamp(speed / 40, 0, 0.1) : 0, 8, dt);
    this.root.rotation.z = damp(this.root.rotation.z, moving ? Math.sin(p) * 0.02 * stride : 0, 8, dt);
    // head looks where the camera looks
    this.head.rotation.x = damp(this.head.rotation.x, clamp(-this.cameraPitch * 0.8, -0.5, 0.5), 10, dt);
  }

  /** Position and orient the rig from the simulation state (and hide it inside a car). */
  syncRig(dt) {
    this.root.position.x = this.pos.x;
    this.root.position.z = this.pos.z;
    if (!this.root.position.y) this.root.position.y = this.pos.y;
    this.root.rotation.y = this.heading;
    this.root.visible = !this.inCar;
  }

  /** The pistol: cooldown, reload, muzzle flash, recoil. */
  updateWeapon(dt) {
    this.fireCooldown = Math.max(0, this.fireCooldown - dt);
    if (this.muzzleTimer > 0) {
      this.muzzleTimer -= dt;
      this.muzzleFlash.visible = this.muzzleTimer > 0;
    }
    if (this.reloading > 0) {
      this.reloading -= dt;
      if (this.reloading <= 0) {
        const need = PLAYER.mag - this.ammo;
        const take = Math.min(need, this.reserve);
        this.ammo += take;
        this.reserve -= take;
      }
    }
  }

  /** Fire the pistol along the camera's aim. */
  tryFire() {
    if (this.fireCooldown > 0 || this.inCar || !this.alive) return false;
    if (this.reloading > 0) return false;
    if (this.ammo <= 0) {
      this.reload();
      return false;
    }
    this.ammo -= 1;
    this.fireCooldown = 0.2;
    this.muzzleTimer = 0.055;
    this.muzzleFlash.visible = true;
    this.aiming = true;
    this.aimTimer = 0.7;

    const cam = this.game.camera;
    const dir = new THREE.Vector3();
    cam.getWorldDirection(dir);
    const origin = cam.position.clone();
    this.game.effects?.muzzleFlash(origin.clone().add(dir.clone().multiplyScalar(1.2)), cam.quaternion);
    this.game.audio?.gunshot();
    this.game.effects?.shake(0.12);
    this.game.police?.addHeat(this.game.config?.crime?.gunshot ?? 9, 'gunshot');
    this.game.onGunshot?.(this.pos, dir);
    return true;
  }

  reload() {
    if (this.reloading > 0 || this.reserve <= 0 || this.ammo >= PLAYER.mag) return;
    this.reloading = 1.15;
    this.game.audio?.click(340, 0.08);
  }

  /** Get in a car: snap the camera behind it and take the wheel. */
  enterCar(car) {
    if (!car || this.inCar) return;
    this.inCar = car;
    car.driver = 'player';
    car.ai = null;
    car.parked = false;
    car.setHeadlights(true);
    if (car.headlight) car.headlight.intensity = 260;
    this.root.visible = false;
    this.game.setMode?.('car');
    this.game.audio?.engineStart();
    this.game.toast?.(`${(car.kind ?? 'car').toUpperCase()} TAKEN`);
    if (car.ai === null && this.game.police) this.game.police.addHeat(4, 'carjack');
  }

  /** Step out: put the man on the pavement beside the driver's door. */
  exitCar() {
    const car = this.inCar;
    if (!car) return;
    const right = car.rightVec;
    const side = new THREE.Vector2(-right.x, -right.y);
    let x = car.pos.x + side.x * (car.wid * 0.5 + 0.7);
    let z = car.pos.z + side.y * (car.wid * 0.5 + 0.7);
    const fixed = this.game.world.resolveCircle(x, z, PLAYER.radius + 0.1);
    x = fixed.x;
    z = fixed.z;
    this.inCar = null;
    car.driver = null;
    car.speed = 0;
    car.vel.set(0, 0);
    if (car.headlight) car.headlight.intensity = 0;
    this.pos.set(x, this.game.world.groundY(x, z), z);
    this.heading = car.heading;
    this.cameraYaw = car.heading + Math.PI;
    this.root.visible = true;
    this.game.setMode?.('foot');
    this.game.audio?.engineStop();
  }

  /** While driving, the player's position is the car's, and on-foot movement is frozen. */
  updateInCar(dt, input) {
    const car = this.inCar;
    if (!car) return;
    car.drive({
      throttle: (input.forward ? 1 : 0) - (input.back ? 1 : 0),
      steer: (input.right ? 1 : 0) - (input.left ? 1 : 0),
      handbrake: !!input.handbrake,
      boost: !!input.sprint,
    }, dt);
    this.pos.set(car.pos.x, 0, car.pos.z);
    this.heading = car.heading;
    this.speed = Math.abs(car.speed);
    // the camera trails the car, still steerable with the mouse
    this.updateCamera(dt);
    this.game.audio?.engineNote(car.speedKph, input.forward, car.handbrake);
    if (car.speedKph > 95 && this.game.police) {
      this.game.police.addHeat(0.12 * dt, 'speeding');
    }
  }

  /** Third-person camera: orbit around the target, damped, with a lift for the ground. */
  updateCamera(dt, snap = false) {
    const cam = this.game.camera;
    const car = this.inCar;
    const targetY = car ? 1.35 : 1.5;
    const dist = this.cameraDist + (car ? Math.min(2.6, Math.abs(car.speed) * 0.055) : 0);
    const yaw = this.cameraYaw;
    const pitch = clamp(this.cameraPitch, -0.55, 0.95);
    const target = new THREE.Vector3(this.pos.x, this.pos.y + targetY, this.pos.z);
    const back = new THREE.Vector3(
      Math.sin(yaw) * Math.cos(pitch),
      Math.sin(pitch),
      Math.cos(yaw) * Math.cos(pitch),
    ).multiplyScalar(-dist);
    const desired = target.clone().add(back);
    // keep the lens out of the pavement and out of buildings
    const gy = this.game.world.groundY(desired.x, desired.z) + 0.7;
    if (desired.y < gy) desired.y = gy;
    const pushed = this.game.world.resolveCircle(desired.x, desired.z, 0.55);
    if (pushed.x !== desired.x || pushed.z !== desired.z) {
      desired.x = pushed.x;
      desired.z = pushed.z;
      desired.y += 0.4;
    }

    if (snap) cam.position.copy(desired);
    else {
      const k = 1 - Math.exp(-CAMERA.damping * dt);
      cam.position.lerp(desired, k);
    }
    // shake
    if (this.shake > 0.001) {
      const s = this.shake;
      cam.position.x += (Math.sin(this.game.time * 61) * s) * 0.35;
      cam.position.y += (Math.cos(this.game.time * 53) * s) * 0.3;
      this.shake *= 0.9;
    }
    const lookAt = target.clone();
    lookAt.x += Math.sin(yaw) * CAMERA.lookAhead * 0.35;
    lookAt.z += Math.cos(yaw) * CAMERA.lookAhead * 0.35;
    lookAt.y += car ? 0.55 : 0.25;
    cam.lookAt(lookAt);
    cam.fov = lerp(cam.fov, car ? CAMERA.fov + 5 : CAMERA.fov, 4 * dt);
    cam.updateProjectionMatrix();
  }

  /** Take a hit: health down, screen shake, death if it runs out. */
  hurt(amount) {
    if (!this.alive) return;
    this.health = clamp(this.health - amount, 0, PLAYER.health);
    this.shake = Math.min(1, this.shake + amount / 60);
    this.game.hud?.flashDamage();
    if (this.health <= 0) this.die();
  }

  die() {
    this.alive = false;
    this.deadTimer = 3.2;
    this.root.rotation.z = 1.35;
    this.game.audio?.thud();
    this.game.hud?.toast('WASTED');
    if (this.inCar) this.exitCar();
  }

  respawn() {
    const p = this.game.world.nearestPavement(this.pos.x, this.pos.z);
    this.alive = true;
    this.health = PLAYER.health;
    this.ammo = PLAYER.mag;
    this.reserve = PLAYER.maxAmmo;
    this.root.rotation.z = 0;
    this.setPosition(p.x, p.z, this.heading);
    this.game.police?.reset();
  }

  /** Per-frame tick for the parts that keep running whether or not there is input. */
  tick(dt) {
    if (!this.alive) {
      this.deadTimer -= dt;
      if (this.deadTimer <= 0) this.respawn();
      return;
    }
    if (this.aimTimer > 0) {
      this.aimTimer -= dt;
      if (this.aimTimer <= 0) this.aiming = false;
    }
  }
}
