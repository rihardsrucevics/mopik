"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { useLocale } from "@/lib/i18n/use-locale";
import { t, messages } from "@/lib/i18n/messages";
import { fi } from "@/lib/i18n/format";
import { ArrowLeft, ArrowUp, Download, LoaderCircle, RefreshCw } from "lucide-react";
import { GeneratedRoute, GenerateRouteResponse } from "@/lib/types";
import { RidePlan, planSummary } from "@/lib/chat/ride-plan";
import { BeerPopup } from "@/components/beer-popup";
import { track } from "@/lib/analytics";
import { encodeRouteShare, shareUrl } from "@/lib/share/route-code";
import type { ResolvedPlace } from "@/lib/chat/places";
import { isSaved, removeRide, rideId, saveRide } from "@/lib/share/saved-rides";
import { gpxFilename } from "@/lib/gpx/filename";
import { rideWaypoints } from "@/lib/gpx/waypoints";
import { DetailsCard, RouteActionRow } from "@/components/action-row";
import { type RoutePoi, type RoutePois } from "@/lib/poi/kinds";
import { SuggestionsCard, type DetourFocusNote, type SelectedPoi } from "@/components/suggestions-card";
import { useDetourAnalytics, useDetourPrefetch, useSplicedRoute } from "@/lib/routing/use-detours";
import { type DetourResult } from "@/lib/routing/detour";
import type { SplicedRoute } from "@/lib/routing/detour";
import type { EditedRide } from "@/lib/routing/reroute-leg";

/**
 * The left column once routes exist: what was asked, the three versions,
 * the selected one's numbers, Lejupielādēt GPX — and at the bottom an
 * input inviting a correction. Sending a correction hands the column over
 * to the chat until new routes arrive, then this view returns. No chat
 * history competes with the result.
 */

/**
 * Two categories, named by comparison rather than by superlative.
 *
 * m.resStraight claimed to be *the* straightest and was measured coming back
 * 43 km / 1 h 22 next to a "most winding" of 25 km / 1 h 8 — a label that lies.
 * "Faster" only claims to be the quicker of the two, which it now is by
 * construction. `balanced` is kept for share codes made before the change.
 */
const variantLabels = (m: ReturnType<typeof messages>): Record<string, { label: string; detail: string }> => ({
  direct: { label: m.resFaster, detail: m.resFasterHint },
  balanced: { label: m.resBalanced, detail: m.resFasterHint },
  complex: { label: m.resComplex, detail: m.resComplexHint },
});


/**
 * The gate glyph, and why it is a door.
 *
 * Three were weighed. 🚧 is the roadworks barrier — it means "works ahead,
 * closed", which is the one thing a Latvian forest gate usually is *not*: it
 * stands open more often than not, and the rider is being told a gate exists,
 * not that the road is shut. ⛩️ is a Shinto torii; at 14 px it reads as a
 * gateway, but it means a shrine entrance and looks like one anywhere the
 * rider might show the app.
 *
 * 🚪 is a door: a rectangle with a handle, which is legible at 14 px (the
 * RISKI row's size) precisely because it has almost no internal detail — the
 * torii's crossbeams and the barrier's diagonal stripes both turn to mush at
 * that size. And "a thing across your way that you can open" is exactly what
 * the row says: "var būt jāatver vai jāgriežas".
 *
 * Kept next to `Row` and duplicated in `route-map.tsx` and `shared-route.tsx`,
 * the way ⚠️ and 🔥 already are: the emoji are plain text and each surface
 * writes them into a different medium (JSX here, a DOM string on the map).
 */
export const GATE_ICON = "🚪";

