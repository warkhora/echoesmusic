"use client";

import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { AccentDriver } from "@/components/AccentDriver";
import { AmbientField } from "@/components/AmbientField";
import { OnboardingFlow } from "@/components/onboarding/OnboardingFlow";
import { EASE, MaskedHeading } from "@/components/motion";
import { NowPlayingPanel, NowPlayingSheet } from "@/components/NowPlayingPanel";
import { PersonalizationDrawer } from "@/components/PersonalizationDrawer";
import { PlayerBar } from "@/components/PlayerBar";
import { Sidebar } from "@/components/Sidebar";
import { DesktopBridge } from "@/components/DesktopBridge";
import { HistoryLogger } from "@/hooks/useHistoryLogger";
import { AppGateProvider, useAppGate } from "@/state/appGate";
import { LiquidGlassFilter } from "@/components/LiquidGlassFilter";
import { LoadingBar } from "@/components/Spinner";
import { TopBar } from "@/components/TopBar";
import { useSpotifyAuth } from "@/hooks/useSpotifyAuth";
import { useHydrated, useMediaQuery } from "@/hooks/useMediaQuery";
import { FirebaseProvider, useFirebase } from "@/hooks/useFirebaseAuth";
import { resetRateLimit } from "@/lib/spotify/rateLimit";
import { ColumnsProvider } from "@/state/columns";
import { LibraryProvider, useLibrary } from "@/state/library";
import { NavProvider, SessionProvider, useNav, useSession } from "@/state/nav";
import { PlayerProvider, usePlayer } from "@/state/player";
import { PreferencesProvider, usePreferences } from "@/state/preferences";

/**
 * Route-group layout.
 *
 * Everything that must survive navigation lives here — the auth session, the
 * Web Playback SDK player, the library cache and the shell chrome. Without it,
 * clicking through to an album or artist page would unmount the player and stop
 * the music mid-track.
 */
export default function AppLayout({ children }: { children: ReactNode }) {
  const auth = useSpotifyAuth();
  return (
    <FirebaseProvider>
      <AppGateProvider>
        <Providers auth={auth}>{children}</Providers>
      </AppGateProvider>
    </FirebaseProvider>
  );
}

/**
 * Network-touching providers live below the gate so nothing fires before a
 * session exists (Firebase user or explicit demo entry).
 */
function Providers({ auth, children }: { auth: ReturnType<typeof useSpotifyAuth>; children: ReactNode }) {
  const gate = useAppGate();
  const firebase = useFirebase();
  // Dual authentication: the app opens only with a Firebase user AND an active,
  // correctly-mapped Spotify connection — or an explicit local demo entry.
  // Simple rule: a Firebase user AND a connected Spotify account (or an
  // explicit local demo entry). No account cross-matching anywhere.
  const dual = Boolean(firebase.user) && auth.status === "connected";
  const entered = dual || gate.entered;
  return (
    <PreferencesProvider>
      <ColumnsProvider>
        <NavProvider>
          <SessionProvider auth={auth}>
            <LibraryProvider auth={auth} enabled={entered}>
              <PlayerProvider auth={auth}>
                <AccentDriver />
                <LiquidGlassFilter />
                <HistoryLogger />
                <DesktopBridge />
                <Shell>{children}</Shell>
              </PlayerProvider>
            </LibraryProvider>
          </SessionProvider>
        </NavProvider>
      </ColumnsProvider>
    </PreferencesProvider>
  );
}

const DESKTOP_QUERY = "(min-width: 1280px)";

