import type { UiLocale } from "@/lib/i18n/locale";
import { formatEditDelta, type ProposalState, type ProposalView, type ProposedChange } from "@/lib/map/edit-proposal";
import type { Point } from "@/lib/geo/geometry";
import { cumulative } from "@/lib/routing/detour";

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
    ...(proposal.accept ? { warn: true as const } : {}),
    line: proposal.ride.segments,
    changed: proposal.changed,
  };
}

/**
 * A bend is a request to take the line to where the finger let go. When the
 * routed line comes no nearer to that point than the ride already was, the
 * router found no road there the ride can pass through — and whatever it
 * re-routed on the way is not the bend, it is noise (rider, 2026-09-28:
 * bending the line „sometimes regenerates the route very atypically and
 * chaotically”).
 *
 * Measured on 59 bends (150-470 m) on four real rides against production
 * BRouter: the worst re-routes were exactly these — Antiņciems 21 %, dropped
 * 453 m off, re-routed 12.4 km of road up to 4.5 km away (+9.1 km) and ended
 * 416 m from the drop, as far as before; Mālpils 21 %: 9.6 km, 3.2 km away,
 * 453 m → 453 m. Of the 22 bends that changed the line, 11 were such — 38.5
 * of the 72 km of new road — and 35 more changed nothing. A bend that
 * brings the line at least `BEND_GAIN_M` (or `BEND_GAIN_SHARE` of the
 * distance) nearer is a bend and is proposed as before. One that is not is
 * no solution (rider's rule 5, `lib/map/edit-reach.ts`): the next, more
 * relaxed profile is tried towards the drop, and only when none gets nearer
 * is it said that no road reaches the point.
 *
 * Only for a point dropped off the line (`BEND_OFF_LINE_M`): one put on the
 * line itself is answered by the composer („Vest caur šejieni”).
 */
export const BEND_OFF_LINE_M = 60;
export const BEND_GAIN_M = 50;
export const BEND_GAIN_SHARE = 0.25;

