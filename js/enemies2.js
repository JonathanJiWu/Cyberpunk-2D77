"use strict";
// =============================================================================
// The v3.2 enemies (stats and DATABASE text: ENEMY_TYPES in database.js,
// marked v2: true). The corps escalate:
//   FORK BOMB        swarm      rolls in fast, bounces up to your floor,
//                               unfurls and leaps; dies into two child
//                               processes (an elite into three)
//   PACKET LOBBER    artillery  lobs packets where you're GOING: a marker on
//                               the floor shows the landing. Shoot them down,
//                               burn them (Flame On), slice or parry them
//   LEGACY MONOLITH  heavy      armor plates soak chip damage (flat
//                               reduction per hit); break one to expose the
//                               core. Knockback immune; slam, shoulder charge
//   HOTFIX           support    medic drone: tethers to a hurt ally, heals it
//                               and gives it a one-hit shield; its shields
//                               pop when it dies
//   RATE LIMITER     control    a 429 field: inside it your weapons fire at
//                               half rate and your special is locked
// enemies.js calls in through one-line hooks (spawn, update, damage, kill,
// draw, reset). Walkers get around with the platform navigation (nav.js) and
// go after enemyTarget(e). Attacks go through the shared paths (body contact
// in updateEnemy, spawnShockwave with an owner); the special ones (packets,
// heal tethers, the 429 field) pick friend or foe by team: an enemy with
// hijackT > 0 fights for the players (Hackerman's hijack).
// =============================================================================

const hj2 = (e) => !!e && e.hijackT > 0; // hijacked: on the players' side
const sameTeam2 = (a, b) => hj2(a) === hj2(b);
const limiters2 = []; // Rate Limiters alive this frame
const debris2 = []; // armor plates flying off a Monolith
const PACKET_G = 1700; // packet gravity
const PLATE_DOT = new Set(["bleed", "fall"]); // damage over time isn't a "hit": shields let it through
const ARMOR_BYPASS = new Set(["bleed", "fall", "reflect"]); // burns, falls and Mirror Steel get under the plates
// Monolith sheet: torso offset of each body frame (sheet px) and where each
// plate sits (front, back, crown; facing right) for the pieces that fly off
const MONO_DY = [0, 0, 1, 0, -2, 2, 1];
const PLATE_AT = [
  [42, 32],
  [22, 32],
  [32, 6],
];
const DASH2 = [14, 10];
const NODASH2 = [];
// telegraph tints in 8 strengths (no new colour string per frame)
const TELL_PINK = [0, 1, 2, 3, 4, 5, 6, 7].map((i) => `rgba(255,47,214,${(0.2 + i * 0.06).toFixed(2)})`);
const TELL_AMBER = [0, 1, 2, 3, 4, 5, 6, 7].map((i) => `rgba(255,170,40,${(0.2 + i * 0.06).toFixed(2)})`);

function resetEnemies2() {
  limiters2.length = 0;
  debris2.length = 0;
}

// spawnEnemy(): the extra state each new type carries
function initEnemy2(e) {
  const def = e.def;
  e.state = "move";
  e.stateT = 0;
  e.spin = 0;
  e.firedT = 0;
  if (e.type === "forkbomb") {
    e.child = false;
  } else if (e.type === "lobber") {
    e.perch = null;
    e.perchT = 0;
    e.perchCd = rand(1, 2.5);
    e.perchBody = { x: 0, y: 0, w: e.w, h: e.h, onGround: true, standingOn: null };
  } else if (e.type === "monolith") {
    const k = e.maxHp / def.hp; // (plates grow with the run like HP does)
    e.plates = def.armor.plates.map((hp) => ({ hp: hp * k, max: hp * k }));
    e.slamCd = rand(1.5, 2.5);
    e.chargeCd = rand(3, 4.5);
    e.turnT = 0;
    e.clangT = 0;
  } else if (e.type === "hotfix") {
    e.ally = null;
    e.ally2 = null;
    e.tether1 = null;
    e.tether2 = null;
    e.pickT = 0;
    e.bubbleCd = 2;
    e.healAcc = 0;
    e.healPop = 0.7;
  } else if (e.type === "ratelimiter") {
    e.fieldR = 0;
    e.pulseCd = rand(2, 3);
    e.pulseT = 99;
    e.collapseT = 0;
  }
}

// ---------------------------------------------------------------- Update -----
// updateEnemy() (minion branch): the type's AI and movement. The shared tail
// there does knockback decay, body contact (times the returned multiplier)
// and despawning. target: enemyTarget(e); wander: a spot to mill around
// while camo hides the target (else null).
function updateEnemy2(e, dt, target, wander, stunned) {
  e.firedT -= dt;
  if (e.def.kbResist === 0) e.kbX = e.kbY = 0; // (not even a contact bounce moves a Monolith)
  const busy = stunned || !!wander;
  if (e.type === "forkbomb") return updateForkBomb(e, dt, target, wander, busy);
  if (e.type === "lobber") return updateLobber(e, dt, target, wander, busy);
  if (e.type === "monolith") return updateMonolith(e, dt, target, wander, busy);
  if (e.type === "hotfix") return updateHotfix(e, dt, target, busy);
  return updateRateLimiter(e, dt, target, wander, busy);
}

// The route through the platforms toward the target (nav.js): the run speed
// it wants. EM-slowed enemies run slower but a planned jump steers at full speed.
function chase2(e, dt, target, wander) {
  const want = navWalker(e, dt, target, wander);
  return navAirborne(e) ? want : want * e.slowMul;
}

// Is the target on this walker's floor (or coming down on it)?
const sameFloor2 = (e, t) => e.onGround && navNodeOf(e.standingOn) === navNodeOfBody(t);

// A walker's physics step (the same as the other walkers'). momentum: keep
// vx as it is (a leap or a charge) instead of easing toward `want`.
function walk2(e, dt, want, momentum) {
  const steering = navAirborne(e);
  if (!momentum) e.vx += (want - e.vx) * (steering ? 1 : Math.min(1, 8 * dt));
  if (!steering && !momentum && e.onGround) e.vx = navLedgeClamp(e, e.vx, dt);
  e.x += e.kbX * dt;
  if (e.kbY < 0) {
    e.vy += e.kbY;
    e.kbY = 0;
  }
  if (e.onGround) e.airFrom = e.y;
  const landed = navMoveWalker(e, dt);
  if (landed && e.knockT > 0) fallDamage(e, e.y - e.airFrom);
  return landed;
}

// ------------------------------------------------------------ Fork Bomb -----
function updateForkBomb(e, dt, t, wander, busy) {
  const B = e.def.bomb;
  const dx = t.x + t.w / 2 - (e.x + e.w / 2);
  const dy = t.y + t.h - (e.y + e.h); // > 0: the target stands lower
  e.dashCd -= dt;
  let want = 0;
  let momentum = false;
  if (e.state === "unfurl") {
    // legs out, flashing: then it springs
    if (busy) e.state = "move";
    else if ((e.stateT -= dt) <= 0) forkLeap(e, t);
  } else if (e.state === "leap") {
    momentum = true;
    e.stateT += dt;
  } else {
    want = e.stun > 0 ? 0 : chase2(e, dt, t, wander);
    if (!busy && e.onGround && !navBusy(e) && e.dashCd <= 0 && Math.abs(dx) < B.leapRange && dy > -300 && dy < 90) {
      e.state = "unfurl";
      e.stateT = B.windup / e.slowMul;
      e.facing = dx > 0 ? 1 : -1;
    }
  }
  const vyBefore = e.vy;
  const landed = walk2(e, dt, want, momentum);
  if (landed) {
    if (e.state === "leap" && e.stateT > 0.08) {
      e.state = "move";
      e.dashCd = rand(B.cooldown[0], B.cooldown[1]);
    }
    if (vyBefore > 650 && !navBusy(e)) e.vy = -vyBefore * 0.3; // a bouncy ball
  }
  // the stripes roll with the distance covered
  e.spin += (Math.abs(e.vx) * dt) / 13;
  if (e.state !== "unfurl" && Math.abs(e.vx) > 20) e.facing = e.vx > 0 ? 1 : -1;
  return e.state === "leap" ? B.leapDamage / e.def.damage : 1;
}

