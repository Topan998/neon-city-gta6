// Cars: one merged model per car, an arcade handling model that lets a rear-drive coupe slide, and
// the traffic that keeps the streets busy. Parked cars are there to be stolen; traffic cars drive
// the grid on their own, turning at intersections; the police and the player drive with the same
// physics, so a chase feels the same from either seat.
//
// The car you are driving carries a cone of light on the road and, after dark, two small blooms on
// its headlights, so the night street reads as a place with cars on it rather than a lit model.

import { CAR, TRAFFIC, PALETTE } from './config.js';
import { mergeParts, box, cylinder, makeModelMaterial } from './shape.js';
import { createRandom, range, pick, int } from './random.js';
import { glowTexture } from './effects.js';

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

/** The shape of a coupe: skirt, body, hood, glass, roof, four wheels and its lights. */
export function buildCarGeometry(colour) {
  const glass = 0x243544;
  const parts = [
    box(1.94, 0.24, 4.24, 0, 0.36, 0, 0x1b1d24),
    box(1.86, 0.54, 4.3, 0, 0.72, 0, colour),
    box(1.7, 0.22, 1.34, 0, 1.0, 1.32, colour),
    box(1.72, 0.2, 1.2, 0, 1.0, -1.46, colour),
    box(1.58, 0.52, 1.92, 0, 1.16, -0.12, glass),
    box(1.46, 0.12, 1.62, 0, 1.44, -0.18, colour),
    box(0.16, 0.16, 1.9, 0.86, 0.9, -0.12, 0x2a2c33),
    box(0.16, 0.16, 1.9, -0.86, 0.9, -0.12, 0x2a2c33),
    box(0.5, 0.15, 0.12, 0.58, 0.78, 2.16, 0xfff2cd),
    box(0.5, 0.15, 0.12, -0.58, 0.78, 2.16, 0xfff2cd),
    box(0.44, 0.13, 0.1, 0.6, 0.8, -2.16, 0xd83b46),
    box(0.44, 0.13, 0.1, -0.6, 0.8, -2.16, 0xd83b46),
  ];
  for (const sx of [-1, 1]) {
    for (const sz of [1, -1]) {
      parts.push(cylinder(0.37, 0.37, 0.28, 10, sx * 0.9, 0.38, sz * 1.4, 0x14151a, Math.PI / 2));
      parts.push(cylinder(0.19, 0.19, 0.3, 8, sx * 0.9, 0.38, sz * 1.4, 0x9aa1ad, Math.PI / 2));
    }
  }
  return mergeParts(parts);
}

/** The police cruiser: same chassis, black and white, with a light bar on the roof. */
export function buildPoliceGeometry() {
  const glass = 0x1a2733;
  const parts = [
    box(1.96, 0.24, 4.3, 0, 0.36, 0, 0x111319),
    box(1.88, 0.54, 4.36, 0, 0.72, 0, 0xe9edf2),
    box(1.9, 0.3, 1.4, 0, 0.72, 1.2, 0x131a2a),
    box(1.9, 0.3, 1.5, 0, 0.72, -1.3, 0x131a2a),
    box(1.6, 0.52, 1.94, 0, 1.16, -0.1, glass),
    box(1.5, 0.12, 1.6, 0, 1.44, -0.16, 0xe9edf2),
    box(0.5, 0.15, 0.12, 0.58, 0.78, 2.19, 0xfff2cd),
    box(0.5, 0.15, 0.12, -0.58, 0.78, 2.19, 0xfff2cd),
    box(0.44, 0.13, 0.1, 0.6, 0.8, -2.19, 0xd83b46),
    box(0.44, 0.13, 0.1, -0.6, 0.8, -2.19, 0xd83b46),
  ];
  for (const sx of [-1, 1]) {
    for (const sz of [1, -1]) {
      parts.push(cylinder(0.37, 0.37, 0.3, 10, sx * 0.9, 0.38, sz * 1.42, 0x121319, Math.PI / 2));
      parts.push(cylinder(0.19, 0.19, 0.32, 8, sx * 0.9, 0.38, sz * 1.42, 0x8f97a4, Math.PI / 2));
    }
  }
  return mergeParts(parts);
}

