import { NextRequest, NextResponse } from "next/server";
import { RidePlanSchema, planToIntent } from "@/lib/chat/ride-plan";
import { buildMotoProfileOptions } from "@/lib/routing/moto-profile";
import { uploadProfile } from "@/lib/routing/brouter";
import { classifyRoute } from "@/lib/routing/classify";
import { edgesFromMessages } from "@/lib/routing/brouter";
import { type Point } from "@/lib/geo/geometry";
import type { RoutePath } from "@/lib/types";
import {
  LOOP_MUST_BEAT_OUT_AND_BACK_BY,
  MAX_DETOUR_POIS,
  cumulative,
  lineMeters,
  pickEntryExit,
  pointAtDistance,
  sliceBetween,
  type DetourRequestPoi,
  type DetourResult,
} from "@/lib/routing/detour";

/**
 * Detours to suggested sights, routed in the background while the rider reads
 * the ride.
 *
 * The rider's decision, in his words: ticking a sight must change the map at
 * once. A full regeneration cannot do that — it is 20-50 s and 36 candidates —
 * and pre-computing every combination of eight suggestions is 256 rides. But a
 * nearby suggestion is 0.2-3 km off a line that is already drawn, so including
 * it is two short legs: leave the route a little before the sight, ride to it,
 * rejoin a little after. Those are cheap, they are routed here as soon as the
 * suggestions load, and ticking one then splices a real routed line into the
 * map in milliseconds.
 *
 * ## Why the client sends the geometry rather than a share code
 *
 * It has the geometry — `GeneratedRoute.geometry` is on screen — and a share
 * code would have to be decoded back into the same coordinates on this side.
 * The polyline for a 200 km ride is a few hundred kilobytes of JSON, which is
 * what `/api/route-pois` already sends for the same reason, and it costs one
 * upload against the two BRouter searches per POI that follow. A code would
 * save the upload and cost a decode plus a resolution loss: share codes round
 * their coordinates, and an entry point 20 m off the drawn line splices as a
 * visible kink.
 *
 * ## Costs, measured on the rider's own server
 *
 * BRouter at `BROUTER_BASE_URL` is one vCPU, so the legs run **sequentially**
 * — overlapping searches on that box measured slower per search, not faster
 * (see `lib/routing/fetch-route-probe.ts`). Eight POIs is sixteen legs of
 * roughly a second each; the deadlines below are what keep a bad one from
 * taking the rest down with it.
 */

export const runtime = "nodejs";

/** A long ride is a few thousand vertices; well clear of that. */
const MAX_POINTS = 60_000;

/**
 * Per leg. Generous against the ~1 s a 3 km search actually takes, and tight
 * enough that a POI the router is struggling with costs one row rather than
 * the request — which is exactly BACKLOG item 20's complaint, seen from the
 * server side.
 */
const LEG_DEADLINE_MS = 4_000;

/**
 * The whole request. Sixteen legs at 4 s each is 64 s if every one of them
 * times out, which is past Vercel's cap; this stops well before it and
 * returns what it has. A partial answer is the right shape here — the rows
 * that came back are tickable, the rest keep their spinner and are asked for
 * again when the rider reopens the card.
 */
const TOTAL_DEADLINE_MS = 25_000;

/**
 * Answers already found, so a warm invocation does not re-route a leg.
 *
 * Keyed by (route, POI, profile). The route's key is its geometry's own
 * fingerprint rather than an id the client could invent: two riders who
 * generate the same ride get the same detours, and a client that renamed its
 * route cannot make this serve a detour computed against a different line.
 * The profile is in the key because a detour is a property of the profile —
 * an asphalt rider and a forest rider reach the same hillfort differently,
 * and one of them may not reach it at all.
 *
 * Bounded, because a module-level Map on a warm Lambda is a memory leak with
 * good manners. Oldest out first; the eviction is crude on purpose — this is
 * a cache for one rider's session, not a store.
 */
const detourCache = new Map<string, DetourResult>();
const CACHE_MAX = 400;

function cacheKey(routeKey: string, profileId: string, poiId: string): string {
  return `${routeKey}|${profileId}|${poiId}`;
}

