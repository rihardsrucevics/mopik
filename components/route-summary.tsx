"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { GeneratedRoute } from "@/lib/types";

type Props = {
  route: GeneratedRoute;
  /** whether the rider already asked to stay out of towns */
  avoidTowns?: boolean;
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

export function RouteSummary({ route, avoidTowns = false }: Props) {
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
  const q = route.quality;
  const roughHigh = q.roughTrackKm >= 1;
  const sandHigh = q.sandKm >= 0.5;
  // A suburb loop is the complaint behind "avoid towns": flag it once streets
  // are a real share, not the unavoidable few hundred metres leaving town.
  const streetHigh = q.streetKm / (route.distanceMeters / 1000) > 0.15;
  const unknownHigh = route.surfaces.unknownPercent >= 15;
  const unverifiedPaths = q.unverifiedPathKm > 0;
  // Some retracing is unavoidable — leaving and returning to the start often
  // shares a road — so only flag it once it's a real chunk of the ride.
  const overlapHigh = route.overlap.repeatedPercent > 15;

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
            {/[āčēģīķļņšūž]|\b(?:no|ap|caur|brauciens|grants)\b/i.test(route.sourcePrompt)
              ? `Šajā maršrutā ir iekļauts TET posms — aptuveni ${route.tet.sliceKm} km.`
              : `This route includes a TET section — approximately ${route.tet.sliceKm} km.`}
          </p>
        )}
        {route.stops && route.stops.length > 0 && (
          <p className="text-xs text-muted-foreground">
            {route.stops.map((s) => s.name).join(" · ")}
          </p>
        )}
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="grid grid-cols-3 gap-3 text-sm">
          <div>
            <div className="text-muted-foreground">Distance</div>
            <div className="text-lg font-semibold">
              {(route.distanceMeters / 1000).toFixed(0)} km
            </div>
          </div>
          <div>
            <div className="text-muted-foreground">Riding time</div>
            <div className="text-lg font-semibold">
              {formatDuration(route.durationSeconds)}
            </div>
          </div>
          <div>
            {/* The point of a loop is new ground, so this is the quality
                number that matters more than hitting an exact distance. */}
            <div className="text-muted-foreground">Repeated roads</div>
            <div
              className="text-lg font-semibold"
              style={{ color: route.overlap.repeatedPercent > 15 ? "#ff3b30" : undefined }}
            >
              {route.overlap.repeatedPercent}%
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

        {(q.forestKm > 0 || q.riversideKm > 0 || q.elevationGainM > 0) && (
          <div className="text-sm">
            <div className="mb-1 font-medium">Daba un ainava</div>
            <div className="grid grid-cols-2 gap-x-4 gap-y-0.5 text-muted-foreground">
              <span>Meža apvidū</span>
              <span className="text-right tabular-nums">{q.forestKm} km</span>
              <span>Upju tuvumā</span>
              <span className="text-right tabular-nums">{q.riversideKm} km</span>
              <span>Atklātā lauku ainavā</span>
              <span className="text-right tabular-nums">{q.ruralOpenKm} km</span>
              {q.elevationGainM > 0 && <><span>Kopējais kāpums</span><span className="text-right tabular-nums">{q.elevationGainM} m</span></>}
            </div>
          </div>
        )}

        {(riskKm > 0 || unknownHigh || overlapHigh || roughHigh || sandHigh || streetHigh || unverifiedPaths) && (
          <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900">
            {overlapHigh && (
              <div>
                ⚠️ {route.overlap.repeatedKm} km of this route rides roads it already
                covered. You can ask for less retracing in the chat.
              </div>
            )}
            {riskKm > 0 && <div>⚠️ {riskKm} km of trail / path segments.</div>}
            {unverifiedPaths && <div>⚠️ {q.unverifiedPathKm} km pa takām ar nepārbaudītu motocikla piekļuvi. Pārbaudi zīmes un vietējos ierobežojumus.</div>}
            {roughHigh && (
              <div>
                ⚠️ {q.roughTrackKm} km of rough tracks (grade 4–5 or bad smoothness).
              </div>
            )}
            {sandHigh && <div>⚠️ {q.sandKm} km of sand.</div>}
            {streetHigh && (
              <div>
                ⚠️ {q.streetKm} km on residential streets and service roads.{" "}
                {avoidTowns
                  ? "The road network here offers no way round them at this length."
                  : "Add “avoid towns” to the description to push the route out."}
              </div>
            )}
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
