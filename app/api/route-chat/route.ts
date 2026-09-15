import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { NextResponse } from "next/server";
import { ChatMessageSchema, RidePlanSchema, applyAnyAnswer, isAnyAnswer, lastAssistantQuestion, nextPlanPrompt, pendingQuestion, planSummary, planToIntent, withoutRepeat, type ChatQuickReply, type RidePlan } from "@/lib/chat/ride-plan";
import { estimateTransit, lookupPlace } from "@/lib/chat/photon";
import { describeInfeasible, estimateLegs, exceedsBudget } from "@/lib/chat/feasibility";
import { plannedAvgSpeedKmh } from "@/lib/routing/speed";

export const maxDuration = 60;
const RequestSchema = z.object({
  messages: z.array(ChatMessageSchema).min(1).max(40),
  plan: RidePlanSchema.nullable().optional(),
});
const OutputSchema = z.object({
  plan: RidePlanSchema,
  language: z.enum(["lv", "en"]),
  clarification: z.string().nullable(),
  /**
   * The rider's goal in one plain sentence, in their language, without a
   * "Got it" prefix — e.g. "no Rīgas līdz Baldones mežiem, tur meža aplis pa
   * takām, un atpakaļ Rīgā". Shown back so a misreading is caught before a
   * map is drawn, not after.
   */
  understanding: z.string().max(300),
});
const SYSTEM = `You help plan a motorcycle ride in Latvia/Baltics. Extract the FULL current ride plan from the conversation and previous plan. Later user corrections replace earlier constraints; otherwise preserve them. Return structured data, not coordinates. Place names must be nominative with correct diacritics (Kekava -> Ķekava, Baldone -> Baldone).
PLACE NAMES ARE THE PLACE'S OWN NAME, AS OSM KNOWS IT — never a translation or an exonym, whatever language the rider writes in. The rider's "Komo ezers" is startPlace "Como"; "Milāna" is "Milano", "Roma" is "Roma", "Varšava" is "Warszawa", "Minhene" is "München". Latvian places keep their Latvian names (Rīga stays Rīga, Cēsis stays Cēsis) because that IS their own name. Drop a descriptive word the name does not contain ("Komo ezers" -> "Como", "Baldones meži" -> "Baldone"). A translated name does not geocode: "Komo ezers" resolves to a street in Latgale, 800 km from Italy, and the ride is planned there instead.
Never treat assistant suggestions as accepted unless the user accepts them. Unknown is a real state for route-specific facts such as start, destination, return and budget. Ask via clarification only for an ambiguity/conflict or a request the planner cannot represent. New guest plans use the same visible adventure-bike defaults as the form after extraction: adventure difficulty, riding/explore style, 55% gravel, some trails and verified access. A forest/trail request may allow unverified neutral paths. Explicit user choices always replace defaults.
"From Kekava to Baldone and back to Kekava" means start Ķekava, viaPlaces [Baldone], returnToStart true, destinationPlace null. "Through X" is a mandatory via.
FOCUS AREA (the playground): when the rider wants to RIDE AROUND somewhere other than the start — "atrodi meža apli Baldones mežos un uztaisi maršrutu no Rīgas pa to apli un atpakaļ", "no Rīgas, izbraukāt Ķeguma mežus", "a forest loop near Sigulda, starting in Riga", "pabraukāt pa X apkārtni" — set focusArea to that place (nominative, the town: "Baldone", not "Baldones meži"), startPlace to the start, returnToStart true, and do NOT put the place in viaPlaces. The planner then rides there directly, loops around it with the forest settings, and returns another way. A focus area only exists when the fun part is clearly elsewhere; "from Riga through Baldone and back" is a plain via, and "around Baldone" with no other start means startPlace Baldone and no focusArea. "Foršs meža aplis", "pa mežiem", "pa takām", "meža ceļi" mean the Meži choice in full (gravel 100, lots of trails, preferForest, avoidMainRoads, allow_unverified) and explore style unless the rider says otherwise.
budgetScope: "total" unless the rider says the time is for the loop only ("2 h tikai aplim", "2 h mežā, pārbrauciens neskaitās", "two hours in the forest itself"), then "focus". Preserve on later turns.
surroundings: "more" when the rider wants to ride around a stop more than the default ("vairāk apkārtnes", "izbraukāt Baldones apkārtni", "more exploring around Baldone", "pabraukāt apkārt"); "some" otherwise and preserved on later turns.
understanding: ALWAYS one sentence in the rider's language that restates the goal as a rider would say it (start, where the fun part is, what kind of riding, back or not). No prefix, no numbers the rider did not give. "Towards X / X direction / uz X pusi" is directionPlace, not a mandatory visit. For a one-way ride put the final place in destinationPlace, intermediate places in viaPlaces. Preserve the order of mandatory places. Around/ap implies returning. When return is not specified, use null unless the surrounding conversation resolves it.
Budget: duration values are HOURS; distance values are KM. "Up to / no more than / ne vairāk / līdz" is maximum, "about / ~ / ap" is target. For a range such as "2-3h" or "no 2 līdz 3 stundām", use constraint range, minimumValue 2, value 3 (not a midpoint). minimumValue is null for target/maximum. Flexible is only when user explicitly says no fixed duration/distance; do not substitute flexible for missing. A later duration replaces an earlier distance, and vice versa.
Difficulty: "vidējs" means adventure. rideStyle: direct means reaching places without exploration detours; explore means spending time exploring winding forest roads; balanced means a moderate mix. "visu laiku virzīties uz to pusi", "nekur lieki nebraukāt", "bez liekiem līkumiem" and "taisnāk" mean direct. "as much forest as possible" sets preferForest true and gravelPreference 100 but does not alone decide rideStyle. "krustu šķērsu / explore the woods / vairāk izpētīt" sets explore. "easy gravel" resolves difficulty and surface. Gravel mostly -> 85, mixed -> 50, asphalt only -> 0. trailPreference: none/some/lots only for trail requests; unknown otherwise. "dotted trails as much as possible" -> lots.
Visible choices have exact semantics: Viegli (also "Atpūta") -> easy; Vidēji (also "Piedzīvojums") -> adventure; Grūti / hardcore -> hard. Tūrisms -> direct + includeSightseeing; Sports (also "Braukšana") -> explore + no sightseeing; a legacy "Mix" -> balanced + includeSightseeing. Tikai asfalts -> gravel 0, no trails, verified access; Der arī grants -> gravel 55, some trails, verified access; Meži -> gravel 100, lots of trails, preferForest, avoidMainRoads, allow_unverified. Apply these choices exactly.
Avoiding repeated roads and returning by other trails is supported as an optimization preference; do not classify it as unsupported segment editing or add a disclaimer. "Less overlap / mazāk pārklāšanās" sets prioritizeLowOverlap true. Explicit "below 10% / zem 10%" sets maxRepeatedPercent 9.9; "at most 10%" sets 10. This is a supported constraint, preserve it on later turns until the user changes/removes it. Default maxRepeatedPercent null and prioritizeLowOverlap false. accessPolicy verified excludes OSM paths without positive motor access; allow_unverified permits unverified forest paths, never explicit prohibitions. "Atļaut nezināmas/nepārbaudītas takas" sets allow_unverified. Unmentioned avoidTowns, noSand, avoidMainRoads, includeTet, includeSightseeing are false in a NEW plan; preserve prior values otherwise. Tourist places and TET are optional unless named as required viaPlaces. Never claim a route exists, reaches a stop, or meets a time limit before routing.
"VIENALGA" IS AN ANSWER, NOT A SILENCE. "vienalga", "man vienalga", "jebkur", "nav svarīgi", "kur sanāk", "izvēlies pats" (lv), "nesvarbu", "bet kur" (lt), "ükskõik", "pole tähtis" (et), "anywhere", "don't care", "you choose", "whatever" (en) are valid answers. Asked where a one-way ride should finish, they mean NO FIXED DESTINATION: keep returnToStart false, destinationPlace null, set destinationAny true, and plan a one-way ride of the asked length from the start, following the direction hints (directionPlace, TET, the region named). Asked whether to return, they mean the default — returnToStart true. Asked how long, they mean budget flexible. Never answer them with the same question again.
NEVER ASK THE SAME QUESTION TWICE. If an answer cannot be placed, the next turn must not repeat the sentence: offer the concrete choices instead — "Nosauc vietu, vai saki “vienalga” — tad izvēlēšos pa TET ~100 km no Komo" / "Name a place, or say “anywhere” — then I will choose, ~100 km along the TET from Como".
If user asks to exclude a specific road/area or edit a precise map segment, this version cannot enforce that: retain other facts and use clarification to explain and ask for a representable alternative. Never silently drop such a request. Do not answer unrelated questions; keep conversation on the ride. language follows the user's language (lv or en).`;

