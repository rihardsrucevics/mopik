"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { RidePlan } from "@/lib/chat/ride-plan";
import type { RouteSegmentProperties } from "@/lib/types";
import { track } from "@/lib/analytics";
import { fi } from "@/lib/i18n/format";
import type { messages } from "@/lib/i18n/messages";
import {
  MAX_DETOUR_POIS,
  isSuspiciousDetour,
  spliceDetours,
  splicedSurfaces,
  type DetourResult,
  type SplicedRoute,
} from "@/lib/routing/detour";

/**
 * The client half of the detour feature: prefetch every nearby sight's detour
 * as soon as the suggestions arrive, then splice the ticked ones in instantly.
 *
 * One hook for both pages, for the reason `SuggestionsCard` is one component:
 * the rider asked for the planner and `/r/<code>` to behave identically here,
 * and two copies of this drifted the moment one was touched.
 *
 * ## Why prefetch rather than route on tick
 *
 * Routing two short legs is a second or two — fast for a page load, far too
 * slow for a checkbox. The rider's whole complaint was that ticking a sight
 * made him wait. So the work happens while he is reading the list: by the time
 * he has decided, the answer is already here and the tick is arithmetic.
 *
 * The cost is bounded and paid once — eight POIs, sequential, ~25 s worst case
 * on a 1 vCPU router — and it is abandoned the moment the ride changes.
 */

export type DetourState = {
  /** Detours by POI id, as they arrive. */
  byPoi: Record<string, DetourResult>;
  /** The prefetch is still running: rows with no answer yet show a spinner. */
  loading: boolean;
  /** The request ran out of time with POIs left; those rows stay pending. */
  partial: boolean;
};

/**
 * Prefetch detours for a ride's nearby suggestions.
 *
 * Deliberately keyed on the route's id *and* the list it is given: cycling a
 * card to a runner-up is a different ride, and a detour computed against the
 * previous line would splice into the wrong place. An in-flight request is
 * aborted when that happens — the answer is about to be worthless, and the
 * router is a single vCPU that should not be finishing work nobody wants.
 */
export function useDetourPrefetch(params: {
  /** null until a ride exists; the hook then does nothing. */
  routeId: string | null;
  /**
   * The drawn line, passed straight to the API.
   *
   * Typed as `number[][]` rather than `[number, number][]` because that is
   * what `GeoJSON.LineString` actually says — a `Position` may carry an
   * elevation and TypeScript will not narrow it. Nothing here reads the
   * coordinates; the API validates every vertex on arrival, which is where a
   * malformed one must be caught anyway.
   */
  geometry: { coordinates: number[][] } | null;
  durationSeconds: number | null;
  plan: RidePlan | null;
  /** The nearby list from Ieteikumi. Only these are worth a detour: an
   *  on-route place is already passed, so there is nothing to splice. */
  nearby: { id: string; lat: number; lon: number }[] | null;
}): DetourState {
  const { routeId, geometry, durationSeconds, plan, nearby } = params;
  const [state, setState] = useState<DetourState>({ byPoi: {}, loading: false, partial: false });

  // The POI list as a stable key, so a parent that rebuilds the array every
  // render cannot become a reason to re-route eight legs.
  const poiKey = useMemo(
    () => (nearby ?? []).slice(0, MAX_DETOUR_POIS).map((p) => p.id).join(","),
    [nearby],
  );
  // The list itself is read inside the effect but must not be a dependency of
  // it, for the same reason.
  const nearbyRef = useRef(nearby);
  useEffect(() => { nearbyRef.current = nearby; }, [nearby]);
  const geometryRef = useRef(geometry);
  useEffect(() => { geometryRef.current = geometry; }, [geometry]);
  const planRef = useRef(plan);
  useEffect(() => { planRef.current = plan; }, [plan]);
  const durationRef = useRef(durationSeconds);
  useEffect(() => { durationRef.current = durationSeconds; }, [durationSeconds]);

  useEffect(() => {
    if (!routeId || !poiKey || !planRef.current || !geometryRef.current) return;
    const list = (nearbyRef.current ?? []).slice(0, MAX_DETOUR_POIS);
    if (!list.length) return;

    // A new ride: nothing learned about the previous one applies.
    setState({ byPoi: {}, loading: true, partial: false });
    const controller = new AbortController();

    fetch("/api/detour", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        geometry: geometryRef.current,
        plan: planRef.current,
        durationSeconds: durationRef.current ?? 0,
        pois: list.map((p) => ({ id: p.id, lat: p.lat, lon: p.lon })),
      }),
      signal: controller.signal,
    })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((data: { detours?: DetourResult[]; partial?: boolean }) => {
        const byPoi: Record<string, DetourResult> = {};
        for (const d of data.detours ?? []) byPoi[d.poiId] = d;
        setState({ byPoi, loading: false, partial: Boolean(data.partial) });
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted || (err instanceof DOMException && err.name === "AbortError")) return;
        // A prefetch that fails is not worth a message of its own: the rows
        // simply keep offering "Optimizēt maršrutu", which is what they did
        // before this feature existed. Nothing the rider was promised is lost.
        setState({ byPoi: {}, loading: false, partial: false });
      });

    return () => controller.abort();
  }, [routeId, poiKey]);

  return state;
}

