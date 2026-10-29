import { searchTracks } from "@/lib/server/spotify";
import { withSpotify } from "@/lib/server/token";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/spotify/search?q=…&limit=50
 *
 * `GET /v1/search?type=track&market=from_token`. Taste ranking happens on the
 * client, because that is where the listening history, Saved Songs and the
 * memoised artist genres already live.
 */
export async function GET(request: Request): Promise<Response> {
  const params = new URL(request.url).searchParams;
  const query = (params.get("q") ?? "").trim().slice(0, 120);
  if (query.length < 2) {
    return Response.json({ error: "query_too_short", tracks: [] }, { status: 400 });
  }
  const raw = Number(params.get("limit") ?? 50);
  const limit = Math.min(50, Math.max(1, Number.isFinite(raw) ? raw : 50));

  const result = await withSpotify(request, (token) => searchTracks(token, query, limit));
  const headers = new Headers(result.headers);
  headers.set("Cache-Control", "no-store, max-age=0, must-revalidate");

  if (!result.ok) {
    return Response.json(
      { error: result.error, message: result.message, tracks: [] },
      { status: result.status, headers },
    );
  }

  return Response.json(result.data, { headers });
}
