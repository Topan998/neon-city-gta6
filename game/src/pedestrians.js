// pedestrians.js — the crowd. People are the cheapest possible rig that still reads as a person:
// a head, a torso, swinging arms and legs with knees. They walk the pavements in loops, pause at
// corners, glance at passing cars, and scatter when a gun goes off or a car comes at them fast.

const THREE = window.THREE;

import {
  TAU, clamp, lerp, damp, dampAngle, mulberry32, randRange, pick, chance, standard, GeoBuilder,
} from './util.js';

const SKIN = [0xe0b48c, 0xc48a5e, 0x9a6742, 0x6b4327, 0xf0cba4];
const TOP = [0xd8d3c8, 0x2b3a4a, 0x8a3a3a, 0x3a5a3a, 0x5a4a6a, 0x2a2a2e, 0xd8a63a, 0x3a7a9a];
const BOTTOM = [0x2b3340, 0x3a3f4a, 0x4a4438, 0x6a6258, 0x22262c, 0x8a8478];
const HAIR = [0x1d1712, 0x3a2a1c, 0x6a4a2a, 0xd8c8a8, 0x8a3a1a];

/** Materials are cached by colour: forty people should not mean forty shaders. */
const matCache = new Map();
function matFor(hex, rough = 0.78) {
  const key = `${hex}:${rough}`;
  if (!matCache.has(key)) matCache.set(key, standard({ color: hex, roughness: rough, metalness: 0.04 }));
  return matCache.get(key);
}

/** Build one pedestrian rig. Origins are on the ground; every part hangs from a pivot. */
export function buildPerson(rng, opts = {}) {
  const skin = opts.skin ?? pick(rng, SKIN);
  const top = opts.top ?? pick(rng, TOP);
  const bottom = opts.bottom ?? pick(rng, BOTTOM);
  const hair = opts.hair ?? pick(rng, HAIR);
  const scale = opts.scale ?? randRange(rng, 0.92, 1.06);
  const uniform = opts.uniform ?? null;

  const root = new THREE.Group();
  const jacket = matFor(uniform ?? top, 0.7);
  const legs = matFor(uniform ? 0x22262c : bottom, 0.85);
  const skinMat = matFor(skin, 0.72);
  const hairMat = matFor(hair, 0.9);
  const shoeMat = matFor(pick(rng, [0xe6e6e6, 0x2a2a2a, 0x6a2f2f]), 0.6);

  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.52, 0.24), jacket);
  torso.position.y = 1.24;
  torso.castShadow = true;
  torso.receiveShadow = true;
  root.add(torso);

  const hips = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.18, 0.22), legs);
  hips.position.y = 0.92;
  hips.castShadow = true;
  root.add(hips);

  const head = new THREE.Group();
  head.position.y = 1.64;
  const skull = new THREE.Mesh(new THREE.BoxGeometry(0.21, 0.24, 0.22), skinMat);
  skull.castShadow = true;
  head.add(skull);
  const cap = new THREE.Mesh(new THREE.BoxGeometry(0.225, 0.09, 0.235), hairMat);
  cap.position.y = 0.1;
  cap.castShadow = true;
  head.add(cap);
  root.add(head);

  const armGeo = new THREE.BoxGeometry(0.11, 0.5, 0.12);
  const arms = [];
  for (const side of [-1, 1]) {
    const pivot = new THREE.Group();
    pivot.position.set(side * 0.25, 1.45, 0);
    const mesh = new THREE.Mesh(armGeo, jacket);
    mesh.position.y = -0.25;
    mesh.castShadow = true;
    pivot.add(mesh);
    root.add(pivot);
    arms.push(pivot);
  }

  const legGeo = new THREE.BoxGeometry(0.15, 0.46, 0.16);
  const shinGeo = new THREE.BoxGeometry(0.13, 0.44, 0.14);
  const shoeGeo = new THREE.BoxGeometry(0.14, 0.09, 0.24);
  const legsPivots = [];
  for (const side of [-1, 1]) {
    const hip = new THREE.Group();
    hip.position.set(side * 0.1, 0.9, 0);
    const thigh = new THREE.Mesh(legGeo, legs);
    thigh.position.y = -0.23;
    thigh.castShadow = true;
    hip.add(thigh);
    const knee = new THREE.Group();
    knee.position.y = -0.46;
    const shin = new THREE.Mesh(shinGeo, legs);
    shin.position.y = -0.22;
    shin.castShadow = true;
    knee.add(shin);
    const foot = new THREE.Mesh(shoeGeo, shoeMat);
    foot.position.set(0, -0.42, 0.05);
    foot.castShadow = true;
    knee.add(foot);
    hip.add(knee);
    root.add(hip);
    legsPivots.push({ hip, knee, foot });
  }

  root.scale.setScalar(scale);
  return { root, torso, head, arms, legs: legsPivots, phase: rng() * TAU };
}

