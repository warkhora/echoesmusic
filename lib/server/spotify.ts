import { inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { trackFeatures } from "@/db/schema";
import {
  isRateLimitStatus,
  noteRateLimit,
  noteSuccess,
  rateLimited,
  retryAfterSeconds,
} from "@/lib/spotify/rateLimit";
import {
  ADDITIONAL_TYPES,
  MARKET,
  SpotifyApiError,
  adaptArtist,
  adaptFeatures,
  adaptLibraryItem,
  adaptPlaylist,
  adaptPlaylistItem,
  adaptTrack,
  isRealTrack,
  pickImage,
  playlistRows,
  spotifyFetch,
  spotifyFetchProjected,
  spotifyFetchSerial,
  spotifyMessage,
  triadFromString,
  withParams,
  type PlaylistItem,
  type SpAlbum,
  type SpArtist,
  type SpAudioFeatures,
  type SpImage,
  type SpPlayerState,
  type SpPlaylist,
  type SpTrack,
} from "@/lib/spotify/client";
import { withFields } from "@/lib/spotify/fields";
import { SAVED_MAX_TRACKS, SAVED_PAGE_SIZE, collectPages } from "@/lib/spotify/paginate";
import type { EchoArtist, EchoPlaylist, EchoTrack, SpotifyLibraryPayload, Triad } from "@/lib/types";

/*
 * Server-side Spotify aggregation.
 *
 * The browser used to fire five sequential cross-origin requests and bail out
 * completely if any one of them 403'd. Here we fan out in parallel, tolerate
 * per-endpoint failure, cache audio features in Postgres, and hand the client a
 * single normalized payload.
 */

/**
 * Development Mode apps are tightly rate limited and the Feb 2026 migration
 * removed the batch `?ids=` fetches, so detail lookups are individual calls
 * run a few at a time and memoised in memory only — CDN artwork URLs expire and
 * are never persisted to disk or database.
 */
const LIBRARY_TTL_MS = 30_000;
const DETAIL_TTL_MS = 10 * 60_000;
const albumCache = new Map<string, { at: number; value: Partial<EchoTrack> }>();
const artistCache = new Map<string, { at: number; value: EchoArtist }>();
/** Failed lookups are remembered too — a 429 must not be re-earned per render. */
const NEGATIVE_TTL_MS = 30_000;
/** Failures are remembered far longer once Spotify has rate-limited us. */
const RATE_LIMIT_NEGATIVE_TTL_MS = 5 * 60_000;
const artistFailures = new Map<string, number>();
const albumFailures = new Map<string, number>();

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    while (cursor < items.length) {
      const i = cursor++;
      out[i] = await fn(items[i]);
    }
  });
  await Promise.all(workers);
  return out;
}

/** `GET /albums/{id}` — high-resolution cover art and the real album name. */
async function albumDetail(token: string, albumId: string): Promise<Partial<EchoTrack>> {
  const hit = albumCache.get(albumId);
  if (hit && Date.now() - hit.at < DETAIL_TTL_MS) return hit.value;

  // Breaker open, or this album already failed recently: serve nothing, ask nobody.
  if (rateLimited()) return {};
  const failedAt = albumFailures.get(albumId);
  if (failedAt && Date.now() - failedAt < RATE_LIMIT_NEGATIVE_TTL_MS) return {};

  try {
    const album = await spotifyFetchSerial<SpAlbum>(
      withParams(`/albums/${albumId}`, { market: "from_token" }),
      token,
    );
    const value: Partial<EchoTrack> = {
      album: album.name,
      imageUrl: pickImage(album.images, 300),
      imageLargeUrl: pickImage(album.images),
      year: album.release_date ? Number(album.release_date.slice(0, 4)) : undefined,
    };
    albumCache.set(albumId, { at: Date.now(), value });
    albumFailures.delete(albumId);
    noteSuccess();
    return value;
  } catch (error) {
    albumFailures.set(albumId, Date.now());
    if (error instanceof SpotifyApiError && isRateLimitStatus(error.status)) {
      noteRateLimit("/albums/{id}");
    } else {
      logApi("album", error);
    }
    return {};
  }
}

/**
 * Paginates the saved-tracks list through the shared walker: offset 0, 50, 100…
 * until a short page, a null `next`, or the 500-track cap.
 */
export async function fetchSavedTracks(
  token: string,
  options: { pageSize?: number; cap?: number } = {},
): Promise<EchoTrack[]> {
  const pageSize = options.pageSize ?? SAVED_PAGE_SIZE;
  const cap = options.cap ?? SAVED_MAX_TRACKS;

  const result = await collectPages<PlaylistItem, EchoTrack>({
    firstUrl: withFields("/me/tracks", "savedTracks", { limit: pageSize, offset: 0 }),
    pageSize,
    cap,
    fetchPage: (url) => spotifyFetchSerial<Paged<PlaylistItem>>(url, token),
    // `/me/tracks` rows are wrapped and `track` may be the boolean trap.
    adapt: (row) => {
      const track = adaptLibraryItem(row as unknown as Parameters<typeof adaptLibraryItem>[0]);
      return track ? { ...track, saved: true } : null;
    },
    onPageError: (error) => logApi("saved:page", error),
  });

  return result.items;
}

