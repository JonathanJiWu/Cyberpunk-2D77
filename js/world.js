"use strict";
// =============================================================================
// The world: one-way platforms (some moving), the street, breakable crates and
// background decoration. Also the shared platformer physics used by the
// player, walking enemies and pickups.
// =============================================================================

const PLATFORM_H = 32; // platform tiles are 32x16 drawn at 2x
const GROUND = { ground: true };

const platforms = LEVEL.platforms.map((p) => ({ ...p, h: PLATFORM_H, baseX: p.x, baseY: p.y, prevX: p.x, prevY: p.y }));
const crates = [];

function resetWorld() {
  platforms.forEach((p) => {
    p.x = p.prevX = p.baseX;
    p.y = p.prevY = p.baseY;
  });
  crates.length = 0;
  LEVEL.crates.forEach((c, i) => {
    const plat = c.onGround ? null : platforms[c.platform];
    crates.push({
      id: i,
      x: c.x,
      w: 60,
      h: 60,
      platform: plat,
      y: (plat ? plat.y : GROUND_Y) - 60,
      hp: 10,
      alive: true,
      respawn: 0,
      hurt: 0,
    });
  });
}

function updateWorld(dt, time) {
  platforms.forEach((p) => {
    p.prevX = p.x;
    p.prevY = p.y;
    if (p.ax || p.ay) {
      const s = Math.sin((time / p.period) * Math.PI * 2);
      p.x = p.baseX + (p.ax || 0) * s;
      p.y = p.baseY + (p.ay || 0) * s;
    }
  });
  crates.forEach((c) => {
    c.hurt = Math.max(0, c.hurt - dt);
    if (c.platform) {
      c.x += c.platform.x - c.platform.prevX;
      c.y = c.platform.y - c.h;
    }
    if (!c.alive && (c.respawn -= dt) <= 0) {
      c.alive = true;
      c.hp = 10;
      burst(c.x + c.w / 2, c.y + c.h / 2, 10, "#19f5ff", 200);
    }
  });
}

// Move a body {x, y, w, h, vx, vy} with gravity and one-way platform landing.
// Sets body.onGround / body.standingOn. body.dropTimer > 0 lets it fall
// through platforms (Down + Jump).
function moveBody(b, dt, gravity, maxFall) {
  // Ride moving platforms
  if (b.standingOn && !b.standingOn.ground) {
    b.x += b.standingOn.x - b.standingOn.prevX;
    b.y += b.standingOn.y - b.standingOn.prevY;
  }
  b.x = clamp(b.x + b.vx * dt, 0, WORLD_W - b.w);

  const prevBottom = b.y + b.h;
  b.vy = Math.min(b.vy + gravity * dt, maxFall);
  b.y += b.vy * dt;
  const wasOnGround = b.onGround;
  b.onGround = false;
  b.standingOn = null;

  if (b.y + b.h >= GROUND_Y) {
    b.y = GROUND_Y - b.h;
    b.vy = 0;
    b.onGround = true;
    b.standingOn = GROUND;
  } else if (b.vy >= 0 && !(b.dropTimer > 0)) {
    for (const p of platforms) {
      if (b.x + b.w <= p.x + 6 || b.x >= p.x + p.w - 6) continue;
      // Was above the platform last frame and is now at/below its top
      if (prevBottom <= p.y + 6 + Math.max(0, p.y - p.prevY) && b.y + b.h >= p.y) {
        b.y = p.y - b.h;
        b.vy = 0;
        b.onGround = true;
        b.standingOn = p;
        break;
      }
    }
  }
  return !wasOnGround && b.onGround; // just landed
}

// Is there a platform (or the ground) under x within the given drop distance?
function surfaceBelow(x, y) {
  let best = GROUND_Y;
  for (const p of platforms) {
    if (x >= p.x && x <= p.x + p.w && p.y >= y && p.y < best) best = p.y;
  }
  return best;
}

