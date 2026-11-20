// vehicles.js — the cars. Every body is built from the same kit of parts: a bevelled lower mass, a
// glasshouse with raked screens, bumpers, mirrors, lights and four wheels that spin. A police
// variant adds a push bar and a roof bar that can be told to flash.
//
// Driving is arcade: a forward axis with a lateral slip channel that grip pulls back in, so a
// handbrake breaks the rear loose and the car slides. Traffic runs on the same geometry, told what
// to do by a lane follower that brakes for the car in front and for red lights.

const THREE = window.THREE;

import { CAR_KINDS, CAR_COLOURS, HANDLING, PALETTE } from './config.js';
import {
  TAU, clamp, lerp, damp, mulberry32, randRange, pick, chance, GeoBuilder, standard,
  mergeGeometries, setShadows, TEX,
} from './util.js';

const WHEEL_R = HANDLING.tyreRadius;

/** A trapezoid prism: four corner posts, used for the glasshouse and the bevelled body. */
function cabinGeometry(g, opts) {
  const { len, wid, y0, y1, frontInset, rearInset, sideInset, colour } = opts;
  g.setTint(colour);
  const hw = wid / 2;
  const hl = len / 2;
  const fx0 = hl;
  const fx1 = hl - frontInset;
  const rx0 = -hl;
  const rx1 = -hl + rearInset;
  const sx0 = hw;
  const sx1 = hw - sideInset;
  // bottom rectangle (front-left, front-right, back-right, back-left) at y0
  // top rectangle, inset at y1
  const fl0 = [-fx0, y0, sx0];
  const fr0 = [fx0, y0, -sx0];
  const br0 = [rx0, y0, -sx0];
  const bl0 = [rx0, y0, sx0];
  const fl1 = [-fx1, y1, sx1];
  const fr1 = [fx1, y1, -sx1];
  const br1 = [rx1, y1, -sx1];
  const bl1 = [rx1, y1, sx1];
  // The car faces +z, so the windscreen is the -x normal face... build the six surfaces by hand.
  // screen (front, faces +z): between the +x side corners
  g.quad([fx0, y0, -sx0], [fx0, y0, sx0], [fx1, y1, sx1], [fx1, y1, -sx1], [1, 0.2, 0], [0, 0, 1, 1]);
  // rear screen (faces -z)
  g.quad([rx0, y0, sx0], [rx0, y0, -sx0], [rx1, y1, -sx1], [rx1, y1, sx1], [-1, 0.2, 0], [0, 0, 1, 1]);
  // sides
  g.quad([fx0, y0, -sx0], [rx0, y0, -sx0], [rx1, y1, -sx1], [fx1, y1, -sx1], [0, 0.15, -1], [0, 0, 1, 1]);
  g.quad([rx0, y0, sx0], [fx0, y0, sx0], [fx1, y1, sx1], [rx1, y1, sx1], [0, 0.15, 1], [0, 0, 1, 1]);
  // roof
  g.quad([fx1, y1, sx1], [fx1, y1, -sx1], [rx1, y1, -sx1], [rx1, y1, sx1], [0, 1, 0], [0, 0, 1, 1]);
}

/** One wheel: a tyre, a rim and a hub, merged, with the axis on X so it can spin about X. */
function wheelGeometry() {
  const g = new GeoBuilder({ colour: 0x111214 });
  g.cyl(WHEEL_R, 0.24, 0, 0, 0, { seg: 12, uv: 2, capTop: true });
  g.setTint(0x8b8f96);
  g.cyl(WHEEL_R * 0.58, 0.26, 0, 0, 0, { seg: 10, uv: 2, capTop: true });
  g.setTint(0x33363a);
  g.cyl(WHEEL_R * 0.22, 0.28, 0, 0, 0, { seg: 6, uv: 2, capTop: true });
  const geo = g.build();
  geo.rotateZ(Math.PI / 2);
  return geo;
}

const WHEEL_GEO = { current: null };
const wheelGeo = () => {
  if (!WHEEL_GEO.current) WHEEL_GEO.current = wheelGeometry();
  return WHEEL_GEO.current;
};

/** Shared materials keyed by colour, so thirty cars do not mean thirty programs. */
const paintCache = new Map();
function paintMaterial(colour) {
  if (!paintCache.has(colour)) {
    paintCache.set(colour, standard({
      color: colour, roughness: 0.32, metalness: 0.62, envMapIntensity: 1.1,
    }));
  }
  return paintCache.get(colour);
}

