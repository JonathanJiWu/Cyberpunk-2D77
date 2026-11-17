"use strict";
// =============================================================================
// Pickups: XP chips dropped by enemies (pulled in by your magnet range) and
// power-ups dropped by crates / enemies.
// =============================================================================

const gems = [];
const powerups = [];

function spawnGem(x, y, value) {
  if (gems.length > 160) {
    // Too many lying around: merge into the oldest one
    gems[0].value += value;
    return;
  }
  gems.push({ x: x - 12, y: y - 12, w: 24, h: 24, vx: rand(-120, 120), vy: rand(-420, -200), value, pulled: false, onGround: false, standingOn: null });
}

function spawnPowerup(x, y, type) {
  type = type || weightedPick(Object.entries(POWERUPS).map(([k, v]) => [k, v.weight]));
  powerups.push({ type, x: x - 22, y: y - 22, w: 44, h: 44, vx: rand(-80, 80), vy: -380, life: 20, onGround: false, standingOn: null });
}

function updatePickups(dt) {
  const pc = centerOf(player);
  const reach = TUNING.pickupRadius * stats.magnetMul;

  for (let i = gems.length - 1; i >= 0; i--) {
    const g = gems[i];
    const gc = centerOf(g);
    const d = Math.hypot(pc.x - gc.x, pc.y - gc.y);
    if (!g.pulled && d < reach) g.pulled = true;
    if (g.pulled) {
      // Fly toward the player, faster and faster
      g.speed = (g.speed || 300) + 2400 * dt;
      g.x += ((pc.x - gc.x) / (d || 1)) * g.speed * dt;
      g.y += ((pc.y - gc.y) / (d || 1)) * g.speed * dt;
    } else {
      g.vx *= 0.96;
      moveBody(g, dt, 1600, 900);
      if (g.onGround) g.vx = 0;
    }
    if (d < 40) {
      gainXp(g.value);
      sfx.pickup.play({ rate: 1.6 + Math.random() * 0.4 });
      gems.splice(i, 1);
    }
  }

  for (let i = powerups.length - 1; i >= 0; i--) {
    const p = powerups[i];
    p.vx *= 0.97;
    moveBody(p, dt, 1600, 900);
    if (p.onGround) p.vx = 0;
    p.life -= dt;
    if (overlaps(p, player)) {
      applyPowerup(p.type);
      powerups.splice(i, 1);
    } else if (p.life <= 0) {
      powerups.splice(i, 1);
    }
  }
}

function applyPowerup(type) {
  const def = POWERUPS[type];
  const pc = centerOf(player);
  popup(def.name, pc.x, player.y - 30, def.color, 30, 1.2);
  burst(pc.x, pc.y, 16, def.color, 320);
  sfx.powerup.play({ rate: 1.25 });
  switch (type) {
    case "heal":
      player.hp = Math.min(stats.maxHp, player.hp + 30);
      break;
    case "heat":
      player.heat = Math.min(TUNING.heat.max, player.heat + 50);
      break;
    case "overdrive":
      player.overdrive = def.duration;
      break;
    case "shield":
      player.shield = def.duration;
      break;
    case "magnet":
      gems.forEach((g) => (g.pulled = true));
      break;
    case "emp":
      ring(pc.x, pc.y, W * 0.7, "#b06cff");
      camera.shake = Math.max(camera.shake, 14);
      enemies.forEach((e) => {
        if (onScreen(e)) {
          damageEnemy(e, e.boss ? 40 : 60, { source: "emp" });
          e.stun = 1.2;
        }
      });
      enemyShots.length = 0;
      break;
  }
}

function drawPickups(time) {
  gems.forEach((g) => {
    const c = centerOf(g);
    const bob = g.onGround ? Math.sin(time * 5 + g.x) * 3 : 0;
    const big = g.value >= 4;
    glow(c.x, c.y + bob, big ? 34 : 24, big ? "rgba(255,47,214,0.6)" : "rgba(25,245,255,0.55)");
    if (!drawCell("pickups", big ? 1 : 0, 16, c.x, c.y + bob, big ? 40 : 32, big ? 40 : 32)) {
      ctx.fillStyle = big ? "#ff2fd6" : "#19f5ff";
      ctx.fillRect(c.x - 8, c.y - 8 + bob, 16, 16);
    }
  });
  powerups.forEach((p) => {
    if (p.life < 3 && Math.floor(p.life * 8) % 2 === 0) return; // blink before vanishing
    const c = centerOf(p);
    const def = POWERUPS[p.type];
    const bob = Math.sin(time * 4 + p.x) * 5;
    glow(c.x, c.y + bob, 50, def.color, 0.6);
    if (!drawCell("pickups", def.icon, 16, c.x, c.y + bob, 48, 48)) {
      ctx.fillStyle = def.color;
      ctx.fillRect(c.x - 16, c.y - 16 + bob, 32, 32);
    }
  });
}
