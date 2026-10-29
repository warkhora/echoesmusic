# Echoes — v1.0.0

A minimalist, "Liquid Glass" web client for Spotify. Translucent surfaces, an ambient colour
field that re-lights with whatever is playing, and a calm, distraction-free listening shell.

> **v1.0.0 scope** — visual design system, liquid-glass components, motion language, Spotify
> PKCE auth and library/playback data plumbing. The full audio engine (Web Playback SDK,
> crossfade, queue editor) lands in **v1.1.0**.

---

## 1. Quick start

```bash
# 1 — install dependencies (framer-motion + lucide-react are already in package.json)
npm install

# 2 — environment
cp .env.example .env.local
#   NEXT_PUBLIC_SPOTIFY_CLIENT_ID=xxxxxxxxxxxxxxxx   ← from developer.spotify.com/dashboard
#   DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/app_db

# 3 — create the tables (first run seeds the demo catalog automatically)
npx drizzle-kit push

# 4 — run
npm run dev          # http://localhost:3000
npm run build && npm start
```

**Redirect URI** — whitelist exactly what the app runs on, e.g. `http://localhost:3000/`
plus your production origin. Override it with `NEXT_PUBLIC_SPOTIFY_REDIRECT_URI` if needed.

**No client id?** Echoes boots into **Demo Mode**: the entire interface runs against a local
Postgres catalog (16 tracks, 6 playlists, 8 artists) so every surface is explorable — the
transport is simulated and every play is still written to the database.

---

## 2. Project structure (deployment-ready)

```
echoes/
├─ .env.example                   # NEXT_PUBLIC_SPOTIFY_CLIENT_ID · DATABASE_URL
├─ drizzle.config.json            # drizzle-kit push → PostgreSQL
├─ package.json                   # next · react · drizzle-orm · pg · framer-motion · lucide-react
├─ tsconfig.json  postcss.config.mjs  eslint.config.mjs  next.config.ts
└─ src/
   ├─ app/
   │  ├─ layout.tsx               # fonts, metadata, theme-color, favicon
   │  ├─ page.tsx                 # provider stack, shell, boot/login gate, shortcuts
   │  ├─ globals.css              # ⭐ Liquid Glass design system (Tailwind v4 @theme/@utility)
   │  └─ api/
   │     ├─ catalog/route.ts          GET  demo library + features + recent + top + stats
   │     ├─ playback/route.ts         GET  log (+stats, ?stats=0 to skip) · POST telemetry
   │     ├─ preferences/route.ts      GET / PUT personalization
   │     ├─ tracks/[id]/saved/route.ts PUT saved toggle
   │     ├─ spotify/library/route.ts  GET aggregation · PUT/DELETE unified /me/library
   │     ├─ spotify/library/contains/route.ts  GET /me/library/contains (≤40 URIs)
   │     ├─ spotify/playlist/route.ts GET  paged /playlists/{id}/items + features
   │     ├─ spotify/track/route.ts    GET  track + album + artist detail (hi-res art)
   │     ├─ spotify/artist/route.ts   GET  /v1/artists/{id} banner + external_urls
   │     ├─ spotify/devices/route.ts  GET devices · PUT transfer playback
   │     ├─ spotify/session/route.ts  POST/GET/DELETE server-side token mirror
   │     ├─ spotify/recent/route.ts   GET  lazy /me/player/recently-played (limit 50)
   │     ├─ spotify/search/route.ts   GET  /v1/search?type=track&market=from_token
   │     └─ health/route.ts           GET  DB liveness
   ├─ components/
   │  ├─ AmbientField.tsx         # composited blooms + liquid turbulence mesh + grain
   │  ├─ AccentDriver.tsx         # writes --accent-* from theme or artwork
   │  ├─ AlbumArt.tsx             # memoised procedural sleeves / Ken Burns artwork
   │  ├─ GlassCard.tsx            # glass atom: pointer sheen + hover lift
   │  ├─ Sidebar.tsx  TopBar.tsx  PlayerBar.tsx  PersonalizationDrawer.tsx
   │  ├─ DevicePanel.tsx          # device recovery: picker, transfer, re-check
   │  ├─ EntityLink.tsx           # ArtistLink / AlbumLink / ArtistLinks / BackLink
   │  ├─ GlobalSearch.tsx         # header search + live liquid-glass dropdown (5 hits)
   │  ├─ NowPlayingPanel.tsx      # right-side Now Playing view + mobile sheet
   │  ├─ ExpandedNowPlaying.tsx   # ⭐ immersive expanded view (main + sidebar)
   │  ├─ Waveform.tsx             # CSS-only atmospheric visualizer
   │  ├─ TrackRow.tsx             # title · artists · album · BPM/key · save · duration
   │  ├─ LoginScreen.tsx          # PKCE CTA + iframe breakout notice
   │  ├─ Spinner.tsx              # Spinner · BusyChip · LoadingBar
   │  ├─ motion.tsx               # ScrambleText · Reveal · MaskedHeading · Equalizer · CountUp
   │  └─ views/                   # Home · Playlists · Saved · Activity · Album · Artist · Search
   ├─ hooks/
   │  ├─ useSpotifyAuth.ts        # PKCE boot, callback exchange, refresh, relay hop
   │  ├─ useWebPlayback.ts        # SDK lifecycle: load → connect → ready → device_id
   │  ├─ useArtistDetail.ts       # GET /v1/artists/{id} on primary-artist change, cached
   │  ├─ useSearch.ts             # 300ms debounced search, taste-ranked, request-id guarded
   │  ├─ useRateLimit.ts          # mirrors the 429 breaker countdown (polls nothing)
   │  └─ useClientValue.ts        # useSyncExternalStore for browser-only values
   ├─ lib/
   │  ├─ spotify/auth.ts          # ⭐ PKCE primitives, scopes, show_dialog, frame breakout
   │  ├─ spotify/sessionClient.ts # publishes the session, adopts rotated tokens from headers
   │  ├─ spotify/libraryApi.ts    # unified /me/library ops: URIs, 40-per-call, legacy fallback
   │  ├─ spotify/detailCache.ts   # ⭐ global track/artist cache: once per id, ever
   │  ├─ spotify/rateLimit.ts     # ⭐ global 429 breaker: session halt, one warning
   │  ├─ spotify/paginate.ts      # ⭐ one paged-collection walker (saved songs)
   │  ├─ spotify/client.ts        # ⭐ includes `enqueueSpotify` — the serial request lane
   │  ├─ spotify/fields.ts        # ⭐ `fields=` projections for every list endpoint
   │  ├─ spotify/transport.ts     # ⭐ direct playback PUTs: device_id, uris⊕context_uri, 503 retry
   │  ├─ spotify/webPlayback.ts   # Web Playback SDK loader + ambient typings
   │  ├─ spotify/client.ts        # fetch wrapper, typed errors, adapters, image/feature mappers
   │  ├─ server/spotify.ts        # parallel fan-out, feature cache, playlist paging + errors
   │  ├─ server/token.ts          # ⭐ token resolution, server-side refresh, rotated-token echo
   │  ├─ server/schema-bootstrap.ts # idempotent DDL self-heal (no more 500/503 on a fresh DB)
   │  ├─ server/stats.ts          # single-CTE aggregates with an 8 s cache
   │  ├─ debounce.ts              # ⭐ stage/schedule/flush committer (scrub & volume)
   │  ├─ http.ts                  # safeJson / safeJsonIfOk / safeBody — parsing cannot throw
   │  ├─ events.ts                # in-app bus: track-changed / listen-logged / track-finished
   │  ├─ recommend.ts             # continuous-play picker (artist → album → genre → tempo/energy)
   │  ├─ taste.ts                 # ⭐ taste profile + relevance scoring for search ranking
   │  ├─ playback/rules.ts        # ⭐ pure guards: poll adoption, natural end, watchdog
   │  ├─ playback/queue.ts        # ⭐ deterministic continuation rules + lookahead (v7.0.1)
   │  ├─ localLibrary.ts          # ⭐ localStorage hydration: listening history + liked songs
   │  ├─ color.ts                 # artwork palette extraction (CORS-safe)
   │  ├─ navigation.ts  types.ts
   ├─ state/
   │  ├─ preferences.tsx          # blur/theme/motion → localStorage + Postgres
   │  ├─ library.tsx              # proxy-first loader, direct fallback, playlist errors
   │  └─ player.tsx               # ⭐ optimistic transport, intent lock, dual contexts
   └─ db/  index.ts · schema.ts · seed.ts
```

---

## 2b. Reliability notes

**Authorization.** `buildAuthUrl()` requests all playback and library scopes explicitly —
`user-read-playback-state`, `user-modify-playback-state`, `user-read-currently-playing`,
`playlist-read-private`, `playlist-read-collaborative`, plus library/top/recently-read and
`streaming` — and always sends **`show_dialog=true`**, so Spotify re-shows the consent screen and
newly added scopes take effect on the very next login instead of being silently reused.

**Play/pause ping-pong.** A manual action records an *intent* (`{playing, at, retries}`) and opens
a 2 s lock. Polls inside the lock may refresh metadata but never the play state. Reconciliation
then **compares** Spotify's answer with the intent: if they disagree, the command is re-issued once
(the UI keeps showing what the user asked for) with 1.6 s of extra grace; only if that also fails
does the UI adopt reality and explain why. Stale reconcile timers from earlier clicks are always
cancelled, and focus/visibility syncs are non-authoritative — the two ways the icon used to flip
back and forth.

**Playlist failures.** `/playlists/{id}` and `/playlists/{id}/tracks` are fetched independently: a
refused `/tracks` still falls back to the playlist object's own first page. Statuses are propagated
(401 → refresh the token and retry once, 403 → private/region-locked/stale scopes, 404 → deleted,
429 → rate limit) and rendered as an actionable panel with **Try again**, never as an infinite
skeleton or a bare 500. `/api/playback` degrades partially — if only the aggregates fail it still
returns the log; if the log itself fails it answers 503 with JSON so the UI keeps its last state.

## 3. The Liquid Glass system

Everything translucent reads from a handful of CSS custom properties, so one slider can
re-tune the whole product.

| Token | Default | Meaning |
| --- | --- | --- |
| `--glass-blur` | `26px` | `backdrop-filter` radius for every surface (10–50 via the drawer) |
| `--glass-border` | `rgba(255,255,255,.12)` | ultra-thin 1px edge |
| `--glass-fill-a/b` | `.085 / .022` | diagonal wash inside the pane |
| `--accent-1/2/3` | theme triad | blooms, glows, progress gradient, focus rings |
| `--accent-glow` | accent @45% | hover shadows and bloom halos |

Utilities (Tailwind v4 `@utility`): `glass`, `glass-thin`, `sheen` (a specular highlight that
follows the cursor via `--mx/--my`), `lift`, `thin-scrollbar`, `fade-mask-r`, `grain`,
`skeleton`, `tnum`, `eq-bar`.

**Motion signature** — morphing turbulence mesh, drifting blooms, Ken Burns artwork breathing,
scramble-decode titles on track change, line-mask heading reveals, `layoutId` nav pill,
spring drawer, stacked pinned sleeves in the hero. All of it collapses under
`prefers-reduced-motion` and under the in-app **Fluid motion** toggle (`data-motion="calm"`).

---

## 4. Authentication (PKCE)

`lib/spotify/auth.ts` implements the public-client flow end to end:

1. `beginLogin()` → 64-char verifier + random state → `sessionStorage`, SHA-256 → S256 challenge → redirect.
2. On return, `readCallbackParams()` grabs `?code=`, `exchangeCodeForToken()` swaps it at
   `accounts.spotify.com/api/token` (no secret), then the URL is cleaned with `history.replaceState`.
3. The session lives in `localStorage` (`echoes.spotify.session.v1`) with an `expiresAt`
   already trimmed by 45s. `useSpotifyAuth.getAccessToken()` transparently refreshes, and a
   45s timer renews tokens before they lapse.
4. `logout()` clears storage and drops back to Demo Mode.

### Server-side token mirror (automatic refresh in API routes)

Echoes is a PKCE **public** client — there is no client secret, so NextAuth's confidential
authorization-code flow does not apply. Instead the browser mirrors its session to
`POST /api/spotify/session`, which stores the tokens in the `spotify_sessions` table and sets an
**httpOnly** cookie holding only an opaque random id (never the tokens themselves).

Every `/api/spotify/*` route then resolves a token through `withSpotify()`:

1. `Authorization: Bearer …` header if present (works even with third-party cookies blocked).
2. Otherwise the session cookie → row lookup → **refreshed server-side** when within 90 s of
   expiry, using the PKCE refresh grant (`client_id` only, no secret).
3. If Spotify answers 401 mid-request, the route refreshes and **retries once**, then echoes the
   rotated tokens back via `x-echoes-access-token` / `x-echoes-refresh-token`; the browser adopts
   them through `adoptTokenHeaders()` so client and server never drift apart.
4. Only when no token exists at all does a route answer 401 `missing_token`.

`SameSite=None; Secure` is used in production so the mirror also works while Echoes is embedded in
a preview iframe; `SameSite=Lax` is used for plain-http local dev. `DELETE /api/spotify/session`
drops the mirror on logout.

### Embedded previews (Arena / any iframe host)

`accounts.spotify.com` sends `X-Frame-Options: DENY`, so the consent screen can never render
inside a preview iframe. `beginLogin()` therefore never navigates the frame:

1. It detects framing (`window.self !== window.top`) and navigates **`window.top.location.href`**
   (falling back to `window.parent.location.href`) to `${appUrl}?echoes_auth=1` — a *relay hop*
   that lifts Echoes itself to the top level.
2. The relay hop exists because iframe storage is **partitioned**: a verifier written inside the
   frame would be unreadable after Spotify bounces the top window back to the app. At the top
   level the verifier is dual-written to `sessionStorage` + `localStorage`.
3. That unpartitioned instance strips the flag, builds the S256 challenge, and navigates the top
   window to `accounts.spotify.com/authorize`.
4. On return, `verifyCallbackState()` checks `state` and `exchangeCodeForToken()` swaps the code.
5. If the host frame forbids top navigation (`sandbox` without `allow-top-navigation`), the login
   screen surfaces an explicit **“Open Echoes in its own tab”** action instead of failing silently.

