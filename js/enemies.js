"use strict";
// =============================================================================
// Enemies: the spawn director (difficulty curve + the two-boss run), minion AI
// (melee, ranged, ninja dashes, bombers, shielded enforcers, snipers), status
// effects (slow / stun / vulnerable), elites, enemy shots and the Demon Goat.
// The Overseer (second boss) is in overseer.js; enemy stats in database.js.
// =============================================================================

const enemies = [];
const enemyShots = [];
// stage: 0 before the goat, 1 goat fight, 2 interlude, 3 Overseer fight
const director = { acc: 0, stage: 0, nextBossAt: 0, firstSpawn: 1.5 };

const onScreen = (e) => e.x + e.w > camera.x && e.x < camera.x + W && e.y + e.h > camera.y && e.y < camera.y + H;

function resetEnemies() {
  enemies.length = 0;
  enemyShots.length = 0;
  director.acc = 0;
  director.stage = 0;
  director.nextBossAt = TUNING.boss.at;
}

// ------------------------------------------------------------- Spawning -----
// Elites (bigger, gold-glowing, tougher, more XP) show up later in the run
function eliteChance(t) {
  return t > 200 ? 0.12 : t > 120 ? 0.06 : 0;
}

function spawnEnemy(type, x, y, opts = {}) {
  const def = ENEMY_TYPES[type];
  const elite = opts.elite !== undefined ? opts.elite : Math.random() < eliteChance(game.time);
  const mul = elite ? 2.2 : 1;
  const size = elite ? 1.15 : 1;
  const hp = def.hp * (1 + game.time * TUNING.spawn.hpGrowth) * mul;
  const e = {
    type,
    def,
    elite,
    size,
    dmgMul: elite ? 1.3 : 1,
    x,
    y,
    w: def.w * size,
    h: def.h * size,
    vx: 0,
    vy: 0,
    kbX: 0,
    kbY: 0,
    hp,
    maxHp: hp,
    facing: -1,
    anim: rand(0, 4),
    hurt: 0,
    stun: 0,
    slowT: 0,
    slowMul: 1,
    vulnT: 0,
    orbitCd: 0,
    hitCd: 0,
    jumpCd: rand(0.5, 1.5),
    shotCd: def.shot ? rand(def.shot.cooldown[0], def.shot.cooldown[1]) : 0,
    dashCd: rand(1, 2),
    bob: rand(0, Math.PI * 2),
    onGround: false,
    standingOn: null,
  };
  if (def.walker) e.y = y - (e.h - def.h); // keep elites standing on the surface
  enemies.push(e);
  return e;
}

function spawnAtEdge(type) {
  const def = ENEMY_TYPES[type];
  const leftX = camera.x - def.w - 60;
  const rightX = camera.x + W + 60;
  let side = Math.random() < 0.5 ? -1 : 1;
  if (side < 0 && leftX < 0) side = 1;
  if (side > 0 && rightX > WORLD_W - def.w) side = -1;
  const x = clamp(side < 0 ? leftX : rightX, 0, WORLD_W - def.w);
  // Walkers appear on a surface at about the player's height (the street, or
  // the rooftops when you're up high); flyers somewhere in the visible sky
  const y = def.walker ? surfaceBelow(x + def.w / 2, player.y - 180) - def.h : camera.y + rand(140, 620);
  spawnEnemy(type, x, y);
}

const countAlive = (type) => enemies.reduce((n, e) => n + (!e.dead && e.type === type ? 1 : 0), 0);

// The difficulty curve: spawning speeds up over time, new enemy types join
// as the run goes on (ENEMY_TYPES[].from), and two bosses punctuate it:
// the Overseer at 2:30, then the GOAT (final boss) after an interlude.
function updateDirector(dt) {
  const S = TUNING.spawn;
  const t = game.time;
  if (director.stage === 0 && t >= director.nextBossAt) spawnOverseer();
  if (director.stage === 2 && t >= director.nextBossAt) spawnGoat();
  // Boss fights are one-on-one: nothing else spawns
  if (director.stage === 1 || director.stage === 3) return;
  if (t < director.firstSpawn) return;
  let rate = Math.min(S.maxRate, S.startRate + t * S.ratePerSecond);
  if (director.stage === 2) rate *= 1.15; // the calm before... no calm
  director.acc += rate * dt;
  while (director.acc >= 1) {
    director.acc -= 1;
    if (enemies.length >= S.maxAlive) {
      director.acc = 0;
      break;
    }
    const options = Object.entries(ENEMY_TYPES)
      .filter(([k, d]) => t >= d.from && (!d.maxAlive || countAlive(k) < d.maxAlive))
      .map(([k, d]) => [k, d.weight]);
    if (options.length) spawnAtEdge(weightedPick(options));
  }
}

