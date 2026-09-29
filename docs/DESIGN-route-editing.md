# Route editing and drawing — design (2026-09-28)

Covers backlog 34, 35, 36, 41, 43 (and prepares 32, 42). Rider's brief:
**(1) Mopik generates a route between the points you want (stops and/or
pass-through points); (2) you can draw exactly how you want to ride — say it
unmistakably; (3) you can correct a route made either way.**

Grounded in main at 2b7a634. Today: stops + white shaping points
(`RidePlace.shape`), point sheet (Pārvietot / Padarīt par pieturu / Izņemt),
hold-drag on the line, batches, edits routed and **applied at once** on ✓ (no
preview), 20-step `EditHistory`, `routeThroughPlaces`, share code with `sp`
and `pl`, GPX with `<wpt>` + `<trk>` only. The generator already honours
`plan.shapePoints` (`buildCandidates` → `interleaveShapes`,
`app/api/generate-route/route.ts:480`).

## A. Four concepts

| Concept | Latvian | Meaning | Look |
|---|---|---|---|
| Point, two kinds, switchable both ways | **Pietura** / **Caurbraucams punkts** | Stop: numbered, list row, GPX `wpt` + Garmin via, kept by full search, ridden *through*. Pass-through: no number, no row, only steers (Garmin shaping point). | Stop orange numbered disc; start green „Starts”; finish red „Finišs”; pass-through small white dot with dark edge |
| Line between two points, one type per leg | **pa ceļiem** / **taisni** | By roads: BRouter with the ride's profile and spur rules. Straight: ridden exactly, never re-routed, never checked. | By roads as today. Straight: grey (surface unknown) + its own pattern — thin 3 px stone line with a white 1 px dash („zīmēts”). Legend row „Zīmēts taisni”. No badge. |
| Excluded stretch | **Izslēgts posms** | A piece of road this ride must not use; persists with the ride. | Edit mode only: thin dark-red dashes; tap → „Atļaut atkal”. |
| Preview | chip **„72,4 → 75,1 km · +6 min · atkārtoti 4 → 1 %”** | Every line-changing edit is routed first and shown; nothing enters the ride or undo until ✓; ✕ leaves nothing. | New stretch over the dimmed ride, delta chip in the notice slot. |

A "drawn ride" is not a separate object: it is a ride whose legs are straight.
The leg type is stored on the point that starts the leg (Garmin
CalculationMode, komoot off-grid, OsmAnd "route type after this point"). So
approaches 1 and 2 mix freely in one ride. A leg is named by its ends
(„Starp „Pietura 2” un „Finišs””); „posms” stays the word for a stretch of road.

**"Drawn" is communicated by three layers, no sticky global mode:**
1. At adding: „+” → „Ko pievienot?” — „Pietura” („Mopik atradīs ceļu līdz
   tai”) / „Zīmēt līniju” („Brauksi tieši pa to, ko uzzīmē”).
   *(2026-09-30: the rider reversed the „+” chooser — „+” now always adds
   pass-through points, several in a row, one ✓. Drawing needs its own
   entry when Phase 3 comes; see BACKLOG 34 and 53.)*
2. Drawing is a batch session: field „Zīmē: pieskaries kartē nākamajam
   punktam”; ✓/↶/✕ in the existing slots; after ✓/✕ it is over.
3. Persistent visual language (result, shared page, legend, GPX) and the
   panel line „Zīmēti posmi: 1,2 km · laiks rēķināts ar 15 km/h · Mopik nav
   pārbaudījis, vai tur var izbraukt un vai tas ir atļauts.”

## B. Flows

Global: phone editing always full screen; slots never change (phone bottom
[collapse][field], right column bottom-up slot 1 „+”/✕, slot 2 ↶, slot 3 ✓;
desktop [field][✓][↶][+/✕]). New states only fill existing slots (field
text, notice line, `MapPointSheet`). Every ✓/✕/sheet-close/Escape/row-focus
goes through one exit, `leaveTransient()` (generalised `leaveShape` +
`closePointSel`).

