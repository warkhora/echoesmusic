"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  clearSdkDeviceId,
  loadWebPlaybackSDK,
  type SdkPlayer,
  type SdkPlayerState,
} from "@/lib/spotify/webPlayback";

export type WebPlaybackStatus =
  | "idle"
  | "loading"
  | "connecting"
  | "ready"
  | "premium-required"
  | "error";

export interface WebPlayback {
  /** The SDK's Connect device id — also mirrored on `window.spotifyDeviceId`. */
  deviceId: string | null;
  /** `ready` fired *and* `connect()` resolved true — the gate for play calls. */
  connected: boolean;
  /** Resolves browser audio/EME permission; must run inside a user gesture. */
  activate: () => Promise<boolean>;
  status: WebPlaybackStatus;
  error: string | null;
  state: SdkPlayerState | null;
  player: SdkPlayer | null;
  retry: () => void;
}

interface Options {
  token: string | null;
  enabled: boolean;
  volume: number;
  name?: string;
  onState?: (state: SdkPlayerState | null) => void;
}

/**
 * Owns the Web Playback SDK lifecycle: load → construct → connect → `ready`.
 *
 * The `ready` listener publishes `window.spotifyDeviceId`, and nothing in the
 * transport layer is allowed to fire a play command until it exists.
 */
