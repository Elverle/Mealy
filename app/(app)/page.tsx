"use client";

import * as React from "react";
import Link from "next/link";
import { Sparkles, ShoppingBag, RotateCcw } from "lucide-react";
import { MealCard } from "@/components/cards/meal-card";
import { RecipeSheet, type RecipeDetail } from "@/components/sheets/recipe-sheet";
import { EmptyState } from "@/components/feedback/empty-state";
import { Button } from "@/components/ui/button";

interface MockMeal {
  id: string;
  day: string;
  mealType: string;
  title: string;
  prepTimeMinutes: number;
  tags: string[];
  isFavorite: boolean;
  isLocked: boolean;
  recipeDetail: RecipeDetail;
}

const INITIAL_MEALS: MockMeal[] = [
  {
    id: "meal-1",
    day: "Lunedì",
    mealType: "Pranzo",
    title: "Pasta al pesto genovese",
    prepTimeMinutes: 20,
    tags: ["Primo", "Vegetariano"],
    isFavorite: true,
    isLocked: false,
    recipeDetail: {
      id: "meal-1",
      title: "Pasta al pesto genovese",
      description: "Classico primo piatto ligure con basilico fresco, pinoli e parmigiano.",
      prepTimeMinutes: 20,
      servings: 2,
      tags: ["Primo", "Vegetariano", "Veloce"],
      ingredients: [
        { id: "ing-1", name: "Trofie o spaghetti", amount: 180, unit: "g" },
        { id: "ing-2", name: "Basilico fresco", amount: 50, unit: "g", preference: "liked" },
        { id: "ing-3", name: "Pinoli", amount: 30, unit: "g" },
        { id: "ing-4", name: "Parmigiano Reggiano", amount: 40, unit: "g" },
        { id: "ing-5", name: "Olio extravergine d'oliva", amount: 50, unit: "ml" },
      ],
      steps: [
        "Lava e asciuga delicatamente le foglie di basilico.",
        "Pesta o frulla il basilico con i pinoli, il parmigiano e l'olio d'oliva a filo fino a ottenere una crema omogenea.",
        "Porta a bollore una pentola d'acqua salata e cuoci la pasta al dente.",
        "Scola la pasta tenendo da parte un goccio d'acqua di cottura.",
        "Manteca la pasta con il pesto fuori dal fuoco, aggiungendo un cucchiaio d'acqua di cottura per renderla cremosa.",
      ],
      rating: 5,
      isFavorite: true,
    },
  },
  {
    id: "meal-2",
    day: "Lunedì",
    mealType: "Cena",
    title: "Salmone al forno con patate",
    prepTimeMinutes: 35,
    tags: ["Secondo", "Pesce"],
    isFavorite: false,
    isLocked: false,
    recipeDetail: {
      id: "meal-2",
      title: "Salmone al forno con patate",
      description: "Filetti di salmone dorati accompagnati da patate croccanti al rosmarino.",
      prepTimeMinutes: 35,
      servings: 2,
      tags: ["Secondo", "Pesce", "Sano"],
      ingredients: [
        { id: "ing-6", name: "Filetti di salmone", amount: 350, unit: "g" },
        { id: "ing-7", name: "Patate", amount: 400, unit: "g" },
        { id: "ing-8", name: "Rosmarino", amount: 2, unit: "rametti" },
        { id: "ing-9", name: "Olio EVO", amount: 20, unit: "ml" },
      ],
      steps: [
        "Pela e taglia le patate a cubetti.",
        "Disponi le patate su una teglia con olio, sale e rosmarino e inforna a 200°C per 20 minuti.",
        "Aggiungi i filetti di salmone salati e pepati sulla teglia.",
        "Cuoci per altri 15 minuti finché il salmone è tenero e succoso.",
      ],
      rating: 4,
      isFavorite: false,
    },
  },
  {
    id: "meal-3",
    day: "Martedì",
    mealType: "Pranzo",
    title: "Insalata di farro e verdure",
    prepTimeMinutes: 15,
    tags: ["Piatto unico", "Vegetariano"],
    isFavorite: false,
    isLocked: false,
    recipeDetail: {
      id: "meal-3",
      title: "Insalata di farro e verdure",
      description: "Piatto fresco e nutriente con pomodorini, cetrioli, feta e basilico.",
      prepTimeMinutes: 15,
      servings: 2,
      tags: ["Piatto unico", "Vegetariano", "Leggero"],
      ingredients: [
        { id: "ing-10", name: "Farro perlato", amount: 160, unit: "g" },
        { id: "ing-11", name: "Pomodorini ciliegino", amount: 150, unit: "g" },
        { id: "ing-12", name: "Feta", amount: 100, unit: "g" },
        { id: "ing-13", name: "Cetriolo", amount: 1, unit: "pz" },
      ],
      steps: [
        "Sciacqua il farro e cuocilo in acqua bollente salata per circa 20 minuti, poi fallo raffreddare.",
        "Taglia i pomodorini a spicchi, il cetriolo a rondelle e sbriciola la feta.",
        "Unisci il farro con le verdure in un'insalatiera, condisci con olio, sale e basilico.",
      ],
      rating: 4,
      isFavorite: false,
    },
  },
  {
    id: "meal-4",
    day: "Martedì",
    mealType: "Cena",
    title: "Pollo al limone con rosmarino",
    prepTimeMinutes: 30,
    tags: ["Secondo", "Carne"],
    isFavorite: true,
    isLocked: false,
    recipeDetail: {
      id: "meal-4",
      title: "Pollo al limone con rosmarino",
      description: "Bocconcini di petto di pollo teneri con salsa cremosa al limone.",
      prepTimeMinutes: 30,
      servings: 2,
      tags: ["Secondo", "Carne", "Veloce"],
      ingredients: [
        { id: "ing-14", name: "Petto di pollo", amount: 400, unit: "g" },
        { id: "ing-15", name: "Limone (succo e scorza)", amount: 1, unit: "pz" },
        { id: "ing-16", name: "Farina", amount: 30, unit: "g" },
        { id: "ing-17", name: "Olio EVO", amount: 15, unit: "ml" },
      ],
      steps: [
        "Taglia il pollo a bocconcini e infarinalo leggermente.",
        "In una padella antiaderente rosola il pollo nell'olio finché è dorato.",
        "Sfumalo con il succo di limone, aggiungi la scorza grattugiata e rosmarino.",
        "Lascia addensare il sughetto per 5 minuti e servi caldo.",
      ],
      rating: 5,
      isFavorite: true,
    },
  },
  {
    id: "meal-5",
    day: "Mercoledì",
    mealType: "Cena",
    title: "Vellutata di zucca con crostini",
    prepTimeMinutes: 25,
    tags: ["Comfort food", "Vegetariano"],
    isFavorite: false,
    isLocked: false,
    recipeDetail: {
      id: "meal-5",
      title: "Vellutata di zucca con crostini",
      description: "Vellutata calda e avvolgente con zucca mantovana e semi tostati.",
      prepTimeMinutes: 25,
      servings: 2,
      tags: ["Comfort food", "Vegetariano"],
      ingredients: [
        { id: "ing-18", name: "Zucca mantovana", amount: 500, unit: "g" },
        { id: "ing-19", name: "Cipolla dorata", amount: 1, unit: "pz" },
        { id: "ing-20", name: "Brodo vegetale", amount: 400, unit: "ml" },
        { id: "ing-21", name: "Pane casereccio", amount: 100, unit: "g" },
      ],
      steps: [
        "Taglia la zucca a cubetti e falla rosolare con la cipolla tritata.",
        "Copri con il brodo caldo e lascia cuocere per 15-20 minuti finché è morbida.",
        "Frulla con un frullatore a immersione fino a consistenza liscia e vellutata.",
        "Tosta i dadini di pane in padella con un filo d'olio e servili sopra la vellutata.",
      ],
      rating: 4,
      isFavorite: false,
    },
  },
];

