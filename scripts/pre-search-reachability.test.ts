/**
 * Backlog 27 — an unreachable place is named before the search, not after it.
 *
 * `npx tsx --test scripts/pre-search-reachability.test.ts`
 *
 * What these pin:
 *
 *  1. **Only a certain verdict refuses.** A 200 whose line ends further than
 *     the stop tolerance from the pin (Pilskalni 2, 471 m) dooms every
 *     candidate, so it is refused up front. An island / re-tracking refusal
 *     is what the generation's nudge ring rescues (Satezeles pilskalns), and
 *     a probe that never answered says nothing — neither may refuse here.
 *  2. **A normal ride pays one probe, not one per place.** The places are
 *     probed at once; the second, opposite-side probe runs only when a place
 *     already looks unreachable.
 *  3. **The chat names the place and its role, and never offers a chip that
 *     does nothing** — a start cannot be removed, so it gets no remove chip.
 *
 * The router is stubbed: what is pinned is the decision, not OSM.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { checkRiderPlaces, type RiderPlace } from "../lib/routing/pre-search-reachability";
import { STOP_TOLERANCE_M, type SnapProbe } from "../lib/routing/routable-point";
import { describeUnreachableStop } from "../lib/chat/feasibility";
import type { Point } from "../lib/geo/geometry";
import type { UnreachableStop } from "../lib/types";
import type { UiLocale } from "../lib/i18n/locale";

/** The rider's finish, and where BRouter really ended — both measured 2026-09-19. */
const PILSKALNI: Point = [24.9353088, 57.1933514];
const PILSKALNI_SNAP: Point = [24.942515, 57.191716];
const ADAZI: Point = [24.3236, 57.0736];
const SIGULDA: Point = [24.8547, 57.1537];

const place = (point: Point, name: string, index: number, role: RiderPlace["role"]): RiderPlace => ({ point, name, index, role });

/** A router where every place snaps onto itself, except the ones listed. */
function stubRouter(answers: Map<string, (leg: [Point, Point]) => SnapProbe> = new Map()) {
  const legs: [Point, Point][] = [];
  const probe = async (leg: [Point, Point]): Promise<SnapProbe> => {
    legs.push(leg);
    const special = answers.get(`${leg[1][0]},${leg[1][1]}`);
    return special ? special(leg) : { ok: true, end: leg[1] };
  };
  return { probe, legs };
}
const key = (p: Point) => `${p[0]},${p[1]}`;

test("Pilskalni 2 as the finish is refused before the search, with the road it would snap to", async () => {
  const { probe } = stubRouter(new Map([[key(PILSKALNI), () => ({ ok: true, end: PILSKALNI_SNAP })]]));
  const report = await checkRiderPlaces({
    places: [place(ADAZI, "Ādaži", 0, "start"), place(PILSKALNI, "Pilskalni 2", 1, "destination")],
    probe,
  });
  assert.ok(report.unreachable, "the finish must be named");
  assert.equal(report.unreachable.name, "Pilskalni 2");
  assert.equal(report.unreachable.role, "destination");
  assert.equal(report.unreachable.index, 1);
  assert.equal(report.unreachable.distanceM, 471);
  assert.deepEqual(report.unreachable.snappedTo, { lat: PILSKALNI_SNAP[1], lon: PILSKALNI_SNAP[0] });
  // 471 m is inside the move limit — the same answer the Confirm-time check gives.
  assert.equal(report.unreachable.canMove, true);
});

test("a normal ride passes with one short probe per place, and no confirmation probe", async () => {
  const { probe, legs } = stubRouter();
  const report = await checkRiderPlaces({
    places: [place(ADAZI, "Ādaži", 0, "start"), place(SIGULDA, "Sigulda", 1, "via"), place(PILSKALNI, "X", 2, "destination")],
    probe,
  });
  assert.equal(report.unreachable, undefined);
  assert.equal(legs.length, 3);
  // Synthetic legs beside each pin, never the real (possibly 300 km) approach.
  for (const [from, to] of legs) {
    const km = Math.hypot((from[0] - to[0]) * 61, (from[1] - to[1]) * 111);
    assert.ok(km < 2, `probe leg ${km.toFixed(1)} km is not short`);
  }
});

