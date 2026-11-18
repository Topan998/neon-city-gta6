// vehicles.js — the car factory and everything that drives.
//
// One shared geometry set per body style, one material per paint colour, and a handful of meshes per
// car (body, glass house, roof, two lamp bars, four wheels). Arcade physics: throttle, brake,
// speed-dependent steering, grip loss on the handbrake, collisions with buildings and other cars.
// Traffic cars run the same physics through a lane-following brain that brakes for lights and queues.

import THREE from './three-shim.js';
import { CITY, PHYSICS, PALETTE } from './config.js';
import { TAU, clamp, lerp, damp, angleDiff, wrapAngle, mergeGeos, makeCanvas, toTexture, RNG } from './util.js';

const CAR_SPECS = {
  sedan: {
    length: 4.35,
    width: 1.86,
    bodyBottom: 0.3,
    bodyHeight: 0.62,
    cabinLength: 2.15,
    cabinWidth: 1.62,
    cabinHeight: 0.56,
    cabinShift: -0.1,
    wheelRadius: 0.35,
    axle: 1.42,
    track: 0.82,
  },
  coupe: {
    length: 4.2,
    width: 1.9,
    bodyBottom: 0.26,
    bodyHeight: 0.55,
    cabinLength: 1.9,
    cabinWidth: 1.56,
    cabinHeight: 0.44,
    cabinShift: -0.28,
    wheelRadius: 0.34,
    axle: 1.38,
    track: 0.84,
  },
  van: {
    length: 5.0,
    width: 1.98,
    bodyBottom: 0.34,
    bodyHeight: 0.9,
    cabinLength: 2.9,
    cabinWidth: 1.78,
    cabinHeight: 0.78,
    cabinShift: 0.15,
    wheelRadius: 0.38,
    axle: 1.66,
    track: 0.88,
  },
  pickup: {
    length: 4.75,
    width: 1.94,
    bodyBottom: 0.32,
    bodyHeight: 0.72,
    cabinLength: 1.7,
    cabinWidth: 1.74,
    cabinHeight: 0.62,
    cabinShift: 0.55,
    wheelRadius: 0.37,
    axle: 1.5,
    track: 0.86,
  },
};

export const CAR_KINDS = Object.keys(CAR_SPECS);

// ---------------------------------------------------------------- geometry

function roundedRectShape(w, h, r) {
  const s = new THREE.Shape();
  const hw = w / 2;
  const hh = h / 2;
  s.moveTo(-hw + r, -hh);
  s.lineTo(hw - r, -hh);
  s.quadraticCurveTo(hw, -hh, hw, -hh + r);
  s.lineTo(hw, hh - r);
  s.quadraticCurveTo(hw, hh, hw - r, hh);
  s.lineTo(-hw + r, hh);
  s.quadraticCurveTo(-hw, hh, -hw, hh - r);
  s.lineTo(-hw, -hh + r);
  s.quadraticCurveTo(-hw, -hh, -hw + r, -hh);
  return s;
}

// A box whose top face is inset (and optionally shifted back): bonnets, cabins, boots.
function taperedBox(w0, d0, w1, d1, h, shift = 0) {
  const g = new THREE.BoxGeometry(w0, h, d0);
  const pos = g.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    if (pos.getY(i) > 0) {
      pos.setX(i, (pos.getX(i) / (w0 / 2)) * (w1 / 2));
      pos.setZ(i, (pos.getZ(i) / (d0 / 2)) * (d1 / 2) + shift);
    }
  }
  pos.needsUpdate = true;
  g.computeVertexNormals();
  g.translate(0, h / 2, 0);
  return g;
}

