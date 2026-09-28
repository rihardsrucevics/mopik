import type { MotoProfileOptions } from "@/lib/routing/moto-profile";

/**
 * The profiles an edit may try, in order, when the rider's own reaches no
 * road through the point he asked for (rider, 2026-09-28: „ja kaut kāds ceļš
 * tur ved, piedāvā risinājumu” — offer a solution whenever any road reaches
 * the point, warn about what is outside the profile, and let him accept).
 *
 * The least relaxed that reaches the point wins:
 *
 * 1. **His profile without its avoidances** — big roads and motorways,
 *    sand, towns allowed; the hardest difficulty; paths without a positive
 *    motor access tag allowed (never a way whose access is explicitly
 *    forbidden: the moto profile does not relax that on any setting). Only
 *    when it differs from his profile at all.
 * 2. **BRouter's stock `car-fast`** — every road a car may drive. Answers in
 *    seconds where a flattened moto profile does not answer at all
 *    (`DIRECT_OFFER_PROFILE`, measured 2026-09-19).
 *
 * Stock `trekking` is deliberately NOT a rung: it is a bicycle profile and
 * routes cycleways and footways closed to motor vehicles — the one thing
 * the rider's standing rule forbids („do not route through ways explicitly
 * tagged as legally restricted”).
 */
export type Relaxed = {
  /** 1-based rung, as `/api/reroute-leg` takes it (`relax`). */
  level: number;
  options: MotoProfileOptions;
  /** What of the rider's profile this rung drops, for the warning's words. */
  drops: RelaxDrop[];
};

export type RelaxDrop = "mainRoads" | "motorways" | "sand" | "towns" | "rough" | "access" | "car";

export function relaxedProfiles(own: MotoProfileOptions): Relaxed[] {
  const open: MotoProfileOptions = {
    ...own,
    avoidMainRoads: false,
    avoidMotorways: false,
    noSand: false,
    avoidTowns: false,
    difficulty: "hard",
    accessPolicy: "allow_unverified",
  };
  const drops: RelaxDrop[] = [];
  if (own.avoidMainRoads) drops.push("mainRoads");
  if (own.avoidMotorways) drops.push("motorways");
  if (own.noSand) drops.push("sand");
  if (own.avoidTowns) drops.push("towns");
  if (own.difficulty !== "hard") drops.push("rough");
  if (own.accessPolicy !== "allow_unverified") drops.push("access");
  const out: Relaxed[] = [];
  if (drops.length) out.push({ level: out.length + 1, options: open, drops });
  out.push({ level: out.length + 1, options: { ...own, stock: "car-fast" }, drops: ["car"] });
  return out;
}

/** The profile for rung `level` (0 = the rider's own), or null past the last rung. */
export function profileAt(own: MotoProfileOptions, level: number): Relaxed | { level: 0; options: MotoProfileOptions; drops: [] } | null {
  if (level <= 0) return { level: 0, options: own, drops: [] };
  return relaxedProfiles(own)[level - 1] ?? null;
}
