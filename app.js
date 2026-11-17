"use strict";
// =============================================================================
// Cyberpunk 2D77
// -----------------------------------------------------------------------------
// The whole game runs in a fixed 1920x1080 "logical" coordinate space. The
// canvas is scaled to fit any screen (desktop, tablet, phone) so none of the
// game code needs to care about the real screen size.
// =============================================================================

// ------------------------------------------------------------------ Canvas ---
const canvas = document.getElementById("canvas1");
const ctx = canvas.getContext("2d");
const gameEl = document.getElementById("game");
const W = 1920;
const H = 1080;
let renderScale = 1; // canvas pixels per logical pixel

// ------------------------------------------------------------------ Assets ---
function loadImage(src) {
  const img = new Image();
  img.src = src;
  return img;
}
const isReady = (img) => img && img.complete && img.naturalWidth > 0;

const playerSprite = loadImage("img/paine.png"); // 4x4 frames of 32x48
const enemySprite = loadImage("img/redgoat.png"); // 4x4 frames of 80x80
const background = loadImage("img/background1.jpg");
const endGame = loadImage("img/endgame.jpg");
const WASD = loadImage("img/wasd.png");
const fire = loadImage("img/fire.png");
const blueFlame = loadImage("img/blue-flame.png");

// fire.png and blue-flame.png are ~900px wide but drawn at ~70px. Shrinking
// them once up-front looks smoother and is much cheaper than every frame.
function prescaled(img, width) {
  const holder = { canvas: null };
  img.addEventListener("load", () => {
    const c = document.createElement("canvas");
    c.width = width;
    c.height = Math.round((img.naturalHeight / img.naturalWidth) * width);
    const g = c.getContext("2d");
    g.imageSmoothingQuality = "high";
    g.drawImage(img, 0, 0, c.width, c.height);
    holder.canvas = c;
  });
  return holder;
}
const fireSmall = prescaled(fire, 160);
const blueSmall = prescaled(blueFlame, 160);

// Small scratch canvas used to tint sprite frames (hit flashes, enrage)
const tintCanvas = document.createElement("canvas");
tintCanvas.width = 80;
tintCanvas.height = 80;
const tintCtx = tintCanvas.getContext("2d");

// ------------------------------------------------------------------ Tuning ---
// All speeds are in logical pixels per second, all times in seconds.
const TUNING = {
  player: {
    speed: 480,
    maxHp: 100,
    contactDamage: 14,
    fireballDamage: 9,
    hurtInvuln: 1.0,
    knockback: 620,
  },
  jump: { velocity: 820, gravity: 3000, maxJumps: 2, dodgeHeight: 26 },
  zap: { cooldown: 0.28, speed: 1100, damage: 3, radius: 24, aimAssist: 0.42 /* rad */ },
  flame: {
    maxHeat: 100,
    drainPerSec: 40,
    regenPerSec: 32,
    regenDelay: 0.45,
    recoverAt: 35, // heat needed before an overheated flame can be used again
    dps: 45,
    reach: 30,
  },
  goat: {
    maxHp: 300,
    chaseSpeed: 330,
    hoverSpeed: 560,
    recoilSpeed: 900,
    windup: 0.6,
    shotInterval: 0.42,
    fireballSpeed: 520,
    enrageAt: 0.5, // fraction of HP
    enrageSpeedMul: 1.3,
  },
};

// Floor limits for the player (top-left of the 64x96 sprite). The neon grid
// in the background starts at y≈909.
const FLOOR_TOP = 812;
const FLOOR_BOTTOM = H - 100;

const rand = (min, max) => min + Math.random() * (max - min);
const clamp = (v, min, max) => Math.max(min, Math.min(max, v));

// ---------------------------------------------------------------- Entities ---
const player = {
  // Ground position (top-left corner of the sprite as drawn on screen)
  x: 220,
  y: 900,
  // Size of one frame in the sprite sheet; it is drawn twice as big
  width: 32,
  height: 48,
  scale: 2,
  // Sprite sheet rows: 0 = down, 1 = left, 2 = right, 3 = up
  frameX: 0,
  frameY: 2,
  animTime: 0,
  moving: false,
  // Jumping: z is the height above the ground
  z: 0,
  vz: 0,
  jumps: 0,
  // Last direction we moved in; energy balls fly this way
  aimX: 1,
  aimY: 0,
  hp: TUNING.player.maxHp,
  ghostHp: TUNING.player.maxHp,
  heat: TUNING.flame.maxHeat,
  heatIdle: 0,
  overheated: false,
  flameOn: false,
  zapCooldown: 0,
  invuln: 0,
  kbX: 0,
  kbY: 0,
};

const enemy = {
  x: 1550,
  y: 770,
  width: 80,
  height: 80,
  scale: 3,
  frameX: 0,
  frameY: 1,
  animTime: 0,
  vx: 0,
  vy: 0,
  hp: TUNING.goat.maxHp,
  ghostHp: TUNING.goat.maxHp,
  state: "idle",
  stateTime: 0,
  stateDuration: 1.2,
  nextState: "chase",
  targetX: 0,
  targetY: 0,
  awayX: 0,
  awayY: 0,
  shotsLeft: 0,
  shotTimer: 0,
  burnTime: 0,
  hurtFlash: 0,
  enraged: false,
};

const projectiles = []; // the player's energy balls
const enemyProjectiles = []; // the goat's fireballs
const particles = [];
const popups = [];

const game = {
  state: "menu", // menu | playing | paused | over
  time: 0,
  overTime: 0,
  won: false,
  shake: 0,
  hurtFlash: 0,
  banner: null,
  hintTime: 10,
  debug: /[?&]debug\b/.test(location.search),
};

// ---------------------------------------------------------------- Hitboxes ---
// Hitboxes match the visible part of each sprite as it is drawn (the sprite
// sheets have a lot of transparent padding), so what you see is what hits.
function playerBox() {
  return { x: player.x + 14, y: player.y - player.z + 8, w: 36, h: 84 };
}
function flameBox() {
  const b = playerBox();
  const r = TUNING.flame.reach;
  return { x: b.x - r, y: b.y - r, w: b.w + r * 2, h: b.h + r };
}
function goatBox() {
  return { x: enemy.x + 54, y: enemy.y + 24, w: 132, h: 210 };
}
const centerOf = (b) => ({ x: b.x + b.w / 2, y: b.y + b.h / 2 });
const overlaps = (a, b) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
function circleHitsBox(cx, cy, r, b) {
  const nx = clamp(cx, b.x, b.x + b.w);
  const ny = clamp(cy, b.y, b.y + b.h);
  return (cx - nx) ** 2 + (cy - ny) ** 2 < r * r;
}

