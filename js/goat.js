"use strict";
// =============================================================================
// The FINAL BOSS: the Demon GOAT (Greatest Of All Threats). A towering cyber
// demon that crashes down from a burning sky and fights on the ground:
//   charge   paws the ground (dust, red eyes), then stampedes across the
//            street. Make it miss and it slams into the wall: DAZED (+50%).
//   leap     crouches, leaps at you, lands with a quake: shockwaves both ways
//   breath   rears back (mouth glows), then sweeps a cone of fire
//   rain     (enraged) roars and calls down meteors: red markers, then impact
// Phases: 100-60% normal / below 60% ENRAGED (faster, meteors) /
//         below 25% FINAL FORM (everything at once, meteor drizzle).
// =============================================================================

const GOAT = {
  w: 170,
  h: 250,
  scale: 3.4, // 96x96 sprite drawn at 326x326
  walk: [230, 290, 340], // per phase
  contact: 34,
  chargeSpeed: [1050, 1200, 1350],
  chargeDamage: 42,
  stompDamage: 30,
  breathDamage: 11,
  meteorDamage: 24,
};
const meteors = []; // { x, t, delay } ground markers before a meteor drops

function spawnGoat() {
  director.stage = 3;
  const pc = centerOf(player);
  const side = pc.x < WORLD_W / 2 ? 1 : -1;
  const x = clamp(pc.x + side * 560 - GOAT.w / 2, 40, WORLD_W - GOAT.w - 40);
  const e = makeBoss("goat", GOAT.w, GOAT.h, x, camera.y - 420);
  e.vy = 1100;
  e.facing = -side;
  e.phase = 0;
  enemies.push(e);
  game.boss = e;
  game.goatSky = 0.01; // the sky starts to burn
  bossIntro(e, 4);
  say("boss2", null, true);
}

function goatDefeated(e) {
  game.bossesDefeated = (game.bossesDefeated || 0) + 1;
  game.goatDeath = { x: e.x, y: e.y, w: e.w, h: e.h, facing: e.facing, t: 0 };
  game.boss = null;
  game.slowmo = { time: 2.2, scale: 0.2 };
  game.banner = { text: "THE G.O.A.T. HAS FALLEN", time: 2.4, color: "#ffe14d" };
  enemyShots.length = 0;
  shockwaves.length = 0;
  meteors.length = 0;
  player.invuln = Math.max(player.invuln, 3);
  camera.shake = 30;
}

// The death sequence: kneel, explode a few times, then the win screen
function updateGoatDeath(dt) {
  const d = game.goatDeath;
  if (!d) return;
  d.t += dt;
  if (Math.random() < dt * 8) {
    const x = d.x + rand(0, d.w);
    const y = d.y + rand(0, d.h);
    burst(x, y, 18, Math.random() < 0.5 ? "#ff2457" : "#ffe14d", 500);
    camera.shake = Math.max(camera.shake, 10);
    sfx.stomp.play({ rate: rand(0.5, 0.9) });
  }
  if (d.t > 2.2) {
    game.goatDeath = null;
    win();
  }
}

function goatPhaseCheck(e, ec) {
  const frac = e.hp / e.maxHp;
  const next = frac <= 0.25 ? 2 : frac <= 0.6 ? 1 : 0;
  if (next <= e.phase) return;
  e.phase = next;
  e.enraged = true;
  bossState(e, "roar");
  e.roarFor = next === 2 ? 1.8 : 1.4;
  game.banner = next === 2 ? { text: "FINAL FORM // GREATEST OF ALL THREATS", time: 2.6, color: "#ff2457" } : { text: "THE GOAT IS ENRAGED!", time: 2, color: "#ff2457" };
  bossSay(e, BOSSES.goat.hurtLines[next === 2 ? 1 : 0], true);
  burst(ec.x, ec.y, 50, "#ff2457", 700);
  enemyShots.length = 0;
}

function chooseGoatAttack(e) {
  const pc = centerOf(player);
  const ec = centerOf(e);
  const sameLevel = Math.abs(pc.y - ec.y) < 220;
  const far = Math.abs(pc.x - ec.x) > 520;
  const options = [
    ["charge", sameLevel ? 3 : 0.5],
    ["leap", sameLevel ? 2 : 4],
    ["breath", !far && sameLevel ? 2.5 : 0.6],
    ["rain", e.phase >= 1 ? 2 : 0],
  ].filter(([s, w]) => w > 0 && s !== e.lastAttack);
  const next = weightedPick(options);
  e.lastAttack = next;
  bossState(e, next);
}

