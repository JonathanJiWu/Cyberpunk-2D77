"use strict";
// =============================================================================
// Boss 2: NULL // the assassin who isn't there. (Its id is "nullptr", so no
// code ever has to type a bare null.) A glitchy cyber-ninja: a hooded cloak
// that dissolves into pixels, a black mask with an empty-set sign and twin
// violet energy blades. The Overseer outguns you and the GOAT runs you over;
// NULL misdirects. It is never quite where you are looking:
//   decoy   it splits into holographic copies and only one is real. The real
//           one casts a shadow and barely flickers; the copies flicker and
//           have a faint RGB split. Hitting a copy pops it and briefly reveals
//           the real one. Copies attack too (shuriken, short lunges), weakly.
//   blink   it dissolves into pixels and a glyph glows where it will reappear:
//           behind you (then it slashes) or above you (then it plunges).
//           Get off the glyph.
//   fan     it plants, a glint at its hand, then a fan of spinning shuriken
//           at different speeds, so the gaps open at different times
//   snipe   it double-jumps up to a rooftop and crouches. An aim line tracks
//           you, then locks (white), then one fast rail shot that pierces
//   smoke   a smoke bomb: it relocates while you can't see it
// Phases: below 60% more copies, faster blinks, double blinks; below 25%
// STACK OVERFLOW: chained blinks, then a CORE DUMP (it kneels, exposed).
// It moves like a rival IC: runs, double-jumps, backflips away when you crowd
// it and wall-hops off whatever it lands against. It never floats.
// While it is "between places" (blinking, in the smoke) it is parked far
// above the world, so nothing can touch it and no shot is wasted on it.
// =============================================================================

const NULLB = {
  w: 64,
  h: 196,
  scale: 2.25, // the 64x96 sprite is drawn at 144x216; its feet are on row 94
  color: "#b06cff",
  speed: [440, 500, 560], // per phase
  think: [0.75, 0.55, 0.4], // breather between attacks
  contact: 16,
  decoys: [2, 3, 4],
  decoyLife: [10, 11, 12],
  decoyCd: 6, // after the last copy is gone
  reveal: 1.5, // popping a copy shows the real one this long
  blinkTell: [0.7, 0.55, 0.42], // how long the glyph glows before it strikes
  chain: 3, // STACK OVERFLOW: blinks in a row
  slashDamage: 26,
  plungeDamage: 28,
  fan: [5, 7, 7],
  fanTell: [0.45, 0.38, 0.32],
  shurikenDamage: 10,
  aim: [1.1, 0.9, 0.75], // the aim line tracks you this long...
  lock: 0.32, // ...then holds still (white) this long before the shot
  railDamage: 34,
  railSpeed: 4200,
  coreDump: 1.5,
  decoyShuriken: 5,
  decoyLunge: 8,
};
const NULL_PARK_Y = WORLD_TOP - 3000;
const nullFx = { frags: [], pixels: [], smoke: [], rails: [], slashes: [], glyphs: [], tear: 0, death: null, cache: null };

// Sounds come from the synth (js/synthfx.js). Until it is loaded, borrow the
// closest sample so the fight is never silent.
function nullSound(name) {
  if (typeof synth !== "undefined" && synth && typeof synth.play === "function") {
    synth.play(name);
    return;
  }
  const near = { nullBlink: ["energy", 2.4], nullDecoy: ["chain", 1.8], nullSlash: ["zapHit", 0.6], nullShuriken: ["enemyShot", 2.6], nullCharge: ["energy", 0.45], nullShot: ["stomp", 1.7], nullDeath: ["chain", 0.45], bossIntro: ["chain", 0.5], bossDefeated: ["stomp", 0.5] }[name];
  if (near && sfx[near[0]]) sfx[near[0]].play({ rate: near[1] });
}

const nullDecoys = (real) => enemies.filter((d) => d.decoy && !d.dead && d.owner === real);
const nullSrc = (e) => (e.decoy ? e.owner : e); // copies hurt you on the real one's behalf
const nullPick = (list) => list[Math.floor(Math.random() * list.length)];

// --------------------------------------------------------------- Arrival ----
function spawnNull() {
  director.stage = STAGE.nullptr;
  const pc = centerOf(player);
  const feet = player.y + player.h;
  const side = pc.x < WORLD_W / 2 ? 1 : -1;
  let x = clamp(pc.x + side * 480, 120, WORLD_W - 120);
  let floor = surfaceBelow(x, feet - 8);
  const plat = player.standingOn && !player.standingOn.ground ? player.standingOn : null;
  if (plat && floor > feet + 200) {
    // you're up on a roof: it forms at the far end of yours
    x = pc.x - plat.x > plat.x + plat.w - pc.x ? plat.x + 40 : plat.x + plat.w - 40;
    floor = plat.y;
  }
  const e = makeBoss("nullptr", NULLB.w, NULLB.h, x - NULLB.w / 2, floor - NULLB.h);
  Object.assign(e, { phase: 0, trail: [], decoyCd: 0, revealT: 0, seed: 0, formAt: { x, y: floor }, chainLeft: 0, chainIdx: 0 });
  e.facing = pc.x < x ? -1 : 1;
  // Auto-aim and the off-screen arrow can't find it while it's nowhere, or
  // hiding among its copies
  Object.defineProperty(e, "cloaked", { get: () => e.parked || e.state === "intro" || (e.revealT <= 0 && nullDecoys(e).length > 0) });
  nullPark(e);
  enemies.push(e);
  game.boss = e;
  bossIntro(e, 4.6);
  Object.assign(game.cinematic, { color: NULLB.color, style: "nullptr" });
  e.speech = null; // it talks once it has a body
  nullFx.tear = 0.4;
  nullHeroLine();
}

function nullHeroLine() {
  if (CH().quotes.bossNull) return say("bossNull", null, true);
  player.speech = { text: nullPick(BOSSES.nullptr.heroLines), time: 2.6 };
  player.speechCd = 5;
}

// Fragments of it stream in from everywhere and converge into one figure
function nullConverge(e, count) {
  const f = e.formAt;
  for (let i = 0; i < count; i++) {
    const a = rand(0, Math.PI * 2);
    const d = rand(320, 820);
    nullFx.frags.push({
      x: f.x + Math.cos(a) * d,
      y: f.y - 100 + Math.sin(a) * d * 0.6,
      tx: f.x + rand(-26, 26),
      ty: f.y - rand(6, NULLB.h - 10),
      t: 0,
      dur: rand(0.45, 0.85),
      color: nullPick(["#b06cff", "#b06cff", "#d9c2ff", "#19f5ff", "#ff2fd6"]),
      size: rand(7, 15),
      swirl: rand(-1.2, 1.2),
    });
  }
}

// ---------------------------------------------------------- Being nowhere ----
function nullPark(e) {
  e.parked = true;
  e.vx = e.vy = 0;
  e.y = NULL_PARK_Y;
  e.onGround = false;
  e.standingOn = null;
}

function nullUnpark(e, x, bottom) {
  e.parked = false;
  e.x = clamp(x - e.w / 2, 0, WORLD_W - e.w);
  e.y = bottom - e.h;
  e.vx = e.vy = 0;
}

// damageEnemy asks first: copies pop on any hit, and nothing touches NULL
// during its entrance or while it is between places
function nullIntercept(e) {
  if (bossLocked() || e.parked) return true;
  if (!e.decoy) return false;
  popDecoy(e);
  return true;
}

// ----------------------------------------------------------------- Decoys ---
function makeDecoy(real, x, bottom) {
  const d = makeBoss("nullptr", NULLB.w, NULLB.h, x - NULLB.w / 2, bottom - NULLB.h);
  Object.assign(d, {
    decoy: true,
    owner: real,
    phase: real.phase,
    facing: real.facing,
    trail: [],
    life: NULLB.decoyLife[real.phase],
    attackCd: rand(1.4, 2.8),
    prefSide: Math.random() < 0.5 ? -1 : 1,
    prefDist: rand(260, 560),
    seed: rand(1, 100),
    state: "move",
  });
  enemies.push(d);
  return d;
}

// Split into copies: every figure dashes to its own spot, and the real one
// could end up in any of them (watch the shadow)
function nullSplit(e, n) {
  const ec = centerOf(e);
  const bottom = e.y + e.h;
  const count = n + 1;
  const gap = count > 3 ? 230 : 280;
  const realSlot = Math.floor(Math.random() * count);
  for (let i = 0; i < count; i++) {
    const f = i === realSlot ? e : makeDecoy(e, ec.x, bottom);
    f.slotX = clamp(ec.x + (i - (count - 1) / 2) * gap, 80, WORLD_W - 80);
    f.slotDir = undefined;
    f.facing = f.slotX < ec.x ? -1 : 1;
    nullState(f, "scatter");
  }
  e.revealT = 0;
  nullPixels(ec.x, ec.y, 30, 380);
  ring(ec.x, ec.y, 220, NULLB.color);
  camera.shake = Math.max(camera.shake, 8);
  nullFx.tear = Math.max(nullFx.tear, 0.25);
  nullSound("nullDecoy");
}

function popDecoy(d, quiet) {
  if (d.dead) return;
  d.dead = true;
  const c = centerOf(d);
  nullPixels(c.x, c.y, 26, 420);
  burst(c.x, c.y, 8, "#19f5ff", 300);
  burst(c.x, c.y, 8, "#ff2fd6", 300);
  ring(c.x, c.y, 120, NULLB.color);
  if (quiet) return;
  popup("DECOY", c.x, d.y - 14, "#d9c2ff", 22, 0.8);
  nullSound("nullDecoy");
  gainHeat(3);
  const real = d.owner;
  if (real && !real.dead) {
    real.revealT = NULLB.reveal;
    if (Math.random() < 0.35) bossSay(real, nullPick(BOSSES.nullptr.popLines));
  }
}

// --------------------------------------------------------------- Updates ----
function updateNull(e, dt) {
  e.trail.forEach((t) => (t.t += dt));
  while (e.trail.length && e.trail[0].t > 0.25) e.trail.shift();
  if (e.decoy) updateNullDecoy(e, dt);
  else updateNullReal(e, dt);
}

// bossState, plus forgetting whatever the last attack left lying around
function nullState(e, state) {
  e.aim = null;
  e.leapV2 = 0;
  e.slashed = e.plunging = false;
  if (e.glyph) {
    const i = nullFx.glyphs.indexOf(e.glyph);
    if (i >= 0) nullFx.glyphs.splice(i, 1);
    e.glyph = null;
  }
  bossState(e, state);
}

