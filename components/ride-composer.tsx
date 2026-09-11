"use client";

import { useState } from "react";
import { ArrowRight, ChevronDown, ChevronUp, MapPin, Plus, Route, Sparkles, X } from "lucide-react";
import { RidePlan } from "@/lib/chat/ride-plan";
import { composeRidePlan } from "@/lib/chat/compose-plan";
import { PlaceInput } from "@/components/place-input";
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
      <legend className="mb-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-stone-400">{label}</legend>
      <div className="grid gap-1.5 rounded-xl bg-stone-100 p-1 sm:grid-flow-col sm:auto-cols-fr">
        {choices.map((choice) => (
          <button key={choice.value} type="button" aria-pressed={value === choice.value} onClick={() => onChange(choice.value)}
            className={`min-w-0 rounded-lg px-2.5 py-2 text-left transition ${value === choice.value ? "bg-white text-stone-950 shadow-sm ring-1 ring-stone-200" : "text-stone-500 hover:text-stone-800"}`}>
            <span className="block text-xs font-semibold">{choice.label}</span>
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
      <div className="flex items-center justify-between gap-3 px-3 py-2.5">
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
          <p className="text-[11px] leading-relaxed text-stone-500">Profils paliek atcerēts šajā ierīcē arī nākamajiem braucieniem.</p>
        </div>
      )}

      {p.surface === "forest" && (
        <p className="border-t border-amber-200 bg-amber-50 px-3 py-2 text-[11px] leading-relaxed text-amber-900">
          “Meži” var iekļaut takas ar nepārbaudītu piekļuves statusu. Smilšu pludmales takas un skaidri aizliegti ceļi netiek izmantoti.
        </p>
      )}
    </div>
  );
}

