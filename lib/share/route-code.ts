import type { GeneratedRoute, RoadClass, RouteSegmentProperties, SurfaceClass } from "@/lib/types";
import { RidePlanSchema, type RidePlan } from "@/lib/chat/ride-plan";

/**
 * A route as a link, with no database behind it.
 *
 * Everything the shared page needs travels in the URL itself: the name and
 * numbers, the line simplified to ~10 m, and the surface class of every
 * stretch, so the page can draw the same colours the app draws. Measured on
 * a 108 km Baldone ride: 2748 points → 518 at 10 m, ~2.1 KB of URL, which
 * every messenger passes intact. The link therefore works forever, costs
 * nothing to keep, and needs no account. Only URL-safe characters are used
 * (`A–Z a–z 0–9 - _ ~ .`), so nothing is percent-encoded on the way.
 *
 * Format: `1~<meta>~<coords>~<classes>[~<plan>]`
 *   meta    base64url(JSON): name, variant, km, minutes, unpaved, repeated,
 *           start label, class dictionary
 *   coords  varint-encoded lat/lon deltas at 1e-5° (like Google's polyline,
 *           but on a URL-safe 6-bit alphabet)
 *   classes run-length list of dictionary indices, one per stretch
 *   plan    base64url(JSON) of the plan that produced it, for "Ģenerēt līdzīgu"
 */
export const SHARE_VERSION = "1";
export const SIMPLIFY_TOLERANCE_M = 10;
export const MAX_POINTS = 700;

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
const INDEX: Record<string, number> = Object.fromEntries([...ALPHABET].map((c, i) => [c, i]));

/** Zigzag + 5-bit continuation chunks on the 64-symbol alphabet. */
function encodeVarints(values: number[]): string {
  let out = "";
  for (const v of values) {
    let s = v < 0 ? ~(v << 1) : v << 1;
    while (s >= 0x20) { out += ALPHABET[0x20 | (s & 0x1f)]; s >>= 5; }
    out += ALPHABET[s];
  }
  return out;
}
function decodeVarints(text: string): number[] {
  const out: number[] = [];
  let shift = 0, acc = 0;
  for (const ch of text) {
    const b = INDEX[ch];
    if (b === undefined) throw new Error("bad symbol");
    acc |= (b & 0x1f) << shift;
    if (b & 0x20) { shift += 5; continue; }
    out.push(acc & 1 ? ~(acc >> 1) : acc >> 1);
    shift = 0; acc = 0;
  }
  return out;
}

/** base64url without padding, isomorphic (browser and Node). */
function toBase64Url(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  const b64 = typeof btoa === "function" ? btoa(bin) : Buffer.from(bin, "binary").toString("base64");
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function fromBase64Url(text: string): string {
  const b64 = text.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (text.length % 4)) % 4);
  const bin = typeof atob === "function" ? atob(b64) : Buffer.from(b64, "base64").toString("binary");
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

type Pt = [number, number]; // [lon, lat]

/** Douglas–Peucker on an equirectangular metre grid; returns kept indices. */
export function simplifyIndices(points: Pt[], toleranceM: number): number[] {
  if (points.length < 3) return points.map((_, i) => i);
  const lat0 = (points[0][1] * Math.PI) / 180;
  const kx = 111320 * Math.cos(lat0), ky = 110540;
  const dist = (p: Pt, a: Pt, b: Pt) => {
    const ax = a[0] * kx, ay = a[1] * ky, bx = b[0] * kx, by = b[1] * ky, px = p[0] * kx, py = p[1] * ky;
    const dx = bx - ax, dy = by - ay, L = dx * dx + dy * dy;
    const t = L === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / L));
    return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
  };
  const keep = new Array<boolean>(points.length).fill(false);
  keep[0] = keep[points.length - 1] = true;
  const stack: [number, number][] = [[0, points.length - 1]];
  while (stack.length) {
    const [i, j] = stack.pop()!;
    let max = 0, idx = -1;
    for (let k = i + 1; k < j; k++) {
      const d = dist(points[k], points[i], points[j]);
      if (d > max) { max = d; idx = k; }
    }
    if (max > toleranceM && idx > 0) { keep[idx] = true; stack.push([i, idx], [idx, j]); }
  }
  return keep.flatMap((k, i) => (k ? [i] : []));
}

