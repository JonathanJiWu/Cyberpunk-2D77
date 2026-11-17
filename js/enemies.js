"use strict";
// =============================================================================
// Enemies: the spawn director, minion AI (melee + ranged), enemy shots, and
// the Demon Goat boss.
// =============================================================================

const enemies = [];
const enemyShots = [];
const director = { acc: 0, bossSpawned: false, firstSpawn: 1.5 };

const onScreen = (e) => e.x + e.w > camera.x && e.x < camera.x + W && e.y + e.h > 0 && e.y < H;

function resetEnemies() {
  enemies.length = 0;
  enemyShots.length = 0;
  director.acc = 0;
  director.bossSpawned = false;
}

// ------------------------------------------------------------- Spawning -----
function spawnEnemy(type, x, y) {
  const def = ENEMY_TYPES[type];
  const hp = def.hp * (1 + game.time * TUNING.spawn.hpGrowth);
  const e = {
    type,
    def,
    x,
    y,
    w: def.w,
    h: def.h,
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
    orbitCd: 0,
    hitCd: 0,
    jumpCd: rand(0.5, 1.5),
    shotCd: def.shot ? rand(def.shot.cooldown[0], def.shot.cooldown[1]) : 0,
    bob: rand(0, Math.PI * 2),
    onGround: false,
    standingOn: null,
  };
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
  const y = def.walker ? GROUND_Y - def.h : rand(140, 620);
  spawnEnemy(type, x, y);
}

const countAlive = (type) => enemies.reduce((n, e) => n + (!e.dead && e.type === type ? 1 : 0), 0);