**B1 Generation.** Planning point sheet on a stop gets „Padarīt caurbraucamu”
(row leaves the form, white dot stays, plan carries `shapePoints`). On a dot,
„Padarīt par pieturu” brings the row back. GPX gains `<rte>`. From phase 3,
a plan with a straight leg shows „Savienot punktus” (build without search).

**B2 Drawing (phase 3).** „+” → „Zīmēt līniju”. Session starts from the
finish (one-way), the last point before the return (round trip), or, with an
empty start row, the first tap is „Starts”. Each tap (with `TAP_SETTLE_MS`)
drops a pending dot joined straight to the previous. „Zīmēt no šejienes”
from a point's sheet starts mid-ride; a dotted rejoin line to the next point
reads „Tālāk pa ceļiem līdz „Pietura 3””. Field: „Zīmēts: 3 punkti · 1,4 km”.
One-time notice: „Taisnās līnijas Mopik nepārbauda — vai tur var izbraukt un
vai tas ir atļauts, zini tu.” ↶ = „Noņemt pēdējo punktu”, ✕ = „Atcelt
zīmēšanu”, ✓ = „Apstiprināt zīmējumu” (spins while the rejoin is routed).
Extending past a one-way finish: the old finish becomes a numbered stop, the
last drawn point becomes „Finišs”. In planning, ✓ keeps the chain in the plan
and „Savienot punktus” calls `/api/build-route`; card kicker „Pēc taviem
punktiem”.

**B3 Correct any ride.**

Point sheet rows:

| Point | Rows |
|---|---|
| Stop | Pārvietot / „Padarīt caurbraucamu” (P1) / „Zīmēt no šejienes” (P3) / Izņemt |
| Pass-through | Pārvietot / „Padarīt par pieturu” / „Zīmēt no šejienes” (P3) / Izņemt |
| Start / Finish | Pārvietot / „Zīmēt no šejienes” (P3) |

Title „Caurbraucams punkts” (replaces „Maršruta punkts”). Kind switch changes
no line: commits at once as one undo step. Pārvietot and Izņemt go through
the preview.

Line tap in edit mode opens the **segment sheet** (result/shared maps keep
the card; a tap still never grabs — hold 350 ms + 12 px bends). Title „Ceļa
posms · 1,2 km” with `segmentHeading`; on a straight leg „Taisns posms · 0,8
km” + honesty line.
- Group „Starp „A” un „B”” (P2): „Braukt taisni” („Līnija būs tieši tāda, kā
  uzzīmēta”; disabled over 5 km with „Taisni var braukt tikai līdz 5 km —
  vispirms pievieno punktu pa vidu”) or „Braukt pa ceļiem”; „Pievienot punktu
  šeit” (pass-through on the line, line unchanged, commits at once).
- Group „Šis posms” (P4), selection in yellow `route-highlight` with two end
  handles („Velc galus, lai precizētu posmu”): „Izslēgt šo posmu” („Maršruts
  to apies”); „Atpakaļ pa citu ceļu” (only on a retraced stretch; selection
  snaps to the second pass); „Brauc caur citurieni” (43: hint „Norādi kartē,
  caur kurieni braukt” + dashed lines from stretch ends, preview, ✓/✕; new
  point is pass-through).
- Excluded stretch: sheet „Izslēgts posms” with „Atļaut atkal”.
- Status chip „{km} km braukti divreiz · parādīt” jumps to the first
  retraced stretch (not a map badge).

Far from a road: the off-road bar gets a third button — title „Šeit ar šo
profilu nevar piebraukt. Tuvākais ceļš ir ~{m} m nostāk.”; „Pārvietot uz
tuvāko ceļu” (≤ 500 m) · **„Savienot taisni”** (≤ 1000 m) · „Izvēlēties citu
vietu”. Connect keeps the point; router to nearest road + straight connector;
note „Pēdējie {m} m līdz „{name}” — taisni, bez ceļa.” (+ „…un atpakaļ pa to
pašu līniju” if in and out meet the road at one spot). Replaces the edit
`snapToLine` >500 m refusal (`pickOffRoadTitle`).