// Spring at the target: high enough to reach its floor, timed to come down on it
function forkLeap(e, t) {
  const B = e.def.bomb;
  const dx = t.x + t.w / 2 - (e.x + e.w / 2);
  const up = Math.max(0, e.y + e.h - (t.y + t.h));
  const v = Math.min(1350, Math.max(B.leapSpeed, Math.sqrt(2 * NAV_WALKER_G * (up + 70))));
  const flight = (v + Math.sqrt(Math.max(0, v * v - 2 * NAV_WALKER_G * up))) / NAV_WALKER_G;
  e.vy = -v;
  e.vx = clamp(dx / Math.max(0.3, flight), -B.leapReach, B.leapReach);
  e.state = "leap";
  e.stateT = 0;
  e.onGround = false;
  e.standingOn = null;
  synth.play("forkLeap", { volume: 0.7 });
}

// killEnemy(): fork() - two child processes pop out (three from an elite)
function forkChildren(e) {
  const B = e.def.bomb;
  const n = e.elite ? 3 : 2;
  const cx = e.x + e.w / 2;
  const cy = e.y + e.h / 2;
  for (let i = 0; i < n; i++) {
    const k = spawnEnemy("forkbomb", cx, cy, { elite: false });
    k.child = true;
    k.size = B.childSize;
    k.w = e.def.w * B.childSize;
    k.h = e.def.h * B.childSize;
    k.x = clamp(cx - k.w / 2, 0, WORLD_W - k.w);
    k.y = cy - k.h / 2;
    k.hp = k.maxHp = k.maxHp * B.childHp;
    const dir = n === 2 ? (i ? 1 : -1) : i - 1;
    k.vx = dir * rand(240, 340) || rand(-60, 60);
    k.vy = -rand(480, 620);
    k.facing = dir || 1;
    k.state = "leap"; // (flies out in an arc, then rolls)
    k.stateT = 0;
    k.dashCd = rand(0.6, 1.1);
    k.hitCd = 0.35;
  }
  popup("fork()", cx, e.y - 10, "#ff2fd6", 20, 0.7);
  synth.play("forkSplit");
}

// -------------------------------------------------------- Packet Lobber -----
function updateLobber(e, dt, t, wander, busy) {
  const S = e.def.shot;
  const cx = e.x + e.w / 2;
  const tcx = t.x + t.w / 2;
  const dx = tcx - cx;
  const adx = Math.abs(dx);
  const [near, far] = e.def.range;
  let want = 0;
  e.perchCd -= dt;
  if (e.state === "plant") {
    if (busy) e.state = "move"; // interrupted: the packet in the tube fizzles
    else if ((e.stateT -= dt) <= 0) {
      lobberLaunch(e);
      e.state = "recoil";
      e.stateT = 0.4;
      e.firedT = 0.25;
    }
  } else if (e.state === "recoil") {
    if ((e.stateT -= dt) <= 0) e.state = "move";
  } else {
    // Where to stand: a perch above the street if there's one in range, else
    // 420-800 px away on whatever floor
    if (e.perch && (adx < 250 || adx > 1150 || (e.perchT += dt) > 7)) {
      e.perch = null;
      e.perchCd = rand(4, 6);
    }
    if (!e.perch && !busy && e.perchCd <= 0 && e.onGround && !navBusy(e) && adx < far + 200) {
      e.perchCd = rand(2.5, 4);
      if (lobberPerch(e, tcx)) e.perchT = 0;
    }
    const onPerch = e.perch && e.onGround && e.standingOn === e.perch;
    if (e.stun > 0) want = 0;
    else if (wander) want = chase2(e, dt, t, wander);
    else if (e.perch && !onPerch) want = chase2(e, dt, e.perchBody, null);
    else if (onPerch) want = 0;
    else if (navBusy(e) || adx > far) want = chase2(e, dt, t, null);
    else if (adx < near) want = -Math.sign(dx) * e.def.speed * e.slowMul; // back off (the ledge stops it)
    // fire: plant the legs, mark the spot, then the packet goes up
    if (!busy && onScreen(e)) e.shotCd -= dt * e.slowMul;
    if (!busy && e.shotCd <= 0 && e.onGround && !navBusy(e) && adx < 1250) {
      lobberPlant(e, t);
      want = 0;
    }
    if (!busy && e.state === "move") e.facing = dx > 0 ? 1 : -1; // the tube keeps pointing at you (it backs off facing you)
  }
  walk2(e, dt, e.state === "move" ? want : 0, false);
  return 1;
}

// A platform 100-420 px above it, from where the target is 380-860 px away
function lobberPerch(e, tcx) {
  const cx = e.x + e.w / 2;
  const feet = e.y + e.h;
  let best = null;
  let bd = 760;
  for (let i = 0; i < platforms.length; i++) {
    const p = platforms[i];
    const up = feet - p.y;
    if (up < 100 || up > 420 || p.ax || p.ay || p.w < e.w + 20) continue; // (a swinging floor is no place for a mortar)
    const side = Math.sign(cx - tcx) || 1;
    const px = clamp(tcx + side * 600, p.x + e.w / 2 + 6, p.x + p.w - e.w / 2 - 6);
    const away = Math.abs(px - tcx);
    if (away < 380 || away > 860) continue;
    const d = Math.abs(px - cx) + up * 0.5;
    if (d < bd) {
      bd = d;
      best = p;
      e.perchBody.x = px - e.w / 2;
      e.perchBody.y = p.y - e.h;
      e.perchBody.standingOn = p;
    }
  }
  e.perch = best;
  return !!best;
}

const muzzleX2 = (e) => e.x + e.w / 2 + e.facing * e.w * 0.18;
const muzzleY2 = (e) => e.y + e.h * 0.05;
// The flight time of a packet over a distance (higher arcs for longer lobs)
const packetFlight = (d) => clamp(0.8 + d / 1500, 0.95, 1.5);

// Plant: pick the landing spot(s) now (they show as markers right away)
function lobberPlant(e, t) {
  const S = e.def.shot;
  e.state = "plant";
  e.stateT = S.windup / e.slowMul;
  e.shotCd = rand(S.cooldown[0], S.cooldown[1]);
  const tcx = t.x + t.w / 2;
  const flight = packetFlight(Math.abs(tcx - muzzleX2(e)));
  // lead the target: where it will be when the packet comes down
  const lead = clamp((t.vx || 0) * S.lead * (S.windup + flight), -520, 520);
  const n = e.elite ? 3 : 1; // an elite brackets you
  for (let i = 0; i < n; i++) {
    const tx = clamp(tcx + lead + (i - (n - 1) / 2) * 190, 30, WORLD_W - 30);
    const ty = surfaceBelow(tx, t.y + t.h - 8);
    enemyShots.push({ x: muzzleX2(e), y: muzzleY2(e), vx: 0, vy: 0, r: 16, damage: S.damage * e.dmgMul, kind: "packet", angle: 0, life: 6, owner: e, tick: tickPacket, draw: drawPacket2, phase: 0, tx, ty, flight, age: 0, total: S.windup + flight, spin: rand(0, 6), blast: S.blast });
  }
}

