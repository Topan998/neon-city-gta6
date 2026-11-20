// missions.js — the running of a job: the marker, the timer, the objective checks and the chain
// into story.js. A mission is a list of steps; the runner watches one step at a time and reports
// what the HUD should say.

const THREE = window.THREE;

import { MISSIONS, MISSION_ORDER, MISSION_STARTS, jobLabel, nextMissionId } from './story.js';
import { TAU, clamp, lerp, damp, standard, randRange } from './util.js';

/**
 * A world marker: a ring on the ground, a column of light and a slow pulse. Yellow for a job,
 * cyan for an activity, red for a target.
 */
export class Marker {
  constructor(scene, colour = 0xffd45e, radius = 3.2) {
    this.group = new THREE.Group();
    const ringGeo = new THREE.RingGeometry(radius * 0.82, radius, 40);
    this.ringMat = new THREE.MeshBasicMaterial({
      color: colour, transparent: true, opacity: 0.85, side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false,
    });
    this.ring = new THREE.Mesh(ringGeo, this.ringMat);
    this.ring.rotation.x = -Math.PI / 2;
    this.ring.position.y = 0.06;
    this.group.add(this.ring);

    const beamGeo = new THREE.CylinderGeometry(radius * 0.55, radius * 0.8, 14, 16, 1, true);
    this.beamMat = new THREE.MeshBasicMaterial({
      color: colour, transparent: true, opacity: 0.12, side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false,
    });
    this.beam = new THREE.Mesh(beamGeo, this.beamMat);
    this.beam.position.y = 7;
    this.group.add(this.beam);

    const discGeo = new THREE.CircleGeometry(radius * 0.8, 24);
    this.discMat = new THREE.MeshBasicMaterial({
      color: colour, transparent: true, opacity: 0.1, depthWrite: false,
      blending: THREE.AdditiveBlending, toneMapped: false,
    });
    this.disc = new THREE.Mesh(discGeo, this.discMat);
    this.disc.rotation.x = -Math.PI / 2;
    this.disc.position.y = 0.04;
    this.group.add(this.disc);

    this.colour = colour;
    this.radius = radius;
    this.t = 0;
    this.group.visible = false;
    scene.add(this.group);
  }

  place(x, z, y = 0) {
    this.group.position.set(x, y, z);
    this.group.visible = true;
  }

  hide() {
    this.group.visible = false;
  }

  setColour(hex) {
    this.colour = hex;
    this.ringMat.color.setHex(hex);
    this.beamMat.color.setHex(hex);
    this.discMat.color.setHex(hex);
  }

  update(dt) {
    this.t += dt;
    const pulse = 1 + Math.sin(this.t * 2.6) * 0.06;
    this.ring.scale.setScalar(pulse);
    this.ring.rotation.z += dt * 0.35;
    this.beamMat.opacity = 0.1 + Math.sin(this.t * 1.8) * 0.04;
    this.discMat.opacity = 0.07 + Math.sin(this.t * 2.2) * 0.03;
  }
}

/**
 * The mission runner. `start` loads a job from story.js, `update` advances it, and completion
 * pays out, saves progress and unlocks the next one.
 */
export class Missions {
  constructor(game) {
    this.game = game;
    this.rng = game.rng;
    this.marker = new Marker(game.scene, 0xffd45e, 3.4);
    this.targetMarker = new Marker(game.scene, 0xff3d81, 2.6);
    this.active = null;
    this.stepIndex = 0;
    this.completed = [];
    this.timer = 0;
    this.timeLimit = 0;
    this.rivals = [];
    this.state = 'idle';
    this.failTimer = 0;
    this.escapeArea = null;
    this.waypoint = null;
    this.lastCompleted = null;
  }

  /** Which job is on offer right now, or null when the story is done. */
  get offer() {
    if (this.active) return this.active;
    for (const id of MISSION_ORDER) {
      if (!this.completed.includes(id)) return MISSIONS[id];
    }
    return null;
  }

  get step() {
    return this.active ? this.active.steps[this.stepIndex] ?? null : null;
  }

  /** Kick a job off. Called by the HUD's marker and by the start of a session. */
  start(id) {
    const mission = MISSIONS[id] ?? this.offer;
    if (!mission) return false;
    this.active = mission;
    this.stepIndex = 0;
    this.state = 'run';
    this.rivals = [];
    this.game.hud?.setJob(jobLabel(mission.id));
    this.game.audio?.stinger(1);
    this.enterStep();
    return true;
  }

  enterStep() {
    const step = this.step;
    if (!step) return;
    this.timeLimit = step.timeLimit ?? 0;
    this.timer = this.timeLimit;
    if (step.dialogue?.length) this.game.hud?.say(step.dialogue);
    this.game.hud?.setObjective(step.label, this.timeLimit);
    if (step.where) {
      const { x, z, r } = step.where;
      const y = this.game.world.groundY(x, z);
      this.marker.place(x, z, y);
      this.marker.radius = r ?? 3.4;
      this.waypoint = { x, z, r: r ?? 3.4, label: step.label };
    } else {
      this.marker.hide();
      this.waypoint = null;
    }
    if (step.kind === 'wipeout') this.spawnRivals(step);
    if (step.kind === 'escape') {
      this.escapeArea = { x: this.game.player.pos.x, z: this.game.player.pos.z };
      this.game.police?.addHeat(this.game.police.heat < 40 ? 60 : 20, 'mission');
      this.targetMarker.hide();
    }
  }

