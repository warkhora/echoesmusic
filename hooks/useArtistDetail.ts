"use client";

import { useEffect, useRef, useState } from "react";
import { artistDetailCache, loadArtistDetail, rememberArtist } from "@/lib/spotify/detailCache";
import type { EchoArtist } from "@/lib/types";

const REQUEST_TIMEOUT_MS = 8000;

export interface ArtistDetail {
  artist: EchoArtist | null;
  loading: boolean;
}

/**
 * Artist detail for the Now Playing panel.
 *
 * Contract, exactly as the panel needs it:
 *
 *   1. When `currentTrack.artists[0].id` changes, look the id up in the cache.
 *   2. On a hit, **call `setArtistData(cached)`** — reading a module-level Map
 *      during render is not reactive, so a value that resolved while this
 *      component was busy would otherwise never reach the screen. That was the
 *      "only the first track shows artwork" bug.
 *   3. On a miss, fetch `GET /v1/artists/{id}` once, store it in the cache, then
 *      `setArtistData(fetched)`.
 *
 * The effect depends on the id alone. The token is read through a ref, so a
 * refresh, a progress tick or a play/pause toggle can never trigger a request,
 * and a previously played artist costs zero network calls.
 */
export function useArtistDetail(
  artistId: string | null,
  token: string | null,
  fallback?: EchoArtist | null,
): ArtistDetail {
  const tokenRef = useRef(token);
  /** Per-consumer mirror of the shared cache — the map the panel asks about. */
  const artistCacheRef = useRef<Map<string, EchoArtist>>(new Map());
  const [artistData, setArtistData] = useState<EchoArtist | null>(() =>
    artistId ? (artistDetailCache.get(artistId) ?? null) : null,
  );
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    tokenRef.current = token;
  }, [token]);

  /*
   * Every state write below is keyed on the artist id and is idempotent — React
   * bails out when the reference is unchanged, so none of them can cascade.
   * Writing state on an id change is the whole point of this hook: deriving the
   * value during render is not reactive to a cache entry that resolved while
   * this consumer was stale, which is how the panel came to show only the first
   * track's artist.
   */
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    const id = artistId;

    // No artist (nothing playing, or demo metadata without Spotify ids).
    if (!id) {
      setArtistData(null);
      setLoading(false);
      return;
    }

    // ---- 1 & 2. cache hit → set state explicitly so the panel re-renders ----
    const cached = artistCacheRef.current.get(id) ?? artistDetailCache.get(id);
    if (cached) {
      artistCacheRef.current.set(id, cached);
      setArtistData(cached);
      setLoading(false);
      return;
    }

    // A rate-limited or previously failed id: stop here, keep the last artwork.
    if (artistDetailCache.isSettled(id)) {
      setLoading(false);
      return;
    }

    // ---- 3. miss → fetch once, store, then set state ----
    // Clear the previous artist first: showing artist A's photo over artist B's
    // track would be worse than a neutral placeholder.
    setArtistData(null);
    setLoading(true);

    let alive = true;
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    void loadArtistDetail(id, tokenRef.current, controller.signal).then((resolved) => {
      window.clearTimeout(timeout);

      // Always populate the cache, even if this consumer has moved on — the next
      // track that lands on this artist must be a cache hit, not a request.
      if (resolved) {
        artistCacheRef.current.set(id, resolved);
        rememberArtist(id, resolved);
      }

      if (!alive) return;
      setLoading(false);
      // A miss keeps the previous artist on screen rather than blanking the card.
      if (resolved) setArtistData(resolved);
    });

    return () => {
      alive = false;
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [artistId]);
  /* eslint-enable react-hooks/set-state-in-effect */

  // The demo catalog has no Spotify ids; its artist card is the fallback.
  const artist = artistData ?? (artistId ? null : fallback ?? null);

  return { artist, loading };
}