// Fire every packet waiting in the tube: a ballistic arc onto its marker
function lobberLaunch(e) {
  for (let i = 0; i < enemyShots.length; i++) {
    const s = enemyShots[i];
    if (s.kind !== "packet" || s.owner !== e || s.phase !== 0) continue;
    s.x = muzzleX2(e);
    s.y = muzzleY2(e);
    const T = s.flight;
    s.vx = (s.tx - s.x) / T;
    s.vy = (s.ty - 8 - s.y - 0.5 * PACKET_G * T * T) / T;
    s.phase = 1;
  }
  burst(muzzleX2(e), muzzleY2(e), 8, "#ffb347", 260);
  synth.play("lobberFire");
}

// updateEnemyShots(): a packet moves itself (returns true when it's gone).
// In the tube it waits; in the air it arcs; any player shot, a dash or a
// player body (it bursts) stops it; it blows up on its marker.
function tickPacket(s, dt) {
  const o = s.owner;
  s.age += dt;
  if (s.phase === 0) {
    if (o.dead || o.state !== "plant") return true; // never left the tube
    s.x = muzzleX2(o);
    s.y = muzzleY2(o);
    return false;
  }
  if (!packetFrozen(s)) {
    s.vy += PACKET_G * dt;
    s.x += s.vx * dt;
    s.y += s.vy * dt;
    s.spin += dt * 7;
  }
  if (packetShotDown(s)) {
    burst(s.x, s.y, 10, "#ffe14d", 260);
    popup("DROPPED", s.x, s.y - 20, "#ffe14d", 16, 0.5);
    synth.play("bubblePop", { rate: 0.7 });
    return true;
  }
  if ((s.vy > 0 && s.y >= s.ty - 8) || packetTouches(s)) {
    packetBlast(s);
    return true;
  }
  return s.age > 6 || s.y > GROUND_Y + 80;
}

// Time Dilation (level 6) freezes shots right next to Hackerman
function packetFrozen(s) {
  for (let i = 0; i < coop.players.length; i++) {
    const c = coop.players[i];
    const p = c.player;
    if (p.dilation > 0 && c.stats.dilation && c.stats.dilation.freezeShots && Math.hypot(s.x - p.x - p.w / 2, s.y - p.y - p.h / 2) < 220) return true;
  }
  return false;
}

// Shot out of the air by any player's projectile (an arrow stops unless it
// pierces; EM waves sweep on), or sliced by an Iaido Dash
function packetShotDown(s) {
  if (hj2(s.owner)) return false; // (a hijacked Lobber's packets are on your side)
  for (let i = 0; i < coop.players.length; i++) {
    const c = coop.players[i];
    const shots = c.shots;
    for (let j = shots.length - 1; j >= 0; j--) {
      const q = shots[j];
      if (q.kind === "packet") continue;
      const rr = (q.r || 10) + s.r;
      if ((q.x - s.x) * (q.x - s.x) + (q.y - s.y) * (q.y - s.y) > rr * rr) continue;
      if (q.kind !== "em" && !(q.pierce > 0)) shots.splice(j, 1);
      else if (q.kind === "arrow") q.pierce--;
      return true;
    }
    if (c.player.dash && inWorld(c) && circleHitsBox(s.x, s.y, s.r + 30, c.player)) return true;
  }
  return false;
}

// Bursting on contact with a body on the other team
function packetTouches(s) {
  if (!hj2(s.owner)) {
    for (let i = 0; i < coop.players.length; i++) {
      const c = coop.players[i];
      if (inWorld(c) && !c.player.hidden && circleHitsBox(s.x, s.y, s.r, c.player)) return true;
    }
  }
  for (let i = 0; i < enemies.length; i++) {
    const o = enemies[i];
    if (!o.dead && !o.boss && o !== s.owner && !sameTeam2(o, s.owner) && circleHitsBox(s.x, s.y, s.r, o)) return true;
  }
  return false;
}

let blastS = null;
function blastPlayer2() {
  const s = blastS;
  if (!player.hidden && circleHitsBox(s.x, s.ty - 10, s.blast, player)) hurtPlayer(s.damage, s.x, s.ty, s.owner);
}
function packetBlast(s) {
  const y = Math.min(s.y, s.ty);
  ring(s.x, y, s.blast, "#ff9b21");
  burst(s.x, y, 16, "#ff9b21", 420);
  burst(s.x, y, 8, "#ffe14d", 260);
  camera.shake = Math.max(camera.shake, 6);
  synth.play("packetLand");
  const ours = hj2(s.owner);
  if (!ours) {
    blastS = s;
    s.ty = y;
    eachTarget(blastPlayer2);
  }
  // enemies on the other team caught in it
  for (let i = 0; i < enemies.length; i++) {
    const o = enemies[i];
    if (o.dead || o.boss || o === s.owner || sameTeam2(o, s.owner) || !circleHitsBox(s.x, y - 10, s.blast, o)) continue;
    damageEnemy(o, s.damage, { source: ours ? "hijack" : "enemy", fromX: s.x });
  }
}

function drawPacket2(s) {
  const friendly = s.phase === undefined || hj2(s.owner); // (parried back at them, or hijacked)
  if (s.phase === 0) {
    glow(s.x, s.y, 20 + 30 * Math.min(1, s.age / 0.6), "rgba(255,150,40,0.85)"); // the tube glows as it loads
    return;
  }
  glow(s.x, s.y, 36, friendly ? "rgba(25,245,255,0.7)" : "rgba(255,140,30,0.75)");
  ctx.save();
  ctx.translate(s.x, s.y);
  ctx.rotate(s.spin || s.angle || 0);
  ctx.fillStyle = "#0b0416";
  ctx.fillRect(-13, -13, 26, 26);
  ctx.fillStyle = friendly ? "#7df9ff" : "#ffb347";
  ctx.fillRect(-11, -11, 22, 22);
  ctx.fillStyle = friendly ? "#0e9fc6" : "#c2510f";
  ctx.fillRect(-11, -11, 22, 6); // the packet header
  ctx.fillStyle = "#fff6b8";
  ctx.fillRect(-7, -1, 14, 3); // payload bits
  ctx.fillRect(-7, 5, 9, 3);
  ctx.restore();
}

