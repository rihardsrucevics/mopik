"use client";

import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { useLocale } from "@/lib/i18n/use-locale";
import { messages } from "@/lib/i18n/messages";
import { fi } from "@/lib/i18n/format";
import Link from "next/link";
import { Bookmark, ChevronDown, ChevronUp, Download, MessageCircle, SlidersHorizontal, Sparkles } from "lucide-react";
import { RouteMap } from "@/components/route-map";
import { MapPanel } from "@/components/map-panel";
import { SiteHeader } from "@/components/site-header";
import { track } from "@/lib/analytics";
import { sharedRouteSegments, type SharedRoute } from "@/lib/share/route-code";
import { isCodeSaved, removeRide, rideId, saveSharedRide } from "@/lib/share/saved-rides";
import { gpxFilename } from "@/lib/gpx/filename";

// A function of the language, not a constant: these labels are shown in
// four languages and a module-level object is built before one is known.
const variantLabel = (m: ReturnType<typeof messages>, variant: string): string =>
  ({ direct: m.resStraight, balanced: m.resWinding, complex: m.resComplex } as Record<string, string>)[variant] ?? variant;

/**
 * One line of the breakdown. `icon` is the map's own emoji for the same thing
 * — 🔥 for a trail, ⚠️ for unverified access — so the mark a rider read on the
 * map appears beside the number too. It follows the label, as in the result
 * panel: the labels end in a parenthetical and a leading mark pushed the words
 * off the column edge. aria-hidden: the label says it in words. The explicit
 * font-size keeps a colour emoji inside the 12 px row.
 */
function Row({ label, value, icon }: { label: string; value: string; icon?: string }) {
  return <div className="flex justify-between gap-3 py-0.5 text-xs"><span className="flex min-w-0 items-center gap-1 text-stone-500">{label}{icon && <span aria-hidden="true" className="shrink-0 text-[12px] leading-none">{icon}</span>}</span><span className="tabular-nums text-stone-900">{value}</span></div>;
}

function duration(minutes: number): string {
  return minutes >= 60 ? `${Math.floor(minutes / 60)} h${minutes % 60 ? ` ${minutes % 60} min` : ""}` : `${minutes} min`;
}

/**
 * A route someone shared: the same map and numbers the rider saw, a GPX
 * button, and the way into Mopik — generate a similar ride, or your own.
 */
