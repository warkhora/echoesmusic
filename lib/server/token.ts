import { randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { spotifySessions } from "@/db/schema";
import { SPOTIFY_TOKEN_URL, spotifyClientId } from "@/lib/spotify/auth";
import { SpotifyApiError, spotifyMessage } from "@/lib/spotify/client";
import { withSchema } from "@/lib/server/schema-bootstrap";

/**
 * Token handling for Echoes' own API routes.
 *
 * Echoes is a PKCE *public* client: there is no client secret anywhere, so
 * NextAuth's confidential authorization-code flow does not apply. What we do
 * instead is mirror the browser session into Postgres behind an opaque,
 * httpOnly cookie id. That gives routes everything they need to:
 *
 *   1. read the token from the `Authorization` header *or* the session cookie,
 *   2. refresh it server-side (the PKCE refresh grant only needs client_id),
 *   3. hand the rotated tokens back to the browser so both stay in sync,
 *
 * instead of answering 401/403 the moment a token lapses.
 */

export const SID_COOKIE = "echoes.sid";
const REFRESH_SKEW_MS = 90_000;

export interface ResolvedToken {
  token: string;
  sessionId: string | null;
  source: "header" | "session";
  expiresAt: number | null;
}

export function newSessionId(): string {
  return randomBytes(24).toString("hex");
}

export function parseCookies(request: Request): Record<string, string> {
  const header = request.headers.get("cookie");
  if (!header) return {};
  const out: Record<string, string> = {};
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx < 1) continue;
    out[part.slice(0, idx).trim()] = decodeURIComponent(part.slice(idx + 1).trim());
  }
  return out;
}

/**
 * SameSite=None is required when Echoes is embedded in a preview iframe (the
 * browser treats those requests as cross-site); Lax is used for plain http dev.
 */
export function sidCookie(id: string, maxAge = 60 * 60 * 24 * 7): string {
  const secure = process.env.NODE_ENV === "production";
  return [
    `${SID_COOKIE}=${id}`,
    "Path=/",
    "HttpOnly",
    `Max-Age=${maxAge}`,
    secure ? "SameSite=None" : "SameSite=Lax",
    secure ? "Secure" : "",
  ]
    .filter(Boolean)
    .join("; ");
}

export function clearSidCookie(): string {
  return sidCookie("", 0);
}

export function bearerFrom(request: Request): string | null {
  const header = request.headers.get("authorization") ?? "";
  const token = header.replace(/^Bearer\s+/i, "").trim();
  return token.length > 20 ? token : null;
}

interface SessionRow {
  id: string;
  accessToken: string;
  refreshToken: string | null;
  expiresAt: Date;
}

async function loadSession(sessionId: string): Promise<SessionRow | null> {
  const result = await withSchema("session:load", async () => {
    const rows = await db
      .select()
      .from(spotifySessions)
      .where(eq(spotifySessions.id, sessionId))
      .limit(1);
    return rows[0] ?? null;
  });
  return result.ok ? result.value : null;
}

/** Refresh grant — public client, no secret involved. */
export async function refreshSessionTokens(
  sessionId: string,
): Promise<{ accessToken: string; refreshToken: string | null; expiresAt: number } | null> {
  const row = await loadSession(sessionId);
  if (!row?.refreshToken) return null;

  const clientId = spotifyClientId();
  if (!clientId) {
    console.warn("[echoes:token] cannot refresh: NEXT_PUBLIC_SPOTIFY_CLIENT_ID is unset");
    return null;
  }

  try {
    const res = await fetch(SPOTIFY_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: clientId,
        grant_type: "refresh_token",
        refresh_token: row.refreshToken,
      }),
    });
    if (!res.ok) {
      console.warn(`[echoes:token] refresh failed (${res.status})`);
      return null;
    }
    const data = (await res.json()) as {
      access_token: string;
      refresh_token?: string;
      expires_in: number;
    };
    const expiresAt = new Date(Date.now() + Math.max(60, data.expires_in - 45) * 1000);
    const refreshToken = data.refresh_token ?? row.refreshToken;

    await withSchema("session:save", () =>
      db
        .update(spotifySessions)
        .set({ accessToken: data.access_token, refreshToken, expiresAt, updatedAt: new Date() })
        .where(eq(spotifySessions.id, sessionId)),
    );

    return { accessToken: data.access_token, refreshToken, expiresAt: expiresAt.getTime() };
  } catch (error) {
    console.warn("[echoes:token] refresh error:", error instanceof Error ? error.message : error);
    return null;
  }
}

