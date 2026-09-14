#!/usr/bin/env python3
"""Build a POI dataset — places worth riding to, for loop planning.

Two sources, same schema and same scoring:

    # Overpass (the original path, LV/LT/EE)
    python3 scripts/build_poi_dataset.py

    # A local Geofabrik .pbf extract — no rate limits, no mirrors
    python3 scripts/build_poi_dataset.py --pbf estonia-latest.osm.pbf --country EE \
        --out public/poi-ee.geojson

The .pbf mode needs pyosmium (`pip install osmium`) and is the only path that
scales to Europe: Overpass rate-limits a 33-query Baltic build into a 21-minute
run, and Europe is ~50x that. See docs/poi-europe-plan.md for the costing.

Why pre-baked rather than querying Overpass per request: the public instances
queue requests up to 15s then discard them, and return 429 under even light
use. That is unusable on a synchronous "Generate routes" click. Baking also
lets the category weights be curated, and makes route generation
deterministic and testable. Same pattern as the existing public/tet-lv.geojson.
"""

import json
import math
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

# Mirrors, tried in order. The main instance rate-limits aggressively and
# then refuses connections outright for a while, so a fallback list is not a
# nicety — a full build reliably trips it.
OVERPASS_MIRRORS = [
    # kumi.systems and the mail.ru mirror tolerate a full build; the main
    # instance is listed last because it is the first to start refusing
    # connections outright, which then stalls the whole run.
    "https://overpass.kumi.systems/api/interpreter",
    "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
    "https://overpass.private.coffee/api/interpreter",
    "https://overpass-api.de/api/interpreter",
]
USER_AGENT = "Mopik-POI-builder/0.1 (adventure motorcycle route planner for the Baltics)"

# Queried per country so a single request never grows large enough to be
# dropped by the public instance.
COUNTRIES = [
    ("LV", "55.6,20.9,58.1,28.3"),
    ("LT", "53.8,20.9,56.5,26.9"),
    ("EE", "57.5,21.7,59.7,28.2"),
]

# What an adventure rider detours for, and how much. Ferries and fords score
# highest because a water crossing is the signature Baltic adventure obstacle.
# Villages sit at 1: they exist only as spacing filler when a bearing has
# nothing better to offer.
CATEGORIES = [
    ("ferry", 10, ['nwr["route"="ferry"]({b});', 'nwr["amenity"="ferry_terminal"]({b});']),
    # Fords sit below towers despite being a real adventure feature: OSM tags
    # nondescript culverts as ford=yes identically to genuine river crossings,
    # and scoring them top made every loop stop an anonymous "ford".
    ("ford", 7, ['nwr["ford"~"yes|stepping_stones"]({b});']),
    ("tower", 9, ['nwr["man_made"="tower"]["tower:type"~"observation|watchtower"]({b});']),
    ("hillfort", 8, ['nwr["historic"="archaeological_site"]({b});']),
    ("lighthouse", 8, ['nwr["man_made"="lighthouse"]({b});']),
    # Three separate categories, not one bucket. These used to be a single
    # `waterfall` query over natural=waterfall|cliff|cave_entrance, which is
    # how a rider was shown "Gūtmaņa ala · ūdenskritums" — the best-known cave
    # in Latvia, labelled a waterfall. A cave is not a waterfall and the label
    # is the whole point of the row.
    ("waterfall", 7, ['nwr["natural"="waterfall"]["name"]({b});']),
    # Caves and cliffs sit just under waterfalls: rarer, and a named one is
    # almost always a genuine landmark (Gūtmaņa ala, Gaujas senlejas klintis)
    # rather than the anonymous rock face that an unnamed one usually is.
    ("cave", 7, ['nwr["natural"="cave_entrance"]["name"]({b});']),
    ("cliff", 6, ['nwr["natural"="cliff"]["name"]({b});']),
    ("manor", 6, ['nwr["historic"~"^(castle|manor|ruins|fort)$"]({b});']),
    ("viewpoint", 6, ['nwr["tourism"="viewpoint"]({b});']),
    ("mill", 5, ['nwr["man_made"~"^(watermill|windmill)$"]({b});', 'nwr["historic"="watermill"]({b});']),
    ("reserve", 4, ['nwr["leisure"="nature_reserve"]["name"]({b});']),
    ("village", 1, ['node["place"~"^(village|hamlet)$"]["name"]({b});']),
]

