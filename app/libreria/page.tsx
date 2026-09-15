"use client";

import * as React from "react";
import { Search, Star, Clock, Ban } from "lucide-react";
import { ChipFilter } from "@/components/filters/chip-filter";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { RecipeSheet, type RecipeDetail } from "@/components/sheets/recipe-sheet";
import { EmptyState } from "@/components/feedback/empty-state";
import { cn } from "@/lib/utils";

const MOCK_RECIPES: RecipeDetail[] = [
  {
    id: "lib-1",
    title: "Pasta al pesto genovese",
    description: "Classico primo piatto ligure con basilico fresco, pinoli e parmigiano.",
    prepTimeMinutes: 20,
    servings: 2,
    tags: ["Primo", "Vegetariano", "Veloce"],
    ingredients: [
      { id: "ing-1", name: "Trofie o spaghetti", amount: 180, unit: "g" },
      { id: "ing-2", name: "Basilico fresco", amount: 50, unit: "g", preference: "liked" },
      { id: "ing-3", name: "Pinoli", amount: 30, unit: "g" },
    ],
    steps: [
      "Pesta o frulla il basilico fresco con i pinoli e l'olio.",
      "Cuoci la pasta al dente.",
      "Manteca con il pesto a freddo.",
    ],
    rating: 5,
    isFavorite: true,
  },
  {
    id: "lib-2",
    title: "Salmone al forno con patate",
    description: "Filetti di salmone dorati accompagnati da patate croccanti al rosmarino.",
    prepTimeMinutes: 35,
    servings: 2,
    tags: ["Secondo", "Pesce", "Sano"],
    ingredients: [
      { id: "ing-4", name: "Salmone fresco", amount: 350, unit: "g" },
      { id: "ing-5", name: "Patate novelle", amount: 400, unit: "g" },
    ],
    steps: [
      "Inforna le patate a 200°C per 20 minuti.",
      "Aggiungi i filetti di salmone e cuoci per altri 15 minuti.",
    ],
    rating: 4,
    isFavorite: false,
  },
  {
    id: "lib-3",
    title: "Insalata di farro e verdure estive",
    description: "Piatto fresco e nutriente con pomodorini, cetrioli, feta e basilico.",
    prepTimeMinutes: 15,
    servings: 2,
    tags: ["Piatto unico", "Vegetariano", "Leggero"],
    ingredients: [
      { id: "ing-6", name: "Farro perlato", amount: 160, unit: "g" },
      { id: "ing-7", name: "Pomodorini ciliegino", amount: 150, unit: "g" },
      { id: "ing-8", name: "Feta", amount: 100, unit: "g" },
    ],
    steps: [
      "Cuoci il farro e fallo raffreddare.",
      "Unisci le verdure a dadini e condisci con olio extravergine.",
    ],
    rating: 4,
    isFavorite: false,
  },
  {
    id: "lib-4",
    title: "Pollo al limone con rosmarino",
    description: "Bocconcini di petto di pollo teneri con salsa cremosa al limone.",
    prepTimeMinutes: 30,
    servings: 2,
    tags: ["Secondo", "Carne", "Veloce"],
    ingredients: [
      { id: "ing-9", name: "Petto di pollo", amount: 400, unit: "g" },
      { id: "ing-10", name: "Limone", amount: 1, unit: "pz" },
    ],
    steps: [
      "Rosola il pollo a bocconcini in padella.",
      "Sfuma con succo di limone e lascia addensare il sughetto.",
    ],
    rating: 5,
    isFavorite: true,
  },
  {
    id: "lib-5",
    title: "Risotto ai funghi porcini",
    description: "Risotto autunnale mantecato con funghi porcini e parmigiano.",
    prepTimeMinutes: 25,
    servings: 2,
    tags: ["Primo", "Vegetariano"],
    ingredients: [
      { id: "ing-11", name: "Riso carnaroli", amount: 180, unit: "g" },
      { id: "ing-12", name: "Funghi porcini", amount: 200, unit: "g" },
    ],
    steps: [
      "Tosta il riso e sfuma col brodo caldo.",
      "Unisci i porcini trifolati e manteca all'onda.",
    ],
    rating: 5,
    isFavorite: true,
  },
  {
    id: "lib-6",
    title: "Minestrone di verdure e legumi",
    description: "Piatto caldo della tradizione ricco di ortaggi di stagione.",
    prepTimeMinutes: 45,
    servings: 4,
    tags: ["Primo", "Vegetariano", "Leggero"],
    ingredients: [
      { id: "ing-13", name: "Verdure miste", amount: 500, unit: "g" },
      { id: "ing-14", name: "Fagioli cannellini", amount: 200, unit: "g" },
    ],
    steps: [
      "Cuoci a fuoco dolce per 40 minuti fino a cottura delle verdure.",
    ],
    rating: 3,
    isFavorite: false,
    isBlocked: true,
  },
];

const FILTER_TAGS = [
  "Tutte",
  "Preferite",
  "Primo",
  "Secondo",
  "Vegetariano",
  "Veloce",
  "Bloccate",
];

