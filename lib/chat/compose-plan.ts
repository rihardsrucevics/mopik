import { RidePlanSchema, type RidePlan } from "@/lib/chat/ride-plan";
import { profileToPlanFields, type RideProfile } from "@/lib/chat/ride-profile";

export type ComposerTripType = "round_trip" | "one_way";
export type ComposerDuration = "flexible" | "hours";

export type ComposerValues = {
  start: string;
  destination: string;
  stops: string[];
  tripType: ComposerTripType;
  durationMode: ComposerDuration;
  hours: number;
  /** the rider's standing choices: how rough, why, where */
  profile: RideProfile;
};

/**
 * The visible composer is authoritative. Its finite choices become a RidePlan
 * directly, without asking an LLM to reinterpret labels the rider selected.
 * The profile → plan mapping lives in `ride-profile.ts` and is shared with the
 * chat's quick-reply commands.
 */
export function composeRidePlan(values: ComposerValues): RidePlan {
  const cleanStops = values.stops.map((stop) => stop.trim()).filter(Boolean);
  const destination = values.destination.trim();
  const roundTripPlaces = destination ? [...cleanStops, destination] : cleanStops;

  return RidePlanSchema.parse({
    startPlace: values.start.trim(),
    viaPlaces: values.tripType === "round_trip" ? roundTripPlaces : cleanStops,
    destinationPlace: values.tripType === "one_way" ? destination : null,
    directionPlace: null,
    returnToStart: values.tripType === "round_trip",
    budget: values.durationMode === "flexible"
      ? { mode: "flexible", value: null, constraint: "target", minimumValue: null }
      : { mode: "duration", value: values.hours, constraint: "target", minimumValue: null },
    ...profileToPlanFields(values.profile),
    maxRepeatedPercent: null,
    prioritizeLowOverlap: values.tripType === "round_trip",
    noSand: false,
    avoidTowns: false,
    includeTet: false,
  });
}
