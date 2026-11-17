"use strict";
// =============================================================================
// Shared helpers: canvas, assets, math, camera and visual effects.
// =============================================================================

const canvas = document.getElementById("canvas1");
const ctx = canvas.getContext("2d");
const gameEl = document.getElementById("game");
let renderScale = 1; // canvas pixels per logical pixel

// ------------------------------------------------------------------- Math ---
const rand = (min, max) => min + Math.random() * (max - min);
const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
const centerOf = (b) => ({ x: b.x + b.w / 2, y: b.y + b.h / 2 });
const overlaps = (a, b) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
function circleHitsBox(cx, cy, r, b) {
  const nx = clamp(cx, b.x, b.x + b.w);
  const ny = clamp(cy, b.y, b.y + b.h);
  return (cx - nx) ** 2 + (cy - ny) ** 2 < r * r;
}
function weightedPick(entries) {
  // entries: [[value, weight], ...]
  const total = entries.reduce((sum, e) => sum + e[1], 0);
  let r = Math.random() * total;
  for (const [value, weight] of entries) {
    if ((r -= weight) <= 0) return value;
  }
  return entries[entries.length - 1][0];
}
function formatTime(seconds) {
  const s = Math.max(0, Math.floor(seconds));
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

// ----------------------------------------------------------------- Assets ---
const IMG = {};
function loadImage(name, src) {
  const img = new Image();
  img.src = src;
  IMG[name] = img;
  return img;
}
const isReady = (img) => !!img && (img instanceof HTMLCanvasElement || (img.complete && img.naturalWidth > 0));

loadImage("player", "img/paine.png"); // 4x4 frames of 32x48
loadImage("goat", "img/redgoat.png"); // 4x4 frames of 80x80
loadImage("death", "img/death.png"); // reaper, 4x4 frames of 50x48
loadImage("dragon", "img/dragon.png"); // 4x4 frames of 96x96
loadImage("drone", "img/drone.png"); // 4 frames of 32x32
loadImage("crawler", "img/crawler.png"); // 4 frames of 40x28
loadImage("pickups", "img/pickups.png"); // 8 cells of 16x16
loadImage("icons", "img/icons.png"); // 12 cells of 24x24
loadImage("projectiles", "img/projectiles.png"); // 4 cells of 16x16
loadImage("platform", "img/platform.png"); // 3 tiles of 32x16
loadImage("crate", "img/crate.png"); // 2 frames of 32x32
loadImage("skyline", "img/skyline.png");
loadImage("ground", "img/ground.png");
loadImage("background", "img/background1.jpg");
// Heroes, new enemies, the second boss and effects
loadImage("tetsu", "img/tetsu.png"); // 6 rows x 4 frames of 32x48 (rows 4/5: attack)
loadImage("sudo", "img/sudo.png"); // same layout
loadImage("paineAttack", "img/paine-attack.png"); // 2 rows x 4 frames of 32x48
loadImage("portraits", "img/portraits.png"); // 3 portraits of 48x48
loadImage("ninja", "img/ninja.png"); // 4 frames of 40x48
loadImage("enforcer", "img/enforcer.png"); // 4 frames of 56x56
loadImage("bomber", "img/bomber.png"); // 4 frames of 32x32
loadImage("sniper", "img/sniper.png"); // 4 frames of 40x40
loadImage("overseer", "img/overseer.png"); // 4 frames of 96x96
loadImage("fx", "img/fx.png"); // 8 cells of 32x32
// Neon city + cyberpunk enemy re-skins
loadImage("cityMid", "img/city-mid.png");
loadImage("facade", "img/facade.png"); // 2 tiles of 64x64
loadImage("aerodyne", "img/aerodyne.png"); // 2 frames of 64x24
loadImage("reaperCyber", "img/reaper-cyber.png"); // same layout as death.png
loadImage("dragonCyber", "img/dragon-cyber.png"); // same layout as dragon.png
loadImage("goatCyber", "img/goat-cyber.png"); // same layout as redgoat.png
// Easter egg art
loadImage("hologram", "img/hologram.png"); // 2 frames of 48x96
loadImage("dove", "img/dove.png"); // 4 frames of 16x16
loadImage("secrets", "img/secrets.png"); // 8 icons of 24x24
loadImage("terminal", "img/terminal.png"); // 2 frames of 24x40
loadImage("moon", "img/moon.png");
loadImage("katana", "img/katana.png");
loadImage("ripperdoc", "img/ripperdoc.png");
loadImage("endGame", "img/endgame.jpg");
loadImage("wasd", "img/wasd.png");
loadImage("fire", "img/fire.png");
loadImage("blueFlame", "img/blue-flame.png");

// fire.png and blue-flame.png are ~900px wide but drawn tiny; shrink them once.
const SMALL = {};
function prescale(name, width) {
  const img = IMG[name];
  const make = () => {
    const c = document.createElement("canvas");
    c.width = width;
    c.height = Math.round((img.naturalHeight / img.naturalWidth) * width);
    const g = c.getContext("2d");
    g.imageSmoothingQuality = "high";
    g.drawImage(img, 0, 0, c.width, c.height);
    SMALL[name] = c;
  };
  if (isReady(img)) make();
  else img.addEventListener("load", make);
}
prescale("fire", 160);
prescale("blueFlame", 160);
const smallOr = (name) => SMALL[name] || (isReady(IMG[name]) ? IMG[name] : null);

// ----------------------------------------------------------- Draw helpers ---
// Scratch canvas used to tint sprite frames (hit flashes, enrage, telegraphs)
const tintCanvas = document.createElement("canvas");
tintCanvas.width = 96;
tintCanvas.height = 96;
const tintCtx = tintCanvas.getContext("2d");

// Draw one frame of a sprite sheet, optionally mirrored and/or tinted.
function drawFrame(img, sx, sy, sw, sh, dx, dy, dw, dh, tint, flip) {
  if (!isReady(img)) return false;
  ctx.imageSmoothingEnabled = false;
  let src = img;
  if (tint) {
    tintCtx.globalCompositeOperation = "source-over";
    tintCtx.clearRect(0, 0, sw, sh);
    tintCtx.drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);
    tintCtx.globalCompositeOperation = "source-atop";
    tintCtx.fillStyle = tint;
    tintCtx.fillRect(0, 0, sw, sh);
    src = tintCanvas;
    sx = sy = 0;
  }
  if (flip) {
    ctx.save();
    ctx.translate(dx + dw, dy);
    ctx.scale(-1, 1);
    ctx.drawImage(src, sx, sy, sw, sh, 0, 0, dw, dh);
    ctx.restore();
  } else {
    ctx.drawImage(src, sx, sy, sw, sh, dx, dy, dw, dh);
  }
  return true;
}

