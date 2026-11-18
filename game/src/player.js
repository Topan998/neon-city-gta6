// The player on foot and the camera that follows: a man in a white tee and mint sneakers, walking
// with WASD relative to wherever the mouse is looking, sprinting with shift, firing a hitscan
// pistol and climbing into any car with F. The camera is over the right shoulder and pulls in
// when a building gets between it and the player.
//
// The body is rigged rather than posed: the torso, both arms and both legs are separate meshes
// hanging off hip and shoulder pivots. `walkPhase` is advanced by the distance travelled, so the
// legs swing in step with the ground at any speed, the cadence tightens into a run, the shoulders
// counter-swing, the torso bobs and leans, and the heading eases toward the input instead of
// snapping. `setRig` lets a staged screenshot move the camera closer to the ground.

import { CAMERA, PLAYER, CAR } from './config.js';
import { mergeParts, box, ball, makeModelMaterial } from './shape.js';
import { createBlobShadow } from './effects.js';

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const TAU = Math.PI * 2;

export function createPlayer(ctx) {
  const { scene, world, audio, effects } = ctx;
  const material = makeModelMaterial();
  const skin = 0xd9a273;
  const shirt = 0xf4f4f2;
  const trousers = 0x2f3b52;

  const group = new THREE.Group();

  // The upper body: torso, collar, head and hair. The arms are separate so they can swing.
  const torso = new THREE.Group();
  const torsoMesh = new THREE.Mesh(
    mergeParts([
      box(0.5, 0.66, 0.28, 0, 1.09, 0, shirt),
      box(0.42, 0.2, 0.3, 0, 1.32, 0, 0x5ef2c8),
      ball(0.155, 0, 1.56, 0, skin, 10),
      box(0.31, 0.12, 0.31, 0, 1.68, 0, 0x241a14),
    ]),
    material,
  );
  torsoMesh.castShadow = true;
  torso.add(torsoMesh);

  // One arm, hanging from the shoulder pivot at the origin, with the pistol in the right hand.
  function buildArm(withPistol) {
    const parts = [box(0.13, 0.56, 0.15, 0, -0.28, 0, skin)];
    if (withPistol) {
      parts.push(box(0.16, 0.13, 0.16, 0, -0.52, 0.02, skin));
      parts.push(box(0.08, 0.12, 0.3, 0, -0.53, 0.2, 0x1c1f26));
    }
    const mesh = new THREE.Mesh(mergeParts(parts), material);
    mesh.castShadow = true;
    return mesh;
  }

  const armLeft = buildArm(false);
  armLeft.position.set(-0.33, 1.3, 0);
  const armRight = buildArm(true);
  armRight.position.set(0.33, 1.3, 0);
  torso.add(armLeft);
  torso.add(armRight);
  group.add(torso);

  // A leg, hanging from the hip pivot, with a mint sneaker on the end.
  const legGeometry = mergeParts([
    box(0.17, 0.76, 0.2, 0, -0.38, 0, trousers),
    box(0.18, 0.12, 0.3, 0, -0.76, 0.04, 0x5ef2c8),
  ]);
  const legLeft = new THREE.Mesh(legGeometry, material);
  legLeft.position.set(-0.12, 0.78, 0);
  legLeft.castShadow = true;
  group.add(legLeft);
  const legRight = new THREE.Mesh(legGeometry, material);
  legRight.position.set(0.12, 0.78, 0);
  legRight.castShadow = true;
  group.add(legRight);

  const muzzleLight = new THREE.PointLight(0xffcf8a, 0, 7, 2);
  scene.add(muzzleLight);
  scene.add(group);
  const shadow = createBlobShadow(scene, 1.5);

  const camera = new THREE.PerspectiveCamera(CAMERA.fov, window.innerWidth / window.innerHeight, 0.4, 1600);
  const camPosition = new THREE.Vector3(0, 6, 12);
  const lookTarget = new THREE.Vector3();
  const forward = new THREE.Vector3();

  const state = {
    x: 0,
    z: 0,
    yaw: 0,
    vx: 0,
    vz: 0,
    speed: 0,
    health: PLAYER.health,
    alive: true,
    // Distance-driven gait: one full stride per PLAYER.stride metres, radians in `walkPhase`.
    walkPhase: 0,
    walkBlend: 0,
    fireCooldown: 0,
    recoil: 0,
    car: null,
    yawOffset: 0,
    lastHurt: 0,
  };

  let cameraYaw = 0;
  let cameraPitch = -0.1;
  let initialized = false;
  // The camera rig the shots tune: closer and lower for the cover photograph.
  const rig = { distance: CAMERA.distance, shoulder: CAMERA.shoulder, lift: 0.15 };

  function spawn(x, z, yaw = 0) {
    state.x = x;
    state.z = z;
    state.yaw = yaw;
    cameraYaw = yaw;
    state.vx = 0;
    state.vz = 0;
    state.speed = 0;
    state.health = PLAYER.health;
    state.alive = true;
    state.car = null;
    state.walkBlend = 0;
    group.visible = true;
    group.position.set(x, 0, z);
    group.rotation.y = yaw;
    initialized = false;
  }

  /** The gait: swing the limbs from `walkPhase`, bob the torso, lean into the run, ease the turn. */
  function animate(dt, sprinting) {
    const speed = state.speed;
    const moving = speed > 0.25;
    const stride = sprinting || speed > PLAYER.walk + 0.4 ? PLAYER.runStride : PLAYER.stride;
    if (moving) state.walkPhase += (speed * dt * TAU) / stride;
    // Ease the whole cycle in and out so stopping settles the limbs instead of freezing mid-stride.
    state.walkBlend += ((moving ? 1 : 0) - state.walkBlend) * Math.min(1, 8 * dt);
    const drive = state.walkBlend;
    const swing = Math.sin(state.walkPhase) * drive * (PLAYER.swing + (sprinting ? 0.16 : 0));
    const counter = Math.sin(state.walkPhase) * drive * PLAYER.armSwing;

    legLeft.rotation.x = swing;
    legRight.rotation.x = -swing;
    armLeft.rotation.x = -counter;
    armRight.rotation.x = counter;

    // The body rides a little higher twice per stride and tips forward as the pace picks up.
    const pace = clamp(speed / PLAYER.sprint, 0, 1);
    torso.position.y = Math.abs(Math.sin(state.walkPhase)) * PLAYER.bob * drive;
    torso.rotation.x = -PLAYER.lean * pace * drive;
    torso.rotation.z = Math.sin(state.walkPhase) * 0.022 * drive;
  }

  /** Move on foot, relative to the camera, with a sprint and a shove out of the buildings. */
  function walk(dt, input) {
    const f = input.forward();
    const s = input.strafe();
    const sprint = input.sprint();
    const speed = sprint ? PLAYER.sprint : PLAYER.walk;
    const fwdX = Math.sin(cameraYaw);
    const fwdZ = Math.cos(cameraYaw);
    const rightX = Math.cos(cameraYaw);
    const rightZ = -Math.sin(cameraYaw);
    let wishX = fwdX * f + rightX * s;
    let wishZ = fwdZ * f + rightZ * s;
    const wishLength = Math.hypot(wishX, wishZ);
    if (wishLength > 0.001) {
      wishX /= wishLength;
      wishZ /= wishLength;
    }
    state.vx += (wishX * speed - state.vx) * Math.min(1, PLAYER.accel * dt * 0.22);
    state.vz += (wishZ * speed - state.vz) * Math.min(1, PLAYER.accel * dt * 0.22);
    if (wishLength < 0.001) {
      state.vx *= Math.max(0, 1 - 9 * dt);
      state.vz *= Math.max(0, 1 - 9 * dt);
    }

    const nx = state.x + state.vx * dt;
    const nz = state.z + state.vz * dt;
    const resolved = world.collideCircle(nx, nz, PLAYER.radius);
    state.x = resolved.x;
    state.z = resolved.z;
    state.speed = Math.hypot(state.vx, state.vz);

    // Turn toward the wish direction, faster the quicker the body is moving, never in one frame.
    if (wishLength > 0.01) {
      const want = Math.atan2(wishX, wishZ);
      let diff = want - state.yaw;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      const rate = PLAYER.turnRate + state.speed * 0.6;
      state.yaw += diff * Math.min(1, rate * dt);
    }

    const groundY = world.groundHeight(state.x, state.z);
    group.position.set(state.x, groundY, state.z);
    group.rotation.y = state.yaw;
    animate(dt, sprint);
    shadow.position.set(state.x, groundY + 0.03, state.z);
    shadow.visible = true;
  }

  /** Health creeps back after a few quiet seconds; the HUD reads this. */
  function heal(dt, now) {
    if (!state.alive) return;
    if (now - state.lastHurt > PLAYER.regenDelay && state.health < PLAYER.health) {
      state.health = Math.min(PLAYER.health, state.health + PLAYER.regen * dt);
    }
  }

  function takeDamage(amount, now) {
    if (!state.alive) return;
    state.health -= amount;
    state.lastHurt = now;
    ctx.hud?.flashDamage();
    audio.hurt();
    if (state.health <= 0) {
      state.health = 0;
      state.alive = false;
    }
  }

  /** Fire the pistol: a ray from the camera, the nearest of crew, crowd, police, cars or wall. */
  function shoot(input, now) {
    if (!state.alive || state.car) return false;
    if (state.fireCooldown > 0) return false;
    state.fireCooldown = 0.17;
    state.recoil = 1;
    audio.pistol();

    camera.getWorldDirection(forward);
    const origin = camera.position.clone().add(forward.clone().multiplyScalar(0.6));
    const maxDistance = 140;
    const wallDistance = world.rayDistance(origin, forward, maxDistance);

    let hit = ctx.missions?.raycastCrew(origin, forward, wallDistance) ?? null;
    if (!hit) hit = ctx.police?.raycast(origin, forward, wallDistance) ?? null;
    if (!hit) hit = ctx.pedestrians?.raycast(origin, forward, wallDistance) ?? null;
    if (!hit) hit = ctx.vehicles?.raycastCars?.(origin, forward, wallDistance) ?? null;

    const distance = hit ? hit.distance : wallDistance;
    const point = {
      x: origin.x + forward.x * distance,
      y: origin.y + forward.y * distance,
      z: origin.z + forward.z * distance,
    };
    effects.tracer(origin, point, 0xffe9a8);
    muzzleLight.position.set(origin.x, origin.y, origin.z);
    muzzleLight.intensity = 3.4;
    ctx.onShot?.(origin, hit, point);
    return true;
  }

  /**
   * The camera: an over-the-shoulder rig on foot, a chase rig behind the car, both pulled in when a
   * wall is in the way and both smoothed so the frame never snaps.
   */
  function updateCamera(dt, input) {
    const look = input.takeLook();
    if (state.car) {
      state.yawOffset -= look.x * CAMERA.mouse;
      state.yawOffset = clamp(state.yawOffset, -1.5, 1.5);
      state.yawOffset *= Math.max(0, 1 - dt * 3.2);
      cameraPitch = clamp(cameraPitch - look.y * CAMERA.mouse * 0.5, CAMERA.pitchMin, CAMERA.pitchMax);
      cameraYaw = state.car.heading + state.yawOffset;
    } else {
      cameraYaw -= look.x * CAMERA.mouse * 1.35;
      cameraPitch = clamp(cameraPitch - look.y * CAMERA.mouse, CAMERA.pitchMin, CAMERA.pitchMax);
    }

    const standY = world.groundHeight(state.x, state.z);
    const focus = state.car
      ? { x: state.car.x, y: 1.45, z: state.car.z }
      : { x: state.x, y: standY + PLAYER.eye + rig.lift, z: state.z };
    const distance = state.car ? CAMERA.carDistance : rig.distance;
    const pitch = state.car ? clamp(cameraPitch * 0.5 + CAMERA.carPitch, -0.9, 0.4) : cameraPitch;

    const cosPitch = Math.cos(pitch);
    const dirX = Math.sin(cameraYaw) * cosPitch;
    const dirY = Math.sin(pitch);
    const dirZ = Math.cos(cameraYaw) * cosPitch;
    const rightX = Math.cos(cameraYaw);
    const rightZ = -Math.sin(cameraYaw);
    const shoulder = state.car ? 0 : rig.shoulder;

    const wanted = new THREE.Vector3(
      focus.x - dirX * distance + rightX * shoulder,
      focus.y - dirY * distance + (state.car ? 0 : 0.35),
      focus.z - dirZ * distance + rightZ * shoulder,
    );

    // Pull the camera in front of any wall between it and the player.
    const toCamera = { x: wanted.x - focus.x, y: wanted.y - focus.y, z: wanted.z - focus.z };
    const length = Math.hypot(toCamera.x, toCamera.y, toCamera.z) || 1;
    const normal = { x: toCamera.x / length, y: toCamera.y / length, z: toCamera.z / length };
    const wall = world.rayDistance({ x: focus.x, y: focus.y, z: focus.z }, normal, length + 0.4);
    if (wall < length) {
      const safe = Math.max(1.1, wall - 0.5);
      wanted.set(focus.x + normal.x * safe, focus.y + normal.y * safe, focus.z + normal.z * safe);
    }

    if (!initialized) {
      camPosition.copy(wanted);
      initialized = true;
    } else {
      camPosition.lerp(wanted, 1 - Math.exp(-11 * dt));
    }
    camera.position.copy(camPosition);
    lookTarget.set(focus.x + dirX * CAMERA.lookAhead, focus.y + dirY * 2.4, focus.z + dirZ * CAMERA.lookAhead);
    camera.lookAt(lookTarget);

    if (state.car) {
      group.visible = false;
      shadow.visible = false;
    }
  }

  function update(dt, input, now) {
    state.fireCooldown = Math.max(0, state.fireCooldown - dt);
    state.recoil = Math.max(0, state.recoil - dt * 6);
    muzzleLight.intensity *= Math.max(0, 1 - dt * 18);
    if (!state.car) walk(dt, input);
    heal(dt, now);
    if (state.car) {
      group.visible = false;
      shadow.visible = false;
    }
  }

  return {
    state,
    group,
    camera,
    spawn,
    update,
    updateCamera,
    shoot,
    takeDamage,
    walk,
    /** Drop the camera where it belongs right now, after a teleport or a staged scene. */
    snapCamera() { initialized = false; },
    /** Let a screenshot set the camera closer to the ground, or put it back. */
    setRig(options) {
      if (!options) {
        rig.distance = CAMERA.distance;
        rig.shoulder = CAMERA.shoulder;
        rig.lift = 0.15;
        return;
      }
      if (options.distance !== undefined) rig.distance = options.distance;
      if (options.shoulder !== undefined) rig.shoulder = options.shoulder;
      if (options.lift !== undefined) rig.lift = options.lift;
    },
    get walking() { return state.walkPhase; },
    get cameraYaw() { return cameraYaw; },
    set cameraYaw(value) { cameraYaw = value; },
    get pitch() { return cameraPitch; },
    set pitch(value) { cameraPitch = value; },
  };
}
