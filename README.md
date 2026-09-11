# Mopiks

Adventure motorcycle routes from natural language. From idea to GPX in seconds.

> "Start in Cēsis. 150 km loop, around 60% gravel, follow part of the TET, easy adventure."

The app interprets the request with an LLM (structured intent only — it never
invents coordinates), generates **3 alternative routes** with Valhalla's
`motorcycle` costing, shows them on a MapLibre map with the adventure-rider
road model (**Road / Track-dashed / Trail-dotted**), and exports GPX for
OsmAnd, Garmin, DMD2, Locus, Kurviger, etc.

## Features

- Natural-language ride description (Latvian or English) + structured **Start** and optional **Destination** fields
- One route per conversation, with required stops and explicit time/retracing bounds (see `docs/CHAT-MVP-2026-09-10.md`)
- Loops planned from a reachability isochrone and snapped to real places (viewing towers, hillforts, ferries, fords), so routes are named after what they visit
- **TET Latvia** support: mention "TET" and routes follow a slice of the nearest Trans Euro Trail section; purple TET overlay on the map
- Road / Track / Trail mix, surface breakdown, and **repeated-roads percentage** per route, with honest unknown-data warnings
- GPX download, regenerate for fresh alternatives
- Works without an OpenAI key (heuristic prompt parser fallback)

## Setup

```bash
npm install
cp .env.example .env.local   # add your keys
npm run dev
```

- `STADIA_API_KEY` — required, free key at [client.stadiamaps.com](https://client.stadiamaps.com)
- `OPENAI_API_KEY` — optional, enables LLM intent parsing
- `VALHALLA_BASE_URL` — optional, points at a self-hosted Valhalla

Optional, for named loop stops:

```bash
python3 scripts/build_poi_dataset.py   # writes public/poi-baltics.geojson
```

Without it loops still work, using isochrone anchors without named stops.

**On the routing engine.** GraphHopper's hosted API offers only car/bike/foot:
`car` excludes `highway=track`/`path` from its graph entirely (so trails never
appear, whatever the custom model says), and `bike` routes onto cycleways
motorcycles may not use. Valhalla has a real `motorcycle` costing model whose
`use_trails` knob genuinely steers surface choice — measured on a rural
Latvian route, `use_trails: 0` gives 93% asphalt and `use_trails: 1` gives 80%
unpaved.

**On the free tier.** Stadia's free plan forbids commercial use. Valhalla
itself is Apache 2.0, so `VALHALLA_BASE_URL` is the migration path; the client
speaks the same API either way.

## How loops are built

Valhalla has no round-trip algorithm, so loops are assembled from via points:

1. One isochrone request (3 contours) gives the genuinely reachable boundary
   under the same motorcycle costing the route will use.
2. Boundary anchors are sampled by arc length and snapped to nearby POIs.
3. Stops are visited in bearing order, which makes the tour a simple
   non-self-intersecting polygon by construction.
4. Internal candidates are evaluated, but only one accepted route is returned.

The measure of a good loop is **not** circularity or hitting the distance
target — it is not riding the same road twice. An oval or a lopsided sprawl is
fine. Purely geometric anchors (no isochrone, no POIs) gave 7–34% retraced
roads with no stable radius or stop count, because an anchor can land where
only one road leads and the router is then forced to reuse it.

## Architecture

```
prompt ──▶ lib/ai/parse-route-prompt.ts   (LLM → RouteIntent JSON, never coordinates)
start  ──▶ lib/geo/geocode.ts             (geocoding, Baltic-biased)
intent ──▶ lib/routing/profiles.ts        (RouteIntent → Valhalla motorcycle costing)
       ──▶ lib/geo/isochrone.ts           (contours → loop anchor directions)
       ──▶ lib/geo/poi.ts                 (anchors → real places)
       ──▶ lib/routing/loop.ts            (anchors + POIs → ordered via points)
       ──▶ lib/routing/tet.ts             (TET slice → via points)
       ──▶ lib/routing/valhalla.ts        (routing, isochrones, per-edge attributes)
       ──▶ lib/routing/classify.ts        (edges → Road/Track/Trail, surfaces, overlap)
       ──▶ lib/routing/name-route.ts      (POIs → "Caur Turaidu un ...")
       ──▶ lib/gpx/generate-gpx.ts        (GPX 1.1 export)
```

Per-edge surface and road class need a second Valhalla call
(`trace_attributes`), because the route response carries none. That endpoint
rejects paths over 200 km, so long routes are traced in chunks; if it fails
entirely the route is still returned, with surfaces reported as unknown.

TET data: `public/tet-lv.geojson` — downsampled from the official TET Latvia
GPX (map overlay + server-side slice picking use the same file).

`public/maplibre-gl-worker.mjs` + `maplibre-gl-shared.mjs` are copied from
`node_modules/maplibre-gl/dist` by the `postinstall` script — the bundler's
own worker emission 404s under the Next dev server.
