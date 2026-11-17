"use strict";
// =============================================================================
// Input: keyboard, mouse and two touch schemes.
//   Keyboard: A/D move, W/S aim, Space jump, J zap, K flame.
//   Mouse:    left button zaps toward the cursor, right button holds the flame.
//   Touch "buttons":  joystick + ZAP / FLAME / JUMP buttons.
//   Touch "gestures": joystick to move; tap anywhere to zap toward that exact
//                     spot, long-press for the flame, double-tap to jump.
// =============================================================================

const KEYMAP = {
  KeyA: "left",
  ArrowLeft: "left",
  KeyD: "right",
  ArrowRight: "right",
  KeyW: "up",
  ArrowUp: "up",
  KeyS: "down",
  ArrowDown: "down",
  KeyJ: "zap",
  KeyK: "flame",
  Space: "jump",
};

const input = {
  keys: new Set(),
  stick: { id: null, ox: 0, oy: 0, x: 0, y: 0 },
  buttons: { zap: false, flame: false, jump: false },
  mouse: { x: W / 2, y: H / 2, zap: false, flame: false },
  gesture: { flame: false, jumpHoldUntil: 0 },
  jumpQueued: false,
  shots: [], // queued taps: world points to fire at
};

const settings = { touchScheme: "buttons" };
try {
  if (localStorage.getItem("cp2d77-scheme") === "gestures") settings.touchScheme = "gestures";
} catch (err) {
  /* storage unavailable */
}

function keyHeld(action) {
  for (const code of input.keys) if (KEYMAP[code] === action) return true;
  return false;
}

// Movement / aim direction from the joystick or keys, each in -1..1
function moveAxis() {
  const s = input.stick;
  if (s.id !== null && (s.x || s.y)) return { x: s.x, y: s.y, analog: true };
  return {
    x: (keyHeld("right") ? 1 : 0) - (keyHeld("left") ? 1 : 0),
    y: (keyHeld("down") ? 1 : 0) - (keyHeld("up") ? 1 : 0),
    analog: false,
  };
}
const zapHeld = () => keyHeld("zap") || input.buttons.zap || input.mouse.zap;
const flameHeld = () => keyHeld("flame") || input.buttons.flame || input.mouse.flame || input.gesture.flame;
const jumpHeld = () => keyHeld("jump") || input.buttons.jump || performance.now() < input.gesture.jumpHoldUntil;

function clearInput() {
  input.keys.clear();
  input.buttons.zap = input.buttons.flame = input.buttons.jump = false;
  input.mouse.zap = input.mouse.flame = false;
  input.gesture.flame = false;
  input.jumpQueued = false;
  input.shots.length = 0;
  releaseStick();
  document.querySelectorAll(".action-btn.pressed").forEach((b) => b.classList.remove("pressed"));
}

// Screen (client) coordinates -> world coordinates
function clientToWorld(clientX, clientY) {
  const r = canvas.getBoundingClientRect();
  return {
    x: ((clientX - r.left) / r.width) * W + camera.x,
    y: ((clientY - r.top) / r.height) * H,
  };
}

// --------------------------------------------------------------- Keyboard ---
addEventListener("keydown", (e) => {
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  SoundSystem.unlock();
  if (handleMenuKey(e)) return; // menus / level-up cards (main.js)
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
  input.keys.add(e.code);
  if (action === "jump" && !e.repeat) input.jumpQueued = true;
});
addEventListener("keyup", (e) => input.keys.delete(e.code));

// Releasing keys while the window is in the background never fires keyup
addEventListener("blur", clearInput);

