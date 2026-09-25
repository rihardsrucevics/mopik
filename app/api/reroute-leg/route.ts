import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { RidePlanSchema, planToIntent } from "@/lib/chat/ride-plan";
import { MAX_SHAPE_POINTS, MAX_STOPS } from "@/lib/chat/ride-limits";
import { buildMotoProfileOptions } from "@/lib/routing/moto-profile";
import { fetchRouteAvoiding, fetchRoutePath } from "@/lib/routing/brouter";
import { JOIN_GAP_M, LOOP_SHARED_MIN_M, chooseLoop, nogosAlong, sharedRoad, type LegPair } from "@/lib/routing/reroute-leg";
import { haversineMeters } from "@/lib/geo/geometry";
import type { MotoProfileOptions } from "@/lib/routing/moto-profile";
import { classifyRoute } from "@/lib/routing/classify";
import type { Point } from "@/lib/geo/geometry";
import type { RoutePath } from "@/lib/types";

/**
 * The stretches of a ride an edit re-routes, on the ride's own profile.
 *
 * Riders asked to correct a generated ride on the map and see the new line at
 * once, not after another minute of searching. A correction — a place moved,
 * added or taken out — invalidates the legs around that place and nothing
 * else. The client works out which stretches of the drawn line that means
 * (`planEdit` in `lib/routing/reroute-leg.ts`) and sends their points here;
 * this routes each one and hands back classified lines for `applyRuns` to put
 * in place. A couple of short legs is one to three seconds on our own BRouter;
 * a search is 30-60.
 *
 * Several runs in one request because a round trip's start is also its
 * finish: moving it changes the first leg and the last, which are not
 * neighbours on the line. They are routed in parallel, and the edit is all or
 * nothing — half a moved start would draw a ride that begins in one place and
 * ends in another.
 *
 * ## Why `fetchRoutePath` here, where `/api/detour` deliberately avoids it
 *
 * `/api/detour` routes eight suggestions in the background and a leg that
 * fails costs one row a checkbox, so its rescue machinery would be 24 extra
 * requests spent on a hillfort nobody asked for. Here the rider has just put a
 * pin down and is watching the map: the point he chose is very likely to be a
 * field, a yard or a footway, and the endpoint-nudge ring is the difference
 * between "your correction is on the map" and "Mopik cannot route there".
 *
 * ## What it does not do
 *
 * It does not re-rank, re-score or search. The ride that comes back is the
 * rider's own edit, and the panel says so — "Labots ar roku", with the
 * retraced share recomputed over the whole edited line, and "Meklēt labāku
 * apli" offered beside it.
 */

export const runtime = "nodejs";

/**
 * Two short legs at a second or three each, plus the profile upload. Well
 * inside Vercel's cap, and deliberately far below `/api/generate-route`'s 60:
 * a correction that takes half a minute has failed at its one job, and the
 * rider is better served by an honest "could not route there" than by a
 * spinner that might still be spinning.
 */
export const maxDuration = 20;

/**
 * How long a correction may take before it is given up on.
 *
 * Measured, and this is why it exists. A point the profile cannot reach at all
 * — a pin dropped in the Gulf of Riga — took **21 s** to fail: `fetchRoutePath`
 * spends that on its endpoint-nudge ring, 3 radii x 8 bearings, which is
 * exactly the machinery that rescues a stop dropped on a footway and is worth
 * every request when it works. It is not worth 21 s of a rider watching a
 * spinner to be told no, and it also overran this route's own `maxDuration`.
 *
 * 8 s is past the 0.2-3 s a real correction takes (measured: 0.21 s and 0.26 s
 * warm on a 25 km leg, 5.4 s cold including the profile upload) with room for
 * a nudge or two, and well inside the platform cap. Past it the rider is told
 * the point cannot be ridden to and keeps the ride he had — which is the
 * honest answer, and a much better one than a timeout page.
 *
 * The routing itself is not cancellable — `fetchRoutePath` takes no signal —
 * so this races it rather than aborting it. The work it abandons is one leg on
 * our own router, which is the cheaper of the two bad options.
 */
const EDIT_DEADLINE_MS = 8_000;

