import type { UiLocale } from "@/lib/i18n/locale";
import { formatEditDelta, type ProposalState, type ProposalView, type ProposedChange } from "@/lib/map/edit-proposal";

/**
 * The page's half of preview-before-commit (docs/DESIGN-route-editing.md B4,
 * Phase 1, P1-B): what the map is handed for the reducer's state, and the
 * small pure decisions `components/home-page.tsx` makes around it.
 */

/** The copy the view is built from — `previewRouting`, `previewDelta`, `previewDeltaTitle`. */
export type ProposalCopy = { routing: string; delta: string; deltaTitle: string };

/** Between the chip and the notes that belong to the same proposal. */
export const NOTE_JOINER = " — ";

/**
 * What the map draws for a proposal (`RouteMap` prop `proposal`), or null
 * when there is none.
 *
 * - routing: „Pārrēķinu…”, no line (the ride stays as it is, dimmed by the map).
 * - refused: the reason, no line; ✓ is disabled by the composer.
 * - proposed: the chip („72,4 → 75,1 km · +6 min · atkārtoti 4 → 1 %”),
 *   the proposed line and where it is new. The proposal's notes („Punkts
 *   pārvietots 40 m…”, a dead end) are said in the same notice — on a phone
 *   the editor is full screen and the notice is the only place words reach
 *   the rider — and they go when the proposal goes, never lingering past it.
 */
export function proposalView(state: ProposalState, copy: ProposalCopy, locale: UiLocale): ProposalView | null {
  if (state.phase === "idle") return null;
  if (state.phase === "routing") return { text: copy.routing, title: copy.routing, tone: "routing", line: null, changed: [] };
  if (state.phase === "refused") return { text: state.reason, title: state.reason, tone: "refused", line: null, changed: [] };
  const { proposal } = state;
  const notes = proposal.notes.filter(Boolean).join(" ");
  const chip = formatEditDelta(copy.delta, proposal.delta, locale);
  const sentence = formatEditDelta(copy.deltaTitle, proposal.delta, locale);
  return {
    text: notes ? `${chip}${NOTE_JOINER}${notes}` : chip,
    title: notes ? `${sentence} ${notes}` : sentence,
    line: proposal.ride.segments,
    changed: proposal.changed,
  };
}

/**
 * Where the spliced line is new, in metres along it: one [from, to] per
 * routed stretch. `runs` are the replaced stretches in metres along the old
 * line (`EditRun.fromMeters/toMeters`), `routedMeters` the drawn length of
 * each routed replacement, index for index — `applyRuns` keeps the old line
 * up to each run and puts the routed stretch in its place, in riding order.
 */
export function changedAlong(runs: { fromMeters: number; toMeters: number }[], routedMeters: number[]): [number, number][] {
  const order = runs.map((r, i) => ({ ...r, i })).sort((a, b) => a.fromMeters - b.fromMeters);
  const out: [number, number][] = [];
  let oldCursor = 0;
  let newCursor = 0;
  for (const run of order) {
    newCursor += Math.max(0, run.fromMeters - oldCursor);
    const length = Math.max(0, routedMeters[run.i] ?? 0);
    out.push([newCursor, newCursor + length]);
    newCursor += length;
    oldCursor = Math.max(oldCursor, run.toMeters);
  }
  return out;
}

/**
 * The identity of a pending change, so ✓ can tell whether what it confirms
 * is the change already routed (commit the landed proposal, route nothing)
 * or a different one (route it, commit when it lands). Two calls describing
 * the same rows or the same point operation give the same key.
 */
export function changeKey(change: ProposedChange): string {
  if (change.kind === "shape") return `shape:${JSON.stringify(change.op)}`;
  const picked = Object.keys(change.rows.picked)
    .map(Number)
    .sort((a, b) => a - b)
    .map((i) => {
      const p = change.rows.picked[i];
      return [i, p ? [p.name, p.lat, p.lon] : null];
    });
  return `rows:${JSON.stringify([change.rows.names, picked])}`;
}

/** A kind switch („Padarīt par pieturu” / „Padarīt caurbraucamu”) changes no line: committed at once, never proposed. */
export function isKindSwitch(change: ProposedChange): boolean {
  return change.kind === "shape" && (change.op.kind === "promote" || change.op.kind === "demote");
}

/**
 * Leading + trailing debounce for pending marks while a pin is dragged: the
 * first change after a quiet spell routes at once, a change within
 * `windowMs` of the previous one waits until the stream has been quiet for
 * `windowMs`. Returns the delay before routing, 0 = now.
 */
export const PROPOSE_DEBOUNCE_MS = 250;
export function proposeDelay(lastAt: number | null, now: number, windowMs = PROPOSE_DEBOUNCE_MS): number {
  return lastAt !== null && now - lastAt < windowMs ? windowMs : 0;
}
