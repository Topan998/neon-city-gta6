// Three jobs and the story that ties them: steal a show car for a fence, wipe out the crew that
// burned your brother, then outrun the precinct to the marina. Each one has a marker on the street,
// an objective on the HUD, a timer where it matters and a payout that saves to the browser.

import { MISSIONS, CRIME } from './config.js';
import { roadLine } from './world.js';
import { buildPersonGeometry } from './pedestrians.js';
import { makeModelMaterial } from './shape.js';

const DEFINITIONS = [
  {
    id: 'salt-run',
    index: 0,
    title: 'Salt Run',
    brief: 'Rico wants the gold Cobalt GT from the pier and a clean drop at the locks.',
    reward: MISSIONS.rewards[0],
    start: { x: roadLine(2), z: roadLine(3) },
    target: { x: roadLine(6), z: roadLine(6) },
    colour: 0xffd166,
  },
  {
    id: 'cobalt-sweep',
    index: 1,
    title: 'Cobalt Sweep',
    brief: 'The Cobalt Kings hang out on Delmar. Take all five of them off the street.',
    reward: MISSIONS.rewards[1],
    start: { x: roadLine(4), z: roadLine(1) },
    target: { x: roadLine(4), z: roadLine(1) },
    colour: 0xff5f7e,
  },
  {
    id: 'three-star-exit',
    index: 2,
    title: 'Three Star Exit',
    brief: 'Rattle the precinct, then lose them and reach the marina before the net closes.',
    reward: MISSIONS.rewards[2],
    start: { x: roadLine(1), z: roadLine(5) },
    target: { x: roadLine(7), z: roadLine(2) },
    colour: 0x5ef2c8,
  },
];

