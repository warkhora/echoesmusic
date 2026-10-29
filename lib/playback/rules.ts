/**
 * Pure playback-guard rules.
 *
 * These three decisions caused the "random song switching" and "unexpected
 * pausing" reports, so they live here as testable functions rather than inline
 * conditionals buried in effects.
 */

/**
 * May a `/me/player` poll move us to a different track?
 *
 * While a manual command is still inside its optimistic window, a poll that
 * reports a *different* track is almost always the pre-command state arriving
 * late. Adopting it flips the UI back and then forward again. Metadata for the
 * same track is always safe to merge.
 */
export function shouldAdoptRemoteTrack(input: {
  locked: boolean;
  trackChanged: boolean;
  hasItem: boolean;
}): boolean {
  if (!input.hasItem) return false;
  return !(input.locked && input.trackChanged);
}

/**
 * Did the current track end by itself rather than being paused by the user?
 *
 * The Web Playback SDK reports `paused: true` in both cases; the distinguisher
 * is that a natural end has the playhead at the end of the *same* track.
 */
export function isNaturalEnd(input: {
  paused: boolean;
  position: number;
  duration: number;
  sameTrackAsBefore: boolean;
  alreadyAdvancedForThisTrack: boolean;
  toleranceMs?: number;
}): boolean {
  const tolerance = input.toleranceMs ?? 1500;
  return (
    input.paused &&
    input.duration > 0 &&
    input.position >= input.duration - tolerance &&
    input.sameTrackAsBefore &&
    !input.alreadyAdvancedForThisTrack
  );
}

/**
 * Should the progress-based continuation watchdog run at all?
 *
 * Only when Echoes controls *another* device. When the Web Playback SDK is the
 * active device it continues playback natively and reports the natural end, so a
 * timer here could only hijack the transition with an unrelated recommendation.
 */
export function shouldRunEndWatchdog(input: {
  mode: "demo" | "spotify";
  isPlaying: boolean;
  hasTrack: boolean;
  durationMs: number;
  onWebPlayer: boolean;
  progressMs: number;
  alreadyAdvanced: boolean;
  armAtMs?: number;
}): boolean {
  const armAt = input.armAtMs ?? 250;
  if (input.mode !== "spotify") return false;
  if (!input.isPlaying || !input.hasTrack || input.durationMs <= 0) return false;
  if (input.onWebPlayer) return false;
  if (input.alreadyAdvanced) return false;
  return input.progressMs >= input.durationMs - armAt;
}
