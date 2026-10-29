import type { EchoTrack } from "@/lib/types";

/**
 * Similarity scoring for Autoplay.
 *
 * Deterministic and cache-only: seeds are the last played tracks, the pool is
 * whatever Echoes already holds (catalog, cached playlist pages, cached artist
 * pages, search results). The jitter term is hashed from the track id so the
 * ranking is stable across calls — repeated generation cannot reshuffle the
 * queue behind the player.
 */

function hash01(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (Math.abs(h) % 1000) / 1000;
}

const mean = (values: number[]): number | null =>
  values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;

export interface SeedProfile {
  artistIds: Set<string>;
  artistNames: Set<string>;
  genres: Set<string>;
  avgBpm: number | null;
  avgEnergy: number | null;
  avgValence: number | null;
}

export function buildSeedProfile(seeds: EchoTrack[]): SeedProfile {
  const artistIds = new Set<string>();
  const artistNames = new Set<string>();
  const genres = new Set<string>();
  for (const seed of seeds) {
    for (const id of seed.artistIds ?? []) artistIds.add(id);
    const primary = (seed.artistList?.[0]?.name ?? seed.artist.split(",")[0] ?? "").trim().toLowerCase();
    if (primary) artistNames.add(primary);
    if (seed.genre) genres.add(seed.genre.toLowerCase());
    for (const g of seed.albumGenres ?? []) genres.add(g.toLowerCase());
  }
  return {
    artistIds,
    artistNames,
    genres,
    avgBpm: mean(seeds.map((s) => s.bpm).filter((v): v is number => typeof v === "number")),
    avgEnergy: mean(seeds.map((s) => s.energy).filter((v): v is number => typeof v === "number")),
    avgValence: mean(seeds.map((s) => s.valence).filter((v): v is number => typeof v === "number")),
  };
}

export function scoreSimilarity(profile: SeedProfile, candidate: EchoTrack): number {
  let score = 0;

  const artistOverlap = (candidate.artistIds ?? []).filter((id) => profile.artistIds.has(id)).length;
  if (artistOverlap > 0) score += 6 * artistOverlap;
  else {
    const primary = (candidate.artistList?.[0]?.name ?? candidate.artist.split(",")[0] ?? "")
      .trim()
      .toLowerCase();
    if (profile.artistNames.has(primary)) score += 4;
  }

  if (candidate.genre && profile.genres.has(candidate.genre.toLowerCase())) score += 3;
  else if ((candidate.albumGenres ?? []).some((g) => profile.genres.has(g.toLowerCase()))) score += 2;

  if (profile.avgBpm !== null && candidate.bpm) {
    const delta = Math.abs(candidate.bpm - profile.avgBpm);
    if (delta <= 8) score += 3;
    else if (delta <= 16) score += 1.5;
  }

  if (profile.avgEnergy !== null && typeof candidate.energy === "number") {
    score += 2 * (1 - Math.min(1, Math.abs(candidate.energy - profile.avgEnergy)));
  }
  if (profile.avgValence !== null && typeof candidate.valence === "number") {
    score += 1 * (1 - Math.min(1, Math.abs(candidate.valence - profile.avgValence)));
  }

  // Mild popularity nudge, then a *stable* per-id jitter for variety.
  score += Math.min(1, (candidate.playCount ?? 0) / 60);
  score += hash01(candidate.id) * 0.5;

  return score;
}

/** Ranks a pool against the seeds and returns the top `count` candidates. */
export function rankRecommendations(
  seeds: EchoTrack[],
  pool: EchoTrack[],
  exclude: Set<string>,
  count: number,
): EchoTrack[] {
  if (!seeds.length || !pool.length || count <= 0) return [];
  const profile = buildSeedProfile(seeds);
  const seedIds = new Set(seeds.map((s) => s.id));
  return pool
    .filter((candidate) => candidate?.id && !exclude.has(candidate.id) && !seedIds.has(candidate.id))
    .map((candidate) => ({ candidate, score: scoreSimilarity(profile, candidate) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, count)
    .map((entry) => entry.candidate);
}

/**
 * Assembles the recommendation pool from everything Echoes already holds.
 * No network access: keeps Autoplay gap-free and 429-safe.
 */
export function collectPool(parts: {
  catalog: EchoTrack[];
  playlistTracks?: Record<string, EchoTrack[]>;
  artistPages?: (EchoTrack[] | undefined)[];
}): EchoTrack[] {
  const seen = new Set<string>();
  const out: EchoTrack[] = [];
  const push = (track: EchoTrack | null | undefined) => {
    if (!track?.id || seen.has(track.id)) return;
    seen.add(track.id);
    out.push(track);
  };
  for (const page of parts.artistPages ?? []) for (const track of page ?? []) push(track);
  for (const list of Object.values(parts.playlistTracks ?? {})) for (const track of list) push(track);
  for (const track of parts.catalog) push(track);
  return out;
}

/**
 * Pure trigger rule for the end-of-queue autoplay fetch:
 * fire when the queue is down to its last track(s), or when the final track is
 * within 30 s of finishing. Extracted so the rule is unit-testable.
 */
export function shouldPrefetchAutoplay(input: {
  tailRemaining: number;
  remainingMs: number;
  windowMs?: number;
}): boolean {
  const window = input.windowMs ?? 30_000;
  // (a) exactly one track left after the current one, or
  // (b) the current track IS the final one and is within 30 s of its duration.
  if (input.tailRemaining === 1) return true;
  return input.tailRemaining === 0 && input.remainingMs <= window;
}
