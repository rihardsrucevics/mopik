# Mopik — progress log

## 2026-09-12 (late, 2) — the beer moved into a popup; feedback goes to the inbox

- **Beer popup** (`components/beer-popup.tsx`) replaces the inline banner:
  after "Lejupielādēt GPX" (the file downloads first) a full-screen dark
  card in the Revolut QR colour (#201f25): "GPX ir tavs. Lai labi brauc!",
  "5 € caur Revolut" button, the QR (`public/revolut-qr-dark.svg`, light
  modules on dark) on desktop only, and every way to skip it (×, outside
  click, Escape, "Varbūt citreiz"). GA events `beer_popup` and `beer_click`.
  The "viena cilvēka vakaru projekts" line is gone by the rider's wish.
- **"Download GPX" → "Lejupielādēt GPX".**
- **Feedback** (`components/feedback-dialog.tsx`, `app/api/feedback/route.ts`):
  an "Atsauksme" link in the header opens a dialog (text, optional e-mail,
  the current plan/route attached as context). The API e-mails
  rihards.rucevics@gmail.com through Resend when `RESEND_API_KEY` is set
  (sender `onboarding@resend.dev`, which may deliver to the account owner's
  own address without domain verification, so no DNS work); without a key it
  answers 503 with a `mailto:` carrying the same text and the client opens
  the rider's mail app. Every message is also logged to the runtime log.
  **To finish: create a Resend account with that Gmail address, make an API
  key, add `RESEND_API_KEY` to Vercel production.**

## 2026-09-12 (late) — "Uzsauc man aliņu"

A small dashed card under the route result: beer glyph, "Patika trase?
Uzsauc man aliņu.", a "5 € 🍺" button to the Revolut link with the amount in
the path (`https://revolut.me/rucijs/5eur`; the base link works if the
amount is not prefilled) and, on desktop only, a QR code encoding the same
link (`public/revolut-qr.svg`, generated with the `qrcode` CLI, 37×37
modules). Clicks send a `beer_click` GA event when gtag is present.
Component: `components/beer-banner.tsx`, placed in `result-panel.tsx` above
the details.

## 2026-09-12 (night) — on the phone, the words come first

The rider generated Jelgava on the phone, got the honest verdict, and could
not see it: the map took 42 % of the screen, the chat panel's header and
chips took the rest, and the log was scrolled to its end. He scrolled up
only because he knew the text had to be there.

- **Map height on the phone:** 42dvh with the result panel, **26dvh while
  the chat has something to say** (`result && chatting`), full screen on
  request. The chat panel under the small map grows to `74dvh − 8.5rem`.
- **Log scrolls to the START of the latest reply**, only inside the log
  (`scrollTo` on the log element, never `scrollIntoView`, which would drag
  the page). While working or after the rider's own message it follows the
  end as before.
- **Full-screen map on the phone:** a button bottom-left on the map toggles
  `fixed inset-0`; body scroll locked, Escape closes; hidden on desktop.
  `RouteMap` now has a `ResizeObserver` calling `map.resize()`, so both the
  height change and the full-screen toggle repaint correctly.
- **Budget checks yield to insistence:** "tomēr / vienalga / mēģini / anyway"
  skips `transitCheck`/`viaBudgetCheck`, and the via check asks once per
  places-and-hours (the constraint changing from "līdz 2 h" to "~2 h" is the
  same ask). Before, an insisting second message was asked the same question
  again.

## 2026-09-12 (evening) — a ride that cannot fit gets a sentence, not an error

**The case.** "Rīga → Jelgava → Rīga, ~2 h, Meži" answered "Neizdevās atrast
maršrutu…" (422). All 17 candidates had routed and reached Jelgava; every
one was 136–163 km / 4 h 01 – 4 h 43, i.e. 80 %+ past the 24-minute free
band, so `worthShowing` emptied and the handler treated "nothing fits" as
"nothing found". brouter.de was not the cause: the self-hosted run failed
identically in 7 s. The ride physically cannot be done in 2 h on forest and
gravel roads; the minimum is ~4 h.

**Rule from the rider:** such an error must never reach the chat. The chat
resolves it: what is not OK, alternatives near the requested time, and the
minimum that can be planned on the chosen road type.

- `lib/chat/feasibility.ts` (new): `estimateLegs` (straight line × 1.3 at
  the planning speed; asphalt and one-way variants), `exceedsBudget` (fires
  above 1.2× the request), `describeInfeasible` (the shared LV/EN sentence
  and chips). `estimateTransit` moved here.
- Chat API: `viaBudgetCheck` after `transitCheck` — Photon lookups of the
  places, then, before routing: "Rīga → Jelgava → Rīga pa meža un grants
  ceļiem 2 h ietvaros nesanāk: taisnākais ceļš turp un atpakaļ ir ~105 km, pa
  meža un grants ceļiem tas ir ap 3 h 10 min. Kā darām?" with chips **Kopā
  3.5 h / Pa asfaltu 2 h / Vienā virzienā Rīga → Jelgava**. Asked once per
  budget. "Vienvirziena brauciens …" turns the last via into the destination.
- Generate API: when budgeted and nothing passes `worthShowing` but
  candidates routed, the nearest-to-budget rides are returned (200) with
  `infeasible: {requestedMinutes, minimumMinutes, minimumKm, directKm,
  directMinutes, asphaltMinutes, oneWayKm, oneWayMinutes}`. 422 only when
  nothing routed at all. `debugCandidates` also on the 422.
- Page: on `infeasible` the map shows the shortest ride and the chat says
  "Īsākais, ko šeit var izplānot …, ir 4 h 1 min / 136 km — tas ir kartē."
  with chips incl. **Rādīt tuvāko (4 h 1 min)** (`ChatQuickReply.action`).
- Golden set 14/14 (two new cases); unit tests 10/10. Jelgava on brouter.de
  via the fixed handler: 200, 136 km / 241 min leads.
- Built by a parallel agent in a worktree on branch `fix/via-plan-honest-limit`,
  merged here. Production request took 55 s on brouter.de — close to Vercel's
  60 s; another argument for the self-hosted BRouter.

**Also:** two rider's breaks in the loader — "Uzpīpēju…" with a cigarette
burning towards the filter and "Iedzeru aliņu…" with a beer emptying — slipped
into the status lines at random positions (never first), once each per
generation; reduced-motion disables them like the rest.

## 2026-09-12 (later) — the surroundings of a stop, and a complex version that earns its name

The rider's rule: "Rīga → Baldone → Rīga" is, for most riders, a ride to ride
*around* Baldone. So the winding and complex versions may include the
surroundings; the straight one never does. Via the chat, "vairāk apkārtnes"
asks for more of it.

- **Ring candidates** (`around-<r>-<side>` in `buildCandidates`): a small
  ring around each via place — arrive, swing round one side, pass beyond,
  come back the other side, leave — on a short offset corridor, routed with
  the rider's own profile. `surroundings: "some" | "more"` in plan and intent
  (default some; chat regex + prompt for more) scales the radius.
- **Wiggle candidates** (`zig-<scale>`): three offsets per leg on one side
  with breathing amplitude (wide, narrow, wide): turns and short
  opposite-direction stretches while the overall direction holds. Two
  flavours, the rider's profile wide and the deep profile narrow.
- **Complex scoring** now rewards turns (`turnsPer10Km × 1.2`) on top of
  tracks, trails, roughness and nature; the straight pick never takes a
  detour candidate; the complex pick may take a detour candidate up to 10 %
  past the free band (the panel states the overshoot).
- **What it took to make the rings fit** (Rīga → Baldone → Rīga, 3 h, Meži,
  local BRouter): crossing zigzags retraced 52 %, dropped. Rings inheriting
  the straight corridor retraced 33 % (the corridor itself retraces 48 %),
  fixed by offsetting the corridor like the via candidates. A 2.3 km ring
  with the deep profile came back 45 min over budget — the rider's loop
  around Baldone is slow forest track, ~15 km/h — so the ring is small
  (1.2–3.5 km) and the corridor short. Result: **Sarežģītākā = ring around
  Baldone, 97 km / 3 h 18, 12 % repeated, 67 % unpaved, 38 % track**;
  Taisnākā 108 km / 3 h 27 at 1 %; Līkumotākā 113 km / 3 h 34 at 4 %.

## 2026-09-12 — the chat understands the ride's shape; the time limit is honest

**The case.** "Atradi foršu meža apli kaut kur Baldones mežos un uztaisi
maršrutu no Rīgas, pa to apli un atpakaļ" came back as Rīga → Baldone → Rīga
along two corridors: Baldone was a turnaround, the forest loop never
happened, and with 2 h total the transits ate everything. The plan schema had
no way to say "the fun part is over there".

- **Focus area in the plan** (`focusArea`, `budgetScope` in `ride-plan.ts`).
  The chat sets `focusArea: "Baldone"` (nominative town, not in viaPlaces) and
  the generator builds transit → loop → transit: a direct asphalt transit
  (`rideStyle: direct`, gravel 0, easy) out, the normal loop machinery with
  the focus town as its start and the rider's own settings, and a return
  that competes three corridors on how few road pieces they share with the
  way out. Legs are stitched by `lib/routing/join-paths.ts`; the whole ride
  is what the rider sees and exports. Budget: total minus the two measured
  transits, unless the rider said the hours are for the loop only.
  Measured, Rīga → Baldone, 4 h total, Grūti/Meži: transit 46 km / 59 min
  each way, loops 56–102 km, totals 227–263 min, 2–6 % repeated, 66 %
  unpaved. The response carries `remoteLoop` and the result panel shows
  "Pārbrauciens 46 km · 59 min → Baldone aplis 30 km · 50 min → atpakaļ".
- **Transit arithmetic before drawing** (`transitCheck` in the chat API,
  `lib/chat/photon.ts` for coordinates and a straight-line × 1.3 at 48 km/h
  estimate). 2 h total with ~50 min each way → "Pārbrauciens Rīga → Baldone ir
  ap 50 min katrā virzienā, tāpēc 2 h kopā mežam atstāj tikai ~20 min. Kā
  skaitam?" with two taps: "Kopā 3 h" / "2 h tikai aplim". Asked once per
  budget, not every turn.
- **Understanding sentence.** The model now returns `understanding`, one
  sentence in the rider's words, shown as "Sapratu: No Rīgas aizbraukt uz
  Baldones mežiem, izbraukāt tur foršu meža apli pa grants ceļiem un takām,
  un atgriezties Rīgā." whenever the ride's shape is new or changed; field
  diffs ("ilgums atjaunināts") remain for small corrections. First message
  runs at `effort: medium`, corrections at `low`.
- **Golden set** `scripts/chat-golden.ts` — 12 rider phrasings (focus area vs
  plain via vs "ap Siguldu", loop-only hours, English, one-way, direction,
  transit check firing and resolving, low overlap) → expected plan fields and
  reply patterns, against the dev server. 12/12 on the first run; run it
  after every prompt change.
- **Time limit, first user's feedback** ("tas laika limits negrib strādāt…
  noved pie stundām ilga maršruta"). Three changes: (1) the result panel
  states the verdict — "Prasīts ~2 h, šī versija ir 2 h 47 min." — with
  one-tap ways out (Meklēt īsāku (līdz 2 h) → a hard maximum; Meklēt garāku;
  the API's cleaner-loop offer when there is one), and colours over-budget
  times amber on the version cards; (2) versions more than 45 % past the
  free band are no longer shown, and when nothing is inside the budget the
  nearest-to-budget versions lead instead of the cleanest; (3) the second
  correction pass now also runs on the public BRouter (capped at 4 shapes) —
  before it was self-hosted only, which is exactly what production uses.
  "Ne vairāk kā N stundas" is parsed deterministically as a maximum.
  Rīga 2 h locally: 1 h 46 – 2 h 05, all inside the band.
- **Form:** hours as one-tap 2 h / 4 h / 6 h / 8 h plus a field with the
  decimal keypad on phones (`inputMode="decimal"`, `type="text"` so "2,5"
  works).

Open: the real fix for production time drift is a self-hosted BRouter
reachable from Vercel (a small VPS); brouter.de's pacing is why passes are
capped there. The form's "Uz + Turp un atpakaļ" still means a via, not a
focus area — decide whether the form should offer "izbraukāt apkārtni".

## 2026-09-11 (night) — the route draws itself, lucky rides, share card

- **Intro and loader animation** (`components/route-loader.tsx`,
  `components/intro-splash.tsx`, keyframes in `globals.css`). One SVG scene:
  contour lines, an orange route drawing itself solid → dashed → dotted like
  the map legend, a motorcycle riding the very path being drawn (SMIL
  `animateMotion` + `mpath` on `#mopik-route`, so they never drift). The intro
  plays once per browser session (`sessionStorage`, module-level cache so
  StrictMode's double effect doesn't mark it seen), skips on click and on
  `prefers-reduced-motion`. The same scene, smaller, replaces the spinner in
  chat with phase-specific status lines (thinking / routing / lucky).
- **Lucky ride.** Start only, no destination, flexible time → the API gets
  `lucky: true`, targets ~120 km instead of 80, and the result panel opens on
  the *Sarežģītākā* version with the banner "Bez galamērķa un laika limita?
  Laimīgais!". Verified: Tukums → 102/117/124 km, 3 versions.
- **Logo → `/`** with a full reload (fresh plan; eslint rule disabled on that
  one anchor on purpose).
- **CTA no longer shrinks** when the profile panel opens: the composer body is
  a scrollable flex column, so the button needed `shrink-0` (was squeezed to
  ~30 px on desktop).
- **OG / share card.** `app/layout.tsx` now has `metadataBase`
  (www.mopik.eu), Latvian title/description, Open Graph (`lv_LV`), Twitter
  large card, `lang="lv"`, theme colour. `app/opengraph-image.tsx` renders a
  1200×630 PNG with `ImageResponse`: the same hill/route/bike motif, wordmark,
  tagline. Check with any link-preview tool after deploy.
- **Safari bug, not yet reproduced.** After Rīga → Baldone → Rīga (flexible)
  Safari showed "The string did not match the expected pattern." (a WebKit
  `SyntaxError` DOMException; Chromium runs the same plan fine). The error box
  now appends `name: message — first stack frame` for non-Mopik errors and
  logs the full error to the console, so the next occurrence tells us where.
  Suspects: SVG/SMIL attributes in the loader, `sessionStorage`, `Request`
  construction.

## 2026-09-11 (evening) — three versions, left-column summary, place picker, Mopik

- **Three versions per request** instead of one, from the same candidate
  pool: `direct` (few turns, few rough tracks, shortest reasonable),
  `balanced` (ranking's pick), `complex` (max track/trail + forest). Tukums
  2 h: 87 km gludi / 65 km / 49 km with 41% tracks; Rīga → Baldone: three
  different roads. Picked by re-scoring the accepted pool on each axis and
  rejecting duplicates (>80% shared road pieces). `components/route-variants.tsx`
  shows them as cards; the chat's correction applies to the selected one.
- **Layout — the left column is either the result or the chat, never
  both** (rider's design). After generation `components/result-panel.tsx`
  takes the whole column: request summary, three version cards, the
  selected route's name and numbers, Download GPX, warnings, folded details,
  and at the bottom a "Ko mainīt?" input. Sending a correction flips the
  column to the chat (`chatting` state in `page.tsx`) until new routes
  arrive, then the result view returns. Tried and rejected on the way: a
  sheet over the map (hid the map) and a card inside the chat (ate the
  history). Phone: the map is hidden until a route exists, then comes first
  (42 dvh) above the result; the composer is compact (No/Uz side by side,
  ride type + duration side by side, hours inline, choices always
  horizontal, header note hidden). Legend under the TET toggle, hidden on
  phones.
- **Place picker**: `/api/places` proxies Photon (komoot) restricted to Baltic
  settlements (city/town/village/hamlet), Latvia first, bigger first, cached
  10 min. `components/place-input.tsx` is a debounced combobox; a picked place
  carries coordinates (`places[]` on the request) and the API uses them
  instead of geocoding. "Valmi" → Valmiera (city) first. Typed-but-unpicked
  names still geocode as before.
- **Profile**: difficulty is three levels (Viegli / Vidēji / Grūti → easy /
  adventure / hard), style two (Tūrisms / Sports); Mix removed.
- Product was renamed to Mopiks in the UI, GPX creator and doc headings, then back to **Mopik** the same day at the rider's request.
- Checkpoint commit `fe64a41` made before this work; 19 tests pass.

## 2026-09-11 (later) — the profile is one line, not three questions

Rider's observation: for adventure/enduro riders the variables are place,
duration and ride type; the other three choices are the same 90% of the time
(technical, riding, as much forest as possible). So they are now a **profile**:

- `lib/chat/ride-profile.ts`: `RideProfile` {difficulty, style, surface},
  default = adventure/riding/forest, presets (Adventure, Mierīgs izbrauciens,
  Asfalta tūre), the single profile → plan mapping shared by the form and the
  chat commands, `seedPlanFromProfile` for chats, device storage.
- `components/ride-composer.tsx`: first screen = No/Uz, ride type, stops,
  duration. The profile is one line ("Piedzīvojums · Braukšana · Meži —
  Mainīt") that expands to presets + the three choices. Remembered on the
  device (`useRideProfile`, `useSyncExternalStore`, no hydration error).
- A fresh chat is seeded with the profile, so "2h ap Tukumu" needs no
  clarifying questions about difficulty/style/surface.
- **Conflicts**: the three axes are how rough / why / where and combine
  freely — easy + forest is a real need (heavy bike, passenger). The one
  meaningless combination, technical + asphalt only, is removed: asphalt hides
  the difficulty choice and normalises it to easy. Labels live in
  `PROFILE_LABELS` for renaming.
- `scripts/compose-plan.test.ts` (5 tests); 18 tests pass in total.

Verified in the browser: line renders, "Tikai asfalts" hides Grūtība and the
summary becomes "Braukšana · Tikai asfalts", the choice survives a reload.

## 2026-09-11 — taking over from Codex: one missing `or` had broken every route

Codex (OpenAI) worked in this folder 2026-09-09 → 09-11 (see
`RIDER-AUDIT-2026-09-09.md`, `CHAT-MVP-2026-09-10.md`) and stopped mid-turn
when its credits ran out, with "Edited 10 files" unfinished. State found:

- `tsc` clean, ESLint clean (one unused-var warning), both servers up.
- 1 of 6 Codex tests failing: `chat-plan.test.ts` expected the old style
  question wording ("exploring"); the composer vocabulary is now Tourism /
  Riding / Mix. Test updated, not the code.
- **Every generation with a `RidePlan` returned 422** ("Neizdevās atrast
  maršrutu…") after ~84 s — the screenshot the rider sent. Cause: the
  generated BRouter profile no longer parsed. In the `report_only` block the
  added line `or estimated_noise_class=4 or estimated_noise_class=5
  estimated_noise_class=6` closes the `or` chain one operand early, so the next
  line starts with a top-level `or` and BRouter answers a bare HTTP 500 to
  every route. Diagnosed from `brouter-server/brouter.log`
  (`ParseException … operator or is invalid on toplevel`). Fix: one `or`.
  All 18 profile variants (trails × accessPolicy × difficulty) now parse.

After the fix, the plan from the screenshot (Rīga → Baldone one way, flexible
duration, adventure, Mix, forest): **54 km / 1h54, 78% unpaved, 47% track,
3% repeated, 3.4 km streets, 5.5 s.** Free-text path still works (three
regression prompts below). Tests 13/13.

Nothing has been committed since 2026-09-02; the whole audit, the chat MVP
and these fixes are uncommitted working-tree changes.

## 2026-09-11 — structured ride composer, chat for corrections

- Replaced chat-first setup and detached settings panels with one visible,
  ticket-like composer: From, To, optional stops, round trip/one way, duration,
  `Atpūta`/`Piedzīvojums`, `Tūrisms`/`Braukšana`/`Mix`, and
  `Tikai asfalts`/`Der arī grants`/`Meži`.
- Composer choices become `RidePlan` deterministically in
  `lib/chat/compose-plan.ts`; the direct flow does not call an LLM.
- Chat remains an alternative start and becomes the correction UI after a
  result. Returning to the form preserves the current plan.
- The default style is `Braukšana`: riding quality is primary and sightseeing
  stays opt-in through `Tūrisms` or `Mix`.
- Live UI check: Rīga → Ainaži, one way, flexible, adventure, riding, forest
  produced one 229 km route, kept unverified forest paths visible as a warning,
  stayed inland, and reported 39.8 km of incidental TET coverage.
- `npx tsc --noEmit`, targeted ESLint, and `git diff --check` pass.

See `docs/CHAT-MVP-2026-09-10.md` for the current product and data-flow rules.

## 2026-09-08 (late) — "think like a rider": the Turaida 30-minute case

Rider report from the deployed site: "30min offroad ride close to turaida"
came back as an out-and-back on ordinary roads, 49% retraced, with the app
suggesting a 170 km ride instead. His brief: if a tidy 30-minute forest loop
does not exist, relax and look for alternatives the way a person would.

### Why it happened

- Claude labelled "offroad ride" as **easy** (grade 5 forbidden, sand 2.5×).
- `stopsFor(21 km)` returned **2 stops** — a there-and-back with a kink.
- The calibration radius hit the 1.2 km floor: the whole loop was inside
  Turaida village, where the Gauja valley offers one way out.
- The offer came from an **absolute 18 km probe**, hence 170 km for 30 min.
- Distance drift was judged in % of the request, so a 45-minute answer to a
  30-minute question cost as much as +2 h on a 4-hour ride.

### What changed (`route.ts`, `loop.ts`, prompt)

- Prompt: "offroad / off-road / enduro / pa mežiem" → adventure, gravel ≥85,
  trails ≥ some; "easy" only when the rider says so.
- **Minimum three stops**; cluster radius and minimum stop distance scale
  with the ring (0.7× / 0.6×) instead of a fixed 5 km.
- **Drift in minutes with a human free band**: max(tolerance, 15 min / 10 km)
  is free; excess counted in % of the request. Duration requests are judged
  on the speed model's minutes.
- **Relaxation ladder instead of the probe**: rings at 1.6× and 2.4× the
  radius (floored at 3 / 5 km) taking anchors from a **second, wider
  isochrone**, teardrops in four directions at 1.6× (floor 5 km) and two at
  2.4× (floor 7 km). They compete in the ranking; the drift term decides.
- **Mutation pass** (self-hosted): the two best loops and the best wide loop
  are rotated ±25°, scaled ×0.85 / ×1.2, and given ±1 stop — ~18 more routes
  at ~0.1 s each. "1h ap Turaidu": 21% → **3%** (58.7 km, 80 min).
- **The offer is the nearest loop that solves it**: among out-of-tolerance
  loops with ≤20% retracing that beat the in-tolerance best by 10 points, the
  one closest to the request; only if none, the cleanest.
- Shown options: no option retracing >10 points more than the best of the
  top five, none with excess drift >60%.
- `debug: true` now returns `debugCandidates` — the whole pool with rank
  inputs — which is what made the above diagnosable.

### Results

| Prompt | Before | After |
|---|---|---|
| 30 min offroad, Turaida | 18–23 km, 24–49% retraced, offer 171 km | 16 km / 21 min at 24%, **41 km / 59 min at 17%**, offer 65 km / 4% |
| 1h ap Turaidu, pa mežiem | 43–59 km, 11–23% | **59 km / 80 min, 3%** |
| Riga 200 km | 201 km, 9% | 173–223 km, **2–6%** |
| Sigulda 4 h | 182 km, 11% | 130–191 km, **4–6%** |
| Kuldīga 150 km | 134 km, 29% | 148 km, 82% unpaved, **1%** |
| Cēsis 3 h hard | 137 km, 8% | 106 km, **3%**, 24% track |
| Tukums 2 h | 90 km, 5% | 86–100 km, 4–9% |
| Alūksne 120 km | 122 km, 4% | 115–134 km, 3–4% |
| Riga Mežaparks 130 km forest | 155 km, 2% | 115–138 km, 3–10%, 44–48% track |

Turaida at 30 minutes remains what the terrain makes it: the Gauja valley has
one way out, so the honest answer is the 59-minute loop, and the app now says
so with numbers instead of pretending.

### Docs

`docs/ENGINEERING-SUMMARY.md` (Latvian) — goals, how the algorithm is built,
measurements, open problems — written for an engineering review.

## 2026-09-08 — calibrating against a rider's own plan: "ved cauri mežu takām"

The rider sent a 126 km GPX of the ride he imagines (Riga Mežaparks → Ropaži
forests → Ogre side → back; planned in gpx.studio) and asked how the
generator could produce rides like it — and whether to borrow bicycle
profiles (no: they route onto cycleways motorcycles may not use).

### What the ideal ride is made of (matched to OSM via Overpass, 40 m snap)

| | km | share |
|---|---|---|
| `highway=track` | 71.3 | **56%** |
| of which grade4 / grade5 | 13.2 / 12.5 | 20% |
| `unclassified` | 20.7 | 16% |
| primary + secondary + tertiary | 21.0 | 17% |
| `highway=path` | 5.2 | 4% (plain untagged forest paths, old railway beds) |
| surface sand | 12.2 | 10% |
| forbidden by our profile | 6.0 | 5% |

So the network the rider wants is available to us — the costs were the
problem, not the forbid list. "Dotted lines" to this rider means grade 4–5
tracks (rendered dotted on OSM Carto) far more than `highway=path`.

### Fidelity test (`scripts/fidelity-ride.ts`)

Route the ride's own via points (start, end, evenly spaced stops) with our
profile and measure the share of the result within 30 m of the ride. First
run, 24 via points 5.5 km apart: **282 km for a 126 km ride, 36% on the
ride.** Per-leg diagnosis (`trekking` as reference did every leg in 5–9 km):

1. **Main roads cost 170× a track.** Valhalla-era formulas (primary 12 + 60·t
   = 63× at t 0.85, track 0.37×) made the router ride 36–40 km of forest to
   dodge 2 km of primary where the network needs it (Ogre river, railway).
   Now tertiary 2.2 + 1.5·t, secondary 3 + 2.5·t, primary 4 + 3·t; tracks
   floored (lots 0.9 − 0.4·t) so the ratio stays ≤ ~12×; the unpaved surface
   bonus no longer stacks on tracks. This is also why Riga loops crawled
   50–80 km of residential streets: streets cost 3–5×, arterials 26–63×.
2. **`trunk` was forbidden with `avoidMotorways`.** Latvia's A-roads are
   `trunk`, not `motorway`; the last 5 km home needed 44 km because the only
   motor route in was a trunk link. Trunk is now dear (6, 12 with avoid),
   only `motorway` is refused. `*_link` ways follow their parent class.
3. **`smoothness=impassable` was forbidden**; 200 m of it sat on the ride.
   Now 20× (hard 8×), forbidden only for easy.
4. **Plain paths** (`highway=path` without foot/bicycle designation, outside
   town class 4) are allowed at 3× when the rider asks for lots of trails,
   reported as trail km. Footways, cycleways, bridleways, steps stay forbidden.

After: 24 via → **127 km, 54% on the ride, 63% track, 24 km grade 4–5**
(ride: 126 km, 56%, 25 km). With 6 via points 100 km / 50%. `trekking`
itself only scores 53% on the same test — parallel tracks 40 m apart count as
misses — so ~55% is close to the ceiling of the metric.

### Effect on the seven prompts (local BRouter, Claude parser)

| Prompt | Before (09-03 night) | Now |
|---|---|---|
| Riga 200 km, avoid towns | 165 km, 52% unpaved, 35 km streets, 36% repeated | **201 km, 74% unpaved, 14.6 km streets, 9% repeated** |
| Riga Mežaparks 130 km, forest, lots dotted (new) | — | 155 km, 43% track, 32 km grade4–5, 4.7 km path, 2% repeated |
| Sigulda 4 h | 161 km, 17% | 182 km, 4h14, 64% unpaved, **11%** |
| Tukums 2 h | 79 km, 4% | 90 km / 1h59, 5%; 108 km alt with 67% deep forest |
| Alūksne 120 km | 129 km, 18% | 122 km, 73% unpaved, **4%** |
| Cēsis 3 h hard | 95 km, 31% | 137 km, 8%; 82 km with 38% track |
| Kuldīga 150 km max forest | 184 km, 19% | 134 km, 96% unpaved, 29% |

Retracing fell everywhere because a short main-road link can now close a
loop instead of forcing the way back over the same tracks.

### Also

- Local BRouter stopped with `FileNotFoundException … (Operation not
  permitted)` on `lookups.dat`: macOS denies Documents access to a server
  started from the app's preview runner. Start it from a terminal
  (`../brouter-server/start.sh`).
- `scripts/measure-prompts.mjs` is now in the repo (the scratch script was
  lost with the temp dir).

### Next for "rides like this one"

- **Ridden-ways layer**: match rider GPX tracks to OSM way ids (as done here)
  and give those ways a discount, exactly as the TET slice does — every ride
  the rider uploads teaches the generator where the good tracks are.
- Sand: the ride had 12 km, our "lots" routes 2–8; sand cost for hard/lots
  could drop to 1.0 unless `noSand`.
- Speed table still uncalibrated (the GPX has no timestamps).

## 2026-09-03 (late) — local BRouter, "into the forest", teardrops for city starts

### Local BRouter

`../brouter-server/` (outside the repo): BRouter 1.7.10 jar, the four Baltic
segment files (E20/E25 × N50/N55, 143 MB), `start.sh` (brew openjdk, port
17777, custom-profile upload enabled). `BROUTER_BASE_URL=http://localhost:17777`
in `.env.local`; `.claude/launch.json` has a `brouter` entry. Routes in
~0.2 s, no throttle: all six test prompts succeed (the public instance had
just failed all six). Being self-hosted unlocks 12 loop shapes instead of 4
and a second correction pass.

### "Ved pa granti, mežos īsti neved iekšā"

The rider's reaction to the first quality profile. Correct: the turn cost and
grade penalties that removed the zigzag also kept the router on the
continuous gravel road (Kuldīga→Renda track share 18% → 2%). Real OSM paths
stay forbidden (no motor access), so "dotted lines" for us means rough forest
tracks — and that is now a separate lever:

- `trailPreference` drives the profile: "some"/"lots" make tracks cheaper
  than gravel roads (0.75−0.45·t vs 2.2−1.9·t), drop the grade 3–5 penalties,
  lower the turn cost (50 vs 120) and the surface-switch cost (150 vs 400),
  and make `unclassified` roads 10–35% dearer.
- **Forest discount** from BRouter's `estimated_forest_class` (populated 1–6
  across all 3,951 measured edges): ×0.70/×0.55 for mid/deep forest with
  "lots", ×0.85/×0.75 with "some", ×0.90 deep-forest-only with "none".
- **Traffic penalty** from `estimated_traffic_class` ≥5 (×1.3 / ×1.6).
- Claude's prompt now maps "pa mežiem" / "meža ceļi" to trailPreference ≥ some.
- The off-road dial follows `gravelPreference` directly; difficulty only
  governs roughness, sand and fords (Claude labels "daudz grants" as easy +
  80% gravel, which the old mapping would have sent onto asphalt).

Same legs, adventure, none → lots:

| Leg | track share | forest class ≥4 share | turns/10 km |
|---|---|---|---|
| Kuldīga→Renda | 2% → 18% | 69% → 81% | 2.4 → 4.1 |
| Rīga centrs→Baldone | 28% → 33% | 47% → 54% | 7.4 → 9.1 |
| Rīga Berģi→Ropaži | 57% → 64% | 66% → 69% | 8.7 → 8.5 |
| Tukums→Jaunpils | 8% → 12% | 24% → 27% | 4.5 → 5.2 |
| Sigulda→Nītaure, Alūksne→Ape | unchanged | unchanged | unchanged |

Point-to-point legs can only move so far off the straight line; the loop
planner is where the forest comes from, and there the lever compounds with
the shapes below.

### Loops: second pass, minimum stop distance, teardrops, street ranking

- **Second correction pass** (self-hosted only): when the median loop length
  is >25% off target, every shape is re-planned at radius × (target/median)
  and routed again. Tukums 2 h: 106–110 km → 69 / 79 / 95 km against 82.
- **Stops at least half the ring radius from the start** — Riga loops were
  linking viewpoints 3 km out through 50 km of streets.
- **Teardrop shapes** for city starts (street share of the calibration loop
  >25%, and always four of them when self-hosted): stops fanned across a 100°
  sector at 1.7× radius, so the loop leaves along one corridor and returns
  along another. Sigulda 4 h: best option 132 km / 46% repeated → **161 km /
  17%** (Līgatne ferry, Nītaure). Riga 200 km: streets 77–80 km → 35 km,
  unpaved 32% → 52%, still 36% repeated — the Riga case remains the hardest.
- Streets enter the ranking (×1 with `avoidTowns`, ×0.3 otherwise).

### Six prompts now (local BRouter, Claude parser)

| Prompt | Best option |
|---|---|
| Sigulda 4 h, ~50% gravel | 161 km / 4h13, 59% unpaved, 17% repeated |
| Kuldīga 150 km, max forest, no sand | 184 km, 82% unpaved, 0 sand, 19% repeated |
| Cēsis 3 h hard | 95 km / 2h51, 62% unpaved, 29% track |
| Riga 200 km, avoid towns | 165 km / 4h49, 52% unpaved, 35 km streets, 36% repeated |
| Tukums 2 h | 79 km / 2h03, **4% repeated**; 69 km / 1h43, 11% |
| Alūksne 120 km | 129 km, 61% unpaved, 18% repeated |

Generation takes 3–25 s; Riga 100 s (12 shapes + second pass on long routes).

### Still open

- Riga: a loop from the capital needs to get 30+ km out; teardrops help but
  36% retracing on the corridors remains. Ideas: corridor separation ≥120°,
  or start the loop at the city edge and report the approach separately.
- Speed table calibration against ridden GPX tracks.
- UI controls for `noSand` / `avoidTowns` / trail level (the prompt sets them).
- `brouter-server/start.sh` is started by hand (or via launch.json); no
  auto-start.

## 2026-09-03 (night) — the audit plan, items 1–6 built

Everything in the evening audit's plan except self-hosting, measured with the
same six prompts (`debug: true` API flag, `scripts/experiment-profile.ts`).

### Profile (`lib/routing/moto-profile.ts`)

Now costs `tracktype`, `smoothness`, `surface=sand|mud|grass`, forbids
`motorcycle=no|private`, `vehicle=no|private`, `service=parking_aisle|driveway`,
prices node `barrier` and `ford`, adds `turncost 120` and a paved↔unpaved
`initialcost 400`, and penalises `estimated_town_class` and streets (more with
`avoidTowns`). Difficulty now means something: "easy" forbids grade5 and
`smoothness=horrible`, "hard" tolerates sand and prices fords at 100 m.
Every reported key is referenced in the script because **BRouter serialises
only the tags the profile mentions**.

Legacy vs new, same six legs (offRoad 0.8, full table in the evening entry's
format via `ONLY=legacy,adventure npx tsx scripts/experiment-profile.ts`):

| Leg | turns/10 km legacy → new | flips | grade4–5 km (easy) | streets km |
|---|---|---|---|---|
| Sigulda→Nītaure | 8.9 → 5.8 | 11 → 7 | 0 → 0 | 5.9 → 4.8 |
| Kuldīga→Renda | 6.3 → 2.4 | 17 → 7 | 2.1 → 0 | 4.0 → 3.4 |
| Tukums→Jaunpils | 5.3 → 4.5 | 26 → 22 | 1.8 → 0 | 9.3 → 9.4 |
| Alūksne→Ape | 6.9 → 4.8 | 30 → 18 | 0 → 0 | 6.4 → 4.9 |
| Rīga Berģi→Ropaži | 9.4 → 8.7 | 15 → 13 | 5.4 → 0.7 | 2.3 → 2.4 |
| Rīga centrs→Baldone | 7.1 → 5.3 | 22 → 16 | 9.2 → 5.3 | 12.5 → 7.6 |

Unpaved share within ±4 points everywhere except Rīga centrs→Baldone, where
avoiding streets *raised* it (67% → 81%) and lengthened the leg (58 → 70 km).
Kuldīga's track share fell 18% → 2% while unpaved held at 74%: the turn cost
keeps the router on the continuous gravel road instead of hopping onto every
side track, which is the intended trade.

### Intent, places, geocoding

- `RouteIntent` gains `noSand` and `avoidTowns` (heuristic regexes + LLM).
- **Claude parses the prompt** (`@anthropic-ai/sdk`, `messages.parse` with a
  Zod structured output, `claude-opus-5`, effort low, cached per prompt) and
  returns start/destination in the **nominative**, so "ap Cēsīm" → "Cēsis".
  `openai` is removed. Needs `ANTHROPIC_API_KEY`; the rider's key is
  identity-linked, so `ANTHROPIC_WORKSPACE_ID` is required too (sent as the
  `anthropic-workspace-id` header) — not yet set, heuristic still live.
- Heuristic: locative without preposition ("Sāku Siguldā", "Esmu Ogrē") is
  parsed (`\b` is ASCII-only in JS — the old pattern could never match after
  "ā"); country/region case forms excluded.
- Geocoder: Baltic `bbox`, `locale=lv`, Latvian nominative candidates
  (`latvianNominativeCandidates`), exact-name settlement ranked by size
  (town beats hamlet: "Baldoni" → Baldone, not Baldoņi). Verified: Cēsīm,
  Siguldā, Tukumu, Kuldīgu, Valmierai, Ropažos, Ogri, Rīgas all resolve.
  GraphHopper's free plan rate-limits (~30 calls/min), hence max 4 candidates
  and stop-on-town.

### One speed model (`lib/routing/speed.ts`)

Per-way moving speeds by tags (asphalt 58–75, gravel road 50, grade1 42 →
grade5 14, streets 32, sand 18 km/h) plus 8 s per junction turn. Used for the
displayed riding time (replacing BRouter's flat ~45 km/h) and for the
duration → distance planning average. Calibration (below) then replaces the
planning average with the speed the region really delivers (measured 32–44
km/h on the test prompts).

### Calibration route, hard cap, dedupe, TET

- **Calibration:** one loop at the table radius, then `factor = routed /
  radius` replaces `LOOP_PERIMETER_FACTOR` for this region, and a duration
  request is re-targeted at the measured speed. Measured factors 6.2–17.9
  against table values 11–32. Correction exponent 1.3 because the factor
  falls as the loop widens (Riga: proportional correction 105 → 105–159 km
  against 200). The calibration route competes as a candidate, so it costs
  one request.
- **Hard cap** 0.4–1.8× target before ranking: an unreachable anchor sent one
  Sigulda candidate round the Gauja valley at 492 km against 177 km and the
  linear drift term still let it through.
- **Dedupe on shared road pieces** (>80%) instead of distance + stop ids;
  `planLoop` never picks the same POI twice ("Tukuma pilskalns un Tukuma
  pilskalns loks").
- **TET slice sized for the whole ride**: entry + slice + return (straight
  line × 1.6) ≤ target, shrinking the slice share down to 0.15.

### End to end, six prompts, before → after

| Prompt | Before | After |
|---|---|---|
| "Sāku Siguldā, 4h, ~50% grants" | HTTP 400 | Sigulda; 182 / 216 km, 4h29 / 5h08, **18 / 26% repeated** (was 38–46% mid-way) |
| "3 stundas ap Cēsīm, hard" | Bosnia, 13–58 km | Cēsis; 71 / 121 km, 2h12 / 3h48 |
| "150 km ap Kuldīgu, TET" | 334–401 km | 183–240 km |
| "200 km from Riga, avoid towns" | 83–154 km, 13–22 turns/10 km | 137 km, 8.7 turns/10 km (calibration lost to a 403) |
| "2h ap Tukumu" | 20–41 km, duplicates | 74 km / 1h58, **5% repeated**; 48 km alternative |
| Alūksne 120 km | 1 option | **failed — BRouter 403** |

### The binding constraint is now brouter.de

Six to eight requests per generation trip the public instance's burst limit
even with 350 ms pacing and backoff to 10 s: two of six prompts failed
outright and two took 70–80 s. Candidates are down to four shapes +
calibration + probe. **Self-hosting BRouter is the next step** (see
CLAUDE.md → Self-hosting); everything else in the plan is in.

### Claude path verified (after `ANTHROPIC_WORKSPACE_ID` was set)

Eight prompts, all `parser: llm`, 4–7 s each (then cached per prompt): Siguldā
→ Sigulda, ap Cēsīm → Cēsis, Esmu Ogrē → Ogre, "no Rīgas līdz Cēsīm" →
point_to_point Rīga → Cēsis, "uz Siguldas pusi" correctly not a destination,
"bez dziļām smiltīm" → noSand, "bez pilsētām" → avoidTowns. Claude labels
"daudz grants" as **easy + 80% gravel** where the regex said adventure, so the
off-road dial now follows `gravelPreference` directly (0.1 + 0.9·g, ±0.1 for
hard/easy) and difficulty only governs roughness, sand and fords. End to end
"2h ap Tukumu, daudz grants, bez pilsētām": calibration 29 km → target 69 km,
options 113 km (11% repeated, 70% unpaved) and 29 km.

### Still open

- Speed table is a starting point; calibrate against ridden GPX tracks.
- Riga still undershoots 200 km when calibration fails; a second correction
  pass would fix it but costs a request — wait for self-hosting.
- UI has no controls for `noSand` / `avoidTowns`; the prompt sets them.

## 2026-09-03 (evening) — rider's-eye audit: what still separates these routes from ones a rider would plan

Question from the rider: what does it take for the generated routes to be as
good as what an adventure rider would actually plan? Answered by measurement:
six realistic prompts through the live API, with a new `debug: true` request
flag that returns the raw per-edge OSM tags, plus leg-level profile
experiments (`scripts/experiment-profile.ts`, `scripts/probe-brouter.ts`).

### What came back

| Prompt | Asked | Got |
|---|---|---|
| "Sāku Siguldā, gribu 4h izbraucienu, ap 50% grants, easy adventure" | Sigulda, 4 h | HTTP 400 "Tell us where to ride" — locative without a preposition is not parsed |
| "3 stundas ap Cēsīm, daudz raustīto, nedaudz punktoto, hard" | Cēsis, 3 h | **Ćesim, Bosnia and Herzegovina**; 13–58 km routes for a 3 h request |
| "150 km loks ap Kuldīgu, maksimāli daudz meža ceļu, bez dziļām smiltīm" | 150 km, no sand | TET switched on → **334–401 km**; 3.1 km of `surface=sand` in option A |
| "200 km from Riga, mostly gravel, avoid towns and main roads" | 200 km, rural | **83–154 km**; 37–49% residential/living_street/service; 13–22 turns per 10 km; 17–48% unpaved; stops "Abandoned VEF bomb shelter", "RIX plane spotting" |
| "2h ap Tukumu, daudz grants" | 2 h | Options A and B identical (41 km); stop list has "Durbes muiža" twice; name "Tukuma pilskalns un Tukuma pilskalns loks" |
| "Adventure ride around Aluksne, 120 km, lots of dashed lines" | 120 km | one option only, 100 km, 33% repeated |

Cross-cutting, on every route:

- **Two speed models that disagree.** BRouter's `total-time` is a flat ~45 km/h
  whatever the surface (401 km / 534 min, 41 / 55, 58 / 77), while
  `expectedAvgSpeedKmh` plans at 16–34 km/h. A 3 h request therefore targets
  48 km and is displayed as "1h 17m". Neither matches a rider, who averages
  roughly 35–40 km/h on mixed Latvian gravel including short stops.
- **Surface ping-pong.** 46–126 paved↔unpaved switches per route, 28–64 runs
  shorter than 500 m: the router takes every 200 m gravel shortcut off an
  asphalt road and back. Riders experience this as constant turning for no
  gain.

### The profile can see far more than it uses — and BRouter reports only what the profile references

`tracktype` and `smoothness` read as absent on every route. They are not:
**BRouter serialises into `WayTags` only the keys the profile references.**
Reference them and they appear. `lookups.dat` has `tracktype`, `smoothness`,
`motorcycle`, `vehicle`, `service=*`, `ford`, `barrier` (node context),
`estimated_town_class`, `estimated_traffic_class`, `estimated_forest_class`,
`4wd_only`. The current profile uses only `highway`, `surface` and a few
access keys, so a `grade5` overgrown trace costs the same as a `grade1`
forest road, sand gets the unpaved *discount*, `motorcycle=no` is not
forbidden, and gates/bollards/fords cost nothing.

Same legs, current costs (offRoad 0.8) vs. an experimental profile that adds
tracktype/smoothness/sand/barrier/motorcycle rules ("quality") and, on top,
`turncost 120` + `initialcost 400` on a paved↔unpaved switch + town penalties
("+flow+towns"):

| Leg | Profile | turns/10 km | flips | runs <500 m | grade4–5 km | rough km | streets km | unpaved |
|---|---|---|---|---|---|---|---|---|
| Sigulda→Nītaure | current | 8.9 | 11 | 2 | 0 | 0 | 5.9 | 57% |
| | quality | 5.8 | 7 | 1 | 0 | 0 | 4.8 | 61% |
| | +flow+towns | **4.0** | 7 | 1 | 0 | 0 | 4.0 | 62% |
| Kuldīga→Renda | current | 6.3 | 17 | 9 | 2.1 | 0.1 | 4.0 | 75% |
| | quality | 3.3 | 13 | 6 | 0 | 0.1 | 3.5 | 75% |
| | +flow+towns | **2.4** | **7** | **1** | 0 | 0.1 | 3.4 | 74% |
| Tukums→Jaunpils | current | 5.3 | 26 | 6 | 1.8 | 1.4 | 9.3 | 58% |
| | quality | 4.9 | 24 | 5 | 1.1 | 1.4 | 8.9 | 59% |
| | +flow+towns | **4.0** | 18 | 2 | 1.1 | 1.4 | 8.9 | 60% |
| Alūksne→Ape | current | 6.9 | 30 | 13 | 0 | 0 | 6.4 | 69% |
| | quality | 4.8 | 22 | 8 | 0 | 0 | 4.9 | 66% |
| | +flow+towns | 4.8 | **18** | 6 | 0 | 0 | 4.2 | 65% |
| Rīga (Berģi)→Ropaži | current | 9.4 | 15 | 4 | 5.4 | 0.2 | 2.3 | 83% |
| | quality | 9.7 | 15 | 4 | 4.9 | 0 | 2.4 | 82% |
| | +flow+towns | 7.7 | 13 | 2 | 5.0 | 0.1 | 1.8 | 82% |
| Rīga centrs→Baldone | current | 7.1 | 22 | 8 | 9.2 | 4.2 | 12.5 | 67% |
| | quality | 5.9 | 18 | 5 | 8.7 | 2.4 | 7.9 | 73% |
| | +flow+towns | **4.2** | 18 | 3 | 7.1 | 1.1 | 7.0 | 73% |

Turns per 10 km fall 30–60% on five of six legs, sub-500 m runs fall 50–90%,
streets and rough kilometres fall, and unpaved share stays within ±4 points —
the rider loses nothing they asked for. Two caveats: grade4–5 barely moved at
×1.6/×3, so where the network offers no grade1–2 alternative a multiplier is
not enough and "easy" needs a forbid; and `estimated_town_class` only
registers on the Riga centre leg (8.4 km at class ≥3 → 2.8 km with the
penalty), so it is a real lever there and irrelevant in the countryside.

### TET "loops" are out-and-back on a linear trail

Kuldīga, 120 km slice: entry 18.8 km, but the far end of the slice is **82 km
straight-line from the start**, so the closing leg routes to 115 km. Via legs
9–10 route 17–20 km for 6 km of trail (the trail there uses ways the profile
forbids or that are unroutable), and via 16–17 sit on islands for `car-fast`.
The slice alone therefore makes a 150 km request into 372–421 km. Sizing the
slice at 0.8× target ignores that a linear trail has to be left as well as
joined.

### Loop sizing encodes the zigzag it should be fixing

`LOOP_PERIMETER_FACTOR` (32 at 8 stops) was calibrated on routes that zigzag,
so for a 200 km Riga request the anchors go **6 km out — inside the city** —
the loop stays on residential streets, and still comes back short (83–154 km).
Fixing flow changes the factor again. A corrective second routing pass (route,
scale the radius by target ÷ actual, route again) removes the dependency on
the constant altogether; the isochrone contours are already fetched for it.

### Latvian place names

Riders write cases, not nominatives. GraphHopper without a bounding box:
Cēsīm → Bosnia, Tukumu → Papua New Guinea, Baldoni → Italy. With
`bbox=20.9,53.8,28.3,59.7&locale=lv`: Cēsīm, Siguldā, Tukumu, Kuldīgu,
Valmieru, Jelgavu, Līgatni all resolve correctly; Baldoni, Ogri and Rīgas still
do not (need nominative normalisation or an LLM). Stadia/Pelias is useless for
this (Siguldā → "Segewold", the rest empty). `OPENAI_API_KEY` is empty in
`.env.local`, so the regex parser is the live path, and "Sāku Siguldā" has no
preposition for it to key on.

### Plan, in priority order

1. **Profile** (`moto-profile.ts`): reference and cost `tracktype`,
   `smoothness`, `surface=sand|mud`, `motorcycle`, `vehicle`, `service=*`,
   node `barrier`/`ford`; `turncost` + paved↔unpaved `initialcost`;
   `avoidTowns` via `estimated_town_class` and residential/service costs;
   per-difficulty grade4–5 forbids. This also makes rough-track km and a risk
   score (spec §8A.6) reportable, since the tags then arrive.
2. **One speed model** for planning and display, surface-aware (asphalt ~65,
   gravel road ~50, grade1–2 track ~35, grade3 ~25, grade4–5 ~15 km/h, plus a
   break allowance), replacing both BRouter's 45 km/h and the 16–34 km/h planner.
3. **Corrective re-route** for loop length; re-measure perimeter factors after flow.
4. **Places**: bbox + `locale=lv` on the geocoder, locative/no-preposition
   parsing, nominative fallback, LLM intent parsing; intent gains `noSand` and
   `avoidTowns`.
5. **TET**: size the slice as target − entry − return, prefer the variant whose
   far end is nearest the start, or ride the TET out and a generic loop back.
6. **Loop planner**: hard-exclude already-chosen POIs, dedupe options on
   geometry, exclude urban/odd POI categories inside town class ≥3.

## 2026-09-03 (later still) — the overlap metric was lying

A rider exported a GPX and it plainly rode the same forest tracks out and
back, while the app reported 39% repeated. Measuring the file directly gave
**48%**. The metric was under-reporting, which means every ranking decision
built on it was made on flattering numbers.

### The metric now works on geometry

`measureOverlap` no longer looks at router attributes at all. Each consecutive
coordinate pair is one piece of road, keyed on its endpoints with direction
removed; anything past the first pass is retraced. Fed the rider's own GPX it
returns 48% / 7.6 km repeated / 8.1 km new — matching the independent
measurement exactly.

Three attribute-based attempts preceded it, all wrong in different ways, and
the reasons are recorded in the function: directional Valhalla edge ids read
~0% for an out-and-back; raw OSM way ids read ~80% for a good loop; tag
signature plus length (needed because BRouter reports no way ids)
under-reports, which is what produced the 39%.

### What the honest numbers showed

Tukums cannot produce a clean short loop. Sweeping radius with three stops:

| anchor radius | routed | repeated |
|---|---|---|
| 2-10 km | 43-130 km | **41-52%** |
| 15 km | 158 km | **14%** |

Two hypotheses were tested and both refuted: more stops don't help (44% at
both 3 and 5 stops), and the gravel discount isn't the cause (41-44% across
the whole `offRoad` scale). Below ~150 km the connected unpaved network around
Tukums has no way back that differs from the way out.

So the app now says so, via `overlapWarning`, rather than presenting a
heavily retraced route without comment.

### Also fixed

- **Candidates died silently on "target island detected"** — a POI anchor
  landing on a disconnected fragment killed the whole candidate (3 of 5 in the
  reported case). Unreachable intermediate points are now dropped and the
  route retried; start and end never are.
- **Short rides were forced long.** `MIN_ANCHOR_RADIUS_M` was 3 km from the
  Valhalla era; with BRouter's perimeter factor of ~11 that *mandated* a 34 km
  loop against a 10 km target. Now 1.2 km, and a 30-minute request returns
  15.8 km / 21 min.
- **"Unknown" surface was a third of forest routes.** An untagged
  `highway=track` is a farm or forest track, so it reports as gravel now;
  Kuldiga went from 37% unknown to 0-6%. `unclassified` is deliberately left
  unknown — rural means gravel, urban means asphalt, and guessing would be
  worse than admitting it.
- **The map made loops look broken.** Unknown-surface segments were `#98989d`,
  near-invisible on the light basemap, so a third of the route read as gaps in
  the line. Darkened.
- **Distance tolerance is a setting** (±10/20/40%). It does two things:
  distance only enters the ranking once a route exceeds it, and some
  candidates deliberately run wide when drift is allowed — which is the trade
  that buys lower overlap.


## 2026-09-03 (later) — Valhalla → BRouter, and the prompt becomes the only input

Two rider reports drove this: routes for "maximum forest, dotted lines" came
back 1-27% unpaved on asphalt roads, and a stale Start field silently
overrode the place named in the prompt.

### Routing engine: BRouter

Hosted Valhalla exposes off-road appetite through one `use_trails` dial, and
measurement showed it barely moves: across five Baltic point pairs
`use_trails` 0 and 1.0 produced near-identical routes. `top_speed` turned out
to be the real lever there — Valhalla routes by time, so asphalt wins until
the vehicle's speed is capped.

Even so, the ceiling was low. BRouter replaces it because **its profile is a
cost script we generate** (`lib/routing/moto-profile.ts`), so every road class
and surface has a cost we set. On 25-30 km legs with a custom profile:

| Start | Valhalla unpaved | BRouter unpaved | BRouter track |
|---|---|---|---|
| Kekava | 20% | **92%** | 45% |
| Kuldiga | 3% | **88%** | 10% |
| Sigulda | 50% | **63%** | 16% |
| Aluksne | 1% | **57%** | 29% |

End to end on the rider's own prompt: unpaved 22-28% → **54-74%**, tracks 5%
→ **15-25%**, retracing 43-49% → **12-35%**.

Also better: BRouter returns the raw OSM tags per segment rather than a
normalised enum, it is ~0.2s per route against Valhalla's ~0.6s, and it has
no credits or commercial-use restriction. Valhalla is kept for isochrones,
which BRouter doesn't offer.

### Places come from the prompt

Start and destination fields are gone. `parseStartPlace` /
`parseDestinationPlace` read them from the description, so "around Baldone"
starts at Baldone. "in Latvia" is correctly not a start, and "uz Siguldas
pusi" is correctly not a destination. Naming a no place gives a clear message
rather than a silent default.

### Describe/Customize restructured

Describe is no longer one of two tabs — it's the input. Settings sit below it
as a collapsible section with a summary line, and the prompt overrides only
the fields it actually mentions (`parsePromptFields` returns undefined for
everything unstated, rather than schema defaults).

### Key technical findings

- **BRouter rejects unknown tag values with a bare 500.** `motor_vehicle=forestry`
  isn't in its lookups.dat and killed the whole profile with no message. Also
  `multiply varA varB` is invalid — the second operand must be an inline
  switch chain.
- **The public instance throttles bursts**, answering 403 "Please, retry
  later!" after ~6 quick requests. Candidates are down from 8 to 5, run 2 at a
  time, with backoff retry. `BROUTER_BASE_URL` points at a self-hosted
  instance to lift this.
- **BRouter routes far more winding than Valhalla** because it seeks gravel,
  so `LOOP_PERIMETER_FACTOR` needed re-measuring: ~30 at 5 stops where
  Valhalla gave ~15. The old numbers produced 175 km loops against a 2 h target.
- **The earlier "the track network is the ceiling" conclusion was wrong.** It
  came from a single short test leg; on real ride distances a custom profile
  reaches 45% track where the same leg suggested 25% was the limit.
- **Forest tracks are not blocked by access tags.** Near Sigulda only 3 of 91
  tracks are tagged `motor_vehicle=no|private`; 81 carry no access tags at
  all. The 419 `highway=path` ways nearby *are* correctly excluded — they have
  no motor access, and the profile forbids them absolutely.
- Minutes ("30min"), "half an hour", woods/mež/mez, "maksimāli daudz",
  "minimum street" and English "dotted/dashed lines" were all unparsed. A
  duration below the schema's 0.5 h minimum also threw, discarding every
  other understood field.

### Next up

- Distance still overshoots in some regions (Kuldiga +49%); the corrective
  re-route from cached contours isn't wired up.
- Two pre-existing lint errors in `route-map.tsx` / `route-prompt.tsx`.
- Self-hosting BRouter would remove the throttle and allow more candidates.


## 2026-09-03 — GraphHopper → Valhalla, and loops that don't retrace

Started from a rider observation: routes ignored small roads and tracks, and
the guess that the routing profile was to blame was right.

### The diagnosis

- `profile: "car"` was the root cause, and no amount of custom-model tuning
  could fix it: GraphHopper's car graph **excludes `highway=track`/`path`
  entirely**, and a custom model can only reprioritise edges already in the
  graph. On the free plan the custom model was never applied at all.
- `profile: "bike"` did surface trails (19%) but routes onto cycleways
  motorcycles may not legally use — wrong in the other direction.
- GraphHopper's hosted API has no motorcycle profile. Valhalla does, with a
  `use_trails` knob. Measured on a rural Latvian route: `use_trails: 0` gives
  93% asphalt, `use_trails: 1` gives 80% unpaved. This is the capability the
  product was missing.

### Then the goal changed

The rider clarified what actually matters: **not riding the same road twice**.
Shape is a consequence, not a goal — an oval or a lopsided sprawl is fine, and
distance accuracy matters less than covering new ground. So the app now
measures and optimises retraced roads.

### Shipped

- **Valhalla via Stadia Maps** (`lib/routing/valhalla.ts`), behind a
  configurable base URL so self-hosting is a config change. `RoutePath` is
  provider-neutral, so `classify.ts` no longer depends on a vendor.
- **`RouteIntent` → motorcycle costing** (`lib/routing/profiles.ts`).
- **Isochrone + POI loop planning** (`lib/geo/isochrone.ts`, `lib/geo/poi.ts`,
  `lib/routing/loop.ts`): one isochrone request gives the genuinely reachable
  boundary, anchors are sampled by arc length and snapped to real OSM places,
  and stops are visited in bearing order — which makes the tour
  non-self-intersecting by construction.
- **Repeated-roads metric** on every route, shown in the summary and the
  variant picker. Eight shapes are routed per request; the three that retrace
  least are shown, with duplicates filtered.
- **POI dataset**: `scripts/build_poi_dataset.py` → `public/poi-baltics.geojson`,
  16,410 places across LV/LT/EE (hillforts, towers, ferries, fords, mills,
  waterfalls, manors), spatially thinned.
- **Routes named after where they go** (`lib/routing/name-route.ts`):
  "Caur Turaidu un Krimuldu", with Latvian accusative precomputed in the
  dataset and a case-free fallback where the stem is ambiguous.
- TET slices now use ~18 via points instead of 3 (Valhalla allows 50).

### Results (retraced roads, best of three)

| Start | Before | After |
|---|---|---|
| Sigulda | 7% | **4%** |
| Riga | 22% | **12%** |
| Aluksne | 32% | **15%** |
| Kuldiga | 34% | **24%** |

Sparse road networks stay hardest — near Kuldiga there simply are fewer ways
round.

### Key technical findings

- **The overlap metric is not obvious.** Counting repeated `edge.id` reports
  ~0% even for a pure out-and-back (Valhalla edge ids are directional);
  counting any repeated `way_id` reports ~80% for a good loop (one OSM way is
  split across many edges). What works is distinct road length: each
  `(way_id, edge length)` pair counted once. Validated against a deliberate
  out-and-back (50.7%) and a clean loop (12.6%).
- **Stop count is the strongest lever on retracing**, not anchor placement. At
  a 120 km target, 3 stops retraced 38%/46% near Aluksne/Kuldiga; 5–7 stops
  gave 11%/24%. POI anchors were already landing within a few degrees of
  target — sparse networks need *more* stops, not better ones.
- `trace_attributes` is required for per-edge surface (the route response has
  none) and **rejects paths over 200 km**, so long routes are traced in
  chunks. Its response carries its *own* shape and indexes into that, so the
  caller must adopt it. Route delivery never depends on this call succeeding.
- Two calibration constants were wrong because they mixed a theoretical
  circle with measured roads: loop perimeter is ~10.8–18.7 × anchor radius
  (growing with stop count), not the textbook 2π ≈ 6.3.
- `trailPreference: "none"` was capping `use_trails` below what the gravel
  slider asked for, so "lots of gravel, no single-track" returned asphalt.
  `use_trails` governs surface *and* trails, so the two must be merged.
- Overpass rate-limits a full build into connection refusals, so the script
  rotates mirrors and caches each query — a rebuild after a scoring change
  needs no network at all.
- Node `fetch` to Overpass is refused in this environment (`ECONNREFUSED`)
  while Python works, hence a Python build script.

### Next up

- Distance is still approximate (±25%); the planned single corrective
  re-route from the cached inner/outer contours isn't wired up yet.
- Direction hints ("uz Siguldas pusi" vs "caur Siguldu") are designed —
  including Latvian case handling — but not implemented.
- Geocoding still uses `GRAPHHOPPER_API_KEY`; moving it to Stadia Pelias
  would retire that dependency.
- Two pre-existing lint errors in `route-map.tsx` / `route-prompt.tsx`, plus
  odd textarea behaviour where typing appends to placeholder text.

## 2026-09-02 — MVP built end-to-end

Built from `baltic-adventure-route-generator-mvp.md` (in the parent Mops folder)
in one session. The full flow works: **prompt → intent → GraphHopper → map → GPX**.

### Shipped

- **Next.js app** (App Router, TypeScript, Tailwind, shadcn/ui, MapLibre GL).
- **Two input modes**: *Describe* (free text, LV/EN — LLM parses it into a
  structured `RouteIntent`; a heuristic parser is the fallback and the current
  default since no `OPENAI_API_KEY` is set) and *Customize* (structured form:
  distance/duration, difficulty, Tracks Low/Medium/High, Trails None/Some/Lots,
  avoid highways, TET). Both feed the same `RouteIntent` — the LLM never
  produces coordinates. After a Describe run the form mirrors what the AI
  understood.
- **Structured start + optional destination** fields (round trip vs
  point-to-point). Geocoding is Baltic-biased (GraphHopper geocoder returns
  "Cesis" → Ukraine without it).
- **3 route alternatives** per request: different round-trip seeds; for
  point-to-point a direct route plus two perpendicular-detour variants; for TET
  three different slices (forward/backward/centered).
- **TET Latvia integration**: official GPX downsampled into
  `public/tet-lv.geojson` (map overlay + server routing share it). "Ride a TET
  section" builds the ride around the nearest TET section via 3 via-points.
  Overlay toggle lives on the map.
- **Adventure road model**: segments classified from GraphHopper path details
  into Road/Track/Trail plus surface. On the map, **color = surface** (paved
  blue, gravel orange, dirt brown, unknown gray), **line style = class** (solid
  road, dashed track, dotted red trail), purple TET overlay; two-row legend.
- **Route summary**: distance, riding time, Road/Track/Trail mix bars, surface
  percentages, honest unknown-data warnings, Regenerate.
- **GPX 1.1 export** (`creator="Mopik"`).
- **Apple-style design**: SF/system type, #fbfbfd ground, black pill buttons,
  one orange accent #f56300, motorcycle logo. Matching 3-artboard design canvas
  (Compose / Routes / Mobile) published as a Claude artifact named "Mopik".

### Key technical findings

- **Free GraphHopper plan limits** (the big one): no custom models (so
  gravel/difficulty/trail preferences can't steer routing — the standard car
  profile almost never picks `highway=track`; the app degrades gracefully and
  says so in the UI), **max 5 route points** (TET routing therefore uses 3 via
  points), no alternative_route. The custom-model profiles are written in
  `lib/routing/profiles.ts` and activate automatically with a paid key.
- Free tier **does** return `road_class` / `surface` / `track_type` path
  details, so the Road/Track/Trail + surface breakdown is real data (answers
  the MVP doc's §8A.11 research question: yes, hosted API suffices).
- Routes at 30–40% gravel looked "all roads" because gravel public roads are
  class *road* — fixed by encoding surface as color on the map.
- MapLibre module workers 404 under the Next dev server; workers are copied to
  `public/` by `postinstall` and wired via `maplibregl.setWorkerUrl`.
- Round-trip seeds can land in water ("Could not find a valid point") — the
  client retries with fresh seeds.

### Next up (discussed, not built)

- Result adjustment chips (*More gravel · Shorter · Longer · Easier*) and an
  "update routes" form pre-filled with the current intent.
- Map-level editing (avoid-this-area, draggable via point) — deliberately
  deferred per MVP doc §12; also constrained by the 5-point free-plan limit.
- Choosing a specific TET section (LV-01…LV-06) and direction.
- `OPENAI_API_KEY` for real LLM parsing; paid GraphHopper key for off-road
  steering.
- Founder test from MVP doc §27: generate 20 routes, ride 5–10, tune profiles.
