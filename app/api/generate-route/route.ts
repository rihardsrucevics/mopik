import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  parseRoutePrompt,
  resolveTargetDistanceKm,
} from "@/lib/ai/parse-route-prompt";
import { geocode, GeocodeResult } from "@/lib/geo/geocode";
import {
  fetchMultiPointRoute,
  fetchRoundTrip,
  GraphHopperPath,
} from "@/lib/routing/graphhopper";
import { buildCustomModel, profileName } from "@/lib/routing/profiles";
import { classifyRoute } from "@/lib/routing/classify";
import { pickTetSlice, TetSlice } from "@/lib/routing/tet";
import {
  GeneratedRoute,
  GenerateRouteResponse,
  RouteIntent,
  RouteIntentSchema,
} from "@/lib/types";

const RequestSchema = z.object({
  start: z.string().min(2),
  destination: z.string().optional(),
  prompt: z.string().default(""),
  // On "Generate another" the client sends the already-parsed intent back
  // so we skip the LLM call; fresh seeds are chosen server-side.
  intent: RouteIntentSchema.optional(),
});

const VARIANT_LABELS = ["A", "B", "C"] as const;

/** point offset perpendicular to the start→end line at fraction t, by `meters` */
function perpendicularVia(
  a: { lat: number; lon: number },
  b: { lat: number; lon: number },
  t: number,
  meters: number
): [number, number] {
  const midLat = a.lat + (b.lat - a.lat) * t;
  const midLon = a.lon + (b.lon - a.lon) * t;
  const latScale = 111320;
  const lonScale = 111320 * Math.cos((midLat * Math.PI) / 180);
  // direction vector a→b in meters
  const dx = (b.lon - a.lon) * lonScale;
  const dy = (b.lat - a.lat) * latScale;
  const len = Math.hypot(dx, dy) || 1;
  // perpendicular unit vector
  const px = -dy / len;
  const py = dx / len;
  return [midLon + (px * meters) / lonScale, midLat + (py * meters) / latScale];
}

type Candidate = {
  variant: string;
  run: () => Promise<{
    path: GraphHopperPath;
    customModelApplied: boolean;
    seed: number;
    tet?: TetSlice;
  }>;
};

function buildCandidates(
  intent: RouteIntent,
  start: GeocodeResult,
  destination: GeocodeResult | null,
  targetKm: number
): Candidate[] {
  const customModel = buildCustomModel(intent);
  const startPt: [number, number] = [start.lon, start.lat];
  const endPt: [number, number] = destination
    ? [destination.lon, destination.lat]
    : startPt;

  if (intent.includeTet) {
    // Free plan allows max 5 route points: start + 3 TET via points + end.
    // The TET winds a lot, so a slice routes shorter than its nominal length;
    // oversize it to land closer to the requested total distance.
    const sliceMeters = targetKm * 1000 * (destination ? 0.6 : 0.65);
    return ([0, 1, 2] as const).flatMap((variant) => {
      const slice = pickTetSlice(start, sliceMeters, variant);
      if (!slice) return [];
      return [
        {
          variant: VARIANT_LABELS[variant],
          run: async () => {
            const res = await fetchMultiPointRoute({
              points: [startPt, ...slice.viaPoints, endPt],
              customModel,
            });
            return { ...res, seed: variant, tet: slice };
          },
        },
      ];
    });
  }

  if (destination) {
    // No alternative_route on the free plan — vary via a perpendicular detour.
    const directKm = Math.hypot(
      (destination.lat - start.lat) * 111,
      (destination.lon - start.lon) * 111 * Math.cos((start.lat * Math.PI) / 180)
    );
    const offset = Math.max(5000, directKm * 1000 * 0.2);
    return [
      {
        variant: "A",
        run: async () => ({
          ...(await fetchMultiPointRoute({ points: [startPt, endPt], customModel })),
          seed: 0,
        }),
      },
      ...([1, -1] as const).map((side, i) => ({
        variant: VARIANT_LABELS[i + 1] as string,
        run: async () => ({
          ...(await fetchMultiPointRoute({
            points: [startPt, perpendicularVia(start, destination, 0.5, side * offset), endPt],
            customModel,
          })),
          seed: side,
        }),
      })),
    ];
  }

  // Round trip: three different random seeds → three different loops.
  return VARIANT_LABELS.map((variant) => ({
    variant,
    run: async () => {
      const res = await fetchRoundTrip({
        start,
        distanceMeters: targetKm * 1000,
        seed: Math.floor(Math.random() * 1_000_000),
        customModel,
      });
      return res;
    },
  }));
}

export async function POST(req: NextRequest) {
  let body;
  try {
    body = RequestSchema.parse(await req.json());
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  try {
    const intent = body.intent ?? (await parseRoutePrompt(body.prompt));
    const start = await geocode(body.start);
    const destination = body.destination?.trim()
      ? await geocode(body.destination.trim())
      : null;

    const targetKm = resolveTargetDistanceKm(intent);
    const candidates = buildCandidates(intent, start, destination, targetKm);
    if (candidates.length === 0) {
      return NextResponse.json(
        { error: "Could not build a route request for this input" },
        { status: 422 }
      );
    }

    const settled = await Promise.allSettled(candidates.map((c) => c.run()));

    const routes: GeneratedRoute[] = [];
    settled.forEach((result, i) => {
      if (result.status !== "fulfilled") {
        console.warn(`candidate ${candidates[i].variant} failed:`, result.reason);
        return;
      }
      const { path, customModelApplied, seed, tet } = result.value;
      const classified = classifyRoute(path);
      const startName = start.label.split(",")[0];
      routes.push({
        id: crypto.randomUUID(),
        name: destination
          ? `${startName} → ${destination.label.split(",")[0]}${tet ? " via TET" : ""}`
          : `${startName} ${tet ? "TET " : ""}${
              intent.difficulty.charAt(0).toUpperCase() + intent.difficulty.slice(1)
            } Loop ${candidates[i].variant}`,
        geometry: path.points,
        segments: classified.segments,
        distanceMeters: Math.round(path.distance),
        durationSeconds: Math.round(path.time / 1000),
        roadMix: classified.roadMix,
        surfaces: classified.surfaces,
        profile: profileName(intent),
        customModelApplied,
        seed,
        sourcePrompt: body.prompt,
        variant: candidates[i].variant,
        tet: tet ? { sectionName: tet.sectionName, sliceKm: tet.sliceKm } : undefined,
      });
    });

    if (routes.length === 0) {
      const firstError =
        settled[0].status === "rejected"
          ? String((settled[0] as PromiseRejectedResult).reason)
          : "unknown";
      return NextResponse.json(
        { error: `All route candidates failed: ${firstError}` },
        { status: 502 }
      );
    }

    const response: GenerateRouteResponse = {
      intent,
      start,
      destination: destination ?? undefined,
      routes,
    };
    return NextResponse.json(response);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Route generation failed";
    console.error("generate-route error:", err);
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
