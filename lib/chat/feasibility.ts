import type { ChatQuickReply, RidePlan } from "./ride-plan";
import type { UnplannableVerdict } from "@/lib/types";

/**
 * Can the ride the rider described be ridden in the time they gave, on the
 * roads they chose? Rīga → Jelgava → Rīga on forest and gravel roads routed
 * at 136–163 km / 4–4.7 h against a 2 h request (2026-09-11), and the only
 * answer was an error. The rider needs three things instead: what does not
 * fit, what the minimum is on these roads, and the honest ways out — more
 * time, asphalt, one way. This module does that arithmetic and phrases it,
 * for the chat (before routing, from straight-line estimates) and for the
 * client (after routing, with the shortest ride we actually found). Pure,
 * so both sides say the same sentence.
 */

/** Distances a rider recognises: straight line × a Latvian road factor. */
const ROAD_FACTOR = 1.3;

/** The estimate is ±20%; below this it is not worth a question before routing. */
const ASK_ABOVE = 1.2;

export type LatLon = { lat: number; lon: number };

export type FeasibilityEstimate = {
  /** road km of the direct legs (start → stops → end), straight line × 1.3 */
  directKm: number;
  /** those legs at the plan's planned average speed */
  directMinutes: number;
  /** the same legs on asphalt */
  asphaltMinutes: number;
  /** without the return leg, when the ride returns to the start; else null */
  oneWayKm: number | null;
  oneWayMinutes: number | null;
};

/** What the router found: the shortest ride that reaches every stop. */
export type FeasibilityVerdict = FeasibilityEstimate & {
  requestedMinutes: number | null;
  requestedKm: number;
  minimumMinutes: number;
  minimumKm: number;
};

export function roadKm(a: LatLon, b: LatLon): number {
  return Math.hypot((a.lat - b.lat) * 111.32, (a.lon - b.lon) * 111.32 * Math.cos(((a.lat + b.lat) / 2) * Math.PI / 180)) * ROAD_FACTOR;
}

/**
 * Transit estimate before routing, at the pace a transit actually averages
 * once the city streets at the start are counted (Rīga → Baldone routed at
 * 46 km / 59 min). Good to about ±20%.
 */
export function estimateTransit(a: LatLon, b: LatLon): { km: number; hours: number } {
  const km = roadKm(a, b);
  return { km: Math.round(km), hours: km / 48 };
}

/**
 * The direct legs of a ride through its stops. `points` is start, stops, end
 * (the start again for a returning ride); `returnToStart` says whether the
 * last leg is the way home, which is what "one way" would drop.
 */
export function estimateLegs(points: LatLon[], speedKmh: number, asphaltKmh: number, returnToStart: boolean): FeasibilityEstimate {
  const legs = points.slice(1).map((p, i) => roadKm(points[i], p));
  const directKm = legs.reduce((sum, km) => sum + km, 0);
  const oneWayKm = returnToStart && legs.length > 1 ? legs.slice(0, -1).reduce((sum, km) => sum + km, 0) : null;
  return {
    directKm: Math.round(directKm),
    directMinutes: Math.round((directKm / speedKmh) * 60),
    asphaltMinutes: Math.round((directKm / asphaltKmh) * 60),
    oneWayKm: oneWayKm === null ? null : Math.round(oneWayKm),
    oneWayMinutes: oneWayKm === null ? null : Math.round((oneWayKm / speedKmh) * 60),
  };
}

/** Whether the direct legs alone already break the budget. */
export function exceedsBudget(plan: RidePlan, estimate: FeasibilityEstimate): boolean {
  if (!plan.budget.value) return false;
  if (plan.budget.mode === "duration") return estimate.directMinutes > plan.budget.value * 60 * ASK_ABOVE;
  if (plan.budget.mode === "distance") return estimate.directKm > plan.budget.value * ASK_ABOVE;
  return false;
}

