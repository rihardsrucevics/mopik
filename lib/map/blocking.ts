
/**
 * Which point stops a proposal (release B item 1, rider 2026-09-28,
 * images/25–27, 31: „Šeit neizdevās izbraukt — maršruts palika
 * iepriekšējais.” under a batch of seven points, and nothing said which).
 *
 * When a proposal with several new or moved points is refused, or lands
 * warned, the page probes each point on its own — the pre-search
 * reachability probe (`/api/routable-point`: is a road within reach?), then
 * the edit's own routing with only that point (does his profile reach it,
 * and at what detour?) — and names the ones that cause it. The guidance
 * line says which and what to do; the pins are ringed on the map; the rest
 * of a batch can still land („Pievienot pārējās”).
 *
 * Pure: the probing is the page's; the verdicts are here, the words in
 * lib/map/edit-guidance.ts (`blockedGuide`), as every edit state's are.
 */

/** Why a point stops the proposal. */
export type BlockCause =
  /** No road within reach of it at all: `meters` to the nearest one. */
  | "far"
  /** Only roads outside the rider's profile reach it (his own profile answered no road). */
  | "profile"
  /** It reaches, and lengthens the ride a lot: `meters` added. */
  | "detour"
  /** It could not be joined to the ride (the router failed, the line broke). */
  | "failed";

export type BlockingPoint = {
  lat: number;
  lon: number;
  /** „Pietura 4”, „Caurbraucams punkts”, „Finišs” — as the sheet names it. */
  title: string;
  /** The place's own name („Rīgas iela”), or "" when it has none worth saying. */
  name: string;
  cause: BlockCause;
  meters?: number;
};

/**
 * What the page knows about a proposal's points (`RideEdit.blocking`):
 * `probing` while the points are being probed; `points` the ones that stop
 * it (empty when each is fine on its own and only together they fail —
 * `together`); `total` how many new or moved points the proposal had.
 */
export type Blocking = {
  token: number;
  probing: boolean;
  points: BlockingPoint[];
  total: number;
  /** The proposal was refused (not only warned). */
  refused: boolean;
  /** „Vest pa taisno” is on offer for it whatever the cause (a new finish or start the router could not join). */
  straight?: boolean;
  /** Points of a batch the rider already chose „Vest pa taisno” for, waiting for the others (backlog 52). */
  picked?: { lat: number; lon: number }[];
  /** „Vest pa taisno visiem” is on offer (the chain chip): several points off the road, not all in a row. */
  straightAll?: boolean;
};

/** One point's probe, as the page measured it. */
export type PointProbe = {
  /** `/api/routable-point`: too far from any road the profile may ride, and how far. */
  tooFar?: number | null;
  /** The edit routed with only this point: 422 on his profile (no road), another failure, or a line. */
  routed?: "no-road" | "failed" | "ok";
  /** …and, when it routed, the metres it adds when that is a detour worth his say-so (`detourRisk`). */
  detourPlus?: number | null;
  /** …and the metres it adds at all, worth his say-so or not. */
  plusMeters?: number;
};

/**
 * The points a probed proposal is stopped by. A refused one: every point
 * with a verdict (none: they fail only together). A warned one: those with
 * a verdict — or, when each alone is within the bound and only together the
 * detour warns, the one that adds the most, named as the detour it adds.
 */
export function blockingFrom<P>(points: P[], probes: PointProbe[], warnedBy?: "profile" | "detour" | "deadEnd"): (P & { cause: BlockCause; meters?: number })[] {
  const found = points.flatMap((q, i) => { const v = blockCause(probes[i] ?? {}); return v ? [{ ...q, ...v }] : []; });
  if (found.length || warnedBy !== "detour") return found;
  let best = -1;
  probes.forEach((p, i) => { if ((p.plusMeters ?? 0) > 0 && (best < 0 || (p.plusMeters ?? 0) > (probes[best].plusMeters ?? 0))) best = i; });
  return best < 0 ? [] : [{ ...points[best], cause: "detour", meters: Math.round(probes[best].plusMeters!) }];
}

/** The verdict for one point, or null when it is fine on its own. */
export function blockCause(probe: PointProbe): { cause: BlockCause; meters?: number } | null {
  if (probe.tooFar != null) return { cause: "far", meters: Math.round(probe.tooFar) };
  if (probe.routed === "no-road") return { cause: "profile" };
  if (probe.routed === "failed") return { cause: "failed" };
  if (probe.detourPlus != null) return { cause: "detour", meters: Math.round(probe.detourPlus) };
  return null;
}

/**
 * Where a refusal a page already has the reason for points, for a proposal
 * with ONE new or moved point — no probing needed, it is that point.
 */
export function singleCause(reason: string, meters: number | null, accept?: "profile" | "detour" | "deadEnd", plus?: number | null): { cause: BlockCause; meters?: number } {
  if (accept === "profile") return { cause: "profile" };
  if (accept === "detour" && plus != null) return { cause: "detour", meters: Math.round(plus) };
  if ((reason === "no-road" || reason === "too-far") && meters != null) return { cause: "far", meters: Math.round(meters) };
  return { cause: "failed" };
}

/** What the fixes are, in the order the chips offer them. `single`: one pending point, not a batch — a tap elsewhere moves it (no „Pārvietot” chip). */
export type BlockFixes = { straight: boolean; override: boolean; rest: number; single?: boolean; straightAll?: boolean };

/** One fix, as the words name it and a chip offers it. „tap” is the gesture of a single pending point: said, no chip. */
export type BlockOption = "move" | "tap" | "remove" | "straight" | "straightAll" | "override" | "rest";

/**
 * The fixes a blocked state offers, in order — the ONE list both the
 * guidance words (`fixWords`) and the composer's chips are built from, so
 * the words never name an option that has no chip (rider, 2026-09-30,
 * images/45: „…vai „Vest pa taisno”” over a lone „Izņemt”).
 */
export function blockOptions(fixes: BlockFixes): BlockOption[] {
  return [
    fixes.single ? "tap" as const : "move" as const,
    "remove" as const,
    ...(fixes.straight ? ["straight" as const] : []),
    ...(fixes.straightAll ? ["straightAll" as const] : []),
    ...(fixes.override ? ["override" as const] : []),
    ...(fixes.rest > 0 ? ["rest" as const] : []),
  ];
}

/** Which fixes a blocked point gets: „Vest pa taisno” when no road reaches it, „Tomēr braukt” for its profile or detour. */
export function pointFixes(p: Pick<BlockingPoint, "cause">, blocking: Pick<Blocking, "straight">): { straight: boolean } {
  return { straight: p.cause === "far" || Boolean(blocking.straight) };
}

export function fixesFor(blocking: Pick<Blocking, "points" | "total" | "straight" | "straightAll">, warned: boolean): BlockFixes {
  const causes = new Set(blocking.points.map((p) => p.cause));
  return {
    // Every point off the road gets it, one or several (backlog 52).
    straight: Boolean(blocking.straight) || causes.has("far"),
    override: warned && (causes.has("profile") || causes.has("detour")),
    rest: Math.max(0, blocking.total - blocking.points.length),
    ...(blocking.total === 1 ? { single: true } : {}),
    ...(blocking.straightAll ? { straightAll: true } : {}),
  };
}

