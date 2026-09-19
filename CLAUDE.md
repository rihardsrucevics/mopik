@AGENTS.md

# Mopik — adventure motorcycle route generator

## Check the account before you deploy or push — every time

This machine is signed in to **two GitHub accounts and, until 2026-09-14, two
Vercel accounts**, and the wrong one looks exactly like the right one until a
deploy silently lands somewhere the rider cannot see. It cost most of an
afternoon: work was deployed to `tronpower/mopik` while the rider was watching
his own project, and twice I concluded a change "had not shipped" when it had
shipped to the wrong place.

**Before any push or deploy:**

```
gh auth status | grep -A1 "Active account"   # must be rihardsrucevics
vercel whoami                                 # must be the rider's own account
cat .vercel/project.json                      # must be rihards-projects-3063811e
```

If `gh` is on `tronems`, `git push` fails with 403 — that one is loud.
**Vercel is the quiet one:** the wrong account deploys happily, and the only
symptom is that www.mopik.eu does not change. When a deploy "did not work",
check the account before you check the code.

## Where this stands — handover, 2026-09-19 (evening, hard stop)

**Production is `4d99441`, main is clean.** Shipped today, each verified in
a browser on www.mopik.eu: metadata in four languages with `?lang=` on the
link and the card (`/card?lang=`), shared-route cards in the author's
language, coordinates in the place field (#14), pick a place on the map
with Confirm (#13), stops added straight from the map with numbered pins,
#7 step 2d (segment-wise probe + named refusal + `car-fast` direct-leg
offer), #11 closed by measurement, ridden-roads reference layer (#6 first
step — changed no route; value is *showing* `riddenKm`, panel line still to
do), POI + gates for SI/CH/AT.

**Unfinished work is parked on branch `wip/map-pins-and-fast-reroute`
(f00acfd), NOT on main.** Read its commit message first. Complete there:
the API for an unreachable pin (200 + `unplannable.unreachableStop`,
`remove-stop`/`move-stop` chips, `/api/routable-point`) — measured on the
rider's ride: "Pilskalni 2" is a farmstead behind `access=private`, BRouter
ends 471 m short, no legal road within 300 m. Partial: role-based planning
pins (`lib/map/place-roles.ts`, wired), "Starts"/"Finišs" labels (start
pin was rendering clipped — unverified), fast incremental re-route (~640
lines UI + `/api/reroute-leg`, unverified). Not started: dispatching the
two chips in home-page.tsx and the routable-point check at `confirmPick`.
`tsc` on the branch: 2 errors (analytics union), 301/301 tests. **Rider
decisions since:** the finish pin stays RED with its label (chequered flag
reversed); do not ship a chip that does nothing.

**Two production observations, unresolved:** a Latvian prompt with foreign
place names fell to the regex parser once (backlog 25); `hasPlaceData`'s
1°/1.5° slack tells München it has place data via Austria (backlog 8).

**Poland POI/gates build** was still running at the stop (`nice 19`,
log `data/poi-build-3.log`, script in the 0284c868 session scratchpad,
venv beside it). When `data/gates-PL.json` exists: `npx tsx
scripts/publish-poi.ts && npx tsx scripts/publish-gates.ts`, commit
`public/poi public/gates`, deploy. DE and IT still need a quiet machine.
Guard builds on `memory_pressure` free %, never on swap-used.

## Vercel: the project moved accounts, 2026-09-14

Mopik now deploys from **`rihards-projects-3063811e/mopik`** (the rider's own
account), not the old `tronpower/mopik`. The CLI is linked to it and all eight
production env vars were migrated — including `BROUTER_BASE_URL` and
`BROUTER_TOKEN`, without which every route silently falls back to the
throttled public BRouter.

**`mopik.eu` was still on the old account when this was written.** Vercel
wants a `_vercel` TXT record at the registrar to prove ownership before it
will move; that record is in place and propagated, and the rider presses
Refresh in the Vercel UI to finish it. Until then a deploy lands on
`mopik-*.vercel.app`, not on www.mopik.eu — check which one you are looking at
before concluding a change did not ship.

**Trap:** `vercel env pull` still overwrites whatever file you point it at.
Pull to the scratchpad, never to `.env.local` — that is how the local keys
were lost on 09-12.

## Where this stands — handover, 2026-09-15 (night)

