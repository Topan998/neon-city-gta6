// effects.js — the flourishes: muzzle flashes, tracers, impact sparks, blood, tyre smoke, dust and
// the rain system behind ?rain=1. Everything is pooled — a burst reuses a particle slot rather than
// allocating, so a firefight never triggers a garbage collection.

const THREE = window.THREE;

import { TAU, clamp, lerp, randRange, mulberry32, TEX, textureFrom, canvas2d } from './util.js';

const MAX_PARTICLES = 900;
const MAX_TRACERS = 14;

/** A soft vertical streak for rain: a thin bright line that fades at both ends. */
function rainStreakTexture() {
  const { canvas, ctx } = canvas2d(8, 64);
  const g = ctx.createLinearGradient(0, 0, 0, 64);
  g.addColorStop(0, 'rgba(200,226,255,0)');
  g.addColorStop(0.4, 'rgba(200,226,255,0.75)');
  g.addColorStop(1, 'rgba(200,226,255,0.05)');
  ctx.fillStyle = g;
  ctx.fillRect(3, 0, 2, 64);
  return textureFrom(canvas, { repeat: 1 });
}

export class Effects {
  constructor(game) {
    this.game = game;
    this.scene = game.scene;
    this.rng = mulberry32(0x9911ee);
    this.shakeAmount = 0;
    this.flashTimer = 0;
    this.buildParticles();
    this.buildTracers();
    this.buildMuzzle();
    this.buildRain();
  }

  buildParticles() {
    const positions = new Float32Array(MAX_PARTICLES * 3);
    const colours = new Float32Array(MAX_PARTICLES * 3);
    const sizes = new Float32Array(MAX_PARTICLES);
    for (let i = 0; i < MAX_PARTICLES; i += 1) {
      positions[i * 3 + 1] = -50;
      sizes[i] = 0.4;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(colours, 3));
    geo.setAttribute('size', new THREE.BufferAttribute(sizes, 1));
    const mat = new THREE.PointsMaterial({
      map: TEX.glow(),
      size: 0.5,
      sizeAttenuation: true,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      vertexColors: true,
      toneMapped: false,
      opacity: 0.95,
    });
    // per-point size: patch the shader so each particle can have its own scale
    mat.onBeforeCompile = (shader) => {
      shader.vertexShader = shader.vertexShader
        .replace('attribute float size;', '')
        .replace('uniform float size;', '')
        .replace('void main() {', 'attribute float size;\nvoid main() {')
        .replace('gl_PointSize = size;', 'gl_PointSize = size;');
    };
    this.points = new THREE.Points(geo, mat);
    this.points.frustumCulled = false;
    this.scene.add(this.points);
    this.particles = [];
    for (let i = 0; i < MAX_PARTICLES; i += 1) {
      this.particles.push({ life: 0, max: 1, vx: 0, vy: 0, vz: 0, x: 0, y: -50, z: 0, size: 0.5, drag: 2, gravity: -9 });
    }
    this.cursor = 0;
  }

