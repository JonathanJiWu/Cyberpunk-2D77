"use strict";
// =============================================================================
// Drawing: the scene (world space, scrolled by the camera) and the HUD.
// =============================================================================

const FONT = '"Press Start 2P", ui-monospace, monospace';

function render(time) {
  ctx.setTransform(renderScale, 0, 0, renderScale, 0, 0);
  ctx.save();
  if (camera.shake > 0) ctx.translate(rand(-1, 1) * camera.shake, rand(-1, 1) * camera.shake);
  drawParallax(time);

  // World space. Snap the camera to whole device pixels so tiles don't shimmer.
  ctx.save();
  ctx.translate(-Math.round(camera.x * renderScale) / renderScale, -Math.round(camera.y * renderScale) / renderScale);
  drawDecor(time);
  drawSecretsBack(time);
  drawGround();
  drawPlatforms();
  drawCrates();
  drawPickups(time);
  drawEnemies(time);
  drawGoatDeath(time);
  drawNullFx(time);
  drawShockwaves(time);
  forEachPlayer(() => {
    // (each player in co-op, with its own projectiles and effects)
    drawPlayer(time);
    drawPlayerProjectiles();
    drawHeroFx(time);
    drawKitFx(time);
  });
  drawEnemyShots();
  drawEffects();
  drawSecretsFront(time);
  if (game.debug) drawDebug();
  ctx.restore();
  ctx.restore();
  drawRain();

  drawDilationOverlay(time); // Hackerman's bullet time
  // Sandevistan: the world turns green and slow
  if (player.sandyTime > 0 && game.state !== "over") {
    ctx.fillStyle = `rgba(60,255,120,${0.1 + 0.04 * Math.sin(time * 20)})`;
    ctx.fillRect(0, 0, W, H);
  }

  // Red sky while a boss is alive (violet for NULL); the GOAT sets it on fire
  if (game.boss && !game.boss.dead && game.state !== "over") {
    ctx.fillStyle = game.boss.type === "nullptr" ? `rgba(90,30,200,${0.09 + 0.04 * Math.sin(time * 2)})` : `rgba(255,20,60,${0.08 + 0.04 * Math.sin(time * 2)})`;
    ctx.fillRect(0, 0, W, H);
  }
  if (game.goatSky && game.state !== "over") {
    ctx.fillStyle = `rgba(70,0,8,${0.22 * game.goatSky})`;
    ctx.fillRect(0, 0, W, H);
    if (Math.sin(time * 1.3) * Math.sin(time * 7.1) > 0.96) {
      ctx.fillStyle = "rgba(255,220,240,0.22)";
      ctx.fillRect(0, 0, W, H);
    }
  }
  if (game.hackFlash > 0) {
    ctx.fillStyle = `rgba(90,255,122,${game.hackFlash * 0.5})`;
    ctx.fillRect(0, 0, W, H);
  }
  if (game.landFlash > 0) {
    ctx.fillStyle = `rgba(255,255,255,${game.landFlash * 1.6})`; // hero landing impact
    ctx.fillRect(0, 0, W, H);
  }
  if (game.hurtFlash > 0) drawHurtFlash(game.hurtFlash);
  if (game.state === "over") {
    ctx.globalAlpha = clamp(game.overTime / 0.8, 0, 1);
    if (isReady(IMG.endGame)) {
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(IMG.endGame, 0, 0, W, H);
    } else {
      ctx.fillStyle = "#14051f";
      ctx.fillRect(0, 0, W, H);
    }
    ctx.globalAlpha = 1;
  } else {
    drawLetterbox();
    drawHUD(time);
  }
}

// Red edges when you get hit. A full-screen radial gradient costs several ms
// without a GPU, so Performance mode draws four translucent bars instead.
function drawHurtFlash(k) {
  if (perfMode()) {
    const t = H * 0.16;
    ctx.fillStyle = `rgba(255,0,60,${Math.min(1, k) * 0.55})`;
    ctx.fillRect(0, 0, W, t);
    ctx.fillRect(0, H - t, W, t);
    ctx.fillRect(0, t, t, H - 2 * t);
    ctx.fillRect(W - t, t, t, H - 2 * t);
    return;
  }
  const g = ctx.createRadialGradient(W / 2, H / 2, H * 0.3, W / 2, H / 2, H * 0.95);
  g.addColorStop(0, "rgba(255,0,60,0)");
  g.addColorStop(1, `rgba(255,0,60,${k})`);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
}

