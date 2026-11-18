"use strict";
// =============================================================================
// Boss 1: the OVERSEER. Cyber City's security AI printed itself a combat
// chassis and now fights like a rival Individual Contributor: it runs, double
// jumps onto rooftops, drops down after you, and every attack is telegraphed:
//   burst   plants, charges the arm cannon (glow), fires an aimed burst
//   dash    crouches and flashes, then dashes straight through you
//   slam    leaps at you and slams down: shockwaves roll both ways (jump!)
//   laser   braces, the eye charges (thin red line), then sweeps a beam...
//   vent    ...and overheats: kneels with its core exposed (+50% damage)
//   taunt   strikes a pose and talks trash
// Below half health it rages: faster, longer bursts, double dashes/slams.
// =============================================================================

const OVERSEER = {
  w: 96,
  h: 214,
  scale: 2.5, // the 64x96 sprite is drawn at 160x240
  speed: [380, 470], // normal, raging
  contact: 26,
  burstDamage: 16,
  burstSpeed: 820,
  dashDamage: 36,
  dashSpeed: 1500,
  slamDamage: 24,
  beamDamage: 32,
  beamWidth: 30,
  vent: [2.8, 2.2],
};

function spawnOverseer() {
  director.stage = STAGE.overseer;
  const pc = centerOf(player);
  const side = pc.x < WORLD_W / 2 ? 1 : -1;
  const x = clamp(pc.x + side * 520 - OVERSEER.w / 2, 40, WORLD_W - OVERSEER.w - 40);
  const e = makeBoss("overseer", OVERSEER.w, OVERSEER.h, x, camera.y - 260);
  e.vy = 900;
  e.facing = -side;
  e.trail = [];
  enemies.push(e);
  game.boss = e;
  bossIntro(e, 3.4);
  say("boss", null, true);
}

function overseerDefeated(e) {
  director.stage = STAGE.interlude1;
  director.nextBossAt = game.time + TUNING.boss.overseerDelay;
  game.boss = null;
  game.bossesDefeated = (game.bossesDefeated || 0) + 1;
  game.slowmo = { time: 1.2, scale: 0.3 };
  game.banner = { text: "OVERSEER DOWN // NOTHING IS WATCHING YOU", time: 3, color: "#19f5ff" };
  music.setIntensity(1);
  shockwaves.length = 0;
  player.hp = Math.min(stats.maxHp, player.hp + 30);
  popup("+30 HP", player.x + player.w / 2, player.y - 30, "#ff2f6d", 26, 1.4);
  spawnPowerup(player.x + player.w / 2, player.y - 200);
}

function chooseOverseerAttack(e) {
  const pc = centerOf(player);
  const ec = centerOf(e);
  const sameLevel = Math.abs(pc.y - ec.y) < 160;
  const options = [
    ["burst", 3],
    ["slam", 2],
    ["laser", e.sinceLaser > 2 ? 2.5 : 0.8],
    ["dash", sameLevel && Math.abs(pc.x - ec.x) < 1000 ? 2.2 : 0],
    ["taunt", 0.35],
  ].filter(([s, w]) => w > 0 && s !== e.lastAttack);
  const next = weightedPick(options);
  e.lastAttack = next;
  e.sinceLaser = next === "laser" ? 0 : (e.sinceLaser || 0) + 1;
  bossState(e, next);
}

const eyeOf = (e) => ({ x: e.x + e.w / 2 + e.facing * 10, y: e.y + 34 });
const cannonOf = (e) => ({ x: e.x + e.w / 2 + e.facing * 74, y: e.y + 92 });

