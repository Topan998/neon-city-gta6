// world.js — the city itself. A 8x8 grid of blocks around a road every 80 m, each block a ring of
// pavement with lots inside it: towers with setbacks, mid-rise infill, low shopfront rows with
// awnings and neon, palms, lamp posts, traffic lights, hydrants, bins and bus stops, a skyline
// ring on the horizon, and a beach with a boardwalk down the south edge.
//
// Geometry is merged by material: the whole city is a couple of dozen draw calls. The heights,
// window grids, sign words and crowd placement all come from one seeded stream, so the same seed
// builds the same town (and the four screenshots stay reproducible).

const THREE = window.THREE;

import { CITY, PALETTE, DAYLIGHT, RENDER, SUN_DIR } from './config.js';
import {
  TAU, clamp, lerp, saturate, smoothstep, mulberry32, randRange, randInt, pick, chance, hash2,
  GeoBuilder, mergeGeometries, standard, setShadows, textureFrom, TEX, neonTexture,
  FACADE_STYLES, glowCanvas,
} from './util.js';

/** The nine road lines in each axis, from -320 to +320. */
export const LINES = (() => {
  const out = [];
  for (let i = 0; i <= CITY.blocks; i += 1) out.push(-CITY.half + i * CITY.pitch);
  return out;
})();

export const BLOCK_HALF = CITY.blockW / 2;
export const LOT_HALF = BLOCK_HALF - CITY.sidewalkW;

const SHOP_WORDS = [
  'LIQUOR', 'MOTEL', 'DINER', 'PAWN', 'TATTOO', 'VICE', 'CLUB', 'NOODLES', 'PAWN SHOP',
  'SURF', 'ARCADE', 'GUNS', 'RAMEN', 'CASINO', 'LAUNDRY', 'BAR', 'PIZZA', 'HOTEL', 'GARAGE',
];

/** Which block index a coordinate falls in, or -1 when it is on a road. */
export function blockIndexAt(v) {
  const rel = (v + CITY.half) / CITY.pitch;
  const i = Math.floor(rel);
  const frac = rel - i;
  const edge = CITY.sidewalkW / CITY.pitch;
  if (i < 0 || i >= CITY.blocks) return -1;
  if (frac < edge || frac > 1 - edge) return -1;
  return i;
}

/** Distance to the nearest road centre line in that axis. */
export function roadDistance(v) {
  const k = Math.round(v / CITY.pitch);
  return Math.abs(v - k * CITY.pitch);
}

export class World {
  constructor(scene, seed = 20261120) {
    this.scene = scene;
    this.seed = seed;
    this.rng = mulberry32(seed);
    this.timeOfDay = 0.3;
    this.wet = 0.2;
    this.colliders = [];      // axis-aligned boxes the player and the cars push out of
    this.buildings = [];      // {x0,z0,x1,z1,h,style}
    this.blocks = [];         // per-block metadata (centre, kind)
    this.intersections = [];  // road crossings, for traffic lights and traffic AI
    this.neonSigns = [];
    this.lampSpots = [];
    this.lightPools = null;
    this.root = new THREE.Group();
    this.root.name = 'city';
    scene.add(this.root);
    this._tmpColor = new THREE.Color();
    this._buildSky();
    this._buildLights();
    this._buildGround();
    this._buildBlocks();
    this._buildBuildings();
    this._buildMarkings();
    this._buildProps();
    this._buildSkyline();
    this._buildBeach();
    this.setTimeOfDay(this.timeOfDay);
    this.setWet(this.wet);
  }

  // -------------------------------------------------------------------------------------------
  // Sky, sun, fill light
  // -------------------------------------------------------------------------------------------

