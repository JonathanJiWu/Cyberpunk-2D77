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
function drawParallax() {
  ctx.imageSmoothingEnabled = true;
  // Far city: background1.jpg repeats every 605px, so a 1210px slice tiles
  // seamlessly. The neon floor in that image is cropped off (we draw our own).
  const bg = IMG.background;
  if (isReady(bg)) {
    const srcW = 1210;
    const srcH = 715;
    const s = (GROUND_Y + 20) / srcH;
    const tileW = srcW * s;
    let x = -((camera.x * 0.22) % tileW);
    for (; x < W; x += tileW) ctx.drawImage(bg, 0, 0, srcW, srcH, x, 0, tileW + 1, srcH * s);
  } else {
    ctx.fillStyle = "#1a0b2e";
    ctx.fillRect(0, 0, W, H);
  }
  // Closer skyline silhouettes
  const sky = IMG.skyline;
  if (isReady(sky)) {
    ctx.imageSmoothingEnabled = false;
    const s = 2.5;
    const tileW = sky.naturalWidth * s;
    const h = sky.naturalHeight * s;
    let x = -((camera.x * 0.45) % tileW);
    ctx.globalAlpha = 0.72;
    for (; x < W; x += tileW) ctx.drawImage(sky, x, GROUND_Y + 12 - h, tileW + 1, h);
    ctx.globalAlpha = 1;
  }
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
