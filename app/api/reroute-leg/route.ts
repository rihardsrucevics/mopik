import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { RidePlanSchema, planToIntent } from "@/lib/chat/ride-plan";
import { buildMotoProfileOptions } from "@/lib/routing/moto-profile";
import { fetchRoutePath } from "@/lib/routing/brouter";
import { classifyRoute } from "@/lib/routing/classify";
import type { Point } from "@/lib/geo/geometry";
import type { RoutePath } from "@/lib/types";

/**
 * One corrected leg pair, routed on the ride's own profile.
 *
 * The rider's ask, in his words: *"I want to make corrections to the offered
 * route through the map and quickly see the new route on the map, not wait for
 * a full re-generation again."*
 *
 * A correction — dragging a stop, or tapping the line to add one — changes
 * **two legs** of the ride and nothing else. The stretch from the place before
 * to the place after is replaced; everything outside it is the line the router
 * already agreed to and stays exactly as it is. So this handler routes
 * `previous → edited → next` and hands back one classified line for
 * `spliceLeg` to put in place of the old stretch. Two short legs is one to
 * three seconds on our own BRouter; a search is 20-30.
 *
 * ## Why `fetchRoutePath` here, where `/api/detour` deliberately avoids it
 *
 * `/api/detour` routes eight suggestions in the background and a leg that
 * fails costs one row a checkbox, so its rescue machinery would be 24 extra
 * requests spent on a hillfort nobody asked for. Here the rider has just
 * dragged a pin with his finger and is watching the map: the point he chose is
 * very likely to be a field, a yard or a footway, and the endpoint-nudge ring
 * is the difference between "your correction is on the map" and "Mopik cannot
 * route there". That is what it exists for, and this is one request, not eight.
 *
 * ## What it does not do
 *
 * It does not re-rank, re-score or search. The ride that comes back is the
 * rider's own edit, and the panel says so — "labots ar roku", with the
 * retraced share recomputed over the whole edited line, and "Meklēt labāku
 * apli" offered beside it. Mopik never silently passes an edited ride off as
 * one it planned, and never silently replaces an edit with a ride it likes
 * better. Both directions of that rule are the rider's.
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
   * The three points of the correction, in riding order.
   *
   * `from` and `to` are the ride's own anchors either side of the edit — the
   * previous place and the next one — and `through` is where the rider put the
   * pin. All three come from the client because all three are things it knows
   * exactly: the anchors are the coordinates the API itself routed
   * (`result.start` / `result.via` / `result.destination`), and the pin is the
   * gesture. Nothing derived travels; the derived part (which stretch to cut)
   * is recomputed on the client from the same geometry it draws.
   */
  from: CoordSchema,
  through: CoordSchema,
  to: CoordSchema,
});

export async function POST(req: NextRequest) {
  const startedAt = Date.now();
  const parsed = BodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "bad body" }, { status: 400 });
  }
  const { plan, from, through, to } = parsed.data;

  const points: Point[] = [
    [from.lon, from.lat],
    [through.lon, through.lat],
    [to.lon, to.lat],
  ];

  let path: RoutePath;
  try {
    // The ride's own profile, built through the same two functions
    // `/api/generate-route` and `/api/detour` use. A correction routed on a
    // different cost profile would be a different kind of road spliced into
    // the middle of the ride — the one thing a rider notices immediately.
    const intent = planToIntent(plan);
    const routing = fetchRoutePath({
      points,
      profileOptions: buildMotoProfileOptions(intent),
      // Every one of the three is the rider's: two are places his ride already
      // has, and the third is where he just put his finger. None is a guess at
      // a nice shape, so all three earn the full endpoint rescue.
      generatedViaIndices: [],
    });
    // The abandoned search would otherwise reject into an unhandled promise
    // when its own rescue finally gives up, which on Node is a process-level
    // warning (and, with `--unhandled-rejections=strict`, worse). Attaching a
    // sink here is not swallowing an error: whatever it answers, nobody is
    // waiting for it any more.
    routing.catch(() => {});
    // Raced rather than aborted; see `EDIT_DEADLINE_MS`. The rejection is
    // caught below and answered as an unreachable point, which is what a
    // correction that takes this long has turned out to be every time.
    path = await Promise.race([
      routing,
      new Promise<never>((_, reject) => {
        const timer = setTimeout(() => reject(new Error("edit deadline")), EDIT_DEADLINE_MS);
        // Never hold the process open for a deadline nobody is waiting on.
        timer.unref?.();
      }),
    ]);
  } catch (err) {
    // A correction that cannot be routed is a fact about the point the rider
    // chose, not a server error: the panel puts the previous line back and
    // says so. 422 rather than 500 for exactly that reason — this is the
    // request being refused, not failing.
    const message = err instanceof Error ? err.message : "";
    const unreachable = /re-tracking track|island detected|position not mapped|target island/i.test(message);
    return NextResponse.json(
      { error: unreachable ? "unreachable" : "failed", ms: Date.now() - startedAt },
      { status: 422 },
    );
  }

  if (path.coordinates.length < 2) {
    return NextResponse.json({ error: "unreachable", ms: Date.now() - startedAt }, { status: 422 });
  }

  // The same classifier the ride's own segments came from, so the spliced
  // stretch carries surfaces, road classes, gates and unverified-access flags
  // in exactly the shape the map already draws and the panel already counts.
  const classified = classifyRoute(path);

  return NextResponse.json({
    coordinates: path.coordinates,
    segments: classified.segments,
    distanceMeters: path.distanceMeters,
    // The surface-aware speed model's answer, not BRouter's flat ~45 km/h —
    // the figure the rest of the app shows.
    durationSeconds: classified.durationSeconds,
    /**
     * How far the router had to move an endpoint to route at all.
     *
     * Reported rather than swallowed: the rider dropped a pin in a field, and
     * the ride now goes to the nearest routable ground instead. That is a
     * substitution, and CLAUDE.md's rule is that it is never silent — the
     * client moves the marker to where the ride actually goes, so what he sees
     * is what he gets.
     */
    endpointMovedMeters: path.endpointMovedMeters ?? 0,
    ms: Date.now() - startedAt,
  });
}
