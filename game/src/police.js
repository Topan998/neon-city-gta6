// police.js — the wanted system.
//
// Heat (0..5 stars) rises with crimes, and the department answers with cruisers that spawn behind the
// player at a distance that shrinks with the level. They chase with the same arcade physics as every
// other car, ram when they get close, and at three stars they stop and put officers on foot. Break
// line of sight and stay out of it long enough and the stars start to fall.
//
// Nothing here allocates per frame: cruisers and officers are pooled, and the flash phase is driven by
// the fixed simulation clock so a screenshot is reproducible.

import THREE from './three-shim.js';
import { CITY, PHYSICS, PALETTE } from './config.js';
import { TAU, clamp, lerp, damp, angleDiff } from './util.js';
import { createPoliceCar } from './vehicles.js';

const SPAWN_DISTANCE = [110, 92, 74, 58, 44];

// A cut-down body for officers: torso, head, two legs, a service cap. Six meshes, no animation rig.
class Officer {
  constructor(scene, world, index) {
    this.world = world;
    this.index = index;
    this.root = new THREE.Group();
    this.root.visible = false;
    scene.add(this.root);

    const uniform = new THREE.MeshStandardMaterial({ color: 0x1b2740, roughness: 0.7, metalness: 0.05 });
    const skin = new THREE.MeshStandardMaterial({ color: PALETTE.skin[0], roughness: 0.68 });
    const vest = new THREE.MeshStandardMaterial({ color: 0xf0d75a, roughness: 0.5, metalness: 0.1 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x121418, roughness: 0.6 });

    const torso = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.62, 0.3), uniform);
    torso.position.y = 1.14;
    torso.castShadow = true;
    this.root.add(torso);

    const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.16, 0.32), vest);
    stripe.position.y = 1.2;
    this.root.add(stripe);

    const head = new THREE.Mesh(new THREE.SphereGeometry(0.15, 10, 8), skin);
    head.position.y = 1.6;
    head.castShadow = true;
    this.root.add(head);

    const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.17, 0.1, 10), dark);
    cap.position.y = 1.72;
    this.root.add(cap);

    this.legs = [];
    for (const side of [-1, 1]) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.86, 0.18), uniform);
      leg.position.set(side * 0.13, 0.44, 0);
      leg.castShadow = true;
      this.root.add(leg);
      this.legs.push(leg);
    }

    this.x = 0;
    this.z = 0;
    this.yaw = 0;
    this.phase = 0;
    this.speed = 0;
    this.active = false;
    this.cooldown = 0;
  }

  spawn(x, z, yaw) {
    this.x = x;
    this.z = z;
    this.yaw = yaw;
    this.active = true;
    this.root.visible = true;
    this.root.position.set(x, CITY.curb, z);
    this.phase = 0;
  }

  update(dt, player, effects, onShoot) {
    if (!this.active) return;
    const dx = player.x - this.x;
    const dz = player.z - this.z;
    const dist = Math.hypot(dx, dz);
    const targetYaw = Math.atan2(-dz, dx);
    this.yaw += angleDiff(this.yaw, targetYaw) * Math.min(1, dt * 6);

    let speed = 0;
    if (dist > 4.2) speed = 4.6;
    else speed = 1.2;
    this.speed = damp(this.speed, speed, 6, dt);
    this.x += Math.cos(this.yaw) * this.speed * dt;
    this.z += -Math.sin(this.yaw) * this.speed * dt;

    const push = this.world.buildingPush(this.x, this.z, 0.35);
    if (push) {
      this.x += push.x;
      this.z += push.z;
    }

    this.phase += this.speed * dt * 3.4;
    this.legs[0].rotation.x = Math.sin(this.phase) * 0.55;
    this.legs[1].rotation.x = -Math.sin(this.phase) * 0.55;

    this.root.position.set(this.x, CITY.curb, this.z);
    this.root.rotation.y = this.yaw;

    // Fire roughly every 1.6 s when in range and roughly facing the player.
    this.cooldown -= dt;
    if (dist < 22 && this.cooldown <= 0) {
      this.cooldown = 1.6;
      const fx = Math.cos(this.yaw);
      const fz = -Math.sin(this.yaw);
      const aimDot = (dx * fx + dz * fz) / (dist || 1);
      if (aimDot > 0.55) {
        if (effects) effects.muzzle(this.x + fx * 0.7, CITY.curb + 1.3, this.z + fz * 0.7, fx, fz);
        if (onShoot) onShoot(this, dist);
      }
    }
  }

  retire() {
    this.active = false;
    this.root.visible = false;
  }
}

export class Police {
  constructor(scene, world, rng, audio, effects) {
    this.scene = scene;
    this.world = world;
    this.rng = rng;
    this.audio = audio;
    this.effects = effects;
    this.cruisers = [];
    this.officers = [
      new Officer(scene, world, 0),
      new Officer(scene, world, 1),
      new Officer(scene, world, 2),
      new Officer(scene, world, 3),
    ];
    this.stars = 0;
    this.heat = 0;
    this.sinceSeen = 0;
    this.seen = false;
    this.spawnTimer = 0;
    this.rising = 0;
    this.onStars = null;
    this.onBust = null;
    this.sirenOn = false;
    this.clock = 0;
    this.lastSpawnDistance = 0;
  }

