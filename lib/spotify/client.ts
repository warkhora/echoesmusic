import { safeJson } from "@/lib/http";
import { SPOTIFY_API_URL } from "@/lib/spotify/auth";
import type { EchoArtist, EchoPlaylist, EchoTrack, Triad } from "@/lib/types";

/*
 * Spotify Web API object model — aligned with the February 2026 migration.
 *
 *   GET /playlists/{id}/tracks  →  GET /playlists/{id}/items
 *   playlist.tracks             →  playlist.items
 *   playlist.tracks.items[]     →  playlist.items.items[]
 *   row.track                   →  row.item        (and `track` survives as a BOOLEAN)
 *   PUT|DELETE /me/tracks       →  PUT|DELETE /me/library?uris=…   (≤40 URIs)
 *   GET /me/tracks/contains     →  GET /me/library/contains?uris=…
 *   batch ?ids= fetches         →  individual GET /artists/{id}, /albums/{id}, /tracks/{id}
 *   removed fields              →  preview_url, popularity, available_markets,
 *                                  artist.followers / artist.genres (often absent)
 *
 * Every reader below accepts BOTH the new and the legacy shape, because
 * Extended Quota apps are still served the old one and playlist contents are
 * only returned for playlists the user owns or collaborates on.
 */

export class SpotifyApiError extends Error {
  status: number;
  path: string;
  constructor(message: string, status: number, path: string) {
    super(message);
    this.status = status;
    this.path = path;
  }
}

/** Every request carries the user token; `market=from_token` relinks to the user's country. */
export async function spotifyFetch<T>(
  path: string,
  token: string,
  init: RequestInit = {},
): Promise<T> {
  const url = path.startsWith("http") ? path : `${SPOTIFY_API_URL}${path}`;
  const res = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });
  if (res.status === 204 || res.status === 202) return undefined as T;
  if (!res.ok) throw new SpotifyApiError(spotifyMessage(res.status, path), res.status, path);
  // Most Spotify writes answer 204; some answer 200 with an empty body. Both
  // are "no content", not a JSON parse error.
  return (await safeJson<T>(res)) as T;
}

/**
 * Fetches a list endpoint with a `fields` projection, retrying once without it.
 *
 * A projection Spotify dislikes answers 400; without this fallback a typo or an
 * API change would surface as an empty library rather than a slightly larger
 * response.
 */
export async function spotifyFetchProjected<T>(
  projectedPath: string,
  plainPath: string,
  token: string,
  init: RequestInit = {},
): Promise<T> {
  try {
    return await spotifyFetch<T>(projectedPath, token, init);
  } catch (error) {
    if (error instanceof SpotifyApiError && error.status === 400 && projectedPath !== plainPath) {
      console.info("[echoes] fields projection rejected, retrying without it");
      return spotifyFetch<T>(plainPath, token, init);
    }
    throw error;
  }
}

/* -------------------------------------------------------------------------- */
/*  Global request lane                                                        */
/*                                                                             */
/*  Every metadata call in the app — library lists, playlist pages, artist and */
/*  album detail, audio-feature batches — funnels through one serialized queue  */
/*  with a minimum spacing between requests. Parallel fan-out against Spotify   */
/*  is what produced the 503/429 storms; a single lane makes flooding           */
/*  structurally impossible regardless of how many components ask at once.      */
/*                                                                             */
/*  Playback commands deliberately do NOT queue: they are user-initiated,       */
/*  low-volume, and must not wait behind a metadata batch.                      */
/* -------------------------------------------------------------------------- */