// --------------------------------------------------------------- Update -----
function updateEnemies(dt) {
  const pc = centerOf(player);
  for (const e of enemies) {
    if (e.dead) continue;
    // New faces go into the database the first time they're on screen
    if (onScreen(e) && discover(e.type)) {
      const name = e.boss ? BOSSES[e.type].name : e.def.name;
      game.toast = { text: `DATABASE: NEW ENTRY // ${name.toUpperCase()}`, time: 2.4 };
    }
    e.vulnT = Math.max(0, e.vulnT - dt);
    if (e.boss) {
      if (e.type === "overseer") updateOverseer(e, dt);
      else updateGoat(e, dt);
      continue;
    }
    const def = e.def;
    e.hurt -= dt;
    e.orbitCd -= dt;
    e.hitCd -= dt;
    e.stun -= dt;
    e.slowT -= dt;
    if (e.slowT <= 0) e.slowMul = 1;
    const sm = e.slowMul; // Sudo's glitch slows everything they do
    const stunned = e.stun > 0;
    const ec = centerOf(e);
    // Thermoptic camo (easter egg): enemies lose you and wander around
    const blind = player.camo > 0;
    const tgt = blind ? wanderTarget(e, ec, dt) : pc;
    const dx = tgt.x - ec.x;
    const dy = tgt.y - ec.y;
    const d = Math.hypot(dx, dy) || 1;
    const steer = Math.min(1, 3 * dt);
    let contactMul = 1;

    if (def.walker) {
      e.jumpCd -= dt;
      e.dashCd -= dt;
      let want = stunned || Math.abs(dx) < 12 ? 0 : Math.sign(dx) * def.speed * sm;
      if (e.type === "ninja") want = updateNinja(e, dt, dx, dy, want, stunned || blind);
      if (e.type === "enforcer") {
        want = updateEnforcer(e, dt, dx, dy, want, stunned || blind);
        if (e.bash > 0) contactMul = 1.3;
      }
      if (e.dashT > 0) contactMul = 1;
      const accel = e.dashT > 0 || e.bash > 0 ? 1 : Math.min(1, 8 * dt);
      e.vx += (want - e.vx) * accel;
      const playerAbove = !blind && player.y + player.h < e.y + e.h - 90;
      if (!stunned && e.onGround && e.jumpCd <= 0 && playerAbove && Math.abs(dx) < 340 && !(e.windup > 0)) {
        e.vy = -rand(980, 1180);
        e.jumpCd = rand(1, 2);
      }
      e.x += e.kbX * dt;
      if (e.kbY < 0) {
        e.vy += e.kbY;
        e.kbY = 0;
      }
      moveBody(e, dt, 2700, 1500);
      if (e.type === "enforcer") e.facing = dx > 0 ? 1 : -1; // the shield always faces you
      else if (Math.abs(e.vx) > 20) e.facing = e.vx > 0 ? 1 : -1;
    } else if (def.kind === "melee") {
      // Reapers drift straight at you through everything
      const sp = stunned ? 0 : def.speed * sm;
      e.vx += ((dx / d) * sp - e.vx) * steer;
      e.vy += ((dy / d) * sp - e.vy) * steer;
      e.x += (e.vx + e.kbX) * dt;
      e.y += (e.vy + e.kbY) * dt + Math.sin(game.time * 2.5 + e.bob) * 25 * dt;
      e.facing = dx > 0 ? 1 : -1;
    } else if (def.kind === "bomber") {
      if (updateBomber(e, dt, dx, dy, d, stunned || blind, sm)) continue;
    } else {
      // Ranged flyers (drones, wyrms, snipers) keep their distance and shoot
      const side = ec.x < pc.x ? -1 : 1;
      const high = e.type === "dragon" ? 330 : e.type === "sniper" ? 400 : 250;
      const tx = blind ? tgt.x : pc.x + side * def.keepDistance;
      const ty = blind ? tgt.y : pc.y - high + Math.sin(game.time * 1.4 + e.bob) * 70;
      const ddx = tx - ec.x;
      const ddy = ty - ec.y;
      const dd = Math.hypot(ddx, ddy) || 1;
      const holdStill = e.aimT > 0;
      const sp = stunned || holdStill ? 0 : Math.min(def.speed * sm, dd * 2.5);
      e.vx += ((ddx / dd) * sp - e.vx) * steer;
      e.vy += ((ddy / dd) * sp - e.vy) * steer;
      e.x += (e.vx + e.kbX) * dt;
      e.y += (e.vy + e.kbY) * dt;
      e.facing = dx > 0 ? 1 : -1;
      if (e.type === "sniper") updateSniper(e, dt, stunned || blind, sm);
      else {
        // Charge up (glowing) for a moment before every shot so it can be dodged
        if (!stunned && !blind && onScreen(e)) e.shotCd -= dt * sm;
        if (e.charge > 0) {
          e.charge -= dt;
          if (e.charge <= 0 && !stunned) {
            fireEnemyShot(ec.x + e.facing * 20, ec.y, def.shot, undefined, e.dmgMul);
            e.shotCd = rand(def.shot.cooldown[0], def.shot.cooldown[1]);
          }
        } else if (e.shotCd <= 0 && !stunned && !blind) {
          e.charge = 0.45;
        }
      }
    }
    const decay = Math.exp(-8 * dt);
    e.kbX *= decay;
    e.kbY *= decay;
    e.x = clamp(e.x, 0, WORLD_W - e.w);
    if (!def.walker) e.y = clamp(e.y, WORLD_TOP + 40, GROUND_Y - e.h - 10);
    e.anim += dt * def.sheet.fps * sm;

    // Body contact
    if (!stunned && !blind && e.hitCd <= 0 && !player.flameOn && overlaps(e, player)) {
      if (hurtPlayer(def.damage * e.dmgMul * contactMul, ec.x, ec.y)) {
        e.hitCd = 0.9;
        e.kbX = -Math.sign(dx) * 300;
      }
    }

    // Enemies left far behind just leave
    if (Math.abs(pc.x - ec.x) > 2600 || Math.abs(pc.y - ec.y) > 1900) e.dead = e.despawned = true;
  }

  // Keep enemies from stacking into one blob
  for (let i = 0; i < enemies.length; i++) {
    const a = enemies[i];
    if (a.dead || a.boss) continue;
    for (let j = i + 1; j < enemies.length; j++) {
      const b = enemies[j];
      if (b.dead || b.boss || !overlaps(a, b)) continue;
      const push = (a.x + a.w / 2 < b.x + b.w / 2 ? -1 : 1) * 40 * dt * 4;
      a.x += push;
      b.x -= push;
    }
  }
}