// ------------------------------------------------------------------- Input ---
const KEYMAP = {
  KeyW: "up",
  ArrowUp: "up",
  KeyS: "down",
  ArrowDown: "down",
  KeyA: "left",
  ArrowLeft: "left",
  KeyD: "right",
  ArrowRight: "right",
  KeyJ: "zap",
  KeyK: "flame",
  Space: "jump",
};
const keysDown = new Set(); // e.code of every key currently held
const touchActions = { zap: false, flame: false, jump: false };
const stick = { id: null, ox: 0, oy: 0, x: 0, y: 0 };
let jumpQueued = false;

const actionHeld = (action) => {
  if (touchActions[action]) return true;
  for (const code of keysDown) if (KEYMAP[code] === action) return true;
  return false;
};

function readMove() {
  if (stick.id !== null && (stick.x || stick.y)) return { x: stick.x, y: stick.y };
  let x = (actionHeld("right") ? 1 : 0) - (actionHeld("left") ? 1 : 0);
  let y = (actionHeld("down") ? 1 : 0) - (actionHeld("up") ? 1 : 0);
  if (x && y) {
    x *= Math.SQRT1_2;
    y *= Math.SQRT1_2;
  }
  return { x, y };
}

function clearInput() {
  keysDown.clear();
  touchActions.zap = touchActions.flame = touchActions.jump = false;
  releaseStick();
  jumpQueued = false;
  document.querySelectorAll(".action-btn.pressed").forEach((b) => b.classList.remove("pressed"));
}

addEventListener("keydown", (e) => {
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  SoundSystem.unlock();
  // Menus: Enter / Space activates the main button
  if (!overlay.hidden) {
    if (e.code === "Enter" || e.code === "Space") {
      e.preventDefault();
      if (!e.repeat) overlayPrimary();
    } else if ((e.code === "Escape" || e.code === "KeyP") && game.state === "paused") {
      e.preventDefault();
      resumeGame();
    }
    return;
  }
  if (e.code === "Escape" || e.code === "KeyP") {
    e.preventDefault();
    pauseGame();
    return;
  }
  if (e.code === "KeyM") toggleMute();
  if (e.code === "KeyB") game.debug = !game.debug; // show hitboxes
  const action = KEYMAP[e.code];
  if (!action) return;
  e.preventDefault(); // stop arrows / space from scrolling the page
  keysDown.add(e.code);
  if (action === "jump" && !e.repeat) jumpQueued = true;
});

addEventListener("keyup", (e) => {
  keysDown.delete(e.code);
});

// Releasing keys while the window is in the background never fires keyup,
// which used to leave the player running forever.
addEventListener("blur", clearInput);
document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    clearInput();
    pauseGame();
  }
});

// ------------------------------------------------------------ Touch input ---
const touchUI = document.getElementById("touch-controls");
const stickZone = document.getElementById("stick-zone");
const stickBase = document.getElementById("stick");
const stickKnob = document.getElementById("stick-knob");
const flameBtn = document.querySelector(".btn-flame");
let touchMode = false;

function setTouchMode(on) {
  if (touchMode === on) return;
  touchMode = on;
  document.body.classList.toggle("touch", on);
  layout();
}
if (window.matchMedia && matchMedia("(hover: none) and (pointer: coarse)").matches) setTouchMode(true);
addEventListener("touchstart", () => setTouchMode(true), { passive: true });

function stickRadius() {
  return stickBase.offsetWidth * 0.42 || 50;
}

function placeStick(x, y) {
  const size = stickBase.offsetWidth;
  stickBase.style.left = x - size / 2 + "px";
  stickBase.style.top = y - size / 2 + "px";
  stickBase.style.bottom = "auto";
}

function updateStick(e) {
  const r = stickRadius();
  let dx = e.clientX - stick.ox;
  let dy = e.clientY - stick.oy;
  let d = Math.hypot(dx, dy);
  // Drag the stick along when the thumb slides past its edge
  if (d > r) {
    stick.ox += (dx * (d - r)) / d;
    stick.oy += (dy * (d - r)) / d;
    placeStick(stick.ox, stick.oy);
    dx = e.clientX - stick.ox;
    dy = e.clientY - stick.oy;
    d = r;
  }
  stickKnob.style.transform = `translate(${dx}px, ${dy}px)`;
  const mag = d / r;
  const dead = 0.2;
  if (mag < dead) {
    stick.x = stick.y = 0;
  } else {
    const k = Math.min(1, (mag - dead) / (1 - dead) * 1.15) / mag;
    stick.x = (dx / r) * k;
    stick.y = (dy / r) * k;
  }
}

function releaseStick() {
  stick.id = null;
  stick.x = stick.y = 0;
  stickBase.classList.remove("active");
  stickBase.style.left = stickBase.style.top = stickBase.style.bottom = "";
  stickKnob.style.transform = "";
}

stickZone.addEventListener("pointerdown", (e) => {
  if (stick.id !== null) return;
  e.preventDefault();
  SoundSystem.unlock();
  stick.id = e.pointerId;
  try {
    stickZone.setPointerCapture(e.pointerId);
  } catch (err) {
    /* ignore */
  }
  stick.ox = e.clientX;
  stick.oy = e.clientY;
  placeStick(stick.ox, stick.oy);
  stickBase.classList.add("active");
  updateStick(e);
});
stickZone.addEventListener("pointermove", (e) => {
  if (e.pointerId === stick.id) updateStick(e);
});
["pointerup", "pointercancel", "lostpointercapture"].forEach((type) =>
  stickZone.addEventListener(type, (e) => {
    if (e.pointerId === stick.id) releaseStick();
  })
);

