"""Geometry-only GPX audit: python3 scripts/audit-gpx.py ride.gpx [...].
Exact undirected edges rounded to 5 decimals; not map matching or surface inference.
"""
import json
import math
import sys
import xml.etree.ElementTree as ET
from pathlib import Path


def km(a, b):
    la, lo, lb, lob = map(math.radians, (*a, *b))
    h = math.sin((lb-la)/2)**2 + math.cos(la)*math.cos(lb)*math.sin((lob-lo)/2)**2
    return 12742 * math.asin(min(1, math.sqrt(h)))


def audit(filename):
    root = ET.parse(filename).getroot()
    segments = [[(float(p.attrib['lat']), float(p.attrib['lon'])) for p in s.findall('{*}trkpt')]
                for s in root.findall('.//{*}trkseg')]
    points = [p for s in segments for p in s]
    seen, reversals = set(), []
    total = repeated = 0
    for segment in segments:
        for i in range(1, len(segment)):
            a, b = segment[i-1], segment[i]
            length = km(a, b)
            total += length
            edge = tuple(sorted(tuple(round(x, 5) for x in p) for p in (a, b)))
            if edge in seen:
                repeated += length
            seen.add(edge)
            if i + 1 < len(segment) and a == segment[i+1] and length > 0:
                n, out_km = 0, 0
                while i-n-1 >= 0 and i+n+1 < len(segment) and segment[i-n-1] == segment[i+n+1]:
                    out_km += km(segment[i-n], segment[i-n-1])
                    n += 1
                reversals.append({'atKm': round(total, 2), 'latLon': b, 'outAndBackKm': round(2*out_km, 2)})
    return {'file': Path(filename).name, 'points': len(points), 'segments': len(segments),
            'km': round(total, 2), 'repeatedKm': round(repeated, 2),
            'repeatedPercent': round(100*repeated/total, 1) if total else 0,
            'closureKm': round(km(points[0], points[-1]), 2) if points else None,
            'reversals': reversals}


if __name__ == '__main__':
    print(json.dumps([audit(f) for f in sys.argv[1:]], indent=2))
