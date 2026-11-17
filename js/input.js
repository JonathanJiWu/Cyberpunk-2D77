"use strict";
// =============================================================================
// Input and settings.
//   Keyboard: A/D run, W/S aim, Space jump, J fire, K flame.
//   Mouse:    left button fires at the cursor, right button holds the flame.
//   Touch:    left stick runs; flick it up to jump (again in the air for a
//             double jump); hold it down on a platform to drop through.
//             Right side, "twin-stick": a second stick, push it to aim + fire.
//             Right side, "tap": tap to fire at that spot, hold to rapid-fire.
//             FLAME: a small button in the corner.
//   Settings: auto-fire (assisted aim) and auto flame, both optional.
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
  stick: { id: null, ox: 0, oy: 0, x: 0, y: 0, upLatch: false }, // left: move / jump
  aim: { id: null, ox: 0, oy: 0, x: 0, y: 0 }, // right: twin-stick aim + fire
  buttons: { flame: false },
  mouse: { x: W / 2, y: H / 2, zap: false, flame: false },
  fingers: new Map(), // tap mode: pointerId -> {x, y} (screen coords)
  aimFinger: null,
  jumpQueued: false,
  shots: [], // queued taps: world points to fire at
};

// --------------------------------------------------------------- Settings ---
const settings = {
  autoFire: false, // the energy ball fires on its own at the nearest enemy
  autoFlame: false, // the flame lights itself when enemies are close
  touchAim: "twin", // touch, when auto-fire is off: "twin" (right stick) or "tap"
};
try {
  Object.assign(settings, JSON.parse(localStorage.getItem("cp2d77-settings") || "{}"));
  if (localStorage.getItem("cp2d77-scheme") === "gestures") settings.touchAim = "tap"; // older saves
} catch (err) {
  /* storage unavailable */
}

function applySettings() {
  const tap = settings.touchAim === "tap" && !settings.autoFire;
  document.body.classList.toggle("aim-tap", tap);
  document.body.classList.toggle("aim-twin", !tap);
  document.querySelectorAll("[data-setting]").forEach((b) => {
    const value = settings[b.dataset.setting];
    b.setAttribute("aria-pressed", String(String(value) === b.dataset.value));
  });
  try {
    localStorage.setItem("cp2d77-settings", JSON.stringify(settings));
  } catch (err) {
    /* storage unavailable */
  }
}
document.querySelectorAll("[data-setting]").forEach((b) =>
  b.addEventListener("click", () => {
    const key = b.dataset.setting;
    settings[key] = typeof settings[key] === "boolean" ? b.dataset.value === "true" : b.dataset.value;
    applySettings();
    clearInput();
  })
);

// ---------------------------------------------------------------- Queries ---
function keyHeld(action) {
  for (const code of input.keys) if (KEYMAP[code] === action) return true;
  return false;
}

// Movement from the left stick or the keys, each in -1..1
function moveAxis() {
  const s = input.stick;
  if (s.id !== null && (s.x || s.y)) return { x: s.x, y: s.y, analog: true };
  return {
    x: (keyHeld("right") ? 1 : 0) - (keyHeld("left") ? 1 : 0),
    y: (keyHeld("down") ? 1 : 0) - (keyHeld("up") ? 1 : 0),
    analog: false,
  };
}
const aimStickActive = () => input.aim.id !== null && Math.hypot(input.aim.x, input.aim.y) > 0.35;
const zapHeld = () => keyHeld("zap") || input.mouse.zap || input.fingers.size > 0 || aimStickActive();
const flameHeld = () => keyHeld("flame") || input.buttons.flame || input.mouse.flame;
const jumpHeld = () => keyHeld("jump") || (input.stick.id !== null && input.stick.y < -0.4);

// World position the firing finger is pointing at (tap mode)
function fingerAim() {
  const f = input.fingers.get(input.aimFinger);
  return f ? clientToWorld(f.x, f.y) : null;
}

function clearInput() {
  input.keys.clear();
  input.buttons.flame = false;
  input.mouse.zap = input.mouse.flame = false;
  input.fingers.clear();
  input.aimFinger = null;
  input.jumpQueued = false;
  input.shots.length = 0;
  leftStick.release();
  rightStick.release();
  document.querySelectorAll(".action-btn.pressed").forEach((b) => b.classList.remove("pressed"));
}

// Screen (client) coordinates -> world coordinates
function clientToWorld(clientX, clientY) {
  const r = canvas.getBoundingClientRect();
  return {
    x: ((clientX - r.left) / r.width) * W + camera.x,
    y: ((clientY - r.top) / r.height) * H + camera.y,
  };
}