// Soft additive glow. Gradients are cached as small canvases because creating
// a gradient for every projectile every frame is slow on phones.
const glowCache = new Map();
function glowSprite(color) {
  let c = glowCache.get(color);
  if (!c) {
    c = document.createElement("canvas");
    c.width = c.height = 64;
    const g = c.getContext("2d");
    const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    grad.addColorStop(0, color);
    grad.addColorStop(1, "rgba(0,0,0,0)");
    g.fillStyle = grad;
    g.fillRect(0, 0, 64, 64);
    glowCache.set(color, c);
  }
  return c;
}
function glow(x, y, radius, color, alpha = 1) {
  const prevOp = ctx.globalCompositeOperation;
  const prevAlpha = ctx.globalAlpha;
  ctx.globalCompositeOperation = "lighter";
  ctx.globalAlpha = prevAlpha * alpha;
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(glowSprite(color), x - radius, y - radius, radius * 2, radius * 2);
  ctx.globalCompositeOperation = prevOp;
  ctx.globalAlpha = prevAlpha;
}

// Draw a 16x16 (or other size) cell from a horizontal strip sheet, centred.
function drawCell(name, cell, size, x, y, w, h, angle) {
  const img = IMG[name];
  if (!isReady(img)) return false;
  ctx.imageSmoothingEnabled = false;
  if (angle) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle);
    ctx.drawImage(img, cell * size, 0, size, size, -w / 2, -h / 2, w, h);
    ctx.restore();
  } else {
    ctx.drawImage(img, cell * size, 0, size, size, x - w / 2, y - h / 2, w, h);
  }
  return true;
}

// ----------------------------------------------------------------- Camera ---
const camera = { x: 0, y: 0, shake: 0 }; // y goes negative when you climb

// ---------------------------------------------------------------- Effects ---
const particles = [];
const popups = []; // floating text (damage numbers, pickups)
const rings = []; // expanding shockwaves
const arcs = []; // lightning bolts

function burst(x, y, count, color, speed, size = 1) {
  for (let i = 0; i < count && particles.length < 260; i++) {
    const a = Math.random() * Math.PI * 2;
    const s = speed * rand(0.3, 1);
    particles.push({
      x,
      y,
      vx: Math.cos(a) * s,
      vy: Math.sin(a) * s - 80,
      life: rand(0.25, 0.6),
      size: rand(4, 9) * size,
      color,
    });
  }
}

function popup(text, x, y, color, size = 26, life = 0.9) {
  if (popups.length > 45) popups.shift();
  popups.push({ text, x, y, color, size, life, max: life });
}

function damageNumber(amount, x, y, color = "#ffffff") {
  const n = amount >= 1 ? Math.round(amount) : Math.round(amount * 10) / 10;
  popup(String(n), x + rand(-14, 14), y, color, 22, 0.6);
}

function ring(x, y, radius, color) {
  rings.push({ x, y, radius, color, life: 0.35, max: 0.35 });
}

// Jagged lightning bolt between points
function arc(points, color = "#9ffcff") {
  const segs = [];
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i];
    const b = points[i + 1];
    const steps = 6;
    segs.push([a.x, a.y]);
    for (let s = 1; s < steps; s++) {
      const t = s / steps;
      segs.push([a.x + (b.x - a.x) * t + rand(-18, 18), a.y + (b.y - a.y) * t + rand(-18, 18)]);
    }
  }
  const last = points[points.length - 1];
  segs.push([last.x, last.y]);
  arcs.push({ segs, color, life: 0.2, max: 0.2 });
}

function updateEffects(dt) {
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    if ((p.life -= dt) <= 0) {
      particles.splice(i, 1);
      continue;
    }
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.vy += 600 * dt;
    p.vx *= 0.97;
  }
  for (let i = popups.length - 1; i >= 0; i--) {
    const p = popups[i];
    p.y -= 70 * dt;
    if ((p.life -= dt) <= 0) popups.splice(i, 1);
  }
  for (let i = rings.length - 1; i >= 0; i--) if ((rings[i].life -= dt) <= 0) rings.splice(i, 1);
  for (let i = arcs.length - 1; i >= 0; i--) if ((arcs[i].life -= dt) <= 0) arcs.splice(i, 1);
  camera.shake = Math.max(0, camera.shake - 60 * dt);
}

function clearEffects() {
  particles.length = popups.length = rings.length = arcs.length = 0;
}
