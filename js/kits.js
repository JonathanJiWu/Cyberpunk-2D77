"use strict";
// =============================================================================
// Signature kits, and the status effects they put on enemies.
//   CYBER WIDOW (paine)  Cyber Bow: draw, then release heavy arrows. They
//                        knock enemies back, have a chance to pierce (grows
//                        with level), shoot flyers out of the sky (fall
//                        damage!) and make bosses bleed.
//                        FLAME ON: a radial heat wave from her heat-proof suit.
//   RONIN (tetsu)        Mirror Steel: reflects part of all incoming damage.
//   HACKERMAN (sudo)     EM Projector: piercing electromagnetic waves.
//                        System Glitch: hits can glitch a whole area.
//                        TIME DILATION: bullet time: the world slows, he doesn't.
// Enemy side: downed flyers, fall damage, bleeding/burning, glitch stutter.
// =============================================================================

// (per player in co-op: coop.js points these at the player being updated)
let heatWaves = []; // expanding Flame On rings
let codeRain = []; // Time Dilation glyph streams
let kitFx = []; // short one-off effects (reflect lines, glitch fields)

function resetKits() {
  heatWaves.length = 0;
  codeRain.length = 0;
  kitFx.length = 0;
}

// --------------------------------------------------------------- Stats ------
const playerLevel = () => (typeof progress === "undefined" ? 1 : progress.level);
// Values that grow with your level (shown on the HUD and in the DATABASE)
const pierceChance = () => Math.min(0.65, 0.15 + 0.02 * (playerLevel() - 1) + (stats.bow ? stats.bow.pierceBonus : 0));
const reflectPct = () => Math.min(0.4, 0.15 + 0.01 * (playerLevel() - 1));
const glitchChance = () => Math.min(0.45, 0.15 + 0.012 * (playerLevel() - 1));
const glitchRadius = () => Math.min(280, 150 + 5 * (playerLevel() - 1));
const glitchTime = () => Math.min(1.1, 0.55 + 0.02 * (playerLevel() - 1));

// Called from computeStats(): z = primary level, f = special level
function computeKitStats(z, f, cdMul, costMul) {
  stats.bow = {
    damage: 16 + (z >= 2 ? 5 : 0) + (z >= 5 ? 6 : 0) + (z >= 8 ? 8 : 0),
    draw: 0.42 * (z >= 4 ? 0.8 : 1) * cdMul,
    arrows: 1 + (z >= 3 ? 1 : 0) + (z >= 6 ? 1 : 0),
    knock: 480 * (z >= 7 ? 1.4 : 1),
    bleed: 6 + (z >= 5 ? 4 : 0),
    pierceBonus: z >= 8 ? 0.15 : 0,
  };
  stats.heatwave = {
    radius: 300 * (1 + 0.12 * (f - 1)),
    damage: 30 * (1 + 0.25 * (f - 1)),
    cost: (f >= 3 ? 32 : 40) * costMul,
    burn: f >= 4,
    echo: f >= 6,
  };
  stats.em = {
    damage: 7 + (z >= 2 ? 3 : 0) + (z >= 7 ? 4 : 0),
    cooldown: 0.5 * (z >= 4 ? 0.8 : 1) * cdMul,
    waves: 1 + (z >= 3 ? 1 : 0) + (z >= 6 ? 1 : 0),
    range: 640 * (z >= 5 ? 1.25 : 1),
    height: 70 * (z >= 5 ? 1.3 : 1),
    slow: z >= 8 ? 0.45 : 0.6,
  };
  stats.dilation = {
    duration: 3 + 0.4 * (f - 1),
    cost: (f >= 3 ? 34 : 45) * costMul,
    scale: f >= 4 ? 0.18 : 0.25,
    dmgMul: 1.4 + 0.08 * (f - 1),
    freezeShots: f >= 6,
  };
}

