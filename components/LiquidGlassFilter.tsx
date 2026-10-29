"use client";

import { distortionScale } from "@/lib/design";
import { usePreferences } from "@/state/preferences";

/**
 * Experimental Liquid Glass: the refractive filter plus the rules that attach it.
 *
 * Both are injected at runtime. The `backdrop-filter: url(#…)` declarations
 * cannot live in `globals.css` because the build-time minifier strips them as
 * unsupported syntax, which would ship the whole mode inert.
 *
 * The filter is deliberately **static** — no animated turbulence — so it costs
 * nothing per frame. Only the displacement `scale` changes, driven straight from
 * the 25–200 % slider, and `key={scale}` forces React to replace the node so
 * every engine re-rasterises the backdrop immediately rather than caching the
 * previous result.
 */
export function LiquidGlassFilter() {
  const { prefs } = usePreferences();
  if (!prefs.experimentalGlass) return null;

  const scale = distortionScale(prefs.distortion);

  const css = `
:root[data-liquid="on"] .glass,
:root[data-liquid="on"] .glass-thin,
:root[data-liquid="on"] .glass-card,
:root[data-liquid="on"] .glass-chip {
  border-color: rgba(255, 255, 255, 0.18);
  box-shadow:
    inset 0 1px 0 0 rgba(255, 255, 255, 0.26),
    inset 0 -1px 0 0 rgba(255, 255, 255, 0.07),
    inset 2px 0 0 0 rgba(255, 255, 255, 0.07),
    inset -2px 0 0 0 rgba(255, 255, 255, 0.05),
    0 26px 64px -28px rgba(0, 0, 0, 0.9),
    0 0 48px -16px var(--accent-glow);
}

/*
 * Experimental ON = dynamic blur AND refraction, simultaneously. The blur term
 * is the exact slider value on panels, sidebars and dropdowns, identical to the
 * OFF case, so the slider behaves the same in both modes.
 */
:root[data-liquid="on"] .glass,
:root[data-liquid="on"] .glass-thin,
:root[data-liquid="on"] .glass-card {
  backdrop-filter: url(#echoes-liquid-glass) blur(var(--user-blur-val)) saturate(185%) brightness(1.06);
  -webkit-backdrop-filter: blur(var(--user-blur-val)) saturate(185%) brightness(1.06);
}
/* Chips stay a fraction of the value: a full-strength blur smears a 9px badge. */
:root[data-liquid="on"] .glass-chip {
  backdrop-filter: url(#echoes-liquid-glass) blur(calc(var(--user-blur-val) * 0.6)) saturate(185%) brightness(1.06);
  -webkit-backdrop-filter: blur(calc(var(--user-blur-val) * 0.6)) saturate(185%) brightness(1.06);
}

/* Engines without url() in backdrop-filter still get a visibly heavier glass. */
@supports not (backdrop-filter: url("#echoes-liquid-glass")) {
  :root[data-liquid="on"] .glass,
  :root[data-liquid="on"] .glass-thin,
  :root[data-liquid="on"] .glass-card,
  :root[data-liquid="on"] .glass-chip {
    backdrop-filter: blur(calc(var(--user-blur-val) * 1.3)) saturate(190%) brightness(1.07);
  }
}
`;

  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: css }} />
      <svg aria-hidden className="pointer-events-none absolute h-0 w-0" focusable="false">
        <defs>
          <filter
            key={scale}
            id="echoes-liquid-glass"
            x="-12%"
            y="-12%"
            width="124%"
            height="124%"
            colorInterpolationFilters="sRGB"
          >
            <feTurbulence
              type="fractalNoise"
              baseFrequency="0.008 0.012"
              numOctaves={2}
              seed={11}
              result="ripple"
            />
            <feDisplacementMap
              in="SourceGraphic"
              in2="ripple"
              scale={scale}
              xChannelSelector="R"
              yChannelSelector="G"
            />
          </filter>
        </defs>
      </svg>
    </>
  );
}
