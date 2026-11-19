"use strict";
// =============================================================================
// HIJACK: Hackerman's EMP takes over enemies for a few seconds ("PWNED").
// Every System Glitch burst (kits.js: an EM hit's glitch, the "EMP") also
// rolls hijackChance(): on a hit the nearest enemies inside the burst switch
// sides for a while. A hijacked enemy ("pawn"):
//   - goes after the nearest enemy (nav.js routes, its own attacks: contact,
//     shots, bomber blasts, shockwaves) and never hurts a player
//   - taunts: enemies close to it go after IT instead of you
//   - is friendly: player attacks pass through it (no auto-aim, no damage)
//   - deals "hijack" damage (no heat/RAM/Time Dilation bonus: no farming),
//     takes "enemy" damage; its kills still drop XP
//   - can't glitch or hijack anything itself (no loops)
// When it runs out it reboots (a short stun), is "patched" (immune) for a
// while and goes back to its old side. Bosses, NULL's copies and anything
// marked `compromise: "immune"` can't be hijacked; elites and
// `compromise: "resist"` ones are harder (half the chance and the time).
//
// Contract with other enemy code: e.hijackT > 0 / isHijacked(e) means it
// fights for the players; sameTeam(a, b) for friend-or-foe effects; attacks
// go through the team-aware paths (body contact in updateEnemy,
// fireEnemyShot(..., owner), spawnShockwave(..., { owner }), bomber blasts);
// hijackInherit(parent, child) for anything spawned by a hijacked enemy.
// =============================================================================

// Every number in one place, for balancing (bot sims). [base, per level, max]
const HIJACK = {
  chance: [0.3, 0.01, 0.55], // per System Glitch burst
  perBurst: [10, 20], // 1 enemy per burst, +1 at each of these levels
  cap: [2, 8, 4], // hijacked at once: 2, +1 every 8 levels, at most 4 (shared in co-op)
  duration: [4, 0.1, 7], // s
  resist: 0.5, // elites and `compromise: "resist"`: chance and time x this
  patched: 8, // s immune once it's over
  reboot: 0.4, // s stunned as it goes back to its old side
  seek: 900, // px: a pawn goes after enemies this close (else it trails you)
  taunt: [260, 4, 380], // px: enemies this close to a pawn go after it
  bossGlitchCd: 2.5, // s between two System Glitch stutters on a boss (it used to stutter ~38% of a fight)
};
const HIJACK_COLOR = "#5aff7a";
const hijackPawns = []; // the hijacked enemies this frame (updateHijack)
const hijackStats = { hijacks: 0, denied: 0, ended: 0, peak: 0 };

const isHijacked = (e) => !!e && e.hijackT > 0;
// Friend or foe: the players' side is the hijacked enemies, the other side everyone else
const sameTeam = (a, b) => isHijacked(a) === isHijacked(b);
const hijackScale = (t, lv = playerLevel()) => Math.min(t[2], t[0] + t[1] * (lv - 1));
const hijackChance = () => hijackScale(HIJACK.chance);
const hijackCap = () => Math.min(HIJACK.cap[2], HIJACK.cap[0] + Math.floor(playerLevel() / HIJACK.cap[1]));
const hijackPerBurst = () => 1 + HIJACK.perBurst.filter((lv) => playerLevel() >= lv).length;
const hijackTime = () => hijackScale(HIJACK.duration);
const tauntRadius = () => hijackScale(HIJACK.taunt);
const hijackImmune = (e) => !!(e.boss || e.decoy || (e.def && e.def.compromise === "immune"));
const hijackResists = (e) => !!(e.elite || (e.def && e.def.compromise === "resist"));

// A System Glitch burst at (x, y), radius r (the bound player is the Hackerman
// who fired it). One roll per burst; on a hit the nearest enemies inside go.
const hijackPick = [];
function tryHijack(x, y, r) {
  let room = hijackCap() - hijackPawns.length;
  hijackPick.length = 0;
  for (const e of enemies) {
    if (e.dead || isHijacked(e)) continue;
    const c = centerOf(e);
    const d = Math.hypot(c.x - x, c.y - y);
    if (d > r) continue;
    if (hijackImmune(e)) {
      if (!e.deniedShown) {
        e.deniedShown = true; // (once per enemy: it's a tell, not spam)
        hijackStats.denied++;
        popup("ACCESS DENIED", c.x, e.y - 30, "#ff2457", 18, 0.8);
      }
      continue;
    }
    if (e.patchT > 0 || e.downed) continue;
    e.hijackD = d;
    hijackPick.push(e);
  }
  if (room <= 0 || !hijackPick.length || Math.random() >= hijackChance()) return 0;
  hijackPick.sort((a, b) => a.hijackD - b.hijackD);
  let n = 0;
  const most = hijackPerBurst();
  for (const e of hijackPick) {
    if (n >= most || room <= 0) break;
    const resist = hijackResists(e);
    if (resist && Math.random() >= HIJACK.resist) continue; // (half the chance)
    hijack(e, hijackTime() * (resist ? HIJACK.resist : 1), x, y);
    n++;
    room--;
  }
  return n;
}

