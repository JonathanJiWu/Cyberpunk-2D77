"use strict";
// =============================================================================
// Game controllers, through the standard Gamepad API (the same in Chrome and
// in the Electron build).
//   Pads:     Xbox (XInput), PlayStation DualShock 4 / DualSense and generic
//             USB / Bluetooth pads. Pads without the "standard" mapping get a
//             fallback: axes 0/1 run, axes 2/3 or 3/4 aim, buttons 0-3 are the
//             face buttons.
//   Playing:  left stick / D-pad run, A jumps (Down + A drops through), RT or
//             RB fires, LT or LB is the special (held for Paine's flame), the
//             right stick aims and fires like the touch twin-stick, Start
//             pauses. It all goes through the shared input model (input.pad,
//             input.aim, input.jumpQueued, input.specialQueued in input.js).
//   Menus:    the D-pad / left stick move a neon focus ring around whatever
//             screen is on top. A clicks, B is Escape, Y rerolls, Start
//             pauses / resumes / starts, Back opens the DATABASE.
//   Prompts:  padPrompt("A") is "A", "✕" or "1" for the pad in use, or null.
//             <body> gets pad-xbox / pad-ps / pad-generic / pad-none for the
//             last-used input device, [data-pad] elements are relabelled, and
//             a "padchange" event fires on window when the device changes.
//   Slots:    the first pad that gets used drives player 1, alongside the
//             keyboard and touch. Other pads stay unassigned; when one presses
//             Start or A, gamepads.onJoinRequest(padIndex) fires (the hook for
//             local co-op).
// It polls in its own requestAnimationFrame loop, so menus keep working while
// the game is paused.
// =============================================================================

const PAD = {
  dead: 0.2, // radial deadzone
  outer: 0.92, // full deflection a little before the rim
  curve: 1.5, // running response curve: fine control near the centre
  snap: 0.33, // rad: near-horizontal pushes don't aim or drop, near-vertical ones don't run
  triggerOn: 0.45, // analog triggers, with some hysteresis
  triggerOff: 0.25,
  navOn: 0.5, // the left stick as a D-pad in menus
  navOff: 0.35,
  repeatDelay: 0.38, // s: a held direction (or A in the terminal) repeats after this...
  repeatRate: 0.11, // ...this often
  scroll: 1100, // px/s at full right-stick deflection in long panels
  handover: 2.5, // s: with no co-op hook, an idle player-1 pad hands over to a pad pressing Start / A
};
const PAD_BUTTONS = ["A", "B", "X", "Y", "LB", "RB", "LT", "RT", "BACK", "START", "LS", "RS", "UP", "DOWN", "LEFT", "RIGHT", "HOME"];
const PAD_LABELS = {
  xbox: { A: "A", B: "B", X: "X", Y: "Y", LB: "LB", RB: "RB", LT: "LT", RT: "RT", START: "MENU", BACK: "VIEW" },
  ps: { A: "✕", B: "○", X: "□", Y: "△", LB: "L1", RB: "R1", LT: "L2", RT: "R2", START: "OPTIONS", BACK: "SHARE" },
  generic: { A: "1", B: "2", X: "3", Y: "4", LB: "L1", RB: "R1", LT: "L2", RT: "R2", START: "START", BACK: "SELECT" },
};

const gamepads = {
  supported: typeof navigator.getGamepads === "function",
  pads: new Map(), // Gamepad.index -> { index, id, type, name, slot, held, pressed, move, aim, ... }
  slots: [null], // slot -> pad index. Slot 0 is player 1 (with the keyboard and touch)
  device: null, // the last-used input device: "xbox" | "ps" | "generic" | "none"
  onJoinRequest: null, // (padIndex) => {}: an unassigned pad pressed Start or A
  onSlotPoll: null, // (screen, dt) => {}: every poll, after player 1's pad (co-op drives slot 1's)
  poll: (now) => padPoll(now === undefined ? performance.now() : now), // the rAF loop calls this; tests can too
  read: (slot = 0) => padRead(slot), // the latest processed input of the pad in a slot, or null
  assign: (padIndex, slot = 0) => padAssign(padIndex, slot),
  release: (slot = 0) => padAssign(null, slot),
  rumble: (slot, strong, weak, ms) => padRumble(slot, strong, weak, ms),
};

