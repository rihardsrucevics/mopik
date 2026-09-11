import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { RouteIntent, RouteIntentSchema } from "@/lib/types";
import { plannedAvgSpeedKmh } from "@/lib/routing/speed";

const SYSTEM_PROMPT = `You convert motorcycle trip requests into structured routing parameters.

The product is designed for adventure and enduro motorcycle trips in the Baltics.

Never invent roads, GPS coordinates or map data.

Your job is only to interpret the user's intent.

Return ONLY a JSON object with these fields (all optional unless stated):

{
  "routeType": "round_trip" | "point_to_point",   // default "round_trip"
  "distanceKm": number,                            // 20-600
  "durationHours": number,                         // 0.5-16
  "difficulty": "easy" | "adventure" | "hard",     // default "easy"
  "gravelPreference": number,                      // 0-100, % of unpaved the rider wants
  "trailPreference": "none" | "some" | "lots",     // appetite for trail / single-track ("dotted line") segments, default "none"
  "preferForest": boolean,                         // true when forest riding is requested
  "includeSightseeing": boolean,                   // true only for explicitly requested tourist stops
  "directionPlace": string | null,                 // nominative direction, e.g. Ropaži in "to Ropazi direction and back"
  "avoidMotorways": boolean,                       // default true
  "avoidMainRoads": boolean,                       // default false
  "noSand": boolean,                               // default false — true for "bez smiltīm", "no sand", "avoid deep sand"
  "avoidTowns": boolean,                           // default false — true for "avoid towns/cities", "bez pilsētām", "pa laukiem"
  "returnToStart": boolean,                        // default true
  "includeTet": boolean,                           // default false — true when the rider mentions the TET / Trans Euro Trail
  "startPlace": string | null,                     // nominative place name, see below
  "destinationPlace": string | null                // nominative, only for one-way rides
}

Interpret vague terms conservatively.

"easy off-road" means mostly paved/gravel roads and good quality tracks -> difficulty "easy".
"offroad ride", "off-road", "enduro", "pa mežiem", "meža ceļi" — the off-road IS the point of the ride: difficulty "adventure" (unless "easy" or "hard" is said), gravelPreference at least 85, trailPreference at least "some". Only call a ride "easy" when the rider says easy/viegls/relaxed or asks for asphalt.
"hard adventure" / "hardcore" may include rough tracks -> difficulty "hard", but never request legally restricted roads.
"raustītās līnijas" / "dashed lines" / "tracks" means gravel & forest tracks -> raise gravelPreference.
"punktotās līnijas" / "dotted lines" / "trails" means rough forest tracks and single-track -> set trailPreference ("bez punktotajām" -> "none", "nedaudz punktoto" -> "some", "daudz punktoto" / hardcore -> "lots").
"pa mežiem" / "meža ceļi" / "into the forest" / "forest tracks" also means trailPreference at least "some" ("maksimāli pa mežiem" -> "lots") together with a high gravelPreference.
"TET" / "Trans Euro Trail" means the rider wants to follow part of that trail -> includeTet true.
The user may write in Latvian, English, Lithuanian, Estonian or Russian.
Places: "startPlace" is where the ride starts and "destinationPlace" is where it ends (null for a round trip). Riders write Latvian place names in whatever grammatical case the sentence needs — "Siguldā", "ap Cēsīm", "no Tukuma", "līdz Valmierai" — so return the NOMINATIVE dictionary form with correct diacritics, as it appears on a map: "Sigulda", "Cēsis", "Tukums", "Valmiera". "uz Siguldas pusi" / "towards Sigulda" is a direction, not a destination. A country or region alone ("Latvijā", "in Latvia", "pa Kurzemi") is not a start place.

If the user provides duration but not distance, leave distanceKm unset and set durationHours.

Forest requests set preferForest true. "forest as much as possible" sets gravelPreference 100, but does not itself grant permission for single-track trails. Tourist stops are opt-in: leave includeSightseeing false unless requested. Preserve directionPlace independently of destinationPlace: "6h ride from Riga to Ropazi direction and back" is a round_trip starting in Rīga, directionPlace Ropaži, destinationPlace null.

Always preserve explicit user constraints.`;

