# Mopik — progress log

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
