import { desc } from "drizzle-orm";
import { db } from "@/db";
import { artists, listeningEvents, playlists, trackFeatures, tracks } from "@/db/schema";
import { ensureSeeded } from "@/db/seed";
import { buildStats } from "@/lib/server/stats";
import { keyName } from "@/lib/spotify/client";
import type { Catalog, EchoTrack } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  try {
    await ensureSeeded();

    const [trackRows, playlistRows, artistRows, featureRows] = await Promise.all([
      db.select().from(tracks),
      db.select().from(playlists),
      db.select().from(artists),
      db.select().from(trackFeatures),
    ]);
    const featuresById = new Map(featureRows.map((f) => [f.trackId, f]));

    const trackById = new Map<string, EchoTrack>(
      trackRows.map((t) => [
        t.id,
        {
          id: t.id,
          title: t.title,
          artist: t.artist,
          album: t.album,
          durationMs: t.durationMs,
          genre: t.genre,
          year: t.year,
          colors: t.colors,
          artSeed: t.artSeed,
          playCount: t.playCount,
          saved: t.saved,
          imageUrl: null,
          bpm: featuresById.get(t.id)?.bpm ?? null,
          musicalKey: keyName(featuresById.get(t.id)?.key, featuresById.get(t.id)?.mode),
          energy: featuresById.get(t.id)?.energy != null ? featuresById.get(t.id)!.energy! / 100 : null,
          danceability:
            featuresById.get(t.id)?.danceability != null
              ? featuresById.get(t.id)!.danceability! / 100
              : null,
          valence: featuresById.get(t.id)?.valence != null ? featuresById.get(t.id)!.valence! / 100 : null,
        },
      ]),
    );

    // Recently played: real listening telemetry first, then curated fallback.
    const orderedEvents = await db
      .select({ trackId: listeningEvents.trackId })
      .from(listeningEvents)
      .orderBy(desc(listeningEvents.createdAt))
      .limit(80);

    const seen = new Set<string>();
    const recentlyPlayed: EchoTrack[] = [];
    for (const ev of orderedEvents) {
      if (seen.has(ev.trackId)) continue;
      seen.add(ev.trackId);
      const t = trackById.get(ev.trackId);
      if (t) recentlyPlayed.push(t);
      if (recentlyPlayed.length >= 8) break;
    }
    if (recentlyPlayed.length < 8) {
      for (const t of [...trackRows].sort((a, b) => b.playCount - a.playCount)) {
        if (seen.has(t.id)) continue;
        seen.add(t.id);
        const mapped = trackById.get(t.id);
        if (mapped) recentlyPlayed.push(mapped);
        if (recentlyPlayed.length >= 8) break;
      }
    }

    const topTracks = [...trackRows]
      .sort((a, b) => b.playCount - a.playCount)
      .slice(0, 6)
      .map((t) => trackById.get(t.id))
      .filter((t): t is EchoTrack => Boolean(t));

    const payload: Catalog = {
      tracks: trackRows.map((t) => trackById.get(t.id)).filter((t): t is EchoTrack => Boolean(t)),
      playlists: playlistRows.map((p) => ({
        id: p.id,
        name: p.name,
        description: p.description,
        owner: p.owner,
        ownerId: "echoes-local",
        colors: p.colors,
        trackIds: p.trackIds,
        trackCount: p.trackIds.length,
        featured: p.featured,
        imageUrl: null,
      })),
      artists: artistRows.map((a) => ({
        id: a.id,
        name: a.name,
        bio: a.bio,
        listeners: a.listeners,
        colors: a.colors,
        imageUrl: null,
      })),
      recentlyPlayed,
      topTracks,
      stats: await buildStats(),
    };

    return Response.json(payload);
  } catch (error) {
    console.warn("[echoes:catalog]", error instanceof Error ? error.message : error);
    return Response.json({ error: "catalog_unavailable" }, { status: 500 });
  }
}
