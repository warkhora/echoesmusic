import { eq } from "drizzle-orm";
import { db } from "@/db";
import { preferences } from "@/db/schema";
import { ensureSeeded } from "@/db/seed";
import { safeBody } from "@/lib/http";
import { withSchema } from "@/lib/server/schema-bootstrap";
import { BLUR_MAX, BLUR_MIN, DISTORTION_MAX, DISTORTION_MIN, isCustomTheme } from "@/lib/design";
import { DEFAULT_PREFERENCES, THEMES, type Preferences } from "@/lib/types";

export const dynamic = "force-dynamic";

/**
 * Personalization profile.
 *
 * The browser keeps these values in localStorage and treats the database as a
 * convenience mirror, so this route must never be the reason the UI breaks:
 * both handlers always answer 200 with a JSON body, flagging `persisted:false`
 * when the store was unavailable.
 */

const clamp = (n: unknown, min: number, max: number, fallback: number) => {
  const v = typeof n === "number" ? n : Number(n);
  if (!Number.isFinite(v)) return fallback;
  return Math.min(max, Math.max(min, Math.round(v)));
};

export async function GET(): Promise<Response> {
  const read = await withSchema("preferences:read", async () => {
    await ensureSeeded();
    const rows = await db.select().from(preferences).where(eq(preferences.id, "default")).limit(1);
    return rows[0] ?? null;
  });

  const row = read.ok ? read.value : null;
  const value: Preferences = row
    ? {
        blurIntensity: row.blurIntensity,
        theme: (row.theme as Preferences["theme"]) ?? DEFAULT_PREFERENCES.theme,
        ambientEnabled: row.ambientEnabled,
        grainEnabled: row.grainEnabled,
        motionEnabled: row.motionEnabled,
        colorSync: row.colorSync,
        volume: row.volume,
        font1: row.font1 ?? DEFAULT_PREFERENCES.font1,
        font2: row.font2 ?? DEFAULT_PREFERENCES.font2,
        experimentalGlass: row.experimentalGlass ?? DEFAULT_PREFERENCES.experimentalGlass,
        distortion: row.distortion ?? DEFAULT_PREFERENCES.distortion,
        uiScale: row.uiScale ?? DEFAULT_PREFERENCES.uiScale,
        autoplay: row.autoplay ?? DEFAULT_PREFERENCES.autoplay,
        coverAnimations: row.coverAnimations ?? DEFAULT_PREFERENCES.coverAnimations,
        pageTransitions: row.pageTransitions ?? DEFAULT_PREFERENCES.pageTransitions,
        uiAnimations: row.uiAnimations ?? DEFAULT_PREFERENCES.uiAnimations,
      }
    : DEFAULT_PREFERENCES;

  return Response.json({
    preferences: value,
    savedAt: row?.updatedAt ? row.updatedAt.getTime() : 0,
    themes: THEMES,
    ...(read.ok ? {} : { degraded: ["store"], detail: read.reason }),
  });
}

export async function PUT(request: Request): Promise<Response> {
  const body = (await safeBody<Preferences & { savedAt?: number }>(request)) ?? {};

  // A preset id, or `custom:<id>` for a user-built palette.
  const theme =
    typeof body.theme === "string" && (THEMES.some((t) => t.id === body.theme) || isCustomTheme(body.theme))
      ? body.theme
      : undefined;
  // The client stamps its own edit time so the newest device wins on merge.
  const savedAt = new Date(typeof body.savedAt === "number" ? body.savedAt : Date.now());
  const next = {
    blurIntensity: clamp(body.blurIntensity, BLUR_MIN, BLUR_MAX, DEFAULT_PREFERENCES.blurIntensity),
    volume: clamp(body.volume, 0, 100, DEFAULT_PREFERENCES.volume),
    distortion: clamp(body.distortion, DISTORTION_MIN, DISTORTION_MAX, DEFAULT_PREFERENCES.distortion),
    ...(typeof body.font1 === "string" ? { font1: body.font1.slice(0, 60) } : {}),
    ...(typeof body.font2 === "string" ? { font2: body.font2.slice(0, 60) } : {}),
    ...(typeof body.experimentalGlass === "boolean"
      ? { experimentalGlass: body.experimentalGlass }
      : {}),
    uiScale: clamp(body.uiScale, 50, 150, DEFAULT_PREFERENCES.uiScale),
    ...(typeof body.autoplay === "boolean" ? { autoplay: body.autoplay } : {}),
    ...(typeof body.coverAnimations === "boolean" ? { coverAnimations: body.coverAnimations } : {}),
    ...(typeof body.pageTransitions === "boolean"
      ? { pageTransitions: body.pageTransitions }
      : {}),
    ...(typeof body.uiAnimations === "boolean" ? { uiAnimations: body.uiAnimations } : {}),
    ...(theme ? { theme } : {}),
    ...(typeof body.ambientEnabled === "boolean" ? { ambientEnabled: body.ambientEnabled } : {}),
    ...(typeof body.grainEnabled === "boolean" ? { grainEnabled: body.grainEnabled } : {}),
    ...(typeof body.motionEnabled === "boolean" ? { motionEnabled: body.motionEnabled } : {}),
    ...(typeof body.colorSync === "boolean" ? { colorSync: body.colorSync } : {}),
  };

  const write = await withSchema("preferences:write", async () => {
    await ensureSeeded();
    await db
      .insert(preferences)
      .values({ id: "default", ...DEFAULT_PREFERENCES, ...next, updatedAt: savedAt })
      .onConflictDoUpdate({ target: preferences.id, set: { ...next, updatedAt: savedAt } });
    return true;
  });

  if (!write.ok) {
    // 200 on purpose: the client already persisted this locally, and a 5xx here
    // would show up in the console as a crash for something that is fine.
    return Response.json({
      ok: false,
      persisted: false,
      preferences: next,
      savedAt: savedAt.getTime(),
      detail: write.reason,
    });
  }

  return Response.json({ ok: true, persisted: true, preferences: next, savedAt: savedAt.getTime() });
}
