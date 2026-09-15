// Golden set for the ride chat: rider phrasings → the plan fields they must
// produce. Runs against a dev server (Claude key in .env.local):
//   npx tsx scripts/chat-golden.ts [http://localhost:3000]
// Each case is one first message from a fresh chat unless `plan` seeds a
// previous plan. `expect` is a subset match; `messageMatch` checks the reply.
// A case with `turns` replays a whole conversation instead, feeding each
// answer's plan back in the way the app does, and checks the LAST reply —
// that is the only way to catch a chat that asks the same question twice.
import { RidePlanSchema, type ChatMessage, type RidePlan } from "../lib/chat/ride-plan";

const BASE = process.argv[2] ?? "http://localhost:3000";

type Case = {
  name: string;
  /** One rider message from a fresh chat. Use `turns` for a conversation. */
  message?: string;
  /** A whole conversation, rider turn by rider turn; the last reply is checked. */
  turns?: string[];
  plan?: Partial<RidePlan>;
  expect: Record<string, unknown>;
  messageMatch?: RegExp;
  /** Every earlier reply must match this too — e.g. a question asked once. */
  everyMessageMatch?: RegExp;
  /** No two assistant replies may ask the same question. */
  noRepeatedQuestion?: boolean;
  ready?: boolean;
};

const MEZI = { gravelPreference: 100, trailPreference: "lots", preferForest: true, accessPolicy: "allow_unverified", avoidMainRoads: true };

