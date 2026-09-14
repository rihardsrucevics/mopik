"use client";

import { useEffect, useState } from "react";
import { useLocale } from "@/lib/i18n/use-locale";
import { messages } from "@/lib/i18n/messages";
import type { UiLocale } from "@/lib/i18n/locale";
import { fi } from "@/lib/i18n/format";
import Link from "next/link";
import { ArrowLeft, Bookmark, Download, Plus, Search, SlidersHorizontal, Trash2 } from "lucide-react";
import { track } from "@/lib/analytics";
import { listSaved, markSavedSeen, removeRide, decodeSaved, type SavedRide } from "@/lib/share/saved-rides";
import { planPart } from "@/lib/share/route-code";
import { gpxFilename } from "@/lib/gpx/filename";

// A function of the language: the labels are shown in four, and a module
// constant is built before one is known.
const variantLabel = (m: ReturnType<typeof messages>, variant: string): string =>
  ({ direct: m.resStraight, balanced: m.resWinding, complex: m.resComplex } as Record<string, string>)[variant] ?? variant;
type SortKey = "recent" | "km" | "name";

function duration(minutes: number): string {
  return minutes >= 60 ? `${Math.floor(minutes / 60)} h${minutes % 60 ? ` ${minutes % 60} min` : ""}` : `${minutes} min`;
}
// The month is spelled out, so the date is as much a translated string as the
// labels around it: "14. septembris" in an Estonian list is Latvian text.
function savedOn(ms: number, locale: UiLocale): string {
  return new Date(ms).toLocaleDateString(locale, { day: "numeric", month: "long", year: "numeric" });
}

