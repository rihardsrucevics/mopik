import { RidePlanSchema, type RidePlan } from "@/lib/chat/ride-plan";
import { profileToPlanFields, type RideProfile } from "@/lib/chat/ride-profile";

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

/** The reverse: a plan back into the ordered list the form edits. */
export function placesFromPlan(plan: RidePlan | null): string[] {
  if (!plan) return ["Rīga"];
  const tail = plan.returnToStart
    ? plan.viaPlaces
    : [...plan.viaPlaces, ...(plan.destinationPlace ? [plan.destinationPlace] : [])];
  return [plan.startPlace ?? "", ...tail];
}
