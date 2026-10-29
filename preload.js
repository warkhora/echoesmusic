/**
 * Echoes — Electron preload.
 *
 * Exposes a tiny, strictly-typed bridge over contextBridge. The renderer never
 * touches Node or ipcRenderer directly; it only sees `window.echoesDesktop`.
 */

const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("echoesDesktop", {
  isDesktop: true,
  platform: process.platform,
  versions: {
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
  },
  window: {
    minimize: () => ipcRenderer.send("window:minimize"),
    maximize: () => ipcRenderer.send("window:maximize"),
    close: () => ipcRenderer.send("window:close"),
    isMaximized: () => ipcRenderer.invoke("window:is-maximized"),
    onMaximized: (cb) => {
      const handler = (_e, maximized) => cb(Boolean(maximized));
      ipcRenderer.on("echoes:window-maximized", handler);
      return () => ipcRenderer.removeListener("echoes:window-maximized", handler);
    },
  },
  /** Media commands pushed from global shortcuts / focused-window key handling. */
  onMediaCommand: (cb) => {
    const handler = (_e, command) => cb(String(command));
    ipcRenderer.on("echoes:media", handler);
    return () => ipcRenderer.removeListener("echoes:media", handler);
  },
});