export default function LibraryPage() {
  const [recipes, setRecipes] = React.useState<RecipeDetail[]>(MOCK_RECIPES);
  const [searchQuery, setSearchQuery] = React.useState("");
  const [selectedTag, setSelectedTag] = React.useState("Tutte");
  const [selectedRecipe, setSelectedRecipe] = React.useState<RecipeDetail | null>(
    null
  );
  const [isSheetOpen, setIsSheetOpen] = React.useState(false);

  const filteredRecipes = React.useMemo(() => {
    const lowerQuery = searchQuery.toLowerCase();
    return recipes.filter((r) => {
      // Search text match
      const matchesSearch =
        r.title.toLowerCase().includes(lowerQuery) ||
        r.tags?.some((t) => t.toLowerCase().includes(lowerQuery));

      if (!matchesSearch) return false;

      // Filter tag match
      if (selectedTag === "Tutte") return !r.isBlocked;
      if (selectedTag === "Preferite") return r.isFavorite && !r.isBlocked;
      if (selectedTag === "Bloccate") return r.isBlocked;
      return r.tags?.includes(selectedTag) && !r.isBlocked;
    });
  }, [recipes, searchQuery, selectedTag]);

  const handleToggleFavorite = (id: string) => {
    setRecipes((prev) =>
      prev.map((r) => (r.id === id ? { ...r, isFavorite: !r.isFavorite } : r))
    );
    if (selectedRecipe && selectedRecipe.id === id) {
      setSelectedRecipe((prev) =>
        prev ? { ...prev, isFavorite: !prev.isFavorite } : null
      );
    }
  };

  const handleToggleBlock = (id: string) => {
    setRecipes((prev) =>
      prev.map((r) => (r.id === id ? { ...r, isBlocked: !r.isBlocked } : r))
    );
    if (selectedRecipe && selectedRecipe.id === id) {
      setSelectedRecipe((prev) =>
        prev ? { ...prev, isBlocked: !prev.isBlocked } : null
      );
    }
  };

  const handleSelectRecipe = (recipe: RecipeDetail) => {
    setSelectedRecipe(recipe);
    setIsSheetOpen(true);
  };

  return (
    <main className="min-h-screen px-4 py-6 max-w-xl mx-auto">
      {/* Header */}
      <header className="mb-5">
        <h1 className="font-display text-2xl font-bold text-ink">
          Libreria Ricette
        </h1>
        <p className="text-stone text-xs mt-0.5">
          Il tuo pool persistente di piatti e ricette
        </p>

        {/* Search Bar */}
        <div className="relative mt-4">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-stone" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Cerca ricetta o ingrediente..."
            className="w-full rounded-xl border border-stone/20 bg-white py-2.5 pl-10 pr-4 text-sm text-ink placeholder:text-stone/60 focus:border-basil focus:outline-none focus:ring-1 focus:ring-basil"
          />
        </div>

        {/* Filter Chips carousel / row */}
        <div className="mt-3 flex items-center gap-2 overflow-x-auto pb-1 scrollbar-none">
          {FILTER_TAGS.map((tag) => (
            <ChipFilter
              key={tag}
              label={tag}
              isSelected={selectedTag === tag}
              onClick={() => setSelectedTag(tag)}
            />
          ))}
        </div>
      </header>

      {/* Recipe list / grid */}
      {filteredRecipes.length === 0 ? (
        <EmptyState
          title={
            searchQuery
              ? "Nessuna ricetta trovata"
              : "Ancora nessuna ricetta"
          }
          description={
            searchQuery
              ? "Prova a modificare i filtri o il testo cercato."
              : "Ancora nessuna ricetta. Genera il primo piano e la libreria si riempie da sola."
          }
          actionLabel={searchQuery ? "Resetta filtri" : undefined}
          onAction={() => {
            setSearchQuery("");
            setSelectedTag("Tutte");
          }}
        />
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {filteredRecipes.map((recipe) => (
            <Card
              key={recipe.id}
              onClick={() => handleSelectRecipe(recipe)}
              className="flex flex-col justify-between p-4 cursor-pointer hover:border-stone/40 hover:shadow-sm transition-all"
            >
              <div>
                <div className="flex items-center justify-between gap-1 mb-1.5">
                  <Badge variant="secondary" className="gap-1 text-[11px]">
                    <Clock className="h-3 w-3 text-stone" />
                    <span className="tabular-nums">{recipe.prepTimeMinutes}m</span>
                  </Badge>
                  {recipe.isBlocked ? (
                    <span className="text-[11px] font-semibold text-tomato flex items-center gap-1">
                      <Ban className="h-3 w-3" /> Bloccata
                    </span>
                  ) : (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleToggleFavorite(recipe.id);
                      }}
                      aria-label="Preferita"
                      className="flex h-11 w-11 items-center justify-center -mr-2 text-stone hover:text-saffron transition-colors cursor-pointer"
                    >
                      <Star
                        className={cn(
                          "h-4 w-4",
                          recipe.isFavorite
                            ? "fill-saffron text-saffron"
                            : "text-stone"
                        )}
                      />
                    </button>
                  )}
                </div>

                <h3 className="font-display text-base font-bold text-ink hover:text-basil transition-colors line-clamp-2">
                  {recipe.title}
                </h3>
              </div>

              <div className="mt-3 flex items-center justify-between border-t border-stone/15 pt-2 text-xs">
                <div className="flex items-center gap-1 text-stone">
                  {recipe.tags?.slice(0, 2).map((t) => (
                    <span key={t} className="rounded bg-stone/10 px-1.5 py-0.5">
                      {t}
                    </span>
                  ))}
                </div>
                {recipe.rating && (
                  <div className="flex items-center gap-0.5 text-saffron font-bold">
                    <Star className="h-3.5 w-3.5 fill-saffron" />
                    <span>{recipe.rating}</span>
                  </div>
                )}
              </div>
            </Card>
          ))}
        </div>
      )}

      {/* Recipe Detail Sheet */}
      <RecipeSheet
        recipe={selectedRecipe}
        isOpen={isSheetOpen}
        onClose={() => setIsSheetOpen(false)}
        onToggleFavorite={handleToggleFavorite}
        onToggleBlock={handleToggleBlock}
      />
    </main>
  );
}
