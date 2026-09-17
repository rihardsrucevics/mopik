"use client";

import { useEffect, useState, type ReactNode } from "react";
import { ChevronDown, ChevronUp, Map as MapIcon, Sparkles } from "lucide-react";
import { RidePlan } from "@/lib/chat/ride-plan";
import { composeRidePlan, placesFromPlan } from "@/lib/chat/compose-plan";
import { RoutePlaces } from "@/components/route-places";
import { useLocale } from "@/lib/i18n/use-locale";
import { t, messages, type MessageKey } from "@/lib/i18n/messages";
import { track } from "@/lib/analytics";
import { rememberPlace } from "@/lib/chat/recent-places";
import type { ResolvedPlace } from "@/lib/chat/places";
import {
  PROFILE_PRESETS,
  normalizeProfile,
  presetIdFor,
  profileFromPlan,
  type RideProfile,
} from "@/lib/chat/ride-profile";

type Choice<T extends string> = { value: T; label: string; detail?: string };

function ChoiceRow<T extends string>({ label, value, choices, onChange }: { label: string; value: T; choices: Choice<T>[]; onChange: (value: T) => void }) {
  return (
    <fieldset>
      <legend className="mb-1.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-stone-400">{label}</legend>
      <div className="grid grid-flow-col auto-cols-fr gap-1 rounded-xl bg-stone-100 p-1">
        {choices.map((choice) => (
          <button key={choice.value} type="button" aria-pressed={value === choice.value} onClick={() => onChange(choice.value)}
            className={`min-w-0 rounded-lg px-2 py-2 text-center transition ${value === choice.value ? "bg-white text-stone-950 shadow-sm ring-1 ring-stone-200" : "text-stone-500 hover:text-stone-800"}`}>
            <span className="block whitespace-nowrap text-xs font-semibold">{choice.label}</span>
            {choice.detail && <span className="mt-0.5 block text-[9px] leading-tight opacity-70">{choice.detail}</span>}
          </button>
        ))}
      </div>
    </fieldset>
  );
}

/**
 * The profile as one line. For most riders it never changes, so it takes one
 * row: the summary, the presets, and "Mainīt" to open the three choices.
 */
function ProfileLine({ profile, onChange }: { profile: RideProfile; onChange: (profile: RideProfile) => void }) {
  const [locale] = useLocale();
  const m = messages(locale);
  const [open, setOpen] = useState(false);
  const p = normalizeProfile(profile);
  const activePreset = presetIdFor(p);

  return (
    <div className="rounded-xl border border-stone-200 bg-[#faf9f6]">
      <div className="flex items-center justify-between gap-3 px-3 py-2">
        <div className="min-w-0">
          <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-stone-400">{m.profileTitle}</div>
          <div className="truncate text-sm font-semibold text-stone-900">{[p.surface === "asphalt" ? null : m[({rest:"diffRest",adventure:"diffAdventure",hard:"diffHard"} as const)[p.difficulty]], m[p.style === "tourism" ? "styleTourism" : "styleRiding"], m[({asphalt:"surfAsphalt",gravel:"surfGravel",forest:"surfForest"} as const)[p.surface]]].filter(Boolean).join(" · ")}</div>
        </div>
        <button type="button" onClick={() => setOpen(!open)} aria-expanded={open}
          className="inline-flex shrink-0 items-center gap-1 text-xs font-medium text-[#bd4b00]">
          {open ? m.close : m.change}{open ? <ChevronUp className="size-3.5" /> : <ChevronDown className="size-3.5" />}
        </button>
      </div>

      {open && (
        <div className="space-y-4 border-t border-stone-200 px-3 py-3">
          <div className="flex flex-wrap gap-1.5">
            {PROFILE_PRESETS.map((preset) => (
              <button key={preset.id} type="button" aria-pressed={activePreset === preset.id} onClick={() => onChange(preset.profile)}
                className={`rounded-full px-3 py-1 text-xs font-medium transition ${activePreset === preset.id ? "bg-stone-900 text-white" : "bg-white text-stone-600 ring-1 ring-stone-200 hover:text-stone-900"}`}>
                {m[preset.label as MessageKey]}
              </button>
            ))}
          </div>

          <ChoiceRow label={m.profileStyle} value={p.style} onChange={(style) => onChange({ ...p, style })}
            choices={[{ value: "tourism" as const, label: m.styleTourism, detail: m.styleTourismHint }, { value: "riding" as const, label: m.styleRiding, detail: m.styleRidingHint }]} />
          <ChoiceRow label={m.profileSurface} value={p.surface} onChange={(surface) => onChange(normalizeProfile({ ...p, surface }))}
            choices={[{ value: "asphalt" as const, label: m.surfAsphalt }, { value: "gravel" as const, label: m.surfGravel }, { value: "forest" as const, label: m.surfForest }]} />
          {p.surface === "asphalt" ? (
            <p className="text-[11px] leading-relaxed text-stone-500">
              {m.asphaltNote}
            </p>
          ) : (
            <ChoiceRow label={m.profileDifficulty} value={p.difficulty} onChange={(difficulty) => onChange({ ...p, difficulty })}
              choices={[{ value: "rest" as const, label: m.diffRest, detail: m.diffRestHint }, { value: "adventure" as const, label: m.diffAdventure, detail: m.diffAdventureHint }, { value: "hard" as const, label: m.diffHard, detail: m.diffHardHint }]} />
          )}
          {p.surface === "forest" && (
            <p className="rounded-lg bg-amber-50 px-3 py-2 text-[11px] leading-relaxed text-amber-900">
              {m.forestWarning}
            </p>
          )}
          <p className="text-[11px] leading-relaxed text-stone-500">{m.profileRemembered}</p>
        </div>
      )}
    </div>
  );
}

