"use strict";
// =============================================================================
// Cyberpunk 2D77, desktop app: the Electron main process.
//
// The game itself is the same static web page as the browser build. It is
// served from a private app://cp2d77/ origin (not file://), so fetch() works
// (Web Audio decodes the sound effects) and localStorage has a stable home.
// The page talks to this process only through the small window.desktop API
// in preload.js (display mode, window size, quit).
//
// Keys: F11 fullscreen, Ctrl+Q quit; in development also F12 / Ctrl+Shift+I
// (devtools) and Ctrl+R (reload). There is no menu bar (on macOS, the usual
// app menu). The log is <userData>/logs/main.log.
//
// Environment variables (all optional):
//   CP2D77_USER_DATA   use this folder for settings, saves, the window state and the log
//   CP2D77_NO_UPDATE   "1": never check GitHub for updates
//   CP2D77_DEVTOOLS    "1": allow the developer tools in a packaged build
// =============================================================================
const { app, BrowserWindow, Menu, ipcMain, net, protocol, screen, session, shell } = require("electron");
const fs = require("fs");
const path = require("path");
const { pathToFileURL } = require("url");

const GAME_DIR = path.join(__dirname, ".."); // index.html, js/, img/, ... (inside app.asar when packaged)
const ORIGIN = "app://cp2d77";
const PUBLIC = /^\/(index\.html|style\.css|(js|img|sound|fonts)\/[^/]+)$/; // all the page may load
const DEV = !app.isPackaged || process.env.CP2D77_DEVTOOLS === "1";
const MIN_SIZE = { width: 480, height: 270 };

if (process.env.CP2D77_USER_DATA) app.setPath("userData", path.resolve(process.env.CP2D77_USER_DATA));

// To stdout and to <userData>/logs/main.log (a desktop app's stdout is rarely seen)
const logFile = path.join(app.getPath("userData"), "logs", "main.log");
function log(...args) {
  const line = args.map((a) => (a instanceof Error ? a.message : String(a))).join(" ");
  console.log(line);
  try {
    fs.mkdirSync(path.dirname(logFile), { recursive: true });
    if (fs.existsSync(logFile) && fs.statSync(logFile).size > 512 * 1024) fs.renameSync(logFile, logFile + ".old");
    fs.appendFileSync(logFile, `${new Date().toISOString()} ${line}\n`);
  } catch (err) {
    /* no log file, then */
  }
}

// Games make noise without asking: no click needed before audio can start.
app.commandLine.appendSwitch("autoplay-policy", "no-user-gesture-required");

protocol.registerSchemesAsPrivileged([
  { scheme: "app", privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, codeCache: true } },
]);

