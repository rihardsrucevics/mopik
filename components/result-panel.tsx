"use client";

import { useState, type ReactNode } from "react";
import { ArrowLeft, ArrowUp, ChevronDown, ChevronUp, Download, LoaderCircle, RefreshCw, Share2, Bookmark } from "lucide-react";
import { GeneratedRoute, GenerateRouteResponse } from "@/lib/types";
import { RidePlan, planSummary } from "@/lib/chat/ride-plan";
import { BeerPopup } from "@/components/beer-popup";
import { track } from "@/lib/analytics";
import { encodeRouteShare, shareUrl } from "@/lib/share/route-code";
import type { ResolvedPlace } from "@/lib/chat/places";
import { isSaved, removeRide, rideId, saveRide } from "@/lib/share/saved-rides";
import { gpxFilename } from "@/lib/gpx/filename";

/**
 * The left column once routes exist: what was asked, the three versions,
 * the selected one's numbers, Lejupielādēt GPX, warnings — and at the bottom an
 * input inviting a correction. Sending a correction hands the column over
 * to the chat until new routes arrive, then this view returns. No chat
 * history competes with the result.
 */

/**
 * Two categories, named by comparison rather than by superlative.
 *
 * "Taisnākā" claimed to be *the* straightest and was measured coming back
 * 43 km / 1 h 22 next to a "Līkumotākā" of 25 km / 1 h 8 — a label that lies.
 * "Ātrāks" only claims to be the quicker of the two, which it now is by
 * construction. `balanced` is kept for share codes made before the change.
 */
const VARIANT_LABELS: Record<string, { label: string; detail: string }> = {
  direct: { label: "Ātrāks", detail: "gludāk, mazāk pagriezienu" },
  balanced: { label: "Līdzsvarots", detail: "pa vidu" },
  complex: { label: "Sarežģītāks", detail: "mežs, takas, pagriezieni" },
};


