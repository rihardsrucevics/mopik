"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import type { ResolvedPlace } from "@/lib/chat/places";

type Suggestion = ResolvedPlace & { kind: string };

const KIND_LABEL: Record<string, string> = {
  city: "pilsēta",
  town: "pilsēta",
  village: "ciems",
  hamlet: "viensēta",
  isolated_dwelling: "viensēta",
};

/**
 * A place field with suggestions. Typing shows Baltic settlements matching
 * the text; picking one stores its coordinates (`onPick`), so "Valmiera"
 * is the city the rider meant and not whatever a geocoder guesses later.
 * Typing without picking still works — the API then geocodes the name.
 */
export function PlaceInput({ value, onChange, onPick, placeholder, icon, label, className }: {
  value: string;
  onChange: (value: string) => void;
  onPick: (place: ResolvedPlace | null) => void;
  placeholder?: string;
  icon?: ReactNode;
  label?: ReactNode;
  className?: string;
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
        const res = await fetch(`/api/places?q=${encodeURIComponent(q)}`, { signal: controller.signal });
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
      <label className="block rounded-xl border border-stone-200 px-3 py-2 focus-within:border-[#f56300]">
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
      </label>
      {show && (
        <ul id={listId} role="listbox" className="absolute left-0 right-0 top-full z-20 mt-1 overflow-hidden rounded-xl border border-stone-200 bg-white shadow-lg">
          {suggestions.map((s, i) => (
            <li key={`${s.label}-${s.lat}`} role="option" aria-selected={i === active}
              onMouseDown={(e) => { e.preventDefault(); pick(s); }}
              className={`flex cursor-pointer items-baseline justify-between gap-3 px-3 py-2 text-sm ${i === active ? "bg-[#fff3ea]" : "hover:bg-stone-50"}`}>
              <span className="truncate"><span className="font-medium text-stone-900">{s.name}</span>{s.label !== s.name && <span className="text-stone-500">{s.label.slice(s.name.length)}</span>}</span>
              <span className="shrink-0 text-[10px] uppercase tracking-wider text-stone-400">{KIND_LABEL[s.kind] ?? s.kind}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
