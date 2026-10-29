/**
 * Spotify OAuth 2.0 — Authorization Code with PKCE.
 *
 * Fully client-side: no client secret ever touches this codebase.
 * Configure `NEXT_PUBLIC_SPOTIFY_CLIENT_ID` (and optionally
 * `NEXT_PUBLIC_SPOTIFY_REDIRECT_URI`) in `.env.local`. When no client id is
 * present, Echoes boots into Demo Mode with a locally-hosted catalog.
 *
 * IFRAMED PREVIEWS
 * ----------------
 * Spotify sends `X-Frame-Options: DENY`, so accounts.spotify.com can never be
 * rendered inside a preview iframe ("refused to connect"). Every navigation we
 * perform therefore targets the *top* window. There is a second trap: storage
 * inside a third-party iframe is partitioned, so a PKCE verifier written here
 * would be unreadable once Spotify bounces the top window back to the app.
 * `beginLogin()` solves this with a relay hop — it first lifts the app itself
 * to the top level (`?echoes_auth=1`), and that unpartitioned instance is the
 * one that generates the verifier and redirects to Spotify.
 */

export const SPOTIFY_AUTH_URL = "https://accounts.spotify.com/authorize";
export const SPOTIFY_TOKEN_URL = "https://accounts.spotify.com/api/token";
export const SPOTIFY_API_URL = "https://api.spotify.com/v1";

const STORAGE_KEY = "echoes.spotify.session.v1";
const VERIFIER_KEY = "echoes.pkce.verifier";
const STATE_KEY = "echoes.pkce.state";

/** Query flag used for the iframe → top-level relay hop. */
export const RELAY_FLAG = "echoes_auth";

/** Surfaced verbatim by the login screen, which pairs it with an escape hatch. */
export const BLOCKED_FRAME_MESSAGE =
  "This preview frame blocks top-level navigation. Open Echoes in its own tab to connect Spotify.";

/**
 * Every scope Echoes needs, requested explicitly on each login.
 *
 * `playlist-read-private` / `playlist-read-collaborative` → the library grid
 * `user-read-playback-state`                             → /me/player polling
 * `user-modify-playback-state`                           → play · pause · skip · seek
 * `user-read-currently-playing`                          → the player bar
 *
 * NB: Spotify only re-asks for consent when the scope list grows, so the
 * authorize URL sends `show_dialog=true` — the prompt always appears and the
 * updated scopes take effect immediately instead of being silently reused.
 */
export const SCOPES = [
  // playback control + state (required for the player bar and transport)
  "user-read-playback-state",
  "user-modify-playback-state",
  "user-read-currently-playing",
  // library — the unified /me/library endpoints read and write these too
  "user-library-read",
  "user-library-modify",
  "user-follow-read",
  "user-follow-modify",
  "playlist-read-private",
  "playlist-read-collaborative",
  "user-read-private",
  "user-read-email",
  "user-read-recently-played",
  "user-top-read",
  "streaming",
].join(" ");

export interface SpotifySession {
  accessToken: string;
  refreshToken?: string;
  /** epoch ms */
  expiresAt: number;
  scope: string;
  tokenType: string;
}

export function spotifyClientId(): string {
  return (process.env.NEXT_PUBLIC_SPOTIFY_CLIENT_ID ?? "").trim();
}

export function isSpotifyConfigured(): boolean {
  return spotifyClientId().length > 0;
}

/** The app's own absolute URL — identical whether framed or at top level. */
export function appUrl(): string {
  if (typeof window === "undefined") return "http://localhost:3000/";
  return `${window.location.origin}${window.location.pathname}`;
}

export function redirectUri(): string {
  const configured = (process.env.NEXT_PUBLIC_SPOTIFY_REDIRECT_URI ?? "").trim();
  return configured || appUrl();
}

/* --------------------------- frame awareness ---------------------------- */

/** True when Echoes is embedded in a preview iframe / another document. */
export function isFramed(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.self !== window.top;
  } catch {
    // Cross-origin access threw — we are definitely not the top window.
    return true;
  }
}

