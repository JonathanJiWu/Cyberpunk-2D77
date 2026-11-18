"use strict";
// =============================================================================
// The only bridge between the game page and the desktop app. The page sees
// window.desktop with these few functions and nothing else: no Node.js, no
// ipcRenderer, no file system.
// =============================================================================
const { contextBridge, ipcRenderer } = require("electron");

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : undefined);

contextBridge.exposeInMainWorld("desktop", {
  isDesktop: true,
  autoplay: true, // the app has no autoplay restriction: audio can start without a click
  platform: process.platform,

  // -> { fullscreen, width, height, screen: { width, height }, scaleFactor }
  getDisplay: () => ipcRenderer.invoke("display:get"),
  // { fullscreen?: boolean, width?, height? } -> the new display state. The
  // size is the game area in windowed mode, shrunk to fit the screen.
  setDisplay: (opts) =>
    ipcRenderer.invoke("display:set", {
      fullscreen: opts && typeof opts.fullscreen === "boolean" ? opts.fullscreen : undefined,
      width: num(opts && opts.width),
      height: num(opts && opts.height),
    }),
  setFullscreen: (on) => ipcRenderer.invoke("display:set", { fullscreen: !!on }),
  setWindowSize: (width, height) => ipcRenderer.invoke("display:set", { width: num(width), height: num(height) }),
  // Fullscreen changed from outside the page (F11, the OS): cb(state)
  onDisplayChange: (cb) => {
    if (typeof cb === "function") ipcRenderer.on("display:changed", (_event, state) => cb(state));
  },
  quit: () => ipcRenderer.send("app:quit"),
});