  _buildSky() {
    const geo = new THREE.SphereGeometry(CITY.skyRadius, 40, 24);
    this.skyUniforms = {
      topColor: { value: new THREE.Color(0x2a4a7c) },
      horizonColor: { value: new THREE.Color(0xffb070) },
      sunColor: { value: new THREE.Color(0xffd9a0) },
      sunDir: { value: new THREE.Vector3(0.6, 0.25, -0.7) },
      midColor: { value: new THREE.Color(0x6a7fa0) },
      haze: { value: 1.0 },
      groundColor: { value: new THREE.Color(0x2b2622) },
    };
    const mat = new THREE.ShaderMaterial({
      uniforms: this.skyUniforms,
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      vertexShader: `
        varying vec3 vDir;
        void main() {
          vDir = normalize(position);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: `
        uniform vec3 topColor;
        uniform vec3 horizonColor;
        uniform vec3 midColor;
        uniform vec3 sunColor;
        uniform vec3 groundColor;
        uniform vec3 sunDir;
        uniform float haze;
        varying vec3 vDir;
        void main() {
          vec3 dir = normalize(vDir);
          float up = clamp(dir.y, -1.0, 1.0);
          // sky gradient: deep at the zenith, warm and bright at the horizon
          // three stops: warm haze at the horizon, a desaturated band, deep colour up top
          vec3 col = mix(horizonColor, midColor, smoothstep(-0.02, 0.16, up));
          col = mix(col, topColor, smoothstep(0.10, 0.72, up));
          // below the horizon fades into the haze that the fog colour matches
          col = mix(col, groundColor, clamp(-up * 3.0, 0.0, 1.0));
          float sd = max(dot(dir, normalize(sunDir)), 0.0);
          col += sunColor * pow(sd, 1200.0) * 6.0;         // the disc
          col += sunColor * pow(sd, 24.0) * 0.30;          // the glow around it
          col += sunColor * pow(sd, 4.0) * 0.12;           // the wash across the sky
          // thin cloud bands, brighter where the sun catches them
          float band = sin(dir.y * 26.0 + dir.x * 5.0) * 0.5 + 0.5;
          band *= smoothstep(0.02, 0.30, up) * smoothstep(0.62, 0.18, up);
          col += horizonColor * band * 0.05 * haze;
          gl_FragColor = vec4(col, 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    });
    this.sky = new THREE.Mesh(geo, mat);
    this.sky.frustumCulled = false;
    this.sky.renderOrder = -1000;
    this.root.add(this.sky);
  }

  _buildLights() {
    this.sun = new THREE.DirectionalLight(0xffd9a8, 2.0);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(RENDER.shadowSize, RENDER.shadowSize);
    const cam = this.sun.shadow.camera;
    cam.left = -RENDER.shadowExtent;
    cam.right = RENDER.shadowExtent;
    cam.top = RENDER.shadowExtent;
    cam.bottom = -RENDER.shadowExtent;
    cam.near = 1;
    cam.far = 900;
    this.sun.shadow.bias = RENDER.shadowBias;
    this.sun.shadow.normalBias = RENDER.shadowNormalBias;
    this.sun.shadow.camera.updateProjectionMatrix();
    this.sunTarget = new THREE.Object3D();
    this.root.add(this.sunTarget);
    this.sun.target = this.sunTarget;
    this.root.add(this.sun);

    this.hemi = new THREE.HemisphereLight(0x9dc3ff, 0x50423a, 0.6);
    this.root.add(this.hemi);

    // A soft bounce from the street, so the underside of awnings and cars is never pure black.
    // A warm cross-light standing in for the bounce off sunlit walls: it gives the shaded side of
    // a street its shape, which a single sun and a hemisphere light never do.
    this.bounce = new THREE.DirectionalLight(0xffc78a, 0.5);
    this.bounce.position.set(0.35, 0.55, 0.95);
    this.root.add(this.bounce);
  }

  /** Build an environment map from the sky alone: it is what makes wet asphalt and paint shine. */
  makeEnvironment(renderer) {
    try {
      const pmrem = new THREE.PMREMGenerator(renderer);
      pmrem.compileEquirectangularShader();
      const skyScene = new THREE.Scene();
      const skyClone = new THREE.Mesh(this.sky.geometry, this.sky.material);
      skyClone.frustumCulled = false;
      skyScene.add(skyClone);
      const rt = pmrem.fromScene(skyScene, 0.04, 0.1, 2000);
      this.scene.environment = rt.texture;
      this.envMap = rt.texture;
      pmrem.dispose();
    } catch (err) {
      // An env map is a nicety; the game runs without it.
      this.envMap = null;
    }
  }

  // -------------------------------------------------------------------------------------------
  // Ground, blocks, kerbs
  // -------------------------------------------------------------------------------------------

  _buildGround() {
    const asphalt = TEX.asphalt();
    this.roadMat = standard({
      map: asphalt,
      color: 0xffffff,
      roughness: 0.62,
      metalness: 0.15,
      envMapIntensity: 0.9,
    });
    asphalt.repeat.set(1, 1);
    const pad = 260;
    const size = CITY.half * 2 + pad * 2;
    const g = new GeoBuilder();
    g.ground(size, size, 0, 0, 0, { uv: 8 });
    this.road = g.mesh(this.roadMat, { cast: false, receive: true });
    this.road.name = 'asphalt';
    this.root.add(this.road);

    // The far ground beyond town: dark scrub, so the skyline does not float on nothing.
    const outer = new GeoBuilder();
    outer.ground(4000, 4000, 0, -0.12, 0, { uv: 40 });
    const outerMat = standard({ color: 0x3a3530, roughness: 0.95, metalness: 0 });
    const outerMesh = outer.mesh(outerMat, { cast: false, receive: true });
    this.root.add(outerMesh);
  }

  _buildBlocks() {
    const pavement = TEX.pavement();
    this.pavementMat = standard({ map: pavement, roughness: 0.86, metalness: 0.04, vertexColors: true });
    this.lotMat = standard({ color: 0x6a6660, roughness: 0.9, metalness: 0.02, vertexColors: true });
    this.curbMat = standard({ color: 0xa9a199, roughness: 0.82, metalness: 0.03 });

    const walk = new GeoBuilder({ colour: 0xffffff });
    const curb = new GeoBuilder();
    const lot = new GeoBuilder({ colour: 0xffffff });

    for (let i = 0; i < CITY.blocks; i += 1) {
      for (let j = 0; j < CITY.blocks; j += 1) {
        const cx = -CITY.half + CITY.pitch * (i + 0.5);
        const cz = -CITY.half + CITY.pitch * (j + 0.5);
        const kind = this._blockKind(i, j);
        this.blocks.push({ i, j, cx, cz, kind });
        // pavement ring, three slabs of texture per side
        const h = CITY.curbH;
        const b = BLOCK_HALF;
        const w = CITY.sidewalkW;
        const tint = 0.86 + hash2(i, j) * 0.24;
        walk.setTint(new THREE.Color(tint, tint * 0.995, tint * 0.985).getHex());
        walk.box(CITY.blockW, h, w, cx, h / 2, cz - b + w / 2, { uv: 4, top: true });
        walk.box(CITY.blockW, h, w, cx, h / 2, cz + b - w / 2, { uv: 4, top: true });
        walk.box(w, h, CITY.blockW - w * 2, cx - b + w / 2, h / 2, cz, { uv: 4, top: true });
        walk.box(w, h, CITY.blockW - w * 2, cx + b - w / 2, h / 2, cz, { uv: 4, top: true });
        // kerb lips on all four sides
        curb.box(CITY.blockW + 0.24, h + 0.06, 0.24, cx, (h + 0.06) / 2, cz - b - 0.1, { uv: 2, top: true });
        curb.box(CITY.blockW + 0.24, h + 0.06, 0.24, cx, (h + 0.06) / 2, cz + b + 0.1, { uv: 2, top: true });
        curb.box(0.24, h + 0.06, CITY.blockW + 0.24, cx - b - 0.1, (h + 0.06) / 2, cz, { uv: 2, top: true });
        curb.box(0.24, h + 0.06, CITY.blockW + 0.24, cx + b + 0.1, (h + 0.06) / 2, cz, { uv: 2, top: true });
        // the lot inside the ring
        lot.setTint(0.9 + hash2(i + 3, j) * 0.2);
        lot.box(LOT_HALF * 2, h, LOT_HALF * 2, cx, h / 2, cz, { uv: 6, top: true });
      }
    }
    const walkMesh = walk.mesh(this.pavementMat, { cast: false, receive: true });
    walkMesh.name = 'pavements';
    this.root.add(walkMesh);
    this.root.add(curb.mesh(this.curbMat, { cast: false, receive: true }));
    this.root.add(lot.mesh(this.lotMat, { cast: false, receive: true }));
  }

  /** What sits on a block: a tower plateau downtown, shop rows on the avenues, low infill between. */
  _blockKind(i, j) {
    const dc = Math.max(Math.abs(i - 3.5), Math.abs(j - 3.5)) / 3.5;
    if (dc < 0.28) return 'tower';
    if (dc < 0.62) return chance(this.rng, 0.45) ? 'tower' : 'mixed';
    return chance(this.rng, 0.35) ? 'rows' : 'mixed';
  }

  // -------------------------------------------------------------------------------------------
  // Buildings
  // -------------------------------------------------------------------------------------------

  _buildBuildings() {
    const styles = ['tower', 'brick', 'stucco', 'glass'];
    this.facadeGroups = {};
    for (const style of styles) {
      const tex = TEX.facade(style);
      const lit = TEX.lit(style, 7);
      const mat = standard({
        map: tex,
        emissiveMap: lit,
        emissive: 0xffffff,
        emissiveIntensity: 0,
        roughness: style === 'glass' ? 0.25 : 0.78,
        metalness: style === 'glass' ? 0.55 : 0.08,
        vertexColors: true,
        envMapIntensity: style === 'glass' ? 0.8 : 0.25,
      });
      this.facadeGroups[style] = { mat, builder: new GeoBuilder({ colour: 0xffffff }) };
    }
    this.roofBuilder = new GeoBuilder({ colour: 0xffffff });
    this.trimBuilder = new GeoBuilder({ colour: 0xffffff });
    this.shopBuilder = new GeoBuilder();
    this.signBuilder = new GeoBuilder({ colour: 0xffffff });
    this.streakBuilder = new GeoBuilder({ colour: 0xffffff });

    for (const block of this.blocks) {
      if (block.kind === 'tower') this._towerBlock(block);
      else if (block.kind === 'rows') this._rowBlock(block);
      else this._mixedBlock(block);
    }

    for (const style of Object.keys(this.facadeGroups)) {
      const group = this.facadeGroups[style];
      const mesh = group.builder.mesh(group.mat, { cast: true, receive: true });
      if (mesh) {
        mesh.name = `buildings-${style}`;
        this.root.add(mesh);
      }
    }
    const roofMat = standard({ color: 0x53504b, roughness: 0.94, metalness: 0.03, vertexColors: true });
    const roofMesh = this.roofBuilder.mesh(roofMat, { cast: true, receive: true });
    if (roofMesh) this.root.add(roofMesh);

    const trimMat = standard({ color: 0xb6ada2, roughness: 0.7, metalness: 0.1, vertexColors: true });
    const trimMesh = this.trimBuilder.mesh(trimMat, { cast: true, receive: true });
    if (trimMesh) this.root.add(trimMesh);

    const shopTex = TEX.shopfront();
    const shopMat = standard({
      map: shopTex,
      emissive: 0xffb877,
      emissiveMap: shopTex,
      emissiveIntensity: 0.35,
      roughness: 0.45,
      metalness: 0.2,
      vertexColors: false,
    });
    this.shopMat = shopMat;
    const shopMesh = this.shopBuilder.mesh(shopMat, { cast: true, receive: true });
    if (shopMesh) this.root.add(shopMesh);

    this.neonMat = new THREE.MeshBasicMaterial({
      vertexColors: true,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      opacity: 0.95,
      toneMapped: false,
    });
    const signMesh = this.signBuilder.mesh(this.neonMat, { cast: false, receive: false });
    if (signMesh) {
      signMesh.name = 'neon';
      this.root.add(signMesh);
    }

    this.streakMat = new THREE.MeshBasicMaterial({
      map: TEX.streak(),
      vertexColors: true,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      opacity: 0.42,
      toneMapped: false,
    });
    const streakMesh = this.streakBuilder.mesh(this.streakMat, { cast: false, receive: false });
    if (streakMesh) {
      streakMesh.name = 'wet-reflections';
      this.root.add(streakMesh);
    }
  }

  _mixedBlock(block) {
    const { cx, cz } = block;
    const q = LOT_HALF - 1.2;      // half of the lot used, per quadrant
    for (let a = 0; a < 2; a += 1) {
      for (let b = 0; b < 2; b += 1) {
        const ox = cx + (a === 0 ? -q / 2 - 0.4 : q / 2 + 0.4);
        const oz = cz + (b === 0 ? -q / 2 - 0.4 : q / 2 + 0.4);
        const w = randRange(this.rng, q * 0.72, q * 0.99);
        const d = randRange(this.rng, q * 0.72, q * 0.99);
        const floors = randInt(this.rng, 2, 7);
        this._building(ox, oz, w, d, floors * 3.3 + 1.2, block);
      }
    }
  }

  _rowBlock(block) {
    const { cx, cz } = block;
    // A shop row hugging two street edges, with a taller mass tucked behind it.
    const backW = LOT_HALF * 2 - 19;
    this._building(cx + 1, cz + 2, backW, backW * 0.8, randInt(this.rng, 9, 16) * 3.2, block, { shop: false });
    const side = Math.floor(this.rng() * 4);
    for (let n = 0; n < 3; n += 1) {
      const along = -LOT_HALF + 9 + n * 18;
      const w = 15;
      const d = 12;
      if (side === 0) this._building(cx + along, cz - LOT_HALF + d / 2, w, d, 8.5, block, { shop: true });
      else if (side === 1) this._building(cx + along, cz + LOT_HALF - d / 2, w, d, 8.5, block, { shop: true });
      else if (side === 2) this._building(cx - LOT_HALF + d / 2, cz + along, d, w, 8.5, block, { shop: true });
      else this._building(cx + LOT_HALF - d / 2, cz + along, d, w, 8.5, block, { shop: true });
    }
  }

  _towerBlock(block) {
    const { cx, cz } = block;
    const w = randRange(this.rng, LOT_HALF * 1.15, LOT_HALF * 1.5);
    const d = randRange(this.rng, LOT_HALF * 1.15, LOT_HALF * 1.5);
    const floors = randInt(this.rng, 12, 26);
    const h = floors * 3.35;
    this._building(cx, cz, w, d, h, block, { shop: true, tiers: true });
    // a low annexe on one corner keeps the plateau from looking like a car park
    if (chance(this.rng, 0.7)) {
      const ax = cx + (chance(this.rng, 0.5) ? 1 : -1) * (LOT_HALF - 6);
      const az = cz + (chance(this.rng, 0.5) ? 1 : -1) * (LOT_HALF - 6);
      this._building(ax, az, 10, 9, randInt(this.rng, 2, 5) * 3.3, block, { shop: true });
    }
  }

  /**
   * One building: a main mass, one or two setback tiers on top of it, a parapet, roof clutter and
   * — when it faces a street — a shopfront band, an awning and maybe a neon sign.
   */
  _building(x, z, w, d, h, block, opts = {}) {
    const rng = this.rng;
    const style = pick(rng, opts.tiers ? ['glass', 'tower', 'tower', 'stucco'] : ['brick', 'stucco', 'tower', 'brick', 'stucco']);
    const group = this.facadeGroups[style];
    const tint = 0.78 + rng() * 0.45;
    const tintHex = new THREE.Color(tint, tint * (0.97 + rng() * 0.05), tint * (0.94 + rng() * 0.1)).getHex();
    group.builder.setTint(tintHex);
    group.builder.box(w, h, d, x, h / 2, z, { uv: 13, top: false });
    const baseY = h;

    // upper tiers, each smaller and set back
    let tierH = h;
    let tw = w;
    let td = d;
    const hasTiers = opts.tiers || (h > 24 && chance(rng, 0.6));
    if (hasTiers) {
      const tiers = randInt(rng, 1, 2);
      for (let t = 0; t < tiers; t += 1) {
        const shrink = randRange(rng, 0.62, 0.84);
        tw *= shrink;
        td *= shrink;
        const th = randRange(rng, 8, 22);
        const y = tierH + th / 2;
        group.builder.box(tw, th, td, x, y, z, { uv: 13, top: false });
        // crown band on every setback
        this.trimBuilder.setTint(0x9d968c);
        this.trimBuilder.box(tw + 0.5, 0.8, td + 0.5, x, tierH + 0.4, z, { uv: 4, top: true });
        tierH += th;
      }
    }

    // parapet
    const pr = 0.28;
    this.trimBuilder.setTint(0xa8a096);
    const topY = tierH + 0.55;
    this.trimBuilder.box(tw, 1.1, pr, x, topY, z - td / 2 + pr / 2, { uv: 3, top: true });
    this.trimBuilder.box(tw, 1.1, pr, x, topY, z + td / 2 - pr / 2, { uv: 3, top: true });
    this.trimBuilder.box(pr, 1.1, td - pr * 2, x - tw / 2 + pr / 2, topY, z, { uv: 3, top: true });
    this.trimBuilder.box(pr, 1.1, td - pr * 2, x + tw / 2 - pr / 2, topY, z, { uv: 3, top: true });

    // roof slab + clutter
    const roofTint = 0.8 + rng() * 0.35;
    this.roofBuilder.setTint(new THREE.Color(roofTint * 0.55, roofTint * 0.54, roofTint * 0.52).getHex());
    this.roofBuilder.ground(tw - 0.2, td - 0.2, x, tierH + 0.06, z, { uv: 5 });
    const clutter = randInt(rng, 1, 4);
    for (let c = 0; c < clutter; c += 1) {
      const cw = randRange(rng, 1.4, 3.4);
      const cd = randRange(rng, 1.4, 3.4);
      const ch = randRange(rng, 0.7, 1.8);
      const ox = x + randRange(rng, -tw * 0.3, tw * 0.3);
      const oz = z + randRange(rng, -td * 0.3, td * 0.3);
      this.roofBuilder.box(cw, ch, cd, ox, tierH + ch / 2 + 0.1, oz, { uv: 3, top: true });
    }
    // water tank on a steel frame: the skyline detail that reads as an American city at a glance
    if (h < 60 && chance(rng, 0.34)) {
      const tx = x + randRange(rng, -tw * 0.25, tw * 0.25);
      const tz = z + randRange(rng, -td * 0.25, td * 0.25);
      const r = randRange(rng, 1.1, 1.8);
      const legs = 1.4;
      this.roofBuilder.setTint(0x4a4038);
      for (const sx of [-1, 1]) {
        for (const sz of [-1, 1]) {
          this.roofBuilder.box(0.18, legs, 0.18, tx + sx * r * 0.7, tierH + legs / 2, tz + sz * r * 0.7, { uv: 2 });
        }
      }
      this.roofBuilder.setTint(0x8a7358);
      this.roofBuilder.cyl(r, 3.2, tx, tierH + legs + 1.6, tz, { seg: 10, uv: 3 });
      this.roofBuilder.cyl(r * 1.02, 0.5, tx, tierH + legs + 3.5, tz, { seg: 10, uv: 3, rTop: 0.12 });
    }

    this.buildings.push({ x0: x - w / 2, z0: z - d / 2, x1: x + w / 2, z1: z + d / 2, h, style });
    this.colliders.push({ x0: x - w / 2 - 0.1, z0: z - d / 2 - 0.1, x1: x + w / 2 + 0.1, z1: z + d / 2 + 0.1, h });

    // street frontage: which side of this mass is closest to a road?
    if (opts.shop !== false) this._shopfront(x, z, w, d, h, style);
  }

  /** A glazed shopfront band on the road-facing side, plus awning, fascia and sometimes neon. */
  _shopfront(x, z, w, d, h, style) {
    const rng = this.rng;
    const dx = roadDistance(x);
    const dz = roadDistance(z);
    const onX = dx < dz;              // the nearest road runs vertically in z, so faces point in x
    const dist = Math.min(dx, dz);
    if (dist > 34) return;            // buried inside the block: no shopfront
    const dir = onX ? Math.sign(this._nearestRoadCoord(x, true) - x) : Math.sign(this._nearestRoadCoord(z, false) - z);
    const faceLen = onX ? d : w;
    const half = onX ? w / 2 : d / 2;
    const bandH = 3.4;
    const rotY = onX ? (dir > 0 ? Math.PI / 2 : -Math.PI / 2) : (dir > 0 ? 0 : Math.PI);
    const fx = onX ? x + dir * (half + 0.06) : x;
    const fz = onX ? z : z + dir * (half + 0.06);
    if (faceLen < 5) return;
    this.shopBuilder.panel(faceLen - 0.6, bandH, fx, bandH / 2, fz, { rotY, uv: 7 });

    // awning over the band
    const aw = faceLen * 0.82;
    const depth = 1.9;
    const ay = bandH + 0.35;
    const tint = pick(rng, [0x8d2b2b, 0x24506b, 0x2d6b4f, 0x8a6a22, 0x4a2a6b, 0x7a3a1a]);
    this.trimBuilder.setTint(tint);
    const ax = onX ? fx + dir * depth * 0.5 : x;
    const az = onX ? z : fz + dir * depth * 0.5;
    this.trimBuilder.box(onX ? depth : aw, 0.22, onX ? aw : depth, ax, ay, az, { uv: 3, top: true });
    // fascia board carrying the shop's name
    this.trimBuilder.setTint(0x24242a);
    this.trimBuilder.box(onX ? 0.14 : aw, 0.55, onX ? aw : 0.14, onX ? fx + dir * 0.12 : x, bandH + 0.95,
      onX ? z : fz + dir * 0.12, { uv: 4, top: true });

    // warm spill from the glazing onto the pavement: what makes a wet street read as wet
    if (chance(rng, 0.85)) {
      const spillColour = new THREE.Color(0xffb772).multiplyScalar(0.55 + rng() * 0.3);
      this.streakBuilder.setTint(spillColour.getHex());
      const sx = onX ? fx + dir * 2.2 : x;
      const sz = onX ? z : fz + dir * 2.2;
      this.streakBuilder.ground(Math.max(3, faceLen * 0.55), 7.5, sx, 0.03, sz, { uv: 1, rotY: onX ? rotY : rotY + Math.PI / 2 });
      if (onX) this.streakBuilder.ground(Math.max(3, faceLen * 0.4), 6.5, fx + dir * 7.5, 0.03, z, { uv: 1, rotY });
    }

    // neon sign above the awning
    if (chance(rng, 0.55) && faceLen > 7) {
      const word = pick(rng, SHOP_WORDS);
      const colour = pick(rng, ['#ff3d81', '#31e6ff', '#8b4dff', '#35ff9e', '#ffa63d', '#ff5252']);
      this._neon(word, colour, fx, ay + 1.35, fz, rotY, Math.min(6.4, faceLen * 0.42), 2.4, 1.05);
    }
  }

  /** Hang a sign from outside the builder: used by the night frame to dress a street. */
  addNeonAt(word, colour, x, y, z, rotY, w = 6, h = 2.2) {
    this._neon(word, colour, x, y, z, rotY, w, h, 1.15);
  }

  _nearestRoadCoord(v, isX) {
    const k = Math.round(v / CITY.pitch);
    return k * CITY.pitch;
  }

  /** A neon sign panel in the vertex-coloured additive batch, plus the streak it throws on the road. */
  _neon(word, colour, x, y, z, rotY, w, h, strength = 1) {
    const tex = neonTexture(word, colour, 512, 192);
    const col = new THREE.Color(colour);
    // The additive batch shares one texture per sign, so signs with a word of their own go into
    // their own small mesh; a city has around forty of them, which is fine.
    const geo = new GeoBuilder({ colour: 0xffffff });
    geo.setTint(col.clone().multiplyScalar(strength).getHex());
    geo.panel(w, h, x, y, z, { rotY, uv: 1 });
    const mesh = new THREE.Mesh(geo.build(), new THREE.MeshBasicMaterial({
      map: tex,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
      opacity: 0.95,
    }));
    mesh.matrixAutoUpdate = false;
    mesh.updateMatrix();
    this.root.add(mesh);
    this.neonSigns.push({ x, y, z, colour, word });
    // and the reflection: a stretched streak of that colour on the wet asphalt
    const nx = Math.sin(rotY);
    const nz = Math.cos(rotY);
    const sx = x + nx * 7;
    const sz = z + nz * 7;
    this.streakBuilder.setTint(col.clone().multiplyScalar(0.9).getHex());
    this.streakBuilder.ground(Math.max(1.6, w * 0.55), 13, sx, 0.03, sz, { uv: 1, rotY: rotY + Math.PI / 2 });
  }

  // -------------------------------------------------------------------------------------------
  // Lane paint, crosswalks and stop lines
  // -------------------------------------------------------------------------------------------

  _buildMarkings() {
    const paint = new GeoBuilder({ colour: 0xffffff });
    const yellow = new GeoBuilder({ colour: 0xd9b45a });
    const span = CITY.half - 6;

    for (const line of LINES) {
      // centre double yellow
      for (const off of [-0.22, 0.22]) {
        yellow.box(0.13, 0.02, span * 2, line + off, 0.012, 0, { uv: 2, top: true });
        yellow.box(span * 2, 0.02, 0.13, 0, 0.012, line + off, { uv: 2, top: true });
      }
      // dashed lane separators at +/-3.9
      for (const off of [-3.9, 3.9]) {
        for (let s = -span; s < span; s += 9) {
          paint.box(0.16, 0.02, 4.6, line + off, 0.012, s + 2.3, { uv: 2, top: true });
          paint.box(4.6, 0.02, 0.16, s + 2.3, 0.012, line + off, { uv: 2, top: true });
        }
      }
      // solid edge lines
      for (const off of [-7.35, 7.35]) {
        paint.box(0.12, 0.02, span * 2, line + off, 0.012, 0, { uv: 2, top: true });
        paint.box(span * 2, 0.02, 0.12, 0, 0.012, line + off, { uv: 2, top: true });
      }
    }

    // crosswalks on all four approaches to every intersection
    for (const rx of LINES) {
      for (const rz of LINES) {
        this.intersections.push({ x: rx, z: rz });
        const roadHalf = CITY.roadW / 2;
        for (let side = 0; side < 4; side += 1) {
          const alongX = side < 2;
          const dir = side % 2 === 0 ? 1 : -1;
          const bandStart = roadHalf + 1.1;
          for (let s = -roadHalf + 0.9; s < roadHalf - 0.35; s += 1.28) {
            if (alongX) {
              paint.box(2.6, 0.02, 0.62, rx + s, 0.014, rz + dir * (bandStart + 1.3), { uv: 2, top: true });
            } else {
              paint.box(0.62, 0.02, 2.6, rx + dir * (bandStart + 1.3), 0.014, rz + s, { uv: 2, top: true });
            }
          }
          // stop line, set back from the crossing
          if (alongX) {
            paint.box(0.42, 0.02, CITY.roadW - 1.4, rx - dir * 5.6, 0.014, rz + dir * (bandStart + 3.0), { uv: 2, top: true });
          } else {
            paint.box(CITY.roadW - 1.4, 0.02, 0.42, rx + dir * (bandStart + 3.0), 0.014, rz - dir * 5.6, { uv: 2, top: true });
          }
        }
      }
    }

    const paintMat = standard({ color: 0xe8e4d6, roughness: 0.5, metalness: 0.05, vertexColors: true });
    const yellowMat = standard({ color: 0xffffff, roughness: 0.55, metalness: 0.05, vertexColors: true });
    const pm = paint.mesh(paintMat, { cast: false, receive: true });
    if (pm) {
      pm.name = 'lane-paint';
      this.root.add(pm);
    }
    const ym = yellow.mesh(yellowMat, { cast: false, receive: true });
    if (ym) this.root.add(ym);
  }

  // -------------------------------------------------------------------------------------------
  // Street furniture: lamps, palms, traffic lights, hydrants, bins, bus stops
  // -------------------------------------------------------------------------------------------

  _buildProps() {
    this._lamps();
    this._palms();
    this._trafficLights();
    this._streetFurniture();
  }

  /** Lamp posts and their heads, instanced; the light pools are one additive instanced quad batch. */
  _lamps() {
    const _identityQuat = new THREE.Quaternion();
    const spots = [];
    for (let i = 0; i <= CITY.blocks; i += 1) {
      const line = LINES[i];
      for (let j = 0; j < CITY.blocks; j += 1) {
        const cz = -CITY.half + CITY.pitch * (j + 0.5);
        for (const side of [-1, 1]) {
          spots.push({ x: line + side * (CITY.roadW / 2 + 1.0), z: cz - 14, rot: side });
        }
      }
    }
    for (let j = 0; j <= CITY.blocks; j += 1) {
      const line = LINES[j];
      for (let i = 0; i < CITY.blocks; i += 1) {
        const cx = -CITY.half + CITY.pitch * (i + 0.5);
        for (const side of [-1, 1]) {
          spots.push({ x: cx + 14, z: line + side * (CITY.roadW / 2 + 1.0), rot: side, axisZ: true });
        }
      }
    }
    this.lampSpots = spots;

    const post = new GeoBuilder({ colour: 0x2a2c30 });
    post.cyl(0.11, 7.2, 0, 3.6, 0, { seg: 6, uv: 3 });
    post.cyl(0.24, 0.5, 0, 0.25, 0, { seg: 8, uv: 3 });
    // arm reaching out over the road (+x is the arm direction; instances are rotated)
    post.box(1.9, 0.14, 0.14, 0.95, 7.1, 0, { uv: 2 });
    post.box(0.5, 0.5, 0.5, 1.85, 7.0, 0, { uv: 1 });

    const head = new GeoBuilder({ colour: 0xffffff });
    head.box(0.62, 0.16, 0.42, 1.85, 6.86, 0, { uv: 1, bottom: true });

    const postGeo = post.build();
    const headGeo = head.build();
    const postMesh = new THREE.InstancedMesh(postGeo, standard({ vertexColors: true, roughness: 0.55, metalness: 0.6, color: 0xffffff }), spots.length);
    this.lampHeadMat = new THREE.MeshBasicMaterial({ color: 0xffd9a0, toneMapped: false });
    const headMesh = new THREE.InstancedMesh(headGeo, this.lampHeadMat, spots.length);
    postMesh.castShadow = true;
    postMesh.receiveShadow = true;

    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const s = new THREE.Vector3(1, 1, 1);
    const p = new THREE.Vector3();
    const pool = new GeoBuilder();
    pool.ground(1, 1, 0, 0, 0, { uv: 1 });
    const poolGeo = pool.build();
    this.poolMat = new THREE.MeshBasicMaterial({
      map: TEX.glow(), color: 0xffc98a, transparent: true, opacity: 0.55,
      blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false,
    });
    const poolMesh = new THREE.InstancedMesh(poolGeo, this.poolMat, spots.length);
    poolMesh.frustumCulled = false;

    spots.forEach((spot, idx) => {
      const rot = spot.axisZ ? (spot.rot > 0 ? Math.PI : 0) : (spot.rot > 0 ? 0 : Math.PI);
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rot);
      p.set(spot.x, 0, spot.z);
      m.compose(p, q, s);
      postMesh.setMatrixAt(idx, m);
      headMesh.setMatrixAt(idx, m);
      // light pool on the road under the lamp head
      const hx = spot.x + Math.cos(rot) * 1.85;
      const hz = spot.z - Math.sin(rot) * 1.85;
      const pm = new THREE.Matrix4();
      pm.compose(new THREE.Vector3(hx, 0.035, hz), _identityQuat, new THREE.Vector3(16, 16, 1));
      poolMesh.setMatrixAt(idx, pm);
      this.colliders.push({ x0: spot.x - 0.3, z0: spot.z - 0.3, x1: spot.x + 0.3, z1: spot.z + 0.3, h: 7 });
    });
    postMesh.instanceMatrix.needsUpdate = true;
    headMesh.instanceMatrix.needsUpdate = true;
    poolMesh.instanceMatrix.needsUpdate = true;
    this.root.add(postMesh, headMesh, poolMesh);
    this.lampMesh = postMesh;
    this.headMesh = headMesh;
    this.poolMesh = poolMesh;
  }

  /** Palms: one instanced trunk-and-frond geometry, placed along the pavements and the beach. */
  _palms() {
    const trunk = new GeoBuilder({ colour: 0x6a5136 });
    trunk.cyl(0.19, 7.6, 0, 3.8, 0, { seg: 7, uv: 2, rTop: 0.13 });
    const frond = new GeoBuilder({ colour: 0x2f5c33 });
    const count = 9;
    for (let f = 0; f < count; f += 1) {
      const a = (f / count) * TAU + 0.3;
      const droop = 0.5 + (f % 3) * 0.18;
      const len = 3.1 + (f % 2) * 0.5;
      const c = Math.cos(a);
      const s = Math.sin(a);
      // three segments, each lower than the last: a blade that arcs over and hangs
      const segs = 3;
      for (let k = 0; k < segs; k += 1) {
        const t0 = k / segs;
        const t1 = (k + 1) / segs;
        const y0 = 7.5 + t0 * len * 0.55 - droop * t0 * t0 * 2.2;
        const y1 = 7.5 + t1 * len * 0.55 - droop * t1 * t1 * 2.2;
        const r0 = t0 * len;
        const r1 = t1 * len;
        const w0 = 0.52 * (1 - t0 * 0.55);
        const w1 = 0.52 * (1 - t1 * 0.6);
        const px = c * r0;
        const pz = s * r0;
        const px1 = c * r1;
        const pz1 = s * r1;
        frond.quad(
          [px - s * w0, y0, pz + c * w0],
          [px + s * w0, y0, pz - c * w0],
          [px1 + s * w1, y1, pz1 - c * w1],
          [px1 - s * w1, y1, pz1 + c * w1],
          [-s, 0.55, c],
          [0, 0, 1, 1],
        );
      }
    }
    const geo = mergeGeometries([trunk.build(), frond.build()]);
    const mat = standard({ vertexColors: true, roughness: 0.85, metalness: 0.02, side: THREE.DoubleSide, color: 0xffffff });
    const spots = [];
    const rng = mulberry32(0x9a17);
    for (const block of this.blocks) {
      const cx = block.cx;
      const cz = block.cz;
      for (let n = 0; n < 3; n += 1) {
        const side = Math.floor(rng() * 4);
        const off = randRange(rng, -LOT_HALF, LOT_HALF);
        const edge = BLOCK_HALF - CITY.sidewalkW / 2;
        if (side === 0) spots.push({ x: cx + off, z: cz - edge });
        else if (side === 1) spots.push({ x: cx + off, z: cz + edge });
        else if (side === 2) spots.push({ x: cx - edge, z: cz + off });
        else spots.push({ x: cx + edge, z: cz + off });
      }
    }
    // the beach line, thicker
    for (let x = -CITY.half; x < CITY.half; x += 11) {
      spots.push({ x: x + randRange(rng, -2, 2), z: CITY.beachZ - 12 + randRange(rng, -3, 3) });
      if (rng() < 0.5) spots.push({ x: x + randRange(rng, -3, 3), z: CITY.beachZ + randRange(rng, 6, 60) });
    }
    const mesh = new THREE.InstancedMesh(geo, mat, spots.length);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    const m = new THREE.Matrix4();
    spots.forEach((spot, i) => {
      const sc = randRange(rng, 0.82, 1.22);
      m.compose(
        new THREE.Vector3(spot.x, CITY.curbH * 0.5, spot.z),
        new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rng() * TAU),
        new THREE.Vector3(sc, sc * randRange(rng, 0.9, 1.15), sc),
      );
      mesh.setMatrixAt(i, m);
      this.colliders.push({ x0: spot.x - 0.35, z0: spot.z - 0.35, x1: spot.x + 0.35, z1: spot.z + 0.35, h: 8 });
    });
    mesh.instanceMatrix.needsUpdate = true;
    this.root.add(mesh);
    this.palmMesh = mesh;
  }

