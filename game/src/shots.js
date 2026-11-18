// shots.js — the four staged screenshots.
//
// Each shot is staged from the real simulation: the same world, the same cars, the same rigs. We place
// the player, arrange traffic and crowd along the street the camera looks down, set the time of day,
// then run a fixed number of fixed-size steps with scripted controls and freeze. Nothing reads the
// wall clock afterwards, so two runs of the same shot render byte-identical frames.

import { CITY, SHOTS, TOD } from './config.js';
import { RNG, TAU, clamp } from './util.js';

function basis(yaw) {
  return {
    fx: Math.cos(yaw),
    fz: -Math.sin(yaw),
    rx: Math.sin(yaw),
    rz: Math.cos(yaw),
  };
}

// Everything the crowd placement needs to know about the street the camera looks along.
function streetFrame(x, z, yaw) {
  const b = basis(yaw);
  const vertical = Math.abs(b.fz) > Math.abs(b.fx); // looking along z
  const roadIndex = vertical
    ? Math.round((x - CITY.roadLine(0)) / CITY.pitch)
    : Math.round((z - CITY.roadLine(0)) / CITY.pitch);
  const roadCoord = CITY.roadLine(clamp(roadIndex, 0, CITY.blocks));
  const forwardSign = vertical ? Math.sign(b.fz) || 1 : Math.sign(b.fx) || 1;
  const along = vertical ? z : x;
  const rows = [];
  for (let k = roadIndex; k <= CITY.blocks; k++) {
    const line = CITY.roadLine(k);
    const delta = (line - along) * forwardSign;
    if (delta > -20 && delta < 130) rows.push(k);
  }
  if (!rows.length) rows.push(clamp(roadIndex, 0, CITY.blocks - 1));
  return { vertical, roadIndex, roadCoord, forwardSign, along, rows, ...b };
}

function laneOffset(frame, lateral) {
  return {
    x: frame.vertical ? frame.rx * lateral : 0,
    z: frame.vertical ? frame.rz * lateral : 0,
  };
}

function dressTraffic(game, shot, frame) {
  const rng = new RNG(shot.seed + 17);
  const cars = game.traffic.cars;
  const origin = { x: shot.car.x, z: shot.car.z };
  const b = basis(shot.car.angle);

  // Park the whole fleet out of frame first, then bring back the ones that matter.
  for (const car of cars) {
    car.root.visible = false;
    car.active = false;
    car.ai = null;
    car.speed = 0;
  }

  // Right-hand traffic: keep to the right of the direction of travel.
  const right = { x: Math.sin(shot.car.angle), z: Math.cos(shot.car.angle) };
  let index = 0;
  const place = (alongAhead, lateral, heading, speed, kind) => {
    if (index >= cars.length) return null;
    const car = cars[index++];
    const x = origin.x + frame.fx * alongAhead + right.x * lateral;
    const z = origin.z + frame.fz * alongAhead + right.z * lateral;
    car.root.visible = true;
    car.active = true;
    car.place(x, z, heading);
    car.speed = speed;
    if (kind) car.body.material = car.body.material; // shared material, nothing to do
    car.ai = {
      axis: frame.vertical ? 'z' : 'x',
      dir: Math.sign(frame.vertical ? Math.cos(heading) : Math.cos(heading)) || 1,
      target: {
        x: x + Math.cos(heading) * 90,
        z: z - Math.sin(heading) * 90,
      },
      cruise: speed || 10,
      stuck: 0,
    };
    return car;
  };

  // Same-direction traffic ahead in our lane, staggered.
  const ahead = [9, 17, 27, 40, 56, 74, 94];
  for (let i = 0; i < ahead.length; i++) {
    place(ahead[i], 3.05, shot.car.angle, 8 + (i % 3) * 1.6);
  }
  // Oncoming traffic in the other lane.
  const oncoming = [11, 21, 34, 50, 68, 90];
  for (let i = 0; i < oncoming.length; i++) {
    place(oncoming[i], -3.05, shot.car.angle + Math.PI, 9 + (i % 2) * 2);
  }
  // Cross traffic crossing the next intersection.
  const cross = cars[index];
  if (cross) {
    const node = frame.rows[1] !== undefined ? frame.rows[1] : frame.roadIndex;
    const line = CITY.roadLine(node);
    cross.root.visible = true;
    cross.active = true;
    if (frame.vertical) {
      cross.place(frame.roadCoord - 26, line, 0);
      cross.ai = { axis: 'x', dir: 1, target: { x: frame.roadCoord + 80, z: line }, cruise: 11, stuck: 0 };
    } else {
      cross.place(line, frame.roadCoord - 26, -Math.PI / 2);
      cross.ai = { axis: 'z', dir: 1, target: { x: line, z: frame.roadCoord + 80 }, cruise: 11, stuck: 0 };
    }
    cross.root.visible = true;
    index++;
  }
  return rng;
}

