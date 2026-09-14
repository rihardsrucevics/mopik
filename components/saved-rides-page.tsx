"use client";

import { useEffect, useState } from "react";
import { useLocale } from "@/lib/i18n/use-locale";
import { messages } from "@/lib/i18n/messages";
import type { UiLocale } from "@/lib/i18n/locale";
import { fi } from "@/lib/i18n/format";
import Link from "next/link";
import { Download, Map, Plus, Search, SlidersHorizontal, Trash2 } from "lucide-react";
import { SiteHeader } from "@/components/site-header";
import { track } from "@/lib/analytics";
import { listSaved, markSavedSeen, removeRide, decodeSaved, type SavedRide } from "@/lib/share/saved-rides";
import { decodePlanShare, planPart } from "@/lib/share/route-code";
import { planSummary } from "@/lib/chat/ride-plan";
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

/**
 * The request behind a saved ride, in the language being read right now.
 *
 * `saveRide` stores `prompt` as an already-rendered sentence, in whatever
 * language was active when the rider pressed Save — so a ride kept in English
 * kept saying "flexible duration · Hard · Sport" in a Latvian list. The plan
 * itself travels in the ride's own share code, so the sentence is rebuilt from
 * it at display time and follows the language picker like everything else.
 * The stored string is the fallback: rides saved before this, and any code
 * whose plan part will not decode, still read as they did.
 */
