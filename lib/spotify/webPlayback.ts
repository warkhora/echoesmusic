/**
 * Spotify Web Playback SDK — loader and ambient typings.
 *
 * The SDK registers a real Connect device for this browser tab, which is what
 * gives Echoes a stable `device_id` to target. Playback PUTs then go straight
 * to `api.spotify.com` from the client (no server hop, no serverless timeout).
 */

export interface SdkTrack {
  id: string;
  name: string;
  uri: string;
  duration_ms: number;
  album?: { name?: string; uri?: string; images?: { url: string; width?: number; height?: number }[] };
  artists?: { id?: string; name: string; uri?: string }[];
  is_playable?: boolean;
}

export interface SdkPlayerState {
  context: { uri: string | null } | null;
  duration: number;
  paused: boolean;
  position: number;
  loading: boolean;
  repeat_mode: number;
  shuffle: boolean;
  track_window: {
    current_track: SdkTrack;
    previous_tracks: SdkTrack[];
    next_tracks: SdkTrack[];
  };
  restrictions?: { disallow_pausing_reasons?: string[]; disallow_resuming_reasons?: string[] };
  playback_id?: string;
  playback_speed?: number;
  disallows?: Record<string, boolean>;
}

export interface SdkError {
  message?: string;
  status?: number;
}

export interface SdkPlayer {
  addListener(event: "ready", cb: (data: { device_id: string }) => void): boolean;
  addListener(event: "not_ready", cb: (data: { device_id: string }) => void): boolean;
  addListener(event: "player_state_changed", cb: (state: SdkPlayerState | null) => void): boolean;
  addListener(
    event:
      | "initialization_error"
      | "authentication_error"
      | "account_error"
      | "playback_error"
      | "autoplay_failed",
    cb: (error: SdkError) => void,
  ): boolean;
  addListener(event: string, cb: (data: never) => void): boolean;
  removeListener(event: string): boolean;
  connect(): Promise<boolean>;
  disconnect(): void;
  destroy(): void;
  getCurrentState(): Promise<SdkPlayerState | null>;
  togglePlay(): Promise<void>;
  play(): Promise<void>;
  pause(): Promise<void>;
  resume(): Promise<void>;
  nextTrack(): Promise<void>;
  previousTrack(): Promise<void>;
  seek(positionMs: number): Promise<void>;
  setVolume(volume: number): Promise<void>;
  getVolume(): Promise<number>;
  activateElement(): Promise<void>;
}

export interface SpotifyNamespace {
  Player: new (options: {
    name: string;
    getOAuthToken: (cb: (token: string) => void) => void;
    volume?: number;
    id?: string;
  }) => SdkPlayer;
}

declare global {
  interface Window {
    onSpotifyWebPlaybackSDKReady?: () => void;
    Spotify?: SpotifyNamespace;
    /** Set by the SDK `ready` listener — required before any play command. */
    spotifyDeviceId?: string | null;
  }
}

export const SDK_URL = "https://sdk.scdn.co/spotify-player.js";
const LOAD_TIMEOUT_MS = 12_000;

let loadPromise: Promise<void> | null = null;

/** Injects the SDK exactly once and resolves when it reports ready. */
export function loadWebPlaybackSDK(): Promise<void> {
  if (typeof window === "undefined") {
    return Promise.reject(new Error("The Web Playback SDK needs a browser."));
  }
  if (window.Spotify) return Promise.resolve();
  if (loadPromise) return loadPromise;

  loadPromise = new Promise<void>((resolve, reject) => {
    let settled = false;
    const done = (fn: () => void) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      fn();
    };

    const timer = window.setTimeout(() => {
      done(() => {
        loadPromise = null;
        reject(new Error("The Web Playback SDK did not load in time (blocked or offline)."));
      });
    }, LOAD_TIMEOUT_MS);

    window.onSpotifyWebPlaybackSDKReady = () => done(resolve);

    if (document.querySelector(`script[src="${SDK_URL}"]`)) return; // ready callback will fire

    const script = document.createElement("script");
    script.src = SDK_URL;
    script.async = true;
    script.onerror = () =>
      done(() => {
        loadPromise = null;
        reject(new Error("The Web Playback SDK could not be downloaded."));
      });
    document.body.appendChild(script);
  });

  return loadPromise;
}

export function sdkDeviceId(): string | null {
  if (typeof window === "undefined") return null;
  return window.spotifyDeviceId ?? null;
}

export function clearSdkDeviceId(): void {
  if (typeof window !== "undefined") window.spotifyDeviceId = null;
}
