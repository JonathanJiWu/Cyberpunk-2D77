"use strict";
// =============================================================================
// The three heroes' kits and the "feel" layer shared by all of them:
//   PAINE  cyber bow + Flame On              (kits.js)
//   TETSU  monoblade combo + Iaido Dash      (here)
//   SUDO   EM projector + Time Dilation      (kits.js)
// plus facing, squash & stretch, dust, muzzle flashes and speech bubbles.
// =============================================================================

const CH = () => CHARACTERS[player.char] || CHARACTERS.paine;
const slashFx = []; // blade arcs
const hackFx = []; // overload circles

// Smallest signed angle between two directions
const angleDiff = (a, b) => Math.atan2(Math.sin(a - b), Math.cos(a - b));

// ---------------------------------------------------------- Personality -----
function say(kind, vars, force) {
  const p = player;
  if (!force && p.speechCd > 0) return;
  const lines = CH().quotes[kind];
  if (!lines) return;
  let text = Array.isArray(lines) ? lines[Math.floor(Math.random() * lines.length)] : lines;
  if (vars) Object.keys(vars).forEach((k) => (text = text.replace(`{${k}}`, vars[k])));
  p.speech = { text, time: 2.6 };
  p.speechCd = 5;
}

// Always face the way you're firing (for a moment, even while running away)
function faceToward(ax, angle) {
  const p = player;
  if (Math.abs(ax) > 0.15) p.facing = ax > 0 ? 1 : -1;
  p.faceLock = 0.45;
  p.fireAngle = angle;
}

function startAttackAnim(duration) {
  player.fireAnim = player.fireAnimMax = duration;
}

// Squash & stretch: sx/sy relax back to 1 every frame
function squash(sx, sy) {
  player.sx = sx;
  player.sy = sy;
}

function dust(x, y, count, spread = 1) {
  for (let i = 0; i < count && particles.length < 260; i++) {
    particles.push({ x: x + rand(-12, 12) * spread, y: y - 4, vx: rand(-140, 140) * spread, vy: rand(-140, -40), life: rand(0.25, 0.45), size: rand(5, 9), color: "#bfaee6" });
  }
}

// Where the primary attack should aim this frame, or null.
// autoRange: how close an enemy must be for auto-fire to attack it.
function primaryAim(autoRange, projSpeed) {
  const p = player;
  if (input.shots.length) {
    const t = input.shots.shift();
    const pc = centerOf(p);
    return { x: t.x - pc.x, y: t.y - (pc.y - 10), assist: false }; // exact tapped direction
  }
  if (zapHeld()) return holdAim();
  if (settings.autoFire) return autoAim(autoRange, projSpeed);
  return null;
}

// Specials: Paine holds the flame; Tetsu and Sudo trigger on a press
function specialPressed() {
  const p = player;
  const held = flameHeld();
  const pressed = (held && !p.specialWasHeld) || input.specialQueued;
  p.specialWasHeld = held;
  input.specialQueued = false;
  return pressed;
}

// ===================================================================== TETSU ==
function updateBlade(dt) {
  const p = player;
  const B = stats.blade;
  p.zapCd -= dt;
  if (p.zapCd > 0) return;
  const aim = primaryAim(B.range * 1.6, 0);
  if (!aim) return;
  const a = Math.atan2(aim.y, aim.x);
  bladeSwing(a);
  p.zapCd = B.cooldown * (p.overdrive > 0 ? 0.6 : 1);
}

