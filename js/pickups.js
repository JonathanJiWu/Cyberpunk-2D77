"use strict";
// =============================================================================
// Pickups: XP chips dropped by enemies (pulled in by your magnet range) and
// power-ups dropped by crates / enemies.
//
// XP chips are shiny computer hardware, by value: a RAM stick (small), an
// NVMe SSD (medium) or a CPU (big). They bob and slowly turn with a specular
// shine sweeping across them, and when collected they zip to you, stretch,
// pop into sparkles and flash a tiny "+XP". Every type and frame (and its
// glow) is pre-rendered once into a small canvas at the screen's resolution,
// so even hundreds of chips cost a couple of drawImage calls each.
// =============================================================================

const gems = [];
const powerups = [];
const MAX_GEMS = 300; // more than this lying around: new XP merges into the oldest chip

// The art: img/xp-hardware.png (IMG.xpHardware once registered), 128x96:
// 3 rows (RAM, NVMe, CPU) x 4 frames of 32x32, a shine sweeping across.
// Until it's there, the same layout is painted procedurally.
// size: drawn size in world pixels; lift: how far it floats above the floor.
const XP_TYPES = [
  { id: "ram", min: 0, size: 50, lift: 5, sound: "pickupRam", color: "#5aff7a", glow: "rgba(90,255,122,0.75)" },
  { id: "ssd", min: 4, size: 56, lift: 9, sound: "pickupSsd", color: "#4ea8ff", glow: "rgba(78,168,255,0.8)" },
  { id: "cpu", min: 10, size: 62, lift: 16, sound: "pickupCpu", color: "#ffd166", glow: "rgba(255,196,64,0.85)" },
];
const XP_CELL = 32;
const XP_FRAMES = 4;
const xpType = (value) => (value >= XP_TYPES[2].min ? 2 : value >= XP_TYPES[1].min ? 1 : 0);

// Collection feedback: combo pitch, sound throttle, "+XP" flash, sparkle pops
const xpFx = { clock: 0, combo: 0, last: -9, lastSound: -9, lastType: -1, flash: null, pops: [] };

function spawnGem(x, y, value) {
  if (gems.length >= MAX_GEMS) {
    // Too many lying around: merge into the oldest one
    gems[0].value += value;
    gems[0].type = xpType(gems[0].value);
    return;
  }
  gems.push({
    x: x - 12,
    y: y - 12,
    w: 24,
    h: 24,
    vx: rand(-120, 120),
    vy: rand(-420, -200),
    value,
    type: xpType(value),
    phase: Math.random() * Math.PI * 2,
    pulled: false,
    speed: 0,
    dx: 0,
    dy: 0,
    onGround: false,
    standingOn: null,
  });
}

function spawnPowerup(x, y, type) {
  type = type || weightedPick(Object.entries(POWERUPS).map(([k, v]) => [k, v.weight]));
  powerups.push({ type, x: x - 22, y: y - 22, w: 44, h: 44, vx: rand(-80, 80), vy: -380, life: 20, onGround: false, standingOn: null });
}

const XP_DRIFT_AFTER = 5; // seconds before an uncollected chip starts drifting to you