# Drop a POI within this range of a kept, higher-scoring one of the same kind.
THIN_RADIUS_M = 3000


# Overpass throttles hard: a full 33-query run trips its rate limiter and then
# every mirror refuses connections for a while. So pause generously between
# queries, and cache each answer so an interrupted run resumes instead of
# starting over (and re-provoking the limiter).
QUERY_PAUSE_S = 12
# Outside public/ so raw Overpass dumps are never served by the app.
CACHE_DIR = os.path.join(".poi-cache")


# Index of the mirror currently working, so one probe serves the whole run.
_mirror = 0


def overpass(query, attempt=1):
    """POST a query, rotating mirrors on rate-limits and refused connections."""
    global _mirror

    data = urllib.parse.urlencode({"data": query}).encode()
    last_error = None

    # Try every mirror once per attempt, starting from the last one that worked.
    for offset in range(len(OVERPASS_MIRRORS)):
        index = (_mirror + offset) % len(OVERPASS_MIRRORS)
        url = OVERPASS_MIRRORS[index]
        req = urllib.request.Request(url, data=data, headers={"User-Agent": USER_AGENT})
        try:
            with urllib.request.urlopen(req, timeout=300) as resp:
                _mirror = index  # stick with whichever mirror answered
                return json.load(resp)
        except urllib.error.HTTPError as err:
            last_error = f"HTTP {err.code}"
            if err.code not in (429, 504):
                raise
        except (urllib.error.URLError, OSError) as err:
            last_error = str(err)

    # Give up after two rounds rather than stalling: the per-query cache means
    # a later run resumes from here, and hammering a throttled instance is
    # what gets every mirror to refuse connections in the first place.
    if attempt <= 2:
        wait = 20 * attempt
        print(f"   all mirrors unavailable ({last_error}) — waiting {wait}s", flush=True)
        time.sleep(wait)
        return overpass(query, attempt + 1)

    raise RuntimeError(f"all Overpass mirrors failed: {last_error}")


def haversine_m(a, b):
    R = 6371000.0
    d_lat = math.radians(b[1] - a[1])
    d_lon = math.radians(b[0] - a[0])
    h = (
        math.sin(d_lat / 2) ** 2
        + math.cos(math.radians(a[1])) * math.cos(math.radians(b[1])) * math.sin(d_lon / 2) ** 2
    )
    return 2 * R * math.asin(math.sqrt(h))


def latvian_accusative(name):
    """Latvian accusative, for names read as "Caur {X}" in route titles.

    Precomputed here rather than inflected at runtime. Consonant stems and
    plurals are left alone — the caller falls back to a case-free phrasing
    when this returns None.
    """
    if not name:
        return None
    parts = name.split(" ")
    last = parts[-1]
    if len(last) > 1 and last[-1] in "aA" and last[-2].lower() not in "aeiouāēīū":
        inflected = last[:-1] + "u"
    elif last.endswith("e"):
        inflected = last[:-1] + "i"
    else:
        return None
    return " ".join(parts[:-1] + [inflected])


def element_point(el):
    if el.get("type") == "node" and "lat" in el:
        return (el["lon"], el["lat"])
    if "center" in el:
        return (el["center"]["lon"], el["center"]["lat"])
    return None


