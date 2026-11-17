"use strict";
// =============================================================================
// Boss 2: the OVERSEER, Cyber City's security AI. It arrives after the Demon
// Goat falls, hovers over the street and cycles through attacks:
//   rings    waves of bullets in every direction
//   laser    a telegraphed beam that sweeps across the street
//   barrage  a fast burst of aimed shots
//   summon   calls in drones and bombers
// Below half health it rages: faster cycles, denser rings.
// =============================================================================

const OVERSEER = {
  w: 190,
  h: 190,
  hoverSpeed: 170,
  idle: [1.2, 0.7], // pause between attacks (normal, raging)
  contactDamage: 20,
  ringDamage: 9,
  ringSpeed: 330,
  beamDamage: 16,
  beamWidth: 34,
  barrageDamage: 8,
};

function spawnOverseer() {
  director.stage = 3;
  const hp = BOSSES.overseer.hp;
  const e = {
    boss: true,
    type: "overseer",
    x: clamp(player.x - OVERSEER.w / 2, 0, WORLD_W - OVERSEER.w),
    y: camera.y - 320,
    w: OVERSEER.w,
    h: OVERSEER.h,
    vx: 0,
    vy: 0,
    kbX: 0,
    kbY: 0,
    hp,
    maxHp: hp,
    ghostHp: hp,
    anim: 0,
    state: "enter",
    stateTime: 0,
    hurt: 0,
    stun: 0,
    vulnT: 0,
    orbitCd: 0,
    hitCd: 0,
    enraged: false,
    beam: null,
    lastAttack: null,
  };
  enemies.push(e);
  game.boss = e;
  game.banner = { text: "OVERSEER ONLINE // THE CITY IS WATCHING", time: 3, color: "#19f5ff" };
  music.setIntensity(2);
  camera.shake = Math.max(camera.shake, 16);
  sfx.chain.play({ rate: 0.4 });
  say("boss2", null, true);
}

function overseerState(e, state) {
  e.state = state;
  e.stateTime = 0;
  e.step = 0;
  e.timer = 0;
}

function updateOverseer(e, dt) {
  e.stateTime += dt;
  e.hurt -= dt;
  e.orbitCd -= dt;
  e.hitCd -= dt;
  e.stun -= dt;
  e.ghostHp = Math.max(e.hp, e.ghostHp - 90 * dt);
  e.anim += dt * 3;
  const c = centerOf(e);
  const pc = centerOf(player);
  const blind = player.camo > 0;
  const rage = e.enraged;

  // Hover above the action, drifting toward the player
  const hoverX = clamp(pc.x - e.w / 2 + Math.sin(game.time * 0.6) * 260, 0, WORLD_W - e.w);
  const hoverY = camera.y + (e.state === "enter" ? 140 : 110) + Math.sin(game.time * 1.3) * 30;
  const speed = e.stun > 0 ? 0 : e.state === "laser" ? 40 : OVERSEER.hoverSpeed * (rage ? 1.3 : 1);
  const dx = hoverX - e.x;
  const dy = hoverY - e.y;
  const d = Math.hypot(dx, dy) || 1;
  const k = 1 - Math.exp(-3 * dt);
  e.vx += ((dx / d) * Math.min(speed, d * 3) - e.vx) * k;
  e.vy += ((dy / d) * Math.min(speed * 2, d * 3) - e.vy) * k;
  e.x = clamp(e.x + e.vx * dt, 0, WORLD_W - e.w);
  e.y = clamp(e.y + e.vy * dt, camera.y - 340, GROUND_Y - e.h - 200);

  if (!rage && e.hp <= e.maxHp * 0.5) {
    e.enraged = true;
    game.banner = { text: "OVERSEER: THREAT LEVEL MAXIMUM", time: 2.2, color: "#ff2457" };
    camera.shake = Math.max(camera.shake, 14);
    burst(c.x, c.y, 40, "#ff2457", 600);
  }

  if (e.stun > 0) {
    e.beam = null;
  } else {
    switch (e.state) {
      case "enter":
        if (e.stateTime > 2) overseerState(e, "idle");
        break;
      case "idle":
        if (e.stateTime > OVERSEER.idle[rage ? 1 : 0]) {
          const options = ["rings", "laser", "barrage", "summon"].filter((a) => a !== e.lastAttack);
          if (countAlive("drone") + countAlive("bomber") >= 5) options.splice(options.indexOf("summon"), 1);
          const next = options[Math.floor(Math.random() * options.length)];
          e.lastAttack = next;
          overseerState(e, next);
        }
        break;
      case "rings": {
        const waves = rage ? 4 : 3;
        e.timer -= dt;
        if (e.timer <= 0 && e.step < waves) {
          const n = rage ? 18 : 14;
          const offset = (e.step % 2) * (Math.PI / n);
          for (let i = 0; i < n; i++) {
            const a = offset + (i / n) * Math.PI * 2;
            enemyShots.push({ x: c.x, y: c.y, vx: Math.cos(a) * OVERSEER.ringSpeed, vy: Math.sin(a) * OVERSEER.ringSpeed, r: 14, damage: OVERSEER.ringDamage, kind: "ring", angle: a, life: 5 });
          }
          sfx.enemyShot.play({ rate: 0.9 });
          e.step++;
          e.timer = rage ? 0.42 : 0.55;
        }
        if (e.step >= waves && e.timer <= 0) overseerState(e, "idle");
        break;
      }
      case "laser": {
        // telegraph (thin line), then a sweeping beam
        const charge = rage ? 0.8 : 1.0;
        const sweep = 1.6;
        if (!e.beam) {
          const aim = Math.atan2(pc.y - c.y, pc.x - c.x);
          const dir = Math.random() < 0.5 ? -1 : 1;
          e.beam = { from: aim - 0.5 * dir, to: aim + 0.5 * dir, angle: aim - 0.5 * dir, on: false };
        }
        if (e.stateTime < charge) {
          e.beam.angle = e.beam.from;
        } else {
          e.beam.on = true;
          const k2 = Math.min(1, (e.stateTime - charge) / sweep);
          e.beam.angle = e.beam.from + (e.beam.to - e.beam.from) * k2;
          if (!blind && beamHits(c, e.beam.angle)) hurtPlayer(OVERSEER.beamDamage, c.x, c.y);
          if (Math.random() < 0.5) {
            const gx = c.x + Math.cos(e.beam.angle) * 900;
            const gy = Math.min(GROUND_Y, c.y + Math.sin(e.beam.angle) * 900);
            burst(gx, gy, 2, "#19f5ff", 200);
          }
          if (k2 >= 1) {
            e.beam = null;
            overseerState(e, "idle");
          }
        }
        break;
      }
      case "barrage": {
        e.timer -= dt;
        const shots = rage ? 7 : 5;
        if (e.timer <= 0 && e.step < shots) {
          if (!blind) fireEnemyShot(c.x, c.y + 40, { kind: "laser", damage: OVERSEER.barrageDamage, speed: 640, radius: 13 });
          e.step++;
          e.timer = 0.16;
        }
        if (e.step >= shots && e.timer <= 0) overseerState(e, "idle");
        break;
      }
      case "summon":
        if (e.step === 0) {
          ["drone", "bomber", rage ? "bomber" : "drone"].forEach((t, i) => {
            const m = spawnEnemy(t, c.x + (i - 1) * 160, c.y + 60, { elite: false });
            burst(m.x + m.w / 2, m.y + m.h / 2, 12, "#19f5ff", 300);
          });
          e.step = 1;
          sfx.chain.play({ rate: 0.8 });
        }
        if (e.stateTime > 0.8) overseerState(e, "idle");
        break;
    }
  }

  // Touching the core hurts (it hovers high, but rooftops get close)
  if (!blind && e.stun <= 0 && overlaps(e, player) && !player.flameOn) hurtPlayer(OVERSEER.contactDamage, c.x, c.y);
}