// Everything the page loads comes from the game folder (or blobs it makes
// itself, e.g. for an audio worklet). No eval, no remote code.
const CSP = [
  "default-src 'self'",
  "script-src 'self' blob:",
  "worker-src 'self' blob:",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "media-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self' data: blob:",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join("; ");

async function serveGameFile(request) {
  const url = new URL(request.url);
  let pathname;
  try {
    pathname = decodeURIComponent(url.pathname);
  } catch (err) {
    return new Response("Bad request", { status: 400 });
  }
  if (pathname === "/") pathname = "/index.html";
  const file = path.join(GAME_DIR, pathname);
  const inside = path.relative(GAME_DIR, file);
  if (url.host !== "cp2d77" || !PUBLIC.test(pathname) || inside.startsWith("..") || path.isAbsolute(inside)) {
    return new Response("Not found", { status: 404 });
  }
  let res;
  try {
    res = await net.fetch(pathToFileURL(file).toString(), { headers: request.headers }); // passes Range on, for <audio>
  } catch (err) {
    return new Response("Not found", { status: 404 });
  }
  if (pathname !== "/index.html") return res; // as is: keeps its length, so audio knows its duration
  const headers = new Headers(res.headers);
  headers.set("Content-Security-Policy", CSP);
  return new Response(await res.text(), { status: res.status, headers });
}

// ------------------------------------------------------------ Window state ---
// Size, position, maximized and fullscreen, saved when the window closes.
const stateFile = () => path.join(app.getPath("userData"), "window-state.json");

function loadWindowState() {
  let s = {};
  try {
    s = JSON.parse(fs.readFileSync(stateFile(), "utf8")) || {};
  } catch (err) {
    /* first launch, or a broken file: use the defaults */
  }
  const num = (v) => (Number.isFinite(v) ? Math.round(v) : undefined);
  const state = { x: num(s.x), y: num(s.y), width: num(s.width), height: num(s.height), maximized: s.maximized === true, fullscreen: s.fullscreen === true };
  // Forget the position if that monitor is gone, and never open bigger than the screen
  const placed = state.x !== undefined && state.y !== undefined;
  const area = (placed ? screen.getDisplayMatching({ x: state.x, y: state.y, width: state.width || 1280, height: state.height || 720 }) : screen.getPrimaryDisplay()).workArea;
  const visible = placed && screen.getAllDisplays().some(({ workArea: a }) => state.x < a.x + a.width - 40 && state.x + (state.width || 0) > a.x + 40 && state.y >= a.y - 10 && state.y < a.y + a.height - 40);
  if (!visible) state.x = state.y = undefined;
  if (!(state.width >= MIN_SIZE.width && state.height >= MIN_SIZE.height)) state.width = state.height = undefined;
  if (state.width) {
    state.width = Math.min(state.width, area.width);
    state.height = Math.min(state.height, area.height);
  }
  return state;
}

function saveWindowState(win) {
  try {
    const bounds = win.getNormalBounds();
    const state = { ...bounds, maximized: win.isMaximized(), fullscreen: win.isFullScreen() };
    fs.mkdirSync(path.dirname(stateFile()), { recursive: true });
    fs.writeFileSync(stateFile(), JSON.stringify(state));
  } catch (err) {
    log("[desktop] could not save the window state:", err.message);
  }
}

// --------------------------------------------------------------- Display ---
function displayState(win) {
  const display = screen.getDisplayMatching(win.getBounds());
  const [width, height] = win.getContentSize();
  return {
    fullscreen: win.isFullScreen(),
    width,
    height,
    screen: { width: display.workArea.width, height: display.workArea.height },
    scaleFactor: display.scaleFactor,
  };
}

function waitFor(win, event, ms) {
  return new Promise((resolve) => {
    const done = () => {
      clearTimeout(timer);
      win.removeListener(event, done);
      resolve();
    };
    const timer = setTimeout(done, ms);
    win.once(event, done);
  });
}

// Fullscreen on/off, and/or a new window size (the game area, in screen
// points). The size only applies in windowed mode and is shrunk, keeping its
// shape, to fit the screen the window is on.
async function setDisplay(win, { fullscreen, width, height } = {}) {
  if (typeof fullscreen === "boolean" && fullscreen !== win.isFullScreen()) {
    const changed = waitFor(win, fullscreen ? "enter-full-screen" : "leave-full-screen", 2000);
    win.setFullScreen(fullscreen);
    await changed;
  }
  if (!win.isFullScreen() && Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0) {
    if (win.isMaximized()) win.unmaximize();
    const area = screen.getDisplayMatching(win.getBounds()).workArea;
    const [outerW, outerH] = win.getSize();
    const [innerW, innerH] = win.getContentSize();
    const maxW = area.width - (outerW - innerW);
    const maxH = area.height - (outerH - innerH);
    const k = Math.min(1, maxW / width, maxH / height);
    const w = Math.max(MIN_SIZE.width, Math.floor(width * k));
    const h = Math.max(MIN_SIZE.height, Math.floor(height * k));
    win.setContentSize(w, h);
    // Keep it on that screen
    const b = win.getBounds();
    const x = Math.min(Math.max(b.x, area.x), area.x + area.width - b.width);
    const y = Math.min(Math.max(b.y, area.y), area.y + area.height - b.height);
    if (x !== b.x || y !== b.y) win.setPosition(x, y);
  }
  return displayState(win);
}

// ------------------------------------------------------------------ Window ---
let mainWindow = null;

function createWindow() {
  const state = loadWindowState();
  // First launch: a 1280x720 game area, smaller if the screen is
  const area = screen.getPrimaryDisplay().workArea;
  const k = Math.min(1, (area.width - 80) / 1280, (area.height - 80) / 720);
  const win = new BrowserWindow({
    title: "Cyberpunk 2D77",
    x: state.x,
    y: state.y,
    width: state.width || Math.round(1280 * k),
    height: state.height || Math.round(720 * k),
    useContentSize: !state.width, // saved sizes are whole windows
    minWidth: MIN_SIZE.width,
    minHeight: MIN_SIZE.height,
    fullscreen: state.fullscreen,
    fullscreenable: true,
    backgroundColor: "#000000",
    show: false,
    icon: path.join(__dirname, "icon.png"),
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      spellcheck: false,
      devTools: DEV,
    },
  });
  mainWindow = win;
  if (state.maximized && !state.fullscreen) win.maximize();
  win.once("ready-to-show", () => win.show());

  const notify = () => {
    if (!win.isDestroyed()) win.webContents.send("display:changed", displayState(win));
  };
  win.on("enter-full-screen", notify);
  win.on("leave-full-screen", notify);
  win.on("close", () => saveWindowState(win));
  win.on("closed", () => {
    if (mainWindow === win) mainWindow = null;
  });

  // Stay on the game: no navigation away, no new windows (https links open in the browser)
  win.webContents.on("will-navigate", (e, url) => {
    if (!url.startsWith(ORIGIN + "/")) e.preventDefault();
  });
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("https://")) shell.openExternal(url).catch(() => {});
    return { action: "deny" };
  });
  win.webContents.on("render-process-gone", (_e, details) => log("[desktop] renderer gone:", details.reason));
  if (process.platform !== "darwin") win.webContents.on("before-input-event", (e, input) => shortcut(win, e, input));

  win.loadURL(ORIGIN + "/index.html");
  return win;
}

