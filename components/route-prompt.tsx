"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

type Props = {
  loading: boolean;
  onGenerate: (start: string, destination: string, prompt: string) => void;
};

const EXAMPLE_PROMPT = `I want a 4 hour adventure ride.
Around 40% gravel.
Easy off-road.
Avoid highways.`;

export function RoutePrompt({ loading, onGenerate }: Props) {
  const [start, setStart] = useState("Riga");
  const [destination, setDestination] = useState("");
  const [prompt, setPrompt] = useState(EXAMPLE_PROMPT);

  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (start.trim()) onGenerate(start.trim(), destination.trim(), prompt.trim());
      }}
    >
      <div>
        <label className="mb-1 block text-sm font-medium">Start</label>
        <Input
          value={start}
          onChange={(e) => setStart(e.target.value)}
          placeholder="Riga"
          required
        />
      </div>

      <div>
        <label className="mb-1 block text-sm font-medium">
          Destination <span className="text-muted-foreground">(optional)</span>
        </label>
        <Input
          value={destination}
          onChange={(e) => setDestination(e.target.value)}
          placeholder="Leave empty for a round trip"
        />
      </div>

      <div>
        <label className="mb-1 block text-sm font-medium">Describe your ride</label>
        <Textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          rows={5}
          placeholder={EXAMPLE_PROMPT}
        />
        <p className="mt-1 text-xs text-muted-foreground">
          Tip: mention “TET” to follow part of the Trans Euro Trail.
        </p>
      </div>

      <Button type="submit" disabled={loading || !start.trim()}>
        {loading ? "Generating routes…" : "Generate routes"}
      </Button>
    </form>
  );
}
