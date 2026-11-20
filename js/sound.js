// =============================================================================
// Sound system
// -----------------------------------------------------------------------------
// Sound effects use the Web Audio API when it is available: it has low latency,
// lets the same effect overlap with itself (rapid fire, multiple hits) and works
// on iOS/Android once it has been "unlocked" by a tap. When Web Audio can't be
// used (old browsers, or the game opened straight from file:// where fetch() is
// blocked) we fall back to a small pool of <audio> elements.
//
// Routing:  music -> musicBus \
//                              master (mute) -> speakers
//           effects -> sfxBus /
// Browsers only let an AudioContext run after a user gesture, so SoundSystem
// unlocks (creates or resumes) it on every click, tap and key press, and again
// when the tab comes back into view.
// =============================================================================
const AudioCtor = window.AudioContext || window.webkitAudioContext;
const canFetchAudio = !!AudioCtor && location.protocol !== "file:";

const SoundSystem = {
  ctx: null,
  master: null, // mute
  musicBus: null, // music volume
  sfxBus: null, // sound-effect volume
  failed: false, // Web Audio could not start: everything uses <audio> elements
  muted: false,
  autoplay: !!(window.desktop && window.desktop.autoplay), // the desktop app: audio may start without a gesture
  volume: { music: 1, sfx: 1 }, // slider positions, 0..1
  sounds: [],
  elements: [], // every <audio> element, for mute
  onUnlock: [], // run after each unlock (music.js restarts the soundtrack if it should be playing)

  // Call from a user gesture (tap / click / key press). Safe to call often.
  unlock() {
    if (!AudioCtor || this.failed) return;
    if (!this.ctx) {
      // Before the page's first real gesture Chrome would only give us a
      // context stuck in "suspended" (and a console warning): wait for one.
      const ua = navigator.userActivation;
      if (ua && !ua.hasBeenActive && !this.autoplay) return;
      try {
        this.ctx = new AudioCtor();
        this.master = this.ctx.createGain();
        this.master.connect(this.ctx.destination);
        this.musicBus = this.ctx.createGain();
        this.musicBus.connect(this.master);
        this.sfxBus = this.ctx.createGain();
        this.sfxBus.connect(this.master);
        this.master.gain.value = this.muted ? 0 : 1;
        this.musicBus.gain.value = this.level("music");
        this.sfxBus.gain.value = this.level("sfx");
      } catch (err) {
        console.warn("Web Audio unavailable, falling back to <audio>:", err);
        this.ctx = null;
        this.failed = true;
        return;
      }
      // iOS: let Web Audio play even when the ring/silent switch is on
      try {
        if (navigator.audioSession && navigator.audioSession.type === "auto") navigator.audioSession.type = "playback";
      } catch (err) {
        /* not supported */
      }
      this.sounds.forEach((s) => s.decode());
    }
    this.resume(true);
    this.onUnlock.forEach((fn) => fn());
  },

  // Resume a context the browser left "suspended" (or iOS "interrupted").
  resume(inGesture) {
    const ctx = this.ctx;
    if (!ctx || ctx.state === "running" || ctx.state === "closed") return;
    const p = ctx.resume();
    if (p && p.catch) p.catch((err) => console.warn("AudioContext.resume() failed:", err));
    if (inGesture) {
      // Older iOS only unlocks once something actually plays inside the gesture
      try {
        const src = ctx.createBufferSource();
        src.buffer = ctx.createBuffer(1, 1, ctx.sampleRate);
        src.connect(ctx.destination);
        src.start(0);
      } catch (err) {
        /* ignore */
      }
    }
  },

  // Perceived loudness: a squared curve, so 50% sounds about half as loud
  level(kind) {
    const v = this.volume[kind];
    return v * v;
  },

  // music and sfx are 0..1 (the settings sliders / 100)
  setVolume(music, sfx) {
    this.volume.music = Math.max(0, Math.min(1, Number(music) || 0));
    this.volume.sfx = Math.max(0, Math.min(1, Number(sfx) || 0));
    if (this.ctx) {
      this.setGain(this.musicBus.gain, this.level("music"));
      this.setGain(this.sfxBus.gain, this.level("sfx"));
    }
    if (classicMusic.el) classicMusic.el.volume = classicMusic.volume * this.level("music");
  },

  setMuted(muted) {
    this.muted = muted;
    if (this.master) this.setGain(this.master.gain, muted ? 0 : 1, 0.005);
    this.elements.forEach((el) => (el.muted = muted));
    document.documentElement.classList.toggle("sound-muted", muted);
  },

  // Glide to a new gain (no clicks while dragging a slider)
  setGain(param, value, glide = 0.02) {
    const now = this.ctx.currentTime;
    param.cancelScheduledValues(now);
    if (this.ctx.state === "running") param.setTargetAtTime(value, now, glide);
    else param.value = value; // a stopped clock would never reach the target
  },

  trackElement(el) {
    el.muted = this.muted;
    this.elements.push(el);
    return el;
  },
};

