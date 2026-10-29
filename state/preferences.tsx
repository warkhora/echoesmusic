"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { useFirebase } from "@/hooks/useFirebaseAuth";
import { useCloudSync } from "@/hooks/useCloudSync";
import { paletteVersionGet, subscribePalettes } from "@/lib/design";
import { safeJsonIfOk } from "@/lib/http";
import {
  BLUR_MAX,
  BLUR_MIN,
  DISTORTION_DEFAULT,
  DISTORTION_MAX,
  DISTORTION_MIN,
  distortionScale,
  fontStack,
} from "@/lib/design";
import { DEFAULT_PREFERENCES, type Preferences, type ThemeValue } from "@/lib/types";

interface PreferencesContextValue {
  prefs: Preferences;
  ready: boolean;
  setBlur: (px: number) => void;
  setTheme: (theme: ThemeValue) => void;
  toggle: (key: "ambientEnabled" | "grainEnabled" | "motionEnabled" | "colorSync") => void;
  setVolume: (v: number) => void;
  setFont: (slot: "font1" | "font2", family: string) => void;
  /** Applies a Firestore snapshot without re-pushing it. */
  applyCloudPrefs: (prefs: Partial<Preferences>) => void;
  setExperimentalGlass: (on: boolean) => void;
  setDistortion: (percent: number) => void;
  setAnimation: (key: "coverAnimations" | "pageTransitions" | "uiAnimations", on: boolean) => void;
  setUiScale: (percent: number) => void;
  setAutoplay: (on: boolean) => void;
  reset: () => void;
  /** True once the stored/server values have been reconciled. */
  persistedLocally: boolean;
}

const PreferencesContext = createContext<PreferencesContextValue | null>(null);
const LS_KEY = "echoes.prefs.v1";

/** Every personalization value, plus when it was last changed on this device. */
type StoredPreferences = Preferences & { savedAt?: number };

function readStored(): { prefs: Preferences; savedAt: number } {
  if (typeof window === "undefined") return { prefs: DEFAULT_PREFERENCES, savedAt: 0 };
  try {
    const raw = window.localStorage.getItem(LS_KEY);
    if (!raw) return { prefs: DEFAULT_PREFERENCES, savedAt: 0 };
    const parsed = JSON.parse(raw) as StoredPreferences;
    const { savedAt, ...prefs } = parsed;
    return { prefs: { ...DEFAULT_PREFERENCES, ...prefs }, savedAt: savedAt ?? 0 };
  } catch {
    return { prefs: DEFAULT_PREFERENCES, savedAt: 0 };
  }
}

