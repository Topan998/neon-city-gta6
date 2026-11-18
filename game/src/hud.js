// hud.js — the interface, drawn with DOM and two small canvases.
//
// Money, jobs, condition, stars, the minimap, the speedometer, message banners, the waypoint arrow,
// the pause menu and the start screen. Everything is created once; update() only writes text, classes
// and canvas pixels, so no DOM is built while the game runs.

import { CITY, HUD as HUDSET, PALETTE } from './config.js';
import { clamp, lerp } from './util.js';

const STYLE = `
#hud, #hud * { box-sizing: border-box; }
#hud {
  position: fixed; inset: 0; pointer-events: none; z-index: 10;
  font-family: "Helvetica Neue", Helvetica, Arial, sans-serif;
  font-variant-numeric: tabular-nums;
  color: #eef1f4; user-select: none;
}
#hud .panel {
  position: absolute; background: rgba(8,11,16,0.55);
  border: 1px solid rgba(255,255,255,0.12);
  border-radius: 10px; backdrop-filter: blur(6px);
  box-shadow: 0 10px 30px rgba(0,0,0,0.35);
}
#hud .money {
  top: 22px; right: 24px; padding: 10px 16px 9px;
  font-size: 26px; font-weight: 800; letter-spacing: 0.5px;
  color: #8ff0b4; text-shadow: 0 0 18px rgba(80,255,150,0.35);
}
#hud .money small { display:block; font-size: 10px; letter-spacing: 2.4px; color:#8fa0ae; font-weight:600; margin-top:2px; }
#hud .jobs {
  top: 22px; right: 24px; margin-top: 76px; padding: 7px 14px;
  font-size: 12px; letter-spacing: 2.2px; font-weight: 700; color: #cfd8e2;
}
#hud .stars {
  left: 50%; top: 20px; transform: translateX(-50%);
  padding: 6px 14px; display: flex; gap: 6px; align-items:center;
  font-size: 20px; color: #3b4450;
}
#hud .stars .on { color: #ffd34d; text-shadow: 0 0 16px rgba(255,200,60,0.55); }
#hud .stars .pulse { animation: hudPulse 0.45s ease-in-out infinite alternate; }
@keyframes hudPulse { from { opacity: 0.55; transform: scale(0.94); } to { opacity: 1; transform: scale(1.08); } }
#hud .objective {
  left: 50%; top: 66px; transform: translateX(-50%);
  padding: 8px 20px; text-align: center; min-width: 320px;
}
#hud .objective .label { font-size: 11px; letter-spacing: 3px; color: #93a3b3; font-weight: 700; }
#hud .objective .line { font-size: 15px; font-weight: 700; letter-spacing: 1.2px; margin-top: 3px; color: #f3f6f9; }
#hud .objective .timer { font-size: 13px; letter-spacing: 2px; margin-top: 3px; color: #ffd34d; font-weight: 700; }
#hud .minimap-wrap { left: 24px; bottom: 24px; padding: 8px; border-radius: 12px; }
#hud canvas.minimap { display: block; width: 168px; height: 168px; border-radius: 8px; }
#hud .condition {
  left: 24px; bottom: 218px; width: 184px; padding: 8px 10px 10px;
}
#hud .condition .label { font-size: 10px; letter-spacing: 2.4px; color:#93a3b3; font-weight:700; display:flex; justify-content:space-between; }
#hud .condition .track { margin-top: 6px; height: 8px; border-radius: 4px; background: rgba(255,255,255,0.12); overflow: hidden; }
#hud .condition .fill { height: 100%; width: 100%; background: linear-gradient(90deg,#4ce08a,#9bf0b6); transition: width 0.12s linear; }
#hud .condition .fill.low { background: linear-gradient(90deg,#e85c46,#ff9b7a); }
#hud .speedo-wrap { right: 24px; bottom: 24px; padding: 6px; border-radius: 14px; }
#hud canvas.speedo { display: block; width: 156px; height: 156px; }
#hud .banner {
  left: 50%; top: 46%; transform: translate(-50%,-50%);
  padding: 14px 34px; font-size: 21px; letter-spacing: 2.5px; font-weight: 800;
  background: rgba(8,11,16,0.72); border: 1px solid rgba(255,255,255,0.16);
  border-radius: 12px; text-align: center; opacity: 0; transition: opacity 0.25s ease;
  text-shadow: 0 0 22px rgba(120,200,255,0.35); max-width: 68vw;
}
#hud .banner.show { opacity: 1; }
#hud .banner.job { color: #ffd76a; border-color: rgba(255,200,80,0.5); }
#hud .banner.good { color: #8ff0b4; border-color: rgba(90,240,150,0.5); }
#hud .banner.bad { color: #ff8f7a; border-color: rgba(255,110,90,0.5); }
#hud .waypoint {
  position: absolute; left: 0; top: 0; transform: translate(-50%,-50%);
  font-size: 11px; font-weight: 800; letter-spacing: 1.4px; color: #ffd76a;
  padding: 4px 8px; border-radius: 8px; background: rgba(8,11,16,0.6);
  border: 1px solid rgba(255,200,80,0.45); white-space: nowrap; opacity: 0;
}
#hud .waypoint.show { opacity: 1; }
#hud .hint {
  left: 50%; bottom: 26px; transform: translateX(-50%);
  padding: 7px 16px; font-size: 11px; letter-spacing: 2px; color: #b9c6d4; font-weight: 700;
}
#hud .mode {
  left: 24px; top: 22px; padding: 8px 14px; font-size: 11px; letter-spacing: 2.6px;
  font-weight: 800; color: #cfd8e2;
}
#start, #pause {
  position: fixed; inset: 0; z-index: 20; display: flex; align-items: center; justify-content: center;
  background: radial-gradient(circle at 50% 45%, rgba(20,32,48,0.72), rgba(4,6,10,0.94));
  font-family: "Helvetica Neue", Helvetica, Arial, sans-serif; color: #eef2f6;
  transition: opacity 0.35s ease;
}
#start.hidden, #pause.hidden { opacity: 0; pointer-events: none; }
#start .card, #pause .card { text-align: center; max-width: 760px; padding: 0 24px; }
#start .kicker { font-size: 12px; letter-spacing: 9px; color: #ff5f8f; font-weight: 800; }
#start h1 {
  font-size: 84px; line-height: 0.92; margin: 12px 0 4px; font-weight: 900; letter-spacing: -1px;
  background: linear-gradient(180deg,#ffffff,#8fb6ff 60%,#ff5f8f);
  -webkit-background-clip: text; background-clip: text; color: transparent;
  text-shadow: 0 0 60px rgba(120,170,255,0.25);
}
#start h2 { font-size: 17px; letter-spacing: 7px; color: #9fb4c8; font-weight: 700; margin: 0 0 22px; }
#start .keys { display: grid; grid-template-columns: repeat(2, minmax(0,1fr)); gap: 6px 30px; font-size: 13px; color: #c8d5e2; margin: 0 auto 24px; max-width: 560px; text-align: left; }
#start .keys b { color: #ffd76a; font-weight: 800; letter-spacing: 1px; }
#start .cta { font-size: 14px; letter-spacing: 4px; font-weight: 800; color: #0b0f14; background: linear-gradient(90deg,#8ff0b4,#5fd0ff); display: inline-block; padding: 13px 30px; border-radius: 999px; }
#start .foot { margin-top: 16px; font-size: 11px; letter-spacing: 2px; color: #7f8f9f; }
#pause .card h2 { font-size: 34px; letter-spacing: 6px; margin: 0 0 10px; }
#pause .card p { color: #a9b8c7; font-size: 13px; letter-spacing: 2px; }
`;