const CASES: Case[] = [
  {
    name: "forest loop near Baldone, from Riga",
    message: "Atradi foršu meža apli kaut kur Baldones mežos un uztaisi maršrutu no Rīgas, pa to apli un atpakaļ",
    expect: { startPlace: "Rīga", focusArea: "Baldone", viaPlaces: [], returnToStart: true, ...MEZI, rideStyle: "explore" },
    messageMatch: /Sapratu: .*Baldon/i,
  },
  {
    name: "plain via is not a focus area",
    message: "No Rīgas caur Baldoni un atpakaļ, apmēram 3 stundas, grants",
    expect: { startPlace: "Rīga", viaPlaces: ["Baldone"], focusArea: null, returnToStart: true, budget: { mode: "duration", value: 3, constraint: "target", minimumValue: null } },
  },
  {
    name: "around X with no other start is a loop from X",
    message: "2h ap Siguldu pa mežiem",
    expect: { startPlace: "Sigulda", focusArea: null, returnToStart: true, ...MEZI },
  },
  {
    name: "explore the woods of Ķegums from Riga",
    message: "no Rīgas, gribu izbraukāt Ķeguma mežus un atbraukt mājās, kopā 4 stundas",
    expect: { startPlace: "Rīga", focusArea: "Ķegums", returnToStart: true, budgetScope: "total", budget: { mode: "duration", value: 4, constraint: "target", minimumValue: null } },
  },
  {
    name: "hours for the loop only",
    message: "No Rīgas uz Baldones mežiem, tur 2 stundas tikai aplim, pārbrauciens neskaitās",
    expect: { startPlace: "Rīga", focusArea: "Baldone", budgetScope: "focus", budget: { mode: "duration", value: 2, constraint: "target", minimumValue: null } },
  },
  {
    name: "english focus area",
    message: "Starting in Riga, find me a forest loop near Sigulda and bring me back, about 5 hours",
    expect: { startPlace: "Rīga", focusArea: "Sigulda", returnToStart: true, preferForest: true },
    messageMatch: /Got it: .*Sigulda/i,
  },
  {
    name: "one-way ride keeps destination",
    message: "no Rīgas uz Cēsīm pa grants ceļiem, vienā virzienā",
    expect: { startPlace: "Rīga", destinationPlace: "Cēsis", returnToStart: false, focusArea: null },
  },
  {
    name: "direction is not a destination",
    message: "3h no Rīgas uz Siguldas pusi un atpakaļ",
    expect: { startPlace: "Rīga", directionPlace: "Sigulda", destinationPlace: null, returnToStart: true, focusArea: null },
  },
  {
    name: "transit check fires on a short total",
    message: "Apmēram 2 stundas.",
    plan: { startPlace: "Rīga", focusArea: "Baldone", returnToStart: true, ...MEZI, difficulty: "hard", rideStyle: "explore", budget: { mode: "unknown", value: null, constraint: "target", minimumValue: null } } as Partial<RidePlan>,
    expect: { budget: { mode: "duration", value: 2, constraint: "target", minimumValue: null }, budgetScope: "total" },
    messageMatch: /katrā virzienā[\s\S]*Kā skaitam/,
    ready: false,
  },
  {
    name: "loop-only answer resolves the check",
    message: "Apmēram 2 stundas tikai aplim.",
    plan: { startPlace: "Rīga", focusArea: "Baldone", returnToStart: true, ...MEZI, difficulty: "hard", rideStyle: "explore", budget: { mode: "duration", value: 2, constraint: "target", minimumValue: null } } as Partial<RidePlan>,
    expect: { budgetScope: "focus", budget: { mode: "duration", value: 2, constraint: "target", minimumValue: null } },
    ready: true,
  },
  {
    name: "ready plan with a long enough day is generated",
    message: "Apmēram 4 stundas kopā.",
    plan: { startPlace: "Rīga", focusArea: "Baldone", returnToStart: true, ...MEZI, difficulty: "hard", rideStyle: "explore", budget: { mode: "duration", value: 2, constraint: "target", minimumValue: null } } as Partial<RidePlan>,
    expect: { budgetScope: "total", budget: { mode: "duration", value: 4, constraint: "target", minimumValue: null } },
    ready: true,
  },
  {
    name: "via ride that cannot fit the time asks before routing",
    message: "No Rīgas caur Jelgavu un atpakaļ pa mežiem, apmēram 2 stundas",
    expect: { startPlace: "Rīga", viaPlaces: ["Jelgava"], returnToStart: true, focusArea: null, budget: { mode: "duration", value: 2, constraint: "target", minimumValue: null } },
    messageMatch: /nesanāk: taisnākais ceļš turp un atpakaļ ir ~\d+ km/,
    ready: false,
  },
  {
    name: "one-way chip turns the last stop into the destination",
    message: "Vienvirziena brauciens Rīga → Jelgava, apmēram 2 stundas.",
    plan: { startPlace: "Rīga", viaPlaces: ["Jelgava"], returnToStart: true, ...MEZI, difficulty: "adventure", rideStyle: "explore", budget: { mode: "duration", value: 2, constraint: "target", minimumValue: null } } as Partial<RidePlan>,
    expect: { startPlace: "Rīga", viaPlaces: [], destinationPlace: "Jelgava", returnToStart: false },
    ready: true,
  },
  {
    name: "less overlap stays a supported preference",
    message: "2h no Ķekavas, mazāk pārklāšanās, atpakaļ pa citiem ceļiem",
    expect: { startPlace: "Ķekava", prioritizeLowOverlap: true, returnToStart: true },
  },
  {
    // Backlog item 23, the rider's own three turns, from his screenshots of
    // 2026-09-15. The chat asked where the one-way ride should finish, he
    // answered "Vienalga", and it asked the identical question again. The
    // answer must instead mean "no fixed destination": a one-way ride of the
    // asked length from the start, along the TET near Como.
    name: "“vienalga” ends the destination question instead of repeating it",
    turns: [
      "100 km pa Itālijas TET sākot tuvāk Como ezeram",
      "Vienvirziena brauciens.",
      "Vienalga",
    ],
    expect: {
      startPlace: "Como", destinationPlace: null, destinationAny: true, returnToStart: false,
      includeTet: true, budget: { mode: "distance", value: 100, constraint: "target", minimumValue: null },
    },
    noRepeatedQuestion: true,
    ready: true,
  },
  {
    // The same answer one turn earlier, with the question already pending:
    // the deterministic layer alone has to place it, whatever the model does.
    name: "“vienalga” placed against a seeded destination question",
    message: "Vienalga",
    plan: {
      startPlace: "Como", viaPlaces: [], returnToStart: false, destinationPlace: null,
      includeTet: true, difficulty: "adventure", rideStyle: "explore", ...MEZI,
      budget: { mode: "distance", value: 100, constraint: "target", minimumValue: null },
    } as Partial<RidePlan>,
    expect: { startPlace: "Como", destinationPlace: null, destinationAny: true, returnToStart: false },
    ready: true,
  },
];