  setStars(n) {
    this.stars = clamp(Math.round(n), 0, 5);
    this.heat = this.stars;
    this.rising = 1.4;
    if (this.onStars) this.onStars(this.stars);
  }

  crime(severity = 1, x = 0, z = 0) {
    const before = this.stars;
    this.heat = clamp(this.heat + severity, 0, 5);
    this.stars = clamp(Math.ceil(this.heat), 0, 5);
    this.sinceSeen = 0;
    this.rising = 1.4;
    if (this.stars !== before && this.onStars) this.onStars(this.stars, before);
    if (this.audio) this.audio.sting(this.stars);
    return this.stars;
  }

  // Called by shots.js: park a cruiser behind the player with the bar lit.
  stageChase(x, z, yaw, offset = 9.5) {
    const car = this.acquireCruiser();
    if (!car) return null;
    const backX = x - Math.cos(yaw) * offset;
    const backZ = z + Math.sin(yaw) * offset;
    car.place(backX, backZ, yaw);
    car.speed = 6;
    car.pursuit = true;
    this.stars = 3;
    this.heat = 3;
    this.sirenOn = true;
    return car;
  }

  acquireCruiser() {
    for (const car of this.cruisers) {
      if (!car.active) return car;
    }
    if (this.cruisers.length >= 5) return null;
    const car = createPoliceCar(this.scene, this.world);
    car.active = true;
    car.pursuit = true;
    car.onImpact = (force, x, z) => {
      if (this.effects) this.effects.spark(x, 1.2, z, 6, 0.6);
      if (this.audio) this.audio.thud(clamp(force / 14, 0.15, 1));
    };
    this.cruisers.push(car);
    return car;
  }

  releaseCruiser(car) {
    car.active = false;
    car.root.visible = false;
    car.speed = 0;
  }

  spawnCruiser(player, playerCar) {
    const car = this.acquireCruiser();
    if (!car) return;
    const dist = SPAWN_DISTANCE[clamp(this.stars - 1, 0, 4)];
    this.lastSpawnDistance = dist;
    // Spawn on the road behind the player, snapped to the nearest lane.
    const py = player.inCar ? playerCar.yaw : player.yaw;
    const px = player.inCar ? playerCar.x : player.x;
    const pz = player.inCar ? playerCar.z : player.z;
    let x = px - Math.cos(py) * dist;
    let z = pz + Math.sin(py) * dist;
    // Snap to the nearest road line so the cruiser appears on asphalt.
    const nearestX = Math.round((x - CITY.roadLine(0)) / CITY.pitch);
    const nearestZ = Math.round((z - CITY.roadLine(0)) / CITY.pitch);
    const rx = CITY.roadLine(clamp(nearestX, 0, CITY.blocks));
    const rz = CITY.roadLine(clamp(nearestZ, 0, CITY.blocks));
    if (Math.abs(x - rx) < Math.abs(z - rz)) x = rx;
    else z = rz;
    const yaw = Math.atan2(-(pz - z), px - x);
    car.place(clamp(x, -CITY.half + 10, CITY.half - 10), clamp(z, -CITY.half + 10, CITY.half - 10), yaw);
    car.speed = 12;
    car.pursuit = true;
    car.stuck = 0;
  }

