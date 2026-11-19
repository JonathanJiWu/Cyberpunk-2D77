"use strict";
// =============================================================================
// The player: platformer movement, aiming, Paine's kit (energy ball + flame),
// the auto-firing weapons unlocked through upgrades, damage and drawing.
// Tetsu's and Sudo's kits are in heroes.js; all base stats in database.js.
// =============================================================================

// The player object IS its hitbox (x, y, w, h). The 32x48 sprite frame is
// drawn 2.5x (80x120) around it.
// `player`, `stats`, `playerShots` and `missiles` are `let`: in local co-op
// (coop.js) they point at whichever player a per-player system runs for.
function makePlayerBody() {
  return {
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
    speech: null,
    speechCd: 0,
    trail: [],
  };
}
let player = makePlayerBody();

let playerShots = []; // energy balls
let missiles = [];

// --------------------------------------------------------------- Stats ------
// Everything upgrades can change is derived from the upgrade levels here.
// The upgrades belong to the team (shared in co-op); stats are per player.
const upg = {}; // upgrade id -> level
let stats = {};
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
    distance: byLevel([380, 380, 437, 437, 437, 480, 490], f), // (balance sheet: levels 5-6 trimmed)
    cost: (f >= 3 ? 26 : 35) * costMul,
    guard: f >= 4 ? 3.2 : 2,
    wave: f >= 6,
  };
  stats.cdMul = cdMul;
  computeKitStats(z, f, cdMul, costMul); // Widow / Hackerman (kits.js)
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
  Object.keys(upg).forEach((k) => delete upg[k]);
  upg.zap = 1;
  upg.flame = 1;
  freshPlayer(CHARACTERS[settings.character] ? settings.character : "paine");
}