function duration(seconds: number): string {
  const m = Math.round(seconds / 60);
  return m >= 60 ? `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60} min` : ""}` : `${m} min`;
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3 py-0.5 text-xs">
      <span className="text-stone-500">{label}</span>
      <span className="tabular-nums text-stone-900">{value}</span>
    </div>
  );
}

export function ResultPanel({ routes, selected, onSelect, plan, avoidTowns = false, lucky = false, remoteLoop, longerSuggestion, tolerancePercent = 20, busy, onSend, onBackToForm, resolvedPlaces, alternatives, offset, onOffsetChange, map, sparsePlaceData = false }: {
  routes: GeneratedRoute[];
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
}) {
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
  const [beer, setBeer] = useState(false);
  const [shared, setShared] = useState<"idle" | "copied">("idle");
  // Which ride is currently saved, by its code: derived during render rather
  // than mirrored into state, so switching versions needs no effect.
  const [savedTick, setSavedTick] = useState(0);
  const [text, setText] = useState("");
  // Everything below — the numbers, the GPX, the share code — reads the ride
  // the selected card is actually showing, not the API's original pick.
  const route = shownFor(routes[Math.min(selected, routes.length - 1)]);
  if (!route) return null;
  const q = route.quality;
  const unpaved = (r: GeneratedRoute) => r.surfaces.gravelPercent + r.surfaces.dirtPercent;

  const downloadGpx = async () => {
    // The thank-you opens in the click itself: on iOS Safari the download
    // sheet and the programmatic click after an await left a timer-driven
    // popup never showing. The file downloads underneath it.
    setBeer(true);
    track("gpx_downloaded", { variant: route.variant, km: Math.round(route.distanceMeters / 1000), minutes: Math.round(route.durationSeconds / 60), repeated: route.overlap.repeatedPercent, unpaved: unpaved(route) });
    try {
      const res = await fetch("/api/export-gpx", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: route.name, coordinates: route.geometry.coordinates, description: gpxDescription(), places: ridePlaces(), km: route.distanceMeters / 1000 }),
      });
      if (!res.ok) return;
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = gpxFilename({ places: ridePlaces(), name: route.name, km: route.distanceMeters / 1000 });
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
    ? `Prasīts ${isMaximum ? "līdz" : "~"}${requestedLabel}, šī versija ir ${duration(deliveredMinutes * 60)}.`
    : under
      // Say why. A bare "this one is only 1 h 22" reads as the app failing at
      // its one job; the real reason is that a longer ride here would have to
      // retrace roads, and not riding the same road twice is the thing this
      // product optimises. The rider can still ask for the longer one.
      ? `Prasīts ~${requestedLabel}, šī versija ir tikai ${duration(deliveredMinutes * 60)} — garākas trases šajā apvidū sāk atkārtot tos pašus ceļus.`
      : null;
  const timeActions: { label: string; message: string }[] = [];
  if (over && requestedMinutes) timeActions.push({ label: `Meklēt īsāku (līdz ${requestedLabel})`, message: `Īsāku — ne vairāk kā ${plan!.budget.value} stundas.` });
  if (under && requestedMinutes) timeActions.push({ label: `Meklēt garāku (~${requestedLabel})`, message: `Garāku — apmēram ${plan!.budget.value} stundas, var vairāk pieturu.` });
  if (longerSuggestion) timeActions.push({
    label: `Tīrāks aplis ~${duration(longerSuggestion.durationMinutes * 60)} (${longerSuggestion.repeatedPercent} % atkārtoti)`,
    message: `Apmēram ${Math.round(longerSuggestion.durationMinutes / 15) * 0.25} stundas, tas tīrākais aplis.`,
  });

  // One URL carries the whole route (lib/share/route-code.ts). On a phone the
  // system share sheet is the natural thing; on a desktop it is not (macOS
  // opens its own sheet, which nobody wants for a link), so there the link
  // goes to the clipboard with a visible confirmation.
  const shareRoute = async () => {
    const code = encodeRouteShare(route, route.stops?.[0]?.name ?? plan?.startPlace ?? "", plan, resolvedPlaces);
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
    catch { window.prompt("Kopē saiti:", url); }
  };

  // The places the ride actually visits, in order, for the filename.
  const ridePlaces = () => {
    if (!plan) return route.stops?.map((s) => s.name) ?? [];
    const end = plan.returnToStart ? plan.startPlace : plan.destinationPlace;
    return [plan.startPlace, plan.focusArea, ...plan.viaPlaces, end].filter((p): p is string => Boolean(p));
  };

  // What the file is, in one paragraph: the request, the result, the surface.
  const gpxDescription = () => {
    const m = route.roadMix;
    return [
      plan ? planSummary(plan, true) : "",
      `${Math.round(route.distanceMeters / 1000)} km · ${duration(route.durationSeconds)} · ${unpaved(route)} % grants un zemes ceļu · ${route.overlap.repeatedPercent} % atkārtoti`,
      `Ceļi: ${m.roadKm} km ceļš, ${m.trackKm} km meža ceļš, ${m.trailKm} km takas`,
      `${VARIANT_LABELS[route.variant]?.label ?? route.variant} versija · Mopik (mopik.eu) · laiks rēķināts pēc seguma`,
      "Maršruts veidots no OpenStreetMap datiem — vienmēr ievēro ceļa zīmes.",
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
      saveRide(route, startLabel, plan, { alternatives: routes.map(shownFor), prompt: plan ? planSummary(plan, true) : route.sourcePrompt, places: resolvedPlaces });
      track("ride_saved", { km: Math.round(route.distanceMeters / 1000), variant: route.variant });
    }
    setSavedTick((n) => n + 1);
  };

  const warnings: string[] = [];
  // Outside the Baltics the ride and its numbers are real; what is missing is
  // the named stops. Better said plainly than discovered as an empty list.
  if (sparsePlaceData) warnings.push("Ārpus Baltijas Mopik vēl nezina vietu nosaukumus — maršruts un skaitļi ir īsti, bet pieturas paliek nenosauktas.");
  if (route.overlap.repeatedPercent > 15) warnings.push(`${route.overlap.repeatedKm} km atkārto jau nobrauktus ceļus — vari prasīt mazāk atkārtojumu.`);
  if (route.roadMix.trailKm > 0) warnings.push(`${route.roadMix.trailKm} km taku.`);
  if (q.unverifiedPathKm > 0) warnings.push(`${q.unverifiedPathKm} km pa takām ar nepārbaudītu motocikla piekļuvi — pārbaudi zīmes.`);
  if (q.roughTrackKm >= 1) warnings.push(`${q.roughTrackKm} km grūtu meža ceļu (grade 4–5 vai slikts segums).`);
  if (q.sandKm >= 0.5) warnings.push(`${q.sandKm} km smilšu.`);
  if (q.streetKm / (route.distanceMeters / 1000) > 0.15) warnings.push(`${q.streetKm} km pa ielām un pagalmiem.${avoidTowns ? " Šeit citu ceļu šādā garumā nav." : ""}`);
  if (route.surfaces.unknownPercent >= 15) warnings.push(`${route.surfaces.unknownPercent} % ceļu segums OSM nav zināms.`);

  const submit = () => {
    if (!text.trim() || busy) return;
    onSend(text.trim());
    setText("");
  };

  return (
    <section className="flex flex-col overflow-hidden rounded-2xl border border-stone-200 bg-white md:h-[calc(100vh-7rem)]" aria-label="Maršruta rezultāts">
      <div className="flex items-start justify-between gap-3 border-b border-stone-200 bg-[#faf9f6] px-4 py-3">
        <div className="min-w-0">
          <div className="text-[10px] font-semibold uppercase tracking-[0.2em] text-[#bd4b00]">Maršruts</div>
          {plan && <p className="mt-0.5 line-clamp-2 text-[11px] leading-relaxed text-stone-500">{planSummary(plan, true)}</p>}
        </div>
        <button type="button" onClick={onBackToForm} disabled={busy} className="inline-flex shrink-0 items-center gap-1 text-xs text-stone-500 underline decoration-stone-300 underline-offset-4 disabled:opacity-40"><ArrowLeft className="size-3.5" />Forma</button>
      </div>

      <div className="flex-1 space-y-3 overflow-y-auto p-3 md:p-4">
        {lucky && (
          <p className="rounded-xl bg-[#fff3ea] px-3 py-2 text-xs leading-relaxed text-[#8a3a00]">
            <span className="font-semibold">Bez galamērķa un laika limita? Laimīgais!</span> Šī ir interesantākā trase, ko atradām — versijas zemāk, ja gribi citu.
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
        {routes.length > 1 && (
          <div role="tablist" aria-label="Maršruta versijas" className="grid gap-1.5" style={{ gridTemplateColumns: `repeat(${routes.length}, minmax(0, 1fr))` }}>
            {routes.map((card, index) => {
              const active = index === selected;
              const meta = VARIANT_LABELS[card.variant] ?? { label: `Versija ${index + 1}`, detail: "" };
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
                    <div className={`truncate text-[10px] tabular-nums ${active ? "text-stone-300" : "text-stone-500"}`}><span className={requestedMinutes !== null && r.durationSeconds / 60 > requestedMinutes + (isMaximum ? 0 : freeMinutes) ? (active ? "text-amber-300" : "text-amber-700") : ""}>{duration(r.durationSeconds)}</span> · {unpaved(r)} % grants</div>
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
                      aria-label={`Rādīt citu ${meta.label.toLowerCase()} maršrutu (${at + 1} no ${family.length})`}>
                      <RefreshCw className="size-3" />Cits · {at + 1}/{family.length}
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
              <div className="truncate text-sm font-semibold text-stone-900">{route.name}</div>
              {route.stops && route.stops.length > 0 && <div className="truncate text-[11px] text-stone-500">{route.stops.map((s) => s.name).join(" · ")}</div>}
            </div>
            {route.tet && <span className="shrink-0 rounded-full border border-[#f5630040] px-2 py-0.5 text-[10px] font-semibold text-[#f56300]" title={`Aptuveni ${route.tet.sliceKm} km pa TET`}>TET</span>}
          </div>
          <div className="mt-2 grid grid-cols-3 gap-2">
            <div><div className="text-[10px] uppercase tracking-wider text-stone-400">Distance</div><div className="text-lg font-semibold tabular-nums">{Math.round(route.distanceMeters / 1000)} km</div></div>
            <div><div className="text-[10px] uppercase tracking-wider text-stone-400">Laiks</div><div className="text-lg font-semibold tabular-nums">{duration(route.durationSeconds)}</div></div>
            <div><div className="text-[10px] uppercase tracking-wider text-stone-400">Atkārtoti</div><div className="text-lg font-semibold tabular-nums" style={{ color: route.overlap.repeatedPercent > 15 ? "#ff3b30" : undefined }}>{route.overlap.repeatedPercent} %</div></div>
          </div>
          {shared === "copied" && (
            <p role="status" className="mopik-fade-in mt-2 rounded-lg bg-stone-900 px-3 py-2 text-xs text-white">Saite nokopēta. Ielīmē WhatsApp, Telegram vai e-pastā — saņēmējs redzēs karti un skaitļus.</p>
          )}
          {remoteLoop && (
            <p className="mt-2 text-[11px] leading-relaxed text-stone-500">
              Pārbrauciens {remoteLoop.transitOutKm} km · {duration(remoteLoop.transitOutMinutes * 60)} → <span className="font-semibold text-stone-700">{remoteLoop.focus.label.split(",")[0]} aplis {remoteLoop.loops[selected]?.km ?? "–"} km · {duration((remoteLoop.loops[selected]?.minutes ?? 0) * 60)}</span> → atpakaļ {remoteLoop.transitBackKm} km · {duration(remoteLoop.transitBackMinutes * 60)}
            </p>
          )}
          {/* GPX is the one thing every rider presses, so it gets its own full
              width: four buttons on one row wrapped its label onto two lines. */}
          <button type="button" onClick={downloadGpx} className="mt-3 flex h-11 w-full items-center justify-center gap-2 rounded-full bg-[#f56300] text-sm font-semibold text-white transition hover:bg-[#d85600]"><Download className="size-4" />Lejupielādēt GPX</button>
          <div className="mt-2 grid grid-cols-3 gap-2">
            <button type="button" onClick={toggleSave} aria-label={saved ? "Noņemt no saglabātajiem" : "Saglabāt vēlākam"} aria-pressed={saved}
              className={`flex h-10 min-w-0 items-center justify-center gap-1 rounded-full border text-xs font-medium transition ${saved ? "border-[#f56300] bg-[#fff3ea] text-[#bd4b00]" : "border-stone-200 text-stone-700 hover:bg-stone-50"}`}>
              <Bookmark className={`size-3.5 ${saved ? "fill-current" : ""}`} />{saved ? "Saglabāts" : "Saglabāt"}
            </button>
            <button type="button" onClick={shareRoute} aria-label="Dalīties ar maršrutu" className="flex h-10 min-w-0 items-center justify-center gap-1 rounded-full border border-stone-200 text-xs font-medium text-stone-700 hover:bg-stone-50">
              <Share2 className="size-3.5" />{shared === "copied" ? "Nokopēts" : "Dalīties"}
            </button>
            <button type="button" onClick={() => setDetails(!details)} aria-expanded={details} className="flex h-10 min-w-0 items-center justify-center gap-1 rounded-full border border-stone-200 text-xs font-medium text-stone-700 hover:bg-stone-50">
              Detaļas{warnings.length > 0 && !details ? ` · ${warnings.length} ⚠️` : ""}{details ? <ChevronUp className="size-3.5" /> : <ChevronDown className="size-3.5" />}
            </button>
          </div>
        </div>



        {details && warnings.length > 0 && (
          <ul className="space-y-1 rounded-xl bg-amber-50 px-3 py-2 text-[11px] leading-relaxed text-amber-900">
            {warnings.map((w) => <li key={w}>⚠️ {w}</li>)}
          </ul>
        )}

        {details && (
          <div className="space-y-3 rounded-xl border border-stone-200 p-3">
            <div>
              <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-stone-400">Ceļi</div>
              <Row label="Road" value={`${route.roadMix.roadKm} km · ${route.roadMix.roadPercent} %`} />
              <Row label="Track / dashed" value={`${route.roadMix.trackKm} km · ${route.roadMix.trackPercent} %`} />
              <Row label="Trail / dotted" value={`${route.roadMix.trailKm} km · ${route.roadMix.trailPercent} %`} />
            </div>
            <div>
              <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-stone-400">Segums</div>
              <Row label="Asfalts" value={`${route.surfaces.asphaltPercent} %`} />
              <Row label="Grants" value={`${route.surfaces.gravelPercent} %`} />
              <Row label="Zeme / smiltis" value={`${route.surfaces.dirtPercent} %`} />
              <Row label="Nezināms" value={`${route.surfaces.unknownPercent} %`} />
            </div>
            {(q.forestKm > 0 || q.riversideKm > 0 || q.elevationGainM > 0) && (
              <div>
                <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-stone-400">Daba un ainava</div>
                <Row label="Meža apvidū" value={`${q.forestKm} km`} />
                <Row label="Upju tuvumā" value={`${q.riversideKm} km`} />
                <Row label="Atklātā lauku ainavā" value={`${q.ruralOpenKm} km`} />
                {q.elevationGainM > 0 && <Row label="Kopējais kāpums" value={`${q.elevationGainM} m`} />}
              </div>
            )}
            <p className="text-[11px] text-stone-500">GPX der OsmAnd, Garmin, DMD2, Locus, Kurviger. Maršruts veidots no pieejamiem kartes un piekļuves datiem — vienmēr ievēro ceļa zīmes.</p>
          </div>
        )}
      </div>

      {/* No `border-t`: the scrolling content ends in a bordered card, so a
          rule right under it read as a double line with only the padding
          between them. The white ground already separates the two. */}
      <form onSubmit={(e) => { e.preventDefault(); submit(); }} className="bg-white px-3 pb-3 pt-1">
        <label htmlFor="ride-correction" className="mb-1.5 block px-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-stone-400">Ko mainīt?</label>
        <div className="flex items-end gap-2 rounded-xl border border-stone-200 p-2 focus-within:border-[#f56300]">
          <textarea id="ride-correction" value={text} onChange={(e) => setText(e.target.value)} rows={1} maxLength={6000} disabled={busy}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); submit(); } }}
            placeholder="Piemēram: īsāku, vairāk pa mežu, caur Limbažiem…"
            className="min-w-0 flex-1 resize-none bg-transparent px-2 py-1.5 text-base outline-none placeholder:text-stone-400 disabled:opacity-60 md:text-sm" />
          <button type="submit" disabled={busy || !text.trim()} aria-label="Nosūtīt korekciju" className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-[#f56300] text-white transition hover:bg-[#d85600] disabled:opacity-35">
            {busy ? <LoaderCircle className="size-5 animate-spin" /> : <ArrowUp className="size-5" />}
          </button>
        </div>
      </form>
      <BeerPopup open={beer} onClose={() => setBeer(false)} />
    </section>
  );
}