function wheelTexture() {
  const { canvas, ctx } = makeCanvas(128, 128);
  ctx.fillStyle = '#0d0e10';
  ctx.fillRect(0, 0, 128, 128);
  ctx.beginPath();
  ctx.arc(64, 64, 62, 0, TAU);
  ctx.fillStyle = '#141518';
  ctx.fill();
  ctx.beginPath();
  ctx.arc(64, 64, 40, 0, TAU);
  ctx.fillStyle = '#8f9298';
  ctx.fill();
  ctx.beginPath();
  ctx.arc(64, 64, 34, 0, TAU);
  ctx.fillStyle = '#23262b';
  ctx.fill();
  ctx.strokeStyle = '#b9bcc2';
  ctx.lineWidth = 5;
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * TAU;
    ctx.beginPath();
    ctx.moveTo(64, 64);
    ctx.lineTo(64 + Math.cos(a) * 32, 64 + Math.sin(a) * 32);
    ctx.stroke();
  }
  ctx.beginPath();
  ctx.arc(64, 64, 9, 0, TAU);
  ctx.fillStyle = '#d9dde2';
  ctx.fill();
  return toTexture(canvas, { wrapS: THREE.ClampToEdgeWrapping, wrapT: THREE.ClampToEdgeWrapping });
}

