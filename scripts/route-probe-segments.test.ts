// Run: npx tsx --test scripts/route-probe-segments.test.ts
//
// Backlog item 7, step 2d: the probe measures each rider-named segment
// instead of one headline leg, and the refusal names the segment that is the
// problem. These tests cover the pure helpers plus the orchestrator with a
// mocked `fetch` — nothing here touches the network, because the point of the
// probe is *timing*, and a test that waited on a real router would measure
// the network rather than the code.
import assert from "node:assert/strict";
import test, { afterEach, beforeEach } from "node:test";
import {
  affordableCandidates,
  candidateCostSeconds,
  CORRIDOR_MARGIN,
  directLegOffer,
  probeSegments,
  rideSegments,
  segmentsWorthProbing,
  slowestSegmentSeconds,
  DIRECT_OFFER_PROFILE,
  MIN_SEGMENT_PROBE_MS,
  SEGMENT_PROBE_TOTAL_MS,
} from "../lib/routing/fetch-route-probe";
import { describeUnplannable } from "../lib/chat/feasibility";
import { classifyRoute } from "../lib/routing/classify";
import type { UnplannableVerdict } from "../lib/types";
import type { Point } from "../lib/geo/geometry";
import type { MotoProfileOptions } from "../lib/routing/moto-profile";

/** The API's own budget, so the numbers here are the ones production uses. */
const BUDGET = 50_000;

const RIGA: Point = [24.1052, 56.9496];
const BERLIN: Point = [13.405, 52.52];
const POZNAN: Point = [16.9252, 52.4064];
const WARSZAWA: Point = [21.0122, 52.2297];
const BALDONE: Point = [24.3969, 56.7436];

const PROFILE: MotoProfileOptions = {
  offRoad: 0.5,
  difficulty: "adventure",
  avoidMainRoads: false,
  avoidMotorways: true,
  noSand: false,
  avoidTowns: false,
  trails: "some",
};

// ---------------------------------------------------------------------------
// Splitting the ride at the places the rider named
// ---------------------------------------------------------------------------

test("a ride splits into one segment per rider-named hop, in riding order", () => {
  const segments = rideSegments(
    [BERLIN, POZNAN, WARSZAWA],
    ["Berlin", "Poznań", "Warszawa"]
  );
  assert.equal(segments.length, 2);
  assert.deepEqual(
    segments.map((s) => [s.index, s.fromName, s.toName]),
    [
      [0, "Berlin", "Poznań"],
      [1, "Poznań", "Warszawa"],
    ]
  );
  // The km are real straight-line distances, not placeholders: Berlin →
  // Poznań is ~239 km and Poznań → Warszawa ~279 km.
  assert.ok(segments[0].km > 230 && segments[0].km < 250, `${segments[0].km}`);
  assert.ok(segments[1].km > 270 && segments[1].km < 290, `${segments[1].km}`);
});

test("a ride with no stops is the one-segment case, not a separate path", () => {
  const segments = rideSegments([BERLIN, WARSZAWA], ["Berlin", "Warszawa"]);
  assert.equal(segments.length, 1);
  assert.equal(segments[0].index, 0);
  // Which is the leg the old headline probe measured — the behaviour is
  // preserved rather than replaced.
  assert.ok(segments[0].km > 500, `${segments[0].km}`);
  // A single point has no hop at all.
  assert.deepEqual(rideSegments([RIGA], ["Rīga"]), []);
  assert.deepEqual(rideSegments([]), []);
});

test("missing names yield empty strings rather than invented ones", () => {
  const segments = rideSegments([BERLIN, WARSZAWA]);
  assert.equal(segments[0].fromName, "");
  assert.equal(segments[0].toName, "");
});

// ---------------------------------------------------------------------------
// Which segments are worth the probe, and in which order
// ---------------------------------------------------------------------------

test("short hops are never probed, however long the ride is in total", () => {
  // Four Rīga → Baldone hops is ~180 km of riding and not one hard search.
  // Probing any of them is pure cost on a request that always worked.
  const segments = rideSegments([RIGA, BALDONE, RIGA, BALDONE, RIGA]);
  assert.deepEqual(segmentsWorthProbing(segments, 250), []);
});