  /** Rival crew members, standing on the street with red jackets: the shootout's targets. */
  spawnRivals(step) {
    const area = step.area ?? step.where ?? { x: 0, z: 0, r: 20 };
    for (let i = 0; i < (step.count ?? 4); i += 1) {
      const a = (i / (step.count ?? 4)) * TAU + this.rng() * 0.6;
      const rad = randRange(this.rng, 3, area.r * 0.8);
      const person = this.game.crowd.spawn(area.x + Math.cos(a) * rad, area.z + Math.sin(a) * rad, {
        top: 0x8a2a2a, bottom: 0x22262c, skin: 0xc48a5e, radius: 6,
      });
      person.rival = true;
      person.walkSpeed = 1.2;
      this.rivals.push(person);
    }
    this.marker.hide();
    this.targetMarker.place(area.x, area.z, this.game.world.groundY(area.x, area.z));
    this.waypoint = { x: area.x, z: area.z, r: area.r, label: step.label };
  }

  /** Called when the player kills someone; the wipeout step counts its own crew only. */
  noteKill(kind, person) {
    const step = this.step;
    if (!step || step.kind !== 'wipeout') return;
    if (kind === 'rival') {
      const left = this.rivalsLeft();
      this.game.hud?.setObjective(`${step.label} — ${left} LEFT`, this.timeLimit);
      this.game.toast?.(left === 0 ? 'CREW DOWN' : `${left} LEFT`);
    }
  }

  rivalsLeft() {
    return this.rivals.filter((r) => r.alive).length;
  }

  /** Called by the game loop. `dt` is the fixed step. */
  update(dt) {
    this.marker.update(dt);
    this.targetMarker.update(dt);
    if (!this.active || this.state !== 'run') {
      // the offer marker: a job stands on the street waiting to be touched
      const offer = this.offer;
      if (offer && !this.game.player.inCar) {
        const start = MISSION_STARTS[offer.id];
        if (start) {
          this.marker.place(start.x, start.z, this.game.world.groundY(start.x, start.z));
          this.waypoint = { x: start.x, z: start.z, r: 4, label: offer.title, job: true };
        }
      }
      if (this.state === 'failed') {
        this.failTimer -= dt;
        if (this.failTimer <= 0) this.state = 'idle';
      }
      return;
    }

    const step = this.step;
    if (!step) {
      this.finishMission();
      return;
    }
    const player = this.game.player;
    const targetPos = player.inCar ? player.inCar.pos : player.pos;

    if (this.timeLimit > 0) {
      this.timer -= dt;
      this.game.hud?.setObjective(step.label, Math.max(0, this.timer));
      if (this.timer <= 0) return this.fail('OUT OF TIME');
    }

    let done = false;
    if (step.kind === 'pickup' || step.kind === 'goto' || step.kind === 'deliver') {
      const d = Math.hypot(targetPos.x - step.where.x, targetPos.z - step.where.z);
      if (d < (step.where.r ?? 4)) {
        if (step.kind === 'deliver' && player.inCar && player.inCar.health < 45) {
          this.game.toast?.('TOO BEAT UP — BACK OFF AND COME AGAIN');
        } else {
          done = true;
        }
      }
      // the marker slides onto the car when the player is driving, so it is never under the floor
      if (player.inCar) this.marker.place(step.where.x, step.where.z, 0.02);
    } else if (step.kind === 'wipeout') {
      done = this.rivalsLeft() === 0;
    } else if (step.kind === 'escape') {
      const stars = this.game.police?.stars ?? 0;
      const far = Math.hypot(targetPos.x - (this.escapeArea?.x ?? 0), targetPos.z - (this.escapeArea?.z ?? 0));
      if (stars <= 1 && far > 70) done = true;
    }

    if (done) this.completeStep();
  }

  completeStep() {
    const step = this.step;
    this.game.audio?.stinger(2);
    this.game.toast?.(step.kind === 'deliver' ? 'DELIVERED' : 'OBJECTIVE COMPLETE');
    this.stepIndex += 1;
    if (this.stepIndex < this.active.steps.length) {
      if (step.kind === 'escape') this.game.police?.clear();
      this.enterStep();
    } else {
      this.finishMission();
    }
  }

  finishMission() {
    const mission = this.active;
    this.completed.push(mission.id);
    this.lastCompleted = mission.id;
    this.active = null;
    this.state = 'idle';
    this.marker.hide();
    this.targetMarker.hide();
    this.waypoint = null;
    this.game.addMoney(mission.reward);
    this.game.hud?.setJob(jobLabel(null));
    this.game.hud?.setObjective('', 0);
    if (mission.outro?.length) this.game.hud?.say(mission.outro);
    this.game.audio?.stinger(3);
    this.game.toast?.(`${mission.title.toUpperCase()} — $${mission.reward}`);
    this.game.save?.();
    const next = nextMissionId(mission.id);
    if (next) this.game.hud?.setNextJob(next);
  }

  fail(reason) {
    if (!this.active) return;
    this.game.toast?.(`FAILED — ${reason}`);
    this.game.audio?.stinger(0);
    this.state = 'failed';
    this.failTimer = 3.4;
    this.active = null;
    this.marker.hide();
    this.targetMarker.hide();
    this.waypoint = null;
    this.game.hud?.setObjective('', 0);
    for (const r of this.rivals) if (r.alive) r.fleeing = 0;
    this.rivals = [];
  }

  /** Save/load shape: the ids already done. */
  serialize() {
    return { completed: this.completed.slice() };
  }

  restore(data) {
    if (!data) return;
    this.completed = Array.isArray(data.completed) ? data.completed.slice() : [];
    this.game.hud?.setJob(jobLabel(null));
  }
}