// --------------------------------------------------------------- Crates -----
function damageCrate(c, amount) {
  if (!c.alive) return;
  c.hp -= amount;
  c.hurt = 0.1;
  if (c.hp > 0) return;
  c.alive = false;
  c.respawn = LEVEL.crateRespawn;
  const cx = c.x + c.w / 2;
  const cy = c.y + c.h / 2;
  burst(cx, cy, 18, "#19f5ff", 360);
  burst(cx, cy, 8, "#ff2fd6", 260);
  sfx.crate.play();
  // Usually a power-up, otherwise a handful of XP
  if (Math.random() < 0.7) spawnPowerup(cx, cy - 10);
  else for (let i = 0; i < 4; i++) spawnGem(cx + rand(-20, 20), cy, 1);
}

// ------------------------------------------------------------ Rendering -----
// -------------------------------------------------------- The backdrop ---
// Layers from far to near; each scrolls slower than the world (parallax),
// both sideways and, when you climb, up and down.
const stars = Array.from({ length: 80 }, () => ({ x: rand(0, W), y: rand(0, H * 0.75), r: rand(1, 3), t: rand(0, 6) }));
const TRAFFIC = [
  { y: 330, speed: 230, parallax: 0.5, scale: 1.1, count: 3, alpha: 0.7 },
  { y: 190, speed: -300, parallax: 0.58, scale: 1.4, count: 2, alpha: 0.8 },
  { y: 560, speed: 380, parallax: 0.8, scale: 2, count: 2, alpha: 0.95 },
];

function drawParallax(time) {
  ctx.imageSmoothingEnabled = true;
  ctx.fillStyle = "rgb(19,0,56)"; // matches the sky of background1.jpg
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = "#e9dcff";
  stars.forEach((st) => {
    ctx.globalAlpha = 0.35 + 0.35 * Math.sin(time * 2 + st.t);
    ctx.fillRect(st.x, st.y - camera.y * 0.05, st.r, st.r);
  });
  ctx.globalAlpha = 1;

  // Far city: background1.jpg repeats every 605px, so a 1210px slice tiles
  // seamlessly. The neon floor in that image is cropped off (we draw our own).
  const bg = IMG.background;
  if (isReady(bg)) {
    const srcW = 1210;
    const srcH = 715;
    const s = (GROUND_Y + 20) / srcH;
    const tileW = srcW * s;
    const y = -camera.y * 0.25;
    let x = -((camera.x * 0.22) % tileW);
    for (; x < W; x += tileW) ctx.drawImage(bg, 0, 0, srcW, srcH, x, y, tileW + 1, srcH * s);
  }
  // The sky gets darker the higher you climb
  const sky = ctx.createLinearGradient(0, 0, 0, H);
  sky.addColorStop(0, `rgba(4,0,14,${clamp(-camera.y / 700, 0, 0.8)})`);
  sky.addColorStop(0.6, "rgba(4,0,14,0)");
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, W, H);
  drawMoon(); // easter egg: Edgerunners

  // Closer skyline silhouettes
  const skyline = IMG.skyline;
  if (isReady(skyline)) {
    ctx.imageSmoothingEnabled = false;
    const s = 2.5;
    const tileW = skyline.naturalWidth * s;
    const h = skyline.naturalHeight * s;
    let x = -((camera.x * 0.45) % tileW);
    ctx.globalAlpha = 0.72;
    for (; x < W; x += tileW) ctx.drawImage(skyline, x, GROUND_Y + 12 - h - camera.y * 0.45, tileW + 1, h);
    ctx.globalAlpha = 1;
  }
  drawTraffic(time, 0, 2);

  // Dense neon midground
  const mid = IMG.cityMid;
  if (isReady(mid)) {
    ctx.imageSmoothingEnabled = false;
    const s = 2.4;
    const tileW = mid.naturalWidth * s;
    const h = mid.naturalHeight * s;
    let x = -((camera.x * 0.65) % tileW);
    for (; x < W; x += tileW) ctx.drawImage(mid, x, GROUND_Y + 30 - h - camera.y * 0.65, tileW + 1, h);
  }
  drawTraffic(time, 2, 3);
  // Atmospheric depth: push the backdrop back so the action stays readable
  ctx.fillStyle = "rgba(12,3,32,0.42)";
  ctx.fillRect(0, 0, W, H);

  // Magenta haze rising off the street
  const gy = GROUND_Y - camera.y;
  const haze = ctx.createLinearGradient(0, gy - 460, 0, gy);
  haze.addColorStop(0, "rgba(255,47,214,0)");
  haze.addColorStop(1, "rgba(255,47,214,0.18)");
  ctx.fillStyle = haze;
  ctx.fillRect(0, gy - 460, W, 460);
}

