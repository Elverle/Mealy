---
title: Repository Ricette (recipe-repo)
type: entity
created: 2026-09-15
updated: 2026-09-15
tags: [database, repository, recipes, ingredients, preferences, drizzle, transactions]
---

## File e Responsabilità

- **Percorso file**: `lib/db/repositories/recipe-repo.ts`
- **Scopo**: Incapsulare la logica di persistenza per le ricette della libreria permanente, gestendo in modo atomico le entità figlie (`recipe_ingredients` e `recipe_prefs`).

## Tipi e Firme Ausiliarie

Il modulo definisce interfacce per l'inserimento disaccoppiate dalle entità complete:
- `InsertRecipeInput`: dati anagrafici della ricetta (`title`, `slug`, `steps`, `meal_types`, ecc.).
- `InsertIngredientInput`: lista ingredienti associati (`canonical_name`, `display_name`, `qty`, `unit`, `category`, `note`).
- `InsertRecipePrefInput`: preferenze opzionali (`rating`, `favorite`, `blocked`).
- `RecipeWithDetails`: tipo composito che unisce la `Recipe` con l'array tipato di `Ingredient[]` e l'oggetto `RecipePref | null`.

## Metodi Esportati

### `insertRecipe(recipeData, ingredientsData, prefData): Promise<RecipeWithDetails>`
Inserisce in modo **transazionale** (`db.transaction`) una nuova ricetta:
1. Assegna o genera un UUID random per la ricetta.
2. Esegue la `INSERT` in `recipes`.
3. Se presenti, esegue la `INSERT` batch in `recipe_ingredients` associando il `recipe_id`.
4. Esegue la `INSERT` in `recipe_prefs` per inizializzare il record di preferenza.
5. In caso di errore su una qualsiasi tabella figlia, la transazione fallisce eseguendo il rollback automatico.
6. Valida il risultato aggregato tramite `RecipeSchema.parse()`.

### `getRecipeById(id: string): Promise<RecipeWithDetails | null>`
Recupera una singola ricetta dato il suo UUID, eseguendo la join automatica con `ingredients` e `prefs` tramite l'API relazionale di Drizzle (`db.query.recipes.findFirst({ with: { ingredients: true, prefs: true } })`).

### `getRecipeBySlug(slug: string): Promise<RecipeWithDetails | null>`
Equivalente a `getRecipeById`, ma indicizzato sul campo univoco `slug`. Utilizzato per la risoluzione delle rotte SEO-friendly o di deep linking.

### `deleteRecipe(id: string): Promise<boolean>`
Rimuove la ricetta indicata dalla tabella `recipes`. Grazie al vincolo `ON DELETE CASCADE` configurato nello schema, PostgreSQL elimina contestualmente tutti gli ingredienti e la riga delle preferenze collegata.

### `listRecipes(filter?: { household_id?: string }): Promise<RecipeWithDetails[]>`
Estrae tutte le ricette memorizzate, con possibilità di filtraggio opzionale per nucleo familiare (`household_id`). I risultati sono ordinati in modo decrescente per data di creazione (`created_at DESC`) ed espansi con ingredienti e preferenze.

## Esempio d'Uso

```ts
import { insertRecipe, getRecipeBySlug } from '@/lib/db/repositories/recipe-repo';
import { DEFAULT_HOUSEHOLD_ID } from '@/lib/domain/types';

// Inserimento transazionale
const newRecipe = await insertRecipe(
  {
    household_id: DEFAULT_HOUSEHOLD_ID,
    title: 'Pasta al Pomodoro Fresco',
    slug: 'pasta-al-pomodoro-fresco',
    steps: ['Bollire l acqua', 'Cuocere la pasta', 'Saltare con il sugo'],
    meal_types: ['pranzo'],
    tags: ['veloce', 'comfort-food'],
    servings_base: 2,
    prep_minutes: 15,
  },
  [
    { canonical_name: 'pasta', display_name: 'Spaghetti', qty: 160, unit: 'g', category: 'dispensa' },
    { canonical_name: 'pomodoro', display_name: 'Pomodorini freschi', qty: 250, unit: 'g', category: 'ortofrutta' },
  ],
  { favorite: true }
);

// Recupero per visualizzazione nello sheet
const recipe = await getRecipeBySlug('pasta-al-pomodoro-fresco');
```

## Vedi anche

- [[database-schema]] — Struttura tabelle `recipes`, `recipe_ingredients`, `recipe_prefs`
- [[database-architecture]] — Transazionalità e cascade delete
- [[domain-types]] — Tipi `Recipe`, `Ingredient`, `RecipePref`
