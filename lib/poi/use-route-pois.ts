"use client";

import { useEffect, useRef, useState } from "react";
import type { UiLocale } from "@/lib/i18n/locale";
import type { RoutePois } from "@/lib/poi/kinds";

/**
 * The sights near a ride, fetched once the ride is on screen.
 *
 * This used to live twice — once in `result-panel.tsx`, once in
 * `shared-route.tsx` — and in both places it was *lazy*: nothing was asked for
 * until the rider opened the suggestions card. That was right while the list
 * was the only consumer. It stopped being right when the rider asked for the
 * places already on his route to be marked on the map "as soon as the list has
 * loaded", without him opening anything: a fetch keyed on a card's open state
 * cannot answer a map that is drawn before the card is touched.
 *
 * So the trigger moves from "the card was opened" to "there is a ride to
 * show", and the two copies become one hook the page owns. The card reads the
 * same state through props and no longer fetches at all. The cost of dropping
 * the laziness is one POST per generated ride against a pre-baked dataset —
 * the endpoint answers in single-digit milliseconds — and it buys the markers
 * the rider asked for plus a card that is already filled in when he opens it.
 *
 * `rideId` is the identity of the drawn line, not of the request: a fresh
 * `crypto.randomUUID()` per generated ride on the planner, the share code on
 * `/r/<code>`. It changes exactly when the geometry does, including when the
 * rider cycles a card to a runner-up, which is precisely when the list must be
 * asked for again. Null means there is no ride yet and nothing is fetched.
 */
export function useRoutePois({ rideId, coordinates, locale }: {
  rideId: string | null;
  /** The ride's own line, as `[lon, lat]` pairs. */
  coordinates: [number, number][] | number[][] | null;
  locale: UiLocale;
}): { pois: RoutePois | null; loading: boolean; failed: boolean } {
  const [pois, setPois] = useState<RoutePois | null>(null);
  const [loading, setLoading] = useState(false);
  /**
   * The lookup answered with an error rather than with an empty list.
   *
   * Different statements: an empty answer means "this ride has no sights near
   * it", which is the ordinary case outside the published countries, and the
   * card removes itself. A failure means the rider was shown a ride that looks
   * as though it has none, and the card says so in one quiet line instead.
   */
  const [failed, setFailed] = useState(false);

  // `coordinates` is a fresh array on most renders (the planner rebuilds the
  // response object, the shared page memoises but its parent does not), so the
  // effect is keyed on the ride's id alone and reads the line through a ref.
  const coordsRef = useRef(coordinates);
  useEffect(() => { coordsRef.current = coordinates; }, [coordinates]);

  useEffect(() => {
    const coords = coordsRef.current;
    if (!rideId || !coords?.length) return;
    setPois(null);
    setFailed(false);
    setLoading(true);
    const controller = new AbortController();
    fetch("/api/route-pois", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ geometry: { coordinates: coords }, locale }),
      signal: controller.signal,
    })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((data: RoutePois | null) => {
        if (!data) throw new Error("empty");
        setPois({ onRoute: data.onRoute ?? [], nearby: data.nearby ?? [] });
      })
      // An abort is not a failure — it is this effect tidying up after itself
      // when the ride changed under it, and the run that replaced it owns the
      // state from then on.
      .catch((err: unknown) => {
        if (controller.signal.aborted || (err instanceof DOMException && err.name === "AbortError")) return;
        setFailed(true);
      })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
    // The ride's id and the language are the whole key: the same ride in the
    // same language is never asked for twice, and either changing is exactly
    // when it must be asked for again.
    //
    // Deliberately *no* "already asked for this id" ref guard. There was one,
    // and it was wrong in the way only the browser shows: React's development
    // double-invoke mounts the effect, unmounts it — the cleanup aborts the
    // request — and mounts it again, and a ref survives that remount, so the
    // second run bailed out and the aborted first run was the only one there
    // ever was. On the shared page the list simply never arrived and the card
    // sat on "…" forever. The dependency array is the guard; the abort in the
    // cleanup is what makes a superseded request harmless.
  }, [rideId, locale]);

  return { pois, loading, failed };
}
