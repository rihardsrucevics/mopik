# Routes through private property — an options paper

Backlog item 12. The rider asked *how* to solve this, not for a particular
fix, so this is an options paper with measurements, not a proposal. Written
2026-09-14 by a read-only investigation; nothing in `lib/` was changed.

The complaint, in the rider's words: routes run through private property.
Sometimes harmless, sometimes it is somebody's farmyard, which is not all
right to ride through. OSM access tags are already respected. **A house or a
homestead with no access tag at all is the hard case**, and the measurements
below say that this is not an edge case — it is essentially the whole case.

---

## 1. How often, and where

### Method

Six rides on the default Adventure profile (hard difficulty, Sports style,
Meži surface — `gravelPreference` 100, `trailPreference` lots,
`accessPolicy` allow_unverified, `preferForest`, `avoidMainRoads`), generated
through `POST /api/generate-route` with `debug: true` so every edge carries
its raw OSM tags. For each route's bounding box, Overpass supplied every
`building=*` way, every `landuse=farmyard` / `landuse=residential` polygon,
every `barrier` node, and every highway carrying an explicit
`access`/`motor_vehicle` restriction.

Each ridden edge of class `track`, `service`, `unclassified`, `residential`
or `living_street` was then measured against the nearest building centroid.
Two bands, because they mean different things to a rider:

- **≤ 25 m — "you are in the yard".** At Latvian homestead scale the drive
  passes between the house and the barn; 25 m from a building centroid is
  inside that.
- **25–50 m — "past the farmstead".** Visible from the kitchen window, but
  plausibly a public road that happens to run by.

The geometry is projected per route (a local metric frame at the route's own
latitude, the same lesson `tet-coverage.ts` learned the hard way), so the
distances are metres and not degrees.

### What came back

| Ride | km | Edges ≤ 25 m of a building | km | Of those, `track`/`service` | km | Gate/barrier nodes on the line | In a `farmyard` polygon |
|---|---|---|---|---|---|---|---|
| Sigulda round trip | 77.5 | 38 | 18.8 | 16 | 3.33 | 3 | 1 |
| Cēsis → Madona | 144.4 | 16 | 27.2 | 2 | 2.18 | 14 | 0 |
| Rīga → Baldone | 59.1 | 33 | 6.0 | 7 | 1.06 | 13 | 0 |
| Tukums → Kandava | 64.2 | 19 | 5.0 | 8 | 1.65 | 2 | 0 |
| Kuldīga round trip | 131.7 | 26 | 14.6 | 10 | 1.38 | 3 | 0 |
| Bauska round trip | 124.7 | 55 | 28.7 | 17 | 7.12 | 3 | 2 |
| **Total** | **601.6** | **187** | **100.4** | **60** | **16.7** | **38** | **3** |

Read the wide column with care. 100 km of "within 25 m of a building" out of
601 km does **not** mean a sixth of every ride trespasses: most of it is
`unclassified` — ordinary Latvian village gravel road, public, with houses
along it. That is not the complaint and banning it would delete the country.

**The column that matters is `track`/`service` within 25 m of a building: 60
edges, 16.7 km, 2.8 % of the total distance ridden.** That is the shape of
the real problem — roughly **one to three genuinely suspect stretches per
ride, 1–7 km per ride**, concentrated in farmland. Bauska, a pure-farmland
loop, has 17 of the 60 and 7.1 of the 16.7 km; forest rides (Kuldīga, Rīga →
Baldone) have far less.

### Concrete examples

Coordinates are `lat,lon`; the way id is the **building**, since BRouter does
not report way ids for the road itself (see §2). Paste a coordinate into
openstreetmap.org to look at it.

| # | Ride | Class | km | Nearest building | Coordinates | Note |
|---|---|---|---|---|---|---|
| 1 | Bauska | `track` | 0.57 | **3 m**, `building=yes` w1051342986 | 56.59492,24.18093 | Closest hit in the whole set — the line runs against the wall |
| 2 | Bauska | `track` | 0.74 | 12 m, `building=yes` w949184127 | 56.59994,24.17534 | **Inside `landuse=farmyard` w949187059** — the textbook case |
| 3 | Bauska | `track` | 0.64 | 7 m, `building=yes` w996488608 | 56.61478,24.08269 | Farmstead cluster, two tracks through it |
| 4 | Cēsis → Madona | `track` | 2.10 | 10 m, `building=yes` w1474820940 | 57.14126,26.16736 | Longest single suspect stretch found |
| 5 | Sigulda | `service` + `track/grade5` | 0.10 + 0.06 | 8 m / 13 m, `building=yes` w113900940 | 57.14827,24.88483 | **`barrier=gate` on the line**, and an `access=private` way (w221989092) 100 m away |
| 6 | Tukums → Kandava | `track` | 0.41 | 7 m, `building=service` w1334826619 | 56.97543,23.14971 | Yard track between outbuildings |
| 7 | Tukums → Kandava | `service` | 0.13 | 17 m, `building=house` w216419724 | 57.03380,22.78204 | **A `barrier=gate` sits on it at 3 m** — house plus gate is about as clear as OSM gets |
| 8 | Rīga → Baldone | `service` | 0.30 | 4 m, `building=service` w387157793 | 56.93378,24.10435 | Industrial yard; `access=private` way w387157805 adjacent |
| 9 | Sigulda | `track` | 1.20 | 19 m | 57.13943,24.95324 | **Inside `landuse=farmyard` w362217959** |
| 10 | Kuldīga | `residential` | 0.96 | 13 m, `building=detached` w790959826 | 57.06864,22.29128 | A private-feeling lane, correctly tagged residential — the false-positive risk |