const MIN_SPACING_MS = 140;
let laneTail: Promise<unknown> = Promise.resolve();
let lastDispatchAt = 0;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Runs `operation` after every queued metadata call, spaced out. */
export function enqueueSpotify<T>(operation: () => Promise<T>): Promise<T> {
  const run = async (): Promise<T> => {
    const wait = MIN_SPACING_MS - (Date.now() - lastDispatchAt);
    if (wait > 0) await sleep(wait);
    lastDispatchAt = Date.now();
    return operation();
  };
  const result = laneTail.then(run, run);
  // Keep the chain alive even when a call rejects.
  laneTail = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

/** `spotifyFetch` through the serial lane — use for all metadata reads. */
export function spotifyFetchSerial<T>(
  path: string,
  token: string,
  init: RequestInit = {},
): Promise<T> {
  return enqueueSpotify(() => spotifyFetch<T>(path, token, init));
}

export function spotifyMessage(status: number, path: string): string {
  const where = path.split("?")[0];
  switch (status) {
    case 401:
      return `Spotify rejected the token (401) on ${where}. Reconnect to refresh it.`;
    case 403:
      if (where.includes("/playlists/")) {
        return `Spotify only returns playlist contents for playlists you own or collaborate on (403 on ${where}).`;
      }
      return where.startsWith("/me/player")
        ? "Playback control needs Spotify Premium and an active device (403)."
        : `Spotify refused ${where} (403) — the scope or app tier does not allow it.`;
    case 404:
      return where.startsWith("/me/player")
        ? "No active Spotify device found (404). Start playback in the Spotify app once."
        : `Nothing at ${where} (404).`;
    case 429:
      return "Spotify rate limit hit (429) — backing off.";
    default:
      return `Spotify API ${status} on ${where}.`;
  }
}

/* ------------------------------- query helpers ---------------------------- */

export const MARKET = "market=from_token";
/** Playlists may hold episodes; without this Spotify answers 403. */
export const ADDITIONAL_TYPES = "additional_types=track,episode";

export function withParams(
  path: string,
  params: Record<string, string | number | boolean | undefined | null>,
): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === "") continue;
    search.set(key, String(value));
  }
  const query = search.toString();
  return query ? `${path}?${query}` : path;
}

/* -------------------------------- raw shapes ------------------------------ */

export interface SpImage {
  url: string;
  height: number | null;
  width: number | null;
}
export interface SpArtist {
  id?: string;
  name: string;
  uri?: string;
  type?: string;
  external_urls?: { spotify?: string };
  images?: SpImage[];
  /** Removed for Development Mode apps in Feb 2026 — treat as optional. */
  followers?: { total?: number } | null;
  genres?: string[] | null;
}
export interface SpAlbum {
  id?: string;
  name: string;
  uri?: string;
  type?: string;
  images?: SpImage[];
  release_date?: string;
  artists?: SpArtist[];
}
export interface SpTrack {
  id: string;
  name: string;
  uri: string;
  duration_ms: number;
  album?: SpAlbum;
  artists?: SpArtist[];
  explicit?: boolean;
  is_local?: boolean;
  /** Present when a `market` was supplied — no manual available_markets maths. */
  is_playable?: boolean;
  restrictions?: { reason?: string } | null;
  type?: string;
  episode?: boolean;
  /** Relinked tracks nest the playable instance one level down. */
  track?: SpTrack;
}
/**
 * One row of a playlist. Feb 2026 uses `item`; the legacy shape uses `track`,
 * which now also appears as a **boolean** — reading it blindly yields `true`
 * and makes a full playlist look empty.
 */
export interface SpPlaylistItem {
  item?: SpTrack | null;
  track?: SpTrack | boolean | null;
  added_at?: string | null;
}
/** Kept as an alias so existing imports keep reading naturally. */
export type PlaylistItem = SpPlaylistItem;

export interface SpPaging<T> {
  items?: T[];
  next?: string | null;
  total?: number;
  limit?: number;
  offset?: number;
}
export interface SpPlaylist {
  id: string;
  name: string;
  description?: string;
  uri: string;
  images?: SpImage[];
  owner?: { display_name?: string; id?: string } | null;
  /** Feb 2026: contents live here, and only for owned/collaborative playlists. */
  items?: SpPaging<SpPlaylistItem> | SpPlaylistItem[] | null;
  /** Legacy shape, still served to Extended Quota apps. */
  tracks?: SpPaging<SpPlaylistItem> | { total?: number } | null;
  collaborative?: boolean | null;
  public?: boolean | null;
  followers?: { total?: number } | null;
}
export interface SpAudioFeatures {
  id: string;
  tempo?: number | null;
  key?: number | null;
  mode?: number | null;
  energy?: number | null;
  danceability?: number | null;
  valence?: number | null;
}
/** One output device. `is_restricted` devices cannot be controlled remotely. */
export interface SpDevice {
  id: string | null;
  name: string;
  type: string;
  is_active: boolean;
  is_restricted: boolean;
  supports_volume?: boolean;
  volume_percent?: number | null;
}

