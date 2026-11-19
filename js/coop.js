"use strict";
// =============================================================================
// Local co-op: a second player on a second controller.
//
// The game was written around ONE global `player`, with `stats`, `input`,
// `intro` and the hero effect arrays next to it. Rather than threading a
// player argument through every system, each player gets a context holding
// its own copies, and bindPlayer() points those globals at it while a
// per-player system runs: movement, the kit, auto weapons, projectiles,
// drawing and the HUD panel. Outside those calls the globals point at player 1,
// so a single-player run takes exactly the same code paths as before.
//   Shared by the team: XP, levels and upgrades (`upg`, `progress`), the lives
//     pool, enemies, pickups, the camera, the assist settings and the easter
//     eggs (player 1's).
//   Per player: the body, HP, resource, stats (the shared upgrades on that
//     player's IC), input, the drop, projectiles and effects.
// Joining: an unassigned pad pressing Start / A (gamepad.js onJoinRequest).
// In a run, a small panel lets player 2 pick an IC, then they drop in; on the
// menus they are "ready" and drop in with player 1 when the run starts.
// =============================================================================

// Tuned with bot runs (both players on auto-fire and auto special): with these,
// each player takes about the damage a solo player does, the team loses about
// as many lives, and boss fights run a little longer than solo ones.
const COOP = {
  spawnRate: 1.5, // 2P: enemies spawn this much faster...
  maxAlive: 1.25, // ...more of them can be alive at once...
  enemyHp: 1.25, // ...with this much more HP
  bossHp: 1.4, // (1.6 made boss fights drag: each player gets about half a solo player's time on the boss)
  respawnDelay: 3, // s a downed player waits before dropping back in
  joinTimeout: 12, // s the join panel waits before dropping player 2 in anyway
  leashX: W - 260, // the farthest apart (centre to centre) the two can be...
  leashY: H - 330, // ...horizontally and vertically, so both stay on screen
  warpAfter: 1.5, // s too far apart vertically: the higher one is pulled down
  colors: ["#19f5ff", "#ffb020"], // outline and tag colours: P1 cyan, P2 amber
};

function makePlayerContext(id, body, own) {
  return Object.assign(
    {
      id,
      label: "P" + (id + 1),
      color: COOP.colors[id],
      slot: id, // the gamepad slot that drives it (player 1 also has the keyboard and touch)
      player: body,
      stats: {},
      input: makeInputState(),
      intro: { active: false, phase: "", t: 0, vx: 0, vy: 0, kind: "drop" },
      shots: [],
      missiles: [],
      slashFx: [],
      hackFx: [],
      heatWaves: [],
      codeRain: [],
      kitFx: [],
      out: false, // down with no life left to respawn on: waits for one
      joining: null, // { t, char }: picking an IC in the join panel, not in the world yet
      prevX: body.x,
      farT: 0,
    },
    own
  );
}

// Player 1 owns the globals the rest of the game was written against
const coop = {
  players: [makePlayerContext(0, player, { stats, input, intro, shots: playerShots, missiles, slashFx, hackFx, heatWaves, codeRain, kitFx })],
  active: null, // the context the globals point at right now
  seat: null, // player 2's seat while their pad is assigned: { char }
  menuSlot: 0, // which player a pad-driven menu click is for
  dropX: null,
};
coop.active = coop.players[0];

// ------------------------------------------------------------- Binding ------
function bindPlayer(ctx) {
  coop.active = ctx;
  player = ctx.player;
  stats = ctx.stats;
  input = ctx.input;
  intro = ctx.intro;
  playerShots = ctx.shots;
  missiles = ctx.missiles;
  slashFx = ctx.slashFx;
  hackFx = ctx.hackFx;
  heatWaves = ctx.heatWaves;
  codeRain = ctx.codeRain;
  kitFx = ctx.kitFx;
}

// Run fn with the globals pointing at ctx, then put them back
function withPlayer(ctx, fn) {
  if (!ctx || ctx === coop.active) return fn(ctx);
  const prev = coop.active;
  bindPlayer(ctx);
  try {
    return fn(ctx);
  } finally {
    bindPlayer(prev);
  }
}

