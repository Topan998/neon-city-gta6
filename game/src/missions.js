// missions.js — the three jobs.
//
//  1. Saltwater Run: take the coupe across town to the docks before the clock runs out.
//  2. Rival Crew:  drive to the east-side lot and take out four crew members.
//  3. Three Stars: keep the police on you for ninety seconds without dying.
//
// A job gate sits on the sidewalk; walk or drive into it to start. While a job runs the objective
// marker moves to the target, the HUD shows a timer, and a beam of light plus a waypoint arrow keep
// the destination readable from anywhere in the city.

import THREE from './three-shim.js';
import { CITY, MISSIONS, PHYSICS } from './config.js';
import { TAU, clamp, lerp, damp, smoothstep } from './util.js';
import { Car } from './vehicles.js';

const GATES = [
  { x: 22, z: 66 },
  { x: -66, z: -22 },
  { x: 110, z: 110 },
];

class Rival {
  constructor(scene, x, z, rng) {
    this.root = new THREE.Group();
    this.root.position.set(x, CITY.curb, z);
    scene.add(this.root);
    this.x = x;
    this.z = z;
    this.health = 100;
    this.alive = true;
    this.phase = rng.range(0, TAU);
    this.cooldown = rng.range(0.5, 2);

    const shirt = new THREE.MeshStandardMaterial({ color: 0x3d1a22, roughness: 0.75 });
    const skin = new THREE.MeshStandardMaterial({ color: 0xb9835c, roughness: 0.7 });
    const denim = new THREE.MeshStandardMaterial({ color: 0x24282f, roughness: 0.85 });

    const torso = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.62, 0.3), shirt);
    torso.position.y = 1.16;
    torso.castShadow = true;
    this.root.add(torso);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.145, 10, 8), skin);
    head.position.y = 1.62;
    head.castShadow = true;
    this.root.add(head);
    this.legs = [];
    for (const side of [-1, 1]) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.88, 0.18), denim);
      leg.position.set(side * 0.13, 0.44, 0);
      leg.castShadow = true;
      this.root.add(leg);
      this.legs.push(leg);
    }

    this.baseX = x;
    this.baseZ = z;
    this.yaw = 0;
  }

  update(dt, player, effects, damage) {
    if (!this.alive) return;
    const dx = player.x - this.x;
    const dz = player.z - this.z;
    const d = Math.hypot(dx, dz);
    this.yaw = Math.atan2(-dz, dx);
    this.root.rotation.y = this.yaw;

    // Hold a loose circle around the lot, shuffling towards the player.
    let mx = 0;
    let mz = 0;
    if (d > 13) {
      mx = dx / d;
      mz = dz / d;
    } else if (d < 7) {
      mx = -dx / d;
      mz = -dz / d;
    } else {
      mx = -dz / d;
      mz = dx / d;
    }
    const speed = 2.1;
    this.x += mx * speed * dt;
    this.z += mz * speed * dt;
    this.phase += dt * 7;
    this.legs[0].rotation.x = Math.sin(this.phase) * 0.4;
    this.legs[1].rotation.x = -Math.sin(this.phase) * 0.4;
    this.root.position.set(this.x, CITY.curb, this.z);

    this.cooldown -= dt;
    if (d < 26 && this.cooldown <= 0) {
      this.cooldown = 1.9;
      const fx = Math.cos(this.yaw);
      const fz = -Math.sin(this.yaw);
      if (effects) effects.muzzle(this.x + fx * 0.5, CITY.curb + 1.25, this.z + fz * 0.5, fx, fz);
      if (damage) damage(clamp(7 - d * 0.15, 2, 7));
    }
  }

  kill(effects) {
    if (!this.alive) return;
    this.alive = false;
    this.root.visible = false;
    this.root.rotation.z = Math.PI / 2;
    if (effects) effects.smokePuff(this.x, CITY.curb + 0.6, this.z, 5, 0.9, 0.5);
  }
}

export class Missions {
  constructor(scene, world, rng, effects, audio, police) {
    this.scene = scene;
    this.world = world;
    this.rng = rng;
    this.effects = effects;
    this.audio = audio;
    this.police = police;

    this.index = 0; // next job to hand out
    this.active = null; // current job object
    this.completed = new Set();
    this.failed = 0;
    this.moneyEarned = 0;
    this.timeLeft = 0;
    this.state = 'idle'; // idle | running | done | failed
    this.banner = null;
    this.onBanner = null;
    this.onReward = null;
    this.rivals = [];
    this.marker = { x: 0, z: 0, visible: false, radius: 8 };
    this.clock = 0;
    this.flash = 0;

    this.buildMarkers();
    this.setGate(0);
  }