// Is the player inside the beam? (distance from the player to the beam ray)
function beamHits(c, angle) {
  const pc = centerOf(player);
  const ux = Math.cos(angle);
  const uy = Math.sin(angle);
  const px = pc.x - c.x;
  const py = pc.y - c.y;
  const along = px * ux + py * uy;
  if (along < 0) return false;
  const off = Math.abs(px * uy - py * ux);
  return off < OVERSEER.beamWidth + player.w / 2;
}

function drawOverseer(e, time) {
  const c = centerOf(e);
  // the beam (or its telegraph line)
  if (e.beam) {
    const len = 2400;
    const ex = c.x + Math.cos(e.beam.angle) * len;
    const ey = c.y + Math.sin(e.beam.angle) * len;
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
      ctx.moveTo(c.x, c.y);
      ctx.lineTo(ex, ey);
      ctx.stroke();
    });
    ctx.restore();
  }
  const charging = (e.state === "laser" && !(e.beam && e.beam.on)) || (e.state === "rings" && e.step === 0);
  glow(c.x, c.y, 260, e.enraged ? "rgba(255,30,70,0.45)" : "rgba(25,245,255,0.35)");
  if (charging) glow(c.x, c.y, 120, "rgba(255,255,255,0.8)", 0.5 + 0.5 * Math.sin(time * 30));
  const frame = e.enraged ? 3 : charging ? 2 : Math.floor(e.anim) % 2;
  let tint = null;
  if (e.hurt > 0) tint = "rgba(255,255,255,0.8)";
  else if (e.stun > 0) tint = "rgba(176,108,255,0.5)";
  const size = 288;
  const x = c.x - size / 2;
  const y = c.y - size / 2 + Math.sin(time * 2) * 6;
  const jitter = drawGlitch(IMG.overseer, frame * 96, 0, 96, 96, x, y, size, size, false, 2.3);
  if (!drawFrame(IMG.overseer, frame * 96, 0, 96, 96, x + jitter, y, size, size, tint)) {
    // fallback: a hexagonal eye
    hexagon(c.x, c.y, 100, e.enraged ? "#ff2457" : "#19f5ff", 8);
    ctx.fillStyle = "#ff2457";
    ctx.beginPath();
    ctx.arc(c.x, c.y, 34, 0, Math.PI * 2);
    ctx.fill();
  }
}
