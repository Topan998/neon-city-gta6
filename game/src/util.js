// util.js — maths, a seeded RNG and the canvas-texture builders the city and cars are skinned with.
// Nothing here touches the renderer, so it is safe to import from any module.

import THREE from './three-shim.js';

export const TAU = Math.PI * 2;
export const DEG = Math.PI / 180;

export const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const invLerp = (a, b, v) => (b === a ? 0 : (v - a) / (b - a));
export const smoothstep = (t) => {
  const x = clamp(t, 0, 1);
  return x * x * (3 - 2 * x);
};
export const easeOutCubic = (t) => 1 - Math.pow(1 - clamp(t, 0, 1), 3);
export const easeInOutQuad = (t) => {
  const x = clamp(t, 0, 1);
  return x < 0.5 ? 2 * x * x : 1 - Math.pow(-2 * x + 2, 2) / 2;
};

// Frame-rate independent exponential approach.
export const damp = (current, target, lambda, dt) =>
  lerp(current, target, 1 - Math.exp(-lambda * dt));

export const wrapAngle = (a) => {
  let x = (a + Math.PI) % TAU;
  if (x < 0) x += TAU;
  return x - Math.PI;
};
export const angleDiff = (from, to) => wrapAngle(to - from);
export const angleLerp = (a, b, t) => a + angleDiff(a, b) * clamp(t, 0, 1);
export const angleDamp = (a, b, lambda, dt) => a + angleDiff(a, b) * (1 - Math.exp(-lambda * dt));

export const sign = (v) => (v < 0 ? -1 : 1);

// Distance from p to the segment ab, in the XZ plane.
export function distToSegment(px, pz, ax, az, bx, bz) {
  const dx = bx - ax;
  const dz = bz - az;
  const len2 = dx * dx + dz * dz;
  let t = len2 > 1e-6 ? ((px - ax) * dx + (pz - az) * dz) / len2 : 0;
  t = clamp(t, 0, 1);
  const cx = ax + dx * t;
  const cz = az + dz * t;
  return Math.hypot(px - cx, pz - cz);
}

