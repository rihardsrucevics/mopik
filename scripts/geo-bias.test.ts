import test from "node:test";
import assert from "node:assert/strict";
import { searchPlaces } from "../lib/chat/photon";

/**
 * Place search went from Baltics-only to worldwide-but-biased. Two things must
 * stay true at once, and they pull against each other:
 *
 *   - a place abroad must be findable at all ("Innsbruck" used to return 0);
 *   - a Latvian case form must not escape ("Cēsīm" is Ćesim in Bosnia and
 *     "Tukumu" is Tukumunga in Papua New Guinea to a worldwide geocoder).
 *
 * These hit the live Photon service, so they are about behaviour rather than
 * exact wording, and they skip rather than fail when it is unreachable.
 */

const RIGA = { lat: 56.9496, lon: 24.1052 };
const MUNICH = { lat: 48.14, lon: 11.58 };
const HAMBURG = { lat: 53.55, lon: 9.99 };

async function search(q: string, home?: { lat: number; lon: number }) {
  try {
    return await searchPlaces(q, home);
  } catch {
    return null;
  }
}

test("places outside the Baltics are findable", async (t) => {
  const hits = await search("Innsbruck");
  if (!hits) return t.skip("Photon unreachable");
  assert.ok(hits.length > 0, "Innsbruck returned nothing — the old bbox is back");
  assert.match(hits[0].label, /Innsbruck/);
});

test("Baltic places still lead, and by name not by country", async (t) => {
  for (const [q, expected] of [["Sigulda", /^Sigulda/], ["Cēsis", /^Cēsis/], ["Baldone", /^Baldone/]] as const) {
    const hits = await search(q);
    if (!hits) return t.skip("Photon unreachable");
    assert.ok(hits.length, `${q} returned nothing`);
    // The town itself, not "Siguldas novads" or a hamlet that happens to be
    // nearer: rank beats distance in the sort.
    assert.match(hits[0].name, expected, `${q} resolved to ${hits[0].label}`);
  }
});

test("the bias point decides between same-named places", async (t) => {
  // "Neustadt" is dozens of German towns; which one is meant depends on where
  // the rider is. This is the whole reason the bias exists.
  const [near, far] = await Promise.all([search("Neustadt", MUNICH), search("Neustadt", HAMBURG)]);
  if (!near || !far || !near.length || !far.length) return t.skip("Photon unreachable");
  assert.notEqual(near[0].label, far[0].label, "the bias point made no difference");
});

test("a Latvian case form resolves to the Latvian town, not a namesake", async (t) => {
  // The whole reason the Baltic fence existed. Unfenced, a worldwide geocoder
  // answers "Cēsīm" with Ćesim in Bosnia and "Tukumu" with Tukumunga in Papua
  // New Guinea. The list may still *contain* far-away namesakes — Italy has
  // several "Cesi" — but the one a rider reads first must be the right one.
  for (const [q, town] of [["Cēsīm", "Cēsis"], ["Siguldā", "Sigulda"]] as const) {
    const hits = await search(q, RIGA);
    if (!hits) return t.skip("Photon unreachable");
    assert.ok(hits.length, `${q} returned nothing`);
    assert.equal(hits[0].name, town, `"${q}" led with ${hits[0].label}`);
  }
});
