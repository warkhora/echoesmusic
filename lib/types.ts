export type Triad = [string, string, string];

export interface EchoTrack {
  id: string;
  title: string;
  artist: string;
  album: string;
  durationMs: number;
  /** Primary genre when known; "" when Spotify did not supply one. */
  genre: string;
  year?: number | null;
  /** Full `album.release_date` — the Release Date column renders `.slice(0, 4)`. */
  releaseDate?: string | null;
  /** `album.genres` — the Genre column's last-resort source before "-". */
  albumGenres?: string[];
  colors: Triad;
  artSeed: number;
  imageUrl?: string | null;
  /** Largest available artwork (Spotify returns several resolutions). */
  imageLargeUrl?: string | null;
  playCount?: number;
  saved?: boolean;
  explicit?: boolean;
  albumId?: string | null;
  /** From `is_playable` when a market was supplied — no manual market maths. */
  playable?: boolean;
  uri?: string;
  artistIds?: string[];
  /** Structured credits: `artistList[0]` is the primary artist. */
  artistList?: EchoArtistCredit[];
  addedAt?: string | null;
  /** Appended by the Autoplay recommender (shown with an "Autoplay" badge). */
  auto?: boolean;
  /* audio features — null when Spotify withholds them for this client id */
  bpm?: number | null;
  musicalKey?: string | null;
  energy?: number | null;
  danceability?: number | null;
  valence?: number | null;
}

export interface EchoArtistCredit {
  id: string;
  name: string;
  uri?: string | null;
  externalUrl?: string | null;
}

export interface EchoPlaylist {
  id: string;
  name: string;
  description: string;
  owner: string;
  colors: Triad;
  trackIds: string[];
  /** Spotify reports the real total even before the items are paged in. */
  trackCount?: number;
  /** Playlist contents are only served for owned / collaborative playlists. */
  owned?: boolean;
  collaborative?: boolean;
  /** Episodes and local files we had to skip. */
  skipped?: number;
  featured?: boolean;
  imageUrl?: string | null;
  imageLargeUrl?: string | null;
  /** Present once the playlist detail has been resolved. */
  tracks?: EchoTrack[];
  /** Release year — populated for artist discography entries. */
  year?: number | null;
  /** Spotify owner id, used to decide playlist ownership in Echoes. */
  ownerId?: string | null;
  uri?: string;
}

export interface EchoArtist {
  id: string;
  name: string;
  bio: string;
  /** Removed for Development Mode apps in Feb 2026 — 0 when absent. */
  listeners: number;
  /** `artist.genres` — the Genre column reads `genres[0]` from cache only. */
  genres?: string[];
  colors: Triad;
  imageUrl?: string | null;
  imageLargeUrl?: string | null;
  /**
   * The raw `artist.images` array, largest first: `images[0]` is the high-res
   * banner, `images[1]` a medium fallback if a CDN link has expired.
   */
  images?: { url: string; width: number | null; height: number | null }[];
  uri?: string | null;
  /** `external_urls.spotify` — the "View on Spotify" target. */
  externalUrl?: string | null;
}

export interface EchoProfile {
  id: string;
  displayName: string;
  avatarUrl?: string | null;
  product?: string | null;
  mode: "demo" | "spotify";
}

export interface ListeningEvent {
  id: string;
  trackId: string;
  trackTitle: string;
  artist: string;
  source: string;
  progressMs: number;
  durationMs: number;
  completed: boolean;
  createdAt: string;
}

export interface Preferences {
  blurIntensity: number;
  theme: ThemeValue;
  ambientEnabled: boolean;
  grainEnabled: boolean;
  motionEnabled: boolean;
  colorSync: boolean;
  volume: number;
  /** Font 1 — song titles and body text. */
  font1: string;
  /** Font 2 — headings and hero titles. */
  font2: string;
  /** Experimental refractive liquid glass (default off). */
  experimentalGlass: boolean;
  /** Distortion length, 25 – 200 %. */
  distortion: number;
  /** Global UI scale, percent 50–150 (default 100). */
  uiScale: number;
  /** Autoplay similar tracks when a queue or single track ends (default ON). */
  autoplay: boolean;
  /** Hover/zoom on album art, covers and avatars. */
  coverAnimations: boolean;
  /** Fade/slide transitions between pages. */
  pageTransitions: boolean;
  /** Scale/fade on menus, panels and button presses. */
  uiAnimations: boolean;
}

export type ThemeId = "cosmos" | "aurora" | "frost" | "artwork";

/**
 * A theme is either a preset id or `custom:<paletteId>` (see lib/design.ts).
 * Kept as a string so user-built palettes need no schema change.
 */
export type ThemeValue = ThemeId | string;

/** One-shot payload returned by /api/spotify/library (and mirrored by the demo catalog). */
export interface SpotifyLibraryPayload {
  playlists: EchoPlaylist[];
  tracks: EchoTrack[];
  artists: EchoArtist[];
  recentlyPlayed: EchoTrack[];
  topTracks: EchoTrack[];
  savedTracks: EchoTrack[];
  deviceName?: string | null;
  isPlaying?: boolean;
  progressMs?: number;
  currentTrackId?: string | null;
  /** Endpoints that failed — the rest of the payload is still usable. */
  degraded?: string[];
  cachedAt?: string;
}

export interface Catalog {
  tracks: EchoTrack[];
  playlists: EchoPlaylist[];
  artists: EchoArtist[];
  recentlyPlayed: EchoTrack[];
  topTracks: EchoTrack[];
  stats: ListeningStats;
}

export interface ListeningStats {
  events: number;
  minutes: number;
  completionRate: number;
  topArtists: { artist: string; plays: number }[];
  sessions: { day: string; minutes: number }[];
}

export const DEFAULT_PREFERENCES: Preferences = {
  // v3.0.0 visual standard: sharp glass, refraction on by default.
  blurIntensity: 5,
  theme: "cosmos",
  ambientEnabled: true,
  grainEnabled: true,
  motionEnabled: true,
  colorSync: true,
  volume: 72,
  // v7.0.1 defaults
  font1: "Montserrat",
  font2: "Outfit",
  uiScale: 100,
  autoplay: true,
  experimentalGlass: true,
  distortion: 100,
  coverAnimations: true,
  pageTransitions: true,
  uiAnimations: true,
};

export const THEMES: {
  id: ThemeId;
  name: string;
  blurb: string;
  colors: Triad;
}[] = [
  {
    id: "cosmos",
    name: "Deep Cosmic",
    blurb: "Indigo drift, violet bloom",
    colors: ["#3b2fd1", "#8b5cf6", "#d946a8"],
  },
  {
    id: "aurora",
    name: "Emerald Aurora",
    blurb: "Cold greens over black water",
    colors: ["#0f9d76", "#14b8a6", "#38e1c6"],
  },
  {
    id: "frost",
    name: "Monochrome Frost",
    blurb: "Silver, slate and quiet light",
    colors: ["#6b7a90", "#aeb9c9", "#e6ebf2"],
  },
  {
    id: "artwork",
    name: "Album Art Sync",
    blurb: "Palette pulled from the playing track",
    colors: ["#4c3bd4", "#c2410c", "#0ea5e9"],
  },
];

export function themeColors(id: ThemeId): Triad {
  return THEMES.find((t) => t.id === id)?.colors ?? THEMES[0].colors;
}

export function formatTime(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) ms = 0;
  const total = Math.floor(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export function formatCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return `${n}`;
}

export function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  const diff = Date.now() - then;
  const mins = Math.round(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.round(hrs / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