export type ShareMeta = {
  n: string; va: string; km: number; min: number; up: number; rep: number; s: string;
  /** class dictionary: "roadClass|surface" */
  d: string[];
  /** road / track / trail km */
  rm?: [number, number, number];
  /** asphalt / gravel / dirt / unknown % */
  sf?: [number, number, number, number];
  /** forestKm, riversideKm, ruralOpenKm, elevationGainM, unverifiedPathKm, roughTrackKm, sandKm, streetKm */
  q?: [number, number, number, number, number, number, number, number];
};
export type SharedRoute = {
  name: string; variant: string; km: number; minutes: number; unpavedPercent: number; repeatedPercent: number;
  startLabel: string;
  points: Pt[];
  /** class of the stretch starting at point i (length points.length - 1) */
  classes: { roadClass: RoadClass; surface: SurfaceClass }[];
  plan: RidePlan | null;
  details: {
    roadKm: number; trackKm: number; trailKm: number;
    asphaltPercent: number; gravelPercent: number; dirtPercent: number; unknownPercent: number;
    forestKm: number; riversideKm: number; ruralOpenKm: number; elevationGainM: number;
    unverifiedPathKm: number; roughTrackKm: number; sandKm: number; streetKm: number;
  } | null;
};

const r1 = (v: number | undefined) => Math.round((v ?? 0) * 10) / 10;

function classAtOriginalIndex(route: GeneratedRoute): string[] {
  // Segment features are contiguous subsequences of the route line, in order.
  const out = new Array<string>(route.geometry.coordinates.length).fill("road|unknown");
  let cursor = 0;
  for (const f of route.segments.features) {
    const n = f.geometry.coordinates.length;
    const key = `${f.properties.roadClass}|${f.properties.surface}`;
    for (let i = cursor; i < Math.min(out.length, cursor + n); i++) out[i] = key;
    cursor += Math.max(1, n - 1);
  }
  return out;
}

export function encodeRouteShare(route: GeneratedRoute, startLabel: string, plan?: RidePlan | null): string {
  const coords = route.geometry.coordinates as Pt[];
  let keep = simplifyIndices(coords, SIMPLIFY_TOLERANCE_M);
  if (keep.length > MAX_POINTS) {
    // Longer rides: keep every k-th of the kept points, ends included.
    const step = Math.ceil(keep.length / MAX_POINTS);
    keep = keep.filter((_, i) => i % step === 0 || i === keep.length - 1);
  }
  const classes = classAtOriginalIndex(route);
  const dict: string[] = [];
  const runs: number[] = [];
  let last = -1, count = 0;
  for (let i = 0; i < keep.length - 1; i++) {
    const key = classes[keep[i]];
    let idx = dict.indexOf(key);
    if (idx < 0) { dict.push(key); idx = dict.length - 1; }
    if (idx === last) count++;
    else { if (last >= 0) runs.push(last, count); last = idx; count = 1; }
  }
  if (last >= 0) runs.push(last, count);

  const deltas: number[] = [];
  let plat = 0, plon = 0;
  for (const i of keep) {
    const lat = Math.round(coords[i][1] * 1e5), lon = Math.round(coords[i][0] * 1e5);
    deltas.push(lat - plat, lon - plon);
    plat = lat; plon = lon;
  }
  const meta: ShareMeta = {
    n: route.name, va: route.variant, km: Math.round(route.distanceMeters / 1000), min: Math.round(route.durationSeconds / 60),
    up: route.surfaces.gravelPercent + route.surfaces.dirtPercent, rep: route.overlap.repeatedPercent, s: startLabel, d: dict,
    rm: [r1(route.roadMix.roadKm), r1(route.roadMix.trackKm), r1(route.roadMix.trailKm)],
    sf: [route.surfaces.asphaltPercent, route.surfaces.gravelPercent, route.surfaces.dirtPercent, route.surfaces.unknownPercent],
    q: [r1(route.quality.forestKm), r1(route.quality.riversideKm), r1(route.quality.ruralOpenKm), Math.round(route.quality.elevationGainM ?? 0),
      r1(route.quality.unverifiedPathKm), r1(route.quality.roughTrackKm), r1(route.quality.sandKm), r1(route.quality.streetKm)],
  };
  const parts = [SHARE_VERSION, toBase64Url(JSON.stringify(meta)), encodeVarints(deltas), encodeVarints(runs)];
  if (plan) parts.push(encodePlanShare(plan));
  return parts.join("~");
}