  /** Signal heads at every crossing. Their lamps are one instanced batch recoloured per phase. */
  _trafficLights() {
    const spots = [];
    for (const inter of this.intersections) {
      for (let side = 0; side < 4; side += 1) {
        const dirX = side === 0 ? 1 : side === 1 ? -1 : 0;
        const dirZ = side === 2 ? 1 : side === 3 ? -1 : 0;
        spots.push({
          x: inter.x + dirX * 10.4 - (dirZ !== 0 ? 0 : 0),
          z: inter.z + dirZ * 10.4,
          faceX: -dirX,
          faceZ: -dirZ,
          axis: dirX !== 0 ? 'x' : 'z',
          inter,
        });
      }
    }
    const post = new GeoBuilder({ colour: 0x23262a });
    post.cyl(0.09, 4.4, 0, 2.2, 0, { seg: 5, uv: 2 });
    post.box(0.34, 1.0, 0.3, 0, 4.5, 0, { uv: 1 });
    const postGeo = post.build();
    const postMesh = new THREE.InstancedMesh(postGeo, standard({ vertexColors: true, roughness: 0.5, metalness: 0.55 }), spots.length);
    postMesh.castShadow = true;

    const lamp = new GeoBuilder({ colour: 0xffffff });
    lamp.box(0.2, 0.2, 0.06, 0, 4.85, 0.17, { uv: 1 });
    const lampGeo = lamp.build();
    const lampMat = new THREE.MeshBasicMaterial({ toneMapped: false });
    const lampMesh = new THREE.InstancedMesh(lampGeo, lampMat, spots.length);
    lampMesh.frustumCulled = false;

    const m = new THREE.Matrix4();
    spots.forEach((spot, i) => {
      const rot = Math.atan2(spot.faceX, spot.faceZ);
      m.compose(new THREE.Vector3(spot.x, 0, spot.z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rot), new THREE.Vector3(1, 1, 1));
      postMesh.setMatrixAt(i, m);
      lampMesh.setMatrixAt(i, m);
      this.colliders.push({ x0: spot.x - 0.25, z0: spot.z - 0.25, x1: spot.x + 0.25, z1: spot.z + 0.25, h: 4 });
    });
    postMesh.instanceMatrix.needsUpdate = true;
    lampMesh.instanceMatrix.needsUpdate = true;
    this.root.add(postMesh, lampMesh);
    this.signalMesh = lampMesh;
    this.signalSpots = spots;
    this._signalPhase = -1;
    this.updateSignals(0);
  }

