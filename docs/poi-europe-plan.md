# POI for Europe — Google vs Overpass vs a local OSM extract (2026-09-14)

Costing for `docs/BACKLOG.md` item 8. Research and pilot by an Opus subagent;
the build script gained a `--pbf` mode, and `data/poi-ee-pbf.geojson` is a
working Estonia dataset produced by it.

**Verdict: use Geofabrik `.pbf` extracts processed locally with pyosmium.
Google is both the most expensive option and the one we are not allowed to
use — its terms forbid showing Places data on our MapLibre/OSM map at all, so
the price is academic. Overpass is free but takes ~4 h of babysitting a rate
limiter for a result the local extract produces faster and more completely.**

Measured on Estonia: 117 MB extract downloaded in **6.5 s**, processed in
**88 s**, giving **3,182 POIs** against Overpass's 2,812 — more in every
single category.

## 1. What the script actually collects

`scripts/build_poi_dataset.py` has eleven categories. The score is how far an
adventure rider will detour for one; it is the same table in both modes.

| category | score | OSM tags |
|---|---:|---|
| ferry | 10 | `route=ferry`, `amenity=ferry_terminal` |
| tower | 9 | `man_made=tower` + `tower:type=observation\|watchtower` |
| hillfort | 8 | `historic=archaeological_site` |
| lighthouse | 8 | `man_made=lighthouse` |
| ford | 7 | `ford=yes\|stepping_stones` |
| waterfall | 7 | `natural=waterfall\|cliff\|cave_entrance` (named) |
| manor | 6 | `historic=castle\|manor\|ruins\|fort` |
| viewpoint | 6 | `tourism=viewpoint` |
| mill | 5 | `man_made=watermill\|windmill`, `historic=watermill` |
| reserve | 4 | `leisure=nature_reserve` (named) |
| village | 1 | `place=village\|hamlet` (named, nodes only) |

This list is the first reason Google is a poor fit even before the licence:
**Google Places has no category for most of it.** A hillfort, a ford, a
watermill and a Baltic observation tower are not Google place types. The
nearest types (`tourist_attraction`, `park`, `point_of_interest`) are coarse
and would not distinguish the ford from the car park beside it. Fords in
particular — the signature obstacle this app plans around — exist in OSM as a
tag on a road node and have no Google equivalent at all.

## 2. Cost

### Google Places API (Nearby Search / Text Search)

Current pricing. Nearby Search and Text Search are **not** offered in the cheap
Essentials tier; they start at Pro.

| SKU tier | 0–free cap | then /1k | 100k–500k | 500k–1M |
|---|---:|---:|---:|---:|
| Pro (Nearby/Text Search) | 5,000 free | **$32.00** | $25.60 | $19.20 |
| Enterprise (extra fields) | 1,000 free | **$35.00** | $28.00 | $21.00 |

A grid sweep of Europe (10.18M km², square cells inscribed in the search
radius, × 11 categories):

| radius | cells | requests | Pro | Enterprise |
|---:|---:|---:|---:|---:|
| 5 km | 203,604 | 2,239,644 | **$71,509** | $78,353 |
| 10 km | 50,901 | 559,911 | **$17,757** | $19,562 |
| 25 km | 8,144 | 89,584 | $2,707 | $3,100 |
| 50 km | 2,036 | 22,396 | $557 | $749 |

The 25 km and 50 km rows are fiction. **Nearby Search returns at most 20
results per call**, so a 50 km cell containing 300 villages yields 20 of them
and silently drops the rest. To retrieve ~700k POIs at 20 per call takes a
floor of **35,723 calls even with perfect packing** — about **$983** — and
perfect packing is not achievable, because you cannot know a cell is saturated
without querying it again at a smaller radius. A realistic sweep that does not
lose data sits in the **$18k–$70k** band.

### The licence, which settles it