// No menu bar on Windows / Linux: shortcut() handles the keys. macOS keeps
// its usual app menu (quit, copy/paste for the name field, fullscreen).
function buildMenu() {
  if (process.platform !== "darwin") {
    Menu.setApplicationMenu(null);
    return;
  }
  const devItems = DEV ? [{ type: "separator" }, { role: "reload" }, { role: "toggleDevTools" }] : [];
  const view = { label: "View", submenu: [{ role: "togglefullscreen" }, ...devItems] };
  Menu.setApplicationMenu(Menu.buildFromTemplate([{ role: "appMenu" }, { role: "editMenu" }, view, { role: "windowMenu" }]));
}

function shortcut(win, event, input) {
  if (input.type !== "keyDown") return;
  const ctrl = input.control || input.meta;
  let action = null;
  if (input.key === "F11" && !ctrl && !input.alt) action = () => input.isAutoRepeat || win.setFullScreen(!win.isFullScreen());
  else if (ctrl && !input.shift && input.code === "KeyQ") action = () => app.quit();
  else if (DEV && (input.key === "F12" || (ctrl && input.shift && input.code === "KeyI"))) action = () => win.webContents.toggleDevTools();
  else if (DEV && ctrl && !input.shift && input.code === "KeyR") action = () => win.webContents.reload();
  if (!action) return;
  event.preventDefault();
  action();
}

// --------------------------------------------------------------------- IPC ---
// Only the game page itself may call these.
const fromGame = (e) => !!e.senderFrame && e.senderFrame.url.startsWith(ORIGIN + "/");

function registerIpc() {
  ipcMain.handle("display:get", (e) => {
    const win = BrowserWindow.fromWebContents(e.sender);
    return fromGame(e) && win ? displayState(win) : null;
  });
  ipcMain.handle("display:set", (e, req) => {
    const win = BrowserWindow.fromWebContents(e.sender);
    if (!fromGame(e) || !win || !req || typeof req !== "object") return null;
    const size = (v) => (Number.isFinite(v) ? Math.min(16384, Math.max(1, Math.round(v))) : undefined);
    return setDisplay(win, {
      fullscreen: typeof req.fullscreen === "boolean" ? req.fullscreen : undefined,
      width: size(req.width),
      height: size(req.height),
    });
  });
  ipcMain.on("app:quit", (e) => {
    if (fromGame(e)) app.quit();
  });
}

// ------------------------------------------------------------- Auto-update ---
// Silent and best-effort: checks the GitHub releases once, a few seconds after
// start-up, downloads in the background and installs when you quit. It never
// shows a dialog and never throws: offline, rate-limited or broken, it only
// logs.
// Only where an unsigned build can update itself: the AppImage on Linux and
// the NSIS installer on Windows. macOS refuses unsigned updates and .deb
// installs are updated by the package manager.
function startAutoUpdate() {
  if (!app.isPackaged || process.env.CP2D77_NO_UPDATE === "1") return;
  const supported = process.platform === "win32" || (process.platform === "linux" && !!process.env.APPIMAGE);
  if (!supported) return;
  const out = (level) => (msg) => log(`[updater] ${level}:`, String(msg instanceof Error ? msg.message : msg).split("\n")[0]);
  try {
    const { autoUpdater } = require("electron-updater");
    autoUpdater.logger = { info: out("info"), warn: out("warn"), error: out("error"), debug: () => {} };
    autoUpdater.autoDownload = true;
    autoUpdater.autoInstallOnAppQuit = true;
    autoUpdater.on("error", out("error")); // without an "error" listener a failure would crash the app
    autoUpdater.on("update-downloaded", (info) => out("info")(`${info.version} downloaded; it installs when you quit`));
    setTimeout(() => autoUpdater.checkForUpdates().catch(out("error")), 3000);
  } catch (err) {
    out("error")(err);
  }
}

// --------------------------------------------------------------- Start-up ---
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });

  app.whenReady().then(() => {
    protocol.handle("app", serveGameFile);
    session.defaultSession.setPermissionRequestHandler((_wc, permission, callback) => callback(permission === "fullscreen"));
    registerIpc();
    buildMenu();
    createWindow();
    startAutoUpdate();
    app.on("activate", () => {
      if (!mainWindow) createWindow();
    });
  });

  app.on("window-all-closed", () => app.quit());
}