const glassMat = standard({
  color: 0x0d1a22, roughness: 0.06, metalness: 0.5, transparent: true, opacity: 0.72,
  envMapIntensity: 1.6,
});
const trimMat = standard({ color: 0x1b1d20, roughness: 0.55, metalness: 0.4 });
const chromeMat = standard({ color: 0xb8bcc2, roughness: 0.18, metalness: 0.95 });
const headMat = new THREE.MeshBasicMaterial({ color: 0xfff3d6, toneMapped: false });
const tailMat = new THREE.MeshBasicMaterial({ color: 0x8b0f12, toneMapped: false });
const brakeMat = new THREE.MeshBasicMaterial({ color: 0xff2a22, toneMapped: false });
const policeRedMat = new THREE.MeshBasicMaterial({ color: 0xff1a2a, toneMapped: false });
const policeBlueMat = new THREE.MeshBasicMaterial({ color: 0x1a4cff, toneMapped: false });

/**
 * Build a car. `kind` picks the proportions; `opts.police` gives it the cruiser's bar and colours.
 * Returns a group whose origin sits on the road at the centre of the wheelbase.
 */
export function buildCar(kindId = 'sedan', colour = 0xb02a2a, opts = {}) {
  const kind = CAR_KINDS.find((k) => k.id === kindId) ?? CAR_KINDS[0];
  const len = kind.len;
  const wid = kind.wid;
  const hgt = kind.hgt;
  const group = new THREE.Group();
  group.name = `car-${kind.id}`;

  const body = new GeoBuilder({ colour: 0xffffff });
  const paint = paintMaterial(colour);
  const wheelbase = len * 0.62;
  const sillY = WHEEL_R + 0.16;

  // main mass, slightly narrower at the sills than at the shoulder
  body.setTint(colour);
  body.box(wid, 0.34, len * 0.98, 0, sillY + 0.1, 0, { uv: 2 });
  body.box(wid * 0.99, 0.44, len, 0, sillY + 0.45, 0, { uv: 2 });
  // bonnet and boot, a touch lower than the shoulder line
  body.setTint(new THREE.Color(colour).multiplyScalar(0.92).getHex());
  body.box(wid * 0.93, 0.1, len * 0.28, 0, sillY + 0.69, len * 0.35, { uv: 2 });
  body.box(wid * 0.93, 0.12, len * 0.2, 0, sillY + 0.7, -len * 0.39, { uv: 2 });

  // glasshouse: cabin height and rake depend on the kind
  const cabinY = sillY + 0.72;
  const cabinH = hgt - (cabinY + WHEEL_R * 0.2);
  const cabinLen = len * (kind.id === 'van' ? 0.62 : kind.id === 'coupe' ? 0.42 : 0.5);
  const cabinWid = wid * 0.9;

  const glass = new GeoBuilder({ colour: 0xffffff });
  cabinGeometry(glass, {
    len: cabinLen, wid: cabinWid, y0: cabinY, y1: cabinY + cabinH,
    frontInset: cabinLen * 0.3, rearInset: cabinLen * 0.24, sideInset: 0.12,
    colour: 0xffffff,
  });
  const glassMesh = new THREE.Mesh(glass.build(), glassMat);
  glassMesh.position.z = kind.id === 'van' ? -len * 0.02 : -len * 0.03;
  glassMesh.castShadow = true;
  group.add(glassMesh);

  // roof panel over the glasshouse, in body colour
  body.setTint(colour);
  body.box(cabinWid - 0.24, 0.1, cabinLen - cabinLen * 0.5, 0, cabinY + cabinH, kind.id === 'van' ? -len * 0.02 : -len * 0.03, { uv: 2 });

  // pillars, just enough to break the glass silhouette
  body.box(0.06, cabinH, 0.06, 0, cabinY + cabinH / 2, cabinLen * 0.18, { uv: 1 });
  body.box(0.06, cabinH, 0.06, 0, cabinY + cabinH / 2, -cabinLen * 0.16, { uv: 1 });

  const bodyMesh = new THREE.Mesh(body.build(), paint);
  bodyMesh.castShadow = true;
  bodyMesh.receiveShadow = true;
  group.add(bodyMesh);
  group.bodyMesh = bodyMesh;

  // bumpers, grille, mirrors
  const trim = new GeoBuilder({ colour: 0x1b1d20 });
  trim.box(wid * 1.01, 0.26, 0.28, 0, sillY + 0.2, len / 2 - 0.02, { uv: 1 });
  trim.box(wid * 1.01, 0.26, 0.28, 0, sillY + 0.2, -len / 2 + 0.02, { uv: 1 });
  trim.box(wid * 0.72, 0.22, 0.1, 0, sillY + 0.5, len / 2 - 0.02, { uv: 1 });
  trim.box(0.26, 0.16, 0.22, wid / 2 + 0.04, cabinY + cabinH * 0.5, cabinLen * 0.24, { uv: 1 });
  trim.box(0.26, 0.16, 0.22, -wid / 2 - 0.04, cabinY + cabinH * 0.5, cabinLen * 0.24, { uv: 1 });
  // side skirts and a roof antenna
  trim.box(0.06, 0.14, len * 0.7, wid / 2 - 0.02, sillY - 0.02, 0, { uv: 1 });
  trim.box(0.06, 0.14, len * 0.7, -wid / 2 + 0.02, sillY - 0.02, 0, { uv: 1 });
  trim.box(0.04, 0.34, 0.04, 0, cabinY + cabinH + 0.17, -cabinLen * 0.35, { uv: 1 });
  const trimMesh = new THREE.Mesh(trim.build(), trimMat);
  trimMesh.castShadow = true;
  group.add(trimMesh);

  // lights
  const head = new GeoBuilder();
  head.box(wid * 0.24, 0.14, 0.08, wid * 0.3, sillY + 0.55, len / 2 - 0.01, { uv: 1 });
  head.box(wid * 0.24, 0.14, 0.08, -wid * 0.3, sillY + 0.55, len / 2 - 0.01, { uv: 1 });
  const headMesh = new THREE.Mesh(head.build(), headMat);
  group.add(headMesh);
  const tail = new GeoBuilder();
  tail.box(wid * 0.26, 0.13, 0.08, wid * 0.31, sillY + 0.58, -len / 2 + 0.01, { uv: 1 });
  tail.box(wid * 0.26, 0.13, 0.08, -wid * 0.31, sillY + 0.58, -len / 2 + 0.01, { uv: 1 });
  const tailMesh = new THREE.Mesh(tail.build(), tailMat);
  group.add(tailMesh);
  const brake = new GeoBuilder();
  brake.box(wid * 0.3, 0.06, 0.09, wid * 0.31, sillY + 0.66, -len / 2 + 0.01, { uv: 1 });
  brake.box(wid * 0.3, 0.06, 0.09, -wid * 0.31, sillY + 0.66, -len / 2 + 0.01, { uv: 1 });
  const brakeMesh = new THREE.Mesh(brake.build(), brakeMat);
  brakeMesh.visible = false;
  group.add(brakeMesh);

  // wheels: front pair steers, all four spin
  const wheels = [];
  const steer = [];
  const wx = wid / 2 - 0.06;
  const wz = wheelbase / 2;
  for (let i = 0; i < 4; i += 1) {
    const front = i < 2;
    const side = i % 2 === 0 ? 1 : -1;
    const holder = new THREE.Group();
    holder.position.set(side * wx, WHEEL_R, front ? wz : -wz);
    const wm = new THREE.Mesh(wheelGeo(), standard({ vertexColors: true, roughness: 0.62, metalness: 0.3 }));
    wm.castShadow = true;
    holder.add(wm);
    group.add(holder);
    wheels.push(wm);
    if (front) steer.push(holder);
  }

  // police extras
  let barRed = null;
  let barBlue = null;
  if (opts.police) {
    const bars = new GeoBuilder();
    bars.box(0.42, 0.16, 0.9, 0, cabinY + cabinH + 0.12, -cabinLen * 0.05, { uv: 1 });
    const mid = new THREE.Mesh(bars.build(), trimMat);
    group.add(mid);
    barRed = new THREE.Mesh(new GeoBuilder().box(0.16, 0.13, 0.4, 0, 0, 0, { uv: 1 }).build(), policeRedMat);
    barRed.position.set(-0.22, cabinY + cabinH + 0.14, -cabinLen * 0.05);
    barBlue = new THREE.Mesh(new GeoBuilder().box(0.16, 0.13, 0.4, 0, 0, 0, { uv: 1 }).build(), policeBlueMat);
    barBlue.position.set(0.22, cabinY + cabinH + 0.14, -cabinLen * 0.05);
    group.add(barRed, barBlue);

    // the light bar's reflection on the road: two soft additive pools that follow the flash
    const mkPool = (colour) => {
      const g = new GeoBuilder();
      g.ground(7.5, 12, 0, 0, 0, { uv: 1 });
      const m = new THREE.Mesh(g.build(), new THREE.MeshBasicMaterial({
        map: TEX.glow(), color: colour, transparent: true, opacity: 0.5,
        blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false,
      }));
      m.position.set(0, 0.04, 0);
      m.rotation.x = 0;
      group.add(m);
      return m;
    };
    barRed.userData.reflection = mkPool(0xff2233);
    barBlue.userData.reflection = mkPool(0x2b6bff);
    // push bar
    const push = new GeoBuilder();
    push.box(wid * 0.9, 0.5, 0.1, 0, sillY + 0.35, len / 2 + 0.16, { uv: 1 });
    push.box(0.1, 0.7, 0.1, wid * 0.36, sillY + 0.4, len / 2 + 0.14, { uv: 1 });
    push.box(0.1, 0.7, 0.1, -wid * 0.36, sillY + 0.4, len / 2 + 0.14, { uv: 1 });
    const pushMesh = new THREE.Mesh(push.build(), chromeMat);
    group.add(pushMesh);
    // the livery: a door decal band down each side
    const decal = new GeoBuilder({ colour: 0xffffff });
    decal.setTint(0x1a2b5a);
    decal.panel(len * 0.5, 0.34, wid / 2 + 0.005, sillY + 0.42, 0, { rotY: Math.PI / 2, uv: 1 });
    decal.panel(len * 0.5, 0.34, -wid / 2 - 0.005, sillY + 0.42, 0, { rotY: -Math.PI / 2, uv: 1 });
    const dm = new THREE.Mesh(decal.build(), standard({ vertexColors: true, roughness: 0.4, metalness: 0.4 }));
    group.add(dm);
  }

  group.userData = {
    kind: kind.id, len, wid, hgt, wheelbase, wheels, steer,
    headMesh, tailMesh, brakeMesh, barRed, barBlue, paint, colour,
  };
  return group;
}

