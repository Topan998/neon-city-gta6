// world.js — the city itself.
//
// Eight by eight blocks: a 12 m carriageway on every grid line, a 4 m sidewalk on each side, a 24 m
// lot in the middle. Buildings are generated as merged, world-UV-mapped facade geometry (so a window
// is always the same size in metres no matter how tall the tower), with rooftops, awnings, neon,
// palms, lamp posts, traffic lights and street furniture. Only the queries the rest of the game needs
// are exported: block centres, road lines, building bounds, sidewalk points and the light phases.

import THREE from './three-shim.js';
import { CITY, PALETTE, PHYSICS } from './config.js';
import {
  TAU,
  clamp,
  lerp,
  asphaltTexture,
  sidewalkTexture,
  facadeTexture,
  roofTexture,
  signTexture,
  shopTexture,
  radialTexture,
} from './util.js';

const TILE_W = 12; // metres of facade covered by one texture tile
const TILE_H = 11;

// A batch of flat quads (lane paint, crosswalks, road streaks) merged into one geometry.
class QuadBatch {
  constructor() {
    this.pos = [];
    this.nrm = [];
    this.uv = [];
    this.idx = [];
    this.n = 0;
  }
  rect(cx, cz, w, d, y, uScale = 4) {
    const hw = w / 2;
    const hd = d / 2;
    const b = this.n;
    this.pos.push(
      cx - hw, y, cz - hd,
      cx + hw, y, cz - hd,
      cx + hw, y, cz + hd,
      cx - hw, y, cz + hd,
    );
    for (let i = 0; i < 4; i++) this.nrm.push(0, 1, 0);
    this.uv.push(0, 0, w / uScale, 0, w / uScale, d / uScale, 0, d / uScale);
    this.idx.push(b, b + 2, b + 1, b, b + 3, b + 2);
    this.n += 4;
  }
  geometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nrm, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setIndex(this.idx);
    g.computeBoundingSphere();
    return g;
  }
}

// Facade walls for one material style, with UVs measured in metres.
class FacadeBatch {
  constructor(tileW = TILE_W, tileH = TILE_H) {
    this.pos = [];
    this.nrm = [];
    this.uv = [];
    this.idx = [];
    this.n = 0;
    this.tileW = tileW;
    this.tileH = tileH;
  }
  wall(ax, az, bx, bz, y0, y1, cx, cz) {
    let dx = bx - ax;
    let dz = bz - az;
    let len = Math.hypot(dx, dz);
    if (len < 1e-4) return;
    // Outward normal is (-dz, 0, dx); flip the wall if it points at the building centre.
    let nx = -dz / len;
    let nz = dx / len;
    const mx = (ax + bx) / 2 - cx;
    const mz = (az + bz) / 2 - cz;
    if (nx * mx + nz * mz < 0) {
      const tx = ax;
      const tz = az;
      ax = bx;
      az = bz;
      bx = tx;
      bz = tz;
      dx = -dx;
      dz = -dz;
      nx = -nx;
      nz = -nz;
      len = len;
    }
    const h = y1 - y0;
    const b = this.n;
    this.pos.push(ax, y0, az, bx, y0, bz, bx, y1, bz, ax, y1, az);
    for (let i = 0; i < 4; i++) this.nrm.push(nx, 0, nz);
    const u = len / this.tileW;
    const v = h / this.tileH;
    this.uv.push(0, 0, u, 0, u, v, 0, v);
    this.idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
    this.n += 4;
  }
  box(cx, cz, w, d, y0, y1) {
    const hw = w / 2;
    const hd = d / 2;
    this.wall(cx - hw, cz - hd, cx + hw, cz - hd, y0, y1, cx, cz);
    this.wall(cx + hw, cz - hd, cx + hw, cz + hd, y0, y1, cx, cz);
    this.wall(cx + hw, cz + hd, cx - hw, cz + hd, y0, y1, cx, cz);
    this.wall(cx - hw, cz + hd, cx - hw, cz - hd, y0, y1, cx, cz);
  }
  geometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nrm, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setIndex(this.idx);
    g.computeBoundingSphere();
    return g;
  }
}

const STYLES = ['concrete', 'brick', 'panel', 'glass', 'concrete', 'glass'];

export class World {
  constructor(scene, rng) {
    this.scene = scene;
    this.rng = rng;
    this.group = new THREE.Group();
    this.group.name = 'city';
    scene.add(this.group);

    this.buildings = []; // {x, z, hw, hd, h, top}
    this.blockPlates = [];
    this.roadLines = [];
    this.intersections = [];
    this.signs = [];
    this.time = 0;
    this.tod = 'day';

    this.materials = {};
    this.lightPhaseDirty = true;
    this.lampPools = null;

    this.build();
  }

  // ---------------------------------------------------------------- geometry

  build() {
    const rng = this.rng;
    this.buildMaterials(rng);
    this.buildGround(rng);
    this.buildSidewalks();
    this.buildMarkings();
    this.buildBlocks(rng);
    this.buildSkyline(rng);
    this.buildStreetFurniture(rng);
    this.buildTrafficLights();
    this.buildNeon(rng);
  }