/**
 * Where the ride starts, named in the prompt ("ride around Baldone").
 *
 * The start is stated in the description rather than in a separate field:
 * riders naturally say where they want to ride, and a separate Start field
 * that silently disagreed with the text is how a request for Baldone produced
 * a loop around Riga.
 *
 * Returns the place as written, for the caller to geocode.
 */
export function parseStartPlace(prompt: string): string | undefined {
  // Countries and regions are context, not a starting point — "around Baldone
  // in Latvia" starts at Baldone.
  // Any case form of a country or region ("Latvijā", "pa Kurzemi").
  const NOT_A_START =
    /^(latvia|latvij\w*|lithuania|lietuv\w*|estonia|igaunij\w*|baltics|baltij\w*|kurzem\w*|vidzem\w*|latgal\w*|zemgal\w*|forest|woods|mež\w*|the)$/i;

  const candidates: string[] = [];
  const patterns = [
    /\b(?:around|near|from|starting (?:from|at)|start at)\s+([\wāčēģīķļņšūž-]{3,})/gi,
    /\b(?:ap|pie|no|sākot no)\s+([\wāčēģīķļņšūž-]{3,})/gi,
    /\bin\s+([\wāčēģīķļņšūž-]{3,})/gi,
  ];
  for (const re of patterns) {
    for (const m of prompt.matchAll(re)) {
      if (m[1] && !NOT_A_START.test(m[1])) candidates.push(m[1]);
    }
  }
  if (candidates.length > 0) return candidates[0];

  // "Sāku Siguldā", "esmu Cēsīs": Latvian says where with the locative case
  // and no preposition at all. A capitalised word in -ā/-ē/-ī/-os/-ās/-īs/-us
  // after a verb of starting or being is the place. The geocoder then tries
  // the nominative forms.
  const locative =
    // (`\b` is ASCII-only in JavaScript, so it never matches after "ā";
    // the lookahead does the job.)
    /(?:^|[\s,.;])(?:s[āa]ku|s[āa]kot|s[āa]kam|esmu|esam|dz[īi]voju|start[ēe]ju|brauc[ou]s?)\s+([A-ZĀČĒĢĪĶĻŅŠŪŽ][\wāčēģīķļņšūž-]{2,}(?:[āēī]|os|ās|īs|us))(?=[\s,.;!?]|$)/iu;
  const m = locative.exec(prompt);
  if (m && !NOT_A_START.test(m[1])) return m[1];
  return undefined;
}

/** Direction is a search constraint, never a mandatory visit or an endpoint. */
export function parseDirectionPlace(prompt: string): string | undefined {
  for (const re of [
    /\b(?:towards?|in the direction of)\s+([\wāčēģīķļņšūž-]{3,})/iu,
    /\b(?:to|in)\s+([\wāčēģīķļņšūž-]{3,})\s+direction/iu,
    /\buz\s+([\wāčēģīķļņšūž-]{3,})\s+pusi/iu,
  ]) {
    const match = re.exec(prompt);
    if (match) return match[1];
  }
  return undefined;
}

/**
 * A destination named in the prompt ("from Riga to Cesis"), for one-way rides.
 * Absent means a round trip, which is the common case.
 */
export function parseDestinationPlace(prompt: string): string | undefined {
  if (/\b(?:and back|back to|return to)\b|atpaka[ļl]/iu.test(prompt)) return undefined;
  const direction = parseDirectionPlace(prompt);
  const NOT_A_PLACE =
    /^(latvia|latvija|lithuania|lietuva|estonia|igaunija|baltics|baltija|forest|woods|mež\w*|start|home|the)$/i;

  for (const re of [
    /\bto\s+([\wāčēģīķļņšūž-]{3,})/gi,
    /\buz\s+([\wāčēģīķļņšūž-]{3,})/gi,
    /\bl[īi]dz\s+([\wāčēģīķļņšūž-]{3,})/gi,
  ]) {
    for (const m of prompt.matchAll(re)) {
      // "uz Siguldas pusi" is a direction, not a destination.
      if (m[1] && m[1].toLowerCase() !== direction?.toLowerCase() && !NOT_A_PLACE.test(m[1]) && !/\bpusi\b/i.test(prompt.slice(m.index ?? 0, (m.index ?? 0) + 40))) {
        return m[1];
      }
    }
  }
  return undefined;
}