function nullPhaseCheck(e) {
  const frac = e.hp / e.maxHp;
  const next = frac <= 0.25 ? 2 : frac <= 0.6 ? 1 : 0;
  if (next <= e.phase) return;
  e.phase = next;
  e.enraged = true;
  const ec = centerOf(e);
  nullDecoys(e).forEach((d) => popDecoy(d, true)); // the copies collapse back into it
  nullPixels(ec.x, ec.y, 40, 520);
  ring(ec.x, ec.y, 360, next === 2 ? "#ff2457" : NULLB.color);
  camera.shake = Math.max(camera.shake, 18);
  nullFx.tear = 0.6;
  e.decoyCd = 0;
  if (next === 1) {
    game.banner = { text: "NULL IS NOW MULTITHREADED", time: 2.2, color: NULLB.color };
    bossSay(e, BOSSES.nullptr.hurtLines[0], true);
    nullState(e, "decoy");
  } else {
    game.banner = { text: "STACK OVERFLOW", time: 2.4, color: "#ff2457" };
    bossSay(e, BOSSES.nullptr.hurtLines[1], true);
    e.chainLeft = NULLB.chain - 1;
    e.chainIdx = 0;
    nullState(e, "blink");
  }
}

// Where it can snipe from: a solid rooftop on screen, clearly above you
function findPerch(e) {
  const pc = centerOf(player);
  const feet = player.y + player.h;
  const ec = centerOf(e);
  let best = null;
  let bestD = Infinity;
  for (const p of platforms) {
    if (p.ax || p.ay || p.w < 192) continue;
    const px = p.x + p.w / 2;
    const dx = Math.abs(px - pc.x);
    if (p.y > feet - 220 || p.y < camera.y + 150 || dx < 260 || dx > 950) continue;
    if (px < camera.x + 140 || px > camera.x + W - 140) continue;
    if (e.y + e.h - p.y > 760) continue; // too high to reach
    const d = Math.abs(px - ec.x) + rand(0, 200);
    if (d < bestD) {
      bestD = d;
      best = p;
    }
  }
  return best;
}

// A real double jump onto the perch: the first jump, then a second one at
// its peak, sized to clear the roof edge and drop onto it
function nullLeapTo(e, plat) {
  const G = BOSS_GRAVITY;
  const ec = centerOf(e);
  const tx = clamp(ec.x, plat.x + 60, plat.x + plat.w - 60);
  const rise = e.y + e.h - plat.y + 90;
  const v1 = Math.min(1350, Math.sqrt(2 * G * Math.max(rise, 40)));
  const r1 = (v1 * v1) / (2 * G);
  const v2 = rise > r1 + 1 ? Math.sqrt(2 * G * (rise - r1)) : 0;
  const T = v1 / G + v2 / G + Math.sqrt((2 * 90) / G);
  e.vy = -v1;
  e.vx = (tx - ec.x) / T;
  e.leapV2 = v2;
  e.onGround = false;
  e.airJumps = 0;
  dust(ec.x, e.y + e.h, 12, 1.6);
}

// Where to go when hidden by the smoke: a rooftop, or the far side of you
function nullRelocate(e) {
  const pc = centerOf(player);
  const spots = [];
  for (const p of platforms) {
    if (p.ax || p.ay || p.w < 192) continue;
    const px = p.x + p.w / 2;
    if (px < camera.x + 160 || px > camera.x + W - 160 || p.y < camera.y + 160 || Math.abs(px - pc.x) < 300) continue;
    spots.push({ x: clamp(px + rand(-p.w / 4, p.w / 4), p.x + 40, p.x + p.w - 40), y: p.y });
  }
  for (const s of [-1, 1]) {
    const x = pc.x + s * rand(480, 720);
    if (x > 80 && x < WORLD_W - 80) spots.push({ x, y: surfaceBelow(x, player.y + player.h - 8) });
  }
  const ec = centerOf(e);
  spots.sort((a, b) => Math.abs(b.x - ec.x) - Math.abs(a.x - ec.x));
  return spots.length ? nullPick(spots.slice(0, 3)) : { x: pc.x - 500, y: GROUND_Y };
}

function nullHand(e) {
  return { x: e.x + e.w / 2 + e.facing * 44, y: e.y + 70 };
}
function nullMuzzle(e) {
  return { x: e.x + e.w / 2 + e.facing * 64, y: e.y + 112 };
}

function chooseNullAttack(e) {
  const P = e.phase;
  const decoysUp = nullDecoys(e).length > 0;
  const options = [
    ["fan", 3],
    ["blink", P === 2 ? 4 : 3],
    ["snipe", e.sinceSnipe >= 3 ? 2.6 : 0.7],
    ["decoy", !decoysUp && e.decoyCd <= 0 ? (P ? 3.5 : 2.6) : 0],
    ["smoke", decoysUp ? 0.6 : 1.1],
    ["taunt", 0.25],
  ].filter(([s, w]) => w > 0 && s !== e.lastAttack);
  const next = weightedPick(options);
  e.lastAttack = next;
  e.sinceSnipe = next === "snipe" ? 0 : (e.sinceSnipe || 0) + 1;
  if (next === "blink") {
    e.chainIdx = 0;
    e.chainLeft = P === 2 ? NULLB.chain - 1 : P === 1 && Math.random() < 0.35 ? 1 : 0;
  }
  nullState(e, next);
}

// A blink is done: blink again (a chain), dump core (STACK OVERFLOW), or run
function nullAfterBlink(e) {
  if (e.chainLeft > 0) {
    e.chainLeft--;
    e.chainIdx++;
    nullState(e, "blink");
  } else if (e.chainIdx > 0 && e.phase === 2) {
    e.chainIdx = 0;
    nullState(e, "coredump");
  } else {
    e.chainIdx = 0;
    nullState(e, "move");
  }
}

// The glyph where it will reappear, locked the moment it appears
function nullGlyph(e, above) {
  const pc = centerOf(player);
  let x = pc.x;
  if (!above) {
    let side = -(player.facing || 1); // behind you
    if (pc.x + side * 175 < 60 || pc.x + side * 175 > WORLD_W - 60) side = -side;
    x = pc.x + side * 175;
  }
  const y = surfaceBelow(x, player.y + player.h - 12);
  const g = { x, y, above, top: Math.min(y, player.y - 180), t: 0, tell: NULLB.blinkTell[e.phase], label: e.phase === 2 ? `stack[${e.chainIdx}]` : "" };
  nullFx.glyphs.push(g);
  return g;
}

function nullSlash(e, x, y, r, damage) {
  nullFx.slashes.push({ x, y, r, facing: e.facing, life: 0.22, max: 0.22 });
  nullSound("nullSlash");
  if (!bossLocked()) eachTarget(() => player.camo <= 0 && circleHitsBox(x, y, r, player) && hurtPlayer(damage, e.x + e.w / 2, e.y + e.h / 2, e));
}

function nullShuriken(owner, x, y, a, speed, damage, holo) {
  enemyShots.push({ x, y, vx: Math.cos(a) * speed, vy: Math.sin(a) * speed, r: holo ? 12 : 15, damage, kind: "shuriken", angle: a, life: 3, owner, spin: rand(0, 6), color: "#c99bff", holo: !!holo });
}

function nullFan(e, n, offset) {
  const h = nullHand(e);
  const pc = centerOf(player);
  const aim = Math.atan2(pc.y - h.y, pc.x - h.x);
  const spread = n > 5 ? 1.15 : 0.95;
  const speeds = [560, 780, 650, 900, 600, 840, 720];
  for (let i = 0; i < n; i++) {
    const a = aim + ((i + offset) / (n - 1) - 0.5) * spread;
    nullShuriken(e, h.x, h.y, a, speeds[i % speeds.length] * (1 + 0.06 * e.phase), NULLB.shurikenDamage);
  }
  burst(h.x, h.y, 6, NULLB.color, 240);
  nullSound("nullShuriken");
}

function nullRail(e, m, angle) {
  const ux = Math.cos(angle);
  const uy = Math.sin(angle);
  const len = uy > 0.01 ? Math.min(2800, (GROUND_Y - m.y) / uy) : 2800;
  nullFx.rails.push({ x: m.x, y: m.y, ux, uy, len, head: 0, t: 0, hit: new Set(), owner: e });
  nullSound("nullShot");
  burst(m.x, m.y, 14, "#ffffff", 420);
  camera.shake = Math.max(camera.shake, 12);
}

// Shared by the real one and the copies: dash out to its own spot
function nullScatter(e, dt, stay) {
  const ec = centerOf(e);
  if (e.slotDir === undefined) e.slotDir = Math.sign(e.slotX - ec.x);
  const dir = e.slotDir;
  if (dir && (e.slotX - ec.x) * dir > 12 && e.stateTime < 0.45) {
    e.vx = dir * 1500;
    e.facing = dir;
    if (Math.random() < 0.7) e.trail.push({ x: e.x, y: e.y, frame: 3, facing: e.facing, t: 0 });
  } else {
    e.vx *= Math.exp(-14 * dt);
    if (!stay && e.stateTime > 0.55) nullState(e, "move");
  }
}

// Wall-hop: against the edge of the world, and (while it's backflipping away
// from you) the side of a building, it kicks off and flips back over you
function nullWallHop(e) {
  if (e.onGround) e.wallHops = 0;
  // (two hops per landing at most, or it would climb the wall forever)
  if (e.onGround || e.wallCd > 0 || e.vy < -250 || e.wallHops >= 2 || e.y < WORLD_TOP) return;
  const dir = Math.sign(e.vx) || e.facing;
  let wall = (dir < 0 && e.x <= 1) || (dir > 0 && e.x + e.w >= WORLD_W - 1);
  if (!wall && e.state === "hop") {
    for (const p of platforms) {
      if (!p.roof || e.y + e.h < p.y + 70) continue;
      const wx = dir > 0 ? p.x + 10 : p.x + p.w - 10;
      const edge = dir > 0 ? e.x + e.w : e.x;
      if (Math.abs(edge - wx) < 16) {
        wall = true;
        break;
      }
    }
  }
  if (!wall) return;
  e.vy = -1250;
  e.vx = -dir * 680;
  e.facing = -dir;
  e.airJumps = 1;
  e.wallCd = 0.5;
  e.wallHops = (e.wallHops || 0) + 1;
  e.wallHopCount = (e.wallHopCount || 0) + 1;
  const wx = dir > 0 ? e.x + e.w : e.x;
  burst(wx, e.y + e.h * 0.6, 10, NULLB.color, 260);
  dust(wx, e.y + e.h * 0.7, 6, 1.2);
}

