import type { SpotifySession } from "@/lib/spotify/auth";

/**
 * Browser half of the server session mirror.
 *
 * Echoes stays a PKCE public client — tokens are minted and held in the
 * browser. We additionally hand a copy to `/api/spotify/session` so API routes
 * can refresh an expired token by themselves. When a route does refresh, it
 * echoes the rotated tokens back in response headers and this module adopts
 * them, which keeps browser and server from drifting apart.
 */

type Adopter = (accessToken: string, refreshToken?: string) => void;

let adopter: Adopter | null = null;

export function registerTokenAdopter(fn: Adopter): () => void {
  adopter = fn;
  return () => {
    if (adopter === fn) adopter = null;
  };
}

/** Reads `x-echoes-access-token` / `x-echoes-refresh-token` from any response. */
export function adoptTokenHeaders(response: Response): boolean {
  const accessToken = response.headers.get("x-echoes-access-token");
  if (!accessToken) return false;
  adopter?.(accessToken, response.headers.get("x-echoes-refresh-token") ?? undefined);
  return true;
}

/** Best-effort: if the store is unavailable the header path keeps working. */
export async function publishSession(session: SpotifySession, profileId?: string): Promise<boolean> {
  try {
    const res = await fetch("/api/spotify/session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        accessToken: session.accessToken,
        refreshToken: session.refreshToken ?? null,
        expiresAt: session.expiresAt,
        scope: session.scope,
        profileId: profileId ?? null,
      }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export async function dropSession(): Promise<void> {
  try {
    await fetch("/api/spotify/session", { method: "DELETE" });
  } catch {
    /* nothing to clean up */
  }
}

/** True when the server holds a refreshable mirror of this session. */
export async function serverSessionActive(): Promise<boolean> {
  try {
    const res = await fetch("/api/spotify/session", { cache: "no-store" });
    if (!res.ok) return false;
    adoptTokenHeaders(res);
    const data = (await res.json()) as { active?: boolean };
    return Boolean(data.active);
  } catch {
    return false;
  }
}
