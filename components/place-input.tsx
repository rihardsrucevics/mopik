"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import type { ResolvedPlace } from "@/lib/chat/places";

type Suggestion = ResolvedPlace & { kind: string; kindLabel?: string };

const KIND_LABEL: Record<string, string> = {
  city: "pilsēta",
  town: "pilsēta",
  village: "ciems",
  hamlet: "viensēta",
  isolated_dwelling: "viensēta",
};

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
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const listId = useId();
  const skipNextSearch = useRef(false);

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
    onPick({ name: s.name, label: s.label, lat: s.lat, lon: s.lon });
    setSuggestions([]);
    setOpen(false);
  };

  const show = open && suggestions.length > 0;

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
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 120)}
          onKeyDown={(e) => {
            if (!show) return;
            if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => Math.min(suggestions.length - 1, a + 1)); }
            else if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(0, a - 1)); }
            else if (e.key === "Enter" && active >= 0) { e.preventDefault(); pick(suggestions[active]); }
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
          {suggestions.map((s, i) => (
            <li key={`${s.label}-${s.lat}`} role="option" aria-selected={i === active}
              onMouseDown={(e) => { e.preventDefault(); pick(s); }}
              className={`flex cursor-pointer items-baseline justify-between gap-3 px-3 py-2 text-sm ${i === active ? "bg-[#fff3ea]" : "hover:bg-stone-50"}`}>
              <span className="truncate"><span className="font-medium text-stone-900">{s.name}</span>{s.label !== s.name && <span className="text-stone-500">{s.label.slice(s.name.length)}</span>}</span>
              <span className="shrink-0 text-[10px] uppercase tracking-wider text-stone-400">{s.kindLabel ? "" : KIND_LABEL[s.kind] ?? ""}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