// The landing marker: the blast's footprint on the floor, a ring closing in
// on it and a pulse that speeds up as the packet comes down
function drawMarker2(s, time) {
  if (s.tx < camera.x - 150 || s.tx > camera.x + W + 150) return;
  const k = clamp(s.age / s.total, 0, 1);
  const R = s.blast;
  const y = s.ty - 3;
  const ours = hj2(s.owner);
  const pulse = 0.5 + 0.5 * Math.sin(time * (8 + 26 * k));
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  ctx.strokeStyle = ours ? "#19f5ff" : "#ff9b21";
  ctx.lineWidth = 4;
  ctx.globalAlpha = 0.35 + 0.5 * pulse;
  ctx.beginPath();
  ctx.ellipse(s.tx, y, R, R * 0.22, 0, 0, Math.PI * 2);
  ctx.stroke();
  ctx.globalAlpha = 0.9;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.ellipse(s.tx, y, R * (1.9 - 1.6 * k), R * 0.22 * (1.9 - 1.6 * k), 0, 0, Math.PI * 2);
  ctx.stroke();
  ctx.fillStyle = ours ? "#19f5ff" : "#ffe14d";
  ctx.fillRect(s.tx - 2, y - 18, 4, 14); // the crosshair
  ctx.fillRect(s.tx - 18, y - 2, 36, 4);
  ctx.restore();
  glow(s.tx, y - 4, 30 + 50 * k, ours ? "rgba(25,245,255,0.5)" : "rgba(255,110,30,0.6)", 0.6 + 0.4 * pulse);
}

// ------------------------------------------------------ Legacy Monolith -----
function updateMonolith(e, dt, t, wander, busy) {
  const M = e.def;
  const sm = e.slowMul;
  const dx = t.x + t.w / 2 - (e.x + e.w / 2);
  const adx = Math.abs(dx);
  e.slamCd -= dt * sm;
  e.chargeCd -= dt * sm;
  e.clangT -= dt;
  let want = 0;
  let momentum = false;
  let contact = 1;
  if (e.state === "slamWind") {
    if (busy) e.state = "move";
    else if ((e.stateT -= dt) <= 0) monolithSlam(e);
  } else if (e.state === "slam" || e.state === "recover") {
    if ((e.stateT -= dt) <= 0) e.state = "move";
  } else if (e.state === "chargeWind") {
    if (busy) e.state = "move";
    else if ((e.stateT -= dt) <= 0) {
      e.state = "charge";
      e.stateT = M.charge.time;
      synth.play("monolithSlam", { rate: 1.6, volume: 0.5 });
    }
  } else if (e.state === "charge") {
    // the shoulder charge: straight ahead, stopping at a ledge or a wall
    momentum = true;
    contact = 1.5;
    e.vx = e.facing * M.charge.speed * sm;
    if (Math.random() < 0.5) dust(e.x + e.w / 2 - e.facing * 40, e.y + e.h, 1, 1.2);
    if ((e.stateT -= dt) <= 0 || navAtEdge(e, e.facing * 40) || e.x <= 1 || e.x >= WORLD_W - e.w - 1 || busy) {
      e.state = "recover";
      e.stateT = 0.5;
      e.vx *= 0.15;
    }
  } else {
    want = e.stun > 0 ? 0 : chase2(e, dt, t, wander);
    // it turns around slowly: room to get at its back plate
    const face = dx > 0 ? 1 : -1;
    if (face !== e.facing && !busy) {
      if ((e.turnT += dt) > 0.6) {
        e.facing = face;
        e.turnT = 0;
      }
    } else e.turnT = 0;
    if (!busy && e.onGround && !navBusy(e) && sameFloor2(e, t)) {
      if (adx < M.slam.range && e.slamCd <= 0) {
        e.state = "slamWind";
        e.stateT = M.slam.windup / sm;
        e.slamCd = rand(M.slam.cooldown[0], M.slam.cooldown[1]);
      } else if (adx > M.charge.range[0] && adx < M.charge.range[1] && e.chargeCd <= 0 && face === e.facing && !navAtEdge(e, e.facing * 60)) {
        e.state = "chargeWind";
        e.stateT = M.charge.windup / sm;
        e.chargeCd = rand(M.charge.cooldown[0], M.charge.cooldown[1]);
      }
    }
  }
  if (e.state !== "move" && e.state !== "charge") want = 0;
  const landed = walk2(e, dt, want, momentum);
  if (landed && e.airFrom < e.y - 60) {
    // a heavy landing shakes the floor
    camera.shake = Math.max(camera.shake, onScreen(e) ? 5 : 0);
    dust(e.x + e.w / 2, e.y + e.h, 10, 2);
  }
  return contact;
}

// The slam: shockwaves roll both ways along its floor (and stop at its edges)
function monolithSlam(e) {
  e.state = "slam";
  e.stateT = 0.6;
  const fx = e.x + e.w / 2;
  const fy = e.y + e.h;
  slamWave2(e, fx, fy, -1);
  slamWave2(e, fx, fy, 1);
  ring(fx, fy, 200, "#ffb020");
  burst(fx, fy, 18, "#cdc8ef", 380);
  dust(fx, fy, 16, 2.5);
  camera.shake = Math.max(camera.shake, onScreen(e) ? 12 : 0);
  synth.play("monolithSlam");
}

function slamWave2(e, x, y, dir) {
  const S = e.def.slam;
  let reach = S.reach;
  const p = e.standingOn;
  if (p && !p.ground) reach = Math.min(reach, dir > 0 ? p.x + p.w - x : x - p.x);
  if (reach < 40) return;
  spawnShockwave(x + dir * 20, y, dir, { owner: e, damage: S.damage * e.dmgMul, speed: S.speed, life: reach / S.speed, h: 70, color: "#ffb020" });
}

// damageEnemy(): a hit on a plate. Which plate: the side the hit came from
// (fromX), the crown for hits without a direction (orbit shards, chain
// lightning, missiles, stomps, heat). The plate takes the whole hit; the
// Monolith only what's left after the flat reduction, unless the hit
// pierces (Widow's piercing arrows) or cleaves (Tetsu's finisher and dash,
// which also hit plates three times as hard). A broken plate's side takes
// full damage.
function armorHit2(e, amount, opts) {
  if (ARMOR_BYPASS.has(opts.source)) return amount;
  const i = opts.fromX === undefined ? 2 : Math.sign(opts.fromX - (e.x + e.w / 2)) === e.facing ? 0 : 1;
  const plate = e.plates[i];
  if (plate.hp <= 0) return amount;
  plate.hp -= amount * (opts.breaksGuard ? 3 : 1);
  if (plate.hp <= 0) breakPlate2(e, i);
  if (opts.pierce || opts.breaksGuard) return amount;
  const left = Math.max(amount * 0.1, amount - e.def.armor.flat * (e.elite ? 1.3 : 1));
  if (e.clangT <= 0 && plate.hp > 0) {
    // sparks off the plate: the hit barely got through
    e.clangT = 0.22;
    const sx = e.x + e.w / 2 + (i === 2 ? 0 : (i === 0 ? e.facing : -e.facing) * e.w * 0.45);
    burst(sx, i === 2 ? e.y + 10 : e.y + e.h * 0.4, 5, "#e6e9f5", 240);
    synth.play("armorClang");
  }
  return left;
}

function breakPlate2(e, i) {
  e.plates[i].hp = 0;
  throwPlate2(e, i);
  const c = centerOf(e);
  burst(c.x, c.y - 20, 16, "#8a80c0", 380);
  burst(c.x, c.y - 20, 8, "#ffb020", 300);
  camera.shake = Math.max(camera.shake, 7);
  synth.play("plateBreak");
  const left = e.plates.filter((p) => p.hp > 0).length;
  popup(left ? "PLATE BROKEN" : "CORE EXPOSED", c.x, e.y - 30, left ? "#cdc8ef" : "#ffb020", 22, 0.9);
}