const coopActive = () => coop.players.length > 1;
const coopMul = (key) => (coop.players.length > 1 ? COOP[key] : 1);
const inWorld = (ctx) => !ctx.joining && !ctx.out; // can be hit, takes part
const targetable = (ctx) => inWorld(ctx) && !ctx.player.hidden; // enemies can see them
const P1 = () => coop.players[0];

// Every player (also downed ones): stats, healing, drawing
function forEachPlayer(fn) {
  if (coop.players.length < 2) return void withPlayer(coop.players[0], fn);
  coop.players.slice().forEach((ctx) => withPlayer(ctx, fn));
}

// Every player an attack can reach (single player: always player 1)
function eachTarget(fn) {
  if (coop.players.length < 2) return void withPlayer(coop.players[0], fn);
  coop.players.filter(inWorld).forEach((ctx) => withPlayer(ctx, fn));
}

// Is fn true for any player? (fn reads the bound globals)
function somePlayer(fn) {
  if (coop.players.length < 2) return !!withPlayer(coop.players[0], fn);
  return coop.players.some((ctx) => withPlayer(ctx, fn));
}

// The player the camera and the director go by: player 1 unless they're out
function coopLead() {
  return coop.players.find(targetable) || coop.players.find(inWorld) || coop.players[0];
}

// Who an enemy goes after: the nearest player it can see. A little
// stickiness stops it flip-flopping between two players the same distance
// away, and a boss commits to its target for a few seconds.
function coopTargetFor(e) {
  if (coop.players.length < 2) return coop.players[0];
  const live = coop.players.filter(targetable);
  if (live.length < 2) return (e.coopTarget = live[0] || coopLead());
  const ec = centerOf(e);
  const dist = (ctx) => {
    const c = centerOf(ctx.player);
    return Math.hypot(c.x - ec.x, c.y - ec.y);
  };
  const cur = live.includes(e.coopTarget) ? e.coopTarget : null;
  if (cur && e.boss && game.time < (e.coopUntil || 0)) return cur;
  let best = live.reduce((a, b) => (dist(b) < dist(a) ? b : a));
  if (cur && best !== cur && dist(best) > dist(cur) * 0.8) best = cur;
  e.coopTarget = best;
  if (e.boss) e.coopUntil = game.time + 2.5;
  return best;
}

// --------------------------------------------------------------- Seats ------
const coopName = (id) => (CHARACTERS[id] || CHARACTERS.paine).name;
const inRun = () => ["playing", "paused", "levelup", "breach"].includes(game.state);
// Player 2 starts as an IC other than player 1's
function coopDefaultChar() {
  const mine = inRun() ? P1().player.char : settings.character;
  return CHARACTER_ORDER.find((id) => id !== mine) || CHARACTER_ORDER[0];
}

// gamepad.js: an unassigned pad pressed Start or A
function coopJoinRequest(padIndex) {
  const pad = gamepads.pads.get(padIndex);
  if (!pad) return;
  // the press that asked to join does nothing else (no menu click, no jump)
  PAD_BUTTONS.forEach((n) => {
    pad.pressed[n] = false;
    if (pad.held[n]) pad.swallow.add(n);
  });
  if (coop.seat) {
    if (gamepads.slots[1] === null || gamepads.slots[1] === undefined) {
      gamepads.assign(padIndex, 1); // player 2 lost their pad: this one takes over
      const p2 = coop.players[1];
      if (p2) p2.padLost = false;
      padToast(`PLAYER 2: ${pad.name}`);
    } else padToast("CO-OP IS FULL: 2 PLAYERS");
    return;
  }
  gamepads.assign(padIndex, 1);
  coop.seat = { char: coopDefaultChar() };
  padSound("padConnect");
  if (inRun()) {
    coopAddPlayer(true);
    padToast(`PLAYER 2 JOINED: ${pad.name}`);
  } else {
    padToast(`PLAYER 2 READY: ${coopName(coop.seat.char)}`);
  }
  coopRefreshMenu(true);
}