// "A" | "B" | "X" | "Y" | "LB" | "RB" | "LT" | "RT" | "START" | "BACK" -> the
// label printed on the pad in use, or null when the player isn't on a pad
function padPrompt(button) {
  const labels = PAD_LABELS[gamepads.device];
  return (labels && labels[String(button).toUpperCase()]) || null;
}

function padTypeOf(id) {
  const s = String(id || "").toLowerCase();
  if (/054c|dualsense|dualshock|wireless controller|playstation|\bps[345]\b/.test(s)) return "ps";
  if (/045e|xbox|xinput|x-box/.test(s)) return "xbox";
  return "generic";
}

function padNameOf(id, type) {
  const s = String(id || "").toLowerCase();
  if (type === "xbox") return "Xbox";
  if (type !== "ps") return "Generic";
  if (/dualsense|0ce6|0df2/.test(s)) return "DualSense";
  return /dualshock|05c4|09cc|wireless controller|\bps4\b/.test(s) ? "DualShock 4" : "PlayStation";
}

// --------------------------------------------------------- Connections -----
function padSync() {
  const live = [];
  if (!gamepads.supported) return live;
  let list = [];
  try {
    list = navigator.getGamepads() || [];
  } catch (err) {
    /* blocked by a permissions policy */
  }
  const seen = new Set();
  for (let i = 0; i < list.length; i++) {
    const gp = list[i];
    if (!gp || gp.connected === false) continue;
    const index = typeof gp.index === "number" ? gp.index : i;
    let p = gamepads.pads.get(index);
    if (p && p.id !== gp.id) {
      padDrop(index); // another pad took this index
      p = null;
    }
    if (!p) p = padAdd(gp, index);
    seen.add(index);
    live.push([p, gp]);
  }
  [...gamepads.pads.keys()].forEach((index) => seen.has(index) || padDrop(index));
  return live;
}

function padAdd(gp, index) {
  const type = padTypeOf(gp.id);
  const p = {
    index,
    id: gp.id,
    type,
    name: padNameOf(gp.id, type),
    layout: gp.mapping === "standard" ? null : padLayout(gp),
    slot: null,
    held: {},
    pressed: {},
    swallow: new Set(), // pressed in a menu: ignored by the game until released
    stick: { x: 0, y: 0, m: 0 }, // left stick, deadzoned (menus)
    move: { x: 0, y: 0 }, // left stick with the response curve, or the D-pad
    aim: { x: 0, y: 0, m: 0 }, // right stick, deadzoned
    fresh: false, // a new press or push this frame
    pushed: false,
    lastInput: -1e9,
    navDir: null,
    navT: 0,
    aT: 0,
  };
  gamepads.pads.set(index, p);
  padToast(`CONTROLLER CONNECTED: ${p.name}`);
  padSound("padConnect");
  return p;
}

function padDrop(index) {
  const p = gamepads.pads.get(index);
  if (!p) return;
  gamepads.pads.delete(index);
  if (p.slot !== null) gamepads.slots[p.slot] = null;
  padToast(`CONTROLLER DISCONNECTED: ${p.name}`, true);
  padSound("padDisconnect");
  if (p.slot !== 0) return;
  padReleaseGameplay();
  const inUse = gamepads.device !== "none";
  padSetDevice("none");
  // Lost the controller mid-fight: pause, like a console does
  if (inUse && typeof game !== "undefined" && game.state === "playing") pauseGame();
}

// Pads without the standard mapping: where are the right stick, the triggers
// and the D-pad? Triggers rest at one end (-1), a POV hat rests off the scale.
function padLayout(gp) {
  const rest = Array.from(gp.axes || [], (v) => (Number.isFinite(v) ? v : 0));
  const n = rest.length;
  const hat = rest.findIndex((v) => Math.abs(v) > 1.05);
  const trigger = (i) => i !== hat && Math.abs(rest[i]) > 0.5;
  const stick = (i) => i < n && i !== hat && !trigger(i);
  let aim = null;
  for (const [a, b] of n >= 6 ? [[3, 4], [2, 3]] : [[2, 3], [3, 4]]) {
    if (stick(a) && stick(b)) {
      aim = [a, b];
      break;
    }
  }
  const triggers = [];
  for (let i = 2; i < n; i++) if (trigger(i)) triggers.push(i);
  const dpad = n >= 8 && stick(6) && stick(7) ? [6, 7] : null;
  return {
    rest,
    hat: hat >= 0 ? hat : null,
    aim,
    lt: triggers.length > 0 ? triggers[0] : null,
    rt: triggers.length > 1 ? triggers[1] : null,
    dpad,
    buttons: (gp.buttons || []).length,
    pending: rest.every((v) => v === 0), // no report yet: look again once one arrives
  };
}

