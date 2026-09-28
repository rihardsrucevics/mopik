import type { Point } from "@/lib/geo/geometry";
import { cumulative, pointAtDistance } from "@/lib/routing/detour";
import { anchorsAlong, anchorsOf, nearestAlong, nearestWithin, shapesOf, type RidePlace, type RidePlaces } from "@/lib/routing/reroute-leg";
import { MAX_SHAPE_POINTS } from "@/lib/chat/ride-limits";
import { nearestUnder, type Box } from "@/lib/map/pin-hit";

/**
 * Tap the line (rider, 2026-09-28; docs/DESIGN-route-editing.md B3): nobody
 * found out that the ride's line can be moved — the only way was to hold it
 * 350 ms and drag, on a phone. In edit mode a tap on the line now opens the
 * line's own sheet (`MapPointSheet`), with what can be done there:
 *
 * - „Virzīt caur citu vietu”: the line is taken at the tapped spot exactly
 *   as a hold-drag takes it (`lineSpotAt` → the composer's `grabLine`), and
 *   the next tap on the map is where it goes — the drag's release, one tap
 *   later. Same `ShapeEdit` add, same proposal, same ✓/✕ and undo.
 * - „Pievienot punktu šeit”: a pass-through point dropped on the line at
 *   the tapped spot (`passOnLine`). The line does not change, so nothing is
 *   routed: one commit, one step of the undo.
 *
 * A tap still never grabs anything, and a hold-drag still bends the line.
 * The result and shared maps keep the segment card (`lineTapAction`). A tap
 * on or next to a pin, a pass-through dot or a gate is that marker's
 * (`markerNear`), never the line's.
 *
 * Pure, so the rules are tested without a map (scripts/line-sheet.test.ts).
 */

/** Where the line was tapped or grabbed: on the line, and how far along it. */
export type LineSpot = {
  lat: number;
  lon: number;
  /** How many of the ride's stops lie before it along the line — the form's slot. */
  slot: number;
  alongMeters: number;
};

/**
 * The spot on the drawn line nearest to `at` ([lon, lat]), as both the drag
 * and the line sheet take it: the grab point is moved onto the line itself,
 * and the stops before it are counted along it. One function for both, so
 * „Virzīt caur citu vietu” and a hold-drag ending at the same place are the
 * same edit by construction.
 */
export function lineSpotAt(line: readonly Point[], at: Point, stops: readonly { lat: number; lon: number }[]): LineSpot | null {
  if (line.length < 2) return null;
  const pts = line as Point[];
  const cum = cumulative(pts);
  const near = nearestAlong(at, pts, cum);
  const on = pointAtDistance(pts, cum, near.alongMeters).point;
  const slot = stops.filter((v) => nearestAlong([v.lon, v.lat], pts, cum).alongMeters < near.alongMeters).length;
  return { lat: on[1], lon: on[0], slot, alongMeters: near.alongMeters };
}

/**
 * What a tap on the drawn line does:
 * - `marker`: a pin, a pass-through dot or a gate is under or next to the
 *   finger — the tap is that marker's (its sheet, its card);
 * - `sheet`: edit mode — the line sheet;
 * - `card`: the result and the shared maps — the segment card, as always.
 */
export function lineTapAction(p: { editing: boolean; nearMarker: boolean }): "marker" | "sheet" | "card" {
  if (p.nearMarker) return "marker";
  return p.editing ? "sheet" : "card";
}

/**
 * Extra reach round a marker beyond its own box, in CSS px, for a tap on
 * the line to count as the marker's: a pin sits ON the line, and a thumb
 * that lands a little beside a 22 px disc meant the disc, not the road
 * under it (the gate fix, 5003ccb, is the precedent for the other way
 * round). Wider than `PIN_HIT_SLACK_PX`, which only tells two pins apart.
 */
export const NEAR_MARKER_PX = 14;

/** The marker a tap at client (`x`, `y`) on the line meant, if any — the nearest centre within reach. */
export function markerNear<T>(items: readonly T[], boxOf: (item: T) => Box | null, x: number, y: number): T | null {
  return nearestUnder(items, boxOf, x, y, NEAR_MARKER_PX);
}

/** The line sheet's rows, in order. Every row is always there (rider's rule): off, with its reason, when it cannot act. */
export type LineSheetAction = "via" | "pass";

export function lineSheetRows(p: { shapeCount: number; rerouting: boolean }): { action: LineSheetAction; enabled: boolean; reason: "cap" | "busy" | null }[] {
  const reason = p.shapeCount >= MAX_SHAPE_POINTS ? "cap" as const : p.rerouting ? "busy" as const : null;
  return (["via", "pass"] as const).map((action) => ({ action, enabled: reason === null, reason }));
}

/**
 * „Pievienot punktu šeit”: the ride with a pass-through point on the line
 * at the tapped spot, in the leg the spot is in — between the two places
 * the line passes it between — and nothing else changed. The point is put
 * exactly on the line (found again near `alongMeters` on this line, so a
 * ride that passes the spot twice keeps the pass the rider tapped), so the
 * line is already the ride through it and nothing needs routing.
 */
export function passOnLine(places: RidePlaces, line: readonly Point[], spot: { lat: number; lon: number; alongMeters?: number }): { places: RidePlaces; at: { lat: number; lon: number } } | { error: "shape-cap" | "no-line" } {
  if (shapesOf(places).length >= MAX_SHAPE_POINTS) return { error: "shape-cap" };
  if (line.length < 2) return { error: "no-line" };
  const pts = line as Point[];
  const cum = cumulative(pts);
  const total = cum[cum.length - 1];
  const target: Point = [spot.lon, spot.lat];
  const along = typeof spot.alongMeters === "number"
    ? nearestWithin(target, pts, cum, Math.max(0, spot.alongMeters - 200), Math.min(total, spot.alongMeters + 200)).alongMeters
    : nearestAlong(target, pts, cum).alongMeters;
  const [lon, lat] = pointAtDistance(pts, cum, along).point;
  const anchors = anchorsAlong(anchorsOf(places, pts[pts.length - 1]), pts, cum);
  let slot = 0;
  while (slot < places.vias.length && anchors[slot + 1] <= along) slot++;
  const pass: RidePlace = { name: "", label: "", lat, lon, shape: true };
  return { places: { ...places, vias: [...places.vias.slice(0, slot), pass, ...places.vias.slice(slot)] }, at: { lat, lon } };
}

/**
 * The one-time hint on entering edit mode („Pieskaries līnijai vai punktam,
 * lai to mainītu”): once per device. Storage can be missing or throw (a
 * private window, blocked site data), and then the hint simply shows —
 * nothing here may break the editor.
 */
export const EDIT_TIP_KEY = "mopik.editTip.v1";

type TipStore = Pick<Storage, "getItem" | "setItem"> | null | undefined;

export function editTipDue(store: TipStore): boolean {
  try { return store?.getItem(EDIT_TIP_KEY) !== "seen"; } catch { return true; }
}

export function markEditTipSeen(store: TipStore): void {
  try { store?.setItem(EDIT_TIP_KEY, "seen"); } catch { /* a hint is never worth an error */ }
}