export class Hud {
  constructor(root) {
    this.root = root || document.body;
    this.money = 0;
    this.bannerText = '';
    this.bannerTime = 0;
    this.bannerSticky = false;
    this.starsShown = -1;
    this.paused = false;
    this.minimapSize = 168;
    this.speedSize = 156;
    this.waypointShown = false;
    this.build();
  }

  build() {
    if (!document.getElementById('hud-style')) {
      const style = document.createElement('style');
      style.id = 'hud-style';
      style.textContent = STYLE;
      document.head.appendChild(style);
    }

    const hud = document.createElement('div');
    hud.id = 'hud';
    hud.innerHTML = `
      <div class="panel mode" id="hudMode">ON FOOT</div>
      <div class="panel stars" id="hudStars">
        <span>★</span><span>★</span><span>★</span><span>★</span><span>★</span>
      </div>
      <div class="panel objective" id="hudObjective">
        <div class="label" id="hudJobLabel">JOB 1 OF 3</div>
        <div class="line" id="hudJobLine">SALTWATER RUN</div>
        <div class="timer" id="hudTimer">2:30</div>
      </div>
      <div class="panel money" id="hudMoney">$0<small>CASH</small></div>
      <div class="panel jobs" id="hudJobs">JOBS 0 / 3</div>
      <div class="panel condition" id="hudCondition">
        <div class="label"><span>CONDITION</span><span id="hudHealth">100</span></div>
        <div class="track"><div class="fill" id="hudHealthFill"></div></div>
      </div>
      <div class="panel minimap-wrap"><canvas class="minimap" id="hudMinimap"></canvas></div>
      <div class="panel speedo-wrap"><canvas class="speedo" id="hudSpeedo"></canvas></div>
      <div class="banner" id="hudBanner"></div>
      <div class="waypoint" id="hudWaypoint"></div>
      <div class="panel hint" id="hudHint">E · ENTER CAR &nbsp;&nbsp; F · EXIT &nbsp;&nbsp; LEFT CLICK · FIRE</div>
    `;
    this.root.appendChild(hud);
    this.hud = hud;

    this.el = {
      mode: hud.querySelector('#hudMode'),
      stars: Array.from(hud.querySelectorAll('#hudStars span')),
      jobLabel: hud.querySelector('#hudJobLabel'),
      jobLine: hud.querySelector('#hudJobLine'),
      timer: hud.querySelector('#hudTimer'),
      money: hud.querySelector('#hudMoney'),
      jobs: hud.querySelector('#hudJobs'),
      health: hud.querySelector('#hudHealth'),
      healthFill: hud.querySelector('#hudHealthFill'),
      banner: hud.querySelector('#hudBanner'),
      waypoint: hud.querySelector('#hudWaypoint'),
      hint: hud.querySelector('#hudHint'),
    };

    const map = hud.querySelector('#hudMinimap');
    map.width = this.minimapSize;
    map.height = this.minimapSize;
    this.mapCtx = map.getContext('2d');

    const speedo = hud.querySelector('#hudSpeedo');
    speedo.width = this.speedSize;
    speedo.height = this.speedSize;
    this.speedCtx = speedo.getContext('2d');

    this.startScreen = document.createElement('div');
    this.startScreen.id = 'start';
    this.startScreen.innerHTML = `
      <div class="card">
        <div class="kicker">MAKE.FUN PRESENTS</div>
        <h1>NEON CITY</h1>
        <h2>SALTWATER VICE</h2>
        <div class="keys">
          <div><b>W A S D</b> — walk / drive</div>
          <div><b>SHIFT</b> — run / handbrake</div>
          <div><b>MOUSE</b> — look, click to fire</div>
          <div><b>E</b> — enter or hijack a car</div>
          <div><b>F</b> — step out</div>
          <div><b>SPACE</b> — brake</div>
          <div><b>R</b> — reload</div>
          <div><b>M</b> — mute &nbsp; <b>ESC</b> — pause</div>
        </div>
        <div class="cta">CLICK TO START</div>
        <div class="foot">THREE JOBS · FIVE STARS · ONE CITY</div>
      </div>
    `;
    this.root.appendChild(this.startScreen);

    this.pauseScreen = document.createElement('div');
    this.pauseScreen.id = 'pause';
    this.pauseScreen.classList.add('hidden');
    this.pauseScreen.innerHTML = `
      <div class="card">
        <h2>PAUSED</h2>
        <p>ESC TO RESUME &nbsp;·&nbsp; R TO RESTART THE RUN</p>
      </div>
    `;
    this.root.appendChild(this.pauseScreen);
  }