/** Whether a bend dropped `offBefore` metres from the ride came back `offAfter` metres from it — no nearer. */
export function bendMissed(offBefore: number, offAfter: number): boolean {
  if (offBefore <= BEND_OFF_LINE_M) return false;
  return offBefore - offAfter < Math.max(BEND_GAIN_M, BEND_GAIN_SHARE * offBefore);
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
 * Where the spliced line is new, in metres along it. `runs` are the replaced
 * stretches in metres along the old line (`EditRun.fromMeters/toMeters`),
 * `routedMeters` the drawn length of each routed replacement, index for
 * index — `applyRuns` keeps the old line up to each run and puts the routed
 * stretch in its place, in riding order. `fresh`, per run, is where along
 * its routed stretch the line is new (`newStretches`); without it the whole
 * routed stretch counts as new.
 */
export function changedAlong(
  runs: { fromMeters: number; toMeters: number }[],
  routedMeters: number[],
  fresh?: ([number, number][] | undefined)[],
): [number, number][] {
  const order = runs.map((r, i) => ({ ...r, i })).sort((a, b) => a.fromMeters - b.fromMeters);
  const out: [number, number][] = [];
  let oldCursor = 0;
  let newCursor = 0;
  for (const run of order) {
    newCursor += Math.max(0, run.fromMeters - oldCursor);
    const length = Math.max(0, routedMeters[run.i] ?? 0);
    const parts = fresh?.[run.i] ?? [[0, length]];
    for (const [a, b] of parts) {
      const from = Math.max(0, Math.min(length, a));
      const to = Math.max(0, Math.min(length, b));
      if (to > from) out.push([newCursor + from, newCursor + to]);
    }
    newCursor += length;
    oldCursor = Math.max(oldCursor, run.toMeters);
  }
  return out;
}

/** A routed vertex this close to the road it replaced is that road. */
export const SAME_ROAD_M = 5;
/** Two new pieces this close together are one stretch on the map (a crossing, a shared junction). */
export const NEW_GAP_M = 30;

/**
 * Where along a routed stretch the line is new: the metre ranges of
 * `routed` that lie farther than `tolerance` from every part of `ride`, the
 * whole line before the edit.
 *
 * An edit re-routes a window of kilometres each way round the point
 * (`EDIT_WINDOW_M`), and the router mostly gives the same road back: halo
 * the whole window and a 0.5 km change is drawn as 6 km of new line (rider,
 * 2026-09-28). Trimming only the two ends that follow the replaced road
 * (the first version) still haloed old road in two cases the release check
 * measured on Sigulda → Līgatne → Cēsis: a stop whose way in runs past the
 * cut along the kept ride and back (3,9 km haloed, 1,6 km new), and a
 * stretch that leaves the old road, rejoins it for 1,7 km and leaves it
 * again (a whole loop haloed for a +2 km change). Measured against the whole
 * ride and anywhere along the stretch, the halo is where the map shows a
 * line that was not there — the same road ridden again, either way, is not
 * new line; the chip's „atkārtoti” says that part.
 */
export function newStretches(routed: Point[], ride: Point[], tolerance = SAME_ROAD_M): [number, number][] {
  if (routed.length < 2) return [];
  const rc = cumulative(routed);
  const total = rc[rc.length - 1];
  if (ride.length < 2) return total > 0 ? [[0, total]] : [];
  // Local flat metres round the stretch's own latitude; a grid of cells so
  // each sample is measured against the few ride segments near it.
  const M = 111_320;
  const cosLat = Math.cos((routed[0][1] * Math.PI) / 180) || 1;
  const xy = (p: Point): [number, number] => [p[0] * cosLat * M, p[1] * M];
  const CELL = 100;
  const cells = new Map<string, number[]>();
  const R = ride.map(xy);
  for (let i = 0; i < R.length - 1; i++) {
    const [ax, ay] = R[i], [bx, by] = R[i + 1];
    const x0 = Math.floor((Math.min(ax, bx) - tolerance) / CELL), x1 = Math.floor((Math.max(ax, bx) + tolerance) / CELL);
    const y0 = Math.floor((Math.min(ay, by) - tolerance) / CELL), y1 = Math.floor((Math.max(ay, by) + tolerance) / CELL);
    // A ride segment longer than a few km (a drawn straight, a gap) is left
    // to the scan below rather than filling thousands of cells.
    if ((x1 - x0 + 1) * (y1 - y0 + 1) > 400) { const k = "long"; (cells.get(k) ?? cells.set(k, []).get(k)!).push(i); continue; }
    for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) {
      const k = `${x},${y}`;
      (cells.get(k) ?? cells.set(k, []).get(k)!).push(i);
    }
  }
  const near = (p: [number, number]): boolean => {
    const cand = [...(cells.get(`${Math.floor(p[0] / CELL)},${Math.floor(p[1] / CELL)}`) ?? []), ...(cells.get("long") ?? [])];
    for (const i of cand) {
      const [ax, ay] = R[i], [bx, by] = R[i + 1];
      const dx = bx - ax, dy = by - ay;
      const L2 = dx * dx + dy * dy;
      const t = L2 > 0 ? Math.max(0, Math.min(1, ((p[0] - ax) * dx + (p[1] - ay) * dy) / L2)) : 0;
      if (Math.hypot(p[0] - ax - t * dx, p[1] - ay - t * dy) <= tolerance) return true;
    }
    return false;
  };
  // Each routed segment is new when its midpoint or either end is off the
  // ride — a vertex-only test would miss a new link between two old nodes.
  const P = routed.map(xy);
  const onRide = P.map(near);
  const out: [number, number][] = [];
  for (let i = 0; i < P.length - 1; i++) {
    if (rc[i + 1] - rc[i] <= 0) continue;
    const mid: [number, number] = [(P[i][0] + P[i + 1][0]) / 2, (P[i][1] + P[i + 1][1]) / 2];
    const isNew = !onRide[i] || !onRide[i + 1] || !near(mid);
    if (!isNew) continue;
    const last = out[out.length - 1];
    if (last && rc[i] - last[1] <= NEW_GAP_M) last[1] = rc[i + 1];
    else out.push([rc[i], rc[i + 1]]);
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