// Cyber Ninja: crouch and flash, then dash straight through the player
function updateNinja(e, dt, dx, dy, want, busy) {
  const D = e.def.dash;
  if (e.dashT > 0) {
    e.dashT -= dt;
    if (Math.random() < 0.6) particles.push({ x: e.x + e.w / 2, y: e.y + e.h * 0.6, vx: 0, vy: 0, life: 0.25, size: 10, color: "#ff2fd6" });
    return e.dashDir * D.speed;
  }
  if (e.windup > 0) {
    e.windup -= dt;
    if (e.windup <= 0) {
      e.dashT = D.time;
      sfx.stomp.play({ rate: 1.8 });
    }
    return 0;
  }
  if (!busy && e.onGround && e.dashCd <= 0 && Math.abs(dx) < D.range && Math.abs(dy) < 130) {
    e.windup = D.windup / e.slowMul;
    e.dashDir = dx > 0 ? 1 : -1;
    e.facing = e.dashDir;
    e.dashCd = rand(D.cooldown[0], D.cooldown[1]);
    return 0;
  }
  return want;
}

// Enforcer: plods forward behind its shield; bashes when you're close
function updateEnforcer(e, dt, dx, dy, want, busy) {
  if (e.bash > 0) {
    e.bash -= dt;
    return e.facing * 650;
  }
  if (e.windup > 0) {
    e.windup -= dt;
    if (e.windup <= 0) e.bash = 0.3;
    return 0;
  }
  if (!busy && e.onGround && e.dashCd <= 0 && Math.abs(dx) < 220 && Math.abs(dy) < 140) {
    e.windup = 0.45;
    e.dashCd = rand(2.5, 3.5);
    return 0;
  }
  return want;
}