  buildTracers() {
    this.tracers = [];
    const geo = new THREE.BoxGeometry(0.04, 0.04, 1);
    for (let i = 0; i < MAX_TRACERS; i += 1) {
      const mat = new THREE.MeshBasicMaterial({
        color: 0xffe6a8, transparent: true, opacity: 0, blending: THREE.AdditiveBlending,
        depthWrite: false, toneMapped: false,
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.visible = false;
      mesh.frustumCulled = false;
      this.scene.add(mesh);
      this.tracers.push({ mesh, life: 0 });
    }
    this.tracerCursor = 0;
  }

  buildMuzzle() {
    const geo = new THREE.PlaneGeometry(1.1, 1.1);
    const mat = new THREE.MeshBasicMaterial({
      map: TEX.glow(), color: 0xffd9a0, transparent: true, opacity: 0.9,
      blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false,
    });
    this.muzzle = new THREE.Mesh(geo, mat);
    this.muzzle.visible = false;
    this.scene.add(this.muzzle);
    this.muzzleLife = 0;
  }

  buildRain() {
    const count = 2600;
    const positions = new Float32Array(count * 6);
    const rng = this.rng;
    this.rainVel = new Float32Array(count);
    this.rainCount = count;
    for (let i = 0; i < count; i += 1) {
      const x = randRange(rng, -60, 60);
      const y = randRange(rng, 0, 42);
      const z = randRange(rng, -60, 60);
      const len = randRange(rng, 0.5, 1.3);
      positions[i * 6] = x;
      positions[i * 6 + 1] = y;
      positions[i * 6 + 2] = z;
      positions[i * 6 + 3] = x + 0.06;
      positions[i * 6 + 4] = y - len;
      positions[i * 6 + 5] = z;
      this.rainVel[i] = randRange(rng, 26, 42);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const mat = new THREE.LineBasicMaterial({
      color: 0xbcd6f0, transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending,
      depthWrite: false, toneMapped: false,
    });
    this.rain = new THREE.LineSegments(geo, mat);
    this.rain.frustumCulled = false;
    this.rain.visible = false;
    this.scene.add(this.rain);
    this.rainEnabled = false;
  }

  setRain(on) {
    this.rainEnabled = on;
    this.rain.visible = on;
  }

  /** Grab a particle slot: the oldest one if we are full. */
  spawn(x, y, z, opts) {
    const p = this.particles[this.cursor];
    this.cursor = (this.cursor + 1) % MAX_PARTICLES;
    p.x = x;
    p.y = y;
    p.z = z;
    p.vx = opts.vx ?? 0;
    p.vy = opts.vy ?? 0;
    p.vz = opts.vz ?? 0;
    p.life = opts.life ?? 0.5;
    p.max = p.life;
    p.size = opts.size ?? 0.35;
    p.drag = opts.drag ?? 3;
    p.gravity = opts.gravity ?? -9;
    p.r = opts.r ?? 1;
    p.g = opts.g ?? 1;
    p.b = opts.b ?? 1;
    return p;
  }

  muzzleFlash(position, quaternion) {
    this.muzzle.visible = true;
    this.muzzle.position.copy(position);
    if (quaternion) this.muzzle.quaternion.copy(quaternion);
    this.muzzle.scale.setScalar(randRange(this.rng, 0.8, 1.3));
    this.muzzleLife = 0.06;
    for (let i = 0; i < 5; i += 1) {
      this.spawn(position.x, position.y, position.z, {
        vx: randRange(this.rng, -2, 2), vy: randRange(this.rng, -0.5, 2), vz: randRange(this.rng, -2, 2),
        life: 0.12, size: 0.3, r: 1, g: 0.8, b: 0.45, gravity: 0, drag: 6,
      });
    }
  }

  tracer(from, to, colour = 0xffe6a8) {
    const slot = this.tracers[this.tracerCursor];
    this.tracerCursor = (this.tracerCursor + 1) % MAX_TRACERS;
    const mesh = slot.mesh;
    const len = from.distanceTo(to);
    mesh.visible = true;
    mesh.material.color.setHex(colour);
    mesh.material.opacity = 0.85;
    mesh.position.copy(from).add(to).multiplyScalar(0.5);
    mesh.lookAt(to);
    mesh.scale.set(1, 1, len);
    slot.life = 0.06;
  }

  sparks(x, y, z, count = 8, colour = 0xffb04a) {
    const c = new THREE.Color(colour);
    for (let i = 0; i < count; i += 1) {
      this.spawn(x, y, z, {
        vx: randRange(this.rng, -5, 5),
        vy: randRange(this.rng, 1.5, 6.5),
        vz: randRange(this.rng, -5, 5),
        life: randRange(this.rng, 0.25, 0.6),
        size: randRange(this.rng, 0.1, 0.22),
        r: c.r, g: c.g, b: c.b, gravity: -14, drag: 1.2,
      });
    }
  }

  blood(x, y, z) {
    for (let i = 0; i < 12; i += 1) {
      this.spawn(x, y, z, {
        vx: randRange(this.rng, -2.4, 2.4),
        vy: randRange(this.rng, 0.5, 3.4),
        vz: randRange(this.rng, -2.4, 2.4),
        life: randRange(this.rng, 0.3, 0.8),
        size: randRange(this.rng, 0.12, 0.3),
        r: 0.42, g: 0.03, b: 0.05, gravity: -11, drag: 2,
      });
    }
  }

  dust(x, y, z) {
    if (this.rng() > 0.5) return;
    this.spawn(x, y + 0.05, z, {
      vx: randRange(this.rng, -0.6, 0.6),
      vy: randRange(this.rng, 0.2, 1),
      vz: randRange(this.rng, -0.6, 0.6),
      life: randRange(this.rng, 0.25, 0.5),
      size: randRange(this.rng, 0.2, 0.4),
      r: 0.5, g: 0.48, b: 0.45, gravity: -0.6, drag: 3,
    });
  }

  tyreSmoke(x, y, z, strength = 1) {
    for (let i = 0; i < 3; i += 1) {
      this.spawn(x + randRange(this.rng, -0.4, 0.4), y + 0.1, z + randRange(this.rng, -0.4, 0.4), {
        vx: randRange(this.rng, -1.6, 1.6) * strength,
        vy: randRange(this.rng, 0.3, 1.6),
        vz: randRange(this.rng, -1.6, 1.6) * strength,
        life: randRange(this.rng, 0.5, 1.2),
        size: randRange(this.rng, 0.4, 0.9) * strength,
        r: 0.62, g: 0.62, b: 0.64, gravity: 0.4, drag: 1.4,
      });
    }
  }

  shake(amount) {
    const player = this.game.player;
    if (player) player.shake = Math.min(1.2, player.shake + amount);
  }

  update(dt) {
    // particles
    const pos = this.points.geometry.getAttribute('position');
    const col = this.points.geometry.getAttribute('color');
    const siz = this.points.geometry.getAttribute('size');
    for (let i = 0; i < MAX_PARTICLES; i += 1) {
      const p = this.particles[i];
      if (p.life <= 0) {
        if (pos.getY(i) > -40) {
          pos.setY(i, -50);
        }
        continue;
      }
      p.life -= dt;
      const d = Math.exp(-p.drag * dt);
      p.vx *= d;
      p.vz *= d;
      p.vy = p.vy * d + p.gravity * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.z += p.vz * dt;
      if (p.y < 0.02) {
        p.y = 0.02;
        p.vy *= -0.25;
      }
      const k = clamp(p.life / p.max, 0, 1);
      pos.setXYZ(i, p.x, p.y, p.z);
      col.setXYZ(i, p.r * k, p.g * k, p.b * k);
      siz.setX(i, p.size * (p.max < 0.3 ? k : 1 + (1 - k) * 1.4));
    }
    pos.needsUpdate = true;
    col.needsUpdate = true;
    siz.needsUpdate = true;

    // tracers
    for (const t of this.tracers) {
      if (t.life > 0) {
        t.life -= dt;
        t.mesh.material.opacity = clamp(t.life / 0.06, 0, 1) * 0.85;
        if (t.life <= 0) t.mesh.visible = false;
      }
    }

    // muzzle
    if (this.muzzleLife > 0) {
      this.muzzleLife -= dt;
      if (this.muzzleLife <= 0) this.muzzle.visible = false;
    }

    // rain follows the camera and falls
    if (this.rainEnabled) {
      const cam = this.game.camera;
      const attr = this.rain.geometry.getAttribute('position');
      const arr = attr.array;
      const cx = cam.position.x;
      const cz = cam.position.z;
      for (let i = 0; i < this.rainCount; i += 1) {
        const o = i * 6;
        const fall = this.rainVel[i] * dt;
        arr[o + 1] -= fall;
        arr[o + 4] -= fall;
        if (arr[o + 4] < 0) {
          const x = cx + randRange(this.rng, -55, 55);
          const z = cz + randRange(this.rng, -55, 55);
          const len = randRange(this.rng, 0.5, 1.3);
          arr[o] = x;
          arr[o + 1] = 38 + this.rng() * 8;
          arr[o + 2] = z;
          arr[o + 3] = x + 0.06;
          arr[o + 4] = 38 + this.rng() * 8 - len;
          arr[o + 5] = z;
        }
      }
      attr.needsUpdate = true;
    }
  }
}
