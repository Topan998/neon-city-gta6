// activities.js — the two side jobs that pay between story missions: taxi fares and stunt jumps.
//
// A taxi fare is a pickup marker and a drop-off marker against a clock, paying by distance and by
// how much time is left. A stunt jump is a ring hanging over a street: drive through it fast
// enough in a car and it pays, once, and stays paid for the session.

const THREE = window.THREE;

import { Marker } from './missions.js';
import { TAU, clamp, randRange, standard, hash2, pick } from './util.js';
import { LINES } from './world.js';

/** Fixed jump sites: each is a spot on a road with a heading across it. */
const JUMP_SITES = [
  { x: -120, z: 40, heading: Math.PI / 2, reward: 350 },
  { x: 80, z: -120, heading: 0, reward: 400 },
  { x: 0, z: 160, heading: Math.PI, reward: 450 },
  { x: -240, z: -80, heading: Math.PI / 2, reward: 500 },
  { x: 160, z: 80, heading: 0, reward: 380 },
  { x: -40, z: -240, heading: Math.PI / 2, reward: 420 },
  { x: 240, z: -160, heading: Math.PI, reward: 600 },
  { x: -160, z: 240, heading: 0, reward: 460 },
];

const FARES = [120, 160, 210, 260, 340];

export class Activities {
  constructor(game) {
    this.game = game;
    this.rng = game.rng;
    this.taxiMarker = new Marker(game.scene, 0x35ff9e, 3.0);
    this.fareMarker = new Marker(game.scene, 0x35ff9e, 3.2);
    this.taxi = { state: 'offer', timer: 0, limit: 0, fare: 0, faresDone: 0, pickup: null, dropoff: null };
    this.jumps = [];
    this.built = false;
    this.taxiMarker.hide();
    this.fareMarker.hide();
    this.buildJumps();
  }