export function SharedRouteView({ share, planCode, code }: { share: SharedRoute; planCode: string | null; code: string }) {
  const [locale] = useLocale();
  const m = messages(locale);
  const [showTet, setShowTet] = useState(false);
  const [details, setDetails] = useState(false);
  // Someone else's ride can be kept too: same store as one's own. localStorage
  // is not reactive and is unavailable while rendering on the server, so the
  // flag is read through useSyncExternalStore — no effect, no hydration gap.
  const saved = useSyncExternalStore(
    (onChange) => {
      window.addEventListener("mopik:saved-changed", onChange);
      return () => window.removeEventListener("mopik:saved-changed", onChange);
    },
    () => isCodeSaved(code),
    () => false,
  );
  const d = share.details;
  // The share code carries kilometres, not percentages, so the shares are
  // derived here on the denominator the result panel uses: road + track +
  // trail is the whole ride. RISKS uses the same one, which is what makes its
  // number comparable to the ROADS rows above it.
  const pct = (km: number) =>
    Math.round((km / (d ? d.roadKm + d.trackKm + d.trailKm || 1 : 1)) * 100);
  // The mirror of the result panel's `surfaceKm`: the share code carries the
  // four surface percentages and no per-surface kilometres, so the km are
  // derived on the ride's own length. The denominator here is road + track +
  // trail rather than `share.km`, because `share.km` is rounded to a whole
  // kilometre in the code while the three class figures keep a decimal — using
  // the finer one keeps these rows agreeing with the ROADS rows above them.
  const surfaceKm = (percent: number) =>
    Math.round((d ? d.roadKm + d.trackKm + d.trailKm : 0) * (percent / 100) * 10) / 10;
  // No warning list here either: the result panel's was removed, and this page
  // must show the same ride the rider shared. The ROADS / SURFACE numbers
  // below and the map's own badges carry it.
  const segments = useMemo(() => sharedRouteSegments(share), [share]);
  const start = { lat: share.points[0][1], lon: share.points[0][0] };
  useEffect(() => { track("shared_route_viewed", { km: share.km, variant: share.variant }); }, [share.km, share.variant]);

  const toggleSave = () => {
    if (saved) { removeRide(rideId(code)); track("shared_ride_unsaved"); }
    else { saveSharedRide(code, share); track("shared_ride_saved", { km: share.km }); }
  };

  const downloadGpx = async () => {
    track("shared_gpx_downloaded", { km: share.km, variant: share.variant });
    const res = await fetch("/api/export-gpx", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({
      name: share.name, coordinates: share.points, km: share.km, places: [share.startLabel],
      description: [`${share.name} · ${share.km} km · ${duration(share.minutes)} · ${share.unpavedPercent} % ${m.resGravelPct}`,
        fi(m.shGpxRepeated, { pct: share.repeatedPercent, place: share.startLabel }),
        m.shSharedNote].join("\n"),
    }) });
    if (!res.ok) return;
    const url = URL.createObjectURL(await res.blob());
    const a = document.createElement("a");
    a.href = url; a.download = gpxFilename({ places: [share.startLabel, share.startLabel], name: share.name, km: share.km }); a.rel = "noopener";
    document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 4000);
  };

  return (
    <main className="mx-auto min-h-screen w-full max-w-[1600px] px-4 py-5 md:px-7">
      {/* This page's call to action was a text link, "Uztaisīt savu". It is
          the same destination as the plus everywhere else, so it rides in the
          plus's slot and keeps its own wording for a screen reader. */}
      <SiteHeader newRideLabel={m.shMakeYourOwn} />
      <div className="grid items-start gap-5 md:grid-cols-[minmax(340px,460px)_1fr]">
        <section className="rounded-2xl border border-stone-200 bg-white p-4 md:p-5" aria-label={m.shSharedRoute}>
          <div className="text-[10px] font-semibold uppercase tracking-[0.2em] text-[#bd4b00]">{m.shSharedRoute} · {variantLabel(m, share.variant)}</div>
          <h2 className="mt-1 text-xl font-semibold tracking-tight">{share.name}</h2>
          <p className="mt-0.5 text-xs text-stone-500">{fi(m.shStartLabel, { place: share.startLabel })}</p>
          <div className="mt-4 grid grid-cols-3 gap-2">
            <div><div className="text-[10px] uppercase tracking-wider text-stone-400">{m.resDistance}</div><div className="text-lg font-semibold tabular-nums">{share.km} km</div></div>
            <div><div className="text-[10px] uppercase tracking-wider text-stone-400">{m.resTime}</div><div className="text-lg font-semibold tabular-nums">{duration(share.minutes)}</div></div>
            <div><div className="text-[10px] uppercase tracking-wider text-stone-400">{m.legendGravel}</div><div className="text-lg font-semibold tabular-nums">{share.unpavedPercent} %</div></div>
          </div>
          <p className="mt-2 text-[11px] text-stone-500">{fi(m.shRepeatedNote, { pct: share.repeatedPercent })}</p>
          <div className="mt-4 flex flex-col gap-2">
            <button type="button" onClick={downloadGpx} className="flex h-11 items-center justify-center gap-2 rounded-full bg-[#f56300] text-sm font-semibold text-white transition hover:bg-[#d85600]"><Download className="size-4" />{m.resDownloadGpx}</button>
            {planCode && (
              <Link href={`/?p=${planCode}`} className="flex h-11 items-center justify-center gap-2 rounded-full border border-stone-900 text-sm font-semibold text-stone-900 transition hover:bg-stone-900 hover:text-white"><Sparkles className="size-4" />{m.shGenerateSimilar}</Link>
            )}
            <button type="button" onClick={toggleSave} aria-pressed={saved}
              className={`flex h-11 items-center justify-center gap-2 rounded-full border text-sm font-semibold transition ${saved ? "border-[#f56300] bg-[#fff3ea] text-[#bd4b00]" : "border-stone-200 text-stone-700 hover:bg-stone-50"}`}>
              <Bookmark className={`size-4 ${saved ? "fill-current" : ""}`} />{saved ? m.shSavedInMine : m.shSaveForMe}
            </button>
            {/* Editing is the form first: the same fields that made the ride,
                filled in with it, so a rider changes a stop or the time
                without describing the whole ride again. The chat stays for
                what a form cannot say. `from` carries this ride's code, so
                the new one knows what it was made from. */}
            {planCode && (
              <Link href={`/?p=${planCode}&from=${encodeURIComponent(code)}`} onClick={() => track("ride_edit_opened", { from: "shared", saved })}
                className="flex h-11 items-center justify-center gap-2 rounded-full border border-stone-200 text-sm font-semibold text-stone-700 transition hover:bg-stone-50"><SlidersHorizontal className="size-4" />{m.saveEditForm}</Link>
            )}
            <div className="flex gap-2">
              {planCode && (
                <Link href={`/?p=${planCode}&mode=chat&from=${encodeURIComponent(code)}`} className="flex h-10 flex-1 items-center justify-center gap-1.5 rounded-full border border-stone-200 text-xs font-medium text-stone-700 transition hover:bg-stone-50"><MessageCircle className="size-3.5" />{m.chatAdjust}</Link>
              )}
              {d && (
                <button type="button" onClick={() => setDetails(!details)} aria-expanded={details} className="flex h-10 flex-1 items-center justify-center gap-1 rounded-full border border-stone-200 text-xs font-medium text-stone-700 hover:bg-stone-50">
                  {m.resDetails}{details ? <ChevronUp className="size-3.5" /> : <ChevronDown className="size-3.5" />}
                </button>
              )}
            </div>
          </div>
          {details && d && (
            <div className="mt-3 space-y-3 rounded-xl border border-stone-200 p-3">
              <div>
                <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-stone-400">{m.resRoadsHeading}</div>
                <Row label={m.resMixRoad} value={`${d.roadKm} km · ${pct(d.roadKm)} %`} /><Row label={m.resMixTrack} value={`${d.trackKm} km · ${pct(d.trackKm)} %`} /><Row label={m.resMixTrail} value={`${d.trailKm} km · ${pct(d.trailKm)} %`} icon="🔥" />
              </div>
              {/* Its own section, as in the result panel: road/track/trail is a
                  strict partition and these kilometres are already inside one
                  of those three, so as a fourth ROADS row they double-counted.
                  Under a heading of their own they are plainly a different
                  measurement, so the share of the ride is shown too. */}
              {d.unverifiedPathKm > 0 && (
                <div>
                  <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-stone-400">{m.resRisksHeading}</div>
                  <Row label={m.badgeUnverified} value={`${d.unverifiedPathKm} km · ${pct(d.unverifiedPathKm)} %`} icon="⚠️" />
                </div>
              )}
              <div>
                <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-stone-400">{m.resSurfaceHeading}</div>
                <Row label={m.legendAsphalt} value={`${surfaceKm(d.asphaltPercent)} km · ${d.asphaltPercent} %`} /><Row label={m.legendGravel} value={`${surfaceKm(d.gravelPercent)} km · ${d.gravelPercent} %`} /><Row label={m.resDirt} value={`${surfaceKm(d.dirtPercent)} km · ${d.dirtPercent} %`} /><Row label={m.resUnknown} value={`${surfaceKm(d.unknownPercent)} km · ${d.unknownPercent} %`} />
              </div>
              {(d.forestKm > 0 || d.riversideKm > 0 || d.elevationGainM > 0) && (
                <div>
                  <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-stone-400">{m.resNature}</div>
                  <Row label={m.resForest} value={`${d.forestKm} km`} /><Row label={m.resRiverside} value={`${d.riversideKm} km`} /><Row label={m.resOpenCountry} value={`${d.ruralOpenKm} km`} />
                  {d.elevationGainM > 0 && <Row label={m.resClimb} value={`${d.elevationGainM} m`} />}
                </div>
              )}
            </div>
          )}
          <p className="mt-4 text-[11px] leading-relaxed text-stone-500">{m.shIntro}</p>
        </section>
        <div className="order-first min-w-0 md:order-none">
          <MapPanel
            className="h-[46dvh] overflow-hidden rounded-2xl border border-stone-200 md:h-[calc(100vh-7rem)]"
            expandedClassName="md:relative md:inset-auto md:z-auto md:h-[calc(100vh-7rem)] md:overflow-hidden md:rounded-2xl md:border md:border-stone-200">
            <RouteMap segments={segments} start={start} destination={null} showTet={showTet} onToggleTet={setShowTet} />
          </MapPanel>
        </div>
      </div>
    </main>
  );
}
