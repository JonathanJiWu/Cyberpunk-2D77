"use strict";
// =============================================================================
// "Neon Inferno": an original synthwave soundtrack generated live with the
// Web Audio API (no audio file to download). 112 BPM, A minor:
//   drums (four-on-the-floor kick, big snare, hats), a pumping sawtooth bass,
//   a dotted-eighth-delayed 16th-note arpeggio and warm detuned pads.
// When the Demon Goat shows up the track kicks up a gear: a lead melody,
// busier hats, drum fills and a brighter filter.
// The first pass through the loop is a build-up without kick and snare.
// =============================================================================

const Synthwave = (() => {
  const BPM = 112;
  const STEP = 60 / BPM / 4; // one 16th note
  const BARS = 8;
  const midi = (m) => 440 * Math.pow(2, (m - 69) / 12);

  // 8-bar loop: Am F C G | Am F G E
  const CHORDS = [
    { root: 45, tones: [57, 60, 64] },
    { root: 41, tones: [53, 57, 60] },
    { root: 48, tones: [55, 60, 64] },
    { root: 43, tones: [55, 59, 62] },
    { root: 45, tones: [57, 60, 64] },
    { root: 41, tones: [53, 57, 60] },
    { root: 43, tones: [55, 59, 62] },
    { root: 40, tones: [56, 59, 64] },
  ];
  const BASS = [0, 0, 12, 0, 0, 12, 0, 12]; // per 8th note
  const ARP = [0, 1, 2, 3, 4, 5, 4, 3, 1, 2, 3, 4, 5, 4, 2, 1]; // per 16th
  // Boss lead melody, one row per bar, one entry per 8th note
  const LEAD = [
    [76, null, 72, null, 69, null, 72, 76],
    [77, null, 76, null, 72, null, 69, null],
    [79, null, 76, null, 72, null, 76, 79],
    [74, null, 79, null, 83, null, null, null],
    [81, null, 79, null, 76, null, 72, null],
    [77, null, 81, null, 84, null, 81, 77],
    [79, null, 83, null, 86, null, 83, 79],
    [80, null, 83, null, 88, null, null, null],
  ];

  let ctx = null;
  let bus, pump, delay, reverb, noiseBuf;
  let playing = false;
  let timer = null;
  let step = 0;
  let nextTime = 0;
  let intensity = 1;

  function build(c, destination) {
    ctx = c;
    bus = ctx.createGain();
    bus.gain.value = 0;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 4;
    bus.connect(comp);
    comp.connect(destination);

    // Pads and bass go through "pump", which ducks on every kick (sidechain feel)
    pump = ctx.createGain();
    pump.connect(bus);

    // Dotted-eighth echo for the arp and lead
    delay = ctx.createDelay(1);
    delay.delayTime.value = STEP * 3;
    const fb = ctx.createGain();
    fb.gain.value = 0.38;
    const tone = ctx.createBiquadFilter();
    tone.type = "lowpass";
    tone.frequency.value = 2200;
    delay.connect(tone);
    tone.connect(fb);
    fb.connect(delay);
    const wet = ctx.createGain();
    wet.gain.value = 0.55;
    tone.connect(wet);
    wet.connect(bus);

    // Big 80s reverb from a generated impulse response
    reverb = ctx.createConvolver();
    const len = Math.floor(ctx.sampleRate * 2.2);
    const ir = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = ir.getChannelData(ch);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3);
    }
    reverb.buffer = ir;
    const rv = ctx.createGain();
    rv.gain.value = 0.3;
    reverb.connect(rv);
    rv.connect(bus);

    noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const n = noiseBuf.getChannelData(0);
    for (let i = 0; i < n.length; i++) n[i] = Math.random() * 2 - 1;
  }

  // One enveloped oscillator, optionally low-pass filtered
  function voice({ type, freq, t, dur, vol, dest, attack = 0.005, release = 0.06, cutoff, q = 1, detune = 0 }) {
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
      f.frequency.value = cutoff;
      f.Q.value = q;
      o.connect(f);
      out = f;
    }
    out.connect(g);
    (Array.isArray(dest) ? dest : [dest]).forEach((d) => g.connect(d));
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  function noiseHit(t, { type, freq, q = 1, vol, decay, dest }) {
    const src = ctx.createBufferSource();
    src.buffer = noiseBuf;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + decay);
    src.connect(f);
    f.connect(g);
    (Array.isArray(dest) ? dest : [dest]).forEach((d) => g.connect(d));
    src.start(t, Math.random() * 0.5);
    src.stop(t + decay + 0.02);
  }

  function kick(t) {
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.frequency.setValueAtTime(150, t);
    o.frequency.exponentialRampToValueAtTime(42, t + 0.12);
    g.gain.setValueAtTime(0.95, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.42);
    o.connect(g);
    g.connect(bus);
    o.start(t);
    o.stop(t + 0.45);
    pump.gain.cancelScheduledValues(t);
    pump.gain.setValueAtTime(0.3, t);
    pump.gain.linearRampToValueAtTime(1, t + STEP * 3.2);
  }

  function snare(t, vol = 0.42) {
    noiseHit(t, { type: "bandpass", freq: 1800, q: 0.8, vol, decay: 0.24, dest: [bus, reverb] });
    voice({ type: "triangle", freq: 190, t, dur: 0.1, vol: vol * 0.6, dest: bus });
  }

  function hat(t, vol, open) {
    noiseHit(t, { type: "highpass", freq: 7500, vol, decay: open ? 0.16 : 0.04, dest: bus });
  }

  function scheduleStep(i, t) {
    const bar = Math.floor(i / 16) % BARS;
    const s = i % 16;
    const ch = CHORDS[bar];
    const boss = intensity >= 2;
    const intro = i < BARS * 16; // first time through: build-up, no kick/snare

    if (!intro && s % 4 === 0) kick(t);
    if (!intro && (s === 4 || s === 12)) snare(t);
    if (boss && bar === BARS - 1 && s >= 12) snare(t, 0.28); // fill into the loop
    if (s % 4 === 2) hat(t, 0.11, true);
    else if (boss || s % 2 === 0) hat(t, intro ? 0.03 : 0.05, false);

    if (s % 2 === 0) {
      const m = ch.root + BASS[s / 2];
      voice({ type: "sawtooth", freq: midi(m), t, dur: STEP * 1.7, vol: 0.3, dest: pump, cutoff: boss ? 1100 : 650, q: 5 });
      voice({ type: "square", freq: midi(m - 12), t, dur: STEP * 1.7, vol: 0.16, dest: pump, cutoff: 260 });
    }

    const tones = ch.tones.concat(ch.tones.map((m) => m + 12));
    voice({ type: "square", freq: midi(tones[ARP[s]]), t, dur: STEP * 0.85, vol: boss ? 0.06 : 0.05, dest: [bus, delay], cutoff: boss ? 3400 : 2400, release: 0.03 });

    if (s === 0) {
      ch.tones.forEach((m) =>
        [-9, 9].forEach((det) =>
          voice({ type: "sawtooth", freq: midi(m), t, dur: STEP * 16, vol: 0.028, dest: [pump, reverb], attack: 0.4, release: 0.45, cutoff: 1400, detune: det })
        )
      );
    }

    if (boss && s % 2 === 0) {
      const n = LEAD[bar][s / 2];
      if (n) {
        [-6, 6].forEach((det) =>
          voice({ type: "sawtooth", freq: midi(n), t, dur: STEP * 1.9, vol: 0.045, dest: [bus, delay, reverb], cutoff: 3600, detune: det, attack: 0.01 })
        );
      }
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
      bus.gain.setTargetAtTime(0.5, ctx.currentTime, 0.15);
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
      const saved = { ctx, bus, pump, delay, reverb, noiseBuf, step, nextTime, intensity };
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
      ({ ctx, bus, pump, delay, reverb, noiseBuf, step, nextTime, intensity } = saved);
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