/**
 * Heuristic fallback parser used when OPENAI_API_KEY is not configured
 * or the LLM call fails. Good enough to demo the flow.
 */
/**
 * What the prompt actually says, with nothing invented.
 *
 * Fields the rider didn't mention come back undefined so the caller can fall
 * back to the form settings — the prompt overrides them, it doesn't replace
 * them wholesale. Returning defaults here is what made a mention of "woods"
 * silently reset distance to 150 km.
 */
export function parsePromptFields(prompt: string): Partial<RouteIntent> {
  const p = prompt.toLowerCase();

  const kmMatch = p.match(/(\d{2,3})\s*km/);
  const hoursMatch = p.match(/(\d+(?:[.,]\d+)?)\s*(?:h\b|hour|stund)/);
  // Minutes and "half an hour" were unmatched, so "30min" silently became the
  // 150 km default — a 5x error on the shortest, most specific request.
  const minutesMatch = p.match(/(\d{1,3})\s*(?:min\b|minūt|minut)/);
  const halfHour = /half[- ]?(?:an[- ]?)?hour|pusstund|pus stund/.test(p);
  const gravelMatch = p.match(/(\d{1,3})\s*%\s*(?:gravel|grants|unpaved|off)/);

  // Riding "in the woods" / "pa mežiem" is an off-road request even when no
  // difficulty or surface word appears — it used to leave the profile on
  // easy/40% gravel and route down main roads.
  // Latvian is often typed without diacritics ("meza celi"), so match both.
  const wantsWoods =
    /\bwoods?\b|\bforest\b|\bmež|\bmez[aāu]|\bsil[aāu]|off[- ]?road|meža ce|forest (?:road|track)/.test(
      p
    );

  const refusesUnpaved =
    /bez grants|no gravel|only asphalt|tikai asfalt|no off[- ]?road|paved only/.test(p);

  // Any request for unpaved riding implies the adventure profile: leaving it
  // on "easy" keeps the 90 km/h ceiling, and the router then prefers asphalt
  // no matter what the gravel preference says.
  const wantsUnpaved =
    !refusesUnpaved &&
    (wantsWoods ||
      /gravel|grants|unpaved|off[- ]?road|track|trail|punktot|raustīt/.test(p));

  let difficulty: RouteIntent["difficulty"] | undefined;
  if (/hard|hardcore|grūt|smag|rough|technical/.test(p)) difficulty = "hard";
  else if (/adventure|advent/.test(p) || wantsUnpaved) difficulty = "adventure";
  else if (refusesUnpaved || /\beasy\b|viegl/.test(p)) difficulty = "easy";

  // "dotted and dashed lines" is how riders describe trails and tracks on a
  // map, and the Latvian forms were handled while the English ones were not.
  const dashedOrDotted = /dashed|dotted|raustīt|punktot/.test(p);

  // "maximum gravel", "as much gravel as possible", "avoid asphalt" all mean
  // the same thing and all used to fall through to the 40% default, which is
  // how a request for maximum gravel produced a 1%-off-road route.
  // "maksimāli daudz pa mežu" and "minimum street" are the same request as
  // "maximum gravel". The Latvian superlative and the "minimum <paved>"
  // phrasing were both unmatched, so a max-forest request came out at 85%
  // and kept the speed ceiling too high to leave the asphalt.
  const maxUnpaved =
    /(?:forest|woods|gravel).{0,12}as much as possible/.test(p) ||
    /max(?:imum|imal|imāl|imali|imāli)?\s*(?:daudz\s*)?(?:pa\s*)?(?:gravel|grants|unpaved|off[- ]?road|dotted|dashed|forest|mež\w*|mez\w*|tak\w*)/.test(
      p
    ) ||
    /(?:as much|cik vien|maksimāli|maksimali).{0,24}(?:gravel|grants|dotted|dashed|forest|mež|mez|tak)/.test(
      p
    ) ||
    /min(?:imum|imāl\w*|imali)?\s*(?:street|road|asphalt|asfalt|paved|ielu|ceļu|celu)/.test(
      p
    ) ||
    /avoid\s+(?:asphalt|asfalt|paved|street)|izvair.{0,10}asfalt|bez asfalt/.test(p);

  let gravelPreference: number | undefined;
  if (gravelMatch) gravelPreference = Math.min(100, parseInt(gravelMatch[1], 10));
  else if (maxUnpaved) gravelPreference = 100;
  else if (wantsWoods || dashedOrDotted) gravelPreference = 85;
  else if (/daudz grants|lots of gravel|mostly gravel|pārsvarā grants/.test(p))
    gravelPreference = 65;
  else if (/bez grants|no gravel|only asphalt|tikai asfalt/.test(p)) gravelPreference = 0;

  // Refusing unpaved refuses trails too — otherwise "no gravel, only asphalt"
  // left trails to the form settings and could still route onto them.
  const noTrails =
    refusesUnpaved ||
    /bez punktot|bez tak|no trails|without trails|no single[- ]?track/.test(p);

  let trailPreference: RouteIntent["trailPreference"] | undefined;
  if (noTrails) {
    trailPreference = "none";
  } else if (
    // "single trails", "maximum dotted lines" and "max ... trails" all belong
    // here; the earlier pattern only matched hyphenated "single-track".
    // Includes the Latvian superlative and "meža takām" — asking for forest
    // trails is asking for lots of them, not "some".
    /daudz punktot|daudz tak|lots of trails|hardcore|single[- ]?track|single\s+trails?|max(?:imum|imal|imāl\w*|imali)?\s*(?:daudz\s*)?.{0,16}(?:trails?|dotted|dashed|tak\w*)|me[žz]a\s+tak/.test(
      p
    ) ||
    (maxUnpaved && /trail|tak\w*|dotted|punktot/.test(p))
  ) {
    trailPreference = "lots";
  } else if (/nedaudz punktot|mazliet punktot|some trails|var .{0,10}punktot/.test(p)) {
    trailPreference = "some";
  } else if (/\btrails?\b|\btak[aāu]m?\b|\btakas\b|punktot|dotted/.test(p)) {
    // A bare mention of trails ("with trails", "ar takām") is still a request
    // for them — without this it silently fell through to "none".
    trailPreference = "some";
  } else if (wantsWoods) {
    trailPreference = "some";
  }

  // Hours and minutes combine ("2 hours 30 min" is 2.5 h). Clamped to the
  // schema's range rather than left to throw: an out-of-range value used to
  // reject the whole parse, discarding every other understood field and
  // falling back to defaults — the opposite of what the rider asked for.
  const rawHours = hoursMatch
    ? parseFloat(hoursMatch[1].replace(",", ".")) +
      (minutesMatch ? parseInt(minutesMatch[1], 10) / 60 : 0)
    : minutesMatch
      ? parseInt(minutesMatch[1], 10) / 60
      : halfHour
        ? 0.5
        : undefined;
  const durationHours =
    rawHours === undefined ? undefined : Math.min(16, Math.max(0.5, rawHours));

  const distanceKm = kmMatch ? parseInt(kmMatch[1], 10) : undefined;
  const avoidMainRoads = /avoid main|bez lielajiem|bez lielaj|no main roads/.test(p)
    ? true
    : undefined;
  // "bez dziļām smiltīm" is one of the most common Baltic requests: sand is
  // where a loaded adventure bike goes down.
  const noSand = /bez (?:dziļ\w* )?smilt|no (?:deep )?sand|avoid (?:deep )?sand|without sand/.test(p)
    ? true
    : undefined;
  const avoidTowns =
    /avoid (?:towns?|cities|city|villages?|urban)|no (?:towns?|cities)|bez pilsēt|bez pilset|ārpus pilsēt|arpus pilset|pa laukiem|lauku ceļ|countryside only/.test(
      p
    )
      ? true
      : undefined;
  // Maximum forest is not an implicit request to follow the TET.
  const includeTet =
    /\btet\b|trans[- ]?euro[- ]?trail/.test(p) ? true : undefined;
  const avoidMotorways = /avoid (?:highway|motorway)|bez lielceļ|izvair.{0,12}lielce/.test(p)
    ? true
    : undefined;

  // Only what the prompt actually stated. Undefined fields let the caller keep
  // the rider's settings instead of overwriting them with defaults.
  return {
    ...(wantsWoods && !refusesUnpaved ? { preferForest: true } : {}),
    ...(/sightseeing|tourist (?:stops|attractions)|tūrisma objekt|turisma objekt/.test(p) && !/no sightseeing|without tourist|bez tūrisma|bez turisma/.test(p) ? { includeSightseeing: true } : {}),
    ...(distanceKm !== undefined ? { distanceKm } : {}),
    ...(durationHours !== undefined ? { durationHours } : {}),
    ...(difficulty !== undefined ? { difficulty } : {}),
    ...(gravelPreference !== undefined ? { gravelPreference } : {}),
    ...(trailPreference !== undefined ? { trailPreference } : {}),
    ...(avoidMotorways !== undefined ? { avoidMotorways } : {}),
    ...(avoidMainRoads !== undefined ? { avoidMainRoads } : {}),
    ...(noSand !== undefined ? { noSand } : {}),
    ...(avoidTowns !== undefined ? { avoidTowns } : {}),
    ...(includeTet !== undefined ? { includeTet } : {}),
  };
}