function remember(key: string, value: DetourResult): void {
  if (detourCache.size >= CACHE_MAX) {
    const oldest = detourCache.keys().next().value;
    if (oldest !== undefined) detourCache.delete(oldest);
  }
  detourCache.set(key, value);
}

/**
 * A stable name for a route's geometry.
 *
 * The endpoints, the vertex count and the total length: enough that two
 * different rides collide only if they have the same length to the metre and
 * the same number of vertices and the same two ends, and cheap enough to
 * compute on a few thousand points. A hash of the whole polyline would be
 * stronger and would cost more than the lookup saves.
 */
function routeFingerprint(line: Point[], totalMeters: number): string {
  const a = line[0];
  const b = line[line.length - 1];
  return `${a[0].toFixed(5)},${a[1].toFixed(5)}|${b[0].toFixed(5)},${b[1].toFixed(5)}|${line.length}|${Math.round(totalMeters)}`;
}

/**
 * One BRouter leg, under its own deadline.
 *
 * Deliberately not `fetchRoutePath`: its rescue machinery — the endpoint
 * nudge ring, the island-drop retry, the long-leg split — exists to save a
 * candidate in a 36-candidate search, and each one is more round trips. Here a
 * leg that fails is one suggestion the rider cannot tick, which the row says
 * in words. Spending 8 x 24 extra requests to rescue a hillfort would cost the
 * whole prefetch its promise of being background work.
 */
async function routeLeg(
  from: Point,
  to: Point,
  profileId: string,
  signal: AbortSignal
): Promise<{ ok: true; path: RoutePath } | { ok: false; reason: "unreachable" | "timeout" | "error" }> {
  const base = process.env.BROUTER_BASE_URL?.trim()
    ? process.env.BROUTER_BASE_URL.trim().replace(/\/$/, "")
    : "https://brouter.de";
  const token = process.env.BROUTER_TOKEN;
  const lonlats = `${from[0]},${from[1]}|${to[0]},${to[1]}`;
  const url =
    `${base}/brouter?lonlats=${encodeURIComponent(lonlats)}` +
    `&profile=${encodeURIComponent(profileId)}&alternativeidx=0&format=geojson`;

  const deadline = AbortSignal.timeout(LEG_DEADLINE_MS);
  const combined = AbortSignal.any([deadline, signal]);

  try {
    const res = await fetch(url, { headers: token ? { "X-Mopik-Token": token } : {}, signal: combined });
    if (!res.ok) {
      const body = (await res.text()).slice(0, 200);
      // "re-tracking track" and "island detected" are both the profile saying
      // it cannot get onto the ground this place sits on — the Satezeles
      // pilskalns case in BACKLOG item 20. That is a fact about this
      // suggestion, not a failure of the request.
      const unreachable = /re-tracking track|island detected|position not mapped/i.test(body);
      const watchdog = res.status === 400 && /watchdog/i.test(body);
      return { ok: false, reason: unreachable ? "unreachable" : watchdog ? "timeout" : "error" };
    }
    const data = (await res.json()) as {
      features?: {
        geometry: { coordinates: [number, number, number?][] };
        properties: { "track-length": string | number; "total-time": string | number; messages?: string[][] };
      }[];
    };
    const feature = data.features?.[0];
    if (!feature) return { ok: false, reason: "unreachable" };
    const coordinates: Point[] = feature.geometry.coordinates.map(([lon, lat]) => [lon, lat]);
    if (coordinates.length < 2) return { ok: false, reason: "unreachable" };
    return {
      ok: true,
      path: {
        distanceMeters: Math.round(Number(feature.properties["track-length"])),
        durationSeconds: Math.round(Number(feature.properties["total-time"])),
        coordinates,
        edges: edgesFromMessages(feature.properties.messages, coordinates),
      },
    };
  } catch (err) {
    const aborted = err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError");
    return { ok: false, reason: aborted ? "timeout" : "error" };
  }
}

