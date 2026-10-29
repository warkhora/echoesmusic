"use client";

import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import {
  Cast,
  Check,
  Globe,
  Laptop,
  RefreshCw,
  Smartphone,
  Speaker,
  Tablet,
  Tv,
  WifiOff,
  X,
} from "lucide-react";
import { describeDevice, type SpDevice } from "@/lib/spotify/client";
import { EASE } from "@/components/motion";
import { Spinner } from "@/components/Spinner";
import { Volume2 } from "lucide-react";
import { useState } from "react";
import { usePlayer } from "@/state/player";

function DeviceIcon({ type }: { type: string }) {
  const kind = (type ?? "").toLowerCase();
  const props = { className: "h-3.5 w-3.5", strokeWidth: 1.6 } as const;
  if (kind === "computer" || kind === "desktop") return <Laptop {...props} />;
  if (kind === "web" || kind === "browser") return <Globe {...props} />;
  if (kind === "smartphone") return <Smartphone {...props} />;
  if (kind === "tablet") return <Tablet {...props} />;
  if (kind === "tv") return <Tv {...props} />;
  if (kind === "castaudio" || kind === "cast") return <Cast {...props} />;
  return <Speaker {...props} />;
}

/**
 * Floating device recovery panel.
 *
 * Rendered when Echoes cannot find an active output: it explains what to do,
 * lists every device Spotify reported so the listener can transfer playback by
 * hand, and offers a re-check that re-runs `GET /v1/me/player/devices`.
 */
