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
  showTet: boolean;
};

const EMPTY: GeoJSON.FeatureCollection = { type: "FeatureCollection", features: [] };

// Our own consistent adventure legend — deliberately NOT a copy of any OSM renderer.
const ROAD_COLOR = "#2563eb"; // solid line
const TRACK_COLOR = "#ea580c"; // dashed line
const TRAIL_COLOR = "#dc2626"; // dotted line
const TET_COLOR = "#9333ea"; // TET overlay

export function RouteMap({ segments, start, destination, showTet }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const markerRef = useRef<maplibregl.Marker | null>(null);
  const destMarkerRef = useRef<maplibregl.Marker | null>(null);
  const loadedRef = useRef(false);

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
        paint: { "line-color": ROAD_COLOR, "line-width": 4 },
      });
      map.addLayer({
        id: "route-track",
        type: "line",
        source: "route",
        filter: ["==", ["get", "roadClass"], "track"],
        layout: { "line-join": "round" },
        paint: {
          "line-color": TRACK_COLOR,
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
      syncData();
    });

    mapRef.current = map;
    return () => {
      map.remove();
      mapRef.current = null;
      loadedRef.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
        destMarkerRef.current = new maplibregl.Marker({ color: "#dc2626" });
      }
      destMarkerRef.current.setLngLat([destination.lon, destination.lat]).addTo(map);
    } else {
      destMarkerRef.current?.remove();
    }

    if (segments && segments.features.length > 0) {
      const bounds = new maplibregl.LngLatBounds();
      for (const f of segments.features) {
        for (const c of f.geometry.coordinates) bounds.extend(c as [number, number]);
      }
      map.fitBounds(bounds, { padding: 48, duration: 800 });
    }
  };

  useEffect(syncData, [segments, start, destination, showTet]);

  return (
    <div className="relative h-full w-full">
      <div ref={containerRef} className="h-full w-full rounded-lg" />
      <div className="absolute bottom-3 left-3 rounded-md bg-white/90 px-3 py-2 text-xs shadow">
        <div className="flex items-center gap-2">
          <span className="inline-block h-0.5 w-6" style={{ background: ROAD_COLOR }} />
          Road
        </div>
        <div className="mt-1 flex items-center gap-2">
          <span
            className="inline-block h-0.5 w-6"
            style={{
              background: `repeating-linear-gradient(90deg, ${TRACK_COLOR} 0 6px, transparent 6px 10px)`,
            }}
          />
          Track / dashed
        </div>
        <div className="mt-1 flex items-center gap-2">
          <span
            className="inline-block h-0.5 w-6"
            style={{
              background: `repeating-linear-gradient(90deg, ${TRAIL_COLOR} 0 2px, transparent 2px 6px)`,
            }}
          />
          Trail / dotted
        </div>
        {showTet && (
          <div className="mt-1 flex items-center gap-2">
            <span className="inline-block h-0.5 w-6" style={{ background: TET_COLOR }} />
            TET Latvia
          </div>
        )}
      </div>
    </div>
  );
}
