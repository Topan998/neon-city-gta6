// Small visual events: bullet tracers, sparks, blood, dust and the fireball of a wreck, plus the
// rain of `?rain=1`. Everything is pooled — a fixed number of points and lines made at boot — so
// combat and weather never allocate, and every particle draws from a seeded generator so a staged
// screenshot is the same picture on every run.
//
// `glowTexture` is the shared soft dot the police light bar and the headlights bloom with.

import { WEATHER } from './config.js';
import { createRandom } from './random.js';

const MAX_PARTICLES = 420;
const MAX_TRACERS = 24;

let glow = null;

/** A soft white radial dot, made once, tinted per use by a SpriteMaterial. */
export function glowTexture() {
  if (glow) return glow;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 128;
  const g = canvas.getContext('2d');
  const gradient = g.createRadialGradient(64, 64, 2, 64, 64, 62);
  gradient.addColorStop(0, 'rgba(255,255,255,1)');
  gradient.addColorStop(0.25, 'rgba(255,255,255,0.72)');
  gradient.addColorStop(0.6, 'rgba(255,255,255,0.18)');
  gradient.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gradient;
  g.fillRect(0, 0, 128, 128);
  glow = new THREE.CanvasTexture(canvas);
  glow.colorSpace = THREE.SRGBColorSpace;
  return glow;
}