function updateDirector(dt) {
  const S = TUNING.spawn;
  const t = game.time;
  if (!director.bossSpawned && t >= TUNING.boss.at) spawnBoss();
  if (t < director.firstSpawn) return;
  let rate = Math.min(S.maxRate, S.startRate + t * S.ratePerSecond);
  if (game.boss && !game.boss.dead) rate *= 0.45;
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
    if (e.boss) {
      updateBoss(e, dt);
      continue;
    }
    const def = e.def;
    e.hurt -= dt;
    e.orbitCd -= dt;
    e.hitCd -= dt;
    e.stun -= dt;
    const stunned = e.stun > 0;
    const ec = centerOf(e);
    // Thermoptic camo (easter egg): enemies lose you and wander around
    const blind = player.camo > 0;
    const tgt = blind ? wanderTarget(e, ec, dt) : pc;
    const dx = tgt.x - ec.x;
    const dy = tgt.y - ec.y;
    const d = Math.hypot(dx, dy) || 1;
    const steer = Math.min(1, 3 * dt);

    if (def.walker) {
      // Walk toward the player, hop up to platforms when the player is above
      e.jumpCd -= dt;
      const want = stunned || Math.abs(dx) < 12 ? 0 : Math.sign(dx) * def.speed;
      e.vx += (want - e.vx) * Math.min(1, 8 * dt);
      const playerAbove = !blind && player.y + player.h < e.y + e.h - 90;
      if (!stunned && e.onGround && e.jumpCd <= 0 && playerAbove && Math.abs(dx) < 340) {
        e.vy = -rand(980, 1180);
        e.jumpCd = rand(1, 2);
      }
      e.x += e.kbX * dt;
      if (e.kbY < 0) {
        e.vy += e.kbY;
        e.kbY = 0;
      }
      moveBody(e, dt, 2700, 1500);
      if (Math.abs(e.vx) > 20) e.facing = e.vx > 0 ? 1 : -1;
    } else if (def.kind === "melee") {
      // Reapers drift straight at you through everything
      const sp = stunned ? 0 : def.speed;
      e.vx += ((dx / d) * sp - e.vx) * steer;
      e.vy += ((dy / d) * sp - e.vy) * steer;
      e.x += (e.vx + e.kbX) * dt;
      e.y += (e.vy + e.kbY) * dt + Math.sin(game.time * 2.5 + e.bob) * 25 * dt;
      e.facing = dx > 0 ? 1 : -1;
    } else {
      // Ranged flyers keep their distance above you and shoot
      const side = ec.x < pc.x ? -1 : 1;
      const tx = blind ? tgt.x : pc.x + side * def.keepDistance;
      const ty = blind ? tgt.y : pc.y - (e.type === "dragon" ? 330 : 250) + Math.sin(game.time * 1.4 + e.bob) * 70;
      const ddx = tx - ec.x;
      const ddy = ty - ec.y;
      const dd = Math.hypot(ddx, ddy) || 1;
      const sp = stunned ? 0 : Math.min(def.speed, dd * 2.5);
      e.vx += ((ddx / dd) * sp - e.vx) * steer;
      e.vy += ((ddy / dd) * sp - e.vy) * steer;
      e.x += (e.vx + e.kbX) * dt;
      e.y += (e.vy + e.kbY) * dt;
      e.facing = dx > 0 ? 1 : -1;
      // Charge up (glowing) for a moment before every shot so it can be dodged
      if (!stunned && !blind && onScreen(e)) e.shotCd -= dt;
      if (e.charge > 0) {
        e.charge -= dt;
        if (e.charge <= 0 && !stunned) {
          fireEnemyShot(ec.x + e.facing * 20, ec.y, def.shot);
          e.shotCd = rand(def.shot.cooldown[0], def.shot.cooldown[1]);
        }
      } else if (e.shotCd <= 0 && !stunned && !blind) {
        e.charge = 0.45;
      }
    }
    const decay = Math.exp(-8 * dt);
    e.kbX *= decay;
    e.kbY *= decay;
    e.x = clamp(e.x, 0, WORLD_W - e.w);
    if (!def.walker) e.y = clamp(e.y, 40, GROUND_Y - e.h - 10);
    e.anim += dt * def.sheet.fps;

    // Body contact
    if (!stunned && !blind && e.hitCd <= 0 && !player.flameOn && overlaps(e, player)) {
      if (hurtPlayer(def.damage, ec.x, ec.y)) {
        e.hitCd = 0.9;
        e.kbX = -Math.sign(dx) * 300;
      }
    }

    // Enemies left far behind just leave
    if (Math.abs(pc.x - ec.x) > 2600) e.dead = e.despawned = true;
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

function wanderTarget(e, ec, dt) {
  e.wanderT = (e.wanderT || 0) - dt;
  if (!e.wander || e.wanderT <= 0) {
    const walker = e.def && e.def.walker;
    e.wander = { x: clamp(ec.x + rand(-450, 450), 0, WORLD_W), y: walker ? ec.y : clamp(ec.y + rand(-220, 220), 120, 820) };
    e.wanderT = rand(1.5, 3);
  }
  return e.wander;
}

function fireEnemyShot(x, y, shot, angle) {
  const pc = centerOf(player);
  const a = angle !== undefined ? angle : Math.atan2(pc.y - y, pc.x - x);
  enemyShots.push({ x, y, vx: Math.cos(a) * shot.speed, vy: Math.sin(a) * shot.speed, r: shot.radius, damage: shot.damage, kind: shot.kind, angle: a, life: 4 });
  sfx.enemyShot.play({ rate: shot.kind === "laser" ? 1.6 : 0.55 });
}

function updateEnemyShots(dt) {
  for (let i = enemyShots.length - 1; i >= 0; i--) {
    const s = enemyShots[i];
    s.x += s.vx * dt;
    s.y += s.vy * dt;
    s.life -= dt;
    let gone = s.life <= 0 || s.y > GROUND_Y + 10 || s.x < camera.x - 300 || s.x > camera.x + W + 300;
    if (!gone && circleHitsBox(s.x, s.y, s.r, player) && player.invuln <= 0) {
      hurtPlayer(s.damage, s.x - s.vx, s.y - s.vy);
      gone = true;
    }
    if (gone) {
      burst(s.x, Math.min(s.y, GROUND_Y), 6, s.kind === "laser" ? "#ff2f6d" : "#ff9b21", 200);
      enemyShots.splice(i, 1);
    }
  }
}

// ------------------------------------------------------- Damage & death -----
function damageEnemy(e, amount, opts = {}) {
  if (e.dead || amount <= 0) return;
  e.hp -= amount;
  e.hurt = 0.08;
  // Heat is earned by dealing damage - but not with the flame itself
  if (opts.source !== "flame") gainHeat(amount * TUNING.heat.perDamageDealt);
  const resist = e.boss ? 0.1 : 1;
  if (opts.kbX) e.kbX += opts.kbX * resist;
  if (opts.kbY) e.kbY += opts.kbY * resist;
  if (!opts.quiet) {
    const c = centerOf(e);
    damageNumber(amount, c.x, e.y - 6, opts.source === "chain" ? "#9ffcff" : "#ffffff");
  }
  if (e.hp <= 0) killEnemy(e);
}

function killEnemy(e) {
  e.dead = true;
  const c = centerOf(e);
  game.kills++;
  gainHeat(TUNING.heat.perKill);
  if (e.boss) {
    burst(c.x, c.y, 60, "#ff2457", 700);
    burst(c.x, c.y, 40, "#ffe14d", 500);
    camera.shake = 24;
    win();
    return;
  }
  burst(c.x, c.y, 14, e.def.kind === "ranged" ? "#19f5ff" : "#ff2fd6", 320);
  sfx.kill.play({ rate: 0.8 + Math.random() * 0.4 });
  // XP: one big chip for tough enemies, small chips otherwise
  if (e.def.xp >= 4) spawnGem(c.x, c.y, e.def.xp);
  else for (let i = 0; i < e.def.xp; i++) spawnGem(c.x + rand(-10, 10), c.y, 1);
  if (Math.random() < POWERUP_DROP_CHANCE) spawnPowerup(c.x, c.y);
}

function sweepDead() {
  for (let i = enemies.length - 1; i >= 0; i--) if (enemies[i].dead) enemies.splice(i, 1);
}

// ------------------------------------------------------------ The boss ------
function spawnBoss() {
  director.bossSpawned = true;
  const T = TUNING.boss;
  const e = {
    boss: true,
    type: "goat",
    x: clamp(camera.x + W - 420, 0, WORLD_W - 200),
    y: -260,
    w: 132,
    h: 210,
    vx: 0,
    vy: 0,
    kbX: 0,
    kbY: 0,
    hp: T.maxHp,
    maxHp: T.maxHp,
    ghostHp: T.maxHp,
    frameX: 0,
    frameY: 1,
    anim: 0,
    state: "enter",
    stateTime: 0,
    stateDuration: 1.6,
    burnTime: 0,
    hurt: 0,
    stun: 0,
    orbitCd: 0,
    hitCd: 0,
    enraged: false,
  };
  enemies.push(e);
  game.boss = e;
  game.banner = { text: "THE DEMON GOAT APPROACHES!", time: 2.5, color: "#ff2457" };
  music.setIntensity(2); // the soundtrack kicks up a gear
  camera.shake = Math.max(camera.shake, 14);
  sfx.enemyShot.play({ rate: 0.35 });
}

function setBossState(e, state, duration) {
  e.state = state;
  e.stateTime = 0;
  e.stateDuration = duration || 0;
  if (state === "chase") e.stateDuration = duration || (e.enraged ? rand(2.2, 3.2) : rand(3, 4.5));
  if (state === "reposition") {
    e.targetX = camera.x + rand(260, W - 260);
    e.targetY = rand(170, 420);
  }
  if (state === "volley") {
    e.shotsLeft = e.enraged ? 4 : 3;
    e.shotTimer = 0;
  }
}

function setFacingRow(e, dx, dy) {
  if (Math.abs(dx) >= Math.abs(dy)) e.frameY = dx < 0 ? 1 : 2;
  else e.frameY = dy < 0 ? 3 : 0;
}

function updateBoss(e, dt) {
  const T = TUNING.boss;
  e.stateTime += dt;
  e.hurt -= dt;
  e.orbitCd -= dt;
  e.hitCd -= dt;
  e.stun -= dt;
  e.ghostHp = Math.max(e.hp, e.ghostHp - 80 * dt);
  const ec = centerOf(e);
  const blind = player.camo > 0; // thermoptic camo
  const pc = blind ? wanderTarget(e, ec, dt) : centerOf(player);
  const toX = pc.x - ec.x;
  const toY = pc.y - ec.y;
  const mul = e.enraged ? T.enrageSpeedMul : 1;
  let tx = 0;
  let ty = 0;
  let speed = 0;
  let facePlayer = false;

  if (e.stun > 0) {
    facePlayer = true;
  } else {
    switch (e.state) {
      case "enter":
        tx = camera.x + W * 0.65 - ec.x;
        ty = 360 - ec.y;
        speed = T.hoverSpeed;
        facePlayer = true;
        if (e.stateTime > e.stateDuration) setBossState(e, "windup");
        break;
      case "chase":
        tx = toX;
        ty = toY;
        speed = T.chaseSpeed * mul;
        if (e.stateTime > e.stateDuration) setBossState(e, "reposition");
        break;
      case "reposition":
        tx = e.targetX - ec.x;
        ty = e.targetY - ec.y;
        speed = T.hoverSpeed * mul;
        if (Math.hypot(tx, ty) < 30 || e.stateTime > 2.2) setBossState(e, "windup");
        break;
      case "windup": // glows before it shoots
        facePlayer = true;
        if (e.stateTime > T.windup / mul) setBossState(e, "volley");
        break;
      case "volley":
        facePlayer = true;
        e.shotTimer -= dt;
        if (e.shotTimer <= 0) {
          if (e.shotsLeft > 0) {
            const shot = { kind: "fireball", damage: T.fireballDamage, speed: T.fireballSpeed * (e.enraged ? 1.2 : 1), radius: 20 };
            const base = Math.atan2(pc.y - (ec.y - 40), pc.x - ec.x);
            const angles = e.enraged ? [base - 0.2, base, base + 0.2] : [base];
            if (!blind) angles.forEach((a) => fireEnemyShot(ec.x, ec.y - 40, shot, a));
            e.shotsLeft--;
            e.shotTimer = T.shotInterval / mul;
          } else {
            setBossState(e, "chase");
          }
        }
        break;
      case "recoil":
        tx = e.awayX;
        ty = e.awayY;
        speed = T.recoilSpeed * Math.max(0, 1 - e.stateTime / e.stateDuration);
        if (e.stateTime > e.stateDuration) setBossState(e, e.nextState);
        break;
    }
  }

  const len = Math.hypot(tx, ty);
  const wantVx = len > 1 ? (tx / len) * speed : 0;
  const wantVy = len > 1 ? (ty / len) * speed : 0;
  const k = e.state === "recoil" ? 1 : 1 - Math.exp(-7 * dt);
  e.vx += (wantVx - e.vx) * k;
  e.vy += (wantVy - e.vy) * k;
  e.x = clamp(e.x + (e.vx + e.kbX) * dt, 0, WORLD_W - e.w);
  e.y = clamp(e.y + (e.vy + e.kbY) * dt, e.state === "enter" ? -300 : 30, GROUND_Y - e.h);
  e.kbX *= Math.exp(-8 * dt);
  e.kbY *= Math.exp(-8 * dt);

  if (facePlayer) setFacingRow(e, toX, toY);
  else if (Math.hypot(e.vx, e.vy) > 30) setFacingRow(e, e.vx, e.vy);
  const animSpeed = e.state === "windup" ? 14 : Math.hypot(e.vx, e.vy) > 30 ? 8 : 0;
  e.anim += dt * animSpeed;
  e.frameX = animSpeed ? Math.floor(e.anim) % 4 : 0;

  if (!e.enraged && e.hp <= T.maxHp * T.enrageAt) {
    e.enraged = true;
    game.banner = { text: "THE GOAT IS ENRAGED!", time: 2, color: "#ff2457" };
    camera.shake = Math.max(camera.shake, 12);
    burst(ec.x, ec.y, 30, "#ff2457", 520);
  }

  // Touching the flame burns it and drives it away
  const me = centerOf(player); // the real player position (pc may be a wander point)
  const burning = player.flameOn && circleHitsBox(me.x, me.y, stats.flame.radius, e);
  if (burning) {
    e.burnTime += dt;
    if (e.burnTime > 0.35 && e.state !== "recoil") {
      recoilBoss(e, me.x, me.y, 0.45, "reposition");
      e.burnTime = 0;
    }
  } else {
    e.burnTime = 0;
  }
  if (!burning && !blind && e.stun <= 0 && e.state !== "recoil" && e.state !== "enter" && overlaps(e, player)) {
    if (hurtPlayer(T.contactDamage, ec.x, ec.y)) recoilBoss(e, me.x, me.y, 0.5, Math.random() < 0.5 ? "chase" : "reposition");
  }
}

function recoilBoss(e, fromX, fromY, duration, next) {
  const c = centerOf(e);
  const dx = c.x - fromX;
  const dy = c.y - fromY;
  const d = Math.hypot(dx, dy) || 1;
  e.awayX = dx / d;
  e.awayY = dy / d - 0.35;
  setBossState(e, "recoil", duration);
  e.nextState = next;
}

// -------------------------------------------------------------- Drawing -----
function drawEnemies(time) {
  for (const e of enemies) {
    if (e.dead) continue;
    if (e.boss) {
      drawBoss(e);
      continue;
    }
    if (e.x > camera.x + W + 100 || e.x + e.w < camera.x - 100) continue;
    const s = e.def.sheet;
    const dw = s.fw * s.scale;
    const dh = s.fh * s.scale;
    const cx = e.x + e.w / 2;
    const dx = cx - dw / 2;
    const dy = e.def.walker ? e.y + e.h - dh : e.y + e.h / 2 - dh / 2;
    const frame = Math.floor(e.anim) % s.frames;
    let tint = null;
    if (e.hurt > 0) tint = "rgba(255,255,255,0.85)";
    else if (e.stun > 0) tint = "rgba(176,108,255,0.5)";
    if (e.def.kind === "ranged") glow(cx, e.y + e.h / 2, 60, e.type === "drone" ? "rgba(255,47,109,0.25)" : "rgba(255,155,33,0.2)");
    if (e.charge > 0) {
      const pulse = 0.5 + 0.5 * Math.sin(e.charge * 40);
      glow(cx + e.facing * 20, e.y + e.h / 2, 50 + pulse * 20, e.type === "drone" ? "rgba(255,47,109,0.9)" : "rgba(255,155,33,0.9)");
      if (!tint) tint = `rgba(255,255,255,${0.15 + 0.25 * pulse})`;
    }
    ctx.globalAlpha = e.def.alpha || 1;
    let ok;
    if (s.flip) {
      ok = drawFrame(IMG[s.img], frame * s.fw, 0, s.fw, s.fh, dx, dy, dw, dh, tint, e.facing < 0);
    } else {
      const row = e.facing < 0 ? s.rowLeft : s.rowRight;
      ok = drawFrame(IMG[s.img], frame * s.fw, row * s.fh, s.fw, s.fh, dx, dy, dw, dh, tint);
    }
    ctx.globalAlpha = 1;
    if (!ok) {
      ctx.fillStyle = e.def.kind === "ranged" ? "#19f5ff" : "#ff2fd6";
      ctx.fillRect(e.x, e.y, e.w, e.h);
    }
    // Small health bar once damaged
    if (e.hp < e.maxHp) {
      ctx.fillStyle = "rgba(0,0,0,0.6)";
      ctx.fillRect(cx - 30, e.y - 14, 60, 6);
      ctx.fillStyle = "#ff2457";
      ctx.fillRect(cx - 30, e.y - 14, 60 * Math.max(0, e.hp / e.maxHp), 6);
    }
  }
}

function drawBoss(e) {
  const c = centerOf(e);
  if (e.state === "windup") {
    const pulse = 0.5 + 0.5 * Math.sin(e.stateTime * 30);
    glow(c.x, c.y - 30, 180 + pulse * 40, "rgba(255,140,30,0.8)", 0.6 + pulse * 0.3);
  } else if (e.enraged) {
    glow(c.x, c.y, 190, "rgba(255,20,60,0.5)");
  }
  let tint = null;
  if (e.hurt > 0) tint = "rgba(255,255,255,0.85)";
  else if (e.stun > 0) tint = "rgba(176,108,255,0.5)";
  else if (e.state === "windup") tint = `rgba(255,170,40,${0.2 + 0.2 * Math.sin(e.stateTime * 30)})`;
  else if (e.enraged) tint = "rgba(255,0,40,0.25)";
  if (!drawFrame(IMG.goat, e.frameX * 80, e.frameY * 80, 80, 80, e.x - 54, e.y - 24, 240, 240, tint)) {
    ctx.fillStyle = "#ff2457";
    ctx.fillRect(e.x, e.y, e.w, e.h);
  }
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
