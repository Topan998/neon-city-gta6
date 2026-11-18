// The crowd: a hundred and thirty people walking the pavements of the grid, each on the loop of
// one block. They are rigged the way the player is — a torso, two legs and two arms as separate
// instanced meshes — so every person in the street swings their limbs from a phase advanced by the
// ground they cover. That is six draw calls for the whole crowd instead of two, and it buys the one
// thing a still or a moving frame needs to read as people: legs that step.
//
// Each person keeps their own pace, and now and then stops for a beat at a corner before walking on.
// Panic runs the same cycle faster, so a gunshot turns strollers into a sprint. Every choice here is
// seeded (createRandom + hashUnit), so the crowd is the same crowd on every load.

import { BLOCK_HALF, PEDS, CITY, PALETTE } from './config.js';
import { blockCenter, blockAt } from './world.js';
import { mergeParts, box, ball, makeModelMaterial } from './shape.js';
import { createRandom, range, int, pick, hashUnit } from './random.js';

const TAU = Math.PI * 2;
const TROUSERS = [0x2f3b52, 0x252a36, 0x3d3550, 0x1f2a2f, 0x4a3a30, 0x2b3442, 0x6a6470];
const SKINS = [0xdda67c, 0xc98d63, 0xa9714f, 0xe8bd96, 0x8d5a3c, 0xf0c9a4];

/** A person as merged geometry: legs, torso, arms and a head, standing 1.78 m tall. */
export function buildPersonGeometry(options = {}) {
  const skin = options.skin ?? 0xdda67c;
  const hair = options.hair ?? 0x2b1d16;
  const shirt = options.shirt ?? 0xffffff;
  const trousers = options.trousers ?? 0x2f3b52;
  return mergeParts([
    box(0.17, 0.76, 0.2, -0.12, 0.38, 0, trousers),
    box(0.17, 0.76, 0.2, 0.12, 0.38, 0, trousers),
    box(0.5, 0.66, 0.28, 0, 1.09, 0, shirt),
    box(0.13, 0.56, 0.15, -0.32, 1.06, 0, skin),
    box(0.13, 0.56, 0.15, 0.32, 1.06, 0, skin),
    ball(0.155, 0, 1.56, 0, skin, 10),
    box(0.31, 0.12, 0.31, 0, 1.68, 0, hair),
  ]);
}

/** Only the head, so a crowd can be tinted by shirt without tinting every face. */
export function buildHeadGeometry() {
  return mergeParts([
    ball(0.155, 0, 1.56, 0, 0xe2ac83, 10),
    box(0.31, 0.12, 0.31, 0, 1.68, 0, 0x2b1d16),
  ]);
}

/** The torso alone: the one instanced part that is tinted by the shirt colour. */
function buildTorsoGeometry() {
  return mergeParts([
    box(0.5, 0.66, 0.28, 0, 1.09, 0, 0xffffff),
    box(0.46, 0.16, 0.26, 0, 0.76, 0, 0xd9d9d9),
  ]);
}

/** One leg, merged about the hip so the mesh can be rotated at the joint. */
function buildLegGeometry() {
  return mergeParts([
    box(0.17, 0.76, 0.2, 0, -0.38, 0, 0xffffff),
    box(0.18, 0.12, 0.3, 0, -0.76, 0.04, 0x22242c),
  ]);
}

/** One arm, merged about the shoulder. */
function buildArmGeometry() {
  return mergeParts([box(0.13, 0.56, 0.15, 0, -0.28, 0, 0xffffff)]);
}

