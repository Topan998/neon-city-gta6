// The four photographs the entry hands in, staged from the real game: each one places the player,
// the traffic, the police and the job on the streets, then runs the ordinary simulation for a
// moment so the frame is a genuine tick of the game rather than a pose. `?shot=city|chase|mission|
// night` picks one; nothing here is drawn by hand.
//
// Every scene is built to show more than one system at once: a walk cycle mid-stride on a busy
// pavement, a cruiser alongside with its bar lit, a job banner over a live marker, and a wet
// boulevard at midnight. The camera rig is tuned per scene (`player.setRig`), and the last thing each
// function does is leave the frame exactly as the photograph should find it.

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
  player.group.position.set(x, api.world.groundHeight(x, z), z);
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

/** Clear the random kerbside and passing cars that would crop into a staged frame. */
function clearParkedNear(api, x, z, radius) {
  for (const car of api.vehicles.cars.slice()) {
    if (car.driver === 'player' || car.driver === 'police') continue;
    if (Math.hypot(car.x - x, car.z - z) < radius) api.vehicles.removeCar(car);
  }
}

/** Run the real simulation for a while with the keys a player would be holding. */
function settle(api, seconds) {
  const steps = Math.max(1, Math.round(seconds / STEP));
  for (let i = 0; i < steps; i += 1) api.step(STEP);
}

function resetProgress(api, money, jobs = 0) {
  api.state.money = money;
  api.state.completed = jobs > 0 ? ['salt-run'] : [];
  api.state.jobs = api.state.completed.length;
  api.state.wanted = 0;
  api.state.heat = 0;
  api.state.time = 0;
  api.police.clear();
  api.missions.reset();
  api.hud.setTimer('');
  api.hud.setObjective('', '');
}

