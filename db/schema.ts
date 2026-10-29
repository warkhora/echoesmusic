import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

/**
 * Echoes — persistence layer.
 *
 * The client is Spotify-first, but every surface also runs in a self-hosted
 * "Demo Mode" backed by this catalog so the product is fully explorable
 * without credentials. Listening telemetry + visual personalization are
 * always persisted here, regardless of mode.
 */

export const tracks = pgTable("tracks", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  artist: text("artist").notNull(),
  album: text("album").notNull(),
  durationMs: integer("duration_ms").notNull(),
  genre: text("genre").notNull(),
  year: integer("year"),
  /** Triad used by the procedural cover-art generator + ambient field. */
  colors: jsonb("colors").$type<[string, string, string]>().notNull(),
  artSeed: integer("art_seed").notNull(),
  playCount: integer("play_count").notNull().default(0),
  saved: boolean("saved").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const playlists = pgTable("playlists", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description").notNull(),
  owner: text("owner").notNull(),
  colors: jsonb("colors").$type<[string, string, string]>().notNull(),
  trackIds: jsonb("track_ids").$type<string[]>().notNull(),
  featured: boolean("featured").notNull().default(false),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const artists = pgTable("artists", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  bio: text("bio").notNull(),
  listeners: integer("listeners").notNull(),
  colors: jsonb("colors").$type<[string, string, string]>().notNull(),
});

/**
 * Cached Spotify audio features (BPM, key, energy…). Spotify rate-limits and
 * restricts /audio-features for newer client ids, so we persist whatever we
 * manage to read once and never ask twice.
 */
export const trackFeatures = pgTable("track_features", {
  trackId: text("track_id").primaryKey(),
  bpm: integer("bpm"),
  key: integer("key"),
  mode: integer("mode"),
  energy: integer("energy"),
  danceability: integer("danceability"),
  valence: integer("valence"),
  tempoConfidence: integer("tempo_confidence"),
  fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull().defaultNow(),
});

export const listeningEvents = pgTable("listening_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  trackId: text("track_id").notNull(),
  trackTitle: text("track_title").notNull(),
  artist: text("artist").notNull(),
  source: text("source").notNull(),
  progressMs: integer("progress_ms").notNull().default(0),
  durationMs: integer("duration_ms").notNull().default(0),
  completed: boolean("completed").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [index("listening_events_created_at_idx").on(table.createdAt)]);

export const preferences = pgTable("preferences", {
  id: text("id").primaryKey(),
  blurIntensity: integer("blur_intensity").notNull().default(5),
  theme: text("theme").notNull().default("cosmos"),
  ambientEnabled: boolean("ambient_enabled").notNull().default(true),
  grainEnabled: boolean("grain_enabled").notNull().default(true),
  motionEnabled: boolean("motion_enabled").notNull().default(true),
  colorSync: boolean("color_sync").notNull().default(true),
  volume: integer("volume").notNull().default(72),
  font1: text("font1").notNull().default("Montserrat"),
  font2: text("font2").notNull().default("Outfit"),
  experimentalGlass: boolean("experimental_glass").notNull().default(true),
  distortion: integer("distortion").notNull().default(100),
  uiScale: integer("ui_scale").notNull().default(100),
  autoplay: boolean("autoplay").notNull().default(true),
  coverAnimations: boolean("cover_animations").notNull().default(true),
  pageTransitions: boolean("page_transitions").notNull().default(true),
  uiAnimations: boolean("ui_animations").notNull().default(true),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Server-side mirror of the browser PKCE session.
 *
 * Only an opaque random id travels in the httpOnly cookie — the tokens stay in
 * Postgres. This is what lets an API route refresh an expired access token by
 * itself (the PKCE refresh grant needs only the public client id, never a
 * secret) instead of answering 401/403.
 */
export const spotifySessions = pgTable("spotify_sessions", {
  id: text("id").primaryKey(),
  accessToken: text("access_token").notNull(),
  refreshToken: text("refresh_token"),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  scope: text("scope"),
  profileId: text("profile_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const profiles = pgTable("profiles", {
  id: text("id").primaryKey(),
  displayName: text("display_name").notNull(),
  avatarUrl: text("avatar_url"),
  product: text("product"),
  mode: text("mode").notNull().default("demo"),
  connectedAt: timestamp("connected_at", { withTimezone: true }).notNull().defaultNow(),
});
