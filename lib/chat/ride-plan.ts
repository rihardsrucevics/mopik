import { z } from "zod";
import { messages } from "@/lib/i18n/messages";
import type { UiLocale } from "@/lib/i18n/locale";
import { RouteIntentSchema, type RouteIntent } from "@/lib/types";

export const RidePlanSchema = z.object({
  startPlace: z.string().max(160).nullable(),
  viaPlaces: z.array(z.string().min(1).max(160)).max(6),
  destinationPlace: z.string().max(160).nullable(),
  directionPlace: z.string().max(160).nullable(),
  /**
   * The playground: where the fun part of the ride happens when it is not at
   * the start ("meža aplis Baldones mežos, no Rīgas"). The ride is then a
   * transit there, a loop around it and a transit back — not a visit.
   */
  focusArea: z.string().max(160).nullable().default(null),
  /** Whether a duration/distance is for the whole ride or just the focus loop. */
  budgetScope: z.enum(["total", "focus"]).default("total"),
  /** Ride around the stops a little (default) or a lot ("vairāk apkārtnes"). */
  surroundings: z.enum(["some", "more"]).default("some"),
  returnToStart: z.boolean().nullable(),
  budget: z.object({
    mode: z.enum(["unknown", "duration", "distance", "flexible"]),
    value: z.number().positive().max(600).nullable(),
    constraint: z.enum(["target", "maximum", "range"]),
    minimumValue: z.number().nonnegative().max(600).nullable().default(null),
  }),
  difficulty: z.enum(["unknown", "easy", "adventure", "hard"]),
  rideStyle: z.enum(["unknown", "direct", "balanced", "explore"]),
  gravelPreference: z.number().min(0).max(100).nullable(),
  trailPreference: z.enum(["unknown", "none", "some", "lots"]),
  accessPolicy: z.enum(["verified", "allow_unverified"]).default("allow_unverified"),
  preferForest: z.boolean(),
  maxRepeatedPercent: z.number().min(0).max(100).nullable().default(null),
  prioritizeLowOverlap: z.boolean().default(false),
  noSand: z.boolean(),
  avoidTowns: z.boolean(),
  avoidMainRoads: z.boolean(),
  includeTet: z.boolean(),
  includeSightseeing: z.boolean(),
});
export type RidePlan = z.infer<typeof RidePlanSchema>;
export const ChatMessageSchema = z.object({ role: z.enum(["user", "assistant"]), content: z.string().min(1).max(6000) });
export type ChatMessage = z.infer<typeof ChatMessageSchema>;
/** A tap target. `action` is handled on the client instead of being sent to the chat. */
export type ChatQuickReply = { label: string; message: string; action?: "show-routes" | "retry" };
export type ChatResponse = { plan: RidePlan; message: string; ready: boolean; quickReplies: ChatQuickReply[] };
export type PlanPrompt = { message: string; quickReplies: ChatQuickReply[] };

function routeContext(plan: RidePlan, lv: boolean): string {
  const focus = plan.focusArea?.trim() ? `${plan.focusArea} (${lv ? "aplis" : "loop"})` : null;
  const places = [plan.startPlace, ...(focus ? [focus] : []), ...plan.viaPlaces, plan.destinationPlace].filter(Boolean);
  // A lone start is no context ("braucienam Rīga" reads wrong); the rider knows where they are.
  if (places.length < 2) return "";
  return lv ? ` braucienam ${places.join(" → ")}` : ` for ${places.join(" → ")}`;
}