From the [Google Maps Platform Service Specific Terms](https://cloud.google.com/maps-platform/terms/maps-service-terms), Places API (New):

> **14.2 No use with a non-Google map.** Customer must not use Google Maps
> Content from the Places API in conjunction with a non-Google map.

> **14.3 Caching.** Customer may temporarily cache latitude and longitude
> values from the Places API for up to 30 consecutive calendar days, after
> which Customer must delete the cached latitude and longitude values.

Both clauses independently kill the idea:

- Mopik draws on **MapLibre with OSM/Stadia tiles**. Showing Google-derived
  stops on it is exactly what 14.2 forbids.
- A **pre-baked dataset is the whole architecture** — `lib/geo/poi.ts` reads a
  file off disk, and the build script exists precisely because querying live
  is too slow for a synchronous click. 14.3 caps any cached coordinate at 30
  days, so the dataset would have to be rebuilt monthly, at the full sweep
  price each time.

So the honest answer to the rider's question: **no, Google cannot supply
this** — not at a price, and not at any price, as long as the map is not
Google's. OSM data under ODbL has neither restriction.

### Overpass

The existing path. Measured from the real Baltic build (`.poi-cache`
timestamps, 2026-09-03): **33 queries in 21 minutes**, 10:24 → 10:45.

| scope | queries | wall clock | notes |
|---|---:|---:|---|
| LV/LT/EE (today) | 33 | **21 min** (measured) | trips the limiter near the end |
| 12-country phase | 132 | ~1.4 h | backoff likely |
| 33 TET countries | 363 | **~3.9 h** | before any rate-limit backoff |

The 12 s `QUERY_PAUSE_S` alone accounts for 1.2 h of the 33-country run. The
script already rotates four mirrors because a full build reliably provokes
connection refusals; multiplying the query count by eleven multiplies that
risk. It is free, and it works, but it is hours of supervised waiting.

### Geofabrik `.pbf` + pyosmium — the recommendation

One HTTP download, no rate limits, no mirrors, and the data is complete rather
than whatever the limiter let through. Extrapolated from the measured Estonia
pilot (770 s per GB of `.pbf`; 70.2 POIs per 1000 km²):

| country | `.pbf` | processing | POIs (est.) | output |
|---|---:|---:|---:|---:|
| Estonia | 117 MB | **1.5 min** | **3,182** | **736 KB** |
| Latvia | 133 MB | 1.7 min | 4,533 | 1.0 MB |
| Lithuania | 142 MB | 1.8 min | 4,583 | 1.1 MB |
| Slovenia | 298 MB | 3.7 min | 1,423 | 329 KB |
| Switzerland | 450 MB | 5.6 min | 2,897 | 670 KB |
| Austria | 800 MB | 10.0 min | 5,887 | 1.4 MB |
| Czechia | 900 MB | 11.3 min | 5,535 | 1.3 MB |
| Spain | 1.3 GB | 16.3 min | 35,512 | 8.2 MB |
| Poland | 2.0 GB | 25.7 min | 21,946 | 5.1 MB |
| Italy | 2.1 GB | 27.0 min | 21,149 | 4.9 MB |
| France | 4.3 GB | 53.9 min | 38,719 | 9.0 MB |
| Germany | 4.5 GB | 57.8 min | 25,057 | 5.8 MB |
| **12 countries** | **17.2 GB** | **3.6 h** | **~170,000** | **~39 MB** |
| `europe-latest` | 32.6 GB | ~7.0 h | ~714,000 | ~161 MB |

Estonia's row is measured; the rest is that rate scaled by file size. The
processing is CPU-bound and single-threaded, so per-country runs parallelise
across cores where one Europe-wide pass does not — another reason to phase.

**Disk is the real constraint on this machine: 27 GB free.** The whole-Europe
extract at 32.6 GB does not fit. Per-country extracts do, easily, if each is
deleted after processing — the largest single file is Germany at 4.5 GB.

### Three paths side by side

| | Google Places | Overpass | Geofabrik + pyosmium |
|---|---|---|---|
| money | $18k–$70k | $0 | $0 |
| time (Europe) | hours of API calls | ~3.9 h + backoff | ~7 h, or 3.6 h for 12 countries |
| completeness | 20 results/call cap | whatever the limiter allows | **everything in the file** |
| our categories | mostly absent | exact | **exact** |
| licence | **forbids our map + 30-day cache** | ODbL, fine | ODbL, fine |
| repeatable | monthly re-spend | re-provokes limiter | **re-run any time** |

## 3. Runtime fit

Today: **16,410 POIs, 3.8 MB**, `public/poi-baltics.geojson`, read at request
time by `lib/geo/poi.ts` with `fs.readFileSync`, parsed once and held in a
module-level cache with a 0.1° cell index. It reaches production because
`next.config.ts` names it in `outputFileTracingIncludes` for
`/api/generate-route` — without that the serverless bundler cannot see through
`path.join(process.cwd(), …)`.

Europe at Baltic density is **~714,000 POIs / ~161 MB** — 44× today's file.
That breaks the current approach in three separate ways:

| limit | today | Europe one-file |
|---|---:|---:|
| Vercel function bundle (unzipped) | 3.8 MB of 250 MB | **161 MB of 250 MB** |
| `JSON.parse` on cold start | ~3.8 MB | **161 MB, seconds of CPU** |
| memory held per instance | small | **~400 MB+ parsed** |

The bundle cap is survivable on paper; the cold-start parse is not. Every cold
serverless invocation would pay seconds of parse time before routing starts,
and the app already has a wall-clock budget it cannot exceed.

### Proposed change — tiled JSON per 1° cell, design only

Not built here; `lib/` belongs to other agents this session.

Europe's bbox (lon −25…45, lat 34…72) is 2,660 one-degree cells, of which
~1,197 carry land. At 714k POIs that averages **597 POIs ≈ 138 KB per tile**.

- Build writes `poi/<lon>_<lat>.json` per populated cell plus an `index.json`
  of which cells exist — the same shape `public/tet/<CC>.geojson` +
  `index.json` already uses for the TET overlay, so the pattern is proven here.
- Ship tiles on **Vercel Blob** ($0.023/GB-month; 161 MB is ~$0.004/month)
  rather than in the function bundle, keeping the bundle at today's size.
- `poisNear()` becomes async: compute which 1° cells the search radius
  touches, fetch those tiles, memoise per instance. **A 100 km loop touches
  ~4 tiles ≈ 0.54 MB** — far less than parsing 161 MB, and warm instances
  reuse them.
- Keep the 0.1° in-memory cell index exactly as it is; it just gets populated
  per tile instead of from one file.

`hasPlaceData()` needs rethinking regardless: it currently scans every POI
linearly to decide whether the region has data. Against a tiled store the
answer is simply whether the containing tile exists in `index.json` — cheaper
than today, and it stops being a full-array scan.

The phased plan below keeps this off the critical path: **12 countries is
~39 MB**, which still fits the existing single-file loader if the phase files
are concatenated. The tiling work only becomes mandatory when the coverage
goes past roughly 25 countries.

## 4. Recommendation and phased plan

**Source: Geofabrik extracts, processed locally.** Free, complete, repeatable,
correctly licensed, and measured faster than Overpass per country.

Order follows where the rider has actually ridden — Baltics, Poland/Germany,
the Alps around Como/Lugano, Italy:

| phase | countries | `.pbf` | processing | POIs | why |
|---|---|---:|---:|---:|---|
| 0 | EE (done) | 117 MB | 1.5 min | 3,182 | pilot, in `data/` now |
| 1 | LV, LT | 275 MB | 3.5 min | ~9,100 | replaces the Overpass build |
| 2 | PL, DE | 6.6 GB | 1.4 h | ~47,000 | the Poland/Germany rides |
| 3 | CH, AT, IT, SI | 3.7 GB | 46 min | ~31,000 | Como/Lugano and the Alps |
| 4 | CZ, FR, ES | 6.5 GB | 1.4 h | ~80,000 | the rest of the riding map |

After phase 1 the three Baltic files can replace `poi-baltics.geojson`
directly — same schema, strictly more data. Phases 2–4 are where the storage
design of §3 has to land.

### Commands

Tooling is **not installed system-wide**, and none was installed for this
work. The pilot used a throwaway venv in the scratchpad:

```bash
python3 -m venv .venv && .venv/bin/pip install osmium
```

`osmium-tool` (the C++ CLI) is **not needed** — pyosmium does everything here.
If it is ever wanted for clipping, that one is `brew install osmium-tool`.

```bash
# one country, start to finish (~2 min for a small one)
curl -O https://download.geofabrik.de/europe/latvia-latest.osm.pbf
.venv/bin/python scripts/build_poi_dataset.py \
    --pbf latvia-latest.osm.pbf --country LV --out data/poi-lv.geojson
rm latvia-latest.osm.pbf     # disk is tight: 27 GB free, Germany is 4.5 GB
```

Run countries one at a time and delete each extract afterwards. Several small
ones can run in parallel — the work is single-threaded and CPU-bound, so
parallelism is free until cores run out.

## 5. Pilot result

`data/poi-ee-pbf.geojson` — Estonia, built by the new `--pbf` mode, **schema
identical** to `public/poi-baltics.geojson` (same property keys, same scores,
same `n`/`w`/`r` id namespace, same 3 km spatial thinning, 0 violations).

| | Overpass (in the shipped dataset) | `.pbf` pilot | delta |
|---|---:|---:|---:|
| village | 1,698 | 1,920 | +222 |
| manor | 307 | 337 | +30 |
| ford | 181 | 201 | +20 |
| tower | 130 | 152 | +22 |
| viewpoint | 137 | 157 | +20 |
| lighthouse | 99 | 110 | +11 |
| mill | 91 | 97 | +6 |
| hillfort | 57 | 75 | +18 |
| ferry | 50 | 57 | +7 |
| waterfall | 35 | 41 | +6 |
| reserve | 27 | 35 | +8 |
| **total** | **2,812** | **3,182** | **+370** |

Higher in **every** category, and 2,617 of the old 2,812 ids reappear — the
extra is genuinely new data (three months of OSM edits plus what the rate
limiter ate), not a different interpretation of the tags.

**Do not generalise this table to the other countries.** Estonia gains because
its bbox was queried last; LV and LT *lose* POIs under the `.pbf` path, for a
reason that turns out to be a bug in the old data rather than a shortcoming of
the new one. §6 has the measurements.

Timing: 6.5 s download, 88 s processing, 736 KB out.

### Two things the pilot caught, both fixed

**Relations are not optional.** The first run skipped relation members and
`reserve` collapsed from 27 to 9 — **24 of Estonia's 27 nature reserves are
multipolygons**. The fix is pyosmium's `with_areas()`, which assembles them
into real geometry and costs one extra pass (88 s instead of 44 s on this
file). Any category defined by an area — reserves, castle grounds, larger
manors — depends on this. The doubled runtime is what the whole table above is
extrapolated from, so the phase estimates already include it.

**A ferry route's centroid is not in the country.** Fourteen points land
outside Estonia — "Riga", "Kapellskär", "Ust-Luga" — because `route=ferry`
ways span open water and their midpoint sits at sea or at the far terminal.
The Overpass build had the same behaviour (`out center` does the same thing),
so this is pre-existing and not a regression. It is harmless for routing —
those points are never near a loop anchor — but if it ever matters, the fix is
to clip to the country bbox after collection, not to change the centroid.

## 6. The Baltic rebuild changed the counts — and found a bug in the old data

Phase-1 ran LV/LT/EE through the `.pbf` path. The totals went **down**, which
contradicts the Estonia pilot, and the reason matters more than the numbers:

| | Overpass (shipped) | `.pbf` | delta |
|---|---:|---:|---:|
| LV | 7,551 | 4,609 | **−2,942** |
| LT | 6,047 | 5,659 | −388 |
| EE | 2,812 | 3,182 | +370 |
| **total** | **16,410** | **13,450** | **−2,960** |

**The shipped dataset is not 16,410 Baltic places. It is 16,410 places inside
three rectangles**, and the rectangles cover a great deal of somebody else.
`COUNTRIES` in the script is a list of bboxes, and Overpass honours the
rectangle, not the border. Measured in the shipped file:

- **326 "LV" points lie below lat 55.67** — south of Latvia's border. The
  sample includes ferry terminals in Klaipėda (Lithuania) and villages named
  in Cyrillic near Pskov (Russia); one "LV" ferry is the
  Karlshamn–Klaipėda line, which is in **Sweden**.
- **The shipped "LT" set stops dead at lat 55.60, but Lithuania reaches
  56.45.** The LV rectangle begins at 55.6 and was queried first, so the
  shared thinning pass let LV claim every Lithuanian point north of that line
  and label it `LV`. A third of Lithuania was filed under the wrong country.
- Of the 2,508 "LT" points the `.pbf` build does not reproduce, **1,445 are in
  territory the Lithuanian extract does not cover at all** — Poland, Belarus
  and Kaliningrad — and under the strict same-cell test only **179 (3 %)** are
  plausibly inside Lithuania.

A Geofabrik extract is clipped to the **actual country polygon**, so the
`.pbf` counts are lower because they are *correct*. The `country` property
becomes trustworthy for the first time; today it records which rectangle got
there first.

Estonia gained POIs (+370) precisely because its rectangle was the *last* one
queried and had least taken from it — the same mechanism, seen from the other
side.

**This is a real bug in the live app, not a cosmetic one.** `hasPlaceData()`
decides whether to warn the rider about unnamed stops, and `loop.ts` picks
anchors by proximity; both currently trust a `country` label that is wrong for
thousands of points, and both will happily anchor a "Latvian" loop on a
village near Pskov. It is out of scope here (`lib/` belongs to item 19) but
should be its own backlog entry.

**Recommendation for the loader switch:** use the per-country `.pbf` files and
treat the drop from 16,410 to 13,450 as a correction, not a regression. The
union check confirms it is not silent data loss — 79.8 % of the old ids
reappear, and essentially all of the remainder are foreign or duplicated
across rectangles.

### One difference worth knowing before the Baltic rebuild

The `--pbf` mode keeps `village` node-only, matching the Overpass query
exactly (`PBF_NODE_ONLY`). A guard asserts `CATEGORIES` and `PBF_MATCHERS`
describe the same eleven categories with the same scores, so adding a category
to one and forgetting the other fails loudly at import rather than silently
producing a dataset missing a category.

The Overpass path in the script is **unchanged** — byte-identical collection
loop and helpers, verified after the refactor. Running the script with no
arguments still rebuilds `public/poi-baltics.geojson` from `.poi-cache`
exactly as before.