test("places are probed at once: the ride pays the slowest probe, not the sum", async () => {
  let clock = 0;
  let inFlight = 0;
  let maxInFlight = 0;
  const probe = async (leg: [Point, Point]): Promise<SnapProbe> => {
    inFlight++;
    maxInFlight = Math.max(maxInFlight, inFlight);
    await new Promise((r) => setTimeout(r, 5));
    inFlight--;
    return { ok: true, end: leg[1] };
  };
  await checkRiderPlaces({
    places: [place(ADAZI, "a", 0, "start"), place(SIGULDA, "b", 1, "via"), place(PILSKALNI, "c", 2, "destination")],
    probe,
    now: () => clock++,
  });
  assert.equal(maxInFlight, 3);
});

test("an island refusal is left to the generation's nudge ring, not refused here", async () => {
  const { probe } = stubRouter(new Map([[key(PILSKALNI), () => ({ ok: false, refused: true })]]));
  const report = await checkRiderPlaces({
    places: [place(ADAZI, "Ādaži", 0, "start"), place(PILSKALNI, "Satezeles pilskalns", 1, "via")],
    probe,
  });
  assert.equal(report.unreachable, undefined);
  assert.equal(report.verdicts[1].result.reason, "unroutable");
});

test("a probe that never answered is not an accusation", async () => {
  const { probe } = stubRouter(new Map([[key(PILSKALNI), () => ({ ok: false, refused: false })]]));
  const report = await checkRiderPlaces({
    places: [place(ADAZI, "Ādaži", 0, "start"), place(PILSKALNI, "Pilskalni 2", 1, "destination")],
    probe,
  });
  assert.equal(report.unreachable, undefined);
});

test("a place that snaps close from the other side is not named", async () => {
  // East leg ends 471 m off, west leg lands on the pin: an unlucky offset
  // point, not an unreachable place.
  const { probe, legs } = stubRouter(
    new Map([[key(PILSKALNI), (leg) => (leg[0][0] > PILSKALNI[0] ? { ok: true, end: PILSKALNI_SNAP } : { ok: true, end: PILSKALNI })]])
  );
  const report = await checkRiderPlaces({ places: [place(PILSKALNI, "Pilskalni 2", 1, "destination")], probe });
  assert.equal(report.unreachable, undefined);
  assert.equal(legs.length, 2);
  assert.ok(legs[1][0][0] < PILSKALNI[0], "the confirmation probe comes from the west");
});

test("a confirmation probe that never answered keeps the first verdict", async () => {
  const { probe } = stubRouter(
    new Map([[key(PILSKALNI), (leg) => (leg[0][0] > PILSKALNI[0] ? { ok: true, end: PILSKALNI_SNAP } : { ok: false, refused: false })]])
  );
  const report = await checkRiderPlaces({ places: [place(PILSKALNI, "Pilskalni 2", 1, "destination")], probe });
  assert.equal(report.unreachable?.distanceM, 471);
});

test("when both sides are too far, the first side's road is the one offered", async () => {
  // Measured on Pilskalni 2: every real approach ends at 471 m, the west
  // offset alone at 369 m on another road. The offer follows the east leg,
  // which is also what the Confirm-time check asks.
  const west: Point = [24.930605, 57.195475];
  const { probe } = stubRouter(
    new Map([[key(PILSKALNI), (leg) => ({ ok: true, end: leg[0][0] > PILSKALNI[0] ? PILSKALNI_SNAP : west })]])
  );
  const report = await checkRiderPlaces({ places: [place(PILSKALNI, "Pilskalni 2", 1, "destination")], probe });
  assert.equal(report.unreachable?.distanceM, 471);
  assert.deepEqual(report.unreachable?.snappedTo, { lat: PILSKALNI_SNAP[1], lon: PILSKALNI_SNAP[0] });
});

test("the first unreachable place in ride order is the one named", async () => {
  const far = (p: Point) => (): SnapProbe => ({ ok: true, end: [p[0] + 0.02, p[1]] });
  const { probe } = stubRouter(new Map([[key(SIGULDA), far(SIGULDA)], [key(PILSKALNI), far(PILSKALNI)]]));
  const report = await checkRiderPlaces({
    places: [place(ADAZI, "Ādaži", 0, "start"), place(SIGULDA, "Sigulda", 1, "via"), place(PILSKALNI, "Pilskalni 2", 2, "destination")],
    probe,
  });
  assert.equal(report.unreachable?.name, "Sigulda");
  assert.equal(report.unreachable?.role, "via");
  // 0.02° of longitude is ~1.2 km — too far to offer a move.
  assert.equal(report.unreachable?.canMove, false);
});

