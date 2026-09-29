import { fi } from "@/lib/i18n/format";
import type { MessageKey } from "@/lib/i18n/messages";
import { blockOptions, fixesFor, type BlockFixes, type BlockOption, type Blocking, type BlockingPoint } from "@/lib/map/blocking";

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

export type SheetAction = "move" | "demote" | "promote" | "remove" | "via" | "passHere" | "exclude" | "back" | "allow";

/** A row's detail line: what pressing it will do, for this object. */
export function actionDetail(t: T, action: SheetAction, object: EditObject): string {
  switch (action) {
    case "move": return t("detailMove");
    case "demote": return t("detailDemote");
    case "promote": return t("detailPromote");
    case "remove": return t(object === "pass" ? "detailRemovePass" : "detailRemoveStop");
    case "via": return t("detailVia");
    case "passHere": return t("detailPassHere");
    case "exclude": return t("detailExclude");
    case "back": return t("detailBack");
    case "allow": return t("detailAllow");
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
  // `warned`: the proposal waits for „Tomēr braukt” (outside the profile, a
  // dead end, a big detour) — its notes say what, this says what to do, once.
  | { kind: "proposed"; warned?: boolean }
  // `wide`: „Pārrēķināt posmu” is on offer; `straight`: „Vest pa taisno” is.
  // `remove`: the refused edit took a point out — choosing another place is no answer.
  // `stretch`: an exclusion or „Atpakaļ pa citu ceļu” that found no way round — the ride stays.
  | { kind: "refused"; reason: string; wide?: boolean; straight?: boolean; remove?: boolean; stretch?: boolean; retry?: boolean }
  // Backlog 36: a stretch of the line selected (its ends can be dragged), and while an end is dragged.
  | { kind: "stretch"; name: string }
  | { kind: "stretchEnds" }
  // Release B item 4: `count` edits chained, waiting for one ✓.
  | { kind: "chain"; count: number };

/** Just the "what to do" part of a state — what the chip adds after its own words. */
export function guideAction(t: T, state: GuideState): string {
  switch (state.kind) {
    case "selected": return t("guideChoose");
    case "move": return t("guideTapNew");
    case "via": return t("guideTapVia");
    case "routing": return t("guideRouting");
    case "proposed": return t(state.warned ? "guideWarned" : "guideProposed");
    case "refused": return t(state.retry ? "guideRefusedRetry" : state.stretch ? "guideRefusedStretch" : state.straight ? "guideRefusedStraight" : state.wide ? "guideRefusedWide" : state.remove ? "guideRefusedRemove" : "guideRefused");
    case "stretch": return t("guideStretchChoose");
    case "stretchEnds": return "";
    case "chain": return fi(t("chainGuide"), { n: state.count });
  }
}

/**
 * What to do for each phase of a proposal, as the chip needs it
 * (`ProposalCopy.guide` in lib/map/proposal-view.ts): one tail per state, so
 * a warned proposal with several notes (a dead end and a profile note) says
 * „Tomēr braukt” once, after its numbers — never once per note.
 */
export function proposalGuide(t: T): { routing: string; proposed: string; warned: string; refused: string; refusedWide: string; refusedStraight: string; refusedRemove: string; refusedStretch: string; refusedRetry: string } {
  return {
    routing: guideAction(t, { kind: "routing" }),
    proposed: guideAction(t, { kind: "proposed" }),
    warned: guideAction(t, { kind: "proposed", warned: true }),
    refused: guideAction(t, { kind: "refused", reason: "" }),
    refusedWide: guideAction(t, { kind: "refused", reason: "", wide: true }),
    refusedStraight: guideAction(t, { kind: "refused", reason: "", straight: true }),
    refusedRemove: guideAction(t, { kind: "refused", reason: "", remove: true }),
    refusedStretch: guideAction(t, { kind: "refused", reason: "", stretch: true }),
    refusedRetry: guideAction(t, { kind: "refused", reason: "", retry: true }),
  };
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
      case "chain": return "";
      case "stretch": return fi(t("guideSelectedLine"), { name: state.name });
      case "stretchEnds": return t("guideStretchEnds");
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

// ── release-b: blocking ──
// Which point stops a proposal (release B item 1, lib/map/blocking.ts): the
// guidance line names it and says what to do, in the same two parts.

/** „Pietura 4 „Rīgas iela”” — the name only when it says more than the title. */
export function pointLabel(p: Pick<BlockingPoint, "title" | "name">): string {
  const name = placeWords(p.name);
  if (!name || name === p.title) return p.title;
  return `${p.title} „${name}”`;
}

/** A coordinate pair, as a name that is none („56.4819, 25.7056”, „56,48 25,70”). */
const COORDS_RE = /-?\d{1,3}[.,]\d{2,}\s*[,;]?\s+-?\d{1,3}[.,]\d{2,}/gu;

/**
 * A place's name without any coordinates in it (backlog 52: „Ceplīši ·
 * 56.4819, 25.7056” in the note): the words left, or "" when only numbers
 * were there — the caller then says the point's own title („Pietura 4”).
 */
export function placeWords(name: string): string {
  return name.replace(COORDS_RE, "").replace(/(\s*[·,;–-]\s*)+$/u, "").replace(/^(\s*[·,;–-]\s*)+/u, "").replace(/\s{2,}/gu, " ").trim();
}

/** „tuvākais ceļš ~N m nostāk” — why this point stops it. */
export function causeWords(t: T, p: Pick<BlockingPoint, "cause" | "meters">, format: (n: number) => string): string {
  switch (p.cause) {
    case "far": return fi(t("blockFar"), { m: format(p.meters ?? 0) });
    case "profile": return t("blockProfile");
    case "detour": return fi(t("blockDetour"), { km: format(Math.round((p.meters ?? 0) / 100) / 10) });
    case "failed": return t("blockFailed");
  }
}

/** „pārvieto, izņem vai „Vest pa taisno”” — what he can do, as a list. */
export function fixWords(t: T, fixes: BlockFixes): string {
  const words: Record<BlockOption, MessageKey> = { move: "blockActMove", tap: "blockActTap", remove: "blockActRemove", straight: "blockActStraight", override: "blockActOverride", rest: "blockActRest" };
  const parts = blockOptions(fixes).map((o) => t(words[o]));
  const last = parts.pop()!;
  return `${parts.join(", ")} ${t("blockOr")} ${last}.`;
}

/**
 * The guidance line for a blocked proposal, in the two parts every state
 * has (lib/map/edit-guidance.ts): what is happening – what to do.
 * „Pietura 4 „Rīgas iela” – tuvākais ceļš ~120 m nostāk – pārvieto, izņem
 * vai „Vest pa taisno”.” Never the generic „neizdevās” without a point and
 * a fix: while probing it says it is looking, and when every point is fine
 * alone it says so and what to do.
 */
export function blockedGuide(t: T, blocking: Blocking, warned: boolean, format: (n: number) => string): { what: string; action: string } {
  if (blocking.probing) return { what: t("blockProbing"), action: t("blockProbingAct") };
  if (!blocking.points.length) return { what: fi(t("blockTogether"), { n: format(blocking.total) }), action: t("blockTogetherAct") };
  const what = blocking.points.map((p) => joinGuide(pointLabel(p), causeWords(t, p, format))).join("; ");
  return { what, action: fixWords(t, fixesFor(blocking, warned)) };
}

/** The whole line, joined. */
export function blockedLine(t: T, blocking: Blocking, warned: boolean, format: (n: number) => string): string {
  const g = blockedGuide(t, blocking, warned, format);
  return joinGuide(g.what, g.action);
}

// ── sights-add ──
// A sight added from the map's card (backlog 46): what happened – what to
// do, in the same two parts. Never a silent "nothing happened".

/** Latvian-style count classes: 1, 21, 31… take the singular (not 11). */
function one(n: number): boolean {
  return n % 10 === 1 && n % 100 !== 11;
}

/** The map bar's count of ticked sights not yet in the ride: „2 atzīmētas”. */
export function tickedCount(t: T, n: number): string {
  return fi(t(one(n) ? "sightTickedOne" : "sightTickedMany"), { n });
}

/** Its whole line, for the title and a screen reader: „2 atzīmētas – vēl nav braucienā – „Pievienot” tās ieliek.” */
export function tickedGuide(t: T, n: number): string {
  return joinGuide(tickedCount(t, n), t("sightTickedGuide"));
}

/**
 * The ride could not come (much) closer to the sight: „Vatrāne – tuvākais
 * ceļš ~100 m no apskates vietas; tuvāk ar motociklu netikt – pietura paliek
 * pie ceļa, tālāk kājām.” Null when the ride reaches it.
 */
export function sightReachLine(t: T, name: string, reach: { kind: "notCloser" | "short"; meters: number } | null, format: (n: number) => string): string | null {
  if (!reach) return null;
  const what = fi(t(reach.kind === "notCloser" ? "sightNotCloser" : "sightShort"), { name, m: format(reach.meters) });
  return joinGuide(what, t("sightReachAct"));
}

/** Added on a plain result: „Vatrāne pievienota braucienam, +0,4 km – ar „Labot” to var pārvietot vai izņemt.” */
export function sightAddedLine(t: T, name: string, km: string): string {
  return joinGuide(fi(t("sightAdded"), { name, km }), t("sightAddedAct"));
}

/** Could not be added: the reason – what to do. */
export function sightRefusedLine(t: T, name: string, reason: string): string {
  return joinGuide(joinGuide(name, reason.replace(/^\s*[A-ZĀ-Ž]/u, (c) => c.toLowerCase())), t("sightRefusedAct"));
}
// ── /sights-add ──

// ── straight-chain ──
// Several points in a row off any road (rider, 2026-09-29): one offer for
// all of them, in the same two parts — „3 punkti bez ceļa, taisni ~1,4 km
// pāri mežam vai ūdenim – „Vest pa taisno caur visiem” vai pārvieto katru.”

/** What is happening and what to do, for a run of `n` points off any road, `meters` straight in all. */
export function chainGuide(t: T, n: number, meters: number, format: (n: number) => string, riskM = 1_000): { what: string; action: string } {
  const km = format(Math.round(meters / 100) / 10);
  const what = fi(t("chainWhat"), { n, km }) + (meters > riskM ? ` ${t("chainRisk")}` : "");
  return { what, action: t("chainAct") };
}

/** Its whole line, joined. */
export function chainLine(t: T, n: number, meters: number, format: (n: number) => string, riskM?: number): string {
  const g = chainGuide(t, n, meters, format, riskM);
  return joinGuide(g.what, g.action);
}

/**
 * ── chain-polish ── The chain's proposal in the two lines a phone has room
 * for (rider, 2026-09-29: the one long note was cut after three lines, and
 * named a point by its coordinates): `lead` — what and how much, before
 * „– ✓ apstiprina, ✕ atmet.” („Taisni caur 3 punktiem – 1,5 km bez ceļa”);
 * `detail` — the way, by the numbers the map's pins wear („No ceļa gala līdz
 * pieturai 4, tad 4 → 5 → 6, pēc tam atpakaļ uz maršrutu.”). A point with no
 * number (a pass-through point) numbers the chain 1, 2, 3 instead. Never a
 * coordinate, never a name that may be one.
 */
export function chainProposalLines(t: T, c: { count: number; meters: number; numbers: (number | null)[]; sameEnd?: boolean; risk?: boolean }, format: (n: number) => string): { lead: string; detail: string } {
  const km = format(Math.round(c.meters / 100) / 10);
  const lead = fi(t(c.count === 1 ? "chainHeadOne" : "chainHead"), { n: c.count, km }) + (c.risk ? `, ${t("chainRisk")}` : "");
  const stops = c.numbers.length === c.count && c.numbers.every((n) => n !== null);
  const nums = stops ? (c.numbers as number[]) : Array.from({ length: c.count }, (_, i) => i + 1);
  const a = fi(t(stops ? "chainToStop" : "chainToPoint"), { n: nums[0] });
  // A long chain: the first two and the last.
  const path = (nums.length > 5 ? [nums[0], nums[1], "…", nums[nums.length - 1]] : nums).join(" → ");
  const way = c.count === 1 ? fi(t("chainDetailOne"), { a }) : fi(t("chainDetail"), { a, path });
  return { lead, detail: c.sameEnd ? `${way} ${t("chainSameEnd")}` : way };
}
// ── /straight-chain ──

// ── add-kind ──
// „+” asks what to add (rider, 2026-09-29), in the same two parts: „Ko
// pievienot? – izvēlies veidu, tad pieskaries kartei.”, then, armed, what he
// is adding – what to do.

/** The chooser: its guidance line and its two chips, each with a detail line. */
export function addChooserCopy(t: T): { guide: string; options: { key: "stop" | "pass"; label: string; detail: string }[] } {
  return {
    guide: joinGuide(t("addChooseWhat"), t("addChooseAct")),
    options: [
      { key: "stop", label: t("addStopLabel"), detail: t("addStopDetail") },
      { key: "pass", label: t("addPassLabel"), detail: t("addPassDetail") },
    ],
  };
}

/** Armed, before the first tap: „Pievieno caurbraucamu punktu – pieskaries kartei vietā, caur kuru braukt.” */
export function addArmedGuide(t: T, kind: "stop" | "pass"): string {
  return kind === "pass" ? joinGuide(t("addArmedPassWhat"), t("addArmedPassAct")) : joinGuide(t("addArmedStopWhat"), t("addArmedStopAct"));
}

/** Why the sheet's kind switch is off, in words (null: it is on). */
export function kindSwitchReason(t: T, reason: "end" | "shapeCap" | "stopCap" | "busy" | null, caps: { shapeCap: string; stopCap: string }): string | null {
  switch (reason) {
    case null: return null;
    case "end": return t("kindSwitchEnds");
    case "shapeCap": return caps.shapeCap;
    case "stopCap": return caps.stopCap;
    case "busy": return t("resEditRouting");
  }
}
// ── /add-kind ──