document.querySelectorAll(".action-btn").forEach((btn) => {
  const action = btn.dataset.action;
  btn.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    SoundSystem.unlock();
    try {
      btn.setPointerCapture(e.pointerId);
    } catch (err) {
      /* ignore */
    }
    touchActions[action] = true;
    btn.classList.add("pressed");
    if (action === "jump") jumpQueued = true;
  });
  const release = () => {
    touchActions[action] = false;
    btn.classList.remove("pressed");
  };
  btn.addEventListener("pointerup", release);
  btn.addEventListener("pointercancel", release);
  btn.addEventListener("lostpointercapture", release);
});

// No long-press menus / text selection on the controls
[touchUI, canvas].forEach((el) => el.addEventListener("contextmenu", (e) => e.preventDefault()));
document.addEventListener("gesturestart", (e) => e.preventDefault()); // iOS pinch-zoom

function vibrate(ms) {
  if (touchMode && navigator.vibrate) navigator.vibrate(ms);
}

// ------------------------------------------------------------------ Layout ---
// Fit the largest 16:9 box into the window. On phones held upright the game
// sits at the top so the on-screen controls have room underneath.
function layout() {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const portrait = vh > vw;
  document.body.classList.toggle("portrait", portrait);

  const w = Math.min(vw, (vh * 16) / 9);
  const h = (w * 9) / 16;
  const left = (vw - w) / 2;
  let top = (vh - h) / 2;
  if (portrait && touchMode) top = Math.min(top, Math.max(64, vh * 0.12));

  gameEl.style.left = left + "px";
  gameEl.style.top = top + "px";
  gameEl.style.width = w + "px";
  gameEl.style.height = h + "px";
  gameEl.style.setProperty("--u", w / 100 + "px");

  // Render at the screen's real resolution (capped at 1080p) for crisp pixels
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const backingW = Math.max(320, Math.min(W, Math.round(w * dpr)));
  if (canvas.width !== backingW) {
    canvas.width = backingW;
    canvas.height = Math.round((backingW * 9) / 16);
  }
  renderScale = canvas.width / W;
}
addEventListener("resize", layout);
addEventListener("orientationchange", () => setTimeout(layout, 150));
if (window.visualViewport) visualViewport.addEventListener("resize", layout);
layout();

// --------------------------------------------------------------- Player ------
function updatePlayer(dt) {
  const p = player;
  const move = readMove();
  const mag = Math.hypot(move.x, move.y);
  p.moving = mag > 0.05;
  if (p.moving) {
    p.aimX = move.x / mag;
    p.aimY = move.y / mag;
    setFacing(p, move.x, move.y);
  }

  p.x += (move.x * TUNING.player.speed + p.kbX) * dt;
  p.y += (move.y * TUNING.player.speed + p.kbY) * dt;
  const decay = Math.exp(-9 * dt);
  p.kbX *= decay;
  p.kbY *= decay;
  p.x = clamp(p.x, 0, W - p.width * p.scale);
  p.y = clamp(p.y, FLOOR_TOP, FLOOR_BOTTOM);

  // Walk cycle
  if (p.moving) {
    p.animTime += dt * (0.4 + 0.6 * Math.min(1, mag));
    p.frameX = Math.floor(p.animTime * 9) % 4;
  } else {
    p.animTime = 0;
    p.frameX = 0;
  }

  // Jump / double jump with real gravity (the old jump teleported the player)
  const J = TUNING.jump;
  if (jumpQueued) {
    jumpQueued = false;
    if (p.jumps < J.maxJumps) {
      p.vz = J.velocity;
      p.jumps++;
      if (p.jumps === 2) burst(p.x + 32, p.y + 92, 8, "#19f5ff", 220);
    }
  }
  if (p.z > 0 || p.vz > 0) {
    p.vz -= J.gravity * dt;
    p.z += p.vz * dt;
    if (p.z <= 0) {
      p.z = 0;
      p.vz = 0;
      p.jumps = 0;
    }
  }

  // Flame: protects from the goat's touch and burns it, but builds heat
  const F = TUNING.flame;
  p.flameOn = actionHeld("flame") && !p.overheated && p.heat > 0;
  if (p.flameOn) {
    p.heat -= F.drainPerSec * dt;
    p.heatIdle = 0;
    if (p.heat <= 0) {
      p.heat = 0;
      p.overheated = true;
      p.flameOn = false;
      popup("OVERHEAT!", p.x + 32, p.y - p.z - 10, "#ff4b4b");
    }
  } else {
    p.heatIdle += dt;
    if (p.heatIdle > F.regenDelay) p.heat = Math.min(F.maxHeat, p.heat + F.regenPerSec * dt);
    if (p.overheated && p.heat >= F.recoverAt) p.overheated = false;
  }
  if (p.flameOn) sfx.flame.startLoop();
  else sfx.flame.stopLoop();

  // Energy ball: hold to keep firing
  p.zapCooldown -= dt;
  if (actionHeld("zap") && p.zapCooldown <= 0) {
    fireEnergy();
    p.zapCooldown = TUNING.zap.cooldown;
  }

  p.invuln = Math.max(0, p.invuln - dt);
  p.ghostHp = Math.max(p.hp, p.ghostHp - 40 * dt);
}

// Pick the sprite-sheet row that matches a direction
function setFacing(entity, dx, dy) {
  if (Math.abs(dx) >= Math.abs(dy)) entity.frameY = dx < 0 ? 1 : 2;
  else entity.frameY = dy < 0 ? 3 : 0;
}

function fireEnergy() {
  const pb = playerBox();
  const pc = centerOf(pb);
  let ax = player.aimX;
  let ay = player.aimY;
  // Gentle aim assist: snap to the goat if it is roughly where we're aiming.
  // Makes 8-way keyboard aiming and thumb-stick aiming feel fair.
  const gc = centerOf(goatBox());
  const gx = gc.x - pc.x;
  const gy = gc.y - pc.y;
  const gl = Math.hypot(gx, gy);
  if (gl > 0 && (ax * gx + ay * gy) / gl > Math.cos(TUNING.zap.aimAssist)) {
    ax = gx / gl;
    ay = gy / gl;
  }
  if (!player.moving) setFacing(player, ax, ay);
  const speed = TUNING.zap.speed;
  projectiles.push({
    x: pc.x + ax * 34,
    y: pc.y - 6 + ay * 34,
    vx: ax * speed,
    vy: ay * speed,
    r: TUNING.zap.radius,
    angle: Math.atan2(ay, ax),
  });
  sfx.energy.play();
}