function updatePickups(dt) {
  xpFx.clock += dt;
  // Who can pick things up: player 1, or in co-op every player in the fight.
  // XP goes to the team; a chip just flies to whoever is nearest.
  const takers = [];
  eachTarget(() => takers.push({ x: player.x + player.w / 2, y: player.y + player.h / 2, reach: TUNING.pickupRadius * stats.magnetMul, ctx: coop.active }));
  if (!takers.length) return;

  for (let i = gems.length - 1; i >= 0; i--) {
    const g = gems[i];
    let t = takers[0];
    if (takers.length > 1) {
      const dist = (k) => Math.hypot(k.x - (g.x + g.w / 2), k.y - (g.y + g.h / 2));
      t = takers.reduce((a, b) => (dist(b) < dist(a) ? b : a));
    }
    const pcx = t.x;
    const pcy = t.y;
    const reach = t.reach;
    const dx = pcx - (g.x + g.w / 2);
    const dy = pcy - (g.y + g.h / 2);
    const d = Math.hypot(dx, dy);
    if (!g.pulled && d < reach) g.pulled = true;
    g.age = (g.age || 0) + dt;
    if (!g.pulled && g.age > XP_DRIFT_AFTER && d < 1600) {
      // left lying around: it slowly homes in on you (ranged kills don't strand XP)
      const sp = 150 + (g.age - XP_DRIFT_AFTER) * 60;
      g.x += (dx / (d || 1)) * sp * dt;
      g.y += (dy / (d || 1)) * sp * dt;
    } else if (g.pulled) {
      // Zip toward the player, faster and faster
      g.speed = (g.speed || 300) + 2400 * dt;
      g.dx = dx / (d || 1);
      g.dy = dy / (d || 1);
      g.x += g.dx * g.speed * dt;
      g.y += g.dy * g.speed * dt;
    } else {
      g.vx *= 0.96;
      moveBody(g, dt, 1600, 900);
      if (g.onGround) g.vx = 0;
    }
    if (d < 40) {
      gems.splice(i, 1);
      withPlayer(t.ctx, () => collectGem(g));
    }
  }

  for (let i = xpFx.pops.length - 1; i >= 0; i--) {
    if ((xpFx.pops[i].t += dt) > 0.35) xpFx.pops.splice(i, 1);
  }

  for (let i = powerups.length - 1; i >= 0; i--) {
    const p = powerups[i];
    p.vx *= 0.97;
    moveBody(p, dt, 1600, 900);
    if (p.onGround) p.vx = 0;
    p.life -= dt;
    const taker = takers.find((k) => overlaps(p, k.ctx.player));
    if (taker) {
      withPlayer(taker.ctx, () => applyPowerup(p.type)); // for whoever touched it
      powerups.splice(i, 1);
    } else if (p.life <= 0) {
      powerups.splice(i, 1);
    }
  }
}

function collectGem(g) {
  gainXp(g.value);
  const t = XP_TYPES[g.type];
  const x = g.x + g.w / 2;
  const y = g.y + g.h / 2;
  if (xpFx.pops.length >= 40) xpFx.pops.shift();
  xpFx.pops.push({ x, y, type: g.type, t: 0 });
  burst(x, y, 3 + g.type * 2, t.color, 300, 0.55);
  xpFlash(g.value, g.type);
  xpPickupSound(g.type);
}

// A tiny "+XP" over your head that adds up while the chips keep coming
function xpFlash(value, type) {
  const x = player.x + player.w / 2 + 40;
  const y = player.y - 14;
  const f = xpFx.flash;
  if (f && f.life > f.max - 0.4 && popups.includes(f)) {
    f.total += value;
    f.type = Math.max(f.type, type);
    Object.assign(f, { text: `+${f.total} XP`, color: XP_TYPES[f.type].color, x, y, life: f.max });
    return;
  }
  popup(`+${value} XP`, x, y, XP_TYPES[type].color, 18, 0.7);
  xpFx.flash = popups[popups.length - 1];
  Object.assign(xpFx.flash, { total: value, type });
}

// RAM / SSD / CPU chimes. Quick combos raise the pitch; a burst of pickups
// plays at most one chime every 60 ms (a bigger part still gets through).
function xpPickupSound(type) {
  const now = xpFx.clock;
  xpFx.combo = now - xpFx.last < 0.6 ? Math.min(xpFx.combo + 1, 12) : 0;
  xpFx.last = now;
  if (now - xpFx.lastSound < 0.06 && type <= xpFx.lastType) return;
  xpFx.lastSound = now;
  xpFx.lastType = type;
  const rate = 1 + xpFx.combo * 0.06;
  if (typeof synth !== "undefined") synth.play(XP_TYPES[type].sound, { rate });
  else sfx.pickup.play({ rate: 1.5 + xpFx.combo * 0.06 });
}