/**
 * Backwards-compatible full-intent parse: prompt fields on top of schema
 * defaults. Used where no form settings exist to merge with.
 */
export function parseRoutePromptHeuristic(prompt: string): RouteIntent {
  return RouteIntentSchema.parse({
    routeType: "round_trip",
    returnToStart: true,
    ...parsePromptFields(prompt),
  });
}

/** What the prompt says: the intent, plus the places it names (if the LLM ran). */
export type ParsedPrompt = {
  intent: RouteIntent;
  /** nominative, ready to geocode; undefined when unknown or when the LLM didn't run */
  startPlace?: string;
  destinationPlace?: string;
  directionPlace?: string;
  /** which parser produced this — surfaced for logging and tests */
  source: "llm" | "heuristic";
};

/**
 * What Claude returns. Place and existing preference fields are nullable rather than optional so the
 * structured-output schema stays strict; nulls are stripped before merging so
 * an unstated field leaves the rider's settings alone. The two new boolean
 * fields are non-nullable to stay below the provider's 16-union limit.
 */
const LlmIntentSchema = z.object({
  routeType: z.enum(["round_trip", "point_to_point"]).nullable(),
  distanceKm: z.number().nullable(),
  durationHours: z.number().nullable(),
  difficulty: z.enum(["easy", "adventure", "hard"]).nullable(),
  gravelPreference: z.number().nullable(),
  trailPreference: z.enum(["none", "some", "lots"]).nullable(),
  preferForest: z.boolean(),
  includeSightseeing: z.boolean(),
  directionPlace: z.string().nullable(),
  avoidMotorways: z.boolean().nullable(),
  avoidMainRoads: z.boolean().nullable(),
  noSand: z.boolean().nullable(),
  avoidTowns: z.boolean().nullable(),
  returnToStart: z.boolean().nullable(),
  includeTet: z.boolean().nullable(),
  startPlace: z.string().nullable(),
  destinationPlace: z.string().nullable(),
});

