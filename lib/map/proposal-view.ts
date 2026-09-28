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

// ── edit-routing ──
/**
 * Whether two pending changes route the same line: the same points in the
 * same rows, whatever the places are called (rider, 2026-09-28: a dropped pin
 * is routed at once, under its spot, while its name is still being looked
 * up — the name arriving must not route it again). A point operation is its
 * own geometry.
 */
export function sameGeometry(a: ProposedChange, b: ProposedChange): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === "shape" || b.kind === "shape") return changeKey(a) === changeKey(b);
  if (a.rows.names.length !== b.rows.names.length) return false;
  const keys = new Set([...Object.keys(a.rows.picked), ...Object.keys(b.rows.picked)]);
  for (const k of keys) {
    const p = a.rows.picked[Number(k)] ?? null;
    const q = b.rows.picked[Number(k)] ?? null;
    if (!p !== !q) return false;
    if (p && q && (p.lat !== q.lat || p.lon !== q.lon)) return false;
  }
  return true;
}

/** Old name → the place's name and label now, for every row `next` renamed without moving. */
export type Renames = Record<string, { name: string; label: string }>;

export function renamesBetween(prev: ProposedChange, next: ProposedChange, known: Renames = {}): Renames {
  if (prev.kind !== "rows" || next.kind !== "rows") return known;
  const out: Renames = { ...known };
  for (const [k, p] of Object.entries(prev.rows.picked)) {
    const q = next.rows.picked[Number(k)];
    if (!p || !q || p.lat !== q.lat || p.lon !== q.lon || (p.name === q.name && p.label === q.label)) continue;
    // A name renamed twice keeps pointing from the one the routing used.
    const first = Object.keys(out).find((old) => out[old].name === p.name) ?? p.name;
    out[first] = { name: q.name, label: q.label };
  }
  return out;
}

/** The places with the renamed stops' names put in (the routing was done under the old ones). */
export function renamePlaces<T extends { name: string; label: string }>(places: { start: T; vias: T[]; finish: T | null; roundTrip: boolean }, renames: Renames) {
  if (!Object.keys(renames).length) return places;
  const fix = (v: T): T => (renames[v.name] ? { ...v, ...renames[v.name] } : v);
  return { ...places, start: fix(places.start), vias: places.vias.map(fix), finish: places.finish ? fix(places.finish) : null };
}
// ── /edit-routing ──
