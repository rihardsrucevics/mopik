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

    map.on("load", () => {
      // TET overlay sits below the generated route.
      map.addSource("tet", { type: "geojson", data: "/tet-lv.geojson" });
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
      }
    };

    syncRef.current = syncData;
    syncData();
  }, [segments, start, destination, via, showTet]);

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
        TET Latvia
        <span
          className={`flex h-4 w-7 items-center rounded-full p-0.5 transition-colors ${
            showTet ? "justify-end bg-[#f56300]" : "justify-start bg-[#e9e9eb]"
          }`}
        >
          <span className="h-3 w-3 rounded-full bg-white shadow-sm" />
        </span>
      </button>
      <div className="absolute bottom-3 left-3 flex flex-col gap-2 rounded-xl border border-[#ececf0] bg-white/95 px-3 py-2.5 text-[11px] leading-none shadow-sm backdrop-blur">
        <div className="flex flex-col gap-1.5">
          <span className="text-[9px] font-semibold uppercase tracking-wide text-muted-foreground">
            Surface
          </span>
          <div className="flex items-center gap-3">
            <span className="flex items-center gap-1.5">
              <span className="inline-block h-[3px] w-4 rounded-full" style={{ background: PAVED_COLOR }} />
              Paved
            </span>
            <span className="flex items-center gap-1.5">
              <span className="inline-block h-[3px] w-4 rounded-full" style={{ background: GRAVEL_COLOR }} />
              Gravel
            </span>
            <span className="flex items-center gap-1.5">
              <span className="inline-block h-[3px] w-4 rounded-full" style={{ background: DIRT_COLOR }} />
              Dirt
            </span>
            <span className="flex items-center gap-1.5">
              <span className="inline-block h-[3px] w-4 rounded-full" style={{ background: UNKNOWN_COLOR }} />
              Unknown
            </span>
          </div>
        </div>
        <div className="flex flex-col gap-1.5">
          <span className="text-[9px] font-semibold uppercase tracking-wide text-muted-foreground">
            Type
          </span>
          <div className="flex items-center gap-3">
            <span className="flex items-center gap-1.5">
              <span className="inline-block h-[3px] w-5 rounded-full bg-foreground/70" />
              Road
            </span>
            <span className="flex items-center gap-1.5">
              <span
                className="inline-block h-[3px] w-5"
                style={{
                  background:
                    "repeating-linear-gradient(90deg, rgba(29,29,31,0.7) 0 5px, transparent 5px 8px)",
                }}
              />
              Track
            </span>
            <span className="flex items-center gap-1.5">
              <span
                className="inline-block h-[3px] w-5"
                style={{
                  background: `repeating-linear-gradient(90deg, ${TRAIL_COLOR} 0 2px, transparent 2px 5px)`,
                }}
              />
              Trail
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
