// The crowd: a hundred and thirty people walking the pavements of the grid, each on the loop of
// one block. They are two InstancedMeshes — one tinted body each, one shared head — so the whole
// crowd is two draw calls, and they duck and scatter when a gun goes off nearby.

import { BLOCK_HALF, PEDS, CITY, PALETTE } from './config.js';
import { blockCenter, blockAt } from './world.js';
import { mergeParts, box, ball, makeModelMaterial } from './shape.js';
import { createRandom, range, int, pick } from './random.js';

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

export function createPedestrians(ctx) {
  const { scene } = ctx;
  const random = createRandom(4412);
  const bodyMaterial = makeModelMaterial();
  const headMaterial = makeModelMaterial();
  const bodies = new THREE.InstancedMesh(buildPersonGeometry(), bodyMaterial, PEDS.count);
  const heads = new THREE.InstancedMesh(buildHeadGeometry(), headMaterial, PEDS.count);
  bodies.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  heads.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  bodies.castShadow = true;
  heads.castShadow = false;
  scene.add(bodies);
  scene.add(heads);

  const side = (BLOCK_HALF - 2) * 2;
  const perimeter = side * 4;
  const peds = [];
  const dummy = new THREE.Object3D();
  const tint = new THREE.Color();

  for (let n = 0; n < PEDS.count; n += 1) {
    const bx = int(random, 0, CITY.grid - 1);
    const bz = int(random, 0, CITY.grid - 1);
    const centre = blockCenter(bx, bz);
    const ped = {
      x: centre.x,
      z: centre.z,
      heading: 0,
      block: centre,
      t: random() * perimeter,
      dir: random() < 0.5 ? 1 : -1,
      speed: PEDS.speed + range(random, -PEDS.speedJitter, PEDS.speedJitter),
      phase: random() * Math.PI * 2,
      colour: pick(random, PALETTE.ped),
      alive: true,
      panic: 0,
      fall: 0,
    };
    place(ped);
    peds.push(ped);
    bodies.setColorAt(n, tint.setHex(ped.colour));
  }
  if (bodies.instanceColor) bodies.instanceColor.needsUpdate = true;

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

  function update(dt, player) {
    for (let index = 0; index < peds.length; index += 1) {
      const ped = peds[index];
      if (!ped.alive) {
        dummy.position.set(ped.x, -5, ped.z);
        dummy.scale.setScalar(0.001);
        dummy.updateMatrix();
        bodies.setMatrixAt(index, dummy.matrix);
        heads.setMatrixAt(index, dummy.matrix);
        continue;
      }
      if (ped.panic > 0) {
        ped.panic -= dt;
        ped.t += ped.dir * ped.speed * 2.6 * dt;
      } else {
        ped.t += ped.dir * ped.speed * dt;
      }
      place(ped);
      ped.phase += dt * (ped.panic > 0 ? 12 : 5.2);
      const bob = Math.abs(Math.sin(ped.phase)) * 0.055;
      dummy.position.set(ped.x, ctx.world.groundHeight(ped.x, ped.z) + bob, ped.z);
      dummy.rotation.set(0, ped.heading, 0);
      dummy.scale.setScalar(1);
      dummy.updateMatrix();
      bodies.setMatrixAt(index, dummy.matrix);
      heads.setMatrixAt(index, dummy.matrix);
    }
    bodies.instanceMatrix.needsUpdate = true;
    heads.instanceMatrix.needsUpdate = true;
  }

  /** Everyone near a noise runs. */
  function panic(x, z, radius) {
    for (const ped of peds) {
      if (!ped.alive) continue;
      if (Math.hypot(ped.x - x, ped.z - z) < radius) {
        ped.panic = 4;
        ped.dir = Math.random() < 0.5 ? 1 : -1;
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
  function focusCrowd(x, z, count) {
    const { i, j } = blockAt(x, z);
    const centre = blockCenter(i, j);
    for (let index = 0; index < Math.min(count, peds.length); index += 1) {
      const ped = peds[index];
      ped.block = { x: centre.x, z: centre.z };
      ped.t = (index / Math.max(1, count)) * perimeter;
      ped.dir = index % 2 === 0 ? 1 : -1;
      ped.alive = true;
      ped.panic = 0;
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
