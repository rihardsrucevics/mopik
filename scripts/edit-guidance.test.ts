import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { OBJECT_COLOR, actionDetail, guidance, guideAction, joinGuide, objectExplainer } from "../lib/map/edit-guidance";
import { proposalView, staleWhileRouting } from "../lib/map/proposal-view";
import { t, type MessageKey } from "../lib/i18n/messages";
import type { UiLocale } from "../lib/i18n/locale";

/**
 * Every edit state says what it is and what to do (rider, 2026-09-28): the
 * three kinds of object (and the start and finish) each with a mark, a
 * colour and an explainer; each action with a detail line; one guidance
 * line „what is happening – what to do” for every state.
 *
 * `npx tsx --test scripts/edit-guidance.test.ts`
 */

const lv = (k: MessageKey) => t("lv", k);
const src = (f: string) => readFileSync(join(__dirname, "..", f), "utf8");

test("one guidance line per state, in two parts joined by an en dash", () => {
  assert.equal(guidance(lv, { kind: "selected", object: "stop", name: "Pietura 2" }), "Pietura 2 izvēlēta – izvēlies darbību.");
  assert.equal(guidance(lv, { kind: "selected", object: "pass", name: "Caurbraucams punkts" }), "Caurbraucams punkts izvēlēts – izvēlies darbību.");
  assert.equal(guidance(lv, { kind: "selected", object: "line", name: "Ceļa posms" }), "Ceļa posms izvēlēts – izvēlies darbību.");
  assert.equal(guidance(lv, { kind: "move", name: "Pietura 2" }), "Pārvieto „Pietura 2” – pieskaries jaunajai vietai kartē.");
  assert.equal(guidance(lv, { kind: "via" }), "Virzi posmu – pieskaries vietai, caur kuru braukt.");
  assert.equal(guidance(lv, { kind: "routing" }), "Pārrēķinu… – vari jau spiest ✓, apstiprināšu, tiklīdz būs gatavs.");
  assert.equal(guideAction(lv, { kind: "proposed" }), "✓ apstiprina, ✕ atmet.");
  assert.equal(
    guidance(lv, { kind: "refused", reason: "Šeit nevar piebraukt (~629 m no ceļa)." }),
    "Šeit nevar piebraukt (~629 m no ceļa) – izvēlies citu vietu.",
    "the reason's full stop goes before the dash",
  );
  assert.equal(guidance(lv, { kind: "refused", reason: "x", wide: true }), "x – spied „Pārrēķināt posmu” vai ✕ atmet.");
  assert.equal(joinGuide("", "a."), "a.");
});

test("each object explains itself, each action says what it does", () => {
  assert.equal(objectExplainer(lv, "stop"), "Maršruts iet caur šo vietu, un tā ir GPX failā.");
  assert.equal(objectExplainer(lv, "pass"), "Tikai virza līniju, bez numura un bez apstāšanās.");
  assert.equal(objectExplainer(lv, "line"), "Šo gabalu var virzīt citur vai pievienot tam punktu.");
  assert.ok(objectExplainer(lv, "start") && objectExplainer(lv, "finish"));
  assert.equal(actionDetail(lv, "demote", "stop"), "Vairs nebūs numura un nebūs GPX pieturas");
  assert.notEqual(actionDetail(lv, "remove", "stop"), actionDetail(lv, "remove", "pass"), "removing a stop and a pass-through point say different things");
});

