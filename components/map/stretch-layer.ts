"use client";

import { useEffect, useRef, type RefObject } from "react";
import * as maplibregl from "maplibre-gl";
import type { Point } from "@/lib/geo/geometry";
import { cumulative } from "@/lib/routing/detour";
import { coordinatesOf, nearestAlong } from "@/lib/routing/reroute-leg";
import { moveStretchEnd, stretchLine, type Stretch } from "@/lib/routing/stretch";
import type { RouteSegmentProperties } from "@/lib/types";

/**
 * Backlog 36 on the map (design B3, P4-C):
 *
 * - The selected stretch in the badge highlight's own yellow (`route-highlight`'s
 *   paint, cloned as the proposal halo is), with two end handles — DOM
 *   markers, so a press on one never grabs the line (the line drag skips
 *   `.maplibregl-marker`), and maplibre's marker drag works with a finger.
 *   A handle follows the finger along the line, never off it; the stretch is
 *   redrawn live and the composer told on every step (`done` on release).
 * - The ride's excluded stretches in edit mode: thin dark-red dashes along
 *   the road the ride no longer uses; a tap on one (a wide invisible hit
 *   line) is `onExcludedTap(index)` → „Atļaut atkal”.
 */

export type StretchSelection = {
  fromMeters: number;
  toMeters: number;
  onChange: (s: Stretch, done: boolean) => void;
  labels: { from: string; to: string };
};

export type ExcludedStretches = { lines: Point[][]; onTap?: (index: number) => void; selected?: number | null };

type Segs = GeoJSON.FeatureCollection<GeoJSON.LineString, RouteSegmentProperties>;

const SEL_SOURCE = "stretch-sel";
const SEL_LAYER = "stretch-sel";
const EX_SOURCE = "stretch-excluded";
const EX_LAYER = "stretch-excluded";
const EX_HIT = "stretch-excluded-hit";
export const EXCLUDED_COLOR = "#7f1d1d";

function handleEl(label: string, end: "from" | "to"): HTMLElement {
  const el = document.createElement("button");
  el.type = "button";
  el.setAttribute("aria-label", label);
  el.title = label;
  el.dataset.stretchHandle = end;
  // 44 px touch target round a 20 px disc.
  el.style.cssText = "width:44px;height:44px;display:flex;align-items:center;justify-content:center;background:transparent;border:0;padding:0;touch-action:none;cursor:grab;";
  const dot = document.createElement("span");
  dot.style.cssText = "display:block;width:20px;height:20px;border-radius:9999px;background:#fff;border:4px solid #eab308;box-shadow:0 1px 4px rgba(0,0,0,.45);";
  el.appendChild(dot);
  return el;
}

const lineFeature = (coords: Point[]): GeoJSON.Feature<GeoJSON.LineString> => ({ type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: coords } });

