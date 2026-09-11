/**
 * Shared geometry helpers.
 *
 * All points are `[lon, lat]` to match GeoJSON ordering — the same convention
 * the TET data, the route geometry and MapLibre already use.
 *
 * Bearings are degrees clockwise from true north, in [0, 360).
 */

const EARTH_RADIUS_M = 6371000;

const toRad = (deg: number) => (deg * Math.PI) / 180;
const toDeg = (rad: number) => (rad * 180) / Math.PI;

export type Point = [number, number]; // [lon, lat]

export function haversineMeters(a: Point, b: Point): number {
  const dLat = toRad(b[1] - a[1]);
  const dLon = toRad(b[0] - a[0]);
  const lat1 = toRad(a[1]);
  const lat2 = toRad(b[1]);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(h));
}

/**
 * Initial great-circle bearing from `a` to `b`.
 *
 * Deliberately spherical rather than the flat-earth scaling used for short
 * perpendicular offsets: loop anchors sit 20-100 km out, where the flat
 * approximation drifts noticeably.
 */
export function bearingDegrees(a: Point, b: Point): number {
  const lat1 = toRad(a[1]);
  const lat2 = toRad(b[1]);
  const dLon = toRad(b[0] - a[0]);
  const y = Math.sin(dLon) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

/** Point `meters` away from `origin` along `bearingDeg`. */
export function destinationPoint(origin: Point, bearingDeg: number, meters: number): Point {
  const d = meters / EARTH_RADIUS_M;
  const brg = toRad(bearingDeg);
  const lat1 = toRad(origin[1]);
  const lon1 = toRad(origin[0]);

  const lat2 = Math.asin(
    Math.sin(lat1) * Math.cos(d) + Math.cos(lat1) * Math.sin(d) * Math.cos(brg)
  );
  const lon2 =
    lon1 +
    Math.atan2(
      Math.sin(brg) * Math.sin(d) * Math.cos(lat1),
      Math.cos(d) - Math.sin(lat1) * Math.sin(lat2)
    );

  return [((toDeg(lon2) + 540) % 360) - 180, toDeg(lat2)];
}

/** Smallest signed difference `a - b`, in (-180, 180]. */
export function angleDiff(a: number, b: number): number {
  return ((((a - b) % 360) + 540) % 360) - 180;
}

export type BearingSector = { centreDeg: number; halfWidthDeg: number };

export function inSector(bearingDeg: number, sector: BearingSector): boolean {
  return Math.abs(angleDiff(bearingDeg, sector.centreDeg)) <= sector.halfWidthDeg;
}

/**
 * Cumulative distance in meters at each coordinate of a path.
 * `cumulative[0]` is 0 and `cumulative.at(-1)` is the total length.
 */
export function cumulativeDistances(coordinates: Point[]): number[] {
  const cumulative = [0];
  for (let i = 1; i < coordinates.length; i++) {
    cumulative.push(cumulative[i - 1] + haversineMeters(coordinates[i - 1], coordinates[i]));
  }
  return cumulative;
}

export function pathLengthMeters(coordinates: Point[]): number {
  let total = 0;
  for (let i = 1; i < coordinates.length; i++) {
    total += haversineMeters(coordinates[i - 1], coordinates[i]);
  }
  return total;
}

/**
 * Index of the coordinate lying `meters` along `cumulative` from `fromIndex`
 * (negative walks backwards). Clamped to the path's ends.
 */
export function indexAtOffset(
  cumulative: number[],
  fromIndex: number,
  meters: number
): number {
  const target = cumulative[fromIndex] + meters;
  if (target <= 0) return 0;
  const last = cumulative.length - 1;
  if (target >= cumulative[last]) return last;

  let lo = 0;
  let hi = last;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (cumulative[mid] < target) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/**
 * Resample a path to points spaced roughly `spacingMeters` apart.
 *
 * Isochrone rings come out of marching squares with wildly uneven vertex
 * density — dense along crinkly shoreline, sparse along straight boundary — so
 * sampling raw vertices biases anchors toward water's edge. Arc-length
 * sampling removes that bias.
 */
export function sampleByDistance(coordinates: Point[], spacingMeters: number): Point[] {
  if (coordinates.length < 2) return [...coordinates];

  const cumulative = cumulativeDistances(coordinates);
  const total = cumulative[cumulative.length - 1];
  if (total === 0) return [coordinates[0]];

  const out: Point[] = [];
  for (let d = 0; d < total; d += spacingMeters) {
    out.push(coordinates[indexAtOffset(cumulative, 0, d)]);
  }
  return out;
}

/**
 * Signed area of a closed ring in m², via the shoelace formula on a local
 * equirectangular projection about the ring's own latitude. Sign follows
 * winding order; use `Math.abs` for magnitude.
 */
export function ringAreaM2(ring: Point[]): number {
  if (ring.length < 3) return 0;

  const latAvg = ring.reduce((sum, p) => sum + p[1], 0) / ring.length;
  const latScale = 111320;
  const lonScale = 111320 * Math.cos(toRad(latAvg));

  let sum = 0;
  for (let i = 0; i < ring.length; i++) {
    const [x1, y1] = ring[i];
    const [x2, y2] = ring[(i + 1) % ring.length];
    sum += x1 * lonScale * (y2 * latScale) - x2 * lonScale * (y1 * latScale);
  }
  return sum / 2;
}

/** Ray-casting point-in-polygon test against a single ring. */
export function pointInRing(point: Point, ring: Point[]): boolean {
  const [x, y] = point;
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}
