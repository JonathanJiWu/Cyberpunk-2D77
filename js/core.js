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
// Hero landing, the billboard, THE LEGEND, level-up hardware and the bosses
loadImage("heroLanding", "img/hero-landing.png"); // 3 rows (paine, tetsu, sudo) x 4 frames of 32x48
loadImage("billboard", "img/billboard.png"); // 6 frames of 96x128
loadImage("kiss", "img/kiss.png"); // 2 frames of 16x16
loadImage("legend", "img/legend.png"); // 5 frames of 64x64
loadImage("hardware", "img/hardware.png"); // 8 cells of 64x40
loadImage("overseerAvatar", "img/overseer-avatar.png"); // 14 frames of 64x96
loadImage("goatFinal", "img/goat-final.png"); // 14 frames of 96x96
// v3.1: the Cyber Widow, Hackerman, new landings/portraits, kit effects,
// hardware XP pickups and the NULL boss
loadImage("widow", "img/widow.png"); // 6 rows x 4 frames of 32x48 (rows 4/5: bow shot)
loadImage("hackerman", "img/hackerman.png"); // same layout (rows 4/5: EM projector)
loadImage("heroLanding2", "img/hero-landing2.png"); // rows: widow, tetsu, hackerman
loadImage("portraits2", "img/portraits2.png"); // 3 portraits of 48x48
// v3.2: the ICs redrawn (tools/art_ics.py) at 80x120 a frame, drawn 1:1; the
// 32x48 sheets above stay as fallbacks while these load (CHARACTERS[id].art)
loadImage("widow3", "img/widow3.png"); // 6 rows x 6 frames of 80x120 (cols 4/5: idle, airborne)
loadImage("tetsu3", "img/tetsu3.png"); // same layout
loadImage("hackerman3", "img/hackerman3.png"); // same layout
loadImage("heroLanding3", "img/hero-landing3.png"); // rows paine, tetsu, sudo x 4 frames of 80x120
loadImage("portraits3", "img/portraits3.png"); // 3 portraits of 64x64
// The portrait sheet to use and its cell size: the 64px one once it has loaded
const portraitSheet = () => (isReady(IMG.portraits3) ? ["portraits3", 64] : [isReady(IMG.portraits2) ? "portraits2" : "portraits", 48]);
loadImage("fx2", "img/fx2.png"); // 8 cells of 32x32: arrows, EM, glitch, bleed, heat, reflect
loadImage("xpHardware", "img/xp-hardware.png"); // rows RAM / NVMe / CPU x 4 shine frames
loadImage("nullBoss", "img/null.png"); // 14 frames of 64x96
// v3.2 enemies (tools/art_enemies.py)
loadImage("forkbomb", "img/forkbomb.png"); // 6 frames of 28x28: roll x4, unfurl, leap
loadImage("lobber", "img/lobber.png"); // 4 frames of 48x40: idle, walk x2, fire
loadImage("monolith", "img/monolith.png"); // 7 frames of 64x64 (armored, walk x2, idle, slam x2, charge) + a row of plates
loadImage("hotfix", "img/hotfix.png"); // 6 frames of 36x28: hover x4, tether x2
loadImage("ratelimiter", "img/ratelimiter.png"); // 4 frames of 36x72: idle, walk x2, pulse
// v3.2: redrawn NPCs (tools/art_npcs.py). The older sheets above stay as fallbacks.
loadImage("legend2", "img/legend2.png"); // THE LEGEND's talking head: 6 frames of 96x96 (shown via CSS)
loadImage("legendBust", "img/legend-bust.png"); // THE LEGEND, 192x240 bust
loadImage("nullBoss2", "img/null2.png"); // NULL, same layout as null.png
loadImage("billboard2", "img/billboard2.png"); // the hologram ad, same layout as billboard.png
loadImage("ninja2", "img/ninja2.png"); // Cyber Ninja, same layout as ninja.png
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
// The big select busts (192x240), for the co-op join screen: IMG.bust_paine...
// Only the ICs that have one (ch.bust); js/select.js falls back to the portrait.
CHARACTER_ORDER.forEach((id) => CHARACTERS[id].bust && loadImage("bust_" + id, CHARACTERS[id].bust));