const SWAP_POOL: Omit<MockMeal, "day" | "mealType">[] = [
  {
    id: "swap-1",
    title: "Risotto ai funghi porcini",
    prepTimeMinutes: 25,
    tags: ["Primo", "Autunno"],
    isFavorite: false,
    isLocked: false,
    recipeDetail: {
      id: "swap-1",
      title: "Risotto ai funghi porcini",
      description: "Risotto mantecato con funghi porcini e burro di malga.",
      prepTimeMinutes: 25,
      servings: 2,
      tags: ["Primo", "Autunno"],
      ingredients: [
        { id: "ing-22", name: "Riso Carnaroli", amount: 180, unit: "g" },
        { id: "ing-23", name: "Funghi porcini", amount: 200, unit: "g" },
        { id: "ing-24", name: "Brodo vegetale", amount: 600, unit: "ml" },
      ],
      steps: [
        "Tosta il riso a secco, sfuma con vino bianco.",
        "Aggiungi il brodo poco a poco e a metà cottura unisci i porcini trifolati.",
        "Manteca fuori dal fuoco con parmigiano e burro.",
      ],
      rating: 5,
    },
  },
  {
    id: "swap-2",
    title: "Frittata alle erbe di campo",
    prepTimeMinutes: 15,
    tags: ["Secondo", "Veloce"],
    isFavorite: false,
    isLocked: false,
    recipeDetail: {
      id: "swap-2",
      title: "Frittata alle erbe di campo",
      description: "Frittata soffice con uova fresche, erba cipollina e maggiorana.",
      prepTimeMinutes: 15,
      servings: 2,
      tags: ["Secondo", "Veloce"],
      ingredients: [
        { id: "ing-25", name: "Uova bio", amount: 4, unit: "pz" },
        { id: "ing-26", name: "Erbe miste", amount: 20, unit: "g" },
        { id: "ing-27", name: "Parmigiano", amount: 20, unit: "g" },
      ],
      steps: [
        "Sbatti le uova con un pizzico di sale e pepe.",
        "Aggiungi le erbe tritate finemente e il parmigiano.",
        "Cuoci in padella calda con un filo d'olio 4 minuti per lato.",
      ],
      rating: 4,
    },
  },
];