// --------------------------------------------------------------- Keyboard ---
addEventListener("keydown", (e) => {
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  SoundSystem.unlock();
  if (handleMenuKey(e)) return; // menus / level-up cards / breach (main.js)
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
addEventListener("blur", () => clearInput());

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

// A floating thumb-stick: it appears wherever the thumb lands in its zone.
function makeStick(zone, base, knob, state, onMove) {
  const radius = () => base.offsetWidth * 0.42 || 50;
  const place = (x, y) => {
    const size = base.offsetWidth;
    base.style.left = x - size / 2 + "px";
    base.style.top = y - size / 2 + "px";
    base.style.right = base.style.bottom = "auto";
  };
  const update = (e) => {
    const r = radius();
    let dx = e.clientX - state.ox;
    let dy = e.clientY - state.oy;
    let d = Math.hypot(dx, dy);
    if (d > r) {
      // drag the stick along when the thumb slides past its edge
      state.ox += (dx * (d - r)) / d;
      state.oy += (dy * (d - r)) / d;
      place(state.ox, state.oy);
      dx = e.clientX - state.ox;
      dy = e.clientY - state.oy;
      d = r;
    }
    knob.style.transform = `translate(${dx}px, ${dy}px)`;
    const mag = d / r;
    const dead = 0.2;
    if (mag < dead) {
      state.x = state.y = 0;
    } else {
      const k = Math.min(1, ((mag - dead) / (1 - dead)) * 1.15) / mag;
      state.x = (dx / r) * k;
      state.y = (dy / r) * k;
    }
    if (onMove) onMove(state);
  };
  const release = () => {
    state.id = null;
    state.x = state.y = 0;
    state.upLatch = false;
    base.classList.remove("active");
    base.style.left = base.style.top = base.style.right = base.style.bottom = "";
    knob.style.transform = "";
  };
  zone.addEventListener("pointerdown", (e) => {
    if (state.id !== null) return;
    e.preventDefault();
    SoundSystem.unlock();
    state.id = e.pointerId;
    try {
      zone.setPointerCapture(e.pointerId);
    } catch (err) {
      /* ignore */
    }
    state.ox = e.clientX;
    state.oy = e.clientY;
    place(e.clientX, e.clientY);
    base.classList.add("active");
    update(e);
  });
  zone.addEventListener("pointermove", (e) => {
    if (e.pointerId === state.id) update(e);
  });
  ["pointerup", "pointercancel", "lostpointercapture"].forEach((type) =>
    zone.addEventListener(type, (e) => {
      if (e.pointerId === state.id) release();
    })
  );
  return { release };
}

// Left stick: run, flick up to jump
const leftStick = makeStick(
  document.getElementById("stick-zone"),
  document.getElementById("stick"),
  document.getElementById("stick-knob"),
  input.stick,
  (s) => {
    if (s.y < -0.55 && !s.upLatch) {
      s.upLatch = true;
      input.jumpQueued = true;
    } else if (s.y > -0.3) {
      s.upLatch = false;
    }
  }
);

// Right stick: aim and fire (twin-stick)
const rightStick = makeStick(document.getElementById("aim-zone"), document.getElementById("aim-stick"), document.getElementById("aim-knob"), input.aim);

// FLAME button
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
  });
  const release = () => {
    input.buttons[action] = false;
    btn.classList.remove("pressed");
  };
  btn.addEventListener("pointerup", release);
  btn.addEventListener("pointercancel", release);
  btn.addEventListener("lostpointercapture", release);
});

// Tap mode: every tap fires once toward that exact spot; keep a finger down to
// keep firing, and drag it to aim.
gestureZone.addEventListener("pointerdown", (e) => {
  e.preventDefault();
  SoundSystem.unlock();
  try {
    gestureZone.setPointerCapture(e.pointerId);
  } catch (err) {
    /* ignore */
  }
  input.fingers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  input.aimFinger = e.pointerId;
  // Guarantee a shot even for a tap shorter than one frame
  if (game.state === "playing" && input.shots.length < 2) input.shots.push(clientToWorld(e.clientX, e.clientY));
  pulseTap(e.clientX, e.clientY);
});
gestureZone.addEventListener("pointermove", (e) => {
  const f = input.fingers.get(e.pointerId);
  if (f) {
    f.x = e.clientX;
    f.y = e.clientY;
  }
});
function liftFinger(e) {
  input.fingers.delete(e.pointerId);
  if (input.aimFinger === e.pointerId) {
    const rest = [...input.fingers.keys()];
    input.aimFinger = rest.length ? rest[rest.length - 1] : null;
  }
}
["pointerup", "pointercancel", "lostpointercapture"].forEach((type) => gestureZone.addEventListener(type, liftFinger));

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
[touchUI, canvas].forEach((el) => el.addEventListener("contextmenu", (e) => e.preventDefault()));
document.addEventListener("gesturestart", (e) => e.preventDefault()); // iOS pinch-zoom

function vibrate(ms) {
  if (touchMode && navigator.vibrate) navigator.vibrate(ms);
}

applySettings();