export function decodeRouteShare(code: string): SharedRoute | null {
  try {
    const parts = code.split("~");
    if (parts[0] !== SHARE_VERSION || parts.length < 4) return null;
    const meta = JSON.parse(fromBase64Url(parts[1])) as ShareMeta;
    const deltas = decodeVarints(parts[2]);
    const points: Pt[] = [];
    let lat = 0, lon = 0;
    for (let i = 0; i + 1 < deltas.length; i += 2) {
      lat += deltas[i]; lon += deltas[i + 1];
      points.push([lon / 1e5, lat / 1e5]);
    }
    if (points.length < 2) return null;
    const runs = decodeVarints(parts[3]);
    const classes: SharedRoute["classes"] = [];
    for (let i = 0; i + 1 < runs.length; i += 2) {
      const [rc, sf] = (meta.d[runs[i]] ?? "road|unknown").split("|");
      for (let k = 0; k < runs[i + 1]; k++) classes.push({ roadClass: rc as RoadClass, surface: sf as SurfaceClass });
    }
    while (classes.length < points.length - 1) classes.push({ roadClass: "road", surface: "unknown" });
    const plan = parts[4] ? decodePlanShare(parts[4]) : null;
    const details = meta.rm && meta.sf && meta.q ? {
      roadKm: meta.rm[0], trackKm: meta.rm[1], trailKm: meta.rm[2],
      asphaltPercent: meta.sf[0], gravelPercent: meta.sf[1], dirtPercent: meta.sf[2], unknownPercent: meta.sf[3],
      forestKm: meta.q[0], riversideKm: meta.q[1], ruralOpenKm: meta.q[2], elevationGainM: meta.q[3],
      unverifiedPathKm: meta.q[4], roughTrackKm: meta.q[5], sandKm: meta.q[6], streetKm: meta.q[7],
    } : null;
    return { name: meta.n, variant: meta.va, km: meta.km, minutes: meta.min, unpavedPercent: meta.up, repeatedPercent: meta.rep, startLabel: meta.s, points, classes, plan, details };
  } catch {
    return null;
  }
}

/** The segments the map component draws, rebuilt from the decoded line. */
export function sharedRouteSegments(share: SharedRoute): GeoJSON.FeatureCollection<GeoJSON.LineString, RouteSegmentProperties> {
  const features: GeoJSON.Feature<GeoJSON.LineString, RouteSegmentProperties>[] = [];
  let i = 0;
  while (i < share.points.length - 1) {
    const cls = share.classes[i];
    let j = i;
    while (j < share.points.length - 1 && share.classes[j].roadClass === cls.roadClass && share.classes[j].surface === cls.surface) j++;
    const coords = share.points.slice(i, j + 1);
    let meters = 0;
    for (let k = 1; k < coords.length; k++) {
      const dLat = (coords[k][1] - coords[k - 1][1]) * 110540;
      const dLon = (coords[k][0] - coords[k - 1][0]) * 111320 * Math.cos((coords[k][1] * Math.PI) / 180);
      meters += Math.hypot(dLat, dLon);
    }
    features.push({ type: "Feature", geometry: { type: "LineString", coordinates: coords }, properties: { roadClass: cls.roadClass, surface: cls.surface, distanceMeters: Math.round(meters) } });
    i = j;
  }
  return { type: "FeatureCollection", features };
}

/** Only the fields that decide a ride; the rest are defaults on decode. */
export function encodePlanShare(plan: RidePlan): string {
  const compact = {
    s: plan.startPlace, v: plan.viaPlaces, d: plan.destinationPlace, f: plan.focusArea, bs: plan.budgetScope, r: plan.returnToStart,
    b: plan.budget, df: plan.difficulty, st: plan.rideStyle, g: plan.gravelPreference, t: plan.trailPreference, a: plan.accessPolicy,
    pf: plan.preferForest, am: plan.avoidMainRoads, si: plan.includeSightseeing, su: plan.surroundings,
  };
  return toBase64Url(JSON.stringify(compact));
}
export function decodePlanShare(code: string): RidePlan | null {
  try {
    const c = JSON.parse(fromBase64Url(code));
    return RidePlanSchema.parse({
      startPlace: c.s ?? null, viaPlaces: c.v ?? [], destinationPlace: c.d ?? null, directionPlace: null, focusArea: c.f ?? null,
      budgetScope: c.bs ?? "total", returnToStart: c.r ?? true, budget: c.b ?? { mode: "flexible", value: null, constraint: "target", minimumValue: null },
      difficulty: c.df ?? "adventure", rideStyle: c.st ?? "explore", gravelPreference: c.g ?? 55, trailPreference: c.t ?? "some",
      accessPolicy: c.a ?? "verified", preferForest: Boolean(c.pf), maxRepeatedPercent: null, prioritizeLowOverlap: true,
      noSand: false, avoidTowns: false, avoidMainRoads: Boolean(c.am), includeTet: false, includeSightseeing: Boolean(c.si), surroundings: c.su ?? "some",
    });
  } catch {
    return null;
  }
}

export function shareUrl(code: string, origin = "https://www.mopik.eu"): string {
  return `${origin}/r/${code}`;
}