function applyPowerup(type) {
  const def = POWERUPS[type];
  const pc = centerOf(player);
  // the resource pickup says what it fills for this IC: HEAT, FOCUS or RAM
  const res = CH().resource;
  const name = type === "heat" ? `+50 ${res.name}` : def.name;
  const color = type === "heat" ? res.color : def.color;
  popup(name, pc.x, player.y - 30, color, 30, 1.2);
  burst(pc.x, pc.y, 16, color, 320);
  sfx.powerup.play({ rate: 1.25 });
  switch (type) {
    case "heal":
      player.hp = Math.min(stats.maxHp, player.hp + 30);
      break;
    case "heat":
      player.heat = Math.min(TUNING.heat.max, player.heat + 50);
      break;
    case "overdrive":
      player.overdrive = def.duration;
      break;
    case "shield":
      player.shield = def.duration;
      break;
    case "magnet":
      gems.forEach((g) => (g.pulled = true));
      break;
    case "emp":
      ring(pc.x, pc.y, W * 0.7, "#b06cff");
      camera.shake = Math.max(camera.shake, 14);
      enemies.forEach((e) => {
        if (onScreen(e) && !(e.hijackT > 0)) {
          damageEnemy(e, e.boss ? 40 : 60, { source: "emp" });
          e.stun = 1.2;
        }
      });
      enemyShots.length = 0;
      break;
  }
}

// -------------------------------------------------------- XP chip sprites ---
const xpArt = { scale: 0, image: false, frames: null, glows: null, beam: null, star: null };

// The sprites for the current screen resolution (rebuilt on resize, and once
// when img/xp-hardware.png becomes available)
function xpSprites() {
  const image = isReady(IMG.xpHardware);
  if (xpArt.frames && xpArt.scale === renderScale && xpArt.image === image) return xpArt;
  xpArt.scale = renderScale;
  xpArt.image = image;
  xpArt.frames = XP_TYPES.map((t, row) => {
    const px = Math.max(8, Math.round(t.size * renderScale));
    const frames = [];
    for (let f = 0; f < XP_FRAMES; f++) {
      const c = document.createElement("canvas");
      c.width = c.height = px;
      const g = c.getContext("2d");
      if (image) {
        g.imageSmoothingEnabled = false;
        g.drawImage(IMG.xpHardware, f * XP_CELL, row * XP_CELL, XP_CELL, XP_CELL, 0, 0, px, px);
      } else {
        g.scale(px / XP_CELL, px / XP_CELL);
        paintXpPart(g, row, f);
      }
      frames.push(c);
    }
    return frames;
  });
  xpArt.glows = XP_TYPES.map((t) => glowSprite(t.glow));
  if (!xpArt.beam) xpArt.beam = makeLootBeam();
  if (!xpArt.star) xpArt.star = makeSparkle();
  return xpArt;
}

// Procedural fallback, drawn on a 32x32 grid: RAM stick, M.2 NVMe, CPU
function paintXpPart(g, row, frame) {
  g.save();
  if (row === 0) paintRam(g);
  else if (row === 1) paintSsd(g);
  else paintCpu(g);
  g.restore();
  // The specular shine: a soft white band sweeping left to right
  g.save();
  g.globalCompositeOperation = "source-atop";
  g.translate(4 + frame * 8, 16);
  g.rotate(0.5);
  const band = g.createLinearGradient(-4.5, 0, 4.5, 0);
  band.addColorStop(0, "rgba(255,255,255,0)");
  band.addColorStop(0.5, frame ? "rgba(255,255,255,0.85)" : "rgba(255,255,255,0.45)");
  band.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = band;
  g.fillRect(-4.5, -26, 9, 52);
  g.restore();
}

