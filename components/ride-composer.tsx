"use client";

import { useEffect, useState, type ReactNode } from "react";
import { ChevronDown, ChevronUp, Sparkles } from "lucide-react";
import { RidePlan } from "@/lib/chat/ride-plan";
import { composeRidePlan, placesFromPlan } from "@/lib/chat/compose-plan";
import { RoutePlaces } from "@/components/route-places";
import type { ResolvedPlace } from "@/lib/chat/places";
import {
  PROFILE_LABELS,
  PROFILE_PRESETS,
  normalizeProfile,
  presetIdFor,
  profileFromPlan,
  profileSummary,
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
  const [open, setOpen] = useState(false);
  const p = normalizeProfile(profile);
  const activePreset = presetIdFor(p);

  return (
    <div className="rounded-xl border border-stone-200 bg-[#faf9f6]">
      <div className="flex items-center justify-between gap-3 px-3 py-2">
        <div className="min-w-0">
          <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-stone-400">Tavs profils</div>
          <div className="truncate text-sm font-semibold text-stone-900">{profileSummary(p)}</div>
        </div>
        <button type="button" onClick={() => setOpen(!open)} aria-expanded={open}
          className="inline-flex shrink-0 items-center gap-1 text-xs font-medium text-[#bd4b00]">
          {open ? "Aizvērt" : "Mainīt"}{open ? <ChevronUp className="size-3.5" /> : <ChevronDown className="size-3.5" />}
        </button>
      </div>

      {open && (
        <div className="space-y-4 border-t border-stone-200 px-3 py-3">
          <div className="flex flex-wrap gap-1.5">
            {PROFILE_PRESETS.map((preset) => (
              <button key={preset.id} type="button" aria-pressed={activePreset === preset.id} onClick={() => onChange(preset.profile)}
                className={`rounded-full px-3 py-1 text-xs font-medium transition ${activePreset === preset.id ? "bg-stone-900 text-white" : "bg-white text-stone-600 ring-1 ring-stone-200 hover:text-stone-900"}`}>
                {preset.label}
              </button>
            ))}
          </div>

          <ChoiceRow label={PROFILE_LABELS.style.title} value={p.style} onChange={(style) => onChange({ ...p, style })}
            choices={(["tourism", "riding"] as const).map((v) => ({ value: v, ...PROFILE_LABELS.style[v] }))} />
          <ChoiceRow label={PROFILE_LABELS.surface.title} value={p.surface} onChange={(surface) => onChange(normalizeProfile({ ...p, surface }))}
            choices={(["asphalt", "gravel", "forest"] as const).map((v) => ({ value: v, ...PROFILE_LABELS.surface[v] }))} />
          {p.surface === "asphalt" ? (
            <p className="text-[11px] leading-relaxed text-stone-500">
              Uz asfalta tehniskiem posmiem nav nozīmes, tāpēc grūtība šeit netiek prasīta.
            </p>
          ) : (
            <ChoiceRow label={PROFILE_LABELS.difficulty.title} value={p.difficulty} onChange={(difficulty) => onChange({ ...p, difficulty })}
              choices={(["rest", "adventure", "hard"] as const).map((v) => ({ value: v, ...PROFILE_LABELS.difficulty[v] }))} />
          )}
          {p.surface === "forest" && (
            <p className="rounded-lg bg-amber-50 px-3 py-2 text-[11px] leading-relaxed text-amber-900">
              “Meži” var iekļaut takas ar nepārbaudītu piekļuves statusu. Smilšu pludmales takas un skaidri aizliegti ceļi netiek izmantoti.
            </p>
          )}
          <p className="text-[11px] leading-relaxed text-stone-500">Profils paliek atcerēts šajā ierīcē arī nākamajiem braucieniem.</p>
        </div>
      )}
    </div>
  );
}

