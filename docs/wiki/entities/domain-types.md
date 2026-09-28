---
title: Modello di Dominio, Schemi Zod e Normalizzazione (domain/types)
type: entity
created: 2026-09-15
updated: 2026-09-17
tags: [domain, zod, types, schemas, enums, single-source-of-truth, generation, recipe-text, normalization]
---

## File e Responsabilità

- **Percorsi file**:
  - `lib/domain/types.ts`: definizione degli schemi di validazione runtime (Zod), tipi statici TypeScript inferiti e liste enum chiuse.
  - `lib/domain/recipe-text.ts`: funzioni pure per la normalizzazione di titoli, slug, nomi canonici, diete transitive e sanitizzazione delle ricette generate.
- **Scopo**: Costituire la **single source of truth** del modello dati dell'intera applicazione (`CLAUDE.md § Regole di architettura`). Nessun tipo di dominio viene ridefinito localmente nei moduli applicativi.

## Costanti Enum Chiuse

Ogni dominio controllato dispone di una costante `as const`, di uno schema Zod `z.enum(...)` e del relativo tipo TypeScript inferito:

| Costante Array | Valori Consentiti | Schema Zod | Tipo TypeScript |
|---|---|---|---|
| `UNIT_VALUES` | `['g', 'ml', 'pz', 'qb']` | `UnitSchema` | `Unit` |
| `CATEGORY_VALUES` | `['ortofrutta', 'pane', 'macelleria', 'pescheria', 'banco-frigo', 'dispensa', 'surgelati', 'bevande', 'altro']` | `CategorySchema` | `Category` |
| `MEAL_TYPE_VALUES` | `['pranzo', 'cena']` | `MealTypeSchema` | `MealType` |
| `DIET_FLAG_VALUES` | `['vegetariano', 'vegano', 'senza-glutine', 'senza-lattosio', 'pescetariano']` | `DietFlagSchema` | `DietFlag` |
| `MEAL_STYLE_TAG_VALUES` | `['veloce', 'salutare', 'proteico', 'leggero', 'comfort-food', 'economico', 'piatto-unico']` | `MealStyleTagSchema` | `MealStyleTag` |
| `APPLIANCE_VALUES` | `['fornelli', 'forno', 'microonde', 'friggitrice-ad-aria', 'frullatore']` | `ApplianceSchema` | `Appliance` |
| `PLAN_STATUS_VALUES` | `['draft', 'active', 'archived']` | `PlanStatusSchema` | `PlanStatus` |
| `RECIPE_SOURCE_VALUES` | `['llm', 'manual']` | `RecipeSourceSchema` | `RecipeSource` |
| `INGREDIENT_PREF_VALUES` | `['like', 'dislike']` | `IngredientPrefSchema` | `IngredientPref` |

## Schemi delle Entità Principali

### 1. Ingredient (`IngredientSchema`)
Rappresenta un singolo ingrediente di una ricetta normalizzato alla fonte.
- `id`: `z.string().uuid().optional()`
- `recipe_id`: `z.string().uuid().optional()`
- `canonical_name`: `z.string().min(1)` (minuscolo, singolare, es. "zucchina")
- `display_name`: `z.string().min(1)` (denominazione visuale, es. "Zucchine tonde")
- `qty`: `z.coerce.number().nullable().optional()`
- `unit`: `UnitSchema` (`g | ml | pz | qb`)
- `category`: `CategorySchema` (reparto spesa)
- `note`: `z.string().nullable().optional()`

### 2. Recipe (`RecipeSchema`)
Modella una ricetta memorizzata nella libreria permanente.
- `id`: `z.string().uuid()`
- `household_id`: `z.string().uuid()`
- `title`: `z.string().min(1)`
- `slug`: `z.string().min(1)` (identificatore URL-friendly univoco)
- `description`: `z.string().default('')`
- `steps`: `z.array(z.string()).min(1)` (passaggi ordinati)
- `meal_types`: `z.array(MealTypeSchema).min(1)` (`pranzo`, `cena`)
- `tags`: `z.array(MealStyleTagSchema).default([])`
- `diet_flags`: `z.array(DietFlagSchema).default([])`
- `appliances_required`: `z.array(ApplianceSchema).default([])`
- `servings_base`: `z.number().int().min(1)`
- `prep_minutes`: `z.number().int().min(1)`
- `kcal_est`: `z.number().int().nullable().optional()`
- `macros_est`: `MacrosEstSchema` o record flessibile
- `source`: `RecipeSourceSchema` (`llm` o `manual`)
- `created_at`: `z.coerce.date()`
- `ingredients`: `z.array(IngredientSchema).optional()`
- `prefs`: `RecipePrefSchema.nullable().optional()`