function paintRam(g) {
  g.translate(16, 16);
  g.rotate(-0.22);
  g.translate(-16, -16);
  g.fillStyle = "#06331a";
  g.fillRect(1.6, 6.4, 28.8, 16.4); // dark outline
  g.fillStyle = "#1fae55";
  g.fillRect(2.4, 9.6, 27.2, 12.4); // the board
  const bar = g.createLinearGradient(2, 0, 30, 0); // RGB heat spreader
  bar.addColorStop(0, "#ff2fd6");
  bar.addColorStop(0.5, "#b06cff");
  bar.addColorStop(1, "#19f5ff");
  g.fillStyle = bar;
  g.fillRect(2.4, 7.2, 27.2, 3);
  g.fillStyle = "rgba(255,255,255,0.7)";
  g.fillRect(2.4, 7.2, 27.2, 0.8);
  for (let i = 0; i < 4; i++) {
    g.fillStyle = "#10141c"; // memory chips
    g.fillRect(4 + i * 6.3, 11.4, 5.1, 6);
    g.fillStyle = "#4a5670";
    g.fillRect(4 + i * 6.3, 11.4, 5.1, 1);
  }
  g.fillStyle = "#ffd166"; // gold contacts, with the key notch
  for (let i = 0; i < 12; i++) if (i !== 7) g.fillRect(3.2 + i * 2.2, 18.8, 1.4, 3.2);
}

function paintSsd(g) {
  g.translate(16, 16);
  g.rotate(-0.6);
  g.translate(-16, -16);
  g.fillStyle = "#4ea8ff";
  g.fillRect(0.6, 11, 30.8, 10); // bright rim
  g.fillStyle = "#0b1730";
  g.fillRect(1.4, 11.8, 29.2, 8.4); // the board
  g.fillStyle = "#ffd166"; // the M.2 key connector
  for (let i = 0; i < 5; i++) if (i !== 3) g.fillRect(1.4, 12.4 + i * 1.6, 3.2, 1.1);
  g.fillStyle = "#eef2f9"; // label sticker
  g.fillRect(7, 12.4, 17.4, 7.2);
  g.fillStyle = "#ff2fd6";
  g.fillRect(7, 17.4, 17.4, 1.3);
  g.fillStyle = "#26304d";
  g.fillRect(8.6, 13.7, 8.4, 1.1);
  g.fillRect(8.6, 15.5, 12, 0.8);
  g.fillStyle = "#19f5ff"; // controller LED
  g.fillRect(26, 14.6, 2.6, 2.6);
  g.globalCompositeOperation = "destination-out"; // the screw notch
  g.beginPath();
  g.arc(31.2, 16, 1.9, 0, Math.PI * 2);
  g.fill();
}

function paintCpu(g) {
  g.fillStyle = "#ffd166"; // gold pin ring
  g.fillRect(3.4, 3.4, 25.2, 25.2);
  g.fillStyle = "#0e6b39"; // substrate
  g.fillRect(4.8, 4.8, 22.4, 22.4);
  g.fillStyle = "#fff0b8";
  for (let i = 0; i < 9; i++) {
    const p = 6.2 + i * 2.5;
    g.fillRect(p, 3.8, 1, 0.8);
    g.fillRect(p, 27.4, 1, 0.8);
    g.fillRect(3.8, p, 0.8, 1);
    g.fillRect(27.4, p, 0.8, 1);
  }
  const lid = g.createLinearGradient(8, 8, 24, 24); // the heat spreader
  lid.addColorStop(0, "#ffffff");
  lid.addColorStop(0.45, "#cdd4e0");
  lid.addColorStop(1, "#7c8597");
  g.fillStyle = lid;
  g.beginPath();
  g.moveTo(10.4, 8);
  g.lineTo(24, 8);
  g.lineTo(24, 24);
  g.lineTo(8, 24);
  g.lineTo(8, 10.4);
  g.closePath();
  g.fill();
  g.strokeStyle = "#566074";
  g.lineWidth = 0.6;
  g.stroke();
  g.fillStyle = "#19f5ff"; // logo
  g.beginPath();
  g.moveTo(16, 11.2);
  g.lineTo(19.6, 17);
  g.lineTo(12.4, 17);
  g.closePath();
  g.fill();
  g.fillStyle = "#566074";
  g.fillRect(11, 19, 10, 0.9);
  g.fillRect(12.6, 20.9, 6.8, 0.8);
  g.fillStyle = "#ffd166"; // pin-1 marker
  g.beginPath();
  g.moveTo(4.8, 27.2);
  g.lineTo(9, 27.2);
  g.lineTo(4.8, 23);
  g.closePath();
  g.fill();
}

