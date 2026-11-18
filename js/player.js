"use strict";
// =============================================================================
// The player: platformer movement, aiming, Paine's kit (energy ball + flame),
// the auto-firing weapons unlocked through upgrades, damage and drawing.
// Tetsu's and Sudo's kits are in heroes.js; all base stats in database.js.
// =============================================================================

// The player object IS its hitbox (x, y, w, h). The 32x48 sprite frame is
// drawn 2.5x (80x120) around it.
const player = {
  char: "paine",
  x: 200,
  y: GROUND_Y - 104,
  w: 44,
  h: 104,
  vx: 0,
  vy: 0,
  kbX: 0,
  onGround: true,
  standingOn: GROUND,
  facing: 1,
  frameX: 0,
  frameY: 2,
  animTime: 0,
  moving: false,
  jumps: 0,
  jumped: false,
  jumpCut: false,
  coyote: 0,
  jumpBuffer: 0,
  dropTimer: 0,
  hp: TUNING.player.maxHp,
  ghostHp: TUNING.player.maxHp,
  heat: TUNING.heat.start,
  heatLocked: false,
  flameOn: false,
  invuln: 0,
  shield: 0,
  overdrive: 0,
  zapCd: 0,
  missileCd: 1,
  chainCd: 1,
  orbitAngle: 0,
  // feel / animation
  sx: 1,
  sy: 1,
  faceLock: 0,
  fireAnim: 0,
  fireAnimMax: 1,
  flameScale: 0,
  speech: null,
  speechCd: 0,
  trail: [],
};

const playerShots = []; // energy balls
const missiles = [];

// --------------------------------------------------------------- Stats ------
// Everything upgrades can change is derived from the upgrade levels here.
const upg = {}; // upgrade id -> level
const stats = {};
const lv = (id) => upg[id] || 0;
const byLevel = (table, level) => table[Math.min(level, table.length - 1)];

function computeStats() {
  const ch = CH();
  const z = lv("zap");
  const f = Math.max(1, lv("flame"));
  const cdMul = 1 - 0.07 * lv("clock");
  stats.maxHp = ch.hp + 20 * lv("heart");
  stats.speed = ch.speed * (1 + 0.08 * lv("legs"));
  stats.jump = ch.jump * (1 + 0.03 * lv("legs"));
  stats.magnetMul = 1 + 0.4 * lv("magnet");
  stats.armorMul = (1 - ch.armor) * (1 - 0.08 * lv("armor"));
  stats.heatGainMul = 1 + 0.25 * lv("sink");
  const costMul = 1 - 0.06 * lv("sink");
  // Tetsu
  stats.blade = {
    damage: 10 + (z >= 2 ? 3 : 0) + (z >= 6 ? 4 : 0) + (z >= 8 ? 5 : 0),
    range: 145 * (z >= 3 ? 1.2 : 1) * (z >= 8 ? 1.25 : 1),
    cooldown: 0.38 * (z >= 4 ? 0.8 : 1) * cdMul,
    finisherEvery: z >= 7 ? 2 : 3,
    reflect: z >= 5,
  };
  stats.dash = {
    damage: 26 + (f >= 2 ? 8 : 0) + (f >= 5 ? 12 : 0),
    distance: 380 * (f >= 2 ? 1.15 : 1) * (f >= 5 ? 1.15 : 1),
    cost: (f >= 3 ? 26 : 35) * costMul,
    guard: f >= 4 ? 3.2 : 2,
    wave: f >= 6,
  };
  // Sudo
  stats.daemon = {
    damage: 7 + (z >= 2 ? 3 : 0) + (z >= 7 ? 3 : 0),
    radius: 80 * (z >= 3 ? 1.25 : 1) * (z >= 7 ? 1.2 : 1),
    split: z >= 4,
    cooldown: 0.5 * (z >= 5 ? 0.8 : 1) * cdMul,
    slowMul: z >= 6 ? 0.35 : 0.5,
    slowTime: z >= 6 ? 2.4 : 1.5,
    chain: z >= 8,
    speed: 760,
  };
  stats.overload = {
    radius: 240 * (f >= 2 ? 1.15 : 1) * (f >= 5 ? 1.15 : 1),
    damage: 18 + (f >= 2 ? 8 : 0) + (f >= 5 ? 12 : 0),
    stun: f >= 3 ? 2.4 : 1.8,
    cost: (f >= 4 ? 30 : 40) * costMul,
    leak: f >= 6,
  };
  stats.cdMul = cdMul;
  stats.zap = {
    damage: 6 + (z >= 2 ? 2 : 0) + (z >= 7 ? 3 : 0),
    count: 1 + (z >= 3 ? 1 : 0) + (z >= 6 ? 1 : 0),
    cooldown: 0.25 * (z >= 4 ? 0.8 : 1) * cdMul,
    pierce: (z >= 5 ? 1 : 0) + (z >= 8 ? 1 : 0),
    scale: z >= 8 ? 1.3 : 1,
  };
  stats.flame = {
    radius: 105 * (1 + 0.12 * (f - 1)),
    dps: 40 * (1 + 0.25 * (f - 1)),
    drain: 26 * (1 - 0.08 * (f - 1)) * (1 - 0.06 * lv("sink")),
  };
  const o = lv("orbit");
  stats.orbit = {
    count: byLevel([0, 1, 2, 2, 3, 3, 4], o),
    damage: byLevel([0, 6, 6, 9, 9, 12, 14], o),
    radius: byLevel([0, 120, 125, 130, 140, 150, 160], o),
    spin: byLevel([0, 3, 3.2, 3.4, 3.6, 3.8, 4.2], o),
  };
  const m = lv("missile");
  stats.missile = {
    cooldown: byLevel([0, 2.4, 2.1, 2.1, 1.8, 1.6, 1.3], m) * cdMul,
    count: byLevel([0, 1, 1, 2, 2, 3, 3], m),
    damage: byLevel([0, 12, 14, 14, 18, 18, 24], m),
  };
  const s = lv("stomp");
  stats.stomp = { radius: byLevel([0, 170, 200, 230, 260, 300], s), damage: byLevel([0, 12, 16, 20, 26, 34], s) };
  const c = lv("chain");
  stats.chain = {
    cooldown: byLevel([0, 2, 1.8, 1.6, 1.4, 1.2, 1.0], c) * cdMul,
    jumps: byLevel([0, 2, 3, 3, 4, 5, 6], c),
    damage: byLevel([0, 9, 9, 12, 12, 15, 18], c),
  };
}

