import type { Point } from "@/lib/geo/geometry";

/** Required towns are reached within 300 m of their geocoded location.
 * Check in route order, on segments (not just potentially sparse vertices).
 */
export function visitsRequiredStops(coordinates: Point[], stops: Point[], toleranceMeters = 300): boolean {
  let cursor = 0;
  for (const stop of stops) {
    const lonScale = 111195 * Math.cos(stop[1] * Math.PI / 180);
    let found = false;
    for (let i = Math.floor(cursor); i < coordinates.length - 1; i++) {
      const a = coordinates[i], b = coordinates[i+1];
      const x = (a[0]-stop[0])*lonScale, y = (a[1]-stop[1])*111195;
      const dx = (b[0]-a[0])*lonScale, dy = (b[1]-a[1])*111195;
      const norm = dx*dx+dy*dy;
      const t = Math.max(i === Math.floor(cursor) ? cursor-i : 0, Math.min(1, norm ? -(x*dx+y*dy)/norm : 0));
      if (Math.hypot(x+t*dx,y+t*dy) <= toleranceMeters) { cursor = i+t; found = true; break; }
    }
    if (!found) return false;
  }
  return true;
}