/**
 * `GET /v1/search?type=track&market=from_token`.
 *
 * Development Mode apps are capped at 10 results regardless of the `limit`
 * asked for, so `capped` tells the client the list is short because of the app
 * tier rather than a lack of matches.
 */
export async function searchTracks(
  token: string,
  query: string,
  limit = 50,
): Promise<{ tracks: EchoTrack[]; capped: boolean }> {
  const asked = Math.min(50, Math.max(1, limit));
  const res = await spotifyFetchSerial<{ tracks?: Paged<SpTrack> }>(
    withParams("/search", { q: query, type: "track", limit: asked, market: "from_token" }),
    token,
  );
  const items = res.tracks?.items ?? [];
  const tracks = items.filter(isRealTrack).map((track) => adaptTrack(track));
  return { tracks, capped: tracks.length < asked };
}

/**
 * `GET /v1/me/player/recently-played?limit=50` — lazy: called only when the
 * listener opens Home or Activity and localStorage has no history yet.
 */
export async function fetchRecentlyPlayed(token: string, limit = 50): Promise<EchoTrack[]> {
  const page = await spotifyFetchSerial<Paged<{ track?: SpTrack; played_at: string }>>(
    withFields("/me/player/recently-played", "recentlyPlayed", { limit }),
    token,
  );
  const seen = new Set<string>();
  const out: EchoTrack[] = [];
  for (const item of page.items ?? []) {
    if (!isRealTrack(item.track)) continue;
    const track = adaptTrack(item.track);
    if (seen.has(track.id)) continue;
    seen.add(track.id);
    out.push(track);
  }
  return out;
}

/**
 * `GET /artists/{id}` on its own — the Now Playing panel calls this whenever the
 * primary artist changes, for the high-res banner and the external Spotify URL.
 */
export async function fetchSpotifyArtist(
  token: string,
  artistId: string,
): Promise<EchoArtist | null> {
  const cached = artistCache.get(artistId);
  if (cached && Date.now() - cached.at < DETAIL_TTL_MS) return cached.value;

  // Breaker open, or inside the cool-down after a 429/403: answer from memory.
  if (rateLimited()) return null;
  const failedAt = artistFailures.get(artistId);
  if (failedAt && Date.now() - failedAt < RATE_LIMIT_NEGATIVE_TTL_MS) return null;

  try {
    const artist = await spotifyFetchSerial<SpArtist>(`/artists/${artistId}`, token);
    const value = adaptArtist(artist);
    artistCache.set(artistId, { at: Date.now(), value });
    artistFailures.delete(artistId);
    noteSuccess();
    return value;
  } catch (error) {
    artistFailures.set(artistId, Date.now());
    if (error instanceof SpotifyApiError && isRateLimitStatus(error.status)) {
      // Polite warning once; the breaker stops every other caller too.
      noteRateLimit("/artists/{id}");
      return null;
    }
    logApi("artist:detail", error);
    throw error instanceof Error ? error : new Error("artist detail failed");
  }
}

/** `GET /artists/{id}` — images and genres (both may be absent in Dev Mode). */
async function artistDetail(token: string, artistId: string): Promise<EchoArtist | null> {
  const hit = artistCache.get(artistId);
  if (hit && Date.now() - hit.at < DETAIL_TTL_MS) return hit.value;
  try {
    const artist = await spotifyFetchSerial<SpArtist>(`/artists/${artistId}`, token);
    const value = adaptArtist(artist);
    artistCache.set(artistId, { at: Date.now(), value });
    return value;
  } catch (error) {
    logApi("artist", error);
    return null;
  }
}
const libraryCache = new Map<string, { at: number; payload: SpotifyLibraryPayload }>();

/** Spotify withholds /audio-features from newer client ids — ask only once. */
let featuresUnavailable = false;

interface Paged<T> {
  items: T[];
  next: string | null;
}

/** Short, stable cache key — never keep the raw token in memory longer than needed. */
function tokenKey(token: string): string {
  let h = 5381;
  for (let i = 0; i < token.length; i++) h = ((h << 5) + h + token.charCodeAt(i)) | 0;
  return `lib:${h}:${token.length}`;
}