/** The car as the game uses it: physics, seats, damage, lights and a siren flag. */
export class Car {
  constructor(game, opts = {}) {
    this.game = game;
    this.kind = opts.kind ?? pick(game.rng, CAR_KINDS).id;
    this.colour = opts.colour ?? pick(game.rng, CAR_COLOURS);
    this.police = !!opts.police;
    this.group = buildCar(this.kind, this.police ? 0xf2f4f6 : this.colour, { police: this.police });
    const u = this.group.userData;
    this.len = u.len;
    this.wid = u.wid;
    this.wheels = u.wheels;
    this.steerWheels = u.steer;
    this.brakeMesh = u.brakeMesh;
    this.barRed = u.barRed;
    this.barBlue = u.barBlue;

    this.pos = new THREE.Vector3(opts.x ?? 0, 0, opts.z ?? 0);
    this.heading = opts.heading ?? 0;
    this.vel = new THREE.Vector2(0, 0);       // world x/z velocity
    this.speed = 0;                            // signed forward speed, m/s
    this.steer = 0;
    this.slip = 0;
    this.health = 100;
    this.driver = null;                        // 'player' | 'npc' | 'police' | null
    this.wheelSpin = 0;
    this.braking = false;
    this.throttle = 0;
    this.handbrake = false;
    this.sirenOn = false;
    this.sirenBoth = false;
    this.sirenPhase = 0;
    this.headlight = null;
    this.stuckTimer = 0;
    this.ai = null;
    this.group.position.copy(this.pos);
    this.group.rotation.y = this.heading;
    this.game.scene.add(this.group);
  }