export interface SpDevicesResponse {
  devices: SpDevice[];
}

export interface SpPlayerState {
  is_playing: boolean;
  progress_ms: number | null;
  shuffle_state?: boolean;
  repeat_state?: "off" | "context" | "track";
  /** `/me/player` already carries the active device, including its id. */
  device?: SpDevice | null;
  item?: SpTrack | null;
  context?: { uri?: string } | null;
}
/** `GET /me/library` style row: any saved entity, tagged by type. */
export interface SpLibraryItem {
  type?: string;
  item?: SpTrack | SpAlbum | SpArtist | null;
  track?: SpTrack | null;
  added_at?: string | null;
  uri?: string;
}

export const FALLBACK: Triad = ["#4c3bd4", "#8b5cf6", "#d946a8"];

/* --------------------------------- helpers -------------------------------- */

/** Spotify returns images largest-first, but never trust ordering blindly. */
export function pickImage(images: SpImage[] | undefined, prefer = 0): string | null {
  if (!images?.length) return null;
  if (prefer === 0) {
    const biggest = images.reduce((a, b) => ((b.width ?? 0) > (a.width ?? 0) ? b : a), images[0]);
    return biggest.url ?? null;
  }
  const sorted = [...images].sort((a, b) => (a.width ?? 0) - (b.width ?? 0));
  const target = sorted.find((i) => (i.width ?? 0) >= prefer) ?? sorted[sorted.length - 1];
  return target?.url ?? null;
}

