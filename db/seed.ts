import { sql } from "drizzle-orm";
import { db } from "@/db";
import { artists, listeningEvents, playlists, preferences, trackFeatures, tracks } from "@/db/schema";
import { ensureSchema } from "@/lib/server/schema-bootstrap";
import { DEFAULT_PREFERENCES, type Triad } from "@/lib/types";

type SeedTrack = {
  id: string;
  title: string;
  artist: string;
  album: string;
  durationMs: number;
  genre: string;
  year: number;
  colors: Triad;
  artSeed: number;
  playCount: number;
  saved: boolean;
};

const m = (min: number, sec: number) => (min * 60 + sec) * 1000;

const SEED_TRACKS: SeedTrack[] = [
  { id: "t01", title: "Slow Tide", artist: "Ondine", album: "Salt & Static", durationMs: m(4, 12), genre: "Downtempo", year: 2024, colors: ["#0e7490", "#155e75", "#67e8f9"], artSeed: 11, playCount: 42, saved: true },
  { id: "t02", title: "Glass Corridor", artist: "Ivo Marlow", album: "Interior Weather", durationMs: m(3, 48), genre: "Ambient House", year: 2023, colors: ["#4338ca", "#7c3aed", "#c4b5fd"], artSeed: 27, playCount: 38, saved: true },
  { id: "t03", title: "Velvet Machinery", artist: "Sable Court", album: "Nightshift Hymns", durationMs: m(5, 2), genre: "Trip Hop", year: 2022, colors: ["#7f1d1d", "#9d174d", "#f0abfc"], artSeed: 43, playCount: 21, saved: false },
  { id: "t04", title: "Pale Aurora", artist: "Lune Ascendant", album: "Northern Interior", durationMs: m(6, 14), genre: "Ambient", year: 2025, colors: ["#065f46", "#0d9488", "#a7f3d0"], artSeed: 59, playCount: 55, saved: true },
  { id: "t05", title: "Half-Light", artist: "Hana Vail", album: "Paper Sun", durationMs: m(3, 31), genre: "Neo Classical", year: 2024, colors: ["#b45309", "#d97706", "#fde68a"], artSeed: 71, playCount: 33, saved: false },
  { id: "t06", title: "Amber Static", artist: "Atlas Pale", album: "Long Exposure", durationMs: m(4, 44), genre: "Electronica", year: 2023, colors: ["#9a3412", "#c2410c", "#fdba74"], artSeed: 88, playCount: 17, saved: false },
  { id: "t07", title: "Cathedral of Rain", artist: "Mira Solace", album: "Vespers", durationMs: m(5, 27), genre: "Ambient", year: 2021, colors: ["#1e3a8a", "#3730a3", "#93c5fd"], artSeed: 104, playCount: 61, saved: true },
  { id: "t08", title: "Neon Koi", artist: "Kite & Ember", album: "Pond Logic", durationMs: m(3, 59), genre: "Downtempo", year: 2025, colors: ["#be123c", "#e11d48", "#fda4af"], artSeed: 119, playCount: 28, saved: true },
  { id: "t09", title: "Undertow", artist: "Ondine", album: "Salt & Static", durationMs: m(4, 36), genre: "Downtempo", year: 2024, colors: ["#0c4a6e", "#0369a1", "#7dd3fc"], artSeed: 133, playCount: 12, saved: false },
  { id: "t10", title: "Lunar Dust", artist: "Lune Ascendant", album: "Northern Interior", durationMs: m(5, 51), genre: "Ambient", year: 2025, colors: ["#312e81", "#5b21b6", "#ddd6fe"], artSeed: 149, playCount: 47, saved: true },
  { id: "t11", title: "Soft Focus", artist: "Hana Vail", album: "Paper Sun", durationMs: m(3, 12), genre: "Neo Classical", year: 2024, colors: ["#78716c", "#a8a29e", "#f5f5f4"], artSeed: 161, playCount: 9, saved: false },
  { id: "t12", title: "Iron Garden", artist: "Sable Court", album: "Nightshift Hymns", durationMs: m(4, 58), genre: "Trip Hop", year: 2022, colors: ["#14532d", "#3f6212", "#bef264"], artSeed: 178, playCount: 24, saved: false },
  { id: "t13", title: "Slow Motion Sunrise", artist: "Atlas Pale", album: "Long Exposure", durationMs: m(6, 33), genre: "Electronica", year: 2023, colors: ["#9f1239", "#c026d3", "#fbcfe8"], artSeed: 194, playCount: 36, saved: true },
  { id: "t14", title: "Blue Hour Choir", artist: "Mira Solace", album: "Vespers", durationMs: m(4, 21), genre: "Ambient", year: 2021, colors: ["#1e40af", "#0891b2", "#a5f3fc"], artSeed: 208, playCount: 31, saved: true },
  { id: "t15", title: "Paper Lanterns", artist: "Ivo Marlow", album: "Interior Weather", durationMs: m(3, 44), genre: "Ambient House", year: 2023, colors: ["#a16207", "#ca8a04", "#fef08a"], artSeed: 223, playCount: 15, saved: false },
  { id: "t16", title: "Kite Season", artist: "Kite & Ember", album: "Pond Logic", durationMs: m(4, 7), genre: "Downtempo", year: 2025, colors: ["#0f766e", "#4d7c0f", "#d9f99d"], artSeed: 239, playCount: 19, saved: false },
];

