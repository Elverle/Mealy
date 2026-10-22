# Feature 8 — Portate delle ricette e nuove etichette di stile · Piano di implementazione

**Data:** 2026-10-21 · **Stato:** reviewed (sviluppata il 21–22 ottobre 2026, release 0.8.0) · **Input di:** `/arch-review 8` → `/feature-dev 8`
**Spec:** [`spec.md`](spec.md) (FR-1 … FR-6, D1–D8)
**Decisioni motivate:** [`requirements.md`](requirements.md) (U1–U3 dell'utente, P1–P24 di planning), recepite qui come definitive.
**Architecture review:** [`architecture-review-2026-10-21.md`](architecture-review-2026-10-21.md) — proposte R1 (WP1 diviso in WP1a/WP1b), R2 (`coursesAllowed`), R3 (ritorno indietro solo con il dump), R4, P4, P5 già innestate in questo piano (2026-10-21).

---

## 0. Contesto per chi implementa (leggere tutto prima del proprio WP)

### 0.1 Obiettivo

1. Ogni ricetta ha un campo nuovo **`courses`** (portate): elenco chiuso e multiplo tra `piatto-unico`, `primo`, `secondo`, `contorno`. Vuoto = ricetta **non classificata** (solo ricette salvate prima di questa feature).
2. Le etichette di stile passano **da 7 a 12** (`tradizionale`, `dal-mondo`, `pochi-ingredienti`, `in-anticipo`, `piatto-freddo` in coda).
3. Due **regole derivate** vincono sul modello: `pochi-ingredienti` ⇔ al massimo 6 ingredienti con unità ≠ `qb`; su una ricetta classificata, l'etichetta `piatto-unico` ⇔ portata `piatto-unico`.
4. **Nel piano non entra mai una ricetta solo contorno** (sorteggio, *Cambia*, *Scegli*, assegnazione a mano, conteggio delle fresche). Le non classificate restano ammesse.
5. **All'avvio in produzione**, in background, il modello classifica le ricette non classificate a lotti di 10 (portate + 4 etichette). Stesso procedimento a mano con `pnpm recipes:classify`.
6. UI: badge di portata (verde `basil-subtle`) su card e dettaglio; gruppo *Portata* nel filtro della Libreria; dodici chip in Impostazioni/onboarding (già dinamici).

Una migrazione (`0005`), nessuna rotta nuova, nessuna variabile d'ambiente nuova.

### 0.2 Stato del codice su cui si lavora

Se un nome qui sotto differisce nel codice reale, **vince il codice reale**: adeguarsi mantenendo il comportamento descritto.

- Next.js 15 App Router (root senza `src/`, alias `@/*` → `./*`), React 19, zod 3, drizzle-orm 0.45 + postgres.js, drizzle-kit 0.30, Vercel AI SDK 7 (`ai`), Vitest 4 (ambiente globale **jsdom**; i test lato server iniziano con `// @vitest-environment node`), Testing Library, Tailwind v4 con i token `paper / ink / basil / tomato / saffron / stone`. `tsc --noEmit` controlla **anche i test** (`tsconfig.json` include `**/*.ts(x)`).
- `lib/domain/types.ts` — unica fonte dei tipi. Elenchi chiusi nello stile `X_VALUES` + `X_ENUM` + `XSchema` + `type X` + `X_LABELS` (vedi `MEAL_TYPE_VALUES`, `MEAL_STYLE_TAG_VALUES`). `RecipeSchema` (righe ~157–176), `GeneratedRecipeSchema` (~277, nessun `.optional()`/`.default()`: è lo schema dell'output strutturato), `FixtureRecipeSchema = GeneratedRecipeSchema.extend(...)`, `RecipeConstraintsSchema` (~299), `LibraryFilterSchema` + `EMPTY_LIBRARY_FILTER` (~520), `LibraryRecipeCardSchema` (~542), `SavedRecipeInputSchema` con i tetti `SAVED_RECIPE_*` (~745–768).
- `lib/domain/planner.ts` — `ExclusionReason`, `exclusionReason(recipe, meal, ctx)` (ordine fisso: `blocked`, `meal_type`, `diet`, `appliance`, `disliked_ingredient`, `excluded`), `manualChoiceExclusionReason` (la riusa), `selectRecipes` (calcola `eligibleByMeal` con `exclusionReason` e da lì `needMore.available`). Commento che lega `exclusionReason` a `findConstraintViolations`.
- `lib/domain/library.ts` — `toLibraryCard`, `matchesLibraryFilter` (AND dentro ogni gruppo), `parseLibraryQuery` (parametri `pasto`, `tag`, `dieta`, `preferite`, `bloccate`).
- `lib/domain/recipe-text.ts` — `normalizeGeneratedRecipe` (dedupe di `meal_types`, `tags`, `appliances_required`; `expandDietFlags`; normalizza ingredienti: `qb` ⇒ `qty = null`, `qty null` ⇒ `unit = 'qb'`).
- `lib/recipes/constraints.ts` — `buildConstraints(household, mealType, overrides?, ingredientPrefs?)` → `RecipeConstraintsSchema.parse({...})`; `findConstraintViolations(recipe, constraints)` → `string[]` in ordine pasto, diete, elettrodomestici, ingredienti esclusi.
- `lib/recipes/generate.ts` — `generateAndStoreRecipes(input, deps?)` (vincoli, chiamata LLM fuori transazione, poi transazione con `acquireRecipeGenerationLock`, `findConstraintViolations` → skip `constraint_violation` con `detail: violations.join('; ')`, duplicati, `insertGeneratedRecipe`). Usata da piano, swap e `POST /api/recipes/generate`.
- `lib/recipes/propose.ts` — `requestConstraints(household, mealType)` privata, `proposeRecipe` (violazioni ⇒ `RecipeError('proposal_unsuitable')`), `saveProposedRecipe` (ricontrollo con `requestConstraints(current, null)` ⇒ `recipe_unsuitable`).
- `lib/recipes/store.ts` — `insertGeneratedRecipe(executor, householdId, recipe)`: slug univoco + `insertRecipeWith(...)` con `source: 'llm'`.
- `lib/db/schema.ts` — tabella `recipes` (array `text[]` con `.notNull().default(sql\`ARRAY[]::text[]\`)`, vedi `tags`). `lib/db/migrations/` con `0000`–`0004` e `meta/_journal.json` + snapshot; i file si generano con `pnpm db:generate` (drizzle-kit).
- `lib/db/repositories/recipe-repo.ts` — `InsertRecipeInput`, `insertRecipeWith`, `insertRecipe`, `toRecipeWithDetails` (fa `RecipeSchema.parse` della riga), `listRecipesWith`, `getRecipeById`, `getRecipeBySlug`.
- `lib/db/seed-core.ts` — `seedDatabase()` inserisce le fixture con `insertRecipe` saltando quelle già presenti (per id o slug), poi `seedIngredientAliases`. `lib/db/seed.ts` stampa il rapporto. `fixtures/index.ts` fa `FixtureFileSchema.parse(recipes.json)` **all'import** e offre `fixtureRecipesAsDomain()`.
- `lib/llm/adapter.ts` — `runRecipeGeneration` privata (prima chiamata `temperature: 0.8`, su `NoObjectGeneratedError` una chiamata di riparazione a `0.2` con `buildRepairPrompt`, poi `LlmError('invalid_output')`; `toLlmError` per il resto), `generateRecipes`, `generateRecipeFromRequest`, `GenerateRecipesOptions { model?, timeoutMs?, abortSignal? }`. `lib/llm/prompts.ts` — `buildRecipeInstructions`, `buildRecipePrompt`, `buildRecipeRequestPrompt` (con `toSingleLine` privata), `buildRepairPrompt`. `lib/llm/model.ts` — `getModel()` / `readLlmConfig()` lanciano `LlmError('config', …)` se manca la configurazione; `getLlmTimeoutMs()`. `lib/llm/index.ts` è il barrel.
- `instrumentation.ts` — con `NEXT_RUNTIME === 'nodejs'` e `DB_BOOTSTRAP_ON_START === 'true'` importa dinamicamente `./lib/db/bootstrap` e chiama `runDbBootstrap()`; su errore `console.error` + `process.exit(1)`. Test: `tests/instrumentation.test.ts` (mocka il modulo con `vi.mock`).
- `scripts/llm-record.ts` — costruisce `rawConstraints` a mano e lo valida con `RecipeConstraintsSchema.safeParse`. Gli script si lanciano con `tsx` e caricano `.env.local`/`.env` come `lib/db/seed.ts`.
- UI: `components/sheets/recipe-detail.ts` — `recipeChips(recipe)` (fino a 2 etichette di stile nell'ordine della ricetta + 1 dieta), `toRecipeDetail`, `proposalToRecipeDetail`. `components/sheets/recipe-sheet.tsx` — `RecipeDetail` e la riga di badge (tempo, tags, Bloccata). `components/cards/meal-card.tsx` — `MealCardProps` e la riga tempo + tags. `components/plan/plan-slot-card.tsx` passa i dati a `MealCard`. `components/library/recipe-card.tsx` — badge tempo + badge opzionale (`saffron-subtle`), `aria-labelledby`. `components/ui/badge.tsx` ha già la variante `basil-subtle`. `components/library/library-filters.tsx` — pannello *Filtri* con gruppi "Tipo di pasti", "Dieta", "Altro", `panelCount`. `components/library/library-screen.tsx` — `hasFilterCriteria`. `components/settings/settings-fields.tsx` — i chip di stile iterano `MEAL_STYLE_TAG_VALUES` (diventano 12 da soli).
- Test: helper `tests/helpers/db.ts` (`isDbAvailable`, `assertDbMigrated`, `createTestHousehold`, `deleteTestHousehold`), `tests/helpers/mock-llm.ts` (`createRecordedModel(responses)`, `loadLlmRecording(name)`), modello di DB usa-e-getta e migrazioni "al rilascio precedente" in `tests/db/bootstrap.test.ts` (righe ~120–165).

### 0.3 Regole vincolanti

1. `lib/domain/types.ts` è la sola fonte di tipi: nessun tipo ridefinito altrove. Le regole pure stanno in `lib/domain/courses.ts` (nuovo, WP1a) e **si riusano**, mai reimplementate.
2. Solo `lib/recipes/*` chiama `lib/llm/`. `planner`, `library`, `courses` restano puri.
3. Test senza rete: modello finto (`createRecordedModel`, `MockLanguageModelV4`) o funzione `classify` iniettata. DB: il Postgres Docker locale (`docker compose -f docker-compose.dev.yml up -d`; se la 5432 è occupata, usare la 5433 con `DATABASE_URL` puntato lì), `pnpm db:migrate` prima dei test.
4. Gate di ogni WP: `pnpm lint && pnpm typecheck && pnpm test && pnpm build`, tutti verdi. Un WP non lascia rossi test di altri file: se una modifica del proprio WP ne rompe uno, lo aggiusta solo nei punti toccati dalla propria modifica e lo dichiara nel resoconto.
5. Codice e identificatori in inglese; commenti, microcopy, log e messaggi in italiano, nel tono dei file vicini (commenti brevi, una riga dove basta).
6. Restare nei file del proprio WP (elenco "File"). Eccezione unica: le correzioni dei test elencate al punto 4.

### 0.4 Glossario

- **Portata** (`Course`): `piatto-unico | primo | secondo | contorno`. **Portate principali**: `piatto-unico`, `primo`, `secondo` (`MAIN_COURSE_VALUES`).
- **Non classificata**: `courses` vuoto. **Classificata**: almeno una portata.
- **Ricetta da pasto** (`isMainDish`): non classificata, oppure con almeno una portata principale. Una ricetta *solo contorno* non lo è.
- **Ingredienti misurati**: righe di ingredienti con `unit !== 'qb'`.

### 0.5 Microcopy (testi esatti)

| Dove | Testo |
|---|---|
| `COURSE_LABELS` | `piatto-unico` → «Piatto unico», `primo` → «Primo», `secondo` → «Secondo», `contorno` → «Contorno» |
| `MEAL_STYLE_TAG_LABELS` nuove | `tradizionale` → «Tradizionale», `dal-mondo` → «Dal mondo», `pochi-ingredienti` → «Pochi ingredienti», `in-anticipo` → «Si prepara in anticipo», `piatto-freddo` → «Piatto freddo» |
| Badge di portata | `courseLabel(courses)`: etichette in ordine `COURSE_VALUES` unite da `" · "` (es. «Piatto unico · Secondo») |
| Titolo del gruppo nel filtro | «Portata» |
| Violazione di vincolo | `portata non adatta al pasto` |
| Log | vedi WP6, testi esatti |

### 0.6 Mappa dei work package

| WP | Titolo | Wave | Parallelo con |
|---|---|---|---|
| WP1a | Contratti, regole pure e fixture | 1 | — |
| WP1b | Colonna, migrazione, repository e seed | 2 | WP3, WP4, WP5 |
| WP3 | Adapter LLM: portate nei prompt e classificazione | 2 | WP1b, WP4, WP5 |
| WP4 | Badge di portata su card e dettaglio | 2 | WP1b, WP3, WP5 |
| WP5 | Filtro *Portata* della Libreria e dodici etichette nelle Impostazioni | 2 | WP1b, WP3, WP4 |
| WP2 | Ammissione nel piano e vincoli (planner, constraints, generate, propose, store) | 3 | WP6, WP7 |
| WP6 | Classificazione delle ricette esistenti: servizio, avvio, script | 3 | WP2, WP7 |
| WP7 | Documenti | 3 | WP2, WP6 |

---

## WP1a — Contratti, regole pure e fixture (wave 1, da solo)

**Obiettivo:** introdurre `courses` e le 12 etichette nei tipi, le regole pure di portata, le fixture e i ritocchi dei test, lasciando **invariato il comportamento** dell'app e il gate verde **senza toccare il DB** (la colonna arriva con WP1b; fino ad allora le letture valgono `courses: []` grazie a `.default([])`).

### File

- Modificare: `lib/domain/types.ts`, `lib/domain/recipe-text.ts`, `lib/domain/library.ts` (solo `toLibraryCard`), `lib/recipes/constraints.ts` (solo `courses: null`, v. passo 9), `fixtures/recipes.json`, `tests/fixtures/llm/valid-2-recipes.txt`, `tests/fixtures/llm/generation-mixed.txt`, `tests/fixtures/llm/request-lasagne.txt`, `tests/fixtures/llm/request-lasagne-altra.txt`, i 5 file di `tests/fixtures/llm/recorded/`, `tests/fixtures-data/recipes-fixtures.test.ts`, più **ogni file di test** che non compila o fallisce per il solo campo `courses` mancante (v. passo 10).
- Creare: `lib/domain/courses.ts`, `tests/domain/courses.test.ts`, `tests/helpers/recipes.ts`.

### Pattern di riferimento

- Elenchi chiusi: `MEAL_TYPE_VALUES` … `MEAL_TYPE_LABELS` in `types.ts`.
- Modulo puro con test: `lib/domain/recipe-text.ts` + `tests/domain/recipe-text.test.ts`.
- Fabbriche di test esistenti (da non toccare, solo come modello dei default): `makeRecipe` in `tests/domain/planner.test.ts:62` e `tests/domain/library.test.ts:37`.

### Passi

1. **`types.ts` — portate.** Dopo il blocco di `MEAL_STYLE_TAG_*` aggiungere:
   ```ts
   export const COURSE_VALUES = ['piatto-unico', 'primo', 'secondo', 'contorno'] as const;
   export const COURSE_ENUM = COURSE_VALUES;
   export const CourseSchema = z.enum(COURSE_VALUES);
   export type Course = z.infer<typeof CourseSchema>;

   export const COURSE_LABELS: Record<Course, string> = {
     'piatto-unico': 'Piatto unico',
     primo: 'Primo',
     secondo: 'Secondo',
     contorno: 'Contorno',
   };

   // Portate che da sole fanno un pasto (fino alla Feature 11: le sole ammesse nel piano).
   export const MAIN_COURSE_VALUES: readonly Course[] = ['piatto-unico', 'primo', 'secondo'];
   ```
2. **`types.ts` — etichette.** `MEAL_STYLE_TAG_VALUES` diventa, in quest'ordine: `'veloce', 'salutare', 'proteico', 'leggero', 'comfort-food', 'economico', 'piatto-unico', 'tradizionale', 'dal-mondo', 'pochi-ingredienti', 'in-anticipo', 'piatto-freddo'`. `MEAL_STYLE_TAG_LABELS` riceve le cinque etichette di §0.5.
3. **`types.ts` — campi.**
   - `RecipeSchema`: dopo `meal_types`, `courses: z.array(CourseSchema).default([]),`.
   - `GeneratedRecipeSchema`: dopo `meal_types`, `courses: z.array(CourseSchema).min(1),` (niente `.optional()`, il commento esistente vale).
   - `SavedRecipeInputSchema.extend({...})`: aggiungere `courses: z.array(CourseSchema).min(1).max(SAVED_RECIPE_COURSES_MAX),` con `export const SAVED_RECIPE_COURSES_MAX = 4;` accanto agli altri tetti.
   - `RecipeConstraintsSchema`: dopo `meal_type`, `courses: z.array(CourseSchema).nullable(), // null = qualsiasi portata`.
   - `LibraryFilterSchema`: dopo `meals`, `courses: z.array(CourseSchema).default([]),`; aggiornare il commento sopra lo schema: «Tutti i criteri sono in AND; dentro `courses` basta una portata (OR).». `EMPTY_LIBRARY_FILTER.courses = []`.
   - `LibraryRecipeCardSchema`: dopo `meal_types`, `courses: z.array(CourseSchema),`.
4. **`types.ts` — classificazione.** Nuovo blocco in fondo al file:
   ```ts
   // ============================================================================
   // Recipe Classification (Feature 8)
   // ============================================================================

   // Ricette per chiamata di classificazione.
   export const CLASSIFY_BATCH_SIZE = 10;

   // Etichette di stile che assegna il modello nella classificazione delle ricette esistenti.
   export const CLASSIFIED_STYLE_TAG_VALUES = ['tradizionale', 'dal-mondo', 'in-anticipo', 'piatto-freddo'] as const satisfies readonly MealStyleTag[];
   export const ClassifiedStyleTagSchema = z.enum(CLASSIFIED_STYLE_TAG_VALUES);
   export type ClassifiedStyleTag = z.infer<typeof ClassifiedStyleTagSchema>;

   // Una ricetta da classificare, come la riceve il modello. `ref`: "r1"…"r10".
   export const ClassifyRecipeItemSchema = z.object({
     ref: z.string().min(1),
     title: z.string().min(1),
     description: z.string(),
     meal_types: z.array(MealTypeSchema),
     tags: z.array(MealStyleTagSchema),
     ingredient_names: z.array(z.string().min(1)),
   });
   export type ClassifyRecipeItem = z.infer<typeof ClassifyRecipeItemSchema>;

   // Output LLM. `courses` senza .min(1): una riga vuota si scarta senza invalidare il lotto.
   export const RecipeClassificationSchema = z.object({
     ref: z.string(),
     courses: z.array(CourseSchema),
     style_tags: z.array(ClassifiedStyleTagSchema),
   });
   export type RecipeClassification = z.infer<typeof RecipeClassificationSchema>;
   export const ClassifyRecipesOutputSchema = z.object({
     recipes: z.array(RecipeClassificationSchema),
   });
   export type ClassifyRecipesOutput = z.infer<typeof ClassifyRecipesOutputSchema>;
   ```
   Se `as const satisfies` non compila con la versione di TS, usare `as const` e un controllo `const _check: readonly MealStyleTag[] = CLASSIFIED_STYLE_TAG_VALUES;`.
5. **`lib/domain/courses.ts` (nuovo).** Intestazione: `// Regole pure di portate ed etichette derivate (Feature 8). Nessuna dipendenza da DB, LLM o framework.` Esporta esattamente:
   ```ts
   export const FEW_INGREDIENTS_MAX = 6;

   /** Portate senza doppioni, nell'ordine di COURSE_VALUES. Array nuovo. */
   export function normalizeCourses(courses: readonly Course[]): Course[];

   /**
    * true se una ricetta con queste portate è ammessa dove valgono le portate `allowed`:
    * `allowed` null (qualsiasi), ricetta non classificata (`courses` vuoto), oppure almeno una
    * portata in comune. È l'unico predicato di portata: lo usano il planner (`isMainDish`) e i
    * vincoli di generazione. La Feature 11 cambierà solo l'elenco ammesso.
    */
   export function coursesAllowed(courses: readonly Course[], allowed: readonly Course[] | null): boolean;

   /** coursesAllowed(courses, MAIN_COURSE_VALUES): non classificata o con una portata principale. */
   export function isMainDish(courses: readonly Course[]): boolean;

   /** Etichette delle portate nell'ordine di COURSE_VALUES unite da " · "; null se `courses` è vuoto. */
   export function courseLabel(courses: readonly Course[]): string | null;

   /** Righe di ingredienti con unità diversa da 'qb'. */
   export function countMeasuredIngredients(ingredients: readonly { unit: Unit }[]): number;

   /**
    * Applica le regole che vincono sul modello e restituisce le etichette senza doppioni,
    * nell'ordine di MEAL_STYLE_TAG_VALUES:
    * - 'pochi-ingredienti' c'è se e solo se countMeasuredIngredients(ingredients) <= FEW_INGREDIENTS_MAX;
    * - con `courses` non vuoto, 'piatto-unico' c'è se e solo se courses include 'piatto-unico';
    *   con `courses` vuoto l'etichetta resta com'è.
    */
   export function deriveStyleTags(
     tags: readonly MealStyleTag[],
     courses: readonly Course[],
     ingredients: readonly { unit: Unit }[]
   ): MealStyleTag[];
   ```
   Implementazione: insiemi + `COURSE_VALUES.filter(...)` / `MEAL_STYLE_TAG_VALUES.filter(...)`; `isMainDish` chiama `coursesAllowed` con `MAIN_COURSE_VALUES`.
6. **`tests/domain/courses.test.ts`** (puro). Casi minimi:
   - `normalizeCourses(['secondo','piatto-unico','secondo'])` → `['piatto-unico','secondo']`.
   - `coursesAllowed`: con `null` → true; `[]` con qualsiasi elenco → true; `['contorno']` con `MAIN_COURSE_VALUES` → false; `['secondo','contorno']` con `['contorno']` → true; `['primo']` con `['secondo']` → false.
   - `isMainDish([])` true; `['contorno']` false; `['secondo','contorno']` true; `['piatto-unico']` true.
   - `courseLabel([])` null; `['secondo','piatto-unico']` → `'Piatto unico · Secondo'`; `['contorno']` → `'Contorno'`.
   - `deriveStyleTags`: 6 ingredienti `g` + 3 `qb` → contiene `pochi-ingredienti`; 7 `g` con `tags` che già lo contiene → lo toglie; `courses ['piatto-unico']` e tags `[]` → contiene `piatto-unico`; `courses ['primo']` e tags `['piatto-unico']` → non lo contiene; `courses []` e tags `['piatto-unico']` → lo tiene; `courses []` e tags `[]` → non lo aggiunge; output ordinato per `MEAL_STYLE_TAG_VALUES` e senza doppioni (`['piatto-freddo','veloce','veloce']` con 8 ingredienti → `['veloce','piatto-freddo']`).
7. **`recipe-text.ts` — `normalizeGeneratedRecipe`**: nel return aggiungere `courses: normalizeCourses(recipe.courses),` (import da `./courses`). Aggiornare il commento JSDoc con una riga «- normalizes courses (no duplicates, COURSE_VALUES order)». **Non** applicare `deriveStyleTags` qui (req. P5).
8. **`library.ts` — `toLibraryCard`**: aggiungere `courses: recipe.courses,` dopo `meal_types`. Nient'altro in questo file (il filtro è di WP5).
9. **`constraints.ts` — `buildConstraints`**: nell'oggetto passato a `RecipeConstraintsSchema.parse` aggiungere `courses: null,` subito dopo `meal_type`. Nessun altro cambiamento (WP2 introduce il parametro).
10. **Ritocchi dei test per il solo campo nuovo.** Lanciare `pnpm typecheck` e `pnpm test` e correggere **solo** gli errori dovuti a `courses` mancante, con questi valori (nessun'altra modifica ai test):
    - letterali tipati `Recipe` / `RecipeWithDetails` / fabbriche `makeRecipe` → `courses: []` (non classificata: comportamento invariato);
    - letterali `GeneratedRecipe`, corpi di `POST /api/recipes`, risposte finte di `/api/recipes/propose` nei test UI → `courses: ['secondo']`, salvo che il titolo sia un primo evidente (pasta, risotto, lasagne, zuppa) → `['primo']`;
    - letterali `RecipeConstraints` → `courses: null`;
    - letterali `LibraryRecipeCard` → `courses: []`; letterali `LibraryFilter` → `courses: []`.
11. **`tests/helpers/recipes.ts` (nuovo).** Fabbriche condivise per **tutti i test nuovi** di questa feature (i test esistenti non si migrano):
    ```ts
    /** Ricetta di libreria valida (non classificata, senza preferenze). */
    export function makeRecipe(overrides?: Partial<Recipe>): Recipe;
    /** Ricetta generata valida, portata `['secondo']`, 3 ingredienti misurati. */
    export function makeGeneratedRecipe(overrides?: Partial<GeneratedRecipe>): GeneratedRecipe;
    /** Card di libreria valida (`courses: []`). */
    export function makeLibraryCard(overrides?: Partial<LibraryRecipeCard>): LibraryRecipeCard;
    ```
    Default: id `crypto.randomUUID()` (household `DEFAULT_HOUSEHOLD_ID`), titolo `'Ricetta di prova'`, `meal_types: ['pranzo','cena']`, `tags: []`, `diet_flags: []`, `appliances_required: []`, `servings_base: 2`, `prep_minutes: 20`, `steps: ['Cuoci.']`, ingredienti `g` in `dispensa`, `created_at` fisso `2026-01-01T00:00:00Z`. Il risultato passa lo schema corrispondente (`RecipeSchema.parse` / `GeneratedRecipeSchema.parse` / `LibraryRecipeCardSchema.parse`) prima di essere restituito.
12. **Fixture LLM.** Aggiungere `"courses"` subito dopo `"meal_types"` in ogni ricetta di `valid-2-recipes.txt`, `generation-mixed.txt`, `request-lasagne.txt`, `request-lasagne-altra.txt`: primi (pasta, risotto, lasagne) → `["primo"]`, tutto il resto → `["secondo"]`. Lasciare intatti `invalid-enum.txt` e `malformed-truncated.txt`. Nei 5 file di `recorded/` aggiungere `"courses"` nello stesso punto con la portata più naturale per il titolo (burger, tofu, polpette, spiedini → `["secondo"]`; pasta, spaghetti, lasagne → `["primo"]`; couscous, insalate sostanziose → `["piatto-unico"]`), senza toccare altro. Sono ritoccati a mano (req. P19).
13. **`fixtures/recipes.json`.** Per ogni ricetta aggiungere `"courses"` dopo `"meal_types"` e aggiungere in coda alle `tags` esistenti le etichette nuove indicate (ordine come scritto). Le etichette risultanti rispettano FR-2.3 e FR-2.4 (conteggi verificati sul file attuale):

    | # | Titolo | `courses` | Etichette da aggiungere in coda |
    |---|---|---|---|
    | 1 | Pasta al pomodoro e basilico | `["primo"]` | `tradizionale`, `pochi-ingredienti` |
    | 2 | Risotto alla zucca | `["primo"]` | `tradizionale` |
    | 3 | Pollo croccante in friggitrice ad aria | `["secondo"]` | `pochi-ingredienti` |
    | 4 | Insalata di ceci, pomodorini e feta | `["piatto-unico"]` | `piatto-unico`, `pochi-ingredienti`, `in-anticipo`, `piatto-freddo` |
    | 5 | Salmone al forno con patate | `["secondo"]` | `pochi-ingredienti` |
    | 6 | Frittata di zucchine | `["secondo"]` | `tradizionale`, `pochi-ingredienti`, `in-anticipo` |
    | 7 | Vellutata di carote e zenzero | `["primo"]` | `pochi-ingredienti` |
    | 8 | Polpette al sugo | `["secondo"]` | `tradizionale`, `in-anticipo` |
    | 9 | Poke bowl di tonno e riso | `["piatto-unico"]` | `dal-mondo`, `piatto-freddo` |
    | 10 | Pasta e ceci | `["piatto-unico", "primo"]` | `tradizionale`, `pochi-ingredienti` |
    | 11 | Tacchino alla piastra con insalata | `["secondo"]` | `pochi-ingredienti` |
    | 12 | Lasagne alla bolognese | `["primo"]` | `tradizionale`, `in-anticipo` |
    | 13 | Patate e zucchine croccanti | `["contorno"]` | `pochi-ingredienti` |
    | 14 | Merluzzo in padella con pomodorini | `["secondo"]` | `pochi-ingredienti` |
    | 15 | Uova e spinaci al microonde | `["secondo"]` | `pochi-ingredienti` |
    | 16 | Couscous di verdure | `["piatto-unico"]` | `pochi-ingredienti`, `dal-mondo` |
    | 17 | Hamburger di manzo con patate al forno | `["secondo"]` | `pochi-ingredienti`, `dal-mondo` |
    | 18 | Crema di piselli e menta | `["primo"]` | `pochi-ingredienti` |

    Le ricette 9, 10 e 16 hanno già `piatto-unico` tra le etichette: non duplicarlo. Le ricette 2, 8, 9, 12 (più di 6 ingredienti misurati) non ricevono `pochi-ingredienti`. Se un conteggio sul file reale non torna con la tabella, vince la regola (FR-2.3) e va segnalato nel resoconto.
14. **`tests/fixtures-data/recipes-fixtures.test.ts`**: nuovo caso «every recipe is classified and its tags follow the derived rules»: per ogni fixture `courses.length >= 1`, `normalizeCourses(courses)` uguale a `courses`, e `new Set(deriveStyleTags(r.tags, r.courses, r.ingredients))` uguale a `new Set(r.tags)`. Nuovo caso: «exactly one recipe is only a side dish» (`isMainDish` false per una sola ricetta). Il caso «already normalized» esistente deve restare verde.

### Contratti esposti

- `types.ts`: `COURSE_VALUES`, `COURSE_ENUM`, `CourseSchema`, `Course`, `COURSE_LABELS`, `MAIN_COURSE_VALUES`, 12 `MEAL_STYLE_TAG_VALUES`, `RecipeSchema.courses`, `GeneratedRecipeSchema.courses`, `SAVED_RECIPE_COURSES_MAX`, `RecipeConstraintsSchema.courses`, `LibraryFilterSchema.courses`, `LibraryRecipeCardSchema.courses`, `CLASSIFY_BATCH_SIZE`, `CLASSIFIED_STYLE_TAG_VALUES`, `ClassifiedStyleTag`, `ClassifyRecipeItem(Schema)`, `RecipeClassification(Schema)`, `ClassifyRecipesOutput(Schema)`.
- `lib/domain/courses.ts`: `FEW_INGREDIENTS_MAX`, `normalizeCourses`, `coursesAllowed`, `isMainDish`, `courseLabel`, `countMeasuredIngredients`, `deriveStyleTags` (firme sopra).
- `tests/helpers/recipes.ts`: `makeRecipe`, `makeGeneratedRecipe`, `makeLibraryCard`.

### Dipendenze

Nessuna. Tutti gli altri WP dipendono da WP1a.

### Criteri di accettazione

- Gate verde senza migrazioni nuove.
- Nessun comportamento visibile cambiato: il planner, i vincoli e le card ignorano ancora `courses`.
- Test nuovi di WP1a verdi (courses, fixture).

### Fuori ambito

Colonna, migrazione, repository e seed (WP1b). Regole di ammissione (WP2), prompt (WP3), UI (WP4, WP5), classificazione (WP6), documenti (WP7). Migrazione dei test esistenti alle fabbriche condivise.

---

## WP1b — Colonna, migrazione, repository e seed (wave 2, parallelo a WP3, WP4, WP5)

**Obiettivo:** dare a `courses` una colonna nel DB, applicare FR-2.3 alle ricette esistenti con la migrazione, offrire al servizio di classificazione le due funzioni di repository e far scrivere al seed portate ed etichette derivate.

### File

- Modificare: `lib/db/schema.ts`, `lib/db/repositories/recipe-repo.ts`, `lib/db/seed-core.ts`, `lib/db/seed.ts`, `tests/db/seed.test.ts`.
- Creare: `lib/db/migrations/0005_add_recipe_courses.sql` (+ `meta/0005_snapshot.json` e la voce nel journal, generati), `tests/db/recipe-courses-migration.test.ts`, `tests/db/recipe-classification-repo.test.ts`.

### Pattern di riferimento

- Migrazione su DB usa-e-getta: `tests/db/bootstrap.test.ts`, blocco `runDbBootstrap on a database one migration behind`.
- Test di repository: `tests/db/recipe-pref-repo.test.ts` (household di test creato e cancellato).

### Passi

1. **DB.**
   - `schema.ts`, tabella `recipes`, dopo `meal_types`: `courses: text('courses').array().notNull().default(sql\`ARRAY[]::text[]\`),`. Nessun indice.
   - Generare con `pnpm db:generate --name add_recipe_courses` (non serve il DB). Deve nascere `lib/db/migrations/0005_add_recipe_courses.sql` con l'`ALTER TABLE "recipes" ADD COLUMN "courses" text[] DEFAULT ARRAY[]::text[] NOT NULL;`, lo snapshot e la voce `idx: 5` nel journal. Se il nome generato è diverso, rinominare file e `tag` del journal in `0005_add_recipe_courses`.
   - Aggiungere in coda al file SQL, dopo una riga `--> statement-breakpoint`, l'aggiornamento idempotente di FR-2.3:
     ```sql
     UPDATE "recipes" AS r
     SET "tags" = CASE
       WHEN (SELECT count(*) FROM "recipe_ingredients" AS i WHERE i."recipe_id" = r."id" AND i."unit" <> 'qb') <= 6
         THEN CASE WHEN 'pochi-ingredienti' = ANY(r."tags") THEN r."tags" ELSE array_append(r."tags", 'pochi-ingredienti') END
       ELSE array_remove(r."tags", 'pochi-ingredienti')
     END;
     ```
   - Applicarla al DB di sviluppo con `pnpm db:migrate` prima di lanciare i test.
2. **Repository (`recipe-repo.ts`).**
   - `InsertRecipeInput`: `courses?: Course[];` dopo `meal_types`; `insertRecipeWith` scrive `courses: recipeData.courses ?? [],`. La lettura passa già da `toRecipeWithDetails` (`RecipeSchema` ha il campo).
   - Nuovo tipo e due funzioni, in coda al file:
     ```ts
     /** Dati di una ricetta non classificata che servono alla classificazione (FR-4.2). */
     export interface UnclassifiedRecipe {
       id: string;
       title: string;
       description: string;
       meal_types: MealType[];
       tags: MealStyleTag[];
       /** Righe di ingredienti nell'ordine della ricetta (nome canonico com'è nel DB). */
       ingredients: { canonical_name: string; unit: Unit }[];
     }

     /** Ricette dell'household con `courses` vuoto, dalla meno recente (created_at, poi id). */
     export async function listUnclassifiedRecipes(executor: DbExecutor, householdId: string): Promise<UnclassifiedRecipe[]>;

     /**
      * Scrive portate ed etichette solo se la ricetta è ancora non classificata
      * (`cardinality(courses) = 0`). true se ha scritto.
      */
     export async function setRecipeClassification(
       executor: DbExecutor, recipeId: string, courses: Course[], tags: MealStyleTag[]
     ): Promise<boolean>;
     ```
     `listUnclassifiedRecipes`: `executor.query.recipes.findMany({ where: and(eq(recipes.household_id, householdId), sql\`cardinality(${recipes.courses}) = 0\`), columns: { id, title, description, meal_types, tags }, with: { ingredients: { columns: { canonical_name: true, unit: true } } }, orderBy: [asc(created_at), asc(id)] })`; convertire `meal_types`/`tags`/`unit` con gli schemi Zod (`z.array(MealTypeSchema).parse`, ecc.). L'ordine degli ingredienti: quello restituito dalla relazione (nessun ordinamento in più). `setRecipeClassification`: `update(recipes).set({ courses, tags }).where(and(eq(recipes.id, recipeId), sql\`cardinality(${recipes.courses}) = 0\`)).returning({ id: recipes.id })` → `rows.length > 0`.
3. **Seed (`seed-core.ts`, `seed.ts`).**
   - `SeedReport` riceve `recipesClassified: number` (ricette d'esempio già presenti completate con portate ed etichette).
   - Nuova ricetta: `insertRecipe({... , courses: normalizeCourses(r.courses), tags: deriveStyleTags(r.tags, r.courses, r.ingredients), ...})`.
   - Ricetta già presente **per id** (`existingById`): se `existingById.courses.length === 0`, chiamare `setRecipeClassification(db, r.id, normalizeCourses(r.courses), deriveStyleTags(r.tags, r.courses, r.ingredients))` e, se restituisce `true`, `recipesClassified++`. In ogni caso conta come `recipesSkipped` (comportamento attuale). Una ricetta presente solo per slug resta saltata senza aggiornamenti.
   - `seed.ts`: la riga di log diventa `Seed completato — household: …, ricette inserite: …, già presenti: …, completate con le portate: ${report.recipesClassified}, alias inseriti o aggiornati: …`.
4. **`tests/db/seed.test.ts`**: nuovo caso «after seeding every fixture recipe has at least one course» (rilegge le 18 per id con `getRecipeById`). Nuovo caso «completes an existing fixture recipe without courses»: azzera con SQL **solo** `courses` di una ricetta d'esempio (`update recipes set courses = '{}' where id = …`, senza toccare `tags`), rilancia `seedDatabase()`, verifica `recipesClassified >= 1` e che `courses` e `tags` coincidano con il file (come insiemi, dopo `deriveStyleTags`). Aggiornare eventuali `toEqual` sul rapporto con il campo nuovo.
5. **`tests/db/recipe-courses-migration.test.ts`** (`// @vitest-environment node`, `describe.skipIf(!dbUp)`), sul modello di `bootstrap.test.ts`: DB usa-e-getta `mealy_courses_${process.pid}_${Date.now()}`; cartella delle migrazioni copiata con il journal **filtrato a `idx < 5`** (non "senza l'ultima", così il test regge migrazioni future); `migrate` fino a `0004`; con SQL grezzo inserire un household e tre ricette: A con 6 ingredienti `g` + 2 `qb` e tags `['veloce']`; B con 7 ingredienti `g` e tags `['pochi-ingredienti','comfort-food']`; C con 3 ingredienti e tags `['pochi-ingredienti','leggero']`. Poi `migrate` con la cartella reale e verificare: tutte con `courses = {}`; A → tags `['veloce','pochi-ingredienti']`; B → `['comfort-food']`; C → `['pochi-ingredienti','leggero']` (invariata, idempotenza). Rieseguire l'`UPDATE` della migrazione (letto dal file, ultima istruzione dopo `--> statement-breakpoint`) e verificare che nulla cambi. `afterAll` chiude la connessione e fa `drop database … with (force)`.
6. **`tests/db/recipe-classification-repo.test.ts`** (DB, household di test): `insertRecipe` di una ricetta con `courses: []` e una con `courses: ['primo']`; `listUnclassifiedRecipes` restituisce solo la prima, con `ingredients` (nome e unità); `setRecipeClassification` sulla prima → `true` e i valori sono scritti; seconda chiamata → `false` e i valori non cambiano; `setRecipeClassification` sulla classificata → `false`.

### Contratti esposti

- `recipe-repo.ts`: `InsertRecipeInput.courses`, `UnclassifiedRecipe`, `listUnclassifiedRecipes`, `setRecipeClassification`.
- `SeedReport.recipesClassified`.
- Colonna `recipes.courses` e migrazione `0005_add_recipe_courses`.

### Dipendenze

WP1a (tipi, `courses.ts`, fixture con `courses`).

### Criteri di accettazione

- Gate verde. `pnpm db:migrate` applica `0005` sul DB di sviluppo; `pnpm db:seed` completa le 18 ricette d'esempio.
- Test nuovi di WP1b verdi (migrazione, repository, seed).

### Fuori ambito

Applicazione di `deriveStyleTags` nello store (WP2). Indici sulla colonna. Classificazione (WP6).

---

## WP2 — Ammissione nel piano e vincoli (wave 3, parallelo a WP6, WP7)

**Obiettivo:** escludere le ricette solo contorno dal piano e dai vincoli di generazione, e applicare le regole derivate a ogni ricetta che entra in libreria.

### File

- Modificare: `lib/domain/planner.ts`, `lib/recipes/constraints.ts`, `lib/recipes/generate.ts`, `lib/recipes/propose.ts`, `lib/recipes/store.ts`.
- Test da modificare/estendere: `tests/domain/planner.test.ts`, `tests/recipes/constraints.test.ts`, `tests/recipes/generate.test.ts`, `tests/recipes/propose.test.ts`, `tests/plans/swap.test.ts`, `tests/plans/assign.test.ts`, `tests/plans/service.test.ts` (solo se rotti dalle regole nuove o per i casi nuovi sotto).

### Pattern di riferimento

- Motivo di esclusione e test: `exclusionReason` e i casi `'appliance'` in `tests/domain/planner.test.ts`.
- Violazione e test: blocco «3. elettrodomestico» di `findConstraintViolations` e `tests/recipes/constraints.test.ts`.
- `generate` iniettato in `generateAndStoreRecipes` (`GenerateAndStoreDeps.generate`) e in `proposeRecipe` (`ProposeRecipeDeps.generate`): usarlo per restituire ricette costruite nel test.

### Passi

1. **`planner.ts`.** `ExclusionReason` riceve `'course'` subito dopo `'meal_type'`. In `exclusionReason`, subito dopo il controllo `meal_type`: `if (!isMainDish(recipe.courses)) return 'course';` (import da `./courses`). Commento sopra la riga: `// Fino alla Feature 11 un pasto è una ricetta sola: mai un contorno da solo.` Nient'altro: piano, swap, conteggio delle fresche (`needMore`), candidate e assegnazione a mano ne ereditano il comportamento.
2. **`constraints.ts`.**
   - Nuova firma (TypeScript non ammette un parametro obbligatorio dopo uno opzionale, quindi i due intermedi diventano `T | undefined` espliciti):
     ```ts
     export function buildConstraints(
       household: Household,
       mealType: MealType | null,
       overrides: ConstraintOverrides | undefined,
       ingredientPrefs: IngredientPreferenceSets | undefined,
       courses: readonly Course[] | null
     ): RecipeConstraints
     ```
     I chiamanti passano `undefined` dove oggi omettono un argomento (anche nei test di `constraints.test.ts`). Nell'oggetto del `parse`: `courses: courses === null ? null : [...courses],` (sostituisce il `courses: null` di WP1a). JSDoc: una riga «`courses`: portate ammesse (null = qualsiasi).».
   - `findConstraintViolations`: nuovo controllo **2** dopo il pasto, rinumerando i commenti successivi:
     ```ts
     // 2. portata non ammessa
     if (!coursesAllowed(recipe.courses, constraints.courses)) {
       violations.push('portata non adatta al pasto');
     }
     ```
     (import da `@/lib/domain/courses`; mai un confronto tra elenchi scritto a mano: review R2). Aggiornare il JSDoc: «Violations are returned in order: meal_type, courses, diet_tags, appliances, ingredient_dislikes.» Al commento che lega le due funzioni (qui e in `planner.ts`) aggiungere: «La portata passa da `coursesAllowed` in entrambe: la Feature 11 cambia solo l'elenco ammesso.»
3. **`generate.ts`.** `buildConstraints(household, input.mealType, input.overrides ?? {}, ingredientPrefs, MAIN_COURSE_VALUES)`. Commento: `// Piano, swap e /api/recipes/generate: solo ricette che fanno da pasto.`
4. **`propose.ts`.**
   - `requestConstraints(household, mealType)`: `buildConstraints(household, mealType, { meal_style_tags: [] }, undefined, mealType === null ? null : MAIN_COURSE_VALUES)`. JSDoc: «Dal Piano (`mealType` indicato) la ricetta deve fare da pasto; dalla Libreria qualsiasi portata, contorno compreso.»
   - `saveProposedRecipe` resta su `requestConstraints(current, null)` (portata non ricontrollata).
   - `proposeRecipe`: dopo il controllo delle violazioni e prima della ricerca del duplicato, sostituire la ricetta restituita con `{ ...recipe, tags: deriveStyleTags(recipe.tags, recipe.courses, recipe.ingredients) }` (P5); è quella che va in `RecipeProposal.recipe`.
5. **`store.ts` — `insertGeneratedRecipe`.** Prima di `insertRecipeWith`: `const courses = normalizeCourses(recipe.courses);` e passare `courses` e `tags: deriveStyleTags(recipe.tags, courses, recipe.ingredients)`. JSDoc: aggiungere «Applica le regole derivate (`deriveStyleTags`): è il punto unico di scrittura per generazione, proposta salvata e pacchetto della Feature 10.»
6. **Test.**
   - `planner.test.ts`: ricetta `courses: ['contorno']` → `exclusionReason` = `'course'` (anche se `meal_type` combacia); `['secondo','contorno']` e `[]` → ammesse; ricetta bloccata e solo contorno → `'blocked'` (ordine); `selectRecipes` con una libreria di sole ricette contorno per `cena` → slot `null` e `needMore.available = 0`; con 3 secondi + 20 contorni l'`available` conta 3. Se i casi esistenti che usano `fixtureRecipesAsDomain()` cambiano risultato per *Patate e zucchine croccanti* (ora solo contorno), aggiornare l'atteso, mai la fixture.
   - `constraints.test.ts`: `buildConstraints(..., MAIN_COURSE_VALUES).courses` uguale a `['piatto-unico','primo','secondo']`, con `null` → `null`; violazione «portata non adatta al pasto» per una generata `['contorno']` con `MAIN_COURSE_VALUES`; nessuna con `null`; ordine delle violazioni (pasto prima di portata prima di dieta).
   - `generate.test.ts`: `generate` iniettato che restituisce un secondo e un contorno → il contorno finisce in `skipped` con `reason: 'constraint_violation'` e `detail` contenente `portata non adatta al pasto`; il secondo viene salvato con `courses: ['secondo']`. Una ricetta con 4 ingredienti misurati e tags `[]` viene salvata con `pochi-ingredienti`; una `['secondo']` con tag `piatto-unico` viene salvata senza. Aggiornare gli attesi esistenti sulle `tags` salvate se ora includono `pochi-ingredienti`.
   - `propose.test.ts`: dal Piano (`mealType: 'cena'`) una proposta `['contorno']` → `RecipeError('proposal_unsuitable')`; dalla Libreria (`mealType: null`) la stessa → proposta restituita; `saveProposedRecipe` la salva con `courses: ['contorno']`. La proposta restituita ha le etichette derivate.
   - `swap.test.ts` / `assign.test.ts` / `service.test.ts`: una ricetta solo contorno della libreria non è mai scelta dallo swap, non compare in `listSlotCandidates`, e `assignSlotRecipe` la rifiuta con `PlanError('recipe_not_eligible')`. Un piano esistente con una ricetta solo contorno già assegnata si legge senza errori (`toPlanView`).

### Contratti esposti

- `ExclusionReason` con `'course'`.
- `buildConstraints(household, mealType, overrides | undefined, ingredientPrefs | undefined, courses)` (tutti e cinque i parametri obbligatori).
- Le ricette scritte da `insertGeneratedRecipe` hanno `courses` normalizzate ed etichette derivate.

### Dipendenze

WP1a (tipi, `courses.ts`, `coursesAllowed`) e WP1b (colonna, `InsertRecipeInput.courses`: lo store scrive `courses`).

### Criteri di accettazione

- Gate verde; i casi nuovi sopra passano (spec §7, punti 1–3).
- `grep -n "buildConstraints(" lib app scripts` mostra tutti i chiamanti con cinque argomenti.

### Fuori ambito

Slot per portata e composizioni (Feature 11). Prompt (WP3): qui la portata richiesta arriva al modello solo tramite `constraints.courses`, che WP3 legge. Nessun messaggio d'errore nuovo per l'utente.

---

## WP3 — Adapter LLM: portate nei prompt e classificazione (wave 2, parallelo a WP1b, WP4, WP5)

**Obiettivo:** far chiedere al modello le portate e le dodici etichette, e aggiungere all'adapter la chiamata di classificazione a lotti.

### File

- Modificare: `lib/llm/prompts.ts`, `lib/llm/adapter.ts`, `lib/llm/index.ts`, `scripts/llm-record.ts`, `tests/llm/prompts.test.ts`, `tests/llm/adapter.test.ts`.

### Pattern di riferimento

`runRecipeGeneration` e `generateRecipeFromRequest` in `adapter.ts`; `buildRecipeRequestPrompt` (uso di `toSingleLine`) in `prompts.ts`; i test esistenti con `createRecordedModel`.

### Passi

1. **`buildRecipeInstructions`.**
   - Dopo la riga `meal_types` inserire: `'- courses: le portate in cui il piatto si serve davvero, di solito una e al massimo due, tra piatto-unico (basta da solo come pasto), primo (pasta, riso, zuppe), secondo (carne, pesce, uova, formaggi o legumi come portata principale) e contorno (verdure o patate che accompagnano un secondo).'`
   - Sostituire la riga `tags` con una costruita da `MEAL_STYLE_TAG_VALUES.join(', ')`: `` `- tags: solo tra ${MEAL_STYLE_TAG_VALUES.join(', ')} ("veloce" solo se prep_minutes è al massimo 30; "pochi-ingredienti" e "piatto-unico" li calcola l'app, puoi ometterli).` `` seguita da `'  Significati: tradizionale = classico della cucina italiana; dal-mondo = di una cucina non italiana; in-anticipo = si prepara prima e si conserva bene, adatto alla schiscetta; piatto-freddo = si mangia freddo o è estivo.'`
2. **Riga di portata nei prompt utente.** Funzione privata `courseLine(courses: RecipeConstraints['courses'], subject: 'ogni ricetta' | 'la ricetta'): string | null` → `null` se `courses === null`, altrimenti `` `- Portata: in courses ${subject} deve avere almeno una tra ${courses.join(', ')}.` ``. In `buildRecipePrompt` va subito dopo la riga `- Pasto:` con `'ogni ricetta'`; in `buildRecipeRequestPrompt` subito dopo la riga `- Pasto:` con `'la ricetta'`. Con `null` nessuna riga.
3. **Prompt di classificazione** (nuovi, esportati):
   ```ts
   export const CLASSIFY_DESCRIPTION_MAX = 300;
   export function buildClassifyInstructions(): string;
   export function buildClassifyPrompt(items: readonly ClassifyRecipeItem[]): string;
   ```
   `buildClassifyInstructions()` restituisce, righe unite da `\n`:
   ```
   Sei il ricettario di casa di una famiglia italiana. Classifichi ricette già esistenti: non le modifichi e non ne inventi di nuove.
   Rispondi solo con un oggetto JSON conforme allo schema richiesto, senza testo prima o dopo.

   Per ogni ricetta ricevuta restituisci una voce in "recipes" con:
   - ref: il riferimento della ricetta, copiato identico (es. "r1").
   - courses: le portate in cui il piatto si serve davvero, di solito una e al massimo due, tra:
     - piatto-unico: un piatto completo che basta da solo come pasto;
     - primo: pasta, riso, gnocchi, zuppe e minestre;
     - secondo: carne, pesce, uova, formaggi o legumi serviti come portata principale;
     - contorno: verdure o patate che accompagnano un secondo.
   - style_tags: zero o più tra:
     - tradizionale: piatto classico della cucina italiana;
     - dal-mondo: piatto di una cucina non italiana;
     - in-anticipo: si prepara prima e si conserva bene, adatto alla schiscetta;
     - piatto-freddo: si mangia freddo o è un piatto estivo.
   Una voce per ogni ricetta ricevuta, nello stesso ordine, senza aggiungerne altre.
   ```
   `buildClassifyPrompt(items)`: prima riga `` `Classifica queste ${items.length} ricette.` ``, poi per ogni item un blocco preceduto da una riga vuota:
   ```
   [r1] <titolo su una riga>
   Descrizione: <descrizione su una riga, tagliata a CLASSIFY_DESCRIPTION_MAX caratteri; "nessuna" se vuota>
   Pasti: <meal_types uniti da ", ">
   Etichette attuali: <tags uniti da ", "; "nessuna" se vuote>
   Ingredienti: <ingredient_names uniti da ", "; "nessuno" se vuoti>
   ```
   Titolo e descrizione passano da `toSingleLine` (già nel file). Il taglio avviene dopo `toSingleLine`, senza puntini.
4. **Adapter — helper generico.** Estrarre da `runRecipeGeneration` una funzione privata
   ```ts
   async function runStructuredCall<T>(call: {
     model: LanguageModel; instructions: string; prompt: string; schema: z.ZodType<T>;
     temperature: number; repairTemperature: number; timeoutMs: number; abortSignal?: AbortSignal;
     invalidOutputMessage: string;
   }): Promise<T>
   ```
   con lo stesso identico flusso di oggi (prima chiamata, riparazione su `NoObjectGeneratedError` con `buildRepairPrompt(describeValidationError(err.cause))` e i messaggi `user`/`assistant`/`user`, `maxRetries: 1`, `LlmError('invalid_output', invalidOutputMessage)`, `toLlmError` per il resto). `runRecipeGeneration` la usa con `GenerateRecipesOutputSchema`, `0.8` / `0.2` e il messaggio attuale, poi `.recipes.map(normalizeGeneratedRecipe)`. I test esistenti dell'adapter devono restare verdi senza modifiche agli attesi. Se la deduzione dei tipi di `Output.object` su uno schema generico costringe a cast, ricevere lo schema come `z.ZodType<T, z.ZodTypeDef, unknown>` e restituire `result.output as T` con un commento di una riga; nessun'altra astrazione (review R4).
5. **Adapter — `classifyRecipes`** (esportata, e riesportata da `lib/llm/index.ts` insieme a `buildClassifyInstructions`, `buildClassifyPrompt`, `CLASSIFY_DESCRIPTION_MAX`):
   ```ts
   /**
    * Classifica un lotto di ricette esistenti: portate e le 4 etichette di stile del modello.
    * Restituisce le righe così come le dà il modello (validate dallo schema): riferimenti
    * sconosciuti, ripetuti o con portate vuote li scarta il chiamante.
    */
   export async function classifyRecipes(
     items: readonly ClassifyRecipeItem[],
     options?: GenerateRecipesOptions
   ): Promise<RecipeClassification[]>;
   ```
   Regole: `items.length` tra 1 e `CLASSIFY_BATCH_SIZE`, altrimenti `RangeError('items must contain between 1 and 10 recipes')`; `model = options?.model ?? getModel()` (può lanciare `LlmError('config')`: non catturarlo); `runStructuredCall` con `buildClassifyInstructions()`, `buildClassifyPrompt(items)`, `ClassifyRecipesOutputSchema`, temperature `0.2` e `0.2`, timeout `options?.timeoutMs ?? getLlmTimeoutMs()`, `abortSignal`, messaggio `'Il modello non ha prodotto una classificazione valida dopo il tentativo di correzione.'`; restituisce `output.recipes`.
6. **`scripts/llm-record.ts`.** In `rawConstraints` aggiungere `courses` (P23): senza `--request` → `[...MAIN_COURSE_VALUES]`; con `--request` e `--meal` → `[...MAIN_COURSE_VALUES]`; con `--request` senza `--meal` → `null`. Nessun'altra modifica.
7. **Test.**
   - `prompts.test.ts`: le istruzioni contengono la riga `courses` e tutte le 12 etichette; `buildRecipePrompt` con `courses: ['piatto-unico','primo','secondo']` contiene `- Portata: in courses ogni ricetta deve avere almeno una tra piatto-unico, primo, secondo.` e con `null` non contiene `- Portata:`; idem per `buildRecipeRequestPrompt` con `la ricetta`; `buildClassifyPrompt` con 2 item produce `[r1]`/`[r2]`, sostituisce le etichette vuote con `nessuna`, porta una descrizione di 400 caratteri a 300, e una descrizione con a capo su una riga.
   - `adapter.test.ts`: `classifyRecipes` con `createRecordedModel` e una risposta valida scritta nel test (`{"recipes":[{"ref":"r1","courses":["primo"],"style_tags":["tradizionale"]},{"ref":"r2","courses":[],"style_tags":[]}]}`) → restituisce le due righe; con una prima risposta che ha `"courses":["antipasto"]` e una seconda valida → una chiamata di riparazione e risultato valido (2 chiamate); con due risposte invalide → `LlmError` `invalid_output`; con 0 o 11 item → `RangeError` senza chiamate; con `vi.stubEnv('LLM_MODEL', '')` e senza `model` → `LlmError` `config`.

### Contratti esposti

`classifyRecipes(items, options?)`, `buildClassifyInstructions`, `buildClassifyPrompt`, `CLASSIFY_DESCRIPTION_MAX` dal barrel `@/lib/llm`.

### Dipendenze

WP1a (`RecipeConstraints.courses`, schemi e tipi di classificazione, `CLASSIFY_BATCH_SIZE`, 12 etichette).

### Criteri di accettazione

Gate verde; test esistenti dell'adapter verdi senza toccare gli attesi; casi nuovi verdi.

### Fuori ambito

Lettura e scrittura delle ricette da classificare (WP6). Registrazione reale (verifica manuale di chiusura). Fixture file nuove.

---

## WP4 — Badge di portata su card e dettaglio (wave 2, parallelo a WP1b, WP3, WP5)

**Obiettivo:** mostrare la portata come badge `basil-subtle` accanto al tempo su card della Libreria, card del pasto, selettore, dettaglio e proposta, senza doppione «Piatto unico».

### File

- Modificare: `components/sheets/recipe-detail.ts`, `components/sheets/recipe-sheet.tsx`, `components/cards/meal-card.tsx`, `components/plan/plan-slot-card.tsx`, `components/library/recipe-card.tsx`.
- Test: `tests/ui/recipe-detail.test.ts`, `tests/ui/recipe-card.test.tsx`, `tests/ui/meal-card-plan.test.tsx`, `tests/ui/plan-slot-card.test.tsx`, `tests/ui/recipe-sheet.test.tsx`.

### Pattern di riferimento

Badge opzionale `saffron-subtle` di `RecipeCard` (id, `aria-labelledby`); badge del tempo in `MealCard` e `RecipeSheet`.

### Passi

1. **`recipe-detail.ts`.**
   - `recipeChips(recipe: Pick<Recipe, 'tags' | 'diet_flags' | 'courses'>)`: prima di prendere le prime `MAX_STYLE_CHIPS`, togliere `'piatto-unico'` dalle etichette se `recipe.courses.length > 0` (U2). JSDoc: «Fino a 2 tag di stile (ordine della ricetta; senza «Piatto unico» se la ricetta ha una portata, che lo mostra già) + al massimo 1 dieta per priorità.»
   - `toRecipeDetail` e `proposalToRecipeDetail` aggiungono `course: courseLabel(recipe.courses) ?? undefined` (import da `@/lib/domain/courses`).
2. **`recipe-sheet.tsx`.** `RecipeDetail` riceve `course?: string; // portate, già formattate (courseLabel)`. Nella riga dei badge, subito dopo il badge del tempo: `{recipe.course && <Badge variant="basil-subtle" className="text-xs">{recipe.course}</Badge>}`.
3. **`meal-card.tsx`.** `MealCardProps` riceve `course?: string;` (commento «Portate, già formattate: badge accanto al tempo.»), destrutturato. La riga dei tag si mostra se `prepTimeMinutes || course || tags.length > 0`; il badge `<Badge variant="basil-subtle" className="text-[11px] font-medium">{course}</Badge>` va subito dopo il badge del tempo e prima dei tag.
4. **`plan-slot-card.tsx`.** Passare a `MealCard` `course={slot.recipe ? courseLabel(slot.recipe.courses) ?? undefined : undefined}`.
5. **`recipe-card.tsx`.** `const course = courseLabel(recipe.courses);` e `courseId = \`${baseId}-course\``. Subito dopo il badge del tempo (prima del badge opzionale): `{course !== null && <Badge id={courseId} variant="basil-subtle" className="mb-1.5 ml-1.5 text-[11px]">{course}</Badge>}`. In `labelledBy` l'ordine diventa tempo, portata (se c'è), titolo, badge, meta.
6. **Test.**
   - `recipe-detail.test.ts`: `recipeChips` con `courses: ['piatto-unico']` e tags `['piatto-unico','veloce','salutare']` → `['Veloce','Salutare', …dieta]`; con `courses: []` lo stesso input mostra `Piatto unico`; `toRecipeDetail` di una ricetta `['secondo','piatto-unico']` ha `course: 'Piatto unico · Secondo'`, di una non classificata `course: undefined`; `proposalToRecipeDetail` ha `course`.
   - `recipe-card.test.tsx`: una card `courses: ['primo']` mostra «Primo» e il nome accessibile del pulsante lo include; una card `courses: []` non mostra badge di portata.
   - `meal-card-plan.test.tsx` / `plan-slot-card.test.tsx`: la card del pasto con una ricetta `['contorno','secondo']` mostra «Secondo · Contorno»; senza portate nessun badge.
   - `recipe-sheet.test.tsx`: con `course` il badge compare dopo il tempo.

### Contratti esposti

`MealCardProps.course?`, `RecipeDetail.course?`, `recipeChips` con `courses` nel `Pick`.

### Dipendenze

WP1a (`courses` su `Recipe`/`GeneratedRecipe`/`LibraryRecipeCard`, `courseLabel`).

### Criteri di accettazione

Gate verde; spec §7 punto 8, terzo trattino (card con l'etichetta). A 360 px i badge vanno a capo senza overflow (le righe sono già `flex-wrap`; verifica finale da telefono).

### Fuori ambito

Selettore di correzione della portata (D8). Nuove varianti di `Badge`. Modifiche a `slot-recipe-picker.tsx`, `recipe-detail-sheet.tsx`, `recipe-proposal-sheet.tsx` (ereditano il badge da `RecipeCard`, `toRecipeDetail`, `proposalToRecipeDetail`).

---

## WP5 — Filtro *Portata* della Libreria e dodici etichette nelle Impostazioni (wave 2, parallelo a WP1b, WP3, WP4)

**Obiettivo:** filtrare la Libreria per portata (OR dentro il gruppo, AND con gli altri) via UI e via `GET /api/recipes`, e verificare le dodici etichette in Impostazioni e API.

### File

- Modificare: `lib/domain/library.ts` (`matchesLibraryFilter`, `parseLibraryQuery`), `components/library/library-filters.tsx`, `components/library/library-screen.tsx` (`hasFilterCriteria`).
- Test: `tests/domain/library.test.ts`, `tests/ui/library-filters.test.tsx`, `tests/ui/library-screen.test.tsx`, `tests/api/recipes.test.ts` (solo il caso del filtro), `tests/ui/settings-fields.test.tsx`, `tests/api/settings.test.ts`.

### Pattern di riferimento

Gruppo "Dieta" in `library-filters.tsx` (`ChipFilter`, `toggled`); `meals`/`tags` in `matchesLibraryFilter` e `parseLibraryQuery`.

### Passi

1. **`matchesLibraryFilter`**: dopo il controllo dei pasti, `if (filter.courses.length > 0 && !card.courses.some((course) => filter.courses.includes(course))) return false;` con commento `// Portate in OR: basta una. Una ricetta non classificata non corrisponde.`
2. **`parseLibraryQuery`**: `courses: distinct(params.getAll('portata')),` (un valore fuori elenco produce `ok: false`, come gli altri).
3. **`library-filters.tsx`**: `panelCount` somma `filter.courses.length`; nel pannello, **primo gruppo** prima di "Tipo di pasti": titolo `Portata` con `GROUP_TITLE_CLASS`, chip per `COURSE_VALUES` con `COURSE_LABELS`, `isSelected={filter.courses.includes(course)}`, `onClick` → `onFilterChange({ ...filter, courses: toggled(filter.courses, course) })`.
4. **`library-screen.tsx`**: `hasFilterCriteria` include `filter.courses.length > 0`.
5. **Test.**
   - `library.test.ts`: `['primo']` + `['secondo']` filtrando `courses: ['primo','secondo']` → entrambe; con `courses: ['primo']` e `meals: ['cena']` → AND; card `courses: []` esclusa da qualsiasi filtro di portata; `parseLibraryQuery(new URLSearchParams('portata=primo&portata=primo&portata=secondo'))` → `courses: ['primo','secondo']`; `portata=antipasto` → `ok: false`.
   - `library-filters.test.tsx`: aprendo *Filtri* compare il gruppo «Portata» con 4 chip; toccare «Contorno» chiama `onFilterChange` con `courses: ['contorno']`; il contatore diventa «Filtri · 1».
   - `library-screen.test.tsx`: con un filtro di portata attivo vale lo stato "filtri attivi" (stessa asserzione usata per le diete).
   - `recipes.test.ts` (API): `GET /api/recipes?portata=primo` restituisce solo le card con `primo`; ogni card ha `courses`; `?portata=xyz` → 400 come gli altri parametri non validi.
   - `settings-fields.test.tsx`: il gruppo "Tipo di pasti" mostra 12 chip, comprese «Si prepara in anticipo» e «Piatto freddo».
   - `settings.test.ts` (API): `PUT /api/settings` con `meal_style_tags: ['tradizionale','piatto-freddo']` salva e rilegge; con `['brunch']` → 400.

### Contratti esposti

Parametro di query `portata` di `GET /api/recipes`.

### Dipendenze

WP1a (`LibraryFilter.courses`, `LibraryRecipeCard.courses`, `COURSE_*`, 12 etichette). Il caso API `GET /api/recipes?portata=…` ha bisogno di ricette con `courses` nel DB, che arriva con WP1b nella stessa wave: se al momento del gate di WP5 la colonna non c'è ancora, quel caso si scrive sul livello di servizio con `vi.mock` di `listLibraryCards` e card costruite con `makeLibraryCard`, e lo si segnala nel resoconto.

### Criteri di accettazione

Gate verde; spec §7 punti 8 (primi due trattini) e 9.

### Fuori ambito

Ordinamento per portata; riga rapida con le portate; cambio dei gruppi esistenti da AND a OR (U3).

---

## WP6 — Classificazione delle ricette esistenti: servizio, avvio, script (wave 3, parallelo a WP2, WP7)

**Obiettivo:** classificare in background all'avvio di produzione, e a mano con `pnpm recipes:classify`, le ricette con `courses` vuoto.

### File

- Creare: `lib/recipes/classify.ts`, `scripts/classify-recipes.ts`, `tests/recipes/classify.test.ts`.
- Modificare: `instrumentation.ts`, `lib/db/index.ts`, `package.json` (solo lo script), `tests/instrumentation.test.ts`.

### Pattern di riferimento

Dipendenze iniettabili di `lib/recipes/propose.ts` (`ProposeRecipeDeps`); script con `.env` di `lib/db/seed.ts` (import dinamico di `lib/db/index`, `client.end()` nel `finally`); test di `instrumentation` con `vi.mock`.

### Passi

1. **`lib/recipes/classify.ts`** (`// Solo lato server: classificazione delle ricette salvate prima della Feature 8 (portate ed etichette).`):
   ```ts
   export interface ClassifyReport {
     /** Ricette non classificate trovate all'inizio. */
     pending: number;
     /** Ricette scritte da questa esecuzione. */
     classified: number;
     /** pending - classified. */
     remaining: number;
     /** Lotti falliti (timeout, rete, risposta non valida). */
     failedBatches: number;
     /** true se la classificazione non è partita perché il modello non è configurato. */
     notConfigured: boolean;
   }

   export interface ClassifyDeps {
     /** Default: singleton. */
     householdId?: string;
     model?: GenerateRecipesOptions['model'];
     /** Default: `classifyRecipes`. */
     classify?: typeof classifyRecipes;
     /** Default: CLASSIFY_BATCH_SIZE. */
     batchSize?: number;
     /** Default: console. */
     logger?: Pick<Console, 'log' | 'warn'>;
   }

   export async function classifyPendingRecipes(deps: ClassifyDeps = {}): Promise<ClassifyReport>;
   ```
   Flusso esatto:
   1. `household = await loadHousehold(deps.householdId)`; `pending = await listUnclassifiedRecipes(db, household.id)`.
   2. Se `pending.length === 0`: `logger.log('[classify] nessuna ricetta da classificare')`; restituire tutti zero, `notConfigured: false`. Nessuna risoluzione del modello.
   3. `logger.log(\`[classify] ricette da classificare: ${n}\`)`.
   4. Modello: `deps.model ?? getModel()` in un `try`. Se lancia un `LlmError` con `code === 'config'`: `logger.warn(\`[classify] modello non configurato (${err.message}): ${n} ricette restano senza portata\`)` e restituire `{ pending: n, classified: 0, remaining: n, failedBatches: 0, notConfigured: true }`. Altri errori: rilanciare.
   5. Dividere `pending` in lotti di `batchSize` nell'ordine ricevuto; per ogni lotto `i` (1-based) su `total`, **in sequenza** (mai in parallelo):
      - riferimenti `r1`…`rK` → ricetta; `items` con `ref`, `title`, `description`, `meal_types`, `tags`, `ingredient_names` = nomi canonici normalizzati (`normalizeCanonicalName`), distinti, nell'ordine;
      - `rows = await classify(items, { model })`; su eccezione: `failedBatches++`, `logger.warn(\`[classify] lotto ${i}/${total} non classificato: ${reason}\`)` con `reason` = `` `${err.code}: ${err.message}` `` per un `LlmError`, `err.message` per un `Error`, `String(err)` altrimenti; passare al lotto successivo;
      - per ogni riga, nell'ordine: scartare se `ref` non è del lotto o è già stato visto in questo lotto (la prima occorrenza vince); `courses = normalizeCourses(row.courses)`, scartare se vuoto; `tags = deriveStyleTags([...recipe.tags, ...row.style_tags], courses, recipe.ingredients)`; `if (await setRecipeClassification(db, recipe.id, courses, tags)) classified++`. Nessuna transazione unica.
   6. `logger.log(\`[classify] classificate: ${classified}, rimaste: ${n - classified}\`)` e restituire il rapporto.
   Import: `db` da `@/lib/db`, `loadHousehold`, `listUnclassifiedRecipes`, `setRecipeClassification`, `CLASSIFY_BATCH_SIZE`, `normalizeCourses`, `deriveStyleTags`, `normalizeCanonicalName`, e da `@/lib/llm` `classifyRecipes`, `getModel`, `isLlmError`, `type GenerateRecipesOptions`. Non riesportarlo da `lib/recipes/index.ts`.
2. **`instrumentation.ts`.** Dentro il `try` del bootstrap, subito dopo il `console.log` di bootstrap riuscito (così con un bootstrap fallito la classificazione non parte, anche nei test dove `process.exit` è finto), avviare la classificazione **in un `try/catch` proprio** e senza attenderla:
   ```ts
   // Classificazione delle ricette senza portata (Feature 8): in background, la partenza non la aspetta.
   try {
     const { classifyPendingRecipes } = await import('./lib/recipes/classify');
     void classifyPendingRecipes().catch((err) => {
       console.error('[classify] classificazione interrotta', err);
     });
   } catch (err) {
     console.error('[classify] classificazione interrotta', err);
   }
   ```
   L'`import` dinamico è atteso (è veloce), la classificazione no. Un errore dell'import o della classificazione non arriva mai al `catch` del bootstrap né a `process.exit`. Aggiornare il commento in testa al file con «e avvia in background la classificazione delle ricette senza portata».
3. **`scripts/classify-recipes.ts`** (uso: `pnpm recipes:classify`): carica `.env.local` e `.env` come `lib/db/seed.ts`; importa dinamicamente `@/lib/db` (per `client`) e `@/lib/recipes/classify`; chiama `classifyPendingRecipes()`; stampa `` `Classificazione completata — trovate: ${pending}, classificate: ${classified}, rimaste: ${remaining}, lotti falliti: ${failedBatches}` ``; `process.exitCode = 1` se `notConfigured && remaining > 0`; su eccezione `console.error('Classificazione fallita:', err)` e `process.exitCode = 1`; `client.end()` nel `finally`.
4. **`package.json`**: `"recipes:classify": "tsx scripts/classify-recipes.ts"` dopo `llm:record`.
4bis. **`lib/db/index.ts` — un solo pool per processo (review P4).** Sostituire le due righe del singleton con `globalForDb.conn ??= postgres(connectionString);` e `export const client = globalForDb.conn;`, togliendo la condizione su `NODE_ENV`. Commento: `// Un solo pool per processo, anche se Next carica il modulo da più grafi (l'hook di avvio e le rotte) o lo ricarica con l'HMR.` Nessun altro cambiamento.
5. **Test.**
   - `tests/recipes/classify.test.ts` (`// @vitest-environment node`, `describe.skipIf(!dbUp)`, household di test, `logger` finto con `vi.fn()`, `model` = un `MockLanguageModelV4` qualsiasi da `createRecordedModel([])`, `classify` finto):
     - 23 ricette non classificate (create con `insertRecipe`, `courses: []`) → `classify` chiamato 3 volte con 10, 10, 3 item e riferimenti `r1`…; il finto risponde per ogni `ref` con `courses: ['secondo']`, `style_tags: ['tradizionale']`, e per la prima ricetta del primo lotto `courses: ['piatto-unico']`: alla fine `classified: 23`, `remaining: 0`; una ricetta rilette ha `tradizionale` aggiunto alle etichette che aveva; la ricetta `piatto-unico` ha l'etichetta `piatto-unico`; una ricetta con tag `piatto-unico` iniziale e classificata `['secondo']` lo perde.
     - Secondo lotto che lancia `new LlmError('timeout', '…')` → `failedBatches: 1`, `classified: 13`, `remaining: 10`, le 10 del lotto restano con `courses` vuoto; `logger.warn` chiamato con una riga che inizia per `[classify] lotto 2/3 non classificato: timeout`.
     - Righe con `ref: 'r99'`, `ref` ripetuto (vince la prima), `courses: []` → ignorate senza errori.
     - Una ricetta classificata tra la lettura e la scrittura (il finto `classify`, prima di rispondere, fa `setRecipeClassification` di quella ricetta con `['primo']`) → resta `['primo']` e non conta in `classified`.
     - Modello non configurato: `vi.stubEnv('LLM_MODEL', '')`, nessun `model` nei deps, `classify` spia → mai chiamata; rapporto `notConfigured: true`, `remaining` uguale alle pending; `logger.warn` con `[classify] modello non configurato`.
     - Nessuna pending → `logger.log('[classify] nessuna ricetta da classificare')`, `classify` mai chiamata, `getModel` non serve (nessuno stub di env).
   - `tests/instrumentation.test.ts`: mockare anche `@/lib/recipes/classify` (`classifyPendingRecipes: vi.fn()`). Casi: dopo un bootstrap riuscito `classifyPendingRecipes` è chiamata una volta; con `classifyPendingRecipes` che restituisce una promessa mai risolta, `register()` si risolve comunque (non la aspetta); con una promessa rifiutata, `console.error('[classify] classificazione interrotta', err)` e `process.exit` mai chiamato (attendere un tick con `await Promise.resolve()`/`vi.waitFor`); con bootstrap fallito la classificazione non parte; fuori da `nodejs` o senza `DB_BOOTSTRAP_ON_START=true` non parte. Mockare `@/lib/recipes/classify` come si fa già per `@/lib/db/bootstrap`: Vitest risolve `./lib/...` e `@/lib/...` allo stesso file.

### Contratti esposti

`classifyPendingRecipes(deps?)`, `ClassifyReport`, `ClassifyDeps`; comando `pnpm recipes:classify`; righe di log `[classify]` (testi esatti sopra).

### Dipendenze

WP1a (tipi, regole), WP1b (repository, colonna), WP3 (`classifyRecipes` dal barrel `@/lib/llm`).

### Criteri di accettazione

Gate verde; spec §7 punti 4 e 5. Con il DB di sviluppo e una chiave valida, `pnpm recipes:classify` classifica le ricette senza portata (verifica manuale).

### Fuori ambito

Interfaccia (FR-4.8), riclassificazione di ricette già classificate, lotti in parallelo, rotte API.

---

## WP7 — Documenti (wave 3, parallelo a WP2, WP6)

**Obiettivo:** allineare architettura, guida di deploy e comandi alla feature.

### File

`docs/ARCHITECTURE.md`, `docs/DEPLOY.md`, `CLAUDE.md`.

### Passi

1. **`ARCHITECTURE.md`**:
   - §4.2: colonna `recipes.courses text[] NOT NULL DEFAULT '{}'` (vuoto = non classificata), elenco delle portate e delle portate principali, etichette di stile a 12, regole derivate (`pochi-ingredienti` ≤ 6 ingredienti non `qb`; `piatto-unico` legata alla portata sulle ricette classificate), con il rimando a `lib/domain/courses.ts`.
   - §5.1: `courses` nell'output di generazione (almeno una) e nei vincoli (`null` = qualsiasi; piano e swap: portate principali; richiesta dal Piano: principali; dalla Libreria: qualsiasi); violazione «portata non adatta al pasto»; regole derivate applicate in `insertGeneratedRecipe`.
   - §5.2: motivo di esclusione `course` dopo `meal_type`; le ricette solo contorno non contano tra le fresche; fino alla Feature 11.
   - Nuovo paragrafo in §3 o §7 (dove si parla dell'avvio/LLM): classificazione in background all'avvio di produzione dopo il bootstrap, lotti da 10 in sequenza, nuovo tentativo al riavvio, `pnpm recipes:classify`.
2. **`DEPLOY.md`**: in §5 una riga «Classificazione delle ricette» → nei log dell'app (`bash scripts/compose-prod.sh logs app`) compaiono `[classify] ricette da classificare: N` e `[classify] classificate: X, rimaste: Y` (oppure `nessuna ricetta da classificare`); le rimaste si riprovano al riavvio. In §6, dopo il paragrafo «Le migrazioni del database non tornano indietro…», aggiungere: «Anche i dati possono impedire il ritorno: dalla 0.8 le ricette e le Impostazioni contengono etichette e portate che le versioni precedenti non conoscono, e la Libreria non si aprirebbe. Tornando a una versione precedente alla 0.8, ripristina sempre il dump `predeploy`.» (review R3; se la versione di rilascio non sarà 0.8.0, usare quella reale). In §9 una riga per `[classify] modello non configurato` (variabili `LLM_*` mancanti: l'app funziona, le ricette restano senza portata e sono ammesse nel piano) e una per `[classify] lotto … non classificato` (rete o timeout: si riprova al riavvio).
3. **`CLAUDE.md`**, sezione Comandi, dopo `pnpm llm:record`: `pnpm recipes:classify  # classifica (portate + etichette) le ricette senza portata sul DB di DATABASE_URL; in produzione lo fa l'app all'avvio (richiede chiave API)`.

### Dipendenze

WP1a–WP6 come contenuto (testi esatti del log da WP6, nomi da WP1a/WP1b). Si scrive in parallelo a WP6 usando i testi di questo piano.

### Criteri di accettazione

Documenti in italiano, nel tono esistente; nessun riferimento a nomi che non esistono nel codice.

### Fuori ambito

Wiki (`docs/wiki/`): la aggiorna `/feature-docs` nella chiusura. `feature-index.md` e versione: li gestisce `/feature-dev` alla chiusura.

---

## Riuso obbligatorio (non reimplementare)

| Serve | Usare |
|---|---|
| Ordine e doppioni delle portate | `normalizeCourses` (`lib/domain/courses.ts`) |
| "Fa da pasto?" / "portata ammessa?" | `isMainDish` e `coursesAllowed` — mai confronti tra elenchi di portate scritti a mano |
| Etichetta delle portate | `courseLabel` + `COURSE_LABELS` |
| Regole `pochi-ingredienti` / `piatto-unico` | `deriveStyleTags` |
| Ammissione nel piano, swap, candidate, assegnazione | `exclusionReason` / `manualChoiceExclusionReason` (solo WP2 li tocca) |
| Vincoli di generazione | `buildConstraints` + `findConstraintViolations` |
| Scrittura di una ricetta generata | `insertGeneratedRecipe` |
| Chiamata strutturata con riparazione | `runStructuredCall` privata dell'adapter |
| Testo su una riga nei prompt | `toSingleLine` di `prompts.ts` |
| Nomi canonici degli ingredienti | `normalizeCanonicalName` |
| DB usa-e-getta e migrazioni parziali nei test | schema di `tests/db/bootstrap.test.ts` |
| Modello finto | `createRecordedModel` (`tests/helpers/mock-llm.ts`) |

## Contratti consegnati alle feature successive

- **Feature 10 (pacchetto)**: ricette con `courses` (almeno una) e le 12 etichette; scrittura tramite `insertGeneratedRecipe` (regole derivate incluse); `FixtureRecipeSchema` con `courses`. Attenzione (emerso nella documentazione): `insertGeneratedRecipe` scrive sempre `source: 'llm'`, mentre le ricette del dataset non sono generate: la Feature 10 deve decidere se aggiungere un parametro `source` o un percorso di scrittura proprio, che applichi comunque `normalizeCourses` e `deriveStyleTags`.
- **Feature 11 (composizione)**: `Course`, `COURSE_VALUES`, `MAIN_COURSE_VALUES`, `coursesAllowed` (unico predicato di portata: la F11 cambia solo l'elenco ammesso per slot), `isMainDish` e il motivo `course` di `exclusionReason` da trasformare in "ha la portata dello slot"; `RecipeConstraints.courses` per generare contorni; l'etichetta di stile `piatto-unico` da togliere. **Togliere `piatto-unico` da `MEAL_STYLE_TAG_VALUES` richiede, nello stesso rilascio, una migrazione che lo rimuova da `recipes.tags` e `households.meal_style_tags`**: `toRecipeWithDetails` e `HouseholdSchema.parse` rifiutano i valori sconosciuti e la Libreria non si aprirebbe (review R3).

## Mappa delle dipendenze

```
Wave 1:  WP1a
            │
Wave 2:  WP1b   WP3   WP4   WP5    (paralleli: file disgiunti)
            │     │
Wave 3:  WP2    WP6   WP7          (paralleli; WP2 richiede WP1b; WP6 richiede WP1b + WP3)
```

- **Sequenziale stretto**: WP1a prima di tutto; WP1b prima di WP2 e WP6; WP3 prima di WP6.
- **Paralleli in wave 2**: WP1b (`lib/db/*`, `tests/db/*`), WP3 (`lib/llm/*`, `scripts/llm-record.ts`, `tests/llm/*`), WP4 (componenti di card e sheet e i loro `tests/ui/*`), WP5 (`lib/domain/library.ts`, filtri, `tests/domain/library.test.ts`, `tests/ui/library-*`, `tests/ui/settings-fields.test.tsx`, `tests/api/recipes.test.ts`, `tests/api/settings.test.ts`). Nessun file in comune.
- **Paralleli in wave 3**: WP2 (`planner`, `lib/recipes/{constraints,generate,propose,store}.ts`, `tests/domain/planner.test.ts`, `tests/recipes/{constraints,generate,propose}.test.ts`, `tests/plans/*`), WP6 (`lib/recipes/classify.ts`, `instrumentation.ts`, `lib/db/index.ts`, `scripts/classify-recipes.ts`, `package.json`, `tests/recipes/classify.test.ts`, `tests/instrumentation.test.ts`), WP7 (documenti).

## Checklist finale

- [ ] **WP1a** — `COURSE_*`, `MAIN_COURSE_VALUES`, 12 etichette, campi `courses` (Recipe, Generated, Saved, Constraints, Filter, Card), schemi di classificazione, `CLASSIFY_BATCH_SIZE`; `lib/domain/courses.ts` (con `coursesAllowed`) + test; `tests/helpers/recipes.ts`; `normalizeGeneratedRecipe` normalizza le portate; `toLibraryCard.courses`; `buildConstraints` con `courses: null`; fixture ricette (tabella) + test; fixture LLM; ritocchi dei test per il solo campo nuovo.
- [ ] **WP1b** — colonna + migrazione `0005` (ALTER + UPDATE) + test su DB usa-e-getta; `InsertRecipeInput.courses`, `listUnclassifiedRecipes`, `setRecipeClassification` + test; seed con regole e completamento + test (azzera solo `courses`).
- [ ] **WP2** — motivo `course`; `buildConstraints` a 5 parametri; violazione «portata non adatta al pasto»; `MAIN_COURSE_VALUES` in generate e propose (dal Piano); etichette derivate nella proposta e nello store; test di planner, vincoli, generate, propose, swap, candidate, assegnazione.
- [ ] **WP3** — istruzioni con `courses` e 12 etichette; riga *Portata* nei due prompt utente; prompt di classificazione; `runStructuredCall`; `classifyRecipes`; barrel; `llm-record` con `courses`; test.
- [ ] **WP4** — `recipeChips` senza doppione; `course` in `RecipeDetail`, `MealCard`, `RecipeCard`, `PlanSlotCard`; badge `basil-subtle`; test.
- [ ] **WP5** — filtro OR per portata, parametro `portata`, gruppo *Portata* primo nel pannello, contatore, `hasFilterCriteria`; test di Libreria, API e Impostazioni (12 etichette).
- [ ] **WP6** — `classifyPendingRecipes` con log esatti; avvio in background in `instrumentation.ts`; pool singleton anche in produzione (`lib/db/index.ts`); `scripts/classify-recipes.ts`; `pnpm recipes:classify`; test.
- [ ] **WP7** — ARCHITECTURE §4.2, §5.1, §5.2 e avvio; DEPLOY §5, §6 (ritorno indietro solo con il dump) e §9; CLAUDE.md Comandi.
- [ ] **Chiusura** (orchestratore) — gate completo, wiki con `/feature-docs`, versione, `feature-index.md`, verifiche manuali di `requirements.md` §5.

## Autoverifica

- Ogni FR della spec ha un WP: FR-1 → WP1a/WP1b (+ WP3 per FR-1.3); FR-2 → WP1a (regole, fixture), WP1b (migrazione, seed), WP2 (store, proposta), WP3 (prompt), WP4/WP5 (UI); FR-3 → WP2 (FR-3.1–3.5) e WP3 (prompt della portata); FR-4 → WP3 (adapter) e WP6; FR-5 → WP1a (fixture) e WP1b (migrazione, seed); FR-6 → WP4, WP5. Spec §7 punti 1–9 coperti dai test dei WP; 10–13 in `requirements.md` §5.
- Le domande di Phase B hanno una risposta: aspetto della portata (U1), doppione «Piatto unico» (U2), semantica del filtro (U3); le altre sono decise in P1–P24.
- Nessuna decisione rinviata: firme, testi di log, prompt, valori delle fixture e ordine di esecuzione sono scritti per intero.