test("the long hops are probed first, because the probe budget is shared", () => {
  // Berlin → Poznań (~250 km) then Poznań → Warszawa (~280 km): the longer
  // one goes first, so a budget that runs out spent itself on the hop most
  // likely to be the refusal.
  const segments = rideSegments([BERLIN, POZNAN, WARSZAWA], ["Berlin", "Poznań", "Warszawa"]);
  const order = segmentsWorthProbing(segments, 200).map((s) => s.index);
  assert.deepEqual(order, [1, 0]);
  // And the short hop is dropped entirely when the floor is above it.
  const mixed = rideSegments([RIGA, BALDONE, WARSZAWA], ["Rīga", "Baldone", "Warszawa"]);
  assert.deepEqual(
    segmentsWorthProbing(mixed, 250).map((s) => s.index),
    [1],
    "only the long hop is worth measuring"
  );
});

test("equal-length hops keep riding order, so a refusal reads left to right", () => {
  const segments = rideSegments([BERLIN, WARSZAWA, BERLIN], ["Berlin", "Warszawa", "Berlin"]);
  assert.deepEqual(
    segmentsWorthProbing(segments, 250).map((s) => s.index),
    [0, 1]
  );
});

// ---------------------------------------------------------------------------
// Scaling the search by the slowest segment
// ---------------------------------------------------------------------------

test("the slowest segment scales the search, not the mean and not the sum", () => {
  // One hard hop among easy ones is still a hard search; the mean would hide
  // it and the sum would double-count what a single candidate pays.
  assert.equal(slowestSegmentSeconds([{ seconds: 2 }, { seconds: 9 }, { seconds: 3 }]), 9);
  assert.equal(slowestSegmentSeconds([]), 0, "nothing probed means nothing measured");
});

test("a fast segment keeps its full search even beside a slower one", () => {
  // Two hops, 2.4 s and 4.4 s — the Rīga → Tallinn territory that must keep
  // generating. The slowest scales, and it still affords a real search.
  const slowest = slowestSegmentSeconds([{ seconds: 2.4 }, { seconds: 4.4 }]);
  assert.equal(slowest, 4.4);
  const n = affordableCandidates({
    budgetMs: BUDGET,
    spentMs: 6_800,
    legMs: slowest * 1000,
    cap: 36,
  });
  assert.ok(n >= 8, `expected a usable search, got ${n}`);
});

test("a candidate is priced at the whole ride, not at its slowest hop", () => {
  // The regression measured on 2026-09-19. Berlin → Poznań → Warszawa: one
  // hop measured 9.6 s, the slowest-segment arithmetic allowed 3 candidates,
  // and all three timed out — each was routing *both* hops.
  const slowestOnly = affordableCandidates({
    budgetMs: BUDGET,
    spentMs: 12_000,
    legMs: 9_600,
    cap: 36,
  });
  const whole = affordableCandidates({
    budgetMs: BUDGET,
    spentMs: 12_000,
    legMs: candidateCostSeconds({ measured: [9.6], totalSegments: 2 }) * 1000,
    cap: 36,
  });
  assert.ok(whole < slowestOnly, `whole-ride pricing must be stricter: ${whole} vs ${slowestOnly}`);
  // The unprobed hop is charged at the slowest measured rate, never at zero.
  // Without the corridor margin: 9.6 + 9.6 = 19.2.
  assert.equal(
    candidateCostSeconds({ measured: [9.6], totalSegments: 2, corridorMargin: 1 }),
    19.2
  );
  // Both hops measured: the sum, with nothing invented on top.
  assert.equal(candidateCostSeconds({ measured: [4, 6], totalSegments: 2, corridorMargin: 1 }), 10);
  // A single-segment ride is the bare leg, as the old arithmetic had it.
  assert.equal(candidateCostSeconds({ measured: [7], totalSegments: 1, corridorMargin: 1 }), 7);
  // Nothing probed prices nothing, and the caller then does not scale.
  assert.equal(candidateCostSeconds({ measured: [], totalSegments: 3 }), 0);
});