// ------------------------------------------------------------------ Mouse ---
canvas.addEventListener("pointerdown", (e) => {
  if (e.pointerType !== "mouse" || game.state !== "playing") return;
  e.preventDefault();
  SoundSystem.unlock();
  Object.assign(input.mouse, clientToWorld(e.clientX, e.clientY));
  if (e.button === 0) input.mouse.zap = true;
  if (e.button === 2) input.mouse.flame = true;
});
addEventListener("pointermove", (e) => {
  if (e.pointerType !== "mouse") return;
  const p = clientToWorld(e.clientX, e.clientY);
  input.mouse.x = p.x;
  input.mouse.y = p.y;
  input.mouse.clientX = e.clientX;
  input.mouse.clientY = e.clientY;
});
addEventListener("pointerup", (e) => {
  if (e.pointerType !== "mouse") return;
  if (e.button === 0) input.mouse.zap = false;
  if (e.button === 2) input.mouse.flame = false;
});
// Keep the world position under a still cursor as the camera scrolls
function refreshMouseWorld() {
  if (input.mouse.clientX !== undefined) {
    const p = clientToWorld(input.mouse.clientX, input.mouse.clientY);
    input.mouse.x = p.x;
    input.mouse.y = p.y;
  }
}

// ------------------------------------------------------------------ Touch ---
const touchUI = document.getElementById("touch-controls");
const stickZone = document.getElementById("stick-zone");
const stickBase = document.getElementById("stick");
const stickKnob = document.getElementById("stick-knob");
const gestureZone = document.getElementById("gesture-zone");
const flameBtn = document.querySelector(".btn-flame");
let touchMode = false;

function setTouchMode(on) {
  if (touchMode === on) return;
  touchMode = on;
  document.body.classList.toggle("touch", on);
  if (typeof layout === "function") layout();
}
if (window.matchMedia && matchMedia("(hover: none) and (pointer: coarse)").matches) setTouchMode(true);
addEventListener("touchstart", () => setTouchMode(true), { passive: true });

function setTouchScheme(scheme) {
  settings.touchScheme = scheme;
  document.body.classList.toggle("scheme-gestures", scheme === "gestures");
  document.querySelectorAll("[data-scheme]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.scheme === scheme)));
  try {
    localStorage.setItem("cp2d77-scheme", scheme);
  } catch (err) {
    /* storage unavailable */
  }
  clearInput();
}
setTouchScheme(settings.touchScheme);
document.querySelectorAll("[data-scheme]").forEach((b) =>
  b.addEventListener("click", () => setTouchScheme(b.dataset.scheme))
);

// --- Joystick (floating: it appears wherever your thumb lands) ---
const stickRadius = () => stickBase.offsetWidth * 0.42 || 50;

function placeStick(x, y) {
  const size = stickBase.offsetWidth;
  stickBase.style.left = x - size / 2 + "px";
  stickBase.style.top = y - size / 2 + "px";
  stickBase.style.bottom = "auto";
}

function updateStick(e) {
  const s = input.stick;
  const r = stickRadius();
  let dx = e.clientX - s.ox;
  let dy = e.clientY - s.oy;
  let d = Math.hypot(dx, dy);
  if (d > r) {
    // drag the stick along when the thumb slides past its edge
    s.ox += (dx * (d - r)) / d;
    s.oy += (dy * (d - r)) / d;
    placeStick(s.ox, s.oy);
    dx = e.clientX - s.ox;
    dy = e.clientY - s.oy;
    d = r;
  }
  stickKnob.style.transform = `translate(${dx}px, ${dy}px)`;
  const mag = d / r;
  const dead = 0.2;
  if (mag < dead) {
    s.x = s.y = 0;
  } else {
    const k = Math.min(1, ((mag - dead) / (1 - dead)) * 1.15) / mag;
    s.x = (dx / r) * k;
    s.y = (dy / r) * k;
  }
}

function releaseStick() {
  const s = input.stick;
  s.id = null;
  s.x = s.y = 0;
  stickBase.classList.remove("active");
  stickBase.style.left = stickBase.style.top = stickBase.style.bottom = "";
  stickKnob.style.transform = "";
}

stickZone.addEventListener("pointerdown", (e) => {
  if (input.stick.id !== null) return;
  e.preventDefault();
  SoundSystem.unlock();
  input.stick.id = e.pointerId;
  try {
    stickZone.setPointerCapture(e.pointerId);
  } catch (err) {
    /* ignore */
  }
  input.stick.ox = e.clientX;
  input.stick.oy = e.clientY;
  placeStick(e.clientX, e.clientY);
  stickBase.classList.add("active");
  updateStick(e);
});
stickZone.addEventListener("pointermove", (e) => {
  if (e.pointerId === input.stick.id) updateStick(e);
});
["pointerup", "pointercancel", "lostpointercapture"].forEach((type) =>
  stickZone.addEventListener(type, (e) => {
    if (e.pointerId === input.stick.id) releaseStick();
  })
);

// --- Buttons scheme ---
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
    input.buttons[action] = true;
    btn.classList.add("pressed");
    if (action === "jump") input.jumpQueued = true;
  });
  const release = () => {
    input.buttons[action] = false;
    btn.classList.remove("pressed");
  };
  btn.addEventListener("pointerup", release);
  btn.addEventListener("pointercancel", release);
  btn.addEventListener("lostpointercapture", release);
});

