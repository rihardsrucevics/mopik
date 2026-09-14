"use client";

import { useState } from "react";
import { Check, ChevronDown, ChevronUp, ExternalLink, Info, MapPin } from "lucide-react";
import { useLocale } from "@/lib/i18n/use-locale";
import { messages } from "@/lib/i18n/messages";
import { fi } from "@/lib/i18n/format";
import { POI_KIND, osmUrl, type RoutePoi, type RoutePois } from "@/lib/poi/kinds";

/** The plan's own cap (`RidePlanSchema` maxes `viaPlaces` at six). */
export const MAX_VIAS = 6;

/**
 * A place the rider has ticked, in the shape the pages need to make it a via.
 *
 * `id` is the dataset's OSM id and the identity the card selects on — two
 * hillforts can share a name, and the rider who ticks both means both.
 */
export type SelectedPoi = { id: string; name: string; lat: number; lon: number; category: string };

/**
 * Ieteikumi: its own block under the route card, never inside Detaļas.
 *
 * The rider said it plainly after seeing the first version live — the route's
 * own facts (CEĻI, RISKI, SEGUMS, DABA) are what Detaļas is for and are the
 * most important thing on the panel, and suggestions are a different kind of
 * statement: not "here is what you asked for" but "here is something else you
 * could do". Folded in among the numbers they competed with them; as a card
 * of their own, with the same expandable header Detaļas has, they are plainly
 * optional and plainly second.
 *
 * One component for both the planner and the shared-route page, for the same
 * reason `RouteActionRow` is one: the rider asked for the two pages to look
 * identical here, and two copies of a list drifted apart the moment one was
 * touched. `onRegenerate` decides whether a row can change the ride, and both
 * pages pass it whenever there is a plan to re-plan — /r/<code> is where the
 * rider's own saved rides open, so "a shared ride is someone else's" was never
 * true of the page he uses. Only a share code old enough to carry no plan
 * leaves it off, and then the rows simply offer Kartē and Vairāk.
 *
 * ## Ticking, not adding
 *
 * The "+" used to re-plan the whole ride on the spot, which the rider called
 * slow and inconvenient: every place he wanted cost a full generation, and he
 * could not see what three of them would do together. Now the control is a
 * checkbox and the regeneration is one button at the bottom — he goes down
 * the list, ticks what he likes, and asks for the ride once. The selection is
 * owned by the page (so closing and reopening the card keeps it, and the map
 * can draw a marker for each), which is why it arrives as props rather than
 * living here.
 */
