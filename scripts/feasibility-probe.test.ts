// Run: npx tsx --test scripts/feasibility-probe.test.ts
import assert from "node:assert/strict";
import test from "node:test";
import {
  affordableCandidates,
  headlineLeg,
  GENERATION_OVERHEAD_MS,
} from "../lib/routing/fetch-route-probe";
import type { Point } from "../lib/geo/geometry";

/** The API's own budget, so the numbers here are the ones production uses. */
const BUDGET = 50_000;

test("candidate scaling is (budget − spent − overhead) / leg cost", () => {
  // A 2 s leg after 2 s spent: (50000 − 2000 − 5000) / 2000 = 21.5 → 21.
  assert.equal(
    affordableCandidates({ budgetMs: BUDGET, spentMs: 2_000, legMs: 2_000, cap: 36 }),
    21
  );
  // A 5 s leg after 5 s spent: (50000 − 5000 − 5000) / 5000 = 8.
  assert.equal(
    affordableCandidates({ budgetMs: BUDGET, spentMs: 5_000, legMs: 5_000, cap: 36 }),
    8
  );
  // The overhead is really subtracted: without it the 2 s case would be 24.
  assert.equal(
    affordableCandidates({ budgetMs: BUDGET, spentMs: 2_000, legMs: 2_000, overheadMs: 0, cap: 36 }),
    24
  );
});

test("a fast leg is capped by the pool, never inflated beyond it", () => {
  // Rīga → Baldone territory: the arithmetic allows far more than exist.
  const affordable = affordableCandidates({
    budgetMs: BUDGET,
    spentMs: 500,
    legMs: 500,
    cap: 36,
  });
  assert.equal(affordable, 36, "a cheap leg must not reduce the search at all");
  // Which is the regression that matters: the ordinary Baltic ride the rider
  // does every weekend must behave exactly as it did before the probe.
  assert.ok(
    affordableCandidates({ budgetMs: BUDGET, spentMs: 2_400, legMs: 2_400, cap: 36 }) >= 17,
    "Rīga → Tallinn at 2.4 s must still afford a full search"
  );
});

test("a slow leg reduces the search instead of failing, and never to zero", () => {
  // Como → Budapest at 74 s: the budget cannot pay for even one more leg.
  // One is still returned, because the probe already holds a routed leg and
  // one version beats a 422.
  assert.equal(
    affordableCandidates({ budgetMs: BUDGET, spentMs: 74_000, legMs: 74_000, cap: 36 }),
    1
  );
  // Berlin → Warszawa on the rider's hard-forest profile measured 31-37 s a
  // leg: strictly fewer candidates than the pool, and more than none.
  const n = affordableCandidates({ budgetMs: BUDGET, spentMs: 31_000, legMs: 31_000, cap: 36 });
  assert.ok(n >= 1 && n < 36, `expected a reduced search, got ${n}`);
});

test("an instant measurement cannot divide into an unbounded search", () => {
  // A leg reported as 0 ms (a cached or local answer) must not promise
  // infinite candidates; the floor turns it into a large but finite number,
  // and the pool cap does the rest.
  assert.equal(
    affordableCandidates({ budgetMs: BUDGET, spentMs: 0, legMs: 0, cap: 36 }),
    36
  );
  assert.ok(
    Number.isFinite(
      affordableCandidates({ budgetMs: BUDGET, spentMs: 0, legMs: 0, cap: Number.MAX_SAFE_INTEGER })
    )
  );
});

test("the headline leg is the longest hop, not the first or the sum", () => {
  const riga: Point = [24.1052, 56.9496];
  const sigulda: Point = [24.8530, 57.1530];
  const roma: Point = [12.4964, 41.9028];
  // A short hop followed by a very long one: the long one decides.
  const leg = headlineLeg([riga, sigulda, roma]);
  assert.ok(leg);
  assert.deepEqual(leg.from, sigulda);
  assert.deepEqual(leg.to, roma);
  assert.ok(leg.km > 1000, `expected the Roma leg, got ${leg.km} km`);
  // Two points is just that leg; fewer than two has no leg at all.
  assert.ok(headlineLeg([riga, sigulda])!.km < 100);
  assert.equal(headlineLeg([riga]), null);
});

test("the overhead default is the one the API relies on", () => {
  // The API calls `affordableCandidates` without an `overheadMs`, so the
  // default is load-bearing rather than decorative.
  assert.equal(
    affordableCandidates({ budgetMs: BUDGET, spentMs: 0, legMs: 10_000, cap: 36 }),
    Math.floor((BUDGET - GENERATION_OVERHEAD_MS) / 10_000)
  );
});
