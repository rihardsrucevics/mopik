#!/usr/bin/env python3
"""Yard signals for one or more country extracts → `data/yards-<CC>.geojson`.

    .venv/bin/python scripts/build_yard_dataset.py --pbf latvia-latest.osm.pbf --country LV
    .venv/bin/python scripts/build_yard_dataset.py LV LT EE        # download + build each

Backlog item 12, "routes run through private property". `docs/private-property-options.md`
is the measured investigation behind this file; the short version is that OSM in
rural Latvia says nothing about who owns a yard. Across six rides, 187 edges ran
within 25 m of a building and between them carried **one** `motor_vehicle=destination`,
two `access=permissive`, two `motor_vehicle=permissive` and one `motor_vehicle=yes` —
zero `private`, zero `no`. `noexit` appeared on none of them. Every ridden
`highway=service` (33 of 33) carried no `service=*` subtag, so the profile's existing
`service=driveway` ban catches nothing. The one thing OSM records reliably is **that
there is a building there**, and `building` is not in BRouter's `lookups.dat` at all —
neither is `landuse`. So the signal has to be prebuilt here and measured in Mopik's
own code (`lib/geo/yards.ts`, `lib/routing/classify.ts`).

## The rider's correction, and what it changed

The first version of this script emitted buildings within 25 m of a track and
the runtime penalised routes for passing them. The rider rejected that outright:

    "A house near the road does not make the road private. Only a road that goes
    THROUGH the yard does. I do not want the route changed because a house is
    25 m from the road — private houses stand beside public roads all the time."

He is right, and the investigation's own data says so: 100.4 km of the 601 km
measured lay within 25 m of a building, and most of it is ordinary village road
with houses along it. Proximity is a necessary condition, never a sufficient
one. So this file emits the **raw evidence** and `lib/routing/classify.ts`
applies the "through a yard" rules to it. Nothing here decides anything.

The output is also **information only** — no route is ranked or rejected on it.
It becomes a RISKI row and a map badge, the way unverified access already does.

## What is emitted

Three kinds of feature:

- **`building`** — the centroid of a `building=*` way or multipolygon relation that
  lies within `NEAR_M` (25 m) of a `highway=track` or `highway=service` way. *Only*
  those. Latvia has order 10^6 buildings; the investigation estimated a few thousand
  survive this filter, which is what keeps the shipped file small enough to parse on
  a cold serverless invocation. A building 200 m from the nearest track is not a
  yard a route can ride through, so it carries no information for this feature.
- **`gate`** — a `barrier=gate|lift_gate|bollard|chain|swing_gate` **node that sits on**
  a track/service way. This is the one explicit signal OSM does give: a gate across a
  farm track is somebody controlling access to it. 38 were touched across the six
  rides. `barrier=kerb` is deliberately excluded — a kerb is not access control, and
  Cēsis → Madona touched two of them on ordinary street.
- **`farmyard`** — a `landuse=farmyard` polygon, and a *small* `landuse=residential`
  one (at most `SMALL_RESIDENTIAL_BUILDINGS` buildings inside it, so a village
  centre is not mistaken for one homestead). Emitted as a simplified ring, because
  a route inside one of these is inside somebody's yard by OSM's own statement —
  the strongest rule there is, and the reason the geometry has to ship rather than
  a centroid. Only rings under `MAX_FARMYARD_SPAN_M` across are kept: a
  kilometre-wide `landuse=residential` is a suburb, not a farmstead.

25 m is not a round number, it is the measured one. Of 125.9 km of `highway=track`
ridden across the six rides, 7.8 % lay within 25 m of a building and 26.7 % within
50 m. It is the radius at which "in the yard" is plausible at all — at Latvian
homestead scale the drive passes between the house and the barn. It is the collection
filter here, not the verdict; the verdict needs buildings on *both* sides, or a
farmyard polygon, or a gate, or a dead end.

## Two passes, and the grid

Pass 1 reads every way and keeps the node locations of `highway=track|service` ways,
binning each into a `CELL_DEG` grid. Pass 2 re-reads the file and tests each building
centroid (and each barrier node) against the 9 cells around it. Two passes rather
than one because a `.pbf` is ordered nodes → ways → relations: a building way is
reachable before, after or between the track ways that decide it, so nothing can be
answered in a single streaming pass without holding the whole country in memory.

`with_areas()` is what makes relations work, and it is not optional — the POI build
learned this when 24 of Estonia's 27 nature reserves turned out to be multipolygons
and skipping relations collapsed the category to 9. A farmyard's main building is
frequently a multipolygon too. It costs one extra pass over the file internally,
which is why pass 2 is the expensive one.

Idempotent: re-running overwrites `data/yards-<CC>.geojson` and touches nothing else.
Run countries one at a time and delete each extract afterwards — disk is the
constraint, not CPU (Germany's extract is 4.5 GB).
"""