const mouthOf = (e) => ({ x: e.x + e.w / 2 + e.facing * 120, y: e.y + 66 });

function queueMeteors(n, spread) {
  const pc = centerOf(player);
  for (let i = 0; i < n; i++) {
    const x = clamp(pc.x + rand(-spread, spread), 40, WORLD_W - 40);
    meteors.push({ x, y: surfaceBelow(x, player.y), t: 0, delay: 0.9 + i * 0.14 });
  }
}

function updateMeteors(dt) {
  for (let i = meteors.length - 1; i >= 0; i--) {
    const m = meteors[i];
    m.t += dt;
    if (m.t >= m.delay) {
      meteors.splice(i, 1);
      enemyShots.push({ owner: game.boss, x: m.x + rand(-40, 40), y: camera.y - 60, vx: rand(-60, 60), vy: 1500, r: 22, damage: GOAT.meteorDamage, kind: "meteor", angle: Math.PI / 2, life: 2 });
    }
  }
}

function updateGoat(e, dt) {
  bossTimers(e, dt);
  updateMeteors(dt);
  const P = e.phase;
  const pc = centerOf(player);
  const ec = centerOf(e);
  const blind = player.camo > 0;
  if (e.state !== "intro") goatPhaseCheck(e, ec);
  if (P === 2 && !blind && (e.drizzle = (e.drizzle || 0) - dt) <= 0) {
    e.drizzle = 1.9;
    queueMeteors(1, 260);
  }
  if (e.stun > 0 && e.state !== "dazed" && e.state !== "intro") {
    e.vx *= Math.exp(-8 * dt);
    bossPhysics(e, dt);
    return;
  }
  let contact = GOAT.contact;
  switch (e.state) {
    case "intro": {
      e.vx = 0;
      contact = 0;
      if (e.onGround && !e.landedIntro) {
        e.landedIntro = true;
        const fy = e.y + e.h;
        ring(ec.x, fy, 420, "#ff2457");
        ring(ec.x, fy, 260, "#ffe14d");
        dust(ec.x, fy, 40, 3);
        burst(ec.x, fy - 40, 40, "#ff9b21", 700);
        camera.shake = Math.max(camera.shake, 32);
        game.landFlash = 0.3;
        sfx.stomp.play({ rate: 0.4 });
        vibrate([80, 40, 160]);
      }
      if (!bossLocked()) bossState(e, "stalk");
      break;
    }
    case "stalk": {
      const targetX = blind ? ec.x + e.facing * 200 : pc.x;
      bossNavigate(e, dt, targetX, GOAT.walk[P]);
      if (!blind && e.stateTime > [1.1, 0.8, 0.55][P] && e.onGround) chooseGoatAttack(e);
      break;
    }
    case "charge": {
      if (e.step === 0) {
        // paw the ground
        e.vx *= Math.exp(-12 * dt);
        faceThePlayer(e);
        if (Math.random() < 0.4) dust(ec.x - e.facing * 40, e.y + e.h, 2, 1.2);
        if (e.stateTime > [0.75, 0.6, 0.5][P]) {
          e.step = 1;
          e.startX = ec.x;
          e.passX = pc.x + e.facing * 420;
          sfx.stomp.play({ rate: 0.8 });
          bossSay(e, "BAAAAAAH!");
        }
      } else if (e.step === 1) {
        e.vx = e.facing * GOAT.chargeSpeed[P];
        contact = GOAT.chargeDamage;
        if (Math.random() < 0.6) dust(ec.x - e.facing * 60, e.y + e.h, 2, 1.4);
        const hitWall = (e.facing < 0 && e.x <= 1) || (e.facing > 0 && e.x + e.w >= WORLD_W - 1);
        if (hitWall) {
          // bonk
          camera.shake = Math.max(camera.shake, 20);
          burst(e.facing > 0 ? e.x + e.w : e.x, ec.y, 26, "#ffe14d", 500);
          sfx.stomp.play({ rate: 0.5 });
          bossState(e, "dazed");
          e.vulnT = 1.6;
          e.vx = -e.facing * 300;
        } else if ((e.facing > 0 && ec.x > e.passX) || (e.facing < 0 && ec.x < e.passX)) {
          e.step = 2;
          e.timer = 0.45;
        }
      } else {
        e.vx *= Math.exp(-6 * dt); // skid
        if (Math.random() < 0.5) dust(ec.x, e.y + e.h, 2, 1);
        e.timer -= dt;
        if (e.timer <= 0) {
          if (P >= 1 && !e.charged) {
            e.charged = true; // enraged: charges straight back
            bossState(e, "charge");
          } else {
            e.charged = false;
            bossState(e, "stalk");
          }
        }
      }
      break;
    }
    case "dazed": {
      e.vx *= Math.exp(-6 * dt);
      contact = 0;
      if (e.stateTime > 1.6) bossState(e, "stalk");
      break;
    }
    case "leap": {
      if (e.step === 0) {
        e.vx *= Math.exp(-12 * dt);
        faceThePlayer(e);
        if (e.stateTime > [0.45, 0.35, 0.28][P]) {
          e.step = 1;
          e.vy = -1700;
          e.vx = clamp((pc.x - ec.x) / 1.15, -1000, 1000);
          e.onGround = false;
          dust(ec.x, e.y + e.h, 16, 2);
        }
      } else if (e.step === 1) {
        if (e.onGround && e.stateTime > 0.3) {
          const fy = e.y + e.h;
          spawnShockwave(ec.x, fy, -1, { damage: GOAT.stompDamage, h: 84, speed: 820, color: "#ff2457", life: 1.4 });
          spawnShockwave(ec.x, fy, 1, { damage: GOAT.stompDamage, h: 84, speed: 820, color: "#ff2457", life: 1.4 });
          ring(ec.x, fy, 320, "#ff2457");
          dust(ec.x, fy, 30, 2.6);
          camera.shake = Math.max(camera.shake, 22);
          sfx.stomp.play({ rate: 0.45 });
          if (P >= 1) queueMeteors(3, 380);
          e.step = 2;
          e.timer = 0.6;
          e.vx = 0;
        }
      } else {
        e.vx *= Math.exp(-12 * dt);
        e.timer -= dt;
        if (e.timer <= 0) bossState(e, "stalk");
      }
      break;
    }
    case "breath": {
      e.vx *= Math.exp(-12 * dt);
      const tele = [0.6, 0.5, 0.4][P];
      if (e.stateTime < tele) faceThePlayer(e);
      else {
        const t = e.stateTime - tele;
        const dur = 1.4;
        e.timer -= dt;
        if (e.timer <= 0 && !blind) {
          e.timer = 0.05;
          const m = mouthOf(e);
          const sweep = -0.35 + 0.85 * (0.5 - 0.5 * Math.cos((t / dur) * Math.PI * 2));
          const a = e.facing > 0 ? sweep : Math.PI - sweep;
          enemyShots.push({ owner: game.boss, x: m.x, y: m.y, vx: Math.cos(a) * 580, vy: Math.sin(a) * 580, r: 18, damage: GOAT.breathDamage, kind: "fire", angle: a, life: 0.85 });
        }
        if (Math.random() < 0.3) sfx.burn.play({ rate: 0.6 });
        if (t > dur) bossState(e, "stalk");
      }
      break;
    }
    case "rain": {
      e.vx *= Math.exp(-12 * dt);
      if (e.step === 0) {
        e.step = 1;
        queueMeteors(P === 2 ? 12 : 8, 560);
        camera.shake = Math.max(camera.shake, 12);
        sfx.chain.play({ rate: 0.35 });
        bossSay(e, "THE SKY IS ON FIRE. YOU'RE WELCOME.");
      }
      if (e.stateTime > 1.2) bossState(e, "stalk");
      break;
    }
    case "roar": {
      // phase change: shove the player back, shake the screen
      e.vx *= Math.exp(-12 * dt);
      contact = 0;
      if (e.step === 0) {
        e.step = 1;
        camera.shake = Math.max(camera.shake, 26);
        ring(ec.x, ec.y, 500, "#ff2457");
        sfx.stomp.play({ rate: 0.35 });
        if (Math.abs(pc.x - ec.x) < 600) player.vx = Math.sign(pc.x - ec.x || 1) * 900;
        if (e.phase >= 1) queueMeteors(6, 500);
      }
      if (e.stateTime > e.roarFor) bossState(e, "stalk");
      break;
    }
  }
  bossPhysics(e, dt);
  if (contact) bossContact(e, contact);
  if (e.state === "stalk" && Math.random() < dt * 0.12) bossTaunt(e);
}

