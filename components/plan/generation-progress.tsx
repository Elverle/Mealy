"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

export const GENERATION_MESSAGES = [
  "Sto sfogliando il ricettario…",
  "Accendo i fornelli…",
  "Controllo la dispensa…",
  "Assaggio il sugo…",
  "Apparecchio la tavola…",
] as const;
export const GENERATION_MESSAGE_INTERVAL_MS = 2500;

const DEFAULT_CARDS = 4;
const MIN_CARDS = 1;
const MAX_CARDS = 6;

export function useRotatingMessage(
  messages: readonly string[],
  intervalMs: number = GENERATION_MESSAGE_INTERVAL_MS,
  active: boolean = true
): string {
  const [index, setIndex] = React.useState(0);
  const count = messages.length;

  React.useEffect(() => {
    if (!active || count === 0) {
      setIndex(0);
      return;
    }
    const timer = setInterval(() => setIndex((i) => (i + 1) % count), intervalMs);
    return () => clearInterval(timer);
  }, [active, intervalMs, count]);

  return messages[index % Math.max(count, 1)] ?? "";
}

export interface GenerationProgressProps {
  cards?: number;
  className?: string;
}

export function GenerationProgress({
  cards = DEFAULT_CARDS,
  className,
}: GenerationProgressProps) {
  const message = useRotatingMessage(GENERATION_MESSAGES);
  const count = Math.min(MAX_CARDS, Math.max(MIN_CARDS, Math.floor(cards)));

  return (
    <div role="status" aria-live="polite" className={cn("space-y-3", className)}>
      <p className="text-sm font-medium text-stone">{message}</p>
      {Array.from({ length: count }, (_, i) => (
        <div
          key={i}
          aria-hidden="true"
          data-testid="generation-skeleton"
          className="rounded-xl border border-stone/20 bg-white p-4 motion-safe:animate-pulse"
        >
          <div className="h-3 w-1/3 rounded bg-stone/15" />
          <div className="mt-3 h-5 w-2/3 rounded bg-stone/15" />
          <div className="mt-3 h-3 w-1/2 rounded bg-stone/15" />
        </div>
      ))}
    </div>
  );
}
