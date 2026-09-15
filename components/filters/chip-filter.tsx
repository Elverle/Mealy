import * as React from "react";
import { cn } from "@/lib/utils";

export interface ChipFilterProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  label: string;
  count?: number;
  isSelected?: boolean;
  icon?: React.ReactNode;
}

export const ChipFilter = React.forwardRef<HTMLButtonElement, ChipFilterProps>(
  ({ label, count, isSelected = false, icon, className, onClick, ...props }, ref) => {
    return (
      <button
        ref={ref}
        type="button"
        role="checkbox"
        aria-checked={isSelected}
        onClick={onClick}
        className={cn(
          "inline-flex min-h-[44px] items-center gap-1.5 rounded-full px-4 py-2 text-sm font-medium transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-basil focus-visible:ring-offset-2 active:scale-95 cursor-pointer select-none",
          isSelected
            ? "bg-basil text-paper shadow-xs"
            : "border border-stone/20 bg-white text-stone hover:border-stone/40 hover:text-ink",
          className
        )}
        {...props}
      >
        {icon && <span className="shrink-0">{icon}</span>}
        <span>{label}</span>
        {count !== undefined && (
          <span
            className={cn(
              "ml-1 rounded-full px-1.5 py-0.2 text-[11px] font-bold tabular-nums",
              isSelected
                ? "bg-paper/20 text-paper"
                : "bg-stone/15 text-stone"
            )}
          >
            {count}
          </span>
        )}
      </button>
    );
  }
);

ChipFilter.displayName = "ChipFilter";