function goatFrame(e) {
  switch (e.state) {
    case "intro":
      return e.onGround ? (e.stateTime > 1 && bossLocked() ? 10 : 8) : 7;
    case "charge":
      return e.step === 0 ? 6 : e.step === 1 ? 2 + (Math.floor(e.anim * 14) % 4) : 6;
    case "dazed":
      return 12;
    case "leap":
      return e.step === 0 ? 8 : e.step === 1 ? 7 : 8;
    case "breath":
      return 9;
    case "rain":
    case "roar":
      return 10;
  }
  if (!e.onGround) return 7;
  if (e.hurt > 0.08) return 12;
  if (Math.abs(e.vx) > 50) return 2 + (Math.floor(e.anim * 8) % 4);
  return e.phase > 0 && Math.floor(e.anim * 2) % 2 ? 11 : Math.floor(e.anim * 2) % 2;
}

function drawGoat(e, time) {
  const c = centerOf(e);
  // meteor warnings on the ground
  meteors.forEach((m) => {
    const k = Math.min(1, m.t / m.delay);
    ctx.strokeStyle = `rgba(255,40,70,${0.4 + 0.5 * Math.sin(time * 20)})`;
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.ellipse(m.x, m.y - 4, 60 * (1.3 - k * 0.3), 14, 0, 0, Math.PI * 2);
    ctx.stroke();
    glow(m.x, m.y - 6, 40 + 40 * k, "rgba(255,60,40,0.6)");
  });
  if (e.state === "charge" && e.step === 0) glow(c.x + e.facing * 70, e.y + 60, 50 + 20 * Math.sin(time * 30), "rgba(255,30,30,0.9)");
  if (e.state === "breath" && e.stateTime < 0.6) glow(mouthOf(e).x, mouthOf(e).y, 50 + 30 * Math.sin(time * 30), "rgba(255,160,40,0.9)");
  glow(c.x, c.y, 260, e.phase === 2 ? "rgba(255,0,40,0.5)" : e.enraged ? "rgba(255,20,60,0.4)" : "rgba(255,120,40,0.25)");
  drawGoatBody(e.x, e.y, e.w, e.h, e.facing, goatFrame(e), e, time);
  if (e.state === "dazed") {
    for (let i = 0; i < 3; i++) {
      const a = time * 5 + (i * Math.PI * 2) / 3;
      drawCell("fx", 6, 32, c.x + Math.cos(a) * 60, e.y - 10 + Math.sin(a) * 14, 40, 40, a);
    }
  }
  drawBossSpeech(e, "#ff2457");
}

