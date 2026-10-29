"use client";

import { usePathname, useRouter } from "next/navigation";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { ViewId } from "@/lib/navigation";

/**
 * Browse-section navigation.
 *
 * The four library sections live in one client-side surface (they share scroll
 * position and the playlist drill-down), while albums and artists are real
 * Next.js routes so they are linkable, back-button friendly and server
 * renderable. This context is what lets the shell chrome (which lives in the
 * route-group layout, so playback survives navigation) drive the sections.
 */

interface NavContextValue {
  view: ViewId;
  selectedPlaylist: string | null;
  navigate: (view: ViewId, playlistId?: string | null) => void;
  drawerOpen: boolean;
  setDrawerOpen: (open: boolean) => void;
  nowPlayingOpen: boolean;
  setNowPlayingOpen: (open: boolean) => void;
  /** Immersive expanded view of the Now Playing panel. */
  panelExpanded: boolean;
  setPanelExpanded: (expanded: boolean) => void;
  togglePanelExpanded: () => void;
}

const NavContext = createContext<NavContextValue | null>(null);

const PANEL_KEY = "echoes.panel.nowPlaying";
const EXPANDED_KEY = "echoes.panel.expanded";

/** The browse surface (Home / Playlists / Saved / Activity) lives at `/`. */
const BROWSE_PATH = "/";

export function NavProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [view, setView] = useState<ViewId>("home");
  const [selectedPlaylist, setSelectedPlaylist] = useState<string | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  /**
   * A constant on the first render so the server and client agree. The panel and
   * its two toggles render from this value, so reading `localStorage` here was a
   * hydration mismatch; the stored choice is applied in the effect below.
   */
  const [nowPlayingOpen, setNowPlayingOpen] = useState(true);
  const [panelExpanded, setPanelExpandedState] = useState(false);
  const panelHydrated = useRef(false);

  useEffect(() => {
    try {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time, idempotent post-mount hydration
      setNowPlayingOpen(window.localStorage.getItem(PANEL_KEY) !== "0");
      setPanelExpandedState(window.localStorage.getItem(EXPANDED_KEY) === "1");
    } catch {
      /* private mode — the defaults stand */
    }
    panelHydrated.current = true;
  }, []);

  const setPanelExpanded = useCallback((expanded: boolean) => {
    setPanelExpandedState(expanded);
    if (!panelHydrated.current) return;
    try {
      window.localStorage.setItem(EXPANDED_KEY, expanded ? "1" : "0");
    } catch {
      /* private mode */
    }
  }, []);

  /**
   * Section navigation that works from *any* route.
   *
   * The four browse sections are rendered by `(app)/page.tsx`, which is not
   * mounted while the listener is on `/album/[id]` or `/artist/[id]` — setting
   * state alone did nothing there, which is why the sidebar looked locked and
   * required the Back button. So: set the state, and route home when we are not
   * already there. The provider lives in the route-group layout, so the player
   * and the Web Playback SDK stay mounted and audio never stops.
   */
  const navigate = useCallback(
    (next: ViewId, playlistId: string | null = null) => {
      setView(next);
      setSelectedPlaylist(next === "playlists" ? playlistId : null);
      // Already on the browse route → pure state change, no navigation entry.
      if (pathname !== BROWSE_PATH) router.push(BROWSE_PATH);
    },
    [pathname, router],
  );

  const value = useMemo<NavContextValue>(
    () => ({
      view,
      selectedPlaylist,
      navigate,
      drawerOpen,
      setDrawerOpen,
      nowPlayingOpen,
      setNowPlayingOpen,
      panelExpanded,
      setPanelExpanded,
      togglePanelExpanded: () => setPanelExpanded(!panelExpanded),
    }),
    [view, selectedPlaylist, navigate, drawerOpen, nowPlayingOpen, panelExpanded, setPanelExpanded],
  );

  return <NavContext.Provider value={value}>{children}</NavContext.Provider>;
}

export function useNav(): NavContextValue {
  const ctx = useContext(NavContext);
  if (!ctx) throw new Error("useNav must be used inside <NavProvider>");
  return ctx;
}

export { PANEL_KEY };

/* -------------------------------------------------------------------------- */
/*  Session context                                                            */
/*                                                                             */
/*  The auth hook must be instantiated once, in the layout, so the Web          */
/*  Playback SDK is not torn down on navigation. Route pages read the token     */
/*  from here instead of creating their own session.                           */
/* -------------------------------------------------------------------------- */

import type { SpotifyAuth } from "@/hooks/useSpotifyAuth";

const SessionContext = createContext<SpotifyAuth | null>(null);

export function SessionProvider({
  auth,
  children,
}: {
  auth: SpotifyAuth;
  children: ReactNode;
}) {
  return <SessionContext.Provider value={auth}>{children}</SessionContext.Provider>;
}

export function useSession(): SpotifyAuth {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error("useSession must be used inside <SessionProvider>");
  return ctx;
}
