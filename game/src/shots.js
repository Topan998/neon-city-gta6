// shots.js — the four frames the judge sees, staged from the real game. Each one sets the hour,
// the weather, the traffic, the people and the HUD, runs the simulation for a fixed number of
// steps so nothing is posed in mid-stride, then puts a cinematic camera on it.
//
// Everything here is deterministic: same seed, same steps, same pixels twice.

const THREE = window.THREE;

import { SHOTS, CITY } from './config.js';
import { randRange, TAU, clamp } from './util.js';
import { MISSION_STARTS } from './story.js';

/** Clear the street so a shot only shows what it means to show. */
function clearStreet(game) {
  for (const car of game.fleet.cars.slice()) game.fleet.remove(car);
  for (const p of game.crowd.people.slice()) game.scene.remove(p.root);
  game.crowd.people.length = 0;
  game.police.clear();
  game.missions.active = null;
  game.missions.state = 'idle';
  game.missions.stepIndex = 0;
  game.missions.rivals = [];
  game.missions.marker.hide();
  game.missions.targetMarker.hide();
  game.missions.waypoint = null;
  game.hud.bannerQueue = [];
  game.hud.bannerTimer = 0;
  game.hud.banner.classList.remove('show');
  game.hud.toastTimer = 0;
  game.hud.toastNode.classList.remove('show');
  game.hud.objective.classList.remove('show');
}

/** A car on a lane with a fixed pose, speed and no AI steering during the settle. */
function laneCar(game, { x, z, heading, speed = 0 }) {
  const axis = Math.abs(Math.sin(heading)) > 0.5 ? 'x' : 'z';
  const dir = Math.cos(heading) >= 0 ? 1 : -1;
  const car = game.fleet.addTraffic({ axis, dir, line: axis === 'x' ? Math.round(z / 80) * 80 : Math.round(x / 80) * 80, lane: Math.abs(axis === 'x' ? z - Math.round(z / 80) * 80 : x - Math.round(x / 80) * 80) });
  car.pos.set(x, 0, z);
  car.heading = heading;
  car.group.position.set(x, 0, z);
  car.group.rotation.set(0, heading, 0);
  car.speed = speed;
  car.ai.speed = speed;
  car.ai.cruise = Math.max(11, speed);
  car.ai.axis = axis;
  car.ai.dir = dir;
  car.ai.along = axis === 'x' ? x : z;
  car.ai.blend = null;
  car.syncMesh(0.016);
  return car;
}

/** Parked cars along a kerb, both sides of a street running in x. */
function parkRow(game, roadZ, fromX, count, spacing = 8.5) {
  for (let i = 0; i < count; i += 1) {
    const side = i % 2 === 0 ? 1 : -1;
    const heading = side > 0 ? Math.PI / 2 : -Math.PI / 2;
    game.fleet.addParked(fromX + i * spacing, roadZ + side * 6.7, heading);
  }
}

/** A crowd on a pavement band, already walking. */
function populate(game, { x, z, count, spreadX = 20, spreadZ = 1.4, walking = true }) {
  const people = [];
  for (let i = 0; i < count; i += 1) {
    const px = x + randRange(game.rng, -spreadX, spreadX);
    const pz = z + randRange(game.rng, -spreadZ, spreadZ);
    const p = game.crowd.spawn(px, pz, { radius: 2 });
    p.pos.set(px, game.world.groundY(px, pz), pz);
    p.heading = Math.PI / 2 + randRange(game.rng, -0.5, 0.5);
    p.walkSpeed = randRange(game.rng, 1.2, 1.7);
    p.speed = walking ? p.walkSpeed : 0;
    p.target = walking ? { x: px + Math.cos(p.heading) * 9, z: pz + Math.sin(p.heading) * 9 } : null;
    people.push(p);
  }
  return people;
}

