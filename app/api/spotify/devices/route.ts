import { withSpotify } from "@/lib/server/token";
import { spotifyFetch, type SpDevicesResponse } from "@/lib/spotify/client";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/spotify/devices          → GET  /v1/me/player/devices
 * PUT /api/spotify/devices {id}     → PUT  /v1/me/player  (transfer playback)
 *
 * Both go through `withSpotify`, so an expired token is refreshed here instead
 * of surfacing as a 403/404 device error in the player.
 */
export async function GET(request: Request): Promise<Response> {
  const result = await withSpotify(request, (token) =>
    spotifyFetch<SpDevicesResponse>("/me/player/devices", token),
  );

  if (!result.ok) {
    return Response.json(
      { error: result.error, message: result.message, devices: [] },
      { status: result.status, headers: result.headers },
    );
  }

  return Response.json(
    { devices: result.data?.devices ?? [] },
    {
      headers: new Headers([
        ...[...result.headers.entries()],
        ["Cache-Control", "no-store, max-age=0, must-revalidate"],
      ]),
    },
  );
}

export async function PUT(request: Request): Promise<Response> {
  const body = (await request.json().catch(() => null)) as {
    deviceId?: string;
    device_ids?: string[];
    play?: boolean;
  } | null;

  const deviceId = body?.deviceId ?? body?.device_ids?.[0];
  if (!deviceId || typeof deviceId !== "string") {
    return Response.json({ error: "deviceId required" }, { status: 400 });
  }

  const play = Boolean(body?.play);
  const result = await withSpotify(request, (token) =>
    spotifyFetch<void>("/me/player", token, {
      method: "PUT",
      body: JSON.stringify({ device_ids: [deviceId], play }),
    }),
  );

  if (!result.ok) {
    return Response.json(
      { error: result.error, message: result.message },
      { status: result.status, headers: result.headers },
    );
  }

  return Response.json({ ok: true, deviceId, play }, { headers: result.headers });
}