import json
import math
import os
import subprocess
import sys
import time

# Metres within which a building counts as "you are in the yard". Measured; see
# the module docstring. 50 m was tested and refused.
NEAR_M = 25.0

# Grid cell for the track/service index, in degrees of latitude. 0.01° is ~1.1 km
# tall — comfortably larger than NEAR_M, so a 3x3 cell neighbourhood always
# contains every candidate, and small enough that a cell holds few points even in
# a town. Longitude is scaled by cos(lat) so cells stay roughly square; the whole
# point of that is the lesson `tet-coverage.ts` learned the hard way, that a
# fixed-latitude scale is 26 % wrong by the time you reach Spain.
CELL_DEG = 0.01

# Sampling step along a track/service way, in metres. Way geometry is stored as
# its nodes plus interpolated points no further apart than this, so a building
# beside the middle of a long straight edge is still found. 12 m against a 25 m
# radius leaves a wide margin: the worst-case miss is a building exactly
# perpendicular to the midpoint of a step, at sqrt(25^2 - 6^2) = 24.3 m, i.e. it
# is still inside the radius.
SAMPLE_M = 12.0

BARRIER_KINDS = {"gate", "lift_gate", "bollard", "chain", "swing_gate"}
YARD_HIGHWAYS = {"track", "service"}

# A `landuse=residential` polygon is a homestead only when it is small. A village
# centre is also `landuse=residential` and a route through it is a public street,
# which is exactly the false positive the rider objected to. Two guards, because
# either alone is fooled: a building count (a farmstead is a house and a few
# outbuildings) and a span (a suburb is wide even when its buildings are not
# mapped). `landuse=farmyard` needs neither — it means what it says.
SMALL_RESIDENTIAL_BUILDINGS = 5
MAX_FARMYARD_SPAN_M = 400.0

# Ring simplification tolerance, in metres. A yard boundary is tested for
# point-in-polygon at metre scale, so 5 m of shape is far below what the answer
# turns on, and it keeps the shipped rings a handful of points each.
RING_TOLERANCE_M = 5.0

GEOFABRIK = {
    "LV": "europe/latvia",
    "LT": "europe/lithuania",
    "EE": "europe/estonia",
    "PL": "europe/poland",
    "DE": "europe/germany",
    "CH": "europe/switzerland",
    "AT": "europe/austria",
    "IT": "europe/italy",
    "SI": "europe/slovenia",
    "CZ": "europe/czech-republic",
    "FR": "europe/france",
    "ES": "europe/spain",
    "SK": "europe/slovakia",
    "HU": "europe/hungary",
    "NO": "europe/norway",
    "SE": "europe/sweden",
    "FI": "europe/finland",
    "DK": "europe/denmark",
    "NL": "europe/netherlands",
    "BE": "europe/belgium",
    "PT": "europe/portugal",
    "RO": "europe/romania",
    "BG": "europe/bulgaria",
    "HR": "europe/croatia",
    "RS": "europe/serbia",
    "GR": "europe/greece",
    "PL_": "europe/poland",
}

M_PER_DEG_LAT = 110540.0
M_PER_DEG_LON_EQ = 111320.0


def lon_scale(lat):
    """Metres per degree of longitude at this latitude."""
    return M_PER_DEG_LON_EQ * math.cos(math.radians(lat))


