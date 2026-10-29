/**
 * Playback transport — executed directly from the browser.
 *
 * Every call targets `https://api.spotify.com/v1/me/player…?device_id=<id>`
 * with the listener's own access token. Nothing is proxied through Next.js, so
 * there is no serverless timeout in the path of a play command.
 *
 * Payload rules enforced here:
 *   · a single track or an arbitrary queue → `{ uris: [...], position_ms }`
 *   · a full playlist or album             → `{ context_uri, offset }`
 *   · never both in the same request (Spotify rejects it with 400)
 *
 * Failure recovery:
 *   · 503 / 404 / device error → PUT /me/player {device_ids:[id], play:false}
 *     → wait 500 ms → retry the original command once.
 */

const API = "https://api.spotify.com/v1";

export type TransportFailureKind =
  | "no-device"
  | "premium"
  | "token"
  | "rate"
  | "network"
  | "payload"
  | "other";

export type TransportResult =
  | { ok: true; status: number }
  | { ok: false; status: number; kind: TransportFailureKind; message: string };

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function headers(token: string, body?: unknown): HeadersInit {
  return {
    Authorization: `Bearer ${token}`,
    ...(body === undefined ? {} : { "Content-Type": "application/json" }),
  };
}

function classify(status: number, message: string): TransportFailureKind {
  if (status === 401) return "token";
  if (status === 404 || status === 503) return "no-device";
  if (status === 429) return "rate";
  if (status === 400) return "payload";
  if (status === 403) {
    return /premium/i.test(message) ? "premium" : "no-device";
  }
  return "other";
}

async function send(
  token: string,
  path: string,
  deviceId: string | null,
  init: { method?: string; body?: unknown } = {},
): Promise<TransportResult> {
  const url = new URL(`${API}${path}`);
  if (deviceId) url.searchParams.set("device_id", deviceId);

  try {
    const res = await fetch(url.toString(), {
      method: init.method ?? "PUT",
      headers: headers(token, init.body),
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    });

    if (res.ok || res.status === 204) return { ok: true, status: res.status };

    let message = `Spotify answered ${res.status}`;
    try {
      const data = (await res.json()) as { error?: { message?: string; reason?: string } };
      if (data?.error?.message) message = data.error.message;
      else if (data?.error?.reason) message = data.error.reason;
    } catch {
      /* non-JSON error body */
    }

    return { ok: false, status: res.status, kind: classify(res.status, message), message };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      kind: "network",
      message: error instanceof Error ? error.message : "Network error contacting Spotify",
    };
  }
}

/** `PUT /v1/me/player` — move playback onto a specific device. */
export function transferPlayback(
  token: string,
  deviceId: string,
  play = false,
): Promise<TransportResult> {
  return send(token, "/me/player", null, {
    method: "PUT",
    body: { device_ids: [deviceId], play },
  });
}

interface PlayOptions {
  positionMs?: number;
  /** `offset.uri` — the exact clicked track inside a context (preferred). */
  offsetUri?: string | null;
  /** `offset.position` — index fallback when the track URI is unknown. */
  offsetIndex?: number;
  /**
   * Where to start inside a `uris` queue. The Web API has **no** offset for a
   * URI list, so the queue is sliced from here — otherwise Spotify always
   * starts at `uris[0]` no matter which row was clicked.
   */
  startIndex?: number;
  recovery?: RecoveryOptions;
}

export interface RecoveryOptions {
  /**
   * Runs after a failure and before each retry — the place to call
   * `player.activateElement()`, which unlocks the MediaKey/DRM audio context.
   */
  recover?: () => Promise<void> | void;
  /** Delay before the single retry after re-activation on a 503 (default 400 ms). */
  fastRetryMs?: number;
  /** Delay before the retry after a device transfer (default 500 ms). */
  retryDelayMs?: number;
}

/** A 503 is the DRM/EME "media keys not ready yet" signature. */
const isServiceUnavailable = (r: TransportResult) => !r.ok && r.status === 503;
const isDeviceFailure = (r: TransportResult) => !r.ok && r.kind === "no-device";

/**
 * 503 / 404 / device-error recovery: transfer playback to the Web Player
 * instance, wait 500 ms, then run the original command again.
 */
async function activate(recovery: RecoveryOptions): Promise<void> {
  try {
    await recovery.recover?.();
  } catch {
    /* activation is best-effort */
  }
}

/**
 * Recovery for a failed playback command — exactly one retry.
 *
 *   503 (DRM/EME not ready) → resolve `player.activateElement()` → 400 ms → retry once
 *   404 / device error      → `PUT /me/player {device_ids:[id], play:false}` → 500 ms → retry once
 *   403 Premium, 401 token  → no retry (it would only burn quota)
 *
 * The preventive transfer happens *before* the first attempt (see
 * `transferIfNeeded` in the player), which is what removes the 503 in the
 * common case rather than recovering from it.
 */
