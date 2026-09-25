import { RidePlanSchema, type RidePlan } from "@/lib/chat/ride-plan";
import { profileToPlanFields, type RideProfile } from "@/lib/chat/ride-profile";

/** From and To are always offered; see `placesFromPlan`. */
export const MIN_ROWS = 2;

export type ComposerTripType = "round_trip" | "one_way";
export type ComposerDuration = "flexible" | "hours";

export type ComposerValues = {
  /**
   * The ride as a list of places in riding order: start first, then every
   * stop. A round trip does not repeat the start at the end — `tripType`
   * says that. One list rather than start/destination/stops because the old
   * shape quietly meant two different things: on a round trip "Uz" was
   * appended to the stops, so two fields did the same job and the rider had
   * no way to reorder them.
   */
  places: string[];
  tripType: ComposerTripType;
  durationMode: ComposerDuration;
  hours: number;
  /** the rider's standing choices: how rough, why, where */
  profile: RideProfile;
};

export function composeRidePlan(values: ComposerValues): RidePlan {
  const places = values.places.map((p) => p.trim()).filter(Boolean);
  const [start, ...rest] = places;
  const oneWay = values.tripType === "one_way";

  return RidePlanSchema.parse({
    startPlace: start ?? "",
    // One way: everything before the last place is a stop, the last is the
    // destination. Round trip: every place after the start is a stop.
    viaPlaces: oneWay ? rest.slice(0, -1) : rest,
    destinationPlace: oneWay ? rest.at(-1) ?? null : null,
    directionPlace: null,
    returnToStart: !oneWay,
    budget: values.durationMode === "flexible"
      ? { mode: "flexible", value: null, constraint: "target", minimumValue: null }
      : { mode: "duration", value: values.hours, constraint: "target", minimumValue: null },
    ...profileToPlanFields(values.profile),
    maxRepeatedPercent: null,
    prioritizeLowOverlap: !oneWay,
    noSand: false,
    avoidTowns: false,
    includeTet: false,
  });
}

/**
 * The reverse: a plan back into the ordered list the form edits.
 *
 * Always at least two rows. A rider opening Mopik should be able to say where
 * from and where to without first finding an "add" button; the second row is
 * optional (its placeholder says so) and an empty one is dropped on submit,
 * so the cost of offering it is nothing.
 */
export function placesFromPlan(plan: RidePlan | null): string[] {
  if (!plan) return ["", ""];
  const tail = plan.returnToStart
    ? plan.viaPlaces
    : [...plan.viaPlaces, ...(plan.destinationPlace ? [plan.destinationPlace] : [])];
  const places = [plan.startPlace ?? "", ...tail];
  return places.length >= MIN_ROWS ? places : [...places, ...Array(MIN_ROWS - places.length).fill("")];
}

/**
 * The shaping points of the plan the form was opened with, carried into the
 * plan it builds — when the ride's places are still the ones they bend.
 *
 * The form has no rows for them (they are dots on the edit map, not places),
 * so a plan rebuilt from its rows would quietly lose them, and a shared ride
 * reopened and generated again would come back without the shape its rider
 * gave it. They follow places by index, so they are kept only while the start,
 * the stops, the finish and the trip type are exactly the old plan's; a
 * changed list of places is a different ride, and its shape is the search's
 * to find again.
 */
export function carryShapePoints(next: RidePlan, previous: RidePlan | null): RidePlan {
  const shapes = previous?.shapePoints;
  if (!shapes?.length || !previous) return next;
  const same = (next.startPlace ?? "") === (previous.startPlace ?? "")
    && (next.destinationPlace ?? "") === (previous.destinationPlace ?? "")
    && Boolean(next.returnToStart) === Boolean(previous.returnToStart)
    && next.viaPlaces.length === previous.viaPlaces.length
    && next.viaPlaces.every((v, i) => v === previous.viaPlaces[i]);
  return same ? { ...next, shapePoints: shapes } : next;
}

/**
 * The plan the full search („Meklēt labāku apli ar šīm pieturām”) is given:
 * the same stops, and no shaping points (rider, 2026-09-25). They bent the
 * line this ride has; the search is asked for a different one, and the panel
 * says beside the button that they are not kept.
 */
export function planForFullSearch(plan: RidePlan): RidePlan {
  const { shapePoints: _shaped, ...rest } = plan;
  void _shaped;
  return rest;
}