Impossible, said: „Šo posmu apbraukt nevar — starp „{a}” un „{b}” cita ceļa
nav.” / „Šajā posmā ir pietura „{name}” — vispirms pārvieto vai izņem to.” /
„Caur šo vietu šo posmu aizstāt nevar — izvēlies citu vietu.” Ride kept.

**B4 Preview and undo.** Any pending line-changing mark routes immediately in
the background (250 ms debounce while dragging, stale answers dropped by
token). Routing: ✓ spinner (same slot), notice „Pārrēķinu…”. Landed: new
stretch over dimmed ride, chip „{a} → {b} km · {±t} · atkārtoti {r1} → {r2}
%”, ✓ „Apstiprināt izmaiņu” commits instantly, ✕ „Atmest izmaiņu”. Refused:
reason in the notice, ✓ disabled or the off-road bar. `EditHistory` gets only
committed proposals. Notes belong to a proposal and die with it (fixes the
lingering „Punkts pārvietots N m…”).

**B5 Chained edits (release B, rider 2026-09-28).** While a landed
proposal is shown, starting another edit — pressing or dragging another
point, dragging the line, adding a point, a kind switch, a point dropped on
the line — chains it: the proposal is kept (not in the ride, not in the
history) and the next edit is routed on top of it, as if it were committed.
The preview shows every pending change, the chip the total against the
committed ride, and from two on the guidance says „2 izmaiņas – ✓ apstiprina
visas, ↶ atsauc pēdējo, ✕ atmet visas.” ✓ commits the top as ONE history
step; ↶ takes the last pending change off; ✕ (and Escape) drops them all.
A change on a warned one inherits the warning, so only „Tomēr braukt”
commits the chain (`mayCommit`). A proposal still routing is not chained —
the new edit replaces it, as before. Same slots, same buttons; chaining
changes nothing about spurs. Model: `lib/map/edit-chain.ts`; page:
`stackProposal` / `chainConfirm` / `chainUndo` / `chainDiscard` in
`home-page.tsx`; composer: `stackFirst` in `ride-composer.tsx`.

## C. Data model

```ts
type RidePlace = ResolvedPlace & {
  joins?: [Point, Point]; grabbedAt?: Point;
  shape?: true;          // pass-through; absent = stop
  next?: "straight";     // P2: leg from this point to the next anchor is straight
  reach?: "straight";    // P2: off-road, joined straight from where the road ends
};
```
Plan (`lib/chat/ride-plan.ts`, optional, absent when empty so `rideId()` and
old codes are unchanged): `shapePoints` (exists), `straightLegs?: number[]`
(anchor index over `[start, ...interleaveShapes(stops, shapePoints)]`),
`reachStraight?: number[]`, `avoid?: {line: [lat,lon][]}[]` (≤ 10 × ≤ 24 pts,
P4). `planWithPlaces` derives, `placesFromRide` re-applies; `RidePlaces`
stays the source of truth.

Segments: `RouteSegmentProperties.drawn?: true`; drawn features carry
`roadClass: "trail"`, `surface: "unknown"`, `drawn: true` (conservative
fallback). Check `drawn` first in `summariseSegments` (`drawnKm`),
`segmentSpeedKmh`, `warningsFor`/`badgesFor` (no 🔥), the three class layer
filters, `segmentInfoHtml`. New `lib/routing/drawn.ts`: `drawnFeature`,
`connector`, `DRAWN_KMH`, `densify(≤ 50 m)`.

Share code (version stays "1"): plan keys `sl`, `rs`, `x` (written only when
non-empty); class dictionary key `"trail|unknown|d"`; meta `dk`. Old codes
decode byte-identically (pin a production fixture).