test("the chip carries what to do after its numbers, in every phase", () => {
  const copy = { routing: "Pārrēķinu…", delta: "{a} → {b} km", deltaTitle: "{b} km", guide: { routing: lv("guideRouting"), proposed: lv("guideProposed"), refused: lv("guideRefused"), refusedWide: lv("guideRefusedWide") } };
  assert.equal(proposalView({ phase: "routing", token: 1, how: "move-stop", confirmWhenReady: false }, copy, "lv")?.guide, lv("guideRouting"));
  const refused = proposalView({ phase: "refused", token: 1, how: "move-stop", reason: "Šeit nevar piebraukt." }, copy, "lv");
  assert.deepEqual([refused?.text, refused?.guide], ["Šeit nevar piebraukt", lv("guideRefused")]);
  assert.equal(proposalView({ phase: "refused", token: 1, how: "move-stop", reason: "r" }, { ...copy, wide: true }, "lv")?.guide, lv("guideRefusedWide"));
  // Stale while the next change routes: the numbers stay, what to do is the routing's.
  const landed = { text: "1 → 2 km", title: "", line: { type: "FeatureCollection" as const, features: [] }, changed: [], guide: lv("guideProposed") };
  assert.equal(staleWhileRouting(landed, { text: "Pārrēķinu…", title: "", tone: "routing", line: null, changed: [], guide: lv("guideRouting") })?.guide, lv("guideRouting"));
  // Without the guide copy, the view is as it was.
  assert.equal(proposalView({ phase: "routing", token: 1, how: "move-stop", confirmWhenReady: false }, { routing: "R", delta: "", deltaTitle: "" }, "lv")?.guide, undefined);
});

test("every locale has the copy, Latvian in its own punctuation", () => {
  const keys: MessageKey[] = ["guideSelectedStop", "guideSelectedPass", "guideSelectedLine", "guideSelectedStart", "guideSelectedFinish", "guideChoose", "guideMoving", "guideTapNew", "guideVia", "guideTapVia", "guideRouting", "guideProposed", "guideRefused", "guideRefusedWide", "explainStop", "explainPass", "explainLine", "explainStart", "explainFinish", "detailMove", "detailDemote", "detailPromote", "detailRemoveStop", "detailRemovePass", "detailVia", "detailPassHere", "lineSheetTitleKind", "lineObjectName", "lineSheetTitle", "lineVia", "lineViaHint", "linePassHere", "editTip", "lineHoverTip"];
  for (const locale of ["lv", "lt", "et", "en"] as UiLocale[]) {
    for (const k of keys) {
      const v = t(locale, k);
      assert.ok(v && v.trim(), `${locale}.${k}`);
      assert.doesNotMatch(v, /—/, `${locale}.${k}: en dashes, never em dashes`);
    }
  }
  for (const k of keys) {
    assert.doesNotMatch(t("lv", k), /piesit/i, `lv.${k} never says „piesit”`);
    assert.doesNotMatch(t("lv", k), /"|“/, `lv.${k} quotes with „ ”`);
  }
});

test("the sheets and the map wear the object's own colour", () => {
  const routeMap = src("components/route-map.tsx");
  assert.match(routeMap, new RegExp(`const START_PIN_COLOR = "${OBJECT_COLOR.start}";`));
  assert.match(routeMap, new RegExp(`const FINISH_PIN_COLOR = "${OBJECT_COLOR.finish}";`));
  assert.match(routeMap, new RegExp(`background:${OBJECT_COLOR.stop};color:#fff;`), "the numbered stop disc");
  assert.match(routeMap, new RegExp(`solid"\\} ${OBJECT_COLOR.pass};`), "the pass-through dot's edge");
  assert.match(routeMap, /selectionRingElement\(selectedColor\)/, "the ring in the selected object's colour");
  const composer = src("components/ride-composer.tsx");
  assert.match(composer, /selectedColor: selObject \? OBJECT_COLOR\[selObject\] : undefined,/);
  // Both sheets are built from the one module.
  const sheets = composer.slice(composer.indexOf("pointSheet: lineSel?.phase === \"menu\""), composer.indexOf("movePreview,\n      planLine"));
  assert.equal(sheets.split("explainer:").length - 1, 2, "the line sheet and the point sheet");
  assert.match(sheets, /hint: guidance\(tk, \{ kind: "via" \}\)/);
  assert.match(sheets, /hint: guidance\(tk, \{ kind: "move", name: pointTitle \}\)/);
  assert.ok(sheets.split("detailed(").length - 1 >= 5, "every action row has its detail");
});
