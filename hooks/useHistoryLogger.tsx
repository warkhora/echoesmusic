"use client";

import { doc, getDoc } from "firebase/firestore";
import { useCallback, useEffect, useRef } from "react";
import { useFirebase } from "@/hooks/useFirebaseAuth";
import { firebaseDb } from "@/lib/firebase";
import {
  toHistoryTrackData,
  writeHistorySession,
  type HistoryBase,
  type HistoryTrackData,
} from "@/services/historyService";
import { usePlayer, usePlayerProgress } from "@/state/player";

/** Live progress sync cadence while playing (same document, merged in place). */
const PROGRESS_WRITE_EVERY_MS = 10_000;
/** The "first second of playback" threshold that creates the session document. */
const FIRST_SECOND_MS = 1_000;
/** How often the light tick checks whether a write is due. */
const TICK_MS = 500;

/**
 * Session-scoped, seek-safe history logging.
 *
 * ONE document per track per user: `/users/{uid}/history/{trackId}`.
 *  · Created the moment playback starts (PLAYING edge or playhead ≥ 1 s).
 *  · `durationPlayedSeconds` accumulates WALL-CLOCK time spent playing, so
 *    seeking forward never inflates playtime; only real elapsed playback counts.
 *  · `playCount` is derived as floor(totalPlaytime / 30 s) — a clean anti-cheat
 *    rule: +1 play per 30 s of accumulated listening, never per click.
 *  · Finalised (forced write) on track change, pause/stop, or natural finish.
 *
 * The writer's identity depends only on `uid`; the track and progress are read
 * from refs, and `startedAt`/base reset only on a true track-id transition, so
 * effect churn can never mint duplicate documents or spam writes.
 * Renders null; every Firestore call is fire-and-forget and cannot interrupt
 * playback.
 */
export function HistoryLogger() {
  // 1) hooks & refs, strictly first
  const firebase = useFirebase();
  const { current, isPlaying } = usePlayer();
  const { progressMs } = usePlayerProgress();

  const uid = firebase.user?.uid ?? null;
  const currentId = current?.id ?? null;

  const currentRef = useRef<typeof current>(null);
  const progressRef = useRef(0);
  const baseRef = useRef<(HistoryBase & { trackId: string }) | null>(null);
  const baseReadyRef = useRef(false);
  const accRef = useRef(0); // accumulated wall-clock seconds this session
  const lastWallRef = useRef<number | null>(null);
  const lastWriteRef = useRef(0);
  const firstWriteDoneRef = useRef(false);
  const wasPlayingRef = useRef(false);

  useEffect(() => {
    currentRef.current = current;
  }, [current]);

  useEffect(() => {
    progressRef.current = progressMs;
  }, [progressMs]);

  // 2) stable writer: identity depends only on uid.
  const write = useCallback(
    (opts?: { force?: boolean }) => {
      const track = currentRef.current;
      const data: HistoryTrackData | null = toHistoryTrackData(track, "echoes");
      const base = baseRef.current;
      if (!uid || !data || !base || !baseReadyRef.current) return;
      const now = Date.now();
      if (!opts?.force && now - lastWriteRef.current < PROGRESS_WRITE_EVERY_MS) return;
      lastWriteRef.current = now;
      void writeHistorySession(uid, data, {
        basePlaytimeSeconds: base.playtimeSeconds,
        basePlayCount: base.playCount,
        firstPlayedAt: base.firstPlayedAt,
        accumulatedSeconds: accRef.current,
        positionSeconds: Math.round(progressRef.current / 1000),
      });
    },
    [uid],
  );

  // 3) load the per-track base (playtime/playCount/firstPlayedAt) once per track.
  const ensureBase = useCallback(
    async (trackId: string) => {
      baseReadyRef.current = false;
      accRef.current = 0;
      try {
        const db = await firebaseDb();
        if (!db) {
          baseRef.current = { trackId, playtimeSeconds: 0, playCount: 0, firstPlayedAt: Date.now() };
          baseReadyRef.current = true;
          return;
        }
        const snap = await getDoc(doc(db, "users", uid ?? "", "history", trackId));
        const data = snap.data() as
          | { durationPlayedSeconds?: number; playCount?: number; firstPlayedAt?: number }
          | undefined;
        baseRef.current = {
          trackId,
          playtimeSeconds: data?.durationPlayedSeconds ?? 0,
          playCount: data?.playCount ?? 0,
          firstPlayedAt: data?.firstPlayedAt ?? Date.now(),
        };
      } catch {
        baseRef.current = { trackId, playtimeSeconds: 0, playCount: 0, firstPlayedAt: Date.now() };
      } finally {
        baseReadyRef.current = true;
      }
    },
    [uid],
  );

  // 4) true track transition: finalise previous, arm a fresh base.
  useEffect(() => {
    if (!uid || !currentId) return;
    if (firstWriteDoneRef.current) write({ force: true }); // close out previous track
    firstWriteDoneRef.current = false;
    wasPlayingRef.current = false;
    lastWallRef.current = null;
    void ensureBase(currentId);
  }, [currentId, uid, write, ensureBase]);

  // 5) create-on-start + wall-clock accumulation + throttled in-place updates.
  useEffect(() => {
    if (!uid || !currentId) return;

    if (isPlaying && !wasPlayingRef.current) {
      wasPlayingRef.current = true;
      lastWallRef.current = Date.now();
      if (!firstWriteDoneRef.current) {
        firstWriteDoneRef.current = true;
        write({ force: true }); // create the single doc at playback start
      }
    } else if (!isPlaying && wasPlayingRef.current) {
      // Pause/stop: bank accumulated time and finalise this track's document.
      if (lastWallRef.current !== null) {
        accRef.current += (Date.now() - lastWallRef.current) / 1000;
      }
      lastWallRef.current = null;
      wasPlayingRef.current = false;
      if (firstWriteDoneRef.current) write({ force: true });
      return;
    }
    if (!isPlaying) return;

    const id = window.setInterval(() => {
      const now = Date.now();
      if (lastWallRef.current !== null) {
        accRef.current += (now - lastWallRef.current) / 1000; // seek-safe accumulation
      }
      lastWallRef.current = now;
      if (!firstWriteDoneRef.current && progressRef.current >= FIRST_SECOND_MS) {
        firstWriteDoneRef.current = true;
        write({ force: true });
        return;
      }
      if (firstWriteDoneRef.current) write(); // throttled in-place update
    }, TICK_MS);
    return () => window.clearInterval(id);
  }, [uid, currentId, isPlaying, write]);

  return null;
}
