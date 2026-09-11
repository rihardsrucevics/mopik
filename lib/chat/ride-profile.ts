import { RidePlanSchema, type RidePlan } from "@/lib/chat/ride-plan";

/**
 * The rider's profile: the three choices that, for most adventure riders,
 * are the same on every ride — how rough, why, and where. They are kept apart
 * from what changes every time (places, duration, ride type) so the form can
 * ask only for the latter and show the profile as one line.
 *
 * The three axes are genuinely different things in the engine:
 *  - difficulty → how rough a track may be (grade 4–5, smoothness, sand, fords)
 *  - style      → why: sights as anchors, direct vs exploring, nature weight
 *  - surface    → where: gravel share, trails, access policy, forest preference
 * Only one combination is meaningless: technical riding on asphalt only, so
 * asphalt forces the easy difficulty (see `normalizeProfile`).
 */

export type ProfileDifficulty = "rest" | "adventure" | "hard";
export type ProfileStyle = "tourism" | "riding";
export type ProfileSurface = "asphalt" | "gravel" | "forest";

export type RideProfile = {
  difficulty: ProfileDifficulty;
  style: ProfileStyle;
  surface: ProfileSurface;
};

/** What ~90% of adventure/enduro riders want: medium-rough, sport, forest. */
export const DEFAULT_PROFILE: RideProfile = { difficulty: "adventure", style: "riding", surface: "forest" };

/**
 * Visible names, kept in one place so they can be renamed without touching
 * logic. Values (the keys) are the contract with `compose-plan` and the chat.
 */
export const PROFILE_LABELS = {
  difficulty: {
    title: "Grūtība",
    rest: { label: "Viegli", detail: "bez svīšanas" },
    adventure: { label: "Vidēji", detail: "ar smērēšanos" },
    hard: { label: "Grūti", detail: "galīgi rukši" },
  },
  style: {
    title: "Stils",
    tourism: { label: "Tūrisms", detail: "iekļaut apskates vietas" },
    riding: { label: "Sports", detail: "gāzēt nonstop" },
  },
  surface: {
    title: "Segums",
    asphalt: { label: "Tikai asfalts", detail: undefined as string | undefined },
    gravel: { label: "Der arī grants", detail: undefined as string | undefined },
    forest: { label: "Meži", detail: undefined as string | undefined },
  },
} as const;

export type ProfilePreset = { id: string; label: string; profile: RideProfile };

/** Ready-made combinations; a custom mix is any other combination. */
export const PROFILE_PRESETS: ProfilePreset[] = [
  { id: "adventure", label: "Adventure", profile: DEFAULT_PROFILE },
  { id: "calm", label: "Mierīgs izbrauciens", profile: { difficulty: "rest", style: "tourism", surface: "gravel" } },
  { id: "asphalt", label: "Asfalta tūre", profile: { difficulty: "rest", style: "tourism", surface: "asphalt" } },
];

/** Asphalt-only rides have no technical sections to choose between. */
export function normalizeProfile(profile: RideProfile): RideProfile {
  return profile.surface === "asphalt" ? { ...profile, difficulty: "rest" } : profile;
}

export function profileSummary(profile: RideProfile): string {
  const p = normalizeProfile(profile);
  const parts = [
    p.surface === "asphalt" ? null : PROFILE_LABELS.difficulty[p.difficulty].label,
    PROFILE_LABELS.style[p.style].label,
    PROFILE_LABELS.surface[p.surface].label,
  ];
  return parts.filter(Boolean).join(" · ");
}

export function presetIdFor(profile: RideProfile): string | null {
  const p = normalizeProfile(profile);
  return (
    PROFILE_PRESETS.find(
      (preset) =>
        preset.profile.difficulty === p.difficulty &&
        preset.profile.style === p.style &&
        preset.profile.surface === p.surface
    )?.id ?? null
  );
}

/**
 * The plan fields a profile decides. The mapping is the same one the chat's
 * quick-reply commands apply, so a form choice and a typed "Segums: Meži"
 * mean exactly the same thing.
 */
export function profileToPlanFields(profile: RideProfile): Pick<
  RidePlan,
  | "difficulty"
  | "rideStyle"
  | "includeSightseeing"
  | "gravelPreference"
  | "trailPreference"
  | "accessPolicy"
  | "preferForest"
  | "avoidMainRoads"
> {
  const p = normalizeProfile(profile);
  return {
    difficulty: p.difficulty === "rest" ? "easy" : p.difficulty === "hard" ? "hard" : "adventure",
    rideStyle: p.style === "tourism" ? "direct" : "explore",
    includeSightseeing: p.style !== "riding",
    gravelPreference: p.surface === "asphalt" ? 0 : p.surface === "gravel" ? 55 : 100,
    trailPreference: p.surface === "asphalt" ? "none" : p.surface === "gravel" ? "some" : "lots",
    accessPolicy: p.surface === "forest" ? "allow_unverified" : "verified",
    preferForest: p.surface === "forest",
    avoidMainRoads: p.surface === "forest",
  };
}

/** Read the profile back out of a plan (e.g. one the chat has modified). */
export function profileFromPlan(plan: RidePlan): RideProfile {
  return normalizeProfile({
    difficulty: plan.difficulty === "easy" ? "rest" : plan.difficulty === "hard" ? "hard" : "adventure",
    // Sights on or off is the distinction; a "balanced" plan from the chat
    // reads as tourism when it includes sights, sport otherwise.
    style: plan.rideStyle === "explore" && !plan.includeSightseeing ? "riding" : "tourism",
    surface: (plan.gravelPreference ?? 70) <= 10 ? "asphalt" : plan.preferForest ? "forest" : "gravel",
  });
}

/**
 * A plan with only the profile filled in, for starting a chat: places,
 * return and budget stay unknown, so the chat asks only about those and
 * "2h ap Tukumu" is a complete request.
 */
export function seedPlanFromProfile(profile: RideProfile): RidePlan {
  return RidePlanSchema.parse({
    startPlace: null,
    viaPlaces: [],
    destinationPlace: null,
    directionPlace: null,
    returnToStart: null,
    budget: { mode: "unknown", value: null, constraint: "target", minimumValue: null },
    ...profileToPlanFields(profile),
    maxRepeatedPercent: null,
    prioritizeLowOverlap: false,
    noSand: false,
    avoidTowns: false,
    includeTet: false,
  });
}

// ---------------------------------------------------------------- storage

const STORAGE_KEY = "mopik.rideProfile.v1";

function isProfile(value: unknown): value is RideProfile {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    (v.difficulty === "rest" || v.difficulty === "adventure" || v.difficulty === "hard") &&
    (v.style === "tourism" || v.style === "riding") &&
    (v.surface === "asphalt" || v.surface === "gravel" || v.surface === "forest")
  );
}

/** Per-device memory of the last profile; the default when nothing is stored. */
export function loadStoredProfile(): RideProfile {
  try {
    const raw = typeof window !== "undefined" ? window.localStorage.getItem(STORAGE_KEY) : null;
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    return isProfile(parsed) ? normalizeProfile(parsed) : DEFAULT_PROFILE;
  } catch {
    return DEFAULT_PROFILE;
  }
}

export function saveStoredProfile(profile: RideProfile): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(normalizeProfile(profile)));
  } catch {
    // Private mode or blocked storage: the profile just isn't remembered.
  }
}
