"use client";

import { useSyncExternalStore } from "react";

/**
 * SSR-safe `matchMedia` subscription.
 *
 * Used to mount the Now Playing panel in exactly one place: an inline column on
 * desktop, a sheet below `xl`. Rendering both (and merely hiding one with CSS)
 * mounts two copies of the content and doubles every artist fetch.
 */
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const mql = window.matchMedia(query);
      mql.addEventListener("change", onChange);
      return () => mql.removeEventListener("change", onChange);
    },
    () => window.matchMedia(query).matches,
    () => false,
  );
}

/** False during SSR and the first client render, true afterwards. */
export function useHydrated(): boolean {
  return useSyncExternalStore(
    () => () => undefined,
    () => true,
    () => false,
  );
}