function hurtPlayer(damage, fromX, fromY) {
  const p = player;
  p.hp = Math.max(0, p.hp - damage);
  p.invuln = TUNING.player.hurtInvuln;
  const pc = centerOf(playerBox());
  let dx = pc.x - fromX;
  let dy = pc.y - fromY;
  const d = Math.hypot(dx, dy) || 1;
  p.kbX = (dx / d) * TUNING.player.knockback;
  p.kbY = (dy / d) * TUNING.player.knockback * 0.5;
  game.shake = Math.max(game.shake, 16);
  game.hurtFlash = 0.35;
  burst(pc.x, pc.y, 14, "#ff2f6d", 380);
  sfx.damage.play();
  vibrate(70);
}

// ----------------------------------------------------------------- Enemy -----
function setGoatState(state, duration) {
  const e = enemy;
  e.state = state;
  e.stateTime = 0;
  e.stateDuration = duration || 0;
  if (state === "chase") {
    e.stateDuration = duration || (e.enraged ? rand(2.2, 3.2) : rand(3, 4.5));
  } else if (state === "reposition") {
    // Fly somewhere up in the sky to rain fireballs down
    const b = goatBox();
    e.targetX = rand(260, W - 260);
    e.targetY = rand(170, 420);
    if (Math.abs(e.targetX - (b.x + b.w / 2)) < 300) e.targetX = W - e.targetX;
  } else if (state === "volley") {
    e.shotsLeft = 3;
    e.shotTimer = 0;
  }
}

function updateEnemy(dt) {
  const e = enemy;
  const T = TUNING.goat;
  e.stateTime += dt;
  e.hurtFlash = Math.max(0, e.hurtFlash - dt);
  e.ghostHp = Math.max(e.hp, e.ghostHp - 60 * dt);

  const ec = centerOf(goatBox());
  const pc = centerOf(playerBox());
  const toPlayerX = pc.x - ec.x;
  const toPlayerY = pc.y - ec.y;
  const speedMul = e.enraged ? T.enrageSpeedMul : 1;
  let tx = 0;
  let ty = 0;
  let speed = 0;
  let facePlayer = false;

  switch (e.state) {
    case "idle":
      facePlayer = true;
      if (e.stateTime > e.stateDuration) setGoatState("chase");
      break;
    case "chase":
      tx = toPlayerX;
      ty = toPlayerY;
      speed = T.chaseSpeed * speedMul;
      if (e.stateTime > e.stateDuration) setGoatState("reposition");
      break;
    case "reposition":
      tx = e.targetX - ec.x;
      ty = e.targetY - ec.y;
      speed = T.hoverSpeed * speedMul;
      if (Math.hypot(tx, ty) < 30 || e.stateTime > 2.2) setGoatState("windup");
      break;
    case "windup": // telegraph: the goat glows before it shoots
      facePlayer = true;
      if (e.stateTime > T.windup / speedMul) setGoatState("volley");
      break;
    case "volley":
      facePlayer = true;
      e.shotTimer -= dt;
      if (e.shotTimer <= 0) {
        if (e.shotsLeft > 0) {
          fireEnemyProjectile();
          e.shotsLeft--;
          e.shotTimer = T.shotInterval / speedMul;
        } else {
          setGoatState("chase");
        }
      }
      break;
    case "recoil": // knocked back after touching the player or getting burned
      tx = e.awayX;
      ty = e.awayY;
      speed = T.recoilSpeed * Math.max(0, 1 - e.stateTime / e.stateDuration);
      if (e.stateTime > e.stateDuration) setGoatState(e.nextState);
      break;
  }

  // Steer smoothly toward the desired velocity
  const len = Math.hypot(tx, ty);
  const wantVx = len > 1 ? (tx / len) * speed : 0;
  const wantVy = len > 1 ? (ty / len) * speed : 0;
  const steer = e.state === "recoil" ? 1 : 1 - Math.exp(-7 * dt);
  e.vx += (wantVx - e.vx) * steer;
  e.vy += (wantVy - e.vy) * steer;
  e.x += e.vx * dt;
  e.y += e.vy * dt;

  // Keep the visible goat (not the padded sprite frame) on screen
  e.x = clamp(e.x, -54, W - 186);
  e.y = clamp(e.y, 30, H - 234);

  // Facing + walk cycle (the goat used to be frozen in one frame)
  if (facePlayer) setFacing(e, toPlayerX, toPlayerY);
  else if (Math.hypot(e.vx, e.vy) > 30) setFacing(e, e.vx, e.vy);
  const animSpeed = e.state === "windup" ? 14 : Math.hypot(e.vx, e.vy) > 30 ? 8 : 0;
  e.animTime += dt * animSpeed;
  e.frameX = animSpeed ? Math.floor(e.animTime) % 4 : 0;

  if (!e.enraged && e.hp <= T.maxHp * T.enrageAt) {
    e.enraged = true;
    game.banner = { text: "THE GOAT IS ENRAGED!", time: 2 };
    game.shake = Math.max(game.shake, 12);
    burst(ec.x, ec.y, 30, "#ff2457", 520);
    sfx.goatShot.play({ rate: 0.4 });
  }
}

function recoilGoat(fromX, fromY, duration, nextState) {
  const ec = centerOf(goatBox());
  let dx = ec.x - fromX;
  let dy = ec.y - fromY;
  const d = Math.hypot(dx, dy) || 1;
  enemy.awayX = dx / d;
  enemy.awayY = dy / d - 0.35; // bounce up and away
  setGoatState("recoil", duration);
  enemy.nextState = nextState;
}

// The goat throws fireballs aimed at the player (3-way spread when enraged)
function fireEnemyProjectile() {
  const ec = centerOf(goatBox());
  const sx = ec.x;
  const sy = ec.y - 40;
  const pc = centerOf(playerBox());
  const base = Math.atan2(pc.y - sy, pc.x - sx);
  const speed = TUNING.goat.fireballSpeed * (enemy.enraged ? 1.2 : 1);
  const angles = enemy.enraged ? [base - 0.2, base, base + 0.2] : [base];
  angles.forEach((a) =>
    enemyProjectiles.push({
      x: sx,
      y: sy,
      vx: Math.cos(a) * speed,
      vy: Math.sin(a) * speed,
      r: 20,
      angle: a,
      dodged: false,
    })
  );
  sfx.goatShot.play({ rate: 0.55 });
}