/** Questions are short, route-specific and carry tap targets where choices are finite. */
export function nextPlanPrompt(plan: RidePlan, lv: boolean): PlanPrompt | null {
  const t = (a: string, b: string) => lv ? a : b;
  const reply = (lvLabel: string, enLabel: string, lvMessage: string, enMessage: string): ChatQuickReply => ({
    label: t(lvLabel, enLabel), message: t(lvMessage, enMessage),
  });
  const context = routeContext(plan, lv);
  if (!plan.startPlace?.trim()) return { message: t("No kurienes sāksim braucienu?", "Where will the ride start?"), quickReplies: [] };
  if (plan.returnToStart === null) return {
    message: t(`Vai${context} beigās jāatgriežas ${plan.startPlace}?`, `Should${context} finish back at ${plan.startPlace}?`),
    quickReplies: [
      reply("Jā, atpakaļ", "Return to start", `Jā, beigās atgriezties ${plan.startPlace}.`, `Yes, finish back at ${plan.startPlace}.`),
      reply("Nē, vienā virzienā", "One way", "Nē, šis ir vienvirziena brauciens.", "No, this is a one-way ride."),
    ],
  };
  if (!plan.returnToStart && !plan.destinationPlace?.trim()) return { message: t("Kur vēlies beigt šo vienvirziena braucienu?", "Where should this one-way ride finish?"), quickReplies: [] };
  if (plan.budget.mode === "unknown" || (["duration", "distance"].includes(plan.budget.mode) && !plan.budget.value)) return {
    message: t(`Cik daudz laika atvēlam${context}? Vari arī atstāt ilgumu brīvu.`, `How much time should we allow${context}? You can also leave it flexible.`),
    quickReplies: [
      reply("Apmēram 2 h", "About 2 h", "Apmēram 2 stundas.", "About 2 hours."),
      reply("Apmēram 4 h", "About 4 h", "Apmēram 4 stundas.", "About 4 hours."),
      reply("Ilgums brīvs", "Flexible", "Ilgums ir brīvs.", "The duration is flexible."),
    ],
  };
  if (plan.budget.mode === "duration" && (plan.budget.value! < 0.5 || plan.budget.value! > 16)) return { message: t("Varu plānot 30 minūšu līdz 16 stundu braucienu. Kādu ilgumu izvēlamies?", "I can plan rides from 30 minutes to 16 hours. What duration should we use?"), quickReplies: [] };
  if (plan.budget.mode === "distance" && plan.budget.value! < 20) return { message: t("Distances mērķis sākas no 20 km. Vai der 20 km, vai izvēlamies ilgumu?", "The distance target starts at 20 km. Would 20 km work, or shall we use a duration?"), quickReplies: [] };
  if (plan.budget.constraint === "range" && (plan.budget.minimumValue === null || plan.budget.value === null || plan.budget.minimumValue > plan.budget.value)) return { message: t("Precizē intervālu — no cik līdz cik stundām vai kilometriem?", "Please clarify the range: from how many to how many hours or kilometres?"), quickReplies: [] };
  if (plan.difficulty === "unknown") return {
    message: t("Kādu tehnisko grūtību izvēlamies?", "Which technical difficulty should we use?"),
    quickReplies: [
      reply("Viegli", "Easy", "Izvēlos vieglu — bez svīšanas.", "Choose easy — no sweat."),
      reply("Vidēji", "Medium", "Izvēlos vidēju — ar smērēšanos.", "Choose medium — mud welcome."),
      reply("Grūti", "Hard", "Izvēlos grūtu — galīgi rukši.", "Choose hard — proper pigs."),
    ],
  };
  if (plan.gravelPreference === null) return {
    message: t("Kādu ceļu seguma raksturu vēlies?", "What kind of roads do you prefer?"),
    quickReplies: [
      reply("Tikai asfalts", "Asphalt only", "Segums: Tikai asfalts.", "Surface: Asphalt only."),
      reply("Der arī grants", "Gravel is fine", "Segums: Der arī grants.", "Surface: Gravel is fine."),
      reply("Meži", "Forest", "Segums: Meži.", "Surface: Forest."),
    ],
  };
  if (plan.rideStyle === "unknown") return {
    message: t("Kādu braukšanas stilu izvēlamies?", "Which riding style should we use?"),
    quickReplies: [
      reply("Tūrisms", "Tourism", "Stils: Tūrisms.", "Style: Tourism."),
      reply("Sports", "Sport", "Stils: Sports.", "Style: Sport."),
    ],
  };
  return null;
}

/** Readiness is deterministic; model confidence cannot bypass missing facts. */
export function nextPlanQuestion(plan: RidePlan, lv: boolean): string | null {
  return nextPlanPrompt(plan, lv)?.message ?? null;
}