function resetPlayer() {
  player.char = CHARACTERS[settings.character] ? settings.character : "paine";
  Object.keys(upg).forEach((k) => delete upg[k]);
  upg.zap = 1;
  upg.flame = 1;
  computeStats();
  Object.assign(player, {
    x: 200,
    y: GROUND_Y - player.h,
    vx: 0,
    vy: 0,
    kbX: 0,
    onGround: true,
    standingOn: GROUND,
    facing: 1,
    frameX: 0,
    frameY: 2,
    jumps: 0,
    jumped: false,
    coyote: 0,
    jumpBuffer: 0,
    dropTimer: 0,
    hp: stats.maxHp,
    ghostHp: stats.maxHp,
    heat: TUNING.heat.start,
    heatLocked: false,
    flameOn: false,
    invuln: 0,
    shield: 0,
    overdrive: 0,
    zapCd: 0,
    missileCd: 1,
    chainCd: 1,
    sx: 1,
    sy: 1,
    faceLock: 0,
    fireAnim: 0,
    fireAngle: 0,
    flameScale: 0,
    speech: null,
    speechCd: 0,
    combo: 0,
    dash: null,
    guard: 0,
    specialCd: 0,
    firewallCd: 0,
    specialWasHeld: false,
    lowHpSaid: false,
    runDust: 0,
  });
  playerShots.length = 0;
  missiles.length = 0;
  slashFx.length = 0;
  hackFx.length = 0;
  input.buttons.flame = false;
}

function gainHeat(amount) {
  player.heat = Math.min(TUNING.heat.max, player.heat + amount * stats.heatGainMul * (CH().resource.gain || 1));
}