  hideStart() {
    this.startScreen.classList.add('hidden');
  }

  showStart() {
    this.startScreen.classList.remove('hidden');
  }

  setPaused(paused) {
    this.paused = paused;
    this.pauseScreen.classList.toggle('hidden', !paused);
  }

  setBanner(text, tone = 'info', sticky = false) {
    this.bannerText = text || '';
    this.bannerSticky = sticky;
    this.bannerTime = sticky ? 9999 : HUDSET.bannerTime;
    this.el.banner.textContent = this.bannerText;
    this.el.banner.className = `banner${text ? ' show' : ''}${tone !== 'info' ? ' ' + tone : ''}`;
  }

  message(text, tone = 'info') {
    this.setBanner(text, tone, false);
  }

  setMoney(value) {
    this.money = value;
    const formatted = Math.floor(value).toLocaleString('en-US');
    this.el.money.innerHTML = `$${formatted}<small>CASH</small>`;
  }

  setStars(count, rising = 0) {
    if (count === this.starsShown && rising <= 0) {
      // Still clear the pulse class when the rise settles.
      for (const s of this.el.stars) s.classList.remove('pulse');
      return;
    }
    this.starsShown = count;
    this.el.stars.forEach((el, i) => {
      el.classList.toggle('on', i < count);
      el.classList.toggle('pulse', i < count && rising > 0);
    });
  }