/** A soft cone of light on the road, drawn only for the car the player is driving, and only at night. */
let beamTexture = null;
function headlightTexture() {
  if (beamTexture) return beamTexture;
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 64;
  const g = canvas.getContext('2d');
  const gradient = g.createLinearGradient(0, 0, 0, 64);
  gradient.addColorStop(0, 'rgba(255, 244, 214, 0.85)');
  gradient.addColorStop(0.45, 'rgba(255, 236, 190, 0.35)');
  gradient.addColorStop(1, 'rgba(255, 230, 180, 0)');
  g.fillStyle = gradient;
  g.fillRect(0, 0, 64, 64);
  beamTexture = new THREE.CanvasTexture(canvas);
  return beamTexture;
}

/** A new car at (x, z) facing `heading`; the caller decides what drives it. */
export function makeCar(scene, material, geometry, options) {
  const mesh = new THREE.Mesh(geometry, material);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.position.set(options.x, 0, options.z);
  mesh.rotation.y = options.heading;
  scene.add(mesh);
  let beam = null;
  let headlights = null;
  let wash = null;
  let tail = null;
  if (options.driver === 'player') {
    beam = new THREE.Mesh(
      new THREE.PlaneGeometry(8, 16),
      new THREE.MeshBasicMaterial({
        map: headlightTexture(), transparent: true, opacity: 0, depthWrite: false,
        blending: THREE.AdditiveBlending, toneMapped: false,
      }),
    );
    beam.rotation.x = -Math.PI / 2;
    beam.position.set(0, 0.07, 9);
    mesh.add(beam);

    // A soft wash of light on the tarmac ahead, so the road in front of the car is never black.
    wash = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial({
        map: glowTexture(), color: 0xffe0a8, transparent: true, opacity: 0, depthWrite: false,
        blending: THREE.AdditiveBlending, toneMapped: false,
      }),
    );
    wash.rotation.x = -Math.PI / 2;
    wash.scale.set(7, 12, 1);
    wash.position.set(0, 0.075, 8.5);
    mesh.add(wash);

    // Two blooms over the headlights, lit only once the sky is dark.
    headlights = [];
    for (const sx of [-0.58, 0.58]) {
      const bloom = new THREE.Sprite(new THREE.SpriteMaterial({
        map: glowTexture(), color: 0xfff2cd, transparent: true, opacity: 0,
        blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false,
      }));
      bloom.position.set(sx, 0.8, 2.24);
      bloom.scale.set(1.9, 1.9, 1);
      mesh.add(bloom);
      headlights.push(bloom);
    }

    tail = [];
    for (const sx of [-0.6, 0.6]) {
      const glow = new THREE.Sprite(new THREE.SpriteMaterial({
        map: glowTexture(), color: 0xff3a2e, transparent: true, opacity: 0,
        blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false,
      }));
      glow.position.set(sx, 0.8, -2.2);
      glow.scale.set(1.7, 1.7, 1);
      mesh.add(glow);
      tail.push(glow);
    }
  }
  return {
    beam,
    headlights,
    wash,
    tail,
    mesh,
    x: options.x,
    z: options.z,
    heading: options.heading,
    vx: 0,
    vz: 0,
    speed: 0,
    driver: options.driver ?? 'none',
    kind: options.kind ?? 'coupe',
    colour: options.colour ?? 0xffffff,
    health: options.health ?? 100,
    wrecked: false,
    axis: options.axis ?? 'z',
    dir: options.dir ?? 1,
    line: options.line ?? options.z,
    along: options.along ?? options.x,
    lane: options.lane ?? 0,
    target: options.target ?? 0,
    tag: options.tag ?? null,
    boost: options.boost ?? 1,
  };
}

/**
 * Arcade physics for any car: engine, drag, lateral grip and the handbrake that breaks it loose.
 * `controls` is { throttle, steer, handbrake } with throttle and steer in -1..1.
 */