/**
 * The correction, validated on arrival.
 *
 * Coordinates are checked rather than trusted, the way `/api/route-pois` and
 * `/api/detour` check theirs: a malformed vertex reaching the distance maths
 * as a NaN poisons every comparison downstream in silence. `zod` here because
 * the body is small and structured — unlike the detour endpoint's polyline,
 * which is validated by hand precisely because it is tens of thousands of
 * numbers and a schema over it would cost more than the routing.
 */
const CoordSchema = z.object({
  lat: z.number().min(-90).max(90),
  lon: z.number().min(-180).max(180),
});

const BodySchema = z.object({
  plan: RidePlanSchema,
  /**
   * Each stretch to route, as its points in riding order.
   *
   * The first and last point of a run are where it joins the kept ride — on
   * the old line itself, so the splice has no gap — or the rider's own place
   * where the run reaches a moved end; any points between are his places. All
   * of them come from the client because it knows them exactly; nothing
   * derived travels, and the derived part (which stretch to cut) is computed
   * on the client from the same geometry it draws.
   */
  // One run per stretch a batch of added stops touches, all in this one
  // request (2026-09-25) — at most one per stop. A run holds its two joins
  // and every place between them: the whole-span fallback (`spanRun`) can
  // carry every stop and every shaping point of the ride.
  runs: z.array(z.array(CoordSchema).min(2).max(MAX_STOPS + MAX_SHAPE_POINTS + 2)).min(1).max(MAX_STOPS + 2),
  /**
   * Which runs go through a stop that should be ridden through, not out to
   * and back — `join → stop → join` for a stop added or moved. Those are
   * routed as two halves and, when the halves share the road, again with the
   * shared road fenced off (`routeThroughStop`).
   */
  loops: z.array(z.boolean()).max(MAX_STOPS + 2).optional(),
});

/**
 * How long the fenced second attempts may take. They start only once the
 * halves are back (0.1-0.3 s warm), run in parallel, and answered in 0.1-0.2 s
 * on the rider's ride; a refusal comes back as fast. Past this the plain
 * route stays — a loop found late is not worth a correction that feels slow.
 */
const LOOP_BUDGET_MS = 2_500;

/**
 * When the loop search must have answered, counted from the request's start
 * rather than from the halves: Confirm → line has to stay well under 5 s, and
 * a stop far off the line spends most of that on the halves alone (measured:
 * a stop ~80 km off Sigulda → Cēsis, 3.7 s for the two halves, 4-5 s more for
 * each fenced leg). What is left of this after the halves is what the fences
 * get, never more than `LOOP_BUDGET_MS`.
 */
const LOOP_DEADLINE_MS = 4_500;

/** Two routed halves as one path, the second's edges shifted onto the joined shape. */
function joinPaths(a: RoutePath, b: RoutePath): RoutePath {
  const offset = a.coordinates.length - 1;
  return {
    distanceMeters: a.distanceMeters + b.distanceMeters,
    durationSeconds: a.durationSeconds + b.durationSeconds,
    coordinates: [...a.coordinates, ...b.coordinates.slice(1)],
    ...(a.elevations && b.elevations ? { elevations: [...a.elevations, ...b.elevations.slice(1)] } : {}),
    edges: [
      ...a.edges,
      ...b.edges.map((e) => ({ ...e, beginShapeIndex: e.beginShapeIndex + offset, endShapeIndex: e.endShapeIndex + offset })),
    ],
  };
}

const asPair = (approach: RoutePath, departure: RoutePath): LegPair => ({
  approach: { coordinates: approach.coordinates, distanceMeters: approach.distanceMeters },
  departure: { coordinates: departure.coordinates, distanceMeters: departure.distanceMeters },
});

/**
 * A stretch through a stop, routed so it does not ride out and back the same
 * way when another way exists.
 *
 * Measured on the rider's Rīga → Vasara 46 → Annužas 1: asked in one request,
 * the router took the same 6.03 km of road to the stop and back — 9 % of the
 * ride retraced. Routed as two halves the overlap is plain to see; fencing the
 * shared road off the approach found a way in that is 4.8 km *shorter*, and
 * the ride went to 3 % (`scripts/measure-edit-loop.ts`). Both mirrors are
 * tried at once — the departure fenced off the approach's road and the
 * approach fenced off the departure's — because which side has the other way
 * out is a fact about the map, not about the order. `chooseLoop` keeps the
 * one that rides least of the same road twice within its length bound, and
 * the plain route when neither helps: then the stop really is at the end of
 * a single road, and the page says so rather than hiding it.
 *
 * **Unless the search did not finish.** A fenced leg that ran out of time, or
 * a request the server would not take, has not said anything about the map,
 * and "the stop is on a dead end" would then be a guess. Measured on a stop
 * ~80 km off the line: 326 fences made a URL nginx refused with 414, which
 * read as "no other way", and the page told the rider his stop was at the end
 * of a 95 km dead end. So an out-and-back kept because an attempt went
 * unanswered is reported as that (`deadEndUnchecked`), not as a dead end.
 */