**Production is `1edb55e`, and the working tree is clean** (morning of
2026-09-15, paused by the rider). Everything below plus the morning's work
is live: corridor coastal candidates (11f, no coastal candidate above 3 %
retracing; the sea term's bound did not move — the rider ruled the sea may
not buy retracing), no vias in the water (11e), the quarter-second-refusal
fix (11g: Liepāja → Ventspils 136 → 22 s) and item 20 (a suggested place
BRouter calls a "target island" now routes), the chat's "vienalga" (item
23, 16/16 golden cases on production), the chat panel height fix, sights
named "Apskates vietas" with on-route markers, a map toggle that hides all
sight markers, camera glyph for viewpoints, and the compact segment card.

**Next when the machine is quiet: the POI second pass.** It was paused
twice because this Mac has 8 GB RAM and the 2 GB Poland extract makes it
swap; `<scratchpad>/pbf2/PL.osm.pbf` is still on disk. Run
`<scratchpad>/run-phase2b.sh` (PL DE CH AT IT SI, reuses the extract),
then `npx tsx scripts/publish-poi.ts` and `npx tsx scripts/publish-gates.ts`,
then commit `public/poi public/gates` and deploy. Then delete
`public/poi-baltics.geojson` after one deploy confirms nothing reads it.

**Deploy from a clean worktree.** The working tree carried other agents'
half-done files all evening, so every deploy was `vercel --prod --yes` from
`<scratchpad>/deploy-wt` checked out at the commit, with
`.vercel/project.json` copied in. `tsc` there reports a false `LayoutProps`
error (no `.next/types`); run the tests instead. 32 commits shipped this way
from `9ab3070` to `c2af410`; all verified in a browser on www.mopik.eu.

**What changed, and the rule behind each** (details in PROGRESS and the
commit messages, which were written to be read):
- Untranslated text is a lint error (`react/jsx-no-literals` + selectors on
  text attributes, then extended to conditional branches). Everything but
  the chat's model replies and the OpenGraph images speaks four languages.
- Map: colour = surface, pattern = class, legend two rows, badges are ⚠️
  and 🔥 only, no rough-track icon. Segment card heads itself with the
  compound ("Grants meža ceļš").
- Item 7: a 10 s client-side feasibility probe before the search; BRouter's
  `maxRunningTime` is not honoured. Honest refusal in ~12 s instead of a
  422 after 50.
- Item 11: beach/dune *paths* refused (`shore_path_factor`); the coast on
  real roads is preferred through a bounded sea term fed by a coastline
  grid (`lib/geo/sea.ts`) and seaward candidate vias; via points in the
  water are refused by BRouter snap distance. **Open decision:** the sea
  term buys at most 10 % retracing; Liepāja → Ventspils' shore-road
  candidate ranks second because of exactly that. The rider has not said
  whether the sea may buy more. Also pending: six dry-land failures there
  cost 209 s — a refused approach direction; fixing it makes the ride 8.3 s.
- Item 12: **we do not guess about private roads.** Only gates on the
  ridden way (vertex identity, 1.5 m, never a radius) are counted and
  shown; nothing steers the route. The rider rejected proximity and the
  strict "through the yard" rules in turn.
- Item 19: suggestions in their own card with look / read / add; sights
  are not stops (kind glyph vs 🅿️); ticking splices a background-routed
  detour instantly, out-and-back by default, loop only if ≥ 15 % better;
  long detours keep their checkbox with a note. Items 20 and 22 record two
  routing oddities found on the way.
- Item 8: Google Places is disallowed by its terms for this use; Geofabrik
  + pyosmium is the path, with a KeyFilter before area assembly (LV 130 s →
  21 s). LV LT EE PL are published. **The second pass for PL DE CH AT IT SI
  died** — `data/poi-build-2.log` stops at "[PL] POIs"; the machine has
  8 GB RAM and swap was 9/10 GB full with many agents. `<scratchpad>/
  pbf2/PL.osm.pbf` is still on disk. Restart `<scratchpad>/run-phase2.sh`
  on a quiet machine, then `npx tsx scripts/publish-poi.ts` and
  `scripts/publish-gates.ts`, then delete `public/poi-baltics.geojson`
  after one deploy confirms nothing reads it.

**Traps learned tonight:** the dev server on :3000 does not reload server
code (it served 14:30 routing all evening — restart it before any
browser-based measurement); Node `fetch` to overpass.private.coffee needs a
User-Agent or gets an instant 429; a `multiply` after `switch highway=path`
in the BRouter profile is dead code and backticks in profile comments break
the template (both pinned by tests); Lucide's `color` prop sets stroke only;
module-level `renderToStaticMarkup` crashes on the server; MapLibre's
`line-dasharray` takes `step` only with `["literal", …]` and `zoom` only at
the top level; MapLibre's own CSS overrides ours unless the selector is
doubled; Next 16 refuses a second dev server in one directory.

