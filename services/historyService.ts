import {
  collection,
  doc,
  limit,
  onSnapshot,
  orderBy,
  query,
  setDoc,
  type Firestore,
  type Unsubscribe,
} from "firebase/firestore";
import { firebaseDb } from "@/lib/firebase";
import { PLAY_CREDIT_SECONDS } from "@/services/activityMetrics";
import type { EchoTrack } from "@/lib/types";

/**
 * History logging service — fully self-contained.
 *
 * Owns every Firestore interaction for listening history so the Activity page
 * and the logger never touch the SDK directly. Every database call is wrapped
 * in a non-blocking try/catch and returns a safe value, so a write or listener
 * failure can never crash the UI or interrupt playback.
 */

export interface HistoryTrackData {
  trackId: string;
  title: string;
  artist: string;
  albumArt?: string | null;
  genre?: string;
  totalDurationSeconds: number;
  source?: "spotify" | "echoes";
}


/** Seconds of real listening that count as one "play". */

export type PeriodId = "24h" | "7d" | "30d" | "all";

export const PERIODS: { id: PeriodId; label: string; ms: number | null }[] = [
  { id: "24h", label: "Last 24 Hours", ms: 24 * 3600_000 },
  { id: "7d", label: "Last 7 Days", ms: 7 * 24 * 3600_000 },
  { id: "30d", label: "Last 30 Days", ms: 30 * 24 * 3600_000 },
  { id: "all", label: "All Time", ms: null },
];

export function periodCutoff(period: PeriodId): number | null {
  return PERIODS.find((p) => p.id === period)?.ms ?? null;
}

export function historyEntryId(trackId: string, startedAt: number): string {
  return `${trackId}_${startedAt}`;
}

function clampPct(played: number, total: number): number {
  if (!total || total <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round((played / total) * 100)));
}

function buildEntry(
  _userId: string,
  track: HistoryTrackData,
  startedAt: number,
  playedSeconds: number,
): HistoryEntry {
  const total = Math.max(1, Math.round(track.totalDurationSeconds || 0));
  const played = Math.max(0, Math.min(total, Math.round(playedSeconds || 0)));
  return {
    id: track.trackId,
    trackId: track.trackId,
    title: track.title || "Unknown track",
    artist: track.artist || "Unknown artist",
    albumArt: track.albumArt ?? null,
    genre: track.genre ?? "",
    timestamp: startedAt,
    firstPlayedAt: startedAt,
    lastPlayedAt: Date.now(),
    durationPlayedSeconds: played,
    totalDurationSeconds: total,
    completionPercentage: clampPct(played, total),
    playCount: Math.floor(played / PLAY_CREDIT_SECONDS),
    source: track.source ?? "echoes",
    updatedAt: Date.now(),
  };
}

/**
 * Writes the SINGLE per-track history document with absolute accumulated values.
 * Fire-and-forget: never throws, never blocks the caller, never affects playback.
 */
export async function writeHistorySession(
  userId: string | null,
  trackData: HistoryTrackData | null,
  session: {
    basePlaytimeSeconds: number;
    basePlayCount: number;
    firstPlayedAt: number;
    accumulatedSeconds: number;
    positionSeconds: number;
    source?: "spotify" | "echoes";
  },
): Promise<boolean> {
  if (!userId || !trackData?.trackId) return false;
  try {
    const db: Firestore | null = await firebaseDb();
    if (!db) return false;
    const total = Math.max(1, Math.round(trackData.totalDurationSeconds || 0));
    const playtime = Math.max(0, Math.round(session.basePlaytimeSeconds + session.accumulatedSeconds));
    const entry: HistoryEntry = {
      id: trackData.trackId,
      trackId: trackData.trackId,
      title: trackData.title || "Unknown track",
      artist: trackData.artist || "Unknown artist",
      albumArt: trackData.albumArt ?? null,
      genre: trackData.genre ?? "",
      timestamp: Date.now(),
      firstPlayedAt: session.firstPlayedAt,
      lastPlayedAt: Date.now(),
      durationPlayedSeconds: playtime,
      totalDurationSeconds: total,
      completionPercentage: Math.max(0, Math.min(100, Math.round((session.positionSeconds / total) * 100))),
      playCount: Math.floor(playtime / PLAY_CREDIT_SECONDS),
      source: session.source ?? "echoes",
      updatedAt: Date.now(),
    };
    await setDoc(doc(db, "users", userId, "history", entry.id), entry, { merge: true });
    return true;
  } catch (error) {
    console.info("[echoes] history write skipped:", (error as { code?: string })?.code ?? error);
    return false;
  }
}