Scopes requested: `user-read-playback-state`, `user-modify-playback-state`,
`user-read-currently-playing`, `playlist-read-private`, `playlist-read-collaborative`,
`user-library-read`, `user-library-modify`, `user-follow-read`, `user-follow-modify`,
`user-read-private`, `user-read-email`, `user-read-recently-played`, `user-top-read`, `streaming`.

---

## 4b. February 2026 Web API compliance

Echoes targets the current spec and still reads the legacy shapes, because Extended Quota apps are
served the old ones and playlist contents are only returned for playlists you own or collaborate on.

| Area | Implementation |
| --- | --- |
| Playlists | `GET /playlists/{id}?market=from_token&additional_types=track,episode`, contents read from **`playlist.items`** (`items.items[].item`) with a legacy `playlist.tracks` reader. Paging uses **`GET /playlists/{id}/items`** first and falls back to the removed-but-still-served `/tracks`. |
| The boolean trap | Since Feb 2026 `row.track` survives as a **boolean**. `rowTrack()` only accepts `row.item`, or `row.track` when it is an object — so a full playlist never renders as empty. |
| Tracks | `GET /tracks/{id}?market=from_token`. `preview_url`, `popularity` and manual `available_markets` checks are gone; playability comes from `is_playable`. |
| Artists | `GET /artists/{id}` individually (batch `?ids=` was removed), 3-at-a-time, capped at 6 per load. `followers`/`genres` are optional and often absent in Dev Mode — the UI degrades instead of showing `0 listeners` as an error. |
| Albums & covers | `GET /albums/{id}?market=from_token`, largest image via `pickImage()` (`images[0].url` in practice). Artwork URLs are **never persisted**: memory-only for ≤10 min server-side, `Cache-Control: no-store` on every Spotify-facing response, and nothing written to Postgres or `localStorage`. |
| Library | `GET /me/library/contains?uris=…`, `PUT /me/library?uris=…`, `DELETE /me/library?uris=…` — **URIs**, chunked to **40 per request**, each with a legacy `/me/tracks*` fallback. |
| Auth headers | `spotifyFetch()` attaches `Authorization: Bearer <token>` to *every* upstream call; `withSpotify()` resolves it from the header or the session cookie and refreshes it automatically. |
| Proxy → direct | If `/api/spotify/*` is unreachable or answers non-OK, the browser retries the same operation directly against `api.spotify.com` (library load, playlist detail, save/remove, track detail). |

---

## 4c. Device handling — "no active device"

Spotify only accepts transport commands when a device is active; otherwise `PUT /me/player/play`
answers **404** ("No active device found") or **403**. Echoes resolves a device *before* commanding:

1. **Fast path** — `/me/player` already returns the active device (id, name, type), so the poll
   keeps `activeDeviceId` warm and no extra call is made.
2. **Discovery** — with no known device, `GET /v1/me/player/devices` is called (proxy first, direct
   browser call as fallback) before any `play`/`next`/`previous`.
3. **Selection** — `pickDevice()` prefers an already-active device, then controllable ones ranked
   Computer → Web → Smartphone → Tablet → TV → Speaker, favouring devices that report a volume
   (a proxy for "the app is genuinely open"). Restricted and id-less devices are ignored.
4. **Auto transfer** — the chosen device receives `PUT /v1/me/player {device_ids:[id], play:false}`
   and the original play command is then issued. The listener sees “Waking <device>” →
   “Transferred to <device>”.
5. **Nothing to play on** — the optimistic play state is reverted and the device panel appears:
   *“Please open Spotify and play a track once to activate your device.”* with a device picker,
   **Check devices again**, and a dismiss control. The panel is never a dead end.
6. **Self-healing** — while no device is known the poll cadence tightens to 6 s, so the panel clears
   by itself the moment Spotify is opened elsewhere.
7. **No crashes or freezes** — 404/403 from any transport call is caught, converted into guidance,
   clears the stale device id, and always releases the buffering spinner. A 401 triggers one token
   refresh + retry (`transportFetch`) so a lapsed session never looks like a device problem.

---

## 4d. Web Playback SDK & playback execution

Echoes registers itself as a real Spotify Connect device for the current tab, which is what gives
the transport a stable `device_id` and removes the 503/404 class of failures.

**Construction & handshake** (`useWebPlayback`) — the SDK script is injected once, and the player
is built with the documented options:

```js
const player = new Spotify.Player({
  name: "Echoes Web Player",
  getOAuthToken: (cb) => { cb(accessToken); },   // always the freshest token
  volume: 0.8,                                   // clamped 0–1, from the saved preference
});
await player.connect();                          // must resolve true
```

```js
player.addListener("ready", ({ device_id }) => {
  window.spotifyDeviceId = device_id;
});
```

`web.connected` is true **only when both halves of the handshake are done** — `ready` has fired
with a valid `device_id` *and* `connect()` resolved. `ensureDevice()` gates on it, so a
`PUT /v1/me/player/play` can never be issued at a half-initialised player (the usual source of
DRM/EME 503s on a track change). Resolution order: the device already reported active (preserves a
manual transfer) → the connected SDK device → `GET /v1/me/player/devices` discovery → automatic
transfer. Account, authentication, initialization, playback and `autoplay_failed` errors are all
caught and rendered as guidance — including “In-browser playback needs Spotify Premium”, after
which Echoes keeps working as a remote for your other devices. A rotated token never tears the
player down (`getOAuthToken` hands over the fresh one), so audio does not cut out mid-track.

**Audio & DRM activation (Edge/Chrome).** MediaKeySystemAccess — and therefore the PlayReady /
Widevine robustness checks — is only granted from a user gesture, so the ordering matters:

1. `activateAudio()` is invoked **synchronously at the top of every click handler** (`playQueue`,
   `playTrack`, `toggle`, `step`) — before a single `await`, while the gesture is still live.
2. That promise is then **awaited before** `PUT /v1/me/player/play` is issued, so the DRM context
   is unlocked first and the play request second.
3. The same promise is threaded into the transport as the recovery hook for retries.
4. A one-shot global listener spends the *first* click or keypress anywhere in the app on
   `activateElement()`, so media keys are warm before the listener ever reaches a play button.
5. Once the handshake completes, Echoes claims itself as the active device with
   `PUT /v1/me/player {device_ids:[window.spotifyDeviceId], play:false}` — skipped when another
   device is genuinely playing, so opening Echoes never interrupts a phone or desktop session.

A `playback_error` matching `drm|eme|widevine|playready|encrypted|robustness` becomes “Your browser
blocked encrypted audio (DRM). Press play again…”, and the device panel offers an explicit
**Enable audio in this tab** button (also gesture-driven).

**Payload rules** — enforced in `lib/spotify/transport.ts`, never both keys in one request:

| Situation | Request (measured) |
| --- | --- |
| Individual track | `PUT https://api.spotify.com/v1/me/player/play?device_id=${window.spotifyDeviceId}` · `{"uris":["spotify:track:<id>"],"position_ms":0}` |
| Row clicked inside a playlist/album | `{"context_uri":"spotify:playlist:PLAYLIST_ID","offset":{"uri":"spotify:track:CLICKED_ID"},"position_ms":0}` |
| …same, URI unknown | `{"context_uri":…,"offset":{"position":trackIndex},"position_ms":0}` |
| Row clicked in an arbitrary list (top tracks, saved, recently played) | `{"uris":[…sliced from the clicked track…],"position_ms":0}` |
| Full playlist or album from its header | `{"context_uri":…,"offset":{"uri":…},"position_ms":0}` — **never** alongside `uris` |

### One handler for every clickable track

`decidePlayPayload()` + `executePlay()` (`lib/spotify/transport.ts`) are the only place a play body
is built, and `playFrom()` (`state/player.tsx`) is the only entry point the UI uses. The decision is
pure and unit-testable:

| Surface | Call | Payload produced |
| --- | --- | --- |
| Playlist / album row | `playFrom({track, tracks, index, contextUri})` | `{context_uri, offset:{uri:<clicked>}, position_ms:0}` |
| Home hero sleeve (inside the featured playlist) | same, with `contextUri` | `{context_uri, offset:{uri}, position_ms:0}` |
| Home “Recently played” rail card | `playFrom({track, tracks, index})` | `{uris:["spotify:track:<id>"], position_ms:0}` |
| Top tracks row | `playFrom({track, tracks, index})` | `{uris:["spotify:track:<id>"], position_ms:0}` |
| Saved / library row | `playFrom({track, tracks, index})` | `{uris:["spotify:track:<id>"], position_ms:0}` |
| Activity (telemetry) row | `playFrom({track})` | `{uris:["spotify:track:<id>"], position_ms:0}` |
| Search result | `playFrom({track})` | `{uris:["spotify:track:<id>"], position_ms:0}` |
| Playlist header **Play** | `playQueue(tracks, 0, {contextUri})` | `{context_uri, offset:{uri:<first>}, position_ms:0}` |
| **Play all** / **Shuffle** (no context) | `playQueue(tracks, 0)` | `{uris:[…whole list…], position_ms:0}` |

A standalone click deliberately sends **one** URI: a sliced multi-URI queue means a single
unavailable or region-locked sibling can fail the entire request, which is why those clicks used to
do nothing. `track.uri` is preferred everywhere and `spotify:track:${id}` is synthesised when a
track object has no URI. An empty list produces no network call at all.

**Why two shapes.** `PUT /v1/me/player/play` accepts an `offset` **only** with `context_uri`; a
`uris` array has no offset parameter at all, so Spotify starts at `uris[0]` no matter which row was
clicked. Clicking track 4 of a playlist therefore sends the context plus `offset.uri`, while
clicking track 4 of an arbitrary queue sends `uris.slice(3)`. `startPlayback()` clamps the index,
prefers `offset.uri` over `offset.position` (robust when episodes were filtered out of the list),
and the two key sets are constructed by separate functions so they can never be mixed.

Every play path runs through one function, `startPlayback()`, so the order is always:
`activateElement()` (invoked in the click handler) → resolve device → **transfer first if the device
is not confirmed active** → `await` the DRM unlock → `PUT /me/player/play?device_id=…`. Devices
already confirmed by a poll, an SDK state event or a previous transfer skip the pre-flight
transfer, so ordinary track switching stays instant.

**503 / device-error recovery ladder** — a 503 is the DRM/EME "media keys not ready" signature, so
it gets a cheap fast path before the heavier transfer:

```js
await fetch("https://api.spotify.com/v1/me/player", {
  method: "PUT",
  headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
  body: JSON.stringify({ device_ids: [window.spotifyDeviceId], play: false }),
});
```

A 403 “Premium required” is deliberately *not* retried — it would only burn quota — and is surfaced
as guidance instead. Verified with a mocked `fetch` against the shipped module:

| Trigger | Sequence | Measured |
| --- | --- | --- |
| **503** | resolve `player.activateElement()` → **400 ms** → retry the play request **once** | 403 ms, 2 play calls, 1 activation, no transfer |
| 503 persisting | exactly **one** retry, then an honest failure + guidance (no retry storm) | 2 play attempts total |
| **404 / device error** | `PUT /me/player {device_ids:[id],play:false}` → **500 ms** → retry once | 502 ms |
| 403 Premium · 401 token | **no retry** — it would only burn quota; guidance surfaced instead | 1 call |

Payload/offset matrix, measured against the shipped transport: playlist row 3 →
`{context_uri, offset:{uri:"…t3"}, position_ms:0}` · index fallback → `offset:{position:3}` ·
queue row 3 of 6 → `{uris:["…t3","…t4","…t5"]}` · last row → one-item queue · out-of-range index →
clamped, never an empty payload · `context_uri` and `uris` never coexist.

Delays are overridable per call (`fastRetryMs`, `retryDelayMs`). Prevention beats recovery: the
pre-flight transfer in `startPlayback()` is what removes most 503s before they happen.

**Direct client execution** — every playback PUT (`play`, `pause`, `next`, `previous`, `seek`,
`volume`, `shuffle`, `repeat`, transfer) runs from the browser against `api.spotify.com` with the
listener's own token. Nothing playback-related is proxied, so no serverless timeout can interrupt a
skip. The proxy remains for library/playlist/track reads and for refreshing an expired token, and a
401 on a transport call triggers one refresh + retry.

**Scrubbing without rate limits.** A pointer drag fires ~60 events/second, so the slider is split
into local and remote halves by `createDebouncedCommit` (`lib/debounce.ts`):

* `scrubTo(ms)` — **local only**. Moves the handle, stages the value, freezes the transport clock
  (`scrubbingRef`) and holds off polls, so nothing fights the drag. Zero requests.
* `endScrub()` — on `pointerup` / `pointercancel` / `pointerleave`: `flush()` commits **exactly one**
  `PUT /v1/me/player/seek?position_ms=…`, then a poll re-syncs the truth ~950 ms later.
* `seek(ms)` — the debounced path used by the keyboard: a held arrow key coalesces into one request
  instead of one per key-repeat.
* Volume behaves the same way (`schedule` while dragging, `flush` on `pointerup`/`keyup`/`blur`).
* Both committers are cancelled on unmount, so nothing leaks after a logout or navigation.

Measured with the real modules: a 90-move drag → **0 requests while dragging, 1 on release**
(release is idempotent); 12 held-key seeks → 1; a 36-step volume drag → 1; cancel mid-drag → 0.
Previously the same drag issued ~90 `PUT /me/player/seek` calls and tripped Spotify's 429 limit.

**Instant state** — while the Echoes device is active, `player_state_changed` drives the UI
locally (position, pause, track changes, shuffle/repeat), so the `/me/player` poll backs off to
20 s and only exists to notice another device taking over.

---

## 4e. What runs in the browser vs. on the server

Playback and library writes are **never** proxied — a backend outage or a serverless timeout can no
longer block a click.

| Operation | Path |
| --- | --- |
| `PUT /v1/me/player/play` (single track, queue, context) | **direct** from the browser |
| pause · next · previous · seek · volume · shuffle · repeat | **direct** |
| `PUT /v1/me/player` transfer (pre-flight and recovery) | **direct** |
| `GET /v1/me/player/devices` | **direct**, proxy only as a fallback (4 s cap) |
| Save / remove / contains (`/v1/me/library…`) | **direct** |
| Library & playlist *reads* | proxy first (parallel fan-out, feature cache, token refresh), **8 s cap**, then direct |
| Listening telemetry | own API → Postgres, fire-and-forget, never awaited by the transport |