  buildMaterials(rng) {
    const m = this.materials;

    this.asphaltTex = asphaltTexture(rng);
    this.asphaltTex.repeat.set(64, 64);
    m.asphalt = new THREE.MeshStandardMaterial({
      map: this.asphaltTex,
      color: 0xb9bcc4,
      roughness: 0.93,
      metalness: 0.06,
      envMapIntensity: 0.35,
    });

    this.walkTex = sidewalkTexture(rng);
    this.walkTex.repeat.set(22, 22);
    m.sidewalk = new THREE.MeshStandardMaterial({
      map: this.walkTex,
      color: 0xcdc8be,
      roughness: 0.88,
      metalness: 0.03,
      envMapIntensity: 0.3,
    });

    m.curb = new THREE.MeshStandardMaterial({ color: PALETTE.curb, roughness: 0.8, metalness: 0.05 });
    m.lot = new THREE.MeshStandardMaterial({ color: 0x6d6a66, roughness: 0.95, metalness: 0.02 });
    m.roof = new THREE.MeshStandardMaterial({
      map: roofTexture(rng),
      color: 0x9c9a94,
      roughness: 0.95,
      metalness: 0.05,
    });

    m.paintWhite = new THREE.MeshStandardMaterial({
      color: 0xe8e6dc,
      roughness: 0.55,
      metalness: 0.0,
      polygonOffset: true,
      polygonOffsetFactor: -4,
    });
    m.paintYellow = new THREE.MeshStandardMaterial({
      color: 0xd9b34a,
      roughness: 0.55,
      metalness: 0.0,
      polygonOffset: true,
      polygonOffsetFactor: -4,
    });

    m.facades = [];
    this.facadeMats = [];
    for (const style of STYLES) {
      const tex = facadeTexture(rng, style);
      const mat = new THREE.MeshStandardMaterial({
        map: tex.map,
        emissiveMap: tex.emissive,
        emissive: 0xffffff,
        emissiveIntensity: 0,
        roughness: style === 'glass' ? 0.28 : 0.82,
        metalness: style === 'glass' ? 0.55 : 0.08,
        envMapIntensity: style === 'glass' ? 0.85 : 0.25,
      });
      mat.userData.glow = style === 'glass' ? 1.15 : 1;
      m.facades.push(mat);
      this.facadeMats.push(mat);
    }
    this.facadeBatches = STYLES.map(() => new FacadeBatch());
    this.roofBatch = new QuadBatch();

    // Ground-floor shopfronts: one material, one merged mesh for the whole city.
    const shopTex = shopTexture(rng);
    this.shopBatch = new FacadeBatch(9, 3.4);
    m.shop = new THREE.MeshStandardMaterial({
      map: shopTex.map,
      emissiveMap: shopTex.emissive,
      emissive: 0xffffff,
      emissiveIntensity: 0.4,
      roughness: 0.22,
      metalness: 0.35,
    });
    this.shopMat = m.shop;

    m.metal = new THREE.MeshStandardMaterial({ color: 0x3a3d42, roughness: 0.5, metalness: 0.7 });
    m.darkMetal = new THREE.MeshStandardMaterial({ color: 0x22252a, roughness: 0.62, metalness: 0.6 });
    m.lampHead = new THREE.MeshStandardMaterial({
      color: 0x2a2d31,
      emissive: 0xffcf8a,
      emissiveIntensity: 0,
      roughness: 0.5,
      metalness: 0.5,
    });
    this.lampHeadMat = m.lampHead;

    m.pool = new THREE.MeshBasicMaterial({
      map: radialTexture(128, 'rgba(255,214,150,0.9)', 'rgba(255,180,90,0)'),
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      fog: true,
    });
    this.poolMat = m.pool;

    m.awning = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.7, metalness: 0.05 });
    m.trunk = new THREE.MeshStandardMaterial({ color: 0x6b5a44, roughness: 0.9, metalness: 0.02 });
    m.frond = new THREE.MeshStandardMaterial({
      color: 0x3f6b3a,
      roughness: 0.78,
      metalness: 0.02,
      side: THREE.DoubleSide,
    });
    m.hydrant = new THREE.MeshStandardMaterial({ color: 0xa8342c, roughness: 0.55, metalness: 0.25 });
    m.bin = new THREE.MeshStandardMaterial({ color: 0x3c4a3e, roughness: 0.75, metalness: 0.2 });
    m.glassProp = new THREE.MeshStandardMaterial({
      color: 0x9fc4cc,
      roughness: 0.15,
      metalness: 0.35,
      transparent: true,
      opacity: 0.32,
    });
    this.bulbMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    m.bulb = this.bulbMat;
  }

  buildGround(rng) {
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(CITY.ground, CITY.ground, 1, 1),
      this.materials.asphalt,
    );
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    this.group.add(ground);
    this.ground = ground;
  }

  buildSidewalks() {
    const plate = CITY.lot + CITY.walk * 2; // 32
    const geo = new THREE.BoxGeometry(plate, CITY.curb, plate);
    const count = CITY.blocks * CITY.blocks;
    const inst = new THREE.InstancedMesh(geo, this.materials.sidewalk, count);
    inst.receiveShadow = true;
    inst.castShadow = true;
    const mat4 = new THREE.Matrix4();
    let n = 0;
    for (let j = 0; j < CITY.blocks; j++) {
      for (let i = 0; i < CITY.blocks; i++) {
        const c = CITY.blockCenter(i, j);
        mat4.makeTranslation(c.x, CITY.curb / 2, c.z);
        inst.setMatrixAt(n++, mat4);
        this.blockPlates.push({ i, j, x: c.x, z: c.z });
      }
    }
    inst.instanceMatrix.needsUpdate = true;
    this.group.add(inst);
    this.sidewalkMesh = inst;

    // A slightly darker plaza fills the lot between the buildings and the kerb.
    const lotGeo = new THREE.BoxGeometry(CITY.lot, 0.06, CITY.lot);
    const lotInst = new THREE.InstancedMesh(lotGeo, this.materials.lot, count);
    lotInst.receiveShadow = true;
    n = 0;
    for (const b of this.blockPlates) {
      mat4.makeTranslation(b.x, CITY.curb + 0.02, b.z);
      lotInst.setMatrixAt(n++, mat4);
    }
    lotInst.instanceMatrix.needsUpdate = true;
    this.group.add(lotInst);
  }

  buildMarkings() {
    const white = new QuadBatch();
    const yellow = new QuadBatch();
    const half = CITY.half;
    const segStart = CITY.road / 2 + CITY.walk; // 10: where the paint may start

    for (let k = 0; k <= CITY.blocks; k++) {
      const line = CITY.roadLine(k);
      this.roadLines.push({ axis: 'x', coord: line, index: k });
      this.roadLines.push({ axis: 'z', coord: line, index: k });
    }

    for (let k = 0; k <= CITY.blocks; k++) {
      const line = CITY.roadLine(k);
      for (let s = 0; s < CITY.blocks; s++) {
        const a = CITY.roadLine(s) + segStart;
        const b = CITY.roadLine(s + 1) - segStart;
        const mid = (a + b) / 2;
        const len = b - a;

        // Double yellow down the middle of every street.
        yellow.rect(mid, line - 0.2, len, 0.15, 0.021);
        yellow.rect(mid, line + 0.2, len, 0.15, 0.021);
        // White edge lines.
        white.rect(mid, line - 5.55, len, 0.12, 0.02);
        white.rect(mid, line + 5.55, len, 0.12, 0.02);

        // Dashed lane divider, two per direction.
        for (let d = a + 1.5; d < b - 2; d += 8) {
          white.rect(d, line - 2.9, 3.2, 0.11, 0.02);
          white.rect(d, line + 2.9, 3.2, 0.11, 0.02);
        }

        // The same, rotated for the north-south streets.
        yellow.rect(line - 0.2, mid, 0.15, len, 0.021);
        yellow.rect(line + 0.2, mid, 0.15, len, 0.021);
        white.rect(line - 5.55, mid, 0.12, len, 0.02);
        white.rect(line + 5.55, mid, 0.12, len, 0.02);
        for (let d = a + 1.5; d < b - 2; d += 8) {
          white.rect(line - 2.9, d, 0.11, 3.2, 0.02);
          white.rect(line + 2.9, d, 0.11, 3.2, 0.02);
        }
      }
    }

    // Crosswalks and stop bars at every intersection.
    for (let j = 0; j <= CITY.blocks; j++) {
      for (let i = 0; i <= CITY.blocks; i++) {
        const x = CITY.roadLine(i);
        const z = CITY.roadLine(j);
        this.intersections.push({ i, j, x, z });

        // Stripes run along the direction of travel; four sides.
        for (let s = 0; s < 9; s++) {
          const off = -5.2 + s * 1.3;
          white.rect(x + off, z + 7.4, 0.62, 2.7, 0.022);
          white.rect(x + off, z - 7.4, 0.62, 2.7, 0.022);
          white.rect(x + 7.4, z + off, 2.7, 0.62, 0.022);
          white.rect(x - 7.4, z + off, 2.7, 0.62, 0.022);
        }
        // Stop bars just outside the crosswalk.
        white.rect(x + 3, z + 9.2, 6, 0.42, 0.022);
        white.rect(x - 3, z - 9.2, 6, 0.42, 0.022);
        white.rect(x + 9.2, z - 3, 0.42, 6, 0.022);
        white.rect(x - 9.2, z + 3, 0.42, 6, 0.022);
      }
    }

    const whiteMesh = new THREE.Mesh(white.geometry(), this.materials.paintWhite);
    whiteMesh.receiveShadow = true;
    whiteMesh.position.y = 0;
    this.group.add(whiteMesh);

    const yellowMesh = new THREE.Mesh(yellow.geometry(), this.materials.paintYellow);
    yellowMesh.receiveShadow = true;
    this.group.add(yellowMesh);
    this.markings = [whiteMesh, yellowMesh];
  }

  // One block: choose a layout, then stack setbacks on each footprint.
  buildBlocks(rng) {
    const maxDist = CITY.half * 1.1;

    for (let j = 0; j < CITY.blocks; j++) {
      for (let i = 0; i < CITY.blocks; i++) {
        const c = CITY.blockCenter(i, j);
        const dist = Math.hypot(c.x, c.z);
        const downtown = clamp(1 - dist / maxDist, 0, 1);
        const style = STYLES[Math.floor(rng.next() * STYLES.length)];
        const styleIndex = STYLES.indexOf(style);
        const batch = this.facadeBatches[styleIndex];
        const lotHalf = CITY.lot / 2 - 1.2; // 10.8

        const layout = rng.next();
        const footprints = [];
        if (layout < 0.4) {
          // A single tower with a plaza on one side.
          const w = rng.range(13, 20);
          const d = rng.range(13, 20);
          const ox = rng.range(-1.2, 1.2) * (lotHalf - w / 2);
          const oz = rng.range(-1.2, 1.2) * (lotHalf - d / 2);
          footprints.push({ x: c.x + ox, z: c.z + oz, w, d });
        } else if (layout < 0.72) {
          // Two buildings split across the lot.
          const along = rng.chance(0.5);
          const gap = rng.range(2.2, 4);
          if (along) {
            const w1 = (CITY.lot - gap) / 2 - 1;
            footprints.push({ x: c.x - (w1 / 2 + gap / 2), z: c.z, w: w1, d: rng.range(14, 19.5) });
            footprints.push({ x: c.x + (w1 / 2 + gap / 2), z: c.z, w: w1, d: rng.range(14, 19.5) });
          } else {
            const d1 = (CITY.lot - gap) / 2 - 1;
            footprints.push({ x: c.x, z: c.z - (d1 / 2 + gap / 2), w: rng.range(14, 19.5), d: d1 });
            footprints.push({ x: c.x, z: c.z + (d1 / 2 + gap / 2), w: rng.range(14, 19.5), d: d1 });
          }
        } else {
          // Four low shops around a courtyard.
          const s = rng.range(8.4, 10.2);
          const off = s / 2 + 0.7;
          for (const sx of [-1, 1]) {
            for (const sz of [-1, 1]) {
              footprints.push({ x: c.x + sx * off, z: c.z + sz * off, w: s, d: s });
            }
          }
        }

        for (const f of footprints) {
          const base = lerp(7, 40, Math.pow(downtown, 1.6)) * rng.range(0.62, 1.35);
          const h = clamp(base + (layout > 0.72 ? -6 : 0), 7, 62);
          this.addBuilding(batch, f.x, f.z, f.w, f.d, h, downtown, style);
        }
      }
    }

    for (let s = 0; s < this.facadeBatches.length; s++) {
      const geo = this.facadeBatches[s].geometry();
      if (!geo.attributes.position || geo.attributes.position.count === 0) continue;
      const mesh = new THREE.Mesh(geo, this.materials.facades[s]);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      this.group.add(mesh);
    }

    const roofGeo = this.roofBatch.geometry();
    if (roofGeo.attributes.position && roofGeo.attributes.position.count > 0) {
      const roofs = new THREE.Mesh(roofGeo, this.materials.roof);
      roofs.receiveShadow = true;
      this.group.add(roofs);
    }

    const shopGeo = this.shopBatch.geometry();
    if (shopGeo.attributes.position && shopGeo.attributes.position.count > 0) {
      const shops = new THREE.Mesh(shopGeo, this.materials.shop);
      shops.castShadow = true;
      shops.receiveShadow = true;
      this.group.add(shops);
    }

    this.addRooftopProps();
  }

  addBuilding(batch, x, z, w, d, h, downtown, style) {
    const rng = this.rng;
    const sections = h > 22 ? (rng.chance(0.55) ? 3 : 2) : 1;
    let y = 0;
    let cw = w;
    let cd = d;
    let remaining = h;
    for (let s = 0; s < sections; s++) {
      const share = s === sections - 1 ? remaining : remaining * rng.range(0.55, 0.78);
      const sy = y + share - 0.001;
      batch.box(x, z, cw, cd, y, sy);
      this.roofBatch.rect(x, z, cw, cd, sy + 0.006, 6);
      y = sy;
      remaining -= share;
      // Setback for the next section.
      cw = Math.max(5, cw - rng.range(1.6, 3.4));
      cd = Math.max(5, cd - rng.range(1.6, 3.4));
    }
    const hw = w / 2;
    const hd = d / 2;
    this.buildings.push({ x, z, hw, hd, h, top: h, style });

    // The shop band wraps the base of every building, just proud of the facade.
    this.shopBatch.box(x, z, w + 0.07, d + 0.07, 0.04, 3.25);

    // Ground-floor shopfront band: a darker plinth, cheaper than a second facade map.
    if (downtown > -1 && rng.chance(0.55)) {
      const awningColor = PALETTE.neon[Math.floor(rng.next() * PALETTE.neon.length)];
      this.addAwning(x, z, w, d, awningColor);
    }
  }

  addAwning(x, z, w, d, color) {
    const rng = this.rng;
    if (!this.awningMesh) {
      const geo = new THREE.BoxGeometry(1, 1, 1);
      const count = 300;
      this.awningMesh = new THREE.InstancedMesh(geo, this.materials.awning, count);
      this.awningMesh.castShadow = true;
      this.awningMesh.receiveShadow = true;
      this.awningMesh.count = 0;
      this.awningMesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(count * 3), 3);
      this.group.add(this.awningMesh);
      this.awningPos = [];
    }
    if (this.awningMesh.count >= 300) return;
    const side = Math.floor(rng.next() * 4);
    const width = Math.min(w, d) * 0.55;
    const t = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const pos = new THREE.Vector3();
    const scl = new THREE.Vector3();
    const yaw = [0, Math.PI / 2, Math.PI, -Math.PI / 2][side];
    const ox = [0, w / 2 + 0.75, 0, -w / 2 - 0.75][side];
    const oz = [d / 2 + 0.75, 0, -d / 2 - 0.75, 0][side];
    pos.set(x + ox, 2.9, z + oz);
    scl.set(width, 0.22, 1.5);
    q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
    t.compose(pos, q, scl);
    const idx = this.awningMesh.count++;
    this.awningMesh.setMatrixAt(idx, t);
    this.awningMesh.setColorAt(idx, new THREE.Color(color).multiplyScalar(0.55));
    this.awningMesh.instanceMatrix.needsUpdate = true;
    if (this.awningMesh.instanceColor) this.awningMesh.instanceColor.needsUpdate = true;
  }

  addRooftopProps() {
    const rng = this.rng;
    const chosen = this.buildings.filter((b) => b.h > 12 && rng.chance(0.55));
    if (!chosen.length) return;

    const boxGeo = new THREE.BoxGeometry(1, 1, 1);
    const boxes = new THREE.InstancedMesh(boxGeo, this.materials.darkMetal, chosen.length * 2);
    boxes.castShadow = true;
    boxes.receiveShadow = true;
    let n = 0;
    const t = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const p = new THREE.Vector3();
    const s = new THREE.Vector3();

    const tankGeo = new THREE.CylinderGeometry(1, 1, 1, 12);
    const tankMat = new THREE.MeshStandardMaterial({ color: 0x7d6a52, roughness: 0.85, metalness: 0.25 });
    const tanks = new THREE.InstancedMesh(tankGeo, tankMat, Math.max(1, Math.floor(chosen.length * 0.7)));
    tanks.castShadow = true;
    let tn = 0;

    for (const b of chosen) {
      const top = b.h;
      // Stair head / plant box.
      p.set(b.x + rng.range(-2, 2) * 0.4, top + 1.1, b.z + rng.range(-2, 2) * 0.4);
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rng.chance(0.5) ? 0 : Math.PI / 2);
      s.set(rng.range(2.4, 4.2), 2.2, rng.range(2.2, 3.6));
      t.compose(p, q, s);
      boxes.setMatrixAt(n++, t);

      if (rng.chance(0.6)) {
        p.set(b.x + rng.range(-3, 3), top + 0.9, b.z + rng.range(-3, 3));
        s.set(rng.range(1.1, 1.7), 1.8, rng.range(1.1, 1.7));
        q.identity();
        t.compose(p, q, s);
        boxes.setMatrixAt(n++, t);
      }

      if (rng.chance(0.45) && tn < tanks.count) {
        p.set(b.x + rng.range(-3.5, 3.5), top + 2.1, b.z + rng.range(-3.5, 3.5));
        s.set(1.5, 3.4, 1.5);
        q.identity();
        t.compose(p, q, s);
        tanks.setMatrixAt(tn++, t);
      }
    }
    boxes.count = n;
    tanks.count = tn;
    boxes.instanceMatrix.needsUpdate = true;
    tanks.instanceMatrix.needsUpdate = true;
    this.group.add(boxes);
    this.group.add(tanks);
  }

  buildSkyline(rng) {
    // A low-detail ring of towers past the city edge, faded by the fog.
    const count = 88;
    const geo = new THREE.BoxGeometry(1, 1, 1);
    const tex = facadeTexture(rng, 'glass');
    const mat = new THREE.MeshStandardMaterial({
      map: tex.map,
      emissiveMap: tex.emissive,
      emissive: 0x9fc4e8,
      emissiveIntensity: 0.4,
      roughness: 0.6,
      metalness: 0.4,
      color: 0x8892a4,
    });
    this.skylineMat = mat;
    const inst = new THREE.InstancedMesh(geo, mat, count);
    const t = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const p = new THREE.Vector3();
    const s = new THREE.Vector3();
    for (let i = 0; i < count; i++) {
      const a = (i / count) * TAU + rng.range(-0.03, 0.03);
      const r = rng.range(250, 430);
      const hgt = rng.range(28, 120);
      p.set(Math.cos(a) * r, hgt / 2, Math.sin(a) * r);
      s.set(rng.range(18, 42), hgt, rng.range(18, 42));
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rng.range(0, TAU));
      t.compose(p, q, s);
      inst.setMatrixAt(i, t);
    }
    inst.instanceMatrix.needsUpdate = true;
    this.group.add(inst);
  }

  buildStreetFurniture(rng) {
    const poles = [];
    const heads = [];
    const pools = [];

    for (const line of this.roadLines) {
      for (let s = 0; s < CITY.blocks; s++) {
        const a = CITY.roadLine(s) + 12;
        const b = CITY.roadLine(s + 1) - 12;
        for (let d = a; d <= b; d += 22) {
          for (const side of [-1, 1]) {
            const off = side * 7.4;
            let x;
            let z;
            let rot = 0;
            if (line.axis === 'x') {
              x = d;
              z = line.coord + off;
              rot = side > 0 ? 0 : Math.PI;
            } else {
              x = line.coord + off;
              z = d;
              rot = side > 0 ? Math.PI / 2 : -Math.PI / 2;
            }
            poles.push({ x, z, rot });
            heads.push({ x, z, rot });
            pools.push({ x, z });
          }
        }
      }
    }

    const poleGeo = new THREE.CylinderGeometry(0.085, 0.11, 6.4, 6);
    const poleInst = new THREE.InstancedMesh(poleGeo, this.materials.metal, poles.length);
    poleInst.castShadow = true;
    const headGeo = new THREE.BoxGeometry(1.15, 0.2, 0.5);
    const headInst = new THREE.InstancedMesh(headGeo, this.materials.lampHead, heads.length);
    const poolGeo = new THREE.PlaneGeometry(9, 9);
    const poolInst = new THREE.InstancedMesh(poolGeo, this.materials.pool, pools.length);
    poolInst.rotation.x = 0; // per-instance rotation below

    const t = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const p = new THREE.Vector3();
    const s = new THREE.Vector3(1, 1, 1);
    const up = new THREE.Vector3(0, 1, 0);

    for (let i = 0; i < poles.length; i++) {
      const { x, z, rot } = poles[i];
      p.set(x, 3.2, z);
      q.setFromAxisAngle(up, 0);
      t.compose(p, q, s);
      poleInst.setMatrixAt(i, t);

      // Head hangs over the kerb on a short arm.
      const armX = Math.sin(rot) * 0.55;
      const armZ = Math.cos(rot) * 0.55;
      p.set(x + armX, 6.28, z + armZ);
      q.setFromAxisAngle(up, rot);
      t.compose(p, q, s);
      headInst.setMatrixAt(i, t);

      p.set(x + armX * 1.6, CITY.curb + 0.03, z + armZ * 1.6);
      q.setFromEuler(new THREE.Euler(-Math.PI / 2, 0, 0));
      t.compose(p, q, new THREE.Vector3(1, 1, 1));
      poolInst.setMatrixAt(i, t);
    }
    poleInst.instanceMatrix.needsUpdate = true;
    headInst.instanceMatrix.needsUpdate = true;
    poolInst.instanceMatrix.needsUpdate = true;
    poolInst.castShadow = false;
    poolInst.receiveShadow = false;
    this.group.add(poleInst);
    this.group.add(headInst);
    this.group.add(poolInst);
    this.lampPools = poolInst;
    this.lampHeadInst = headInst;

    // Palms along the sidewalks, two per block side.
    const palms = [];
    for (const block of this.blockPlates) {
      for (let side = 0; side < 4; side++) {
        if (!rng.chance(0.7)) continue;
        const along = rng.range(-10, 10);
        const edge = CITY.lot / 2 + 1.5;
        const yaw = (side * Math.PI) / 2;
        const ox = [0, edge, 0, -edge][side];
        const oz = [edge, 0, -edge, 0][side];
        const rot = [0, Math.PI / 2, Math.PI, -Math.PI / 2][side];
        palms.push({
          x: block.x + ox + (side % 2 === 0 ? along : 0),
          z: block.z + oz + (side % 2 === 0 ? 0 : along),
          rot,
          h: rng.range(5.4, 8.6),
          lean: rng.range(-0.09, 0.09),
          yaw,
        });
      }
    }
    const trunkGeo = new THREE.CylinderGeometry(0.16, 0.3, 1, 7);
    const trunkInst = new THREE.InstancedMesh(trunkGeo, this.materials.trunk, palms.length);
    trunkInst.castShadow = true;
    const frondGeo = this.makePalmCrown();
    const frondInst = new THREE.InstancedMesh(frondGeo, this.materials.frond, palms.length);
    frondInst.castShadow = true;
    for (let i = 0; i < palms.length; i++) {
      const pl = palms[i];
      p.set(pl.x, pl.h / 2 + CITY.curb, pl.z);
      q.setFromEuler(new THREE.Euler(pl.lean, pl.yaw, 0));
      t.compose(p, q, new THREE.Vector3(1, pl.h, 1));
      trunkInst.setMatrixAt(i, t);
      p.set(pl.x + pl.lean * pl.h * 0.6, pl.h + CITY.curb, pl.z);
      q.setFromEuler(new THREE.Euler(0, pl.yaw, 0));
      const sc = pl.h / 7;
      t.compose(p, q, new THREE.Vector3(sc, sc, sc));
      frondInst.setMatrixAt(i, t);
    }
    trunkInst.instanceMatrix.needsUpdate = true;
    frondInst.instanceMatrix.needsUpdate = true;
    this.group.add(trunkInst);
    this.group.add(frondInst);

    // Hydrants, bins and bus stops, all instanced.
    const hyd = [];
    const bins = [];
    for (const block of this.blockPlates) {
      if (rng.chance(0.45)) hyd.push({ x: block.x + rng.range(-13, 13), z: block.z + 13.2 });
      if (rng.chance(0.5)) bins.push({ x: block.x + 12.6, z: block.z + rng.range(-12, 12) });
      if (rng.chance(0.35)) bins.push({ x: block.x + rng.range(-12, 12), z: block.z - 12.6 });
    }
    const hydGeo = new THREE.CylinderGeometry(0.24, 0.3, 0.86, 8);
    const hydInst = new THREE.InstancedMesh(hydGeo, this.materials.hydrant, hyd.length);
    hydInst.castShadow = true;
    for (let i = 0; i < hyd.length; i++) {
      p.set(hyd[i].x, 0.43 + CITY.curb, hyd[i].z);
      q.identity();
      t.compose(p, q, new THREE.Vector3(1, 1, 1));
      hydInst.setMatrixAt(i, t);
    }
    hydInst.instanceMatrix.needsUpdate = true;
    this.group.add(hydInst);

    const binGeo = new THREE.BoxGeometry(0.8, 1.05, 0.8);
    const binInst = new THREE.InstancedMesh(binGeo, this.materials.bin, bins.length);
    binInst.castShadow = true;
    for (let i = 0; i < bins.length; i++) {
      p.set(bins[i].x, 0.53 + CITY.curb, bins[i].z);
      q.setFromAxisAngle(up, rng.range(0, TAU));
      t.compose(p, q, new THREE.Vector3(1, 1, 1));
      binInst.setMatrixAt(i, t);
    }
    binInst.instanceMatrix.needsUpdate = true;
    this.group.add(binInst);
  }

  makePalmCrown() {
    // Seven bent leaves merged into one small geometry, so a whole crown is a single instance.
    const geos = [];
    for (let i = 0; i < 7; i++) {
      const shape = new THREE.PlaneGeometry(2.9, 0.72, 6, 1);
      const pos = shape.attributes.position;
      for (let v = 0; v < pos.count; v++) {
        const x = pos.getX(v);
        const t = (x + 1.45) / 2.9;
        pos.setY(v, pos.getY(v) * (1 - t * 0.55) - t * t * 1.5);
        pos.setZ(v, pos.getZ(v) + Math.sin(t * Math.PI) * 0.12);
      }
      shape.computeVertexNormals();
      shape.rotateX(-Math.PI / 2 + 0.18);
      shape.rotateY((i / 7) * TAU);
      shape.translate(0.9, 0, 0);
      shape.rotateY(0);
      geos.push(shape);
    }
    // Merge by hand: the seven leaves share one material and one transform.
    const merged = new THREE.BufferGeometry();
    let total = 0;
    let idxTotal = 0;
    for (const g of geos) {
      total += g.attributes.position.count;
      idxTotal += g.index ? g.index.count : 0;
    }
    const pos = new Float32Array(total * 3);
    const nrm = new Float32Array(total * 3);
    const uv = new Float32Array(total * 2);
    const idx = new Uint16Array(idxTotal);
    let vo = 0;
    let io = 0;
    for (const g of geos) {
      pos.set(g.attributes.position.array, vo * 3);
      nrm.set(g.attributes.normal.array, vo * 3);
      uv.set(g.attributes.uv.array, vo * 2);
      const gi = g.index.array;
      for (let k = 0; k < gi.length; k++) idx[io + k] = gi[k] + vo;
      vo += g.attributes.position.count;
      io += gi.length;
      g.dispose();
    }
    merged.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    merged.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
    merged.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    merged.setIndex(new THREE.BufferAttribute(idx, 1));
    merged.computeBoundingSphere();
    return merged;
  }

  buildTrafficLights() {
    // One head per approach at every other intersection, to keep the draw count sane.
    const heads = [];
    for (const node of this.intersections) {
      if ((node.i + node.j) % 2 === 1) continue;
      heads.push({ x: node.x + 6.8, z: node.z + 8.2, axis: 'x', node });
      heads.push({ x: node.x - 8.2, z: node.z - 6.8, axis: 'z', node });
    }
    const poleGeo = new THREE.CylinderGeometry(0.09, 0.11, 3.6, 6);
    const poles = new THREE.InstancedMesh(poleGeo, this.materials.metal, heads.length);
    poles.castShadow = true;
    const boxGeo = new THREE.BoxGeometry(0.42, 1.15, 0.34);
    const boxes = new THREE.InstancedMesh(boxGeo, this.materials.darkMetal, heads.length);
    boxes.castShadow = true;
    const bulbGeo = new THREE.SphereGeometry(0.115, 8, 6);
    this.trafficBulbs = new THREE.InstancedMesh(bulbGeo, this.bulbMat, heads.length * 3);
    this.trafficBulbs.instanceColor = new THREE.InstancedBufferAttribute(
      new Float32Array(heads.length * 3 * 3),
      3,
    );

    const t = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const p = new THREE.Vector3();
    const one = new THREE.Vector3(1, 1, 1);
    const up = new THREE.Vector3(0, 1, 0);
    const red = new THREE.Color(0xff2d24);
    const amber = new THREE.Color(0x2a2118);
    const green = new THREE.Color(0x22ff7a);
    const off = new THREE.Color(0x14161a);

    this.trafficHeads = heads;
    for (let i = 0; i < heads.length; i++) {
      const h = heads[i];
      const yaw = h.axis === 'x' ? Math.PI : 0;
      p.set(h.x, 1.8 + CITY.curb, h.z);
      q.identity();
      t.compose(p, q, one);
      poles.setMatrixAt(i, t);

      p.set(h.x, 3.9 + CITY.curb, h.z);
      q.setFromAxisAngle(up, yaw);
      t.compose(p, q, one);
      boxes.setMatrixAt(i, t);

      for (let s = 0; s < 3; s++) {
        p.set(h.x, 4.28 - s * 0.36 + CITY.curb, h.z + (h.axis === 'x' ? -0.2 : 0.2));
        q.identity();
        t.compose(p, q, one);
        this.trafficBulbs.setMatrixAt(i * 3 + s, t);
        this.trafficBulbs.setColorAt(i * 3 + s, s === 0 ? red : s === 1 ? amber : green);
      }
      // Start with everything dark; update() lights the right lamp.
      this.trafficBulbs.setColorAt(i * 3, off);
      this.trafficBulbs.setColorAt(i * 3 + 1, off);
      this.trafficBulbs.setColorAt(i * 3 + 2, off);
    }
    poles.instanceMatrix.needsUpdate = true;
    boxes.instanceMatrix.needsUpdate = true;
    this.trafficBulbs.instanceMatrix.needsUpdate = true;
    this.trafficBulbs.instanceColor.needsUpdate = true;
    this.group.add(poles);
    this.group.add(boxes);
    this.group.add(this.trafficBulbs);
  }

  buildNeon(rng) {
    const words = ['VICE', 'MOTEL', 'LIQUOR', 'PAWN', '24H', 'CLUB', 'TACOS', 'SEA VIEW', 'GARAGE', 'NOIR'];
    const signs = [];
    for (const block of this.blockPlates) {
      const n = 1 + Math.floor(rng.next() * 2.4);
      for (let s = 0; s < n; s++) {
        const side = Math.floor(rng.next() * 4);
        const edge = CITY.lot / 2 + 0.35;
        const along = rng.range(-9, 9);
        const ax = side % 2 === 0 ? along : 0;
        const az = side % 2 === 0 ? 0 : along;
        const ox = [0, edge, 0, -edge][side];
        const oz = [edge, 0, -edge, 0][side];
        const yaw = [0, Math.PI / 2, Math.PI, -Math.PI / 2][side];
        signs.push({
          x: block.x + ox + ax,
          z: block.z + oz + az,
          yaw,
          word: words[Math.floor(rng.next() * words.length)],
          color: PALETTE.neon[Math.floor(rng.next() * PALETTE.neon.length)],
          y: rng.range(4.2, 8.5),
          w: rng.range(3.6, 6.4),
          out: side,
        });
      }
    }

    this.signMats = [];
    for (const s of signs) {
      const hex = '#' + s.color.toString(16).padStart(6, '0');
      const tex = signTexture(s.word, hex, 256);
      const mat = new THREE.MeshStandardMaterial({
        map: tex,
        emissiveMap: tex,
        emissive: 0xffffff,
        emissiveIntensity: 0.4,
        roughness: 0.6,
        metalness: 0.1,
        transparent: false,
      });
      const geo = new THREE.PlaneGeometry(s.w, s.w * 0.5);
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(s.x, s.y, s.z);
      mesh.rotation.y = s.yaw;
      this.group.add(mesh);
      this.signMats.push(mat);

      // A bloom card over the tube itself, so the sign reads as light, not paint.
      const haloMat = new THREE.SpriteMaterial({
        map: radialTexture(128, `rgba(255,255,255,0.85)`, 'rgba(255,255,255,0)'),
        color: s.color,
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      });
      const halo = new THREE.Sprite(haloMat);
      halo.scale.set(s.w * 1.8, s.w * 1.1, 1);
      halo.position.set(s.x, s.y, s.z);
      this.group.add(halo);
      (this.signHalos ||= []).push(haloMat);

      // Wet-road reflection: a stretched additive smear on the asphalt below the sign.
      const rmat = new THREE.MeshBasicMaterial({
        color: s.color,
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        map: radialTexture(128, 'rgba(255,255,255,0.9)', 'rgba(255,255,255,0)'),
      });
      const rgeo = new THREE.PlaneGeometry(s.w * 1.1, s.w * 6.0);
      const refl = new THREE.Mesh(rgeo, rmat);
      // Out on the carriageway, where a wet road would actually catch the sign.
      const outX = Math.sin(s.yaw);
      const outZ = Math.cos(s.yaw);
      refl.position.set(s.x + outX * 8.0, 0.045, s.z + outZ * 8.0);
      refl.rotation.set(-Math.PI / 2, 0, -s.yaw);
      this.group.add(refl);
      (this.neonReflections ||= []).push({ mat: rmat, mesh: refl });
      this.signs.push(s);
    }
  }

  // ------------------------------------------------------------------ state

  setTimeOfDay(name, preset) {
    this.tod = name;
    const glow = preset.windowGlow;
    for (const mat of this.facadeMats) {
      mat.emissiveIntensity = glow * (mat.userData.glow || 1);
    }
    for (const mat of this.signMats) mat.emissiveIntensity = 0.25 + preset.neonGlow * 0.85;
    if (this.signHalos) for (const mat of this.signHalos) mat.opacity = clamp(preset.neonGlow * 0.4, 0, 0.9);
    this.shopMat.emissiveIntensity = 0.2 + glow * 0.95;
    this.skylineMat.emissiveIntensity = 0.1 + glow * 0.5;
    this.lampHeadMat.emissiveIntensity = preset.lampGlow * 1.5;
    this.poolMat.opacity = preset.lampGlow * 0.85;
    const wet = preset.wet;
    this.materials.asphalt.roughness = lerp(0.93, 0.26, wet);
    this.materials.asphalt.metalness = lerp(0.04, 0.5, wet);
    this.materials.asphalt.envMapIntensity = lerp(0.3, 1.15, wet);
    this.materials.asphalt.color.setHex(wet > 0.6 ? 0x8d919c : 0xb9bcc4);
    this.materials.sidewalk.roughness = lerp(0.88, 0.52, wet);
    if (this.neonReflections) {
      for (const r of this.neonReflections) r.mat.opacity = preset.neonGlow * 0.5 * (0.45 + wet);
    }
    this.lightPhaseDirty = true;
  }

  update(dt, time) {
    this.time = time;
    // Traffic light phase: 14 s cycle, alternating axes.
    const cycle = 14;
    const phase = ((time + 1.7) % cycle) / cycle;
    const axisX = phase < 0.44;
    const axisZ = phase > 0.5 && phase < 0.94;
    const xState = axisX ? 1 : phase > 0.44 && phase < 0.5 ? 0 : 2; // green / amber / red
    const zState = axisZ ? 1 : phase > 0.94 ? 0 : 2;
    if (this._xState !== xState || this._zState !== zState) {
      this._xState = xState;
      this._zState = zState;
      this.applyLightState(xState, zState);
    }
  }

  applyLightState(xState, zState) {
    const bulbs = this.trafficBulbs;
    if (!bulbs) return;
    const colors = [0xffb23a, 0x36ff86, 0xff3226]; // amber, green, red
    const off = new THREE.Color(0x101216);
    const c = new THREE.Color();
    for (let i = 0; i < this.trafficHeads.length; i++) {
      const h = this.trafficHeads[i];
      const state = h.axis === 'x' ? xState : zState;
      const lit = state === 0 ? 0 : state === 1 ? 1 : 2;
      for (let s = 0; s < 3; s++) {
        if (s === lit) {
          c.setHex(colors[s]).multiplyScalar(1);
          bulbs.setColorAt(i * 3 + s, c);
        } else {
          bulbs.setColorAt(i * 3 + s, off);
        }
      }
    }
    bulbs.instanceColor.needsUpdate = true;
  }

  // The light a car must obey at the intersection it is approaching.
  isGreen(axis, x, z) {
    const i = clamp(Math.round((x - CITY.roadLine(0)) / CITY.pitch), 0, CITY.blocks);
    const j = clamp(Math.round((z - CITY.roadLine(0)) / CITY.pitch), 0, CITY.blocks);
    const idx = (i * 7 + j * 13) % 3;
    const t = this.time + idx * 0.9;
    const phase = ((t + 1.7) % 14) / 14;
    if (axis === 'x') return phase < 0.47;
    return phase > 0.5 && phase < 0.97;
  }

  // ---------------------------------------------------------------- queries

  roadLineAt(index) {
    return CITY.roadLine(index);
  }

  blockCenter(i, j) {
    return CITY.blockCenter(clamp(i, 0, CITY.blocks - 1), clamp(j, 0, CITY.blocks - 1));
  }

  isRoad(x, z) {
    // On the carriageway if close to any grid line, in either axis.
    const nearestX = Math.round((x - CITY.roadLine(0)) / CITY.pitch);
    const nearestZ = Math.round((z - CITY.roadLine(0)) / CITY.pitch);
    const dx = Math.abs(x - CITY.roadLine(clamp(nearestX, 0, CITY.blocks)));
    const dz = Math.abs(z - CITY.roadLine(clamp(nearestZ, 0, CITY.blocks)));
    return dx <= CITY.road / 2 || dz <= CITY.road / 2;
  }

  groundHeight(x, z) {
    if (this.isRoad(x, z)) return 0;
    return CITY.curb;
  }

  // The point on the nearest sidewalk band. Used for pedestrian spawns and for placing the player
  // when they step out of a car.
  nearestSidewalkPoint(x, z) {
    const i = clamp(Math.round((x - CITY.origin) / CITY.pitch), 0, CITY.blocks - 1);
    const j = clamp(Math.round((z - CITY.origin) / CITY.pitch), 0, CITY.blocks - 1);
    const c = CITY.blockCenter(i, j);
    const lx = x - c.x;
    const lz = z - c.z;
    const band = CITY.lot / 2 + CITY.walk / 2; // 14
    const outer = CITY.lot / 2 + CITY.walk; // 16
    // Nearest edge of the block: push the point into the sidewalk band.
    const ax = Math.abs(lx);
    const az = Math.abs(lz);
    let nx = lx;
    let nz = lz;
    if (ax / outer > az / outer) {
      nx = Math.sign(lx || 1) * clamp(ax, CITY.lot / 2 + 0.6, outer - 0.6);
      nz = clamp(lz, -outer + 0.6, outer - 0.6);
    } else {
      nz = Math.sign(lz || 1) * clamp(az, CITY.lot / 2 + 0.6, outer - 0.6);
      nx = clamp(lx, -outer + 0.6, outer - 0.6);
    }
    if (Math.abs(nx) < band && Math.abs(nz) < band) nz = Math.sign(lz || 1) * band;
    return { x: c.x + nx, z: c.z + nz };
  }

  randomSidewalkPoint(rng) {
    const i = Math.floor(rng.next() * CITY.blocks);
    const j = Math.floor(rng.next() * CITY.blocks);
    const c = CITY.blockCenter(i, j);
    const side = Math.floor(rng.next() * 4);
    const edge = CITY.lot / 2 + CITY.walk / 2 + rng.range(-1.2, 1.2);
    const along = rng.range(-CITY.lot / 2 - 2, CITY.lot / 2 + 2);
    if (side === 0) return { x: c.x + along, z: c.z + edge };
    if (side === 1) return { x: c.x + edge, z: c.z + along };
    if (side === 2) return { x: c.x + along, z: c.z - edge };
    return { x: c.x - edge, z: c.z + along };
  }

  // Circle vs building AABBs. Returns a push vector or null.
  buildingPush(x, z, r) {
    let hit = null;
    for (let i = 0; i < this.buildings.length; i++) {
      const b = this.buildings[i];
      const dx = x - b.x;
      const dz = z - b.z;
      if (Math.abs(dx) > b.hw + r || Math.abs(dz) > b.hd + r) continue;
      const overlapX = b.hw + r - Math.abs(dx);
      const overlapZ = b.hd + r - Math.abs(dz);
      if (overlapX <= 0 || overlapZ <= 0) continue;
      if (overlapX < overlapZ) {
        hit = { x: (dx < 0 ? -1 : 1) * overlapX, z: 0 };
      } else {
        hit = { x: 0, z: (dz < 0 ? -1 : 1) * overlapZ };
      }
      return hit;
    }
    return hit;
  }

  insideBuilding(x, z) {
    for (let i = 0; i < this.buildings.length; i++) {
      const b = this.buildings[i];
      if (Math.abs(x - b.x) < b.hw - 0.1 && Math.abs(z - b.z) < b.hd - 0.1) return true;
    }
    return false;
  }

  // Keep anything that walks or drives inside the paved frame.
  clampToCity(p, margin = 6) {
    const lim = CITY.half - margin;
    p.x = clamp(p.x, -lim, lim);
    p.z = clamp(p.z, -lim, lim);
    return p;
  }
}

export function createWorld(scene, rng) {
  return new World(scene, rng);
}
