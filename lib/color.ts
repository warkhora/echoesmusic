import type { Triad } from "@/lib/types";

const cache = new Map<string, Triad>();

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  let h = 0;
  let s = 0;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r:
        h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
        break;
      case g:
        h = ((b - r) / d + 2) / 6;
        break;
      default:
        h = ((r - g) / d + 4) / 6;
    }
  }
  return [h * 360, s, l];
}

function hslToHex(h: number, s: number, l: number): string {
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    const c = l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    return Math.round(255 * c)
      .toString(16)
      .padStart(2, "0");
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}

/**
 * Pulls a three-colour palette out of cover art for the "Album Art Sync" theme.
 * Never throws — resolves to the provided fallback on CORS / decode failure.
 */
export async function extractTriad(url: string | null | undefined, fallback: Triad): Promise<Triad> {
  if (!url) return fallback;
  const hit = cache.get(url);
  if (hit) return hit;
  if (typeof document === "undefined") return fallback;

  try {
    const img = new Image();
    img.crossOrigin = "anonymous";
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error("image load failed"));
      img.src = url;
    });

    const size = 28;
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return fallback;
    ctx.drawImage(img, 0, 0, size, size);
    const { data } = ctx.getImageData(0, 0, size, size);

    const buckets = new Map<string, { h: number; s: number; l: number; n: number }>();
    for (let i = 0; i < data.length; i += 4) {
      const a = data[i + 3];
      if (a < 200) continue;
      const [h, s, l] = rgbToHsl(data[i], data[i + 1], data[i + 2]);
      if (s < 0.08 || l < 0.06 || l > 0.94) continue;
      const key = `${Math.round(h / 18)}`;
      const prev = buckets.get(key) ?? { h: 0, s: 0, l: 0, n: 0 };
      prev.h = (prev.h * prev.n + h) / (prev.n + 1);
      prev.s = (prev.s * prev.n + s) / (prev.n + 1);
      prev.l = (prev.l * prev.n + l) / (prev.n + 1);
      prev.n += 1;
      buckets.set(key, prev);
    }

    const ranked = [...buckets.values()].sort((a, b) => b.n * (0.35 + b.s) - a.n * (0.35 + a.s));
    if (ranked.length === 0) return fallback;

    const triad: Triad = [
      hslToHex(ranked[0].h, Math.min(0.72, ranked[0].s + 0.1), Math.max(0.18, ranked[0].l * 0.55)),
      hslToHex(ranked[0].h, Math.min(0.85, ranked[0].s + 0.15), Math.min(0.62, ranked[0].l + 0.12)),
      hslToHex(
        (ranked[1]?.h ?? ranked[0].h + 40) % 360,
        Math.min(0.9, (ranked[1]?.s ?? ranked[0].s) + 0.2),
        Math.min(0.78, (ranked[1]?.l ?? ranked[0].l) + 0.28),
      ),
    ];
    cache.set(url, triad);
    return triad;
  } catch {
    return fallback;
  }
}

export function withAlpha(hex: string, alpha: number): string {
  const clean = hex.replace("#", "");
  if (clean.length !== 6) return hex;
  const r = parseInt(clean.slice(0, 2), 16);
  const g = parseInt(clean.slice(2, 4), 16);
  const b = parseInt(clean.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
