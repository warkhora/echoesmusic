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
import { libraryContains, libraryRemove, librarySave, toUri } from "@/lib/spotify/libraryApi";
import { safeJson, safeJsonIfOk } from "@/lib/http";
import { adoptTokenHeaders } from "@/lib/spotify/sessionClient";
import { planBatches, requestFeatures, seedFeatures } from "@/lib/spotify/audioFeatures";
import {
  isRecentHydrated,
  isSavedHydrated,
  patchStoredTracks,
  readRecent,
  readSaved,
  setSavedLocal,
  writeRecent,
  writeSaved,
} from "@/lib/localLibrary";
import {
  adaptArtist,
  adaptLibraryItem,
  adaptPlaylist,
  adaptPlaylistItem,
  adaptTrack,
  isRealTrack,
  spotifyFetch,
  spotifyFetchProjected,
  spotifyFetchSerial,
  type PlaylistItem,
  type SpArtist,
  type SpLibraryItem,
  type SpPlayerState,
  type SpPlaylist,
  type SpTrack,
} from "@/lib/spotify/client";
import { withFields } from "@/lib/spotify/fields";
import { SAVED_MAX_TRACKS, SAVED_PAGE_SIZE, collectPages } from "@/lib/spotify/paginate";
import type {
  Catalog,
  EchoArtist,
  EchoPlaylist,
  EchoTrack,
  ListeningStats,
  SpotifyLibraryPayload,
} from "@/lib/types";

interface PlayerSnapshot {
  isPlaying: boolean;
  progressMs: number;
  currentTrackId: string | null;
  deviceName: string | null;
  takenAt: number;
}

export interface PlaylistMeta {
  resolved: boolean;
  skipped: number;
}

interface LibraryContextValue {
  catalog: Catalog;
  loading: boolean;
  refreshing: boolean;
  error: string | null;
  degraded: string[];
  mode: "demo" | "spotify";
  savedIds: Set<string>;
  playlistTracks: Record<string, EchoTrack[]>;
  /** Human-readable failure per playlist, so the UI never spins forever. */
  playlistErrors: Record<string, string>;
  /** Resolution bookkeeping: an empty playlist is a result, not a pending load. */
  playlistMeta: Record<string, PlaylistMeta>;
  playerSnapshot: PlayerSnapshot | null;
  refresh: () => void;
  /** Re-reads stats (and, in demo mode, the recent rail) without a full reload. */
  refreshActivity: () => Promise<void>;
  /** Direct `GET /v1/me/library/contains` reconciliation — no proxy involved. */
  syncSaved: () => Promise<void>;
  toggleSaved: (track: EchoTrack) => Promise<void>;
  loadPlaylistTracks: (playlistId: string) => Promise<EchoTrack[]>;
  /** One batched `/audio-features` call for a list of tracks (cache-first). */
  ensureFeatures: (tracks: EchoTrack[], token?: string | null) => void;
  /** Lazy listening history: localStorage first, else one request. */
  loadRecent: () => Promise<EchoTrack[]>;
  /** Lazy saved songs: localStorage first, else one `GET /v1/me/tracks`. */
  loadSaved: () => Promise<EchoTrack[]>;
  /** Human-readable failure for the Saved surface, with a retry affordance. */
  savedError: string | null;
}

const LibraryContext = createContext<LibraryContextValue | null>(null);

const EMPTY_STATS: ListeningStats = {
  events: 0,
  minutes: 0,
  completionRate: 0,
  topArtists: [],
  sessions: [],
};

const EMPTY: Catalog = {
  tracks: [],
  playlists: [],
  artists: [],
  recentlyPlayed: [],
  topTracks: [],
  stats: EMPTY_STATS,
};

interface Paged<T> {
  items: T[];
  next: string | null;
}
const emptyPage = <T,>(): Paged<T> => ({ items: [], next: null });

class TokenExpired extends Error {}

/** How long we wait on our own proxy before falling back to direct calls. */
const PROXY_TIMEOUT_MS = 8000;

/** Combines the caller's abort signal with a timeout (first one wins). */
function anySignal(signals: (AbortSignal | undefined)[]): AbortSignal {
  const controller = new AbortController();
  for (const signal of signals) {
    if (!signal) continue;
    if (signal.aborted) {
      controller.abort(signal.reason);
      break;
    }
    signal.addEventListener("abort", () => controller.abort(signal.reason), { once: true });
  }
  return controller.signal;
}