function nullContact(e, damage) {
  eachTarget(() => {
    if (bossLocked() || e.contactCd > 0 || player.camo > 0 || e.parked) return;
    if (!overlaps(e, player)) return;
    const c = centerOf(e);
    if (hurtPlayer(damage, c.x, c.y, nullSrc(e))) e.contactCd = 0.6;
  });
}

function updateNullReal(e, dt) {
  bossTimers(e, dt);
  e.revealT = Math.max(0, e.revealT - dt);
  e.decoyCd -= dt;
  e.wallCd = (e.wallCd || 0) - dt;
  e.evadeCd = (e.evadeCd || 0) - dt;
  const P = e.phase;
  const pc = centerOf(player);
  const ec = centerOf(e);
  const blind = player.camo > 0;
  const decoys = nullDecoys(e);
  if (decoys.length) e.decoyCd = Math.max(e.decoyCd, NULLB.decoyCd);
  if (e.state !== "intro" && !e.parked) nullPhaseCheck(e);
  if (!e.parked && e.y + e.h < WORLD_TOP - 300) {
    nullUnpark(e, clamp(pc.x + 480, 150, WORLD_W - 150), GROUND_Y); // safety net: never lost in the sky
    nullState(e, "move");
  }

  if (e.stun > 0 && !e.parked && e.state !== "intro" && e.state !== "coredump") {
    if (e.state !== "move") {
      e.chainLeft = e.chainIdx = 0;
      nullState(e, "move"); // a stun cancels whatever it was doing
    }
    e.vx *= Math.exp(-8 * dt);
    bossPhysics(e, dt);
    return;
  }

  let gravity = BOSS_GRAVITY;
  let contact = NULLB.contact;
  switch (e.state) {
    case "intro": {
      // (timed with introT: the split resets stateTime)
      contact = 0;
      const t = (e.introT = (e.introT || 0) + dt);
      if (t < 1.0 && nullFx.frags.length < 160) nullConverge(e, 6);
      if (!e.formed && t >= 1.5) {
        // the fragments become a body
        e.formed = true;
        nullUnpark(e, e.formAt.x, e.formAt.y);
        e.formT = t;
        nullFx.frags.length = 0;
        ring(e.formAt.x, e.formAt.y - NULLB.h / 2, 300, NULLB.color);
        ring(e.formAt.x, e.formAt.y - NULLB.h / 2, 160, "#ffffff");
        burst(e.formAt.x, e.formAt.y - NULLB.h / 2, 30, NULLB.color, 520);
        camera.shake = Math.max(camera.shake, 16);
        game.landFlash = 0.18;
        nullFx.tear = 0.35;
        nullSound("bossIntro");
        vibrate([40, 30, 80]);
        bossSay(e, BOSSES.nullptr.taunts[0], true);
      }
      if (e.formed && !e.split && t >= 3.1) {
        e.split = true;
        nullSplit(e, NULLB.decoys[0]); // ...and then there were three
        e.state = "intro"; // it stays in its entrance until the card is done
      }
      if (e.split) nullScatter(e, dt, true);
      if (e.formed && !bossLocked()) nullState(e, "move");
      break;
    }
    case "scatter": {
      contact = 0;
      nullScatter(e, dt);
      break;
    }
    case "move": {
      const pref = [480, 420, 360][P];
      let side = ec.x < pc.x ? -1 : 1;
      if (pc.x + side * pref < 150 || pc.x + side * pref > WORLD_W - 150) side = -side; // cornered: get round you
      const targetX = blind ? clamp(ec.x + e.facing * 200, 150, WORLD_W - 150) : pc.x + side * pref;
      bossNavigate(e, dt, targetX, NULLB.speed[P]);
      const close = Math.abs(pc.x - ec.x) < 170 && Math.abs(pc.y - ec.y) < 170;
      if (!blind && close && e.onGround && e.evadeCd <= 0) {
        e.hopDir = -Math.sign(pc.x - ec.x || 1);
        nullState(e, "hop");
        break;
      }
      if (navBusy(e)) {
        // (mid-route: no style hops, the jump is planned)
      } else if (e.onGround && Math.random() < dt * 0.45) bossJump(e, 1150); // style hops...
      else if (!e.onGround && e.vy > -150 && e.airJumps > 0 && Math.random() < dt * 0.8) bossJump(e, 1000); // ...and double jumps
      if (!blind && e.stateTime > NULLB.think[P] && e.onGround) chooseNullAttack(e);
      else if (Math.random() < dt * 0.1) bossTaunt(e);
      break;
    }
    case "hop": {
      // a backflip away from you
      if (e.step === 0) {
        e.step = 1;
        e.vy = -1150;
        e.vx = e.hopDir * 720;
        e.onGround = false;
        e.facing = -e.hopDir;
        e.evadeCd = 2.4;
        dust(ec.x, e.y + e.h, 8, 1.4);
      } else if (e.onGround && e.stateTime > 0.12) nullState(e, "move");
      contact = 0;
      break;
    }
    case "decoy": {
      // a crouch, a glitch charge, then it splits
      e.vx *= Math.exp(-12 * dt);
      contact = 0;
      if (Math.random() < 0.6) nullPixels(ec.x + rand(-40, 40), ec.y + rand(-80, 80), 1, 120);
      if (e.stateTime > 0.4) nullSplit(e, NULLB.decoys[P]);
      break;
    }
    case "blink": {
      contact = 0;
      if (e.step === 0) {
        // dissolve into pixels...
        e.vx *= Math.exp(-14 * dt);
        if (!e.timer) {
          e.timer = 1;
          nullSound("nullBlink");
          nullPixels(ec.x, ec.y, 22, 260, -260);
        }
        if (e.stateTime > (e.chainIdx ? 0.16 : 0.28)) {
          // ...and a glyph shows where it will reappear
          const above = e.chainLeft || e.chainIdx ? e.chainIdx % 2 === 1 : Math.random() < (P ? 0.4 : 0.3);
          e.glyph = nullGlyph(e, above);
          nullPark(e);
          e.step = 1;
          e.timer = 0;
        }
      } else if (e.step === 1) {
        e.timer += dt;
        const g = e.glyph;
        if (!g) {
          nullUnpark(e, pc.x + 500, surfaceBelow(pc.x + 500, player.y + player.h - 8)); // never stuck nowhere
          nullState(e, "move");
        } else if (e.timer >= g.tell) {
          if (g.above) {
            nullUnpark(e, g.x, g.top);
            e.step = 3;
          } else {
            nullUnpark(e, g.x, g.y);
            e.step = 2;
          }
          faceThePlayer(e);
          e.timer = 0;
          nullFx.glyphs.splice(nullFx.glyphs.indexOf(g), 1);
          e.glyph = null;
          nullPixels(g.x, e.y + e.h / 2, 16, 200);
        }
      } else if (e.step === 2) {
        // behind you: a beat to blink in, then the slash
        e.timer += dt;
        if (e.timer < 0.12) e.vx = 0;
        else if (!e.slashed) {
          e.slashed = true;
          nullSlash(e, ec.x + e.facing * 70, ec.y - 10, 150, NULLB.slashDamage);
          e.vx = e.facing * 650;
        } else {
          e.vx *= Math.exp(-10 * dt);
          if (e.timer > (e.chainLeft ? 0.3 : 0.6)) nullAfterBlink(e);
        }
      } else if (e.step === 3) {
        // above you: hang for a beat, then plunge
        e.timer += dt;
        if (e.timer < 0.14) {
          e.vy = 0;
          gravity = 0;
        } else {
          if (!e.plunging) {
            e.plunging = true;
            e.vy = 2600;
            nullSound("nullSlash");
          }
          gravity = 4200;
          contact = NULLB.plungeDamage;
          if (e.onGround) {
            nullSlash(e, ec.x, e.y + e.h - 50, 140, NULLB.plungeDamage);
            ring(ec.x, e.y + e.h, 160, NULLB.color);
            dust(ec.x, e.y + e.h, 14, 1.8);
            camera.shake = Math.max(camera.shake, 10);
            e.step = 4;
            e.timer = 0;
          }
        }
      } else {
        e.vx *= Math.exp(-12 * dt);
        e.timer += dt;
        if (e.timer > (e.chainLeft ? 0.25 : 0.5)) nullAfterBlink(e);
      }
      break;
    }
    case "coredump": {
      // STACK OVERFLOW unwinds: it kneels, leaking pixels, wide open
      e.vx *= Math.exp(-10 * dt);
      contact = 0;
      if (e.step === 0) {
        e.step = 1;
        e.vulnT = Math.max(e.vulnT, NULLB.coreDump);
        popup("CORE DUMPED", clamp(ec.x, camera.x + 200, camera.x + W - 200), Math.max(e.y - 40, camera.y + 200), "#ffe14d", 28, 1.2);
        if (Math.random() < 0.6) bossSay(e, "Segmentation fault (core dumped).", true);
      }
      if (Math.random() < 0.5) nullPixels(ec.x + rand(-30, 30), ec.y + rand(-60, 40), 1, 160, -200);
      if (e.stateTime > NULLB.coreDump) nullState(e, "move");
      break;
    }
    case "fan": {
      e.vx *= Math.exp(-12 * dt);
      const tell = NULLB.fanTell[P];
      if (e.step === 0) faceThePlayer(e);
      if (e.step === 0 && e.stateTime > tell) {
        e.step = 1;
        if (!blind) nullFan(e, NULLB.fan[P], 0);
      }
      if (e.step === 1 && P === 2 && e.stateTime > tell + 0.3) {
        e.step = 2;
        if (!blind) nullFan(e, NULLB.fan[P], 0.5); // a second wave, into the gaps
      }
      if (e.stateTime > tell + (P === 2 ? 0.75 : 0.45)) nullState(e, "move");
      break;
    }
    case "snipe": {
      if (e.step === 0) {
        if (!e.onGround && e.stateTime < 0.8) break; // land first
        const high = !e.standingOn || e.standingOn.ground ? false : e.y + e.h < player.y + player.h - 200;
        const perch = !high && e.onGround ? findPerch(e) : null;
        if (perch) {
          nullLeapTo(e, perch);
          e.step = 1;
        } else {
          e.step = 2;
          e.timer = 0;
        }
      } else if (e.step === 1) {
        if (e.leapV2 && e.vy >= 0) {
          e.vy = -e.leapV2; // the second jump, at the top of the first
          e.leapV2 = 0;
          nullPixels(ec.x, e.y + e.h, 8, 200);
          dust(ec.x, e.y + e.h, 6, 1.2);
        }
        if (e.onGround && e.stateTime > 0.25) {
          e.step = 2;
          e.timer = 0;
          e.vx = 0;
        }
      } else if (e.step === 2) {
        // crouch and aim: the line tracks you, then locks
        e.vx *= Math.exp(-14 * dt);
        e.timer += dt;
        if (!e.aim) {
          e.aim = { angle: 0, locked: false, charge: 0 };
          nullSound("nullCharge");
        }
        if (e.timer < NULLB.aim[P]) {
          faceThePlayer(e);
          const m = nullMuzzle(e);
          e.aim.angle = Math.atan2(pc.y - m.y, pc.x - m.x);
        } else e.aim.locked = true;
        e.aim.charge = Math.min(1, e.timer / (NULLB.aim[P] + NULLB.lock));
        if (blind) nullState(e, "move");
        else if (e.timer >= NULLB.aim[P] + NULLB.lock) {
          nullRail(e, nullMuzzle(e), e.aim.angle);
          e.aim = null;
          e.step = 3;
          e.timer = 0;
          e.vx = -e.facing * 240; // recoil
        }
      } else {
        e.timer += dt;
        e.vx *= Math.exp(-8 * dt);
        if (e.timer > 0.7) nullState(e, "move");
      }
      break;
    }
    case "smoke": {
      contact = 0;
      if (e.step === 0) {
        e.vx *= Math.exp(-12 * dt);
        if (e.stateTime > 0.22) {
          nullSmoke(ec.x, e.y + e.h, 1);
          const leftBehind = { x: ec.x, y: e.y + e.h };
          e.dest = nullRelocate(e);
          nullPark(e);
          nullSound("nullBlink");
          // enraged, it leaves a copy in the smoke: which one walked out?
          if (P >= 1 && nullDecoys(e).length < NULLB.decoys[P]) makeDecoy(e, leftBehind.x, leftBehind.y);
          e.step = 1;
          e.timer = 0;
        }
      } else if (e.step === 1) {
        e.timer += dt;
        if (e.timer > 0.65) {
          nullUnpark(e, e.dest.x, e.dest.y);
          nullSmoke(e.dest.x, e.dest.y, 0.45);
          faceThePlayer(e);
          e.step = 2;
          e.timer = 0;
        }
      } else {
        e.timer += dt;
        if (e.timer > 0.3) {
          const high = e.standingOn && !e.standingOn.ground && e.y + e.h < player.y + player.h - 200;
          const next = high ? "snipe" : Math.random() < 0.6 ? "fan" : "move";
          e.lastAttack = next;
          if (next === "snipe") e.sinceSnipe = 0;
          nullState(e, next);
        }
      }
      break;
    }
    case "taunt": {
      e.vx *= Math.exp(-12 * dt);
      faceThePlayer(e);
      if (e.step === 0) {
        e.step = 1;
        e.speechCd = 0;
        bossTaunt(e);
      }
      if (e.stateTime > 0.8) nullState(e, "move");
      break;
    }
  }
  if (e.parked && e.state !== "intro" && e.state !== "blink" && e.state !== "smoke") {
    nullUnpark(e, clamp(pc.x + 480, 150, WORLD_W - 150), surfaceBelow(clamp(pc.x + 480, 150, WORLD_W - 150), player.y + player.h - 8)); // only those two bring it back
  }
  if (e.parked) return;
  bossPhysics(e, dt, gravity);
  nullWallHop(e);
  if (contact) nullContact(e, contact);
}