// ------------------------------------------------------------ Projectiles ----
function updateProjectiles(dt) {
  const margin = 80;
  const offscreen = (p) => p.x < -margin || p.x > W + margin || p.y < -margin || p.y > H + margin;

  const gb = goatBox();
  for (let i = projectiles.length - 1; i >= 0; i--) {
    const p = projectiles[i];
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    if (circleHitsBox(p.x, p.y, p.r, gb)) {
      damageGoat(TUNING.zap.damage);
      enemy.vx += p.vx * 0.08;
      enemy.vy += p.vy * 0.08;
      burst(p.x, p.y, 10, "#5fd8ff", 300);
      sfx.zapHit.play();
      projectiles.splice(i, 1);
    } else if (offscreen(p)) {
      projectiles.splice(i, 1);
    }
  }

  const pb = playerBox();
  for (let i = enemyProjectiles.length - 1; i >= 0; i--) {
    const f = enemyProjectiles[i];
    f.x += f.vx * dt;
    f.y += f.vy * dt;
    if (offscreen(f)) {
      enemyProjectiles.splice(i, 1);
      continue;
    }
    if (!circleHitsBox(f.x, f.y, f.r, pb)) continue;
    if (player.z > TUNING.jump.dodgeHeight) {
      // Jumped clean over it
      if (!f.dodged) popup("DODGE!", player.x + 32, player.y - player.z - 10, "#19f5ff");
      f.dodged = true;
    } else if (player.invuln <= 0) {
      hurtPlayer(TUNING.player.fireballDamage, f.x - f.vx, f.y - f.vy);
      burst(f.x, f.y, 12, "#ff9b21", 320);
      enemyProjectiles.splice(i, 1);
    }
  }
}

function damageGoat(amount) {
  enemy.hp = Math.max(0, enemy.hp - amount);
  enemy.hurtFlash = 0.09;
}

// Player <-> goat body contact
function detectCollision(dt) {
  const pb = playerBox();
  const gb = goatBox();
  const pc = centerOf(pb);
  if (player.flameOn && overlaps(flameBox(), gb)) {
    // Burn the goat; if it keeps touching the flame it flees into the sky
    damageGoat(TUNING.flame.dps * dt);
    enemy.burnTime += dt;
    if (Math.random() < 0.6) {
      const gc = centerOf(gb);
      burst(gc.x + rand(-50, 50), gc.y + rand(-60, 60), 1, "#ff9b21", 200);
    }
    sfx.burn.play();
    if (enemy.burnTime > 0.35 && enemy.state !== "recoil") {
      recoilGoat(pc.x, pc.y, 0.45, "reposition");
      enemy.burnTime = 0;
    }
    return;
  }
  enemy.burnTime = 0;
  if (!player.flameOn && player.invuln <= 0 && enemy.state !== "recoil" && overlaps(pb, gb)) {
    const gc = centerOf(gb);
    hurtPlayer(TUNING.player.contactDamage, gc.x, gc.y);
    recoilGoat(pc.x, pc.y, 0.5, Math.random() < 0.5 ? "chase" : "reposition");
  }
}

// --------------------------------------------------------------- Effects -----
function burst(x, y, count, color, speed) {
  for (let i = 0; i < count; i++) {
    const a = Math.random() * Math.PI * 2;
    const s = speed * rand(0.3, 1);
    particles.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s - 80, life: rand(0.25, 0.6), max: 0.6, size: rand(4, 9), color });
  }
}

function popup(text, x, y, color) {
  popups.push({ text, x, y, life: 0.9, color });
}

function updateEffects(dt) {
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.life -= dt;
    if (p.life <= 0) {
      particles.splice(i, 1);
      continue;
    }
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.vy += 600 * dt;
    p.vx *= 0.97;
  }
  for (let i = popups.length - 1; i >= 0; i--) {
    popups[i].life -= dt;
    popups[i].y -= 70 * dt;
    if (popups[i].life <= 0) popups.splice(i, 1);
  }
  game.shake = Math.max(0, game.shake - 60 * dt);
  game.hurtFlash = Math.max(0, game.hurtFlash - dt);
  if (game.banner && (game.banner.time -= dt) <= 0) game.banner = null;
  game.hintTime -= dt;
}

// ------------------------------------------------------------- Game flow -----
function resetGame() {
  Object.assign(player, {
    x: 220,
    y: 900,
    frameX: 0,
    frameY: 2,
    z: 0,
    vz: 0,
    jumps: 0,
    aimX: 1,
    aimY: 0,
    hp: TUNING.player.maxHp,
    ghostHp: TUNING.player.maxHp,
    heat: TUNING.flame.maxHeat,
    heatIdle: 0,
    overheated: false,
    flameOn: false,
    zapCooldown: 0,
    invuln: 0,
    kbX: 0,
    kbY: 0,
  });
  Object.assign(enemy, {
    x: 1550,
    y: 770,
    vx: 0,
    vy: 0,
    frameY: 1,
    hp: TUNING.goat.maxHp,
    ghostHp: TUNING.goat.maxHp,
    burnTime: 0,
    hurtFlash: 0,
    enraged: false,
  });
  setGoatState("idle", 1.2);
  projectiles.length = 0;
  enemyProjectiles.length = 0;
  particles.length = 0;
  popups.length = 0;
  Object.assign(game, { time: 0, overTime: 0, won: false, shake: 0, hurtFlash: 0, banner: null, hintTime: 10 });
  clearInput();
}

function startGame() {
  SoundSystem.unlock();
  resetGame();
  setState("playing");
  music.play();
}

function pauseGame() {
  if (game.state !== "playing") return;
  setState("paused");
  sfx.flame.stopLoop();
  music.pause();
}

function resumeGame() {
  if (game.state !== "paused") return;
  clearInput();
  setState("playing");
  music.play();
}

function endGame_(won) {
  game.won = won;
  game.overTime = 0;
  sfx.flame.stopLoop();
  clearInput();
  setState("over");
  if (!won) {
    music.pause();
    sfx.gameOver.play();
  }
  vibrate(won ? [40, 60, 40] : 200);
}

