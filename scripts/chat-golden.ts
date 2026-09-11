// Golden set for the ride chat: rider phrasings → the plan fields they must
// produce. Runs against a dev server (Claude key in .env.local):
//   npx tsx scripts/chat-golden.ts [http://localhost:3000]
// Each case is one first message from a fresh chat unless `plan` seeds a
// previous plan. `expect` is a subset match; `messageMatch` checks the reply.
import { RidePlanSchema, type RidePlan } from "../lib/chat/ride-plan";

const BASE = process.argv[2] ?? "http://localhost:3000";

type Case = {
  name: string;
  message: string;
  plan?: Partial<RidePlan>;
  expect: Record<string, unknown>;
  messageMatch?: RegExp;
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
    name: "less overlap stays a supported preference",
    message: "2h no Ķekavas, mazāk pārklāšanās, atpakaļ pa citiem ceļiem",
    expect: { startPlace: "Ķekava", prioritizeLowOverlap: true, returnToStart: true },
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

async function run() {
  let failed = 0;
  for (const c of CASES) {
    const plan = c.plan ? RidePlanSchema.parse({ ...base, ...c.plan }) : null;
    const res = await fetch(`${BASE}/api/route-chat`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages: [{ role: "user", content: c.message }], plan }),
    });
    const data = await res.json();
    const problems: string[] = [];
    if (!res.ok) problems.push(`HTTP ${res.status}: ${data.error}`);
    else {
      for (const [k, v] of Object.entries(c.expect)) if (!subset(data.plan[k], v)) problems.push(`${k}: got ${JSON.stringify(data.plan[k])}, want ${JSON.stringify(v)}`);
      if (c.messageMatch && !c.messageMatch.test(data.message)) problems.push(`message: ${JSON.stringify(data.message)}`);
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