  /** The signal cycle, in seconds: x green, amber, z green, amber. */
  updateSignals(time) {
    const cycle = 30;
    const t = ((time % cycle) + cycle) % cycle;
    const xGreen = t < 12.5;
    const xAmber = t >= 12.5 && t < 15;
    const zGreen = t >= 15 && t < 27.5;
    const phase = xGreen ? 0 : xAmber ? 1 : zGreen ? 2 : 3;
    if (phase === this._signalPhase) return;
    this._signalPhase = phase;
    const col = new THREE.Color();
    for (let i = 0; i < this.signalSpots.length; i += 1) {
      const spot = this.signalSpots[i];
      const green = spot.axis === 'x' ? xGreen : zGreen;
      const amber = spot.axis === 'x' ? xAmber : (t >= 27.5);
      if (green) col.setHex(0x2bff88);
      else if (amber) col.setHex(0xffb825);
      else col.setHex(0xff2b34);
      this.signalMesh.setColorAt(i, col);
    }
    if (this.signalMesh.instanceColor) this.signalMesh.instanceColor.needsUpdate = true;
  }

  /** Whether traffic on `axis` may cross a crossing at `time`. */
  trafficAllowed(axis, time) {
    const cycle = 30;
    const t = ((time % cycle) + cycle) % cycle;
    return axis === 'x' ? t < 12.5 : t >= 15 && t < 27.5;
  }