**JSON parsing cannot throw.** `lib/http.ts` exposes `safeJson` / `safeJsonIfOk` / `safeBody`, and
every fetch in the app — including `spotifyFetch` — parses through them. `204`, `202`, an empty `200`,
whitespace, an HTML error page and truncated JSON all resolve to `null` instead of raising
*“Unexpected end of JSON input”*; real HTTP failures still raise a typed `SpotifyApiError`.
Verified against all eight hostile response shapes.

**Routes never answer 5xx for non-fatal conditions.** `/api/preferences` answers `200` with
`persisted:false` when the store is unreachable (the value already lives in localStorage), and
`/api/playback` degrades to `200 {events:[], degraded:["log"]}` after self-healing a missing schema.

---

## 4f. Live surfaces, numbering, continuous play & persistence

**Persistence.** Every personalization value is written to `localStorage` (`echoes.prefs.v1`)
*synchronously* on change, stamped with `savedAt`, and mirrored to Postgres 550 ms later. On boot the
stored copy paints immediately — no flash of defaults — and the server copy is applied **only when it
is newer**, so an offline tweak is never overwritten by a stale row. `PUT /api/preferences` accepts
the client's `savedAt` and stores it as `updatedAt`.

**Real-time Home & Activity.** `lib/events.ts` is a module-level `EventTarget` with three signals:
`track-changed`, `listen-logged`, `track-finished`. The player emits them from the SDK's
`player_state_changed` handler, the `/me/player` poll and the telemetry writer.

* Home's *Recently played* rail prepends the new track the instant it starts (no round trip) and
  shows an “updating live” pulse; stats are re-read through `refreshActivity()`, debounced 700 ms.
* Activity prepends an optimistic row the moment a listen is logged, then re-reads the log and the
  aggregates (debounced 800 ms), on top of its 30 s poll and visibility-change refresh.

**Track numbering.** `TrackRow` opens with a position column — the index at rest, an equalizer while
that track is playing, and the play/pause glyph on hover — followed by the artwork and title.
`TrackListHead` renders matching column captions and is used by playlist detail, saved tracks and
every library list.

**Continuous play.** A standalone `uris` play leaves Spotify with nothing queued, so:

1. The remaining queue always wins (`queue[index + 1]`).
2. Otherwise `pickNextTrack()` (`lib/recommend.ts`) scores the catalog — same artist +3, same album
   +2, same genre +2, tempo within 12 BPM +1, energy proximity up to +1, release year within 2 years
   +0.5, plus a ≤0.9 random term that only breaks ties — skipping the last 12 auto-plays.
3. The chosen track is appended to the queue (so *Up next* and skip-back stay meaningful) and played
   through the same universal handler.
4. Triggers: the demo transport's end-of-track, and a Spotify watchdog that fires only if the track
   has run out **and** nothing changed 1.8 s later — so a real context queue is never interrupted.
5. When the history is exhausted it replays rather than stopping; an empty catalog stops cleanly and
   emits `track-finished` either way.

Verified: ranking `same-album 9.0 > same-artist 6.88 > same-genre 3.88 > near-tempo 1.64 > unrelated
0.0`; skips the current track; honours history; replays when history is exhausted; `null` on an empty
pool (graceful stop).

---

## 4g. Now Playing panel (right side)

A desktop column (352 px, `xl:` and up) with its own scrollbar; below `xl` the same content renders
as a right-hand sheet over a scrim, clear of the player bar. Toggle it from the top bar, the player
bar, or `N`; the choice persists in `localStorage` (`echoes.panel.nowPlaying`).

Top to bottom:

1. **Header** — “Now playing” / “Paused” eyebrow, the track name in display serif, a live equalizer
   and a close button.
2. **Artwork** — `album.images[0].url` (largest available, via `pickImage`) in a square frame with
   rounded corners, a coloured bloom behind it, a drop shadow, Ken Burns breathing while playing,
   and a floating play/pause control. Procedural sleeve when no artwork exists (demo mode).
3. **Title & credits** — 21 px bold, `line-clamp-2` with ellipsis; the primary artist
   (`artists[0].name`) in grey beneath, secondary artists comma-separated in a dimmer grey.
   Chips for album, year, duration, BPM and key, plus a save toggle.
4. **About the artist** — a *single* card: one **16:9** landscape banner (`object-fit: cover`,
   rounded, gradient scrim) with the artist name and listener count **over** the image, and the
   **“View on Spotify”** button directly **below** it with the genres/bio line. The href is built
   synchronously as `https://open.spotify.com/artist/${artistId}`, so it never waits on a fetch and
   the label can never toggle between two strings while an artist resolves (demo mode, which has no
   Spotify id, gets `open.spotify.com/search/<name>` under the same label). The Web API exposes no
   biography, so the card says so plainly. There is deliberately no second, floating artist header
   image.
5. **Up next** — the following three queue entries.

Data comes from the active SDK `player_state_changed` (or `/me/player` when another device is
active), so the panel updates without polling. Empty state: **“Nothing playing right now”** with a
breathing accent mark — shown only when there is no track at all; a paused track still renders in
full.

**Strict change detection — nothing fetches unless an id actually changes.**
`lib/spotify/detailCache.ts` owns both detail lookups behind one contract:

| Rule | Implementation |
| --- | --- |
| Fetch only on a **new** track id | The player's enrichment effect depends on `[currentTrackId, mode]` — never on the token, the track object, position or play state. |
| Fetch only on a **new** artist id | `useArtistDetail`'s effect depends on `[artistId]`; token and demo fallback are read through refs. |
| Position updates / play-pause / re-renders → 0 requests | Progress lives in its own context, and `mergeTrack()` returns the *same object* when no rendered field changed, so a poll for the same track cannot cascade a re-render. |
| Returning to a previous artist or track → 0 requests | 30-minute module cache shared by every consumer, holding positive **and** negative results. |
| Concurrent consumers → 1 request | An in-flight map dedupes simultaneous lookups for the same id. |
| Rate-limited id | A **global 429 circuit breaker** (`lib/spotify/rateLimit.ts`) halts *every* metadata request for the **session** — client and server at once. One clean `console.warn`, **no retry loop**, and **no direct-call fallback** after a 429 (that would be an immediate second request for the same id). Cached artwork keeps rendering and playback is unaffected; the header **Refresh** is the explicit opt back in. |
| Already-requested id | A session-long `requested` set makes "same id ⇒ 0 requests" absolute, independent of effect dependencies. A positive entry never expires within the session; only rate-limited misses are forgotten, so they become retryable exactly when the breaker closes. |
| Artist changes track-to-track | `useArtistDetail` writes state on **every** id change — `setArtistData(cached)` on a hit, `setArtistData(fetched)` after a miss. Reading the cache during render is *not* reactive: a value that resolved while the consumer was stale never re-triggered the memo, which is how the panel came to show only the first track's artist. A cache miss clears the previous artist first, so the card never shows artist A's photo over artist B's track. |
| Aborted lookup | An `AbortController` firing because the listener switched tracks is **not** cached as a failure — doing so hid that artist for a minute and made rapid switching look broken. |
| Abort | `AbortController` on cleanup / id change, plus an 8–10 s cap. |
| Demo mode | No Spotify ids exist, so the effect returns before any fetch. |

### Never fetch what the payload already contains

`GET /me/player`, `GET /me/player/currently-playing` and the SDK's `player_state_changed` all carry
`item.name`, `item.album.images` (every resolution) and `item.artists`. The player therefore reads
those directly and **skips the detail request entirely** when the track already has artwork and
credits — which is the normal case. `GET /tracks/{id}` (plus its `/albums/{id}` and `/artists/{id}`
fan-out) now only happens for a track that arrives with no artwork at all. BPM and key come from the
library load and the Postgres `track_features` cache, never from a per-track call.

### `fields` projections

`lib/spotify/fields.ts` narrows every list request to the properties Echoes renders
(`fields=items(id,name,uri,type,duration_ms,explicit,is_local,is_playable,artists(id,name,uri,external_urls(spotify)),album(id,name,uri,images,release_date,artists(id,name)))`
and friends), applied to `/me/playlists`, `/playlists/{id}`, `/playlists/{id}/items`, `/me/tracks`,
`/me/player/recently-played`, `/me/top/tracks` and `/me/top/artists`. The playlist projection keeps
**both** row wrappers — `item(…)` (Feb 2026) and `track(…)` (legacy) — because projecting the track
fields at row level would silently return empty rows. `GET /me/player` is deliberately *not*
projected: the transport needs device, repeat/shuffle and progress. Every projected call goes
through `spotifyFetchProjected()`, which retries once without the projection if Spotify answers 400,
so a projection change can never empty the library.

### No background metadata loops

No timer anywhere in the app fetches metadata: the 120 ms transport clock only calls
`setProgressMs`, and the playback poll only calls `GET /me/player`. Track and artist detail come
solely from effects keyed on the id (`[currentTrackId, mode]` and `[artistId]`), each with a
`useRef` change guard so the same id cannot reach the network twice. When the Web Playback SDK is
the active device the poll backs off to 60 s (the SDK pushes state locally for free) and pauses
entirely on a hidden tab; elsewhere it is 10 s playing / 30 s idle, never on a hidden tab.

Measured against the real modules:

| Scenario | Requests |
| --- | --- |
| 1 artist lookup, then 500 more across rotating tokens | **1**, then **0** |
| 50 concurrent consumers, same new id | **1** (deduped) |
| 101 track lookups, same id | **1** |
| A 429 response | **1** — no direct-call fallback |
| 600 further lookups while halted | **0** |
| New id while halted, upstream healthy again | **0** — no automatic retry |
| After the explicit **Refresh** | exactly **1**, resolved, then cached forever |
| `null` id or missing token | **0**, returns `null`, no throw |
| 5 tracks by 5 different artists | **5** — every one renders |
| Returning to 4 previously seen artists | **0** — all cache hits |
| Rapid overlapping switches (abort mid-flight) | both resolve; revisiting either costs **0** |
| 200 switches across 3 artists | **0** |

`Retry-After` is parsed and reported for diagnostics; the session halt is what gates callers. The
panel states the halt plainly so a rate-limited session explains itself instead of silently missing
artwork. Earlier guarantees still hold: the panel mounts exactly once
(`useMediaQuery("(min-width: 1280px)")` picks the desktop column *or* the mobile sheet — rendering
both and hiding one with CSS was the original source of the loop).

The panel itself mounts **once**: `useMediaQuery("(min-width: 1280px)")` decides between the inline
desktop column and the mobile sheet. Rendering both and hiding one with CSS would mount two copies
of the content and double every fetch — that was the original source of the rate-limit loop.

**Artist image contract.** `EchoArtist` carries the raw `artist.images` array alongside the
resolved URLs, and `artistImageSources()` returns a deduplicated preference order:
`images[0].url` (high-res) → `images[1].url` (medium) → `imageLargeUrl` → `imageUrl`. The `<img>` is
rendered **unconditionally** whenever a source exists, with explicit sizing
(`absolute inset-0 h-full w-full object-cover` inside the `aspect-[16/9]` wrapper — 16:9 is
`aspect-video`). There is deliberately **no `opacity-0`-until-`onLoad` gate**: a cached image can
finish loading before React attaches the listener, the event is never seen, and the picture stays
invisible — that was the missing-artist-image bug. `onError` steps to the next source, so an expired
CDN link degrades to the medium cut rather than blanking.

While `loading` is true a `skeleton` shimmer sits over the procedural base layer, so the card keeps
its exact structure with or without a photo. Artists with no images at all (Development Mode
responses, and every demo-mode artist) render the generated sleeve — never an empty box.

---

## 4h. Track-table column picker

A custom liquid-glass popover — never a native `<select>`, so the frosted backdrop and drawn
checkmarks survive every OS. The **Columns** button sits above the header row of every track list
(playlist detail, saved tracks, top tracks), opens a menu with `backdrop-filter: blur(12px)
saturate(165%)`, a dark glass border, an organic 22 px radius, an accent hairline and a soft lift.

* **Optional:** Time · Genre · Album · Release Date · BPM.
* **Fixed:** Covers, Song Title, Artists — listed in the menu under a lock, never toggleable.
* **Checkmark:** a pure white stroke with no box, drawn left→right over **500 ms** by animating
  `stroke-dashoffset` from 1 → 0 with `pathLength={1}` normalisation (exact at any viewBox scale).
  Collapses to an instant toggle under `prefers-reduced-motion`.
* **Persistence:** the selection lives in `localStorage` (`echoes.table.columns.v1`) and is re-emitted
  in canonical order so the table never reshuffles itself. A **Reset** restores the defaults.

Every cell value is resolved **from cache only** (`src/state/columns.tsx`) — rendering a column can
never trigger a request:

| Column | Source | Fallback |
| --- | --- | --- |
| Release Date | `track.album.release_date.slice(0, 4)` → `track.year` | `-` |
| Genre | `artistDetailCache.get(artistId)?.genres[0]` → catalog artist `genres[0]`/`bio` → `track.genre` | `-` |
| BPM | `track.bpm` → `audioFeaturesCache.get(id).bpm` (batched `/audio-features`) | `-` |
| Time | `track.duration_ms` | `-` |

`adaptTrack` no longer stuffs the release year into `genre`, so Spotify tracks stopped rendering
“2024” in the Genre column; `EchoArtist.genres` and `EchoTrack.releaseDate` were added to carry the
real values.

---

## 4i. Real BPM and Genre without new rate limits

Both columns used to read values that only the server sometimes supplied, so they sat on `-`. They
now have a reactive, cache-first data path.

**Genre — zero extra API calls.** `resolveGenre()` reads `artistDetailCache.get(artistId)?.genres[0]`
(the same artist detail the Now Playing panel already fetches), then the catalog artist card, then
`track.genre`. When the panel fetches an artist, `rememberArtist()` stores the whole object —
`genres` included — and **bumps a version counter** that the table subscribes to through
`useSyncExternalStore`. So the genre appears in the row the moment the panel's request resolves,
with no additional call and no polling. A Map read during render is not reactive; the counter is
what makes the cell update.