test("a round trip's start and finish are probed once and blamed on the start", async () => {
  const { probe, legs } = stubRouter(new Map([[key(ADAZI), () => ({ ok: true, end: [ADAZI[0] + 0.01, ADAZI[1]] })]]));
  const report = await checkRiderPlaces({
    places: [place(ADAZI, "Ādaži", 0, "start"), place(SIGULDA, "Sigulda", 1, "via"), place(ADAZI, "Ādaži", 2, "destination")],
    probe,
  });
  assert.equal(report.unreachable?.role, "start");
  assert.equal(report.unreachable?.index, 0);
  // Ādaži twice (east + confirmation), Sigulda once.
  assert.equal(legs.length, 3);
});

test("the tolerance is the stop check's own, so the verdicts cannot drift apart", async () => {
  const at = (m: number): Point => [PILSKALNI[0] + m / (111320 * Math.cos((PILSKALNI[1] * Math.PI) / 180)), PILSKALNI[1]];
  const run = async (m: number) =>
    (await checkRiderPlaces({ places: [place(PILSKALNI, "p", 1, "via")], probe: async () => ({ ok: true, end: at(m) }) })).unreachable;
  assert.equal(await run(STOP_TOLERANCE_M - 20), undefined);
  assert.ok(await run(STOP_TOLERANCE_M + 20));
});

// ——— The chat message ———

const stopOf = (role: UnreachableStop["role"], over: Partial<UnreachableStop> = {}): UnreachableStop => ({
  name: "Pilskalni 2",
  index: role === "start" ? 0 : 1,
  role,
  lat: PILSKALNI[1],
  lon: PILSKALNI[0],
  snappedTo: { lat: PILSKALNI_SNAP[1], lon: PILSKALNI_SNAP[0] },
  distanceM: 471,
  canMove: true,
  ...over,
});
const LOCALES: UiLocale[] = ["lv", "lt", "et", "en"];

test("the message names the place, the distance and the tolerance in all four languages", () => {
  for (const locale of LOCALES) {
    const { message } = describeUnreachableStop(stopOf("destination"), locale);
    assert.ok(message.includes("Pilskalni 2"), `${locale}: ${message}`);
    assert.ok(message.includes("471"), `${locale}: ${message}`);
    assert.ok(message.includes(String(STOP_TOLERANCE_M)), `${locale}: ${message}`);
  }
});

test("the message says which role the place has", () => {
  assert.match(describeUnreachableStop(stopOf("start"), "lv").message, /^Sākumpunktu „Pilskalni 2”/);
  assert.match(describeUnreachableStop(stopOf("via"), "lv").message, /^Pieturu „Pilskalni 2”/);
  assert.match(describeUnreachableStop(stopOf("destination"), "lv").message, /^Finišu „Pilskalni 2”/);
  assert.match(describeUnreachableStop(stopOf("destination"), "en").message, /^The finish “Pilskalni 2”/);
});

test("a start gets no remove chip — a chip that does nothing is never shipped", () => {
  for (const locale of LOCALES) {
    const moveable = describeUnreachableStop(stopOf("start"), locale).quickReplies;
    assert.deepEqual(moveable.map((r) => r.action), ["move-stop"], locale);
    const stuck = describeUnreachableStop(stopOf("start", { canMove: false }), locale);
    assert.equal(stuck.quickReplies.length, 0, locale);
    // With nothing to tap, the sentence must not end on "what shall we do?".
    assert.ok(!/Kā darām|Ką darome|Kuidas teeme|What shall we do/.test(stuck.message), stuck.message);
  }
});

test("a stop and a finish keep both ways out, move first", () => {
  for (const role of ["via", "destination"] as const) {
    const replies = describeUnreachableStop(stopOf(role), "lv").quickReplies;
    assert.deepEqual(replies.map((r) => r.action), ["move-stop", "remove-stop"], role);
  }
  assert.equal(describeUnreachableStop(stopOf("destination"), "lv").quickReplies[1].label, "Izņemt finišu „Pilskalni 2”");
  assert.equal(describeUnreachableStop(stopOf("via"), "lv").quickReplies[1].label, "Izņemt pieturu „Pilskalni 2”");
});

test("Latvian copy never says 'piesit'", () => {
  for (const role of ["start", "via", "destination"] as const) {
    for (const canMove of [true, false]) {
      const { message, quickReplies } = describeUnreachableStop(stopOf(role, { canMove }), "lv");
      const all = [message, ...quickReplies.flatMap((r) => [r.label, r.message])].join(" ");
      assert.ok(!/piesit/i.test(all), all);
    }
  }
});