  /** The rings over the road: a torus on two thin poles, standing vertically across a lane. */
  buildJumps() {
    this.jumpGroup = new THREE.Group();
    const ringGeo = new THREE.TorusGeometry(4.2, 0.22, 8, 32);
    const glowGeo = new THREE.TorusGeometry(4.2, 0.5, 6, 32);
    for (const site of JUMP_SITES) {
      const grp = new THREE.Group();
      const mat = new THREE.MeshBasicMaterial({
        color: 0x31e6ff, transparent: true, opacity: 0.9, toneMapped: false,
      });
      const ring = new THREE.Mesh(ringGeo, mat);
      ring.rotation.y = site.heading + Math.PI / 2;
      ring.position.y = 4.6;
      grp.add(ring);
      const glow = new THREE.Mesh(glowGeo, new THREE.MeshBasicMaterial({
        color: 0x31e6ff, transparent: true, opacity: 0.16, blending: THREE.AdditiveBlending,
        depthWrite: false, toneMapped: false,
      }));
      glow.rotation.y = site.heading + Math.PI / 2;
      glow.position.y = 4.6;
      grp.add(glow);
      // two poles either side
      const poleMat = standard({ color: 0x2a2f36, roughness: 0.6, metalness: 0.4 });
      for (const s of [-1, 1]) {
        const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.12, 4.6, 6), poleMat);
        pole.position.set(Math.cos(site.heading) * s * 4.4, 2.3, -Math.sin(site.heading) * s * 4.4);
        pole.castShadow = true;
        grp.add(pole);
      }
      grp.position.set(site.x, 0, site.z);
      this.jumpGroup.add(grp);
      this.jumps.push({ ...site, group: grp, cleared: false, cooldown: 0 });
    }
    this.game.scene.add(this.jumpGroup);
  }

  get taxiState() {
    return this.taxi.state;
  }

  /** Offer a fare: a pickup on a random street corner, a drop-off somewhere across town. */
  offerFare() {
    const world = this.game.world;
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const a = this.rng() * TAU;
      const r = randRange(this.rng, 60, 200);
      const x = clamp(this.game.player.pos.x + Math.cos(a) * r, -280, 280);
      const z = clamp(this.game.player.pos.z + Math.sin(a) * r, -280, 280);
      if (!world.onAsphalt(x, z)) continue;
      this.taxi.pickup = { x, z };
      this.taxi.state = 'offer';
      this.taxiMarker.place(x, z, 0.02);
      this.fareMarker.hide();
      return;
    }
    this.taxi.pickup = { x: 0, z: 40 };
    this.taxi.state = 'offer';
    this.taxiMarker.place(0, 40, 0.02);
  }

  /** Begin a fare: the clock starts and the drop-off appears. */
  beginFare() {
    const world = this.game.world;
    const drop = world.randomLanePoint(this.rng);
    this.taxi.dropoff = { x: drop.axis === 'x' ? drop.x : drop.line, z: drop.axis === 'x' ? drop.line : drop.z };
    // a drop-off out on a road, far enough to be a drive
    for (let attempt = 0; attempt < 30; attempt += 1) {
      const p = world.randomLanePoint(this.rng);
      const x = p.axis === 'x' ? p.x : p.line;
      const z = p.axis === 'x' ? p.line : p.z;
      const d = Math.hypot(x - this.taxi.pickup.x, z - this.taxi.pickup.z);
      if (d > 90 && d < 320) {
        this.taxi.dropoff = { x, z };
        break;
      }
    }
    this.taxi.state = 'driving';
    this.taxi.fare = pick(this.rng, FARES);
    this.taxi.limit = clamp(30 + Math.hypot(this.taxi.dropoff.x - this.taxi.pickup.x, this.taxi.dropoff.z - this.taxi.pickup.z) / 6, 38, 95);
    this.taxi.timer = this.taxi.limit;
    this.taxiMarker.hide();
    this.fareMarker.place(this.taxi.dropoff.x, this.taxi.dropoff.z, 0.02);
    this.game.hud?.setObjective(`TAXI RUN — $${this.taxi.fare}`, this.taxi.timer);
    this.game.toast?.(`FARE: $${this.taxi.fare}`);
    this.game.audio?.click(520, 0.1);
  }

  update(dt) {
    const player = this.game.player;
    const car = player.inCar;

    // --- taxi ---
    if (this.taxi.state === 'offer') {
      this.taxiMarker.update(dt);
      if (car && this.taxi.pickup) {
        const d = Math.hypot(car.pos.x - this.taxi.pickup.x, car.pos.z - this.taxi.pickup.z);
        if (d < 4.4 && Math.abs(car.speed) < 3.2) this.beginFare();
      }
      if (!this.taxi.pickup) this.offerFare();
    } else if (this.taxi.state === 'driving') {
      this.fareMarker.update(dt);
      this.taxi.timer -= dt;
      this.game.hud?.setObjective(`TAXI RUN — $${this.taxi.fare}`, Math.max(0, this.taxi.timer));
      const d = car ? Math.hypot(car.pos.x - this.taxi.dropoff.x, car.pos.z - this.taxi.dropoff.z) : 999;
      if (d < 5.2 && Math.abs(car.speed) < 4.5) {
        this.taxi.state = 'offer';
        this.taxi.faresDone += 1;
        this.game.addMoney(this.taxi.fare);
        this.game.toast?.(`FARE PAID — $${this.taxi.fare}`);
        this.game.audio?.stinger(2);
        this.game.hud?.setObjective('', 0);
        this.fareMarker.hide();
        this.offerFare();
      } else if (this.taxi.timer <= 0 || !car) {
        this.taxi.state = 'offer';
        this.game.toast?.('FARE LOST');
        this.game.hud?.setObjective('', 0);
        this.fareMarker.hide();
        this.offerFare();
      }
    }

    // --- stunt jumps ---
    for (const jump of this.jumps) {
      if (jump.cooldown > 0) jump.cooldown -= dt;
      const mat = jump.group.children[0].material;
      if (jump.cleared) {
        mat.color.setHex(0x2a6a4a);
        mat.opacity = 0.35;
        continue;
      }
      // breathe the ring when the player is near
      const near = Math.hypot(player.pos.x - jump.x, player.pos.z - jump.z) < 70;
      mat.opacity = near ? 0.7 + Math.sin(this.game.time * 3) * 0.2 : 0.35;
      if (!car || jump.cooldown > 0) continue;
      const dx = car.pos.x - jump.x;
      const dz = car.pos.z - jump.z;
      const dist = Math.hypot(dx, dz);
      // passing through: close to the ring's plane, inside its circle, fast
      if (dist < 5.4 && Math.abs(car.speed) > 9) {
        const forward = car.forward;
        const headingMatch = Math.abs(forward.x * Math.sin(jump.heading) + forward.y * Math.cos(jump.heading)) > 0.4;
        if (headingMatch) {
          jump.cleared = true;
          jump.cooldown = 2;
          this.game.addMoney(jump.reward);
          this.game.toast?.(`STUNT JUMP — $${jump.reward}`);
          this.game.audio?.stinger(2);
          this.game.effects?.shake(0.35);
          this.game.effects?.sparks(jump.x, 3.5, jump.z, 14, 0x31e6ff);
        }
      }
    }
  }

  /** What the minimap draws: the taxi and the jump rings still open. */
  get blips() {
    const out = [];
    if (this.taxi.state === 'offer' && this.taxi.pickup) {
      out.push({ x: this.taxi.pickup.x, z: this.taxi.pickup.z, colour: '#35ff9e', kind: 'taxi' });
    }
    if (this.taxi.state === 'driving' && this.taxi.dropoff) {
      out.push({ x: this.taxi.dropoff.x, z: this.taxi.dropoff.z, colour: '#35ff9e', kind: 'taxi' });
    }
    for (const j of this.jumps) {
      if (!j.cleared) out.push({ x: j.x, z: j.z, colour: '#31e6ff', kind: 'jump' });
    }
    return out;
  }

  serialize() {
    return { cleared: this.jumps.map((j) => j.cleared), fares: this.taxi.faresDone };
  }

  restore(data) {
    if (!data) return;
    if (Array.isArray(data.cleared)) {
      data.cleared.forEach((flag, i) => {
        if (this.jumps[i]) this.jumps[i].cleared = !!flag;
      });
    }
    this.taxi.faresDone = data.fares ?? 0;
  }
}