### The finding that decides everything else

Three facts, each measured across all six rides:

1. **Every single `service` way the router rode carries no `service=*`
   subtag.** 33 of 33. The profile already forbids `service=driveway` and
   `service=parking_aisle` — and it caught nothing, because Latvian mappers
   do not add the subtag. Meanwhile 63–100 % of ridden `service` km per ride
   is within 50 m of a building. The existing ban is aimed at a tag that is
   not there.
2. **Almost no flagged edge carries any access tag at all.** Across 187
   flagged edges the entire set of access tags is: one
   `motor_vehicle=destination`, two `access=permissive`, two
   `motor_vehicle=permissive`, one `motor_vehicle=yes`. Zero `private`, zero
   `no`. This confirms the backlog's framing exactly — respecting access tags
   was never going to solve this, because **the tags are absent, not
   permissive**. It matches the Sigulda count already in `PROGRESS.md`: only
   3 of 91 tracks carry `motor_vehicle=no|private`.
3. **`noexit=yes` appears on zero flagged edges.** The "dead end at a house"
   signal is not mapped in Latvia either.

So: OSM in rural Latvia says nothing about who owns the yard. The only thing
it reliably records is **that there is a building there** — and that is a
signal the routing profile structurally cannot see.

---

## 2. What signals exist, and what BRouter can actually use

This section is the hard constraint on the whole problem, so it is worth
being exact. BRouter's profile language can only test tags that exist in its
`lookups.dat`. Anything else makes the server reject the profile with a bare
500 and no message (a trap already recorded in `CLAUDE.md`). The file is
plain text at `../brouter-server/dist/brouter-1.7.10/profiles2/lookups.dat`
and was read directly for this paper.

| Signal | In `lookups.dat`? | Usable in the profile? |
|---|---|---|
| `service=driveway` | **Yes**, way context | Yes — already forbidden. **Catches nothing:** 0 of 33 ridden service ways carry any subtag |
| `barrier=gate` / `lift_gate` / `bollard` | **Yes**, node context | Yes — already priced (gate 200 m, bollard 5000 m). Could be raised |
| `access=private` / `no` on *this* way | **Yes**, way + node | Yes — already forbidden. Present on ~0 of the problem edges |
| `noexit=yes` | **Yes**, way + node | Yes, but measured absent on every flagged edge |
| `access=private` on an **adjacent** way | Yes on that way, but | **No.** A cost script sees one way at a time and has no neighbourhood |
| **`landuse=farmyard` / `residential`** | **No — the key `landuse` is absent entirely** | **No.** BRouter cannot read landuse polygons. This is a hard wall, not a tuning question |
| **`building=*`** | **No** | **No.** Buildings are not in the routing graph at all |
| Way dead-ends at a building | n/a | **No.** Requires graph topology plus building geometry |
| `estimated_town_class` | Yes | Yes — **but measured useless here:** absent on 175 of 187 flagged edges, and on 56 of 60 `track`/`service` ones. BRouter's town estimate is built from building *density*; an isolated homestead is not a town, so it reads as open country |

The full way-context key list contains `highway`, `surface`, `tracktype`,
`smoothness`, `access`, `motor_vehicle`, `motorcycle`, `vehicle`,
`agricultural`, `service`, `noexit`, `ford`, `motorroad`, and the four
`estimated_*` classes — and nothing spatial.

**Conclusion for §3:** every signal that actually discriminates a farmyard
(building proximity, farmyard polygon, dead-ending at a house) is invisible
to the routing profile by construction. Any option that catches the real
cases needs a **preprocessing or post-routing step in Mopik's own code** —
`classify.ts` / `score.ts` — not a `.brf` edit.