// -------------------------------------------------------------- Update ------
function updatePlayer(dt) {
  const p = player;
  const T = TUNING.player;
  const move = moveAxis();

  // Run
  const target = move.x * stats.speed;
  const a = T.accel * dt;
  p.vx = p.vx < target ? Math.min(target, p.vx + a) : Math.max(target, p.vx - a);
  p.moving = Math.abs(move.x) > 0.1;
  // You keep facing the way you fired for a moment, even running backwards
  p.faceLock -= dt;
  if (p.moving && p.faceLock <= 0) p.facing = move.x > 0 ? 1 : -1;

  // Jump (with coyote time, buffering, double jump and drop-through)
  p.coyote -= dt;
  p.jumpBuffer -= dt;
  p.dropTimer -= dt;
  if (input.jumpQueued) {
    input.jumpQueued = false;
    p.jumpBuffer = T.jumpBuffer;
  }
  const standingOnPlatform = p.onGround && p.standingOn && !p.standingOn.ground;
  if (input.stick.id !== null && move.y > 0.7 && standingOnPlatform) {
    p.dropHold = (p.dropHold || 0) + dt;
    if (p.dropHold > 0.22) {
      p.dropHold = 0;
      p.dropTimer = 0.25;
      p.onGround = false;
      p.standingOn = null;
      p.vy = 80;
    }
  } else {
    p.dropHold = 0;
  }
  if (p.jumpBuffer > 0) {
    const onPlatform = p.onGround && p.standingOn && !p.standingOn.ground;
    if (onPlatform && move.y > 0.6) {
      p.dropTimer = 0.25;
      p.jumpBuffer = 0;
      p.onGround = false;
      p.standingOn = null;
      p.vy = 80;
    } else if (p.onGround || p.coyote > 0) {
      doJump(stats.jump, 1);
      squash(0.8, 1.2);
      dust(p.x + p.w / 2, p.y + p.h, 6);
    } else if (p.jumps < T.maxJumps) {
      doJump(stats.jump * 0.92, T.maxJumps);
      squash(0.85, 1.15);
      ring(p.x + p.w / 2, p.y + p.h, 70, CH().color);
      burst(p.x + p.w / 2, p.y + p.h, 10, CH().color, 240);
    }
  }
  // Let go of jump early for a short hop
  if (!jumpHeld() && !p.jumpCut && p.vy < -380) {
    p.vy *= 0.5;
    p.jumpCut = true;
  }

  p.x += p.kbX * dt;
  p.kbX *= Math.exp(-9 * dt);
  const fallSpeed = p.vy;
  if (p.dash) {
    // Tetsu's dash ignores gravity
    p.vx = p.dash.vx;
    p.vy = p.dash.vy;
  }
  const landed = moveBody(p, dt, p.dash ? 0 : T.gravity, T.maxFall);
  if (p.onGround) {
    p.jumps = 0;
    p.coyote = T.coyoteTime;
  }
  if (landed) {
    if ((p.jumped || fallSpeed > 900) && lv("stomp")) shockStomp();
    if (fallSpeed > 700) burst(p.x + p.w / 2, p.y + p.h, 6, "#ff2fd6", 160);
    const k = clamp(fallSpeed / 1500, 0.15, 0.45);
    squash(1 + k, 1 - k * 0.8);
    if (fallSpeed > 300) dust(p.x + p.w / 2, p.y + p.h, Math.round(4 + k * 12));
    p.jumped = false;
  }
  // Squash & stretch relax back; a puff of dust now and then while running
  const relax = 1 - Math.exp(-12 * dt);
  p.sx += (1 - p.sx) * relax;
  p.sy += (1 - p.sy) * relax;
  if (p.onGround && Math.abs(p.vx) > 200 && (p.runDust -= dt) <= 0) {
    p.runDust = 0.22;
    dust(p.x + p.w / 2 - Math.sign(p.vx) * 14, p.y + p.h, 1, 0.5);
  }

  // Animation (rows: 1 = left, 2 = right)
  p.frameY = p.facing > 0 ? 2 : 1;
  if (!p.onGround) p.frameX = 1;
  else if (p.moving) {
    p.animTime += dt;
    p.frameX = Math.floor(p.animTime * 10) % 4;
  } else {
    p.animTime = 0;
    p.frameX = 0;
  }

  // The character's own kit: primary + special (both can run at once)
  if (p.char === "tetsu") {
    updateDash(dt);
    updateBlade(dt);
  } else if (p.char === "sudo") {
    updateOverload(dt);
    updateDaemon(dt);
  } else {
    updateFlame(dt);
    updateZap(dt);
  }
  updateAutoWeapons(dt);
  p.fireAnim = Math.max(0, p.fireAnim - dt);
  p.speechCd -= dt;
  if (p.speech && (p.speech.time -= dt) <= 0) p.speech = null;


  if (p.hp / stats.maxHp > 0.5) p.lowHpSaid = false;
  p.invuln = Math.max(0, p.invuln - dt);
  p.shield = Math.max(0, p.shield - dt);
  p.overdrive = Math.max(0, p.overdrive - dt);
  p.ghostHp = Math.max(p.hp, p.ghostHp - 40 * dt);
}

function doJump(velocity, jumpsAfter) {
  const p = player;
  p.vy = -velocity;
  p.jumps = jumpsAfter;
  p.jumpBuffer = 0;
  p.coyote = 0;
  p.jumped = true;
  p.jumpCut = false;
  p.onGround = false;
  p.standingOn = null;
}

// The flame burns heat. Heat never refills by itself: deal or take damage.
function updateFlame(dt) {
  const p = player;
  if (p.heatLocked && p.heat >= TUNING.heat.flameMin) p.heatLocked = false;
  let wanted = flameHeld();
  if (settings.autoFlame && !wanted && !p.heatLocked) {
    // Light up when enemies get close and there's enough heat; keep burning
    // while they stay close
    const pc = centerOf(p);
    const r = stats.flame.radius * (p.flameOn ? 1.25 : 1.05);
    const close = enemies.some((e) => !e.dead && circleHitsBox(pc.x, pc.y, r, e)) || enemyShots.some((s) => Math.hypot(s.x - pc.x, s.y - pc.y) < r * 1.3);
    wanted = close && (p.flameOn || p.heat >= 30);
    p.autoFlaming = wanted;
  }
  const wasOn = p.flameOn;
  p.flameOn = wanted && !p.heatLocked && p.heat > 0;
  if (p.flameOn && !wasOn) {
    // Ignition: a ring of fire bursts out
    const pc = centerOf(p);
    ring(pc.x, pc.y, stats.flame.radius * 1.3, "#ff9b21");
    burst(pc.x, pc.y, 18, "#ff9b21", 420);
    p.flameScale = 0.2;
    if (Math.random() < 0.4) say("special");
  } else if (!p.flameOn && wasOn) {
    const pc = centerOf(p);
    burst(pc.x, pc.y, 10, "#ffb35a", 200); // embers
  }
  p.flameScale = p.flameOn ? Math.min(1, p.flameScale + dt * 5) : 0;
  if (p.flameOn) {
    p.heat -= stats.flame.drain * dt;
    if (p.heat <= 0) {
      p.heat = 0;
      p.flameOn = false;
      p.heatLocked = true;
      input.buttons.flame = false; // the touch toggle goes off too
      popup("NO HEAT!", p.x + p.w / 2, p.y - 20, "#ff4b4b");
    }
  } else if (wanted && p.heatLocked && !p.warnedNoHeat) {
    popup("NEED HEAT", p.x + p.w / 2, p.y - 20, "#ff9b21", 22);
    p.warnedNoHeat = true;
  }
  if (!wanted) p.warnedNoHeat = false;
  if (p.flameOn) sfx.flame.startLoop();
  else sfx.flame.stopLoop();
  if (!p.flameOn) return;

  const pc = centerOf(p);
  // The aura melts enemy bullets that fly into it (costs heat equal to the damage blocked)
  const melt = stats.flame.radius * 0.9;
  for (let i = enemyShots.length - 1; i >= 0; i--) {
    const s = enemyShots[i];
    if (s.kind === "meteor" || s.kind === "snipe" || s.kind === "fire") continue; // too big, too fast, or hellfire
    if (Math.hypot(s.x - pc.x, s.y - pc.y) > melt + s.r) continue;
    enemyShots.splice(i, 1);
    burst(s.x, s.y, 5, "#ffb35a", 200);
    p.heat = Math.max(0, p.heat - (s.damage || 8));
  }
  const r = stats.flame.radius;
  enemies.forEach((e) => {
    if (!circleHitsBox(pc.x, pc.y, r, e)) return;
    const ec = centerOf(e);
    const dx = ec.x - pc.x;
    damageEnemy(e, stats.flame.dps * dt, { source: "flame", quiet: true, kbX: Math.sign(dx) * 900 * dt });
    if (Math.random() < 0.25) burst(ec.x + rand(-20, 20), ec.y + rand(-20, 20), 1, "#ff9b21", 180);
    sfx.burn.play();
  });
  crates.forEach((c) => c.alive && circleHitsBox(pc.x, pc.y, r, c) && damageCrate(c, 20 * dt));
}