export function logApi(scope: string, error: unknown): void {
  if (error instanceof SpotifyApiError) {
    // Expected conditions for free-tier / development-mode apps: keep them quiet.
    if ([403, 404].includes(error.status) && (error.path.startsWith("/me/player") || error.path.startsWith("/audio-features"))) {
      return;
    }
    console.warn(`[echoes:${scope}] ${error.status} ${error.path}`);
    return;
  }
  console.warn(`[echoes:${scope}]`, error instanceof Error ? error.message : error);
}

async function fetchAudioFeatures(
  token: string,
  ids: string[],
): Promise<Map<string, Partial<EchoTrack>>> {
  const out = new Map<string, Partial<EchoTrack>>();
  const unique = [...new Set(ids)].filter(Boolean);
  if (!unique.length) return out;

  // 1 — Postgres cache first.
  try {
    const rows = await db
      .select()
      .from(trackFeatures)
      .where(inArray(trackFeatures.trackId, unique));
    for (const r of rows) {
      out.set(r.trackId, {
        bpm: r.bpm,
        musicalKey: r.key !== null && r.mode !== null ? keyLabel(r.key, r.mode) : null,
        energy: r.energy === null ? null : r.energy / 100,
        danceability: r.danceability === null ? null : r.danceability / 100,
        valence: r.valence === null ? null : r.valence / 100,
      });
    }
  } catch (error) {
    logApi("features:cache", error);
  }

  const missing =
    featuresUnavailable || rateLimited() ? [] : unique.filter((id) => !out.has(id));
  if (!missing.length) return out;

  // 2 — batch the remainder (Spotify allows up to 100 ids per call).
  for (let i = 0; i < missing.length; i += 60) {
    const batch = missing.slice(i, i + 60);
    try {
      const res = await spotifyFetchSerial<{ audio_features: (SpAudioFeatures | null)[] }>(
        `/audio-features?ids=${batch.join(",")}`,
        token,
      );
      const rows: {
        trackId: string;
        bpm: number | null;
        key: number | null;
        mode: number | null;
        energy: number | null;
        danceability: number | null;
        valence: number | null;
      }[] = [];

      (res.audio_features ?? []).forEach((f, index) => {
        if (!f) return;
        const id = f.id ?? batch[index];
        if (!id) return;
        out.set(id, adaptFeatures(f));
        rows.push({
          trackId: id,
          bpm: f.tempo ? Math.round(f.tempo) : null,
          key: f.key ?? null,
          mode: f.mode ?? null,
          energy: typeof f.energy === "number" ? Math.round(f.energy * 100) : null,
          danceability:
            typeof f.danceability === "number" ? Math.round(f.danceability * 100) : null,
          valence: typeof f.valence === "number" ? Math.round(f.valence * 100) : null,
        });
      });

      if (rows.length) {
        await db
          .insert(trackFeatures)
          .values(rows)
          .onConflictDoUpdate({
            target: trackFeatures.trackId,
            set: {
              bpm: sql`excluded.bpm`,
              key: sql`excluded.key`,
              mode: sql`excluded.mode`,
              energy: sql`excluded.energy`,
              danceability: sql`excluded.danceability`,
              valence: sql`excluded.valence`,
              fetchedAt: sql`now()`,
            },
          })
          .catch((error) => logApi("features:write", error));
      }
    } catch (error) {
      if (error instanceof SpotifyApiError && isRateLimitStatus(error.status)) {
        noteRateLimit("/audio-features"); // breaker stops the rest of the batch
      } else if (error instanceof SpotifyApiError && (error.status === 403 || error.status === 404)) {
        featuresUnavailable = true; // stop asking for the life of this process
      } else {
        logApi("features", error);
      }
      break;
    }
  }

  return out;
}

const KEY_NAMES = ["C", "C♯", "D", "D♯", "E", "F", "F♯", "G", "G♯", "A", "A♯", "B"];
function keyLabel(key: number, mode: number): string {
  return `${KEY_NAMES[key] ?? "?"}${mode === 0 ? "m" : ""}`;
}

/** Sections the client already has in localStorage and does not want refetched. */
export type LibrarySkip = "recent" | "saved" | "top" | "artists" | "playlists" | "player";

