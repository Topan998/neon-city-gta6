// effects.js — muzzle flashes, impact sparks, tyre smoke, hit puffs and screen shake.
//
// Two pooled THREE.Points systems (hot sparks and soft smoke) plus a single reusable flash card. Pools
// are fixed at construction, so nothing allocates while the game runs; the RNG is seeded so a staged
// screenshot can fire the same sparks every time.

import THREE from './three-shim.js';
import { RNG, clamp, TAU, radialTexture } from './util.js';

const MAX_SPARKS = 260;
const MAX_SMOKE = 180;

function softTexture(inner, outer) {
  return radialTexture(64, inner, outer);
}

export class Effects {
  constructor(scene, camera, rng) {
    this.scene = scene;
    this.camera = camera;
    this.rng = rng || new RNG(99);

    // Sparks: additive points, warm, short lived.
    const sparkGeo = new THREE.BufferGeometry();
    this.sparkPos = new Float32Array(MAX_SPARKS * 3);
    this.sparkCol = new Float32Array(MAX_SPARKS * 3);
    for (let i = 0; i < MAX_SPARKS; i++) this.sparkPos[i * 3 + 1] = -999;
    sparkGeo.setAttribute('position', new THREE.BufferAttribute(this.sparkPos, 3));
    sparkGeo.setAttribute('color', new THREE.BufferAttribute(this.sparkCol, 3));
    const sparkMat = new THREE.PointsMaterial({
      size: 0.22,
      map: softTexture('rgba(255,255,255,1)', 'rgba(255,180,80,0)'),
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      vertexColors: true,
      sizeAttenuation: true,
      opacity: 0.95,
    });
    this.sparks = new THREE.Points(sparkGeo, sparkMat);
    this.sparks.frustumCulled = false;
    scene.add(this.sparks);
    this.sparkState = [];
    for (let i = 0; i < MAX_SPARKS; i++) {
      this.sparkState.push({ life: 0, vx: 0, vy: 0, vz: 0, grav: 1 });
    }
    this.sparkCursor = 0;

    // Smoke / dust: soft alpha points that rise and fade.
    const smokeGeo = new THREE.BufferGeometry();
    this.smokePos = new Float32Array(MAX_SMOKE * 3);
    this.smokeCol = new Float32Array(MAX_SMOKE * 3);
    for (let i = 0; i < MAX_SMOKE; i++) this.smokePos[i * 3 + 1] = -999;
    smokeGeo.setAttribute('position', new THREE.BufferAttribute(this.smokePos, 3));
    smokeGeo.setAttribute('color', new THREE.BufferAttribute(this.smokeCol, 3));
    const smokeMat = new THREE.PointsMaterial({
      size: 1.6,
      map: softTexture('rgba(255,255,255,0.55)', 'rgba(255,255,255,0)'),
      transparent: true,
      depthWrite: false,
      vertexColors: true,
      sizeAttenuation: true,
      opacity: 0.55,
    });
    this.smoke = new THREE.Points(smokeGeo, smokeMat);
    this.smoke.frustumCulled = false;
    scene.add(this.smoke);
    this.smokeState = [];
    for (let i = 0; i < MAX_SMOKE; i++) this.smokeState.push({ life: 0, vx: 0, vy: 0, vz: 0 });
    this.smokeCursor = 0;

    // Muzzle flash: one small additive card that follows the camera.
    const flashTex = softTexture('rgba(255,255,240,1)', 'rgba(255,170,60,0)');
    this.flash = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: flashTex,
        color: 0xffe6b0,
        blending: THREE.AdditiveBlending,
        transparent: true,
        depthWrite: false,
        opacity: 0,
      }),
    );
    this.flash.scale.set(1.6, 1.6, 1);
    scene.add(this.flash);
    this.flashLife = 0;

    this.shake = 0;
    this.tyreAccum = 0;
  }

  spark(x, y, z, n = 8, power = 1) {
    for (let i = 0; i < n; i++) {
      const idx = this.sparkCursor;
      this.sparkCursor = (this.sparkCursor + 1) % MAX_SPARKS;
      const st = this.sparkState[idx];
      st.life = this.rng.range(0.25, 0.7);
      st.maxLife = st.life;
      st.vx = this.rng.range(-1, 1) * 5 * power;
      st.vy = this.rng.range(0.4, 1.6) * 5 * power;
      st.vz = this.rng.range(-1, 1) * 5 * power;
      st.grav = 1;
      this.sparkPos[idx * 3] = x;
      this.sparkPos[idx * 3 + 1] = y;
      this.sparkPos[idx * 3 + 2] = z;
      const warm = this.rng.range(0.6, 1);
      this.sparkCol[idx * 3] = 1;
      this.sparkCol[idx * 3 + 1] = 0.55 + warm * 0.4;
      this.sparkCol[idx * 3 + 2] = 0.2 + warm * 0.3;
    }
    this.sparks.geometry.attributes.position.needsUpdate = true;
    this.sparks.geometry.attributes.color.needsUpdate = true;
  }

  smokePuff(x, y, z, n = 3, spread = 0.5, tone = 0.72) {
    for (let i = 0; i < n; i++) {
      const idx = this.smokeCursor;
      this.smokeCursor = (this.smokeCursor + 1) % MAX_SMOKE;
      const st = this.smokeState[idx];
      st.life = this.rng.range(0.7, 1.8);
      st.maxLife = st.life;
      st.vx = this.rng.range(-1, 1) * spread;
      st.vy = this.rng.range(0.25, 0.9);
      st.vz = this.rng.range(-1, 1) * spread;
      this.smokePos[idx * 3] = x + this.rng.range(-0.35, 0.35);
      this.smokePos[idx * 3 + 1] = y + this.rng.range(0, 0.3);
      this.smokePos[idx * 3 + 2] = z + this.rng.range(-0.35, 0.35);
      this.smokeCol[idx * 3] = tone;
      this.smokeCol[idx * 3 + 1] = tone;
      this.smokeCol[idx * 3 + 2] = tone * 1.02;
    }
    this.smoke.geometry.attributes.position.needsUpdate = true;
    this.smoke.geometry.attributes.color.needsUpdate = true;
  }

  muzzle(x, y, z, dx, dz) {
    this.flash.position.set(x + dx * 0.4, y, z + dz * 0.4);
    this.flashLife = 0.055;
    this.flash.material.opacity = 0.95;
    this.flash.scale.setScalar(this.rng.range(1.3, 1.9));
    this.spark(x, y, z, 4, 0.7);
  }

  hit(x, y, z) {
    this.smokePuff(x, y, z, 3, 0.7, 0.55);
    this.spark(x, y, z, 3, 0.4);
  }

  dust(x, y, z, power = 1) {
    this.smokePuff(x, y, z, 1, 0.35, 0.62);
  }

  tyre(x, y, z, intensity = 1) {
    this.tyreAccum += intensity;
    if (this.tyreAccum > 0.6) {
      this.tyreAccum = 0;
      this.smokePuff(x, y, z, 1, 0.5, 0.66);
    }
  }

  tyreSmoke(car, dt) {
    if (Math.abs(car.lateral) < 1.6 && !car.handbrake) return;
    if (Math.abs(car.speed) < 3) return;
    const backX = car.x - car.forwardX * 1.4;
    const backZ = car.z - car.forwardZ * 1.4;
    const rx = car.rightX * 0.85;
    const rz = car.rightZ * 0.85;
    this.tyre(backX + rx, 0.15, backZ + rz, 1);
    this.tyre(backX - rx, 0.15, backZ - rz, 1);
  }

  update(dt) {
    // Sparks.
    let sparkDirty = false;
    for (let i = 0; i < MAX_SPARKS; i++) {
      const st = this.sparkState[i];
      if (st.life <= 0) continue;
      st.life -= dt;
      const p = i * 3;
      if (st.life <= 0) {
        this.sparkPos[p + 1] = -999;
        sparkDirty = true;
        continue;
      }
      st.vy -= 14 * st.grav * dt;
      this.sparkPos[p] += st.vx * dt;
      this.sparkPos[p + 1] += st.vy * dt;
      this.sparkPos[p + 2] += st.vz * dt;
      if (this.sparkPos[p + 1] < 0.02) {
        this.sparkPos[p + 1] = 0.02;
        st.vy = Math.abs(st.vy) * 0.28;
        st.vx *= 0.6;
        st.vz *= 0.6;
      }
      const f = clamp(st.life / (st.maxLife || 1), 0, 1);
      this.sparkCol[p] = f;
      this.sparkCol[p + 1] = f * 0.72;
      this.sparkCol[p + 2] = f * 0.35;
      sparkDirty = true;
    }
    if (sparkDirty) {
      this.sparks.geometry.attributes.position.needsUpdate = true;
      this.sparks.geometry.attributes.color.needsUpdate = true;
    }

    // Smoke.
    let smokeDirty = false;
    for (let i = 0; i < MAX_SMOKE; i++) {
      const st = this.smokeState[i];
      if (st.life <= 0) continue;
      st.life -= dt;
      const p = i * 3;
      if (st.life <= 0) {
        this.smokePos[p + 1] = -999;
        smokeDirty = true;
        continue;
      }
      this.smokePos[p] += st.vx * dt;
      this.smokePos[p + 1] += st.vy * dt;
      this.smokePos[p + 2] += st.vz * dt;
      st.vx *= 1 - dt * 1.4;
      st.vz *= 1 - dt * 1.4;
      const f = clamp(st.life / (st.maxLife || 1), 0, 1);
      const c = 0.1 + f * 0.7;
      this.smokeCol[p] = c;
      this.smokeCol[p + 1] = c;
      this.smokeCol[p + 2] = c;
      smokeDirty = true;
    }
    if (smokeDirty) {
      this.smoke.geometry.attributes.position.needsUpdate = true;
      this.smoke.geometry.attributes.color.needsUpdate = true;
    }

    // Muzzle flash.
    if (this.flashLife > 0) {
      this.flashLife -= dt;
      this.flash.material.opacity = Math.max(0, this.flashLife / 0.055) * 0.95;
      if (this.flashLife <= 0) this.flash.material.opacity = 0;
    }

    this.shake = Math.max(0, this.shake - dt * 1.6);
  }

  addShake(amount) {
    this.shake = Math.min(1.4, this.shake + amount);
  }
}
