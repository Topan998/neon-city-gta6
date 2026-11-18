// The police: a wanted level measured in stars and heat, cruisers that spawn off the edge of the
// screen and chase you through the grid, officers who pour out and shoot when you are on foot, and
// the siren that tells you how close they are. Heat falls once nobody has eyes on you.

import { WANTED, CRIME, CITY } from './config.js';
import { buildPersonGeometry } from './pedestrians.js';
import { mergeParts, box, makeModelMaterial } from './shape.js';

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

function angleDelta(from, to) {
  let diff = to - from;
  while (diff > Math.PI) diff -= Math.PI * 2;
  while (diff < -Math.PI) diff += Math.PI * 2;
  return diff;
}

export function createPolice(ctx) {
  const { scene, world, audio, effects, vehicles, player, hud, state } = ctx;
  const officerMaterial = makeModelMaterial();
  const officerGeometry = buildPersonGeometry({ shirt: 0x1e2a45, trousers: 0x141b29, skin: 0xc98d63, hair: 0x17120f });
  const units = [];
  const officers = [];
  const flashMaterialRed = new THREE.MeshBasicMaterial({ color: 0xff2b45, toneMapped: false });
  const flashMaterialBlue = new THREE.MeshBasicMaterial({ color: 0x2b6bff, toneMapped: false });

  let spawnTimer = 0;
  let sirenTimer = 0;
  let lastSeen = 0;
  let starsShown = 0;

  function starFor(heat) {
    let count = 0;
    for (let i = 1; i < WANTED.stars.length; i += 1) {
      if (heat >= WANTED.stars[i]) count = i;
    }
    return count;
  }

  /** A crime raises the heat; `report` is what every violent act in the game calls. */
  function report(amount) {
    state.heat = clamp(state.heat + amount, 0, 200);
    state.wanted = starFor(state.heat);
    lastSeen = state.time;
    if (state.wanted > starsShown) {
      starsShown = state.wanted;
      hud?.toast(state.wanted >= 3 ? `Wanted level ${state.wanted} — the whole precinct is out` : 'Police are on to you', 'bad');
    }
    audio.sirenBlip();
  }

  function setWanted(count) {
    state.wanted = clamp(count, 0, 5);
    state.heat = Math.max(state.heat, WANTED.stars[state.wanted] ?? 0);
    starsShown = Math.max(starsShown, state.wanted);
  }

  function clear() {
    for (const unit of units.slice()) removeUnit(unit);
    for (const officer of officers.slice()) removeOfficer(officer);
    for (const car of vehicles.cars.slice()) {
      if (car.kind === 'police') vehicles.removeCar(car);
    }
    state.heat = 0;
    state.wanted = 0;
    starsShown = 0;
    audio.sirenStop();
  }

  function removeUnit(unit) {
    const index = units.indexOf(unit);
    if (index !== -1) units.splice(index, 1);
    for (const officer of unit.officers) removeOfficer(officer);
    vehicles.removeCar(unit.car);
  }

  function removeOfficer(officer) {
    const index = officers.indexOf(officer);
    if (index !== -1) officers.splice(index, 1);
    scene.remove(officer.mesh);
  }

  function spawnUnit(at) {
    let x = 0;
    let z = 0;
    let heading = 0;
    if (at) {
      x = at.x;
      z = at.z;
      heading = at.heading ?? 0;
    } else {
      const angle = Math.random() * Math.PI * 2;
      const radius = 105 + Math.random() * 45;
      x = player.state.x + Math.cos(angle) * radius;
      z = player.state.z + Math.sin(angle) * radius;
      const road = world.nearestRoad(x, z);
      if (road.axis === 'x') x = road.line; else z = road.line;
      const limit = world.map.half - 4;
      x = clamp(x, -limit, limit);
      z = clamp(z, -limit, limit);
      heading = Math.atan2(player.state.x - x, player.state.z - z);
    }

    const car = vehicles.addCar({ x, z, heading, kind: 'police', driver: 'police', colour: 0xe9edf2 });
    car.mesh.rotation.y = heading;
    if (at?.speed) {
      car.vx = Math.sin(heading) * at.speed;
      car.vz = Math.cos(heading) * at.speed;
    }

    const red = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.16, 0.34), flashMaterialRed);
    red.position.set(0.4, 1.56, -0.2);
    const blue = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.16, 0.34), flashMaterialBlue);
    blue.position.set(-0.4, 1.56, -0.2);
    car.mesh.add(red);
    car.mesh.add(blue);

    units.push({
      car,
      officers: [],
      deployTimer: 0,
      deployed: false,
      stuck: 0,
      red,
      blue,
      flash: 0,
    });
  }

  function deployOfficers(unit) {
    unit.deployed = true;
    const offsets = [-1.6, 1.6];
    for (const offset of offsets) {
      const mesh = new THREE.Mesh(officerGeometry, officerMaterial);
      mesh.castShadow = true;
      scene.add(mesh);
      const officer = {
        mesh,
        x: unit.car.x + Math.cos(unit.car.heading) * offset,
        z: unit.car.z - Math.sin(unit.car.heading) * offset,
        heading: unit.car.heading,
        health: 60,
        alive: true,
        fireCooldown: 1.2 + Math.random(),
        walk: Math.random() * 6,
      };
      unit.officers.push(officer);
      officers.push(officer);
    }
  }

  function updateOfficers(dt) {
    for (const officer of officers) {
      if (!officer.alive) continue;
      const dx = player.state.x - officer.x;
      const dz = player.state.z - officer.z;
      const distance = Math.hypot(dx, dz);
      officer.heading = Math.atan2(dx, dz);
      officer.fireCooldown -= dt;
      officer.walk += dt * 6;

      if (distance > 13 && !player.state.car) {
        const speed = 3.6;
        const nx = officer.x + Math.sin(officer.heading) * speed * dt;
        const nz = officer.z + Math.cos(officer.heading) * speed * dt;
        const resolved = world.collideCircle(nx, nz, 0.4);
        officer.x = resolved.x;
        officer.z = resolved.z;
      }

      officer.mesh.position.set(officer.x, Math.abs(Math.sin(officer.walk)) * 0.04, officer.z);
      officer.mesh.rotation.y = officer.heading;

      if (distance < 34 && officer.fireCooldown <= 0 && state.mode === 'play') {
        officer.fireCooldown = 0.85 + Math.random() * 0.7;
        const hitChance = distance < 14 ? 0.72 : 0.4;
        effects.tracer(
          { x: officer.x, y: 1.3, z: officer.z },
          { x: player.state.x, y: player.state.car ? 0.9 : 1.2, z: player.state.z },
          0x9ec5ff,
        );
        audio.pistol();
        if (Math.random() < hitChance) player.takeDamage(7, state.time);
      }
    }
  }

  function updateCars(dt) {
    for (const unit of units) {
      const car = unit.car;
      const dx = player.state.x - car.x;
      const dz = player.state.z - car.z;
      const distance = Math.hypot(dx, dz);
      const want = Math.atan2(dx, dz);
      const diff = angleDelta(car.heading, want);

      let throttle = 1;
      let steer = clamp(diff * 2.1, -1, 1);
      if (distance < 7) throttle = 0.25;
      if (car.speed < 1.4) unit.stuck += dt;
      else unit.stuck = Math.max(0, unit.stuck - dt * 0.6);

      if (unit.stuck > 1.1) {
        throttle = -1;
        steer = -steer;
        if (unit.stuck > 2.4) unit.stuck = 0;
      }

      vehicles.step(car, dt, { throttle, steer, handbrake: false });

      // The cruiser is a battering ram: close enough and the player takes the hit.
      if (distance < 4.4 && car.speed > 5) {
        if (player.state.car) {
          player.state.car.vx += Math.sin(car.heading) * 6;
          player.state.car.vz += Math.cos(car.heading) * 6;
          player.takeDamage(3, state.time);
        } else if (!unit.hitRecently) {
          unit.hitRecently = true;
          unit.hitCooldown = 1.4;
          player.takeDamage(11, state.time);
          effects.sparks(player.state.x, 1, player.state.z, { x: 0, y: 1, z: 0 }, 6, 0xff8a8a);
        }
        effects.sparks(car.x, 1, car.z, { x: 0, y: 1, z: 0 }, 4);
      }
      if (unit.hitRecently) {
        unit.hitCooldown -= dt;
        if (unit.hitCooldown <= 0) unit.hitRecently = false;
      }

      // Lights flash twice a second.
      unit.flash += dt * 8;
      unit.red.visible = Math.sin(unit.flash) > 0;
      unit.blue.visible = Math.sin(unit.flash) <= 0;

      if (!unit.deployed && !player.state.car && distance < 26 && car.speed < 4) {
        unit.deployTimer += dt;
        if (unit.deployTimer > 1.1) deployOfficers(unit);
      }
    }
  }

  function update(dt) {
    const now = state.time;

    // Nobody has eyes on the player: the heat bleeds away.
    let closest = Infinity;
    for (const unit of units) {
      closest = Math.min(closest, Math.hypot(unit.car.x - player.state.x, unit.car.z - player.state.z));
    }
    for (const officer of officers) {
      closest = Math.min(closest, Math.hypot(officer.x - player.state.x, officer.z - player.state.z));
    }
    if (closest < 60) lastSeen = now;
    if (now - lastSeen > WANTED.decayDelay && state.heat > 0) {
      state.heat = Math.max(0, state.heat - WANTED.decay * dt);
      const nextStars = starFor(state.heat);
      if (nextStars < state.wanted) {
        state.wanted = nextStars;
        hud?.toast(nextStars === 0 ? 'You lost the cops' : `Wanted level down to ${nextStars}`);
      }
    }

    // Enough cruisers for the heat, spawned one at a time so they arrive like reinforcements.
    const wantedUnits = Math.min(state.wanted, WANTED.maxCars);
    spawnTimer -= dt;
    if (units.length < wantedUnits && spawnTimer <= 0) {
      spawnTimer = 2.6;
      spawnUnit();
      audio.sirenBlip();
    }
    if (units.length > wantedUnits + 1) {
      removeUnit(units[units.length - 1]);
    }
    if (state.wanted === 0 && units.length > 0 && closest > 90) {
      removeUnit(units[0]);
    }

    updateCars(dt);
    updateOfficers(dt);

    // The siren follows the nearest cruiser.
    sirenTimer -= dt;
    if (units.length > 0) {
      audio.sirenStart();
      audio.updateSiren(dt, closest);
    } else if (sirenTimer < 0) {
      audio.sirenStop();
      sirenTimer = 1;
    }
  }

  /** The nearest officer a ray crosses, for the player's pistol. */
  function raycast(origin, direction, maxDistance) {
    let best = null;
    let bestDistance = maxDistance;
    for (const officer of officers) {
      if (!officer.alive) continue;
      for (const height of [0.8, 1.55]) {
        const ox = officer.x - origin.x;
        const oy = height - origin.y;
        const oz = officer.z - origin.z;
        const along = ox * direction.x + oy * direction.y + oz * direction.z;
        if (along < 0.4 || along > bestDistance) continue;
        const cx = origin.x + direction.x * along;
        const cy = origin.y + direction.y * along;
        const cz = origin.z + direction.z * along;
        if (Math.hypot(cx - officer.x, cy - height, cz - officer.z) > 0.62) continue;
        best = { kind: 'officer', target: officer, distance: along };
        bestDistance = along;
      }
    }
    return best;
  }

  /** A pistol round lands: some officers go down, and the precinct remembers it. */
  function damageOfficer(officer, amount) {
    if (!officer.alive) return false;
    officer.health -= amount;
    effects.blood(officer.x, 1.2, officer.z);
    if (officer.health <= 0) {
      officer.alive = false;
      officer.mesh.rotation.z = Math.PI / 2;
      officer.mesh.position.y = 0.25;
      report(CRIME.copKilled);
      hud?.toast('Officer down — heat rising', 'bad');
      return true;
    }
    return false;
  }

  function damageCar(car, amount) {
    car.health -= amount;
    effects.sparks(car.x, 1, car.z, { x: 0, y: 1, z: 0 }, 5);
    if (car.health <= 0 && !car.wrecked) {
      car.wrecked = true;
      effects.explosion(car.x, 1, car.z);
      audio.explosion();
      const unit = units.find((entry) => entry.car === car);
      if (unit) removeUnit(unit);
      return true;
    }
    return false;
  }

  return {
    units,
    officers,
    update,
    report,
    setWanted,
    clear,
    raycast,
    damageOfficer,
    damageCar,
    /** Place a cruiser by hand: the screenshot scenes and anything scripted use this. */
    spawnAt: (x, z, heading, speed = 0) => spawnUnit({ x, z, heading, speed }),
    get starCount() { return state.wanted; },
  };
}