// Bomber Drone: homes in, arms a short fuse when close, then explodes.
// Returns true if it blew up this frame.
function updateBomber(e, dt, dx, dy, d, busy, sm) {
  const B = e.def.blast;
  const steer = Math.min(1, 3 * dt);
  if (e.fuse > 0) {
    e.fuse -= dt;
    e.vx *= 0.9;
    e.vy *= 0.9;
    e.x += e.vx * dt;
    e.y += e.vy * dt;
    if (e.fuse <= 0) {
      explodeBomber(e);
      return true;
    }
    return false;
  }
  const sp = busy ? 0 : (d < 420 ? 480 : e.def.speed) * sm;
  e.vx += ((dx / d) * sp - e.vx) * steer;
  e.vy += ((dy / d) * sp - e.vy) * steer;
  e.x += (e.vx + e.kbX) * dt;
  e.y += (e.vy + e.kbY) * dt;
  e.facing = dx > 0 ? 1 : -1;
  if (!busy && d < B.armRange) {
    e.fuse = B.fuse;
    sfx.enemyShot.play({ rate: 2 });
  }
  return false;
}

function explodeBomber(e) {
  if (e.exploded) return;
  e.exploded = true;
  const B = e.def.blast;
  const c = centerOf(e);
  ring(c.x, c.y, B.radius, "#ff9b21");
  burst(c.x, c.y, 26, "#ff9b21", 520);
  burst(c.x, c.y, 10, "#ffe14d", 300);
  camera.shake = Math.max(camera.shake, 10);
  sfx.stomp.play({ rate: 0.8 });
  if (circleHitsBox(c.x, c.y, B.radius, player)) hurtPlayer(e.def.damage * e.dmgMul, c.x, c.y);
  // the blast hurts other enemies too
  enemies.forEach((o) => {
    if (o !== e && !o.dead && circleHitsBox(c.x, c.y, B.radius, o)) damageEnemy(o, 30, { source: "blast" });
  });
  e.dead = true;
}

// Sniper Sentry: paints you with a laser sight, locks, fires one fast shot
function updateSniper(e, dt, busy, sm) {
  const def = e.def;
  const ec = centerOf(e);
  const pc = centerOf(player);
  if (busy) {
    e.aimT = 0;
    return;
  }
  if (e.aimT > 0) {
    e.aimT -= dt * sm;
    if (e.aimT > 0.25) e.aimAngle = Math.atan2(pc.y - ec.y, pc.x - ec.x); // tracks, then locks
    if (e.aimT <= 0) {
      fireEnemyShot(ec.x, ec.y, def.shot, e.aimAngle, e.dmgMul);
      e.firedT = 0.2;
      e.shotCd = rand(def.shot.cooldown[0], def.shot.cooldown[1]);
    }
    return;
  }
  e.firedT = Math.max(0, (e.firedT || 0) - dt);
  if (onScreen(e)) e.shotCd -= dt * sm;
  if (e.shotCd <= 0) {
    e.aimT = def.aimTime;
    e.aimAngle = Math.atan2(pc.y - ec.y, pc.x - ec.x);
  }
}

function wanderTarget(e, ec, dt) {
  e.wanderT = (e.wanderT || 0) - dt;
  if (!e.wander || e.wanderT <= 0) {
    const walker = e.def && e.def.walker;
    e.wander = { x: clamp(ec.x + rand(-450, 450), 0, WORLD_W), y: walker ? ec.y : clamp(ec.y + rand(-220, 220), WORLD_TOP + 120, 820) };
    e.wanderT = rand(1.5, 3);
  }
  return e.wander;
}

function fireEnemyShot(x, y, shot, angle, dmgMul = 1) {
  const pc = centerOf(player);
  const a = angle !== undefined ? angle : Math.atan2(pc.y - y, pc.x - x);
  enemyShots.push({ x, y, vx: Math.cos(a) * shot.speed, vy: Math.sin(a) * shot.speed, r: shot.radius, damage: shot.damage * dmgMul, kind: shot.kind, angle: a, life: 4 });
  sfx.enemyShot.play({ rate: shot.kind === "laser" ? 1.6 : shot.kind === "snipe" ? 2.2 : 0.55 });
}