/**
 * The crowd. Each pedestrian picks a pavement point, walks to it, pauses, and picks another.
 * Fleeing is a state with a timer: they sprint away from the danger and only calm down after.
 */
export class Crowd {
  constructor(game) {
    this.game = game;
    this.people = [];
    this.max = 42;
    this.rng = mulberry32(0x5eed11);
  }

  spawn(x, z, opts = {}) {
    const world = this.game.world;
    const p = world.pavementPoint(this.rng, x, z, opts.radius ?? 42);
    const rig = buildPerson(this.rng, opts);
    const person = {
      ...rig,
      pos: new THREE.Vector3(p.x, world.groundY(p.x, p.z), p.z),
      heading: this.rng() * TAU,
      speed: 0,
      walkSpeed: randRange(this.rng, 1.1, 1.75),
      state: 'walk',
      stateTimer: randRange(this.rng, 0.4, 3),
      target: null,
      fleeing: 0,
      alive: true,
      deathTimer: 0,
      fear: 0,
      glance: 0,
    };
    person.root.position.copy(person.pos);
    this.game.scene.add(person.root);
    this.people.push(person);
    if (this.people.length > this.max) this.removeOldest(person);
    return person;
  }

  removeOldest(preferred) {
    const victim = this.people.find((p) => p !== preferred && !p.near);
    if (!victim) return;
    this.game.scene.remove(victim.root);
    this.people.splice(this.people.indexOf(victim), 1);
  }

  /** A gunshot or a car horn makes everyone within earshot run. */
  scare(x, z, radius = 34, power = 1) {
    for (const p of this.people) {
      const d = Math.hypot(p.pos.x - x, p.pos.z - z);
      if (d < radius && p.alive) {
        p.fleeing = Math.max(p.fleeing, 3.4 * power);
        p.fear = 1;
        p.state = 'flee';
        p.target = null;
      }
    }
  }

  /** Nearest living pedestrian to a point — used by bullets and by the police. */
  nearest(x, z, radius = 40) {
    let best = null;
    let bestD = radius;
    for (const p of this.people) {
      if (!p.alive) continue;
      const d = Math.hypot(p.pos.x - x, p.pos.z - z);
      if (d < bestD) {
        bestD = d;
        best = p;
      }
    }
    return best ? { person: best, dist: bestD } : null;
  }

  /** Bullet hit: the person drops, the crowd runs, the police are told. */
  hit(person, fromX, fromZ) {
    if (!person.alive) return;
    person.alive = false;
    person.deathTimer = 9;
    person.state = 'down';
    person.root.rotation.z = Math.PI / 2.1;
    person.root.rotation.x = 0.1;
    person.root.position.y += 0.12;
    this.game.effects?.blood(person.pos.x, person.pos.y + 0.9, person.pos.z);
    this.game.audio?.thud();
    this.scare(person.pos.x, person.pos.z, 40, 1.2);
    this.game.police?.addHeat(this.game.config?.crime?.homicide ?? 34, 'homicide');
    this.game.onKill?.(person.rival ? 'rival' : 'civilian', person);
  }

