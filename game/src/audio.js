// audio.js — every sound in the game is synthesized here with WebAudio: no files, no network.
//
// The engine is two detuned saws through a low-pass filter whose cutoff follows the throttle; the
// tyres are filtered noise; gunshots are a noise burst with a fast envelope plus a body thump; the
// siren is a two-tone oscillator that fades in with distance. Everything runs through one master
// gain so mute is a single ramp.

const THREE = window.THREE;

export class Audio {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.engine = null;
    this.sirenOsc = null;
    this.sirenGain = null;
    this.muted = false;
    this.ready = false;
    this.lastStep = 0;
    this.lastGun = 0;
    this.active = false;
  }

  /** Browsers only allow audio after a gesture: main.js calls this on the first click or key. */
  start() {
    if (this.ready) return;
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    try {
      this.ctx = new Ctx();
    } catch (err) {
      return;
    }
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.55;
    this.master.connect(this.ctx.destination);
    this.noiseBuffer = this.makeNoise();
    this.ready = true;
    this.active = true;
    this.buildEngine();
    this.buildSiren();
  }

  makeNoise(seconds = 2) {
    const ctx = this.ctx;
    const buffer = ctx.createBuffer(1, ctx.sampleRate * seconds, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    let last = 0;
    for (let i = 0; i < data.length; i += 1) {
      const white = Math.random() * 2 - 1;
      // a little pink: noise through a one-pole low pass
      last = last * 0.86 + white * 0.14;
      data[i] = last * 3.2;
    }
    return buffer;
  }

  noiseSource() {
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    src.loop = true;
    return src;
  }

  /** Two saws, a sub and a filter: the note follows road speed and the throttle opens the filter. */
  buildEngine() {
    const ctx = this.ctx;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 480;
    filter.Q.value = 3.2;
    const osc1 = ctx.createOscillator();
    osc1.type = 'sawtooth';
    osc1.frequency.value = 60;
    const osc2 = ctx.createOscillator();
    osc2.type = 'square';
    osc2.frequency.value = 61.5;
    const sub = ctx.createOscillator();
    sub.type = 'sine';
    sub.frequency.value = 30;
    const subGain = ctx.createGain();
    subGain.gain.value = 0.5;
    osc1.connect(filter);
    osc2.connect(filter);
    sub.connect(subGain);
    subGain.connect(gain);
    filter.connect(gain);
    gain.connect(this.master);
    osc1.start();
    osc2.start();
    sub.start();
    this.engineVoice = { gain, filter, osc1, osc2, sub, running: false };
  }

  buildSiren() {
    const ctx = this.ctx;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    const osc = ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.value = 720;
    const lfo = ctx.createOscillator();
    lfo.type = 'sine';
    lfo.frequency.value = 0.55;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 220;
    lfo.connect(lfoGain);
    lfoGain.connect(osc.frequency);
    osc.connect(gain);
    gain.connect(this.master);
    osc.start();
    lfo.start();
    this.sirenOsc = osc;
    this.sirenGain = gain;
  }

  /** Engine note from road speed, with a wobble on throttle and a drop on the handbrake. */
  /** The engine note: called every frame while driving. */
  engineNote(speedKph, throttleOn, handbrake) {
    if (!this.ready || !this.engineVoice) return;
    const e = this.engineVoice;
    const t = this.ctx.currentTime;
    const gearBand = speedKph < 1 ? 900 : 900 + (speedKph % 40) * 26;
    const base = 46 + Math.min(speedKph, 160) * 0.62;
    e.osc1.frequency.setTargetAtTime(base, t, 0.08);
    e.osc2.frequency.setTargetAtTime(base * 1.013, t, 0.08);
    e.sub.frequency.setTargetAtTime(base * 0.5, t, 0.1);
    e.filter.frequency.setTargetAtTime(gearBand * (handbrake ? 1.6 : 1), t, 0.06);
    const loud = this.active ? (throttleOn ? 0.16 : 0.09) : 0;
    e.gain.gain.setTargetAtTime(loud, t, 0.12);
    e.running = true;
  }

  engineStart() {
    if (!this.ready) return;
    this.active = true;
    const t = this.ctx.currentTime;
    if (this.engineVoice) this.engineVoice.gain.gain.setTargetAtTime(0.1, t, 0.05);
  }

  engineStop() {
    if (!this.ready || !this.engineVoice) return;
    this.engineVoice.gain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.12);
    this.active = false;
  }

  /** Siren: level 0..1 from the nearest cruiser, plus a tone change by star count. */
  siren(level, stars) {
    if (!this.ready || !this.sirenGain) return;
    const t = this.ctx.currentTime;
    this.sirenGain.gain.setTargetAtTime(clamp01(level) * 0.055, t, 0.25);
    if (this.sirenOsc) this.sirenOsc.frequency.setTargetAtTime(stars >= 4 ? 820 : 700, t, 0.5);
  }

  gunshot(isPolice = false) {
    if (!this.ready || this.muted) return;
    const now = this.ctx.currentTime;
    if (now - this.lastGun < 0.02) return;
    this.lastGun = now;
    const ctx = this.ctx;
    const src = this.noiseSource();
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = isPolice ? 1800 : 2400;
    bp.Q.value = 0.9;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(isPolice ? 0.5 : 0.7, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.16);
    src.connect(bp);
    bp.connect(gain);
    gain.connect(this.master);
    src.start(now);
    src.stop(now + 0.2);
    // body
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(180, now);
    osc.frequency.exponentialRampToValueAtTime(48, now + 0.12);
    const og = ctx.createGain();
    og.gain.setValueAtTime(0.42, now);
    og.gain.exponentialRampToValueAtTime(0.001, now + 0.14);
    osc.connect(og);
    og.connect(this.master);
    osc.start(now);
    osc.stop(now + 0.16);
  }

  footstep(running = false) {
    if (!this.ready || this.muted) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;
    if (now - this.lastStep < 0.08) return;
    this.lastStep = now;
    const src = this.noiseSource();
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = running ? 900 : 600;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(running ? 0.1 : 0.06, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.1);
    src.connect(lp);
    lp.connect(gain);
    gain.connect(this.master);
    src.start(now);
    src.stop(now + 0.12);
  }

  /** A short blip for UI: frequency and length. */
  click(freq = 440, dur = 0.06, type = 'square') {
    if (!this.ready || this.muted) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.value = freq;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.06, now);
    gain.gain.exponentialRampToValueAtTime(0.0008, now + dur);
    osc.connect(gain);
    gain.connect(this.master);
    osc.start(now);
    osc.stop(now + dur + 0.02);
  }

  /** Car-to-car contact: a dull thud scaled by the impact. */
  impact(strength = 0.4) {
    if (!this.ready || this.muted) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;
    const src = this.noiseSource();
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 420;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.28 * clamp01(strength), now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.22);
    src.connect(lp);
    lp.connect(gain);
    gain.connect(this.master);
    src.start(now);
    src.stop(now + 0.24);
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(90, now);
    osc.frequency.exponentialRampToValueAtTime(38, now + 0.2);
    const og = ctx.createGain();
    og.gain.setValueAtTime(0.3 * clamp01(strength), now);
    og.gain.exponentialRampToValueAtTime(0.001, now + 0.24);
    osc.connect(og);
    og.connect(this.master);
    osc.start(now);
    osc.stop(now + 0.26);
  }

  thud() {
    this.impact(0.7);
  }

  /** A body hitting the pavement: a soft low knock. */
  body() {
    if (!this.ready || this.muted) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(120, now);
    osc.frequency.exponentialRampToValueAtTime(50, now + 0.18);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.22, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.2);
    osc.connect(gain);
    gain.connect(this.master);
    osc.start(now);
    osc.stop(now + 0.22);
  }

  /** An officer shouting: a filtered noise bark with a pitch envelope. */
  shout() {
    if (!this.ready || this.muted) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(320, now);
    osc.frequency.exponentialRampToValueAtTime(180, now + 0.18);
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 800;
    bp.Q.value = 1.2;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.09, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.22);
    osc.connect(bp);
    bp.connect(gain);
    gain.connect(this.master);
    osc.start(now);
    osc.stop(now + 0.24);
  }

  /** One of four stingers: job start, objective done, mission done, fail. */
  stinger(kind = 1) {
    if (!this.ready || this.muted) return;
    const notes = {
      0: [220, 165],
      1: [392, 523],
      2: [523, 659],
      3: [523, 659, 784, 1046],
    }[kind] ?? [440];
    notes.forEach((freq, i) => {
      setTimeout(() => this.click(freq, 0.14, 'triangle'), i * 110);
    });
  }

  setMuted(muted) {
    this.muted = muted;
    if (this.master) this.master.gain.setTargetAtTime(muted ? 0 : 0.55, this.ctx.currentTime, 0.05);
  }

  toggleMute() {
    this.setMuted(!this.muted);
    return this.muted;
  }

  /** Stop everything when the page is hidden. */
  suspend() {
    if (this.ctx && this.ctx.state === 'running') this.ctx.suspend();
  }

  resume() {
    if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
  }
}

function clamp01(v) {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}