export function stageShot(name, api) {
  const { player, vehicles, police, missions, world, input } = api;
  input.goSimulated();
  player.setRig(null);

  if (name === 'city') {
    // The cover: on the pavement of the central avenue, mid-stride, cars running both ways, palms
    // over the kerb and the towers of downtown closing the view. The camera sits close and low.
    resetProgress(api, 6980, 1);
    world.setTimeOfDay(0);
    world.setWet(0.2);
    // Just inside the kerb of the block west of the x=0 avenue, looking up it.
    clearParkedNear(api, -7.9, -56, 34);
    standAt(api, -7.9, -47, 0.16, -0.07);
    player.setRig({ distance: 4.3, shoulder: 0.4, lift: 0.06 });

    addTraffic(api, 'z', 0, -22, 1, 11);
    addTraffic(api, 'z', 0, 6, 1, 12);
    addTraffic(api, 'z', 0, 34, 1, 10);
    addTraffic(api, 'z', 0, -2, -1, 10);
    addTraffic(api, 'z', 0, 26, -1, 11);
    addTraffic(api, 'z', 0, -30, -1, 9);
    addTraffic(api, 'x', 0, -33, 1, 9);
    addTraffic(api, 'x', 0, 18, -1, 9);
    parkAt(api, -5.4, -62, 0, 0xf7c04a);
    parkAt(api, 5.4, -38, Math.PI, 0xe8e8ec);
    parkAt(api, -5.4, 12, 0, 0x4a7bd0);
    api.pedestrians.focusCrowd(-35, -42, 30);

    // Walk a couple of strides so the legs are caught mid-swing rather than standing to attention.
    input.setKey('KeyW', true);
    settle(api, 0.62);
    api.hud.setObjective('', '');
    return;
  }

  if (name === 'chase') {
    // Three stars, a cruiser alongside with the bar lit, another closing from behind, the boulevard
    // ahead still full of traffic.
    resetProgress(api, 6180);
    world.setTimeOfDay(0.06);
    world.setWet(0.3);
    const car = driveAt(api, -3.3, -62, 0, 26, 0xef5b6b);
    api.state.wanted = 3;
    api.state.heat = 82;
    police.setWanted(3);

    // Beside and a nose ahead: inside the chase camera's frame, close enough to read the bar.
    police.spawnAt(1.2, -58.5, 0.06, 27);
    // Twelve metres back down the lane: the car that started the chase.
    police.spawnAt(-3.3, -74, 0, 30);
    // A roadblock forming up the avenue, and one turning in from the cross street.
    police.spawnAt(3.3, -18, Math.PI, 12);
    police.spawnAt(roadLine(4) - 3.3, -70, Math.PI / 2, 10);

    addTraffic(api, 'z', 0, -34, 1, 9);
    addTraffic(api, 'z', 0, 14, 1, 8.5);
    addTraffic(api, 'z', 0, 40, -1, 9.5);
    addTraffic(api, 'z', 0, -50, 1, 11);
    addTraffic(api, 'x', 0, -30, -1, 8);
    api.pedestrians.focusCrowd(-35, -52, 24);

    api.hud.setObjective('Wanted', 'Three stars — shake them or lose the car');
    input.setKey('KeyW', true);
    settle(api, 0.24);
    input.setKey('KeyW', false);
    player.state.car = car;
    api.state.wanted = 3;
    api.state.heat = 82;
    // The bar is caught on its red half, at full bloom.
    police.snapLights('red');
    api.hud.setWanted(3);
    return;
  }

  if (name === 'mission') {
    // The job on the HUD: the Cobalt GT rolling up the avenue with the drop beacon ahead of it.
    resetProgress(api, 7350);
    world.setTimeOfDay(0.12);
    world.setWet(0.2);
    missions.stage('salt-run');

    const target = { x: roadLine(6), z: roadLine(6) };
    const gold = vehicles.cars.find((entry) => entry.tag === 'salt-car');
    clearParkedNear(api, target.x, target.z - 50, 40);
    standAt(api, target.x - 3.4, target.z - 38, 0, -0.06);
    if (gold) {
      gold.x = target.x - 3.4;
      gold.z = target.z - 44;
      gold.heading = 0;
      gold.mesh.position.set(gold.x, 0, gold.z);
      gold.mesh.rotation.y = 0;
      gold.vx = 0;
      gold.vz = 19;
      gold.speed = 19;
      player.state.car = gold;
      player.state.x = gold.x;
      player.state.z = gold.z;
      player.cameraYaw = 0;
      player.pitch = -0.03;
      player.group.visible = false;
      player.snapCamera();
    }

    addTraffic(api, 'x', target.x, target.x - 30, 1, 9);
    addTraffic(api, 'z', target.x, target.z + 40, -1, 8);
    addTraffic(api, 'z', target.x, target.z - 34, 1, 10);
    parkAt(api, target.x + 5.4, target.z - 40, 0, 0x2fbfa0);
    parkAt(api, target.x - 5.4, target.z + 26, Math.PI, 0xe8e8ec);
    api.pedestrians.focusCrowd(target.x, target.z - 20, 26);

    api.hud.setObjective('Salt Run', 'Drive the Cobalt GT into the locks.');
    api.hud.setTimer('DELIVERY 96s');
    input.setKey('KeyW', true);
    settle(api, 0.45);
    input.setKey('KeyW', false);
    api.hud.setObjective('Salt Run', 'Drive the Cobalt GT into the locks.');
    api.hud.setTimer('DELIVERY 96s');
    api.hud.setSpeed(player.state.car ? player.state.car.speed * 3.6 : 0, true);
    return;
  }

  // night: the boulevard after dark, windows and lamps lit, the asphalt wet enough to carry them.
  resetProgress(api, 5290, 2);
  world.setTimeOfDay(1);
  world.setWet(1);
  driveAt(api, -3.3, 24, 0, 16, 0xb46ad8);

  addTraffic(api, 'z', 0, 58, 1, 9);
  addTraffic(api, 'z', 0, 88, 1, 10);
  addTraffic(api, 'z', 0, 2, -1, 10);
  addTraffic(api, 'z', 0, -30, -1, 9);
  addTraffic(api, 'x', 0, 30, -1, 8);
  addTraffic(api, 'x', 0, -22, 1, 9);
  addTraffic(api, 'z', 0, 40, -1, 9);
  parkAt(api, -5.4, 44, 0, 0xef5b6b);
  parkAt(api, -5.4, 56, 0, 0xe8e8ec);
  parkAt(api, 5.4, 64, Math.PI, 0xf7c04a);
  parkAt(api, 5.4, 12, Math.PI, 0x2a2f3a);
  api.pedestrians.focusCrowd(-35, 34, 28);

  api.hud.setObjective('Night shift', 'The boulevard never closes');
  api.hud.setTimer('');
  input.setKey('KeyW', true);
  settle(api, 0.42);
  input.setKey('KeyW', false);
  api.hud.setObjective('Night shift', 'The boulevard never closes');
}