# --- .pbf mode -------------------------------------------------------------
#
# The CATEGORIES table above is written as Overpass snippets, which pyosmium
# cannot execute. Rather than keep two lists that can drift apart, each
# category gets a predicate over an OSM tag dict here, and a check below
# asserts the two tables describe the same categories with the same scores.

def _is_archaeological(t):
    return t.get("historic") == "archaeological_site"


PBF_MATCHERS = {
    "ferry": lambda t: t.get("route") == "ferry" or t.get("amenity") == "ferry_terminal",
    "ford": lambda t: t.get("ford") in ("yes", "stepping_stones"),
    "tower": lambda t: t.get("man_made") == "tower"
    and t.get("tower:type") in ("observation", "watchtower"),
    "hillfort": _is_archaeological,
    "lighthouse": lambda t: t.get("man_made") == "lighthouse",
    "waterfall": lambda t: t.get("natural") == "waterfall" and bool(t.get("name")),
    "cave": lambda t: t.get("natural") == "cave_entrance" and bool(t.get("name")),
    "cliff": lambda t: t.get("natural") == "cliff" and bool(t.get("name")),
    "manor": lambda t: t.get("historic") in ("castle", "manor", "ruins", "fort"),
    "viewpoint": lambda t: t.get("tourism") == "viewpoint",
    "mill": lambda t: t.get("man_made") in ("watermill", "windmill")
    or t.get("historic") == "watermill",
    "reserve": lambda t: t.get("leisure") == "nature_reserve" and bool(t.get("name")),
    "village": lambda t: t.get("place") in ("village", "hamlet") and bool(t.get("name")),
}

# The two tables must stay in step: a category added to CATEGORIES without a
# matcher would silently vanish from every .pbf build.
assert {k for k, _, _ in CATEGORIES} == set(PBF_MATCHERS), (
    "CATEGORIES and PBF_MATCHERS disagree: "
    f"{ {k for k, _, _ in CATEGORIES} ^ set(PBF_MATCHERS) }"
)

# "village" is node-only in the Overpass query, so keep it node-only here too —
# otherwise a .pbf build picks up place polygons the Baltic dataset never had.
PBF_NODE_ONLY = {"village"}


# --- the "Vairāk" row ------------------------------------------------------
#
# Until now a feature carried id/category/score/country/names and nothing
# else, so a rider who wanted to know *what* a place is had nowhere to go but
# openstreetmap.org. These tags are already in the .pbf being read — the file
# is open, the tag dict is built, and taking them costs no extra pass — so the
# only real question is file size, which is why this list is short and why
# every field is omitted when absent rather than written as null.
#
# Deliberately NOT here: `wikidata` (an opaque Q-number the UI cannot render
# without a second network call, and `wikipedia` already links the same
# article), and free-text `note`/`inscription` (long, untranslated, and
# frequently surveyor's chatter rather than anything a rider wants).
#
# `description` is capped because OSM has no length limit on it and a handful
# of entries run to paragraphs; 300 characters is a phone-screen paragraph.
DESCRIPTION_MAX = 300

# Plain string tags, copied through under the same name.
ENRICH_STRING = ("website", "opening_hours", "fee", "access", "historic", "tourism")


