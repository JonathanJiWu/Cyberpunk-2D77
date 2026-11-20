"use strict";
// =============================================================================
// Getting into (and back into) the fight:
//   - THE DROP: every run starts with your Individual Contributor leaping off
//     a rooftop and slamming into the street in a superhero landing.
//   - LIVES: you have 3. Losing one "rolls back to the last stable build":
//     a short glitch-out, then you drop back in with full HP.
//   - HOT-SWAP: change Individual Contributor from the pause menu at any time
//     (levels, upgrades, lives and resource carry over).
// =============================================================================

const MAX_LIVES = 3; // in co-op, the team's shared pool
let intro = { active: false, phase: "", t: 0, vx: 0, vy: 0, kind: "drop" }; // per player in co-op (coop.js)
const LANDING_ROWS = { paine: 0, tetsu: 1, sudo: 2 };

// --------------------------------------------------------------- The drop ---
function startIntro(kind = "drop") {
  const p = player;
  intro.active = true;
  intro.kind = kind;
  intro.t = 0;
  // glitched out this long before the drop ("join": co-op player 2 dropping in)
  intro.downFor = kind === "join" ? 0.35 : coopActive() ? COOP.respawnDelay : 1.3;
  p.flameOn = false;
  p.dash = null;
  p.vx = p.vy = 0;
  input.buttons.flame = false;
  if (kind === "drop") {
    // perch on the tallest rooftop near the start, then leap off
    const roof = platforms.filter((pl) => pl.x < 900 && pl.x + pl.w > 120).reduce((a, b) => (!a || b.y < a.y ? b : a), null);
    p.x = roof ? roof.x + Math.min(40, roof.w / 4) : 200;
    p.y = (roof ? roof.y : GROUND_Y - 600) - p.h;
    p.facing = 1;
    intro.phase = "perch";
    camera.y = clamp(p.y + p.h / 2 - H * 0.5, WORLD_TOP, 0);
    camera.x = clamp(p.x - W * 0.3, 0, WORLD_W - W);
  } else {
    // respawn: fall in from the top of the screen
    intro.phase = "down";
  }
  director.firstSpawn = Math.max(director.firstSpawn, game.time + 3);
}

function skipIntro() {
  if (!intro.active) return;
  intro.active = false;
  player.y = GROUND_Y - player.h;
  player.vy = 0;
  player.onGround = true;
  player.standingOn = GROUND;
  player.hidden = false;
}

function updateIntro(dt) {
  const p = player;
  intro.t += dt;
  p.invuln = Math.max(p.invuln, 0.6);
  clearInput();
  switch (intro.phase) {
    case "perch": // a beat on the edge of the roof
      if (intro.t > 0.55) {
        intro.phase = "leap";
        intro.t = 0;
        intro.vx = 330;
        intro.vy = -620;
        squash(1.25, 0.8);
        dust(p.x + p.w / 2, p.y + p.h, 8);
        sfx.energy.play({ rate: 0.6 });
      }
      break;
    case "down": // dead: glitched out, waiting for the backup to load
      p.hidden = true;
      if (intro.t > intro.downFor) {
        p.hidden = false;
        const x = coopDropX(); // co-op: next to the partner
        if (x !== null) p.x = x;
        p.y = camera.y - p.h - 60;
        intro.phase = "leap";
        intro.t = 0;
        intro.vx = 0;
        intro.vy = 300;
        burst(p.x + p.w / 2, camera.y + 20, 20, CH().color, 300);
      }
      break;
    case "leap": // falling, straight through the platforms
      intro.vy = Math.min(intro.vy + TUNING.player.gravity * 1.15 * dt, 2200);
      p.x = clamp(p.x + intro.vx * dt, 0, WORLD_W - p.w);
      p.y += intro.vy * dt;
      p.facing = intro.vx < 0 ? -1 : 1;
      if (Math.random() < 0.6) p.trail.push({ x: p.x, y: p.y, frameX: 1, frameY: p.frameY, t: 0, dash: true });
      if (p.y >= GROUND_Y - p.h) heroLanding();
      break;
    case "land": // the superhero landing: hold the pose, then rise
      if (intro.t > 1.0) {
        intro.active = false;
        p.vy = 0;
        say(intro.kind === "respawn" ? "respawn" : "start", null, true);
        if (intro.kind === "drop" && coop.active === P1()) narrator.runStart(); // THE LEGEND's line for the run
      }
      break;
  }
}