// Keyboard player 1 with a single pad: hand that pad to player 2
function coopJoinWithP1Pad() {
  const index = gamepads.slots[0];
  if (coop.seat || index === null || index === undefined) return;
  coopJoinRequest(index);
  padSetDevice("none"); // player 1's prompts go back to the keyboard
}

// Player 2 into the current run: the join panel first (mid-run), or straight
// into the drop next to player 1 (a run starting with them ready)
function coopAddPlayer(panel) {
  if (!coop.seat || coop.players[1]) return null;
  const ctx = makePlayerContext(1, makePlayerBody());
  coop.players.push(ctx);
  game.coopRun = true;
  withPlayer(ctx, () => {
    freshPlayer(coop.seat.char);
    resetChrome(player);
  });
  if (panel) {
    ctx.joining = { t: 0, char: coop.seat.char, navDir: null };
    ctx.player.hidden = true;
  } else coopDrop(ctx, true);
  coopRescaleBoss();
  return ctx;
}

// Player 2 picked (or the panel timed out): into the world with the drop
function coopDrop(ctx, runStart) {
  const char = ctx.joining ? ctx.joining.char : coop.seat.char;
  ctx.joining = null;
  coop.seat.char = char;
  withPlayer(ctx, () => {
    if (player.char !== char) {
      freshPlayer(char);
      resetChrome(player);
    }
    player.hidden = false;
    if (runStart) {
      // off the same rooftop as player 1, a beat later
      startIntro("drop");
      player.x += 110;
      intro.t = -0.3;
    } else startIntro("join");
  });
}

// A context's run state goes; the seat (and pad) stay for the next run
function coopReset() {
  if (coop.players.length > 1) coop.players.length = 1;
  bindPlayer(coop.players[0]);
  P1().out = false;
  P1().joining = null;
  game.coopRun = false;
}

// startGame(): player 2 drops in alongside player 1
function coopStartRun() {
  if (!coop.seat) return;
  if (gamepads.slots[1] === null || gamepads.slots[1] === undefined) {
    coop.seat = null; // their pad went away on the menus
    return;
  }
  coopAddPlayer(false);
}

function coopLeave() {
  if (!coop.seat) return;
  const ctx = coop.players[1];
  coop.seat = null;
  gamepads.release(1);
  if (ctx) {
    const pc = centerOf(ctx.player);
    if (!ctx.player.hidden) {
      burst(pc.x, pc.y, 24, ctx.color, 380);
      ring(pc.x, pc.y, 140, ctx.color);
    }
    coop.players.splice(coop.players.indexOf(ctx), 1);
    if (coop.active === ctx) bindPlayer(coop.players[0]);
    coopRescaleBoss();
  }
  padToast("PLAYER 2 LEFT");
  coopRefreshMenu(true);
  // nobody left standing: the run is over
  if (inRun() && !coop.players.some(inWorld)) lose();
}

// A boss's HP follows the team size (joining or leaving mid-fight)
function coopRescaleBoss() {
  const b = game.boss;
  if (!b || b.dead) return;
  const want = coopMul("bossHp");
  const k = want / (b.coopHp || 1);
  if (k === 1) return;
  b.hp *= k;
  b.maxHp *= k;
  b.ghostHp *= k;
  b.coopHp = want;
}

// The char cards and pause buttons: a click from player 2's pad is theirs
function coopPickChar(id) {
  if (coop.menuSlot !== 1 || !coop.seat) return false;
  const ctx = coop.players[1];
  if (ctx && ctx.joining) ctx.joining.char = id;
  else if (ctx && game.state === "paused") withPlayer(ctx, () => switchCharacter(id));
  coop.seat.char = id;
  return true;
}

