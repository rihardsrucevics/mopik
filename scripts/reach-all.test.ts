/**
 * Backlog 50 and 52, and the removal the rider called „not realistic”
 * (2026-09-30): EVERY edit ends in a proposal, a warned proposal („Tomēr
 * braukt”), or a named blocker with a fix — never a generic „neizdevās
 * savienot”.
 *
 *   npx tsx --test scripts/reach-all.test.ts
 *
 * - A new finish or start: a splice his own profile could not join was
 *   refused on rung 0 („Finišs „Gaujas iela” – to neizdevās savienot…”);
 *   it now climbs the relaxed ladder like a stop, and past car-fast offers
 *   „Vest pa taisno” (road as far as it goes, then straight to the place).
 *   Its cut never falls inside a drawn straight stretch.
 * - A removal re-routes only around the point, never the tens of km an
 *   earlier whole-span edit joined; a refusal names the ADJACENT places;
 *   a router that ran out of time says so („Pārrēķins aizņēma pārāk ilgi –
 *   mēģini vēlreiz.”), never „ne ar vienu profilu”.
 * - A batch with several blockers: each its own chips with „Vest pa
 *   taisno”, and „Vest pa taisno visiem” when they are not all in a row.
 * - Names, never coordinates.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { Point } from "@/lib/geo/geometry";
import { cumulative } from "@/lib/routing/detour";
import { planEdit, type RidePlace, type RidePlaces } from "@/lib/routing/reroute-leg";
import { fixesFor, pointFixes, type Blocking } from "@/lib/map/blocking";
import { blockedLine, guideAction, placeWords, pointLabel, proposalGuide } from "@/lib/map/edit-guidance";
import { proposalView } from "@/lib/map/proposal-view";
import { proposalReducer, IDLE_PROPOSAL } from "@/lib/map/edit-proposal";
import { messages, type MessageKey } from "@/lib/i18n/messages";

const lv = (k: MessageKey) => messages("lv")[k];
const fmt = (n: number) => new Intl.NumberFormat("lv", { maximumFractionDigits: 1 }).format(n);
const page = readFileSync(new URL("../components/home-page.tsx", import.meta.url), "utf8");
const body = (name: string) => page.slice(page.indexOf(name), page.indexOf("\n  }\n", page.indexOf(name)));

// A straight line east along 57° N, 20 km, a point every 100 m.
const LINE: Point[] = Array.from({ length: 201 }, (_, i) => [24 + (i * 100) / (111195 * Math.cos((57 * Math.PI) / 180)), 57]);
const CUM = cumulative(LINE);
const at = (m: number): RidePlace => { const i = Math.round(m / 100); return { name: `P${i}`, label: "", lat: LINE[i][1], lon: LINE[i][0] }; };

test("a new finish: its cut never falls inside a drawn straight stretch — the router cannot start in a field", () => {
  const before: RidePlaces = { start: at(0), vias: [at(10_000)], finish: at(20_000), roundTrip: false };
  const after: RidePlaces = { ...before, finish: { name: "Madona", label: "", lat: 57.01, lon: LINE[200][0] } };
  const plain = planEdit({ line: LINE, cum: CUM, before, after });
  assert.ok(plain && !("error" in plain) && plain.kind === "move-finish");
  const cut = plain.runs[0].fromMeters;
  // A drawn stretch round the cut: the cut moves to where it ends, on the road.
  const fixed: [number, number][] = [[cut - 500, cut + 400]];
  const clear = planEdit({ line: LINE, cum: CUM, before, after, fixed });
  assert.ok(clear && !("error" in clear));
  assert.equal(Math.round(clear.runs[0].fromMeters), Math.round(cut + 400));
  assert.equal(clear.runs[0].toMeters, CUM[CUM.length - 1]);
});

test("a new start: its cut never falls inside a drawn straight stretch either", () => {
  const before: RidePlaces = { start: at(0), vias: [at(15_000)], finish: at(20_000), roundTrip: false };
  const after: RidePlaces = { ...before, start: { name: "Sigulda", label: "", lat: 56.99, lon: LINE[0][0] } };
  const plain = planEdit({ line: LINE, cum: CUM, before, after });
  assert.ok(plain && !("error" in plain) && plain.kind === "move-start");
  const cut = plain.runs[0].toMeters;
  const clear = planEdit({ line: LINE, cum: CUM, before, after, fixed: [[cut - 300, cut + 300]] });
  assert.ok(clear && !("error" in clear));
  assert.equal(Math.round(clear.runs[0].toMeters), Math.round(cut - 300));
});

test("a removal re-routes around the point, never the tens of km an earlier whole-span edit joined", () => {
  // A pass-through point at 10 km whose joins (from a whole-span re-route) are 0.2 and 19.8 km.
  const gone: RidePlace = { ...at(10_000), name: "", shape: true, joins: [LINE[2], LINE[198]] };
  const before: RidePlaces = { start: at(0), vias: [gone], finish: at(20_000), roundTrip: false };
  const after: RidePlaces = { ...before, vias: [] };
  const plan = planEdit({ line: LINE, cum: CUM, before, after });
  assert.ok(plan && !("error" in plan) && plan.kind === "remove-stop");
  const run = plan.runs[0];
  assert.ok(run.toMeters - run.fromMeters <= 2 * 3_000 + 1, `window ${Math.round(run.toMeters - run.fromMeters)} m`);
  // Short joins are still honoured.
  const near: RidePlace = { ...gone, joins: [LINE[95], LINE[106]] };
  const p2 = planEdit({ line: LINE, cum: CUM, before: { ...before, vias: [near] }, after });
  assert.ok(p2 && !("error" in p2));
  assert.equal(Math.round(p2.runs[0].fromMeters), 9_500);
  assert.equal(Math.round(p2.runs[0].toMeters), 10_600);
});

test("the page: a finish or start the profile could not join climbs the ladder, and past it gets „Vest pa taisno”", () => {
  const route = body("async function routeProposal(");
  // No refusal on rung 0 for a line that would not join: every kind climbs.
  assert.doesNotMatch(route, /level \|\| removal \|\| p\.stretch \? unreached\(reachM\) : refuse\(ui\.editBrokenLine/);
  assert.match(route, /if \(!verdict\.ok\) return unreached\(reachM, \{ broke: true \}\);/);
  // Past car-fast: a new finish or start is offered „Vest pa taisno”, like one new stop.
  assert.match(route, /const endMove = asked\.length === 1 && \(planned\.kind === "move-finish" \|\| planned\.kind === "move-start"\)/);
  assert.match(route, /if \(endMove\) return askStraight\(/);
  // …and the straight way to it: road as far as it goes, then a connector to the place.
  assert.match(route, /const c = finishing \? connector\(gapAt, asked\[0\]\) : connector\(asked\[0\], gapAt\);/);
  // A timeout past the last rung is said as a timeout.
  assert.match(route, /if \(why\.timedOut\) return refuse\(ui\.editTimeout, "timeout"\);/);
});

test("no generic refusal: every refusal goes through the naming or says its own fix", () => {
  const refuse = body("function refuseProposal(");
  assert.match(refuse, /reason === "timeout" \? joinGuide\(note, ui\.guideRefusedRetry\) : noteBlocking\(token, \{ reason, meters \}\)/);
  // A point that refuses: its name and cause, and the fixes — never the reason alone.
  const one: Blocking = { token: 1, probing: false, refused: true, total: 1, straight: true, points: [{ lat: 56.85, lon: 26.2, title: "Finišs", name: "Gaujas iela", cause: "failed" }] };
  const line = blockedLine(lv, one, false, fmt);
  assert.match(line, /^Finišs „Gaujas iela” – .+ – pieskaries citur kartē, izņem vai „Vest pa taisno”\.$/);
  // The removal names the ADJACENT places, not the nearest named ones far away.
  assert.match(page, /fi\(ui\.editRemoveNoJoin, \{ a: placeName\(n\.from, ui\.mapStart\), b: placeName\(n\.to, ui\.mapFinish\) \}\)/);
  // The server says a timeout as one.
  const server = readFileSync(new URL("../app/api/reroute-leg/route.ts", import.meta.url), "utf8");
  assert.match(server, /\/edit deadline\/i\.test\(message\) \? "timeout"/);
});

test("a timeout: „Pārrēķins aizņēma pārāk ilgi – mēģini vēlreiz.” in the chip, never „izvēlies citu vietu”", () => {
  let s = proposalReducer(IDLE_PROPOSAL, { type: "route", token: 1, how: "remove-stop" });
  s = proposalReducer(s, { type: "refused", token: 1, reason: lv("editTimeout"), retry: true });
  const v = proposalView(s, { routing: "", delta: "", deltaTitle: "", guide: proposalGuide(lv) } as never, "lv");
  assert.equal(`${v?.text} – ${v?.guide}`, "Pārrēķins aizņēma pārāk ilgi – mēģini vēlreiz.");
  assert.equal(guideAction(lv, { kind: "refused", reason: "", retry: true }), "mēģini vēlreiz.");
});

test("a batch with several blockers (backlog 52): each off-road point gets „Vest pa taisno”", () => {
  const b: Blocking = { token: 1, probing: false, refused: true, total: 4, points: [
    { lat: 56.49, lon: 25.70, title: "Pietura 2", name: "Lejas Roži", cause: "far", meters: 754 },
    { lat: 56.4819, lon: 25.7056, title: "Pietura 4", name: "Ceplīši · 56.4819, 25.7056", cause: "far", meters: 318 },
  ] };
  assert.equal(fixesFor(b, false).straight, true);
  assert.equal(pointFixes(b.points[0], b).straight, true);
  assert.equal(pointFixes({ cause: "profile" }, b).straight, false);
  const line = blockedLine(lv, b, false, fmt);
  assert.equal(line, "Pietura 2 „Lejas Roži” – tuvākais ceļš ~754 m nostāk; Pietura 4 „Ceplīši” – tuvākais ceļš ~318 m nostāk – pārvieto, izņem, „Vest pa taisno” vai „Pievienot pārējās”.");
  assert.doesNotMatch(line, /\d+[.,]\d{4}/);
  // The composer: one group per blocking point, each with its own straight chip.
  const composer = readFileSync(new URL("../components/ride-composer.tsx", import.meta.url), "utf8");
  assert.match(composer, /blockedItems\.forEach\(\(item, n\) => \{/);
  assert.match(composer, /key: n \? `block:\$\{n \+ 1\}` : "block"/);
  assert.match(composer, /t\(locale, edit\.straightChainAll \? "chainOfferAll" : "chainOffer"\)/);
  // The page: not all in a row — one chain each, offered as „Vest pa taisno visiem”.
  assert.match(body("function offerChain("), /const all = far >= 2 && inRows < far;/);
});

test("names, never coordinates: a reverse lookup that failed says the point's title", () => {
  assert.equal(placeWords("Ceplīši · 56.4819, 25.7056"), "Ceplīši");
  assert.equal(placeWords("56.4819, 25.7056"), "");
  assert.equal(placeWords("56,4819 25,7056"), "");
  assert.equal(placeWords("Rīgas iela 12"), "Rīgas iela 12");
  assert.equal(pointLabel({ title: "Pietura 4", name: "56.4819, 25.7056" }), "Pietura 4");
  assert.equal(pointLabel({ title: "Finišs", name: "56.8545, 26.2195" }), "Finišs");
});

test("copy: the new lines in every language, en dashes, Latvian never „piesit”", () => {
  for (const loc of ["lv", "lt", "et", "en"] as const) {
    const m = messages(loc);
    for (const k of ["editTimeout", "guideRefusedRetry", "chainOfferAll"] as const) {
      assert.ok(m[k] && m[k].length > 3, `${loc} ${k}`);
      assert.doesNotMatch(m[k], / - /, `${loc} ${k}: en dash`);
    }
  }
  assert.doesNotMatch(Object.values(messages("lv")).join(" "), /piesit/i);
});

test("guard: every option the words name has its chip, in every blocked state (rider, images/45)", async () => {
  const { blockOptions } = await import("@/lib/map/blocking");
  const { fixWords } = await import("@/lib/map/edit-guidance");
  const composer = readFileSync(new URL("../components/ride-composer.tsx", import.meta.url), "utf8");
  const word: Record<string, MessageKey> = { move: "blockActMove", tap: "blockActTap", remove: "blockActRemove", straight: "blockActStraight", straightAll: "blockActStraightAll", override: "blockActOverride", rest: "blockActRest" };
  const causes = ["far", "profile", "detour", "failed"] as const;
  for (const total of [1, 2, 4]) for (const cause of causes) for (const warned of [false, true]) for (const straight of [false, true]) {
    const b: Blocking = { token: 1, probing: false, refused: !warned, total, ...(straight ? { straight } : {}), points: [{ lat: 1, lon: 1, title: "Pietura 1", name: "", cause }] };
    const fixes = fixesFor(b, warned);
    const opts = blockOptions(fixes);
    const words = fixWords(lv, fixes);
    // The words name exactly the options…
    for (const o of Object.keys(word)) assert.equal(words.includes(lv(word[o])), opts.includes(o as never), `${total} ${cause} ${warned} ${straight}: ${o} in „${words}”`);
    // …a single point is moved by a tap, a batch point by its chip.
    assert.equal(opts.includes("move"), total > 1);
    assert.equal(opts.includes("tap"), total === 1);
  }
  // …and the composer builds each chip from the same fixes: „Vest pa taisno” for the single point and per batch point off the road,
  assert.match(composer, /\.\.\.\(fixes\.straight && edit\?\.onStraight \? \[\{ key: "straight"/);
  assert.match(composer, /const straightHere = Boolean\(point && edit\?\.onStraightAt && \(point\.cause === "far"/);
  // „Pārvietot” and „Izņemt” on every batch point, „Pievienot pārējās” for the rest, „Tomēr braukt” on a warned proposal.
  assert.match(composer, /\{ key: "move", label: t\(locale, "blockChipMove"\)/);
  assert.match(composer, /key: "rest", label: t\(locale, "blockChipRest"\)/);
  assert.match(composer, /if \(edit\?\.proposal\?\.phase === "proposed" && edit\.proposal\.proposal\.accept\) choices\.push\(\{\s*key: "override"/);
  // The page offers „Vest pa taisno” for every single point the words say it for: a stop, a pass-through point, moved or new, a finish, a start.
  const route = body("async function routeProposal(");
  assert.match(route, /const addsOne = asked\.length === 1 && \(planned\.kind === "add-stop" \|\| planned\.kind === "move-stop"\);/);
  assert.match(body("function askStraight("), /noteBlocking\(token, \{ reason: "no-road", meters, straight: true \}\);[\s\S]*setStraightAsk\(/);
});