export function useStretchLayer(mapRef: RefObject<maplibregl.Map | null>, ready: boolean, segments: Segs | null, stretch: StretchSelection | null, excluded: ExcludedStretches | null): void {
  const selRef = useRef(stretch);
  useEffect(() => { selRef.current = stretch; });
  const exRef = useRef(excluded);
  useEffect(() => { exRef.current = excluded; });
  const on = Boolean(stretch);
  const fromM = stretch?.fromMeters ?? 0;
  const toM = stretch?.toMeters ?? 0;
  const labelFrom = stretch?.labels.from ?? "";
  const labelTo = stretch?.labels.to ?? "";
  /** The live effect's way to take a new selection from the composer (not while a handle is held). */
  const syncRef = useRef<((s: Stretch) => void) | null>(null);

  // The selection and its handles.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready || !on || !segments) return;
    const line = coordinatesOf(segments);
    if (line.length < 2) return;
    const cum = cumulative(line);
    const total = cum[cum.length - 1];
    let cur: Stretch = { fromMeters: selRef.current?.fromMeters ?? 0, toMeters: selRef.current?.toMeters ?? 0 };
    let dragging = false;
    const data = () => lineFeature(stretchLine(line, cum, cur));
    const draw = () => {
      if (!map.getLayer("route-highlight")) return false;
      const src = map.getSource(SEL_SOURCE) as maplibregl.GeoJSONSource | undefined;
      if (src) { src.setData(data()); return true; }
      map.addSource(SEL_SOURCE, { type: "geojson", data: data() });
      const spec = (map.getStyle().layers ?? []).find((l) => l.id === "route-highlight") as maplibregl.LineLayerSpecification | undefined;
      const layers = map.getStyle().layers ?? [];
      const above = layers[layers.findIndex((l) => l.id === "route-highlight") + 1]?.id;
      map.addLayer({
        id: SEL_LAYER, type: "line", source: SEL_SOURCE,
        layout: { "line-cap": "round", "line-join": "round" },
        // Stronger than the badge highlight so it reads as a selection, not a hint.
        paint: { ...(spec?.paint ?? {}), "line-opacity": 0.85 },
      }, above);
      return true;
    };
    try { draw(); } catch { /* style not ready — redrawn on styledata */ }
    const onStyle = () => { try { if (!map.getSource(SEL_SOURCE)) draw(); } catch { /* reloading */ } };
    map.on("styledata", onStyle);
    const at = (m: number) => { const p = stretchLine(line, cum, { fromMeters: m, toMeters: m }); return p[0]; };
    const make = (end: "from" | "to") => {
      const mk = new maplibregl.Marker({ element: handleEl(end === "from" ? labelFrom : labelTo, end), draggable: true })
        .setLngLat(at(end === "from" ? cur.fromMeters : cur.toMeters) as [number, number]).addTo(map);
      const step = (done: boolean) => {
        const ll = mk.getLngLat();
        const near = nearestAlong([ll.lng, ll.lat], line, cum);
        cur = moveStretchEnd(cur, end, near.alongMeters, total);
        mk.setLngLat(at(end === "from" ? cur.fromMeters : cur.toMeters) as [number, number]);
        try { draw(); } catch { /* ignore */ }
        selRef.current?.onChange(cur, done);
      };
      mk.on("dragstart", () => { dragging = true; });
      mk.on("drag", () => step(false));
      mk.on("dragend", () => { dragging = false; step(true); });
      // A tap on a handle is not a tap on the map.
      mk.getElement().addEventListener("click", (e) => e.stopPropagation());
      return mk;
    };
    const handles = [make("from"), make("to")];
    syncRef.current = (next) => {
      if (dragging || (next.fromMeters === cur.fromMeters && next.toMeters === cur.toMeters)) return;
      cur = next;
      handles[0].setLngLat(at(cur.fromMeters) as [number, number]);
      handles[1].setLngLat(at(cur.toMeters) as [number, number]);
      try { draw(); } catch { /* ignore */ }
    };
    return () => {
      syncRef.current = null;
      map.off("styledata", onStyle);
      for (const h of handles) h.remove();
      try {
        if (map.getLayer(SEL_LAYER)) map.removeLayer(SEL_LAYER);
        if (map.getSource(SEL_SOURCE)) map.removeSource(SEL_SOURCE);
      } catch { /* map gone */ }
    };
  }, [mapRef, ready, on, segments, labelFrom, labelTo]);
  // A selection changed by the composer (a snap to the second pass): the handles follow.
  useEffect(() => { syncRef.current?.({ fromMeters: fromM, toMeters: toM }); }, [fromM, toM]);

  // The excluded stretches.
  const exKey = excluded ? JSON.stringify(excluded.lines) + (excluded.selected ?? "") : "";
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready || !exKey) return;
    const lines = exRef.current?.lines ?? [];
    const sel = exRef.current?.selected ?? null;
    const fc: GeoJSON.FeatureCollection<GeoJSON.LineString> = {
      type: "FeatureCollection",
      features: lines.map((l, i) => ({ ...lineFeature(l), properties: { i, sel: i === sel } })),
    };
    const draw = () => {
      if (!map.getLayer("route-road")) return;
      const src = map.getSource(EX_SOURCE) as maplibregl.GeoJSONSource | undefined;
      if (src) { src.setData(fc); return; }
      map.addSource(EX_SOURCE, { type: "geojson", data: fc });
      map.addLayer({
        id: EX_LAYER, type: "line", source: EX_SOURCE,
        layout: { "line-cap": "butt", "line-join": "round" },
        paint: { "line-color": EXCLUDED_COLOR, "line-width": ["case", ["get", "sel"], 4, 2.5], "line-dasharray": [2, 1.6], "line-opacity": 0.9 },
      });
      map.addLayer({ id: EX_HIT, type: "line", source: EX_SOURCE, paint: { "line-color": "#000", "line-width": 22, "line-opacity": 0 } });
    };
    try { draw(); } catch { /* style not ready */ }
    const onStyle = () => { try { if (!map.getSource(EX_SOURCE)) draw(); } catch { /* reloading */ } };
    map.on("styledata", onStyle);
    const onClick = (e: maplibregl.MapLayerMouseEvent) => {
      const i = e.features?.[0]?.properties?.i;
      if (typeof i !== "number" || !exRef.current?.onTap) return;
      e.preventDefault();
      exRef.current.onTap(i);
    };
    map.on("click", EX_HIT, onClick);
    return () => {
      map.off("styledata", onStyle);
      map.off("click", EX_HIT, onClick);
      try {
        for (const id of [EX_HIT, EX_LAYER]) if (map.getLayer(id)) map.removeLayer(id);
        if (map.getSource(EX_SOURCE)) map.removeSource(EX_SOURCE);
      } catch { /* map gone */ }
    };
  }, [mapRef, ready, exKey]);
}

/** Whether a map click was an excluded stretch's (the ride's own click handler leaves it alone). */
export function clickOnExcluded(map: maplibregl.Map, point: maplibregl.Point): boolean {
  try { return map.getLayer(EX_HIT) ? map.queryRenderedFeatures(point, { layers: [EX_HIT] }).length > 0 : false; } catch { return false; }
}
