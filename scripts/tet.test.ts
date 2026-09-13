import test from "node:test";
import assert from "node:assert/strict";
import { loadTetSections } from "../lib/routing/tet";
import { measureTetCoverage } from "../lib/routing/tet-coverage";

/**
 * The TET layer went from one country to 33, which broke two assumptions that
 * were invisible while it was Latvia-only. These pin both.
 */

test("the TET layer covers Europe, not just Latvia", () => {
  const sections = loadTetSections();
  assert.ok(sections.length > 300, `expected the European set, got ${sections.length} sections`);

  const countries = new Set(sections.map((s) => s.name.replace(/^TET[_ ]?/, "").split(/[-_]/)[0]));
  // A spread of latitudes is the point: the matcher's projection used to be
  // hardcoded to Latvia's.
  for (const needle of ["_E-", "_N-", "_TR-", "_LV-"]) {
    assert.ok(sections.some((s) => s.name.includes(needle)), `missing sections for ${needle}`);
  }
  assert.ok(countries.size > 20, `expected many countries, got ${countries.size}`);
});

test("coverage matches at every latitude, not only Latvia's", () => {
  const sections = loadTetSections();
  // `project` was fixed at cos(57°). At Spain's latitude that is 26 % off in
  // the x axis, which quietly shrinks the 35 m tolerance until nothing matches.
  for (const needle of ["_E-", "_N-", "_TR-", "_LV-"]) {
    const section = sections.find((s) => s.name.includes(needle) && s.coordinates.length > 600);
    assert.ok(section, `no long section for ${needle}`);
    // A slice of the trail itself must be recognised as being on the trail.
    const slice = section.coordinates.slice(100, 400);
    const result = measureTetCoverage(slice);
    assert.ok(result, `${section.name} at lat ${slice[0][1].toFixed(1)} was not recognised as TET`);
    assert.ok(result.sliceKm > 5, `${section.name}: only ${result.sliceKm} km matched`);
  }
});

test("a ride nowhere near the trail reports no coverage", () => {
  // Mid-Atlantic: no TET, and no crash either.
  const nowhere: [number, number][] = [
    [-30, 40], [-30.01, 40.01], [-30.02, 40.02], [-30.03, 40.03],
  ];
  assert.equal(measureTetCoverage(nowhere), undefined);
  assert.equal(measureTetCoverage([]), undefined);
});
