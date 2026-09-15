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

## 7. A ride of ~1000 km still does not generate

**Status 2026-09-15:** Step 1 done — a feasibility probe refuses or scales the search before it runs (`lib/routing/fetch-route-probe.ts`). Step 2 designed, not built.

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

## 8. POI for Europe

**Status 2026-09-15:** In progress. Geofabrik path built and made fast; LV LT EE PL published in `public/poi/`; second pass for PL DE CH AT IT SI died on a memory-starved machine — restart `run-phase2.sh`.

Outside LV/LT/EE loop anchors are geometric, so rides are unnamed and cannot be
planned *through* a hillfort or a ford. `scripts/build_poi_dataset.py` takes
its countries from a three-entry list — a data job, not a code one. Overpass
rate-limits a full build and the script already rotates mirrors.

The rider also asked whether **Google** could supply this instead. Not costed
yet; do that before committing to another Overpass run.

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

**Status 2026-09-15:** 11a–11e shipped (beach paths refused; sea term; seaward candidates; no vias in the water). Open: may the sea buy more than 10 % retracing; the 209 s dry-land failures on Liepāja → Ventspils; the beach check on the new coastal winners (11f).

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

## 19. Stops on the map, and suggestions in the details

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

## 20. A suggested place that cannot be routed to

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

## 23. The chat does not understand "vienalga" as an answer

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
