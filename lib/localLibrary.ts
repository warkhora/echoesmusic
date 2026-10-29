import type { EchoTrack } from "@/lib/types";

/**
 * localStorage hydration for the two surfaces that must never be empty on
 * startup: **Listening History** ("Pulled from your listening telemetry") and
 * **Saved / Liked Songs**.
 *
 * Contract:
 *   · first paint reads localStorage synchronously — no spinner, no empty rail;
 *   · if a store is empty, exactly ONE Spotify request hydrates it
 *     (`/me/player/recently-played`, `/me/tracks`) and the result is persisted;
 *   · once hydrated, later visits read exclusively from localStorage and the
 *     corresponding endpoints are skipped entirely (0 requests);
 *   · liking, unliking or starting a track updates React state and localStorage
 *     in the same tick — no reload required;
 *   · writes are reactive, so any subscribed view re-renders.
 */

const RECENT_KEY = "echoes.recent.v1";
/** Requested key name; the previous one is migrated transparently. */
const SAVED_KEY = "echoes_saved_tracks";
const LEGACY_SAVED_KEY = "echoes.saved.v1";

const RECENT_LIMIT = 30;
const SAVED_LIMIT = 500; // matches the paginated fetch safety cap

interface Envelope {
  /** When this store was first hydrated — its presence is the "don't refetch" flag. */
  hydratedAt: number;
  tracks: EchoTrack[];
}

/* ------------------------------ reactivity ------------------------------- */

let version = 0;
const listeners = new Set<() => void>();

export function subscribeLocalLibrary(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function localLibraryVersion(): number {
  return version;
}

function notify(): void {
  version += 1;
  for (const listener of listeners) {
    try {
      listener();
    } catch {
      /* a throwing subscriber must not break the write */
    }
  }
}

/* -------------------------------- storage -------------------------------- */

/** Keeps only the fields a row renders, so the quota is not burned on extras. */
function slim(track: EchoTrack): EchoTrack {
  return {
    id: track.id,
    title: track.title,
    artist: track.artist,
    album: track.album,
    durationMs: track.durationMs,
    genre: track.genre,
    year: track.year ?? null,
    releaseDate: track.releaseDate ?? null,
    colors: track.colors,
    artSeed: track.artSeed,
    imageUrl: track.imageUrl ?? null,
    imageLargeUrl: track.imageLargeUrl ?? null,
    uri: track.uri,
    artistIds: track.artistIds,
    artistList: track.artistList,
    albumGenres: track.albumGenres,
    explicit: track.explicit,
    bpm: track.bpm ?? null,
    musicalKey: track.musicalKey ?? null,
    energy: track.energy ?? null,
    danceability: track.danceability ?? null,
    valence: track.valence ?? null,
    addedAt: track.addedAt ?? null,
  };
}

function read(key: string, legacyKey?: string): Envelope | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(key);
    // Absent under the current key: try the legacy one and migrate it forward.
    if (!raw) return migrate(key, legacyKey);
    const parsed = JSON.parse(raw) as Envelope;
    if (!parsed || !Array.isArray(parsed.tracks)) return migrate(key, legacyKey);
    return { hydratedAt: parsed.hydratedAt ?? 0, tracks: parsed.tracks };
  } catch {
    return migrate(key, legacyKey);
  }
}

/** One-time move from the previous key so an existing library is not lost. */
function migrate(key: string, legacyKey?: string): Envelope | null {
  if (!legacyKey || typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(legacyKey);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Envelope;
    if (!parsed || !Array.isArray(parsed.tracks)) return null;
    const envelope = { hydratedAt: parsed.hydratedAt ?? Date.now(), tracks: parsed.tracks };
    window.localStorage.setItem(key, JSON.stringify(envelope));
    window.localStorage.removeItem(legacyKey);
    return envelope;
  } catch {
    return null;
  }
}

function write(key: string, envelope: Envelope): boolean {
  if (typeof window === "undefined") return false;
  try {
    window.localStorage.setItem(key, JSON.stringify(envelope));
    return true;
  } catch {
    // Quota or private mode: drop the oldest half and try once more.
    try {
      const halved: Envelope = { ...envelope, tracks: envelope.tracks.slice(0, Math.ceil(envelope.tracks.length / 2)) };
      window.localStorage.setItem(key, JSON.stringify(halved));
      return true;
    } catch {
      return false;
    }
  }
}

