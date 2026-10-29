import { THEMES, type Triad } from "@/lib/types";

/**
 * Design registry: the font catalogue and the custom-palette store.
 *
 * Both persist in `localStorage` and both are reactive, so changing a font or a
 * palette repaints every glass surface without a reload.
 */

/* --------------------------------- fonts --------------------------------- */

export type FontKind = "clean" | "wide" | "futuristic" | "mono" | "display";

export interface FontOption {
  /** Exact CSS family name. */
  id: string;
  label: string;
  kind: FontKind;
  /** Full font-family stack for the CSS custom property. */
  stack: string;
  source: "google" | "fontshare";
}

const google = (label: string, kind: FontKind, generic = "sans-serif"): FontOption => ({
  id: label,
  label,
  kind,
  stack: `"${label}", ui-sans-serif, system-ui, ${generic}`,
  source: "google",
});

const fontshare = (label: string, kind: FontKind): FontOption => ({
  id: label,
  label,
  kind,
  stack: `"${label}", ui-sans-serif, system-ui, sans-serif`,
  source: "fontshare",
});

/**
 * 33 faces across the requested families — clean/minimalist, wide, futuristic,
 * mono and display. All verified to resolve from the two CDN URLs below.
 */
export const FONT_OPTIONS: FontOption[] = [
  // clean / minimalist
  google("Manrope", "clean"),
  google("Inter", "clean"),
  google("IBM Plex Sans", "clean"),
  google("DM Sans", "clean"),
  google("Plus Jakarta Sans", "clean"),
  google("Onest", "clean"),
  google("Outfit", "clean"),
  google("Epilogue", "clean"),
  google("Work Sans", "clean"),
  google("Barlow", "clean"),
  google("Rubik", "clean"),
  google("Archivo", "clean"),
  fontshare("General Sans", "clean"),
  fontshare("Satoshi", "clean"),
  // wide
  google("Montserrat", "wide"),
  google("Syncopate", "wide"),
  google("Unbounded", "wide"),
  fontshare("Clash Display", "wide"),
  fontshare("Cabinet Grotesk", "wide"),
  // futuristic
  google("Orbitron", "futuristic"),
  google("Space Grotesk", "futuristic"),
  google("Syne", "futuristic"),
  google("Chakra Petch", "futuristic"),
  google("Rajdhani", "futuristic"),
  google("Michroma", "futuristic"),
  google("Exo 2", "futuristic"),
  google("Bricolage Grotesque", "futuristic"),
  google("Sora", "futuristic"),
  // mono
  google("IBM Plex Mono", "mono", "monospace"),
  google("JetBrains Mono", "mono", "monospace"),
  google("Space Mono", "mono", "monospace"),
  google("Major Mono Display", "mono", "monospace"),
  // display
  google("Instrument Serif", "display", "serif"),
];

export const FONT_KIND_LABEL: Record<FontKind, string> = {
  clean: "Clean / minimal",
  wide: "Wide",
  futuristic: "Futuristic",
  mono: "Monospace",
  display: "Display",
};

export const DEFAULT_FONT_1 = "Manrope"; // song titles + body
export const DEFAULT_FONT_2 = "Instrument Serif"; // headings + hero

const GOOGLE_FAMILIES = FONT_OPTIONS.filter((f) => f.source === "google").map((f) =>
  f.kind === "display" || f.id === "Instrument Serif"
    ? `family=${encodeURIComponent(f.id).replace(/%20/g, "+")}`
    : `family=${encodeURIComponent(f.id).replace(/%20/g, "+")}:wght@400;700`,
);

/** One request for every Google face; font binaries stay lazy per unicode-range. */
export const GOOGLE_FONTS_URL = `https://fonts.googleapis.com/css2?${GOOGLE_FAMILIES.join("&")}&display=swap`;

export const FONTSHARE_URL =
  "https://api.fontshare.com/v2/css?f[]=cabinet-grotesk@400,500,700&f[]=general-sans@400,500&f[]=satoshi@400,700&f[]=clash-display@400,600&display=swap";

export function fontStack(id: string | null | undefined): string {
  const match = FONT_OPTIONS.find((font) => font.id === id);
  return match?.stack ?? `ui-sans-serif, system-ui, sans-serif`;
}

/* ------------------------------- palettes -------------------------------- */

export interface CustomPalette {
  id: string;
  name: string;
  colors: string[]; // 2 – 5
  createdAt: number;
}

export const CUSTOM_PALETTES_KEY = "echoes_custom_palettes";
export const MIN_PALETTE_COLORS = 2;
export const MAX_PALETTE_COLORS = 5;
/** A theme value is either a preset id or `custom:<paletteId>`. */
export const CUSTOM_THEME_PREFIX = "custom:";

function readPalettes(): CustomPalette[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(CUSTOM_PALETTES_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (entry): entry is CustomPalette =>
          Boolean(entry) &&
          typeof (entry as CustomPalette).id === "string" &&
          typeof (entry as CustomPalette).name === "string" &&
          Array.isArray((entry as CustomPalette).colors) &&
          (entry as CustomPalette).colors.length >= MIN_PALETTE_COLORS &&
          (entry as CustomPalette).colors.every((c) => typeof c === "string"),
      )
      .map((entry) => ({
        ...entry,
        colors: entry.colors.slice(0, MAX_PALETTE_COLORS),
      }));
  } catch {
    return [];
  }
}