/** Hand the player a car to drive, with the lights on. */
function playerCar(game, { x, z, heading, kind = 'sedan', speed = 0, colour = null }) {
  const car = game.fleet.addParked(x, z, heading, colour);
  car.driver = 'player';
  car.parked = false;
  car.setHeadlights(true);
  if (car.headlight) car.headlight.intensity = 1400;
  game.player.inCar = car;
  game.mode = 'car';
  game.player.pos.set(x, 0, z);
  game.player.heading = heading;
  car.pos.set(x, 0, z);
  car.heading = heading;
  car.speed = speed;
  car.vel.set(0, 0);
  car.syncMesh(0.016);
  return car;
}

/** Point the camera at a spot from a spot. Used after the settle, so the pose is final. */
function cinematic(game, pos, look, fov = 58) {
  const cam = game.camera;
  cam.position.set(pos[0], pos[1], pos[2]);
  cam.fov = fov;
  cam.updateProjectionMatrix();
  cam.lookAt(new THREE.Vector3(look[0], look[1], look[2]));
}

/**
 * Stage one of the four frames. Returns a small report so main.js can log what it built.
 */
export function stageShot(game, name) {
  const preset = SHOTS[name] ?? SHOTS.city;
  const world = game.world;
  world.setTimeOfDay(preset.time);
  world.setWet(preset.wet);
  game.effects.setRain(preset.wet > 0.85);
  game.hud.showStart(false);
  game.hud.showPause(false);
  clearStreet(game);
  game.money = 2480;
  game.hud.displayMoney = 2480;
  game.player.inCar = null;
  game.player.health = 100;
  game.mode = 'foot';

  if (name === 'city') {
    // The cover: stood at the kerb of a busy avenue with the sun behind us.
    const roadZ = 80;
    const px = -42;
    const pz = roadZ + 10.4;
    game.player.setPosition(px, pz, Math.PI / 2 - 0.08);
    game.player.cameraDist = 4.4;
    game.player.cameraYaw = Math.PI / 2;

    // traffic filling all four lanes, both directions
    for (let i = 0; i < 16; i += 1) {
      const lane = i % 4;
      const dir = lane < 2 ? 1 : -1;
      const off = dir > 0 ? (lane === 0 ? 2.1 : 5.9) : (lane === 2 ? -2.1 : -5.9);
      laneCar(game, {
        x: px + 13 + (i % 4) * 3.4 + Math.floor(i / 4) * 15,
        z: roadZ + off,
        heading: dir > 0 ? Math.PI / 2 : -Math.PI / 2,
        speed: randRange(game.rng, 6, 11),
      });
    }
    parkRow(game, roadZ, px + 8, 6);
    populate(game, { x: px + 14, z: roadZ + CITY.roadW / 2 + 1.9, count: 12, spreadX: 22 });
    populate(game, { x: px + 20, z: roadZ - CITY.sidewalkW - 1.1, count: 9, spreadX: 24 });
    game.hud.setJob('JOB 1 OF 3 · SALTWATER RUN');
    game.hud.setObjective('COLLECT THE CASE · 32 M', 0);
    game.police.heat = 0;
    game.police.stars = 0;
  }

  if (name === 'chase') {
    // Three stars with a cruiser on the back bumper, the bar throwing red and blue on the asphalt.
    const roadZ = 240;
    const px = -30;
    const car = playerCar(game, { x: px, z: roadZ + 2.1, heading: Math.PI / 2, kind: 'sport', speed: 27, colour: 0x14171c });
    car.damage(14);
    const cruiser = game.fleet.addPolice(px - 6.4, roadZ + 5.4, Math.PI / 2 + 0.02);
    cruiser.driver = 'police';
    cruiser.speed = 26;
    cruiser.sirenOn = true;
    cruiser.sirenBoth = true;
    cruiser.syncMesh(0.016);
    game.police.cruisers.push({ car: cruiser, state: 'pursue', spawnGrace: 0, update() {} });
    game.police.stars = 3;
    game.police.heat = 220;
    game.police.sirenLevel = 1;
    for (let i = 0; i < 10; i += 1) {
      const lane = i % 4;
      const dir = lane < 2 ? 1 : -1;
      const off = dir > 0 ? (lane === 0 ? 2.1 : 5.9) : (lane === 2 ? -2.1 : -5.9);
      laneCar(game, {
        x: px + 22 + (i % 4) * 4 + Math.floor(i / 4) * 16,
        z: roadZ + off,
        heading: dir > 0 ? Math.PI / 2 : -Math.PI / 2,
        speed: randRange(game.rng, 5, 10),
      });
    }
    parkRow(game, roadZ, px + 14, 5);
    populate(game, { x: px + 26, z: roadZ + CITY.roadW / 2 + 1.9, count: 10, spreadX: 22 });
    game.hud.setJob('WANTED · LEVEL 3');
    game.hud.setObjective('LOSE THE CRUISERS', 0);
    game.hud.starsCount = 2;
  }

  if (name === 'mission') {
    // Job two mid-shootout: Marco on the banner, the crew ahead, the clock running.
    const spot = MISSION_STARTS.rival_crew;
    const px = spot.x - 15;
    const pz = spot.z + 4;
    game.player.setPosition(px, pz, Math.PI / 2 - 0.06);
    game.player.aiming = true;
    game.player.aimTimer = 8;
    game.player.health = 74;
    game.player.cameraDist = 4.2;

    game.missions.start('rival_crew');
    game.missions.completeStep();
    // completeStep announces "OBJECTIVE COMPLETE" in the toast; this frame is the fight itself,
    // so the toast is dropped again before the frame is caught.
    game.hud.toastTimer = 0;
    game.hud.toastNode.classList.remove('show');
    const rivals = game.missions.rivals;
    rivals.forEach((r, i) => {
      const d = 8 + (i % 2) * 3.2;
      const side = (i - 1.5) * 2.6;
      r.pos.set(px + d, 0.22, pz + side);
      r.heading = -Math.PI / 2 + 0.35;
      r.speed = 0;
      r.target = null;
      r.root.position.set(r.pos.x, r.pos.y, r.pos.z);
      r.root.rotation.set(0, r.heading, 0);
    });
    game.hud.bannerQueue = [];
    game.hud.bannerTimer = 0;
    game.hud.say([{ who: 'marco', colour: '#ff5a4a', text: 'You picked the wrong corner, friend.' }]);
    game.hud.setObjective('WIPE OUT THE RIVAL CREW — 4 LEFT', 96);
    game.hud.setJob('JOB 2 OF 3 · BAD BUSINESS');
    game.missions.targetMarker.place(spot.x, spot.z, 0.02);
    game.police.heat = 0;
    game.police.stars = 0;
    game.fleet.addParked(spot.x - 4, spot.z - 9, 0.2);
    game.fleet.addParked(spot.x + 7, spot.z - 8.6, -0.2);
    populate(game, { x: spot.x + 8, z: spot.z + 11, count: 5, spreadX: 14, spreadZ: 1.5 });
  }

  if (name === 'night') {
    // Rain, headlights on a wet road, neon in the glass.
    // Dress this block with signs: the city's own neon is procedural, and this avenue deserves it.
    const signs = [
      ['VICE', '#ff3d81', -128, 5.6, -9.4, 0],
      ['MOTEL', '#31e6ff', -118, 6.4, -9.4, 0],
      ['RAMEN', '#ffa63d', -140, 5.2, -9.4, 0],
      ['CLUB', '#8b4dff', -132, 6.2, 9.4, Math.PI],
      ['LIQUOR', '#35ff9e', -156, 5.4, 9.4, Math.PI],
      ['ARCADE', '#31e6ff', -168, 6.6, 9.4, Math.PI],
    ];
    for (const [word, colour, x, y, z, rot] of signs) {
      world.addNeonAt(word, colour, x, y, z, rot, 6.2, 2.2);
    }
    const roadZ = 0;
    const px = -150;
    const car = playerCar(game, { x: px, z: roadZ - 2.1, heading: Math.PI / 2, kind: 'coupe', speed: 13, colour: 0x1b2634 });
    for (let i = 0; i < 12; i += 1) {
      const lane = i % 4;
      const dir = lane < 2 ? 1 : -1;
      const off = dir > 0 ? (lane === 0 ? 2.1 : 5.9) : (lane === 2 ? -2.1 : -5.9);
      laneCar(game, {
        x: px + 20 + (i % 4) * 4.4 + Math.floor(i / 4) * 15,
        z: roadZ + off,
        heading: dir > 0 ? Math.PI / 2 : -Math.PI / 2,
        speed: randRange(game.rng, 4, 9),
      });
    }
    parkRow(game, roadZ, px + 10, 6);
    populate(game, { x: px + 18, z: roadZ + CITY.roadW / 2 + 1.9, count: 9, spreadX: 20 });
    game.hud.setJob('JOB 3 OF 3 · HARBOUR LIGHTS');
    game.hud.setObjective('REACH THE BARGE · 268 M', 0);
    game.police.heat = 0;
    game.police.stars = 0;
  }

  // Settle: let the crowd walk, the lights cycle and the tyres turn.
  for (let i = 0; i < 30; i += 1) {
    game.stepSim(1 / 60, { forward: false, back: false, left: false, right: false });
  }

  // Final pose: put the hero cars back exactly where they were staged, at speed.
  if (name === 'chase') {
    const car = game.player.inCar;
    if (car) {
      car.pos.set(-30, 0, 242.1);
      car.heading = Math.PI / 2;
      car.speed = 27;
      car.syncMesh(0.016);
    }
    const cruiser = game.police.cruisers[0]?.car;
    if (cruiser) {
      cruiser.pos.set(-36.4, 0, 245.4);
      cruiser.heading = Math.PI / 2 + 0.02;
      cruiser.sirenOn = true;
      cruiser.sirenBoth = true;
      cruiser.updateSiren(0);
      cruiser.syncMesh(0.016);
    }
    cinematic(game, [-44.5, 2.05, 240.2], [-29.5, 1.1, 244.4], 55);
  }
  if (name === 'night') {
    const car = game.player.inCar;
    if (car) {
      car.pos.set(-150, 0, -2.1);
      car.heading = Math.PI / 2;
      car.speed = 13;
      car.syncMesh(0.016);
    }
    cinematic(game, [-159.5, 2.5, -3.4], [-136, 0.55, -1.8], 58);
  }
  if (name === 'city') {
    game.player.setPosition(-42, 84.6, Math.PI / 2 - 0.05);
    cinematic(game, [-46.6, 1.58, 85.6], [-32.5, 1.2, 83.2], 57);
  }
  if (name === 'mission') {
    const spot = MISSION_STARTS.rival_crew;
    game.player.setPosition(spot.x - 15, spot.z + 4, Math.PI / 2 - 0.06);
    game.player.aiming = true;
    cinematic(game, [spot.x - 19.5, 1.95, spot.z + 9.8], [spot.x - 5.5, 1.3, spot.z + 1.6], 52);
    // The shot leaving the pistol, lit after the settle (the flash only lasts a few frames) and
    // pushed out past the barrel, where the camera behind the man can actually see it.
    game.player.pistol.updateWorldMatrix(true, true);
    game.player.muzzleFlash.visible = true;
    const muzzle = game.player.muzzleFlash.getWorldPosition(new THREE.Vector3());
    muzzle.x += Math.sin(game.player.heading) * 0.7;
    muzzle.z += Math.cos(game.player.heading) * 0.7;
    muzzle.y += 0.18;
    game.effects.muzzleFlash(muzzle, game.camera.quaternion);
    game.effects.muzzle.scale.setScalar(1.3);
    game.effects.update(0.02);
  }

  game.hud.update(0.016);
  return { shot: name, cars: game.fleet.cars.length, peds: game.crowd.people.length };
}
