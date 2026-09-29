"use client";

import * as React from "react";

export interface ToastProps {
  message: string | null;
  onDismiss: () => void;
  durationMs?: number;
}

export const TOAST_DEFAULT_DURATION_MS = 3000;

export function Toast({
  message,
  onDismiss,
  durationMs = TOAST_DEFAULT_DURATION_MS,
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

  if (message === null) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="pointer-events-none fixed inset-x-0 bottom-24 z-50 flex justify-center px-4"
    >
      <div className="pointer-events-auto rounded-xl bg-ink px-4 py-3 text-sm font-medium text-paper shadow-lg">
        {message}
      </div>
    </div>
  );
}
