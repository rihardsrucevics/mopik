"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { GeneratedRoute } from "@/lib/types";

type Props = {
  route: GeneratedRoute;
  loading: boolean;
  onRegenerate: () => void;
};

function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.round((seconds % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function MixBar({
  label,
  percent,
  km,
  color,
}: {
  label: string;
  percent: number;
  km: number;
  color: string;
}) {
  return (
    <div>
      <div className="flex justify-between text-sm">
        <span>{label}</span>
        <span className="tabular-nums text-muted-foreground">
          {km} km · {percent}%
        </span>
      </div>
      <div className="mt-1 h-2 rounded-full bg-muted">
        <div
          className="h-2 rounded-full"
          style={{ width: `${Math.min(100, percent)}%`, background: color }}
        />
      </div>
    </div>
  );
}

export function RouteSummary({ route, loading, onRegenerate }: Props) {
  const downloadGpx = async () => {
    const res = await fetch("/api/export-gpx", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: route.name,
        coordinates: route.geometry.coordinates,
      }),
    });
    if (!res.ok) return;
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = route.name.toLowerCase().replace(/[^a-z0-9]+/g, "-") + ".gpx";
    a.click();
    URL.revokeObjectURL(url);
  };

  const riskKm = route.roadMix.trailKm;
  const unknownHigh = route.surfaces.unknownPercent >= 15;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between gap-2">
          <span>{route.name}</span>
          <span className="flex gap-1">
            {route.tet && (
              <Badge className="rounded-full border border-[#f5630040] bg-transparent font-semibold tracking-wide text-[#f56300]">
                TET
              </Badge>
            )}
            <Badge variant="secondary" className="capitalize">
              {route.profile}
            </Badge>
          </span>
        </CardTitle>
        {route.tet && (
          <p className="text-xs text-muted-foreground">
            Follows ~{route.tet.sliceKm} km of {route.tet.sectionName}
          </p>
        )}
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="grid grid-cols-2 gap-3 text-sm">
          <div>
            <div className="text-muted-foreground">Distance</div>
            <div className="text-lg font-semibold">
              {(route.distanceMeters / 1000).toFixed(0)} km
            </div>
          </div>
          <div>
            <div className="text-muted-foreground">Estimated riding time</div>
            <div className="text-lg font-semibold">
              {formatDuration(route.durationSeconds)}
            </div>
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <div className="text-sm font-medium">Route mix</div>
          <MixBar
            label="Road"
            percent={route.roadMix.roadPercent}
            km={route.roadMix.roadKm}
            color="#0071e3"
          />
          <MixBar
            label="Track / dashed"
            percent={route.roadMix.trackPercent}
            km={route.roadMix.trackKm}
            color="#f56300"
          />
          <MixBar
            label="Trail / dotted"
            percent={route.roadMix.trailPercent}
            km={route.roadMix.trailKm}
            color="#ff3b30"
          />
        </div>

        <div className="text-sm">
          <div className="mb-1 font-medium">Surface</div>
          <div className="grid grid-cols-2 gap-x-4 gap-y-0.5 text-muted-foreground">
            <span>Asphalt</span>
            <span className="text-right tabular-nums">
              {route.surfaces.asphaltPercent}%
            </span>
            <span>Gravel</span>
            <span className="text-right tabular-nums">
              {route.surfaces.gravelPercent}%
            </span>
            <span>Ground / dirt</span>
            <span className="text-right tabular-nums">{route.surfaces.dirtPercent}%</span>
            <span>Unknown</span>
            <span className="text-right tabular-nums">
              {route.surfaces.unknownPercent}%
            </span>
          </div>
        </div>

        {!route.customModelApplied && (
          <div className="rounded-md border border-blue-200 bg-blue-50 p-3 text-xs text-blue-900">
            ℹ️ Your GraphHopper plan doesn&apos;t support custom routing profiles, so
            gravel/difficulty preferences aren&apos;t applied to routing yet — the
            route uses the standard car profile. The mix breakdown below is still
            real data.
          </div>
        )}

        {(riskKm > 0 || unknownHigh) && (
          <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900">
            {riskKm > 0 && <div>⚠️ {riskKm} km of trail / path segments.</div>}
            {unknownHigh && (
              <div>
                ⚠️ {route.surfaces.unknownPercent}% of this route has unknown surface
                data. Conditions may differ on the ground.
              </div>
            )}
            <div className="mt-1">
              Always follow local road signs and access restrictions.
            </div>
          </div>
        )}

        <div className="flex flex-col gap-2.5">
          <Button
            className="h-12 rounded-full bg-[#f56300] text-[15px] font-semibold text-white hover:bg-[#e05a00]"
            onClick={downloadGpx}
          >
            Download GPX
          </Button>
          <Button
            className="h-11 rounded-full bg-muted text-[14px] font-medium text-foreground shadow-none hover:bg-[#ebebed]"
            variant="secondary"
            onClick={onRegenerate}
            disabled={loading}
          >
            {loading ? "Generating…" : "Generate another"}
          </Button>
        </div>

        <p className="text-xs text-muted-foreground">
          Use the GPX with OsmAnd, Garmin, DMD2, Locus, Kurviger or your preferred
          navigation app. Routes are generated using available map and access data —
          always follow local signage and restrictions.
        </p>
      </CardContent>
    </Card>
  );
}