// --------------------------------------------------------------- Reading ---
// Radial deadzone, rescaled so the stick goes 0..1 from the deadzone's edge
function padStick(x, y) {
  const m = Math.hypot(x, y);
  if (!(m > PAD.dead)) return { x: 0, y: 0, m: 0 };
  const t = Math.min(1, (m - PAD.dead) / (PAD.outer - PAD.dead));
  return { x: (x / m) * t, y: (y / m) * t, m: t };
}

// Running: a smooth curve, and near-straight pushes snap straight
function padCurve(s) {
  if (!s.m) return { x: 0, y: 0 };
  const k = Math.pow(s.m, PAD.curve);
  let x = (s.x / s.m) * k;
  let y = (s.y / s.m) * k;
  const tilt = Math.atan2(Math.abs(y), Math.abs(x));
  if (tilt < PAD.snap) y = 0;
  else if (tilt > Math.PI / 2 - PAD.snap) x = 0;
  return { x, y };
}

function padUpdate(p, gp, now) {
  const B = gp.buttons || [];
  const X = gp.axes || [];
  const value = (i) => {
    const b = B[i];
    if (b === undefined || b === null) return 0;
    if (typeof b === "number") return b;
    return b.value > 0 ? b.value : b.pressed ? 1 : 0;
  };
  const down = (i) => value(i) > 0.5;
  const axis = (i) => (i !== null && i < X.length && Number.isFinite(X[i]) ? X[i] : 0);
  if (p.layout && p.layout.pending && Array.prototype.some.call(X, (v) => v)) p.layout = padLayout(gp);
  const L = p.layout;
  const h = { A: down(0), B: down(1), X: down(2), Y: down(3), LB: down(4), RB: down(5), BACK: down(8), START: down(9), LS: down(10), RS: down(11), HOME: down(16) };
  let lt = value(6);
  let rt = value(7);
  let up = down(12);
  let dn = down(13);
  let lf = down(14);
  let rg = down(15);
  let rx = axis(2);
  let ry = axis(3);
  if (L) {
    rx = L.aim ? axis(L.aim[0]) : 0;
    ry = L.aim ? axis(L.aim[1]) : 0;
    const pull = (i) => (i === null ? 0 : Math.max(0, Math.min(1, (axis(i) - L.rest[i]) / (-Math.sign(L.rest[i]) - L.rest[i]))));
    if (L.buttons <= 8) {
      // small pads: 0-3 face, 4/5 shoulders, 6/7 select / start
      h.BACK = down(6);
      h.START = down(7);
      lt = rt = 0;
    }
    lt = Math.max(lt, pull(L.lt));
    rt = Math.max(rt, pull(L.rt));
    h.HOME = false;
    if (L.buttons < 16) up = dn = lf = rg = false; // buttons 12+ aren't a D-pad there
    if (L.dpad) {
      const dx = axis(L.dpad[0]);
      const dy = axis(L.dpad[1]);
      lf = lf || dx < -0.5;
      rg = rg || dx > 0.5;
      up = up || dy < -0.5;
      dn = dn || dy > 0.5;
    }
    if (L.hat !== null) {
      const v = axis(L.hat);
      if (v >= -1.05 && v <= 1.05) {
        const d = Math.round(((v + 1) / 2) * 7); // 0 up, 1 up-right ... 7 up-left
        up = up || d === 0 || d === 1 || d === 7;
        rg = rg || (d >= 1 && d <= 3);
        dn = dn || (d >= 3 && d <= 5);
        lf = lf || d >= 5;
      }
    }
  }
  h.LT = lt > (p.held.LT ? PAD.triggerOff : PAD.triggerOn);
  h.RT = rt > (p.held.RT ? PAD.triggerOff : PAD.triggerOn);
  h.UP = up;
  h.DOWN = dn;
  h.LEFT = lf;
  h.RIGHT = rg;

  p.stick = padStick(axis(0), axis(1));
  p.aim = padStick(rx, ry);
  p.move = up || dn || lf || rg ? { x: (rg ? 1 : 0) - (lf ? 1 : 0), y: (dn ? 1 : 0) - (up ? 1 : 0) } : padCurve(p.stick);

  let fresh = false;
  let any = false;
  PAD_BUTTONS.forEach((n) => {
    p.pressed[n] = !!h[n] && !p.held[n];
    fresh = fresh || p.pressed[n];
    any = any || !!h[n];
    if (!h[n]) p.swallow.delete(n);
  });
  p.held = h;
  const pushed = Math.max(p.stick.m, p.aim.m) > 0.5;
  p.fresh = fresh || (pushed && !p.pushed);
  p.pushed = pushed;
  if (any || pushed) p.lastInput = now;
}

