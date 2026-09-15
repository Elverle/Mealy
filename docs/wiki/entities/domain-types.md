---
title: Modello di Dominio e Schemi Zod (domain/types)
type: entity
created: 2026-09-15
updated: 2026-09-15
tags: [domain, zod, types, schemas, enums, single-source-of-truth]
---

## File e Responsabilità

- **Percorso file**: `lib/domain/types.ts`
- **Scopo**: Definire la totalità degli schemi di validazione runtime (Zod) e i tipi statici TypeScript dell'applicazione. È la **single source of truth** del modello dati; nessun tipo viene ridefinito localmente nei moduli.

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
- `macros_est`: `MacrosEstSchema` (`carbs`, `protein`, `fat`) o record flessibile
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
- [[database-schema]] — Traduzione dei tipi nelle tabelle PostgreSQL con Drizzle
- [[household-repo]] — Repository per il salvataggio del nucleo familiare
- [[recipe-repo]] — Repository per la gestione ricette tipate
