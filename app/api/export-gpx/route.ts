import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { generateGpx } from "@/lib/gpx/generate-gpx";
import { gpxFilename } from "@/lib/gpx/filename";
import { MAX_STOPS } from "@/lib/chat/ride-limits";

/**
 * The planned places, as pins the device can draw.
 *
 * Capped at 40 because this is a *plan*, not a track: the longest ride the
 * composer can express is a start, `MAX_STOPS` vias and a finish, plus the sights the
 * rider ticks — 40 leaves room for every one of them and still refuses a
 * payload that is trying to be a second track. Coordinates are range-checked
 * for the same reason the rest of this body is validated: the file goes
 * straight onto a rider's device, and a pin at (0, 0) is a pin in the Gulf of
 * Guinea rather than an error anyone would see.
 */
const WaypointSchema = z.object({
  lat: z.number().min(-90).max(90),
  lon: z.number().min(-180).max(180),
  name: z.string().min(1).max(160),
  desc: z.string().max(200).optional(),
  sym: z.string().max(60).optional(),
  type: z.string().max(40).optional(),
});

const RequestSchema = z.object({
  name: z.string().min(1).max(120),
  coordinates: z.array(z.tuple([z.number(), z.number()])).min(2),
  description: z.string().max(600).optional(),
  /** Places in riding order, used to build the filename. */
  places: z.array(z.string()).max(MAX_STOPS + 2).optional(),
  km: z.number().optional(),
  /** Start, stops and ticked sights, as <wpt>. Absent on an older client. */
  waypoints: z.array(WaypointSchema).max(40).optional(),
});

export async function POST(req: NextRequest) {
  let body;
  try {
    body = RequestSchema.parse(await req.json());
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const gpx = generateGpx(body.name, body.coordinates as [number, number][], body.description, body.waypoints);
  const filename = gpxFilename({ places: body.places, name: body.name, km: body.km });

  return new NextResponse(gpx, {
    headers: {
      "Content-Type": "application/gpx+xml",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