// A faint golden beam above a CPU lying on the floor ("loot!")
function makeLootBeam() {
  const c = document.createElement("canvas");
  c.width = 16;
  c.height = 128;
  const g = c.getContext("2d");
  const v = g.createLinearGradient(0, 0, 0, 128);
  v.addColorStop(0, "rgba(255,209,102,0)");
  v.addColorStop(1, "rgba(255,209,102,0.9)");
  g.fillStyle = v;
  g.fillRect(0, 0, 16, 128);
  g.globalCompositeOperation = "destination-in";
  const h = g.createLinearGradient(0, 0, 16, 0);
  h.addColorStop(0, "rgba(0,0,0,0)");
  h.addColorStop(0.5, "rgba(0,0,0,1)");
  h.addColorStop(1, "rgba(0,0,0,0)");
  g.fillStyle = h;
  g.fillRect(0, 0, 16, 128);
  return c;
}

// A four-point sparkle
function makeSparkle() {
  const c = document.createElement("canvas");
  c.width = c.height = 32;
  const g = c.getContext("2d");
  const halo = g.createRadialGradient(16, 16, 0, 16, 16, 9);
  halo.addColorStop(0, "rgba(255,255,255,0.9)");
  halo.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = halo;
  g.fillRect(0, 0, 32, 32);
  g.fillStyle = "#ffffff";
  g.beginPath();
  g.moveTo(16, 0);
  g.lineTo(18, 14);
  g.lineTo(32, 16);
  g.lineTo(18, 18);
  g.lineTo(16, 32);
  g.lineTo(14, 18);
  g.lineTo(0, 16);
  g.lineTo(14, 14);
  g.closePath();
  g.fill();
  return c;
}

// ------------------------------------------------------------- Drawing -----
// Shine sweep: frames 0-3 play every ~1.8 s (out of step for every chip),
// then it rests on frame 0
const xpFrame = (g, time) => {
  const cyc = (time * 0.55 + g.phase * 0.159) % 1;
  return cyc < 0.3 ? Math.floor(cyc / 0.075) : 0;
};