function updateEnemyShots(dt) {
  for (let i = enemyShots.length - 1; i >= 0; i--) {
    const s = enemyShots[i];
    s.x += s.vx * dt;
    s.y += s.vy * dt;
    s.life -= dt;
    let gone = s.life <= 0 || s.y > GROUND_Y + 10 || s.y < camera.y - 300 || s.x < camera.x - 300 || s.x > camera.x + W + 300;
    if (!gone && circleHitsBox(s.x, s.y, s.r, player) && player.invuln <= 0) {
      hurtPlayer(s.damage, s.x - s.vx, s.y - s.vy);
      gone = true;
    }
    if (gone) {
      const color = s.kind === "laser" || s.kind === "snipe" ? "#ff2f6d" : s.kind === "ring" ? "#19f5ff" : "#ff9b21";
      burst(s.x, Math.min(s.y, GROUND_Y), 6, color, 200);
      enemyShots.splice(i, 1);
    }
  }
}

// ------------------------------------------------------- Damage & death -----
const SHIELD_BLOCKS = new Set(["zap", "orb", "blade", "missile", "chain"]);

function damageEnemy(e, amount, opts = {}) {
  if (e.dead || amount <= 0) return;
  // Enforcer shields block most damage from the front
  if (e.def && e.def.shielded && !(e.stun > 0) && SHIELD_BLOCKS.has(opts.source) && opts.fromX !== undefined) {
    const fromFront = Math.sign(opts.fromX - (e.x + e.w / 2)) === e.facing;
    if (fromFront) {
      amount *= opts.source === "blade" ? 0.5 : 0.2;
      if ((e.blockFx = (e.blockFx || 0) + 1) % 4 === 1) {
        const c = centerOf(e);
        burst(c.x + e.facing * e.w * 0.4, c.y, 6, "#19f5ff", 220);
        popup("BLOCK", c.x, e.y - 10, "#19f5ff", 18, 0.5);
      }
    }
  }
  if (opts.breaksGuard && e.def && e.def.shielded) e.stun = Math.max(e.stun, 0.8); // finisher/dash staggers
  if (e.vulnT > 0) amount *= 1.5; // hacked: takes extra damage
  e.hp -= amount;
  e.hurt = 0.08;
  // Heat is earned by dealing damage - but not with the flame itself
  if (opts.source !== "flame") gainHeat(amount * TUNING.heat.perDamageDealt);
  const resist = e.boss ? 0.1 : e.def && e.def.shielded ? 0.4 : 1;
  if (opts.kbX) e.kbX += opts.kbX * resist;
  if (opts.kbY) e.kbY += opts.kbY * resist;
  const c = centerOf(e);
  if (!opts.quiet) damageNumber(amount, c.x, e.y - 6, opts.source === "chain" ? "#9ffcff" : e.vulnT > 0 ? "#5aff7a" : "#ffffff");
  // Sudo's overload, fully upgraded: hacked enemies leak XP when hit
  if (e.stun > 0 && player.char === "sudo" && stats.overload.leak && Math.random() < 0.12) spawnGem(c.x, c.y, 1);
  if (e.hp <= 0) killEnemy(e);
}

function killEnemy(e) {
  e.dead = true;
  const c = centerOf(e);
  game.kills++;
  gainHeat(TUNING.heat.perKill);
  if (game.kills % 50 === 0) say("kills", { n: game.kills });
  if (e.boss) {
    burst(c.x, c.y, 60, "#ff2457", 700);
    burst(c.x, c.y, 40, "#ffe14d", 500);
    camera.shake = 24;
    if (e.type === "overseer") overseerDefeated(e);
    else goatDefeated(e);
    return;
  }
  if (e.type === "bomber") explodeBomber(e); // shooting a bomber sets it off
  burst(c.x, c.y, 14, e.def.kind === "ranged" || e.def.kind === "sniper" ? "#19f5ff" : "#ff2fd6", 320);
  sfx.kill.play({ rate: 0.8 + Math.random() * 0.4 });
  // XP: one big chip for tough enemies, small chips otherwise
  const xp = e.def.xp * (e.elite ? 3 : 1);
  if (xp >= 4) spawnGem(c.x, c.y, xp);
  else for (let i = 0; i < xp; i++) spawnGem(c.x + rand(-10, 10), c.y, 1);
  if (Math.random() < (e.elite ? 0.3 : POWERUP_DROP_CHANCE)) spawnPowerup(c.x, c.y);
}