// The passive line on the HUD
function passiveLine() {
  const p = player;
  if (p.char === "paine") return `PIERCE ${Math.round(pierceChance() * 100)}%`;
  if (p.char === "tetsu") return `REFLECT ${Math.round(reflectPct() * 100)}%`;
  return `GLITCH ${Math.round(glitchChance() * 100)}% / ${Math.round(glitchRadius())}PX`;
}

// ========================================================= CYBER WIDOW ======
// Cyber Bow: hold to draw (the aim keeps tracking), release at full draw
// Like primaryAim(), but a queued tap is only peeked at: one tap = one arrow,
// consumed on release (so quick taps aren't swallowed by a single draw)
function bowAim() {
  if (input.shots.length) {
    const t = input.shots[0];
    const pc = centerOf(player);
    return { x: t.x - pc.x, y: t.y - (pc.y - 10), assist: false };
  }
  if (zapHeld()) return holdAim();
  if (settings.autoFire) return autoAim(1000, 1700);
  return null;
}

function updateBow(dt) {
  const p = player;
  const B = stats.bow;
  p.zapCd -= dt;
  p.releaseT = Math.max(0, (p.releaseT || 0) - dt);
  if (p.draw) {
    // let go of fire mid-draw (with auto-fire off): the arrow is never loosed
    if (!input.shots.length && !zapHeld() && !settings.autoFire) {
      p.draw = null;
      return;
    }
    const aim = bowAim() || p.draw.aim;
    p.draw.aim = aim;
    p.draw.t += dt;
    faceToward(aim.x, Math.atan2(aim.y, aim.x));
    if (p.draw.t >= B.draw * (p.overdrive > 0 ? 0.55 : 1)) {
      p.draw = null;
      if (input.shots.length) input.shots.shift();
      fireZap(aim.x, aim.y, aim.assist, aim.cone); // release!
    }
    return;
  }
  if (p.zapCd > 0) return;
  const aim = bowAim();
  if (!aim) return;
  p.draw = { t: 0, aim };
  faceToward(aim.x, Math.atan2(aim.y, aim.x));
  synth.play("bowDraw");
}

// Which attack frame to show: drawing (0-1), then release (2-3)
function bowFrame() {
  const p = player;
  if (p.draw) return p.draw.t / stats.bow.draw < 0.45 ? 0 : 1;
  return p.releaseT > 0.1 ? 2 : 3;
}

function releaseArrows(ax, ay, assist, cone) {
  const p = player;
  const B = stats.bow;
  const pc = centerOf(p);
  const sy = pc.y - 14;
  let a = Math.atan2(ay, ax);
  if (assist) {
    const t = nearestEnemy(pc.x, sy, 1300, (e) => onScreen(e) && Math.abs(angleDiff(Math.atan2(centerOf(e).y - sy, centerOf(e).x - pc.x), a)) < (cone || 0.35));
    if (t) a = Math.atan2(centerOf(t).y - sy, centerOf(t).x - pc.x);
  }
  faceToward(Math.cos(a), a);
  p.releaseT = 0.2;
  p.zapCd = 0.08;
  const n = B.arrows;
  for (let i = 0; i < n; i++) {
    const aa = a + (i - (n - 1) / 2) * 0.09;
    const pierce = Math.random() < pierceChance();
    playerShots.push({ x: pc.x + Math.cos(aa) * 40, y: sy + Math.sin(aa) * 40, vx: Math.cos(aa) * 1700, vy: Math.sin(aa) * 1700, r: 12, angle: aa, life: 1.1, damage: B.damage, pierce: pierce ? 3 : 0, piercing: pierce, hit: new Set(), kind: "arrow" });
  }
  p.vx -= Math.cos(a) * 60; // a little recoil
  camera.shake = Math.max(camera.shake, 2);
  synth.play("bowRelease");
}

