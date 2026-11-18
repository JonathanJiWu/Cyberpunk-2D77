"use strict";
// =============================================================================
// Shared boss machinery. Bosses fight like rival Individual Contributors:
// they run, jump between platforms, telegraph every attack and talk trash.
//   - bossIntro(): a letterboxed entrance with a name card. Minions derez
//     (their XP stays behind) and nothing else spawns until the boss is down.
//   - grounded movement (the same platform physics as the player)
//   - shockwaves that roll along the ground (jump them)
//   - speech bubbles
// The Overseer lives in overseer.js, NULL in null.js and the final boss (the
// GOAT) in goat.js.
// =============================================================================

const shockwaves = [];

function makeBoss(type, w, h, x, y) {
  const hp = BOSSES[type].hp * coopMul("bossHp"); // tougher against two players (coop.js)
  return {
    boss: true,
    coopHp: coopMul("bossHp"),
    type,
    x,
    y,
    w,
    h,
    vx: 0,
    vy: 0,
    kbX: 0,
    kbY: 0,
    hp,
    maxHp: hp,
    ghostHp: hp,
    anim: 0,
    state: "intro",
    stateTime: 0,
    hurt: 0,
    stun: 0,
    vulnT: 0,
    // status effects from the IC kits (declared up front so the shape stays stable)
    glitchT: 0,
    knockT: 0,
    bleedT: 0,
    bleedDps: 0,
    burnT: 0,
    burnDps: 0,
    bleedAcc: 0,
    downed: null,
    airFrom: 0,
    orbitCd: 0,
    hitCd: 0,
    burnTime: 0,
    enraged: false,
    facing: -1,
    onGround: false,
    standingOn: null,
    dropTimer: 0,
    airJumps: 0,
    speech: null,
    speechCd: 3,
    contactCd: 0,
    frame: 0,
    step: 0,
    timer: 0,
  };
}

// ------------------------------------------------------------- Entrance -----
function bossIntro(e, seconds = 3.4) {
  derezMinions();
  enemyShots.length = 0;
  const def = BOSSES[e.type];
  game.cinematic = { time: seconds, max: seconds, title: def.name.toUpperCase(), subtitle: def.intro, color: e.type === "goat" ? "#ff2457" : "#19f5ff", lock: true, focus: e };
  music.setIntensity(2);
  sfx.chain.play({ rate: 0.4 });
  vibrate([60, 40, 120]);
  bossSay(e, def.taunts[0], true);
}

// Every minion glitches out of existence (and leaves its XP behind)
function derezMinions() {
  enemies.forEach((m) => {
    if (m.dead || m.boss) return;
    m.dead = true;
    const c = centerOf(m);
    burst(c.x, c.y, 12, "#19f5ff", 280);
    burst(c.x, c.y, 6, "#ff2fd6", 200);
    spawnGem(c.x, c.y, m.def.xp * (m.elite ? 3 : 1));
  });
}

// Bosses are busy being dramatic: no hits either way during the intro
const bossLocked = () => !!(game.cinematic && game.cinematic.lock);

// ---------------------------------------------------------- Movement --------
const BOSS_GRAVITY = 2900;

// Run toward targetX; hop up to a higher player, drop down to a lower one
function bossNavigate(e, dt, targetX, speed) {
  const pc = centerOf(player);
  const ec = centerOf(e);
  const dx = targetX - ec.x;
  const want = Math.abs(dx) < 20 ? 0 : Math.sign(dx) * speed;
  e.vx += (want - e.vx) * (1 - Math.exp(-10 * dt));
  if (Math.abs(e.vx) > 30) e.facing = Math.sign(e.vx);
  const playerAbove = player.onGround && pc.y < ec.y - 140;
  const playerBelow = player.onGround && pc.y > ec.y + 160;
  if (e.onGround && playerAbove && Math.abs(pc.x - ec.x) < 520) bossJump(e, 1350);
  else if (!e.onGround && e.vy > 0 && e.airJumps > 0 && playerAbove && e.y + e.h > player.y + player.h + 40) bossJump(e, 1150);
  if (e.onGround && playerBelow && e.standingOn && !e.standingOn.ground) e.dropTimer = 0.3;
}

function bossJump(e, v) {
  if (e.onGround) e.airJumps = 1;
  else if (e.airJumps > 0) e.airJumps--;
  else return;
  e.vy = -v;
  e.onGround = false;
  dust(e.x + e.w / 2, e.y + e.h, 10, 1.5);
}

function bossPhysics(e, dt, gravity = BOSS_GRAVITY) {
  e.dropTimer = Math.max(0, e.dropTimer - dt);
  const landed = moveBody(e, dt, gravity, 2200);
  if (landed) {
    e.airJumps = 1;
    dust(e.x + e.w / 2, e.y + e.h, 8, 1.4);
  }
  return landed;
}

function faceThePlayer(e) {
  const d = centerOf(player).x - centerOf(e).x;
  if (Math.abs(d) > 10) e.facing = Math.sign(d);
}

function bossTimers(e, dt) {
  e.stateTime += dt;
  e.hurt -= dt;
  e.orbitCd -= dt;
  e.hitCd -= dt;
  e.stun -= dt;
  e.contactCd -= dt;
  e.speechCd -= dt;
  e.anim += dt;
  e.ghostHp = Math.max(e.hp, e.ghostHp - 110 * dt);
  if (e.speech && (e.speech.time -= dt) <= 0) e.speech = null;
}

function bossState(e, state) {
  e.state = state;
  e.stateTime = 0;
  e.step = 0;
  e.timer = 0;
}

