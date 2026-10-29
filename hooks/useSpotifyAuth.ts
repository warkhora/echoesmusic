"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useClientValue } from "@/hooks/useClientValue";
import {
  BLOCKED_FRAME_MESSAGE,
  beginLogin,
  clearSession,
  exchangeCodeForToken,
  hasRelayFlag,
  isFramed,
  isSpotifyConfigured,
  loadSession,
  readCallbackParams,
  refreshSession,
  saveSession,
  stripCallbackParams,
  stripRelayFlag,
  verifyCallbackState,
  type SpotifySession,
} from "@/lib/spotify/auth";
import { spotifyFetch } from "@/lib/spotify/client";
import { dropSession, publishSession, registerTokenAdopter } from "@/lib/spotify/sessionClient";
import { clearLocalLibrary } from "@/lib/localLibrary";
import type { EchoProfile } from "@/lib/types";

export type AuthStatus = "booting" | "demo" | "connecting" | "connected" | "error";

interface SpotifyMe {
  id: string;
  display_name: string | null;
  product?: string;
  images?: { url: string }[];
  followers?: { total?: number };
}

export interface SpotifyAuth {
  status: AuthStatus;
  mode: "demo" | "spotify";
  configured: boolean;
  /** Echoes is running inside a preview iframe — login breaks out of it. */
  framed: boolean;
  /** True when the host frame refused top-level navigation. */
  breakoutBlocked: boolean;
  session: SpotifySession | null;
  profile: EchoProfile | null;
  error: string | null;
  login: () => Promise<void>;
  logout: () => void;
  enterDemoMode: () => void;
  getAccessToken: () => Promise<string | null>;
}

const DEMO_PROFILE: EchoProfile = {
  id: "demo",
  displayName: "Guest Listener",
  avatarUrl: null,
  product: "echoes demo",
  mode: "demo",
};

