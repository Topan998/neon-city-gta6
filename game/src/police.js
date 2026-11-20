// police.js — the heat. Crimes add to a running total; the total becomes stars, stars become
// cruisers. Cruisers spawn out of sight behind the player and close in, ramming when they get
// there; at three stars officers get out on foot with a pistol. Break the line of sight long
// enough and the heat bleeds away, star by star.

const THREE = window.THREE;

import { WANTED, CRIME_HEAT, PALETTE } from './config.js';
import {
  TAU, clamp, lerp, damp, dampAngle, angleDelta, randRange, pick, chance, standard,
} from './util.js';
import { buildPerson } from './pedestrians.js';

/** How many stars a heat value is worth. */
export function starsFor(heat) {
  let stars = 0;
  for (let i = 1; i < WANTED.thresholds.length; i += 1) {
    if (heat >= WANTED.thresholds[i]) stars = i;
  }
  return stars;
}

class Cruiser {
  constructor(unit, car, x, z, heading) {
    this.unit = unit;
    this.car = car;
    this.state = 'pursue';
    this.spawnGrace = 1.2;
    this.ram = 0;
    this.reverse = 0;
  }

  update(dt, player) {
    const car = this.car;
    const police = this.unit;
    const target = player.inCar ? player.inCar.pos : player.pos;
    const dx = target.x - car.pos.x;
    const dz = target.z - car.pos.z;
    const dist = Math.hypot(dx, dz);
    this.spawnGrace -= dt;

    if (this.spawnGrace > 0) {
      car.drive({ throttle: 0.55, steer: 0, handbrake: false }, dt);
      return;
    }

    const wantHeading = Math.atan2(dx, dz);
    const diff = angleDelta(car.heading, wantHeading);
    let steer = clamp(diff * 1.9, -1, 1);
    // if we are pointing away from the target, back up rather than loop
    if (Math.abs(diff) > 2.2 && dist < 22) {
      car.drive({ throttle: -0.7, steer: -steer, handbrake: false }, dt);
      this.steerBack = 0.5;
      return;
    }
    // ram: full throttle when lined up, brake when very close and slower than the target
    let throttle = 1;
    if (dist < 9) throttle = 0.35;
    if (Math.abs(diff) > 0.9) throttle = Math.min(throttle, 0.55);
    if (this.steerBack > 0) {
      this.steerBack -= dt;
      throttle = 0.2;
    }
    // a soft separation so three cruisers do not stack into one
    for (const other of police.cruisers) {
      if (other === this) continue;
      const ox = other.car.pos.x - car.pos.x;
      const oz = other.car.pos.z - car.pos.z;
      const od = Math.hypot(ox, oz);
      if (od < 7 && od > 0.001) {
        steer -= clamp((ox / od) * 0.5, -0.5, 0.5);
      }
    }
    car.drive({ throttle, steer, handbrake: false, boost: dist > 40 }, dt);

    // ramming: near the player's car, get the nose into it
    if (player.inCar && dist < 7) {
      const pv = player.inCar;
      pv.damage(6 * dt);
      pv.vel.x += (dx / (dist || 1)) * 2.2 * dt;
      pv.vel.y += (dz / (dist || 1)) * 2.2 * dt;
      this.unit.game.effects?.sparks(
        (car.pos.x + pv.pos.x) / 2, 0.8, (car.pos.z + pv.pos.z) / 2, 5,
      );
      car.damage(2 * dt);
    }
    if (car.stuckTimer > 2.4) {
      car.setPosition(car.pos.x + randRange(police.rng, -2, 2), car.pos.z + randRange(police.rng, -2, 2), car.heading + Math.PI);
      car.stuckTimer = 0;
    }
  }
}

class Officer {
  constructor(unit, person, x, z) {
    this.unit = unit;
    this.person = person;
    this.pos = person.pos;
    this.health = 100;
    this.fireTimer = randRange(unit.rng, 0.6, 1.6);
    this.alive = true;
    this.downed = 0;
  }