function sweepDead() {
  for (let i = enemies.length - 1; i >= 0; i--) if (enemies[i].dead) enemies.splice(i, 1);
}

// -------------------------------------------------------------- Drawing -----
// Which frame of an enemy's sheet to show (special poses for dashes etc.)
function enemyFrame(e, s) {
  if (e.dashT > 0 || e.windup > 0) return s.dashFrame !== undefined ? s.dashFrame : s.bashFrame !== undefined ? s.bashFrame : 0;
  if (e.bash > 0 && s.bashFrame !== undefined) return s.bashFrame;
  if (e.fuse > 0 && s.armedFrame !== undefined) return Math.floor(e.fuse * 16) % 2 ? s.armedFrame : 0;
  if (e.firedT > 0 && s.fireFrame !== undefined) return s.fireFrame;
  return Math.floor(e.anim) % s.frames;
}

function drawEnemies(time) {
  for (const e of enemies) {
    if (e.dead) continue;
    if (e.boss) {
      if (e.type === "overseer") drawOverseer(e, time);
      else drawGoat(e, time);
      continue;
    }
    if (e.x > camera.x + W + 100 || e.x + e.w < camera.x - 100) continue;
    const s = e.def.sheet;
    const dw = s.fw * s.scale * e.size;
    const dh = s.fh * s.scale * e.size;
    const cx = e.x + e.w / 2;
    const dx = cx - dw / 2;
    const dy = e.def.walker ? e.y + e.h - dh : e.y + e.h / 2 - dh / 2;
    const frame = enemyFrame(e, s);
    let tint = null;
    if (e.hurt > 0) tint = "rgba(255,255,255,0.85)";
    else if (e.stun > 0) tint = "rgba(176,108,255,0.5)";
    else if (e.slowT > 0) tint = "rgba(90,255,122,0.35)";
    if (e.elite) glow(cx, e.y + e.h / 2, Math.max(e.w, e.h) * 0.9, "rgba(255,200,40,0.45)");
    if (e.def.kind === "ranged") glow(cx, e.y + e.h / 2, 60, e.type === "drone" ? "rgba(255,47,109,0.25)" : "rgba(255,155,33,0.2)");
    if (e.charge > 0) {
      const pulse = 0.5 + 0.5 * Math.sin(e.charge * 40);
      glow(cx + e.facing * 20, e.y + e.h / 2, 50 + pulse * 20, e.type === "drone" ? "rgba(255,47,109,0.9)" : "rgba(255,155,33,0.9)");
      if (!tint) tint = `rgba(255,255,255,${0.15 + 0.25 * pulse})`;
    }
    if (e.windup > 0 && !tint) {
      // ninjas and enforcers flash before they lunge
      const pulse = 0.5 + 0.5 * Math.sin(e.windup * 50);
      tint = `rgba(255,47,214,${0.25 + 0.35 * pulse})`;
      glow(cx, e.y + e.h * 0.6, 70, "rgba(255,47,214,0.6)", pulse);
    }
    if (e.fuse > 0) glow(cx, e.y + e.h / 2, 90, "rgba(255,60,40,0.8)", 0.5 + 0.5 * Math.sin(e.fuse * 40));
    if (e.type === "sniper") drawSniperSight(e);
    const img = isReady(IMG[s.img]) ? IMG[s.img] : IMG[s.fallback];
    const sy = s.flip ? 0 : (e.facing < 0 ? s.rowLeft : s.rowRight) * s.fh;
    const flip = s.flip && e.facing < 0;
    const glitching = drawGlitch(img, frame * s.fw, sy, s.fw, s.fh, dx, dy, dw, dh, flip, e.bob);
    ctx.globalAlpha = e.def.alpha || 1;
    const ok = drawFrame(img, frame * s.fw, sy, s.fw, s.fh, dx + glitching, dy, dw, dh, tint, flip);
    ctx.globalAlpha = 1;
    if (!ok) {
      ctx.fillStyle = e.def.kind === "melee" ? "#ff2fd6" : e.def.kind === "bomber" ? "#ff9b21" : "#19f5ff";
      ctx.fillRect(e.x, e.y, e.w, e.h);
    }
    if (e.def.shielded && !(e.stun > 0)) {
      // the shield's glowing edge
      ctx.fillStyle = "rgba(25,245,255,0.7)";
      ctx.fillRect(e.facing > 0 ? e.x + e.w - 6 : e.x, e.y + e.h * 0.2, 6, e.h * 0.6);
    }
    if (e.stun > 0) {
      const a = time * 6;
      if (!drawCell("fx", 6, 32, cx, e.y - 22, 40, 40, a)) hudText("*", cx, e.y - 22, 26, "#ffe14d", "center", "middle");
    }
    // Small health bar once damaged
    if (e.hp < e.maxHp) {
      ctx.fillStyle = "rgba(0,0,0,0.6)";
      ctx.fillRect(cx - 30, e.y - 14, 60, 6);
      ctx.fillStyle = e.elite ? "#ffc828" : "#ff2457";
      ctx.fillRect(cx - 30, e.y - 14, 60 * Math.max(0, e.hp / e.maxHp), 6);
    }
  }
}

