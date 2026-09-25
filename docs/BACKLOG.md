# Backlog

The rider's own list, in his order. Started 2026-09-14. Items move out of here
into `docs/PROGRESS.md` with measurements when they are done.

Ordering is the rider's, not an estimate of effort. When an item turns out to
be two jobs, split it here rather than quietly doing the easy half.

---

## 1. ~~A stop added to a round trip must land before the return leg~~ — DONE 2026-09-14

Reported 2026-09-14, with the exact steps:

1. Choose "Turp un atpakaļ".
2. Enter Rīga → Baldone (so the ride is Rīga → Baldone → Rīga).
3. The list shows Rīga → Baldone.
4. Press "Pievienot pieturvietu".
5. **The list must become: Rīga, `[ievadi pieturvietu]`, Baldone, Rīga** —
   the new stop goes *before* the existing places, and the return to the start
   is visible as its own row.
6. **The stop must also be movable into the Baldone → Rīga leg**, i.e. after
   Baldone and before the closing Rīga.

What this asks for that does not exist today: on a round trip the closing
return to the start is implied, not a row, so there is no leg between the last
stop and home for a stop to be moved into. Point 6 is the real work — the
composer has to show the return as a row that places can be ordered around,
without letting it be edited into a different place.

Related settled rule in `CLAUDE.md`: a stop is inserted *before the
destination* on a one-way ride, and appended on a round trip "having no
finish". Point 5 says that appending is wrong for a round trip too. Read that
rule before changing the insert position — it was written to fix a real bug
(appending on a one-way ride silently threw the destination away).

**Done.** `addStop` now inserts before the places already named on both trip
types, and the return home is a row rather than a caption.

Point 6 turned out to need no new mechanism: on a round trip the last row
*already is* the leg before home, and `move` could always reach it. What was
missing was that the return was a footnote, so the leg it closes was invisible
and the last row did not read as "before Rīga". Making it a row was the fix;
giving it a control of its own would have duplicated the last row's arrow.

Verified in the browser on the rider's own steps: Rīga → Baldone, round trip,
"Pievienot vietu" gives `Rīga, [empty], Baldone, ↩ Atpakaļ uz Rīga`, and the
empty stop moves into the Baldone → Rīga leg with the ordinary arrow.

## 2. ~~Let the rider cancel a generation in progress~~ — DONE 2026-09-14

Once "Izveidot maršrutu" is pressed there is no way back: the rider waits for
whatever comes, even after realising they typed the wrong place. This matters
more since the routing moved to our own server — a long ride legitimately
takes the better part of a minute (Rīga → Tallinn measured at 52.8 s), so the
wait is now long enough to regret.

Nothing of this exists today. `app/page.tsx` guards re-entry with `busyRef`
but holds no `AbortController`, so the fetch runs to completion regardless;
the loader (`components/route-loader.tsx`) has no control on it.

Two halves, and the second is the one that actually saves anything:
- **Client:** an `AbortController` per generation, a cancel control on the
  loader, and putting the form back the way it was — not an error state, since
  the rider chose this.
- **Server:** an aborted request should stop the work. `generate-route` fans
  out ~36 routing calls; if the client disappears they currently all still run
  and are still paid for in time on our own BRouter. `req.signal` is the hook.

**Done.** An `AbortController` per generation, an "Atcelt" control on the
loader, and `outOfTime()` on the server now also returns true when
`req.signal.aborted` — so the batch loop stops instead of finishing candidates
nobody is waiting for. Verified on Rīga → Tallinn: the loader offered Atcelt,
the request stopped, and the server logged "stopping after 4 of 5 candidates".
A cancel deliberately leaves no message and no retry: the rider chose it.

The control started as a small link inside the animation card; the rider said
it was too easy to miss and too small to hit. It is now its own full-width
row *under* the card — measured 571 x 44 px against roughly 50 x 24 before —
so it is not competing with a moving picture for attention.

Also fixed here, reported while testing: a stop the rider had just added but
not yet typed into had no ✕, so it could only be left empty. Removing now
shows for any row beyond the two the form always offers.

## 3. ~~A failure must speak in the chat, not in a box below the fold~~ — DONE 2026-09-14

Reported 2026-09-14: "to error paziņojumu neredz, tam ir jābūt iekš čata."
Correct — the chat panel sits there empty with the rider's own line at the
top, while the explanation is in a yellow box underneath the whole panel,
off-screen on a laptop. The rider waits ~50 s and then sees nothing happen.

`app/page.tsx` keeps failures in a separate `error` state (set at :214 and
:231) rendered outside the conversation, while everything that *works* —
including the "nothing fits" verdict and the overlap warning — is pushed into
`messages` and read as a reply. A failure is the one case that leaves the chat
silent, which is exactly backwards.

**Done.** Failures from both `generate` and `converse` are pushed into
`messages` as an assistant turn, with "Mēģināt vēlreiz" as a quick reply
carrying a new `retry` action (not a text message, which would have been sent
to the chat as if the rider typed it). One path for "Mopik answers", whatever
the answer is. Verified in the browser: the failure now reads as a MOPIK reply
in the conversation instead of a box below the fold.

Related: the message itself is often wrong. "Precizē ilgumu vai prasības čatā"
is useless when the real cause is that the ride is too long to plan (item 7) —
the text should say what actually happened.

## 4. ~~Draw trails the way OSM draws them~~ — DONE 2026-09-14

Today every trail is a brown dashed line. Where OSM shows a **dotted** line,
Mopik should show a **red dotted** one. Update the map legend to match.

Touches `components/route-map.tsx` (the line paint) and the legend block that
lists Asfalts / Grants / Zeme / Nezināms and Ceļš / Meža ceļš / Taka.

**Done, and it turned into a palette decision.** The rider settled it: one
brown family for everything unpaved, with the line *style* carrying the rest —
solid gravel road, dashed track, dotted trail. Asphalt stays blue. Gone are
the separate orange/brown/grey surface colours and the always-red trail, which
carried more than a rider can read on a moving map and disagreed with every
other map they use.

The legend is now one row, read left to right as the ride gets rougher, drawn
with the same colours and dash patterns the map uses.

Same pass, at the rider's request ("iedomājies, ka tas būtu Apple karte"): the
line is drawn the way a good phone map draws one — zoom-interpolated widths
instead of a fixed 4 px, a soft white casing, round caps and joins, butt caps
on the dashes so they do not close their own gaps, and a zero-length dash with
round caps so dots are round. A wide, faint glow sits under it all, and a new
route now draws itself in over 900 ms instead of appearing at once.

## 5. ~~Long European rides are impossible on the public router~~ — DONE 2026-09-14

Found 2026-09-14 from the rider's Como → Budapest report, which failed with the
same "Neizdevās atrast maršrutu" as the Ērgļi bug but for a different reason.

**brouter.de refuses long legs**, answering 400 `error re-tracking track`:

| leg | length | brouter.de | local |
|---|---|---|---|
| Como → Budapest | ~800 km | **400** | (no tiles) |
| Berlin → Warszawa, flat | ~570 km | **400** | (no tiles) |
| Nida → Narva | ~700 km | — | **200** |

Both endpoints route fine on their own, and intermediate points ~140 km out
fail *to any target*, so it is not a snap problem. The same length routes
locally, so it is not BRouter's limit either — it is the public instance
giving up on a long search (its `maxRunningTime` watchdog), reported in the
same words as a genuine routing failure.

**The split fallback is written but unproven.** `routeInSegments` triggers on
`error re-tracking track`, which is how the public instance refuses a long leg
*quickly*. Measured 2026-09-14 on Berlin → Warszawa with the hard forest
profile, it never fires: the generation dies of `time budget exhausted`
instead, because 350 ms pacing plus retries across ~36 candidates eats the
40 s first. With an easy profile the same leg simply succeeds (2 routes,
739 km) — so the public instance's limit tracks search difficulty, not
distance alone, which corrects the "over ~500 km fails" reading above.

So when the credit runs out, expect long rides to fail on *time*, not on the
refusal the fallback catches. Fixing it properly means fewer candidates for a
long request, not a better fallback. See item 7.

**Solved by Mopik's own BRouter**, live at `https://brouter.mopik.eu` (Hetzner CPX12,
Nuremberg, €14.51/mo, running on the rider's €25 starting credit). Berlin →
Warszawa now routes in 14.4 s where brouter.de refused it outright. The split
fallback below stays in the code for when the credit runs out.

Rides around ~1000 km are still out of reach, for a different reason — see
item 7.

`scripts/deploy-brouter-vps.sh` built it and can rebuild it from scratch.
`TIME_BUDGET_MS` was 110 s against `maxDuration = 60` and is now 50 s, so the
platform cap can no longer be reached. Production verified on 2026-09-14.

## 6. Say which route you actually rode, and plan around it

The rider's idea, 2026-09-14 — details deliberately open:

> The rider marks which route they actually rode. Later planning can then be
> told "give me something completely new", or "the same is fine", or some
> hybrid.

What already exists to build on: saved rides carry the full plan and the
routed geometry, and `overlap` is measured on geometry with direction removed
(`lib/routing/classify.ts`) — the same machinery that answers "am I riding the
same road twice" within one route can answer it *between* a new candidate and
rides already ridden. So "completely new" is a scoring term, not a new concept.

Unresolved: where ridden rides live. Saved rides are in `localStorage` today,
so a history that survives a new phone needs somewhere to put it — which is
the first thing this project would store server-side.