**BPM — one batched request per list.** `POST /api/spotify/features` collects the unique ids of a
loaded playlist or track list and calls `GET /v1/audio-features?ids=…` in chunks of **50** (Spotify's
documented maximum) — never one request per track. `tempo` is stored as `Math.round(tempo)` and
rendered as `128 BPM`. Results land in three caches at once: a global in-memory Map, `localStorage`
(`echoes.audioFeatures.v1`, capped at 900 entries), and the Postgres `track_features` table — so
revisiting a playlist costs **0** requests even after a full reload or on another device.

Measured: 120 unique ids → **3** requests of 50/50/20 (not 120); revisiting the same playlist →
**0**; a 429 → **1** request then **0** across 50 further calls; server-merged features seed the
cache with **0** requests; a track Spotify has no data for → `-`; a client id not entitled to
`/audio-features` (removed for most apps created after Nov 2024) → detected once, logged politely,
never asked again.

---

## 4j. Startup hydration — never an empty Home or Saved view

`lib/localLibrary.ts` keeps two versioned stores (`echoes.recent.v1`, `echoes.saved.v1`) holding
slimmed track rows (only the fields a row renders), capped at 30 history / 400 liked, with a
quota-safe retry that halves the payload if `setItem` throws.

| Surface | Cold start | Warm start |
| --- | --- | --- |
| Listening history | one `GET /v1/me/player/recently-played`, then persisted | **0 requests** — painted from localStorage on the first frame |
| Liked songs | one `GET /v1/me/tracks`, then persisted | **0 requests** — same |

Warm starts are real, not merely fast: the library request carries `?skip=recent,saved`, and the
server removes those endpoints from its fan-out (the cache key includes the skip set, so a skipped
load is never reused for a full one). `refresh=1` on the header Refresh button still forces a full
reload when the listener asks for it.

Live updates need no reload: starting a track calls `prependRecent()` (deduped, newest first) and
liking/unliking calls `setSavedLocal()` — both write localStorage and notify subscribers in the same
tick, so Home's rail, the Saved list and every heart icon move immediately. Views subscribe through
`useSyncExternalStore`. `patchStoredTracks()` keeps stored rows in step when artwork or BPM lands
later, and logout clears both stores so another listener never inherits them.

**Genre and BPM degradation.** `resolveGenre()` walks
`artistCache.get(artistId)?.genres[0]` → catalog artist `genres[0]` → `track.album?.genres?.[0]` →
`track.genre` → `-`, and title-cases the result (`downtempo` → **Downtempo**, `ambient house` →
**Ambient House**). It never falls back to `bio`, which is free prose for seeded artists. When
Spotify withholds audio features, `resolveBpmCell()` degrades to the release year (labelled `2023 yr`,
dimmed, with a tooltip explaining why) and only then to `-`. Every resolver is a pure function of
props and cache, so a degraded cell can never leave a row stuck mid-render. The `/audio-features`
batch loop is wrapped per batch: one failure logs, stops the remaining batches, and still returns
whatever earlier batches resolved — never a 500.

**Vercel toolbar.** Echoes installs no `@vercel/analytics`, `@vercel/speed-insights` or
`@vercel/toolbar` package (verified in `package.json` and across `src/`), and `layout.tsx` injects no
third-party script — the only `document.createElement("script")` is the Spotify Web Playback SDK.
The preview toolbar that logs `Missing param(s) [teamSlug]` is injected by the hosting platform, so
`next.config.ts` sets the documented `VERCEL_TOOLBAR_DISABLE=1` (also in `.env.example`) rather than
patching the document or silencing the console.

---

## 4k. Sequential startup — how the 503s were removed

The 503s came from the startup fan-out: six Spotify endpoints fired through `Promise.all` on a cold
cache, on top of detail and feature batches from other components. Two structural changes replace
that.

**A single serial lane.** `enqueueSpotify()` in `lib/spotify/client.ts` puts *every* metadata call —
library lists, playlist pages, artist/album/track detail, audio-feature batches, lazy history — into
one queue with a **140 ms minimum spacing**. `spotifyFetchSerial()` is the wrapper those paths use.
Parallel fan-out is now impossible no matter how many components ask at once. Playback commands
deliberately bypass the lane: they are user-initiated, low-volume, and must never wait behind a
metadata batch.

Measured: 6 calls dispatched simultaneously → **max concurrency 1**, gaps of exactly 140 ms, total
768 ms; 25 components asking at once → still **max concurrency 1**; a rejected call does not break
the chain (survivors still run).

**Sequential, lazy startup.** The server fan-out is now an ordered `await` chain rather than
`Promise.all`, ordered by usefulness:

| Order | Endpoint | When |
| --- | --- | --- |
| 1 | `GET /me/playlists?limit=50` | startup (skipped once hydrated) |
| 2 | `GET /me/tracks?limit=50&offset=0` | startup, skipped when `echoes.saved.v1` is hydrated |
| 3 | `GET /me/top/tracks?limit=20` | startup |
| 4 | `GET /me/top/artists?limit=10` | startup |
| 5 | `GET /me/player/recently-played?limit=50` | **lazy** — never at startup |
| 6 | `GET /me/player` | startup (device + current item) |

History is always excluded from startup (`skip=recent`) and fetched by `loadRecent()` only when Home
or Activity mounts **and** `localStorage` is empty — one request via `GET /api/spotify/recent`, with
a direct browser fallback. A transient failure does not mark the store hydrated, so the next visit
retries; a real result is persisted and every later visit costs 0 requests.

The direct browser fallback path (used when the proxy is unreachable) is sequential for the same
reason: that path exists *because* something already failed, so hammering Spotify in parallel is the
wrong move.

Scopes for these calls: `playlist-read-private`, `playlist-read-collaborative`, `user-library-read`,
`user-library-modify`, `user-read-recently-played`, `user-top-read`, `user-read-playback-state`.
Liking and unliking go through `PUT`/`DELETE /v1/me/library?uris=spotify:track:<id>` in batches of
40, never the removed `/me/tracks` endpoints.

---

## 4l. Saved-songs pagination and global entity links

**Pagination.** `GET /v1/me/tracks` is walked by one shared helper,
`collectPages()` (`lib/spotify/paginate.ts`), used by *both* the server startup fan-out and the
client's lazy `loadSaved()` so the two cannot drift. It requests `offset=0, 50, 100…` and stops on
the first of:

| Condition | `stopped` |
| --- | --- |
| (a) the page returned fewer than 50 rows | `short-page` |
| (b) `next` is null | `no-next` |
| (c) 500 tracks collected (hard safety cap) | `cap`, `truncated: true` |
| a page threw (503, network) | `error` — earlier pages are **kept**, not discarded |
| `maxPages` ceiling (12) | `max-pages` |

The complete combined list is written to `localStorage` under **`echoes_saved_tracks`** (the previous
`echoes.saved.v1` key is migrated transparently), and the store cap was raised from 400 to 500 to
match. Every page goes through the 140 ms serial lane, so a 500-track library costs 10 spaced
requests rather than a parallel burst.

Measured: 120-track library → **120 in 3 pages**, offsets `0,50,100`, `short-page`; a full page with
`next=null` → **50 in 1 page**, `no-next`; 5000-track library → **500 in 10 pages**, `cap`,
`truncated`; empty → `empty`; a failure on page 3 → **100 kept**; skipped rows (episodes) do not
consume the cap; `maxPages=3` → 150 items, `max-pages`.

**Global links.** `EntityLink.tsx` exports `ArtistLink` (→ `/artist/[id]`), `AlbumLink`
(→ `/album/[id]`) and `BackLink`. They are now used in `TrackRow` (title, album column, primary
artist), the **Now Playing panel** (track title, primary artist under it, the album chip, the artist
frame name and the Up-next rows), the sidebar's now-playing tile and up-next list, and Home's "In
rotation" artist cards — on top of the album and artist pages themselves.

Each link calls `stopPropagation()` so clicking a name inside a track row never also starts playback,
and `usePathname()` short-circuits when the target *is* the current route: the component renders a
plain `<span>` instead of a `<Link>`, so there is no redundant navigation, no page remount and no
re-fetch. Links degrade to plain text when the id is unknown (demo catalog, or a simplified object
Spotify did not expand).

Deliberate exception: the Home "recently played" rail cards, hero sleeves and Activity log rows are
whole-card `<button>` elements. Nesting an `<a>` inside a `<button>` is invalid HTML and breaks
keyboard semantics, so those surfaces stay play-only rather than shipping broken markup.

---

## 4m. Artist page without `/top-tracks`, and multi-artist links

**`GET /v1/artists/{id}/top-tracks` is not called anywhere** — it was removed for Development Mode
apps in the Feb 2026 migration and was the source of the artist-page 503. `/artist/[id]` is now built
from two release-derived sections:

| Section | Source |
| --- | --- |
| **A. Popular / Newest Tracks** (≤10) | `GET /v1/artists/{id}/albums?include_groups=album,single&market=from_token&limit=10`, then `GET /v1/albums/{album_id}/tracks` for the newest releases until 10 tracks are assembled (album object re-attached to each row, since album track rows omit it) |
| **B. Appears On / Related** (≤30) | `GET /v1/artists/{id}/albums?include_groups=appears_on&market=from_token&limit=10`, then each release's tracks, keeping only rows whose `artists` include this artist id — compilation rows the artist is not actually on are dropped |

Album-track calls are bounded (≤5 for A, ≤6 for B) and run through the serial lane, then one batched
`/audio-features` call covers every track on the page. A refused endpoint is recorded in `degraded`
and shown as `partial · albums` rather than failing the page. Section B has a **live client-side
search** above the list filtering by title, album or artist with zero requests, plus match counts and
a clear-filter state.

**Multi-artist links.** `ArtistLinks` renders *every* credited artist as its own `/artist/[id]` link,
using structured `artistList` credits when Spotify supplied them and falling back to splitting the
display string (paired with `artistIds` by position) so demo tracks still render all names as text.
It is used in `TrackRow` (so every list inherits it) and under the Now Playing panel's track title.
The panel's featured 16:9 card and "About the artist" block still honour **only `artists[0]`**, as
before. `ArtistLink` short-circuits to a plain `<span>` when its target is the current route, so
clicking the artist you are already viewing cannot re-mount the page or re-fetch.

---

## 4n. Playback stability and sidebar navigation

**Providers never unmount.** The auth session, `LibraryProvider`, `PlayerProvider` (and therefore the
Web Playback SDK instance) live in `src/app/(app)/layout.tsx`. Every page — `/`, `/album/[id]`,
`/artist/[id]` — is a child of that route group, and Next.js preserves a shared layout across
sibling navigations, so clicking through to an album and back cannot tear down the player or stop
audio. This is the correct place for them rather than `src/app/layout.tsx`: the root layout must stay
a server component to export `metadata`/`viewport` and to load fonts, and nothing outside the group
renders player UI.

**Three guards, extracted as pure functions** (`lib/playback/rules.ts`) because each one was a
source of the reported instability:

| Rule | Fixes | Behaviour |
| --- | --- | --- |
| `shouldAdoptRemoteTrack` | random song switching | A `/me/player` poll may **not** move us to a different track while a manual command is inside its optimistic window — that poll is the *pre-command* state arriving late. Metadata for the same track still merges, so artwork and BPM keep improving. |
| `isNaturalEnd` | hijacked transitions | Distinguishes a track ending by itself (SDK `paused` with the playhead at the end of the **same** track) from a user pause (playhead mid-track). Only the former triggers auto-advance, once per track. |
| `shouldRunEndWatchdog` | random recommendations | The progress-based continuation timer is **disabled entirely when the Web Playback SDK is the active device** — the SDK continues natively and reports the end, so a timer could only swap in an unrelated recommendation. It runs only when controlling another device, arms at `duration − 250 ms`, waits 4 s, and re-checks that nothing changed and no command is in flight. |

All 21 cases are unit-tested against the shipped module, including the boundaries (pause at 40 % vs
1.2 s before the end; watchdog armed at `duration − 250` but not `− 251`; double-fire prevention).

**Sidebar navigation works from any route.** The four browse sections are rendered by
`(app)/page.tsx`, which is *not mounted* on `/album/[id]` or `/artist/[id]` — so `navigate()` used to
set state that nothing was listening to, which is exactly why the sidebar appeared locked and the
Back button was the only way out. `navigate()` now sets the section state **and** calls
`router.push("/")` when the current pathname is not already `/`, so Home, Playlists, Saved, Activity
and every pinned playlist navigate immediately from an album or artist page. When already on `/` it
is a pure state change with no history entry, and `push` (not `replace`) keeps Back returning to the
entity page. Playback is untouched throughout, because the layout — and the player inside it — never
unmounts.

---

## 4o. Customization: palettes, dual fonts, experimental glass

`lib/design.ts` is the registry; everything persists in `localStorage` and repaints through CSS
custom properties, so a change never re-renders a React tree.

**Custom palettes** (`echoes_custom_palettes`) — 2 to 5 colours plus a name, rendered in the same
grid as the four presets (including Album Art Sync) and selectable, switchable and deletable.
Validation: a name is required, fewer than 2 colours is rejected, more than 5 is clamped, and
invalid hex values are dropped rather than stored. Deleting the palette currently in use falls back
to Deep Cosmic so the UI is never left pointing at nothing. Any length collapses onto the three
accent slots the CSS expects (`toTriad`: 2 → `[a,b,b]`, 3 → direct, 4–5 → first/middle/last), and
`resolvePalette()` handles presets, customs and artwork-sync through one path — an unknown or deleted
custom id falls back safely instead of throwing.

**Dual font selector** — 33 faces across five kinds (clean/minimal, wide, futuristic, mono, display),
including every family requested: Montserrat, IBM Plex Mono, Inter, Orbitron, Space Grotesk, Syne and
Cabinet Grotesk (the last from Fontshare, since it is not on Google Fonts). **Font 1** drives
`--font-sans` (song titles and body), **Font 2** drives `--font-display` (headings and hero). Both
pickers are custom liquid-glass dropdowns — a native `<select>` cannot render each option in its own
typeface — showing **six rows at a time** with a thin custom scrollbar, grouped by kind with sticky
headers, a filter field, and each name plus an `Aa 123` sample set in the actual face. Choices persist
in the preferences store.

Font loading is two requests (`GOOGLE_FONTS_URL` covering 29 families with verified weights, and one
Fontshare URL); the CSS is small and the binaries stay lazy per unicode-range, so the cost is paid
when a face is actually rendered — which the picker preview does deliberately.