export function createMissions(ctx) {
  const { scene, world, vehicles, player, police, hud, audio, effects, state } = ctx;
  const crewMaterial = makeModelMaterial();
  const crewGeometry = buildPersonGeometry({ shirt: 0x8d2436, trousers: 0x1f222c, skin: 0xc98d63, hair: 0x120f0d });

  const markers = [];
  const crew = [];
  let active = null;
  let timer = 0;
  let goldCar = null;
  let crewLeft = 0;
  let shownTitle = '';
  let shownDetail = '';

  function makeMarker(x, z, colour, label, kind) {
    const group = new THREE.Group();
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(3.6, 0.16, 8, 42),
      new THREE.MeshBasicMaterial({ color: colour, transparent: true, opacity: 0.9, toneMapped: false }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.35;
    group.add(ring);
    const beam = new THREE.Mesh(
      new THREE.CylinderGeometry(3.1, 3.1, 42, 20, 1, true),
      new THREE.MeshBasicMaterial({
        color: colour, transparent: true, opacity: 0.3, side: THREE.DoubleSide,
        depthWrite: false, toneMapped: false, blending: THREE.AdditiveBlending,
      }),
    );
    beam.position.y = 21;
    group.add(beam);
    const core = new THREE.Mesh(
      new THREE.CylinderGeometry(1.1, 1.1, 42, 12, 1, true),
      new THREE.MeshBasicMaterial({
        color: colour, transparent: true, opacity: 0.5, side: THREE.DoubleSide,
        depthWrite: false, toneMapped: false, blending: THREE.AdditiveBlending,
      }),
    );
    core.position.y = 21;
    group.add(core);
    group.position.set(x, 0, z);
    group.visible = false;
    scene.add(group);
    const marker = { x, z, colour, label, kind, group, ring, beam, active: false };
    markers.push(marker);
    return marker;
  }

  const startMarkers = DEFINITIONS.map((definition) =>
    makeMarker(definition.start.x, definition.start.z, definition.colour, definition.title, 'start'),
  );
  const targetMarkers = DEFINITIONS.map((definition) =>
    makeMarker(definition.target.x, definition.target.z, definition.colour, definition.title, 'target'),
  );

  /** Refresh which markers the world shows: one per unfinished job, plus the live objective. */
  function refreshMarkers() {
    for (const marker of markers) marker.group.visible = false;
    DEFINITIONS.forEach((definition, index) => {
      if (state.completed.includes(definition.id)) return;
      if (active && active.id === definition.id) {
        targetMarkers[index].group.visible = true;
      } else if (!active) {
        startMarkers[index].group.visible = true;
      }
    });
  }

  function setObjective(title, detail) {
    shownTitle = title;
    shownDetail = detail;
    hud?.setObjective(title, detail);
  }

  function playerPosition() {
    return player.state.car
      ? { x: player.state.car.x, z: player.state.car.z }
      : { x: player.state.x, z: player.state.z };
  }

  function spawnCrew(def) {
    for (let n = 0; n < MISSIONS.crewCount; n += 1) {
      const angle = (n / MISSIONS.crewCount) * Math.PI * 2 + 0.4;
      const x = def.start.x + Math.cos(angle) * 9;
      const z = def.start.z + Math.sin(angle) * 9;
      const mesh = new THREE.Mesh(crewGeometry, crewMaterial);
      mesh.castShadow = true;
      mesh.position.set(x, 0, z);
      scene.add(mesh);
      crew.push({
        mesh,
        x,
        z,
        heading: angle,
        health: 60,
        alive: true,
        fireCooldown: 0.8 + Math.random() * 0.8,
        walk: Math.random() * 6,
      });
    }
    crewLeft = crew.length;
  }

  function clearCrew() {
    for (const member of crew) scene.remove(member.mesh);
    crew.length = 0;
    crewLeft = 0;
  }

  /** The show car sits on the pier until somebody takes it. */
  function spawnGoldCar(definition) {
    if (goldCar) vehicles.removeCar(goldCar);
    goldCar = vehicles.addCar({
      x: definition.start.x + 5,
      z: definition.start.z + 4.5,
      heading: Math.PI / 2,
      colour: 0xd9b45a,
      driver: 'none',
      kind: 'coupe',
      boost: 1.22,
    });
    goldCar.tag = 'salt-car';
  }

  function begin(definition) {
    active = definition;
    timer = 0;
    audio.unlock();
    refreshMarkers();

    if (definition.id === 'salt-run') {
      spawnGoldCar(definition);
      setObjective('Salt Run', 'Steal the gold Cobalt GT and drive it to the locks.');
    } else if (definition.id === 'cobalt-sweep') {
      spawnCrew(definition);
      setObjective('Cobalt Sweep', 'Wipe out the Cobalt Kings — 5 left.');
    } else if (definition.id === 'three-star-exit') {
      police.setWanted(3);
      setObjective('Three Star Exit', 'Lose the heat and reach the marina hideout.');
    }
    hud?.toast(`${definition.title} — $${definition.reward}`, 'good');
  }

  function complete(definition) {
    active = null;
    timer = 0;
    if (!state.completed.includes(definition.id)) state.completed.push(definition.id);
    state.money += definition.reward;
    state.jobs = state.completed.length;
    audio.cash();
    hud?.toast(`${definition.title} complete · +$${definition.reward}`, 'good');
    hud?.setObjective('', '');
    clearCrew();
    if (goldCar) {
      goldCar.tag = null;
      goldCar = null;
    }
    refreshMarkers();
    ctx.onMissionDone?.(definition);
    if (state.completed.length === DEFINITIONS.length) {
      setTimeout(() => hud?.toast('All three jobs done — the city is yours', 'good'), 1800);
    }
  }

  function fail(reason) {
    active = null;
    timer = 0;
    hud?.toast(reason, 'bad');
    hud?.setObjective('', '');
    clearCrew();
    refreshMarkers();
  }

  function updateCrew(dt) {
    for (const member of crew) {
      if (!member.alive) continue;
      const dx = player.state.x - member.x;
      const dz = player.state.z - member.z;
      const distance = Math.hypot(dx, dz);
      member.heading = Math.atan2(dx, dz);
      member.fireCooldown -= dt;
      member.walk += dt * 7;

      if (distance > 15 && distance < 70) {
        const step = 3.4 * dt;
        const nx = member.x + Math.sin(member.heading) * step;
        const nz = member.z + Math.cos(member.heading) * step;
        const resolved = world.collideCircle(nx, nz, 0.4);
        member.x = resolved.x;
        member.z = resolved.z;
      }
      member.mesh.position.set(member.x, Math.abs(Math.sin(member.walk)) * 0.04, member.z);
      member.mesh.rotation.y = member.heading;

      if (distance < 34 && member.fireCooldown <= 0 && state.mode === 'play' && player.state.alive) {
        member.fireCooldown = 1 + Math.random() * 0.8;
        effects.tracer({ x: member.x, y: 1.3, z: member.z }, { x: player.state.x, y: 1.2, z: player.state.z }, 0xff9a9a);
        audio.pistol();
        if (Math.random() < (distance < 14 ? 0.62 : 0.32)) player.takeDamage(9, state.time);
      }
    }
  }

  function update(dt) {
    for (const marker of markers) {
      marker.ring.rotation.z += dt * 0.9;
      const pulse = 0.75 + Math.sin(state.time * 2.4) * 0.2;
      marker.ring.material.opacity = pulse;
    }

    const position = playerPosition();

    if (!active) {
      DEFINITIONS.forEach((definition, index) => {
        if (state.completed.includes(definition.id)) return;
        const marker = startMarkers[index];
        if (!marker.group.visible) return;
        if (Math.hypot(position.x - marker.x, position.z - marker.z) < 5) begin(definition);
      });
      return;
    }

    timer += dt;

    if (active.id === 'salt-run') {
      const inGold = player.state.car === goldCar;
      if (inGold) {
        const message = 'Drive the Cobalt GT to the locks.';
        if (shownDetail !== message) setObjective('Salt Run', message);
      } else if (shownDetail !== 'Steal the gold Cobalt GT and drive it to the locks.') {
        setObjective('Salt Run', 'Steal the gold Cobalt GT and drive it to the locks.');
      }
      const target = active.target;
      if (inGold && Math.hypot(position.x - target.x, position.z - target.z) < 7) {
        complete(active);
        return;
      }
      const limit = MISSIONS.deliveryTime;
      hud?.setTimer(`DELIVERY ${Math.max(0, Math.ceil(limit - timer))}s`);
      if (timer > limit) fail('Too slow — the buyer walked away');
    } else if (active.id === 'cobalt-sweep') {
      updateCrew(dt);
      const left = crew.filter((member) => member.alive).length;
      crewLeft = left;
      hud?.setTimer(left > 0 ? `KINGS LEFT ${left}` : '');
      if (shownDetail !== `Wipe out the Cobalt Kings — ${left} left.` && left > 0) {
        setObjective('Cobalt Sweep', `Wipe out the Cobalt Kings — ${left} left.`);
      }
      if (left === 0) complete(active);
    } else if (active.id === 'three-star-exit') {
      const remaining = 90 - timer;
      hud?.setTimer(`HEAT ON · ${Math.max(0, Math.ceil(remaining))}s`);
      const target = active.target;
      if (Math.hypot(position.x - target.x, position.z - target.z) < 8) {
        complete(active);
        return;
      }
      if (remaining <= 0) fail('The net closed — try again');
    }
  }

  /** The player's pistol finds a gang member. */
  function raycastCrew(origin, direction, maxDistance) {
    let best = null;
    let bestDistance = maxDistance;
    for (const member of crew) {
      if (!member.alive) continue;
      for (const height of [0.8, 1.5]) {
        const ox = member.x - origin.x;
        const oy = height - origin.y;
        const oz = member.z - origin.z;
        const along = ox * direction.x + oy * direction.y + oz * direction.z;
        if (along < 0.4 || along > bestDistance) continue;
        const cx = origin.x + direction.x * along;
        const cy = origin.y + direction.y * along;
        const cz = origin.z + direction.z * along;
        if (Math.hypot(cx - member.x, cy - height, cz - member.z) > 0.62) continue;
        best = { kind: 'crew', target: member, distance: along };
        bestDistance = along;
      }
    }
    return best;
  }

  function damageCrew(member, amount) {
    if (!member.alive) return false;
    member.health -= amount;
    effects.blood(member.x, 1.2, member.z);
    if (member.health <= 0) {
      member.alive = false;
      member.mesh.rotation.z = Math.PI / 2;
      member.mesh.position.y = 0.25;
      audio.cash();
      hud?.toast('King down · +$120', 'good');
      state.money += 120;
      return true;
    }
    return false;
  }

  function reset() {
    clearCrew();
    if (goldCar) {
      goldCar.tag = null;
      goldCar = null;
    }
    active = null;
    timer = 0;
    refreshMarkers();
  }

  /** The screenshot scenes place a job by hand: same markers, same objective, no walking there. */
  function stage(id) {
    const definition = DEFINITIONS.find((entry) => entry.id === id);
    if (!definition) return;
    active = definition;
    timer = 12;
    refreshMarkers();
    if (id === 'cobalt-sweep') spawnCrew(definition);
    if (id === 'salt-run') spawnGoldCar(definition);
    setObjective(definition.title, definition.brief);
  }

  refreshMarkers();

  return {
    markers,
    crew,
    update,
    raycastCrew,
    damageCrew,
    reset,
    stage,
    refreshMarkers,
    get active() { return active; },
    get crewLeft() { return crewLeft; },
    definitions: DEFINITIONS,
  };
}