### First concrete step, 2026-09-19 — the ridden roads layer

The rider handed over three GPX and said every road in them is rideable. That
is built as a **global reference layer**, shaped exactly like TET, not as
per-rider history: `scripts/build-ridden.ts` → `public/ridden.geojson` (router,
12 m) and `public/ridden/<CC>.geojson` + `index.json` (map, 25 m).
`lib/routing/ridden.ts` loads it and **shares TET's matcher**
(`createTetMatcher`), so the two layers cannot drift apart on what "on this
road" means. Sources are git-ignored like `data/tet-gpx/`.

**Only one of the three files was geometry.** `riga-adazi` is a real recording
and used as-is. The other two are planned `rte` — 122 and 59 rtept, ~1.5 km
apart — so they are **snapped**: every consecutive pair routed through BRouter
(`trekking`) and the returned line stored. Fidelity, rtept → snapped line:
papisilla median 1 m / p90 4 m / max 10 m, 0 of 115 beyond 50 m; sigulda
median 1 m / p90 8 m / max 93 m, 1 of 52. Built: 11 sections, 316 km, LV 185 /
EE 130, 26 KB.

`trekking` over `car-fast`, measured on sigulda-riga: trekking routed 105.3 km
against an 85.6 km chain and kept the 11.6 km of `highway=track` the rider
rode; **car-fast returned 131.6 km, ten legs detouring over 2x, and 0 km of
track**. A car profile would have deleted the most valuable part of the data.
Its cost is that it is a bicycle profile, so cycleway/footway are dropped
rather than stored (5.7 and 4.2 km) — this layer may not claim ground a
motorcycle cannot use. Two legs were dropped as artefacts (papisilla 58: 17.27
km routed for a 1.42 km gap; sigulda 37: x6.9 with `reversedirection=yes`, a
U-turn where two rtepts straddle a divided road). A dropped leg **splits** the
section rather than being bridged — a straight chord would be invented
geometry, which is the whole thing this avoids.

**The Rīga → Ādaži track is 100 % TET** (31.2 of 31.2 km match `TET_LV-02`, as
its own metadata says). The layer adds nothing there; everything it adds comes
from the other two rides.

**Tag mix of what the rider actually rides**, which decides how much
"verified" can ever change: papisilla 29 % unclassified, 27 % tertiary, 21 %
secondary, 8 % track, 7 % primary — and **0.8 km of `highway=path`, 0.3 %**.
Sigulda-Rīga is 33 % unclassified, 29 % tertiary, 15 % primary, 9 % track,
**1.1 km path, 1.1 %** — a main-road ride (A2/P8), as the file's own name said
it would be, and that changes nothing for the verified rule. The honest
reading: **these are roads, not trails.** The verified-access rule only bites
on `highway=path`, and the rider's own GPX barely contain any.

**Measured, three rides plus the regression** (in-process harness, own
BRouter, `accessPolicy: "verified"`; Stadia key absent so loops used circular
anchors — equally before and after):

| ride | before | after |
|---|---|---|
| Sigulda → Rīga one way | 111.2 km / 159 min, 2 % rep, 0 unverified | **identical**, ridden 46.4 km (41.7 %) |
| Rīga → Ainaži one way | 167.1 km / 248 min, 1 % rep, 0 unverified | **identical**, ridden 33.4 km (20.0 %) |
| Sigulda round trip 3 h | 107.3 km / 161 min, 0 % rep | **identical**, ridden 0 km |
| Rīga round trip 2 h | 63.3 km / 108 min | 64.2 km / 113 min — **search noise, not this** |

The Rīga difference reproduces *with the layer in place on both sides* (63.3,
64.2, 64.2 across three runs, winner `ridden 0 km` each time), so it is the
search, not the term. **The ranking term changed no route in these four
rides.** The regression did not move. A ridden candidate did enter the pool
once (Rīga, `optional-ridden-0`) and lost at 37 % retracing — which is the
bound working, not a failure.

**The bound.** Item 11's rule generalised: a reference layer may never buy
retracing. `RIDDEN_WEIGHT` is 4 — half the sea term — so it buys at most 4 %
more retracing, 2 % under `prioritizeLowOverlap`, and cannot outrank
`offRoadShortfall` (spans 40) or `trailShortfall` (20).
`scripts/ridden.test.ts` pins this as an assertion on the rank points
themselves, so raising the weight fails the test rather than quietly changing
the rides.

**Verified access, the part that actually matters** — with
`allow_unverified` and trails=lots, where `highway=path` can appear at all:
Rīga → Ainaži cleared **0.49 of 10.77 km** of unverified path (4.5 %);
Sigulda → Rīga complex cleared **1.79 of 15.43 km** (11.6 %). Real, measured,
and small — because of the tag mix above. This is the honest size of the
effect, not a disappointment: the mechanism is right and the data is thin.

**Where the design did not survive contact with the data:** the brief expected
the value to be in "how much is `highway=path`/`track` with no positive motor
access". It is 0.3–1.1 % path. The layer's real contribution today is the
41.7 % / 20.0 % of two rides it can *confirm* — and that is worth showing, not
scoring.

**Not done, deliberately** (components and i18n were out of scope): the result
panel does not show "km on ridden roads". `quality.riddenKm` is on every route
and `RouteQuality` documents it; showing it needs one line in the panel beside
`unverifiedPathKm` and one message key. The map does not draw the layer
either, though `public/ridden/index.json` has the bboxes for it, the same
contract `public/tet/index.json` has.

## 7. A ride of ~1000 km still does not generate

**Status 2026-09-19:** Steps 1 and 2d done — the probe measures each rider-named segment, the refusal names the hop that is too hard and offers that hop's direct road as a chip (`lib/routing/fetch-route-probe.ts`). Step 2c (consecutive days) remains the real answer and is unbuilt.

Measured 2026-09-14, after the VPS was in place. Our own server routes
Como → Budapest fine, but **one such leg takes 75 s** — and a generation tries
~36 candidates. The API budget is 50 s (it must stay inside Vercel's
`maxDuration = 60`), so the request runs out of time and returns 422.

Measured on our own server, single legs, `trekking`:

| leg | length | time |
|---|---|---|
| Rīga → Tallinn | 343 km | 2.4 s |
| Rīga → Vilnius | 319 km | 5.5 s |
| Berlin → Warszawa | 646 km | 14.4 s |
| Como → Budapest | 1126 km | **75 s** |

So the wall is not linear — it climbs steeply past ~700 km. Everything up to
Berlin → Warszawa now works, which covers any realistic ride; a Milan-to-
Budapest day is not one.

Measured again in production on 2026-09-14: **Rīga → Tallinn (486 km, hard
forest) took 52.8 s** against a 60 s cap. It succeeded, but with 7 s to spare —
so this is not only about ~1000 km rides. Anything over ~450 km is one slow day
away from failing.

**A kilometre threshold will not do.** Measured on our own server, single legs:
Rīga → Berlin (1133 km) takes 23 s, Como → Budapest (1126 km) takes 74 s —
the same distance, three times the work, because the Alps are harder to search
than the plain. Rīga → Roma does not answer at all (504 after 300 s). What
costs time is the difficulty of the search, not the length of the line.

**Decided with the rider, 2026-09-14, in this order:**

1. **Say it before the search, not after.** A ride Mopik cannot plan in one go
   should be named as such up front, rather than making the rider wait ~50 s
   for a failure. Together with item 3 (failures speak in the chat) this
   finally reads as an answer instead of silence.
2. **Then work out how to plan longer rides properly.** The rider was explicit
   that refusing is not the end state — it is the honest interim. Ideas not yet
   weighed: fewer candidates when the request is large, routing only the
   headline version, planning a long ride as consecutive days, or splitting at
   places the rider chooses rather than at arbitrary points.

### Step 1 done, 2026-09-14 — the probe says it before the search

`lib/routing/fetch-route-probe.ts` routes the headline leg once, under a 10 s
deadline, before the candidate search commits to ~36 of them. Slow leg → an
honest reply in the chat in ~11-13 s; fast leg → its timing scales the search.

**BRouter has no server-side time limit we can use.** Measured against
`brouter.mopik.eu` (1.7.10): `maxRunningTime=10` and `maxRunningTime=300` both
returned 200 after ~77 s on Como → Budapest, and `timeout=3` returned 200
after 29.6 s on Berlin → Warszawa. The 400 "killed by thread-priority-watchdog
after N seconds" replies that looked like the parameter working are the
server's own watchdog reacting to *overlapping* requests — they reproduce with
no parameter at all. So the deadline is enforced on our side with an
AbortController.

**The server is one vCPU, so concurrency is not free.** With one long search
running, Berlin → Warszawa went 14.7 s → 35-40 s and Como → Budapest 77 s →
137 s. Four candidates at a time is not four times the capacity, which is why
`affordableCandidates` does not divide the leg cost by the concurrency.

**The profile matters more than the map.** Berlin → Warszawa is 14.4 s on
`trekking` but **31-37 s on the rider's own profiles**, and on hard-forest it
fails outright (`error re-tracking track` after 56 s). The backlog's earlier
"Berlin → Warszawa works" was measured on the wrong profile.

