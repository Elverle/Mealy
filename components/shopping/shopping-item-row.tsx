"use client";

import * as React from "react";
import { Check, X } from "lucide-react";
import { cn } from "@/lib/utils";

export interface ShoppingItem {
  id: string;
  name: string;
  amount?: number;
  unit?: string;
  category?: string;
  isChecked: boolean;
  /** Quantità già formattata (es. "1,25 kg"). Se definita, anche vuota, sostituisce amount/unit. */
  quantityLabel?: string;
  /** Seconda riga sotto il nome (es. "Per: Pasta al pomodoro"). */
  detail?: string;
}

export interface ShoppingItemRowProps {
  item: ShoppingItem;
  onToggle: (id: string) => void;
  className?: string;
  /** Sola lettura: la riga non risponde a tap e tastiera. */
  disabled?: boolean;
  /** Se presente, accanto alla riga compare il pulsante di rimozione. */
  onRemove?: (id: string) => void;
}

export function ShoppingItemRow({
  item,
  onToggle,
  className,
  disabled = false,
  onRemove,
}: ShoppingItemRowProps) {
  const handleClick = () => {
    if (disabled) return;
    onToggle(item.id);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === " " || e.key === "Enter") {
      e.preventDefault();
      if (disabled) return;
      onToggle(item.id);
    }
  };

  const hasDetail = item.detail !== undefined && item.detail.trim() !== "";
  const showQuantity =
    item.quantityLabel !== undefined
      ? item.quantityLabel.trim() !== ""
      : item.amount !== undefined || Boolean(item.unit);

  return (
    <div className="flex items-center">
      <div
        role="checkbox"
        aria-checked={item.isChecked}
        aria-disabled={disabled ? true : undefined}
        tabIndex={0}
        onClick={handleClick}
        onKeyDown={handleKeyDown}
        className={cn(
          "group flex min-h-[52px] min-w-0 flex-1 cursor-pointer items-center justify-between rounded-xl px-2 py-1 transition-colors hover:bg-stone/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-basil select-none",
          item.isChecked && "opacity-60",
          disabled && "cursor-default hover:bg-transparent",
          className
        )}
      >
        <div className="flex items-center gap-3 min-w-0">
          <span
            className="flex h-11 w-11 shrink-0 items-center justify-center"
            aria-hidden="true"
          >
            <span
              className={cn(
                "flex h-5 w-5 items-center justify-center rounded-md border transition-colors",
                item.isChecked
                  ? "border-basil bg-basil text-paper"
                  : "border-stone/40 bg-white hover:border-stone/70"
              )}
            >
              {item.isChecked && <Check className="h-3.5 w-3.5 stroke-[3]" />}
            </span>
          </span>
          <span className="flex min-w-0 flex-col">
            <span
              className={cn(
                "text-base font-medium transition-all truncate",
                item.isChecked ? "line-through text-stone" : "text-ink"
              )}
            >
              {item.name}
            </span>
            {hasDetail && (
              <span className="truncate text-xs text-stone">{item.detail}</span>
            )}
          </span>
        </div>

        {showQuantity && (
          <span
            className={cn(
              "ml-2 shrink-0 text-sm font-semibold tabular-nums text-stone",
              item.isChecked && "line-through"
            )}
          >
            {item.quantityLabel !== undefined ? (
              item.quantityLabel
            ) : (
              <>
                {item.amount !== undefined && item.amount > 0 ? item.amount : ""}{" "}
                {item.unit || ""}
              </>
            )}
          </span>
        )}
      </div>

      {onRemove && (
        <button
          type="button"
          aria-label={`Rimuovi ${item.name}`}
          onClick={() => onRemove(item.id)}
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-stone transition-colors hover:bg-stone/15 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-basil"
        >
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
      )}
    </div>
  );
}
