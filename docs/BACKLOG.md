# Backlog

The rider's own list, in his order. Started 2026-09-14. Items move out of here
into `docs/PROGRESS.md` with measurements when they are done.

Ordering is the rider's, not an estimate of effort. When an item turns out to
be two jobs, split it here rather than quietly doing the easy half.

---

## 1. A stop added to a round trip must land before the return leg

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

## 2. Let the rider cancel a generation in progress

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

## 3. A failure must speak in the chat, not in a box below the fold

Reported 2026-09-14: "to error paziņojumu neredz, tam ir jābūt iekš čata."
Correct — the chat panel sits there empty with the rider's own line at the
top, while the explanation is in a yellow box underneath the whole panel,
off-screen on a laptop. The rider waits ~50 s and then sees nothing happen.

`app/page.tsx` keeps failures in a separate `error` state (set at :214 and
:231) rendered outside the conversation, while everything that *works* —
including the "nothing fits" verdict and the overlap warning — is pushed into
`messages` and read as a reply. A failure is the one case that leaves the chat
silent, which is exactly backwards.

Fix: push failures into `messages` as an assistant turn, with the retry as a
quick reply, the way `describeInfeasible` already does. Keep one path for
"Mopik answers", whatever the answer is.

Related: the message itself is often wrong. "Precizē ilgumu vai prasības čatā"
is useless when the real cause is that the ride is too long to plan (item 7) —
the text should say what actually happened.

## 4. Draw trails the way OSM draws them

Today every trail is a brown dashed line. Where OSM shows a **dotted** line,
Mopik should show a **red dotted** one. Update the map legend to match.

Touches `components/route-map.tsx` (the line paint) and the legend block that
lists Asfalts / Grants / Zeme / Nezināms and Ceļš / Meža ceļš / Taka.

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

## 8. POI for Europe

Outside LV/LT/EE loop anchors are geometric, so rides are unnamed and cannot be
planned *through* a hillfort or a ford. `scripts/build_poi_dataset.py` takes
its countries from a three-entry list — a data job, not a code one. Overpass
rate-limits a full build and the script already rotates mirrors.

The rider also asked whether **Google** could supply this instead. Not costed
yet; do that before committing to another Overpass run.

## 9. Multilingual UI

Latvian for Latvians, Lithuanian for Lithuanians, Estonian for Estonians,
English for everyone else.

Note the known related problem: route *names* are already English outside a
Latvian prompt, because `locale` is detected from the prompt text and an API
call without one falls through to English. That is the same problem seen from
the other end and should be fixed with this, not separately.

## 10. A footer, and a header freed up for language

Move the Instagram icon and "Sazinies" into a new footer, which also carries
extra info and other pages. The header then has room for the language picker
and whatever else belongs there.

Depends on nothing; unblocks the language picker in item 9 having somewhere to
live.

## 11. Routes still run along the sea

Recurring. The sandy beach tracks are already refused (`beach_like_path`), so
this is about riding *beside* the sea, not on it — measure what the routes
actually use before changing costs.

## 12. Routes run through private property

Sometimes harmless, sometimes it is somebody's farmyard, which is not all
right to ride through. Open question — the rider asked how to solve it, not
for a specific fix. OSM access tags are already respected; a house or a
homestead with no access tag at all is the hard case.

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