const coopJoinBtn = document.getElementById("coop-join-btn");
const coopLeaveBtn = document.getElementById("coop-leave-btn");
// cards: also redraw the IC cards (the P2 badge) when the seat changed
function coopRefreshMenu(cards) {
  const menus = ["menu", "paused", "over"].includes(game.state);
  if (coopLeaveBtn) coopLeaveBtn.hidden = !(menus && coop.seat);
  // (pause menu only: the title menu stays exactly as it is for one player)
  if (coopJoinBtn) coopJoinBtn.hidden = !(game.state === "paused" && !coop.seat && gamepads.slots[0] !== null && gamepads.slots[0] !== undefined);
  if (cards && !overlay.hidden) renderCharSelect();
}
// (the button hides itself: keep the focus on the menu)
const coopRefocus = () => !touchMode && overlay.contains(document.activeElement) && document.activeElement.hidden && overlayBtn.focus({ preventScroll: true });
if (coopLeaveBtn) coopLeaveBtn.addEventListener("click", () => (coopLeave(), coopRefocus()));
if (coopJoinBtn) coopJoinBtn.addEventListener("click", () => (coopJoinWithP1Pad(), coopRefocus()));
// (a pad taking player 1's slot shows "Pad to P2")
addEventListener("padchange", () => typeof game !== "undefined" && typeof overlay !== "undefined" && coopRefreshMenu());

// ---------------------------------------------------------------- Input -----
// gamepad.js calls this every poll for the pads beyond player 1's
function coopSlotPoll(screen, dt) {
  const pad = gamepads.pads.get(gamepads.slots[1]);
  if (!pad || !coop.seat) return;
  const ctx = coop.players[1];
  if (screen.name === "game") {
    if (!ctx) return;
    if (ctx.joining) return withPlayer(ctx, () => coopJoinPanelInput(ctx, pad));
    withPlayer(ctx, () => {
      if (!ctx.out) return padGameplay(pad);
      padReleaseGameplay(); // out: only the pause button still works
      if (pad.pressed.START && !pad.swallow.has("START")) pauseGame();
    });
    return;
  }
  if (ctx) withPlayer(ctx, () => padReleaseGameplay());
  // either pad can drive the menus (the level-up cards too); IC clicks are theirs
  coop.menuSlot = 1;
  try {
    padMenus(pad, screen, dt);
  } finally {
    coop.menuSlot = 0;
  }
}

// The join panel: left / right picks an IC, A or Start drops in, B backs out
function coopJoinPanelInput(ctx, pad) {
  const j = ctx.joining;
  const dir = padNavDir(pad);
  if (dir !== j.navDir) {
    j.navDir = dir;
    if (dir === "left" || dir === "right") {
      const order = CHARACTER_ORDER;
      const i = order.indexOf(j.char);
      j.char = order[(i + (dir === "right" ? 1 : -1) + order.length) % order.length];
      padSound("uiMove");
    }
  }
  if (pad.pressed.A || pad.pressed.START) {
    pad.swallow.add("A");
    pad.swallow.add("START");
    coopDrop(ctx);
  } else if (pad.pressed.B) coopLeave();
}

// ------------------------------------------------------------- Each frame ---
// Before the players move: the join panel's clock, respawns, a lost pad
function coopUpdate(dt) {
  if (coop.players.length < 2) return;
  coop.players.forEach((ctx) => {
    ctx.prevX = ctx.player.x;
    const p = ctx.player;
    if (ctx.joining && (ctx.joining.t += dt) > COOP.joinTimeout) coopDrop(ctx);
    if (ctx.out) {
      p.hidden = true;
      p.invuln = Math.max(p.invuln, 1);
      if (game.lives > 1) withPlayer(ctx, () => coopRevive(ctx)); // NULL gave a life back
    }
    if (ctx.id) {
      // (player 1's afterimages age in secrets.js)
      p.trail.forEach((t) => (t.t += dt));
      while (p.trail.length && p.trail[0].t > 0.4) p.trail.shift();
    }
  });
  const p2 = coop.players[1];
  if (p2 && !p2.padLost && (gamepads.slots[1] === null || gamepads.slots[1] === undefined)) {
    p2.padLost = true;
    game.banner = { text: "PLAYER 2: CONTROLLER LOST // PRESS A ON A PAD", time: 3, color: p2.color };
    pauseGame();
  }
}

// A downed player with no life to spend comes back once there is one
function coopRevive(ctx) {
  game.lives--;
  ctx.out = false;
  player.hidden = false;
  player.hp = player.ghostHp = stats.maxHp;
  player.heat = Math.max(player.heat, 40);
  player.invuln = 3;
  startIntro("respawn");
}

