// Smoke tests for the PACKAGED desktop app (Electron), the way players get it.
// Build it, then run the tests:
//   npm run pack:linux   (or npm run dist:linux, which also makes the AppImage)
//   node tests/electron.test.cjs
// `npm run test:electron` does both. On Linux with no display the tests re-run
// themselves under xvfb-run. `--dev` tests `electron .` instead of the build.
"use strict";
const { spawnSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

if (process.platform === "linux" && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY && !process.env.CP2D77_XVFB) {
  const r = spawnSync("xvfb-run", ["-a", "--server-args=-screen 0 1920x1080x24", process.execPath, __filename, ...process.argv.slice(2)], {
    stdio: "inherit",
    env: { ...process.env, CP2D77_XVFB: "1" },
  });
  if (r.error) console.error("No display, and xvfb-run failed: " + r.error.message);
  process.exit(r.status === null ? 1 : r.status);
}

const { _electron: electron } = require("playwright");

const ROOT = path.resolve(__dirname, "..");
const DIST = path.join(ROOT, "dist");
const PRODUCT = "Cyberpunk 2D77";
const DEV = process.argv.includes("--dev");
const EXE = {
  linux: path.join(DIST, "linux-unpacked", "cyberpunk-2d77"),
  win32: path.join(DIST, "win-unpacked", PRODUCT + ".exe"),
  darwin: path.join(DIST, "mac", PRODUCT + ".app", "Contents", "MacOS", PRODUCT),
}[process.platform];
const APPIMAGE = fs.existsSync(DIST) && fs.readdirSync(DIST).find((f) => f.endsWith(".AppImage"));
// Every internet request fails: the game must not need any
const OFFLINE = "--proxy-server=127.0.0.1:9";

// ------------------------------------------------------------ Tiny harness ---
const results = [];
async function test(name, fn) {
  const started = Date.now();
  try {
    await fn();
    results.push({ ok: true, name });
    console.log(`ok   - ${name} (${Date.now() - started}ms)`);
  } catch (err) {
    results.push({ ok: false, name, err });
    console.log(`FAIL - ${name}\n       ${String(err && err.stack ? err.stack.split("\n").slice(0, 3).join("\n       ") : err)}`);
  }
}
function assert(cond, message) {
  if (!cond) throw new Error(message);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, ms = 5000, what = "condition") {
  for (const end = Date.now() + ms; ; await sleep(50)) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) throw new Error("timed out waiting for " + what);
  }
}

// ----------------------------------------------------------------- Helpers ---
async function launch(userData, { exe = EXE, env = {}, timeout = 60000 } = {}) {
  const app = await electron.launch({
    ...(DEV && exe === EXE ? { args: [ROOT, OFFLINE] } : { executablePath: exe, args: [OFFLINE] }),
    env: { ...process.env, CP2D77_USER_DATA: userData, CP2D77_NO_UPDATE: "1", ...env },
    timeout,
  });
  const output = [];
  app.process().stdout.on("data", (d) => output.push(String(d)));
  app.process().stderr.on("data", (d) => output.push(String(d)));
  const page = await app.firstWindow({ timeout });
  const problems = [];
  page.on("console", (m) => m.type() === "error" && problems.push("console error: " + m.text()));
  page.on("pageerror", (e) => problems.push("page error: " + e.message));
  await page.waitForFunction(() => typeof game !== "undefined" && game.state === "menu", null, { timeout });
  return { app, page, problems, output };
}

// Runs code in the page from the main process. Unlike page.evaluate() (which
// Playwright runs as a user gesture), this is NOT a gesture.
const inPage = (app, code) => app.evaluate(({ BrowserWindow }, js) => BrowserWindow.getAllWindows()[0].webContents.executeJavaScript(js, false), code);

// A key press the way the OS delivers it (through the app's shortcuts;
// page.keyboard goes straight to the page)
const pressKey = (app, keyCode) =>
  app.evaluate(({ BrowserWindow }, keyCode) => {
    const wc = BrowserWindow.getAllWindows()[0].webContents;
    wc.sendInputEvent({ type: "keyDown", keyCode });
    wc.sendInputEvent({ type: "keyUp", keyCode });
  }, keyCode);

