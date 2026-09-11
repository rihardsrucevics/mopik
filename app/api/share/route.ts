import { NextResponse } from "next/server";
import { z } from "zod";
import { decodeRouteShare } from "@/lib/share/route-code";
import { saveShare } from "@/lib/share/store";

/** Turn a full share code into a short id. Only valid codes are stored. */
const Schema = z.object({ code: z.string().min(10).max(20000) });

export async function POST(req: Request) {
  const parsed = Schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success || !decodeRouteShare(parsed.data.code)) return NextResponse.json({ error: "Nederīgs maršruta kods." }, { status: 400 });
  const id = await saveShare(parsed.data.code);
  if (!id) return NextResponse.json({ error: "Īsās saites glabātuve nav pieejama." }, { status: 503 });
  return NextResponse.json({ id, path: `/r/${id}` });
}