function normalizePlan(extracted: RidePlan, previous: RidePlan | null, latest: string): RidePlan {
  const plan = structuredClone(extracted);
  const lower = latest.toLocaleLowerCase("lv");
  if (!previous) {
    if (plan.difficulty === "unknown") plan.difficulty = "adventure";
    if (plan.rideStyle === "unknown") plan.rideStyle = "explore";
    if (plan.gravelPreference === null) plan.gravelPreference = 55;
    if (plan.trailPreference === "unknown") plan.trailPreference = "some";
    plan.accessPolicy = /mež|forest|takas|trails|punktot/.test(lower) && !/pārbaudāma piekļuve|verified access|tikai pārbaud/.test(lower) ? "allow_unverified" : "verified";
  }
  const hours = lower.match(/(?:aptuveni|apmēram|~)\s*(\d+(?:[.,]\d+)?)\s*(?:h|stund)/)?.[1];
  if (hours) plan.budget = { mode: "duration", value: Number(hours.replace(",", ".")), constraint: "target", minimumValue: null };
  const maxHours = lower.match(/(?:ne vairāk kā|ne ilgāk kā|maksimums|līdz|no more than|at most|up to)\s*(\d+(?:[.,]\d+)?)\s*(?:h|stund|hour)/)?.[1];
  if (maxHours) plan.budget = { mode: "duration", value: Number(maxHours.replace(",", ".")), constraint: "maximum", minimumValue: null };
  if (/tikai aplim|tikai mežā|only (?:for )?the loop|in the forest itself/.test(lower)) plan.budgetScope = "focus";
  if (/vairāk apkārtn|apkārtni vairāk|izbraukāt .{0,25}apkārtni|more (?:of the )?surroundings|more around/.test(lower)) plan.surroundings = "more";
  if (/mazāk apkārtn|bez apkārtn|less around|no detours around/.test(lower)) plan.surroundings = "some";
  if (/stund\w*\s+kopā|hours? in total|kopā\s*[\d~]/.test(lower)) plan.budgetScope = "total";
  if (plan.focusArea && plan.startPlace && plan.focusArea.toLocaleLowerCase("lv") === plan.startPlace.toLocaleLowerCase("lv")) plan.focusArea = null;
  if (/ilgums (?:ir )?brīvs|duration is flexible/.test(lower)) plan.budget = { mode: "flexible", value: null, constraint: "target", minimumValue: null };
  if (/grūtību uz vieglu|izvēlos vieglu|izvēlos atpūtu|difficulty: relaxed|choose easy/.test(lower)) plan.difficulty = "easy";
  if (/vidēju adventure|grūtību uz adventure|izvēlos piedzīvojumu|difficulty: adventure|izvēlos vidēju|choose medium/.test(lower)) plan.difficulty = "adventure";
  if (/grūtību uz grūtu|izvēlos grūtu|choose hard|hardcore/.test(lower)) plan.difficulty = "hard";
  if (/visu laiku.{0,30}virz|nekur.{0,20}lieki nebrauk|bez liekiem līkumiem|braukt taisnāk|pa taisno/.test(lower)) plan.rideStyle = "direct";
  if (/stilu uz līdzsvarotu|līdzsvarotu braucienu/.test(lower)) plan.rideStyle = "balanced";
  if (/krustu šķērsu|vairāk izpēt|izpētīt mež|explor/.test(lower)) plan.rideStyle = "explore";
  if (/stils:\s*tūrisms|style:\s*tourism/.test(lower)) { plan.rideStyle = "direct"; plan.includeSightseeing = true; }
  if (/stils:\s*(?:braukšana|sports)|style:\s*(?:riding|sport)/.test(lower)) { plan.rideStyle = "explore"; plan.includeSightseeing = false; }
  if (/stils:\s*mix|style:\s*mix/.test(lower)) { plan.rideStyle = "balanced"; plan.includeSightseeing = true; }
  if (/segums:\s*tikai asfalts|surface:\s*asphalt only/.test(lower)) { plan.gravelPreference = 0; plan.preferForest = false; plan.trailPreference = "none"; plan.accessPolicy = "verified"; plan.avoidMainRoads = false; }
  if (/segums:\s*der arī grants|surface:\s*gravel is fine/.test(lower)) { plan.gravelPreference = 55; plan.preferForest = false; plan.trailPreference = "some"; plan.accessPolicy = "verified"; plan.avoidMainRoads = false; }
  if (/segums:\s*meži|surface:\s*forest/.test(lower)) { plan.gravelPreference = 100; plan.preferForest = true; plan.trailPreference = "lots"; plan.accessPolicy = "allow_unverified"; plan.avoidMainRoads = true; }
  if (/galvenokārt asfaltu/.test(lower)) { plan.gravelPreference = 10; plan.preferForest = false; plan.trailPreference = "none"; }
  if (/jauktu asfalta, grants un meža/.test(lower)) { plan.gravelPreference = 50; plan.preferForest = true; }
  if (/maksimāli daudz grants un meža/.test(lower)) { plan.gravelPreference = 100; plan.preferForest = true; }
  if (/neiekļaut takas/.test(lower)) plan.trailPreference = "none";
  if (/iekļaut dažas takas/.test(lower)) plan.trailPreference = "some";
  if (/iespējas daudz taku/.test(lower)) plan.trailPreference = "lots";
  if (/tikai takas ar pārbaudāmu|verified access only/.test(lower)) plan.accessPolicy = "verified";
  if (/takas ar nezināmu piekļuves|atļaut nepārbaudītas takas/.test(lower)) plan.accessPolicy = "allow_unverified";
  if (/beigās atgriezties (?:sākumpunktā|[a-zāčēģīķļņšūž]+)|finish back at/.test(lower)) plan.returnToStart = true;
  if (/vienvirziena brauciens|one-way ride/.test(lower)) {
    plan.returnToStart = false;
    // "Vienā virzienā Rīga → Jelgava" from the feasibility chips: the last
    // stop is where the ride ends now, whatever the model made of it.
    if (plan.viaPlaces.length && (!plan.destinationPlace || plan.destinationPlace === plan.viaPlaces[plan.viaPlaces.length - 1])) plan.destinationPlace = plan.viaPlaces.pop()!;
  }
  if (plan.budget.mode === "unknown" && /\b(nezinu|brīvs|brīvi|vienalga)\b/.test(lower)) {
    plan.budget = { mode: "flexible", value: null, constraint: "target", minimumValue: null };
  }
  // A destination fixes the useful route length, so a one-way ride does not
  // need a ceremonial duration question when the rider omitted a budget.
  if (plan.returnToStart === false && plan.destinationPlace && plan.budget.mode === "unknown") {
    plan.budget = { mode: "flexible", value: null, constraint: "target", minimumValue: null };
  }
  // "Vienalga" is an answer. The question it answers is the one the previous
  // plan was still missing, and the answer is applied here rather than left
  // to the model, which read the word as no information at all and asked the
  // same question again (backlog item 23). `destinationAny` survives a turn
  // where the rider says something else, so the question does not come back.
  if (previous?.destinationAny && !plan.destinationPlace) plan.destinationAny = true;
  // A place named later replaces "vienalga": the rider changed their mind.
  if (plan.destinationPlace) plan.destinationAny = false;
  return RidePlanSchema.parse(applyAnyAnswer(RidePlanSchema.parse(plan), pendingQuestion(previous), latest));
}

