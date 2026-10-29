import { fetchRecentlyPlayed } from "@/lib/server/spotify";
import { withSpotify } from "@/lib/server/token";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/spotify/recent?limit=50
 *
 * `GET /v1/me/player/recently-played` (scope `user-read-recently-played`),
 * fetched **lazily** — only when the listener opens Home or Activity and
 * localStorage holds no history. Keeping it out of the startup fan-out is what
 * stops the parallel flood that produced 503s.
 */
export async function GET(request: Request): Promise<Response> {
  const raw = Number(new URL(request.url).searchParams.get("limit") ?? 50);
  const limit = Math.min(Math.max(Number.isFinite(raw) ? raw : 50, 1), 50);

  const result = await withSpotify(request, (token) => fetchRecentlyPlayed(token, limit));

  const headers = new Headers(result.headers);
  headers.set("Cache-Control", "no-store, max-age=0, must-revalidate");

  if (!result.ok) {
    return Response.json(
      { error: result.error, message: result.message, tracks: [] },
      { status: result.status, headers },
    );
  }

  return Response.json({ tracks: result.data }, { headers });
}