function Shell({ children }: { children: ReactNode }) {
  const auth = useSpotifyAuthFromLayout();
  const { prefs } = usePreferences();
  const {
    refresh,
    loading,
    refreshing: libraryRefreshing,
    error: libraryError,
    degraded,
    syncSaved,
  } = useLibrary();
  const { nudge, toggle, next, previous, current, deviceName, syncNow } = usePlayer();
  const nav = useNav();
  const reduce = useReducedMotion();

  const mounted = useHydrated();
  const isDesktop = useMediaQuery(DESKTOP_QUERY);

  const gate = useAppGate();
  const firebase = useFirebase();
  // Which onboarding step to land on when the session ends (logout vs disconnect).
  const [onboardStep, setOnboardStep] = useState<"auth" | "platform" | null>(null);
  const dual = Boolean(firebase.user) && auth.status === "connected";
  const entered = dual || gate.entered;
  const [refreshing, setRefreshing] = useState(false);

  // Panel persistence lives in NavProvider, which reads the stored value before
  // allowing writes; a second writer here would clobber it with the
  // pre-hydration default on every load.

  const handleRefresh = useCallback(() => {
    setRefreshing(true);
    resetRateLimit(); // an explicit refresh is the listener opting back in
    refresh();
    syncNow();
    void syncSaved();
    window.setTimeout(() => setRefreshing(false), 900);
  }, [refresh, syncNow, syncSaved]);

  /* keyboard transport */
  useEffect(() => {
    if (!entered) return;
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)) return;
      if (event.key === " " && !target?.closest("button")) {
        event.preventDefault();
        toggle();
      } else if (event.key === "ArrowRight" && event.shiftKey) {
        event.preventDefault();
        next();
      } else if (event.key === "ArrowLeft" && event.shiftKey) {
        event.preventDefault();
        previous();
      } else if (event.key === "ArrowRight" && current) {
        nudge(5000);
      } else if (event.key === "ArrowLeft" && current) {
        nudge(-5000);
      } else if (event.key.toLowerCase() === "p") {
        nav.setDrawerOpen(!nav.drawerOpen);
      } else if (event.key.toLowerCase() === "n") {
        nav.setNowPlayingOpen(!nav.nowPlayingOpen);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [entered, toggle, next, previous, nudge, current, nav]);

  return (
    <div className="ui-scale-root relative overflow-hidden">
      <AmbientField
        enabled={prefs.ambientEnabled}
        grain={prefs.grainEnabled}
        motion={prefs.motionEnabled}
      />

      <AnimatePresence mode="wait">
        {!entered ? (
          auth.status === "booting" || auth.status === "connecting" ? (
            <BootScreen key="boot" />
          ) : (
            <motion.div
              key="login"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={reduce ? { opacity: 0 } : { opacity: 0, scale: 1.02, filter: "blur(6px)" }}
              transition={{ duration: 0.55, ease: EASE }}
              className="h-full w-full"
            >
              <OnboardingFlow
                forcedStep={onboardStep}
                onStepHandled={() => setOnboardStep(null)}
                auth={{
                  ...auth,
                  enterDemoMode: () => {
                    auth.enterDemoMode();
                    gate.enter();
                  },
                  logout: () => {
                    auth.logout();
                    gate.exit();
                  },
                }}
                onEnterDemo={() => {
                  auth.enterDemoMode();
                  gate.enter();
                  setOnboardStep(null);
                }}
              />
            </motion.div>
          )
        ) : (
          <motion.div
            key="app"
            initial={reduce ? { opacity: 1 } : { opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, ease: EASE }}
            className="relative z-10 flex h-full w-full gap-3 p-3 pb-[204px] lg:gap-4 lg:p-4 lg:pb-[128px]"
          >
            <Sidebar
              view={nav.view}
              onNavigate={nav.navigate}
              onOpenSettings={() => nav.setDrawerOpen(true)}
              selectedPlaylist={nav.selectedPlaylist}
            />

            {/*
              Collapsed to zero width rather than unmounted: the route stays
              alive underneath, so expanding and collapsing never refetches a
              page, never loses its scroll position and — most importantly —
              never touches the player or the audio element.
            */}
            <div
              className={`relative flex min-w-0 flex-col gap-3 transition-all duration-700 lg:gap-4 ${
                nav.panelExpanded
                  ? "pointer-events-none w-0 flex-none overflow-hidden opacity-0"
                  : "flex-1 opacity-100"
              }`}
              aria-hidden={nav.panelExpanded}
            >
              <LoadingBar active={libraryRefreshing || (loading && !libraryError)} />
              <TopBar
                view={nav.view}
                auth={{
                  ...auth,
                  logout: () => {
                    auth.logout();
                    gate.exit();
                  },
                }}
                deviceName={deviceName}
                onOpenSettings={() => nav.setDrawerOpen(true)}
                onRequestOnboardingStep={setOnboardStep}
                onRefresh={handleRefresh}
                refreshing={refreshing || libraryRefreshing || loading}
                nowPlayingOpen={nav.nowPlayingOpen}
                onToggleNowPlaying={() => nav.setNowPlayingOpen(!nav.nowPlayingOpen)}
              />

              {degraded.length > 0 && !libraryError && (
                <p className="flex shrink-0 flex-wrap items-center gap-2 px-1 font-mono text-[9.5px] uppercase tracking-[0.2em] text-white/28">
                  <span className="h-1 w-1 rounded-full bg-amber-300/70" />
                  partial library
                  <span className="text-white/18">·</span>
                  <span className="normal-case tracking-normal text-white/25">
                    {degraded.slice(0, 3).join(", ")}
                    {degraded.length > 3 ? ` +${degraded.length - 3}` : ""}
                  </span>
                </p>
              )}

              <AnimatePresence>
                {libraryError && (
                  <motion.div
                    initial={reduce ? false : { opacity: 0, y: -10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -10 }}
                    transition={{ duration: 0.4, ease: EASE }}
                    className="glass-thin flex shrink-0 items-center gap-3 rounded-[20px] border-amber-200/20 px-4 py-3"
                  >
                    <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-amber-300" />
                    <p className="min-w-0 flex-1 truncate text-[12px] text-amber-50/80">
                      {libraryError}
                    </p>
                    <button
                      type="button"
                      onClick={handleRefresh}
                      className="shrink-0 rounded-full border border-white/12 px-3 py-1 text-[11px] text-white/70 transition-colors duration-300 hover:text-white"
                    >
                      Retry
                    </button>
                  </motion.div>
                )}
              </AnimatePresence>

              <main className="thin-scrollbar relative min-h-0 flex-1 overflow-y-auto overflow-x-hidden rounded-[26px] px-1 py-1 lg:px-2">
                {children}

                <footer className="mt-14 flex flex-wrap items-center justify-between gap-4 border-t border-white/8 px-3 pt-6 font-mono text-[9.5px] uppercase tracking-[0.22em] text-white/22">
                  <span>Echoes v7.0.1 · liquid glass client</span>
                  <span className="hidden sm:inline">
                    space play/pause · arrows seek · shift+arrows skip · n panel · p settings
                  </span>
                </footer>
              </main>
            </div>

            {/* Desktop: a side column that grows into the content area when expanded. */}
            {nav.nowPlayingOpen && (
              <div
                className={`hidden h-full min-h-0 shrink-0 transition-all duration-700 xl:block ${
                  nav.panelExpanded ? "w-auto flex-1" : "w-[clamp(300px,20vw,460px)]"
                }`}
              >
                <AnimatePresence initial={false}>
                  {mounted && isDesktop && (
                    <NowPlayingPanel
                      key="now-playing-panel"
                      token={auth.session?.accessToken ?? null}
                      onClose={() => nav.setNowPlayingOpen(false)}
                    />
                  )}
                </AnimatePresence>
              </div>
            )}

            <div className="pointer-events-none fixed inset-x-3 bottom-3 lg:inset-x-4 lg:bottom-4">
              <PlayerBar
                nowPlayingOpen={nav.nowPlayingOpen}
                onToggleNowPlaying={() => nav.setNowPlayingOpen(!nav.nowPlayingOpen)}
              />
            </div>

            {/* Below xl: the same content as a sheet. Never both at once. */}
            {mounted && !isDesktop && (
              <NowPlayingSheet
                open={nav.nowPlayingOpen}
                token={auth.session?.accessToken ?? null}
                onClose={() => nav.setNowPlayingOpen(false)}
              />
            )}

            <PersonalizationDrawer
              open={nav.drawerOpen}
              onClose={() => nav.setDrawerOpen(false)}
            />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/** Reads the session the layout already created — never a second instance. */
function useSpotifyAuthFromLayout() {
  // Imported lazily to keep the provider order obvious at the call site.
  return useSession();
}

function BootScreen() {
  const reduce = useReducedMotion();
  return (
    <motion.div
      key="boot"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.4 }}
      className="relative z-10 grid h-full w-full place-items-center"
    >
      <div className="text-center">
        <motion.span
          animate={reduce ? undefined : { scale: [1, 1.08, 1], opacity: [0.6, 1, 0.6] }}
          transition={{ duration: 2.4, repeat: Infinity, ease: "easeInOut" }}
          className="mx-auto grid h-14 w-14 place-items-center rounded-2xl"
          style={{
            background:
              "conic-gradient(from 200deg, var(--accent-1), var(--accent-2), var(--accent-3), var(--accent-1))",
            boxShadow: "0 0 60px -10px var(--accent-glow)",
          }}
        />
        <MaskedHeading
          as="h1"
          className="mt-7 font-display text-[52px] leading-none tracking-tight text-white"
        >
          Echoes
        </MaskedHeading>
        <p className="mt-3 font-mono text-[9.5px] uppercase tracking-[0.32em] text-white/35">
          warming the glass
        </p>
      </div>
    </motion.div>
  );
}
