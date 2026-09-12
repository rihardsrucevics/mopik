import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { generateGpx } from "@/lib/gpx/generate-gpx";

const RequestSchema = z.object({
  name: z.string().min(1).max(120),
  coordinates: z.array(z.tuple([z.number(), z.number()])).min(2),
  description: z.string().max(600).optional(),
});

export async function POST(req: NextRequest) {
  let body;
  try {
    body = RequestSchema.parse(await req.json());
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const gpx = generateGpx(body.name, body.coordinates as [number, number][], body.description);
  const filename = body.name.toLowerCase().replace(/[^a-z0-9]+/g, "-") + ".gpx";

  return new NextResponse(gpx, {
    headers: {
      "Content-Type": "application/gpx+xml",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
