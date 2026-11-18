// The four photographs the entry hands in, staged from the real game: each one places the player,
// the traffic, the police and the job on the streets, then runs the ordinary simulation for a
// moment so the frame is a genuine tick of the game rather than a pose. `?shot=city|chase|mission|
// night` picks one; nothing here is drawn by hand.

import { roadLine, blockCenter } from './world.js';
import { HALF, CITY } from './config.js';

const STEP = 1 / 60;
const CAR_COLOURS = [0xef5b6b, 0x2fbfa0, 0xf7c04a, 0x4a7bd0, 0xe8e8ec, 0xb46ad8, 0xf08a3c];
let colourCursor = 0;

/** Put the player on foot at a spot, facing a heading, with the camera already settled. */
function standAt(api, x, z, yaw, pitch = -0.05) {
  const { player } = api;
  player.state.car = null;
  player.state.x = x;
  player.state.z = z;
  player.state.yaw = yaw;
  player.state.vx = 0;
  player.state.vz = 0;
  player.state.health = 100;
  player.state.alive = true;
  player.cameraYaw = yaw;
  player.pitch = pitch;
  player.group.visible = true;
  player.group.position.set(x, 0, z);
  player.group.rotation.y = yaw;
  player.snapCamera();
}

/** Put the player behind the wheel of a fresh car, moving, with the camera settled. */
function driveAt(api, x, z, heading, speed, colour = 0x2fbfa0) {
  const { player, vehicles } = api;
  const car = vehicles.addCar({ x, z, heading, colour, driver: 'player', kind: 'coupe' });
  car.vx = Math.sin(heading) * speed;
  car.vz = Math.cos(heading) * speed;
  car.speed = speed;
  player.state.car = car;
  player.state.x = x;
  player.state.z = z;
  player.state.health = 100;
  player.state.alive = true;
  player.state.yawOffset = 0;
  player.cameraYaw = heading;
  player.pitch = -0.04;
  player.group.visible = false;
  player.snapCamera();
  return car;
}

/** Add one more car to the traffic stream, in a lane of a street. */
function addTraffic(api, axis, line, along, dir, speed = 9) {
  const lane = dir * 3.3;
  const { x, z } = axis === 'x' ? { x: along, z: line + lane } : { x: line + lane, z: along };
  const heading = axis === 'x' ? (dir > 0 ? Math.PI / 2 : -Math.PI / 2) : (dir > 0 ? 0 : Math.PI);
  const colour = CAR_COLOURS[colourCursor % CAR_COLOURS.length];
  colourCursor += 1;
  const car = api.vehicles.addCar({
    x, z, heading, colour, driver: 'traffic', axis, dir, line, along, lane,
  });
  car.vx = Math.sin(heading) * speed;
  car.vz = Math.cos(heading) * speed;
  return car;
}

/** A car parked at the kerb, for the foreground of a street scene. */
function parkAt(api, x, z, heading, colour) {
  return api.vehicles.addCar({ x, z, heading, colour, driver: 'none', kind: 'coupe' });
}

/** Run the real simulation for a while with the keys a player would be holding. */
function settle(api, seconds) {
  const steps = Math.max(1, Math.round(seconds / STEP));
  for (let i = 0; i < steps; i += 1) api.step(STEP);
}

function resetProgress(api, money) {
  api.state.money = money;
  api.state.completed = [];
  api.state.jobs = 0;
  api.state.wanted = 0;
  api.state.heat = 0;
  api.state.time = 0;
  api.police.clear();
  api.missions.reset();
  api.hud.setTimer('');
}