**Blur 2–50 px** (was 10–50), still one `--glass-blur` property driving every surface, with a new
"Crisp" preset at 4 px alongside Frosted / Liquid / Deep.

**Experimental Liquid Glass** (default **off**) unhides a **Distortion Length** slider, 25–200 %
(default 100 %), mapped to `feDisplacementMap` scale `round(18 × pct/100)` → 5 / 9 / 18 / 27 / 36 and
clamped at both ends. `LiquidGlassFilter` renders one **static** (non-animated, so zero per-frame
cost) `feTurbulence` + `feDisplacementMap` filter at the root, and `:root[data-liquid="on"]` applies
`backdrop-filter: url(#echoes-liquid-glass) blur(var(--glass-blur)) saturate(185%)` to `.glass`,
`.glass-thin` and `.glass-card` — every surface that used standard glass. The filter touches the
**backdrop only**, so text and artwork inside panels stay crisp. Chromium honours the `url()`
reference; a `@supports not` fallback raises blur, saturation and edge highlights elsewhere so the
mode is still visibly different rather than silently inert.

All four settings (blur, distortion, palette, fonts) are mirrored to Postgres and restored on boot,
with `localStorage` winning when it is newer.

---

## 4p. Blur consistency and playback stability

**One blur value, both modes.** The slider writes `--user-blur-val` (2–50 px) and every panel,
sidebar and dropdown resolves `backdrop-filter: blur(var(--user-blur-val))` plus the matching
`-webkit-` prefix. `.glass`, `.glass-thin` and `.glass-card` all use the **exact** value — the
per-surface multipliers were removed, because a 50 px setting that rendered as 27 px on a dropdown
was not "consistent". Only chips and scrims keep a fraction (a full-strength blur smears a 9 px
badge and a modal scrim is not a panel).

Experimental Liquid Glass **OFF** → `blur(var(--user-blur-val))` alone. **ON** → the same blur term
**and** `url(#echoes-liquid-glass)` in one declaration, so the slider means the identical thing in
both modes and the refraction is additive rather than a replacement. At 2 px the pane is near-clear
(`--glass-tint` is 0 % there) precisely so the distortion is visible.

Startup is flash-free: an inline, dependency-free script in `<head>` reads `echoes.prefs.v1` and
applies blur, tint, both font stacks and the `data-liquid` / `data-motion` flags **before first
paint**. React's provider then writes the same properties, so a change is instant and a reload never
shows the defaults first.

**Playback stability.**

* *Silent session guard* — background polls log at `info` and return; they never set
  `transportError`, never raise the device panel, never pause audio and never clear the active track.
  Only user-initiated commands may surface an error.
* *No track change without an id change* — `shouldAdoptRemoteTrack` still blocks a poll from moving
  to a different track inside the optimistic window, and `mergeTrack` returns the same object when no
  rendered field changed, so a poll for the same track cannot cascade a re-render.
* *Transient failures recover instead of stopping* — on 401/503/rate-limit a command is caught,
  `GET /api/spotify/session` is called to refresh the token (adopting any rotated pair from
  `x-echoes-access-token`), and the **same command is retried once** after 500 ms. Audio is not
  paused and the track is not cleared at any point.
* *Automated transitions are background work* — auto-advance marks its command `background`, so a
  failure logs and returns silently rather than surfacing a banner mid-transition.
* *Reconciliation stands down while a transient failure is unresolved* — the reconcile timers are
  replaced by a single delayed sync, and `applyRemote` refuses to adopt a remote `paused` state that
  contradicts a locally playing track during an outage. A healthy poll clears the flag, so normal
  reconciliation resumes by itself.
* *Navigation never interrupts audio* — `PlayerProvider` is instantiated in exactly one place,
  `src/app/(app)/layout.tsx`, and every page (`/`, `/album/[id]`, `/artist/[id]`) is a child of that
  route group. Next.js preserves a shared layout across sibling navigations, so the Web Playback SDK
  instance and its audio element are never unmounted. Verified: no other file constructs the
  provider.

---

## 4q. Blur decoupling and hydration safety

**Blur is unconditional.** `backdrop-filter: blur(var(--user-blur-val, 26px))` sits on the base
`glass`, `glass-thin` and `glass-card` utilities with **no `[data-liquid]` gating whatsoever** — a
grep of `globals.css` finds zero `data-liquid` selectors, all of which live in the runtime-injected
experimental stylesheet. So:

* Experimental **OFF** → `blur(X)` alone, X from the slider.
* Experimental **ON** → `url(#echoes-liquid-glass) blur(X) saturate(185%)` — the *same* blur term
  plus the refraction, never instead of it.

Every one of the 11 blur references now carries a `26px` fallback. That matters: if the variable is
ever unset (a blocked inline script, a CSP, an early JS error) an un-fallbacked `var()` makes the
whole `backdrop-filter` declaration invalid and the browser drops it — no blur at all, which reads
exactly like "the slider only works sometimes". With the fallback the surface is still correctly
blurred.

**Hydration error #418.** Two independent causes, both fixed:

1. *Render-time `localStorage` reads.* `preferences`, `nav` (panel visibility) and `columns` all
   initialised state from `localStorage`, so the client's first render disagreed with the server's.
   Each now starts from the compiled default and applies the stored value in a post-mount effect —
   one-time, idempotent, and the exact `mounted` pattern requested. `HomeView`/`SavedView` read the
   history and saved stores inside `useMemo`, but they only mount behind the client-only auth gate,
   so they never participate in hydration.
2. *The pre-paint boot script mutated `<html>`.* It set inline custom properties **and**
   `data-liquid` / `data-motion` on `document.documentElement` — an element React owns and hydrates,
   so those extra attributes were themselves a mismatch. It now injects a
   `<style data-echoes-boot>` element containing a `:root{…}` block instead. A script-inserted
   stylesheet is entirely outside React's tree, so the values still apply before first paint with
   nothing to mismatch. The two `data-*` flags are left to the preferences provider, which sets them
   after mount.

There is still no flash of defaults: blur, tint and both font stacks arrive from the injected
stylesheet before paint, and only the drawer's displayed numbers settle a tick later.

---

## 4r. v3.0.0 — Liquid Glass defaults and taste-based search

**Visual standardisation.** "Experimental Liquid Glass" is now simply **Liquid Glass** and defaults
to **on**; the default backdrop blur is **5 px** (near-clear, so the static refractive displacement
reads immediately). The defaults are consistent in all four places that hold them —
`DEFAULT_PREFERENCES`, the Postgres column defaults, the compiled `:root` block and every
`var(--user-blur-val, 5px)` fallback — plus the pre-paint boot script, so a first visit and a cold
cache both land on the same look. Panels, sidebars and dropdowns inherit it through the shared
`glass` / `glass-thin` / `glass-card` utilities; nothing needs to opt in.

**Taste-based search** (`lib/taste.ts` + `hooks/useSearch.ts`). `GET /v1/search?type=track&market=from_token`
runs server-side through the serial lane; ranking runs client-side because that is where the signal
already lives. `buildTasteProfile()` folds local listening history (newest-first, with a 12-item
recency half-life) and Saved Songs (weighted 1.6× — an explicit like beats a passive play) into genre
and artist weights, resolving genres through the **memoised** `artistDetailCache` from
`GET /v1/artists/{id}` calls the Now Playing panel already made. Ranking costs no extra requests.

`scoreTrack()` returns a raw score, a 0–1 relevance and the genres that fired, which the UI surfaces
as a subtle "because you like …" chip. Verified: same genre + same artist **17.58** (relevance 0.98)
> saved-artist genre **7.52** > shared genre, new artist **4.25** > unrelated **0.00**; empty taste,
unknown artists and album-genre fallbacks all behave; ties preserve Spotify's original order.

**Interaction.** The header input debounces at **300 ms** from the **second character**, guards with a
request id so a slow response can never overwrite a newer query, and opens a liquid-glass dropdown of
**five** tracks: cover left, title right, all credited artists as `/artist/[id]` links beneath in
grey. Hovering a cover darkens it and reveals a play triangle; clicking it plays immediately through
the universal handler, which updates the player bar, the Now Playing panel and listening history.
Keyboard: ↑/↓ move the highlight, `Shift+Enter` plays it, `Enter` opens `/search?q=…`.

**`/search?q=…`** is a real route inside the `(app)` group — so the player never unmounts while
searching — listing up to **50** taste-ranked tracks in the standard table, where titles link to
`/album/[albumId]` and artists to `/artist/[artistId]`. Development Mode apps are capped at 10
results by Spotify regardless of the `limit`; the UI says "capped by app tier" rather than implying
nothing matched.

**Sidebar navigation** uses real `<Link href="/">` elements (prefetched, so transitions are instant,
and middle/cmd-click behaves) whose `onClick` prevents default and calls `navigate()` — which sets
the section state and calls `router.push("/")` only when the listener is on an album or artist page.
No lockups, no Back button, no refresh.

---

## 4s. v7.0.1 — font defaults, header layout, deterministic queue

**Fonts.** Font 1 (song titles and body) defaults to **Montserrat**; Font 2 (headings and hero)
defaults to **Outfit**. The defaults are set in all four places that hold them — `DEFAULT_PREFERENCES`,
the Postgres column defaults and row, the compiled `@theme` block (`--font-sans` / `--font-display`)
and the pre-paint boot script's fallbacks — so a fresh load, a cold cache and a cleared
`localStorage` all agree. An existing listener's stored choice still wins, because the boot script
and provider read `echoes.prefs.v1` before falling back to any default.

**Header layout.** The title was truncating to "Ho…" because it shared a shrinking flex row with the
search bar. The bar is now `flex-wrap` below `lg` and `flex-nowrap` above it, with explicit
priorities: the title block and the control cluster are `shrink-0` and `whitespace-nowrap` (they can
never truncate), and the search wrapper is the **only** flexible element — `w-full min-w-0` on small
screens, `lg:max-w-md lg:flex-1` above, so it absorbs every width change and stays capped on a
widescreen monitor instead of dominating it. DOM order is title → controls → search on mobile
(`order-1/2/3`) and title → search → controls from `lg` up. The subtitle now hides below `xl` rather
than competing for the same space.