function padRead(slot) {
  const p = gamepads.pads.get(gamepads.slots[slot]);
  if (!p) return null;
  return { index: p.index, type: p.type, name: p.name, move: { ...p.move }, aim: { x: p.aim.x, y: p.aim.y }, held: { ...p.held }, pressed: { ...p.pressed } };
}

// ----------------------------------------------------------------- Slots ---
function padAssign(index, slot) {
  const old = gamepads.pads.get(gamepads.slots[slot]);
  if (old) old.slot = null;
  gamepads.slots[slot] = null;
  const p = index === null ? null : gamepads.pads.get(index);
  if (p) {
    if (p.slot !== null) gamepads.slots[p.slot] = null;
    p.slot = slot;
    gamepads.slots[slot] = p.index;
  }
  if (slot === 0) padReleaseGameplay();
  return !!p;
}

function padJoin(p, now) {
  if (typeof gamepads.onJoinRequest === "function") {
    gamepads.onJoinRequest(p.index);
    return;
  }
  // No co-op yet: if player 1's pad has gone quiet, this one takes over
  const p1 = gamepads.pads.get(gamepads.slots[0]);
  if (!p1 || now - p1.lastInput > PAD.handover * 1000) {
    padAssign(p.index, 0);
    padToast(`PLAYER 1: ${p.name}`);
  }
}

// ------------------------------------------------------------------ Loop ---
let padClock = 0;
let padScreenKey = "";
const padMemory = {}; // screen -> the element that had the focus there

function padPoll(now) {
  const dt = padClock ? Math.min(0.1, Math.max(0, (now - padClock) / 1000)) : 0;
  padClock = now;
  padSync().forEach(([p, gp]) => padUpdate(p, gp, now));
  if (typeof game === "undefined") return; // main.js is still loading
  // Player 1 is the first pad that gets used; the others wait for co-op
  gamepads.pads.forEach((p) => {
    if (p.slot !== null || !p.fresh) return;
    if (gamepads.slots[0] === null) padAssign(p.index, 0);
    else if (p.pressed.START || p.pressed.A) padJoin(p, now);
  });
  const p1 = gamepads.pads.get(gamepads.slots[0]);
  if (p1 && p1.fresh) padSetDevice(p1.type);
  const screen = padScreen();
  if (screen.name === "game") {
    padScreenKey = "";
    if (p1) padGameplay(p1);
    else padReleaseGameplay();
  } else {
    padReleaseGameplay();
    if (p1) padMenus(p1, screen, dt);
  }
  if (typeof gamepads.onSlotPoll === "function") gamepads.onSlotPoll(screen, dt); // the other players' pads (js/coop.js)
  padLegend(screen);
  padHaptics();
}

function padLoop(now) {
  requestAnimationFrame(padLoop);
  padPoll(now);
}

// -------------------------------------------------------------- Gameplay ---
function padGameplay(p) {
  const held = (n) => p.held[n] && !p.swallow.has(n);
  const press = (n) => p.pressed[n] && !p.swallow.has(n);
  const g = input.pad;
  g.x = p.move.x;
  g.y = p.move.y;
  g.zap = held("RT") || held("RB") || held("X");
  g.jump = held("A");
  if (press("A")) input.jumpQueued = true;
  // Specials: Paine's flame burns while held, Tetsu's dash and Sudo's hack fire on a press
  const ch = CHARACTERS[player.char] || CHARACTERS.paine;
  if (ch.special.hold) g.flame = held("LT") || held("LB") || held("B");
  else {
    g.flame = false;
    if (press("LT") || press("LB") || press("B")) input.specialQueued = true;
  }
  // Right stick: the twin-stick. Pushing it aims and fires that way, with or
  // without auto-fire (auto-fire only picks a target while it's centred)
  const a = input.aim;
  if (p.aim.m > 0) {
    if (a.id === null || a.id === "pad") {
      a.id = "pad";
      a.x = p.aim.x;
      a.y = p.aim.y;
    }
  } else if (a.id === "pad") {
    a.id = null;
    a.x = a.y = 0;
  }
  if (press("START")) pauseGame();
}

