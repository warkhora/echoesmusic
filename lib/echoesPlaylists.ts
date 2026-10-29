import {
  collection,
  deleteDoc,
  doc,
  getDocs,
  query,
  setDoc,
  where,
  type Firestore,
} from "firebase/firestore";
import { firebaseDb } from "@/lib/firebase";
import type { Triad } from "@/lib/types";

/**
 * Echoes playlist privacy.
 *
 * Every playlist that exists inside Echoes (Spotify-imported or locally
 * created) gets a privacy record at `users/{uid}/playlists/{playlistId}`:
 *
 *   { playlistId, name, description, ownerUid, ownerName, source, trackCount,
 *     colors, isPublicInEchoes: false, createdAt, updatedAt }
 *
 * `isPublicInEchoes` is **independent of Spotify's own public/private flag** and
 * defaults to **false (private)**. Only this field is ever published; track
 * lists never leave the owner's document tree, and the Firestore rules only
 * allow non-owners to read documents whose `isPublicInEchoes == true`.
 */

export interface EchoesPlaylistMeta {
  playlistId: string;
  name: string;
  description: string;
  ownerUid: string;
  ownerName: string;
  source: "spotify" | "echoes";
  trackCount: number;
  colors: Triad;
  isPublicInEchoes: boolean;
  createdAt: number;
  updatedAt: number;
}

const DEFAULT_COLORS: Triad = ["#4c3bd4", "#8b5cf6", "#d946a8"];

function metaRef(db: Firestore, uid: string, playlistId: string) {
  return doc(db, "users", uid, "playlists", playlistId);
}

/** Creates the record if missing (private by default), otherwise merges. */
export async function ensurePlaylistMeta(
  uid: string,
  ownerName: string,
  input: {
    playlistId: string;
    name: string;
    description?: string;
    source?: "spotify" | "echoes";
    trackCount?: number;
    colors?: Triad;
  },
): Promise<boolean> {
  const db = await firebaseDb();
  if (!db) return false;
  try {
    await setDoc(
      metaRef(db, uid, input.playlistId),
      {
        playlistId: input.playlistId,
        name: input.name,
        description: input.description ?? "",
        ownerUid: uid,
        ownerName,
        source: input.source ?? "spotify",
        trackCount: input.trackCount ?? 0,
        colors: input.colors ?? DEFAULT_COLORS,
        // Independent of Spotify's own visibility; private by default.
        isPublicInEchoes: false,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      },
      { merge: true },
    );
    return true;
  } catch (error) {
    console.warn("[echoes] playlist meta write skipped:", (error as { code?: string }).code ?? error);
    return false;
  }
}

/** Toggles the Echoes-only visibility flag for one playlist. */
export async function setPlaylistVisibility(
  uid: string,
  playlistId: string,
  isPublicInEchoes: boolean,
): Promise<boolean> {
  const db = await firebaseDb();
  if (!db) return false;
  try {
    await setDoc(
      metaRef(db, uid, playlistId),
      { isPublicInEchoes, updatedAt: Date.now() },
      { merge: true },
    );
    return true;
  } catch (error) {
    console.warn("[echoes] visibility update skipped:", (error as { code?: string }).code ?? error);
    return false;
  }
}

/** All of my privacy records, keyed by playlist id. */
export async function fetchMyPlaylistMetas(
  uid: string,
): Promise<Record<string, EchoesPlaylistMeta>> {
  const db = await firebaseDb();
  if (!db) return {};
  try {
    const snapshot = await getDocs(collection(db, "users", uid, "playlists"));
    const out: Record<string, EchoesPlaylistMeta> = {};
    snapshot.forEach((docSnap) => {
      const data = docSnap.data() as EchoesPlaylistMeta;
      if (data?.playlistId) out[data.playlistId] = { ...data, isPublicInEchoes: Boolean(data.isPublicInEchoes) };
    });
    return out;
  } catch (error) {
    console.warn("[echoes] playlist metas unavailable:", (error as { code?: string }).code ?? error);
    return {};
  }
}

/**
 * Publishes a playlist to the dedicated community collection. This is a COPY:
 * the owner's private record at users/{uid}/playlists/{id} is untouched except
 * for its own isPublicInEchoes flag, so Spotify visibility stays irrelevant.
 */
export async function publishPlaylist(
  uid: string,
  meta: Omit<EchoesPlaylistMeta, "isPublicInEchoes" | "ownerUid"> & Partial<EchoesPlaylistMeta>,
): Promise<boolean> {
  const db = await firebaseDb();
  if (!db) return false;
  try {
    await setDoc(doc(db, "community_playlists", meta.playlistId), {
      ...meta,
      ownerUid: uid,
      isPublicInEchoes: true,
      updatedAt: Date.now(),
    });
    return true;
  } catch (error) {
    console.warn("[echoes] publish skipped:", (error as { code?: string }).code ?? error);
    return false;
  }
}

/** Removes a playlist from the community collection immediately. */
export async function unpublishPlaylist(playlistId: string): Promise<boolean> {
  const db = await firebaseDb();
  if (!db) return false;
  try {
    await deleteDoc(doc(db, "community_playlists", playlistId));
    return true;
  } catch (error) {
    console.warn("[echoes] unpublish skipped:", (error as { code?: string }).code ?? error);
    return false;
  }
}

/**
 * Every published Echoes playlist, from the dedicated community collection and
 * strictly where isPublicInEchoes == true. The owner's own entries are included
 * (they may want to see what they've shared); the page labels them as yours.
 */
export async function fetchCommunityPlaylists(): Promise<EchoesPlaylistMeta[]> {
  const db = await firebaseDb();
  if (!db) return [];
  try {
    const snapshot = await getDocs(
      query(collection(db, "community_playlists"), where("isPublicInEchoes", "==", true)),
    );
    const out: EchoesPlaylistMeta[] = [];
    snapshot.forEach((docSnap) => {
      const data = docSnap.data() as EchoesPlaylistMeta;
      if (!data?.playlistId) return;
      if (data.isPublicInEchoes !== true) return; // belt and braces
      out.push(data);
    });
    return out.sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
  } catch (error) {
    console.warn("[echoes] community playlists unavailable:", (error as { code?: string }).code ?? error);
    return [];
  }
}