function updateNullDecoy(d, dt) {
  bossTimers(d, dt);
  d.life -= dt;
  d.wallCd = (d.wallCd || 0) - dt;
  const real = d.owner;
  const pc = centerOf(player);
  const blind = player.camo > 0;
  if ((real.dead || d.life <= 0 || d.y + d.h < WORLD_TOP - 300) && d.state !== "fade") nullState(d, "fade");
  let contact = 0;
  switch (d.state) {
    case "scatter":
      nullScatter(d, dt);
      break;
    case "fade": {
      d.vx *= Math.exp(-10 * dt);
      if (d.stateTime > 0.45) {
        d.dead = true;
        const c = centerOf(d);
        nullPixels(c.x, c.y, 14, 200, -200);
      }
      break;
    }
    case "move": {
      if (bossLocked()) {
        d.vx *= Math.exp(-10 * dt);
        faceThePlayer(d);
        break;
      }
      const dc = centerOf(d);
      const targetX = clamp(blind ? dc.x + d.facing * 200 : pc.x + d.prefSide * d.prefDist, 150, WORLD_W - 150);
      bossNavigate(d, dt, targetX, NULLB.speed[real.phase] * 0.92);
      if (d.onGround && Math.random() < dt * 0.4) bossJump(d, 1100);
      if (Math.random() < dt * 0.12) d.prefSide *= -1; // keep flanking you
      d.attackCd -= dt;
      if (!blind && d.attackCd <= 0 && d.onGround && real.state !== "intro") {
        nullState(d, Math.random() < 0.55 ? "toss" : "lunge");
        d.attackCd = rand(2.4, 3.8);
      }
      break;
    }
    case "toss": {
      d.vx *= Math.exp(-12 * dt);
      faceThePlayer(d);
      if (d.step === 0 && d.stateTime > 0.4) {
        d.step = 1;
        const h = nullHand(d);
        const a = Math.atan2(pc.y - h.y, pc.x - h.x);
        nullShuriken(real, h.x, h.y, a - 0.09, 480, NULLB.decoyShuriken, true);
        nullShuriken(real, h.x, h.y, a + 0.09, 620, NULLB.decoyShuriken, true);
        nullSound("nullShuriken");
      }
      if (d.stateTime > 0.7) nullState(d, "move");
      break;
    }
    case "lunge": {
      if (d.step === 0) {
        d.vx *= Math.exp(-12 * dt);
        faceThePlayer(d);
        if (d.stateTime > 0.42) {
          d.step = 1;
          d.timer = 0.22;
        }
      } else if (d.step === 1) {
        d.vx = d.facing * 1100;
        contact = NULLB.decoyLunge;
        if (Math.random() < 0.6) d.trail.push({ x: d.x, y: d.y, frame: 9, facing: d.facing, t: 0 });
        d.timer -= dt;
        if (d.timer <= 0) {
          d.step = 2;
          d.timer = 0.3;
        }
      } else {
        d.vx *= Math.exp(-10 * dt);
        d.timer -= dt;
        if (d.timer <= 0) nullState(d, "move");
      }
      break;
    }
  }
  if (d.dead) return;
  bossPhysics(d, dt);
  nullWallHop(d);
  if (contact) nullContact(d, contact);
}

// ------------------------------------------------------------- Defeat -------
function nullDefeated(e) {
  director.stage = STAGE.interlude2;
  director.nextBossAt = game.time + TUNING.boss.nullDelay;
  game.boss = null;
  game.bossesDefeated = (game.bossesDefeated || 0) + 1;
  game.slowmo = { time: 1.3, scale: 0.25 };
  game.banner = { text: "NULL DEREFERENCED", time: 1.6, color: NULLB.color };
  music.setIntensity(1);
  nullDecoys(e).forEach((d) => popDecoy(d, true));
  enemyShots.length = 0;
  shockwaves.length = 0;
  nullFx.rails.length = nullFx.glyphs.length = nullFx.slashes.length = nullFx.smoke.length = 0;
  nullFx.death = { x: e.x, y: e.y, w: e.w, h: e.h, facing: e.facing, t: 0, rewarded: false };
  nullFx.tear = 0.5;
  nullSound("nullDeath");
  forEachPlayer(() => (player.invuln = Math.max(player.invuln, 2)));
  popup("free(me);", e.x + e.w / 2, e.y - 30, "#d9c2ff", 24, 1.4);
}

// The reward, once it has dissolved: a life back (or a big heal) and the
// RARE CACHE, which makes every card of your next level-up rare
function nullReward() {
  const p = player;
  const pc = centerOf(p);
  let what;
  if (game.lives < MAX_LIVES) {
    game.lives++;
    what = "+1 LIFE";
  } else {
    const heal = Math.round(stats.maxHp * 0.6);
    eachTarget(() => (player.hp = Math.min(stats.maxHp, player.hp + heal))); // (the whole team)
    what = `+${heal} HP`;
  }
  progress.rareCache = true;
  game.banner = { text: `NULL FREED // ${what} // RARE CACHE`, time: 3.2, color: NULLB.color };
  game.toast = { text: "RARE CACHE: EVERY CARD OF YOUR NEXT LEVEL-UP IS RARE", time: 4.5 };
  popup(what, pc.x, p.y - 40, "#5aff7a", 30, 1.6);
  ring(pc.x, pc.y, 220, NULLB.color);
  burst(pc.x, pc.y, 30, NULLB.color, 420);
  nullSound("bossDefeated");
}

// ----------------------------------------------------- Effects (world) ------
function nullPixels(x, y, n, speed, lift = 0) {
  for (let i = 0; i < n && nullFx.pixels.length < 320; i++) {
    const a = rand(0, Math.PI * 2);
    const s = speed * rand(0.2, 1);
    nullFx.pixels.push({ x: x + rand(-20, 20), y: y + rand(-30, 30), vx: Math.cos(a) * s, vy: Math.sin(a) * s + lift, life: rand(0.35, 0.8), max: 0.8, size: rand(3, 8), color: nullPick(["#b06cff", "#b06cff", "#d9c2ff", "#19f5ff", "#ff2fd6"]) });
  }
}

function nullSmoke(x, y, size) {
  const puffs = [];
  for (let i = 0; i < 11; i++) puffs.push({ dx: rand(-1, 1) * 150 * size, dy: -rand(0, 1) * 220 * size, r: rand(70, 120) * size, drift: rand(-30, 30) });
  nullFx.smoke.push({ x, y, t: 0, life: size > 0.6 ? 2.4 : 1.1, puffs });
}

