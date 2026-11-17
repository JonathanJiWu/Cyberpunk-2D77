// =============================================================================
// Sound system
// -----------------------------------------------------------------------------
// Sound effects use the Web Audio API when it is available: it has low latency,
// lets the same effect overlap with itself (rapid fire, multiple hits) and works
// on iOS/Android once it has been "unlocked" by a tap. When Web Audio can't be
// used (old browsers, or the game opened straight from file:// where fetch() is
// blocked) we fall back to a small pool of <audio> elements.
// =============================================================================
const AudioCtor = window.AudioContext || window.webkitAudioContext;
const canFetchAudio = !!AudioCtor && location.protocol !== "file:";

const SoundSystem = {
  ctx: null,
  master: null,
  muted: false,
  sounds: [],
  elements: [],

  // Must be called from a user gesture (tap / click / key press) at least once.
  unlock() {
    if (!AudioCtor) return;
    if (!this.ctx) {
      try {
        this.ctx = new AudioCtor();
        this.master = this.ctx.createGain();
        this.master.gain.value = this.muted ? 0 : 1;
        this.master.connect(this.ctx.destination);
      } catch (err) {
        this.ctx = null;
        return;
      }
      this.sounds.forEach((s) => s.decode());
    }
    if (this.ctx.state === "suspended") this.ctx.resume().catch(() => {});
  },

  setMuted(muted) {
    this.muted = muted;
    if (this.master) this.master.gain.value = muted ? 0 : 1;
    this.elements.forEach((el) => (el.muted = muted));
  },

  trackElement(el) {
    el.muted = this.muted;
    this.elements.push(el);
    return el;
  },
};

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
      .catch(() => {});
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
  try {
    // Older Safari only supports the callback form of decodeAudioData.
    const p = ctx.decodeAudioData(data, (buffer) => (this.buffer = buffer), () => {});
    if (p && p.catch) p.catch(() => {});
  } catch (err) {
    /* fall back to <audio> */
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
    gain.connect(SoundSystem.master);
    source.start();
    return;
  }
  const el = this.element();
  try {
    el.currentTime = 0;
  } catch (err) {
    /* not seekable yet */
  }
  el.volume = Math.min(1, vol);
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
    gain.connect(SoundSystem.master);
    source.start();
    this.loopSource = source;
    return;
  }
  const el = this.element();
  el.loop = true;
  el.volume = Math.min(1, this.volume);
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
  play() {
    if (!this.el) {
      this.el = SoundSystem.trackElement(new Audio("sound/Disconnected.mp3"));
      this.el.loop = true;
      this.el.volume = 0.35;
    }
    const p = this.el.play();
    if (p && p.catch) p.catch(() => {});
  },
  pause() {
    if (this.el) this.el.pause();
  },
};

const sfx = {
  flame: new Sound("sound/fire.wav", { volume: 0.5 }),
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
