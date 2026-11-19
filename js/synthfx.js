"use strict";
// =============================================================================
// Procedural sound effects: character, boss, pickup and UI sounds synthesised
// live with the Web Audio API (no files, so they also work from file://).
//
//   synth.play(name, { volume, rate, pan })  a one-shot. Every option is
//       optional: volume 0..2 (1), rate shifts pitch and speed like a
//       playbackRate (1), pan -1..1 (0).
//   synth.loop(name) / synth.stop(name)  a looping sound; stop() fades it out
//       (and also cuts any one-shots of that name still ringing).
//
// Everything goes through SoundSystem's SFX bus, so the SFX slider and mute
// apply. Until the AudioContext exists (no gesture yet), or while it is
// suspended, every call is a silent no-op that never throws.
//
// Cheap on CPU: the noise, crackle, heartbeat and reverb buffers are made once
// per context and shared. Each sound has a minimum gap between plays and a cap
// on simultaneous voices (the oldest voice fades out to make room, or for the
// big stings the new one is dropped), and every play gets a little random
// pitch variance so repeats don't sound robotic. One-shots are skipped while
// muted or with the SFX slider at 0.
//
// A sound is a function of a "kit" (start time, rate, output node), so the same
// code plays live or renders into an OfflineAudioContext: synth.render(name).
// Open the game with ?sounds for a panel that plays every sound (tuning aid).
// =============================================================================