function arrowHit(s, e) {
  const dir = Math.sign(s.vx) || 1;
  const c = centerOf(e);
  if (e.boss) {
    // bosses don't budge, but they bleed
    damageEnemy(e, s.damage, { source: "arrow", fromX: s.x - s.vx });
    applyDot(e, "bleed", stats.bow.bleed, 4);
  } else {
    damageEnemy(e, s.damage, { source: "arrow", kbX: dir * stats.bow.knock, kbY: -140, fromX: s.x - s.vx, knock: true });
    if (!e.dead && !e.def.walker) downEnemy(e, dir);
  }
  burst(c.x, c.y, s.piercing ? 8 : 5, s.piercing ? "#ffffff" : "#ff4a6a", 280);
  synth.play(s.piercing ? "arrowPierce" : "arrowHit");
}

// FLAME ON: a ring of heat rolls out from her suit
function updateHeatWave(dt) {
  const p = player;
  const H = stats.heatwave;
  p.specialCd -= dt;
  p.flameFlash = Math.max(0, (p.flameFlash || 0) - dt);
  if (p.heatLocked && p.heat >= H.cost) p.heatLocked = false;
  const pressed = specialPressed();
  let want = pressed;
  if (!want && settings.autoFlame && p.specialCd <= 0 && p.heat >= H.cost) {
    const pc = centerOf(p);
    const close = enemies.filter((e) => !e.dead && circleHitsBox(pc.x, pc.y, H.radius * 0.7, e)).length;
    const shots = enemyShots.some((s) => s.kind !== "meteor" && Math.hypot(s.x - pc.x, s.y - pc.y) < 220);
    const point = nearestEnemy(pc.x, pc.y, 150); // something right on top of her
    want = close >= 2 || (close >= 1 && (shots || !!point)) || (!!game.boss && close >= 1 && p.hp < stats.maxHp * 0.5);
  }
  if (!want || p.specialCd > 0) return;
  if (p.heat < H.cost) {
    if (pressed) popup("NEED HEAT", p.x + p.w / 2, p.y - 20, "#ff9b21", 22);
    return;
  }
  p.heat -= H.cost;
  p.specialCd = 0.6;
  flameOn(H.damage);
}

function flameOn(damage) {
  const p = player;
  const pc = centerOf(p);
  heatWaves.push({ x: pc.x, y: pc.y, r: 20, max: stats.heatwave.radius, t: 0, dur: 0.45, hit: new Set(), damage, echo: stats.heatwave.echo });
  p.invuln = Math.max(p.invuln, 0.35);
  p.flameFlash = 0.6;
  squash(1.25, 0.8);
  dust(pc.x, p.y + p.h, 14, 2);
  burst(pc.x, pc.y, 24, "#ff9b21", 520);
  camera.shake = Math.max(camera.shake, 10);
  synth.play("flameOn");
  synth.play("heatWave");
  if (Math.random() < 0.4) say("special");
}

function updateHeatWaves(dt) {
  for (let i = heatWaves.length - 1; i >= 0; i--) {
    const w = heatWaves[i];
    w.t += dt;
    const k = Math.min(1, w.t / w.dur);
    w.r = 20 + (w.max - 20) * (1 - (1 - k) * (1 - k));
    if (k < 1) {
      enemies.forEach((e) => {
        if (e.dead || w.hit.has(e)) return;
        const c = centerOf(e);
        if (Math.hypot(c.x - w.x, c.y - w.y) - Math.min(e.w, e.h) * 0.4 > w.r) return;
        w.hit.add(e);
        const dir = Math.sign(c.x - w.x) || 1;
        if (e.boss) damageEnemy(e, w.damage, { source: "heat" });
        else damageEnemy(e, w.damage, { source: "heat", kbX: dir * 760, kbY: -280, knock: true });
        if (stats.heatwave.burn) applyDot(e, "burn", w.damage * 0.25, 2.5);
      });
      // it's defensive too: the heat burns bullets out of the air
      for (let j = enemyShots.length - 1; j >= 0; j--) {
        const s = enemyShots[j];
        if (s.kind === "meteor" || s.kind === "snipe") continue;
        if (Math.hypot(s.x - w.x, s.y - w.y) < w.r) {
          burst(s.x, s.y, 4, "#ffb35a", 160);
          enemyShots.splice(j, 1);
        }
      }
      crates.forEach((c) => c.alive && circleHitsBox(w.x, w.y, w.r, c) && damageCrate(c, w.damage));
    } else if (w.echo) {
      w.echo = false; // level 6: a second, weaker wave
      const pc = centerOf(player);
      heatWaves.push({ x: pc.x, y: pc.y, r: 20, max: w.max * 0.8, t: -0.05, dur: 0.4, hit: new Set(), damage: w.damage * 0.6, echo: false });
    }
    if (w.t > w.dur + 0.3) heatWaves.splice(i, 1);
  }
}