/** Every saved ride, with search, sorting and a direct GPX download. */
export function SavedRidesPage() {
  const [locale] = useLocale();
  const m = messages(locale);
  const [rides, setRides] = useState<SavedRide[]>([]);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SortKey>("recent");

  useEffect(() => {
    const sync = () => setRides(listSaved());
    sync();
    // Opening the list is what "seen" means, so the header's count clears
    // here and nowhere else.
    markSavedSeen();
    window.addEventListener("mopik:saved-changed", sync);
    return () => window.removeEventListener("mopik:saved-changed", sync);
  }, []);

  const visible = rides
    .filter((r) => r.name.toLowerCase().includes(query.trim().toLowerCase()))
    .sort((a, b) => (sort === "km" ? b.km - a.km : sort === "name" ? a.name.localeCompare(b.name, locale) : b.savedAt - a.savedAt));

  const downloadGpx = async (ride: SavedRide) => {
    const share = decodeSaved(ride);
    if (!share) return;
    track("saved_gpx_downloaded", { km: ride.km });
    const res = await fetch("/api/export-gpx", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: ride.name, coordinates: share.points, km: ride.km, places: share.startLabel ? [share.startLabel] : undefined,
        description: `${ride.name} · ${ride.km} km · ${duration(ride.minutes)} · ${ride.unpavedPercent} % ${m.resGravelPct}\n${m.savSaved} ${savedOn(ride.savedAt, locale)} · Mopik (mopik.eu)`,
      }),
    });
    if (!res.ok) return;
    const url = URL.createObjectURL(await res.blob());
    const a = document.createElement("a");
    a.href = url; a.download = gpxFilename({ places: share.startLabel ? [share.startLabel, share.startLabel] : [], name: ride.name, km: ride.km, date: new Date(ride.savedAt) }); a.rel = "noopener";
    document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 4000);
  };

  return (
    <main className="mx-auto min-h-screen w-full max-w-3xl px-4 py-5 md:px-7">
      <header className="mb-5 flex items-center justify-between border-b border-stone-200 pb-4">
        <h1 className="text-2xl font-bold tracking-tight"><Link href="/" aria-label={m.backToHome}>Mopik<span className="text-[#f56300]">.</span></Link></h1>
        <div className="flex items-center gap-4">
          <button type="button" onClick={() => (history.length > 1 ? history.back() : (window.location.href = "/"))}
            className="inline-flex items-center gap-1 text-xs text-stone-500 underline decoration-stone-300 underline-offset-4 hover:text-stone-900">
            <ArrowLeft className="size-3.5" />{m.savBack}
          </button>
          <Link href="/" className="inline-flex items-center gap-1 text-xs text-stone-500 underline decoration-stone-300 underline-offset-4 hover:text-stone-900"><Plus className="size-3.5" />{m.savNewRide}</Link>
        </div>
      </header>

      <div className="flex items-center gap-2">
        <Bookmark className="size-4 text-[#f56300]" />
        <h2 className="text-lg font-semibold tracking-tight">{m.savTitle}</h2>
        <span className="text-sm text-stone-400">({rides.length})</span>
      </div>

      {rides.length === 0 ? (
        <p className="mt-6 rounded-2xl border border-dashed border-stone-300 p-6 text-center text-sm text-stone-500">
          {m.savNothingYet} <span className="font-medium text-stone-700">{m.resSave}</span>.
        </p>
      ) : (
        <>
          <div className="mt-4 flex flex-col gap-2 sm:flex-row">
            <label className="flex h-10 flex-1 items-center gap-2 rounded-xl border border-stone-200 px-3 focus-within:border-[#f56300]">
              <Search className="size-3.5 shrink-0 text-stone-400" />
              <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={m.savSearch} aria-label={m.savSearch}
                className="min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-stone-400 md:text-sm" />
            </label>
            <div className="flex gap-1.5" role="group" aria-label={m.savSort}>
              {([["recent", m.savNewest], ["km", m.savLength], ["name", m.savName]] as const).map(([key, label]) => (
                <button key={key} type="button" onClick={() => setSort(key)} aria-pressed={sort === key}
                  className={`h-10 rounded-xl border px-3 text-xs font-medium transition ${sort === key ? "border-stone-900 bg-stone-900 text-white" : "border-stone-200 text-stone-700 hover:bg-stone-50"}`}>
                  {label}
                </button>
              ))}
            </div>
          </div>

          <ul className="mt-3 space-y-2">
            {visible.map((r) => (
              <li key={r.id} className="rounded-2xl border border-stone-200 bg-white p-3">
                <div className="flex items-center gap-3">
                <Link href={`/r/${r.code}`} onClick={() => track("saved_ride_opened", { km: r.km })} className="min-w-0 flex-1">
                  <div className="truncate text-sm font-semibold text-stone-900">{r.name}</div>
                  <div className="truncate text-[11px] tabular-nums text-stone-500">
                    {r.km} km · {duration(r.minutes)} · {r.unpavedPercent} % {m.resGravelPct} · {variantLabel(m, r.variant)}
                  </div>
                  <div className="truncate text-[10px] text-stone-400">{r.from === "shared" ? m.savReceived : m.savSaved} {savedOn(r.savedAt, locale)}</div>
                  {r.prompt && <div className="truncate text-[10px] text-stone-400">{r.prompt}</div>}
                </Link>
                {/* Straight into the form, prefilled. Without it editing a
                    kept ride meant opening it and then finding the button
                    there — two hops for the thing a rider does most. */}
                {planPart(r.code) && (
                  <Link href={`/?p=${planPart(r.code)}&from=${encodeURIComponent(r.code)}`} onClick={() => track("ride_edit_opened", { from: "saved", saved: true })}
                    aria-label={fi(m.savEditRide, { name: r.name })}
                    className="shrink-0 rounded-full border border-stone-200 p-2 text-stone-600 transition hover:bg-stone-50"><SlidersHorizontal className="size-4" /></Link>
                )}
                <button type="button" onClick={() => downloadGpx(r)} aria-label={fi(m.savDownloadRide, { name: r.name })}
                  className="shrink-0 rounded-full border border-stone-200 p-2 text-stone-600 transition hover:bg-stone-50"><Download className="size-4" /></button>
                <button type="button" onClick={() => { removeRide(r.id); track("saved_ride_removed"); }} aria-label={fi(m.savDeleteRide, { name: r.name })}
                  className="shrink-0 rounded-full p-2 text-stone-400 transition hover:bg-stone-100 hover:text-stone-700"><Trash2 className="size-4" /></button>
                </div>
                {/* The other versions of the same request, kept when the ride
                    was saved: switching to the straighter one costs nothing. */}
                {r.alternatives && r.alternatives.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1.5 border-t border-stone-100 pt-2">
                    <span className="self-center text-[10px] uppercase tracking-wider text-stone-400">{m.savOtherVersions}</span>
                    {r.alternatives.map((alt) => (
                      <Link key={`${r.id}-${alt.variant}`} href={`/r/${alt.code}`} onClick={() => track("saved_alternative_opened", { variant: alt.variant })}
                        className="rounded-full border border-stone-200 px-2.5 py-1 text-[11px] text-stone-700 transition hover:border-stone-300 hover:bg-stone-50">
                        {variantLabel(m, alt.variant)} · {alt.km} km
                      </Link>
                    ))}
                  </div>
                )}
              </li>
            ))}
          </ul>
          {visible.length === 0 && <p className="mt-4 text-center text-sm text-stone-500">{m.savNothingFound}</p>}
          <p className="mt-4 text-[11px] text-stone-400">{m.savDeviceNote}</p>
        </>
      )}
    </main>
  );
}