function checkEnd() {
  if (player.hp <= 0) endGame_(false);
  else if (enemy.hp <= 0) endGame_(true);
}

function update(dt) {
  game.time += dt;
  updatePlayer(dt);
  updateEnemy(dt);
  updateProjectiles(dt);
  detectCollision(dt);
  updateEffects(dt);
  checkEnd();
}

// --------------------------------------------------------------- Overlay -----
const overlay = document.getElementById("overlay");
const overlayTitle = document.getElementById("overlay-title");
const overlayText = document.getElementById("overlay-text");
const controlsHelp = document.getElementById("controls-help");
const overlayBtn = document.getElementById("overlay-btn");
const overlayBtn2 = document.getElementById("overlay-btn-2");
let overlayShownAt = 0;

function setState(state) {
  game.state = state;
  document.body.className = document.body.className.replace(/\bstate-\w+/g, "").trim();
  document.body.classList.add("state-" + state);
  if (state === "playing") {
    overlay.hidden = true;
    return;
  }
  if (state === "menu") {
    showOverlay("Cyberpunk 2D77", "It's year 2D77. You're a Cyber Badass. Don't kiss the Demon Goat.", "Start Game", true);
  } else if (state === "paused") {
    showOverlay("Paused", "Catch your breath, the goat will wait.", "Resume", true, "Restart");
  }
  // "over" shows its overlay after a short delay, see frame()
}

function showOverlay(title, text, button, showHelp, secondary) {
  overlayTitle.textContent = title;
  overlayText.textContent = text;
  controlsHelp.hidden = !showHelp;
  overlayBtn.textContent = button;
  overlayBtn2.hidden = !secondary;
  if (secondary) overlayBtn2.textContent = secondary;
  overlay.hidden = false;
  overlayShownAt = performance.now();
  if (!touchMode) overlayBtn.focus({ preventScroll: true });
}

function showGameOver() {
  const secs = Math.round(game.time);
  if (game.won) {
    showOverlay(
      "Lamb Chops for Dinna!",
      `You roasted the Demon Goat in ${secs}s with ${Math.ceil(player.hp)} HP to spare.`,
      "Eat Lamb Chops & Play Again",
      false
    );
  } else {
    const left = Math.ceil((enemy.hp / TUNING.goat.maxHp) * 100);
    showOverlay(
      "The Goat Got Your Soul!",
      `You lasted ${secs}s. The goat had ${left}% of its health left.`,
      "Try Again",
      false
    );
  }
}

function overlayPrimary() {
  // Ignore presses that were meant for the game a split-second earlier
  if (performance.now() - overlayShownAt < 400) return;
  if (game.state === "paused") resumeGame();
  else if (game.state === "menu" || game.state === "over") startGame();
}

overlayBtn.addEventListener("click", overlayPrimary);
overlayBtn2.addEventListener("click", () => {
  if (performance.now() - overlayShownAt < 400) return;
  startGame();
});

// ----------------------------------------------------------- HUD buttons -----
const pauseBtn = document.getElementById("btn-pause");
const muteBtn = document.getElementById("btn-mute");
const fullscreenBtn = document.getElementById("btn-fullscreen");

function toggleMute() {
  SoundSystem.setMuted(!SoundSystem.muted);
  muteBtn.setAttribute("aria-pressed", String(SoundSystem.muted));
  muteBtn.setAttribute("aria-label", SoundSystem.muted ? "Unmute" : "Mute");
  try {
    localStorage.setItem("cp2d77-muted", SoundSystem.muted ? "1" : "0");
  } catch (err) {
    /* storage unavailable */
  }
}
try {
  if (localStorage.getItem("cp2d77-muted") === "1") toggleMute();
} catch (err) {
  /* storage unavailable */
}

pauseBtn.addEventListener("click", () => (game.state === "paused" ? resumeGame() : pauseGame()));
muteBtn.addEventListener("click", () => {
  SoundSystem.unlock();
  toggleMute();
});

const root = document.documentElement;
const fsSupported = !!(document.fullscreenEnabled || document.webkitFullscreenEnabled);
if (!fsSupported) fullscreenBtn.hidden = true;
fullscreenBtn.addEventListener("click", () => {
  const fsElement = document.fullscreenElement || document.webkitFullscreenElement;
  if (fsElement) {
    (document.exitFullscreen || document.webkitExitFullscreen).call(document);
    return;
  }
  const req = root.requestFullscreen || root.webkitRequestFullscreen;
  const p = req && req.call(root, { navigationUI: "hide" });
  // On Android, also try to lock the screen to landscape
  Promise.resolve(p)
    .then(() => screen.orientation && screen.orientation.lock && screen.orientation.lock("landscape"))
    .catch(() => {});
});
// Keep buttons from stealing keyboard focus (Space would "click" them)
document.querySelectorAll(".icon-btn").forEach((b) => b.addEventListener("mouseup", () => b.blur()));

// ------------------------------------------------------------- Rendering -----
const FONT = '"Press Start 2P", ui-monospace, monospace';

function drawFrame(img, frameX, frameY, fw, fh, x, y, w, h, tint) {
  if (!isReady(img)) return;
  ctx.imageSmoothingEnabled = false;
  if (!tint) {
    ctx.drawImage(img, frameX * fw, frameY * fh, fw, fh, x, y, w, h);
    return;
  }
  tintCtx.globalCompositeOperation = "source-over";
  tintCtx.clearRect(0, 0, fw, fh);
  tintCtx.drawImage(img, frameX * fw, frameY * fh, fw, fh, 0, 0, fw, fh);
  tintCtx.globalCompositeOperation = "source-atop";
  tintCtx.fillStyle = tint;
  tintCtx.fillRect(0, 0, fw, fh);
  ctx.drawImage(tintCanvas, 0, 0, fw, fh, x, y, w, h);
}

function glow(x, y, radius, color) {
  const g = ctx.createRadialGradient(x, y, 0, x, y, radius);
  g.addColorStop(0, color);
  g.addColorStop(1, "rgba(0,0,0,0)");
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  ctx.fillStyle = g;
  ctx.fillRect(x - radius, y - radius, radius * 2, radius * 2);
  ctx.restore();
}