// A plate (its cell from the sheet) tumbles off
function throwPlate2(e, i) {
  const s = e.def.sheet;
  const k = s.scale * e.size;
  const cx = e.x + e.w / 2;
  const at = PLATE_AT[i];
  if (debris2.length >= 12) debris2.shift();
  debris2.push({
    x: cx + e.facing * (at[0] - s.fw / 2) * k,
    y: e.y + e.h - (s.fh - at[1]) * k,
    vx: (i === 2 ? rand(-0.4, 0.4) : i === 0 ? e.facing : -e.facing) * rand(220, 360),
    vy: -rand(520, 760),
    rot: 0,
    vr: rand(-9, 9),
    cell: i,
    flip: e.facing < 0,
    k,
    life: 1.6,
  });
}

function updateDebris2(dt) {
  for (let i = debris2.length - 1; i >= 0; i--) {
    const d = debris2[i];
    d.vy += 2000 * dt;
    d.x += d.vx * dt;
    d.y += d.vy * dt;
    d.rot += d.vr * dt;
    const floor = surfaceBelow(d.x, d.y - d.vy * dt - 2);
    if (d.y > floor - 8 && d.vy > 0) {
      d.y = floor - 8;
      d.vy *= -0.35;
      d.vx *= 0.6;
      d.vr *= 0.5;
    }
    if ((d.life -= dt) <= 0) debris2.splice(i, 1);
  }
}

// ----------------------------------------------------------------- Hotfix ---
function updateHotfix(e, dt, t, busy) {
  const P = e.def.patch;
  const sm = e.slowMul;
  const cx = e.x + e.w / 2;
  const cy = e.y + e.h / 2;
  const tcx = t.x + t.w / 2;
  if ((e.pickT -= dt) <= 0) {
    e.pickT = 0.5;
    hotfixPick(e);
  }
  if (e.ally && !allyOk2(e, e.ally)) e.ally = null;
  if (e.ally2 && !allyOk2(e, e.ally2)) e.ally2 = null;
  // where to hover: behind its patient (the far side from the target), above it
  const a = e.ally;
  let hx;
  let hy;
  if (a) {
    const ax = a.x + a.w / 2;
    hx = ax + (Math.sign(ax - tcx) || 1) * 140;
    hy = a.y - 100;
  } else {
    hx = tcx + (Math.sign(cx - tcx) || 1) * 560;
    hy = t.y - 240;
  }
  hy += Math.sin(game.time * 2.2 + e.bob) * 26;
  // ...and never near a player (it's a medic, not a fighter)
  if (!hj2(e)) {
    let near = P.keepAway;
    for (let i = 0; i < coop.players.length; i++) {
      const c = coop.players[i];
      if (!targetable(c)) continue;
      const px = c.player.x + c.player.w / 2;
      const py = c.player.y + c.player.h / 2;
      const d = Math.hypot(px - cx, py - cy);
      if (d < near) {
        near = d;
        hx = cx + (Math.sign(cx - px) || 1) * 320;
        hy = Math.min(hy, py - 260);
      }
    }
  }
  hy = Math.max(hy, WORLD_TOP + 70);
  const ddx = hx - cx;
  const ddy = hy - cy;
  const dd = Math.hypot(ddx, ddy) || 1;
  const sp = busy ? 0 : Math.min(e.def.speed * sm, dd * 3);
  const steer = Math.min(1, 3 * dt);
  navSpread(e);
  e.vx += ((ddx / dd) * sp + navFlock.x * 220 - e.vx) * steer;
  e.vy += ((ddy / dd) * sp + navFlock.y * 220 - e.vy) * steer;
  e.x += (e.vx + e.kbX) * dt;
  e.y += (e.vy + e.kbY) * dt;
  e.facing = (a ? a.x + a.w / 2 : tcx) > cx ? 1 : -1;
  // the tethers: heal (then patch plates), and a shield every few seconds
  e.bubbleCd -= dt * sm;
  e.tether1 = !busy && hotfixPatch(e, e.ally, dt) ? e.ally : null;
  e.tether2 = !busy && e.elite && hotfixPatch(e, e.ally2, dt) ? e.ally2 : null;
  if ((e.healPop -= dt) <= 0) {
    e.healPop = 0.7;
    if (e.healAcc >= 1 && e.tether1) {
      popup(`+${Math.round(e.healAcc)}`, e.tether1.x + e.tether1.w / 2, e.tether1.y - 12, "#5aff7a", 18, 0.6);
      synth.play("hotfixHeal", { volume: 0.5 });
    }
    e.healAcc = 0;
  }
  return 1;
}

const allyOk2 = (e, o) => !o.dead && !o.boss && !o.downed && o.type !== "hotfix" && sameTeam2(e, o);

// The patients: the best two by need (missing HP, elites, Monoliths love it)
function hotfixPick(e) {
  const cx = e.x + e.w / 2;
  const cy = e.y + e.h / 2;
  let best = null;
  let second = null;
  let bs = -1e9;
  let ss = -1e9;
  for (let i = 0; i < enemies.length; i++) {
    const o = enemies[i];
    if (o === e || !allyOk2(e, o)) continue;
    const d = Math.hypot(o.x + o.w / 2 - cx, o.y + o.h / 2 - cy);
    if (d > 760) continue;
    let s = (1 - o.hp / o.maxHp) * 2 - d / 1400;
    if (o.elite) s += 0.5;
    if (o.type === "monolith") s += 0.9;
    else if (o.type === "forkbomb" || o.type === "crawler") s -= 0.4; // (fodder)
    if (!(o.bubble && !o.bubble.dead)) s += 0.25;
    if (o === e.ally) s += 0.3; // sticks with a patient
    if (s > bs) {
      second = best;
      ss = bs;
      best = o;
      bs = s;
    } else if (s > ss) {
      second = o;
      ss = s;
    }
  }
  e.ally = best;
  e.ally2 = second;
}

function hotfixPatch(e, a, dt) {
  if (!a) return false;
  const P = e.def.patch;
  if (Math.hypot(a.x + a.w / 2 - e.x - e.w / 2, a.y + a.h / 2 - e.y - e.h / 2) > P.range) return false;
  const rate = P.heal * e.slowMul * dt; // (EM-slowed: it heals slower too)
  if (a.hp < a.maxHp) {
    const h = Math.min(a.maxHp - a.hp, a.maxHp * rate);
    a.hp += h;
    e.healAcc += h;
  } else if (a.plates) {
    for (let i = 0; i < a.plates.length; i++) {
      const p = a.plates[i];
      if (p.hp > 0) p.hp = Math.min(p.max, p.hp + p.max * rate);
    }
  }
  if (e.bubbleCd <= 0 && !(a.bubble && !a.bubble.dead)) {
    a.bubble = e;
    e.bubbleCd = P.bubbleEvery;
    ring(a.x + a.w / 2, a.y + a.h / 2, Math.max(a.w, a.h) * 0.8, "#5aff7a");
    popup("PATCHED", a.x + a.w / 2, a.y - 24, "#5aff7a", 18, 0.7);
    synth.play("hotfixShield");
  }
  return true;
}

function popBubble2(o) {
  const c = centerOf(o);
  o.bubble = null;
  burst(c.x, c.y, 10, "#9dffb0", 260);
  ring(c.x, c.y, Math.max(o.w, o.h) * 0.7, "#5aff7a");
  synth.play("bubblePop");
}

// ----------------------------------------------------------- Rate Limiter ---
const fieldY2 = (e) => e.y + e.h * 0.4;