| ride | before | after | outcome | candidates |
|---|---|---|---|---|
| Rīga → Tallinn | 52.8 s (prod) | **24 s** | 2 routes | 7 of 17 (reduced) |
| Berlin → Warszawa | ~50 s → 422 | **13 s** | honest refusal | — |
| Como → Budapest | ~50 s → 422 | **13 s** | honest refusal | — |
| Rīga → Roma | never answered | **11 s** | honest refusal | — |
| Sigulda round trip | 23 s | **23 s** | 2 routes | 36 (unchanged) |
| Rīga → Baldone | 20 s | **20 s** | 2 routes | 17 (unchanged) |

Rides under a 250 km headline leg are never probed, so the weekend ride pays
nothing for this.

### Step 2 — the four ideas weighed (design only, nothing built)

The probe buys honesty, not capability: Berlin → Warszawa is a ride a rider
would plausibly want and Mopik now refuses it politely. These are the ways out.

**a. Fewer candidates when the request is large.** *Already built* as the
probe's scaling, and it is why Rīga → Tallinn dropped to 24 s. Needs nothing
further. **Its ceiling is low**: at 31 s a leg the budget affords one
candidate, and one candidate is not a choice between versions — it is a single
road. This stretches the working range by perhaps 150 km, not by 500.

**b. Headline-only routing.** Route the direct leg and show it alone, skipping
the corridor shapes. Cheap to build (the probe already holds that leg — it is
one response shape away) and it turns today's refusal into *a* ride for
anything that routes at all. **But it quietly abandons the product**: the one
thing that matters here is not riding the same road twice, and the headline
leg is precisely the shortest, most-travelled line between two points. A rider
asking for a 600 km adventure day would get the road they were trying to
avoid. Worth having only as an explicit offer ("gribi taisnāko ceļu?"), never
as a silent fallback.

**c. Consecutive days.** Split the ride into day-sized pieces, each planned
properly with its own full candidate search, and present them as a multi-day
plan. **This is the only idea that actually solves the problem** rather than
narrowing it: each day is a 300-400 km search that Mopik already does well, so
quality per day is today's quality, and the Alps stop being one hard search.
Costs the most: an overnight point has to be chosen (a town with beds, not a
forest junction), the plan model grows a day dimension, the map and GPX export
have to show days, and the chat has to ask "cik dienas?". It also changes what
Mopik *is*, from a day-ride planner to a tour planner — which is a decision
for the rider, not for the code.

**d. Rider-chosen split points.** The rider names the places they want to pass
through, and each segment is planned separately. Cheaper than (c) — the
`viaPlaces` machinery exists, and splitting at named places needs no overnight
logic — and better than arbitrary splitting, because the router optimises
each piece and a rider-chosen waypoint is somewhere they wanted to be anyway,
so the seam is not a compromise. **It does not fix the hardest case**: Rīga →
Roma stays unplannable unless the rider names enough intermediate places, and
a rider who does not know the route cannot name them.

**Recommendation.** Do (d) next, then (c) if the rider wants tours.

(d) is a small step from here — the probe already measures per leg, so
probing each rider-named segment and reporting which one is the problem is
mostly wiring, and it converts the current flat refusal into "šis posms ir par
grūtu, pievieno pieturu starp X un Y". It makes the refusal *actionable*,
which is the complaint behind item 7, without committing to a tour planner.

(c) is the real answer and should follow, but it is a product decision with a
data model behind it — not something to start while POI for Europe (item 8) is
still the oldest outstanding request.

(b) should be built only as a named offer inside (d)'s refusal, never as a
silent substitution: "nevaru izplānot interesantu maršrutu, bet taisnāko ceļu
varu" is honest; quietly returning the motorway is not.

(a) is done and needs no further work.

### Step 2d shipped, 2026-09-19 — the refusal names the segment, and offers the road

The probe now measures **each rider-named segment** (start → via1, via1 → via2,
…) instead of one headline leg, under a shared 10 s budget, sequentially and
longest hop first. A refusal names the hop that is the problem — "šis posms ir
par grūtu: Innsbruck → Wien (~386 km, 2. no 3). Pievieno pieturu starp
Innsbruck un Wien" — and carries the direct road for that hop as a chip the
rider taps ("Rādi taisnāko ceļu"), never as a substitution.

| ride | before | after | outcome |
|---|---|---|---|
| Rīga → Tallinn | 27.7 s, 2 routes | **23.8 s, 2 routes** | unchanged (8 of 22 candidates) |
| Berlin → Poznań → Warszawa | 29.0 s → **422** | **22.3 s, 1 route, 715 km** | now plans |
| Como → Innsbruck → Wien → Budapest | 10.1 s, flat refusal | 27.7 s, names Innsbruck → Wien + offer 477 km / 6 h 37 | actionable |
| Berlin → Warszawa (no vias) | 10.1 s, flat refusal | 21.9 s, refusal + offer 572 km / 4 h 30 | no segment named, correctly |
| Sigulda round trip | 22.4 s, 2 routes | **19.5 s, 2 routes** | unchanged, never probed |
| Rīga → Baldone | 14.1 s, 2 routes | **13.0 s, 2 routes** | unchanged, never probed |

**A candidate costs the whole ride, not its slowest hop.** Pricing Berlin →
Poznań → Warszawa at its slowest segment (9.6 s) allowed three candidates and
**all three timed out** — each was routing both hops. Even the bare segment sum
was too cheap, because a corridor candidate inserts offset vias by design and
that search is dearer than the straight leg the probe measured. Hence
`candidateCostSeconds`, which sums the probed segments, charges unprobed ones
at the slowest measured rate, and multiplies by `CORRIDOR_MARGIN` (1.5 — a
margin, not a measurement, erring towards returning a ride).

**Our own profile cannot route the legs the offer is for; `car-fast` can.**
Measured on Berlin → Warszawa against `brouter.mopik.eu`:

| profile | result |
|---|---|
| our moto profile flattened to `offRoad: 0`, no trails | **never answers** — null after 91 s |
| stock `trekking` | 53.2 s |
| stock `car-fast` | **5.7 s** |

Nearly a factor of ten, and the flattened moto profile does not finish at all.
The cost is our own cost script — the turn, surface, grade and off-road terms
that make a Mopik route interesting are what make the search expensive — so
flattening its dials buys a duller route, not a faster one. Innsbruck → Wien
says the same: 28–43 s flattened, with and without motorways. The offer
therefore routes on `car-fast`, which is also the honest profile for it: the
straightest way *is* the road a car would take. The geometry travels inside
the refusal (simplified to 10 m, as the share code does) because the client
cannot re-request it — it would ask with the ride's own profile and hang.

**Next open item: the probe's single measurement is noisy.** Rīga → Tallinn
measured 3.1–10.4 s for the same leg across runs, and the generation that
follows ran **19–51 s** as a result. This is **pre-existing, not caused by 2d**
— the old code produced the identical 37.4 s / 13 candidates whenever it
happened to measure 3.1 s. At 51 s it is one slow day from the 60 s Vercel cap.
Worth either sampling the probe more than once or damping the scaling, but it
is a change to the candidate arithmetic and wants its own measurement round.

## 8. POI for Europe

**Status 2026-09-15:** In progress. Geofabrik path built and made fast; LV LT EE PL published in `public/poi/`; second pass for PL DE CH AT IT SI died on a memory-starved machine — restart `run-phase2.sh`.

Outside LV/LT/EE loop anchors are geometric, so rides are unnamed and cannot be
planned *through* a hillfort or a ford. `scripts/build_poi_dataset.py` takes
its countries from a three-entry list — a data job, not a code one. Overpass
rate-limits a full build and the script already rotates mirrors.

The rider also asked whether **Google** could supply this instead. Not costed
yet; do that before committing to another Overpass run.

**2026-09-19: SI, CH and AT published** (2,835 / 6,643 / 11,416 POIs;
6,816 / 22,973 / 49,910 gates) — 7 countries, 66,572 POIs, 14 MB; gates for
6. Built on the 8 GB machine one country at a time with a guard on
`memory_pressure` free %, not on swap-used (macOS keeps swap "used" high
after processes exit; Slovenia built fine at 12.7 GB reported swap). PL was
rebuilding for gates at the time of writing; DE and IT still need a quiet
machine. **One honesty question surfaced by AT:** `hasPlaceData` answers
true for München although the nearest Austrian POI is 53 km away, because
the coverage slack is 1° / 1.5° (~110 km) — enough that a ride 100 km
outside any published country is told it has place data. The test now uses
Hamburg for "not published". Whether the slack should shrink to a real
border margin (say 25 km) is open; measure how many border rides it would
turn from "covered" to "sparse" before changing it.

## 9. ~~Multilingual UI~~ — DONE 2026-09-14

Latvian for Latvians, Lithuanian for Lithuanians, Estonian for Estonians,
English for everyone else.

Note the known related problem: route *names* are already English outside a
Latvian prompt, because `locale` is detected from the prompt text and an API
call without one falls through to English. That is the same problem seen from
the other end and should be fixed with this, not separately.

**Done: the shell, the form, the profile and the map.** `lib/i18n/` holds a
flat dictionary per language, a store shaped like `use-ride-profile`, and a
picker in the header. First visit follows `navigator.languages`; a rider's own
choice is remembered on the device and wins from then on. Anything Mopik does
not speak falls through to English, not Latvian — someone browsing in German
is better served by English than by a language they cannot read.

Second pass added the chat's own shell (titles, placeholders, the send
control, quick-reply label) and the place-suggestion kinds.

