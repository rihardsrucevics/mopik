import type { UiLocale } from "@/lib/i18n/locale";
import { formatEditDelta, type ProposalState, type ProposalView, type ProposedChange } from "@/lib/map/edit-proposal";
import type { Point } from "@/lib/geo/geometry";
import { cumulative } from "@/lib/routing/detour";
import { nearestAlong } from "@/lib/routing/reroute-leg";

/**
 * The page's half of preview-before-commit (docs/DESIGN-route-editing.md B4,
 * Phase 1, P1-B): what the map is handed for the reducer's state, and the
 * small pure decisions `components/home-page.tsx` makes around it.
 */

/** The copy the view is built from — `previewRouting`, `previewDelta`, `previewDeltaTitle`. */
export type ProposalCopy = { routing: string; delta: string; deltaTitle: string };

/** Between the chip and its notes where both are said as one line of text (the edit panel's). */
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
    // The numbers alone; the notes on a line of their own under them
    // (2026-09-28: run on, the chip wrapped to four lines on a phone).
    text: chip,
    ...(notes ? { notes } : {}),
    title: notes ? `${sentence} ${notes}` : sentence,
    line: proposal.ride.segments,
    changed: proposal.changed,
  };
}

/**
 * When the stretch-by-stretch splice breaks, the page can re-route the whole
 * span between the nearest kept places instead — which may reshape the ride
 * (measured 67 → 35 km). That is the rider's choice, never automatic (rider,
 * 2026-09-28): a wide result that changes the ride by more than
 * `WIDE_ASK_SHARE` of its length or more than `WIDE_ASK_M` is not proposed;
 * the notice says what it would do and „Pārrēķināt posmu” makes it the
 * proposal. A smaller change is proposed as before — its chip shows the
 * delta.
 */
export const WIDE_ASK_SHARE = 0.2;
export const WIDE_ASK_M = 5_000;
export function wideNeedsAsking(beforeMeters: number, afterMeters: number): boolean {
  const change = Math.abs(afterMeters - beforeMeters);
  return change > WIDE_ASK_M || change > WIDE_ASK_SHARE * beforeMeters;
}

/**
 * Stale while it re-routes (rider, 2026-09-28: in a batch the chip and the
 * halo vanished for ~0.7 s while the next stop was named and routed, then
 * came back). While a newer change routes, the last landed proposal stays
 * on the map — its line, its halo, its numbers — with the routing spinner
 * in its chip; the new one replaces it the moment it lands. `landed` is the
 * last view that had landed (no `tone`), or null. A refusal, or no proposal
 * at all (✕, the mark gone), is shown as it is: nothing stale survives it.
 */
export function staleWhileRouting(landed: ProposalView | null, view: ProposalView | null): ProposalView | null {
  if (!view || view.tone !== "routing" || !landed?.line) return view;
  return { ...landed, tone: "routing", title: view.title };
}

/**
 * Where the spliced line is new, in metres along it: one [from, to] per
 * routed stretch. `runs` are the replaced stretches in metres along the old
 * line (`EditRun.fromMeters/toMeters`), `routedMeters` the drawn length of
 * each routed replacement, index for index — `applyRuns` keeps the old line
 * up to each run and puts the routed stretch in its place, in riding order.
 */
export function changedAlong(
  runs: { fromMeters: number; toMeters: number }[],
  routedMeters: number[],
  /** Per run: metres at its start and its end that ride the very road it replaced (`unchangedEnds`). */
  ends?: ({ head: number; tail: number } | undefined)[],
): [number, number][] {
  const order = runs.map((r, i) => ({ ...r, i })).sort((a, b) => a.fromMeters - b.fromMeters);
  const out: [number, number][] = [];
  let oldCursor = 0;
  let newCursor = 0;
  for (const run of order) {
    newCursor += Math.max(0, run.fromMeters - oldCursor);
    const length = Math.max(0, routedMeters[run.i] ?? 0);
    const head = Math.min(length, Math.max(0, ends?.[run.i]?.head ?? 0));
    const tail = Math.min(length - head, Math.max(0, ends?.[run.i]?.tail ?? 0));
    out.push([newCursor + head, newCursor + length - tail]);
    newCursor += length;
    oldCursor = Math.max(oldCursor, run.toMeters);
  }
  return out;
}

/** A routed vertex this close to the road it replaced is that road. */
export const SAME_ROAD_M = 5;

/**
 * How much of a routed stretch, from its start and from its end, rides the
 * very road it replaced, in the same direction — metres along the routed
 * line. An edit re-routes a window of kilometres each way round the point
 * (`EDIT_WINDOW_M`), and the router mostly gives the same road back: halo
 * the whole window and a 0.5 km change is drawn as 6 km of new line (rider,
 * 2026-09-28). The halo marks what is new, so these ends are trimmed off.
 * A stretch that is all old road comes back with `head` its whole length.
 */
export function unchangedEnds(routed: Point[], replaced: Point[], tolerance = SAME_ROAD_M): { head: number; tail: number } {
  if (routed.length < 2 || replaced.length < 2) return { head: 0, tail: 0 };
  const walk = (r: Point[], o: Point[]) => {
    const rc = cumulative(r), oc = cumulative(o);
    let along = 0, i = 0;
    for (; i < r.length; i++) {
      const n = nearestAlong(r[i], o, oc, Math.max(0, along - 1));
      if (n.meters > tolerance) break;
      along = n.alongMeters;
    }
    return i === 0 ? 0 : rc[i - 1];
  };
  const total = cumulative(routed)[routed.length - 1];
  const head = walk(routed, replaced);
  if (head >= total) return { head: total, tail: 0 };
  return { head, tail: walk([...routed].reverse(), [...replaced].reverse()) };
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