// The current player's body and kit, fresh and at full HP, as IC `char`.
// The team's upgrades are kept (co-op's player 2 joins with them).
function freshPlayer(char) {
  player.char = char;
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
    speech: null,
    speechCd: 0,
    combo: 0,
    dash: null,
    guard: 0,
    specialCd: 0,
    draw: null, // the Widow's bow
    releaseT: 0,
    flameFlash: 0,
    dilation: 0, // Hackerman's Time Dilation
    dilationMax: 0,
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
    updateDilation(dt);
    updateEmitter(dt);
  } else {
    updateHeatWave(dt);
    updateBow(dt);
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
// ----------------------------------------------------------- Aiming --------
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

function nearestEnemy(x, y, maxDist, filter) {
  let best = null;
  let bestD = maxDist;
  for (const e of enemies) {
    if (e.dead || e.hijackT > 0 || (filter && !filter(e))) continue; // (never your hijacked ones)
    const c = centerOf(e);
    const d = Math.hypot(c.x - x, c.y - y);
    if (d < bestD) {
      bestD = d;
      best = e;
    }
  }
  return best;
}

// The Widow's arrow release (kept as fireZap: "fire the primary toward ax, ay")
function fireZap(ax, ay, assist, cone) {
  releaseArrows(ax, ay, assist, cone);
}

function updatePlayerShots(dt) {
  for (let i = playerShots.length - 1; i >= 0; i--) {
    const s = playerShots[i];
    s.x += s.vx * dt;
    s.y += s.vy * dt;
    s.life -= dt;
    if (s.kind === "em") {
      // EM waves grow taller as they travel
      s.age += dt;
      s.r = 26 + (stats.em.height - 26) * Math.min(1, s.age / 0.4);
    }
    let gone = s.life <= 0 || s.y > GROUND_Y + 10 || s.y < camera.y - 200 || s.x < camera.x - 200 || s.x > camera.x + W + 200;
    if (!gone) {
      for (const e of enemies) {
        if (e.dead || e.hijackT > 0 || s.hit.has(e) || !circleHitsBox(s.x, s.y, s.r, e)) continue; // (shots pass through your hijacked ones)
        if (s.kind === "arrow" || s.kind === "em") {
          if (s.kind === "arrow") arrowHit(s, e);
          else emHit(s, e);
          s.hit.add(e);
          if (s.pierce-- <= 0) {
            gone = true;
            break;
          }
          continue;
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
        if (c.alive && circleHitsBox(s.x, s.y, s.r, c) && !s.hit.has(c)) {
          damageCrate(c, s.damage);
          s.hit.add(c);
          if (s.kind !== "em") gone = true; // EM waves pass through
          break;
        }
      }
    }
    if (gone) {
      if (s.y > GROUND_Y) burst(s.x, GROUND_Y, 4, s.kind === "em" ? "#b06cff" : "#ff4a6a", 160);
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
    const hitEnemy = enemies.find((e) => !e.dead && !(e.hijackT > 0) && circleHitsBox(m.x, m.y, 14, e));
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
// src: the attacker (an enemy), so Ronin can reflect damage back at it
function hurtPlayer(damage, fromX, fromY, src) {
  const p = player;
  if (p.invuln > 0 || game.state !== "playing") return false;
  const pc = centerOf(p);
  if (p.shield > 0) {
    burst(pc.x, pc.y, 6, "#19f5ff", 200);
    return true; // blocked, but the attack is used up
  }
  const incoming = damage;
  damage *= stats.armorMul;
  if (p.guard > 0) damage *= 0.5; // Tetsu's guard stance
  if (p.char === "tetsu") roninReflect(src, incoming);
  p.hp = Math.max(0, p.hp - damage);
  p.invuln = TUNING.player.hurtInvuln;
  gainHeat(damage * TUNING.heat.perDamageTaken);
  const dir = Math.sign(pc.x - fromX) || -p.facing;
  p.kbX = dir * TUNING.player.knockback;
  if (p.vy > -300) p.vy = -320;
  camera.shake = Math.max(camera.shake, 14);
  if (coop.active.id) gamepads.rumble(coop.active.slot, 0.45, 0.9, 180); // co-op player 2: their own pad (the red flash rumbles player 1's)
  else game.hurtFlash = 0.35;
  burst(pc.x, pc.y, 12, "#ff2f6d", 360);
  damageNumber(damage, pc.x, p.y - 10, "#ff4b6e");
  sfx.damage.play();
  if (!coop.active.id) vibrate(60); // (player 1's phone)
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

  if (p.flameFlash > 0) glow(cx, p.y + p.h / 2, 120, "rgba(255,120,30,0.7)", p.flameFlash / 0.6); // her suit vents heat
  if (p.char === "sudo" && p.dilation > 0) glow(cx, p.y + p.h / 2, 110, "rgba(90,255,122,0.4)");
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
  if (!(p.camo > 0)) coopOutline(cx, bottom, time); // co-op: P1 / P2 outline colours
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
  coopTag(cx, p.y);

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
  let own = isReady(img);
  if (!own && ch.sprite.fallback && isReady(IMG[ch.sprite.fallback])) {
    img = IMG[ch.sprite.fallback]; // an older sheet with the same layout
    own = !!ch.sprite.fallbackSameLayout;
  } else if (!own) {
    img = IMG.player; // until a hero's own sheet loads
    tint = ch.sprite.tint || null;
  }
  let sheet = img;
  let row = p.lookUp ? 3 : p.frameY;
  let fx = p.lookUp ? 0 : p.frameX;
  const bowPose = p.char === "paine" && (p.draw || p.releaseT > 0);
  if ((p.fireAnim > 0 || bowPose) && !p.lookUp) {
    const atk = ch.sprite.attack ? IMG[ch.sprite.attack] : own ? img : null;
    if (isReady(atk)) {
      sheet = atk;
      row = ch.sprite.attackRows[p.facing < 0 ? 0 : 1];
      fx = bowPose ? bowFrame() : Math.min(3, Math.floor((1 - p.fireAnim / p.fireAnimMax) * 4));
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
    if (p.draw) {
      // the drawn arrow's tip glows brighter as the string comes back
      const k = Math.min(1, p.draw.t / stats.bow.draw);
      glow(hand.x, hand.y, 16 + 26 * k, `rgba(255,60,90,${0.4 + 0.5 * k})`);
    } else if (p.releaseT > 0.1) {
      glow(hand.x, hand.y, 34, "rgba(255,200,210,0.8)");
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
    if (s.kind === "arrow") {
      glow(s.x, s.y, s.piercing ? 40 : 26, s.piercing ? "rgba(255,255,255,0.8)" : "rgba(255,60,90,0.6)");
      if (!drawCell("fx2", s.piercing ? 1 : 0, 32, s.x, s.y, 64, 64, s.angle)) {
        ctx.save();
        ctx.translate(s.x, s.y);
        ctx.rotate(s.angle);
        ctx.fillStyle = "#f4f4ff";
        ctx.fillRect(-26, -2, 40, 4);
        ctx.fillStyle = s.piercing ? "#ffffff" : "#ff3b5c";
        ctx.fillRect(12, -4, 10, 8);
        ctx.restore();
      }
      return;
    }
    if (s.kind === "em") {
      // a crescent of electromagnetic interference
      const h = s.r * 2.2;
      glow(s.x, s.y, s.r * 1.6, "rgba(176,108,255,0.45)");
      if (!drawCell("fx2", 2, 32, s.x, s.y, h * 0.8, h, s.angle)) {
        ctx.save();
        ctx.translate(s.x, s.y);
        ctx.rotate(s.angle);
        ctx.globalCompositeOperation = "lighter";
        [["rgba(176,108,255,0.7)", 8], ["rgba(25,245,255,0.8)", 3]].forEach(([c, w], k) => {
          ctx.strokeStyle = c;
          ctx.lineWidth = w;
          ctx.beginPath();
          ctx.arc(-s.r * 0.6 - k * 8, 0, s.r, -1.1, 1.1);
          ctx.stroke();
        });
        ctx.restore();
      }
      if (Math.random() < 0.25) drawCell("fx2", 3, 32, s.x + rand(-10, 10), s.y + rand(-s.r, s.r), 28, 28, rand(0, 6));
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
