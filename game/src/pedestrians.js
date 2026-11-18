// pedestrians.js — the crowd.
//
// Every pedestrian is a walker that loops the sidewalk ring of its block: a position along one of the
// four kerb lines, turning the corner at the ends, pausing now and then at a shop window. The bodies
// are drawn as eight instanced meshes (head, torso, hips, arms, forearms, thighs, shins, shoes), so a
// whole crowd of forty costs eight draw calls; each instance carries its own clothing colour.

import THREE from './three-shim.js';
import { CITY, PHYSICS, PALETTE } from './config.js';
import { TAU, clamp, lerp, damp, angleDiff, smoothstep, RNG } from './util.js';

const EDGE = CITY.lot / 2 + CITY.walk / 2; // 14: middle of the sidewalk band

const PART_DEFS = {
  head: { geo: () => new THREE.SphereGeometry(0.145, 10, 8), offsetY: 1.63 },
  torso: { geo: () => new THREE.BoxGeometry(0.46, 0.6, 0.26), offsetY: 1.14 },
  hips: { geo: () => new THREE.BoxGeometry(0.4, 0.2, 0.25), offsetY: 0.86 },
  upperArm: { geo: () => new THREE.BoxGeometry(0.115, 0.3, 0.12) },
  foreArm: { geo: () => new THREE.BoxGeometry(0.1, 0.28, 0.11) },
  thigh: { geo: () => new THREE.BoxGeometry(0.16, 0.42, 0.17) },
  shin: { geo: () => new THREE.BoxGeometry(0.14, 0.4, 0.15) },
  shoe: { geo: () => new THREE.BoxGeometry(0.16, 0.1, 0.26) },
};

export class Pedestrians {
  constructor(scene, world, rng, count) {
    this.scene = scene;
    this.world = world;
    this.rng = rng;
    this.count = count;
    this.peds = [];
    this.group = new THREE.Group();
    this.group.name = 'crowd';
    scene.add(this.group);

    this.dummy = new THREE.Object3D();
    this.matrix = new THREE.Matrix4();
    this.quat = new THREE.Quaternion();
    this.tmpQuat = new THREE.Quaternion();
    this.scaleVec = new THREE.Vector3();
    this.posVec = new THREE.Vector3();
    this.axisY = new THREE.Vector3(0, 1, 0);
    this.axisZ = new THREE.Vector3(0, 0, 1);

    this.buildInstances();
    this.spawn(count);
  }