export async function fetchSpotifyLibrary(
  token: string,
  options: { refresh?: boolean; skip?: LibrarySkip[] } = {},
): Promise<SpotifyLibraryPayload> {
  const skip = new Set(options.skip ?? []);
  const key = `${tokenKey(token)}:${[...(options.skip ?? [])].sort().join(",")}`;
  const hit = libraryCache.get(key);
  if (!options.refresh && hit && Date.now() - hit.at < LIBRARY_TTL_MS) {
    return { ...hit.payload, cachedAt: new Date(hit.at).toISOString() };
  }

  const degraded: string[] = [];
  /**
   * `projected` carries a `fields=` projection; `plain` is the same endpoint
   * without one. A rejected projection falls back instead of emptying the
   * library.
   */
  const grab = async <T,>(
    label: string,
    projected: string,
    plain: string,
    fallback: T,
  ): Promise<T> => {
    try {
      return await spotifyFetchProjected<T>(projected, plain, token);
    } catch (error) {
      if (error instanceof SpotifyApiError) degraded.push(`${label}:${error.status}`);
      else degraded.push(label);
      logApi(label, error);
      return fallback;
    }
  };

  const empty = <T,>(): Paged<T> => ({ items: [], next: null });

  /**
   * Sequential startup. Each request waits for the previous one, so a cold
   * cache never fires six parallel calls at Spotify — the pattern that produced
   * the 503s. Order is by usefulness: playlists and saved songs first (the
   * library grid and every heart icon), then the surfaces below the fold.
   */
  const playlistsRes = skip.has("playlists")
    ? empty<SpPlaylist>()
    : await grab<Paged<SpPlaylist>>(
        "playlists",
        withFields("/me/playlists", "playlists", { limit: 50 }),
        "/me/playlists?limit=50",
        empty<SpPlaylist>(),
      );

  // Paginated — a single 50-row page is not the whole library.
  let savedPage: EchoTrack[] = [];
  if (!skip.has("saved")) {
    try {
      savedPage = await fetchSavedTracks(token);
    } catch (error) {
      degraded.push("saved");
      logApi("saved", error);
    }
  }

  const topTracksRes = skip.has("top")
    ? empty<SpTrack>()
    : await grab<Paged<SpTrack>>(
        "top_tracks",
        withFields("/me/top/tracks", "topTracks", { limit: 20, time_range: "medium_term" }),
        "/me/top/tracks?limit=20&time_range=medium_term",
        empty<SpTrack>(),
      );

  const topArtistsRes = skip.has("artists")
    ? empty<SpArtist>()
    : await grab<Paged<SpArtist>>(
        "top_artists",
        withFields("/me/top/artists", "topArtists", { limit: 10, time_range: "medium_term" }),
        "/me/top/artists?limit=10&time_range=medium_term",
        empty<SpArtist>(),
      );

  // History is lazy: fetched only when the listener actually opens Home or
  // Activity and localStorage holds nothing yet.
  const recentRes = skip.has("recent")
    ? empty<{ track?: SpTrack; played_at: string }>()
    : await grab<Paged<{ track?: SpTrack; played_at: string }>>(
        "recent",
        withFields("/me/player/recently-played", "recentlyPlayed", { limit: 50 }),
        "/me/player/recently-played?limit=50",
        empty(),
      );

  const playerRes = skip.has("player")
    ? null
    : await grab<SpPlayerState | null>("player", "/me/player?market=from_token", "/me/player", null);

  // Every endpoint rejecting the token means the session died — tell the client
  // to refresh rather than handing it a plausible-looking empty library.
  if (degraded.length >= 4 && degraded.every((d) => d.endsWith(":401"))) {
    throw new SpotifyApiError("Spotify rejected the access token", 401, "/me/*");
  }

  const playlists: EchoPlaylist[] = playlistsRes.items
    .filter((p) => p?.id)
    .map(adaptPlaylist);

  const topTracks: EchoTrack[] = topTracksRes.items.filter(isRealTrack).map((t) => adaptTrack(t));

  const artists: EchoArtist[] = topArtistsRes.items.filter((a) => a?.id).map(adaptArtist);

  const seen = new Set<string>();
  const recentlyPlayed: EchoTrack[] = [];
  for (const item of recentRes.items) {
    if (!isRealTrack(item.track)) continue;
    const t = adaptTrack(item.track);
    if (seen.has(t.id)) continue;
    seen.add(t.id);
    recentlyPlayed.push(t);
  }

  const savedTracks: EchoTrack[] = savedPage;

  const liveTrack = isRealTrack(playerRes?.item) ? adaptTrack(playerRes!.item!) : null;

  // Merge every track we know about, then enrich once with audio features.
  const all = new Map<string, EchoTrack>();
  for (const t of [...topTracks, ...recentlyPlayed, ...savedTracks, ...(liveTrack ? [liveTrack] : [])]) {
    all.set(t.id, { ...all.get(t.id), ...t });
  }
  for (const pl of playlists) for (const t of pl.tracks ?? []) if (!all.has(t.id)) all.set(t.id, t);

  // Detail pass: `GET /albums/{id}` for artwork on the tracks people actually
  // look at, and `GET /artists/{id}` for the artists in rotation.
  await enrichWithDetails(token, all, liveTrack, artists);

  const features = await fetchAudioFeatures(token, [...all.keys()]);
  if (features.size) {
    for (const [id, f] of features) {
      const existing = all.get(id);
      if (existing) all.set(id, { ...existing, ...f });
      if (liveTrack?.id === id) Object.assign(liveTrack, f);
    }
    for (const list of [topTracks, recentlyPlayed, savedTracks]) {
      for (const t of list) Object.assign(t, features.get(t.id) ?? {});
    }
    for (const pl of playlists) {
      if (!pl.tracks) continue;
      for (const t of pl.tracks) Object.assign(t, features.get(t.id) ?? {});
    }
  }

  const payload: SpotifyLibraryPayload = {
    playlists,
    tracks: [...all.values()],
    artists,
    recentlyPlayed: recentlyPlayed.slice(0, 14),
    topTracks: topTracks.slice(0, 12),
    savedTracks,
    deviceName: playerRes?.device?.name ?? null,
    isPlaying: Boolean(playerRes?.is_playing),
    progressMs: playerRes?.progress_ms ?? 0,
    currentTrackId: liveTrack?.id ?? null,
    degraded: degraded.length ? degraded : undefined,
    cachedAt: new Date().toISOString(),
  };

  libraryCache.set(key, { at: Date.now(), payload });
  if (libraryCache.size > 24) {
    const oldest = [...libraryCache.entries()].sort((a, b) => a[1].at - b[1].at)[0];
    if (oldest) libraryCache.delete(oldest[0]);
  }

  return payload;
}

