"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { cachedBpm, featuresUnavailable, getCachedFeatures } from "@/lib/spotify/audioFeatures";
import { artistDetailCache, metadataVersion, subscribeMetadata } from "@/lib/spotify/detailCache";
import type { EchoArtist, EchoTrack } from "@/lib/types";

/**
 * Track-table column visibility.
 *
 * Choices live in `localStorage` and persist across sessions. Every value
 * resolver is **cache-only** — rendering a column must never trigger a network
 * request, which is how the 429s started in the first place.
 */

export type ColumnId = "time" | "genre" | "album" | "releaseDate" | "bpm";

export interface ColumnDef {
  id: ColumnId;
  label: string;
  hint: string;
  /** Tailwind classes for the cell, shared by the header and the row. */
  cell: string;
  align?: "left" | "right" | "center";
}

export const OPTIONAL_COLUMNS: ColumnDef[] = [
  { id: "time", label: "Time", hint: "Track duration", cell: "w-11 shrink-0 text-right", align: "right" },
  { id: "genre", label: "Genre", hint: "Primary artist genre", cell: "hidden w-[92px] shrink-0 lg:block" },
  { id: "album", label: "Album", hint: "Album name", cell: "hidden w-[190px] shrink-0 md:block" },
  { id: "releaseDate", label: "Release Date", hint: "Year from album.release_date", cell: "hidden w-[62px] shrink-0 text-center xl:block" },
  { id: "bpm", label: "BPM", hint: "Tempo, from cache only", cell: "hidden w-[74px] shrink-0 text-right xl:block" },
];

/** Fixed columns — rendered always, and shown as locked in the menu. */
export const FIXED_COLUMNS = [
  { label: "Covers", hint: "Artwork is always shown" },
  { label: "Song Title", hint: "Always shown" },
  { label: "Artists", hint: "Always shown" },
];

const LS_KEY = "echoes.table.columns.v1";
const DEFAULT_VISIBLE: ColumnId[] = ["time", "album", "bpm"];

function readStored(): ColumnId[] {
  if (typeof window === "undefined") return DEFAULT_VISIBLE;
  try {
    const raw = window.localStorage.getItem(LS_KEY);
    if (!raw) return DEFAULT_VISIBLE;
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return DEFAULT_VISIBLE;
    const known = new Set(OPTIONAL_COLUMNS.map((c) => c.id));
    const visible = parsed.filter((id): id is ColumnId => typeof id === "string" && known.has(id as ColumnId));
    // An empty selection is legitimate (title/artists/cover only).
    return visible;
  } catch {
    return DEFAULT_VISIBLE;
  }
}

interface ColumnsContextValue {
  visible: ColumnId[];
  isVisible: (id: ColumnId) => boolean;
  toggle: (id: ColumnId) => void;
  reset: () => void;
}

const ColumnsContext = createContext<ColumnsContextValue | null>(null);

export function ColumnsProvider({ children }: { children: ReactNode }) {
  /**
   * Defaults on the first render so the server and client agree (the column set
   * changes which cells exist, so a stored value read during render was a
   * hydration mismatch), then the stored selection is applied after mount.
   */
  const [visible, setVisible] = useState<ColumnId[]>(DEFAULT_VISIBLE);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time, idempotent post-mount hydration
    setVisible(readStored());
  }, []);

  const persist = useCallback((next: ColumnId[]) => {
    setVisible(next);
    try {
      window.localStorage.setItem(LS_KEY, JSON.stringify(next));
    } catch {
      /* private mode — the choice still applies for this session */
    }
  }, []);

  const value = useMemo<ColumnsContextValue>(
    () => ({
      visible,
      isVisible: (id) => visible.includes(id),
      toggle: (id) => {
        const next = new Set(visible);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        // Re-emit in canonical order so the table never reshuffles itself.
        persist(OPTIONAL_COLUMNS.map((c) => c.id).filter((c) => next.has(c)));
      },
      reset: () => persist(DEFAULT_VISIBLE),
    }),
    [visible, persist],
  );

  return <ColumnsContext.Provider value={value}>{children}</ColumnsContext.Provider>;
}

export function useColumns(): ColumnsContextValue {
  const ctx = useContext(ColumnsContext);
  if (!ctx) throw new Error("useColumns must be used inside <ColumnsProvider>");
  return ctx;
}

/* -------------------------------------------------------------------------- */
/*  Cache-only value resolvers — no resolver may touch the network             */
/* -------------------------------------------------------------------------- */

const DASH = "-";

