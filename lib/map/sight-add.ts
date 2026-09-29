import { haversineMeters, type Point } from "@/lib/geo/geometry";
import { rowsOf, type RidePlaces } from "@/lib/routing/reroute-leg";
import { placeNewPoint } from "@/lib/map/insert-leg";
import type { ResolvedPlace } from "@/lib/chat/places";

/**
 * A sight added to the ride from the map's card (backlog 46, rider
 * 2026-09-28): „Pievienot braucienam” adds it, it does not only tick it.
 *
 * Pure: the rows the edit proposes, and what to say when the ride cannot
 * come closer to the sight than the road it already had (Vatrāne: the
 * manor sits in a park with footpaths only, ~100 m from the road he was on).
 */

/** Within this of the sight the ride reaches it: nothing to say. */
export const SIGHT_REACHED_M = 30;
/** Came no closer than this much less than the line already was: "no closer". */
export const SIGHT_NOT_CLOSER_SLACK_M = 25;

export type SightReach = { kind: "notCloser" | "short"; meters: number } | null;

/** Metres from a point to the nearest vertex of a line (dense enough for this: routed lines are). */
export function metersToLine(at: { lat: number; lon: number }, line: readonly Point[]): number {
  let best = Infinity;
  const p: Point = [at.lon, at.lat];
  for (const c of line) {
    const d = haversineMeters(p, c);
    if (d < best) best = d;
  }
  return best;
}

/** Rounded the way a rider reads it: ~10 m steps, ~50 m past 500 m. */
export function roundReach(m: number): number {
  return m >= 500 ? Math.round(m / 50) * 50 : Math.max(10, Math.round(m / 10) * 10);
}

/**
 * How close the ride with the sight gets to it, against how close the ride
 * already was: reached (null), no closer than before („tuvāk ar motociklu
 * netikt”), or closer but not there („tālāk ceļa nav”).
 */
export function sightReach(p: { lineMeters: number; reachedMeters: number }): SightReach {
  const reached = Math.min(p.reachedMeters, p.lineMeters);
  if (!Number.isFinite(reached) || reached <= SIGHT_REACHED_M) return null;
  const kind = reached >= p.lineMeters - SIGHT_NOT_CLOSER_SLACK_M ? "notCloser" : "short";
  return { kind, meters: roundReach(reached) };
}

/**
 * The editor's rows with the sight as a new stop, in the leg the line
 * passes it nearest (`placeNewPoint`, the same rule a „+” stop follows).
 * Null when the ride has no fixed place to put it between.
 */
export function rowsWithSight(places: RidePlaces, sight: ResolvedPlace, line: readonly Point[] | null): { names: string[]; picked: Record<number, ResolvedPlace | null> } | null {
  const { names, picked } = rowsOf(places);
  const rows = names.map((_, i) => picked[i] ?? null);
  const placement = placeNewPoint({ rows, point: { lat: sight.lat, lon: sight.lon }, oneWay: !places.roundTrip, line, allowExtend: false });
  if (!placement) return null;
  const at = placement.chosen.index;
  const nextNames = [...names.slice(0, at), sight.name, ...names.slice(at)];
  const nextPicked: Record<number, ResolvedPlace | null> = {};
  rows.forEach((r, i) => { nextPicked[i < at ? i : i + 1] = r; });
  nextPicked[at] = sight;
  return { names: nextNames, picked: nextPicked };
}
