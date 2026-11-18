"use strict";
// =============================================================================
// Game state, menus, layout and the main loop.
// =============================================================================

const game = {
  state: "menu", // menu | playing | paused | levelup | breach | over
  time: 0,
  overTime: 0,
  won: false,
  kills: 0,
  hurtFlash: 0,
  banner: null,
  boss: null,
  cinematic: null, // letterboxed subtitle for easter-egg moments
  toast: null,
  slowmo: null,
  debug: /[?&]debug\b/.test(location.search),
};

function resetGame() {
  resetWorld();
  resetPlayer();
  resetEnemies();
  resetProgress();
  applyLoadout();
  resetLives();
  gems.length = 0;
  powerups.length = 0;
  clearEffects();
  Object.assign(game, { time: 0, overTime: 0, won: false, kills: 0, hurtFlash: 0, landFlash: 0, banner: null, boss: null, cinematic: null, toast: null, slowmo: null, bossesDefeated: 0 });
  player.hidden = false;
  intro.active = false;
  resetSecretsRun();
  resetBossFx();
  resetGoat();
  breachEl.hidden = true;
  camera.x = 0;
  camera.y = 0;
  camera.shake = 0;
  clearInput();
}

function updateCamera(dt) {
  let target = player.x + player.w / 2 - W / 2 + player.facing * 140;
  // During a boss entrance, frame both of you
  const focus = game.cinematic && game.cinematic.focus;
  if (focus && !focus.dead) target = (player.x + player.w / 2 + focus.x + focus.w / 2) / 2 - W / 2;
  camera.x += (target - camera.x) * (1 - Math.exp(-5 * dt));
  camera.x = clamp(camera.x, 0, WORLD_W - W);
  // Follow climbs, keeping the player a bit below the middle of the screen
  const targetY = clamp(player.y + player.h / 2 - H * 0.58, WORLD_TOP, 0);
  camera.y += (targetY - camera.y) * (1 - Math.exp(-4 * dt));
}

function update(dt) {
  game.time += dt;
  updateWorld(dt, game.time);
  refreshMouseWorld();
  if (bossLocked()) {
    clearInput(); // a boss is making its entrance
    player.invuln = Math.max(player.invuln, 0.4);
  }
  if (intro.active) updateIntro(dt);
  else updatePlayer(dt);
  updateSecrets(dt);
  if (game.state !== "playing") return; // jacked into a terminal
  const edt = dt * enemyTimeScale(); // Sandevistan / slow-mo
  updateDirector(dt);
  updateEnemies(edt);
  updatePlayerShots(dt);
  updateMissiles(dt);
  updateEnemyShots(edt);
  updateBossFx(edt);
  updateGoatDeath(dt);
  updatePickups(dt);
  sweepDead();
  updateEffects(dt);
  updateHeroFx(dt);
  updateCamera(dt);
  game.hurtFlash = Math.max(0, game.hurtFlash - dt);
  game.hackFlash = Math.max(0, (game.hackFlash || 0) - dt);
  game.landFlash = Math.max(0, (game.landFlash || 0) - dt);
  if (game.banner && (game.banner.time -= dt) <= 0) game.banner = null;
  if (game.state !== "playing") return; // e.g. the boss just died
  if (player.hp <= 0) playerDown();
  else if (progress.pending > 0) openLevelUp();
}

// ------------------------------------------------------------ Game flow -----
function startGame() {
  SoundSystem.unlock();
  resetGame();
  levelUpEl.hidden = true;
  setState("playing");
  music.setIntensity(1);
  music.play(true); // from the top
  startIntro("drop"); // the superhero landing (says the start line)
}

function pauseGame() {
  if (game.state !== "playing") return;
  setState("paused");
  sfx.flame.stopLoop();
  music.pause();
}

function resumeGame() {
  if (game.state !== "paused") return;
  clearInput();
  setState("playing");
  music.play();
}

