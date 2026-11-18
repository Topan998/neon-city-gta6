// audio.js — every sound in the game is synthesised at runtime with WebAudio. No files, no network.
//
// The context is only created on the first user gesture (browsers refuse otherwise). Engines are two
// detuned saw oscillators through a low-pass that opens with speed; the siren is a pair of sweeping
// oscillators; gunshots and impacts are shaped noise; the city hum is filtered noise that follows the
// camera's surroundings.

import { AUDIO } from './config.js';

export class Audio {
  constructor() {
    this.ctx = null;
    this.ready = false;
    this.master = null;
    this.engineOn = false;
    this.sirenOn = false;
    this.enabled = true;
    this.gestureBound = false;
  }

  // Called from the first click or key press.
  ensure() {
    if (this.ready || !this.enabled) return this.ready;
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return false;
    try {
      this.ctx = new Ctx();
      this.master = this.ctx.createGain();
      this.master.gain.value = AUDIO.master;
      this.master.connect(this.ctx.destination);
      this.buildNoise();
      this.buildHum();
      this.ready = true;
    } catch (err) {
      this.enabled = false;
      return false;
    }
    return true;
  }

  resume() {
    if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
  }

  now() {
    return this.ctx ? this.ctx.currentTime : 0;
  }

  buildNoise() {
    const len = Math.floor(this.ctx.sampleRate * 1.2);
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = buf.getChannelData(0);
    let seed = 12345;
    for (let i = 0; i < len; i++) {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      data[i] = ((seed / 0x7fffffff) * 2 - 1) * 0.9;
    }
    this.noiseBuffer = buf;
  }

  noiseSource(duration) {
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    src.loop = true;
    src.playbackRate.value = 1;
    src.start(this.now());
    src.stop(this.now() + duration);
    return src;
  }

  // ------------------------------------------------------------- city hum
  buildHum() {
    const src = this.noiseSource(9999);
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 420;
    filter.Q.value = 0.7;
    const gain = this.ctx.createGain();
    gain.gain.value = 0.05;
    src.connect(filter);
    filter.connect(gain);
    gain.connect(this.master);
    this.humGain = gain;
    this.humFilter = filter;
  }

  setCityMood(wanted) {
    if (!this.ready || !this.humGain) return;
    const target = 0.035 + wanted * 0.01;
    this.humGain.gain.setTargetAtTime(target, this.now(), 0.4);
    this.humFilter.frequency.setTargetAtTime(380 + wanted * 90, this.now(), 0.5);
  }

  // ---------------------------------------------------------------- engine
  startEngine() {
    if (!this.ready || this.engineOn) return;
    const ctx = this.ctx;
    const osc1 = ctx.createOscillator();
    const osc2 = ctx.createOscillator();
    osc1.type = 'sawtooth';
    osc2.type = 'square';
    osc1.frequency.value = 52;
    osc2.frequency.value = 78;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 320;
    filter.Q.value = 4;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    osc1.connect(filter);
    osc2.connect(filter);
    filter.connect(gain);
    gain.connect(this.master);
    osc1.start();
    osc2.start();
    this.engine = { osc1, osc2, filter, gain };
    this.engineOn = true;
    gain.gain.setTargetAtTime(AUDIO.engine, this.now(), 0.2);
  }

  stopEngine() {
    if (!this.engineOn || !this.engine) return;
    const t = this.now();
    this.engine.gain.gain.setTargetAtTime(0, t, 0.12);
    this.engine.osc1.stop(t + 0.5);
    this.engine.osc2.stop(t + 0.5);
    this.engineOn = false;
  }

  setEngine(speedN, throttle) {
    if (!this.engineOn || !this.engine) return;
    const t = this.now();
    const rpm = 46 + speedN * 128 + throttle * 14;
    this.engine.osc1.frequency.setTargetAtTime(rpm, t, 0.08);
    this.engine.osc2.frequency.setTargetAtTime(rpm * 1.51, t, 0.08);
    this.engine.filter.frequency.setTargetAtTime(280 + speedN * 900, t, 0.1);
    this.engine.gain.gain.setTargetAtTime(
      AUDIO.engine * (0.5 + speedN * 0.7 + throttle * 0.2),
      t,
      0.15,
    );
  }

