// hud.js — everything drawn on top of the game: the money ticker, the job line, the wanted stars,
// the condition bar, the speedometer, the minimap canvas, the dialogue and objective banners, the
// context hint, the pause menu and the title screen.
//
// The markup is built here rather than sitting in index.html, so the page stays a canvas and this
// file owns the whole overlay. Styling lives in index.html.

const THREE = window.THREE;

import { CITY, PLAYER, WANTED } from './config.js';
import { clamp, lerp, damp, smoothstep } from './util.js';
import { LINES } from './world.js';

const el = (tag, id, className) => {
  const node = document.createElement(tag);
  if (id) node.id = id;
  if (className) node.className = className;
  return node;
};

export class Hud {
  constructor(game) {
    this.game = game;
    this.root = el('div', 'hud');
    document.body.appendChild(this.root);

    // ---- money, job, stars ----
    const cash = el('div', 'cash', 'panel');
    cash.innerHTML = `
      <div class="label">Cash</div>
      <div class="value"><span class="dollars">$0</span><span class="cents">.00</span></div>
      <div class="job">No job — look for a marker</div>`;
    this.root.appendChild(cash);
    this.cashDollars = cash.querySelector('.dollars');
    this.cashJob = cash.querySelector('.job');
    this.displayMoney = game.money ?? 0;

    const stars = el('div', 'stars');
    for (let i = 0; i < 5; i += 1) {
      const s = el('span', null, null);
      s.textContent = '★';
      stars.appendChild(s);
    }
    this.root.appendChild(stars);
    this.starNodes = [...stars.children];
    this.starPulse = 0;

    // ---- condition ----
    const cond = el('div', 'condition', 'panel');
    cond.innerHTML = `
      <div class="row"><span class="cond-label">Condition</span><span class="cond-num">100%</span></div>
      <div class="bar"><i></i></div>`;
    this.root.appendChild(cond);
    this.condLabel = cond.querySelector('.cond-label');
    this.condNum = cond.querySelector('.cond-num');
    this.condBar = cond.querySelector('.bar');
    this.condFill = cond.querySelector('.bar i');

    // ---- speedometer ----
    const speedo = el('div', 'speedo', 'panel');
    speedo.innerHTML = `<div class="kmh"><span class="num">0</span><small>KM/H</small></div>
      <div class="gear">GEAR <b>N</b></div>`;
    this.root.appendChild(speedo);
    this.speedNum = speedo.querySelector('.num');
    this.speedoNode = speedo;
    this.gearNode = speedo.querySelector('.gear b');

    // ---- minimap ----
    const mapWrap = el('div', 'minimap-wrap', 'panel');
    const canvas = el('canvas', 'minimap');
    canvas.width = 352;
    canvas.height = 352;
    mapWrap.appendChild(canvas);
    const ring = el('div', null, 'ring');
    mapWrap.appendChild(ring);
    const compass = el('div', null, 'compass');
    compass.textContent = 'N';
    mapWrap.appendChild(compass);
    this.root.appendChild(mapWrap);
    this.map = canvas;
    this.mapCtx = canvas.getContext('2d');

    // ---- banners ----
    const banner = el('div', 'banner');
    banner.innerHTML = `<div class="who"></div><br><div class="say"></div>`;
    this.root.appendChild(banner);
    this.banner = banner;
    this.bannerWho = banner.querySelector('.who');
    this.bannerSay = banner.querySelector('.say');
    this.bannerQueue = [];
    this.bannerTimer = 0;

    const objective = el('div', 'objective');
    objective.innerHTML = `<span class="dot"></span><span class="text"></span><span class="clock"></span>`;
    this.root.appendChild(objective);
    this.objective = objective;
    this.objectiveText = objective.querySelector('.text');
    this.objectiveClock = objective.querySelector('.clock');

    const toast = el('div', 'toast');
    this.root.appendChild(toast);
    this.toastNode = toast;
    this.toastTimer = 0;

    const hint = el('div', 'hint');
    this.root.appendChild(hint);
    this.hintNode = hint;

    this.starsCount = 0;
    this.damageFlash = 0;
    this.jobText = 'NO JOB — LOOK FOR A MARKER';
    this.nextJob = null;

    this.buildTitle();
    this.buildPause();
  }

  // -------------------------------------------------------------------------------------------
  // Screens
  // -------------------------------------------------------------------------------------------

  buildTitle() {
    const start = el('div', 'start');
    start.innerHTML = `
      <h1>Neon City</h1>
      <div class="sub">Saltwater Vice</div>
      <div class="keys">
        <div><span>Walk / drive</span><b>W A S D</b></div>
        <div><span>Look · fire</span><b>MOUSE</b></div>
        <div><span>Sprint · boost</span><b>SHIFT</b></div>
        <div><span>Handbrake</span><b>SPACE</b></div>
        <div><span>Get in / pull out</span><b>E</b></div>
        <div><span>Get out</span><b>F</b></div>
        <div><span>Reload</span><b>R</b></div>
        <div><span>Pause · mute</span><b>ESC · M</b></div>
      </div>
      <div class="play">Click to take the city</div>`;
    document.body.appendChild(start);
    this.startScreen = start;
  }

