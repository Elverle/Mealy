"use client";

import * as React from "react";
import { Ban, ChevronDown, Search, Star } from "lucide-react";
import { ChipFilter } from "@/components/filters/chip-filter";
import {
  DIET_FLAG_LABELS,
  COURSE_LABELS,
  COURSE_VALUES,
  DIET_FLAG_VALUES,
  LIBRARY_QUERY_MAX,
  MEAL_STYLE_TAG_LABELS,
  MEAL_STYLE_TAG_VALUES,
  MEAL_TYPE_LABELS,
  type LibraryFilter,
  type MealType,
} from "@/lib/domain/types";
import { cn } from "@/lib/utils";

export interface LibraryFiltersProps {
  query: string;
  onQueryChange: (query: string) => void;
  /** Il campo `q` del filtro è ignorato: il testo vive in `query`. */
  filter: LibraryFilter;
  onFilterChange: (next: LibraryFilter) => void;
}

const PANEL_ID = "library-filter-panel";
const QUICK_MEALS: readonly MealType[] = ["pranzo", "cena"];
const GROUP_TITLE_CLASS = "text-xs font-bold uppercase tracking-wider text-stone";

/** Aggiunge o toglie `value` senza cambiare l'ordine degli altri. */
function toggled<T>(values: readonly T[], value: T): T[] {
  return values.includes(value) ? values.filter((v) => v !== value) : [...values, value];
}

export function LibraryFilters({
  query,
  onQueryChange,
  filter,
  onFilterChange,
}: LibraryFiltersProps): React.JSX.Element {
  const [open, setOpen] = React.useState(false);
  const baseId = React.useId();
  const panelCount =
    filter.courses.length + filter.tags.length + filter.diets.length + (filter.blocked ? 1 : 0);

  return (
    <div className="mt-4 space-y-3">
      <div className="relative">
        <Search
          className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-stone"
          aria-hidden="true"
        />
        <input
          type="search"
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          aria-label="Cerca nella libreria"
          placeholder="Cerca ricetta o ingrediente…"
          maxLength={LIBRARY_QUERY_MAX}
          className="min-h-[44px] w-full rounded-xl border border-stone/20 bg-white py-2.5 pl-10 pr-4 text-sm text-ink placeholder:text-stone focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-basil"
        />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <ChipFilter
          label="Preferite"
          icon={<Star className="h-3.5 w-3.5" aria-hidden="true" />}
          isSelected={filter.favorites}
          onClick={() => onFilterChange({ ...filter, favorites: !filter.favorites })}
        />
        {QUICK_MEALS.map((meal) => (
          <ChipFilter
            key={meal}
            label={MEAL_TYPE_LABELS[meal]}
            isSelected={filter.meals.includes(meal)}
            onClick={() => onFilterChange({ ...filter, meals: toggled(filter.meals, meal) })}
          />
        ))}
        <button
          type="button"
          aria-expanded={open}
          aria-controls={PANEL_ID}
          onClick={() => setOpen((v) => !v)}
          className="inline-flex min-h-[44px] cursor-pointer select-none items-center gap-1.5 rounded-full border border-stone/20 bg-white px-4 py-2 text-sm font-medium text-stone transition-all hover:border-stone/40 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-basil focus-visible:ring-offset-2 active:scale-95"
        >
          <span>{panelCount === 0 ? "Filtri" : `Filtri · ${panelCount}`}</span>
          <ChevronDown
            className={cn("h-4 w-4 transition-transform motion-reduce:transition-none", open && "rotate-180")}
            aria-hidden="true"
          />
        </button>
      </div>

      {open && (
        <div id={PANEL_ID} className="space-y-4 rounded-xl border border-stone/20 bg-white p-4">
          <div className="space-y-2">
            <p id={`${baseId}-courses`} className={GROUP_TITLE_CLASS}>Portata</p>
            <div role="group" aria-labelledby={`${baseId}-courses`} className="flex flex-wrap gap-2">
              {COURSE_VALUES.map((course) => (
                <ChipFilter
                  key={course}
                  label={COURSE_LABELS[course]}
                  isSelected={filter.courses.includes(course)}
                  onClick={() => onFilterChange({ ...filter, courses: toggled(filter.courses, course) })}
                />
              ))}
            </div>
          </div>
          <div className="space-y-2">
            <p id={`${baseId}-tags`} className={GROUP_TITLE_CLASS}>Tipo di pasti</p>
            <div role="group" aria-labelledby={`${baseId}-tags`} className="flex flex-wrap gap-2">
              {MEAL_STYLE_TAG_VALUES.map((tag) => (
                <ChipFilter
                  key={tag}
                  label={MEAL_STYLE_TAG_LABELS[tag]}
                  isSelected={filter.tags.includes(tag)}
                  onClick={() => onFilterChange({ ...filter, tags: toggled(filter.tags, tag) })}
                />
              ))}
            </div>
          </div>
          <div className="space-y-2">
            <p id={`${baseId}-diets`} className={GROUP_TITLE_CLASS}>Dieta</p>
            <div role="group" aria-labelledby={`${baseId}-diets`} className="flex flex-wrap gap-2">
              {DIET_FLAG_VALUES.map((diet) => (
                <ChipFilter
                  key={diet}
                  label={DIET_FLAG_LABELS[diet]}
                  isSelected={filter.diets.includes(diet)}
                  onClick={() => onFilterChange({ ...filter, diets: toggled(filter.diets, diet) })}
                />
              ))}
            </div>
          </div>
          <div className="space-y-2">
            <p id={`${baseId}-other`} className={GROUP_TITLE_CLASS}>Altro</p>
            <div role="group" aria-labelledby={`${baseId}-other`} className="flex flex-wrap gap-2">
              <ChipFilter
                label="Bloccate"
                icon={<Ban className="h-3.5 w-3.5" aria-hidden="true" />}
                isSelected={filter.blocked}
                onClick={() => onFilterChange({ ...filter, blocked: !filter.blocked })}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