function hijack(e, time, fromX, fromY) {
  e.hijackT = e.hijackMax = time;
  e.forcedTarget = null;
  e.retargetT = 0;
  // whatever it was winding up at you is cancelled
  e.windup = e.dashT = e.bash = e.charge = e.aimT = 0;
  hijackPawns.push(e);
  hijackStats.hijacks++;
  hijackStats.peak = Math.max(hijackStats.peak, hijackPawns.length);
  const c = centerOf(e);
  if (fromX !== undefined) kitFx.push({ type: "tether", x: fromX, y: fromY, e, life: 0.35, max: 0.35 });
  burst(c.x, c.y, 12, HIJACK_COLOR, 260);
  popup("PWNED", c.x, e.y - 30, HIJACK_COLOR, 22, 0.9);
  synth.play("hijack");
}

// Its time is up: a short reboot, patched for a while, back to its old side
function endHijack(e) {
  e.hijackT = 0;
  e.patchT = HIJACK.patched;
  e.patchFx = 0.5;
  e.stun = Math.max(e.stun || 0, HIJACK.reboot);
  e.forcedTarget = null;
  e.windup = e.dashT = e.bash = e.charge = e.aimT = e.fuse = 0;
  hijackStats.ended++;
  const c = centerOf(e);
  burst(c.x, c.y, 10, "#ffffff", 220);
  popup("PATCHED", c.x, e.y - 30, "#c9b6ff", 18, 0.7);
  synth.play("hijackEnd");
}

// Something a hijacked enemy spawns (a fork bomb's children...) joins its side
// for the time the parent has left
function hijackInherit(parent, child) {
  if (!isHijacked(parent) || hijackImmune(child)) return;
  child.hijackT = child.hijackMax = parent.hijackT;
  child.forcedTarget = null;
  child.retargetT = 0;
  hijackPawns.push(child);
}

const hijackDist = (a, b) => Math.hypot(a.x + a.w / 2 - b.x - b.w / 2, a.y + a.h / 2 - b.y - b.h / 2);

// Once a frame (updateEnemies), on real time: Time Dilation and slow-mo don't
// slow your pawns. Timers, who the pawns fight, and who they taunt.
function updateHijack(dt) {
  hijackPawns.length = 0;
  for (const e of enemies) {
    if (e.dead) continue;
    if (e.patchT > 0) e.patchT -= dt;
    if (e.patchFx > 0) e.patchFx -= dt;
    if (e.boss && e.glitchLock > 0) e.glitchLock -= dt;
    if (!(e.hijackT > 0)) continue;
    e.hijackT -= dt;
    if (e.hijackT <= 0) endHijack(e);
    else hijackPawns.push(e);
  }
  if (!hijackPawns.length) {
    // (nobody to taunt for: let go of any pawn that's gone)
    for (const e of enemies) if (e.forcedTarget && !isHijacked(e.forcedTarget) && !e.boss) e.forcedTarget = null;
    return;
  }
  // a pawn picks a fight: the nearest enemy it can reach (not a boss)
  for (const p of hijackPawns) {
    const t = p.forcedTarget;
    p.retargetT = (p.retargetT || 0) - dt;
    if (t && !t.dead && !isHijacked(t) && p.retargetT > 0) continue;
    p.retargetT = 0.5;
    let best = null;
    let bd = HIJACK.seek;
    for (const o of enemies) {
      if (o.dead || o.boss || isHijacked(o)) continue;
      const d = hijackDist(p, o);
      if (d < bd) {
        bd = d;
        best = o;
      }
    }
    p.forcedTarget = best; // (null: it trails the nearest player)
  }
  // taunt: enemies close to a pawn go after it instead of you
  const R = tauntRadius();
  for (const e of enemies) {
    if (e.dead || e.boss || isHijacked(e)) continue;
    const cur = e.forcedTarget;
    if (cur && (cur.dead || !isHijacked(cur))) e.forcedTarget = null;
    if (e.forcedTarget && hijackDist(e, e.forcedTarget) < R * 1.3) continue; // (sticks a little)
    let best = null;
    let bd = R;
    for (const p of hijackPawns) {
      const d = hijackDist(e, p);
      if (d < bd) {
        bd = d;
        best = p;
      }
    }
    e.forcedTarget = best;
  }
}

// System Glitch on a boss: a stutter at most every bossGlitchCd seconds
function hijackBossGlitch(e) {
  if (e.glitchLock > 0) return false;
  e.glitchLock = HIJACK.bossGlitchCd;
  return true;
}

// The "PWNED" tag over a hijacked enemy: the time it has left as a ring
function drawHijackTag(e, time) {
  const cx = e.x + e.w / 2;
  const y = e.y - 30;
  const k = clamp(e.hijackT / (e.hijackMax || 1), 0, 1);
  ctx.strokeStyle = "rgba(90,255,122,0.35)";
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.arc(cx - 62, y, 11, 0, Math.PI * 2);
  ctx.stroke();
  ctx.strokeStyle = HIJACK_COLOR;
  ctx.beginPath();
  ctx.arc(cx - 62, y, 11, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * k);
  ctx.stroke();
  const blink = e.hijackT < 1 && Math.sin(time * 30) > 0; // about to wear off
  hudText("PWNED", cx - 44, y, 16, blink ? "#ffffff" : HIJACK_COLOR, "left", "middle");
}