function drawEffects() {
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  particles.forEach((p) => {
    ctx.globalAlpha = Math.min(1, p.life / 0.3);
    ctx.fillStyle = p.color;
    ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
  });
  rings.forEach((r) => {
    const t = 1 - r.life / r.max;
    ctx.globalAlpha = 1 - t;
    ctx.strokeStyle = r.color;
    ctx.lineWidth = 10 * (1 - t) + 2;
    ctx.beginPath();
    ctx.arc(r.x, r.y, r.radius * (0.3 + 0.7 * t), 0, Math.PI * 2);
    ctx.stroke();
  });
  arcs.forEach((a) => {
    ctx.globalAlpha = a.life / a.max;
    ctx.strokeStyle = a.color;
    ctx.lineJoin = "round";
    [10, 3].forEach((width, pass) => {
      ctx.lineWidth = width;
      ctx.strokeStyle = pass ? "#ffffff" : "rgba(25,245,255,0.5)";
      ctx.beginPath();
      a.segs.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
      ctx.stroke();
    });
  });
  ctx.restore();
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  popups.forEach((p) => {
    ctx.globalAlpha = Math.min(1, p.life / 0.3);
    ctx.font = fontPx(p.size);
    ctx.fillStyle = "#000";
    ctx.fillText(p.text, p.x + 3, p.y + 3);
    ctx.fillStyle = p.color;
    ctx.fillText(p.text, p.x, p.y);
  });
  ctx.globalAlpha = 1;
}

function drawDebug() {
  ctx.lineWidth = 3;
  const box = (b, color) => {
    ctx.strokeStyle = color;
    ctx.strokeRect(b.x, b.y, b.w, b.h);
  };
  box(player, "#19f5ff");
  enemies.forEach((e) => !e.dead && box(e, "#ff2457"));
  crates.forEach((c) => c.alive && box(c, "#ffe14d"));
  platforms.forEach((p) => box(p, "#5aff7a"));
  gems.forEach((g) => box(g, "#ffffff"));
  ctx.strokeStyle = "#ffffff";
  [...playerShots, ...enemyShots].forEach((s) => {
    ctx.beginPath();
    ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
    ctx.stroke();
  });
}

// ------------------------------------------------------------------ HUD -----
function hudText(text, x, y, size, color, align = "left", baseline = "top") {
  ctx.font = fontPx(size);
  ctx.textAlign = align;
  ctx.textBaseline = baseline;
  ctx.fillStyle = "rgba(0,0,0,0.75)";
  ctx.fillText(text, x + 3, y + 3);
  ctx.fillStyle = color;
  ctx.fillText(text, x, y);
}

function drawBar(x, y, w, h, frac, ghostFrac, color) {
  frac = clamp(frac, 0, 1);
  ctx.fillStyle = "rgba(10,3,24,0.8)";
  ctx.fillRect(x, y, w, h);
  if (ghostFrac) {
    ctx.fillStyle = "rgba(255,255,255,0.6)";
    ctx.fillRect(x, y, w * clamp(ghostFrac, 0, 1), h);
  }
  ctx.fillStyle = color;
  ctx.fillRect(x, y, w * frac, h);
  ctx.fillStyle = "rgba(255,255,255,0.22)";
  ctx.fillRect(x, y, w * frac, h * 0.35);
  ctx.lineWidth = 4;
  ctx.strokeStyle = color;
  ctx.strokeRect(x - 2, y - 2, w + 4, h + 4);
}

function drawIcon(sheet, size, cell, x, y, s) {
  if (!drawCell(sheet, cell, size, x + s / 2, y + s / 2, s, s)) {
    ctx.fillStyle = "#3d3560";
    ctx.fillRect(x, y, s, s);
  }
}

// An IC's HUD portrait. The 64px v3.2 portraits are shown smaller than that,
// so they're smoothed rather than having whole pixel rows dropped.
function drawPortrait(cell, x, y, s) {
  const [sheet, size] = portraitSheet();
  if (size <= s || !isReady(IMG[sheet])) return drawIcon(sheet, size, cell, x, y, s);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(IMG[sheet], cell * size, 0, size, size, x, y, s, s);
  ctx.imageSmoothingEnabled = false;
}

// On small screens the HUD is drawn bigger so it stays readable.
const hudLayout = { scale: 1, killsY: 132 };