  _streetFurniture() {
    const props = new GeoBuilder({ colour: 0xffffff });
    const rng = mulberry32(0x4b17);
    const glass = new GeoBuilder({ colour: 0x9fd2e8 });
    for (const block of this.blocks) {
      const edge = BLOCK_HALF - CITY.sidewalkW * 0.55;
      // hydrants, bins and benches along the kerb
      for (let n = 0; n < 3; n += 1) {
        const side = Math.floor(rng() * 4);
        const along = randRange(rng, -LOT_HALF, LOT_HALF);
        let x = block.cx;
        let z = block.cz;
        if (side === 0) { x += along; z -= edge; } else if (side === 1) { x += along; z += edge; }
        else if (side === 2) { x -= edge; z += along; } else { x += edge; z += along; }
        const kind = Math.floor(rng() * 3);
        if (kind === 0) {
          // hydrant
          props.setTint(0xaa2b22);
          props.cyl(0.15, 0.62, x, CITY.curbH + 0.31, z, { seg: 6, uv: 1 });
          props.cyl(0.09, 0.14, x, CITY.curbH + 0.68, z, { seg: 6, uv: 1 });
          props.box(0.5, 0.1, 0.1, x, CITY.curbH + 0.44, z, { uv: 1 });
        } else if (kind === 1) {
          // bin
          props.setTint(0x2f3a33);
          props.box(0.6, 0.95, 0.6, x, CITY.curbH + 0.47, z, { uv: 1 });
          props.setTint(0x1c231e);
          props.box(0.64, 0.08, 0.64, x, CITY.curbH + 0.98, z, { uv: 1 });
        } else {
          // bench facing the road
          props.setTint(0x3c3a36);
          props.box(1.9, 0.12, 0.5, x, CITY.curbH + 0.45, z, { uv: 1 });
          props.box(1.9, 0.5, 0.1, x, CITY.curbH + 0.7, z - 0.22, { uv: 1 });
          props.setTint(0x2a2825);
          props.box(0.1, 0.45, 0.45, x - 0.8, CITY.curbH + 0.22, z, { uv: 1 });
          props.box(0.1, 0.45, 0.45, x + 0.8, CITY.curbH + 0.22, z, { uv: 1 });
        }
      }
      // a bus stop on a quarter of the blocks
      if (rng() < 0.28) {
        const x = block.cx + randRange(rng, -12, 12);
        const z = block.cz + BLOCK_HALF - CITY.sidewalkW * 0.7;
        props.setTint(0x2a3a44);
        props.box(4.4, 0.16, 1.7, x, CITY.curbH + 2.4, z, { uv: 2 });
        props.box(0.16, 2.4, 0.16, x - 2.1, CITY.curbH + 1.2, z - 0.75, { uv: 1 });
        props.box(0.16, 2.4, 0.16, x + 2.1, CITY.curbH + 1.2, z - 0.75, { uv: 1 });
        glass.box(4.1, 2.1, 0.08, x, CITY.curbH + 1.3, z - 0.8, { uv: 2 });
        props.setTint(0xd8d2c4);
        props.box(0.9, 0.34, 0.08, x + 1.2, CITY.curbH + 2.9, z - 0.8, { uv: 1 });
      }
    }
    const mat = standard({ vertexColors: true, roughness: 0.7, metalness: 0.25, color: 0xffffff });
    const mesh = props.mesh(mat, { cast: true, receive: true });
    if (mesh) {
      mesh.name = 'street-furniture';
      this.root.add(mesh);
    }
    const gm = glass.mesh(standard({
      vertexColors: true, color: 0xffffff, transparent: true, opacity: 0.22,
      roughness: 0.1, metalness: 0.4, side: THREE.DoubleSide,
    }), { cast: false, receive: false });
    if (gm) this.root.add(gm);
  }