export function createPedestrians(ctx) {
  const { scene } = ctx;
  const random = createRandom(4412);
  const bodyMaterial = makeModelMaterial();
  const headMaterial = makeModelMaterial();
  const limbMaterial = makeModelMaterial();
  const count = PEDS.count;

  const bodies = new THREE.InstancedMesh(buildTorsoGeometry(), bodyMaterial, count);
  const heads = new THREE.InstancedMesh(buildHeadGeometry(), headMaterial, count);
  const legGeometry = buildLegGeometry();
  const armGeometry = buildArmGeometry();
  const legLeft = new THREE.InstancedMesh(legGeometry, limbMaterial, count);
  const legRight = new THREE.InstancedMesh(legGeometry, limbMaterial, count);
  const armLeft = new THREE.InstancedMesh(armGeometry, limbMaterial, count);
  const armRight = new THREE.InstancedMesh(armGeometry, limbMaterial, count);
  const rig = [bodies, heads, legLeft, legRight, armLeft, armRight];
  for (const mesh of rig) {
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    scene.add(mesh);
  }
  bodies.castShadow = true;
  legLeft.castShadow = true;
  legRight.castShadow = true;
  armLeft.castShadow = true;
  armRight.castShadow = true;
  heads.castShadow = false;

  const side = (BLOCK_HALF - 2) * 2;
  const perimeter = side * 4;
  const peds = [];
  const dummy = new THREE.Object3D();
  dummy.rotation.order = 'YXZ';
  const tint = new THREE.Color();

  for (let n = 0; n < count; n += 1) {
    const bx = int(random, 0, CITY.grid - 1);
    const bz = int(random, 0, CITY.grid - 1);
    const centre = blockCenter(bx, bz);
    const ped = {
      index: n,
      x: centre.x,
      z: centre.z,
      heading: 0,
      block: centre,
      t: random() * perimeter,
      dir: random() < 0.5 ? 1 : -1,
      speed: PEDS.speed + range(random, -PEDS.speedJitter, PEDS.speedJitter),
      phase: random() * TAU,
      blend: 1,
      pause: 0,
      corners: 0,
      colour: pick(random, PALETTE.ped),
      trousers: pick(random, TROUSERS),
      skin: pick(random, SKINS),
      alive: true,
      panic: 0,
      fall: 0,
    };
    place(ped);
    peds.push(ped);
    bodies.setColorAt(n, tint.setHex(ped.colour));
    legLeft.setColorAt(n, tint.setHex(ped.trousers));
    legRight.setColorAt(n, tint.setHex(ped.trousers));
    armLeft.setColorAt(n, tint.setHex(ped.skin));
    armRight.setColorAt(n, tint.setHex(ped.skin));
  }
  for (const mesh of rig) {
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }

  /** Put a pedestrian on the pavement loop of its block. */
  function place(ped) {
    const centre = ped.block;
    const h = side / 2;
    let t = ped.t % perimeter;
    if (t < 0) t += perimeter;
    const segment = Math.floor(t / side);
    const u = t - segment * side;
    if (segment === 0) { ped.x = centre.x - h + u; ped.z = centre.z - h; ped.heading = Math.PI / 2; }
    else if (segment === 1) { ped.x = centre.x + h; ped.z = centre.z - h + u; ped.heading = 0; }
    else if (segment === 2) { ped.x = centre.x + h - u; ped.z = centre.z + h; ped.heading = -Math.PI / 2; }
    else { ped.x = centre.x - h; ped.z = centre.z + h - u; ped.heading = Math.PI; }
    if (ped.dir < 0) ped.heading += Math.PI;
  }

  /** One limb: placed at its joint, turned with the body, swung about the joint. */
  function limb(mesh, index, ped, offsetX, pivotY, groundY, bob, angle) {
    const rx = Math.cos(ped.heading) * offsetX;
    const rz = -Math.sin(ped.heading) * offsetX;
    dummy.position.set(ped.x + rx, groundY + pivotY + bob, ped.z + rz);
    dummy.rotation.set(angle, ped.heading, 0);
    dummy.scale.setScalar(1);
    dummy.updateMatrix();
    mesh.setMatrixAt(index, dummy.matrix);
  }

  function update(dt, player) {
    for (let index = 0; index < peds.length; index += 1) {
      const ped = peds[index];
      if (!ped.alive) {
        dummy.position.set(ped.x, -5, ped.z);
        dummy.scale.setScalar(0.001);
        dummy.rotation.set(0, 0, 0);
        dummy.updateMatrix();
        for (const mesh of rig) mesh.setMatrixAt(index, dummy.matrix);
        continue;
      }

      // Walk, or wait at the corner that was just reached.
      const cornerBefore = Math.floor((((ped.t % perimeter) + perimeter) % perimeter) / side);
      let moved = 0;
      if (ped.pause > 0) {
        ped.pause -= dt;
      } else {
        const stride = ped.panic > 0 ? ped.speed * 2.6 : ped.speed;
        const step = ped.dir * stride * dt;
        ped.t += step;
        moved = Math.abs(step);
        const cornerAfter = Math.floor((((ped.t % perimeter) + perimeter) % perimeter) / side);
        if (cornerAfter !== cornerBefore && hashUnit(ped.index, ped.corners) < PEDS.pauseChance) {
          ped.pause = PEDS.pauseMin + hashUnit(ped.index + 91, ped.corners) * (PEDS.pauseMax - PEDS.pauseMin);
        }
        if (cornerAfter !== cornerBefore) ped.corners += 1;
      }
      if (ped.panic > 0) ped.panic -= dt;

      place(ped);

      // The gait, driven by the metres covered this frame.
      const activity = moved > 0.0001 ? 1 : 0;
      ped.blend += (activity - ped.blend) * Math.min(1, 9 * dt);
      ped.phase += (moved / PEDS.stride) * TAU * (ped.panic > 0 ? 1.5 : 1);
      const swing = Math.sin(ped.phase) * ped.blend * PEDS.swing;
      const groundY = ctx.world.groundHeight(ped.x, ped.z);
      const bob = Math.abs(Math.sin(ped.phase)) * 0.035 * ped.blend;

      dummy.position.set(ped.x, groundY + bob, ped.z);
      dummy.rotation.set(0, ped.heading, 0);
      dummy.scale.setScalar(1);
      dummy.updateMatrix();
      bodies.setMatrixAt(index, dummy.matrix);
      heads.setMatrixAt(index, dummy.matrix);

      limb(legLeft, index, ped, -0.12, 0.78, groundY, bob, swing);
      limb(legRight, index, ped, 0.12, 0.78, groundY, bob, -swing);
      limb(armLeft, index, ped, -0.32, 1.3, groundY, bob, -swing * 0.85);
      limb(armRight, index, ped, 0.32, 1.3, groundY, bob, swing * 0.85);
    }
    for (const mesh of rig) mesh.instanceMatrix.needsUpdate = true;
  }

  /** Everyone near a noise runs. */
  function panic(x, z, radius) {
    for (const ped of peds) {
      if (!ped.alive) continue;
      if (Math.hypot(ped.x - x, ped.z - z) < radius) {
        ped.panic = 4;
        ped.dir = hashUnit(ped.index, 7) < 0.5 ? 1 : -1;
      }
    }
  }

  /** The nearest living pedestrian a ray crosses, for the pistol. */
  function raycast(origin, direction, maxDistance) {
    let best = null;
    let bestDistance = maxDistance;
    for (const ped of peds) {
      if (!ped.alive) continue;
      const ox = ped.x - origin.x;
      const oy = 1.1 - origin.y;
      const oz = ped.z - origin.z;
      const along = ox * direction.x + oy * direction.y + oz * direction.z;
      if (along < 0.4 || along > bestDistance) continue;
      const cx = origin.x + direction.x * along;
      const cy = origin.y + direction.y * along;
      const cz = origin.z + direction.z * along;
      if (Math.hypot(cx - ped.x, cy - 1.1, cz - ped.z) > 0.62) continue;
      best = { kind: 'ped', target: ped, distance: along };
      bestDistance = along;
    }
    return best;
  }

  /** Move a slice of the crowd onto one block's pavement loop: the screenshot scenes use it. */
  function focusCrowd(x, z, count2) {
    const { i, j } = blockAt(x, z);
    const centre = blockCenter(i, j);
    for (let index = 0; index < Math.min(count2, peds.length); index += 1) {
      const ped = peds[index];
      ped.block = { x: centre.x, z: centre.z };
      ped.t = (index / Math.max(1, count2)) * perimeter;
      ped.dir = index % 2 === 0 ? 1 : -1;
      ped.alive = true;
      ped.panic = 0;
      ped.pause = 0;
      ped.blend = 1;
      place(ped);
    }
  }

  function kill(ped) {
    if (!ped.alive) return false;
    ped.alive = false;
    return true;
  }

  function reviveAll() {
    for (const ped of peds) {
      ped.alive = true;
      ped.panic = 0;
    }
  }

  return {
    peds,
    update,
    panic,
    focusCrowd,
    raycast,
    kill,
    reviveAll,
    get aliveCount() { return peds.filter((ped) => ped.alive).length; },
  };
}