function writePalettes(palettes: CustomPalette[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(CUSTOM_PALETTES_KEY, JSON.stringify(palettes));
  } catch {
    /* quota or private mode — the in-memory list still applies this session */
  }
  notifyPalettes();
}

/* reactivity */
let paletteVersion = 0;
const paletteListeners = new Set<() => void>();

export function subscribePalettes(listener: () => void): () => void {
  paletteListeners.add(listener);
  return () => {
    paletteListeners.delete(listener);
  };
}

export function paletteVersionGet(): number {
  return paletteVersion;
}

function notifyPalettes(): void {
  paletteVersion += 1;
  for (const listener of paletteListeners) listener();
}

let memoryCache: CustomPalette[] | null = null;

export function listPalettes(): CustomPalette[] {
  if (typeof window === "undefined") return [];
  if (memoryCache) return memoryCache;
  memoryCache = readPalettes();
  return memoryCache;
}

export function addPalette(name: string, colors: string[]): CustomPalette | null {
  const trimmed = name.trim().slice(0, 40);
  const clean = colors
    .map((c) => c.trim())
    .filter((c) => /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(c))
    .slice(0, MAX_PALETTE_COLORS);
  if (!trimmed || clean.length < MIN_PALETTE_COLORS) return null;

  const palette: CustomPalette = {
    id: `p_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
    name: trimmed,
    colors: clean,
    createdAt: Date.now(),
  };
  memoryCache = [...listPalettes(), palette];
  writePalettes(memoryCache);
  return palette;
}

/** Replaces the whole custom-palette list (cloud restore / migration). */
export function replacePalettes(palettes: CustomPalette[]): void {
  const clean = palettes
    .filter(
      (entry) =>
        Boolean(entry) &&
        typeof entry.id === "string" &&
        typeof entry.name === "string" &&
        Array.isArray(entry.colors) &&
        entry.colors.length >= MIN_PALETTE_COLORS,
    )
    .map((entry) => ({ ...entry, colors: entry.colors.slice(0, MAX_PALETTE_COLORS) }));
  memoryCache = clean;
  writePalettes(clean);
}

export function removePalette(id: string): void {
  memoryCache = listPalettes().filter((palette) => palette.id !== id);
  writePalettes(memoryCache);
}

export function paletteThemeId(id: string): string {
  return `${CUSTOM_THEME_PREFIX}${id}`;
}

export function isCustomTheme(theme: string): boolean {
  return theme.startsWith(CUSTOM_THEME_PREFIX);
}

/**
 * Resolves any theme value — preset, custom, or the artwork-sync mode — into a
 * concrete triad for the ambient field and the glass glows.
 */
export function resolvePalette(theme: string, customs?: CustomPalette[]): Triad {
  if (!isCustomTheme(theme)) {
    const preset = THEMES.find((entry) => entry.id === theme);
    return preset?.colors ?? THEMES[0].colors;
  }
  const id = theme.slice(CUSTOM_THEME_PREFIX.length);
  const palette = (customs ?? listPalettes()).find((entry) => entry.id === id);
  if (!palette) return THEMES[0].colors;
  return toTriad(palette.colors);
}

/** 2–5 colours collapsed onto the three accent slots the CSS expects. */
export function toTriad(colors: string[]): Triad {
  if (colors.length === 0) return THEMES[0].colors;
  if (colors.length === 1) return [colors[0], colors[0], colors[0]];
  if (colors.length === 2) return [colors[0], colors[1], colors[1]];
  if (colors.length === 3) return [colors[0], colors[1], colors[2]];
  // 4–5: first, middle, last — keeps the darkest and brightest anchors.
  const mid = Math.floor(colors.length / 2);
  return [colors[0], colors[mid], colors[colors.length - 1]];
}

/** Presets and customs in one list for the drawer. */
export interface PaletteChoice {
  theme: string;
  name: string;
  blurb: string;
  colors: string[];
  custom: boolean;
  id?: string;
}

export function paletteChoices(): PaletteChoice[] {
  const presets: PaletteChoice[] = THEMES.map((entry) => ({
    theme: entry.id,
    name: entry.name,
    blurb: entry.blurb,
    colors: entry.colors,
    custom: false,
  }));
  const customs: PaletteChoice[] = listPalettes().map((palette) => ({
    theme: paletteThemeId(palette.id),
    name: palette.name,
    blurb: `${palette.colors.length} custom colour${palette.colors.length === 1 ? "" : "s"}`,
    colors: palette.colors,
    custom: true,
    id: palette.id,
  }));
  return [...presets, ...customs];
}

/* --------------------------- experimental glass --------------------------- */

export const DISTORTION_MIN = 25;
export const DISTORTION_MAX = 200;
export const DISTORTION_DEFAULT = 100;

/**
 * Maps the 25–200 % slider onto the `feDisplacementMap` scale. 100 % ≈ the
 * reference refraction strength; the ends stay subtle enough to keep text
 * legible because the filter only touches the backdrop, never the content.
 */
export function distortionScale(percent: number): number {
  const clamped = Math.min(DISTORTION_MAX, Math.max(DISTORTION_MIN, percent || DISTORTION_DEFAULT));
  return Math.round(18 * (clamped / 100));
}

export const BLUR_MIN = 2;
export const BLUR_MAX = 50;
