"use client";

import { useState } from "react";
import { ArrowLeft, ArrowUp, ChevronDown, ChevronUp, Download, LoaderCircle, Share2 } from "lucide-react";
import { GeneratedRoute, GenerateRouteResponse } from "@/lib/types";
import { RidePlan, planSummary } from "@/lib/chat/ride-plan";
import { BeerPopup } from "@/components/beer-popup";
import { track } from "@/lib/analytics";
import { encodeRouteShare, shareUrl } from "@/lib/share/route-code";

/**
 * The left column once routes exist: what was asked, the three versions,
 * the selected one's numbers, Lejupielādēt GPX, warnings — and at the bottom an
 * input inviting a correction. Sending a correction hands the column over
 * to the chat until new routes arrive, then this view returns. No chat
 * history competes with the result.
 */

const VARIANT_LABELS: Record<string, { label: string; detail: string }> = {
  direct: { label: "Taisnākā", detail: "gludi un ātri" },
  balanced: { label: "Līkumotākā", detail: "līdzsvars" },
  complex: { label: "Sarežģītākā", detail: "mežs, pagriezieni, apkārtne" },
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

export function ResultPanel({ routes, selected, onSelect, plan, avoidTowns = false, lucky = false, remoteLoop, longerSuggestion, tolerancePercent = 20, busy, onSend, onBackToForm }: {
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
}) {
  const [details, setDetails] = useState(false);
  const [beer, setBeer] = useState(false);
  const [shared, setShared] = useState<"idle" | "copied">("idle");
  const [text, setText] = useState("");
  const route = routes[Math.min(selected, routes.length - 1)];
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
        body: JSON.stringify({ name: route.name, coordinates: route.geometry.coordinates }),
      });
      if (!res.ok) return;
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = route.name.toLowerCase().replace(/[^a-z0-9]+/g, "-") + ".gpx";
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
    : under ? `Prasīts ~${requestedLabel}, šī versija ir tikai ${duration(deliveredMinutes * 60)}.` : null;
  const timeActions: { label: string; message: string }[] = [];
  if (over && requestedMinutes) timeActions.push({ label: `Meklēt īsāku (līdz ${requestedLabel})`, message: `Īsāku — ne vairāk kā ${plan!.budget.value} stundas.` });
  if (under && requestedMinutes) timeActions.push({ label: `Meklēt garāku (~${requestedLabel})`, message: `Garāku — apmēram ${plan!.budget.value} stundas, var vairāk pieturu.` });
  if (longerSuggestion) timeActions.push({
    label: `Tīrāks aplis ~${duration(longerSuggestion.durationMinutes * 60)} (${longerSuggestion.repeatedPercent} % atkārtoti)`,
    message: `Apmēram ${Math.round(longerSuggestion.durationMinutes / 15) * 0.25} stundas, tas tīrākais aplis.`,
  });

  // One URL carries the whole route (lib/share/route-code.ts): the phone's
  // share sheet where there is one, the clipboard elsewhere.
  const shareRoute = async () => {
    const code = encodeRouteShare(route, route.stops?.[0]?.name ?? plan?.startPlace ?? "", plan);
    const url = shareUrl(code, window.location.origin);
    const title = `${route.name} · ${Math.round(route.distanceMeters / 1000)} km`;
    if (typeof navigator.share === "function") {
      try { await navigator.share({ title, url }); track("route_shared", { method: "share", km: Math.round(route.distanceMeters / 1000), variant: route.variant }); return; }
      catch { /* dismissed: fall through to copy */ }
    }
    try { await navigator.clipboard.writeText(url); setShared("copied"); setTimeout(() => setShared("idle"), 2200); track("route_shared", { method: "copy", km: Math.round(route.distanceMeters / 1000), variant: route.variant }); }
    catch { window.prompt("Kopē saiti:", url); }
  };

  const warnings: string[] = [];
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
        {routes.length > 1 && (
          <div role="tablist" aria-label="Maršruta versijas" className="grid gap-1.5" style={{ gridTemplateColumns: `repeat(${routes.length}, minmax(0, 1fr))` }}>
            {routes.map((r, index) => {
              const active = index === selected;
              const meta = VARIANT_LABELS[r.variant] ?? { label: `Versija ${index + 1}`, detail: "" };
              return (
                <button key={r.id} role="tab" type="button" aria-selected={active} onClick={() => { track("route_version_selected", { variant: r.variant, km: Math.round(r.distanceMeters / 1000) }); onSelect(index); }}
                  className={`min-w-0 rounded-xl border px-2.5 py-2 text-left transition ${active ? "border-stone-900 bg-stone-900 text-white" : "border-stone-200 bg-[#faf9f6] text-stone-700 hover:border-stone-300"}`}>
                  <div className="truncate text-xs font-semibold">{meta.label}</div>
                  <div className={`truncate text-[10px] ${active ? "text-stone-300" : "text-stone-500"}`}>{meta.detail}</div>
                  <div className="mt-1 truncate text-xs font-semibold tabular-nums">{Math.round(r.distanceMeters / 1000)} km</div>
                  <div className={`truncate text-[10px] tabular-nums ${active ? "text-stone-300" : "text-stone-500"}`}><span className={requestedMinutes !== null && r.durationSeconds / 60 > requestedMinutes + (isMaximum ? 0 : freeMinutes) ? (active ? "text-amber-300" : "text-amber-700") : ""}>{duration(r.durationSeconds)}</span> · {unpaved(r)} % grants</div>
                </button>
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
          {remoteLoop && (
            <p className="mt-2 text-[11px] leading-relaxed text-stone-500">
              Pārbrauciens {remoteLoop.transitOutKm} km · {duration(remoteLoop.transitOutMinutes * 60)} → <span className="font-semibold text-stone-700">{remoteLoop.focus.label.split(",")[0]} aplis {remoteLoop.loops[selected]?.km ?? "–"} km · {duration((remoteLoop.loops[selected]?.minutes ?? 0) * 60)}</span> → atpakaļ {remoteLoop.transitBackKm} km · {duration(remoteLoop.transitBackMinutes * 60)}
            </p>
          )}
          <div className="mt-3 flex items-center gap-2">
            <button type="button" onClick={downloadGpx} className="flex h-11 flex-1 items-center justify-center gap-2 rounded-full bg-[#f56300] text-sm font-semibold text-white transition hover:bg-[#d85600]"><Download className="size-4" />Lejupielādēt GPX</button>
            <button type="button" onClick={shareRoute} aria-label="Dalīties ar maršrutu" className="flex h-11 shrink-0 items-center gap-1 rounded-full border border-stone-200 px-3 text-xs font-medium text-stone-700 hover:bg-stone-50">
              <Share2 className="size-3.5" />{shared === "copied" ? "Nokopēts" : "Dalīties"}
            </button>
            <button type="button" onClick={() => setDetails(!details)} aria-expanded={details} className="flex h-11 shrink-0 items-center gap-1 rounded-full border border-stone-200 px-3 text-xs font-medium text-stone-700 hover:bg-stone-50">
              Detaļas{details ? <ChevronUp className="size-3.5" /> : <ChevronDown className="size-3.5" />}
            </button>
          </div>
        </div>

        {warnings.length > 0 && (
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

      <form onSubmit={(e) => { e.preventDefault(); submit(); }} className="border-t border-stone-200 bg-white p-3">
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
