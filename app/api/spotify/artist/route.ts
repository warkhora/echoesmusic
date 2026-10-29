import { fetchSpotifyArtist } from "@/lib/server/spotify";
import { withSpotify } from "@/lib/server/token";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/spotify/artist?id=…
 *
 * `GET /v1/artists/{id}` — the high-res banner and `external_urls.spotify` for
 * the Now Playing panel. `no-store`, because artwork URLs are short-lived.
 */
export async function GET(request: Request): Promise<Response> {
  const id = new URL(request.url).searchParams.get("id");
  if (!id || !/^[\w-]{5,64}$/.test(id)) {
    return Response.json({ error: "invalid_artist_id" }, { status: 400 });
  }

  const result = await withSpotify(request, (token) => fetchSpotifyArtist(token, id));

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
