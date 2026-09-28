import { fi } from "@/lib/i18n/format";
import type { MessageKey } from "@/lib/i18n/messages";

/**
 * What the rider is looking at and what to do next, for every edit state
 * (rider, 2026-09-28): one module, so the point sheet, the line sheet and
 * the notice area say it the same way.
 *
 * - Three kinds of object — a stop, a pass-through point, a road stretch —
 *   plus the start and the finish, each with its own mark and colour in the
 *   sheet's header (the same as on the map) and one explainer line.
 * - Each action row has a short detail line: what it will do.
 * - One guidance line in the notice area, in two parts joined by an en dash:
 *   what is happening – what to do („Pārvieto „Pietura 2” – pieskaries
 *   jaunajai vietai kartē.”). The proposal's chip carries the second part
 *   after its numbers.
 *
 * Pure: the copy comes in as a lookup (`t`), so it is tested without React.
 */

export type EditObject = "stop" | "pass" | "line" | "start" | "finish";

/** The mark and colour a sheet's header wears — the same as the object's on the map. */
export type ObjectMark =
  | { kind: "stop"; number: number }
  | { kind: "pass" }
  | { kind: "start" }
  | { kind: "finish" }
  | { kind: "line"; color: string };

/** The map's own colours for each object (route-map.tsx: pins, dots, the highlight). */
export const OBJECT_COLOR: Record<EditObject, string> = {
  stop: "#f56300",
  pass: "#1c1917",
  line: "#eab308",
  start: "#16a34a",
  finish: "#dc2626",
};

/** Between the two parts of a guidance line. */
export const GUIDE_DASH = " – ";

type T = (key: MessageKey) => string;

const EXPLAIN: Record<EditObject, MessageKey> = {
  stop: "explainStop",
  pass: "explainPass",
  line: "explainLine",
  start: "explainStart",
  finish: "explainFinish",
};

const SELECTED: Record<EditObject, MessageKey> = {
  stop: "guideSelectedStop",
  pass: "guideSelectedPass",
  line: "guideSelectedLine",
  start: "guideSelectedStart",
  finish: "guideSelectedFinish",
};

/** The explainer under a sheet's title: what this object is. */
export function objectExplainer(t: T, object: EditObject): string {
  return t(EXPLAIN[object]);
}

export type SheetAction = "move" | "demote" | "promote" | "remove" | "via" | "passHere";

/** A row's detail line: what pressing it will do, for this object. */
export function actionDetail(t: T, action: SheetAction, object: EditObject): string {
  switch (action) {
    case "move": return t("detailMove");
    case "demote": return t("detailDemote");
    case "promote": return t("detailPromote");
    case "remove": return t(object === "pass" ? "detailRemovePass" : "detailRemoveStop");
    case "via": return t("detailVia");
    case "passHere": return t("detailPassHere");
  }
}

/**
 * The states the notice area speaks for. `name` is the object's title as the
 * sheet shows it („Pietura 2”, „Caurbraucams punkts”, „Ceļa posms”).
 */
export type GuideState =
  | { kind: "selected"; object: EditObject; name: string }
  | { kind: "move"; name: string }
  | { kind: "via" }
  | { kind: "routing" }
  | { kind: "proposed" }
  | { kind: "refused"; reason: string; wide?: boolean };

/** Just the "what to do" part of a state — what the chip adds after its own words. */
export function guideAction(t: T, state: GuideState): string {
  switch (state.kind) {
    case "selected": return t("guideChoose");
    case "move": return t("guideTapNew");
    case "via": return t("guideTapVia");
    case "routing": return t("guideRouting");
    case "proposed": return t("guideProposed");
    case "refused": return t(state.wide ? "guideRefusedWide" : "guideRefused");
  }
}

/** The whole guidance line: what is happening – what to do. */
export function guidance(t: T, state: GuideState): string {
  const what = (() => {
    switch (state.kind) {
      // One key per object: "selected" agrees with the object's own gender
      // („Pietura 2 izvēlēta”, „Ceļa posms izvēlēts”, „Kelio atkarpa pasirinkta”).
      case "selected": return fi(t(SELECTED[state.object]), { name: state.name });
      case "move": return fi(t("guideMoving"), { name: state.name });
      case "via": return t("guideVia");
      case "routing": return t("previewRouting");
      case "proposed": return "";
      case "refused": return state.reason;
    }
  })();
  return joinGuide(what, guideAction(t, state));
}

/**
 * „{what} – {do}”: a sentence's full stop before the dash goes, so a refusal
 * reads „…~629 m nostāk – izvēlies citu vietu.”, not „nostāk. – …”.
 */
export function joinGuide(what: string, action: string): string {
  const head = what.trim().replace(/[.。]+$/u, "");
  return head ? `${head}${GUIDE_DASH}${action}` : action;
}