// mulberry32: small, fast, good enough, and identical on every machine.
export class RNG {
  constructor(seed = 1) {
    this.state = (seed >>> 0) || 1;
  }
  next() {
    let t = (this.state += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  range(a, b) {
    return a + (b - a) * this.next();
  }
  int(a, b) {
    return Math.floor(this.range(a, b + 1 - 1e-9));
  }
  pick(list) {
    return list[Math.min(list.length - 1, Math.floor(this.next() * list.length))];
  }
  chance(p) {
    return this.next() < p;
  }
  sign() {
    return this.next() < 0.5 ? -1 : 1;
  }
  // A shuffled copy of an array, Fisher-Yates driven by this generator.
  shuffle(list) {
    const out = list.slice();
    for (let i = out.length - 1; i > 0; i--) {
      const j = Math.floor(this.next() * (i + 1));
      const tmp = out[i];
      out[i] = out[j];
      out[j] = tmp;
    }
    return out;
  }
}

// Merge a list of geometries that share a material into one non-indexed geometry. Used by the car
// factory so a whole body (shell, roof, bumpers, mirrors) is a single draw call.
export function mergeGeos(list) {
  let total = 0;
  const parts = [];
  for (const g of list) {
    const ng = g.index ? g.toNonIndexed() : g;
    parts.push(ng);
    total += ng.attributes.position.count;
  }
  const pos = new Float32Array(total * 3);
  const nrm = new Float32Array(total * 3);
  const uv = new Float32Array(total * 2);
  let o = 0;
  for (const g of parts) {
    const c = g.attributes.position.count;
    pos.set(g.attributes.position.array, o * 3);
    if (g.attributes.normal) nrm.set(g.attributes.normal.array, o * 3);
    if (g.attributes.uv) uv.set(g.attributes.uv.array, o * 2);
    o += c;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  out.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  out.computeBoundingSphere();
  return out;
}

// Small canvas helpers ------------------------------------------------------
export function makeCanvas(w, h) {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  return { canvas, ctx: canvas.getContext('2d') };
}

export function fontCanvas(size, weight = '700') {
  return `${weight} ${size}px "Helvetica Neue", Helvetica, Arial, sans-serif`;
}

export function toTexture(canvas, opts = {}) {
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = opts.wrapS ?? THREE.RepeatWrapping;
  tex.wrapT = opts.wrapT ?? THREE.RepeatWrapping;
  tex.anisotropy = opts.anisotropy ?? 4;
  tex.colorSpace = opts.linear ? THREE.NoColorSpace : THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  if (opts.repeat) tex.repeat.set(opts.repeat[0], opts.repeat[1]);
  return tex;
}

// A soft radial blob, used for lamp pools, headlight spill, smoke and sparks.
export function radialTexture(size = 128, inner = 'rgba(255,255,255,0.95)', outer = 'rgba(255,255,255,0)') {
  const { canvas, ctx } = makeCanvas(size, size);
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, inner);
  g.addColorStop(0.45, 'rgba(255,255,255,0.35)');
  g.addColorStop(1, outer);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  return toTexture(canvas, { wrapS: THREE.ClampToEdgeWrapping, wrapT: THREE.ClampToEdgeWrapping });
}

// Asphalt: dark grain, tar patches, faint cracks. Tinted per material so day and night share it.
export function asphaltTexture(rng, size = 512) {
  const { canvas, ctx } = makeCanvas(size, size);
  ctx.fillStyle = '#3a3b40';
  ctx.fillRect(0, 0, size, size);

  // Grain.
  const img = ctx.getImageData(0, 0, size, size);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = 26 + rng.next() * 46;
    d[i] = clamp(d[i] + n - 23, 0, 255);
    d[i + 1] = clamp(d[i + 1] + n - 23, 0, 255);
    d[i + 2] = clamp(d[i + 2] + n - 20, 0, 255);
  }
  ctx.putImageData(img, 0, 0);

  // Tar patches.
  for (let i = 0; i < 26; i++) {
    const x = rng.range(0, size);
    const y = rng.range(0, size);
    const r = rng.range(8, 60);
    ctx.beginPath();
    ctx.ellipse(x, y, r, r * rng.range(0.35, 0.9), rng.range(0, TAU), 0, TAU);
    ctx.fillStyle = `rgba(20,21,24,${rng.range(0.12, 0.4)})`;
    ctx.fill();
  }

  // Cracks.
  ctx.lineWidth = 1;
  for (let i = 0; i < 18; i++) {
    let x = rng.range(0, size);
    let y = rng.range(0, size);
    ctx.beginPath();
    ctx.moveTo(x, y);
    for (let s = 0; s < 6; s++) {
      x += rng.range(-26, 26);
      y += rng.range(-26, 26);
      ctx.lineTo(x, y);
    }
    ctx.strokeStyle = `rgba(16,17,19,${rng.range(0.2, 0.45)})`;
    ctx.stroke();
  }

  // Faint tyre polish lanes.
  ctx.fillStyle = 'rgba(255,255,255,0.018)';
  for (let i = 0; i < 3; i++) ctx.fillRect(0, rng.range(0, size), size, rng.range(20, 70));

  return toTexture(canvas);
}

// Paving slabs for sidewalks: jointed rectangles with gravel speckle.
export function sidewalkTexture(rng, size = 256) {
  const { canvas, ctx } = makeCanvas(size, size);
  ctx.fillStyle = '#8e8a82';
  ctx.fillRect(0, 0, size, size);
  const cell = size / 4;
  for (let y = 0; y < 4; y++) {
    for (let x = 0; x < 4; x++) {
      const shade = 132 + Math.floor(rng.range(-14, 16));
      ctx.fillStyle = `rgb(${shade},${shade - 3},${shade - 10})`;
      ctx.fillRect(x * cell + 1.5, y * cell + 1.5, cell - 3, cell - 3);
      for (let i = 0; i < 30; i++) {
        ctx.fillStyle = `rgba(60,58,54,${rng.range(0.03, 0.12)})`;
        ctx.fillRect(x * cell + rng.range(3, cell - 3), y * cell + rng.range(3, cell - 3), 2, 2);
      }
    }
  }
  ctx.strokeStyle = 'rgba(60,58,54,0.5)';
  ctx.lineWidth = 2;
  for (let i = 0; i <= 4; i++) {
    ctx.beginPath();
    ctx.moveTo(i * cell, 0);
    ctx.lineTo(i * cell, size);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(0, i * cell);
    ctx.lineTo(size, i * cell);
    ctx.stroke();
  }
  return toTexture(canvas);
}

// A facade tile: 3 bays by 3 floors, seamless because every cell sits inside the tile. Returns
// the colour map and a matching emissive map with a random subset of windows lit at night.
export function facadeTexture(rng, style = 'concrete') {
  const size = 256;
  const cols = 3;
  const rows = 3;
  const cw = size / cols;
  const ch = size / rows;

  const base = { concrete: [176, 172, 164], brick: [140, 86, 72], panel: [128, 132, 136], glass: [96, 112, 124] }[style];
  const map = makeCanvas(size, size);
  map.ctx.fillStyle = `rgb(${base[0]},${base[1]},${base[2]})`;
  map.ctx.fillRect(0, 0, size, size);

  // Wall grain.
  for (let i = 0; i < 900; i++) {
    const a = rng.range(0.02, 0.09);
    map.ctx.fillStyle = rng.chance(0.5) ? `rgba(255,255,255,${a})` : `rgba(0,0,0,${a})`;
    map.ctx.fillRect(rng.range(0, size), rng.range(0, size), rng.range(1, 3), rng.range(1, 3));
  }

  // Floor bands.
  for (let r = 0; r < rows; r++) {
    map.ctx.fillStyle = 'rgba(0,0,0,0.12)';
    map.ctx.fillRect(0, r * ch + ch - 4, size, 3);
    map.ctx.fillStyle = 'rgba(255,255,255,0.05)';
    map.ctx.fillRect(0, r * ch + ch - 7, size, 2);
  }

  const emi = makeCanvas(size, size);
  emi.ctx.fillStyle = '#000000';
  emi.ctx.fillRect(0, 0, size, size);

  const winW = cw * 0.56;
  const winH = ch * 0.52;
  const litChance = style === 'glass' ? 0.34 : 0.26;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const x = c * cw + (cw - winW) / 2;
      const y = r * ch + (ch - winH) / 2;
      const lit = rng.chance(litChance);

      // Glass: deep blue-green with a vertical sheen.
      const grad = map.ctx.createLinearGradient(x, y, x, y + winH);
      const tint = style === 'glass' ? 46 : 38;
      grad.addColorStop(0, `rgb(${tint + 18},${tint + 30},${tint + 40})`);
      grad.addColorStop(0.55, `rgb(${tint + 4},${tint + 14},${tint + 24})`);
      grad.addColorStop(1, `rgb(${tint + 10},${tint + 20},${tint + 26})`);
      map.ctx.fillStyle = grad;
      map.ctx.fillRect(x, y, winW, winH);

      // Frame.
      map.ctx.strokeStyle = 'rgba(24,26,30,0.85)';
      map.ctx.lineWidth = 2.5;
      map.ctx.strokeRect(x, y, winW, winH);
      map.ctx.fillStyle = 'rgba(230,228,222,0.35)';
      map.ctx.fillRect(x - 2, y + winH, winW + 4, 3);

      // Sills and mullion.
      map.ctx.fillStyle = 'rgba(200,198,192,0.22)';
      map.ctx.fillRect(x + winW / 2 - 1, y, 2, winH);

      if (lit) {
        const warm = rng.chance(0.72);
        const col = warm ? [255, 214, 148] : [186, 224, 255];
        emi.ctx.fillStyle = `rgba(${col[0]},${col[1]},${col[2]},${rng.range(0.55, 1)})`;
        emi.ctx.fillRect(x, y, winW, winH);
        // Blind lines break up the glow.
        emi.ctx.fillStyle = 'rgba(0,0,0,0.35)';
        for (let b = 0; b < 4; b++) emi.ctx.fillRect(x, y + (b + 1) * (winH / 5), winW, 2);
      }
    }
  }

  return {
    map: toTexture(map.canvas),
    emissive: toTexture(emi.canvas),
  };
}

