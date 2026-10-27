"use client";

import * as React from "react";
import { RefreshCw, Search, X } from "lucide-react";

export interface SideDishRowProps {
  title: string;
  /** Tap sul titolo: dettaglio. Assente → titolo non interattivo. */
  onOpen?: () => void;
  /** Assenti → nessun pulsante (riga di sola lettura). */
  onSwap?: () => void;
  onPick?: () => void;
  onRemove?: () => void;
  /** Pulsanti disattivati: azione in corso altrove nella card. */
  disabled?: boolean;
  /** Se presente, al posto di titolo e pulsanti: messaggio di attesa. */
  pendingMessage?: string | null;
}

const ACTION_CLASS =
  "flex h-11 w-11 shrink-0 items-center justify-center rounded-xl transition-colors focus-visible:outline-none focus-visible:ring-2 active:scale-95 cursor-pointer disabled:pointer-events-none disabled:opacity-40";

/** Riga del contorno dentro la card del pasto: titolo, azioni e attesa. */
export function SideDishRow({
  title,
  onOpen,
  onSwap,
  onPick,
  onRemove,
  disabled = false,
  pendingMessage,
}: SideDishRowProps): React.JSX.Element {
  const stop = (action: () => void) => (e: React.MouseEvent) => {
    e.stopPropagation();
    action();
  };

  return (
    <div className="flex flex-col">
      <span className="text-xs font-bold uppercase tracking-wider text-stone">Contorno</span>
      {pendingMessage ? (
        <p role="status" className="flex min-h-[44px] items-center text-sm font-medium text-stone">
          {pendingMessage}
        </p>
      ) : (
        <div className="flex items-center gap-1">
          {onOpen ? (
            <button
              type="button"
              onClick={onOpen}
              className="min-h-[44px] min-w-0 flex-1 truncate rounded-lg text-left text-sm font-semibold text-ink hover:text-basil focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-basil"
            >
              {title}
            </button>
          ) : (
            <span className="min-w-0 flex-1 truncate text-sm font-semibold text-ink">{title}</span>
          )}
          {onSwap && (
            <button
              type="button"
              onClick={stop(onSwap)}
              disabled={disabled}
              aria-label={`Cambia contorno: ${title}`}
              data-side-action="swap"
              className={`${ACTION_CLASS} text-tomato hover:bg-tomato/10 focus-visible:ring-tomato`}
            >
              <RefreshCw className="h-4 w-4 stroke-[2.25]" aria-hidden="true" />
            </button>
          )}
          {onPick && (
            <button
              type="button"
              onClick={stop(onPick)}
              disabled={disabled}
              aria-label={`Scegli contorno: ${title}`}
              data-side-action="pick"
              className={`${ACTION_CLASS} text-ink hover:bg-stone/15 focus-visible:ring-basil`}
            >
              <Search className="h-4 w-4 stroke-[2.25]" aria-hidden="true" />
            </button>
          )}
          {onRemove && (
            <button
              type="button"
              onClick={stop(onRemove)}
              disabled={disabled}
              aria-label={`Togli contorno: ${title}`}
              data-side-action="remove"
              className={`${ACTION_CLASS} text-stone hover:bg-stone/15 hover:text-ink focus-visible:ring-basil`}
            >
              <X className="h-4 w-4 stroke-[2.25]" aria-hidden="true" />
            </button>
          )}
        </div>
      )}
    </div>
  );
}
