"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { SpotifyAuth } from "@/hooks/useSpotifyAuth";
import {
  adaptTrack,
  describeDevice,
  isRealTrack,
  pickDevice,
  spotifyFetch,
  type SpDevice,
  type SpDevicesResponse,
  type SpPlayerState,
  type SpTrack,
} from "@/lib/spotify/client";
import { createDebouncedCommit } from "@/lib/debounce";
import { isNaturalEnd, shouldAdoptRemoteTrack } from "@/lib/playback/rules";
import {
  nextTrack as decideNextTrack,
  nextTracks as decideNextTracks,
  type PlaySource,
} from "@/lib/playback/queue";
import { prependRecent, readRecent } from "@/lib/localLibrary";
import { pickNextTrack as pickNextFromCatalog } from "@/lib/recommend";
import { collectPool, rankRecommendations, shouldPrefetchAutoplay } from "@/lib/playback/recommend";
import { peekArtist } from "@/hooks/useEntityPage";
import {
  emitListenLogged,
  emitTrackChanged,
  emitTrackFinished,
} from "@/lib/events";
import { safeJson } from "@/lib/http";
import { loadTrackDetail, trackDetailCache } from "@/lib/spotify/detailCache";
import { adoptTokenHeaders } from "@/lib/spotify/sessionClient";
import { useWebPlayback } from "@/hooks/useWebPlayback";
import {
  ORDERED_SOURCES,
  activeDeviceId as readSdkDeviceId,
  guidanceFor,
  nextTrack,
  pause as pauseTransport,
  executePlay,
  previousTrack,
  resume as resumeTransport,
  seekTo,
  setRepeatState,
  setShuffleState,
  setVolumePercent,
  transferPlayback,
  type TransportResult,
} from "@/lib/spotify/transport";
import type { SdkPlayerState } from "@/lib/spotify/webPlayback";
import { useLibrary } from "@/state/library";
import { usePreferences } from "@/state/preferences";
import type { EchoTrack } from "@/lib/types";

export type RepeatMode = "off" | "context" | "track";

/**
 * One play request, one decision tree. Every clickable track surface in the
 * app funnels through this so the payload Spotify receives is always the right
 * shape for where the click happened.
 */
export type { PlaySource };

export interface PlayRequest {
  /** The track that was clicked. */
  track: EchoTrack;
  /** Surrounding list — keeps the local queue and "up next" meaningful. */
  tracks?: EchoTrack[];
  /** Position of `track` inside `tracks`. */
  index?: number;
  /** Present when the click happened inside a playlist or album. */
  contextUri?: string | null;
  /** Where playback started — decides what follows when the track ends. */
  source?: PlaySource;
}



export type DeviceNoticeKind = "none" | "restricted" | "premium" | "transferred" | "busy";

export interface DeviceNotice {
  kind: DeviceNoticeKind;
  title: string;
  detail: string;
  /** Show the device picker so the listener can choose where to play. */
  showDevices?: boolean;
}

export const NO_DEVICE_NOTICE: DeviceNotice = {
  kind: "none",
  title: "No active Spotify device",
  detail: "Please open Spotify and play a track once to activate your device.",
  showDevices: true,
};

export interface PlayerContextValue {
  queue: EchoTrack[];
  current: EchoTrack | null;
  index: number;
  isPlaying: boolean;
  shuffle: boolean;
  repeat: RepeatMode;
  volume: number;
  mode: "demo" | "spotify";
  deviceName: string | null;
  /** Web Playback SDK state for this browser tab. */
  webPlayer: {
    deviceId: string | null;
    status: string;
    error: string | null;
    /** `ready` fired *and* `connect()` resolved — play calls are gated on this. */
    connected: boolean;
    retry: () => void;
  };
  /** Unlocks audio/EME; must be called synchronously inside a user gesture. */
  activateAudio: () => Promise<boolean>;
  devices: SpDevice[];
  activeDeviceId: string | null;
  deviceNotice: DeviceNotice | null;
  isResolvingDevice: boolean;
  retryDevices: () => void;
  transferToDevice: (deviceId: string) => void;
  dismissDeviceNotice: () => void;
  transportError: string | null;
  isBuffering: boolean;
  isSyncing: boolean;
  /** True while a track transition is committing (blocks duplicate plays). */
  isTransitioning: boolean;
  /** True while autoplay recommendations are being fetched in the background. */
  autoplayFetching: boolean;
  playQueue: (
    tracks: EchoTrack[],
    startIndex?: number,
    options?: { contextUri?: string | null; source?: PlaySource },
  ) => void;
  /** Single track → strictly `{ uris: ["spotify:track:<id>"] }`. */
  playTrack: (track: EchoTrack) => void;
  /**
   * Universal handler: context+offset inside a playlist/album, a single URI
   * everywhere else. This is what every track click in the app calls.
   */
  playFrom: (request: PlayRequest) => void;
  toggle: () => void;
  next: () => void;
  previous: () => void;
  /** Local-only scrub: moves the handle, stages the value, hits no network. */
  scrubTo: (ms: number) => void;
  /** Debounced seek — coalesces rapid calls into one request. */
  seek: (ms: number) => void;
  /** Flushes a staged seek immediately (pointer release). */
  flushSeek: () => void;
  /** Relative seek used by keyboard shortcuts (reads the internal clock). */
  nudge: (deltaMs: number) => void;
  /** Freeze remote updates while the progress bar is being dragged. */
  beginScrub: () => void;
  endScrub: () => void;
  /** Where the current queue came from. */
  playSource: PlaySource;
  /** Next 3 tracks, by the same deterministic rules that drive auto-advance. */
  upNext: EchoTrack[];
  /** True when `upNext` is the source list itself rather than a recommendation. */
  upNextIsSequential: boolean;
  setVolume: (v: number) => void;
  /** Flushes a staged volume change immediately (pointer/key release). */
  commitVolume: () => void;
  toggleShuffle: () => void;
  cycleRepeat: () => void;
  syncNow: () => void;
}

const PlayerContext = createContext<PlayerContextValue | null>(null);

/**
 * The transport clock lives in its own context: it ticks ~8×/second, and only
 * the progress bar should re-render because of it.
 */
export interface PlayerProgressValue {
  progressMs: number;
  durationMs: number;
}
const ProgressContext = createContext<PlayerProgressValue>({ progressMs: 0, durationMs: 0 });

/**
 * How long a local (optimistic) decision wins over an incoming poll. Spotify
 * Connect devices can take a second or two to actually start, so during this
 * window polls may update metadata but never the play/pause state.
 */
const OPTIMISTIC_WINDOW_MS = 2000;

/**
 * Merges detail into a track **without changing object identity** unless a
 * field that is actually rendered differs. Polls arrive every few seconds for
 * the same track; returning a new object each time would re-render the panel
 * and every memo downstream of it.
 */
const MERGED_FIELDS = [
  "title", "artist", "album", "durationMs", "imageUrl", "imageLargeUrl",
  "bpm", "musicalKey", "energy", "danceability", "valence", "explicit", "year",
] as const;

function mergeTrack<T extends EchoTrack>(previous: T | null, detail: Partial<EchoTrack>): T | null {
  if (!previous) return null;
  let changed = false;
  const next = { ...previous };
  for (const field of MERGED_FIELDS) {
    const incoming = detail[field];
    if (incoming === undefined || incoming === null) continue;
    if (next[field] === incoming) continue;
    // Never let a later response erase data we already have.
    (next as Record<string, unknown>)[field] = incoming;
    changed = true;
  }
  return changed ? next : previous;
}
/** Extra grace granted after a reconciliation retry. */
const RETRY_GRACE_MS = 1600;

/**
 * Silent session guard for background work.
 *
 * A failed poll says nothing about the listener's audio: the track keeps playing
 * locally and the UI keeps its state. Only user-initiated commands may surface
 * an error, so background failures are logged at info and swallowed.
 */
function pollFailedSilently(error: unknown): void {
  console.info(
    "[echoes] background playback poll skipped:",
    error instanceof Error ? error.message : error,
  );
}
const TICK_MS = 120;

