// util.js — maths, seeded randomness, easing, canvas textures and a geometry builder. Everything
// the other modules reach for when they need a number, a colour, a surface or a shape.
//
// The whole game is deterministic: there is no Math.random in the simulation path, only mulberry32
// streams seeded from this file. That is what lets the four screenshots come out identical twice.

// The vendored build (vendor/three.min.js) is a classic script: it has already put THREE on the
// window before any module runs, so every module reads it from there instead of bundling a copy.
const THREE = window.THREE;

export const TAU = Math.PI * 2;
export const DEG = Math.PI / 180;

export const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
export const saturate = (v) => clamp(v, 0, 1);
export const lerp = (a, b, t) => a + (b - a) * t;
export const invLerp = (a, b, v) => (b === a ? 0 : saturate((v - a) / (b - a)));
export const smoothstep = (t) => {
  const x = saturate(t);
  return x * x * (3 - 2 * x);
};
export const smootherstep = (t) => {
  const x = saturate(t);
  return x * x * x * (x * (x * 6 - 15) + 10);
};
export const easeOutCubic = (t) => 1 - Math.pow(1 - saturate(t), 3);
export const easeInCubic = (t) => Math.pow(saturate(t), 3);
export const easeInOutCubic = (t) => {
  const x = saturate(t);
  return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
};
export const easeOutBack = (t) => {
  const x = saturate(t);
  const c = 1.70158;
  return 1 + (c + 1) * Math.pow(x - 1, 3) + c * Math.pow(x - 1, 2);
};

/** Frame-rate independent smoothing: `damp(a, b, lambda, dt)` closes the gap a little each second. */
export const damp = (a, b, lambda, dt) => lerp(a, b, 1 - Math.exp(-lambda * dt));

/** Approach a target by at most `step` units. */
export const approach = (a, b, step) => (a < b ? Math.min(a + step, b) : Math.max(a - step, b));

/** Wrap an angle into (-pi, pi]. */
export function wrapPi(a) {
  let x = (a + Math.PI) % TAU;
  if (x < 0) x += TAU;
  return x - Math.PI;
}

/** Shortest signed turn from `a` to `b`, in (-pi, pi]. */
export const angleDelta = (a, b) => wrapPi(b - a);

/** Turn `a` towards `b`, never faster than `rate` radians a second. */
export function turnTowards(a, b, rate, dt) {
  const d = angleDelta(a, b);
  const step = rate * dt;
  return Math.abs(d) <= step ? b : a + Math.sign(d) * step;
}

export const dampAngle = (a, b, lambda, dt) => a + angleDelta(a, b) * (1 - Math.exp(-lambda * dt));

/** A seeded random stream: mulberry32. Same seed, same city, same screenshots. */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Random in a range from a stream. */
export const randRange = (rng, lo, hi) => lo + (hi - lo) * rng();
export const randInt = (rng, lo, hi) => Math.floor(lo + (hi - lo + 1) * rng());
export const pick = (rng, list) => list[Math.min(list.length - 1, Math.floor(rng() * list.length))];
export const chance = (rng, p) => rng() < p;