// fire.png and blue-flame.png are ~900px wide but drawn tiny; shrink them once
// (and let the full-size decoded images go: ~7 MB of memory).
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
    IMG[name] = c;
  };
  if (isReady(img)) make();
  else img.addEventListener("load", make);
}
prescale("fire", 160);
prescale("blueFlame", 160);
const smallOr = (name) => SMALL[name] || (isReady(IMG[name]) ? IMG[name] : null);

// ------------------------------------------------------- Performance mode ---
// settings.perfMode (the switch is in the settings menu, see js/display.js):
// fewer particles, no decorative glows, glitch ghosting or weather detail, a
// simpler backdrop and a lower internal resolution. Enemies, bullets,
// telegraphs and the HUD look the same.
function perfMode() {
  return typeof settings !== "undefined" && settings.perfMode === true;
}
const PARTICLE_CAP = 260; // particles alive at once
const PERF_PARTICLE_CAP = 90; // ...in Performance mode
const particleCap = () => (perfMode() ? PERF_PARTICLE_CAP : PARTICLE_CAP);

// "rgba(r,g,b,a)" -> [r, g, b, a] (null for anything else)
function parseRgba(color) {
  const m = /^rgba\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*\)$/.exec(color);
  return m ? [Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4])] : null;
}

// ----------------------------------------------------------- Draw helpers ---
// Tinted copies of sprite frames (hit flashes, stuns, telegraphs, ghosts) are
// cached, so a tint costs one drawImage instead of repainting a scratch canvas
// (and the browser re-uploading it) on every draw. Tints whose alpha animates
// are bucketed to 1/40 steps, which looks the same.
const tintCache = new Map(); // tint -> Map(image -> Map(frame -> canvas))
const tintNames = new Map(); // tint as given -> bucketed tint
let tintPixels = 0;
const TINT_CACHE_PIXELS = 1 << 21; // ~8 MB of tinted frames, then start over
function tintedFrame(img, sx, sy, sw, sh, tint) {
  let name = tintNames.get(tint);
  if (name === undefined) {
    const c = parseRgba(tint);
    name = c ? `rgba(${c[0]},${c[1]},${c[2]},${Math.round(clamp(c[3], 0, 1) * 40) / 40})` : tint;
    if (tintNames.size > 400) tintNames.clear(); // animated tints: don't grow forever
    tintNames.set(tint, name);
  }
  let byImage = tintCache.get(name);
  if (!byImage) tintCache.set(name, (byImage = new Map()));
  let frames = byImage.get(img);
  if (!frames) byImage.set(img, (frames = new Map()));
  const key = sx + 4096 * (sy + 4096 * (sw + 1024 * sh));
  let c = frames.get(key);
  if (!c) {
    if (tintPixels + sw * sh > TINT_CACHE_PIXELS) {
      tintCache.clear();
      tintPixels = 0;
      return tintedFrame(img, sx, sy, sw, sh, tint);
    }
    c = document.createElement("canvas");
    c.width = sw;
    c.height = sh;
    const g = c.getContext("2d");
    g.drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);
    g.globalCompositeOperation = "source-atop";
    g.fillStyle = name;
    g.fillRect(0, 0, sw, sh);
    frames.set(key, c);
    tintPixels += sw * sh;
  }
  return c;
}

