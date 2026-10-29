import { safeJson } from "@/lib/http";
import {
  SpotifyApiError,
  adaptArtist,
  adaptTrack,
  isRealTrack,
  spotifyFetch,
  type SpArtist,
  type SpTrack,
} from "@/lib/spotify/client";
import {
  isRateLimitStatus,
  noteRateLimit,
  noteSuccess,
  rateLimited,
  retryAfterSeconds,
} from "@/lib/spotify/rateLimit";
import { adoptTokenHeaders } from "@/lib/spotify/sessionClient";
import type { EchoArtist, EchoTrack } from "@/lib/types";

/**
 * Persistent, shared cache for detail lookups.
 *
 * Rule: **one request per id, ever** — until the TTL lapses. Returning to a
 * previously played artist or track costs zero network calls. Failures are
 * cached too, so a rate-limited id is not retried on the next re-render, and an
 * in-flight map means two consumers mounting together share a single request.
 *
 * Both loaders take the token as an argument and are only ever invoked from an
 * effect keyed on the *id*, never on the token: a token refresh mid-session
 * must not look like a new track.
 */

const POSITIVE_TTL_MS = 30 * 60_000;
const NEGATIVE_TTL_MS = 60_000;

/* -------------------------------------------------------------------------- */
/*  Reactive version counter                                                   */
/*                                                                             */
/*  A Map read during render is not reactive: when artist genres or audio       */
/*  features land *after* a table has painted, the cells would keep showing     */
/*  "-" forever. Every cache write bumps this counter and subscribers           */
/*  (useSyncExternalStore) re-render once — no polling, no refetch.             */
/* -------------------------------------------------------------------------- */

let version = 0;
const listeners = new Set<() => void>();

export function subscribeMetadata(onChange: () => void): () => void {
  listeners.add(onChange);
  return () => listeners.delete(onChange);
}

export function metadataVersion(): number {
  return version;
}

/** Bumped by any cache write — artist detail, track detail or audio features. */
export function notifyMetadata(): void {
  version += 1;
  for (const listener of listeners) listener();
}

interface Entry<T> {
  at: number;
  value: T | null;
}

function createCache<T>() {
  const store = new Map<string, Entry<T>>();
  const running = new Map<string, Promise<T | null>>();
  /**
   * Ids we have already put on the wire this session. A resolved value is
   * served forever; this guard is what makes "same id ⇒ 0 requests" absolute,
   * even if an effect dependency ever churns again.
   */
  const requested = new Set<string>();

  return {
    get(id: string): T | null {
      const hit = store.get(id);
      if (!hit || !hit.value) return null;
      if (Date.now() - hit.at > POSITIVE_TTL_MS) return null;
      return hit.value;
    },
    /** A positive entry is permanent for the session; failures expire. */
    has(id: string): boolean {
      const hit = store.get(id);
      if (!hit) return false;
      if (hit.value) return true;
      return Date.now() - hit.at < NEGATIVE_TTL_MS;
    },
    alreadyRequested(id: string): boolean {
      return requested.has(id);
    },
    markRequested(id: string): void {
      requested.add(id);
    },
    /** Lets a genuine retry happen after the breaker closes. */
    clearRequest(id: string): void {
      requested.delete(id);
    },
    /**
     * Drops a *rate-limited* miss entirely: the breaker, not the negative TTL,
     * decides when this id may be asked for again.
     */
    forget(id: string): void {
      store.delete(id);
      requested.delete(id);
    },
    inflight(id: string): Promise<T | null> | undefined {
      return running.get(id);
    },
    remember(id: string, value: T | null): void {
      store.set(id, { at: Date.now(), value });
    },
    track(id: string, promise: Promise<T | null>): Promise<T | null> {
      running.set(id, promise);
      return promise.finally(() => running.delete(id));
    },
  };
}

const artistCache = createCache<EchoArtist>();
const trackCache = createCache<EchoTrack>();

/**
 * Read-only views of the caches, for UI that wants to render an already-known
 * detail instantly instead of showing a placeholder.
 */
/**
 * Stores a resolved artist in the shared cache without a network call, so any
 * consumer that already holds the value can seed it for everybody else.
 */
export function rememberArtist(artistId: string, artist: EchoArtist): void {
  artistCache.remember(artistId, artist);
  notifyMetadata();
}

export const artistDetailCache = {
  /** True when this id is resolved, failed, or has already been requested. */
  isSettled: (id: string | null): boolean =>
    Boolean(id) && (artistCache.has(id as string) || artistCache.alreadyRequested(id as string)),
  get: (id: string | null): EchoArtist | null => (id ? artistCache.get(id) : null),
};

export const trackDetailCache = {
  isSettled: (id: string | null): boolean =>
    Boolean(id) && (trackCache.has(id as string) || trackCache.alreadyRequested(id as string)),
  get: (id: string | null): EchoTrack | null => (id ? trackCache.get(id) : null),
};

