#!/usr/bin/env python3
"""Build public/poi-baltics.geojson — places worth riding to, for loop planning.

Run manually (NOT part of install):
    python3 scripts/build_poi_dataset.py

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
    ("waterfall", 7, ['nwr["natural"~"^(waterfall|cliff|cave_entrance)$"]["name"]({b});']),
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


def main():
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
                collected.append(
                    {
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
                )
                kept += 1
            print(f" {kept:>6} kept", flush=True)
            # Only pause after a real request; cached reads need no throttle.
            if not from_cache:
                time.sleep(QUERY_PAUSE_S)

    # Never overwrite a good dataset with an empty one: a run where every
    # query failed must fail loudly, not leave a valid-looking empty file.
    if len(collected) < 100:
        print(
            f"\nOnly {len(collected)} POIs collected — refusing to write "
            "public/poi-baltics.geojson. Check the failures above and re-run.",
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
        for field in ("nameLv", "nameEn", "nameLvAcc"):
            if p.get(field):
                props[field] = p[field]
        features.append(
            {
                "type": "Feature",
                "geometry": {"type": "Point", "coordinates": [p["lon"], p["lat"]]},
                "properties": props,
            }
        )

    out = os.path.join(os.getcwd(), "public", "poi-baltics.geojson")
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


if __name__ == "__main__":
    main()