// Touching a boss hurts (bosses don't care about Paine's flame), whichever player
function bossContact(e, damage) {
  eachTarget(() => {
    if (bossLocked() || e.contactCd > 0 || player.camo > 0) return;
    if (!overlaps(e, player)) return;
    const c = centerOf(e);
    if (hurtPlayer(damage, c.x, c.y, e)) e.contactCd = 0.6;
  });
}

// ------------------------------------------------------------ Shockwaves ----
// A wall of energy rolling along the ground (or a platform). Jump over it.
function spawnShockwave(x, y, dir, opts = {}) {
  shockwaves.push({ owner: opts.owner || game.boss, x, y, dir, speed: opts.speed || 760, life: opts.life || 1.1, h: opts.h || 64, damage: opts.damage || 14, color: opts.color || "#19f5ff", hit: new Set(), t: 0 });
}

function updateShockwaves(dt) {
  for (let i = shockwaves.length - 1; i >= 0; i--) {
    const s = shockwaves[i];
    s.t += dt;
    s.x += s.dir * s.speed * dt;
    if (s.t > s.life || s.x < -100 || s.x > WORLD_W + 100) {
      shockwaves.splice(i, 1);
      continue;
    }
    if (Math.random() < 0.5) dust(s.x, s.y, 1, 0.8);
    // it hits each player once (s.hit: the players it got)
    eachTarget(() => {
      const p = player;
      const pc = centerOf(p);
      const feet = p.y + p.h;
      if (!s.hit.has(p) && Math.abs(pc.x - s.x) < 34 && feet > s.y - s.h * 0.6 && feet <= s.y + 6 && !bossLocked()) {
        if (hurtPlayer(s.damage, s.x - s.dir * 40, s.y, s.owner)) s.hit.add(p);
      }
    });
  }
}

function drawShockwaves(time) {
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  shockwaves.forEach((s) => {
    const fade = Math.min(1, (s.life - s.t) / 0.25);
    const g = ctx.createLinearGradient(0, s.y - s.h, 0, s.y);
    g.addColorStop(0, "rgba(255,255,255,0)");
    g.addColorStop(1, s.color);
    ctx.globalAlpha = 0.85 * fade;
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(s.x - s.dir * 70, s.y);
    ctx.quadraticCurveTo(s.x - s.dir * 10, s.y - s.h * (1.1 + 0.1 * Math.sin(time * 40)), s.x + s.dir * 22, s.y);
    ctx.fill();
  });
  ctx.restore();
  ctx.globalAlpha = 1;
}

// --------------------------------------------------------------- Speech -----
function bossSay(e, text, force) {
  if (!force && e.speechCd > 0) return;
  e.speech = { text, time: 2.6 };
  e.speechCd = 7;
}

function bossTaunt(e) {
  const lines = BOSSES[e.type].taunts;
  bossSay(e, lines[Math.floor(Math.random() * lines.length)]);
}

function drawBossSpeech(e, color) {
  if (!e.speech) return;
  const k = clamp(Math.min(1, e.speech.time / 0.3), 0, 1);
  const x = clamp(e.x + e.w / 2, camera.x + 220, camera.x + W - 220);
  const y = e.y - 60;
  ctx.font = `20px ${FONT}`;
  const w = ctx.measureText(e.speech.text).width + 30;
  ctx.globalAlpha = k;
  ctx.fillStyle = "rgba(20,0,10,0.9)";
  ctx.strokeStyle = color;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.rect(x - w / 2, y - 24, w, 44);
  ctx.moveTo(x - 12, y + 20);
  ctx.lineTo(x, y + 36);
  ctx.lineTo(x + 12, y + 20);
  ctx.fill();
  ctx.stroke();
  hudText(e.speech.text, x, y - 2, 20, "#ffffff", "center", "middle");
  ctx.globalAlpha = 1;
}

// ---------------------------------------------------------- Name card -------
// Drawn over the HUD while a boss makes its entrance
function drawBossCard(VW, VH) {
  const c = game.cinematic;
  if (!c || !c.title) return;
  if (c.style === "nullptr") return drawNullCard(VW, VH, c); // NULL has its own
  const k = cinematicAmount();
  const slide = (1 - Math.min(1, (c.max - c.time) / 0.5)) * -500;
  const y = VH * 0.62;
  ctx.globalAlpha = k;
  ctx.fillStyle = "rgba(0,0,0,0.55)";
  ctx.fillRect(0, y - 70, VW, 150);
  ctx.fillStyle = c.color;
  ctx.fillRect(slide + 60, y - 70, 10, 150);
  const jitter = Math.random() < 0.1 ? rand(-6, 6) : 0;
  ctx.globalAlpha = k * 0.5;
  hudText(c.title, slide + 96 + 5 + jitter, y - 2, 64, "#ff2fd6", "left", "middle");
  ctx.globalAlpha = k;
  hudText(c.title, slide + 96 + jitter, y - 4, 64, c.color, "left", "middle");
  hudText(c.subtitle, slide + 100, y + 52, 22, "#ffffff", "left", "middle");
  ctx.globalAlpha = 1;
}

// Boss-fight odds and ends that run every frame
function updateBossFx(dt) {
  updateShockwaves(dt);
  updateNullFx(dt);
  if (game.cinematic && (game.cinematic.time -= dt) <= 0) game.cinematic = null;
  if (game.goatSky) game.goatSky = Math.min(1, game.goatSky + dt * 0.5);
}
function resetBossFx() {
  shockwaves.length = 0;
  resetNull();
}