  buildPause() {
    const pause = el('div', 'pause', 'hidden');
    pause.innerHTML = `<h2>Paused</h2>
      <div class="row">Click to go back</div>
      <div class="row">M · <b>mute</b> &nbsp; F5 · <b>restart</b></div>`;
    document.body.appendChild(pause);
    this.pauseScreen = pause;
  }

  showStart(show) {
    this.startScreen.classList.toggle('hidden', !show);
  }

  showPause(show) {
    this.pauseScreen.classList.toggle('hidden', !show);
    this.root.classList.toggle('hidden', show);
  }

  // -------------------------------------------------------------------------------------------
  // Text bits
  // -------------------------------------------------------------------------------------------

  /** A banner line: the speaker's name plate plus what they said. Lines queue up. */
  say(lines) {
    if (!lines) return;
    const list = Array.isArray(lines) ? lines : [lines];
    for (const line of list) {
      this.bannerQueue.push({
        who: (line.who ?? '').toUpperCase(),
        colour: line.colour ?? '#31e6ff',
        text: line.text ?? '',
      });
    }
    if (this.bannerTimer <= 0) this.nextLine();
  }

  nextLine() {
    const line = this.bannerQueue.shift();
    if (!line) {
      this.banner.classList.remove('show');
      this.bannerTimer = 0;
      return;
    }
    this.bannerWho.textContent = line.who;
    this.bannerWho.style.background = line.colour ?? '#31e6ff';
    this.bannerSay.textContent = line.text;
    this.banner.classList.add('show');
    this.bannerTimer = clamp(1.6 + line.text.length * 0.032, 1.8, 5.2);
  }

  toast(text) {
    this.toastNode.textContent = text;
    this.toastNode.classList.add('show');
    this.toastTimer = 2.2;
  }

  setObjective(label, time = 0) {
    if (!label) {
      this.objective.classList.remove('show');
      return;
    }
    this.objectiveText.textContent = label;
    this.objective.classList.add('show');
    this.objectiveClock.textContent = time > 0 ? this.clock(time) : '';
  }

  setJob(label) {
    this.jobText = label;
    this.cashJob.textContent = label;
  }

  setNextJob(id) {
    this.nextJob = id;
  }

  pulseStars() {
    this.starPulse = 1;
  }

  flashDamage() {
    this.damageFlash = 1;
  }

  clock(seconds) {
    const s = Math.max(0, Math.ceil(seconds));
    const m = Math.floor(s / 60);
    const r = s % 60;
    return `${m}:${r.toString().padStart(2, '0')}`;
  }

  // -------------------------------------------------------------------------------------------
  // Per-frame
  // -------------------------------------------------------------------------------------------

  update(dt) {
    const game = this.game;
    const player = game.player;
    const car = player?.inCar;

    // money ticker: counts towards the real total instead of snapping
    this.displayMoney = damp(this.displayMoney, game.money, 8, dt);
    if (Math.abs(this.displayMoney - game.money) < 0.6) this.displayMoney = game.money;
    this.cashDollars.textContent = `$${Math.round(this.displayMoney).toLocaleString('en-US')}`;

    // stars
    const stars = game.police?.stars ?? 0;
    if (stars !== this.starsCount) {
      this.starsCount = stars;
      this.starPulse = 1;
    }
    this.starPulse = Math.max(0, this.starPulse - dt * 1.4);
    for (let i = 0; i < this.starNodes.length; i += 1) {
      const lit = i < stars;
      this.starNodes[i].classList.toggle('lit', lit);
      this.starNodes[i].style.transform = lit ? `scale(${1.06 + this.starPulse * 0.12})` : 'scale(1)';
    }

    // condition: the car's when driving, the man's on foot
    const health = car ? car.health : player?.health ?? 100;
    const pct = clamp(health / 100, 0, 1);
    this.condFill.style.width = `${pct * 100}%`;
    this.condBar.classList.toggle('low', pct < 0.4);
    this.condLabel.textContent = car ? 'Car condition' : 'Vitals';
    this.condNum.textContent = `${Math.round(pct * 100)}%`;

    // speedometer and gear: only while driving
    this.speedoNode.style.opacity = car ? '1' : '0';
    const kph = car ? Math.abs(car.speedKph) : 0;
    this.speedNum.textContent = Math.round(kph);
    let gear = 'N';
    if (car) {
      if (car.speed < -0.6) gear = 'R';
      else if (kph < 1) gear = 'N';
      else if (kph < 26) gear = '1';
      else if (kph < 52) gear = '2';
      else if (kph < 84) gear = '3';
      else if (kph < 118) gear = '4';
      else gear = '5';
    }
    this.gearNode.textContent = gear;

    // banners
    if (this.bannerTimer > 0) {
      this.bannerTimer -= dt;
      if (this.bannerTimer <= 0) this.nextLine();
    }
    if (this.toastTimer > 0) {
      this.toastTimer -= dt;
      if (this.toastTimer <= 0) this.toastNode.classList.remove('show');
    }

    // context hint
    this.updateHint(car);

    this.drawMinimap();
  }

