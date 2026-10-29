import type { EchoTrack } from "@/lib/types";

/**
 * A tiny in-app event bus.
 *
 * Playback lives in one provider, but Home and Activity both need to react the
 * instant a track changes or a listen is logged — without prop-drilling or
 * re-rendering the whole tree. A module-level EventTarget keeps those surfaces
 * live and lets each of them debounce its own refetch.
 */

export interface TrackChangedDetail {
  track: EchoTrack;
  isPlaying: boolean;
  source: "demo" | "spotify";
  at: number;
}

export interface ListenLoggedDetail {
  trackId: string;
  trackTitle: string;
  artist: string;
  source: string;
  progressMs: number;
  durationMs: number;
  completed: boolean;
  at: number;
}

export interface TrackFinishedDetail {
  track: EchoTrack;
  /** What Echoes decided to play next (auto-play), when anything. */
  next: EchoTrack | null;
  at: number;
}

const bus: EventTarget =
  typeof window !== "undefined" ? new EventTarget() : ({ addEventListener() {}, removeEventListener() {}, dispatchEvent() { return false; } } as unknown as EventTarget);

const TRACK_CHANGED = "echoes:track-changed";
const LISTEN_LOGGED = "echoes:listen-logged";
const TRACK_FINISHED = "echoes:track-finished";

function subscribe<T>(type: string, handler: (detail: T) => void): () => void {
  const listener = (event: Event) => handler((event as CustomEvent<T>).detail);
  bus.addEventListener(type, listener);
  return () => bus.removeEventListener(type, listener);
}

function publish<T>(type: string, detail: T): void {
  try {
    bus.dispatchEvent(new CustomEvent<T>(type, { detail }));
  } catch {
    /* CustomEvent unavailable — the UI simply stays on its polling cadence */
  }
}

export const onTrackChanged = (handler: (detail: TrackChangedDetail) => void) =>
  subscribe<TrackChangedDetail>(TRACK_CHANGED, handler);
export const emitTrackChanged = (detail: TrackChangedDetail) => publish(TRACK_CHANGED, detail);

export const onListenLogged = (handler: (detail: ListenLoggedDetail) => void) =>
  subscribe<ListenLoggedDetail>(LISTEN_LOGGED, handler);
export const emitListenLogged = (detail: ListenLoggedDetail) => publish(LISTEN_LOGGED, detail);

export const onTrackFinished = (handler: (detail: TrackFinishedDetail) => void) =>
  subscribe<TrackFinishedDetail>(TRACK_FINISHED, handler);
export const emitTrackFinished = (detail: TrackFinishedDetail) => publish(TRACK_FINISHED, detail);

/** Debounces a burst of events into a single refetch. */
export function debounce(fn: () => void, ms: number): (() => void) & { cancel: () => void } {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const wrapped = (() => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      fn();
    }, ms);
  }) as (() => void) & { cancel: () => void };
  wrapped.cancel = () => {
    if (timer) clearTimeout(timer);
    timer = null;
  };
  return wrapped;
}