/**
 * Write (or update) one play-session document. Fire-and-forget: never throws,
 * never blocks the caller, never affects playback.
 */
export async function logTrackPlayback(
  userId: string | null,
  trackData: HistoryTrackData | null,
  options: { startedAt?: number; playedSeconds?: number } = {},
): Promise<boolean> {
  if (!userId || !trackData?.trackId) return false;
  try {
    const db: Firestore | null = await firebaseDb();
    if (!db) return false;
    const startedAt = options.startedAt ?? Date.now();
    const entry = buildEntry(userId, trackData, startedAt, options.playedSeconds ?? 0);
    await setDoc(doc(db, "users", userId, "history", entry.id), entry, { merge: true });
    return true;
  } catch (error) {
    console.info("[echoes] history write skipped:", (error as { code?: string })?.code ?? error);
    return false;
  }
}

/**
 * Live feed listener over `/users/{uid}/history` ordered by timestamp desc.
 * Returns an unsubscribe function; any listener error is reported via onError
 * and never thrown.
 */
export function subscribeHistory(
  userId: string | null,
  onData: (entries: HistoryEntry[]) => void,
  onError?: (message: string) => void,
): Unsubscribe {
  if (!userId) {
    onData([]);
    return () => undefined;
  }
  let unsubscribe: Unsubscribe | null = null;
  let alive = true;

  void (async () => {
    try {
      const db = await firebaseDb();
      if (!db || !alive) return;
      const q = query(
        collection(db, "users", userId, "history"),
        orderBy("timestamp", "desc"),
        limit(150),
      );
      unsubscribe = onSnapshot(
        q,
        (snapshot) => {
          if (!alive) return;
          try {
            const entries = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }) as HistoryEntry);
            entries.sort((a, b) => (b.timestamp ?? 0) - (a.timestamp ?? 0));
            onData(entries);
          } catch (error) {
            onError?.(error instanceof Error ? error.message : "snapshot parse failed");
          }
        },
        (error) => onError?.((error as { code?: string })?.code ?? "listener error"),
      );
    } catch (error) {
      onError?.(error instanceof Error ? error.message : "firestore unavailable");
    }
  })();

  return () => {
    alive = false;
    try {
      unsubscribe?.();
    } catch {
      /* already detached */
    }
  };
}

import type { HistoryEntry } from "@/services/activityMetrics";
export type { HistoryBase, HistoryEntry } from "@/services/activityMetrics";
export {
  computeMetrics,
  collapseConsecutive,
  relativeLabel,
  formatListenDuration,
  type ActivityMetrics,
} from "@/services/activityMetrics";

/** Convenience mapper from a catalog track to loggable track data. */
export function toHistoryTrackData(track: EchoTrack | null | undefined, source: "spotify" | "echoes" = "echoes"): HistoryTrackData | null {
  if (!track?.id) return null;
  return {
    trackId: track.id,
    title: track.title,
    artist: track.artist,
    albumArt: track.imageLargeUrl ?? track.imageUrl ?? null,
    genre: track.genre ?? "",
    totalDurationSeconds: Math.round((track.durationMs || 0) / 1000),
    source,
  };
}