function padReleaseGameplay() {
  const g = input.pad;
  if (g) {
    g.x = g.y = 0;
    g.zap = g.flame = g.jump = false;
  }
  if (input.aim.id === "pad") {
    input.aim.id = null;
    input.aim.x = input.aim.y = 0;
  }
}

// ----------------------------------------------------------------- Menus ---
// The screen on top, in the same order handleMenuKey() (main.js) checks them
function padScreen() {
  const open = (id) => {
    const el = document.getElementById(id);
    return el && !el.hidden ? el : null;
  };
  for (const id of ["loadout", "respec", "codex", "leaderboard"]) if (open(id)) return { name: id, root: open(id) };
  if (game.state === "breach" && open("breach")) return { name: "breach", root: open("breach") };
  if (game.state === "levelup" && open("levelup")) return { name: "levelup", root: open("levelup") };
  if (open("overlay")) return { name: "overlay", root: open("overlay") };
  return { name: game.state === "playing" ? "game" : "none", root: null };
}

const PAD_FOCUSABLE = 'button, a[href], select, summary, input[type="range"], input[type="checkbox"], input[type="radio"], [tabindex]:not([tabindex="-1"])';
const padUsable = (el) => !!el && !el.disabled && el.getClientRects().length > 0 && getComputedStyle(el).visibility !== "hidden";
const padFocusables = (root) => (root ? [...root.querySelectorAll(PAD_FOCUSABLE)].filter(padUsable) : []);
const PAD_DEFAULT = { overlay: "#overlay-btn", loadout: "#drop-btn", levelup: "#cards > *", respec: "#respec-apply", codex: '[data-tab][aria-pressed="true"]', leaderboard: "#lb-close" };
const PAD_SCROLL = { overlay: ".panel", loadout: ".levelup-panel", levelup: ".levelup-panel", respec: ".levelup-panel", codex: ".codex-body", leaderboard: ".codex-body", breach: ".breach-term" };
const PAD_DIRS = { up: [0, -1, "ArrowUp"], down: [0, 1, "ArrowDown"], left: [-1, 0, "ArrowLeft"], right: [1, 0, "ArrowRight"] };

function padDefault(screen) {
  const el = PAD_DEFAULT[screen.name] && screen.root.querySelector(PAD_DEFAULT[screen.name]);
  return padUsable(el) ? el : padFocusables(screen.root)[0] || null;
}

function padFocus(el) {
  if (!el) return;
  el.focus({ preventScroll: true });
  try {
    el.scrollIntoView({ block: "nearest", inline: "nearest" });
  } catch (err) {
    /* old browsers */
  }
}

// The same key the keyboard would press, through the game's own key handlers
function padKey(code, repeat = false) {
  const e = {
    type: "keydown",
    code,
    key: { Enter: "Enter", Escape: "Escape", KeyR: "r" }[code] || code,
    repeat,
    isComposing: false,
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    shiftKey: false,
    target: document.activeElement || document.body,
    defaultPrevented: false,
    preventDefault() {
      this.defaultPrevented = true;
    },
    stopPropagation() {},
    stopImmediatePropagation() {},
  };
  return handleMenuKey(e);
}

function padMenus(p, screen, dt) {
  // Whatever is pressed in a menu is used up: A on "Drop In" must not jump too
  PAD_BUTTONS.forEach((n) => p.pressed[n] && p.swallow.add(n));
  if (!screen.root) return;
  padFocusScreen(screen);
  const dir = padNavDir(p);
  if (dir !== p.navDir) {
    p.navDir = dir;
    p.navT = PAD.repeatDelay;
    if (dir) padMove(screen, dir, false);
  } else if (dir && (p.navT -= dt) <= 0) {
    p.navT = PAD.repeatRate;
    padMove(screen, dir, true);
  }
  const press = (n) => p.pressed[n];
  if (press("A")) {
    p.aT = PAD.repeatDelay;
    padActivate(screen);
  } else if (p.held.A && screen.name === "breach" && (p.aT -= dt) <= 0) {
    p.aT = PAD.repeatRate;
    padKey("Enter", true); // hold A to keep typing, like a held key
  } else if (press("B")) padKey("Escape");
  else if (press("Y")) {
    if (screen.name === "levelup") padKey("KeyR"); // reroll, same as R
  } else if (press("START")) padStart(screen);
  else if (press("BACK")) padBack(screen);
  else if ((press("LB") || press("RB")) && screen.name === "codex") padTab(press("RB") ? 1 : -1);
  if (Math.abs(p.aim.y) > 0.2) padScroll(screen, p.aim.y * PAD.scroll * dt);
  const el = document.activeElement;
  if (el && el !== document.body && screen.root.contains(el)) padMemory[screen.name] = el;
}

