import { haversineMeters, type Point } from "@/lib/geo/geometry";
import { loadTetSections } from "./tet";

type Section = { name: string; coordinates: Point[] };
type Segment = { a: Point; b: Point; section: string };
const TOLERANCE_M = 35;
const CELL_M = 200;
/**
 * Equirectangular metres. The x scale depends on latitude, and it was fixed at
 * `cos(57°)` — Latvia — which is wrong everywhere else: at 40°N (Spain) the
 * scale is off by ~23 %, enough for the 35 m tolerance to silently stop
 * matching. Both the grid and the route being tested must use the *same*
 * scale, so it is taken once from the sections in play rather than per line.
 * Output km still use haversine, so the reported number is unaffected.
 */
const projector = (lat0Deg: number) => {
  const kx = 111195 * Math.cos((lat0Deg * Math.PI) / 180);
  return (p: Point): Point => [p[0] * kx, p[1] * 111195];
};

/** Approximate geometric coverage, not a road-id or access-status assertion.
 * Direction alignment and 300 m continuous runs reject simple crossings.
 */
export function createTetMatcher(sections: Section[]) {
  // The matcher is built per candidate area (`nearestSections`), so the
  // sections handed in are local and one latitude represents them well.
  const lats = sections.flatMap((s) => s.coordinates.map((c) => c[1]));
  const project = projector(lats.length ? (Math.min(...lats) + Math.max(...lats)) / 2 : 57);
  const grid = new Map<string, Segment[]>();
  for (const section of sections) {
    for (let i = 1; i < section.coordinates.length; i++) {
      const a = project(section.coordinates[i-1]), b = project(section.coordinates[i]);
      const segment = { a, b, section: section.name };
      for (let x = Math.floor((Math.min(a[0],b[0])-TOLERANCE_M)/CELL_M); x <= Math.floor((Math.max(a[0],b[0])+TOLERANCE_M)/CELL_M); x++) {
        for (let y = Math.floor((Math.min(a[1],b[1])-TOLERANCE_M)/CELL_M); y <= Math.floor((Math.max(a[1],b[1])+TOLERANCE_M)/CELL_M); y++) {
          const key = `${x},${y}`;
          const bucket = grid.get(key) ?? [];
          bucket.push(segment); grid.set(key, bucket);
        }
      }
    }
  }
  return (coordinates: Point[]): { sectionName: string; sliceKm: number } | undefined => {
    let total = 0, run = 0;
    const names = new Set<string>(), runNames = new Set<string>();
    const finishRun = () => {
      if (run >= 300) { total += run; for (const name of runNames) names.add(name); }
      run = 0; runNames.clear();
    };
    for (let i = 1; i < coordinates.length; i++) {
      const a = project(coordinates[i-1]), b = project(coordinates[i]);
      const dx = b[0]-a[0], dy = b[1]-a[1], length = Math.hypot(dx,dy);
      if (!length) continue;
      const meters = haversineMeters(coordinates[i-1], coordinates[i]);
      const samples = Math.max(1, Math.ceil(meters / 20));
      for (let k = 0; k < samples; k++) {
        const t = (k+0.5)/samples;
        const p: Point = [a[0]+dx*t, a[1]+dy*t];
        const nearby = grid.get(`${Math.floor(p[0]/CELL_M)},${Math.floor(p[1]/CELL_M)}`) ?? [];
        let best: Segment | undefined, bestDistance = TOLERANCE_M;
        for (const segment of nearby) {
          const ux = segment.b[0]-segment.a[0], uy = segment.b[1]-segment.a[1];
          const norm = Math.hypot(ux,uy);
          if (!norm || Math.abs(dx*ux+dy*uy)/(length*norm) < 0.8) continue;
          const u = Math.max(0,Math.min(1,((p[0]-segment.a[0])*ux+(p[1]-segment.a[1])*uy)/(norm*norm)));
          const d = Math.hypot(p[0]-segment.a[0]-u*ux,p[1]-segment.a[1]-u*uy);
          if (d <= bestDistance) { best = segment; bestDistance = d; }
        }
        if (best) { run += meters/samples; runNames.add(best.section); }
        else finishRun();
      }
    }
    finishRun();
    return total >= 500 ? { sectionName: [...names].join(" · "), sliceKm: Math.round(total/100)/10 } : undefined;
  };
}

/**
 * Matchers by area, not one for everything.
 *
 * With Latvia only, one cached matcher over every section was fine. Across 33
 * countries it is wrong twice: the equirectangular x scale would be averaged
 * from Norway to Türkiye, and the grid would be built from 585k points on a
 * request that can only ever touch a few hundred. Sections are filtered to the
 * route's own bounding box first — cheap, since it is a coordinate compare —
 * and the resulting matcher is cached per rounded box.
 */
const matchers = new Map<string, ReturnType<typeof createTetMatcher>>();
/** Degrees of slack around the route: comfortably past the 35 m tolerance. */
const BOX_PAD_DEG = 0.05;

export function measureTetCoverage(coordinates: Point[]) {
  try {
    if (!coordinates.length) return undefined;
    const lons = coordinates.map((c) => c[0]), lats = coordinates.map((c) => c[1]);
    const box = [
      Math.min(...lons) - BOX_PAD_DEG, Math.min(...lats) - BOX_PAD_DEG,
      Math.max(...lons) + BOX_PAD_DEG, Math.max(...lats) + BOX_PAD_DEG,
    ] as const;
    const key = box.map((v) => v.toFixed(1)).join(",");
    let matcher = matchers.get(key);
    if (!matcher) {
      const nearby = loadTetSections().filter((s) =>
        s.coordinates.some((c) => c[0] >= box[0] && c[0] <= box[2] && c[1] >= box[1] && c[1] <= box[3]));
      // No TET anywhere near this ride: that is an answer, not an error.
      if (!nearby.length) return undefined;
      matcher = createTetMatcher(nearby);
      // A handful of areas per process is plenty; this is not a general cache.
      if (matchers.size > 32) matchers.clear();
      matchers.set(key, matcher);
    }
    return matcher(coordinates);
  } catch (error) {
    // An optional reference layer must not prevent generating the ride.
    console.warn("TET coverage unavailable:", error);
    return undefined;
  }
}