export function SuggestionsCard({
  pois, loading, failed = false, expanded, onToggle, onShow,
  selected = [], onToggleSelect, onClearSelection, onRegenerate, viaCount = 0, includedNames = [], busy,
}: {
  /** null until the first expand has answered; both lists may be empty. */
  pois: RoutePois | null;
  loading: boolean;
  /** The lookup answered with an error. Says so, rather than hiding the card. */
  failed?: boolean;
  expanded: boolean;
  onToggle: () => void;
  /** Fly the map to a place and ring it. Absent where there is no map to fly. */
  onShow?: (poi: RoutePoi) => void;
  /** The ticked places, by dataset id. Owned by the page, not by this card. */
  selected?: SelectedPoi[];
  /** Tick or untick one row. Absent where the ride cannot be re-planned. */
  onToggleSelect?: (poi: SelectedPoi) => void;
  onClearSelection?: () => void;
  /** Append every ticked place as a via and plan the ride again. */
  onRegenerate?: () => void;
  /** Vias the ride already has, so the cap can be judged before the press. */
  viaCount?: number;
  /** Names of places this ride already passes as vias: they show "iekļauts". */
  includedNames?: string[];
  busy?: boolean;
}) {
  const [locale] = useLocale();
  const m = messages(locale);
  const count = pois ? pois.onRoute.length + pois.nearby.length : 0;
  const selectedIds = new Set(selected.map((s) => s.id));
  const included = new Set(includedNames);
  // Six is the plan's own ceiling, so the button is judged against what the
  // ride already carries plus what is ticked — not against the ticks alone.
  const overCap = viaCount + selected.length > MAX_VIAS;

  // Nothing to offer is not a card. Before the first expand there is no answer
  // yet, so the header is shown on the promise that a ride usually has places
  // near it; once the lookup has answered with nothing — which is every ride
  // outside the Baltics until item 8 lands — the block goes away rather than
  // standing there as a heading with an empty inside. A *failed* lookup is not
  // the same statement as an empty one and keeps its card: the rider is told
  // it did not load, instead of being quietly shown a ride with no sights.
  if (pois && count === 0 && !failed) return null;

  return (
    <div className="rounded-xl border border-stone-200">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={expanded}
        className="flex w-full items-center justify-between gap-2 px-3 py-2.5 text-left"
      >
        <span className="flex min-w-0 items-center gap-1.5 text-xs font-semibold text-stone-700">
          {m.resSuggestions}
          {/* A quiet "…" while the answer is on its way: the count is the
              point of the header, and showing a wrong one (or a 0 that will
              become 7) is worse than showing that it is still being counted. */}
          <span className="tabular-nums font-normal text-stone-400">
            {"· "}{pois ? count : loading ? "…" : "…"}
          </span>
        </span>
        {expanded ? <ChevronUp className="size-3.5 shrink-0 text-stone-500" /> : <ChevronDown className="size-3.5 shrink-0 text-stone-500" />}
      </button>
      {expanded && failed && !pois && (
        <p role="status" className="border-t border-stone-100 px-3 py-2 text-[11px] text-stone-500">{m.resSuggestFailed}</p>
      )}
      {expanded && pois && (
        /* The list scrolls inside the card on a phone so the action bar below
           it stays put — the rider ticks something near the bottom of a long
           list and the button is still there. `max-h` only bites when the list
           is long enough to need it; on a desktop the column is tall enough
           that it rarely does. */
        <div className="border-t border-stone-100">
          <div className="max-h-[52vh] space-y-2 overflow-y-auto px-3 pb-3 pt-2 md:max-h-none md:overflow-visible">
            {pois.onRoute.length > 0 && (
              <div>
                <div className="mb-0.5 text-[10px] font-medium uppercase tracking-wider text-stone-400">{m.resSuggestOnRoute}</div>
                {pois.onRoute.map((p) => (
                  <PoiRow key={p.id} poi={p} m={m} onRoute onShow={onShow} included={included.has(p.name)} />
                ))}
              </div>
            )}
            {pois.nearby.length > 0 && (
              <div>
                <div className="mb-0.5 text-[10px] font-medium uppercase tracking-wider text-stone-400">{m.resSuggestNearby}</div>
                {pois.nearby.map((p) => (
                  <PoiRow
                    key={p.id} poi={p} m={m} onShow={onShow} busy={busy}
                    included={included.has(p.name)}
                    selected={selectedIds.has(p.id)}
                    onToggleSelect={onToggleSelect}
                  />
                ))}
              </div>
            )}
          </div>
          {selected.length > 0 && onRegenerate && (
            /* Sticky so it survives the list's own scroll on a phone. The
               count is in the label rather than beside it: "Pārģenerēt ar 3
               objektiem" is the whole sentence, and a bare number next to a
               verb reads as a badge. */
            <div className="sticky bottom-0 space-y-1.5 rounded-b-xl border-t border-stone-200 bg-white/95 px-3 py-2 backdrop-blur">
              {overCap && (
                <p role="status" className="text-[11px] leading-snug text-stone-500">{fi(m.resSelectionCapNote, { max: MAX_VIAS })}</p>
              )}
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={onRegenerate}
                  disabled={busy || overCap}
                  className="flex h-9 flex-1 items-center justify-center rounded-full bg-[#f56300] px-3 text-xs font-semibold text-white transition hover:bg-[#d85600] disabled:opacity-40"
                >
                  {fi(selected.length === 1 ? m.resRegenerateOne : m.resRegenerateMany, { n: selected.length })}
                </button>
                <button
                  type="button"
                  onClick={onClearSelection}
                  className="h-9 shrink-0 rounded-full px-3 text-xs font-medium text-stone-500 transition hover:bg-stone-100 hover:text-stone-900"
                >
                  {m.resSelectionClear}
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Metres for a short detour, one decimal of a kilometre past that: "1.2 km
 * off" is easier to judge than "1240 m off".
 */
function offFigure(meters: number): string {
  return meters < 1000 ? `${meters} m` : `${Math.round(meters / 100) / 10} km`;
}

/**
 * One suggestion, with the three things the rider asked to be able to do with
 * it: look at it on the map, read what is known about it, put it in the ride.
 *
 * The actions are icons rather than words because there are three of them on
 * a row that already carries a name, a kind and a figure — measured at 390 px,
 * three labelled buttons leave the place name about eleven characters. Each
 * carries an aria-label from the dictionary, so the words are there for a
 * screen reader and in the tooltip.
 *
 * A row in "Trasē" gets no tick: the ride is already going there, and a
 * control that would silently do nothing is worse than no control. Vairāk says
 * so in words when it is opened. A row the ride *already stops at* — one the
 * rider ticked on a previous pass — says "iekļauts" instead, which is the one
 * thing the list could not say before.
 */
function PoiRow({ poi, m, onRoute = false, onShow, selected = false, onToggleSelect, included = false, busy }: {
  poi: RoutePoi;
  m: ReturnType<typeof messages>;
  onRoute?: boolean;
  onShow?: (poi: RoutePoi) => void;
  selected?: boolean;
  onToggleSelect?: (poi: SelectedPoi) => void;
  /** This place is already a via of the current ride. */
  included?: boolean;
  busy?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const kind = POI_KIND[poi.category];
  const kindLabel = m[kind.key as keyof typeof m] ?? poi.category;
  const figure = onRoute ? `${poi.alongKm} km` : offFigure(poi.distanceMeters);

  return (
    <div className={`border-b border-stone-100 py-1 last:border-b-0 ${selected ? "-mx-1 rounded-lg bg-[#fff3ea] px-1" : ""}`}>
      <div className="flex items-center gap-2 text-xs">
        <span aria-hidden="true" className="shrink-0 text-[12px] leading-none">{kind.icon}</span>
        <span className="min-w-0 flex-1 truncate">
          <span className="text-stone-900">{poi.name}</span>
          <span className="text-stone-400">{" · "}</span>
          <span className="text-stone-500">{kindLabel}</span>
        </span>
        <span className="shrink-0 tabular-nums text-[11px] text-stone-500">{figure}</span>
        <div className="flex shrink-0 items-center gap-0.5">
          {included && (
            <span className="shrink-0 rounded-full bg-[#fff3ea] px-1.5 py-0.5 text-[10px] font-medium text-[#bd4b00]">{m.resPoiIncluded}</span>
          )}
          {onShow && (
            <button
              type="button"
              onClick={() => onShow(poi)}
              aria-label={fi(m.resPoiShowAria, { place: poi.name })}
              title={fi(m.resPoiShowAria, { place: poi.name })}
              className="flex size-7 items-center justify-center rounded-full text-stone-500 transition hover:bg-stone-100 hover:text-stone-900"
            >
              <MapPin className="size-3.5" />
            </button>
          )}
          <button
            type="button"
            onClick={() => setOpen(!open)}
            aria-expanded={open}
            aria-label={fi(m.resPoiMoreAria, { place: poi.name })}
            title={fi(m.resPoiMoreAria, { place: poi.name })}
            className={`flex size-7 items-center justify-center rounded-full transition hover:bg-stone-100 ${open ? "bg-stone-100 text-stone-900" : "text-stone-500 hover:text-stone-900"}`}
          >
            <Info className="size-3.5" />
          </button>
          {/* A place the ride already visits offers no tick: ticking it again
              would ask for a via it already has. Kartē and Vairāk stay. */}
          {onToggleSelect && !included && (
            <button
              type="button"
              role="checkbox"
              aria-checked={selected}
              onClick={() => onToggleSelect({ id: poi.id, name: poi.name, lat: poi.lat, lon: poi.lon, category: poi.category })}
              disabled={busy}
              aria-label={fi(selected ? m.resPoiDeselectAria : m.resPoiSelectAria, { place: poi.name })}
              title={fi(selected ? m.resPoiDeselectAria : m.resPoiSelectAria, { place: poi.name })}
              className={`flex size-7 items-center justify-center rounded-full border transition disabled:opacity-40 ${
                selected
                  ? "border-[#f56300] bg-[#f56300] text-white"
                  : "border-stone-300 text-transparent hover:border-[#f56300] hover:text-[#f5630055]"
              }`}
            >
              <Check className="size-3.5" strokeWidth={3} />
            </button>
          )}
        </div>
      </div>
      {open && (
        /* What the dataset actually knows, and nothing invented.
           `public/poi-baltics.geojson` carries exactly six properties per
           place — id, category, score, country, nameLv/nameEn (+ a Latvian
           accusative for a third of them) — so the only facts worth a row are
           the kind, where the place sits relative to this ride, and a link to
           the OSM object the row came from. `score` is the loop-anchor weight
           and means nothing to a rider; `country` is already obvious from the
           ride. The honest line says so, rather than padding the panel with
           empty labels. */
        <dl className="mt-1 space-y-0.5 rounded-lg bg-stone-50 px-2 py-1.5 text-[11px]">
          <Fact label={m.resPoiKind} value={String(kindLabel)} />
          <Fact label={m.resPoiAlong} value={`${poi.alongKm} km`} />
          {!onRoute && <Fact label={m.resPoiOff} value={offFigure(poi.distanceMeters)} />}
          <div className="flex items-center justify-between gap-3 pt-0.5">
            <span className="text-stone-500">{m.resPoiNoDetail}</span>
          </div>
          <div className="flex flex-wrap items-center gap-3 pt-0.5">
            {onRoute && <span className="text-stone-500">{m.resPoiOnRouteNote}</span>}
            <a
              href={osmUrl(poi)}
              target="_blank"
              rel="noreferrer"
              aria-label={fi(m.resPoiOsmAria, { place: poi.name })}
              className="inline-flex items-center gap-1 font-medium text-[#f56300] underline underline-offset-2"
            >
              {m.resPoiOsm}
              <ExternalLink className="size-3" />
            </a>
          </div>
        </dl>
      )}
    </div>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-stone-500">{label}</dt>
      <dd className="tabular-nums text-stone-900">{value}</dd>
    </div>
  );
}