// A new screen: put the focus somewhere visible (where it was last time, or
// on the screen's main button)
function padFocusScreen(screen) {
  const key = screen.name + ":" + game.state;
  if (key === padScreenKey) return;
  padScreenKey = key;
  if (gamepads.device === "none" || screen.name === "breach") return;
  const el = document.activeElement;
  if (el && screen.root.contains(el) && padUsable(el)) return;
  const mem = padMemory[screen.name];
  padFocus(mem && mem.isConnected && screen.root.contains(mem) && padUsable(mem) ? mem : padDefault(screen));
}

function padNavDir(p) {
  if (p.held.UP) return "up";
  if (p.held.DOWN) return "down";
  if (p.held.LEFT) return "left";
  if (p.held.RIGHT) return "right";
  const { x, y } = p.stick;
  if (Math.max(Math.abs(x), Math.abs(y)) < (p.navStick ? PAD.navOff : PAD.navOn)) {
    p.navStick = false;
    return null;
  }
  p.navStick = true;
  if (Math.abs(x) > Math.abs(y)) return x > 0 ? "right" : "left";
  return y > 0 ? "down" : "up";
}

function padMove(screen, dir, repeat) {
  const [dx, dy, code] = PAD_DIRS[dir];
  if (screen.name === "breach") {
    padKey(code, repeat); // the terminal's own cursor
    return;
  }
  const items = padFocusables(screen.root);
  const el = document.activeElement;
  if (items.indexOf(el) < 0) {
    padFocus(padDefault(screen));
    return;
  }
  if (dx && el.type === "range") {
    padNudge(el, dx);
    return;
  }
  if (dx && el.classList.contains("char-card")) {
    padKey(code, repeat); // left / right cycle the IC tiles, however they're laid out (select.js)
    return;
  }
  const next = padNearest(el, items, dx, dy);
  if (next) padFocus(next);
  else if (dy) padScroll(screen, dy * 160); // nothing further: scroll the panel instead
}

// Spatial navigation: the closest element in that direction, preferring ones
// in the same row / column
function padNearest(from, items, dx, dy) {
  const a = from.getBoundingClientRect();
  const ax = a.left + a.width / 2;
  const ay = a.top + a.height / 2;
  let best = null;
  let bestScore = Infinity;
  items.forEach((el) => {
    if (el === from) return;
    const b = el.getBoundingClientRect();
    const bx = b.left + b.width / 2;
    const by = b.top + b.height / 2;
    const along = dx ? (bx - ax) * dx : (by - ay) * dy;
    const size = dx ? Math.min(a.width, b.width) : Math.min(a.height, b.height);
    if (along < Math.max(4, size * 0.3)) return;
    const gap = dx ? Math.max(0, Math.max(a.top, b.top) - Math.min(a.bottom, b.bottom)) : Math.max(0, Math.max(a.left, b.left) - Math.min(a.right, b.right));
    const across = dx ? Math.abs(by - ay) : Math.abs(bx - ax);
    const score = along + gap * 1.5 + across * 0.2;
    if (score < bestScore) {
      bestScore = score;
      best = el;
    }
  });
  return best;
}

function padNudge(el, dir) {
  const min = Number(el.min || 0);
  const max = Number(el.max || 100);
  const v = Math.max(min, Math.min(max, Number(el.value) + dir * 5));
  if (v === Number(el.value)) return;
  el.value = v;
  el.dispatchEvent(new Event("input", { bubbles: true }));
  el.dispatchEvent(new Event("change", { bubbles: true }));
}

function padScroll(screen, px) {
  const el = PAD_SCROLL[screen.name] && screen.root.querySelector(PAD_SCROLL[screen.name]);
  if (el) el.scrollTop += px;
}