// lives.js: HP hit zero and there is no life left to respawn on. With a
// partner still standing, wait for a life; otherwise it's game over.
function coopKnockOut() {
  const ctx = coop.active;
  if (coop.players.length < 2 || !coop.players.some((c) => c !== ctx && inWorld(c))) return false;
  ctx.out = true;
  const p = player;
  const pc = centerOf(p);
  burst(pc.x, pc.y, 40, CH().color, 520);
  ring(pc.x, pc.y, 200, "#ff2457");
  p.hp = 0;
  p.hidden = true;
  p.dash = null;
  game.banner = { text: `${ctx.label} IS OUT // GRAB A LIFE TO BRING THEM BACK`, time: 2.6, color: ctx.color };
  return true;
}

// Where a respawn or a mid-run join falls in: next to the partner
function coopDropX() {
  if (coop.players.length < 2) return null;
  const mate = coop.players.find((c) => c !== coop.active && targetable(c) && !c.intro.active);
  if (!mate) return null;
  const m = mate.player;
  const side = m.x + m.w / 2 < camera.x + W / 2 ? 1 : -1;
  return clamp(m.x + side * 140, 0, WORLD_W - player.w);
}

// After the players move: keep both on one screen. Walking out of the view
// is stopped at the edge (whoever walked away gets held back), climbing too
// far above the other is capped, and a player stranded high above their
// partner for a while is pulled down next to them.
function coopLeash(dt) {
  if (coop.players.length < 2) return;
  const live = coop.players.filter((c) => targetable(c) && !c.intro.active);
  if (live.length < 2) return live.forEach((c) => (c.farT = 0));
  const [a, b] = live;
  const ca = a.player.x + a.player.w / 2;
  const cb = b.player.x + b.player.w / 2;
  const [L, R] = ca <= cb ? [a, b] : [b, a];
  const excess = Math.abs(cb - ca) - COOP.leashX;
  if (excess > 0) {
    const outL = Math.max(0, L.prevX - L.player.x);
    const outR = Math.max(0, R.player.x - R.prevX);
    const kL = outL + outR > 0 ? outL / (outL + outR) : 0.5;
    L.player.x += excess * kL;
    R.player.x -= excess * (1 - kL);
    if (L.player.vx < 0) L.player.vx = 0;
    if (R.player.vx > 0) R.player.vx = 0;
    if (L.player.kbX < 0) L.player.kbX = 0;
    if (R.player.kbX > 0) R.player.kbX = 0;
  }
  const [top, low] = a.player.y <= b.player.y ? [a, b] : [b, a];
  const gap = low.player.y - top.player.y;
  low.farT = 0;
  if (gap <= COOP.leashY) {
    top.farT = 0;
    return;
  }
  const t = top.player;
  if (t.vy < 0) {
    t.y += gap - COOP.leashY; // can't climb out of the view
    t.vy = 0;
  }
  top.farT += dt;
  if (gap > COOP.leashY + 120 && top.farT > COOP.warpAfter) {
    top.farT = 0;
    const l = low.player;
    burst(t.x + t.w / 2, t.y + t.h / 2, 16, top.color, 300);
    t.x = clamp(l.x + (l.x + l.w / 2 < camera.x + W / 2 ? 120 : -120), 0, WORLD_W - t.w);
    t.y = l.y - 160;
    t.vx = t.vy = 0;
    t.onGround = false;
    t.standingOn = null;
    t.dropTimer = 0.25;
    t.invuln = Math.max(t.invuln, 0.8);
    burst(t.x + t.w / 2, t.y + t.h / 2, 16, top.color, 300);
  }
}

// The camera frames both players (null: frame player 1 the usual way)
function coopFrame() {
  if (coop.players.length < 2) return null;
  const live = coop.players.filter((c) => targetable(c) && !c.intro.active);
  if (live.length < 2) return null;
  const cs = live.map((c) => centerOf(c.player));
  return { x: (cs[0].x + cs[1].x) / 2, y: (cs[0].y + cs[1].y) / 2 };
}