function drawGoatBody(x, y, w, h, facing, frame, e, time) {
  const img = IMG.goatFinal;
  const s = GOAT.scale;
  const dw = 96 * s;
  const dh = 96 * s;
  const cx = x + w / 2;
  const dy = y + h - 95 * s;
  let tint = null;
  if (e && e.hurt > 0) tint = "rgba(255,255,255,0.85)";
  else if (e && e.stun > 0) tint = "rgba(176,108,255,0.5)";
  else if (e && e.state === "charge" && e.step === 0) tint = `rgba(255,60,30,${0.15 + 0.2 * Math.sin(time * 40)})`;
  else if (e && e.phase === 2) tint = "rgba(255,0,40,0.25)";
  const jitter = e ? drawGlitch(img, frame * 96, 0, 96, 96, cx - dw / 2, dy, dw, dh, facing < 0, 1.7) : 0;
  if (drawFrame(img, frame * 96, 0, 96, 96, cx - dw / 2 + jitter, dy, dw, dh, tint, facing < 0)) return;
  // fallback: the old goat sheet, scaled up
  const old = isReady(IMG.goatCyber) ? IMG.goatCyber : IMG.goat;
  if (!drawFrame(old, 0, (facing < 0 ? 1 : 2) * 80, 80, 80, cx - 160, y + h - 300, 320, 320, tint)) {
    ctx.fillStyle = "#ff2457";
    ctx.fillRect(x, y, w, h);
  }
}

// The kneeling GOAT during its death sequence
function drawGoatDeath(time) {
  const d = game.goatDeath;
  if (!d) return;
  ctx.globalAlpha = Math.max(0, 1 - Math.max(0, d.t - 1.6) / 0.6);
  drawGoatBody(d.x, d.y, d.w, d.h, d.facing, 13, null, time);
  ctx.globalAlpha = 1;
}

function resetGoat() {
  meteors.length = 0;
  game.goatDeath = null;
  game.goatSky = 0;
}
