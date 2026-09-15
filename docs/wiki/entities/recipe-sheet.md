---
title: Pannello Dettaglio Ricetta (recipe-sheet)
type: entity
created: 2026-09-15
updated: 2026-09-15
tags: [ui, components, recipe-sheet, sheet, drawer, ingredients, preferences]
---

## File e Responsabilità

- **Percorso file**: `components/sheets/recipe-sheet.tsx`
- **Scopo**: Sheet/Drawer scorrevole dal basso (`side="bottom"`) che presenta la scheda tecnica completa di una ricetta selezionata. Permette la regolazione dinamica delle porzioni con ricalcolo degli ingredienti, la raccolta di preferenze atomiche sugli ingredienti (mi piace / non mi piace) e la valutazione globale della ricetta.

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

### 2. Feedback su Singolo Ingrediente e Conferma Esclusione
Accanto a ciascun ingrediente sono presenti due pulsanti rapidi:
- **Mi piace (`ThumbsUp`)**: evidenzia l'ingrediente in verde `basil` e comunica al motore preferenze di privilegiare ricette affini.
- **Non mi piace (`ThumbsDown`)**: prima di applicare l'esclusione, apre un banner di avviso contestuale (`pendingDislikeIngredient`) con spiegazione trasparente ("Escluderà le ricette contenenti questo ingrediente dai prossimi piani") e bottoni espliciti "Conferma esclusione" (`tomato`) o "Annulla".

### 3. Procedimento di Preparazione
I passaggi numerati sono visualizzati in una sequenza chiara, contrassegnata da un badge circolare in verde `bg-basil` con numerazione ad alto contrasto.

### 4. Barra Azioni Inferiore
In fondo allo sheet, una barra dedicata raggruppa:
- **Voto in Stelle (1–5)**: cinque stelle interattive con riempimento `saffron` per registrare la valutazione post-pasto.
- **Pulsante Preferita**: toggle per salvare la ricetta tra i piatti del cuore.
- **Pulsante "Non proporre più"**: azione in rosso `tomato` con icona `Ban` per escludere la ricetta dalla selezione automatica del planner.

## Vedi anche

- [[meal-card]] — Componente genitore che attiva l'apertura dello sheet
- [[design-system-and-tokens]] — Specifiche per font `Fraunces` e colori semantici
- [[domain-types]] — Struttura dati `Recipe` e `Ingredient`
- [[e0-fondamenta]] — Panoramica della Feature 1