function updateOverseer(e, dt) {
  bossTimers(e, dt);
  const rage = e.enraged;
  const R = rage ? 1 : 0;
  const pc = centerOf(player);
  const ec = centerOf(e);
  const blind = player.camo > 0;
  if (!rage && e.hp <= e.maxHp * 0.5) {
    e.enraged = true;
    game.banner = { text: "OVERSEER: THREAT LEVEL MAXIMUM", time: 2.2, color: "#ff2457" };
    camera.shake = Math.max(camera.shake, 14);
    burst(ec.x, ec.y, 40, "#ff2457", 600);
    bossSay(e, BOSSES.overseer.hurtLines[0], true);
  }
  // remember a few positions for dash afterimages
  if (e.state === "dash" && e.step === 1) e.trail.push({ x: e.x, y: e.y, frame: 7, facing: e.facing, t: 0 });
  e.trail.forEach((t) => (t.t += dt));
  while (e.trail.length && e.trail[0].t > 0.25) e.trail.shift();

  if (e.stun > 0 && e.state !== "vent" && e.state !== "intro") {
    e.vx *= Math.exp(-8 * dt);
    if (e.beam) {
      e.beam = null; // a stun cancels the laser
      bossState(e, "move");
    }
    bossPhysics(e, dt);
    return;
  }

  let gravity = BOSS_GRAVITY;
  let contact = OVERSEER.contact;
  switch (e.state) {
    case "intro": {
      e.vx = 0;
      if (e.onGround && !e.landedIntro) {
        e.landedIntro = true;
        ring(ec.x, e.y + e.h, 260, "#19f5ff");
        dust(ec.x, e.y + e.h, 30, 2.4);
        camera.shake = Math.max(camera.shake, 22);
        sfx.stomp.play({ rate: 0.5 });
      }
      if (!bossLocked()) bossState(e, "move");
      contact = 0;
      break;
    }
    case "move": {
      const pref = rage ? 300 : 430;
      const side = ec.x < pc.x ? -1 : 1;
      const targetX = blind ? ec.x + e.facing * 200 : pc.x + side * pref;
      bossNavigate(e, dt, targetX, OVERSEER.speed[R]);
      if (!blind && e.stateTime > (rage ? 0.4 : 0.7) && e.onGround) chooseOverseerAttack(e);
      break;
    }
    case "burst": {
      // plant, charge the cannon, then an aimed burst
      e.vx *= Math.exp(-12 * dt);
      faceThePlayer(e);
      const tele = rage ? 0.32 : 0.45;
      const shots = rage ? 5 : 3;
      if (e.stateTime > tele) {
        e.timer -= dt;
        if (e.timer <= 0 && e.step < shots) {
          const c = cannonOf(e);
          if (!blind) fireEnemyShot(c.x, c.y, { kind: "laser", damage: OVERSEER.burstDamage, speed: OVERSEER.burstSpeed, radius: 13 });
          burst(c.x, c.y, 4, "#19f5ff", 200);
          e.vx -= e.facing * 60; // recoil
          e.step++;
          e.timer = 0.12;
        }
        if (e.step >= shots && e.timer <= -0.25) bossState(e, "move");
      }
      break;
    }
    case "dash": {
      if (e.step === 0) {
        // the windup: crouch and flash
        e.vx *= Math.exp(-14 * dt);
        faceThePlayer(e);
        if (e.stateTime > (rage ? 0.32 : 0.45)) {
          e.step = 1;
          e.timer = 0.32;
          e.vx = e.facing * OVERSEER.dashSpeed;
          sfx.stomp.play({ rate: 1.5 });
          dust(ec.x, e.y + e.h, 10, 1.8);
        }
      } else if (e.step === 1) {
        e.vx = e.facing * OVERSEER.dashSpeed;
        gravity = 0;
        e.vy = 0;
        contact = OVERSEER.dashDamage;
        e.timer -= dt;
        if (e.timer <= 0) {
          e.step = 2;
          e.timer = 0.45;
          e.dashes = (e.dashes || 0) + 1;
        }
      } else {
        e.vx *= Math.exp(-10 * dt);
        e.timer -= dt;
        if (e.timer <= 0) {
          if (rage && e.dashes < 2) {
            e.step = 0;
            e.stateTime = 0.15; // a quicker second windup
          } else {
            e.dashes = 0;
            bossState(e, "move");
          }
        }
      }
      break;
    }
    case "slam": {
      if (e.step === 0) {
        // leap at the player
        e.vy = -1450;
        e.vx = clamp((pc.x - ec.x) / 0.95, -950, 950);
        e.onGround = false;
        e.step = 1;
        dust(ec.x, e.y + e.h, 12, 1.6);
      } else if (e.step === 1) {
        // at the top of the arc (or over the player), drive down
        if (e.vy > -200 && (Math.abs(pc.x - ec.x) < 120 || e.vy > 300)) {
          e.step = 2;
          e.vx = 0;
          e.vy = 2300;
        }
        if (e.onGround && e.stateTime > 0.2) e.step = 2;
      } else if (e.step === 2) {
        e.vx = 0;
        gravity = 4200;
        if (e.onGround) {
          const fy = e.y + e.h;
          spawnShockwave(ec.x, fy, -1, { damage: OVERSEER.slamDamage, color: "#19f5ff" });
          spawnShockwave(ec.x, fy, 1, { damage: OVERSEER.slamDamage, color: "#19f5ff" });
          ring(ec.x, fy, 200, "#19f5ff");
          dust(ec.x, fy, 24, 2.2);
          camera.shake = Math.max(camera.shake, 14);
          sfx.stomp.play({ rate: 0.6 });
          e.step = 3;
          e.timer = 0.5;
          e.slams = (e.slams || 0) + 1;
        }
      } else {
        e.timer -= dt;
        if (e.timer <= 0) {
          if (rage && e.slams < 2) bossState(e, "slam");
          else {
            e.slams = 0;
            bossState(e, "move");
          }
        }
      }
      break;
    }
    case "laser": {
      e.vx *= Math.exp(-12 * dt);
      const eye = eyeOf(e);
      const charge = rage ? 0.75 : 1.0;
      const sweep = rage ? 0.9 : 1.15;
      if (e.stateTime < charge) {
        // track the player until the last moment
        if (e.stateTime < charge - 0.25 || !e.beam) {
          faceThePlayer(e);
          const aim = Math.atan2(pc.y - eye.y, pc.x - eye.x);
          const dir = Math.random() < 0.5 ? -1 : 1;
          e.beam = { from: aim - 0.5 * dir, to: aim + 0.5 * dir, angle: aim, on: false };
        }
      } else {
        if (!e.beam) e.beam = { from: 0, to: 0, angle: 0, on: false };
        if (!e.beam.on) {
          e.beam.on = true;
          sfx.chain.play({ rate: 0.6 });
        }
        const k = Math.min(1, (e.stateTime - charge) / sweep);
        e.beam.angle = e.beam.from + (e.beam.to - e.beam.from) * k;
        if (!blind && !bossLocked() && beamHitsFrom(eye, e.beam.angle, OVERSEER.beamWidth)) hurtPlayer(OVERSEER.beamDamage, eye.x, eye.y);
        if (Math.random() < 0.5) {
          const gx = eye.x + Math.cos(e.beam.angle) * 900;
          const gy = Math.min(GROUND_Y, eye.y + Math.sin(e.beam.angle) * 900);
          burst(gx, gy, 2, "#19f5ff", 200);
        }
        if (k >= 1) {
          e.beam = null;
          bossState(e, "vent");
          e.vulnT = OVERSEER.vent[R];
          popup("CORE EXPOSED", clamp(ec.x, camera.x + 200, camera.x + W - 200), Math.max(e.y - 40, camera.y + 200), "#ffe14d", 28, 1.2);
          sfx.chain.play({ rate: 1.4 });
          if (Math.random() < 0.6) bossSay(e, BOSSES.overseer.hurtLines[1]);
        }
      }
      break;
    }
    case "vent": {
      // overheated: kneels, steams, takes extra damage, harmless to touch
      e.vx *= Math.exp(-12 * dt);
      contact = 0;
      if (Math.random() < 0.5) particles.push({ x: ec.x + rand(-50, 50), y: e.y + rand(40, 120), vx: rand(-50, 50), vy: rand(-180, -80), life: rand(0.4, 0.8), size: rand(8, 14), color: "#cfd8ff" });
      if (e.stateTime > OVERSEER.vent[R]) bossState(e, Math.random() < 0.3 ? "taunt" : "move");
      break;
    }
    case "taunt": {
      e.vx *= Math.exp(-12 * dt);
      faceThePlayer(e);
      if (e.step === 0) {
        e.step = 1;
        bossTaunt(e);
        e.speechCd = 0;
        bossSay(e, BOSSES.overseer.taunts[1 + Math.floor(Math.random() * (BOSSES.overseer.taunts.length - 1))], true);
      }
      if (e.stateTime > 0.9) bossState(e, "move");
      break;
    }
  }
  bossPhysics(e, dt, gravity);
  if (contact) bossContact(e, contact);
}

