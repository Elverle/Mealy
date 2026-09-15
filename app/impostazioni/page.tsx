"use client";

import * as React from "react";
import {
  Users,
  Plus,
  X,
  Sparkles,
  Save,
  Flame,
  Check,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  DIET_FLAG_VALUES,
  DIET_FLAG_LABELS,
  APPLIANCE_VALUES,
  APPLIANCE_LABELS,
  type DietFlag,
  type Appliance,
} from "@/lib/domain/types";

interface IngredientPref {
  id: string;
  name: string;
}

export default function SettingsPage() {
  const [servings, setServings] = React.useState(2);
  const [selectedMeals, setSelectedMeals] = React.useState<{
    pranzo: boolean;
    cena: boolean;
  }>({
    pranzo: true,
    cena: true,
  });

  const [dietaryNeeds, setDietaryNeeds] = React.useState<DietFlag[]>([]);

  const [appliances, setAppliances] = React.useState<Appliance[]>([
    "forno",
    "friggitrice-ad-aria",
  ]);

  const [likedIngredients, setLikedIngredients] = React.useState<
    IngredientPref[]
  >([
    { id: "1", name: "Basilico fresco" },
    { id: "2", name: "Parmigiano Reggiano" },
    { id: "3", name: "Salmone" },
    { id: "4", name: "Funghi porcini" },
  ]);

  const [dislikedIngredients, setDislikedIngredients] = React.useState<
    IngredientPref[]
  >([
    { id: "5", name: "Coriandolo" },
    { id: "6", name: "Peperoni crudi" },
  ]);

  const [newLikedInput, setNewLikedInput] = React.useState("");
  const [newDislikedInput, setNewDislikedInput] = React.useState("");
  const [isSaved, setIsSaved] = React.useState(false);

  const toggleDiet = (diet: DietFlag) => {
    setDietaryNeeds((prev) =>
      prev.includes(diet) ? prev.filter((d) => d !== diet) : [...prev, diet]
    );
  };

  const toggleAppliance = (app: Appliance) => {
    setAppliances((prev) =>
      prev.includes(app) ? prev.filter((a) => a !== app) : [...prev, app]
    );
  };

  const handleAddLiked = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newLikedInput.trim()) return;
    setLikedIngredients((prev) => [
      ...prev,
      { id: `liked-${Date.now()}`, name: newLikedInput.trim() },
    ]);
    setNewLikedInput("");
  };

  const handleAddDisliked = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newDislikedInput.trim()) return;
    setDislikedIngredients((prev) => [
      ...prev,
      { id: `disliked-${Date.now()}`, name: newDislikedInput.trim() },
    ]);
    setNewDislikedInput("");
  };

  const handleRemoveLiked = (id: string) => {
    setLikedIngredients((prev) => prev.filter((i) => i.id !== id));
  };

  const handleRemoveDisliked = (id: string) => {
    setDislikedIngredients((prev) => prev.filter((i) => i.id !== id));
  };

  const handleSave = () => {
    setIsSaved(true);
    setTimeout(() => setIsSaved(false), 2500);
  };

  return (
    <main className="min-h-screen px-4 py-6 max-w-xl mx-auto space-y-6">
      {/* Header */}
      <header className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-2xl font-bold text-ink">
            Impostazioni
          </h1>
          <p className="text-stone text-xs mt-0.5">
            Preferenze del tuo nucleo e vincoli per il piano
          </p>
        </div>
        <Button onClick={handleSave} size="sm" className="shadow-xs">
          {isSaved ? (
            <>
              <Check className="h-4 w-4 text-paper" />
              <span>Salvate!</span>
            </>
          ) : (
            <>
              <Save className="h-4 w-4" />
              <span>Salva</span>
            </>
          )}
        </Button>
      </header>

      {/* Sezione 1: Nucleo Familiare */}
      <Card className="p-4 space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Users className="h-5 w-5 text-basil" />
            <h2 className="font-display text-base font-bold text-ink">
              Persone nel nucleo
            </h2>
          </div>
          <span className="font-bold text-basil text-lg tabular-nums">
            {servings}
          </span>
        </div>
        <p className="text-xs text-stone">
          Numero predefinito di porzioni per scalare ingredienti e lista della spesa.
        </p>
        <div className="flex items-center gap-2 pt-1">
          {[1, 2, 3, 4, 5, 6].map((num) => (
            <button
              key={num}
              type="button"
              onClick={() => setServings(num)}
              className={`flex h-11 flex-1 items-center justify-center rounded-xl border text-sm font-semibold transition-all cursor-pointer ${
                servings === num
                  ? "border-basil bg-basil text-paper shadow-xs"
                  : "border-stone/20 bg-white text-stone hover:border-stone/40 hover:text-ink"
              }`}
            >
              {num}
            </button>
          ))}
        </div>
      </Card>

      {/* Sezione 2: Pasti da Pianificare */}
      <Card className="p-4 space-y-3">
        <h2 className="font-display text-base font-bold text-ink">
          Pasti da pianificare
        </h2>
        <p className="text-xs text-stone">
          Scegli quali momenti della giornata inserire nella generazione del piano.
        </p>
        <div className="grid grid-cols-2 gap-3 pt-1">
          <button
            type="button"
            onClick={() =>
              setSelectedMeals((prev) => ({ ...prev, pranzo: !prev.pranzo }))
            }
            className={`flex min-h-[48px] items-center justify-between rounded-xl border p-3 text-sm font-semibold transition-all cursor-pointer ${
              selectedMeals.pranzo
                ? "border-basil bg-basil/10 text-basil"
                : "border-stone/20 bg-white text-stone hover:border-stone/40"
            }`}
          >
            <span>Pranzo</span>
            {selectedMeals.pranzo && <Check className="h-4 w-4" />}
          </button>
          <button
            type="button"
            onClick={() =>
              setSelectedMeals((prev) => ({ ...prev, cena: !prev.cena }))
            }
            className={`flex min-h-[48px] items-center justify-between rounded-xl border p-3 text-sm font-semibold transition-all cursor-pointer ${
              selectedMeals.cena
                ? "border-basil bg-basil/10 text-basil"
                : "border-stone/20 bg-white text-stone hover:border-stone/40"
            }`}
          >
            <span>Cena</span>
            {selectedMeals.cena && <Check className="h-4 w-4" />}
          </button>
        </div>
      </Card>

      {/* Sezione 3: Esigenze Alimentari */}
      <Card className="p-4 space-y-3">
        <h2 className="font-display text-base font-bold text-ink">
          Esigenze e regimi alimentari
        </h2>
        <p className="text-xs text-stone">
          Filtri vincolanti applicati alla scelta e generazione delle ricette.
        </p>
        <div className="flex flex-wrap gap-2 pt-1">
          {DIET_FLAG_VALUES.map((diet) => {
            const active = dietaryNeeds.includes(diet);
            return (
              <button
                key={diet}
                type="button"
                onClick={() => toggleDiet(diet)}
                className={`inline-flex min-h-[44px] items-center gap-1.5 rounded-full px-4 py-2 text-xs font-semibold transition-all cursor-pointer ${
                  active
                    ? "bg-basil text-paper shadow-xs"
                    : "border border-stone/20 bg-white text-stone hover:border-stone/40 hover:text-ink"
                }`}
              >
                <span>{DIET_FLAG_LABELS[diet]}</span>
                {active && <Check className="h-3.5 w-3.5" />}
              </button>
            );
          })}
        </div>
      </Card>

      {/* Sezione 4: Elettrodomestici */}
      <Card className="p-4 space-y-3">
        <div className="flex items-center gap-2">
          <Flame className="h-5 w-5 text-tomato" />
          <h2 className="font-display text-base font-bold text-ink">
            Elettrodomestici disponibili
          </h2>
        </div>
        <div className="flex flex-wrap gap-2 pt-1">
          {APPLIANCE_VALUES.map((app) => {
            const active = appliances.includes(app);
            return (
              <button
                key={app}
                type="button"
                onClick={() => toggleAppliance(app)}
                className={`inline-flex min-h-[44px] items-center gap-1.5 rounded-full px-4 py-2 text-xs font-semibold transition-all cursor-pointer ${
                  active
                    ? "bg-basil text-paper shadow-xs"
                    : "border border-stone/20 bg-white text-stone hover:border-stone/40 hover:text-ink"
                }`}
              >
                <span>{APPLIANCE_LABELS[app]}</span>
                {active && <Check className="h-3.5 w-3.5" />}
              </button>
            );
          })}
        </div>
      </Card>

      {/* Sezione 5: I Miei Ingredienti (Liked & Disliked) */}
      <Card className="p-4 space-y-4">
        <div>
          <h2 className="font-display text-base font-bold text-ink">
            I miei ingredienti
          </h2>
          <p className="text-xs text-stone mt-0.5">
            Vista d&apos;insieme delle preferenze espresse dalle ricette. Rimuovi o aggiungi con un tap.
          </p>
        </div>

        {/* Ingredienti Preferiti */}
        <div className="space-y-2">
          <span className="text-xs font-bold uppercase tracking-wider text-basil">
            Ingredienti che adoro ({likedIngredients.length})
          </span>
          <div className="flex flex-wrap gap-1.5">
            {likedIngredients.map((item) => (
              <Badge
                key={item.id}
                variant="basil-subtle"
                className="gap-1.5 pl-2.5 pr-1.5 py-1 text-xs"
              >
                <span>{item.name}</span>
                <button
                  type="button"
                  onClick={() => handleRemoveLiked(item.id)}
                  aria-label={`Rimuovi ${item.name} dai preferiti`}
                  className="flex h-6 w-6 items-center justify-center rounded-full hover:bg-basil/20 text-basil cursor-pointer"
                >
                  <X className="h-3 w-3" />
                </button>
              </Badge>
            ))}
          </div>
          <form onSubmit={handleAddLiked} className="flex gap-2 pt-1">
            <input
              type="text"
              value={newLikedInput}
              onChange={(e) => setNewLikedInput(e.target.value)}
              placeholder="Aggiungi ingrediente amato..."
              className="flex-1 rounded-xl border border-stone/20 bg-white px-3 py-1.5 text-xs text-ink placeholder:text-stone/60 focus:border-basil focus:outline-none focus:ring-1 focus:ring-basil"
            />
            <Button type="submit" size="sm" variant="outline" className="min-h-[44px]">
              <Plus className="h-4 w-4" />
            </Button>
          </form>
        </div>

        <div className="border-t border-stone/15 pt-3 space-y-2">
          {/* Ingredienti Scartati / Esclusi */}
          <span className="text-xs font-bold uppercase tracking-wider text-tomato">
            Ingredienti scartati ({dislikedIngredients.length})
          </span>
          <div className="flex flex-wrap gap-1.5">
            {dislikedIngredients.map((item) => (
              <Badge
                key={item.id}
                variant="tomato-subtle"
                className="gap-1.5 pl-2.5 pr-1.5 py-1 text-xs"
              >
                <span>{item.name}</span>
                <button
                  type="button"
                  onClick={() => handleRemoveDisliked(item.id)}
                  aria-label={`Rimuovi ${item.name} dagli scartati`}
                  className="flex h-6 w-6 items-center justify-center rounded-full hover:bg-tomato/20 text-tomato cursor-pointer"
                >
                  <X className="h-3 w-3" />
                </button>
              </Badge>
            ))}
          </div>
          <form onSubmit={handleAddDisliked} className="flex gap-2 pt-1">
            <input
              type="text"
              value={newDislikedInput}
              onChange={(e) => setNewDislikedInput(e.target.value)}
              placeholder="Escludi ingrediente dai piani..."
              className="flex-1 rounded-xl border border-stone/20 bg-white px-3 py-1.5 text-xs text-ink placeholder:text-stone/60 focus:border-tomato focus:outline-none focus:ring-1 focus:ring-tomato"
            />
            <Button
              type="submit"
              size="sm"
              variant="outline"
              className="min-h-[44px] hover:border-tomato hover:text-tomato"
            >
              <Plus className="h-4 w-4" />
            </Button>
          </form>
        </div>
      </Card>
    </main>
  );
}
