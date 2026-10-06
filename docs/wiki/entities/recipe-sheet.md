---
title: Pannello Dettaglio Ricetta (recipe-sheet)
type: entity
created: 2026-09-15
updated: 2026-10-05
tags: [ui, components, recipe-sheet, sheet, drawer, ingredients, preferences, recipe-detail, alertdialog, accessibility]
---

## File e Responsabilità

- **Percorsi file**:
  - `components/sheets/recipe-sheet.tsx`: componente `RecipeSheet` e tipi `RecipeDetail`, `RecipeIngredient`, `RecipeSheetProps`.
  - `components/sheets/recipe-detail.ts` (Feature 4): funzioni pure `recipeChips` e `toRecipeDetail`, che convertono una `Recipe` di dominio nella vista della sheet; dalla Feature 5 anche `ingredientRowId` e `findRecipeIngredient`.
- **Scopo**: Sheet/Drawer scorrevole dal basso (`side="bottom"`) che presenta la scheda tecnica completa di una ricetta selezionata. Permette la regolazione dinamica delle porzioni con ricalcolo degli ingredienti, la raccolta di preferenze atomiche sugli ingredienti (mi piace / non mi piace) e la valutazione globale della ricetta.
- **Uso reale dalla Feature 4**: la pagina Piano ([[plan-screen]]) apriva la sheet sulla ricetta di uno slot, con le quantità scalate sulle porzioni dello slot e **senza** handler di preferenze (requirements U4 della Feature 4).
- **Dalla Feature 5** la sheet è un componente **presentazionale** che nessuna pagina monta direttamente: la usa solo [[recipe-detail-sheet]], che carica i dati, passa tutti gli handler (voto, *Preferita*, *Non proporre più*, 👍/👎) e salva le preferenze, sia dal Piano sia dalla Libreria ([[library-screen]]). Le modifiche della Feature 5 sono sole aggiunte compatibili: nessun campo o parametro esistente ha cambiato nome, tipo o obbligatorietà, e il vocabolario della sheet (`"liked" | "disliked"`, `isFavorite`) resta diverso da quello del dominio (`'like' | 'dislike'`, `favorite`); la traduzione avviene in `recipe-detail.ts` in un verso e in `RecipeDetailSheet` nell'altro.

## Interfacce Dati