export function RideComposer({ initialPlan, profile, onProfileChange, busy, onGenerate, onUseChat }: {
  initialPlan: RidePlan | null;
  /** the rider's standing profile, remembered on the device */
  profile: RideProfile;
  onProfileChange: (profile: RideProfile) => void;
  busy: boolean;
  onGenerate: (plan: RidePlan, places: ResolvedPlace[]) => void;
  onUseChat: () => void;
}) {
  const [start, setStart] = useState(initialPlan?.startPlace ?? "Rīga");
  const [destination, setDestination] = useState(initialPlan?.returnToStart ? initialPlan.viaPlaces.at(-1) ?? "" : initialPlan?.destinationPlace ?? "");
  const [stops, setStops] = useState<string[]>(initialPlan?.returnToStart ? initialPlan.viaPlaces.slice(0, -1) : initialPlan?.viaPlaces ?? []);
  const [tripType, setTripType] = useState<"round_trip" | "one_way">(initialPlan?.returnToStart === false ? "one_way" : "round_trip");
  const [durationMode, setDurationMode] = useState<"flexible" | "hours">(initialPlan?.budget.mode === "duration" ? "hours" : "flexible");
  const [hours, setHours] = useState(String(initialPlan?.budget.mode === "duration" ? initialPlan.budget.value ?? 4 : 4));
  const [error, setError] = useState<string | null>(null);
  // Picked places by field: "start", "destination", "stop-0"… Typing again
  // clears the pick, so a changed name is geocoded rather than silently
  // kept at the old coordinates.
  const [picked, setPicked] = useState<Record<string, ResolvedPlace | null>>({});
  const setPick = (key: string, place: ResolvedPlace | null) => setPicked((prev) => ({ ...prev, [key]: place }));

  // A plan the chat has modified carries its own profile; otherwise the
  // rider's remembered one applies.
  const effectiveProfile = initialPlan ? profileFromPlan(initialPlan) : profile;

  const addStop = () => { if (stops.length < 4) setStops([...stops, ""]); };
  const submit = () => {
    if (!start.trim()) { setError("Norādi brauciena sākumu."); return; }
    if (tripType === "one_way" && !destination.trim()) { setError("Vienvirziena braucienam norādi galamērķi."); return; }
    const value = Number(hours.replace(",", "."));
    if (durationMode === "hours" && (!Number.isFinite(value) || value < 0.5 || value > 16)) { setError("Ilgumam jābūt no 0,5 līdz 16 stundām."); return; }
    const plan = composeRidePlan({ start, destination, stops, tripType, durationMode, hours: value, profile: effectiveProfile });
    setError(null);
    onGenerate(plan, Object.values(picked).filter((p): p is ResolvedPlace => p !== null));
  };

  return (
    <section className="overflow-hidden rounded-2xl border border-stone-200 bg-white" aria-label="Brauciena ievade">
      <div className="border-b border-stone-200 bg-[#faf9f6] px-5 py-4">
        <div className="mb-1 text-[10px] font-semibold uppercase tracking-[0.2em] text-[#bd4b00]">Tavs nākamais brauciens</div>
        <h2 className="text-xl font-semibold tracking-tight">Kur un cik ilgi brauksim?</h2>
        <p className="mt-1 text-xs text-stone-500">Pārējo nosaka tavs profils. Maršrutu varēsi precizēt pēc ģenerēšanas.</p>
      </div>

      <div className="space-y-5 p-5">
        <div className="grid gap-2 sm:grid-cols-2">
          <PlaceInput value={start} onChange={setStart} onPick={(p) => setPick("start", p)} icon={<MapPin className="size-3" />} label="No" placeholder="Rīga" />
          <PlaceInput value={destination} onChange={setDestination} onPick={(p) => setPick("destination", p)} icon={<ArrowRight className="size-3" />} label="Uz" placeholder={tripType === "round_trip" ? "Nav obligāts" : "Ainaži"} />
        </div>

        <ChoiceRow label="Maršruta veids" value={tripType} onChange={setTripType} choices={[{ value: "round_trip", label: "Turp un atpakaļ" }, { value: "one_way", label: "Vienā virzienā" }]} />

        <div>
          {stops.map((stop, index) => (
            <div key={index} className="mb-2 flex items-start gap-2">
              <PlaceInput className="min-w-0 flex-1" value={stop} onChange={(v) => setStops(stops.map((item, i) => i === index ? v : item))} onPick={(p) => setPick(`stop-${index}`, p)} icon={<Route className="size-3" />} label={`Pieturvieta ${index + 1}`} placeholder="Piemēram, Limbaži" />
              <button type="button" onClick={() => { setStops(stops.filter((_, i) => i !== index)); setPick(`stop-${index}`, null); }} aria-label="Noņemt pieturvietu" className="mt-4"><X className="size-4 text-stone-400" /></button>
            </div>
          ))}
          <button type="button" onClick={addStop} disabled={stops.length >= 4} className="inline-flex items-center gap-1 text-xs font-medium text-[#bd4b00] disabled:opacity-40"><Plus className="size-3.5" />Pievienot pieturvietu</button>
        </div>

        <div className="grid gap-4 sm:grid-cols-[1fr_120px]">
          <ChoiceRow label="Ilgums" value={durationMode} onChange={setDurationMode} choices={[{ value: "flexible", label: "Brīvs" }, { value: "hours", label: "Konkrēts" }]} />
          <label className={durationMode === "hours" ? "block" : "pointer-events-none opacity-35"}><span className="mb-2 block text-[10px] font-semibold uppercase tracking-[0.16em] text-stone-400">Stundas</span><div className="flex h-[42px] items-center rounded-xl border border-stone-200 px-3"><input type="number" min="0.5" max="16" step="0.5" value={hours} onChange={(e) => setHours(e.target.value)} disabled={durationMode !== "hours"} className="min-w-0 flex-1 bg-transparent text-sm font-semibold outline-none" /><span className="text-xs text-stone-400">h</span></div></label>
        </div>

        <ProfileLine profile={effectiveProfile} onChange={onProfileChange} />

        {error && <p role="alert" className="text-xs text-red-700">{error}</p>}

        <button type="button" onClick={submit} disabled={busy} className="flex h-12 w-full items-center justify-center gap-2 rounded-full bg-[#f56300] text-sm font-semibold text-white transition hover:bg-[#d85600] disabled:opacity-50"><Sparkles className="size-4" />Izveidot maršrutu</button>
        <button type="button" onClick={onUseChat} disabled={busy} className="w-full text-center text-xs text-stone-500 underline decoration-stone-300 underline-offset-4 hover:text-stone-800">Vai arī aprakstīt braucienu čatā</button>
      </div>
    </section>
  );
}
