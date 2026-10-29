import { fetchSpotifyTrack } from "@/lib/server/spotify";
import { withSpotify } from "@/lib/server/token";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/spotify/track?id=…
 *
 * `GET /v1/tracks/{id}?market=from_token` plus the individual
 * `GET /v1/albums/{id}` and `GET /v1/artists/{id}` lookups that replaced the
 * removed batch endpoints — full metadata and high-resolution cover art for one
 * track. `no-store`, because artwork URLs expire.
 */
export async function GET(request: Request): Promise<Response> {
  const id = new URL(request.url).searchParams.get("id");
  if (!id || !/^[\w-]{5,64}$/.test(id)) {
    return Response.json({ error: "invalid_track_id" }, { status: 400 });
  }

  const result = await withSpotify(request, (token) => fetchSpotifyTrack(token, id));

  const headers = new Headers(result.headers);
  headers.set("Cache-Control", "no-store, max-age=0, must-revalidate");

  if (!result.ok) {
    return Response.json(
      { error: result.error, message: result.message },
      { status: result.status, headers },
    );
  }

  return Response.json(result.data, { headers });
}