### 3. RecipePref (`RecipePrefSchema`)
Preferenze e statistiche di utilizzo per ciascuna ricetta (relazione 1:1 con `Recipe`).
- `recipe_id`: `z.string().uuid()`
- `rating`: `z.number().int().min(1).max(5).nullable().optional()`
- `favorite`: `z.boolean().default(false)`
- `blocked`: `z.boolean().default(false)`
- `times_used`: `z.number().int().default(0)`
- `last_used_at`: `z.coerce.date().nullable().optional()`

### 4. Household (`HouseholdSchema`)
Configurazione del nucleo domestico.
- `id`: `z.string().uuid()`
- `persons`: `z.number().int().min(1)`
- `meals`: `z.array(MealTypeSchema)`
- `diet_tags`: `z.array(DietFlagSchema)`
- `meal_style_tags`: `z.array(MealStyleTagSchema)`
- `appliances`: `z.array(ApplianceSchema)`
- `created_at`: `z.coerce.date()`
- `updated_at`: `z.coerce.date()`

### 5. MealPlan (`MealPlanSchema`) & PlanSlot (`PlanSlotSchema`)
- **MealPlan**: rappresenta un piano settimanale (`id`, `household_id`, `week_start: YYYY-MM-DD`, `status: draft | active | archived`, `created_at`).
- **PlanSlot**: rappresenta uno specifico slot pasto del piano (`id`, `plan_id`, `day: YYYY-MM-DD`, `meal: pranzo | cena`, `recipe_id: uuid | null`, `servings: number`, `locked: boolean`).

### 6. ShoppingList (`ShoppingListSchema`) & ShoppingItem (`ShoppingItemSchema`)
- **ShoppingList**: lista della spesa collegata 1:1 a un piano (`id`, `plan_id`, `generated_at`).
- **ShoppingItem**: articolo spesa consolidato (`id`, `list_id`, `canonical_name`, `qty`, `unit`, `category`, `checked`, `manual`, `recipe_ids: uuid[]`).

### 7. IngredientAlias (`IngredientAliasSchema`)
Dizionario per il mapping sinonimi (`alias` -> `canonical_name`).

## Contratti di Generazione Ricette (Feature 2)

Questi schemi governano la comunicazione con l'LLM, la validazione delle richieste HTTP e il controllo dei vincoli:

### 1. Contratti di Output LLM
I provider LLM con supporto a structured output (come Gemini o OpenAI) richiedono schemi espliciti privi di `.optional()` o `.default()`:
- **`GeneratedIngredientSchema`**:
  - `canonical_name`: `z.string().min(1)`
  - `display_name`: `z.string().min(1)`
  - `qty`: `z.number().positive().nullable()`
  - `unit`: `UnitSchema`
  - `category`: `CategorySchema`
  - `note`: `z.string().nullable()`
- **`GeneratedRecipeSchema`**:
  - `title`: `z.string().min(3).max(120)`
  - `description`: `z.string()`
  - `meal_types`: `z.array(MealTypeSchema).min(1)`
  - `tags`: `z.array(MealStyleTagSchema)`
  - `diet_flags`: `z.array(DietFlagSchema)`
  - `appliances_required`: `z.array(ApplianceSchema)`
  - `servings_base`: `z.number().int().min(1).max(12)`
  - `prep_minutes`: `z.number().int().min(1).max(600)`
  - `kcal_est`: `z.number().int().positive().nullable()`
  - `steps`: `z.array(z.string().min(1)).min(1)`
  - `ingredients`: `z.array(GeneratedIngredientSchema).min(1)`
- **`GenerateRecipesOutputSchema`**: radice dell'output strutturato contenente l'array `recipes: z.array(GeneratedRecipeSchema).min(1)`.

### 2. Vincoli e Sovrascritture
- **`RecipeConstraintsSchema`**: parametri consolidati passati all'adapter LLM (`persons`, `meal_type: MealType | null`, `diet_tags`, `meal_style_tags`, `appliances`, `ingredient_likes`, `ingredient_dislikes`).
- **`ConstraintOverridesSchema`**: modifiche temporanee strict e parziali consentite nella richiesta (`persons`, `diet_tags`, `meal_style_tags`, `appliances`).

### 3. Contratti API HTTP e Scarti
- **Costanti Generazione**:
  - `GENERATE_COUNT_MIN = 1`
  - `GENERATE_COUNT_MAX = 10`
  - `GENERATE_COUNT_DEFAULT = 5`
