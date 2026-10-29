"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { safeJson } from "@/lib/http";
import { artistDetailCache } from "@/lib/spotify/detailCache";
import { adoptTokenHeaders } from "@/lib/spotify/sessionClient";
import { buildTasteProfile, rankByTaste, type TrackScore } from "@/lib/taste";
import { readRecent, readSaved } from "@/lib/localLibrary";
import type { EchoTrack } from "@/lib/types";
import { useLibrary } from "@/state/library";
import { useSession } from "@/state/nav";

export const SEARCH_DEBOUNCE_MS = 300;
export const SEARCH_MIN_CHARS = 2;

export interface SearchHit {
  track: EchoTrack;
  score: TrackScore;
}

export interface SearchState {
  query: string;
  results: SearchHit[];
  loading: boolean;
  error: string | null;
  /** Spotify returned fewer than requested — a Development Mode app tier cap. */
  capped: boolean;
  search: (query: string) => void;
  clear: () => void;
}

/** Genres come from the memoised artist cache — never a request of their own. */
function genresForArtist(artistId: string): string[] | undefined {
  return artistDetailCache.get(artistId)?.genres;
}

/**
 * Debounced global search with taste-based ranking.
 *
 * One request per settled keystroke burst (300 ms, minimum 2 characters), and
 * results are ordered by how closely they match the listener's own history and
 * Saved Songs rather than by Spotify's default relevance alone.
 */
export function useSearch(limit = 5): SearchState {
  const { catalog } = useLibrary();
  const auth = useSession();
  const token = auth.session?.accessToken ?? null;

  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchHit[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [capped, setCapped] = useState(false);

  const requestId = useRef(0);
  const timer = useRef<number | null>(null);

  // Taste is rebuilt only when the underlying data changes, not per keystroke.
  const taste = useMemo(
    () =>
      buildTasteProfile({
        history: readRecent(),
        saved: readSaved(),
        catalogArtists: catalog.artists,
        genresForArtist,
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [catalog.artists, catalog.tracks],
  );

  const run = useCallback(
    async (term: string, wantLimit: number) => {
      if (!token) {
        setResults([]);
        return;
      }
      const id = ++requestId.current;
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(
          `/api/spotify/search?q=${encodeURIComponent(term)}&limit=${wantLimit}`,
          { headers: { authorization: `Bearer ${token}` }, cache: "no-store" },
        );
        adoptTokenHeaders(res);
        if (!res.ok) {
          const body = await safeJson<{ message?: string; error?: string }>(res);
          throw new Error(body?.message ?? body?.error ?? `search failed (${res.status})`);
        }
        const data = await safeJson<{ tracks?: EchoTrack[]; capped?: boolean }>(res);
        if (id !== requestId.current) return; // a newer query already landed
        const tracks = data?.tracks ?? [];
        setCapped(Boolean(data?.capped));
        setResults(rankByTaste(tracks, taste, genresForArtist).slice(0, wantLimit));
      } catch (err) {
        if (id !== requestId.current) return;
        console.info("[echoes] search unavailable", err instanceof Error ? err.message : err);
        setError(err instanceof Error ? err.message : "Search failed");
        setResults([]);
      } finally {
        if (id === requestId.current) setLoading(false);
      }
    },
    [token, taste],
  );

  const search = useCallback(
    (next: string) => {
      setQuery(next);
      if (timer.current) window.clearTimeout(timer.current);
      const term = next.trim();
      if (term.length < SEARCH_MIN_CHARS) {
        requestId.current += 1; // invalidate anything in flight
        setResults([]);
        setLoading(false);
        setError(null);
        return;
      }
      setLoading(true);
      timer.current = window.setTimeout(() => void run(term, limit), SEARCH_DEBOUNCE_MS);
    },
    [limit, run],
  );

  const clear = useCallback(() => {
    if (timer.current) window.clearTimeout(timer.current);
    requestId.current += 1;
    setQuery("");
    setResults([]);
    setLoading(false);
    setError(null);
  }, []);

  useEffect(
    () => () => {
      if (timer.current) window.clearTimeout(timer.current);
      requestId.current += 1;
    },
    [],
  );

  return { query, results, loading, error, capped, search, clear };
}