// The sniper's laser sight: thin and tracking, then solid when it locks
function drawSniperSight(e) {
  if (!(e.aimT > 0)) return;
  const c = centerOf(e);
  const locked = e.aimT <= 0.25;
  const len = 2200;
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  ctx.strokeStyle = locked ? "rgba(255,255,255,0.95)" : `rgba(255,40,70,${0.35 + 0.3 * Math.sin(e.aimT * 30)})`;
  ctx.lineWidth = locked ? 5 : 2;
  ctx.beginPath();
  ctx.moveTo(c.x, c.y);
  ctx.lineTo(c.x + Math.cos(e.aimAngle) * len, c.y + Math.sin(e.aimAngle) * len);
  ctx.stroke();
  if (locked) {
    ctx.strokeStyle = "rgba(255,40,70,0.6)";
    ctx.lineWidth = 12;
    ctx.stroke();
  }
  ctx.restore();
}

function drawGlitch(img, sx, sy, sw, sh, dx, dy, dw, dh, flip, phase) {
  if (!isReady(img)) return 0;
  const g = (game.time * 0.8 + phase * 3.1) % 3.2;
  if (g > 0.14) return 0;
  const split = 6 + 6 * Math.sin(g * 90);
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  ctx.globalAlpha = 0.55;
  drawFrame(img, sx, sy, sw, sh, dx - split, dy, dw, dh, "rgba(255,20,90,1)", flip);
  drawFrame(img, sx, sy, sw, sh, dx + split, dy, dw, dh, "rgba(20,240,255,1)", flip);
  ctx.restore();
  return g < 0.05 ? rand(-8, 8) : 0;
}

function drawEnemyShots() {
  const flame = smallOr("fire");
  ctx.imageSmoothingEnabled = true;
  enemyShots.forEach((s) => {
    if (s.kind === "laser") {
      glow(s.x, s.y, 40, "rgba(255,47,109,0.6)");
      if (!drawCell("projectiles", 2, 16, s.x, s.y, 44, 44, s.angle)) {
        ctx.fillStyle = "#ff2f6d";
        ctx.fillRect(s.x - 10, s.y - 4, 20, 8);
      }
      return;
    }
    if (s.kind === "snipe") {
      // a long bright tracer
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      ctx.strokeStyle = "rgba(255,60,90,0.9)";
      ctx.lineWidth = 6;
      ctx.beginPath();
      ctx.moveTo(s.x, s.y);
      ctx.lineTo(s.x - Math.cos(s.angle) * 90, s.y - Math.sin(s.angle) * 90);
      ctx.stroke();
      ctx.restore();
      glow(s.x, s.y, 30, "rgba(255,255,255,0.9)");
      return;
    }
    if (s.kind === "ring") {
      // the Overseer's bullet rings
      glow(s.x, s.y, 34, "rgba(25,245,255,0.75)");
      ctx.fillStyle = "#e9ffff";
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.r * 0.6, 0, Math.PI * 2);
      ctx.fill();
      return;
    }
    glow(s.x, s.y, 60, "rgba(255,90,20,0.6)");
    if (!flame) return;
    const k = s.r / 20;
    ctx.save();
    ctx.translate(s.x, s.y);
    ctx.rotate(s.angle - Math.PI / 2); // flame tip trails behind
    ctx.drawImage(flame, -29 * k, -80 * 0.68 * k, 58 * k, 80 * k);
    ctx.restore();
  });
}