/**
 * "Think like a rider": a two-hour total with a 45-minute transit each way
 * leaves half an hour for the forest. Say so before drawing, with the two
 * honest ways out as tap targets. Asked once per budget, not every turn.
 */
async function transitCheck(plan: RidePlan, previous: RidePlan | null, lv: boolean, latest = "", pending: ReturnType<typeof pendingQuestion> = null): Promise<{ message: string; quickReplies: ChatQuickReply[] } | null> {
  if (!plan.focusArea || !plan.startPlace || !plan.returnToStart) return null;
  if (insists(latest, pending)) return null;
  if (plan.budget.mode !== "duration" || !plan.budget.value || plan.budgetScope !== "total") return null;
  const sameAsk = previous && previous.focusArea === plan.focusArea && previous.startPlace === plan.startPlace &&
    JSON.stringify(previous.budget) === JSON.stringify(plan.budget) && previous.budgetScope === plan.budgetScope;
  if (sameAsk) return null;
  const [start, focus] = await Promise.all([lookupPlace(plan.startPlace), lookupPlace(plan.focusArea)]);
  if (!start || !focus) return null;
  const transit = estimateTransit(start, focus);
  const loopHours = plan.budget.value - 2 * transit.hours;
  const MIN_LOOP_HOURS = 0.75;
  if (loopHours >= MIN_LOOP_HOURS) return null;
  const oneWay = Math.round(transit.hours * 60 / 5) * 5;
  const loopMin = Math.max(0, Math.round(loopHours * 60 / 5) * 5);
  const suggestTotal = Math.ceil((2 * transit.hours + 1.5) * 2) / 2;
  const h = plan.budget.value;
  const t = (a: string, b: string) => lv ? a : b;
  return {
    message: t(
      `Pārbrauciens ${plan.startPlace} → ${plan.focusArea} ir ap ${oneWay} min katrā virzienā, tāpēc ${h} h kopā mežam atstāj tikai ~${loopMin} min. Kā skaitam?`,
      `${plan.startPlace} to ${plan.focusArea} is about ${oneWay} min each way, so ${h} h in total leaves only ~${loopMin} min for the forest. How should we count it?`),
    quickReplies: [
      { label: t(`Kopā ${suggestTotal} h`, `${suggestTotal} h in total`), message: t(`Apmēram ${suggestTotal} stundas kopā.`, `About ${suggestTotal} hours in total.`) },
      { label: t(`${h} h tikai aplim`, `${h} h for the loop only`), message: t(`Apmēram ${h} stundas tikai aplim.`, `About ${h} hours for the loop only.`) },
    ],
  };
}

