import { NextRequest, NextResponse } from "next/server";
import { searchPlaces } from "@/lib/chat/photon";

/**
 * Place suggestions for the ride form.
 *
 * Why a picker at all: free-text geocoding of "Valmiera" or "Baldone" has to
 * guess between the city, a hamlet of the same name and a Belarusian village
 * with a similar one. Letting the rider pick from a short, labelled list —
 * settlements only, Baltic countries only — removes the guess, and the
 * coordinates travel with the plan so the API never geocodes the name again.
 * The lookup itself lives in `lib/chat/photon.ts`, shared with the chat.
 */
export async function GET(req: NextRequest) {
  const q = (req.nextUrl.searchParams.get("q") ?? "").trim();
  if (q.length < 2) return NextResponse.json({ places: [] });
  return NextResponse.json({ places: await searchPlaces(q) });
}