export function stepCar(car, dt, controls, world) {
  const throttle = controls.throttle ?? 0;
  const steer = controls.steer ?? 0;
  const handbrake = controls.handbrake ? 1 : 0;

  const fwdX = Math.sin(car.heading);
  const fwdZ = Math.cos(car.heading);
  let forward = car.vx * fwdX + car.vz * fwdZ;

  if (throttle > 0.01) {
    forward += CAR.accel * car.boost * throttle * dt * (1 - Math.max(0, forward) / (CAR.maxSpeed * car.boost));
  } else if (throttle < -0.01) {
    if (forward > 1) forward -= CAR.brake * dt;
    else forward += CAR.accel * 0.55 * throttle * dt;
  }
  forward -= forward * CAR.drag * dt;
  forward = clamp(forward, -CAR.reverse, CAR.maxSpeed * car.boost);

  // Steering turns more at speed, and reverses when the car is driven backwards.
  const bite = Math.min(1, Math.abs(forward) / 7);
  car.heading += steer * CAR.turn * dt * bite * (forward < -0.5 ? -1 : 1);

  // Rebuild the velocity: the old one keeps its forward part and loses its sideways part to grip.
  const nfx = Math.sin(car.heading);
  const nfz = Math.cos(car.heading);
  const lateralX = car.vx - nfx * (car.vx * nfx + car.vz * nfz);
  const lateralZ = car.vz - nfz * (car.vx * nfx + car.vz * nfz);
  const grip = handbrake ? CAR.driftGrip : CAR.grip;
  const keep = Math.max(0, 1 - grip * dt);
  car.vx = nfx * forward + lateralX * keep;
  car.vz = nfz * forward + lateralZ * keep;

  let nx = car.x + car.vx * dt;
  let nz = car.z + car.vz * dt;

  const resolved = world.collideCircle(nx, nz, CAR.radius);
  if (resolved.hit) {
    car.vx *= -0.22;
    car.vz *= -0.22;
    car.health -= Math.hypot(car.vx, car.vz) * 0.4 + 2;
    nx = resolved.x;
    nz = resolved.z;
  }

  car.x = nx;
  car.z = nz;
  car.speed = Math.hypot(car.vx, car.vz);
  car.mesh.position.set(car.x, 0, car.z);
  car.mesh.rotation.y = car.heading;
  return resolved.hit;
}

/** Where a car's nose is, for shots, ramming and bullet checks. */
export function carNose(car) {
  return { x: car.x + Math.sin(car.heading) * 2.2, z: car.z + Math.cos(car.heading) * 2.2 };
}

