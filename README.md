# Baltic Adventure Route Generator

Adventure motorcycle routes from natural language. From idea to GPX in seconds.

> "Start in Cēsis. 150 km loop, around 60% gravel, follow part of the TET, easy adventure."

The app interprets the request with an LLM (structured intent only — it never
invents coordinates), generates **3 alternative routes** with GraphHopper,
shows them on a MapLibre map with the adventure-rider road model
(**Road / Track-dashed / Trail-dotted**), and exports GPX for OsmAnd, Garmin,
DMD2, Locus, Kurviger, etc.

## Features

- Natural-language ride description (Latvian or English) + structured **Start** and optional **Destination** fields
- 3 route alternatives per request (different seeds for loops, detour variants for point-to-point)
- **TET Latvia** support: mention "TET" and routes follow a slice of the nearest Trans Euro Trail section; purple TET overlay on the map
- Road / Track / Trail mix + surface breakdown per route, with honest unknown-data warnings
- GPX download, regenerate with fresh seeds
- Works without an OpenAI key (heuristic prompt parser fallback)

## Setup

```bash
npm install
cp .env.example .env.local   # add your keys
npm run dev
```

- `GRAPHHOPPER_API_KEY` — required, free key at [graphhopper.com](https://www.graphhopper.com/)
- `OPENAI_API_KEY` — optional, enables LLM intent parsing

Note: the free GraphHopper plan doesn't support custom models (routing
profiles) and allows max 5 route points; the app degrades gracefully (standard
car profile, TET followed via 3 via-points). A paid key unlocks the
gravel/difficulty custom models in `lib/routing/profiles.ts` automatically.

## Architecture

```
prompt ──▶ lib/ai/parse-route-prompt.ts   (LLM → RouteIntent JSON, never coordinates)
start  ──▶ lib/geo/geocode.ts             (GraphHopper geocoding, Baltic-biased)
intent ──▶ lib/routing/profiles.ts        (GraphHopper custom models per difficulty)
       ──▶ lib/routing/tet.ts             (TET slice → via points)
       ──▶ lib/routing/graphhopper.ts     (round-trip / multi-point routing)
       ──▶ lib/routing/classify.ts        (path details → Road/Track/Trail + surfaces)
       ──▶ lib/gpx/generate-gpx.ts        (GPX 1.1 export)
```

TET data: `public/tet-lv.geojson` — downsampled from the official TET Latvia
GPX (map overlay + server-side slice picking use the same file).

`public/maplibre-gl-worker.mjs` + `maplibre-gl-shared.mjs` are copied from
`node_modules/maplibre-gl/dist` by the `postinstall` script — the bundler's
own worker emission 404s under the Next dev server.