export function hasRelayFlag(): boolean {
  if (typeof window === "undefined") return false;
  return new URLSearchParams(window.location.search).has(RELAY_FLAG);
}

/** Builds the top-level URL that restarts the login flow outside the iframe. */
export function relayUrl(): string {
  const url = new URL(appUrl());
  url.searchParams.set(RELAY_FLAG, "1");
  return url.toString();
}

export function stripRelayFlag(): void {
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
  url.searchParams.delete(RELAY_FLAG);
  window.history.replaceState({}, document.title, url.toString());
}

/**
 * Navigates the *topmost* reachable window, falling back gracefully:
 * `window.top` → `window.parent` → self → new tab.
 *
 * Assigning `location.href` on a cross-origin window is explicitly permitted by
 * browsers (reading it is not), so this works from inside a sandboxed preview
 * unless the frame lacks `allow-top-navigation` — in which case we still have
 * two more escape hatches.
 */
export function navigateTopWindow(url: string): "top" | "parent" | "self" | null {
  if (typeof window === "undefined") return null;

  // 1 — the topmost window. This is the escape hatch from a preview iframe.
  try {
    if (window.top && window.top !== window.self) {
      window.top.location.href = url;
      return "top";
    }
  } catch {
    /* top navigation blocked — try the immediate parent */
  }

  // 2 — the immediate parent (one level of framing).
  try {
    if (window.parent && window.parent !== window.self) {
      window.parent.location.href = url;
      return "parent";
    }
  } catch {
    /* parent navigation blocked too */
  }

  // 3 — we are already the top window: ordinary navigation.
  if (!isFramed()) {
    try {
      window.location.href = url;
      return "self";
    } catch {
      /* ignore */
    }
  }

  // Framed and every breakout was refused — let the caller surface an
  // explicit "open in a new tab" action instead of failing silently.
  return null;
}

/* ------------------------------ PKCE helpers ----------------------------- */

function randomString(length: number): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~";
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => chars[b % chars.length]).join("");
}

function base64UrlEncode(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let str = "";
  bytes.forEach((b) => (str += String.fromCharCode(b)));
  return btoa(str).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export async function createCodeChallenge(verifier: string): Promise<string> {
  const data = new TextEncoder().encode(verifier);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return base64UrlEncode(digest);
}

/** Dual-write: sessionStorage survives the redirect, localStorage survives reloads. */
function writePkce(key: string, value: string): void {
  try {
    sessionStorage.setItem(key, value);
  } catch {
    /* ignore */
  }
  try {
    localStorage.setItem(key, value);
  } catch {
    /* ignore */
  }
}

function readPkce(key: string): string | null {
  try {
    const value = sessionStorage.getItem(key);
    if (value) return value;
  } catch {
    /* ignore */
  }
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function clearPkce(): void {
  for (const key of [VERIFIER_KEY, STATE_KEY]) {
    try {
      sessionStorage.removeItem(key);
    } catch {
      /* ignore */
    }
    try {
      localStorage.removeItem(key);
    } catch {
      /* ignore */
    }
  }
}

export function buildAuthUrl(state: string, challenge: string): string {
  const params = new URLSearchParams({
    client_id: spotifyClientId(),
    response_type: "code",
    redirect_uri: redirectUri(),
    code_challenge_method: "S256",
    code_challenge: challenge,
    state,
    scope: SCOPES,
    // Force the consent screen so newly added scopes are granted right away.
    show_dialog: "true",
  });
  return `${SPOTIFY_AUTH_URL}?${params.toString()}`;
}

/**
 * Starts the PKCE flow.
 *
 * Inside an iframe this performs the relay hop first (lifting the app to the
 * top window) so the verifier lands in unpartitioned storage; the reloaded
 * top-level instance calls `beginLogin()` again and takes the direct path.
 */
export async function beginLogin(): Promise<void> {
  if (!isSpotifyConfigured()) {
    throw new Error("NEXT_PUBLIC_SPOTIFY_CLIENT_ID is not configured.");
  }

  if (isFramed()) {
    const via = navigateTopWindow(relayUrl());
    if (via === "top" || via === "parent") return; // the top-level instance restarts the flow
    throw new Error(BLOCKED_FRAME_MESSAGE);
  }

  const verifier = randomString(64);
  const state = randomString(16);
  writePkce(VERIFIER_KEY, verifier);
  writePkce(STATE_KEY, state);

  const challenge = await createCodeChallenge(verifier);

  // Never hand the authorization URL to a frame: Spotify denies embedding.
  const via = navigateTopWindow(buildAuthUrl(state, challenge));
  if (!via) {
    clearPkce();
    throw new Error("Could not open Spotify. Allow pop-ups or open Echoes in its own tab.");
  }
}

interface TokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  refresh_token?: string;
  scope?: string;
  error?: string;
  error_description?: string;
}

export async function exchangeCodeForToken(code: string): Promise<SpotifySession> {
  const verifier = readPkce(VERIFIER_KEY);
  if (!verifier) {
    clearPkce();
    throw new Error(
      "The PKCE verifier was lost between redirects. Start the login flow again from the top window.",
    );
  }

  const body = new URLSearchParams({
    client_id: spotifyClientId(),
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri(),
    code_verifier: verifier,
  });

  const res = await fetch(SPOTIFY_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });

  const data = (await res.json()) as TokenResponse;
  if (!res.ok || data.error) {
    throw new Error(data.error_description ?? data.error ?? `Token exchange failed (${res.status})`);
  }

  clearPkce();

  const session: SpotifySession = {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: Date.now() + Math.max(60, data.expires_in - 45) * 1000,
    scope: data.scope ?? SCOPES,
    tokenType: data.token_type,
  };
  saveSession(session);
  return session;
}

