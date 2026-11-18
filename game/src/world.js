// The city: a procedural grid of eight streets by eight, pastel blocks with lit windows, sidewalks,
// palms, street lamps and neon, under a gradient sky that turns from noon to midnight. Everything
// static is an InstancedMesh, so the whole city costs a handful of draw calls.
//
// The block grid is the contract the rest of the game uses: `blockCenter` and `roadLine` place
// traffic, pedestrians, police and mission markers on the same streets the buildings stand beside.

import { CITY, HALF, ROAD_HALF, BLOCK_HALF, LOT_HALF, BOUNDS, PALETTE } from './config.js';
import { createRandom, range, int, pick } from './random.js';
import { mergeParts } from './shape.js';

/** The centre of block (i, j): blocks sit between the streets, not on them. */
export function blockCenter(i, j) {
  return { x: (i + 0.5) * CITY.cell - HALF, z: (j + 0.5) * CITY.cell - HALF };
}

/** The x (or z) of street number k, k from 0 to grid. */
export function roadLine(k) {
  return k * CITY.cell - HALF;
}

/** Which block a world position is over, clamped into the grid. */
export function blockAt(x, z) {
  const i = Math.max(0, Math.min(CITY.grid - 1, Math.floor((x + HALF) / CITY.cell)));
  const j = Math.max(0, Math.min(CITY.grid - 1, Math.floor((z + HALF) / CITY.cell)));
  return { i, j };
}

