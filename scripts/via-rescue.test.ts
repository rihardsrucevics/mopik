/**
 * Item 11g / backlog 20 — the split between a via the RIDER named and one this
 * code generated, when BRouter refuses the leg.
 *
 * `npx tsx --test scripts/via-rescue.test.ts`
 *
 * The rule these hold, and why it is worth a test rather than a comment:
 *
 *  1. **A generated via is cheap to lose.** It is a guess at a nice shape — a
 *     seaward anchor, a perpendicular corridor offset — so a refused leg buys
 *     it at most two bounded alternatives (shift it along the corridor, then
 *     drop it) and never the endpoint-nudge ring. Measured on Liepāja →
 *     Ventspils, the ring cost six candidates 209 s of a 50 s budget, for
 *     points no rider had ever asked for.
 *  2. **A rider-named via is never lost silently.** A stop typed into the form
 *     or added from a suggestion gets the full ring wherever it sits in the
 *     list, and if that finds nothing the request fails honestly. Backlog item
 *     20's Satezeles pilskalns was being deleted from the ride by the
 *     island-drop, which is worse than a refusal: the rider gets back a route
 *     that does not go where they asked and nothing says so.
 *
 * BRouter is stubbed rather than called. What is being pinned is *which
 * requests we make*, and that is exactly what a stub can see and a live server
 * cannot — the real instance answers the same refusal either way, so a live
 * test would pass without the fix.
 */
import test from "node:test";
import assert from "node:assert/strict";

// These tests are about the rescue path, so the router must look self-hosted:
// with no `BROUTER_BASE_URL` the client takes the public instance's segmented
// retry — splitting the leg into 2-point pieces and stitching them — which is
// a different rescue with its own reasons, and it would answer here instead of
// the code under test. (It is also what makes an unset value in a developer's
// shell change what these assert; pinning it keeps the test honest either way.)
process.env.BROUTER_BASE_URL ||= "http://brouter.test";

import { fetchRoutePath } from "@/lib/routing/brouter";
import type { MotoProfileOptions } from "@/lib/routing/moto-profile";

const OPTIONS: MotoProfileOptions = {
  offRoad: 0.5,
  difficulty: "adventure",
  trails: "some",
  accessPolicy: "allow_unverified",
  avoidMainRoads: false,
  avoidMotorways: true,
  noSand: false,
  avoidTowns: false,
};

type Point = [number, number];
const A: Point = [21.0, 56.5];
const B: Point = [21.5, 57.4];
const VIA: Point = [21.42, 56.92];

/** A minimal BRouter GeoJSON answer, enough for `requestPath`. */
function routeBody(km: number) {
  return JSON.stringify({
    features: [
      {
        geometry: { type: "LineString", coordinates: [[A[0], A[1]], [B[0], B[1]]] },
        properties: { "track-length": km * 1000, "total-time": km * 80, messages: [] },
      },
    ],
  });
}

/**
 * Stub BRouter. `refuse` decides, per request, whether to answer the 400 that
 * starts all of this; every request's waypoint list is recorded so a test can
 * assert on what was asked rather than only on what came back.
 */
function stubBrouter(refuse: (lonlats: string) => string | null) {
  const asked: string[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = String(typeof input === "object" && "url" in input ? input.url : input);
    if (url.includes("/brouter/profile")) {
      return new Response(JSON.stringify({ profileid: "test-profile" }), { status: 200 });
    }
    const lonlats = decodeURIComponent(/lonlats=([^&]*)/.exec(url)?.[1] ?? "");
    asked.push(lonlats);
    const reason = refuse(lonlats);
    if (reason) return new Response(reason, { status: 400 });
    return new Response(routeBody(140), { status: 200 });
  }) as typeof fetch;
  return { asked, restore: () => { globalThis.fetch = original; } };
}

/** Waypoint lists, as BRouter saw them. */
const points = (lonlats: string): Point[] =>
  lonlats.split("|").map((p) => p.split(",").map(Number) as Point);

test("a generated via that cannot be reached is dropped, and the ring is never run", async () => {
  // Every request whose waypoints still include the exact bad via is refused,
  // which is the measured behaviour: the point routes out but not in, and
  // shifting it a few hundred metres does not help (item 11g bisected this —
  // every point within 600 m of it fails from A).
  const stub = stubBrouter((lonlats) =>
    points(lonlats).some(([lon, lat]) => Math.abs(lon - VIA[0]) < 0.01 && Math.abs(lat - VIA[1]) < 0.01)
      ? "error re-tracking track"
      : null
  );
  try {
    const path = await fetchRoutePath({
      points: [A, VIA, B],
      profileOptions: OPTIONS,
      generatedViaIndices: [1],
    });
    assert.equal(path.distanceMeters, 140_000, "the candidate routes without its bad via");

    // The last request is the rescue: A → B, the via gone.
    assert.deepEqual(points(stub.asked[stub.asked.length - 1]), [A, B]);

    // The ring is 3 radii x 8 bearings x 2 ends = 24 requests. Anything near
    // that means a generated via bought the rider-named treatment, which is
    // the whole 209 s bug. Two shifts + one drop is 3 routing requests.
    assert.ok(stub.asked.length <= 6, `expected a handful of requests, made ${stub.asked.length}`);

    // And none of them moved an ENDPOINT: the rider's places are not at fault.
    for (const lonlats of stub.asked) {
      const p = points(lonlats);
      assert.deepEqual(p[0], A, "the start was never moved");
      assert.deepEqual(p[p.length - 1], B, "the destination was never moved");
    }
  } finally {
    stub.restore();
  }
});