function endRun(won) {
  game.won = won;
  game.overTime = 0;
  sfx.flame.stopLoop();
  clearInput();
  levelUpEl.hidden = true;
  setState("over");
  if (won) music.setIntensity(1);
  else {
    music.pause();
    sfx.gameOver.play();
  }
  vibrate(won ? [40, 60, 40] : 200);
  captureRun(); // leaderboard.js: score the run, ready the name entry
}
const win = () => endRun(true);
const lose = () => endRun(false);

// --------------------------------------------------------------- Overlay ----
const overlay = document.getElementById("overlay");
const overlayTitle = document.getElementById("overlay-title");
const overlayText = document.getElementById("overlay-text");
const overlayStats = document.getElementById("overlay-stats");
const controlsHelp = document.getElementById("controls-help");
const overlayBtn = document.getElementById("overlay-btn");
const overlayBtn2 = document.getElementById("overlay-btn-2");
let overlayShownAt = 0;

function setState(state) {
  game.state = state;
  document.body.className = document.body.className.replace(/\bstate-\w+/g, "").trim();
  document.body.classList.add("state-" + state);
  if (state === "playing" || state === "levelup" || state === "breach") {
    overlay.hidden = true;
    return;
  }
  if (state === "menu") {
    showOverlay({
      title: "Cyberpunk 2D77",
      text: "It's year 2D77. You're a Cyber Badass. Survive the streets, level up, and don't kiss the Demon Goat.",
      button: "Start Game",
      help: true,
    });
  } else if (state === "paused") {
    showOverlay({ title: "Paused", text: "Catch your breath. Hot-swap your Individual Contributor or respec below.", button: "Resume", secondary: "Restart", help: true });
  }
  // "over" shows its overlay after a short delay, see frame()
}

function showOverlay({ title, text, button, help, secondary, stats: lines }) {
  overlayTitle.textContent = title;
  overlayText.textContent = text;
  document.getElementById("settings").hidden = !help;
  document.getElementById("how-to").hidden = !help;
  // Pick an Individual Contributor on the start screen, after a run, and
  // (hot-swap) in the pause menu
  renderCharSelect();
  document.getElementById("ic-label").textContent = game.state === "paused" ? "HOT-SWAP INDIVIDUAL CONTRIBUTOR" : "CHOOSE YOUR INDIVIDUAL CONTRIBUTOR";
  document.getElementById("respec-btn").hidden = game.state !== "paused";
  document.getElementById("overlay-tip").textContent = game.state === "paused" ? "" : "TIP: " + HUMOR.tips[Math.floor(Math.random() * HUMOR.tips.length)];
  document.getElementById("secrets").hidden = !help && !lines;
  renderSecretsList();
  overlayStats.hidden = !lines;
  if (lines) {
    overlayStats.textContent = "";
    lines.forEach(([label, value]) => {
      const dt = document.createElement("dt");
      const dd = document.createElement("dd");
      dt.textContent = label;
      dd.textContent = value;
      overlayStats.append(dt, dd);
    });
  }
  overlayBtn.textContent = button;
  overlayBtn2.hidden = !secondary;
  if (secondary) overlayBtn2.textContent = secondary;
  overlay.hidden = false;
  overlayShownAt = performance.now();
  if (!touchMode) overlayBtn.focus({ preventScroll: true });
}

