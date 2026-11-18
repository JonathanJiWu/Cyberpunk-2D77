"use strict";
// =============================================================================
// Display settings: Windowed / Fullscreen and the resolution, plus the desktop
// app's extras (the Quit button, audio without a click).
//   Browser:     fullscreen uses the Fullscreen API (hidden where there is
//                none, e.g. iPhone). A resolution sets the game's internal
//                render size; the canvas still fills the screen, so a lower
//                one runs faster and a higher one looks sharper.
//   Desktop app: window.desktop (desktop/preload.js) drives the real window.
//                In windowed mode a resolution also resizes the window to it
//                (shrunk to fit the screen); in fullscreen it is the render
//                size, as in the browser.
//   Performance mode (perfMode): fewer effects (see perfMode() in core.js)
//                and, with the resolution on Auto, a lower render size: two
//                thirds of the screen's pixels, up to 720p. A resolution you
//                pick is kept as it is. Slow frames suggest it, once.
// Saved with the other settings (cp2d77-settings): displayMode, resolution,
// perfMode (and perfHintShown). js/main.js's layout() calls renderWidthFor()
// to size the canvas.
// =============================================================================

const desktopApp = window.desktop && window.desktop.isDesktop ? window.desktop : null;
const RESOLUTIONS = ["1280x720", "1366x768", "1600x900", "1920x1080", "2560x1440", "3840x2160"];
const displayInfo = { fullscreen: false }; // desktop: the window's state, from the app
const resSelect = document.getElementById("resolution");
const displayHint = document.getElementById("display-hint");
const fsHudButton = document.getElementById("btn-fullscreen");
const quitBtn = document.getElementById("quit-btn");
const fullscreenElement = () => document.fullscreenElement || document.webkitFullscreenElement;

if (!RESOLUTIONS.includes(settings.resolution)) settings.resolution = "auto";
if (settings.displayMode !== "fullscreen") settings.displayMode = "windowed";
if (typeof settings.perfMode !== "boolean") settings.perfMode = false;
const PERF_AUTO = { scale: 0.67, max: 1280 }; // Performance mode, Auto: 2/3 of the pixels across, up to 720p

function parseResolution(value) {
  const m = /^(\d+)x(\d+)$/.exec(value || "");
  return m ? { w: Number(m[1]), h: Number(m[2]) } : null;
}

const isFullscreen = () => (desktopApp ? displayInfo.fullscreen : !!fullscreenElement());

// The canvas width for a game area cssW CSS pixels wide (called by layout())
function renderWidthFor(cssW, dpr) {
  const res = parseResolution(settings.resolution);
  // Auto: the screen's real pixels, capped at 1080p (Performance mode: less)
  const auto = settings.perfMode ? Math.min(PERF_AUTO.max, Math.round(cssW * dpr * PERF_AUTO.scale)) : Math.min(W, Math.round(cssW * dpr));
  const width = res ? res.w : Math.max(320, auto);
  // Shrinking a bigger render to fit looks better smoothed than blocky
  canvas.style.imageRendering = width > cssW * dpr + 1 ? "auto" : "";
  Promise.resolve().then(updateDisplayUI); // once layout() has resized the canvas
  return width;
}

function relayout() {
  if (typeof layout === "function") layout();
  updateDisplayUI();
}

// --------------------------------------------------------------- Display mode
function setDisplayMode(mode) {
  const full = mode === "fullscreen";
  if (desktopApp) {
    const res = parseResolution(settings.resolution);
    const size = !full && res ? { width: res.w, height: res.h } : {};
    return desktopApp
      .setDisplay({ fullscreen: full, ...size })
      .then(onDesktopDisplay)
      .catch(() => {});
  }
  // Browser: the page follows fullscreenchange, so a refused request changes nothing
  if (full === !!fullscreenElement()) return Promise.resolve();
  try {
    if (!full) return Promise.resolve((document.exitFullscreen || document.webkitExitFullscreen).call(document)).catch(() => {});
    const root = document.documentElement;
    const request = root.requestFullscreen || root.webkitRequestFullscreen;
    if (!request) return Promise.resolve();
    return Promise.resolve(request.call(root, { navigationUI: "hide" }))
      .then(() => screen.orientation && screen.orientation.lock && screen.orientation.lock("landscape")) // Android
      .catch(() => {});
  } catch (err) {
    return Promise.resolve(); // no Fullscreen API after all
  }
}
const toggleFullscreen = () => setDisplayMode(isFullscreen() ? "windowed" : "fullscreen"); // the HUD button

function saveDisplayMode() {
  const mode = isFullscreen() ? "fullscreen" : "windowed";
  if (settings.displayMode !== mode) {
    settings.displayMode = mode;
    applySettings(); // saves
  }
}

// The app reports the window: after our requests, F11, or the OS
function onDesktopDisplay(state) {
  if (!state) return;
  displayInfo.fullscreen = !!state.fullscreen;
  saveDisplayMode();
  relayout();
}