export function PlayerProvider({ auth, children }: { auth: SpotifyAuth; children: ReactNode }) {
  const { prefs, setVolume: persistVolume } = usePreferences();
  const { catalog, playerSnapshot, savedIds, playlistTracks } = useLibrary();
  const token = auth.session?.accessToken ?? null;
  const mode: "demo" | "spotify" = auth.mode;

  const [queue, setQueue] = useState<EchoTrack[]>([]);
  const [index, setIndex] = useState(-1);
  const [liveTrack, setLiveTrack] = useState<EchoTrack | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [progressMs, setProgressMs] = useState(0);
  const [shuffle, setShuffle] = useState(false);
  const [repeat, setRepeat] = useState<RepeatMode>("off");
  const [volume, setVolumeState] = useState(prefs.volume);
  const [deviceName, setDeviceName] = useState<string | null>(null);
  const [transportError, setTransportError] = useState<string | null>(null);
  const [isBuffering, setIsBuffering] = useState(false);
  const [isSyncing, setIsSyncing] = useState(mode === "spotify");
  const [devices, setDevices] = useState<SpDevice[]>([]);
  const [activeDeviceId, setActiveDeviceId] = useState<string | null>(null);
  const [deviceNotice, setDeviceNotice] = useState<DeviceNotice | null>(null);
  const [isResolvingDevice, setIsResolvingDevice] = useState(false);

  /* ------------------------------- live refs ------------------------------- */
  const clock = useRef({ isPlaying: false, progressMs: 0, durationMs: 0 });
  const queueRef = useRef<EchoTrack[]>([]);
  const indexRef = useRef(-1);
  const liveTrackRef = useRef<EchoTrack | null>(null);
  const modeRef = useRef(mode);
  const repeatRef = useRef<RepeatMode>("off");
  const optimisticUntil = useRef(0);
  /** What the user asked for, so polls can confirm instead of contradicting. */
  const intentRef = useRef<{ playing: boolean | null; at: number; retries: number }>({
    playing: null,
    at: 0,
    retries: 0,
  });
  const lastRunRef = useRef<(() => Promise<unknown>) | null>(null);
  /** One transparent retry per command for 401/503/rate-limit failures. */
  const retriedRef = useRef(false);
  /** Set while a transient failure is unresolved, so reconciliation stands down. */
  const transientFailureRef = useRef(false);
  const reconcileTimers = useRef<number[]>([]);
  const scrubbingRef = useRef(false);
  const tokenRef = useRef(token);
  const activeDeviceRef = useRef<string | null>(null);
  /** Device Spotify has confirmed as active — skips the pre-flight transfer. */
  const deviceConfirmedRef = useRef<string | null>(null);
  const resolvingDevice = useRef(false);
  const noticeTimer = useRef<number | null>(null);
  const autoAdvanceRef = useRef<() => void>(() => undefined);
  /** Marks the next play command as automated (silent, never reverts state). */
  const backgroundPlaybackRef = useRef(false);
  /** Where the current queue came from — drives the continuation rules. */
  const playSourceRef = useRef<PlaySource>("queue");
  /** Tracks played in this session, so recommendations prefer unplayed ones. */
  const playedIdsRef = useRef<Set<string>>(new Set());
  const recentAutoPlay = useRef<string[]>([]);
  /** One auto-advance per track: stops a natural end from firing twice. */
  const autoAdvancedFor = useRef<string | null>(null);
  /** Set by an explicit Pause; cleared only by an explicit Play/Resume. */
  const manualPauseRef = useRef(false);
  /** 3 s window after any transition in which competing triggers are ignored. */
  const transitionLockUntil = useRef(0);
  /** Guarantees one completion handler per track. */
  const endedForRef = useRef<string | null>(null);
  const handleTrackEndedRef = useRef<() => void>(() => undefined);
  /** Track id we optimistically expect after an explicit command (4s window). */
  const expectTrackRef = useRef<{ id: string; until: number } | null>(null);
  /**
   * Transition lock. While a track change is being committed (UI first, then a
   * single play request), duplicate or concurrent play calls for the same track
   * are dropped entirely — this removes the double-play / 503 collision.
   */
  const transitionRef = useRef<{ active: boolean; id: string | null }>({ active: false, id: null });
  const [isTransitioning, setTransitioning] = useState(false);
  /** Generation counter: orphaned commit callbacks from old tracks are dropped. */
  const transitionGenRef = useRef(0);
  const commitTimeoutRef = useRef<number | null>(null);
  /** Recent tracks used as similarity seeds for Autoplay. */
  const seedsRef = useRef<EchoTrack[]>([]);
  const genForRef = useRef<string | null>(null);
  const autoplayRef = useRef(true);
  /** One in-flight recommendation fetch at a time — no network loops. */
  const fetchingAutoplayRef = useRef(false);
  const [autoplayFetching, setAutoplayFetching] = useState(false);
  const maybeAutoplayRef = useRef<() => void>(() => undefined);
  const lastEmittedTrack = useRef<string | null>(null);
  const lastSyncAt = useRef(0);
  const loggedFor = useRef<string | null>(null);
  const featuresById = useRef<Map<string, EchoTrack>>(new Map());
  const playlistTracksRef = useRef<Record<string, EchoTrack[]>>({});
  const advanceRef = useRef<() => void>(() => undefined);

  // Mirrors render state into refs so the clock and poll loops never re-subscribe.
  useEffect(() => {
    tokenRef.current = token;
    queueRef.current = queue;
    indexRef.current = index;
    liveTrackRef.current = liveTrack;
    modeRef.current = mode;
    repeatRef.current = repeat;
    clock.current.isPlaying = isPlaying;
    clock.current.durationMs = durationMs;
    activeDeviceRef.current = activeDeviceId;
    // NB: deviceConfirmedRef is only ever set by a Spotify report (poll, SDK
    // state) or a successful transfer — never by a local guess.
  });

  useEffect(() => {
    const map = new Map<string, EchoTrack>();
    for (const t of catalog.tracks) map.set(t.id, t);
    featuresById.current = map;
  }, [catalog.tracks]);

  useEffect(() => {
    playlistTracksRef.current = playlistTracks;
  }, [playlistTracks]);

  useEffect(() => {
    autoplayRef.current = prefs.autoplay;
  }, [prefs.autoplay]);

  const demoCurrent = index >= 0 ? (queue[index] ?? null) : null;
  const rawCurrent = mode === "spotify" ? (liveTrack ?? demoCurrent) : demoCurrent;
  /** Audio features (BPM, key) arrive with the library — keep them attached. */
  const current = useMemo(() => {
    if (!rawCurrent) return null;
    const known = featuresById.current.get(rawCurrent.id);
    if (!known || known.bpm === rawCurrent.bpm) return rawCurrent;
    return { ...known, ...rawCurrent, bpm: rawCurrent.bpm ?? known.bpm };
    // catalog.tracks is read through the featuresById ref: it must re-run the
    // memo when audio features arrive after the track was already selected.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rawCurrent, catalog.tracks]);
  const durationMs = current?.durationMs ?? 0;

  useEffect(() => {
    clock.current.progressMs = progressMs;
  }, [progressMs]);

  /** Home and Activity listen for this to update without a refetch cycle. */
  useEffect(() => {
    if (!current || current.id === lastEmittedTrack.current) return;
    lastEmittedTrack.current = current.id;
    playedIdsRef.current.add(current.id);
    seedsRef.current = [...seedsRef.current.slice(-5), current];
    // Listening history: prepend immediately and persist, so the rail is never
    // empty on the next startup and needs no refetch to show this track.
    prependRecent(current);
    emitTrackChanged({
      track: current,
      isPlaying: clock.current.isPlaying,
      source: mode,
      at: Date.now(),
    });
  }, [current, mode]);

  /**
   * Refreshes the access token through `/api/spotify/session`, which holds the
   * PKCE refresh token server-side and echoes any rotated pair back in
   * `x-echoes-access-token` / `x-echoes-refresh-token`.
   */
  const refreshSessionToken = useCallback(async (): Promise<string | null> => {
    try {
      const res = await fetch("/api/spotify/session", { cache: "no-store" });
      adoptTokenHeaders(res); // adopts a rotated token if the server minted one
      if (!res.ok) return null;
      const fresh = await auth.getAccessToken();
      if (fresh) tokenRef.current = fresh;
      return fresh;
    } catch {
      return null;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auth.getAccessToken]);

  /* --------------------- coalesced network commits -------------------------- */

  /**
   * Scrubbing and volume fire continuously but must reach Spotify once. Values
   * are staged while the pointer is down; a single flush on release performs
   * exactly one request. A held arrow key uses the debounced `schedule` path.
   */
  const [seekCommit] = useState(() =>
    createDebouncedCommit<number>(300, (ms) => {
      const currentToken = tokenRef.current;
      if (!currentToken || modeRef.current !== "spotify") return;
      optimisticUntil.current = Date.now() + 1200;
      void seekTo(currentToken, activeDeviceRef.current ?? readSdkDeviceId(), ms).then((result) => {
        if (result.ok) setTransportError(null);
        else if (result.kind !== "no-device") {
          setTransportError(guidanceFor(result) ?? result.message);
        }
      });
    }),
  );

  const [volumeCommit] = useState(() =>
    createDebouncedCommit<number>(350, (percent) => {
      const currentToken = tokenRef.current;
      if (!currentToken || modeRef.current !== "spotify") return;
      void setVolumePercent(currentToken, activeDeviceRef.current ?? readSdkDeviceId(), percent);
    }),
  );

  useEffect(
    () => () => {
      seekCommit.cancel();
      volumeCommit.cancel();
    },
    [seekCommit, volumeCommit],
  );

  /* ------------------------------ telemetry -------------------------------- */
  const logListen = useCallback(
    (track: EchoTrack, progress: number, completed: boolean, source: "demo" | "spotify") => {
      if (progress < 20_000 && !completed) return;
      if (loggedFor.current === `${track.id}:${source}`) return;
      loggedFor.current = `${track.id}:${source}`;
      emitListenLogged({
        trackId: track.id,
        trackTitle: track.title,
        artist: track.artist,
        source,
        progressMs: Math.round(progress),
        durationMs: track.durationMs,
        completed,
        at: Date.now(),
      });
      void fetch("/api/playback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          trackId: track.id,
          trackTitle: track.title,
          artist: track.artist,
          source,
          progressMs: Math.round(progress),
          durationMs: track.durationMs,
          completed,
        }),
      }).catch(() => undefined);
    },
    [],
  );

  const setProgress = useCallback((ms: number) => {
    clock.current.progressMs = ms;
    setProgressMs(ms);
  }, []);

  const setPlaying = useCallback((playing: boolean) => {
    clock.current.isPlaying = playing;
    setIsPlaying(playing);
  }, []);

  /* ------------------------- single unified clock -------------------------- */
  useEffect(() => {
    let last = performance.now();
    const id = window.setInterval(() => {
      const now = performance.now();
      const delta = now - last;
      last = now;
      const c = clock.current;
      if (!c.isPlaying || scrubbingRef.current) return;
      let nextProgress = c.progressMs + delta;

      if (c.durationMs > 0 && nextProgress >= c.durationMs - 500) {
        if (repeatRef.current === "track") {
          nextProgress = 0; // explicit repeat: replay, never advance
        } else if (modeRef.current === "demo") {
          // Demo has no SDK: the local tracker IS the completion signal.
          nextProgress = Math.min(nextProgress, c.durationMs);
          c.progressMs = nextProgress;
          setProgress(nextProgress);
          handleTrackEndedRef.current();
          return;
        } else {
          // Spotify mode: hold the bar at the end and let the SDK's own
          // paused-at-end event be the single completion signal. The clock must
          // never advance the queue on its own here.
          nextProgress = c.durationMs;
        }
      }

      c.progressMs = nextProgress;
      setProgressMs(nextProgress);
      maybeAutoplayRef.current();
    }, TICK_MS);
    return () => window.clearInterval(id);
  }, [logListen, setProgress]);


  /* --------------------------- demo queue advance -------------------------- */
  const advanceDemo = useCallback(() => {
    const q = queueRef.current;
    const i = indexRef.current;
    if (!q.length) {
      setPlaying(false);
      return;
    }
    if (i + 1 < q.length) {
      setIndex(i + 1);
      setProgress(0);
      loggedFor.current = null;
      return;
    }
    if (repeatRef.current === "context") {
      setIndex(0);
      setProgress(0);
      loggedFor.current = null;
      return;
    }
    // Queue exhausted: continuous play picks the next recommendation instead of
    // stopping dead, which is what a standalone single-track play would do.
    if (autoAdvanceRef.current) {
      autoAdvanceRef.current();
      return;
    }
    setPlaying(false);
    setProgress(q[i]?.durationMs ?? 0);
  }, [setPlaying, setProgress]);

  useEffect(() => {
    advanceRef.current = advanceDemo;
  }, [advanceDemo]);

  // Log demo listens part-way through, so the Activity surface fills as you go.
  useEffect(() => {
    if (mode !== "demo" || !current || !isPlaying) return;
    if (progressMs > 25_000 && loggedFor.current !== `${current.id}:demo`) {
      logListen(current, progressMs, false, "demo");
    }
  }, [mode, current, isPlaying, progressMs, logListen]);

  /* --------------------- Web Playback SDK (browser device) ------------------- */

  /**
   * The SDK is the source of truth while the Echoes device is active: state
   * arrives locally and instantly, so no HTTP poll is needed for our own tab.
   */
  const applySdkState = useCallback(
    (state: SdkPlayerState | null) => {
      if (!state) return;
      // HARD PAUSE LOCK: while the user has paused, every SDK callback is
      // discarded — it may not resume audio, change the track or touch queue.
      if (manualPauseRef.current) return;
      lastSyncAt.current = Date.now();
      setIsSyncing(false);
      setTransportError(null);

      const sdkId = readSdkDeviceId();
      if (sdkId) {
        setActiveDeviceId(sdkId);
        deviceConfirmedRef.current = sdkId; // our own device is streaming
      }
      setDeviceName("Echoes · this browser");
      setRepeat(state.repeat_mode === 1 ? "context" : state.repeat_mode === 2 ? "track" : "off");
      setShuffle(Boolean(state.shuffle));

      const raw = state.track_window?.current_track;
      const previousSdkTrack = liveTrackRef.current;
      if (raw?.id) {
        const adapted = adaptTrack(raw as unknown as Parameters<typeof adaptTrack>[0]);
        const known = featuresById.current.get(adapted.id);
        const previous = previousSdkTrack;
        if (previous && previous.id !== adapted.id && previous.durationMs) {
          logListen(previous, clock.current.progressMs, clock.current.progressMs > previous.durationMs * 0.85, "spotify");
        }
        setLiveTrack((prev) =>
          prev && prev.id === adapted.id
            ? mergeTrack(prev, { ...known, ...adapted })
            : known
              ? { ...known, ...adapted }
              : adapted,
        );
        const at = queueRef.current.findIndex((t) => t.id === adapted.id);
        if (at >= 0 && at !== indexRef.current) {
          setIndex(at);
          loggedFor.current = null;
        }
      }

      // Respect the optimistic lock exactly like the remote poll does.
      if (Date.now() >= optimisticUntil.current) {
        setPlaying(!state.paused);
        setProgress(Math.min(state.position, state.duration || state.position));
        clock.current.durationMs = state.duration || clock.current.durationMs;
      }

      /**
       * Natural end of a standalone `uris` play: the SDK reports paused with the
       * position at the end of the SAME track. That is a far more reliable
       * signal than a progress timer, which used to fire while Spotify was
       * still queueing the next track and swapped in an unrelated
       * recommendation — the "random song switching" symptom.
       */
      // Completion is detected strictly: paused at (or past) duration - 0.5 s on
      // the SAME track. Everything else routes through the single handler, which
      // is itself guarded to fire once per track.
      const endedNaturally = isNaturalEnd({
        paused: state.paused,
        position: state.position,
        duration: state.duration,
        sameTrackAsBefore: previousSdkTrack?.id === raw?.id,
        alreadyAdvancedForThisTrack: endedForRef.current === raw?.id,
        toleranceMs: 500,
      });
      if (endedNaturally) handleTrackEndedRef.current();
    },
    [logListen, setPlaying, setProgress],
  );

  const web = useWebPlayback({
    token,
    enabled: mode === "spotify" && Boolean(token),
    volume,
    onState: applySdkState,
  });

  const webDeviceRef = useRef<string | null>(null);
  const sdkPlayerRef = useRef<typeof web.player>(null);
  const sdkConnectedRef = useRef(false);

  useEffect(() => {
    sdkPlayerRef.current = web.player;
    sdkConnectedRef.current = web.connected;
  }, [web.player, web.connected]);

  useEffect(() => {
    webDeviceRef.current = web.deviceId;
    if (web.deviceId) {
      setActiveDeviceId(web.deviceId);
      setDeviceNotice((prev) => (prev && prev.kind !== "transferred" ? null : prev));
    }
  }, [web.deviceId]);

  /* --------------------------- spotify: remote sync ------------------------- */
  const applyRemote = useCallback(
    (remote: SpPlayerState | null, authoritative = false) => {
      lastSyncAt.current = Date.now();
      setIsSyncing(false);

      if (!remote) {
        setActiveDeviceId(null);
        setTransportError("No active device. Start playback in Spotify once, then press play here.");
        return;
      }

      setTransportError(null);
      if (remote.device?.name) setDeviceName(remote.device.name);
      if (typeof remote.device?.volume_percent === "number") setVolumeState(remote.device.volume_percent);

      // `/me/player` carries the active device: adopt it and drop any warning.
      if (remote.device?.id) {
        setActiveDeviceId(remote.device.id);
        deviceConfirmedRef.current = remote.device.id; // Spotify says it is live
        setDeviceNotice((prev) => (prev && prev.kind !== "transferred" ? null : prev));
      } else {
        setActiveDeviceId(null);
        deviceConfirmedRef.current = null;
      }
      if (remote.repeat_state) setRepeat(remote.repeat_state);
      if (typeof remote.shuffle_state === "boolean") setShuffle(remote.shuffle_state);

      const item = isRealTrack(remote.item) ? adaptTrack(remote.item) : null;

      // State lock: a manual action wins over a lagging poll. `authoritative`
      // is only ever passed by the reconciler, which has already compared the
      // remote state against the user's intent before deciding to apply it.
      const locked = !authoritative && Date.now() < optimisticUntil.current;
      const previous = liveTrackRef.current;
      const trackChanged = Boolean(item) && previous?.id !== item!.id;

      /**
       * v7.0.1 anti-interruption: while the Echoes Web Player is the active
       * device and audio is playing, the SDK is the only authority. A background
       * poll may merge metadata for the SAME track, but it may never switch the
       * track or pause it — only an explicit user action can.
       */
      // An explicit Pause wins over every SDK event until the user resumes.
      if (manualPauseRef.current) return;

      const ownsPlayback =
        !authoritative &&
        Boolean(webDeviceRef.current) &&
        activeDeviceRef.current === webDeviceRef.current &&
        clock.current.isPlaying;

      /**
       * QUEUE LOCK. Once Echoes is playing, remote state may update progress,
       * volume and device — but a *different* track is adopted only when it is
       * the track we explicitly commanded (within its confirmation window) or
       * when nothing is playing yet. Everything else is ignored outright, so
       * Spotify-side auto-advance or a stray event can never hijack the queue.
       */
      const currentId = liveTrackRef.current?.id ?? null;
      const expected = expectTrackRef.current;
      const expectsThis =
        Boolean(expected) &&
        item?.id === expected!.id &&
        Date.now() < expected!.until;
      const remoteWantsDifferentTrack = Boolean(item) && currentId !== null && item!.id !== currentId;
      const mayAdoptTrack =
        !currentId || item?.id === currentId || expectsThis || (authoritative && !remoteWantsDifferentTrack);

      /**
       * While a skip or play command is still in flight, a poll that reports a
       * *different* track is almost always the pre-command state arriving late.
       * Adopting it flipped the UI back to the old track and then forward again
       * — the "random song switching" symptom. Metadata for the SAME track is
       * still merged, so artwork and BPM keep improving.
       */
      const adoptTrack = item !== null && mayAdoptTrack;
      if (adoptTrack) {
        const known = featuresById.current.get(item.id);
        if (trackChanged && previous?.durationMs) {
          logListen(
            previous,
            clock.current.progressMs,
            clock.current.progressMs > previous.durationMs * 0.85,
            "spotify",
          );
        }
        if (expectsThis) expectTrackRef.current = null;
        setLiveTrack((prev) =>
          prev && prev.id === item.id
            ? mergeTrack(prev, { ...known, ...item })
            : known
              ? { ...known, ...item }
              : item,
        );

        // Keep the visible queue in step with whatever Spotify is actually playing.
        const at = queueRef.current.findIndex((t) => t.id === item.id);
        if (at >= 0 && at !== indexRef.current) {
          setIndex(at);
          loggedFor.current = null;
        }
        if (trackChanged) setProgress(remote.progress_ms ?? 0);
      } else if (!item && !locked) {
        setLiveTrack(null);
      }

      if (!locked && !(ownsPlayback && !remote.is_playing)) {
        /**
         * While a 503/401 is unresolved, a poll reporting "paused" is a symptom
         * of the same outage, not the truth about the listener's audio — the
         * local player may still be running. Adopt the remote state only when it
         * does not contradict us by pausing; anything else (a real track change,
         * resumed playback) is applied normally.
         */
        const wouldPause = !remote.is_playing && clock.current.isPlaying;
        if (!(transientFailureRef.current && wouldPause)) {
          setPlaying(Boolean(remote.is_playing));
          intentRef.current = { playing: null, at: 0, retries: intentRef.current.retries };
        }
        // A healthy poll clears the transient state, so reconciliation resumes.
        if (!wouldPause) transientFailureRef.current = false;
      }
      // Progress only ever follows the track we are actually showing.
      const sameTrack = !item || item.id === currentId;
      if (!scrubbingRef.current && !locked && sameTrack && remote.progress_ms !== null) {
        setProgress(remote.progress_ms ?? 0);
      }
      void ownsPlayback;
      void trackChanged;
    },
    [logListen, setPlaying, setProgress],
  );

  /**
   * Every transport call goes through here: `Authorization: Bearer` is always
   * attached, and a 401 triggers one token refresh + retry so a lapsed session
   * never masquerades as a device failure.
   */
  const transportFetch = useCallback(
    async <T,>(path: string, init?: RequestInit): Promise<T> => {
      // Always the live token: a rotation mid-session must not use a stale one.
      const current = tokenRef.current ?? token;
      if (!current) throw new Error("No Spotify session");
      try {
        return await spotifyFetch<T>(path, current, init);
      } catch (error) {
        const expired = error instanceof Error && error.message.includes("(401)");
        if (!expired) throw error;
        // (b) background token refresh via the server-side session mirror.
        const fresh = (await refreshSessionToken()) ?? (await auth.getAccessToken());
        if (!fresh || fresh === current) throw error;
        return spotifyFetch<T>(path, fresh, init);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [token, auth.getAccessToken],
  );

  const fetchState = useCallback(async (): Promise<SpPlayerState | null | "error"> => {
    if (modeRef.current !== "spotify" || !token) return null;
    try {
      return (await transportFetch<SpPlayerState | null>("/me/player")) ?? null;
    } catch (err) {
      setIsSyncing(false);
      // Silent: a failed background poll must not pause audio, clear the track,
      // or raise a banner. The next poll or a user command will tell the truth.
      pollFailedSilently(err);
      return "error";
    }
  }, [token, transportFetch]);

  const syncNow = useCallback(
    async (authoritative = false) => {
      const state = await fetchState();
      if (state === "error") return;
      applyRemote(state, authoritative);
    },
    [fetchState, applyRemote],
  );

  const clearReconcile = useCallback(() => {
    for (const id of reconcileTimers.current) window.clearTimeout(id);
    reconcileTimers.current = [];
  }, []);

  /**
   * Confirms the user's intent against Spotify instead of blindly adopting the
   * remote state. If a device is still spinning up we re-issue the command once
   * (the UI keeps showing what the user asked for) and only then accept defeat.
   * This is what removes the play/pause "ping-pong".
   */
  const reconcileIntent = useCallback(async () => {
    if (manualPauseRef.current) return; // never reconcile across a user pause
    const intent = intentRef.current;
    const state = await fetchState();
    if (state === "error") return;
    if (!state) {
      applyRemote(null, true);
      return;
    }
    if (intent.playing === null) {
      applyRemote(state, true);
      return;
    }
    if (Boolean(state.is_playing) === intent.playing) {
      applyRemote(state, true); // settled — Spotify agrees with the user
      return;
    }
    if (intent.retries < 1 && lastRunRef.current) {
      intentRef.current = { ...intent, retries: intent.retries + 1, at: Date.now() };
      optimisticUntil.current = Date.now() + RETRY_GRACE_MS;
      setIsBuffering(true);
      try {
        await lastRunRef.current();
      } catch {
        /* the next reconcile pass reports the truth */
      } finally {
        setIsBuffering(false);
      }
      clearReconcile();
      reconcileTimers.current = [
        window.setTimeout(() => void reconcileIntent(), RETRY_GRACE_MS + 250),
      ];
      return;
    }
    // Retry exhausted: show reality and explain why it differs.
    applyRemote(state, true);
    setTransportError(
      intent.playing
        ? "Spotify did not start playback — check the active device."
        : "Spotify did not pause — check the active device.",
    );
  }, [fetchState, applyRemote, clearReconcile]);

  useEffect(() => {
    if (mode !== "spotify" || !token) {
      setIsSyncing(false);
      return;
    }
    let alive = true;
    let timer = 0;
    setIsSyncing(true);

    const loop = async (authoritative = false) => {
      if (!alive) return;
      const c = clock.current;
      const inEndWindow = c.durationMs > 0 && c.durationMs - c.progressMs < 30_000;
      // No external polling inside the last 30 s, while manually paused, or
      // during the post-transition lock: the local queue owns completion.
      const skip = manualPauseRef.current || inEndWindow || Date.now() < transitionLockUntil.current;
      if (!skip) await syncNow(authoritative);
      if (!alive) return;
      // Rule 4 — no background loop while the SDK is the active device: it
      // pushes `player_state_changed` locally, so a poll would be pure quota.
      // Otherwise poll only while the tab is visible, and slowly.
      const onWebPlayer =
        Boolean(webDeviceRef.current) && activeDeviceRef.current === webDeviceRef.current;
      if (onWebPlayer) {
        timer = window.setTimeout(() => void loop(), 60000); // takeover detection only
        return;
      }
      if (typeof document !== "undefined" && document.visibilityState === "hidden") {
        timer = window.setTimeout(() => void loop(), 60000);
        return;
      }
      const delay = clock.current.isPlaying ? 10000 : activeDeviceRef.current ? 30000 : 8000;
      timer = window.setTimeout(() => void loop(), delay);
    };

    void loop(true); // first paint may adopt the remote state outright

    const onFocus = () => {
      window.clearTimeout(timer);
      void loop(); // never override a click that just happened
    };
    const onVisibility = () => {
      if (document.visibilityState === "visible") onFocus();
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      alive = false;
      window.clearTimeout(timer);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [mode, token, syncNow]);

  /**
   * Detail pass for the playing track: `GET /tracks/{id}?market=from_token`
   * plus the album/artist detail the server aggregates. This is what supplies
   * high-resolution cover art and BPM.
   *
   * The dependency is the **track id string only** — not the token, not the
   * track object. A token refresh, a progress tick, a play/pause toggle or a
   * poll returning the same track therefore triggers nothing, and a track we
   * have seen before is served from the 30-minute cache with zero requests.
   */
  const currentTrackId = liveTrack?.id ?? null;
  const lastDetailIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (!currentTrackId) return;
    // Change guard: the same id can never trigger a second request, no matter
    // how many polls or re-renders deliver it.
    if (lastDetailIdRef.current === currentTrackId) return;

    /**
     * Rule 1 — the player payload already carries `item.name`,
     * `item.album.images` (every resolution) and `item.artists`, and BPM/key
     * arrive with the library load. So a detail request is only worth making
     * when artwork is genuinely absent. In practice that is never, which is
     * what removes the per-track `/tracks/{id}` + `/albums/{id}` + `/artists/{id}`
     * fan-out during playback.
     */
    const known = featuresById.current.get(currentTrackId);
    const have = liveTrackRef.current;
    const hasArtwork = Boolean(have?.imageLargeUrl ?? have?.imageUrl ?? known?.imageLargeUrl ?? known?.imageUrl);
    const hasCredits = Boolean(have?.artistList?.length || have?.artist);
    if (hasArtwork && hasCredits) {
      lastDetailIdRef.current = currentTrackId;
      // Fold in any library-known extras (BPM, key) without a request.
      if (known) setLiveTrack((prev) => (prev && prev.id === currentTrackId ? mergeTrack(prev, known) : prev));
      return;
    }
    lastDetailIdRef.current = currentTrackId;

    // Settled already (resolved or failed): paint from cache, fetch nothing.
    const cached = trackDetailCache.get(currentTrackId);
    if (cached) {
      setLiveTrack((prev) => (prev && prev.id === currentTrackId ? mergeTrack(prev, cached) : prev));
      return;
    }
    if (trackDetailCache.isSettled(currentTrackId)) return;
    // Demo mode has no Spotify ids to resolve; `mode` (not the token) is the
    // only other thing that can legitimately re-arm this effect.
    if (mode !== "spotify") return;

    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 10_000);
    let alive = true;

    void loadTrackDetail(currentTrackId, tokenRef.current, controller.signal).then((detail) => {
      window.clearTimeout(timeout);
      if (!alive || !detail) return;
      setLiveTrack((prev) =>
        prev && prev.id === currentTrackId ? mergeTrack(prev, detail) : prev,
      );
    });

    return () => {
      alive = false;
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [currentTrackId, mode]);

  /**
   * Right after the SDK handshake completes, claim the Web Player as the active
   * device with `PUT /v1/me/player {device_ids:[window.spotifyDeviceId], play:false}`.
   * Skipped when another device is genuinely playing, so opening Echoes never
   * interrupts a listener's phone or desktop session.
   */
  const transferredFor = useRef<string | null>(null);
  useEffect(() => {
    if (mode !== "spotify" || !token || !web.connected || !web.deviceId) return;
    if (transferredFor.current === web.deviceId) return;
    transferredFor.current = web.deviceId;

    let alive = true;
    void (async () => {
      const state = await fetchState();
      if (!alive) return;
      const busyElsewhere =
        state &&
        state !== "error" &&
        state.is_playing &&
        Boolean(state.device?.id) &&
        state.device?.id !== web.deviceId;
      if (busyElsewhere) return;

      const result = await transferPlayback(token, web.deviceId!, false);
      if (!alive) return;
      if (result.ok) {
        setActiveDeviceId(web.deviceId);
        deviceConfirmedRef.current = web.deviceId;
        setDeviceName("Echoes · this browser");
      } else {
        console.info("[echoes] initial transfer skipped:", result.message);
      }
    })();

    return () => {
      alive = false;
    };
  }, [mode, token, web.connected, web.deviceId, fetchState]);

  /** First paint before the first poll resolves: use the library's snapshot. */
  useEffect(() => {
    if (mode !== "spotify" || !playerSnapshot || lastSyncAt.current !== 0) return;
    if (Date.now() - playerSnapshot.takenAt > 90_000) return;
    if (playerSnapshot.deviceName) setDeviceName(playerSnapshot.deviceName);
    const known = playerSnapshot.currentTrackId
      ? featuresById.current.get(playerSnapshot.currentTrackId)
      : null;
    if (known) {
      setLiveTrack(known);
      setProgress(playerSnapshot.progressMs);
      setPlaying(playerSnapshot.isPlaying);
    }
  }, [playerSnapshot, mode, setPlaying, setProgress]);

  /* ------------------------------ transport -------------------------------- */
  const command = useCallback(
    async (
      run: () => Promise<unknown>,
      intent?: { playing: boolean },
      options?: { background?: boolean },
    ) => {
      clearReconcile(); // a newer action always supersedes older reconciliations
      optimisticUntil.current = Date.now() + OPTIMISTIC_WINDOW_MS;
      lastRunRef.current = run;
      if (intent) intentRef.current = { playing: intent.playing, at: Date.now(), retries: 0 };
      const background = Boolean(options?.background);
      setIsBuffering(!background);

      const attempt = async (): Promise<void> => {
        try {
          await run();
          transientFailureRef.current = false;
          if (!background) setTransportError(null);
        } catch (err) {
          const message = err instanceof Error ? err.message : "Playback command failed";
          const kind = (err as Error & { kind?: string })?.kind;
          const transient =
            kind === "token" ||
            message.includes("(401)") ||
            message.includes("(503)") ||
            kind === "rate";

          // (a)+(b)+(c) A transient failure at a track transition is caught
          // silently: audio keeps playing, the active track is kept, the token
          // is refreshed in the background and the command is retried once.
          if (transient && !retriedRef.current) {
            retriedRef.current = true;
            transientFailureRef.current = true;
            const fresh = await refreshSessionToken();
            if (fresh) tokenRef.current = fresh;
            await new Promise((resolve) => setTimeout(resolve, 500));
            try {
              await run();
              transientFailureRef.current = false;
              retriedRef.current = false;
              if (!background) setTransportError(null);
              return;
            } catch {
              /* fall through to the visible failure path */
            }
          }
          retriedRef.current = false;

          // 503 is intercepted silently: no banner, no console error, and the
          // active queue index is left exactly where it was.
          if (message.includes("(503)") || kind === "rate") {
            transientFailureRef.current = true;
            console.info("[echoes] playback request deferred (503):", message);
            return;
          }

          if (background) {
            // Auto-advance and other automated work never surfaces an error,
            // never pauses local audio and never clears the active track.
            transientFailureRef.current = true;
            console.info("[echoes] background playback command skipped:", message);
            return;
          }

          intentRef.current = { playing: null, at: 0, retries: 0 };
          setTransportError(message);
          // 404 → no device, 403 → Premium/restricted. Recover with guidance
          // rather than leaving the transport stuck on a spinner.
          if (kind === "no-device" || message.includes("(404)")) {
            setActiveDeviceId(null);
            deviceConfirmedRef.current = null;
            setDeviceNotice(NO_DEVICE_NOTICE);
          } else if (kind === "premium" || message.includes("(403)")) {
            setActiveDeviceId(null);
            setDeviceNotice({
              kind: "premium",
              title: "Spotify refused that command",
              detail:
                "Playback control needs Spotify Premium and a device that allows remote control.",
              showDevices: true,
            });
          }
        } finally {
          setIsBuffering(false);
        }
      };

      await attempt();

      // Soft sync inside the lock (metadata only), then confirm the intent.
      // Skipped after a transient failure: there is no truth to reconcile with
      // yet, and adopting it would pause a track that is still playing.
      if (!transientFailureRef.current) {
        reconcileTimers.current = [
          window.setTimeout(() => void syncNow(), 700),
          window.setTimeout(() => void reconcileIntent(), OPTIMISTIC_WINDOW_MS + 300),
        ];
      } else {
        reconcileTimers.current = [
          window.setTimeout(() => void syncNow(), 4000),
        ];
      }
    },
    [syncNow, reconcileIntent, clearReconcile, refreshSessionToken],
  );

  /** Transport calls return results rather than throwing; normalise for `command`. */
  const assertOk = (result: TransportResult): void => {
    if (result.ok) return;
    const error = new Error(`${guidanceFor(result) ?? result.message} (${result.status})`) as Error & {
      kind?: string;
    };
    error.kind = result.kind;
    throw error;
  };

  /* ------------------------ device discovery + transfer -------------------- */

  const flashNotice = useCallback((notice: DeviceNotice | null, ttl = 4200) => {
    if (noticeTimer.current) window.clearTimeout(noticeTimer.current);
    setDeviceNotice(notice);
    if (notice && ttl > 0) {
      noticeTimer.current = window.setTimeout(() => setDeviceNotice(null), ttl);
    }
  }, []);

  const listDevices = useCallback(async (): Promise<SpDevice[]> => {
    // Direct from the browser first — no server hop in the playback path.
    try {
      const data = await transportFetch<SpDevicesResponse>("/me/player/devices");
      const list = data?.devices ?? [];
      setDevices(list);
      return list;
    } catch (error) {
      console.info("[echoes] direct device list failed", error instanceof Error ? error.message : error);
    }
    // Fall back to the proxy, which can refresh an expired token server-side.
    try {
      const res = await fetch("/api/spotify/devices", {
        headers: token ? { authorization: `Bearer ${token}` } : undefined,
        cache: "no-store",
        // Never let a slow proxy stall the play path.
        signal: AbortSignal.timeout(4000),
      });
      adoptTokenHeaders(res);
      if (res.ok) {
        const data = await safeJson<{ devices?: SpDevice[] }>(res);
        const list = data?.devices ?? [];
        setDevices(list);
        return list;
      }
    } catch {
      /* offline */
    }
    return [];
  }, [token, transportFetch]);

  const transferTo = useCallback(
    async (deviceId: string, play = false): Promise<boolean> => {
      if (!token) return false;
      // PUT https://api.spotify.com/v1/me/player { device_ids: [id], play }
      const result = await transferPlayback(token, deviceId, play);
      if (result.ok) return true;
      console.info("[echoes] transfer failed", result.message);
      return false;
    },
    [token],
  );

  /**
   * `GET /v1/me/player/devices` before any play command.
   *
   * Fast path: `/me/player` already reported an active device id, so there is no
   * extra round trip. Otherwise pick the best controllable device, transfer
   * playback to it, and only then let the command through. Returns false — with
   * a friendly notice — when there is nothing to play on.
   */
  const ensureDevice = useCallback(async (): Promise<string | null> => {
    if (modeRef.current !== "spotify") return null;

    // 1 — a device already reported active (by the SDK or by /me/player), which
    //     also preserves an explicit transfer the listener made by hand.
    if (activeDeviceRef.current) return activeDeviceRef.current;

    // 2 — the Web Playback SDK device for this tab. No play command is allowed
    //     until `ready` has fired with a device_id *and* `connect()` resolved;
    //     firing earlier is what produces the DRM/EME 503s on a track change.
    const sdk = readSdkDeviceId();
    if (sdk && sdkConnectedRef.current) {
      setActiveDeviceId(sdk);
      setDeviceName("Echoes · this browser");
      flashNotice(null);
      return sdk;
    }
    if (resolvingDevice.current) return null;

    // 3 — discover, then transfer playback onto the best candidate.
    resolvingDevice.current = true;
    setIsResolvingDevice(true);
    try {
      const list = await listDevices();

      if (!list.length) {
        setActiveDeviceId(null);
        flashNotice(NO_DEVICE_NOTICE, 0);
        return null;
      }

      const chosen = pickDevice(list);
      if (!chosen?.id) {
        flashNotice(
          {
            kind: "restricted",
            title: "Those devices can't be controlled",
            detail:
              "Spotify reports every available device as restricted. Open the Spotify app and play a track once, then try again.",
            showDevices: true,
          },
          0,
        );
        return null;
      }

      if (chosen.is_active) {
        setActiveDeviceId(chosen.id);
        setDeviceName(chosen.name);
        flashNotice(null);
        return chosen.id;
      }

      flashNotice(
        { kind: "busy", title: `Waking ${chosen.name}`, detail: "Transferring playback to your device…" },
        0,
      );
      const transferred = await transferTo(chosen.id, false);
      if (transferred) {
        setActiveDeviceId(chosen.id);
        setDeviceName(chosen.name);
        flashNotice({
          kind: "transferred",
          title: `Transferred to ${chosen.name}`,
          detail: describeDevice(chosen),
        });
        // Give the device a beat to accept commands after a transfer.
        await new Promise((resolve) => setTimeout(resolve, 500));
        return chosen.id;
      }

      flashNotice(NO_DEVICE_NOTICE, 0);
      return null;
    } finally {
      resolvingDevice.current = false;
      setIsResolvingDevice(false);
    }
  }, [listDevices, transferTo, flashNotice]);

  const retryDevices = useCallback(() => {
    setActiveDeviceId(null);
    flashNotice(null);
    void ensureDevice().then((deviceId) => {
      if (deviceId && clock.current.isPlaying) void syncNow(true);
    });
  }, [ensureDevice, flashNotice, syncNow]);

  const transferToDevice = useCallback(
    (deviceId: string) => {
      const device = devices.find((d) => d.id === deviceId);
      void transferTo(deviceId, clock.current.isPlaying).then((ok) => {
        if (!ok) {
          flashNotice(NO_DEVICE_NOTICE, 0);
          return;
        }
        setActiveDeviceId(deviceId);
        if (device) setDeviceName(device.name);
        flashNotice({
          kind: "transferred",
          title: `Transferred to ${device?.name ?? "your device"}`,
          detail: device ? describeDevice(device) : "Playback moved.",
        });
        window.setTimeout(() => void syncNow(true), 800);
      });
    },
    [devices, transferTo, flashNotice, syncNow],
  );

  const dismissDeviceNotice = useCallback(() => flashNotice(null), [flashNotice]);

  /**
   * `player.activateElement()` — unlocks audio and initialises the EME/DRM
   * pipeline (PlayReady/Widevine). It only works inside a user gesture, so call
   * this *before* awaiting anything in a click handler.
   */
  const activateAudio = useCallback((): Promise<boolean> => {
    const instance = sdkPlayerRef.current;
    if (!instance) return Promise.resolve(false);
    try {
      return instance.activateElement().then(
        () => true,
        () => false,
      );
    } catch {
      return Promise.resolve(false);
    }
  }, []);

  /** Recovery passed to the transport: re-activate, then let it transfer+retry. */
  const recoveryFor = useCallback(
    (activation: Promise<boolean>) => ({
      recover: async () => {
        await activation;
        await activateAudio();
      },
    }),
    [activateAudio],
  );

  /**
   * One-shot global unlock: the first click or keypress anywhere spends the
   * gesture on `activateElement()`, so the DRM/MediaKey context is warm before
   * the listener ever reaches a play button.
   */
  useEffect(() => {
    if (mode !== "spotify" || !web.connected) return;
    let spent = false;
    const onGesture = () => {
      if (spent) return;
      spent = true;
      void activateAudio();
    };
    document.addEventListener("pointerdown", onGesture);
    document.addEventListener("keydown", onGesture);
    return () => {
      document.removeEventListener("pointerdown", onGesture);
      document.removeEventListener("keydown", onGesture);
    };
  }, [mode, web.connected, activateAudio]);

  /**
   * The next three tracks, computed with the same pure rules that drive
   * auto-advance — so the panel can never promise a different queue than the
   * player will actually play.
   */
  const [playSource, setPlaySource] = useState<PlaySource>("queue");
  const upNextIsSequential =
    (ORDERED_SOURCES as readonly string[]).includes(playSource) &&
    index >= 0 &&
    index + 1 < queue.length;

  const upNext = useMemo<EchoTrack[]>(() => {
    if (!current) return [];
    if (upNextIsSequential) return queue.slice(index + 1, index + 4);

    const played = new Set([...playedIdsRef.current, ...recentAutoPlay.current]);
    for (const track of readRecent()) played.add(track.id);
    return decideNextTracks(
      {
        queue,
        index,
        source: playSource,
        playlists: catalog.playlists,
        catalogTracks: catalog.tracks,
        savedTracks: catalog.tracks.filter((track) => savedIds.has(track.id)),
        playedIds: played,
        playlistTracks: playlistTracksRef.current,
      },
      3,
    );
  }, [
    current,
    upNextIsSequential,
    queue,
    index,
    playSource,
    catalog.playlists,
    catalog.tracks,
    savedIds,
  ]);

  /** `?device_id=` for every playback PUT: known-active device, else the SDK. */
  const targetDevice = useCallback(
    () => activeDeviceRef.current ?? readSdkDeviceId(),
    [],
  );

  /**
   * "Always transfer playback first if needed": when the device we are about to
   * command has not been confirmed active by Spotify, attach it with
   * `PUT /v1/me/player {device_ids:[window.spotifyDeviceId], play:false}` and
   * give it a beat before the play request. Confirmed devices skip this, so
   * ordinary track switching stays instant.
   */
  const transferIfNeeded = useCallback(
    async (deviceId: string) => {
      if (!token || deviceConfirmedRef.current === deviceId) return;
      const result = await transferPlayback(token, deviceId, false);
      if (result.ok) {
        deviceConfirmedRef.current = deviceId;
        setActiveDeviceId(deviceId);
        await new Promise((resolve) => setTimeout(resolve, 300));
      } else {
        console.info("[echoes] pre-flight transfer failed:", result.message);
      }
    },
    [token],
  );

  /**
   * The one track-switching sequence, in order:
   *   1. `activateElement()` was already invoked synchronously in the click
   *      handler — its promise arrives as `activation`;
   *   2. resolve a device (SDK handshake gate → confirmed active → discovery);
   *   3. transfer onto it first when it is not confirmed;
   *   4. await the DRM/audio unlock;
   *   5. `PUT /me/player/play?device_id=…` with `uris` XOR `context_uri`;
   *   6. on 503 the transport re-activates, waits 400 ms and retries once.
   */
  const startPlayback = useCallback(
    async (request: {
      activation: Promise<boolean>;
      single?: EchoTrack;
      tracks?: EchoTrack[];
      index?: number;
      contextUri?: string | null;
      source?: PlaySource;
    }) => {
      if (mode !== "spotify" || !token) return;

      const deviceId = await ensureDevice();
      if (!deviceId) {
        setPlaying(false); // nothing to play on — revert the optimistic flip
        return;
      }
      await transferIfNeeded(deviceId);
      await request.activation;

      if (request.source) {
        playSourceRef.current = request.source;
        setPlaySource(request.source);
      }
      // Block a duplicate play call for the track we are already committing.
      if (transitionRef.current.active && transitionRef.current.id === request.single?.id) return;
      // A different track supersedes an in-flight transition.
      transitionRef.current = { active: true, id: request.single?.id ?? null };
      setTransitioning(true);
      // An explicit play/resume-of-a-new-track clears the pause lock and opens a
      // 3 s window in which nothing else may move the queue.
      manualPauseRef.current = false;
      endedForRef.current = null;
      genForRef.current = null; // fresh sequence may prefetch again
      transitionLockUntil.current = Date.now() + 3000;

      // (a) UI state is committed above (title, artwork, progress 0:00, active
      // id). (b) Only after that commit do we issue ONE play request. The
      // commit is generation-guarded and any orphaned commit timer from a
      // previous track is cleared here, so a stale callback can never fire
      // mid-song and re-play an old track.
      clearReconcile();
      const gen = ++transitionGenRef.current;
      if (commitTimeoutRef.current !== null) window.clearTimeout(commitTimeoutRef.current);
      commitTimeoutRef.current = window.setTimeout(() => {
        commitTimeoutRef.current = null;
        if (gen !== transitionGenRef.current) return; // superseded by a newer track
        void command(
          async () => {
          // One dispatcher decides the payload: context+offset inside a
          // playlist/album, a single URI for a standalone click, a sliced URI
          // queue for bulk actions. Never a mix of context_uri and uris.
          assertOk(
            await executePlay(
              tokenRef.current ?? token,
              deviceId,
              {
                single: request.single
                  ? { id: request.single.id, uri: request.single.uri }
                  : null,
                tracks: request.tracks?.map((t) => ({ id: t.id, uri: t.uri })),
                index: request.index ?? 0,
                contextUri: request.contextUri ?? null,
                source: request.source,
              },
              recoveryFor(request.activation),
            ),
          );
          },
          { playing: true },
          { background: backgroundPlaybackRef.current },
        ).then(() => {
          if (gen !== transitionGenRef.current) return;
          transitionRef.current = { active: false, id: null };
          setTransitioning(false);
        });
      }, 0);
    },
    [mode, token, command, ensureDevice, transferIfNeeded, recoveryFor, setPlaying, clearReconcile],
  );

  const playQueue = useCallback(
    (
      tracks: EchoTrack[],
      startIndex = 0,
      options?: { contextUri?: string | null; source?: PlaySource },
    ) => {
      if (!tracks.length) return;
      const at = Math.min(Math.max(startIndex, 0), tracks.length - 1);
      setQueue(tracks);
      setIndex(at);
      setProgress(0);
      loggedFor.current = null;
      autoAdvancedFor.current = null;

      const first = tracks[at];
      expectTrackRef.current = { id: first.id, until: Date.now() + 4000 };
      // Instant UI in both modes.
      setLiveTrack(first);
      setPlaying(true);
      setTransportError(null);

      if (mode === "spotify" && token) {
        // Spend the click immediately: this is the only point at which the
        // browser still counts us as a user gesture for audio/EME activation.
        const activation = activateAudio();
        void startPlayback({
          activation,
          tracks,
          index: at,
          contextUri: options?.contextUri ?? null,
          source: options?.source,
        });
      }
    },
    [mode, token, startPlayback, activateAudio, setPlaying, setProgress],
  );

  /**
   * The universal play handler used by every clickable track in the app.
   *
   * It owns the optimistic UI (queue, index, artwork, transport state) and then
   * hands the decision about the payload shape to `startPlayback`:
   * context+offset inside a playlist/album, a single URI everywhere else.
   */
  const playFrom = useCallback(
    (request: PlayRequest) => {
      const track = request.track;
      if (!track) return;

      const list = request.tracks?.length ? request.tracks : [track];
      const found = list.findIndex((t) => t.id === track.id);
      const at = Math.max(0, request.index ?? (found >= 0 ? found : 0));

      setQueue(list);
      setIndex(at);
      setProgress(0);
      loggedFor.current = null;
      setLiveTrack(track);
      setPlaying(true);
      setTransportError(null);
      autoAdvancedFor.current = null;

      if (mode !== "spotify" || !token) return;

      // Invoked synchronously: the browser still counts this as the gesture.
      const activation = activateAudio();
      void startPlayback({
        activation,
        single: track,
        index: at,
        contextUri: request.contextUri ?? null,
        source: request.source,
      });
    },
    [mode, token, startPlayback, activateAudio, setPlaying, setProgress],
  );

  /**
   * Individual track → `PUT /v1/me/player/play?device_id=<window.spotifyDeviceId>`
   * with a body of strictly `{ uris: ["spotify:track:<id>"], position_ms: 0 }`.
   */
  const playTrack = useCallback((track: EchoTrack) => playFrom({ track }), [playFrom]);

  /**
   * Continuous play. When a queue runs out — typically a standalone track fired
   * from Home, search or the listening log — pick what should come next:
   * the rest of the queue first, then the closest match in the catalog by
   * artist, album, genre, tempo and energy, with a little variety on ties.
   */
  /**
   * Deterministic continuation (v7.0.1).
   *
   * Playlist / Saved / album / artist starts play the exact next track in that
   * list and nothing overrides it. Once a list runs out — and immediately for
   * history or search starts — the next track is recommended from the user's
   * longest playlist, preferring tracks not yet played in Echoes, then Saved,
   * then anything in the library.
   */
  const pickNextTrack = useCallback((): EchoTrack | null => {
    const savedTracks = catalog.tracks.filter((track) => savedIds.has(track.id));
    const played = new Set([...playedIdsRef.current, ...recentAutoPlay.current]);
    for (const track of readRecent()) played.add(track.id);

    const decision = decideNextTrack({
      queue: queueRef.current,
      index: indexRef.current,
      source: playSourceRef.current,
      playlists: catalog.playlists,
      catalogTracks: catalog.tracks,
      savedTracks,
      playedIds: played,
      playlistTracks: playlistTracksRef.current,
    });

    if (decision.track) {
      recentAutoPlay.current = [...recentAutoPlay.current, decision.track.id].slice(-24);
      console.info(`[echoes] continuing after ${playSourceRef.current}: ${decision.reason}`);
    } else {
      console.info("[echoes] queue exhausted:", decision.reason);
    }
    return decision.track;
  }, [catalog.tracks, catalog.playlists, savedIds]);

  /**
   * Builds a batch of similar tracks from data Echoes already holds; only when
   * the cached pool is thin does it ask Spotify's search endpoint (silently).
   * Runs in the background and never touches the current track or index.
   */
  const generateAutoplayBatch = useCallback(
    async (count = 5): Promise<EchoTrack[]> => {
      const currentTrack = liveTrackRef.current;
      const seeds = currentTrack ? [...seedsRef.current, currentTrack] : seedsRef.current;
      if (!seeds.length) return [];
      const exclude = new Set<string>([
        ...playedIdsRef.current,
        ...queueRef.current.map((t) => t.id),
      ]);
      const primaryArtistId = currentTrack?.artistIds?.[0] ?? null;
      const pool = collectPool({
        catalog: catalog.tracks,
        playlistTracks: playlistTracksRef.current,
        artistPages: [primaryArtistId ? peekArtist(primaryArtistId)?.popularTracks : undefined],
      });
      let picks = rankRecommendations(seeds, pool, exclude, count);

      if (picks.length < 3 && modeRef.current === "spotify" && tokenRef.current) {
        try {
          const artistName = (currentTrack?.artist ?? "").split(",")[0].trim();
          const res = await spotifyFetch<{ tracks?: { items?: SpTrack[] } }>(
            `/search?q=${encodeURIComponent(`artist:"${artistName}"`)}&type=track&limit=10&market=from_token`,
            tokenRef.current,
          );
          const found = (res.tracks?.items ?? [])
            .filter(isRealTrack)
            .map((t) => adaptTrack(t))
            .filter((t) => !exclude.has(t.id));
          picks = [
            ...picks,
            ...rankRecommendations(seeds, found, exclude, count - picks.length),
          ];
        } catch (error) {
          console.info("[echoes] autoplay search skipped:", error instanceof Error ? error.message : error);
        }
      }
      return picks.slice(0, count).map((t) => ({ ...t, auto: true }));
    },
    [catalog.tracks],
  );

  /**
   * Prefetch trigger, evaluated on each clock tick: starts generating the next
   * batch while the current track still has ~45 s left, so recommendations are
   * already queued before the track ends (no gap, no 503 collision). Guarded so
   * it runs at most once per track.
   */
  const maybeAutoplay = useCallback(() => {
    if (!autoplayRef.current) return;
    if (manualPauseRef.current || transitionRef.current.active) return;
    if (fetchingAutoplayRef.current) return; // one fetch per queue-end sequence
    const c = clock.current;
    if (!c.isPlaying || !c.durationMs) return;

    // Trigger when the queue is down to its last track(s), or when the final
    // track is within 30 s of finishing — early enough to append seamlessly.
    const tail = queueRef.current.length - indexRef.current - 1;
    if (!shouldPrefetchAutoplay({ tailRemaining: tail, remainingMs: c.durationMs - c.progressMs })) return;

    const curId = liveTrackRef.current?.id ?? null;
    if (!curId || genForRef.current === curId) return;
    genForRef.current = curId;
    fetchingAutoplayRef.current = true;
    setAutoplayFetching(true);
    void generateAutoplayBatch(5)
      .then((batch) => {
        if (!batch.length) return;
        setQueue((q) => {
          const have = new Set(q.map((t) => t.id));
          const add = batch.filter((t) => !have.has(t.id));
          return add.length ? [...q, ...add] : q;
        });
      })
      .catch(() => undefined)
      .finally(() => {
        fetchingAutoplayRef.current = false;
        setAutoplayFetching(false);
      });
  }, [generateAutoplayBatch]);

  useEffect(() => {
    maybeAutoplayRef.current = maybeAutoplay;
  }, [maybeAutoplay]);

  const autoAdvance = useCallback(() => {
    const finished = liveTrackRef.current ?? queueRef.current[indexRef.current] ?? null;
    if (finished) autoAdvancedFor.current = finished.id;

    // Anything already queued — the list we started from, or recommendations
    // Autoplay appended — plays next, in order. Nothing external injects here.
    const queued = queueRef.current;
    const at = indexRef.current;
    if (at >= 0 && at + 1 < queued.length) {
      const nextInList = queued[at + 1];
      emitTrackFinished({ track: finished ?? nextInList, next: nextInList, at: Date.now() });
      loggedFor.current = null;
      backgroundPlaybackRef.current = true;
      playFrom({
        track: nextInList,
        tracks: queued,
        index: at + 1,
        source: playSourceRef.current,
      });
      backgroundPlaybackRef.current = false;
      return;
    }

    // End of everything queued: the Autoplay toggle decides whether to continue.
    if (!autoplayRef.current) {
      emitTrackFinished({ track: finished ?? null, next: null, at: Date.now() });
      setPlaying(false);
      return;
    }

    const next = pickNextTrack();
    emitTrackFinished({ track: finished ?? next, next, at: Date.now() });
    if (!next) {
      setPlaying(false);
      return;
    }
    const queue = queueRef.current;
    loggedFor.current = null;
    // Grow the queue so "up next" and skip-back keep making sense.
    backgroundPlaybackRef.current = true;
    playFrom({ track: next, tracks: [...queue, next], index: queue.length });
    backgroundPlaybackRef.current = false;
  }, [pickNextTrack, playFrom, setPlaying]);

  useEffect(() => {
    autoAdvanceRef.current = autoAdvance;
  }, [autoAdvance]);

  /**
   * The one and only path from "track finished" to "play the next one".
   * Fires once per track and locks out competing triggers for 3 s.
   */
  const handleTrackEnded = useCallback(() => {
    const id = liveTrackRef.current?.id ?? null;
    if (!id) return;
    if (transitionRef.current.active) return; // mid-transition: ignore stray ends
    if (manualPauseRef.current) return;
    if (Date.now() < transitionLockUntil.current) return;
    if (endedForRef.current === id) return;
    endedForRef.current = id;
    transitionLockUntil.current = Date.now() + 3000;
    autoAdvanceRef.current();
  }, []);

  useEffect(() => {
    handleTrackEndedRef.current = handleTrackEnded;
  }, [handleTrackEnded]);

  /**
   * Progress-based continuation, only when Echoes is controlling *another*
   * device: a standalone `uris` play leaves nothing queued there and no SDK
   * event will report the end.
   *
   * When the Web Playback SDK is the active device this is skipped entirely —
   * the SDK continues playback natively and reports the natural end above, so a
   * timer here could only hijack it with an unrelated recommendation.
   */
  const step = useCallback(
    (delta: number) => {
      const q = queueRef.current;
      const i = indexRef.current;

      if (mode === "demo") {
        if (delta < 0 && clock.current.progressMs > 3000) {
          setProgress(0);
          return;
        }
        const target = i + delta;
        if (target < 0) {
          setProgress(0);
          return;
        }
        if (target >= q.length) {
          if (repeat === "context") {
            setIndex(0);
            setProgress(0);
          }
          return;
        }
        setIndex(target);
        setProgress(0);
        loggedFor.current = null;
        return;
      }

      // Optimistic skip: show the neighbouring queue entry immediately.
      const target = i + delta;
      const predicted = q[target];
      if (delta < 0 && clock.current.progressMs > 3000 && !predicted) {
        setProgress(0);
      } else if (predicted) {
        setIndex(target);
        setLiveTrack(predicted);
        setProgress(0);
        expectTrackRef.current = { id: predicted.id, until: Date.now() + 4000 };
      }

      if (token) {
        const activation = activateAudio(); // inside the gesture
        void (async () => {
          const deviceId = await ensureDevice();
          if (!deviceId) return;
          await activation; // unlock audio/EME before touching the API
          await command(async () => {
            const recovery = recoveryFor(activation);
            const result =
              delta > 0
                ? await nextTrack(token, deviceId, recovery)
                : await previousTrack(token, deviceId, recovery);
            assertOk(result);
          });
        })();
      }
    },
    [mode, repeat, token, command, ensureDevice, activateAudio, recoveryFor, setProgress],
  );

  const toggle = useCallback(() => {
    const target = !clock.current.isPlaying;
    // Lock immediately so incoming SDK events cannot undo an explicit pause,
    // and clear it only on an explicit resume.
    manualPauseRef.current = !target;
    if (!target) clearReconcile(); // nothing may reconcile an explicit pause
    setPlaying(target); // instant
    optimisticUntil.current = Date.now() + OPTIMISTIC_WINDOW_MS;

    if (mode === "spotify" && token) {
      if (!liveTrackRef.current && queueRef.current.length) {
        playQueue(queueRef.current, 0);
        return;
      }
      const activation = activateAudio(); // inside the gesture
      void (async () => {
        const deviceId = await ensureDevice();
        if (target && !deviceId) {
          setPlaying(false); // nothing to play on — revert the optimistic flip
          return;
        }
        await activation; // unlock audio/EME before touching the API
        await command(
          async () => {
            const recovery = recoveryFor(activation);
            const result = target
              ? await resumeTransport(token, deviceId, recovery)
              : await pauseTransport(token, deviceId, recovery);
            assertOk(result);
          },
          { playing: target },
        );
      })();
      return;
    }

    if (!current && queueRef.current.length) {
      setIndex(0);
      setProgress(0);
      setPlaying(true);
    }
  }, [mode, token, command, current, playQueue, ensureDevice, activateAudio, recoveryFor, setPlaying, setProgress, clearReconcile]);

  const clampPosition = useCallback(
    (ms: number) => Math.max(0, Math.min(ms, clock.current.durationMs || ms)),
    [],
  );

  /** Local only: the handle follows the pointer, Spotify hears nothing. */
  const scrubTo = useCallback(
    (ms: number) => {
      const clamped = clampPosition(ms);
      setProgress(clamped);
      seekCommit.stage(clamped);
    },
    [clampPosition, setProgress, seekCommit],
  );

  /** Debounced seek: instant locally, at most one request per burst. */
  const seek = useCallback(
    (ms: number) => {
      const clamped = clampPosition(ms);
      setProgress(clamped);
      seekCommit.schedule(clamped);
    },
    [clampPosition, setProgress, seekCommit],
  );

  /** One request for the whole drag. */
  const flushSeek = useCallback(() => seekCommit.flush(), [seekCommit]);

  const nudge = useCallback(
    (deltaMs: number) => seek(Math.max(0, clock.current.progressMs + deltaMs)),
    [seek],
  );

  /** While the user drags the bar, the clock and polls must not move it. */
  const beginScrub = useCallback(() => {
    scrubbingRef.current = true;
    optimisticUntil.current = Date.now() + OPTIMISTIC_WINDOW_MS;
  }, []);

  /** Release: commit exactly once, then let the poll re-sync the truth. */
  const endScrub = useCallback(() => {
    scrubbingRef.current = false;
    seekCommit.flush(); // the single PUT /v1/me/player/seek for this drag
    optimisticUntil.current = Date.now() + 900;
    window.setTimeout(() => void syncNow(), 950);
  }, [seekCommit, syncNow]);

  useEffect(() => clearReconcile, [clearReconcile]);

  useEffect(
    () => () => {
      if (noticeTimer.current) window.clearTimeout(noticeTimer.current);
    },
    [],
  );

  const setVolume = useCallback(
    (v: number) => {
      const clamped = Math.max(0, Math.min(100, Math.round(v)));
      setVolumeState(clamped); // instant locally
      persistVolume(clamped); // localStorage now, Postgres debounced
      // Dragging the volume slider stages one commit; taps debounce.
      if (scrubbingRef.current) volumeCommit.stage(clamped);
      else volumeCommit.schedule(clamped);
    },
    [persistVolume, volumeCommit],
  );

  const commitVolume = useCallback(() => volumeCommit.flush(), [volumeCommit]);

  const toggleShuffle = useCallback(() => {
    const value = !shuffle;
    setShuffle(value); // instant
    if (mode === "spotify" && token) {
      void setShuffleState(token, targetDevice(), value).then((result) => {
        if (!result.ok) setShuffle(!value);
      });
      return;
    }
    if (queue.length > 1) {
      setQueue((q) => {
        const head = indexRef.current >= 0 ? [q[indexRef.current]] : [];
        const rest = q.filter((_, i) => i !== indexRef.current);
        return [...head, ...(value ? [...rest].sort(() => Math.random() - 0.5) : rest)];
      });
      setIndex(0);
    }
  }, [shuffle, mode, token, queue.length, targetDevice]);

  const cycleRepeat = useCallback(() => {
    const value: RepeatMode = repeat === "off" ? "context" : repeat === "context" ? "track" : "off";
    setRepeat(value); // instant
    if (mode === "spotify" && token) {
      void setRepeatState(token, targetDevice(), value).then((result) => {
        if (!result.ok) setRepeat(repeat);
      });
    }
  }, [repeat, mode, token, targetDevice]);

  useEffect(() => {
    if (mode === "spotify") return;
    setVolumeState(prefs.volume);
  }, [prefs.volume, mode]);

  const value = useMemo<PlayerContextValue>(
    () => ({
      queue,
      current,
      index,
      isPlaying,
      shuffle,
      repeat,
      volume,
      mode,
      deviceName,
      webPlayer: {
        deviceId: web.deviceId,
        status: web.status,
        error: web.error,
        connected: web.connected,
        retry: web.retry,
      },
      activateAudio,
      devices,
      activeDeviceId,
      deviceNotice,
      isResolvingDevice,
      retryDevices,
      transferToDevice,
      dismissDeviceNotice,
      transportError,
      isBuffering,
      isSyncing,
      isTransitioning,
      autoplayFetching,
      playQueue,
      playTrack,
      playFrom,
      toggle,
      next: () => step(1),
      previous: () => step(-1),
      scrubTo,
      seek,
      flushSeek,
      nudge,
      beginScrub,
      endScrub,
      playSource,
      upNext,
      upNextIsSequential,
      setVolume,
      commitVolume,
      toggleShuffle,
      cycleRepeat,
      syncNow: () => void syncNow(true),
    }),
    [
      queue, current, index, isPlaying, shuffle, repeat, volume, mode,
      deviceName, web.deviceId, web.status, web.error, web.connected, web.retry, activateAudio,
      devices, activeDeviceId,
      deviceNotice, isResolvingDevice, retryDevices, transferToDevice, dismissDeviceNotice,
      transportError, isBuffering, isSyncing, isTransitioning, autoplayFetching, playQueue, playTrack, playFrom, toggle, step, scrubTo, seek, flushSeek, nudge, beginScrub,
      endScrub, setVolume, commitVolume, toggleShuffle, cycleRepeat, syncNow, playSource, upNext,
      upNextIsSequential,
    ],
  );

  const progressValue = useMemo<PlayerProgressValue>(
    () => ({ progressMs, durationMs }),
    [progressMs, durationMs],
  );

  return (
    <PlayerContext.Provider value={value}>
      <ProgressContext.Provider value={progressValue}>{children}</ProgressContext.Provider>
    </PlayerContext.Provider>
  );
}

export function usePlayer(): PlayerContextValue {
  const ctx = useContext(PlayerContext);
  if (!ctx) throw new Error("usePlayer must be used inside <PlayerProvider>");
  return ctx;
}

/** High-frequency clock — subscribe only where the position is rendered. */
export function usePlayerProgress(): PlayerProgressValue {
  return useContext(ProgressContext);
}