  update(dt, player) {
    if (!this.alive) {
      this.downed += dt;
      return;
    }
    const target = player.pos;
    const dx = target.x - this.pos.x;
    const dz = target.z - this.pos.z;
    const dist = Math.hypot(dx, dz);
    const person = this.person;
    person.alive = true;

    // close in until 12 m, then hold and shoot
    if (dist > 13) {
      person.state = 'walk';
      person.target = { x: target.x, z: target.z };
      person.walkSpeed = 4.1;
      person.heading = dampAngle(person.heading, Math.atan2(dx, dz), 6, dt);
      person.speed = damp(person.speed, 4.1, 5, dt);
      person.pos.x += Math.sin(person.heading) * person.speed * dt;
      person.pos.z += Math.cos(person.heading) * person.speed * dt;
    } else {
      person.speed = damp(person.speed, 0, 6, dt);
      person.heading = dampAngle(person.heading, Math.atan2(dx, dz), 7, dt);
    }
    const fixed = this.unit.game.world.resolveCircle(person.pos.x, person.pos.z, 0.34);
    person.pos.x = fixed.x;
    person.pos.z = fixed.z;
    person.pos.y = damp(person.pos.y, this.unit.game.world.groundY(person.pos.x, person.pos.z), 12, dt);

    // animate
    person.phase += dt * (2 + person.speed * 1.7);
    const swing = Math.sin(person.phase) * clamp(person.speed / 4, 0.05, 0.6);
    person.legs[0].hip.rotation.x = swing;
    person.legs[1].hip.rotation.x = -swing;
    person.legs[0].knee.rotation.x = Math.max(0, -Math.sin(person.phase + 0.6)) * 0.6;
    person.legs[1].knee.rotation.x = Math.max(0, -Math.sin(person.phase + Math.PI + 0.6)) * 0.6;
    // gun arm out
    person.arms[1].rotation.x = lerp(person.arms[1].rotation.x, -1.35, 0.2);
    person.root.position.set(person.pos.x, person.pos.y, person.pos.z);
    person.root.rotation.y = person.heading;

    // shoot at the player
    this.fireTimer -= dt;
    if (this.fireTimer <= 0 && dist < 26 && player.alive) {
      this.fireTimer = randRange(this.unit.rng, 0.9, 2.1);
      const hitChance = clamp(1 - dist / 32, 0.08, 0.5);
      const muzzle = new THREE.Vector3(person.pos.x, person.pos.y + 1.4, person.pos.z);
      const dir = new THREE.Vector3(dx, 0.1, dz).normalize();
      this.unit.game.effects?.tracer(muzzle, muzzle.clone().add(dir.clone().multiplyScalar(18)));
      this.unit.game.audio?.gunshot(true);
      if (this.unit.rng() < hitChance) player.hurt(randRange(this.unit.rng, 6, 13));
      this.unit.game.effects?.muzzleFlash(muzzle.clone().add(dir.clone().multiplyScalar(0.6)), new THREE.Quaternion());
    }
  }
}

/**
 * The police unit: heat, stars, cruisers and officers. `update` is called every frame with the
 * player's current state; it spawns, chases and despawns so the star count is always honoured.
 */
export class Police {
  constructor(game) {
    this.game = game;
    this.rng = game.rng;
    this.heat = 0;
    this.stars = 0;
    this.cruisers = [];
    this.officers = [];
    this.lostSight = 0;
    this.spawnTimer = 0;
    this.flash = 0;
    this.lastCrime = 0;
    this.sirenLevel = 0;
    this.rngStream = this.rng;
  }

  get wanted() {
    return this.stars;
  }

  /** Any crime: add heat, and bump the stars if a threshold was crossed. */
  addHeat(amount, reason = '') {
    if (this.game.mode === 'shot' && amount > 20) return;
    const before = this.stars;
    this.heat = clamp(this.heat + amount, 0, WANTED.thresholds[WANTED.thresholds.length - 1] + 40);
    this.stars = starsFor(this.heat);
    this.lastCrime = this.game.time;
    if (this.stars > before) {
      this.game.hud?.pulseStars();
      this.game.audio?.stinger(this.stars);
      this.game.toast?.(this.stars === 1 ? 'THE HEAT IS ON' : `${this.stars} STARS`);
      this.spawnTimer = 0;
    }
  }

  clear() {
    this.heat = 0;
    this.stars = 0;
    for (const c of this.cruisers) c.car.driver = null;
    this.cruisers.length = 0;
    for (const o of this.officers) {
      this.game.scene.remove(o.person.root);
    }
    this.officers.length = 0;
  }