function duration(seconds: number): string {
  const m = Math.round(seconds / 60);
  return m >= 60 ? `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60} min` : ""}` : `${m} min`;
}

/**
 * One line of the breakdown. `icon` is the map's own emoji for the same thing
 * — 🔥 for a trail, ⚠️ for unverified access — so a rider who has just read a
 * badge on the map meets the same mark next to the number. It follows the
 * label rather than leading it: the labels now end in a parenthetical
 * ("Taciņas (punktotā līnija)") and a mark in front of that pushed the words
 * away from the column edge, so the rows no longer lined up. It is
 * aria-hidden: the label beside it already says what it means, and the row is
 * read out as words. The explicit font-size keeps a colour emoji, which draws
 * wider than its type size, from outgrowing the 12 px row.
 */
function Row({ label, value, icon }: { label: string; value: string; icon?: string }) {
  return (
    <div className="flex justify-between gap-3 py-0.5 text-xs">
      <span className="flex min-w-0 items-center gap-1 text-stone-500">
        {label}
        {icon && <span aria-hidden="true" className="shrink-0 text-[12px] leading-none">{icon}</span>}
      </span>
      <span className="tabular-nums text-stone-900">{value}</span>
    </div>
  );
}

export function ResultPanel({ routes, selected, onSelect, plan, lucky = false, remoteLoop, longerSuggestion, tolerancePercent = 20, busy, onSend, onBackToForm, resolvedPlaces, alternatives, offset, onOffsetChange, map, sparsePlaceData = false, assembledFromSegments = false, directLeg = false, onShowPoi, pois = null, poisLoading = false, poisFailed = false, onDetoursChange, selectedPois = [], onToggleSelectPoi, onClearSelectedPois, onCommitSelection, onSearchBetterLoop, onSplicedChange, override = null, edited = null, rerouting = false, editNote = null, onEdit }: {
  routes: GeneratedRoute[];
  /**
   * This is the direct-road offer (backlog item 7b), not a planned ride.
   *
   * The rider asked for it by name after Mopik refused the segment, so the
   * panel must say what it is rather than let a `car-fast` line sit where an
   * adventure route normally does. CLAUDE.md's "never substitute silently"
   * is the rule; this flag is how the panel keeps it visible.
   */
  directLeg?: boolean;
  /** transit → loop → transit split, when the ride was built around a focus area */
  remoteLoop?: GenerateRouteResponse["remoteLoop"];
  /** the API's own offer when nothing inside the budget looped cleanly */
  longerSuggestion?: GenerateRouteResponse["longerSuggestion"];
  /** the rider's tolerance on time/distance, from the intent (default 20) */
  tolerancePercent?: number;
  /** start only, no destination, no time: the most interesting ride we could find */
  lucky?: boolean;
  selected: number;
  onSelect: (index: number) => void;
  plan: RidePlan | null;
  /** Accepted but no longer read: it only ever softened the "streets and
   *  yards" warning, and that warning list is gone. `app/page.tsx` still
   *  passes it, so the prop stays in the type. */
  avoidTowns?: boolean;
  busy: boolean;
  onSend: (text: string) => void;
  onBackToForm: () => void;
  /**
   * The places the API actually routed through, with coordinates. They travel
   * in the share code so a ride reopened for editing keeps the exact "Circle K"
   * the rider picked instead of being geocoded again.
   */
  resolvedPlaces?: ResolvedPlace[] | null;
  /**
   * The runners-up the API kept back. Shown on request and *added* to the
   * cards already on screen — a rider who asks to see more must not lose the
   * three they were comparing.
   */
  alternatives?: GeneratedRoute[] | null;
  /**
   * Which ride each category is showing. Owned by the page, because the map
   * reads it too — keeping it here meant cycling a card updated the numbers
   * and left the map drawing the previous line.
   */
  offset: Record<string, number>;
  onOffsetChange: (next: Record<string, number>) => void;
  /**
   * The map, on phones only. It belongs under the ride's own heading and above
   * the versions it illustrates — floating above the whole page it read as a
   * separate thing, and the versions were the first thing a rider saw.
   */
  map?: ReactNode;
  /** The ride is outside the pre-baked POI data, so stops have no names. */
  sparsePlaceData?: boolean;
  assembledFromSegments?: boolean;
  /**
   * The sights the rider has ticked, and the controls that change that set.
   *
   * Owned by the page rather than by this panel for two reasons the rider can
   * see: the map draws a marker per ticked place, and the panel is unmounted
   * and rebuilt on every generation (`setResult(null)` in `startFromForm`), so
   * a selection kept here would vanish the moment the ride was re-planned.
   */
  selectedPois?: SelectedPoi[];
  onToggleSelectPoi?: (poi: SelectedPoi) => void;
  onClearSelectedPois?: () => void;
  /**
   * Keep the ticked sights, with no search at all.
   *
   * The spliced line the rider is already looking at becomes the ride: its
   * numbers are recomputed from it and the places are written into the plan.
   * This is the fast path the rider asked for — the detours are routed and
   * spliced in milliseconds, and committing them used to throw all of that
   * away and spend 20-30 s searching again.
   */
  onCommitSelection?: () => void;
  /**
   * The full search, with the ticked sights as vias — offered by name, never
   * as what a press silently does.
   *
   * It can find a genuinely cleaner loop through the same places, and losing
   * that to make committing fast would be trading one of the rider's asks for
   * another. So both are on screen and the slower one says what it costs.
   */
  onSearchBetterLoop?: () => void;
  /**
   * The ride on screen when the rider has changed it — sights kept, places
   * moved, added or removed — already in the shape of a ride, with every
   * figure recomputed from the edited line (`asGeneratedRoute`). Null while
   * the ride is the one the API returned.
   *
   * It replaces the selected card's ride outright rather than being consulted
   * field by field, so the headline, SEGUMS, the GPX, the share code and a
   * save all describe the line on the map without each having to remember to
   * look — the share code and the save were the two that once forgot.
   */
  override?: GeneratedRoute | null;
  /**
   * What the edit was, for the words about it: whether it was a hand edit
   * ("Labots ar roku") or kept sights, and its places. Null with `override`.
   */
  edited?: EditedRide | null;
  /** A stretch is being re-routed right now. */
  rerouting?: boolean;
  /** What the last edit had to say for itself: a failure, or a moved point. */
  editNote?: string | null;
  /**
   * "Labot": correct this ride on its map, on this page. Absent where the
   * ride cannot be edited that way — the direct road after a refusal, a
   * remote loop — so the button is not drawn at all rather than drawn dead.
   */
  onEdit?: () => void;
  /**
   * Fly the map to a suggested place and ring it, without changing the ride.
   *
   * The page owns it because the map does — the panel only knows which row was
   * pressed. Absent when there is no map to fly (the desktop column is always
   * there, so in practice this is always passed).
   */
  /** Fly the map to a suggestion. The second argument is what its row says
   *  about the detour, so the map's card can state the same figures. */
  onShowPoi?: (poi: RoutePoi, detour?: DetourFocusNote | null) => void;
  /**
   * The sights near this ride, as the page's lookup answered.
   *
   * Down rather than up, which is the reversal this change is: the panel used
   * to ask for them when its card was opened and report them upwards, and the
   * map could therefore draw nothing until the rider opened a card. The page
   * now asks as soon as a ride is shown — the map needs them either way — and
   * both the map and this card read the one answer.
   */
  pois?: RoutePois | null;
  poisLoading?: boolean;
  /** The lookup errored rather than answering empty. Said, not hidden. */
  poisFailed?: boolean;
  /**
   * The routed detours, as the prefetch answers, reported upwards.
   *
   * The map can now open a sight's card by itself — the rider clicks a marker
   * rather than a row — and that card must not say less than the row does. The
   * row derives its "+4,2 km · garš apbrauciens" from these; handing the same
   * record to the page lets a marker's click derive exactly the same line
   * through exactly the same function. The prefetch stays here, where the list
   * it is keyed to lives.
   */
  onDetoursChange?: (detours: Record<string, DetourResult>) => void;
  /**
   * The ride as it is currently drawn, once ticked sights have been spliced
   * into it — or null when nothing is ticked and the API's own line stands.
   *
   * Reported upwards for the reason `selectedPois` comes down: the map is the
   * page's, not the panel's, and the line it draws has to be the line these
   * numbers describe. Null rather than "the original" on purpose, so the
   * unspliced case is one object identity everywhere and unticking cannot
   * leave a stale copy behind.
   */
  onSplicedChange?: (spliced: SplicedRoute | null) => void;
}) {
  const [locale] = useLocale();
  const m = messages(locale);
  const [details, setDetails] = useState(false);
  // Alternatives are appended, never swapped in: the three the rider is
  // comparing stay exactly where they are.

  /** That category's rides in order: the API's pick first, then its runners-up. */
  const familyOf = (variant: string) => [
    ...routes.filter((r) => r.variant === variant),
    ...(alternatives ?? []).filter((r) => r.variant === variant),
  ];
  /** The ride a card is currently showing. */
  const shownFor = (r: GeneratedRoute) => {
    const family = familyOf(r.variant);
    return family[(offset[r.variant] ?? 0) % Math.max(1, family.length)] ?? r;
  };
  /**
   * The card's own open state, and nothing else about the suggestions.
   *
   * The list itself used to be fetched here, the first time this block was
   * opened. It is now fetched by the page as soon as a ride is shown and
   * arrives as `pois` — because the map draws the on-route places whether or
   * not this card is ever opened, and a fetch keyed on `suggestOpen` could not
   * answer a map the rider has not touched. The card is now a pure view of the
   * page's state, which is also why opening it is instant.
   *
   * The open state stays local: it is about this card, not about the ride.
   */
  const [suggestOpen, setSuggestOpen] = useState(false);

  const [beer, setBeer] = useState(false);
  const [shared, setShared] = useState<"idle" | "copied">("idle");
  // Which ride is currently saved, by its code: derived during render rather
  // than mirrored into state, so switching versions needs no effect.
  const [savedTick, setSavedTick] = useState(0);
  const [text, setText] = useState("");
  // Everything below — the numbers, the GPX, the share code — reads the ride
  // the selected card is actually showing, not the API's original pick.
  const route = override ?? shownFor(routes[Math.min(selected, routes.length - 1)]);

  /**
   * The ride this panel is showing, as the page's POI lookup keys it.
   *
   * `route.id` is a fresh `crypto.randomUUID()` per generated ride, so it
   * changes on every regeneration *and* whenever the rider cycles a card to a
   * runner-up — which is exactly when the sights must be asked for again. The
   * asking now happens in the page (see `lib/poi/use-route-pois.ts`); this is
   * only the key the detour prefetch shares with it.
   */
  const routeId = route?.id ?? null;

  /**
   * The detours, routed in the background the moment the suggestions arrive.
   *
   * Not when the card is opened — when the *list* is. The rider is reading the
   * rows by then, and two short legs per place is a second or two each, so by
   * the time he has decided which he wants, the answers are here and ticking
   * one is arithmetic. The prefetch is abandoned if the ride changes under it.
   */
  const { byPoi: detours, loading: detoursLoading } = useDetourPrefetch({
    routeId,
    geometry: route?.geometry ?? null,
    durationSeconds: route?.durationSeconds ?? null,
    plan,
    nearby: pois?.nearby ?? null,
  });

  /**
   * The ride with the ticked sights spliced in — null while nothing is ticked,
   * which is what makes unticking exact rather than an undo.
   */
  const spliced = useSplicedRoute({
    segments: route?.segments ?? null,
    distanceMeters: route?.distanceMeters ?? null,
    durationSeconds: route?.durationSeconds ?? null,
    selectedIds: selectedPois.map((p) => p.id),
    detours,
  });
  useDetourAnalytics(spliced);

  // The map is the page's, so the spliced line has to travel up to it. In an
  // effect rather than during render: this is a parent state write, and doing
  // it while rendering is the React warning it looks like.
  const onSplicedChangeRef = useRef(onSplicedChange);
  useEffect(() => { onSplicedChangeRef.current = onSplicedChange; }, [onSplicedChange]);
  useEffect(() => { onSplicedChangeRef.current?.(spliced); }, [spliced]);
  // The same shape, for the same reason: a parent state write belongs in an
  // effect, and the callback goes through a ref so an inline arrow is not a
  // reason to publish again.
  const onDetoursChangeRef = useRef(onDetoursChange);
  useEffect(() => { onDetoursChangeRef.current = onDetoursChange; }, [onDetoursChange]);
  useEffect(() => { onDetoursChangeRef.current?.(detours); }, [detours]);

  if (!route) return null;
  /**
   * What the numbers on screen describe: the spliced ride when sights are
   * ticked, the API's own otherwise.
   *
   * Derived in one place and read everywhere below, so the headline, the
   * SURFACE rows, the GPX and the map can never disagree about which ride the
   * rider is looking at.
   */
  const shownDistanceMeters = spliced?.distanceMeters ?? route.distanceMeters;
  const shownDurationSeconds = spliced?.durationSeconds ?? route.durationSeconds;
  const shownSurfaces = spliced?.surfaces ?? route.surfaces;
  /**
   * The repeated share, and the one place this panel had to change its mind.
   *
   * It used to be `route.overlap.repeatedPercent` always, with a comment
   * saying a spliced figure invented here would be a different measurement
   * wearing the same label. That was right about a *preview* — a tick is one
   * untick away and the API's own number is still the truth about the ride.
   * It is wrong about an *edit*: once the rider keeps sights or moves a stop,
   * the line on the map is no longer the line the API measured, and showing
   * that ride's old repeated figure is showing a number that has stopped
   * describing what is on screen. The rider's one rule is not riding the same
   * road twice; a correction can make that worse and he must see it.
   *
   * So `recomputeOverlap` (in `lib/routing/reroute-leg.ts`) runs the SAME
   * measurement `classify.ts` does — consecutive coordinate pairs keyed at
   * ~1 m with direction removed — over the edited geometry, and the edited
   * ride (`override`) carries that figure, which the kicker then names as
   * recomputed. A preview still shows the API's number, unchanged.
   */
  const shownRepeatedPercent = route.overlap.repeatedPercent;
  const q = route.quality;
  // The RISKS share, on the same denominator the ROADS rows use: road + track
  // + trail is the whole ride, so the two blocks' percentages are comparable
  // even though they measure different things. `|| 1` guards a zero-length
  // ride; the row itself only renders when the kilometres are above zero.
  const unverifiedPercent = Math.round(
    (q.unverifiedPathKm / (route.roadMix.roadKm + route.roadMix.trackKm + route.roadMix.trailKm || 1)) * 100,
  );
  // SURFACE rows read like the ROADS rows, "{km} km · {pct} %". Nothing stores
  // per-surface kilometres — `SurfaceMix` is four percentages — so the km are
  // derived here. That is sound rather than a guess: `classify.ts` divides
  // `distBySurface` by the same `total` (road + track + trail) it uses for the
  // ROADS percentages, over the same edges, so one denominator serves both and
  // the derived figure is the real length to within the rounding of a whole
  // percent. Worth ~0.4 km on a 73 km ride, which is why the km are shown to
  // one decimal and not two. Real per-surface metres would have to come from
  // `SurfaceMix`, `classify.ts` and the versioned share code — three files
  // outside this change — and can replace this without touching the rows.
  const surfaceKm = (percent: number) => Math.round((shownDistanceMeters / 1000) * (percent / 100) * 10) / 10;
  const unpaved = (r: GeneratedRoute) => r.surfaces.gravelPercent + r.surfaces.dirtPercent;
  // The gravel share of the ride as drawn. A gravel spur to a hillfort moves
  // it, and a headline that did not move would be describing a different line
  // from the one on the map.
  const shownUnpaved = shownSurfaces.gravelPercent + shownSurfaces.dirtPercent;

  const downloadGpx = async () => {
    // The thank-you opens in the click itself: on iOS Safari the download
    // sheet and the programmatic click after an await left a timer-driven
    // popup never showing. The file downloads underneath it.
    setBeer(true);
    track("gpx_downloaded", { variant: route.variant, km: Math.round(shownDistanceMeters / 1000), minutes: Math.round(shownDurationSeconds / 60), repeated: shownRepeatedPercent, unpaved: shownUnpaved });
    try {
      /**
       * The spliced line, when sights are ticked.
       *
       * It is a real routed line — two BRouter legs on the rider's own profile
       * spliced into the rest of the ride — so exporting it is exporting a
       * ride, not a sketch. What the file loses is the **elevation profile**
       * for the detour: `GeneratedRoute.geometry` carries none (the elevations
       * live on the server's `RoutePath` and never reach the client), so the
       * GPX has always been a plain track of lon/lat and the spliced one is
       * exactly as complete as the unspliced one. Segment metadata — surface,
       * road class — is likewise not in the GPX format we write; it is in the
       * description, which is generated from the spliced numbers below. So
       * nothing is lost by splicing that was not already absent.
       */
      // The same order the map draws in: the preview if one is on screen, the
      // ride as it stands otherwise — edited, when it was. A GPX that did not
      // carry the rider's correction would be the one place his edit was
      // silently dropped — and the GPX is the thing he actually rides.
      const coordinates = spliced?.coordinates ?? route.geometry.coordinates;
      const res = await fetch("/api/export-gpx", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: route.name, coordinates, description: gpxDescription(), places: ridePlaces(), km: shownDistanceMeters / 1000, waypoints: gpxWaypoints() }),
      });
      if (!res.ok) return;
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = gpxFilename({ places: ridePlaces(), name: route.name, km: shownDistanceMeters / 1000 });
      a.rel = "noopener";
      // Attached to the document: some mobile browsers ignore clicks on detached anchors.
      document.body.appendChild(a);
      a.click();
      setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 4000);
    } catch (e) {
      console.error("GPX download failed", e);
    }
  };

  // The time limit is the feature riders value most, so the verdict on it is
  // explicit: requested vs delivered, and one tap towards each way out. A
  // loop's length is whatever the roads allow, so there is a free band —
  // the rider's tolerance or 15 minutes, whichever is larger.
  const requestedMinutes = plan?.budget.mode === "duration" && plan.budget.value ? plan.budget.value * 60 : null;
  const deliveredMinutes = plan?.budgetScope === "focus" && remoteLoop ? (remoteLoop.loops[selected]?.minutes ?? route.durationSeconds / 60) : route.durationSeconds / 60;
  const freeMinutes = requestedMinutes ? Math.max(15, (requestedMinutes * tolerancePercent) / 100) : 0;
  const isMaximum = plan?.budget.constraint === "maximum";
  const over = requestedMinutes !== null && deliveredMinutes > requestedMinutes + (isMaximum ? 0 : freeMinutes);
  const under = requestedMinutes !== null && !isMaximum && deliveredMinutes < requestedMinutes - freeMinutes;
  const requestedLabel = requestedMinutes !== null ? duration(requestedMinutes * 60) : "";
  const timeVerdict = over
    ? fi(m.resTimeOver, { asked: `${isMaximum ? `${m.resUpTo} ` : "~"}${requestedLabel}`, got: duration(deliveredMinutes * 60) })
    : under
      // Say why. A bare "this one is only 1 h 22" reads as the app failing at
      // its one job; the real reason is that a longer ride here would have to
      // retrace roads, and not riding the same road twice is the thing this
      // product optimises. The rider can still ask for the longer one.
      ? fi(m.resTimeUnder, { asked: requestedLabel, got: duration(deliveredMinutes * 60) })
      : null;
  // The label is what the rider reads, so it is translated; `message` is sent
  // to the chat backend, whose plan normalisation parses Latvian and English
  // only (`normalizePlan` in app/api/route-chat/route.ts). Translating it
  // would silently stop the correction from being understood.
  const timeActions: { label: string; message: string }[] = [];
  if (over && requestedMinutes) timeActions.push({ label: fi(m.resFindShorter, { time: requestedLabel }), message: `Īsāku — ne vairāk kā ${plan!.budget.value} stundas.` });
  if (under && requestedMinutes) timeActions.push({ label: fi(m.resFindLonger, { time: requestedLabel }), message: `Garāku — apmēram ${plan!.budget.value} stundas, var vairāk pieturu.` });
  if (longerSuggestion) timeActions.push({
    label: fi(m.resCleanerLoop, { time: duration(longerSuggestion.durationMinutes * 60), pct: longerSuggestion.repeatedPercent }),
    message: `Apmēram ${Math.round(longerSuggestion.durationMinutes / 15) * 0.25} stundas, tas tīrākais aplis.`,
  });

  // One URL carries the whole route (lib/share/route-code.ts). On a phone the
  // system share sheet is the natural thing; on a desktop it is not (macOS
  // opens its own sheet, which nobody wants for a link), so there the link
  // goes to the clipboard with a visible confirmation.
  const shareRoute = async () => {
    // The rider's own language travels with the link, so the card the
    // recipient sees is written in the language the sender was using. Only
    // here: the saved-ride encoders must not write it (see `l` on ShareMeta).
    const code = encodeRouteShare(route, route.stops?.[0]?.name ?? plan?.startPlace ?? "", plan, resolvedPlaces, locale);
    // Short id from the store when it answers quickly; the long self-contained
    // link otherwise. Both open the same page.
    let url = shareUrl(code, window.location.origin);
    try {
      const res = await fetch("/api/share", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code }), signal: AbortSignal.timeout(4000) });
      if (res.ok) { const { id } = await res.json(); if (typeof id === "string") url = shareUrl(id, window.location.origin); }
    } catch { /* long link it is */ }
    const title = `${route.name} · ${Math.round(route.distanceMeters / 1000)} km`;
    const phone = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent) || window.matchMedia("(pointer: coarse)").matches;
    if (phone && typeof navigator.share === "function") {
      try { await navigator.share({ title, url }); track("route_shared", { method: "share", km: Math.round(route.distanceMeters / 1000), variant: route.variant }); return; }
      catch { /* dismissed: fall through to copy */ }
    }
    try { await navigator.clipboard.writeText(url); setShared("copied"); setTimeout(() => setShared("idle"), 3500); track("route_shared", { method: "copy", km: Math.round(route.distanceMeters / 1000), variant: route.variant }); }
    catch { window.prompt(m.resCopyLink, url); }
  };

  // The places the ride actually visits, in order, for the filename.
  const ridePlaces = () => {
    if (!plan) return route.stops?.map((s) => s.name) ?? [];
    const end = plan.returnToStart ? plan.startPlace : plan.destinationPlace;
    return [plan.startPlace, plan.focusArea, ...plan.viaPlaces, end].filter((p): p is string => Boolean(p));
  };

  /**
   * The plan, as pins the device can draw.
   *
   * A GPX of `<trkpt>`s is a line and nothing else: the stops the rider chose
   * and the sights he ticked exist only on this screen until they are written
   * as `<wpt>`. `resolvedPlaces` is what the API actually routed through, in
   * riding order — start, vias, and on a one-way ride the destination — so it
   * is the honest source for the flags rather than the plan's typed names,
   * which may be a case form or a place the geocoder read differently.
   *
   * Ticked sights are appended from `spliced.applied`, which is ordered by
   * where each detour leaves the ride, so they land in ride order rather than
   * in the order the boxes were pressed. They are matched back to
   * `selectedPois` for the name, the coordinates and the kind — the detour
   * itself carries only a `poiId`. A sight that has not finished routing has
   * no detour yet and is deliberately left out: it is not in the line inside
   * the file either, and a pin for a place the track does not visit is the
   * one thing worse than no pin.
   */
  const gpxWaypoints = () => {
    const places = resolvedPlaces ?? [];
    const byId = new Map(selectedPois.map((p) => [p.id, p]));
    const sights = (spliced?.applied ?? [])
      .map((d) => byId.get(d.poiId))
      .filter((p): p is SelectedPoi => Boolean(p))
      .map((p) => ({ name: p.name, lat: p.lat, lon: p.lon, kind: p.category }));
    // A round trip has no finish of its own, so the last resolved place is an
    // ordinary stop rather than a red flag. `plan.returnToStart` is nullable
    // and only `true` is a loop (CLAUDE.md) — an unanswered plan must not be
    // read as one, so the geometry answers instead: a ride whose line ends
    // within 100 m of where it started came back, whatever the plan says. A
    // shared or saved ride reopened without a plan is exactly that case.
    const line = route.geometry.coordinates;
    const first = line[0];
    const last = line[line.length - 1];
    const closed = Boolean(first && last)
      && Math.hypot((last[0] - first[0]) * Math.cos((first[1] * Math.PI) / 180), last[1] - first[1]) * 111_320 < 100;
    const loop = plan?.returnToStart === true || (plan?.returnToStart !== false && closed);
    // The sights sit between the last stop and the finish: they are places on
    // the way, not the end of the ride.
    const end = !loop && places.length >= 2 ? places.slice(-1) : [];
    const middle = end.length ? places.slice(0, -1) : places;
    return rideWaypoints({ places: [...middle, ...sights, ...end], returnToStart: loop, locale });
  };

  // What the file is, in one paragraph: the request, the result, the surface.
  const gpxDescription = () => {
    // `mix`, not `m`: the messages object is already called that here.
    const mix = route.roadMix;
    return [
      plan ? planSummary(plan, locale) : "",
      // The spliced figures, so the file describes the track inside it.
      `${Math.round(shownDistanceMeters / 1000)} km · ${duration(shownDurationSeconds)} · ${shownUnpaved} % ${m.resGravelShort} · ${shownRepeatedPercent} % ${m.resRepeated.toLowerCase()}`,
      spliced && spliced.applied.length > 0 ? fi(m.resWithSights, { n: spliced.applied.length }) : "",
      `${m.resRoadsLabel}: ${mix.roadKm} km, ${mix.trackKm} km ${m.legendTrack.toLowerCase()}, ${mix.trailKm} km ${m.legendTrail.toLowerCase()}`,
      `${variantLabels(m)[route.variant]?.label ?? route.variant} · Mopik (mopik.eu)`,
      m.resGpxFooter,
    ].filter(Boolean).join("\n");
  };

  // Saving keeps the ride on this device as the same self-contained code the
  // share link uses, so it can be reopened and exported with no server.
  const startLabel = route.stops?.[0]?.name ?? plan?.startPlace ?? "";
  // savedTick is read so the value recomputes after a save; localStorage is
  // not reactive on its own.
  const saved = savedTick >= 0 && isSaved(route, startLabel, plan, resolvedPlaces);
  const toggleSave = () => {
    if (saved) {
      removeRide(rideId(encodeRouteShare(route, startLabel, plan, resolvedPlaces)));
      track("ride_unsaved");
    } else {
      // The three the rider is looking at, not the API's original picks: a
      // card that has been swapped shows a different ride, and "citas
      // versijas" in the saved list must match what was on screen.
      saveRide(route, startLabel, plan, { alternatives: routes.map(shownFor), prompt: plan ? planSummary(plan, locale) : route.sourcePrompt, places: resolvedPlaces });
      track("ride_saved", { km: Math.round(route.distanceMeters / 1000), variant: route.variant });
    }
    setSavedTick((n) => n + 1);
  };

  // What Mopik could not do for this ride, as opposed to what the ride is
  // like to ride: the rider removed the riding-quality warning list (trails,
  // unverified access, rough track, unknown surface) because the map's own
  // badges and the ROADS / SURFACE numbers already say all of it. These two
  // are not about the roads at all — they are limits of the tool — so they
  // stay.
  const notices: string[] = [];
  // Outside the Baltics the ride and its numbers are real; what is missing is
  // the named stops. Better said plainly than discovered as an empty list.
  if (sparsePlaceData) notices.push(m.resSparse);
  // Long rides need Mopik's own router. Without it the ride is stitched from
  // shorter sections, which is worth saying plainly rather than letting the
  // rider wonder why a long route looks less considered than a short one.
  if (assembledFromSegments) notices.push(m.resAssembled);

  const submit = () => {
    if (!text.trim() || busy) return;
    onSend(text.trim());
    setText("");
  };

  return (
    <section className="flex flex-col overflow-hidden rounded-2xl border border-stone-200 bg-white md:h-[calc(100vh-7rem)]" aria-label={m.resResult}>
      <div className="flex items-start justify-between gap-3 border-b border-stone-200 bg-[#faf9f6] px-4 py-3">
        <div className="min-w-0">
          <div className="text-[10px] font-semibold uppercase tracking-[0.2em] text-[#bd4b00]">{m.resRoute}</div>
          {plan && <p className="mt-0.5 line-clamp-2 text-[11px] leading-relaxed text-stone-500">{planSummary(plan, locale)}</p>}
        </div>
        {/* Icon only: a left arrow already means "back to the form". */}
        <button type="button" onClick={onBackToForm} disabled={busy} aria-label={t(locale, "backToForm")} title={t(locale, "backToForm")} className="inline-flex size-8 shrink-0 items-center justify-center rounded-full text-stone-500 transition hover:bg-stone-100 hover:text-stone-900 disabled:opacity-40"><ArrowLeft className="size-4" /></button>
      </div>

      <div className="flex-1 space-y-3 overflow-y-auto p-3 md:p-4">
        {lucky && (
          <p className="rounded-xl bg-[#fff3ea] px-3 py-2 text-xs leading-relaxed text-[#8a3a00]">
            <span className="font-semibold">{m.resLucky}</span> {m.resLuckyDetail}
          </p>
        )}
        {(timeVerdict || timeActions.length > 0) && (
          <div className={`rounded-xl px-3 py-2 text-xs leading-relaxed ${timeVerdict ? "bg-amber-50 text-amber-950" : "bg-[#faf9f6] text-stone-700"}`}>
            {timeVerdict && <p className="font-semibold">{timeVerdict}</p>}
            {timeActions.length > 0 && (
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {timeActions.map((a) => (
                  <button key={a.label} type="button" disabled={busy} onClick={() => onSend(a.message)} className="rounded-full border border-[#f56300] bg-white px-3 py-1.5 text-[11px] font-medium text-[#bd4b00] transition hover:bg-[#fff3ea] disabled:opacity-50">{a.label}</button>
                ))}
              </div>
            )}
          </div>
        )}
        {map && <div className="md:hidden">{map}</div>}
        {/* Not once the ride is edited: the edit is a correction of the one
            version on screen, and the others were never corrected — a tab
            that switched to one would silently drop the rider's edit. Undo
            back to the search's own ride brings them back. */}
        {routes.length > 1 && !override && (
          <div role="tablist" aria-label={m.resVersions} className="grid gap-1.5" style={{ gridTemplateColumns: `repeat(${routes.length}, minmax(0, 1fr))` }}>
            {routes.map((card, index) => {
              const active = index === selected;
              const meta = variantLabels(m)[card.variant] ?? { label: fi(m.resVersionN, { n: index + 1 }), detail: "" };
              // The card keeps its name and shows whichever ride of that kind
              // is currently chosen — the names are the three the product
              // promises, never invented ones like "Gluda 2".
              const family = familyOf(card.variant);
              const at = (offset[card.variant] ?? 0) % Math.max(1, family.length);
              const r = family[at] ?? card;
              return (
                <div key={card.variant} className={`min-w-0 rounded-xl border transition ${active ? "border-stone-900 bg-stone-900 text-white" : "border-stone-200 bg-[#faf9f6] text-stone-700 hover:border-stone-300"}`}>
                  <button role="tab" type="button" aria-selected={active} onClick={() => { track("route_version_selected", { variant: card.variant, km: Math.round(r.distanceMeters / 1000) }); onSelect(index); }}
                    className="block w-full min-w-0 px-2.5 pt-2 text-left">
                    <div className="truncate text-xs font-semibold">{meta.label}</div>
                    <div className={`truncate text-[10px] ${active ? "text-stone-300" : "text-stone-500"}`}>{meta.detail}</div>
                    <div className="mt-1 truncate text-xs font-semibold tabular-nums">{Math.round(r.distanceMeters / 1000)} km</div>
                    <div className={`truncate text-[10px] tabular-nums ${active ? "text-stone-300" : "text-stone-500"}`}><span className={requestedMinutes !== null && r.durationSeconds / 60 > requestedMinutes + (isMaximum ? 0 : freeMinutes) ? (active ? "text-amber-300" : "text-amber-700") : ""}>{duration(r.durationSeconds)}</span> · {unpaved(r)} % {m.resGravelPct}</div>
                  </button>
                  {/* Only where another ride of this kind exists. On request,
                      one at a time: the pool is not a list to browse, it is a
                      "not this one, then" for the card in front of you. */}
                  {family.length > 1 ? (
                    <button type="button"
                      onClick={() => {
                        const next = (at + 1) % family.length;
                        onOffsetChange({ ...offset, [card.variant]: next });
                        onSelect(index);
                        track("alternative_cycled", { variant: card.variant, to: next });
                      }}
                      className={`mt-1.5 flex w-full items-center justify-center gap-1 rounded-b-xl border-t px-2 py-2 text-[10px] font-semibold transition ${active ? "border-stone-700 bg-white/10 text-white hover:bg-white/20" : "border-stone-200 bg-white text-[#bd4b00] hover:bg-[#fff4ec]"}`}
                      aria-label={fi(m.resShowAnother, { kind: meta.label.toLowerCase(), at: at + 1, total: family.length })}>
                      <RefreshCw className="size-3" />{m.resAnother} · {at + 1}/{family.length}
                    </button>
                  ) : <div className="pb-2" />}
                </div>
              );
            })}
          </div>
        )}
        <div className="rounded-xl border border-stone-200 p-3">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              {/* The offer says what it is before it says where it goes. A
                  rider who taps "Rādi taisnāko ceļu" must never mistake a
                  car route for the ride Mopik plans. */}
              {directLeg && <div className="truncate text-[10px] font-semibold uppercase tracking-wider text-[#bd4b00]">{m.directLegKicker}</div>}
              {/* An edited ride says so before it says anything else, in the
                  same slot and the same voice the direct-road offer uses, and
                  with the retraced share recomputed on the edited line — the
                  one figure an edit can quietly make worse. The rule is
                  CLAUDE.md's: a ride Mopik searched for and a ride the rider
                  corrected are different claims, and the panel must never let
                  the second pass as the first. Only a hand edit earns it —
                  keeping ticked sights is accepting an offer Mopik made, not
                  correcting it. */}
              {/* After an edit: what the ride now is, as a small label, and the
                  one thing worth doing about it from here — the full search
                  through the same places. Undo is not here: it belongs to the
                  editor, where the change it takes back was made; to change
                  the ride again the rider presses "Labot". */}
              {!directLeg && edited && (
                <div className="mb-1 flex flex-wrap items-center gap-x-2 gap-y-1">
                  {edited.kind === "edit" && (
                    <span className="rounded-full bg-[#fff3ea] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-[#bd4b00]" title={m.resEditedHint}>
                      {fi(m.resEditedKicker, { pct: shownRepeatedPercent })}
                    </span>
                  )}
                  {onSearchBetterLoop && (
                    <button type="button" onClick={onSearchBetterLoop} disabled={busy || rerouting} title={m.resSearchBetterHint}
                      className="text-[11px] font-semibold text-[#bd4b00] hover:underline disabled:opacity-40">
                      {m.resSearchBetterLink}
                    </button>
                  )}
                </div>
              )}
              <div className="truncate text-sm font-semibold text-stone-900">{directLeg ? m.directLegTitle : route.name}</div>
              {directLeg
                ? <div className="truncate text-[11px] text-stone-500">{route.name}</div>
                : route.stops && route.stops.length > 0 && <div className="truncate text-[11px] text-stone-500">{route.stops.map((s) => s.name).join(" · ")}</div>}
            </div>
            {route.tet && <span className="shrink-0 rounded-full border border-[#f5630040] px-2 py-0.5 text-[10px] font-semibold text-[#f56300]" title={fi(m.resTetApprox, { km: route.tet.sliceKm })}>TET</span>}
          </div>
          {/* The headline numbers describe the line on the map, so when sights
              are spliced in they are the spliced ride's. The "≈" is not
              decoration: the distance is exact (it is a routed line) but the
              time is the ride's own average applied to the few hundred metres
              each detour replaces, so the total is close rather than measured.
              Saying so is cheaper than pretending, and the original numbers are
              one untick away.

              Repeated % follows the line: the API's figure while a tick is
              only a preview, the recomputed one once the rider has kept it or
              moved a stop. See `shownRepeatedPercent` for why that distinction
              is the honest one rather than a convenience.

              Sized to their content and never wrapped: in equal thirds an
              edited ride's "≈ 1 h 17 min" broke onto two lines at 375 px,
              the "min" alone under the number. The time is the widest of
              the three, so it takes the room the other two do not need, and
              the figures step down a size on the narrowest phones. */}
          <div className="mt-2 flex justify-between gap-3 max-[359px]:gap-2">
            <div><div className="text-[10px] uppercase tracking-wider text-stone-400">{m.resDistance}</div><div className="whitespace-nowrap text-lg font-semibold tabular-nums max-[359px]:text-[15px]">{spliced || edited ? m.resApprox : ""}{Math.round(shownDistanceMeters / 1000)} km</div></div>
            <div><div className="text-[10px] uppercase tracking-wider text-stone-400">{m.resTime}</div><div className="whitespace-nowrap text-lg font-semibold tabular-nums max-[359px]:text-[15px]">{spliced || edited ? m.resApprox : ""}{duration(shownDurationSeconds)}</div></div>
            <div><div className="text-[10px] uppercase tracking-wider text-stone-400">{m.resRepeated}</div><div className="whitespace-nowrap text-lg font-semibold tabular-nums max-[359px]:text-[15px]" style={{ color: shownRepeatedPercent > 15 ? "#ff3b30" : undefined }}>{shownRepeatedPercent} %</div></div>
          </div>
          {/* A stretch being re-routed, and whatever the last edit had to say.
              Both are transient and both answer a gesture the rider just made,
              so they sit with the numbers that gesture changed rather than on
              the map itself, where a card would cover the line. */}
          {rerouting && (
            <p role="status" className="mt-2 flex items-center gap-1.5 text-[11px] text-stone-500">
              <LoaderCircle className="size-3 animate-spin" />{m.resEditRouting}
            </p>
          )}
          {editNote && !rerouting && (
            <p role="status" className="mt-2 text-[11px] leading-snug text-[#bd4b00]">{editNote}</p>
          )}
          {/* Said out loud, under the numbers the rider is reading: this is
              the road, and the way to get a ride is to add a stop. */}
          {directLeg && (
            <p className="mt-2 rounded-lg border border-[#f5630040] bg-[#fff4ec] px-3 py-2 text-[11px] text-stone-700">{m.directLegNote}</p>
          )}
          {spliced && spliced.applied.length > 0 && (
            <p className="mt-1 text-[11px] text-stone-500">
              {fi(m.resWithSights, { n: spliced.applied.length })}
              {" · "}
              {fi(m.resDetourDelta, {
                km: (Math.round(spliced.addedMeters / 100) / 10).toFixed(1),
                min: Math.max(0, Math.round(spliced.addedSeconds / 60)),
              })}
            </p>
          )}
          {shared === "copied" && (
            <p role="status" className="mopik-fade-in mt-2 rounded-lg bg-stone-900 px-3 py-2 text-xs text-white">{m.resLinkCopied}</p>
          )}
          {remoteLoop && (
            <p className="mt-2 text-[11px] leading-relaxed text-stone-500">
              {fi(m.resTransitOut, { km: remoteLoop.transitOutKm, time: duration(remoteLoop.transitOutMinutes * 60) })} → <span className="font-semibold text-stone-700">{fi(m.resFocusLoop, { place: remoteLoop.focus.label.split(",")[0], km: remoteLoop.loops[selected]?.km ?? "–", time: duration((remoteLoop.loops[selected]?.minutes ?? 0) * 60) })}</span> → {fi(m.resTransitBack, { km: remoteLoop.transitBackKm, time: duration(remoteLoop.transitBackMinutes * 60) })}
            </p>
          )}
          {/* GPX is the one thing every rider presses, so it gets its own full
              width: four buttons on one row wrapped its label onto two lines. */}
          <button type="button" onClick={downloadGpx} className="mt-3 flex h-11 w-full items-center justify-center gap-2 rounded-full bg-[#f56300] text-sm font-semibold text-white transition hover:bg-[#d85600]"><Download className="size-4" />{m.resDownloadGpx}</button>
          <RouteActionRow saved={saved} onToggleSave={toggleSave} onShare={shareRoute} copied={shared === "copied"} onEdit={onEdit} />
        </div>



        {/* "Detaļas": a collapsible row between the action row and
            "Apskates vietas", shaped like the latter — the rider's order. */}
        <DetailsCard open={details} onToggle={() => setDetails(!details)}>
        {notices.length > 0 && (
          <ul className="space-y-1 rounded-xl bg-amber-50 px-3 py-2 text-[11px] leading-relaxed text-amber-900">
            {notices.map((w) => <li key={w}>{w}</li>)}
          </ul>
        )}

        {(
          <div className="space-y-3">
            <div>
              <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-stone-400">{m.resRoadsHeading}</div>
              <Row label={m.resMixRoad} value={`${route.roadMix.roadKm} km · ${route.roadMix.roadPercent} %`} />
              <Row label={m.resMixTrack} value={`${route.roadMix.trackKm} km · ${route.roadMix.trackPercent} %`} />
              <Row label={m.resMixTrail} value={`${route.roadMix.trailKm} km · ${route.roadMix.trailPercent} %`} icon="🔥" />
            </div>
            {/* Its own section, not a fourth ROADS row: road/track/trail is a
                strict partition that sums to 100 %, and unverified access is
                an orthogonal flag — the same kilometres are already counted in
                one of the three above. As a fourth row that double-counted,
                which is why it used to carry no percentage; under a heading of
                its own it is plainly a different measurement, so the share of
                the ride is worth saying, on the same denominator as ROADS. */}
            {(q.unverifiedPathKm > 0 || (q.gateCount ?? 0) > 0) && (
              <div>
                <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-stone-400">{m.resRisksHeading}</div>
                {q.unverifiedPathKm > 0 && (
                  <Row label={m.badgeUnverified} value={`${q.unverifiedPathKm} km · ${unverifiedPercent} %`} icon="⚠️" />
                )}
                {/* A COUNT, not kilometres, and not a percentage: a gate is a
                    point on the road. The old shape reported "0.7 km", which
                    was the length of the shape segment a gate happened to sit
                    on — a fact about BRouter's vertex spacing, not about the
                    ride. `gateCount` is `undefined` outside the published
                    countries, and `> 0` keeps that silent rather than
                    rendering "0": "not measured" must never read as "no
                    gates", which is the `sparsePlaceData` rule again. */}
                {(q.gateCount ?? 0) > 0 && (
                  <Row label={m.resGatesRow} value={`${q.gateCount}`} icon={GATE_ICON} />
                )}
              </div>
            )}
            <div>
              <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-stone-400">{m.resSurfaceHeading}</div>
              <Row label={m.legendAsphalt} value={`${surfaceKm(shownSurfaces.asphaltPercent)} km · ${shownSurfaces.asphaltPercent} %`} />
              <Row label={m.legendGravel} value={`${surfaceKm(shownSurfaces.gravelPercent)} km · ${shownSurfaces.gravelPercent} %`} />
              <Row label={m.resDirt} value={`${surfaceKm(shownSurfaces.dirtPercent)} km · ${shownSurfaces.dirtPercent} %`} />
              <Row label={m.resUnknown} value={`${surfaceKm(shownSurfaces.unknownPercent)} km · ${shownSurfaces.unknownPercent} %`} />
            </div>
            {/* Measured by the server on the line it returned, from data the
                client does not have — so not shown for an edited ride, where
                it would be describing a line that is gone. */}
            {!override && (q.forestKm > 0 || q.riversideKm > 0 || q.elevationGainM > 0) && (
              <div>
                <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-stone-400">{m.resNature}</div>
                <Row label={m.resForest} value={`${q.forestKm} km`} />
                <Row label={m.resRiverside} value={`${q.riversideKm} km`} />
                <Row label={m.resOpenCountry} value={`${q.ruralOpenKm} km`} />
                {q.elevationGainM > 0 && <Row label={m.resClimb} value={`${q.elevationGainM} m`} />}
              </div>
            )}
            <p className="text-[11px] text-stone-500">{m.resGpxNote}</p>
          </div>
        )}
        </DetailsCard>

        {/* Ieteikumi: its own block, below the route card and below Detaļas'
            own toggle — the rider's correction after seeing the first version.
            The route's facts stay the most important thing and stay inside
            Detaļas; what is worth stopping at is a separate, optional offer
            and now reads as one. */}
        <SuggestionsCard
          pois={pois}
          loading={poisLoading}
          failed={poisFailed}
          expanded={suggestOpen}
          onToggle={() => setSuggestOpen(!suggestOpen)}
          onShow={onShowPoi}
          selected={selectedPois}
          onToggleSelect={onToggleSelectPoi}
          onClearSelection={onClearSelectedPois}
          onCommit={onCommitSelection}
          onSearchBetter={onSearchBetterLoop}
          committable={Boolean(spliced && spliced.applied.length > 0)}
          viaCount={plan?.viaPlaces.length ?? 0}
          includedNames={plan?.viaPlaces ?? []}
          busy={busy}
          detours={detours}
          detoursLoading={detoursLoading}
          refusedIds={spliced?.refused.map((d) => d.poiId) ?? []}
        />

      </div>

      {/* No `border-t`: the scrolling content ends in a bordered card, so a
          rule right under it read as a double line with only the padding
          between them. The white ground already separates the two. */}
      <form onSubmit={(e) => { e.preventDefault(); submit(); }} className="bg-white px-3 pb-3 pt-1">
        <label htmlFor="ride-correction" className="mb-1.5 block px-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-stone-400">{m.resWhatToChange}</label>
        <div className="flex items-end gap-2 rounded-xl border border-stone-200 p-2 focus-within:border-[#f56300]">
          <textarea id="ride-correction" value={text} onChange={(e) => setText(e.target.value)} rows={1} maxLength={6000} disabled={busy}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); submit(); } }}
            placeholder={m.resChangePlaceholder}
            className="min-w-0 flex-1 resize-none bg-transparent px-2 py-1.5 text-base outline-none placeholder:text-stone-400 disabled:opacity-60 md:text-sm" />
          <button type="submit" disabled={busy || !text.trim()} aria-label={m.resSendCorrection} className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-[#f56300] text-white transition hover:bg-[#d85600] disabled:opacity-35">
            {busy ? <LoaderCircle className="size-5 animate-spin" /> : <ArrowUp className="size-5" />}
          </button>
        </div>
      </form>
      <BeerPopup open={beer} onClose={() => setBeer(false)} />
    </section>
  );
}