export function roofTexture(rng, size = 128) {
  const { canvas, ctx } = makeCanvas(size, size);
  ctx.fillStyle = '#6b6a66';
  ctx.fillRect(0, 0, size, size);
  for (let i = 0; i < 2600; i++) {
    const v = Math.floor(rng.range(70, 130));
    ctx.fillStyle = `rgba(${v},${v - 2},${v - 6},0.5)`;
    ctx.fillRect(rng.range(0, size), rng.range(0, size), 2, 2);
  }
  return toTexture(canvas);
}

// Street-level storefronts: dark glazing, warm interiors, a fascia band over the top. One tile is
// one shop unit, so the band reads as a row of shops along the kerb.
export function shopTexture(rng) {
  const w = 256;
  const h = 128;
  const { canvas, ctx } = makeCanvas(w, h);
  const emi = makeCanvas(w, h);

  ctx.fillStyle = '#20242a';
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = '#14161a';
  ctx.fillRect(0, 0, w, 26);
  emi.ctx.fillStyle = '#000000';
  emi.ctx.fillRect(0, 0, w, h);

  const units = 2;
  const unitW = w / units;
  const palette = ['#ffd9a0', '#ffe9c4', '#bfe4ff', '#ffc27a'];
  for (let u = 0; u < units; u++) {
    const x0 = u * unitW + 8;
    const glassW = unitW - 20;
    const y0 = 34;
    const glassH = h - 46;

    // Warm interior behind the glass.
    const grad = ctx.createLinearGradient(0, y0, 0, y0 + glassH);
    const warm = palette[Math.floor(rng.next() * palette.length)];
    grad.addColorStop(0, warm);
    grad.addColorStop(0.5, 'rgba(120,96,70,0.75)');
    grad.addColorStop(1, 'rgba(28,26,24,0.95)');
    ctx.fillStyle = grad;
    ctx.fillRect(x0, y0, glassW, glassH);

    // Shelves and a counter, silhouettes against the light.
    ctx.fillStyle = 'rgba(20,18,16,0.65)';
    ctx.fillRect(x0, y0 + glassH * 0.55, glassW, 4);
    ctx.fillRect(x0, y0 + glassH * 0.78, glassW, 6);
    for (let s = 0; s < 5; s++) {
      const sx = x0 + rng.range(0.05, 0.85) * glassW;
      const sh = rng.range(0.15, 0.4) * glassH;
      ctx.fillRect(sx, y0 + glassH - sh, rng.range(6, 16), sh);
    }

    // Mullions.
    ctx.strokeStyle = 'rgba(16,18,20,0.95)';
    ctx.lineWidth = 4;
    ctx.strokeRect(x0, y0, glassW, glassH);
    ctx.beginPath();
    ctx.moveTo(x0 + glassW / 2, y0);
    ctx.lineTo(x0 + glassW / 2, y0 + glassH);
    ctx.stroke();

    // The glow that spills out of the window at night.
    emi.ctx.fillStyle = warm;
    emi.ctx.globalAlpha = rng.range(0.55, 0.95);
    emi.ctx.fillRect(x0 + 4, y0 + 4, glassW - 8, glassH - 10);
    emi.ctx.globalAlpha = 1;
    emi.ctx.fillStyle = '#000000';
    emi.ctx.fillRect(x0, y0 + glassH * 0.55, glassW, 6);
    emi.ctx.fillRect(x0 + glassW / 2 - 2, y0, 4, glassH);

    // A small fascia sign over the unit.
    ctx.fillStyle = '#0d0f12';
    ctx.fillRect(x0, 4, glassW, 18);
    ctx.font = fontCanvas(11, '800');
    ctx.textAlign = 'center';
    ctx.fillStyle = warm;
    ctx.fillText(['DELI', 'MOTEL', 'PAWN', 'SURF', 'BAR', 'LIQUOR'][Math.floor(rng.next() * 6)], x0 + glassW / 2, 17);
    emi.ctx.fillStyle = warm;
    emi.ctx.font = fontCanvas(11, '800');
    emi.ctx.textAlign = 'center';
    emi.ctx.fillText(['DELI', 'MOTEL', 'PAWN', 'SURF', 'BAR', 'LIQUOR'][Math.floor(rng.next() * 6)], x0 + glassW / 2, 17);
  }

  return { map: toTexture(canvas), emissive: toTexture(emi.canvas) };
}