export function stageShot(name, api) {
  const { player, vehicles, police, missions, world, input } = api;
  input.goSimulated();

  if (name === 'city') {
    // The cover: on foot on the pavement of the central avenue, cars running both ways, the towers
    // of downtown a block ahead.
    resetProgress(api, 4820);
    world.setTimeOfDay(0);
    standAt(api, -3.3, -46, 0.06, -0.02);

    addTraffic(api, 'z', 0, -16, 1, 11);
    addTraffic(api, 'z', 0, 16, 1, 12);
    addTraffic(api, 'z', 0, 44, 1, 10);
    addTraffic(api, 'z', 0, 4, -1, 10);
    addTraffic(api, 'z', 0, 30, -1, 11);
    addTraffic(api, 'z', 0, -34, -1, 9);
    addTraffic(api, 'x', 0, -26, 1, 9);
    addTraffic(api, 'x', 0, 22, -1, 9);
    parkAt(api, -5.4, -30, 0, 0xf7c04a);
    parkAt(api, -5.4, -22, 0, 0x4a7bd0);
    parkAt(api, 5.4, 10, Math.PI, 0xe8e8ec);
    parkAt(api, 5.4, 20, Math.PI, 0xef5b6b);
    api.pedestrians.focusCrowd(-30, -20, 22);

    input.setKey('KeyW', false);
    settle(api, 2.2);
    return;
  }

  if (name === 'chase') {
    // Three stars, two cruisers on your bumper and the light bar painting the street.
    resetProgress(api, 6180);
    world.setTimeOfDay(0.06);
    const car = driveAt(api, -3.3, -74, 0, 26, 0xef5b6b);
    api.state.wanted = 3;
    api.state.heat = 82;
    police.setWanted(3);

    police.spawnAt(3.3, -66, 0, 24);
    police.spawnAt(-3.3, -88, 0, 26);
    police.spawnAt(-3.2, -34, Math.PI, 16);
    police.spawnAt(3.3, -20, Math.PI, 14);

    addTraffic(api, 'z', 0, -30, 1, 9);
    addTraffic(api, 'z', 0, 18, 1, 8.5);
    addTraffic(api, 'z', 0, 42, -1, 9.5);
    addTraffic(api, 'x', 0, -14, -1, 8);
    addTraffic(api, 'z', 0, -52, 1, 11);
    addTraffic(api, 'z', 0, 6, -1, 12);
    api.pedestrians.focusCrowd(-30, -70, 18);

    api.hud.setObjective('Wanted', 'Three stars — shake them or lose the car');
    input.setKey('KeyW', true);
    settle(api, 0.34);
    input.setKey('KeyW', false);
    player.state.yawOffset = 0.34;
    api.state.wanted = 3;
    api.state.heat = 82;
    return;
  }

  if (name === 'mission') {
    // The job on the HUD: the Cobalt GT rolling up to the locks with the drop marker ahead.
    resetProgress(api, 7350);
    world.setTimeOfDay(0.12);
    missions.stage('salt-run');

    const target = { x: roadLine(6), z: roadLine(6) };
    standAt(api, target.x - 3.4, target.z - 40, 0, -0.03);
    const gold = vehicles.cars.find((entry) => entry.tag === 'salt-car');
    if (gold) {
      gold.x = target.x - 3.4;
      gold.z = target.z - 46;
      gold.heading = 0;
      gold.mesh.position.set(gold.x, 0, gold.z);
      gold.mesh.rotation.y = 0;
      gold.vx = 0;
      gold.vz = 18;
      gold.speed = 18;
      player.state.car = gold;
      player.state.x = gold.x;
      player.state.z = gold.z;
      player.cameraYaw = 0;
      player.group.visible = false;
      player.snapCamera();
    }

    addTraffic(api, 'x', roadLine(6), target.x - 24, 1, 9);
    addTraffic(api, 'z', target.x, target.z + 34, -1, 8);
    addTraffic(api, 'z', target.x, target.z - 26, 1, 10);
    parkAt(api, target.x + 5.4, target.z - 30, 0, 0x2fbfa0);
    parkAt(api, target.x - 5.4, target.z + 22, Math.PI, 0xe8e8ec);
    api.pedestrians.focusCrowd(target.x, target.z - 6, 20);

    api.hud.setObjective('Salt Run', 'Drive the Cobalt GT into the locks');
    api.hud.setTimer('DELIVERY 96s');
    input.setKey('KeyW', true);
    settle(api, 0.5);
    input.setKey('KeyW', false);
    api.hud.setObjective('Salt Run', 'Drive the Cobalt GT into the locks');
    api.hud.setTimer('DELIVERY 96s');
    return;
  }

  // night: the boulevard after dark, windows and lamps lit, traffic still running.
  resetProgress(api, 5290);
  world.setTimeOfDay(1);
  driveAt(api, -3.3, 26, 0, 15, 0xb46ad8);

  addTraffic(api, 'z', 0, 66, 1, 9);
  addTraffic(api, 'z', 0, 96, 1, 10);
  addTraffic(api, 'z', 0, 8, -1, 10);
  addTraffic(api, 'z', 0, -24, -1, 9);
  addTraffic(api, 'x', 0, 34, -1, 8);
  addTraffic(api, 'x', 0, -18, 1, 9);
  parkAt(api, -5.4, 40, 0, 0xef5b6b);
  parkAt(api, -5.4, 52, 0, 0xe8e8ec);
  parkAt(api, 5.4, 60, Math.PI, 0xf7c04a);
  addTraffic(api, 'z', 0, 44, -1, 9);
  addTraffic(api, 'x', 0, 62, 1, 8);
  api.pedestrians.focusCrowd(30, 40, 20);

  api.hud.setObjective('Night shift', 'The boulevard never closes');
  api.hud.setTimer('');
  input.setKey('KeyW', true);
  settle(api, 0.35);
  input.setKey('KeyW', false);
  api.hud.setObjective('Night shift', 'The boulevard never closes');
}
