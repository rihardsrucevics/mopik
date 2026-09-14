#!/usr/bin/env python3
"""Gates on tracks → `data/gates-<CC>.json`.

    .venv/bin/python scripts/build_gates_dataset.py --pbf latvia-latest.osm.pbf --country LV
    .venv/bin/python scripts/build_gates_dataset.py LV LT EE     # download + build each

Backlog item 12, "routes run through private property". This file is the
**second** answer to that item; the first one was rejected by the rider and the
reason is the whole design of this one.

## What was tried, and why it is gone

`docs/private-property-options.md` measured the problem and recommended
inferring a private yard from OSM's circumstantial evidence, because OSM in
rural Latvia records almost nothing explicit: across six rides, 187 route edges
ran within 25 m of a building and between them carried **one**
`motor_vehicle=destination`, two `access=permissive`, two
`motor_vehicle=permissive` and one `motor_vehicle=yes` — zero `private`, zero
`no`, `noexit` on none. So a first version shipped buildings, `landuse=farmyard`
rings and small `landuse=residential` rings, and `classify.ts` inferred a yard
from buildings on both sides of the way, from being inside a farmyard polygon,
and from dead-ending at a building cluster.

The rider refused the approach itself, not the thresholds:

    "šī pieeja nav korekta — mēs nevaram minēt; vairumā gadījumu tur nebūs
    ierobežojuma; ja mums nav datu par privātajiem ceļiem, labāk šo ceļu no
    maršruta neizslēgt. Sākam vismaz ar vārtiem."

("This approach is not correct — we cannot guess; in most cases there will be no
restriction there; if we have no data about private roads, better not to exclude
the road from the route. Let us start at least with gates.")

The data agreed with him before he said it. Latvia's build produced **248,488
buildings within 25 m of a track or service way** — not the "few thousand" the
options paper estimated — and 90 % of them sat beside a `service` way, 16 % of
the whole file inside a box around greater Rīga: apartment blocks beside parking
access roads. Every inference built on that is a guess about somebody's property
rights made from a building footprint.

## What this builds instead

One explicit OSM fact, and nothing else:

**A `barrier=gate|lift_gate|swing_gate|chain|bollard|cattle_grid` node that is a
member of a `highway=track|service|unclassified` way.**

Not "near" — *on*. Membership in the way's node list, which is OSM stating that
this gate is across this road. No proximity radius, no polygon, no topology
guess. `barrier=kerb` is deliberately excluded: a kerb is not access control,
and the investigation touched two of them on ordinary street in Cēsis.

`unclassified` is included alongside track and service because Latvian rural
gravel roads are `highway=unclassified` and a gate across one is the same fact
as a gate across a track. It costs a little size and no correctness: the output
is information, never a routing decision.

## What it is used for

Nothing routes differently because of this file. `lib/geo/gates.ts` loads it and
`lib/routing/classify.ts` reports a count — "Vārti uz ceļa · N" — and, later, a
small map marker. A gate on a Latvian forest track stands open more often than
not, which is exactly why it is reported and not avoided.

## One pass

A `.pbf` is ordered nodes → ways → relations, so barrier nodes are all seen
before any way that could contain them: pass 1 of the old two-pass build is gone
with the buildings it existed to place. `with_areas()` is gone too — a gate is
always a node, never a polygon — and that was the expensive part of the old
build (Latvia: 750 s; this runs in a fraction of it).

Idempotent: re-running overwrites `data/gates-<CC>.json` and touches nothing
else. Run countries one at a time and delete each extract afterwards — disk is
the constraint, not CPU (Germany's extract is 4.5 GB).
"""

import json
import os
import subprocess
import sys
import time

# The barriers that mean somebody controls this road. `kerb` is excluded on
# purpose (it is street furniture, not access control), and so is `cycle_barrier`
# and the rest of the long tail — a motorcycle rider cares about a thing that can
# be shut across the way.
BARRIER_KINDS = ("gate", "lift_gate", "swing_gate", "chain", "bollard", "cattle_grid")

# The way classes a gate is worth reporting on. `track` and `service` are the
# farm and yard roads the rider complained about; `unclassified` is the Latvian
# rural gravel road, where a gate is the same fact. Everything bigger is a public
# road whose gates are level crossings and toll barriers.
GATE_HIGHWAYS = ("track", "service", "unclassified")

# Packed as [lon, lat, barrierIndex, highwayIndex] — see `lib/geo/gates.ts`.
BARRIER_INDEX = {name: i for i, name in enumerate(BARRIER_KINDS)}
HIGHWAY_INDEX = {name: i for i, name in enumerate(GATE_HIGHWAYS)}

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
}