// ---------------------------------------------------------- Energy ball -----
function holdAim() {
  const pc = centerOf(player);
  if (input.mouse.zap) return { x: input.mouse.x - pc.x, y: input.mouse.y - pc.y, assist: false };
  const finger = fingerAim(); // tap mode: aim exactly where the finger is
  if (finger) return { x: finger.x - pc.x, y: finger.y - (pc.y - 10), assist: false };
  if (aimStickActive()) return { x: input.aim.x, y: input.aim.y, assist: true, cone: 0.22 }; // twin-stick
  const m = moveAxis();
  if (!m.analog && (m.x || m.y)) return { x: m.x, y: m.y, assist: true }; // keys
  return { x: player.facing, y: 0, assist: true };
}

// Auto-fire: pick the nearest enemy on screen and lead it a little
function autoAim(range = 1150, projSpeed = TUNING.zap.speed) {
  const pc = centerOf(player);
  let target = nearestEnemy(pc.x, pc.y, range, onScreen);
  // A boss takes priority, unless a minion is right on top of you
  const boss = game.boss;
  if (boss && !boss.dead && !boss.cloaked && target !== boss && onScreen(boss)) { // (NULL among its copies: no peeking)
    const bc = centerOf(boss);
    const tc = target && centerOf(target);
    const close = tc && Math.hypot(tc.x - pc.x, tc.y - pc.y) < 280;
    if (!close && Math.hypot(bc.x - pc.x, bc.y - pc.y) < range) target = boss;
  }
  if (!target) return null;
  const c = centerOf(target);
  const t = projSpeed ? Math.min(0.6, Math.hypot(c.x - pc.x, c.y - pc.y) / projSpeed) : 0;
  const tx = c.x + (target.vx || 0) * t;
  const ty = c.y + (target.def && target.def.walker ? 0 : (target.vy || 0) * t);
  return { x: tx - pc.x, y: ty - (pc.y - 10), assist: false };
}

function updateZap(dt) {
  const p = player;
  p.zapCd -= dt;
  if (p.zapCd > 0) return;
  const aim = primaryAim(1150, TUNING.zap.speed);
  if (!aim) return;
  fireZap(aim.x, aim.y, aim.assist, aim.cone);
  p.zapCd = stats.zap.cooldown * (p.overdrive > 0 ? 0.5 : 1);
}

function nearestEnemy(x, y, maxDist, filter) {
  let best = null;
  let bestD = maxDist;
  for (const e of enemies) {
    if (e.dead || (filter && !filter(e))) continue;
    const c = centerOf(e);
    const d = Math.hypot(c.x - x, c.y - y);
    if (d < bestD) {
      bestD = d;
      best = e;
    }
  }
  return best;
}

function fireZap(ax, ay, assist, cone) {
  const p = player;
  const pc = centerOf(p);
  const sy = pc.y - 10;
  let len = Math.hypot(ax, ay) || 1;
  ax /= len;
  ay /= len;
  if (assist) {
    // Snap to the enemy closest to where we're aiming (within a cone)
    let bestDot = Math.cos(cone || TUNING.zap.aimAssist);
    for (const e of enemies) {
      if (e.dead || !onScreen(e)) continue;
      const c = centerOf(e);
      const dx = c.x - pc.x;
      const dy = c.y - sy;
      const d = Math.hypot(dx, dy);
      if (d > 1200 || d < 1) continue;
      const dot = (dx * ax + dy * ay) / d;
      if (dot > bestDot) {
        bestDot = dot;
        ax = dx / d;
        ay = dy / d;
      }
    }
  }
  const z = stats.zap;
  const base = Math.atan2(ay, ax);
  faceToward(ax, base);
  startAttackAnim(0.22);
  const speed = TUNING.zap.speed * (z.scale > 1 ? 1.2 : 1);
  for (let i = 0; i < z.count; i++) {
    const a = base + (i - (z.count - 1) / 2) * TUNING.zap.spread;
    playerShots.push({
      x: pc.x + Math.cos(a) * 34,
      y: sy + Math.sin(a) * 34,
      vx: Math.cos(a) * speed,
      vy: Math.sin(a) * speed,
      r: TUNING.zap.radius * z.scale,
      angle: a,
      life: TUNING.zap.life,
      damage: z.damage,
      pierce: z.pierce,
      hit: new Set(),
    });
  }
  sfx.energy.play();
}