/** Full track list for one playlist, paged, with features merged in. */
/**
 * Individual `/albums/{id}` and `/artists/{id}` lookups (batch `?ids=` was
 * removed), bounded so a big library cannot exhaust a Dev Mode quota.
 */
async function enrichWithDetails(
  token: string,
  all: Map<string, EchoTrack>,
  liveTrack: EchoTrack | null,
  artists: EchoArtist[],
): Promise<void> {
  const priority = new Map<string, EchoTrack>();
  if (liveTrack?.albumId) priority.set(liveTrack.id, liveTrack);
  for (const t of all.values()) {
    if (priority.size >= 8) break;
    if (t.albumId) priority.set(t.id, t);
  }

  // Rate limited: skip the whole enrichment pass rather than queue more calls.
  if (rateLimited()) return;

  const albums = [...new Set([...priority.values()].map((t) => t.albumId).filter(Boolean))] as string[];
  const artistIds = [...new Set(artists.map((a) => a.id).filter((id) => id && !id.includes(":")))].slice(0, 6);

  const [albumResults, artistResults] = await Promise.all([
    mapLimit(albums.slice(0, 8), 3, (id) => albumDetail(token, id)),
    mapLimit(artistIds, 3, (id) => artistDetail(token, id)),
  ]);

  const albumById = new Map(albums.map((id, i) => [id, albumResults[i]]));
  for (const track of all.values()) {
    const detail = track.albumId ? albumById.get(track.albumId) : undefined;
    if (detail && Object.keys(detail).length) Object.assign(track, detail);
  }
  if (liveTrack?.albumId) {
    const detail = albumById.get(liveTrack.albumId);
    if (detail) Object.assign(liveTrack, detail);
  }

  const enriched = artistResults.filter((a): a is EchoArtist => Boolean(a));
  const byId = new Map(enriched.map((a) => [a.id, a]));
  for (let i = 0; i < artists.length; i++) {
    const detail = byId.get(artists[i].id);
    if (detail) {
      artists[i] = {
        ...artists[i],
        ...detail,
        // Keep the bio we already had when Dev Mode returns no genres.
        bio: detail.bio && detail.bio !== "Artist on Spotify" ? detail.bio : artists[i].bio,
      };
    }
  }
}

/** `GET /tracks/{id}` + album + artist detail for one track. */
export async function fetchSpotifyTrack(
  token: string,
  trackId: string,
): Promise<{ track: EchoTrack | null; artist: EchoArtist | null; albumImageUrl: string | null }> {
  // Let a 401/404 propagate: `withSpotify` needs the real status to refresh the
  // token and retry, and swallowing it here used to answer 200 with a null track.
  const track = await spotifyFetchSerial<SpTrack>(
    withParams(`/tracks/${trackId}`, { market: "from_token" }),
    token,
  );
  if (!isRealTrack(track)) return { track: null, artist: null, albumImageUrl: null };

  const adapted = adaptTrack(track);
  const artistId = adapted.artistIds?.[0];

  const [albumDetailValue, artistDetailValue] = await Promise.all([
    adapted.albumId ? albumDetail(token, adapted.albumId) : Promise.resolve({}),
    artistId ? artistDetail(token, artistId) : Promise.resolve(null),
  ]);
  Object.assign(adapted, albumDetailValue);

  return {
    track: adapted,
    artist: artistDetailValue,
    albumImageUrl: adapted.imageLargeUrl ?? adapted.imageUrl ?? null,
  };
}