// Flying cars on traffic lanes between the backdrop layers
function drawTraffic(time, from, to) {
  const img = IMG.aerodyne;
  for (let l = from; l < to; l++) {
    const lane = TRAFFIC[l];
    const span = W + 800;
    const y = lane.y - camera.y * lane.parallax;
    const w = 64 * lane.scale;
    const h = 24 * lane.scale;
    for (let i = 0; i < lane.count; i++) {
      let pos = (i * span) / lane.count + time * lane.speed - camera.x * lane.parallax + l * 377;
      pos = ((pos % span) + span) % span;
      const x = pos - 400;
      const dir = lane.speed > 0 ? 1 : -1;
      ctx.globalAlpha = lane.alpha;
      // light trail
      ctx.fillStyle = "rgba(255,47,214,0.25)";
      ctx.fillRect(dir > 0 ? x - w * 1.6 : x + w, y + h * 0.55, w * 1.6, Math.max(2, h * 0.12));
      glow(x + (dir > 0 ? w : 0), y + h * 0.45, 22 * lane.scale, "rgba(160,250,255,0.7)");
      glow(x + (dir > 0 ? 0 : w), y + h * 0.5, 14 * lane.scale, "rgba(255,40,60,0.7)");
      if (!drawFrame(img, (Math.floor(time * 3 + i) % 2) * 64, 0, 64, 24, x, y, w, h, null, dir < 0)) {
        ctx.fillStyle = "#2a2440";
        ctx.fillRect(x, y, w, h);
      }
    }
  }
  ctx.globalAlpha = 1;
}

// Buildings under the rooftop platforms, with vertical neon signs
const facadePatterns = [];
function facadePattern(i) {
  if (!isReady(IMG.facade)) return null;
  if (!facadePatterns[i]) {
    const c = document.createElement("canvas");
    c.width = c.height = 128;
    const g = c.getContext("2d");
    g.imageSmoothingEnabled = false;
    g.drawImage(IMG.facade, i * 64, 0, 64, 64, 0, 0, 128, 128);
    facadePatterns[i] = ctx.createPattern(c, "repeat");
  }
  return facadePatterns[i];
}

const vSignCache = new Map();
function verticalSign(text, color) {
  const key = text + color;
  let c = vSignCache.get(key);
  if (c) return c;
  c = document.createElement("canvas");
  c.width = 76;
  c.height = text.length * 50 + 34;
  const g = c.getContext("2d");
  g.fillStyle = "rgba(8,2,20,0.88)";
  g.fillRect(6, 6, c.width - 12, c.height - 12);
  g.strokeStyle = color;
  g.lineWidth = 4;
  g.shadowColor = color;
  g.shadowBlur = 14;
  g.strokeRect(6, 6, c.width - 12, c.height - 12);
  g.font = '34px "Press Start 2P", ui-monospace, monospace';
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillStyle = color;
  [...text].forEach((ch, i) => g.fillText(ch, c.width / 2, 34 + i * 50));
  vSignCache.set(key, c);
  return c;
}
if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => vSignCache.clear());

const ROOF_SIGNS = [
  ["BAR", "#ff2fd6"],
  ["RAMEN", "#19f5ff"],
  ["CHROME", "#ffe14d"],
  ["HOTEL", "#ff9b21"],
  ["NEON", "#5aff7a"],
  ["2D77", "#ff2457"],
];