function updatePlayerShots(dt) {
  for (let i = playerShots.length - 1; i >= 0; i--) {
    const s = playerShots[i];
    s.x += s.vx * dt;
    s.y += s.vy * dt;
    s.life -= dt;
    let gone = s.life <= 0 || s.y > GROUND_Y + 10 || s.y < camera.y - 200 || s.x < camera.x - 200 || s.x > camera.x + W + 200;
    if (!gone) {
      for (const e of enemies) {
        if (e.dead || s.hit.has(e) || !circleHitsBox(s.x, s.y, s.r, e)) continue;
        if (s.orb) {
          gone = true; // Sudo's glitch orb bursts on contact
          break;
        }
        damageEnemy(e, s.damage, { source: "zap", kbX: Math.sign(s.vx) * 160, fromX: s.x - s.vx });
        burst(s.x, s.y, 6, "#5fd8ff", 260);
        sfx.zapHit.play();
        s.hit.add(e);
        if (s.pierce-- <= 0) {
          gone = true;
          break;
        }
      }
    }
    if (!gone) {
      for (const c of crates) {
        if (c.alive && circleHitsBox(s.x, s.y, s.r, c)) {
          damageCrate(c, s.damage);
          gone = true;
          break;
        }
      }
    }
    if (gone) {
      if (s.orb) explodeOrb(s);
      else if (s.y > GROUND_Y) burst(s.x, GROUND_Y, 4, "#5fd8ff", 160);
      playerShots.splice(i, 1);
    }
  }
}

// --------------------------------------------------------- Auto weapons -----
function updateAutoWeapons(dt) {
  const p = player;
  const pc = centerOf(p);
  const od = p.overdrive > 0 ? 1 / 0.6 : 1; // overdrive speeds up reloads

  // Orbit shards
  if (stats.orbit.count) {
    p.orbitAngle += stats.orbit.spin * dt;
    for (let i = 0; i < stats.orbit.count; i++) {
      const a = p.orbitAngle + (i / stats.orbit.count) * Math.PI * 2;
      const sx = pc.x + Math.cos(a) * stats.orbit.radius;
      const sy = pc.y + Math.sin(a) * stats.orbit.radius;
      for (const e of enemies) {
        if (e.dead || e.orbitCd > 0 || !circleHitsBox(sx, sy, 28, e)) continue;
        e.orbitCd = 0.35;
        damageEnemy(e, stats.orbit.damage, { source: "orbit", kbX: Math.cos(a) * 200 });
        burst(sx, sy, 4, "#ff2fd6", 200);
      }
      crates.forEach((c) => c.alive && circleHitsBox(sx, sy, 28, c) && damageCrate(c, 30 * dt));
    }
  }

  // Seeker missiles
  if (stats.missile.count) {
    p.missileCd -= dt * od;
    if (p.missileCd <= 0) {
      const target = nearestEnemy(pc.x, pc.y, 1100, onScreen);
      if (target) {
        for (let i = 0; i < stats.missile.count; i++) {
          const a = -Math.PI / 2 + (i - (stats.missile.count - 1) / 2) * 0.5 + (p.facing > 0 ? 0.35 : -0.35);
          missiles.push({ x: pc.x, y: pc.y - 30, vx: Math.cos(a) * 520, vy: Math.sin(a) * 520, target, life: 3, damage: stats.missile.damage });
        }
        sfx.missile.play({ rate: 1.4 });
        p.missileCd = stats.missile.cooldown;
      } else {
        p.missileCd = 0.2;
      }
    }
  }

  // Chain lightning
  if (stats.chain.jumps) {
    p.chainCd -= dt * od;
    if (p.chainCd <= 0) {
      const first = nearestEnemy(pc.x, pc.y, 650, onScreen);
      if (first) {
        const hit = new Set([first]);
        const points = [{ x: pc.x, y: pc.y - 10 }];
        let cur = first;
        for (let j = 0; j <= stats.chain.jumps && cur; j++) {
          const c = centerOf(cur);
          points.push(c);
          damageEnemy(cur, stats.chain.damage, { source: "chain" });
          burst(c.x, c.y, 5, "#9ffcff", 220);
          cur = nearestEnemy(c.x, c.y, 330, (e) => !hit.has(e));
          if (cur) hit.add(cur);
        }
        arc(points);
        sfx.chain.play({ rate: 1.6 });
        p.chainCd = stats.chain.cooldown;
      } else {
        p.chainCd = 0.2;
      }
    }
  }
}