**How the rider worked tonight:** every change through an Opus subagent
with explicit file ownership, several in parallel, him testing the live
site and correcting mid-flight. He reverses decisions quickly (the trail
icon went Footprints → Flame → Heart → 🔥 in one evening); restate the
rule, redirect the agent, do not argue.

## Where this stands — handover, 2026-09-14 (evening)

Everything below is committed, pushed and **live on www.mopik.eu** at
`41e1b9f`. Working tree clean. Fourteen commits today.

**Deploy is `vercel --prod --yes`, from the rider's own account.** A GitHub
push alone did not reliably reach production today — check the account first
(the section above says how), then deploy, then confirm in a browser rather
than with curl: Vercel's bot challenge answers curl with a 403 that looks like
an outage and is not one.

### What got done today

1. **A destination the profile cannot route to** no longer kills the request.
   Ērgļi's centre geocodes onto a `highway=footway`, which the moto profile
   forbids, and BRouter refused the whole leg. `fetchRoutePath` now looks for
   routable ground nearby and the acceptance checks allow the distance moved.
2. **Mopik has its own BRouter** at `https://brouter.mopik.eu` — Berlin →
   Warszawa routes in 14 s where the public instance refused it outright.
   Built by `scripts/deploy-brouter-vps.sh`; see `mopik-brouter-server` memory
   for the credit that lapses around November.
3. **Cancel a generation**, and failures that speak in the chat rather than in
   a box below the fold.
4. **The map reads like a phone map**: one brown family for everything
   unpaved, style for road class, zoom-interpolated widths, a glow, and a
   route that draws itself in. Badges mark trails and unverified access.
5. **Four languages**, complete — see below for what is deliberately not.
6. **A footer**, an icon-only header with an unread count on saved rides, and
   presets renamed Asfalta tūrists / Grants tūrists / Adventure (which now
   means hard).
7. **Place fields remember** what the rider picked before.

### What is left, in the rider's order

`docs/BACKLOG.md` is the list. Next up:

- **#7 Long rides (~1000 km) still fail.** Decided with the rider: say it
  before the search rather than after 50 s of waiting, *then* work out how to
  plan them properly. Refusing is the interim, not the end state. The rider
  said "not yet" to starting this.
- **#8 POI for Europe** — the oldest outstanding request.
- **#11 Routes still run along the sea**, **#12 through private property**.

### Two things still Latvian, on purpose

The chat's *model-generated* replies come from the prompt in
`app/api/route-chat/route.ts`; translating them means translating the prompt
and re-running `scripts/chat-golden.ts` per language. The OpenGraph share
images are server-rendered with no locale to read.

**When sweeping for untranslated strings, do not search for diacritics.**
"Vari uzreiz pateikt visu, ko zini." has none and survived three passes. The
scan that works is in `docs/BACKLOG.md` item 9.

## Where this stood — handover, 2026-09-14 (midday)

**`docs/BACKLOG.md` is the rider's own list, in his order — read it first.**
Item 1 is a round-trip behaviour he specified step by step; item 2 is POI for
Europe, which had been the next job before he re-prioritised.

Fixed on 2026-09-14 (details and numbers in `docs/PROGRESS.md`), **not yet
committed**:
- **A destination the profile cannot route to killed the whole request.**
  BRouter answers 400 `error re-tracking track` when an endpoint snaps onto a
  forbidden way — Ērgļi's centre is nearest a `highway=footway`. Reproduced on
  brouter.de too, so it is not a local-instance artefact, and it had nothing to
  do with the Tūrisms setting the rider suspected (`includeSightseeing` never
  reaches the profile). `fetchRoutePath` now looks for routable ground nearby
  and the acceptance checks honour the distance moved.
- **Profile buttons were dead after returning from a result.** `RideComposer`
  read the profile from `initialPlan`, which exists for the rest of the session
  once a ride is generated, so clicks were overwritten on every render.

**Mopik now has its own BRouter: `https://brouter.mopik.eu`** (`94.130.224.197`) (Hetzner CPX12, Nuremberg,
€14.51/mo on the rider's €25 credit; `scripts/deploy-brouter-vps.sh` builds
it from scratch, 88 European segments / 3.1 GB). It is behind an
`X-Mopik-Token` header — `.env.local` has both values, and **Vercel needs
`BROUTER_BASE_URL` and `BROUTER_TOKEN` set before production benefits.**
Berlin → Warszawa routes in 14.4 s where brouter.de refused it outright.

Rides around ~1000 km still fail — now on time, not refusal: one such leg takes
75 s on our own server and a generation tries ~36 candidates. Backlog item 5.