function dedupe(tracks: EchoTrack[], limit: number): EchoTrack[] {
  const seen = new Set<string>();
  const out: EchoTrack[] = [];
  for (const track of tracks) {
    if (!track?.id || seen.has(track.id)) continue;
    seen.add(track.id);
    out.push(slim(track));
    if (out.length >= limit) break;
  }
  return out;
}

/* --------------------------- listening history --------------------------- */

export function readRecent(): EchoTrack[] {
  return read(RECENT_KEY)?.tracks ?? [];
}

export function isRecentHydrated(): boolean {
  const envelope = read(RECENT_KEY);
  return Boolean(envelope && envelope.hydratedAt > 0);
}

/** Stores a freshly fetched history and marks the store hydrated. */
export function writeRecent(tracks: EchoTrack[]): void {
  const next = dedupe(tracks, RECENT_LIMIT);
  write(RECENT_KEY, { hydratedAt: Date.now(), tracks: next });
  notify();
}

/** A track started playing: prepend it, keeping the list deduped and capped. */
export function prependRecent(track: EchoTrack | null | undefined): void {
  if (!track?.id) return;
  const existing = read(RECENT_KEY);
  const tracks = dedupe([track, ...(existing?.tracks ?? [])], RECENT_LIMIT);
  write(RECENT_KEY, { hydratedAt: existing?.hydratedAt || Date.now(), tracks });
  notify();
}

/* ------------------------------ saved tracks ----------------------------- */

export function readSaved(): EchoTrack[] {
  return read(SAVED_KEY, LEGACY_SAVED_KEY)?.tracks ?? [];
}

export function isSavedHydrated(): boolean {
  const envelope = read(SAVED_KEY, LEGACY_SAVED_KEY);
  return Boolean(envelope && envelope.hydratedAt > 0);
}

export function writeSaved(tracks: EchoTrack[]): void {
  const next = dedupe(tracks, SAVED_LIMIT).map((t) => ({ ...t, saved: true }));
  write(SAVED_KEY, { hydratedAt: Date.now(), tracks: next });
  notify();
}

/**
 * Like/unlike while Echoes is running: updates the store and notifies
 * subscribers immediately, so the Saved view and every heart icon move without
 * a reload or a refetch.
 */
export function setSavedLocal(track: EchoTrack, saved: boolean): void {
  const existing = read(SAVED_KEY, LEGACY_SAVED_KEY);
  const tracks = existing?.tracks ?? [];
  const next = saved
    ? dedupe([{ ...track, saved: true }, ...tracks], SAVED_LIMIT)
    : tracks.filter((t) => t.id !== track.id);
  write(SAVED_KEY, { hydratedAt: existing?.hydratedAt || Date.now(), tracks: next });
  notify();
}

/** Keeps cached rows in step with refreshed metadata (artwork, BPM…). */
export function patchStoredTracks(updates: EchoTrack[]): void {
  if (!updates.length) return;
  const byId = new Map(updates.map((t) => [t.id, t]));
  let changed = false;

  for (const key of [RECENT_KEY, SAVED_KEY] as const) {
    const envelope = read(key);
    if (!envelope) continue;
    const tracks = envelope.tracks.map((track) => {
      const update = byId.get(track.id);
      if (!update) return track;
      changed = true;
      return slim({ ...track, ...update, saved: track.saved });
    });
    if (changed) write(key, { hydratedAt: envelope.hydratedAt, tracks });
  }
  if (changed) notify();
}

/** Signs out / demo switch: clear both stores so the next load re-hydrates. */
export function clearLocalLibrary(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(RECENT_KEY);
    window.localStorage.removeItem(SAVED_KEY);
  } catch {
    /* nothing to clear */
  }
  notify();
}

export const LOCAL_LIBRARY_KEYS = {
  recent: RECENT_KEY,
  saved: SAVED_KEY,
  legacySaved: LEGACY_SAVED_KEY,
};
