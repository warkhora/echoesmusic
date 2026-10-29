import { withSpotify } from "@/lib/server/token";
import { libraryContains, toUri } from "@/lib/spotify/libraryApi";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/spotify/library/contains?uris=spotify:track:…,spotify:track:…
 *
 * Mirrors `GET /v1/me/library/contains` (scopes `user-library-read` /
 * `user-follow-read`), chunked to the 40-URI maximum and with the legacy
 * `/me/tracks/contains` fallback built into `libraryContains`.
 */
export async function GET(request: Request): Promise<Response> {
  const params = new URL(request.url).searchParams;
  const raw = (params.get("uris") ?? params.get("ids") ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean)
    .slice(0, 40);

  if (!raw.length) return Response.json({ error: "uris required" }, { status: 400 });

  const type = (params.get("type") ?? "track") as "track" | "album" | "playlist";
  const uris = raw.map((value) => toUri(value, type));

  const result = await withSpotify(request, (token) => libraryContains(token, uris));
  if (!result.ok) {
    return Response.json(
      { error: result.error, message: result.message },
      { status: result.status, headers: result.headers },
    );
  }

  return Response.json(
    { uris, results: result.data },
    {
      headers: new Headers([
        ...[...result.headers.entries()],
        ["Cache-Control", "no-store, max-age=0, must-revalidate"],
      ]),
    },
  );
}