  // ----------------------------------------------------------------- siren
  siren(on) {
    if (!this.ready) return;
    const t = this.now();
    if (!on) {
      if (this.sirenNodes) {
        this.sirenNodes.gain.gain.setTargetAtTime(0, t, 0.2);
        this.sirenNodes.osc.stop(t + 0.6);
        this.sirenNodes = null;
      }
      this.sirenOn = false;
      return;
    }
    if (this.sirenOn) return;
    const ctx = this.ctx;
    const osc = ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.value = 640;
    const lfo = ctx.createOscillator();
    lfo.type = 'sine';
    lfo.frequency.value = 0.55;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 220;
    lfo.connect(lfoGain);
    lfoGain.connect(osc.frequency);
    const gain = ctx.createGain();
    gain.gain.value = 0;
    osc.connect(gain);
    gain.connect(this.master);
    osc.start();
    lfo.start();
    gain.gain.setTargetAtTime(AUDIO.siren * 0.35, t, 0.3);
    this.sirenNodes = { osc, lfo, gain };
    this.sirenOn = true;
  }

  // --------------------------------------------------------------- effects
  gunshot(volume = 1) {
    if (!this.ready) return;
    const t = this.now();
    const src = this.noiseSource(0.22);
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(1800, t);
    filter.frequency.exponentialRampToValueAtTime(320, t + 0.18);
    filter.Q.value = 0.9;
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(AUDIO.gun * volume, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.2);
    src.connect(filter);
    filter.connect(gain);
    gain.connect(this.master);

    const osc = this.ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(180, t);
    osc.frequency.exponentialRampToValueAtTime(60, t + 0.12);
    const og = this.ctx.createGain();
    og.gain.setValueAtTime(0.35 * volume, t);
    og.gain.exponentialRampToValueAtTime(0.001, t + 0.14);
    osc.connect(og);
    og.connect(this.master);
    osc.start(t);
    osc.stop(t + 0.16);
  }

  thud(volume = 1) {
    if (!this.ready) return;
    const t = this.now();
    const osc = this.ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(120, t);
    osc.frequency.exponentialRampToValueAtTime(38, t + 0.28);
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.5 * volume, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
    osc.connect(gain);
    gain.connect(this.master);
    osc.start(t);
    osc.stop(t + 0.32);
  }

  footstep(speed = 2) {
    if (!this.ready) return;
    const t = this.now();
    const src = this.noiseSource(0.1);
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'highpass';
    filter.frequency.value = 900;
    const gain = this.ctx.createGain();
    const v = Math.min(0.16, 0.05 + speed * 0.012);
    gain.gain.setValueAtTime(v, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.09);
    src.connect(filter);
    filter.connect(gain);
    gain.connect(this.master);
  }

  click() {
    if (!this.ready) return;
    const t = this.now();
    const osc = this.ctx.createOscillator();
    osc.type = 'square';
    osc.frequency.setValueAtTime(880, t);
    osc.frequency.exponentialRampToValueAtTime(440, t + 0.06);
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.08, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.07);
    osc.connect(gain);
    gain.connect(this.master);
    osc.start(t);
    osc.stop(t + 0.08);
  }

  sting(level = 1) {
    if (!this.ready) return;
    const t = this.now();
    const notes = [330, 392, 466 + level * 18];
    notes.forEach((f, i) => {
      const osc = this.ctx.createOscillator();
      osc.type = 'triangle';
      osc.frequency.value = f;
      const gain = this.ctx.createGain();
      gain.gain.setValueAtTime(0, t + i * 0.09);
      gain.gain.linearRampToValueAtTime(0.09, t + i * 0.09 + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, t + i * 0.09 + 0.3);
      osc.connect(gain);
      gain.connect(this.master);
      osc.start(t + i * 0.09);
      osc.stop(t + i * 0.09 + 0.32);
    });
  }

  chime(good = true) {
    if (!this.ready) return;
    const t = this.now();
    const base = good ? 523.25 : 196;
    const seq = good ? [1, 1.25, 1.5] : [1, 0.84, 0.7];
    seq.forEach((mul, i) => {
      const osc = this.ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = base * mul;
      const gain = this.ctx.createGain();
      gain.gain.setValueAtTime(0, t + i * 0.12);
      gain.gain.linearRampToValueAtTime(0.12, t + i * 0.12 + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, t + i * 0.12 + 0.55);
      osc.connect(gain);
      gain.connect(this.master);
      osc.start(t + i * 0.12);
      osc.stop(t + i * 0.12 + 0.6);
    });
  }

  setMuted(muted) {
    this.enabled = !muted;
    if (this.master) this.master.gain.value = muted ? 0 : AUDIO.master;
  }
}