// Put people on the kerbs the camera can see, walking in both directions.
function dressCrowd(game, shot, frame) {
  const rng = new RNG(shot.seed + 29);
  const peds = game.peds.peds;
  const sideA = frame.vertical
    ? { column: frame.roadIndex, side: 3 } // +x kerb of the street
    : { column: frame.roadIndex, side: 2 }; // -z kerb of the street
  const sideB = frame.vertical
    ? { column: frame.roadIndex - 1, side: 1 } // -x kerb
    : { column: frame.roadIndex - 1, side: 0 }; // +z kerb

  const rows = frame.rows.slice(0, 2);
  let n = 0;
  for (const row of rows) {
    for (const side of [sideA, sideB]) {
      const column = clamp(side.column, 0, CITY.blocks - 1);
      for (let k = 0; k < 4 && n < peds.length; k++) {
        const ped = peds[n++];
        ped.bi = column;
        ped.bj = clamp(row, 0, CITY.blocks - 1);
        ped.side = side.side;
        ped.u = rng.range(-12.5, 12.5);
        ped.dir = rng.chance(0.5) ? 1 : -1;
        ped.state = 'walk';
        ped.pause = 0;
        ped.cruise = rng.range(1.2, 1.75);
        ped.speedNow = ped.cruise;
        ped.phase = rng.range(0, TAU);
        game.peds.placePed(ped);
      }
    }
  }
  // Anyone left over goes far from the lens so they cannot clutter it.
  for (let i = n; i < peds.length; i++) {
    const ped = peds[i];
    ped.bi = 0;
    ped.bj = 0;
    ped.side = 0;
    ped.u = clamp(ped.u, -12, 12);
    game.peds.placePed(ped);
  }
}

function parkNeighbours(game, shot, frame) {
  // Traffic cars that are not in the shot are hidden; the player's own car is placed separately.
  for (const car of game.traffic.cars) {
    if (!car.active) {
      car.root.visible = false;
      car.speed = 0;
    }
  }
}

export function stageShot(game, name) {
  const shot = SHOTS[name];
  if (!shot) return false;

  game.setTimeOfDay(shot.tod);
  game.hud.hideStart();
  game.started = true;
  game.paused = false;
  game.frozen = false;

  const frame = streetFrame(shot.car ? shot.car.x : shot.player.x, shot.car ? shot.car.z : shot.player.z, shot.car ? shot.car.angle : shot.player.angle);
  dressTraffic(game, shot, frame);
  dressCrowd(game, shot, frame);
  if (game.shotName && game.traffic.cars.some((c) => !Number.isFinite(c.x))) game.nanAt = 'traffic-after-dress';

  // The player's car.
  const car = game.playerCar;
  car.root.visible = true;
  car.place(shot.car.x, shot.car.z, shot.car.angle);
  car.speed = shot.car.speed || 0;
  if (game.shotName && !Number.isFinite(game.playerCar.x)) game.nanAt = 'car-place';

  const player = game.player;
  if (shot.onFoot) {
    player.inCar = null;
    player.place(shot.player.x, shot.player.z, shot.player.angle);
    player.root.visible = true;
    player.cameraYaw = shot.camera.yaw ?? 0;
    player.aim = 0;
    game.driveCar = car;
  } else {
    player.enterCar(car);
    player.x = car.x;
    player.z = car.z;
    player.y = 0;
    game.driveCar = car;
  }

  // Camera: free of the mouse, exactly as configured.
  game.cameraYaw = shot.car.angle + (shot.camera.yaw || 0);
  game.mousePitch = shot.camera.pitch || -0.06;
  game.orbitBias = shot.camera.yaw || 0;
  game.cameraRig.configure(shot.onFoot ? 'foot' : 'car');
  game.cameraRig.desiredDistance = shot.camera.distance;
  game.cameraRig.desiredHeight = shot.camera.height;
  game.cameraRig.desiredShoulder = shot.onFoot ? 0.55 : 0.0;
  game.cameraRig.yaw = game.cameraYaw;
  game.cameraRig.pitch = game.mousePitch;
  game.cameraRig.update(1, shot.onFoot ? player : car, true);

  if (name === 'chase') {
    const cruiser = game.police.stageChase(car.x, car.z, car.yaw + Math.PI * 0.06, 7.6);
    if (cruiser) {
      cruiser.flash = 1;
      // A second cruiser further back, in frame, so the street reads as a pursuit.
      const extra = game.police.acquireCruiser();
      if (extra) {
        extra.place(
          car.x - Math.cos(car.yaw) * 22 + Math.sin(car.yaw) * 5.2,
          car.z + Math.sin(car.yaw) * 22 + Math.cos(car.yaw) * 5.2,
          car.yaw,
        );
        extra.speed = 10;
        extra.active = true;
        extra.root.visible = true;
      }
    }
    game.police.stars = 3;
    game.police.rising = 0;
  }

  if (name === 'mission') {
    game.missions.stage(1, 96);
    game.hud.setBanner('', 'info', true);
    game.missions.setMarker(88, -56);
    game.missions.ring.visible = true;
    game.police.stars = 0;
    game.police.rising = 0;
  }

  if (name === 'city' || name === 'night') {
    game.police.clear();
    game.hud.setBanner('', 'info', true);
  }

  if (shot.hud && shot.hud.banner && name !== 'mission' && name !== 'chase') {
    game.hud.setBanner(shot.hud.banner, 'job', true);
  }

  // A short settle: wheels, walk cycles and traffic advance to a lively pose, then the frame is
  // recomposed so the camera sits exactly where the recipe says, and frozen.
  const steps = name === 'mission' ? 40 : 32;
  const controls = {
    fwd: 0,
    strafe: 0,
    run: false,
    aim: false,
    firing: false,
    throttle: name === 'city' || name === 'night' ? 0.3 : 0,
    brake: 0,
    steer: 0,
    handbrake: false,
  };
  for (let i = 0; i < steps; i++) {
    game.simulate(1 / 60, controls);
  }

  composeShot(game, shot, name);

  game.frozen = true;
  game.render();
  return true;
}