One more constraint, from `lib/routing/brouter.ts`: **BRouter's message rows
carry no OSM way ids** (`wayId: undefined`, with a comment saying so). Any
Mopik-side matching must therefore be **geometric** — route coordinates
against building coordinates — exactly as this paper measured. That is fine;
it is the same approach `measureOverlap` and `tet-coverage.ts` already take,
and it is cheap.

### Overpass latency, measured

Because option (b) depends on it: one `way["building"]` query over a single
route's bounding box took **90.6 s** for the Sigulda box (0.2°, 7,946
buildings) and **40.2 s** for a Tukums box (0.15°, 5,809 buildings), against
mirrors that also returned 406 and 429 during this work.

`maxDuration` for the generation endpoint is **60 s**, and a typical request
already routes ~36 candidates. **On-the-fly Overpass is not viable** — not
"slow", but larger than the entire request budget for a single query, before
any routing happens.

---

## 3. The options

### (a) Profile-only tweaks

Anything expressible in the `.brf` script.

**What it can catch from §1:** example 5 and example 7 — via the `barrier=gate`
already on the line. Raising the gate cost from 200 m to, say, 2000 m would
make the router prefer almost any alternative. That is 2 of 10 examples, and
across all six rides 38 barrier nodes were touched.

**What it cannot catch:** examples 1, 2, 3, 4, 6, 9 — the yard tracks. There
is no tag on those ways for the profile to test. `landuse=farmyard` is not in
`lookups.dat` at all, so the farmyard idea in the backlog note is not
available at this layer, full stop.

**What it would wrongly forbid:** raising the gate cost hits forestry gates,
which `moto-profile.ts` already notes "stand open more often than not". Of
the 38 barrier nodes touched, several are `barrier=kerb` on ordinary
residential streets (Cēsis → Madona has two such on 2 km of street) — kerbs
are not access control and should be excluded from any such rule. A blanket
`highway=service` ban is the other tempting profile-only move: it would catch
33 of the flagged edges at a cost of only 10.5 km of service riding across
601 km — but it would also close legitimate yard-to-road connections, and it
does nothing at all about tracks, which are the larger and angrier half of
the complaint.

**Effort:** hours. One file, existing patterns, one `scripts/experiment-profile.ts`
run to confirm nothing regressed.
**Runtime cost:** zero.
**Verdict:** cheap and worth doing, but it addresses perhaps a fifth of the
problem and none of the farmyard cases the rider actually named.

### (b) Post-routing building-proximity penalty, from a prebuilt dataset

Compute each candidate's "yard exposure" in Mopik's own code — the exact
measurement in §1 — and feed it into `score.ts` alongside `repeatedPercent`
and the trail shortfall, or use it as a hard bound in `meetsRideLimits`.

**On-the-fly Overpass is ruled out** by the 40–90 s measurement above. A
**prebuilt building dataset** is the viable form, and the project already has
the machinery: `scripts/build_poi_dataset.py` builds
`public/poi-baltics.geojson` (16,410 places) from Overpass with a
`.poi-cache/` layer and mirror rotation. A buildings layer is the same job
with a different query — but far bigger: the six route boxes alone held
7,957 / 18,043 / 46,305 / 4,214 / 8,743 / 13,098 buildings. Latvia in full is
order 10⁶. Storing centroids only, at 5-decimal precision in a binned grid,
that is tens of MB for Latvia — shippable, but it is a real data-engineering
job, and **the Europe-wide version of it is not** (item 8's POI build is
already the project's most painful data task, and buildings are two orders of
magnitude larger).

**What it catches:** all ten examples. It is the only option that sees the
actual signal.

**What it would wrongly forbid — and this is the crux.** A legitimate gravel
track past a farmstead is what the app is *for*. The discriminating power was
measured directly across all 125.9 km of `highway=track` in the six rides:

| Band | track km | share of all track |
|---|---|---|
| Within 25 m of a building | 9.84 | **7.8 %** |
| 25–50 m | 23.74 | 18.9 % |
| Beyond 50 m | 92.3 | 73.3 % |

**25 m is a usable threshold and 50 m is not.** At 25 m a rule touches under
a tenth of the track riding; at 50 m it touches better than a quarter, which
would visibly flatten the product. This is the single most important number
in the paper: it says the idea is workable, but only with a tight radius.

Even at 25 m the false positives are real — example 10 (Kuldīga, a
`residential` lane past detached houses, 13 m) is a public road. So the
penalty should be weighted by class: a `track` or `service` at 13 m is a
yard; an `unclassified` or `residential` at 13 m is a village street. The
§1 numbers already split that way — restricting to `track`/`service` cuts
187 flagged edges to 60 and 100 km to 16.7 km, which is almost exactly the
"real problem" set.