  buildMarkers() {
    const group = new THREE.Group();
    this.markerGroup = group;
    this.scene.add(group);

    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(5.6, 0.22, 8, 40),
      new THREE.MeshStandardMaterial({
        color: 0xffc24b,
        emissive: 0xffb43a,
        emissiveIntensity: 1.6,
        roughness: 0.4,
        metalness: 0.3,
      }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.12;
    group.add(ring);
    this.ring = ring;

    const beam = new THREE.Mesh(
      new THREE.CylinderGeometry(4.4, 5.4, 46, 20, 1, true),
      new THREE.MeshBasicMaterial({
        color: 0xffc24b,
        transparent: true,
        opacity: 0.1,
        side: THREE.DoubleSide,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    );
    beam.position.y = 23;
    group.add(beam);
    this.beam = beam;

    // A chevron above the ring, so the marker reads from a distance.
    const chevron = new THREE.Mesh(
      new THREE.ConeGeometry(1.8, 2.4, 4),
      new THREE.MeshStandardMaterial({ color: 0xffd76a, emissive: 0xffb43a, emissiveIntensity: 1.4 }),
    );
    chevron.position.y = 7.2;
    chevron.rotation.y = Math.PI / 4;
    group.add(chevron);
    this.chevron = chevron;
  }

  setGate(index) {
    const gate = GATES[clamp(index, 0, GATES.length - 1)];
    this.marker.x = gate.x;
    this.marker.z = gate.z;
    this.marker.visible = true;
    this.markerGroup.position.set(gate.x, 0, gate.z);
  }

  setMarker(x, z) {
    this.marker.x = x;
    this.marker.z = z;
    this.marker.visible = true;
    this.markerGroup.visible = true;
    this.markerGroup.position.set(x, 0, z);
  }

  hideMarker() {
    this.marker.visible = false;
    this.markerGroup.visible = false;
  }

  announce(text, tone = 'info') {
    this.banner = { text, tone, time: 4.2 };
    if (this.onBanner) this.onBanner(text, tone);
  }

  start(index = this.index) {
    if (index >= MISSIONS.length) return false;
    const def = MISSIONS[index];
    this.index = index;
    this.active = {
      def,
      index,
      elapsed: 0,
      duration: def.duration,
      target: def.target,
      phase: 'travel',
    };
    this.state = 'running';
    this.timeLeft = def.duration;
    this.markerGroup.visible = true;
    this.announce(`JOB ${index + 1} OF ${MISSIONS.length} — ${def.objective}`, 'job');

    if (def.id === 'crew') {
      this.spawnRivals(def.target);
      this.hideMarker();
      this.setMarker(def.target.x, def.target.z);
    } else if (def.id === 'delivery') {
      this.setMarker(def.target.x, def.target.z);
    } else {
      this.hideMarker();
      this.police.setStars(3);
      this.police.crime(3);
    }

    if (this.audio) this.audio.chime(true);
    return true;
  }

  spawnRivals(target) {
    for (const r of this.rivals) {
      if (r.alive) r.kill();
      this.scene.remove(r.root);
    }
    this.rivals = [];
    const rng = this.rng;
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * TAU + rng.range(-0.3, 0.3);
      const r = rng.range(5, 11);
      const x = clamp(target.x + Math.cos(a) * r, -CITY.half + 12, CITY.half - 12);
      const z = clamp(target.z + Math.sin(a) * r, -CITY.half + 12, CITY.half - 12);
      const rival = new Rival(this.scene, x, z, rng);
      this.rivals.push(rival);
    }
    // Their car, parked in the middle of the lot.
    if (!this.rivalCar) {
      this.rivalCar = new Car(this.scene, this.world, { kind: 'pickup', color: 0x4b1f24 });
      this.scene.remove(this.rivalCar.root);
      this.scene.add(this.rivalCar.root);
    }
    this.rivalCar.place(target.x + 3, target.z + 3, 0.6);
    this.rivalCar.root.visible = true;
  }

  // The player pulled the trigger: work out whether anything in front of them is a rival.
  onShot(originX, originZ, dirX, dirZ, onKill) {
    if (!this.active || this.active.def.id !== 'crew') return false;
    let best = null;
    let bestD = 34;
    for (const r of this.rivals) {
      if (!r.alive) continue;
      const dx = r.x - originX;
      const dz = r.z - originZ;
      const d = Math.hypot(dx, dz);
      if (d > bestD) continue;
      const dot = (dx * dirX + dz * dirZ) / (d || 1);
      if (dot < 0.82) continue;
      best = r;
      bestD = d;
    }
    if (!best) return false;
    best.kill(this.effects);
    if (this.audio) this.audio.thud(0.5);
    if (onKill) onKill(best);
    return true;
  }

  rivalsLeft() {
    return this.rivals.filter((r) => r.alive).length;
  }

  // Instant staging for the screenshots: job running, marker ahead, no countdown drift.
  stage(index, timeLeft) {
    this.start(index);
    this.banner = null;
    if (timeLeft !== undefined) this.timeLeft = timeLeft;
    if (this.active) this.active.elapsed = this.active.duration - this.timeLeft;
    // Freeze the countdown pulse for the shot.
    this.flash = 0;
  }

  complete() {
    const job = this.active;
    if (!job) return;
    this.state = 'done';
    this.completed.add(job.def.id);
    this.moneyEarned += job.def.reward;
    this.active = null;
    this.marker.visible = false;
    this.markerGroup.visible = false;
    this.announce(`JOB COMPLETE — $${job.def.reward.toLocaleString('en-US')}`, 'good');
    if (this.onReward) this.onReward(job.def.reward, job.def);
    if (this.audio) this.audio.chime(true);
    this.index = Math.min(job.index + 1, MISSIONS.length);
    for (const r of this.rivals) r.kill();
    if (this.rivalCar) this.rivalCar.root.visible = false;
    if (job.def.id === 'survive' && this.police) this.police.setStars(0);
    if (this.index < MISSIONS.length) {
      this.setGate(this.index);
      this.markerGroup.visible = true;
    }
  }

  fail(reason) {
    const job = this.active;
    if (!job) return;
    this.state = 'failed';
    this.failed += 1;
    this.active = null;
    this.announce(`JOB FAILED — ${reason}`, 'bad');
    if (this.audio) this.audio.chime(false);
    this.setGate(job.index);
    this.markerGroup.visible = true;
  }

  update(dt, player, playerCar, onDamage) {
    this.clock += dt;
    if (this.banner) {
      this.banner.time -= dt;
      if (this.banner.time <= 0) this.banner = null;
    }

    // Pulse the marker; keep it flat on the ground and slowly turning.
    if (this.markerGroup.visible) {
      const pulse = 0.5 + 0.5 * Math.sin(this.clock * 2.2);
      this.ring.scale.setScalar(1 + pulse * 0.035);
      this.ring.material.emissiveIntensity = 1.1 + pulse * 1.2;
      this.chevron.position.y = 7.2 + Math.sin(this.clock * 1.6) * 0.35;
      this.chevron.rotation.y += dt * 0.7;
      this.beam.material.opacity = 0.06 + pulse * 0.05;
    }

    const px = player.inCar ? playerCar.x : player.x;
    const pz = player.inCar ? playerCar.z : player.z;
    const distToMarker = Math.hypot(px - this.marker.x, pz - this.marker.z);

    // Idle: stepping into a job gate starts it.
    if (!this.active) {
      if (this.state !== 'running' && this.markerGroup.visible && distToMarker < 6.5) {
        this.start(this.index);
      }
      return;
    }

    const job = this.active;
    job.elapsed += dt;
    this.timeLeft = Math.max(0, job.duration - job.elapsed);

    if (job.def.id === 'crew') {
      let damageAccum = 0;
      for (const r of this.rivals) {
        if (!r.alive) continue;
        r.update(dt, player.inCar ? playerCar : player, this.effects, (amount) => {
          damageAccum += amount;
        });
      }
      if (damageAccum > 0 && player.alive) {
        player.damage(damageAccum, 'rival');
        if (this.effects) this.effects.hit(player.inCar ? playerCar.x : player.x, 1.2, player.inCar ? playerCar.z : player.z);
      }
      if (this.rivalsLeft() === 0) {
        this.complete();
        return;
      }
    } else if (job.def.id === 'delivery') {
      if (distToMarker < 9 && player.inCar) {
        this.complete();
        return;
      }
    } else if (job.def.id === 'survive') {
      if (this.police && this.police.stars < 3) {
        // Nudge it back up so the job stays a chase.
        this.police.crime(0.4);
      }
    }

    if (this.timeLeft <= 0) {
      this.fail(job.def.id === 'delivery' ? 'OUT OF TIME' : 'TIME UP');
    }
  }

  statusLine() {
    if (!this.active) {
      if (this.index >= MISSIONS.length) return 'ALL JOBS COMPLETE';
      return `NEXT JOB: ${MISSIONS[this.index].name.toUpperCase()}`;
    }
    const job = this.active;
    if (job.def.id === 'crew') return `WIPE OUT THE RIVAL CREW — ${this.rivalsLeft()} LEFT`;
    return job.def.objective;
  }
}