// Is the player inside a beam fired from `from` at `angle`?
function beamHitsFrom(from, angle, width) {
  const pc = centerOf(player);
  const ux = Math.cos(angle);
  const uy = Math.sin(angle);
  const px = pc.x - from.x;
  const py = pc.y - from.y;
  if (px * ux + py * uy < 0) return false;
  return Math.abs(px * uy - py * ux) < width + player.w / 2;
}

function overseerFrame(e) {
  switch (e.state) {
    case "intro":
      return e.onGround ? (bossLocked() && e.stateTime > 1 ? 12 : 10) : 6;
    case "burst":
      return 8;
    case "dash":
      return 7;
    case "slam":
      return e.step >= 3 ? 10 : 6;
    case "laser":
      return 9;
    case "vent":
      return 11;
    case "taunt":
      return 12;
  }
  if (!e.onGround) return 6;
  if (e.hurt > 0.08) return 13;
  if (Math.abs(e.vx) > 60) return 2 + (Math.floor(e.anim * 10) % 4);
  return Math.floor(e.anim * 2) % 2;
}

function drawOverseer(e, time) {
  const c = centerOf(e);
  const eye = eyeOf(e);
  // the beam (or its telegraph line)
  if (e.beam) {
    const len = 2400;
    const ex = eye.x + Math.cos(e.beam.angle) * len;
    const ey = eye.y + Math.sin(e.beam.angle) * len;
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    ctx.lineCap = "round";
    const layers = e.beam.on
      ? [
          [OVERSEER.beamWidth * 2.6, "rgba(255,47,214,0.25)"],
          [OVERSEER.beamWidth * 1.4, "rgba(25,245,255,0.6)"],
          [OVERSEER.beamWidth * 0.45, "rgba(255,255,255,0.95)"],
        ]
      : [[3 + 2 * Math.sin(time * 30), "rgba(255,40,70,0.8)"]];
    layers.forEach(([w, color]) => {
      ctx.strokeStyle = color;
      ctx.lineWidth = w;
      ctx.beginPath();
      ctx.moveTo(eye.x, eye.y);
      ctx.lineTo(ex, ey);
      ctx.stroke();
    });
    ctx.restore();
  }
  glow(c.x, c.y, 200, e.enraged ? "rgba(255,30,70,0.35)" : "rgba(25,245,255,0.25)");
  const img = IMG.overseerAvatar;
  const s = OVERSEER.scale;
  const dw = 64 * s;
  const dh = 96 * s;
  const bottom = e.y + e.h;
  const dy = bottom - 95 * s;
  const frame = overseerFrame(e);
  // dash afterimages
  e.trail.forEach((t) => {
    ctx.globalAlpha = 0.35 * (1 - t.t / 0.25);
    drawFrame(img, t.frame * 64, 0, 64, 96, t.x + e.w / 2 - dw / 2, t.y + e.h - 95 * s, dw, dh, "rgba(25,245,255,0.8)", t.facing < 0);
  });
  ctx.globalAlpha = 1;
  // telegraphs
  if (e.state === "burst" && e.step === 0) {
    const cn = cannonOf(e);
    glow(cn.x, cn.y, 40 + 30 * Math.min(1, e.stateTime / 0.45), "rgba(25,245,255,0.9)");
  }
  if (e.state === "laser" && !(e.beam && e.beam.on)) glow(eye.x, eye.y, 50 + 40 * Math.sin(time * 30), "rgba(255,255,255,0.9)");
  if (e.state === "vent") glow(c.x, e.y + 100, 90, "rgba(255,225,77,0.85)", 0.6 + 0.4 * Math.sin(time * 12));
  let tint = null;
  if (e.hurt > 0) tint = "rgba(255,255,255,0.8)";
  else if (e.stun > 0) tint = "rgba(176,108,255,0.5)";
  else if (e.state === "dash" && e.step === 0) tint = `rgba(255,47,214,${0.3 + 0.3 * Math.sin(time * 50)})`;
  else if (e.enraged) tint = "rgba(255,0,40,0.18)";
  const jitter = drawGlitch(img, frame * 64, 0, 64, 96, c.x - dw / 2, dy, dw, dh, e.facing < 0, 2.3);
  if (!drawFrame(img, frame * 64, 0, 64, 96, c.x - dw / 2 + jitter, dy, dw, dh, tint, e.facing < 0)) {
    // fallback: a dark body with the old floating eye as its head
    ctx.fillStyle = "#1b1530";
    ctx.fillRect(e.x + 10, e.y + 70, e.w - 20, e.h - 70);
    ctx.fillStyle = e.enraged ? "#ff2457" : "#19f5ff";
    ctx.fillRect(e.x + 10, e.y + 120, e.w - 20, 6);
    if (!drawFrame(IMG.overseer, (e.enraged ? 3 : 0) * 96, 0, 96, 96, c.x - 60, e.y - 20, 120, 120, tint)) hexagon(c.x, e.y + 30, 40, "#19f5ff", 6);
  }
  drawBossSpeech(e, "#19f5ff");
}