function showGameOver() {
  const lines = [
    ["Time", formatTime(game.time)],
    ["Level", String(progress.level)],
    ["Kills", String(game.kills)],
    ["Lives used", `${Math.min(MAX_LIVES, game.livesLost + (game.won ? 0 : 1))}/${MAX_LIVES}`],
  ];
  if (runSecrets.size) lines.push(["Secrets", SECRETS.filter((s) => runSecrets.has(s.id)).map((s) => s.name).join(", ")]);
  if (game.won) {
    showOverlay({
      title: "Cyber City Is Free!",
      text: `${CH().name}: "${CH().quotes.win}" The Overseer is scrap, NULL is freed and the Demon GOAT is lamb chops. Ship it.`,
      button: "Play Again",
      stats: lines,
    });
  } else {
    const boss = game.boss;
    if (boss && !boss.dead) lines.push([`${BOSSES[boss.type].name} HP left`, Math.ceil((boss.hp / boss.maxHp) * 100) + "%"]);
    const rain = weather.amount > 0.5;
    const joke = HUMOR.gameOver[Math.floor(Math.random() * HUMOR.gameOver.length)];
    showOverlay({
      title: rain ? "Like tears in rain..." : director.stage >= STAGE.goat ? "The GOAT Got Your Soul!" : director.stage === STAGE.nullptr ? "NullPointerException!" : "Process Terminated",
      text: rain ? "Time to die. The rain washes the street clean." : `${CH().name}: "${CH().quotes.lose}" // ${joke}`,
      button: "Try Again",
      stats: lines,
    });
  }
}

function overlayPrimary() {
  // Ignore presses that were meant for the game a split-second earlier
  if (performance.now() - overlayShownAt < 400) return;
  if (game.state === "paused") resumeGame();
  else if (game.state === "menu" || game.state === "over") openLoadout();
}
overlayBtn.addEventListener("click", overlayPrimary);
document.getElementById("respec-btn").addEventListener("click", () => game.state === "paused" && openRespec());
overlayBtn2.addEventListener("click", () => {
  if (performance.now() - overlayShownAt >= 400) startGame();
});

// Called by the keyboard handler first; returns true if a menu used the key
function handleMenuKey(e) {
  if (!loadoutEl.hidden) {
    handleLoadoutKey(e);
    return true;
  }
  if (!respecEl.hidden) {
    if (e.code === "Escape") {
      e.preventDefault();
      closeRespec();
    }
    return true;
  }
  if (!codexEl.hidden) {
    if (e.code === "Escape") {
      e.preventDefault();
      closeCodex();
    }
    return true;
  }
  if (handleLeaderboardKey(e)) return true; // leaderboard panel, name entry, its buttons
  if (game.state === "breach") {
    handleBreachKey(e);
    return true;
  }
  if (game.state === "levelup") {
    handleLevelUpKey(e);
    return true;
  }
  if (overlay.hidden) return false;
  if (e.code === "Enter" || e.code === "Space") {
    const el = document.activeElement;
    if (el && (el.dataset.setting || el.dataset.music || el.tagName === "SUMMARY" || el.classList.contains("secret") || el.classList.contains("char-card") || el.id === "codex-btn" || el.id === "respec-btn" || el.id === "overlay-btn-2")) return true; // let it click
    e.preventDefault();
    if (!e.repeat) overlayPrimary();
  } else if ((e.code === "Escape" || e.code === "KeyP") && game.state === "paused") {
    e.preventDefault();
    resumeGame();
  }
  return true;
}

document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    clearInput();
    pauseGame();
  }
});

// ----------------------------------------------------------- HUD buttons ----
const muteBtn = document.getElementById("btn-mute");
const fullscreenBtn = document.getElementById("btn-fullscreen");

function toggleMute() {
  SoundSystem.setMuted(!SoundSystem.muted);
  muteBtn.setAttribute("aria-pressed", String(SoundSystem.muted));
  muteBtn.setAttribute("aria-label", SoundSystem.muted ? "Unmute" : "Mute");
  try {
    localStorage.setItem("cp2d77-muted", SoundSystem.muted ? "1" : "0");
  } catch (err) {
    /* storage unavailable */
  }
}
try {
  if (localStorage.getItem("cp2d77-muted") === "1") toggleMute();
} catch (err) {
  /* storage unavailable */
}

document.getElementById("btn-pause").addEventListener("click", () => (game.state === "paused" ? resumeGame() : pauseGame()));
muteBtn.addEventListener("click", () => {
  SoundSystem.unlock();
  toggleMute();
});