**Zero unsolicited interruptions.** While the Echoes Web Player is the active device and audio is
playing, the SDK is the *only* authority: a background poll may merge metadata for the **same** track
but may never switch tracks or pause. `applyRemote` computes an `ownsPlayback` guard and refuses both
a track change and a `paused` adoption under it. Only an explicit user action — Space, the pause
button, or manually playing another track — can stop playback, and only the post-command reconciler
(which runs on the user's own intent) may adopt a contradicting remote state.

**Deterministic continuation** (`lib/playback/queue.ts`, a pure function). Fired **only** when a track
has finished naturally — the SDK's natural-end signal, or the watchdog when another device is active:

| Started from | Behaviour |
| --- | --- |
| Playlist / Saved / Album / Artist | The **exact next track in that list**. Nothing overrides it. |
| Album, final track | Recommended from the **longest playlist**, unplayed-in-Echoes first |
| Artist page, list exhausted | Same — longest playlist, unplayed first |
| Listening history / Global search | Immediately the longest playlist, unplayed first |
| No playlists | Saved tracks (unplayed first) |
| No Saved | Any catalog track |
| Nothing anywhere | Stops cleanly with reason `exhausted` |

"Longest" is measured by resolved track count, then `trackCount`, then `trackIds.length`, with ties
broken by playlist id so the choice is reproducible. "Unplayed" is the union of the persisted
listening history, the session's played set, and recent auto-plays; when every candidate has been
played it replays rather than stopping (reason `*-replay`). Among unplayed candidates the highest
play count wins with a random tiebreak, and the current track is never re-selected.

Verified: `next-in-list` for all four ordered sources · longest-playlist selection by count and by id
tiebreak · `longest-playlist` on album-final, artist-exhausted, history and search starts ·
`longest-playlist-replay` when all five are played · `saved` / `saved-replay` · `catalog` ·
`exhausted` when every pool holds only the current track · identical output for identical input.
Each decision logs its reason (`continuing after album: longest-playlist`).

---

## 4t. Expanded immersive Now Playing view

A `Maximize2` toggle in the panel header expands the Now Playing view to fill the central content
area, spanning from the right edge of the app to the left sidebar, which stays visible.

**How it stays seamless.** The layout does not unmount anything: the main content column animates to
`w-0 opacity-0 overflow-hidden pointer-events-none` while the panel column animates from `w-[352px]`
to `flex-1`, both on a 700 ms transition. Because the route underneath is still mounted, expanding
and collapsing never refetches a page, never loses scroll position, and — critically — never touches
the providers, the Web Playback SDK or the audio element, so playback continues uninterrupted in both
directions. The expanded state persists in `localStorage` (`echoes.panel.expanded`) with the same
hydration-safe pattern as every other stored preference. The toggle only renders at `xl:` and above;
below that the panel is already a full-height sheet.

**Main section** (left/centre): the high-res cover at 292 px with a coloured bloom and a floating
play/pause control; the track title beneath in the display face at up to 3.4 rem; **every** credited
artist as an individual `/artist/[id]` link in smaller grey type; chips for year, duration, BPM and
key plus a save toggle; the atmospheric visualizer; and an artist card with a circular avatar, name
(linked), genres or bio line, listener count and a **View on Spotify** button.

**Visualizer** (`components/Waveform.tsx`) is pure CSS — 56 bars animated with `scaleY` keyframes and
staggered delays, `animation-play-state` driven by `isPlaying`, so it freezes when paused and costs
no JavaScript per frame. Bar amplitudes are hashed from the **track id**, which makes the waveform
stable for a given song (it reads as that track's shape) instead of flickering on every render, and
it collapses to a static shape under `prefers-reduced-motion`.

**Widescreen balance (27" / 1440p).** The earlier build left a void under the artist card and a
stretched, mostly-empty Next Up card. Fixed on both axes:

* The left column gains an **Artist Discography** section directly under the artist card: a compact
  responsive grid (2 → `md:3` → `2xl:4` columns) of the artist's other releases from the **cached**
  artist page — cover art, release year and release kind (`album_group` / `album_type`, now carried on
  the album entries as `year`). Each item is a `Link` to `/album/[id]`. When the artist page has not
  been cached — notably in demo mode, which has no Spotify artist pages — the grid falls back to
  grouping the library by album for the current artist and plays that group on click, so a large
  screen never shows an empty void.
* Both right-hand lists are now `flex min-h-0` cards that share the column height
  (`flex-[1.25]` / `flex-1`), their lists are `flex-1`, and every row is `min-h-[84px]`
  (`2xl:min-h-[96px]`) **and** `flex-1 h-full`, so rows stretch to fill the card instead of leaving an
  empty interior. Immersive rows are one scale larger: `h-14`→`h-16` covers at `2xl`, `px-3 py-3.5`
  → `2xl:px-4 py-4` padding, 14→15 px titles. Section padding is `p-4` → `2xl:p-6`.
* The hero artwork grows to 348 px at `2xl` and the visualizer to 120 px, so the left column's own
  content reaches the bottom of a 1440p viewport and scrolls only past that.

All new elements inherit the design system untouched: sections are `glass-thin` (5 px default blur,
refraction when Liquid Glass is on), the discography heading is `font-display` (Outfit), body and row
text use `--font-sans` (Montserrat), and the footer keeps printing the live `blur · font1 / font2`
values.

**Sidebar section** (right column):

* **More from this artist** — five other tracks by the current artist, resolved by
  `sameArtistTracks()` from data already in memory: the cached artist page's popular tracks first,
  then resolved playlist pages, then the library. Matching is by artist id, falling back to the
  primary artist's name, and the current track is excluded. **Zero requests.**
* **Next Up** — three tracks from `nextTracks()`, the same pure lookahead that drives auto-advance,
  so the panel can never promise a queue the player will not honour. When playback started from a
  playlist, Saved, an album or an artist page and that list still has entries, it shows the **exact
  next three in sequence**; otherwise it falls back to three recommendations from the user's longest
  playlist, unplayed-in-Echoes first. The header says which (`from this album` vs
  `recommended for you`).

Theme, fonts (Montserrat / Outfit) and the 5 px Liquid Glass blur carry through untouched, because
the expanded view renders inside the same `glass` container and reads the same CSS custom properties
— the footer even prints the live `blur · font1 / font2` values as a check.

Verified: 3-deep lookahead returns `p3,p4,p5` mid-list, continues into the longest playlist at the
end of a list, yields 3 distinct recommendations for a single search track, never duplicates,
degrades to 1 or 0 tracks without crashing, and is deterministic (identical inputs → identical
output, and `nextTracks()[0] === nextTrack()`). `sameArtistTracks` prefers artist-page tracks,
excludes the current track, caps at 5, matches on name when ids are absent, and returns `[]` for a
null track or missing artist info.

---

## 4u. Firebase cloud state and multi-step onboarding

**Firebase** (`lib/firebase.ts`) initializes lazily and **client-only** from `NEXT_PUBLIC_FIREBASE_*`
env vars (see `.env` / `.env.example` — Firebase client configs are project identifiers, not secrets,
but env keeps them out of the source tree). A missing or unreachable Firebase degrades to the
local-first experience instead of breaking the app: `useFirebase()` reports `ready` with
`user: null`, and the onboarding offers the demo path.

Authentication supports **Google** (`signInWithPopup`) and **Email/Password** (sign in and sign up,
with `updateProfile` for the display name). Errors are mapped to human sentences
(`auth/invalid-credential` → "Those credentials don't match an Echoes account.", and so on).

**Firestore mirror** (`hooks/useCloudSync.ts`), document `users/{userId}`:

```
{ prefs: {…all preferences…}, palettes: CustomPalette[], history: EchoTrack[≤100], rev, updatedAt }
```

* On sign-in: if the document exists it is applied (prefs, custom palettes, and — when the local
  history is empty — the stored listening history); if it is empty the local state is uploaded, which
  is the migration path. An `onSnapshot` subscription applies newer revisions from other devices; a
  `rev` we wrote ourselves is ignored, so our own push never bounces back.
* Local changes push after a 900 ms debounce with `rev+1`. Permission or network failures log a
  warning and leave localStorage authoritative — nothing surfaces to the listener.
* localStorage remains the instant, offline cache and the pre-paint source; Firestore is the durable
  cross-device truth. Empty Firestore data falls back to the compiled defaults.

**Onboarding** (`components/onboarding/OnboardingFlow.tsx`) is a two-card animated flow:

1. **Sign in** — Google button and an Email/Password form (sign in / create account toggle), each
   with a spinner while authenticating and an inline error card on failure.
2. **Connect your music platform** — Spotify with a green **Connect** button (spinner while the
   token is verified during the PKCE round trip), plus Apple Music, Tidal and YouTube Music as
   grayed-out, disabled **"Coming Soon"** cards.
3. On a successful Spotify connection the platform card slides out and the application slides in
   (the shell's existing mount animation).

Transitions are horizontal slides (60% offsets, 550 ms, the shared easing): step 1 exits left as
step 2 enters from the right. A restored Firebase session skips the auth card; when Firebase is not
configured the flow starts at platform selection. Both cards keep a "demo mode" escape so the app is
never a dead end. Every card is a `glass` surface — 5 px blur, Liquid Glass refraction, Montserrat
body, Outfit headings.

---

## 4v. Logout, deterministic transitions, animation controls, mirrored collapse

**Two distinct exits in the profile menu.** *Disconnect Spotify* clears only the Spotify token
(`auth.logout()`), keeping the Firebase session and cloud profile. *Log Out* is a full sign-out:
`firebase.signOut()`, Spotify token, `clearLocalLibrary()` (history + saved), `replacePalettes([])`
and a preferences reset — then the shell drops back to onboarding **step 1**, because the onboarding
step is now *derived* from `firebase.user` (no state sync, no flash): signed in → platform card,
signed out → auth card.

**Deterministic end-of-track.** Ordered sources (playlist / Saved / album / artist) now send an
explicit `uris` list instead of `context_uri`: a Spotify context auto-advances on its own and would
reorder the queue before our track finishes. `decidePlayPayload()` returns `queue` for any ordered
source even when a `contextUri` is present (verified: playlist/saved/album + contextUri → `queue`;
free-form starts may still use a context). When a track ends naturally in an ordered source, the
player plays **the exact next index in the active list immediately** — no recommendation step, no
fetch — and only falls back to `pickNextTrack()` (longest-playlist recommendations) once the list is
exhausted or the start was free-form (history/search).

**Animations section** in Personalization, synced like every other preference (localStorage +
Firestore): *Cover & media animations* (hover zoom + Ken Burns on covers/avatars, gated in CSS via
`:root[data-covers]` plus a `cover-zoom` class on every `AlbumArt`), *Page transitions* (the shell
mount and the four view wrappers read `pageTransitions` and pass `initial={false}`/`exit={undefined}`
when off), and *UI interaction animations* (profile menu, column menu, font picker, search dropdown,
drawer and panel bodies read `uiAnimations`). All default ON.

**Mirrored collapse.** The expanded/compact bodies now live in an `AnimatePresence mode="wait"`:
expansion enters at `scale .96 → 1` and collapse exits at `1 → .94` on the same easing and duration,
so the cover always *shrinks* on the way out — the previous glitch (compact body mounting into a
still-wide column while the 348 px artwork was unmounted in one frame) is gone. The column width
transition (700 ms) and the body cross-fade (350 ms) now read as one continuous motion.

---

## 4w. Playback engine stability (end-window, pause lock, silent 503)

**Isolated engine.** The SDK state listener and the local progress tracker run behind strict
guards. `applySdkState` returns immediately while a manual pause is active, and ignores track
changes during the 3 s post-transition lock. The 120 ms local clock is the single source of truth
for position; nothing else writes it except an explicit seek.

**End-window polling suppression.** The `/me/player` poll is skipped entirely when the track is
within **30 s** of completion, when the listener has paused manually, or during the post-transition
lock — so no external state can race the final seconds. Completion is detected **strictly locally**:
the local tracker reaching `duration − 0.5 s`, or the SDK reporting `paused` at `≥ duration − 0.5 s`
on the same track (`isNaturalEnd` with `toleranceMs: 500`). Both route into one handler.

**Single deterministic completion.** `handleTrackEnded()` is the only path from "finished" to "play
next": it fires once per track id (`endedForRef`), opens a **3 s lock** (`transitionLockUntil`) during
which no competing trigger — SDK event, watchdog, poll — can move the queue, then calls
`autoAdvance`, which for ordered sources plays the exact next index in the active list. Repeat-track
replays instead of advancing.

**Pause/resume without glitching.** `toggle()` sets `manualPauseRef` synchronously: every incoming
SDK state-change event is ignored until an explicit Play/Resume clears it, so a pause can never be
undone by a late event, and no state re-render can restart the track at 0:00 (the pause lock also
blocks progress overwrites). Resuming clears the lock and the optimistic window covers the command
round-trip.

**Silent 503.** A 503 (or rate limit) is intercepted in `command()`: one transparent retry after a
background token refresh, then a `console.info` and a quiet return — no banner, no uncaught error,
and the active queue index is untouched. Only 404 (no device) and 403 (Premium) surface guidance.
There is no `console.error` anywhere in `src/`.

---

## 4x. Firestore Security Rules & the rules workflow

The complete, deployable rules live in **`firestore.rules`** (source of truth) and are reproduced
below for one-click copying into Firebase Console → Firestore Database → Rules. Deploy with:

```
firebase deploy --only firestore:rules
```

(`firebase.json` points the CLI at the file.)

What they enforce:

* `users/{userId}` — owner-only, shape-validated (`prefs` map, `rev`/`updatedAt` ints, `palettes` ≤ 60,
  `history` ≤ 100). Optional keys validate only when present so `merge: true` writes pass.
* `users/{userId}` main document holds **only** `prefs`/`palettes`/`rev`/`updatedAt`; `validUserDoc`
  now *rejects* any document carrying a `history` array, so history can never be stored as a large
  array there.
* `users/{userId}/history/{historyId}` — one document per play session, validated on write by
  `validHistoryDoc` (requires `trackId`, `title`, `artist`, `timestamp`, `durationPlayedSeconds`,
  `totalDurationSeconds`, `completionPercentage` with correct types and 0–100 completion). Reads are
  owner-only; the Activity `onSnapshot` orders by `timestamp desc`.
* `users/{userId}/playlists/{playlistId}` — the owner's **private** privacy record. Owner always has
  full access; other signed-in users may read only records where
  `resource.data.isPublicInEchoes == true`. This record is what the gear toggle flips; it never
  reflects or depend on Spotify's own public/private flag.
* `community_playlists/{playlistId}` — a **separate, flat collection of published copies**. Readable
  by anyone when `isPublicInEchoes == true`; create/update/delete restricted to the document's
  `ownerUid == request.auth.uid`, with `isPublicInEchoes == true` required on create and the owner
  pinned on update. Deleting (unpublishing) removes the document so it disappears immediately.
* `users/{userId}/{any other subcollection}` — wildcard keeps every other per-user subcollection
  strictly private.
* `catalog/**` and `shared/playlists/{id}` — public read, client writes denied (forward-compatible;
  the live catalog lives in Postgres and seeding uses the Admin SDK, which bypasses rules).
* Explicit default-deny everywhere else.

```
rules_version = '2';

// ============================================================================
// Echoes — Firestore Security Rules
//
// SOURCE OF TRUTH: this file. Deploy with:
//     firebase deploy --only firestore:rules
// or paste this whole block into Firebase Console → Firestore Database → Rules.
//
// Keep in sync with:
//   src/hooks/useCloudSync.ts        (users/{userId} document)
//   src/lib/echoesPlaylists.ts       (users/{userId}/playlists/{playlistId})
//
// Privacy model: every Echoes playlist record carries `isPublicInEchoes`
// (default false) which is INDEPENDENT of Spotify's own public/private flag.
// Only that field is ever published; track lists never leave the owner's tree.
// ============================================================================

service cloud.firestore {
  match /databases/{database}/documents {

    // ----------------------------- helpers ----------------------------------

    function signedIn() {
      return request.auth != null;
    }

    // Strict ownership: a user may only ever touch their own document tree.
    function isOwner(userId) {
      return signedIn() && request.auth.uid == userId;
    }

    // Shape validation for users/{userId}. Optional keys are only validated
    // when present, so partial merges (merge: true) always pass.
    function validUserDoc(data) {
      return data.keys().hasAll(['prefs', 'rev', 'updatedAt'])
        && data.prefs is map
        && data.rev is int
        && data.updatedAt is int
        && (!data.keys().hasAll(['palettes'])
            || (data.palettes is list && data.palettes.size() <= 60))
        && (!data.keys().hasAll(['history'])
            || (data.history is list && data.history.size() <= 100));
    }

    // Shape validation for a playlist privacy record.
    function validPlaylistDoc(data) {
      return data.keys().hasAll(['playlistId', 'name', 'ownerUid', 'isPublicInEchoes', 'updatedAt'])
        && data.playlistId is string
        && data.name is string
        && data.ownerUid is string
        && data.isPublicInEchoes is bool
        && data.updatedAt is int
        && (!data.keys().hasAll(['source']) || data.source in ['spotify', 'echoes'])
        && (!data.keys().hasAll(['trackCount']) || data.trackCount is int);
    }

    // ------------------- per-user private state ----------------------------
    match /users/{userId} {
      allow get, list: if isOwner(userId);
      allow create: if isOwner(userId) && validUserDoc(request.resource.data);
      allow update: if isOwner(userId) && validUserDoc(request.resource.data);
      allow delete: if isOwner(userId);

      // -------- Echoes playlist privacy (per-playlist visibility) ---------
      // Owner: always full access. Other signed-in users: READ ONLY, and only
      // when the record is explicitly public in Echoes. Private playlists are
      // unreachable by anyone but the owner.
      match /playlists/{playlistId} {
        allow read: if isOwner(userId)
                    || (signedIn() && resource.data.isPublicInEchoes == true);
        allow create: if isOwner(userId) && validPlaylistDoc(request.resource.data);
        allow update: if isOwner(userId) && validPlaylistDoc(request.resource.data);
        allow delete: if isOwner(userId);
      }

      // Any other current or FUTURE subcollection (preferences/, palettes/,
      // history/, sessions/, …) stays strictly private to the owner.
      match /{subcollection=**} {
        allow read, write: if isOwner(userId);
      }
    }

    // --------------- published community playlists (separate) -----------------
    // A dedicated, flat collection holding COPIES of playlists their owners have
    // published. Readable by anyone when published; only the owner may create,
    // update or delete their own published document. Unpublishing deletes the
    // document, so it vanishes from the community immediately.
    match /community_playlists/{playlistId} {
      allow read: if resource.data.isPublicInEchoes == true;
      allow create: if signedIn()
                    && request.resource.data.ownerUid == request.auth.uid
                    && request.resource.data.isPublicInEchoes == true
                    && validPlaylistDoc(request.resource.data);
      allow update: if signedIn()
                    && request.auth.uid == resource.data.ownerUid
                    && request.resource.data.ownerUid == resource.data.ownerUid
                    && validPlaylistDoc(request.resource.data);
      allow delete: if signedIn() && request.auth.uid == resource.data.ownerUid;
    }

    // ------------------- shared read-mostly catalog -------------------------
    // Provisioned for future shared/public data (the live catalog lives in
    // Postgres; seeding uses the Admin SDK which bypasses rules).
    match /catalog/{document=**} {
      allow read: if true;
      allow write: if false;
    }

    // Editorial playlists published by Echoes: public read, no client writes.
    match /shared/playlists/{playlistId} {
      allow read: if true;
      allow write: if false;
    }

    // ------------------------- default deny ---------------------------------
    match /{document=**} {
      allow read, write: if false;
    }
  }
}
```

### Rules workflow (standing commitment)

Any change that adds, renames or removes a Firestore field, collection or subcollection ships with
(1) an updated `firestore.rules`, (2) the updated block reproduced here and in the reply, and (3) the
`firebase deploy --only firestore:rules` command. No schema change lands without its rules update.

---

## 4y. Echoes playlist privacy & the separate Community page

**Two collections, one source of truth each.** The owner's privacy record lives at
`users/{uid}/playlists/{id}` (`isPublicInEchoes`, default **false**). Publishing writes a **copy** to
`community_playlists/{id}` with `isPublicInEchoes: true` and `ownerUid: auth.uid`; unpublishing
**deletes** that document and drops it from local community state in the same tick. Spotify's own
public/private status is never read or written anywhere in this flow.

**`/playlists` stays private.** It shows only the user's library, each owned card carrying a
private/public badge and a **Settings gear** whose liquid-glass dropdown holds the **"Public in
Echoes"** toggle (default OFF) with a note that Spotify visibility is ignored. A header button
**"Show Community Playlists"** navigates to the dedicated route; nothing community-related is mixed
into this page.

**`/community-playlists`** is its own route: Font 2 (Outfit) heading "Community Playlists", Font 1
(Montserrat) gray subtitle with the exact publish instructions, skeletons while loading, and the
empty-state card "No community playlists published yet. Be the first to share one!" It queries only
`community_playlists` where `isPublicInEchoes == true` and renders display-only glass cards (cover,
name, description, track count, owner, "public" badge). All cards, toggles and dropdowns use the
shared glass utilities and the `--font-sans` / `--font-display` variables, so they inherit the 5 px
Liquid Glass blur, Montserrat body, Outfit headings and the UI-animation gates automatically.

---

## 4z. Auth exits, live privacy UID, and one dropdown recipe

**Log Out vs Disconnect Spotify.** The profile menu's two exits route to different onboarding
steps via a parent-held `onboardStep`:

* **Disconnect Spotify** → `onRequestOnboardingStep("platform")` + `auth.logout()` (Spotify token only).
  The Firebase session survives and the user lands on **step 2** (Connect Your Music Platform).
* **Log Out** → `onRequestOnboardingStep("auth")` + `firebase.signOut()` + `auth.logout()` +
  `clearLocalLibrary()` + `replacePalettes([])` + preferences reset. Every local and cloud artifact is
  cleared and the user lands strictly on **step 1** (Google / Email+Password). Internal step
  navigation ("Back to sign in", "continue") clears the override via `onStepHandled`.

**Live privacy UID.** `PlaylistPrivacyMenu` reads the active Firebase user from the auth context
(`firebase.user?.uid`) rather than any snapshot, so the "Public in Echoes" toggle is enabled the
moment authentication resolves and publishes to `/community_playlists` with that UID as owner.

**One dropdown recipe.** Every popover (profile menu, column customizer, font picker, search
results, playlist privacy) now uses the single `glass-dropdown` utility: blur from
`--user-blur-val`, refraction from `[data-liquid]`, radius/border/shadow from the utility. All
per-component hardcoded backgrounds, blurs and `--glass-lift` overrides were removed, so dropdowns
match the rest of the glassmorphism UI and respond to the Personalization blur/theme settings.

---

## 4aa. Deep fixes: queue lock and the real blur root cause

**Playback: Echoes owns the queue end-to-end.** Every list play now sends **only the selected
track's URI** (`decidePlayPayload` returns `single` for ordered sources), so Spotify never
auto-continues into its own order and cannot race our queue. A strict **queue lock** then governs
remote state: once Echoes is playing, `/me/player` and SDK events may update progress, volume and
device, but a *different* track is adopted only when it is the track an explicit command expected
(`expectTrackRef`, 4 s window) or when nothing is playing yet. Everything else is ignored outright.

Completion has exactly one source per mode: in **demo** the local tracker reaching
`duration − 0.5 s`; in **Spotify** the SDK's own `paused` at `≥ duration − 0.5 s` on the same track.
The local clock never advances the Spotify queue on its own. `handleTrackEnded()` fires once per
track and is the only path to the next track; the longest-playlist recommendation runs only when the
active queue is genuinely empty and the track finished naturally.

**Blur: the transparent-dropdown root cause was `backdrop-filter: url(#…)`**, which Chrome does not
support — the whole declaration was dropped, leaving dropdowns unblurred and "transparent". All
`url()` references are removed from `backdrop-filter`; blur now comes solely from
`backdrop-filter: blur(var(--blur-intensity, 5px))`. The provider and the pre-paint boot script both
write `--blur-intensity` (with `--user-blur-val` / `--glass-blur` aliases). Dropdowns use the same
`glass` utility as every other container (the separate `glass-dropdown` recipe was retired), so
they inherit the user's blur exactly.

**Liquid Glass OFF** now removes the glass treatment entirely: `:root[data-liquid="off"]` sets
`backdrop-filter: none`, no background gradient, and a clean solid `#14161d` surface with a simple
border/shadow — panels never read as broken transparency. ON keeps blur + saturation plus the
ambient SVG displacement in the background (real refraction on panel backdrops is not expressible in
Chrome, so panels get layered highlights instead of an invalid `url()` filter).

---

## 4ab. Always-on Liquid Glass and the transition lock

**Liquid Glass is always on.** The on/off toggle is gone from Personalization; the provider always
sets `data-liquid="on"` and the `[data-liquid="off"]` solid-fallback rules were removed. The
Distortion Length slider remains to tune the refraction.

Every dropdown (profile menu, column customizer, font picker, search results, playlist privacy) now
uses the dedicated `glass-menu` utility: an **opaque dark base** (`rgba(15,18,26,0.82)`, i.e. a
slate-900-ish layer at 82%) under `backdrop-filter: blur(var(--blur-intensity, 5px)) saturate(160%)`,
plus the glass border and layered shadows. No menu can render as a plain transparent or unstyled
white box, and all of them follow the user's blur slider.

**Transition lock (double-play / 503 fix).** Track changes now commit in a strict order inside
`startPlayback`: (a) all UI state first — queue, index, live track, artwork, progress 0:00, playing —
then (b) after a commit tick, exactly **one** play request. A `transitionRef` lock drops any duplicate
play call for the same track while a transition is in flight (a different track supersedes), and
`handleTrackEnded` ignores stray end events mid-transition. `isTransitioning` is exposed on the
player context and lights the play-button spinner alongside `isBuffering`, so the UI never shows a
stale state during the hand-off.

---

## 4ac. Pause hard-lock and single-timer tracking

**Hard pause lock.** `manualPauseRef` (set by an explicit Pause/Space) now discards *every* SDK
callback (`applySdkState` returns immediately), skips the poll loop, and blocks `reconcileIntent`
entirely; pausing also clears all reconcile timers. The player resumes or changes tracks only on an
explicit Play / Next / Previous / track selection.

**Single-timer tracking.** The competing 4 s completion watchdog was removed. Completion is detected
by exactly one source per mode: the local clock at `duration − 0.5 s` (demo) or the SDK's
paused-at-end on the same track (Spotify). The per-transition commit is now generation-guarded
(`transitionGenRef`) and any orphaned commit timeout from a previous track is cleared when a new
track starts, so a stale callback can never fire mid-song and re-play an old track.

---

## 4ad. Fluid responsive scaling and UI Scale

**Fluid dimensions.** Rigid pixel sizes on covers, rows, cards and list heights were replaced with
`clamp()`/`vw`/`vh` so layouts breathe from 13" laptops to 4K: immersive artwork
`clamp(168px,17vw,344px)`, atmosphere card `min-h clamp(112px,13vh,196px)`, waveform
`min-h clamp(76px,10vh,152px)`, discography grid `repeat(auto-fill, minmax(clamp(118px,9vw,196px),1fr))`,
right-column rows `min-h clamp(66px,7.5vh,132px)`, MiniRow covers `clamp(44px,3.4vw,78px)`, track-row
covers `clamp(34px,2.4vw,54px)` with album column `clamp(120px,11vw,240px)`, playlist/rail/community
covers on `vw` clamps, hero sleeves `clamp(158px,14vw,282px)`, and the compact Now Playing column
`w-[clamp(300px,20vw,460px)]`.

**UI Scale slider.** Personalization → "Interface scale": 50–150 %, step 5, default 100, with
presets mapped to their *visual output*: **Compact = 125 %** (bigger elements, condensed content),
**Default = 100 %**, **Large / Airy = 85 %** (smaller elements, more open real estate). The value binds to `--echoes-ui-scale` (written by the provider and
the pre-paint boot script) and is applied by the `ui-scale-root` utility on the shell wrapper:
`zoom: var(--echoes-ui-scale)` with the wrapper box divided by the scale
(`width: calc(100vw / var(--echoes-ui-scale))`, `height: calc(100dvh / var(--echoes-ui-scale))`) so
the zoomed UI still fills the viewport exactly. `zoom` scales every descendant — px, rem and
vw-based alike — and reflows layout correctly, so buttons, text, cards, sidebar, topbar and dropdowns
all scale together. Because it is a layout-level scale, Liquid Glass blur, Montserrat body, Outfit
headings and all UI animations are untouched and preserved at every scale. The value lives in
`prefs.uiScale`, so it syncs to Firestore `users/{userId}` with every other preference.

---

## 4ae. Autoplay — smart similar-track continuation

**Algorithm** (`lib/playback/recommend.ts`, pure + deterministic). Seeds are the last six played
tracks plus the current one; `buildSeedProfile()` aggregates artist ids/names, genres, and mean
BPM/energy/valence. `scoreSimilarity()` weights: shared artist id +6 per overlap (else primary-name
match +4), shared genre +3 (album-genre +2), BPM within 8 → +3 / within 16 → +1.5, energy proximity
+2·(1−|Δ|), valence +1·(1−|Δ|), a mild popularity nudge, and a **hash-based jitter** (stable per
track id, so repeated generation cannot reshuffle the queue behind the player). Verified ranking:
same artist+genre+close BPM 15.31 > shared genre 9.24 > same artist/far BPM 7.84 > unrelated 1.31;
identical inputs give identical order.

**Flow.** While a track plays, a tick-evaluated trigger (`maybeAutoplay`) fires once per track when
~45 s remain and fewer than 3 unplayed items remain in the queue: `generateAutoplayBatch(5)` builds
the pool from data already held (catalog + cached playlist pages + cached artist-page tracks),
ranks it, and only when the pool is thin does it silently ask `GET /search?q=artist:"…"` (10 results,
caught and logged at info on failure). Appended tracks carry `auto: true` and land in the queue
*before* the current track ends, so the end-of-track path is the ordinary "next in queue" path — no
gap, no second play call, no 503 collision, and nothing ever touches the current track or index.

**Queue-extension trigger (v7.3 fix).** The background fetch fires when (a) exactly **one track
remains after the current one**, or (b) the current track **is the final one and is within 30 s of
its duration** — early enough to append seamlessly. The rule is a pure, unit-tested helper
(`shouldPrefetchAutoplay`, 8/8 cases). An `isFetchingAutoplay` flag (`fetchingAutoplayRef` + `autoplayFetching` state)
guarantees exactly one in-flight recommendation call per queue-end sequence (plus the per-track
`genForRef` guard, reset whenever the user starts a new queue). With Autoplay OFF the player stops
naturally at an empty queue. The "Next Up" lists (compact panel + Expanded view) update the moment
tracks are appended and show a "finding similar tracks…" row while fetching; appended rows carry the
**autoplay** badge.

**Toggle.** A Sparkles button next to Shuffle/Repeat plus a Personalization → "Playback" toggle, both
writing `prefs.autoplay` (default **ON**) which syncs to Firestore `users/{userId}` like every other
preference. When OFF, `autoAdvance` stops playback at the end of the queue instead of recommending.

**Visuals.** Auto-appended rows show a subtle **autoplay** badge in the compact panel's Up Next list
and in the Expanded view's Next Up / More-from-artist rows (MiniRow). Everything keeps the glass
utilities, Montserrat/Outfit type and the playback locks (pause lock, queue lock, transition lock
all still gate the recommender: `maybeAutoplay` returns immediately while paused or mid-transition).

---

## 4ah. Dual authentication & spam-free history

**Dual authentication.** The app shell opens only when **both** a Firebase user and an active,
correctly-mapped Spotify connection exist (`dual`), or an explicit local demo entry is active.
`useAccountLink(firebaseUid, spotifyUserId)` writes `spotifyId` into `users/{uid}` on the first
dual-auth session and reports `mismatch` when a different Spotify account appears for the same
Firebase user — which forces onboarding step 1 (derived, no effect-driven resets). Spotify-only
sessions never enter: onboarding shows "Your Spotify session is active but not linked to an Echoes
account", and `LibraryProvider enabled={entered}` blocks all data fetching until a session exists.

**Single-document history, seek-safe playtime, +1 play per 30 s.** History is ONE document per track
per user at `/users/{uid}/history/{trackId}` (the id IS the trackId, so duplicates are impossible).
`durationPlayedSeconds` accumulates WALL-CLOCK time spent playing — seeking never inflates it — and
`playCount = floor(durationPlayedSeconds / 30)` is recomputed on every write, giving a clean
anti-cheat rule (+1 play per 30 s of real listening, never per click). The document is created at
playback start, updated in place (throttled to 10 s), and force-written on track change / pause /
finish. The writer's identity depends only on `uid`; base values (prior playtime/playCount/
firstPlayedAt) are read once per track transition, so effect churn can never mint duplicates. The
feed ranks Top Tracks by `playCount` and shows `N plays · Xm Ys` per row.

**No account cross-matching.** The Firebase/Spotify link is informational only: any Spotify account
may connect or switch freely and simply overwrites `users/{uid}.spotifyId`. Entry to the app is
governed solely by "Firebase user present AND Spotify connected" (or an explicit local demo entry);
if either is missing the user is routed to onboarding.

---

## 4ag. Firebase initialization (`src/lib/firebase.ts`)

Initialized once at module scope with the project's public client config — read from
`NEXT_PUBLIC_FIREBASE_*` when present, otherwise the shipped `webify-ff374` config, so a missing env
var can never break initialization ("Could not reach Firebase" from a missing config is impossible).

* `export const auth = getAuth(app)` and `export const db = getFirestore(app)` are explicit
  singletons, so components can sign in and write to Firestore directly. The existing lazy helpers
  (`firebaseApp()`, `firebaseAuth()`, `firebaseDb()`) remain as never-rejecting promise wrappers for
  compatibility with `historyService`, `useCloudSync` and `echoesPlaylists`.
* Analytics is guarded: `getAnalytics(app)` is invoked only inside `typeof window !== 'undefined'`,
  via a dynamic `import("firebase/analytics")` with `isSupported()` and a caught rejection, so SSR
  never evaluates it and no unhandled promise rejection can escape the module.
* Nothing in the module throws at import time: config falls back rather than throwing, and all
  async helpers resolve instead of rejecting, so the app always connects to Auth/Firestore.

---

## 4af. Activity — isolated history service, live feed and analytics

**Architecture (refactored from scratch).** History lives in one self-contained service,
`src/services/historyService.ts`, whose only dependencies are `lib/firebase` and `lib/types`
(verified: no import cycles anywhere in `src/`). It exposes:

* `logTrackPlayback(userId, trackData, {startedAt, playedSeconds})` — fire-and-forget `setDoc(…, {merge:true})`
  into `/users/{userId}/history/{trackId}_{startedAt}`, wrapped in try/catch, returns a boolean, never
  throws and never blocks playback.
* `subscribeHistory(userId, onData, onError)` — resilient `onSnapshot` over
  `/users/{uid}/history` ordered by `timestamp desc` (limit 150); returns an unsubscribe function and
  reports listener errors via callback instead of throwing.
* Pure, null-safe analytics: `computeMetrics(entries, cutoffMs)` handles empty/null feeds and returns
  plays, total seconds, mean completion and a repeat-ranked Top-Tracks list; `periodCutoff()` backs the
  **[24h] [7d] [30d] [All Time]** filter; `relativeLabel()` / `formatListenDuration()` format rows.

`hooks/useHistoryLogger.tsx` is a thin, non-blocking bridge: all hooks at the top, one memoised
writer, and writes at three moments — **the instant playback starts** (PLAYING transition or the
playhead crossing the first second, so the entry exists at second zero and pops to the top of the
Activity feed with no refresh), **every 5 s while playing** (throttled live `durationPlayedSeconds`
/ `completionPercentage`), and on pause/track-change to finalise completion. All updates merge into
the single `trackId_startedAt` document, so the feed row updates live rather than duplicating. `ActivityView` is
self-contained: hooks strictly first (no early returns above them), a single `useEffect` owns the
snapshot listener and tears it down on unmount, metrics are `useMemo` over null-safe helpers, and
signed-out users fall back to the local Postgres log so the page is never empty.

Visuals unchanged: 5 px Liquid Glass (`--blur-intensity`), Outfit headings / Montserrat body, and
responsive `clamp()` scaling on every card, rank and counter. Firestore rules already cover
`users/{uid}/history/**` via the owner-only `users/{userId}/{subcollection=**}` wildcard.

---

**Continuous logging** (`hooks/useHistoryLogger.tsx`, mounted app-wide). While signed in, every play
session writes one document to `/users/{userId}/history/{trackId}_{startedAt}` with `trackId`,
`title`, `artist`, `albumArt`, `genre`, `timestamp`, `durationPlayedSeconds`,
`totalDurationSeconds` and `completionPercentage`. The same document is merged in place every 10 s
while playing and finalised on track change or pause — fire-and-forget writes that never touch the
playback path. The id is deterministic per session, so updates overwrite rather than duplicate.

**Live feed** (`hooks/useFirestoreHistory.ts`): an `onSnapshot` listener on `/users/{uid}/history`
ordered by `timestamp desc` (limit 150). New or updated documents re-render the feed instantly, with
relative labels ("Just now", "5 mins ago"). When signed out, the page falls back to the local
Postgres log so it is never empty. The header shows a live indicator (`live · synced with
Firestore` vs `local listening log`).

**Analytics with period filter.** A segmented glass bar offers **[Last 24 Hours] [Last 7 Days]
[Last 30 Days] [All Time]** (animated `layoutId` pill). Metrics are computed client-side over the
selected window from whichever feed is active: **Top Tracks** (ranked by repeat count with play-count
badges, playable on click), **Total Time Listened** (sum of `durationPlayedSeconds`, rendered as
`Xh Ym`), and **Completion Rate** (mean `completionPercentage`, with a progress bar). Each feed row
shows cover art, title, artist links, genre, completion bar, played time and a source badge.

All cards, ranks and counters use the shared glass utilities (5 px default blur), Outfit headings,
Montserrat body and the responsive `clamp()` scale; the Firestore rules already cover
`users/{uid}/history/**` through the owner-only subcollection wildcard.

---

## 4ai. Electron desktop packaging

* `main.js` — Electron main process: single-instance lock, 1200x800 frameless window
  (`frame: false`, `backgroundColor #0b0c10`, no address bar), `contextIsolation: true` +
  `sandbox: true` with `preload.js`. Loads `ECHOES_URL` (default `http://127.0.0.1:3000`); with
  `ELECTRON_START_NEXT=1` it spawns `next start` (or `next dev`) itself and waits for the port, so a
  source checkout is self-contained. External http links open in the real browser.
* `preload.js` — `contextBridge` exposes only `window.echoesDesktop`
  (`window.minimize/maximize/close/isMaximized/onMaximized`, `onMediaCommand`, platform/versions).
* Media shortcuts: `MediaPlayPause` / `MediaNextTrack` / `MediaPreviousTrack` / `MediaStop` are
  registered **globally**; Space and Arrow keys (seek ±5 s, Shift/Up/Down for volume) are intercepted
  via `before-input-event` **only while the Echoes window is focused**, so they never hijack the OS.
  Commands arrive as IPC and drive the same player actions as the on-screen controls
  (`src/components/DesktopBridge.tsx`, which also renders frameless window controls and marks
  `<html class="desktop">` so the top bar becomes a drag region with no-drag interactive clusters).
* `package.json`: `"electron:dev": "electron ."`, `"electron:build": "electron-builder"`,
  `"main": "main.js"`, version/description/author set, electron + electron-builder in
  **devDependencies**, and a `build` block targeting Windows `nsis` (.exe), macOS `dmg`, Linux
  `AppImage`, output to `dist/`.

**Build attempt result:** `npm run electron:build` succeeded in this Linux sandbox and produced
`dist/Echoes-7.0.1.AppImage` (289 MB). Windows `.exe` and macOS `.dmg` must be built on their native
hosts (electron-builder cannot cross-compile dmg/nsis from Linux): run `npm run electron:build` on
Windows for the `.exe` installer and on macOS for the `.dmg`. If a sandbox lacks system deps, the
entry files and scripts remain fully prepared for a local build.

Run locally:
```
npm run build            # next production build
npm run electron:dev     # window loads http://127.0.0.1:3000 (run npm run dev first)
ELECTRON_START_NEXT=1 npm run electron:dev   # electron spawns next itself
npm run electron:build   # dist/ (.exe on Windows, .dmg on macOS, AppImage on Linux)
```

---

## 5. Data, performance & persistence

### Latency budget

| Concern | Approach |
| --- | --- |
| Library load | **One** request to `/api/spotify/library`; the server fans out to six Spotify endpoints in parallel (`Promise.all` + per-endpoint fallback) and returns a normalized payload. The browser never waits on a serial chain. |
| Proxy unavailable | Automatic fallback to direct browser calls (`loadDirect`), still tolerant per endpoint. |
| Playlist detail | `/api/spotify/playlist?id=…` pages through `/tracks`, and falls back to the playlist object's own first page when Spotify refuses `/tracks` (403). In-flight requests are deduped per playlist id. |
| Audio features | `/audio-features` is batched (60 ids/call) and cached in the `track_features` table — fetched once per track, ever. If the client id is not entitled to it (403/404), the server stops asking for the life of the process and BPM chips simply do not render. |
| Stats | One CTE query (`/api/playback`) + an 8 s in-memory cache, invalidated on write. Activity polling drops to 30 s and pauses on hidden tabs. |
| Render | The 8 Hz transport clock lives in its **own** React context, so only the progress bar re-renders. `AlbumArt` is memoised. Ambient blobs animate `transform`/`opacity` only (no per-frame `blur()`/`mix-blend-mode`), and the turbulence mesh is rasterised once then drifted with a composited transform. Repeated grid cards use the lighter `glass-card` utility with `contain: layout paint`. |
| Feedback | Optimistic state on every transport action, an indeterminate `LoadingBar`, `BusyChip` while a playlist pages in, skeletons on first paint, and a "partial library" chip listing any degraded endpoints. |

### Playback synchronization

* Every control (play, pause, skip, seek, shuffle, repeat, volume) updates local state **first**,
  then fires the Spotify command.
* An *optimistic window* (2 s) makes incoming polls ignore `is_playing` / `progress_ms` so the UI
  never flickers back while Spotify catches up.
* Reconciliation runs at +650 ms and again authoritatively at +2.25 s.
* `/me/player` is polled every 4 s while playing, 15 s while paused, and immediately on window
  focus / tab visibility. A single 120 ms clock interpolates the progress bar between polls in
  both modes, so seeking and skipping feel instant.
* When Spotify reports a different track, the queue index snaps to it and the outgoing track is
  logged to the listening history.

### Persistence

* **Demo Mode** → `/api/catalog` (Drizzle → Postgres). Idempotent first-run seed in `db/seed.ts`.
* **Spotify Mode** → `/me/playlists`, `/me/player/recently-played`, `/me/top/tracks|artists`,
  `/me/tracks`, `/me/player` and lazy `/playlists/{id}/tracks`, aggregated server-side and
  normalized through the `adaptTrack / adaptPlaylist / adaptArtist / adaptFeatures` mappers into
  one internal shape (`lib/types.ts`). Episodes and local files are filtered out; artwork is
  resolved to both a ~300 px thumbnail and the largest available size.
* **Playback** → the demo transport ticks at 200ms and posts a listening event once a track
  passes 20s or completes. Spotify mode polls `/v1/me/player` (5s playing / 20s paused),
  interpolates the progress bar between polls, and drives `play · pause · next · previous ·
  seek · volume · shuffle · repeat`.
* **Personalization** → optimistic `localStorage`, debounced `PUT /api/preferences`.

| Endpoint | Methods | Purpose |
| --- | --- | --- |
| `/api/catalog` | GET | demo library (tracks + BPM/key, playlists, artists, recent, top, stats) |
| `/api/spotify/library` | GET, PUT, DELETE | aggregation (`?refresh=1` bypasses cache) · save/remove URIs via `PUT|DELETE /v1/me/library` |
| `/api/spotify/library/contains` | GET | `?uris=` → one boolean per URI (≤40) |
| `/api/spotify/playlist` | GET | paged `/playlists/{id}/items` + audio features (`?id=`) |
| `/api/spotify/track` | GET | `GET /tracks/{id}` + album + artist detail, hi-res artwork (`?id=`) |
| `/api/spotify/artist` | GET | `GET /v1/artists/{id}` — banner image + `external_urls.spotify` (`?id=`) |
| `/api/spotify/devices` | GET, PUT | `GET /v1/me/player/devices` · `PUT /v1/me/player` transfer |
| `/api/spotify/session` | POST, GET, DELETE | mirror / inspect / drop the server-side token session |
| `/api/playback` | GET, POST | listening log + aggregate stats (`?limit=`, `?stats=0`), telemetry writes |
| `/api/preferences` | GET, PUT | personalization profile |
| `/api/tracks/[id]/saved` | PUT | saved/liked toggle |
| `/api/health` | GET | DB liveness probe |

---

## 6. Troubleshooting

| Symptom | Cause | Behaviour now |
| --- | --- | --- |
| `403` on `/playlists/{id}/tracks` | Spotify refuses playlists containing episodes unless `additional_types=track,episode` is sent — an *empty* `additional_types=` was also invalid. `/playlists/{id}` accepts no `limit` param at all. | Both endpoints now send `additional_types=track,episode`; episodes and local files are counted and skipped, and the UI says “N episodes skipped” instead of showing nothing. |
| `403` on a private/region-locked playlist | Genuine upstream refusal | Propagated as `forbidden` with an actionable panel + **Try again**. |
| `503` from `/api/playback` | Missing tables (deploy without `drizzle-kit push`) or a DB blip | `withSchema()` runs idempotent `CREATE TABLE IF NOT EXISTS` and retries; reads degrade to `200 {events:[], degraded:["log"]}` and telemetry writes acknowledge with `{ok:false, dropped:true}` — the player is never blocked. |
| `401 token_expired` | Access token lapsed | Route refreshes from the session mirror and retries before ever answering 401. |
| Playlist stuck on skeletons | An empty resolved playlist looked “not loaded”, so it re-fetched forever | `playlistMeta[id].resolved` records the outcome; empty playlists render an explicit empty state. |

---

## 7. Keyboard

`Space` play/pause · `←/→` seek 5s · `Shift + ←/→` previous/next · `P` personalization ·
`Esc` close drawer.