Third pass took the loader lines, the result panel, the chat's own messages
and the plan summary. What a rider meets from opening the app to downloading a
GPX now speaks their language.

Fourth pass finished it. `planSummary` took a `lv: boolean`, which was fine
with two languages and wrong with four — a Lithuanian rider got English
because "not Latvian" was the only other thing the signature could say. It
takes a `UiLocale` now, and the type checker found every caller.

Measured after: a full Lithuanian generation, from the form to the result
panel, contains **no Latvian words at all**.

**How strings kept being missed, and the fix.** Every sweep searched for
Latvian diacritics, so "Vari uzreiz pateikt visu, ko zini." — a whole
sentence without one — survived three passes until the rider spotted it. The
scan that actually works looks for *any* hardcoded text between JSX tags and
in `aria-label` / `title` / `placeholder`, regardless of alphabet:

```
grep -ohE '>[A-Za-z][^<>{}]{8,}<' components/*.tsx app/*.tsx
grep -ohE '(aria-label|title|placeholder)="[A-Za-z][^"]{6,}"' components/*.tsx
```

It should come back empty apart from the OpenGraph images.

**2026-09-14: the lint rules replace those scans.** A grep only finds what
someone remembers to run, and this one was run after the damage each time.
`eslint.config.mjs` now turns the same search into an error on every save and
every `npm run lint`, for `components/**/*.tsx` and `app/**/*.tsx` with the
OpenGraph images excluded: `react/jsx-no-literals` catches text written
between JSX tags and template literals used as JSX children, and a set of
`no-restricted-syntax` selectors catches the text-bearing attributes
(`aria-label`, `aria-description`, `title`, `placeholder`, `alt`), including
template literals in them that carry words of their own. The five strings the
scans above had missed — the beer popup's button, QR alt text and byline, the
hours field's "cits" placeholder, and "Paturēt abus" in the plan confirmation
— were found by the rules and are now dictionary keys.

What the rules cannot see is anything that does not pass through JSX. A string
built in a `lib/` function or an API route reaches the screen as a value, and
no lint rule can tell it from a log line or an internal identifier. The fix
there is not a stricter rule but a signature: give the function a `UiLocale`
parameter, as `planSummary` got, and the type checker names every caller that
has not been thought about. That is how the last of the chat wording was
found, and it is the method to reach for next time.

**2026-09-14, later: the selectors only saw direct children, and two strings
lived through it.** `placeholder={hasRoute ? t(locale, "chatPlaceholder") :
messages.length ? "Papildini ieceri…" : "Apraksti savu braucienu…"}` in
`components/route-prompt.tsx` passed the rules the day they were written. Both
halves of the ban matched a `Literal` only as a *direct* child of the
attribute's expression container, so the moment the text sat one level down —
in a `ConditionalExpression`, a `LogicalExpression`, or an argument like
`someFn("text")` — nothing matched. `react/jsx-no-literals` has the same blind
spot on the children side: `<p>{flag ? "Sveiki" : t(locale, "x")}</p>` was
measured and is not reported. The rules are now descendant selectors on the
attributes and direct-child selectors on the conditional and logical branches
of a JSX *child* container, which found two more survivors: the map toggle in
`ride-composer.tsx` ("Paslēpt karti" / "Rādīt kartē", already in the
dictionary as `hideMap` / `showOnMap`) and the unseen-count `aria-label` in
`saved-rides-link.tsx`.

The heuristic that makes this workable is that **user-visible text carries
whitespace or ends in sentence punctuation, and a dictionary key never does**:
keys are camelCase identifiers, so `t(locale, "chatSend")` nested anywhere
inside an attribute stays legal while `someFn("Papildini ieceri…")` does not.
That is what lets the selector be a descendant selector at all instead of
enumerating every expression shape.

Two combinators in those selectors are load-bearing and both were measured by
running the rule over the tree. `JSXExpressionContainer` without a parent
anchor also matches an attribute's container, and every
`className={flag ? "px-2" : "mt-3 space-y-3"}` is a conditional full of
whitespace. Anchoring it as `JSXElement > JSXExpressionContainer` but leaving
the inner combinator a descendant lets the selector walk into a branch that is
itself a JSX element — `{active ? (<span className="a b"/>) : …}` — and every
nested `className` matched again. Together the two mistakes read as 166 false
positives against 3 real hits. Anchored as direct children throughout, the run
is 3 hits and 0 false positives. If this rule ever starts shouting, check the
combinators before relaxing the regex, and never blanket-disable it.

**Still Latvian, and deliberately:**
- **The chat's model-generated replies.** They come from the prompt in
  `app/api/route-chat/route.ts`, so translating them means translating the
  prompt and re-running `scripts/chat-golden.ts` per language.
- **The OpenGraph share images.** Server-rendered with no locale available;
  they are the card someone sees in WhatsApp, not part of the app.

**Was still Latvian before this pass:**
- **The chat's replies.** They come from `lib/chat/ride-plan.ts` and the model
  prompt, so translating them means translating the prompt and re-running
  `scripts/chat-golden.ts` against each language. A separate job.