function updateNullFx(dt) {
  nullFx.tear = Math.max(0, nullFx.tear - dt);
  for (let i = nullFx.frags.length - 1; i >= 0; i--) if ((nullFx.frags[i].t += dt) >= nullFx.frags[i].dur) nullFx.frags.splice(i, 1);
  for (let i = nullFx.pixels.length - 1; i >= 0; i--) {
    const p = nullFx.pixels[i];
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.vx *= Math.exp(-3 * dt);
    p.vy *= Math.exp(-3 * dt);
    if ((p.life -= dt) <= 0) nullFx.pixels.splice(i, 1);
  }
  for (let i = nullFx.smoke.length - 1; i >= 0; i--) if ((nullFx.smoke[i].t += dt) >= nullFx.smoke[i].life) nullFx.smoke.splice(i, 1);
  for (let i = nullFx.slashes.length - 1; i >= 0; i--) if ((nullFx.slashes[i].life -= dt) <= 0) nullFx.slashes.splice(i, 1);
  nullFx.glyphs.forEach((g) => {
    g.t += dt;
    if (Math.random() < 0.4) nullFx.pixels.push({ x: g.x + rand(-60, 60), y: g.y - 4, vx: 0, vy: rand(-220, -120), life: 0.5, max: 0.5, size: rand(3, 6), color: "#c99bff" });
  });
  // The rail: a fast head along the locked line. It pierces, so it keeps going
  for (let i = nullFx.rails.length - 1; i >= 0; i--) {
    const r = nullFx.rails[i];
    const from = r.head;
    r.head = Math.min(r.len, r.head + NULLB.railSpeed * dt);
    r.t += dt;
    // it pierces: each player can be hit once (r.hit: the players it got)
    eachTarget(() => {
      if (r.hit.has(player) || bossLocked() || player.camo > 0) return;
      const pc = centerOf(player);
      const along = clamp((pc.x - r.x) * r.ux + (pc.y - r.y) * r.uy, from, r.head);
      const nx = r.x + r.ux * along;
      const ny = r.y + r.uy * along;
      if (circleHitsBox(nx, ny, 16, player)) {
        r.hit.add(player);
        hurtPlayer(NULLB.railDamage, r.x, r.y, r.owner);
      }
    });
    if (r.head >= r.len && !r.sparked) {
      r.sparked = true;
      burst(r.x + r.ux * r.len, Math.min(GROUND_Y, r.y + r.uy * r.len), 10, "#d9c2ff", 320);
    }
    if (r.t > 0.75) nullFx.rails.splice(i, 1);
  }
  const d = nullFx.death;
  if (d) {
    d.t += dt;
    if (Math.random() < 0.8) nullPixels(d.x + rand(0, d.w), d.y + rand(0, d.h), 2, 160, -240);
    if (!d.rewarded && d.t > 1.0) {
      d.rewarded = true;
      nullFx.cache = { x: d.x + d.w / 2, y: d.y + d.h / 2, t: 0 };
      nullReward();
    }
    if (d.t > 1.6) nullFx.death = null;
  }
  const c = nullFx.cache;
  if (c) {
    // the RARE CACHE chip flies to you
    c.t += dt;
    const pc = centerOf(player);
    const k = Math.min(1, dt * 6);
    c.x += (pc.x - c.x) * k;
    c.y += (pc.y - c.y) * k;
    if (c.t > 1.2) nullFx.cache = null;
  }
}

function resetNull() {
  nullFx.frags.length = nullFx.pixels.length = nullFx.smoke.length = nullFx.rails.length = nullFx.slashes.length = nullFx.glyphs.length = 0;
  nullFx.tear = 0;
  nullFx.death = nullFx.cache = null;
}

// ------------------------------------------------------------- Drawing ------
const nullImg = () => (isReady(IMG.nullBoss) ? IMG.nullBoss : IMG.nullFallback);

function nullFrame(e) {
  switch (e.state) {
    case "intro":
      return e.introT - (e.formT || 0) < 0.35 ? 8 : Math.abs(e.vx) > 60 ? 2 + (Math.floor(e.anim * 12) % 4) : Math.floor(e.anim * 2) % 2;
    case "decoy":
      return 8;
    case "blink":
      return e.step === 0 ? 7 : e.step === 2 ? (e.timer < 0.12 ? 8 : 9) : e.step === 3 ? (e.plunging ? 9 : 8) : 9;
    case "coredump":
      return 12;
    case "fan":
      return 10;
    case "snipe":
      return e.step === 1 ? 6 : 11;
    case "smoke":
      return e.step === 0 ? 10 : 8;
    case "toss":
      return e.step ? 10 : 0;
    case "lunge":
      return e.step === 0 ? 8 : 9;
    case "taunt":
      return 9;
    case "fade":
      return 7;
  }
  if (e.stun > 0) return 12;
  if (!e.onGround) return 6;
  if (e.hurt > 0.08) return 12;
  if (Math.abs(e.vx) > 60) return 2 + (Math.floor(e.anim * 12) % 4);
  return Math.floor(e.anim * 2) % 2;
}

// 0 = solid, 1 = gone: how far through a pixel dissolve it is
function nullDissolve(e) {
  if (e.state === "blink" && e.step === 0) return clamp(e.stateTime / (e.chainIdx ? 0.16 : 0.28), 0, 1);
  if (e.state === "blink" && (e.step === 2 || e.step === 3) && e.timer < 0.12) return 1 - e.timer / 0.12;
  if (e.state === "smoke" && e.step === 0) return clamp((e.stateTime - 0.1) / 0.12, 0, 1);
  if (e.state === "smoke" && e.step === 2) return clamp(1 - e.timer / 0.15, 0, 1);
  if (e.state === "fade") return clamp(e.stateTime / 0.45, 0, 1);
  if (e.state === "intro" && e.formT !== undefined) return clamp(1 - (e.introT - e.formT) / 0.25, 0, 1);
  return 0;
}

// Pseudo-random but stable per band, so the dissolve doesn't shimmer
const nullHash = (n) => {
  const s = Math.sin(n * 91.7 + 13.3) * 43758.5453;
  return s - Math.floor(s);
};

// Draw a frame in horizontal bands that slide apart and drop out
function drawNullBands(img, frame, dx, dy, dw, dh, flip, k, seed) {
  if (!isReady(img)) return;
  const rows = 24;
  const sh = 96 / rows;
  const s = dh / 96;
  ctx.imageSmoothingEnabled = false;
  const base = ctx.globalAlpha;
  for (let i = 0; i < rows; i++) {
    const r = nullHash(i + seed * 7);
    if (k >= 0.15 + r * 0.85) continue;
    const off = (nullHash(i * 3.1 + seed) - 0.5) * 2 * k * 70;
    ctx.globalAlpha = base * (1 - k * 0.5);
    const y = dy + i * sh * s;
    if (flip) {
      ctx.save();
      ctx.translate(dx + off + dw, 0);
      ctx.scale(-1, 1);
      ctx.drawImage(img, frame * 64, i * sh, 64, sh, 0, y, dw, sh * s);
      ctx.restore();
    } else ctx.drawImage(img, frame * 64, i * sh, 64, sh, dx + off, y, dw, sh * s);
  }
  ctx.globalAlpha = base;
}

function nullShadow(e) {
  const cx = e.x + e.w / 2;
  const feet = e.y + e.h;
  const sy = surfaceBelow(cx, feet - 4);
  const k = clamp(1 - (sy - feet) / 600, 0.25, 1);
  ctx.fillStyle = `rgba(0,0,0,${0.62 * k})`;
  ctx.beginPath();
  ctx.ellipse(cx, sy - 3, 64 * k, 13 * k, 0, 0, Math.PI * 2);
  ctx.fill();
}

function drawEmptySet(x, y, r, color, width) {
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.moveTo(x - r * 1.25, y + r * 1.25);
  ctx.lineTo(x + r * 1.25, y - r * 1.25);
  ctx.stroke();
}

function drawNull(e, time) {
  if (e.parked) return;
  const real = !e.decoy;
  const img = nullImg();
  const s = NULLB.scale;
  const dw = 64 * s;
  const dh = 96 * s;
  const cx = e.x + e.w / 2;
  const dx = cx - dw / 2;
  const dy = e.y + e.h - 95 * s;
  const frame = nullFrame(e);
  const flip = e.facing < 0;
  const seed = e.seed || 0;

  // Tell #1: only the real one casts a shadow
  if (real) nullShadow(e);
  // Telegraphs
  if (e.state === "fan" && e.step === 0) {
    const h = nullHand(e);
    const k = Math.min(1, e.stateTime / NULLB.fanTell[e.phase]);
    glow(h.x, h.y, 30 + 40 * k, "rgba(220,190,255,0.95)");
    drawShurikenShape(h.x, h.y, 10 + 8 * k, time * 14, "#ffffff");
  }
  if (e.state === "toss" && e.step === 0) glow(nullHand(e).x, nullHand(e).y, 34, "rgba(200,160,255,0.7)");
  if ((e.state === "lunge" || e.state === "decoy") && e.step === 0) glow(cx, e.y + e.h * 0.55, 90, "rgba(176,108,255,0.7)", 0.5 + 0.5 * Math.sin(time * 40));
  if (real && e.aim) drawNullAim(e, time);
  decorGlow(cx, e.y + e.h * 0.5, 150, e.phase === 2 ? "rgba(255,30,80,0.3)" : "rgba(140,70,255,0.25)"); // copies too: no free tells

  // Dash afterimages
  e.trail.forEach((t) => {
    ctx.globalAlpha = 0.3 * (1 - t.t / 0.25);
    drawFrame(img, t.frame * 64, 0, 64, 96, t.x + e.w / 2 - dw / 2, t.y + e.h - 95 * s, dw, dh, "rgba(176,108,255,0.85)", t.facing < 0);
  });
  ctx.globalAlpha = 1;

  let tint = null;
  if (e.hurt > 0) tint = "rgba(255,255,255,0.8)";
  else if (e.stun > 0) tint = "rgba(176,108,255,0.5)";
  else if (e.state === "coredump") tint = `rgba(255,225,77,${0.25 + 0.2 * Math.sin(time * 18)})`;
  else if ((e.state === "lunge" || e.state === "decoy") && e.step === 0) tint = `rgba(255,47,214,${0.25 + 0.25 * Math.sin(time * 50)})`;

  let alpha = 1;
  let jitter = 0;
  if (e.decoy) {
    // Tells #2 and #3: copies flicker (now and then they drop out) and have
    // a faint RGB split
    const n = Math.sin(time * 23 + seed * 7) + Math.sin(time * 37.7 + seed * 3);
    alpha = n > 1.55 ? 0.3 : 0.86 + 0.08 * Math.sin(time * 11 + seed);
    if (Math.sin(time * 5.3 + seed) > 0.93) jitter = rand(-6, 6);
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    ctx.globalAlpha = 0.3 * alpha;
    drawFrame(img, frame * 64, 0, 64, 96, dx - 5 + jitter, dy, dw, dh, "rgba(255,30,90,1)", flip);
    drawFrame(img, frame * 64, 0, 64, 96, dx + 5 + jitter, dy, dw, dh, "rgba(30,240,255,1)", flip);
    ctx.restore();
  } else if (Math.sin(time * 1.7) * Math.sin(time * 13) > 0.985) jitter = rand(-3, 3); // the real one barely glitches

  const k = nullDissolve(e);
  ctx.globalAlpha = alpha;
  if (k > 0) drawNullBands(img, frame, dx + jitter, dy, dw, dh, flip, k, seed);
  else drawFrame(img, frame * 64, 0, 64, 96, dx + jitter, dy, dw, dh, tint, flip);
  ctx.globalAlpha = 1;

  // Popping a copy reveals the real one for a moment
  if (real && e.revealT > 0) {
    const a = Math.min(1, e.revealT / 0.4);
    glow(cx, e.y + e.h * 0.5, 170, "rgba(255,255,255,0.35)", a);
    const y = e.y - 30 + Math.sin(time * 8) * 6;
    ctx.globalAlpha = a;
    ctx.fillStyle = "#ffffff";
    ctx.beginPath();
    ctx.moveTo(cx - 16, y - 18);
    ctx.lineTo(cx + 16, y - 18);
    ctx.lineTo(cx, y);
    ctx.closePath();
    ctx.fill();
    hudText("REAL", cx, y - 42, 18, "#ffffff", "center", "middle");
    ctx.globalAlpha = 1;
  }
  if (real) drawBossSpeech(e, NULLB.color);
}