def collect(path, code):
    """Every barrier node that is a member of a track/service/unclassified way.

    Returns `(gates, stats)`; `gates` is a list of `[lon, lat, barrier, highway]`
    with the last two as indices into BARRIER_KINDS / GATE_HIGHWAYS.

    One pass. The `.pbf` ordering (nodes, then ways) is what makes that possible:
    every barrier node's location is known by the time a way can reference it.
    A node carried by no matching way is dropped at the end — a gate on a
    footpath or across a field entrance off a main road is a real gate, but not
    one this router will ever meet on a road it rides.
    """
    import osmium

    barriers = {}
    stats = {"barrier_nodes": 0, "ways": 0}

    fp = osmium.FileProcessor(path).with_filter(osmium.filter.EmptyTagFilter())
    for obj in fp:
        if obj.is_node():
            kind = obj.tags.get("barrier")
            if kind not in BARRIER_INDEX:
                continue
            stats["barrier_nodes"] += 1
            barriers[obj.id] = (
                round(obj.location.lon, 5),
                round(obj.location.lat, 5),
                BARRIER_INDEX[kind],
            )
            continue

        if not obj.is_way():
            continue
        hw = obj.tags.get("highway")
        if hw not in HIGHWAY_INDEX:
            continue
        stats["ways"] += 1
        hw_index = HIGHWAY_INDEX[hw]
        for node in obj.nodes:
            hit = barriers.get(node.ref)
            if hit is None:
                continue
            # A gate can sit on a track and a service way at once (they share the
            # node). The first way to claim it wins: the class is context, not a
            # verdict, and the order GATE_HIGHWAYS lists is the order that
            # matters least to most.
            if len(hit) == 4:
                continue
            barriers[node.ref] = (hit[0], hit[1], hit[2], hw_index)

    gates = sorted(
        (list(v) for v in barriers.values() if len(v) == 4),
        key=lambda g: (g[1], g[0]),
    )
    return gates, stats


def build(pbf, code, out_path):
    import osmium  # noqa: F401  — fail here with a clear error, not mid-pass

    started = time.time()
    size_mb = os.path.getsize(pbf) / 1024 / 1024
    print(f"[{code}] {os.path.basename(pbf)} ({size_mb:.0f} MB)")

    gates, stats = collect(pbf, code)

    by_barrier = {}
    by_highway = {}
    for _, _, b, h in gates:
        by_barrier[BARRIER_KINDS[b]] = by_barrier.get(BARRIER_KINDS[b], 0) + 1
        by_highway[GATE_HIGHWAYS[h]] = by_highway.get(GATE_HIGHWAYS[h], 0) + 1

    os.makedirs(os.path.dirname(out_path) or ".", exist_ok=True)
    payload = {
        "country": code,
        "source": "geofabrik",
        "builtAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "barrierKinds": list(BARRIER_KINDS),
        "highwayKinds": list(GATE_HIGHWAYS),
        # [lon, lat, barrierIndex, highwayIndex]
        "gates": gates,
    }
    with open(out_path, "w", encoding="utf-8") as fh:
        json.dump(payload, fh, separators=(",", ":"))
    out_kb = os.path.getsize(out_path) / 1024

    print(
        f"[{code}] {stats['barrier_nodes']:,} barrier nodes scanned, "
        f"{stats['ways']:,} track/service/unclassified ways, "
        f"{len(gates):,} gates ON one of them"
    )
    for name in BARRIER_KINDS:
        if by_barrier.get(name):
            print(f"[{code}]   barrier  {name:12} {by_barrier[name]:,}")
    for name in GATE_HIGHWAYS:
        if by_highway.get(name):
            print(f"[{code}]   highway  {name:12} {by_highway[name]:,}")
    print(
        f"[{code}] DONE {len(gates):,} gates → {out_path} ({out_kb:.0f} KB) "
        f"in {time.time() - started:.0f}s"
    )
    return gates


def download(code, work_dir):
    path = GEOFABRIK.get(code)
    if not path:
        raise SystemExit(f"no Geofabrik path known for {code} — add it to GEOFABRIK")
    url = f"https://download.geofabrik.de/{path}-latest.osm.pbf"
    os.makedirs(work_dir, exist_ok=True)
    dest = os.path.join(work_dir, f"{code}.osm.pbf")
    print(f"[{code}] downloading {url}")
    t0 = time.time()
    subprocess.run(
        ["curl", "-fsSL", "--retry", "3", "--retry-delay", "10", "-o", dest, url], check=True
    )
    print(f"[{code}] downloaded {os.path.getsize(dest) / 1024 / 1024:.0f} MB in {time.time() - t0:.0f}s")
    return dest


def main():
    args = sys.argv[1:]

    def option(flag, default=None):
        return args[args.index(flag) + 1] if flag in args and args.index(flag) + 1 < len(args) else default

    pbf = option("--pbf")
    out = option("--out")
    country = option("--country")
    work = option("--work", os.environ.get("GATE_WORK", "/tmp/gate-pbf"))
    keep = "--keep-pbf" in args

    if pbf:
        if not country:
            raise SystemExit("--pbf needs --country CC")
        build(pbf, country, out or f"data/gates-{country}.json")
        return

    codes = [a.upper() for a in args if not a.startswith("--") and len(a) == 2]
    # Skip the value of --country/--out/--work if it happened to look like a code.
    codes = [c for c in codes if c not in {str(option("--work")), str(out)}]
    if not codes:
        raise SystemExit(
            "usage: build_gates_dataset.py LV [LT ...]\n"
            "   or: build_gates_dataset.py --pbf FILE.osm.pbf --country CC [--out PATH]"
        )

    for code in codes:
        dest = download(code, work)
        try:
            build(dest, code, out or f"data/gates-{code}.json")
        finally:
            if not keep:
                os.remove(dest)
                print(f"[{code}] extract deleted")


if __name__ == "__main__":
    main()
