import { fetchSpotifyLibrary, type LibrarySkip } from "@/lib/server/spotify";
import { withSpotify } from "@/lib/server/token";
import { libraryRemove, librarySave, toUri } from "@/lib/spotify/libraryApi";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET    /api/spotify/library            one-shot library aggregation
 * PUT    /api/spotify/library  {uris}    save to library   (PUT /v1/me/library)
 * DELETE /api/spotify/library  {uris}    remove from library
 *
 * Responses are `no-store`: Spotify artwork URLs are short-lived CDN links and
 * must never be cached by an intermediary or persisted.
 */

const NO_STORE = { "Cache-Control": "no-store, max-age=0, must-revalidate" } as const;

export async function GET(request: Request): Promise<Response> {
  const params = new URL(request.url).searchParams;
  const refresh = params.get("refresh") === "1";
  // Sections the browser already hydrated from localStorage: `recent,saved,top`.
  // Skipping them removes those calls from the fan-out entirely.
  const skip = (params.get("skip") ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter((value): value is LibrarySkip => value === "recent" || value === "saved" || value === "top");
  const started = Date.now();

  // Token comes from the bearer header or the httpOnly session cookie, and an
  // expired one is refreshed here (PKCE refresh grant) before retrying once.
  const result = await withSpotify(request, (token) =>
    fetchSpotifyLibrary(token, { refresh, skip }),
  );

  if (!result.ok) {
    return Response.json(
      { error: result.error, message: result.message },
      { status: result.status, headers: merge(result.headers, NO_STORE) },
    );
  }

  const payload = result.data;
  if (process.env.NODE_ENV !== "production") {
    console.info(
      `[echoes:library] ${Date.now() - started}ms · ${payload.playlists.length} playlists · ${payload.tracks.length} tracks${
        payload.degraded?.length ? ` · degraded ${payload.degraded.join(",")}` : ""
      }`,
    );
  }
  return Response.json(payload, { headers: merge(result.headers, NO_STORE) });
}

export async function PUT(request: Request): Promise<Response> {
  const uris = await readUris(request);
  if (!uris) return Response.json({ error: "uris or ids required" }, { status: 400 });

  const result = await withSpotify(request, (token) => librarySave(token, uris));
  if (!result.ok) {
    return Response.json(
      { error: result.error, message: result.message },
      { status: result.status, headers: result.headers },
    );
  }
  return Response.json({ ok: true, saved: uris.length }, { headers: result.headers });
}

export async function DELETE(request: Request): Promise<Response> {
  const uris = await readUris(request);
  if (!uris) return Response.json({ error: "uris or ids required" }, { status: 400 });

  const result = await withSpotify(request, (token) => libraryRemove(token, uris));
  if (!result.ok) {
    return Response.json(
      { error: result.error, message: result.message },
      { status: result.status, headers: result.headers },
    );
  }
  return Response.json({ ok: true, removed: uris.length }, { headers: result.headers });
}

/** Accepts `{uris:[…]}` or `{ids:[…]}` and normalises to track URIs (≤40/call). */
async function readUris(request: Request): Promise<string[] | null> {
  const body = (await request.json().catch(() => null)) as {
    uris?: string[];
    ids?: string[];
    type?: "track" | "album" | "playlist" | "episode" | "show";
  } | null;

  const raw = [...(body?.uris ?? []), ...(body?.ids ?? [])].filter(
    (value): value is string => typeof value === "string" && value.length > 0,
  );
  if (!raw.length) return null;
  return [...new Set(raw.map((value) => toUri(value, body?.type ?? "track")))].slice(0, 40);
}

function merge(base: Headers, extra: Record<string, string>): Headers {
  const headers = new Headers(base);
  for (const [key, value] of Object.entries(extra)) headers.set(key, value);
  return headers;
}
