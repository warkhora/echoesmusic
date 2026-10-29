import { fetchSpotifyPlaylist } from "@/lib/server/spotify";
import { withSpotify } from "@/lib/server/token";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Playlist detail: fully paged track list plus audio features, with a fallback
 * to the playlist object's own first page when `/tracks` is refused (403).
 */
export async function GET(request: Request): Promise<Response> {
  const id = new URL(request.url).searchParams.get("id");
  if (!id || !/^[\w-]{5,64}$/.test(id)) {
    return Response.json({ error: "invalid_playlist_id" }, { status: 400 });
  }

  const result = await withSpotify(request, (token) => fetchSpotifyPlaylist(token, id));

  if (!result.ok) {
    return Response.json(
      { error: result.error, message: result.message },
      { status: result.status, headers: result.headers },
    );
  }

  const { playlist, tracks, skipped, error } = result.data;

  if (error) {
    const status = [401, 403, 404, 429].includes(error.status) ? error.status : 502;
    return Response.json(
      {
        error:
          status === 401
            ? "token_expired"
            : status === 403
              ? "forbidden"
              : status === 404
                ? "not_found"
                : "upstream_error",
        message: error.message,
        playlist,
        tracks: [],
        skipped,
      },
      { status, headers: result.headers },
    );
  }

  return Response.json({ playlist, tracks, skipped }, { headers: result.headers });
}
