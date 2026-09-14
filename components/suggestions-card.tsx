"use client";

import { useState } from "react";
import { ChevronDown, ChevronUp, ExternalLink, Info, MapPin, Plus } from "lucide-react";
import { useLocale } from "@/lib/i18n/use-locale";
import { messages } from "@/lib/i18n/messages";
import { fi } from "@/lib/i18n/format";
import { POI_KIND, osmUrl, type RoutePoi, type RoutePois } from "@/lib/poi/kinds";

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
 * touched. `onAdd` decides whether a row can change the ride, and both pages
 * pass it whenever there is a plan to re-plan — /r/<code> is where the rider's
 * own saved rides open, so "a shared ride is someone else's" was never true of
 * the page he uses. Only a share code old enough to carry no plan leaves it
 * off, and then the rows simply offer Kartē and Vairāk.
 */
export function SuggestionsCard({ pois, loading, expanded, onToggle, onShow, onAdd, busy }: {
  /** null until the first expand has answered; both lists may be empty. */
  pois: RoutePois | null;
  loading: boolean;
  expanded: boolean;
  onToggle: () => void;
  /** Fly the map to a place and ring it. Absent where there is no map to fly. */
  onShow?: (poi: RoutePoi) => void;
  /** Make it a stop and plan the ride again. Nearby rows only. */
  onAdd?: (place: { name: string; lat: number; lon: number }) => void;
  busy?: boolean;
}) {
  const [locale] = useLocale();
  const m = messages(locale);
  const count = pois ? pois.onRoute.length + pois.nearby.length : 0;

  // Nothing to offer is not a card. Before the first expand there is no answer
  // yet, so the header is shown on the promise that a ride usually has places
  // near it; once the lookup has answered with nothing — which is every ride
  // outside the Baltics until item 8 lands — the block goes away rather than
  // standing there as a heading with an empty inside.
  if (pois && count === 0) return null;

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
      {expanded && pois && (
        <div className="space-y-2 border-t border-stone-100 px-3 pb-3 pt-2">
          {pois.onRoute.length > 0 && (
            <div>
              <div className="mb-0.5 text-[10px] font-medium uppercase tracking-wider text-stone-400">{m.resSuggestOnRoute}</div>
              {pois.onRoute.map((p) => (
                <PoiRow key={p.id} poi={p} m={m} onRoute onShow={onShow} />
              ))}
            </div>
          )}
          {pois.nearby.length > 0 && (
            <div>
              <div className="mb-0.5 text-[10px] font-medium uppercase tracking-wider text-stone-400">{m.resSuggestNearby}</div>
              {pois.nearby.map((p) => (
                <PoiRow key={p.id} poi={p} m={m} onShow={onShow} onAdd={onAdd} busy={busy} />
              ))}
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
 * it: look at it on the map, read what is known about it, add it to the ride.
 *
 * The actions are icons rather than words because there are three of them on
 * a row that already carries a name, a kind and a figure — measured at 390 px,
 * three labelled buttons leave the place name about eleven characters. Each
 * carries an aria-label from the dictionary, so the words are there for a
 * screen reader and in the tooltip.
 *
 * A row in "Trasē" gets no Pievienot: the ride is already going there, and a
 * button that would silently do nothing is worse than no button. Vairāk says
 * so in words when it is opened.
 */
function PoiRow({ poi, m, onRoute = false, onShow, onAdd, busy }: {
  poi: RoutePoi;
  m: ReturnType<typeof messages>;
  onRoute?: boolean;
  onShow?: (poi: RoutePoi) => void;
  onAdd?: (place: { name: string; lat: number; lon: number }) => void;
  busy?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const kind = POI_KIND[poi.category];
  const kindLabel = m[kind.key as keyof typeof m] ?? poi.category;
  const figure = onRoute ? `${poi.alongKm} km` : offFigure(poi.distanceMeters);

  return (
    <div className="border-b border-stone-100 py-1 last:border-b-0">
      <div className="flex items-center gap-2 text-xs">
        <span aria-hidden="true" className="shrink-0 text-[12px] leading-none">{kind.icon}</span>
        <span className="min-w-0 flex-1 truncate">
          <span className="text-stone-900">{poi.name}</span>
          <span className="text-stone-400">{" · "}</span>
          <span className="text-stone-500">{kindLabel}</span>
        </span>
        <span className="shrink-0 tabular-nums text-[11px] text-stone-500">{figure}</span>
        <div className="flex shrink-0 items-center gap-0.5">
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
          {onAdd && (
            <button
              type="button"
              onClick={() => onAdd({ name: poi.name, lat: poi.lat, lon: poi.lon })}
              disabled={busy}
              aria-label={fi(m.resAddStopAria, { place: poi.name })}
              title={fi(m.resAddStopAria, { place: poi.name })}
              className="flex size-7 items-center justify-center rounded-full text-[#f56300] transition hover:bg-[#f5630012] disabled:opacity-40"
            >
              <Plus className="size-3.5" />
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
