import test from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import path from "path";

/**
 * The .pbf pre-filter must not change which POIs are collected.
 *
 * ## What was wrong
 *
 * Poland's 2 GB extract sat in uninterruptible disk wait for **2 h 30 min**
 * where Estonia's 117 MB took 88 s. The cause was not the node location index
 * (every storage variant measured within 10 % of the others) but the order
 * `FileProcessor.__iter__` installs its handlers: with `with_areas()` the
 * area handler's second-pass handler runs *before* the filter chain, so every
 * closed way in the file — a couple of million building outlines in Poland —
 * was assembled into an Area and handed to Python before `EmptyTagFilter`
 * could reject it.
 *
 * The fix pre-filters in C++ on the tag keys the matchers read. Latvia went
 * from 130 s to 21 s with byte-identical output.
 *
 * ## What these tests pin
 *
 * The filter is only safe because `PBF_KEYS` is *derived* from
 * `PBF_MATCHERS` rather than hand-typed. A category added with a new tag key
 * and a hand-typed list would be filtered out of every build and produce no
 * error at all — just a category silently missing from the dataset. So the
 * derivation is what is checked here, from the Python source, the same way
 * `poi-kinds.test.ts` reads the category table rather than retyping it.
 */

function script(): string {
  return fs.readFileSync(
    path.join(process.cwd(), "scripts", "build_poi_dataset.py"),
    "utf-8"
  );
}

/** Every `t.get("key")` inside the PBF_MATCHERS table. */
function matcherKeys(): string[] {
  const source = script();
  const start = source.indexOf("PBF_MATCHERS = {");
  const table = source.slice(start, source.indexOf("\n}", start));
  const keys = new Set(
    [...table.matchAll(/t\.get\("([a-z:_]+)"\)/g)].map((m) => m[1])
  );
  keys.delete("name");
  return [...keys].sort();
}

test("PBF_KEYS is derived from the matchers, never hand-typed", () => {
  const source = script();
  // The derivation is the whole safety argument: a hand-written tuple would
  // pass every other test here while silently dropping a new category.
  assert.match(
    source,
    /PBF_KEYS = _matcher_keys\(\)/,
    "PBF_KEYS must come from _matcher_keys(), not a literal"
  );
  assert.match(
    source,
    /def _matcher_keys\(\)/,
    "_matcher_keys() is missing"
  );
  // It must probe the real matcher table rather than a copy of it.
  const fn = source.slice(
    source.indexOf("def _matcher_keys()"),
    source.indexOf("PBF_KEYS = _matcher_keys()")
  );
  assert.match(
    fn,
    /PBF_MATCHERS\.values\(\)/,
    "_matcher_keys() must probe PBF_MATCHERS itself"
  );
});

test("the pre-filter is applied to both the area pass and the main chain", () => {
  const source = script();
  // Only the main-chain filter was measured as the big win (92 s -> 21 s),
  // but the area-pass filter is what keeps the first pass from collecting
  // member ways for relations no category wants. Both, or neither is safe.
  assert.match(
    source,
    /with_areas\(osmium\.filter\.KeyFilter\(\*PBF_KEYS\)\)/,
    "the area first pass must be filtered"
  );
  assert.match(
    source,
    /with_filter\(osmium\.filter\.KeyFilter\(\*PBF_KEYS\)\)/,
    "the main chain must be filtered"
  );
});

test("the unfiltered chain is still reachable behind --no-prefilter", () => {
  const source = script();
  // The claim "the filter changes nothing" is only worth anything while it
  // stays checkable on a fresh extract.
  assert.match(source, /--no-prefilter/, "the escape hatch is gone");
  assert.match(
    source,
    /prefilter=True/,
    "collect_from_pbf must keep the prefilter parameter"
  );
  assert.match(
    source,
    /osmium\.filter\.EmptyTagFilter\(\)/,
    "the old EmptyTagFilter chain must still exist"
  );
});

test("every matcher tag key reaches the filter", () => {
  // The real invariant: a key a matcher reads but the filter does not pass is
  // a category that silently collects nothing. This reproduces the derivation
  // independently, from the source text rather than by running Python.
  const keys = matcherKeys();
  assert.ok(keys.length >= 9, `parsed only ${keys.length} matcher keys`);
  // These are the keys as of the cave/cliff/waterfall split. A new category
  // adding a key is fine — _matcher_keys() picks it up — but it should land
  // here deliberately, so the list is pinned.
  assert.deepEqual(keys, [
    "amenity",
    "ford",
    "historic",
    "leisure",
    "man_made",
    "natural",
    "place",
    "route",
    "tourism",
    "tower:type",
  ]);
});

test("a key behind a short-circuiting `and` is still a key the filter needs", () => {
  // `tower` is `man_made == "tower" and tower:type in (…)`. Python stops at
  // the first false operand, so probing a matcher with an empty tag dict —
  // which is how `_matcher_keys()` works — never reaches `tower:type`, and
  // the derived PBF_KEYS legitimately omits it.
  //
  // That is correct *because* KeyFilter is an OR: an object carrying
  // `man_made` passes the filter on that key alone and the full matcher then
  // runs on the real tags. It would stop being correct the moment a category
  // were written with the narrower key first (`tower:type` before
  // `man_made`), because then neither key would be probed and the category
  // would collect nothing. So: every matcher must read at least one key that
  // survives the probe, and the check below is that no matcher's *first*
  // lookup is a key the derivation misses.
  const source = script();
  const start = source.indexOf("PBF_MATCHERS = {");
  const table = source.slice(start, source.indexOf("\n}", start));
  // Split the table into one entry per category, then take each entry's first
  // `t.get("…")` — the one Python is guaranteed to evaluate.
  const entries = [
    ...table.matchAll(/"([a-z]+)": ([\s\S]*?)(?=\n {4}"[a-z]+": |$)/g),
  ];
  assert.ok(entries.length >= 10, `parsed only ${entries.length} matcher bodies`);

  // What `_matcher_keys()` actually derives: the keys reachable when every
  // lookup returns None. Probing stops at the first operand of an `and`.
  const derived = new Set([
    "amenity",
    "ford",
    "historic",
    "leisure",
    "man_made",
    "natural",
    "place",
    "route",
    "tourism",
  ]);

  for (const [, category, body] of entries) {
    const first = body.match(/t\.get\("([a-z:_]+)"\)/);
    if (!first) continue; // a named helper (`_is_archaeological`), read below
    assert.ok(
      derived.has(first[1]),
      `${category} evaluates ${first[1]} first, but PBF_KEYS does not contain ` +
        `it — the category would be filtered out of every .pbf build silently`
    );
  }
});

test("thinning's order-dependence is documented where it lives", () => {
  const source = script();
  // Thinning has no explicit tiebreak, so with score and namedness equal it
  // keeps whichever POI was collected first — and the pre-filter changes
  // collection order. Measured on Latvia both chains still thin to the same
  // 4,624 ids, but the next person to touch this sort needs to know why a
  // tiebreak was considered and rejected rather than re-deriving it.
  const sortLine = source.indexOf("collected.sort(");
  assert.ok(sortLine > 0, "the thinning sort moved");
  const preceding = source.slice(Math.max(0, sortLine - 1400), sortLine);
  assert.match(
    preceding,
    /tiebreak/i,
    "the thinning sort's order-dependence must stay documented above it"
  );
});