const windowInfo = (app) =>
  app.evaluate(({ BrowserWindow, screen }) => {
    const w = BrowserWindow.getAllWindows()[0];
    const d = screen.getDisplayMatching(w.getBounds());
    return { fullscreen: w.isFullScreen(), content: w.getContentSize(), bounds: w.getBounds(), screen: [d.bounds.width, d.bounds.height], menuBar: w.isMenuBarVisible() };
  });

const pageDisplay = (page) =>
  page.evaluate(() => ({
    mode: settings.displayMode,
    resolution: settings.resolution,
    select: document.getElementById("resolution").value,
    canvas: [canvas.width, canvas.height],
    box: [Math.round(canvas.getBoundingClientRect().width), Math.round(canvas.getBoundingClientRect().height)],
    inner: [innerWidth, innerHeight],
    hud: document.getElementById("btn-fullscreen").getAttribute("aria-pressed"),
    seg: document.querySelector('[data-display][aria-pressed="true"]').dataset.display,
    hint: document.getElementById("display-hint").textContent,
    saved: JSON.parse(localStorage.getItem("cp2d77-settings") || "{}"),
  }));

// Is fullscreen and is everything on the page saying so?
async function expectFullscreen(app, page, on) {
  await until(async () => (await windowInfo(app)).fullscreen === on, 5000, "the window fullscreen=" + on);
  await until(async () => (await pageDisplay(page)).mode === (on ? "fullscreen" : "windowed"), 3000, "the page to follow");
  const d = await pageDisplay(page);
  const want = on ? "fullscreen" : "windowed";
  assert(d.hud === String(on) && d.seg === want && d.saved.displayMode === want, "page out of sync: " + JSON.stringify(d));
  return d;
}

