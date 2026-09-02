"use client";

import { useState } from "react";
import { RouteMap } from "@/components/route-map";
import { RoutePrompt, PromptRequest } from "@/components/route-prompt";
import { RouteSummary } from "@/components/route-summary";
import { GenerateRouteResponse, RouteIntent } from "@/lib/types";

export default function Home() {
  const [result, setResult] = useState<GenerateRouteResponse | null>(null);
  const [selectedIdx, setSelectedIdx] = useState(0);
  const [lastRequest, setLastRequest] = useState<{
    start: string;
    destination: string;
    prompt: string;
  } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showTet, setShowTet] = useState(false);

  const generate = async (
    start: string,
    destination: string,
    req: { prompt?: string; intent?: Partial<RouteIntent> }
  ) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/generate-route", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          start,
          destination: destination || undefined,
          prompt: req.prompt ?? "",
          // Customize mode / regenerate send intent directly (skips the LLM).
          intent: req.intent,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Route generation failed");
      setResult(data);
      setSelectedIdx(0);
      setLastRequest({ start, destination, prompt: req.prompt ?? "" });
      if (data.intent?.includeTet) setShowTet(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  };

  const selected = result?.routes[selectedIdx] ?? null;

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-7xl flex-col gap-4 p-4 md:p-6">
      <header className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight">
            <svg width="26" height="26" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <circle cx="5.5" cy="17.5" r="3" stroke="currentColor" strokeWidth="1.8" />
              <circle cx="18.5" cy="17.5" r="3" stroke="#f56300" strokeWidth="1.8" />
              <path
                d="M5.5 17.5 L9.5 11.5 H14 L18.5 17.5"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <path d="M14 11.5 L15.8 8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
              <path d="M14.2 8 H17.6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
            </svg>
            Mopik
          </h1>
          <p className="text-sm text-muted-foreground">
            Tell us how you want to ride. Get a GPX.
          </p>
        </div>
        <label className="flex cursor-pointer items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={showTet}
            onChange={(e) => setShowTet(e.target.checked)}
          />
          Show TET Latvia
        </label>
      </header>

      <div className="grid flex-1 gap-4 md:grid-cols-[380px_1fr]">
        <div className="flex flex-col gap-4">
          <RoutePrompt
            loading={loading}
            onGenerate={(s: string, d: string, req: PromptRequest) => generate(s, d, req)}
            syncIntent={result?.intent ?? null}
          />

          {error && (
            <div className="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-900">
              {error}
            </div>
          )}

          {result && result.routes.length > 1 && (
            <div className="flex gap-2">
              {result.routes.map((r, i) => (
                <button
                  key={r.id}
                  onClick={() => setSelectedIdx(i)}
                  className={`flex-1 rounded-md border p-2 text-left text-xs transition-colors ${
                    i === selectedIdx
                      ? "border-foreground bg-foreground text-background"
                      : "hover:bg-muted"
                  }`}
                >
                  <div className="font-semibold">Option {r.variant}</div>
                  <div>
                    {(r.distanceMeters / 1000).toFixed(0)} km ·{" "}
                    {Math.round(r.roadMix.trackPercent + r.roadMix.trailPercent)}% off-road
                  </div>
                </button>
              ))}
            </div>
          )}

          {selected && (
            <RouteSummary
              route={selected}
              loading={loading}
              onRegenerate={() =>
                lastRequest &&
                generate(lastRequest.start, lastRequest.destination, {
                  prompt: lastRequest.prompt,
                  intent: result?.intent,
                })
              }
            />
          )}
        </div>

        <div className="h-[60vh] overflow-hidden rounded-lg border md:h-[calc(100vh-8rem)]">
          <RouteMap
            segments={selected?.segments ?? null}
            start={result?.start ?? null}
            destination={result?.destination ?? null}
            showTet={showTet}
          />
        </div>
      </div>
    </main>
  );
}