  /** The two or three keys that matter for what you are doing right now. */
  updateHint(car) {
    const game = this.game;
    let text;
    if (game.paused) text = '';
    else if (car) text = '<b>F</b> exit &nbsp; <b>SPACE</b> handbrake &nbsp; <b>SHIFT</b> boost';
    else if (game.nearestCar && game.nearestCar.dist < 4.6) text = '<b>E</b> enter car &nbsp; <b>LMB</b> fire &nbsp; <b>R</b> reload';
    else text = '<b>W A S D</b> walk &nbsp; <b>SHIFT</b> run &nbsp; <b>LMB</b> fire &nbsp; <b>E</b> enter car';
    if (this.hintNode.dataset.text !== text) {
      this.hintNode.innerHTML = text;
      this.hintNode.dataset.text = text;
    }
  }

  /**
   * Minimap: the street grid in world space, rotated with the camera? No — north-up, with the
   * player as an arrow, police as flashing dots, the objective as a diamond and activities as
   * small squares.
   */
  drawMinimap() {
    const ctx = this.mapCtx;
    const size = this.map.width;
    const half = size / 2;
    const game = this.game;
    const player = game.player;
    if (!player) return;
    const focus = player.inCar ? player.inCar.pos : player.pos;
    const range = 132;                      // metres from edge to edge
    const scale = size / range;
    const heading = player.inCar ? player.inCar.heading : player.heading;
    // the map turns with the player: it is easier to read a street you are driving down
    const rot = -heading;

    ctx.save();
    ctx.clearRect(0, 0, size, size);
    ctx.fillStyle = '#0b1016';
    ctx.fillRect(0, 0, size, size);
    ctx.translate(half, half);
    ctx.rotate(rot);
    ctx.scale(scale, scale);
    ctx.translate(-focus.x, -focus.z);

    // blocks
    ctx.fillStyle = '#1b222b';
    const block = CITY.blockW;
    for (let i = 0; i < CITY.blocks; i += 1) {
      for (let j = 0; j < CITY.blocks; j += 1) {
        const cx = -CITY.half + CITY.pitch * (i + 0.5);
        const cz = -CITY.half + CITY.pitch * (j + 0.5);
        ctx.fillRect(cx - block / 2, cz - block / 2, block, block);
      }
    }
    // roads as slightly lighter lines
    ctx.strokeStyle = '#2e3a47';
    ctx.lineWidth = CITY.roadW;
    for (const line of LINES) {
      ctx.beginPath();
      ctx.moveTo(line, -CITY.half);
      ctx.lineTo(line, CITY.half);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(-CITY.half, line);
      ctx.lineTo(CITY.half, line);
      ctx.stroke();
    }
    // beach
    ctx.fillStyle = '#2f2a22';
    ctx.fillRect(-CITY.half, CITY.beachZ - 10, CITY.half * 2, 90);

    // the objective
    const wp = game.missions?.waypoint;
    if (wp) {
      ctx.save();
      ctx.translate(wp.x, wp.z);
      ctx.rotate(-rot);
      ctx.fillStyle = wp.job ? '#ffd45e' : '#ff3d81';
      ctx.beginPath();
      ctx.moveTo(0, -7);
      ctx.lineTo(7, 0);
      ctx.lineTo(0, 7);
      ctx.lineTo(-7, 0);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }

    // activities
    for (const blip of game.activities?.blips ?? []) {
      ctx.save();
      ctx.translate(blip.x, blip.z);
      ctx.rotate(-rot);
      ctx.fillStyle = blip.colour;
      ctx.globalAlpha = 0.9;
      ctx.fillRect(-3.5, -3.5, 7, 7);
      ctx.restore();
    }

    // police
    for (const c of game.police?.cruisers ?? []) {
      const blink = Math.sin(game.time * 12 + c.car.pos.x) > 0;
      ctx.fillStyle = blink ? '#ff2233' : '#2b6bff';
      ctx.beginPath();
      ctx.arc(c.car.pos.x, c.car.pos.z, 4.4, 0, Math.PI * 2);
      ctx.fill();
    }

    // the player: an arrow at the centre, always pointing up
    ctx.save();
    ctx.translate(focus.x, focus.z);
    ctx.rotate(-rot);
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.moveTo(0, -8);
    ctx.lineTo(6, 7);
    ctx.lineTo(0, 4);
    ctx.lineTo(-6, 7);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
    ctx.restore();

    // vignette and border
    const grd = ctx.createRadialGradient(half, half, size * 0.2, half, half, size * 0.5);
    grd.addColorStop(0, 'rgba(0,0,0,0)');
    grd.addColorStop(1, 'rgba(0,0,0,0.55)');
    ctx.fillStyle = grd;
    ctx.fillRect(0, 0, size, size);

    if (this.damageFlash > 0) {
      this.damageFlash = Math.max(0, this.damageFlash - 0.03);
      ctx.fillStyle = `rgba(180,20,20,${this.damageFlash * 0.18})`;
      ctx.fillRect(0, 0, size, size);
    }
  }
}