  /** Caught: heat and cars go, the player keeps their life. */
  reset() {
    this.clear();
    this.lostSight = 0;
  }

  /** Spawn a cruiser out of sight behind the player, on the nearest lane. */
  spawnCruiser() {
    const player = this.game.player;
    const target = player.inCar ? player.inCar.pos : player.pos;
    const dist = WANTED.spawnDist[this.stars] ?? 70;
    const heading = player.inCar ? player.inCar.heading : player.heading;
    for (let attempt = 0; attempt < 12; attempt += 1) {
      const angle = heading + Math.PI + randRange(this.rng, -1.1, 1.1);
      const x = target.x + Math.sin(angle) * dist;
      const z = target.z + Math.cos(angle) * dist;
      if (Math.abs(x) > 300 || Math.abs(z) > 300) continue;
      const lane = this.game.world.randomLanePointNear(x, z, this.rng);
      const car = this.game.fleet.addPolice(lane.x, lane.z, lane.axis === 'x' ? (lane.dir > 0 ? Math.PI / 2 : -Math.PI / 2) : (lane.dir > 0 ? 0 : Math.PI));
      car.driver = 'police';
      car.sirenOn = true;
      this.cruisers.push(new Cruiser(this, car, lane.x, lane.z, car.heading));
      return car;
    }
    return null;
  }

  /** Let two officers out of a stopped cruiser. */
  deployOfficers(cruiser) {
    const car = cruiser.car;
    if (Math.abs(car.speed) > 6) return;
    if (this.officers.length >= WANTED.officerCount[this.stars]) return;
    for (const side of [-1, 1]) {
      if (this.officers.length >= WANTED.officerCount[this.stars]) break;
      const right = car.rightVec;
      const x = car.pos.x + right.x * side * (car.wid * 0.6);
      const z = car.pos.z + right.y * side * (car.wid * 0.6);
      const rig = buildPerson(this.rng, {
        uniform: 0x1a2a4a, skin: pick(this.rng, [0xe0b48c, 0xc48a5e, 0x8d5a3b]), hair: 0x1d1712,
      });
      rig.root.position.set(x, 0, z);
      this.game.scene.add(rig.root);
      const officer = new Officer(this, rig, x, z);
      this.officers.push(officer);
      cruiser.state = 'deployed';
      this.game.audio?.shout();
    }
  }

  /** Rough line of sight: a few samples between the player and the nearest cruiser. */
  hasSight(target) {
    const world = this.game.world;
    let bestD = Infinity;
    let best = null;
    for (const c of this.cruisers) {
      const d = Math.hypot(c.car.pos.x - target.x, c.car.pos.z - target.z);
      if (d < bestD) {
        bestD = d;
        best = c;
      }
    }
    for (const o of this.officers) {
      const d = Math.hypot(o.pos.x - target.x, o.pos.z - target.z);
      if (d < bestD) bestD = d;
    }
    if (!best || bestD > WANTED.sightRange) return false;
    // sample along the line: a building in the way breaks the sight
    const steps = 6;
    for (let i = 1; i < steps; i += 1) {
      const t = i / steps;
      const x = lerp(best.car.pos.x, target.x, t);
      const z = lerp(best.car.pos.z, target.z, t);
      for (const col of world.colliders) {
        if (col.h >= 2.5 && x > col.x0 && x < col.x1 && z > col.z0 && z < col.z1) return false;
      }
    }
    return true;
  }

