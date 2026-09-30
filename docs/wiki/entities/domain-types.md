---
title: Modello di Dominio, Schemi Zod e Normalizzazione (domain/types)
type: entity
created: 2026-09-15
updated: 2026-09-29
tags: [domain, zod, types, schemas, enums, single-source-of-truth, generation, recipe-text, normalization, settings, meal-plans]
---

## File e Responsabilità

- **Percorsi file**:
  - `lib/domain/types.ts`: definizione degli schemi di validazione runtime (Zod), tipi statici TypeScript inferiti e liste enum chiuse.
  - `lib/domain/recipe-text.ts`: funzioni pure per la normalizzazione di titoli, slug, nomi canonici, diete transitive e sanitizzazione delle ricette generate.
  - Dalla Feature 4 `lib/domain/` contiene anche il planner puro (`planner.ts`, `planner-config.ts`, `rng.ts`, `week.ts`), documentato in [[planner]].
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

### Etichette UI in italiano

Le etichette mostrate nell'interfaccia sono mappe `Record<Enum, string>` accanto agli enum, così i componenti non ridefiniscono testi di dominio:

| Costante | Enum | Origine |
|---|---|---|
| `DIET_FLAG_LABELS` | `DietFlag` | Feature 1 |
| `APPLIANCE_LABELS` | `Appliance` | Feature 1 |
| `MEAL_TYPE_LABELS` | `MealType` (`Pranzo`, `Cena`) | Feature 3 |
| `MEAL_STYLE_TAG_LABELS` | `MealStyleTag` (`Veloce`, `Salutare`, `Proteico`, `Leggero`, `Comfort food`, `Economico`, `Piatto unico`) | Feature 3 |

### Limiti di `persons` (Feature 3)

