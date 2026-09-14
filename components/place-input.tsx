"use client";

import { useEffect, useId, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { useLocale } from "@/lib/i18n/use-locale";
import { recentPlacesStore, refreshRecentPlaces, rememberPlace } from "@/lib/chat/recent-places";
import { messages, type MessageKey } from "@/lib/i18n/messages";
import type { PlaceKind } from "@/lib/chat/photon";
import type { ResolvedPlace } from "@/lib/chat/places";

type Suggestion = ResolvedPlace & { kind: PlaceKind | "recent" };

/**
 * A place kind, as the dictionary key that names it in each language.
 *
 * The API answers with a machine kind and nothing else — it has no locale to
 * write in, and the Latvian word it used to send arrived verbatim in the
 * English and Lithuanian lists. Translation belongs here, where the rider's
 * language is known.
 *
 * `settlement` and `recent` are deliberately absent: a city needs no word
 * beside its name, and neither does a place the rider has picked before.
 */
const KIND_KEY = {
  address: "kindAddress",
  place: "kindPlace",
  fuel: "kindFuel",
  charging: "kindCharging",
  restaurant: "kindRestaurant",
  cafe: "kindCafe",
  parking: "kindParking",
  hotel: "kindHotel",
  campsite: "kindCampsite",
  attraction: "kindAttraction",
  viewpoint: "kindViewpoint",
  museum: "kindMuseum",
  castle: "kindCastle",
  ruins: "kindRuins",
  manor: "kindManor",
  monument: "kindMonument",
  peak: "kindPeak",
  beach: "kindBeach",
  water: "kindWater",
  waterfall: "kindWaterfall",
  natureReserve: "kindNatureReserve",
  nationalPark: "kindNationalPark",
  protectedArea: "kindProtectedArea",
  hillfort: "kindHillfort",
  fort: "kindFort",
  church: "kindChurch",
  memorial: "kindMemorial",
  artwork: "kindArtwork",
  cave: "kindCave",
  cliff: "kindCliff",
  spring: "kindSpring",
  park: "kindPark",
} as const satisfies Partial<Record<PlaceKind, MessageKey>>;

/**
 * A place field with suggestions. Typing shows matching places — worldwide,
 * ranked nearest to `near` or to the rider's own region; picking one stores
 * its coordinates (`onPick`), so "Valmiera" is the city the rider meant and
 * not whatever a geocoder guesses later. Typing without picking still works —
 * the API then geocodes the name.
 */
export function PlaceInput({ value, onChange, onPick, placeholder, icon, label, className, trailing, near }: {
  value: string;
  onChange: (value: string) => void;
  onPick: (place: ResolvedPlace | null) => void;
  placeholder?: string;
  icon?: ReactNode;
  label?: ReactNode;
  className?: string;
  /**
   * A place already chosen in this ride, used to bias the search. Picking
   * Sigulda as the start should make the other rows offer Latvian places
   * rather than whatever shares the name worldwide.
   */
  near?: { lat: number; lon: number } | null;
  /**
   * Controls that belong to this field — clear it, reorder its row — rendered
   * inside the frame, on the right. Inside rather than beside it so the field
   * itself is always full width: a column reserved next to the field is empty
   * space whenever the control is not there, and a place name is exactly the
   * thing that must not be truncated.
   */
  trailing?: ReactNode;
}) {
  const [locale] = useLocale();
  const m = messages(locale);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const listId = useId();
  const skipNextSearch = useRef(false);
  // The recent places as an external store, the same shape as `useLocale`.
  // `localStorage` is nothing on the server, so the server snapshot is empty
  // and React swaps in the device's own list on the client — no read during
  // render (a hydration mismatch) and no setState from a mount effect.
  //
  // Every write publishes to every field, which is what a mount-only read
  // used to get wrong: the rider saved Sigulda in "From", opened "To", and
  // was offered nothing. Focus still re-reads, for a change made in another
  // tab.
  const stored = useSyncExternalStore(
    recentPlacesStore.subscribe,
    recentPlacesStore.snapshot,
    recentPlacesStore.serverSnapshot,
  );
  const recent = useMemo<Suggestion[]>(() => stored.map((p) => ({ ...p, kind: "recent" as const })), [stored]);

  useEffect(() => {
    if (skipNextSearch.current) { skipNextSearch.current = false; return; }
    const q = value.trim();
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      if (q.length < 2) { setSuggestions([]); return; }
      try {
        const nearParam = near ? `&near=${near.lat.toFixed(4)},${near.lon.toFixed(4)}` : "";
        const res = await fetch(`/api/places?q=${encodeURIComponent(q)}${nearParam}`, { signal: controller.signal });
        if (!res.ok) return;
        const data = (await res.json()) as { places: Suggestion[] };
        setSuggestions(data.places);
        setActive(-1);
      } catch {
        // aborted or offline: keep whatever is shown
      }
    }, 250);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [value]);

  const pick = (s: Suggestion) => {
    skipNextSearch.current = true;
    onChange(s.name);
    const place = { name: s.name, label: s.label, lat: s.lat, lon: s.lon };
    rememberPlace(place);
    onPick(place);
    setSuggestions([]);
    setOpen(false);
  };

  // An empty field shows what the rider has used before; typing switches to
  // search results. Two letters is where the API starts answering, so below
  // that the recent list is the only thing worth showing.
  const listed = value.trim().length >= 2 ? suggestions : recent;

  // Settlements, recent places and anything the API sends that this build does
  // not know about show no word at all — an untranslated kind is worse than a
  // blank, and the name already carries the meaning.
  const kindLabel = (kind: Suggestion["kind"]) => {
    const key = KIND_KEY[kind as keyof typeof KIND_KEY];
    return key ? m[key] : "";
  };
  const show = open && listed.length > 0;

  return (
    <div className={`relative ${className ?? ""}`}>
      <label className="flex items-center gap-2 rounded-xl border border-stone-200 px-3 py-2 focus-within:border-[#f56300]">
        <span className="min-w-0 flex-1">
        {label && <span className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-stone-400">{icon}{label}</span>}
        <input
          value={value}
          role="combobox"
          aria-expanded={show}
          aria-controls={listId}
          aria-autocomplete="list"
          onChange={(e) => { onChange(e.target.value); onPick(null); setOpen(true); }}
          onFocus={() => { refreshRecentPlaces(); setOpen(true); }}
          onBlur={() => setTimeout(() => setOpen(false), 120)}
          onKeyDown={(e) => {
            if (!show) return;
            if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => Math.min(listed.length - 1, a + 1)); }
            else if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(0, a - 1)); }
            else if (e.key === "Enter" && active >= 0) { e.preventDefault(); pick(listed[active]); }
            else if (e.key === "Escape") setOpen(false);
          }}
          className="mt-1 w-full bg-transparent text-base font-medium outline-none md:text-sm"
          placeholder={placeholder}
        />
        </span>
        {trailing}
      </label>
      {show && (
        <ul id={listId} role="listbox" className="absolute left-0 right-0 top-full z-20 mt-1 overflow-hidden rounded-xl border border-stone-200 bg-white shadow-lg">
          {listed.map((s, i) => (
            <li key={`${s.label}-${s.lat}`} role="option" aria-selected={i === active}
              onMouseDown={(e) => { e.preventDefault(); pick(s); }}
              className={`flex cursor-pointer items-baseline justify-between gap-3 px-3 py-2 text-sm ${i === active ? "bg-[#fff3ea]" : "hover:bg-stone-50"}`}>
              <span className="truncate"><span className="font-medium text-stone-900">{s.name}</span>{s.label !== s.name && <span className="text-stone-500">{s.label.slice(s.name.length)}</span>}</span>
              <span className="shrink-0 text-[10px] uppercase tracking-wider text-stone-400">{kindLabel(s.kind)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