// ============================================================== RONIN =======
// Mirror Steel: a slice of every hit goes straight back to whoever dealt it.
// Reflected damage is never reflected again (enemies don't reflect), so no loops.
function roninReflect(src, incoming) {
  if (!src || src === player || src.dead || !(src.hp > 0)) return;
  const pct = reflectPct();
  const dmg = incoming * pct;
  if (dmg <= 0) return;
  const pc = centerOf(player);
  const c = centerOf(src);
  damageEnemy(src, dmg, { source: "reflect" });
  const L = playerLevel();
  if (L >= 8) src.stun = Math.max(src.stun || 0, src.boss ? 0.1 : 0.4); // Mirror Edge: staggers
  if (L >= 16) {
    // Riposte: the reflection splashes to two more enemies nearby
    enemies
      .filter((e) => !e.dead && e !== src && Math.hypot(centerOf(e).x - c.x, centerOf(e).y - c.y) < 260)
      .slice(0, 2)
      .forEach((e) => damageEnemy(e, dmg * 0.5, { source: "reflect" }));
  }
  kitFx.push({ type: "reflect", x1: pc.x, y1: pc.y - 10, x2: c.x, y2: c.y, life: 0.3, max: 0.3 });
  burst(c.x, c.y, 8, "#e8ecff", 320);
  popup(`REFLECT ${Math.round(dmg)}`, c.x, src.y - 20, "#e8ecff", 20, 0.8);
  synth.play("reflect");
}

// ========================================================== HACKERMAN =======
// EM Projector: waves that grow as they travel and pass through everything
function updateEmitter(dt) {
  const p = player;
  const M = stats.em;
  p.zapCd -= dt;
  if (p.zapCd > 0) return;
  const aim = primaryAim(M.range + 200, 900);
  if (!aim) return;
  const pc = centerOf(p);
  const sy = pc.y - 10;
  let a = Math.atan2(aim.y, aim.x);
  if (aim.assist) {
    const t = nearestEnemy(pc.x, sy, M.range + 200, (e) => onScreen(e) && Math.abs(angleDiff(Math.atan2(centerOf(e).y - sy, centerOf(e).x - pc.x), a)) < (aim.cone || 0.4));
    if (t) a = Math.atan2(centerOf(t).y - sy, centerOf(t).x - pc.x);
  }
  faceToward(Math.cos(a), a);
  startAttackAnim(0.26);
  for (let i = 0; i < M.waves; i++) {
    const aa = a + (i - (M.waves - 1) / 2) * 0.22;
    playerShots.push({ x: pc.x + Math.cos(aa) * 40, y: sy + Math.sin(aa) * 40, vx: Math.cos(aa) * 900, vy: Math.sin(aa) * 900, r: 26, angle: aa, life: M.range / 900, damage: M.damage, pierce: 99, hit: new Set(), kind: "em", age: 0 });
  }
  p.zapCd = M.cooldown * (p.overdrive > 0 ? 0.5 : 1);
  synth.play("emDischarge");
  if (Math.random() < 0.25) synth.play("laptop", { volume: 0.5 });
}

function emHit(s, e) {
  damageEnemy(e, s.damage, { source: "em", fromX: s.x - s.vx });
  slowEnemy(e, stats.em.slow, 1);
  const c = centerOf(e);
  burst(c.x, c.y, 4, "#b06cff", 220);
  if (Math.random() < glitchChance()) systemGlitch(c.x, c.y);
}