export function PreferencesProvider({ children }: { children: ReactNode }) {
  /**
   * The first render must be identical on the server and the client, so this
   * starts from the compiled defaults and reads `localStorage` only after mount
   * — reading it during the initial render is what produced hydration error
   * #418 (the drawer's slider value, theme and toggles all render from it).
   *
   * There is no visual flash: the inline boot script in `layout.tsx` applies
   * blur, tint and both font stacks from the stored values *before* first paint,
   * straight onto CSS custom properties that React never renders.
   */
  const [prefs, setPrefs] = useState<Preferences>(DEFAULT_PREFERENCES);
  const [ready, setReady] = useState(false);
  const saveTimer = useRef<number | null>(null);
  const savedAtRef = useRef<number>(0);

  // Hydrate from the database so personalization survives across devices.
  useEffect(() => {
    let alive = true;

    // 1 — localStorage, applied after mount so SSR and hydration agree.
    const stored = readStored();
    if (stored.savedAt > 0) {
      savedAtRef.current = stored.savedAt;
      setPrefs((prev) => ({ ...prev, ...stored.prefs }));
    }

    // 2 — the database copy, only when it is newer than this device's.
    void (async () => {
      try {
        const res = await fetch("/api/preferences");
        const data = await safeJsonIfOk<{ preferences?: Preferences; savedAt?: number }>(res);
        if (alive && data?.preferences) {
          const serverSavedAt = data.savedAt ?? 0;
          // Whichever device changed it most recently wins, so an offline tweak
          // is never overwritten by an older server copy.
          if (serverSavedAt > savedAtRef.current) {
            savedAtRef.current = serverSavedAt;
            setPrefs((prev) => ({ ...prev, ...data.preferences }));
          }
        }
      } catch {
        /* offline — local preferences still work */
      } finally {
        if (alive) setReady(true);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  // Persist: instantly to localStorage, debounced to Postgres.
  /** Bumped only by user-driven commits, so cloud restores never re-push. */
  const [dirtyTick, setDirtyTick] = useState(0);

  const commit = useCallback((next: Preferences) => {
    const savedAt = Date.now();
    savedAtRef.current = savedAt;
    setPrefs(next);
    setDirtyTick((tick) => tick + 1);
    try {
      // Written synchronously: a reload mid-drag still keeps the last value.
      const stored: StoredPreferences = { ...next, savedAt };
      window.localStorage.setItem(LS_KEY, JSON.stringify(stored));
    } catch {
      /* private mode — the in-memory value still applies for this session */
    }
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => {
      // Best-effort: localStorage already holds the value, so a backend
      // failure must never surface to the listener.
      void fetch("/api/preferences", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...next, savedAt }),
      })
        .then((res) => {
          if (!res.ok) console.info(`[echoes] preferences not persisted (${res.status})`);
        })
        .catch(() => undefined);
    }, 550);
  }, []);

  useEffect(() => () => {
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
  }, []);

  /**
   * One effect drives every visual setting through CSS custom properties, so a
   * change repaints all glass at once instead of re-rendering React trees.
   */
  useEffect(() => {
    const root = document.documentElement;
    // The slider writes one variable; every glass surface reads it.
    root.style.setProperty("--echoes-ui-scale", String(prefs.uiScale / 100));
    root.style.setProperty("--blur-intensity", `${prefs.blurIntensity}px`);
    root.style.setProperty("--user-blur-val", `${prefs.blurIntensity}px`);
    root.style.setProperty("--glass-blur", `${prefs.blurIntensity}px`);
    root.style.setProperty("--font-sans", fontStack(prefs.font1));
    root.style.setProperty("--font-display", fontStack(prefs.font2));
    root.style.setProperty("--distortion-scale", String(distortionScale(prefs.distortion)));
    // 0% extra wash at 2px (near-clear, so refraction shows) up to ~4% at 50px.
    const tint = Math.max(0, Math.min(4, ((prefs.blurIntensity - BLUR_MIN) / (BLUR_MAX - BLUR_MIN)) * 4));
    root.style.setProperty("--glass-tint", `${tint.toFixed(2)}%`);
    root.dataset.motion = prefs.motionEnabled ? "fluid" : "calm";
    // Liquid Glass is always on (v7.1): the distortion slider tunes it, but
    // there is no off switch any more.
    root.dataset.liquid = "on";
    root.dataset.covers = prefs.coverAnimations ? "on" : "off";
    root.dataset.pages = prefs.pageTransitions ? "on" : "off";
    root.dataset.ui = prefs.uiAnimations ? "on" : "off";
  }, [
    prefs.blurIntensity,
    prefs.motionEnabled,
    prefs.font1,
    prefs.font2,
    prefs.distortion,
    prefs.experimentalGlass,
    prefs.coverAnimations,
    prefs.pageTransitions,
    prefs.uiAnimations,
    prefs.uiScale,
  ]);

  /** Firestore restore path: updates state + localStorage, schedules no push. */
  const applyCloudPrefs = useCallback((remote: Partial<Preferences>) => {
    setPrefs((prev) => ({ ...prev, ...remote }));
    try {
      const stored = readStored();
      window.localStorage.setItem(
        LS_KEY,
        JSON.stringify({ ...stored.prefs, ...remote, savedAt: Date.now() }),
      );
      savedAtRef.current = Date.now();
    } catch {
      /* private mode */
    }
  }, []);

  // Cloud push stays in step with palette and listening-history changes too.
  const palettesVersion = useSyncExternalStore(subscribePalettes, paletteVersionGet, () => 0);
  const firebase = useFirebase();
  useCloudSync({
    user: firebase.user,
    prefs,
    dirtyTick,
    palettesVersion,
    applyCloudPrefs,
  });

  const value = useMemo<PreferencesContextValue>(
    () => ({
      prefs,
      ready,
      setBlur: (px) =>
        commit({
          ...prefs,
          blurIntensity: Math.min(BLUR_MAX, Math.max(BLUR_MIN, Math.round(px))),
        }),
      applyCloudPrefs,
      persistedLocally: savedAtRef.current > 0,
      setTheme: (theme) => commit({ ...prefs, theme }),
      setVolume: (v) => commit({ ...prefs, volume: Math.min(100, Math.max(0, Math.round(v))) }),
      setFont: (slot, family) => commit({ ...prefs, [slot]: family }),
      setExperimentalGlass: (on) => commit({ ...prefs, experimentalGlass: on }),
      setAnimation: (key, on) => commit({ ...prefs, [key]: on }),
      setAutoplay: (on) => commit({ ...prefs, autoplay: on }),
      setUiScale: (percent) =>
        commit({ ...prefs, uiScale: Math.min(150, Math.max(50, Math.round(percent / 5) * 5)) }),
      setDistortion: (percent) =>
        commit({
          ...prefs,
          distortion: Math.min(
            DISTORTION_MAX,
            Math.max(DISTORTION_MIN, Math.round(percent || DISTORTION_DEFAULT)),
          ),
        }),
      toggle: (key) => commit({ ...prefs, [key]: !prefs[key] }),
      reset: () => commit(DEFAULT_PREFERENCES),
    }),
    [prefs, ready, commit, applyCloudPrefs],
  );

  return <PreferencesContext.Provider value={value}>{children}</PreferencesContext.Provider>;
}

export function usePreferences(): PreferencesContextValue {
  const ctx = useContext(PreferencesContext);
  if (!ctx) throw new Error("usePreferences must be used inside <PreferencesProvider>");
  return ctx;
}