**Traps this added, both mine:** `RouteServer` resolves the custom-profile
directory *against* the profiles directory, so absolute paths silently break
every upload (nginx still says 200; BRouter's 500 is inside the body). And an
*empty* `BROUTER_BASE_URL` used to read as self-hosted — use the trimmed
helpers, never `process.env.BROUTER_BASE_URL` directly.

The section below is the 2026-09-13 state; everything in it is live at
`508f2f4`.

## Where this stood — handover, 2026-09-13 (evening)

Everything below is committed, pushed and **live on www.mopik.eu** at
`977d80f`. Read this section first; the rest of the file is
the accumulated rules.

### Mopik is no longer Baltics-only

Place search, TET and routing all work across Europe, verified in production:
`Innsbruck` resolves, `Neustadt` near Munich gives the Bavarian one, `Cēsīm`
still gives Cēsis, TET serves 33 countries. **BRouter on brouter.de already
covered the world** — measured in the Alps, Madrid, San Francisco and
Marrakesh — so the fences were all on our side.

Four steps, each measured (details and numbers in `docs/PROGRESS.md`):
1. **TET Europe-wide** — 33 countries, 400 sections, 118,246 km from the
   rider's GPX. Split per country for the map (~231 KB each, fetched for what
   is on screen) and one fine file for the router.
2. **Place search worldwide, biased not fenced** — ranked around a bias point
   (a place already pinned → Vercel IP headers → Rīga), 2500 km cut-off.
3. **`avoidMainRoads` fixed** — it was pricing `trunk` *below* `primary`, so
   the flag chose bigger roads. A bug in Latvia, found while checking abroad.
4. **Honesty about POI** — `sparsePlaceData` warns that stops go unnamed
   outside LV/LT/EE.

### What is left, in the order it matters

**Superseded on 2026-09-14 by `docs/BACKLOG.md`, which is the rider's own
ordering.** The list below is kept for the detail it carries on each item.

1. **POI for Europe (the rider asked for this explicitly).** Outside LV/LT/EE
   loop anchors are geometric, so rides are unnamed and cannot be planned
   *through* a hillfort or a ford. `scripts/build_poi_dataset.py` takes its
   countries from a three-entry list — it is a data job, not a code one. The
   rider also asked whether Google could supply this; it has not been costed.
   Overpass rate-limits a full build, and the script already rotates mirrors.
2. **Prompt history with results** — still the oldest outstanding request. A
   saved ride already carries `prompt` and every version.
3. **Chat: avoid a place or area** (`nogos`), **"izdomā"**, **"mix of two
   versions"**.
4. **Self-hosted BRouter on a VPS.** Now more valuable than before: every
   European route goes through the throttled public instance, and it visibly
   refuses bursts during measurement runs.

### Known problems, measured

- **brouter.de throttles.** Repeated generations return "Neizdevās atrast
  maršrutu…" that is rate limiting, not a routing failure. Locally
  `BROUTER_BASE_URL=http://localhost:17777` has only Baltic tiles
  (`E10_N45.rd5 not found` for Munich), so testing abroad means the public
  instance and its limits. This is the single biggest drag on working here.
- **Route names are English outside a Latvian prompt.** "Sigulda Adventure
  Loop" — `locale` is detected from the prompt text, and an API call without
  one falls through to English. Pre-existing, verified against the previous
  commit; not caused by the Europe work.
- **Loop stops are empty even in Latvia** unless `includeSightseeing` is set.
  Also pre-existing (POIs are opt-in since the 2026-09-09 audit).
- **The profile is calibrated on Latvian roads.** Measured: `trunk` is never
  chosen in Germany, Poland or France, so the class costs are not the problem —
  but nothing else abroad has been measured against a real ridden track.
- `data/tet-gpx/` is git-ignored (117 MB). Re-download from transeurotrail.org
  before re-running `scripts/build-tet.ts`.

### Traps this project has already sprung — do not re-learn these

- `vercel env pull` into `.env.local` and `vercel blob create-store --yes`
  **overwrite** the file, keeping only what Vercel knows. It cost the local
  Anthropic/GraphHopper/Stadia keys on 09-12.
- Backticks and `->` inside a commit message or a Python heredoc get executed
  or break the template literal. Commit from a file (`git commit -F`).
- macOS has no `timeout` command.
- A dev server reached through the preview tool dies between sessions; the local
  BRouter (`../brouter-server/start.sh`) must be started from a terminal.
- The browser console buffer keeps errors from previous page loads. Verify a
  "fixed" warning by reloading and checking the message still names live code.
- **Editing an API route needs a dev-server restart.** HMR served stale code
  through a whole measurement round on 09-13 and the numbers looked unchanged.

## `avoidMainRoads` must price trunk above primary (2026-09-13, measured)