const synth = (() => {
  const Offline = window.OfflineAudioContext || window.webkitOfflineAudioContext;
  const LEVEL = 1; // overall trim of every synth sound
  const FADE = 0.18; // stop() fade-out, seconds
  const rnd = (a, b) => a + Math.random() * (b - a);
  const pick = (list) => list[Math.floor(Math.random() * list.length)];
  const midi = (m) => 440 * Math.pow(2, (m - 69) / 12);
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  const num = (v, fallback) => (typeof v === "number" && isFinite(v) ? v : fallback);
  // Envelopes: [[time, level], ...]
  const perc = (v, len, a = 0.002) => [[0, 0], [a, v], [len, 0]];
  const hit = (v, len) => [[0, v], [len, 0]];

  // -------------------------------------------------------- Shared buffers ---
  const shared = new WeakMap(); // AudioContext -> resources

  // A looping mono buffer from a sample generator: DC removed, normalised to
  // `rms` (or to a peak of 1), and its overrun crossfaded into the start so the
  // loop point is seamless
  function noiseBuffer(ctx, seconds, gen, rms) {
    const sr = ctx.sampleRate;
    const len = Math.floor(sr * seconds);
    const fade = Math.floor(sr * 0.05);
    const raw = new Float32Array(len + fade);
    for (let i = 0; i < raw.length; i++) raw[i] = gen();
    for (let i = 0; i < fade; i++) raw[i] = raw[i] * (i / fade) + raw[len + i] * (1 - i / fade);
    let mean = 0;
    for (let i = 0; i < len; i++) mean += raw[i] / len;
    let sum = 0;
    let peak = 0;
    for (let i = 0; i < len; i++) {
      raw[i] -= mean;
      sum += raw[i] * raw[i];
      peak = Math.max(peak, Math.abs(raw[i]));
    }
    const scale = rms ? rms / Math.sqrt(sum / len) : 1 / peak;
    const buf = ctx.createBuffer(1, len, sr);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = raw[i] * scale;
    return buf;
  }

  function pinkGen() {
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
    return () => {
      const w = Math.random() * 2 - 1;
      b0 = 0.99886 * b0 + w * 0.0555179;
      b1 = 0.99332 * b1 + w * 0.0750759;
      b2 = 0.969 * b2 + w * 0.153852;
      b3 = 0.8665 * b3 + w * 0.3104856;
      b4 = 0.55 * b4 + w * 0.5329522;
      b5 = -0.7616 * b5 - w * 0.016898;
      const out = b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362;
      b6 = w * 0.115926;
      return out;
    };
  }

  function brownGen() {
    let last = 0;
    return () => (last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02);
  }

  // Sparse little bursts: fire and electric crackle
  function crackleGen() {
    let amp = 0;
    return () => {
      if (Math.random() < 0.0015) amp = 0.3 + Math.random() * 0.7;
      else amp *= 0.86;
      return amp * (Math.random() * 2 - 1);
    };
  }

  // One slow "lub-dub" (55 bpm), looped by dilationLoop
  function heartBuffer(ctx) {
    const sr = ctx.sampleRate;
    const len = Math.floor(sr * 1.1);
    const buf = ctx.createBuffer(1, len, sr);
    const d = buf.getChannelData(0);
    const beat = (start, amp, f0) => {
      let phase = 0;
      for (let i = 0, at = Math.floor(start * sr); i < sr * 0.3 && at + i < len; i++) {
        const t = i / sr;
        phase += (2 * Math.PI * (32 + (f0 - 32) * Math.exp(-t * 22))) / sr;
        const env = Math.min(1, t / 0.006) * Math.exp(-t * 15);
        d[at + i] += amp * env * (Math.sin(phase) + 0.35 * Math.sin(2 * phase) + 0.12 * Math.sin(3 * phase));
      }
    };
    beat(0.06, 1, 78);
    beat(0.34, 0.7, 70);
    let peak = 0;
    for (let i = 0; i < len; i++) peak = Math.max(peak, Math.abs(d[i]));
    for (let i = 0; i < len; i++) d[i] *= 0.9 / peak;
    return buf;
  }

  // A short, bright room for the reverb send
  function roomBuffer(ctx) {
    const sr = ctx.sampleRate;
    const len = Math.floor(sr * 1.2);
    const pre = Math.floor(sr * 0.008);
    const buf = ctx.createBuffer(2, len, sr);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      for (let i = pre; i < len; i++) {
        const x = 1 - i / len;
        d[i] = (Math.random() * 2 - 1) * x * x * x;
      }
    }
    return buf;
  }

  const BUFFERS = {
    white: (ctx) => noiseBuffer(ctx, 1, () => Math.random() * 2 - 1, 0.3),
    pink: (ctx) => noiseBuffer(ctx, 1.5, pinkGen(), 0.3),
    brown: (ctx) => noiseBuffer(ctx, 1.5, brownGen(), 0.3),
    crackle: (ctx) => noiseBuffer(ctx, 1, crackleGen()),
    heart: heartBuffer,
    room: roomBuffer,
  };

  // The output chain for one context, and its buffers (each made once, when
  // first needed, then shared)
  function resources(ctx, dest) {
    let R = shared.get(ctx);
    if (R) return R;
    const bufs = {};
    R = { ctx, nyq: ctx.sampleRate * 0.48, curves: {} };
    R.buf = (key) => bufs[key] || (bufs[key] = BUFFERS[key](ctx));
    R.out = ctx.createGain();
    R.out.gain.value = LEVEL;
    R.out.connect(dest);
    R.verb = ctx.createConvolver();
    R.verb.connect(R.out);
    R.room = () => R.verb.buffer || (R.verb.buffer = R.buf("room"));
    shared.set(ctx, R);
    return R;
  }

  // ------------------------------------------------------------------ Kit ---
  // The building blocks a sound is made of, for one voice: times are seconds
  // from the voice's start and frequencies are at rate 1; the kit scales both.
  function Kit(R, t0, rate, out, hold) {
    this.R = R;
    this.ctx = R.ctx;
    this.t0 = t0;
    this.r = rate;
    this.out = out;
    this.hold = hold; // a loop: sources run until stop()
    this.srcs = [];
    this.end = t0;
    this.last = null;
  }
  const K = Kit.prototype;

  K.T = function (x) {
    return this.t0 + x / this.r;
  };

  // Set a param, or automate it through [[time, value], ...]: exponential
  // between positive values and into a final 0, linear out of a 0 (or always
  // linear with `lin`). Returns the time of the last point.
  K.ramp = function (param, pts, at, scale, max, lin) {
    if (!Array.isArray(pts)) {
      param.value = Math.min(max, pts * scale);
      return 0;
    }
    let prev = null;
    for (const [t, v0] of pts) {
      const v = Math.min(max, v0 * scale);
      const when = this.T(at + t);
      if (prev === null) param.setValueAtTime(v, when);
      else if (lin) param.linearRampToValueAtTime(v, when);
      else if (v > 0 && prev > 0) param.exponentialRampToValueAtTime(v, when);
      else if (prev > 0) {
        param.exponentialRampToValueAtTime(1e-4, when);
        param.setValueAtTime(0, when);
      } else param.linearRampToValueAtTime(v, when);
      prev = v;
    }
    return pts[pts.length - 1][0];
  };
  K.freq = function (param, pts, at) {
    return this.ramp(param, pts, at, this.r, this.R.nyq);
  };
  K.gain = function (param, pts, at) {
    return this.ramp(param, pts, at, 1, Infinity);
  };

  K.run = function (src, at, len, offset) {
    if (offset === undefined) src.start(this.T(at));
    else src.start(this.T(at), offset);
    this.srcs.push(src);
    src.stopAt = Infinity;
    if (this.hold) return;
    src.stopAt = this.T(at + len) + 0.03;
    src.stop(src.stopAt);
    if (src.stopAt >= this.end) {
      this.end = src.stopAt;
      this.last = src;
    }
  };

  const connect = (node, to, fallback) => [].concat(to || fallback).forEach((d) => node.connect(d));

  // source -> filters -> envelope (-> tremolo) -> destination; starts it all
  K.chain = function (src, o, at, extra, offset) {
    const ctx = this.ctx;
    let node = src;
    [].concat(o.filt || []).forEach((f) => {
      const b = ctx.createBiquadFilter();
      b.type = f.t;
      this.freq(b.frequency, f.f, at);
      if (f.q !== undefined) b.Q.value = f.q;
      node.connect(b);
      node = b;
    });
    const g = ctx.createGain();
    const len = this.gain(g.gain, o.e, at);
    node.connect(g);
    let tail = g;
    if (o.am) {
      // tremolo between 1 - 2d and 1
      const d = o.am.d === undefined ? 0.5 : o.am.d;
      const amg = ctx.createGain();
      const lfo = ctx.createOscillator();
      const depth = ctx.createGain();
      amg.gain.value = 1 - d;
      depth.gain.value = d;
      lfo.type = o.am.type || "sine";
      this.freq(lfo.frequency, o.am.f, at);
      lfo.connect(depth);
      depth.connect(amg.gain);
      g.connect(amg);
      tail = amg;
      extra.push(lfo);
    }
    connect(tail, o.to, this.out);
    this.run(src, at, len, offset);
    extra.forEach((s) => this.run(s, at, len));
    return { src, g, len };
  };

  // An oscillator: { type, f, e, at, det, fm: { f, d (Hz) }, filt, am, to }
  K.osc = function (o) {
    const ctx = this.ctx;
    const at = o.at || 0;
    const src = ctx.createOscillator();
    const extra = [];
    src.type = o.type || "sine";
    this.freq(src.frequency, o.f, at);
    if (o.det) src.detune.value = o.det;
    if (o.fm) {
      const m = ctx.createOscillator();
      const mg = ctx.createGain();
      m.type = o.fm.type || "sine";
      this.freq(m.frequency, o.fm.f, at);
      this.ramp(mg.gain, o.fm.d, at, this.r, Infinity);
      m.connect(mg);
      mg.connect(src.frequency);
      extra.push(m);
    }
    return this.chain(src, o, at, extra);
  };

  // A shared noise buffer: { buf: white|pink|brown|crackle|heart, e, at, rate, offset, filt, am, to }
  K.noise = function (o) {
    const at = o.at || 0;
    const src = this.ctx.createBufferSource();
    const buf = this.R.buf(o.buf || "white");
    src.buffer = buf;
    src.loop = true;
    src.playbackRate.value = (o.rate || 1) * this.r;
    return this.chain(src, o, at, [], o.offset !== undefined ? o.offset : Math.random() * buf.duration);
  };

  // An LFO added onto any param: { f, d, type, at, len } (len defaults to the
  // voice so far; in a loop it runs until stop())
  K.lfo = function (param, o) {
    const lfo = this.ctx.createOscillator();
    const depth = this.ctx.createGain();
    const at = o.at || 0;
    lfo.type = o.type || "sine";
    this.freq(lfo.frequency, o.f, at);
    depth.gain.value = o.d;
    lfo.connect(depth);
    depth.connect(param);
    this.run(lfo, at, o.len !== undefined ? o.len : Math.max(0, (this.end - this.t0) * this.r - at));
  };

  // A waveshaper (curves cached per context) followed by a level trim
  K.shape = function (key, make, post, to) {
    const R = this.R;
    const ws = this.ctx.createWaveShaper();
    ws.curve = R.curves[key] || (R.curves[key] = make());
    const g = this.ctx.createGain();
    g.gain.value = post;
    ws.connect(g);
    connect(g, to, this.out);
    return ws;
  };
  const curve = (fn) => {
    const n = 1024;
    const c = new Float32Array(n);
    for (let i = 0; i < n; i++) c[i] = fn((i / (n - 1)) * 2 - 1);
    return c;
  };
  // Soft saturation (tanh)
  K.drive = function (amount, post = 1, to) {
    return this.shape("drive" + amount, () => curve((x) => Math.tanh(amount * x) / Math.tanh(amount)), post, to);
  };
  // Bitcrusher: quantise the amplitude to a few steps (feed it loud)
  K.crush = function (steps, post = 1, to) {
    return this.shape("crush" + steps, () => curve((x) => Math.round(x * steps) / steps), post, to);
  };

  // A stereo position (a number, or [[time, pan], ...] to sweep it)
  K.pan = function (p, to) {
    if (!this.ctx.createStereoPanner) return to || this.out;
    const node = this.ctx.createStereoPanner();
    this.ramp(node.pan, p, 0, 1, 1, true);
    connect(node, to, this.out);
    return node;
  };

  // A pitch-dropping sine: kicks, thuds, impacts
  K.thump = function (at, f0, f1, len, v, to) {
    this.osc({ at, f: [[0, f0], [len * 0.4, f1]], e: perc(v, len, 0.003), to });
  };
  // A tiny noise transient
  K.click = function (at, v, f = 3000, to) {
    this.noise({ at, filt: { t: "highpass", f }, e: hit(v, 0.012), to });
  };
  // Inharmonic partials, the higher ones dying sooner: blades, clangs
  K.bell = function (at, f, ratios, amps, len, to) {
    ratios.forEach((ratio, i) => this.osc({ at, f: f * ratio, det: rnd(-5, 5), e: perc(amps[i], len / (1 + i * 0.4)), to }));
  };
  // A bright FM chime: pickups and rewards
  K.chime = function (at, f, v, len, to) {
    this.osc({ at, f, fm: { f: f * 3, d: [[0, f * 2.5], [len, f * 0.05]] }, e: perc(v, len), to });
    this.osc({ at, f: f * 2, e: perc(v * 0.3, len * 0.5), to });
  };

  // --------------------------------------------------------------- Sounds ---
  // gap: min seconds between plays; max: simultaneous voices; vary: random
  // pitch spread (+-); wet: reverb send; g: level; steal: false drops a new
  // play while `max` voices still ring; loop: runs until stop() (len: how
  // long play() lets it run).
  const SOUNDS = {
    // ---------------------------------------------------- CYBER WIDOW ---
    bowDraw: {
      gap: 0.2, max: 2, vary: 0.04, wet: 0.06, g: 1.6,
      fn(k) {
        // stick-slip creak: a slow, wobbly sawtooth's edges ring a resonant band that climbs with the tension
        k.osc({ type: "sawtooth", f: [[0, 34], [0.33, 88]], fm: { f: 11, d: 6 }, filt: { t: "bandpass", f: [[0, 520], [0.34, 1500]], q: 10 }, e: [[0, 0], [0.05, 0.35], [0.3, 0.6], [0.36, 0]] });
        // the string tightening
        k.osc({ type: "triangle", f: [[0, 180], [0.34, 430]], e: [[0, 0], [0.15, 0.02], [0.33, 0.06], [0.37, 0]] });
        // the limbs flexing
        k.noise({ buf: "pink", filt: { t: "bandpass", f: [[0, 260], [0.34, 900]], q: 3 }, e: [[0, 0], [0.12, 0.08], [0.32, 0.14], [0.36, 0]] });
      },
    },
    bowRelease: {
      gap: 0.06, max: 3, vary: 0.05, wet: 0.1, g: 0.85,
      fn(k) {
        // twang: the string snaps forward and rings down
        k.osc({ type: "sawtooth", f: [[0, 340], [0.02, 200], [0.4, 192]], fm: { f: 7, d: [[0, 9], [0.4, 1]] }, filt: { t: "lowpass", f: [[0, 4200], [0.35, 420]], q: 5 }, e: perc(0.3, 0.42) });
        k.osc({ f: [[0, 680], [0.02, 400], [0.25, 384]], e: perc(0.1, 0.25) });
        k.thump(0, 150, 60, 0.09, 0.4);
        // whoosh: the arrow leaves
        k.noise({ at: 0.01, buf: "pink", filt: { t: "bandpass", f: [[0, 3800], [0.24, 900]], q: 1.3 }, e: [[0, 0], [0.035, 0.5], [0.26, 0]] });
      },
    },
    arrowHit: {
      gap: 0.035, max: 4, vary: 0.07, wet: 0.05, g: 0.75,
      fn(k) {
        k.thump(0, 190, 62, 0.14, 0.6); // the thunk
        k.noise({ filt: { t: "bandpass", f: 950, q: 2.5 }, e: hit(0.55, 0.05) }); // knock
        k.click(0, 0.25, 3500); // the tip
        k.osc({ at: 0.01, type: "triangle", f: [[0, 300], [0.2, 270]], e: perc(0.07, 0.22), am: { f: 32, d: 0.5 } }); // the shaft quivering
      },
    },
    arrowPierce: {
      gap: 0.035, max: 4, vary: 0.06, wet: 0.06, g: 1.25,
      fn(k) {
        k.noise({ filt: { t: "bandpass", f: [[0, 1300], [0.08, 6500], [0.2, 2600]], q: 6 }, e: [[0, 0], [0.02, 0.7], [0.09, 0.45], [0.21, 0]] });
        k.osc({ f: [[0, 650], [0.09, 2500], [0.2, 1700]], e: [[0, 0], [0.01, 0.07], [0.2, 0]] });
        k.thump(0, 140, 70, 0.07, 0.3);
        k.click(0, 0.18, 4000);
      },
    },
    enemyFall: {
      gap: 0.08, max: 3, vary: 0.06, wet: 0.08, g: 0.4,
      fn(k) {
        k.osc({ f: [[0, 1900], [0.55, 380]], fm: { f: 7, d: 22 }, e: [[0, 0], [0.04, 0.2], [0.42, 0.15], [0.56, 0]] });
        k.osc({ type: "triangle", f: [[0, 1910], [0.55, 383]], e: [[0, 0], [0.04, 0.04], [0.56, 0]] });
        k.noise({ buf: "pink", filt: { t: "bandpass", f: [[0, 2600], [0.55, 600]], q: 4 }, e: [[0, 0], [0.06, 0.1], [0.56, 0]] });
      },
    },
    fallThud: {
      gap: 0.07, max: 3, vary: 0.06, wet: 0.12, g: 0.45,
      fn(k) {
        const d = k.drive(2.5, 0.7);
        k.thump(0, 105, 32, 0.45, 0.9, d);
        k.noise({ buf: "brown", filt: { t: "lowpass", f: [[0, 1000], [0.25, 120]] }, e: hit(0.9, 0.32), to: d });
        k.noise({ filt: { t: "bandpass", f: 1500, q: 1 }, e: hit(0.35, 0.07) });
        for (let i = 0; i < 3; i++) k.noise({ at: rnd(0.04, 0.2), filt: { t: "bandpass", f: rnd(1800, 3500), q: 4 }, e: hit(rnd(0.06, 0.14), 0.03) }); // debris
      },
    },
    bleed: {
      gap: 0.09, max: 2, vary: 0.08, g: 1.3,
      fn(k) {
        k.osc({ f: [[0, 1250], [0.035, 2100]], e: perc(0.1, 0.05) });
        k.noise({ filt: { t: "highpass", f: 5000 }, e: hit(0.04, 0.008) });
      },
    },
    flameOn: {
      gap: 0.15, max: 2, vary: 0.05, wet: 0.12, g: 0.65,
      fn(k) {
        const d = k.drive(2, 0.8);
        k.click(0, 0.3, 4500); // the spark
        k.noise({ buf: "crackle", filt: { t: "highpass", f: 1500 }, e: [[0, 0], [0.04, 0.5], [0.7, 0]] });
        // fwoomp: the ignition gulps air, then roars
        k.noise({ buf: "pink", filt: { t: "bandpass", f: [[0, 250], [0.12, 2200], [0.7, 650]], q: 0.9 }, e: [[0, 0], [0.08, 0.45], [0.72, 0]] });
        k.noise({ buf: "brown", filt: { t: "lowpass", f: [[0, 250], [0.15, 1000], [0.75, 350]] }, e: [[0, 0], [0.1, 0.8], [0.78, 0]], to: d });
        k.thump(0.02, 95, 40, 0.3, 0.4, d);
      },
    },
    heatWave: {
      gap: 0.25, max: 2, vary: 0.04, wet: 0.3, g: 0.55,
      fn(k) {
        const d = k.drive(2.5, 0.7);
        // a rumbling sub and a roaring low end
        k.osc({ f: [[0, 72], [1.2, 30]], e: [[0, 0], [0.04, 0.7], [1.25, 0]], am: { f: 9, d: 0.35 }, to: d });
        k.noise({ buf: "brown", filt: { t: "lowpass", f: [[0, 200], [0.3, 1400], [1.25, 220]], q: 2 }, e: [[0, 0], [0.08, 0.9], [1.3, 0]], to: d });
        // the wave rolling outwards across the stereo field
        [-0.6, 0.6].forEach((p, i) => k.noise({ at: i * 0.03, buf: "pink", filt: { t: "bandpass", f: [[0, 300], [0.5, 3200], [1.2, 900]], q: 1.2 }, e: [[0, 0], [0.15, 0.3], [1.2, 0]], to: k.pan(p) }));
        k.osc({ type: "sawtooth", f: [[0, 110], [1.1, 80]], det: 8, filt: { t: "lowpass", f: [[0, 300], [0.35, 1800], [1.2, 260]], q: 6 }, e: [[0, 0], [0.1, 0.12], [1.2, 0]] });
      },
    },

    // ---------------------------------------------------------- RONIN ---
    bladeSwing: {
      gap: 0.045, max: 3, vary: 0.07, wet: 0.05, g: 1.8,
      fn(k) {
        k.noise({ filt: { t: "bandpass", f: [[0, 1500], [0.07, 5200], [0.2, 2400]], q: 2.2 }, e: [[0, 0], [0.06, 0.55], [0.2, 0]] });
        k.noise({ buf: "pink", filt: { t: "bandpass", f: [[0, 600], [0.08, 1400], [0.2, 700]], q: 1 }, e: [[0, 0], [0.06, 0.25], [0.19, 0]] });
        k.osc({ f: 5400, e: [[0, 0], [0.06, 0.025], [0.22, 0]] }); // a glint of steel
        k.osc({ f: 7900, e: [[0, 0], [0.06, 0.015], [0.18, 0]] });
      },
    },
    bladeHeavy: {
      gap: 0.1, max: 2, vary: 0.04, wet: 0.22, g: 0.9,
      fn(k) {
        k.noise({ filt: { t: "bandpass", f: [[0, 900], [0.12, 4200], [0.34, 1400]], q: 1.6 }, e: [[0, 0], [0.11, 0.7], [0.34, 0]] });
        k.noise({ buf: "pink", filt: { t: "lowpass", f: [[0, 400], [0.12, 1600], [0.32, 300]] }, e: [[0, 0], [0.1, 0.45], [0.32, 0]] });
        k.thump(0.1, 130, 50, 0.25, 0.45);
        k.bell(0.1, 1180, [1, 2.76, 5.4, 8.93], [0.12, 0.07, 0.04, 0.02], 0.9); // the blade rings
      },
    },
    dash: {
      gap: 0.12, max: 2, vary: 0.04, wet: 0.15, g: 1.75,
      fn(k) {
        // the draw: steel scraping out of the saya
        k.noise({ filt: { t: "bandpass", f: [[0, 2800], [0.13, 7000]], q: 7 }, e: [[0, 0], [0.1, 0.35], [0.16, 0]] });
        k.osc({ f: [[0, 3100], [0.14, 4300]], e: [[0, 0], [0.1, 0.04], [0.16, 0]] });
        // the cut, the rush of air, the ring
        k.noise({ at: 0.13, filt: { t: "bandpass", f: [[0, 1200], [0.06, 6000], [0.22, 1900]], q: 2 }, e: [[0, 0], [0.05, 0.65], [0.23, 0]] });
        k.noise({ at: 0.11, buf: "pink", filt: { t: "lowpass", f: [[0, 600], [0.08, 2600], [0.32, 400]] }, e: [[0, 0], [0.07, 0.4], [0.33, 0]] });
        k.bell(0.16, 2350, [1, 2.76, 5.4], [0.05, 0.03, 0.015], 0.55);
      },
    },
    reflect: {
      gap: 0.05, max: 3, vary: 0.05, wet: 0.2, g: 1.9,
      fn(k) {
        const sweep = k.pan([[0, -0.35], [0.4, 0.35]]); // it flies off past you
        k.click(0, 0.3, 5000);
        // "pyeeuw": a bright FM ping that drops in pitch and loses its edge
        k.osc({ f: [[0, 4200], [0.04, 2900], [0.45, 2050]], fm: { f: [[0, 5900], [0.45, 2900]], d: [[0, 2600], [0.25, 60]] }, e: perc(0.2, 0.46), to: sweep });
        k.osc({ type: "triangle", f: [[0, 4240], [0.04, 2930], [0.45, 2070]], e: perc(0.07, 0.4), to: sweep });
        k.bell(0, 1650, [1, 2.4, 3.95], [0.07, 0.05, 0.03], 0.45);
        k.osc({ at: 0.09, f: [[0, 3000], [0.2, 2300]], e: perc(0.05, 0.22), to: sweep }); // a skip of the echo
      },
    },
    parry: {
      gap: 0.06, max: 3, vary: 0.04, wet: 0.25, g: 0.85,
      fn(k) {
        const d = k.drive(1.6, 0.8);
        k.noise({ filt: { t: "bandpass", f: 3200, q: 1.2 }, e: hit(0.7, 0.04) });
        k.bell(0, 520, [1, 1.47, 2.09, 2.56, 3.91, 5.3], [0.22, 0.16, 0.13, 0.09, 0.06, 0.04], 0.85, d);
        k.thump(0, 210, 90, 0.08, 0.3);
      },
    },

    // ------------------------------------------------------ HACKERMAN ---
    emDischarge: {
      gap: 0.1, max: 2, vary: 0.04, wet: 0.25, g: 1,
      fn(k) {
        // the zap: a sawtooth with a fast FM snarl diving down
        k.osc({ type: "sawtooth", f: [[0, 1400], [0.3, 90]], fm: { f: [[0, 230], [0.3, 40]], d: [[0, 900], [0.3, 60]] }, filt: { t: "lowpass", f: [[0, 6000], [0.35, 600]], q: 3 }, e: perc(0.22, 0.38, 0.004) });
        // the wave pulse: a resonant filter "wub" over a low square
        k.osc({ type: "square", f: 55, filt: { t: "lowpass", f: [[0, 180], [0.12, 2600], [0.5, 150]], q: 12 }, e: [[0, 0], [0.02, 0.22], [0.55, 0]] });
        k.noise({ buf: "crackle", filt: { t: "highpass", f: 2500 }, e: hit(0.7, 0.4) });
        k.thump(0, 120, 45, 0.25, 0.45);
      },
    },
    glitch: {
      gap: 0.08, max: 2, vary: 0.02, g: 0.47,
      fn(k) {
        const c = k.crush(4, 0.3);
        const notes = [784, 1175, 1568, 2093, 2637, 3136];
        for (let t = 0; t < 0.3; t += pick([0, 0.012, 0.03])) {
          const f = pick(notes);
          const len = pick([0.018, 0.026, 0.034]);
          const type = pick(["square", "sawtooth", "triangle"]);
          const reps = Math.random() < 0.35 ? 3 : 1; // a stutter
          for (let j = 0; j < reps; j++, t += len + 0.01) k.osc({ at: t, type, f, e: [[0, 0], [0.002, 0.8], [len, 0.6], [len + 0.004, 0]], to: c });
        }
        k.noise({ at: rnd(0, 0.12), filt: { t: "bandpass", f: 3500, q: 1.5 }, e: hit(0.7, 0.03), to: c });
      },
    },
    laptop: {
      gap: 0.12, max: 2, vary: 0.03, g: 1.8,
      fn(k) {
        const n = 4 + Math.floor(Math.random() * 3);
        for (let i = 0, t = 0; i < n; i++, t += rnd(0.045, 0.085)) {
          const v = rnd(0.5, 1);
          k.noise({ at: t, filt: { t: "bandpass", f: rnd(2200, 3800), q: 2.5 }, e: hit(0.3 * v, 0.02) }); // the keycap
          k.osc({ at: t, f: rnd(170, 230), e: perc(0.12 * v, 0.03, 0.001) }); // bottoming out
          k.noise({ at: t + rnd(0.025, 0.035), filt: { t: "bandpass", f: rnd(3000, 4500), q: 3 }, e: hit(0.1 * v, 0.012) }); // the release
        }
      },
    },
    dilationIn: {
      gap: 0.3, max: 1, vary: 0.02, wet: 0.35, g: 0.35,
      fn(k) {
        const d = k.drive(1.8, 0.8);
        k.click(0, 0.2, 2500);
        k.thump(0, 170, 38, 0.6, 0.5, d);
        k.osc({ f: [[0, 220], [0.9, 32]], e: [[0, 0], [0.02, 0.6], [0.6, 0.45], [1.25, 0]], to: d }); // the bass drop
        // the world winding down like a stopping tape
        [-12, 12].forEach((det) => k.osc({ type: "sawtooth", f: [[0, 294], [0.95, 73]], det, filt: { t: "lowpass", f: [[0, 3200], [0.95, 160]], q: 4 }, e: [[0, 0], [0.03, 0.09], [0.8, 0.05], [1.15, 0]] }));
        k.noise({ buf: "pink", filt: { t: "bandpass", f: [[0, 4200], [0.9, 180]], q: 1.4 }, e: [[0, 0], [0.05, 0.5], [0.5, 0.3], [1.1, 0]] });
      },
    },
    dilationOut: {
      gap: 0.3, max: 1, vary: 0.02, wet: 0.2, g: 1,
      fn(k) {
        // a reversed whoosh: it swells as the pitch climbs back to real time, then snaps
        k.noise({ buf: "pink", filt: { t: "bandpass", f: [[0, 200], [0.6, 5000]], q: 1.4 }, e: [[0, 0.002], [0.58, 0.5], [0.64, 0]] });
        [-12, 12].forEach((det) => k.osc({ type: "sawtooth", f: [[0, 73], [0.6, 294]], det, filt: { t: "lowpass", f: [[0, 160], [0.6, 3200]], q: 4 }, e: [[0, 0.001], [0.58, 0.1], [0.63, 0]] }));
        k.osc({ f: [[0, 38], [0.6, 150]], e: [[0, 0.002], [0.55, 0.4], [0.63, 0]] });
        k.click(0.6, 0.2, 3000);
      },
    },
    dilationLoop: {
      loop: true, len: 2.5, gap: 0.2, max: 1, vary: 0, wet: 0.15, g: 0.3,
      fn(k) {
        k.noise({ buf: "heart", offset: 0, filt: { t: "lowpass", f: 900 }, e: [[0, 0], [0.12, 0.85]] });
        // a low hum, beating slowly
        k.osc({ f: 55, e: [[0, 0], [0.5, 0.14]] });
        k.osc({ f: 55.7, e: [[0, 0], [0.5, 0.1]] });
        k.osc({ type: "triangle", f: 110, filt: { t: "lowpass", f: 260 }, e: [[0, 0], [0.6, 0.08]] });
        const air = k.noise({ buf: "pink", filt: { t: "bandpass", f: 320, q: 2 }, e: [[0, 0], [0.8, 0.05]] });
        k.lfo(air.g.gain, { f: 0.25, d: 0.03 });
      },
    },

    // -------------------------------------------- PICKUPS (XP hardware) ---
    pickupRam: {
      gap: 0.025, max: 5, vary: 0.012, wet: 0.1, g: 0.8,
      fn(k) {
        k.chime(0, 1760, 0.16, 0.22);
        k.chime(0.05, 2349, 0.16, 0.3);
      },
    },
    pickupSsd: {
      gap: 0.025, max: 5, vary: 0.012, wet: 0.1, g: 1.25,
      fn(k) {
        [1175, 1480, 1760].forEach((f, i) => k.osc({ at: i * 0.035, type: "square", f, filt: { t: "lowpass", f: f * 3 }, e: perc(0.09, 0.12, 0.003) }));
        k.chime(0.07, 3520, 0.06, 0.25);
      },
    },
    pickupCpu: {
      gap: 0.025, max: 5, vary: 0.012, wet: 0.15, g: 0.9,
      fn(k) {
        k.osc({ type: "triangle", f: [[0, 880], [0.08, 1760]], e: [[0, 0], [0.01, 0.1], [0.1, 0]] });
        [1760, 2217, 2637, 3520].forEach((f, i) => k.chime(0.05 + i * 0.035, f, 0.12, 0.32));
        k.noise({ at: 0.15, filt: { t: "highpass", f: 7000 }, e: [[0, 0], [0.02, 0.06], [0.25, 0]] }); // sparkle
      },
    },

    // ------------------------------------------------- BOSS: NULL ---
    // Hackerman's hijack (hijack.js): access granted...
    hijack: {
      gap: 0.12, max: 2, vary: 0.02, g: 1.1,
      fn(k) {
        const c = k.crush(5, 0.3);
        k.noise({ filt: { t: "bandpass", f: [[0, 900], [0.1, 5200]], q: 3 }, e: hit(0.4, 0.1), to: c }); // a modem chirp
        [72, 76, 79, 84].forEach((n, i) => k.osc({ at: 0.06 + i * 0.045, type: "square", f: midi(n), e: perc(0.5, 0.05), to: c }));
        k.osc({ at: 0.24, type: "triangle", f: midi(91), e: perc(0.35, 0.14) });
      },
    },
    // ...and the patch lands: back to its old side
    hijackEnd: {
      gap: 0.12, max: 2, vary: 0.02, g: 1,
      fn(k) {
        const c = k.crush(5, 0.3);
        [84, 79, 76, 72].forEach((n, i) => k.osc({ at: i * 0.04, type: "square", f: midi(n), e: perc(0.45, 0.04), to: c }));
        k.noise({ at: 0.17, filt: { t: "bandpass", f: 2200, q: 4 }, e: hit(0.3, 0.03), to: c });
        k.thump(0.18, 140, 60, 0.12, 0.35);
      },
    },
    nullBlink: {
      gap: 0.1, max: 2, vary: 0.04, wet: 0.15, g: 1.4,
      fn(k) {
        const c = k.crush(5, 0.35);
        // out...
        k.osc({ type: "sawtooth", f: [[0, 2600], [0.07, 110]], filt: { t: "bandpass", f: [[0, 3200], [0.07, 400]], q: 2 }, e: perc(0.9, 0.08), to: c });
        k.noise({ filt: { t: "bandpass", f: [[0, 6000], [0.08, 800]], q: 2 }, e: hit(0.35, 0.09) });
        // ...and back in somewhere else
        k.osc({ at: 0.12, type: "sawtooth", f: [[0, 110], [0.07, 2400]], filt: { t: "bandpass", f: [[0, 400], [0.07, 3200]], q: 2 }, e: [[0, 0], [0.065, 0.9], [0.08, 0]], to: c });
        k.noise({ at: 0.12, filt: { t: "bandpass", f: [[0, 800], [0.08, 6000]], q: 2 }, e: [[0, 0], [0.07, 0.35], [0.09, 0]] });
        k.thump(0.2, 160, 45, 0.16, 0.4);
        k.osc({ at: 0.2, type: "square", f: 3136, e: perc(0.04, 0.05) });
      },
    },
    nullDecoy: {
      gap: 0.15, max: 2, vary: 0.03, wet: 0.25, g: 3.5,
      fn(k) {
        // one flickering hologram splits into two copies drifting apart in pitch and stereo
        [[-0.75, 0.67], [0.75, 1.5]].forEach(([p, ratio]) => {
          const to = k.pan([[0, 0], [0.45, p]]);
          [-9, 9].forEach((det) => k.osc({ type: "sawtooth", f: [[0, 523], [0.08, 523], [0.5, 523 * ratio]], det, filt: { t: "bandpass", f: [[0, 1400], [0.5, 2600]], q: 3 }, e: [[0, 0], [0.04, 0.1], [0.4, 0.06], [0.55, 0]], am: { f: 26, d: 0.4 }, to }));
        });
        k.noise({ buf: "crackle", filt: { t: "highpass", f: 5000 }, e: [[0, 0], [0.03, 0.3], [0.4, 0]] });
        k.osc({ f: [[0, 2000], [0.04, 4000]], e: perc(0.05, 0.12) });
      },
    },
    nullSlash: {
      gap: 0.06, max: 3, vary: 0.06, wet: 0.12, g: 1.5,
      fn(k) {
        const c = k.crush(6, 0.25);
        k.noise({ filt: { t: "bandpass", f: [[0, 1500], [0.05, 7000], [0.22, 2500]], q: 2.5 }, e: [[0, 0], [0.04, 0.65], [0.24, 0]] });
        k.osc({ type: "sawtooth", f: [[0, 880], [0.16, 220]], filt: { t: "lowpass", f: 3000 }, e: perc(0.7, 0.18, 0.005), to: c }); // a corrupted edge
        k.osc({ f: [[0, 3300], [0.25, 2700]], e: [[0, 0], [0.04, 0.05], [0.3, 0]] });
        k.thump(0, 140, 50, 0.12, 0.35);
      },
    },
    nullShuriken: {
      gap: 0.05, max: 3, vary: 0.07, wet: 0.08, g: 3,
      fn(k) {
        k.click(0, 0.15, 3000); // the flick of the wrist
        // a spinning whoosh, with glints of the blades going round
        k.noise({ filt: { t: "bandpass", f: [[0, 2300], [0.1, 4800], [0.3, 1900]], q: 3 }, e: [[0, 0], [0.05, 0.6], [0.3, 0]], am: { f: 24, d: 0.45 } });
        k.osc({ f: [[0, 6200], [0.28, 5000]], e: [[0, 0], [0.01, 0.05], [0.26, 0]], am: { f: 24, d: 0.5, type: "square" } });
      },
    },
    nullCharge: {
      gap: 0.3, max: 2, vary: 0.02, wet: 0.15, g: 0.45,
      fn(k) {
        // rising, with a pulse that speeds up as the rail fills
        k.osc({ type: "sawtooth", f: [[0, 90], [0.95, 1100]], filt: { t: "lowpass", f: [[0, 300], [0.95, 5000]], q: 8 }, e: [[0, 0.002], [0.9, 0.2], [1, 0]], am: { f: [[0, 7], [0.95, 45]], d: 0.45 } });
        k.osc({ f: [[0, 1200], [0.95, 5200]], e: [[0, 0.001], [0.9, 0.05], [1, 0]] });
        k.noise({ buf: "crackle", filt: { t: "highpass", f: 3000 }, e: [[0, 0.002], [0.9, 0.4], [1, 0]] });
        k.osc({ f: [[0, 45], [0.95, 90]], e: [[0, 0], [0.3, 0.25], [0.95, 0.35], [1, 0]] });
      },
    },
    nullShot: {
      gap: 0.12, max: 2, vary: 0.03, wet: 0.3, g: 0.78,
      fn(k) {
        const d = k.drive(3, 0.6);
        k.noise({ filt: { t: "highpass", f: 2000 }, e: hit(0.7, 0.03) }); // the crack
        k.osc({ type: "sawtooth", f: [[0, 2800], [0.18, 160]], filt: { t: "lowpass", f: [[0, 8000], [0.2, 800]] }, e: perc(0.35, 0.22), to: d }); // the bolt
        k.osc({ f: [[0, 130], [0.6, 30]], e: perc(0.9, 0.7, 0.004), to: d }); // the boom
        k.noise({ buf: "pink", filt: { t: "lowpass", f: [[0, 5000], [0.8, 300]] }, e: [[0, 0], [0.01, 0.5], [0.9, 0]] });
        k.osc({ f: 1320, fm: { f: 1870, d: [[0, 1300], [0.6, 20]] }, e: perc(0.1, 0.85) }); // the rail rings
      },
    },
    nullDeath: {
      gap: 0.5, max: 1, steal: false, vary: 0.02, wet: 0.35, g: 0.68,
      fn(k) {
        const c = k.crush(5, 0.3);
        const d = k.drive(2.5, 0.6);
        // glitch stutters falling apart...
        for (let i = 0, f = 1900; i < 10; i++, f *= 0.82) k.osc({ at: i * 0.065, type: pick(["square", "sawtooth"]), f: f * rnd(0.92, 1.08), e: [[0, 0], [0.002, 0.8], [0.04, 0.6], [0.045, 0]], to: c });
        // ...while the whole rig powers down
        [-10, 10].forEach((det) => k.osc({ type: "sawtooth", f: [[0, 440], [1.4, 30]], det, filt: { t: "lowpass", f: [[0, 4000], [1.4, 120]], q: 6 }, e: [[0, 0], [0.02, 0.2], [1, 0.14], [1.5, 0]], to: d }));
        k.noise({ buf: "brown", filt: { t: "lowpass", f: [[0, 3000], [1, 150]] }, e: [[0, 0], [0.01, 0.8], [1.2, 0]], to: d });
        k.thump(0, 120, 30, 0.8, 0.6, d);
        k.osc({ at: 1.5, f: [[0, 1400], [0.15, 700]], e: perc(0.06, 0.2) }); // the last packet
      },
    },

    // -------------------------------------------------- GENERAL / UI ---
    bossIntro: {
      gap: 1, max: 1, steal: false, vary: 0.01, wet: 0.4, g: 0.8,
      fn(k) {
        const d = k.drive(2.2, 0.55);
        // BRAAAM: a detuned D power chord with a tritone, scooping into pitch as its filter opens
        [[38, -10], [38, 10], [45, -7], [45, 7], [50, 0], [56, 0]].forEach(([m, det], i) =>
          k.osc({ type: "sawtooth", f: [[0, midi(m) * 1.06], [0.12, midi(m)]], det, filt: { t: "lowpass", f: [[0, 180], [0.3, 1700], [2, 220]], q: 3 }, e: [[0, 0], [0.04, i === 5 ? 0.06 : 0.13], [1.3, 0.08], [2.1, 0]], to: d })
        );
        k.osc({ f: [[0, 80], [0.5, 37]], e: [[0, 0], [0.15, 0.45], [1.5, 0]] });
        k.noise({ buf: "pink", filt: { t: "lowpass", f: [[0, 7000], [0.7, 200]] }, e: hit(0.4, 0.8) });
        k.thump(0, 95, 30, 0.9, 0.45);
        k.bell(0.02, 1245, [1, 1.41, 2.76], [0.04, 0.03, 0.02], 1.4);
      },
    },
    bossDefeated: {
      gap: 1, max: 1, steal: false, vary: 0.01, wet: 0.4, g: 1.25,
      fn(k) {
        // a D major arpeggio resolving the soundtrack's D minor, then a bright held chord
        [62, 66, 69, 74].forEach((m, i) => [-6, 6].forEach((det) => k.osc({ at: i * 0.08, type: "sawtooth", f: midi(m), det, filt: { t: "lowpass", f: [[0, 4500], [0.4, 1200]], q: 2 }, e: [[0, 0], [0.005, 0.07], [0.25, 0.04], [1.6 - i * 0.08, 0]] })));
        [74, 78, 81, 86].forEach((m) => k.osc({ at: 0.32, type: "square", f: midi(m), filt: { t: "lowpass", f: 2600 }, e: [[0, 0], [0.02, 0.04], [0.6, 0.03], [1.6, 0]] }));
        k.chime(0.32, midi(86), 0.07, 1.2);
        k.chime(0.36, midi(90), 0.05, 1.2);
        k.thump(0, 110, 40, 0.6, 0.5);
        k.noise({ at: 0.3, filt: { t: "highpass", f: 6000 }, e: [[0, 0], [0.05, 0.05], [1, 0]] });
      },
    },
    reroll: {
      gap: 0.1, max: 2, vary: 0.03, g: 2.6,
      fn(k) {
        let t = 0;
        for (let i = 0; i < 8; i++, t += rnd(0.03, 0.055)) {
          k.noise({ at: t, filt: { t: "bandpass", f: rnd(1800, 4200), q: 6 }, e: hit(rnd(0.35, 0.6) * (1 - i / 12), 0.025) }); // dice rattling
          k.osc({ at: t, type: "square", f: midi(pick([74, 77, 79, 81, 84, 86])), filt: { t: "lowpass", f: 4000 }, e: perc(0.04, 0.03) }); // reels spinning
        }
        k.noise({ at: t + 0.03, filt: { t: "bandpass", f: 2400, q: 3 }, e: hit(0.5, 0.05) }); // and they settle
        k.osc({ at: t + 0.03, type: "triangle", f: 1175, e: perc(0.12, 0.16) });
      },
    },
    install: {
      gap: 0.2, max: 2, vary: 0.015, wet: 0.2, g: 1.15,
      fn(k) {
        // charging up with data chirps, then it locks in
        k.osc({ type: "sawtooth", f: [[0, 180], [0.32, 1400]], filt: { t: "lowpass", f: [[0, 600], [0.32, 5000]], q: 6 }, e: [[0, 0], [0.03, 0.07], [0.3, 0.1], [0.34, 0]] });
        for (let i = 0; i < 6; i++) k.osc({ at: 0.03 + i * 0.05, type: "square", f: rnd(2000, 4000), e: perc(0.03, 0.02) });
        [74, 81, 86].forEach((m) => k.osc({ at: 0.34, type: "square", f: midi(m), filt: { t: "lowpass", f: 3500 }, e: perc(0.06, 0.38, 0.004) }));
        k.thump(0.34, 160, 60, 0.15, 0.35);
        k.chime(0.34, midi(86), 0.07, 0.45);
      },
    },
    uiMove: {
      gap: 0.03, max: 2, vary: 0.015, g: 1.6,
      fn(k) {
        k.osc({ f: 2100, e: perc(0.09, 0.035) });
        k.noise({ filt: { t: "highpass", f: 6000 }, e: hit(0.035, 0.006) });
      },
    },
    uiSelect: {
      gap: 0.06, max: 2, vary: 0.01, wet: 0.05, g: 1.25,
      fn(k) {
        k.osc({ type: "square", f: 880, filt: { t: "lowpass", f: 3000 }, e: [[0, 0], [0.003, 0.08], [0.05, 0.05], [0.065, 0]] });
        k.osc({ at: 0.055, type: "square", f: 1319, filt: { t: "lowpass", f: 4000 }, e: perc(0.08, 0.15, 0.003) });
        k.osc({ at: 0.055, f: 2637, e: perc(0.03, 0.12) });
      },
    },
    uiBack: {
      gap: 0.06, max: 2, vary: 0.01, g: 1,
      fn(k) {
        k.osc({ type: "triangle", f: 1319, e: [[0, 0], [0.003, 0.14], [0.05, 0.09], [0.065, 0]] });
        k.osc({ at: 0.06, type: "triangle", f: [[0, 880], [0.12, 820]], e: perc(0.14, 0.13, 0.003) });
      },
    },
    padConnect: {
      gap: 0.3, max: 1, vary: 0.01, wet: 0.1, g: 0.9,
      fn(k) {
        k.click(0, 0.2, 2000); // plugged in
        k.thump(0, 240, 120, 0.05, 0.2);
        [[0.05, 1175], [0.12, 1760], [0.19, 2349]].forEach(([at, f]) => k.osc({ at, type: "square", f, filt: { t: "lowpass", f: 4500 }, e: [[0, 0], [0.003, 0.07], [0.06, 0.04], [0.22, 0]] }));
      },
    },
    lifeLost: {
      gap: 0.5, max: 1, steal: false, vary: 0.01, wet: 0.3, g: 1.25,
      fn(k) {
        // a stuttering power-down and a falling minor line
        k.osc({ type: "sawtooth", f: [[0, 880], [0.9, 70]], filt: { t: "lowpass", f: [[0, 5000], [0.9, 300]], q: 4 }, e: [[0, 0], [0.01, 0.15], [0.9, 0.06], [1, 0]], am: { f: [[0, 18], [0.9, 6]], d: 0.5 } });
        [81, 77, 74, 62].forEach((m, i) => k.osc({ at: 0.05 + i * 0.13, type: "square", f: midi(m), filt: { t: "lowpass", f: 2500 }, e: perc(0.06, i === 3 ? 0.5 : 0.12, 0.004) }));
        k.thump(0, 130, 40, 0.45, 0.4);
        k.noise({ buf: "pink", filt: { t: "lowpass", f: [[0, 3000], [0.6, 200]] }, e: hit(0.25, 0.6) });
      },
    },
    levelUp: {
      gap: 0.3, max: 1, vary: 0.01, wet: 0.25, g: 3.4,
      fn(k) {
        [62, 66, 69, 74, 78, 81].forEach((m, i) => k.osc({ at: i * 0.045, type: "square", f: midi(m), filt: { t: "lowpass", f: [[0, 5000], [0.3, 1500]] }, e: perc(0.07, 0.3, 0.003) }));
        k.noise({ buf: "pink", filt: { t: "bandpass", f: [[0, 800], [0.3, 6000]], q: 2 }, e: [[0, 0], [0.25, 0.15], [0.35, 0]] });
        k.chime(0.27, midi(86), 0.09, 0.55);
        k.chime(0.3, midi(93), 0.06, 0.5);
      },
    },
  };
  Object.keys(SOUNDS).forEach((name) => (SOUNDS[name] = Object.assign({ gap: 0.03, max: 4, vary: 0.03, wet: 0, g: 1, steal: true, loop: false, len: 2 }, SOUNDS[name])));

  const GROUPS = [
    ["CYBER WIDOW", ["bowDraw", "bowRelease", "arrowHit", "arrowPierce", "enemyFall", "fallThud", "bleed", "flameOn", "heatWave"]],
    ["RONIN", ["bladeSwing", "bladeHeavy", "dash", "reflect", "parry"]],
    ["HACKERMAN", ["emDischarge", "glitch", "laptop", "dilationIn", "dilationOut", "dilationLoop"]],
    ["PICKUPS", ["pickupRam", "pickupSsd", "pickupCpu"]],
    ["NULL", ["nullBlink", "nullDecoy", "nullSlash", "nullShuriken", "nullCharge", "nullShot", "nullDeath"]],
    ["GENERAL / UI", ["bossIntro", "bossDefeated", "reroll", "install", "uiMove", "uiSelect", "uiBack", "padConnect", "lifeLost", "levelUp"]],
  ];

  // --------------------------------------------------------------- Voices ---
  // Build one voice of a sound at time t0: sound -> voice gain (volume, fades)
  // -> pan -> output, plus a reverb send
  function voice(R, spec, opts, t0) {
    const ctx = R.ctx;
    opts = opts || {};
    const rate = clamp(num(opts.rate, 1), 0.25, 4) * (1 + (Math.random() * 2 - 1) * spec.vary);
    const vol = clamp(num(opts.volume, 1), 0, 2) * spec.g;
    const pan = clamp(num(opts.pan, 0), -1, 1);
    const vg = ctx.createGain();
    vg.gain.value = vol;
    if (pan && ctx.createStereoPanner) {
      const p = ctx.createStereoPanner();
      p.pan.value = pan;
      vg.connect(p);
      p.connect(R.out);
    } else vg.connect(R.out);
    if (spec.wet) {
      R.room();
      const send = ctx.createGain();
      send.gain.value = spec.wet;
      vg.connect(send);
      send.connect(R.verb);
    }
    const k = new Kit(R, t0, rate, vg, spec.loop);
    spec.fn(k);
    const v = { vg, vol, srcs: k.srcs, end: spec.loop ? Infinity : k.end, stopping: false };
    const done = spec.loop ? k.srcs[0] : k.last;
    if (done)
      done.onended = () => {
        vg.disconnect();
        if (v.onDone) v.onDone();
      };
    return v;
  }

  // Fade a voice out from time t and stop its sources
  function fadeOut(v, t, len) {
    if (v.stopping) return;
    v.stopping = true;
    const g = v.vg.gain;
    g.cancelScheduledValues(t);
    g.setValueAtTime(v.vol, t);
    g.linearRampToValueAtTime(0, t + len);
    v.srcs.forEach((s) => s.stop(Math.min(s.stopAt, t + len + 0.02)));
    v.end = Math.min(v.end, t + len + 0.02);
  }

  const live = Object.create(null); // name -> one-shot voices still ringing
  const loops = Object.create(null); // name -> the running loop voice
  const lastPlay = Object.create(null); // name -> when it last played (performance.now, s)
  const specOf = (name) => (typeof name === "string" && Object.prototype.hasOwnProperty.call(SOUNDS, name) ? SOUNDS[name] : null);

  // The live context's resources, or null while there is no running context
  function liveResources() {
    const ctx = SoundSystem.ctx;
    if (!ctx || ctx.state !== "running" || !SoundSystem.sfxBus) return null;
    return resources(ctx, SoundSystem.sfxBus);
  }

  function play(name, opts) {
    const spec = specOf(name);
    const R = spec && liveResources();
    if (!R) return false;
    if (SoundSystem.muted || SoundSystem.volume.sfx <= 0 || (opts && num(opts.volume, 1) <= 0)) return false; // nobody would hear it: skip the work
    const now = performance.now() / 1000;
    if (name in lastPlay && now - lastPlay[name] < spec.gap) return false;
    const t = R.ctx.currentTime;
    const list = (live[name] = (live[name] || []).filter((v) => v.end > t));
    if (list.length >= spec.max) {
      if (!spec.steal) return false;
      fadeOut(list.shift(), t, 0.03);
    }
    lastPlay[name] = now;
    const v = voice(R, spec, opts, t);
    if (spec.loop) fadeOut(v, t + spec.len, FADE); // a loop played as a one-shot: a taste of it
    v.onDone = () => {
      const ringing = live[name] || [];
      if (ringing.indexOf(v) >= 0) ringing.splice(ringing.indexOf(v), 1);
    };
    list.push(v);
    return true;
  }

  function loop(name, opts) {
    const spec = specOf(name);
    const R = spec && liveResources();
    if (!R) return false;
    if (!spec.loop) return play(name, opts); // a one-shot plays once (stop() can still cut it)
    if (loops[name]) return true;
    loops[name] = voice(R, spec, opts, R.ctx.currentTime);
    return true;
  }

  function stop(name) {
    const ctx = SoundSystem.ctx;
    if (!ctx) return false;
    const t = ctx.currentTime;
    const v = loops[name];
    delete loops[name];
    if (v) fadeOut(v, t, FADE);
    (live[name] || []).forEach((one) => fadeOut(one, t, FADE));
    live[name] = [];
    return !!v;
  }

  function voices(name) {
    const ctx = SoundSystem.ctx;
    const t = ctx ? ctx.currentTime : 0;
    return (live[name] || []).filter((v) => v.end > t).length + (loops[name] ? 1 : 0);
  }

  // Render one sound into an AudioBuffer (stereo, 44.1 kHz) without touching
  // the live context. A loop fades out at `stopAt`: by default 1.5 s before the
  // end, so its tail fits.
  function render(name, opts) {
    const spec = specOf(name);
    if (!spec || !Offline) return Promise.resolve(null);
    opts = opts || {};
    const sampleRate = num(opts.sampleRate, 44100);
    const seconds = num(opts.seconds, 3);
    const off = new Offline(2, Math.ceil(sampleRate * seconds), sampleRate);
    const R = resources(off, off.destination);
    const v = voice(R, spec, opts, 0);
    if (spec.loop) fadeOut(v, Math.max(0.05, num(opts.stopAt, seconds - 1.5)), FADE);
    return new Promise((resolve, reject) => {
      off.oncomplete = (e) => resolve(e.renderedBuffer);
      const p = off.startRendering();
      if (p && p.then) p.then(resolve, reject);
    });
  }

  // Never let a sound effect take the game down
  let warned = false;
  const safe = (fn) =>
    function () {
      try {
        return fn.apply(null, arguments);
      } catch (err) {
        if (!warned) console.warn("synth:", err);
        warned = true;
        return false;
      }
    };

  // Once audio unlocks, make the shared buffers one per tick, after the gesture
  // has been handled (a sound that needs one sooner makes it on the spot)
  let warmed = null;
  SoundSystem.onUnlock.push(
    safe(() => {
      const ctx = SoundSystem.ctx;
      if (!ctx || !SoundSystem.sfxBus || warmed === ctx) return;
      warmed = ctx;
      const R = resources(ctx, SoundSystem.sfxBus);
      const keys = Object.keys(BUFFERS);
      const step = safe(() => {
        const key = keys.shift();
        if (!key) return;
        if (key === "room") R.room();
        else R.buf(key);
        setTimeout(step, 0);
      });
      setTimeout(step, 0);
    })
  );

  const api = {
    play: safe(play),
    loop: safe(loop),
    stop: safe(stop),
    stopAll: safe(() => Object.keys(loops).concat(Object.keys(live)).forEach((name) => stop(name))),
    // For tests and tuning
    names: Object.keys(SOUNDS),
    groups: GROUPS,
    has: (name) => !!specOf(name),
    isLoop: (name) => !!(specOf(name) && specOf(name).loop),
    limits: (name) => (specOf(name) ? { gap: specOf(name).gap, max: specOf(name).max } : null),
    voices: safe(voices),
    render,
  };

  // ----------------------------------------------- ?sounds: the sound lab ---
  // A hidden tuning panel: a button for every sound, plus rate/volume/pan.
  function soundLab() {
    const el = (tag, css, text) => {
      const e = document.createElement(tag);
      if (css) e.style.cssText = css;
      if (text) e.textContent = text;
      return e;
    };
    const BTN = "font:inherit;color:#19f5ff;background:#1a0830;border:1px solid #ff2fd6;padding:3px 5px;cursor:pointer;";
    // the first click both unlocks audio and plays (the context may still be resuming)
    const withAudio = (fn) => {
      SoundSystem.unlock();
      const ctx = SoundSystem.ctx;
      if (ctx && ctx.state !== "running") ctx.resume().then(fn, () => {});
      else fn();
    };
    const box = el(
      "div",
      "position:fixed;top:6px;left:6px;z-index:9999;box-sizing:border-box;width:min(330px,calc(100vw - 12px));max-height:calc(100vh - 12px);overflow:auto;" +
        "padding:8px 10px;background:rgba(10,2,24,0.95);border:1px solid #19f5ff;box-shadow:0 0 14px rgba(255,47,214,0.55);color:#d8f8ff;font:11px/1.35 ui-monospace,Menlo,Consolas,monospace;"
    );
    box.id = "sound-lab";
    box.setAttribute("role", "region");
    box.setAttribute("aria-label", "Sound lab");
    const head = el("div", "display:flex;align-items:center;gap:6px;margin-bottom:6px;");
    head.append(el("b", "flex:1;color:#ff2fd6;letter-spacing:1px;", "SOUND LAB"));
    const all = el("button", BTN, "play all");
    const fold = el("button", BTN, "hide");
    head.append(all, fold);
    box.append(head);
    const body = el("div");
    box.append(body);
    fold.addEventListener("click", () => {
      body.hidden = !body.hidden;
      fold.textContent = body.hidden ? "show" : "hide";
    });

    const opts = { rate: 1, volume: 1, pan: 0 };
    [["rate", 0.5, 2, 0.05], ["volume", 0, 2, 0.05], ["pan", -1, 1, 0.1]].forEach(([key, min, max, step]) => {
      const row = el("label", "display:flex;align-items:center;gap:6px;margin:2px 0;");
      const input = el("input", "flex:1;min-width:0;");
      Object.assign(input, { type: "range", min, max, step, value: opts[key] });
      const out = el("span", "width:34px;text-align:right;", opts[key].toFixed(2));
      input.addEventListener("input", () => {
        opts[key] = Number(input.value);
        out.textContent = opts[key].toFixed(2);
      });
      row.append(el("span", "width:48px;", key), input, out);
      body.append(row);
    });

    const status = el("div", "margin-top:6px;color:#ff9b21;min-height:1.35em;");
    GROUPS.forEach(([title, names]) => {
      body.append(el("div", "margin:8px 0 3px;color:#ff9b21;letter-spacing:1px;", title));
      const wrap = el("div", "display:flex;flex-wrap:wrap;gap:3px;");
      names.forEach((name) => {
        const isLoop = SOUNDS[name].loop;
        const b = el("button", BTN, isLoop ? name + " (loop)" : name);
        b.type = "button";
        b.dataset.sound = name;
        if (isLoop) b.setAttribute("aria-pressed", "false");
        b.addEventListener("click", () =>
          withAudio(() => {
            if (!isLoop) {
              status.textContent = api.play(name, opts) ? "> " + name : name + ": throttled";
              return;
            }
            const on = b.getAttribute("aria-pressed") !== "true";
            if (on) api.loop(name, opts);
            else api.stop(name);
            b.setAttribute("aria-pressed", String(on));
            b.style.background = on ? "#5a0c4a" : "#1a0830";
            status.textContent = (on ? "> " : "stopped ") + name;
          })
        );
        wrap.append(b);
      });
      body.append(wrap);
    });
    body.append(status);

    // Play every sound in turn, each once the last one has finished
    let queue = null;
    all.addEventListener("click", () =>
      withAudio(() => {
        if (queue) {
          clearTimeout(queue.timer);
          queue = null;
          all.textContent = "play all";
          return;
        }
        queue = { names: api.names.slice() };
        all.textContent = "stop";
        const next = () => {
          const name = queue && queue.names.shift();
          if (!name) {
            queue = null;
            all.textContent = "play all";
            return;
          }
          api.play(name, opts);
          status.textContent = "> " + name;
          const ctx = SoundSystem.ctx;
          const list = live[name] || [];
          const v = list[list.length - 1];
          const left = v && ctx ? Math.min(3, v.end - ctx.currentTime) : 1;
          queue.timer = setTimeout(next, (Math.max(0.2, left) + 0.35) * 1000);
        };
        next();
      })
    );

    // Keep the game from reacting to clicks and keys in the panel
    ["pointerdown", "pointerup", "mousedown", "mouseup", "click", "touchstart", "touchend", "keydown", "keyup", "contextmenu", "wheel"].forEach((type) =>
      box.addEventListener(type, (e) => e.stopPropagation())
    );
    document.body.append(box);
  }
  if (/[?&]sounds\b/.test(location.search)) {
    if (document.body) soundLab();
    else addEventListener("DOMContentLoaded", soundLab);
  }

  return api;
})();