  setHint(text) {
    this.el.hint.textContent = text;
  }

  setMode(mode) {
    this.el.mode.textContent = mode === 'car' ? 'DRIVING' : 'ON FOOT';
  }

  update(dt, state) {
    // Banner lifetime.
    if (!this.bannerSticky && this.bannerTime > 0) {
      this.bannerTime -= dt;
      if (this.bannerTime <= 0) {
        this.el.banner.classList.remove('show');
        this.bannerText = '';
      }
    }

    this.setMoney(state.money);
    this.setStars(state.stars, state.rising);
    if (state.mode !== this.modeShown) {
      this.modeShown = state.mode;
      this.el.mode.textContent = state.mode === 'car' ? 'DRIVING' : 'ON FOOT';
      this.setHint(
        state.mode === 'car'
          ? 'F · EXIT   SPACE · HAND BRAKE   SHIFT · BOOST'
          : 'E · ENTER CAR   LEFT CLICK · FIRE   R · RELOAD',
      );
    }

    this.el.jobLabel.textContent = `JOB ${clamp(state.jobIndex + 1, 1, 3)} OF 3`;
    this.el.jobLine.textContent = state.statusLine || '';
    this.el.timer.textContent = state.timeLeft && state.timeLeft > 0 ? this.formatTime(state.timeLeft) : '';
    this.el.jobs.textContent = `JOBS ${state.jobsDone} / 3`;

    const hp = clamp(state.health / state.maxHealth, 0, 1);
    this.el.health.textContent = String(Math.max(0, Math.round(state.health)));
    this.el.healthFill.style.width = `${hp * 100}%`;
    this.el.healthFill.classList.toggle('low', hp < 0.35);

    this.drawMinimap(state);
    this.drawSpeedo(state.speedKmh, state.mode === 'car', state.clip, state.ammo);
    this.updateWaypoint(state);
  }