// A: click the focused element
function padActivate(screen) {
  const el = document.activeElement;
  if (screen.name === "breach") {
    if (el && el.id === "breach-exit") el.click();
    else padKey("Enter");
    return;
  }
  if (el && el.tagName === "INPUT" && /^(text|search|)$/.test(el.type) && screen.root.contains(el)) {
    // a text field (the leaderboard name): no typing needed, A saves what's there
    const btn = el.parentElement && el.parentElement.querySelector("button:not(:disabled)");
    if (btn) btn.click();
    return;
  }
  const items = padFocusables(screen.root);
  const i = items.indexOf(el);
  if (i < 0) {
    padFocus(padDefault(screen)); // nothing focused here yet (touch screens never auto-focus)
    return;
  }
  if (el.type === "range") return;
  el.click();
  // Some clicks re-render their buttons (the IC cards): keep the focus in place
  const now = padScreen();
  if (now.root === screen.root && !screen.root.contains(document.activeElement)) {
    const again = padFocusables(screen.root);
    padFocus(again[Math.min(i, again.length - 1)]);
  }
}

function padStart(screen) {
  if (screen.name === "overlay") {
    if (game.state === "paused") resumeGame();
    else overlayPrimary(); // Start Game / Play Again / Try Again
  } else if (screen.name === "loadout") dropIn();
  else if (screen.name === "codex" || screen.name === "leaderboard" || screen.name === "respec") padKey("Escape");
}

function padBack(screen) {
  if (screen.name === "overlay") {
    const btn = document.getElementById("codex-btn");
    if (padUsable(btn)) btn.click();
  } else if (screen.name === "codex") padKey("Escape");
}

function padTab(dir) {
  const tabs = [...document.querySelectorAll("#codex [data-tab]")].filter(padUsable);
  if (!tabs.length) return;
  const cur = Math.max(0, tabs.findIndex((t) => t.getAttribute("aria-pressed") === "true"));
  const next = tabs[(cur + dir + tabs.length) % tabs.length];
  next.click();
  padFocus(next);
}

// ------------------------------------------------------- Device + prompts ---
function padSetDevice(type) {
  if (gamepads.device === type) return;
  gamepads.device = type;
  document.body.classList.remove("pad-xbox", "pad-ps", "pad-generic", "pad-none");
  document.body.classList.add("pad-" + type);
  document.querySelectorAll("[data-pad]").forEach((el) => padLabel(el, padPrompt(el.dataset.pad) || el.dataset.pad));
  dispatchEvent(new CustomEvent("padchange", { detail: { type: type === "none" ? null : type } }));
}
padSetDevice("none");
// The keyboard, mouse or touch takes over the prompts again
addEventListener("keydown", () => padSetDevice("none"), true);
addEventListener("pointerdown", () => padSetDevice("none"), true);
addEventListener("wheel", () => padSetDevice("none"), { capture: true, passive: true });

// ✕ ○ □ △ aren't in the pixel font: the fallback font draws them small, so
// they get the "pad-sym" class (bigger)
function padIsSymbol(label) {
  return /[^ -~]/.test(label);
}
function padLabel(el, label) {
  el.textContent = label;
  el.classList.toggle("pad-sym", padIsSymbol(label));
}

// In-game hints (drawHints in render.js): rows of [button, action], or null
function padHintRows() {
  if (!padPrompt("A")) return null;
  const ch = CH();
  return [
    ["L-STICK", "MOVE    R-STICK: AIM+FIRE"],
    [padPrompt("A"), "JUMP x2  (DOWN+JUMP: DROP)"],
    [padPrompt("RT"), ch.primary.name.toUpperCase()],
    [padPrompt("LT"), ch.special.name.toUpperCase() + (ch.special.hold ? " (HOLD)" : "")],
    [padPrompt("START"), "PAUSE"],
  ];
}

// A one-line button legend for the screen on top
const padLegendEl = document.createElement("div");
padLegendEl.className = "pad-legend";
padLegendEl.setAttribute("aria-hidden", "true");
padLegendEl.hidden = true;
document.body.append(padLegendEl);
let padLegendKey = "";