// System Glitch: everything near the hit stutters for a moment
let glitchCd = 0;
function systemGlitch(x, y) {
  if (glitchCd > 0) return;
  glitchCd = 0.25;
  const r = glitchRadius();
  const t = glitchTime();
  let n = 0;
  enemies.forEach((e) => {
    if (e.dead) return;
    const c = centerOf(e);
    if (Math.hypot(c.x - x, c.y - y) > r) return;
    e.glitchT = Math.max(e.glitchT || 0, e.boss ? t * 0.4 : t);
    n++;
  });
  kitFx.push({ type: "glitch", x, y, r, life: 0.4, max: 0.4 });
  glyphBurst(x, y, 6);
  synth.play("glitch");
  if (n >= 3) popup("SYSTEM GLITCH", x, y - 60, "#b06cff", 20, 0.7);
}

// TIME DILATION: the world slows down; Hackerman doesn't (and hits harder)
function updateDilation(dt) {
  const p = player;
  const D = stats.dilation;
  p.specialCd -= dt;
  glitchCd -= dt;
  if (p.dilation > 0) {
    p.dilation -= dt;
    if (p.dilation <= 0) endDilation();
  }
  const pressed = specialPressed();
  let want = pressed;
  if (!want && settings.autoFlame && !(p.dilation > 0) && p.specialCd <= 0 && p.heat >= D.cost) {
    const pc = centerOf(p);
    const near = enemies.filter((e) => !e.dead && Math.hypot(centerOf(e).x - pc.x, centerOf(e).y - pc.y) < 520).length;
    const danger = enemyShots.filter((s) => Math.hypot(s.x - pc.x, s.y - pc.y) < 400).length >= 3 || !!(game.boss && game.boss.beam && game.boss.beam.on);
    want = near >= 5 || danger || (!!game.boss && p.hp < stats.maxHp * 0.6);
  }
  if (!want || p.dilation > 0 || p.specialCd > 0) return;
  if (p.heat < D.cost) {
    if (pressed) popup("NEED RAM", p.x + p.w / 2, p.y - 20, "#b06cff", 22);
    return;
  }
  p.heat -= D.cost;
  p.dilation = p.dilationMax = D.duration;
  p.specialCd = 1;
  game.dilationFlash = 0.45;
  const pc = centerOf(p);
  ring(pc.x, pc.y, 420, "#5aff7a");
  ring(pc.x, pc.y, 260, "#ffffff");
  camera.shake = Math.max(camera.shake, 8);
  synth.play("dilationIn");
  synth.loop("dilationLoop");
  if (Math.random() < 0.5) say("special");
}

function endDilation() {
  const p = player;
  p.dilation = 0;
  p.specialCd = Math.max(p.specialCd, 0.8);
  game.dilationFlash = 0.3;
  synth.stop("dilationLoop");
  synth.play("dilationOut");
}

// ======================================================= Enemy effects ======
// Damage over time: "bleed" (arrows on bosses) and "burn" (heat wave)
function applyDot(e, kind, dps, dur) {
  if (kind === "bleed") {
    e.bleedT = dur;
    e.bleedDps = Math.max(e.bleedT > 0 ? e.bleedDps || 0 : 0, dps);
  } else {
    e.burnT = dur;
    e.burnDps = Math.max(e.burnT > 0 ? e.burnDps || 0 : 0, dps);
  }
}

// Ticks every enemy's status effects; returns the dt its AI should run on
// (System Glitch makes it stutter: only every third frame gets through)
function enemyStatus(e, dt) {
  if (e.bleedT > 0) {
    e.bleedT -= dt;
    e.bleedAcc = (e.bleedAcc || 0) + e.bleedDps * dt;
    if (Math.random() < dt * 6) {
      const c = centerOf(e);
      particles.push({ x: c.x + rand(-e.w / 3, e.w / 3), y: c.y, vx: rand(-30, 30), vy: rand(40, 120), life: 0.5, size: 6, color: "#ff3b6b" });
    }
  }
  if (e.burnT > 0) {
    e.burnT -= dt;
    e.bleedAcc = (e.bleedAcc || 0) + e.burnDps * dt;
  }
  if (e.bleedAcc >= 4) {
    const amount = e.bleedAcc;
    e.bleedAcc = 0;
    damageEnemy(e, amount, { source: "bleed", quiet: true });
    if (Math.random() < 0.3) synth.play("bleed", { volume: 0.6 });
  }
  if (e.knockT > 0) e.knockT -= dt;
  if (e.glitchT > 0) {
    e.glitchT -= dt;
    return Math.floor(game.time * 30) % 3 === 0 ? dt : 0;
  }
  return dt;
}