function drawBuildings(time) {
  let n = 0;
  platforms.forEach((p) => {
    if (!p.roof) return;
    const i = n++;
    if (p.x > camera.x + W + 100 || p.x + p.w < camera.x - 100) return;
    const bx = p.x + 10;
    const bw = p.w - 20;
    const top = p.y + 24;
    const h = GROUND_Y - top;
    ctx.fillStyle = facadePattern(i % 2) || "#1a1030";
    ctx.fillRect(bx, top, bw, h);
    const shade = ctx.createLinearGradient(0, top, 0, GROUND_Y);
    shade.addColorStop(0, "rgba(10,2,24,0.3)");
    shade.addColorStop(1, "rgba(10,2,24,0.65)");
    ctx.fillStyle = shade;
    ctx.fillRect(bx, top, bw, h);
    // neon trim down both edges
    ctx.fillStyle = "rgba(25,245,255,0.85)";
    ctx.fillRect(bx, top, 3, h);
    ctx.fillStyle = "rgba(255,47,214,0.85)";
    ctx.fillRect(bx + bw - 3, top, 3, h);
    // rooftop antenna with a blinking light
    ctx.fillStyle = "#241040";
    ctx.fillRect(bx + 26, p.y - 70, 5, 70);
    if (Math.sin(time * 3 + i) > 0) glow(bx + 28, p.y - 72, 22, "rgba(255,40,60,0.9)");
    // a vertical neon sign hanging off the side (only where it clears the
    // street signs below)
    const [text, color] = ROOF_SIGNS[i % ROOF_SIGNS.length];
    const sign = verticalSign(text, color);
    const sx = i % 2 ? bx - sign.width + 12 : bx + bw - 12;
    const sy = top + 50;
    if (sy + sign.height > GROUND_Y - 500) return;
    const flicker = Math.sin(time * 5 + i * 3) > 0.96 ? 0.35 : 1;
    ctx.globalAlpha = flicker;
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(sign, sx, sy);
    glow(sx + sign.width / 2, sy + sign.height / 2, sign.height * 0.7, color, 0.3 * flicker);
    ctx.globalAlpha = 1;
  });
}

// Neon light reflected on the wet street
function drawReflections() {
  const left = camera.x - 300;
  const right = camera.x + W + 300;
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  ctx.imageSmoothingEnabled = true;
  LEVEL.signs.forEach((s) => {
    if (s.x < left || s.x > right) return;
    ctx.globalAlpha = 0.5;
    ctx.drawImage(glowSprite(s.color), s.x - 180, GROUND_Y + 2, 360, 80);
  });
  for (let x = 160; x < WORLD_W; x += 640) {
    if (x < left || x > right) continue;
    ctx.globalAlpha = 0.35;
    ctx.drawImage(glowSprite("rgba(255,200,120,0.9)"), x - 60, GROUND_Y + 2, 240, 60);
  }
  platforms.forEach((p) => {
    if (!p.roof || p.x > right || p.x + p.w < left) return;
    ctx.globalAlpha = 0.3;
    ctx.drawImage(glowSprite("rgba(25,245,255,0.9)"), p.x - 20, GROUND_Y + 2, 60, 90);
    ctx.drawImage(glowSprite("rgba(255,47,214,0.9)"), p.x + p.w - 40, GROUND_Y + 2, 60, 90);
  });
  ctx.restore();
}

// Neon signs are rendered once into small canvases (shadow blur is slow)
const signCache = new Map();
if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => signCache.clear());
function signSprite(text, color) {
  const key = text + color;
  let c = signCache.get(key);
  if (c) return c;
  c = document.createElement("canvas");
  const g = c.getContext("2d");
  const font = '34px "Press Start 2P", ui-monospace, monospace';
  g.font = font;
  const tw = Math.ceil(g.measureText(text).width);
  c.width = tw + 60;
  c.height = 90;
  g.font = font;
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillStyle = "rgba(10,3,24,0.85)";
  g.strokeStyle = color;
  g.lineWidth = 4;
  g.fillRect(8, 8, c.width - 16, c.height - 16);
  g.shadowColor = color;
  g.shadowBlur = 16;
  g.strokeRect(8, 8, c.width - 16, c.height - 16);
  g.fillStyle = color;
  g.fillText(text, c.width / 2, c.height / 2 + 2);
  g.shadowBlur = 6;
  g.fillStyle = "#ffffff";
  g.globalAlpha = 0.6;
  g.fillText(text, c.width / 2, c.height / 2 + 2);
  signCache.set(key, c);
  return c;
}