GPX: `<wpt>` as today (never pass-through points); **new `<rte>`** (after wpt,
before trk) with `xmlns:trp` TripExtensions v1: one `<rtept>` per anchor
(start repeated on a round trip), stops/ends `<trp:ViaPoint>`, pass-through
`<trp:ShapingPoint/>`, first point of a straight leg as ViaPoint with
`CalculationMode` Direct (verify against the XSD and a BaseCamp import).
`<trk>` authoritative, drawn stretches densified. Export body gains
`routePoints`.

Duration: drawn and connector metres at `SPEED.drawn = 15` km/h, stated.

Invariants: straight legs start/end exactly at anchors (continuity by
construction). `planEdit` treats straight legs as fixed intervals (windows
clamp, `pieceAround` never crosses, a moved neighbour rebuilds the straight
leg locally). `routeThroughPlaces` sees only routed legs; loose ends next to
straight legs get no fence search; `pruneSpurs` and build-route never cut
drawn geometry. A „Savienot taisni” stub is a stated, deliberate retrace.
Only „Braukt pa ceļiem” re-routes a straight leg; „Optimizēt” (32) keeps them.

## D. Routing and API

1. `/api/reroute-leg`: per-run `loose?: boolean[]` (no nudge-refusal, no spur
   fence; client closes with `connector()`); per-run `fence?` (P4) →
   `nogosAlong`; `plan.avoid` → no-go circles on every leg; fence-only refusal
   → `422 {error: "no-way-round"}`. Client never sends straight runs.
2. `fetchRoutePath` gains `nogos?`; `routeThroughPlaces` merges fences with
   avoid under `MAX_NOGOS = 80` (avoid ≤ 40). Full search: request-scoped
   `withAvoid(nogos, fn)` (AsyncLocalStorage in `lib/routing/brouter.ts`).
3. Exclude (`lib/routing/stretch.ts` `planAvoid`): run clamped to anchors ±
   `EDIT_WINDOW_M`, never across a straight leg; a stop inside → refused; a
   pass-through inside → dropped and said.
4. Back another way (`retracedPasses`): run around the second pass, fence the
   first, `keepClear` at anchors.
5. Via instead (`planViaInstead`): run [selFrom − W, selTo + W] clamped;
   points [cut, new pass-through, cut]; fence the selected stretch.
6. Far from a road: `/api/routable-point` and `snapToLine` yield `{tooFar,
   snappedTo}`; „Savienot taisni” sets `reach` (≤ `CONNECT_MAX_M` 1000).
7. `/api/build-route` (P3): runs of routed legs via `routeThroughPlaces`,
   straight legs via `drawnFeature`, `classifyRoute`, `name-route`; one
   route, `variant: "built"`; `maxDuration` 20.

## E. Phases

Each phase starts with a **contract commit** (types, optional props, all
message keys in lv/lt/et/en, analytics names, stub modules, one-line anchor
calls in `route-map.tsx`). Packages then edit shared files only inside fenced
regions (`// ── P1-D ──`); `messages.ts` only via the contract (later
additions in a fenced block per locale). Verify: dev server restarted, local
BRouter, real ride, 375×812 full screen and 1280×800; `[data-slot]` rects
identical across states.

**Phase 1 — Pietura ↔ Caurbraucams, preview before commit, Garmin GPX.**
Contract C1: `lib/map/edit-proposal.ts` types (`EditProposal`, `ProposalView
{text,title,tone?,line,changed}`), `ShapeEdit` `{kind:"demote",stopIndex}`,
`RideEdit.onPropose?/proposal?`, route-map `proposal?`,
`MapPendingMark.confirmBusy?`, sheet icon "pass", stub
`components/map/proposal-layer.ts` (`useProposalLayer(mapRef, ready,
proposal)`), copy keys `pointDemote`, `previewDelta`, `previewRouting`,
`previewConfirm`, `previewCancel`, „Caurbraucams punkts”.