/**
 * The ride as it is currently drawn: the original, or the original with every
 * ticked sight's detour spliced in.
 *
 * `null` when nothing is ticked or nothing has arrived, which is the signal to
 * every consumer to use the route exactly as the API returned it. That keeps
 * "untick and the original numbers come back" true by construction rather than
 * by an undo path that could drift.
 */
export function useSplicedRoute(params: {
  segments: GeoJSON.FeatureCollection<GeoJSON.LineString, RouteSegmentProperties> | null;
  distanceMeters: number | null;
  durationSeconds: number | null;
  /** The ticked places, by dataset id. */
  selectedIds: string[];
  detours: Record<string, DetourResult>;
}): (SplicedRoute & { surfaces: ReturnType<typeof splicedSurfaces> }) | null {
  const { segments, distanceMeters, durationSeconds, selectedIds, detours } = params;
  // Sorted and joined so the memo is keyed on the *set* of ticks, not on the
  // order they happen to be in.
  const key = useMemo(() => [...selectedIds].sort().join(","), [selectedIds]);

  return useMemo(() => {
    if (!segments || distanceMeters === null || durationSeconds === null) return null;
    const ticked = key ? key.split(",") : [];
    const usable = ticked.map((id) => detours[id]).filter((d): d is DetourResult => Boolean(d) && d.ok);
    if (!usable.length) return null;
    const spliced = spliceDetours({ segments, distanceMeters, durationSeconds, detours: usable });
    return { ...spliced, surfaces: splicedSurfaces(spliced.segments) };
  }, [segments, distanceMeters, durationSeconds, key, detours]);
}

/**
 * `detour_previewed`, fired once per change to the ticked set rather than per
 * render.
 *
 * The question it answers is the one the rider will ask: are people actually
 * using this instead of regenerating? So it carries how many sights are
 * included and what they cost, and nothing else.
 */
export function useDetourAnalytics(spliced: { applied: unknown[]; addedMeters: number } | null): void {
  const lastRef = useRef<string>("");
  useEffect(() => {
    const key = spliced ? `${spliced.applied.length}:${Math.round(spliced.addedMeters)}` : "";
    if (key === lastRef.current) return;
    lastRef.current = key;
    if (!spliced || spliced.applied.length === 0) return;
    track("detour_previewed", {
      pois: spliced.applied.length,
      delta_km: Math.round((spliced.addedMeters / 1000) * 10) / 10,
    });
  }, [spliced]);
}

/**
 * What the map's focus card says about a place's detour — the same delta, the
 * same label and the same offer as the list's row.
 *
 * One function rather than the formatting written out on each page, for the
 * reason the card and the hook are each one thing: the rider asked for the map
 * card and the row to mean the same, and two copies of "+17,0 km · garš
 * apbrauciens" would disagree the first time either was touched. `canPick` is
 * the row's own rule — an unreachable place has no routed line to splice, so
 * neither the checkbox nor the card's button is offered; a long detour is a
 * real ride and is offered exactly like any other.
 *
 * `null` while the prefetch has not answered: the card then shows what it
 * always showed, rather than a figure that is about to change.
 */
export function describeDetourForFocus(params: {
  detour: DetourResult | null | undefined;
  offRouteMeters: number;
  m: Pick<ReturnType<typeof messages>, "resDetourDelta" | "resDetourLong" | "resDetourLongWhy" | "resDetourUnreachable" | "resDetourUnreachableWhy">;
}): { delta?: string; note?: string; why?: string; canPick: boolean } | null {
  const { detour, offRouteMeters, m } = params;
  if (!detour) return null;
  if (!detour.ok) {
    return { note: m.resDetourUnreachable, why: m.resDetourUnreachableWhy, canPick: false };
  }
  const delta = fi(m.resDetourDelta, {
    km: (Math.round(detour.deltaMeters / 100) / 10).toFixed(1),
    min: Math.max(0, Math.round(detour.deltaSeconds / 60)),
  });
  const long = isSuspiciousDetour({ offRouteMeters, deltaMeters: detour.deltaMeters });
  return {
    delta,
    note: long ? m.resDetourLong : undefined,
    why: long ? m.resDetourLongWhy : undefined,
    canPick: true,
  };
}

/** The delta a row shows, or null while it is still being routed. */
export function useDetourRow(detours: Record<string, DetourResult>): (poiId: string) => DetourResult | null {
  return useCallback((poiId: string) => detours[poiId] ?? null, [detours]);
}