/** `album.release_date.slice(0, 4)` → "2023", with `track.year` as a fallback. */
export function resolveReleaseYear(track: EchoTrack): string {
  const raw = track.releaseDate;
  if (raw && raw.length >= 4) return raw.slice(0, 4);
  if (track.year) return String(track.year);
  return DASH;
}

/**
 * Genre: the primary artist's cached `genres[0]`, then the catalog artist card,
 * then whatever the track itself carried — never a fetch.
 */
/** "downtempo" → "Downtempo", "ambient house" → "Ambient House". */
export function titleCaseGenre(genre: string): string {
  return genre
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

/**
 * Genre, in priority order — every step is a cache or payload read, never a
 * request:
 *   artistCache.get(artistId)?.genres[0]
 *     → catalog artist genres[0]
 *     → track.album?.genres?.[0]
 *     → track.genre
 *     → "-"
 */
export function resolveGenre(track: EchoTrack, catalogArtists?: EchoArtist[]): string {
  const artistId = track.artistIds?.[0];

  if (artistId) {
    const fromDetail = artistDetailCache.get(artistId)?.genres?.[0];
    if (fromDetail) return titleCaseGenre(fromDetail);
  }

  const primaryName = track.artistList?.[0]?.name ?? track.artist?.split(",")[0]?.trim();
  if (primaryName && catalogArtists?.length) {
    const match =
      (artistId ? catalogArtists.find((a) => a.id === artistId) : undefined) ??
      catalogArtists.find((a) => a.name === primaryName);
    // Only a real genre list — never `bio`, which is free prose for locally
    // seeded artists and would render a whole sentence in a narrow column.
    const fromCatalog = match?.genres?.[0];
    if (fromCatalog) return titleCaseGenre(fromCatalog);
  }

  const fromAlbum = track.albumGenres?.[0];
  if (fromAlbum) return titleCaseGenre(fromAlbum);

  return track.genre?.trim() ? titleCaseGenre(track.genre) : DASH;
}

/**
 * Tempo from cache only — never a request. Checks the track object first (the
 * server already merged features into library/playlist payloads), then the
 * global batched-features cache.
 */
export function resolveBpm(track: EchoTrack): string {
  const bpm = track.bpm ?? cachedBpm(track.id);
  return bpm ? String(bpm) : DASH;
}

export interface BpmCell {
  /** What the cell renders. */
  label: string;
  /** `bpm` is real data; `fallback` means audio features are unavailable. */
  kind: "bpm" | "fallback" | "dash";
  title: string;
}

/**
 * When Spotify withholds audio features (403 for most apps created after
 * Nov 2024, or `null` per id) the BPM column degrades to something truthful and
 * useful — the release year — instead of a bare dash. These are pure functions
 * of props and the cache, so the degraded path cannot leave a row stuck.
 */
export function resolveBpmCell(track: EchoTrack): BpmCell {
  const bpm = track.bpm ?? cachedBpm(track.id);
  if (bpm) {
    return { label: `${bpm}`, kind: "bpm", title: `${bpm} BPM` };
  }
  const year = resolveReleaseYear(track);
  if (year !== DASH) {
    return {
      label: year,
      kind: "fallback",
      title: featuresUnavailable()
        ? "Audio features are unavailable to this Spotify app — showing the release year instead"
        : "No tempo cached for this track — showing the release year instead",
    };
  }
  return {
    label: DASH,
    kind: "dash",
    title: featuresUnavailable()
      ? "Audio features are unavailable to this Spotify app"
      : "No tempo or release date available",
  };
}

/** Full cached feature set for a track, for tooltips. */
export function resolveFeatures(track: EchoTrack) {
  const cached = getCachedFeatures(track.id);
  return {
    bpm: track.bpm ?? cached?.bpm ?? null,
    musicalKey: track.musicalKey ?? cached?.musicalKey ?? null,
    energy: track.energy ?? cached?.energy ?? null,
    danceability: track.danceability ?? cached?.danceability ?? null,
  };
}

/**
 * Re-renders a component whenever the artist or audio-feature caches are
 * written, so a genre or BPM that arrives *after* the table painted replaces
 * its "-" placeholder without any polling or refetch.
 */
export function useMetadataVersion(): number {
  return useSyncExternalStore(subscribeMetadata, metadataVersion, () => 0);
}

export function resolveDuration(track: EchoTrack): string {
  return track.durationMs > 0 ? formatClock(track.durationMs) : DASH;
}

function formatClock(ms: number): string {
  const total = Math.floor(ms / 1000);
  return `${Math.floor(total / 60)}:${(total % 60).toString().padStart(2, "0")}`;
}
