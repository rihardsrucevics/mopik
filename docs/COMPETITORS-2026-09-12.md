# Mopik — competitive survey and next-feature recommendation (2026-09-12)

Research by an Opus subagent (web sources; Reddit was unreachable, so forum
complaints are second-hand via aggregators). Decision notes at the end.

## 1. Comparison

| Product | Who for | How routes are made | Off-road awareness | Praised / complained | Price |
|---|---|---|---|---|---|
| Kurviger | Euro tourers, curvy-road | Free web planner + app; 4 curviness modes, waypoints, partial round-trip | Surface in routing, but "routing onto gravel despite avoidance settings" is a recurring forum issue | Best planner, fair price; "unintuitive app UI", hard mid-ride editing | €29.99/yr |
| Calimoto | Mainstream curvy tourers | Free round-trip generator from current location (its killer feature) | Weak; twisty algorithm can dump you on dirt | Mature UI, offline; "plan free, pay to navigate"; reroute silently rewrites the day | ~$39.99/yr |
| DMD2 | ADV/enduro, closest peer | Navigates GPX; on-device routing (Road Fast/Fun/Off-Road); HUB planner. Does not generate from intent | Strongest: offline topo, surface + tracktype colouring, roadbook, LoRa group ride | "Made by riders for riders"; Android-only, utilitarian | Free app, ~$20/yr maps |
| Rever | US street + some ADV | Manual + Butler curated roads, community rides | Light | Butler roads; buggy updates, laggy voice nav, paywall pop-ups | $39.99/yr |
| Scenic | iOS tourers | Manual, scenic logic, CarPlay | Light | Slick UI | ~$90 one-time or sub |
| komoot | Cyclists/gravel | Sport-aware routing over OSM, surface-typed | Good surface model; admits volunteer tagging is inconsistent | "2 hours of hiking with their bike"; "always review the track" | €59.99/yr |
| OsmAnd | Offline power users | Manual / GPX follow | Full OSM offline | Best offline; GPX "Follow track" gives no turn instructions unless "Attach to roads" | free → ~$15/yr |
| Locus Map | Android outdoor | Manual/GPX | Good | Deep but complex | freemium |
| MyRoute-app | Serious tour planners | Precise manual, multi-day | Moderate | Powerful, fiddly | ~£30/yr |
| Detecht | Social riders (Nordics) | Auto curvy routes + scenic round-trip generator, 250k community tracks | Minimal | 4.7★ iOS; crash detection, social | $5–8/mo |
| onX Offroad | US offroad/overland | Curated trail DB + snap-to-trail builder | Best legal-access UX: land ownership colours, MVUM | Plug-and-play trails | ~$35–100/yr |
| Gaia GPS | Overlanders | Manual over 250+ layers | Deep layers, weaker UX | Remote planning | $89.99/yr |
| TET | ADV riders in Europe | Curated fixed backbone, free GPX, Linesman reports | Human-verified dirt line; 835 km in Latvia | Free, trusted; app pulled from Play Store 2024 | free |
| Ride with GPS | Gravel cyclists | Manual + surface types + 2-year global heatmap | Best surface/popularity display | Heatmap used to judge passability | freemium |
| AI planners (rydrway, planner.bike, rides4you, ThrottleMap, Vroom, EpicRoutes) | Touring, asphalt | Prompt → itinerary → GPX | None handle off-road/gravel | Novelty, unproven | €0–9.90/mo |

## 2. What riders ask for that nobody does well

- **Surface truth — "is this track ridable now?"** OSM-based planners show a tag,
  not a condition; komoot concedes inconsistent volunteer labels. Nobody,
  DMD2 included, verifies.
- **No motorcycle heatmap.** Strava heat is the workaround, cyclists only,
  thin in rural Latvia.
- **Generation from intent is rare and asphalt-only** (Calimoto, Detecht
  round-trips; AI planners ignore surface).
- **Legal access is solved regionally (onX, US), not in Europe.** Latvia's
  Forest Law rule exists (motorcycles only on forest roads / natural driving
  paths) but no planner encodes it.
- **GPX → navigation is a cliff** (OsmAnd follow-track without turns).
- Also: fuel range on dirt days, sharing with friends, multi-day, honest ETA
  (nobody does it; all route by optimistic speed).

## 3. Mopik against that

**Ahead:** generation from intent in the rider's language; retrace as the
optimisation target (unique); honest-time verdict (unique); % unpaved +
sand/unverified warnings; three versions; focus-area shape; free.

**Behind:** no offline, no turn-by-turn, no saving/history, no community
data, web-only, Latvia only, no accounts. Offline and turn-by-turn are not
Mopik's job — the rider exports to DMD2/OsmAnd. The gap that bites is between
the generated GPX and the real forest: `allow_unverified` paths of unknown
access and the blanket sand rejection (a bluntness tax paid for lacking a
condition signal).

## 4. Recommendation

**Build: post-ride verdict → verified-segment layer ("Kā bija?").** After a
GPX download, one question on return: was it ridable? Verdict per route or
stretch — OK / smilšains / aizsprostots (vārti) / nebrauc — from a link, no
account, one tap. Feed verdicts back as a cost multiplier in the BRouter
profile and as a badge on the result ("3 braucēji te bija, 1 saka smiltis").

Why: nobody does it for motorcycles; it compounds; it fits Mopik's strength;
it retires two documented internal problems (sand rejection, unverified
paths). TET's Linesman model proves riders report for free; Latvia is small
enough for a few dozen riders to cover the useful network; nobody else will
build a Latvian moto condition layer.

What it takes: signed route token at `gpx_downloaded`; mobile feedback page
keyed to the token with tappable segments; verdict store keyed like the
overlap keying in `classify.ts`; lookup in `moto-profile.ts` cost generation
and the warnings panel; a nudge back via the beer popup / "Kā bija?" link.

Measure with existing events: `ride_verdict_submitted ÷ gpx_downloaded`
(≥15 % month one); `gpx_downloaded ÷ route_generated` in covered vs uncovered
areas; `route_infeasible` and `overlap_chat_shown` should fall in covered
areas as sand rejection relaxes; returning anonymous riders after a verdict.

### Ranked top 5

1. Post-ride verdict → verified-segment layer (M)
2. Shareable route link, one URL reopens a route (S) — distribution channel the loop depends on
3. Surface-coloured base map (S/M) — DMD2's most praised visual
4. Legal-access overlay for Latvian forests + known gates (M)
5. Self-hosted BRouter on a VPS (S, planned) — the precondition

Could not verify: Reddit threads directly; no active Latvian moto forum on
planning found; DMD2 tiers and Detecht off-road depth from marketing pages.

Sources: kurvo.app/blog/calimoto-vs-kurviger · dmdnavigation.com/dmd2-app ·
justuseapp.com Rever reviews · komoot adventure-hub "routing mysteries" ·
singletrackworld.com komoot thread · support.ridewithgps.com Surface Types,
Global Heatmaps · support.strava.com Global Heatmap · osmand.net GPX
navigation docs · utoverland.com onX vs Gaia · transeurotrail.org/latvia,
/the-tet-app · riga.lv Rīgas Meži motobraucējiem · rydrway.com · planner.bike
· detechtapp.com/premium · osmand.net competitors Q2 2026.