export function minutesLabel(minutes: number): string {
  const m = Math.round(minutes);
  return m >= 60 ? `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60} min` : ""}` : `${m} min`;
}

/** "pa meža un grants ceļiem" — the roads the rider chose, as they would say it. */
export function surfacePhrase(plan: RidePlan, lv: boolean): string {
  const asphalt = plan.gravelPreference !== null && plan.gravelPreference <= 10 && plan.trailPreference === "none";
  const forest = plan.preferForest && (plan.gravelPreference ?? 0) >= 90;
  if (asphalt) return lv ? "pa asfaltu" : "on asphalt";
  if (forest) return lv ? "pa meža un grants ceļiem" : "on forest and gravel roads";
  return lv ? "pa grants ceļiem" : "on gravel roads";
}

function isAsphalt(plan: RidePlan): boolean {
  return plan.gravelPreference !== null && plan.gravelPreference <= 10 && plan.trailPreference === "none";
}

/** Hours for a "Kopā X h" chip: half-hour steps, rounded up from an estimate, to nearest from a routed ride. */
function suggestHours(minutes: number, routed: boolean): number {
  const halves = routed ? Math.round(minutes / 30) : Math.ceil(minutes / 30);
  return Math.max(0.5, halves / 2);
}

/**
 * The verdict as a chat turn: what does not fit and why (numbers), the
 * minimum that can be planned on these roads when routing has shown it, and
 * one tap for each way out that would actually fit. Never a bare error.
 */
export function describeInfeasible(plan: RidePlan, estimate: FeasibilityEstimate & Partial<Pick<FeasibilityVerdict, "minimumMinutes" | "minimumKm">>, lv: boolean): { message: string; quickReplies: ChatQuickReply[] } {
  const t = (a: string, b: string) => (lv ? a : b);
  const start = plan.startPlace ?? "";
  const end = plan.returnToStart ? start : plan.destinationPlace ?? "";
  const route = [start, ...plan.viaPlaces, end].filter(Boolean).join(" → ");
  const surface = surfacePhrase(plan, lv);
  const thereAndBack = plan.returnToStart ? t(" turp un atpakaļ", " there and back") : "";
  const value = plan.budget.value ?? 0;
  const duration = plan.budget.mode === "duration";
  const budgetLabel = duration ? `${value} h` : `${value} km`;
  const routed = estimate.minimumMinutes !== undefined && estimate.minimumKm !== undefined;

  // A free loop has no direct legs to quote; the minimum below says it all.
  const problem = estimate.directKm === 0
    ? t(`${route} ${surface} ${budgetLabel} ietvaros nesanāk.`, `${route} ${surface} does not fit in ${budgetLabel}.`)
    : duration
    ? t(
        `${route} ${surface} ${budgetLabel} ietvaros nesanāk: taisnākais ceļš${thereAndBack} ir ~${estimate.directKm} km, ${surface} tas ir ap ${minutesLabel(estimate.directMinutes)}.`,
        `${route} ${surface} does not fit in ${budgetLabel}: the straightest way${thereAndBack} is ~${estimate.directKm} km, about ${minutesLabel(estimate.directMinutes)} ${surface}.`)
    : t(
        `${route} ${budgetLabel} ietvaros nesanāk: taisnākais ceļš${thereAndBack} ir ~${estimate.directKm} km.`,
        `${route} does not fit in ${budgetLabel}: the straightest way${thereAndBack} is ~${estimate.directKm} km.`);
  const minimum = routed
    ? t(
        `Īsākais, ko šeit var izplānot ${surface}, ir ${minutesLabel(estimate.minimumMinutes!)} / ${estimate.minimumKm} km — tas ir kartē.`,
        `The shortest that can be planned here ${surface} is ${minutesLabel(estimate.minimumMinutes!)} / ${estimate.minimumKm} km — it is on the map.`)
    : "";
  const ask = t("Kā darām?", "What shall we do?");

  const quickReplies: ChatQuickReply[] = [];
  if (duration) {
    const hours = suggestHours(routed ? Math.max(estimate.minimumMinutes!, estimate.directMinutes) : estimate.directMinutes, routed);
    quickReplies.push({ label: t(`Kopā ${hours} h`, `${hours} h in total`), message: t(`Apmēram ${hours} stundas kopā.`, `About ${hours} hours in total.`) });
    if (!isAsphalt(plan) && estimate.asphaltMinutes <= value * 60 * ASK_ABOVE) {
      quickReplies.push({ label: t(`Pa asfaltu ${value} h`, `On asphalt, ${value} h`), message: t(`Segums: tikai asfalts. Apmēram ${value} stundas kopā.`, `Surface: asphalt only. About ${value} hours in total.`) });
    }
    if (plan.returnToStart && estimate.oneWayMinutes !== null && estimate.oneWayMinutes <= value * 60 * ASK_ABOVE && plan.viaPlaces.length) {
      const last = plan.viaPlaces[plan.viaPlaces.length - 1];
      quickReplies.push({ label: t(`Vienā virzienā ${start} → ${last}`, `One way ${start} → ${last}`), message: t(`Vienvirziena brauciens ${start} → ${last}, apmēram ${value} stundas.`, `One-way ride ${start} → ${last}, about ${value} hours.`) });
    }
  } else {
    const km = Math.ceil((routed ? Math.max(estimate.minimumKm!, estimate.directKm) : estimate.directKm * 1.1) / 10) * 10;
    quickReplies.push({ label: t(`Kopā ~${km} km`, `~${km} km in total`), message: t(`Apmēram ${km} km kopā.`, `About ${km} km in total.`) });
    if (plan.returnToStart && estimate.oneWayKm !== null && estimate.oneWayKm <= value * ASK_ABOVE && plan.viaPlaces.length) {
      const last = plan.viaPlaces[plan.viaPlaces.length - 1];
      quickReplies.push({ label: t(`Vienā virzienā ${start} → ${last}`, `One way ${start} → ${last}`), message: t(`Vienvirziena brauciens ${start} → ${last}, apmēram ${value} km.`, `One-way ride ${start} → ${last}, about ${value} km.`) });
    }
  }
  return { message: [problem, minimum, ask].filter(Boolean).join(" "), quickReplies };
}

/**
 * The ride Mopik cannot plan in one go, said before the search.
 *
 * Three things, in the order a rider needs them: what was asked, that this
 * one cannot be planned in a single go *yet*, and what does work today. The
 * last part is the one that matters — "nevar" on its own sends the rider
 * away, "līdz ~600 km lēnākā apvidū strādā" tells them how to get a ride.
 *
 * Deliberately not phrased as a failure. Nothing broke: the ride is simply
 * beyond what one 50 s search can cover, and the honest interim (backlog
 * item 7) is to say so up front rather than after a 50 s wait ending in 422.
 *
 * The numbers in the wording come from the measurements in `docs/BACKLOG.md`
 * item 7 and are deliberately vague ("~600 km", "lēnākā apvidū"): the real
 * limit is search difficulty, not distance, so a precise kilometre figure
 * would be a promise Mopik cannot keep — Rīga → Berlin is 1133 km and routes
 * in 23 s, Como → Budapest is 1126 km and takes 74 s.
 *
 * ## When the rider named stops, the refusal names the segment (item 7, 2d)
 *
 * A ride cut at rider-named places is probed per segment, so the answer can
 * be "šis posms ir par grūtu" rather than a flat no about the whole ride.
 * That is the whole point of step 2d: the rider can fix a segment by adding
 * a stop inside it, and they cannot fix "too long".
 *
 * Inside that, the direct road for the failing segment is offered **by
 * name** when the probe routed it — "nevaru izplānot interesantu maršrutu
 * šim posmam, bet taisnāko ceļu varu". It is a tap, never a substitution:
 * CLAUDE.md's "never substitute silently" is exactly this case, and the
 * straightest line between two points is the road an adventure rider was
 * trying to avoid.
 */
export function describeUnplannable(
  verdict: UnplannableVerdict,
  lv: boolean
): { message: string; quickReplies: ChatQuickReply[] } {
  const t = (a: string, b: string) => (lv ? a : b);
  const segment = verdict.segment;
  const route = [verdict.from, verdict.to].filter(Boolean).join(" → ");
  const km = Math.round(verdict.legKm);
  const ask = t("Kā darām?", "What shall we do?");

  // The offer, when there is one. Built first because both branches below
  // may carry it — a ride with no stops can still have a routed direct leg.
  const offer = verdict.directLeg
    ? t(
        `Taisnāko ceļu šim posmam varu — ${verdict.directLeg.distanceKm} km, ${minutesLabel(verdict.directLeg.durationMinutes)}, bet tas ir tikai ceļš no A uz B, ne interesants maršruts.`,
        `I can do the straightest way for this stretch — ${verdict.directLeg.distanceKm} km, ${minutesLabel(verdict.directLeg.durationMinutes)} — but that is just the road from A to B, not an interesting route.`
      )
    : "";
  // `action` matters: the road is already in the verdict, so this chip is
  // handled on the client and never sent to the chat. Routing it through the
  // model would mean re-planning the leg, and our own profile is measured
  // never to answer these legs at all.
  const offerReply: ChatQuickReply[] = verdict.directLeg
    ? [
        {
          label: t("Rādi taisnāko ceļu", "Show the straightest way"),
          message: t("Parādi taisnāko ceļu šim posmam.", "Show me the straightest way for that stretch."),
          action: "direct-leg",
        },
      ]
    : [];

  if (segment) {
    const hop = [segment.from, segment.to].filter(Boolean).join(" → ");
    const which = t(
      `Šis posms ir par grūtu: ${hop} (~${Math.round(segment.km)} km, ${segment.index + 1}. no ${segment.ofSegments}).`,
      `This stretch is too hard: ${hop} (~${Math.round(segment.km)} km, ${segment.index + 1} of ${segment.ofSegments}).`
    );
    // The actionable part, and the reason step 2d exists. A stop inside the
    // segment gives the router two searches it can do instead of one it
    // cannot — and it is a place the rider wanted to be anyway.
    const fix = t(
      `Pievieno pieturu starp ${segment.from} un ${segment.to}, un es varu izplānot abas puses atsevišķi.`,
      `Add a stop between ${segment.from} and ${segment.to}, and I can plan both halves separately.`
    );
    return {
      message: [which, fix, offer, ask].filter(Boolean).join(" "),
      quickReplies: [
        {
          label: t("Pievienot pieturu", "Add a stop"),
          message: t(
            `Pievienosim pieturu starp ${segment.from} un ${segment.to}.`,
            `Let's add a stop between ${segment.from} and ${segment.to}.`
          ),
        },
        ...offerReply,
      ],
    };
  }

  const asked = t(
    `${route} ir ~${km} km taisnā līnijā.`,
    `${route} is ~${km} km as the crow flies.`
  );
  // "Vēl" is load-bearing: this is an interim, and the rider was explicit
  // that refusing is not the end state.
  const cannot = t(
    "Tik garu braucienu es vienā piegājienā vēl nevaru izplānot — ceļa meklēšana šajā apvidū aizņem vairāk laika, nekā man ir.",
    "I cannot plan a ride this long in one go yet — searching for roads in this terrain takes more time than I have."
  );
  // With no stops there is no segment to blame, so the way out is to name
  // one: a stop turns this into the segment case above, which Mopik can act
  // on. That is the same advice as "split into days", one step earlier.
  const works = t(
    "Kas strādā jau tagad: līdz ~600 km lēnākā apvidū un vairāk līdzenumā. Pievieno pieturu pa vidu, sadali braucienu pa dienām vai izvēlies tuvāku galamērķi.",
    "What works today: up to ~600 km in slower terrain, further on flat ground. Add a stop in the middle, split the ride into days, or choose a closer destination."
  );

  return {
    message: [asked, cannot, works, offer, ask].filter(Boolean).join(" "),
    quickReplies: [
      {
        label: t("Pievienot pieturu", "Add a stop"),
        message: t("Pievienosim pieturu pa vidu.", "Let's add a stop in the middle."),
      },
      ...offerReply,
      { label: t("Mainīt galamērķi", "Change the destination"), message: t("Izvēlēsimies tuvāku galamērķi.", "Let's choose a closer destination.") },
    ],
  };
}
