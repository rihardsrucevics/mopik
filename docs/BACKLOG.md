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

## 17. Saved rides: list on the left, map on the right

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

## 18. Next: drop the sparkle icon from "Izveidot maršrutu"

Filed by the rider on 2026-09-14 as the next ticket. The main form's
primary button carries a Sparkles icon before the label; remove the icon and
leave the text. Check the same button in the other places it appears (the
shared-route page's "Ģenerēt līdzīgu sev", the chat's send control) and keep
them consistent. `components/ride-composer.tsx`.
