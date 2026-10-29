import { desc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { listeningEvents, tracks } from "@/db/schema";
import { buildStats, invalidateStats } from "@/lib/server/stats";
import { withSchema } from "@/lib/server/schema-bootstrap";
import type { ListeningEvent } from "@/lib/types";

export const dynamic = "force-dynamic";

/**
 * Listening telemetry.
 *
 * This surface must never take the player down: reads degrade to an empty log
 * (200 + `degraded`) and writes are fire-and-forget (200 + `dropped`), while a
 * missing schema is created on the fly instead of answering 500/503.
 */
export async function GET(request: Request): Promise<Response> {
  const params = new URL(request.url).searchParams;
  const raw = Number(params.get("limit") ?? 40);
  const limit = Math.min(Math.max(Number.isFinite(raw) ? raw : 40, 1), 200);
  const wantStats = params.get("stats") !== "0";
  const degraded: string[] = [];

  const read = await withSchema("playback:read", async () => {
    const rows = await db
      .select()
      .from(listeningEvents)
      .orderBy(desc(listeningEvents.createdAt))
      .limit(limit);

    return rows.map<ListeningEvent>((r) => ({
      id: r.id,
      trackId: r.trackId,
      trackTitle: r.trackTitle,
      artist: r.artist,
      source: r.source,
      progressMs: r.progressMs,
      durationMs: r.durationMs,
      completed: r.completed,
      createdAt: r.createdAt.toISOString(),
    }));
  });

  const events = read.ok ? read.value : [];
  if (!read.ok) degraded.push("log");

  if (!wantStats) return Response.json({ events, degraded: degraded.length ? degraded : undefined });

  const stats = await withSchema("playback:stats", () => buildStats());
  if (!stats.ok) degraded.push("stats");

  return Response.json({
    events,
    stats: stats.ok ? stats.value : null,
    degraded: degraded.length ? degraded : undefined,
  });
}

export async function POST(request: Request): Promise<Response> {
  const body = (await request.json().catch(() => null)) as Partial<{
    trackId: string;
    trackTitle: string;
    artist: string;
    source: string;
    progressMs: number;
    durationMs: number;
    completed: boolean;
  }> | null;

  if (!body?.trackId || !body.trackTitle) {
    return Response.json({ ok: false, error: "trackId and trackTitle required" }, { status: 400 });
  }

  const write = await withSchema("playback:write", async () => {
    await db.insert(listeningEvents).values({
      trackId: body.trackId!.slice(0, 120),
      trackTitle: body.trackTitle!.slice(0, 200),
      artist: (body.artist ?? "Unknown").slice(0, 200),
      source: body.source === "spotify" ? "spotify" : "demo",
      progressMs: clampInt(body.progressMs, 0, 24 * 3600_000),
      durationMs: clampInt(body.durationMs, 0, 24 * 3600_000),
      completed: Boolean(body.completed),
    });

    invalidateStats();

    // Demo catalog tracks carry a play counter; Spotify ids match no row.
    await db
      .update(tracks)
      .set({ playCount: sql`${tracks.playCount} + 1` })
      .where(eq(tracks.id, body.trackId!))
      .catch(() => undefined);

    return true;
  });

  if (!write.ok) {
    // Telemetry is best-effort: acknowledge so the player never surfaces it.
    return Response.json({ ok: false, dropped: true, reason: write.reason });
  }

  return Response.json({ ok: true });
}

function clampInt(value: unknown, min: number, max: number): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.min(max, Math.max(min, Math.round(n)));
}