/** A stable 0..1 hash of two integers, for per-building variation that never shifts. */
export function hash2(x, y) {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Distance from a point to an axis-aligned rectangle (0 when inside). */
export function rectDist(px, pz, x0, z0, x1, z1) {
  const dx = Math.max(x0 - px, 0, px - x1);
  const dz = Math.max(z0 - pz, 0, pz - z1);
  return Math.hypot(dx, dz);
}

export const inRect = (px, pz, r) => px >= r.x0 && px <= r.x1 && pz >= r.z0 && pz <= r.z1;

// ---------------------------------------------------------------------------------------------
// Colour helpers
// ---------------------------------------------------------------------------------------------

const _c = new THREE.Color();

/** A THREE.Color from a hex number scaled by `k` (for shading variants). */
export function shade(hex, k) {
  _c.setHex(hex);
  _c.multiplyScalar(k);
  return _c.getHex();
}

export function mixHex(a, b, t) {
  _c.setHex(a);
  const other = new THREE.Color(b);
  _c.lerp(other, saturate(t));
  return _c.getHex();
}

// ---------------------------------------------------------------------------------------------
// Canvas + texture builders. Every surface in the game is painted here: no image files at all.
// ---------------------------------------------------------------------------------------------

export function canvas2d(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d');
  ctx.imageSmoothingEnabled = true;
  return { canvas: c, ctx };
}

/** Wrap a canvas as a texture. `srgb` for colour maps, off for data maps (roughness, alpha). */
export function textureFrom(canvas, { repeat = 1, srgb = true, aniso = 4, nearest = false } = {}) {
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(repeat, repeat);
  tex.anisotropy = aniso;
  tex.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  tex.minFilter = nearest ? THREE.NearestFilter : THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = true;
  tex.needsUpdate = true;
  return tex;
}

/** Speckle a canvas with random dots, using a local seeded stream so a surface is reproducible. */
function speckle(ctx, w, h, count, seed, alpha, size, hue = '255,255,255') {
  const rng = mulberry32(seed);
  for (let i = 0; i < count; i += 1) {
    const x = rng() * w;
    const y = rng() * h;
    const s = size * (0.4 + rng());
    ctx.fillStyle = `rgba(${hue},${alpha * (0.25 + rng() * 0.75)})`;
    ctx.fillRect(x, y, s, s);
  }
}

/** Asphalt: dark, grainy, with tar seams, patches and the faint polish of two tyre tracks. */
export function asphaltCanvas(size = 512) {
  const { canvas, ctx } = canvas2d(size, size);
  ctx.fillStyle = '#575c63';
  ctx.fillRect(0, 0, size, size);
  const rng = mulberry32(0x51ee7);
  // coarse aggregate
  for (let i = 0; i < 9000; i += 1) {
    const x = rng() * size;
    const y = rng() * size;
    const s = 0.6 + rng() * 1.8;
    const v = 74 + rng() * 62;
    ctx.fillStyle = `rgba(${v},${v + 2},${v + 6},${0.2 + rng() * 0.45})`;
    ctx.fillRect(x, y, s, s);
  }
  // darker tar patches
  for (let i = 0; i < 14; i += 1) {
    const x = rng() * size;
    const y = rng() * size;
    const r = 20 + rng() * 70;
    const g = ctx.createRadialGradient(x, y, 1, x, y, r);
    g.addColorStop(0, 'rgba(30,32,36,0.35)');
    g.addColorStop(1, 'rgba(30,32,36,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, TAU);
    ctx.fill();
  }
  // hairline cracks
  ctx.lineWidth = 1;
  for (let i = 0; i < 22; i += 1) {
    ctx.strokeStyle = `rgba(22,24,27,${0.3 + rng() * 0.3})`;
    ctx.beginPath();
    let x = rng() * size;
    let y = rng() * size;
    ctx.moveTo(x, y);
    for (let k = 0; k < 7; k += 1) {
      x += (rng() - 0.5) * 26;
      y += (rng() - 0.5) * 26;
      ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  speckle(ctx, size, size, 1800, 0x991, 0.5, 1.4, '120,126,136');
  return canvas;
}

/** Pavement: poured concrete slabs, four to a tile, with kerb stains and a little wear. */
export function pavementCanvas(size = 512) {
  const { canvas, ctx } = canvas2d(size, size);
  ctx.fillStyle = '#9b948b';
  ctx.fillRect(0, 0, size, size);
  const rng = mulberry32(0x91a2b);
  for (let i = 0; i < 5000; i += 1) {
    const v = 120 + rng() * 60;
    ctx.fillStyle = `rgba(${v},${v - 4},${v - 10},${0.1 + rng() * 0.35})`;
    ctx.fillRect(rng() * size, rng() * size, 1 + rng() * 2, 1 + rng() * 2);
  }
  // slab joints, 2x2 per tile
  ctx.strokeStyle = 'rgba(60,56,52,0.55)';
  ctx.lineWidth = 3;
  for (let i = 0; i <= 2; i += 1) {
    const p = (i * size) / 2;
    ctx.beginPath();
    ctx.moveTo(p, 0);
    ctx.lineTo(p, size);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(0, p);
    ctx.lineTo(size, p);
    ctx.stroke();
  }
  ctx.strokeStyle = 'rgba(255,252,244,0.16)';
  ctx.lineWidth = 1;
  for (let i = 0; i <= 2; i += 1) {
    const p = (i * size) / 2 + 2;
    ctx.beginPath();
    ctx.moveTo(p, 0);
    ctx.lineTo(p, size);
    ctx.stroke();
  }
  for (let i = 0; i < 18; i += 1) {
    const g = ctx.createRadialGradient(rng() * size, rng() * size, 2, rng() * size, rng() * size, 30 + rng() * 40);
    g.addColorStop(0, 'rgba(70,64,58,0.20)');
    g.addColorStop(1, 'rgba(70,64,58,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
  }
  return canvas;
}

export const FACADE_STYLES = {
  tower: { wall: '#5f6874', frame: '#39414c', glass: '#2b3a47', mullion: '#8d97a3' },
  brick: { wall: '#8a5b46', frame: '#4a352c', glass: '#243039', mullion: '#b08a72' },
  stucco: { wall: '#b3a998', frame: '#6d655a', glass: '#28323b', mullion: '#d6cec0' },
  glass: { wall: '#3d4d5c', frame: '#22303c', glass: '#22323f', mullion: '#a6b6c4' },
};

/**
 * A building facade that tiles: a grid of 4 x 4 windows per texture. The uv of every wall is set
 * in metres in the world builder, so a 40 m tower and a 9 m shopfront share the same window size.
 */
export function facadeCanvas(style = 'tower', size = 512) {
  const s = FACADE_STYLES[style] ?? FACADE_STYLES.tower;
  const { canvas, ctx } = canvas2d(size, size);
  const rng = mulberry32(0x1234 + style.length * 977);
  ctx.fillStyle = s.wall;
  ctx.fillRect(0, 0, size, size);
  // wall grain + horizontal floor bands
  for (let i = 0; i < 3000; i += 1) {
    ctx.fillStyle = `rgba(0,0,0,${0.03 + rng() * 0.07})`;
    ctx.fillRect(rng() * size, rng() * size, 2 + rng() * 6, 1 + rng() * 2);
  }
  const cell = size / 4;
  for (let row = 0; row < 4; row += 1) {
    const y = row * cell;
    // slab / floor line
    ctx.fillStyle = 'rgba(0,0,0,0.22)';
    ctx.fillRect(0, y + cell - cell * 0.13, size, cell * 0.13);
    ctx.fillStyle = 'rgba(255,255,255,0.07)';
    ctx.fillRect(0, y + cell - cell * 0.145, size, 2);
  }
  for (let col = 0; col < 4; col += 1) {
    for (let row = 0; row < 4; row += 1) {
      const x = col * cell;
      const y = row * cell;
      const pad = cell * 0.17;
      // recess shadow
      ctx.fillStyle = 'rgba(0,0,0,0.28)';
      ctx.fillRect(x + pad, y + pad, cell - pad * 2, cell * 0.68);
      // glass
      const g = ctx.createLinearGradient(x + pad, y + pad, x + cell - pad, y + cell * 0.68);
      g.addColorStop(0, s.glass);
      g.addColorStop(0.45, '#3a4c5c');
      g.addColorStop(1, '#1b242c');
      ctx.fillStyle = g;
      ctx.fillRect(x + pad + 2, y + pad + 2, cell - pad * 2 - 4, cell * 0.68 - 4);
      // reflection streak
      ctx.fillStyle = 'rgba(190,215,235,0.10)';
      ctx.beginPath();
      ctx.moveTo(x + pad + 4, y + pad + 2);
      ctx.lineTo(x + pad + cell * 0.22, y + pad + 2);
      ctx.lineTo(x + pad + 4, y + pad + cell * 0.4);
      ctx.closePath();
      ctx.fill();
      // frame + mullion
      ctx.strokeStyle = s.frame;
      ctx.lineWidth = Math.max(2, cell * 0.035);
      ctx.strokeRect(x + pad, y + pad, cell - pad * 2, cell * 0.68);
      ctx.beginPath();
      ctx.moveTo(x + cell * 0.5, y + pad);
      ctx.lineTo(x + cell * 0.5, y + pad + cell * 0.68);
      ctx.stroke();
      // sill
      ctx.fillStyle = 'rgba(255,255,255,0.10)';
      ctx.fillRect(x + pad - 3, y + pad + cell * 0.68, cell - pad * 2 + 6, 3);
    }
  }
  // grime creeping up from the ground floor and down from ledges
  const grime = ctx.createLinearGradient(0, size, 0, 0);
  grime.addColorStop(0, 'rgba(20,18,16,0.42)');
  grime.addColorStop(0.25, 'rgba(20,18,16,0.0)');
  ctx.fillStyle = grime;
  ctx.fillRect(0, 0, size, size);
  return canvas;
}

/**
 * The night map for the same facade: black, with a subset of the windows lit in warm or cool
 * light. It is fed to `emissiveMap` so a tower can turn its lights on as the sun goes down.
 */
export function facadeLitCanvas(style = 'tower', size = 512, seed = 7) {
  const { canvas, ctx } = canvas2d(size, size);
  const rng = mulberry32(0x77aa + seed * 131 + style.length);
  ctx.fillStyle = '#000000';
  ctx.fillRect(0, 0, size, size);
  const cell = size / 4;
  const warm = ['#ffca85', '#ffd9a8', '#ffe7c4', '#ffb96b'];
  const cool = ['#a8d8ff', '#cfe8ff', '#8fd0e8'];
  for (let col = 0; col < 4; col += 1) {
    for (let row = 0; row < 4; row += 1) {
      if (rng() > 0.42) continue;
      const x = col * cell + cell * 0.17;
      const y = row * cell + cell * 0.17;
      const w = cell - cell * 0.34;
      const h = cell * 0.68;
      const colour = rng() < 0.72 ? warm[Math.floor(rng() * warm.length)] : cool[Math.floor(rng() * cool.length)];
      const g = ctx.createLinearGradient(0, y, 0, y + h);
      g.addColorStop(0, colour);
      g.addColorStop(1, 'rgba(255,180,110,0.35)');
      ctx.globalAlpha = 0.55 + rng() * 0.45;
      ctx.fillStyle = g;
      ctx.fillRect(x + 2, y + 2, w - 4, h - 4);
      // a hint of a room behind the glass
      ctx.globalAlpha = 0.5;
      ctx.fillStyle = 'rgba(0,0,0,0.5)';
      ctx.fillRect(x + w * 0.62, y + 2, w * 0.3, h - 4);
      ctx.globalAlpha = 1;
    }
  }
  return canvas;
}

/** A shopfront band: glazing, a sign fascia, an awning stripe and a lit interior. */
export function shopfrontCanvas(size = 256) {
  const { canvas, ctx } = canvas2d(size, size);
  const rng = mulberry32(0x5a5a1);
  ctx.fillStyle = '#2a2b2e';
  ctx.fillRect(0, 0, size, size);
  // fascia
  ctx.fillStyle = '#161719';
  ctx.fillRect(0, 0, size, size * 0.3);
  ctx.fillStyle = 'rgba(255,235,200,0.85)';
  for (let i = 0; i < 5; i += 1) {
    ctx.fillRect(size * 0.08 + i * size * 0.17, size * 0.1, size * 0.11, size * 0.06);
  }
  // glazing
  const g = ctx.createLinearGradient(0, size * 0.3, 0, size);
  g.addColorStop(0, '#ffe0b0');
  g.addColorStop(0.5, '#c99655');
  g.addColorStop(1, '#3a2a1c');
  ctx.fillStyle = g;
  ctx.fillRect(size * 0.03, size * 0.34, size * 0.94, size * 0.62);
  // mullions
  ctx.fillStyle = '#111214';
  for (let i = 1; i < 4; i += 1) ctx.fillRect(size * 0.03 + (i * size * 0.94) / 4 - 2, size * 0.34, 4, size * 0.62);
  // goods / silhouettes in the window
  for (let i = 0; i < 24; i += 1) {
    ctx.fillStyle = `rgba(20,14,10,${0.2 + rng() * 0.5})`;
    ctx.fillRect(size * 0.05 + rng() * size * 0.9, size * (0.5 + rng() * 0.4), 6 + rng() * 16, 6 + rng() * 22);
  }
  return canvas;
}

/** Sand for the beach: pale, wind-rippled. */
export function sandCanvas(size = 256) {
  const { canvas, ctx } = canvas2d(size, size);
  ctx.fillStyle = '#cbb99a';
  ctx.fillRect(0, 0, size, size);
  const rng = mulberry32(0x5a4d);
  for (let i = 0; i < 6000; i += 1) {
    const v = 180 + rng() * 50;
    ctx.fillStyle = `rgba(${v},${v - 12},${v - 34},${0.15 + rng() * 0.4})`;
    ctx.fillRect(rng() * size, rng() * size, 1 + rng() * 2, 1 + rng() * 2);
  }
  for (let i = 0; i < 26; i += 1) {
    ctx.strokeStyle = `rgba(150,132,106,${0.1 + rng() * 0.2})`;
    ctx.lineWidth = 1 + rng() * 2;
    ctx.beginPath();
    const y = rng() * size;
    ctx.moveTo(0, y);
    for (let x = 0; x <= size; x += 16) ctx.lineTo(x, y + Math.sin(x * 0.05 + i) * 4);
    ctx.stroke();
  }
  return canvas;
}

/** A neon sign: glowing tube text on a dark panel, plus a halo. Used on facades and in the HUD. */
export function neonSignCanvas(text, colour = '#ff3d81', w = 512, h = 192) {
  const { canvas, ctx } = canvas2d(w, h);
  ctx.fillStyle = '#08090b';
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = 'rgba(255,255,255,0.06)';
  ctx.lineWidth = 6;
  ctx.strokeRect(6, 6, w - 12, h - 12);
  const size = Math.min(h * 0.52, (w * 1.6) / Math.max(4, text.length));
  ctx.font = `700 ${size}px "Helvetica Neue", Helvetica, Arial, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.shadowColor = colour;
  ctx.shadowBlur = size * 0.55;
  ctx.fillStyle = colour;
  ctx.fillText(text, w / 2, h / 2);
  ctx.fillText(text, w / 2, h / 2);
  ctx.shadowBlur = size * 0.18;
  ctx.fillStyle = '#ffffff';
  ctx.globalAlpha = 0.75;
  ctx.font = `600 ${size * 0.97}px "Helvetica Neue", Helvetica, Arial, sans-serif`;
  ctx.fillText(text, w / 2, h / 2);
  ctx.globalAlpha = 1;
  return canvas;
}

/** A soft radial falloff: light pools under lamps, tyre smoke, muzzle glow, sun glare. */
export function glowCanvas(size = 128, inner = 'rgba(255,255,255,1)', outer = 'rgba(255,255,255,0)') {
  const { canvas, ctx } = canvas2d(size, size);
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, inner);
  g.addColorStop(0.42, 'rgba(255,255,255,0.35)');
  g.addColorStop(1, outer);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  return canvas;
}

/** A vertical light streak: what a neon sign does to wet asphalt at night. */
export function streakCanvas(w = 32, h = 256) {
  const { canvas, ctx } = canvas2d(w, h);
  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, 'rgba(255,255,255,0.85)');
  g.addColorStop(0.35, 'rgba(255,255,255,0.35)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  // wobble the edges so it reads as a broken reflection, not a bar
  ctx.globalCompositeOperation = 'destination-in';
  const rng = mulberry32(0x7ea1);
  for (let y = 0; y < h; y += 2) {
    const ww = w * (0.35 + 0.65 * (1 - y / h)) * (0.6 + rng() * 0.4);
    ctx.fillStyle = `rgba(0,0,0,${0.55 + rng() * 0.45})`;
    ctx.fillRect(0, y, (w - ww) / 2, 2);
    ctx.fillRect(w - (w - ww) / 2, y, (w - ww) / 2, 2);
  }
  return canvas;
}

/** A small set of shared textures, built once on first use and cached by key. */
const _texCache = new Map();

export function sharedTexture(key, builder, opts) {
  if (!_texCache.has(key)) _texCache.set(key, textureFrom(builder(), opts));
  return _texCache.get(key);
}

export const TEX = {
  asphalt: () => sharedTexture('asphalt', () => asphaltCanvas(512), { repeat: 1, aniso: 8 }),
  pavement: () => sharedTexture('pavement', () => pavementCanvas(512), { repeat: 1, aniso: 8 }),
  sand: () => sharedTexture('sand', () => sandCanvas(256), { repeat: 1 }),
  shopfront: () => sharedTexture('shopfront', () => shopfrontCanvas(256), { repeat: 1 }),
  glow: () => sharedTexture('glow', () => glowCanvas(128), { repeat: 1 }),
  smoke: () => sharedTexture('smoke', () => glowCanvas(128, 'rgba(230,230,230,0.95)', 'rgba(230,230,230,0)'), { repeat: 1 }),
  streak: () => sharedTexture('streak', () => streakCanvas(32, 256), { repeat: 1 }),
  facade: (style) => sharedTexture(`facade-${style}`, () => facadeCanvas(style, 512), { repeat: 1, aniso: 8 }),
  lit: (style, seed = 7) => sharedTexture(`lit-${style}-${seed}`, () => facadeLitCanvas(style, 512, seed), { repeat: 1 }),
};

export function neonTexture(text, colour, w = 512, h = 192) {
  return textureFrom(neonSignCanvas(text, colour, w, h), { repeat: 1 });
}

// ---------------------------------------------------------------------------------------------
// Geometry: one builder that emits boxes, cylinders and quads with metre-accurate uvs, so a whole
// district becomes a single merged mesh — one draw call for four hundred windows.
// ---------------------------------------------------------------------------------------------

export class GeoBuilder {
  constructor({ colour = null } = {}) {
    this.pos = [];
    this.nor = [];
    this.uv = [];
    this.col = colour === null ? null : [];
    this.tint = colour === null ? null : new THREE.Color(colour);
    this.verts = 0;
  }

  /** Set the tint applied to every primitive added after this call (when the builder has colours). */
  setTint(hex) {
    if (!this.col) return this;
    this.tint = new THREE.Color(hex);
    return this;
  }

  _v(p, n, u, v) {
    this.pos.push(p[0], p[1], p[2]);
    this.nor.push(n[0], n[1], n[2]);
    this.uv.push(u, v);
    if (this.col) this.col.push(this.tint.r, this.tint.g, this.tint.b);
    this.verts += 1;
  }

  /** One quad from four corners in counter-clockwise order seen from the front. */
  quad(a, b, c, d, n, uv) {
    const [u0, v0, u1, v1] = uv ?? [0, 0, 1, 1];
    this._v(a, n, u0, v0);
    this._v(b, n, u1, v0);
    this._v(c, n, u1, v1);
    this._v(a, n, u0, v0);
    this._v(c, n, u1, v1);
    this._v(d, n, u0, v1);
    return this;
  }

  /**
   * A box with metre uvs: `uv` is the size of one texture tile in metres. The bottom face is left
   * out unless asked for; nobody ever sees it and it halves the triangle count of the city.
   */
  box(w, h, d, cx, cy, cz, o = {}) {
    const { uv = 8, rotY = 0, bottom = false, top = true, offU = 0, offV = 0 } = o;
    const hw = w / 2;
    const hh = h / 2;
    const hd = d / 2;
    const c = Math.cos(rotY);
    const s = Math.sin(rotY);
    const rp = (x, y, z) => [cx + x * c + z * s, cy + y, cz - x * s + z * c];
    const rn = (x, z) => [x * c + z * s, 0, -x * s + z * c];
    const su = (m) => offU + m / uv;
    const sv = (m) => offV + m / uv;
    // +z front
    this.quad(rp(-hw, -hh, hd), rp(hw, -hh, hd), rp(hw, hh, hd), rp(-hw, hh, hd), rn(0, 1),
      [su(0), sv(0), su(w), sv(h)]);
    // -z back
    this.quad(rp(hw, -hh, -hd), rp(-hw, -hh, -hd), rp(-hw, hh, -hd), rp(hw, hh, -hd), rn(0, -1),
      [su(0), sv(0), su(w), sv(h)]);
    // +x right
    this.quad(rp(hw, -hh, hd), rp(hw, -hh, -hd), rp(hw, hh, -hd), rp(hw, hh, hd), rn(1, 0),
      [su(0), sv(0), su(d), sv(h)]);
    // -x left
    this.quad(rp(-hw, -hh, -hd), rp(-hw, -hh, hd), rp(-hw, hh, hd), rp(-hw, hh, -hd), rn(-1, 0),
      [su(0), sv(0), su(d), sv(h)]);
    if (top) {
      this.quad(rp(-hw, hh, hd), rp(hw, hh, hd), rp(hw, hh, -hd), rp(-hw, hh, -hd), [0, 1, 0],
        [su(0), sv(0), su(w), sv(d)]);
    }
    if (bottom) {
      this.quad(rp(-hw, -hh, -hd), rp(hw, -hh, -hd), rp(hw, -hh, hd), rp(-hw, -hh, hd), [0, -1, 0],
        [su(0), sv(0), su(w), sv(d)]);
    }
    return this;
  }

  /** An n-sided prism standing on y: trunks, lamp posts, water tanks, bollards, wheels-less rims. */
  cyl(r, h, cx, cy, cz, o = {}) {
    const { seg = 8, uv = 4, rotY = 0, capTop = true, rTop = null } = o;
    const rt = rTop === null ? r : rTop;
    for (let i = 0; i < seg; i += 1) {
      const a0 = rotY + (i / seg) * TAU;
      const a1 = rotY + ((i + 1) / seg) * TAU;
      const c0 = Math.cos(a0);
      const s0 = Math.sin(a0);
      const c1 = Math.cos(a1);
      const s1 = Math.sin(a1);
      const nx = (c0 + c1) / 2;
      const nz = (s0 + s1) / 2;
      const nl = Math.hypot(nx, nz) || 1;
      const u0 = (i / seg) * ((TAU * r) / uv);
      const u1 = ((i + 1) / seg) * ((TAU * r) / uv);
      this.quad(
        [cx + c0 * r, cy - h / 2, cz + s0 * r],
        [cx + c1 * r, cy - h / 2, cz + s1 * r],
        [cx + c1 * rt, cy + h / 2, cz + s1 * rt],
        [cx + c0 * rt, cy + h / 2, cz + s0 * rt],
        [nx / nl, 0, nz / nl],
        [u0, 0, u1, h / uv],
      );
      if (capTop && rt > 0.001) {
        const p0 = [cx, cy + h / 2, cz];
        const p1 = [cx + c0 * rt, cy + h / 2, cz + s0 * rt];
        const p2 = [cx + c1 * rt, cy + h / 2, cz + s1 * rt];
        this._v(p0, [0, 1, 0], 0.5, 0.5);
        this._v(p1, [0, 1, 0], 0.5 + c0 * 0.5, 0.5 + s0 * 0.5);
        this._v(p2, [0, 1, 0], 0.5 + c1 * 0.5, 0.5 + s1 * 0.5);
      }
    }
    return this;
  }

  /** A flat up-facing quad on the ground plane (markings, puddles, decals). */
  ground(w, d, cx, y, cz, o = {}) {
    const { uv = 8, rotY = 0, offU = 0, offV = 0 } = o;
    const hw = w / 2;
    const hd = d / 2;
    const c = Math.cos(rotY);
    const s = Math.sin(rotY);
    const p = (x, z) => [cx + x * c + z * s, y, cz - x * s + z * c];
    this.quad(p(-hw, hd), p(hw, hd), p(hw, -hd), p(-hw, -hd), [0, 1, 0],
      [offU, offV, offU + w / uv, offV + d / uv]);
    return this;
  }

  /** A vertical quad facing `rotY` (signs, awnings, glass panes). */
  panel(w, h, cx, cy, cz, o = {}) {
    const { rotY = 0, uv = 8 } = o;
    const hw = w / 2;
    const hh = h / 2;
    const c = Math.cos(rotY);
    const s = Math.sin(rotY);
    const p = (x, y) => [cx + x * c, cy + y, cz - x * s];
    this.quad(p(-hw, -hh), p(hw, -hh), p(hw, hh), p(-hw, hh), [s, 0, c],
      [0, 0, w / uv, h / uv]);
    return this;
  }

  get empty() {
    return this.verts === 0;
  }

  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    if (this.col) g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.computeBoundingSphere();
    return g;
  }

  /** Convenience: a merged mesh with the given material, positioned at the origin. */
  mesh(material, { cast = true, receive = true } = {}) {
    if (this.empty) return null;
    const m = new THREE.Mesh(this.build(), material);
    m.castShadow = cast;
    m.receiveShadow = receive;
    m.matrixAutoUpdate = false;
    m.updateMatrix();
    return m;
  }
}

/** Concatenate buffer geometries that share a layout (position/normal/uv[/color]). */
export function mergeGeometries(geoms) {
  const list = geoms.filter(Boolean).map((g) => (g.index ? g.toNonIndexed() : g));
  const hasColour = list.some((g) => g.getAttribute('color'));
  const pos = [];
  const nor = [];
  const uv = [];
  const col = [];
  for (const g of list) {
    const p = g.getAttribute('position');
    const n = g.getAttribute('normal');
    const t = g.getAttribute('uv');
    const c = g.getAttribute('color');
    for (let i = 0; i < p.count; i += 1) {
      pos.push(p.getX(i), p.getY(i), p.getZ(i));
      nor.push(n ? n.getX(i) : 0, n ? n.getY(i) : 1, n ? n.getZ(i) : 0);
      uv.push(t ? t.getX(i) : 0, t ? t.getY(i) : 0);
      if (hasColour) col.push(c ? c.getX(i) : 1, c ? c.getY(i) : 1, c ? c.getZ(i) : 1);
    }
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  out.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  if (hasColour) out.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  out.computeBoundingSphere();
  return out;
}

/** Standard material with the game's defaults, so surfaces stay consistent. */
export function standard(params = {}) {
  return new THREE.MeshStandardMaterial({
    roughness: 0.78,
    metalness: 0.05,
    ...params,
  });
}

/** Walk an object and set shadow flags on every mesh below it. */
export function setShadows(root, cast = true, receive = true) {
  root.traverse((o) => {
    if (o.isMesh) {
      o.castShadow = cast;
      o.receiveShadow = receive;
    }
  });
  return root;
}

/** A cached spawn point on a pavement near a position — used for pedestrians and officers. */
export function jitterPoint(rng, x, z, r) {
  const a = rng() * TAU;
  const d = Math.sqrt(rng()) * r;
  return { x: x + Math.cos(a) * d, z: z + Math.sin(a) * d };
}
