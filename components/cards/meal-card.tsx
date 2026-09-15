"use client";

import * as React from "react";
import { Star, RefreshCw, Lock, Unlock, Clock } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export interface MealCardProps {
  id: string;
  day: string;
  mealType: string;
  title: string;
  prepTimeMinutes?: number;
  tags?: string[];
  isFavorite?: boolean;
  isLocked?: boolean;
  onToggleFavorite?: (id: string) => void;
  onSwap?: (id: string) => void;
  onToggleLock?: (id: string) => void;
  onSelect?: (id: string) => void;
  className?: string;
}

export function MealCard({
  id,
  day,
  mealType,
  title,
  prepTimeMinutes,
  tags = [],
  isFavorite = false,
  isLocked = false,
  onToggleFavorite,
  onSwap,
  onToggleLock,
  onSelect,
  className,
}: MealCardProps) {
  return (
    <Card
      className={cn(
        "relative flex flex-col justify-between overflow-hidden p-4 transition-all hover:border-stone/40 hover:shadow-md",
        isLocked && "border-basil/40 bg-basil/[0.02]",
        className
      )}
    >
      {/* Top row: Eyebrow + Lock */}
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-bold uppercase tracking-wider text-stone">
          {`${day.toUpperCase()} · ${mealType.toUpperCase()}`}
        </span>
        {onToggleLock && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onToggleLock(id);
            }}
            aria-label={isLocked ? "Sblocca pasto" : "Blocca pasto"}
            aria-pressed={isLocked}
            className={cn(
              "flex h-11 w-11 items-center justify-center rounded-lg text-stone transition-colors hover:bg-stone/15 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-basil cursor-pointer",
              isLocked && "text-basil hover:text-basil/80"
            )}
          >
            {isLocked ? (
              <Lock className="h-4 w-4" />
            ) : (
              <Unlock className="h-4 w-4 opacity-50 hover:opacity-100" />
            )}
          </button>
        )}
      </div>

      {/* Main Content (Clickable to open details) */}
      <div
        onClick={() => onSelect?.(id)}
        className={cn(
          "my-2 cursor-pointer group",
          onSelect && "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-basil rounded-lg"
        )}
        role={onSelect ? "button" : undefined}
        tabIndex={onSelect ? 0 : undefined}
        onKeyDown={(e) => {
          if (onSelect && (e.key === "Enter" || e.key === " ")) {
            e.preventDefault();
            onSelect(id);
          }
        }}
      >
        <h4 className="font-display text-lg font-bold text-ink transition-colors group-hover:text-basil">
          {title}
        </h4>

        {/* Tags row */}
        {(prepTimeMinutes || tags.length > 0) && (
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            {prepTimeMinutes && (
              <Badge variant="secondary" className="gap-1 text-[11px] font-medium">
                <Clock className="h-3 w-3 text-stone" />
                <span className="tabular-nums">{prepTimeMinutes} min</span>
              </Badge>
            )}
            {tags.map((tag) => (
              <Badge
                key={tag}
                variant="outline"
                className="text-[11px] font-medium text-stone"
              >
                {tag}
              </Badge>
            ))}
          </div>
        )}
      </div>

      {/* Action Footer: Swap (Tomato) and Favorite (Saffron) */}
      <div className="mt-3 flex items-center justify-between border-t border-stone/15 pt-2">
        {/* Swap button */}
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onSwap?.(id);
          }}
          disabled={isLocked}
          aria-label={`Cambia ${title}`}
          className={cn(
            "flex min-h-[44px] items-center gap-2 rounded-xl px-3 py-2 text-sm font-semibold text-tomato transition-colors hover:bg-tomato/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-tomato active:scale-95 cursor-pointer disabled:pointer-events-none disabled:opacity-40"
          )}
        >
          <RefreshCw className="h-4 w-4 stroke-[2.25]" />
          <span>Cambia</span>
        </button>

        {/* Favorite button */}
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onToggleFavorite?.(id);
          }}
          aria-label={isFavorite ? "Rimuovi dai preferiti" : "Aggiungi ai preferiti"}
          aria-pressed={isFavorite}
          className={cn(
            "flex h-11 w-11 items-center justify-center rounded-xl transition-colors hover:bg-saffron/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-saffron active:scale-95 cursor-pointer",
            isFavorite ? "text-saffron" : "text-stone hover:text-saffron"
          )}
        >
          <Star
            className={cn(
              "h-5 w-5 stroke-[2]",
              isFavorite && "fill-saffron"
            )}
          />
        </button>
      </div>
    </Card>
  );
}