const base: RidePlan = RidePlanSchema.parse({
  startPlace: null, viaPlaces: [], destinationPlace: null, directionPlace: null, returnToStart: null,
  budget: { mode: "unknown", value: null, constraint: "target", minimumValue: null },
  difficulty: "unknown", rideStyle: "unknown", gravelPreference: null, trailPreference: "unknown",
  preferForest: false, noSand: false, avoidTowns: false, avoidMainRoads: false, includeTet: false, includeSightseeing: false,
});

function subset(actual: unknown, expected: unknown): boolean {
  if (Array.isArray(expected)) return Array.isArray(actual) && JSON.stringify(actual) === JSON.stringify(expected);
  if (expected && typeof expected === "object") {
    if (!actual || typeof actual !== "object") return false;
    return Object.entries(expected).every(([k, v]) => subset((actual as Record<string, unknown>)[k], v));
  }
  return actual === expected;
}

/** A question the chat asked, normalised so punctuation cannot hide a repeat. */
function questionKey(message: string): string | null {
  const line = message.split("\n").map((l) => l.trim()).filter((l) => l.includes("?")).pop();
  return line ? line.toLocaleLowerCase("lv").replace(/[^\p{L}\p{N}]+/gu, " ").trim() : null;
}

async function run() {
  let failed = 0;
  for (const c of CASES) {
    let plan = c.plan ? RidePlanSchema.parse({ ...base, ...c.plan }) : null;
    const problems: string[] = [];
    // The conversation as the app sends it: every rider turn plus every reply
    // so far, and the plan the previous reply returned.
    const conversation: ChatMessage[] = [];
    const replies: string[] = [];
    let res!: Response;
    let data: { plan: RidePlan; message: string; ready: boolean; error?: string } = { plan: base, message: "", ready: false };
    for (const turn of c.turns ?? [c.message!]) {
      conversation.push({ role: "user", content: turn });
      res = await fetch(`${BASE}/api/route-chat`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: conversation, plan }),
      });
      data = await res.json();
      if (!res.ok) break;
      conversation.push({ role: "assistant", content: data.message });
      replies.push(data.message);
      plan = data.plan;
    }
    if (!res.ok) problems.push(`HTTP ${res.status}: ${data.error}`);
    else {
      for (const [k, v] of Object.entries(c.expect)) if (!subset((data.plan as Record<string, unknown>)[k], v)) problems.push(`${k}: got ${JSON.stringify((data.plan as Record<string, unknown>)[k])}, want ${JSON.stringify(v)}`);
      if (c.messageMatch && !c.messageMatch.test(data.message)) problems.push(`message: ${JSON.stringify(data.message)}`);
      if (c.everyMessageMatch) for (const m of replies) if (!c.everyMessageMatch.test(m)) problems.push(`message: ${JSON.stringify(m)}`);
      // Item 23's second half: an answer the chat cannot place must never
      // produce the same question twice.
      if (c.noRepeatedQuestion) {
        const asked = replies.map(questionKey).filter(Boolean) as string[];
        const repeat = asked.find((q, i) => asked.indexOf(q) !== i);
        if (repeat) problems.push(`asked twice: ${JSON.stringify(repeat)}`);
      }
      if (c.ready !== undefined && data.ready !== c.ready) problems.push(`ready: ${data.ready}, want ${c.ready}`);
    }
    const ok = problems.length === 0;
    if (!ok) failed++;
    console.log(`${ok ? "PASS" : "FAIL"}  ${c.name}`);
    for (const p of problems) console.log(`       ${p}`);
    if (ok && data.message) console.log(`       ↳ ${String(data.message).split("\n")[0].slice(0, 110)}`);
  }
  console.log(`\n${CASES.length - failed}/${CASES.length} passed`);
  process.exit(failed ? 1 : 0);
}
run();