// Everything below is drawn in world coordinates (after translating by camera)
function drawDecor(time) {
  drawBuildings(time);
  const left = camera.x - 200;
  const right = camera.x + W + 200;
  // Street lamps
  for (let x = 160; x < WORLD_W; x += 640) {
    if (x < left || x > right) continue;
    ctx.fillStyle = "#241040";
    ctx.fillRect(x - 6, GROUND_Y - 330, 12, 330);
    ctx.fillRect(x - 6, GROUND_Y - 330, 70, 10);
    ctx.fillStyle = "#ffe9a8";
    ctx.fillRect(x + 44, GROUND_Y - 322, 26, 8);
    glow(x + 57, GROUND_Y - 300, 120, "rgba(255,200,120,0.35)");
  }
  // Signs on poles
  LEVEL.signs.forEach((s, i) => {
    if (s.x < left - 300 || s.x > right) return;
    const sprite = signSprite(s.text, s.color);
    const flicker = Math.sin(time * 3 + i * 7) > 0.97 ? 0.4 : 1;
    ctx.fillStyle = "#1d0d36";
    ctx.fillRect(s.x - 5, GROUND_Y - 420, 10, 420);
    ctx.globalAlpha = flicker;
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(sprite, s.x - sprite.width / 2, GROUND_Y - 470);
    glow(s.x, GROUND_Y - 425, 160, s.color, 0.35 * flicker);
    ctx.globalAlpha = 1;
  });
}

function drawPlatforms() {
  const img = IMG.platform;
  const ready = isReady(img);
  ctx.imageSmoothingEnabled = false;
  platforms.forEach((p) => {
    if (p.x > camera.x + W + 50 || p.x + p.w < camera.x - 50) return;
    glow(p.x + p.w / 2, p.y + 40, p.w * 0.6, "rgba(25,245,255,0.18)");
    if (!ready) {
      ctx.fillStyle = "#3d3560";
      ctx.fillRect(p.x, p.y, p.w, p.h);
      ctx.fillStyle = "#19f5ff";
      ctx.fillRect(p.x, p.y, p.w, 5);
      return;
    }
    const tiles = Math.round(p.w / 64);
    for (let i = 0; i < tiles; i++) {
      const cell = i === 0 ? 0 : i === tiles - 1 ? 2 : 1;
      ctx.drawImage(img, cell * 32, 0, 32, 16, p.x + i * 64, p.y, 64, 32);
    }
    if (p.ax || p.ay) {
      // moving platforms get a pulsing marker
      ctx.fillStyle = `rgba(255,47,214,${0.5 + 0.5 * Math.sin(performance.now() / 150)})`;
      ctx.fillRect(p.x + p.w / 2 - 10, p.y + 34, 20, 4);
    }
  });
}

function drawGround() {
  const img = IMG.ground;
  const start = Math.floor(camera.x / 128) * 128;
  if (isReady(img)) {
    ctx.imageSmoothingEnabled = false;
    for (let x = start; x < camera.x + W + 128; x += 128) ctx.drawImage(img, x, GROUND_Y - 4, 128, 96);
  } else {
    ctx.fillStyle = "#1a0b2e";
    ctx.fillRect(camera.x, GROUND_Y, W, H - GROUND_Y);
    ctx.fillStyle = "#ff2fd6";
    ctx.fillRect(camera.x, GROUND_Y, W, 4);
  }
  drawReflections();
  // World edges
  ctx.fillStyle = "rgba(255,36,87,0.25)";
  if (camera.x < 40) ctx.fillRect(0, 0, 8, H);
  if (camera.x + W > WORLD_W - 40) ctx.fillRect(WORLD_W - 8, 0, 8, H);
}

function drawCrates() {
  crates.forEach((c) => {
    if (!c.alive || c.x > camera.x + W || c.x + c.w < camera.x) return;
    const damaged = c.hp < 6 ? 1 : 0;
    const tint = c.hurt > 0 ? "rgba(255,255,255,0.8)" : null;
    if (!drawFrame(IMG.crate, damaged * 32, 0, 32, 32, c.x - 2, c.y - 4, 64, 64, tint)) {
      ctx.fillStyle = "#3d3560";
      ctx.fillRect(c.x, c.y, c.w, c.h);
    }
  });
}
