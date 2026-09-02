import OpenAI from "openai";
import { RouteIntent, RouteIntentSchema } from "@/lib/types";

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
  "avoidMotorways": boolean,                       // default true
  "avoidMainRoads": boolean,                       // default false
  "returnToStart": boolean,                        // default true
  "includeTet": boolean                            // default false — true when the rider mentions the TET / Trans Euro Trail
}

Interpret vague terms conservatively.

"easy off-road" means mostly paved/gravel roads and good quality tracks -> difficulty "easy".
"hard adventure" / "hardcore" may include rough tracks -> difficulty "hard", but never request legally restricted roads.
"raustītās līnijas" / "dashed lines" / "tracks" means gravel & forest tracks -> raise gravelPreference.
"punktotās līnijas" / "dotted lines" / "trails" means single-track paths -> set trailPreference ("bez punktotajām" -> "none", "nedaudz punktoto" -> "some", "daudz punktoto" / hardcore -> "lots").
"TET" / "Trans Euro Trail" means the rider wants to follow part of that trail -> includeTet true.
The user may write in Latvian, English, Lithuanian, Estonian or Russian.
Never put start or destination locations into the JSON — they are provided separately as structured fields.

If the user provides duration but not distance, leave distanceKm unset and set durationHours.

Always preserve explicit user constraints.`;

/**
 * Heuristic fallback parser used when OPENAI_API_KEY is not configured
 * or the LLM call fails. Good enough to demo the flow.
 */
export function parseRoutePromptHeuristic(prompt: string): RouteIntent {
  const p = prompt.toLowerCase();

  const kmMatch = p.match(/(\d{2,3})\s*km/);
  const hoursMatch = p.match(/(\d+(?:[.,]\d+)?)\s*(?:h\b|hour|stund)/);
  const gravelMatch = p.match(/(\d{1,3})\s*%\s*(?:gravel|grants|unpaved|off)/);

  let difficulty: RouteIntent["difficulty"] = "easy";
  if (/hard|hardcore|grūt|smag|rough|technical/.test(p)) difficulty = "hard";
  else if (/adventure|advent/.test(p)) difficulty = "adventure";

  let gravelPreference = 40;
  if (gravelMatch) gravelPreference = Math.min(100, parseInt(gravelMatch[1], 10));
  else if (/daudz grants|lots of gravel|mostly gravel|pārsvarā grants|raustīt/.test(p))
    gravelPreference = 65;
  else if (/bez grants|no gravel|only asphalt|tikai asfalt/.test(p)) gravelPreference = 0;

  let trailPreference: RouteIntent["trailPreference"] = "none";
  if (/daudz punktot|lots of trails|hardcore|single[- ]?track/.test(p)) trailPreference = "lots";
  else if (/nedaudz punktot|mazliet punktot|some trails|var .{0,10}punktot/.test(p))
    trailPreference = "some";

  return RouteIntentSchema.parse({
    routeType: "round_trip",
    distanceKm: kmMatch ? parseInt(kmMatch[1], 10) : undefined,
    durationHours: hoursMatch
      ? parseFloat(hoursMatch[1].replace(",", "."))
      : undefined,
    difficulty,
    gravelPreference,
    trailPreference,
    avoidMotorways: true,
    avoidMainRoads: /avoid main|bez lielajiem|bez lielaj|no main roads/.test(p),
    returnToStart: true,
    includeTet: /\btet\b|trans[- ]?euro[- ]?trail/.test(p),
  });
}

/**
 * prompt -> structured RouteIntent.
 * The LLM never generates coordinates; it only interprets intent.
 */
export async function parseRoutePrompt(prompt: string): Promise<RouteIntent> {
  if (!process.env.OPENAI_API_KEY) {
    return parseRoutePromptHeuristic(prompt);
  }

  try {
    const client = new OpenAI();
    const completion = await client.chat.completions.create({
      model: process.env.OPENAI_MODEL ?? "gpt-4o-mini",
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: prompt },
      ],
    });

    const raw = completion.choices[0]?.message?.content;
    if (!raw) throw new Error("Empty LLM response");

    const parsed = RouteIntentSchema.safeParse(JSON.parse(raw));
    if (!parsed.success) throw new Error("LLM response failed schema validation");
    return parsed.data;
  } catch (err) {
    console.warn("LLM intent parsing failed, using heuristic fallback:", err);
    return parseRoutePromptHeuristic(prompt);
  }
}

/** Estimate distance from duration using rough average speeds per profile. */
export function resolveTargetDistanceKm(intent: RouteIntent): number {
  if (intent.distanceKm) return intent.distanceKm;
  if (intent.durationHours) {
    const avgSpeed =
      intent.difficulty === "hard" ? 35 : intent.difficulty === "adventure" ? 45 : 55;
    return Math.round(intent.durationHours * avgSpeed);
  }
  return 150;
}