async function routeThroughStop(
  points: Point[],
  profileOptions: MotoProfileOptions,
  deadlineAt: number,
): Promise<{ path: RoutePath; deadEndMeters: number; deadEndUnchecked?: boolean }> {
  const [from, stop, to] = points;
  // The joins are cuts in the kept ride and never move; the stop may be
  // nudged onto a road like any place the rider named.
  const [approach, departure] = await Promise.all([
    fetchRoutePath({ points: [from, stop], profileOptions, generatedViaIndices: [], pinnedEnds: { start: true } }),
    fetchRoutePath({ points: [stop, to], profileOptions, generatedViaIndices: [], pinnedEnds: { end: true } }),
  ]);
  // Two halves that reach the stop at different points (each nudged its own
  // way) would join with a jump in the middle of the stretch: ride it as one
  // request instead, through the stop.
  if (haversineMeters(approach.coordinates[approach.coordinates.length - 1], departure.coordinates[0]) > JOIN_GAP_M) {
    const whole = await fetchRoutePath({ points, profileOptions, generatedViaIndices: [], pinnedEnds: true });
    return { path: whole, deadEndMeters: 0 };
  }
  const shared = sharedRoad(approach.coordinates, departure.coordinates);
  if (shared.meters <= LOOP_SHARED_MIN_M) return { path: joinPaths(approach, departure), deadEndMeters: 0 };

  // Kept clear of the stop and both joins, so a genuine dead end refuses the
  // fenced request instead of being routed around the stop itself; spaced
  // wider on a long shared stretch so the request stays one a server takes
  // (`MAX_NOGOS`).
  const nogos = nogosAlong(shared.points, [stop, from, to]);
  const budget = Math.min(LOOP_BUDGET_MS, deadlineAt - Date.now());
  type Attempt = { path: RoutePath } | { refused: true } | { unanswered: true };
  const attempt = (pts: Point[]): Promise<Attempt> => {
    if (budget < 300) return Promise.resolve({ unanswered: true });
    const request = fetchRouteAvoiding({ points: pts, profileOptions, nogos }).then(
      (path): Attempt => ({ path }),
      // A 400 is the router's own answer about these points — no way there
      // with the fences up. Anything else (a refused URL, a network error, a
      // 5xx) is not an answer about the map.
      (err): Attempt => (/routing failed \(400\)|no route|empty shape/i.test(err instanceof Error ? err.message : "") ? { refused: true } : { unanswered: true }),
    );
    return Promise.race([request, new Promise<Attempt>((resolve) => { setTimeout(() => resolve({ unanswered: true }), budget).unref?.(); })]);
  };
  const attempts = await Promise.all([attempt([stop, to]), attempt([from, stop])]);
  const [fencedDeparture, fencedApproach] = attempts.map((a) => ("path" in a ? a.path : null));
  // A fenced half that does not meet the other at the stop, or its own join,
  // is not a way through — it would splice a gap into the ride.
  const meets = (a: RoutePath, d: RoutePath) =>
    haversineMeters(a.coordinates[a.coordinates.length - 1], d.coordinates[0]) <= JOIN_GAP_M &&
    haversineMeters(a.coordinates[0], from) <= JOIN_GAP_M * 2 &&
    haversineMeters(d.coordinates[d.coordinates.length - 1], to) <= JOIN_GAP_M * 2;
  const variants: [RoutePath, RoutePath][] = [];
  if (fencedDeparture && meets(approach, fencedDeparture)) variants.push([approach, fencedDeparture]);
  if (fencedApproach && meets(fencedApproach, departure)) variants.push([fencedApproach, departure]);
  const choice = chooseLoop(asPair(approach, departure), variants.map(([a, d]) => asPair(a, d)));
  const [a, d] = choice.index < 0 ? [approach, departure] : variants[choice.index];
  const deadEndMeters = choice.sharedMeters > LOOP_SHARED_MIN_M ? Math.round(choice.sharedMeters) : 0;
  const unchecked = deadEndMeters > 0 && attempts.some((x) => "unanswered" in x);
  return { path: joinPaths(a, d), deadEndMeters, ...(unchecked ? { deadEndUnchecked: true } : {}) };
}