  formatTime(seconds) {
    const s = Math.max(0, Math.ceil(seconds));
    const m = Math.floor(s / 60);
    const r = s % 60;
    return `${m}:${r < 10 ? '0' : ''}${r}`;
  }

  updateWaypoint(state) {
    const el = this.el.waypoint;
    const m = state.marker;
    if (!m || !m.visible || !state.camera) {
      el.classList.remove('show');
      return;
    }
    // Project the marker into screen space.
    const cam = state.camera;
    const dx = m.x - cam.position.x;
    const dz = m.z - cam.position.z;
    const dist = Math.hypot(dx, dz);
    const forwardX = Math.cos(state.cameraYaw ?? 0);
    const forwardZ = -Math.sin(state.cameraYaw ?? 0);
    const dot = (dx * forwardX + dz * forwardZ) / (dist || 1);

    const w = window.innerWidth;
    const hgt = window.innerHeight;
    let sx = w / 2;
    let sy = hgt * 0.34;
    // Side of the screen: sign of the cross product.
    const cross = dx * forwardZ - dz * forwardX;
    const side = clamp(cross / (dist || 1), -1, 1);
    if (dot < 0.2) {
      sx = w / 2 + side * w * 0.32;
      sy = hgt * 0.62;
    } else {
      sx = w / 2 + side * w * 0.2;
      sy = hgt * 0.3;
    }
    el.style.left = `${sx}px`;
    el.style.top = `${sy}px`;
    el.textContent = `▲ ${m.label || 'OBJECTIVE'} · ${Math.round(dist)} M`;
    el.classList.add('show');
  }

  drawMinimap(state) {
    const ctx = this.mapCtx;
    const size = this.minimapSize;
    const scale = size / 230; // metres across the minimap
    const px = state.player.x;
    const pz = state.player.z;
    const cx = size / 2;
    const cy = size / 2;

    ctx.save();
    ctx.clearRect(0, 0, size, size);
    ctx.fillStyle = '#0d1319';
    ctx.fillRect(0, 0, size, size);

    // Blocks.
    ctx.fillStyle = '#1a2430';
    const plate = (CITY.lot + CITY.walk * 2) * scale;
    for (let j = 0; j < CITY.blocks; j++) {
      for (let i = 0; i < CITY.blocks; i++) {
        const c = CITY.blockCenter(i, j);
        const x = cx + (c.x - px) * scale - plate / 2;
        const y = cy + (c.z - pz) * scale - plate / 2;
        if (x > size || y > size || x + plate < 0 || y + plate < 0) continue;
        ctx.fillRect(x, y, plate, plate);
      }
    }

    // Roads: two sets of thin lanes.
    ctx.strokeStyle = '#2c3a4a';
    ctx.lineWidth = CITY.road * scale;
    for (let k = 0; k <= CITY.blocks; k++) {
      const line = CITY.roadLine(k);
      const y = cy + (line - pz) * scale;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(size, y);
      ctx.stroke();
      const x = cx + (line - px) * scale;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, size);
      ctx.stroke();
    }

    // Traffic dots.
    if (state.traffic) {
      ctx.fillStyle = 'rgba(180,196,214,0.55)';
      for (const c of state.traffic) {
        const x = cx + (c.x - px) * scale;
        const y = cy + (c.z - pz) * scale;
        if (x < 2 || y < 2 || x > size - 2 || y > size - 2) continue;
        ctx.fillRect(x - 1.5, y - 1.5, 3, 3);
      }
    }