// Draw one frame of a sprite sheet, optionally mirrored and/or tinted.
function drawFrame(img, sx, sy, sw, sh, dx, dy, dw, dh, tint, flip) {
  if (!isReady(img)) return false;
  ctx.imageSmoothingEnabled = false;
  let src = img;
  if (tint) {
    src = tintedFrame(img, sx, sy, sw, sh, tint);
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
//   glowSprite(color): the sprite with the colour's own alpha baked in.
//   glow(): draws the colour at full strength with its alpha as globalAlpha
//   (it looks the same), so colours built on the fly with an animated alpha
//   share one sprite; an animated hue is bucketed to 5 degree steps. Before,
//   each new colour string made (and kept) a new canvas every frame.
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
const glowColors = new Map(); // colour as given -> { sprite, alpha }
function glowEntry(color) {
  let entry = glowColors.get(color);
  if (entry) return entry;
  let base = color;
  let alpha = 1;
  const rgba = parseRgba(color);
  const hsla = !rgba && /^hsla\(\s*([\d.]+)\s*,([^,]+),([^,]+),\s*([\d.]+)\s*\)$/.exec(color);
  if (rgba) {
    base = `rgb(${Math.round(rgba[0])},${Math.round(rgba[1])},${Math.round(rgba[2])})`;
    alpha = clamp(rgba[3], 0, 1);
  } else if (hsla) {
    base = `hsl(${(Math.round(Number(hsla[1]) / 5) * 5) % 360},${hsla[2].trim()},${hsla[3].trim()})`;
    alpha = clamp(Number(hsla[4]), 0, 1);
  }
  entry = { sprite: glowSprite(base), alpha };
  if (glowColors.size > 400) glowColors.clear();
  glowColors.set(color, entry);
  return entry;
}
function glow(x, y, radius, color, alpha = 1) {
  const entry = glowEntry(color);
  const prevOp = ctx.globalCompositeOperation;
  const prevAlpha = ctx.globalAlpha;
  ctx.globalCompositeOperation = "lighter";
  ctx.globalAlpha = prevAlpha * alpha * entry.alpha;
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(entry.sprite, x - radius, y - radius, radius * 2, radius * 2);
  ctx.globalCompositeOperation = prevOp;
  ctx.globalAlpha = prevAlpha;
}
// A glow that is only decoration (street lamps, signs, platform under-glow,
// boss auras): skipped in Performance mode
function decorGlow(x, y, radius, color, alpha) {
  if (!perfMode()) glow(x, y, radius, color, alpha);
}

// A vertical gradient as a 1-pixel-wide strip, stretched over the area when
// drawn: much cheaper than filling a big gradient every frame (a full-screen
// gradient fill costs several ms without a GPU). stops: [[offset, color], ...]
const stripCache = new Map();
function gradientStrip(key, stops, height = 256) {
  let c = stripCache.get(key);
  if (!c) {
    c = document.createElement("canvas");
    c.width = 1;
    c.height = height;
    const g = c.getContext("2d");
    const grad = g.createLinearGradient(0, 0, 0, height);
    stops.forEach(([at, color]) => grad.addColorStop(at, color));
    g.fillStyle = grad;
    g.fillRect(0, 0, 1, height);
    stripCache.set(key, c);
  }
  return c;
}
function drawStrip(strip, x, y, w, h) {
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(strip, x, y, w, h);
}

// "22px Press Start 2P..." strings, built once per size (FONT is in render.js)
const fontCache = new Map();
function fontPx(size) {
  let f = fontCache.get(size);
  if (!f) {
    if (fontCache.size > 64) fontCache.clear();
    fontCache.set(size, (f = `${size}px ${FONT}`));
  }
  return f;
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
const particlePool = []; // spent particles, reused by burst() and dust()
const popups = []; // floating text (damage numbers, pickups)
const rings = []; // expanding shockwaves
const arcs = []; // lightning bolts

// A particle from the pool (same fields, in the same order, as the literals
// some effects push straight onto particles)
function makeParticle(x, y, vx, vy, life, size, color) {
  const p = particlePool.pop();
  if (!p) return { x, y, vx, vy, life, size, color };
  p.x = x;
  p.y = y;
  p.vx = vx;
  p.vy = vy;
  p.life = life;
  p.size = size;
  p.color = color;
  return p;
}

function burst(x, y, count, color, speed, size = 1) {
  const cap = particleCap();
  if (cap !== PARTICLE_CAP) count = Math.ceil(count / 2); // Performance mode: half as many
  for (let i = 0; i < count && particles.length < cap; i++) {
    const a = Math.random() * Math.PI * 2;
    const s = speed * rand(0.3, 1);
    particles.push(makeParticle(x, y, Math.cos(a) * s, Math.sin(a) * s - 80, rand(0.25, 0.6), rand(4, 9) * size, color));
  }
}

function popup(text, x, y, color, size = 26, life = 0.9) {
  if (popups.length > (perfMode() ? 24 : 45)) popups.shift();
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
  // Spent particles are swapped out (they are drawn additively, so the order
  // doesn't show) and reused; Performance mode also trims to its cap
  const cap = particleCap();
  while (particles.length > cap) particlePool.push(particles.pop());
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    if ((p.life -= dt) <= 0) {
      const last = particles.pop();
      if (last !== p) particles[i] = last;
      if (particlePool.length < PARTICLE_CAP) particlePool.push(p);
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