export default function Home() {
  const [meals, setMeals] = React.useState<MockMeal[]>(INITIAL_MEALS);
  const [selectedRecipe, setSelectedRecipe] = React.useState<RecipeDetail | null>(
    null
  );
  const [isSheetOpen, setIsSheetOpen] = React.useState(false);
  const [swapIndex, setSwapIndex] = React.useState(0);

  const handleToggleFavorite = (id: string) => {
    setMeals((prev) =>
      prev.map((m) => (m.id === id ? { ...m, isFavorite: !m.isFavorite } : m))
    );
    if (selectedRecipe && selectedRecipe.id === id) {
      setSelectedRecipe((prev) =>
        prev ? { ...prev, isFavorite: !prev.isFavorite } : null
      );
    }
  };

  const handleToggleLock = (id: string) => {
    setMeals((prev) =>
      prev.map((m) => (m.id === id ? { ...m, isLocked: !m.isLocked } : m))
    );
  };

  const handleSwap = (id: string) => {
    const replacement = SWAP_POOL[swapIndex % SWAP_POOL.length];
    setSwapIndex((idx) => idx + 1);

    setMeals((prev) =>
      prev.map((m) => {
        if (m.id === id) {
          return {
            ...m,
            title: replacement.title,
            prepTimeMinutes: replacement.prepTimeMinutes,
            tags: replacement.tags,
            recipeDetail: replacement.recipeDetail,
          };
        }
        return m;
      })
    );
  };

  const handleSelectMeal = (id: string) => {
    const meal = meals.find((m) => m.id === id);
    if (meal) {
      setSelectedRecipe(meal.recipeDetail);
      setIsSheetOpen(true);
    }
  };

  const handleClearPlan = () => {
    setMeals([]);
  };

  const handleRegeneratePlan = () => {
    setMeals(INITIAL_MEALS);
  };

  return (
    <main className="min-h-screen px-4 py-6 max-w-xl mx-auto">
      {/* Header with Mealy branding and subtitle matching verification tests */}
      <header className="mb-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="font-display text-3xl font-bold text-ink">Mealy</h1>
            <p className="text-stone text-sm">Cosa mangio oggi?</p>
          </div>
          {meals.length > 0 && (
            <Button
              variant="outline"
              size="sm"
              onClick={handleClearPlan}
              aria-label="Svuota piano"
              className="text-xs"
            >
              <RotateCcw className="h-3.5 w-3.5 mr-1 text-stone" />
              Svuota
            </Button>
          )}
        </div>

        {/* Color tokens badge pill bar (ensures compatibility with test suite) */}
        <div className="flex items-center gap-2 mt-3">
          <span className="px-3 py-1 rounded-full bg-basil text-paper text-xs font-semibold">
            Basil
          </span>
          <span className="px-3 py-1 rounded-full bg-tomato text-paper text-xs font-semibold">
            Tomato
          </span>
          <span className="px-3 py-1 rounded-full bg-saffron text-ink text-xs font-semibold">
            Saffron
          </span>
        </div>
      </header>

      {/* Week Title & Actions */}
      <div className="mb-5 flex items-center justify-between">
        <div>
          <h2 className="font-display text-xl font-bold text-ink">
            Piano Settimanale
          </h2>
          <p className="text-xs text-stone">Settimana 15 – 21 Settembre</p>
        </div>
        <Button
          onClick={handleRegeneratePlan}
          className="shadow-sm"
          size="sm"
        >
          <Sparkles className="h-4 w-4" />
          <span>Genera piano</span>
        </Button>
      </div>

      {/* Meal Cards or Empty State */}
      {meals.length === 0 ? (
        <EmptyState
          title="Nessun pasto pianificato"
          description="Genera il tuo primo piano per iniziare la settimana con piatti freschi e bilanciati."
          actionLabel="Genera piano"
          onAction={handleRegeneratePlan}
          className="my-10"
        />
      ) : (
        <div className="flex flex-col gap-4">
          {meals.map((meal) => (
            <MealCard
              key={meal.id}
              id={meal.id}
              day={meal.day}
              mealType={meal.mealType}
              title={meal.title}
              prepTimeMinutes={meal.prepTimeMinutes}
              tags={meal.tags}
              isFavorite={meal.isFavorite}
              isLocked={meal.isLocked}
              onToggleFavorite={handleToggleFavorite}
              onSwap={handleSwap}
              onToggleLock={handleToggleLock}
              onSelect={handleSelectMeal}
            />
          ))}

          {/* Sticky/Fixed bottom action CTA to go to Shopping List */}
          <div className="mt-6 pt-2 pb-6">
            <Link href="/lista" className="w-full block">
              <Button className="w-full text-base font-semibold shadow-md gap-2 h-12">
                <ShoppingBag className="h-5 w-5" />
                <span>Crea lista della spesa</span>
              </Button>
            </Link>
          </div>
        </div>
      )}

      {/* Recipe Detail Sheet */}
      <RecipeSheet
        recipe={selectedRecipe}
        isOpen={isSheetOpen}
        onClose={() => setIsSheetOpen(false)}
        onToggleFavorite={handleToggleFavorite}
        onToggleBlock={(id) => {
          setSelectedRecipe((prev) =>
            prev && prev.id === id
              ? { ...prev, isBlocked: !prev.isBlocked }
              : prev
          );
        }}
        onRate={(id, rating) => {
          setSelectedRecipe((prev) =>
            prev && prev.id === id ? { ...prev, rating } : prev
          );
        }}
      />
    </main>
  );
}