// Put every hero element exactly where the recipe wants it, and snap the camera. Callable twice:
// once before the settle (so the settle starts from the right pose) and once after (so nothing the
// simulation did can drift out of frame).
function composeShot(game, shot, name) {
  const car = game.playerCar;
  car.root.visible = true;
  car.place(shot.car.x, shot.car.z, shot.car.angle);
  car.speed = shot.car.speed || 0;
  car.wheelSpin = 2.4;
  car.updateVisual(1 / 60);

  const player = game.player;
  if (shot.onFoot) {
    player.place(shot.player.x, shot.player.z, shot.player.angle);
    player.root.visible = true;
    player.cameraYaw = shot.player.angle;
    player.speed = 0;
    player.phase = 0.9;
    player.aim = name === 'mission' ? 1 : 0;
    player.animate(0, { aim: player.aim > 0.5 });
  } else {
    player.inCar = car;
    player.x = car.x;
    player.z = car.z;
    player.y = 0;
    player.yaw = car.yaw;
    player.root.visible = false;
  }

  game.driveCar = car;
  game.cameraYaw = shot.car.angle + (shot.camera.yaw || 0);
  game.mousePitch = shot.camera.pitch || -0.06;
  game.orbitBias = shot.camera.yaw || 0;
  game.cameraRig.configure(shot.onFoot ? 'foot' : 'car');
  game.cameraRig.desiredDistance = shot.camera.distance;
  game.cameraRig.desiredHeight = shot.camera.height;
  game.cameraRig.desiredShoulder = shot.onFoot ? 0.55 : 0;
  game.cameraRig.yaw = game.cameraYaw;
  game.cameraRig.pitch = game.mousePitch;
  game.cameraRig.initialised = false;
  game.cameraRig.update(1, shot.onFoot ? player : car, true);

  if (name === 'chase') {
    // Look back up the avenue: the player's car comes at the lens with the cruiser right behind.
    game.cameraYaw = car.yaw + Math.PI + 0.2;
    game.cameraRig.yaw = game.cameraYaw;
    game.cameraRig.desiredDistance = 12.5;
    game.cameraRig.desiredHeight = 3.05;
    game.cameraRig.desiredShoulder = 0;
    game.cameraRig.initialised = false;
    game.cameraRig.update(1, car, true);

    const cruiser = game.police.cruisers[0];
    if (cruiser) {
      cruiser.active = true;
      cruiser.root.visible = true;
      const back = 6.4;
      const side = -2.8;
      cruiser.place(
        car.x - Math.cos(car.yaw) * back + Math.sin(car.yaw) * side,
        car.z + Math.sin(car.yaw) * back + Math.cos(car.yaw) * side,
        car.yaw + 0.035,
      );
      cruiser.speed = 14;
      cruiser.flash = 1;
      cruiser.updateVisual(1 / 60);
    }
    // A second cruiser further back and offset, so the street reads as a pursuit.
    const extra = game.police.cruisers[1];
    if (extra) {
      extra.active = true;
      extra.root.visible = true;
      extra.place(
        car.x - Math.cos(car.yaw) * 30 - Math.sin(car.yaw) * 5.6,
        car.z + Math.sin(car.yaw) * 30 - Math.cos(car.yaw) * 5.6,
        car.yaw + 0.08,
      );
      extra.speed = 14;
      extra.flash = 0;
      extra.updateVisual(1 / 60);
    }
    game.police.stars = 3;
    game.police.rising = 0;
  }

  game.updateHud(0);
}