  buildInstances() {
    const skinMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 0.66,
      metalness: 0.03,
    });
    const clothMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 0.78,
      metalness: 0.03,
    });
    const shoeMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 0.55,
      metalness: 0.12,
    });
    this.mats = { skin: skinMat, cloth: clothMat, shoe: shoeMat };

    const counts = {
      head: this.count,
      torso: this.count,
      hips: this.count,
      upperArm: this.count * 2,
      foreArm: this.count * 2,
      thigh: this.count * 2,
      shin: this.count * 2,
      shoe: this.count * 2,
    };
    this.meshes = {};
    for (const key of Object.keys(PART_DEFS)) {
      const def = PART_DEFS[key];
      const mat = key === 'head' ? skinMat : key === 'shoe' ? shoeMat : clothMat;
      const mesh = new THREE.InstancedMesh(def.geo(), mat, counts[key]);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(counts[key] * 3), 3);
      mesh.frustumCulled = false;
      this.group.add(mesh);
      this.meshes[key] = mesh;
    }
    this.headGeoOffset = PART_DEFS.head.offsetY;
  }

  spawn(count) {
    const rng = this.rng;
    for (let i = 0; i < count; i++) {
      const bi = Math.floor(rng.next() * CITY.blocks);
      const bj = Math.floor(rng.next() * CITY.blocks);
      const side = Math.floor(rng.next() * 4);
      const u = rng.range(-CITY.lot / 2, CITY.lot / 2);
      const ped = {
        bi,
        bj,
        side,
        u,
        dir: rng.chance(0.5) ? 1 : -1,
        speed: rng.range(PHYSICS.peds.walkMin, PHYSICS.peds.walkMax),
        cruise: 0,
        phase: rng.range(0, TAU),
        scale: rng.range(0.92, 1.07),
        state: 'walk',
        pause: 0,
        yaw: 0,
        x: 0,
        z: 0,
        y: CITY.curb,
        clothing: new THREE.Color(rng.pick(PALETTE.clothes)),
        skin: new THREE.Color(rng.pick(PALETTE.skin)),
        shoes: new THREE.Color(0x14161a).offsetHSL(0, 0, rng.range(-0.02, 0.05)),
        fleeTimer: 0,
        speedNow: 0,
      };
      ped.cruise = ped.speed;
      this.placePed(ped);
      this.peds.push(ped);
    }
    this.writeInstances(0);
  }

  placePed(ped) {
    const c = CITY.blockCenter(ped.bi, ped.bj);
    const u = clamp(ped.u, -CITY.lot / 2 - 2.5, CITY.lot / 2 + 2.5);
    ped.u = u;
    if (ped.side === 0) {
      ped.x = c.x + u;
      ped.z = c.z + EDGE;
      ped.yaw = ped.dir > 0 ? 0 : Math.PI;
    } else if (ped.side === 1) {
      ped.x = c.x + EDGE;
      ped.z = c.z + u;
      ped.yaw = ped.dir > 0 ? -Math.PI / 2 : Math.PI / 2;
    } else if (ped.side === 2) {
      ped.x = c.x - u;
      ped.z = c.z - EDGE;
      ped.yaw = ped.dir > 0 ? Math.PI : 0;
    } else {
      ped.x = c.x - EDGE;
      ped.z = c.z - u;
      ped.yaw = ped.dir > 0 ? Math.PI / 2 : -Math.PI / 2;
    }
    ped.y = CITY.curb;
  }

  // Walk one step along the ring; turn the corner when the block edge runs out.
  advanceRing(ped, dist) {
    ped.u += dist * ped.dir;
    const limit = CITY.lot / 2 + 2.2;
    if (ped.u > limit) {
      const over = ped.u - limit;
      ped.side = (ped.side + 1) % 4;
      ped.u = -limit + over;
      // Corner pause, half the time.
      if (this.rng.chance(0.35)) {
        ped.state = 'pause';
        ped.pause = this.rng.range(0.8, 2.6);
      }
    } else if (ped.u < -limit) {
      const over = ped.u + limit;
      ped.side = (ped.side + 3) % 4;
      ped.u = limit + over;
    }
    this.placePed(ped);
  }

  update(dt, playerCar, player, threat) {
    const peds = this.peds;
    for (let i = 0; i < peds.length; i++) {
      const ped = peds[i];

      // Panic: a car too close, or gunfire, sends them running.
      if (threat && threat.radius > 0) {
        const d = Math.hypot(ped.x - threat.x, ped.z - threat.z);
        if (d < threat.radius) {
          ped.state = 'flee';
          ped.fleeTimer = Math.max(ped.fleeTimer, 2.4);
          ped.fleeFrom = { x: threat.x, z: threat.z };
        }
      }
      if (playerCar && Math.abs(playerCar.speed) > 6) {
        const d = Math.hypot(ped.x - playerCar.x, ped.z - playerCar.z);
        if (d < 7.5) {
          ped.state = 'flee';
          ped.fleeTimer = Math.max(ped.fleeTimer, 1.8);
          ped.fleeFrom = { x: playerCar.x, z: playerCar.z };
        }
      }

      let moveSpeed = 0;
      if (ped.state === 'pause') {
        ped.pause -= dt;
        if (ped.pause <= 0) ped.state = 'walk';
      } else if (ped.state === 'flee') {
        ped.fleeTimer -= dt;
        // Run directly away from the threat, off the ring if need be.
        const from = ped.fleeFrom || { x: ped.x, z: ped.z };
        let dx = ped.x - from.x;
        let dz = ped.z - from.z;
        const d = Math.hypot(dx, dz) || 1;
        dx /= d;
        dz /= d;
        const target = Math.atan2(-dz, dx);
        ped.yaw = ped.yaw + angleDiff(ped.yaw, target) * Math.min(1, dt * 8);
        moveSpeed = PHYSICS.peds.fleeSpeed;
        ped.x += Math.cos(ped.yaw) * moveSpeed * dt;
        ped.z += -Math.sin(ped.yaw) * moveSpeed * dt;
        const push = this.world.buildingPush(ped.x, ped.z, 0.35);
        if (push) {
          ped.x += push.x;
          ped.z += push.z;
        }
        if (ped.fleeTimer <= 0) {
          const spot = this.world.nearestSidewalkPoint(ped.x, ped.z);
          ped.x = spot.x;
          ped.z = spot.z;
          // Re-anchor to the nearest block and side.
          const c = this.world.nearestSidewalkPoint(ped.x, ped.z);
          const bi = clamp(Math.round((c.x - CITY.origin) / CITY.pitch), 0, CITY.blocks - 1);
          const bj = clamp(Math.round((c.z - CITY.origin) / CITY.pitch), 0, CITY.blocks - 1);
          const bc = CITY.blockCenter(bi, bj);
          const lx = c.x - bc.x;
          const lz = c.z - bc.z;
          ped.bi = bi;
          ped.bj = bj;
          if (Math.abs(lz) > Math.abs(lx)) {
            ped.side = lz > 0 ? 0 : 2;
            ped.u = lz > 0 ? lx : -lx;
          } else {
            ped.side = lx > 0 ? 1 : 3;
            ped.u = lx > 0 ? lz : -lz;
          }
          ped.dir = this.rng.chance(0.5) ? 1 : -1;
          ped.state = 'walk';
          this.placePed(ped);
        }
      } else {
        moveSpeed = ped.cruise * (ped.dir > 0 ? 1 : 1);
        this.advanceRing(ped, moveSpeed * dt);
      }

      ped.speedNow = damp(ped.speedNow, moveSpeed, 8, dt);
      ped.phase += (ped.speedNow / 1.4) * dt * TAU;

      // Keep the walker out of the player's body if they meet head-on.
      if (player && !player.inCar && player.alive) {
        const dx = ped.x - player.x;
        const dz = ped.z - player.z;
        const d = Math.hypot(dx, dz);
        if (d < 0.9 && d > 1e-4) {
          ped.x += (dx / d) * (0.9 - d) * 0.6;
          ped.z += (dz / d) * (0.9 - d) * 0.6;
        }
      }
    }
    this.writeInstances(dt);
  }

  // Write every part of every pedestrian into the instanced meshes.
  writeInstances(dt) {
    const meshes = this.meshes;
    const peds = this.peds;
    const m = this.matrix;
    const q = this.quat;
    const tq = this.tmpQuat;
    const s = this.scaleVec;
    const p = this.posVec;

    // instance counters per part
    let ih = 0;
    let it = 0;
    let ip = 0;
    let ia = 0;
    let ifo = 0;
    let ith = 0;
    let ish = 0;
    let iso = 0;

    for (let i = 0; i < peds.length; i++) {
      const ped = peds[i];
      const sc = ped.scale;
      const yaw = ped.yaw;
      const cos = Math.cos(yaw);
      const sin = Math.sin(yaw);
      const swing = clamp(ped.speedNow / 2, 0, 1) * (ped.state === 'flee' ? 0.85 : 0.42);
      const ph = ped.phase;
      const baseY = ped.y;

      // local -> world helper (x forward, y up, z right)
      const toWorld = (lx, ly, lz) => {
        p.set(ped.x + (lx * cos + lz * sin) * sc, baseY + ly * sc, ped.z + (-lx * sin + lz * cos) * sc);
      };
      const rot = (pitch, roll = 0) => {
        q.setFromAxisAngle(this.axisY, yaw);
        tq.setFromAxisAngle(this.axisZ, pitch);
        q.multiply(tq);
        if (roll) {
          tq.setFromAxisAngle(new THREE.Vector3(1, 0, 0), roll);
          q.multiply(tq);
        }
      };

      s.set(sc, sc, sc);

      // Hips and torso.
      const bob = Math.abs(Math.sin(ph)) * 0.018 * (ped.speedNow > 0.2 ? 1 : 0);
      toWorld(0, 0.86 + bob, 0);
      rot(0);
      m.compose(p, q, s);
      meshes.hips.setMatrixAt(ip++, m);
      meshes.hips.setColorAt(ip - 1, ped.clothing);

      toWorld(Math.sin(ph * 0.5) * 0.01, 1.16 + bob, 0);
      rot(0.06 + clamp(ped.speedNow / 5, 0, 1) * 0.12);
      m.compose(p, q, s);
      meshes.torso.setMatrixAt(it++, m);
      meshes.torso.setColorAt(it - 1, ped.clothing);

      // Head.
      toWorld(0, 1.62 + bob, 0);
      rot(0);
      m.compose(p, q, s);
      meshes.head.setMatrixAt(ih++, m);
      meshes.head.setColorAt(ih - 1, ped.skin);

      for (const side of [-1, 1]) {
        // Arms counter-swing the legs.
        const aPh = ph + (side > 0 ? 0 : Math.PI);
        const armSwing = Math.sin(aPh) * swing * 0.8;
        const shoulderY = 1.42 + bob;
        const shoulderZ = side * 0.28;
        // Upper arm: pivot at the shoulder, centre half a bone down.
        const upperLen = 0.3;
        const ux = Math.sin(armSwing) * upperLen * 0.5;
        const uy = -Math.cos(armSwing) * upperLen * 0.5;
        toWorld(ux, shoulderY + uy, shoulderZ);
        rot(armSwing, side * 0.04);
        m.compose(p, q, s);
        meshes.upperArm.setMatrixAt(ia++, m);
        meshes.upperArm.setColorAt(ia - 1, ped.clothing);

        // Forearm hangs from the elbow, bent a little more at speed.
        const elbowX = Math.sin(armSwing) * upperLen;
        const elbowY = shoulderY - Math.cos(armSwing) * upperLen;
        const foreAngle = armSwing * 0.55 - 0.2 - swing * 0.3;
        const fLen = 0.28;
        const fx = elbowX + Math.sin(foreAngle) * fLen * 0.5;
        const fy = elbowY - Math.cos(foreAngle) * fLen * 0.5;
        toWorld(fx, fy, shoulderZ);
        rot(foreAngle, side * 0.04);
        m.compose(p, q, s);
        meshes.foreArm.setMatrixAt(ifo++, m);
        meshes.foreArm.setColorAt(ifo - 1, ped.clothing);

        // Legs.
        const lPh = ph + (side > 0 ? Math.PI : 0);
        const legSwing = Math.sin(lPh) * swing * 1.05;
        const hipY = 0.84 + bob;
        const hipZ = side * 0.12;
        const thighLen = 0.42;
        const tx = Math.sin(legSwing) * thighLen * 0.5;
        const ty = -Math.cos(legSwing) * thighLen * 0.5;
        toWorld(tx, hipY + ty, hipZ);
        rot(legSwing);
        m.compose(p, q, s);
        meshes.thigh.setMatrixAt(ith++, m);
        meshes.thigh.setColorAt(ith - 1, ped.clothing);

        const kneeX = Math.sin(legSwing) * thighLen;
        const kneeY = hipY - Math.cos(legSwing) * thighLen;
        // Knee bends on the backswing only.
        const bend = Math.max(0, -Math.cos(lPh)) * 0.7;
        const shinAngle = legSwing - bend;
        const shinLen = 0.4;
        const sx = kneeX + Math.sin(shinAngle) * shinLen * 0.5;
        const sy = kneeY - Math.cos(shinAngle) * shinLen * 0.5;
        toWorld(sx, sy, hipZ);
        rot(shinAngle);
        m.compose(p, q, s);
        meshes.shin.setMatrixAt(ish++, m);
        meshes.shin.setColorAt(ish - 1, ped.clothing);

        const footX = kneeX + Math.sin(shinAngle) * shinLen;
        const footY = kneeY - Math.cos(shinAngle) * shinLen;
        toWorld(footX + 0.05, footY + 0.05, hipZ);
        rot(shinAngle * 0.4);
        m.compose(p, q, s);
        meshes.shoe.setMatrixAt(iso++, m);
        meshes.shoe.setColorAt(iso - 1, ped.shoes);
      }
    }

    for (const key of Object.keys(meshes)) {
      const mesh = meshes[key];
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
  }

  nearest(x, z, maxDist = 999) {
    let best = null;
    let bestD = maxDist * maxDist;
    for (const ped of this.peds) {
      const dx = ped.x - x;
      const dz = ped.z - z;
      const d = dx * dx + dz * dz;
      if (d < bestD) {
        bestD = d;
        best = ped;
      }
    }
    return best;
  }

  // Gunfire: everyone within earshot scatters.
  alarm(x, z, radius = 26) {
    for (const ped of this.peds) {
      if (Math.hypot(ped.x - x, ped.z - z) < radius) {
        ped.state = 'flee';
        ped.fleeTimer = 3.2;
        ped.fleeFrom = { x, z };
      }
    }
  }
}