function updateMissiles(dt) {
  for (let i = missiles.length - 1; i >= 0; i--) {
    const m = missiles[i];
    if (!m.target || m.target.dead) m.target = nearestEnemy(m.x, m.y, 900);
    const speed = 780;
    if (m.target) {
      const c = centerOf(m.target);
      const want = Math.atan2(c.y - m.y, c.x - m.x);
      let cur = Math.atan2(m.vy, m.vx);
      let diff = Math.atan2(Math.sin(want - cur), Math.cos(want - cur));
      cur += clamp(diff, -7 * dt, 7 * dt);
      m.vx = Math.cos(cur) * speed;
      m.vy = Math.sin(cur) * speed;
    }
    m.x += m.vx * dt;
    m.y += m.vy * dt;
    m.life -= dt;
    if (Math.random() < 0.5) particles.push({ x: m.x, y: m.y, vx: rand(-30, 30), vy: rand(-30, 30), life: 0.25, size: 5, color: "#19f5ff" });
    const hitEnemy = enemies.find((e) => !e.dead && circleHitsBox(m.x, m.y, 14, e));
    if (hitEnemy || m.life <= 0 || m.y > GROUND_Y) {
      // Small explosion
      enemies.forEach((e) => {
        if (e.dead) return;
        if (e === hitEnemy) damageEnemy(e, m.damage, { source: "missile" });
        else if (circleHitsBox(m.x, m.y, 70, e)) damageEnemy(e, m.damage * 0.5, { source: "missile" });
      });
      burst(m.x, m.y, 12, "#ff9b21", 300);
      ring(m.x, m.y, 70, "#ff9b21");
      missiles.splice(i, 1);
    }
  }
}

function shockStomp() {
  const p = player;
  const fx = p.x + p.w / 2;
  const fy = p.y + p.h;
  const r = stats.stomp.radius;
  ring(fx, fy, r, "#ffe14d");
  burst(fx, fy, 16, "#ffe14d", 380);
  camera.shake = Math.max(camera.shake, 6);
  sfx.stomp.play({ rate: 0.6 });
  enemies.forEach((e) => {
    if (e.dead || !circleHitsBox(fx, fy, r, e)) return;
    const c = centerOf(e);
    damageEnemy(e, stats.stomp.damage, { source: "stomp", kbX: Math.sign(c.x - fx) * 500, kbY: -300 });
  });
  crates.forEach((c) => c.alive && circleHitsBox(fx, fy, r, c) && damageCrate(c, stats.stomp.damage));
}

// --------------------------------------------------------------- Damage -----
function hurtPlayer(damage, fromX, fromY) {
  const p = player;
  if (p.invuln > 0 || game.state !== "playing") return false;
  const pc = centerOf(p);
  if (p.shield > 0) {
    burst(pc.x, pc.y, 6, "#19f5ff", 200);
    return true; // blocked, but the attack is used up
  }
  if (p.char === "sudo" && p.firewallCd <= 0) {
    // Sudo's firewall eats one hit every 10 seconds
    p.firewallCd = 10;
    p.invuln = 0.5;
    glyphBurst(pc.x, pc.y, 8);
    popup("FIREWALL", pc.x, p.y - 20, "#5aff7a", 22);
    sfx.zapHit.play({ rate: 1.8 });
    return true;
  }
  damage *= stats.armorMul;
  if (p.guard > 0) damage *= 0.5; // Tetsu's guard stance
  p.hp = Math.max(0, p.hp - damage);
  p.invuln = TUNING.player.hurtInvuln;
  gainHeat(damage * TUNING.heat.perDamageTaken);
  const dir = Math.sign(pc.x - fromX) || -p.facing;
  p.kbX = dir * TUNING.player.knockback;
  if (p.vy > -300) p.vy = -320;
  camera.shake = Math.max(camera.shake, 14);
  game.hurtFlash = 0.35;
  burst(pc.x, pc.y, 12, "#ff2f6d", 360);
  damageNumber(damage, pc.x, p.y - 10, "#ff4b6e");
  sfx.damage.play();
  vibrate(60);
  onPlayerHurt(); // Sandevistan (easter egg)
  squash(1.15, 0.88);
  if (p.hp > 0 && p.hp / stats.maxHp < 0.3 && !p.lowHpSaid) {
    p.lowHpSaid = true;
    say("lowHp", null, true);
  }
  return true;
}