- **The result panel.** ~36 strings, several assembled from numbers ("83 km
  atkārto jau nobrauktus ceļus"), which need per-language grammar rather than
  concatenation.
- **The saved-rides page.** ~13 strings.
- **Route names**, the problem named above: `detectLocale` still reads the
  prompt rather than the chosen UI language, and only knows lv/en because
  that is what the POI dataset carries.

The keys for these exist in neither the dictionary nor the type, so nothing
silently falls back — they are simply still Latvian until done properly.

## 10. ~~A footer, and a header freed up for language~~ — DONE 2026-09-14

Move the Instagram icon and "Sazinies" into a new footer, which also carries
extra info and other pages. The header then has room for the language picker
and whatever else belongs there.

Depends on nothing; unblocks the language picker in item 9 having somewhere to
live.

**Done.** `components/site-footer.tsx`, in the layout so every page gets it:
tagline, saved rides, "Sazinies", the OpenStreetMap attribution and a line
telling the rider to check access on the ground. The header kept only the
saved-rides bookmark and gained the language picker.

Also on the rider's request: the header bookmark lost its "Saglabātie" label —
the icon says it in a fraction of the width — and gained a count of rides
saved but not yet looked at (`unseenSavedCount`, marked seen when the list is
opened). The word itself moved to the footer.

## 11. Routes still run along the sea

**Status 2026-09-15:** 11a–11e shipped (beach paths refused; sea term; seaward candidates; no vias in the water). Decided: the sea may NOT buy retracing; 11f built corridor candidates instead (no coastal candidate above 3 %), and the beach check passed (0.84 km). ~~Still open: the 209 s dry-land failures on Liepāja → Ventspils — a refused approach direction (fix measured at 8.3 s).~~ **Closed by 11g; that diagnosis was refuted — see the 2026-09-19 status below.**

**Status 2026-09-19 — the last open piece was already closed; nothing new was built.**
The line above is stale in two ways, and both are worth writing down. The 209 s
was fixed by item 11g (`1edb55e`, "A quarter-second refusal no longer costs a
24-request ring"), and the diagnosis it repeats — "a refused approach
direction" — is the one 11g *measured and refuted*: the via at 21.421589,
56.921915 snaps 13 m onto a routable track and routes in and out on all four
bearings. The real cause was ours, not BRouter's — a 60–370 ms refusal was
being answered with a 24-request endpoint-nudge ring and a segmented retry.
A generated via now gets 2 s of cheap alternatives (shift along the corridor,
then drop) while the rider's own places keep the full ring.

Re-measured today in process against `brouter.mopik.eu`, Adventure preset,
sequentially (`ONLY=liepaja-ventspils npx tsx scripts/measure-seaward.ts`).
BEFORE is the same checkout with `MOPIK_NO_VIA_RESCUE=1`, so the two rows
differ only in this behaviour:

| Liepāja → Ventspils | pool | routed | failed | **fail s** | ok s | **total s** |
|---|---:|---:|---:|---:|---:|---:|
| before (`MOPIK_NO_VIA_RESCUE=1`) | 12 | 9 | **6** | **101.2** | 2.9 | **106.1** |
| **after (shipped)** | 12 | **15** | **0** | **0** | 11.2 | **13.1** |

The six failures are exactly the six this item named — `via-0.35--1`,
`via-0.7--1`, `via-1--1`, `via-1.4--1`, `zig-1.2`, `sea-0.75` — and each now
routes by dropping its unreachable generated via. **The pick does not move:**
`via-0-1`, 140.5 km, 0 % retraced, 15.4 coastal km, rank −2.16, identical to
11f's published figure. The fail seconds read 101.2 rather than 11e's 209
because a refusal's cost is the ring's wall clock and the instance is quicker
today; the shape of the finding is unchanged.

Through the API (`POST /api/generate-route`, `"debug": true`, dev server on
:3000), all inside the 50 s budget and no failed candidate anywhere:

| ride | s | routes | candidates | pick |
|---|---:|---:|---:|---|
| Liepāja → Ventspils | 14.3 | 1 | 18 | `via-0-1` 140.5 km, 0 % rep, coast 15.4 |
| Sigulda round trip | 19.1 | 2 | 36 | unchanged, coast 0 |
| Rīga → Baldone | 16.0 | 2 | 18 | unchanged, coast 0 |
| Rīga → Jelgava (inland) | 20.8 | 2 | 23 | unchanged, coast 0 |

The inland control is inert rather than merely quiet: Rīga → Jelgava's nearest
coastline is **11.5 km**, far outside the 3 km band the scoring uses, so every
candidate scores `coast=0`. It does open `public/sea/LV.json` — the index is
per country and Latvia has a coast — and `hasSeaData` is what provably zeroes
the term in a country with no coastline file, which is the honest version of
"an inland ride opens no sea file". Rīga → Ainaži re-measured identical to the
decimal (`sea-0.25`, 250.7 km, 13.1 coastal km, rank 10.21, shore path 15.69),
so 11f's 0.84 km beach figure stands on the same geometry; the `beach.json`
polygons that produced it were cleaned from the scratchpad and were not
rebuilt, since no candidate changed.

**Remaining, and unchanged by this:** 11f's fourth corridor pair `[0.25, 0.85]`
is still a workaround — the fix makes the bad entries cheap, not routable — and
the 13 coastal km it hoped to recover are still not recovered.

Recurring. The sandy beach tracks are already refused (`beach_like_path`), so
this is about riding *beside* the sea, not on it — measure what the routes
actually use before changing costs.

## 12. ~~Routes run through private property~~ — DONE 2026-09-14 (gates only)

Sometimes harmless, sometimes it is somebody's farmyard, which is not all
right to ride through. Open question — the rider asked how to solve it, not
for a specific fix. OSM access tags are already respected; a house or a
homestead with no access tag at all is the hard case.

**Done 2026-09-14: gates ship as a fact, guessing does not.** The dataset, the
measurement and the UI are all in. What the rider sees: a "Vārti uz ceļa 🚪 · N"
row under RISKI, a 🚪 marker on each gate on the map, and a line in the segment
card saying what it means for the riding. **No route is changed by any of it** —
the open question of *actual* private-road data stays open, and is written up
under "What more would take" below.

*What was tried.* `docs/private-property-options.md` measured the problem over
six rides and found OSM says almost nothing explicit: of 187 route edges within
25 m of a building, the entire set of access tags was one
`motor_vehicle=destination`, two `access=permissive`, two
`motor_vehicle=permissive` and one `motor_vehicle=yes` — zero `private`, zero
`no`, `noexit` on none, and 0 of 33 ridden `service` ways carried a `service=*`
subtag. So the first build inferred a yard from circumstantial evidence: a
dataset of building centroids, `landuse=farmyard` rings and small
`landuse=residential` rings, with `classify.ts` flagging a stretch when
buildings stood on **both** sides within 20 m, when it lay inside a farmyard
polygon, or when it dead-ended at a building cluster. A plain 25 m proximity
rule had already been rejected once before that; the four strict rules were the
second attempt, and they cut the flagged distance from 16.7 km to 4.8 km across
the six rides.

*Why it was rejected.* The rider refused the approach, not the thresholds:

> "šī pieeja nav korekta — mēs nevaram minēt; vairumā gadījumu tur nebūs
> ierobežojuma; ja mums nav datu par privātajiem ceļiem, labāk šo ceļu no
> maršruta neizslēgt. Sākam vismaz ar vārtiem."

We cannot guess. In most cases there is no restriction there, and with no data
about private roads it is better to leave the road in the route than to take it
out. The data had said the same thing first: **248,488 buildings in Latvia alone
lie within 25 m of a track or service way** — not the "few thousand" the options
paper estimated — 90 % of them beside a `service` way, and 16 % of the whole file
inside a box around greater Rīga, which is apartment blocks beside parking
access roads. Any rule resting on that infers property rights from a building
footprint.

*What ships.* One explicit OSM fact and nothing derived from it: a
`barrier=gate|lift_gate|swing_gate|chain|bollard|cattle_grid` node that is a
**member of** a `highway=track|service|unclassified` way — membership in the
way's node list, not proximity to it. Latvia: **13,691 gates, 318 KB**
(`scripts/build_gates_dataset.py` → `public/gates/`, loaded by
`lib/geo/gates.ts`). The route is never changed by it — no cost, no penalty, no
rejection; a Latvian forest gate stands open more often than not. It is
information: "Vārti uz ceļa · N" and a small map marker. The 9.4 MB of building
and polygon data is deleted.

*What more would take.* Actual access data, not a better inference. Three
sources, in order of how much they would settle: the rider marking a stretch as
private from the app and that being stored and avoided (option (d) in the
options paper — the only one that produces ground truth, and the only one worth
contributing back to OSM); a landowner or state register of private forest
roads, which for Latvia does not exist in a usable form (LVM GEO was measured on
2026-09-12 and carries no access attributes — see `docs/LVM-GEO-2026-09-12.md`);
or OSM's own `access`/`motor_vehicle` tagging improving, which is a mapping
effort, not a code one. Until one of those exists, the honest position is the
rider's: leave the road in and say what is known about it.

*A gate only counts if it is ON the road being ridden.* The rider, reading the
live map after the first build:

> "Ja vārti nav uz paša maršruta ceļa — jāņem ārā."

The first rule asked "is a gate within 15 m of this stretch of line" and marked
**driveway gates** — the barrier across a house's access road, 5–15 m off the
route, on a `service` way nobody rides. Proximity cannot separate those from a
gate across the ridden track; at 10 m they are the same measurement. So the test
is now identity: a gate that is a member of a ridden way is one of its nodes, so
BRouter returns it as a **vertex of the route geometry**, and a gate counts iff
a route vertex is within 1.5 m of it — coordinate rounding only.

*What the rider sees, measured 2026-09-14.* `quality.gateCount` is a **count**,
never kilometres — a gate is a point on the road, and the old shape's "0.74 km"
was the length of the shape segment a gate happened to sit on. Before/after on
identical geometry, the rule the only change: Rīga → Baldone 54 km **7 → 2**;
Bauska round trip **4 → 4** at 80 km (nothing lost — those were real, 0.25–0.41 m
from a vertex) and **0 → 0** at 113 km; Sigulda **1 → 0** at 112 km and
**12 → 0** at 292 km. Every dropped gate measured 5–11 m from the nearest
vertex. The row and the markers appear only above zero, so a loop with no gates
shows RISKI with the unverified row alone. Markers are capped at 30 per route
and thinned to every k-th past that — no ride measured came near it.

Only Latvia is built. Everywhere else `hasGateData` is false, so `gateCount` is
**`undefined`, not 0** — "not measured" must be said out loud rather than read
as "no gates", the same way `sparsePlaceData` does for POIs, and `undefined` is
what lets the panel stay silent instead of claiming a clean road. Building more
countries is a download-time job: `scripts/build_gates_dataset.py LT EE PL DE`,
5 s per country.

## 13. Pick a destination precisely on the map

Tap the map to say where to ride, instead of only naming a place.

## 14. Enter coordinates in the location search

The search field should accept a coordinate pair as well as a name.

## 15. Make rides more interesting

Viewpoints, sights, adventures — definitely for Tūrisms, but the rider thinks
it would make Sports rides better too. Depends on item 8 outside the Baltics.

## 16. Later: events worth stopping at

Find events along the way that might be interesting to visit during the ride.
Explicitly filed as further future.

## 17. ~~Saved rides: list on the left, map on the right~~ — CANCELLED 2026-09-14

The rider dropped this the same evening: the list page stays a list.

Decided with the rider on 2026-09-14, then parked as "good enough for now".
The saved-rides page got the shared header, the app's card language and a
centred column that day, but it still reads as a list with an empty right
half, and its four-button row is not consistent with the result panel.

The layout to build: on wide screens the list of saved rides on the left and
the selected ride's map on the right, exactly the main page's form/map split.
The card itself is the button, so "Apskatīt" disappears and the row shrinks
to Rediģēt; download and delete happen in the opened route view, which
already has both (`shared-route.tsx`: GPX, and `toggleSave` removes a saved
ride). On a phone: list only, tapping a card opens the full route view, back
returns to the list — the Komoot / Apple Maps pattern, no small map in a
corner.

A saved ride stores only its share code, not the route, so the right-hand
map decodes the code the way `/r/[code]` does. No server call.

Also parked from the same conversation: the shared-route view stacks three
full-width secondary buttons ("Ģenerēt līdzīgu sev", "Saglabāt sev",
"Rediģēt formā") where the result panel puts them in one row; and warning
badges use Lucide icons now, with the rough-track (grade 4–5) badge switched
off via `BADGE_KINDS` in `route-map.tsx` until a better icon is chosen.

## 18. ~~Drop the sparkle icon from "Izveidot maršrutu"~~ — CANCELLED 2026-09-14

Withdrawn by the rider the same evening; the icon stays.

Filed by the rider on 2026-09-14 as the next ticket. The main form's
primary button carries a Sparkles icon before the label; remove the icon and
leave the text. Check the same button in the other places it appears (the
shared-route page's "Ģenerēt līdzīgu sev", the chat's send control) and keep
them consistent. `components/ride-composer.tsx`.

## 19. ~~Stops on the map, and suggestions in the details~~ — DONE 2026-09-15

**Status 2026-09-15:** Done — suggestions card, sights vs stops, instant detours (out-and-back by default). See items 20 and 22 for what it surfaced.

Filed by the rider on 2026-09-14. Two halves:

**Stops drawn as stops.** Every via point / stop of a ride gets a marker on
the map — start with a 🅿️ icon — and a popup with the place's information
(name, kind, what is there). Today the via pins are plain dots in the brand
orange and say nothing.

**Suggestions in Detaļas.** When a ride is generated, the details section
lists suggestions in two groups: places *on* the route (a stop is worth making
there) and places *near* the route. A near-route suggestion has an "add"
control: pressing it makes the place a via point of the ride and regenerates
the route through it — so suggestions are how stops come into a ride, not only
the form. Depends on the POI dataset (Baltics today; Europe is item 8), and on
the loop machinery already planning through anchors.

## 20. ~~A suggested place that cannot be routed to~~ — DONE 2026-09-15

**Status, 2026-09-15 (item 11g):** fixed and measured in process. Satezeles
pilskalns now routes on a Sigulda round trip — 36.6 km in 3.4 s, the stop
moved **400 m** to routable ground — and Ķeizarskats, Lojas pilskalns and
Gūtmaņa ala are unchanged at 0.1 s each. Two separate bugs were in the way:

- BRouter answers **`target island detected`** for this point, not
  `re-tracking track`, so it took the island branch and that branch *deleted*
  the via. A named stop is now nudged there instead, and the request fails
  honestly if nothing within the ring routes — coming back with a ride that
  silently skips the place the rider pressed "Pievienot" on is worse than a
  refusal.
- `maxDrops` was `points.length - 3`, which is zero for a round trip of
  start + one stop + start — so the old code threw before it could do
  anything at all. It is `- 2` now: dropping the only via of a 3-point list
  leaves a valid 2-point route.

**The bound, as asked:** a rider-named via gets the existing ring and nothing
new — `NUDGE_RADII_M` (400/700/1200 m) x 8 bearings, stopping at the first
hit, and 1200 m is still the point at which Mopik would rather say no than
move the rider's place. The item-7 budget holds because the ring is only ever
run for a *named* point: generated vias take item 11g's bounded fallback
(~2 s, no ring), which is what made the ring affordable here in the first
place. Worst case for a named via is unchanged from what shipped for
destinations on 2026-09-14.


Found 2026-09-14 while wiring "Pievienot" on the saved-ride page. Pressing
it on Satezeles pilskalns (24.8707, 57.17161) gives a 422 from
`/api/generate-route`, reproduced with curl, while Ķeizarskats, Lojas
pilskalns and Gūtmaņa ala route fine with the same plan. Same class as the
Ērgļi footway case: the point snaps onto a way the hard profile forbids.
`fetchRoutePath` already looks for routable ground near a *destination*;
a via added from a suggestion needs the same treatment, and the suggestion
list could hide places the profile cannot reach at all.

## 21. ~~While generating, the chat input makes no sense~~ — DONE 2026-09-14

Filed by the rider on 2026-09-14. During a generation the chat still shows
its text input at the bottom, and the "Atcelt" button sits above it in the
loader. Nothing typed there can be acted on until the ride exists, so:
hide the input while a generation runs and put "Atcelt" in its place at the
bottom, where the thumb already is; the input returns when the ride is
drawn. `components/route-prompt.tsx` / `components/route-loader.tsx`.

## 22. A road a car takes in 500 m costs the moto profile 10 km

Found 2026-09-14 while building detours. Taurētāju kalns is 206 m from the
Sigulda loop; `car-fast` reaches it in 0.50 km, `trekking` in 1.02 km, our
Adventure profile in 10.3 km — so a road exists and the profile declines
it. Gūtmaņa ala (170 m away, 10.4 km on every motor profile) is the honest
case for comparison. Worth finding which way the profile refuses there and
why (access tag? surface? a `path` that is in fact a lane?) — the same
rule may be pushing other rides off short connectors. `lib/routing/moto-profile.ts`.

## 23. ~~The chat does not understand "vienalga" as an answer~~ — DONE 2026-09-15

Reported by the rider on 2026-09-15 with screenshots. One-way ride, ~100 km
along the Italian TET from Lake Como. The chat asks "Kur vēlies beigt šo
vienvirziena braucienu?", the rider answers "Vienalga", and the chat asks
the same question again — it has no way to accept "any destination". The
form already has that answer ("Nav obligāts — man vienalga"): a one-way ride
with no destination is planned from the start, the distance and the
direction hints. The chat must map "vienalga" / "jebkur" / "nav svarīgi" /
"kur sanāk" (and lt/et/en equivalents) to destination = none and go on,
instead of re-asking. Same class of bug: any answer the chat cannot place
must not produce the same question twice — the second time it should offer
the choices it can take ("Nosauc vietu, vai saki 'vienalga' un es izvēlēšos
pa TET ~100 km no Komo"). `app/api/route-chat/route.ts`,
`lib/chat/ride-plan.ts` (`normalizePlan`), `scripts/chat-golden.ts`.

**Status 2026-09-15 — fixed deterministically, prompt half unverified.**
Two layers, because the model must not be the only thing standing between
the rider and a repeated question:

1. **Before the model.** `ANY_ANSWERS` in `lib/chat/ride-plan.ts` is the
   vocabulary (lv "vienalga", "jebkur", "nav svarīgi", "kur sanāk",
   "izvēlies pats"; lt "nesvarbu", "bet kur"; et "ükskõik", "pole tähtis";
   en "anywhere", "don't care", "you choose", "whatever" — 38 phrases, each
   pinned by a test). `isAnyAnswer` matches case-insensitively and
   punctuation-tolerantly, but only when the phrase is the *whole* reply:
   "vienalga, tikai ne uz Jūrmalu" is a constraint and still goes to the
   model. `pendingQuestion(previousPlan)` says which question the rider is
   answering — inferred from the previous plan through `nextPlanPrompt`
   rather than tracked in a field, so there is no second copy of the
   ordering to keep in step — and `applyAnyAnswer` resolves it:
   destination → `destinationAny: true` (the same shape the form's "Nav
   obligāts — man vienalga" row builds: `returnToStart` false,
   `destinationPlace` null), return → `returnToStart: true` (the planner's
   default is a loop home), budget → flexible. Difficulty, surface and style
   are deliberately left out — they have visible defaults already.
   `destinationAny` is a new plan field; `nextPlanPrompt` skips the
   destination question when it is set, so the question cannot come back,
   and the question itself now carries a "Man vienalga" tap.
2. **In the prompt.** Two sentences added to `SYSTEM`: that these words are
   valid answers meaning no fixed destination, and that the same question
   must never be asked twice. Backed by a **generic server-side guard**
   (`withoutRepeat` + `lastAssistantQuestion`): a question identical to the
   previous assistant turn's, ignoring case and punctuation, is sent with
   the concrete choices appended instead — "Nosauc vietu, vai saki
   'vienalga' — tad izvēlēšos pats pa TET ~100 km no Como".

Also fixed: `insists()` read a bare "vienalga" as "ride it anyway" and would
have waved the feasibility check through; it now ignores an "any" answer
when a question was pending.

`planSummary` says `galamērķis brīvs` / `any finish` so an open one-way ride
does not read as one with no finish at all (`chatAnyDestination`, four
languages).

**Follow-up 2026-09-15, from the production golden run at `e0a03a9`
(15/16):** the only remaining failure was `startPlace: got "Komo ezers",
want "Como"` — the model kept the rider's Latvian exonym. **Measured: the
exonym does not geocode, and fails silently.** Through the app's own
`lookupPlace`, "Komo ezers" resolves to *Ezera iela, Kombuļu pagasts* in
Latgale (55.978, 27.172) — a street ~800 km from Italy — because Photon
returns five Latvian lakes for it and the distance bias around Rīga then
*prefers* them. Raw Photon for "Komo ezers" has no Italian hit at all;
"Como" resolves correctly first try (45.812, 9.083). So a translated place
name is not a cosmetic issue: it plans the ride in the wrong country with
no error anywhere. Fixed in the prompt — place names must be the place's own
name as OSM knows it, never a translation or exonym ("Komo ezers" → "Como",
"Minhene" → "München"), while Latvian places keep their Latvian names
because that is their own name. The golden's `"Como"` expectation stands.

**Verified locally:** `npx tsc --noEmit`, `npx eslint app/api/route-chat
lib/chat scripts/chat-plan.test.ts scripts/chat-golden.ts` and
`npx tsx --test scripts/chat-plan.test.ts scripts/*.test.ts` (177 pass) are
clean, and the rider's three turns resolve with the model contributing
nothing. **Only verifiable in production** (there is no `ANTHROPIC_API_KEY`
locally): whether the prompt change alone makes the model set
`destinationAny` and stop re-asking. Two golden cases cover it —
`npx tsx scripts/chat-golden.ts [http://localhost:3000]`, the case
"“vienalga” ends the destination question instead of repeating it" replays
the rider's exact three turns and fails if any question is asked twice.

## 24. Do we still need Stadia Maps at all?

**Asked by the rider 2026-09-17:** his Stadia free trial has ended, so what
breaks?

**Measured, not guessed.** Stadia is used in exactly one place:
`lib/routing/valhalla.ts`, for isochrones — the "how far can I get in N
minutes" rings that seed a loop's anchor points. Map tiles are **not**
Stadia: they come from `tile.openstreetmap.org`. Routing is our own BRouter
at `https://brouter.mopik.eu`. So an expired key does not touch tiles or
routing.

It is also already survivable. `app/api/generate-route/route.ts:985`
catches an isochrone failure and falls back to circular anchors. Evidence
that the fallback is real: this machine's `.env.local` has **no** Stadia key
at all, and routes generated correctly all session (Sigulda→Cēsis, 80 km,
1 % retraced).

**The open question, and the work:** the fallback keeps rides *working*, but
nobody has measured whether it makes them *worse* — circular anchors ignore
what is actually reachable, so a ring that crosses a lake or a motorway-only
corridor may produce duller or more retraced loops. Decide between:

1. Drop isochrones entirely and keep circular anchors, if the measured
   difference is small — one dependency and one key gone.
2. Replace them with our own BRouter, which can produce isochrones itself —
   no third party, but new code to write and host load to check.
3. Keep Stadia and pay, if the rings measurably make better loops.

**How to settle it:** generate the same set of loops both ways (key present
vs. key absent) and compare retraced percentage, sight count and total
length. That number decides it; until it exists, this is a guess either way.

## 25. A Latvian prompt with foreign place names fell to the regex parser in production

**Observed 2026-09-19, once, while checking item 7 in production.** Posting
`{"prompt":"no Como caur Innsbruck un Wien uz Budapest, grants"}` to
`/api/generate-route` on www.mopik.eu came back with `parser: "heuristic"`,
`viaPlaces: null` — the vias were dropped and the ride became a plain
Como → Budapest, refused as a whole. Minutes later `"no Rīgas uz Siguldu,
2 stundas"` came back `parser: "llm"` with 2 routes, so the Claude parser
itself is alive in production. The same rides posted as a *form plan*
(`plan` with `viaPlaces`) behave exactly as item 7 measured.

Not diagnosed. Candidates, unweighed: the LLM call timing out on a longer
prompt and the heuristic taking over silently (CLAUDE.md records that
path); the structured output failing validation for non-Latvian names; or
the word "grants" steering the fallback. One observation is not a rate —
measure with `scripts/measure-prompts.mjs` against `API=https://www.mopik.eu`
using foreign-name prompts before concluding anything. The user-visible
cost when it happens is real: a rider who typed three stops gets a refusal
that names none of them.

## 26. A shared ride's `startLabel` is its first stop, not its start

Found 2026-09-20 while adding GPX waypoints. `encodeRouteShare` is called
with `route.stops?.[0]?.name ?? plan.startPlace` as the start label, so on
a ride with stops the share code — and the shared page's own header
("Sākums: Līgatne") — names a *stop* as the start. The GPX waypoint takes
its name from the plan's first place and is right; the metadata is not.
Fix the call sites in components/result-panel.tsx and lib/share/saved-rides.ts
to pass the plan's start, keeping old codes decodable.

## 27. Diagnose unreachable pins before the search, not after 55 s

Measured 2026-09-20 in production: the ride with "Pilskalni 2" as finish
(a farmstead behind `access=private`) now returns 200 with the stop named
and two chips — but only after the full candidate search has run and
failed, **55 s** against the 60 s cap. Map-picked points are already checked
at Confirm (`/api/routable-point`, ~230 ms); typed places are not. Probe
each rider place for reachability before the search when the ride has vias
or a finish, and refuse in a few seconds with the same chips.

## 28. ~~A→B rides "go somewhere, end, and come back"~~ — FIXED 2026-09-24 (not deployed)

**Riders' reports, 2026-09-24.** The rider's GPX (Circle K, Pērnavas iela 7 →
Jelgava, flexible, Grūti·Sports·Meži, one way, 88 km) has an exact
out-and-back: trkpts 129–147 mirror around a tip at 56.93127, 23.87338 —
1.26 km in and the same 1.26 km out. **Measured cause:** reproduced
through the API (form plan, own BRouter, `debug: true`) as the candidate
`via-2.2--1`, 87.8 km / 154 min, identical to the GPX. Its first waypoint is a
**corridor offset via** (`perpendicularVia`, fraction 0.3, 2.2× reach, side
−1) at 56.93140, 23.87346 — 16 m from the tip, which is the end of a
`highway=service` stub off a grade2 track. Not TET, not a loop anchor, not a
POI: every one of the 24 spurs found in the shown/alternative routes of
these rides has a generated corridor via (`via-*`, `zig-*`, `sea-*`) as its
nearest waypoint, 18 of them within 150 m of the tip. `pruneSpurs` never saw
them: `if (destination || intent.includeSightseeing) return path;` skipped
it for every A→B ride since the 2026-09-09 audit. **The overlap metric
under-counts these:** it counts only the second pass, so the spur reads as
1.26 km / 87.3 km = 1.45 % → "1 % atkārtoti", while 2.53 km (2.9 %) of the
ride is the spur.

**Fix.** `pruneSpurs` now runs on A→B rides too (with and without
sightseeing), per spur: a spur whose closest approach to a rider-named via
or the destination is within the stop tolerance *and* closer than anything
the ride keeps is the visit and stays (trimmed to the stop if the spur runs
on past it). Geometry is only removed, never re-routed; surviving segments
keep their original edge tags; km, time, surface and overlap come from
`classifyRoute` on the pruned path. Sightseeing *loops* stay unpruned: with
sights protected, pruning the rest reshuffled the mutation seeds and the
pick got worse (Sigulda 2 → 7 %, Cēsis 3 → 10 %, Kuldīga unchanged). No
via-level guard: pruning removes the same geometry at no router cost, and
6 of 24 tips were 300–3400 m from their via, so "approach overlaps
departure" would not catch them reliably. Tests: `scripts/prune-spurs.test.ts`.

| Ride (own BRouter, form plan) | before: shown direct · complex (km, repeated, spurs) | after | spurs in all shown + alternatives |
|---|---|---|---|
| Circle K → Jelgava, Adventure | 75.8 km 1 % 1.6 km · 99.1 km 3 % 6.7 km | 77.1 km 0 % 0 · 116.6 km 0 % 0 | 6 / 20.7 km → 0 |
| the rider's candidate `via-2.2--1` | 87.8 km 1 %, 2.53 km spur | 85.3 km 0 % | — |
| Circle K → Jelgava, Grants tūrists | 68.2 km 0 % · 82.2 km 0 % | 68.2 km 0 % · 88.7 km 0 % | 0 → 0 |
| Jelgava → Kuldīga, Adventure | 218.6 km 2 % 10.0 km · 256.6 km 6 % 28.3 km | 208.5 km 0 % 0 · 234.7 km 0 % 0 | 9 / 68.5 km → 0 |
| Jelgava → Kuldīga, Grants tūrists | 189.2 km 0 % 1.8 km · 215.2 km 0 % | 187.4 km 0 % 0 · 215.2 km 0 % | 1 / 1.8 km → 0 |
| Rīga → Baldone, Adventure | 59.9 km 4 % 4.9 km · 122.2 km 0 % | 55.0 km 0 % 0 · 115.8 km 0 % | 8 / 21.0 km → 0 |
| Sigulda 3 h loop, Adventure | 78.2 km 1 % · 96.7 km 0 % | identical | 0 → 0 |
| Sigulda / Cēsis / Kuldīga 3 h loops, Grants tūrists | 148.3 2 % / 130.0 3 % / 143.3 2 % | identical | unchanged |
| Circle K → farmstead via → Sigulda, Adventure | 146.3 km 2 % (3 spurs 5.0 km) · 136.4 km 13 % (4, 16.5 km) | 144.5 km 1 % · 109.0 km 2 % | every route keeps exactly one spur, its tip at the farmstead (0 m) |
| Sigulda → farmstead via → Sigulda, 2 h | 60.2 km 8 % (2 spurs 4.9 km), one route | 54.3 km 4 % · 53.8 km 4 % | only the 3.2 km farmstead spur, kept |

The farmstead is the end of `highway=service` way 118473891 (57.15945,
24.80593, 739 m dead end). The old loop code pruned the round trip, lost the
stop, and fell back to the unpruned path, generated spur included; now only
the farmstead's spur stays.

### 28b. Near-mirror spurs, and a loop instead of the cut — 2026-09-25 (not deployed)

**Rider's GPX, 2026-09-25** (Daugavgrīvas iela 4A → Mālpils šoseja 10, one
way, flexible, Grūti·Sports·Meži, 53 km, panel "3 % atkārtoti"): 1.49 km
ridden back at 35.2 → 36.7 km in the forest near Zušu purvs, drawn as two
lines a few metres apart. **Measured cause:** reproduced through the API as
candidate `via-1-1`, 52.8 km, the rider's ride to the decimal; its corridor
via #2 (57.05775, 24.26869) is 57 m from the tip. The spur is 1.62 km each
way: 1.35 km over *identical* vertices (unclassified/track, sand), then the
last ~300 m out on OSM way 996563529 and back on the parallel way 996563531,
8–17 m apart (both `track grade5 sand`). The tip is not a dead end —
996563531 runs on into the track network north-east — so snapping the via
onto a through-way does not help: routed with the via as generated, on the
tip vertex, 150 m NE on the network and 400 m E on a through track, the
candidate kept 1.6–1.9 km ridden twice every time. `pruneSpurs` needed an
exact mirror at the tip and found none.

**Fix, `lib/routing/prune-spurs.ts`.**
- *Near mirrors:* after the exact pass, a second pass matches the way back
  to the way out, sampled every 5 m: an earlier point within 25 m
  (`MIRROR_TOLERANCE_M`), heading the other way (> 120°), more than 50 m
  back along the ride. A run of such matches with a short far end
  (≤ 300 m, `MIRROR_TIP_MAX_M`) and legs at least half as long as that far
  end is a spur. It is cut only where both legs pass through the same vertex
  (≤ 1.5 m), so no road is invented; a hairpin whose legs never share a
  vertex, two carriageways 30–60 m apart, and a 420 m residential block
  ridden round (measured on the farmstead ride) are left alone. Protection
  as before: a near-mirror spur that is the visit to a rider's stop or the
  destination is kept whole. Exact and near passes repeat until neither
  finds anything.
- *Loop instead of cut* (`pruneOrLoopSpurs`, at the A→B/free-loop prune
  call in `buildCandidates`): for a cut spur of 300 m–5 km one way whose
  nearest waypoint is a GENERATED via, two fenced requests at once
  (BRouter `nogos` via `nogosAlong`, `fetchRouteAvoiding`, as edit mode):
  the way back from the tip with the way in fenced off, towards the ride two
  spur lengths past the base, cut where it first comes onto the ride; and
  the mirror from two lengths before the base to the tip. Accepted
  (`acceptSpurLoop`) only when it adds ≤ min(300 m, ¼ of the out-and-back)
  to the ride's geometric revisit and its stretch is ≤ 1.5 × the removed
  out-and-back plus the ride it replaces (edit mode's
  `LOOP_EXTRA_PER_SHARED`); least road ridden twice wins, then shortest.
  Otherwise the cut stays. Per ride: 16 requests (8 spurs), only in the
  first 20 s, 1.5 s per request. Rider stops never get here (their spur is
  protected before anything is cut).
- **Cost measured:** the first version (6, then 4 requests per spur, 24–64
  per ride, 2.5 s each) pushed the rider's ride from 35 s to 41–51 s and
  twice into the 50 s budget (3 of 23 candidates dropped); with loops off
  the same code ran 36.6 s. Our BRouter has one CPU: every fenced request is
  time the candidates wait for. Two requests per spur cover the four
  rejoin variants that won (back ×1 12, back ×2 4, in ×1 6, in ×2 4 of 26).

**Table** (own BRouter, form plan, Grūti·Sports·Meži, in-process harness;
before = `cb5fe7f`, runs interleaved; shown direct · complex; "revisited" =
the geometric detector, 20 m samples, a point within 25 m of one ≥ 300 m
back):

| Ride | before: km, panel %, revisited | after | spurs of the shown pick (after) | time before → after |
|---|---|---|---|---|
| **Daugavgrīvas iela 4A → Mālpils šoseja 10** | 52.8 km 3 % 1.6 km · 52.1 km 0 % 0.1 km | **51.5 km 0 % 0.1 km** · 84.2 km 0 % 0 km | direct: 2 cut (3.38 km), the rider's 1.62 km spur **looped** (back ×2); complex: 2 cut, allowance spent | 34.5 → 37.3 s |
| Circle K (Pērnavas 7) → Jelgava | 77.1 km 0 % 0.1 · 116.6 km 0 % 0.1 | 77.1 km 0 % 0.1 · **87.5 km 0 % 0.4** | complex is a new pick: a 2.3 km spur looped, +263 m ridden twice | 23.2 → 23.1 s |
| Jelgava → Kuldīga | 208.5 km 0 % 0 · 234.7 km 0 % 0 | identical | direct: 2 cut, neither loop cheap | 10.1 → 11.3 s |
| Rīga → Baldone | 55.0 km 0 % 0 · 115.8 km 0 % 0.1 | identical | direct: 1 cut (2.46 km, loop not cheap) | 17.5 → 18.9 s |
| Sigulda 3 h round trip | 78.2 km 1 % 0.4 · 96.7 km 0 % 0.5 | identical | 4 / 3 cut, allowance spent | 19.7 → 21.4 s |
| Circle K → farmstead → Sigulda | 144.5 km 1 % 1.6 · 109.0 km 2 % 2.4 | 144.5 km 1 % 1.6 · 108.3 km 2 % 1.6 | farmstead spur kept in both; 3 / 5 others cut | 49.6 → 50.8 s (both at the budget; after dropped 3 of 27) |

The rider's ride also offered a 58.0 km alternative at 7 % (an 8.7 km
near-mirror out-and-back); after, all six routes it returns read 0 % and
≤ 0.1 km revisited. Over the whole pool of that ride 8 spurs got loop
attempts (the allowance) and 3 were taken, the shown one among them. Sigulda's alternatives changed (a 49.9 km 14 %
loop now appears as the 5th alternative); the two shown picks did not.