The flag did the opposite of its name, **in Latvia**, and nobody had measured
it. `primary` goes to 20 when avoiding main roads while `trunk` stayed at 12,
so trunk became the cheapest big road on the map. Measured Rīga → Sigulda,
asphalt profile: flag off rode 5.6 km primary / 0 trunk; flag **on** rode
2.2 km *trunk*. Now `trunk: 26` under the flag — same leg, 0.1 km trunk, and
4.9 km shorter than before the fix.

This was found while checking whether the Latvian `trunk` assumption breaks
abroad. **It does not**: measured on München→Ingolstadt, Hamburg→Lüneburg,
Warszawa→Radom and Lyon→Grenoble, both profiles, `trunk` was **0.0 km in all
eight runs** — the turn, surface and offRoad costs keep the router off big
roads long before the class cost matters. The problem was at home.

The 44 km-detour regression is not back: trunk is dearer, never forbidden
(measured 37.3 → 43.0 km on the river-crossing leg, trunk still available).
Re-run with `BROUTER_BASE_URL=https://brouter.de npx tsx scripts/measure-trunk.ts`.

## Place search is worldwide and biased, never fenced (2026-09-13)

Search used a Baltic bbox plus a `{LV,LT,EE}` allowlist, which is why
"Innsbruck" and "Warszawa" returned **0 results**. The fence could not simply
go: it was also what made Latvian case forms work. Measured with no bbox,
`Cēsīm` → Ćesim (Bosnia) and `Tukumu` → Tukumunga (Papua New Guinea).

So results are **ranked** around a bias point instead, and a 2500 km cut-off
drops other continents. The bias point, best first:
1. `?near=` — a place already pinned in this ride. The composer passes the
   first confirmed place, so a Munich start offers Bavarian places below it
   (measured: `Neustadt` → *Neustadt an der Donau*, not one of the dozens).
2. Vercel's IP headers (`x-vercel-ip-latitude/longitude`) — city-level, free,
   no permission prompt, read as plain headers rather than via a dependency.
3. Rīga.

**Sort by kind, then rank, then distance.** Distance before rank was measured
putting "Siguldas novads" above Sigulda and a hamlet named Warszawa above the
capital. Distance only separates equals — which is what "LV first" did, without
assuming where the rider lives.

`geocode.ts` follows the same shape: `point` biases, no bbox, and the old
`baltic` flag is now `near` (within `FAR_KM` of the anchor). All six Latvian
case forms still resolve correctly; `scripts/geo-bias.test.ts` pins both halves.

## TET is Europe-wide (2026-09-13)

33 countries, 400 sections, 118,246 km — built from the official per-country
GPX by `npx tsx scripts/build-tet.ts`. Sources live in `data/tet-gpx/`, which
is **git-ignored**: 117 MB against a 6.6 MB repo, and re-downloadable from
transeurotrail.org (the rider has an account; they are not public files).

Two outputs, because one does not serve both readers:
- `public/tet.geojson` — the router's reference layer, 12 m tolerance, 11 MB.
  Fidelity matters here: the coverage match works to 35 m, so simplifying to
  20 m (8.5 MB) would sit at 57 % of the tolerance and start matching quietly
  wrong.
- `public/tet/<CC>.geojson` + `index.json` — the map overlay, ~231 KB per
  country. One combined overlay is 4.3 MB, and simplifying it phone-small
  destroys the shape: 1.1 points/km against the 7.1 the Latvia-only layer had.
  The map reads `index.json` (2.4 KB of bounding boxes) to decide what is on
  screen, fetches those countries and caches them; `moveend` fills in more.

**`tet-coverage.ts` projects per area, never at a fixed latitude.** It used
`cos(57°)` — Latvia. At Spain's 43°N that is **26 % off** in the x axis, enough
for the 35 m tolerance to stop matching with no error anywhere. `measureTetCoverage`
now filters sections to the route's own bounding box first (also keeping the
grid off 585k points) and derives the scale from those sections.

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
motorcycles — Europe-wide since 2026-09-13, with the Baltics as the calibrated
home region. Next.js App Router, TypeScript, Tailwind,
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
       ──▶ lib/geo/geocode.ts             (GraphHopper, biased to the ride, Latvian case forms)
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

**Off-road share is `track + trail`, never `unpaved`** — Latvian gravel farm
roads are unpaved, so a loop can read 70% unpaved with almost no forest. The
ranking targets 45% track+trail at trails=lots.

**Entering a forest way must be nearly free when the rider asked for tracks.**
`initialclassifier` has three levels (asphalt / unpaved road / forest way) and
`trackEntryCost` is 15 m at lots. With two levels a gravel→track turn paid the
full 150 m surface-switch penalty, which is 30% of a 500 m track: break-even
sat at ~1.2 km and Latvian tracks are 300–800 m. Proof the network is not the
limit: a direct leg through Sigulda forest routes 55% track+path.