function drawXpChips(time) {
  const art = xpSprites();
  const base = ctx.getTransform(); // world view: a uniform scale plus a translation
  const s = base.a;
  const left = camera.x - 100;
  const right = camera.x + W + 100;
  const top = camera.y - 160;
  const bottom = camera.y + H + 100;
  const prevAlpha = ctx.globalAlpha;
  const prevOp = ctx.globalCompositeOperation;
  const lite = perfMode(); // Performance mode: just the hardware (no glows, beams or glints)
  ctx.imageSmoothingEnabled = true;

  // Pass 1 (additive): glows, motion streaks and the CPUs' loot beams
  ctx.globalCompositeOperation = "lighter";
  for (let i = 0; i < gems.length && !lite; i++) {
    const g = gems[i];
    const cx = g.x + 12;
    const cy = g.y + 12;
    if (cx < left || cx > right || cy < top || cy > bottom) continue;
    const t = XP_TYPES[g.type];
    const pulse = Math.sin(time * 4 + g.phase);
    if (g.pulled) {
      // a comet tail stretched along its flight
      const k = Math.min(1, g.speed / 1600);
      const r = t.size * 0.7;
      setStretch(s, base.e, base.f, cx - g.dx * r * k, cy - g.dy * r * k, g.dx, g.dy, 1 + 2.2 * k, 0.75);
      ctx.globalAlpha = 0.9;
      ctx.drawImage(art.glows[g.type], -r, -r, r * 2, r * 2);
      ctx.setTransform(base);
      continue;
    }
    const y = cy - (g.onGround ? t.lift + 3 + 3 * Math.sin(time * 3 + g.phase) : 0);
    const r = t.size * (0.7 + 0.06 * pulse);
    ctx.globalAlpha = 0.8 + 0.2 * pulse;
    ctx.drawImage(art.glows[g.type], cx - r, y - r, r * 2, r * 2);
    if (g.type === 2 && g.onGround) {
      ctx.globalAlpha = 0.28 + 0.1 * pulse;
      ctx.drawImage(art.beam, cx - 13, y - 150, 26, 150);
    }
  }

  // Pass 2: the hardware itself, bobbing and slowly turning (or stretched)
  ctx.globalCompositeOperation = "source-over";
  ctx.globalAlpha = prevAlpha;
  for (let i = 0; i < gems.length; i++) {
    const g = gems[i];
    const cx = g.x + 12;
    const cy = g.y + 12;
    if (cx < left || cx > right || cy < top || cy > bottom) continue;
    const t = XP_TYPES[g.type];
    const sprite = art.frames[g.type][xpFrame(g, time)];
    const size = t.size;
    if (g.pulled) {
      const k = Math.min(0.9, g.speed / 1800);
      setStretch(s, base.e, base.f, cx, cy, g.dx, g.dy, 1 + k, 1 - k * 0.4);
      ctx.drawImage(sprite, -size / 2, -size / 2, size, size);
      ctx.setTransform(base);
      continue;
    }
    const y = cy - (g.onGround ? t.lift + 3 + 3 * Math.sin(time * 3 + g.phase) : 0);
    const w = size * (0.84 + 0.16 * Math.cos(time * 1.9 + g.phase)); // a slow turn
    ctx.drawImage(sprite, cx - w / 2, y - size / 2, w, size);
  }

  // Pass 3 (additive): glints during the shine sweep, and collection pops
  ctx.globalCompositeOperation = "lighter";
  for (let i = 0; i < gems.length && !lite; i++) {
    const g = gems[i];
    const f = g.pulled ? 0 : xpFrame(g, time);
    if (f < 1) continue;
    const cx = g.x + 12;
    const cy = g.y + 12;
    if (cx < left || cx > right || cy < top || cy > bottom) continue;
    const t = XP_TYPES[g.type];
    const y = cy - (g.onGround ? t.lift + 3 + 3 * Math.sin(time * 3 + g.phase) : 0);
    const r = t.size * (f === 2 ? 0.3 : 0.18);
    ctx.globalAlpha = f === 2 ? 1 : 0.6;
    ctx.drawImage(art.star, cx + t.size * 0.22 - r, y - t.size * 0.24 - r, r * 2, r * 2);
  }
  for (const p of xpFx.pops) {
    const k = p.t / 0.35;
    const t = XP_TYPES[p.type];
    const r = t.size * (0.35 + 0.9 * k);
    ctx.globalAlpha = 1 - k;
    ctx.drawImage(art.glows[p.type], p.x - r * 1.4, p.y - r * 1.4, r * 2.8, r * 2.8);
    ctx.drawImage(art.star, p.x - r, p.y - r, r * 2, r * 2);
  }
  ctx.globalCompositeOperation = prevOp;
  ctx.globalAlpha = prevAlpha;
}

// Draw at (x, y), stretched by `along` in the direction (ux, uy) and by
// `across` at right angles to it, on top of the world view (scale s, offset ox/oy)
function setStretch(s, ox, oy, x, y, ux, uy, along, across) {
  const d = along - across;
  ctx.setTransform(s * (across + d * ux * ux), s * d * ux * uy, s * d * ux * uy, s * (across + d * uy * uy), ox + s * x, oy + s * y);
}

function drawPickups(time) {
  if (gems.length || xpFx.pops.length) drawXpChips(time);
  powerups.forEach((p) => {
    if (p.life < 3 && Math.floor(p.life * 8) % 2 === 0) return; // blink before vanishing
    const c = centerOf(p);
    const def = POWERUPS[p.type];
    const bob = Math.sin(time * 4 + p.x) * 5;
    glow(c.x, c.y + bob, 50, def.color, 0.6);
    if (!drawCell("pickups", def.icon, 16, c.x, c.y + bob, 48, 48)) {
      ctx.fillStyle = def.color;
      ctx.fillRect(c.x - 16, c.y - 16 + bob, 32, 32);
    }
  });
}
