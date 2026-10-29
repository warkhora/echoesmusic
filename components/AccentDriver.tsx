"use client";

import { useEffect } from "react";
import { extractTriad, withAlpha } from "@/lib/color";
import { usePlayer } from "@/state/player";
import { usePreferences } from "@/state/preferences";
import { resolvePalette } from "@/lib/design";
import type { Triad } from "@/lib/types";

/**
 * Writes the live accent triad onto `:root` so glass edges, glows, the ambient
 * field and focus rings all re-light together — from the selected theme, or
 * from the artwork of whatever is currently playing.
 */
export function AccentDriver() {
  const { prefs } = usePreferences();
  const { current } = usePlayer();

  useEffect(() => {
    let alive = true;
    // Preset, custom palette, or artwork-sync — one resolver for all three.
    const base = resolvePalette(prefs.theme);

    const apply = (triad: Triad) => {
      if (!alive) return;
      const root = document.documentElement;
      root.style.setProperty("--accent-1", triad[0]);
      root.style.setProperty("--accent-2", triad[1]);
      root.style.setProperty("--accent-3", triad[2]);
      root.style.setProperty("--accent-glow", withAlpha(triad[1], 0.45));
    };

    if (prefs.theme === "artwork" && current) {
      void extractTriad(current.imageUrl, current.colors).then(apply);
    } else if (prefs.colorSync && current && prefs.theme !== "frost") {
      void extractTriad(current.imageUrl, current.colors).then((art) => {
        apply([art[0], art[1], base[2]]);
      });
    } else {
      apply(base);
    }

    return () => {
      alive = false;
    };
  }, [prefs.theme, prefs.colorSync, current]);

  return null;
}
