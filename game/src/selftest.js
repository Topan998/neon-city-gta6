// A headless smoke test of the systems, run by `?selftest=1`: it drives the same functions the
// player does — walk, take a car, drive, fire, raise the heat — for a few simulated seconds each and
// writes a JSON report into #status, so a browser run without a human can prove the game works.

export function runSelfTest(api) {
  const report = { steps: 0, errors: [] };
  const { player, vehicles, police, missions, pedestrians, state, input, world } = api;
  const step = (n) => {
    for (let i = 0; i < n; i += 1) {
      api.step(1 / 60);
      report.steps += 1;
    }
  };

  try {
    api.startGame();
    report.mode = state.mode;

    // Walking: hold W for a second and see the player move.
    const startX = player.state.x;
    const startZ = player.state.z;
    input.setKey('KeyW', true);
    step(60);
    input.setKey('KeyW', false);
    report.walked = Math.hypot(player.state.x - startX, player.state.z - startZ) > 1.5;

    // Getting in a car: stand next to one, press F, check the seat.
    const car = vehicles.cars.find((entry) => entry.driver === 'none' && entry.kind === 'coupe');
    player.state.x = car.x + 1.6;
    player.state.z = car.z + 1.6;
    api.toggleCar();
    report.enteredCar = player.state.car === car;

    // Driving: throttle for two seconds.
    input.setKey('KeyW', true);
    step(120);
    input.setKey('KeyW', false);
    report.speed = Math.round(car.speed * 10) / 10;
    report.drove = car.speed > 4;

    // Steering swings the car's heading.
    const heading0 = car.heading;
    input.setKey('KeyW', true);
    input.setKey('KeyD', true);
    step(45);
    input.setKey('KeyD', false);
    input.setKey('KeyW', false);
    report.steered = Math.abs(car.heading - heading0) > 0.05;

    // Out of the car, shoot at a pedestrian and watch the heat rise.
    api.toggleCar();
    step(5);
    const ped = pedestrians.peds.find((entry) => entry.alive);
    player.state.x = ped.x;
    player.state.z = ped.z + 8;
    player.state.yaw = Math.PI;
    player.cameraYaw = Math.PI;
    player.pitch = 0;
    player.snapCamera();
    step(2);
    const heatBefore = state.heat;
    for (let i = 0; i < 3; i += 1) {
      api.player.camera.position.set(ped.x, 1.4, ped.z + 6);
      api.player.camera.lookAt(ped.x, 1.1, ped.z);
      api.player.shoot(input, state.time);
      step(12);
    }
    report.heatRose = state.heat > heatBefore;
    report.wanted = state.wanted;

    // Police respond to the heat.
    step(240);
    report.policeUnits = police.units.length > 0;
    report.officers = police.officers.length;

    // A job can be staged and its marker shown.
    missions.stage('cobalt-sweep');
    step(30);
    report.missionCrew = missions.crew.length;
    report.objectiveShown = document.getElementById('objective').classList.contains('show');

    report.ground = world.groundHeight(0, 0) >= 0;
    report.ok = report.walked && report.enteredCar && report.drove && report.steered && report.heatRose;
  } catch (error) {
    report.errors.push(String(error && error.stack ? error.stack : error));
    report.ok = false;
  }

  document.getElementById('status').textContent = `SELFTEST ${JSON.stringify(report)}`;
  return report;
}
