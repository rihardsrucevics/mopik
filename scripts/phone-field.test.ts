import test from "node:test";
import assert from "node:assert/strict";
import { messages } from "../lib/i18n/messages";

/**
 * The phone's map field (rider, 2026-09-28): at 320 px „Meklē vai atzīmē
 * pieturu” was cut off, and beside „Caur (2)” the field was 80 px. The phone
 * gets short words and the row a number badge; measured in the browser
 * (scratchpad/pw/field.cjs) at 320 and 375 px. Here: the words stay short in
 * every language, and Latvian says exactly what the rider approved.
 *
 * `npx tsx --test scripts/phone-field.test.ts`
 */

test("the phone's field words are short in every language", () => {
  for (const locale of ["lv", "lt", "et", "en"] as const) {
    const m = messages(locale);
    assert.ok(m.mapNoActiveRowShort.length <= 18, `${locale}: ${m.mapNoActiveRowShort}`);
    assert.ok(m.mapSearchHintShort.length <= 10, `${locale}: ${m.mapSearchHintShort}`);
    assert.ok(m.pointMoveHintShort.length <= 14, `${locale}: ${m.pointMoveHintShort}`);
    assert.ok(m.mapNoActiveRowShort.length < m.mapNoActiveRow.length, `${locale}: shorter than the desktop's`);
  }
  assert.equal(messages("lv").mapNoActiveRowShort, "Meklē pieturu");
  assert.ok(!/piesit/i.test(Object.values(messages("lv")).join(" ")), "Latvian never says „piesit”");
});
