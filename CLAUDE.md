@AGENTS.md

# Mopik — adventure motorcycle route generator

## Current product decision — 2026-09-11 (takes precedence)

Read `docs/CHAT-MVP-2026-09-10.md`. The primary UI is a structured,
ticket-like ride composer + map + **three versions of one request** (rider's
decision 2026-09-11, superseding the earlier "one route"): `direct`
(smoothest, fewest turns and rough tracks, not longer than needed),
`balanced` (the ranking's pick) and `complex` (most track/trail and forest),
all drawn from the same candidate pool and the same acceptance checks
(`RouteVariant` in `route.ts`, cards in `components/result-panel.tsx`). "Generate
another" stays removed. The composer asks only what changes per ride — From,
To, stops (with **place suggestions from Photon**, `/api/places`; picked
places carry coordinates in `places[]` and are never geocoded again), trip
type, duration — and shows difficulty / style / surface as one remembered
**profile** line (`lib/chat/ride-profile.ts`: Viegli/Vidēji/Grūti,
Tūrisms/Sports, Tikai asfalts/Der arī grants/Meži; asphalt hides difficulty).
The left column is **either the result or the chat, never both**
(`components/result-panel.tsx` after generation: summary, version cards,
numbers, Download GPX, warnings, "Ko mainīt?" input; typing a correction
flips to the chat until new routes arrive — `chatting` in `page.tsx`). The
map is sticky on the right with nothing overlaid, hidden on phones until a
route exists, then first. Rejected earlier: a sheet over the map, a card
inside the chat. Its finite choices
become a canonical RidePlan in `lib/chat/compose-plan.ts` without LLM
interpretation. Chat remains an alternative entry path and becomes the route
correction UI after generation; finite chat questions return quick-reply
buttons. `/api/generate-route` accepts the plan directly; it does not
reinterpret the conversation. Time ranges,
maximum budgets and maximum repeated-road percentages are acceptance bounds.
Required visits are checked on routed geometry, in order, within 300 m of
geocoded places. Internal candidate search remains necessary to find one
result. Chat/session persistence and saved rider profiles are future work.
Bare forest paths are controlled by `accessPolicy`; sandy `highway=path` is
always rejected after the 2026-09-10 Rīga–Ainaži beach regression.



## TET clarification (2026-09-09, later)

TET is optional, not an exclusive routing mode. Nearby short TET candidates
compete with ordinary loops for self-hosted adventure/gravel requests; the
same direction and quality constraints apply. All returned routes are checked
against the local TET geometry and may show an approximate TET km annotation,
even without an explicit TET request. Do not report planned slice length as
actual ridden TET coverage. `tet-coverage.ts` requires sustained aligned
proximity; it is approximate geometry matching, not road-ID matching.

## 2026-09-09 rider correction — overrides older POI/loop guidance below

Read `docs/RIDER-AUDIT-2026-09-09.md` before continuing. Tourist POIs are now
opt-in (`includeSightseeing`); riding quality is the purpose. Direction hints
are retained independently of the endpoint and constrain every search pass.
`preferForest` adds a continuous track/trail preference to ranking; generic
gravel share is insufficient. Exact dead-end excursions are pruned only for
free loops, retaining original edge tags and real access corridors. TET is
never inferred just from maximum forest. Tests: `npx tsx --test
scripts/rider-regressions.test.ts`. These are an initial measured correction,
not a finished forest-network planner. Do not restore mandatory tourist
anchors or equate a returning ride with a circular route.


Structured composer or natural-language conversation → one selected route → GPX, for adventure/enduro
motorcycles in the Baltics. Next.js App Router, TypeScript, Tailwind,
MapLibre. See `docs/PROGRESS.md` for the full change log with measurements and
`docs/ENGINEERING-SUMMARY.md` (Latvian) for the goals / architecture / open
problems write-up handed to reviewing engineers.

## The one thing that matters

**The measure of a good loop is NOT distance accuracy or a tidy shape — it is
not riding the same road twice.** An oval or a lopsided sprawl is fine; a neat
circle that doubles back is not. This came directly from the rider:
*"galvenais nebraukt tos pašus ceļus"*.

Distance may drift 10–40% (the rider sets the tolerance). Retracing is what
gets optimised and reported.

## Who else has worked here

Codex (OpenAI) worked in this folder 2026-09-09 → 09-11 and left docs in
`docs/RIDER-AUDIT-2026-09-09.md` and `docs/CHAT-MVP-2026-09-10.md`: structured
ride composer → `RidePlan` (`lib/chat/`), `/api/route-chat` corrections, one
route shown instead of A/B/C, `accessPolicy` verified/allow_unverified
(`lib/routing/access.ts`), `pruneSpurs`, required stops, `score.ts`,
TET coverage. Its last turn was cut off; the state was checked and repaired on
2026-09-11 (PROGRESS.md). Parts of this file below the architecture section
predate that work where they mention three variants or POI anchors by default.

## Architecture

```
prompt ──▶ lib/ai/parse-route-prompt.ts   (Claude → RouteIntent + nominative places; regex fallback)
       ──▶ lib/geo/geocode.ts             (GraphHopper, Baltic bbox, Latvian case forms)
       ──▶ lib/routing/moto-profile.ts    (RouteIntent → BRouter .brf cost script)
       ──▶ app/api/generate-route/route.ts (calibration loop → corrected radius & target)
       ──▶ lib/geo/isochrone.ts           (Valhalla contours → anchor directions)
       ──▶ lib/geo/poi.ts                 (anchors → real places, 16k pre-baked POIs)
       ──▶ lib/routing/loop.ts            (anchors + POIs → ordered via points)
       ──▶ lib/routing/brouter.ts         (routing; custom profile upload)
       ──▶ lib/routing/classify.ts        (→ Road/Track/Trail, surfaces, overlap, quality)
       ──▶ lib/routing/speed.ts           (one speed model: riding time + planning average)
       ──▶ lib/routing/name-route.ts      (POIs → "Caur Turaidu un Krimuldu")
       ──▶ lib/gpx/generate-gpx.ts        (GPX 1.1)
```

**BRouter routes, Valhalla only does isochrones.** BRouter was chosen because
its profile is a cost script we generate, so every road class and surface has
a cost we control. Measured on 25–30 km Baltic legs: custom BRouter profile
gave 57–92% unpaved where Valhalla's `motorcycle` costing gave 1–50%. It is
also ~0.2 s/route (Valhalla ~0.6 s), returns raw OSM tags rather than a
normalised enum, and has no credits or commercial-use limits.

## Facts that took measurement to learn — don't re-derive these

**Valhalla's `use_trails` barely does anything.** Across five Baltic point
pairs, `use_trails` 0 vs 1.0 produced near-identical routes. Its real lever is
`top_speed`: Valhalla routes by time, so asphalt wins until the vehicle speed
is capped. (An early single-pair test suggested `use_trails` was strong; that
was a coincidence and misled several rounds of work.)

**The overlap metric must be measured on geometry, not router attributes.**
Three attribute approaches all misreport:
- repeated Valhalla `edge.id` → ~0% even for a pure out-and-back (ids are directional)
- any repeated OSM `way_id` → ~80% for a good loop (one way spans many edges)
- tag signature + length → under-reports (39% on a route that was really 48%)

Current implementation keys each consecutive coordinate pair on its endpoints
with direction removed. Validated against a rider-exported GPX: 48% / 7.6 km
repeated / 8.1 km new, matching an independent measurement exactly.

**Some areas cannot loop cleanly at short distances, and it's the network.**
Around Tukums every loop under ~150 km retraces 41–52%; an 18 km anchor ring
reaches 19–25%. Two hypotheses were tested and refuted: more stops don't help
(44% at both 3 and 5 stops), and the gravel discount isn't the cause (41–44%
across the whole `offRoad` scale). Sigulda is similar — the Gauja valley has
few crossings, so 13% needs a ~220 km loop.