test("a corridor candidate is priced above the straight legs it is built from", () => {
  // Measured 2026-09-19: Berlin → Poznań → Warszawa priced at the bare
  // segment sum allowed two candidates and both timed out. A candidate
  // inserts offset vias to push the ride off the direct line — that is the
  // product — and that search is dearer than the straight leg probed.
  const straight = candidateCostSeconds({ measured: [8.1], totalSegments: 2, corridorMargin: 1 });
  const withCorridor = candidateCostSeconds({ measured: [8.1], totalSegments: 2 });
  assert.ok(withCorridor > straight, `${withCorridor} must exceed ${straight}`);
  assert.equal(CORRIDOR_MARGIN, 1.5);
  assert.equal(Math.round(withCorridor * 10) / 10, 24.3);
  // And it really bites: fewer candidates than the bare sum would have run.
  const n = (legSeconds: number) =>
    affordableCandidates({ budgetMs: BUDGET, spentMs: 11_000, legMs: legSeconds * 1000, cap: 36 });
  assert.ok(n(withCorridor) < n(straight), `${n(withCorridor)} vs ${n(straight)}`);
});

test("a slow segment reduces the search instead of degrading a fast one", () => {
  // The plan is not degraded because one segment is slow: the reduction is
  // the honest arithmetic, and it never reaches zero.
  const n = affordableCandidates({ budgetMs: BUDGET, spentMs: 31_000, legMs: 31_000, cap: 36 });
  assert.ok(n >= 1 && n < 36, `expected a reduced search, got ${n}`);
});

// ---------------------------------------------------------------------------
// The orchestrator, against a mocked router
// ---------------------------------------------------------------------------

type FetchFn = typeof globalThis.fetch;
const realFetch: FetchFn = globalThis.fetch;

/** A minimal BRouter GeoJSON answer, so `probeLeg` parses a real shape. */
function routerBody(km: number, minutes: number) {
  return JSON.stringify({
    features: [
      {
        geometry: { coordinates: [[13.4, 52.5], [21.0, 52.2]] },
        properties: {
          "track-length": String(Math.round(km * 1000)),
          "total-time": String(Math.round(minutes * 60)),
          messages: [],
        },
      },
    ],
  });
}

/**
 * Stand in for the router. `plan` maps a substring of the requested lonlats
 * to what should happen: a delay in ms, and whether it answers at all. The
 * profile upload is the first call and is answered generically.
 */