/**
 * The same prompt is parsed again on "Generate another" and when the rider
 * tweaks a setting, so keep recent parses. Bounded; this is a single server.
 */
const llmCache = new Map<string, z.infer<typeof LlmIntentSchema>>();
const LLM_CACHE_MAX = 200;

let anthropic: Anthropic | null = null;

async function parseWithClaude(prompt: string): Promise<z.infer<typeof LlmIntentSchema>> {
  const cached = llmCache.get(prompt);
  if (cached) return cached;

  // Identity-linked keys must name the workspace they act in; the SDK has no
  // option for it, so it goes on as a default header.
  anthropic ??= new Anthropic({
    defaultHeaders: process.env.ANTHROPIC_WORKSPACE_ID
      ? { "anthropic-workspace-id": process.env.ANTHROPIC_WORKSPACE_ID }
      : undefined,
  });
  const response = await anthropic.messages.parse({
    model: process.env.ANTHROPIC_MODEL ?? "claude-opus-5",
    max_tokens: 1024,
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: prompt }],
    // A short extraction: low effort keeps it fast and cheap; adaptive
    // thinking is on by default on this model.
    output_config: { effort: "low", format: zodOutputFormat(LlmIntentSchema) },
  });
  if (!response.parsed_output) {
    throw new Error(`Claude returned no parsable intent (stop_reason ${response.stop_reason})`);
  }

  if (llmCache.size >= LLM_CACHE_MAX) {
    const oldest = llmCache.keys().next().value;
    if (oldest !== undefined) llmCache.delete(oldest);
  }
  llmCache.set(prompt, response.parsed_output);
  return response.parsed_output;
}