**Effort:** days. A build script, a shipped dataset, a grid index, a term in
`score.ts`, and a decision about Europe.
**Runtime cost:** small if prebuilt — a grid lookup per candidate edge, the
same order as `measureOverlap`, which already runs on every candidate.
**Verdict:** the only option that actually solves it, at a real data cost.

### (c) Tell the rider instead of avoiding

Surface yard exposure as a number and a map badge, the way unverified access
already works. The machinery exists end to end: `quality.unverifiedPathKm`
is computed in `classify.ts`, travels per segment as `unverified`, is carried
through the share code, and shows in `result-panel.tsx` as a "⚠️" risk row
with km and percent. A `yardKm` field would follow the same path exactly.

**What it catches:** everything (b) catches, since it uses the same
measurement — it simply reports rather than avoids.
**What it wrongly forbids:** nothing. That is both its virtue and its flaw.
**Effort:** hours to a day *on top of* (b) — it needs the same dataset. On
its own, without (b)'s data, it can only report gates and the useless
`service=driveway`.
**Runtime cost:** zero beyond (b).
**Verdict:** the right companion to (b), the wrong thing on its own. And it
is in tension with the rider's stated preference — see §4.

### (d) Rider feedback loop

Let the rider mark a stretch as private from the app, store it, and avoid it
in future — either as a Mopik-side blocklist or as BRouter `nogos` (already
planned for the Jūrmala avoid-area work in `CLAUDE.md`'s open items).

**What it catches:** nothing on the first ride — by construction it only
learns after somebody has already ridden through the yard, which is the
thing being complained about.
**What it wrongly forbids:** nothing, and it is the only option that produces
*ground truth*. It is also the honest long-term answer, and its output would
eventually be worth contributing back to OSM.
**Effort:** days — a map interaction, storage (the app currently keeps rides
in the URL and localStorage, so this needs a real store), and a routing hook.
**Runtime cost:** small.
**Verdict:** valuable, but it is a second phase. It cannot be the first move
because it has a cold start and the cold start is the complaint.

---

## 4. Recommendation

**Primary path: (b), with a 25 m radius, restricted to `track` and `service`,
from a prebuilt Latvian building-centroid dataset, wired into `score.ts` as a
ranking penalty — and, where a candidate is badly exposed, into
`meetsRideLimits` as a bound.** Add (a)'s gate-cost raise alongside it, since
it is nearly free. Build (c)'s badge on the same measurement so the rider can
see what was found. Keep (d) for later.

Why this one, in the rider's terms:

- **He would rather be told a ride is impossible than get one that rides
  through a yard.** That settles the (b)-versus-(c) question: a warning badge
  is the wrong primary answer, because it hands the rider a route he has
  already said he does not want and asks him to check it himself. The
  measurement should change which route wins, not merely annotate the loser.
  (c) still earns its place — for the residual cases at 25–50 m, where
  avoiding would cost more than it saves.
- **He values genuine tracks**, and the 7.8 % number says he can have them.
  This is what makes the recommendation safe rather than a guess: at 25 m,
  restricted to `track`/`service`, the rule touches 16.7 km out of 601 and
  leaves 92.3 km of the 125.9 km of track riding — 73 % — untouched by any
  radius at all. A 50 m rule would take better than a quarter of the track
  network, and that is the version to refuse.
- **Nothing cheaper works.** §2 is the load-bearing section: `landuse` and
  `building` are not in BRouter's vocabulary, `estimated_town_class` is blank
  on 175 of 187 yard edges, `service=driveway` catches 0 of 33, `noexit`
  catches 0, and explicit access tags catch essentially 0. The profile layer
  has no signal to work with. The measurement has to happen in Mopik's code,
  and — at 40–90 s per corridor against a 60 s budget — it has to happen
  against prebuilt data.

The one thing to settle with the rider before building it: **Latvia first, or
Europe.** Latvia is a weekend's data work and fixes the rides he actually
takes. Europe is a substantially larger dataset than item 8's POI build,
which is already the project's hardest data job. Mopik went Europe-wide on
2026-09-13, so a Latvia-only yard filter means the feature is silently absent
abroad — the same honesty problem `sparsePlaceData` solves for POIs, and it
should be solved the same way: say so out loud rather than let the rider
assume the check ran.

---

## Reproducing this

Rides were generated against the dev server on port 3000 with the plan above
and `debug: true`; OSM context came from Overpass over each route's bounding
box (buildings, `landuse=farmyard|residential`, barrier nodes, and highways
with explicit access restrictions), and proximity was measured in a local
metric projection per route. Scripts were written to the session scratchpad,
not to the repo, since this was an investigation rather than a change.

`lookups.dat` is plain text — `grep` it before proposing any profile tag, and
remember that an unknown value there is a bare 500 with the reason only in
`brouter.log`.
