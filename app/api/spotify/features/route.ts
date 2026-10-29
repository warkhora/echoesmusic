import { inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { trackFeatures } from "@/db/schema";
import { withSchema } from "@/lib/server/schema-bootstrap";
import { withSpotify } from "@/lib/server/token";
import { SpotifyApiError, keyName, spotifyFetch } from "@/lib/spotify/client";
import { isRateLimitStatus, noteRateLimit, rateLimited } from "@/lib/spotify/rateLimit";
import type { SpAudioFeatures } from "@/lib/spotify/client";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Spotify's documented maximum for a single `/audio-features` call. */
const BATCH = 50;

interface FeatureValue {
  bpm: number | null;
  musicalKey: string | null;
  energy: number | null;
  danceability: number | null;
  valence: number | null;
}

/**
 * POST /api/spotify/features  { ids: string[] }
 *
 * Batched audio features: `GET /v1/audio-features?ids=…` in chunks of 50, with
 * Postgres as a permanent cache so an id is only ever requested from Spotify
 * once, across every visitor and every reload.
 */
export async function POST(request: Request): Promise<Response> {
  const body = (await request.json().catch(() => null)) as { ids?: unknown[] } | null;
  const requested = Array.isArray(body?.ids) ? body!.ids : [];
  const ids = [
    ...new Set(requested.filter((id): id is string => typeof id === "string" && id.length > 0)),
  ].slice(0, 500);

  if (!ids.length) return Response.json({ features: {} });

  // 1 — serve everything Postgres already knows before touching Spotify.
  const known = await readCache(ids);
  const missing = ids.filter((id) => !known[id]);

  if (!missing.length || rateLimited()) {
    return Response.json({ features: known, cached: true });
  }

  const result = await withSpotify(request, async (token) => {
    const fetched: Record<string, FeatureValue> = {};
    const rows: {
      trackId: string;
      bpm: number | null;
      key: number | null;
      mode: number | null;
      energy: number | null;
      danceability: number | null;
      valence: number | null;
    }[] = [];

    let limited = false;

    for (let i = 0; i < missing.length && !limited; i += BATCH) {
      const batch = missing.slice(i, i + BATCH);

      let res: { audio_features: (SpAudioFeatures | null)[] };
      try {
        res = await spotifyFetch<{ audio_features: (SpAudioFeatures | null)[] }>(
          `/audio-features?ids=${batch.join(",")}`,
          token,
        );
      } catch (error) {
        // A failure in one batch must not discard the batches that succeeded,
        // and must never escape as a 500.
        if (error instanceof SpotifyApiError && isRateLimitStatus(error.status)) {
          limited = true;
          noteRateLimit("/audio-features");
        } else if (error instanceof SpotifyApiError && (error.status === 403 || error.status === 404)) {
          limited = true; // app not entitled — stop asking
        } else {
          console.warn(
            "[echoes:features] batch skipped:",
            error instanceof Error ? error.message : error,
          );
        }
        break;
      }

      (res.audio_features ?? []).forEach((feature, index) => {
        if (!feature) return; // Spotify returns null for ids it has no data for
        const id = feature.id ?? batch[index];
        if (!id) return;
        const value: FeatureValue = {
          bpm: feature.tempo ? Math.round(feature.tempo) : null,
          musicalKey: keyName(feature.key, feature.mode),
          energy: typeof feature.energy === "number" ? Math.round(feature.energy * 100) / 100 : null,
          danceability:
            typeof feature.danceability === "number"
              ? Math.round(feature.danceability * 100) / 100
              : null,
          valence: typeof feature.valence === "number" ? Math.round(feature.valence * 100) / 100 : null,
        };
        fetched[id] = value;
        rows.push({
          trackId: id,
          bpm: value.bpm,
          key: feature.key ?? null,
          mode: feature.mode ?? null,
          energy: typeof feature.energy === "number" ? Math.round(feature.energy * 100) : null,
          danceability:
            typeof feature.danceability === "number" ? Math.round(feature.danceability * 100) : null,
          valence: typeof feature.valence === "number" ? Math.round(feature.valence * 100) : null,
        });
      });
    }

    if (rows.length) await writeCache(rows);
    return { ...known, ...fetched };
  });

  const headers = new Headers([
    ...(result.ok ? [...result.headers.entries()] : [...result.headers.entries()]),
    ["Cache-Control", "no-store, max-age=0, must-revalidate"],
  ]);

  if (!result.ok) {
    if (isRateLimitStatus(result.status)) noteRateLimit("/audio-features");
    // Not entitled (403/404) is a permanent property of the app, not an error
    // worth surfacing: answer 200 with whatever the cache held.
    if (result.status === 403 || result.status === 404) {
      return Response.json({ features: known, unavailable: true }, { headers });
    }
    return Response.json(
      { error: result.error, message: result.message, features: known },
      { status: result.status, headers },
    );
  }

  return Response.json({ features: result.data }, { headers });
}

async function readCache(ids: string[]): Promise<Record<string, FeatureValue>> {
  const out: Record<string, FeatureValue> = {};
  const read = await withSchema("features:read", async () => {
    const rows = await db.select().from(trackFeatures).where(inArray(trackFeatures.trackId, ids));
    for (const row of rows) {
      if (row.bpm === null && row.key === null && row.energy === null) continue;
      out[row.trackId] = {
        bpm: row.bpm,
        musicalKey: keyName(row.key, row.mode),
        energy: row.energy === null ? null : row.energy / 100,
        danceability: row.danceability === null ? null : row.danceability / 100,
        valence: row.valence === null ? null : row.valence / 100,
      };
    }
    return true;
  });
  if (!read.ok) console.warn("[echoes:features] cache read skipped:", read.reason);
  return out;
}

async function writeCache(
  rows: {
    trackId: string;
    bpm: number | null;
    key: number | null;
    mode: number | null;
    energy: number | null;
    danceability: number | null;
    valence: number | null;
  }[],
): Promise<void> {
  const write = await withSchema("features:write", () =>
    db
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
      }),
  );
  if (!write.ok) console.warn("[echoes:features] cache write skipped:", write.reason);
}
