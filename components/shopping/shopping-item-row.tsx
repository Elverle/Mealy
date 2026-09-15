"use client";

import * as React from "react";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

export interface ShoppingItem {
  id: string;
  name: string;
  amount?: number;
  unit?: string;
  category?: string;
  isChecked: boolean;
}

export interface ShoppingItemRowProps {
  item: ShoppingItem;
  onToggle: (id: string) => void;
  className?: string;
}

export function ShoppingItemRow({
  item,
  onToggle,
  className,
}: ShoppingItemRowProps) {
  const handleClick = () => {
    onToggle(item.id);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === " " || e.key === "Enter") {
      e.preventDefault();
      onToggle(item.id);
    }
  };

  return (
    <div
      role="checkbox"
      aria-checked={item.isChecked}
      tabIndex={0}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      className={cn(
        "group flex min-h-[52px] w-full cursor-pointer items-center justify-between rounded-xl px-2 py-1 transition-colors hover:bg-stone/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-basil select-none",
        item.isChecked && "opacity-60",
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
        <span
          className={cn(
            "text-base font-medium transition-all truncate",
            item.isChecked ? "line-through text-stone" : "text-ink"
          )}
        >
          {item.name}
        </span>
      </div>

      {(item.amount !== undefined || item.unit) && (
        <span
          className={cn(
            "ml-2 shrink-0 text-sm font-semibold tabular-nums text-stone",
            item.isChecked && "line-through"
          )}
        >
          {item.amount !== undefined && item.amount > 0 ? item.amount : ""}{" "}
          {item.unit || ""}
        </span>
      )}
    </div>
  );
}
