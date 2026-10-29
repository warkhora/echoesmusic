import type { EchoArtist, EchoTrack } from "@/lib/types";

/**
 * Taste model for search ranking.
 *
 * Built entirely from data Echoes already holds — local listening history,
 * Saved Songs, and the artist cache — so ranking never costs an extra request.
 * Genres come from `GET /v1/artists/{id}` responses that were fetched for the
 * Now Playing panel and memoised in `artistDetailCache`.
 */

export interface TasteProfile {
  /** genre → accumulated weight */
  genreWeights: Record<string, number>;
  /** artistId → play/save count */
  artistPlays: Record<string, number>;
  /** artist name (lowercased) → weight, for tracks whose ids are unknown */
  artistNames: Record<string, number>;
  samples: number;
}

export const EMPTY_TASTE: TasteProfile = {
  genreWeights: {},
  artistPlays: {},
  artistNames: {},
  samples: 0,
};

/** A saved track is a stronger signal than a passive play. */
const SAVE_WEIGHT = 1.6;
const PLAY_WEIGHT = 1;
/** Recency matters: the most recent plays count for more. */
const RECENCY_HALFLIFE = 12;

export function buildTasteProfile(input: {
  history: EchoTrack[];
  saved: EchoTrack[];
  catalogArtists?: EchoArtist[];
  /** artistId → genres, straight from the memoised artist cache. */
  genresForArtist: (artistId: string) => string[] | undefined;
}): TasteProfile {
  const taste: TasteProfile = { genreWeights: {}, artistPlays: {}, artistNames: {}, samples: 0 };

  const credit = (track: EchoTrack, weight: number, recencyBoost = 1) => {
    const total = weight * recencyBoost;
    taste.samples += 1;

    const ids = track.artistIds ?? [];
    const names = (track.artistList ?? []).map((a) => a.name);
    const fallbackNames = names.length ? names : track.artist.split(",").map((n) => n.trim());

    fallbackNames.forEach((name, index) => {
      if (!name) return;
      const key = name.toLowerCase();
      taste.artistNames[key] = (taste.artistNames[key] ?? 0) + total;

      const artistId = ids[index];
      const genres = artistId ? input.genresForArtist(artistId) : undefined;
      if (artistId) taste.artistPlays[artistId] = (taste.artistPlays[artistId] ?? 0) + total;
      for (const genre of genres ?? []) {
        const key2 = genre.toLowerCase();
        taste.genreWeights[key2] = (taste.genreWeights[key2] ?? 0) + total;
      }
    });
  };

  // History is newest-first, so earlier entries get a recency boost.
  input.history.forEach((track, index) => {
    const boost = Math.pow(0.5, index / RECENCY_HALFLIFE);
    credit(track, PLAY_WEIGHT, boost);
  });
  for (const track of input.saved) credit(track, SAVE_WEIGHT);

  // The catalog's own artist cards carry genres too (top artists, demo data).
  for (const artist of input.catalogArtists ?? []) {
    const genres = artist.genres?.length ? artist.genres : undefined;
    if (!genres) continue;
    const weight = 0.5;
    for (const genre of genres) {
      const key = genre.toLowerCase();
      taste.genreWeights[key] = (taste.genreWeights[key] ?? 0) + weight;
    }
    if (artist.id) taste.artistNames[artist.name.toLowerCase()] = (taste.artistNames[artist.name.toLowerCase()] ?? 0) + weight;
  }

  return taste;
}

export interface TrackScore {
  /** Raw affinity score. */
  score: number;
  /** 0–1, for UI weighting. */
  relevance: number;
  /** Which signals fired — surfaced in the dropdown as a subtle "because" hint. */
  reasons: string[];
}

/**
 * Ranks one search result against the listener's taste: shared genres first,
 * then familiar artists, then how often they appear in history.
 */
export function scoreTrack(
  track: EchoTrack,
  taste: TasteProfile,
  genresForArtist: (artistId: string) => string[] | undefined,
): TrackScore {
  if (taste.samples === 0) return { score: 0, relevance: 0, reasons: [] };

  let score = 0;
  const reasons: string[] = [];
  const seenGenres = new Set<string>();

  const ids = track.artistIds ?? [];
  const names = (track.artistList ?? []).map((a) => a.name);
  const fallbackNames = names.length ? names : track.artist.split(",").map((n) => n.trim());

  fallbackNames.forEach((name, index) => {
    const artistId = ids[index];
    const genres = artistId ? genresForArtist(artistId) : undefined;

    for (const genre of genres ?? []) {
      const key = genre.toLowerCase();
      if (seenGenres.has(key)) continue;
      seenGenres.add(key);
      const weight = taste.genreWeights[key] ?? 0;
      if (weight > 0) {
        score += Math.min(weight, 6) * 1.5;
        reasons.push(key);
      }
    }

    if (artistId && taste.artistPlays[artistId]) {
      score += Math.min(taste.artistPlays[artistId], 8) * 2;
      if (!reasons.length) reasons.push(name.toLowerCase());
    }
    const byName = taste.artistNames[name?.toLowerCase() ?? ""];
    if (byName) score += Math.min(byName, 8) * 1.2;
  });

  // Album-genre fallback when the artist is not in the cache yet.
  if (!seenGenres.size) {
    for (const genre of track.albumGenres ?? []) {
      const weight = taste.genreWeights[genre.toLowerCase()] ?? 0;
      if (weight > 0) {
        score += Math.min(weight, 4);
        reasons.push(genre.toLowerCase());
        break;
      }
    }
  }

  const relevance = score > 0 ? Math.min(1, score / 18) : 0;
  return { score, relevance, reasons: reasons.slice(0, 2) };
}

/** Sorts results by taste relevance, keeping Spotify's own order on ties. */
export function rankByTaste(
  tracks: EchoTrack[],
  taste: TasteProfile,
  genresForArtist: (artistId: string) => string[] | undefined,
): { track: EchoTrack; score: TrackScore }[] {
  return tracks
    .map((track, index) => ({ track, index, score: scoreTrack(track, taste, genresForArtist) }))
    .sort((a, b) => b.score.score - a.score.score || a.index - b.index)
    .map(({ track, score }) => ({ track, score }));
}