// --------------------------------------------------------------- Resolution
resSelect.addEventListener("change", () => {
  settings.resolution = RESOLUTIONS.includes(resSelect.value) ? resSelect.value : "auto";
  applySettings(); // saves
  const res = parseResolution(settings.resolution);
  if (desktopApp && !displayInfo.fullscreen && res) {
    desktopApp
      .setDisplay({ width: res.w, height: res.h })
      .then(onDesktopDisplay)
      .catch(() => {});
  }
  relayout();
});

// --------------------------------------------------------------------- UI ---
function updateDisplayUI() {
  const full = isFullscreen();
  document.querySelectorAll("[data-display]").forEach((b) => b.setAttribute("aria-pressed", String((b.dataset.display === "fullscreen") === full)));
  fsHudButton.setAttribute("aria-pressed", String(full));
  fsHudButton.setAttribute("aria-label", full ? "Exit fullscreen" : "Fullscreen");
  if (resSelect.value !== settings.resolution) resSelect.value = settings.resolution;
  const res = parseResolution(settings.resolution);
  const sizesWindow = desktopApp && !full;
  let what;
  if (!res && settings.perfMode) what = `Auto (Performance mode): two thirds of the ${sizesWindow ? "window" : "screen"}, up to 720p.`;
  else if (!res) what = sizesWindow ? "Auto: matches the window, up to 1080p." : "Auto: matches your screen, up to 1080p.";
  else if (sizesWindow) what = "Sets the window size (shrunk to fit your screen).";
  else what = "Stretched to fill the screen. Lower runs faster.";
  const now = `Render ${canvas.width}x${canvas.height}` + (sizesWindow ? ` · window ${innerWidth}x${innerHeight}` : "");
  displayHint.textContent = `${what} ${now}`;
}

document.querySelectorAll("[data-display]").forEach((b) =>
  b.addEventListener("click", () => {
    setDisplayMode(b.dataset.display);
    clearInput();
  })
);

// Enter / Space on these controls is theirs, not "start the game" (main.js)
[...document.querySelectorAll("[data-display]"), resSelect, quitBtn].forEach((el) =>
  el.addEventListener("keydown", (e) => {
    if (e.code !== "Enter" && e.code !== "Space") return;
    if (document.getElementById("overlay").hidden) el.blur(); // still focused mid-run: let the game have the key
    else e.stopPropagation();
  })
);

// ------------------------------------------------------- Performance mode --
// The switch is a plain data-setting button pair (input.js saves it); here it
// also applies live: the render size, and any extra particles go.
function applyPerfMode() {
  document.body.classList.toggle("perf-mode", perfMode());
  if (typeof particles !== "undefined") while (particles.length > particleCap()) particles.pop();
  relayout();
}
function setPerfMode(on) {
  settings.perfMode = !!on;
  applySettings(); // saves
  applyPerfMode();
}
document.querySelectorAll('[data-setting="perfMode"]').forEach((b) => b.addEventListener("click", applyPerfMode));

// Frames that stay slow (over 22 ms on average, i.e. under ~45 fps, for 5 s
// of play) get a one-time tip to try Performance mode.
const perfHint = { ms: 22, window: 5000, since: 0, sum: 0, n: 0, last: 0 };
function perfHintSample(now) {
  const dt = now - perfHint.last;
  perfHint.last = now;
  const watching = typeof game !== "undefined" && game.state === "playing" && !document.hidden && !settings.perfMode && !settings.perfHintShown;
  if (!watching || dt <= 0 || dt > 250) {
    // not playing, or a hitch / a background tab: start over
    perfHint.sum = perfHint.n = 0;
    return false;
  }
  if (!perfHint.n) perfHint.since = now - dt;
  perfHint.sum += dt;
  perfHint.n++;
  if (now - perfHint.since < perfHint.window) return false;
  const avg = perfHint.sum / perfHint.n;
  perfHint.sum = perfHint.n = 0;
  if (avg <= perfHint.ms) return false;
  settings.perfHintShown = true;
  applySettings(); // saves: the tip shows once
  game.toast = { text: "LAGGING? TRY PERFORMANCE MODE (PAUSE MENU)", time: 6 };
  return true;
}
(function perfHintLoop(now) {
  if (now !== undefined) perfHintSample(now);
  requestAnimationFrame(perfHintLoop);
})();

// ------------------------------------------------------------ Start-up -----
if (desktopApp) {
  quitBtn.hidden = false;
  quitBtn.addEventListener("click", () => desktopApp.quit());
  desktopApp.onDisplayChange(onDesktopDisplay);
  desktopApp
    .getDisplay()
    .then(onDesktopDisplay)
    .catch(() => {});
  SoundSystem.unlock(); // the app has no autoplay restriction: get audio going now
} else {
  // Browsers can't open in fullscreen by themselves: show the real state
  if (!(document.fullscreenEnabled || document.webkitFullscreenEnabled)) document.querySelectorAll(".display-mode").forEach((el) => (el.hidden = true));
  ["fullscreenchange", "webkitfullscreenchange"].forEach((type) =>
    document.addEventListener(type, () => {
      saveDisplayMode();
      relayout();
    })
  );
  saveDisplayMode();
}
document.body.classList.toggle("perf-mode", perfMode());
updateDisplayUI();
