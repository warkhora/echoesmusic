"use client";

import type { User } from "firebase/auth";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ensurePlaylistMeta,
  fetchCommunityPlaylists,
  fetchMyPlaylistMetas,
  publishPlaylist,
  setPlaylistVisibility,
  unpublishPlaylist,
  type EchoesPlaylistMeta,
} from "@/lib/echoesPlaylists";
import type { EchoPlaylist } from "@/lib/types";

export interface EchoesPlaylistsState {
  /** My privacy records, keyed by playlist id. */
  metas: Record<string, EchoesPlaylistMeta>;
  ready: boolean;
  setVisibility: (playlistId: string, isPublic: boolean) => Promise<boolean>;
  /** Registers privacy records (private by default) for playlists I own. */
  ensureMetas: (playlists: EchoPlaylist[], ownerName: string, ownerId: string | null) => void;
  community: EchoesPlaylistMeta[];
  communityLoading: boolean;
  loadCommunity: () => Promise<void>;
  /** True when a signed-in Firebase user exists (community requires it). */
  signedIn: boolean;
}

/**
 * Bridges the Firestore privacy records to the UI. Everything is a safe no-op
 * without a signed-in Firebase user, so demo mode never touches Firestore.
 */
export function useEchoesPlaylists(user: User | null): EchoesPlaylistsState {
  const uid = user?.uid ?? null;
  const [metas, setMetas] = useState<Record<string, EchoesPlaylistMeta>>({});
  const [loadedFor, setLoadedFor] = useState<string | null>(null);
  // Derived, never set in an effect: no signed-in user means there is nothing to load.
  const ready = !uid || loadedFor === uid;
  const [community, setCommunity] = useState<EchoesPlaylistMeta[]>([]);
  const [communityLoading, setCommunityLoading] = useState(false);
  const ensured = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!uid) return;
    let alive = true;
    void fetchMyPlaylistMetas(uid).then((next) => {
      if (!alive) return;
      setMetas(next);
      setLoadedFor(uid);
    });
    return () => {
      alive = false;
    };
  }, [uid]);

  const ensureMetas = useCallback(
    (playlists: EchoPlaylist[], ownerName: string, ownerId: string | null) => {
      if (!uid) return;
      const missing = playlists.filter(
        (playlist) => !metas[playlist.id] && !ensured.current.has(playlist.id),
      );
      if (!missing.length) return;
      missing.forEach((playlist) => ensured.current.add(playlist.id));
      void Promise.all(
        missing.slice(0, 50).map((playlist) =>
          ensurePlaylistMeta(uid, ownerName, {
            playlistId: playlist.id,
            name: playlist.name,
            description: playlist.description,
            source: "spotify",
            trackCount: playlist.trackCount ?? playlist.trackIds.length,
            colors: playlist.colors,
          }).then((ok) => {
            if (ok) {
              setMetas((prev) =>
                prev[playlist.id]
                  ? prev
                  : {
                      ...prev,
                      [playlist.id]: {
                        playlistId: playlist.id,
                        name: playlist.name,
                        description: playlist.description ?? "",
                        ownerUid: uid,
                        ownerName,
                        source: "spotify",
                        trackCount: playlist.trackCount ?? playlist.trackIds.length,
                        colors: playlist.colors,
                        isPublicInEchoes: false,
                        createdAt: Date.now(),
                        updatedAt: Date.now(),
                      },
                    },
              );
            }
          }),
        ),
      );
      void ownerId; // ownership is enforced by the caller before calling this
    },
    [uid, metas],
  );

  /**
   * Toggles Echoes visibility for one playlist.
   *
   * ON  → owner record flips to public AND a copy is written to
   *       /community_playlists/{id} with isPublicInEchoes: true.
   * OFF → the community document is deleted immediately and the local community
   *       list drops it in the same tick, so the community page updates at once.
   * Spotify's own public/private flag is never read or written.
   */
  const setVisibility = useCallback(
    async (playlistId: string, isPublic: boolean) => {
      if (!uid) return false;
      const existing = metas[playlistId];
      if (!existing) return false;

      // Optimistic local flip; rolled back if Firestore rejects the write.
      const applyLocal = (value: boolean) =>
        setMetas((prev) => {
          const cur = prev[playlistId];
          if (!cur) return prev;
          return { ...prev, [playlistId]: { ...cur, isPublicInEchoes: value, updatedAt: Date.now() } };
        });
      applyLocal(isPublic);

      const ownerWrite = await setPlaylistVisibility(uid, playlistId, isPublic);
      const communityWrite = isPublic
        ? await publishPlaylist(uid, existing)
        : await unpublishPlaylist(playlistId);

      if (isPublic && communityWrite) {
        setCommunity((prev) =>
          prev.some((m) => m.playlistId === playlistId)
            ? prev.map((m) => (m.playlistId === playlistId ? { ...existing, isPublicInEchoes: true } : m))
            : [{ ...existing, isPublicInEchoes: true }, ...prev],
        );
      } else if (!isPublic) {
        setCommunity((prev) => prev.filter((m) => m.playlistId !== playlistId));
      }

      const ok = ownerWrite && communityWrite;
      if (!ok) applyLocal(!isPublic);
      return ok;
    },
    [uid, metas],
  );

  const loadCommunity = useCallback(async () => {
    setCommunityLoading(true);
    const list = await fetchCommunityPlaylists();
    setCommunity(list);
    setCommunityLoading(false);
  }, []);

  return useMemo(
    () => ({
      metas,
      ready,
      setVisibility,
      ensureMetas,
      community,
      communityLoading,
      loadCommunity,
      signedIn: Boolean(uid),
    }),
    [metas, ready, setVisibility, ensureMetas, community, communityLoading, loadCommunity, uid],
  );
}