function makeAsphaltTexture() {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const g = canvas.getContext('2d');
  g.fillStyle = '#4e5259';
  g.fillRect(0, 0, size, size);
  for (let i = 0; i < 5200; i += 1) {
    const v = 46 + Math.floor(Math.random() * 54);
    g.fillStyle = `rgba(${v},${v + 1},${v + 7},${0.2 + Math.random() * 0.5})`;
    g.fillRect(Math.random() * size, Math.random() * size, 1 + Math.random() * 2, 1 + Math.random() * 2);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(110, 110);
  texture.anisotropy = 4;
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function makePavingTexture() {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const g = canvas.getContext('2d');
  g.fillStyle = '#928a7b';
  g.fillRect(0, 0, size, size);
  for (let i = 0; i < 1400; i += 1) {
    const v = 120 + Math.floor(Math.random() * 50);
    g.fillStyle = `rgba(${v},${v - 6},${v - 16},${0.22})`;
    g.fillRect(Math.random() * size, Math.random() * size, 2, 2);
  }
  g.strokeStyle = 'rgba(96, 88, 78, 0.5)';
  g.lineWidth = 2;
  for (let i = 0; i <= 4; i += 1) {
    const p = (i / 4) * size;
    g.beginPath();
    g.moveTo(p, 0);
    g.lineTo(p, size);
    g.stroke();
    g.beginPath();
    g.moveTo(0, p);
    g.lineTo(size, p);
    g.stroke();
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/**
 * The window pattern every building shares. It is injected into a Lambert material so the whole
 * skyline is one instanced draw call: windows on the street-facing walls, none on the roof, a band
 * of shopfront glass at street level and warm light in the windows after dark.
 */
function makeFacadeMaterial(nightUniform) {
  const material = new THREE.MeshLambertMaterial({ color: 0xffffff });
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uNight = nightUniform;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWorldPos;\nvarying vec3 vWorldNormal;')
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        vec4 facadePos = vec4(transformed, 1.0);
        vec3 facadeNormal = objectNormal;
        #ifdef USE_INSTANCING
          facadePos = instanceMatrix * facadePos;
          facadeNormal = mat3(instanceMatrix) * facadeNormal;
        #endif
        facadePos = modelMatrix * facadePos;
        vWorldPos = facadePos.xyz;
        vWorldNormal = normalize(mat3(modelMatrix) * facadeNormal);`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        '#include <common>\nvarying vec3 vWorldPos;\nvarying vec3 vWorldNormal;\nuniform float uNight;',
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        vec3 facadeN = normalize(vWorldNormal);
        float winLit = 0.0;
        if (abs(facadeN.y) < 0.5) {
          vec2 wall = abs(facadeN.x) > 0.5 ? vec2(vWorldPos.z, vWorldPos.y) : vec2(vWorldPos.x, vWorldPos.y);
          float shop = 1.0 - step(4.6, wall.y);
          vec2 bay = mix(vec2(3.1, 3.6), vec2(3.6, 4.4), shop);
          vec2 cell = floor(wall / bay);
          vec2 f = fract(wall / bay);
          float frame = step(0.16, f.x) * step(f.x, 0.84) * step(0.2, f.y) * step(f.y, 0.86);
          float seed = fract(sin(dot(cell, vec2(41.73, 289.31))) * 43758.5453);
          winLit = frame * step(0.34, seed);
          diffuseColor.rgb *= mix(1.0, 0.74, frame * 0.9);
          vec3 glassDay = vec3(0.40, 0.54, 0.66);
          diffuseColor.rgb = mix(diffuseColor.rgb, glassDay, frame * (1.0 - uNight) * 0.6);
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.10, 0.13, 0.19), frame * uNight * 0.5);
        } else {
          diffuseColor.rgb *= 0.66;
        }`,
      )
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
        totalEmissiveRadiance += vec3(1.0, 0.82, 0.52) * winLit * uNight * 2.1;`,
      );
  };
  material.customProgramCacheKey = () => 'neon-facade';
  return material;
}

/** Palm parts: a ringed trunk and nine fronds, merged into one geometry below. */
function palmParts() {
  const parts = [];
  const trunkColor = 0x9d7d59;
  const leafColor = 0x4f9350;
  for (let i = 0; i < 5; i += 1) {
    parts.push({
      geo: new THREE.CylinderGeometry(0.19 - i * 0.012, 0.24 - i * 0.012, 1.1, 6),
      matrix: new THREE.Matrix4().setPosition(Math.sin(i * 0.6) * 0.09, 0.55 + i * 1.02, 0),
      color: trunkColor,
    });
  }
  for (let i = 0; i < 9; i += 1) {
    const angle = (i / 9) * Math.PI * 2;
    const tilt = 0.5 + (i % 3) * 0.12;
    const matrix = new THREE.Matrix4();
    const quat = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, angle, tilt, 'YXZ'));
    matrix.makeRotationFromQuaternion(quat);
    matrix.setPosition(Math.cos(angle) * 1.15, 5.25 - (i % 2) * 0.18, Math.sin(angle) * 1.15);
    parts.push({ geo: new THREE.BoxGeometry(2.7, 0.07, 0.55), matrix, color: i % 2 ? leafColor : 0x60a95c });
  }
  return parts;
}

export function createWorld(scene) {
  const random = createRandom(CITY.seed);
  const nightUniform = { value: 0 };
  const colliders = [];
  const blocks = [];
  const buildings = [];
  const streetLines = [];

  for (let k = 0; k <= CITY.grid; k += 1) streetLines.push(roadLine(k));

  // ---- sky dome, sun and fill light ----
  const skyUniforms = {
    topColor: { value: new THREE.Color(PALETTE.skyTopDay) },
    bottomColor: { value: new THREE.Color(PALETTE.skyBottomDay) },
    sunColor: { value: new THREE.Color(0xfff5e0) },
    sunDir: { value: new THREE.Vector3(0.55, 0.62, 0.4).normalize() },
  };
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(1400, 24, 16),
    new THREE.ShaderMaterial({
      uniforms: skyUniforms,
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      vertexShader: `varying vec3 vDir;
        void main() {
          vDir = normalize(position);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: `uniform vec3 topColor; uniform vec3 bottomColor; uniform vec3 sunColor; uniform vec3 sunDir;
        varying vec3 vDir;
        void main() {
          vec3 dir = normalize(vDir);
          float height = smoothstep(-0.02, 0.28, dir.y);
          vec3 col = mix(bottomColor, topColor, height);
          float facing = max(dot(dir, normalize(sunDir)), 0.0);
          col += sunColor * pow(facing, 180.0) * 2.2;
          col += sunColor * pow(facing, 6.0) * 0.22;
          gl_FragColor = vec4(col, 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    }),
  );
  sky.frustumCulled = false;
  scene.add(sky);

  const fog = new THREE.Fog(PALETTE.fogDay, 120, 620);
  scene.fog = fog;

  const sun = new THREE.DirectionalLight(PALETTE.sunDay, 1.6);
  sun.position.set(120, 160, 80);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  sun.shadow.camera.left = -70;
  sun.shadow.camera.right = 70;
  sun.shadow.camera.top = 70;
  sun.shadow.camera.bottom = -70;
  sun.shadow.camera.near = 5;
  sun.shadow.camera.far = 460;
  sun.shadow.bias = -0.0006;
  sun.shadow.normalBias = 0.05;
  sun.shadow.camera.updateProjectionMatrix();
  scene.add(sun);
  scene.add(sun.target);

  const hemi = new THREE.HemisphereLight(0xd8ecff, 0x8a7a66, 0.8);
  scene.add(hemi);
  const ambient = new THREE.AmbientLight(0xffffff, 0.25);
  scene.add(ambient);

  // ---- ground, promenade and sea ----
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(1800, 1800),
    new THREE.MeshLambertMaterial({
      color: 0xffffff, map: makeAsphaltTexture(), polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1,
    }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  const sea = new THREE.Mesh(
    new THREE.PlaneGeometry(4000, 4000),
    new THREE.MeshLambertMaterial({ color: 0x2f7ea8 }),
  );
  sea.rotation.x = -Math.PI / 2;
  sea.position.set(HALF + 560, -1.4, 0);
  scene.add(sea);

  const beach = new THREE.Mesh(
    new THREE.PlaneGeometry(260, 760),
    new THREE.MeshLambertMaterial({ color: 0xe6d3a8 }),
  );
  beach.rotation.x = -Math.PI / 2;
  beach.position.set(HALF + 150, -0.35, 0);
  beach.receiveShadow = true;
  scene.add(beach);

  // ---- the blocks: sidewalk slab, buildings, colliders ----
  const pavement = new THREE.MeshLambertMaterial({ color: 0xffffff, map: makePavingTexture() });
  const walkGeo = new THREE.BoxGeometry(BLOCK_HALF * 2, 0.24, BLOCK_HALF * 2);
  const walks = new THREE.InstancedMesh(walkGeo, pavement, CITY.grid * CITY.grid);
  walks.receiveShadow = true;

  // A pale concrete rim proud of the paving: the kerb that separates street from pavement.
  const curbMat = new THREE.MeshLambertMaterial({ color: 0x9d9488 });
  const curbGeo = new THREE.BoxGeometry(BLOCK_HALF * 2 + 0.9, 0.26, BLOCK_HALF * 2 + 0.9);
  const curbs = new THREE.InstancedMesh(curbGeo, curbMat, CITY.grid * CITY.grid);
  curbs.receiveShadow = true;

  const buildingGeo = new THREE.BoxGeometry(1, 1, 1);
  const facadeMat = makeFacadeMaterial(nightUniform);
  const maxBuildings = CITY.grid * CITY.grid * 4;
  const buildingMesh = new THREE.InstancedMesh(buildingGeo, facadeMat, maxBuildings);
  buildingMesh.castShadow = true;
  buildingMesh.receiveShadow = true;

  const matrix = new THREE.Matrix4();
  const instanceColor = new THREE.Color();
  let buildingIndex = 0;
  let walkIndex = 0;

  for (let j = 0; j < CITY.grid; j += 1) {
    for (let i = 0; i < CITY.grid; i += 1) {
      const centre = blockCenter(i, j);
      matrix.makeTranslation(centre.x, 0.12, centre.z);
      walks.setMatrixAt(walkIndex, matrix);
      matrix.makeScale(1, 1, 1);
      matrix.setPosition(centre.x, 0.13, centre.z);
      curbs.setMatrixAt(walkIndex, matrix);
      walkIndex += 1;

      colliders.push({
        x0: centre.x - LOT_HALF,
        x1: centre.x + LOT_HALF,
        z0: centre.z - LOT_HALF,
        z1: centre.z + LOT_HALF,
      });

      const roll = random();
      const mode = roll < 0.18 ? 1 : roll < 0.62 ? 2 : 3;
      const lots = [];
      if (mode === 1) {
        lots.push({ x: centre.x, z: centre.z, w: LOT_HALF * 2, d: LOT_HALF * 2 });
      } else if (mode === 2) {
        lots.push({ x: centre.x, z: centre.z - LOT_HALF / 2, w: LOT_HALF * 2, d: LOT_HALF });
        lots.push({ x: centre.x, z: centre.z + LOT_HALF / 2, w: LOT_HALF * 2, d: LOT_HALF });
      } else {
        for (const sx of [-1, 1]) {
          for (const sz of [-1, 1]) {
            lots.push({ x: centre.x + (sx * LOT_HALF) / 2, z: centre.z + (sz * LOT_HALF) / 2, w: LOT_HALF, d: LOT_HALF });
          }
        }
      }

      const downtown = Math.hypot(centre.x, centre.z) < HALF * 0.55;
      for (const lot of lots) {
        const tall = downtown && random() < 0.4;
        const height = tall ? range(random, 26, 72) : range(random, 9, 26);
        const colour = tall ? pick(random, PALETTE.tower) : pick(random, PALETTE.facade);
        matrix.makeScale(lot.w - 0.6, height, lot.d - 0.6);
        matrix.setPosition(lot.x, height / 2, lot.z);
        buildingMesh.setMatrixAt(buildingIndex, matrix);
        instanceColor.setHex(colour);
        buildingMesh.setColorAt(buildingIndex, instanceColor);
        buildings.push({ x: lot.x, z: lot.z, w: lot.w, d: lot.d, h: height, colour });
        buildingIndex += 1;
      }

      blocks.push({ i, j, x: centre.x, z: centre.z });
    }
  }
  buildingMesh.count = buildingIndex;
  buildingMesh.instanceMatrix.needsUpdate = true;
  if (buildingMesh.instanceColor) buildingMesh.instanceColor.needsUpdate = true;
  walks.instanceMatrix.needsUpdate = true;
  curbs.instanceMatrix.needsUpdate = true;
  scene.add(curbs);
  scene.add(walks);
  scene.add(buildingMesh);

  // ---- lane dashes on every street ----
  const dashGeo = new THREE.BoxGeometry(0.18, 0.03, 3.4);
  const dashMat = new THREE.MeshBasicMaterial({ color: 0xe8dcae });
  const perLine = Math.ceil((HALF * 2) / 9);
  const dashes = new THREE.InstancedMesh(dashGeo, dashMat, (CITY.grid + 1) * perLine * 2 + 8);
  let dashIndex = 0;
  for (let k = 0; k <= CITY.grid; k += 1) {
    const line = roadLine(k);
    for (let s = -HALF + 5; s < HALF - 4; s += 9) {
      matrix.makeRotationY(0);
      matrix.setPosition(line, 0.04, s);
      dashes.setMatrixAt(dashIndex, matrix);
      dashIndex += 1;
      matrix.makeRotationY(Math.PI / 2);
      matrix.setPosition(s, 0.04, line);
      dashes.setMatrixAt(dashIndex, matrix);
      dashIndex += 1;
    }
  }
  dashes.count = dashIndex;
  dashes.instanceMatrix.needsUpdate = true;
  scene.add(dashes);

  // Continuous edge lines down both sides of every street, so the roadway reads at a glance.
  const edgeGeo = new THREE.BoxGeometry(1, 1, 1);
  const edgeMat = new THREE.MeshBasicMaterial({ color: 0xf2ecd8 });
  const edgeLines = new THREE.InstancedMesh(edgeGeo, edgeMat, (CITY.grid + 1) * 4 + 4);
  let edgeIndex = 0;
  const span = HALF * 2;
  for (let k = 0; k <= CITY.grid; k += 1) {
    const line = roadLine(k);
    for (const side of [-1, 1]) {
      matrix.makeScale(0.16, 0.03, span);
      matrix.setPosition(line + side * (ROAD_HALF - 0.55), 0.045, 0);
      edgeLines.setMatrixAt(edgeIndex, matrix);
      edgeIndex += 1;
      matrix.makeScale(span, 0.03, 0.16);
      matrix.setPosition(0, 0.045, line + side * (ROAD_HALF - 0.55));
      edgeLines.setMatrixAt(edgeIndex, matrix);
      edgeIndex += 1;
    }
  }
  edgeLines.count = edgeIndex;
  edgeLines.instanceMatrix.needsUpdate = true;
  scene.add(edgeLines);

  // ---- street lamps: a dark pole and a warm head, both instanced ----
  const poleGeo = new THREE.CylinderGeometry(0.09, 0.12, 6.2, 6);
  const poleMat = new THREE.MeshLambertMaterial({ color: 0x3b3f46 });
  const headGeo = new THREE.BoxGeometry(1.5, 0.22, 0.42);
  const headMat = new THREE.MeshLambertMaterial({ color: 0x6b6455, emissive: 0xffd9a0, emissiveIntensity: 0.15 });
  const lampSpots = [];
  for (const block of blocks) {
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        lampSpots.push({
          x: block.x + sx * (BLOCK_HALF - 1.4),
          z: block.z + sz * (BLOCK_HALF - 1.4),
          rot: Math.atan2(-sx, -sz),
        });
      }
    }
  }
  const poles = new THREE.InstancedMesh(poleGeo, poleMat, lampSpots.length);
  const heads = new THREE.InstancedMesh(headGeo, headMat, lampSpots.length);
  lampSpots.forEach((spot, index) => {
    matrix.makeTranslation(spot.x, 3.1, spot.z);
    poles.setMatrixAt(index, matrix);
    matrix.makeRotationY(spot.rot);
    matrix.setPosition(spot.x, 6.2, spot.z);
    heads.setMatrixAt(index, matrix);
  });
  poles.instanceMatrix.needsUpdate = true;
  heads.instanceMatrix.needsUpdate = true;
  poles.castShadow = true;

  // A soft disc of light under every lamp: invisible at noon, a warm pool after dark.
  const poolCanvas = document.createElement('canvas');
  poolCanvas.width = poolCanvas.height = 64;
  const poolContext = poolCanvas.getContext('2d');
  const poolGradient = poolContext.createRadialGradient(32, 32, 1, 32, 32, 31);
  poolGradient.addColorStop(0, 'rgba(255, 226, 170, 0.85)');
  poolGradient.addColorStop(0.55, 'rgba(255, 205, 140, 0.34)');
  poolGradient.addColorStop(1, 'rgba(255, 190, 120, 0)');
  poolContext.fillStyle = poolGradient;
  poolContext.fillRect(0, 0, 64, 64);
  const poolTexture = new THREE.CanvasTexture(poolCanvas);
  const poolMat = new THREE.MeshBasicMaterial({
    map: poolTexture, transparent: true, opacity: 0, depthWrite: false,
    blending: THREE.AdditiveBlending, toneMapped: false,
  });
  const pools = new THREE.InstancedMesh(new THREE.PlaneGeometry(11, 11), poolMat, lampSpots.length);
  lampSpots.forEach((spot, index) => {
    matrix.makeRotationX(-Math.PI / 2);
    matrix.setPosition(spot.x, 0.05, spot.z);
    pools.setMatrixAt(index, matrix);
  });
  pools.instanceMatrix.needsUpdate = true;
  pools.frustumCulled = false;
  scene.add(poles);
  scene.add(heads);
  scene.add(pools);

  // ---- palms down the sidewalks and along the sand ----
  const palmGeo = mergeParts(palmParts());
  const palmMat = new THREE.MeshLambertMaterial({ vertexColors: true });
  const palmSpots = [];
  for (const block of blocks) {
    for (let n = 0; n < 3; n += 1) {
      const side = int(random, 0, 3);
      const t = range(random, -0.7, 0.7) * BLOCK_HALF;
      const edge = BLOCK_HALF - 1.1;
      const x = side < 2 ? block.x + t : block.x + (side === 2 ? -edge : edge);
      const z = side < 2 ? block.z + (side === 0 ? -edge : edge) : block.z + t;
      palmSpots.push({ x, z, scale: range(random, 0.78, 1.16), rot: random() * Math.PI * 2 });
    }
  }
  for (let n = 0; n < 26; n += 1) {
    palmSpots.push({
      x: HALF + 22 + random() * 90,
      z: -HALF + random() * HALF * 2,
      scale: range(random, 0.9, 1.3),
      rot: random() * 6,
    });
  }
  const palms = new THREE.InstancedMesh(palmGeo, palmMat, palmSpots.length);
  palmSpots.forEach((spot, index) => {
    const quat = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), spot.rot);
    matrix.compose(new THREE.Vector3(spot.x, 0.2, spot.z), quat, new THREE.Vector3(spot.scale, spot.scale, spot.scale));
    palms.setMatrixAt(index, matrix);
  });
  palms.instanceMatrix.needsUpdate = true;
  palms.castShadow = true;
  scene.add(palms);

  // ---- neon signs over the shopfronts, unlit by day and glowing by night ----
  const signGeo = new THREE.PlaneGeometry(5.4, 1.5);
  const signMat = new THREE.MeshBasicMaterial({
    transparent: true, opacity: 0.18, side: THREE.DoubleSide, toneMapped: false,
  });
  const signColours = [0xff5f7e, 0x5ef2c8, 0xffd166, 0x8b6cff, 0xff8a3c, 0x5ec8f2];
  const signSpots = [];
  for (const block of blocks) {
    if (random() < 0.42) continue;
    const side = int(random, 0, 3);
    const edge = LOT_HALF + 0.35;
    const t = range(random, -0.6, 0.6) * LOT_HALF;
    const horizontal = side < 2;
    signSpots.push({
      x: horizontal ? block.x + t : block.x + (side === 2 ? -edge : edge),
      z: horizontal ? block.z + (side === 0 ? -edge : edge) : block.z + t,
      rot: horizontal ? (side === 0 ? Math.PI : 0) : (side === 2 ? -Math.PI / 2 : Math.PI / 2),
      colour: pick(random, signColours),
      y: range(random, 5.2, 7.4),
    });
  }
  const signs = new THREE.InstancedMesh(signGeo, signMat, signSpots.length);
  signSpots.forEach((spot, index) => {
    const quat = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), spot.rot);
    matrix.compose(new THREE.Vector3(spot.x, spot.y, spot.z), quat, new THREE.Vector3(1, 1, 1));
    signs.setMatrixAt(index, matrix);
    signs.setColorAt(index, instanceColor.setHex(spot.colour));
  });
  signs.instanceMatrix.needsUpdate = true;
  if (signs.instanceColor) signs.instanceColor.needsUpdate = true;
  scene.add(signs);

  // ---- queries the rest of the game makes ----

  /** Push a circle out of the buildings and back inside the city; returns where it ended up. */
  function collideCircle(x, z, radius) {
    let px = x;
    let pz = z;
    let hit = false;
    for (let index = 0; index < colliders.length; index += 1) {
      const box = colliders[index];
      if (px <= box.x0 - radius || px >= box.x1 + radius || pz <= box.z0 - radius || pz >= box.z1 + radius) continue;
      const cx = Math.max(box.x0, Math.min(px, box.x1));
      const cz = Math.max(box.z0, Math.min(pz, box.z1));
      const dx = px - cx;
      const dz = pz - cz;
      const d2 = dx * dx + dz * dz;
      if (d2 > radius * radius) continue;
      if (d2 > 1e-5) {
        const d = Math.sqrt(d2);
        px = cx + (dx / d) * radius;
        pz = cz + (dz / d) * radius;
      } else {
        const left = px - box.x0;
        const right = box.x1 - px;
        const top = pz - box.z0;
        const bottom = box.z1 - pz;
        const min = Math.min(left, right, top, bottom);
        if (min === left) px = box.x0 - radius;
        else if (min === right) px = box.x1 + radius;
        else if (min === top) pz = box.z0 - radius;
        else pz = box.z1 + radius;
      }
      hit = true;
    }
    if (px > BOUNDS) { px = BOUNDS; hit = true; }
    if (px < -BOUNDS) { px = -BOUNDS; hit = true; }
    if (pz > BOUNDS) { pz = BOUNDS; hit = true; }
    if (pz < -BOUNDS) { pz = -BOUNDS; hit = true; }
    return { x: px, z: pz, hit };
  }

  /** How far a ray runs before a building stops it, up to maxDistance. */
  function rayDistance(origin, direction, maxDistance) {
    let best = maxDistance;
    for (let index = 0; index < colliders.length; index += 1) {
      const box = colliders[index];
      let tmin = 0;
      let tmax = best;
      let blocked = false;
      for (const axis of ['x', 'z']) {
        const o = axis === 'x' ? origin.x : origin.z;
        const d = axis === 'x' ? direction.x : direction.z;
        const lo = axis === 'x' ? box.x0 : box.z0;
        const hi = axis === 'x' ? box.x1 : box.z1;
        if (Math.abs(d) < 1e-6) {
          if (o < lo || o > hi) { blocked = true; break; }
        } else {
          let t1 = (lo - o) / d;
          let t2 = (hi - o) / d;
          if (t1 > t2) { const swap = t1; t1 = t2; t2 = swap; }
          tmin = Math.max(tmin, t1);
          tmax = Math.min(tmax, t2);
          if (tmin > tmax) { blocked = true; break; }
        }
      }
      if (!blocked && tmin < best) best = tmin;
    }
    return best;
  }

  /** Whether a position is on the asphalt of a street. */
  function isRoad(x, z) {
    const offsetX = Math.abs(((x + HALF) % CITY.cell) - CITY.cell / 2);
    const offsetZ = Math.abs(((z + HALF) % CITY.cell) - CITY.cell / 2);
    return offsetX > LOT_HALF + CITY.walk || offsetZ > LOT_HALF + CITY.walk;
  }

  /** A random point in the middle of a street lane, for spawns. */
  function randomRoadPoint() {
    const alongX = random() < 0.5;
    const k = int(random, 1, CITY.grid - 1);
    const cross = int(random, 1, CITY.grid - 1) * CITY.cell - HALF + (random() < 0.5 ? -3.4 : 3.4);
    return alongX
      ? { x: roadLine(k) + (random() < 0.5 ? -3.4 : 3.4), z: cross }
      : { x: cross, z: roadLine(k) + (random() < 0.5 ? -3.4 : 3.4) };
  }

  /** The nearest street centre to a position, and which way that street runs. */
  function nearestRoad(x, z) {
    let best = Infinity;
    let line = 0;
    let axis = 'x';
    for (let k = 0; k < streetLines.length; k += 1) {
      const d = Math.abs(x - streetLines[k]);
      if (d < best) { best = d; line = streetLines[k]; axis = 'x'; }
      const dz = Math.abs(z - streetLines[k]);
      if (dz < best) { best = dz; line = streetLines[k]; axis = 'z'; }
    }
    return { line, axis, distance: best };
  }

  /** How high the ground is here: the pavement stands a kerb above the street. */
  function groundHeight(x, z) {
    const offsetX = Math.abs(((x + HALF) % CITY.cell) - CITY.cell / 2);
    const offsetZ = Math.abs(((z + HALF) % CITY.cell) - CITY.cell / 2);
    return offsetX <= BLOCK_HALF && offsetZ <= BLOCK_HALF ? 0.24 : 0;
  }

  // ---- time of day ----
  const day = new THREE.Color(PALETTE.skyTopDay);
  const nightSky = new THREE.Color(PALETTE.skyTopNight);
  const dayLow = new THREE.Color(PALETTE.skyBottomDay);
  const nightLow = new THREE.Color(PALETTE.skyBottomNight);
  const dayFog = new THREE.Color(PALETTE.fogDay);
  const nightFog = new THREE.Color(PALETTE.fogNight);
  const daySun = new THREE.Color(PALETTE.sunDay);
  const nightSun = new THREE.Color(PALETTE.sunNight);
  const skyFill = new THREE.Color(0xcfe8ff);

  let timeOfDay = 0;
  function setTimeOfDay(value) {
    timeOfDay = Math.max(0, Math.min(1, value));
    skyUniforms.topColor.value.copy(day).lerp(nightSky, timeOfDay);
    skyUniforms.bottomColor.value.copy(dayLow).lerp(nightLow, timeOfDay);
    skyUniforms.sunColor.value.copy(daySun).lerp(nightSun, timeOfDay);
    fog.color.copy(dayFog).lerp(nightFog, timeOfDay);
    fog.near = 120 - timeOfDay * 55;
    fog.far = 620 - timeOfDay * 190;
    sun.color.copy(daySun).lerp(nightSun, timeOfDay);
    sun.intensity = 1.6 - timeOfDay * 1.28;
    hemi.intensity = 0.8 - timeOfDay * 0.42;
    hemi.color.copy(skyFill).lerp(nightSky, timeOfDay);
    ambient.intensity = 0.28 + timeOfDay * 0.42;
    nightUniform.value = timeOfDay;
    headMat.emissiveIntensity = 0.12 + timeOfDay * 2.4;
    poolMat.opacity = timeOfDay * 0.75;
    headMat.color.setHex(timeOfDay > 0.4 ? 0xffe6bc : 0x6b6455);
    signMat.opacity = 0.14 + timeOfDay * 0.86;
    sea.material.color.setHex(timeOfDay > 0.5 ? 0x123047 : 0x2f7ea8);
  }

  /** Follow the action with the shadow camera, so the whole 560-metre city never needs one map. */
  function update(dt, focus) {
    if (!focus) return;
    sun.target.position.set(focus.x, 0, focus.z);
    sun.position.set(focus.x + 78, 196, focus.z - 44);
    sun.target.updateMatrixWorld();
    sky.position.set(focus.x, 0, focus.z);
  }

  return {
    blocks,
    buildings,
    colliders,
    streetLines,
    sky,
    sun,
    sea,
    ground,
    setTimeOfDay,
    update,
    collideCircle,
    rayDistance,
    groundHeight,
    isRoad,
    randomRoadPoint,
    nearestRoad,
    get timeOfDay() { return timeOfDay; },
    /** The map the minimap draws: street lines and block squares, in world units. */
    map: { half: HALF, cell: CITY.cell, grid: CITY.grid, roadHalf: ROAD_HALF },
  };
}