  // -------------------------------------------------------------------------------------------
  // Horizon and the beach
  // -------------------------------------------------------------------------------------------

  _buildSkyline() {
    const rng = mulberry32(0x77c1);
    const g = new GeoBuilder({ colour: 0xffffff });
    for (let i = 0; i < 190; i += 1) {
      const a = rng() * TAU;
      const r = randRange(rng, 430, 1150);
      const x = Math.cos(a) * r;
      const z = Math.sin(a) * r;
      if (z > CITY.beachZ - 40) continue;      // keep the sea view clear
      const w = randRange(rng, 22, 66);
      const d = randRange(rng, 22, 66);
      const h = randRange(rng, 24, 150) * (1 - smoothstep((r - 430) / 900) * 0.4);
      const v = 0.16 + rng() * 0.16;
      g.setTint(new THREE.Color(v * 0.95, v, v * 1.18).getHex());
      g.box(w, h, d, x, h / 2, z, { uv: 13, top: false });
    }
    const mat = standard({ vertexColors: true, roughness: 0.95, metalness: 0.05, fog: true });
    const mesh = g.mesh(mat, { cast: false, receive: false });
    if (mesh) {
      mesh.name = 'skyline';
      this.root.add(mesh);
    }

    // a haze layer of warm light sitting on the horizon behind the towers
    const glowGeo = new GeoBuilder();
    glowGeo.ground(1, 1, 0, 0, 0, { uv: 1 });
    const glowMat = new THREE.MeshBasicMaterial({
      map: TEX.glow(), color: 0xffb27a, transparent: true, opacity: 0.16,
      blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false,
    });
    const halo = new THREE.Mesh(glowGeo.build(), glowMat);
    halo.position.set(0, 26, -820);
    halo.scale.set(1800, 320, 1);
    halo.rotation.x = -Math.PI / 2;
    halo.renderOrder = -900;
    this.root.add(halo);
    this.horizonHalo = halo;
  }