**Difficulty and the trail dial answer different questions.** Difficulty =
how rough a surface may be (grade, smoothness, fords). Trails = how willingly
the router leaves the road. They were conflated as `hard || lots` in the grade
costs, which made "Viegli + Meži" ride like "Grūti". Never re-merge them.

**A ford is priced by the water, not by the tag.** Node keeps a worst-case
cost; `ford_factor` in the way context discounts it by `estimated_river_class`
(small stream at hard: 0.80, i.e. better than no ford; class 5-6: 9x; easy
refuses). BRouter's lookups have no `ford=stream`.

**Trails are the product for an adventure rider**, not a garnish: "Grūti" and
"Sports" mean the dotted lines. Three places must agree or the share silently
goes to zero — `highway=path` cost in `moto-profile.ts`, the trail shortfall
term in `score.ts`, and the pick order in `route.ts` (complex picks first at
trails=lots). Verify with Sigulda 2 h: complex should show >10% trail.

## Calibration constants (all measured, all in `app/api/generate-route/route.ts`)

- **A calibration route now replaces the table per request** (`calibrateLoop`): one loop at the table radius gives the region's real perimeter factor (measured 6–18 vs table 11–32) and, for duration requests, its real average speed. `LOOP_PERIMETER_FACTOR` is only the starting guess and the fallback when the calibration route fails.
- `LOOP_PERIMETER_FACTOR` — routed length ÷ anchor radius, by stop count. ~11 at 2 stops to ~32 at 8. Measured before the turn/switch costs; the new profile runs straighter, which is exactly why calibration exists.
- `MIN_ANCHOR_RADIUS_M` = 1200. Was 3000 from the Valhalla era, which *forced* 34 km loops against 10 km targets.
- `PROBE_RADIUS_M` = 18000 — the exploratory candidate's absolute radius.
- Speeds live in one place, `lib/routing/speed.ts`: per-way moving speeds for the displayed riding time and `plannedAvgSpeedKmh` for duration → distance. BRouter's own `total-time` is a flat ~45 km/h and is not shown. `profiles.ts` (Valhalla) only serves isochrones now.

## UX decisions already settled

- **The ride is one ordered list of places, and trip type is asked first.**
  Start, then stops, in riding order; a round trip does not repeat the start.
  Do not reintroduce a separate "Uz" field — on a loop it silently became the
  last stop and nothing could be reordered.
- **One way is the trip-type default and sits on the left**; a round trip is
  the deliberate choice on the right. Two rows reading "No … Līdz …" is what a
  rider expects on open. `returnToStart` is nullable — only `true` is a loop,
  so an unanswered plan must not be read as one.
- **`MapPanel` expanded is `flex flex-col` with the map in `relative min-h-0
  flex-1`**, and where the map lives never depends on whether it has anything
  to show. Both rules exist because the full-screen map became unclosable: a
  zero-height layer, or the map left in the `hidden md:block` desktop cell,
  takes the close button down to 0 x 0 px with it. Check the button's measured
  size, not just that it renders.
- **The form always shows at least two rows** (`MIN_ROWS`, `placesFromPlan`),
  both empty with placeholders — "Rīga" and **"Man vienalga"**. A rider should
  be able to say where from and where to without first finding an add button,
  and the second row must visibly be optional rather than unfinished. Deleting
  the last row empties it instead of removing it. Never go back to one row, and
  never prefill a row with a real value that looks like a hint.
- **A share code carries the resolved coordinates** (`pl` in the plan part),
  taken from what the API says it routed. Without them an edited ride was
  geocoded afresh and "Circle K" could become a different Circle K. Older
  codes carry none; `decodePlanPlaces` returns `[]` and the names are resolved
  as before. Never drop `pl` from the encoder without bumping the version.
- **A POI suggestion shows its street.** "Circle K · degviela · Rīga" is the
  same line for a dozen filling stations; the address is what tells them apart.
- **`remove()` on a place row calls only `onChange`.** The composer's `reorder`
  re-keys the picked coordinates itself, so an extra `onPick(i, null)` writes a
  null at an index that now means a different row — rows and picks then
  disagree about how many places the ride has, and generating is refused.
- **Drag state must be passed into the drag's end, not read back.** Listeners
  created at pointerdown close over `dragging === null`; reading it there meant
  touch reordering silently did nothing.