// Unlock on whatever the player does first (capture phase: before the game's
// own handlers, so the context exists by the time startGame() plays music).
["pointerdown", "pointerup", "touchend", "mousedown", "keydown", "click"].forEach((type) =>
  addEventListener(type, () => SoundSystem.unlock(), { capture: true, passive: true })
);
// A backgrounded tab can get its context suspended; pick it back up.
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) SoundSystem.resume(false);
});
addEventListener("pageshow", () => SoundSystem.resume(false));

function Sound(src, { volume = 1, minGap = 0, pool = 3 } = {}) {
  this.src = src;
  this.volume = volume;
  this.minGap = minGap; // seconds; stops the same effect from stacking up every frame
  this.poolSize = pool;
  this.pool = null;
  this.poolIndex = 0;
  this.data = null;
  this.buffer = null;
  this.lastPlay = -Infinity;
  this.loopSource = null;
  this.loopElement = null;
  SoundSystem.sounds.push(this);
  if (canFetchAudio) {
    fetchAudio(src)
      .then((data) => {
        this.data = data.slice(0); // decodeAudioData consumes its buffer
        this.decode();
      })
      .catch((err) => console.warn(`Could not load ${src} (${err}), using <audio> instead`));
  }
}

// Several effects reuse the same file (pitched differently): download it once.
const audioFetches = {};
function fetchAudio(src) {
  if (!audioFetches[src]) {
    audioFetches[src] = fetch(src).then((res) => (res.ok ? res.arrayBuffer() : Promise.reject(res.status)));
  }
  return audioFetches[src];
}

Sound.prototype.decode = function () {
  const ctx = SoundSystem.ctx;
  if (!ctx || !this.data || this.buffer) return;
  const data = this.data;
  this.data = null;
  const failed = (err) => console.warn(`Could not decode ${this.src} (${err}), using <audio> instead`);
  try {
    // Older Safari only supports the callback form of decodeAudioData.
    const p = ctx.decodeAudioData(data, (buffer) => (this.buffer = buffer), failed);
    if (p && p.catch) p.catch(() => {}); // already reported by the callback
  } catch (err) {
    failed(err);
  }
};

Sound.prototype.element = function () {
  if (!this.pool) {
    this.pool = [];
    for (let i = 0; i < this.poolSize; i++) {
      const el = new Audio(this.src);
      el.preload = "auto";
      this.pool.push(SoundSystem.trackElement(el));
    }
  }
  const el = this.pool[this.poolIndex];
  this.poolIndex = (this.poolIndex + 1) % this.pool.length;
  return el;
};

