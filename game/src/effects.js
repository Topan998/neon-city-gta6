// Small visual events: bullet tracers, sparks, blood, dust and the fireball of a wreck. Everything
// is pooled — a fixed number of points and lines made at boot — so combat never allocates.

import { mergeParts, box, makeModelMaterial } from './shape.js';

const MAX_PARTICLES = 420;
const MAX_TRACERS = 24;

export function createEffects(scene) {
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

  function spawn(x, y, z, vx, vy, vz, colour, life, size) {
    const index = cursor;
    cursor = (cursor + 1) % MAX_PARTICLES;
    positions[index * 3] = x;
    positions[index * 3 + 1] = y;
    positions[index * 3 + 2] = z;
    velocities[index * 3] = vx;
    velocities[index * 3 + 1] = vy;
    velocities[index * 3 + 2] = vz;
    const c = new THREE.Color(colour);
    colours[index * 3] = c.r;
    colours[index * 3 + 1] = c.g;
    colours[index * 3 + 2] = c.b;
    lives[index] = life;
    maxLives[index] = life;
    sizes[index] = size;
  }

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
          normal.x * 2 + (Math.random() - 0.5) * spread,
          Math.abs(normal.y) * 2 + Math.random() * spread,
          normal.z * 2 + (Math.random() - 0.5) * spread,
          colour, 0.28 + Math.random() * 0.3, 0.16,
        );
      }
    },

    blood(x, y, z) {
      for (let i = 0; i < 7; i += 1) {
        spawn(x, y, z, (Math.random() - 0.5) * 4, Math.random() * 3, (Math.random() - 0.5) * 4, 0x9c1220, 0.4, 0.2);
      }
    },

    dust(x, y, z) {
      for (let i = 0; i < 5; i += 1) {
        spawn(x, y, z, (Math.random() - 0.5) * 2.4, Math.random() * 1.6, (Math.random() - 0.5) * 2.4, 0xcfc6b4, 0.5, 0.22);
      }
    },

    explosion(x, y, z) {
      for (let i = 0; i < 46; i += 1) {
        spawn(
          x, y, z,
          (Math.random() - 0.5) * 12,
          Math.random() * 9,
          (Math.random() - 0.5) * 12,
          i % 3 === 0 ? 0xffe08a : i % 3 === 1 ? 0xff7a3c : 0x3a3a40,
          0.6 + Math.random() * 0.7, 0.5,
        );
      }
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