/**
 * Resolves the caller's Spotify token: the explicit bearer header wins (the
 * browser is the source of truth for the token it holds), otherwise the session
 * cookie is used and refreshed when it is close to expiry.
 */
export async function resolveToken(request: Request): Promise<ResolvedToken | null> {
  const sessionId = parseCookies(request)[SID_COOKIE] ?? null;
  const header = bearerFrom(request);

  if (header) return { token: header, sessionId, source: "header", expiresAt: null };

  if (!sessionId) return null;
  const row = await loadSession(sessionId);
  if (!row) return null;

  if (row.expiresAt.getTime() - Date.now() < REFRESH_SKEW_MS) {
    const fresh = await refreshSessionTokens(sessionId);
    if (fresh) {
      return { token: fresh.accessToken, sessionId, source: "session", expiresAt: fresh.expiresAt };
    }
  }
  return { token: row.accessToken, sessionId, source: "session", expiresAt: row.expiresAt.getTime() };
}

export type AuthorizedResult<T> =
  | { ok: true; data: T; headers: Headers }
  | { ok: false; status: number; error: string; message?: string; headers: Headers };

/**
 * Runs a Spotify-backed handler with automatic token recovery:
 * missing token → 401, expired token → refresh once and retry, and any rotated
 * token is echoed back to the browser via `x-echoes-access-token`.
 */
export async function withSpotify<T>(
  request: Request,
  fn: (token: string) => Promise<T>,
): Promise<AuthorizedResult<T>> {
  const headers = new Headers({
    "Access-Control-Expose-Headers": "x-echoes-access-token, x-echoes-refresh-token",
  });

  const resolved = await resolveToken(request);
  if (!resolved) {
    return { ok: false, status: 401, error: "missing_token", headers };
  }

  const failure = (error: unknown): AuthorizedResult<T> => {
    if (error instanceof SpotifyApiError) {
      const status = [401, 403, 404, 429].includes(error.status) ? error.status : 502;
      return {
        ok: false,
        status,
        error:
          status === 401
            ? "token_expired"
            : status === 403
              ? "forbidden"
              : status === 404
                ? "not_found"
                : status === 429
                  ? "rate_limited"
                  : "upstream_error",
        message: error.message,
        headers,
      };
    }
    console.warn("[echoes:spotify]", error instanceof Error ? error.message : error);
    return {
      ok: false,
      status: 502,
      error: "upstream_unavailable",
      message: spotifyMessage(502, "spotify"),
      headers,
    };
  };

  try {
    return { ok: true, data: await fn(resolved.token), headers };
  } catch (error) {
    const expired = error instanceof SpotifyApiError && error.status === 401;
    if (!expired || !resolved.sessionId) return failure(error);

    // The browser sent a lapsed token but we hold its refresh token: recover.
    const fresh = await refreshSessionTokens(resolved.sessionId);
    if (!fresh) return failure(error);

    headers.set("x-echoes-access-token", fresh.accessToken);
    if (fresh.refreshToken) headers.set("x-echoes-refresh-token", fresh.refreshToken);

    try {
      return { ok: true, data: await fn(fresh.accessToken), headers };
    } catch (retryError) {
      return failure(retryError);
    }
  }
}