**Overlap figure — not changed, deliberately.** For the rider's ride the
panel read 3 % (second pass only, vertex pairs: 2.5 %); counting both passes
it is 5.0 %; the geometric detector says 3.0 % (1.6 km); the whole
out-and-back is 3.24 km = 6.2 %. After: 0 % on every definition. Counting both
passes roughly doubles every figure (Sigulda 0.5 → 1.0 %, farmstead complex
2.2 → 4.1 %) and every threshold that reads it (the 15/20 % offers,
`insideBest − 10`, the rider's own `maxRepeatedPercent`) would silently
tighten by half; `classify.ts` and edit mode's `recomputeOverlap` must change
together. That is a rider decision, not a side effect of this fix. Tests:
`scripts/prune-spurs.test.ts` (19).

## 29. ~~Correct a generated route on the map, not through the chat~~ — DONE 2026-09-24 (not deployed)

**Done:** "Labot" on the result swaps the panel for the form's rows over
the ride's own map — same active-row rules, pin buttons, "+", the map's
search, Confirm/Cancel/Escape — and ride pins can be dragged (the drop
becomes the active row's mark, Confirm commits). Every commit re-routes
only the stretch around the changed place (`planEdit`) through
`/api/reroute-leg` and splices it (`applyRuns`); km, time, surfaces and
retraced % are recomputed from the spliced line. A place the line only
comes near is moved onto it and the rider is told by how much; beyond
500 m the edit is refused. Undo one step; "Labots ar roku · N %" kicker;
"Meklēt labāku apli ar šīm pieturām" is the explicit full search. Share,
save and GPX carry the edited ride. Measured Confirm → new numbers on our
BRouter, warm: 0.2–0.6 s for every edit kind. `FAST_REROUTE` is gone.

**Riders' feedback, 2026-09-24 (three reports).** After a route is
generated they want to fix it on the map — ideally drag the line somewhere
else, like Google Maps — and not by typing into the chat. If dragging the
line is not feasible, the minimum is: **see the stops on the result map and
add a stop there**, with the route re-drawn.

**Where this stands.** The machinery is built and shipped but switched
off: `FAST_REROUTE = false` in components/home-page.tsx gates
`onEditRoute`; `lib/routing/reroute-leg.ts` (+ test) and
`app/api/reroute-leg` re-route only the two legs around a moved/added
stop and splice them into the existing geometry — seconds, not a 30 s
search. Its ~640 UI lines were never exercised. Turn it on **after**
adapting it to the planning map's one-active-row model (84b6a38): on the
result map, mark = move the active stop or add one at the "+ Pietura"
control, one hint line, Confirm/Cancel, Undo one step, and the panel says
"labots ar roku" with the recomputed retraced %. "Drag the line" is that
same operation with the grab point becoming a new stop. Full re-search stays
as an explicit "Meklēt labāku apli". Related: a tap on the result map today
shows a leaked violet pick marker that does nothing (being removed
2026-09-24) — riders read it as exactly this feature.

## 30. ~~The planning map's header is cramped~~ — DONE 2026-09-24 (not deployed)

**Done:** one header row — the field (its tag names the active row, its
placeholder "Atzīmē vai meklē…" is the hint; the full sentence stays a
screen-reader status) and a round "+" whose tooltip is "+ Pietura". The
field takes the whole row, over the zoom buttons, while it has focus. TET
moved to the bottom row beside the full-screen button (above the legend
on the desktop). Measured at 375 px on the 309 x 341 px planning map: the
top band went from 127 px (37 % of the height) to 53 px (16 %), so the
clear map below it went 214 → 288 px (63 % → 84 %). The ride is framed
clear of the header and, where it shows, the legend.

**Rider, 2026-09-24, screenshot at phone width.** Since 84b6a38 the map's
top-left corner stacks three things — the search pill ("Erdmaņi" with its
tick), the "+ Pietura" pill, the hint line („Atzīmē kartē → „Līdz””) — and
the TET toggle sits right under them, all inside the `left-3 right-14` box
next to the zoom controls. It covers a third of a 375 px map and reads as
clutter. Tidy it: one header row is the target (search field that expands
on focus, "+" icon button for a stop, hint folded into the field's
placeholder or shown only while a mark is pending), TET moved to the
bottom row with the legend or into the layers control, and the whole thing
must not hide the start pin that the map centres on. Measure the map area
left visible at 375 px before/after.

## 31. Photos from Mopik rides in the loader's banner slot

**Rider, 2026-09-25.** The loader already sells one frame to an advert
(`components/route-loader.tsx`, `advertSlot`, shown 3 s in for 2.4 s). In
future that slot — or the whole wait, which can run to a minute — could
show random photos from rides planned with Mopik. Needs: a source (riders
upload from a saved/shared ride, or an Instagram #mopik feed the rider
curates), consent and moderation before anything is shown, a small CDN'd
set so the loader never waits on an image, and alt text. Ties in with the
paused loading-animation work (a minute-long, layered scene) — decide both
together.