// ------------------------------------------------------------- Drawing ------
// A coloured outline around the hero (drawn before the sprite) and a tag
function coopOutline(cx, bottom, time) {
  if (coop.players.length < 2) return;
  const color = coop.active.color;
  const a = ctx.globalAlpha;
  ctx.globalAlpha = a * 0.85;
  for (const [dx, dy] of [[-3, 0], [3, 0], [0, -3], [0, 3]]) drawHeroSprite(cx + dx, bottom + dy, time, color);
  ctx.globalAlpha = a;
}

function coopTag(cx, top) {
  if (coop.players.length < 2) return;
  const c = coop.active;
  const y = top - 30;
  hudText(c.label, cx, y, 20, c.color, "center", "middle");
  ctx.fillStyle = c.color;
  ctx.beginPath();
  ctx.moveTo(cx - 8, y + 14);
  ctx.lineTo(cx + 8, y + 14);
  ctx.lineTo(cx, y + 22);
  ctx.closePath();
  ctx.fill();
}

// "RESPAWN 2.4" / "OUT" while a player isn't in the fight
function coopStatus(ctx) {
  if (!ctx || coop.players.length < 2) return null;
  if (ctx.out) return "OUT // NEEDS A LIFE";
  if (ctx.intro.active && ctx.intro.phase === "down") return ctx.intro.kind === "join" ? "DROPPING IN" : `RESPAWN ${Math.max(0, ctx.intro.downFor - ctx.intro.t).toFixed(1)}`;
  return null;
}

// Pad labels for player 2's own pad type
function coopPadLabel(button) {
  const pad = gamepads.pads.get(gamepads.slots[1]);
  const labels = PAD_LABELS[pad ? pad.type : "xbox"];
  return (labels && labels[button]) || button;
}

// Player 2's HUD: a compact panel top right (or the join panel)
function drawCoopHud(VW, time) {
  const ctx2 = coop.players[1];
  if (!ctx2) return;
  const x = VW - 44 - 400;
  const y = 176;
  withPlayer(ctx2, (c) => {
    const p = player;
    ctx.fillStyle = "rgba(10,3,24,0.72)";
    ctx.fillRect(x - 12, y - 12, 424, c.joining ? 150 : 144);
    ctx.strokeStyle = c.color;
    ctx.lineWidth = 3;
    ctx.strokeRect(x - 12, y - 12, 424, c.joining ? 150 : 144);
    if (c.joining) {
      const ch = CHARACTERS[c.joining.char] || CHARACTERS.paine;
      hudText("PLAYER 2 // JOIN", x, y, 18, c.color);
      drawPortrait(ch.portrait, x, y + 30, 56);
      hudText(`< ${ch.name} >`, x + 72, y + 38, 22, ch.color);
      hudText(ch.title.toUpperCase(), x + 72, y + 68, 12, "#c9b6ff");
      const left = Math.ceil(COOP.joinTimeout - c.joining.t);
      hudText(`${coopPadLabel("A")}: DROP IN  ${coopPadLabel("B")}: LEAVE  ${left}`, x, y + 104, 14, "#ffffff");
      return;
    }
    const ch = CH();
    drawPortrait(ch.portrait, x, y, 40);
    hudText(`P2 ${ch.name}`, x + 50, y + 10, 20, c.color);
    const status = coopStatus(c);
    drawBar(x, y + 50, 400, 24, status ? 0 : p.hp / stats.maxHp, status ? 0 : p.ghostHp / stats.maxHp, p.hp / stats.maxHp < 0.3 && Math.sin(time * 12) > 0 ? "#ff2f6d" : c.color);
    hudText(status || `${Math.ceil(p.hp)}/${stats.maxHp}`, x + 10, y + 55, 16, "#ffffff");
    const res = ch.resource;
    drawBar(x, y + 86, 240, 12, p.heat / TUNING.heat.max, 0, p.heatLocked ? "#ff3b3b" : res.color);
    hudText(res.name, x + 254, y + 84, 14, res.color);
    hudText(passiveLine(), x, y + 108, 12, "#c9b6ff");
  });
}

// --------------------------------------------------------------- Hooks ------
gamepads.onJoinRequest = coopJoinRequest;
gamepads.onSlotPoll = coopSlotPoll;