- **`GenerateRecipesRequestSchema`**: schema del body per `POST /api/recipes/generate`:
  - `count`: intero tra 1 e 10 (default 5).
  - `meal_type`: `MealType | null` (default `null`).
  - `overrides`: `ConstraintOverridesSchema` (default `{}`).
- **`GenerationSkipSchema`**: descrive le ricette candidate generate ma scartate:
  - `title`: stringa del titolo.
  - `reason`: `'duplicate' | 'constraint_violation'`.
  - `detail`: spiegazione specifica dello scarto.

### 4. Contratti Fixtures
- **`FixtureRecipeSchema`**: estende `GeneratedRecipeSchema` con `id: z.string().uuid()` e `slug: z.string().min(1)`.
- **`FixtureFileSchema`**: valida `fixtures/recipes.json` (richiede tra 15 e 20 ricette).
- **`IngredientAliasesFileSchema`**: valida `fixtures/ingredient-aliases.json` (richiede minimo 15 alias).

## Funzioni Pure di Normalizzazione Testo (`recipe-text.ts`)

Il modulo `lib/domain/recipe-text.ts` fornisce funzioni pure senza effetti collaterali:

### `normalizeTitle(title: string): string`
Normalizza un titolo culinario per confronti e deduplicazione:
- Decompone i caratteri Unicode via NFD ed elimina i segni diacritici/accenti (`\p{M}`).
- Converte in minuscolo.
- Rimpiazza ogni sequenza di caratteri non alfanumerici con un singolo spazio.
- Esegue il trim dei bordi.

### `slugify(title: string): string`
Genera uno slug leggibile per URL:
- Applica `normalizeTitle`.
- Converte gli spazi in trattini `-`.
- Tronca la lunghezza a un massimo di 80 caratteri e rimuove eventuali trattini finali.
- Ritorna `'ricetta'` come fallback in caso di stringa vuota.

### `normalizeCanonicalName(name: string): string`
Normalizza il nome canonico di un ingrediente:
- Rimuove spazi iniziali/finali e collassa spazi multipli interni.
- Converte in caratteri minuscoli.
- **Preserva i caratteri accentati** (es. "Caffè" → "caffè"), necessari per la correttezza grammaticale italiana.

### `expandDietFlags(flags: readonly DietFlag[]): DietFlag[]`
Calcola la chiusura transitiva delle implicazioni logiche dei regimi dietetici:
- `vegano` $\implies$ `vegetariano` + `senza-lattosio`.
- `vegetariano` $\implies$ `pescetariano`.
Restituisce l'array deduplicato ordinato rigorosamente secondo la sequenza in `DIET_FLAG_VALUES`.

### `normalizeGeneratedRecipe(recipe: GeneratedRecipe): GeneratedRecipe`
Sanitizza una ricetta prodotta dall'LLM ritornando un nuovo oggetto (immutabilità):
- Pulisce e collassa gli spazi bianchi in titolo e descrizione.
- Rimuove passi vuoti e ne effettua il trim.
- Deduplica array di `meal_types`, `tags` e `appliances_required`.
- Espande i flag dietetici con `expandDietFlags`.
- Normalizza ciascun ingrediente: applica `normalizeCanonicalName`, effettua il trim di display name e note (convertendo stringhe vuote in `null`), e garantisce la coerenza tra `qty` e `unit`:
  - Se `unit === 'qb'`, forza `qty = null`.
  - Se `qty === null` e `unit !== 'qb'`, imposta `unit = 'qb'`.

## Singleton Default Household

Per la modalità v1 a utente singolo, è esportata la costante:

```ts
export const DEFAULT_HOUSEHOLD_ID = '00000000-0000-0000-0000-000000000001';

export const DEFAULT_HOUSEHOLD: Household = {
  id: DEFAULT_HOUSEHOLD_ID,
  persons: 2,
  meals: ['pranzo', 'cena'],
  diet_tags: [],
  meal_style_tags: ['veloce', 'salutare'],
  appliances: ['fornelli', 'forno', 'microonde', 'friggitrice-ad-aria'],
  created_at: new Date('2026-01-01T00:00:00Z'),
  updated_at: new Date('2026-01-01T00:00:00Z'),
};
```

## Vedi anche

- [[single-source-of-truth-types]] — Approfondimento concettuale sulla filosofia Zod
- [[llm-adapter]] — Utilizzo degli schemi generati nell'adapter AI SDK
- [[recipe-generation]] — Servizio di validazione e filtraggio ricette
- [[fixtures-and-seed]] — Corpus ricette e validazione fixtures
- [[recipe-repo]] — Persistenza nel database PostgreSQL