  update(dt, player, playerCar, traffic) {
    this.clock += dt;
    const alive = player.alive;
    const px = player.inCar ? playerCar.x : player.x;
    const pz = player.inCar ? playerCar.z : player.z;

    // Line of sight: no building between the player and the cruiser that sees them.
    let seen = false;
    for (const car of this.cruisers) {
      if (!car.active) continue;
      const d = Math.hypot(car.x - px, car.z - pz);
      if (d < 90 && this.lineOfSight(car.x, car.z, px, pz)) {
        seen = true;
        break;
      }
    }
    this.seen = seen;
    if (seen) {
      this.sinceSeen = 0;
    } else {
      this.sinceSeen += dt;
      // Out of sight long enough: the level bleeds off.
      if (this.sinceSeen > PHYSICS.wanted.decayDelay && this.stars > 0) {
        this.heat = Math.max(0, this.heat - PHYSICS.wanted.decayRate * dt * (1 + this.stars * 0.35));
        const nextStars = clamp(Math.ceil(this.heat - 0.02), 0, 5);
        if (nextStars !== this.stars) {
          this.stars = nextStars;
          if (this.onStars) this.onStars(this.stars);
        }
      }
    }

    // Spawn / retire cruisers to match the level.
    const want = this.stars === 0 ? 0 : clamp(this.stars, 1, 4);
    const activeCount = this.cruisers.filter((c) => c.active).length;
    this.spawnTimer -= dt;
    if (activeCount < want && this.spawnTimer <= 0) {
      this.spawnCruiser(player, playerCar);
      this.spawnTimer = lerp(3.4, 1.2, this.stars / 5);
    }
    if (activeCount > want) {
      for (let i = this.cruisers.length - 1; i >= 0; i--) {
        const c = this.cruisers[i];
        if (c.active) {
          this.releaseCruiser(c);
          break;
        }
      }
    }

    // Pursuit.
    for (const car of this.cruisers) {
      if (!car.active) continue;
      const dx = px - car.x;
      const dz = pz - car.z;
      const d = Math.hypot(dx, dz);
      const targetYaw = Math.atan2(-dz, dx);
      let err = angleDiff(car.yaw, targetYaw);
      // Ram: aim a little ahead of the player when close and moving.
      if (d < 26 && playerCar && player.inCar) {
        const lead = clamp(d / 18, 0, 1);
        const aimX = px + Math.cos(playerCar.yaw) * playerCar.speed * lead * 0.4;
        const aimZ = pz - Math.sin(playerCar.yaw) * playerCar.speed * lead * 0.4;
        err = angleDiff(car.yaw, Math.atan2(-(aimZ - car.z), aimX - car.x));
      }
      const steer = clamp(err / 0.42, -1, 1);
      const tooClose = d < 6.5;
      const throttle = tooClose ? 0.55 : d > 12 ? 1 : 0.85;
      const brake = tooClose ? 0.4 : 0;
      car.setInput(throttle, brake, steer, false);
      car.step(dt);
      car.updateVisual(dt);

      // Light bar: red and blue alternate about four times a second.
      const phase = Math.floor(this.clock * 7 + car.id) % 2;
      car.flash = phase;

      if (d < 4.2 && player.inCar) {
        // Ram the player hard.
        const nx = dx / (d || 1);
        const nz = dz / (d || 1);
        playerCar.speed *= 0.86;
        playerCar.lateral = clamp(playerCar.lateral + nz * 3.4, -7, 7);
        playerCar.x += nx * 0.35;
        playerCar.z += nz * 0.35;
        car.speed *= 0.6;
        if (this.effects) this.effects.spark(playerCar.x, 0.9, playerCar.z, 8, 0.7);
        if (this.audio) this.audio.thud(0.7);
      }
      if (d < 2.2 && !player.inCar && alive) {
        player.damage(26 * dt * 4, car);
        if (this.effects) this.effects.hit(player.x, 1.3, player.z);
      }

      // Keep the light bar material in sync for the shot path.
      if (car.tailMesh) car.tailMesh.material.emissiveIntensity = 0.7;
    }

    // Officers on foot at three stars and up, from a stopped cruiser.
    const wantOfficers = this.stars >= 3 ? clamp(this.stars - 2, 1, 3) : 0;
    let activeOfficers = 0;
    for (const off of this.officers) if (off.active) activeOfficers++;
    if (activeOfficers < wantOfficers) {
      const off = this.officers.find((o) => !o.active);
      const cruiser = this.cruisers.find((c) => c.active);
      if (off && cruiser) {
        const sideX = cruiser.rightX * 2.2;
        const sideZ = cruiser.rightZ * 2.2;
        off.spawn(cruiser.x + sideX, cruiser.z + sideZ, cruiser.yaw);
      }
    } else if (activeOfficers > wantOfficers) {
      for (const off of this.officers) {
        if (off.active) {
          off.retire();
          break;
        }
      }
    }
    for (const off of this.officers) {
      if (!off.active) continue;
      off.update(dt, player, this.effects, (officer, dist) => {
        if (this.audio) this.audio.gunshot(0.55);
        if (this.effects) this.effects.hit(player.x, 1.3, player.z);
        player.damage(clamp(9 - dist * 0.2, 2, 9), officer);
      });
    }

    // Siren: on while anyone is chasing and close enough to be heard.
    const shouldSiren = this.stars > 0 && alive;
    if (shouldSiren !== this.sirenOn) {
      this.sirenOn = shouldSiren;
      if (this.audio) this.audio.siren(shouldSiren);
    }

    // Fleet clean-up: anything left far behind is retired.
    for (const car of this.cruisers) {
      if (!car.active) continue;
      if (Math.hypot(car.x - px, car.z - pz) > 260) {
        this.releaseCruiser(car);
      }
    }

    this.rising = Math.max(0, this.rising - dt);
  }

  // Straight-line test against the building boxes; sampled, which is plenty at this scale.
  lineOfSight(x0, z0, x1, z1) {
    const steps = 12;
    for (let s = 1; s < steps; s++) {
      const t = s / steps;
      const x = lerp(x0, x1, t);
      const z = lerp(z0, z1, t);
      if (this.world.insideBuilding(x, z)) return false;
    }
    return true;
  }

  clear() {
    for (const car of this.cruisers) this.releaseCruiser(car);
    for (const off of this.officers) off.retire();
    this.stars = 0;
    this.heat = 0;
    this.sinceSeen = 0;
    this.sirenOn = false;
    if (this.audio) this.audio.siren(false);
    if (this.onStars) this.onStars(0);
  }
}
