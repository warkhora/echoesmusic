import { SpotifyApiError, spotifyFetch } from "@/lib/spotify/client";

/*
 * Unified library management (February 2026 spec).
 *
 *   GET    /v1/me/library/contains?uris=…   (user-library-read, user-follow-read)
 *   PUT    /v1/me/library?uris=…            (user-library-modify, user-follow-modify)
 *   DELETE /v1/me/library?uris=…
 *
 * URIs — not ids — and a maximum of 40 per request. The type-specific
 * endpoints (`/me/tracks`, `/me/tracks/contains`) were removed for Development
 * Mode apps but are still served to Extended Quota apps, so every operation
 * falls back to them instead of failing.
 */

export const LIBRARY_BATCH_LIMIT = 40;
const LEGACY_BATCH_LIMIT = 50;

export type LibraryEntityType = "track" | "album" | "playlist" | "episode" | "show" | "artist";

export function toUri(idOrUri: string, type: LibraryEntityType = "track"): string {
  return idOrUri.startsWith("spotify:") ? idOrUri : `spotify:${type}:${idOrUri}`;
}

export function toId(idOrUri: string): string {
  return idOrUri.startsWith("spotify:") ? idOrUri.split(":").pop() ?? idOrUri : idOrUri;
}

export function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/** The unified endpoints answer 403/404 on apps that were not migrated. */
function shouldFallBack(error: unknown): boolean {
  return error instanceof SpotifyApiError && [400, 403, 404].includes(error.status);
}

/**
 * `GET /me/library/contains?uris=…` → one boolean per URI, in order.
 * Falls back to `GET /me/tracks/contains?ids=…` for track URIs.
 */
export async function libraryContains(token: string, uris: string[]): Promise<boolean[]> {
  if (!uris.length) return [];
  const results: boolean[] = [];

  for (const batch of chunk(uris, LIBRARY_BATCH_LIMIT)) {
    try {
      const res = await spotifyFetch<unknown>(
        `/me/library/contains?uris=${encodeURIComponent(batch.join(","))}`,
        token,
      );
      if (Array.isArray(res)) {
        results.push(...batch.map((_, i) => Boolean(res[i])));
        continue;
      }
      throw new SpotifyApiError("Unexpected contains payload", 400, "/me/library/contains");
    } catch (error) {
      if (!shouldFallBack(error)) throw error;
      const ids = batch.map(toId);
      const legacy = await spotifyFetch<boolean[]>(
        `/me/tracks/contains?ids=${encodeURIComponent(ids.join(","))}`,
        token,
      ).catch(() => null);
      results.push(...ids.map((_, i) => Boolean(legacy?.[i])));
    }
  }

  return results;
}

/** `PUT /me/library?uris=…` in batches of 40, falling back to `PUT /me/tracks`. */
export async function librarySave(token: string, uris: string[]): Promise<void> {
  if (!uris.length) return;

  for (const batch of chunk(uris, LIBRARY_BATCH_LIMIT)) {
    const query = `/me/library?uris=${encodeURIComponent(batch.join(","))}`;
    try {
      await spotifyFetch<void>(query, token, {
        method: "PUT",
        body: JSON.stringify({ uris: batch }),
      });
    } catch (error) {
      if (!shouldFallBack(error)) throw error;
      await spotifyFetch<void>("/me/tracks", token, {
        method: "PUT",
        body: JSON.stringify({ ids: batch.map(toId).slice(0, LEGACY_BATCH_LIMIT) }),
      });
    }
  }
}

/** `DELETE /me/library?uris=…` in batches of 40, falling back to `DELETE /me/tracks`. */
export async function libraryRemove(token: string, uris: string[]): Promise<void> {
  if (!uris.length) return;

  for (const batch of chunk(uris, LIBRARY_BATCH_LIMIT)) {
    const query = `/me/library?uris=${encodeURIComponent(batch.join(","))}`;
    try {
      await spotifyFetch<void>(query, token, {
        method: "DELETE",
        body: JSON.stringify({ uris: batch }),
      });
    } catch (error) {
      if (!shouldFallBack(error)) throw error;
      await spotifyFetch<void>(
        `/me/tracks?ids=${encodeURIComponent(batch.map(toId).slice(0, LEGACY_BATCH_LIMIT).join(","))}`,
        token,
        { method: "DELETE" },
      );
    }
  }
}