// Fall damage: grows with the height of the drop
function fallDamage(e, height) {
  if (height < 140 || e.dead) return;
  const dmg = Math.round((height - 120) * 0.12 + 8);
  const c = centerOf(e);
  damageEnemy(e, dmg, { source: "fall" });
  dust(c.x, e.y + e.h, 10, 1.6);
  burst(c.x, e.y + e.h, 6, "#ffe14d", 220);
  synth.play("fallThud");
}

// A Widow arrow knocks a flyer out of the sky
function downEnemy(e, dir) {
  if (e.boss || e.def.walker || e.downed) return;
  e.downed = { fromY: e.y, landed: false, t: 0, vy: -120 };
  e.vx = dir * 160;
  synth.play("enemyFall");
}

// Falling (and then lying stunned on the ground); returns true while downed
function updateDowned(e, dt) {
  const d = e.downed;
  if (!d) return false;
  const c = centerOf(e);
  if (!d.landed) {
    const prevBottom = e.y + e.h;
    d.vy = Math.min(d.vy + 2600 * dt, 1800);
    e.x = clamp(e.x + (e.vx + e.kbX) * dt, 0, WORLD_W - e.w);
    e.kbX *= Math.exp(-6 * dt);
    e.y += d.vy * dt;
    d.spin = (d.spin || 0) + dt * 9;
    const floor = surfaceBelow(c.x, prevBottom - 2);
    if (e.y + e.h >= floor) {
      e.y = floor - e.h;
      d.landed = true;
      d.t = 1.6;
      // flyers that hit the ground take extra damage on top of the drop
      fallDamage(e, Math.max(160, floor - (d.fromY + e.h)) + 120);
      if (e.type === "bomber" && !e.dead) damageEnemy(e, e.hp + 1, { source: "fall" }); // boom
    }
  } else if ((d.t -= dt) <= 0) {
    e.downed = null; // back up into the air
    e.vy = -500;
  }
  return true;
}

// ============================================================ Effects =======
// Runs per player (main.js); the screen flash fades in update()
function updateKits(dt) {
  updateHeatWaves(dt);
  for (let i = kitFx.length - 1; i >= 0; i--) if ((kitFx[i].life -= dt) <= 0) kitFx.splice(i, 1);
  // Time Dilation: green code streams fall around Hackerman
  const p = player;
  if (p.dilation > 0) {
    const want = typeof perfMode !== "undefined" && perfMode() ? 10 : 26;
    while (codeRain.length < want) codeRain.push({ dx: rand(-520, 520), y: rand(-500, 200), v: rand(260, 520), len: Math.floor(rand(5, 12)), seed: Math.floor(rand(0, 1000)) });
  }
  for (let i = codeRain.length - 1; i >= 0; i--) {
    const r = codeRain[i];
    r.y += r.v * dt;
    if (r.y > 420 || !(p.dilation > 0)) codeRain.splice(i, 1);
  }
}