export function RideComposer({ initialPlan, profile, onProfileChange, busy, onGenerate, onUseChat, onPlacesChange, map }: {
  initialPlan: RidePlan | null;
  /** the rider's standing profile, remembered on the device */
  profile: RideProfile;
  onProfileChange: (profile: RideProfile) => void;
  busy: boolean;
  onGenerate: (plan: RidePlan, places: ResolvedPlace[]) => void;
  onUseChat: () => void;
  /** Picked places, in riding order, so the map can confirm them before a ride exists. */
  onPlacesChange?: (places: ResolvedPlace[]) => void;
  /**
   * The map, on phones only. It belongs to the places it confirms, so it sits
   * under them inside this block rather than above the whole page — where it
   * pushed even the saved-rides entry down and read as something separate
   * from the ride being described. The desktop keeps its own sticky column.
   */
  map?: ReactNode;
}) {
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
  // Picked places by row index. Typing again clears the pick, so a changed
  // name is geocoded rather than silently kept at the old coordinates.
  const [picked, setPicked] = useState<Record<number, ResolvedPlace | null>>({});
  const setPick = (index: number, place: ResolvedPlace | null) => setPicked((prev) => ({ ...prev, [index]: place }));
  // Reordering moves the rows; the coordinates must follow their row, so the
  // picks are re-keyed by matching name rather than by the old index.
  const reorder = (next: string[]) => {
    const byName = new Map<string, ResolvedPlace>();
    for (const [i, p] of Object.entries(picked)) if (p && places[Number(i)]) byName.set(places[Number(i)].trim().toLowerCase(), p);
    setPlaces(next);
    setPicked(Object.fromEntries(next.map((name, i) => [i, byName.get(name.trim().toLowerCase()) ?? null])));
  };

  // Report picked places upward in riding order, so the map can draw a pin per
  // confirmed place and the rider sees that "Brīvības iela 105" is the one
  // they meant before spending a generation on it. In an effect, not inside
  // the state updater: calling a parent's setState while rendering is exactly
  // what React warns about.
  const confirmed = places.map((_, i) => picked[i]).filter((p): p is ResolvedPlace => Boolean(p));
  const confirmedKey = confirmed.map((p) => `${p.lat},${p.lon}`).join("|");
  useEffect(() => {
    onPlacesChange?.(confirmed);
    // `confirmed` is rebuilt each render; the key is what actually changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [confirmedKey]);

  // A plan the chat has modified carries its own profile; otherwise the
  // rider's remembered one applies.
  const effectiveProfile = initialPlan ? profileFromPlan(initialPlan) : profile;

  const submit = () => {
    const filled = places.map((p) => p.trim()).filter(Boolean);
    if (!filled.length) { setError("Norādi, no kurienes brauksim."); return; }
    // An empty "Līdz" is a real answer — "man vienalga", the same ride the
    // lucky mode already handles — so only a one-way request with nothing but
    // a start is refused: there is no direction to send it in.
    if (tripType === "one_way" && filled.length < 2) { setError("Vienvirziena braucienam norādi vismaz vienu vietu, uz kuru doties."); return; }
    const value = hours.trim() ? Number(hours.replace(",", ".")) : preset ?? NaN;
    if (durationMode === "hours" && (!Number.isFinite(value) || value < 0.5 || value > 16)) { setError("Ilgumam jābūt no 0,5 līdz 16 stundām."); return; }
    const plan = composeRidePlan({ places, tripType, durationMode, hours: value, profile: effectiveProfile });
    setError(null);
    onGenerate(plan, Object.values(picked).filter((p): p is ResolvedPlace => p !== null));
  };

  return (
    <section className="flex flex-col overflow-hidden rounded-2xl border border-stone-200 bg-white md:h-[calc(100vh-7rem)]" aria-label="Brauciena ievade">
      <div className="border-b border-stone-200 bg-[#faf9f6] px-4 py-3">
        <div className="mb-0.5 text-[10px] font-semibold uppercase tracking-[0.2em] text-[#bd4b00]">Tavs nākamais brauciens</div>
        <h2 className="text-lg font-semibold tracking-tight">Kur un cik ilgi brauksim?</h2>
        <p className="mt-1 hidden text-xs text-stone-500 md:block">Pārējo nosaka tavs profils. Maršrutu varēsi precizēt pēc ģenerēšanas.</p>
      </div>

      {/* Scrolls inside the fixed-height column when the profile panel is
          open; overflow-hidden on the section otherwise trapped the content. */}
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4 md:gap-5 md:p-5">
        {/* Trip type first: it decides what the last row means — a waypoint on
            the way home, or the finish. Asking for places before knowing the
            shape of the ride is asking the rider to guess. */}
        <ChoiceRow label="Maršruta veids" value={tripType} onChange={setTripType} choices={[{ value: "one_way", label: "Vienā virzienā" }, { value: "round_trip", label: "Turp un atpakaļ" }]} />

        <RoutePlaces places={places} picked={picked} oneWay={tripType === "one_way"} busy={busy} onChange={reorder} onPick={setPick} />

        {map && <div className="md:hidden">{map}</div>}

        <ChoiceRow label="Ilgums" value={durationMode} onChange={setDurationMode} choices={[{ value: "flexible", label: "Brīvs" }, { value: "hours", label: "Konkrēts" }]} />
        {durationMode === "hours" && (
          <div className="flex items-stretch gap-1.5" role="group" aria-label="Stundas">
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
              <input type="text" inputMode="decimal" pattern="[0-9]*[.,]?[0-9]*" placeholder="cits" aria-label="Stundas, cits skaitlis" value={hours} onChange={(e) => { setHours(e.target.value); if (e.target.value.trim()) setPreset(null); }} className="min-w-0 flex-1 bg-transparent text-right text-base font-semibold outline-none md:text-sm" />
              <span className="text-xs text-stone-400">h</span>
            </label>
          </div>
        )}

        <ProfileLine profile={effectiveProfile} onChange={onProfileChange} />

        {error && <p role="alert" className="text-xs text-red-700">{error}</p>}

        {/* Pushed to the bottom on the desktop so the column is used and the
            action is where a form's action belongs. */}
        <div className="md:mt-auto" />
        <button type="button" onClick={submit} disabled={busy} className="flex h-12 w-full shrink-0 items-center justify-center gap-2 rounded-full bg-[#f56300] text-sm font-semibold text-white transition hover:bg-[#d85600] disabled:opacity-50"><Sparkles className="size-4" />Izveidot maršrutu</button>
        <button type="button" onClick={onUseChat} disabled={busy} className="w-full text-center text-xs text-stone-500 underline decoration-stone-300 underline-offset-4 hover:text-stone-800">Vai arī aprakstīt braucienu čatā</button>
      </div>
    </section>
  );
}
