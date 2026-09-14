"use client";

import { useCallback, useEffect, useState } from "react";
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
  // Which card is asking "Izdzēst?" right now — one id, never a set, because
  // two cards mid-confirmation is two ways to lose a ride at once. Setting it
  // to another id is what closes the previous card's pill.
  const [confirming, setConfirming] = useState<string | null>(null);

  // The timer belongs to the state that owns it, and to nothing else: one
  // effect keyed on `confirming` arms a timeout when a card opens and clears
  // that same timeout in its own cleanup. React runs the cleanup whenever
  // `confirming` changes again (second tap, Escape, a tap outside, another
  // card) and once more on unmount, so the id is held in the effect's closure
  // rather than in a ref and a pending timer can never outlive the component.
  useEffect(() => {
    if (!confirming) return;
    const t = setTimeout(() => setConfirming(null), 4000);
    return () => clearTimeout(t);
  }, [confirming]);

  // The ways out that are not the pill itself. Both listeners exist only while
  // a card is confirming, so the idle page carries no document handlers. The
  // pointerdown handler stops at the pill via `data-confirm-pill` — without it
  // the tap that should delete would first close the pill underneath the
  // finger, and the click would land on nothing.
  useEffect(() => {
    if (!confirming) return;
    const onPointerDown = (e: PointerEvent) => {
      if (!(e.target instanceof Element) || !e.target.closest("[data-confirm-pill]")) setConfirming(null);
    };
    const onKeyDown = (e: KeyboardEvent) => { if (e.key === "Escape") setConfirming(null); };
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [confirming]);

  const confirmDelete = useCallback((id: string) => {
    setConfirming(null);
    removeRide(id);
    track("saved_ride_removed");
  }, []);

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
                  <div className="flex items-start justify-between gap-2">
                    {/* Plain text, not a link: the card's own "Apskatīt" button
                        goes to the same place, and two controls to one
                        destination is one too many.

                        The name and the variant chip share one flex-wrap row,
                        so the chip sits beside the title when there is room and
                        drops under it when the title is long. The alternative —
                        parking the chip next to the trash icon — was tried and
                        loses: "Pilsblīdene → Tukums via TET" at 390px then has
                        to truncate to leave the chip its width, and the rider
                        reads "Pilsblīdene → Tuk…". Wrapping costs a line only
                        on the long names, and never hides the name. */}
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                        <span className="min-w-0 max-w-full truncate text-sm font-semibold text-stone-900">{r.name}</span>
                        {/* The version this ride is, as the quiet outlined chip
                            the result panel puts beside a route's name. */}
                        <span className="shrink-0 rounded-full border border-[#f5630040] px-2 py-0.5 text-[10px] font-semibold text-[#f56300]">{variantLabel(m, r.variant)}</span>
                      </div>
                      <div className="truncate text-[11px] text-stone-500">
                        {r.from === "shared" ? m.savReceived : m.savSaved} {savedOn(r.savedAt, locale)}
                      </div>
                    </div>
                    {/* Delete is an icon in the corner, not a fourth pill: it is
                        the one action on this card a rider does not want to hit
                        by accident, so it stays out of the row their thumb
                        sweeps. The name lives only in the aria-label — the icon
                        carries no text. The 40x40 box is the tap target; the
                        negative margin keeps it from pushing the card's padding
                        around.

                        Two taps, because there is no undo: the rides live in
                        localStorage only. The first tap turns the icon into a
                        red text pill in the same corner, the second deletes;
                        tapping anywhere else, Escape, or four seconds of doubt
                        puts the icon back. Both states keep the ride's name in
                        the accessible name — "Dzēst Sigulda…" then "Izdzēst?
                        Dzēst Sigulda…" — so a screen reader never hears a bare
                        "Delete?" with nothing to say what is being deleted.
                        `data-confirm-pill` is what the outside-tap listener
                        looks for; without it the document handler would close
                        the pill before its own click landed. */}
                    {confirming === r.id ? (
                      <button type="button" data-confirm-pill autoFocus onClick={() => confirmDelete(r.id)}
                        aria-label={`${m.savDeleteConfirm} ${fi(m.savDeleteRide, { name: r.name })}`} title={fi(m.savDeleteRide, { name: r.name })}
                        className="-mr-1.5 -mt-1.5 flex h-10 shrink-0 items-center justify-center rounded-full bg-red-50 px-3 text-[13px] font-semibold text-red-700 transition hover:bg-red-100">
                        {m.savDeleteConfirm}
                      </button>
                    ) : (
                      <button type="button" data-confirm-pill onClick={() => setConfirming(r.id)} aria-label={fi(m.savDeleteRide, { name: r.name })} title={fi(m.savDeleteRide, { name: r.name })}
                        className="-mr-1.5 -mt-1.5 flex size-10 shrink-0 items-center justify-center rounded-full text-stone-500 transition hover:bg-red-50 hover:text-red-700">
                        <Trash2 className="size-[18px]" />
                      </button>
                    )}
                  </div>

                  <div className="mt-3 grid grid-cols-3 gap-2">
                    <div><div className="text-[10px] uppercase tracking-wider text-stone-400">{m.resDistance}</div><div className="text-lg font-semibold tabular-nums">{r.km} km</div></div>
                    <div><div className="text-[10px] uppercase tracking-wider text-stone-400">{m.resTime}</div><div className="text-lg font-semibold tabular-nums">{duration(r.minutes)}</div></div>
                    <div><div className="text-[10px] uppercase tracking-wider text-stone-400">{m.legendGravel}</div><div className="text-lg font-semibold tabular-nums">{r.unpavedPercent} %</div></div>
                  </div>

                  {summaryOf(r, locale) && <p className="mt-2 line-clamp-2 text-[11px] leading-relaxed text-stone-500">{summaryOf(r, locale)}</p>}

                  {/* One row of three equal outline buttons at every width — no
                      primary among them: on a list where every card is a ride
                      the rider already chose to keep, a filled button per card
                      turned the page into a column of orange. "Apskatīt" is
                      first because it is the most likely, not louder.

                      Three fit on one row where four did not. The labels are
                      one word each; the longest, "Lejupielādēt", is what sets
                      the width, so the phone step drops the icon gap and the
                      horizontal padding to nothing and lets the text truncate
                      rather than wrap — at 375px the three pills still read in
                      full. The type stays at 13px (`text-[13px]`), the floor
                      the rider set, instead of shrinking further.

                      A saved ride stores only its share code
                      (lib/share/saved-rides.ts), and /r/<code> is already the
                      result view — map, name, numbers, other versions, GPX —
                      so "view" is that link, not a rebuilt panel. */}
                  {/* Two columns when this ride carries no plan part and so has
                      no "Rediģēt" — older saves and some received links — so
                      the two remaining pills fill the row instead of leaving a
                      third of it empty. */}
                  <div className={`mt-3 grid gap-1.5 sm:gap-2 ${planPart(r.code) ? "grid-cols-3" : "grid-cols-2"}`}>
                    <Link href={`/r/${r.code}`} onClick={() => track("saved_ride_opened", { km: r.km })}
                      aria-label={`${m.savView}: ${r.name}`}
                      className="flex h-10 min-w-0 items-center justify-center gap-0.5 rounded-full border border-stone-200 px-0.5 text-[13px] font-medium text-stone-700 transition hover:bg-stone-50 sm:gap-1.5 sm:px-3">
                      <Map className="size-3.5 shrink-0" /><span className="truncate">{m.savView}</span>
                    </Link>
                    <button type="button" onClick={() => downloadGpx(r)} aria-label={fi(m.savDownloadRide, { name: r.name })}
                      className="flex h-10 min-w-0 items-center justify-center gap-0.5 rounded-full border border-stone-200 px-0.5 text-[13px] font-medium text-stone-700 transition hover:bg-stone-50 sm:gap-1.5 sm:px-3">
                      <Download className="size-3.5 shrink-0" /><span className="truncate">{m.savDownload}</span>
                    </button>
                    {/* Straight into the form, prefilled. Without it editing a
                        kept ride meant opening it and then finding the button
                        there — two hops for the thing a rider does most. */}
                    {planPart(r.code) && (
                      <Link href={`/?p=${planPart(r.code)}&from=${encodeURIComponent(r.code)}`} onClick={() => track("ride_edit_opened", { from: "saved", saved: true })}
                        aria-label={fi(m.savEditRide, { name: r.name })}
                        className="flex h-10 min-w-0 items-center justify-center gap-0.5 rounded-full border border-stone-200 px-0.5 text-[13px] font-medium text-stone-700 transition hover:bg-stone-50 sm:gap-1.5 sm:px-3">
                        <SlidersHorizontal className="size-3.5 shrink-0" /><span className="truncate">{m.savEdit}</span>
                      </Link>
                    )}
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
