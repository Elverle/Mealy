"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { RecipeCard } from "@/components/library/recipe-card";
import { LibraryFilters } from "@/components/library/library-filters";
import { EmptyState } from "@/components/feedback/empty-state";
import { Toast } from "@/components/feedback/toast";
import {
  RecipeDetailSheet,
  type RecipePrefChanges,
} from "@/components/recipes/recipe-detail-sheet";
import { Button } from "@/components/ui/button";
import { filterLibraryCards } from "@/lib/domain/library";
import {
  EMPTY_LIBRARY_FILTER,
  type LibraryFilter,
  type LibraryRecipeCard,
} from "@/lib/domain/types";
import { apiErrorMessage } from "@/lib/http/client";
import { putRecipePref } from "@/lib/prefs/client";

export interface LibraryScreenProps {
  initialRecipes: LibraryRecipeCard[];
  persons: number;
}

function recipesCountLabel(count: number): string {
  return count === 1 ? "1 ricetta" : `${count} ricette`;
}

function hasFilterCriteria(filter: LibraryFilter): boolean {
  return (
    filter.favorites ||
    filter.blocked ||
    filter.meals.length > 0 ||
    filter.tags.length > 0 ||
    filter.diets.length > 0
  );
}

export function LibraryScreen({ initialRecipes, persons }: LibraryScreenProps): React.JSX.Element {
  const router = useRouter();
  const [cards, setCards] = React.useState<LibraryRecipeCard[]>(initialRecipes);
  // Dati nuovi dal server (es. `router.refresh()`): si riallinea lo stato.
  const [syncedInitialRecipes, setSyncedInitialRecipes] = React.useState(initialRecipes);
  if (syncedInitialRecipes !== initialRecipes) {
    setSyncedInitialRecipes(initialRecipes);
    setCards(initialRecipes);
  }
  const [query, setQuery] = React.useState("");
  const [filter, setFilter] = React.useState<LibraryFilter>(EMPTY_LIBRARY_FILTER);
  const [sheetRecipeId, setSheetRecipeId] = React.useState<string | null>(null);
  const [toast, setToast] = React.useState<string | null>(null);
  const savingFavorites = React.useRef<Set<string>>(new Set());

  const visible = React.useMemo(
    () => filterLibraryCards(cards, { ...filter, q: query }),
    [cards, filter, query]
  );
  const hasActiveFilter = query.trim() !== "" || hasFilterCriteria(filter);

  const resetFilters = () => {
    setQuery("");
    setFilter(EMPTY_LIBRARY_FILTER);
  };

  /** Fonde nella card solo i campi indicati. */
  const patchCard = React.useCallback((id: string, changes: RecipePrefChanges) => {
    setCards((prev) =>
      prev.map((card) => {
        if (card.id !== id) return card;
        const next = { ...card };
        if (changes.rating !== undefined) next.rating = changes.rating ?? null;
        if (changes.favorite !== undefined) next.favorite = changes.favorite;
        if (changes.blocked !== undefined) next.blocked = changes.blocked;
        return next;
      })
    );
  }, []);

  const handleToggleFavorite = async (id: string) => {
    if (savingFavorites.current.has(id)) return;
    const card = cards.find((c) => c.id === id);
    if (!card) return;
    const previous = card.favorite;
    const next = !previous;
    savingFavorites.current.add(id);
    patchCard(id, { favorite: next });
    try {
      const saved = await putRecipePref(id, { favorite: next });
      // Solo `favorite`: una risposta tardiva non deve sovrascrivere voto o blocco più recenti.
      patchCard(id, { favorite: saved.favorite });
    } catch (err) {
      patchCard(id, { favorite: previous });
      setToast(apiErrorMessage(err));
    } finally {
      savingFavorites.current.delete(id);
    }
  };

  const emptyAction = { actionLabel: "Azzera filtri", onAction: resetFilters };

  return (
    <main className="min-h-screen px-4 py-6 max-w-xl mx-auto">
      <header className="mb-5">
        <h1 className="font-display text-2xl font-bold text-ink">Libreria Ricette</h1>
        <p className="text-stone text-xs mt-0.5">Tutte le tue ricette, da ritrovare e giudicare</p>
      </header>

      {cards.length === 0 ? (
        <EmptyState
          title="Ancora nessuna ricetta"
          description="Genera il primo piano e la libreria si riempie da sola."
          actionLabel="Vai al piano"
          onAction={() => router.push("/")}
        />
      ) : (
        <>
          <LibraryFilters
            query={query}
            onQueryChange={setQuery}
            filter={filter}
            onFilterChange={setFilter}
          />
          <div className="mb-3 mt-4 flex items-center justify-between gap-2">
            <p className="text-sm text-stone">{recipesCountLabel(visible.length)}</p>
            {hasActiveFilter && (
              <Button variant="ghost" size="sm" onClick={resetFilters}>
                Azzera filtri
              </Button>
            )}
          </div>
          {visible.length === 0 ? (
            filter.blocked ? (
              <EmptyState
                title="Nessuna ricetta bloccata"
                description="Le ricette che segni con «Non proporre più» le ritrovi qui."
                {...emptyAction}
              />
            ) : (
              <EmptyState
                title="Nessuna ricetta trovata"
                description="Prova a cambiare i filtri o il testo cercato."
                {...emptyAction}
              />
            )
          ) : (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {visible.map((recipe) => (
                <RecipeCard
                  key={recipe.id}
                  recipe={recipe}
                  onOpen={setSheetRecipeId}
                  onToggleFavorite={handleToggleFavorite}
                />
              ))}
            </div>
          )}
        </>
      )}

      <RecipeDetailSheet
        recipeId={sheetRecipeId}
        servings={persons}
        onClose={() => setSheetRecipeId(null)}
        onRecipePrefsChange={patchCard}
        onNotify={setToast}
      />
      <Toast message={toast} onDismiss={() => setToast(null)} />
    </main>
  );
}
