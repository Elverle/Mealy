# Feature 4 — E3 Pianificatore · Piano di implementazione

**Data:** 2026-09-28 · **Stato:** planned · **Input di:** `/arch-review 4` → `/feature-dev 4`
**Story:** S3.1 Algoritmo di selezione pesata · S3.2 Piano end-to-end · S3.3 Swap slot · S3.4 UI Piano (`docs/BACKLOG.md`)
**Decisioni motivate:** [`requirements.md`](requirements.md) (U1–U4 dell'utente, P1–P20 di planning), recepite qui come definitive.

---

## 0. Contesto per chi implementa (leggere tutto prima del proprio WP)

### 0.1 Obiettivo
Il cuore del prodotto: una funzione pura di selezione pesata (testata e riproducibile), la creazione del piano settimanale che chiede nuove ricette all'LLM solo quando la libreria non basta, lo swap di un pasto, il blocco degli slot, la conferma (che aggiorna l'uso delle ricette) e la pagina Piano reale al posto dei dati finti.

### 0.2 Stato del codice su cui si lavora
Se un nome qui sotto differisce nel codice reale, **vince il codice reale**: adeguarsi mantenendo il comportamento descritto.
- Next.js **15.5** App Router (root senza `src/`, alias `@/*` → `./*`), React 19, zod **3.25** (`z.string().uuid()`, `z.string().datetime()`), Drizzle 0.39 + postgres.js, Vitest 3 (ambiente globale **jsdom**; i test lato server iniziano con `// @vitest-environment node`), Testing Library, Tailwind v4 con token `paper / ink / basil / tomato / saffron / stone` (`app/globals.css`), font `font-display` (Fraunces) e `font-sans` (Figtree), icone `lucide-react`.
- **Rotte dinamiche Next 15**: il secondo argomento degli handler è `{ params }: { params: Promise<{ id: string }> }` e va **atteso** (`const { id } = await params`).
- `lib/domain/types.ts` — schemi Zod e tipi: `MealTypeSchema`/`MEAL_TYPE_VALUES` (`'pranzo' | 'cena'`, in quest'ordine), `DietFlag`, `Appliance`, `PlanStatusSchema`/`PLAN_STATUS_VALUES` (`draft | active | archived`), `RecipeSchema` (con `ingredients?` e `prefs?`), `RecipePrefSchema`, `IngredientSchema`, `Household`/`HouseholdSchema`, `MEAL_STYLE_TAG_LABELS`, `DIET_FLAG_LABELS`, `MEAL_TYPE_LABELS`, `GENERATE_COUNT_MAX = 10`, `SettingsView`.
- `lib/domain/recipe-text.ts` — `expandDietFlags(flags)` (vegano ⇒ vegetariano + senza-lattosio; vegetariano ⇒ pescetariano), `normalizeCanonicalName(name)` (trim, minuscolo, spazi compressi).
- `lib/db/index.ts` — `db` (Drizzle con `schema`, supporta `db.query.*` e `db.transaction`), `client`; riesporta lo schema.
- `lib/db/schema.ts` — tabelle `households`, `recipes`, `recipe_ingredients`, `recipe_prefs` (`recipe_id` PK, `rating`, `favorite`, `blocked`, `times_used`, `last_used_at`), `meal_plans` (`id, household_id, week_start date, status text default 'draft', created_at`, unique `(household_id, week_start)`), `plan_slots` (`id, plan_id, day date, meal text, recipe_id uuid null (on delete set null), servings int, locked bool`, unique `(plan_id, day, meal)`), `shopping_lists` (`id, plan_id unique, generated_at`), `shopping_items`. Relazioni già definite: `mealPlansRelations` (`slots`, `shopping_list`), `planSlotsRelations` (`plan`, `recipe`), `recipesRelations` (`ingredients`, `prefs`). Le colonne `date` di Drizzle restituiscono **stringhe** `YYYY-MM-DD`.
- `lib/db/repositories/recipe-repo.ts` — `DbExecutor` (db o transazione), `RecipeWithDetails` (`Recipe` con `ingredients: Ingredient[]` e `prefs: RecipePref | null`), `listRecipes({ household_id })` (tutte le ricette con ingredienti e preferenze), `insertRecipe`, `insertRecipeWith`, funzione **interna** `formatRecipe(row)` (converte una riga `db.query.recipes` con `ingredients` e `prefs` in `RecipeWithDetails`), `acquireRecipeGenerationLock` (esempio di advisory lock).
- `lib/db/repositories/household-repo.ts` — `loadHousehold(id?)` (id assente o di default → singleton; id sconosciuto → `Error('Household <id> non trovato')`), `updateHousehold(data, id)` (scrive `updated_at = now()` del DB).
- `lib/recipes/index.ts` — `generateAndStoreRecipes(input: { householdId?, count, mealType, overrides? }, deps?)` → `{ requested, created: RecipeWithDetails[], skipped }`. **Apre una propria transazione con advisory lock ed esegue la chiamata LLM fuori da transazioni: non va mai chiamata dentro una transazione.** Lancia `LlmError` (`@/lib/llm/errors`: `LlmError`, `isLlmError`, codici `config | provider | timeout | invalid_output`).
- `app/api/recipes/generate/route.ts` — riferimento per il formato degli errori HTTP e per la mappatura degli errori LLM (`llm_not_configured` 500, `llm_timeout` 504, `llm_unavailable` 502, `llm_invalid_output` 502, `internal_error` 500). `app/api/settings/route.ts` — riferimento per `runtime`/`dynamic`.
- `lib/settings/client.ts` — **modello da copiare** per i client fetch (`SettingsRequestError(status, code, message)`, gestione rete/non-2xx/forma inattesa). `lib/settings/service.ts` — modello di servizio lato server.
- `app/(app)/layout.tsx` — layout del route group con guardia di onboarding e `BottomNav` (fissa, `h-16`, safe-area). `app/(app)/page.tsx` — **pagina Piano attuale con dati finti** (da sostituire). `app/(app)/impostazioni/page.tsx` — modello di pagina server (`await connection()` + servizio + componente client).
- Componenti riusabili: `components/cards/meal-card.tsx` (`MealCard`), `components/sheets/recipe-sheet.tsx` (`RecipeSheet`, tipi `RecipeDetail`, `RecipeIngredient`), `components/feedback/empty-state.tsx` (`EmptyState`), `components/ui/{button,badge,card}.tsx`, `lib/utils.ts` (`cn`).
- Test esistenti coinvolti: `tests/home.test.tsx` e `tests/ui/shell.test.tsx` (blocco "Pages Integration" → renderizzano `<Home />` sincrono con i dati finti; blocchi "MealCard" e "RecipeSheet"), `tests/db/schema.test.ts` (colonne delle tabelle), `tests/api/recipes-generate.test.ts` (comportamento della rotta di generazione), `tests/verification.test.ts` (esistenza di `app/(app)/page.tsx` e dei token CSS).
- Helper di test: `tests/helpers/db.ts` (`isDbAvailable`, `assertDbMigrated`, `createTestHousehold(overrides?)`, `deleteTestHousehold(id)`), `tests/helpers/mock-llm.ts`. Modello di test DB: `tests/recipes/generate.test.ts` (`const dbUp = await isDbAvailable(); describe.skipIf(!dbUp)`, household dedicati eliminati in `afterEach`). Modello di test di rotta: `tests/api/settings.test.ts` (`vi.mock` del servizio). Modello di test di pagina server: `tests/app/settings-page.test.tsx`.
- Fixtures: `fixtures/index.ts` (`fixtureRecipesAsDomain()` → 18 `Recipe` puri, utili ai test del planner senza DB). Con l'household di default (pranzo + cena, nessuna dieta, tutti gli elettrodomestici tranne il frullatore) le candidate sono 9 per il pranzo, 10 per la cena, 16 distinte.

### 0.3 Regole vincolanti
1. Tipi e schemi di dominio e i DTO delle API **solo** in `lib/domain/types.ts`. Le interfacce di funzione del planner (`PlannerInput`, …) e i tipi riga del repository vivono nei rispettivi moduli e sono costruiti **a partire** dai tipi di `types.ts`, senza ridefinire entità.
2. `lib/domain/*` è **puro**: nessun import da `lib/db`, `lib/llm`, `lib/recipes`, `next/*`, nessun accesso a rete, orologio (`new Date()` senza argomenti) o `Math.random()`. Il tempo entra come parametro `now: Date`, il caso come parametro `rng`.
3. Solo `lib/plans/service.ts` chiama `generateAndStoreRecipes`, e **sempre fuori** da `db.transaction(...)`.
4. I componenti client (`"use client"`) importano da `lib/plans/` **solo** `client.ts`, `format.ts`, `errors.ts`; **mai** `service.ts`. Non creare `lib/plans/index.ts`.
5. UI copy in italiano, **esattamente** come scritta nel piano (compresi i caratteri `…` U+2026 e `–` U+2013). Tap target ≥ 44 px, focus visibile (`focus-visible:ring-2 focus-visible:ring-basil`), `prefers-reduced-motion` rispettato.
6. Gate per ogni wave: `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build` verdi. Test DB: Postgres di `docker-compose.dev.yml` attivo e `pnpm db:migrate`. **Su questa macchina la porta 5432 è occupata da un altro progetto**: avviare il Postgres di Mealy sulla 5433 con un override (`services.postgres.ports: !override ["5433:5432"]`) e lanciare migrate/test/build con `DATABASE_URL=postgresql://mealy:mealy@localhost:5433/mealy_dev`.

### 0.4 Glossario del dominio usato nel piano
- **Settimana**: da lunedì (`week_start`) a domenica (`week_start + 6`). Date sempre stringhe `YYYY-MM-DD`, calcolate nel fuso `Europe/Rome`.
- **Settimana obiettivo** (`target`): quella su cui lavorano *Genera piano* / *Rigenera*. Da lunedì a venerdì: settimana corrente, `first_day = oggi`. Sabato e domenica: settimana successiva, `first_day = week_start`. `last_day` = domenica.
- **Piano mostrato**: il piano della settimana obiettivo se esiste; altrimenti, se la settimana obiettivo è quella successiva (weekend), il piano della settimana corrente se esiste; altrimenti nessuno.
- **Slot**: coppia (giorno, pasto) del piano; `servings` = `households.persons`.
- **Piano superato**: `households.updated_at > meal_plans.generated_at` (regola U1 di F3, aggiornata da P8).

### 0.5 Mappa dei work package
| WP | Wave | Story | Contenuto |
|---|---|---|---|
| WP1 | 1 | S3.1 | Contratti in `types.ts`, `planner-config`, `rng`, `week`, `planner` (funzioni pure + test) |
| WP2 | 1 | S3.2 (dati) | Colonne `generated_at` / `needs_regeneration` + migrazione `0003`, `plan-repo.ts`, export `toRecipeWithDetails`, helper di test |
| WP3 | 2 | S3.2 | Errori, helper HTTP, servizio piani (schermata, generazione, conferma, blocco), rotte API, client fetch |
| WP4 | 2 | S3.4 (mattoni) | `format.ts`, toast, avanzamento generazione, `MealCard` (long-press, azioni), `RecipeSheet` (barra azioni condizionale), CSS del flip |
| WP5 | 3 | S3.3 | `swapSlot` nel servizio + rotta swap |
| WP6 | 3 | S3.4 | `PlanSlotCard`, `PlanScreen`, pagina `app/(app)/page.tsx`, aggiornamento dei test di F1 |

---

## WP1 — Contratti e algoritmo di selezione pesata (wave 1, parallelo a WP2)

**Obiettivo:** scrivere tutti i contratti di F4 in `types.ts` e implementare, come funzioni pure testate, la settimana, l'RNG seedabile e la selezione pesata con il protocollo `needMore`.

### File
- `lib/domain/types.ts` — **modifica** (aggiunta in coda)
- `lib/domain/planner-config.ts` — nuovo
- `lib/domain/rng.ts` — nuovo
- `lib/domain/week.ts` — nuovo
- `lib/domain/planner.ts` — nuovo
- `tests/domain/rng.test.ts`, `tests/domain/week.test.ts`, `tests/domain/planner.test.ts`, `tests/domain/plan-contracts.test.ts` — nuovi

### Pattern di riferimento
- Sezioni commentate e schemi `XxxSchema` + `type Xxx = z.infer<…>` come in `lib/domain/types.ts` (blocchi "Recipe Generation Contracts (Feature 2)" e "Household Settings (Feature 3)").
- Funzioni pure con JSDoc in italiano come `lib/domain/recipe-text.ts`; test puri come `tests/domain/recipe-text.test.ts`.

### Passi

**1. `lib/domain/types.ts` — aggiungere in coda il blocco:**
```ts
// ============================================================================
// Meal Plans (Feature 4)
// ============================================================================

export const IsoDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

// Settimana su cui lavorano "Genera piano" / "Rigenera" (v. lib/domain/week.ts).
export const PlanWeekSchema = z.object({
  week_start: IsoDateSchema, // lunedì
  first_day: IsoDateSchema,  // primo giorno pianificabile (>= week_start)
  last_day: IsoDateSchema,   // domenica = week_start + 6
});
export type PlanWeek = z.infer<typeof PlanWeekSchema>;

export const PlanSlotViewSchema = z.object({
  id: z.string().uuid(),
  day: IsoDateSchema,
  meal: MealTypeSchema,
  servings: z.number().int().min(1),
  locked: z.boolean(),
  recipe: RecipeSchema.nullable(), // ricetta completa (ingredienti + prefs); null se eliminata
});
export type PlanSlotView = z.infer<typeof PlanSlotViewSchema>;

export const PlanShoppingListStateSchema = z.object({
  exists: z.boolean(),
  needs_regeneration: z.boolean(),
});
export type PlanShoppingListState = z.infer<typeof PlanShoppingListStateSchema>;

export const PlanViewSchema = z.object({
  id: z.string().uuid(),
  week_start: IsoDateSchema,
  status: PlanStatusSchema,
  created_at: z.string().datetime(),
  generated_at: z.string().datetime(),
  superseded: z.boolean(), // households.updated_at > generated_at
  slots: z.array(PlanSlotViewSchema), // ordinati per giorno, poi pranzo → cena
  shopping_list: PlanShoppingListStateSchema,
});
export type PlanView = z.infer<typeof PlanViewSchema>;

export const PLAN_ACTION_VALUES = ['generate', 'regenerate', 'none'] as const;
export const PlanActionSchema = z.enum(PLAN_ACTION_VALUES);
export type PlanAction = z.infer<typeof PlanActionSchema>;

// Risposta di GET /api/plans/current e dato iniziale della pagina Piano.
export const PlanScreenViewSchema = z.object({
  today: IsoDateSchema,
  plan: PlanViewSchema.nullable(), // piano mostrato
  target: PlanWeekSchema,          // settimana obiettivo di Genera/Rigenera
  action: PlanActionSchema,        // generate: nessun piano obiettivo; regenerate: obiettivo in bozza; none: obiettivo confermato
});
export type PlanScreenView = z.infer<typeof PlanScreenViewSchema>;

export const PlanGenerationSummarySchema = z.object({
  rounds: z.number().int().min(0),  // giri di generazione LLM eseguiti
  created: z.number().int().min(0), // ricette nuove salvate in libreria
  failed: z.boolean(),              // true se almeno una chiamata LLM è fallita
});
export type PlanGenerationSummary = z.infer<typeof PlanGenerationSummarySchema>;

// Body di POST /api/plans (la settimana la calcola il server)
export const GeneratePlanRequestSchema = z.object({}).strict();
// Risposta di POST /api/plans
export const GeneratePlanResultSchema = z.object({
  screen: PlanScreenViewSchema,
  generation: PlanGenerationSummarySchema,
});
export type GeneratePlanResult = z.infer<typeof GeneratePlanResultSchema>;

// Risposta di POST /api/plans/:id/confirm e PATCH /api/plans/:id/slots/:slotId
export const PlanResultSchema = z.object({ plan: PlanViewSchema });
export type PlanResult = z.infer<typeof PlanResultSchema>;

// Body di POST /api/plans/:id/slots/:slotId/swap
export const SWAP_EXCLUDE_MAX = 50;
export const SwapSlotRequestSchema = z
  .object({
    exclude_recipe_ids: z.array(z.string().uuid()).max(SWAP_EXCLUDE_MAX).default([]),
  })
  .strict();
export type SwapSlotRequest = z.infer<typeof SwapSlotRequestSchema>;
// Risposta dello swap
export const PlanMutationResultSchema = z.object({
  plan: PlanViewSchema,
  generation: PlanGenerationSummarySchema,
});
export type PlanMutationResult = z.infer<typeof PlanMutationResultSchema>;

// Body di PATCH /api/plans/:id/slots/:slotId
export const UpdateSlotRequestSchema = z.object({ locked: z.boolean() }).strict();
export type UpdateSlotRequest = z.infer<typeof UpdateSlotRequestSchema>;
```
Non modificare gli schemi esistenti (`MealPlanSchema`, `PlanSlotSchema` restano).

**2. `lib/domain/planner-config.ts`:**
```ts
export interface PlannerConfig {
  recencyMinDays: number;      // sotto: peso 0
  recencyFullDays: number;     // oltre: peso pieno
  favoriteBoost: number;
  noveltyBonus: number;
  ingredientLikeStep: number;
  ingredientLikeMaxCount: number;
  minPoolSize: number;         // candidate minime per l'ultimo slot di ogni tipo
  generationExtra: number;     // ricette in più rispetto al deficit
  generationMin: number;       // minimo per chiamata (anche per lo swap)
  generationMax: number;       // = GENERATE_COUNT_MAX
  maxGenerationRoundsPlan: number;
  maxGenerationRoundsSwap: number;
}

export const PLANNER_CONFIG: PlannerConfig = {
  recencyMinDays: 10,
  recencyFullDays: 28,
  favoriteBoost: 1.5,
  noveltyBonus: 1.2,
  ingredientLikeStep: 0.15,
  ingredientLikeMaxCount: 2,
  minPoolSize: 3,
  generationExtra: 2,
  generationMin: 3,
  generationMax: GENERATE_COUNT_MAX, // import da './types'
  maxGenerationRoundsPlan: 2,
  maxGenerationRoundsSwap: 1,
};

/** Fuso orario in cui si calcolano "oggi" e le settimane del piano. */
export const APP_TIME_ZONE = 'Europe/Rome';
```
Nessun'altra costante numerica del planner va scritta altrove.

**3. `lib/domain/rng.ts`:**
```ts
/** Generatore pseudo-casuale: ogni chiamata restituisce un numero in [0, 1). */
export type Rng = () => number;

/** mulberry32: deterministico, stesso seed ⇒ stessa sequenza. */
export function createRng(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Seed casuale per l'uso reale (non nei test). */
export function randomSeed(): number {
  return crypto.getRandomValues(new Uint32Array(1))[0];
}
```
`randomSeed` è l'unica eccezione alla regola 0.3.2 ed è chiamata solo da `lib/plans/service.ts`.

**4. `lib/domain/week.ts`** (aritmetica su date `YYYY-MM-DD` via `Date.UTC`, mai con il fuso locale):
```ts
/** Data odierna (YYYY-MM-DD) nel fuso indicato. */
export function todayInTimeZone(now: Date, timeZone: string): string
// Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' })
//   .formatToParts(now) → comporre `${year}-${month}-${day}` dalle parti (non affidarsi a format()).

export function addDays(isoDate: string, days: number): string
export function isoWeekday(isoDate: string): number   // 1 = lunedì … 7 = domenica
export function mondayOf(isoDate: string): string
export function listDays(first: string, last: string): string[] // inclusivo; [] se first > last

/** Settimana obiettivo (glossario 0.4). */
export function resolveTargetWeek(today: string): PlanWeek
// isoWeekday(today) >= 6 → week_start = addDays(mondayOf(today), 7), first_day = week_start
// altrimenti            → week_start = mondayOf(today),               first_day = today
// last_day = addDays(week_start, 6)
```
`PlanWeek` si importa da `./types`.

**5. `lib/domain/planner.ts`** — contratto completo (esportare tutto quanto segue):
```ts
import type { Household, MealType, Recipe } from './types';
import { MEAL_TYPE_VALUES } from './types';
import { expandDietFlags, normalizeCanonicalName } from './recipe-text';
import { PLANNER_CONFIG, type PlannerConfig } from './planner-config';
import type { Rng } from './rng';

/** canonical_name già normalizzati con normalizeCanonicalName. Vuoti fino a F5 (S2.3). */
export interface IngredientPreferenceSets {
  likes: ReadonlySet<string>;
  dislikes: ReadonlySet<string>;
}
export const EMPTY_INGREDIENT_PREFERENCES: IngredientPreferenceSets;
export function toIngredientPreferenceSets(likes: Iterable<string>, dislikes: Iterable<string>): IngredientPreferenceSets;

export type ExclusionReason = 'blocked' | 'meal_type' | 'diet' | 'appliance' | 'disliked_ingredient' | 'excluded';

export interface PlannerContext {
  household: Pick<Household, 'diet_tags' | 'appliances'>;
  ingredientPrefs: IngredientPreferenceSets;
  excludeRecipeIds: ReadonlySet<string>;
}

export function exclusionReason(recipe: Recipe, meal: MealType, ctx: PlannerContext): ExclusionReason | null;
export function recipeWeight(recipe: Recipe, ingredientLikes: ReadonlySet<string>, now: Date, config?: PlannerConfig): number;
export function weightedPick<T>(items: readonly T[], weights: readonly number[], rng: Rng): T;

export interface PlannerSlot { key: string; day: string; meal: MealType }
export interface PlannerInput extends PlannerContext {
  slots: readonly PlannerSlot[];   // slot da riempire (qualsiasi ordine)
  candidates: readonly Recipe[];   // libreria dell'household con ingredients e prefs
  now: Date;
  rng: Rng;
  config?: PlannerConfig;          // default PLANNER_CONFIG
}
export interface PlannerAssignment {
  key: string;
  recipeId: string | null; // null = nessuna candidata
  fallback: boolean;       // true = scelta tra candidate a peso 0 (usate di recente)
}
export interface MealTypeShortage {
  meal_type: MealType;
  slots: number;     // slot di quel tipo da riempire
  available: number; // candidate con peso > 0 (dopo filtri duri ed esclusioni)
  required: number;  // slots + minPoolSize - 1
  unfilled: number;  // slot rimasti con recipeId null
}
export interface PlannerResult {
  assignments: PlannerAssignment[]; // stesso ordine di input.slots
  needMore: MealTypeShortage[];     // ordine di MEAL_TYPE_VALUES
}
export function selectRecipes(input: PlannerInput): PlannerResult;
export function computeGenerationCount(shortage: MealTypeShortage, config?: PlannerConfig): number;
```

Regole esatte:
- **`toIngredientPreferenceSets`**: applica `normalizeCanonicalName` a ogni voce; restituisce due `Set` nuovi. `EMPTY_INGREDIENT_PREFERENCES` = due `Set` vuoti.
- **`exclusionReason`** — controlli **in quest'ordine**, restituisce il primo motivo che scatta, altrimenti `null`:
  1. `recipe.prefs?.blocked === true` → `'blocked'`
  2. `!recipe.meal_types.includes(meal)` → `'meal_type'`
  3. esiste una dieta in `ctx.household.diet_tags` non contenuta in `expandDietFlags(recipe.diet_flags)` → `'diet'`
  4. esiste un elettrodomestico in `recipe.appliances_required` non contenuto in `ctx.household.appliances` → `'appliance'`
  5. esiste un ingrediente in `recipe.ingredients ?? []` con `normalizeCanonicalName(canonical_name)` in `ctx.ingredientPrefs.dislikes` → `'disliked_ingredient'`
  6. `ctx.excludeRecipeIds.has(recipe.id)` → `'excluded'`
- **`recipeWeight`** (`prefs` null ⇒ rating null, favorite false, times_used 0, last_used_at null):
  - `ratingFactor` = `1` se `rating` è null/undefined, altrimenti `0.25 + rating / 4`
  - `favoriteBoost` = `config.favoriteBoost` se `favorite`, altrimenti `1`
  - `recencyDecay`: `last_used_at` null → `1`; altrimenti `days = (now − last_used_at) / 86_400_000` (in virgola mobile; se negativo vale 0); `days < recencyMinDays` → `0`; `days >= recencyFullDays` → `1`; altrimenti `(days − recencyMinDays) / (recencyFullDays − recencyMinDays)`
  - `noveltyBonus` = `config.noveltyBonus` se `times_used === 0`, altrimenti `1`
  - `ingredientAffinity` = `1 + ingredientLikeStep × min(ingredientLikeMaxCount, n)`, dove `n` = numero di `canonical_name` **distinti** (normalizzati) della ricetta presenti in `ingredientLikes`
  - risultato = prodotto dei cinque fattori.
- **`weightedPick`**: `total` = somma dei pesi; se `items` è vuoto o `total <= 0` lancia `Error('weightedPick: nessun elemento con peso positivo')`. `r = rng() * total`; scorre gli elementi accumulando i pesi e restituisce il primo con `r < cumulato`; se per arrotondamento non ne trova, restituisce l'ultimo con peso > 0.
- **`selectRecipes`**:
  1. `cfg = input.config ?? PLANNER_CONFIG`. Per ogni tipo di pasto `m` presente negli slot: `eligible_m` = candidate con `exclusionReason(r, m, input) === null`, **ordinate per `id` crescente** (confronto di stringhe); `weight(r)` = `recipeWeight(r, input.ingredientPrefs.likes, input.now, cfg)` (calcolarlo una volta per ricetta); `available_m` = numero di `eligible_m` con peso > 0; `slots_m` = numero di slot di tipo `m`; `required_m = slots_m + cfg.minPoolSize − 1`.
  2. Ordinare una **copia** degli slot: prima per tipo di pasto, mettendo per primo il tipo con **meno** `eligible_m` (a parità, ordine di `MEAL_TYPE_VALUES`); poi per `day` crescente. Così le ricette valide per pranzo e cena non "affamano" il tipo più scarso. `picked` = insieme vuoto di id.
  3. Per ogni slot in quell'ordine: `pool` = `eligible_meal` senza gli id in `picked`; `positive` = elementi di `pool` con peso > 0. Se `positive` non è vuoto → `recipe = weightedPick(positive, pesi, input.rng)`, `fallback = false`. Altrimenti se `pool` non è vuoto → la ricetta con `prefs.last_used_at` **più vecchio** (a parità, `id` minore), `fallback = true`, **senza consumare** `rng`. Altrimenti `recipeId = null`, `fallback = false`. Aggiungere l'id scelto a `picked`.
  4. `unfilled_m` = slot di tipo `m` con `recipeId === null`.
  5. `needMore` = per ogni `m` in ordine `MEAL_TYPE_VALUES` presente negli slot, l'oggetto `MealTypeShortage` **se** `available_m < required_m` **oppure** `unfilled_m > 0`.
  6. `assignments` nello **stesso ordine** di `input.slots`.
  7. Con `slots` vuoto: `{ assignments: [], needMore: [] }`.
  Una ricetta compatibile con pranzo e cena compare al massimo una volta in tutto il risultato.
- **`computeGenerationCount`**: `deficit = max(s.required − s.available, s.unfilled)`; risultato `min(cfg.generationMax, max(cfg.generationMin, deficit + cfg.generationExtra))`.

**6. Test** (tutti puri; `tests/domain/*.test.ts` senza DB):
- `rng.test.ts`: due `createRng(42)` producono le stesse prime 5 cifre; seed diversi (1 e 2) producono sequenze diverse; 1000 valori tutti in `[0, 1)`.
- `week.test.ts`:
  - `todayInTimeZone(new Date('2026-09-27T22:30:00Z'), 'Europe/Rome')` → `'2026-09-28'`; `todayInTimeZone(new Date('2026-09-28T10:00:00Z'), 'UTC')` → `'2026-09-28'`.
  - `isoWeekday('2026-09-28')` → 1; `isoWeekday('2026-10-04')` → 7. `mondayOf('2026-10-04')` → `'2026-09-28'`; `mondayOf('2026-09-28')` → `'2026-09-28'`. `addDays('2026-12-30', 3)` → `'2027-01-02'`. `listDays('2026-09-30', '2026-10-04')` → 5 date; `listDays('2026-10-05', '2026-10-04')` → `[]`.
  - `resolveTargetWeek('2026-09-30')` (mercoledì) → `{ week_start: '2026-09-28', first_day: '2026-09-30', last_day: '2026-10-04' }`; `'2026-09-28'` (lunedì) → `first_day: '2026-09-28'`; `'2026-10-02'` (venerdì) → `week_start: '2026-09-28'`, `first_day: '2026-10-02'`; `'2026-10-03'` (sabato) e `'2026-10-04'` (domenica) → `{ week_start: '2026-10-05', first_day: '2026-10-05', last_day: '2026-10-11' }`.
- `planner.test.ts` (costruire le ricette con un helper locale `makeRecipe(overrides)` che parte da un `Recipe` valido con `id` UUID fissi, `meal_types: ['pranzo','cena']`, nessuna dieta/elettrodomestico, un ingrediente `sale`/`qb`, `prefs: null`; `now = new Date('2026-09-30T12:00:00Z')`):
  1. **Esclusioni**: una ricetta per ciascun motivo produce esattamente quel `ExclusionReason`; blocked e meal_type insieme → `'blocked'` (ordine); household `diet_tags: ['vegetariano']` e ricetta `['vegano']` → ammessa; dislike `' Aglio '` contro ingrediente `aglio` → `'disliked_ingredient'`; ricetta senza `ingredients` → nessun errore.
  2. **Peso**: rating 5 + favorite + `times_used: 3` + `last_used_at` 40 giorni prima + 3 ingredienti distinti tutti in `likes` → `2.925` (`toBeCloseTo`); rating 1 → fattore 0.5; `last_used_at` 5 giorni prima → 0; 19 giorni prima con `times_used: 1` → 0.5; 28 giorni prima → 1; mai usata e `times_used: 0` → 1.2.
  3. **Riproducibilità**: stessa libreria (usare `fixtureRecipesAsDomain()`), stessi 10 slot, `createRng(7)` due volte → `assignments` identici; nessun `recipeId` ripetuto; ogni ricetta assegnata ha `exclusionReason(r, slot.meal, ctx) === null`.
  4. **Ordine di input indipendente**: stesso input con `candidates` in ordine inverso → stesso risultato.
  5. **Recency**: tre candidate per un solo slot, due usate 3 giorni prima e una mai usata → sempre la mai usata (su 50 seed diversi).
  6. **Ripiego**: un solo slot, due candidate usate rispettivamente 2 e 5 giorni prima → sceglie quella di 5 giorni prima, `fallback: true`; `needMore` contiene il tipo con `available: 0`.
  7. **Max 1 occorrenza**: 3 slot di cena e 2 candidate → due slot riempiti con ricette diverse, un `recipeId: null`, `needMore[0].unfilled === 1`.
  8. **needMore**: 5 slot di pranzo e 7 candidate a peso positivo → `needMore` vuoto; con 6 candidate → `[{ meal_type: 'pranzo', slots: 5, available: 6, required: 7, unfilled: 0 }]`; con la libreria di `fixtureRecipesAsDomain()`, household `DEFAULT_HOUSEHOLD` e 7 giorni × pranzo e cena → `needMore` vuoto e 14 slot riempiti **per 20 seed diversi** (verifica dell'ordine "tipo più scarso prima": 9 candidate di pranzo contro 10 di cena, 3 condivise).
  8b. **Tipo più scarso prima**: 2 slot di pranzo e 2 di cena; candidate: 2 solo cena + 2 valide per pranzo e cena → tutti e 4 gli slot riempiti per 20 seed diversi (le 2 condivise vanno al pranzo).
  9. **Preferite ~1.5×**: 10 candidate identiche tranne l'id (5 `favorite: true`, 5 no, tutte `times_used: 1`, `last_used_at: null`), un solo slot, 10 000 estrazioni con **un unico** `createRng(42)` → rapporto tra estrazioni di preferite e non preferite in `[1.4, 1.6]`.
  10. **Like ingredienti**: stesso schema del test 9, 5 candidate con 2 ingredienti in `likes` → rapporto in `[1.2, 1.4]` (atteso 1.3). Con `dislikes` contenente un loro ingrediente, quelle 5 non escono mai.
  11. `computeGenerationCount`: `{ required: 7, available: 6, unfilled: 0 }` → 3; `{ required: 9, available: 0, unfilled: 7 }` → 10 (clamp da 11); `{ required: 3, available: 0, unfilled: 1 }` → 5.
  12. `weightedPick` con pesi tutti 0 → lancia.
- `plan-contracts.test.ts`: `SwapSlotRequestSchema.parse({})` → `{ exclude_recipe_ids: [] }`; 51 id → errore; chiave extra → errore; `GeneratePlanRequestSchema.parse({ week_start: 'x' })` → errore; `UpdateSlotRequestSchema.parse({ locked: 'si' })` → errore; un `PlanScreenView` di esempio con `plan: null` passa il parse.

### Contratti esposti
Tutti i tipi/schemi del passo 1; da `@/lib/domain/planner-config`: `PLANNER_CONFIG`, `PlannerConfig`, `APP_TIME_ZONE`; da `@/lib/domain/rng`: `Rng`, `createRng`, `randomSeed`; da `@/lib/domain/week`: `todayInTimeZone`, `addDays`, `isoWeekday`, `mondayOf`, `listDays`, `resolveTargetWeek`; da `@/lib/domain/planner`: tutto il passo 5.
**Per F5 (S2.3):** il cablaggio delle preferenze ingredienti consiste solo nel popolare `IngredientPreferenceSets` (v. `loadIngredientPreferences` in WP3); l'algoritmo non cambia.

### Dipendenze
Nessuna (usa solo codice esistente).

### Criteri di accettazione (S3.1)
- Suite verde; stesso seed ⇒ stesso output; su 10 000 estrazioni le preferite escono ~1.5× (test 9).
- Esclusioni (blocked, pasto, dieta, elettrodomestici, dislike), recency, novelty, max 1 occorrenza e `needMore` coperti dai test.
- Nessun import da `lib/db`, `lib/llm`, `lib/recipes`, `next/*` nei file di `lib/domain/` toccati.

### Fuori scope
Accesso al DB, orchestrazione della generazione, UI, lettura di `ingredient_prefs` (F5), uso di `meal_style_tags` nella selezione (requirements P7).

---

## WP2 — Dati del piano: migrazione e repository (wave 1, parallelo a WP1)

**Obiettivo:** aggiungere le due colonne di tracciamento e un repository tipato che legge e scrive piani, slot, uso delle ricette e flag della lista.

### File
- `lib/db/schema.ts` — **modifica**
- `lib/db/migrations/0003_add_plan_generation_tracking.sql` + `lib/db/migrations/meta/0003_snapshot.json` + `lib/db/migrations/meta/_journal.json` — generati da drizzle-kit
- `lib/db/repositories/recipe-repo.ts` — **modifica** (solo export)
- `lib/db/repositories/plan-repo.ts` — nuovo
- `tests/helpers/plans.ts` — nuovo
- `tests/db/schema.test.ts` — **modifica** (nuove colonne)
- `tests/db/plan-repo.test.ts` — nuovo
- `docs/ARCHITECTURE.md` — **modifica** (§4.2: le due colonne)

### Pattern di riferimento
- Repository con `executor: DbExecutor` come primo argomento: `listRecipeTitles`, `acquireRecipeGenerationLock` in `lib/db/repositories/recipe-repo.ts`.
- Migrazione nominata come `0002_add_household_onboarded_at` (F3).
- Test DB: `tests/recipes/generate.test.ts` (skip se DB giù, household dedicati).

### Passi

**1. `lib/db/schema.ts`:** in `meal_plans` aggiungere `generated_at: timestamp('generated_at', { withTimezone: true }).defaultNow().notNull()` (dopo `created_at`); in `shopping_lists` aggiungere `needs_regeneration: boolean('needs_regeneration').notNull().default(false)` (dopo `generated_at`). Nessun'altra modifica.

**2. Migrazione:** `pnpm db:generate --name add_plan_generation_tracking`. L'SQL atteso contiene esattamente due `ALTER TABLE … ADD COLUMN` (`"generated_at" timestamp with time zone DEFAULT now() NOT NULL` su `meal_plans`, `"needs_regeneration" boolean DEFAULT false NOT NULL` su `shopping_lists`). Verificare con `pnpm db:migrate` sul DB di sviluppo. Non modificare a mano le migrazioni precedenti.

**3. `recipe-repo.ts`:** esportare la funzione interna esistente con un nome pubblico, senza cambiarne il comportamento: rinominare `formatRecipe` in `toRecipeWithDetails` ed esportarla (`export function toRecipeWithDetails(row: Record<string, unknown>): RecipeWithDetails`), aggiornando i suoi usi nel file. JSDoc: "Converte una riga di `db.query.recipes` con `ingredients` e `prefs` in `RecipeWithDetails`".

**4. `lib/db/repositories/plan-repo.ts`** — contratto completo:
```ts
import { and, asc, eq, inArray, lt, ne, sql } from 'drizzle-orm';
import { meal_plans, plan_slots, recipe_prefs, shopping_lists } from '../schema';
import { type DbExecutor, type RecipeWithDetails, toRecipeWithDetails } from './recipe-repo';
import { MEAL_TYPE_VALUES, MealTypeSchema, PlanStatusSchema, type MealType, type PlanStatus } from '@/lib/domain/types';

export interface PlanRecord {
  id: string;
  household_id: string;
  week_start: string;   // YYYY-MM-DD
  status: PlanStatus;
  created_at: Date;
  generated_at: Date;
}
export interface PlanSlotRecord {
  id: string;
  plan_id: string;
  day: string;          // YYYY-MM-DD
  meal: MealType;
  recipe_id: string | null;
  servings: number;
  locked: boolean;
  recipe: RecipeWithDetails | null;
}
export interface PlanWithSlots extends PlanRecord {
  slots: PlanSlotRecord[]; // ordinati per day, poi indice del pasto in MEAL_TYPE_VALUES
  shopping_list: { exists: boolean; needs_regeneration: boolean };
}
export interface NewSlotInput {
  day: string;
  meal: MealType;
  recipe_id: string | null;
  servings: number;
  locked: boolean;
}

export async function findPlanByWeek(executor: DbExecutor, householdId: string, weekStart: string): Promise<PlanWithSlots | null>;
export async function getPlanById(executor: DbExecutor, planId: string): Promise<PlanWithSlots | null>;
export async function acquirePlanLock(executor: DbExecutor, householdId: string): Promise<void>;
export async function insertPlan(executor: DbExecutor, householdId: string, weekStart: string): Promise<PlanRecord>;
export async function touchPlanGeneratedAt(executor: DbExecutor, planId: string): Promise<void>;
export async function setPlanStatus(executor: DbExecutor, planId: string, status: PlanStatus): Promise<void>;
export async function archivePlansBefore(executor: DbExecutor, householdId: string, weekStart: string): Promise<number>;
export async function insertSlots(executor: DbExecutor, planId: string, slots: NewSlotInput[]): Promise<void>;
export async function deleteSlots(executor: DbExecutor, slotIds: string[]): Promise<void>;
export async function updateSlotsServings(executor: DbExecutor, slotIds: string[], servings: number): Promise<void>;
export async function updateSlotRecipe(executor: DbExecutor, slotId: string, recipeId: string): Promise<void>;
export async function setSlotLocked(executor: DbExecutor, slotId: string, locked: boolean): Promise<boolean>;
export async function incrementRecipeUsage(executor: DbExecutor, recipeIds: string[]): Promise<void>;
export async function markShoppingListStale(executor: DbExecutor, planId: string): Promise<boolean>;
```
Regole:
- `findPlanByWeek` / `getPlanById`: `executor.query.meal_plans.findFirst({ where, with: { slots: { with: { recipe: { with: { ingredients: true, prefs: true } } } }, shopping_list: true } })`. Mappatura: `status` con `PlanStatusSchema.parse`, `meal` con `MealTypeSchema.parse`, `recipe` con `toRecipeWithDetails(row.recipe)` o `null`, `shopping_list` = `{ exists: row.shopping_list != null, needs_regeneration: row.shopping_list?.needs_regeneration ?? false }`. Ordinare gli slot in memoria (giorno, poi `MEAL_TYPE_VALUES.indexOf(meal)`). `null` se il piano non esiste.
- `acquirePlanLock`: `select pg_advisory_xact_lock(hashtext(${'mealy:plans:' + householdId}))` (come `acquireRecipeGenerationLock`). JSDoc: "Solo dentro una transazione".
- `insertPlan`: `status: 'draft'`; `created_at` e `generated_at` dai default del DB. Restituisce il `PlanRecord` inserito.
- `touchPlanGeneratedAt`: `generated_at = sql\`now()\``.
- `archivePlansBefore`: `update meal_plans set status = 'archived' where household_id = $1 and week_start < $2 and status <> 'archived'`; restituisce il numero di righe aggiornate.
- `insertSlots` / `deleteSlots` / `updateSlotsServings`: con array vuoto non eseguono query.
- `setSlotLocked`: restituisce `true` se una riga è stata aggiornata.
- `incrementRecipeUsage`: deduplica gli id; con array vuoto non fa nulla; per ogni id `insert into recipe_prefs (recipe_id, times_used, last_used_at) values (id, 1, now()) on conflict (recipe_id) do update set times_used = recipe_prefs.times_used + 1, last_used_at = now()` (una sola istruzione con più `values`; `onConflictDoUpdate({ target: recipe_prefs.recipe_id, set: { times_used: sql\`${recipe_prefs.times_used} + 1\`, last_used_at: sql\`now()\` } })`).
- `markShoppingListStale`: `update shopping_lists set needs_regeneration = true where plan_id = $1`; `true` se esisteva una lista.

**5. `tests/helpers/plans.ts`:**
```ts
export interface TestRecipeSpec {
  title?: string;                         // default `Ricetta test ${uuid.slice(0, 8)}`
  meal_types: MealType[];
  diet_flags?: DietFlag[];
  appliances_required?: Appliance[];
  ingredients?: InsertIngredientInput[];  // default [{ canonical_name: 'sale', display_name: 'sale', qty: null, unit: 'qb', category: 'dispensa' }]
  prefs?: InsertRecipePrefInput;
}
export async function insertTestRecipe(householdId: string, spec: TestRecipeSpec): Promise<RecipeWithDetails>;
export async function insertTestRecipes(householdId: string, count: number, spec: TestRecipeSpec): Promise<RecipeWithDetails[]>;
```
Usa `insertRecipe` di `recipe-repo`; slug `${slugify(title)}-${crypto.randomUUID().slice(0, 8)}` (gli slug sono unici a livello globale); `steps: ['Passo unico.']`, `servings_base: 2`, `prep_minutes: 20`, `source: 'manual'`. In `insertTestRecipes` il titolo di default contiene l'indice (`Ricetta test ${i} ${uuid8}`).

**6. Test:**
- `tests/db/schema.test.ts`: aggiungere l'attesa delle colonne `generated_at` su `meal_plans` e `needs_regeneration` su `shopping_lists`, con lo stesso stile delle asserzioni esistenti su colonne.
- `tests/db/plan-repo.test.ts` (`// @vitest-environment node`, `describe.skipIf(!dbUp)`, `beforeAll(assertDbMigrated)`, household dedicati eliminati in `afterEach`):
  1. `insertPlan` → `status: 'draft'`, `generated_at` valorizzato; `findPlanByWeek` lo ritrova con `slots: []` e `shopping_list: { exists: false, needs_regeneration: false }`.
  2. `insertSlots` con 3 slot inseriti in ordine sparso (`cena` 01/10, `pranzo` 01/10, `cena` 30/09) → `findPlanByWeek` li restituisce ordinati `30/09 cena`, `01/10 pranzo`, `01/10 cena`, con `recipe` completa (ingredienti e prefs) per quelli con `recipe_id`.
  3. `touchPlanGeneratedAt` → `generated_at` successivo al precedente.
  4. `archivePlansBefore` con piani 21/09 (draft), 28/09 (active), 05/10 → chiamata con `'2026-10-05'` restituisce 2 e lascia intatto il 05/10.
  5. `incrementRecipeUsage([a, a, b])` → `times_used` di `a` e `b` passa da 0 a 1 (la duplicazione non conta due volte), `last_used_at` non null; seconda chiamata → 2.
  6. `markShoppingListStale` senza lista → `false`; dopo aver inserito una riga in `shopping_lists` per il piano → `true` e `findPlanByWeek` riporta `needs_regeneration: true`.
  7. `setSlotLocked` su id inesistente → `false`.

**7. `docs/ARCHITECTURE.md` §4.2:** in `meal_plans` aggiungere `generated_at timestamptz  -- ultima (ri)generazione; piano superato se households.updated_at > generated_at`; in `shopping_lists` aggiungere `needs_regeneration bool default false  -- impostato dallo swap (F4), azzerato alla rigenerazione della lista (F6)`.

### Contratti esposti
Tutto il passo 4 (`@/lib/db/repositories/plan-repo`), `toRecipeWithDetails` (`@/lib/db/repositories/recipe-repo`), `insertTestRecipe`/`insertTestRecipes` (`@/tests/helpers/plans`).
**Per F6:** `shopping_lists.needs_regeneration` va rimesso a `false` quando la lista viene rigenerata.

### Dipendenze
Nessuna: usa solo tipi già esistenti in `types.ts` (non quelli aggiunti da WP1).

### Criteri di accettazione
- `pnpm db:migrate` applica `0003` da zero e su un DB già migrato; test del repository verdi.
- `tests/db/schema.test.ts` e tutti i test che usano `recipe-repo` restano verdi.

### Fuori scope
Logica di selezione, servizio, rotte, creazione delle liste della spesa (F6).

---

## WP3 — Servizio piani e API (wave 2, parallelo a WP4)

**Obiettivo:** orchestrare selezione, generazione e persistenza del piano ed esporre schermata, generazione, conferma e blocco via API, più il client fetch usato dalla UI (swap compreso).

### File
- `lib/plans/errors.ts` — nuovo
- `lib/http/responses.ts` — nuovo
- `lib/plans/service.ts` — nuovo
- `lib/plans/client.ts` — nuovo
- `lib/plans/http.ts` — nuovo (`handlePlanRouteError`)
- `app/api/plans/route.ts` — nuovo (`POST`)
- `app/api/plans/current/route.ts` — nuovo (`GET`)
- `app/api/plans/[id]/confirm/route.ts` — nuovo (`POST`)
- `app/api/plans/[id]/slots/[slotId]/route.ts` — nuovo (`PATCH`)
- `app/api/recipes/generate/route.ts` — **modifica** (refactor sugli helper, comportamento invariato)
- `tests/plans/service.test.ts`, `tests/plans/client.test.ts`, `tests/api/plans.test.ts`, `tests/http/responses.test.ts` — nuovi
- `docs/ARCHITECTURE.md` — **modifica** (§6)

### Pattern di riferimento
- Servizio: `lib/settings/service.ts` (commento iniziale "Solo lato server"); rotte: `app/api/settings/route.ts` e `app/api/recipes/generate/route.ts`; client: `lib/settings/client.ts`; test: `tests/recipes/generate.test.ts` (DB), `tests/api/settings.test.ts` (rotte con servizio mockato), `tests/settings/client.test.ts` (fetch mockato).

### Passi

**1. `lib/plans/errors.ts`** (nessun import dal DB, usabile dal client):
```ts
export const PLAN_ERROR_CODES = [
  'plan_not_found', 'slot_not_found', 'plan_confirmed', 'plan_archived',
  'slot_locked', 'insufficient_recipes', 'no_alternatives',
] as const;
export type PlanErrorCode = (typeof PLAN_ERROR_CODES)[number];

export const PLAN_ERROR_HTTP: Record<PlanErrorCode, { status: number; message: string }> = {
  plan_not_found:       { status: 404, message: 'Piano non trovato.' },
  slot_not_found:       { status: 404, message: 'Pasto non trovato.' },
  plan_confirmed:       { status: 409, message: 'Il piano è già confermato: puoi cambiare i singoli pasti.' },
  plan_archived:        { status: 409, message: 'Questo piano è archiviato.' },
  slot_locked:          { status: 409, message: 'Sblocca il pasto per cambiarlo.' },
  insufficient_recipes: { status: 422, message: 'Non ho trovato abbastanza ricette per i tuoi vincoli. Prova ad allargare le impostazioni.' },
  no_alternatives:      { status: 422, message: 'Non ci sono altre ricette adatte a questo pasto.' },
};

export class PlanError extends Error {
  readonly code: PlanErrorCode;
  constructor(code: PlanErrorCode) {
    super(PLAN_ERROR_HTTP[code].message);
    this.name = 'PlanError';
    this.code = code;
  }
}
export function isPlanError(error: unknown): error is PlanError;
```

**2. `lib/http/responses.ts`:**
```ts
export function errorResponse(status: number, code: string, message: string, details?: { path: string; message: string }[]): Response;
// → Response.json({ error: { code, message, ...(details ? { details } : {}) } }, { status })
export function invalidRequestResponse(issues?: z.ZodIssue[]): Response;
// → 400 'invalid_request' 'Richiesta non valida.'; con issues: details = issues.map(i => ({ path: i.path.join('.'), message: i.message }))
export function internalErrorResponse(): Response; // 500 'internal_error' 'Qualcosa è andato storto. Riprova.'
export function llmErrorResponse(err: unknown): Response | null;
// isLlmError(err): config → 500 llm_not_configured 'Generazione non disponibile: il modello non è configurato.'
//                  timeout → 504 llm_timeout; provider → 502 llm_unavailable; invalid_output → 502 llm_invalid_output
//                  (questi tre con 'La generazione non è andata a buon fine. Riprova.'); altrimenti null
export async function readJsonBody(request: Request, options: { allowEmpty: boolean }): Promise<{ ok: true; value: unknown } | { ok: false }>;
// legge request.text(); se vuoto (dopo trim) → allowEmpty ? { ok: true, value: {} } : { ok: false }; altrimenti JSON.parse; errore di parse → { ok: false }
```
Refactor di `app/api/recipes/generate/route.ts`: sostituire i blocchi inline con `invalidRequestResponse(...)`, `llmErrorResponse(err)`, `internalErrorResponse()`. Mantenere `request.json()` (non `readJsonBody`), `console.error('[api/recipes/generate]', err)`, `runtime`, `dynamic`, `maxDuration = 120`. `tests/api/recipes-generate.test.ts` deve restare verde **senza modifiche**.

**3. `lib/plans/service.ts`** (prima riga: `// Solo lato server: importa il DB e il modulo recipes. I componenti client usano client.ts, format.ts ed errors.ts.`)
```ts
export type GenerateRecipesFn = (input: GenerateAndStoreInput) => Promise<GenerateAndStoreResult>;
export interface PlanServiceOptions {
  householdId?: string;        // default: singleton
  now?: () => Date;            // default: () => new Date()
  rng?: Rng;                   // default: createRng(randomSeed())
  generate?: GenerateRecipesFn;// default: (input) => generateAndStoreRecipes(input)
  config?: PlannerConfig;      // default: PLANNER_CONFIG
}

// loadIngredientPreferences(householdId, executor = db) vive in lib/prefs/ingredient-prefs.ts (Addendum)
export function toPlanView(plan: PlanWithSlots, household: Household): PlanView;
export async function getPlanScreen(options?: PlanServiceOptions): Promise<PlanScreenView>;
export async function generatePlan(options?: PlanServiceOptions): Promise<GeneratePlanResult>;
export async function confirmPlan(planId: string, options?: PlanServiceOptions): Promise<PlanResult>;
export async function setSlotLock(planId: string, slotId: string, locked: boolean, options?: PlanServiceOptions): Promise<PlanResult>;
// swapSlot: aggiunto da WP5 in questo stesso file
```
Regole:
- **`loadIngredientPreferences`** (`lib/prefs/ingredient-prefs.ts`, spostata dall'architecture review perché la usa anche `lib/recipes`): in F4 restituisce `EMPTY_INGREDIENT_PREFERENCES` con il commento `// F5 (S2.3): leggere ingredient_prefs e restituire toIngredientPreferenceSets(likes, dislikes)`. F5 la cabla lì e la usa anche in `buildConstraints` (`lib/recipes/constraints.ts`).
- **`toPlanView`**: `created_at`/`generated_at` con `.toISOString()`; `superseded = household.updated_at.getTime() > plan.generated_at.getTime()`; ogni slot `{ id, day, meal, servings, locked, recipe }` (la ricetta `RecipeWithDetails` così com'è); `shopping_list` dal record.
- **Risoluzione di "oggi"**: `today = todayInTimeZone(now(), APP_TIME_ZONE)`; `target = resolveTargetWeek(today)`; `currentWeekStart = mondayOf(today)`.
- **`getPlanScreen`**: `household = await loadHousehold(options.householdId)`; `targetPlan = await findPlanByWeek(db, household.id, target.week_start)`; `displayed = targetPlan ?? (target.week_start !== currentWeekStart ? await findPlanByWeek(db, household.id, currentWeekStart) : null)`; `action = !targetPlan ? 'generate' : targetPlan.status === 'draft' ? 'regenerate' : 'none'`. Restituisce `{ today, plan: displayed ? toPlanView(displayed, household) : null, target, action }`.
- **`generatePlan`** — in quest'ordine:
  1. `household`, `today`, `target` come sopra. `existing = await findPlanByWeek(db, household.id, target.week_start)`. Se `existing?.status === 'active'` → `throw new PlanError('plan_confirmed')`; se `'archived'` → `throw new PlanError('plan_archived')`.
  2. `desired` = per ogni giorno di `listDays(target.first_day, target.last_day)` e per ogni pasto di `MEAL_TYPE_VALUES` incluso in `household.meals`, la coppia `(day, meal)`.
  3. `kept` = slot di `existing` **mantenuti**: quelli con `day < target.first_day` (giorni passati) e quelli `locked` (qualunque giorno). `keptKeys` = chiavi `${day}|${meal}` di `kept`. `toFill` = `desired` senza le chiavi in `keptKeys`, come `PlannerSlot { key: \`${day}|${meal}\`, day, meal }`.
  4. `exclude` = insieme dei `recipe_id` non null di `kept`. `prefs = await loadIngredientPreferences(household.id)`. `rng = options.rng ?? createRng(randomSeed())`.
  5. `select = async () => selectRecipes({ slots: toFill, candidates: await listRecipes({ household_id: household.id }), household, ingredientPrefs: prefs, excludeRecipeIds: exclude, now: now(), rng, config })`.
  6. Ciclo di generazione (**fuori da transazioni**): `result = await select()`; `rounds = 0`, `created = 0`, `llmError = null`, `stop = false`. Finché `result.needMore.length > 0 && rounds < config.maxGenerationRoundsPlan && !stop`: `rounds++`; `outcomes = await Promise.allSettled(result.needMore.map((s) => generate({ householdId: household.id, count: computeGenerationCount(s, config), mealType: s.meal_type })))`; per ogni esito: `fulfilled` → `created += value.created.length`, `createdThisRound += …`; `rejected` → se `!isLlmError(reason)` rilanciare subito `reason`; altrimenti `llmError ??= reason` e `stop = true`. Se `createdThisRound === 0` → `stop = true`. Poi `result = await select()`.
  7. Se qualche `assignment.recipeId === null`: se `llmError` → `throw llmError`; altrimenti `throw new PlanError('insufficient_recipes')`. In entrambi i casi **nulla viene scritto** sul piano.
  8. Transazione `db.transaction(async (tx) => { … })`:
     - `acquirePlanLock(tx, household.id)`; `current = await findPlanByWeek(tx, household.id, target.week_start)`; se `current?.status === 'active'` → `PlanError('plan_confirmed')`; `'archived'` → `PlanError('plan_archived')`.
     - Se `current` è null: `plan = await insertPlan(tx, household.id, target.week_start)`, poi `archivePlansBefore(tx, household.id, target.week_start)`; slot da rimuovere = nessuno.
     - Altrimenti: `touchPlanGeneratedAt(tx, current.id)`; ricalcolare `keptNow` con le regole del punto 3 su `current` (riletto); `deleteSlots(tx, ids degli slot di current non in keptNow)`; `updateSlotsServings(tx, ids degli slot di keptNow con day >= target.first_day, household.persons)`.
     - `insertSlots(tx, planId, …)` per ogni `assignment` la cui chiave **non** è in `keptNow` (chiavi riletto): `{ day, meal, recipe_id, servings: household.persons, locked: false }`.
  9. Restituisce `{ screen: await getPlanScreen(options), generation: { rounds, created, failed: llmError !== null } }`.
- **`confirmPlan(planId)`**: `household = loadHousehold`; `plan = getPlanById(db, planId)`; se null o `plan.household_id !== household.id` → `PlanError('plan_not_found')`; `archived` → `PlanError('plan_archived')`; `active` → restituisce `{ plan: toPlanView(plan, household) }` senza scrivere (idempotente). `draft` → transazione: `setPlanStatus(tx, id, 'active')` + `incrementRecipeUsage(tx, recipe_id distinti non null degli slot)`; poi rilegge e restituisce `{ plan }`.
- **`setSlotLock(planId, slotId, locked)`**: stesse verifiche di appartenenza/`archived` di `confirmPlan`; slot non del piano → `PlanError('slot_not_found')`; `setSlotLocked(db, slotId, locked)`; rilegge e restituisce `{ plan }`. Consentito su `draft` e `active`.

**4. Rotte** (tutte con `export const runtime = 'nodejs'; export const dynamic = 'force-dynamic';`):
- `app/api/plans/route.ts` — `export const maxDuration = 300;` `POST(request)`: `readJsonBody(request, { allowEmpty: true })` → `{ ok: false }` ⇒ `invalidRequestResponse()`; `GeneratePlanRequestSchema.safeParse` fallito ⇒ `invalidRequestResponse(issues)`; `generatePlan()` → 200 con il risultato.
- `app/api/plans/current/route.ts` — `GET()`: `getPlanScreen()` → 200.
- `app/api/plans/[id]/confirm/route.ts` — `POST(_request, { params })`: `id` non UUID (`z.string().uuid().safeParse`) ⇒ risposta di `PlanError('plan_not_found')`; `confirmPlan(id)` → 200.
- `app/api/plans/[id]/slots/[slotId]/route.ts` — `PATCH(request, { params })`: `id` non UUID ⇒ `plan_not_found`; `slotId` non UUID ⇒ `slot_not_found`; body con `readJsonBody(request, { allowEmpty: false })` + `UpdateSlotRequestSchema` (400 come sopra); `setSlotLock(id, slotId, locked)` → 200.
- Gestione errori comune tramite l'helper `export function handlePlanRouteError(err: unknown, tag: string): Response` in `lib/plans/http.ts` (file nuovo di questo WP, usato da tutte le rotte dei piani): `isPlanError(err)` → `errorResponse(PLAN_ERROR_HTTP[code].status, code, message)` senza log; altrimenti `console.error(tag, err)` e poi `llmErrorResponse(err) ?? internalErrorResponse()`. `tag` = `'[api/plans]'`, `'[api/plans/current]'`, `'[api/plans/confirm]'`, `'[api/plans/slots]'`. Il corpo d'errore non contiene mai stack trace né messaggi interni.

**5. `lib/plans/client.ts`** (nessun import dal DB; copiare la gestione errori di `lib/settings/client.ts`):
```ts
export class PlanRequestError extends Error { readonly status: number; readonly code: string; /* name = 'PlanRequestError' */ }
export async function fetchPlanScreen(): Promise<PlanScreenView>;                                   // GET  /api/plans/current
export async function requestGeneratePlan(): Promise<GeneratePlanResult>;                          // POST /api/plans, body '{}'
export async function requestConfirmPlan(planId: string): Promise<PlanResult>;                     // POST /api/plans/{planId}/confirm
export async function requestSlotLock(planId: string, slotId: string, locked: boolean): Promise<PlanResult>;          // PATCH /api/plans/{planId}/slots/{slotId}, body { locked }
export async function requestSwapSlot(planId: string, slotId: string, excludeRecipeIds: string[]): Promise<PlanMutationResult>; // POST /api/plans/{planId}/slots/{slotId}/swap, body { exclude_recipe_ids }
```
Un helper interno `requestJson<T>(url, init, schema: z.ZodType<T>)`: errore di rete → `PlanRequestError(0, 'network_error', 'Connessione non disponibile.')`; non-2xx → `code`/`message` dal corpo `{ error }` oppure `('unknown_error', 'Qualcosa è andato storto. Riprova.')`; 2xx non conforme a `schema` (`safeParse`) o JSON illeggibile → `('invalid_response', 'Risposta del server non valida.')`. Header `content-type: application/json` quando c'è un body. `requestSwapSlot` è usato da WP6 e la rotta arriva con WP5: il contratto è quello di WP5.

**6. Test:**
- `tests/http/responses.test.ts`: `readJsonBody` con body vuoto (entrambe le opzioni), `'{'`, `'{"a":1}'`; `llmErrorResponse` per i 4 codici e per `new Error()` (→ `null`); `invalidRequestResponse` con e senza issues.
- `tests/plans/service.test.ts` (`// @vitest-environment node`, DB, household dedicati via `createTestHousehold`, ricette via `insertTestRecipes`; `now` fisso; `rng: createRng(1)`; `generate` sempre iniettato con `vi.fn`):
  - Costanti: `WED = () => new Date('2026-09-30T10:00:00Z')` (settimana 28/09, dal 30/09: 5 giorni); `SAT = () => new Date('2026-10-03T09:00:00Z')` (settimana 05/10 completa); `MON = () => new Date('2026-09-28T08:00:00Z')`.
  1. **Libreria ricca, zero LLM**: household pranzo+cena, 12 ricette solo pranzo e 12 solo cena; `generatePlan({ householdId, now: WED, rng, generate })` → `generate` mai chiamato; `screen.plan.slots.length === 10`, giorni dal 30/09 al 04/10, ricette tutte diverse, `servings === persons`, `status 'draft'`, `screen.action === 'regenerate'`, `generation` `{ rounds: 0, created: 0, failed: false }`.
  2. **DB quasi vuoto**: household senza ricette; `generate` finto che inserisce `count` ricette con `meal_types: [mealType]` e le restituisce in `created` → chiamato 2 volte (`mealType` `'pranzo'` e `'cena'`, `count: 9` ciascuno, `householdId` dell'household); piano con 10 slot pieni; `generation.rounds === 1`, `created === 18`.
  3. **Tetto dei giri**: household solo cena con 3 ricette, `generate` finto che crea 1 ricetta per chiamata → chiamato esattamente 2 volte; piano creato con 5 slot; `generation.rounds === 2`.
  4. **LLM fallito ma libreria sufficiente**: solo cena, 6 ricette (5 slot, `required` 7), `generate` che rifiuta con `new LlmError('provider', 'x')` → piano creato; `generation` `{ rounds: 1, created: 0, failed: true }`.
  5. **LLM fallito e libreria insufficiente**: solo cena, 3 ricette → la promessa rifiuta con **quella** `LlmError`; `findPlanByWeek(db, householdId, '2026-09-28')` → `null`.
  6. **Nessuna ricetta generata**: solo cena, 3 ricette, `generate` che restituisce `created: []` → `PlanError` `insufficient_recipes`; nessun piano scritto.
  7. **Errore non LLM dalla generazione** (`new Error('db')`) → la promessa rifiuta con quell'errore.
  8. **Weekend**: `now: SAT` → piano con `week_start '2026-10-05'` e 14 slot; un piano `draft` pre-inserito per `'2026-09-28'` diventa `archived`.
  9. **Rigenerazione con slot bloccato e giorni passati** (household pranzo+cena, 12 ricette solo pranzo e 12 solo cena): genera con `MON` (14 slot), blocca con `setSlotLock` lo slot `2026-10-01|cena`, rigenera con `WED` → gli slot del 28 e 29/09 e quello bloccato hanno **stesso id e stessa ricetta**; gli altri slot hanno id nuovi; nessuna ricetta ripetuta nel piano; `generated_at` aumentato; 14 slot in totale.
  10. **Porzioni e pasti aggiornati** (nello **stesso `it`** del test 9, perché gli household si eliminano in `afterEach`): dopo i passi del test 9, `updateHousehold({ persons: 4, meals: ['cena'] }, householdId)` e rigenera con `WED` → gli slot futuri di pranzo non bloccati spariscono, i futuri hanno `servings: 4` (compreso lo slot bloccato), quelli passati restano invariati.
  11. **Piano confermato**: `confirmPlan` e poi `generatePlan` → `PlanError` `plan_confirmed`; `getPlanScreen` → `action: 'none'`.
  12. **Conferma**: dopo la conferma `status 'active'`, ogni ricetta del piano ha `times_used` +1 e `last_used_at` valorizzato; seconda conferma → nessun cambiamento di `times_used`.
  13. **Blocco**: `setSlotLock(planId, slotId, true)` → `plan.slots` riporta `locked: true`; `setSlotLock` con piano di un altro household → `plan_not_found`; con slot di un altro piano → `slot_not_found`; su piano `archived` → `plan_archived`.
  14. **Schermata**: nessun piano con `WED` → `{ plan: null, action: 'generate', target: { week_start: '2026-09-28', first_day: '2026-09-30', last_day: '2026-10-04' } }`; con un piano della settimana 28/09 e `SAT` → mostra quel piano, `action: 'generate'`, `target.week_start '2026-10-05'`; dopo aver generato con `SAT` → mostra il piano del 05/10.
  15. **Superato**: dopo la generazione `plan.superseded === false`; dopo `updateHousehold(...)` → `true`; dopo una rigenerazione → di nuovo `false`.
- `tests/api/plans.test.ts` (`// @vitest-environment node`, `vi.mock('@/lib/plans/service', () => ({ getPlanScreen: vi.fn(), generatePlan: vi.fn(), confirmPlan: vi.fn(), setSlotLock: vi.fn() }))`): per ciascuna rotta 200 con il valore del mock; `runtime`/`dynamic` (e `maxDuration === 300` per `POST /api/plans`); `POST /api/plans` con body vuoto → servizio chiamato; con `'{'` e con `{ week_start: 'x' }` → 400 `invalid_request`; `id` non UUID → 404 `plan_not_found`; `slotId` non UUID → 404 `slot_not_found`; `PATCH` con `{ locked: 'si' }` → 400; ogni `PlanErrorCode` → status/`code`/`message` della tabella; `LlmError('timeout')` → 504 `llm_timeout`; `new Error('boom')` → 500 `internal_error` e il corpo non contiene `boom`. `params` si passa come `{ params: Promise.resolve({ id, slotId }) }`.
- `tests/plans/client.test.ts` (fetch mockato come in `tests/settings/client.test.ts`): URL, metodo e body di ciascuna funzione; 422 con `{ error: { code: 'no_alternatives', message } }` → `PlanRequestError` con quello status/codice/messaggio; fetch che lancia → `network_error`; 200 con corpo non conforme → `invalid_response`.

**7. `docs/ARCHITECTURE.md` §6:** la riga `GET /api/plans/current` diventa "Schermata del Piano: piano mostrato, settimana obiettivo e azione disponibile"; aggiungere `| PATCH | /api/plans/:id/slots/:slotId | Blocca/sblocca lo slot (`{ locked }`) |` dopo la riga dello swap.

### Contratti esposti
- `@/lib/plans/errors`: `PLAN_ERROR_CODES`, `PlanErrorCode`, `PLAN_ERROR_HTTP`, `PlanError`, `isPlanError`.
- `@/lib/plans/http`: `handlePlanRouteError(err, tag)` (usato anche dalla rotta swap di WP5).
- `@/lib/http/responses`: `errorResponse`, `invalidRequestResponse`, `internalErrorResponse`, `llmErrorResponse`, `readJsonBody`.
- `@/lib/plans/service`: `PlanServiceOptions`, `GenerateRecipesFn`, `toPlanView`, `getPlanScreen`, `generatePlan`, `confirmPlan`, `setSlotLock`.
- `@/lib/plans/client`: `PlanRequestError`, `fetchPlanScreen`, `requestGeneratePlan`, `requestConfirmPlan`, `requestSlotLock`, `requestSwapSlot`.
- HTTP:
  - `GET /api/plans/current` → 200 `PlanScreenView`
  - `POST /api/plans` (body vuoto o `{}`) → 200 `GeneratePlanResult`; 409 `plan_confirmed` / `plan_archived`; 422 `insufficient_recipes`; errori LLM (500/502/504) solo se la libreria non basta e l'LLM fallisce
  - `POST /api/plans/:id/confirm` → 200 `PlanResult`; 404 `plan_not_found`; 409 `plan_archived`
  - `PATCH /api/plans/:id/slots/:slotId` `{ locked: boolean }` → 200 `PlanResult`; 400; 404 `plan_not_found` / `slot_not_found`; 409 `plan_archived`
  - Errori sempre `{ error: { code, message, details? } }`.

### Dipendenze
WP1 (tipi, planner, week, rng, config) e WP2 (repository, migrazione, helper di test).

### Criteri di accettazione (S3.2)
- Da DB quasi vuoto una chiamata produce un piano completo con generazione automatica (test 2); da libreria ricca zero chiamate LLM (test 1).
- La conferma aggiorna `times_used`/`last_used_at` una sola volta (test 12); la rigenerazione rispetta gli slot bloccati (test 9).
- `tests/api/recipes-generate.test.ts` verde senza modifiche; gate verde.

### Fuori scope
Swap (WP5), UI (WP4, WP6), creazione della lista della spesa (F6), rigenerazione di piani confermati (requirements U3), preferenze ricetta (F5).

---

## WP4 — Mattoni della UI del Piano (wave 2, parallelo a WP3)

**Obiettivo:** preparare formattazione, toast, stato di generazione, long-press e azioni sostitutive sulla `MealCard`, barra azioni condizionale della `RecipeSheet` e CSS del flip, senza ancora montare la pagina.

### File
- `lib/plans/format.ts` — nuovo
- `components/feedback/toast.tsx` — nuovo
- `components/plan/generation-progress.tsx` — nuovo
- `components/cards/meal-card.tsx` — **modifica**
- `components/sheets/recipe-sheet.tsx` — **modifica**
- `app/globals.css` — **modifica** (aggiunta in coda)
- `tests/plans/format.test.ts`, `tests/ui/toast.test.tsx`, `tests/ui/generation-progress.test.tsx`, `tests/ui/meal-card-plan.test.tsx` — nuovi

### Pattern di riferimento
- Componenti client con `"use client"`, `cn`, classi Tailwind dei token come `components/cards/meal-card.tsx` e `components/feedback/empty-state.tsx`.
- Test UI come `tests/ui/settings-fields.test.tsx` e i blocchi "MealCard"/"RecipeSheet" di `tests/ui/shell.test.tsx` (che **devono restare verdi**).

### Passi

**1. `lib/plans/format.ts`** (puro, senza `Intl`, sicuro per il client):
```ts
export const IT_WEEKDAYS = ['Lunedì', 'Martedì', 'Mercoledì', 'Giovedì', 'Venerdì', 'Sabato', 'Domenica'] as const;
export const IT_MONTHS_SHORT = ['gen', 'feb', 'mar', 'apr', 'mag', 'giu', 'lug', 'ago', 'set', 'ott', 'nov', 'dic'] as const;
export function formatDayLabel(isoDate: string): string;             // '2026-09-30' → 'Mercoledì 30'
export function formatWeekRange(first: string, last: string): string; // ('2026-09-28','2026-10-04') → '28 set – 4 ott'
export function recipeChips(recipe: Recipe): string[];
export function toRecipeDetail(recipe: Recipe, servings: number): RecipeDetail; // import type { RecipeDetail } from '@/components/sheets/recipe-sheet'
```
- `formatDayLabel`: giorno della settimana da `isoWeekday` (`@/lib/domain/week`), numero del giorno senza zero iniziale.
- `formatWeekRange`: `${d1} ${mese1} – ${d2} ${mese2}` sempre con entrambi i mesi (es. `'5 – 11 ott'` **non** si usa: `'5 ott – 11 ott'`).
- `recipeChips`: fino a 2 etichette `MEAL_STYLE_TAG_LABELS` dei `tags` nell'ordine della ricetta, poi al massimo 1 etichetta `DIET_FLAG_LABELS` della prima dieta presente secondo la priorità `['vegano', 'vegetariano', 'pescetariano', 'senza-glutine', 'senza-lattosio']`.
- `toRecipeDetail`: `{ id, title, description, prepTimeMinutes: prep_minutes, servings, tags: recipeChips(recipe), ingredients, steps, rating: prefs?.rating ?? undefined, isFavorite: prefs?.favorite ?? false, isBlocked: prefs?.blocked ?? false }`; ogni ingrediente `{ id: ing.id ?? \`${recipe.id}:${index}\`, name: display_name, amount: qty == null ? 0 : Math.round((qty * servings / servings_base) * 10) / 10, unit }` (con `amount` 0 la sheet mostra solo l'unità, es. `qb`).

**2. `components/feedback/toast.tsx`** (`"use client"`):
```tsx
export interface ToastProps { message: string | null; onDismiss: () => void; durationMs?: number } // default 3000
export function Toast(props: ToastProps): JSX.Element | null;
```
`message` null → `null`. Altrimenti `<div role="status" aria-live="polite" className="pointer-events-none fixed inset-x-0 bottom-24 z-50 flex justify-center px-4">` con dentro `<div className="pointer-events-auto rounded-xl bg-ink px-4 py-3 text-sm font-medium text-paper shadow-lg">{message}</div>`. `useEffect` su `message`: `setTimeout(onDismiss, durationMs)` con cleanup.

**3. `components/plan/generation-progress.tsx`** (`"use client"`):
```tsx
export const GENERATION_MESSAGES = [
  'Sto sfogliando il ricettario…',
  'Accendo i fornelli…',
  'Controllo la dispensa…',
  'Assaggio il sugo…',
  'Apparecchio la tavola…',
] as const;
export const GENERATION_MESSAGE_INTERVAL_MS = 2500;
export function useRotatingMessage(messages: readonly string[], intervalMs?: number, active?: boolean): string;
export interface GenerationProgressProps { cards?: number; className?: string } // cards default 4, limitato a 1..6
export function GenerationProgress(props: GenerationProgressProps): JSX.Element;
```
- `useRotatingMessage`: parte dal primo messaggio; con `active` (default `true`) avanza ogni `intervalMs` (default `GENERATION_MESSAGE_INTERVAL_MS`) in modo circolare; con `active` false resta sul primo e riparte da lì quando torna true.
- `GenerationProgress`: contenitore `role="status" aria-live="polite"` con `<p className="text-sm font-medium text-stone">{messaggio}</p>` e `cards` skeleton `aria-hidden="true"` (card `rounded-xl border border-stone/20 bg-white p-4` con tre barre `bg-stone/15 rounded` e classe `motion-safe:animate-pulse`). Mai uno spinner.

**4. `components/cards/meal-card.tsx`** — modifiche **retrocompatibili** (i test esistenti restano verdi):
- Nuove props: `onLongPress?: (id: string) => void`, `actions?: React.ReactNode`.
- **★ solo con handler**: il pulsante preferita si renderizza solo se `onToggleFavorite` è definito (requirements U4). Se `onToggleFavorite` manca, il footer allinea il solo pulsante *Cambia* a sinistra.
- **`actions`**: se definito, sostituisce **l'intero** footer (Cambia + ★) mantenendo il contenitore `mt-3 flex items-center justify-between border-t border-stone/15 pt-2`.
- **Long-press** (solo se `onLongPress` è definito), sul `Card` radice: costante esportata `LONG_PRESS_MS = 500`. `onPointerDown` (solo `e.button === 0`) salva le coordinate e avvia un timer; `onPointerMove` con spostamento > 10 px, `onPointerUp`, `onPointerLeave`, `onPointerCancel` annullano il timer; allo scadere: `onLongPress(id)`, `navigator.vibrate?.(10)` e un ref `suppressNextClick = true`. Il click sul contenuto (`onSelect`) consuma `suppressNextClick` e in quel caso non chiama `onSelect`. Con `onLongPress` definito aggiungere al `Card` `select-none`, `style={{ WebkitTouchCallout: 'none' }}` e `onContextMenu={(e) => e.preventDefault()}`. Timer ripulito allo smontaggio.
- Aggiungere `data-testid={\`meal-card-${id}\`}` al `Card` radice.
- Il pulsante lucchetto resta invariato (alternativa accessibile al long-press).

**5. `components/sheets/recipe-sheet.tsx`:** la barra azioni (voto, Preferita, Non proporre più) si renderizza **solo** se almeno uno tra `onRate`, `onToggleFavorite`, `onToggleBlock` è definito. Nient'altro cambia.

**6. `app/globals.css`** — aggiungere in coda:
```css
/* Swap della card-pasto (DESIGN §3); con reduced-motion degrada a dissolvenza (DESIGN §6) */
@keyframes meal-flip {
  from { transform: perspective(800px) rotateY(80deg); opacity: 0.3; }
  to { transform: perspective(800px) rotateY(0deg); opacity: 1; }
}
@keyframes meal-fade {
  from { opacity: 0; }
  to { opacity: 1; }
}
.animate-meal-flip { animation: meal-flip 320ms ease-out both; }
@media (prefers-reduced-motion: reduce) {
  .animate-meal-flip { animation: meal-fade 200ms ease-out both; }
}
```
Non toccare le righe verificate da `tests/verification.test.ts`.

**7. Test:**
- `tests/plans/format.test.ts`: `formatDayLabel('2026-09-30')` → `'Mercoledì 30'`, `('2026-10-04')` → `'Domenica 4'`; `formatWeekRange('2026-09-28','2026-10-04')` → `'28 set – 4 ott'`; `recipeChips` con `tags ['veloce','proteico','leggero']` e `diet_flags ['vegetariano','pescetariano']` → `['Veloce', 'Proteico', 'Vegetariano']`; `toRecipeDetail` con `servings_base 2`, `servings 3`, ingrediente `qty 150` → `amount 225`; `qty null` → `amount 0`; prefs null → `isFavorite false`.
- `tests/ui/toast.test.tsx` (fake timers): messaggio visibile con `role="status"`; `onDismiss` chiamato dopo 3000 ms; `message null` → nulla.
- `tests/ui/generation-progress.test.tsx` (fake timers): primo messaggio `Sto sfogliando il ricettario…`; dopo 2500 ms `Accendo i fornelli…`; `cards={9}` → 6 skeleton; nessun elemento con ruolo `progressbar`.
- `tests/ui/meal-card-plan.test.tsx` (fake timers): senza `onToggleFavorite` nessun pulsante "Aggiungi ai preferiti"; `pointerDown` + 500 ms → `onLongPress('meal-1')`, e il click successivo sul titolo **non** chiama `onSelect`; `pointerDown` + `pointerUp` a 300 ms → nessun long-press e il click chiama `onSelect`; `actions={<button>Tieni</button>}` → "Tieni" presente e "Cambia …" assente.

### Contratti esposti
`@/lib/plans/format`: `IT_WEEKDAYS`, `IT_MONTHS_SHORT`, `formatDayLabel`, `formatWeekRange`, `recipeChips`, `toRecipeDetail`. `@/components/feedback/toast`: `Toast`. `@/components/plan/generation-progress`: `GENERATION_MESSAGES`, `GENERATION_MESSAGE_INTERVAL_MS`, `useRotatingMessage`, `GenerationProgress`. `MealCard`: nuove props `onLongPress`, `actions`, costante `LONG_PRESS_MS`, `data-testid`. Classe CSS `animate-meal-flip`.

### Dipendenze
WP1 (tipi `Recipe`, `isoWeekday`). Nessuna dipendenza da WP3.

### Criteri di accettazione
- Test nuovi verdi; blocchi "MealCard" e "RecipeSheet" di `tests/ui/shell.test.tsx` verdi senza modifiche.
- Con `prefers-reduced-motion: reduce` l'animazione dello swap è una dissolvenza.

### Fuori scope
Pagina Piano e chiamate API (WP6), preferenze ricetta e ingredienti (F5), toast globale o provider di contesto.

---

## WP5 — Swap di uno slot (wave 3, parallelo a WP6)

**Obiettivo:** sostituire la ricetta di uno slot senza mai riproporre ricette del piano o già scartate, generando nuove ricette solo se non resta alternativa.

### File
- `lib/plans/service.ts` — **modifica** (aggiunta di `swapSlot`, nessun'altra modifica)
- `app/api/plans/[id]/slots/[slotId]/swap/route.ts` — nuovo
- `tests/plans/swap.test.ts`, `tests/api/plans-swap.test.ts` — nuovi

### Pattern di riferimento
`generatePlan` e `setSlotLock` in `lib/plans/service.ts` (WP3); rotte e test di WP3.

### Passi

**1. `swapSlot`:**
```ts
export async function swapSlot(planId: string, slotId: string, request: SwapSlotRequest, options?: PlanServiceOptions): Promise<PlanMutationResult>;
```
In quest'ordine:
1. `household`, `plan = getPlanById(db, planId)`: assente o di altro household → `PlanError('plan_not_found')`; `archived` → `PlanError('plan_archived')`; slot non del piano → `PlanError('slot_not_found')`; `slot.locked` → `PlanError('slot_locked')`.
2. `exclude` = tutti i `recipe_id` non null degli slot del piano (compreso quello attuale) ∪ `request.exclude_recipe_ids`.
3. `select` come in `generatePlan` con `slots: [{ key: slot.id, day: slot.day, meal: slot.meal }]`, stesse preferenze ingredienti (`loadIngredientPreferences`), stesso `rng`/`now`/`config`.
4. Se l'assegnazione è `null` e `config.maxGenerationRoundsSwap > 0`: **fuori da transazioni** `generate({ householdId: household.id, count: config.generationMin, mealType: slot.meal })`; `rounds = 1`; esito rifiutato → se `!isLlmError` rilanciare, altrimenti `llmError = reason`; esito ok → `created = value.created.length`; poi riselezionare. **Non** si genera se l'assegnazione esiste (anche se è un ripiego a peso 0).
5. Ancora `null` → `throw llmError ?? new PlanError('no_alternatives')`.
6. Transazione: `acquirePlanLock(tx, household.id)`; rileggere il piano con `getPlanById(tx, planId)` e ricontrollare `archived`/slot/`locked` (stessi errori); `updateSlotRecipe(tx, slotId, recipeId)`; se `plan.status === 'active'` → `incrementRecipeUsage(tx, [recipeId])` (la ricetta sostituita **non** viene decrementata); `markShoppingListStale(tx, planId)`.
7. Rileggere e restituire `{ plan: toPlanView(piano, household), generation: { rounds, created, failed: llmError !== null } }`.

**2. Rotta** `app/api/plans/[id]/slots/[slotId]/swap/route.ts`: `runtime = 'nodejs'`, `dynamic = 'force-dynamic'`, `maxDuration = 120`. `POST(request, { params })`: `id`/`slotId` non UUID → `plan_not_found`/`slot_not_found`; `readJsonBody(request, { allowEmpty: true })` + `SwapSlotRequestSchema` (400 `invalid_request` con `details`); `swapSlot(id, slotId, parsed.data)` → 200; errori con `handlePlanRouteError(err, '[api/plans/swap]')`.

**3. Test:**
- `tests/plans/swap.test.ts` (DB, come `tests/plans/service.test.ts`; piano creato con `generatePlan` e `now: WED`, passando a `generatePlan` un `generate` finto che restituisce `{ requested: count, created: [], skipped: [] }`, così il piano usa solo la libreria del test; lo swap riceve un **altro** `generate` finto, specifico del caso):
  1. **Mai ripetizioni**: household solo cena, 12 ricette, piano di 5 slot (`WED`); 5 swap consecutivi sullo stesso slot passando ogni volta l'accumulo delle ricette scartate (quella iniziale + ogni nuova) → ogni nuova ricetta non è mai tra quelle del piano né tra le scartate; `generate` mai chiamato.
  2. **Generazione quando non resta nulla**: solo cena, 5 ricette, piano di 5 slot → uno swap chiama `generate` con `{ count: 3, mealType: 'cena', householdId }`; la nuova ricetta è una di quelle create; `generation` `{ rounds: 1, created: 3, failed: false }`.
  3. `generate` che restituisce `created: []` → `PlanError` `no_alternatives`, slot invariato; `generate` che rifiuta con `LlmError('timeout', 'x')` → la promessa rifiuta con quella `LlmError`.
  4. Slot bloccato → `slot_locked`; piano archiviato → `plan_archived`; slot inesistente → `slot_not_found`; piano di un altro household → `plan_not_found`.
  5. **Piano confermato**: dopo `confirmPlan`, lo swap porta `times_used` della nuova ricetta da 0 a 1 e lascia invariato quello della ricetta sostituita (che resta a 1).
  6. **Lista della spesa**: senza lista → nessuna riga in `shopping_lists` dopo lo swap; con una riga inserita a mano in `shopping_lists` per il piano → `plan.shopping_list.needs_regeneration === true`.
- `tests/api/plans-swap.test.ts` (servizio mockato): 200 con il risultato; body vuoto → servizio chiamato con `{ exclude_recipe_ids: [] }`; `{ exclude_recipe_ids: ['x'] }` → 400 con `details`; id non UUID → 404; `PlanError('slot_locked')` → 409 con il messaggio della tabella; `LlmError('provider')` → 502 `llm_unavailable`; `maxDuration === 120`.

### Contratti esposti
- `swapSlot` in `@/lib/plans/service`.
- `POST /api/plans/:id/slots/:slotId/swap` body `{ "exclude_recipe_ids"?: uuid[] (max 50) }` → 200 `PlanMutationResult`; 400; 404 `plan_not_found` / `slot_not_found`; 409 `plan_archived` / `slot_locked` / `slot_past` (giorno già passato, aggiunto dalla code review, Q1); 422 `no_alternatives`; errori LLM solo se non resta alternativa e la generazione fallisce.
- **Per F6:** dopo uno swap `needs_regeneration` è `true` se la lista esiste.

### Dipendenze
WP3 (servizio, errori, helper HTTP, `toPlanView`), WP2 (repository), WP1.

### Criteri di accettazione (S3.3)
- Swap ripetuti non ripropongono mai la stessa ricetta nella settimana (test 1).
- Lista esistente ⇒ flag "da rigenerare" (test 6). Gate verde.

### Fuori scope
UI dello swap (WP6), rigenerazione della lista (F6), decremento dell'uso della ricetta sostituita.

---

## WP6 — Pagina Piano (wave 3, parallelo a WP5)

**Obiettivo:** sostituire la home con dati finti con la pagina Piano reale: genera/rigenera, card per giorno con swap animato (*Tieni / Cambia ancora*), blocco con long-press, conferma e dettaglio ricetta.

### File
- `components/plan/plan-slot-card.tsx` — nuovo
- `components/plan/plan-screen.tsx` — nuovo
- `app/(app)/page.tsx` — **riscrittura** (pagina server; eliminare tutti i dati finti)
- `tests/home.test.tsx` — **riscrittura**
- `tests/ui/shell.test.tsx` — **modifica** (solo il test "renders Home (Piano) page with week title and meals" e il relativo import)
- `tests/ui/plan-slot-card.test.tsx`, `tests/ui/plan-screen.test.tsx` — nuovi

### Pattern di riferimento
- Pagina server: `app/(app)/impostazioni/page.tsx`; test di pagina server: `tests/app/settings-page.test.tsx`.
- Componente client con stato e chiamate fetch: `components/settings/settings-editor.tsx`.
- Mattoni di WP4 (`MealCard` con `actions`/`onLongPress`, `Toast`, `GenerationProgress`, `useRotatingMessage`, `format.ts`), `EmptyState`, `RecipeSheet`, `Button`, `Badge`.

### Passi

**1. `app/(app)/page.tsx`:**
```tsx
import { connection } from "next/server";
import { PlanScreen } from "@/components/plan/plan-screen";
import { getPlanScreen } from "@/lib/plans/service";

export default async function PlanPage() {
  await connection();
  const screen = await getPlanScreen();
  return <PlanScreen initialScreen={screen} />;
}
```

**2. `components/plan/plan-slot-card.tsx`** (`"use client"`):
```tsx
export interface PlanSlotCardProps {
  planId: string;
  slot: PlanSlotView;
  editable: boolean;                          // false → niente Cambia, lucchetto e long-press
  onPlanChange: (plan: PlanView) => void;      // dopo uno swap riuscito
  onToggleLock: (slotId: string) => void;
  onSelectRecipe: (slot: PlanSlotView) => void;
  onError: (message: string) => void;          // mostrato come toast dal genitore
}
export function PlanSlotCard(props: PlanSlotCardProps): JSX.Element;
```
Stato: `mode: 'idle' | 'swapping' | 'review'`, `rejected: string[]` (id di ricette scartate nella sequenza corrente), `lastMode` per il ripristino.
- Props passate a `MealCard`: `id = slot.id`, `day = formatDayLabel(slot.day)` **solo il nome del giorno** (prima parola, es. `Mercoledì`), `mealType = MEAL_TYPE_LABELS[slot.meal]`, `title = slot.recipe?.title ?? 'Ricetta non disponibile'`, `prepTimeMinutes = slot.recipe?.prep_minutes`, `tags = slot.recipe ? recipeChips(slot.recipe) : []`, `isLocked = slot.locked`, `onSelect` solo se `slot.recipe` (→ `onSelectRecipe(slot)`), `onSwap` / `onToggleLock` / `onLongPress` solo se `editable` (`onLongPress` e `onToggleLock` → `onToggleLock(slot.id)`). **Mai** `onToggleFavorite` (U4).
- **Swap** (`Cambia` in idle o `Cambia ancora` in review; ignorato se `slot.locked` o `mode === 'swapping'`): `exclude = [...rejected, ...(slot.recipe ? [slot.recipe.id] : [])]` deduplicato, tenendo solo gli ultimi `SWAP_EXCLUDE_MAX`; `mode = 'swapping'`; `requestSwapSlot(planId, slot.id, exclude)`; successo → `rejected = exclude`, `onPlanChange(result.plan)`, `mode = 'review'`; errore (`PlanRequestError`) → `onError(err.message)`, `mode` torna a quello precedente (idle o review), `rejected` invariato.
- In `swapping`: `MealCard` con `actions` = `<p role="status" className="flex min-h-[44px] items-center text-sm font-medium text-stone">{useRotatingMessage(["Cerco un'alternativa…", ...GENERATION_MESSAGES], GENERATION_MESSAGE_INTERVAL_MS, mode === 'swapping')}</p>`.
- In `review`: la `MealCard` è avvolta in `<div key={slot.recipe?.id ?? 'none'} className="animate-meal-flip">` (il cambio di `key` riavvia l'animazione) e riceve `actions` con due pulsanti `min-h-[44px]`: **`Tieni`** (stile `Button` variante `outline`, testo basil) → `mode = 'idle'`, `rejected = []`; **`Cambia ancora`** (testo `tomato`, icona `RefreshCw`) → nuovo swap.
- Se lo slot diventa `locked` mentre è in review → torna a idle.

**3. `components/plan/plan-screen.tsx`** (`"use client"`):
```tsx
export interface PlanScreenProps { initialScreen: PlanScreenView }
export function PlanScreen(props: PlanScreenProps): JSX.Element;
```
Stato: `screen`, `isGenerating`, `generateError: string | null`, `isConfirming`, `toast: string | null`, `sheetSlot: PlanSlotView | null`.

Struttura (dall'alto), dentro `<main className="mx-auto min-h-screen max-w-xl px-4 py-6">`:
1. `<header className="mb-6">` con `<h1 className="font-display text-3xl font-bold text-ink">Mealy</h1>` e `<p className="text-sm text-stone">Cosa mangio oggi?</p>` (niente pillole colorate del mock).
2. Riga titolo: `<h2 className="font-display text-xl font-bold text-ink">Piano Settimanale</h2>`; sotto `Settimana {range}` con `range = plan ? formatWeekRange(plan.week_start, addDays(plan.week_start, 6)) : formatWeekRange(target.first_day, target.last_day)`; se c'è un piano, `Badge` `Bozza` (draft) o `Confermato` (active). A destra il pulsante: `action === 'generate'` → **`Genera piano`** (icona `Sparkles`); `'regenerate'` → **`Rigenera`** (icona `RefreshCw`); `'none'` → nessun pulsante. Disabilitato durante `isGenerating`. Se `action === 'generate'` e c'è un piano con `week_start !== target.week_start` → sotto il pulsante `Prossima settimana: {formatWeekRange(target.first_day, target.last_day)}` (`text-xs text-stone`).
3. Avviso piano superato (se `plan?.superseded`), riquadro `rounded-xl border border-saffron/40 bg-saffron/10 p-3 text-sm text-ink`: se `plan.status === 'draft'` e `action === 'regenerate'` → `Hai cambiato le impostazioni: rigenera il piano per applicarle.`; altrimenti → `Le nuove impostazioni varranno dal prossimo piano.`.
4. Errore di generazione (se `generateError`): `<div role="alert" className="rounded-xl border border-tomato/40 bg-tomato/10 p-3 text-sm text-ink">{generateError}</div>`.
5. Corpo:
   - `isGenerating` → `<GenerationProgress cards={4} />`.
   - nessun piano → `EmptyState` con `title="Nessun piano in programma"`, `description="Genera il piano: sceglierò dalla tua libreria e, se serve, creerò ricette nuove."`, `actionLabel="Genera piano"`, `onAction` = genera (solo se `action !== 'none'`).
   - piano → sezioni per giorno nell'ordine degli slot: `<section>` con `<h3 className="font-display text-lg font-bold text-ink">{formatDayLabel(day)}</h3>` e le `PlanSlotCard` del giorno (`gap-3`); sezioni separate da `gap-6`. `editable = plan.status !== 'archived'`.
6. Footer (solo con piano e non durante la generazione), `<div className="sticky bottom-[calc(4rem+env(safe-area-inset-bottom))] z-30 -mx-4 mt-6 bg-paper/95 px-4 py-3 backdrop-blur">`: `draft` → `Button` a tutta larghezza `h-12` **`Conferma piano`** (disabilitato durante `isConfirming`); `active` → ``Link href={`/lista?piano=${plan.id}`}`` con `Button` **`Crea lista della spesa`** (icona `ShoppingBag`).
7. `RecipeSheet` con `recipe = sheetSlot?.recipe ? toRecipeDetail(sheetSlot.recipe, sheetSlot.servings) : null`, `isOpen = sheetSlot !== null`, `onClose` → `null`; **nessun** handler di preferenze (U4).
8. `<Toast message={toast} onDismiss={() => setToast(null)} />`.

Azioni:
- **Genera/Rigenera**: `isGenerating = true`, `generateError = null`; `requestGeneratePlan()` → `screen = result.screen`, toast `Piano generato` (se `result.generation.failed` → `Piano generato con le ricette della libreria.`); errore → `generateError = err.message`; infine `isGenerating = false`.
- **Conferma**: `isConfirming = true`; `requestConfirmPlan(plan.id)` → `screen.plan = result.plan`, toast `Piano confermato`; errore → toast con `err.message`; infine `isConfirming = false`.
- **Blocco** (`onToggleLock(slotId)`): aggiornamento ottimistico di `locked` nello slot; `requestSlotLock(plan.id, slotId, nuovoValore)` → `screen.plan = result.plan`; errore → ripristino del valore precedente e toast con `err.message`.
- **Swap riuscito** (`onPlanChange`) → `screen.plan = plan`. **Errori delle card** (`onError`) → toast.

**4. Test:**
- `tests/home.test.tsx` — riscrivere sul modello di `tests/app/settings-page.test.tsx` (`// @vitest-environment node`, `vi.mock("next/server", …)`, `vi.mock("@/lib/plans/service", () => ({ getPlanScreen: vi.fn() }))`): la pagina chiama `connection` e `getPlanScreen` una volta e restituisce un elemento di tipo `PlanScreen` con `initialScreen` uguale al valore del mock.
- `tests/ui/shell.test.tsx` — sostituire l'import `Home from "@/app/(app)/page"` con `PlanScreen` da `@/components/plan/plan-screen` e il test "renders Home (Piano) page with week title and meals" con `render(<PlanScreen initialScreen={PLAN_SCREEN_FIXTURE} />)` che verifica h1 `Mealy`, `Cosa mangio oggi?`, `Piano Settimanale` e il titolo di una ricetta del fixture. `PLAN_SCREEN_FIXTURE` è costruito nel file (piano `draft` con 2 slot usando due elementi di `fixtureRecipesAsDomain()`). Nient'altro nel file cambia.
- `tests/ui/plan-screen.test.tsx` (`vi.mock("@/lib/plans/client")`, fixture come sopra):
  1. `plan: null`, `action 'generate'` → `EmptyState` "Nessun piano in programma"; click su `Genera piano` → mentre la promessa è pendente appare `Sto sfogliando il ricettario…`; alla risoluzione le card del nuovo piano e il toast `Piano generato`.
  2. Errore `PlanRequestError(422, 'insufficient_recipes', msg)` → `role="alert"` con `msg`.
  3. Piano `draft` → pulsanti `Rigenera` e `Conferma piano`; click su conferma → `requestConfirmPlan(planId)`, badge `Confermato`, `Crea lista della spesa` con link `/lista?piano={plan.id}`, toast `Piano confermato`.
  4. `action 'none'` → nessun pulsante Genera/Rigenera.
  5. Weekend: piano della settimana corrente mostrato e `target` della successiva → `Genera piano` e testo `Prossima settimana: 5 ott – 11 ott`.
  6. `superseded: true` in bozza → testo `Hai cambiato le impostazioni: rigenera il piano per applicarle.`; confermato → `Le nuove impostazioni varranno dal prossimo piano.`.
  7. Lucchetto: click su "Blocca pasto" → subito `aria-pressed="true"` e `requestSlotLock(planId, slotId, true)`; se rifiuta, torna `false` e compare il toast con il messaggio.
  8. Click sul titolo di una card → si apre la sheet con il titolo della ricetta; la sheet **non** mostra `Non proporre più`.
  9. Nessuna card mostra pulsanti "Aggiungi ai preferiti".
- `tests/ui/plan-slot-card.test.tsx` (`vi.mock("@/lib/plans/client")`):
  1. Click su `Cambia …` → `requestSwapSlot(planId, slotId, [ricettaIniziale])`; durante l'attesa `Cerco un'alternativa…`; poi titolo nuovo, pulsanti `Tieni` e `Cambia ancora`, `onPlanChange` chiamato.
  2. `Cambia ancora` → seconda chiamata con `[ricettaIniziale, ricettaNuova]`.
  3. `Tieni` → di nuovo il pulsante `Cambia …`; uno swap successivo riparte con la sola ricetta corrente.
  4. Swap rifiutato → `onError(messaggio)` e la card resta sulla ricetta precedente.
  5. `editable: false` → nessun `Cambia …` né lucchetto; slot `locked` → `Cambia …` disabilitato.

### Contratti esposti
`PlanScreen` (`@/components/plan/plan-screen`), `PlanSlotCard` (`@/components/plan/plan-slot-card`), pagina `/` reale.

### Dipendenze
WP3 (servizio `getPlanScreen`, client, errori), WP4 (mattoni UI, `format.ts`), WP1 (tipi, `addDays`). La rotta di swap (WP5) serve solo per la verifica manuale finale: i test mockano il client.

### Criteri di accettazione (S3.4)
- Test nuovi e riscritti verdi; `tests/verification.test.ts` verde (il file `app/(app)/page.tsx` esiste ancora).
- Flusso completo da telefono (verifica manuale di chiusura feature, dopo WP5): genera → sfoglia (sheet) → swap con flip e *Tieni / Cambia ancora* → blocco con long-press → conferma.
- Tap target ≥ 44 px, focus visibile, reduced-motion → dissolvenza.

### Fuori scope
★ e preferenze nel dettaglio (F5), creazione reale della lista (F6: il pulsante porta solo a `/lista?piano={plan.id}`), pull-to-refresh, dark mode.

---

## Mappa delle dipendenze

```
Wave 1:  WP1 (contratti + planner puro)   ∥   WP2 (migrazione + plan-repo)
            │                                   │
Wave 2:  WP3 (servizio + API + client) ◄────────┘      ∥   WP4 (mattoni UI)  ◄── WP1
            │                                               │
Wave 3:  WP5 (swap)  ◄── WP3                          ∥   WP6 (pagina Piano) ◄── WP3 + WP4
```

- **Parallelizzabili:**
  - Wave 1: WP1 (`lib/domain/{types,planner-config,rng,week,planner}.ts`, `tests/domain/*`) e WP2 (`lib/db/schema.ts`, `lib/db/migrations/*`, `lib/db/repositories/{plan-repo,recipe-repo}.ts`, `tests/helpers/plans.ts`, `tests/db/*`, `docs/ARCHITECTURE.md §4.2`). WP2 non usa i tipi aggiunti da WP1.
  - Wave 2: WP3 (`lib/plans/{errors,service,client,http}.ts`, `lib/http/responses.ts`, `app/api/plans/**` tranne `swap`, `app/api/recipes/generate/route.ts`, `tests/plans/{service,client}.test.ts`, `tests/api/plans.test.ts`, `tests/http/*`, `docs/ARCHITECTURE.md §6`) e WP4 (`lib/plans/format.ts`, `components/feedback/toast.tsx`, `components/plan/generation-progress.tsx`, `components/cards/meal-card.tsx`, `components/sheets/recipe-sheet.tsx`, `app/globals.css`, test UI dedicati). Nessun file in comune.
  - Wave 3: WP5 (`lib/plans/service.ts` solo aggiunta di `swapSlot`, rotta `swap`, `tests/plans/swap.test.ts`, `tests/api/plans-swap.test.ts`) e WP6 (`components/plan/{plan-slot-card,plan-screen}.tsx`, `app/(app)/page.tsx`, `tests/home.test.tsx`, `tests/ui/{shell,plan-screen,plan-slot-card}.test.tsx`). Nessun file in comune.
- **Sequenziali obbligati:** WP3 dopo WP1 e WP2; WP4 dopo WP1; WP5 dopo WP3; WP6 dopo WP3 e WP4. `docs/ARCHITECTURE.md` è toccato da WP2 (§4.2) e WP3 (§6) in wave diverse.
- Prima dei gate con test DB: Postgres di sviluppo attivo (porta 5433 su questa macchina, v. 0.3.6) e `pnpm db:migrate` (la `0003` arriva con WP2).

## Checklist finale

| WP | Wave | Story | File principali | Stato |
|---|---|---|---|---|
| WP1 — Contratti e selezione pesata | 1 | S3.1 | `lib/domain/{types,planner-config,rng,week,planner}.ts`, `tests/domain/{rng,week,planner,plan-contracts}.test.ts` | ☐ |
| WP2 — Migrazione e repository piani | 1 | S3.2 | `lib/db/schema.ts`, `lib/db/migrations/0003_add_plan_generation_tracking.sql`, `lib/db/repositories/{plan-repo,recipe-repo}.ts`, `tests/helpers/plans.ts`, `tests/db/{schema,plan-repo}.test.ts`, `docs/ARCHITECTURE.md` | ☐ |
| WP3 — Servizio piani e API | 2 | S3.2 | `lib/plans/{errors,service,client,http}.ts`, `lib/http/responses.ts`, `app/api/plans/{route,current/route,[id]/confirm/route,[id]/slots/[slotId]/route}.ts`, `app/api/recipes/generate/route.ts`, `tests/plans/{service,client}.test.ts`, `tests/api/plans.test.ts`, `tests/http/responses.test.ts`, `docs/ARCHITECTURE.md` | ☐ |
| WP4 — Mattoni UI del Piano | 2 | S3.4 | `lib/plans/format.ts`, `components/feedback/toast.tsx`, `components/plan/generation-progress.tsx`, `components/cards/meal-card.tsx`, `components/sheets/recipe-sheet.tsx`, `app/globals.css`, `tests/plans/format.test.ts`, `tests/ui/{toast,generation-progress,meal-card-plan}.test.tsx` | ☐ |
| WP5 — Swap slot | 3 | S3.3 | `lib/plans/service.ts` (`swapSlot`), `app/api/plans/[id]/slots/[slotId]/swap/route.ts`, `tests/plans/swap.test.ts`, `tests/api/plans-swap.test.ts` | ☐ |
| WP6 — Pagina Piano | 3 | S3.4 | `components/plan/{plan-slot-card,plan-screen}.tsx`, `app/(app)/page.tsx`, `tests/home.test.tsx`, `tests/ui/{shell,plan-screen,plan-slot-card}.test.tsx` | ☐ |

**Chiusura feature** (`execution-strategy.md §3`): accettazioni S3.1–S3.4 verificate; gate verde (`lint + typecheck + test + build`); RNG seedato ⇒ output riproducibile; preferite ~1.5× nel test statistico; da DB quasi vuoto una chiamata produce un piano completo; flusso completo da telefono (genera → sfoglia → swap → blocco → conferma) con `pnpm db:seed` e un provider LLM configurato; code-review `high` gestita; wiki aggiornata dal `feature-documenter` (nuove entità: `planner`, `plan-repo`, `plan-service`, `plan-screen`; aggiornamenti: `domain-types`, `database-schema`, `meal-card`, `recipe-sheet`, `recipe-generation` per il refactor della rotta); riga di `feature-index.md` aggiornata; commit su conferma.

**Contratti consegnati alle feature successive:**
- **F5 (S2.2/S2.3):** like/dislike si cablano in `loadIngredientPreferences` (`lib/prefs/ingredient-prefs.ts`), da usare anche in `buildConstraints` (`lib/recipes/constraints.ts`); il servizio dei piani la rilegge sotto lock insieme all'household; le preferenze ricetta (`blocked`, `favorite`, `rating`) sono già lette dal planner tramite `recipe.prefs`; ★ e controlli della sheet si attivano passando gli handler a `MealCard`/`RecipeSheet` (in `PlanSlotCard`/`PlanScreen`).
- **F6 (S4.2):** piano mostrato e stato della lista in `PlanView.shopping_list`; `shopping_lists.needs_regeneration` (messo a `true` da swap, rigenerazione e *Ripeti* su un piano esistente) va azzerato alla rigenerazione della lista; il pulsante `Crea lista della spesa` porta a `/lista?piano={plan.id}`: la lista è legata a un piano esplicito perché nel weekend possono esistere due piani non chiusi (Addendum D2). Per scegliere il piano di default di `/lista` servono `PlanScreenView.target_plan_status` e `current_plan_id`.