  get forward() {
    return new THREE.Vector2(Math.sin(this.heading), Math.cos(this.heading));
  }

  get rightVec() {
    return new THREE.Vector2(Math.cos(this.heading), -Math.sin(this.heading));
  }

  get speedKph() {
    return Math.abs(this.speed) * 3.6;
  }

  setPosition(x, z, heading = this.heading) {
    this.pos.set(x, 0, z);
    this.heading = heading;
    this.vel.set(0, 0);
    this.speed = 0;
    this.syncMesh();
  }

  /**
   * Turn the headlights on: a real spotlight for the player's car, plus two cheap tricks that read
   * far better in a still — a warm pool of light on the road ahead and a faint cone in the rain.
   */
  setHeadlights(on) {
    if (on && !this.headlight) {
      const spot = new THREE.SpotLight(0xfff0d0, 0, 70, 0.62, 0.35, 1.0);
      spot.position.set(0, 0.9, this.len * 0.45);
      spot.target.position.set(0, -1.2, this.len * 0.45 + 16);
      this.group.add(spot);
      this.group.add(spot.target);
      this.headlight = spot;

      // pool: an elongated soft rectangle lying on the asphalt
      const poolGeo = new THREE.PlaneGeometry(8.5, 24);
      const poolMat = new THREE.MeshBasicMaterial({
        map: TEX.glow(), color: 0xffe3b0, transparent: true, opacity: 0.55,
        blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false,
      });
      const pool = new THREE.Mesh(poolGeo, poolMat);
      pool.rotation.x = -Math.PI / 2;
      pool.position.set(0, 0.05, this.len * 0.5 + 11);
      this.group.add(pool);
      this.lightPool = pool;
      this.lightPool.renderOrder = 3;

      // cone: two crossed additive triangles, a hair of light hanging in the air
      const coneGeo = new THREE.PlaneGeometry(5.2, 14);
      const coneMat = new THREE.MeshBasicMaterial({
        map: TEX.streak(), color: 0xffe8c0, transparent: true, opacity: 0.18,
        blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false,
      });
      const cone = new THREE.Mesh(coneGeo, coneMat);
      cone.rotation.x = -Math.PI / 2 + 0.005;
      cone.position.set(0, 0.5, this.len * 0.5 + 6.4);
      cone.rotation.z = Math.PI / 2;
      this.group.add(cone);
      this.lightCone = cone;
    }
    if (this.headlight) {
      this.headlight.intensity = on ? 5200 : 0;
      this.headlight.visible = on;
    }
    if (this.lightPool) this.lightPool.visible = on;
    if (this.lightCone) this.lightCone.visible = on;
    if (this.group.userData.headMesh) this.group.userData.headMesh.visible = true;
  }