const SEED_PLAYLISTS = [
  {
    id: "p01",
    name: "Liquid Glass",
    description: "Weightless electronica for rooms with too much light.",
    owner: "Echoes Editorial",
    colors: ["#4c3bd4", "#8b5cf6", "#d946a8"] as Triad,
    trackIds: ["t02", "t04", "t10", "t07", "t13", "t08"],
    featured: true,
  },
  {
    id: "p02",
    name: "Nightshift",
    description: "Slow machinery, warm tape hiss, 2am architecture.",
    owner: "Echoes Editorial",
    colors: ["#7f1d1d", "#9d174d", "#4c1d95"] as Triad,
    trackIds: ["t03", "t12", "t06", "t09", "t16"],
    featured: false,
  },
  {
    id: "p03",
    name: "Morning Vapor",
    description: "Pale light through a closed window.",
    owner: "You",
    colors: ["#b45309", "#f59e0b", "#fef3c7"] as Triad,
    trackIds: ["t05", "t11", "t15", "t01"],
    featured: false,
  },
  {
    id: "p04",
    name: "Cathedral",
    description: "Long-form ambience with impossible reverb.",
    owner: "You",
    colors: ["#1e3a8a", "#0e7490", "#67e8f9"] as Triad,
    trackIds: ["t07", "t14", "t04", "t10", "t13"],
    featured: true,
  },
  {
    id: "p05",
    name: "Deep Focus: Mono",
    description: "No vocals. No surprises. Just a straight line.",
    owner: "Echoes Editorial",
    colors: ["#334155", "#64748b", "#cbd5e1"] as Triad,
    trackIds: ["t11", "t09", "t06", "t02", "t16", "t15"],
    featured: false,
  },
  {
    id: "p06",
    name: "Tidal",
    description: "Water in all its tempos — from seep to surge.",
    owner: "You",
    colors: ["#0c4a6e", "#0d9488", "#5eead4"] as Triad,
    trackIds: ["t01", "t09", "t08", "t14", "t04"],
    featured: false,
  },
];

const SEED_ARTISTS = [
  { id: "a01", name: "Ondine", bio: "Coastal downtempo recorded entirely on a ferry route between two islands.", listeners: 1_284_902, colors: ["#0e7490", "#155e75", "#67e8f9"] as Triad },
  { id: "a02", name: "Ivo Marlow", bio: "Builds ambient house out of field recordings from empty hotel corridors.", listeners: 862_410, colors: ["#4338ca", "#7c3aed", "#c4b5fd"] as Triad },
  { id: "a03", name: "Sable Court", bio: "A trio who refuse to play live before midnight.", listeners: 511_038, colors: ["#7f1d1d", "#9d174d", "#f0abfc"] as Triad },
  { id: "a04", name: "Lune Ascendant", bio: "Six-minute pieces for rooms without clocks.", listeners: 2_110_776, colors: ["#065f46", "#0d9488", "#a7f3d0"] as Triad },
  { id: "a05", name: "Hana Vail", bio: "Prepared piano, tape loops, and one very old harmonium.", listeners: 402_118, colors: ["#b45309", "#d97706", "#fde68a"] as Triad },
  { id: "a06", name: "Atlas Pale", bio: "Long exposure electronica — every track is a single unbroken take.", listeners: 990_551, colors: ["#9a3412", "#c2410c", "#fdba74"] as Triad },
  { id: "a07", name: "Mira Solace", bio: "Choral ambience written inside decommissioned churches.", listeners: 1_650_204, colors: ["#1e3a8a", "#3730a3", "#93c5fd"] as Triad },
  { id: "a08", name: "Kite & Ember", bio: "Two siblings, one modular synth, a pond in Kent.", listeners: 336_870, colors: ["#be123c", "#e11d48", "#fda4af"] as Triad },
];

