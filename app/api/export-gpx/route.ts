import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { generateGpx } from "@/lib/gpx/generate-gpx";
import { gpxFilename } from "@/lib/gpx/filename";

const RequestSchema = z.object({
  name: z.string().min(1).max(120),
  coordinates: z.array(z.tuple([z.number(), z.number()])).min(2),
  description: z.string().max(600).optional(),
  /** Places in riding order, used to build the filename. */
  places: z.array(z.string()).max(12).optional(),
  km: z.number().optional(),
});

export async function POST(req: NextRequest) {
  let body;
  try {
    body = RequestSchema.parse(await req.json());
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const gpx = generateGpx(body.name, body.coordinates as [number, number][], body.description);
  const filename = gpxFilename({ places: body.places, name: body.name, km: body.km });

  return new NextResponse(gpx, {
    headers: {
      "Content-Type": "application/gpx+xml",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