export async function fetchSpotifyPlaylist(
  token: string,
  playlistId: string,
): Promise<{
  playlist: EchoPlaylist | null;
  tracks: EchoTrack[];
  skipped: number;
  error?: { status: number; message: string };
}> {
  const collected: EchoTrack[] = [];
  let skipped = 0;
  let meta: SpPlaylist | null = null;
  let metaError: SpotifyApiError | null = null;

  try {
    meta = await spotifyFetchProjected<SpPlaylist>(
      withFields(`/playlists/${playlistId}`, "playlist", { additional_types: "track,episode" }),
      withParams(`/playlists/${playlistId}`, { market: "from_token", additional_types: "track,episode" }),
      token,
    );
  } catch (error) {
    logApi("playlist:meta", error);
    if (error instanceof SpotifyApiError) metaError = error;
  }

  // A dead session is worth bubbling up immediately: the client refreshes and retries.
  if (metaError?.status === 401) throw metaError;

  // Feb 2026: /playlists/{id}/items replaced /playlists/{id}/tracks (which now
  // 403s for Development Mode apps). Extended Quota apps may still only serve
  // the legacy path, so both are tried.
  const itemParams = { limit: 100, offset: 0, additional_types: "track,episode" };
  const endpoints: { projected: string; plain: string }[] = [
    {
      projected: withFields(`/playlists/${playlistId}/items`, "playlistItems", itemParams),
      plain: withParams(`/playlists/${playlistId}/items`, { ...itemParams, market: "from_token" }),
    },
    {
      projected: withFields(`/playlists/${playlistId}/tracks`, "playlistItems", itemParams),
      plain: withParams(`/playlists/${playlistId}/tracks`, { ...itemParams, market: "from_token" }),
    },
  ];

  let tracksError: SpotifyApiError | null = null;

  for (const endpoint of endpoints) {
    if (collected.length) break;
    // `next` URLs come back fully formed (and already carry the projection).
    let nextUrl: string | null = endpoint.projected;
    let plainUrl: string | null = endpoint.plain;
    let guard = 0;

    while (nextUrl && guard < 6) {
      const target: string = nextUrl;
      const fallbackTarget: string = plainUrl ?? target;
      try {
        const page = await spotifyFetchProjected<Paged<PlaylistItem>>(target, fallbackTarget, token);
        const rows = page.items ?? [];
        for (const item of rows) {
          const t = adaptPlaylistItem(item);
          if (t) collected.push(t);
          else if (item) skipped += 1; // episode or local file: not playable here
        }
        nextUrl = page.next ?? null;
        guard += 1;
        tracksError = null;
      } catch (error) {
        logApi("playlist:items", error);
        if (error instanceof SpotifyApiError) tracksError = error;
        nextUrl = null;
        break;
      }
    }
    if (collected.length) break;
    if (tracksError && tracksError.status !== 403 && tracksError.status !== 404) break;
  }

  // Playlist contents are only served for playlists you own or collaborate on;
  // the playlist object itself may still carry the first page inline.
  const inline = meta ? playlistRows(meta) : { rows: [], total: 0 };
  if (!collected.length && inline.rows.length) {
    for (const item of inline.rows) {
      const t = adaptPlaylistItem(item);
      if (t) collected.push(t);
      else if (item) skipped += 1;
    }
  }

  const playlist: EchoPlaylist | null = meta
    ? {
        ...adaptPlaylist(meta),
        tracks: collected,
        trackCount: Math.max(inline.total, collected.length),
        trackIds: collected.map((t) => t.id),
        skipped,
      }
    : null;

  // Nothing came back: report why instead of returning a silent empty list.
  if (!collected.length) {
    const failure = tracksError ?? metaError;
    if (failure) {
      return {
        playlist,
        tracks: [],
        skipped,
        error: { status: failure.status, message: spotifyMessage(failure.status, failure.path) },
      };
    }
  }

  const features = await fetchAudioFeatures(
    token,
    collected.map((t) => t.id),
  );
  if (features.size) for (const t of collected) Object.assign(t, features.get(t.id) ?? {});

  return { playlist, tracks: collected, skipped };
}

/* -------------------------------------------------------------------------- */
/*  Album and artist pages                                                     */
/* -------------------------------------------------------------------------- */

export interface AlbumPage {
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
  colors: Triad;
  uri: string;
  tracks: EchoTrack[];
}

export interface ArtistPage {
  id: string;
  name: string;
  bio: string;
  genres: string[];
  listeners: number;
  imageUrl: string | null;
  imageLargeUrl: string | null;
  externalUrl: string | null;
  colors: Triad;
  uri: string | null;
  /** Newest/popular tracks, assembled from the artist's own releases. */
  popularTracks: EchoTrack[];
  /** Collaborations: `appears_on` tracks that actually feature this artist. */
  appearsOn: EchoTrack[];
  albums: EchoPlaylist[];
  /** Endpoints that were refused, so the UI can explain a thin page. */
  degraded?: string[];
}