/** Drop nulls so unstated fields fall through to the rider's settings. */
function stripNulls<T extends object>(o: T): Partial<{ [K in keyof T]: NonNullable<T[K]> }> {
  return Object.fromEntries(
    Object.entries(o).filter(([, v]) => v !== null && v !== undefined)
  ) as Partial<{ [K in keyof T]: NonNullable<T[K]> }>;
}

/**
 * Form settings plus whatever the prompt states, prompt winning.
 *
 * The prompt is the primary input and the settings are its defaults, so a
 * rider who writes "2h, lots of gravel" gets that whatever the controls say,
 * while everything they didn't mention comes from the controls.
 *
 * Claude interprets the text when `ANTHROPIC_API_KEY` is set (it is what
 * understands "ap Cēsīm" as Cēsis and "bez dziļām smiltīm" as noSand); the
 * regex heuristic is the fallback. The LLM never generates coordinates; it
 * only interprets intent and names places.
 */
export async function parseRoutePrompt(
  prompt: string,
  settings?: Partial<RouteIntent>
): Promise<ParsedPrompt> {
  const base = { routeType: "round_trip" as const, returnToStart: true, ...settings };

  const heuristic = (): ParsedPrompt => ({
    intent: RouteIntentSchema.parse({ ...base, ...parsePromptFields(prompt) }),
    directionPlace: parseDirectionPlace(prompt),
    source: "heuristic",
  });

  if (!prompt.trim()) return { intent: RouteIntentSchema.parse(base), source: "heuristic" };
  if (!process.env.ANTHROPIC_API_KEY) return heuristic();

  try {
    const { startPlace, destinationPlace, directionPlace, ...fields } = stripNulls(await parseWithClaude(prompt));
    // Clamped rather than rejected: an out-of-range number must not discard
    // every other understood field.
    if (fields.distanceKm !== undefined) fields.distanceKm = Math.min(600, Math.max(20, fields.distanceKm));
    if (fields.durationHours !== undefined) fields.durationHours = Math.min(16, Math.max(0.5, fields.durationHours));
    if (fields.gravelPreference !== undefined) fields.gravelPreference = Math.min(100, Math.max(0, fields.gravelPreference));

    const parsed = RouteIntentSchema.safeParse({ ...base, ...fields });
    if (!parsed.success) throw new Error("Claude's intent failed schema validation");
    return {
      intent: parsed.data,
      startPlace: startPlace?.trim() || undefined,
      destinationPlace: destinationPlace?.trim() || undefined,
      directionPlace: directionPlace?.trim() || parseDirectionPlace(prompt),
      source: "llm",
    };
  } catch (err) {
    console.warn("LLM intent parsing failed, using heuristic fallback:", err);
    return heuristic();
  }
}

/**
 * Planning speed for turning a duration into a target distance. Lives in
 * `lib/routing/speed.ts` with the per-way speeds the displayed riding time
 * uses, so the two can no longer drift apart.
 */
export function expectedAvgSpeedKmh(intent: RouteIntent): number {
  return plannedAvgSpeedKmh(intent);
}

export function resolveTargetDistanceKm(intent: RouteIntent): number {
  if (intent.distanceKm) return intent.distanceKm;
  if (intent.durationHours) {
    const avgSpeed = expectedAvgSpeedKmh(intent);
    return Math.round(intent.durationHours * avgSpeed);
  }
  return 150;
}
