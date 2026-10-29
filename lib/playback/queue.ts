import type { EchoPlaylist, EchoTrack } from "@/lib/types";

/**
 * Deterministic continuation rules — v7.0.1.
 *
 * A track is only ever followed by something when it has **finished naturally**.
 * What comes next depends entirely on where playback started, and the decision
 * is a pure function so it can be tested without a player, a network or a
 * browser.
 */

export type PlaySource =
  | "playlist"
  | "saved"
  | "album"
  | "artist"
  | "history"
  | "search"
  | "queue";

export interface ContinuationInput {
  /** The list playback was started from, in order. */
  queue: EchoTrack[];
  index: number;
  source: PlaySource;
  playlists: EchoPlaylist[];
  catalogTracks: EchoTrack[];
  savedTracks: EchoTrack[];
  /** Tracks already played in Echoes — recommendations avoid these first. */
  playedIds: Iterable<string>;
  /** Resolved tracks per playlist id, when the list has been paged in. */
  playlistTracks?: Record<string, EchoTrack[]>;
  random?: () => number;
}

export interface Continuation {
  track: EchoTrack | null;
  /** Why this track was chosen — surfaced in logs and tests. */
  reason:
    | "next-in-list"
    | "longest-playlist"
    | "longest-playlist-replay"
    | "saved"
    | "saved-replay"
    | "catalog"
    | "catalog-replay"
    | "exhausted";
}

/** Tracks that start a list and must follow it exactly. */
const ORDERED_SOURCES: PlaySource[] = ["playlist", "saved", "album", "artist"];

function resolvePlaylistTracks(
  playlist: EchoPlaylist,
  playlistTracks?: Record<string, EchoTrack[]>,
): EchoTrack[] {
  return playlistTracks?.[playlist.id] ?? playlist.tracks ?? [];
}

/** The playlist with the most tracks — ties broken by id for determinism. */
export function longestPlaylist(playlists: EchoPlaylist[], playlistTracks?: Record<string, EchoTrack[]>): EchoPlaylist | null {
  let best: EchoPlaylist | null = null;
  let bestCount = -1;
  for (const playlist of playlists) {
    const count =
      resolvePlaylistTracks(playlist, playlistTracks).length || playlist.trackCount || playlist.trackIds.length || 0;
    if (count > bestCount || (count === bestCount && best && playlist.id < best.id)) {
      best = playlist;
      bestCount = count;
    }
  }
  return bestCount > 0 ? best : null;
}

/** Unplayed candidates first, then anything — never an empty stop if avoidable. */
function pickFresh(
  candidates: EchoTrack[],
  exclude: Set<string>,
  random: () => number,
): { track: EchoTrack | null; replay: boolean } {
  if (!candidates.length) return { track: null, replay: false };
  const fresh = candidates.filter((track) => !exclude.has(track.id));
  const pool = fresh.length ? fresh : candidates;
  // Stable pick with a little variety: highest play count first, random tiebreak.
  const scored = pool
    .map((track, index) => ({ track, index, value: (track.playCount ?? 0) + random() }))
    .sort((a, b) => b.value - a.value || a.index - b.index);
  return { track: scored[0]?.track ?? null, replay: fresh.length === 0 };
}

/**
 * The next `count` tracks, applying the same rules repeatedly. Each pick is
 * added to the played set so a lookahead never repeats itself.
 */
export function nextTracks(input: ContinuationInput, count: number): EchoTrack[] {
  const out: EchoTrack[] = [];
  const played = new Set(input.playedIds);
  // A lookahead must not consume the real queue order, so walk a local copy.
  let queue = input.queue;
  let index = input.index;

  while (out.length < count) {
    const decision = nextTrack({ ...input, queue, index, playedIds: played });
    if (!decision.track) break;
    out.push(decision.track);
    played.add(decision.track.id);

    const at = queue.findIndex((track) => track.id === decision.track!.id);
    if (at >= 0 && at === index + 1) {
      index = at; // still walking the source list
    } else {
      // Left the list for a recommendation: continue from the new track.
      queue = [...queue.slice(0, index + 1), decision.track];
      index = queue.length - 1;
    }
  }
  return out;
}

/**
 * Up to `count` other tracks by the same artist, drawn from data Echoes already
 * holds — the library, the resolved playlist pages and, when the listener has
 * visited it, the cached artist page. Zero requests.
 */
export function sameArtistTracks(
  current: EchoTrack | null,
  pools: { catalog: EchoTrack[]; playlistTracks?: Record<string, EchoTrack[]>; artistPage?: EchoTrack[] },
  count = 5,
): EchoTrack[] {
  if (!current) return [];
  const ids = new Set(current.artistIds ?? []);
  const primary = (current.artistList?.[0]?.name ?? current.artist.split(",")[0] ?? "").trim().toLowerCase();
  if (!ids.size && !primary) return [];

  const seen = new Set<string>([current.id]);
  const out: EchoTrack[] = [];
  const sources = [
    pools.artistPage ?? [],
    ...Object.values(pools.playlistTracks ?? {}),
    pools.catalog,
  ];

  for (const pool of sources) {
    for (const track of pool) {
      if (out.length >= count) return out;
      if (!track?.id || seen.has(track.id)) continue;
      const matchesId = (track.artistIds ?? []).some((id) => ids.has(id));
      const matchesName =
        (track.artistList?.[0]?.name ?? track.artist.split(",")[0] ?? "").trim().toLowerCase() === primary;
      if (!matchesId && !matchesName) continue;
      seen.add(track.id);
      out.push(track);
    }
  }
  return out;
}

/**
 * Decides what plays next.
 *
 *   1. Anything started from a playlist, Saved, an album or an artist page
 *      continues with the **exact next track in that list**. Nothing overrides it.
 *   2. When that list runs out — and for history/search starts, immediately —
 *      recommend from the user's **longest playlist**, preferring tracks not yet
 *      played in Echoes.
 *   3. Fall back to Saved tracks, then to any catalog track, then stop.
 */
export function nextTrack(input: ContinuationInput): Continuation {
  const random = input.random ?? Math.random;
  const played = new Set(input.playedIds);
  const currentId = input.queue[input.index]?.id;
  if (currentId) played.add(currentId);

  // ---- rule (a)/(b)/(c): finish the list we started from ----
  const nextInList = input.queue[input.index + 1];
  if (nextInList) return { track: nextInList, reason: "next-in-list" };

  // An ordered source that has run out behaves exactly like a fresh start:
  // recommend from the longest playlist.
  void ORDERED_SOURCES;

  // ---- rule (b)/(e): longest playlist, unplayed first ----
  const longest = longestPlaylist(input.playlists, input.playlistTracks);
  if (longest) {
    const candidates = resolvePlaylistTracks(longest, input.playlistTracks).filter(
      (track) => track.id !== currentId,
    );
    const picked = pickFresh(candidates, played, random);
    if (picked.track) {
      return {
        track: picked.track,
        reason: picked.replay ? "longest-playlist-replay" : "longest-playlist",
      };
    }
  }

  // ---- fallback: Saved ----
  const savedCandidates = input.savedTracks.filter((track) => track.id !== currentId);
  const saved = pickFresh(savedCandidates, played, random);
  if (saved.track) return { track: saved.track, reason: saved.replay ? "saved-replay" : "saved" };

  // ---- last resort: anything in the library ----
  const anyCandidates = input.catalogTracks.filter((track) => track.id !== currentId);
  const any = pickFresh(anyCandidates, played, random);
  if (any.track) return { track: any.track, reason: any.replay ? "catalog-replay" : "catalog" };

  return { track: null, reason: "exhausted" };
}
