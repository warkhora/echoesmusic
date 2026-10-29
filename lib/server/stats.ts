import { pool } from "@/db";
import type { ListeningStats } from "@/lib/types";

interface RawStats {
  events: number;
  minutes: number;
  completion_rate: number;
  top_artists: { artist: string; plays: number }[];
  sessions: { day: string; minutes: number }[];
}

const STATS_SQL = `
with totals as (
  select count(*)::int                                       as events,
         coalesce(round(sum(progress_ms) / 60000), 0)::int   as minutes,
         count(*) filter (where completed)::int              as completed
  from listening_events
),
top_artists as (
  select artist, count(*)::int as plays
  from listening_events
  group by artist
  order by plays desc
  limit 5
),
sessions as (
  select to_char(date_trunc('day', created_at), 'YYYY-MM-DD') as day,
         coalesce(round(sum(progress_ms) / 60000), 0)::int    as minutes
  from listening_events
  where created_at > now() - interval '7 days'
  group by 1
)
select (select events  from totals)  as events,
       (select minutes from totals)  as minutes,
       case when (select events from totals) = 0 then 0
            else round((select completed from totals)::numeric
                       / (select events from totals), 4)::float
       end                           as completion_rate,
       coalesce((select json_agg(json_build_object('artist', artist, 'plays', plays))
                 from top_artists), '[]'::json) as top_artists,
       coalesce((select json_agg(json_build_object('day', day, 'minutes', minutes) order by day)
                 from sessions), '[]'::json)    as sessions;
`;

/** Aggregates are one round trip and cached briefly — the UI polls this. */
const TTL_MS = 8_000;
let cache: { at: number; value: ListeningStats } | null = null;

export function invalidateStats(): void {
  cache = null;
}

export async function buildStats(): Promise<ListeningStats> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.value;

  const { rows } = await pool.query<RawStats>(STATS_SQL);
  const row = rows[0];
  const value: ListeningStats = {
    events: row?.events ?? 0,
    minutes: row?.minutes ?? 0,
    completionRate: row?.completion_rate ?? 0,
    topArtists: row?.top_artists ?? [],
    sessions: row?.sessions ?? [],
  };
  cache = { at: Date.now(), value };
  return value;
}