function drawHUD(time) {
  const p = player;
  const k = hudLayout.scale;
  const VW = W / k;
  ctx.save();
  ctx.scale(k, k);

  // XP bar across the very top
  const need = xpForLevel(progress.level + progress.pending);
  const xpFrac = clamp(progress.xp / need, 0, 1);
  ctx.fillStyle = "rgba(10,3,24,0.85)";
  ctx.fillRect(0, 0, VW, 16);
  ctx.fillStyle = "#19f5ff";
  ctx.fillRect(0, 0, VW * xpFrac, 16);
  ctx.fillStyle = "rgba(255,255,255,0.35)";
  ctx.fillRect(0, 0, VW * xpFrac, 5);

  // Health + heat
  const lowHp = p.hp / stats.maxHp < 0.3;
  const hpColor = lowHp && Math.sin(time * 12) > 0 ? "#ff2f6d" : "#19f5ff";
  drawPortrait(CH().portrait, 44, 22, 40);
  const team = coopActive(); // co-op: tag player 1's panel, show when they're down
  hudText(`${team ? "P1 " : ""}${CH().name}  LV ${progress.level}`, 94, 32, 24, team ? coop.players[0].color : "#ffe14d");
  const down = coopStatus(coop.players[0]);
  drawBar(44, 70, 440, 34, down ? 0 : p.hp / stats.maxHp, down ? 0 : p.ghostHp / stats.maxHp, hpColor);
  hudText(down || `${Math.ceil(p.hp)}/${stats.maxHp}`, 58, 77, 22, "#ffffff");
  // Lives: one chip per backup
  for (let i = 0; i < MAX_LIVES; i++) {
    const on = i < game.lives;
    const lx = 504 + i * 34;
    ctx.fillStyle = on ? CH().color : "rgba(255,255,255,0.15)";
    ctx.beginPath();
    ctx.moveTo(lx + 13, 72);
    ctx.lineTo(lx + 26, 87);
    ctx.lineTo(lx + 13, 102);
    ctx.lineTo(lx, 87);
    ctx.closePath();
    ctx.fill();
    if (on) glow(lx + 13, 87, 18, "rgba(255,255,255,0.35)");
  }
  const res = CH().resource;
  const heatColor = p.heatLocked ? (Math.sin(time * 14) > 0 ? "#ff3b3b" : "#7a1010") : res.color;
  drawBar(44, 120, 300, 18, p.heat / TUNING.heat.max, 0, heatColor);
  hudText(p.heatLocked ? `NO ${res.name}` : res.name, 360, 120, 18, heatColor);
  hudText(passiveLine(), 460, 122, 15, "#c9b6ff"); // the IC's passive, as it grows with level

  // Active power-ups
  let ix = 44;
  [
    ["overdrive", p.overdrive],
    ["shield", p.shield],
  ].forEach(([type, left]) => {
    if (left <= 0) return;
    const def = POWERUPS[type];
    drawIcon("pickups", 16, def.icon, ix, 156, 44);
    ctx.fillStyle = def.color;
    ctx.fillRect(ix, 204, 44 * (left / def.duration), 5);
    ix += 56;
  });
  // Chrome from easter eggs
  [
    [player.mantis, 0, 0],
    [player.katana, 1, 0],
    [player.sandy, 2, player.sandyCd / 35],
    [player.camo > 0, 3, 0],
  ].forEach(([owned, icon, cooling]) => {
    if (!owned) return;
    drawIcon("secrets", 24, icon, ix, 156, 44);
    if (cooling > 0) {
      ctx.fillStyle = "rgba(0,0,0,0.6)";
      ctx.fillRect(ix, 156, 44, 44 * cooling);
    }
    ix += 56;
  });

  // Owned upgrades with their level
  let ux = 44;
  const uy = ix > 44 ? 222 : 160;
  UPGRADES.forEach((u) => {
    const level = lv(u.id);
    if (!level) return;
    const icon = upgradeInfo(u).icon;
    drawIcon(icon.sheet, icon.sheet === "fx" ? 32 : 24, icon.cell, ux, uy, 44);
    hudText(String(level), ux + 40, uy + 30, 14, "#ffe14d", "right");
    ux += 50;
  });

  // Run timer / boss
  hudText(formatTime(game.time), VW / 2, 34, 40, "#ffffff", "center");
  const boss = game.boss;
  if (boss && !boss.dead && boss.type === "nullptr") drawNullBar(boss, VW, time);
  else if (boss && !boss.dead) {
    const name = BOSSES[boss.type].name.toUpperCase();
    const color = boss.type === "overseer" ? "#19f5ff" : "#ff2457";
    hudText(boss.enraged ? `${name} !!` : name, VW / 2, 92, 22, boss.enraged ? color : "#ffffff", "center");
    drawBar(VW / 2 - 320, 124, 640, 26, boss.hp / boss.maxHp, boss.ghostHp / boss.maxHp, color);
  } else if (director.stage === STAGE.start || director.stage === STAGE.interlude1 || director.stage === STAGE.interlude2) {
    const left = director.nextBossAt - game.time;
    const urgent = left < 10 && Math.sin(time * 10) > 0;
    const label = { [STAGE.start]: "BOSS IN", [STAGE.interlude1]: "NEXT BOSS IN", [STAGE.interlude2]: "FINAL BOSS IN" }[director.stage];
    hudText(`${label} ${formatTime(left)}`, VW / 2, 92, 20, urgent ? "#ff2457" : "#c9b6ff", "center");
  }

  // Kills (just under the pause / mute / fullscreen buttons)
  hudText(`KILLS ${game.kills}`, VW - 44, hudLayout.killsY / k, 22, "#ffffff", "right");
  drawCoopHud(VW, time); // co-op: player 2's panel (or their join panel)

  drawHints(VW, H / k);

  if (game.toast) {
    ctx.globalAlpha = clamp(game.toast.time / 0.5, 0, 1);
    hudText(game.toast.text, VW / 2, 190, 24, "#ffe14d", "center");
    ctx.globalAlpha = 1;
  }

  if (game.banner) {
    ctx.globalAlpha = clamp(game.banner.time / 0.4, 0, 1);
    // shrink long banners so they always fit the screen
    ctx.font = fontPx(52);
    const size = Math.min(52, Math.floor((52 * (VW - 80)) / ctx.measureText(game.banner.text).width));
    hudText(game.banner.text, VW / 2, H / k / 2 - 180, size, game.banner.color || "#ff2457", "center", "middle");
    ctx.globalAlpha = 1;
  }
  drawBossCard(VW, H / k);
  drawNullTear(VW, H / k);
  ctx.restore();

  if (boss && !boss.dead && !boss.cloaked && !onScreen(boss)) drawBossArrow(boss, time);
  drawCinematic();
}