`PERSONS_MIN = 1` e `PERSONS_MAX = 12` sono dichiarati **prima** di `HouseholdSchema` (una `const` letta prima della sua dichiarazione durante l'inizializzazione del modulo produrrebbe `ReferenceError`) e riusati da `RecipeConstraintsSchema`, `ConstraintOverridesSchema` e `HouseholdSettingsSchema`. `HouseholdSchema.persons` resta invece `min(1)` **senza massimo**: un valore fuori range già presente in DB continua a fallire in `buildConstraints` senza rompere anche `GET /api/settings`. `servings_base` delle ricette è un concetto distinto e mantiene i propri letterali.

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
- `onboarded_at`: `z.coerce.date().nullable().default(null)` (Feature 3) — istante di completamento del wizard; `null` finché l'onboarding non è completato. Un oggetto senza il campo viene parsato con `null`.
- `created_at`: `z.coerce.date()`
- `updated_at`: `z.coerce.date()` — ultimo cambio dei vincoli o dell'onboarding (contratto U1, v. [[household-repo]])

### 5. MealPlan (`MealPlanSchema`) & PlanSlot (`PlanSlotSchema`)
- **MealPlan**: rappresenta un piano settimanale (`id`, `household_id`, `week_start: YYYY-MM-DD`, `status: draft | active | archived`, `created_at`). Lo schema non è stato esteso dalla Feature 4: la colonna `generated_at` e le viste del piano esposte dalle API sono nei contratti `Meal Plans (Feature 4)` più sotto.
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
- **`RecipeConstraintsSchema`**: parametri consolidati passati all'adapter LLM (`persons` in `[PERSONS_MIN, PERSONS_MAX]`, `meal_type: MealType | null`, `diet_tags`, `meal_style_tags`, `appliances`, `ingredient_likes`, `ingredient_dislikes`).
- **`ConstraintOverridesSchema`**: modifiche temporanee strict e parziali consentite nella richiesta (`persons` in `[PERSONS_MIN, PERSONS_MAX]`, `diet_tags`, `meal_style_tags`, `appliances`).

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

## Contratti delle Impostazioni Household (Feature 3)

Sezione `// Household Settings (Feature 3)` in coda a `types.ts`, usata da [[settings-service]], [[settings-fields]], [[settings-editor]] e [[onboarding-wizard]]:

| Schema / Tipo | Forma | Uso |
|---|---|---|
| `HouseholdSettingsSchema` / `HouseholdSettings` | strict: `persons` intero in `[PERSONS_MIN, PERSONS_MAX]`, `meals: MealType[]` con **almeno 1** elemento, `meal_style_tags`, `diet_tags`, `appliances` (possono essere vuoti) | I 5 vincoli modificabili dall'utente |
| `UpdateSettingsRequestSchema` / `UpdateSettingsRequest` | `HouseholdSettingsSchema` + `complete_onboarding: boolean` (default `false`), strict | Body di `PUT /api/settings`. Il tipo usa `z.input` perché `complete_onboarding` è facoltativo in ingresso. |
| `SettingsViewSchema` / `SettingsView` | i 5 campi + `onboarded: boolean` + `updated_at: string` (ISO datetime) | Risposta di `GET /api/settings` e props iniziali di wizard e form. `updated_at` è il riferimento del contratto U1: dalla Feature 4 un piano è superato se `updated_at > meal_plans.generated_at` (il commento nel codice è stato aggiornato da `created_at`). |
| `SaveSettingsResultSchema` / `SaveSettingsResult` | `{ settings: SettingsView, changed: boolean }` | Risposta di `PUT /api/settings`, validata anche lato client da `putSettings` |

Le chiavi sconosciute sono rifiutate (`.strict()`), così come diete o elettrodomestici fuori enum.

## Contratti dei Piani Settimanali (Feature 4)

Sezione `// Meal Plans (Feature 4)` in coda a `types.ts`, usata da [[plan-service]] (servizio, rotte e client) e da [[plan-screen]]. Gli schemi `MealPlanSchema` e `PlanSlotSchema` restano invariati; questi sono i DTO delle API.

| Schema / Tipo | Forma | Uso |
|---|---|---|
| `IsoDateSchema` | stringa `YYYY-MM-DD` (solo formato) | Date di settimane e slot |
| `PlanWeekSchema` / `PlanWeek` | `{ week_start, first_day, last_day }` | Settimana obiettivo (`first_day` = primo giorno pianificabile) o settimana mostrata (`first_day = week_start`) |
| `PlanSlotViewSchema` / `PlanSlotView` | `{ id, day, meal, servings (≥ 1), locked, recipe: Recipe \| null }` | Slot con la ricetta **completa** (ingredienti + prefs); `null` se la ricetta è stata eliminata |
| `PlanShoppingListStateSchema` | `{ exists, needs_regeneration }` | Stato della lista della spesa del piano (Feature 6) |
| `PlanViewSchema` / `PlanView` | `{ id, week_start, status, created_at, generated_at, superseded, slots, shopping_list }` | Piano per le API; `superseded` = `households.updated_at > generated_at`; slot ordinati per giorno, poi pranzo → cena |
| `PLAN_ACTION_VALUES` / `PlanActionSchema` / `PlanAction` | `'generate' \| 'regenerate' \| 'none'` | Azione disponibile sulla settimana mostrata |
| `PlanWeekViewSchema` / `PlanWeekView` | `{ week, plan, action, editable, can_repeat }` | Settimana mostrata dal navigatore: solo la settimana obiettivo può avere un'azione; `editable` = piano presente e non chiuso; `can_repeat` = piano con ricette, settimana diversa dall'obiettivo, obiettivo non confermato |
| `PlanScreenViewSchema` / `PlanScreenView` | `{ today, current_week_start, target, view, prev_week_start, next_week_start, target_plan_status, current_plan_id }` | Risposta di `GET /api/plans/current` e dato iniziale della pagina Piano |
| `PlanGenerationSummarySchema` / `PlanGenerationSummary` | `{ rounds, created, failed }` | Esito dei giri di generazione LLM (`failed` = almeno una chiamata fallita) |
| `GeneratePlanRequestSchema` | `{}` strict | Body di `POST /api/plans` (la settimana la calcola il server) |
| `GeneratePlanResultSchema` / `GeneratePlanResult` | `{ screen: PlanScreenView, generation }` | Risposta di `POST /api/plans` e `POST /api/plans/:id/repeat` |
| `PlanResultSchema` / `PlanResult` | `{ plan: PlanView }` | Risposta di conferma e blocco |
| `SWAP_EXCLUDE_MAX = 50`, `SwapSlotRequestSchema` / `SwapSlotRequest` | `{ exclude_recipe_ids: uuid[] }` strict, default `[]`, max 50 | Body dello swap: ricette scartate nella sequenza *Cambia ancora* |
| `PlanMutationResultSchema` / `PlanMutationResult` | `{ plan, generation }` | Risposta dello swap |
| `UpdateSlotRequestSchema` / `UpdateSlotRequest` | `{ locked: boolean }` strict | Body di `PATCH /api/plans/:id/slots/:slotId` |

L'Addendum D2 della review architetturale ha sostituito il `PlanScreenView` del piano originale (`{ today, plan, target, action }`) con la struttura a navigatore; `target_plan_status` e `current_plan_id` sono stati aggiunti per il pulsante *Ripeti questa settimana* e per la Feature 6. Le interfacce di funzione del planner (`PlannerInput`, `MealTypeShortage`, …) e i tipi riga del repository non stanno qui ma nei rispettivi moduli ([[planner]], [[plan-repo]]), costruiti a partire da questi tipi.

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
  onboarded_at: null,
  created_at: new Date('2026-01-01T00:00:00Z'),
  updated_at: new Date('2026-01-01T00:00:00Z'),
};
```

Questi valori sono quelli con cui il wizard di primo avvio si presenta precompilato ([[onboarding-wizard]]).

## Vedi anche

- [[single-source-of-truth-types]] — Approfondimento concettuale sulla filosofia Zod
- [[llm-adapter]] — Utilizzo degli schemi generati nell'adapter AI SDK
- [[recipe-generation]] — Servizio di validazione e filtraggio ricette
- [[fixtures-and-seed]] — Corpus ricette e validazione fixtures
- [[recipe-repo]] — Persistenza nel database PostgreSQL
- [[settings-service]] — Uso dei contratti delle impostazioni in servizio, API e client
- [[e5-impostazioni]] — Panoramica della Feature 3
- [[planner]] — Funzioni pure del planner in `lib/domain/` (`planner`, `planner-config`, `rng`, `week`)
- [[plan-service]] — Uso dei contratti dei piani in servizio, API e client
- [[e3-pianificatore]] — Panoramica della Feature 4