// ------------------------------------------------------------- Drawing ------
function drawPlayer(time) {
  const p = player;
  if (p.hidden) return; // between lives
  const cx = p.x + p.w / 2;
  const bottom = p.y + p.h;
  // Shadow on whatever is below
  const floor = surfaceBelow(cx, bottom - 2);
  const height = floor - bottom;
  ctx.fillStyle = `rgba(0,0,0,${0.4 * Math.max(0.2, 1 - height / 400)})`;
  ctx.beginPath();
  ctx.ellipse(cx, floor, 26 * Math.max(0.4, 1 - height / 600), 7, 0, 0, Math.PI * 2);
  ctx.fill();

  if (p.flameOn) drawFlameAura(cx, p.y + p.h / 2, bottom, time, true);
  if (p.overdrive > 0) glow(cx, p.y + p.h / 2, 90, "rgba(255,225,77,0.45)");

  drawPlayerTrail(); // Sandevistan afterimages
  // Katana on your back
  if (p.katana && isReady(IMG.katana)) {
    ctx.save();
    ctx.translate(cx - p.facing * 8, p.y + 40);
    ctx.rotate(p.facing > 0 ? -2.3 : -0.85);
    ctx.imageSmoothingEnabled = false;
    ctx.globalAlpha = p.camo > 0 ? 0.25 : 1;
    ctx.drawImage(IMG.katana, -40, -10, 80, 24);
    ctx.restore();
  }
  const blink = p.invuln > 0 && !p.dash && Math.floor(p.invuln * 18) % 2 === 0;
  let alpha = blink ? 0.3 : 1;
  if (p.camo > 0) alpha = 0.18 + 0.08 * Math.sin(time * 20); // thermoptic camo
  ctx.globalAlpha = alpha;
  if (!drawHeroSprite(cx, bottom, time)) {
    ctx.fillStyle = CH().color;
    ctx.fillRect(p.x, p.y, p.w, p.h);
  }
  if (p.camo > 0) {
    // the shimmer of the camo's edge
    ctx.globalAlpha = 0.25;
    drawHeroSprite(cx + Math.sin(time * 30) * 3, bottom, time, "rgba(25,245,255,0.9)");
  }
  ctx.globalAlpha = 1;
  drawAttackFx(cx, time);
  drawHeroAura(cx, p.y + p.h / 2, time);

  if (p.flameOn) drawFlameAura(cx, p.y + p.h / 2, bottom, time, false);
  if (p.shield > 0) {
    const a = p.shield < 1.5 && Math.floor(p.shield * 8) % 2 === 0 ? 0.3 : 0.8;
    ctx.strokeStyle = `rgba(25,245,255,${a})`;
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.arc(cx, p.y + p.h / 2, 82, 0, Math.PI * 2);
    ctx.stroke();
    glow(cx, p.y + p.h / 2, 100, "rgba(25,245,255,0.25)");
  }

  drawSpeech();

  // Orbit shards
  if (stats.orbit.count) {
    const pc = centerOf(p);
    for (let i = 0; i < stats.orbit.count; i++) {
      const a = p.orbitAngle + (i / stats.orbit.count) * Math.PI * 2;
      const sx = pc.x + Math.cos(a) * stats.orbit.radius;
      const sy = pc.y + Math.sin(a) * stats.orbit.radius;
      glow(sx, sy, 34, "rgba(255,47,214,0.6)");
      if (!drawCell("projectiles", 0, 16, sx, sy, 40, 40, a * 2)) {
        ctx.fillStyle = "#ff2fd6";
        ctx.fillRect(sx - 10, sy - 10, 20, 20);
      }
    }
  }
}

// Which sheet / row / frame to draw: walking, or the attack pose while firing
function heroFrame() {
  const landing = introFrame(); // the superhero landing poses
  if (landing) return landing;
  const p = player;
  const ch = CH();
  let img = IMG[ch.sprite.img];
  let tint = null;
  const own = isReady(img);
  if (!own) {
    img = IMG.player; // until a hero's own sheet loads
    tint = ch.sprite.tint || null;
  }
  let sheet = img;
  let row = p.lookUp ? 3 : p.frameY;
  let fx = p.lookUp ? 0 : p.frameX;
  if (p.fireAnim > 0 && !p.lookUp) {
    const atk = ch.sprite.attack ? IMG[ch.sprite.attack] : own ? img : null;
    if (isReady(atk)) {
      sheet = atk;
      row = ch.sprite.attackRows[p.facing < 0 ? 0 : 1];
      fx = Math.min(3, Math.floor((1 - p.fireAnim / p.fireAnimMax) * 4));
    }
  }
  return { sheet, row, fx, tint };
}

// The hero sprite with squash & stretch, an air tilt, idle breathing and recoil
function drawHeroSprite(cx, bottom, time, tintOverride) {
  const p = player;
  const f = heroFrame();
  const idle = p.onGround && !p.moving && p.fireAnim <= 0;
  const breathe = idle ? 1 + 0.025 * Math.sin(time * 3 + (p.char === "sudo" ? 1 : 0)) : 1;
  const tilt = p.onGround ? 0 : clamp(p.vx / 4200, -0.12, 0.12);
  const recoil = p.fireAnim > 0 ? -Math.cos(p.fireAngle || 0) * 6 * (p.fireAnim / p.fireAnimMax) : 0;
  ctx.save();
  ctx.translate(cx + recoil, bottom);
  ctx.rotate(tilt);
  ctx.scale(p.sx, p.sy * breathe);
  const ok = drawFrame(f.sheet, f.fx * 32, f.row * 48, 32, 48, -40, -115, 80, 120, tintOverride || f.tint, f.flip);
  ctx.restore();
  return ok;
}