// --- Gestures scheme ---
const LONG_PRESS_MS = 260;
const TAP_SLOP = 30; // px a finger may wander and still count as a tap
const DOUBLE_TAP_MS = 320;
const DOUBLE_TAP_DIST = 110;
const touches = new Map();
let lastTap = { t: -1e9, x: 0, y: 0 };

gestureZone.addEventListener("pointerdown", (e) => {
  e.preventDefault();
  SoundSystem.unlock();
  try {
    gestureZone.setPointerCapture(e.pointerId);
  } catch (err) {
    /* ignore */
  }
  const t = { x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY, start: performance.now(), long: false };
  t.timer = setTimeout(() => {
    // Still holding and hasn't moved: long press = flame
    if (touches.get(e.pointerId) === t && Math.hypot(t.x - t.x0, t.y - t.y0) < TAP_SLOP) {
      t.long = true;
      input.gesture.flame = true;
      vibrate(15);
    }
  }, LONG_PRESS_MS);
  touches.set(e.pointerId, t);
});
gestureZone.addEventListener("pointermove", (e) => {
  const t = touches.get(e.pointerId);
  if (t) {
    t.x = e.clientX;
    t.y = e.clientY;
  }
});
function endGesture(e, cancelled) {
  const t = touches.get(e.pointerId);
  if (!t) return;
  touches.delete(e.pointerId);
  clearTimeout(t.timer);
  if (t.long) {
    if (![...touches.values()].some((o) => o.long)) input.gesture.flame = false;
    return;
  }
  if (cancelled || game.state !== "playing") return;
  if (Math.hypot(t.x - t.x0, t.y - t.y0) > TAP_SLOP * 2) return; // a swipe, ignore
  const now = performance.now();
  if (now - lastTap.t < DOUBLE_TAP_MS && Math.hypot(t.x - lastTap.x, t.y - lastTap.y) < DOUBLE_TAP_DIST) {
    // Double tap = jump (full height: there's no "release" to cut it short)
    input.jumpQueued = true;
    input.gesture.jumpHoldUntil = now + 260;
    lastTap.t = -1e9;
    return;
  }
  lastTap = { t: now, x: t.x, y: t.y };
  // Single tap = zap toward that exact spot
  if (input.shots.length < 3) input.shots.push(clientToWorld(t.x, t.y));
  pulseTap(t.x, t.y);
}
gestureZone.addEventListener("pointerup", (e) => endGesture(e, false));
gestureZone.addEventListener("pointercancel", (e) => endGesture(e, true));

// Little ripple where you tapped, so you can see the aim point
function pulseTap(x, y) {
  const el = document.createElement("div");
  el.className = "tap-ripple";
  el.style.left = x + "px";
  el.style.top = y + "px";
  gestureZone.appendChild(el);
  setTimeout(() => el.remove(), 350);
}

// No long-press menus / text selection on the controls
[touchUI, canvas, gestureZone].forEach((el) => el.addEventListener("contextmenu", (e) => e.preventDefault()));
document.addEventListener("gesturestart", (e) => e.preventDefault()); // iOS pinch-zoom

function vibrate(ms) {
  if (touchMode && navigator.vibrate) navigator.vibrate(ms);
}