  update(dt) {
    const player = this.game.player;
    const target = player.inCar ? player.inCar.pos : player.pos;

    // heat decay when nobody can see you
    const sight = this.hasSight(target);
    if (!sight && this.stars > 0) this.lostSight += dt;
    else this.lostSight = Math.max(0, this.lostSight - dt * 2);
    if (this.lostSight > 6) {
      const decay = WANTED.loseRate * dt * (1 + this.lostSight * 0.1);
      this.heat = Math.max(0, this.heat - decay * 40);
      const now = starsFor(this.heat);
      if (now < this.stars) {
        this.stars = now;
        this.game.hud?.pulseStars();
        this.game.toast?.(this.stars === 0 ? 'HEAT OFF' : `${this.stars} STARS`);
        if (this.stars === 0) this.clear();
      }
    }

    // keep the cruiser count honest
    const want = WANTED.cruiserCount[this.stars] ?? 0;
    this.spawnTimer -= dt;
    if (this.cruisers.length < want && this.spawnTimer <= 0) {
      this.spawnTimer = 2.4;
      const car = this.spawnCruiser();
      if (!car && this.stars > 0) this.spawnTimer = 0.5;
    }
    if (this.cruisers.length > want) {
      const drop = this.cruisers.pop();
      drop.car.driver = null;
      drop.car.sirenOn = false;
      this.game.fleet.remove(drop.car);
    }

    // cruisers pursue; drop the ones that fall a long way behind
    for (let i = this.cruisers.length - 1; i >= 0; i -= 1) {
      const c = this.cruisers[i];
      c.update(dt, player);
      const d = Math.hypot(c.car.pos.x - target.x, c.car.pos.z - target.z);
      if (d > 260) {
        c.car.driver = null;
        this.game.fleet.remove(c.car);
        this.cruisers.splice(i, 1);
        continue;
      }
      // officers at three stars and up, once the car has stopped near the player
      if (this.stars >= 3 && d < 22 && Math.abs(c.car.speed) < 5 && c.state === 'pursue' && this.officers.length < WANTED.officerCount[this.stars]) {
        this.deployOfficers(c);
      }
      // rammed the player on foot
      if (!player.inCar && d < 4.2 && Math.abs(c.car.speed) > 4) {
        player.hurt(18);
        this.game.effects?.shake(0.5);
      }
    }

    for (let i = this.officers.length - 1; i >= 0; i -= 1) {
      const o = this.officers[i];
      o.update(dt, player);
      if (!o.alive && o.downed > 20) {
        this.game.scene.remove(o.person.root);
        this.officers.splice(i, 1);
      }
    }

    // audio + light bars follow distance
    let nearest = Infinity;
    for (const c of this.cruisers) nearest = Math.min(nearest, Math.hypot(c.car.pos.x - target.x, c.car.pos.z - target.z));
    this.sirenLevel = this.stars > 0 ? clamp(1 - nearest / 140, 0, 1) : 0;
    this.game.audio?.siren(this.sirenLevel, this.stars);
    this.flash += dt * 8;
  }

  /** Bullets aimed at police: hit the nearest cruiser or officer along the shot. */
  hitTest(origin, dir, maxDist = 60) {
    let best = null;
    let bestT = maxDist;
    for (const c of this.cruisers) {
      const dx = c.car.pos.x - origin.x;
      const dz = c.car.pos.z - origin.z;
      const t = dx * dir.x + dz * dir.z;
      if (t < 0 || t > bestT) continue;
      const perp = Math.abs(dx * dir.z - dz * dir.x);
      if (perp < 1.4) {
        best = { cruiser: c, t };
        bestT = t;
      }
    }
    for (const o of this.officers) {
      if (!o.alive) continue;
      const dx = o.pos.x - origin.x;
      const dz = o.pos.z - origin.z;
      const t = dx * dir.x + dz * dir.z;
      if (t < 0 || t > bestT) continue;
      const perp = Math.abs(dx * dir.z - dz * dir.x);
      if (perp < 0.6) {
        best = { officer: o, t };
        bestT = t;
      }
    }
    return best;
  }

  /** Shoot back at a hit marked by the player's pistol. */
  applyHit(hit, damage = 34) {
    if (!hit) return false;
    if (hit.officer) {
      hit.officer.health -= damage;
      if (hit.officer.health <= 0) {
        hit.officer.alive = false;
        hit.officer.person.alive = false;
        hit.officer.person.root.rotation.z = Math.PI / 2.1;
        this.game.effects?.blood(hit.officer.pos.x, 1, hit.officer.pos.z);
        this.addHeat(CRIME_HEAT.homicide, 'homicide');
        this.game.onKill?.('officer');
      }
      this.game.effects?.sparks(hit.officer.pos.x, 1.2, hit.officer.pos.z, 5);
      return true;
    }
    if (hit.cruiser) {
      hit.cruiser.car.damage(damage * 0.5);
      this.game.effects?.sparks(hit.cruiser.car.pos.x, 0.9, hit.cruiser.car.pos.z, 6);
      this.addHeat(6, 'gunshot');
      return true;
    }
    return false;
  }
}