```ts
export interface RecipeIngredient {
  id: string;
  name: string;
  amount: number;
  unit: string;
  preference?: "liked" | "disliked" | null;
  canonicalName?: string;   // Feature 5: nome canonico normalizzato; se presente titola la conferma di scarto
  recipesCount?: number;    // Feature 5: ricette non bloccate che lo contengono; se presente la conferma lo mostra
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
  isLoading?: boolean;            // Feature 5: recipe null in caricamento → scheletro invece di niente
  actionsDisabled?: boolean;      // Feature 5: disabilita voto, Preferita e blocco
  ingredientsDisabled?: boolean;  // Feature 5: disabilita 👍/👎 e la conferma di esclusione
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

Fino alla Feature 4 lo stepper ripartiva da `recipe.servings` ogni volta che cambiava l'oggetto `recipe` (effetto su `[recipe]`), comportamento segnalato dalla code review di F4. Dalla Feature 5 porzioni e conferma di scarto in sospeso si riallineano **solo** quando cambia l'`id` della ricetta o le sue porzioni di base: un nuovo oggetto per la stessa ricetta (per esempio dopo un salvataggio delle preferenze) non azzera le porzioni scelte dall'utente né chiude una conferma aperta. Il riallineamento avviene durante il render, confrontando uno stato `syncedRecipe` (stesso schema di `syncedInitialScreen` in [[plan-screen]]) e non in un effetto: la versione con l'effetto conteneva una race che faceva fallire a intermittenza due test di `recipe-detail-sheet` sotto carico (fix della code review di F5, commit `aa38826`).

### 2. Feedback su Singolo Ingrediente e Conferma Esclusione
Solo se `onIngredientPreference` è definito, accanto a ciascun ingrediente sono presenti due pulsanti rapidi:
- **Mi piace (`ThumbsUp`)**: evidenzia l'ingrediente in verde `basil` e comunica al motore preferenze di privilegiare ricette affini.
- **Non mi piace (`ThumbsDown`)**: prima di applicare l'esclusione, apre un banner di avviso contestuale (`pendingDislikeIngredient`) con spiegazione trasparente ("Escluderà le ricette contenenti questo ingrediente dai prossimi piani") e bottoni espliciti "Conferma esclusione" (`tomato`) o "Annulla". Toccare 👎 su un ingrediente già scartato, o 👍 su uno già gradito, toglie il giudizio senza conferma.

Dalla Feature 5 la conferma di scarto dice esattamente che cosa verrà escluso:
- **Titolo**: `Scartare {canonicalName ?? name}?`. Con il nome canonico (sempre presente quando la sheet è alimentata da [[recipe-detail-sheet]]) un ingrediente mostrato come "Cipolla rossa di Tropea" dà `Scartare cipolla rossa?`, cioè il nome su cui valgono davvero il giudizio e il conteggio (decisione D1, v. [[e2-libreria-preferenze]]).
- **Seconda riga**, in base a `recipesCount`: assente → il testo generico qui sopra; `0` → `Nessuna ricetta in libreria lo contiene: non lo userò in quelle nuove.`; `1` → `Escluderà 1 ricetta dai prossimi piani.`; `n` → `Escluderà n ricette dai prossimi piani.`.
- **Accessibilità** (fix della code review): il riquadro è un `role="alertdialog"` nominato dal titolo e descritto dalla riga d'impatto; alla comparsa viene portato in vista (`scrollIntoView`, senza animazione con `prefers-reduced-motion`) e il focus va su **Annulla**, l'azione meno distruttiva; *Annulla* riporta il focus sul 👎 che l'ha aperta.
- 👍, 👎 e *Conferma esclusione* sono disabilitati con `ingredientsDisabled`.

### 3. Procedimento di Preparazione
I passaggi numerati sono visualizzati in una sequenza chiara, contrassegnata da un badge circolare in verde `bg-basil` con numerazione ad alto contrasto.

### 4. Barra Azioni Inferiore
Dalla Feature 4 la barra si renderizza **solo** se almeno uno tra `onRate`, `onToggleFavorite` e `onToggleBlock` è definito (prima compariva sempre, con pulsanti che senza handler non facevano nulla). Quando c'è, in fondo allo sheet raggruppa:
- **Voto in Stelle (1–5)**: cinque stelle interattive con riempimento `saffron` per registrare la valutazione post-pasto. Dalla Feature 5 la stella del voto corrente ha `aria-pressed`; che toccarla di nuovo tolga il voto lo decide chi riceve `onRate`, non la sheet.
- **Pulsante Preferita**: toggle per salvare la ricetta tra i piatti del cuore, con `aria-pressed`; è disabilitato se la ricetta è bloccata (una bloccata non può essere preferita).
- **Pulsante "Non proporre più"**: azione in rosso `tomato` con icona `Ban` per escludere la ricetta dalla selezione automatica del planner; su una ricetta bloccata diventa `Sblocca ricetta`, e nell'intestazione compare il badge `Bloccata`.
- Con `actionsDisabled` (salvataggio in corso) stelle, *Preferita* e blocco sono disabilitati.

### 5. Stato di Caricamento (Feature 5)
Con `recipe: null` e `isLoading` la sheet si apre comunque, con il titolo `Apro la ricetta…` e un blocco `role="status"` (`aria-label="Caricamento della ricetta"`) di tre righe `animate-pulse motion-reduce:animate-none`: mai uno spinner nudo (`DESIGN.md §5`). Con `recipe: null` senza `isLoading` non rende nulla, come prima.

## Conversione dal Dominio (`recipe-detail.ts`, Feature 4)

```ts
export function recipeChips(recipe: Pick<Recipe, 'tags' | 'diet_flags'>): string[];
export function ingredientRowId(recipe: Pick<Recipe, 'id'>, ingredient: Pick<Ingredient, 'id'>, index: number): string;   // Feature 5
export function findRecipeIngredient(recipe: Recipe, rowId: string): Ingredient | null;                                   // Feature 5
export function toRecipeDetail(
  recipe: Recipe,
  servings: number,
  ingredientInfo?: ReadonlyMap<string, RecipeIngredientInfo>   // Feature 5
): RecipeDetail;
```

- **`recipeChips`**: fino a 2 etichette `MEAL_STYLE_TAG_LABELS` dei `tags` nell'ordine della ricetta, poi al massimo 1 etichetta `DIET_FLAG_LABELS` della prima dieta presente secondo la priorità `vegano`, `vegetariano`, `pescetariano`, `senza-glutine`, `senza-lattosio` (es. `['Veloce', 'Proteico', 'Vegetariano']`). Usata anche dalle card del piano e, dalla Feature 5, dalle card della Libreria: per questo il parametro accetta qualsiasi oggetto con `tags` e `diet_flags`, quindi anche una `LibraryRecipeCard`.
- **`toRecipeDetail(recipe, servings)`**: `prepTimeMinutes = prep_minutes`, `servings` dello slot, `tags = recipeChips(recipe)`, ingredienti con `name = display_name`, `id` di fallback `${recipe.id}:${index}` e `amount = qty × servings / servings_base` arrotondato a un decimale (`qty` nullo → `0`, e la sheet mostra solo l'unità, es. `qb`); `rating`, `isFavorite`, `isBlocked` da `recipe.prefs` (con `false` come default).
- **`ingredientRowId`** (Feature 5): l'id di riga usato dalla sheet, cioè l'id dell'ingrediente o il fallback `${recipe.id}:${index}`. **`findRecipeIngredient`** fa il percorso inverso, dall'id di riga all'ingrediente di dominio (`null` se non c'è): serve a [[recipe-detail-sheet]] per risalire al nome canonico da giudicare.
- **Terzo parametro `ingredientInfo`** (Feature 5): mappa nome canonico → `RecipeIngredientInfo`. **Solo se è passata**, ogni ingrediente riceve anche `canonicalName` (`normalizeCanonicalName(ing.canonical_name)`), `preference` (`like` → `'liked'`, `dislike` → `'disliked'`, altrimenti `null`) e `recipesCount`; la ricerca nella mappa usa il nome normalizzato. Senza la mappa l'oggetto prodotto è identico a quello della Feature 4, senza chiavi in più.

Il piano originale le metteva in `lib/plans/format.ts`; la proposta R6 della review architetturale le ha spostate qui, accanto al tipo `RecipeDetail` che producono, così la Libreria (Feature 5) le riusa senza dipendere dal modulo dei piani e `lib/` non importa da `components/`.

## Test

- Blocco "RecipeSheet" di `tests/ui/shell.test.tsx` (Feature 1), invariato.
- `tests/ui/recipe-sheet.test.tsx` (Feature 5): scheletro di caricamento, i quattro testi della conferma, titolo con e senza nome canonico, `alertdialog` con focus su *Annulla* e ritorno al 👎, porzioni conservate quando cambia solo l'oggetto e azzerate quando cambia l'id, stati disabilitati, `aria-pressed` su voto e *Preferita*.
- `tests/ui/recipe-detail.test.ts`: chip, quantità scalate, e dalla Feature 5 `ingredientRowId`, `findRecipeIngredient` e `toRecipeDetail` con e senza la mappa.

Limite noto, preesistente: il primitivo `components/ui/sheet.tsx` chiude con `Esc` e blocca lo scorrimento del `body`, ma non gestisce il focus (nessun focus iniziale, nessuna trappola, nessun ritorno al controllo che ha aperto la sheet). Su una ricetta lunga la posizione di scorrimento della conferma di scarto non è stata verificata su un dispositivo reale.

## Vedi anche

- [[meal-card]] — Componente genitore che attiva l'apertura dello sheet
- [[recipe-detail-sheet]] — Componente che carica i dati e passa gli handler (Feature 5)
- [[plan-screen]] — Pagina Piano che apre il dettaglio sulla ricetta di uno slot
- [[library-screen]] — Libreria, che apre il dettaglio da una card
- [[design-system-and-tokens]] — Specifiche per font `Fraunces` e colori semantici
- [[domain-types]] — Struttura dati `Recipe` e `Ingredient`
- [[e0-fondamenta]] — Panoramica della Feature 1
- [[e3-pianificatore]] — Panoramica della Feature 4
- [[e2-libreria-preferenze]] — Panoramica della Feature 5