/**
 * The same arithmetic for a ride through named stops: Rīga → Jelgava → Rīga
 * on forest roads is ~105 km of direct legs, about 3 h at that pace, and a
 * 2 h request cannot hold it whatever the router tries (it routed at 4 h).
 * Say so before drawing, with the ways out as taps — more time, asphalt if
 * that fits, one way if that fits. Asked once per ask, not every turn; the
 * router's own verdict (`infeasible` in the response) covers a rider who
 * insists, and the composer, which never passes through here.
 */
/**
 * The rider has heard the arithmetic and wants the ride anyway.
 *
 * "Vienalga" is in the list and is also the word that answers "kur vēlies
 * beigt?" — the same word, two meanings, told apart by what was asked. When
 * the chat had a question pending, a bare "vienalga" is the answer to it
 * (backlog item 23) and must not silently wave the feasibility check through;
 * only a "vienalga" said to a *statement* means "ride it anyway".
 */
function insists(latest: string, pending: ReturnType<typeof pendingQuestion> = null): boolean {
  if (pending && isAnyAnswer(latest)) return false;
  return /\btomēr\b|\bvienalga\b|\bmēģini\b|\bmēģinām\b|\banyway\b|\btry (?:it|anyway)\b|\binsist/i.test(latest);
}

async function viaBudgetCheck(plan: RidePlan, previous: RidePlan | null, lv: boolean, latest: string, pending: ReturnType<typeof pendingQuestion> = null): Promise<{ message: string; quickReplies: ChatQuickReply[] } | null> {
  if (!plan.startPlace || plan.focusArea || plan.returnToStart === null) return null;
  if (insists(latest, pending)) return null;
  if (!plan.viaPlaces.length && !plan.destinationPlace) return null;
  if ((plan.budget.mode !== "duration" && plan.budget.mode !== "distance") || !plan.budget.value) return null;
  // Asked once per places-and-hours; "~2 h" after "līdz 2 h" is the same ask.
  const ask = (p: RidePlan) => JSON.stringify([p.startPlace, p.viaPlaces, p.destinationPlace, p.returnToStart, p.budget.mode, p.budget.value, p.gravelPreference, p.trailPreference, p.preferForest]);
  if (previous && ask(previous) === ask(plan)) return null;
  const names = [plan.startPlace, ...plan.viaPlaces, ...(plan.destinationPlace ? [plan.destinationPlace] : [])];
  const found = await Promise.all(names.map((name) => lookupPlace(name)));
  if (found.some((p) => !p)) return null;
  const points = found.map((p) => ({ lat: p!.lat, lon: p!.lon }));
  if (plan.returnToStart) points.push(points[0]);
  let intent;
  try { intent = planToIntent(plan); } catch { return null; }
  const estimate = estimateLegs(points, plannedAvgSpeedKmh(intent), plannedAvgSpeedKmh({ ...intent, gravelPreference: 0, trailPreference: "none" }), plan.returnToStart);
  return exceedsBudget(plan, estimate) ? describeInfeasible(plan, estimate, lv) : null;
}