function bladeSwing(a) {
  const p = player;
  const B = stats.blade;
  const pc = centerOf(p);
  const cy = pc.y - 6;
  p.combo = (p.combo + 1) % B.finisherEvery;
  const finisher = p.combo === 0;
  const R = B.range * (finisher ? 1.25 : 1);
  const arc = finisher ? Math.PI * 2 : 2.4;
  const dmg = B.damage * (finisher ? 1.6 : 1);
  faceToward(Math.cos(a), a);
  startAttackAnim(finisher ? 0.32 : 0.24);
  const inArc = (x, y, pad) => {
    const d = Math.hypot(x - pc.x, y - cy) - pad;
    return d <= R && (finisher || Math.abs(angleDiff(Math.atan2(y - cy, x - pc.x), a)) <= arc / 2);
  };
  enemies.forEach((e) => {
    if (e.dead) return;
    const c = centerOf(e);
    if (!inArc(c.x, c.y, Math.min(e.w, e.h) * 0.45)) return;
    const dir = c.x >= pc.x ? 1 : -1;
    damageEnemy(e, dmg, { source: finisher ? "blade-heavy" : "blade", kbX: dir * (finisher ? 700 : 320), fromX: pc.x, breaksGuard: finisher });
    burst(c.x, c.y, finisher ? 10 : 5, finisher ? "#ff2457" : "#9ffcff", 300);
  });
  crates.forEach((c) => c.alive && inArc(c.x + c.w / 2, c.y + c.h / 2, 30) && damageCrate(c, dmg));
  // Swings knock enemy shots out of the air (and send them back once upgraded)
  for (let i = enemyShots.length - 1; i >= 0; i--) {
    const s = enemyShots[i];
    if (!inArc(s.x, s.y, s.r)) continue;
    enemyShots.splice(i, 1);
    burst(s.x, s.y, 6, "#9ffcff", 220);
    popup("PARRY", s.x, s.y - 16, "#9ffcff", 18, 0.5);
    synth.play("parry");
    if (B.reflect) reflectShot(s, 2.5);
  }
  slashFx.push({ x: pc.x, y: cy, a, r: R, arc, life: finisher ? 0.26 : 0.16, max: finisher ? 0.26 : 0.16, heavy: finisher });
  p.vx += Math.cos(a) * (finisher ? 260 : 140); // a little step into the swing
  camera.shake = Math.max(camera.shake, finisher ? 7 : 2);
  sfx.zapHit.play({ rate: finisher ? 0.55 : 0.85 });
  synth.play(finisher ? "bladeHeavy" : "bladeSwing");
}

// A parried/reflected shot flies back at the nearest enemy
function reflectShot(s, mult) {
  const target = nearestEnemy(s.x, s.y, 1400, onScreen);
  const c = target ? centerOf(target) : { x: s.x - s.vx, y: s.y - s.vy };
  const a = Math.atan2(c.y - s.y, c.x - s.x);
  playerShots.push({ x: s.x, y: s.y, vx: Math.cos(a) * 1100, vy: Math.sin(a) * 1100, r: s.r, angle: a, life: 1.6, damage: s.damage * mult, pierce: 0, hit: new Set(), kind: s.kind === "snipe" ? "laser" : s.kind });
}

function updateDash(dt) {
  const p = player;
  const D = stats.dash;
  p.specialCd -= dt;
  p.guard = Math.max(0, p.guard - dt);
  if (p.heatLocked && p.heat >= D.cost) p.heatLocked = false;
  const pressed = specialPressed();
  let want = pressed;
  let dir = null;
  if (!want && settings.autoFlame && !p.dash) {
    // Auto: dash into a nearby group (or at whatever is about to hit you)
    const pc = centerOf(p);
    const e = nearestEnemy(pc.x, pc.y, D.distance * 0.9, onScreen);
    if (e && p.heat >= D.cost + 10) {
      want = true;
      const c = centerOf(e);
      dir = { x: c.x - pc.x, y: c.y - pc.y };
    }
  }
  if (want && !p.dash && p.specialCd <= 0) {
    if (p.heat < D.cost) {
      if (pressed) popup(`NEED ${CH().resource.name}`, p.x + p.w / 2, p.y - 20, "#5aff7a", 20);
    } else {
      if (!dir) {
        const aim = zapHeld() || input.mouse.flame ? holdAim() : null;
        dir = aim || { x: p.facing, y: moveAxis().analog ? 0 : moveAxis().y * 0.6 };
      }
      const len = Math.hypot(dir.x, dir.y) || 1;
      const speed = D.distance / 0.2;
      p.dash = { vx: (dir.x / len) * speed, vy: (dir.y / len) * speed * 0.7, t: 0.2, hit: new Set() };
      p.heat -= D.cost;
      p.specialCd = 0.45;
      p.invuln = Math.max(p.invuln, 0.32);
      faceToward(dir.x, Math.atan2(dir.y, dir.x));
      startAttackAnim(0.3);
      squash(1.35, 0.75);
      dust(p.x + p.w / 2, p.y + p.h, 8, 1.5);
      sfx.stomp.play({ rate: 1.4 });
      synth.play("dash");
      if (Math.random() < 0.5) say("special");
    }
  }
  if (!p.dash) return;
  // Mid-dash: slice everything we pass through
  const pc = centerOf(p);
  const sweep = { x: p.x - 30, y: p.y - 10, w: p.w + 60, h: p.h + 20 };
  enemies.forEach((e) => {
    if (e.dead || p.dash.hit.has(e) || !overlaps(sweep, e)) return;
    p.dash.hit.add(e);
    const c = centerOf(e);
    damageEnemy(e, D.damage, { source: "dash", kbX: Math.sign(p.dash.vx) * 400, kbY: -200, breaksGuard: true });
    burst(c.x, c.y, 10, "#ff2457", 340);
  });
  crates.forEach((c) => c.alive && overlaps(sweep, c) && damageCrate(c, D.damage));
  p.trail.push({ x: p.x, y: p.y, frameX: 1, frameY: p.frameY, t: 0, dash: true });
  p.dash.t -= dt;
  if (p.dash.t <= 0) {
    if (D.wave) {
      // the cut lingers: a shockwave along the dash line
      ring(pc.x, pc.y, 160, "#ff2457");
      enemies.forEach((e) => !e.dead && circleHitsBox(pc.x, pc.y, 160, e) && damageEnemy(e, D.damage * 0.5, { source: "dash" }));
    }
    p.vx = p.dash.vx * 0.25;
    p.vy = Math.min(0, p.dash.vy * 0.3);
    p.dash = null;
    p.guard = D.guard;
    slashFx.push({ x: pc.x, y: pc.y, a: 0, r: 120, arc: Math.PI * 2, life: 0.2, max: 0.2, heavy: true });
  }
}

