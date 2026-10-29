import { eq } from "drizzle-orm";
import { db } from "@/db";
import { spotifySessions } from "@/db/schema";
import { withSchema } from "@/lib/server/schema-bootstrap";
import {
  clearSidCookie,
  newSessionId,
  parseCookies,
  refreshSessionTokens,
  resolveToken,
  sidCookie,
  SID_COOKIE,
} from "@/lib/server/token";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Mirrors the browser's PKCE session into Postgres so API routes can refresh
 * tokens on their own. Best-effort by design: if the store is unavailable the
 * client simply keeps sending `Authorization: Bearer` headers.
 */
export async function POST(request: Request): Promise<Response> {
  const body = (await request.json().catch(() => null)) as {
    accessToken?: string;
    refreshToken?: string;
    expiresAt?: number;
    scope?: string;
    profileId?: string;
  } | null;

  if (!body?.accessToken || body.accessToken.length < 20) {
    return Response.json({ error: "access_token required" }, { status: 400 });
  }

  const existingId = parseCookies(request)[SID_COOKIE] ?? null;
  const id = existingId ?? newSessionId();
  const expiresAt = new Date(
    typeof body.expiresAt === "number" && body.expiresAt > Date.now()
      ? body.expiresAt
      : Date.now() + 55 * 60_000,
  );

  const saved = await withSchema("session:upsert", async () => {
    await db
      .insert(spotifySessions)
      .values({
        id,
        accessToken: body.accessToken!,
        refreshToken: body.refreshToken ?? null,
        expiresAt,
        scope: body.scope ?? null,
        profileId: body.profileId ?? null,
      })
      .onConflictDoUpdate({
        target: spotifySessions.id,
        set: {
          accessToken: body.accessToken!,
          // Spotify rotates refresh tokens: never overwrite a good one with null.
          refreshToken: body.refreshToken ?? undefined,
          expiresAt,
          scope: body.scope ?? undefined,
          profileId: body.profileId ?? undefined,
          updatedAt: new Date(),
        },
      });
    return true;
  });

  if (!saved.ok) {
    return Response.json(
      { ok: false, error: "session_store_unavailable", detail: saved.reason },
      { status: 503 },
    );
  }

  return Response.json(
    { ok: true, id, expiresAt: expiresAt.toISOString() },
    { headers: { "set-cookie": sidCookie(id) } },
  );
}

/** Reports whether a server session exists, refreshing it if it is near expiry. */
export async function GET(request: Request): Promise<Response> {
  const resolved = await resolveToken(request);
  if (!resolved || !resolved.sessionId) {
    return Response.json({ active: false });
  }
  const headers = new Headers({
    "Access-Control-Expose-Headers": "x-echoes-access-token, x-echoes-refresh-token",
  });
  if (resolved.expiresAt && resolved.expiresAt - Date.now() < 120_000) {
    const fresh = await refreshSessionTokens(resolved.sessionId);
    if (fresh) {
      headers.set("x-echoes-access-token", fresh.accessToken);
      if (fresh.refreshToken) headers.set("x-echoes-refresh-token", fresh.refreshToken);
      return Response.json({ active: true, expiresAt: fresh.expiresAt }, { headers });
    }
  }
  return Response.json({ active: true, expiresAt: resolved.expiresAt }, { headers });
}

/** Logout: drop the mirrored session and clear the cookie. */
export async function DELETE(request: Request): Promise<Response> {
  const id = parseCookies(request)[SID_COOKIE] ?? null;
  if (id) {
    await withSchema("session:delete", () =>
      db.delete(spotifySessions).where(eq(spotifySessions.id, id)),
    );
  }
  return Response.json({ ok: true }, { headers: { "set-cookie": clearSidCookie() } });
}
