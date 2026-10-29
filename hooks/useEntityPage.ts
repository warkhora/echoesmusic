"use client";

import { useEffect, useState } from "react";
import { safeJson } from "@/lib/http";
import { adoptTokenHeaders } from "@/lib/spotify/sessionClient";
import { useSession } from "@/state/nav";

/**
 * Client cache for album and artist pages.
 *
 * Navigating back to an entity you have already opened must cost zero requests,
 * so results live in a module Map for the life of the tab (the server keeps its
 * own 30-minute cache underneath).
 */
export interface AlbumPageData {
  id: string;
  name: string;
  artist: string;
  artistId: string | null;
  type: string;
  releaseDate: string | null;
  year: number | null;
  totalTracks: number;
  genres: string[];
  imageUrl: string | null;
  imageLargeUrl: string | null;
  colors: [string, string, string];
  uri: string;
  tracks: import("@/lib/types").EchoTrack[];
}

export interface ArtistPageData {
  id: string;
  name: string;
  bio: string;
  genres: string[];
  listeners: number;
  imageUrl: string | null;
  imageLargeUrl: string | null;
  externalUrl: string | null;
  colors: [string, string, string];
  uri: string | null;
  /** Newest/popular tracks assembled from the artist's own releases. */
  popularTracks: import("@/lib/types").EchoTrack[];
  /** `appears_on` collaborations that actually credit this artist. */
  appearsOn: import("@/lib/types").EchoTrack[];
  albums: import("@/lib/types").EchoPlaylist[];
  degraded?: string[];
}

const albumCache = new Map<string, AlbumPageData>();
const artistCache = new Map<string, ArtistPageData>();

export function peekAlbum(id: string): AlbumPageData | undefined {
  return albumCache.get(id);
}
export function peekArtist(id: string): ArtistPageData | undefined {
  return artistCache.get(id);
}

interface State<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
}

async function getJSON<T>(path: string, token: string | null): Promise<T | null> {
  const res = await fetch(path, {
    headers: token ? { authorization: `Bearer ${token}` } : undefined,
    cache: "no-store",
  });
  adoptTokenHeaders(res);
  if (!res.ok) {
    const body = await safeJson<{ message?: string; error?: string }>(res);
    throw new Error(body?.message ?? body?.error ?? `request failed (${res.status})`);
  }
  return safeJson<T>(res);
}

/** Album page: cache first, then one request. Never re-fetches a known id. */
export function useAlbumPage(albumId: string | null): State<AlbumPageData> {
  const auth = useSession();
  const token = auth.session?.accessToken ?? null;
  const [state, setState] = useState<State<AlbumPageData>>(() => ({
    data: albumId ? (albumCache.get(albumId) ?? null) : null,
    loading: Boolean(albumId) && !albumCache.has(albumId ?? ""),
    error: null,
  }));

  /* eslint-disable react-hooks/set-state-in-effect -- id-keyed, idempotent cache writes */
  useEffect(() => {
    if (!albumId) return;
    const cached = albumCache.get(albumId);
    if (cached) {
      setState({ data: cached, loading: false, error: null });
      return;
    }
    if (!token) return;

    let alive = true;
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 15000);
    setState({ data: null, loading: true, error: null });

    void getJSON<{ album?: AlbumPageData | null }>(
      `/api/spotify/album?id=${encodeURIComponent(albumId)}`,
      token,
    )
      .then((payload) => {
        window.clearTimeout(timeout);
        if (!alive) return;
        if (payload?.album) {
          albumCache.set(albumId, payload.album);
          setState({ data: payload.album, loading: false, error: null });
        } else {
          setState({ data: null, loading: false, error: "This album could not be loaded." });
        }
      })
      .catch((error: unknown) => {
        window.clearTimeout(timeout);
        if (!alive || controller.signal.aborted) return;
        const message = error instanceof Error ? error.message : "Unknown error";
        console.warn(`[echoes] album ${albumId} unavailable: ${message}`);
        setState({ data: null, loading: false, error: message });
      });

    return () => {
      alive = false;
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [albumId, token]);

  return state;
}

/** Artist page: cache first, then one request. */
export function useArtistPage(artistId: string | null): State<ArtistPageData> {
  const auth = useSession();
  const token = auth.session?.accessToken ?? null;
  const [state, setState] = useState<State<ArtistPageData>>(() => ({
    data: artistId ? (artistCache.get(artistId) ?? null) : null,
    loading: Boolean(artistId) && !artistCache.has(artistId ?? ""),
    error: null,
  }));

  /* eslint-disable react-hooks/set-state-in-effect -- id-keyed, idempotent cache writes */
  useEffect(() => {
    if (!artistId) return;
    const cached = artistCache.get(artistId);
    if (cached) {
      setState({ data: cached, loading: false, error: null });
      return;
    }
    if (!token) return;

    let alive = true;
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 15000);
    setState({ data: null, loading: true, error: null });

    void getJSON<{ artist?: ArtistPageData | null }>(
      `/api/spotify/artist-page?id=${encodeURIComponent(artistId)}`,
      token,
    )
      .then((payload) => {
        window.clearTimeout(timeout);
        if (!alive) return;
        if (payload?.artist) {
          artistCache.set(artistId, payload.artist);
          setState({ data: payload.artist, loading: false, error: null });
        } else {
          setState({ data: null, loading: false, error: "This artist could not be loaded." });
        }
      })
      .catch((error: unknown) => {
        window.clearTimeout(timeout);
        if (!alive || controller.signal.aborted) return;
        const message = error instanceof Error ? error.message : "Unknown error";
        console.warn(`[echoes] artist ${artistId} unavailable: ${message}`);
        setState({ data: null, loading: false, error: message });
      });

    return () => {
      alive = false;
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [artistId, token]);

  return state;
}
