// The heads-up display and the screens around it: cash, jobs, wanted stars, condition, speed,
// objective, toasts, the start / pause / wasted screens, and the minimap — a canvas that draws the
// street grid, the blocks, the player's arrow, the police and every live marker each frame.
//
// Two things here are alive rather than printed: the cash counts up or down to its new value over a
// third of a second instead of snapping, and a wanted star that has just been earned makes the whole
// row pulse red until the siren settles.

import { HALF, CITY, BLOCK_HALF } from './config.js';

export function createHud() {
  const byId = (id) => document.getElementById(id);
  const moneyEl = byId('money');
  const jobsEl = byId('job-count');
  const wantedEl = byId('wanted');
  const starEls = Array.from(wantedEl.querySelectorAll('i'));
  const objectiveEl = byId('objective');
  const objTitleEl = byId('obj-title');
  const objDetailEl = byId('obj-detail');
  const objTimerEl = byId('obj-timer');
  const healthFill = byId('health-fill');
  const speedoEl = byId('speedo');
  const speedEl = byId('speed');
  const gearEl = byId('gear');
  const toastsEl = byId('toasts');
  const menuEl = byId('menu');
  const pauseEl = byId('pause');
  const wastedEl = byId('wasted');
  const saveNoteEl = byId('save-note');
  const vignetteEl = byId('vignette');
  const minimap = byId('minimap');
  const mapContext = minimap.getContext('2d');
  const body = document.body;

  let lastMoney = -1;
  let moneyShown = 0;
  let moneyTarget = 0;
  let moneyTicking = false;
  let moneyLast = 0;
  let lastJobs = -1;
  let lastStars = -1;
  let lastHealth = -1;
  let riseTimer = 0;
  let toastCount = 0;

  function paintMoney(value) {
    moneyEl.textContent = `$${Math.round(value).toLocaleString('en-US')}`;
  }

  /** The ticker: ease the displayed amount toward the real one, a frame at a time. */
  function tickMoney(now) {
    const dt = Math.min(0.06, Math.max(0.008, (now - moneyLast) / 1000 || 0.016));
    moneyLast = now;
    const gap = moneyTarget - moneyShown;
    if (Math.abs(gap) < 1) {
      moneyShown = moneyTarget;
      paintMoney(moneyShown);
      moneyTicking = false;
      return;
    }
    moneyShown += gap * Math.min(1, dt * 9) + Math.sign(gap) * 3;
    paintMoney(moneyShown);
    requestAnimationFrame(tickMoney);
  }

  function setMoney(value, instant = false) {
    const rounded = Math.round(value);
    if (rounded === lastMoney && !instant) return;
    lastMoney = rounded;
    moneyTarget = rounded;
    if (instant || moneyShown === 0) {
      moneyShown = rounded;
      paintMoney(moneyShown);
      moneyTicking = false;
      return;
    }
    paintMoney(moneyShown);
    if (!moneyTicking) {
      moneyTicking = true;
      moneyLast = performance.now();
      requestAnimationFrame(tickMoney);
    }
  }

  function setJobs(value) {
    if (value === lastJobs) return;
    lastJobs = value;
    jobsEl.textContent = `${value} / 3`;
  }

  function setWanted(stars) {
    if (stars === lastStars) return;
    const rose = stars > lastStars && lastStars >= 0;
    lastStars = stars;
    starEls.forEach((star, index) => star.classList.toggle('on', index < stars));
    wantedEl.classList.toggle('hot', stars >= 3);
    if (rose) pulseWanted();
  }

  /** A new star was earned: make the row flash until the moment passes. */
  function pulseWanted() {
    wantedEl.classList.add('rising');
    clearTimeout(riseTimer);
    riseTimer = setTimeout(() => wantedEl.classList.remove('rising'), 1300);
  }

  function setHealth(value) {
    const rounded = Math.round(value);
    if (rounded === lastHealth) return;
    lastHealth = rounded;
    healthFill.style.width = `${Math.max(0, Math.min(100, rounded))}%`;
    healthFill.classList.toggle('low', rounded < 35);
  }

  function setObjective(title, detail) {
    if (!title) {
      objectiveEl.classList.remove('show');
      return;
    }
    objectiveEl.classList.add('show');
    objTitleEl.textContent = title;
    objDetailEl.textContent = detail ?? '';
  }

  function setTimer(text) {
    objTimerEl.textContent = text ?? '';
  }

  function toast(message, kind = '') {
    const node = document.createElement('div');
    node.className = `toast ${kind}`;
    node.textContent = message;
    toastsEl.appendChild(node);
    toastCount += 1;
    requestAnimationFrame(() => node.classList.add('show'));
    setTimeout(() => {
      node.classList.remove('show');
      setTimeout(() => node.remove(), 400);
    }, 3200);
    while (toastsEl.children.length > 4) toastsEl.firstChild.remove();
  }

  function flashDamage() {
    vignetteEl.classList.add('hit');
    setTimeout(() => vignetteEl.classList.remove('hit'), 140);
  }

  function setSpeed(kmh, driving) {
    speedoEl.classList.toggle('show', driving);
    if (!driving) return;
    speedEl.textContent = String(Math.round(kmh));
    gearEl.textContent = 'D';
  }

  let hintText = '';
  /** The line under the condition bar follows the seat you are in. */
  function setHint(text) {
    if (text === hintText) return;
    hintText = text;
    byId('hint').textContent = text;
  }

  function showMenu(visible) {
    menuEl.classList.toggle('hidden', !visible);
    body.classList.toggle('playing', !visible);
  }

  function showPause(visible) {
    pauseEl.classList.toggle('hidden', !visible);
  }

  function showWasted(visible) {
    wastedEl.classList.toggle('hidden', !visible);
  }

  function setPlaying(value) {
    body.classList.toggle('playing', value);
  }

  function setArmed(value) {
    body.classList.toggle('armed', value);
  }

  function setSaveNote(text) {
    saveNoteEl.textContent = text;
  }

  /** The minimap: the grid, the blocks, then the player arrow and every live blip over it. */
  function drawMap(view) {
    const width = minimap.width;
    const centre = width / 2;
    const span = 300;
    const scale = width / span;
    const focusX = view.x;
    const focusZ = view.z;
    const toX = (x) => (x - focusX) * scale + centre;
    const toY = (z) => (z - focusZ) * scale + centre;

    mapContext.clearRect(0, 0, width, width);
    mapContext.fillStyle = '#38404e';
    mapContext.fillRect(0, 0, width, width);

    const blockSize = (CITY.cell - CITY.road) * scale;
    mapContext.fillStyle = '#131d2c';
    for (let j = 0; j < CITY.grid; j += 1) {
      for (let i = 0; i < CITY.grid; i += 1) {
        const left = i * CITY.cell - HALF + CITY.road / 2;
        const top = j * CITY.cell - HALF + CITY.road / 2;
        mapContext.fillRect(toX(left), toY(top), blockSize, blockSize);
      }
    }

    // The sea on the east edge, so the map reads the same way the world does.
    mapContext.fillStyle = '#20465e';
    mapContext.fillRect(toX(HALF + CITY.road / 2), 0, width, width);

    // Mission markers.
    for (const marker of view.markers ?? []) {
      if (!marker.group.visible) continue;
      const x = toX(marker.x);
      const y = toY(marker.z);
      mapContext.save();
      mapContext.translate(x, y);
      mapContext.rotate(Math.PI / 4);
      mapContext.fillStyle = `#${marker.colour.toString(16).padStart(6, '0')}`;
      mapContext.fillRect(-7, -7, 14, 14);
      mapContext.restore();
    }

    // Traffic and police.
    for (const car of view.cars ?? []) {
      if (car.kind === 'police') continue;
      mapContext.fillStyle = 'rgba(220, 230, 240, 0.45)';
      mapContext.fillRect(toX(car.x) - 2, toY(car.z) - 2, 4, 4);
    }
    for (const car of view.cars ?? []) {
      if (car.kind !== 'police') continue;
      mapContext.fillStyle = '#ff3d5d';
      mapContext.beginPath();
      mapContext.arc(toX(car.x), toY(car.z), 5, 0, Math.PI * 2);
      mapContext.fill();
    }
    for (const officer of view.officers ?? []) {
      if (!officer.alive) continue;
      mapContext.fillStyle = '#ff8fa3';
      mapContext.fillRect(toX(officer.x) - 2.5, toY(officer.z) - 2.5, 5, 5);
    }
    for (const member of view.crew ?? []) {
      if (!member.alive) continue;
      mapContext.fillStyle = '#ff5f7e';
      mapContext.beginPath();
      mapContext.arc(toX(member.x), toY(member.z), 4, 0, Math.PI * 2);
      mapContext.fill();
    }

    // The player: a triangle pointed the way the player or the car faces.
    mapContext.save();
    mapContext.translate(centre, centre);
    mapContext.rotate(-view.heading + Math.PI);
    mapContext.fillStyle = '#5ef2c8';
    mapContext.beginPath();
    mapContext.moveTo(0, -11);
    mapContext.lineTo(8, 8);
    mapContext.lineTo(0, 4);
    mapContext.lineTo(-8, 8);
    mapContext.closePath();
    mapContext.fill();
    mapContext.restore();

    // A ring at the edge of the map, so the frame reads as a device, not a hole.
    mapContext.strokeStyle = 'rgba(94, 242, 200, 0.35)';
    mapContext.lineWidth = 3;
    mapContext.strokeRect(1.5, 1.5, width - 3, width - 3);
  }

  return {
    setMoney,
    setJobs,
    setWanted,
    pulseWanted,
    setHealth,
    setObjective,
    setTimer,
    toast,
    flashDamage,
    setSpeed,
    setHint,
    showMenu,
    showPause,
    showWasted,
    setPlaying,
    setArmed,
    setSaveNote,
    drawMap,
  };
}