function updateRateLimiter(e, dt, t, wander, busy) {
  const F = e.def.field;
  const sm = e.slowMul;
  const dx = t.x + t.w / 2 - (e.x + e.w / 2);
  const adx = Math.abs(dx);
  limiters2.push(e);
  // The field: grows in, pulses outward every few seconds, collapses when cut
  e.pulseT += dt;
  if (e.collapseT > 0) {
    e.collapseT -= dt;
    e.fieldR = Math.max(0, e.fieldR - 1400 * dt);
  } else {
    e.pulseCd -= dt * sm;
    if (e.pulseCd <= 0 && !busy) {
      e.pulseT = 0;
      e.pulseCd = e.elite ? F.eliteEvery : F.every;
      if (onScreen(e)) synth.play("ratePulse");
    }
    const want = F.radius + (F.pulse - F.radius) * pulseShape2(e.pulseT);
    e.fieldR += clamp(want - e.fieldR, -600 * dt, (e.pulseT < 0.4 ? 1600 : 500) * dt);
  }
  // Walk into range: close enough for the field to cover you, not closer
  let want = 0;
  if (e.stun > 0) want = 0;
  else if (wander) want = chase2(e, dt, t, wander);
  else if (!busy) {
    if (navBusy(e) || !sameFloor2(e, t)) want = chase2(e, dt, t, null);
    else if (adx > F.approach) want = Math.sign(dx) * e.def.speed * sm;
    else if (adx < 110) want = -Math.sign(dx) * e.def.speed * sm * 0.6;
  }
  walk2(e, dt, want, false);
  if (!navAirborne(e)) e.facing = dx > 0 ? 1 : -1;
  return 1;
}

// 0 -> 1 -> 0 over a pulse: out fast, hold, then back
function pulseShape2(t) {
  if (t < 0.35) return 1 - (1 - t / 0.35) * (1 - t / 0.35);
  if (t < 1.6) return 1;
  if (t < 2.5) return 1 - (t - 1.6) / 0.9;
  return 0;
}

// A finisher or an Iaido Dash cuts the field: it drops for a few seconds
function collapseField2(e) {
  if (e.collapseT > 0) return;
  e.collapseT = e.def.field.collapse;
  e.stun = Math.max(e.stun, 0.6);
  const c = centerOf(e);
  ring(c.x, fieldY2(e), Math.max(60, e.fieldR), "#19f5ff");
  popup("LIMIT CUT", c.x, e.y - 24, "#19f5ff", 20, 0.8);
  synth.play("glitch");
}

// Once a frame (end of updateEnemies): who stands in a 429 field. A player
// inside fires at half rate (bow draws, cooldowns, auto weapons) and can't
// use the special. A hijacked Rate Limiter's field slows enemies instead.
let throttleDt = 0;
const THROTTLE_LINES = ["429 THROTTLED", "P1 429 THROTTLED", "P2 429 THROTTLED"];
function applyFields2(dt) {
  const real = dt / Math.max(0.05, enemyTimeScale()); // (players live in real time)
  throttleDt = real;
  for (let i = 0; i < coop.players.length; i++) {
    const c = coop.players[i];
    const p = c.player;
    let inside = false;
    if (inWorld(c) && !p.hidden) {
      const px = p.x + p.w / 2;
      const py = p.y + p.h / 2;
      for (let j = 0; j < limiters2.length && !inside; j++) {
        const f = limiters2[j];
        if (f.dead || hj2(f) || f.fieldR <= 0) continue;
        const fx = f.x + f.w / 2 - px;
        const fy = fieldY2(f) - py;
        inside = fx * fx + fy * fy < f.fieldR * f.fieldR;
      }
    }
    if (inside) {
      if (!(p.throttleT > 0)) {
        popup("429", p.x + p.w / 2, p.y - 24, "#ff9b21", 26, 0.8);
        synth.play("throttled");
      }
      p.throttleT = 0.25;
      withPlayer(c, throttlePlayer2);
    } else if (p.throttleT > 0) p.throttleT = Math.max(0, p.throttleT - real);
  }
  // hijacked fields jam the enemies instead
  for (let j = 0; j < limiters2.length; j++) {
    const f = limiters2[j];
    if (f.dead || !hj2(f) || f.fieldR <= 0) continue;
    for (let i = 0; i < enemies.length; i++) {
      const o = enemies[i];
      if (o.dead || o.boss || hj2(o)) continue;
      const ox = o.x + o.w / 2 - f.x - f.w / 2;
      const oy = o.y + o.h / 2 - fieldY2(f);
      if (ox * ox + oy * oy < f.fieldR * f.fieldR) slowEnemy(o, 0.6, 0.3);
    }
  }
}

// (runs with `player` bound to the throttled one)
function throttlePlayer2() {
  const p = player;
  const k = 0.5 * throttleDt; // half rate: cooldowns tick at half speed
  if (p.draw) p.draw.t -= k;
  if (p.zapCd > 0) p.zapCd += k;
  if (p.missileCd > 0) p.missileCd += k;
  if (p.chainCd > 0) p.chainCd += k;
  p.specialCd = Math.max(p.specialCd || 0, 0.15); // the special is locked
  p.lockPop = (p.lockPop || 0) - throttleDt;
  if (flameHeld() && p.lockPop <= 0) {
    p.lockPop = 0.9;
    popup("429: SPECIAL LOCKED", p.x + p.w / 2, p.y - 30, "#ff9b21", 18, 0.8);
  }
}

// ------------------------------------------------------- Damage & death -----
// damageEnemy() hook for every minion with a Hotfix shield, and the new
// types: returns the damage that gets through (0: none)
function preDamage2(e, amount, opts) {
  if (e.bubble) {
    if (e.bubble.dead) e.bubble = null; // its Hotfix is gone
    else if (!PLATE_DOT.has(opts.source)) {
      // the one-hit shield takes it (a finisher or a dash breaks through)
      popBubble2(e);
      popup("BLOCK", e.x + e.w / 2, e.y - 10, "#5aff7a", 18, 0.5);
      if (!opts.breaksGuard) return 0;
      amount *= 0.5;
    }
  }
  if (e.plates) amount = armorHit2(e, amount, opts);
  if (opts.breaksGuard && e.type === "ratelimiter") collapseField2(e);
  return amount;
}

// killEnemy() hook
function killEnemy2(e) {
  const c = centerOf(e);
  if (e.type === "forkbomb" && !e.child) forkChildren(e);
  else if (e.type === "hotfix") {
    for (let i = 0; i < enemies.length; i++) if (enemies[i].bubble === e) popBubble2(enemies[i]); // its patches go with it
  } else if (e.type === "monolith") {
    for (let i = 0; i < 3; i++) if (e.plates[i].hp > 0) throwPlate2(e, i);
    burst(c.x, c.y, 30, "#ffb020", 520);
    camera.shake = Math.max(camera.shake, 12);
    synth.play("plateBreak", { rate: 0.7 });
  } else if (e.type === "ratelimiter") {
    if (e.fieldR > 20) ring(c.x, fieldY2(e), e.fieldR, "#5aff7a");
    popup("200 OK", c.x, e.y - 20, "#5aff7a", 22, 0.9);
  }
}