  /** Player input into the arcade model. `dt` is a fixed step. */
  drive(input, dt) {
    const H = HANDLING;
    const fwd = this.forward;
    const right = this.rightVec;
    let vLong = this.vel.x * fwd.x + this.vel.y * fwd.y;
    let vLat = this.vel.x * right.x + this.vel.y * right.y;

    const throttle = clamp(input.throttle, -1, 1);
    const steerIn = clamp(input.steer, -1, 1);
    this.throttle = throttle;
    this.handbrake = !!input.handbrake;
    this.braking = throttle < -0.05;

    // engine and brakes
    let accel = 0;
    if (throttle > 0.02) {
      const boost = input.boost ? H.boost : 1;
      const falloff = 1 - clamp(vLong / (H.maxSpeed * boost), 0, 0.98);
      accel = H.accel * throttle * boost * (0.35 + falloff * 0.65);
    } else if (throttle < -0.02) {
      if (vLong > 0.5) accel = -H.brake * -throttle;
      else accel = H.reverse * throttle;
    }
    // rolling resistance and drag
    const drag = this.handbrake ? H.rollDrag * 3.2 : H.rollDrag;
    vLong += accel * dt;
    vLong -= vLong * drag * dt * 0.16;
    vLong -= Math.sign(vLong) * Math.min(Math.abs(vLong), H.drag * dt * 0.55);
    if (Math.abs(vLong) < 0.06 && Math.abs(throttle) < 0.02) vLong = 0;

    // steering: the faster you go the less lock you get, and the slower you turn
    const speedFactor = clamp(Math.abs(vLong) / 9, 0, 1);
    const lock = H.steerMax * lerp(1, 0.35, clamp(Math.abs(vLong) / H.maxSpeed, 0, 1));
    this.steer = damp(this.steer, steerIn * lock, 9, dt);
    const turn = this.steer * speedFactor * Math.sign(vLong || 1) * (2.6 - Math.abs(this.steer) * 0.9);
    this.heading += turn * dt;

    // gravity of the road: sideways velocity bleeds off, unless the handbrake is on
    const grip = this.handbrake ? H.driftGrip : H.grip;
    if (Math.abs(vLong) > 2.5) {
      vLat += -this.steer * Math.abs(vLong) * 0.55 * dt;
    }
    vLat *= Math.exp(-grip * dt);
    this.slip = vLat;

    this.speed = vLong;
    this.vel.set(fwd.x * vLong + right.x * vLat, fwd.y * vLong + right.y * vLat);
    this.pos.x += this.vel.x * dt;
    this.pos.z += this.vel.y * dt;

    this.collide(dt);
    this.syncMesh(dt);
  }