/** `GET /v1/artists/{id}` — once per artist id, cached for 30 minutes. */
export async function loadArtistDetail(
  artistId: string | null,
  token: string | null,
  signal?: AbortSignal,
): Promise<EchoArtist | null> {
  if (!artistId) return null;

  // 1 — cache first: an already-known artist returns instantly, no network.
  if (artistCache.has(artistId)) return artistCache.get(artistId);
  // 2 — breaker open: do not add to the pile, serve whatever we have.
  if (rateLimited()) return artistCache.get(artistId);
  // 3 — this id has already been requested once this session.
  if (artistCache.alreadyRequested(artistId)) return artistCache.get(artistId);

  const pending = artistCache.inflight(artistId);
  if (pending) return pending;
  if (!token) return null;

  artistCache.markRequested(artistId);

  const run = (async (): Promise<EchoArtist | null> => {
    let limited = false;
    try {
      const res = await fetch(`/api/spotify/artist?id=${encodeURIComponent(artistId)}`, {
        headers: { authorization: `Bearer ${token}` },
        cache: "no-store",
        signal,
      });
      adoptTokenHeaders(res);
      if (res.ok) {
        const data = await safeJson<{ artist?: EchoArtist | null }>(res);
        if (data && "artist" in data) {
          noteSuccess();
          return data.artist ?? null;
        }
      }
      if (isRateLimitStatus(res.status)) {
        limited = true;
        noteRateLimit("/api/spotify/artist", retryAfterSeconds(res.headers));
      }
    } catch {
      /* proxy unreachable — the direct call below is the fallback */
    }

    // A rate limit is terminal for this attempt: falling through to Spotify
    // directly would be an immediate second request for the same id.
    if (limited || rateLimited() || signal?.aborted) return null;

    try {
      const raw = await spotifyFetch<SpArtist>(`/artists/${artistId}`, token, { signal });
      noteSuccess();
      return adaptArtist(raw);
    } catch (error) {
      if (error instanceof SpotifyApiError && isRateLimitStatus(error.status)) {
        noteRateLimit("/artists/{id}");
      } else {
        console.info(
          "[echoes] artist detail unavailable",
          error instanceof Error ? error.message : error,
        );
      }
      return null;
    }
  })();

  const settled = artistCache.track(artistId, run);
  const value = await settled;

  // Our own AbortController firing (the consumer switched tracks) is not a
  // Spotify failure: caching it as a miss would hide this artist for a minute.
  if (!value && signal?.aborted) {
    artistCache.forget(artistId);
    return null;
  }
  if (!value && rateLimited()) {
    // Governed by the session halt, not the negative TTL.
    artistCache.forget(artistId);
  } else {
    artistCache.remember(artistId, value);
    if (value) notifyMetadata();
  }
  return value;
}

/**
 * `GET /v1/tracks/{id}?market=from_token` plus the album/artist detail the
 * server aggregates — once per track id, cached for 30 minutes.
 */
export async function loadTrackDetail(
  trackId: string | null,
  token: string | null,
  signal?: AbortSignal,
): Promise<EchoTrack | null> {
  if (!trackId) return null;
  if (trackCache.has(trackId)) return trackCache.get(trackId);
  if (rateLimited()) return trackCache.get(trackId);
  if (trackCache.alreadyRequested(trackId)) return trackCache.get(trackId);

  const pending = trackCache.inflight(trackId);
  if (pending) return pending;
  if (!token) return null;

  trackCache.markRequested(trackId);

  const run = (async (): Promise<EchoTrack | null> => {
    let limited = false;
    try {
      const res = await fetch(`/api/spotify/track?id=${encodeURIComponent(trackId)}`, {
        headers: { authorization: `Bearer ${token}` },
        cache: "no-store",
        signal,
      });
      adoptTokenHeaders(res);
      if (res.ok) {
        const data = await safeJson<{ track?: EchoTrack | null }>(res);
        if (data && "track" in data) {
          noteSuccess();
          return data.track ?? null;
        }
      }
      if (isRateLimitStatus(res.status)) {
        limited = true;
        noteRateLimit("/api/spotify/track", retryAfterSeconds(res.headers));
      }
    } catch {
      /* proxy unreachable — the direct call below is the fallback */
    }

    if (limited || rateLimited() || signal?.aborted) return null;

    try {
      const raw = await spotifyFetch<SpTrack>(`/tracks/${trackId}?market=from_token`, token, { signal });
      noteSuccess();
      return isRealTrack(raw) ? adaptTrack(raw) : null;
    } catch (error) {
      if (error instanceof SpotifyApiError && isRateLimitStatus(error.status)) {
        noteRateLimit("/tracks/{id}");
      } else {
        console.info("[echoes] track detail unavailable", error instanceof Error ? error.message : error);
      }
      return null;
    }
  })();

  const settled = trackCache.track(trackId, run);
  const value = await settled;
  if (!value && signal?.aborted) {
    trackCache.forget(trackId);
    return null;
  }
  if (!value && rateLimited()) {
    trackCache.forget(trackId);
  } else {
    trackCache.remember(trackId, value);
    if (value) notifyMetadata();
  }
  return value;
}

/**
 * The "View on Spotify" target, built synchronously from data the UI already
 * holds — so the button never waits on a fetch, never changes text, and never
 * flickers between two links while an artist resolves.
 */
export function spotifyArtistUrl(artistId: string | null, artistName?: string | null): string {
  if (artistId) return `https://open.spotify.com/artist/${artistId}`;
  if (artistName) return `https://open.spotify.com/search/${encodeURIComponent(artistName)}`;
  return "https://open.spotify.com/";
}