// ----------------------------------------------------------------- Squads ---
SQUADS.push(
  // child processes from both sides: splash damage and a high floor help
  { id: "forkstorm", name: "FORK STORM", from: 60, make: () => [-1, 1].forEach((side) => [0, 80, 160].forEach((o) => spawnAt("forkbomb", side, o))) },
  // two Lobbers shelling you from behind a riot shield: flank, or shoot the packets down
  { id: "artillery", name: "ARTILLERY", from: 130, make: () => {
      const side = edgeSide();
      spawnAt("enforcer", side);
      spawnAt("lobber", side, 220);
      spawnAt("lobber", side, 360);
    } },
  // a Monolith kept alive by two Hotfixes: kill the medics first
  { id: "siege", name: "SIEGE", from: 175, make: () => {
      const side = edgeSide();
      spawnAt(countAlive("monolith") ? "ratelimiter" : "monolith", side);
      spawnAt("hotfix", side, 140);
      spawnAt("hotfix", side, 280);
    } }
);

// once a frame from updateEnemies(): fields, debris
function updateEnemies2(dt) {
  applyFields2(dt);
  limiters2.length = 0;
  updateDebris2(dt);
}

// --------------------------------------------------------------- Drawing ----
function frame2(e) {
  switch (e.type) {
    case "forkbomb":
      return e.state === "unfurl" ? 4 : e.state === "leap" ? 5 : ((Math.floor(e.spin) % 4) + 4) % 4;
    case "lobber":
      return e.firedT > 0 ? 3 : e.onGround && Math.abs(e.vx) > 25 ? 1 + (Math.floor(e.anim) % 2) : 0;
    case "monolith":
      return e.state === "slamWind" ? 4 : e.state === "slam" ? 5 : e.state === "chargeWind" || e.state === "charge" ? 6 : Math.abs(e.vx) > 15 ? 1 + (Math.floor(e.anim) % 2) : 3;
    case "hotfix":
      return e.tether1 && !e.downed ? 4 + (Math.floor(e.anim) % 2) : Math.floor(e.anim) % 4;
    default:
      return e.pulseT < 0.45 ? 3 : Math.abs(e.vx) > 20 ? 1 + (Math.floor(e.anim) % 2) : 0;
  }
}

// 0..1: how hard its telegraph flashes right now (0: no attack coming)
function tell2(e) {
  if (e.type === "forkbomb" && e.state === "unfurl") return 1;
  if (e.type === "monolith" && (e.state === "slamWind" || e.state === "chargeWind")) return 1;
  return 0;
}

function drawEnemy2(e, time) {
  const s = e.def.sheet;
  const img = IMG[s.img];
  const k = s.scale * e.size;
  const dw = s.fw * k;
  const dh = s.fh * k;
  const cx = e.x + e.w / 2;
  const dx = cx - dw / 2;
  const dy = e.def.walker ? e.y + e.h - dh : e.y + e.h / 2 - dh / 2;
  const flip = e.facing < 0;
  const f = frame2(e);
  let tint = null;
  if (e.hurt > 0) tint = "rgba(255,255,255,0.85)";
  else if (e.stun > 0) tint = "rgba(176,108,255,0.5)";
  else if (e.slowT > 0) tint = "rgba(90,255,122,0.35)";
  if (tell2(e) && !tint) {
    const pulse = 0.5 + 0.5 * Math.sin(time * 40);
    tint = (e.type === "monolith" ? TELL_AMBER : TELL_PINK)[Math.round(pulse * 7)];
    glow(cx, e.y + e.h * 0.6, Math.max(e.w, e.h) * 0.8, e.type === "monolith" ? "rgba(255,170,40,0.6)" : "rgba(255,47,214,0.6)", pulse);
  }
  if (e.elite) glow(cx, e.y + e.h / 2, Math.max(e.w, e.h) * 0.9, "rgba(255,200,40,0.45)");
  if (hj2(e)) glow(cx, e.y + e.h / 2, Math.max(e.w, e.h) * 0.8, "rgba(90,255,122,0.4)");
  drawUnder2(e, time, cx, dx, dy, k);
  const tumbling = e.downed && !e.downed.landed; // a Hotfix shot out of the sky
  if (e.downed) {
    ctx.save();
    ctx.translate(cx, e.y + e.h / 2);
    ctx.rotate(tumbling ? e.downed.spin : 0.6);
    ctx.translate(-cx, -(e.y + e.h / 2));
  }
  let jit = drawGlitch(img, f * s.fw, 0, s.fw, s.fh, dx, dy, dw, dh, flip, e.bob);
  if (e.glitchT > 0) {
    jit += rand(-9, 9);
    if (!perfMode()) {
      ctx.globalAlpha = 0.45;
      drawFrame(img, f * s.fw, 0, s.fw, s.fh, dx - 8, dy, dw, dh, "rgba(255,0,80,0.9)", flip);
      drawFrame(img, f * s.fw, 0, s.fw, s.fh, dx + 8, dy, dw, dh, "rgba(0,255,220,0.9)", flip);
      ctx.globalAlpha = 1;
    }
  }
  const ok = drawFrame(img, f * s.fw, 0, s.fw, s.fh, dx + jit, dy, dw, dh, tint, flip);
  if (ok && e.plates) drawPlates2(e, img, f, dx + jit, dy, k, tint, flip, time);
  if (e.downed) ctx.restore();
  if (!ok) {
    ctx.fillStyle = e.type === "monolith" ? "#8a80c0" : e.type === "hotfix" ? "#5aff7a" : e.type === "ratelimiter" ? "#ff9b21" : e.type === "lobber" ? "#ffb347" : "#ffe14d";
    ctx.fillRect(e.x, e.y, e.w, e.h);
  }
  if (e.bubble && !e.bubble.dead) drawBubble2(e, time);
  if (e.stun > 0) {
    const a = time * 6;
    if (!drawCell("fx", 6, 32, cx, e.y - 22, 40, 40, a)) hudText("*", cx, e.y - 22, 26, "#ffe14d", "center", "middle");
  }
  // health bar once damaged (and a Monolith's plates above it)
  if (e.hp < e.maxHp || e.plates) {
    const bw = e.type === "monolith" ? 90 : 60;
    ctx.fillStyle = "rgba(0,0,0,0.6)";
    ctx.fillRect(cx - bw / 2, e.y - 14, bw, 6);
    ctx.fillStyle = e.elite ? "#ffc828" : "#ff2457";
    ctx.fillRect(cx - bw / 2, e.y - 14, bw * Math.max(0, e.hp / e.maxHp), 6);
    if (e.plates) {
      for (let i = 0; i < 3; i++) {
        const p = e.plates[i];
        const px = cx - bw / 2 + i * 31;
        ctx.fillStyle = "rgba(0,0,0,0.6)";
        ctx.fillRect(px, e.y - 24, 28, 6);
        ctx.fillStyle = "#cdc8ef";
        if (p.hp > 0) ctx.fillRect(px, e.y - 24, 28 * (p.hp / p.max), 6);
      }
    }
  }
}

// The glows behind a sprite: the Lobber's loaded tube, the Hotfix's halo,
// the tower's emitter, a fork bomb's status LED
function drawUnder2(e, time, cx, dx, dy, k) {
  if (e.type === "lobber" && e.state === "plant") glow(muzzleX2(e), muzzleY2(e), 30 + 40 * (1 - e.stateT / e.def.shot.windup), "rgba(255,150,40,0.8)");
  else if (e.type === "hotfix") decorGlow(cx, e.y + 2, 26, "rgba(90,255,150,0.55)", 0.7 + 0.3 * Math.sin(time * 5 + e.bob));
  else if (e.type === "ratelimiter") glow(cx, e.y + 10, e.pulseT < 0.6 ? 70 : 34, e.collapseT > 0 ? "rgba(25,245,255,0.6)" : "rgba(255,150,40,0.7)", 0.6 + 0.4 * Math.sin(time * 9));
  else if (e.type === "monolith" && e.state === "slamWind") glow(cx + e.facing * 30, e.y + 20, 60, "rgba(255,176,32,0.7)", 0.7);
}