// Glowing shop sign: bold text on a dark plate, with a little bloom in the plate.
export function signTexture(text, color, size = 256) {
  const { canvas, ctx } = makeCanvas(size, size / 2);
  ctx.fillStyle = '#0b0d12';
  ctx.fillRect(0, 0, size, size / 2);
  ctx.strokeStyle = color;
  ctx.lineWidth = 4;
  ctx.strokeRect(6, 6, size - 12, size / 2 - 12);
  ctx.font = fontCanvas(size / 6.4, '800');
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.shadowColor = color;
  ctx.shadowBlur = 18;
  ctx.fillStyle = color;
  ctx.fillText(text, size / 2, size / 4);
  ctx.shadowBlur = 0;
  ctx.fillStyle = 'rgba(255,255,255,0.85)';
  ctx.font = fontCanvas(size / 9, '800');
  ctx.fillText(text, size / 2, size / 4);
  return toTexture(canvas, { wrapS: THREE.ClampToEdgeWrapping, wrapT: THREE.ClampToEdgeWrapping });
}

// Emission texture for the wet-road neon streaks: soft vertical smears of colour.
export function streakTexture(rng, color) {
  const { canvas, ctx } = makeCanvas(64, 256);
  ctx.clearRect(0, 0, 64, 256);
  const g = ctx.createLinearGradient(0, 0, 0, 256);
  g.addColorStop(0, 'rgba(255,255,255,0.55)');
  g.addColorStop(0.4, 'rgba(255,255,255,0.14)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  for (let i = 0; i < 5; i++) {
    const x = 6 + i * 12 + rng.range(-3, 3);
    ctx.fillRect(x, 0, rng.range(2, 7), 256);
  }
  const tex = toTexture(canvas, { wrapS: THREE.ClampToEdgeWrapping, wrapT: THREE.ClampToEdgeWrapping });
  tex.userData = { color };
  return tex;
}
