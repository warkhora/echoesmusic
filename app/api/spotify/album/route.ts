import { fetchAlbumPage } from "@/lib/server/spotify";
import { withSpotify } from "@/lib/server/token";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/spotify/album?id=…
 *
 * `GET /v1/albums/{id}?market=from_token` plus its paged track list and batched
 * audio features, cached server-side for 30 minutes so navigating back to an
 * album costs nothing.
 */
export async function GET(request: Request): Promise<Response> {
  const id = new URL(request.url).searchParams.get("id");
  if (!id || !/^[\w-]{5,64}$/.test(id)) {
    return Response.json({ error: "invalid_album_id" }, { status: 400 });
  }

  const result = await withSpotify(request, (token) => fetchAlbumPage(token, id));
  const headers = new Headers(result.headers);
  headers.set("Cache-Control", "no-store, max-age=0, must-revalidate");

  if (!result.ok) {
    return Response.json(
      { error: result.error, message: result.message, album: null },
      { status: result.status, headers },
    );
  }
  return Response.json({ album: result.data }, { headers });
}