/**
 * Nearest point on the route to a place, and how far along the ride it is.
 *
 * The same question `lib/poi/route-pois.ts` answers, and it is recomputed here
 * rather than trusted from the client: every decision below — where to leave
 * the route, where to rejoin, which stretch the delta is measured against —
 * rests on this number, and a client that sent a stale `alongKm` (from the
 * previous version of the card, say) would get a detour spliced into the
 * wrong part of the ride. Coordinates are checked; derived geometry is not.
 *
 * A plain scan rather than route-pois' grid: this runs eight times per
 * request, not two thousand, and a scan over a few thousand vertices is well
 * under a millisecond.
 */
function nearestAlong(poi: Point, line: Point[], cum: number[]): { meters: number; alongMeters: number } {
  let best = { meters: Infinity, alongMeters: 0 };
  for (let i = 0; i < line.length - 1; i++) {
    const a = line[i];
    const b = line[i + 1];
    // Local flat projection, as route-pois does, with the route's own latitude.
    const cosLat = Math.cos((a[1] * Math.PI) / 180) || 1;
    const M = 111_320;
    const ax = a[0] * cosLat * M, ay = a[1] * M;
    const bx = b[0] * cosLat * M, by = b[1] * M;
    const px = poi[0] * cosLat * M, py = poi[1] * M;
    const dx = bx - ax, dy = by - ay;
    const lenSq = dx * dx + dy * dy;
    const t = lenSq > 0 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lenSq)) : 0;
    const meters = Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
    if (meters >= best.meters) continue;
    best = { meters, alongMeters: cum[i] + t * (cum[i + 1] - cum[i]) };
  }
  return best;
}

type Body = {
  geometry?: { coordinates?: unknown };
  plan?: unknown;
  pois?: unknown;
  /**
   * The ride's own riding time, used only to work out what the few hundred
   * metres a detour replaces were worth. Sent rather than recomputed because
   * it is the figure already on the rider's screen: the delta has to be
   * consistent with the headline it will be added to, and re-deriving it here
   * would make "+9 min" disagree with the total by a minute or two.
   */
  durationSeconds?: unknown;
};