  /** Push the car out of the city's solids and take the speed out of the hit. */
  collide(dt) {
    const world = this.game.world;
    const r = Math.max(this.len, this.wid) * 0.42;
    const before = this.pos.clone();
    const fixed = world.resolveCircle(this.pos.x, this.pos.z, r);
    if (fixed.x !== this.pos.x || fixed.z !== this.pos.z) {
      this.pos.x = fixed.x;
      this.pos.z = fixed.z;
      const impact = Math.abs(this.speed);
      if (impact > 2) {
        this.damage(impact * 0.9);
        this.game.effects?.sparks(this.pos.x, 0.8, this.pos.z, 8);
        this.game.audio?.impact(clamp(impact / 20, 0.15, 1));
        if (this.driver === 'player') this.game.effects?.shake(clamp(impact / 22, 0, 0.7));
      }
      this.vel.multiplyScalar(0.25);
      this.speed *= 0.2;
    }
    // keep inside the playable square
    const lim = 318;
    this.pos.x = clamp(this.pos.x, -lim, lim);
    this.pos.z = clamp(this.pos.z, -lim, lim);
    const travelled = before.distanceTo(this.pos);
    if (travelled < 0.0005 && Math.abs(this.speed) > 1) this.stuckTimer += dt;
    else this.stuckTimer = 0;
  }

  damage(amount) {
    this.health = clamp(this.health - amount, 0, 100);
    if (this.health <= 0 && this.driver === 'player') {
      this.game.onCarWrecked?.(this);
    }
    return this.health;
  }

  repair() {
    this.health = 100;
  }

  /** Move the visual group to match the simulation. */
  syncMesh(dt = 0.016) {
    this.group.position.set(this.pos.x, this.pos.y ?? 0, this.pos.z);
    this.group.rotation.y = this.heading;
    // wheels: spin with distance covered, front pair takes the steering angle
    this.wheelSpin += (this.speed * dt) / WHEEL_R;
    for (const w of this.wheels) w.rotation.x = this.wheelSpin;
    for (const s of this.steerWheels) s.rotation.y = this.steer * 0.9;
    this.brakeMesh.visible = this.braking || this.handbrake;
    // body roll and pitch, small but they sell the weight
    const roll = clamp(-this.steer * Math.abs(this.speed) * 0.004, -0.09, 0.09);
    const pitch = clamp((this.braking ? 0.02 : 0) - this.throttle * 0.012, -0.03, 0.035);
    this.group.rotation.z = damp(this.group.rotation.z, roll, 6, dt);
    this.group.rotation.x = damp(this.group.rotation.x, pitch, 6, dt);
  }

  /** Roof-bar flash: the two halves alternate, and it is only drawn when the siren is on. */
  updateSiren(dt) {
    if (!this.barRed) return;
    const refRed = this.barRed.userData.reflection;
    const refBlue = this.barBlue.userData.reflection;
    if (!this.sirenOn) {
      this.barRed.visible = false;
      this.barBlue.visible = false;
      if (refRed) refRed.visible = false;
      if (refBlue) refBlue.visible = false;
      return;
    }
    this.sirenPhase += dt;
    const beat = this.sirenPhase % 0.5;
    if (this.sirenBoth) {
      this.barRed.visible = true;
      this.barBlue.visible = true;
    } else {
      this.barRed.visible = beat < 0.25;
      this.barBlue.visible = beat >= 0.25;
    }
    if (refRed) refRed.visible = this.barRed.visible;
    if (refBlue) refBlue.visible = this.barBlue.visible;
    this.barRed.scale.setScalar(1 + Math.sin(this.sirenPhase * 24) * 0.05);
    this.barBlue.scale.setScalar(1 + Math.cos(this.sirenPhase * 24) * 0.05);
  }

  update(dt) {
    if (this.driver === 'npc' && this.ai) this.ai.step(dt);
    this.updateSiren(dt);
    if (!this.driver) this.syncMesh(dt);
  }

  dispose() {
    this.game.scene.remove(this.group);
    this.group.traverse((o) => {
      if (o.isMesh && o.geometry && o.geometry !== wheelGeo()) o.geometry.dispose?.();
    });
  }
}

/**
 * Traffic: one lane follower per car. It reads the road grid from the world, keeps to the right of
 * the centre line, brakes for whatever is in front, and picks a random direction at a junction
 * (obeying the lights when it must stop).
 */
/**
 * Traffic AI. Each car owns a lane: an axis, a direction, the road line it is on and its offset
 * from the centre. It drives to the next junction, brakes for whatever is in front and for red
 * lights, and now and then turns onto the cross street — with a short blend so the heading swings
 * instead of snapping.
 */