export function createVehicleSystem(ctx) {
  const { scene, world } = ctx;
  const random = createRandom(9173);
  const material = makeModelMaterial();
  const policeMaterial = makeModelMaterial();
  const cars = [];
  const geometryCache = new Map();

  function geometryFor(kind, colour) {
    const key = `${kind}-${colour}`;
    if (!geometryCache.has(key)) {
      geometryCache.set(key, kind === 'police' ? buildPoliceGeometry() : buildCarGeometry(colour));
    }
    return geometryCache.get(key);
  }

  function addCar(options) {
    const car = makeCar(scene, material, geometryFor(options.kind ?? 'coupe', options.colour ?? 0xffffff), options);
    cars.push(car);
    return car;
  }

  function removeCar(car) {
    const index = cars.indexOf(car);
    if (index !== -1) cars.splice(index, 1);
    scene.remove(car.mesh);
  }

  /** Parked cars along the kerb, and the traffic that already owns the road. */
  function populate() {
    for (let n = 0; n < 26; n += 1) {
      const alongX = random() < 0.5;
      const k = int(random, 0, 8);
      const lane = 5.1 * (random() < 0.5 ? -1 : 1);
      const along = range(random, -250, 250);
      const line = k * 70 - 280;
      const x = alongX ? along : line + lane;
      const z = alongX ? line + lane : along;
      const heading = alongX ? (random() < 0.5 ? Math.PI / 2 : -Math.PI / 2) : (random() < 0.5 ? 0 : Math.PI);
      addCar({
        x, z, heading,
        colour: pick(random, PALETTE.car),
        driver: 'none',
        kind: 'coupe',
      });
    }

    for (let n = 0; n < TRAFFIC.count; n += 1) {
      const axis = random() < 0.5 ? 'x' : 'z';
      const line = int(random, 0, 8) * 70 - 280;
      const dir = random() < 0.5 ? 1 : -1;
      const along = range(random, -240, 240);
      const lane = dir * TRAFFIC.lane;
      addCar({
        x: axis === 'x' ? along : line + lane,
        z: axis === 'x' ? line + lane : along,
        heading: axis === 'x' ? (dir > 0 ? Math.PI / 2 : -Math.PI / 2) : (dir > 0 ? 0 : Math.PI),
        colour: pick(random, PALETTE.car),
        driver: 'traffic',
        axis, dir, line, along, lane,
        boost: 0.8 + random() * 0.3,
      });
    }
  }

  /** Traffic turns at intersections and keeps its lane; parked cars just sit. */
  function updateTraffic(dt) {
    for (const car of cars) {
      if (car.driver !== 'traffic' || car.wrecked) continue;
      const step = car.dir * (TRAFFIC.speed + (car.boost - 0.9) * 8) * dt;
      car.along += step;

      // At an intersection, sometimes take the turn.
      const nextLine = Math.round((car.along + 280) / 70) * 70 - 280;
      if (Math.abs(car.along - nextLine) < 3.2 && car.turning !== nextLine) {
        car.turning = nextLine;
        if (random() < 0.42) {
          const newAxis = car.axis === 'x' ? 'z' : 'x';
          const newDir = random() < 0.5 ? 1 : -1;
          car.along = newAxis === 'x' ? car.x : car.z;
          car.axis = newAxis;
          car.dir = newDir;
          car.line = nextLine;
          car.lane = newDir * TRAFFIC.lane;
        }
      }

      const limit = 276;
      if (car.along > limit) { car.dir = -1; car.lane = -car.lane; }
      if (car.along < -limit) { car.dir = 1; car.lane = -car.lane; }

      const x = car.axis === 'x' ? car.along : car.line + car.lane;
      const z = car.axis === 'x' ? car.line + car.lane : car.along;
      car.x = x;
      car.z = z;
      const wanted = car.axis === 'x' ? (car.dir > 0 ? Math.PI / 2 : -Math.PI / 2) : (car.dir > 0 ? 0 : Math.PI);
      car.heading = wanted;
      car.speed = Math.abs(step / Math.max(dt, 1e-4));
      car.vx = Math.sin(car.heading) * car.speed;
      car.vz = Math.cos(car.heading) * car.speed;
      car.mesh.position.set(x, 0, z);
      car.mesh.rotation.y = car.heading;
    }
  }

  /** The nearest car a bullet crosses, for the pistol. */
  function raycastCars(origin, direction, maxDistance) {
    let best = null;
    let bestDistance = maxDistance;
    for (const car of cars) {
      if (car.wrecked) continue;
      const ox = car.x - origin.x;
      const oz = car.z - origin.z;
      const along = ox * direction.x + oz * direction.z;
      if (along < 0.6 || along > bestDistance) continue;
      const cx = origin.x + direction.x * along;
      const cz = origin.z + direction.z * along;
      if (Math.hypot(cx - car.x, cz - car.z) > 1.8) continue;
      best = { kind: 'car', target: car, distance: along };
      bestDistance = along;
    }
    return best;
  }

  /** The nearest car to a point, for the F key and for police target picking. */
  function nearest(x, z, maxDistance) {
    let best = null;
    let bestDistance = maxDistance;
    for (const car of cars) {
      if (car.wrecked) continue;
      const distance = Math.hypot(car.x - x, car.z - z);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = car;
      }
    }
    return best;
  }

  function update(dt) {
    updateTraffic(dt);
    const night = world.timeOfDay;
    for (const car of cars) {
      if (car.beam) car.beam.material.opacity = night * 0.3;
      if (car.wash) car.wash.material.opacity = night * 0.32;
      if (car.headlights) {
        const glowOpacity = night * 0.85;
        car.headlights[0].material.opacity = glowOpacity;
        car.headlights[1].material.opacity = glowOpacity;
      }
      if (car.tail) {
        const tailOpacity = night * 0.7;
        car.tail[0].material.opacity = tailOpacity;
        car.tail[1].material.opacity = tailOpacity;
      }
    }
  }

  populate();

  return {
    cars,
    addCar,
    removeCar,
    nearest,
    raycastCars,
    update,
    material,
    geometryFor,
    step: (car, dt, controls) => stepCar(car, dt, controls, world),
  };
}
