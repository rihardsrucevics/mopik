"use client";

import { useEffect, useRef } from "react";
import * as maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { RouteSegmentProperties } from "@/lib/types";

// Serve the MapLibre worker from /public — bundler-emitted module workers
// 404 under the Next.js dev server, leaving the map blank.
maplibregl.setWorkerUrl("/maplibre-gl-worker.mjs");

type Props = {
  segments: GeoJSON.FeatureCollection<GeoJSON.LineString, RouteSegmentProperties> | null;
  start: { lat: number; lon: number } | null;
  destination?: { lat: number; lon: number } | null;
  via?: { lat: number; lon: number; label: string }[];
  showTet: boolean;
  onToggleTet: (visible: boolean) => void;
};

const EMPTY: GeoJSON.FeatureCollection = { type: "FeatureCollection", features: [] };

/**
 * The TET overlay, fetched per country for whatever the map is showing.
 *
 * The trail is 118,246 km across 33 countries — 4 MB of GeoJSON as one file,
 * and simplifying it to a phone-sized download costs the shape (1.1 points/km
 * against the 7.1 the Latvia-only layer had). `public/tet/index.json` carries
 * a bounding box per country, so the map can decide what it needs before
 * downloading anything, and each country is ~231 KB — the same scale that
 * already worked.
 */
type TetIndex = Record<string, { bbox: [number, number, number, number] }>;
let tetIndex: TetIndex | null = null;
const tetLoaded = new Map<string, GeoJSON.Feature[]>();

async function loadTet(map: maplibregl.Map) {
  try {
    tetIndex ??= (await (await fetch("/tet/index.json")).json()) as TetIndex;
    const b = map.getBounds();
    const visible = Object.entries(tetIndex)
      .filter(([, { bbox }]) =>
        bbox[0] <= b.getEast() && bbox[2] >= b.getWest() &&
        bbox[1] <= b.getNorth() && bbox[3] >= b.getSouth())
      .map(([country]) => country);

    const missing = visible.filter((c) => !tetLoaded.has(c));
    if (!missing.length) return;
    await Promise.all(missing.map(async (country) => {
      // Mark it taken first: panning fires this faster than a fetch returns,
      // and the same country must not be downloaded twice.
      tetLoaded.set(country, []);
      const res = await fetch(`/tet/${country}.geojson`);
      if (!res.ok) { tetLoaded.delete(country); return; }
      const fc = (await res.json()) as GeoJSON.FeatureCollection;
      tetLoaded.set(country, fc.features);
    }));

    const source = map.getSource("tet") as maplibregl.GeoJSONSource | undefined;
    source?.setData({ type: "FeatureCollection", features: [...tetLoaded.values()].flat() });
  } catch {
    // An optional overlay must never break the map.
  }
}

// Our own consistent adventure legend — deliberately NOT a copy of any OSM renderer.
// Line COLOR encodes the surface, line STYLE encodes the road class:
// solid = road, dashed = track, dotted = trail. A gravel public road is a
// solid orange line; an asphalt track is a dashed blue one.
const PAVED_COLOR = "#0071e3";
const GRAVEL_COLOR = "#f56300";
const DIRT_COLOR = "#8f5a24";
// Dark enough to read against the light basemap: unknown surface is often a
// third of a forest route, and at the old light grey those stretches looked
// like gaps in the line rather than part of it.
const UNKNOWN_COLOR = "#5b5b60";
const TRAIL_COLOR = "#ff3b30"; // trails are always red — they are the risk signal
const TET_COLOR = "#af52de"; // TET overlay

const SURFACE_COLOR_EXPR: maplibregl.ExpressionSpecification = [
  "match",
  ["get", "surface"],
  "asphalt",
  PAVED_COLOR,
  ["gravel", "compacted"],
  GRAVEL_COLOR,
  ["ground", "dirt", "sand"],
  DIRT_COLOR,
  UNKNOWN_COLOR,
];

