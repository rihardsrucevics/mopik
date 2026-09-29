import { decodePlanPlaces, decodeRouteShare, planPart, sharedRouteSegments } from "@/lib/share/route-code";
import type { ResolvedPlace } from "@/lib/chat/places";
import type { RidePlan } from "@/lib/chat/ride-plan";
import { RouteIntentSchema, type GeneratedRoute, type GenerateRouteResponse } from "@/lib/types";

/**
 * „Labot” on a saved ride (backlog 44/47): the ride reopened as a result, with
 * its own line, so edit mode starts on exactly what was saved — nothing is
 * generated again.
 *
 * Backlog 47 was the old way in: the saved list sent only the plan
 * (`/?p=<plan>&from=<code>`), so the form came back with the rows and the map
 * with no line at all; and the rows' coordinates were matched to the plan by
 * *name*, while an unedited ride is saved with the router's labels as its
 * names ("Kuģu iela 26A, Rīga" for the plan's "Kuģu iela 26A") — nothing
 * matched, no row was pinned, and there were no pins to draw or frame.
 */

/** Where a saved ride came from. */
export type SavedOrigin = "own" | "shared";

/**
 * A ride counts as the rider's own only when it was saved as his own after
 * this field existed. Everything else — a received link, and every ride saved
 * before backlog 44 — is "shared": the safe answer is a copy, never an
 * overwrite of something he may not have made.
 */
export function originOf(ride: { origin?: SavedOrigin; from?: "shared" }): SavedOrigin {
  return ride.origin === "own" && ride.from !== "shared" ? "own" : "shared";
}

/** What „Pabeigt labošanu” does with an edited saved ride. */
export type SavedEditTarget =
  | { mode: "overwrite"; id: string; savedAt: number; name: string }
  | { mode: "copy"; name: string };

export function editTargetFor(ride: { id: string; name: string; savedAt: number; origin?: SavedOrigin; from?: "shared" }, copySuffix: string): SavedEditTarget {
  return originOf(ride) === "own"
    ? { mode: "overwrite", id: ride.id, savedAt: ride.savedAt, name: ride.name }
    : { mode: "copy", name: `${ride.name} ${copySuffix}` };
}

/**
 * The list after an edited ride is saved. `entry` is the edited ride as a
 * saved row (its id already the hash of its new code). Overwrite: the old
 * row goes and the new one takes its place and its date, so the list does not
 * reorder under the rider. Copy: the new row is added and nothing else moves.
 */
export function applySavedEdit<T extends { id: string; savedAt: number }>(list: T[], target: SavedEditTarget, entry: T): T[] {
  if (target.mode === "overwrite") {
    const at = list.findIndex((r) => r.id === target.id);
    const kept = { ...entry, savedAt: target.savedAt };
    const rest = list.filter((r) => r.id !== target.id && r.id !== entry.id);
    if (at < 0) return [kept, ...rest];
    const out = [...rest];
    out.splice(Math.min(at, out.length), 0, kept);
    return out;
  }
  return [entry, ...list.filter((r) => r.id !== entry.id)];
}

/**
 * A saved ride's code as the planner's result: the decoded line, its plan,
 * and the places it was routed through — the same three things a generation
 * leaves in state, so the result's own „Labot” works on it unchanged.
 * Null when the code has no plan or no coordinates for its places (older
 * codes): those still open in the form.
 */
export function rideForEdit(code: string): { result: GenerateRouteResponse; plan: RidePlan; places: ResolvedPlace[] } | null {
  const share = decodeRouteShare(code);
  const planCode = planPart(code);
  if (!share || !share.plan || !planCode) return null;
  const plan = share.plan;
  const pl = decodePlanPlaces(planCode);
  if (!pl.length) return null;
  const round = plan.returnToStart === true;
  const hasFinish = !round && Boolean(plan.destinationPlace) && pl.length >= 2;
  const at = (p: ResolvedPlace) => ({ lat: p.lat, lon: p.lon, label: p.label || p.name });
  const segments = sharedRouteSegments(share);
  const meters = segments.features.reduce((s, f) => s + f.properties.distanceMeters, 0);
  const km = meters / 1000;
  const d = share.details;
  const pct = (v: number) => (km > 0 ? Math.round((v / km) * 100) : 0);
  const route: GeneratedRoute = {
    id: `saved-${code.length}-${code.slice(-12)}`,
    name: share.name,
    geometry: { type: "LineString", coordinates: share.points },
    segments,
    distanceMeters: Math.round(meters),
    durationSeconds: share.minutes * 60,
    roadMix: {
      roadKm: d?.roadKm ?? 0, trackKm: d?.trackKm ?? 0, trailKm: d?.trailKm ?? 0,
      roadPercent: pct(d?.roadKm ?? 0), trackPercent: pct(d?.trackKm ?? 0), trailPercent: pct(d?.trailKm ?? 0),
    },
    surfaces: d
      ? { asphaltPercent: d.asphaltPercent, gravelPercent: d.gravelPercent, dirtPercent: d.dirtPercent, unknownPercent: d.unknownPercent }
      : { asphaltPercent: 100 - share.unpavedPercent, gravelPercent: share.unpavedPercent, dirtPercent: 0, unknownPercent: 0 },
    quality: {
      roughTrackKm: d?.roughTrackKm ?? 0, sandKm: d?.sandKm ?? 0, streetKm: d?.streetKm ?? 0, unverifiedPathKm: d?.unverifiedPathKm ?? 0,
      riddenKm: 0, surfaceSwitches: 0, turnsPer10Km: 0, forestKm: d?.forestKm ?? 0, riversideKm: d?.riversideKm ?? 0,
      ruralOpenKm: d?.ruralOpenKm ?? 0, landscapeTransitions: 0, landscapeTypes: 0, elevationGainM: d?.elevationGainM ?? 0,
      elevationRangeM: 0, natureScore: 0, ...(d?.gateCount !== undefined ? { gateCount: d.gateCount } : {}),
      coastKm: d?.coastKm ?? 0, coastNearKm: 0,
    },
    overlap: {
      repeatedPercent: share.repeatedPercent,
      repeatedKm: Math.round(km * share.repeatedPercent) / 100,
      distinctKm: Math.round(km * (100 - share.repeatedPercent)) / 100,
    },
    profile: plan.difficulty,
    sourcePrompt: "",
    variant: share.variant,
  };
  const intent = RouteIntentSchema.parse({
    routeType: round ? "round_trip" : "point_to_point",
    returnToStart: round,
    rideStyle: plan.rideStyle,
    difficulty: plan.difficulty,
    gravelPreference: plan.gravelPreference,
    trailPreference: plan.trailPreference,
    accessPolicy: plan.accessPolicy,
    preferForest: plan.preferForest,
    includeSightseeing: plan.includeSightseeing,
    avoidMainRoads: plan.avoidMainRoads,
    noSand: plan.noSand,
    avoidTowns: plan.avoidTowns,
    surroundings: plan.surroundings,
  });
  const result: GenerateRouteResponse = {
    intent,
    parser: "plan",
    start: at(pl[0]),
    via: pl.slice(1, hasFinish ? -1 : undefined).map(at),
    ...(hasFinish ? { destination: at(pl[pl.length - 1]) } : {}),
    routes: [route],
  };
  return { result, plan, places: pl };
}