    // Police blips, pulsing.
    if (state.policeCars) {
      for (const c of state.policeCars) {
        const x = cx + (c.x - px) * scale;
        const y = cy + (c.z - pz) * scale;
        if (x < 4 || y < 4 || x > size - 4 || y > size - 4) continue;
        ctx.beginPath();
        ctx.arc(x, y, 4.2, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(255,60,60,0.85)';
        ctx.fill();
        ctx.beginPath();
        ctx.arc(x, y, 7.5, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(255,70,70,0.35)';
        ctx.stroke();
      }
    }

    // Objective.
    if (state.marker && state.marker.visible) {
      const mx = cx + (state.marker.x - px) * scale;
      const my = cy + (state.marker.z - pz) * scale;
      const clampedX = clamp(mx, 8, size - 8);
      const clampedY = clamp(my, 8, size - 8);
      ctx.save();
      ctx.translate(clampedX, clampedY);
      ctx.rotate(Math.PI / 4);
      ctx.fillStyle = '#ffd34d';
      ctx.fillRect(-4.5, -4.5, 9, 9);
      ctx.strokeStyle = 'rgba(255,220,120,0.6)';
      ctx.strokeRect(-7, -7, 14, 14);
      ctx.restore();
    }

    // Player arrow.
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(-state.player.yaw + Math.PI / 2);
    ctx.beginPath();
    ctx.moveTo(0, -7);
    ctx.lineTo(5.2, 5.4);
    ctx.lineTo(0, 2.6);
    ctx.lineTo(-5.2, 5.4);
    ctx.closePath();
    ctx.fillStyle = '#f4f8ff';
    ctx.fill();
    ctx.strokeStyle = 'rgba(120,190,255,0.9)';
    ctx.lineWidth = 1.2;
    ctx.stroke();
    ctx.restore();

    // Frame and north tick.
    ctx.strokeStyle = 'rgba(255,255,255,0.14)';
    ctx.lineWidth = 1;
    ctx.strokeRect(0.5, 0.5, size - 1, size - 1);
    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    ctx.font = 'bold 9px Helvetica, Arial, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('N', cx, 11);
    ctx.restore();
  }

  drawSpeedo(kmh, driving, clip, ammo) {
    const ctx = this.speedCtx;
    const s = this.speedSize;
    const c = s / 2;
    const r = c - 12;
    ctx.clearRect(0, 0, s, s);

    const start = Math.PI * 0.75;
    const end = Math.PI * 2.25;
    const maxKmh = 180;

    ctx.beginPath();
    ctx.arc(c, c, r, start, end);
    ctx.strokeStyle = 'rgba(255,255,255,0.14)';
    ctx.lineWidth = 7;
    ctx.stroke();

    const t = clamp(kmh / maxKmh, 0, 1);
    ctx.beginPath();
    ctx.arc(c, c, r, start, start + (end - start) * t);
    const grad = ctx.createLinearGradient(0, 0, s, s);
    grad.addColorStop(0, '#5fd0ff');
    grad.addColorStop(1, '#ff5f8f');
    ctx.strokeStyle = grad;
    ctx.lineWidth = 7;
    ctx.lineCap = 'round';
    ctx.stroke();
    ctx.lineCap = 'butt';

    // Ticks.
    ctx.strokeStyle = 'rgba(255,255,255,0.35)';
    ctx.lineWidth = 1.5;
    for (let i = 0; i <= 9; i++) {
      const a = start + ((end - start) * i) / 9;
      const x1 = c + Math.cos(a) * (r - 10);
      const y1 = c + Math.sin(a) * (r - 10);
      const x2 = c + Math.cos(a) * (r - 16);
      const y2 = c + Math.sin(a) * (r - 16);
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();
    }

    ctx.textAlign = 'center';
    ctx.fillStyle = '#f2f6fa';
    ctx.font = 'bold 34px Helvetica, Arial, sans-serif';
    ctx.fillText(String(Math.round(kmh)), c, c + 6);
    ctx.fillStyle = 'rgba(190,205,220,0.8)';
    ctx.font = 'bold 9px Helvetica, Arial, sans-serif';
    ctx.fillText(driving ? 'KM/H' : 'ON FOOT', c, c + 24);
    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    ctx.font = 'bold 10px Helvetica, Arial, sans-serif';
    ctx.fillText(driving ? 'GEAR D' : `AMMO ${clip}/${ammo}`, c, c + 44);
  }
}
