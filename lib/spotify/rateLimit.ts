/**
 * Global 429 circuit breaker.
 *
 * One shared switch for every Spotify metadata lookup, client and server. When
 * a rate limit is seen we stop asking — immediately, for everything — instead of
 * letting each caller retry on its own schedule. Backoff escalates with repeated
 * hits and honours `Retry-After` when Spotify supplies one.
 */

const BASE_BACKOFF_MS = 60_000;
const MAX_BACKOFF_MS = 15 * 60_000;

interface BreakerState {
  blockedUntil: number;
  hits: number;
  lastSource: string | null;
  warnedAt: number;
  /** A 429 halts metadata for the whole session until the listener opts back in. */
  sessionHalt: boolean;
}

const state: BreakerState = {
  blockedUntil: 0,
  hits: 0,
  lastSource: null,
  warnedAt: 0,
  sessionHalt: false,
};

/** True while the breaker is open: callers must not touch the network. */
export function rateLimited(): boolean {
  return state.sessionHalt || Date.now() < state.blockedUntil;
}

/** True once a 429 has halted metadata for this session. */
export function sessionHalted(): boolean {
  return state.sessionHalt;
}

/** How long the breaker stays open, in ms (0 when closed, Infinity on a session halt). */
export function rateLimitRemainingMs(): number {
  if (state.sessionHalt) return Number.POSITIVE_INFINITY;
  return Math.max(0, state.blockedUntil - Date.now());
}

export function rateLimitInfo(): { blocked: boolean; hits: number; remainingMs: number; lastSource: string | null } {
  return {
    blocked: rateLimited(),
    hits: state.hits,
    remainingMs: rateLimitRemainingMs(),
    lastSource: state.lastSource,
  };
}

/**
 * Records a 429 and **halts metadata requests for the session**.
 *
 * No retry loop, no backoff ladder to climb: one clean warning, then silence
 * until the listener explicitly refreshes. Cached artwork and details keep
 * rendering, and playback commands are unaffected — only metadata enrichment
 * stops.
 */
export function noteRateLimit(source: string, retryAfterSeconds?: number | null): void {
  state.hits += 1;
  state.lastSource = source;
  state.sessionHalt = true;

  // Spotify's own `Retry-After` is authoritative — honour it (floored at 1 s so
  // a `0` header cannot re-open the floodgates). Escalating backoff is only used
  // when the header is absent.
  // Retained for diagnostics only; the halt is what actually gates callers.
  const fromHeader =
    typeof retryAfterSeconds === "number" && retryAfterSeconds > 0
      ? Math.min(Math.max(retryAfterSeconds * 1000, 1000), MAX_BACKOFF_MS)
      : 0;
  state.blockedUntil = Date.now() + (fromHeader || BASE_BACKOFF_MS);

  // One clean warning per window — never a stack trace per attempt.
  if (Date.now() - state.warnedAt > 60_000) {
    state.warnedAt = Date.now();
    console.warn(
      `[echoes] Spotify rate limit (429) from ${source} — metadata requests halted for this session. ` +
        "Cached artwork and details keep rendering; playback is unaffected. Use Refresh to try again.",
    );
  }
}

/**
 * A clean success ends the halt — but only when the listener explicitly asked
 * for fresh data (Refresh), because a halted session issues no metadata calls
 * that could succeed on their own.
 */
export function noteSuccess(): void {
  if (state.hits > 0 || state.sessionHalt) {
    state.hits = 0;
    state.blockedUntil = 0;
    state.sessionHalt = false;
  }
}

/** Explicit, user-initiated opt back in (the Refresh action) and test hook. */
export function resetRateLimit(): void {
  state.blockedUntil = 0;
  state.hits = 0;
  state.lastSource = null;
  state.warnedAt = 0;
  state.sessionHalt = false;
}

/** Reads `Retry-After` (seconds or HTTP-date) from a response. */
export function retryAfterSeconds(headers: Headers | Record<string, string> | null): number | null {
  if (!headers) return null;
  const raw =
    headers instanceof Headers
      ? headers.get("retry-after")
      : (headers["retry-after"] ?? headers["Retry-After"] ?? null);
  if (!raw) return null;
  const seconds = Number(raw);
  if (Number.isFinite(seconds)) return Math.max(0, seconds);
  const date = Date.parse(raw);
  return Number.isFinite(date) ? Math.max(0, Math.round((date - Date.now()) / 1000)) : null;
}

/** True when an error/status should be treated as a rate limit. */
export function isRateLimitStatus(status: number): boolean {
  return status === 429;
}