function describeChanges(before: RidePlan | null, after: RidePlan, lv: boolean): string | null {
  if (!before) return null;
  const changes: string[] = [];
  const t = (a: string, b: string) => lv ? a : b;
  if (JSON.stringify(before.budget) !== JSON.stringify(after.budget)) changes.push(after.budget.mode === "flexible" ? t("ilgums brīvs", "flexible duration") : t("ilgums atjaunināts", "duration updated"));
  if (before.returnToStart !== after.returnToStart) changes.push(after.returnToStart ? t("atgriezties sākumā", "return to start") : t("vienā virzienā", "one way"));
  if (before.difficulty !== after.difficulty) changes.push(`${t("grūtība", "difficulty")} — ${after.difficulty}`);
  if (before.rideStyle !== after.rideStyle) changes.push(`${t("stils", "style")} — ${{ direct: t("tiešāks", "direct"), balanced: t("līdzsvarots", "balanced"), explore: t("izpēte", "explore"), unknown: t("nav noteikts", "unset") }[after.rideStyle]}`);
  if (before.gravelPreference !== after.gravelPreference) changes.push(t("ceļu segums atjaunināts", "road mix updated"));
  if (before.trailPreference !== after.trailPreference) changes.push(`${t("takas", "trails")} — ${after.trailPreference}`);
  if (before.accessPolicy !== after.accessPolicy) changes.push(after.accessPolicy === "verified" ? t("tikai pārbaudāma piekļuve", "verified access only") : t("atļaut nepārbaudītas takas", "allow unverified paths"));
  return changes.length ? `${t("Sapratu", "Got it")}: ${changes.join("; ")}.` : null;
}