function headlightTexture() {
  const { canvas, ctx } = makeCanvas(64, 64);
  const g = ctx.createRadialGradient(32, 32, 2, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,250,235,1)');
  g.addColorStop(0.35, 'rgba(255,235,190,0.55)');
  g.addColorStop(1, 'rgba(255,220,160,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  return toTexture(canvas, { wrapS: THREE.ClampToEdgeWrapping, wrapT: THREE.ClampToEdgeWrapping });
}

let SHARED = null;
function shared() {
  if (SHARED) return SHARED;
  SHARED = {
    glass: new THREE.MeshStandardMaterial({
      color: 0x223038,
      roughness: 0.08,
      metalness: 0.85,
      transparent: true,
      opacity: 0.72,
    }),
    tyre: new THREE.MeshStandardMaterial({ map: wheelTexture(), roughness: 0.82, metalness: 0.1 }),
    lampWhite: new THREE.MeshStandardMaterial({
      color: 0xfff2d8,
      emissive: 0xfff0cf,
      emissiveIntensity: 1.1,
      roughness: 0.3,
      metalness: 0.1,
    }),
    lampRed: new THREE.MeshStandardMaterial({
      color: 0x8d1c18,
      emissive: 0xff2a1e,
      emissiveIntensity: 1.2,
      roughness: 0.35,
      metalness: 0.1,
    }),
    lampReverse: new THREE.MeshStandardMaterial({
      color: 0xe8e4dc,
      emissive: 0xfff6e8,
      emissiveIntensity: 0.35,
      roughness: 0.4,
    }),
    headGlow: new THREE.MeshBasicMaterial({
      map: headlightTexture(),
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      opacity: 0.9,
    }),
    beam: new THREE.MeshBasicMaterial({
      color: 0xffe6b8,
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    }),
    policeRed: new THREE.MeshStandardMaterial({
      color: 0xff1a12,
      emissive: 0xff1a12,
      emissiveIntensity: 0.4,
      roughness: 0.3,
    }),
    policeBlue: new THREE.MeshStandardMaterial({
      color: 0x1a3dff,
      emissive: 0x2a5aff,
      emissiveIntensity: 0.4,
      roughness: 0.3,
    }),
    trim: new THREE.MeshStandardMaterial({ color: 0x1a1c1f, roughness: 0.45, metalness: 0.6 }),
    chrome: new THREE.MeshStandardMaterial({ color: 0xb9bcc0, roughness: 0.25, metalness: 0.9 }),
  };
  return SHARED;
}

const GEO_CACHE = new Map();

function carGeometry(kind) {
  if (GEO_CACHE.has(kind)) return GEO_CACHE.get(kind);
  const spec = CAR_SPECS[kind];
  const L = spec.length;
  const W = spec.width;
  const R = 0.26;

  // Lower body: rounded plan, extruded up with a chamfer, so the metal catches the sun.
  const shape = roundedRectShape(L, W, R);
  const slab = new THREE.ExtrudeGeometry(shape, {
    depth: spec.bodyHeight - 0.12,
    bevelEnabled: true,
    bevelSize: 0.06,
    bevelThickness: 0.06,
    bevelSegments: 2,
    curveSegments: 5,
  });
  slab.rotateX(-Math.PI / 2);
  slab.translate(0, spec.bodyBottom + 0.06, 0);

  // Bumpers and mirrors, merged into the painted body.
  const bumperFront = new THREE.BoxGeometry(0.36, 0.34, W * 0.92);
  bumperFront.translate(L / 2 - 0.1, spec.bodyBottom + 0.22, 0);
  const bumperRear = new THREE.BoxGeometry(0.3, 0.32, W * 0.9);
  bumperRear.translate(-L / 2 + 0.08, spec.bodyBottom + 0.22, 0);
  const mirrorL = new THREE.BoxGeometry(0.22, 0.11, 0.3);
  mirrorL.translate(spec.cabinShift + 0.55, spec.bodyBottom + spec.bodyHeight + 0.12, W / 2 + 0.14);
  const mirrorR = mirrorL.clone();
  mirrorR.translate(0, 0, -(W + 0.28));

  // A painted roof on top of the glass house.
  const roof = taperedBox(
    spec.cabinLength * 0.94,
    spec.cabinWidth * 0.92,
    spec.cabinLength * 0.9,
    spec.cabinWidth * 0.86,
    0.06,
    0,
  );
  roof.translate(spec.cabinShift, spec.bodyBottom + spec.bodyHeight + spec.cabinHeight - 0.02, 0);

  const body = mergeGeos([slab, bumperFront, bumperRear, mirrorL, mirrorR, roof]);
  slab.dispose();
  bumperFront.dispose();
  bumperRear.dispose();
  mirrorL.dispose();
  mirrorR.dispose();
  roof.dispose();

  // Glass house, tapered front and back like a real greenhouse.
  const house = taperedBox(
    spec.cabinLength,
    spec.cabinWidth,
    spec.cabinLength * 0.82,
    spec.cabinWidth * 0.9,
    spec.cabinHeight,
    spec.cabinShift * 0.4,
  );
  house.translate(spec.cabinShift, spec.bodyBottom + spec.bodyHeight - 0.02, 0);

  const headGeo = new THREE.BoxGeometry(0.1, 0.16, 0.42);
  const headL = headGeo.clone();
  headL.translate(L / 2 - 0.02, spec.bodyBottom + 0.36, W / 2 - 0.34);
  const headR = headGeo.clone();
  headR.translate(L / 2 - 0.02, spec.bodyBottom + 0.36, -(W / 2 - 0.34));
  const tailGeo = new THREE.BoxGeometry(0.09, 0.14, 0.4);
  const tailL = tailGeo.clone();
  tailL.translate(-L / 2 + 0.01, spec.bodyBottom + 0.4, W / 2 - 0.32);
  const tailR = tailGeo.clone();
  tailR.translate(-L / 2 + 0.01, spec.bodyBottom + 0.4, -(W / 2 - 0.32));

  const head = mergeGeos([headL, headR]);
  const tail = mergeGeos([tailL, tailR]);
  for (const g of [headGeo, headL, headR, tailGeo, tailL, tailR]) g.dispose();

  const wheel = new THREE.CylinderGeometry(spec.wheelRadius, spec.wheelRadius, 0.26, 14);
  wheel.rotateX(Math.PI / 2);
  wheel.rotateY(Math.PI / 2);

  const out = { body, house, head, tail, wheel, spec };
  GEO_CACHE.set(kind, out);
  return out;
}

const MAT_CACHE = new Map();
function carMaterial(kind, color) {
  const key = `${kind}:${color}`;
  if (MAT_CACHE.has(key)) return MAT_CACHE.get(key);
  const mat = new THREE.MeshStandardMaterial({
    color,
    roughness: 0.31,
    metalness: 0.62,
    envMapIntensity: 1.1,
  });
  MAT_CACHE.set(key, mat);
  return mat;
}

// ------------------------------------------------------------------- car

let CAR_ID = 0;

export class Car {
  constructor(scene, world, opts = {}) {
    this.id = ++CAR_ID;
    this.scene = scene;
    this.world = world;
    this.kind = opts.kind || 'sedan';
    this.police = !!opts.police;
    this.player = !!opts.player;
    this.color = opts.color ?? PALETTE.cars[Math.floor((this.id * 37) % PALETTE.cars.length)];
    this.parts = carGeometry(this.kind);
    const sharedMats = shared();

    this.root = new THREE.Group();
    this.root.name = `car-${this.id}`;
    scene.add(this.root);

    const bodyMat = carMaterial(this.kind, this.color);
    this.body = new THREE.Mesh(this.parts.body, bodyMat);
    this.body.castShadow = true;
    this.body.receiveShadow = true;
    this.root.add(this.body);

    this.house = new THREE.Mesh(this.parts.house, sharedMats.glass);
    this.house.castShadow = false;
    this.root.add(this.house);

    this.headMesh = new THREE.Mesh(this.parts.head, sharedMats.lampWhite);
    this.root.add(this.headMesh);
    this.tailMesh = new THREE.Mesh(this.parts.tail, sharedMats.lampRed.clone());
    this.tailMesh.material.emissiveIntensity = 0.7;
    this.root.add(this.tailMesh);

    // Wheels: pivot (steer) -> mesh (spin).
    this.wheels = [];
    this.pivots = [];
    const spec = this.parts.spec;
    for (const sx of [1, -1]) {
      for (const sz of [1, -1]) {
        const pivot = new THREE.Group();
        pivot.position.set(sx * spec.axle, spec.wheelRadius, sz * spec.track);
        const mesh = new THREE.Mesh(this.parts.wheel, sharedMats.tyre);
        mesh.castShadow = true;
        pivot.add(mesh);
        this.root.add(pivot);
        this.wheels.push(mesh);
        this.pivots.push(pivot);
      }
    }

    if (this.police) this.addPoliceKit(spec);
    if (this.player) this.addHeadlights(spec);

    this.x = 0;
    this.y = 0;
    this.z = 0;
    this.yaw = 0;
    this.speed = 0;
    this.lateral = 0;
    this.yawRate = 0;
    this.slip = 0;
    this.throttle = 0;
    this.brakeInput = 0;
    this.steerInput = 0;
    this.handbrake = false;
    this.radius = 1.25;
    this.wheelSpin = 0;
    this.braking = false;
    this.ai = null;
    this.alive = true;
  }

  addPoliceKit(spec) {
    const s = shared();
    const bar = new THREE.Group();
    const redGeo = new THREE.BoxGeometry(0.34, 0.16, 0.5);
    const red = new THREE.Mesh(redGeo, s.policeRed.clone());
    red.position.set(-0.22, 0, 0);
    const blue = new THREE.Mesh(redGeo.clone(), s.policeBlue.clone());
    blue.position.set(0.22, 0, 0);
    bar.add(red);
    bar.add(blue);
    bar.position.set(spec.cabinShift, spec.bodyBottom + spec.bodyHeight + spec.cabinHeight + 0.12, 0);
    this.root.add(bar);
    this.barRed = red;
    this.barBlue = blue;

    // The bar's glow in the air and its reflection on damp tarmac: two additive sprites and two
    // coloured pools that follow the flash phase.
    const glow = (color) =>
      new THREE.SpriteMaterial({
        map: s.headGlow.map,
        color,
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      });
    this.glowRed = new THREE.Sprite(glow(0xff2a1e));
    this.glowRed.scale.set(2.4, 2.4, 1);
    this.glowRed.position.set(-0.4, 0.5, 0);
    bar.add(this.glowRed);
    this.glowBlue = new THREE.Sprite(glow(0x2a5aff));
    this.glowBlue.scale.set(2.4, 2.4, 1);
    this.glowBlue.position.set(0.4, 0.5, 0);
    bar.add(this.glowBlue);

    const poolMat = (color) =>
      new THREE.MeshBasicMaterial({
        map: s.headGlow.map,
        color,
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      });
    const poolGeo = new THREE.PlaneGeometry(6.5, 11);
    this.poolRed = new THREE.Mesh(poolGeo, poolMat(0xff2a1e));
    this.poolRed.rotation.x = -Math.PI / 2;
    this.poolRed.position.set(-0.5, 0.03, 0);
    this.root.add(this.poolRed);
    this.poolBlue = new THREE.Mesh(poolGeo, poolMat(0x2a5aff));
    this.poolBlue.rotation.x = -Math.PI / 2;
    this.poolBlue.position.set(0.5, 0.03, 0);
    this.root.add(this.poolBlue);

    // Door stripe and a push bar, the easy way to read a cruiser at a glance.
    const stripe = new THREE.Mesh(
      new THREE.BoxGeometry(spec.cabinLength * 1.5, 0.16, spec.width + 0.04),
      new THREE.MeshStandardMaterial({ color: PALETTE.police.accent, roughness: 0.5, metalness: 0.3 }),
    );
    stripe.position.set(spec.cabinShift * 0.5, spec.bodyBottom + 0.34, 0);
    this.root.add(stripe);

    const push = new THREE.Mesh(
      new THREE.BoxGeometry(0.16, 0.5, spec.width * 0.72),
      shared().chrome,
    );
    push.position.set(spec.length / 2 + 0.12, spec.bodyBottom + 0.3, 0);
    this.root.add(push);
  }

  addHeadlights(spec) {
    const s = shared();
    const spot = new THREE.SpotLight(0xffe9c4, 0, 90, 0.55, 0.45, 1.3);
    spot.position.set(spec.length / 2 - 0.1, spec.bodyBottom + 0.7, 0);
    spot.target.position.set(14, -0.4, 0);
    this.root.add(spot);
    this.root.add(spot.target);
    this.spot = spot;

    // Two additive glow cards on the nose, and a soft cone of light in the air.
    const glowGeo = new THREE.PlaneGeometry(1.5, 1.5);
    this.glows = [];
    for (const sz of [0.62, -0.62]) {
      const glow = new THREE.Mesh(glowGeo, s.headGlow);
      glow.position.set(spec.length / 2 + 0.12, spec.bodyBottom + 0.36, sz);
      glow.rotation.y = Math.PI / 2;
      this.root.add(glow);
      this.glows.push(glow);
    }

    // Tail lamps read as two small red blooms at night.
    this.tailGlows = [];
    for (const sz of [0.62, -0.62]) {
      const sp = new THREE.Sprite(
        new THREE.SpriteMaterial({
          map: s.headGlow.map,
          color: 0xff2a18,
          transparent: true,
          opacity: 0.2,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
        }),
      );
      sp.scale.set(1.1, 1.1, 1);
      sp.position.set(-spec.length / 2 - 0.04, spec.bodyBottom + 0.42, sz);
      this.root.add(sp);
      this.tailGlows.push(sp);
    }

    const coneGeo = new THREE.ConeGeometry(4.2, 18, 14, 1, true);
    coneGeo.rotateZ(Math.PI / 2);
    coneGeo.translate(9.4, 0, 0);
    this.beam = new THREE.Mesh(coneGeo, s.beam);
    this.beam.position.set(spec.length / 2, spec.bodyBottom + 0.4, 0);
    this.beam.rotation.z = -0.02;
    this.root.add(this.beam);
  }

  place(x, z, yaw) {
    this.x = x;
    this.z = z;
    this.yaw = yaw;
    this.speed = 0;
    this.lateral = 0;
    this.sync();
  }

  sync() {
    this.root.position.set(this.x, 0, this.z);
    this.root.rotation.y = this.yaw;
  }

  get forwardX() {
    return Math.cos(this.yaw);
  }
  get forwardZ() {
    return -Math.sin(this.yaw);
  }
  get rightX() {
    return Math.sin(this.yaw);
  }
  get rightZ() {
    return Math.cos(this.yaw);
  }

  setInput(throttle, brake, steer, handbrake) {
    this.throttle = clamp(throttle, 0, 1);
    this.brakeInput = clamp(brake, 0, 1);
    this.steerInput = clamp(steer, -1, 1);
    this.handbrake = !!handbrake;
  }

  // Integrate one fixed step of arcade physics.
  step(dt) {
    const P = PHYSICS.car;
    const top = this.police ? PHYSICS.police.topSpeed : P.topSpeed;
    const accel = this.police ? PHYSICS.police.accel : P.accel;
    const absSpeed = Math.abs(this.speed);

    if (this.throttle > 0.01) {
      const headroom = clamp(1 - absSpeed / top, 0.08, 1);
      this.speed += accel * this.throttle * headroom * dt;
    }
    if (this.brakeInput > 0.01) {
      if (this.speed > 0.6) {
        this.speed -= P.brake * this.brakeInput * dt;
      } else {
        this.speed -= accel * 0.45 * this.brakeInput * dt;
      }
    }
    if (this.handbrake) {
      this.speed -= Math.sign(this.speed) * P.handbrakeBrake * dt;
    }
    if (this.throttle < 0.02 && this.brakeInput < 0.02 && !this.handbrake) {
      const drop = P.engineBrake * dt;
      if (Math.abs(this.speed) <= drop) this.speed = 0;
      else this.speed -= Math.sign(this.speed) * drop;
    }
    this.speed = clamp(this.speed, -P.reverseSpeed, top);
    this.braking = this.brakeInput > 0.05 || (this.speed > 0.2 && this.throttle < 0.02);

    // Steering falls off with speed so it does not feel like a go-kart at 150 km/h.
    const speedFactor = clamp(absSpeed / 3.2, 0, 1) * (1 - 0.52 * clamp(absSpeed / top, 0, 1));
    const steerRate = P.steer * speedFactor;
    const dir = this.speed < -0.2 ? -1 : 1;
    this.yawRate = this.steerInput * steerRate * dir;
    this.yaw += this.yawRate * dt;

    // Lateral slip: the faster the turn, the more the rear steps out, and the handbrake lets it.
    const grip = this.handbrake ? P.handbrakeGrip : P.grip;
    const centrifugal = -this.yawRate * this.speed * 0.19;
    this.lateral = damp(this.lateral, centrifugal, grip, dt);
    this.lateral = clamp(this.lateral, -7, 7);
    this.slip = Math.abs(this.lateral);

    this.x += (this.forwardX * this.speed + this.rightX * this.lateral) * dt;
    this.z += (this.forwardZ * this.speed + this.rightZ * this.lateral) * dt;

    this.collideWorld();
    const lim = CITY.half - 8;
    if (this.x < -lim || this.x > lim) {
      this.x = clamp(this.x, -lim, lim);
      this.speed *= -0.25;
    }
    if (this.z < -lim || this.z > lim) {
      this.z = clamp(this.z, -lim, lim);
      this.speed *= -0.25;
    }
  }

  collideWorld() {
    const push = this.world.buildingPush(this.x, this.z, this.radius * 0.85);
    if (push) {
      this.x += push.x;
      this.z += push.z;
      const impact = Math.abs(this.speed) + Math.abs(this.lateral);
      if (impact > 3) {
        this.speed *= -0.18;
        this.lateral *= -0.3;
        if (this.onImpact) this.onImpact(impact, this.x, this.z);
      } else {
        this.speed *= 0.66;
      }
    }
  }

  updateVisual(dt) {
    this.root.position.set(this.x, 0, this.z);
    this.root.rotation.y = this.yaw;
    const spin = (this.speed / this.parts.spec.wheelRadius) * dt;
    this.wheelSpin += spin;
    for (const w of this.wheels) w.rotation.x = -this.wheelSpin;
    const steer = this.steerInput * 0.42;
    this.pivots[0].rotation.y = steer;
    this.pivots[1].rotation.y = steer;
    if (this.tailMesh) {
      this.tailMesh.material.emissiveIntensity = this.braking ? 2.6 : 0.7;
    }
    if (this.barRed && this.flash !== undefined) {
      const on = this.flash;
      this.barRed.material.emissiveIntensity = 0.4 + on * 4.2;
      this.barBlue.material.emissiveIntensity = 0.4 + (1 - on) * 4.2;
      if (this.glowRed) {
        this.glowRed.material.opacity = 0.12 + on * 0.85;
        this.glowBlue.material.opacity = 0.12 + (1 - on) * 0.85;
        this.poolRed.material.opacity = 0.04 + on * 0.4;
        this.poolBlue.material.opacity = 0.04 + (1 - on) * 0.4;
      }
    }
  }

  setLighting(preset) {
    if (!this.spot) return;
    const on = preset.headlights;
    this.spot.intensity = on * 3400;
    this.spot.visible = on > 0.02;
    if (this.beam) this.beam.material.opacity = on * 0.075;
    if (this.glows) {
      for (const g of this.glows) g.visible = on > 0.02;
    }
    this.headMesh.material.emissiveIntensity = 0.3 + on * 2.4;
    if (this.tailGlows) for (const g of this.tailGlows) g.material.opacity = 0.1 + on * 0.24;
  }

  speedKmh() {
    return Math.abs(this.speed) * 3.6;
  }

  get position() {
    return { x: this.x, z: this.z };
  }
}

// --------------------------------------------------------------- traffic

export class Traffic {
  constructor(scene, world, rng, count) {
    this.scene = scene;
    this.world = world;
    this.rng = rng;
    this.cars = [];
    this.count = count;
    this.spawn(count);
  }

  lanePoint(i, j, axis, dir) {
    const x = CITY.roadLine(i);
    const z = CITY.roadLine(j);
    const lane = CITY.lane;
    if (axis === 'x') return { x, z: z + (dir > 0 ? -lane : lane) };
    return { x: x + (dir > 0 ? lane : -lane), z };
  }

  spawn(count) {
    const rng = this.rng;
    for (let n = 0; n < count; n++) {
      // Try a handful of times to find a spot that is not on top of another car.
      let spot = null;
      for (let attempt = 0; attempt < 12 && !spot; attempt++) {
        const i = Math.floor(rng.next() * CITY.blocks);
        const j = Math.floor(rng.next() * CITY.blocks);
        const axis = rng.chance(0.5) ? 'x' : 'z';
        const dir = rng.chance(0.5) ? 1 : -1;
        const t = rng.next();
        const a = CITY.roadLine(i);
        const b = CITY.roadLine(i + 1);
        const c = CITY.roadLine(j);
        const d = CITY.roadLine(j + 1);
        let x;
        let z;
        if (axis === 'x') {
          x = lerp(a, b, t);
          z = c + (dir > 0 ? -CITY.lane : CITY.lane);
        } else {
          x = c + (dir > 0 ? CITY.lane : -CITY.lane);
          z = lerp(a, b, t);
        }
        let clear = true;
        for (const other of this.cars) {
          if (Math.hypot(other.x - x, other.z - z) < 12) {
            clear = false;
            break;
          }
        }
        if (!clear) continue;
        const nextI = axis === 'x' ? clamp(i + dir, 0, CITY.blocks) : i;
        const nextJ = axis === 'z' ? clamp(j + dir, 0, CITY.blocks) : j;
        const car = new Car(this.scene, this.world, {
          kind: rng.pick(CAR_KINDS),
          color: rng.pick(PALETTE.cars),
        });
        car.place(x, z, axis === 'x' ? (dir > 0 ? 0 : Math.PI) : dir > 0 ? Math.PI / 2 : -Math.PI / 2);
        car.ai = {
          axis,
          dir,
          fromI: i,
          fromJ: j,
          toI: nextI,
          toJ: nextJ,
          cruise: rng.range(PHYSICS.traffic.speedMin, PHYSICS.traffic.speedMax),
          target: this.lanePoint(nextI, nextJ, axis, dir),
          stuck: 0,
        };
        car.place(x, z, Math.atan2(-(car.ai.target.z - z), car.ai.target.x - x));
        this.cars.push(car);
        spot = car;
      }
      if (!spot) break;
    }
  }

  update(dt, player, policeCars) {
    const cars = this.cars;
    for (let i = 0; i < cars.length; i++) {
      const car = cars[i];
      const ai = car.ai;
      if (!ai) continue;

      const tgt = ai.target;
      const dx = tgt.x - car.x;
      const dz = tgt.z - car.z;
      const dist = Math.hypot(dx, dz);
      if (dist < 3.4) {
        this.advance(car);
        continue;
      }

      // Face the lane point; steer proportionally to the error.
      const desiredYaw = Math.atan2(-dz, dx);
      const err = angleDiff(car.yaw, desiredYaw);
      const steer = clamp(err / 0.55, -1, 1);

      // Obstacle scan: anything ahead inside a narrow cone.
      let blocked = false;
      let gap = 999;
      const fx = car.forwardX;
      const fz = car.forwardZ;
      const scan = (ox, oz) => {
        const rx = ox - car.x;
        const rz = oz - car.z;
        const ahead = rx * fx + rz * fz;
        if (ahead < 0 || ahead > 16) return;
        const side = Math.abs(rx * -fz + rz * fx);
        if (side > 2.4) return;
        if (ahead < gap) gap = ahead;
        if (ahead < PHYSICS.traffic.stopDistance) blocked = true;
      };
      for (let k = 0; k < cars.length; k++) {
        if (k === i) continue;
        scan(cars[k].x, cars[k].z);
      }
      if (player && player.alive) scan(player.x, player.z);
      if (policeCars) for (const pc of policeCars) scan(pc.x, pc.z);

      // Red light: brake when approaching the next intersection.
      const nearNode = dist < 13;
      let red = false;
      if (nearNode) {
        const nextAxis = ai.axis;
        red = !this.world.isGreen(nextAxis, tgt.x, tgt.z);
      }

      const wantStop = blocked || red;
      const targetSpeed = wantStop ? 0 : ai.cruise;
      const errSpeed = targetSpeed - car.speed;
      const throttle = errSpeed > 0.4 ? clamp(errSpeed / 3, 0, 1) : 0;
      const brake = errSpeed < -0.3 ? clamp(-errSpeed / 6, 0, 1) : 0;
      car.setInput(throttle, brake, steer, false);
      car.step(dt);
      car.updateVisual(dt);
    }
  }

  advance(car) {
    const ai = car.ai;
    const rng = this.rng;
    const i = ai.toI;
    const j = ai.toJ;
    // Pick a new direction: mostly straight, sometimes a turn, never straight off the grid.
    const options = [];
    if (ai.axis === 'x') {
      if (i + ai.dir >= 0 && i + ai.dir <= CITY.blocks) options.push({ axis: 'x', dir: ai.dir, w: 3 });
      if (j + 1 <= CITY.blocks) options.push({ axis: 'z', dir: 1, w: 1.4 });
      if (j - 1 >= 0) options.push({ axis: 'z', dir: -1, w: 1.4 });
    } else {
      if (j + ai.dir >= 0 && j + ai.dir <= CITY.blocks) options.push({ axis: 'z', dir: ai.dir, w: 3 });
      if (i + 1 <= CITY.blocks) options.push({ axis: 'x', dir: 1, w: 1.4 });
      if (i - 1 >= 0) options.push({ axis: 'x', dir: -1, w: 1.4 });
    }
    if (!options.length) {
      ai.dir = -ai.dir;
      options.push({ axis: ai.axis, dir: ai.dir, w: 1 });
    }
    let total = 0;
    for (const o of options) total += o.w;
    let r = rng.next() * total;
    let pick = options[0];
    for (const o of options) {
      r -= o.w;
      if (r <= 0) {
        pick = o;
        break;
      }
    }
    ai.axis = pick.axis;
    ai.dir = pick.dir;
    ai.fromI = i;
    ai.fromJ = j;
    ai.toI = clamp(pick.axis === 'x' ? i + pick.dir : i, 0, CITY.blocks);
    ai.toJ = clamp(pick.axis === 'z' ? j + pick.dir : j, 0, CITY.blocks);
    ai.target = this.lanePoint(ai.toI, ai.toJ, ai.axis, ai.dir);
  }

  // Shove overlapping cars apart (traffic vs player, traffic vs traffic).
  resolve(bodies) {
    for (let i = 0; i < this.cars.length; i++) {
      const a = this.cars[i];
      for (let k = 0; k < bodies.length; k++) {
        const b = bodies[k];
        if (!b || b === a) continue;
        const dx = b.x - a.x;
        const dz = b.z - a.z;
        const d = Math.hypot(dx, dz);
        const min = 2.6;
        if (d > min || d < 1e-4) continue;
        const nx = dx / d;
        const nz = dz / d;
        const push = (min - d) * 0.5;
        a.x -= nx * push;
        a.z -= nz * push;
        if (b.step) {
          b.x += nx * push;
          b.z += nz * push;
        }
        if (b.speed !== undefined) {
          b.speed *= 0.92;
          b.lateral = clamp(b.lateral + nz * 0.6, -6, 6);
          if (b.onImpact) b.onImpact(2, b.x, b.z);
        }
        a.speed *= 0.8;
      }
    }
  }
}

export function createPlayerCar(scene, world, color = 0x37616f) {
  const car = new Car(scene, world, { kind: 'coupe', color, player: true });
  return car;
}

export function createPoliceCar(scene, world) {
  const car = new Car(scene, world, { kind: 'sedan', color: PALETTE.police.body, police: true });
  return car;
}