export function RideComposer({ initialPlan, initialPlaces, profile, onProfileChange, busy, onGenerate, onUseChat, onPlacesChange, map }: {
  initialPlan: RidePlan | null;
  /**
   * Coordinates the plan arrived with, matched to its rows by name. A ride
   * reopened for editing then keeps the exact place it was built from instead
   * of being geocoded again — the "Valmiera in Rīga" failure.
   */
  initialPlaces?: ResolvedPlace[] | null;
  /** the rider's standing profile, remembered on the device */
  profile: RideProfile;
  onProfileChange: (profile: RideProfile) => void;
  busy: boolean;
  onGenerate: (plan: RidePlan, places: ResolvedPlace[]) => void;
  onUseChat: () => void;
  /**
   * Picked places, in riding order, so the map can confirm them before a ride
   * exists — with the trip type, which is what says whether the last of them
   * is a finish or a stop.
   *
   * The map draws a stop as a 🅿️ pill and the start and finish as their own
   * pins, and the list alone cannot tell the two apart: on a one-way ride the
   * last confirmed place is the destination, on a round trip there is no
   * destination and every place after the start is a stop. Passing the places
   * without the shape is what put a 🅿️ on Warszawa.
   */
  onPlacesChange?: (places: ResolvedPlace[], tripType: "round_trip" | "one_way") => void;
  /**
   * The map, on phones only. It belongs to the places it confirms, so it sits
   * under them inside this block rather than above the whole page — where it
   * pushed even the saved-rides entry down and read as something separate
   * from the ride being described. The desktop keeps its own sticky column.
   */
  map?: ReactNode;
}) {
  const [locale] = useLocale();
  const [places, setPlaces] = useState<string[]>(placesFromPlan(initialPlan));
  // One way is the default: it is the ride that needs both rows, so the form
  // reads "No … Līdz …" on open. A plan being edited keeps the shape it had —
  // `returnToStart` is explicit on every stored plan, so only a genuinely
  // absent plan falls through to the default.
  const [tripType, setTripType] = useState<"round_trip" | "one_way">(initialPlan?.returnToStart === true ? "round_trip" : "one_way");
  const [durationMode, setDurationMode] = useState<"flexible" | "hours">(initialPlan?.budget.mode === "duration" ? "hours" : "flexible");
  // The chips and the field are two ways to say the same thing, never mirrored
  // into each other: a rider who wants 2.5 h should type it, not first delete a
  // number Mopik put there. `preset` holds the chosen chip, `hours` the typed
  // value; the last one touched wins.
  const initialHours = initialPlan?.budget.mode === "duration" ? initialPlan.budget.value ?? null : null;
  const PRESETS = [2, 4, 6, 8];
  const [preset, setPreset] = useState<number | null>(initialHours && PRESETS.includes(initialHours) ? initialHours : initialHours ? null : 4);
  const [hours, setHours] = useState(initialHours && !PRESETS.includes(initialHours) ? String(initialHours) : "");
  const [error, setError] = useState<string | null>(null);
  // Phone only: the map is opened on request, and stays open once it is.
  const [mapOpen, setMapOpen] = useState(false);
  const [locating, setLocating] = useState(false);

  /**
   * "Mana vieta": the device's coordinates, named. Offered rather than applied
   * on load — the permission prompt at first sight of a form is a good way to
   * lose a rider, and an IP guess is often the wrong town. The point itself is
   * kept; the reverse lookup only supplies a name the rider recognises, and a
   * failed lookup still fills the field with the coordinates.
   */
  const useMyLocation = () => {
    if (!navigator.geolocation || locating) return;
    setLocating(true);
    setError(null);
    navigator.geolocation.getCurrentPosition(
      async ({ coords }) => {
        const { latitude: lat, longitude: lon } = coords;
        let place: ResolvedPlace = { name: `${lat.toFixed(4)}, ${lon.toFixed(4)}`, label: "Mana atrašanās vieta", lat, lon };
        try {
          const res = await fetch(`/api/places?lat=${lat}&lon=${lon}`);
          if (res.ok) {
            const found = ((await res.json()) as { places: ResolvedPlace[] }).places?.[0];
            if (found) place = found;
          }
        } catch {
          // Keep the coordinates: the ride can still be planned from them.
        }
        setPlaces((prev) => prev.map((p, i) => (i === 0 ? place.name : p)));
        setPick(0, place);
        // The same shelf a dropdown pick goes on. A place found by GPS was the
        // one kind of place the app forgot: `PlaceInput.pick` calls
        // `rememberPlace`, and this path never goes through it, so "Sigulda"
        // resolved by the crosshair was gone by the next visit.
        //
        // Stored as the *named* place, never as "my location": a recent entry
        // has to work later, from the sofa, with no GPS. When the reverse
        // lookup found nothing the fallback name is the coordinate pair, and
        // `rememberPlace` refuses that on its own — so this call is safe in
        // both branches above, and runs only after the lookup has settled.
        rememberPlace(place);
        setLocating(false);
        track("form_location_used");
      },
      () => { setLocating(false); setError(t(locale, "errLocation")); },
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 300000 },
    );
  };
  // Picked places by row index. Typing again clears the pick, so a changed
  // name is geocoded rather than silently kept at the old coordinates.
  const [picked, setPicked] = useState<Record<number, ResolvedPlace | null>>(() => {
    if (!initialPlaces?.length) return {};
    // Matched by name rather than by position: the plan's rows and the routed
    // places can differ in length (a round trip repeats its start).
    const byName = new Map(initialPlaces.map((p) => [p.name.trim().toLowerCase(), p]));
    const seeded: Record<number, ResolvedPlace | null> = {};
    placesFromPlan(initialPlan).forEach((name, i) => {
      const found = byName.get(name.trim().toLowerCase());
      if (found) seeded[i] = found;
    });
    return seeded;
  });
  const setPick = (index: number, place: ResolvedPlace | null) => setPicked((prev) => ({ ...prev, [index]: place }));
  // Reordering moves the rows; the coordinates must follow their row, so the
  // picks are re-keyed by matching name rather than by the old index.
  const reorder = (next: string[]) => {
    const byName = new Map<string, ResolvedPlace>();
    for (const [i, p] of Object.entries(picked)) {
      const name = places[Number(i)]?.trim().toLowerCase();
      if (p && name) byName.set(name, p);
    }
    setPlaces(next);
    // An emptied row keeps no coordinates: matching is by name, and "" must
    // never inherit the pick of some other blank row.
    setPicked(Object.fromEntries(next.map((name, i) => {
      const key = name.trim().toLowerCase();
      return [i, key ? byName.get(key) ?? null : null];
    })));
  };

  // Report picked places upward in riding order, so the map can draw a pin per
  // confirmed place and the rider sees that "Brīvības iela 105" is the one
  // they meant before spending a generation on it. In an effect, not inside
  // the state updater: calling a parent's setState while rendering is exactly
  // what React warns about.
  const confirmed = places.map((_, i) => picked[i]).filter((p): p is ResolvedPlace => Boolean(p));
  // The first pinned place biases every other row's search: choosing Sigulda
  // as the start should offer Latvian places below it, not a same-named
  // village on another continent. Until something is pinned the server falls
  // back to the rider's own region.
  const anchor = confirmed[0] ?? null;
  const confirmedKey = confirmed.map((p) => `${p.lat},${p.lon}`).join("|");
  useEffect(() => {
    onPlacesChange?.(confirmed, tripType);
    // `confirmed` is rebuilt each render; the key is what actually changes.
    // `tripType` is in the list too: switching Turp un atpakaļ ↔ Vienā virzienā
    // moves the same last place between "finish" and "stop", so the map has to
    // re-draw its marker without a place being re-picked.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [confirmedKey, tripType]);

  // A plan the chat has modified carries its own profile; otherwise the
  // rider's remembered one applies.
  //
  // Once a ride has been generated, `initialPlan` is set for the rest of the
  // session, so reading the profile from it alone made every profile button
  // dead on the way back from a result: the click updated the remembered
  // profile, the plan re-rendered over it, and nothing moved. The plan only
  // seeds the choice; a click made here wins until the plan itself changes.
  const [profileOverride, setProfileOverride] = useState<RideProfile | null>(null);
  const effectiveProfile = profileOverride ?? (initialPlan ? profileFromPlan(initialPlan) : profile);
  const changeProfile = (next: RideProfile) => {
    setProfileOverride(next);
    onProfileChange(next);
  };

  const submit = () => {
    const filled = places.map((p) => p.trim()).filter(Boolean);
    // Name the field that is missing. "Norādi vismaz vienu vietu" was shown to
    // a rider who had filled in "Līdz" and left "No" empty — technically about
    // the count, but read as a lie about the field he had just typed into.
    if (!places[0]?.trim()) { setError(t(locale, "errNoStart")); return; }
    // An empty "Līdz" is a real answer — "man vienalga", the same ride the
    // lucky mode already handles — so only a one-way request with nothing but
    // a start is refused: there is no direction to send it in.
    if (tripType === "one_way" && filled.length < 2) { setError(t(locale, "errNoDestination")); return; }
    const value = hours.trim() ? Number(hours.replace(",", ".")) : preset ?? NaN;
    if (durationMode === "hours" && (!Number.isFinite(value) || value < 0.5 || value > 16)) { setError(t(locale, "errHours")); return; }
    const plan = composeRidePlan({ places, tripType, durationMode, hours: value, profile: effectiveProfile });
    setError(null);
    onGenerate(plan, Object.values(picked).filter((p): p is ResolvedPlace => p !== null));
  };

  return (
    <section className="flex flex-col overflow-hidden rounded-2xl border border-stone-200 bg-white md:h-[calc(100vh-7rem)]" aria-label={t(locale, "a11yRideInput")}>
      <div className="border-b border-stone-200 bg-[#faf9f6] px-4 py-3">
        <div className="mb-0.5 text-[10px] font-semibold uppercase tracking-[0.2em] text-[#bd4b00]">{t(locale, "composerEyebrow")}</div>
        <h2 className="text-lg font-semibold tracking-tight">{t(locale, "composerTitle")}</h2>
        <p className="mt-1 hidden text-xs text-stone-500 md:block">{t(locale, "composerHint")}</p>
      </div>

      {/* Scrolls inside the fixed-height column when the profile panel is
          open; overflow-hidden on the section otherwise trapped the content. */}
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4 md:gap-5 md:p-5">
        {/* Trip type first: it decides what the last row means — a waypoint on
            the way home, or the finish. Asking for places before knowing the
            shape of the ride is asking the rider to guess. */}
        <ChoiceRow label={t(locale, "tripType")} value={tripType} onChange={(v) => { track("trip_type_changed", { to: v }); setTripType(v); }} choices={[{ value: "one_way", label: t(locale, "oneWay") }, { value: "round_trip", label: t(locale, "roundTrip") }]} />

        <RoutePlaces places={places} picked={picked} oneWay={tripType === "one_way"} busy={busy} onChange={reorder} onPick={setPick} onUseLocation={useMyLocation} locating={locating} near={anchor} />

        {/* The map is worth a look when a place needs confirming, not on every
            visit — it is the tallest thing on the page and most rides are
            planned without ever glancing at it. So it opens on request, and
            the toggle only appears once there is a confirmed place to show. */}
        {map && (
          <div className="md:hidden">
            <button type="button" onClick={() => setMapOpen((v) => { if (!v) track("form_map_opened"); return !v; })} aria-expanded={mapOpen}
              className="inline-flex items-center gap-1.5 text-xs font-medium text-[#bd4b00]">
              <MapIcon className="size-3.5" />
              {mapOpen ? t(locale, "hideMap") : t(locale, "showOnMap")}
              {mapOpen ? <ChevronUp className="size-3.5" /> : <ChevronDown className="size-3.5" />}
            </button>
            {/* Mounted only while open: MapLibre in a hidden container comes
                up sized zero and stays that way until something resizes it. */}
            {mapOpen && <div className="mt-2">{map}</div>}
          </div>
        )}

        <ChoiceRow label={t(locale, "duration")} value={durationMode} onChange={setDurationMode} choices={[{ value: "flexible", label: t(locale, "flexible") }, { value: "hours", label: t(locale, "exact") }]} />
        {durationMode === "hours" && (
          <div className="flex items-stretch gap-1.5" role="group" aria-label={t(locale, "a11yHours")}>
            {/* The usual days as one tap each; the field is for everything else. */}
            {PRESETS.map((h) => {
              const active = !hours.trim() && preset === h;
              return (
                <button key={h} type="button" onClick={() => { setPreset(h); setHours(""); }} aria-pressed={active}
                  className={`h-10 min-w-0 flex-1 rounded-xl border text-sm font-semibold tabular-nums transition ${active ? "border-stone-900 bg-stone-900 text-white" : "border-stone-200 bg-white text-stone-700 hover:border-stone-300"}`}>
                  {h} h
                </button>
              );
            })}
            <label className="flex h-10 w-[5.5rem] shrink-0 items-center gap-1 rounded-xl border border-stone-200 px-2.5 focus-within:border-[#f56300]">
              {/* type=text + inputMode=decimal: iOS opens the number pad, and "2,5" stays typeable. */}
              <input type="text" inputMode="decimal" pattern="[0-9]*[.,]?[0-9]*" placeholder={t(locale, "hoursOther")} aria-label={t(locale, "a11yHoursOther")} value={hours} onChange={(e) => { setHours(e.target.value); if (e.target.value.trim()) setPreset(null); }} className="min-w-0 flex-1 bg-transparent text-right text-base font-semibold outline-none md:text-sm" />
              <span className="text-xs text-stone-400">h</span>
            </label>
          </div>
        )}

        <ProfileLine profile={effectiveProfile} onChange={changeProfile} />

        {error && <p role="alert" className="text-xs text-red-700">{error}</p>}

        {/* Pushed to the bottom on the desktop so the column is used and the
            action is where a form's action belongs. */}
        <div className="md:mt-auto" />
        <button type="button" onClick={submit} disabled={busy} className="flex h-12 w-full shrink-0 items-center justify-center gap-2 rounded-full bg-[#f56300] text-sm font-semibold text-white transition hover:bg-[#d85600] disabled:opacity-50"><Sparkles className="size-4" />{t(locale, "generate")}</button>
        <button type="button" onClick={onUseChat} disabled={busy} className="w-full text-center text-xs text-stone-500 underline decoration-stone-300 underline-offset-4 hover:text-stone-800">{t(locale, "orUseChat")}</button>
      </div>
    </section>
  );
}
