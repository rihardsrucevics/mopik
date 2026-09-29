# scripts/verify — the fast browser checks

Two suites, both Playwright, both at **375×812 and 1280×800**:

| | what | when | time |
|---|---|---|---|
| `smoke.sh` (`npm run verify:smoke`) | the core edit flow, 91 checks per viewport | every change to the edit flow, before every release | 92–130 s replayed on `next start`, both viewports in parallel |
| `full.sh` | the older scenario scripts (e2e, insert, linesheet, gap, guidance, guard, straight, placesearch, gate, laurini, ropazi, mergupe, batchbad ×2, ogre ×2, chain) | **big releases only** | 12 min recording (the release B run of the same set took ~33 min) |

Where the time went before: every script generated its ride from scratch against the one-vCPU production router (~50 s per ride, slower when several agents share it), searched places through Photon, and ran on `next dev`. The kit removes all three.

## What the smoke suite covers

On fixture rides with the router cache (`smoke.cjs`):

- **Add a stop** (Sigulda → Līgatne → Cēsis): proposal → chip with numbers → halo over the dimmed ride → ✕ leaves line and ↶ as they were → again → ✓ commits with no extra routing → ↶ undoes.
- **Move a stop** (Līgatne) and **move a pass-through point** (the rider's `ride-0928` with his four points), the same way.
- **Remove a stop** and **remove a pass-through point** (the rider's `kapselu-upmali` GPX, „Pietura 1 · Viduči” by the Rīga–Ērgļi road): „Izņemt” → proposal → chip → halo → ✕ → again → ✓ → ↶. And with rung 0 forced to 422 (the production failure's shape: his own profile cannot join the cuts) the removal climbs the relaxed ladder to a proposal — never refused.
- **Line sheet** opens on a tap on the line; **„Pievienot punktu šeit”** adds a dot with the line unchanged and nothing routed; ↶ takes it away.
- **„Vest pa taisno”**: no road there → refused with the offer → proposal → ✓ keeps a drawn stretch → ↶.
- **„Tomēr braukt” guard**: strict profile forced to 422 → warned, ✓ off, the offer said once; a forced ✓ click and Enter keep nothing; „Tomēr braukt” commits; ↶.
- **Chained edits** (Grostonas → Sidgunda → Mālpils → Augšmala → Ērgļi): two moves → „2 izmaiņas”; ↶ inside the chain takes only the last off; a third move stacks; ✓ commits once with no extra routing; one ↶ brings back the ride before all of them.
- **Blocking point** (Grostonas → Ērgļi, three taps, one in Kangaru purvs): named in the chip, ringed on the map, the field says „Pietura 3”; „Pievienot pārējās” drops it and proposes the other two; commit; ↶.
- **Through road** (Lauriņi → Ērgļi, the rider's GPX ride): a pass-through point moved onto the junction by Ogresgals is a plain proposal — no „strupceļš”, no „atpakaļ pa to pašu ceļu”, and the retraced share does not grow.
- **A sight from the map card** (backlog 46; `/api/route-pois` and its `/api/detour` stubbed with a manor ~100 m off sigulda-cesis): „Pievienot braucienam” → a proposal with numbers and halo → the „tuvāk ar motociklu netikt” note with its distance → ✓ with no extra routing → ↶; on the result „Atzīmēt” → „1 atzīmēta · Pievienot” on the map → Escape → the card's add and its note on the map.
- **„Vest pa taisno caur visiem”** (Grostonas → Ērgļi, three taps in a row in Kangaru purvs): the one chain chip with „3 punkti bez ceļa, taisni ~N km” → a proposal with numbers, halo, its note and the honesty line → ✓ keeps a drawn chain through all three with no extra routing → „Izņemt” on the middle point → a proposal with nothing routed → ✓ keeps the chain through the other two → ↶ brings the three back → ↶. The chip's lead („Taisni caur 3 punktiem – N km bez ceļa – ✓ apstiprina, ✕ atmet.”), the way by the pins' numbers, the honesty line in the title, no coordinates, and the notes ≤ 3 lines and never cut (also for the guard's and the sight's notes). Screenshots `chain-straight-{offer,committed}.png`, `chainpolish-{proposal,remove-proposal,remove-committed,guard,sight}.png` at 375 (`CHAIN_SHOTS` sets their directory).
- **The connection drops during generation** (the rider's „TypeError: Load failed”, 2026-09-29; `/api/generate-route` aborted with `route.abort("failed")`): one drop → the quiet retry brings the ride with no error shown; two drops → „Savienojums pārtrūka, kamēr meklēju maršrutu – mēģini vēlreiz.”, no raw error, no loader, „Mēģināt vēlreiz”, which drops the bubble and brings the ride; Atcelt during the retry's wait → the form, nothing sent again. Screenshots `genfail-{message,retry-ok,cancelled}.png` at 375 (`GENFAIL_SHOTS` sets their directory). Backgrounding (`visibilitychange`) is not driven here — Chromium headless stays visible; `scripts/request-failure.test.ts` pins the rule.
- **„Saglabātie”** (backlog 44/47; rows seeded with `encode-saved.ts`, router labels as place names): a tap on the card's numbers opens the ride, the delete icon keeps its own tap; „Labot” is edit mode on the saved line with nothing generated; an edit and „Pabeigt labošanu” saves his own ride in place (same date, new id) and says so; a ride with no origin gets the „nav tavs” note and is saved as „… (kopija)”, the original row byte for byte. Screenshots `saved-*.png` at 375 (`SAVED_SHOTS` sets their directory).
- **Reach-all** (backlog 50/52, Grostonas → Ērgļi): a new finish in Madona → proposal, ✓ ends there, ↶; a finish in Kangaru purvs → „Vest pa taisno” chip → proposal → ✓ ends at it → ↶; an alternating batch (on the ride, forest, on the ride, forest) → per-blocker chips with „Vest pa taisno”, „Vest pa taisno visiem”, „Pievienot pārējās”, no coordinates. Screenshots `reach-*.png` at 375 (`REACH_SHOTS`).
- Throughout: the four **`[data-slot]` rects do not move** (idle, proposal, refused, warned, committed), and **no console errors** (the 422 network lines the refused/guard cases ask for are the only ones ignored).

## What it does NOT catch — read this

- **Server routing changes are not tested by replay.** A replayed `/api/reroute-leg` answer is what the server said when it was recorded. The cache is stored under a fingerprint of the routing code (`FINGERPRINT_PATHS` in `cache.cjs`: `app/api/{reroute-leg,routable-point,detour,route-pois,places}`, `lib/routing`, `lib/geo`, `lib/poi`, `lib/chat/ride-plan.ts`, `lib/chat/ride-limits.ts`). Change any of it and the run prints **STALE** and sends every call to the real router — slower, but it never replays an answer the new code would not give. Re-record then (below).
- **A code change outside those paths that changes what the server answers** (a new import from elsewhere) is not seen by the fingerprint. If you touch server code the edit flow calls, re-record anyway, or add the path to `FINGERPRINT_PATHS`.
- **Generation is not tested at all.** The fixtures are recorded `/api/generate-route` answers. The form → generate path is `full.sh`'s job (gate, placesearch) and the unit tests'.
- **The router itself** (BRouter version, tiles, profile upload) — only live runs see it.
- **Photon place search** is stubbed in the smoke suite (`places.json`); `full.sh` runs `placesearch` with `PLACES=live`.
- **Base map pixels**: the smoke suite paints OSM tiles as flat grey (`TILES=blank`). Our own layers (route, halo, pins, dots) draw exactly as in production. Screenshots from the smoke run are for our layers, not the base map; `full.sh` uses real tiles (`TILES=cache`).
- The phone runs at **DPR 1** in the smoke suite (DPR 2 in `full.sh`). Layout, hit-testing and every rect are in CSS pixels, so nothing the suite checks changes; hairline rendering at DPR 2+ is not seen.
- Nothing about Safari/iOS: this is Chromium with phone emulation.

## Running

```sh
PORT=3290 scripts/verify/smoke.sh     # or: npm run verify:smoke
```

- If a server answers on `$PORT`, it is used. If not, `smoke.sh` runs `NEXT_PUBLIC_E2E=1 next build` and `next start -p $PORT`, and stops it by its PID at the end. `SERVER=dev` starts `next dev` instead.
- **Production server vs dev**: measured on the same machine (load 15–25 on 8 cores), replay took **118–130 s on `next start`** and **242 s on `next dev`** — the dev bundle is most of the browser's CPU. `next build` writes `.next/`: do not run it in a worktree whose own `next dev` is running. `NEXT_PUBLIC_E2E=1` only exposes `window.__map` (the probes need it); Vercel never sets it.
- Logs: `scripts/verify/out/smoke-375.log`, `smoke-1280.log`; screenshots in `scripts/verify/out/shots/`. The last lines give the pass count, the time and `cache replay: N hit, M miss`. Any miss is listed in `out/misses-<vp>.json`.

Env knobs (all optional): `SECTIONS=1,reach` (section 1 always, plus only the listed groups `1b-3`, `4-10`, `reach`; `node scripts/verify/smoke.cjs desk` runs one viewport), `PORT` / `BASE`, `RECORD=1`, `CACHE=off|stale-ok`, `TILES=blank|cache|live`, `GL=swiftshader|gpu`, `DPR`, `PLACES=live`, `FIXTURES=off` (old form path in the full scripts), `GEN_TIMEOUT` (ms).

## Record and replay

- **Replay is the default.** `/api/reroute-leg`, `/api/routable-point`, `/api/detour`, `/api/route-pois` and reverse `/api/places?lat=…` are answered from `cache/api/<fingerprint>/<hash>.json` by a Playwright `route` layer (`cache.cjs`). The key is sha256 of method, path, query and body, with every number rounded to 5 decimals (~1 m) — taps come back through `map.unproject` with float jitter in the 12th digit, and the unrounded key missed every run.
- **A miss** falls through to the server, which calls whatever `BROUTER_BASE_URL` it was started with. It is counted and not saved.
- **`RECORD=1`** saves every miss. It writes into the current fingerprint's directory and deletes the directories of other fingerprints.
- **`CACHE=stale-ok`** replays the newest recording even though the fingerprint changed — for UI-only work while routing code is in flux. It says so in the summary. Never use it to sign off a routing change.
- **`CACHE=off`**: no layer.

**When to re-record** — commit the new `cache/api/` with the change:

1. The run says **STALE** (routing code changed): `RECORD=1 scripts/verify/smoke.sh`, then run once more without it and check `0 miss`.
2. You changed what the page sends (request bodies): misses appear, and `RECORD=1` fills them in. For a clean set, `rm -rf scripts/verify/cache/api` first.
3. The server answers differently for reasons the fingerprint cannot see (router upgrade, new tiles, a path outside `FINGERPRINT_PATHS`): `rm -rf scripts/verify/cache/api && RECORD=1 scripts/verify/smoke.sh`.

`full.sh` takes `RECORD=1` the same way. Its known stale expectations (insert, guidance, gate) are listed at the top of `full.sh`; many of its scripts print observations rather than PASS/FAIL, so read the logs in `out/full/`.

Cold cache timing (RECORD=1 against the production router brouter.mopik.eu, `next dev`, both viewports): **176 s**.

## Fixtures

`fixtures/<name>.json` is one ride: the places, the `?p=` plan code (from the app's own `encodePlanShare`, via `encode-plan.ts`), the recorded `/api/generate-route` request and response. `openRide(page, name)` in `lib.cjs` opens `/?lang=lv&p=<code>&go=1` with `/api/generate-route` answered from the fixture and presses „Labot” — about 3 s warm, 10 s for the first ride in a new browser.

`/r/<code>` is not used: the shared-route page has no edit mode; „Labot” exists only on the planner's result.

| fixture | ride | source |
|---|---|---|
| `sigulda-cesis` | Sigulda → Līgatne → Cēsis | generated 2026-09-29 |
| `antinciems-rigas` | Antiņciems → Puķes → Rīgas apvedceļš | generated 2026-09-29 |
| `ride-0928` | the same with the rider's four pass-through points (his `ride-0928.gpx`) | generated 2026-09-29 |
| `laurini-ergli` | Lauriņi → Ērgļi; its direct ride is the rider's `ride-laurini-ergli.gpx`, 2093 points | captured generation (release B) |
| `grostonas-ergli` | Grostonas iela 19 → Ērgļi | captured generation: **the router refused it live on 2026-09-29** („Neizdevās atrast maršrutu…”, tried 8) |
| `kapselu-upmali` | Kapseļu iela → Viduči → Upmaļi, 101 km, hand-edited, five pass-through points | the rider's `scripts/fixtures/ride-kapselu-upmali-2026-09-29.gpx`, track point for point (`fixture-from-gpx.cjs`) |
| `grostonas-chain` | Grostonas iela 19 → Sidgunda → Mālpils → Augšmala → Ērgļi | captured generation (release B) |

**Adding a fixture:**

1. Add an entry to `fixtures.spec.json`: `places` (names), optional `shapePoints` (`{lat, lon, afterPlace}`, where `afterPlace` is the index in `[start, ...stops]`).
2. Add each place to `places.json` under the first three lowercase letters of its name (take the coordinates from `/api/places?q=…` once).
3. `node scripts/verify/record-fixtures.cjs <name>` — one real generation (20–80 s), at most two at a time. With `--response=<file>` it takes a captured `/api/generate-route` answer instead of the router.
   A hand-edited ride the router would not generate again: `node scripts/verify/fixture-from-gpx.cjs <name> <file.gpx>` takes the places and pass-through points from the rider's exported GPX (`<wpt>`/`<rte>`) and the ride from its `<trk>`, point for point (~1 km `road|gravel` segments: the GPX has no classes); the plan's options come from `--template=` (default `ride-0928`) plus the spec's `plan`. Do not `record-fixtures.cjs` such a fixture — that regenerates it.
4. Commit the fixture. Re-record fixtures when the generate response shape changes, or when a fixture's ride no longer looks like what the app would produce. The edit flow tests the ride it is given, so an old ride stays a valid test ride.

The ported `full/` scripts need no change for fixtures: `plan(page, places)` finds a plain fixture with the same places (first three letters each), and the next `generate(page)` loads it. `FIXTURES=off` goes back to the form and a real generation.

## Using the local router

`../brouter-server/start.sh` (outside the repo; Baltic tiles only; port 17777). **Start it from a terminal**, not the app's preview runner — macOS then denies it Documents access and every route 500s. Then start *your* app server with it:

```sh
BROUTER_BASE_URL=http://localhost:17777 npx next dev -p 3290
```

- **Faster:** the local router, for cache misses and recording. No network, no other agents on the same vCPU. It runs on your machine's cores, which the browsers also want.
- **More faithful:** the production router (`.env.local`: `https://brouter.mopik.eu` + token) — what riders get: same BRouter build, the same Europe tiles. **Record the committed cache against production**; a recording from the local router is fine for your own runs but say so in the commit.
- Neither is used on a replayed hit.

## Ports and processes — each agent its own

- Each agent runs **its own server on its own port** (3270, 3280, 3290… — pick one nobody uses: `lsof -iTCP:<port> -sTCP:LISTEN`) and passes it as `PORT=`. Never point a suite at another agent's server; its code is not yours.
- **Kill only your own server, by PID:** `kill $(cat scripts/verify/out/dev-$PORT.pid)` or the PID you started. **Never `pkill node` / `pkill next` / `killall`** — that kills the other agents' servers and test runs mid-release.
- The router is one vCPU shared by everyone. Record at most two rides at a time (`record-fixtures.cjs` does this), and prefer replay.
- The machine has 8 GB. One server and two Chromium instances per agent at a time.

## Render cost

- **Tiles:** `TILES=blank` (smoke default) answers `tile.openstreetmap.org` with a 1×1 grey PNG. It cannot hide a regression of ours: the base map is a third-party raster under our layers, and the edit flow does not read it. It also keeps the test runs off OSM's tile servers. `TILES=cache` (full default) stores real tiles in `cache/tiles/` (git-ignored).
- **DPR 1** on the phone in the smoke suite: a quarter of the pixels, the same CSS layout.
- **WebGL:** SwiftShader (`--use-angle=swiftshader`), the same on every machine. `GL=gpu` (ANGLE on Metal) was not clearly faster in noisy measurements. The swap that helped was **`next start` instead of `next dev`** (above).


## The cache is not committed
`scripts/verify/cache/` is git-ignored: recordings are keyed to a fingerprint
of the server routing code and go stale after any routing change. On a fresh
checkout the first smoke run records them against the router
(`RECORD=1 scripts/verify/smoke.sh`, about 3 minutes cold); later runs replay.