export class LaneAI {
  constructor(game, car, spawn) {
    this.game = game;
    this.car = car;
    this.axis = spawn.axis;
    this.dir = spawn.dir;
    this.line = spawn.line;
    this.lane = Math.abs(spawn.lane) || 4.1;
    this.cruise = randRange(game.rng, 9, 16);
    this.speed = this.cruise;
    this.blocked = 0;
    this.blend = null;
    this.along = spawn.axis === 'x' ? spawn.x : spawn.z;
    this.place(this.along);
  }

  get alongX() {
    return this.axis === 'x';
  }

  place(along) {
    const car = this.car;
    const off = this.line + this.lane * this.dir;
    if (this.alongX) {
      car.pos.set(along, 0, off);
      car.heading = this.dir > 0 ? Math.PI / 2 : -Math.PI / 2;
    } else {
      car.pos.set(off, 0, along);
      car.heading = this.dir > 0 ? 0 : Math.PI;
    }
    this.along = along;
  }

  /** Distance to the next crossing in the direction of travel. */
  junctionAhead() {
    const pitch = 80;
    if (this.dir > 0) return pitch - (((this.along % pitch) + pitch) % pitch);
    return ((this.along % pitch) + pitch) % pitch;
  }

  /** Begin a turn onto the cross street at the coming junction. */
  startTurn(kind, junction, startPos, startHeading) {
    const car = this.car;
    const left = kind === 'left';
    const flip = this.alongX ? -1 : 1;
    const newAxis = this.alongX ? 'z' : 'x';
    const newDir = left ? this.dir * flip : this.dir * -flip;
    const newLine = junction;
    const lane = this.lane;
    const offNew = newLine + lane * newDir;
    const endPos = newAxis === 'x'
      ? new THREE.Vector3(this.along, 0, offNew)
      : new THREE.Vector3(offNew, 0, this.along);
    const endHeading = newAxis === 'x'
      ? (newDir > 0 ? Math.PI / 2 : -Math.PI / 2)
      : (newDir > 0 ? 0 : Math.PI);
    this.blend = {
      t: 0,
      dur: 0.85,
      from: startPos.clone(),
      to: endPos.clone(),
      h0: startHeading,
      h1: endHeading,
      axis: newAxis,
      dir: newDir,
      line: newLine,
    };
  }

  step(dt) {
    const car = this.car;
    const world = this.game.world;

    if (this.blend) {
      const b = this.blend;
      b.t += dt;
      const k = clamp(b.t / b.dur, 0, 1);
      const e = k * k * (3 - 2 * k);
      car.pos.lerpVectors(b.from, b.to, e);
      // shortest-way heading blend
      let dh = b.h1 - b.h0;
      while (dh > Math.PI) dh -= TAU;
      while (dh < -Math.PI) dh += TAU;
      car.heading = b.h0 + dh * e;
      this.speed = damp(this.speed, this.cruise * 0.45, 4, dt);
      car.speed = this.speed;
      car.pos.y = 0;
      car.syncMesh(dt);
      if (k >= 1) {
        this.axis = b.axis;
        this.dir = b.dir;
        this.line = b.line;
        this.along = this.axis === 'x' ? car.pos.x : car.pos.z;
        this.blend = null;
      }
      return;
    }

    // brake for the car in front, and for the player on foot
    let gap = 999;
    const fwd = car.forward;
    for (const other of this.game.vehicles) {
      if (other === car) continue;
      const dx = other.pos.x - car.pos.x;
      const dz = other.pos.z - car.pos.z;
      const ahead = dx * fwd.x + dz * fwd.y;
      const side = Math.abs(dx * fwd.y - dz * fwd.x);
      if (ahead > 0.2 && ahead < 18 && side < 2.8) gap = Math.min(gap, ahead);
    }
    const player = this.game.player;
    if (player && !player.inCar && player.alive !== false) {
      const dx = player.pos.x - car.pos.x;
      const dz = player.pos.z - car.pos.z;
      const ahead = dx * fwd.x + dz * fwd.y;
      const side = Math.abs(dx * fwd.y - dz * fwd.x);
      if (ahead > 0.2 && ahead < 12 && side < 2.4) gap = Math.min(gap, ahead * 0.9);
    }

    const toJunction = this.junctionAhead();
    const lightAgainst = !world.trafficAllowed(this.axis, this.game.time);
    const mustStop = lightAgainst && toJunction < 15;
    const want = gap < 9 ? Math.max(0, (gap - 4) * 1.6) : mustStop ? Math.max(0, (toJunction - 5) * 1.4) : this.cruise;
    const target = clamp(want, 0, this.cruise);
    this.speed = damp(this.speed, target, target < this.speed ? 7 : 2.2, dt);

    if (this.speed < 0.5) this.blocked += dt;
    else this.blocked = 0;

    const nextAlong = this.along + this.speed * dt * this.dir;

    // arrive at a junction: decide, once, whether to turn
    if (toJunction < 2.4 && this.speed > 1.5 && this.game.rng() < 0.55) {
      const kind = this.game.rng() < 0.5 ? 'left' : 'right';
      const junction = this.dir > 0 ? this.along + toJunction : this.along - toJunction;
      const startPos = new THREE.Vector3(car.pos.x, 0, car.pos.z);
      this.startTurn(kind, junction, startPos, car.heading);
      return;
    }

    this.place(nextAlong);
    car.speed = this.speed;
    car.syncMesh(dt);

    // stuck traffic is recycled rather than piling up at a dead end
    if (this.blocked > 22) {
      const spawn = world.randomLanePoint(this.game.rng);
      this.axis = spawn.axis;
      this.dir = spawn.dir;
      this.line = spawn.line;
      this.lane = Math.abs(spawn.lane) || 4.1;
      this.place(this.axis === 'x' ? spawn.x : spawn.z);
      this.blocked = 0;
      car.setPosition(car.pos.x, car.pos.z, car.heading);
    }
  }
}