| Pkg | Owns | Work | Tests |
|---|---|---|---|
| P1-A engine | `lib/map/edit-proposal.ts`, `lib/routing/reroute-leg.ts` | reducer idle → routing(token) → proposed/refused; ✓ while routing = confirm-when-ready; ✕ → idle; stale dropped; `editDelta()`; `applyShapeEdit` demote | `edit-proposal.test.ts`; demote↔promote round-trip; `planWithPlaces` after demote |
| P1-B page | `components/home-page.tsx` | split `reroutePlaces` → `proposePlaces()` + `commitProposal()`; proposal state, 250 ms debounce; kind switches commit at once; notes on the proposal | browser both sizes: move stop, chip, ✓/✕; after ✕ history and line identical |
| P1-C composer | `ride-composer.tsx`, `lib/map/point-selection.ts`, `shape-pending.ts`, `batch-commit.ts` | pending → `onPropose`; ✓ commits (`confirmBusy`); via actions [move, demote, remove]; planning pass-through dots → `plan.shapePoints`; `leaveTransient()` | `point-selection.test.ts`; grep test that every exit calls `leaveTransient` |
| P1-D map | `components/map/proposal-layer.ts`, fenced `route-map.tsx` | proposal layers (real colours + yellow halo), route dimmed 0.3, chip in notice slot, ✓ spinner without moving slots | `phone-map-layout.test.ts`: busy ✓ keeps slot 3 (`invisible` not `hidden`) |
| P1-E GPX | `lib/gpx/*`, `app/api/export-gpx/route.ts`, GPX parts of `result-panel.tsx`, `shared-route.tsx` | `rideRoutePoints()`; `<rte>` with trp Via/Shaping | `gpx-route.test.ts` (order, count, namespace), gpxpy, BaseCamp/OsmAnd import |

**Phase 2 — Taisni (35).** Contract C2: `next`/`reach`, `drawn`,
`straightLegs`/`reachStraight`, `SPEED.drawn`, `MapControls.onLineTap`,
`segmentSheet`, `offRoad.onConnect`, sheet row `detail`/group `heading`, stub
`components/map/drawn-layer.ts`. Packages: P2-A routing (`drawn.ts`,
`reroute-leg.ts`, `speed.ts`), P2-B server (`reroute-leg` route,
`through-stops.ts`), P2-C map (`drawn-layer.ts`, fences, `map-point-sheet.tsx`),
P2-D composer (`lib/map/segment-selection.ts`, `ride-composer.tsx`), P2-E
page/panel (`home-page.tsx`, `result-panel.tsx`; full search disabled with
reason on straight legs), P2-F share/GPX (`route-code.ts`, `shared-route.tsx`,
`lib/gpx/*`).

**Phase 3 — Zīmēt (41).** P3-A `lib/map/draw-session.ts`; P3-B
`app/api/build-route/route.ts` + `lib/routing/build-ride.ts`; P3-C composer
(„+” chooser, session, „Zīmēt no šejienes”, „Savienot punktus”); P3-D map
`components/map/draw-layer.ts`; P3-E page (`startFromForm` → build-route,
„Pēc taviem punktiem”). Measure `MAX_SHAPE_POINTS` 20 → 40.

**Phase 4 — Posms (36, 43).** P4-A `lib/routing/stretch.ts`; P4-B server
(fence, avoid no-gos, `no-way-round`, `withAvoid`); P4-C map
`components/map/stretch-handles.ts` + excluded layer; P4-D composer; P4-E page
and share (`plan.avoid`, key `x`, retraced chip). Backlog 42 later reuses the
selection UI with a server store.

Order P1 → P2 → P3 → P4.

## F. Defaults taken (rider may change)

1. Drawn/connector speed 15 km/h, stated.
2. „Meklēt labāku apli” disabled on rides with straight legs: „Braucienā ir
   zīmēti posmi — pilnā meklēšana tos izmestu. Labo uz kartes.”
3. Preview in real surface colours with a yellow halo over a dimmed ride (not
   grey — grey means surface unknown and drawn).
4. Drawing past a one-way finish: old finish → numbered stop, last drawn
   point → „Finišs”.
5. „Savienot taisni” up to 1 km, always stated; beyond, only „Zīmēt līniju”.
