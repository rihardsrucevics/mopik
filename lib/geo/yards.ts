/**
 * @deprecated Compatibility shim. The real module is `lib/geo/gates.ts`.
 *
 * Backlog item 12 shipped a yard-inference dataset — building centroids,
 * `landuse=farmyard` rings and small `landuse=residential` rings — and
 * `classify.ts` inferred "this road goes through somebody's yard" from buildings
 * on both sides of the way, from polygon containment, and from dead-ending at a
 * building cluster. The rider rejected the approach itself:
 *
 *   "šī pieeja nav korekta — mēs nevaram minēt; vairumā gadījumu tur nebūs
 *   ierobežojuma; ja mums nav datu par privātajiem ceļiem, labāk šo ceļu no
 *   maršruta neizslēgt. Sākam vismaz ar vārtiem."
 *
 * We cannot guess. In most cases there is no restriction there, and with no data
 * about private roads it is better to leave the road in the route than to take it
 * out. Start with gates.
 *
 * So the buildings and the polygons are gone, along with the 9.4 MB of
 * `public/yards/` they needed, and what remains is the one explicit OSM fact:
 * a `barrier=*` node that is a member of a `highway=track|service|unclassified`
 * way. That lives in `lib/geo/gates.ts` and `public/gates/`.
 *
 * ## What this file does until `classify.ts` moves
 *
 * `lib/routing/classify.ts` is another agent's file right now and still imports
 * from here, so this shim keeps the build green with honest behaviour rather
 * than a lie:
 *
 * - `gatesAlong` is real — it reads the gate dataset through `lib/geo/gates.ts`.
 * - `buildingsAlong` returns `[]` and `yardAt` returns `null`, always. The data
 *   they answered from no longer exists and, per the rider, must not be guessed
 *   at. `classify.ts`'s `bothSides`, `yard` and `deadEnd` rules therefore never
 *   fire, `yardKm` counts only gate stretches, and no route is changed — which
 *   was already true, since the measurement was information only.
 * - `size` reports the gate count, so the `!lookup.size` early return still
 *   short-circuits a ride with no data.
 *
 * ## Follow-up: delete this file
 *
 * The owner of `lib/routing/classify.ts` should replace
 *
 *   import { bboxOf, yardLookup, BOTH_SIDES_M, YARD_RADIUS_M, type YardLookup } from "@/lib/geo/yards";
 *
 * with `bboxOf`, `gateLookup`/`gatesOnRoute`, `GATE_RADIUS_M` and `GateLookup`
 * from `@/lib/geo/gates`, drop `measureYards`' rules (a) (b) (c) and report a
 * gate **count** rather than kilometres — a gate is a point, and "Vārti uz ceļa
 * · N" is the product decision. `quality.yardKm` / `yardEdgeCount` /
 * `yardByRule` in `lib/types.ts` go with them. Then delete this file and
 * `scripts/yards.test.ts`.
 */

import {
  bboxOf as gatesBBoxOf,
  gateLookup,
  hasGateData,
  resetGateCache,
  segmentDistanceM as gatesSegmentDistanceM,
  type BBox as GateBBox,
} from "./gates";

/** [minLon, minLat, maxLon, maxLat] */
export type BBox = GateBBox;

/**
 * @deprecated The building-proximity radius. Nothing reads buildings any more;
 * it is kept only so `classify.ts` keeps compiling, and is passed to
 * `gatesAlong` where it is a harmless upper bound (a gate is a node *of* the
 * way, so it is metres from the line, not tens of metres).
 */
export const YARD_RADIUS_M = 25;

/** @deprecated The "buildings on both sides" half-width. The rule is gone. */
export const BOTH_SIDES_M = 20;

/** @deprecated Buildings are no longer collected; nothing produces this. */
export type YardPoint = {
  lon: number;
  lat: number;
  kind: "building" | "gate";
  nearHighway: "track" | "service";
  country: string;
};

/** @deprecated Farmyard polygons are no longer collected; nothing produces this. */
export type YardPolygon = {
  landuse: "farmyard" | "residential";
  ring: [number, number][];
  buildings: number;
  bbox: BBox;
  country: string;
};

/** @deprecated Use `GateLookup` from `lib/geo/gates.ts`. */
export type YardLookup = {
  /** the number of gates loadable for this box — buildings no longer exist */
  size: number;
  /** always `[]`: the building dataset is gone and must not be guessed at */
  buildingsAlong: (
    a: [number, number],
    b: [number, number],
    radiusM?: number
  ) => { point: YardPoint; offsetM: number }[];
  /** always `null`: farmyard polygons are gone and must not be guessed at */
  yardAt: (lon: number, lat: number) => YardPolygon | null;
  /** real: the gates on this stretch, from `public/gates/` */
  gatesAlong: (a: [number, number], b: [number, number], radiusM?: number) => YardPoint[];
};

const EMPTY_LOOKUP: YardLookup = {
  size: 0,
  buildingsAlong: () => [],
  yardAt: () => null,
  gatesAlong: () => [],
};

/** @deprecated Use `gateLookup` from `lib/geo/gates.ts`. */
export function yardLookup(bbox: BBox): YardLookup {
  const gates = gateLookup(bbox);
  if (!gates.size) return EMPTY_LOOKUP;

  return {
    size: gates.size,
    buildingsAlong: () => [],
    yardAt: () => null,
    gatesAlong: (a, b, radiusM) =>
      gates.gatesNear(a, b, radiusM).map((g) => ({
        lon: g.lon,
        lat: g.lat,
        kind: "gate" as const,
        // The old shape knew only track and service. `unclassified` gates are
        // reported as `track`, which is the closer of the two and is read by
        // nothing: `classify.ts` only counts `gatesAlong(...).length`.
        nearHighway: g.highway === "service" ? ("service" as const) : ("track" as const),
        country: g.country,
      })),
  };
}

/** @deprecated Use `bboxOf` from `lib/geo/gates.ts`. */
export const bboxOf = gatesBBoxOf;

/** @deprecated Use `segmentDistanceM` from `lib/geo/gates.ts`. */
export const segmentDistanceM = gatesSegmentDistanceM;

/** @deprecated Use `hasGateData` from `lib/geo/gates.ts`. */
export function hasYardData(bbox: BBox): boolean {
  return hasGateData(bbox);
}

/** @deprecated Use `resetGateCache` from `lib/geo/gates.ts`. */
export function resetYardCache(): void {
  resetGateCache();
}

/**
 * @deprecated Signed side-of-the-way offset — the primitive the "both sides"
 * rule rested on. Nothing calls it now that the rule is gone; kept only so an
 * import of it does not break the build before `classify.ts` moves.
 */
export function signedOffsetM(
  p: [number, number],
  a: [number, number],
  b: [number, number],
  scale: { kx: number; ky: number }
): number {
  const px = p[0] * scale.kx, py = p[1] * scale.ky;
  const ax = a[0] * scale.kx, ay = a[1] * scale.ky;
  const bx = b[0] * scale.kx, by = b[1] * scale.ky;
  const dx = bx - ax, dy = by - ay;
  const len = Math.hypot(dx, dy);
  if (len === 0) return Math.hypot(px - ax, py - ay);
  return ((px - ax) * dy - (py - ay) * dx) / len * -1;
}

/** @deprecated Ray casting for a farmyard ring. No rings ship any more. */
export function pointInRing(lon: number, lat: number, ring: [number, number][]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > lat !== yj > lat) {
      const x = xi + ((lat - yi) * (xj - xi)) / (yj - yi);
      if (lon < x) inside = !inside;
    }
  }
  return inside;
}