  _buildBeach() {
    const sandMat = standard({ map: TEX.sand(), roughness: 0.95, metalness: 0.02 });
    sandMat.map.repeat.set(1, 1);
    const g = new GeoBuilder();
    g.ground(CITY.half * 2 + 400, CITY.waterZ - CITY.beachZ + 10, 0, 0.02, (CITY.beachZ + CITY.waterZ) / 2, { uv: 9 });
    const sand = g.mesh(sandMat, { cast: false, receive: true });
    sand.name = 'beach';
    this.root.add(sand);

    // boardwalk: planks and a rail, between town and sand
    const planks = new GeoBuilder({ colour: 0x8a6a4a });
    const rail = new GeoBuilder({ colour: 0x5a4a3c });
    for (let x = -CITY.half - 40; x < CITY.half + 40; x += 2.2) {
      planks.setTint(new THREE.Color().setHex(0x8a6a4a).multiplyScalar(0.85 + hash2(x, 1) * 0.3).getHex());
      planks.box(2.0, 0.22, 9, x, 0.11, CITY.beachZ - 6, { uv: 3, top: true });
    }
    for (let x = -CITY.half - 40; x < CITY.half + 40; x += 6) {
      rail.box(0.14, 1.05, 0.14, x, 0.53, CITY.beachZ - 10.2, { uv: 2 });
    }
    rail.box(CITY.half * 2 + 80, 0.1, 0.1, 0, 1.0, CITY.beachZ - 10.2, { uv: 4 });
    const plankMat = standard({ vertexColors: true, roughness: 0.82, metalness: 0.03, color: 0xffffff });
    const pm = planks.mesh(plankMat, { cast: true, receive: true });
    if (pm) this.root.add(pm);
    const rm = rail.mesh(standard({ vertexColors: true, roughness: 0.6, metalness: 0.4, color: 0xffffff }), { cast: true, receive: true });
    if (rm) this.root.add(rm);

    // the sea
    const waterGeo = new THREE.PlaneGeometry(4000, 900, 1, 1);
    this.waterMat = standard({
      color: 0x1d4a5e, roughness: 0.08, metalness: 0.85, envMapIntensity: 1.4,
    });
    const water = new THREE.Mesh(waterGeo, this.waterMat);
    water.rotation.x = -Math.PI / 2;
    water.position.set(0, 0.04, CITY.waterZ + 440);
    water.receiveShadow = false;
    this.root.add(water);

    // lifeguard hut and umbrellas for scale along the sand
    const hut = new GeoBuilder({ colour: 0xffffff });
    const rng = mulberry32(0x31337);
    for (let i = 0; i < 9; i += 1) {
      const x = randRange(rng, -300, 300);
      const z = randRange(rng, CITY.beachZ + 18, CITY.beachZ + 70);
      const hue = pick(rng, [0xd94a5a, 0x3b7fbf, 0xe4a03a, 0x4aa87a]);
      hut.setTint(hue);
      hut.cyl(2.0, 0.16, x, 2.4, z, { seg: 8, uv: 2, capTop: true });
      hut.setTint(0x9a9386);
      hut.cyl(0.07, 2.4, x, 1.2, z, { seg: 5, uv: 1 });
    }
    const hm = hut.mesh(standard({ vertexColors: true, roughness: 0.8, metalness: 0.05, side: THREE.DoubleSide, color: 0xffffff }), { cast: true, receive: true });
    if (hm) this.root.add(hm);
  }

  // -------------------------------------------------------------------------------------------
  // Time of day, wetness, per-frame updates
  // -------------------------------------------------------------------------------------------

  /** Blend the daylight table at `t` (0 dawn, 0.3 golden, 0.5 noon, 0.86 dusk, 1 night). */
  setTimeOfDay(t) {
    this.timeOfDay = clamp(t, 0, 1);
    const table = DAYLIGHT;
    let a = table[0];
    let b = table[table.length - 1];
    for (let i = 0; i < table.length - 1; i += 1) {
      if (this.timeOfDay >= table[i].t && this.timeOfDay <= table[i + 1].t) {
        a = table[i];
        b = table[i + 1];
        break;
      }
    }
    const f = invLerpSafe(a.t, b.t, this.timeOfDay);
    // THREE.Color takes (r,g,b) numbers, not an array: build from the table's triples explicitly.
    const rgb = (arr) => new THREE.Color(arr[0], arr[1], arr[2]);
    const mix = (x, y) => rgb(x).lerp(rgb(y), f);
    const sunCol = mix(a.sun, b.sun);
    const horizon = mix(a.horizon, b.horizon);
    const zenith = mix(a.zenith, b.zenith);
    const fog = mix(a.fog, b.fog);
    const elev = lerp(a.elev, b.elev, f) * (Math.PI / 180);
    this.sunFactor = lerp(a.sunI, b.sunI, f);
    this.hemiFactor = lerp(a.hemiI, b.hemiI, f);
    this.neonFactor = lerp(a.neon, b.neon, f);
    this.lampFactor = lerp(a.lamp, b.lamp, f);
    this.dusk = 1 - Math.min(1, Math.max(0, elev / 0.35));

    const az = SUN_DIR.az;
    this.sunDir = new THREE.Vector3(Math.cos(az) * Math.cos(elev), Math.sin(elev), Math.sin(az) * Math.cos(elev)).normalize();
    this.skyUniforms.sunDir.value.copy(this.sunDir);
    this.skyUniforms.topColor.value.copy(zenith);
    this.skyUniforms.horizonColor.value.copy(horizon);
    this.skyUniforms.sunColor.value.copy(sunCol);
    this.skyUniforms.groundColor.value.copy(fog).multiplyScalar(0.55);
    this.skyUniforms.haze.value = 0.5 + this.dusk * 0.8;
    this.skyUniforms.midColor.value.copy(horizon).lerp(zenith, 0.45);

    this.sun.color.copy(sunCol);
    this.sun.intensity = this.sunFactor;
    this.sun.visible = this.sunFactor > 0.02;
    this.hemi.color.copy(zenith).lerp(horizon, 0.4);
    this.hemi.groundColor.setHex(0x50423a);
    this.hemi.intensity = this.hemiFactor;
    this.bounce.color.copy(horizon);
    this.bounce.intensity = (0.12 + this.dusk * 0.35) * (0.35 + this.hemiFactor);

    if (!this.fog) {
      this.fog = new THREE.Fog(fog, RENDER.fogNear, RENDER.fogFar);
      this.scene.fog = this.fog;
    }
    this.fog.color.copy(fog);
    this.fog.near = RENDER.fogNear * (0.8 + this.dusk * 0.4);
    this.fog.far = RENDER.fogFar * (0.75 + this.dusk * 0.35);
    this.scene.background = null;

    // emissive life at night
    for (const key of Object.keys(this.facadeGroups)) {
      const mat = this.facadeGroups[key].mat;
      mat.emissiveIntensity = 0.02 + this.neonFactor * 1.35;
    }
    if (this.shopMat) this.shopMat.emissiveIntensity = 0.08 + this.neonFactor * 1.0;
    if (this.lampHeadMat) this.lampHeadMat.color.setHex(0xffd9a0).multiplyScalar(0.25 + this.lampFactor * 1.6);
    if (this.poolMat) this.poolMat.opacity = 0.55 * this.lampFactor;
    if (this.neonMat) this.neonMat.opacity = 0.35 + this.neonFactor * 0.65;
    if (this.streakMat) this.streakMat.opacity = 0.05 + this.neonFactor * 0.4 * this.wet;
    if (this.horizonHalo) this.horizonHalo.material.opacity = 0.1 + (1 - this.dusk) * 0.14;
    this.waterMat.color.setHex(0x1d4a5e).lerp(new THREE.Color(0x0a1a24), this.dusk);
    this._applyWet();
  }

