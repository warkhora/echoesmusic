import { pool } from "@/db";

/**
 * Idempotent schema bootstrap.
 *
 * `npx drizzle-kit push` is the supported path, but a route should never answer
 * 500/503 just because somebody deployed without running it. These statements
 * are `IF NOT EXISTS`, run at most once per process, and are only retried when
 * a query actually fails with "relation does not exist".
 */

const DDL = `
CREATE TABLE IF NOT EXISTS "tracks" (
  "id" text PRIMARY KEY,
  "title" text NOT NULL,
  "artist" text NOT NULL,
  "album" text NOT NULL,
  "duration_ms" integer NOT NULL,
  "genre" text NOT NULL,
  "year" integer,
  "colors" jsonb NOT NULL,
  "art_seed" integer NOT NULL,
  "play_count" integer NOT NULL DEFAULT 0,
  "saved" boolean NOT NULL DEFAULT false,
  "created_at" timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "playlists" (
  "id" text PRIMARY KEY,
  "name" text NOT NULL,
  "description" text NOT NULL,
  "owner" text NOT NULL,
  "colors" jsonb NOT NULL,
  "track_ids" jsonb NOT NULL,
  "featured" boolean NOT NULL DEFAULT false,
  "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "artists" (
  "id" text PRIMARY KEY,
  "name" text NOT NULL,
  "bio" text NOT NULL,
  "listeners" integer NOT NULL,
  "colors" jsonb NOT NULL
);

CREATE TABLE IF NOT EXISTS "listening_events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "track_id" text NOT NULL,
  "track_title" text NOT NULL,
  "artist" text NOT NULL,
  "source" text NOT NULL,
  "progress_ms" integer NOT NULL DEFAULT 0,
  "duration_ms" integer NOT NULL DEFAULT 0,
  "completed" boolean NOT NULL DEFAULT false,
  "created_at" timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "listening_events_created_at_idx" ON "listening_events" ("created_at");

CREATE TABLE IF NOT EXISTS "preferences" (
  "id" text PRIMARY KEY,
  "blur_intensity" integer NOT NULL DEFAULT 26,
  "theme" text NOT NULL DEFAULT 'cosmos',
  "ambient_enabled" boolean NOT NULL DEFAULT true,
  "grain_enabled" boolean NOT NULL DEFAULT true,
  "motion_enabled" boolean NOT NULL DEFAULT true,
  "color_sync" boolean NOT NULL DEFAULT true,
  "volume" integer NOT NULL DEFAULT 72,
  "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "profiles" (
  "id" text PRIMARY KEY,
  "display_name" text NOT NULL,
  "avatar_url" text,
  "product" text,
  "mode" text NOT NULL DEFAULT 'demo',
  "connected_at" timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "track_features" (
  "track_id" text PRIMARY KEY,
  "bpm" integer,
  "key" integer,
  "mode" integer,
  "energy" integer,
  "danceability" integer,
  "valence" integer,
  "tempo_confidence" integer,
  "fetched_at" timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "spotify_sessions" (
  "id" text PRIMARY KEY,
  "access_token" text NOT NULL,
  "refresh_token" text,
  "expires_at" timestamp with time zone NOT NULL,
  "scope" text,
  "profile_id" text,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);
`;

let bootstrapped = false;
let inflight: Promise<void> | null = null;

export async function ensureSchema(): Promise<void> {
  if (bootstrapped) return;
  if (!inflight) {
    inflight = (async () => {
      await pool.query(DDL);
      bootstrapped = true;
    })().catch((error) => {
      inflight = null;
      console.warn(
        "[echoes:schema] bootstrap skipped:",
        error instanceof Error ? error.message : error,
      );
    });
  }
  return inflight;
}

/** PostgreSQL "undefined_table" / "undefined_column". */
export function isSchemaError(error: unknown): boolean {
  const code = (error as { code?: string } | null)?.code;
  return code === "42P01" || code === "42703" || code === "42P07";
}

/**
 * Runs a database operation, self-healing a missing schema exactly once.
 * Returns `null` when the operation still fails, so callers can degrade
 * gracefully instead of answering 500/503.
 */
export async function withSchema<T>(
  scope: string,
  operation: () => Promise<T>,
): Promise<{ ok: true; value: T } | { ok: false; reason: string }> {
  try {
    return { ok: true, value: await operation() };
  } catch (error) {
    if (isSchemaError(error)) {
      bootstrapped = false;
      await ensureSchema();
      try {
        return { ok: true, value: await operation() };
      } catch (retryError) {
        console.warn(`[echoes:${scope}]`, retryError instanceof Error ? retryError.message : retryError);
        return { ok: false, reason: retryError instanceof Error ? retryError.message : "db_error" };
      }
    }
    console.warn(`[echoes:${scope}]`, error instanceof Error ? error.message : error);
    return { ok: false, reason: error instanceof Error ? error.message : "db_error" };
  }
}