const root = document.documentElement;
if (!(document.fullscreenEnabled || document.webkitFullscreenEnabled)) fullscreenBtn.hidden = true;
fullscreenBtn.addEventListener("click", () => {
  if (document.fullscreenElement || document.webkitFullscreenElement) {
    (document.exitFullscreen || document.webkitExitFullscreen).call(document);
    return;
  }
  const req = root.requestFullscreen || root.webkitRequestFullscreen;
  const p = req && req.call(root, { navigationUI: "hide" });
  // On Android, also try to lock the screen to landscape
  Promise.resolve(p)
    .then(() => screen.orientation && screen.orientation.lock && screen.orientation.lock("landscape"))
    .catch(() => {});
});
// Keep buttons from holding keyboard focus (Space would "click" them)
document.querySelectorAll(".icon-btn").forEach((b) => b.addEventListener("mouseup", () => b.blur()));

// ---------------------------------------------------------------- Layout ----
// Fit the largest 16:9 box into the window. On phones held upright the game
// sits at the top so the on-screen controls have room underneath.
function layout() {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const portrait = vh > vw;
  document.body.classList.toggle("portrait", portrait);
  const w = Math.min(vw, (vh * 16) / 9);
  const h = (w * 9) / 16;
  let top = (vh - h) / 2;
  if (portrait && touchMode) top = Math.min(top, Math.max(64, vh * 0.12));
  gameEl.style.left = (vw - w) / 2 + "px";
  gameEl.style.top = top + "px";
  gameEl.style.width = w + "px";
  gameEl.style.height = h + "px";
  gameEl.style.setProperty("--u", w / 100 + "px");
  // Render at the screen's real resolution (capped at 1080p) for crisp pixels
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const backingW = Math.max(320, Math.min(W, Math.round(w * dpr)));
  if (canvas.width !== backingW) {
    canvas.width = backingW;
    canvas.height = Math.round((backingW * 9) / 16);
  }
  renderScale = canvas.width / W;
  // Bigger HUD on small screens; keep the kill counter clear of the buttons
  hudLayout.scale = clamp(900 / w, 1, 1.6);
  const buttons = document.querySelector(".hud-buttons").getBoundingClientRect();
  const below = ((buttons.bottom - top) / h) * H + 14;
  hudLayout.killsY = buttons.bottom > top && buttons.bottom < top + h * 0.4 ? below : 132;
}
addEventListener("resize", layout);
addEventListener("orientationchange", () => setTimeout(layout, 150));
if (window.visualViewport) visualViewport.addEventListener("resize", layout);
layout();

// ------------------------------------------------------------- Main loop ----
// requestAnimationFrame + delta time: same speed at 60Hz, 120Hz or on a slow
// phone. Long frames are split so fast things never skip through walls.
let lastTime = performance.now();
function frame(now) {
  requestAnimationFrame(frame);
  let dt = Math.min(0.1, Math.max(0, (now - lastTime) / 1000));
  lastTime = now;
  if (game.state === "playing") {
    while (dt > 0 && game.state === "playing") {
      const step = Math.min(dt, 1 / 60);
      update(step);
      dt -= step;
    }
    if (touchMode) {
      const special = CH().special;
      flameBtn.style.setProperty("--heat", (player.heat / TUNING.heat.max).toFixed(3));
      flameBtn.classList.toggle("overheated", player.heatLocked);
      flameBtn.classList.toggle("on", special.hold ? input.buttons.flame : false);
      if (flameBtn.textContent !== special.label) flameBtn.textContent = special.label;
    }
  } else if (game.state === "breach") {
    updateBreach(dt);
  } else if (game.state === "over") {
    const before = game.overTime;
    game.overTime += dt;
    updateEffects(dt);
    if (before < 0.9 && game.overTime >= 0.9) showGameOver();
  }
  render(now / 1000);
}

resetGame();
setState("menu");
requestAnimationFrame(frame);