export async function POST(req: NextRequest) {
  const startedAt = Date.now();
  const parsed = BodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "bad body" }, { status: 400 });
  }
  const { plan, runs, loops } = parsed.data;

  let paths: { path: RoutePath; deadEndMeters: number; deadEndUnchecked?: boolean }[];
  try {
    // The ride's own profile, built through the same two functions
    // `/api/generate-route` and `/api/detour` use. A correction routed on a
    // different cost profile would be a different kind of road spliced into
    // the middle of the ride — the one thing a rider notices immediately.
    const intent = planToIntent(plan);
    const profileOptions = buildMotoProfileOptions(intent);
    const routing = Promise.all(runs.map((run, i) => {
      const points = run.map((c): Point => [c.lon, c.lat]);
      if (loops?.[i] && points.length === 3) return routeThroughStop(points, profileOptions, startedAt + LOOP_DEADLINE_MS);
      return fetchRoutePath({
        points,
        profileOptions,
        // Every point is either the rider's own place or a point on the line
        // the router already agreed to. None is a guess at a nice shape, so
        // all of them earn the full endpoint rescue.
        generatedViaIndices: [],
        // The run's ends are cuts in the kept ride; they must not move.
        pinnedEnds: true,
      }).then((path) => ({ path, deadEndMeters: 0 }));
    }));
    // The abandoned search would otherwise reject into an unhandled promise
    // when its own rescue finally gives up, which on Node is a process-level
    // warning. Attaching a sink is not swallowing an error: whatever it
    // answers, nobody is waiting for it any more.
    routing.catch(() => {});
    // Raced rather than aborted; see `EDIT_DEADLINE_MS`. The rejection is
    // caught below and answered as an unreachable point, which is what a
    // correction that takes this long has turned out to be every time.
    paths = await Promise.race([
      routing,
      new Promise<never>((_, reject) => {
        const timer = setTimeout(() => reject(new Error("edit deadline")), EDIT_DEADLINE_MS);
        // Never hold the process open for a deadline nobody is waiting on.
        timer.unref?.();
      }),
    ]);
  } catch (err) {
    // A correction that cannot be routed is a fact about the point the rider
    // chose, not a server error: the page keeps the ride it had and says so.
    // 422 rather than 500 for exactly that reason.
    const message = err instanceof Error ? err.message : "";
    const unreachable = /re-tracking track|island detected|position not mapped|target island|edit deadline/i.test(message);
    return NextResponse.json(
      { error: unreachable ? "unreachable" : "failed", ms: Date.now() - startedAt },
      { status: 422 },
    );
  }

  if (paths.some((p) => p.path.coordinates.length < 2)) {
    return NextResponse.json({ error: "unreachable", ms: Date.now() - startedAt }, { status: 422 });
  }

  return NextResponse.json({
    runs: paths.map(({ path, deadEndMeters, deadEndUnchecked }) => {
      // The same classifier the ride's own segments came from, so the spliced
      // stretch carries surfaces, road classes, gates and unverified-access
      // flags in exactly the shape the map already draws and the panel counts.
      const classified = classifyRoute(path);
      return {
        segments: classified.segments,
        distanceMeters: path.distanceMeters,
        // The surface-aware speed model's answer, not BRouter's flat ~45 km/h
        // — the figure the rest of the app shows.
        durationSeconds: classified.durationSeconds,
        // No "how far the endpoint moved" here: BRouter reaches a pin in a
        // field silently, from the nearest track, without moving anything it
        // reports. The client measures the gap between each place and the
        // line it gets back (`snapToLine`), which catches both cases.
        //
        // How much road the stretch still rides out and back on, when no loop
        // through the stop was found within the bound — said to the rider.
        deadEndMeters,
        // …and whether that is a finding or only what was left when the loop
        // search ran out of time: then the page says the way back is the way
        // in, without calling the stop a dead end it has not proved.
        ...(deadEndUnchecked ? { deadEndUnchecked } : {}),
      };
    }),
    ms: Date.now() - startedAt,
  });
}