const albumPageCache = new Map<string, { at: number; value: AlbumPage }>();
const artistPageCache = new Map<string, { at: number; value: ArtistPage }>();

interface SpAlbumFull extends SpAlbum {
  total_tracks?: number;
  album_type?: string;
  genres?: string[];
  external_urls?: { spotify?: string };
}

/** `GET /v1/albums/{id}` + its track list, cached for 30 minutes. */
export async function fetchAlbumPage(token: string, albumId: string): Promise<AlbumPage> {
  const hit = albumPageCache.get(albumId);
  if (hit && Date.now() - hit.at < DETAIL_TTL_MS) return hit.value;
  if (rateLimited()) throw new SpotifyApiError("Rate limited", 429, "/albums/{id}");

  const album = await spotifyFetchSerial<SpAlbumFull>(
    withParams(`/albums/${albumId}`, { market: "from_token" }),
    token,
  );

  // Album tracks are paged at 50 per call.
  const tracks: EchoTrack[] = [];
  let nextUrl: string | null = withParams(`/albums/${albumId}/tracks`, {
    limit: 50,
    offset: 0,
    market: "from_token",
  });
  let guard = 0;
  while (nextUrl && guard < 5) {
    const target: string = nextUrl;
    try {
      const page: { items?: SpTrack[]; next?: string | null } =
        await spotifyFetchSerial<{ items?: SpTrack[]; next?: string | null }>(target, token);
      for (const raw of page.items ?? []) {
        if (!isRealTrack(raw)) continue;
        // Album track rows carry no album object — attach the one we already have.
        tracks.push(
          adaptTrack({
            ...raw,
            album: { id: albumId, name: album.name, images: album.images, release_date: album.release_date },
            artists: raw.artists?.length ? raw.artists : album.artists,
          }),
        );
      }
      nextUrl = page.next ?? null;
      guard += 1;
    } catch (error) {
      logApi("album:tracks", error);
      nextUrl = null;
    }
  }

  await fetchAudioFeatures(token, tracks.map((t) => t.id));

  const value: AlbumPage = {
    id: albumId,
    name: album.name,
    artist: (album.artists ?? []).map((a) => a.name).join(", ") || "Unknown Artist",
    artistId: album.artists?.[0]?.id ?? null,
    type: album.album_type ?? "album",
    releaseDate: album.release_date ?? null,
    year: album.release_date ? Number(album.release_date.slice(0, 4)) : null,
    totalTracks: album.total_tracks ?? tracks.length,
    genres: album.genres ?? [],
    imageUrl: pickImage(album.images, 300),
    imageLargeUrl: pickImage(album.images),
    colors: triadFromString(albumId, album.images),
    uri: album.uri ?? `spotify:album:${albumId}`,
    tracks,
  };
  albumPageCache.set(albumId, { at: Date.now(), value });
  return value;
}

/** Shared shape for `/artists/{id}/albums` rows. */
interface SpArtistAlbum {
  id: string;
  name: string;
  uri?: string;
  images?: SpImage[];
  release_date?: string;
  album_type?: string;
  album_group?: string;
  total_tracks?: number;
  artists?: SpArtist[];
  tracks?: { total?: number };
}

/** Release kind for the discography grid: appears_on/compilation/album/single/ep. */
function releaseKind(album: SpArtistAlbum): string {
  return (album.album_group ?? album.album_type ?? "album").toLowerCase();
}

/**
 * `GET /v1/artists/{id}/albums?include_groups=…&market=from_token&limit=…`
 */
async function artistAlbums(
  token: string,
  artistId: string,
  groups: string,
  limit: number,
): Promise<SpArtistAlbum[]> {
  const res = await spotifyFetchSerial<{ items?: SpArtistAlbum[] }>(
    withParams(`/artists/${artistId}/albums`, {
      include_groups: groups,
      market: "from_token",
      limit,
    }),
    token,
  );
  return (res.items ?? []).filter((album) => Boolean(album?.id));
}

/**
 * First page of `GET /v1/albums/{id}/tracks`, with the album object re-attached
 * (album track rows omit it) so artwork and release date survive.
 */