// A Monolith's plates from the second row of its sheet, and the core
// glowing through wherever a plate is gone
function drawPlates2(e, img, f, dx, dy, k, tint, flip, time) {
  const s = e.def.sheet;
  const oy = (MONO_DY[f] || 0) * k;
  for (let i = 0; i < 3; i++) {
    const p = e.plates[i];
    if (p.hp <= 0) {
      const at = PLATE_AT[i];
      const px = flip ? dx + (s.fw - at[0]) * k : dx + at[0] * k;
      glow(px, dy + oy + at[1] * k, (i === 0 ? 46 : 30) + 8 * Math.sin(time * 6), "rgba(255,150,40,0.75)");
      continue;
    }
    // a plate about to give glows hot
    drawFrame(img, i * s.fw, s.fh, s.fw, s.fh, dx, dy + oy, s.fw * k, s.fh * k, tint || (p.hp < p.max * 0.35 ? "rgba(255,90,40,0.3)" : null), flip);
  }
}

// The Hotfix's one-hit shield (any minion can carry one)
function drawBubble2(e, time) {
  const cx = e.x + e.w / 2;
  const cy = e.y + e.h / 2;
  const r = Math.max(e.w, e.h) * 0.62 + 6;
  glow(cx, cy, r * 1.15, "rgba(90,255,150,0.22)");
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  ctx.globalAlpha = 0.55 + 0.25 * Math.sin(time * 6 + e.bob);
  ctx.strokeStyle = "#7dffb0";
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.stroke();
  ctx.fillStyle = "#c8ffd8"; // a "+" patch on top
  ctx.fillRect(cx - 2, cy - r - 10, 4, 12);
  ctx.fillRect(cx - 6, cy - r - 6, 12, 4);
  ctx.restore();
}

// Behind every enemy: the 429 fields, the heal tethers, packet markers
function drawEnemies2Back(time) {
  for (let i = 0; i < enemies.length; i++) {
    const e = enemies[i];
    if (e.dead || !e.def.v2) continue;
    if (e.type === "ratelimiter") drawField2(e, time);
    else if (e.type === "hotfix" && !e.downed) {
      if (e.tether1) drawTether2(e, e.tether1, time);
      if (e.tether2) drawTether2(e, e.tether2, time);
    }
  }
  for (let i = 0; i < enemyShots.length; i++) if (enemyShots[i].kind === "packet") drawMarker2(enemyShots[i], time);
}

function drawField2(e, time) {
  const r = e.fieldR;
  if (r < 8) return;
  const x = e.x + e.w / 2;
  const y = fieldY2(e);
  if (x + r < camera.x || x - r > camera.x + W) return;
  const col = hj2(e) ? "#5aff7a" : "#ff9b21";
  ctx.save();
  ctx.globalAlpha = 0.09;
  ctx.fillStyle = col;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalCompositeOperation = "lighter";
  ctx.globalAlpha = 0.7;
  ctx.strokeStyle = col;
  ctx.lineWidth = 4;
  ctx.setLineDash(DASH2);
  ctx.lineDashOffset = -time * 60;
  ctx.stroke();
  ctx.setLineDash(NODASH2);
  if (e.pulseT < 0.7) {
    // the pulse front rolling out
    ctx.globalAlpha = 1 - e.pulseT / 0.7;
    ctx.lineWidth = 12;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.restore();
  if (perfMode()) return;
  decorGlow(x, y, r * 0.9, hj2(e) ? "rgba(90,255,122,0.12)" : "rgba(255,150,40,0.12)");
  for (let i = 0; i < 3; i++) {
    const a = time * 0.5 + i * 2.094;
    hudText("429", x + Math.cos(a) * r, y + Math.sin(a) * r, 18, col, "center", "middle");
  }
}

function drawTether2(e, a, time) {
  const x1 = e.x + e.w / 2;
  const y1 = e.y + e.h * 0.8;
  const x2 = a.x + a.w / 2;
  const y2 = a.y + a.h / 2;
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.quadraticCurveTo((x1 + x2) / 2, (y1 + y2) / 2 + 30 + 8 * Math.sin(time * 5), x2, y2);
  ctx.strokeStyle = "rgba(90,255,150,0.35)";
  ctx.lineWidth = 12;
  ctx.stroke();
  ctx.strokeStyle = "rgba(220,255,230,0.9)";
  ctx.lineWidth = 3;
  ctx.stroke();
  ctx.restore();
  // pulses of patch running down to the patient
  for (let i = 0; i < 3; i++) {
    const t = (time * 1.6 + i / 3) % 1;
    glow(x1 + (x2 - x1) * t, y1 + (y2 - y1) * t + 30 * 4 * t * (1 - t) * 0.5, 14, "rgba(150,255,180,0.9)");
  }
}

// In front of everything: plates flying off, "429" over throttled players
function drawEnemiesFront2() {
  const img = IMG.monolith;
  const s = ENEMY_TYPES.monolith.sheet;
  for (let i = 0; i < debris2.length; i++) {
    const d = debris2[i];
    const at = PLATE_AT[d.cell];
    ctx.save();
    ctx.globalAlpha = Math.min(1, d.life / 0.4);
    ctx.translate(d.x, d.y);
    ctx.rotate(d.rot);
    if (!drawFrame(img, d.cell * s.fw, s.fh, s.fw, s.fh, -(d.flip ? s.fw - at[0] : at[0]) * d.k, -at[1] * d.k, s.fw * d.k, s.fh * d.k, null, d.flip)) {
      ctx.fillStyle = "#8a80c0";
      ctx.fillRect(-20, -14, 40, 28);
    }
    ctx.restore();
  }
  for (let i = 0; i < coop.players.length; i++) {
    const p = coop.players[i].player;
    if (!(p.throttleT > 0) || p.hidden) continue;
    const x = p.x + p.w / 2 + 46;
    const y = p.y + 8;
    glow(x, y, 30, "rgba(255,150,40,0.5)", 0.6 + 0.4 * Math.sin(game.time * 10));
    hudText("429", x, y, 20, "#ff9b21", "center", "middle");
  }
}

// HUD (drawHUD, scaled): the throttle banner under the timer for player 1,
// under their panel for player 2
function drawEnemiesHud2(VW, time) {
  const two = coop.players.length > 1;
  const p1 = coop.players[0].player;
  if (p1.throttleT > 0 && !p1.hidden) throttleBanner2(VW / 2, 142, time, THROTTLE_LINES[two ? 1 : 0]);
  const c2 = coop.players[1];
  if (c2 && c2.player.throttleT > 0 && inWorld(c2)) throttleBanner2(VW - 244, 334, time, THROTTLE_LINES[2]);
}

function throttleBanner2(x, y, time, text) {
  hudText(text, x, y, 26, Math.sin(time * 10) > 0 ? "#ff9b21" : "#ff2457", "center");
  hudText("FIRE RATE -50%  SPECIAL LOCKED", x, y + 34, 14, "#ffe14d", "center");
}
