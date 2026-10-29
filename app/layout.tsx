import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { FONTSHARE_URL, GOOGLE_FONTS_URL } from "@/lib/design";
import "./globals.css";

export const metadata: Metadata = {
  title: "Echoes — a liquid glass client for Spotify",
  description:
    "Echoes is a minimalist, ambient web client for Spotify built on translucent glass surfaces, a morphing colour field and a calm, distraction-free listening surface.",
  applicationName: "Echoes",
  keywords: ["spotify", "glassmorphism", "music client", "ambient", "minimal"],
};

export const viewport: Viewport = {
  themeColor: "#0b0c10",
  colorScheme: "dark",
  width: "device-width",
  initialScale: 1,
};

const MONO_FONTS = ["IBM Plex Mono", "JetBrains Mono", "Space Mono", "Major Mono Display"];
const SERIF_FONTS = ["Instrument Serif"];

/** Builds the same font stack `lib/design.ts` produces, without importing it. */
const stackFor = (family: string) => {
  if (MONO_FONTS.includes(family)) return `"${family}", ui-monospace, SFMono-Regular, monospace`;
  if (SERIF_FONTS.includes(family)) return `"${family}", ui-serif, Georgia, serif`;
  return `"${family}", ui-sans-serif, system-ui, sans-serif`;
};

/**
 * Reads `echoes.prefs.v1` and applies blur, tint and both font stacks before
 * first paint.
 *
 * It injects a **stylesheet** rather than mutating `<html>`: React owns that
 * element, and adding an inline `style` or `data-*` attribute before hydration
 * is exactly what produces hydration error #418. A script-inserted `<style>` is
 * outside React's tree, so the values apply immediately with no mismatch. The
 * `data-liquid` / `data-motion` flags are left to the preferences provider,
 * which sets them after mount.
 */
const BOOT_STYLE_SCRIPT = `(function(){
  try {
    var raw = localStorage.getItem('echoes.prefs.v1');
    if (!raw) return;
    var prefs = JSON.parse(raw);
    if (!prefs) return;

    var blur = Math.round(Number(prefs.blurIntensity));
    if (!isFinite(blur)) blur = 5;
    blur = Math.min(50, Math.max(2, blur));
    var tint = Math.max(0, Math.min(4, ((blur - 2) / 48) * 4)).toFixed(2) + '%';

    var MONO = ${JSON.stringify(MONO_FONTS)};
    var SERIF = ${JSON.stringify(SERIF_FONTS)};
    function stack(f) {
      if (!f) return null;
      if (MONO.indexOf(f) >= 0) return '"' + f + '", ui-monospace, SFMono-Regular, monospace';
      if (SERIF.indexOf(f) >= 0) return '"' + f + '", ui-serif, Georgia, serif';
      return '"' + f + '", ui-sans-serif, system-ui, sans-serif';
    }

    var scale = Math.round(Number(prefs.uiScale));
    if (!isFinite(scale)) scale = 100;
    scale = Math.min(150, Math.max(50, scale));
    var rules = ['--echoes-ui-scale:' + (scale / 100), '--blur-intensity:' + blur + 'px', '--user-blur-val:' + blur + 'px', '--glass-blur:' + blur + 'px', '--glass-tint:' + tint];
    var f1 = stack(prefs.font1); if (f1) rules.push('--font-sans:' + f1);
    var f2 = stack(prefs.font2); if (f2) rules.push('--font-display:' + f2);

    var style = document.createElement('style');
    style.setAttribute('data-echoes-boot', '');
    style.textContent = ':root{' + rules.join(';') + '}';
    (document.head || document.documentElement).appendChild(style);
  } catch (e) { /* unreadable store — the compiled CSS defaults apply */ }
})();`;

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className="dark">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        {/*
          Applied before first paint. React writes the same properties from the
          preferences provider, but that happens in an effect — after hydration —
          so without this the stored blur/fonts would flash the defaults on every
          load. Kept dependency-free and fully wrapped in try/catch.
        */}
        <script dangerouslySetInnerHTML={{ __html: BOOT_STYLE_SCRIPT }} />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        {/*
          The full font catalogue for the dual font selector. One request per
          CDN; the CSS is small and the actual font binaries stay lazy — a
          browser only downloads the faces it renders (unicode-range), so the
          cost is paid when the picker previews a face, not on every load.
        */}
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link rel="preconnect" href="https://api.fontshare.com" crossOrigin="anonymous" />
        <link href={GOOGLE_FONTS_URL} rel="stylesheet" />
        <link href={FONTSHARE_URL} rel="stylesheet" />
        <link
          rel="icon"
          href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Cdefs%3E%3ClinearGradient id='g' x1='0' y1='0' x2='1' y2='1'%3E%3Cstop offset='0%25' stop-color='%234c3bd4'/%3E%3Cstop offset='55%25' stop-color='%238b5cf6'/%3E%3Cstop offset='100%25' stop-color='%23d946a8'/%3E%3C/linearGradient%3E%3C/defs%3E%3Crect width='32' height='32' rx='8' fill='%230b0c10'/%3E%3Cg fill='none' stroke='url(%23g)' stroke-width='2.2' stroke-linecap='round'%3E%3Cpath d='M7 12.5c5.6-2.4 12.4-2.4 18 0'/%3E%3Cpath d='M9.5 17c4.2-1.8 8.8-1.8 13 0'/%3E%3Cpath d='M12 21.4c2.7-1.1 5.3-1.1 8 0'/%3E%3C/g%3E%3C/svg%3E"
        />
      </head>
      <body className="bg-[#0b0c10] font-sans text-[#e8eaf2] antialiased">
        {children}
        <noscript>
          <div style={{ padding: 40, fontFamily: "sans-serif", color: "#e8eaf2" }}>
            Echoes needs JavaScript to render its glass surfaces and connect to Spotify.
          </div>
        </noscript>
      </body>
    </html>
  );
}