// ====================================================== Shared helpers ==
function slowEnemy(e, mul, time) {
  e.slowMul = Math.min(e.slowMul || 1, mul);
  e.slowT = Math.max(e.slowT || 0, time);
}

// Little green code characters flying out
const GLYPHS = "01<>{}#$%&*+=/\\";
function glyphBurst(x, y, n) {
  for (let i = 0; i < n && popups.length < 45; i++) {
    const ch = GLYPHS[Math.floor(Math.random() * GLYPHS.length)];
    popups.push({ text: ch, x: x + rand(-50, 50), y: y + rand(-40, 40), color: Math.random() < 0.7 ? "#5aff7a" : "#19f5ff", size: 18, life: rand(0.4, 0.8), max: 0.8 });
  }
}

// ================================================================ Drawing ===
function drawHeroFx(time) {
  // Blade arcs
  slashFx.forEach((s) => {
    const k = s.life / s.max;
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    ctx.lineCap = "round";
    const from = s.arc >= Math.PI * 2 ? 0 : s.a - s.arc / 2;
    const to = s.arc >= Math.PI * 2 ? Math.PI * 2 : s.a + s.arc / 2;
    [
      [16, s.heavy ? "rgba(255,36,87,0.55)" : "rgba(25,245,255,0.5)"],
      [5, "rgba(255,255,255,0.95)"],
    ].forEach(([w, color]) => {
      ctx.globalAlpha = Math.min(1, k * 1.6);
      ctx.strokeStyle = color;
      ctx.lineWidth = w * (0.6 + k * 0.6);
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.r * (1.05 - k * 0.15), from, to);
      ctx.stroke();
    });
    ctx.restore();
  });
}

// Bubbles for status: Tetsu's guard stance
function drawHeroAura(cx, cy, time) {
  const p = player;
  if (p.char === "tetsu" && p.guard > 0) {
    const a = 0.45 + 0.25 * Math.sin(time * 14);
    hexagon(cx, cy, 78, `rgba(255,36,87,${a})`, 4);
    glow(cx, cy, 90, "rgba(255,36,87,0.25)");
  }
}

function hexagon(cx, cy, r, color, width) {
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.beginPath();
  for (let i = 0; i <= 6; i++) {
    const a = (i / 6) * Math.PI * 2 + Math.PI / 6;
    const x = cx + Math.cos(a) * r;
    const y = cy + Math.sin(a) * r * 1.2;
    if (i) ctx.lineTo(x, y);
    else ctx.moveTo(x, y);
  }
  ctx.stroke();
}

function drawSpeech() {
  const p = player;
  if (!p.speech) return;
  const k = Math.min(1, p.speech.time / 0.3, (2.6 - p.speech.time) / 0.15 + 0.2);
  const x = p.x + p.w / 2;
  const y = p.y - 70;
  ctx.font = `18px ${FONT}`;
  const w = ctx.measureText(p.speech.text).width + 28;
  ctx.globalAlpha = clamp(k, 0, 1);
  ctx.fillStyle = "rgba(10,3,24,0.88)";
  ctx.strokeStyle = CH().color;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.rect(x - w / 2, y - 22, w, 40);
  ctx.moveTo(x - 10, y + 18);
  ctx.lineTo(x, y + 32);
  ctx.lineTo(x + 10, y + 18);
  ctx.fill();
  ctx.stroke();
  hudText(p.speech.text, x, y - 2, 18, "#ffffff", "center", "middle");
  ctx.globalAlpha = 1;
}

function updateHeroFx(dt) {
  for (let i = slashFx.length - 1; i >= 0; i--) if ((slashFx[i].life -= dt) <= 0) slashFx.splice(i, 1);
}