function mockRouter(plan: (url: string) => { delayMs: number; answer: boolean }) {
  const calls: string[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    // Decoded, because `probeLeg` percent-encodes the lonlats and the plans
    // below are written in the coordinates a reader recognises.
    const url = decodeURIComponent(String(input));
    // The profile upload: `uploadProfile` posts the script and reads back a
    // `profileid`. It is not what is being measured here.
    if (init?.method === "POST" || !url.includes("lonlats")) {
      return new Response(JSON.stringify({ profileid: "mock-profile" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    calls.push(url);
    const { delayMs, answer } = plan(url);
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(resolve, delayMs);
      // Honour the caller's AbortController exactly as the network would —
      // this is what makes the deadline observable in the test.
      init?.signal?.addEventListener("abort", () => {
        clearTimeout(timer);
        const err = new Error("aborted");
        err.name = "TimeoutError";
        reject(err);
      });
    });
    if (!answer) return new Response("boom", { status: 500 });
    return new Response(routerBody(500, 360), { status: 200 });
  }) as FetchFn;
  return calls;
}

beforeEach(() => {
  process.env.BROUTER_BASE_URL = "http://mock.invalid";
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

test("every rider-named segment is probed, not just the longest", () => {
  // The regression behind step 2d. Berlin → Poznań → Warszawa: the headline
  // leg probed fast and the generation then burned 29 s into a 422, because
  // the other hop was never measured.
  return (async () => {
    const calls = mockRouter(() => ({ delayMs: 5, answer: true }));
    const segments = rideSegments([BERLIN, POZNAN, WARSZAWA], ["Berlin", "Poznań", "Warszawa"]);
    const report = await probeSegments({
      segments: segmentsWorthProbing(segments, 200),
      profileOptions: PROFILE,
    });
    assert.equal(report.probed.length, 2, "both hops must be measured");
    assert.equal(calls.length, 2);
    assert.equal(report.failed, null);
    assert.ok(report.slowestSeconds >= 0);
  })();
});

test("the failing segment is the one reported, and probing stops there", () => {
  return (async () => {
    // Poznań → Warszawa refuses; Berlin → Poznań would have been fine. The
    // longer hop is probed first, so the failure is found immediately and
    // nothing else is spent.
    mockRouter((url) => ({ delayMs: 5, answer: !url.includes("16.9252,52.4064|21.0122") }));
    const segments = rideSegments([BERLIN, POZNAN, WARSZAWA], ["Berlin", "Poznań", "Warszawa"]);
    const report = await probeSegments({
      segments: segmentsWorthProbing(segments, 200),
      profileOptions: PROFILE,
    });
    assert.ok(report.failed, "the refusal must name a segment");
    assert.equal(report.failed.segment.fromName, "Poznań");
    assert.equal(report.failed.segment.toName, "Warszawa");
    assert.equal(report.failed.segment.index, 1);
    assert.equal(report.failed.outcome.ok, false);
    assert.equal(
      report.probed.length,
      1,
      "the rest of the budget is not spent on something the rider cannot act on"
    );
  })();
});

test("a segment that times out is a timeout, not an error", () => {
  return (async () => {
    // The deadline is ours, enforced with an AbortController — BRouter
    // honours neither `maxRunningTime` nor `timeout` (module comment).
    mockRouter(() => ({ delayMs: 60_000, answer: true }));
    const segments = rideSegments([BERLIN, WARSZAWA], ["Berlin", "Warszawa"]);
    const report = await probeSegments({
      segments,
      profileOptions: PROFILE,
      totalBudgetMs: 3_000,
    });
    assert.ok(report.failed);
    assert.equal(report.failed.outcome.ok, false);
    assert.equal(report.failed.outcome.reason, "timeout");
  })();
});

test("probing N segments cannot eat the budget", () => {
  return (async () => {
    // The rider's constraint: four hops must not cost 4 × the per-segment
    // deadline. They share one phase budget instead.
    mockRouter(() => ({ delayMs: 60_000, answer: true }));
    const points = [BERLIN, WARSZAWA, BERLIN, WARSZAWA, BERLIN];
    const started = Date.now();
    const report = await probeSegments({
      segments: rideSegments(points),
      profileOptions: PROFILE,
      totalBudgetMs: 4_000,
    });
    const elapsed = Date.now() - started;
    assert.ok(
      elapsed < 4_000 + 1_500,
      `the whole phase must stay inside its budget, took ${elapsed} ms`
    );
    assert.ok(report.failed, "a phase that ran out still answers");
    // And the per-segment floor held: it did not fire four doomed requests.
    assert.ok(report.probed.length <= 2, `probed ${report.probed.length}`);
  })();
});

test("the phase stops rather than firing a request it cannot afford", () => {
  return (async () => {
    // A budget below the floor buys no measurement at all — a request
    // certain to time out would only slander whichever segment it lands on.
    const calls = mockRouter(() => ({ delayMs: 60_000, answer: true }));
    const report = await probeSegments({
      segments: rideSegments([BERLIN, WARSZAWA, BERLIN]),
      profileOptions: PROFILE,
      totalBudgetMs: MIN_SEGMENT_PROBE_MS - 1,
    });
    assert.equal(calls.length, 0);
    assert.equal(report.probed.length, 0);
    assert.equal(report.failed, null);
  })();
});

test("the shared budget is the single-leg probe's, not a multiple of it", () => {
  // Four segments must not promise 40 s of a 50 s budget.
  assert.equal(SEGMENT_PROBE_TOTAL_MS, 10_000);
  assert.ok(MIN_SEGMENT_PROBE_MS < SEGMENT_PROBE_TOTAL_MS);
});

// ---------------------------------------------------------------------------
// (b) as a named offer, never a silent fallback
// ---------------------------------------------------------------------------

test("the direct-road offer routes on the stock car profile, uploading nothing", () => {
  return (async () => {
    const calls = mockRouter(() => ({ delayMs: 5, answer: true }));
    const offer = await directLegOffer({ from: BERLIN, to: WARSZAWA });
    assert.ok(offer);
    // The whole path comes back, not just the numbers: the chip has to be
    // able to draw this road, and the client cannot re-request it (our own
    // profile is measured never to answer this leg).
    assert.equal(offer.distanceMeters, 500_000);
    assert.ok(offer.coordinates.length >= 2, "the geometry must travel with the offer");
    // It routes on BRouter's own car profile, not on ours. Measured
    // 2026-09-19: our profile flattened never answered this leg (null at
    // 91 s), stock `trekking` took 53 s, `car-fast` 5.7 s.
    assert.equal(calls.length, 1);
    assert.ok(calls[0].includes(`profile=${DIRECT_OFFER_PROFILE}`), calls[0]);
  })();
});

test("an offer that cannot be routed is simply absent, never a worse refusal", () => {
  return (async () => {
    mockRouter(() => ({ delayMs: 60_000, answer: true }));
    const offer = await directLegOffer({
      from: BERLIN,
      to: WARSZAWA,
      budgetMs: 200,
    });
    assert.equal(offer, null);
  })();
});

// ---------------------------------------------------------------------------
// What the rider is told
// ---------------------------------------------------------------------------

/**
 * A direct-leg offer as the API builds one. The wording only reads the two
 * numbers, but the route travels with them — that is what makes the chip
 * something the chat can act on rather than a dead button.
 */
const directLeg: NonNullable<UnplannableVerdict["directLeg"]> = {
  distanceKm: 310,
  durationMinutes: 260,
  route: {
    // Classified from a real two-point path, so the shape is the one the API
    // builds rather than a hand-written guess at the mix types.
    ...classifyRoute({
      distanceMeters: 310_000,
      durationSeconds: 260 * 60,
      coordinates: [POZNAN, WARSZAWA],
      edges: [],
    }),
    id: "direct-test",
    name: "Poznań → Warszawa",
    geometry: { type: "LineString", coordinates: [POZNAN, WARSZAWA] },
    distanceMeters: 310_000,
    profile: "car-fast",
    sourcePrompt: "",
    variant: "direct",
  },
};

const verdictWithSegment: UnplannableVerdict = {
  from: "Berlin",
  to: "Warszawa",
  legKm: 280,
  budgetSeconds: 10,
  reason: "timeout",
  segment: { index: 1, from: "Poznań", to: "Warszawa", km: 280, ofSegments: 2 },
  directLeg,
};

test("the refusal names the segment and says how to fix it", () => {
  const { message } = describeUnplannable(verdictWithSegment, true);
  assert.ok(message.includes("Poznań"), message);
  assert.ok(message.includes("Warszawa"), message);
  assert.ok(/posms ir par grūtu/.test(message), message);
  // The actionable half — the complaint behind item 7 is that the old
  // refusal told the rider nothing they could do.
  assert.ok(/pievieno pieturu/i.test(message), message);
  assert.ok(message.includes("2. no 2"), message);
  // And the English side says the same thing.
  const en = describeUnplannable(verdictWithSegment, false).message;
  assert.ok(/too hard/.test(en), en);
  assert.ok(/Add a stop/i.test(en), en);
});

test("the direct road is offered by name, never presented as the ride", () => {
  const { message, quickReplies } = describeUnplannable(verdictWithSegment, true);
  // The numbers are in the words, so the rider chooses with them in hand.
  assert.ok(message.includes("310 km"), message);
  // And it is explicitly not an interesting route — CLAUDE.md's "never
  // substitute silently" is exactly this case.
  assert.ok(/ne interesants maršruts/.test(message), message);
  const offer = quickReplies.find((q) => /taisnāko/i.test(q.label));
  assert.ok(offer, "the offer must be a tap the rider takes, not an outcome");
});

test("no direct leg means no offer at all, and no dangling sentence", () => {
  const { message, quickReplies } = describeUnplannable(
    { ...verdictWithSegment, directLeg: undefined },
    true
  );
  assert.ok(!/taisnāko ceļu/i.test(message), message);
  assert.ok(!quickReplies.some((q) => /taisnāko/i.test(q.label)));
  assert.ok(!message.includes("  "), "no gap where the offer would have been");
});

test("a ride with no stops keeps the old wording and gains the stop advice", () => {
  const { message, quickReplies } = describeUnplannable(
    { from: "Berlin", to: "Warszawa", legKm: 517, budgetSeconds: 10, reason: "timeout" },
    true
  );
  // The whole-ride sentence, unchanged: there is no segment to blame.
  assert.ok(message.includes("Berlin → Warszawa"), message);
  assert.ok(message.includes("~517 km"), message);
  assert.ok(!/posms ir par grūtu/.test(message), message);
  // But the way out is now one the rider can take immediately.
  assert.ok(/pievieno pieturu/i.test(message), message);
  assert.ok(quickReplies.some((q) => /galamērķi/i.test(q.label)), "the old tap survives");
});