async function withTransferRetry(
  token: string,
  deviceId: string | null,
  operation: () => Promise<TransportResult>,
  recovery: RecoveryOptions = {},
): Promise<TransportResult> {
  let result = await operation();
  if (result.ok) return result;
  if (!deviceId || (!isServiceUnavailable(result) && !isDeviceFailure(result))) return result;

  // ---- 503: an unlocked-media-keys problem, not a routing one ----
  if (isServiceUnavailable(result)) {
    await activate(recovery); // ensure activateElement() has resolved
    await wait(recovery.fastRetryMs ?? 400);
    const retried = await operation();
    return retried;
  }

  // ---- 404 / device error: the device is not attached, so attach it ----
  await activate(recovery);
  const transferred = await transferPlayback(token, deviceId, false);
  await wait(recovery.retryDelayMs ?? 500);
  const retried = await operation();
  if (retried.ok) return retried;

  if (!transferred.ok && isDeviceFailure(retried)) {
    return {
      ...retried,
      message: `${retried.message} (transfer to the Echoes player also failed: ${transferred.message})`,
    };
  }
  return retried;
}

/** Single track or arbitrary queue → `uris` only. */
export function playUris(
  token: string,
  deviceId: string | null,
  uris: string[],
  options: PlayOptions = {},
): Promise<TransportResult> {
  const start = Math.min(Math.max(options.startIndex ?? 0, 0), Math.max(uris.length - 1, 0));
  const queue = uris.slice(start);

  if (!queue.length) {
    return Promise.resolve({
      ok: false,
      status: 400,
      kind: "payload",
      message: "Nothing to play.",
    });
  }
  // `{ uris: [...], position_ms }` and never a context_uri in the same body —
  // Spotify rejects a play request that carries both. The clicked track must be
  // first in the array, because a URI queue cannot carry an offset.
  const body = { uris: queue, position_ms: options.positionMs ?? 0 };
  return withTransferRetry(
    token,
    deviceId,
    () => send(token, "/me/player/play", deviceId, { body }),
    options.recovery,
  );
}

/**
 * The exact single-track request:
 *   PUT https://api.spotify.com/v1/me/player/play?device_id=${window.spotifyDeviceId}
 *   { "uris": ["spotify:track:TRACK_ID"], "position_ms": 0 }
 */
export function playTrack(
  token: string,
  deviceId: string | null,
  trackIdOrUri: string,
  options: PlayOptions & { recovery?: RecoveryOptions } = {},
): Promise<TransportResult> {
  const uri = trackIdOrUri.startsWith("spotify:") ? trackIdOrUri : `spotify:track:${trackIdOrUri}`;
  const body = { uris: [uri], position_ms: options.positionMs ?? 0 };
  return withTransferRetry(
    token,
    deviceId,
    () => send(token, "/me/player/play", deviceId, { body }),
    options.recovery,
  );
}

/** Full playlist or album → `context_uri` only. */
export function playContext(
  token: string,
  deviceId: string | null,
  contextUri: string,
  options: PlayOptions = {},
): Promise<TransportResult> {
  const body: Record<string, unknown> = {
    context_uri: contextUri,
    position_ms: options.positionMs ?? 0,
  };
  // Exactly one offset form: the clicked track's URI when we have it (robust
  // against filtered/episodes-skipped lists), otherwise its index position.
  if (options.offsetUri) body.offset = { uri: options.offsetUri };
  else if (typeof options.offsetIndex === "number" && options.offsetIndex > 0) {
    body.offset = { position: options.offsetIndex };
  }

  return withTransferRetry(
    token,
    deviceId,
    () => send(token, "/me/player/play", deviceId, { body }),
    options.recovery,
  );
}

/* -------------------------------------------------------------------------- */
/*  Universal playback payload handler                                        */
/* -------------------------------------------------------------------------- */

export interface PlayTarget {
  id: string;
  uri?: string | null;
}

/** Sources that must follow their own list order, exactly. */
export const ORDERED_SOURCES = ["playlist", "saved", "album", "artist"] as const;
export type OrderedSource = (typeof ORDERED_SOURCES)[number];

export interface PlayRequestPayload {
  /** The track that was clicked, when the user clicked one track. */
  single?: PlayTarget | null;
  /** The surrounding list, for bulk actions ("play all", shuffle). */
  tracks?: PlayTarget[];
  /** Start position inside `tracks`. */
  index?: number;
  /** Set when the click happened inside a playlist or album. */
  contextUri?: string | null;
  /** Where playback started; ordered sources never use context autoplay. */
  source?: string;
}

export type PlayDecision =
  | { kind: "context"; contextUri: string; offsetUri: string | null; offsetIndex: number }
  | { kind: "single"; uri: string }
  | { kind: "queue"; uris: string[]; startIndex: number }
  | { kind: "empty"; reason: string };

function trackUri(target: PlayTarget): string {
  return target.uri ?? `spotify:track:${target.id}`;
}

/**
 * Decides the exact `PUT /v1/me/player/play` body for a click, whatever surface
 * it came from:
 *
 *   playlist/album row  → context_uri + offset.uri  (+ position_ms: 0)
 *   standalone track    → uris: [<that one uri>]    (+ position_ms: 0)
 *   bulk play/shuffle   → context_uri when there is one, else a sliced uris list
 *
 * `context_uri` and `uris` are never produced together.
 */