// The rail's aim line: thin and tracking, then white and solid once locked
function drawNullAim(e, time) {
  const m = nullMuzzle(e);
  const a = e.aim.angle;
  const uy = Math.sin(a);
  const len = uy > 0.01 ? Math.min(2800, (GROUND_Y - m.y) / uy) : 2800;
  const ex = m.x + Math.cos(a) * len;
  const ey = m.y + uy * len;
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  ctx.lineCap = "round";
  const layers = e.aim.locked
    ? [
        [16, "rgba(176,108,255,0.45)"],
        [5, "rgba(255,255,255,0.95)"],
      ]
    : [[2 + e.aim.charge * 2, `rgba(200,120,255,${0.45 + 0.3 * Math.sin(time * 30)})`]];
  layers.forEach(([w, color]) => {
    ctx.strokeStyle = color;
    ctx.lineWidth = w;
    ctx.beginPath();
    ctx.moveTo(m.x, m.y);
    ctx.lineTo(ex, ey);
    ctx.stroke();
  });
  ctx.restore();
  glow(m.x, m.y, 20 + 50 * e.aim.charge, e.aim.locked ? "rgba(255,255,255,0.95)" : "rgba(190,120,255,0.9)");
}

function drawShurikenShape(x, y, r, angle, color) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  ctx.fillStyle = color;
  ctx.beginPath();
  for (let i = 0; i < 8; i++) {
    const rr = i % 2 ? r * 0.32 : r;
    const t = (i * Math.PI) / 4;
    ctx.lineTo(Math.cos(t) * rr, Math.sin(t) * rr);
  }
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = "#1a0f2e";
  ctx.fillRect(-2, -2, 4, 4);
  ctx.restore();
}

// Drawn by drawEnemyShots for kind "shuriken"
function drawShuriken(s) {
  glow(s.x, s.y, s.holo ? 26 : 38, "rgba(176,108,255,0.75)");
  const a = game.time * 24 + s.spin;
  if (s.holo) {
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    ctx.globalAlpha = 0.45;
    drawShurikenShape(s.x - 3, s.y, s.r * 1.3, a, "#ff2f6d");
    drawShurikenShape(s.x + 3, s.y, s.r * 1.3, a, "#19f5ff");
    ctx.restore();
    ctx.globalAlpha = 0.75;
  }
  drawShurikenShape(s.x, s.y, s.r * 1.3, a, "#ece0ff");
  ctx.globalAlpha = 1;
}

let smokePuff = null;
function nullSmokeSprite() {
  if (smokePuff) return smokePuff;
  smokePuff = document.createElement("canvas");
  smokePuff.width = smokePuff.height = 64;
  const g = smokePuff.getContext("2d");
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, "rgba(96,80,124,0.95)");
  grad.addColorStop(0.55, "rgba(58,44,82,0.85)");
  grad.addColorStop(1, "rgba(30,20,48,0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  return smokePuff;
}