def enrichment(tags, locale_hint="lv"):
    """The optional extras for one POI, as a dict of only what is present.

    Returns `{}` for the common case — most OSM objects carry none of this —
    so a feature that has nothing gains not one byte.
    """
    extra = {}

    # `wikipedia` is "lang:Article Title". Prefer the article in the rider's
    # own language when the object names one (`wikipedia:lv=…`), because
    # sending a Latvian rider to the English article about a Latvian cave is
    # the worse of two links.
    wiki = tags.get(f"wikipedia:{locale_hint}")
    if wiki:
        wiki = f"{locale_hint}:{wiki}"
    else:
        wiki = tags.get("wikipedia")
    if wiki and ":" in wiki:
        extra["wikipedia"] = wiki

    # Elevation: a number the UI can format, not the raw string. OSM has
    # "123", "123 m" and the occasional "123,5"; anything else is dropped
    # rather than shipped as text that no caller can do arithmetic on.
    ele = tags.get("ele")
    if ele:
        cleaned = ele.replace(",", ".").replace("m", "").strip()
        try:
            extra["ele"] = round(float(cleaned), 1)
        except ValueError:
            pass

    desc = tags.get(f"description:{locale_hint}") or tags.get("description")
    if desc:
        desc = " ".join(desc.split())
        extra["description"] = (
            desc if len(desc) <= DESCRIPTION_MAX else desc[: DESCRIPTION_MAX - 1].rstrip() + "…"
        )

    for tag in ENRICH_STRING:
        value = tags.get(tag)
        # `historic`/`tourism` are what a category was *derived* from for some
        # kinds; keeping them lets the row say "muiža" where the category only
        # says `manor`. Skip the placeholder values that say nothing.
        if value and value not in ("yes", "no"):
            extra[tag] = value

    # `website` has a second common spelling; only used when the first is absent.
    if "website" not in extra:
        alt = tags.get("contact:website") or tags.get("url")
        if alt:
            extra["website"] = alt

    return extra


# Which extras may reach the output file. `thin_and_write` copies exactly
# these, so a tag added above is written and nothing else ever is.
ENRICH_FIELDS = ("wikipedia", "website", "description", "ele", "historic", "tourism",
                 "opening_hours", "fee", "access")


def collect_from_pbf(path, code):
    """Every POI in one extract, in the same shape the Overpass path produces.

    Overpass's `out center` returns one representative point per object
    whatever its type, so this must do the same for nodes, ways and
    relations. Relations matter more than their rarity suggests: 24 of
    Estonia's 27 nature reserves are multipolygons, and skipping them dropped
    the category to 9. pyosmium assembles them with `with_areas()`, which
    costs one extra pass over the file (~6 s on a 117 MB extract).
    """
    import osmium  # imported here so the Overpass path needs no pyosmium

    scores = {key: score for key, score, _ in CATEGORIES}
    collected = []
    seen = set()

    def consider(obj, kind, ident, tags, point):
        for key, match in PBF_MATCHERS.items():
            if kind != "n" and key in PBF_NODE_ONLY:
                continue
            if not match(tags):
                continue
            name = tags.get("name:lv") or tags.get("name") or tags.get("name:en")
            # Same rule as the Overpass path: an unnamed tower is still a
            # tower, an unnamed village is useless as a waypoint.
            if not name and key == "village":
                continue
            if (key, ident) in seen:
                continue
            seen.add((key, ident))
            name_lv = tags.get("name:lv") or tags.get("name")
            poi = {
                "id": ident,
                "lon": round(point[0], 5),
                "lat": round(point[1], 5),
                "category": key,
                "score": scores[key],
                "country": code,
                "nameLv": name_lv,
                "nameEn": tags.get("name:en") or tags.get("name"),
                "nameLvAcc": latvian_accusative(name_lv),
            }
            # The tag dict is already built and the file already open, so the
            # extras cost no extra pass — only bytes, which is why
            # `enrichment` omits rather than nulls.
            poi.update(enrichment(tags))
            collected.append(poi)

    # `with_areas()` turns closed ways and multipolygon relations into Area
    # objects with real geometry; nodes and open ways still arrive as
    # themselves. An area reports whether it came from a way or a relation,
    # which is what keeps the ids in the same `n`/`w`/`r` namespace the
    # Overpass build used.
    fp = osmium.FileProcessor(path).with_areas()
    fp = fp.with_filter(osmium.filter.EmptyTagFilter())

    for obj in fp:
        tags = dict(obj.tags)
        if obj.is_node():
            consider(obj, "n", f"n{obj.id}", tags, (obj.location.lon, obj.location.lat))
        elif obj.is_area():
            point = _area_centre(obj)
            if point:
                kind = "w" if obj.from_way() else "r"
                consider(obj, kind, f"{kind}{obj.orig_id()}", tags, point)
        elif obj.is_way():
            # An open way — a ferry route, a cliff line. Areas above already
            # covered the closed ones.
            point = _way_centre(obj)
            if point:
                consider(obj, "w", f"w{obj.id}", tags, point)

    return collected