function drawBossArrow(boss, time) {
  const c = centerOf(boss);
  const right = c.x > camera.x + W / 2;
  const x = right ? W - 60 : 60;
  const y = clamp(c.y - camera.y, 200, H - 200);
  const bob = Math.sin(time * 8) * 8;
  ctx.fillStyle = "#ff2457";
  ctx.beginPath();
  const dir = right ? 1 : -1;
  ctx.moveTo(x + dir * (30 + bob), y);
  ctx.lineTo(x - dir * (10 - bob), y - 30);
  ctx.lineTo(x - dir * (10 - bob), y + 30);
  ctx.closePath();
  ctx.fill();
}

function drawHints(VW, VH) {
  if (game.state !== "playing" || game.time > 10) return;
  const alpha = clamp((10 - game.time) / 1.5, 0, 1);
  ctx.globalAlpha = alpha;
  const pad = typeof padHintRows === "function" ? padHintRows() : null; // gamepad.js: controller prompts while a pad is in use
  if (touchMode && !pad) {
    // with auto-fire on, the right stick still aims and fires (twin-stick)
    const right = settings.touchAim === "tap" && !settings.autoFire ? "TAP: FIRE   HOLD: RAPID FIRE" : "RIGHT STICK: AIM + FIRE";
    hudText(`LEFT STICK: MOVE (FLICK UP: JUMP)   ${right}   CORNER: ${CH().special.label}`, VW / 2, VH - 150, 20, "#ffffff", "center");
  } else {
    const rows = pad || [
      ["A D", "MOVE    W S  AIM"],
      ["SPACE", "JUMP x2  (S+SPACE: DROP)"],
      ["J", `${CH().primary.name.toUpperCase()} (L-CLICK)`],
      ["K", `${CH().special.name.toUpperCase()} (R-CLICK)`],
    ];
    const box = { x: VW / 2 - 430, y: 250, w: 860, h: 40 + rows.length * 40 };
    ctx.fillStyle = "rgba(10,3,24,0.75)";
    ctx.fillRect(box.x, box.y, box.w, box.h);
    ctx.strokeStyle = "rgba(255,47,214,0.8)";
    ctx.lineWidth = 3;
    ctx.strokeRect(box.x, box.y, box.w, box.h);
    if (isReady(IMG.wasd) && !pad) {
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(IMG.wasd, box.x + 24, box.y + 22, 145, 157);
    }
    rows.forEach(([key, label], i) => {
      const sym = pad && padIsSymbol(key); // ✕ ○ □ △ come from a fallback font: draw them bigger
      hudText(key, box.x + (pad ? 40 : 200), box.y + 26 + i * 40 - (sym ? 7 : 0), sym ? 32 : 20, "#ff9b21");
      hudText(label, box.x + (pad ? 240 : 340), box.y + 26 + i * 40, 20, "#ffffff");
    });
  }
  ctx.globalAlpha = 1;
}