export function DevicePanel() {
  const {
    deviceNotice,
    devices,
    activeDeviceId,
    isResolvingDevice,
    retryDevices,
    transferToDevice,
    dismissDeviceNotice,
    webPlayer,
    activateAudio,
  } = usePlayer();
  const [unlocking, setUnlocking] = useState(false);
  const reduce = useReducedMotion();

  return (
    <AnimatePresence>
      {deviceNotice && (
        <motion.div
          role="status"
          aria-live="polite"
          initial={reduce ? { opacity: 0 } : { opacity: 0, y: 14, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={reduce ? { opacity: 0 } : { opacity: 0, y: 10, scale: 0.985 }}
          transition={{ duration: 0.42, ease: EASE }}
          className="glass sheen absolute bottom-[calc(100%+12px)] left-1/2 z-50 w-[min(560px,calc(100vw-2rem))] -translate-x-1/2 rounded-[22px] p-4"
        >
          <span
            className="pointer-events-none absolute inset-x-8 -top-px h-px"
            style={{
              background:
                "linear-gradient(90deg, transparent, var(--accent-2), var(--accent-3), transparent)",
            }}
          />

          <div className="flex items-start gap-3">
            <span
              className="grid h-9 w-9 shrink-0 place-items-center rounded-full"
              style={{
                background:
                  "linear-gradient(150deg, color-mix(in oklab, var(--accent-1) 70%, transparent), color-mix(in oklab, var(--accent-3) 55%, transparent))",
                boxShadow: "0 0 26px -8px var(--accent-glow)",
              }}
            >
              {deviceNotice.kind === "busy" ? (
                <Spinner size={15} />
              ) : (
                <WifiOff className="h-4 w-4 text-white/90" strokeWidth={1.6} />
              )}
            </span>

            <div className="min-w-0 flex-1">
              <p className="text-[13px] font-semibold tracking-tight text-white/92">
                {deviceNotice.title}
              </p>
              <p className="mt-1 text-[11.5px] leading-relaxed text-white/52">
                {deviceNotice.detail}
              </p>
            </div>

            <button
              type="button"
              onClick={dismissDeviceNotice}
              aria-label="Dismiss"
              className="grid h-7 w-7 shrink-0 place-items-center rounded-full text-white/40 transition-all duration-300 hover:rotate-90 hover:text-white"
            >
              <X className="h-3.5 w-3.5" strokeWidth={1.8} />
            </button>
          </div>

          {webPlayer.status !== "idle" && webPlayer.status !== "ready" && webPlayer.error && (
            <p className="mt-3 rounded-xl border border-white/8 bg-white/[0.03] px-3 py-2 text-[11px] leading-relaxed text-white/45">
              <span className="font-semibold text-white/70">Echoes Web Player: </span>
              {webPlayer.error}
            </p>
          )}

          {deviceNotice.showDevices && (devices.length > 0 || webPlayer.deviceId) && (
            <div className="mt-3.5 border-t border-white/8 pt-3">
              <p className="px-0.5 font-mono text-[8.5px] uppercase tracking-[0.24em] text-white/28">
                {devices.length} device{devices.length === 1 ? "" : "s"} on this account
              </p>
              <ul className="mt-2 flex flex-col gap-1.5">
                {webPlayer.deviceId && (
                  <li>
                    <div
                      className={`flex w-full items-center gap-2.5 rounded-xl border px-3 py-2 text-left ${
                        webPlayer.deviceId === activeDeviceId
                          ? "border-white/22 bg-white/[0.09]"
                          : "border-white/10 bg-white/[0.03]"
                      }`}
                    >
                      <span className="text-[var(--accent-3)]">
                        <Globe className="h-3.5 w-3.5" strokeWidth={1.6} />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[12px] font-medium text-white/88">
                          Echoes Web Player
                        </span>
                        <span className="block truncate font-mono text-[9.5px] uppercase tracking-[0.16em] text-white/35">
                          this browser · {webPlayer.connected ? "connected" : webPlayer.status} ·{" "}
                          {webPlayer.deviceId.slice(0, 8)}
                        </span>
                      </span>
                      {webPlayer.deviceId === activeDeviceId ? (
                        <span className="flex shrink-0 items-center gap-1.5 font-mono text-[8.5px] uppercase tracking-[0.18em] text-[var(--accent-3)]">
                          <Check className="h-3 w-3" strokeWidth={2.4} />
                          active
                        </span>
                      ) : (
                        <button
                          type="button"
                          onClick={() => transferToDevice(webPlayer.deviceId!)}
                          className="shrink-0 rounded-full border border-white/14 px-2.5 py-1 font-mono text-[8.5px] uppercase tracking-[0.18em] text-white/55 transition-colors duration-300 hover:text-white"
                        >
                          transfer
                        </button>
                      )}
                    </div>
                  </li>
                )}
                {devices.map((device: SpDevice) => {
                  const active = Boolean(device.id) && device.id === activeDeviceId;
                  return (
                    <li key={device.id ?? device.name}>
                      <button
                        type="button"
                        disabled={!device.id || device.is_restricted || active}
                        onClick={() => device.id && transferToDevice(device.id)}
                        className={`flex w-full items-center gap-2.5 rounded-xl border px-3 py-2 text-left transition-all duration-300 disabled:cursor-default ${
                          active
                            ? "border-white/22 bg-white/[0.09]"
                            : device.is_restricted || !device.id
                              ? "border-white/6 bg-white/[0.02] opacity-45"
                              : "border-white/10 bg-white/[0.03] hover:border-white/22 hover:bg-white/[0.07]"
                        }`}
                      >
                        <span className={active ? "text-[var(--accent-3)]" : "text-white/45"}>
                          <DeviceIcon type={device.type} />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[12px] font-medium text-white/88">
                            {device.name}
                          </span>
                          <span className="block truncate text-[10px] text-white/38">
                            {describeDevice(device).replace(`${device.name} `, "")}
                            {device.is_restricted ? " · restricted" : ""}
                          </span>
                        </span>
                        {active ? (
                          <span className="flex shrink-0 items-center gap-1.5 font-mono text-[8.5px] uppercase tracking-[0.18em] text-[var(--accent-3)]">
                            <Check className="h-3 w-3" strokeWidth={2.4} />
                            active
                          </span>
                        ) : (
                          !device.is_restricted &&
                          device.id && (
                            <span className="shrink-0 font-mono text-[8.5px] uppercase tracking-[0.18em] text-white/30">
                              transfer
                            </span>
                          )
                        )}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}

          <div className="mt-3.5 flex flex-wrap items-center gap-2.5">
            <button
              type="button"
              onClick={retryDevices}
              disabled={isResolvingDevice}
              className="flex items-center gap-2 rounded-full bg-white px-4 py-2 text-[11.5px] font-semibold text-[#0b0c10] transition-transform duration-400 hover:scale-[1.03] disabled:opacity-55 disabled:hover:scale-100"
            >
              {isResolvingDevice ? (
                <Spinner size={11} className="text-[#0b0c10]/70" />
              ) : (
                <RefreshCw className="h-3 w-3" strokeWidth={2.2} />
              )}
              {isResolvingDevice ? "Checking…" : "Check devices again"}
            </button>
            <button
              type="button"
              disabled={unlocking}
              onClick={() => {
                setUnlocking(true);
                void activateAudio().finally(() => {
                  setUnlocking(false);
                  retryDevices();
                });
              }}
              className="glass-thin flex items-center gap-2 rounded-full px-4 py-2 text-[11.5px] text-white/70 transition-colors duration-300 hover:text-white disabled:opacity-55"
              title="Grants audio and DRM permission to this tab"
            >
              {unlocking ? <Spinner size={11} /> : <Volume2 className="h-3 w-3" strokeWidth={1.8} />}
              Enable audio in this tab
            </button>
            {webPlayer.status === "error" || webPlayer.status === "premium-required" ? (
              <button
                type="button"
                onClick={webPlayer.retry}
                className="glass-thin rounded-full px-4 py-2 text-[11.5px] text-white/70 transition-colors duration-300 hover:text-white"
              >
                Restart Echoes player
              </button>
            ) : null}
            <span className="font-mono text-[9px] uppercase tracking-[0.18em] text-white/28">
              GET /v1/me/player/devices
            </span>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