export function createEffects(scene) {
  const random = createRandom(5531);
  const positions = new Float32Array(MAX_PARTICLES * 3);
  const colours = new Float32Array(MAX_PARTICLES * 3);
  const velocities = new Float32Array(MAX_PARTICLES * 3);
  const lives = new Float32Array(MAX_PARTICLES);
  const maxLives = new Float32Array(MAX_PARTICLES);
  const sizes = new Float32Array(MAX_PARTICLES);
  let cursor = 0;

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(colours, 3));
  const points = new THREE.Points(
    geometry,
    new THREE.PointsMaterial({
      size: 0.24, vertexColors: true, transparent: true, opacity: 0.95,
      depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: true,
    }),
  );
  points.frustumCulled = false;
  scene.add(points);

  const tracers = [];
  const tracerMaterial = new THREE.LineBasicMaterial({
    color: 0xffe9a8, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false,
  });
  for (let i = 0; i < MAX_TRACERS; i += 1) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
    const line = new THREE.Line(geo, tracerMaterial.clone());
    line.frustumCulled = false;
    line.visible = false;
    scene.add(line);
    tracers.push({ line, life: 0 });
  }
  let tracerCursor = 0;

  // All particles start dead and far away.
  for (let i = 0; i < MAX_PARTICLES; i += 1) positions[i * 3 + 1] = -999;

  const colourCache = new Map();
  function tint(colour) {
    let entry = colourCache.get(colour);
    if (!entry) {
      entry = new THREE.Color(colour);
      colourCache.set(colour, entry);
    }
    return entry;
  }

  function spawn(x, y, z, vx, vy, vz, colour, life, size) {
    const index = cursor;
    cursor = (cursor + 1) % MAX_PARTICLES;
    positions[index * 3] = x;
    positions[index * 3 + 1] = y;
    positions[index * 3 + 2] = z;
    velocities[index * 3] = vx;
    velocities[index * 3 + 1] = vy;
    velocities[index * 3 + 2] = vz;
    const c = tint(colour);
    colours[index * 3] = c.r;
    colours[index * 3 + 1] = c.g;
    colours[index * 3 + 2] = c.b;
    lives[index] = life;
    maxLives[index] = life;
    sizes[index] = size;
  }

  // ---- rain: one pool of drops that lives in a box around the camera ----
  const dropCount = WEATHER.drops;
  const dropGeometry = new THREE.BufferGeometry();
  const dropPositions = new Float32Array(dropCount * 3);
  const dropX = new Float32Array(dropCount);
  const dropZ = new Float32Array(dropCount);
  const dropPhase = new Float32Array(dropCount);
  const dropSpeed = new Float32Array(dropCount);
  for (let i = 0; i < dropCount; i += 1) {
    dropX[i] = (random() - 0.5) * WEATHER.area * 2;
    dropZ[i] = (random() - 0.5) * WEATHER.area * 2;
    dropPhase[i] = random() * WEATHER.top;
    dropSpeed[i] = WEATHER.fall * (0.82 + random() * 0.42);
  }
  dropGeometry.setAttribute('position', new THREE.BufferAttribute(dropPositions, 3));
  const rain = new THREE.Points(
    dropGeometry,
    new THREE.PointsMaterial({
      color: 0xbfd6f2, size: 0.16, transparent: true, opacity: 0.5,
      depthWrite: false, sizeAttenuation: true, fog: false,
    }),
  );
  rain.frustumCulled = false;
  rain.visible = false;
  scene.add(rain);

  return {
    /** A short line from the muzzle to whatever the bullet found. */
    tracer(from, to, colour = 0xffe9a8) {
      const entry = tracers[tracerCursor];
      tracerCursor = (tracerCursor + 1) % MAX_TRACERS;
      const array = entry.line.geometry.getAttribute('position');
      array.setXYZ(0, from.x, from.y, from.z);
      array.setXYZ(1, to.x, to.y, to.z);
      array.needsUpdate = true;
      entry.line.material.color.setHex(colour);
      entry.line.material.opacity = 0.95;
      entry.line.visible = true;
      entry.life = 0.07;
    },

    /** Sparks off metal or concrete. */
    sparks(x, y, z, normal = { x: 0, y: 1, z: 0 }, count = 8, colour = 0xffcf8a) {
      for (let i = 0; i < count; i += 1) {
        const spread = 4.5;
        spawn(
          x, y, z,
          normal.x * 2 + (random() - 0.5) * spread,
          Math.abs(normal.y) * 2 + random() * spread,
          normal.z * 2 + (random() - 0.5) * spread,
          colour, 0.28 + random() * 0.3, 0.16,
        );
      }
    },

    blood(x, y, z) {
      for (let i = 0; i < 7; i += 1) {
        spawn(x, y, z, (random() - 0.5) * 4, random() * 3, (random() - 0.5) * 4, 0x9c1220, 0.4, 0.2);
      }
    },

    dust(x, y, z) {
      for (let i = 0; i < 5; i += 1) {
        spawn(x, y, z, (random() - 0.5) * 2.4, random() * 1.6, (random() - 0.5) * 2.4, 0xcfc6b4, 0.5, 0.22);
      }
    },

    explosion(x, y, z) {
      for (let i = 0; i < 46; i += 1) {
        spawn(
          x, y, z,
          (random() - 0.5) * 12,
          random() * 9,
          (random() - 0.5) * 12,
          i % 3 === 0 ? 0xffe08a : i % 3 === 1 ? 0xff7a3c : 0x3a3a40,
          0.6 + random() * 0.7, 0.5,
        );
      }
    },

    /** Turn the shower on or off; the drops keep their offsets and just start falling. */
    setRain(on) {
      rain.visible = Boolean(on);
    },

    /** The shower: the box of drops is re-centred on whoever the camera is following. */
    updateRain(dt, focus) {
      if (!rain.visible || !focus) return;
      const top = WEATHER.top;
      for (let i = 0; i < dropCount; i += 1) {
        dropPhase[i] += dropSpeed[i] * dt;
        if (dropPhase[i] > top) dropPhase[i] -= top;
        dropPositions[i * 3] = focus.x + dropX[i];
        dropPositions[i * 3 + 1] = top - dropPhase[i];
        dropPositions[i * 3 + 2] = focus.z + dropZ[i];
      }
      dropGeometry.getAttribute('position').needsUpdate = true;
    },

    update(dt) {
      for (let i = 0; i < MAX_PARTICLES; i += 1) {
        if (lives[i] <= 0) continue;
        lives[i] -= dt;
        if (lives[i] <= 0) {
          positions[i * 3 + 1] = -999;
          continue;
        }
        velocities[i * 3 + 1] -= 12 * dt;
        positions[i * 3] += velocities[i * 3] * dt;
        positions[i * 3 + 1] = Math.max(0.02, positions[i * 3 + 1] + velocities[i * 3 + 1] * dt);
        positions[i * 3 + 2] += velocities[i * 3 + 2] * dt;
        velocities[i * 3] *= 0.96;
        velocities[i * 3 + 2] *= 0.96;
        const fade = lives[i] / maxLives[i];
        colours[i * 3] *= 0.995;
        colours[i * 3 + 1] *= 0.995;
        colours[i * 3 + 2] *= 0.995;
        if (fade < 0.2) sizes[i] = Math.max(0.05, sizes[i] * 0.98);
      }
      geometry.getAttribute('position').needsUpdate = true;
      geometry.getAttribute('color').needsUpdate = true;

      for (const entry of tracers) {
        if (entry.life <= 0) continue;
        entry.life -= dt;
        entry.line.material.opacity = Math.max(0, entry.life / 0.07) * 0.95;
        if (entry.life <= 0) entry.line.visible = false;
      }
    },
  };
}

/** A soft round shadow under a character, so nothing floats over the pavement in flat light. */
export function createBlobShadow(scene, size = 1.1) {
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 64;
  const g = canvas.getContext('2d');
  const gradient = g.createRadialGradient(32, 32, 2, 32, 32, 30);
  gradient.addColorStop(0, 'rgba(0,0,0,0.55)');
  gradient.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = gradient;
  g.fillRect(0, 0, 64, 64);
  const texture = new THREE.CanvasTexture(canvas);
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(size, size),
    new THREE.MeshBasicMaterial({ map: texture, transparent: true, depthWrite: false }),
  );
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.y = 0.03;
  scene.add(mesh);
  return mesh;
}