async function albumTracks(
  token: string,
  album: SpArtistAlbum,
  wanted: number,
): Promise<EchoTrack[]> {
  try {
    const page = await spotifyFetchSerial<{ items?: SpTrack[] }>(
      withParams(`/albums/${album.id}/tracks`, { limit: Math.min(50, Math.max(wanted, 1)), offset: 0, market: "from_token" }),
      token,
    );
    const out: EchoTrack[] = [];
    for (const raw of page.items ?? []) {
      if (!isRealTrack(raw)) continue;
      out.push(
        adaptTrack({
          ...raw,
          album: {
            id: album.id,
            name: album.name,
            uri: album.uri,
            images: album.images,
            release_date: album.release_date,
          },
          artists: raw.artists?.length ? raw.artists : album.artists,
        }),
      );
      if (out.length >= wanted) break;
    }
    return out;
  } catch (error) {
    logApi("artist:album-tracks", error);
    return [];
  }
}

/**
 * `GET /v1/artists/{id}` + discography, cached for 30 minutes.
 *
 * `/v1/artists/{id}/top-tracks` was **removed** for Development Mode apps in the
 * Feb 2026 migration and answering 503/404 there, so it is not called at all.
 * The "popular" list is assembled from the artist's own releases instead, and a
 * second list covers collaborations via `include_groups=appears_on`, keeping
 * only rows whose credits include this artist.
 */
export async function fetchArtistPage(token: string, artistId: string): Promise<ArtistPage> {
  const hit = artistPageCache.get(artistId);
  if (hit && Date.now() - hit.at < DETAIL_TTL_MS) return hit.value;
  if (rateLimited()) throw new SpotifyApiError("Rate limited", 429, "/artists/{id}");

  const artist = await spotifyFetchSerial<SpArtist & { external_urls?: { spotify?: string } }>(
    `/artists/${artistId}`,
    token,
  );

  const degraded: string[] = [];

  // ---- releases: own work, then collaborations ----
  let ownReleases: SpArtistAlbum[] = [];
  try {
    ownReleases = await artistAlbums(token, artistId, "album,single", 10);
  } catch (error) {
    degraded.push("albums");
    logApi("artist:albums", error);
  }

  let collabs: SpArtistAlbum[] = [];
  try {
    collabs = await artistAlbums(token, artistId, "appears_on", 10);
  } catch (error) {
    degraded.push("appears_on");
    logApi("artist:appears_on", error);
  }

  // ---- A. popular / newest: newest releases first, bounded album calls ----
  const popularTracks: EchoTrack[] = [];
  const seenPopular = new Set<string>();
  for (const album of ownReleases.slice(0, 5)) {
    if (popularTracks.length >= 10) break;
    const tracks = await albumTracks(token, album, 10 - popularTracks.length);
    for (const track of tracks) {
      if (seenPopular.has(track.id) || popularTracks.length >= 10) continue;
      seenPopular.add(track.id);
      popularTracks.push(track);
    }
  }

  // ---- B. appears on: only rows that actually credit this artist ----
  const appearsOn: EchoTrack[] = [];
  const seenAppears = new Set<string>();
  for (const album of collabs.slice(0, 6)) {
    if (appearsOn.length >= 30) break;
    const tracks = await albumTracks(token, album, 20);
    for (const track of tracks) {
      if (seenAppears.has(track.id) || seenPopular.has(track.id)) continue;
      const credited = (track.artistIds ?? []).includes(artistId);
      if (!credited) continue; // a compilation row the artist is not actually on
      seenAppears.add(track.id);
      appearsOn.push(track);
      if (appearsOn.length >= 30) break;
    }
  }

  const albums: EchoPlaylist[] = ownReleases.map((raw) => ({
    id: raw.id,
    name: raw.name,
    description: releaseKind(raw),
    owner: artist.name,
    colors: triadFromString(raw.id, raw.images),
    trackIds: [],
    trackCount: raw.total_tracks ?? raw.tracks?.total ?? 0,
    year: raw.release_date ? Number(raw.release_date.slice(0, 4)) || null : null,
    imageUrl: pickImage(raw.images, 300),
    imageLargeUrl: pickImage(raw.images),
    uri: raw.uri ?? `spotify:album:${raw.id}`,
  }));

  // BPM/key for everything we are about to render — one batched call.
  await fetchAudioFeatures(
    token,
    [...popularTracks, ...appearsOn].map((t) => t.id),
  );

  const value: ArtistPage = {
    id: artistId,
    name: artist.name,
    bio: (artist.genres ?? []).slice(0, 3).join(" · ") || "Artist on Spotify",
    genres: artist.genres ?? [],
    listeners: artist.followers?.total ?? 0,
    imageUrl: pickImage(artist.images, 300),
    imageLargeUrl: pickImage(artist.images),
    externalUrl: artist.external_urls?.spotify ?? `https://open.spotify.com/artist/${artistId}`,
    colors: triadFromString(artistId, artist.images),
    uri: artist.uri ?? `spotify:artist:${artistId}`,
    popularTracks,
    appearsOn,
    albums,
    degraded: degraded.length ? degraded : undefined,
  };
  artistPageCache.set(artistId, { at: Date.now(), value });
  return value;
}
