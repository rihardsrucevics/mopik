"use client";

import { useState } from "react";
import { ChevronDown, ChevronUp, Download } from "lucide-react";
import { GeneratedRoute } from "@/lib/types";

/**
 * The result card that sits in the chat panel right above the input: version
 * tabs, the three numbers, Download GPX, and everything else folded away.
 * It first lived over the bottom of the map, which hid the map; the rider
 * asked for it here so the map stays clear and nothing needs scrolling.
 */

const VARIANT_LABELS: Record<string, string> = {
  direct: "Taisnākā",
  balanced: "Līkumotākā",
  complex: "Sarežģītākā",
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

export function RouteSheet({ routes, selected, onSelect, avoidTowns = false }: {
  routes: GeneratedRoute[];
  selected: number;
  onSelect: (index: number) => void;
  avoidTowns?: boolean;
}) {
  const [details, setDetails] = useState(false);
  const route = routes[Math.min(selected, routes.length - 1)];
  if (!route) return null;
  const q = route.quality;
  const unpaved = (r: GeneratedRoute) => r.surfaces.gravelPercent + r.surfaces.dirtPercent;

  const downloadGpx = async () => {
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
    a.click();
    URL.revokeObjectURL(url);
  };

  const warnings: string[] = [];
  if (route.overlap.repeatedPercent > 15) warnings.push(`${route.overlap.repeatedKm} km atkārto jau nobrauktus ceļus — čatā vari prasīt mazāk atkārtojumu.`);
  if (route.roadMix.trailKm > 0) warnings.push(`${route.roadMix.trailKm} km taku.`);
  if (q.unverifiedPathKm > 0) warnings.push(`${q.unverifiedPathKm} km pa takām ar nepārbaudītu motocikla piekļuvi — pārbaudi zīmes.`);
  if (q.roughTrackKm >= 1) warnings.push(`${q.roughTrackKm} km grūtu meža ceļu (grade 4–5 vai slikts segums).`);
  if (q.sandKm >= 0.5) warnings.push(`${q.sandKm} km smilšu.`);
  if (q.streetKm / (route.distanceMeters / 1000) > 0.15) warnings.push(`${q.streetKm} km pa ielām un pagalmiem.${avoidTowns ? " Šeit citu ceļu šādā garumā nav." : ""}`);
  if (route.surfaces.unknownPercent >= 15) warnings.push(`${route.surfaces.unknownPercent} % ceļu segums OSM nav zināms.`);

  return (
    <div className="rounded-2xl border border-stone-200 bg-[#faf9f6]">
      {routes.length > 1 && (
        <div role="tablist" aria-label="Maršruta versijas" className="grid gap-1 p-1.5" style={{ gridTemplateColumns: `repeat(${routes.length}, minmax(0, 1fr))` }}>
          {routes.map((r, index) => {
            const active = index === selected;
            return (
              <button key={r.id} role="tab" type="button" aria-selected={active} onClick={() => onSelect(index)}
                className={`min-w-0 rounded-xl px-2 py-1.5 text-left transition ${active ? "bg-stone-900 text-white" : "text-stone-600 hover:bg-stone-100"}`}>
                <div className="truncate text-[11px] font-semibold">{VARIANT_LABELS[r.variant] ?? `Versija ${index + 1}`}</div>
                <div className={`truncate text-[10px] tabular-nums ${active ? "text-stone-300" : "text-stone-500"}`}>{Math.round(r.distanceMeters / 1000)} km · {duration(r.durationSeconds)}<span className="hidden sm:inline"> · {unpaved(r)} %</span></div>
              </button>
            );
          })}
        </div>
      )}

      <div className="px-2.5 pb-2.5 pt-1">
        {/* One row: the numbers of the selected version, the download, the details toggle. */}
        <div className="flex items-center gap-2">
          <div className="min-w-0 flex-1 text-sm tabular-nums text-stone-900">
            <span className="font-semibold">{Math.round(route.distanceMeters / 1000)} km</span>
            <span className="text-stone-400"> · </span>{duration(route.durationSeconds)}
            <span className="text-stone-400"> · </span>
            <span style={{ color: route.overlap.repeatedPercent > 15 ? "#ff3b30" : undefined }}>{route.overlap.repeatedPercent} %<span className="hidden sm:inline"> atkārtoti</span><span className="sm:hidden"> atk.</span></span>
            {route.tet && <span className="ml-2 rounded-full border border-[#f5630040] px-1.5 py-px align-middle text-[9px] font-semibold text-[#f56300]" title={`Aptuveni ${route.tet.sliceKm} km pa TET`}>TET</span>}
          </div>
          <button type="button" onClick={downloadGpx} className="flex h-9 shrink-0 items-center justify-center gap-1.5 rounded-full bg-[#f56300] px-3.5 text-xs font-semibold text-white transition hover:bg-[#d85600]"><Download className="size-3.5" />GPX</button>
          <button type="button" onClick={() => setDetails(!details)} aria-expanded={details} aria-label="Detaļas" className="flex h-9 shrink-0 items-center gap-1 rounded-full border border-stone-200 px-2.5 text-xs font-medium text-stone-700 hover:bg-stone-50">
            {warnings.length > 0 && <span className="rounded-full bg-amber-100 px-1.5 text-[10px] font-semibold text-amber-900">{warnings.length}</span>}
            {details ? <ChevronDown className="size-3.5" /> : <ChevronUp className="size-3.5" />}
          </button>
        </div>

        {details && (
          <div className="mt-2.5 max-h-[32vh] space-y-3 overflow-y-auto border-t border-stone-200 pt-2.5">
            <div>
              <div className="text-sm font-semibold text-stone-900">{route.name}</div>
              {route.stops && route.stops.length > 0 && <div className="text-[11px] text-stone-500">{route.stops.map((s) => s.name).join(" · ")}</div>}
              {route.tet && <div className="text-[11px] text-stone-500">Aptuveni {route.tet.sliceKm} km pa TET.</div>}
            </div>
            {warnings.length > 0 && (
              <ul className="space-y-1 rounded-xl bg-amber-50 px-3 py-2 text-[11px] leading-relaxed text-amber-900">
                {warnings.map((w) => <li key={w}>⚠️ {w}</li>)}
                <li className="pt-1 text-amber-800/80">Vienmēr ievēro ceļa zīmes un vietējos ierobežojumus.</li>
              </ul>
            )}
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
            <p className="text-[11px] text-stone-500">GPX der OsmAnd, Garmin, DMD2, Locus, Kurviger. Maršruts veidots no pieejamiem kartes un piekļuves datiem.</p>
          </div>
        )}
      </div>
    </div>
  );
}
