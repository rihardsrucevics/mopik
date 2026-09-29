import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { RidePlanSchema, planToIntent } from "@/lib/chat/ride-plan";
import { MAX_SHAPE_POINTS, MAX_STOPS } from "@/lib/chat/ride-limits";
import { buildMotoProfileOptions } from "@/lib/routing/moto-profile";
import { profileAt } from "@/lib/routing/relax";
import { fetchRoutePath, withNogos } from "@/lib/routing/brouter";
import { avoidPoints, fenceNogos } from "@/lib/routing/stretch";
import { routeThroughPlaces, type ThroughResult } from "@/lib/routing/through-stops";
import { classifyRoute } from "@/lib/routing/classify";
import type { Point } from "@/lib/geo/geometry";

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
   * Which runs go through places that should be ridden through, not out to
   * and back — every stretch an added or moved place is in. Those are routed
   * leg by leg and, where a place's way in and way out share road, again
   * with that road fenced off (`routeThroughPlaces`).
   */
  loops: z.array(z.boolean()).max(MAX_STOPS + 2).optional(),
  /**
   * Per run, per point: a shaping point. A spur to one is cut — the line goes
   * through the spur's base — where a stop's is kept and reported.
   */
  shapes: z.array(z.array(z.boolean()).max(MAX_STOPS + MAX_SHAPE_POINTS + 2)).max(MAX_STOPS + 2).optional(),
  /**
   * Route on a relaxed profile, rung `relax` of `relaxedProfiles`
   * (`lib/routing/relax.ts`) — asked for only after the ride's own profile
   * reached no road through the edit's point, and shown to the rider as
   * outside his profile before anything is kept. Absent or 0: his profile.
   */
  relax: z.number().int().min(0).max(4).optional(),
  /**
   * Leave a shaping point on its spur (`routeThroughPlaces` `keepShapeSpurs`):
   * asked for when taking it off left the bend nowhere near the drop.
   */
  keepSpurs: z.boolean().optional(),
  /**
   * Per run: a stretch it must not ride (design D1/D3/D4, backlog 36) — the
   * stretch being excluded, or the first pass of a stretch ridden twice —
   * fenced with no-go circles for that run only. With the plan's own `avoid`
   * (fenced on every run) a refusal is `no-way-round`.
   */
  fences: z.array(z.array(CoordSchema).max(400).nullable()).max(MAX_STOPS + 2).optional(),
});

/**
 * When the loop search must have answered, counted from the request's start
 * rather than from the legs: Confirm → line has to stay well under 5 s, and
 * a stop far off the line spends most of that on the legs alone (measured:
 * a stop ~80 km off Sigulda → Cēsis, 3.7 s for the two halves, 4-5 s more for
 * each fenced leg). What is left of this after the legs is what the fences
 * get, never more than `LOOP_BUDGET_MS` (`lib/routing/through-stops.ts`).
 *
 * Measured on the rider's Rīga → Vasara 46 → Annužas 1: asked in one request,
 * the router took the same 6.03 km of road to the stop and back — 9 % of the
 * ride retraced; routed as two halves with the shared road fenced off the
 * approach, the way in was 4.8 km *shorter* and the ride went to 3 %
 * (`scripts/measure-edit-loop.ts`). Since 2026-09-25 that is done for every
 * place of every stretch, not only for a stretch with one stop in it
 * (`routeThroughPlaces`).
 *
 * **Unless the search did not finish.** A fenced leg that ran out of time, or
 * a request the server would not take, has not said anything about the map,
 * and "the stop is on a dead end" would then be a guess. Measured on a stop
 * ~80 km off the line: 326 fences made a URL nginx refused with 414, which
 * read as "no other way", and the page told the rider his stop was at the end
 * of a 95 km dead end. So an out-and-back kept because an attempt went
 * unanswered is reported as that (`deadEndUnchecked`), not as a dead end.
 */
const LOOP_DEADLINE_MS = 4_500;

export async function POST(req: NextRequest) {
  const startedAt = Date.now();
  const parsed = BodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "bad body" }, { status: 400 });
  }
  const { plan, runs, loops, shapes, relax, keepSpurs, fences } = parsed.data;
  // The circles each run must keep out of: the ride's excluded stretches and
  // the run's own fence, clear of the run's own points (its cuts and places).
  const nogosFor = (points: Point[], i: number) => {
    const fence = fences?.[i]?.map((c): Point => [c.lon, c.lat]);
    const lines = [...(plan.avoid ?? []).map(avoidPoints), ...(fence && fence.length >= 2 ? [fence] : [])];
    return lines.flatMap((l) => fenceNogos(l, points, { maxCount: Math.floor(80 / Math.max(1, lines.length)) })).slice(0, 80);
  };
  let fenced = false;

  let paths: ThroughResult[];
  try {
    // The ride's own profile, built through the same two functions
    // `/api/generate-route` and `/api/detour` use. A correction routed on a
    // different cost profile would be a different kind of road spliced into
    // the middle of the ride — the one thing a rider notices immediately.
    const intent = planToIntent(plan);
    const rung = profileAt(buildMotoProfileOptions(intent), relax ?? 0);
    if (!rung) return NextResponse.json({ error: "no-such-profile" }, { status: 400 });
    const profileOptions = rung.options;
    const routing = Promise.all(runs.map((run, i) => {
      const points = run.map((c): Point => [c.lon, c.lat]);
      const nogos = nogosFor(points, i);
      if (nogos.length) fenced = true;
      return withNogos(nogos, () => routeRun(points, i));
    }));
    function routeRun(points: Point[], i: number): Promise<ThroughResult> {
      if (loops?.[i] && points.length >= 3) {
        return routeThroughPlaces({ points, shapes: shapes?.[i], profileOptions, deadlineAt: startedAt + LOOP_DEADLINE_MS, keepShapeSpurs: keepSpurs });
      }
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
    }
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
    // Fenced and refused: no way round what the ride must not ride.
    return NextResponse.json(
      // Out of time is said as that (rider, 2026-09-30: a removal refused „ne ar
      // vienu profilu” where roads were plain): the page tries the next rung
      // and, if every one ran out, says „Pārrēķins aizņēma pārāk ilgi”.
      { error: /edit deadline/i.test(message) ? "timeout" : fenced ? "no-way-round" : unreachable ? "unreachable" : "failed", ms: Date.now() - startedAt },
      { status: 422 },
    );
  }

  if (paths.some((p) => p.path.coordinates.length < 2)) {
    return NextResponse.json({ error: "unreachable", ms: Date.now() - startedAt }, { status: 422 });
  }

  return NextResponse.json({
    runs: paths.map(({ path, deadEndMeters, deadEndUnchecked, deadEndAtShape, deadEndProved }) => {
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
        // …and whether the place at the end of it is a shaping point (a bend
        // that could not be taken off its spur) or a stop — the page names
        // the right one, whatever kind of edit made it.
        ...(deadEndAtShape ? { deadEndAtShape } : {}),
        // …and whether the router proved it — no way on with the spur fenced
        // off. Only a proved one is called a dead end.
        ...(deadEndProved ? { deadEndProved } : {}),
      };
    }),
    ms: Date.now() - startedAt,
  });
}