export function useSpotifyAuth(): SpotifyAuth {
  const configured = useMemo(() => isSpotifyConfigured(), []);
  const [session, setSession] = useState<SpotifySession | null>(null);
  const [profile, setProfile] = useState<EchoProfile | null>(null);
  const [status, setStatus] = useState<AuthStatus>("booting");
  const [error, setError] = useState<string | null>(null);
  const framed = useClientValue(isFramed, false);
  const sessionRef = useRef<SpotifySession | null>(null);
  useEffect(() => {
    sessionRef.current = session;
  }, [session]);

  /**
   * Mirror the session server-side so API routes can refresh it themselves, and
   * adopt any rotated tokens those routes hand back. Publishing is idempotent
   * per access token and silently skipped when the store is unavailable.
   */
  const publishedToken = useRef<string | null>(null);

  const adoptToken = useCallback((accessToken: string, refreshToken?: string) => {
    const previous = sessionRef.current;
    if (!previous || previous.accessToken === accessToken) return;
    const next: SpotifySession = {
      ...previous,
      accessToken,
      refreshToken: refreshToken ?? previous.refreshToken,
      expiresAt: Date.now() + 55 * 60_000,
    };
    publishedToken.current = accessToken; // the server just minted it
    saveSession(next);
    setSession(next);
  }, []);

  useEffect(() => registerTokenAdopter(adoptToken), [adoptToken]);

  useEffect(() => {
    if (!session || publishedToken.current === session.accessToken) return;
    publishedToken.current = session.accessToken;
    void publishSession(session, profile?.id);
  }, [session, profile?.id]);

  const getAccessToken = useCallback(async (): Promise<string | null> => {
    const current = sessionRef.current;
    if (!current) return null;
    if (current.expiresAt - Date.now() > 20_000) return current.accessToken;
    const next = await refreshSession(current);
    if (!next) {
      clearSession();
      setSession(null);
      setProfile(null);
      setStatus("demo");
      return null;
    }
    setSession(next);
    return next.accessToken;
  }, []);

  /* ------------------------------- bootstrap ------------------------------ */
  useEffect(() => {
    let cancelled = false;

    async function boot() {
      const { code, state, error: authError } = readCallbackParams();

      if (authError) {
        stripCallbackParams();
        if (!cancelled) {
          setError(
            authError === "access_denied"
              ? "Spotify authorization was cancelled."
              : `Spotify denied the request (${authError}).`,
          );
          setStatus("error");
        }
        return;
      }

      // Returning from accounts.spotify.com with an authorization code.
      if (code && configured) {
        stripCallbackParams();
        if (!verifyCallbackState(state)) {
          if (!cancelled) {
            setError("Security check failed (state mismatch). Please try connecting again.");
            setStatus("error");
          }
          return;
        }
        if (!cancelled) setStatus("connecting");
        try {
          const next = await exchangeCodeForToken(code);
          if (cancelled) return;
          setSession(next);
          return;
        } catch (err) {
          if (!cancelled) {
            setError(err instanceof Error ? err.message : "Token exchange failed.");
            setStatus("error");
          }
          return;
        }
      }

      // Relay hop: we were lifted out of a preview iframe for the sole purpose
      // of starting the login flow with unpartitioned storage. Continue now.
      if (configured && hasRelayFlag()) {
        stripRelayFlag();
        if (isFramed()) {
          if (!cancelled) {
            setProfile(DEMO_PROFILE);
            setStatus("demo");
          }
          return;
        }
        if (!cancelled) setStatus("connecting");
        try {
          await beginLogin();
        } catch (err) {
          if (!cancelled) {
            setError(err instanceof Error ? err.message : "Login failed.");
            setStatus("error");
            setProfile(DEMO_PROFILE);
          }
        }
        return;
      }

      const stored = loadSession();
      if (stored && configured) {
        const fresh =
          stored.expiresAt - Date.now() > 20_000 ? stored : await refreshSession(stored);
        if (fresh) {
          saveSession(fresh);
          if (!cancelled) setSession(fresh);
          return;
        }
        clearSession();
      }

      if (!cancelled) {
        setProfile(DEMO_PROFILE);
        setStatus("demo");
      }
    }

    void boot();
    return () => {
      cancelled = true;
    };
  }, [configured]);

  /* -------------------------- profile + auto refresh ---------------------- */
  useEffect(() => {
    if (!session) return;
    let alive = true;

    void (async () => {
      try {
        const me = await spotifyFetch<SpotifyMe>("/me", session.accessToken);
        if (!alive) return;
        setProfile({
          id: me.id,
          displayName: me.display_name || "Spotify Listener",
          avatarUrl: me.images?.[0]?.url ?? null,
          product: me.product ?? null,
          mode: "spotify",
        });
        setStatus("connected");
      } catch (err) {
        if (!alive) return;
        setError(err instanceof Error ? err.message : "Could not reach Spotify.");
        setStatus("error");
      }
    })();

    const timer = window.setInterval(() => {
      const current = sessionRef.current;
      if (current && current.expiresAt - Date.now() < 60_000) {
        void refreshSession(current).then((next) => next && alive && setSession(next));
      }
    }, 45_000);

    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, [session]);

  const login = useCallback(async () => {
    setError(null);
    setStatus("connecting");
    try {
      await beginLogin();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed.");
      setStatus("error");
    }
  }, []);

  const logout = useCallback(() => {
    void dropSession();
    publishedToken.current = null;
    // Another listener must not inherit this account's history or liked songs.
    clearLocalLibrary();
    clearSession();
    setSession(null);
    setProfile(DEMO_PROFILE);
    setError(null);
    setStatus("demo");
  }, []);

  const enterDemoMode = useCallback(() => {
    setProfile(DEMO_PROFILE);
    setStatus("demo");
  }, []);

  return {
    status,
    mode: status === "connected" ? "spotify" : "demo",
    configured,
    framed,
    breakoutBlocked: error === BLOCKED_FRAME_MESSAGE,
    session,
    profile,
    error,
    login,
    logout,
    enterDemoMode,
    getAccessToken,
  };
}
