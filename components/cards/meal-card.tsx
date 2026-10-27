"use client";

import * as React from "react";
import { Star, RefreshCw, Lock, Unlock, Clock, Search } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export interface MealCardProps {
  id: string;
  day: string;
  mealType: string;
  title: string;
  prepTimeMinutes?: number;
  /** Portate, già formattate: badge accanto al tempo. */
  course?: string;
  tags?: string[];
  isFavorite?: boolean;
  isLocked?: boolean;
  onToggleFavorite?: (id: string) => void;
  onSwap?: (id: string) => void;
  /** Apre la scelta di una ricetta dalla libreria. Assente → nessun pulsante «Scegli». */
  onPick?: (id: string) => void;
  onToggleLock?: (id: string) => void;
  onSelect?: (id: string) => void;
  onLongPress?: (id: string) => void;
  /** Sostituisce l'intero footer (Cambia + preferita). */
  actions?: React.ReactNode;
  /** Contenuto sotto il footer, dentro la card (riga contorno o «+ Contorno»). */
  extra?: React.ReactNode;
  /** Disattiva Cambia, Scegli, lucchetto e pressione lunga (azione in corso su un altro piatto della card). */
  actionsDisabled?: boolean;
  className?: string;
}

export const LONG_PRESS_MS = 500;
const LONG_PRESS_MOVE_TOLERANCE_PX = 10;
const LONG_PRESS_VIBRATE_MS = 10;

export function MealCard({
  id,
  day,
  mealType,
  title,
  prepTimeMinutes,
  course,
  tags = [],
  isFavorite = false,
  isLocked = false,
  onToggleFavorite,
  onSwap,
  onPick,
  onToggleLock,
  onSelect,
  onLongPress,
  actions,
  extra,
  actionsDisabled = false,
  className,
}: MealCardProps) {
  const timerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const originRef = React.useRef<{ x: number; y: number } | null>(null);
  const suppressNextClick = React.useRef(false);

  const cancelLongPress = React.useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    originRef.current = null;
  }, []);

  React.useEffect(() => cancelLongPress, [cancelLongPress]);

  // Con un'azione in corso la pressione lunga non blocca il pasto (come il lucchetto).
  const longPressProps = onLongPress && !actionsDisabled
    ? {
        onPointerDown: (e: React.PointerEvent<HTMLDivElement>) => {
          if (e.button !== 0) return;
          // Il long-press parte solo dal corpo della card, non dai pulsanti interni.
          const button = (e.target as Element).closest("button");
          if (button && e.currentTarget.contains(button)) return;
          cancelLongPress();
          suppressNextClick.current = false;
          originRef.current = { x: e.clientX, y: e.clientY };
          timerRef.current = setTimeout(() => {
            timerRef.current = null;
            originRef.current = null;
            suppressNextClick.current = true;
            navigator.vibrate?.(LONG_PRESS_VIBRATE_MS);
            onLongPress(id);
          }, LONG_PRESS_MS);
        },
        onPointerMove: (e: React.PointerEvent<HTMLDivElement>) => {
          const origin = originRef.current;
          if (!origin) return;
          if (
            Math.hypot(e.clientX - origin.x, e.clientY - origin.y) >
            LONG_PRESS_MOVE_TOLERANCE_PX
          ) {
            cancelLongPress();
          }
        },
        onPointerUp: cancelLongPress,
        onPointerLeave: cancelLongPress,
        onPointerCancel: cancelLongPress,
        onContextMenu: (e: React.MouseEvent) => e.preventDefault(),
        style: { WebkitTouchCallout: "none" } as React.CSSProperties,
      }
    : {};

  const showFooter = Boolean(actions || onSwap || onPick || onToggleFavorite);

  return (
    <Card
      data-testid={`meal-card-${id}`}
      {...longPressProps}
      className={cn(
        "relative flex flex-col justify-between overflow-hidden p-4 transition-all hover:border-stone/40 hover:shadow-md",
        isLocked && "border-basil/40 bg-basil/[0.02]",
        onLongPress && "select-none",
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
            disabled={actionsDisabled}
            aria-label={isLocked ? "Sblocca pasto" : "Blocca pasto"}
            aria-pressed={isLocked}
            className={cn(
              "flex h-11 w-11 items-center justify-center rounded-lg text-stone transition-colors hover:bg-stone/15 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-basil cursor-pointer disabled:pointer-events-none disabled:opacity-40",
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
        onClick={() => {
          if (suppressNextClick.current) {
            suppressNextClick.current = false;
            return;
          }
          onSelect?.(id);
        }}
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
        {(prepTimeMinutes || course || tags.length > 0) && (
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            {prepTimeMinutes && (
              <Badge variant="secondary" className="gap-1 text-[11px] font-medium">
                <Clock className="h-3 w-3 text-stone" />
                <span className="tabular-nums">{prepTimeMinutes} min</span>
              </Badge>
            )}
            {course && (
              <Badge variant="basil-subtle" className="text-[11px] font-medium">
                {course}
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

      {/* Action Footer: Swap (Tomato) and Favorite (Saffron), or custom actions */}
      {showFooter && (
        <div className="mt-3 flex items-center justify-between border-t border-stone/15 pt-2">
          {actions ?? (
            <>
              {(onSwap || onPick) && (
                <div className="flex items-center gap-1">
                  {onSwap && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onSwap(id);
                      }}
                      disabled={isLocked || actionsDisabled}
                      aria-label={`Cambia ${title}`}
                      className="flex min-h-[44px] items-center gap-2 rounded-xl px-3 py-2 text-sm font-semibold text-tomato transition-colors hover:bg-tomato/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-tomato active:scale-95 cursor-pointer disabled:pointer-events-none disabled:opacity-40"
                    >
                      <RefreshCw className="h-4 w-4 stroke-[2.25]" />
                      <span>Cambia</span>
                    </button>
                  )}
                  {onPick && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onPick(id);
                      }}
                      disabled={isLocked || actionsDisabled}
                      aria-label={`Scegli un'altra ricetta per ${title}`}
                      data-slot-action="pick"
                      className="flex min-h-[44px] items-center gap-2 rounded-xl px-3 py-2 text-sm font-semibold text-ink transition-colors hover:bg-stone/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-basil active:scale-95 cursor-pointer disabled:pointer-events-none disabled:opacity-40"
                    >
                      <Search className="h-4 w-4 stroke-[2.25]" aria-hidden="true" />
                      <span>Scegli</span>
                    </button>
                  )}
                </div>
              )}

              {onToggleFavorite && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onToggleFavorite(id);
                  }}
                  aria-label={isFavorite ? "Rimuovi dai preferiti" : "Aggiungi ai preferiti"}
                  aria-pressed={isFavorite}
                  className={cn(
                    "ml-auto flex h-11 w-11 items-center justify-center rounded-xl transition-colors hover:bg-saffron/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-saffron active:scale-95 cursor-pointer",
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
              )}
            </>
          )}
        </div>
      )}

      {extra && <div className="mt-2 border-t border-dashed border-stone/25 pt-2">{extra}</div>}
    </Card>
  );
}
