import type { EchoTrack } from "@/lib/types";

/**
 * Continuous play.
 *
 * A standalone `uris` play leaves Spotify with nothing queued, so when a track
 * runs out Echoes picks what should come next. There is no recommendations
 * endpoint available to Development Mode apps, so this scores the catalog we
 * already hold: same artist and album first, then genre, then tempo/energy
 * proximity, with a little randomness so ties do not always resolve the same way.
 */

export interface PickNextOptions {
  pool: EchoTrack[];
  current: EchoTrack | null;
  /** Track ids to avoid — the last N auto-plays plus whatever just finished. */
  history?: Iterable<string>;
  /** Injectable for deterministic tests. */
  random?: () => number;
}

export function scoreRecommendation(current: EchoTrack | null, candidate: EchoTrack): number {
  if (!current) return 0;
  let score = 0;
  if (candidate.artist === current.artist) score += 3;
  if (candidate.album === current.album) score += 2;
  if (candidate.genre === current.genre) score += 2;
  if (candidate.bpm && current.bpm && Math.abs(candidate.bpm - current.bpm) <= 12) score += 1;
  if (typeof candidate.energy === "number" && typeof current.energy === "number") {
    score += Math.max(0, 1 - Math.abs(candidate.energy - current.energy) * 2);
  }
  if (candidate.year && current.year && Math.abs(candidate.year - current.year) <= 2) score += 0.5;
  return score;
}

export function pickNextTrack({
  pool,
  current,
  history,
  random = Math.random,
}: PickNextOptions): EchoTrack | null {
  const candidates = pool.filter((t) => t.id !== current?.id);
  if (!candidates.length) return null;

  const seen = new Set(history ?? []);
  const fresh = candidates.filter((t) => !seen.has(t.id));
  const source = fresh.length ? fresh : candidates; // replay before stopping dead

  let best: EchoTrack | null = null;
  let bestScore = -Infinity;
  for (const track of source) {
    // The random term only breaks ties, so related music still wins.
    const score = scoreRecommendation(current, track) + random() * 0.9;
    if (score > bestScore) {
      bestScore = score;
      best = track;
    }
  }
  return best;
}
