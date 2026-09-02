import { RouteIntent } from "@/lib/types";

/**
 * GraphHopper Custom Model rules per riding profile.
 * https://docs.graphhopper.com/#custom-model
 *
 * Priority multipliers must be in [0, 1] on the hosted API, so we express
 * preference by penalizing what the profile wants LESS of:
 *  - all profiles avoid motorways/trunk hard;
 *  - gravel preference is expressed by penalizing asphalt on big roads;
 *  - "easy" penalizes rough tracks, "hard" tolerates them.
 */

type CustomModelStatement = {
  if?: string;
  else_if?: string;
  else?: "";
  multiply_by?: string;
  limit_to?: string;
};

export type CustomModel = {
  priority?: CustomModelStatement[];
  speed?: CustomModelStatement[];
  distance_influence?: number;
};

export function buildCustomModel(intent: RouteIntent): CustomModel {
  const gravel = intent.gravelPreference / 100;
  // The more gravel the rider wants, the harder we penalize paved big roads.
  const asphaltPenalty = Math.max(0.15, 1 - gravel * 0.85).toFixed(2);

  const priority: CustomModelStatement[] = [
    { if: "road_class == MOTORWAY", multiply_by: "0.0" },
    { if: "road_class == TRUNK", multiply_by: intent.avoidMotorways ? "0.05" : "0.3" },
    {
      if: "road_class == PRIMARY",
      multiply_by: intent.avoidMainRoads ? "0.1" : "0.3",
    },
    {
      if: "road_class == SECONDARY",
      multiply_by: intent.avoidMainRoads ? "0.3" : "0.6",
    },
    // Prefer unpaved: penalize asphalt on ordinary roads according to preference.
    {
      if: "surface == ASPHALT && road_class != TRACK",
      multiply_by: asphaltPenalty,
    },
    { if: "surface == SAND", multiply_by: intent.difficulty === "hard" ? "0.5" : "0.05" },
  ];

  if (intent.difficulty === "easy") {
    priority.push(
      { if: "road_class == TRACK && track_type == GRADE4", multiply_by: "0.2" },
      { if: "road_class == TRACK && track_type == GRADE5", multiply_by: "0.05" },
      { if: "road_class == TRACK && track_type == MISSING", multiply_by: "0.5" }
    );
  } else if (intent.difficulty === "adventure") {
    priority.push({
      if: "road_class == TRACK && track_type == GRADE5",
      multiply_by: "0.3",
    });
  }
  // "hard" keeps all track grades at full priority.

  const speed: CustomModelStatement[] = [
    { if: "road_class == TRACK", limit_to: "30" },
    { if: "surface == GRAVEL || surface == COMPACTED", limit_to: "60" },
    { if: "surface == GROUND || surface == DIRT || surface == SAND", limit_to: "25" },
  ];

  return {
    priority,
    speed,
    // Lower distance influence lets the router take detours onto nicer roads.
    distance_influence: 30,
  };
}

export function profileName(intent: RouteIntent): string {
  return intent.difficulty; // easy | adventure | hard
}
