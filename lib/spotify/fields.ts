/**
 * Spotify `fields` projections.
 *
 * The Web API lets a caller ask for a subset of an object graph. Echoes only
 * renders a handful of properties, so every list request is narrowed — smaller
 * payloads, less JSON to walk, and materially fewer bytes per poll of the
 * library endpoints.
 *
 * Risk management: a malformed projection makes Spotify answer 400, so every
 * caller goes through `withFieldsFallback()`, which retries once without the
 * projection rather than surfacing an empty library.
 */

/** Track properties the adapters and UI actually read. */
const TRACK_FIELDS =
  "id,name,uri,type,duration_ms,explicit,is_local,is_playable," +
  "artists(id,name,uri,external_urls(spotify))," +
  "album(id,name,uri,images,release_date,artists(id,name))";

/**
 * One row of a playlist. The row wrapper matters: since Feb 2026 the track sits
 * under `item`, before that under `track`. Projecting the track fields at the
 * row level instead would silently return empty rows.
 */
const PLAYLIST_ITEM_FIELDS =
  `items(added_at,type,is_local,item(${TRACK_FIELDS}),track(${TRACK_FIELDS}))`;
void PLAYLIST_ITEM_FIELDS;

/**
 * Rows on `/me/tracks` and `/me/player/recently-played` are WRAPPED: the track
 * sits under `track` (legacy) or `item` (unified library shape), with
 * `added_at` / `played_at` beside it. Projecting the track fields at row level
 * is accepted by Spotify but returns rows with no track inside — which silently
 * empties the Saved list. Both wrappers are always requested.
 */
const WRAPPED_TRACK_ROW = (stamp: string) =>
  `items(${stamp},type,item(${TRACK_FIELDS}),track(${TRACK_FIELDS}))`;

export const FIELD_SPECS = {
  /** `GET /me/playlists` — the grid needs metadata, not contents. */
  playlists:
    "items(id,name,description,uri,images,owner(id,display_name),collaborative,public,tracks(total)),next,limit",
  /** `GET /playlists/{id}` — the object itself. */
  playlist: `id,name,description,uri,images,owner(id,display_name),collaborative,public,tracks(total),${PLAYLIST_ITEM_FIELDS}`,
  /** `GET /playlists/{id}/items` — the paged contents. */
  playlistItems: `${PLAYLIST_ITEM_FIELDS},next,limit,total`,
  /** `GET /me/tracks` — saved rows (wrapped). */
  savedTracks: `${WRAPPED_TRACK_ROW("added_at")},next,limit,total`,
  /** `GET /me/player/recently-played` — also wrapped. */
  recentlyPlayed: `${WRAPPED_TRACK_ROW("played_at")},next,limit,cursors`,
  /** `GET /me/top/tracks`. */
  topTracks: `items(${TRACK_FIELDS}),next,limit,total`,
  /** `GET /me/top/artists`. */
  topArtists: "items(id,name,uri,images,genres,followers(total)),next,limit,total",
  /**
   * `GET /me/player` — deliberately *not* narrowed: the transport needs
   * device, repeat/shuffle and progress alongside the item.
   */
  player: undefined,
} as const;

export type FieldSpecKey = keyof typeof FIELD_SPECS;

/** Appends `fields=…` when a projection exists for this call. */
export function withFields(
  path: string,
  spec: FieldSpecKey | string | undefined,
  extraParams?: Record<string, string | number | boolean | undefined | null>,
): string {
  const projection = typeof spec === "string" && spec in FIELD_SPECS ? FIELD_SPECS[spec as FieldSpecKey] : spec;
  const url = new URL(path, "https://api.spotify.com");
  url.searchParams.set("market", "from_token");
  if (extraParams) {
    for (const [key, value] of Object.entries(extraParams)) {
      if (value === undefined || value === null || value === "") continue;
      url.searchParams.set(key, String(value));
    }
  }
  if (typeof projection === "string" && projection.length > 0) {
    url.searchParams.set("fields", projection);
  }
  // Return the path + query only; spotifyFetch prefixes the API origin itself.
  return `${url.pathname.replace(/^\/v1/, "")}${url.search}`;
}

/** True when Spotify rejected the request because of the projection itself. */
export function isFieldsRejection(status: number, message: string): boolean {
  if (status !== 400) return false;
  return /field|invalid|parameter/i.test(message);
}
