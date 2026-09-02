"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { RouteIntent } from "@/lib/types";

export type PromptRequest =
  | { prompt: string; intent?: undefined }
  | { prompt?: undefined; intent: Partial<RouteIntent> };

type Props = {
  loading: boolean;
  onGenerate: (start: string, destination: string, req: PromptRequest) => void;
  /** last parsed intent — keeps the Customize form in sync with what the AI understood */
  syncIntent?: RouteIntent | null;
};

const EXAMPLE_PROMPT = `I want a 4 hour adventure ride.
Around 40% gravel.
Easy off-road.
Avoid highways.`;

type Tracks = "low" | "medium" | "high";
type Trails = RouteIntent["trailPreference"];

const TRACKS_TO_GRAVEL: Record<Tracks, number> = { low: 20, medium: 50, high: 75 };

function Segmented<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string }[];
}) {
  return (
    <div className="flex gap-1 rounded-full bg-muted p-1">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className={`flex-1 rounded-full px-3 py-1.5 text-[13px] font-medium transition-colors ${
            value === o.value
              ? "bg-white text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <label className="block text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
      {children}
    </label>
  );
}

export function RoutePrompt({ loading, onGenerate, syncIntent }: Props) {
  const [mode, setMode] = useState<"describe" | "customize">("describe");
  const [start, setStart] = useState("Riga");
  const [destination, setDestination] = useState("");
  const [prompt, setPrompt] = useState(EXAMPLE_PROMPT);

  // Customize mode fields
  const [distanceKm, setDistanceKm] = useState("150");
  const [durationHours, setDurationHours] = useState("");
  const [difficulty, setDifficulty] = useState<RouteIntent["difficulty"]>("easy");
  const [tracks, setTracks] = useState<Tracks>("medium");
  const [trails, setTrails] = useState<Trails>("none");
  const [avoidMotorways, setAvoidMotorways] = useState(true);
  const [includeTet, setIncludeTet] = useState(false);

  // After the AI parses a prompt, mirror its understanding into the form
  // so the rider can flip to Customize and adjust from there.
  useEffect(() => {
    if (!syncIntent) return;
    if (syncIntent.distanceKm) setDistanceKm(String(syncIntent.distanceKm));
    if (syncIntent.durationHours && !syncIntent.distanceKm) {
      setDistanceKm("");
      setDurationHours(String(syncIntent.durationHours));
    }
    setDifficulty(syncIntent.difficulty);
    setTracks(
      syncIntent.gravelPreference < 35 ? "low" : syncIntent.gravelPreference < 65 ? "medium" : "high"
    );
    setTrails(syncIntent.trailPreference ?? "none");
    setAvoidMotorways(syncIntent.avoidMotorways);
    setIncludeTet(syncIntent.includeTet ?? false);
  }, [syncIntent]);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!start.trim()) return;

    if (mode === "describe") {
      onGenerate(start.trim(), destination.trim(), { prompt: prompt.trim() });
      return;
    }

    const km = parseFloat(distanceKm);
    const hours = parseFloat(durationHours);
    onGenerate(start.trim(), destination.trim(), {
      intent: {
        distanceKm: Number.isFinite(km) && km > 0 ? Math.round(km) : undefined,
        durationHours: Number.isFinite(hours) && hours > 0 ? hours : undefined,
        difficulty,
        gravelPreference: TRACKS_TO_GRAVEL[tracks],
        trailPreference: trails,
        avoidMotorways,
        includeTet,
        returnToStart: !destination.trim(),
      },
    });
  };

  return (
    <form className="flex flex-col gap-4" onSubmit={submit}>
      <Segmented
        value={mode}
        onChange={setMode}
        options={[
          { value: "describe", label: "Describe" },
          { value: "customize", label: "Customize" },
        ]}
      />

      <div className="flex gap-3">
        <div className="flex flex-1 flex-col gap-1.5">
          <FieldLabel>Start</FieldLabel>
          <Input value={start} onChange={(e) => setStart(e.target.value)} placeholder="Riga" required />
        </div>
        <div className="flex flex-1 flex-col gap-1.5">
          <FieldLabel>Destination · optional</FieldLabel>
          <Input
            value={destination}
            onChange={(e) => setDestination(e.target.value)}
            placeholder="Round trip"
          />
        </div>
      </div>

      {mode === "describe" ? (
        <div className="flex flex-col gap-1.5">
          <FieldLabel>Your ride</FieldLabel>
          <Textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            rows={5}
            placeholder={EXAMPLE_PROMPT}
          />
          <p className="text-xs text-muted-foreground">
            Tip: mention “TET” to follow part of the Trans Euro Trail.
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          <div className="flex gap-3">
            <div className="flex flex-1 flex-col gap-1.5">
              <FieldLabel>Distance · km</FieldLabel>
              <Input
                type="number"
                min={20}
                max={600}
                value={distanceKm}
                onChange={(e) => setDistanceKm(e.target.value)}
                placeholder="150"
              />
            </div>
            <div className="flex flex-1 flex-col gap-1.5">
              <FieldLabel>Or duration · h</FieldLabel>
              <Input
                type="number"
                min={0.5}
                max={16}
                step={0.5}
                value={durationHours}
                onChange={(e) => setDurationHours(e.target.value)}
                placeholder="4"
              />
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <FieldLabel>Difficulty</FieldLabel>
            <Segmented
              value={difficulty}
              onChange={setDifficulty}
              options={[
                { value: "easy", label: "Easy" },
                { value: "adventure", label: "Adventure" },
                { value: "hard", label: "Hard" },
              ]}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <FieldLabel>Tracks · dashed lines</FieldLabel>
            <Segmented
              value={tracks}
              onChange={setTracks}
              options={[
                { value: "low", label: "Low" },
                { value: "medium", label: "Medium" },
                { value: "high", label: "High" },
              ]}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <FieldLabel>Trails · dotted lines</FieldLabel>
            <Segmented
              value={trails}
              onChange={setTrails}
              options={[
                { value: "none", label: "None" },
                { value: "some", label: "Some" },
                { value: "lots", label: "Lots" },
              ]}
            />
          </div>

          <div className="flex gap-5">
            <label className="flex cursor-pointer items-center gap-2 text-[13px]">
              <input
                type="checkbox"
                checked={avoidMotorways}
                onChange={(e) => setAvoidMotorways(e.target.checked)}
              />
              Avoid highways
            </label>
            <label className="flex cursor-pointer items-center gap-2 text-[13px]">
              <input
                type="checkbox"
                checked={includeTet}
                onChange={(e) => setIncludeTet(e.target.checked)}
              />
              Follow the TET
            </label>
          </div>
        </div>
      )}

      <Button
        type="submit"
        disabled={loading || !start.trim()}
        className="h-12 rounded-full text-[15px] font-semibold"
      >
        {loading ? "Generating routes…" : "Generate routes"}
      </Button>
    </form>
  );
}