function heroLanding() {
  const p = player;
  p.y = GROUND_Y - p.h;
  p.onGround = true;
  p.standingOn = GROUND;
  p.vx = p.vy = 0;
  intro.phase = "land";
  intro.t = 0;
  const cx = p.x + p.w / 2;
  const ground = GROUND_Y;
  // the impact: crater ring, dust, shockwave, screen shake
  ring(cx, ground - 10, 300, CH().color);
  ring(cx, ground - 10, 180, "#ffffff");
  dust(cx, ground, 30, 2.2);
  burst(cx, ground - 20, 26, CH().color, 520);
  camera.shake = Math.max(camera.shake, 20);
  if (coop.active.id) gamepads.rumble(coop.active.slot, 1, 0.6, 320); // co-op player 2's own pad
  else {
    game.hurtFlash = 0;
    game.landFlash = 0.25;
  }
  sfx.stomp.play({ rate: 0.7 });
  vibrate([30, 20, 60]);
  enemies.forEach((e) => {
    if (e.dead || e.boss) return;
    const c = centerOf(e);
    const d = Math.hypot(c.x - cx, c.y - ground);
    if (d > 320) return;
    damageEnemy(e, 30, { source: "stomp", kbX: Math.sign(c.x - cx || 1) * 700, kbY: -300 });
  });
}

// What the hero sheet should show during the drop (or null)
function introFrame() {
  const sheet = isReady(IMG.heroLanding2) ? IMG.heroLanding2 : IMG.heroLanding;
  if (!intro.active || !isReady(sheet)) return null;
  let fx;
  if (intro.phase === "leap") fx = 0;
  else if (intro.phase === "land") fx = intro.t < 0.12 ? 1 : intro.t < 0.75 ? 2 : 3;
  else return null;
  return { sheet, row: LANDING_ROWS[player.char] || 0, fx, tint: null, flip: player.facing < 0 };
}

// ------------------------------------------------------------------ Lives ---
function resetLives() {
  game.lives = MAX_LIVES;
  game.livesLost = 0;
}

// HP hit zero: roll back to the last stable build, or game over
function playerDown() {
  if (intro.active) return;
  resetKitState(); // e.g. a Time Dilation still running (kits.js)
  if (game.lives > 1) {
    game.lives--;
    game.livesLost++;
    const p = player;
    const pc = centerOf(p);
    burst(pc.x, pc.y, 40, CH().color, 520);
    burst(pc.x, pc.y, 20, "#ffffff", 300);
    ring(pc.x, pc.y, 200, "#ff2457");
    camera.shake = Math.max(camera.shake, 16);
    sfx.damage.play({ rate: 0.6 });
    vibrate(160);
    const line = HUMOR.respawn[Math.floor(Math.random() * HUMOR.respawn.length)];
    const who = coopActive() ? `${coop.active.label} DOWN // ` : "";
    game.banner = { text: `${who}${line} // ${game.lives} ${game.lives === 1 ? "LIFE" : "LIVES"} LEFT`, time: 2.6, color: "#ffe14d" };
    // give the player room: clear shots, push minions back
    enemyShots.length = 0;
    enemies.forEach((e) => {
      if (e.dead || e.boss) return;
      const c = centerOf(e);
      if (Math.abs(c.x - pc.x) < 700) {
        e.kbX = Math.sign(c.x - pc.x || 1) * 900;
        e.stun = Math.max(e.stun || 0, 1.5);
      }
    });
    p.hp = p.ghostHp = stats.maxHp;
    p.heat = Math.max(p.heat, 40);
    p.heatLocked = false;
    p.invuln = 3;
    p.lowHpSaid = false;
    startIntro("respawn");
    return;
  }
  if (coopKnockOut()) return; // co-op: out until the team gets a life back, while the partner fights on
  game.lives = 0;
  lose();
}

// ---------------------------------------------------------------- Hot-swap --
// For the bound player: in co-op, coop.js binds player 2 when their pad clicked
function switchCharacter(id) {
  if (!CHARACTERS[id] || id === player.char) return;
  const p = player;
  const ratio = p.hp / stats.maxHp;
  if (coop.active.id) coop.seat.char = id;
  else {
    settings.character = id;
    applySettings();
  }
  resetKitState(); // the old kit's Time Dilation / bow draw (kits.js)
  p.char = id;
  p.flameOn = false;
  p.dash = null;
  p.guard = 0;
  p.combo = 0;
  p.heatLocked = false;
  input.buttons.flame = false;
  input.specialQueued = false;
  sfx.flame.stopLoop();
  computeStats();
  p.hp = p.ghostHp = Math.max(1, Math.round(ratio * stats.maxHp));
  const pc = centerOf(p);
  burst(pc.x, pc.y, 30, CH().color, 420);
  ring(pc.x, pc.y, 160, CH().color);
  p.speechCd = 0;
  say("start", null, true);
  game.banner = { text: `${coopActive() ? coop.active.label + " " : ""}HOT-SWAP // ${CH().name} DEPLOYED`, time: 1.6, color: CH().color };
}
