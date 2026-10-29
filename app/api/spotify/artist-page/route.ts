import { fetchArtistPage } from "@/lib/server/spotify";
import { withSpotify } from "@/lib/server/token";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/spotify/artist-page?id=…
 *
 * `GET /v1/artists/{id}` + `/albums?include_groups=album,single` and
 * `include_groups=appears_on`, plus `GET /v1/albums/{id}/tracks` for each
 * release — cached server-side for 30 minutes.
 *
 * `/v1/artists/{id}/top-tracks` is deliberately NOT called: it was removed for
 * Development Mode apps in the Feb 2026 migration and answered 503.
 */
export async function GET(request: Request): Promise<Response> {
  const id = new URL(request.url).searchParams.get("id");
  if (!id || !/^[\w-]{5,64}$/.test(id)) {
    return Response.json({ error: "invalid_artist_id" }, { status: 400 });
  }

  const result = await withSpotify(request, (token) => fetchArtistPage(token, id));
  const headers = new Headers(result.headers);
  headers.set("Cache-Control", "no-store, max-age=0, must-revalidate");

  if (!result.ok) {
    return Response.json(
      { error: result.error, message: result.message, artist: null },
      { status: result.status, headers },
    );
  }
  return Response.json({ artist: result.data }, { headers });
}
