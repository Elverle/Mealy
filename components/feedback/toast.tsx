"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

export interface ToastProps {
  message: string | null;
  onDismiss: () => void;
  durationMs?: number;
  /** Classi del contenitore, es. `bottom-40` per stare sopra un footer sticky. */
  className?: string;
}

export const TOAST_DEFAULT_DURATION_MS = 3000;

export function Toast({
  message,
  onDismiss,
  durationMs = TOAST_DEFAULT_DURATION_MS,
  className,
}: ToastProps) {
  const onDismissRef = React.useRef(onDismiss);
  React.useEffect(() => {
    onDismissRef.current = onDismiss;
  });

  React.useEffect(() => {
    if (message === null) return;
    const timer = setTimeout(() => onDismissRef.current(), durationMs);
    return () => clearTimeout(timer);
  }, [message, durationMs]);

  // Live region sempre montata e vuota a riposo: quelle inserite già piene sono annunciate
  // male da VoiceOver iOS. Il toast non ha azioni: non intercetta i tap sottostanti.
  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        "pointer-events-none fixed inset-x-0 bottom-24 z-50 flex justify-center px-4",
        className
      )}
    >
      {message !== null && (
        <div className="pointer-events-none rounded-xl bg-ink px-4 py-3 text-sm font-medium text-paper shadow-lg">
          {message}
        </div>
      )}
    </div>
  );
}