const REQUEST_TIMEOUT = 12_000;

export function LibraryProvider({
  auth,
  enabled = true,
  children,
}: {
  auth: SpotifyAuth;
  /** Idle until a user session exists, so no background calls fire early. */
  enabled?: boolean;
  children: ReactNode;
}) {
  const [catalog, setCatalog] = useState<Catalog>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [degraded, setDegraded] = useState<string[]>([]);
  const [savedIds, setSavedIds] = useState<Set<string>>(new Set());
  const [playlistTracks, setPlaylistTracks] = useState<Record<string, EchoTrack[]>>({});
  const [playlistErrors, setPlaylistErrors] = useState<Record<string, string>>({});
  const [playlistMeta, setPlaylistMeta] = useState<Record<string, PlaylistMeta>>({});
  const [playerSnapshot, setPlayerSnapshot] = useState<PlayerSnapshot | null>(null);
  const [savedError, setSavedError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);

  const token = auth.session?.accessToken ?? null;
  const mode = auth.mode;
  const hasLoadedRef = useRef(false);
  const tokenRef = useRef<string | null>(token);
  useEffect(() => {
    tokenRef.current = token;
  }, [token]);
  const inflightPlaylists = useRef<Record<string, Promise<EchoTrack[]>>>({});

  /**
   * Collects every unique track id in a list and asks for their audio features
   * in **one** batched call per 50 ids. Cached and in-flight ids are filtered
   * out first, so re-rendering a playlist costs zero requests.
   */
  const ensureFeatures = useCallback(
    (tracks: EchoTrack[], accessToken?: string | null) => {
      // Anything the server already merged seeds the global cache immediately,
      // so the table can read it without waiting on a round trip.
      const seeded: Record<
        string,
        { bpm: number | null; musicalKey: string | null; energy: number | null; danceability: number | null; valence: number | null }
      > = {};
      for (const track of tracks) {
        if (track.bpm || track.musicalKey) {
          seeded[track.id] = {
            bpm: track.bpm ?? null,
            musicalKey: track.musicalKey ?? null,
            energy: track.energy ?? null,
            danceability: track.danceability ?? null,
            valence: track.valence ?? null,
          };
        }
      }
      seedFeatures(seeded);

      const token2 = accessToken ?? tokenRef.current;
      if (!token2) return;
      const ids = tracks.map((t) => t.id).filter(Boolean);
      if (!ids.length || planBatches(ids).length === 0) return;
      void requestFeatures(ids, token2);
    },
    [],
  );

  /* ------------------------------ payload merge ----------------------------- */

  const applySpotifyPayload = useCallback((payload: SpotifyLibraryPayload) => {
    const savedSet = new Set(payload.savedTracks.map((t) => t.id));
    const detail: Record<string, EchoTrack[]> = {};
    for (const pl of payload.playlists) if (pl.tracks?.length) detail[pl.id] = pl.tracks;

    // A skipped section keeps whatever localStorage already held, so the rail
    // is never blanked by asking for less.
    const storedRecent = readRecent();
    const storedSaved = readSaved();
    const recentlyPlayed = payload.recentlyPlayed.length
      ? payload.recentlyPlayed
      : storedRecent;
    const savedTracks = payload.savedTracks.length ? payload.savedTracks : storedSaved;

    setCatalog((prev) => ({
      ...prev,
      tracks: payload.tracks.length ? payload.tracks : prev.tracks,
      playlists: payload.playlists,
      artists: payload.artists,
      recentlyPlayed,
      topTracks: payload.topTracks.length ? payload.topTracks : prev.topTracks,
    }));

    // Persist for the next startup — and only when we actually fetched it.
    if (payload.recentlyPlayed.length) writeRecent(payload.recentlyPlayed);
    if (payload.savedTracks.length) writeSaved(payload.savedTracks);
    patchStoredTracks(payload.tracks);
    setSavedIds(new Set(savedTracks.map((t) => t.id)));
    setPlaylistTracks((prev) => ({ ...prev, ...detail }));
    setDegraded(payload.degraded ?? []);
    ensureFeatures(payload.tracks, tokenRef.current);
    setPlayerSnapshot({
      isPlaying: Boolean(payload.isPlaying),
      progressMs: payload.progressMs ?? 0,
      currentTrackId: payload.currentTrackId ?? null,
      deviceName: payload.deviceName ?? null,
      takenAt: Date.now(),
    });

    // Echoes keeps its own telemetry even while connected to Spotify.
    void fetch("/api/playback?limit=1&stats=1", { cache: "no-store" })
      .then((r) => safeJsonIfOk<{ stats?: ListeningStats }>(r))
      .then((data) => data?.stats && setCatalog((prev) => ({ ...prev, stats: data.stats! })))
      .catch(() => undefined);
  }, [ensureFeatures]);

  /* --------------------------- server-side fan-out -------------------------- */

  const loadViaProxy = useCallback(
    async (accessToken: string, fresh: boolean, signal: AbortSignal, skip: string[] = []) => {
      // The proxy is a latency optimisation, never a dependency: if it stalls
      // we abandon it and go straight to the browser-to-Spotify path.
      const query = new URLSearchParams();
      if (fresh) query.set("refresh", "1");
      // Sections already hydrated from localStorage are not requested at all.
      if (skip.length) query.set("skip", skip.join(","));
      const suffix = query.toString();
      const res = await fetch(`/api/spotify/library${suffix ? `?${suffix}` : ""}`, {
        headers: { authorization: `Bearer ${accessToken}` },
        cache: "no-store",
        signal: anySignal([signal, AbortSignal.timeout(PROXY_TIMEOUT_MS)]),
      });
      adoptTokenHeaders(res); // server may have refreshed on our behalf
      if (res.status === 401) throw new TokenExpired("token expired");
      if (!res.ok) throw new Error(`library service responded ${res.status}`);
      const payload = await safeJson<SpotifyLibraryPayload>(res);
      if (!payload) throw new Error("library service returned an empty response");
      return payload;
    },
    [],
  );

  /* --------------------- direct browser fallback (no proxy) ----------------- */

  const loadDirect = useCallback(async (accessToken: string, signal: AbortSignal) => {
    const failures: string[] = [];
    // Sequential, not Promise.all: this path exists because the proxy failed,
    // so hammering Spotify in parallel is exactly the wrong move.
    // `/me/player` is deliberately never projected: the transport needs device,
    // repeat/shuffle and progress alongside the item.
    const get = <T,>(label: string, path: string, fallback: T) =>
      spotifyFetch<T>(path, accessToken, { signal }).catch((err) => {
        const status = err instanceof Error ? err.message.match(/\((\d{3})\)/)?.[1] : undefined;
        failures.push(`${label}:${status ?? "error"}`);
        console.info(`[echoes] ${label} unavailable`, err instanceof Error ? err.message : err);
        return fallback;
      });

    const getProjected = <T,>(label: string, projected: string, plain: string, fallback: T) =>
      spotifyFetchProjected<T>(projected, plain, accessToken, { signal }).catch((err) => {
        const status = err instanceof Error ? err.message.match(/\((\d{3})\)/)?.[1] : undefined;
        failures.push(`${label}:${status ?? "error"}`);
        console.info(`[echoes] ${label} unavailable`, err instanceof Error ? err.message : err);
        return fallback;
      });

    const playlistsRes = await getProjected<Paged<SpPlaylist>>(
      "playlists",
      withFields("/me/playlists", "playlists", { limit: 50 }),
      "/me/playlists?limit=50",
      emptyPage<SpPlaylist>(),
    );
    const savedRes = await getProjected<Paged<PlaylistItem>>(
      "saved",
      withFields("/me/tracks", "savedTracks", { limit: 50, offset: 0 }),
      "/me/tracks?limit=50&offset=0&market=from_token",
      emptyPage<PlaylistItem>(),
    );
    const topTracksRes = await getProjected<Paged<SpTrack>>(
      "top_tracks",
      withFields("/me/top/tracks", "topTracks", { limit: 20, time_range: "medium_term" }),
      "/me/top/tracks?limit=20&time_range=medium_term",
      emptyPage<SpTrack>(),
    );
    const topArtistsRes = await getProjected<Paged<SpArtist>>(
      "top_artists",
      withFields("/me/top/artists", "topArtists", { limit: 10, time_range: "medium_term" }),
      "/me/top/artists?limit=10&time_range=medium_term",
      emptyPage<SpArtist>(),
    );
    const playerRes = await get<SpPlayerState | null>("player", "/me/player?market=from_token", null);
    // History is lazy — never part of the startup path.
    const recentRes = emptyPage<{ track?: SpTrack; played_at: string }>();

    const all = new Map<string, EchoTrack>();
    const topTracks = topTracksRes.items.filter(isRealTrack).map((t) => adaptTrack(t));
    const recentlyPlayed: EchoTrack[] = [];
    const seen = new Set<string>();
    for (const item of recentRes.items) {
      if (!isRealTrack(item.track)) continue;
      const t = adaptTrack(item.track);
      if (seen.has(t.id)) continue;
      seen.add(t.id);
      recentlyPlayed.push(t);
    }
    const savedTracks = savedRes.items
      .map((i) => (isRealTrack(i.track) ? adaptTrack(i.track, i.added_at ?? null) : null))
      .filter((t): t is EchoTrack => Boolean(t))
      .map((t) => ({ ...t, saved: true }));
    const liveTrack = isRealTrack(playerRes?.item) ? adaptTrack(playerRes!.item!) : null;

    for (const t of [...topTracks, ...recentlyPlayed, ...savedTracks, ...(liveTrack ? [liveTrack] : [])]) {
      all.set(t.id, { ...all.get(t.id), ...t });
    }

    // Nothing but 401s → the session itself is dead, not a single endpoint.
    if (failures.length >= 4 && failures.every((f) => f.endsWith(":401"))) {
      throw new TokenExpired("spotify rejected the access token");
    }

    const payload: SpotifyLibraryPayload = {
      degraded: failures.length ? failures : ["direct-mode"],
      playlists: playlistsRes.items.filter((p) => p?.id).map(adaptPlaylist),
      tracks: [...all.values()],
      artists: topArtistsRes.items.filter((a) => a?.id).map(adaptArtist),
      recentlyPlayed: recentlyPlayed.slice(0, 14),
      topTracks: topTracks.slice(0, 12),
      savedTracks,
      deviceName: playerRes?.device?.name ?? null,
      isPlaying: Boolean(playerRes?.is_playing),
      progressMs: playerRes?.progress_ms ?? 0,
      currentTrackId: liveTrack?.id ?? null,
    };
    return payload;
  }, []);

  /* -------------------------------- demo mode ------------------------------- */

  const loadDemo = useCallback(async (signal: AbortSignal) => {
    // Paint the stored history immediately so Home is never empty on startup.
    const storedRecent = readRecent();
    if (storedRecent.length) {
      setCatalog((prev) => ({ ...prev, recentlyPlayed: storedRecent }));
    }

    const res = await fetch("/api/catalog", { cache: "no-store", signal });
    if (!res.ok) throw new Error(`Catalog responded ${res.status}`);
    const data = await safeJson<Catalog>(res);
    if (!data?.tracks) throw new Error("Catalog returned an empty response");

    const detail: Record<string, EchoTrack[]> = {};
    const byId = new Map(data.tracks.map((t) => [t.id, t]));
    for (const pl of data.playlists) {
      detail[pl.id] = pl.trackIds.map((id) => byId.get(id)).filter((t): t is EchoTrack => Boolean(t));
    }

    setCatalog(data);
    setPlaylistTracks(detail);
    // Our own catalog is the source of truth in demo mode; mirror it locally so
    // the next startup paints before the request resolves.
    if (data.recentlyPlayed.length) writeRecent(data.recentlyPlayed);
    const savedTracks = data.tracks.filter((t) => t.saved);
    if (savedTracks.length) writeSaved(savedTracks);
    setPlaylistMeta(
      Object.fromEntries(data.playlists.map((pl) => [pl.id, { resolved: true, skipped: 0 }])),
    );
    setSavedIds(new Set(data.tracks.filter((t) => t.saved).map((t) => t.id)));
    setDegraded([]);
  }, []);

  /**
   * Sections to leave out of the startup fan-out.
   *
   * History is *always* skipped at startup — it is loaded lazily by Home and
   * Activity through `loadRecent()`. Saved and the rest are skipped once
   * localStorage has hydrated them, so a warm start asks Spotify for nothing.
   */
  const hydratedSkip = useCallback(() => {
    const skip: string[] = ["recent"];
    if (isSavedHydrated()) skip.push("saved");
    return skip;
  }, []);

  /**
   * Saved songs — localStorage first, and only then one network request.
   *
   * Strict try/catch: a 503, a missing `user-library-read` scope or an offline
   * moment is logged descriptively and surfaced to the UI as a retryable state
   * instead of failing silently into an empty list.
   */
  const loadSaved = useCallback(async (): Promise<EchoTrack[]> => {
    if (isSavedHydrated()) {
      const stored = readSaved();
      setSavedError(null);
      if (stored.length) {
        setSavedIds(new Set(stored.map((t) => t.id)));
        setCatalog((prev) => {
          const byId = new Map(prev.tracks.map((t) => [t.id, t]));
          for (const track of stored) if (!byId.has(track.id)) byId.set(track.id, track);
          return { ...prev, tracks: [...byId.values()] };
        });
      }
      return stored;
    }

    const accessToken = tokenRef.current;
    if (!accessToken || mode !== "spotify") return [];

    try {
      // Paginate through the shared walker: offset 0, 50, 100 … until a short
      // page, a null `next`, or the 500-track cap. Every page goes through the
      // serial lane, so a large library cannot flood Spotify.
      const paged = await collectPages<PlaylistItem, EchoTrack>({
        firstUrl: withFields("/me/tracks", "savedTracks", {
          limit: SAVED_PAGE_SIZE,
          offset: 0,
        }),
        pageSize: SAVED_PAGE_SIZE,
        cap: SAVED_MAX_TRACKS,
        fetchPage: (url) => spotifyFetchSerial<Paged<PlaylistItem>>(url, accessToken),
        adapt: (row) => {
          const track = adaptLibraryItem(row as unknown as SpLibraryItem);
          return track ? { ...track, saved: true } : null;
        },
        onPageError: (error) =>
          console.warn(
            "[echoes] saved-tracks page failed, keeping what was collected:",
            error instanceof Error ? error.message : error,
          ),
      });
      const tracks = paged.items;
      console.info(
        `[echoes] saved songs: ${tracks.length} tracks in ${paged.pages} page(s), stopped: ${paged.stopped}`,
      );

      if (!tracks.length) {
        // An empty library is a legitimate result, not an error — but say so.
        console.info(
          "[echoes] /me/tracks returned 0 rows. Either the library is empty or the granted scopes are out of date (user-library-read is required).",
        );
        writeSaved([]);
        setSavedError(null);
        return [];
      }

      // The complete paginated list, not just the first page.
      writeSaved(tracks);
      setSavedIds(new Set(tracks.map((t) => t.id)));
      setCatalog((prev) => {
        const byId = new Map(prev.tracks.map((t) => [t.id, t]));
        for (const track of tracks) byId.set(track.id, track);
        return { ...prev, tracks: [...byId.values()] };
      });
      ensureFeatures(tracks, accessToken);
      setSavedError(null);
      return tracks;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      // Descriptive, never silent: name the endpoint and the likely cause.
      console.warn(
        `[echoes] GET /v1/me/tracks failed — saved songs unavailable. ${message}. ` +
          "Check that the token includes the user-library-read scope, then reconnect.",
      );
      setSavedError(
        message.includes("503")
          ? "Spotify is temporarily unavailable (503). Your liked songs are safe — try again in a moment."
          : message.includes("403")
            ? "Spotify refused the saved-tracks request (403). The user-library-read scope may be missing — reconnect to grant it."
            : message.includes("401")
              ? "Your Spotify session expired. Reconnect from the profile menu to load your liked songs."
              : "Could not load your saved songs. Check your connection and try again.",
      );
      return [];
    }
  }, [mode, ensureFeatures]);

  /**
   * Lazy listening history: one request, only when localStorage is empty.
   * Called on mount by the Home and Activity views — never at startup.
   */
  const loadRecent = useCallback(async () => {
    if (isRecentHydrated()) {
      const stored = readRecent();
      if (stored.length) setCatalog((prev) => ({ ...prev, recentlyPlayed: stored }));
      return stored;
    }
    const accessToken = tokenRef.current;
    if (!accessToken || mode !== "spotify") return [];

    let tracks: EchoTrack[] = [];
    try {
      const res = await fetch("/api/spotify/recent?limit=50", {
        headers: { authorization: `Bearer ${accessToken}` },
        cache: "no-store",
      });
      adoptTokenHeaders(res);
      if (res.ok) {
        const data = await safeJson<{ tracks?: EchoTrack[] }>(res);
        tracks = data?.tracks ?? [];
      }
    } catch {
      /* fall through to the direct call */
    }

    if (!tracks.length) {
      try {
        const page = await spotifyFetchSerial<Paged<{ track?: SpTrack; played_at: string }>>(
          "/me/player/recently-played?limit=50&market=from_token",
          accessToken,
        );
        const seen = new Set<string>();
        for (const item of page.items ?? []) {
          if (!isRealTrack(item.track)) continue;
          const track = adaptTrack(item.track);
          if (seen.has(track.id)) continue;
          seen.add(track.id);
          tracks.push(track);
        }
      } catch (error) {
        console.info("[echoes] history unavailable", error instanceof Error ? error.message : error);
      }
    }

    // Persist even when empty-but-successful? No: only a real result marks the
    // store hydrated, so a transient failure is retried on the next visit.
    if (tracks.length) {
      writeRecent(tracks);
      setCatalog((prev) => ({ ...prev, recentlyPlayed: tracks }));
    }
    return tracks;
  }, [mode]);

  /* ------------------------------ orchestration ----------------------------- */

  useEffect(() => {
    if (!enabled) {
      setLoading(false);
      return;
    }
    if (auth.status === "booting" || auth.status === "connecting") return;

    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT);
    let alive = true;
    const isRefresh = hasLoadedRef.current;
    if (isRefresh) setRefreshing(true);
    else setLoading(true);

    void (async () => {
      try {
        if (mode === "spotify" && token) {
          let payload: SpotifyLibraryPayload | null = null;
          try {
            payload = await loadViaProxy(token, nonce > 0, controller.signal, hydratedSkip());
          } catch (err) {
            if (controller.signal.aborted) throw err;
            if (err instanceof TokenExpired) {
              const fresh = await auth.getAccessToken();
              if (fresh && fresh !== token) {
                payload = await loadViaProxy(fresh, nonce > 0, controller.signal, hydratedSkip()).catch(
                  () => null,
                );
              }
            }
            // Server can't reach Spotify (or the proxy is unavailable) → go direct.
            if (!payload) payload = await loadDirect(token, controller.signal);
          }
          if (alive && payload) {
            applySpotifyPayload(payload);
            setError(payload.playlists.length || payload.tracks.length ? null : "Spotify returned an empty library.");
          }
        } else {
          await loadDemo(controller.signal);
          if (alive) setError(null);
        }
        hasLoadedRef.current = true;
      } catch (err) {
        if (!alive || controller.signal.aborted) return;
        if (err instanceof TokenExpired) {
          setError(
            "Your Spotify session expired. Disconnect from the profile menu, then connect again.",
          );
        } else {
          setError(
            err instanceof Error
              ? err.name === "AbortError"
                ? "The request timed out. Refresh when you're back online."
                : err.message
              : "Could not load your library.",
          );
        }
      } finally {
        if (alive) {
          setLoading(false);
          setRefreshing(false);
        }
      }
    })();

    return () => {
      alive = false;
      window.clearTimeout(timeout);
      controller.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, mode, token, auth.status, nonce, loadViaProxy, loadDirect, loadDemo, applySpotifyPayload]);

  const refresh = useCallback(() => setNonce((n) => n + 1), []);

  /**
   * Called whenever a listen is logged, so Home and Activity stay live without
   * waiting for their own polling cadence.
   */
  const refreshActivity = useCallback(async () => {
    try {
      const res = await fetch("/api/playback?limit=1&stats=1", { cache: "no-store" });
      const data = await safeJson<{ stats?: ListeningStats }>(res);
      if (data?.stats) setCatalog((prev) => ({ ...prev, stats: data.stats! }));
    } catch {
      /* the next poll will pick it up */
    }

    if (mode === "demo") {
      try {
        const res = await fetch("/api/catalog", { cache: "no-store" });
        const data = await safeJson<Catalog>(res);
        if (data?.recentlyPlayed) {
          setCatalog((prev) => ({ ...prev, recentlyPlayed: data.recentlyPlayed }));
        }
      } catch {
        /* ignore */
      }
    }
  }, [mode]);

  /* ----------------------------- playlist detail ---------------------------- */

  const loadPlaylistTracks = useCallback(
    async (playlistId: string): Promise<EchoTrack[]> => {
      const cached = playlistTracks[playlistId];
      if (cached?.length) return cached;
      if (playlistMeta[playlistId]?.resolved) return cached ?? [];
      const pending = inflightPlaylists.current[playlistId];
      if (pending) return pending;

      const run = async (): Promise<EchoTrack[]> => {
        if (mode !== "spotify" || !token) return playlistTracks[playlistId] ?? [];

        const markResolved = (count: number, tracks: EchoTrack[]) => {
          setPlaylistMeta((prev) => ({ ...prev, [playlistId]: { resolved: true, skipped: count } }));
          if (tracks.length) {
            setPlaylistTracks((prev) => ({ ...prev, [playlistId]: tracks }));
            mergeTracks(tracks);
          }
          return tracks;
        };

        setPlaylistErrors((prev) => {
          if (!prev[playlistId]) return prev;
          const next = { ...prev };
          delete next[playlistId];
          return next;
        });

        const succeed = (tracks: EchoTrack[], skipped = 0) => {
          ensureFeatures(tracks, token);
          return markResolved(skipped, tracks);
        };
        const fail = (status: number, message?: string) => {
          setPlaylistErrors((prev) => ({
            ...prev,
            [playlistId]: playlistErrorMessage(status, message),
          }));
          return [] as EchoTrack[];
        };

        // 1 — server route: paged, feature-enriched, 403-resilient.
        try {
          const res = await fetch(`/api/spotify/playlist?id=${encodeURIComponent(playlistId)}`, {
            headers: { authorization: `Bearer ${token}` },
            cache: "no-store",
          });
          adoptTokenHeaders(res);
          const data = await safeJson<{
            tracks?: EchoTrack[];
            skipped?: number;
            message?: string;
          }>(res);
          if (res.ok && data?.tracks) return succeed(data.tracks, data.skipped ?? 0);
          if (!res.ok) {
            // A dead token is worth one refresh + retry before giving up.
            if (res.status === 401) {
              const fresh = await auth.getAccessToken();
              if (fresh && fresh !== token) {
                const retry = await fetch(
                  `/api/spotify/playlist?id=${encodeURIComponent(playlistId)}`,
                  { headers: { authorization: `Bearer ${fresh}` }, cache: "no-store" },
                );
                adoptTokenHeaders(retry);
                const retryData = await safeJson<{ tracks?: EchoTrack[]; skipped?: number }>(retry);
                if (retry.ok && retryData?.tracks) {
                  return succeed(retryData.tracks, retryData.skipped ?? 0);
                }
              }
            }
            return fail(res.status, data?.message);
          }
        } catch {
          /* fall through to the direct call */
        }

        // 2 — straight from the browser.
        try {
          // Feb 2026: /items replaced /tracks; try both, newest first.
          const itemParams = { limit: 100, offset: 0, additional_types: "track,episode" };
          const endpoints = [
            {
              projected: withFields(`/playlists/${playlistId}/items`, "playlistItems", itemParams),
              plain: `/playlists/${playlistId}/items?limit=100&offset=0&market=from_token&additional_types=track,episode`,
            },
            {
              projected: withFields(`/playlists/${playlistId}/tracks`, "playlistItems", itemParams),
              plain: `/playlists/${playlistId}/tracks?limit=100&offset=0&market=from_token&additional_types=track,episode`,
            },
          ];
          let lastError: unknown = null;
          for (const endpoint of endpoints) {
            try {
              const page = await spotifyFetchProjected<Paged<PlaylistItem>>(
                endpoint.projected,
                endpoint.plain,
                token,
              );
              const rows = page.items ?? [];
              const tracks = rows.map(adaptPlaylistItem).filter((t): t is EchoTrack => Boolean(t));
              return succeed(tracks, rows.length - tracks.length);
            } catch (err) {
              lastError = err;
            }
          }
          throw lastError ?? new Error("playlist unavailable");
        } catch (err) {
          const status = err instanceof Error ? Number(err.message.match(/\((\d{3})\)/)?.[1]) || 0 : 0;
          console.info("[echoes] playlist detail unavailable", err instanceof Error ? err.message : err);
          return fail(status, err instanceof Error ? err.message : undefined);
        }
      };

      const promise = run().finally(() => {
        delete inflightPlaylists.current[playlistId];
      });
      inflightPlaylists.current[playlistId] = promise;
      return promise;
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [mode, token, playlistTracks, playlistMeta, auth.getAccessToken, ensureFeatures],
  );

  /** Keeps the global track map (and therefore BPM/art) in sync as we page in. */
  const mergeTracks = useCallback((incoming: EchoTrack[]) => {
    if (!incoming.length) return;
    setCatalog((prev) => {
      const byId = new Map(prev.tracks.map((t) => [t.id, t]));
      let changed = false;
      for (const t of incoming) {
        const existing = byId.get(t.id);
        if (!existing || existing.bpm === undefined) {
          byId.set(t.id, { ...existing, ...t });
          changed = true;
        }
      }
      return changed ? { ...prev, tracks: [...byId.values()] } : prev;
    });
  }, []);

  /* -------------------------------- saved state ----------------------------- */

  const toggleSaved = useCallback(
    async (track: EchoTrack) => {
      const isSaved = savedIds.has(track.id);
      const next = new Set(savedIds);
      if (isSaved) next.delete(track.id);
      else next.add(track.id);
      setSavedIds(next); // optimistic
      setCatalog((prev) => ({
        ...prev,
        tracks: prev.tracks.map((t) => (t.id === track.id ? { ...t, saved: !isSaved } : t)),
      }));
      // Same tick: the Saved view and every heart icon update without a reload.
      setSavedLocal(track, !isSaved);

      try {
        if (mode === "spotify" && token) {
          // Straight from the browser to the unified /me/library endpoints —
          // no backend hop, so a proxy outage can never block a save.
          const uri = toUri(track.uri ?? track.id, "track");
          if (isSaved) await libraryRemove(token, [uri]);
          else await librarySave(token, [uri]);
        } else {
          await fetch(`/api/tracks/${track.id}/saved`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ saved: !isSaved }),
          });
        }
      } catch (err) {
        setSavedIds(savedIds); // roll back
        setSavedLocal(track, isSaved);
        setCatalog((prev) => ({
          ...prev,
          tracks: prev.tracks.map((t) => (t.id === track.id ? { ...t, saved: isSaved } : t)),
        }));
        console.info("[echoes] save toggle rolled back", err instanceof Error ? err.message : err);
      }
    },
    [mode, token, savedIds],
  );

  /**
   * Re-checks saved state straight against `GET /v1/me/library/contains`
   * (chunked to 40 URIs). Catches changes made in the Spotify app itself.
   */
  const syncSaved = useCallback(async () => {
    if (mode !== "spotify" || !token) return;
    const checked = catalog.tracks.slice(0, 40);
    if (!checked.length) return;
    try {
      const flags = await libraryContains(
        token,
        checked.map((t) => toUri(t.uri ?? t.id, "track")),
      );
      setSavedIds((prev) => {
        const next = new Set(prev);
        checked.forEach((t, i) => {
          if (flags[i]) next.add(t.id);
          else next.delete(t.id);
        });
        return next;
      });
    } catch (error) {
      console.info("[echoes] saved sync skipped", error instanceof Error ? error.message : error);
    }
  }, [mode, token, catalog.tracks]);

  const value = useMemo<LibraryContextValue>(
    () => ({
      syncSaved,
      catalog,
      loading,
      refreshing,
      error,
      degraded,
      mode,
      savedIds,
      playlistTracks,
      playlistErrors,
      playlistMeta,
      playerSnapshot,
      refresh,
      refreshActivity,
      toggleSaved,
      loadPlaylistTracks,
      ensureFeatures,
      loadRecent,
      loadSaved,
      savedError,
    }),
    [
      catalog, loading, refreshing, error, degraded, mode, savedIds, playlistTracks,
      playlistErrors, playlistMeta, playerSnapshot, refresh, refreshActivity, syncSaved,
      toggleSaved, loadPlaylistTracks, ensureFeatures, loadRecent, loadSaved, savedError,
    ],
  );

  return <LibraryContext.Provider value={value}>{children}</LibraryContext.Provider>;
}

export function useLibrary(): LibraryContextValue {
  const ctx = useContext(LibraryContext);
  if (!ctx) throw new Error("useLibrary must be used inside <LibraryProvider>");
  return ctx;
}

/** Turns a Spotify/HTTP status into something a listener can act on. */
export function playlistErrorMessage(status: number, fallback?: string): string {
  switch (status) {
    case 401:
      return "Your Spotify session expired. Reconnect from the profile menu to continue.";
    case 403:
      return "Spotify refused this playlist — it may be private, region-locked, or the granted scopes are out of date. Reconnect to refresh permissions.";
    case 404:
      return "This playlist no longer exists on Spotify.";
    case 429:
      return "Spotify is rate-limiting right now. Try again in a moment.";
    case 502:
    case 503:
      return fallback ?? "Spotify could not be reached for this playlist.";
    default:
      return fallback ?? "Could not load this playlist.";
  }
}