export async function POST(req: Request) {
  const body = RequestSchema.safeParse(await req.json().catch(() => null));
  if (!body.success || body.data.messages.at(-1)?.role !== "user") return NextResponse.json({ error: "Invalid conversation" }, { status: 400 });
  if (!process.env.ANTHROPIC_API_KEY) return NextResponse.json({ error: "Sarunai nav pieejams LLM savienojums. Konfigurē ANTHROPIC_API_KEY serverī." }, { status: 503 });
  try {
    const client = new Anthropic({ timeout: 45000, maxRetries: 2, defaultHeaders: process.env.ANTHROPIC_WORKSPACE_ID ? { "anthropic-workspace-id": process.env.ANTHROPIC_WORKSPACE_ID } : undefined });
    const result = await client.messages.parse({
      model: process.env.ANTHROPIC_MODEL ?? "claude-opus-5", max_tokens: 2200,
      system: SYSTEM,
      messages: [{ role: "user", content: JSON.stringify({ previousPlan: body.data.plan ?? null, conversation: body.data.messages }) }],
      // The first message carries the whole idea; reading it well is worth
      // a few seconds. Corrections are small and stay quick.
      output_config: { effort: body.data.plan ? "low" : "medium", format: zodOutputFormat(OutputSchema) },
    });
    if (!result.parsed_output) throw new Error("No structured plan returned");
    const { language, clarification, understanding } = result.parsed_output;
    const lv = language === "lv";
    const previous = body.data.plan ?? null;
    const plan = normalizePlan(result.parsed_output.plan, previous, body.data.messages.at(-1)!.content);
    const latest = body.data.messages.at(-1)!.content;
    // What the chat asked last turn — the question this message is answering.
    const pending = pendingQuestion(previous);
    // Never the same question twice: if the answer could not be placed, the
    // second turn spells out the choices instead of repeating the sentence.
    const asked = lastAssistantQuestion(body.data.messages);
    const missing = nextPlanPrompt(plan, lv);
    const next = (missing && withoutRepeat(missing, asked, plan, lv))
      ?? (await transitCheck(plan, previous, lv, latest, pending))
      ?? (await viaBudgetCheck(plan, previous, lv, latest, pending));
    const clarificationText = next ? null : clarification?.trim();
    // The shape of the ride is restated whenever it is new or changed; small
    // corrections get the field-level acknowledgement instead.
    const shapeChanged = !previous || previous.startPlace !== plan.startPlace || previous.focusArea !== plan.focusArea ||
      previous.destinationPlace !== plan.destinationPlace || previous.returnToStart !== plan.returnToStart ||
      JSON.stringify(previous.viaPlaces) !== JSON.stringify(plan.viaPlaces);
    const acknowledgement = shapeChanged && understanding.trim()
      ? `${lv ? "Sapratu" : "Got it"}: ${understanding.trim().replace(/^(sapratu|got it)[:,]?\s*/i, "").replace(/\.?$/, ".")}`
      : describeChanges(previous, plan, lv);
    const question = next?.message || clarificationText;
    const message = [acknowledgement, question || `${lv ? "Plānoju braucienu" : "Planning your ride"}: ${planSummary(plan, lv ? "lv" : "en")}.`].filter(Boolean).join("\n\n");
    return NextResponse.json({ plan, ready: !question, message, quickReplies: next?.quickReplies ?? [] });
  } catch (error) {
    console.error("Ride conversation failed:", error);
    const overloaded = error instanceof Error && /529|overloaded|429|rate/i.test(error.message);
    return NextResponse.json({
      error: overloaded
        ? "Mopik čata modelis šobrīd ir pārslogots. Pagaidi brīdi un spied “Mēģināt vēlreiz”; brauciena prasības nav mainītas."
        : "Neizdevās saņemt čata atbildi. Mēģini vēlreiz; brauciena prasības nav mainītas.",
    }, { status: 502 });
  }
}