export function decidePlayPayload(request: PlayRequestPayload): PlayDecision {
  const index = Math.max(0, request.index ?? 0);

  if (request.single) {
    if (request.contextUri) {
      return {
        kind: "context",
        contextUri: request.contextUri,
        offsetUri: request.single.uri ?? null,
        offsetIndex: index,
      };
    }
    return { kind: "single", uri: trackUri(request.single) };
  }

  const list = request.tracks ?? [];
  const uris = list.map(trackUri).filter((uri) => uri.startsWith("spotify:"));
  if (!uris.length) return { kind: "empty", reason: "Nothing to play." };

  const start = Math.min(index, uris.length - 1);
  // Echoes owns the queue end-to-end: every list play sends ONLY the selected
  // track's URI, so Spotify never auto-continues into its own order and cannot
  // race our queue. A context is used only for explicit free-form context plays.
  const ordered =
    request.source !== undefined &&
    (ORDERED_SOURCES as readonly string[]).includes(request.source);
  if (request.contextUri && !ordered) {
    return {
      kind: "context",
      contextUri: request.contextUri,
      offsetUri: list[start]?.uri ?? null,
      offsetIndex: start,
    };
  }
  return { kind: "single", uri: uris[start] };
}

/** Resolves the decision and issues exactly one play request (plus recovery). */
export async function executePlay(
  token: string,
  deviceId: string | null,
  request: PlayRequestPayload,
  recovery?: RecoveryOptions,
): Promise<TransportResult> {
  const decision = decidePlayPayload(request);

  switch (decision.kind) {
    case "context":
      return playContext(token, deviceId, decision.contextUri, {
        offsetUri: decision.offsetUri,
        offsetIndex: decision.offsetIndex,
        positionMs: 0,
        recovery,
      });
    case "single":
      return playTrack(token, deviceId, decision.uri, { positionMs: 0, recovery });
    case "queue":
      return playUris(token, deviceId, decision.uris, {
        startIndex: decision.startIndex,
        positionMs: 0,
        recovery,
      });
    default:
      return { ok: false, status: 400, kind: "payload", message: decision.reason };
  }
}

export function pause(
  token: string,
  deviceId: string | null,
  recovery?: RecoveryOptions,
): Promise<TransportResult> {
  return withTransferRetry(token, deviceId, () => send(token, "/me/player/pause", deviceId), recovery);
}

export function resume(
  token: string,
  deviceId: string | null,
  recovery?: RecoveryOptions,
): Promise<TransportResult> {
  return withTransferRetry(
    token,
    deviceId,
    () => send(token, "/me/player/play", deviceId, { body: {} }),
    recovery,
  );
}

export function nextTrack(
  token: string,
  deviceId: string | null,
  recovery?: RecoveryOptions,
): Promise<TransportResult> {
  return withTransferRetry(
    token,
    deviceId,
    () => send(token, "/me/player/next", deviceId, { method: "POST" }),
    recovery,
  );
}

export function previousTrack(
  token: string,
  deviceId: string | null,
  recovery?: RecoveryOptions,
): Promise<TransportResult> {
  return withTransferRetry(
    token,
    deviceId,
    () => send(token, "/me/player/previous", deviceId, { method: "POST" }),
    recovery,
  );
}

export function seekTo(token: string, deviceId: string | null, positionMs: number): Promise<TransportResult> {
  return send(token, `/me/player/seek?position_ms=${Math.round(positionMs)}`, deviceId);
}

export function setVolumePercent(
  token: string,
  deviceId: string | null,
  percent: number,
): Promise<TransportResult> {
  return send(token, `/me/player/volume?volume_percent=${Math.round(percent)}`, deviceId);
}

export function setShuffleState(
  token: string,
  deviceId: string | null,
  state: boolean,
): Promise<TransportResult> {
  return send(token, `/me/player/shuffle?state=${state}`, deviceId);
}

export function setRepeatState(
  token: string,
  deviceId: string | null,
  state: "off" | "context" | "track",
): Promise<TransportResult> {
  return send(token, `/me/player/repeat?state=${state}`, deviceId);
}

export function activeDeviceId(): string | null {
  if (typeof window === "undefined") return null;
  return window.spotifyDeviceId ?? null;
}

/** Human guidance for each failure kind — surfaced by the device panel. */
export function guidanceFor(result: TransportResult): string | null {
  if (result.ok) return null;
  switch (result.kind) {
    case "no-device":
      return "Please open Spotify and play a track once to activate your device.";
    case "premium":
      return "Playback control needs Spotify Premium.";
    case "token":
      return "Your Spotify session expired — reconnect from the profile menu.";
    case "rate":
      return "Spotify is rate-limiting. Try again in a moment.";
    case "network":
      return "Could not reach Spotify. Check your connection.";
    case "payload":
      return result.message;
    default:
      return result.message;
  }
}
