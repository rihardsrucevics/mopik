import { z } from "zod";
import { messages } from "@/lib/i18n/messages";
import type { UiLocale } from "@/lib/i18n/locale";
import { RouteIntentSchema, type RouteIntent, type UnreachableStop } from "@/lib/types";
import { MAX_SHAPE_POINTS, MAX_STOPS } from "@/lib/chat/ride-limits";

export const RidePlanSchema = z.object({
  startPlace: z.string().max(160).nullable(),
  viaPlaces: z.array(z.string().min(1).max(160)).max(MAX_STOPS),
  /**
   * Shaping points („maršruta punkti”, 2026-09-25): where the rider bent the
   * drawn line by grabbing it, in riding order. Not places — no name, no row,
   * no GPX waypoint — only points the router rides through. `afterPlace` is
   * the index of the place each follows in `[start, ...viaPlaces]` (0: after
   * the start, before the first stop), which is what keeps them in the right
   * leg when the plan is rebuilt from names.
   *
   * Optional, and absent rather than empty when there are none: a plan
   * without them encodes exactly as it always has, so the share codes and the
   * saved-ride ids made before this field existed do not change.
   */
  shapePoints: z.array(z.object({
    lat: z.number().min(-90).max(90),
    lon: z.number().min(-180).max(180),
    afterPlace: z.number().int().min(0).max(MAX_STOPS),
  })).max(MAX_SHAPE_POINTS).optional(),
  destinationPlace: z.string().max(160).nullable(),
  /**
   * "Man vienalga" — the rider was asked where the one-way ride should
   * finish and said anywhere. Distinct from a plain null destination, which
   * only means nobody has said yet: without this flag the chat asks the same
   * question again, which is exactly what backlog item 23 reported (one-way,
   * ~100 km along the Italian TET from Como, "Vienalga", asked again).
   *
   * The form has had this answer all along — the second row's placeholder is
   * "Nav obligāts — man vienalga" — and it produces the same plan shape:
   * `returnToStart` false, `destinationPlace` null. The ride is then planned
   * from the start, the distance and the direction hints.
   */
  destinationAny: z.boolean().default(false),
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
/**
 * A tap target. `action` is handled on the client instead of being sent to
 * the chat.
 *
 * `remove-stop` and `move-stop` (2026-09-19) carry a `stop`: a pin the
 * profile cannot ride to is a dead end unless the rider is given the two ways
 * out, and both are edits to the ride rather than something to ask the model
 * about. `move-stop` is only ever offered with `stop.snappedTo` set and
 * `stop.canMove` true — see `lib/routing/routable-point.ts` for the limit.
 */
export type ChatQuickReply = {
  label: string;
  message: string;
  /**
   * `drop-stops` / `easier-profile` (2026-09-25): the ways out of a ride no
   * candidate could route, when no single place is to blame.
   */
  action?: "show-routes" | "retry" | "direct-leg" | "remove-stop" | "move-stop" | "drop-stops" | "easier-profile";
  /** which place the action edits, for `remove-stop` / `move-stop` */
  stop?: UnreachableStop;
};
export type ChatResponse = { plan: RidePlan; message: string; ready: boolean; quickReplies: ChatQuickReply[] };
/**
 * Which fact the chat is missing. Carried on the prompt so the server can
 * tell what question it just asked without tracking conversation state: the
 * plan is the only thing that survives a turn, and `nextPlanPrompt` is
 * already the one place that decides what is missing.
 */
export type PendingQuestion = "start" | "return" | "destination" | "budget" | "difficulty" | "surface" | "style";
export type PlanPrompt = { question: PendingQuestion; message: string; quickReplies: ChatQuickReply[] };

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
  if (!plan.startPlace?.trim()) return { question: "start", message: t("No kurienes sāksim braucienu?", "Where will the ride start?"), quickReplies: [] };
  if (plan.returnToStart === null) return {
    question: "return",
    message: t(`Vai${context} beigās jāatgriežas ${plan.startPlace}?`, `Should${context} finish back at ${plan.startPlace}?`),
    quickReplies: [
      reply("Jā, atpakaļ", "Return to start", `Jā, beigās atgriezties ${plan.startPlace}.`, `Yes, finish back at ${plan.startPlace}.`),
      reply("Nē, vienā virzienā", "One way", "Nē, šis ir vienvirziena brauciens.", "No, this is a one-way ride."),
    ],
  };
  // "Vienalga" is an answer, not a silence: `destinationAny` means the rider
  // was asked and said anywhere, so the ride is planned from the start, the
  // distance and the direction hints — and the question is never asked again.
  if (!plan.returnToStart && !plan.destinationPlace?.trim() && !plan.destinationAny) return {
    question: "destination",
    message: t("Kur vēlies beigt šo vienvirziena braucienu?", "Where should this one-way ride finish?"),
    quickReplies: [reply("Man vienalga", "Anywhere", "Man vienalga, kur beidzas — izvēlies pats.", "Anywhere is fine — you choose.")],
  };
  if (plan.budget.mode === "unknown" || (["duration", "distance"].includes(plan.budget.mode) && !plan.budget.value)) return {
    question: "budget",
    message: t(`Cik daudz laika atvēlam${context}? Vari arī atstāt ilgumu brīvu.`, `How much time should we allow${context}? You can also leave it flexible.`),
    quickReplies: [
      reply("Apmēram 2 h", "About 2 h", "Apmēram 2 stundas.", "About 2 hours."),
      reply("Apmēram 4 h", "About 4 h", "Apmēram 4 stundas.", "About 4 hours."),
      reply("Ilgums brīvs", "Flexible", "Ilgums ir brīvs.", "The duration is flexible."),
    ],
  };
  if (plan.budget.mode === "duration" && (plan.budget.value! < 0.5 || plan.budget.value! > 16)) return { question: "budget", message: t("Varu plānot 30 minūšu līdz 16 stundu braucienu. Kādu ilgumu izvēlamies?", "I can plan rides from 30 minutes to 16 hours. What duration should we use?"), quickReplies: [] };
  if (plan.budget.mode === "distance" && plan.budget.value! < 20) return { question: "budget", message: t("Distances mērķis sākas no 20 km. Vai der 20 km, vai izvēlamies ilgumu?", "The distance target starts at 20 km. Would 20 km work, or shall we use a duration?"), quickReplies: [] };
  if (plan.budget.constraint === "range" && (plan.budget.minimumValue === null || plan.budget.value === null || plan.budget.minimumValue > plan.budget.value)) return { question: "budget", message: t("Precizē intervālu — no cik līdz cik stundām vai kilometriem?", "Please clarify the range: from how many to how many hours or kilometres?"), quickReplies: [] };
  if (plan.difficulty === "unknown") return {
    question: "difficulty",
    message: t("Kādu tehnisko grūtību izvēlamies?", "Which technical difficulty should we use?"),
    quickReplies: [
      reply("Viegli", "Easy", "Izvēlos vieglu — bez svīšanas.", "Choose easy — no sweat."),
      reply("Vidēji", "Medium", "Izvēlos vidēju — ar smērēšanos.", "Choose medium — mud welcome."),
      reply("Grūti", "Hard", "Izvēlos grūtu — galīgi rukši.", "Choose hard — proper pigs."),
    ],
  };
  if (plan.gravelPreference === null) return {
    question: "surface",
    message: t("Kādu ceļu seguma raksturu vēlies?", "What kind of roads do you prefer?"),
    quickReplies: [
      reply("Tikai asfalts", "Asphalt only", "Segums: Tikai asfalts.", "Surface: Asphalt only."),
      reply("Der arī grants", "Gravel is fine", "Segums: Der arī grants.", "Surface: Gravel is fine."),
      reply("Meži", "Forest", "Segums: Meži.", "Surface: Forest."),
    ],
  };
  if (plan.rideStyle === "unknown") return {
    question: "style",
    message: t("Kādu braukšanas stilu izvēlamies?", "Which riding style should we use?"),
    quickReplies: [
      reply("Tūrisms", "Tourism", "Stils: Tūrisms.", "Style: Tourism."),
      reply("Sports", "Sport", "Stils: Sports.", "Style: Sport."),
    ],
  };
  return null;
}

/**
 * "Anywhere" in the four languages Mopik speaks, plus the English a rider
 * abroad reaches for.
 *
 * Kept as a list rather than one regex because it is a vocabulary, not a
 * pattern: the rider adds to it when he hears a phrasing Mopik missed, and a
 * test pins every entry. Matching is case-insensitive and punctuation-
 * tolerant ("Vienalga.", "vienalga!", "Nu, vienalga") — the rider types on a
 * phone and the screenshots in backlog item 23 show exactly one word.
 *
 * Deliberately conservative: each phrase means "you pick", never "no" or a
 * place name. "Nav svarīgi" is here; a bare "nē" is not, because on the
 * return question it means the opposite of anywhere.
 */
export const ANY_ANSWERS = [
  // lv
  "vienalga", "man vienalga", "vienalga kur", "jebkur", "jebkura vieta", "nav svarīgi",
  "nav svarigi", "nav nozīmes", "kur sanāk", "kur sanak", "kur iznāk", "izvēlies pats",
  "izvēlies pati", "izvelies pats", "izvelies pati", "izlem pats", "tu izvēlies",
  // lt
  "nesvarbu", "bet kur", "man nesvarbu", "kur nors", "tu pasirink",
  // et
  "ükskõik", "ukskoik", "pole tähtis", "pole tahtis", "ükskõik kuhu", "sina vali",
  // en
  "anywhere", "any", "anyplace", "don't care", "dont care", "do not care",
  "you choose", "you pick", "whatever", "up to you", "your choice", "doesn't matter",
  "doesnt matter", "does not matter", "no preference",
] as const;

/**
 * Whether a rider's reply is one of those "anywhere" answers.
 *
 * The whole message must be the answer (after stripping punctuation and
 * filler): "vienalga" is an answer, but "vienalga, tikai ne uz Jūrmalu" is a
 * constraint the model has to read, and "man vienalga patīk Cēsis" is a
 * place. So a phrase is accepted only when it is the entire reply, or the
 * reply is that phrase with a short polite lead-in.
 */
export function isAnyAnswer(text: string): boolean {
  const cleaned = text
    .toLocaleLowerCase("lv")
    // Punctuation and quotes go; letters (with diacritics), digits and spaces stay.
    .replace(/[^\p{L}\p{N}\s']/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    // A lead-in the rider types without meaning anything by it. "No" is not
    // one of them in either language: in English it is a refusal, and in
    // Latvian it is a preposition that starts a real answer ("no Rīgas").
    .replace(/^(nu|tad|ok|okay|labi|well|hmm|eee)\s+/u, "")
    .trim();
  if (!cleaned) return false;
  return ANY_ANSWERS.some((phrase) => cleaned === phrase.toLocaleLowerCase("lv"));
}

/**
 * The question the chat asked on the previous turn — the one the rider is
 * answering now.
 *
 * Inferred from the previous plan rather than tracked in a field: the chat is
 * stateless between turns except for the plan it carries, and `nextPlanPrompt`
 * is already the single place that decides what is missing, so asking it about
 * the plan as it stood before this message gives the pending question without
 * a second copy of the ordering to keep in step.
 */
export function pendingQuestion(plan: RidePlan | null): PendingQuestion | null {
  return plan ? nextPlanPrompt(plan, false)?.question ?? null : null;
}

/**
 * Apply an "anywhere" reply to the question it answers — before the model,
 * and whatever the model makes of the word.
 *
 * Backlog item 23: the chat asked where a one-way ride should finish, the
 * rider said "Vienalga", and the chat asked again, because nothing in the
 * plan could hold "the rider does not mind". Each question that has an
 * "anything" answer resolves to the planner's own default, and each one is
 * named here rather than left to interpretation:
 *
 * - destination → none. The same plan the form's "Nav obligāts — man
 *   vienalga" row builds: `returnToStart` false, `destinationPlace` null, and
 *   now `destinationAny` so the question is not asked a third time. The ride
 *   is planned from the start, the distance/duration and the direction hints.
 * - return → the planner's default, which is a round trip. The form's
 *   trip-type row defaults to one way, but a chat that has got this far has a
 *   start and no finish, and a ride that ends nowhere in particular is a loop
 *   home rather than a one-way into the dark. Said out loud in the reply.
 * - budget → flexible, which `normalizePlan` already did for "vienalga" and
 *   which is repeated here so every question answers in one place.
 *
 * Difficulty, surface and style are deliberately absent: they have visible
 * defaults the plan already carries, so they never reach the rider as a
 * question with nothing behind it.
 *
 * Returns the plan unchanged when the reply is not an "any" answer, or when
 * the pending question has no such default.
 */
export function applyAnyAnswer(plan: RidePlan, pending: PendingQuestion | null, reply: string): RidePlan {
  if (!pending || !isAnyAnswer(reply)) return plan;
  if (pending === "destination") return { ...plan, destinationPlace: null, destinationAny: true };
  if (pending === "return") return { ...plan, returnToStart: true };
  if (pending === "budget") return { ...plan, budget: { mode: "flexible", value: null, constraint: "target", minimumValue: null } };
  return plan;
}

/**
 * Never ask the same question twice.
 *
 * The rider answered something; if the chat comes back with the identical
 * sentence, the answer was not placed, and repeating the question tells them
 * nothing about why. The second time it must offer the choices it can take —
 * name a place, or say "vienalga" and the planner picks.
 *
 * Generic on purpose: this is the guard for every question, not only the
 * destination one. It compares the question about to be sent against the last
 * thing the assistant said, ignoring case, punctuation and whitespace, so a
 * re-worded-but-identical repeat is caught too.
 */
function sameSentence(a: string, b: string): boolean {
  const norm = (s: string) => s.toLocaleLowerCase("lv").replace(/[^\p{L}\p{N}]+/gu, " ").trim();
  return norm(a) === norm(b);
}

/**
 * The previous assistant turn's last question, if it asked one. The chat's
 * replies lead with "Sapratu: …" and end with the question, so the question
 * is the last line that ends in a question mark.
 */
export function lastAssistantQuestion(messages: readonly ChatMessage[]): string | null {
  const last = [...messages].reverse().find((m) => m.role === "assistant");
  if (!last) return null;
  const line = last.content.split("\n").map((l) => l.trim()).filter(Boolean).reverse().find((l) => l.includes("?"));
  return line ?? null;
}

/**
 * The prompt to send, given what was said last turn: the prompt itself, or —
 * when it would repeat the previous question word for word — the same
 * question with the concrete choices spelled out.
 */
export function withoutRepeat(prompt: PlanPrompt, previousQuestion: string | null, plan: RidePlan, lv: boolean): PlanPrompt {
  if (!previousQuestion || !sameSentence(prompt.message, previousQuestion)) return prompt;
  const t = (a: string, b: string) => (lv ? a : b);
  // What the planner would do with "vienalga", said in the ride's own terms:
  // "~100 km pa TET no Komo" is an offer, "vienalga" alone is a shrug.
  const budget = plan.budget.mode === "duration" && plan.budget.value ? `~${plan.budget.value} h`
    : plan.budget.mode === "distance" && plan.budget.value ? `~${plan.budget.value} km` : null;
  const tet = plan.includeTet ? t(" pa TET", " along the TET") : "";
  const from = plan.startPlace ? t(` no ${plan.startPlace}`, ` from ${plan.startPlace}`) : "";
  const offer = prompt.question === "destination"
    ? t(
        `Nosauc vietu, vai saki “vienalga” — tad izvēlēšos pats${tet}${budget ? ` ${budget}` : ""}${from}.`,
        `Name a place, or say "anywhere" — then I will choose${tet}${budget ? `, ${budget}` : ""}${from}.`)
    : t("Nosauc, ko izvēlies, vai saki “vienalga” un izvēlēšos pats.", "Tell me which you would like, or say “anywhere” and I will choose.");
  return { ...prompt, message: `${prompt.message} ${offer}` };
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
  // A one-way ride the rider left open ends somewhere the planner picks; say
  // so, or the summary reads like a ride with no finish at all.
  const finish = plan.returnToStart ? plan.startPlace
    : plan.destinationPlace ?? (plan.destinationAny ? m.chatAnyDestination : null);
  const places = [plan.startPlace, ...(focus ? [focus] : []), ...plan.viaPlaces, finish].filter(Boolean).join(" → ");
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