// play({ volume, rate }) – rate < 1 pitches the sound down.
Sound.prototype.play = function ({ volume = 1, rate = 1 } = {}) {
  const now = performance.now() / 1000;
  if (now - this.lastPlay < this.minGap) return;
  this.lastPlay = now;
  const vol = this.volume * volume;
  const ctx = SoundSystem.ctx;
  if (ctx && this.buffer) {
    const source = ctx.createBufferSource();
    const gain = ctx.createGain();
    source.buffer = this.buffer;
    source.playbackRate.value = rate;
    gain.gain.value = vol;
    source.connect(gain);
    gain.connect(SoundSystem.sfxBus);
    source.start();
    return;
  }
  const el = this.element();
  try {
    el.currentTime = 0;
  } catch (err) {
    /* not seekable yet */
  }
  el.volume = Math.min(1, vol * SoundSystem.level("sfx"));
  el.playbackRate = rate;
  if ("preservesPitch" in el) el.preservesPitch = false;
  const p = el.play();
  if (p && p.catch) p.catch(() => {});
};

// Looping playback (used for the flame while the attack is held).
Sound.prototype.startLoop = function () {
  if (this.loopSource || this.loopElement) return;
  const ctx = SoundSystem.ctx;
  if (ctx && this.buffer) {
    const source = ctx.createBufferSource();
    const gain = ctx.createGain();
    source.buffer = this.buffer;
    source.loop = true;
    gain.gain.value = this.volume;
    source.connect(gain);
    gain.connect(SoundSystem.sfxBus);
    source.start();
    this.loopSource = source;
    return;
  }
  const el = this.element();
  el.loop = true;
  el.volume = Math.min(1, this.volume * SoundSystem.level("sfx"));
  try {
    el.currentTime = 0;
  } catch (err) {
    /* not seekable yet */
  }
  const p = el.play();
  if (p && p.catch) p.catch(() => {});
  this.loopElement = el;
};

Sound.prototype.stopLoop = function () {
  if (this.loopSource) {
    try {
      this.loopSource.stop();
    } catch (err) {
      /* already stopped */
    }
    this.loopSource = null;
  }
  if (this.loopElement) {
    this.loopElement.pause();
    this.loopElement.loop = false;
    this.loopElement = null;
  }
};

// The original soundtrack streams through a single <audio> element (the file
// is big, so it is only downloaded once it actually plays). The default
// synthwave soundtrack is generated live in js/music.js.
const classicMusic = {
  el: null,
  volume: 0.35,
  play() {
    if (!this.el) {
      this.el = SoundSystem.trackElement(new Audio("sound/Disconnected.mp3"));
      this.el.loop = true;
    }
    this.el.volume = this.volume * SoundSystem.level("music");
    const p = this.el.play();
    // Blocked until the page gets a gesture: music.js retries on the next one
    if (p && p.catch) p.catch(() => {});
  },
  pause() {
    if (this.el) this.el.pause();
  },
};

const sfx = {
  energy: new Sound("sound/energy.wav", { volume: 0.5, minGap: 0.05, pool: 4 }),
  enemyShot: new Sound("sound/energy.wav", { volume: 0.35, minGap: 0.12, pool: 3 }),
  zapHit: new Sound("sound/hit2.wav", { volume: 0.45, minGap: 0.06, pool: 4 }),
  burn: new Sound("sound/hit.wav", { volume: 0.4, minGap: 0.35 }),
  damage: new Sound("sound/damage.wav", { volume: 0.8, minGap: 0.1 }),
  kill: new Sound("sound/hit2.wav", { volume: 0.4, minGap: 0.05, pool: 4 }),
  pickup: new Sound("sound/energy.wav", { volume: 0.22, minGap: 0.045, pool: 4 }),
  powerup: new Sound("sound/energy.wav", { volume: 0.6, pool: 2 }),
  levelUp: new Sound("sound/hit.wav", { volume: 0.6, pool: 1 }),
  stomp: new Sound("sound/damage.wav", { volume: 0.55, minGap: 0.1 }),
  missile: new Sound("sound/energy.wav", { volume: 0.3, minGap: 0.08, pool: 3 }),
  chain: new Sound("sound/hit2.wav", { volume: 0.35, minGap: 0.1, pool: 2 }),
  crate: new Sound("sound/hit.wav", { volume: 0.5, minGap: 0.1 }),
  gameOver: new Sound("sound/gameover.wav", { volume: 0.8, pool: 1 }),
};