export function useWebPlayback({
  token,
  enabled,
  volume,
  name = "Echoes Web Player",
  onState,
}: Options): WebPlayback {
  const [deviceId, setDeviceId] = useState<string | null>(null);
  const [status, setStatus] = useState<WebPlaybackStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [state, setState] = useState<SdkPlayerState | null>(null);
  const [player, setPlayer] = useState<SdkPlayer | null>(null);
  const [attempt, setAttempt] = useState(0);

  const tokenRef = useRef(token);
  const onStateRef = useRef(onState);
  const playerRef = useRef<SdkPlayer | null>(null);
  /** Both halves of "usable": the ready event and a resolved connect(). */
  const handshake = useRef({ ready: false, connected: false, deviceId: null as string | null });

  const hasToken = Boolean(token);

  useEffect(() => {
    tokenRef.current = token;
  }, [token]);
  useEffect(() => {
    onStateRef.current = onState;
  }, [onState]);

  // Keyed on token *presence*, not its value: a refreshed token must not tear
  // the player down mid-track (`getOAuthToken` hands over the new one anyway).
  useEffect(() => {
    if (!enabled || !tokenRef.current) {
      setStatus("idle");
      setDeviceId(null);
      return;
    }

    let cancelled = false;
    let instance: SdkPlayer | null = null;
    setStatus("loading");
    setError(null);

    void (async () => {
      try {
        await loadWebPlaybackSDK();
      } catch (err) {
        if (cancelled) return;
        setStatus("error");
        setError(
          err instanceof Error
            ? `${err.message} Echoes can still control your other Spotify devices.`
            : "The Web Playback SDK is unavailable.",
        );
        return;
      }

      if (cancelled || typeof window === "undefined" || !window.Spotify) return;

      // Volume must be a finite 0–1 number or the SDK rejects the options bag.
      const initialVolume = Number.isFinite(volume) ? Math.min(1, Math.max(0, volume / 100)) : 0.8;

      instance = new window.Spotify.Player({
        name,
        volume: initialVolume,
        // Always hand back the freshest token — the SDK calls this on refresh.
        getOAuthToken: (cb) => {
          cb(tokenRef.current ?? "");
        },
      });
      playerRef.current = instance;

      const publish = () => {
        const h = handshake.current;
        if (cancelled) return;
        if (h.ready && h.connected && h.deviceId) {
          setDeviceId(h.deviceId);
          setStatus("ready");
          setError(null);
        } else {
          setStatus("connecting");
        }
      };

      instance.addListener("ready", ({ device_id }) => {
        // Required by the transport layer before any play command is sent.
        window.spotifyDeviceId = device_id;
        handshake.current = { ...handshake.current, ready: true, deviceId: device_id };
        publish();
      });

      instance.addListener("not_ready", ({ device_id }) => {
        if (window.spotifyDeviceId === device_id) window.spotifyDeviceId = null;
        handshake.current = { ready: false, connected: false, deviceId: null };
        if (cancelled) return;
        setDeviceId(null);
        setStatus("connecting");
        setError(null);
      });

      instance.addListener("player_state_changed", (next) => {
        if (cancelled) return;
        setState(next);
        onStateRef.current?.(next);
      });

      instance.addListener("account_error", () => {
        if (cancelled) return;
        setStatus("premium-required");
        setError("In-browser playback needs Spotify Premium. Echoes can still control your other devices.");
      });

      instance.addListener("authentication_error", () => {
        if (cancelled) return;
        setStatus("error");
        setError("Spotify rejected the token for in-browser playback. Reconnect to try again.");
      });

      instance.addListener("initialization_error", ({ message }) => {
        if (cancelled) return;
        setStatus("error");
        setError(message ?? "The Web Playback SDK could not start in this browser.");
      });

      instance.addListener("playback_error", ({ message }) => {
        if (cancelled) return;
        const text = message ?? "Playback interrupted.";
        // DRM/EME (PlayReady/Widevine) failures surface here, usually because
        // `activateElement()` has not run inside a user gesture yet.
        if (/drm|eme|widevine|playready|encrypted|robustness/i.test(text)) {
          setStatus("error");
          setError(
            "Your browser blocked encrypted audio (DRM). Press play again to grant audio permission to this tab.",
          );
        } else {
          setError(text);
        }
      });

      instance.addListener("autoplay_failed", () => {
        if (cancelled) return;
        setError("Autoplay was blocked — press play to start audio in this tab.");
      });

      try {
        setStatus("connecting");
        const connected = await instance.connect();
        handshake.current = { ...handshake.current, connected };
        publish();
        if (!connected && !cancelled) {
          setStatus("error");
          setError("Spotify refused the connection for this browser device.");
        }
      } catch (err) {
        if (cancelled) return;
        setStatus("error");
        setError(err instanceof Error ? err.message : "Could not connect the Echoes player.");
      }

      if (!cancelled) setPlayer(instance);
    })();

    return () => {
      cancelled = true;
      const current = instance ?? playerRef.current;
      playerRef.current = null;
      if (current) {
        try {
          current.disconnect();
          current.destroy();
        } catch {
          /* already gone */
        }
      }
      clearSdkDeviceId();
      handshake.current = { ready: false, connected: false, deviceId: null };
      setPlayer(null);
      setDeviceId(null);
      setState(null);
    };
    // `volume` is applied separately, and a rotated token must not restart the
    // player: re-initialising on either would cut audio mid-track.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, hasToken, name, attempt]);

  // Keep SDK output level in step with the preference (persisted in Postgres).
  useEffect(() => {
    const instance = playerRef.current;
    if (!instance || status !== "ready") return;
    const id = window.setTimeout(() => {
      void instance.setVolume(Math.min(1, Math.max(0, volume / 100))).catch(() => undefined);
    }, 220);
    return () => window.clearTimeout(id);
  }, [volume, status]);

  const retry = useCallback(() => {
    clearSdkDeviceId();
    handshake.current = { ready: false, connected: false, deviceId: null };
    setAttempt((n) => n + 1);
  }, []);

  /**
   * `player.activateElement()` — unlocks audio and initialises EME/DRM. Must be
   * invoked synchronously inside a user gesture, so it returns a promise the
   * caller can await *after* the gesture has already been spent.
   */
  const activate = useCallback(async (): Promise<boolean> => {
    const instance = playerRef.current;
    if (!instance) return false;
    try {
      await instance.activateElement();
      return true;
    } catch (error) {
      console.info("[echoes] activateElement failed", error instanceof Error ? error.message : error);
      return false;
    }
  }, []);

  return {
    deviceId,
    connected: status === "ready" && Boolean(deviceId),
    activate,
    status,
    error,
    state,
    player,
    retry,
  };
}