function drawBackground() {
  ctx.imageSmoothingEnabled = true;
  if (!isReady(background)) {
    ctx.fillStyle = "#1a0b2e";
    ctx.fillRect(-20, -20, W + 40, H + 40);
    return;
  }
  // "Cover" fit without stretching; the bottom (the street) stays in view
  const s = (W + 40) / background.naturalWidth;
  const h = background.naturalHeight * s;
  ctx.drawImage(background, -20, H + 20 - h, W + 40, h);
}

function drawShadow(x, y, rx, alpha) {
  ctx.fillStyle = `rgba(0,0,0,${alpha})`;
  ctx.beginPath();
  ctx.ellipse(x, y, rx, rx * 0.3, 0, 0, Math.PI * 2);
  ctx.fill();
}

function drawFlame(cx, baseY, behind) {
  const img = fireSmall.canvas || (isReady(fire) && fire);
  if (!img) return;
  const t = performance.now() / 1000;
  const flick = 1 + Math.sin(t * 31) * 0.06 + Math.sin(t * 17) * 0.05;
  ctx.imageSmoothingEnabled = true;
  if (behind) {
    glow(cx, baseY - 50, 150, "rgba(255,120,30,0.55)");
    const w = 124 * (2 - flick);
    const h = 170 * flick;
    ctx.drawImage(img, cx - w / 2, baseY + 8 - h, w, h);
  } else {
    ctx.globalAlpha = 0.5;
    const w = 90 * flick;
    const h = 112 * (2 - flick);
    ctx.drawImage(img, cx - w / 2, baseY + 6 - h, w, h);
    ctx.globalAlpha = 1;
  }
}

function drawPlayer() {
  const p = player;
  const w = p.width * p.scale;
  const h = p.height * p.scale;
  drawShadow(p.x + w / 2, p.y + 92, 24 * (1 - Math.min(p.z / 300, 0.5)), 0.4);
  const top = p.y - p.z;
  if (p.flameOn) drawFlame(p.x + w / 2, top + 92, true);
  const blink = p.invuln > 0 && Math.floor(p.invuln * 18) % 2 === 0;
  ctx.globalAlpha = blink ? 0.3 : 1;
  drawFrame(playerSprite, p.frameX, p.frameY, p.width, p.height, p.x, top, w, h);
  ctx.globalAlpha = 1;
  if (p.flameOn) drawFlame(p.x + w / 2, top + 92, false);
}

function drawEnemy() {
  const e = enemy;
  const w = e.width * e.scale;
  const h = e.height * e.scale;
  const c = centerOf(goatBox());
  const feetY = e.y + 234;
  if (feetY > 905) drawShadow(e.x + w / 2, feetY, 70, 0.35);
  if (e.state === "windup") {
    const pulse = 0.5 + 0.5 * Math.sin(e.stateTime * 30);
    glow(c.x, c.y - 30, 170 + pulse * 40, `rgba(255,140,30,${0.45 + pulse * 0.3})`);
  } else if (e.enraged) {
    glow(c.x, c.y, 180, "rgba(255,20,60,0.35)");
  }
  let tint = null;
  if (e.hurtFlash > 0) tint = "rgba(255,255,255,0.85)";
  else if (e.state === "windup") tint = `rgba(255,170,40,${0.2 + 0.2 * Math.sin(e.stateTime * 30)})`;
  else if (e.enraged) tint = "rgba(255,0,40,0.25)";
  drawFrame(enemySprite, e.frameX, e.frameY, e.width, e.height, e.x, e.y, w, h, tint);
}

function drawProjectiles() {
  ctx.imageSmoothingEnabled = true;
  const blue = blueSmall.canvas || (isReady(blueFlame) && blueFlame);
  projectiles.forEach((p) => {
    glow(p.x, p.y, 60, "rgba(40,160,255,0.45)");
    if (!blue) return;
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(p.angle);
    ctx.drawImage(blue, -76 * 0.66, -68 * 0.46, 76, 68); // image points right
    ctx.restore();
  });
  const flame = fireSmall.canvas || (isReady(fire) && fire);
  enemyProjectiles.forEach((f) => {
    glow(f.x, f.y, 60, "rgba(255,90,20,0.5)");
    if (!flame) return;
    ctx.save();
    ctx.translate(f.x, f.y);
    ctx.rotate(f.angle - Math.PI / 2); // flame tip trails behind
    ctx.drawImage(flame, -29, -80 * 0.68, 58, 80);
    ctx.restore();
  });
}

function drawEffects() {
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  particles.forEach((p) => {
    ctx.globalAlpha = Math.min(1, p.life / 0.3);
    ctx.fillStyle = p.color;
    ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
  });
  ctx.restore();
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = `26px ${FONT}`;
  popups.forEach((p) => {
    ctx.globalAlpha = Math.min(1, p.life / 0.3);
    ctx.fillStyle = "#000";
    ctx.fillText(p.text, p.x + 3, p.y + 3);
    ctx.fillStyle = p.color;
    ctx.fillText(p.text, p.x, p.y);
  });
  ctx.globalAlpha = 1;
}

function drawBar(x, y, w, h, frac, ghostFrac, color, alignRight) {
  frac = clamp(frac, 0, 1);
  ghostFrac = clamp(ghostFrac, 0, 1);
  const fill = (f) => (alignRight ? [x + w * (1 - f), w * f] : [x, w * f]);
  ctx.fillStyle = "rgba(10,3,24,0.8)";
  ctx.fillRect(x, y, w, h);
  let [gx, gw] = fill(ghostFrac);
  ctx.fillStyle = "rgba(255,255,255,0.6)";
  ctx.fillRect(gx, y, gw, h);
  [gx, gw] = fill(frac);
  ctx.fillStyle = color;
  ctx.fillRect(gx, y, gw, h);
  ctx.fillStyle = "rgba(255,255,255,0.22)";
  ctx.fillRect(gx, y, gw, h * 0.35);
  ctx.lineWidth = 4;
  ctx.strokeStyle = color;
  ctx.strokeRect(x - 2, y - 2, w + 4, h + 4);
}

function hudText(text, x, y, size, color, align) {
  ctx.font = `${size}px ${FONT}`;
  ctx.textAlign = align;
  ctx.textBaseline = "top";
  ctx.fillStyle = "rgba(0,0,0,0.75)";
  ctx.fillText(text, x + 3, y + 3);
  ctx.fillStyle = color;
  ctx.fillText(text, x, y);
}