def _way_centre(way):
    """Centroid of an open way's nodes, or None when locations are missing.

    An extract clipped at a border carries ways whose nodes lie outside the
    file; those have no location and are skipped rather than read as (0, 0),
    which would drop a POI into the Atlantic.
    """
    lons, lats = [], []
    for node in way.nodes:
        if node.location.valid():
            lons.append(node.location.lon)
            lats.append(node.location.lat)
    if not lons:
        return None
    return (sum(lons) / len(lons), sum(lats) / len(lats))


def _area_centre(area):
    """Centroid of an area's outer ring(s)."""
    lons, lats = [], []
    for ring in area.outer_rings():
        for node in ring:
            if node.location.valid():
                lons.append(node.location.lon)
                lats.append(node.location.lat)
    if not lons:
        return None
    return (sum(lons) / len(lons), sum(lats) / len(lats))


def collect_from_overpass():
    collected = []

    for code, bbox in COUNTRIES:
        for key, score, templates in CATEGORIES:
            body = "\n  ".join(t.format(b=bbox) for t in templates)
            query = f"[out:json][timeout:300];\n(\n  {body}\n);\nout center tags;"
            sys.stdout.write(f"{code} {key:<11}")
            sys.stdout.flush()

            cache_file = os.path.join(CACHE_DIR, f"{code}-{key}.json")
            from_cache = os.path.exists(cache_file)
            if from_cache:
                with open(cache_file, encoding="utf-8") as fh:
                    data = json.load(fh)
                sys.stdout.write(" (cached)")
            else:
                try:
                    data = overpass(query)
                except Exception as err:  # noqa: BLE001 - report and continue
                    print(f" FAILED {str(err)[:80]}", flush=True)
                    time.sleep(QUERY_PAUSE_S)
                    continue
                os.makedirs(CACHE_DIR, exist_ok=True)
                with open(cache_file, "w", encoding="utf-8") as fh:
                    json.dump(data, fh)

            kept = 0
            for el in data.get("elements", []):
                point = element_point(el)
                if not point:
                    continue
                tags = el.get("tags", {})
                name = tags.get("name:lv") or tags.get("name") or tags.get("name:en")
                # Everything but villages is worth riding to even unnamed (an
                # unnamed observation tower is still a tower); an unnamed
                # village is useless as a waypoint.
                if not name and key == "village":
                    continue
                name_lv = tags.get("name:lv") or tags.get("name")
                poi = {
                    "id": f"{el['type'][0]}{el['id']}",
                    "lon": round(point[0], 5),
                    "lat": round(point[1], 5),
                    "category": key,
                    "score": score,
                    "country": code,
                    "nameLv": name_lv,
                    "nameEn": tags.get("name:en") or tags.get("name"),
                    "nameLvAcc": latvian_accusative(name_lv),
                }
                # `out center tags` already returned every tag, so the extras
                # cost nothing here either — and both paths must produce the
                # same feature shape or the app would have to branch on which
                # build wrote the file.
                poi.update(enrichment(tags))
                collected.append(poi)
                kept += 1
            print(f" {kept:>6} kept", flush=True)
            # Only pause after a real request; cached reads need no throttle.
            if not from_cache:
                time.sleep(QUERY_PAUSE_S)

    return collected