export async function POST(req: NextRequest) {
  const startedAt = Date.now();
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "bad body" }, { status: 400 });
  }

  // Trust nothing from the wire — the same rule `/api/route-pois` follows: a
  // malformed vertex reaching the distance maths as a NaN poisons every
  // comparison downstream in silence.
  const raw = body.geometry?.coordinates;
  if (!Array.isArray(raw) || raw.length < 2 || raw.length > MAX_POINTS) {
    return NextResponse.json({ error: "no geometry" }, { status: 400 });
  }
  const line: Point[] = [];
  for (const point of raw) {
    if (!Array.isArray(point) || point.length < 2) continue;
    const lon = Number(point[0]);
    const lat = Number(point[1]);
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) continue;
    if (Math.abs(lon) > 180 || Math.abs(lat) > 90) continue;
    line.push([lon, lat]);
  }
  if (line.length < 2) return NextResponse.json({ error: "no geometry" }, { status: 400 });

  const plan = RidePlanSchema.safeParse(body.plan);
  if (!plan.success) return NextResponse.json({ error: "no plan" }, { status: 400 });

  // A duration from the wire only ever scales a fraction of the ride's own
  // length, so a nonsensical one can distort a delta but cannot reach the
  // routing. Clamped to a day rather than trusted outright.
  const durationRaw = Number(body.durationSeconds);
  const routeDurationSeconds =
    Number.isFinite(durationRaw) && durationRaw > 0 ? Math.min(durationRaw, 86_400) : 0;

  const pois: DetourRequestPoi[] = [];
  for (const entry of Array.isArray(body.pois) ? body.pois : []) {
    if (!entry || typeof entry !== "object") continue;
    const { id, lat, lon } = entry as Record<string, unknown>;
    if (typeof id !== "string" || !id) continue;
    const latN = Number(lat), lonN = Number(lon);
    if (!Number.isFinite(latN) || !Number.isFinite(lonN)) continue;
    if (Math.abs(lonN) > 180 || Math.abs(latN) > 90) continue;
    pois.push({ id, lat: latN, lon: lonN });
    if (pois.length >= MAX_DETOUR_POIS) break;
  }
  if (!pois.length) return NextResponse.json({ detours: [], partial: false });

  // Exactly what generate-route builds, through the same two functions: a
  // detour routed on a different cost profile than the ride would be a
  // different kind of road, which is the one thing a rider would notice
  // immediately.
  let profileId: string;
  try {
    const intent = planToIntent(plan.data);
    profileId = await uploadProfile(buildMotoProfileOptions(intent));
  } catch {
    return NextResponse.json({ error: "profile" }, { status: 422 });
  }

  const cum = cumulative(line);
  const totalMeters = cum[cum.length - 1];
  const routeKey = routeFingerprint(line, totalMeters);

  const detours: DetourResult[] = [];
  let partial = false;

  for (const poi of pois) {
    // The rider navigated away, or the whole request has run long. Either way
    // what is already answered is worth returning.
    if (req.signal.aborted) { partial = true; break; }
    if (Date.now() - startedAt > TOTAL_DEADLINE_MS) { partial = true; break; }

    const key = cacheKey(routeKey, profileId, poi.id);
    const cached = detourCache.get(key);
    if (cached) { detours.push(cached); continue; }

    const target: Point = [poi.lon, poi.lat];
    const nearest = nearestAlong(target, line, cum);

    /**
     * The rider's rule: ride out and back unless a loop is meaningfully
     * cheaper.
     *
     * *"Uz apskates vietu var braukt turp un atpakaļ pa vienu ceļu, ja vien
     * braukt apli ... ir par X % izdevīgāk."* Riding the same 300 m twice to
     * see a waterfall is what a rider does; the no-repeated-roads rule is
     * about the ride, not about a spur to a viewpoint.
     *
     * So the out-and-back is routed first and is always the fallback, and the
     * loop is a second opinion that has to beat it by
     * `LOOP_MUST_BEAT_OUT_AND_BACK_BY`. This is also what makes a sight across
     * a ravine honest: measured on this very ride, Taurētāju kalns is 205 m
     * off the route and the entry → sight → exit shape had to go 15.9 km round
     * by the nearest bridge, because the way back could not rejoin downstream.
     * Out-and-back to the same sight is a few hundred metres each way.
     */
    const spurPoint = pointAtDistance(line, cum, nearest.alongMeters).point;

    // Sequential, per leg: the box is one vCPU and overlapping searches on it
    // measured slower per search than one at a time.
    const outward = await routeLeg(spurPoint, target, profileId, req.signal);
    if (!outward.ok) {
      const failed: DetourResult = { ok: false, poiId: poi.id, reason: outward.reason };
      remember(key, failed);
      detours.push(failed);
      continue;
    }

    /**
     * The out-and-back: the leg forward, then the same leg reversed.
     *
     * The return is the outward line read backwards rather than a second
     * BRouter request. That is not a shortcut — it is what "back the same way"
     * means, and routing sight → route would sometimes come back by a
     * different road and quietly stop being an out-and-back. It also halves
     * what this costs on the rider's one-vCPU server.
     */
    const outCoords = outward.path.coordinates;
    const backCoords = [...outCoords].reverse().slice(1);
    const spurCoords: Point[] = [...outCoords, ...backCoords];
    const spurShift = outCoords.length - 1;
    const spurPath: RoutePath = {
      distanceMeters: outward.path.distanceMeters * 2,
      durationSeconds: outward.path.durationSeconds * 2,
      coordinates: spurCoords,
      edges: [
        ...outward.path.edges,
        // The same edges walked the other way: index i of the reversed line is
        // index (n-1-i) of the forward one, so a forward edge [b, e] becomes
        // [shift + (n-1-e), shift + (n-1-b)].
        ...[...outward.path.edges].reverse().map((edge) => ({
          ...edge,
          beginShapeIndex: spurShift + (outCoords.length - 1 - edge.endShapeIndex),
          endShapeIndex: spurShift + (outCoords.length - 1 - edge.beginShapeIndex),
        })),
      ],
    };
    const spurClassified = classifyRoute(spurPath);
    // Nothing of the ride is replaced: the spur leaves and rejoins at one
    // point, so its whole length is the cost.
    const spurDeltaMeters = spurPath.distanceMeters;
    const spurDeltaSeconds = spurClassified.durationSeconds;

    let best: DetourResult = {
      ok: true,
      poiId: poi.id,
      shape: "outAndBack",
      coordinates: spurCoords,
      segments: spurClassified.segments,
      distanceMeters: spurPath.distanceMeters,
      durationSeconds: spurClassified.durationSeconds,
      deltaMeters: Math.round(spurDeltaMeters),
      deltaSeconds: Math.round(spurDeltaSeconds),
      entryMeters: nearest.alongMeters,
      exitMeters: nearest.alongMeters,
    };

    // The loop alternative, if there is still time for it. Two more legs, and
    // it only ever *improves* on an answer already in hand — so when the
    // request is running long it is skipped rather than allowed to cost the
    // rest of the list its detours.
    const timeForLoop = Date.now() - startedAt < TOTAL_DEADLINE_MS - LEG_DEADLINE_MS * 2;
    if (timeForLoop) {
      const { entry, exit, entryMeters, exitMeters } = pickEntryExit({
        line,
        cum,
        alongMeters: nearest.alongMeters,
      });
      const loopOut = await routeLeg(entry, target, profileId, req.signal);
      const loopBack = loopOut.ok ? await routeLeg(target, exit, profileId, req.signal) : null;

      if (loopOut.ok && loopBack?.ok) {
        // The two legs as one path, so the classifier sees a single line and
        // the segments come out in the shape the map already draws. The
        // joining vertex is shared, so the second leg's first coordinate is
        // dropped and its edge indices shifted by that one place.
        const joinedCoords: Point[] = [...loopOut.path.coordinates, ...loopBack.path.coordinates.slice(1)];
        const shift = loopOut.path.coordinates.length - 1;
        const joined: RoutePath = {
          distanceMeters: loopOut.path.distanceMeters + loopBack.path.distanceMeters,
          durationSeconds: loopOut.path.durationSeconds + loopBack.path.durationSeconds,
          coordinates: joinedCoords,
          edges: [
            ...loopOut.path.edges,
            ...loopBack.path.edges.map((e) => ({
              ...e,
              beginShapeIndex: e.beginShapeIndex + shift,
              endShapeIndex: e.endShapeIndex + shift,
            })),
          ],
        };
        const classified = classifyRoute(joined);

        // What the loop costs *over the stretch it replaces*: riding 4.2 km to
        // a waterfall that was 1.1 km of ride anyway is a 3.1 km detour, and
        // calling it 4.2 would overstate it by the road the rider was using.
        const replacedMeters = lineMeters(sliceBetween(line, cum, entryMeters, exitMeters));
        // The replaced stretch's riding time, at the ride's own average speed.
        // No per-vertex timing exists to do better — `classifyRoute` produces
        // one duration per path — and taking the stretch's share of the ride's
        // own duration keeps "+9 min" consistent with the headline it is added
        // to. Approximate where that stretch is much faster or slower than the
        // ride's average, which is why the totals carry a "≈".
        const replacedSeconds =
          totalMeters > 0 && routeDurationSeconds > 0
            ? (replacedMeters / totalMeters) * routeDurationSeconds
            : 0;
        const loopDeltaMeters = joined.distanceMeters - replacedMeters;

        // The rider's threshold. A loop that merely differs from the
        // out-and-back is not worth riding; one that genuinely saves is.
        if (loopDeltaMeters < spurDeltaMeters * (1 - LOOP_MUST_BEAT_OUT_AND_BACK_BY)) {
          best = {
            ok: true,
            poiId: poi.id,
            shape: "loop",
            coordinates: joinedCoords,
            segments: classified.segments,
            distanceMeters: joined.distanceMeters,
            durationSeconds: classified.durationSeconds,
            deltaMeters: Math.round(loopDeltaMeters),
            deltaSeconds: Math.round(classified.durationSeconds - replacedSeconds),
            entryMeters,
            exitMeters,
          };
        }
      }
    }

    remember(key, best);
    detours.push(best);
  }

  const ms = Date.now() - startedAt;
  return NextResponse.json({ detours, partial, ms });
}