const RAIN_GLYPHS = "01アイウエオカキクケコｱｲｳｴｵ<>{}#$%&";
function drawKitFx(time) {
  // Flame On rings: wobbling heat shimmer, flame tongues, a warm core
  heatWaves.forEach((w) => {
    if (w.t < 0) return;
    const fade = Math.max(0, 1 - Math.max(0, w.t - w.dur) / 0.3);
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    for (let band = 0; band < 3; band++) {
      ctx.strokeStyle = ["rgba(255,120,30,0.55)", "rgba(255,220,140,0.45)", "rgba(255,255,255,0.35)"][band];
      ctx.lineWidth = [26, 12, 4][band];
      ctx.globalAlpha = fade;
      ctx.beginPath();
      for (let i = 0; i <= 48; i++) {
        const a = (i / 48) * Math.PI * 2;
        const rr = w.r - band * 10 + Math.sin(a * 9 + time * 24 + band) * 7;
        const x = w.x + Math.cos(a) * rr;
        const y = w.y + Math.sin(a) * rr * 0.75;
        if (i) ctx.lineTo(x, y);
        else ctx.moveTo(x, y);
      }
      ctx.stroke();
    }
    ctx.restore();
    if (fade > 0.3) {
      for (let i = 0; i < 10; i++) {
        const a = (i / 10) * Math.PI * 2 + w.t * 2;
        drawCell("fx2", 6, 32, w.x + Math.cos(a) * w.r, w.y + Math.sin(a) * w.r * 0.75, 44, 44, a + Math.PI / 2);
      }
    }
    glow(w.x, w.y, w.r * 0.8, "rgba(255,140,40,0.25)", fade);
  });
  kitFx.forEach((f) => {
    const k = f.life / f.max;
    if (f.type === "reflect") {
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      ctx.strokeStyle = `rgba(232,236,255,${k})`;
      ctx.lineWidth = 6 * k + 2;
      ctx.beginPath();
      ctx.moveTo(f.x1, f.y1);
      ctx.lineTo(f.x2, f.y2);
      ctx.stroke();
      ctx.strokeStyle = `rgba(255,36,87,${k * 0.8})`;
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.restore();
      drawCell("fx2", 7, 32, f.x2, f.y2, 60 * (1.4 - k * 0.4), 60 * (1.4 - k * 0.4), k * 4);
    } else if (f.type === "glitch") {
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      ctx.globalAlpha = k;
      ctx.strokeStyle = "#b06cff";
      ctx.lineWidth = 3;
      ctx.setLineDash([10, 8]);
      ctx.beginPath();
      ctx.arc(f.x, f.y, f.r * (1.2 - k * 0.2), 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.restore();
      for (let i = 0; i < 4; i++) drawCell("fx2", 4, 32, f.x + rand(-f.r, f.r) * 0.7, f.y + rand(-f.r, f.r) * 0.5, 36, 36, 0);
      ctx.globalAlpha = 1;
    }
  });
  // Time Dilation code rain around Hackerman
  if (codeRain.length) {
    const pc = centerOf(player);
    ctx.save();
    ctx.font = `20px ${FONT}`;
    ctx.textAlign = "center";
    codeRain.forEach((r) => {
      for (let j = 0; j < r.len; j++) {
        const g = RAIN_GLYPHS[(r.seed + j + Math.floor(time * 12)) % RAIN_GLYPHS.length];
        ctx.globalAlpha = j === 0 ? 0.95 : 0.6 * (1 - j / r.len);
        ctx.fillStyle = j === 0 ? "#e9ffef" : "#5aff7a";
        ctx.fillText(g, pc.x + r.dx, pc.y + r.y - j * 22);
      }
    });
    ctx.restore();
    ctx.globalAlpha = 1;
  }
}

// Screen-space: the bullet-time tint and the in/out flash
function drawDilationOverlay(time) {
  if (somePlayer(() => player.dilation > 0) && game.state !== "over") {
    const g = ctx.createRadialGradient(W / 2, H / 2, H * 0.25, W / 2, H / 2, H * 0.9);
    g.addColorStop(0, "rgba(40,255,120,0.04)");
    g.addColorStop(1, "rgba(10,60,20,0.45)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
    // a thin scan line sweeping down
    const y = ((time * 400) % (H + 40)) - 20;
    ctx.fillStyle = "rgba(90,255,122,0.12)";
    ctx.fillRect(0, y, W, 6);
  }
  if (game.dilationFlash > 0) {
    ctx.fillStyle = `rgba(200,255,220,${game.dilationFlash * 0.6})`;
    ctx.fillRect(0, 0, W, H);
  }
}