- **Two categories, named by comparison.** "Ātrāks" and "Sarežģītāks" — a
  superlative can lie, and "Taisnākā" did: measured 43 km / 1 h 22 against a
  "Līkumotākā" of 25 km / 1 h 8, because `directScore` ranked length against
  `targetKm` alone and the longest could win on smoothness. Length is ranked
  against the quickest ride found. `balanced` stays in `RouteVariant` and in
  `VARIANT_LABELS` for share codes that predate the change.
- **Two cards, two names, always.** A typical request routes ~36
  candidates; the API returns the three picks plus `alternatives` (two per
  category) and each card cycles through its own kind with a `⟳ n/m` control.
  Do not add cards and do not invent names: a superlative belongs to one card,
  and "Gluda 2" says nothing. Revealing the whole pool behind one button is not
  "on request" either — it is a delayed *all at once*. Alternatives rank over
  `worthShowing` (capped at `MAX_EXCESS_DRIFT`), not `selection`: only ~11 of
  36 sit inside the budget. Selection is round-robin across categories because
  `distinct()` is stateful — draining one category first starves the others.
  **The offset belongs to `app/page.tsx`, not the panel**: the map is drawn
  there, so panel-local state meant cycling a card changed its numbers and left
  the map on the old line.
- **No placeholder may look like a value, and an error names its field.**
  A grey "Rīga" in the empty start field and a black "Baldone" below it are the
  same shape on a phone; the rider could not see which field was missing, and
  the message talked about the field he had filled. Placeholders say what to
  type or that the row is optional — never an example that reads as an answer.
- **Reordering places is up/down arrows. Do not reintroduce drag-and-drop.**
  Three attempts failed on the rider's iPhone (arrows → grip, pointer capture,
  native non-passive touch listeners); there is no iOS simulator here, so a
  drag can only ever be verified against synthesised events. A tap needs no
  gesture for Safari to claim. The width that motivated the grip is bought back
  by rendering ✕ only when the row has text.
- **A stop is inserted before the destination on a one-way ride.** Appending it
  made the new empty row the last one, which *is* the finish — adding a stop
  silently threw the destination away. A round trip appends, having no finish.
- **A place field is always full width; its controls live inside it.**
  `PlaceInput`'s `trailing` slot, not a column beside the field — a reserved
  column is blank space whenever the control is absent, and the place name is
  the one thing that must not be truncated. The controls are conditional: ✕
  only when the row has text, the grip only from three rows up.
- **Reordering places is a drag handle, never up/down arrows.** Three ~22 px
  targets per row cost more width than the field and none was tappable; one
  36 px grip plus one 36 px ✕ is the same total width. The handle appears only
  from three rows up. Keep all three input paths working: mouse drag, touch
  (pointer capture + row hit-testing — touch fires no `dragover`), and
  ArrowUp/ArrowDown on the focused handle.
- **On a phone the map belongs inside the ride block**, under the places it
  confirms — not `order-first` above the page, where it outranked even
  "Saglabātie". Exactly one MapLibre instance exists: `useMediaQuery` moves the
  single node between the composer slot and the desktop column. Do not render
  it in both places and hide one with CSS — that is a second WebGL context.
- **A saved or shared ride is editable in the form, not only in the chat.**
  "Rediģēt formā" → `/?p=<plan>&from=<code>`; `from` is the origin, which makes
  the chat's back control "Maršruts" and, after a new route is generated, asks
  "Paturēt abus / Aizstāt veco". "Ģenerēt līdzīgu sev" deliberately carries no
  origin — it starts a ride of its own. Note the share code carries place
  *names*, not coordinates, so an edited ride is geocoded afresh.
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
  the route id `#mopik-route` in sync if you change it. **No alcohol or
  tobacco in it** — the loader used to have a cigarette and a beer collected
  along the way, and the rider removed them: Mopik should not encourage riding
  and harmful habits in the same breath. Do not reintroduce them.
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
- **Corridor offsets never depend on the budget alone.** `reach` has a
  floor of 12 % of the leg (min 3 km): a flexible budget once left it at 1 km
  and a 210 km there-and-back retraced 34–49 %. Round-trip ±side candidates
  are mirror images — the −1 side is an asymmetric shape instead.
- **High overlap talks.** Best version > 20 % repeated → the chat says so
  with levers, route still on the map.
- **The surroundings belong to the winding/complex versions, never the
  straight one.** For a via ride, `around-*` (ring around the stop) and
  `zig-*` (one-sided wiggles) candidates compete for those slots; `detour()`
  keeps them out of the direct pick. Rings are small and on the rider's
  profile because forest rings near a town run ~15 km/h and the budget is
  time. Chat: "vairāk apkārtnes" → `surroundings: "more"`.
