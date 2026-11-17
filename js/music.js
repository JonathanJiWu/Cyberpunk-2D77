"use strict";
// =============================================================================
// "Neon Inferno": an original darksynth soundtrack generated live with the
// Web Audio API (no audio file to download). 118 BPM, D minor:
//   a punchy distorted kick, snare + clap, 16th hats, a galloping distorted
//   "reese" bass, a resonant arpeggio whose filter sweeps over the loop, and
//   dark detuned pads.
// When the Demon Goat shows up it gets nastier: a distorted lead, brass stabs
// on the downbeats and a noise riser into every loop.
// The first pass through the loop is a build-up without kick and snare.
// =============================================================================

const Synthwave = (() => {
  const BPM = 118;
  const STEP = 60 / BPM / 4; // one 16th note
  const BARS = 8;
  const midi = (m) => 440 * Math.pow(2, (m - 69) / 12);

  // Dm Dm Bb C | Dm Bb Gm A
  const CHORDS = [
    { root: 38, tones: [62, 65, 69] },
    { root: 38, tones: [62, 65, 69] },
    { root: 34, tones: [58, 62, 65] },
    { root: 36, tones: [60, 64, 67] },
    { root: 38, tones: [62, 65, 69] },
    { root: 34, tones: [58, 62, 65] },
    { root: 43, tones: [55, 58, 62] },
    { root: 33, tones: [57, 61, 64] },
  ];
  const BASS = [0, 0, 0, 12, 0, 0, 0, 12, 0, 0, 0, 12, 0, 0, 7, 12]; // galloping 16ths
  const ACCENT = [1, 0, 0, 0.6, 0.8, 0, 0, 0.6, 1, 0, 0, 0.6, 0.8, 0, 0.5, 0.7];
  const ARP = [0, 1, 2, 3, 4, 5, 4, 3, 1, 2, 3, 4, 5, 4, 2, 1];
  // Boss lead, one row per bar, one entry per 8th note
  const LEAD = [
    [74, null, 77, null, 81, null, 77, 74],
    [86, null, 84, null, 81, null, 77, null],
    [82, null, 81, null, 77, null, 74, null],
    [79, null, 76, null, 79, 81, 84, null],
    [81, null, 77, null, 74, null, 77, 81],
    [82, null, null, 81, 82, null, 86, null],
    [79, null, 82, null, 86, null, 82, 79],
    [81, null, 85, null, 88, null, 85, null],
  ];

  let ctx = null;
  let bus, pump, dirt, crunch, delay, reverb, noiseBuf;
  let playing = false;
  let timer = null;
  let step = 0;
  let nextTime = 0;
  let intensity = 1;

  function shaper(amount) {
    const ws = ctx.createWaveShaper();
    const n = 1024;
    const curve = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const x = (i / (n - 1)) * 2 - 1;
      curve[i] = Math.tanh(amount * x) / Math.tanh(amount);
    }
    ws.curve = curve;
    ws.oversample = "2x";
    return ws;
  }

  function build(c, destination) {
    ctx = c;
    bus = ctx.createGain();
    bus.gain.value = 0;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -16;
    comp.ratio.value = 5;
    comp.attack.value = 0.004;
    comp.release.value = 0.12;
    bus.connect(comp);
    comp.connect(destination);

    // Pads and bass go through "pump", which ducks on every kick
    pump = ctx.createGain();
    pump.connect(bus);

    // A little grit on the kick
    crunch = shaper(2);
    crunch.connect(bus);

    // Distortion bus for the bass and the boss lead
    dirt = shaper(3.2);
    const dirtTone = ctx.createBiquadFilter();
    dirtTone.type = "lowpass";
    dirtTone.frequency.value = 3800;
    const dirtOut = ctx.createGain();
    dirtOut.gain.value = 0.55;
    dirt.connect(dirtTone);
    dirtTone.connect(dirtOut);
    dirtOut.connect(pump);

    // Dotted-eighth echo
    delay = ctx.createDelay(1);
    delay.delayTime.value = STEP * 3;
    const fb = ctx.createGain();
    fb.gain.value = 0.36;
    const tone = ctx.createBiquadFilter();
    tone.type = "lowpass";
    tone.frequency.value = 2400;
    delay.connect(tone);
    tone.connect(fb);
    fb.connect(delay);
    const wet = ctx.createGain();
    wet.gain.value = 0.5;
    tone.connect(wet);
    wet.connect(bus);

    // Big dark reverb from a generated impulse response
    reverb = ctx.createConvolver();
    const len = Math.floor(ctx.sampleRate * 2.4);
    const ir = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = ir.getChannelData(ch);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.6);
    }
    reverb.buffer = ir;
    const rv = ctx.createGain();
    rv.gain.value = 0.28;
    reverb.connect(rv);
    rv.connect(bus);

    noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const n = noiseBuf.getChannelData(0);
    for (let i = 0; i < n.length; i++) n[i] = Math.random() * 2 - 1;
  }

  // One enveloped oscillator, optionally low-pass filtered (with a filter
  // envelope from `cutoff` down to `cutoffEnd`)
  function voice({ type, freq, t, dur, vol, dest, attack = 0.004, release = 0.05, cutoff, cutoffEnd, q = 1, detune = 0 }) {
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    o.detune.value = detune;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + attack);
    g.gain.setValueAtTime(vol, t + Math.max(attack, dur - release));
    g.gain.linearRampToValueAtTime(0, t + dur);
    let out = o;
    if (cutoff) {
      const f = ctx.createBiquadFilter();
      f.type = "lowpass";
      f.frequency.setValueAtTime(cutoff, t);
      if (cutoffEnd) f.frequency.exponentialRampToValueAtTime(cutoffEnd, t + dur);
      f.Q.value = q;
      o.connect(f);
      out = f;
    }
    out.connect(g);
    (Array.isArray(dest) ? dest : [dest]).forEach((d) => g.connect(d));
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  function noiseHit(t, { type, freq, q = 1, vol, decay, dest, sweepTo }) {
    const src = ctx.createBufferSource();
    src.buffer = noiseBuf;
    src.loop = decay > 0.9;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.setValueAtTime(freq, t);
    if (sweepTo) f.frequency.exponentialRampToValueAtTime(sweepTo, t + decay);
    f.Q.value = q;
    const g = ctx.createGain();
    if (sweepTo) {
      // risers fade in
      g.gain.setValueAtTime(0.001, t);
      g.gain.exponentialRampToValueAtTime(vol, t + decay * 0.95);
      g.gain.linearRampToValueAtTime(0, t + decay);
    } else {
      g.gain.setValueAtTime(vol, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + decay);
    }
    src.connect(f);
    f.connect(g);
    (Array.isArray(dest) ? dest : [dest]).forEach((d) => g.connect(d));
    src.start(t, src.loop ? 0 : Math.random() * 0.5);
    src.stop(t + decay + 0.02);
  }

  function kick(t) {
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.frequency.setValueAtTime(170, t);
    o.frequency.exponentialRampToValueAtTime(40, t + 0.11);
    g.gain.setValueAtTime(1, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.38);
    o.connect(g);
    g.connect(crunch);
    o.start(t);
    o.stop(t + 0.4);
    noiseHit(t, { type: "highpass", freq: 3000, vol: 0.18, decay: 0.012, dest: bus }); // click
    pump.gain.cancelScheduledValues(t);
    pump.gain.setValueAtTime(0.25, t);
    pump.gain.linearRampToValueAtTime(1, t + STEP * 3);
  }

  function snare(t, vol = 0.42) {
    noiseHit(t, { type: "bandpass", freq: 1900, q: 0.9, vol, decay: 0.22, dest: [bus, reverb] });
    voice({ type: "triangle", freq: 200, t, dur: 0.09, vol: vol * 0.6, dest: bus });
    // clap: three quick bursts
    [0, 0.011, 0.022].forEach((o) => noiseHit(t + o, { type: "bandpass", freq: 1200, q: 1.4, vol: vol * 0.5, decay: 0.05, dest: [bus, reverb] }));
  }

  function hat(t, vol, open) {
    noiseHit(t, { type: "highpass", freq: 8000, vol, decay: open ? 0.15 : 0.03, dest: bus });
  }

  function scheduleStep(i, t) {
    const bar = Math.floor(i / 16) % BARS;
    const s = i % 16;
    const ch = CHORDS[bar];
    const boss = intensity >= 2;
    const intro = i < BARS * 16; // first time through: build-up, no kick/snare
    const sweep = 0.5 + 0.5 * Math.sin(((i % (BARS * 16)) / (BARS * 16)) * Math.PI * 2 - Math.PI / 2);

    if (!intro && s % 4 === 0) kick(t);
    if (!intro && (s === 4 || s === 12)) snare(t);
    if (bar === BARS - 1 && s >= 12 && (boss || !intro)) snare(t, 0.26); // fill into the loop
    if (s % 4 === 2) hat(t, 0.1, true);
    else hat(t, (s % 2 === 0 ? 0.06 : 0.035) * (intro ? 0.6 : 1), false);

    // Galloping distorted reese bass
    const m = ch.root + BASS[s];
    const acc = ACCENT[s];
    [-14, 14].forEach((det) =>
      voice({
        type: "sawtooth",
        freq: midi(m),
        t,
        dur: STEP * 0.85,
        vol: 0.16 + acc * 0.08,
        dest: dirt,
        cutoff: (boss ? 1500 : 900) + acc * 900,
        cutoffEnd: 180,
        q: 6,
        detune: det,
      })
    );
    if (s % 4 === 0) voice({ type: "sine", freq: midi(ch.root - 12), t, dur: STEP * 3.6, vol: 0.32, dest: pump }); // sub

    // Resonant arp, its filter sweeping over the loop
    const tones = ch.tones.concat(ch.tones.map((n) => n + 12));
    voice({
      type: "sawtooth",
      freq: midi(tones[ARP[s]]),
      t,
      dur: STEP * 0.8,
      vol: boss ? 0.055 : 0.045,
      dest: [bus, delay],
      cutoff: 900 + sweep * (boss ? 4200 : 3000),
      cutoffEnd: 500,
      q: 9,
    });

    // Dark pads
    if (s === 0) {
      ch.tones.forEach((n) =>
        [-11, 11].forEach((det) =>
          voice({ type: "sawtooth", freq: midi(n - 12), t, dur: STEP * 16, vol: 0.022, dest: [pump, reverb], attack: 0.5, release: 0.5, cutoff: 900, detune: det })
        )
      );
    }

    if (boss) {
      // Brass stab on every downbeat
      if (s === 0 || s === 10) {
        ch.tones.forEach((n) => voice({ type: "sawtooth", freq: midi(n), t, dur: STEP * 1.6, vol: 0.05, dest: [dirt, reverb], cutoff: 2600, cutoffEnd: 600, q: 2 }));
      }
      // Distorted lead
      if (s % 2 === 0) {
        const n = LEAD[bar][s / 2];
        if (n) {
          voice({ type: "square", freq: midi(n), t, dur: STEP * 1.9, vol: 0.05, dest: [dirt, delay], cutoff: 3200, q: 1 });
          voice({ type: "sawtooth", freq: midi(n - 12), t, dur: STEP * 1.9, vol: 0.03, dest: [dirt, reverb], cutoff: 2400, detune: 8 });
        }
      }
      // Noise riser into the next loop
      if (bar === BARS - 1 && s === 0) noiseHit(t, { type: "bandpass", freq: 400, q: 2, vol: 0.12, decay: STEP * 16, dest: [bus, reverb], sweepTo: 6000 });
    }
  }

  function tick() {
    while (nextTime < ctx.currentTime + 0.14) {
      scheduleStep(step, nextTime);
      nextTime += STEP;
      step++;
    }
  }

  return {
    available: () => !!AudioCtor,
    // Returns false if Web Audio isn't available (caller falls back to the mp3)
    start(fromTop) {
      if (!SoundSystem.ctx) return false;
      if (!ctx) build(SoundSystem.ctx, SoundSystem.master);
      if (fromTop) step = 0;
      if (playing) return true;
      playing = true;
      nextTime = ctx.currentTime + 0.08;
      bus.gain.cancelScheduledValues(ctx.currentTime);
      bus.gain.setTargetAtTime(0.42, ctx.currentTime, 0.15);
      tick();
      timer = setInterval(tick, 25);
      return true;
    },
    stop() {
      if (!playing) return;
      playing = false;
      clearInterval(timer);
      bus.gain.cancelScheduledValues(ctx.currentTime);
      bus.gain.setTargetAtTime(0, ctx.currentTime, 0.06);
    },
    setIntensity(n) {
      intensity = n;
    },
    // Render a stretch of the main loop (after the intro) into an AudioBuffer,
    // e.g. to export a preview. Doesn't touch the live soundtrack.
    renderPreview(seconds, boss) {
      const saved = { ctx, bus, pump, dirt, crunch, delay, reverb, noiseBuf, step, nextTime, intensity };
      const Offline = window.OfflineAudioContext || window.webkitOfflineAudioContext;
      const off = new Offline(2, Math.ceil(44100 * seconds), 44100);
      build(off, off.destination);
      bus.gain.value = 0.5;
      step = BARS * 16;
      nextTime = 0.05;
      intensity = boss ? 2 : 1;
      while (nextTime < seconds) {
        scheduleStep(step, nextTime);
        nextTime += STEP;
        step++;
      }
      ({ ctx, bus, pump, dirt, crunch, delay, reverb, noiseBuf, step, nextTime, intensity } = saved);
      return off.startRendering();
    },
  };
})();

// Which soundtrack plays: the synthwave one (default) or the original mp3
const music = {
  style: "synthwave",
  play(fromTop) {
    if (this.style === "synthwave" && Synthwave.start(fromTop)) {
      classicMusic.pause();
      return;
    }
    classicMusic.play();
  },
  pause() {
    Synthwave.stop();
    classicMusic.pause();
  },
  setIntensity(n) {
    Synthwave.setIntensity(n);
  },
  setStyle(style) {
    this.style = style;
    document.querySelectorAll("[data-music]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.music === style)));
    try {
      localStorage.setItem("cp2d77-music", style);
    } catch (err) {
      /* storage unavailable */
    }
  },
};

try {
  if (localStorage.getItem("cp2d77-music") === "classic") music.style = "classic";
} catch (err) {
  /* storage unavailable */
}
music.setStyle(Synthwave.available() ? music.style : "classic");
document.querySelectorAll("[data-music]").forEach((b) =>
  b.addEventListener("click", () => {
    SoundSystem.unlock();
    music.setStyle(b.dataset.music);
    // Switch right away if a run is in progress (paused)
    if (game.state === "playing" || game.state === "paused") {
      music.pause();
      if (game.state === "playing") music.play();
    }
  })
);