test("a generated via is first shifted along the corridor, and kept when that works", async () => {
  // Here the point itself is fine 300 m back — the cheaper of the two moves —
  // so the candidate should keep its shape instead of losing the via.
  const stub = stubBrouter((lonlats) =>
    points(lonlats).some(([lon, lat]) => lon === VIA[0] && lat === VIA[1])
      ? "error re-tracking track"
      : null
  );
  try {
    const path = await fetchRoutePath({
      points: [A, VIA, B],
      profileOptions: OPTIONS,
      generatedViaIndices: [1],
    });
    assert.equal(path.distanceMeters, 140_000);
    const last = points(stub.asked[stub.asked.length - 1]);
    assert.equal(last.length, 3, "the via was kept, not dropped");
    // It moved towards A (the approach the router refused), by a few hundred metres.
    assert.ok(last[1][0] < VIA[0] && last[1][1] < VIA[1], "the via moved back along the corridor");
  } finally {
    stub.restore();
  }
});

test("a candidate with two generated vias still reaches the drop (the budget reserve)", async () => {
  // The bug this pins, found by measuring rather than by reading: Liepāja →
  // Ventspils' corridor candidates carry TWO generated vias, so the shift
  // attempts are 2 vias x 2 distances = 4 requests, and at ~600 ms a refusal
  // they used the entire 2 s budget. The drop — the step that actually rescues
  // these — then never ran, the candidate fell through to the nudge ring, and
  // it cost 27.8 s instead of 2.5 s. `DROP_RESERVE_MS` keeps a slot for it.
  const E: Point = [21.12, 56.85];
  const X: Point = [21.45, 57.16];
  let shiftAttempts = 0;
  const stub = stubBrouter((lonlats) => {
    const p = points(lonlats);
    // Anything still carrying a generated via is refused, however it moved —
    // which is the measured behaviour of these two entries.
    if (p.length > 2) {
      shiftAttempts++;
      return "error re-tracking track";
    }
    return null;
  });
  try {
    const path = await fetchRoutePath({
      points: [A, E, X, B],
      profileOptions: OPTIONS,
      generatedViaIndices: [1, 2],
    });
    assert.equal(path.distanceMeters, 140_000, "the candidate routed on the plain A→B line");
    assert.deepEqual(points(stub.asked[stub.asked.length - 1]), [A, B], "both generated vias were dropped");
    assert.ok(shiftAttempts <= 5, `the shifts stayed bounded, made ${shiftAttempts}`);
    assert.ok(stub.asked.length <= 8, `no ring was run; ${stub.asked.length} requests in total`);
  } finally {
    stub.restore();
  }
});

test("a rider-named via gets the endpoint-nudge ring, and is never dropped", async () => {
  // The same refusal, but nobody told `fetchRoutePath` the via was generated —
  // which is what happens for a stop from the form or a suggestion. Nothing
  // routes at all here, so the request must fail rather than quietly return a
  // ride that skips the rider's stop.
  const stub = stubBrouter(() => "error re-tracking track");
  try {
    await assert.rejects(
      fetchRoutePath({ points: [A, VIA, B], profileOptions: OPTIONS }),
      /re-tracking track/,
      "an unreachable named via fails honestly"
    );
    // The ring was actually run: 3 radii x 8 bearings over end, start and the
    // named middle via. The exact count is not the contract; that it is far
    // more than the generated via's handful, and that the via was never simply
    // deleted, both are.
    assert.ok(stub.asked.length > 20, `expected the ring, made only ${stub.asked.length} requests`);
    for (const lonlats of stub.asked) {
      assert.equal(points(lonlats).length, 3, "the named via stayed in every request");
    }
  } finally {
    stub.restore();
  }
});

test("a rider-named via on an island is nudged, not deleted (backlog item 20)", async () => {
  // Satezeles pilskalns' real signature: BRouter answers "target island
  // detected", not "re-tracking track", so this took its own branch — and that
  // branch used to delete the point. On a round trip (start, stop, start) the
  // drop budget is zero, so the request simply 422'd.
  const START: Point = [24.853, 57.153];
  const STOP: Point = [24.8707, 57.17161];
  const stub = stubBrouter((lonlats) =>
    points(lonlats).some(([lon, lat]) => lon === STOP[0] && lat === STOP[1])
      ? "target island detected for section 0"
      : null
  );
  try {
    const path = await fetchRoutePath({ points: [START, STOP, START], profileOptions: OPTIONS });
    assert.equal(path.distanceMeters, 140_000);
    assert.ok(path.endpointMovedMeters, "the ride says how far the stop had to move");
    const last = points(stub.asked[stub.asked.length - 1]);
    assert.equal(last.length, 3, "the rider's stop is still in the ride");
    assert.notDeepEqual(last[1], STOP, "it was moved to routable ground rather than deleted");
  } finally {
    stub.restore();
  }
});

test("a generated via on an island is still dropped on sight", async () => {
  // The cheap behaviour this loop has always given generated vias, and item
  // 11g keeps: no ring, no shift budget spent, just route without it.
  const stub = stubBrouter((lonlats) =>
    points(lonlats).length > 2 ? "target island detected for section 0" : null
  );
  try {
    const path = await fetchRoutePath({
      points: [A, VIA, B],
      profileOptions: OPTIONS,
      generatedViaIndices: [1],
    });
    assert.equal(path.distanceMeters, 140_000);
    assert.ok(stub.asked.length <= 3, `dropped cheaply, made ${stub.asked.length} requests`);
    assert.deepEqual(points(stub.asked[stub.asked.length - 1]), [A, B]);
  } finally {
    stub.restore();
  }
});