- **The full-screen control belongs to `MapPanel`, not to a page.** Any map a
  rider can open — planner, shared, saved — must be enlargeable on a phone.
- **On the phone the map yields to words.** 26dvh while the chat speaks,
  42dvh with the result panel, full screen on request (button on the map).
  The chat log scrolls to the start of the latest reply, inside the log only.
- **"Nothing fits" is never an error.** When candidates routed but none
  fits the budget, the API returns the nearest rides plus `infeasible`
  (minimum minutes on this surface, direct km, asphalt and one-way
  estimates) and the chat explains and offers chips; the chat also does the
  via-distance arithmetic before routing (`lib/chat/feasibility.ts`). 422 is
  only for "nothing routed at all".
- **A saved ride id is `rideId(code)`, a hash of the whole share code.** The
  first 24 characters are the metadata prefix and collide across the three
  versions of one request — the old id silently overwrote them.
- **Shared routes live in the URL**, not in storage (`lib/share/route-code.ts`,
  version prefix `1~`). Changing the encoding means bumping the version and
  keeping the old decoder: links in riders' chats must keep working.
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
(16,410 places, LV 7551 / LT 6047 / EE 2812 — villages, manors, hillforts,
fords, viewpoints). Queries are cached under `.poi-cache/`, so a re-run after
changing scores needs no network. Overpass rate-limits a full build into
connection refusals; the script rotates mirrors.

**This is the one thing still Baltics-only, and the rider has asked for
Europe.** Outside the dataset a ride routes and its numbers are real (measured:
München loop, 92 km, 0 % repeated) but loop anchors are geometric, so stops go
unnamed and the ride cannot be planned *through* a hillfort. `COUNTRIES` in
that script is a three-entry list of `(code, bbox)`; adding countries is a data
job. The response carries `sparsePlaceData` and the panel says so out loud.

- `NEXT_PUBLIC_POSTHOG_KEY` (public): PostHog EU project 272078 "Mopiks", org Great
  Success; dashboard "Mopik lietojums" 947311. Set in Vercel production.
  `track()` in `lib/analytics.ts` is a no-op without it. Add new events to
  the `AnalyticsEvent` union and the table in PROGRESS.md.
- Feedback is a DM, not a form: the header and the beer popup link to
  instagram.com/mopik.eu (`components/instagram-link.tsx`). The Resend mail
  form, its dialog and `/api/feedback` were removed — `RESEND_API_KEY` is no
  longer used and can be dropped from Vercel.

**Gotcha:** `vercel blob create-store --yes` (and `vercel env pull` to
`.env.local`) OVERWRITES `.env.local`, keeping only what Vercel knows. It
happened on 2026-09-12; keys were restored from the production environment
(`vercel env pull` to a temp file, then append). Pull to a temp path, never
to `.env.local` directly.

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

**Planned, 2026-09-12 evening:** avoid-area from chat via BRouter `nogos`
(Jūrmala case), "izdomā" → the chat decides, "mix of versions" → profile
adjustment with an explanation. **Planned, decided 2026-09-12:** self-hosted BRouter on a small VPS for
production (the real fix for time drift and single-version results on
brouter.de; needs the rider's hosting account). **Shelved:** LVM GEO data —
measured 0.1 % new road geometry vs OSM, no attributes; only gates/barriers
add information (see `docs/LVM-GEO-2026-09-12.md`). Don't re-research it.

**Rider's-eye audit (2026-09-03, `docs/PROGRESS.md`):** plan items 1–6 are built and measured (profile, speed model, calibration route, places/geocoding, TET sizing, dedupe). Claude parsing is live (`parser: llm`, 4–7 s per new prompt, cached after); BRouter is local; trail lever + forest discount + teardrop shapes + second pass are in (late entry in PROGRESS.md). Open: Riga-start loops still retrace ~36% on the corridors; calibrate `speed.ts` against ridden GPX; UI controls for `noSand`/`avoidTowns`/trail level.


- Distance still overshoots (and undershoots) by region; the corrective re-route from
  cached contours is designed but not wired up — see the audit plan, item 3.
- Direction hints ("uz Siguldas pusi" vs "caur Siguldu") designed, including
  Latvian case handling, not implemented.
- The "string did not match the expected pattern" Safari error was Vercel's
  60 s timeout page parsed as JSON. Generation has a wall-clock budget
  (`TIME_BUDGET_MS`); the client reads bodies as text first. Never let a
  request run to the platform cap.
- Place search ranks rather than excludes (`KIND_GROUP` in `photon.ts`):
  settlements, then addresses, then fuel/food, then landmarks. Do not add back
  an `osm_tag=place:*` query parameter — it silently drops every POI.
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