// World-space effects that live outside the boss: the entrance fragments,
// glyphs, smoke, slashes, rails, pixels and the death
function drawNullFx(time) {
  const F = nullFx;
  if (!F.frags.length && !F.pixels.length && !F.smoke.length && !F.rails.length && !F.slashes.length && !F.glyphs.length && !F.death && !F.cache) return;
  // Glyphs: where it will reappear
  F.glyphs.forEach((g) => {
    const k = clamp(g.t / g.tell, 0, 1);
    const pulse = 0.6 + 0.4 * Math.sin(time * 30);
    const pillar = ctx.createLinearGradient(0, g.y, 0, g.y - 260);
    pillar.addColorStop(0, `rgba(176,108,255,${0.25 + 0.35 * k})`);
    pillar.addColorStop(1, "rgba(176,108,255,0)");
    ctx.fillStyle = pillar;
    ctx.fillRect(g.x - 36, g.y - 260, 72, 260);
    glow(g.x, g.y - 8, 90 + 60 * k, "rgba(176,108,255,0.85)", 0.5 + 0.5 * k);
    ctx.save();
    ctx.translate(g.x, g.y - 6);
    ctx.scale(1, 0.3);
    ctx.globalAlpha = 0.55 + 0.45 * k * pulse;
    drawEmptySet(0, 0, 70 - 14 * k, k > 0.75 ? "#ffffff" : "#c99bff", 9);
    ctx.rotate(time * 3);
    ctx.strokeStyle = "#c99bff";
    ctx.lineWidth = 4;
    ctx.setLineDash([14, 18]);
    ctx.beginPath();
    ctx.arc(0, 0, 96, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
    ctx.setLineDash([]);
    if (g.above) {
      // it will drop from up there
      ctx.globalAlpha = 0.5 + 0.5 * k * pulse;
      drawEmptySet(g.x, g.top - NULLB.h * 0.6, 34, "#c99bff", 6);
      ctx.fillStyle = "#c99bff";
      for (let i = 0; i < 3; i++) {
        const ay = g.top - 40 + i * 50 + ((time * 120) % 50);
        if (ay > g.y - 30) continue;
        ctx.beginPath();
        ctx.moveTo(g.x - 18, ay - 12);
        ctx.lineTo(g.x + 18, ay - 12);
        ctx.lineTo(g.x, ay + 8);
        ctx.closePath();
        ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
    if (g.label) hudText(g.label, g.x, g.y - 290, 18, "#ff6b9a", "center", "middle");
  });
  // Rails
  F.rails.forEach((r) => {
    const fade = 1 - r.t / 0.75;
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    ctx.lineCap = "round";
    ctx.strokeStyle = `rgba(176,108,255,${0.5 * fade})`;
    ctx.lineWidth = 22 * fade + 2;
    ctx.beginPath();
    ctx.moveTo(r.x, r.y);
    ctx.lineTo(r.x + r.ux * r.head, r.y + r.uy * r.head);
    ctx.stroke();
    ctx.strokeStyle = `rgba(255,255,255,${0.95 * fade})`;
    ctx.lineWidth = 6 * fade + 1;
    ctx.stroke();
    ctx.restore();
    glow(r.x + r.ux * r.head, r.y + r.uy * r.head, 50 * fade + 10, "rgba(255,255,255,0.9)");
  });
  // Slashes: violet crescents
  F.slashes.forEach((s) => {
    const k = 1 - s.life / s.max;
    const a0 = s.facing > 0 ? -1.3 : Math.PI - 1.3;
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    ctx.lineCap = "round";
    [
      [22 * (1 - k) + 6, `rgba(176,108,255,${0.8 * (1 - k)})`],
      [6 * (1 - k) + 2, `rgba(255,255,255,${1 - k})`],
    ].forEach(([w, c]) => {
      ctx.strokeStyle = c;
      ctx.lineWidth = w;
      ctx.beginPath();
      ctx.arc(s.x - s.facing * 30, s.y, s.r * (0.75 + 0.25 * k), a0, a0 + 2.6);
      ctx.stroke();
    });
    ctx.restore();
  });
  // The death: it kneels and comes apart, band by band
  const d = F.death;
  if (d) {
    const s = NULLB.scale;
    ctx.globalAlpha = 1;
    drawNullBands(nullImg(), 13, d.x + d.w / 2 - 32 * s, d.y + d.h - 95 * s, 64 * s, 96 * s, d.facing < 0, clamp(d.t / 1.4, 0.05, 1), 3);
  }
  // Entrance fragments, converging (each with a streak behind it)
  if (F.frags.length) {
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    const at = (f, k) => {
      const e3 = k * k * k;
      return [f.x + (f.tx - f.x) * e3 + Math.sin(k * Math.PI) * f.swirl * 120, f.y + (f.ty - f.y) * e3];
    };
    F.frags.forEach((f) => {
      const k = clamp(f.t / f.dur, 0, 1);
      const [x, y] = at(f, k);
      const [bx, by] = at(f, Math.max(0, k - 0.12));
      ctx.globalAlpha = 0.5 + 0.5 * k;
      ctx.strokeStyle = f.color;
      ctx.lineWidth = f.size * 0.45;
      ctx.beginPath();
      ctx.moveTo(bx, by);
      ctx.lineTo(x, y);
      ctx.stroke();
      ctx.fillStyle = f.color;
      ctx.fillRect(x - f.size / 2, y - f.size / 2, f.size, f.size);
    });
    ctx.restore();
    ctx.globalAlpha = 1;
    const e = game.boss;
    if (e && e.formAt && !e.formed) glow(e.formAt.x, e.formAt.y - NULLB.h / 2, 80 + 120 * Math.min(1, e.introT || 0), "rgba(176,108,255,0.6)");
  }
  // Smoke: thick enough to lose it in
  const puff = nullSmokeSprite();
  ctx.imageSmoothingEnabled = true;
  F.smoke.forEach((m) => {
    const fade = Math.min(1, m.t / 0.12, (m.life - m.t) / 0.7);
    m.puffs.forEach((p, i) => {
      const grow = 1 + m.t * 0.35;
      const r = p.r * grow;
      ctx.globalAlpha = clamp(fade, 0, 1) * 0.92;
      ctx.drawImage(puff, m.x + p.dx + p.drift * m.t - r, m.y + p.dy - r - m.t * 30 - (i % 3) * 10, r * 2, r * 2);
    });
  });
  ctx.globalAlpha = 1;
  // Loose pixels
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  F.pixels.forEach((p) => {
    ctx.globalAlpha = Math.min(1, p.life / 0.3);
    ctx.fillStyle = p.color;
    ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
  });
  ctx.restore();
  ctx.globalAlpha = 1;
  // The RARE CACHE chip on its way to you
  const c = F.cache;
  if (c) {
    glow(c.x, c.y, 70, "rgba(255,47,214,0.8)");
    ctx.save();
    ctx.translate(c.x, c.y);
    ctx.rotate(time * 4);
    ctx.fillStyle = "#ffe14d";
    ctx.fillRect(-14, -14, 28, 28);
    ctx.fillStyle = "#b06cff";
    ctx.fillRect(-8, -8, 16, 16);
    ctx.restore();
  }
}

// ------------------------------------------------------------------ HUD -----
// While copies are up the bar flickers and can't tell you which one is real
function nullTargetLabel(boss) {
  if (!nullDecoys(boss).length) return "";
  return boss.revealT > 0 ? "REAL TARGET: LOCKED" : "REAL TARGET: ?";
}

function drawNullBar(boss, VW, time) {
  const P = boss.phase;
  const color = P === 2 ? "#ff2457" : NULLB.color;
  const label = nullTargetLabel(boss);
  const hidden = label === "REAL TARGET: ?";
  const GL = "#%&*@!?<>/01";
  let name = "NULL";
  if (hidden || Math.random() < 0.04) name = name.replace(/./g, (ch) => (Math.random() < 0.25 ? GL[Math.floor(Math.random() * GL.length)] : ch));
  const title = P === 2 ? `${name} // STACK OVERFLOW` : P === 1 ? `${name} !!` : name;
  const jitter = hidden && Math.random() < 0.2 ? rand(-6, 6) : 0;
  hudText(title, VW / 2 + jitter, 92, 22, P ? color : "#ffffff", "center");
  ctx.font = `22px ${FONT}`;
  drawEmptySet(VW / 2 - ctx.measureText(title).width / 2 - 26, 103, 9, color, 3);
  const bx = VW / 2 - 320;
  ctx.globalAlpha = hidden ? (Math.sin(time * 47) > 0.2 ? 1 : 0.45) : 1;
  drawBar(bx, 124, 640, 26, boss.hp / boss.maxHp, boss.ghostHp / boss.maxHp, color);
  if (hidden) {
    ctx.fillStyle = "rgba(10,3,24,0.85)";
    for (let i = 0; i < 4; i++) ctx.fillRect(bx + rand(0, 610), 124, rand(6, 30), 26); // dead pixels
  }
  ctx.globalAlpha = 1;
  if (boss.state === "coredump") hudText("CORE DUMPED // +50% DAMAGE", VW / 2, 162, 16, "#ffe14d", "center");
  else if (label) {
    const copies = nullDecoys(boss).length;
    const q = hidden && Math.floor(time * 4) % 2 ? label.replace("?", " ") : label;
    hudText(`${q}   COPIES x${copies}`, VW / 2, 162, 16, hidden ? "#d9c2ff" : "#5aff7a", "center");
  }
}

// Screen tears during the entrance and phase changes (drawn over the HUD)
function drawNullTear(VW, VH) {
  if (nullFx.tear <= 0) return;
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  const n = Math.ceil(nullFx.tear * 14);
  for (let i = 0; i < n; i++) {
    const y = rand(0, VH);
    const h = rand(2, 14);
    ctx.fillStyle = nullPick(["rgba(255,30,110,0.22)", "rgba(30,240,255,0.22)", "rgba(176,108,255,0.28)"]);
    ctx.fillRect(rand(-200, VW * 0.5), y, rand(VW * 0.3, VW), h);
  }
  ctx.restore();
}

// Its own name card: the title decodes, the subtitle types itself out
function drawNullCard(VW, VH, c) {
  const tt = c.max - c.time;
  const k = clamp((tt - 1.4) / 0.3, 0, 1) * Math.min(1, c.time / 0.4);
  if (!k) return;
  const y = VH * 0.62;
  ctx.globalAlpha = k;
  ctx.fillStyle = "rgba(4,0,12,0.72)";
  ctx.fillRect(0, y - 84, VW, 176);
  ctx.fillStyle = "rgba(176,108,255,0.08)";
  for (let ly = y - 84; ly < y + 92; ly += 6) ctx.fillRect(0, ly, VW, 2);
  ctx.fillStyle = NULLB.color;
  ctx.fillRect(60, y - 84 + (Math.random() < 0.1 ? rand(-8, 8) : 0), 10, 176);
  drawEmptySet(150, y - 6, 40, NULLB.color, 9);
  const title = "NULL";
  const decoded = clamp((tt - 1.5) / 0.9, 0, 1) * title.length;
  const GL = "#%&*@!?<>/01";
  let shown = "";
  for (let i = 0; i < title.length; i++) shown += i < decoded ? title[i] : GL[Math.floor(Math.random() * GL.length)];
  const x = 220;
  ctx.font = `72px ${FONT}`;
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  const split = 4 + (Math.random() < 0.15 ? rand(0, 10) : 0);
  ctx.fillStyle = "rgba(255,40,110,0.75)";
  ctx.fillText(shown, x - split, y - 8);
  ctx.fillStyle = "rgba(40,240,255,0.75)";
  ctx.fillText(shown, x + split, y - 8);
  ctx.fillStyle = "#ffffff";
  ctx.fillText(shown, x, y - 8);
  const sub = `> ${c.subtitle.toLowerCase()}`;
  const typed = sub.slice(0, Math.floor(clamp((tt - 1.9) / 1.2, 0, 1) * sub.length));
  hudText(typed + (Math.floor(tt * 4) % 2 ? "_" : " "), x + 4, y + 52, 22, "#d9c2ff", "left", "middle");
  if (tt > 2.6) hudText("0x00000000 // SIGSEGV", VW - 60, y - 64, 16, "rgba(255,107,154,0.9)", "right", "middle");
  ctx.globalAlpha = 1;
}

// --------------------------------------------- Fallback art (procedural) ----
// Until img/null.png arrives (and is registered as IMG.nullBoss), NULL is drawn
// from a sheet painted here: 14 frames of 64x96, facing right, feet on row 94.
// f0/f1 idle, f2-5 run, f6 air, f7 blink out, f8 blink in, f9 slash,
// f10 throw, f11 aim, f12 hurt, f13 defeated.
const NULL_POSES = (() => {
  const idle = (b) => ({
    head: [32, 21 + b],
    neck: [31, 31 + b],
    hip: [30, 56],
    legs: [
      [26, 75, 23, 92],
      [35, 74, 37, 92],
    ],
    arms: [
      [25, 42 + b, 21, 52 + b],
      [37, 42 + b, 42, 51 + b],
    ],
    blades: [
      [2.4, 16],
      [0.75, 18],
    ],
    cloak: [
      [36, 29],
      [27, 28],
      [18, 44],
      [13, 66 - b],
      [20, 71],
      [28, 68],
      [33, 52],
    ],
  });
  const run = (legs, b) => ({
    head: [38, 23 + b],
    neck: [36, 33 + b],
    hip: [30, 57],
    legs,
    arms: [
      [28, 41, 20, 46],
      [33, 43, 26, 51],
    ],
    blades: [
      [3.35, 18],
      [2.95, 18],
    ],
    cloak: [
      [36, 30],
      [28, 30],
      [8, 38 - b],
      [2, 48],
      [9, 52],
      [3, 61],
      [16, 60],
      [27, 57],
      [33, 45],
    ],
  });
  return [
    idle(0),
    idle(1),
    run(
      [
        [22, 72, 13, 85],
        [40, 72, 46, 92],
      ],
      0
    ),
    run(
      [
        [31, 75, 27, 92],
        [41, 65, 36, 79],
      ],
      -1
    ),
    run(
      [
        [38, 73, 45, 92],
        [24, 71, 15, 84],
      ],
      0
    ),
    run(
      [
        [41, 65, 36, 79],
        [30, 75, 27, 92],
      ],
      -1
    ),
    {
      head: [33, 20],
      neck: [32, 30],
      hip: [30, 52],
      legs: [
        [24, 63, 19, 75],
        [40, 59, 37, 71],
      ],
      arms: [
        [24, 34, 16, 30],
        [40, 36, 47, 30],
      ],
      blades: [
        [-2.5, 18],
        [-0.6, 18],
      ],
      cloak: [
        [30, 27],
        [12, 20],
        [4, 32],
        [11, 40],
        [7, 51],
        [22, 54],
        [30, 44],
      ],
    },
    { ...idle(2), dissolve: 0.6, crouch: 4 },
    {
      head: [37, 40],
      neck: [34, 48],
      hip: [28, 68],
      legs: [
        [20, 80, 13, 92],
        [40, 78, 43, 92],
      ],
      arms: [
        [22, 56, 13, 61],
        [40, 60, 45, 86],
      ],
      blades: [
        [2.8, 18],
        [-0.15, 16],
      ],
      cloak: [
        [33, 45],
        [24, 46],
        [10, 58],
        [4, 74],
        [12, 80],
        [26, 76],
      ],
      dissolve: 0.2,
    },
    {
      head: [41, 26],
      neck: [37, 34],
      hip: [30, 58],
      legs: [
        [20, 73, 8, 90],
        [44, 73, 50, 92],
      ],
      arms: [
        [28, 45, 21, 54],
        [46, 34, 54, 29],
      ],
      blades: [
        [2.6, 18],
        [-1.05, 25],
      ],
      cloak: [
        [35, 31],
        [26, 33],
        [6, 43],
        [2, 58],
        [13, 56],
        [21, 64],
        [29, 50],
      ],
    },
    {
      head: [36, 22],
      neck: [34, 32],
      hip: [29, 57],
      legs: [
        [22, 74, 14, 92],
        [38, 74, 42, 92],
      ],
      arms: [
        [24, 41, 16, 47],
        [44, 34, 54, 32],
      ],
      blades: [
        [2.9, 16],
        null,
      ],
      cloak: [
        [33, 30],
        [24, 31],
        [9, 52],
        [12, 67],
        [24, 68],
        [30, 50],
      ],
      star: [58, 31],
    },
    {
      head: [36, 41],
      neck: [34, 50],
      hip: [28, 70],
      legs: [
        [24, 91, 11, 92],
        [41, 78, 43, 92],
      ],
      arms: [
        [37, 55, 46, 53],
        [42, 57, 50, 55],
      ],
      blades: [null, null],
      cloak: [
        [32, 47],
        [22, 48],
        [8, 70],
        [10, 87],
        [23, 89],
        [29, 70],
      ],
      rail: [36, 55, 63, 52],
    },
    {
      head: [26, 24],
      neck: [28, 33],
      hip: [30, 58],
      legs: [
        [24, 76, 20, 92],
        [36, 76, 40, 92],
      ],
      arms: [
        [20, 37, 12, 31],
        [38, 41, 46, 36],
      ],
      blades: [
        [-2.2, 14],
        [-0.4, 14],
      ],
      cloak: [
        [27, 30],
        [34, 36],
        [42, 56],
        [36, 70],
        [24, 69],
        [22, 46],
      ],
      dissolve: 0.12,
    },
    {
      head: [38, 53],
      neck: [34, 58],
      hip: [26, 73],
      legs: [
        [20, 91, 8, 92],
        [36, 83, 38, 92],
      ],
      arms: [
        [27, 71, 25, 85],
        [41, 71, 45, 84],
      ],
      blades: [
        [1.45, 10],
        [1.6, 10],
      ],
      cloak: [
        [33, 52],
        [17, 56],
        [6, 78],
        [9, 92],
        [27, 91],
      ],
      dissolve: 0.35,
    },
  ];
})();

function buildNullSheet() {
  const c = document.createElement("canvas");
  c.width = 64 * 14;
  c.height = 96;
  const g = c.getContext("2d");
  let seed = 7;
  const rnd = () => {
    seed = (seed * 16807) % 2147483647;
    return (seed - 1) / 2147483646;
  };
  const line = (x1, y1, x2, y2, w, color) => {
    g.strokeStyle = color;
    g.lineWidth = w;
    g.lineCap = "round";
    g.beginPath();
    g.moveTo(x1, y1);
    g.lineTo(x2, y2);
    g.stroke();
  };
  const poly = (pts, color) => {
    g.fillStyle = color;
    g.beginPath();
    pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
    g.closePath();
    g.fill();
  };
  const px = (x, y, color, w = 1, h = 1) => {
    g.fillStyle = color;
    g.fillRect(Math.round(x), Math.round(y), w, h);
  };
  NULL_POSES.forEach((P, f) => {
    const o = f * 64;
    g.save();
    g.translate(o, 0);
    g.beginPath();
    g.rect(0, 0, 64, 96);
    g.clip();
    const T = (p) => [p[0], p[1] + (P.crouch || 0)];
    const [hx, hy] = T(P.head);
    const [nx, ny] = T(P.neck);
    const [ipx, ipy] = P.hip;
    const blade = (hand, b) => {
      if (!b) return;
      const [x, y] = T(hand);
      const ex = x + Math.cos(b[0]) * b[1];
      const ey = y + Math.sin(b[0]) * b[1];
      line(x, y, ex, ey, 3, "#9b5cff");
      line(x, y, ex, ey, 1.4, "#f4ecff");
    };
    // back blade and arm, behind everything
    blade([P.arms[0][2], P.arms[0][3]], P.blades[0]);
    line(nx - 3, ny + 2, ...T([P.arms[0][0], P.arms[0][1]]), 4, "#120d1d");
    line(...T([P.arms[0][0], P.arms[0][1]]), ...T([P.arms[0][2], P.arms[0][3]]), 3.5, "#120d1d");
    // the cloak
    poly(P.cloak.map(T), "#221a3a");
    poly(
      P.cloak.map(T).map(([x, y]) => [x + (x < nx ? 2 : -1), y - 2]),
      "#2c2150"
    );
    // legs: back one darker
    P.legs.forEach((L, i) => {
      const shade = i ? "#1a1428" : "#110c1b";
      line(ipx + (i ? 2 : -2), ipy, L[0], L[1], 6, shade);
      line(L[0], L[1], L[2], L[3], 5, shade);
      g.fillStyle = "#07050c";
      g.fillRect(Math.round(L[2]) - 2, Math.round(L[3]) - 1, 7, 3); // boot
      px(L[0] - 1, L[1] - 1, "#8a5cff", 2, 2); // knee light
    });
    // torso
    line(nx, ny, ipx, ipy, 11, "#17111f");
    line(nx + 2, ny + 3, ipx + 1, ipy - 3, 2, "#3a2b66");
    line(ipx - 6, ipy - 3, ipx + 6, ipy - 2, 2, "#5b3fb8"); // belt
    // hood: a rounded cowl with a point at the back
    poly(
      [
        [hx - 9, hy - 2],
        [hx - 3, hy - 10],
        [hx + 5, hy - 9],
        [hx + 8, hy - 2],
        [hx + 7, hy + 7],
        [nx + 5, ny + 2],
        [nx - 6, ny + 2],
        [hx - 12, hy + 4],
      ],
      "#1d1630"
    );
    poly(
      [
        [hx - 3, hy - 10],
        [hx + 5, hy - 9],
        [hx + 8, hy - 2],
        [hx + 3, hy - 6],
      ],
      "#3a2b66"
    );
    // the mask: black, with the empty-set sign glowing on it
    g.fillStyle = "#040208";
    g.beginPath();
    g.ellipse(hx + 3.5, hy + 1, 4, 5, 0, 0, Math.PI * 2);
    g.fill();
    // front arm and blade
    line(nx + 3, ny + 2, ...T([P.arms[1][0], P.arms[1][1]]), 4, "#1b1429");
    line(...T([P.arms[1][0], P.arms[1][1]]), ...T([P.arms[1][2], P.arms[1][3]]), 3.5, "#1b1429");
    blade([P.arms[1][2], P.arms[1][3]], P.blades[1]);
    if (P.rail) {
      const [a, b, x2, y2] = P.rail;
      line(a, b, x2, y2, 3.5, "#9b5cff");
      line(a, b, x2, y2, 1.5, "#ffffff");
    }
    if (P.star) {
      const [sx, sy] = P.star;
      poly(
        [
          [sx, sy - 5],
          [sx + 1.5, sy - 1.5],
          [sx + 5, sy],
          [sx + 1.5, sy + 1.5],
          [sx, sy + 5],
          [sx - 1.5, sy + 1.5],
          [sx - 5, sy],
          [sx - 1.5, sy - 1.5],
        ],
        "#e9dcff"
      );
    }
    g.restore();
    // Crisp pixels: no half-transparent edges, then a dark outline
    const img = g.getImageData(o, 0, 64, 96);
    const d = img.data;
    for (let i = 3; i < d.length; i += 4) d[i] = d[i] >= 110 ? 255 : 0;
    const solid = (x, y) => x >= 0 && y >= 0 && x < 64 && y < 96 && d[(y * 64 + x) * 4 + 3] === 255;
    // a violet rim light along the top and front edges (dark pixels only)
    const rim = [];
    for (let y = 0; y < 96; y++)
      for (let x = 0; x < 64; x++) {
        const k = (y * 64 + x) * 4;
        if (solid(x, y) && d[k] + d[k + 1] + d[k + 2] < 200 && (!solid(x + 1, y) || !solid(x, y - 1))) rim.push(k);
      }
    rim.forEach((k) => {
      d[k] = 92;
      d[k + 1] = 68;
      d[k + 2] = 170;
    });
    const edge = [];
    for (let y = 0; y < 96; y++)
      for (let x = 0; x < 64; x++) if (!solid(x, y) && (solid(x - 1, y) || solid(x + 1, y) || solid(x, y - 1) || solid(x, y + 1))) edge.push(y * 64 + x);
    edge.forEach((k) => {
      d[k * 4] = 6;
      d[k * 4 + 1] = 3;
      d[k * 4 + 2] = 12;
      d[k * 4 + 3] = 255;
    });
    g.putImageData(img, o, 0);
    // The empty-set sign on the mask (drawn after, so it stays crisp)
    const mx = Math.round(hx + 3);
    const my = Math.round(hy);
    [
      [0, -2],
      [1, -2],
      [-1, -1],
      [2, -1],
      [-1, 0],
      [2, 0],
      [-1, 1],
      [2, 1],
      [0, 2],
      [1, 2],
      [3, -3],
      [2, -2],
      [-1, 2],
      [-2, 3],
    ].forEach(([a, b]) => px(o + mx + a, my + b, "#d6b4ff"));
    px(o + mx, my, "#ffffff", 2, 1);
    // The cloak's hem dissolves into loose pixels
    const hem = P.cloak.map(T).reduce((a, p) => (p[1] > a[1] ? p : a));
    for (let i = 0; i < 16; i++) {
      const x = hem[0] + (rnd() - 0.6) * 22;
      const y = hem[1] + rnd() * 9 - 2;
      if (y > 94) continue;
      px(o + x, y, rnd() < 0.3 ? "#8a5cff" : "#2c2150", rnd() < 0.5 ? 2 : 1, 1);
    }
    // Blinking frames come apart: bands shift, pixels drift up
    if (P.dissolve) {
      for (let i = 0; i < 18 * P.dissolve; i++) {
        const y = Math.floor(rnd() * 80) + 8;
        const shift = Math.round((rnd() - 0.5) * 10 * P.dissolve * 2);
        const band = g.getImageData(o, y, 64, 2);
        g.clearRect(o, y, 64, 2);
        g.putImageData(band, o + shift, y, Math.max(0, -shift), 0, 64 - Math.abs(shift), 2);
      }
      for (let i = 0; i < 60 * P.dissolve; i++) {
        const x = 14 + rnd() * 36;
        const y = 4 + rnd() * 60;
        px(o + x, y, rnd() < 0.5 ? "#b06cff" : "#19f5ff", rnd() < 0.3 ? 2 : 1, rnd() < 0.3 ? 2 : 1);
      }
    }
  });
  return c;
}
IMG.nullFallback = buildNullSheet();