export function RouteMap({ segments, start, destination, via, showTet, onToggleTet }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const markerRef = useRef<maplibregl.Marker | null>(null);
  const showTetRef = useRef(false);
  const destMarkerRef = useRef<maplibregl.Marker | null>(null);
  const loadedRef = useRef(false);
  const viaMarkersRef = useRef<maplibregl.Marker[]>([]);
  const syncRef = useRef<() => void>(() => {});

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: {
        version: 8,
        sources: {
          osm: {
            type: "raster",
            tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
            tileSize: 256,
            attribution: "© OpenStreetMap contributors",
          },
        },
        layers: [{ id: "osm", type: "raster", source: "osm" }],
      },
      center: [24.6, 56.95], // Latvia
      zoom: 7,
    });

    map.addControl(new maplibregl.NavigationControl(), "top-right");

    map.on("error", (e) => console.error("MapLibre error:", e.error ?? e));
    if (process.env.NODE_ENV === "development") {
      (window as unknown as Record<string, unknown>).__map = map;
    }

    // Panning into a country whose file is not loaded yet must fill it in;
    // the ref keeps the handler reading the current toggle rather than the
    // value captured when the map was created.
    map.on("moveend", () => { if (showTetRef.current) void loadTet(map); });

    map.on("load", () => {
      // TET overlay sits below the generated route.
      // Empty to start: the TET is 33 countries and 4 MB of line. What is on
      // screen is fetched when the layer is switched on — see `loadTet`.
      map.addSource("tet", { type: "geojson", data: EMPTY });
      map.addLayer({
        id: "tet-line",
        type: "line",
        source: "tet",
        layout: { "line-cap": "round", "line-join": "round", visibility: "none" },
        paint: { "line-color": TET_COLOR, "line-width": 2.5, "line-opacity": 0.65 },
      });

      map.addSource("route", { type: "geojson", data: EMPTY });

      map.addLayer({
        id: "route-casing",
        type: "line",
        source: "route",
        layout: { "line-cap": "round", "line-join": "round" },
        paint: { "line-color": "#ffffff", "line-width": 7, "line-opacity": 0.85 },
      });
      map.addLayer({
        id: "route-road",
        type: "line",
        source: "route",
        filter: ["==", ["get", "roadClass"], "road"],
        layout: { "line-cap": "round", "line-join": "round" },
        paint: { "line-color": SURFACE_COLOR_EXPR, "line-width": 4 },
      });
      map.addLayer({
        id: "route-track",
        type: "line",
        source: "route",
        filter: ["==", ["get", "roadClass"], "track"],
        layout: { "line-join": "round" },
        paint: {
          "line-color": SURFACE_COLOR_EXPR,
          "line-width": 4,
          "line-dasharray": [2, 1.5],
        },
      });
      map.addLayer({
        id: "route-trail",
        type: "line",
        source: "route",
        filter: ["==", ["get", "roadClass"], "trail"],
        layout: { "line-cap": "round", "line-join": "round" },
        paint: {
          "line-color": TRAIL_COLOR,
          "line-width": 4,
          "line-dasharray": [0.1, 2],
        },
      });

      loadedRef.current = true;
      syncRef.current();
    });

    mapRef.current = map;
    return () => {
      map.remove();
      mapRef.current = null;
      loadedRef.current = false;
    };
  }, []);

  useEffect(() => {
    const syncData = () => {
      const map = mapRef.current;
      if (!map || !loadedRef.current) return;

      const source = map.getSource("route") as maplibregl.GeoJSONSource | undefined;
      source?.setData(segments ?? EMPTY);

      if (map.getLayer("tet-line")) {
        map.setLayoutProperty("tet-line", "visibility", showTet ? "visible" : "none");
        showTetRef.current = showTet;
        if (showTet) void loadTet(map);
      }

      if (start) {
        if (!markerRef.current) {
          markerRef.current = new maplibregl.Marker({ color: "#16a34a" });
        }
        markerRef.current.setLngLat([start.lon, start.lat]).addTo(map);
      } else {
        markerRef.current?.remove();
      }

      if (destination) {
        if (!destMarkerRef.current) {
          destMarkerRef.current = new maplibregl.Marker({ color: "#ff3b30" });
        }
        destMarkerRef.current.setLngLat([destination.lon, destination.lat]).addTo(map);
      } else {
        destMarkerRef.current?.remove();
      }

      for (const marker of viaMarkersRef.current) marker.remove();
      viaMarkersRef.current = (via ?? []).map(place => new maplibregl.Marker({ color: "#f56300" })
        .setLngLat([place.lon, place.lat])
        .setPopup(new maplibregl.Popup().setText(place.label))
        .addTo(map));

      if (segments && segments.features.length > 0) {
        const bounds = new maplibregl.LngLatBounds();
        for (const f of segments.features) {
          for (const c of f.geometry.coordinates) bounds.extend(c as [number, number]);
        }
        map.fitBounds(bounds, { padding: 48, duration: 800 });
      } else if (start || (via && via.length)) {
        // No route yet — frame the places the rider has confirmed, so the map
        // answers "is this the right Valmiera?" before a generation is spent.
        const pins = [...(start ? [start] : []), ...(via ?? [])];
        if (pins.length === 1) map.easeTo({ center: [pins[0].lon, pins[0].lat], zoom: 11, duration: 600 });
        else if (pins.length > 1) {
          const bounds = new maplibregl.LngLatBounds();
          for (const p of pins) bounds.extend([p.lon, p.lat]);
          map.fitBounds(bounds, { padding: 64, maxZoom: 12, duration: 700 });
        }
      }
    };

    syncRef.current = syncData;
    syncData();
  }, [segments, start, destination, via, showTet]);

  // The container changes size on the phone (smaller while the chat has
  // something to say, full screen on request); MapLibre only notices when told.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const observer = new ResizeObserver(() => mapRef.current?.resize());
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <div className="relative h-full w-full">
      <div ref={containerRef} className="h-full w-full rounded-lg" />

      <button
        type="button"
        onClick={() => onToggleTet(!showTet)}
        className="absolute left-3 top-3 flex items-center gap-2 rounded-full border border-[#ececf0] bg-white/95 px-3 py-1.5 text-xs font-medium text-foreground shadow-sm backdrop-blur transition-colors hover:bg-white"
      >
        <span
          className="inline-block h-[3px] w-4 rounded-full"
          style={{ background: TET_COLOR, opacity: showTet ? 0.9 : 0.3 }}
        />
        TET
        <span
          className={`flex h-4 w-7 items-center rounded-full p-0.5 transition-colors ${
            showTet ? "justify-end bg-[#f56300]" : "justify-start bg-[#e9e9eb]"
          }`}
        >
          <span className="h-3 w-3 rounded-full bg-white shadow-sm" />
        </span>
      </button>
      <div className="absolute left-3 top-14 hidden flex-col gap-2 rounded-xl border border-[#ececf0] bg-white/95 px-3 py-2.5 text-[11px] leading-none shadow-sm backdrop-blur md:flex">
        <div className="flex flex-col gap-1.5">
          <span className="text-[9px] font-semibold uppercase tracking-wide text-muted-foreground">
            Segums
          </span>
          <div className="flex items-center gap-3">
            <span className="flex items-center gap-1.5">
              <span className="inline-block h-[3px] w-4 rounded-full" style={{ background: PAVED_COLOR }} />
              Asfalts
            </span>
            <span className="flex items-center gap-1.5">
              <span className="inline-block h-[3px] w-4 rounded-full" style={{ background: GRAVEL_COLOR }} />
              Grants
            </span>
            <span className="flex items-center gap-1.5">
              <span className="inline-block h-[3px] w-4 rounded-full" style={{ background: DIRT_COLOR }} />
              Zeme
            </span>
            <span className="flex items-center gap-1.5">
              <span className="inline-block h-[3px] w-4 rounded-full" style={{ background: UNKNOWN_COLOR }} />
              Nezināms
            </span>
          </div>
        </div>
        <div className="flex flex-col gap-1.5">
          <span className="text-[9px] font-semibold uppercase tracking-wide text-muted-foreground">
            Veids
          </span>
          <div className="flex items-center gap-3">
            <span className="flex items-center gap-1.5">
              <span className="inline-block h-[3px] w-5 rounded-full bg-foreground/70" />
              Ceļš
            </span>
            <span className="flex items-center gap-1.5">
              <span
                className="inline-block h-[3px] w-5"
                style={{
                  background:
                    "repeating-linear-gradient(90deg, rgba(29,29,31,0.7) 0 5px, transparent 5px 8px)",
                }}
              />
              Meža ceļš
            </span>
            <span className="flex items-center gap-1.5">
              <span
                className="inline-block h-[3px] w-5"
                style={{
                  background: `repeating-linear-gradient(90deg, ${TRAIL_COLOR} 0 2px, transparent 2px 5px)`,
                }}
              />
              Taka
            </span>
            {showTet && (
              <span className="flex items-center gap-1.5">
                <span
                  className="inline-block h-[3px] w-5 rounded-full"
                  style={{ background: TET_COLOR, opacity: 0.65 }}
                />
                TET
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