/**
 * The fleet: traffic, parked cars and the police cruisers all live here, so main.js only has to
 * ask one object to update the street. Cars are pooled — a car that leaves the play area comes
 * back on the other side rather than being thrown away.
 */
export class Fleet {
  constructor(game) {
    this.game = game;
    this.cars = [];
  }

  get all() {
    return this.cars;
  }

  addTraffic(spawn) {
    const point = spawn ?? this.game.world.randomLanePoint(this.game.rng);
    const car = new Car(this.game, {
      x: point.x, z: point.z, heading: 0,
      colour: pick(this.game.rng, CAR_COLOURS),
    });
    car.driver = 'npc';
    car.ai = new LaneAI(this.game, car, point);
    car.setHeadlights(true);
    car.headlight.intensity = 0;
    this.cars.push(car);
    return car;
  }

  addParked(x, z, heading, colour = null) {
    const car = new Car(this.game, { x, z, heading, colour: colour ?? pick(this.game.rng, CAR_COLOURS) });
    car.parked = true;
    this.cars.push(car);
    return car;
  }

  addPolice(x, z, heading) {
    const car = new Car(this.game, { x, z, heading, police: true });
    this.cars.push(car);
    return car;
  }

  /** The nearest car the player can get into, and how far it is. */
  nearest(pos, maxDist = 4.2) {
    let best = null;
    let bestD = maxDist;
    for (const car of this.cars) {
      if (car.police && car.driver === 'police') continue;
      const d = Math.hypot(car.pos.x - pos.x, car.pos.z - pos.z);
      if (d < bestD) {
        bestD = d;
        best = car;
      }
    }
    return best ? { car: best, dist: bestD } : null;
  }

  /** Keep the traffic near the player: recycle anything that drifts away or is left behind. */
  keepNear(playerPos) {
    for (const car of this.cars) {
      if (car.driver !== 'npc' || !car.ai) continue;
      const d = Math.hypot(car.pos.x - playerPos.x, car.pos.z - playerPos.z);
      if (d > 230) {
        const angle = this.game.rng() * TAU;
        const radius = randRange(this.game.rng, 110, 190);
        const spawn = this.game.world.randomLanePointNear(
          playerPos.x + Math.cos(angle) * radius,
          playerPos.z + Math.sin(angle) * radius,
          this.game.rng,
        );
        car.ai.axis = spawn.axis;
        car.ai.dir = spawn.dir;
        car.ai.line = spawn.line;
        car.ai.lane = Math.abs(spawn.lane) || 4.1;
        car.ai.blend = null;
        car.ai.place(spawn.axis === 'x' ? spawn.x : spawn.z);
      }
    }
  }

  update(dt) {
    for (const car of this.cars) car.update(dt);
  }

  remove(car) {
    const i = this.cars.indexOf(car);
    if (i >= 0) this.cars.splice(i, 1);
    car.dispose();
  }
}