/** Deterministic triad so cards stay colourful without artwork. */
export function triadFromString(input: string, image?: SpImage[]): Triad {
  const src = image?.[0]?.url ?? input;
  let h = 2166136261;
  for (let i = 0; i < src.length; i++) {
    h ^= src.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  const hue = Math.abs(h) % 360;
  return [
    `hsl(${hue} 62% 34%)`,
    `hsl(${(hue + 38) % 360} 68% 48%)`,
    `hsl(${(hue + 300) % 360} 72% 62%)`,
  ];
}

const KEY_NAMES = ["C", "C♯", "D", "D♯", "E", "F", "F♯", "G", "G♯", "A", "A♯", "B"];

export function keyName(key?: number | null, mode?: number | null): string | null {
  if (key === null || key === undefined || key < 0 || key > 11) return null;
  return `${KEY_NAMES[key]}${mode === 0 ? "m" : ""}`;
}

/** Episodes, local files and the boolean `track` trap are all rejected here. */
export function isRealTrack(candidate?: SpTrack | boolean | null): candidate is SpTrack {
  if (!candidate || typeof candidate !== "object") return false;
  const track = candidate as SpTrack;
  if (!track.id) return false;
  if (track.type === "episode" || track.episode) return false;
  if (track.is_local) return false;
  return true;
}

/** Reads a playlist's contents from either the new `items` or legacy `tracks`. */
export function playlistRows(playlist: SpPlaylist): { rows: SpPlaylistItem[]; total: number } {
  const source = playlist.items ?? playlist.tracks ?? null;
  if (!source) return { rows: [], total: 0 };
  if (Array.isArray(source)) return { rows: source, total: source.length };
  const rows = "items" in source && Array.isArray(source.items) ? source.items : [];
  const total = "total" in source && typeof source.total === "number" ? source.total : rows.length;
  return { rows, total };
}

/** `row.item` wins; `row.track` is only honoured when it is an object. */
export function rowTrack(row?: SpPlaylistItem | null): SpTrack | null {
  if (!row) return null;
  if (isRealTrack(row.item)) return row.item as SpTrack;
  if (row.track && typeof row.track === "object" && isRealTrack(row.track)) return row.track;
  // Legacy rows sometimes nest the playable instance under `track.track`.
  const nested = row.track && typeof row.track === "object" ? (row.track as SpTrack).track : null;
  return isRealTrack(nested) ? nested : null;
}

/* -------------------------------- adapters -------------------------------- */

export function adaptTrack(raw: SpTrack, addedAt?: string | null): EchoTrack {
  const album = raw.album;
  const artists = raw.artists ?? [];
  const playable = isRealTrack(raw.track) ? raw.track : raw;
  const seed = album?.id ?? playable.id;
  const year = album?.release_date ? Number(album.release_date.slice(0, 4)) : null;

  return {
    id: playable.id,
    title: playable.name,
    artist: artists.map((a) => a.name).join(", ") || "Unknown Artist",
    artistIds: artists.map((a) => a.id).filter((id): id is string => Boolean(id)),
    artistList: artists.map((a) => ({
      id: a.id ?? "",
      name: a.name,
      uri: a.uri ?? null,
      externalUrl: a.external_urls?.spotify ?? null,
    })),
    album: album?.name ?? "Single",
    albumId: album?.id ?? null,
    durationMs: playable.duration_ms ?? 0,
    // Genre is a genre, not a year: the column resolves it from the artist
    // cache and renders "-" when Spotify supplied nothing.
    genre: (artists[0] as SpArtist & { genres?: string[] }).genres?.[0] ?? "",
    year,
    releaseDate: album?.release_date ?? null,
    albumGenres: ((album as SpAlbum & { genres?: string[] })?.genres ?? []).filter(Boolean),
    colors: triadFromString(seed, album?.images),
    artSeed: Math.abs(hashCode(seed)) % 997,
    // Artwork URLs are short-lived CDN links: always taken fresh from the
    // response, never persisted and never reused across sessions.
    imageUrl: pickImage(album?.images, 300),
    imageLargeUrl: pickImage(album?.images),
    explicit: Boolean(playable.explicit),
    playable: playable.is_playable ?? true,
    uri: playable.uri,
    addedAt: addedAt ?? null,
    saved: false,
  };
}

export function adaptPlaylistItem(row?: SpPlaylistItem | null): EchoTrack | null {
  const track = rowTrack(row);
  if (!track) return null;
  return adaptTrack(track, row?.added_at ?? null);
}

export function adaptPlaylist(raw: SpPlaylist): EchoPlaylist {
  const { rows, total } = playlistRows(raw);
  const items = rows.map(adaptPlaylistItem).filter((t): t is EchoTrack => Boolean(t));
  const skipped = rows.length - items.length;

  return {
    id: raw.id,
    name: raw.name || "Untitled",
    description: stripHtml(raw.description ?? "") || "A playlist from your library.",
    owner: raw.owner?.display_name || raw.owner?.id || "You",
    colors: triadFromString(raw.id, raw.images),
    trackIds: items.map((t) => t.id),
    trackCount: total || items.length,
    ownerId: raw.owner?.id ?? null,
    owned: Boolean(raw.owner?.id) || raw.collaborative === true,
    collaborative: Boolean(raw.collaborative),
    skipped,
    imageUrl: pickImage(raw.images, 300),
    imageLargeUrl: pickImage(raw.images),
    uri: raw.uri,
    tracks: items.length ? items : undefined,
  };
}

export function adaptArtist(raw: SpArtist): EchoArtist {
  return {
    id: raw.id ?? raw.uri ?? raw.name,
    externalUrl: raw.external_urls?.spotify ?? null,
    name: raw.name,
    // `genres` and `followers` are removed/empty for Development Mode apps.
    bio: (raw.genres ?? []).slice(0, 3).join(" · ") || "Artist on Spotify",
    genres: raw.genres ?? [],
    listeners: raw.followers?.total ?? 0,
    colors: triadFromString(raw.id ?? raw.name, raw.images),
    imageUrl: pickImage(raw.images, 300),
    imageLargeUrl: pickImage(raw.images),
    // Kept verbatim so the UI can read images[0] (high-res) and fall back to
    // images[1] when a CDN URL has expired.
    images: (raw.images ?? []).map((image) => ({
      url: image.url,
      width: image.width ?? null,
      height: image.height ?? null,
    })),
    uri: raw.uri ?? null,
  };
}

/**
 * Banner source for an artist: `images[0].url` (high-res) first, then the
 * medium cut, then whichever resolved URL we already have.
 */
export function artistImageSources(artist?: {
  images?: { url: string }[];
  imageLargeUrl?: string | null;
  imageUrl?: string | null;
} | null): string[] {
  if (!artist) return [];
  const ordered = [
    artist.images?.[0]?.url, // high-res
    artist.images?.[1]?.url, // medium — the fallback when a CDN link expires
    artist.imageLargeUrl,
    artist.imageUrl,
  ].filter((url): url is string => Boolean(url));
  // Deduplicated so an onError step actually lands on a different resolution.
  return [...new Set(ordered)];
}

/**
 * Ranks candidate devices for an automatic transfer: an already-active device
 * first, then controllable ones by how likely they are to be a real client
 * (desktop/web before phones before speakers), preferring devices that report
 * a volume — a proxy for "the app is actually open".
 */
const DEVICE_RANK: Record<string, number> = {
  computer: 0,
  desktop: 0,
  web: 1,
  browser: 1,
  smartphone: 2,
  tablet: 3,
  tv: 4,
  speaker: 5,
  castaudio: 5,
  audiobook: 6,
};

export function rankDevice(device: SpDevice): number {
  const type = (device.type ?? "").toLowerCase();
  const base = DEVICE_RANK[type] ?? 4;
  const hasVolume = typeof device.volume_percent === "number" ? 0 : 1;
  return base * 2 + hasVolume;
}

export function pickDevice(devices: SpDevice[]): SpDevice | null {
  const controllable = devices.filter((d) => d.id && !d.is_restricted);
  if (!controllable.length) return null;
  const active = controllable.find((d) => d.is_active);
  if (active) return active;
  return [...controllable].sort((a, b) => rankDevice(a) - rankDevice(b))[0] ?? null;
}

export function describeDevice(device: SpDevice): string {
  const type = (device.type ?? "device").toLowerCase();
  const label =
    type === "computer" || type === "desktop"
      ? "desktop app"
      : type === "web" || type === "browser"
        ? "web player"
        : type === "smartphone"
          ? "phone"
          : type === "tablet"
            ? "tablet"
            : type === "tv"
              ? "TV"
              : type === "speaker" || type === "castaudio"
                ? "speaker"
                : "device";
  return `${device.name} (${label})`;
}

export function adaptFeatures(raw: SpAudioFeatures | null | undefined): Partial<EchoTrack> {
  if (!raw) return {};
  return {
    bpm: raw.tempo ? Math.round(raw.tempo) : null,
    musicalKey: keyName(raw.key, raw.mode),
    energy: typeof raw.energy === "number" ? Math.round(raw.energy * 100) / 100 : null,
    danceability:
      typeof raw.danceability === "number" ? Math.round(raw.danceability * 100) / 100 : null,
    valence: typeof raw.valence === "number" ? Math.round(raw.valence * 100) / 100 : null,
  };
}

/** Rows from `GET /me/library` (any entity type) and the legacy `/me/tracks`. */
export function adaptLibraryItem(row: SpLibraryItem | null | undefined): EchoTrack | null {
  if (!row) return null;
  const candidate = row.item ?? row.track;
  if (!candidate || typeof candidate !== "object") return null;
  // `/me/library` mixes entity types: albums and artists both carry an `id`.
  const kind = (candidate as { type?: string }).type ?? row.type;
  if (kind && kind !== "track") return null;
  if (!isRealTrack(candidate as SpTrack)) return null;
  return adaptTrack(candidate as SpTrack, row.added_at ?? null);
}

function stripHtml(input: string): string {
  return input.replace(/<[^>]*>/g, "").trim();
}

function hashCode(input: string): number {
  let h = 0;
  for (let i = 0; i < input.length; i++) h = (Math.imul(31, h) + input.charCodeAt(i)) | 0;
  return h;
}
