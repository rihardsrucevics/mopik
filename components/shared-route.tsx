"use client";

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { useLocale } from "@/lib/i18n/use-locale";
import { messages } from "@/lib/i18n/messages";
import { fi } from "@/lib/i18n/format";
import { ArrowUp, Download } from "lucide-react";
import { RouteActionRow } from "@/components/action-row";
import { RouteMap } from "@/components/route-map";
import { POI_KIND, type RoutePoi, type RoutePois } from "@/lib/poi/kinds";
import { SuggestionsCard } from "@/components/suggestions-card";
import { MapPanel } from "@/components/map-panel";
import { SiteHeader } from "@/components/site-header";
import { track } from "@/lib/analytics";
import { decodePlanPlaces, encodePlanShare, sharedRouteSegments, type SharedRoute } from "@/lib/share/route-code";
import { isCodeSaved, removeRide, rideId, saveSharedRide } from "@/lib/share/saved-rides";
import { gpxFilename } from "@/lib/gpx/filename";
import { DESKTOP_QUERY } from "@/lib/use-media-query";

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
  const router = useRouter();
  const [showTet, setShowTet] = useState(false);
  const [details, setDetails] = useState(false);
  /**
   * The places this ride passes, loaded when the details are opened.
   *
   * The same Ieteikumi the result panel has, and — when the code carries a
   * plan — with the same three actions, Pievienot included. It was read-only
   * on the reasoning that "a shared ride has no plan to regenerate", which is
   * wrong for the page the rider actually spends his time on: /r/<code> is
   * where his own saved rides open, and he asked for this looking straight at
   * one. The plan travels in the code, so there is a ride to re-plan.
   *
   * Both groups are listed with their figures; nothing shows when the lookup
   * finds nothing, which is also what happens outside the Baltics.
   */
  const [pois, setPois] = useState<RoutePois | null>(null);
  const [poisLoading, setPoisLoading] = useState(false);
  // Its own expandable, exactly as on the planner: the route's facts belong to
  // Detaļas and the suggestions are a separate, optional offer. Sharing one
  // toggle would have made opening the numbers fetch a list nobody asked for.
  const [poisOpen, setPoisOpen] = useState(false);
  /**
   * The suggestion the rider pressed "Kartē" on. Same mechanism as the
   * planner's, and the same reason it lives beside the map rather than inside
   * the list: the map is what has to move. `token` rises per press so pressing
   * the same row twice flies back to it after a pan.
   */
  const [focusPoi, setFocusPoi] = useState<{ lat: number; lon: number; label: string; kind?: string; token: number } | null>(null);
  const focusTokenRef = useRef(0);
  const showPoi = (poi: RoutePoi) => {
    focusTokenRef.current += 1;
    const entry = POI_KIND[poi.category];
    track("suggestion_shown", { kind: poi.category });
    setFocusPoi({
      lat: poi.lat, lon: poi.lon, label: poi.name,
      kind: entry ? m[entry.key as keyof typeof m] ?? poi.category : poi.category,
      token: focusTokenRef.current,
    });
    // The map is the page's other column on a desktop and the block above the
    // card on a phone, where it can easily be scrolled past by the time the
    // rider reaches Ieteikumi. Deferred a frame so the flight has been
    // started by the render this press causes.
    if (window.matchMedia(DESKTOP_QUERY).matches) return;
    requestAnimationFrame(() => {
      document.querySelector("[data-map-slot]")?.scrollIntoView({ behavior: "smooth", block: "center" });
    });
  };
  const askedRef = useRef(false);
  const [copied, setCopied] = useState(false);
  // The correction box below the card, exactly as the result panel has it.
  const [text, setText] = useState("");
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

  // Asked once, when the rider opens the details — the same lazy rule the
  // result panel follows, for the same reason: most visitors never expand it.
  useEffect(() => {
    if (!poisOpen || askedRef.current || !share.points?.length) return;
    askedRef.current = true;
    setPoisLoading(true);
    const controller = new AbortController();
    fetch("/api/route-pois", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ geometry: { coordinates: share.points }, locale }),
      signal: controller.signal,
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((data: RoutePois | null) => {
        if (data) setPois({ onRoute: data.onRoute ?? [], nearby: data.nearby ?? [] });
      })
      .catch(() => {})
      .finally(() => setPoisLoading(false));
    return () => controller.abort();
  }, [poisOpen, share.points, locale]);
  const start = { lat: share.points[0][1], lon: share.points[0][0] };
  useEffect(() => { track("shared_route_viewed", { km: share.km, variant: share.variant }); }, [share.km, share.variant]);

  const toggleSave = () => {
    if (saved) { removeRide(rideId(code)); track("shared_ride_unsaved"); }
    else { saveSharedRide(code, share); track("shared_ride_saved", { km: share.km }); }
  };

  /**
   * This page's own address, not a freshly encoded one: the rider may have
   * arrived on a short /r/<id> link, and that is the link worth passing on.
   * Phone gets the system sheet, desktop the clipboard with a confirmation —
   * the same rule the result panel follows.
   */
  const shareRoute = async () => {
    const url = window.location.href;
    const title = `${share.name} · ${share.km} km`;
    const phone = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent) || window.matchMedia("(pointer: coarse)").matches;
    if (phone && typeof navigator.share === "function") {
      try { await navigator.share({ title, url }); track("route_shared", { method: "share", km: share.km, variant: share.variant }); return; }
      catch { /* dismissed: fall through to copy */ }
    }
    try { await navigator.clipboard.writeText(url); setCopied(true); setTimeout(() => setCopied(false), 3500); track("route_shared", { method: "copy", km: share.km, variant: share.variant }); }
    catch { window.prompt(m.resCopyLink, url); }
  };

  /**
   * "Ko mainīt?" on a shared ride: the planner opens with this ride's plan
   * loaded, the chat as the entry mode and this ride as the origin — the same
   * destination the old "Pielāgot čatā" button had — and the typed correction
   * travels in `?ask=`, which app/page.tsx sends as the first chat turn.
   */
  const submitCorrection = () => {
    const ask = text.trim();
    if (!planCode || !ask) return;
    track("shared_correction_sent", { length: ask.length, saved });
    router.push(`/?p=${planCode}&mode=chat&from=${encodeURIComponent(code)}&ask=${encodeURIComponent(ask)}`);
  };

  /**
   * "Pievienot" on a suggestion, from a ride that is already finished.
   *
   * The planner's own add-stop (`addStop` in app/page.tsx) can put the new via
   * into the plan it holds in state; this page has no planner, so the plan
   * itself makes the trip — **re-encoded into `p`**, with the stop already in
   * it, rather than sent as a separate `&addVia=lat,lon,name`.
   *
   * That choice is about app/page.tsx: `?p=` is already decoded there by
   * `decodePlanShare` + `decodePlanPlaces`, so a plan with one more via and
   * one more resolved place needs **no new parsing at all** — no coordinate
   * string to split, no place to merge into `places` after the fact, no second
   * way for a via to enter a plan. An `addVia` parameter would have added a
   * parser, a validator and an ordering rule to the one file that has to stay
   * simple. The URL grows by roughly the length of the place name; a plan part
   * is a few hundred bytes against the route's own few kilobytes.
   *
   * Appended, not inserted, for the reason the planner appends: the place is
   * somewhere this ride already passes near, so its position belongs to the
   * router, and on a one-way ride the destination stays the destination.
   */
  const addStop = (place: { name: string; lat: number; lon: number }) => {
    // No plan in the code (an old share link) means no button in the first
    // place; this is the belt to that brace.
    if (!planCode || !share.plan) return;
    if (share.plan.viaPlaces.includes(place.name)) return;
    // `RidePlanSchema` caps the list at six. Past that the press does nothing
    // rather than building a plan the schema would refuse on arrival.
    if (share.plan.viaPlaces.length >= 6) return;
    const next = { ...share.plan, viaPlaces: [...share.plan.viaPlaces, place.name] };
    // The coordinates travel as a picked place for the same reason the form's
    // do: "Pilskalns" names dozens of hillforts and the one meant is the one
    // on this map, not whatever a geocoder picks tomorrow. Any place the code
    // already carried under this name is replaced, so the list never holds two
    // rows claiming to be the same stop.
    const picked = [
      ...decodePlanPlaces(planCode).filter((p) => p.name !== place.name),
      { name: place.name, label: place.name, lat: place.lat, lon: place.lon },
    ];
    track("suggestion_added", { via_count: next.viaPlaces.length, source: "shared" });
    // `go=1` is what makes the planner generate on arrival instead of showing
    // a filled-in form; `from` keeps this ride as the origin, so the new one
    // knows what it was made from and the rider is asked whether it replaces
    // it. No `mode=chat`: `startFromForm` moves to the chat itself, and saying
    // so here would have been a second answer to the same question.
    const p = encodePlanShare(next, picked);
    router.push(`/?p=${encodeURIComponent(p)}&go=1&from=${encodeURIComponent(code)}`);
  };

  /**
   * The Pievienot inside the card the map opens on a focused suggestion — the
   * same mechanism the planner has, and the same reason the ring goes first:
   * the ride is about to be re-planned somewhere else, and a "look at this"
   * marker left standing would claim the place is still only a suggestion.
   */
  const addFocusedPoi = () => {
    if (!focusPoi) return;
    setFocusPoi(null);
    addStop({ name: focusPoi.label, lat: focusPoi.lat, lon: focusPoi.lon });
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
        <div className="min-w-0">
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
          <button type="button" onClick={downloadGpx} className="mt-4 flex h-11 w-full items-center justify-center gap-2 rounded-full bg-[#f56300] text-sm font-semibold text-white transition hover:bg-[#d85600]"><Download className="size-4" />{m.resDownloadGpx}</button>
          <RouteActionRow saved={saved} onToggleSave={toggleSave} onShare={shareRoute} copied={copied} details={details} onToggleDetails={() => setDetails(!details)} />
          {copied && (
            <p role="status" className="mopik-fade-in mt-2 rounded-lg bg-stone-900 px-3 py-2 text-xs text-white">{m.resLinkCopied}</p>
          )}
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
          {/* Ieteikumi as its own block, below the route card — the same shape
              the planner has, because the rider asked for the two pages to be
              identical here, and now the same three actions too wherever the
              code carries a plan. `onAdd` is simply left off when it does not
              (an old link): a row with two buttons instead of three is the
              whole statement, where a disabled third or an explanatory line
              would be an apology for a limit the rider cannot act on. */}
          <div className="mt-3">
            <SuggestionsCard
              pois={pois}
              loading={poisLoading}
              expanded={poisOpen}
              onToggle={() => setPoisOpen(!poisOpen)}
              onShow={showPoi}
              onAdd={planCode && share.plan ? addStop : undefined}
            />
          </div>
        </section>
        {/* The result panel's correction box, below the card and shaped the
            same way. It has nowhere to send a correction without the plan, so
            with an old link that carries none only the paragraph remains. */}
        <div>
          {planCode && (
            <form onSubmit={(e) => { e.preventDefault(); submitCorrection(); }} className="pt-1">
              <label htmlFor="ride-correction" className="mb-1.5 block px-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-stone-400">{m.resWhatToChange}</label>
              <div className="flex items-end gap-2 rounded-xl border border-stone-200 bg-white p-2 focus-within:border-[#f56300]">
                <textarea id="ride-correction" value={text} onChange={(e) => setText(e.target.value)} rows={1} maxLength={6000}
                  onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); submitCorrection(); } }}
                  placeholder={m.resChangePlaceholder}
                  className="min-w-0 flex-1 resize-none bg-transparent px-2 py-1.5 text-base outline-none placeholder:text-stone-400 md:text-sm" />
                <button type="submit" disabled={!text.trim()} aria-label={m.resSendCorrection} className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-[#f56300] text-white transition hover:bg-[#d85600] disabled:opacity-35">
                  <ArrowUp className="size-5" />
                </button>
              </div>
            </form>
          )}
          {/* The result panel has no equivalent paragraph, but this page is
              also where a rider meets Mopik for the first time, so it stays —
              moved below the box, muted, where it no longer sits between the
              buttons and the next thing to do. */}
          <p className="mt-3 px-1 text-[11px] leading-relaxed text-stone-500">{m.shIntro}</p>
        </div>
        </div>
        <div className="order-first min-w-0 md:order-none">
          <MapPanel
            className="h-[46dvh] overflow-hidden rounded-2xl border border-stone-200 md:h-[calc(100vh-7rem)]"
            expandedClassName="md:relative md:inset-auto md:z-auto md:h-[calc(100vh-7rem)] md:overflow-hidden md:rounded-2xl md:border md:border-stone-200">
            <RouteMap segments={segments} start={start} destination={null} focus={focusPoi} onFocusCleared={() => setFocusPoi(null)} onFocusAdd={planCode && share.plan ? addFocusedPoi : undefined} showTet={showTet} onToggleTet={setShowTet} />
          </MapPanel>
        </div>
      </div>
    </main>
  );
}