**Forest access is explicit in the plan.** Near Sigulda only 3 of 91 tracks
carry `motor_vehicle=no|private`. `accessPolicy=allow_unverified` may use a
plain `highway=path` whose motor access is unknown and reports its length;
`verified` rejects it. Both modes reject explicit restrictions and sandy
paths. Do not route through ways explicitly tagged as legally restricted.

**Loops are searched, not drawn (2026-09-08 late).** Per request: calibration
route → base + wide isochrones → ~17 shapes (rings, four teardrops, a relaxation
ladder at 1.6×/2.4× with 3–7 km floors) → rank → second pass if the median is
>25% off → mutations of the 2 best + best wide loop (±25°, ×0.85/1.2, ±1 stop).
Drift is judged in minutes with a free band of max(tolerance, 15 min); the
offer is the *nearest* out-of-tolerance loop that retraces ≤20%. Minimum 3
stops. `debug: true` → `debugCandidates` shows the whole pool — read it before
tuning anything.

**Cost ratios are the profile (2026-09-08, measured against a rider's own 126 km plan).**
A main road may cost at most ~12× a track; at 170× (the old primary 12 + 60·t)
the router rode 40 km of forest to avoid a 2 km bridge and Riga loops crawled
residential streets. **Latvia's A-roads are `highway=trunk`** — legal for
motorcycles, often the only way across a river — so `trunk` is dear, never
forbidden; only `motorway` is refused. Plain `highway=path` depends on
`accessPolicy` and `trailPreference`; footway/cycleway/bridleway stay forbidden.
Fidelity check: `BROUTER_BASE_URL=http://localhost:17777 npx tsx scripts/fidelity-ride.ts ride.gpx 24`.

**BRouter gotchas:**
- **A bare 500 on every route with an empty body = the profile did not parse.** The reason is only in `../brouter-server/brouter.log` (`ParseException … line N`). Read it before bisecting. Common cause: an `or`/`and` chain where one line lacks its leading operator — the chain closes early and the next line is a top-level operator. Uploading a profile does not validate it.
- Unknown tag values kill the whole profile with a bare 500 (`motor_vehicle=forestry` is not in its lookups.dat)
- `multiply varA varB` is invalid; the second operand must be an inline switch chain
- "target island detected for section N" — sections are **0-based**, so the unreachable point is index N+1
- The public instance throttles bursts: 403 "Please, retry later!" after ~6 quick requests. Hence 6 candidates, 2 at a time, with backoff. `BROUTER_BASE_URL` lifts this.
- `estimated_forest_class`, `estimated_town_class`, `estimated_traffic_class` are populated in the Baltic data (1–6/7) and are real levers: forest discount is what "pa mežiem" maps to.
- **`WayTags` carries only the keys the profile references.** `tracktype`/`smoothness` looked absent on every route until the profile mentioned them. To report a tag, reference it in the cost script (a no-op `assign` is enough). Node-context keys (`barrier`, `ford`) referenced in the way context → 500.
- Public instance also answers 400 "operation killed by thread-priority-watchdog" under load — retry like a 403.

## Calibration constants (all measured, all in `app/api/generate-route/route.ts`)

- **A calibration route now replaces the table per request** (`calibrateLoop`): one loop at the table radius gives the region's real perimeter factor (measured 6–18 vs table 11–32) and, for duration requests, its real average speed. `LOOP_PERIMETER_FACTOR` is only the starting guess and the fallback when the calibration route fails.
- `LOOP_PERIMETER_FACTOR` — routed length ÷ anchor radius, by stop count. ~11 at 2 stops to ~32 at 8. Measured before the turn/switch costs; the new profile runs straighter, which is exactly why calibration exists.
- `MIN_ANCHOR_RADIUS_M` = 1200. Was 3000 from the Valhalla era, which *forced* 34 km loops against 10 km targets.
- `PROBE_RADIUS_M` = 18000 — the exploratory candidate's absolute radius.
- Speeds live in one place, `lib/routing/speed.ts`: per-way moving speeds for the displayed riding time and `plannedAvgSpeedKmh` for duration → distance. BRouter's own `total-time` is a flat ~45 km/h and is not shown. `profiles.ts` (Valhalla) only serves isochrones now.

## UX decisions already settled

- **The structured composer is the primary input.** Its From/Destination/stop
  fields and finite choices create `RidePlan` directly. Do not send them
  through prompt parsing.
- **Chat is an alternative and the post-result correction surface.** It edits
  the previous `RidePlan`; deterministic normalisation keeps explicit user
  answers from being lost to model interpretation.
- **Never substitute silently.** When the area can't meet the request, the app
  says so *and* offers a concrete alternative with numbers ("191 km / 4h15m →
  19% repeated vs 44%") behind a "Generate that instead" button. The rider
  chooses.
- Off-road share is reported as **% unpaved**, not track+trail: Latvian gravel
  roads are `highway=unclassified` + `surface=gravel`, so they classify as
  "Road" and the track figure read 2% on a route that was half gravel.
- An untagged `highway=track` reports as gravel. `unclassified` stays
  "unknown" on purpose — rural means gravel, urban means asphalt.
- **The left column is either the result or the chat, never both.** The
  form → result panel (versions, numbers, GPX, "Ko mainīt?" box) → chat while a
  correction is being processed → result again. The map stays visible.
- **Animation is one SVG scene reused twice** (`RouteScene`): the intro splash
  and the in-chat loader. Bike follows the drawn path via SMIL `mpath`; keep
  the route id `#mopik-route` in sync if you change it.
- **Lucky ride** = start only + no destination + flexible time. Not a mode the
  rider picks; detected in `app/page.tsx`, sent as `lucky: true`, and the
  API aims for ~120 km and the result opens on *Sarežģītākā*.
- **Logo reloads `/`** on purpose (fresh state), hence the disabled
  `no-html-link-for-pages` rule on that anchor.
- **A ride has a shape, and "where the fun is" can be away from the start.**
  `focusArea` in the plan = transit → loop → transit (Rīga → Baldones meža
  aplis → Rīga). A via place is a visit; a focus area is a playground. The
  chat must never squeeze "meža aplis X mežos, no Y" into viaPlaces. The
  budget is the whole day unless `budgetScope: "focus"`.
- **Say what you understood before drawing.** The chat leads with "Sapratu:
  …" in the rider's words whenever the shape is new/changed, and does the
  transit arithmetic (2 h total − 2 × 50 min = 20 min in the forest) as a
  question with two taps, not as a surprise on the map.
- **The time limit is the product.** Never show a version more than ~45 %
  past the free band; when nothing fits, lead with the nearest and state
  "Prasīts ~2 h, šī versija ir 2 h 47 min." with one-tap ways out. A rider
  who typed 2 h and got 3 h 30 does not come back.
- **The surroundings belong to the winding/complex versions, never the
  straight one.** For a via ride, `around-*` (ring around the stop) and
  `zig-*` (one-sided wiggles) candidates compete for those slots; `detour()`
  keeps them out of the direct pick. Rings are small and on the rider's
  profile because forest rings near a town run ~15 km/h and the budget is
  time. Chat: "vairāk apkārtnes" → `surroundings: "more"`.
- **On the phone the map yields to words.** 26dvh while the chat speaks,
  42dvh with the result panel, full screen on request (button on the map).
  The chat log scrolls to the start of the latest reply, inside the log only.
- **"Nothing fits" is never an error.** When candidates routed but none
  fits the budget, the API returns the nearest rides plus `infeasible`
  (minimum minutes on this surface, direct km, asphalt and one-way
  estimates) and the chat explains and offers chips; the chat also does the
  via-distance arithmetic before routing (`lib/chat/feasibility.ts`). 422 is
  only for "nothing routed at all".
- **Prompt changes are measured with `npx tsx scripts/chat-golden.ts`**
  against the dev server (12 phrasings). Don't tune the prompt by feel.

## Environment

`STADIA_API_KEY` required (isochrones + nothing else critical).
`GRAPHHOPPER_API_KEY` used by geocoding only (free plan: ~30 calls/min, hence
at most 4 case-form candidates per lookup). `ANTHROPIC_API_KEY` enables Claude
prompt parsing (`claude-opus-5`, structured output, per-prompt cache); the
rider's key is identity-linked so **`ANTHROPIC_WORKSPACE_ID` must be set too**
(it is) or every call fails with 400 and the regex heuristic silently takes over. The
API response's `parser` field says which ran. `ANTHROPIC_MODEL` overrides the
model.

POI data: `python3 scripts/build_poi_dataset.py` → `public/poi-baltics.geojson`
(16,410 places, LV/LT/EE). Queries are cached under `.poi-cache/`, so a
re-run after changing scores needs no network. Overpass rate-limits a full
build into connection refusals; the script rotates mirrors.

- `RESEND_API_KEY` (optional): rider feedback e-mails via Resend to
  rihards.rucevics@gmail.com; without it the form falls back to a mailto: link.

## BRouter runs locally

`../brouter-server/start.sh` (outside the repo; BRouter 1.7.10 + Baltic
segments E20/E25 × N50/N55, brew `openjdk`, port 17777) — also
`.claude/launch.json` → `brouter`. `.env.local` sets
`BROUTER_BASE_URL=http://localhost:17777`. With it set the client skips
pacing, loops use 12 shapes instead of 4, and a second correction pass runs.
Unset it to fall back to brouter.de, which throttles bursts (six requests
per generation was already too many) — never measure against the public
instance in a loop. Start the server from a terminal, not the app's preview
runner: macOS then denies it Documents access and every route 500s with
`lookups.dat (Operation not permitted)`.

## Measurement tooling

- `POST /api/generate-route` with `"debug": true` adds `debugEdges` (raw OSM tags per edge) to each route. Never set by the UI.
- `npx tsx scripts/probe-brouter.ts [offRoad]` — which tag keys BRouter reports for one leg with the app's profile.
- `node scripts/measure-prompts.mjs [out.json]` — seven rider prompts end to end through the dev server (`ONLY=` to filter, `API=` for the deployed URL); prints km, repeated %, unpaved, track, trail km, forest share, rough/sand/street km, turns per 10 km, calibration and parser.
- `npx tsx scripts/fidelity-ride.ts ride.gpx [via]` — share of a routed result that lies on a rider's real track; the calibration tool for the cost table.
- `npx tsx scripts/experiment-profile.ts` (`ONLY=legacy,adventure` to filter) — the pre-audit profile (frozen as `legacyProfile`) vs `buildMotoProfile` per difficulty on six legs: turns/10 km, paved↔unpaved flips, sub-500 m runs, grade4–5 km, rough km, street km, unpaved %.
- `debug: true` responses also carry `debugCalibration` (measured factor, km/h, corrected radius and target).

## Known open items

**Rider's-eye audit (2026-09-03, `docs/PROGRESS.md`):** plan items 1–6 are built and measured (profile, speed model, calibration route, places/geocoding, TET sizing, dedupe). Claude parsing is live (`parser: llm`, 4–7 s per new prompt, cached after); BRouter is local; trail lever + forest discount + teardrop shapes + second pass are in (late entry in PROGRESS.md). Open: Riga-start loops still retrace ~36% on the corridors; calibrate `speed.ts` against ridden GPX; UI controls for `noSand`/`avoidTowns`/trail level.


- Distance still overshoots (and undershoots) by region; the corrective re-route from
  cached contours is designed but not wired up — see the audit plan, item 3.
- Direction hints ("uz Siguldas pusi" vs "caur Siguldu") designed, including
  Latvian case handling, not implemented.
- Safari-only "The string did not match the expected pattern." after a
  generation (WebKit `SyntaxError` DOMException); unreproduced in Chromium.
  The error box now shows `name: message — frame`; ask the rider for that text.
- Free-text geocoding: Photon settlement lookup first (same as the picker), GraphHopper fallback. Picked places travel as `places[]` and are never geocoded again — and `generate()` must receive them as an argument, not read them from state set in the same tick (the Valmiera-in-Rīga bug).
- **The Stadia free tier forbids commercial use.** Both routers can be
  self-hosted (BRouter and Valhalla are both open source) — that's the path if
  Mopik goes public.

## Working style that has paid off here

Measure before concluding. Several confident-sounding conclusions in this
project turned out to be artefacts of a single test leg — including two of
mine that are now corrected in `docs/PROGRESS.md`. When a rider says the
result is wrong, get the actual numbers (their exported GPX was the most
useful signal in the whole project) rather than tuning constants.