  update(dt) {
    const world = this.game.world;
    const player = this.game.player;
    for (const p of this.people) {
      if (!p.alive) {
        p.deathTimer -= dt;
        continue;
      }
      // flee timer
      if (p.fleeing > 0) {
        p.fleeing -= dt;
        if (p.fleeing <= 0) {
          p.state = 'walk';
          p.target = null;
        }
      }
      // react to a speeding car bearing down on them
      for (const car of this.game.vehicles) {
        const dx = p.pos.x - car.pos.x;
        const dz = p.pos.z - car.pos.z;
        const d = Math.hypot(dx, dz);
        if (d < 9 && Math.abs(car.speed) > 9) {
          const fwd = car.forward;
          const closing = (dx * fwd.x + dz * fwd.y) < 0; // car is heading at them
          if (closing) {
            p.fleeing = Math.max(p.fleeing, 1.6);
            p.fear = 1;
            p.state = 'flee';
            p.fleeDir = { x: dx / (d || 1), z: dz / (d || 1) };
          }
        }
      }
      // react to the player sprinting at them with a gun out
      if (player && !player.inCar && player.aiming) {
        const d = Math.hypot(p.pos.x - player.pos.x, p.pos.z - player.pos.z);
        if (d < 14) {
          p.fleeing = Math.max(p.fleeing, 2.2);
          p.state = 'flee';
        }
      }

      if (p.state === 'flee') {
        const away = p.fleeDir ?? {
          x: p.pos.x - (player?.pos.x ?? p.pos.x + 1),
          z: p.pos.z - (player?.pos.z ?? p.pos.z + 1),
        };
        const len = Math.hypot(away.x, away.z) || 1;
        const tx = p.pos.x + (away.x / len) * 6;
        const tz = p.pos.z + (away.z / len) * 6;
        p.heading = dampAngle(p.heading, Math.atan2(tx - p.pos.x, tz - p.pos.z), 7, dt);
        p.speed = damp(p.speed, 4.6, 6, dt);
        p.pos.x += Math.sin(p.heading) * p.speed * dt;
        p.pos.z += Math.cos(p.heading) * p.speed * dt;
      } else {
        // walk to a target on the pavement, pause, choose another
        p.stateTimer -= dt;
        if (!p.target || p.state === 'pause' && p.stateTimer <= 0) {
          if (p.target) {
            p.state = 'pause';
            p.stateTimer = randRange(this.rng, 0.8, 2.6);
            p.target = null;
          } else {
            const base = p.pos;
            const angle = this.rng() * TAU;
            const radius = randRange(this.rng, 12, 46);
            let tx = base.x + Math.cos(angle) * radius;
            let tz = base.z + Math.sin(angle) * radius;
            if (world.isRoad(tx, tz)) {
              const np = world.nearestPavement(tx, tz);
              tx = np.x;
              tz = np.z;
            }
            p.target = { x: tx, z: tz };
            p.state = 'walk';
            p.stateTimer = randRange(this.rng, 4, 12);
          }
        }
        if (p.target) {
          const dx = p.target.x - p.pos.x;
          const dz = p.target.z - p.pos.z;
          const d = Math.hypot(dx, dz);
          if (d < 1.1) {
            p.target = null;
            p.speed = damp(p.speed, 0, 8, dt);
          } else {
            p.heading = dampAngle(p.heading, Math.atan2(dx, dz), 4.5, dt);
            p.speed = damp(p.speed, p.walkSpeed, 4, dt);
            p.pos.x += Math.sin(p.heading) * p.speed * dt;
            p.pos.z += Math.cos(p.heading) * p.speed * dt;
          }
        } else {
          p.speed = damp(p.speed, 0, 8, dt);
        }
      }

      // keep them out of walls and on the ground
      const fixed = world.resolveCircle(p.pos.x, p.pos.z, 0.34);
      p.pos.x = fixed.x;
      p.pos.z = fixed.z;
      p.pos.x = clamp(p.pos.x, -316, 316);
      p.pos.z = clamp(p.pos.z, -316, 316);
      p.pos.y = damp(p.pos.y, world.groundY(p.pos.x, p.pos.z), 12, dt);

      // walk cycle
      p.phase += dt * (2.2 + p.speed * 1.6);
      const swing = Math.sin(p.phase) * clamp(p.speed / 4.4, 0.06, 0.62);
      const counter = Math.sin(p.phase + Math.PI) * clamp(p.speed / 4.4, 0.06, 0.62);
      p.legs[0].hip.rotation.x = swing;
      p.legs[1].hip.rotation.x = counter;
      p.legs[0].knee.rotation.x = Math.max(0, -Math.sin(p.phase + 0.6)) * clamp(p.speed / 3, 0, 0.9);
      p.legs[1].knee.rotation.x = Math.max(0, -Math.sin(p.phase + Math.PI + 0.6)) * clamp(p.speed / 3, 0, 0.9);
      p.arms[0].rotation.x = counter * 0.75;
      p.arms[1].rotation.x = swing * 0.75;
      p.head.rotation.y = damp(p.head.rotation.y, Math.sin(this.game.time * 0.6 + p.phase * 0.1) * 0.25, 3, dt);
      p.root.position.set(p.pos.x, p.pos.y + Math.abs(Math.sin(p.phase)) * 0.02, p.pos.z);
      p.root.rotation.y = p.heading;
      p.near = player ? Math.hypot(p.pos.x - player.pos.x, p.pos.z - player.pos.z) < 120 : false;
    }

    // drop the dead after a while
    for (let i = this.people.length - 1; i >= 0; i -= 1) {
      const p = this.people[i];
      if (!p.alive && p.deathTimer <= 0) {
        this.game.scene.remove(p.root);
        this.people.splice(i, 1);
      }
    }
    // keep the crowd around the player
    if (player) this.cull(player.pos);
  }

  /** Move anyone far from the player to a pavement near him, so the street never empties. */
  cull(playerPos) {
    for (const p of this.people) {
      if (!p.alive) continue;
      const d = Math.hypot(p.pos.x - playerPos.x, p.pos.z - playerPos.z);
      if (d > 150) {
        const q = this.game.world.pavementPoint(this.rng, playerPos.x, playerPos.z, 70);
        p.pos.set(q.x, this.game.world.groundY(q.x, q.z), q.z);
        p.target = null;
      }
    }
  }
}