function summaryOf(ride: SavedRide, locale: UiLocale): string {
  const code = planPart(ride.code);
  if (code) {
    const plan = decodePlanShare(code);
    if (plan) return planSummary(plan, locale);
  }
  return ride.prompt ?? "";
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
    // The same shell as the main page and the shared route: one column width,
    // one set of gutters, one vertical rhythm. This page used to be max-w-3xl,
    // which made the whole layout jump when you arrived from the header.
    <main className="mx-auto min-h-screen w-full max-w-[1600px] px-4 py-5 md:px-7">
      <SiteHeader savedActive />
      {/* A reading column, not a full-bleed one: a row of three numbers and
          four buttons stretched over 1544px is unreadable. But it is centred
          inside the shell, not pinned to its left edge — the main page's own
          `max-w-[1600px]` centres everything once the window is wider than
          that, so a left-hugging list left a screen of empty space on the
          right while the header above it stayed centred. `mx-auto` keeps this
          column under the middle of the same header at every width. */}
      <div className="mx-auto max-w-[820px]">
        {/* The result panel's section label: small, uppercase, wide-tracked,
            the same burnt orange. It is what "a Mopik heading" looks like.
            It used to sit above an `<h2>` reading "Saglabātie maršruti" — the
            same words twice, one under the other. The label is the app's
            pattern, so it stays and takes the count; the heading below it now
            says what a rider cannot see at a glance, which is where these
            rides live (this device only). */}
        <div className="flex items-baseline gap-2">
          <h2 className="text-[10px] font-semibold uppercase tracking-[0.2em] text-[#bd4b00]">{m.savedRidesLong}</h2>
          <span className="text-[10px] font-semibold tabular-nums text-stone-400">({rides.length})</span>
        </div>
        <p className="mt-1 text-sm text-stone-500">{m.savDeviceNote}</p>

        {rides.length === 0 ? (
          // The app's informational box — the tinted, rounded panel the result
          // uses for "Lucky" and for its notes — rather than a dashed outline,
          // which read as a drop target for something the rider cannot drop.
          <div className="mt-4 rounded-2xl border border-stone-200 bg-[#faf9f6] p-5">
            <p className="text-sm leading-relaxed text-stone-700">
              {m.savNothingYet} <span className="font-semibold text-stone-900">{m.resSave}</span>.
            </p>
            <Link href="/" className="mt-3 inline-flex h-10 items-center justify-center gap-2 rounded-full bg-[#f56300] px-4 text-sm font-semibold text-white transition hover:bg-[#d85600]">
              <Plus className="size-4" />{m.savNewRide}
            </Link>
          </div>
        ) : (
          <>
            <div className="mt-4 flex flex-col gap-2 sm:flex-row">
              <label className="flex h-10 flex-1 items-center gap-2 rounded-xl border border-stone-200 bg-white px-3 focus-within:border-[#f56300]">
                <Search className="size-3.5 shrink-0 text-stone-400" />
                <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={m.savSearch} aria-label={m.savSearch}
                  className="min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-stone-400 md:text-sm" />
              </label>
              <div className="flex gap-1.5" role="group" aria-label={m.savSort}>
                {([["recent", m.savNewest], ["km", m.savLength], ["name", m.savName]] as const).map(([key, label]) => (
                  <button key={key} type="button" onClick={() => setSort(key)} aria-pressed={sort === key}
                    className={`h-10 rounded-xl border px-3 text-xs font-medium transition ${sort === key ? "border-stone-900 bg-stone-900 text-white" : "border-stone-200 bg-white text-stone-700 hover:bg-stone-50"}`}>
                    {label}
                  </button>
                ))}
              </div>
            </div>

            {/* One card per ride, built like the result panel's route card:
                white, rounded-2xl, stone-200 hairline; the name on top, the
                three numbers in the same three-up grid with their small
                uppercase captions, and the actions as the same pill row the
                result panel uses for Save / Share / Details. */}
            <ul className="mt-3 space-y-3">
              {visible.map((r) => (
                <li key={r.id} className="rounded-2xl border border-stone-200 bg-white p-4">
                  <div className="flex items-start justify-between gap-3">
                    {/* Plain text, not a link: the card's own "Apskatīt" button
                        goes to the same place, and two controls to one
                        destination is one too many. */}
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-semibold text-stone-900">{r.name}</div>
                      <div className="truncate text-[11px] text-stone-500">
                        {r.from === "shared" ? m.savReceived : m.savSaved} {savedOn(r.savedAt, locale)}
                      </div>
                    </div>
                    {/* The version this ride is, as the quiet outlined chip the
                        result panel puts beside a route's name. */}
                    <span className="shrink-0 rounded-full border border-[#f5630040] px-2 py-0.5 text-[10px] font-semibold text-[#f56300]">{variantLabel(m, r.variant)}</span>
                  </div>

                  <div className="mt-3 grid grid-cols-3 gap-2">
                    <div><div className="text-[10px] uppercase tracking-wider text-stone-400">{m.resDistance}</div><div className="text-lg font-semibold tabular-nums">{r.km} km</div></div>
                    <div><div className="text-[10px] uppercase tracking-wider text-stone-400">{m.resTime}</div><div className="text-lg font-semibold tabular-nums">{duration(r.minutes)}</div></div>
                    <div><div className="text-[10px] uppercase tracking-wider text-stone-400">{m.legendGravel}</div><div className="text-lg font-semibold tabular-nums">{r.unpavedPercent} %</div></div>
                  </div>

                  {summaryOf(r, locale) && <p className="mt-2 line-clamp-2 text-[11px] leading-relaxed text-stone-500">{summaryOf(r, locale)}</p>}

                  {/* One row, four equal outline buttons — no primary among
                      them: on a list where every card is a ride the rider
                      already chose to keep, a filled button per card turned
                      the page into a column of orange. "Apskatīt" is first
                      because it is the most likely, not louder.

                      Two columns on a phone, four from `sm` up: at 400px four
                      one-word pills do not fit, and shrinking the type to make
                      them fit is worse than a 2x2 block.

                      A saved ride stores only its share code
                      (lib/share/saved-rides.ts), and /r/<code> is already the
                      result view — map, name, numbers, other versions, GPX —
                      so "view" is that link, not a rebuilt panel. */}
                  <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
                    <Link href={`/r/${r.code}`} onClick={() => track("saved_ride_opened", { km: r.km })}
                      aria-label={`${m.savView}: ${r.name}`}
                      className="flex h-10 min-w-0 items-center justify-center gap-1 rounded-full border border-stone-200 text-xs font-medium text-stone-700 transition hover:bg-stone-50">
                      <Map className="size-3.5 shrink-0" />{m.savView}
                    </Link>
                    {/* Straight into the form, prefilled. Without it editing a
                        kept ride meant opening it and then finding the button
                        there — two hops for the thing a rider does most. */}
                    {planPart(r.code) && (
                      <Link href={`/?p=${planPart(r.code)}&from=${encodeURIComponent(r.code)}`} onClick={() => track("ride_edit_opened", { from: "saved", saved: true })}
                        aria-label={fi(m.savEditRide, { name: r.name })}
                        className="flex h-10 min-w-0 items-center justify-center gap-1 rounded-full border border-stone-200 text-xs font-medium text-stone-700 transition hover:bg-stone-50">
                        <SlidersHorizontal className="size-3.5 shrink-0" />{m.savEdit}
                      </Link>
                    )}
                    <button type="button" onClick={() => downloadGpx(r)} aria-label={fi(m.savDownloadRide, { name: r.name })}
                      className="flex h-10 min-w-0 items-center justify-center gap-1 rounded-full border border-stone-200 text-xs font-medium text-stone-700 transition hover:bg-stone-50">
                      <Download className="size-3.5 shrink-0" />{m.savDownload}
                    </button>
                    <button type="button" onClick={() => { removeRide(r.id); track("saved_ride_removed"); }} aria-label={fi(m.savDeleteRide, { name: r.name })}
                      className="flex h-10 min-w-0 items-center justify-center gap-1 rounded-full border border-stone-200 text-xs font-medium text-stone-500 transition hover:border-red-200 hover:bg-red-50 hover:text-red-700">
                      <Trash2 className="size-3.5 shrink-0" />{m.savDelete}
                    </button>
                  </div>

                  {/* The other versions of the same request, kept when the ride
                      was saved: switching to the straighter one costs nothing. */}
                  {r.alternatives && r.alternatives.length > 0 && (
                    <div className="mt-3 flex flex-wrap gap-1.5 border-t border-stone-100 pt-3">
                      <span className="self-center text-[10px] font-semibold uppercase tracking-wider text-stone-400">{m.savOtherVersions}</span>
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
            {visible.length === 0 && (
              <p className="mt-3 rounded-2xl border border-stone-200 bg-[#faf9f6] p-5 text-sm text-stone-600">{m.savNothingFound}</p>
            )}
          </>
        )}
      </div>
    </main>
  );
}