// ----------------------------------------------------------------- Tests ----
(async () => {
  if (!DEV && !fs.existsSync(EXE)) {
    console.error(`No packaged app at ${EXE}.\nBuild it first: npm run pack:linux (or dist:linux / dist:win / dist:mac).`);
    process.exit(1);
  }
  console.log(DEV ? "Testing the dev app (electron .)" : "Testing the packaged app: " + path.relative(ROOT, EXE));
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "cp2d77-profile-"));
  let a = await launch(profile);

  await test("boots offline to the menu with the bundled font, no console errors, locked down", async () => {
    // Reload with the listeners attached, so nothing logged at start-up is missed
    await a.page.reload();
    await a.page.waitForFunction(() => typeof game !== "undefined" && game.state === "menu");
    await a.page.waitForTimeout(1200);
    const r = await a.page.evaluate(async () => {
      await document.fonts.ready;
      const g = document.createElement("canvas").getContext("2d");
      g.font = '16px "Press Start 2P"';
      return {
        url: location.href,
        menu: !document.getElementById("overlay").hidden && document.getElementById("overlay-title").textContent,
        fonts: [...document.fonts].map((f) => `${f.family.replace(/"/g, "")}=${f.status}`),
        glyphs: g.measureText("CYBER").width, // Press Start 2P: every glyph is 1em wide
        remote: performance.getEntriesByType("resource").map((e) => e.name).filter((n) => !n.startsWith("app://cp2d77/")),
        node: typeof require !== "undefined" || typeof process !== "undefined",
        api: Object.keys(window.desktop).sort().join(","),
        quit: !document.getElementById("quit-btn").hidden,
      };
    });
    assert(r.url === "app://cp2d77/index.html", "not served from the app: " + r.url);
    assert(r.menu === "Cyberpunk 2D77", "menu not shown: " + r.menu);
    assert(r.fonts.includes("Press Start 2P=loaded"), "bundled font not loaded: " + r.fonts);
    assert(Math.round(r.glyphs) === 80, "canvas text is not using Press Start 2P: " + r.glyphs);
    assert(!r.remote.length, "loaded from the internet: " + r.remote);
    assert(!r.node, "Node.js is reachable from the page");
    assert(r.api === "autoplay,getDisplay,isDesktop,onDisplayChange,platform,quit,setDisplay,setFullscreen,setWindowSize", "unexpected desktop API: " + r.api);
    assert(r.quit, "no Quit button on the menu");
    // app:// serves the game's files and nothing else (fetched from the main process)
    const served = await a.app.evaluate(async ({ net }) => {
      const out = {};
      for (const p of ["/index.html", "/js/main.js", "/fonts/PressStart2P-Regular.ttf", "/package.json", "/desktop/main.js", "/%2e%2e/package.json", "/js/..%2f..%2fpackage.json", "/tests/game.test.cjs"]) {
        out[p] = (await net.fetch("app://cp2d77" + p)).status;
      }
      return out;
    });
    const want = { "/index.html": 200, "/js/main.js": 200, "/fonts/PressStart2P-Regular.ttf": 200 };
    for (const [p, status] of Object.entries(served)) assert(status === (want[p] || 404), `app://cp2d77${p} answered ${status}: ` + JSON.stringify(served));
    // No menu bar (macOS: the app menu). F12 opens devtools in development only.
    const pageWidth = await a.page.evaluate(() => innerWidth);
    await pressKey(a.app, "F12");
    await a.page.waitForTimeout(500);
    const shell = await a.app.evaluate(({ app, Menu, BrowserWindow }) => ({
      packaged: app.isPackaged,
      menu: !!Menu.getApplicationMenu(),
      devtools: BrowserWindow.getAllWindows()[0].webContents.isDevToolsOpened(),
    }));
    if (process.platform !== "darwin") assert(!shell.menu, "there is a menu bar");
    if (DEV) {
      const devtoolsOpen = () => a.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.isDevToolsOpened());
      await until(devtoolsOpen, 5000, "F12 to open devtools in development");
      await pressKey(a.app, "F12");
      await until(async () => !(await devtoolsOpen()), 5000, "devtools to close");
      await a.page.waitForFunction((w) => innerWidth === w, pageWidth); // docked devtools gone
    } else {
      assert(shell.packaged && !shell.devtools, "the packaged app opened devtools: " + JSON.stringify(shell));
    }
    assert(!a.problems.length, a.problems.join("; "));
  });

  await test("audio runs with no click: AudioContext 'running' and the music is audible", async () => {
    // A fresh page that has seen no gesture at all (Playwright's own calls count as one)
    const before = await inPage(a.app, "performance.timeOrigin");
    await a.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.reload());
    const state = () =>
      inPage(a.app, "({ page: performance.timeOrigin, active: navigator.userActivation.hasBeenActive, ctx: typeof SoundSystem !== 'undefined' && SoundSystem.ctx && SoundSystem.ctx.state })").catch(() => ({}));
    await until(async () => {
      const s = await state();
      return s.page !== before && s.ctx === "running";
    }, 8000, "the AudioContext to run after the reload");
    const rms = await inPage(
      a.app,
      `new Promise((resolve) => {
        music.play(true);
        const an = SoundSystem.ctx.createAnalyser();
        an.fftSize = 2048;
        SoundSystem.master.connect(an);
        const buf = new Float32Array(an.fftSize);
        let peak = 0;
        const timer = setInterval(() => {
          an.getFloatTimeDomainData(buf);
          let sum = 0;
          for (const v of buf) sum += v * v;
          peak = Math.max(peak, Math.sqrt(sum / buf.length));
        }, 20);
        setTimeout(() => (clearInterval(timer), SoundSystem.master.disconnect(an), music.pause(), resolve(peak)), 900);
      })`
    );
    const s = await state();
    assert(s.active === false, "a user gesture happened, so this proves nothing: " + JSON.stringify(s));
    assert(s.ctx === "running", "AudioContext is " + s.ctx);
    assert(rms > 0.02, "the music is silent: " + rms);
  });

  await test("Start -> pre-drop loadout -> Drop In starts a run; the game updates and takes input", async () => {
    await a.page.waitForFunction(() => typeof game !== "undefined" && game.state === "menu" && performance.now() - overlayShownAt > 450);
    await a.page.click("#overlay-btn");
    await a.page.waitForSelector("#loadout:not([hidden])", { timeout: 3000 });
    await a.page.click("#drop-btn");
    await a.page.waitForFunction(() => game.state === "playing" && !intro.active, null, { timeout: 8000 }); // after the hero landing
    const before = await a.page.evaluate(() => ({ t: game.time, x: player.x }));
    await a.page.keyboard.down("KeyD");
    await a.page.waitForTimeout(700);
    await a.page.keyboard.up("KeyD");
    const after = await a.page.evaluate(() => ({ t: game.time, x: player.x, state: game.state, ctx: SoundSystem.ctx.state }));
    assert(after.state === "playing" && after.t - before.t > 0.4, "the game is not updating: " + JSON.stringify({ before, after }));
    assert(after.x > before.x + 30, "D did not run right: " + JSON.stringify({ before, after }));
    assert(after.ctx === "running", "audio stopped: " + after.ctx);
    await a.page.keyboard.press("KeyP");
    await a.page.waitForFunction(() => game.state === "paused" && !document.getElementById("settings").hidden);
    assert(!a.problems.length, a.problems.join("; "));
  });

  await test("Fullscreen and Resolution apply live: the window, the render size and the HUD button stay in sync", async () => {
    const start = await windowInfo(a.app);
    // Fullscreen from the settings
    await a.page.click('[data-display="fullscreen"]');
    await expectFullscreen(a.app, a.page, true);
    const full = await windowInfo(a.app);
    // In fullscreen a resolution is the render size; the window stays as it is
    await a.page.selectOption("#resolution", "1600x900");
    await a.page.waitForFunction(() => canvas.width === 1600);
    let d = await pageDisplay(a.page);
    let w = await windowInfo(a.app);
    assert(d.canvas.join() === "1600,900" && d.saved.resolution === "1600x900", "render size not applied: " + JSON.stringify(d));
    assert(w.fullscreen && w.content.join() === full.content.join(), "the window changed in fullscreen: " + JSON.stringify(w));
    assert(d.box[0] === Math.round(Math.min(d.inner[0], (d.inner[1] * 16) / 9)), "the canvas no longer fills the screen: " + JSON.stringify(d));
    assert(/Stretched/.test(d.hint) && /1600x900/.test(d.hint), "hint: " + d.hint);
    // (Without a window manager, e.g. under Xvfb, X11 can't resize a fullscreen window)
    if (full.content.join() !== start.content.join()) assert(full.content.join() === full.screen.join(), "fullscreen does not fill the screen: " + JSON.stringify(full));

    // The HUD button leaves fullscreen, and windowed mode sizes the window to the resolution
    await a.page.keyboard.press("KeyP"); // resume: the menu covers the HUD
    await a.page.waitForFunction(() => game.state === "playing");
    await a.page.click("#btn-fullscreen");
    d = await expectFullscreen(a.app, a.page, false);
    await until(async () => (await windowInfo(a.app)).content.join() === "1600,900", 3000, "a 1600x900 window");
    await a.page.keyboard.press("KeyP");
    await a.page.waitForFunction(() => game.state === "paused");

    await a.page.selectOption("#resolution", "1280x720");
    await until(async () => (await windowInfo(a.app)).content.join() === "1280,720", 3000, "a 1280x720 window");
    await a.page.waitForFunction(() => canvas.width === 1280 && innerWidth === 1280);
    d = await pageDisplay(a.page);
    assert(/Sets the window size/.test(d.hint) && /window 1280x720/.test(d.hint), "hint: " + d.hint);

    // Bigger than the screen: shrunk to fit, keeping 16:9; still renders 4K
    await a.page.selectOption("#resolution", "3840x2160");
    await a.page.waitForFunction(() => canvas.width === 3840);
    await a.page.waitForTimeout(300);
    w = await windowInfo(a.app);
    assert(w.content[0] <= w.screen[0] && w.content[1] <= w.screen[1] && w.content[0] > 1280, "not clamped to the screen: " + JSON.stringify(w));
    assert(Math.abs(w.content[0] / w.content[1] - 16 / 9) < 0.02, "the clamped window lost its shape: " + JSON.stringify(w));

    // Fullscreen changed from outside the page (F11 is handled by the app): the page follows
    await pressKey(a.app, "F11");
    await expectFullscreen(a.app, a.page, true);
    await a.page.selectOption("#resolution", "1600x900"); // what the relaunch should come back with
    await a.page.waitForFunction(() => canvas.width === 1600);
    assert(!a.problems.length, a.problems.join("; "));
  });

  await a.app.close();

  await test("settings and the window come back after a relaunch (fullscreen, then a windowed size and position)", async () => {
    const saved = JSON.parse(fs.readFileSync(path.join(profile, "window-state.json"), "utf8"));
    assert(saved.fullscreen === true, "window state not saved: " + JSON.stringify(saved));
    a = await launch(profile);
    await expectFullscreen(a.app, a.page, true);
    await a.page.waitForFunction(() => canvas.width === 1600);
    let d = await pageDisplay(a.page);
    assert(d.resolution === "1600x900" && d.select === "1600x900" && d.canvas.join() === "1600,900", "resolution not restored: " + JSON.stringify(d));
    // Windowed: the window takes the resolution's size; move it, quit, relaunch
    await a.page.click('[data-display="windowed"]');
    await expectFullscreen(a.app, a.page, false);
    await until(async () => (await windowInfo(a.app)).content.join() === "1600,900", 3000, "a 1600x900 window");
    await a.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setPosition(90, 60));
    await sleep(300);
    const before = await windowInfo(a.app);
    await a.app.close();
    a = await launch(profile);
    await expectFullscreen(a.app, a.page, false);
    const after = await windowInfo(a.app);
    d = await pageDisplay(a.page);
    assert(after.content.join() === "1600,900", "window size not restored: " + JSON.stringify(after));
    assert(after.bounds.x === before.bounds.x && after.bounds.y === before.bounds.y, "position not restored: " + JSON.stringify({ before: before.bounds, after: after.bounds }));
    assert(d.resolution === "1600x900" && d.canvas.join() === "1600,900", "resolution not restored: " + JSON.stringify(d));
    assert(!a.problems.length, a.problems.join("; "));
  });

  await test("Quit on the menu closes the app", async () => {
    const proc = a.app.process();
    const closed = new Promise((resolve) => a.app.once("close", resolve));
    await a.page.click("#quit-btn");
    const ok = await Promise.race([closed.then(() => true), sleep(8000).then(() => false)]);
    assert(ok, "the app is still running after Quit");
    await until(() => proc.exitCode !== null, 3000, "the process to exit");
    assert(proc.exitCode === 0, "exit code " + proc.exitCode);
  });

  // The AppImage itself, with the updater on and no internet: it must start,
  // only log the failed update check, and stay usable (no crash, no dialog)
  if (APPIMAGE && process.platform === "linux" && !DEV) {
    await test(`AppImage (${APPIMAGE}) starts; offline, the update check only logs`, async () => {
      const appProfile = fs.mkdtempSync(path.join(os.tmpdir(), "cp2d77-appimage-"));
      const b = await launch(appProfile, {
        exe: path.join(DIST, APPIMAGE),
        env: { CP2D77_NO_UPDATE: "", APPIMAGE_EXTRACT_AND_RUN: "1" }, // no FUSE needed
        timeout: 120000,
      });
      try {
        const r = await b.page.evaluate(() => ({ url: location.href, fonts: [...document.fonts].map((f) => f.status), title: document.getElementById("overlay-title").textContent }));
        assert(r.url === "app://cp2d77/index.html" && r.fonts.includes("loaded") && r.title === "Cyberpunk 2D77", JSON.stringify(r));
        const logFile = path.join(appProfile, "logs", "main.log");
        const log = await until(() => fs.existsSync(logFile) && fs.readFileSync(logFile, "utf8").match(/\[updater\] error[^\n]*/), 30000, "the updater to report");
        await b.page.waitForTimeout(500);
        const after = await b.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length);
        const alive = await b.page.evaluate(() => game.state);
        assert(after === 1 && alive === "menu", `the app is not as it was: ${after} windows, ${alive}`);
        assert(!b.problems.length, b.problems.join("; "));
        console.log(`       (logged: ${log[0].slice(0, 110)})`);
      } finally {
        await b.app.close();
        fs.rmSync(appProfile, { recursive: true, force: true });
      }
    });
  }

  fs.rmSync(profile, { recursive: true, force: true });
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} tests passed`);
  process.exit(failed.length ? 1 : 0);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
