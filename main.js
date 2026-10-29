/**
 * Echoes — Electron main process.
 *
 * Launches Echoes in a standalone desktop window (1200x800, frameless custom
 * frame, no address bar). The renderer is the Next.js app: either an already
 * running server (default http://127.0.0.1:3000, override with ECHOES_URL) or,
 * when ELECTRON_START_NEXT=1, a `next start`/`next dev` child process spawned
 * here so the desktop app is self-contained from a source checkout.
 *
 * Media keys are registered globally; Space / Arrow keys are intercepted only
 * while the Echoes window is focused (via before-input-event) so they never
 * hijack the rest of the OS.
 */

const { app, BrowserWindow, globalShortcut, ipcMain, shell } = require("electron");
const path = require("path");
const http = require("http");
const { spawn } = require("child_process");

const PORT = Number(process.env.ECHOES_PORT || 3000);
const TARGET_URL = process.env.ECHOES_URL || `http://127.0.0.1:${PORT}`;
const START_NEXT = process.env.ELECTRON_START_NEXT === "1";

/** @type {BrowserWindow | null} */
let win = null;
/** @type {import("child_process").ChildProcess | null} */
let nextChild = null;

function waitForServer(url, timeoutMs = 60000) {
  const started = Date.now();
  return new Promise((resolve) => {
    const tick = () => {
      const req = http.get(url, (res) => {
        res.resume();
        resolve(true);
      });
      req.on("error", () => {
        if (Date.now() - started > timeoutMs) return resolve(false);
        setTimeout(tick, 500);
      });
      req.setTimeout(2000, () => req.destroy());
    };
    tick();
  });
}

function sendMedia(command) {
  if (win && !win.isDestroyed()) win.webContents.send("echoes:media", command);
}

function registerMediaShortcuts() {
  const map = [
    ["MediaPlayPause", "playpause"],
    ["MediaNextTrack", "next"],
    ["MediaPreviousTrack", "previous"],
    ["MediaStop", "playpause"],
  ];
  for (const [accelerator, command] of map) {
    const ok = globalShortcut.register(accelerator, () => sendMedia(command));
    if (!ok) console.warn(`[echoes] could not register ${accelerator}`);
  }
}

function createWindow() {
  win = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    frame: false, // custom native frame, no address bar
    backgroundColor: "#0b0c10",
    show: false,
    title: "Echoes",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  win.once("ready-to-show", () => win && win.show());
  win.on("maximized", () => win && win.webContents.send("echoes:window-maximized", true));
  win.on("unmaximized", () => win && win.webContents.send("echoes:window-maximized", false));
  win.on("closed", () => {
    win = null;
  });

  // Space / arrows act as media keys only while Echoes is focused.
  win.webContents.on("before-input-event", (event, input) => {
    if (input.type !== "keyDown" || input.isComposing) return;
    const focused = win && win.focused;
    if (!focused) return;
    switch (input.code) {
      case "Space":
        if (input.control || input.meta || input.alt) return;
        event.preventDefault();
        sendMedia("playpause");
        break;
      case "ArrowRight":
        event.preventDefault();
        sendMedia(input.shift ? "volume-up" : "seek-forward");
        break;
      case "ArrowLeft":
        event.preventDefault();
        sendMedia(input.shift ? "volume-down" : "seek-back");
        break;
      case "ArrowUp":
        event.preventDefault();
        sendMedia("volume-up");
        break;
      case "ArrowDown":
        event.preventDefault();
        sendMedia("volume-down");
        break;
      default:
        break;
    }
  });

  // External links open in the real browser, never inside the frame.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("http")) shell.openExternal(url);
    return { action: "deny" };
  });

  const load = () =>
    win.loadURL(TARGET_URL).catch(() => {
      // Server not up yet: retry with a friendly retry page.
      setTimeout(() => win && !win.isDestroyed() && load(), 1500);
    });
  load();
}

function registerIpc() {
  ipcMain.on("window:minimize", () => win && win.minimize());
  ipcMain.on("window:maximize", () => {
    if (!win) return;
    if (win.isMaximized()) win.unmaximize();
    else win.maximize();
  });
  ipcMain.on("window:close", () => win && win.close());
  ipcMain.handle("window:is-maximized", () => (win ? win.isMaximized() : false));
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });

  app.whenReady().then(async () => {
    if (START_NEXT) {
      const isDev = process.env.NODE_ENV === "development";
      nextChild = spawn("npx", isDev ? ["next", "dev", "-p", String(PORT)] : ["next", "start", "-p", String(PORT)], {
        cwd: __dirname,
        stdio: "inherit",
      });
      nextChild.on("exit", () => {
        nextChild = null;
      });
      await waitForServer(TARGET_URL);
    }
    registerIpc();
    registerMediaShortcuts();
    createWindow();

    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on("will-quit", () => {
    globalShortcut.unregisterAll();
    if (nextChild) {
      nextChild.kill();
      nextChild = null;
    }
  });

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });
}