class TrackGrid:
    """Sampled points of every track/service way, binned for nearest lookup.

    Holds `(lon, lat, kind)` per cell, `kind` being "track" or "service" so a hit
    can report which class of way put it there. Memory is the reason this samples
    rather than storing full geometry: Latvia has ~180k track/service ways and the
    sampled form is a few million floats, which fits; a segment list with its own
    index would not be worth the extra structure at a 25 m radius.
    """

    def __init__(self):
        self.cells = {}
        self.points = 0

    def _key(self, lon, lat):
        return (int(math.floor(lon / CELL_DEG)), int(math.floor(lat / CELL_DEG)))

    def add_way(self, coords, kind):
        """Add a way's nodes plus interpolated points at most SAMPLE_M apart."""
        prev = None
        for lon, lat in coords:
            if prev is not None:
                # Interpolate along the segment so a long straight edge is not a
                # hole in the index.
                dx = (lon - prev[0]) * lon_scale(lat)
                dy = (lat - prev[1]) * M_PER_DEG_LAT
                length = math.hypot(dx, dy)
                steps = int(length // SAMPLE_M)
                for s in range(1, steps + 1):
                    t = (s * SAMPLE_M) / length
                    self._add(prev[0] + (lon - prev[0]) * t, prev[1] + (lat - prev[1]) * t, kind)
            self._add(lon, lat, kind)
            prev = (lon, lat)

    def _add(self, lon, lat, kind):
        self.cells.setdefault(self._key(lon, lat), []).append((lon, lat, kind))
        self.points += 1

    def near(self, lon, lat, radius_m):
        """The nearest way class within `radius_m`, or None.

        `service` wins ties with `track` only by being closer; the caller records
        whichever way actually put the building in the set, which is what the
        runtime penalty is keyed on.
        """
        cx, cy = self._key(lon, lat)
        best = None
        best_d = radius_m
        mx = lon_scale(lat)
        for ix in (cx - 1, cx, cx + 1):
            for iy in (cy - 1, cy, cy + 1):
                for plon, plat, kind in self.cells.get((ix, iy), ()):
                    dx = (plon - lon) * mx
                    dy = (plat - lat) * M_PER_DEG_LAT
                    d = math.hypot(dx, dy)
                    if d < best_d:
                        best_d = d
                        best = kind
        return best


def way_coords(way):
    """A way's node locations, skipping nodes clipped out of the extract."""
    out = []
    for node in way.nodes:
        if node.location.valid():
            out.append((node.location.lon, node.location.lat))
    return out


def area_centre(area):
    """Centroid of an area's outer ring nodes — the same rule the POI build uses."""
    lons, lats = [], []
    for ring in area.outer_rings():
        for node in ring:
            if node.location.valid():
                lons.append(node.location.lon)
                lats.append(node.location.lat)
    if not lons:
        return None
    return (sum(lons) / len(lons), sum(lats) / len(lats))


def ring_points(area):
    """The outer ring of an area as [(lon, lat), ...], or None.

    Multipolygons with several outer rings are reduced to the largest, because a
    yard test only needs the shape the route is inside; a farmstead mapped with
    two detached outer rings is vanishingly rare and the bigger one is the yard.
    """
    best = None
    best_span = -1.0
    for ring in area.outer_rings():
        pts = [(n.location.lon, n.location.lat) for n in ring if n.location.valid()]
        if len(pts) < 4:
            continue
        span = ring_span_m(pts)
        if span > best_span:
            best_span = span
            best = pts
    return best, best_span


def ring_span_m(pts):
    """Diagonal of a ring's bounding box, in metres."""
    lons = [p[0] for p in pts]
    lats = [p[1] for p in pts]
    mid = (min(lats) + max(lats)) / 2
    return math.hypot(
        (max(lons) - min(lons)) * lon_scale(mid),
        (max(lats) - min(lats)) * M_PER_DEG_LAT,
    )


def simplify_ring(pts, tolerance_m):
    """Douglas-Peucker on a metric frame, keeping the ring closed."""
    if len(pts) <= 5:
        return pts
    mid = sum(p[1] for p in pts) / len(pts)
    kx, ky = lon_scale(mid), M_PER_DEG_LAT

    def perp(p, a, b):
        ax, ay = a[0] * kx, a[1] * ky
        bx, by = b[0] * kx, b[1] * ky
        px, py = p[0] * kx, p[1] * ky
        dx, dy = bx - ax, by - ay
        l2 = dx * dx + dy * dy
        t = 0.0 if l2 == 0 else max(0.0, min(1.0, ((px - ax) * dx + (py - ay) * dy) / l2))
        return math.hypot(px - (ax + t * dx), py - (ay + t * dy))

    keep = [False] * len(pts)
    keep[0] = keep[-1] = True
    stack = [(0, len(pts) - 1)]
    while stack:
        i, j = stack.pop()
        worst, idx = 0.0, -1
        for k in range(i + 1, j):
            d = perp(pts[k], pts[i], pts[j])
            if d > worst:
                worst, idx = d, k
        if worst > tolerance_m and idx > 0:
            keep[idx] = True
            stack.append((i, idx))
            stack.append((idx, j))
    out = [p for p, k in zip(pts, keep) if k]
    if out[0] != out[-1]:
        out.append(out[0])
    return out


def pass_one(path):
    """Every track/service way's geometry, in a grid."""
    import osmium

    grid = TrackGrid()
    ways = 0
    fp = osmium.FileProcessor(path).with_locations().with_filter(osmium.filter.EmptyTagFilter())
    for obj in fp:
        if not obj.is_way():
            continue
        hw = obj.tags.get("highway")
        if hw not in YARD_HIGHWAYS:
            continue
        coords = way_coords(obj)
        if not coords:
            continue
        grid.add_way(coords, hw)
        ways += 1
    return grid, ways


def pass_two(path, grid, code):
    """Building centroids and barrier nodes that the grid says are on a yard way.

    `with_areas()` assembles closed ways and multipolygon relations into Area
    objects with real geometry, so a building mapped as a relation is not lost.
    Nodes still arrive as nodes, which is how the barriers are caught.
    """
    import osmium

    features = []
    yards = []
    seen = set()
    buildings_seen = 0

    fp = osmium.FileProcessor(path).with_areas().with_filter(osmium.filter.EmptyTagFilter())
    for obj in fp:
        tags = obj.tags
        if obj.is_node():
            barrier = tags.get("barrier")
            if barrier not in BARRIER_KINDS:
                continue
            lon, lat = obj.location.lon, obj.location.lat
            # A barrier node not on a track/service way is a gate across
            # something else — a field entrance off a main road, a bollard on a
            # cycleway — and the router will never meet it on a yard track.
            near = grid.near(lon, lat, 1.0)
            if near is None:
                continue
            ident = f"n{obj.id}"
            if ident in seen:
                continue
            seen.add(ident)
            features.append(
                {
                    "type": "Feature",
                    "geometry": {"type": "Point", "coordinates": [round(lon, 5), round(lat, 5)]},
                    "properties": {
                        "id": ident,
                        "kind": "gate",
                        "nearHighway": near,
                        "barrier": barrier,
                        "country": code,
                    },
                }
            )
            continue

        if obj.is_area():
            landuse = tags.get("landuse")
            if landuse in ("farmyard", "residential"):
                pts, span = ring_points(obj)
                if pts is None:
                    continue
                # A kilometre-wide `landuse=residential` is a suburb, and a route
                # through one is a public street. `farmyard` means what it says,
                # so it is only span-checked; residential must also be small
                # enough to be one homestead, which pass 3 counts.
                if span > MAX_FARMYARD_SPAN_M:
                    continue
                # Only yards a route could actually enter: a farmyard with no
                # track or service way near it is somebody's land that no route
                # of ours will ever touch, and shipping it costs bytes for
                # nothing.
                if grid.near(sum(p[0] for p in pts) / len(pts),
                             sum(p[1] for p in pts) / len(pts),
                             span / 2 + NEAR_M) is None:
                    continue
                kind = "w" if obj.from_way() else "r"
                ident = f"{kind}{obj.orig_id()}"
                if ident in seen:
                    continue
                seen.add(ident)
                yards.append(
                    {
                        "id": ident,
                        "landuse": landuse,
                        "ring": [[round(x, 5), round(y, 5)] for x, y in simplify_ring(pts, RING_TOLERANCE_M)],
                    }
                )
                continue

            if "building" not in tags:
                continue
            buildings_seen += 1
            point = area_centre(obj)
            if point is None:
                continue
            near = grid.near(point[0], point[1], NEAR_M)
            if near is None:
                continue
            kind = "w" if obj.from_way() else "r"
            ident = f"{kind}{obj.orig_id()}"
            if ident in seen:
                continue
            seen.add(ident)
            features.append(
                {
                    "type": "Feature",
                    "geometry": {
                        "type": "Point",
                        "coordinates": [round(point[0], 5), round(point[1], 5)],
                    },
                    "properties": {
                        "id": ident,
                        "kind": "building",
                        "nearHighway": near,
                        "country": code,
                    },
                }
            )

    return features, yards, buildings_seen


def point_in_ring(lon, lat, ring):
    """Ray casting; `ring` is a closed list of [lon, lat]."""
    inside = False
    n = len(ring)
    j = n - 1
    for i in range(n):
        xi, yi = ring[i]
        xj, yj = ring[j]
        if (yi > lat) != (yj > lat):
            x = xi + (lat - yi) * (xj - xi) / (yj - yi)
            if lon < x:
                inside = not inside
        j = i
    return inside


def filter_yards(yards, building_features):
    """Keep farmyards, and residential polygons holding few enough buildings.

    `landuse=residential` covers both a single homestead and a village centre,
    and only the first is a yard — a route through the second is a public
    street, which is the false positive the rider named. The discriminator is
    how many buildings the polygon holds.

    Only buildings already collected (those near a track/service way) are
    counted, which under-counts a dense village slightly. That errs the safe
    way for a *village*: a village has more than five such buildings long before
    the true count matters, so it is still rejected.
    """
    bins = {}
    for f in building_features:
        if f["properties"]["kind"] != "building":
            continue
        lon, lat = f["geometry"]["coordinates"]
        bins.setdefault((int(math.floor(lon / CELL_DEG)), int(math.floor(lat / CELL_DEG))), []).append((lon, lat))

    kept = []
    for y in yards:
        ring = y["ring"]
        lons = [p[0] for p in ring]
        lats = [p[1] for p in ring]
        count = 0
        for ix in range(int(math.floor(min(lons) / CELL_DEG)), int(math.floor(max(lons) / CELL_DEG)) + 1):
            for iy in range(int(math.floor(min(lats) / CELL_DEG)), int(math.floor(max(lats) / CELL_DEG)) + 1):
                for lon, lat in bins.get((ix, iy), ()):
                    if point_in_ring(lon, lat, ring):
                        count += 1
        if y["landuse"] == "residential" and count > SMALL_RESIDENTIAL_BUILDINGS:
            continue
        kept.append(
            {
                "type": "Feature",
                "geometry": {"type": "Polygon", "coordinates": [ring]},
                "properties": {
                    "id": y["id"],
                    "kind": "yard",
                    "landuse": y["landuse"],
                    "buildings": count,
                },
            }
        )
    return kept


def build(pbf, code, out_path):
    import osmium  # noqa: F401  — fail here with a clear error, not mid-pass

    started = time.time()
    size_mb = os.path.getsize(pbf) / 1024 / 1024
    print(f"[{code}] {os.path.basename(pbf)} ({size_mb:.0f} MB)")

    t0 = time.time()
    grid, ways = pass_one(pbf)
    t1 = time.time()
    print(
        f"[{code}] pass 1: {ways:,} track/service ways → "
        f"{grid.points:,} sampled points in {len(grid.cells):,} cells ({t1 - t0:.0f}s)"
    )

    features, yards, buildings = pass_two(pbf, grid, code)
    t2 = time.time()
    n_building = sum(1 for f in features if f["properties"]["kind"] == "building")
    n_gate = len(features) - n_building
    share = (100.0 * n_building / buildings) if buildings else 0.0
    print(
        f"[{code}] pass 2: {buildings:,} buildings scanned, {n_building:,} within "
        f"{NEAR_M:.0f} m of a track/service way ({share:.1f}%), {n_gate:,} gates, "
        f"{len(yards):,} candidate yard polygons ({t2 - t1:.0f}s)"
    )

    # A `landuse=residential` polygon is a homestead only when it holds a
    # homestead's worth of buildings. The count is done here rather than in
    # pass 2 because the buildings are already collected and binned by then, so
    # it costs a grid walk instead of a third read of the file.
    kept_yards = filter_yards(yards, features)
    t3 = time.time()
    features.extend(kept_yards)
    print(
        f"[{code}] yards: {len(kept_yards):,} kept of {len(yards):,} "
        f"({sum(1 for y in kept_yards if y['properties']['landuse'] == 'farmyard'):,} farmyard, "
        f"{sum(1 for y in kept_yards if y['properties']['landuse'] == 'residential'):,} small residential) "
        f"({t3 - t2:.0f}s)"
    )

    for f in features:
        f["properties"]["country"] = code

    counts = {}
    for f in features:
        props = f["properties"]
        key = (props["kind"], props.get("nearHighway") or props.get("landuse") or "-")
        counts[key] = counts.get(key, 0) + 1

    # Packed arrays, not GeoJSON features.
    #
    # Measured on Latvia: 248,488 buildings plus 13,529 gates are 42.9 MB as
    # minified GeoJSON and **5.4 MB** as `[lon, lat, nearHighway]` triples. The
    # per-feature `type`/`geometry`/`properties` scaffolding is eight times the
    # payload, and the loader parses this on a cold serverless invocation, so
    # the scaffolding is the whole cost. Ids are dropped with it: nothing joins
    # on them — the runtime asks "is there a building here", never "which one".
    #
    # Yard rings keep their coordinates because the shape is the information.
    os.makedirs(os.path.dirname(out_path) or ".", exist_ok=True)
    payload = {
        "country": code,
        "nearMeters": NEAR_M,
        "source": "geofabrik",
        "builtAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        # [lon, lat, 0=near track | 1=near service]
        "buildings": [
            [f["geometry"]["coordinates"][0], f["geometry"]["coordinates"][1],
             0 if f["properties"]["nearHighway"] == "track" else 1]
            for f in features if f["properties"]["kind"] == "building"
        ],
        "gates": [
            [f["geometry"]["coordinates"][0], f["geometry"]["coordinates"][1],
             0 if f["properties"]["nearHighway"] == "track" else 1]
            for f in features if f["properties"]["kind"] == "gate"
        ],
        # {landuse: "farmyard"|"residential", buildings: n, ring: [[lon,lat],...]}
        "yards": [
            {
                "landuse": f["properties"]["landuse"],
                "buildings": f["properties"]["buildings"],
                "ring": f["geometry"]["coordinates"][0],
            }
            for f in features if f["properties"]["kind"] == "yard"
        ],
    }
    with open(out_path, "w", encoding="utf-8") as fh:
        json.dump(payload, fh, separators=(",", ":"))
    out_kb = os.path.getsize(out_path) / 1024

    for (kind, detail), n in sorted(counts.items()):
        print(f"[{code}]   {kind:8} {detail:12} {n:,}")
    print(
        f"[{code}] DONE {len(features):,} points → {out_path} ({out_kb:.0f} KB) "
        f"in {time.time() - started:.0f}s"
    )
    return features


def download(code, work_dir):
    path = GEOFABRIK.get(code)
    if not path:
        raise SystemExit(f"no Geofabrik path known for {code} — add it to GEOFABRIK")
    url = f"https://download.geofabrik.de/{path}-latest.osm.pbf"
    os.makedirs(work_dir, exist_ok=True)
    dest = os.path.join(work_dir, f"{code}.osm.pbf")
    print(f"[{code}] downloading {url}")
    t0 = time.time()
    subprocess.run(["curl", "-fsSL", "--retry", "3", "--retry-delay", "10", "-o", dest, url], check=True)
    print(f"[{code}] downloaded {os.path.getsize(dest) / 1024 / 1024:.0f} MB in {time.time() - t0:.0f}s")
    return dest


def main():
    args = sys.argv[1:]

    def option(flag, default=None):
        return args[args.index(flag) + 1] if flag in args and args.index(flag) + 1 < len(args) else default

    pbf = option("--pbf")
    out = option("--out")
    country = option("--country")
    work = option("--work", os.environ.get("YARD_WORK", "/tmp/yard-pbf"))
    keep = "--keep-pbf" in args

    if pbf:
        if not country:
            raise SystemExit("--pbf needs --country CC")
        build(pbf, country, out or f"data/yards-{country}.geojson")
        return

    codes = [a.upper() for a in args if not a.startswith("--") and len(a) == 2]
    # Skip the value of --country/--out/--work if it happened to look like a code.
    codes = [c for c in codes if c not in {str(option("--work")), str(out)}]
    if not codes:
        raise SystemExit(
            "usage: build_yard_dataset.py LV [LT ...]\n"
            "   or: build_yard_dataset.py --pbf FILE.osm.pbf --country CC [--out PATH]"
        )

    for code in codes:
        dest = download(code, work)
        try:
            build(dest, code, out or f"data/yards-{code}.geojson")
        finally:
            if not keep:
                os.remove(dest)
                print(f"[{code}] extract deleted")


if __name__ == "__main__":
    main()