  setWet(v) {
    this.wet = clamp(v, 0, 1);
    this._applyWet();
  }

  _applyWet() {
    const w = this.wet;
    this.roadMat.roughness = lerp(0.58, 0.1, w);
    this.roadMat.metalness = lerp(0.12, 0.62, w);
    this.roadMat.color.setHex(0xffffff).multiplyScalar(lerp(1.0, 0.72, w));
    this.roadMat.envMapIntensity = lerp(0.7, 1.5, w);
    this.roadMat.needsUpdate = true;
    if (this.streakMat) this.streakMat.opacity = 0.04 + this.neonFactor * 0.45 * w;
  }

  /** Sun follows the player so the shadow map stays on the action. */
  update(dt, elapsed, focus) {
    if (focus) {
      this.sunTarget.position.set(focus.x, 0, focus.z);
      this.sun.position.set(
        focus.x + this.sunDir.x * SUN_DIR.dist,
        Math.max(20, this.sunDir.y * SUN_DIR.dist + 12),
        focus.z + this.sunDir.z * SUN_DIR.dist,
      );
      this.sky.position.set(focus.x, 0, focus.z);
    }
    this.updateSignals(elapsed);
  }

  // -------------------------------------------------------------------------------------------
  // Lookups the rest of the game runs on
  // -------------------------------------------------------------------------------------------

  /** Is this point on asphalt (a road or the open ground beyond the grid)? */
  isRoad(x, z) {
    if (Math.abs(x) > CITY.half || Math.abs(z) > CITY.half) return true;
    return blockIndexAt(x) < 0 || blockIndexAt(z) < 0;
  }

  /** The height of the walking surface at a point: pavement or road. */
  groundY(x, z) {
    if (z > CITY.beachZ) return 0.02;
    return this.isRoad(x, z) ? 0 : CITY.curbH;
  }

  /** Nearest road centre line to a coordinate, and which axis it belongs to. */
  nearestRoad(x, z) {
    const nx = Math.round(x / CITY.pitch) * CITY.pitch;
    const nz = Math.round(z / CITY.pitch) * CITY.pitch;
    const dx = Math.abs(x - nx);
    const dz = Math.abs(z - nz);
    if (dx < dz) return { axis: 'z', line: nx, dist: dx, x: nx, z };
    return { axis: 'x', line: nz, dist: dz, x, z: nz };
  }

  /** True when a point is within the asphalt of a road. */
  onAsphalt(x, z) {
    const r = this.nearestRoad(x, z);
    return r.dist <= CITY.roadW / 2 + 0.6 && Math.abs(x) <= CITY.half + 20 && Math.abs(z) <= CITY.half + 20;
  }

  /** A random point on a lane, for spawning traffic and parked cars. */
  randomLanePoint(rng) {
    const axis = rng() < 0.5 ? 'x' : 'z';
    const line = LINES[Math.floor(rng() * LINES.length)];
    const dir = rng() < 0.5 ? 1 : -1;
    const lane = dir * (rng() < 0.5 ? 2.1 : 5.9);
    const along = randRange(rng, -CITY.half + 30, CITY.half - 30);
    if (axis === 'x') return { x: along, z: line + lane, axis, dir, line, lane };
    return { x: line + lane, z: along, axis, dir, line, lane };
  }

  /** A lane point near a position: used to recycle traffic that has drifted out of sight. */
  randomLanePointNear(x, z, rng) {
    const axis = rng() < 0.5 ? 'x' : 'z';
    const nearLine = axis === 'x' ? Math.round(z / CITY.pitch) * CITY.pitch : Math.round(x / CITY.pitch) * CITY.pitch;
    const line = clamp(nearLine, -CITY.half + CITY.pitch, CITY.half - CITY.pitch);
    const dir = rng() < 0.5 ? 1 : -1;
    const lane = dir * (rng() < 0.5 ? 2.1 : 5.9);
    const along = clamp(axis === 'x' ? x : z, -CITY.half + 20, CITY.half - 20);
    if (axis === 'x') return { x: along, z: line + lane, axis, dir, line, lane };
    return { x: line + lane, z: along, axis, dir, line, lane };
  }

  /** A pavement point near a position: where pedestrians and officers stand. */
  pavementPoint(rng, nearX, nearZ, radius = 60) {
    for (let attempt = 0; attempt < 24; attempt += 1) {
      const x = nearX + randRange(rng, -radius, radius);
      const z = nearZ + randRange(rng, -radius, radius);
      if (!this.isRoad(x, z) && Math.abs(x) < CITY.half && Math.abs(z) < CITY.half) {
        return { x, z, y: CITY.curbH };
      }
    }
    return { x: nearX + 6, z: nearZ, y: CITY.curbH };
  }

  /** The nearest pavement point to a position (used to place the player when a car is abandoned). */
  nearestPavement(x, z) {
    const r = this.nearestRoad(x, z);
    const push = CITY.roadW / 2 + 3.4;
    if (r.axis === 'z') {
      const sx = Math.sign(x - r.line) || 1;
      return { x: r.line + sx * push, z, y: CITY.curbH };
    }
    const sz = Math.sign(z - r.line) || 1;
    return { x, z: r.line + sz * push, y: CITY.curbH };
  }

  /**
   * Push a circle out of every building and prop it overlaps. Used by the player on foot and by
   * the cars; returns the corrected position.
   */
  resolveCircle(x, z, radius) {
    let px = x;
    let pz = z;
    for (const c of this.colliders) {
      if (c.h < 0.4) continue;
      const cx = clamp(px, c.x0, c.x1);
      const cz = clamp(pz, c.z0, c.z1);
      const dx = px - cx;
      const dz = pz - cz;
      const d2 = dx * dx + dz * dz;
      if (d2 < radius * radius) {
        const d = Math.sqrt(d2);
        if (d < 1e-4) {
          // dead centre: shove along the shortest axis out of the box
          const left = Math.abs(px - c.x0);
          const right = Math.abs(c.x1 - px);
          const back = Math.abs(pz - c.z0);
          const front = Math.abs(c.z1 - pz);
          const m = Math.min(left, right, back, front);
          if (m === left) px = c.x0 - radius;
          else if (m === right) px = c.x1 + radius;
          else if (m === back) pz = c.z0 - radius;
          else pz = c.z1 + radius;
        } else {
          const push = (radius - d) / d;
          px += dx * push;
          pz += dz * push;
        }
      }
    }
    return { x: px, z: pz };
  }
}

function invLerpSafe(a, b, v) {
  if (b === a) return 0;
  return saturate((v - a) / (b - a));
}

export { FACADE_STYLES };
