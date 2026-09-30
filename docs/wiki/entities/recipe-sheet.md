---
title: Pannello Dettaglio Ricetta (recipe-sheet)
type: entity
created: 2026-09-15
updated: 2026-09-29
tags: [ui, components, recipe-sheet, sheet, drawer, ingredients, preferences, recipe-detail]
---

## File e Responsabilità

- **Percorsi file**:
  - `components/sheets/recipe-sheet.tsx`: componente `RecipeSheet` e tipi `RecipeDetail`, `RecipeIngredient`, `RecipeSheetProps`.
  - `components/sheets/recipe-detail.ts` (Feature 4): funzioni pure `recipeChips` e `toRecipeDetail`, che convertono una `Recipe` di dominio nella vista della sheet.
- **Scopo**: Sheet/Drawer scorrevole dal basso (`side="bottom"`) che presenta la scheda tecnica completa di una ricetta selezionata. Permette la regolazione dinamica delle porzioni con ricalcolo degli ingredienti, la raccolta di preferenze atomiche sugli ingredienti (mi piace / non mi piace) e la valutazione globale della ricetta.
- **Uso reale dalla Feature 4**: la pagina Piano ([[plan-screen]]) apre la sheet sulla ricetta di uno slot, con le quantità scalate sulle porzioni dello slot e **senza** handler di preferenze: pulsanti di gradimento, voto, *Preferita* e *Non proporre più* restano nascosti fino alla Feature 5 (requirements U4).

## Interfacce Dati

```ts
export interface RecipeIngredient {
  id: string;
  name: string;
  amount: number;
  unit: string;
  preference?: "liked" | "disliked" | null;
}

export interface RecipeDetail {
  id: string;
  title: string;
  description?: string;
  prepTimeMinutes: number;
  servings: number;
  tags?: string[];
  ingredients: RecipeIngredient[];
  steps: string[];
  rating?: number; // 1-5
  isFavorite?: boolean;
  isBlocked?: boolean;
}

export interface RecipeSheetProps {
  recipe: RecipeDetail | null;
  isOpen: boolean;
  onClose: () => void;
  onToggleFavorite?: (id: string) => void;
  onToggleBlock?: (id: string) => void;
  onRate?: (id: string, rating: number) => void;
  onIngredientPreference?: (
    ingredientId: string,
    preference: "liked" | "disliked" | null
  ) => void;
}
```

## Funzionalità Chiave

### 1. Scala Dinamica delle Porzioni
Lo sheet memorizza lo stato locale `servings` (inizializzato sul `recipe.servings` di default):
- L'utente può incrementare o decrementare le porzioni tramite pulsanti dedicati (touch target ≥ 44px).
- Il fattore di scala `scale = servings / baseServings` ricalcola in tempo reale il dosaggio di ciascun ingrediente:
  ```ts
  const formatAmount = (baseAmount: number) => {
    const scaled = baseAmount * scale;
    if (scaled === 0) return "";
    return scaled % 1 === 0 ? scaled.toString() : scaled.toFixed(1);
  };
  ```

Lo stepper riparte da `recipe.servings` ogni volta che cambia l'oggetto `recipe` (effetto su `[recipe]`). Nella pagina Piano `recipe` è memoizzata sullo slot, ma un aggiornamento dello slot aperto (es. uno swap) la ricostruisce e azzera lo stepper: comportamento preesistente segnalato dalla code review di F4 e non corretto.

### 2. Feedback su Singolo Ingrediente e Conferma Esclusione
Solo se `onIngredientPreference` è definito, accanto a ciascun ingrediente sono presenti due pulsanti rapidi:
- **Mi piace (`ThumbsUp`)**: evidenzia l'ingrediente in verde `basil` e comunica al motore preferenze di privilegiare ricette affini.
- **Non mi piace (`ThumbsDown`)**: prima di applicare l'esclusione, apre un banner di avviso contestuale (`pendingDislikeIngredient`) con spiegazione trasparente ("Escluderà le ricette contenenti questo ingrediente dai prossimi piani") e bottoni espliciti "Conferma esclusione" (`tomato`) o "Annulla".

### 3. Procedimento di Preparazione
I passaggi numerati sono visualizzati in una sequenza chiara, contrassegnata da un badge circolare in verde `bg-basil` con numerazione ad alto contrasto.

### 4. Barra Azioni Inferiore
Dalla Feature 4 la barra si renderizza **solo** se almeno uno tra `onRate`, `onToggleFavorite` e `onToggleBlock` è definito (prima compariva sempre, con pulsanti che senza handler non facevano nulla). Quando c'è, in fondo allo sheet raggruppa:
- **Voto in Stelle (1–5)**: cinque stelle interattive con riempimento `saffron` per registrare la valutazione post-pasto.
- **Pulsante Preferita**: toggle per salvare la ricetta tra i piatti del cuore.
- **Pulsante "Non proporre più"**: azione in rosso `tomato` con icona `Ban` per escludere la ricetta dalla selezione automatica del planner.

## Conversione dal Dominio (`recipe-detail.ts`, Feature 4)

```ts
export function recipeChips(recipe: Recipe): string[];
export function toRecipeDetail(recipe: Recipe, servings: number): RecipeDetail;
```

- **`recipeChips`**: fino a 2 etichette `MEAL_STYLE_TAG_LABELS` dei `tags` nell'ordine della ricetta, poi al massimo 1 etichetta `DIET_FLAG_LABELS` della prima dieta presente secondo la priorità `vegano`, `vegetariano`, `pescetariano`, `senza-glutine`, `senza-lattosio` (es. `['Veloce', 'Proteico', 'Vegetariano']`). Usata anche dalle card del piano.
- **`toRecipeDetail(recipe, servings)`**: `prepTimeMinutes = prep_minutes`, `servings` dello slot, `tags = recipeChips(recipe)`, ingredienti con `name = display_name`, `id` di fallback `${recipe.id}:${index}` e `amount = qty × servings / servings_base` arrotondato a un decimale (`qty` nullo → `0`, e la sheet mostra solo l'unità, es. `qb`); `rating`, `isFavorite`, `isBlocked` da `recipe.prefs` (con `false` come default).

Il piano originale le metteva in `lib/plans/format.ts`; la proposta R6 della review architetturale le ha spostate qui, accanto al tipo `RecipeDetail` che producono, così la Libreria (Feature 5) le riusa senza dipendere dal modulo dei piani e `lib/` non importa da `components/`. Test: `tests/ui/recipe-detail.test.ts`.

## Vedi anche

- [[meal-card]] — Componente genitore che attiva l'apertura dello sheet
- [[plan-screen]] — Pagina Piano che apre la sheet sulla ricetta di uno slot
- [[design-system-and-tokens]] — Specifiche per font `Fraunces` e colori semantici
- [[domain-types]] — Struttura dati `Recipe` e `Ingredient`
- [[e0-fondamenta]] — Panoramica della Feature 1
- [[e3-pianificatore]] — Panoramica della Feature 4