def thin_and_write(collected, out_path):
    """Spatial thinning and GeoJSON output — shared by both sources."""
    # Never overwrite a good dataset with an empty one: a run where every
    # query failed must fail loudly, not leave a valid-looking empty file.
    if len(collected) < 100:
        print(
            f"\nOnly {len(collected)} POIs collected — refusing to write "
            f"{out_path}. Check the failures above and re-run.",
            file=sys.stderr,
        )
        sys.exit(1)

    # Spatial thinning: without it a loop gets offered five hillforts in one
    # parish. Highest score wins; ties prefer the named one.
    collected.sort(key=lambda p: (-p["score"], 0 if p["nameLv"] else 1))
    by_category = {}
    thinned = []
    for poi in collected:
        peers = by_category.setdefault(poi["category"], [])
        if any(
            haversine_m((p["lon"], p["lat"]), (poi["lon"], poi["lat"])) < THIN_RADIUS_M
            for p in peers
        ):
            continue
        peers.append(poi)
        thinned.append(poi)

    features = []
    for p in thinned:
        props = {
            "id": p["id"],
            "category": p["category"],
            "score": p["score"],
            "country": p["country"],
        }
        for field in ("nameLv", "nameEn", "nameLvAcc", *ENRICH_FIELDS):
            if p.get(field):
                props[field] = p[field]
        features.append(
            {
                "type": "Feature",
                "geometry": {"type": "Point", "coordinates": [p["lon"], p["lat"]]},
                "properties": props,
            }
        )

    out = os.path.join(os.getcwd(), out_path)
    with open(out, "w", encoding="utf-8") as fh:
        json.dump({"type": "FeatureCollection", "features": features}, fh, ensure_ascii=False)

    counts = {}
    for p in thinned:
        counts[p["category"]] = counts.get(p["category"], 0) + 1
    size_mb = os.path.getsize(out) / 1024 / 1024
    print(f"\n{len(thinned)} POIs (from {len(collected)} raw) -> {out}")
    print(f"{size_mb:.2f} MB")
    for key, n in sorted(counts.items(), key=lambda kv: -kv[1]):
        print(f"  {key:<11} {n:>6}")

    # What the "Vairāk" extras actually cost, per field, so the decision to
    # keep or drop one is made on measured bytes rather than on a guess. The
    # cost is the serialised key *and* value, which is what the file grows by.
    extra_bytes = {}
    extra_count = {}
    for p in thinned:
        for field in ENRICH_FIELDS:
            if p.get(field):
                extra_count[field] = extra_count.get(field, 0) + 1
                extra_bytes[field] = extra_bytes.get(field, 0) + len(
                    json.dumps({field: p[field]}, ensure_ascii=False).encode("utf-8")
                )
    if extra_bytes:
        total = sum(extra_bytes.values()) / 1024
        print(f"  — extras: {total:.0f} KB of {size_mb * 1024:.0f} KB "
              f"({100 * total / (size_mb * 1024):.1f}%)")
        for field, n in sorted(extra_count.items(), key=lambda kv: -extra_bytes[kv[0]]):
            print(f"      {field:<13} {n:>6} on {extra_bytes[field] / 1024:>7.1f} KB")


def main():
    args = sys.argv[1:]

    def option(flag, default=None):
        return args[args.index(flag) + 1] if flag in args else default

    pbf = option("--pbf")
    if not pbf:
        # The original path: Overpass, LV/LT/EE, writing the dataset the app
        # ships today. Unchanged.
        thin_and_write(collect_from_overpass(), os.path.join("public", "poi-baltics.geojson"))
        return

    code = option("--country")
    out_path = option("--out")
    if not code or not out_path:
        print("--pbf needs --country CC and --out path", file=sys.stderr)
        sys.exit(2)

    started = time.time()
    print(f"reading {pbf} ({os.path.getsize(pbf) / 1024 / 1024:.0f} MB) …", flush=True)
    collected = collect_from_pbf(pbf, code)
    print(f"{len(collected)} raw POIs in {time.time() - started:.0f}s", flush=True)
    thin_and_write(collected, out_path)


if __name__ == "__main__":
    main()
