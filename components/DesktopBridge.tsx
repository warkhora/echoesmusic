"use client";

import { Minus, Square, X } from "lucide-react";
import { useEffect, useState, useSyncExternalStore } from "react";
import { usePlayer } from "@/state/player";

interface EchoesDesktop {
  isDesktop: boolean;
  platform: string;
  window: {
    minimize: () => void;
    maximize: () => void;
    close: () => void;
    isMaximized: () => Promise<boolean>;
    onMaximized: (cb: (maximized: boolean) => void) => () => void;
  };
  onMediaCommand: (cb: (command: string) => void) => () => void;
}

declare global {
  interface Window {
    echoesDesktop?: EchoesDesktop;
  }
}

/**
 * Bridges Electron IPC into the player.
 *
 * Media shortcuts (global media keys, plus Space / Arrow keys while the window
 * is focused) arrive as IPC messages and drive the same player actions as the
 * on-screen controls. Also renders frameless window controls (minimize /
 * maximize / close) and marks `<html class="desktop">` so the top bar reserves
 * a drag region.
 */
export function DesktopBridge() {
  const { toggle, next, previous, nudge, setVolume, volume } = usePlayer();
  // SSR-safe external-store read (same pattern as useMediaQuery).
  const desktop = useSyncExternalStore(
    () => () => undefined,
    () => Boolean(typeof window !== "undefined" && window.echoesDesktop?.isDesktop),
    () => false,
  );
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    const api = typeof window !== "undefined" ? window.echoesDesktop : undefined;
    if (!api?.isDesktop) return;
    document.documentElement.classList.add("desktop");

    const offMedia = api.onMediaCommand((command) => {
      switch (command) {
        case "playpause":
          toggle();
          break;
        case "next":
          next();
          break;
        case "previous":
          previous();
          break;
        case "seek-forward":
          nudge(5000);
          break;
        case "seek-back":
          nudge(-5000);
          break;
        case "volume-up":
          setVolume(Math.min(100, volume + 5));
          break;
        case "volume-down":
          setVolume(Math.max(0, volume - 5));
          break;
        default:
          break;
      }
    });
    const offMax = api.window.onMaximized(setMaximized);
    void api.window.isMaximized().then(setMaximized);

    return () => {
      offMedia();
      offMax();
      document.documentElement.classList.remove("desktop");
    };
  }, [toggle, next, previous, nudge, setVolume, volume]);

  if (!desktop) return null;
  const api = window.echoesDesktop;
  if (!api) return null;

  return (
    <div className="no-drag fixed right-2 top-2 z-[95] flex items-center gap-1.5">
      <button
        type="button"
        onClick={() => api.window.minimize()}
        aria-label="Minimize window"
        className="grid h-7 w-7 place-items-center rounded-full border border-white/10 bg-white/[0.06] text-white/60 backdrop-blur-md transition-colors duration-300 hover:bg-white/[0.12] hover:text-white"
      >
        <Minus className="h-3.5 w-3.5" strokeWidth={2} />
      </button>
      <button
        type="button"
        onClick={() => api.window.maximize()}
        aria-label={maximized ? "Restore window" : "Maximize window"}
        className="grid h-7 w-7 place-items-center rounded-full border border-white/10 bg-white/[0.06] text-white/60 backdrop-blur-md transition-colors duration-300 hover:bg-white/[0.12] hover:text-white"
      >
        <Square className="h-3 w-3" strokeWidth={2} />
      </button>
      <button
        type="button"
        onClick={() => api.window.close()}
        aria-label="Close window"
        className="grid h-7 w-7 place-items-center rounded-full border border-white/10 bg-white/[0.06] text-white/60 backdrop-blur-md transition-colors duration-300 hover:bg-rose-500/70 hover:text-white"
      >
        <X className="h-3.5 w-3.5" strokeWidth={2} />
      </button>
    </div>
  );
}
