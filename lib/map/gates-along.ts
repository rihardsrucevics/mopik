import { haversineMeters } from "@/lib/geo/geometry";
import type { GateInfo } from "@/lib/types";

/**
 * Every gate on a ride, with how far along the ride it stands.
 *
 * The gate card („Vārti · 37,2 km no starta”), the segment card and the RISKI
 * list all name a gate by its kilometre, so the three must count it the same
 * way: along the drawn segments, in ride order, from the first vertex of the
 * first one. A gate is a vertex of the route geometry (`classify.ts` matches it
 * so), which makes its position the length of the line up to that vertex — no
 * projection, nothing estimated.
 */
export type GateOnRide = {
  point: [number, number];
  /** metres from the start of the ride, along the line */
  alongMeters: number;
  /** index of the segment feature it sits on */
  segmentIndex: number;
  /** OSM facts; absent on segments built before the gate card (a saved ride) */
  info?: GateInfo;
};

type SegmentLike = {
  geometry: { coordinates: number[][] };
  properties?: { gatePoints?: [number, number][]; gateInfo?: GateInfo[] } | null;
};

export function gatesAlong(features: readonly SegmentLike[]): GateOnRide[] {
  const out: GateOnRide[] = [];
  let walked = 0;
  features.forEach((f, segmentIndex) => {
    const coords = f.geometry.coordinates as [number, number][];
    const cum: number[] = [0];
    for (let i = 1; i < coords.length; i++) cum.push(cum[i - 1] + haversineMeters(coords[i - 1], coords[i]));
    const points = f.properties?.gatePoints ?? [];
    points.forEach((point, k) => {
      // The vertex the gate IS. Nearest rather than equal, because a line
      // that went through a share code or a splice can differ from the
      // gate's own coordinate by rounding.
      let best = 0;
      let bestD = Infinity;
      for (let i = 0; i < coords.length; i++) {
        const d = haversineMeters(coords[i], point);
        if (d < bestD) { bestD = d; best = i; }
      }
      const info = f.properties?.gateInfo?.[k];
      out.push({ point, alongMeters: walked + (cum[best] ?? 0), segmentIndex, ...(info ? { info } : {}) });
    });
    walked += cum[cum.length - 1] ?? 0;
  });
  return out;
}

/** Half the length of the stretch highlighted round a tapped gate: ~50 m in all. */
export const GATE_HIGHLIGHT_HALF_M = 25;

/**
 * The ~50 m of line round one gate, for the yellow highlight.
 *
 * Cut from the whole ride rather than from the gate's own segment, so a gate
 * near a segment's end still gets 25 m on both sides.
 */
export function gateHighlightLine(
  features: readonly SegmentLike[],
  alongMeters: number,
  halfMeters = GATE_HIGHLIGHT_HALF_M
): [number, number][] {
  const line: [number, number][] = [];
  features.forEach((f, i) => {
    const coords = f.geometry.coordinates as [number, number][];
    line.push(...(i === 0 ? coords : coords.slice(1)));
  });
  if (line.length < 2) return [];
  const from = Math.max(0, alongMeters - halfMeters);
  const to = alongMeters + halfMeters;
  const out: [number, number][] = [];
  let walked = 0;
  for (let i = 1; i < line.length; i++) {
    const a = line[i - 1], b = line[i];
    const len = haversineMeters(a, b);
    const s = walked, e = walked + len;
    walked = e;
    if (e < from || s > to || len === 0) continue;
    const at = (m: number): [number, number] => {
      const t = Math.min(1, Math.max(0, (m - s) / len));
      return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
    };
    if (!out.length) out.push(at(Math.max(from, s)));
    out.push(at(Math.min(to, e)));
  }
  return out.length >= 2 ? out : [];
}

/** The node on openstreetmap.org — only for an id OSM gave us. */
export const osmNodeUrl = (id: number): string => `https://www.openstreetmap.org/node/${id}`;
