// The sound of the city, made rather than loaded: a WebAudio graph with an engine that follows the
// throttle, a pistol crack, a two-tone siren and the short wail that announces a new wanted star,
// tyres, impacts, a hiss of rain and the chime of a job paid. No audio file is fetched, so the game
// keeps its promise of no network request.

export function createAudio() {
  let context = null;
  let master = null;
  let engine = null;
  let siren = null;
  let rain = null;
  let enabled = false;
  let noiseBuffer = null;

  function ready() {
    if (context) return context;
    const Ctor = window.AudioContext || window.webkitAudioContext;
    if (!Ctor) return null;
    try {
      context = new Ctor();
    } catch {
      return null;
    }
    master = context.createGain();
    master.gain.value = 0.55;
    master.connect(context.destination);

    const length = Math.floor(context.sampleRate * 1.2);
    noiseBuffer = context.createBuffer(1, length, context.sampleRate);
    const data = noiseBuffer.getChannelData(0);
    for (let i = 0; i < length; i += 1) data[i] = Math.random() * 2 - 1;
    return context;
  }

  /** Browsers only allow audio after a gesture: call this from the first key or click. */
  function unlock() {
    const ctx = ready();
    if (!ctx) return;
    if (ctx.state === 'suspended') ctx.resume();
    enabled = true;
  }

  function noise(duration, gainValue, filterFreq, type = 'lowpass') {
    const ctx = ready();
    if (!ctx || !enabled) return;
    const source = ctx.createBufferSource();
    source.buffer = noiseBuffer;
    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = filterFreq;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(gainValue, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.0008, ctx.currentTime + duration);
    source.connect(filter);
    filter.connect(gain);
    gain.connect(master);
    source.start();
    source.stop(ctx.currentTime + duration);
  }

  function tone(frequency, duration, gainValue, type = 'sine', endFrequency = null) {
    const ctx = ready();
    if (!ctx || !enabled) return;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(frequency, ctx.currentTime);
    if (endFrequency) osc.frequency.exponentialRampToValueAtTime(endFrequency, ctx.currentTime + duration);
    gain.gain.setValueAtTime(0.0001, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(gainValue, ctx.currentTime + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + duration);
    osc.connect(gain);
    gain.connect(master);
    osc.start();
    osc.stop(ctx.currentTime + duration + 0.02);
  }

  /** A sawtooth through a low-pass, its pitch riding the wheels: the engine of whatever you drive. */
  function startEngine() {
    const ctx = ready();
    if (!ctx || !enabled || engine) return;
    const osc = ctx.createOscillator();
    const sub = ctx.createOscillator();
    const filter = ctx.createBiquadFilter();
    const gain = ctx.createGain();
    osc.type = 'sawtooth';
    sub.type = 'square';
    osc.frequency.value = 60;
    sub.frequency.value = 30;
    filter.type = 'lowpass';
    filter.frequency.value = 620;
    gain.gain.value = 0;
    osc.connect(filter);
    sub.connect(filter);
    filter.connect(gain);
    gain.connect(master);
    osc.start();
    sub.start();
    engine = { osc, sub, filter, gain };
  }

  function setEngine(speed, throttle) {
    if (!engine) return;
    const ratio = Math.min(1, Math.abs(speed) / 33);
    const now = context.currentTime;
    engine.osc.frequency.setTargetAtTime(48 + ratio * 125 + throttle * 14, now, 0.08);
    engine.sub.frequency.setTargetAtTime(24 + ratio * 60, now, 0.1);
    engine.filter.frequency.setTargetAtTime(420 + ratio * 1300, now, 0.12);
    engine.gain.gain.setTargetAtTime(0.09 + ratio * 0.13, now, 0.15);
  }

  function stopEngine() {
    if (!engine) return;
    const now = context.currentTime;
    engine.gain.gain.setTargetAtTime(0, now, 0.1);
    const osc = engine.osc;
    const sub = engine.sub;
    setTimeout(() => {
      try { osc.stop(); sub.stop(); } catch { /* already stopped */ }
    }, 400);
    engine = null;
  }

  function startSiren() {
    const ctx = ready();
    if (!ctx || !enabled || siren) return;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.value = 760;
    gain.gain.value = 0.0001;
    gain.gain.setTargetAtTime(0.06, ctx.currentTime, 0.2);
    osc.connect(gain);
    gain.connect(master);
    osc.start();
    siren = { osc, gain, phase: 0 };
  }

  function updateSiren(dt, distance) {
    if (!siren) return;
    siren.phase += dt;
    const wobble = Math.sin(siren.phase * 5.2) > 0 ? 880 : 620;
    siren.osc.frequency.setTargetAtTime(wobble, context.currentTime, 0.05);
    const volume = Math.max(0, 1 - distance / 190) * 0.075;
    siren.gain.gain.setTargetAtTime(volume, context.currentTime, 0.25);
  }

  function stopSiren() {
    if (!siren) return;
    const osc = siren.osc;
    siren.gain.gain.setTargetAtTime(0.0001, context.currentTime, 0.2);
    setTimeout(() => { try { osc.stop(); } catch { /* already stopped */ } }, 400);
    siren = null;
  }

  /** A new star: the siren sweeps up twice, the way a cruiser lights up right behind you. */
  function sirenRise() {
    tone(520, 0.26, 0.1, 'triangle', 1040);
    setTimeout(() => tone(1040, 0.3, 0.08, 'triangle', 560), 260);
  }

  /** `?rain=1`: a soft hiss on a filtered loop, started only once audio has been unlocked. */
  function startRain() {
    const ctx = ready();
    if (!ctx || !enabled || rain) return;
    const source = ctx.createBufferSource();
    source.buffer = noiseBuffer;
    source.loop = true;
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = 2600;
    filter.Q.value = 0.7;
    const gain = ctx.createGain();
    gain.gain.value = 0.0001;
    gain.gain.setTargetAtTime(0.05, ctx.currentTime, 0.8);
    source.connect(filter);
    filter.connect(gain);
    gain.connect(master);
    source.start();
    rain = { source, gain };
  }

  function stopRain() {
    if (!rain) return;
    const source = rain.source;
    rain.gain.gain.setTargetAtTime(0.0001, context.currentTime, 0.5);
    setTimeout(() => { try { source.stop(); } catch { /* already stopped */ } }, 900);
    rain = null;
  }

  return {
    unlock,
    get on() { return enabled; },
    pistol() {
      noise(0.16, 0.5, 2400, 'highpass');
      tone(180, 0.12, 0.22, 'square', 60);
    },
    impact() { noise(0.22, 0.4, 700); },
    tyre() { noise(0.3, 0.16, 1400, 'bandpass'); },
    cash() {
      tone(880, 0.11, 0.14, 'triangle');
      setTimeout(() => tone(1320, 0.14, 0.12, 'triangle'), 90);
    },
    hurt() { tone(110, 0.24, 0.24, 'sawtooth', 55); },
    sirenBlip() { tone(720, 0.3, 0.07, 'triangle', 980); },
    sirenRise,
    rainStart: startRain,
    rainStop: stopRain,
    explosion() {
      noise(0.8, 1.0, 420);
      tone(70, 0.5, 0.4, 'sawtooth', 30);
    },
    engineStart: startEngine,
    engineStop: stopEngine,
    setEngine,
    sirenStart: startSiren,
    sirenStop: stopSiren,
    updateSiren,
  };
}