// Muzzle flashes, Sudo's hologram keyboard, Paine's idle hand flame
function drawAttackFx(cx, time) {
  const p = player;
  const hand = { x: cx + Math.cos(p.fireAngle || 0) * 40, y: p.y + p.h / 2 - 10 + Math.sin(p.fireAngle || 0) * 40 };
  const fresh = p.fireAnim > p.fireAnimMax - 0.09;
  if (p.char === "paine") {
    if (fresh) {
      glow(hand.x, hand.y, 46, "rgba(60,180,255,0.9)");
      drawCell("fx", 0, 32, hand.x, hand.y, 56, 56, p.fireAngle);
    } else if (p.onGround && !p.moving && p.heat >= 50 && !p.flameOn) {
      glow(cx + p.facing * 24, p.y + 62, 16 + 3 * Math.sin(time * 18), "rgba(255,150,40,0.8)");
    }
  } else if (p.char === "sudo") {
    if (p.fireAnim > 0) {
      // a little holographic keyboard in front of the hands
      const kx = cx + p.facing * 34;
      const ky = p.y + 58;
      ctx.fillStyle = "rgba(90,255,122,0.25)";
      ctx.fillRect(kx - 18, ky - 6, 36, 12);
      ctx.strokeStyle = "rgba(90,255,122,0.8)";
      ctx.lineWidth = 2;
      ctx.strokeRect(kx - 18, ky - 6, 36, 12);
      if (fresh) glow(hand.x, hand.y, 40, "rgba(90,255,122,0.9)");
    } else if (p.onGround && !p.moving && Math.sin(time * 0.7) > 0.92) {
      glow(cx + p.facing * 20, p.y + 30, 10, "rgba(25,245,255,0.9)"); // glasses glint
    }
  } else if (p.char === "tetsu" && p.onGround && !p.moving && p.fireAnim <= 0 && Math.sin(time * 0.9) > 0.95) {
    glow(cx - p.facing * 10, p.y + 20, 14, "rgba(160,250,255,0.9)"); // the blade gleams
  }
}

function drawFlameAura(cx, cy, bottom, time, behind) {
  const img = smallOr("fire");
  const r = stats.flame.radius * (0.4 + 0.6 * player.flameScale);
  const flick = 1 + Math.sin(time * 31) * 0.06 + Math.sin(time * 17) * 0.05;
  ctx.imageSmoothingEnabled = true;
  if (behind) {
    glow(cx, cy, r * 1.5, "rgba(255,120,30,0.55)");
    if (img) {
      const w = 130 * (2 - flick);
      const h = 180 * flick;
      ctx.drawImage(img, cx - w / 2, bottom + 10 - h, w, h);
    }
    // ring of flames showing the burn radius
    if (img) {
      const n = 8;
      for (let i = 0; i < n; i++) {
        const a = time * 2.2 + (i / n) * Math.PI * 2;
        const fx = cx + Math.cos(a) * r * 0.85;
        const fy = cy + Math.sin(a) * r * 0.85;
        const s = 0.8 + 0.2 * Math.sin(time * 20 + i);
        ctx.globalAlpha = 0.8;
        ctx.drawImage(img, fx - 18 * s, fy - 38 * s, 36 * s, 50 * s);
      }
      ctx.globalAlpha = 1;
    }
  } else if (img) {
    ctx.globalAlpha = 0.45;
    const w = 90 * flick;
    const h = 115 * (2 - flick);
    ctx.drawImage(img, cx - w / 2, bottom + 6 - h, w, h);
    ctx.globalAlpha = 1;
  }
}

function drawPlayerProjectiles() {
  const blue = smallOr("blueFlame");
  ctx.imageSmoothingEnabled = true;
  const flame = smallOr("fire");
  playerShots.forEach((s) => {
    // Shots parried with the katana keep their look
    if (s.kind === "laser") {
      glow(s.x, s.y, 40, "rgba(255,47,109,0.6)");
      drawCell("projectiles", 2, 16, s.x, s.y, 44, 44, s.angle);
      return;
    }
    if (s.kind === "fireball") {
      glow(s.x, s.y, 60, "rgba(255,90,20,0.6)");
      if (flame) {
        ctx.save();
        ctx.translate(s.x, s.y);
        ctx.rotate(s.angle - Math.PI / 2);
        ctx.drawImage(flame, -29, -54, 58, 80);
        ctx.restore();
      }
      return;
    }
    if (s.orb) {
      glow(s.x, s.y, 44 * (s.r / 18), "rgba(90,255,122,0.7)");
      ctx.fillStyle = "#e9ffef";
      ctx.fillRect(s.x - 6, s.y - 6, 12, 12);
      ctx.strokeStyle = "#5aff7a";
      ctx.lineWidth = 3;
      ctx.strokeRect(s.x - 11 + rand(-2, 2), s.y - 11, 22, 22);
      if (Math.random() < 0.3) glyphBurst(s.x, s.y, 1);
      return;
    }
    glow(s.x, s.y, 55 * (s.r / 22), "rgba(40,160,255,0.5)");
    if (!blue) return;
    const k = s.r / 22;
    ctx.save();
    ctx.translate(s.x, s.y);
    ctx.rotate(s.angle);
    ctx.drawImage(blue, -76 * 0.66 * k, -68 * 0.46 * k, 76 * k, 68 * k);
    ctx.restore();
  });
  missiles.forEach((m) => {
    glow(m.x, m.y, 30, "rgba(25,245,255,0.5)");
    if (!drawCell("projectiles", 1, 16, m.x, m.y, 44, 44, Math.atan2(m.vy, m.vx))) {
      ctx.fillStyle = "#19f5ff";
      ctx.fillRect(m.x - 8, m.y - 4, 16, 8);
    }
  });
}