/** Plausible audio features for the fictional catalog, so BPM/key show in demo mode too. */
const SEED_FEATURES: [string, number, number, number, number, number, number][] = [
  // trackId, bpm, key(0=C), mode(1=major), energy%, danceability%, valence%
  ["t01", 92, 9, 0, 38, 52, 30],
  ["t02", 118, 6, 0, 55, 62, 40],
  ["t03", 84, 2, 0, 48, 44, 22],
  ["t04", 68, 1, 0, 30, 35, 18],
  ["t05", 76, 7, 1, 24, 30, 42],
  ["t06", 104, 4, 0, 62, 58, 48],
  ["t07", 60, 10, 0, 22, 26, 14],
  ["t08", 100, 11, 0, 58, 66, 55],
  ["t09", 96, 5, 0, 44, 48, 26],
  ["t10", 72, 3, 0, 28, 32, 20],
  ["t11", 80, 0, 1, 18, 24, 36],
  ["t12", 88, 7, 0, 52, 50, 30],
  ["t13", 110, 9, 1, 66, 60, 62],
  ["t14", 64, 4, 1, 26, 28, 24],
  ["t15", 120, 6, 1, 60, 64, 58],
  ["t16", 98, 11, 1, 50, 56, 52],
];

/** Seeded separately so an existing catalog still gains BPM/key metadata. */
async function seedFeatures(): Promise<void> {
  const [{ count }] = await db.select({ count: sql<number>`count(*)::int` }).from(trackFeatures);
  if (count > 0) return;
  await db.insert(trackFeatures).values(
    SEED_FEATURES.map(([trackId, bpm, key, mode, energy, danceability, valence]) => ({
      trackId,
      bpm,
      key,
      mode,
      energy,
      danceability,
      valence,
    })),
  );
}

let seeding: Promise<void> | null = null;
let verified = false;

/** Idempotent first-run seed. Safe to call on every catalog request. */
export function ensureSeeded(): Promise<void> {
  if (verified) return Promise.resolve();
  if (!seeding) {
    seeding = (async () => {
      // Deployments that skipped `drizzle-kit push` still get working tables.
      await ensureSchema();

      const [{ count }] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(tracks);
      if (count > 0) {
        await seedFeatures();
        verified = true;
        return;
      }

      await db.insert(tracks).values(
        SEED_TRACKS.map((t) => ({
          id: t.id,
          title: t.title,
          artist: t.artist,
          album: t.album,
          durationMs: t.durationMs,
          genre: t.genre,
          year: t.year,
          colors: t.colors,
          artSeed: t.artSeed,
          playCount: t.playCount,
          saved: t.saved,
        })),
      );
      await db.insert(playlists).values(SEED_PLAYLISTS);
      await db.insert(artists).values(SEED_ARTISTS);
      await db
        .insert(preferences)
        .values({ id: "default", ...DEFAULT_PREFERENCES })
        .onConflictDoNothing();

      // A little history so the Activity surface isn't a blank slate.
      const byId = new Map(SEED_TRACKS.map((t) => [t.id, t]));
      const order = ["t04", "t07", "t01", "t10", "t02", "t13", "t08", "t14", "t05", "t03", "t09", "t12"];
      const events = order.map((id, i) => {
        const t = byId.get(id)!;
        const completed = i % 3 !== 2;
        return {
          trackId: t.id,
          trackTitle: t.title,
          artist: t.artist,
          source: "demo",
          progressMs: completed ? t.durationMs : Math.round(t.durationMs * 0.45),
          durationMs: t.durationMs,
          completed,
          createdAt: new Date(Date.now() - (i * 7 + 3) * 3600_000),
        };
      });
      await db.insert(listeningEvents).values(events);

      await seedFeatures();

      verified = true;
    })().catch((err) => {
      seeding = null;
      verified = false;
      throw err;
    });
  }
  return seeding;
}