export function planToIntent(plan: RidePlan): RouteIntent {
  const missing = nextPlanQuestion(plan, false);
  if (missing) throw new Error(missing);
  return RouteIntentSchema.parse({
    routeType: plan.returnToStart ? "round_trip" : "point_to_point",
    returnToStart: plan.returnToStart,
    durationHours: plan.budget.mode === "duration" ? plan.budget.value : undefined,
    distanceKm: plan.budget.mode === "distance" ? plan.budget.value : undefined,
    durationIsMaximum: plan.budget.mode === "duration" && plan.budget.constraint !== "target",
    distanceIsMaximum: plan.budget.mode === "distance" && plan.budget.constraint !== "target",
    minimumDurationHours: plan.budget.mode === "duration" && plan.budget.constraint === "range" ? plan.budget.minimumValue : undefined,
    minimumDistanceKm: plan.budget.mode === "distance" && plan.budget.constraint === "range" ? plan.budget.minimumValue : undefined,
    maxRepeatedPercent: plan.maxRepeatedPercent ?? undefined,
    prioritizeLowOverlap: plan.prioritizeLowOverlap,
    difficulty: plan.difficulty,
    rideStyle: plan.rideStyle,
    gravelPreference: plan.gravelPreference,
    trailPreference: plan.trailPreference === "unknown" ? "none" : plan.trailPreference,
    accessPolicy: plan.accessPolicy,
    preferForest: plan.preferForest, noSand: plan.noSand,
    avoidTowns: plan.avoidTowns, avoidMainRoads: plan.avoidMainRoads,
    includeTet: plan.includeTet, includeSightseeing: plan.includeSightseeing,
    surroundings: plan.surroundings,
  });
}

/**
 * The ride in one line, in the rider's language.
 *
 * Took a `lv: boolean` until 2026-09-14, which was fine while there were two
 * languages and wrong once there were four: a Lithuanian rider got English,
 * because "not Latvian" was the only other option the signature could express.
 * Callers that have no locale (the chat API derives one from the prompt) pass
 * "lv" or "en" as before.
 */
export function planSummary(plan: RidePlan, locale: UiLocale): string {
  const m = messages(locale);
  const focus = plan.focusArea?.trim() ? `${plan.focusArea} (${m.sumLoop})` : null;
  const places = [plan.startPlace, ...(focus ? [focus] : []), ...plan.viaPlaces, plan.returnToStart ? plan.startPlace : plan.destinationPlace].filter(Boolean).join(" → ");
  const scope = focus && plan.budgetScope === "focus" && plan.budget.mode !== "flexible" && plan.budget.mode !== "unknown" ? ` ${m.sumForLoop}` : "";
  const unit = plan.budget.mode === "duration" ? "h" : "km";
  const budget = (plan.budget.mode === "unknown" ? m.sumDurationUnknown
    : plan.budget.mode === "flexible" ? m.sumFlexible
    : plan.budget.constraint === "range" ? `${plan.budget.minimumValue}–${plan.budget.value} ${unit}`
    : `${plan.budget.constraint === "maximum" ? m.sumUpTo : "~"} ${plan.budget.value} ${unit}`) + scope;
  const difficulty = { unknown: "", easy: m.sumEasy, adventure: m.sumMedium, hard: m.sumHard }[plan.difficulty];
  const style = plan.rideStyle === "unknown" ? ""
    : plan.rideStyle === "direct" && plan.includeSightseeing ? m.sumTourism
    : plan.rideStyle === "explore" && !plan.includeSightseeing ? m.sumSport
    : plan.rideStyle === "balanced" && plan.includeSightseeing ? m.sumMix
    : ({ direct: m.sumDirect, balanced: m.sumBalanced, explore: m.sumExplore })[plan.rideStyle];
  const surface = plan.gravelPreference !== null && plan.gravelPreference <= 10 && plan.trailPreference === "none" ? m.sumAsphaltOnly
    : plan.preferForest && (plan.gravelPreference ?? 0) >= 90 && plan.trailPreference === "lots" ? m.sumForest
    : plan.gravelPreference !== null ? m.sumGravelFine : "";
  const details = [places, plan.directionPlace ? `${plan.directionPlace} ${m.sumDirection}` : "", budget, difficulty, style, surface,
    plan.maxRepeatedPercent !== null ? `${m.sumRepeatAtMost} ${plan.maxRepeatedPercent}%` : "",
    plan.prioritizeLowOverlap && plan.maxRepeatedPercent === null ? m.sumLessRetracing : "",
    plan.surroundings === "more" ? m.sumMoreAround : "",
    plan.noSand ? m.sumNoSand : "",
    plan.avoidTowns ? m.sumAvoidTowns : "",
    plan.avoidMainRoads ? m.sumAvoidMainRoads : "",
    plan.accessPolicy === "allow_unverified" ? m.sumAllowUnverified : m.sumVerifiedAccess,
  ];
  return details.filter(Boolean).join(" · ");
}