function drawHUD() {
  const t = performance.now() / 1000;
  const P = TUNING.player;
  const lowHp = player.hp / P.maxHp < 0.3;
  const hpColor = lowHp && Math.sin(t * 12) > 0 ? "#ff2f6d" : "#19f5ff";

  // Player: health + flame heat
  hudText("YOU", 44, 34, 28, "#ffffff", "left");
  drawBar(44, 74, 560, 36, player.hp / P.maxHp, player.ghostHp / P.maxHp, hpColor, false);
  hudText(String(Math.ceil(player.hp)), 58, 80, 24, "#ffffff", "left");
  const heatColor = player.overheated ? (Math.sin(t * 16) > 0 ? "#ff3b3b" : "#7a1010") : "#ff9b21";
  drawBar(44, 128, 360, 16, player.heat / TUNING.flame.maxHeat, 0, heatColor, false);
  hudText(player.overheated ? "OVERHEAT" : "HEAT", 420, 126, 18, heatColor, "left");

  // Demon goat
  const G = TUNING.goat;
  hudText(enemy.enraged ? "DEMON GOAT !!" : "DEMON GOAT", W - 44, 34, 28, enemy.enraged ? "#ff2457" : "#ffffff", "right");
  drawBar(W - 44 - 680, 74, 680, 36, enemy.hp / G.maxHp, enemy.ghostHp / G.maxHp, "#ff2457", true);

  // Controls reminder for keyboard players during the first seconds. It fades
  // out of the way whenever the goat flies behind it.
  if (!touchMode && game.hintTime > 0 && game.state === "playing") {
    const hint = { x: W / 2 - 330, y: 150, w: 660, h: 150 };
    const behindGoat = overlaps(hint, goatBox());
    ctx.globalAlpha = clamp(game.hintTime / 1.5, 0, 1) * (behindGoat ? 0.25 : 0.9);
    ctx.fillStyle = "rgba(10,3,24,0.75)";
    ctx.fillRect(hint.x, hint.y, hint.w, hint.h);
    ctx.strokeStyle = "rgba(255,47,214,0.8)";
    ctx.lineWidth = 3;
    ctx.strokeRect(hint.x, hint.y, hint.w, hint.h);
    if (isReady(WASD)) {
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(WASD, hint.x + 22, hint.y + 14, 113, 122);
    }
    const lines = [
      ["WASD", "MOVE / AIM"],
      ["J", "ENERGY BALL"],
      ["K", "FLAME (HOLD)"],
      ["SPACE", "JUMP x2"],
    ];
    lines.forEach(([key, label], i) => {
      hudText(key, hint.x + 170, hint.y + 18 + i * 31, 20, "#ff9b21", "left");
      hudText(label, hint.x + 320, hint.y + 18 + i * 31, 20, "#ffffff", "left");
    });
    ctx.globalAlpha = 1;
  }

  if (game.banner) {
    const a = clamp(game.banner.time / 0.4, 0, 1);
    ctx.globalAlpha = a;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = `56px ${FONT}`;
    ctx.fillStyle = "#000";
    ctx.fillText(game.banner.text, W / 2 + 5, H / 2 - 135);
    ctx.fillStyle = "#ff2457";
    ctx.fillText(game.banner.text, W / 2, H / 2 - 140);
    ctx.globalAlpha = 1;
  }
}

function drawDebug() {
  ctx.lineWidth = 3;
  const box = (b, color) => {
    ctx.strokeStyle = color;
    ctx.strokeRect(b.x, b.y, b.w, b.h);
  };
  box(playerBox(), "#19f5ff");
  box(goatBox(), "#ff2457");
  if (player.flameOn) box(flameBox(), "#ff9b21");
  ctx.strokeStyle = "#ffffff";
  [...projectiles, ...enemyProjectiles].forEach((p) => {
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
    ctx.stroke();
  });
  hudText(`goat: ${enemy.state}`, 44, 170, 18, "#fff", "left");
}

function render() {
  ctx.setTransform(renderScale, 0, 0, renderScale, 0, 0);
  ctx.save();
  if (game.shake > 0) ctx.translate(rand(-1, 1) * game.shake, rand(-1, 1) * game.shake);
  drawBackground();

  // Draw whoever is closer to the camera (lower on screen) last
  const playerFeet = player.y + 92;
  const goatFeet = enemy.y + 234;
  if (goatFeet <= playerFeet) {
    drawEnemy();
    drawPlayer();
  } else {
    drawPlayer();
    drawEnemy();
  }
  drawProjectiles();
  drawEffects();
  if (game.debug) drawDebug();
  ctx.restore();

  if (game.hurtFlash > 0) {
    const g = ctx.createRadialGradient(W / 2, H / 2, H * 0.3, W / 2, H / 2, H * 0.95);
    g.addColorStop(0, "rgba(255,0,60,0)");
    g.addColorStop(1, `rgba(255,0,60,${game.hurtFlash})`);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
  }

  if (game.state === "over") {
    // Fade in the original end-game artwork
    ctx.globalAlpha = clamp(game.overTime / 0.8, 0, 1);
    if (isReady(endGame)) {
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(endGame, 0, 0, W, H);
    } else {
      ctx.fillStyle = "#14051f";
      ctx.fillRect(0, 0, W, H);
    }
    ctx.globalAlpha = 1;
  } else {
    drawHUD();
  }
}

function updateTouchHUD() {
  if (!touchMode) return;
  flameBtn.style.setProperty("--heat", (player.heat / TUNING.flame.maxHeat).toFixed(3));
  flameBtn.classList.toggle("overheated", player.overheated);
}

// ------------------------------------------------------------- Main loop -----
// requestAnimationFrame + delta time: the game runs at the same speed on a
// 60Hz laptop, a 120Hz phone or a slow device.
let lastTime = performance.now();
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, Math.max(0, (now - lastTime) / 1000));
  lastTime = now;
  if (game.state === "playing") {
    update(dt);
    updateTouchHUD();
  } else if (game.state === "over") {
    const before = game.overTime;
    game.overTime += dt;
    updateEffects(dt);
    if (before < 0.9 && game.overTime >= 0.9) showGameOver();
  }
  render();
}

setState("menu");
requestAnimationFrame(frame);