/** CSRF check for the returned `state` (lenient when nothing was stored). */
export function verifyCallbackState(returned: string | null): boolean {
  const expected = readPkce(STATE_KEY);
  if (!expected) return true;
  return returned === expected;
}

export async function refreshSession(session: SpotifySession): Promise<SpotifySession | null> {
  if (!session.refreshToken) return null;
  const body = new URLSearchParams({
    client_id: spotifyClientId(),
    grant_type: "refresh_token",
    refresh_token: session.refreshToken,
  });
  const res = await fetch(SPOTIFY_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!res.ok) return null;
  const data = (await res.json()) as TokenResponse;
  const next: SpotifySession = {
    accessToken: data.access_token,
    refreshToken: data.refresh_token ?? session.refreshToken,
    expiresAt: Date.now() + Math.max(60, data.expires_in - 45) * 1000,
    scope: data.scope ?? session.scope,
    tokenType: data.token_type,
  };
  saveSession(next);
  return next;
}

export function saveSession(session: SpotifySession): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
  } catch {
    /* storage disabled — session lives in memory only */
  }
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(session));
  } catch {
    /* ignore */
  }
}

export function loadSession(): SpotifySession | null {
  for (const read of [
    () => localStorage.getItem(STORAGE_KEY),
    () => sessionStorage.getItem(STORAGE_KEY),
  ]) {
    try {
      const raw = read();
      if (!raw) continue;
      const parsed = JSON.parse(raw) as SpotifySession;
      if (parsed?.accessToken) return parsed;
    } catch {
      /* ignore */
    }
  }
  return null;
}

export function clearSession(): void {
  for (const remove of [
    () => localStorage.removeItem(STORAGE_KEY),
    () => sessionStorage.removeItem(STORAGE_KEY),
  ]) {
    try {
      remove();
    } catch {
      /* ignore */
    }
  }
  clearPkce();
}

/** Reads the `?code=&state=` pair Spotify appends to the redirect URI. */
export function readCallbackParams(): { code: string | null; state: string | null; error: string | null } {
  if (typeof window === "undefined") return { code: null, state: null, error: null };
  const params = new URLSearchParams(window.location.search);
  return {
    code: params.get("code"),
    state: params.get("state"),
    error: params.get("error"),
  };
}

export function stripCallbackParams(): void {
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
  url.searchParams.delete("code");
  url.searchParams.delete("state");
  window.history.replaceState({}, document.title, url.toString());
}