function padLegendRows(screen) {
  const state = game.state;
  switch (screen.name) {
    case "overlay":
      return [["A", "SELECT"], ["START", state === "paused" ? "RESUME" : state === "over" ? "PLAY AGAIN" : "START"], ["BACK", "DATABASE"]];
    case "loadout":
      return [["A", "PICK"], ["START", "DROP IN"], ["B", "BACK"]];
    case "levelup":
      return [["A", "INSTALL"], ["Y", "REROLL"]];
    case "respec":
      return [["A", "SELECT"], ["B", "CANCEL"]];
    case "codex":
      return [["LB", "RB", "TABS"], ["R-STICK", "SCROLL"], ["B", "CLOSE"]];
    case "leaderboard":
      return [["R-STICK", "SCROLL"], ["B", "CLOSE"]];
    case "breach":
      return [["A", "HACK"], ["D-PAD", "CHOOSE"], ["B", "JACK OUT"]];
    default:
      return null;
  }
}

function padLegend(screen) {
  const rows = gamepads.device !== "none" && gamepads.slots[0] !== null ? padLegendRows(screen) : null;
  const key = rows ? gamepads.device + JSON.stringify(rows) : "";
  if (key === padLegendKey) return;
  padLegendKey = key;
  padLegendEl.textContent = "";
  padLegendEl.hidden = !rows;
  if (!rows) return;
  rows.forEach((row) => {
    const item = document.createElement("span");
    row.slice(0, -1).forEach((b) => {
      const k = document.createElement("b");
      k.className = "pad-key";
      padLabel(k, padPrompt(b) || b);
      item.append(k);
    });
    item.append(row[row.length - 1]);
    padLegendEl.append(item);
  });
}

// "CONTROLLER CONNECTED: Xbox"
const padToastEl = document.createElement("div");
padToastEl.className = "pad-toast";
padToastEl.setAttribute("role", "status");
padToastEl.hidden = true;
document.body.append(padToastEl);
let padToastTimer = 0;

function padToast(text, off) {
  padToastEl.textContent = text;
  padToastEl.classList.toggle("off", !!off);
  padToastEl.hidden = false;
  padToastEl.style.animation = "none";
  void padToastEl.offsetWidth; // restart the CSS animation
  padToastEl.style.animation = "";
  clearTimeout(padToastTimer);
  padToastTimer = setTimeout(() => (padToastEl.hidden = true), 2600);
}

// synth (js/synthfx.js) is optional: no sound is better than a crash
function padSound(name) {
  try {
    if (typeof synth !== "undefined" && synth && typeof synth.play === "function") synth.play(name);
  } catch (err) {
    /* no synth */
  }
}

// ---------------------------------------------------------------- Rumble ---
if (typeof settings.rumble !== "boolean") settings.rumble = true;
applySettings(); // so the Rumble On/Off buttons show the setting

function padRumble(slot, strong, weak, ms) {
  if (settings.rumble === false || (slot === 0 && gamepads.device === "none")) return false;
  const p = gamepads.pads.get(gamepads.slots[slot]);
  if (!p) return false;
  try {
    const gp = navigator.getGamepads()[p.index];
    const act = gp && gp.vibrationActuator;
    const haptic = gp && gp.hapticActuators && gp.hapticActuators[0];
    let done = null;
    if (act && typeof act.playEffect === "function") done = act.playEffect("dual-rumble", { startDelay: 0, duration: ms, strongMagnitude: strong, weakMagnitude: weak });
    else if (haptic && typeof haptic.pulse === "function") done = haptic.pulse(Math.max(strong, weak), ms); // Firefox
    else return false;
    if (done && typeof done.catch === "function") done.catch(() => {});
    return true;
  } catch (err) {
    return false; // no motors, or not allowed
  }
}

// Taking damage and hero landings (yours, and the GOAT crashing down)
const padFx = { hurt: 0, land: 0 };
function padHaptics() {
  const hurt = game.hurtFlash || 0;
  const land = game.landFlash || 0;
  if (game.state === "playing") {
    if (hurt > padFx.hurt + 0.05) padRumble(0, 0.45, 0.9, 180);
    if (land > padFx.land + 0.05) padRumble(0, 1, 0.6, 320);
  }
  padFx.hurt = hurt;
  padFx.land = land;
}

if (gamepads.supported) {
  // The loop notices pads coming and going too; the events just make it instant
  addEventListener("gamepadconnected", () => padSync());
  addEventListener("gamepaddisconnected", () => padSync());
  requestAnimationFrame(padLoop);
}
