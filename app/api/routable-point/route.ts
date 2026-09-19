import { NextResponse } from "next/server";
import { z } from "zod";
import { RidePlanSchema, planToIntent } from "@/lib/chat/ride-plan";
import { buildMotoProfileOptions } from "@/lib/routing/moto-profile";
import { probeSnapPoint } from "@/lib/routing/brouter";
import { canOfferMove, checkRoutablePoint, MOVE_OFFER_MAX_M } from "@/lib/routing/routable-point";
import type { Point } from "@/lib/geo/geometry";

/**
 * "Can I actually ride to the spot you just tapped?" — asked at Confirm time,
 * before a ride is ever searched.
 *
 * The case this answers, measured 2026-09-19: a pin on Pilskalni 2, a
 * farmstead reachable only by `access=private` service roads, produced
 * "Neizdevās atrast maršrutu…" after 15 s of searching, with nothing naming
 * the place. BRouter never refused it — it answered 200 and quietly ended the
 * route 471 m short, which the 300 m stop check then rejected on every
 * candidate. Asking here costs one short request and turns a dead end into a
 * choice the rider can make while the map is still open.
 *
 * The profile matters and is not optional: "routable" is a property of the
 * profile, not of the ground. The same farmstead track may be open to an
 * Adventure ride and shut to a stricter one, so the plan travels with the
 * question.
 *
 * Called from `components/ride-composer.tsx` → `confirmPick`.
 */
export const maxDuration = 10;

const RequestSchema = z.object({
  lat: z.number().min(-90).max(90),
  lon: z.number().min(-180).max(180),
  plan: RidePlanSchema,
  /**
   * A place already in the ride, to probe from. Optional: with no other place
   * yet, `checkRoutablePoint` makes its own short leg beside the pin.
   */
  from: z.object({ lat: z.number(), lon: z.number() }).optional(),
});

export async function POST(req: Request) {
  let body;
  try {
    body = RequestSchema.parse(await req.json());
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const point: Point = [body.lon, body.lat];
  const profileOptions = buildMotoProfileOptions(planToIntent(body.plan));

  const result = await checkRoutablePoint({
    point,
    from: body.from ? [body.from.lon, body.from.lat] : undefined,
    // The check is a promise to the rider that Confirm will not hang: one
    // request, its own deadline, and an unanswered probe reports
    // "probe-failed" rather than blocking the pick. A pin we could not check
    // is still allowed through — the generation remains the backstop.
    probe: (leg) => probeSnapPoint({ from: leg[0], to: leg[1], profileOptions, timeoutMs: 2_000 }),
  });

  return NextResponse.json({
    ...result,
    // Whether the pick flow may offer "move it to the nearest road", decided
    // here so the client and the refusal wording cannot drift apart.
    canMove: canOfferMove(result),
    moveLimitM: MOVE_OFFER_MAX_M,
  });
}
