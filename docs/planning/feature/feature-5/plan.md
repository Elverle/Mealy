# Feature 5 — E2 Libreria e preferenze · Piano di implementazione

**Data:** 2026-10-05 · **Stato:** planned · **Input di:** `/arch-review 5` → `/feature-dev 5`
**Story:** S2.1 Libreria UI · S2.2 Preferenze · S2.3 Preferenze ingredienti (`docs/BACKLOG.md`)
**Decisioni motivate:** [`requirements.md`](requirements.md) (U1–U4 dell'utente, P1–P21 di planning), recepite qui come definitive.
**Innesti applicati in implementazione:** dove questo testo e il codice differiscono (per esempio `buildLibraryQuery` / `fetchLibrary` / `fetchIngredientPrefs` non esistono, e i test di WP4 usano un household dedicato) vale [`architecture-review-2026-10-05.md`](architecture-review-2026-10-05.md), tabella "Riepilogo dell'impatto sul piano".

---

## 0. Contesto per chi implementa (leggere tutto prima del proprio WP)

### 0.1 Obiettivo
La libreria diventa navigabile e giudicabile. Tre risultati:
1. **Libreria reale** al posto dei dati finti: ricerca, filtri, card, dettaglio con quantità scalate sulle persone.
2. **Preferenze sulla ricetta** (voto 1–5, ★ preferita, *Non proporre più*) salvate e usate dal planner, attive in Libreria **e** nel Piano.
3. **Preferenze sull'ingrediente** (👍/👎 sul `canonical_name`): tabella nuova, API, conferma con impatto, sezione *I miei ingredienti*, e cablaggio in planner (scarto = esclusione, gradimento = peso maggiore) e generazione LLM (lo scarto non viene più né proposto né generato).

### 0.2 Stato del codice su cui si lavora
Se un nome qui sotto differisce nel codice reale, **vince il codice reale**: adeguarsi mantenendo il comportamento descritto.
- Next.js **15.5** App Router (root senza `src/`, alias `@/*` → `./*`), React 19, zod **3.25**, drizzle-orm **0.45** + drizzle-kit 0.30 + postgres.js, Vitest **4.1** (ambiente globale **jsdom**; i test lato server iniziano con `// @vitest-environment node`), Testing Library, Tailwind v4 con token `paper / ink / basil / tomato / saffron / stone`, icone `lucide-react`.
- **Rotte dinamiche Next 15**: `{ params }: { params: Promise<{ id: string }> }`, da attendere. Modello: `app/api/plans/[id]/slots/[slotId]/route.ts`.
- `lib/domain/types.ts` — schemi Zod e tipi. Esistono già: `IngredientPrefSchema` / `IngredientPref` (`'like' | 'dislike'`), `RecipePrefSchema` / `RecipePref` (`recipe_id, rating, favorite, blocked, times_used, last_used_at` con `z.coerce.date()`), `RecipeSchema` / `Recipe` (con `ingredients?` e `prefs?`, `created_at` con `z.coerce.date()`), `IngredientSchema`, `MealTypeSchema`, `MealStyleTagSchema`, `DietFlagSchema`, le etichette `MEAL_TYPE_LABELS`, `MEAL_STYLE_TAG_LABELS`, `DIET_FLAG_LABELS`, `RecipeConstraintsSchema` (con `ingredient_likes` / `ingredient_dislikes`), `IsoDateSchema`.
- `lib/domain/recipe-text.ts` — `normalizeTitle(title)` (toglie gli accenti, minuscolo, tutto ciò che non è `a-z0-9` diventa uno spazio, trim), `normalizeCanonicalName(name)` (trim, minuscolo, spazi compressi; conserva gli accenti), `expandDietFlags(flags)` (vegano ⇒ vegetariano + senza-lattosio; vegetariano ⇒ pescetariano).
- `lib/domain/planner.ts` — **già predisposto**: `IngredientPreferenceSets { likes, dislikes }`, `EMPTY_INGREDIENT_PREFERENCES`, `toIngredientPreferenceSets(likes, dislikes)`, `exclusionReason` (scarta `blocked` e le ricette con un ingrediente in `dislikes`), `recipeWeight` (fattore `ingredientAffinity`), `selectRecipes`. **L'algoritmo non si modifica.**
- `lib/prefs/ingredient-prefs.ts` — `loadIngredientPreferences(householdId, executor = db)`: oggi restituisce sempre insiemi vuoti. È chiamata da `lib/plans/service.ts` (righe ~264 e ~275: fuori e dentro il lock del piano).
- `lib/recipes/constraints.ts` — `buildConstraints(household, mealType, overrides?)` scrive `ingredient_likes: []` e `ingredient_dislikes: []`; `findConstraintViolations` scarta già le ricette generate che contengono un ingrediente escluso (messaggio `contiene "<nome>" (ingrediente escluso)`). `lib/recipes/generate.ts` — `generateAndStoreRecipes(input, deps?)`. `lib/llm/prompts.ts` — `buildRecipePrompt` scrive già le righe `- Ingredienti graditi: a, b (privilegiali quando sensato).` e `- Ingredienti da non usare mai: a, b.`.
- `lib/db/schema.ts` — 9 tabelle; `recipe_prefs` (`recipe_id` PK). Nessuna `ingredient_prefs`. `lib/db/index.ts` esporta `db`, `client`, `DbExecutor` e riesporta lo schema. Migrazioni `0000`–`0003` in `lib/db/migrations/` (generate con drizzle-kit, con `meta/NNNN_snapshot.json` e `meta/_journal.json`).
- `lib/db/repositories/recipe-repo.ts` — `RecipeWithDetails`, `toRecipeWithDetails`, `listRecipes({ household_id })`, `listRecipesWith(executor, …)`, `insertRecipe`, `getRecipeById(id)`. `lib/db/repositories/household-repo.ts` — `loadHousehold(id?)` (id assente → singleton di default; id sconosciuto → `Error`).
- `lib/http/responses.ts` (server) — `errorResponse(status, code, message, details?)`, `invalidRequestResponse(issues?)`, `internalErrorResponse()`, `readJsonBody(request, { allowEmpty })`. `lib/http/client.ts` (client) — `requestJson(url, init, schema)` e `ApiRequestError(status, code, message)` (rete: `status 0`, `network_error`).
- `lib/plans/client.ts` — **modello** per i client fetch; `lib/settings/service.ts` — modello di servizio; `app/api/settings/route.ts` — modello di rotta (`runtime`, `dynamic`, try/catch).
- UI: `components/sheets/recipe-sheet.tsx` (`RecipeSheet` presentazionale: ha già barra azioni e 👍/👎, mostrati solo se riceve gli handler; tipi `RecipeDetail`, `RecipeIngredient`), `components/sheets/recipe-detail.ts` (`recipeChips`, `toRecipeDetail(recipe, servings)`), `components/cards/meal-card.tsx` (★ mostrata solo con `onToggleFavorite`), `components/plan/plan-slot-card.tsx`, `components/plan/plan-screen.tsx` (apre `RecipeSheet` senza handler), `components/filters/chip-filter.tsx` (`role="checkbox"`), `components/feedback/{toast,empty-state}.tsx`, `components/ui/{button,badge,card,sheet}.tsx`.
- `app/(app)/libreria/page.tsx` — **pagina finta** (`"use client"`, `MOCK_RECIPES`): da sostituire. `app/(app)/impostazioni/page.tsx` e `app/(app)/page.tsx` — modelli di pagina server (`await connection()` + servizio + componente client). `components/settings/settings-editor.tsx` monta `IngredientPrefsPlaceholder` in fondo.
- Helper di test: `tests/helpers/db.ts` (`isDbAvailable`, `assertDbMigrated`, `createTestHousehold(overrides?)`, `deleteTestHousehold(id)`), `tests/helpers/plans.ts` (`insertTestRecipe(householdId, spec)`, `insertTestRecipes(householdId, count, spec)`; l'ingrediente di default di ogni ricetta di test è `sale`), `tests/helpers/mock-llm.ts` (`loadLlmRecording(name)`, `createRecordedModel(responses)`). Modello di test DB: `tests/plans/service.test.ts` (`const dbUp = await isDbAvailable(); describe.skipIf(!dbUp)`, household dedicati eliminati in `afterEach`, `now`/`rng`/`generate` iniettati). Modello di test di rotta: `tests/api/settings.test.ts` (`vi.mock` del servizio). Modello di test di pagina server: `tests/app/settings-page.test.tsx`. Modello di test di client fetch: `tests/plans/client.test.ts`.
- Test esistenti coinvolti: `tests/ui/shell.test.tsx` (blocchi "RecipeSheet" e "Pages Integration": monta `LibraryPage` e `SettingsEditor`), `tests/ui/plan-screen.test.tsx` (blocco "recipe sheet and preferences"), `tests/ui/plan-slot-card.test.tsx`, `tests/ui/settings-editor.test.tsx`, `tests/app/settings-page.test.tsx`, `tests/ui/recipe-detail.test.ts`, `tests/db/schema.test.ts` ("exports all 9 required tables"), `tests/recipes/{constraints,generate}.test.ts`.

### 0.3 Regole vincolanti
1. Tipi e schemi di dominio e i DTO delle API **solo** in `lib/domain/types.ts`. Le interfacce di funzione e i tipi riga dei repository vivono nei rispettivi moduli, costruiti a partire dai tipi di `types.ts`.
2. `lib/domain/*` è **puro**: nessun import da `lib/db`, `lib/llm`, `lib/recipes`, `next/*`; niente rete, orologio o `Math.random()`.
3. `planner` e `prefs` non chiamano mai l'LLM. `lib/llm/` **non si modifica** in questa feature. `lib/domain/planner.ts` cambia solo in un commento (WP2).
4. I componenti client (`"use client"`) importano da `lib/library/` e `lib/prefs/` **solo** `client.ts`; mai `service.ts` né `ingredient-prefs.ts`. Non creare `index.ts` in quelle cartelle.
5. UI copy in italiano, **esattamente** come scritta nel piano (compresi `…` U+2026 e `·` U+00B7). Tap target ≥ 44 px, focus visibile (`focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-basil`), animazioni con `motion-reduce:animate-none`.
6. Un giudizio non modifica mai un piano esistente e non tocca `households.updated_at` (requirements U2): nessuna chiamata a `lib/plans/service.ts` dai moduli di questa feature.
7. Gate per ogni wave: `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build` verdi. Test DB: Postgres di `docker-compose.dev.yml` attivo e `pnpm db:migrate`. **Su questa macchina la porta 5432 è occupata da un altro progetto**: avviare il Postgres di Mealy sulla 5433 con un override (`services.postgres.ports: !override ["5433:5432"]`) e lanciare migrate/test/build con `DATABASE_URL=postgresql://mealy:mealy@localhost:5433/mealy_dev`. In CI (`.github/workflows/gate.yml`) lo stesso gate gira su ogni pull request.

### 0.4 Glossario
- **Nome canonico**: `canonical_name` passato per `normalizeCanonicalName`. È la chiave delle preferenze ingrediente. Gli alias (`ingredient_aliases`) **non** si risolvono.
- **Giudizio**: una preferenza ricetta (voto, preferita, bloccata) o ingrediente (`like` = 👍 gradito, `dislike` = 👎 scartato).
- **Impatto** di un ingrediente (`recipes_count`): numero di ricette **non bloccate** della libreria dell'household che lo contengono.
- **Card di libreria**: `LibraryRecipeCard`, la vista leggera di una ricetta. **Dettaglio**: `RecipeDetailView`, ricetta completa più pref e impatto di ogni suo ingrediente.

### 0.5 Mappa dei work package
| WP | Wave | Story | Contenuto |
|---|---|---|---|
| WP1 | 1 | S2.1–S2.3 (contratti) | Tipi in `types.ts`, funzioni pure `library.ts` e `prefs.ts`, client fetch |
| WP2 | 1 | S2.3 (dati) + S2.2 (dati) | Tabella `ingredient_prefs` + migrazione `0004`, repository, `loadIngredientPreferences` reale, test di cablaggio col planner |
| WP3 | 2 | S2.1–S2.3 (server) | Servizi libreria e preferenze, 5 rotte API |
| WP4 | 2 | S2.3 (LLM) | Like/dislike nei vincoli di generazione |
| WP5 | 2 | S2.1–S2.3 (mattoni UI) | `RecipeSheet` (aggiunte), `recipe-detail.ts`, `RecipeDetailSheet` |
| WP6 | 3 | S2.1 + S2.2 | Pagina e schermata Libreria, card, filtri |
| WP7 | 3 | S2.2 + S2.3 | Preferenze nel Piano (★ sulla card, dettaglio completo) |
| WP8 | 3 | S2.3 | Sezione *I miei ingredienti* nelle Impostazioni |

---

## WP1 — Contratti, funzioni pure e client fetch (wave 1, parallelo a WP2)

**Obiettivo:** scrivere tutti i contratti di F5 in `types.ts`, le regole pure di filtro, ricerca, ordinamento e preferenze, e i client fetch che la UI userà.

### File
- `lib/domain/types.ts` — **modifica** (blocco in coda + un commento)
- `lib/domain/library.ts`, `lib/domain/prefs.ts` — nuovi
- `lib/library/client.ts`, `lib/prefs/client.ts` — nuovi
- `tests/domain/library.test.ts`, `tests/domain/prefs.test.ts`, `tests/domain/library-contracts.test.ts`, `tests/library/client.test.ts`, `tests/prefs/client.test.ts` — nuovi

### Pattern di riferimento
- Blocchi commentati e `XxxSchema` + `type Xxx = z.infer<…>` come "Meal Plans (Feature 4)" in `lib/domain/types.ts`.
- Funzioni pure con JSDoc in italiano come `lib/domain/planner.ts`; test puri come `tests/domain/recipe-text.test.ts`.
- Client fetch come `lib/plans/client.ts` (ma **senza** sottoclasse d'errore: si lancia `ApiRequestError` così com'è); test come `tests/plans/client.test.ts`.

### Passi

**1. `lib/domain/types.ts`.** Sostituire il commento sopra `RecipeConstraintsSchema` con:
```ts
// Vincoli passati all'adapter. ingredient_likes/dislikes: nomi canonici normalizzati,
// letti da ingredient_prefs (Feature 5, S2.3).
```
Aggiungere in coda al file:
```ts
// ============================================================================
// Library & Preferences (Feature 5)
// ============================================================================

// Filtri della Libreria (GET /api/recipes e filtro in memoria della pagina).
// Tutti i criteri sono in AND. `blocked: true` mostra solo le bloccate, `false` le nasconde.
export const LIBRARY_QUERY_MAX = 100;
export const LibraryFilterSchema = z
  .object({
    q: z.string().max(LIBRARY_QUERY_MAX).default(''),
    meals: z.array(MealTypeSchema).default([]),
    tags: z.array(MealStyleTagSchema).default([]),
    diets: z.array(DietFlagSchema).default([]),
    favorites: z.boolean().default(false),
    blocked: z.boolean().default(false),
  })
  .strict();
export type LibraryFilter = z.infer<typeof LibraryFilterSchema>;

export const EMPTY_LIBRARY_FILTER: LibraryFilter = {
  q: '',
  meals: [],
  tags: [],
  diets: [],
  favorites: false,
  blocked: false,
};

// Vista leggera di una ricetta per la griglia della Libreria.
export const LibraryRecipeCardSchema = z.object({
  id: z.string().uuid(),
  title: z.string().min(1),
  prep_minutes: z.number().int().min(1),
  meal_types: z.array(MealTypeSchema),
  tags: z.array(MealStyleTagSchema),
  diet_flags: z.array(DietFlagSchema),
  ingredient_names: z.array(z.string().min(1)), // nomi canonici normalizzati, distinti, nell'ordine della ricetta
  rating: z.number().int().min(1).max(5).nullable(),
  favorite: z.boolean(),
  blocked: z.boolean(),
  created_at: z.string().datetime(),
});
export type LibraryRecipeCard = z.infer<typeof LibraryRecipeCardSchema>;

// Risposta di GET /api/recipes
export const LibraryViewSchema = z.object({
  recipes: z.array(LibraryRecipeCardSchema), // filtrate e ordinate
  total: z.number().int().min(0), // ricette in libreria senza filtri (bloccate comprese)
});
export type LibraryView = z.infer<typeof LibraryViewSchema>;

// Giudizio e impatto di un ingrediente di una ricetta.
export const INGREDIENT_NAME_MAX = 80;
export const RecipeIngredientInfoSchema = z.object({
  canonical_name: z.string().min(1).max(INGREDIENT_NAME_MAX), // normalizzato
  pref: IngredientPrefSchema.nullable(),
  recipes_count: z.number().int().min(0), // ricette non bloccate della libreria che lo contengono
});
export type RecipeIngredientInfo = z.infer<typeof RecipeIngredientInfoSchema>;

// Risposta di GET /api/recipes/:id
export const RecipeDetailViewSchema = z.object({
  recipe: RecipeSchema, // completa: ingredients e prefs
  ingredients: z.array(RecipeIngredientInfoSchema), // una voce per nome canonico distinto, nell'ordine della ricetta
});
export type RecipeDetailView = z.infer<typeof RecipeDetailViewSchema>;

// Body di PUT /api/recipes/:id/pref: aggiornamento parziale, almeno un campo.
// rating null = togli il voto. Bloccare toglie dalle preferite (v. lib/domain/prefs.ts).
export const UpdateRecipePrefRequestSchema = z
  .object({
    rating: z.number().int().min(1).max(5).nullable(),
    favorite: z.boolean(),
    blocked: z.boolean(),
  })
  .partial()
  .strict()
  .refine((value) => Object.keys(value).length > 0, { message: 'Indica almeno un campo.' });
export type UpdateRecipePrefRequest = z.infer<typeof UpdateRecipePrefRequestSchema>;

// Risposta di PUT /api/recipes/:id/pref
export const RecipePrefResultSchema = z.object({ prefs: RecipePrefSchema });
export type RecipePrefResult = z.infer<typeof RecipePrefResultSchema>;

// Una voce di "I miei ingredienti".
export const IngredientPrefEntrySchema = z.object({
  canonical_name: z.string().min(1).max(INGREDIENT_NAME_MAX),
  pref: IngredientPrefSchema,
  recipes_count: z.number().int().min(0),
});
export type IngredientPrefEntry = z.infer<typeof IngredientPrefEntrySchema>;

// Risposta di GET /api/ingredient-prefs: due liste in ordine alfabetico.
export const IngredientPrefsViewSchema = z.object({
  likes: z.array(IngredientPrefEntrySchema),
  dislikes: z.array(IngredientPrefEntrySchema),
});
export type IngredientPrefsView = z.infer<typeof IngredientPrefsViewSchema>;

export const EMPTY_INGREDIENT_PREFS_VIEW: IngredientPrefsView = { likes: [], dislikes: [] };

// Body di PUT /api/ingredient-prefs/:canonicalName (null = rimuovi il giudizio)
export const SetIngredientPrefRequestSchema = z
  .object({ pref: IngredientPrefSchema.nullable() })
  .strict();
export type SetIngredientPrefRequest = z.infer<typeof SetIngredientPrefRequestSchema>;

// Risposta di PUT /api/ingredient-prefs/:canonicalName
export const SetIngredientPrefResultSchema = z.object({
  canonical_name: z.string().min(1).max(INGREDIENT_NAME_MAX),
  pref: IngredientPrefSchema.nullable(),
  recipes_count: z.number().int().min(0),
});
export type SetIngredientPrefResult = z.infer<typeof SetIngredientPrefResultSchema>;
```
Non modificare nessuno schema esistente.

**2. `lib/domain/library.ts`** (puro; importa da `./types` e `./recipe-text`). Esportare:
```ts
/** Nomi canonici normalizzati degli ingredienti, distinti, nell'ordine della ricetta. */
export function recipeIngredientNames(recipe: Pick<Recipe, 'ingredients'>): string[]

/** Vista leggera di una ricetta. Senza riga di preferenze: rating null, favorite e blocked false. */
export function toLibraryCard(recipe: Recipe): LibraryRecipeCard

/** true se la card soddisfa tutti i criteri del filtro. */
export function matchesLibraryFilter(card: LibraryRecipeCard, filter: LibraryFilter): boolean

/** Ordine della Libreria: preferite prima, poi più recenti, poi titolo, poi id. */
export function compareLibraryCards(a: LibraryRecipeCard, b: LibraryRecipeCard): number

/** Filtra e ordina; restituisce un array nuovo. */
export function filterLibraryCards(cards: readonly LibraryRecipeCard[], filter: LibraryFilter): LibraryRecipeCard[]

export type LibraryQueryResult =
  | { ok: true; filter: LibraryFilter }
  | { ok: false; issues: z.ZodIssue[] };
/** Legge il filtro dalla query string di GET /api/recipes. */
export function parseLibraryQuery(params: URLSearchParams): LibraryQueryResult
/** Query string per GET /api/recipes: '' se il filtro è vuoto, altrimenti inizia con '?'. */
export function buildLibraryQuery(filter: LibraryFilter): string
```
Regole esatte:
- `recipeIngredientNames`: `normalizeCanonicalName` su ogni `canonical_name` di `recipe.ingredients ?? []`, scartando le stringhe vuote e i doppioni (resta la prima occorrenza).
- `toLibraryCard`: `created_at = recipe.created_at.toISOString()`; `rating = recipe.prefs?.rating ?? null`; `favorite = recipe.prefs?.favorite ?? false`; `blocked = recipe.prefs?.blocked ?? false`; `ingredient_names = recipeIngredientNames(recipe)`; gli altri campi copiati.
- `matchesLibraryFilter`, tutte vere:
  1. bloccate: `filter.blocked ? card.blocked : !card.blocked`;
  2. preferite: `!filter.favorites || card.favorite`;
  3. pasti: ogni valore di `filter.meals` è in `card.meal_types`;
  4. tag: ogni valore di `filter.tags` è in `card.tags`;
  5. diete: ogni valore di `filter.diets` è in `expandDietFlags(card.diet_flags)`;
  6. ricerca: `tokens = normalizeTitle(filter.q).split(' ').filter(Boolean)`; `haystack = normalizeTitle([card.title, ...card.ingredient_names].join(' '))`; ogni token è sottostringa di `haystack`. Nessun token ⇒ vera.
- `compareLibraryCards`: (1) `favorite` true prima di false; (2) `created_at` decrescente (confronto tra stringhe ISO); (3) `a.title.localeCompare(b.title, 'it')`; (4) `id` crescente (confronto tra stringhe).
- `parseLibraryQuery`: costruire un oggetto grezzo e validarlo con `LibraryFilterSchema.safeParse`:
  - `q`: `(params.get('q') ?? '').trim()`;
  - `meals`: `params.getAll('pasto')` senza doppioni; `tags`: `params.getAll('tag')`; `diets`: `params.getAll('dieta')` (idem);
  - `favorites` da `preferite`, `blocked` da `bloccate`: parametro assente → `false`; `'1'` o `'true'` → `true`; `'0'` o `'false'` → `false`; qualsiasi altro valore → lasciare la stringa (Zod la rifiuta).
  - Parametri sconosciuti: ignorati. Fallimento → `{ ok: false, issues: error.issues }`.
- `buildLibraryQuery`: `URLSearchParams` con, nell'ordine: `q` (solo se `filter.q.trim()` non è vuoto, valore già trimmato), un `pasto` per ogni pasto, un `tag` per ogni tag, una `dieta` per ogni dieta, `preferite=1` se `favorites`, `bloccate=1` se `blocked`. Nessun parametro → `''`; altrimenti `'?' + params.toString()`.

**3. `lib/domain/prefs.ts`** (puro). Esportare:
```ts
export interface RecipePrefFields {
  rating: number | null;
  favorite: boolean;
  blocked: boolean;
}

/** Preferenze di una ricetta senza riga in recipe_prefs. */
export function defaultRecipePref(recipeId: string): RecipePref
// { recipe_id: recipeId, rating: null, favorite: false, blocked: false, times_used: 0, last_used_at: null }

/** Applica un aggiornamento parziale. Bloccare toglie dalle preferite. */
export function applyRecipePrefPatch(
  current: Pick<RecipePref, 'rating' | 'favorite' | 'blocked'> | null,
  patch: UpdateRecipePrefRequest
): RecipePrefFields

/** Per ogni nome canonico, quante ricette NON bloccate lo contengono (una ricetta conta una volta). */
export function countRecipesByIngredient(recipes: readonly Recipe[]): Map<string, number>
```
Regole di `applyRecipePrefPatch`:
- `rating = patch.rating !== undefined ? patch.rating : (current?.rating ?? null)`;
- `blocked = patch.blocked ?? current?.blocked ?? false`;
- `favorite = blocked ? false : (patch.favorite ?? current?.favorite ?? false)`.

Conseguenze da coprire con i test: `{ favorite: true }` su una ricetta bloccata lascia `favorite: false`; `{ blocked: false }` sblocca senza rimettere la preferita; `{ rating: null }` toglie il voto; `{ blocked: true }` su una preferita dà `favorite: false`.

`countRecipesByIngredient`: saltare le ricette con `prefs?.blocked === true`; per le altre incrementare di 1 ogni nome di `recipeIngredientNames(recipe)` (import da `./library`).

**4. `lib/library/client.ts`:**
```ts
// Funzioni client per le API della Libreria. Importabile dai componenti "use client":
// nessuna dipendenza dal DB. In caso di errore lanciano ApiRequestError (lib/http/client.ts).

/** GET /api/recipes con i filtri indicati (default: nessuno). */
export function fetchLibrary(filter: LibraryFilter = EMPTY_LIBRARY_FILTER): Promise<LibraryView>
// requestJson(`/api/recipes${buildLibraryQuery(filter)}`, { method: 'GET' }, LibraryViewSchema)

/** GET /api/recipes/{recipeId} */
export function fetchRecipeDetail(recipeId: string): Promise<RecipeDetailView>
// requestJson(`/api/recipes/${encodeURIComponent(recipeId)}`, { method: 'GET' }, RecipeDetailViewSchema)
```

**5. `lib/prefs/client.ts`:**
```ts
// Funzioni client per le API delle preferenze. Importabile dai componenti "use client".

/** PUT /api/recipes/{recipeId}/pref — restituisce le preferenze salvate. */
export async function putRecipePref(recipeId: string, patch: UpdateRecipePrefRequest): Promise<RecipePref>
// requestJson(`/api/recipes/${encodeURIComponent(recipeId)}/pref`,
//   { method: 'PUT', body: JSON.stringify(patch) }, RecipePrefResultSchema) → restituire `.prefs`

/** GET /api/ingredient-prefs */
export function fetchIngredientPrefs(): Promise<IngredientPrefsView>

/** PUT /api/ingredient-prefs/{canonicalName} — pref null rimuove il giudizio. */
export function putIngredientPref(
  canonicalName: string,
  pref: IngredientPref | null
): Promise<SetIngredientPrefResult>
// requestJson(`/api/ingredient-prefs/${encodeURIComponent(canonicalName)}`,
//   { method: 'PUT', body: JSON.stringify({ pref }) }, SetIngredientPrefResultSchema)
```

**6. Test.**
- `tests/domain/library.test.ts`: `recipeIngredientNames` (normalizza, toglie doppioni, ricetta senza ingredienti → `[]`); `toLibraryCard` (con e senza `prefs`); `matchesLibraryFilter` un caso per ogni regola 1–6, più: vegana soddisfa `diets: ['vegetariano']`; ricerca `"POLLO limòne"` trova "Pollo al limone"; ricerca per ingrediente (`"zucchina"` trova una ricetta che la contiene pur senza averla nel titolo); due parole di cui una assente → falsa; `compareLibraryCards` (preferita prima anche se più vecchia; a parità la più recente; a parità di data il titolo; a parità di tutto l'id); `filterLibraryCards` non muta l'input; `parseLibraryQuery` (vuota → `EMPTY_LIBRARY_FILTER`; `?pasto=cena&pasto=cena&tag=veloce&dieta=vegano&preferite=1&bloccate=true&q=%20pollo%20`; `?pasto=colazione` → `ok: false`; `?preferite=forse` → `ok: false`; `q` di 101 caratteri → `ok: false`; parametro sconosciuto ignorato); `buildLibraryQuery` (vuoto → `''`; andata e ritorno: `parseLibraryQuery(new URLSearchParams(buildLibraryQuery(f).slice(1)))` restituisce `f`).
- `tests/domain/prefs.test.ts`: le quattro conseguenze elencate sopra, `current: null`, `defaultRecipePref`; `countRecipesByIngredient` (due ricette con lo stesso ingrediente → 2; ricetta bloccata non conta; ingrediente ripetuto nella stessa ricetta conta 1; `" Cipolla "` e `"cipolla"` sono lo stesso nome).
- `tests/domain/library-contracts.test.ts`: `UpdateRecipePrefRequestSchema` rifiuta `{}`, `{ rating: 6 }`, `{ rating: 0 }`, un campo sconosciuto; accetta `{ rating: null }` e `{ favorite: true, blocked: false }`. `SetIngredientPrefRequestSchema` accetta `like`, `dislike`, `null`; rifiuta `{}` e `{ pref: 'boh' }`. `RecipeDetailViewSchema` accetta una ricetta di `fixtureRecipesAsDomain()` serializzata con `JSON.parse(JSON.stringify(…))` (le date tornano `Date`).
- `tests/library/client.test.ts`, `tests/prefs/client.test.ts`: URL, metodo e body di ogni funzione (`fetch` finto), `encodeURIComponent` su un nome con spazio (`"cipolla rossa"` → `/api/ingredient-prefs/cipolla%20rossa`), `putRecipePref` restituisce l'oggetto `prefs`, risposta non 2xx → `ApiRequestError` con il `code` del server.

### Contratti esposti
Tutto quanto ai passi 1–5, con queste firme. WP3 usa i tipi e le funzioni pure; WP5–WP8 usano tipi, funzioni pure e client.

### Dipendenze
Nessuna (solo codice esistente).

### Criteri di accettazione
- I file nuovi non importano da `lib/db`, `lib/llm`, `lib/recipes`, `next/*`.
- I test elencati sono verdi; `pnpm typecheck` verde.
- Nessuno schema preesistente di `types.ts` è cambiato.

### Fuori ambito
Servizi, rotte, repository, componenti. Classi d'errore nuove. Paginazione.

---

## WP2 — Tabella `ingredient_prefs`, repository e cablaggio col planner (wave 1, parallelo a WP1)

**Obiettivo:** dare un posto alle preferenze ingrediente, i mattoni di scrittura delle preferenze ricetta, e rendere reale `loadIngredientPreferences`, così planner e swap rispettano scarti e gradimenti.

### File
- `lib/db/schema.ts` — **modifica**
- `lib/db/migrations/0004_add_ingredient_prefs.sql`, `lib/db/migrations/meta/0004_snapshot.json` — nuovi (generati); `lib/db/migrations/meta/_journal.json` — aggiornato dal generatore
- `lib/db/repositories/ingredient-pref-repo.ts` — nuovo
- `lib/db/repositories/recipe-repo.ts` — **modifica** (aggiunte in coda)
- `lib/prefs/ingredient-prefs.ts` — **modifica**
- `lib/domain/planner.ts` — **modifica di un solo commento**
- `docs/ARCHITECTURE.md` — **modifica** (§4.2 e §5.4)
- `tests/db/schema.test.ts` — **modifica**; `tests/db/ingredient-pref-repo.test.ts`, `tests/db/recipe-pref-repo.test.ts`, `tests/prefs/ingredient-prefs.test.ts`, `tests/plans/ingredient-prefs.test.ts` — nuovi

### Pattern di riferimento
- Tabelle e indici come in `lib/db/schema.ts`; migrazione generata come `0003_add_plan_generation_tracking.sql`.
- Repository con `executor: DbExecutor` come primo argomento, come `lib/db/repositories/plan-repo.ts`.
- Test DB come `tests/plans/service.test.ts`.

### Passi

**1. `lib/db/schema.ts`.** Aggiungere `primaryKey` agli import da `drizzle-orm/pg-core` e, in coda:
```ts
// ============================================================================
// 10. Ingredient Prefs Table (popolata lazy: solo gli ingredienti giudicati)
// ============================================================================
export const ingredient_prefs = pgTable(
  'ingredient_prefs',
  {
    household_id: uuid('household_id')
      .notNull()
      .references(() => households.id, { onDelete: 'cascade' }),
    canonical_name: text('canonical_name').notNull(), // normalizzato (normalizeCanonicalName)
    pref: text('pref').notNull(), // 'like' | 'dislike'
    created_at: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [primaryKey({ columns: [table.household_id, table.canonical_name] })]
);
```
Nessuna relazione Drizzle (come `ingredient_aliases`).

**2. Migrazione.** Eseguire `pnpm db:generate --name add_ingredient_prefs`. Deve produrre `0004_add_ingredient_prefs.sql`, `meta/0004_snapshot.json` e la voce `idx: 4` nel journal. L'SQL atteso contiene solo: `CREATE TABLE "ingredient_prefs"` con le 4 colonne e la chiave primaria `("household_id","canonical_name")`, e la foreign key verso `households` con `ON DELETE cascade`. Se il generatore produce altre istruzioni (modifiche ad altre tabelle), **fermarsi e segnalarlo**: significa che schema e snapshot erano già disallineati. Non scrivere a mano né modificare i file generati. Poi `pnpm db:migrate`.

**3. `lib/db/repositories/ingredient-pref-repo.ts`:**
```ts
export interface IngredientPrefRow {
  canonical_name: string;
  pref: IngredientPref;
  created_at: Date;
}

/** Giudizi dell'household, in ordine crescente di canonical_name. */
export async function listIngredientPrefRows(
  executor: DbExecutor,
  householdId: string
): Promise<IngredientPrefRow[]>

/** Inserisce o sovrascrive il giudizio. `canonicalName` deve essere già normalizzato. */
export async function upsertIngredientPref(
  executor: DbExecutor,
  householdId: string,
  canonicalName: string,
  pref: IngredientPref
): Promise<void>

/** Rimuove il giudizio; false se non c'era. */
export async function deleteIngredientPref(
  executor: DbExecutor,
  householdId: string,
  canonicalName: string
): Promise<boolean>
```
- `listIngredientPrefRows`: ogni `pref` passa per `IngredientPrefSchema.parse`.
- `upsertIngredientPref`: `onConflictDoUpdate` su `(household_id, canonical_name)` con `set: { pref }` (`created_at` resta quello del primo inserimento).
- Il repository **non** normalizza: lo fa chi chiama.

**4. `lib/db/repositories/recipe-repo.ts`** — aggiungere in coda (nessuna funzione esistente cambia):
```ts
export interface RecipePrefValues {
  rating: number | null;
  favorite: boolean;
  blocked: boolean;
}

/** true se la ricetta esiste e appartiene all'household. */
export async function recipeBelongsToHousehold(
  executor: DbExecutor,
  recipeId: string,
  householdId: string
): Promise<boolean>

/**
 * Legge la riga di preferenze bloccandola (SELECT … FOR UPDATE); null se assente.
 * Va chiamata solo dentro una transazione.
 */
export async function lockRecipePref(executor: DbExecutor, recipeId: string): Promise<RecipePref | null>

/** Scrive rating/favorite/blocked (upsert). Non tocca times_used né last_used_at. */
export async function writeRecipePref(
  executor: DbExecutor,
  recipeId: string,
  values: RecipePrefValues
): Promise<RecipePref>
```
- `lockRecipePref`: `executor.select().from(recipe_prefs).where(eq(recipe_prefs.recipe_id, recipeId)).for('update')`; riga → `RecipePrefSchema.parse`.
- `writeRecipePref`: `insert(recipe_prefs).values({ recipe_id: recipeId, ...values }).onConflictDoUpdate({ target: recipe_prefs.recipe_id, set: { rating: values.rating, favorite: values.favorite, blocked: values.blocked } }).returning()`; riga → `RecipePrefSchema.parse`.

**5. `lib/prefs/ingredient-prefs.ts`** — stessa firma, corpo reale:
```ts
export async function loadIngredientPreferences(
  householdId: string,
  executor: DbExecutor = db
): Promise<IngredientPreferenceSets> {
  const rows = await listIngredientPrefRows(executor, householdId);
  return toIngredientPreferenceSets(
    rows.filter((row) => row.pref === 'like').map((row) => row.canonical_name),
    rows.filter((row) => row.pref === 'dislike').map((row) => row.canonical_name)
  );
}
```
Togliere i `void` e il commento "F5 (S2.3)"; il JSDoc diventa "Preferenze ingredienti (likes/dislikes normalizzati) dell'household, lette da `ingredient_prefs`." Togliere l'import di `EMPTY_INGREDIENT_PREFERENCES` se resta inutilizzato.

**6. `lib/domain/planner.ts`** — solo il commento sopra `IngredientPreferenceSets`: "/** Nomi canonici già normalizzati con normalizeCanonicalName, letti da ingredient_prefs. */". Nessun'altra modifica al file.

**7. `docs/ARCHITECTURE.md`.**
- §4.2, blocco `ingredient_prefs`, sostituire con:
  ```
  ingredient_prefs           -- popolata lazy: solo gli ingredienti su cui si è espresso un giudizio
    household_id FK, canonical_name text,   -- PK (household_id, canonical_name); canonical_name normalizzato
    pref text ('like','dislike'),
    created_at
  ```
- §5.4, aggiungere in fondo al paragrafo: "Bloccare una ricetta la toglie anche dalle preferite. Ogni giudizio (su ricetta o ingrediente) vale dalla selezione successiva — generazione, rigenerazione, *Ripeti* o *Cambia* — e non modifica un piano già composto. L'impatto mostrato prima di scartare un ingrediente è il numero di ricette non bloccate della libreria che lo contengono; gli alias non si risolvono."

**8. Test.**
- `tests/db/schema.test.ts`: nel test "exports all 9 required tables…" aggiungere `expect(dbSchema.ingredient_prefs).toBeDefined()` e rinominarlo "exports all 10 required tables and their relations"; nuovo test "has correct columns on ingredient_prefs table" (`household_id`, `canonical_name`, `pref`, `created_at`); nuovo test: il file `0004_add_ingredient_prefs.sql` esiste e contiene `CREATE TABLE "ingredient_prefs"` e `ON DELETE cascade`.
- `tests/db/ingredient-pref-repo.test.ts` (DB): lista vuota; ordine alfabetico; upsert che passa da `like` a `dislike` lascia una sola riga; `deleteIngredientPref` → `true` poi `false`; due household con lo stesso nome non si vedono a vicenda; eliminare l'household elimina le righe.
- `tests/db/recipe-pref-repo.test.ts` (DB): `recipeBelongsToHousehold` (vera; falsa per altro household; falsa per id inesistente); `lockRecipePref` dentro `db.transaction` (riga presente; `null` dopo aver cancellato la riga da `recipe_prefs`); `writeRecipePref` aggiorna i tre campi e **conserva** `times_used` e `last_used_at` (ricetta inserita con `prefs: { times_used: 3, last_used_at: … }`); `writeRecipePref` senza riga la crea.
- `tests/prefs/ingredient-prefs.test.ts` (DB): senza righe → due insiemi vuoti; con righe → insiemi corretti; funziona con una transazione come `executor`; **gradimento statistico**: household con due ricette solo cena mai usate, A con ingredienti `basilico` e `pomodoro`, B con `sale`; `like` su `basilico` e `pomodoro`; con gli insiemi letti dal DB e `listRecipes` come candidate, 4000 estrazioni di `selectRecipes` su uno slot cena con un solo `createRng(1)` condiviso: `countA / countB` tra 1.15 e 1.45 (atteso 1.3).
- `tests/plans/ingredient-prefs.test.ts` (DB; `now` = mercoledì `2026-09-30T10:00:00Z`, household con `meals: ['cena']` ⇒ 5 slot; `generate` finto che restituisce `{ requested: input.count, created: [], skipped: [] }`):
  1. **scarto escluso dal piano**: 7 ricette cena con l'ingrediente di default e 3 con `cipolla`; `upsertIngredientPref(db, id, 'cipolla', 'dislike')`; per i seed 1…20 `generatePlan({ householdId, now, rng: createRng(seed), generate })` non mette mai nel piano una delle 3; `generate` mai chiamata;
  2. **controprova**: stesso household senza lo scarto → in almeno uno dei 20 piani compare una ricetta con `cipolla`;
  3. **scarto rispettato dallo swap**: household con 7 ricette cena (tutte con `sale`), piano generato, poi `dislike` su `sale` → `swapSlot(planId, slotId, { exclude_recipe_ids: [] }, { householdId, now, generate })` fallisce con `PlanError` di codice `no_alternatives`.

### Contratti esposti
- Tabella `ingredient_prefs` (colonne sopra) e migrazione `0004`.
- `listIngredientPrefRows`, `upsertIngredientPref`, `deleteIngredientPref`, `IngredientPrefRow`.
- `recipeBelongsToHousehold`, `lockRecipePref`, `writeRecipePref`, `RecipePrefValues`.
- `loadIngredientPreferences(householdId, executor?)` che legge il DB (firma invariata).

### Dipendenze
Nessuna da WP1: usa solo tipi già esistenti (`IngredientPref`, `RecipePref`).

### Criteri di accettazione
- `pnpm db:migrate` da zero crea anche `ingredient_prefs`; il journal ha 5 voci.
- Con uno scarto attivo, 20 piani seedati non contengono mai la ricetta; lo swap non la propone (test 1 e 3).
- Il test statistico del gradimento è verde.
- `lib/domain/planner.ts` differisce da `main` solo nel commento; `tests/domain/planner.test.ts` e `tests/plans/*.test.ts` esistenti restano verdi senza modifiche.

### Fuori ambito
Servizi e rotte (WP3), vincoli LLM (WP4), UI. Vincoli `CHECK` sul DB (nessuna tabella ne ha). Risoluzione degli alias.

---

## WP3 — Servizi e rotte API (wave 2, parallelo a WP4 e WP5)

**Obiettivo:** esporre libreria, dettaglio e preferenze attraverso servizi lato server e le cinque rotte di ARCHITECTURE §6.

### File
- `lib/library/service.ts`, `lib/prefs/service.ts` — nuovi
- `app/api/recipes/route.ts`, `app/api/recipes/[id]/route.ts`, `app/api/recipes/[id]/pref/route.ts`, `app/api/ingredient-prefs/route.ts`, `app/api/ingredient-prefs/[canonicalName]/route.ts` — nuovi
- `tests/library/service.test.ts`, `tests/prefs/service.test.ts`, `tests/prefs/planner-integration.test.ts`, `tests/api/recipes.test.ts`, `tests/api/recipe-pref.test.ts`, `tests/api/ingredient-prefs.test.ts` — nuovi

### Pattern di riferimento
- Servizio: `lib/settings/service.ts` (prima riga: commento "Solo lato server…").
- Rotte: `app/api/settings/route.ts` e `app/api/plans/[id]/slots/[slotId]/route.ts` (`runtime = 'nodejs'`, `dynamic = 'force-dynamic'`, `readJsonBody`, `invalidRequestResponse`, try/catch con `console.error(TAG, err)` e `internalErrorResponse()`).
- Test di rotta: `tests/api/settings.test.ts`. Test DB: `tests/plans/service.test.ts`.

### Passi

**1. `lib/library/service.ts`:**
```ts
/** Tutte le card della libreria dell'household (bloccate comprese), già ordinate. */
export async function listLibraryCards(householdId?: string): Promise<LibraryRecipeCard[]>
// loadHousehold(householdId) → listRecipes({ household_id }) → map(toLibraryCard) → sort(compareLibraryCards)

/** Card filtrate e ordinate, più il totale senza filtri. */
export async function listLibrary(filter: LibraryFilter, householdId?: string): Promise<LibraryView>
// cards = await listLibraryCards(householdId); { recipes: filterLibraryCards(cards, filter), total: cards.length }

/** Dettaglio di una ricetta dell'household; null se non esiste o è di un altro household. */
export async function getRecipeDetail(recipeId: string, householdId?: string): Promise<RecipeDetailView | null>
```
`getRecipeDetail`: `household = await loadHousehold(householdId)`; `library = await listRecipes({ household_id: household.id })`; `recipe = library.find((r) => r.id === recipeId)`, assente → `null`; `rows = await listIngredientPrefRows(db, household.id)` → mappa nome → pref; `counts = countRecipesByIngredient(library)`; `ingredients = recipeIngredientNames(recipe).map((name) => ({ canonical_name: name, pref: prefByName.get(name) ?? null, recipes_count: counts.get(name) ?? 0 }))`. Restituire `{ recipe, ingredients }`.

**2. `lib/prefs/service.ts`:**
```ts
/** Aggiorna le preferenze di una ricetta dell'household; null se la ricetta non è sua. */
export async function updateRecipePref(
  recipeId: string,
  patch: UpdateRecipePrefRequest,
  householdId?: string
): Promise<RecipePref | null>

/** Giudizi sugli ingredienti con l'impatto, in due liste alfabetiche. */
export async function listIngredientPrefs(householdId?: string): Promise<IngredientPrefsView>

/** Imposta (like/dislike) o rimuove (null) il giudizio su un ingrediente. */
export async function setIngredientPref(
  canonicalName: string,
  pref: IngredientPref | null,
  householdId?: string
): Promise<SetIngredientPrefResult>
```
- `updateRecipePref`: `household = await loadHousehold(householdId)`; poi **in una transazione**: `recipeBelongsToHousehold(tx, recipeId, household.id)` falsa → `null`; `current = await lockRecipePref(tx, recipeId)`; `next = applyRecipePrefPatch(current, patch)`; `return writeRecipePref(tx, recipeId, next)`.
- `listIngredientPrefs`: righe da `listIngredientPrefRows`, `counts = countRecipesByIngredient(await listRecipes({ household_id }))`; ogni riga → `{ canonical_name, pref, recipes_count: counts.get(canonical_name) ?? 0 }`; `likes` e `dislikes` ordinate con `a.canonical_name.localeCompare(b.canonical_name, 'it')`.
- `setIngredientPref`: `name = normalizeCanonicalName(canonicalName)`; se `name.length === 0 || name.length > INGREDIENT_NAME_MAX` → `throw new RangeError('canonical_name non valido')`; `pref === null` → `deleteIngredientPref(db, household.id, name)`, altrimenti `upsertIngredientPref(db, household.id, name, pref)`; restituire `{ canonical_name: name, pref, recipes_count }` con il conteggio ricalcolato come sopra. Rimuovere un giudizio inesistente non è un errore.
- Nessuna funzione di questo file tocca piani o `households.updated_at` (regola 0.3.6).

**3. Rotte.** Tutte con `export const runtime = 'nodejs'` e `export const dynamic = 'force-dynamic'`; ogni chiamata al servizio in try/catch → `console.error(TAG, err)` e `internalErrorResponse()`. Costante condivisa nel singolo file: `const RECIPE_NOT_FOUND = () => errorResponse(404, 'recipe_not_found', 'Ricetta non trovata.')`.

| Rotta | Ingresso | Risposta |
|---|---|---|
| `GET /api/recipes` | `parseLibraryQuery(new URL(request.url).searchParams)`; non valido → `invalidRequestResponse(issues)` | `200` `LibraryView` da `listLibrary(filter)` |
| `GET /api/recipes/[id]` | `id` non UUID (`z.string().uuid()`) → `404 recipe_not_found` | `200` `RecipeDetailView`; servizio `null` → `404 recipe_not_found` |
| `PUT /api/recipes/[id]/pref` | `id` non UUID → `404`; `readJsonBody(request, { allowEmpty: false })` fallito → `invalidRequestResponse()`; `UpdateRecipePrefRequestSchema.safeParse` fallito → `invalidRequestResponse(issues)` | `200` `{ prefs }`; servizio `null` → `404 recipe_not_found` |
| `GET /api/ingredient-prefs` | — | `200` `IngredientPrefsView` |
| `PUT /api/ingredient-prefs/[canonicalName]` | nome: vedi sotto; body come sopra con `SetIngredientPrefRequestSchema` | `200` `SetIngredientPrefResult` |

Nome dell'ingrediente nella rotta `[canonicalName]`:
```ts
/** Next può consegnare il parametro già decodificato oppure no: si decodifica una volta, senza fallire. */
function decodeParam(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value; // già decodificato e contiene un '%' (es. "cioccolato 70%")
  }
}
```
`name = normalizeCanonicalName(decodeParam((await params).canonicalName))`; se `name.length === 0 || name.length > INGREDIENT_NAME_MAX` → `invalidRequestResponse()`.

`app/api/recipes/generate/route.ts` (segmento statico) resta com'è e ha la precedenza su `[id]`.

**4. Test.**
- `tests/library/service.test.ts` (DB): `listLibraryCards` restituisce anche le bloccate, con le preferite in testa; `listLibrary` con `{ ...EMPTY_LIBRARY_FILTER, blocked: true }` restituisce solo le bloccate e `total` conta tutto; `getRecipeDetail` → ricetta completa, una voce per ingrediente distinto, `pref` e `recipes_count` corretti (una ricetta bloccata con lo stesso ingrediente non conta); ricetta di un altro household → `null`; id inesistente → `null`.
- `tests/prefs/service.test.ts` (DB): `updateRecipePref` con `{ favorite: true }` poi `{ rating: 4 }` → entrambe restano; `{ blocked: true }` su una preferita → `favorite: false`; `{ rating: null }` toglie il voto; non cambia `times_used`; ricetta di un altro household → `null` e nessuna scrittura; `setIngredientPref(' Cipolla ', 'dislike')` salva `cipolla` e restituisce il conteggio; passaggio a `like`; `null` rimuove; `null` su un nome mai giudicato non fallisce; nome vuoto o di 81 caratteri → `RangeError`; `listIngredientPrefs` → due liste alfabetiche con i conteggi.
- `tests/prefs/planner-integration.test.ts` (DB; impostazione come `tests/plans/ingredient-prefs.test.ts` di WP2): household `meals: ['cena']` con 8 ricette cena; `updateRecipePref(id, { blocked: true }, householdId)` su una; per i seed 1…20 `generatePlan` non la mette mai nel piano; dopo `{ blocked: false }` compare in almeno uno dei 20 piani. Stesso schema con `setIngredientPref('cipolla', 'dislike', householdId)` e poi `setIngredientPref('cipolla', null, householdId)` (7 ricette senza cipolla + 3 con).
- `tests/api/recipes.test.ts` (servizio finto): `GET /api/recipes?tag=veloce&preferite=1` passa al servizio il filtro atteso; `?pasto=colazione` → `400 invalid_request` con `details`; errore del servizio → `500 internal_error` senza il messaggio originale; `GET /api/recipes/<uuid>` → 200; servizio `null` → `404 recipe_not_found` con messaggio `Ricetta non trovata.`; id `abc` → 404 senza chiamare il servizio; `runtime`/`dynamic` esportati.
- `tests/api/recipe-pref.test.ts`: 200 con `{ prefs }`; body vuoto → 400; `{}` → 400; `{ rating: 9 }` → 400; servizio `null` → 404; id non UUID → 404; errore → 500.
- `tests/api/ingredient-prefs.test.ts`: `GET` → 200; `PUT` con `canonicalName` `cipolla%20rossa` → servizio chiamato con `'cipolla rossa'`; con `cioccolato 70%` (già decodificato) → servizio chiamato con `'cioccolato 70%'`; nome di soli spazi (`%20%20`) → 400; `{ pref: 'boh' }` → 400; `{ pref: null }` → 200; errore → 500.

### Contratti esposti
Le tre funzioni di `lib/library/service.ts`, le tre di `lib/prefs/service.ts` e le cinque rotte della tabella. WP6 usa `listLibraryCards`; WP8 usa `listIngredientPrefs`.

### Dipendenze
- **WP1**: tipi, `toLibraryCard`, `compareLibraryCards`, `filterLibraryCards`, `parseLibraryQuery`, `recipeIngredientNames`, `applyRecipePrefPatch`, `countRecipesByIngredient`.
- **WP2**: `listIngredientPrefRows`, `upsertIngredientPref`, `deleteIngredientPref`, `recipeBelongsToHousehold`, `lockRecipePref`, `writeRecipePref`, `loadIngredientPreferences` reale (per il test d'integrazione).

### Criteri di accettazione
- Rating, preferita e blocco persistono (test del servizio su DB reale).
- Una ricetta bloccata tramite il servizio non compare mai in 20 piani seedati (S2.2).
- `PUT /api/ingredient-prefs/:canonicalName` risponde con il conteggio delle ricette impattate (S2.3).
- Tutte le risposte d'errore hanno la forma `{ error: { code, message, details? } }`.

### Fuori ambito
UI. Modifiche a `lib/plans/`, `lib/recipes/`, `lib/llm/`. Endpoint oltre i cinque elencati. Eliminazione o modifica delle ricette.

---

## WP4 — Like e dislike nella generazione LLM (wave 2, parallelo a WP3 e WP5)

**Obiettivo:** le preferenze ingrediente entrano nei vincoli di generazione: il prompt le riporta e una ricetta generata che contiene uno scarto viene rifiutata.

### File
- `lib/recipes/constraints.ts`, `lib/recipes/generate.ts` — **modifica**
- `tests/recipes/constraints.test.ts`, `tests/recipes/generate.test.ts` — **modifica** (aggiunte)

### Pattern di riferimento
- `tests/recipes/generate.test.ts`, primo test: uso di `loadLlmRecording` + `createRecordedModel` e ispezione del prompt con `JSON.stringify(calls[0])`.

### Passi

**1. `lib/recipes/constraints.ts`.**
```ts
import type { IngredientPreferenceSets } from '@/lib/domain/planner';

/** Massimo di ingredienti graditi riportati nel prompt (gli scarti vanno sempre tutti). */
export const PROMPT_INGREDIENT_LIKES_MAX = 30;

export function buildConstraints(
  household: Household,
  mealType: MealType | null,
  overrides?: ConstraintOverrides,
  ingredientPrefs?: IngredientPreferenceSets
): RecipeConstraints
```
- `ingredient_likes`: `[...(ingredientPrefs?.likes ?? [])]` ordinati con `localeCompare(…, 'it')`, primi `PROMPT_INGREDIENT_LIKES_MAX`.
- `ingredient_dislikes`: `[...(ingredientPrefs?.dislikes ?? [])]` ordinati allo stesso modo, **tutti** (servono a `findConstraintViolations`).
- Togliere i due commenti "F5 (S2.3)". `findConstraintViolations` non cambia.

**2. `lib/recipes/generate.ts`.** Dopo `loadHousehold`: `const ingredientPrefs = await loadIngredientPreferences(household.id);` (import da `@/lib/prefs/ingredient-prefs`) e `buildConstraints(household, input.mealType, input.overrides ?? {}, ingredientPrefs)`. Nient'altro cambia: la chiamata LLM resta fuori da ogni transazione.

**3. Test.**
- `tests/recipes/constraints.test.ts` — aggiungere: senza quarto parametro le due liste restano vuote (il test esistente "initializes ingredient_likes and ingredient_dislikes to empty arrays" resta invariato); con `toIngredientPreferenceSets(['zucchina', 'basilico'], ['cipolla', 'aglio'])` → `ingredient_likes: ['basilico', 'zucchina']`, `ingredient_dislikes: ['aglio', 'cipolla']`; 35 gradimenti → 30 nel risultato; 35 scarti → 35 nel risultato.
- `tests/recipes/generate.test.ts` — aggiungere (DB, registrazione `valid-2-recipes`: contiene "Tofu croccante con verdure saltate" con `zucchina` e "Cosce di pollo al forno con patate" con `patata`; household di default, che ha il forno):
  1. **scarto**: `upsertIngredientPref(db, householdId, 'zucchina', 'dislike')`; `generateAndStoreRecipes({ householdId, count: 2, mealType: 'cena' }, { model })` → `created` contiene solo le cosce di pollo; `skipped` contiene il tofu con `reason: 'constraint_violation'` e `detail` che include `contiene "zucchina" (ingrediente escluso)`; `JSON.stringify(calls[0])` contiene `Ingredienti da non usare mai: zucchina.`;
  2. **gradimento**: `upsertIngredientPref(db, householdId, 'patata', 'like')` → entrambe le ricette create; il prompt contiene `Ingredienti graditi: patata (privilegiali quando sensato).`.

### Contratti esposti
`buildConstraints` con il quarto parametro opzionale; `PROMPT_INGREDIENT_LIKES_MAX`.

### Dipendenze
- **WP2**: `loadIngredientPreferences` reale e `upsertIngredientPref` (nei test).

### Criteri di accettazione
- Con uno scarto attivo, una ricetta registrata che lo contiene non entra in libreria e il prompt lo elenca (S2.3: "né proposta né generata").
- I test esistenti di `tests/recipes/` e `tests/api/recipes-generate.test.ts` restano verdi senza modifiche.
- `lib/llm/` non ha modifiche.

### Fuori ambito
Testo del prompt, adapter, nuove registrazioni LLM, `pnpm llm:record`.

---

## WP5 — Dettaglio ricetta: `RecipeSheet` e `RecipeDetailSheet` (wave 2, parallelo a WP3 e WP4)

**Obiettivo:** un dettaglio ricetta unico per Piano e Libreria, che carica i dati, salva le preferenze in modo ottimistico e mostra l'impatto prima di scartare un ingrediente.

### File
- `components/sheets/recipe-sheet.tsx`, `components/sheets/recipe-detail.ts` — **modifica** (solo aggiunte compatibili)
- `components/recipes/recipe-detail-sheet.tsx` — nuovo
- `tests/ui/recipe-detail.test.ts` — **modifica** (aggiunte); `tests/ui/recipe-sheet.test.tsx`, `tests/ui/recipe-detail-sheet.test.tsx` — nuovi

### Pattern di riferimento
- Callback tenute in un ref per non rilanciare gli effetti: `components/feedback/toast.tsx` (`onDismissRef`).
- Guardia di smontaggio e aggiornamenti ottimistici con ripristino: `components/plan/plan-screen.tsx` (`mountedRef`, `handleToggleLock`).
- Test con client finti: `tests/ui/plan-screen.test.tsx` (`vi.mock` del modulo client con `importOriginal`).

### Vincolo di compatibilità
`app/(app)/libreria/page.tsx` (pagina finta, sostituita in wave 3) e `tests/ui/shell.test.tsx` usano `RecipeSheet` e i tipi `RecipeDetail` / `RecipeIngredient` di oggi e **non si toccano in questo WP**: devono continuare a compilare e a passare. Quindi: nessun campo o parametro esistente cambia nome, tipo o obbligatorietà; `preference` resta `"liked" | "disliked" | null`; `onIngredientPreference` resta `(ingredientId: string, preference: "liked" | "disliked" | null) => void`.

### Passi

**1. `components/sheets/recipe-detail.ts`.**
- `recipeChips(recipe: Pick<Recipe, 'tags' | 'diet_flags'>)`: solo il tipo del parametro si allarga (così accetta anche una `LibraryRecipeCard`).
- Nuove funzioni:
  ```ts
  /** Id di riga dell'ingrediente nella sheet: l'id dell'ingrediente o `${recipe.id}:${index}`. */
  export function ingredientRowId(recipe: Pick<Recipe, 'id'>, ingredient: Pick<Ingredient, 'id'>, index: number): string
  /** Ingrediente della ricetta a partire dall'id di riga; null se non c'è. */
  export function findRecipeIngredient(recipe: Recipe, rowId: string): Ingredient | null
  ```
- `toRecipeDetail(recipe, servings, ingredientInfo?: ReadonlyMap<string, RecipeIngredientInfo>)`: l'id usa `ingredientRowId`. **Solo se** `ingredientInfo` è passato, ogni ingrediente riceve anche `preference` e `recipesCount`, con `info = ingredientInfo.get(normalizeCanonicalName(ing.canonical_name))`: `preference` = `'liked'` se `info?.pref === 'like'`, `'disliked'` se `'dislike'`, altrimenti `null`; `recipesCount = info?.recipes_count`. Senza `ingredientInfo` l'oggetto prodotto è identico a oggi (nessuna chiave in più).

**2. `components/sheets/recipe-sheet.tsx`** — aggiunte:
- `RecipeIngredient`: nuovo campo opzionale `recipesCount?: number`.
- `RecipeSheetProps`: nuovi campi opzionali `isLoading?: boolean`, `actionsDisabled?: boolean`, `ingredientsDisabled?: boolean`.
- **Effetto di sincronizzazione**: oggi dipende da `recipe` (identità dell'oggetto) e azzera porzioni e conferma a ogni nuovo oggetto. Deve dipendere da id e porzioni di base:
  ```ts
  const recipeId = recipe?.id;
  const baseServingsProp = recipe?.servings;
  React.useEffect(() => {
    if (recipeId === undefined || baseServingsProp === undefined) return;
    setServings(baseServingsProp);
    setPendingDislikeIngredient(null);
  }, [recipeId, baseServingsProp]);
  ```
  Così un cambio di preferenze (nuovo oggetto, stessa ricetta) non azzera le porzioni scelte dall'utente.
- **Caricamento**: se `recipe` è `null` e `isLoading` è vero, invece di `return null` mostrare la sheet (`Sheet` / `SheetContent` con le stesse classi) con `SheetTitle` "Apro la ricetta…" e un blocco `<div role="status" aria-label="Caricamento della ricetta" className="space-y-3">` con tre `<div className="h-12 rounded-xl bg-stone/15 animate-pulse motion-reduce:animate-none" />`. Se `recipe` è `null` e `isLoading` è falso: `return null` come oggi. Gli hook restano prima di ogni `return`.
- **Testo della conferma di scarto** (seconda riga del riquadro), in base a `pendingDislikeIngredient.recipesCount`:
  - `undefined` → `Escluderà le ricette contenenti questo ingrediente dai prossimi piani.` (testo attuale, invariato);
  - `0` → `Nessuna ricetta in libreria lo contiene: non lo userò in quelle nuove.`;
  - `1` → `Escluderà 1 ricetta dai prossimi piani.`;
  - `n > 1` → `Escluderà ${n} ricette dai prossimi piani.`.
- 👍, 👎 e "Conferma esclusione": `disabled={ingredientsDisabled}` con classi `disabled:pointer-events-none disabled:opacity-40`.
- Stelle del voto: `aria-pressed={recipe.rating === star}`, `disabled={actionsDisabled}`. Il comportamento "tocco la stella attiva per togliere il voto" lo decide chi riceve `onRate` (passo 3), non la sheet.
- Pulsante *Preferita*: testo sempre `Preferita`, `aria-pressed={Boolean(recipe.isFavorite)}`, `disabled={actionsDisabled || Boolean(recipe.isBlocked)}`.
- Pulsante blocco: `disabled={actionsDisabled}`; testi invariati (`Non proporre più` / `Sblocca ricetta`).
- Aggiungere `focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-basil` ai pulsanti scritti a mano (porzioni, 👍, 👎, stelle).

**3. `components/recipes/recipe-detail-sheet.tsx`** (`"use client"`):
```ts
export interface RecipeDetailSheetProps {
  /** Ricetta da mostrare; null = sheet chiusa. */
  recipeId: string | null;
  /** Porzioni su cui scalare le quantità all'apertura. */
  servings: number;
  /** Ricetta già nota a chi chiama (Piano): si mostra subito, mentre il dettaglio si carica. */
  initialRecipe?: Recipe | null;
  onClose: () => void;
  /** Dopo ogni salvataggio riuscito delle preferenze della ricetta. */
  onRecipePrefsChange?: (recipeId: string, prefs: RecipePref) => void;
  /** Messaggi (conferme ed errori) da mostrare come toast dal genitore. */
  onNotify: (message: string) => void;
  /** Sostituisce il messaggio mostrato dopo "Non proporre più". */
  blockedMessage?: string;
}
export function RecipeDetailSheet(props: RecipeDetailSheetProps): React.JSX.Element
```
Costanti di testo:
```ts
const FALLBACK_ERROR = "Qualcosa è andato storto. Riprova.";
const LOAD_PREFS_ERROR = "Non riesco a caricare le preferenze sugli ingredienti.";
const TOAST_BLOCKED = "Non la proporrò più.";
const TOAST_UNBLOCKED = "La ricetta torna tra le proposte.";
const dislikedToast = (name: string) => `Non proporrò più ricette con ${name}: vale dai prossimi piani.`;
const errorMessage = (err: unknown) => (err instanceof ApiRequestError ? err.message : FALLBACK_ERROR);
```
Stato: `detail: RecipeDetailView | null`, `loadState: 'idle' | 'loading' | 'ready' | 'error'`, `prefsOverride: RecipePref | null`, `info: Map<string, RecipeIngredientInfo>`, `savingPrefs: boolean`, `savingIngredient: boolean`. `onClose`, `onNotify`, `onRecipePrefsChange` e `initialRecipe` vanno letti da ref aggiornati a ogni render; un `mountedRef` e un `currentIdRef` (ultimo `recipeId`) proteggono gli aggiornamenti tardivi.

Comportamento:
- **Apertura** (effetto con dipendenza **solo** `recipeId`): `recipeId === null` → azzerare lo stato (`loadState: 'idle'`). Altrimenti azzerare `detail`, `prefsOverride`, `info`, mettere `loadState: 'loading'` e chiamare `fetchRecipeDetail(recipeId)`. La pulizia dell'effetto marca la richiesta come annullata: una risposta annullata si ignora.
  - successo → `detail`, `info = new Map(detail.ingredients.map((i) => [i.canonical_name, i]))`, `loadState: 'ready'`;
  - errore **con** `initialRecipe` → `loadState: 'error'`, `onNotify(LOAD_PREFS_ERROR)`; la sheet resta aperta senza 👍/👎;
  - errore **senza** `initialRecipe` → `onNotify(errorMessage(err))` e `onClose()`.
- **Ricetta mostrata**: `recipe = detail?.recipe ?? initialRecipe ?? null`. **Preferenze mostrate**: `prefs = prefsOverride ?? recipe?.prefs ?? null`.
- **Vista** (in `useMemo`): `recipe ? toRecipeDetail({ ...recipe, prefs }, servings, loadState === 'ready' ? info : undefined) : null`.
- **Render**: `<RecipeSheet recipe={view} isOpen={recipeId !== null} isLoading={recipeId !== null && view === null} onClose={onClose} onRate={…} onToggleFavorite={…} onToggleBlock={…} actionsDisabled={savingPrefs} onIngredientPreference={loadState === 'ready' ? handleIngredientPreference : undefined} ingredientsDisabled={savingIngredient} />`.
- **Salvataggio preferenze ricetta** `savePrefs(patch: UpdateRecipePrefRequest)`: se non c'è `recipe` o `savingPrefs` è vero, non fare nulla. `previous = prefs`; `base = previous ?? defaultRecipePref(recipe.id)`; ottimistico: `setPrefsOverride({ ...base, ...applyRecipePrefPatch(previous, patch) })`; `savingPrefs = true`; `saved = await putRecipePref(recipe.id, patch)`.
  - successo → `onRecipePrefsChange?.(recipe.id, saved)` **sempre**; se la sheet mostra ancora quella ricetta (`currentIdRef` e `mountedRef`), `setPrefsOverride(saved)`; se `patch.blocked === true` → `onNotify(blockedMessage ?? TOAST_BLOCKED)`; se `patch.blocked === false` → `onNotify(TOAST_UNBLOCKED)`;
  - errore → se la sheet mostra ancora quella ricetta, `setPrefsOverride(previous)`; `onNotify(errorMessage(err))`;
  - in ogni caso, se montato, `savingPrefs = false`.
- Handler passati alla sheet: `onRate(_, star)` → `savePrefs({ rating: prefs?.rating === star ? null : star })`; `onToggleFavorite` → `savePrefs({ favorite: !(prefs?.favorite ?? false) })`; `onToggleBlock` → `savePrefs({ blocked: !(prefs?.blocked ?? false) })`.
- **Giudizio su un ingrediente** `handleIngredientPreference(rowId, preference)`: `ingredient = findRecipeIngredient(recipe, rowId)`, assente → nulla; `name = normalizeCanonicalName(ingredient.canonical_name)`; `pref` = `'like'` per `'liked'`, `'dislike'` per `'disliked'`, `null` per `null`. `previous = info.get(name)`; ottimistico: `info` con `{ canonical_name: name, pref, recipes_count: previous?.recipes_count ?? 0 }`; `savingIngredient = true`; `result = await putIngredientPref(name, pref)`.
  - successo → voce di `info` = `result`; se `pref === 'dislike'` → `onNotify(dislikedToast(name))`. Nessun messaggio per 👍 e per la rimozione;
  - errore → ripristinare `previous` (o togliere la voce se non c'era) e `onNotify(errorMessage(err))`;
  - in ogni caso, se montato, `savingIngredient = false`.
  La conferma dello scarto (riquadro con l'impatto) è già gestita da `RecipeSheet`: questo handler riceve `'disliked'` solo a conferma avvenuta.

**4. Test.**
- `tests/ui/recipe-detail.test.ts` — aggiungere: senza terzo parametro gli ingredienti non hanno le chiavi `preference` e `recipesCount`; con la mappa → `'liked'` / `'disliked'` / `null` e `recipesCount`; la ricerca nella mappa normalizza il nome (`" Basilico "`); `ingredientRowId` con e senza `id`; `findRecipeIngredient` trova per id reale e per id sintetico, `null` se assente; `recipeChips` accetta un oggetto con i soli `tags` e `diet_flags`.
- `tests/ui/recipe-sheet.test.tsx`: scheletro con `isLoading` e `recipe: null` (titolo "Apro la ricetta…", `role="status"`); `recipe: null` senza `isLoading` → nulla; i quattro testi della conferma (`recipesCount` assente, 0, 1, 8); cambiare l'oggetto `recipe` mantenendo `id` e `servings` **non** azzera le porzioni portate a 3; cambiare `id` le riporta al valore di base; `actionsDisabled` disabilita stelle, *Preferita* e blocco; *Preferita* disabilitata se `isBlocked`; `ingredientsDisabled` disabilita 👍/👎; `aria-pressed` sulla stella del voto corrente.
- `tests/ui/recipe-detail-sheet.test.tsx` (`vi.mock` di `@/lib/library/client` e `@/lib/prefs/client`):
  1. senza `initialRecipe`: scheletro, poi il titolo della ricetta; 👍/👎 presenti;
  2. con `initialRecipe`: titolo visibile **prima** che `fetchRecipeDetail` risolva e senza 👍/👎; dopo, 👍/👎 presenti;
  3. caricamento fallito senza `initialRecipe` → `onNotify` con il messaggio dell'errore e `onClose` chiamata;
  4. caricamento fallito con `initialRecipe` → `onNotify(LOAD_PREFS_ERROR)`, sheet aperta, niente 👍/👎;
  5. voto: tocco la 4ª stella → `putRecipePref(id, { rating: 4 })`, `onRecipePrefsChange` con le preferenze salvate; tocco di nuovo la 4ª → `{ rating: null }`;
  6. *Preferita* → `{ favorite: true }`; durante il salvataggio i pulsanti sono disabilitati;
  7. *Non proporre più* → `{ blocked: true }`, `onNotify("Non la proporrò più.")`; con `blockedMessage` → quel testo; poi *Sblocca ricetta* → `onNotify("La ricetta torna tra le proposte.")`;
  8. salvataggio fallito → stato ripristinato (stella non piena) e `onNotify` con il messaggio;
  9. 👎 su un ingrediente con `recipes_count: 8` → riquadro con "Escluderà 8 ricette dai prossimi piani."; "Conferma esclusione" → `putIngredientPref('basilico', 'dislike')` e `onNotify("Non proporrò più ricette con basilico: vale dai prossimi piani.")`; "Annulla" → nessuna chiamata;
  10. 👍 → `putIngredientPref(name, 'like')` senza conferma né toast; di nuovo 👍 → `putIngredientPref(name, null)`;
  11. giudizio fallito → pulsante di nuovo non premuto e `onNotify`;
  12. `recipeId` che passa da A a B mentre A sta caricando: la risposta di A viene ignorata.

### Contratti esposti
- `RecipeDetailSheet` e `RecipeDetailSheetProps` (firma sopra) — usati da WP6 e WP7.
- `recipeChips` con parametro allargato, `ingredientRowId`, `findRecipeIngredient`, `toRecipeDetail` con terzo parametro opzionale.
- `RecipeSheet` con i tre nuovi parametri opzionali e `RecipeIngredient.recipesCount`.

### Dipendenze
- **WP1**: tipi, `applyRecipePrefPatch`, `defaultRecipePref`, `fetchRecipeDetail`, `putRecipePref`, `putIngredientPref`.

### Criteri di accettazione
- `tests/ui/shell.test.tsx` e `app/(app)/libreria/page.tsx` non sono stati modificati e il gate è verde.
- I dodici scenari di `recipe-detail-sheet.test.tsx` sono verdi.
- La conferma di scarto mostra il numero di ricette quando è noto (S2.3, DESIGN §4.2).

### Fuori ambito
Pagine e schermate (WP6–WP8). Toast (lo mostra il genitore). Modifiche a `MealCard`.

---

## WP6 — Libreria: pagina, schermata, card e filtri (wave 3, parallelo a WP7 e WP8)

**Obiettivo:** sostituire la Libreria finta con quella reale: ricerca, filtri, card con ★ rapida, dettaglio con quantità scalate sulle persone.

### File
- `app/(app)/libreria/page.tsx` — **sostituzione completa**; `app/(app)/libreria/loading.tsx` — nuovo
- `components/library/library-screen.tsx`, `components/library/library-filters.tsx`, `components/library/recipe-card.tsx` — nuovi
- `docs/DESIGN.md` — **modifica** (§4.4)
- `tests/ui/shell.test.tsx` — **modifica** (solo il test della Libreria); `tests/ui/library-screen.test.tsx`, `tests/ui/library-filters.test.tsx`, `tests/app/library-page.test.tsx` — nuovi

### Pattern di riferimento
- Pagina server: `app/(app)/impostazioni/page.tsx`; test: `tests/app/settings-page.test.tsx`.
- Riallineamento dello stato quando arrivano dati nuovi dal server: `components/plan/plan-screen.tsx` (`syncedInitialScreen`).
- Aspetto della card: il markup della card nel file finto `app/(app)/libreria/page.tsx` **prima di sostituirlo** (badge del tempo, titolo `font-display`, chip, voto).
- Chip: `components/filters/chip-filter.tsx`. Stato vuoto: `components/feedback/empty-state.tsx`. Toast: `components/feedback/toast.tsx`.

### Passi

**1. `app/(app)/libreria/page.tsx`** (server, senza `"use client"`):
```tsx
export default async function LibraryPage() {
  await connection();
  const [recipes, settings] = await Promise.all([listLibraryCards(), getSettings()]);
  return <LibraryScreen initialRecipes={recipes} persons={settings.persons} />;
}
```

**2. `app/(app)/libreria/loading.tsx`:** `<main aria-busy="true" className="min-h-screen px-4 py-6 max-w-xl mx-auto">` con `<h1 className="font-display text-2xl font-bold text-ink">Libreria Ricette</h1>` e una griglia `grid grid-cols-1 gap-3 sm:grid-cols-2` di 6 `<div className="h-28 rounded-xl bg-stone/15 animate-pulse motion-reduce:animate-none" />`.

**3. `components/library/recipe-card.tsx`** (`"use client"`):
```ts
export interface RecipeCardProps {
  recipe: LibraryRecipeCard;
  onOpen: (recipeId: string) => void;
  onToggleFavorite: (recipeId: string) => void;
}
export function RecipeCard(props: RecipeCardProps): React.JSX.Element
```
- Contenitore `Card` con `relative p-4`. **Nessun pulsante annidato in un altro pulsante.**
- Un `<button type="button">` che occupa tutta la card (`block w-full text-left min-h-[44px] pr-12`, focus visibile) e chiama `onOpen(recipe.id)`. Contiene: badge del tempo (`${prep_minutes} min`, `tabular-nums`), titolo in `<h3 className="font-display text-base font-bold text-ink line-clamp-2">`, i chip di `recipeChips(recipe)` e, se `rating !== null`, stella piena `saffron` + numero con `aria-label={`Voto ${rating} su 5`}`.
- In alto a destra (`absolute right-1 top-1`), fuori dal pulsante principale:
  - se `recipe.blocked`: `<span className="… text-tomato">` con icona `Ban` e testo `Bloccata`;
  - altrimenti un `<button type="button" className="flex h-11 w-11 items-center justify-center …">` con `Star` (piena `saffron` se `favorite`), `aria-pressed={recipe.favorite}`, `aria-label` = `Rimuovi ${title} dai preferiti` se preferita, `Aggiungi ${title} ai preferiti` altrimenti; chiama `onToggleFavorite(recipe.id)`.

**4. `components/library/library-filters.tsx`** (`"use client"`):
```ts
export interface LibraryFiltersProps {
  query: string;
  onQueryChange: (query: string) => void;
  /** Il campo `q` del filtro è ignorato: il testo vive in `query`. */
  filter: LibraryFilter;
  onFilterChange: (next: LibraryFilter) => void;
}
export function LibraryFilters(props: LibraryFiltersProps): React.JSX.Element
```
- Campo di ricerca: `<input type="search">`, `aria-label="Cerca nella libreria"`, `placeholder="Cerca ricetta o ingrediente…"`, `maxLength={LIBRARY_QUERY_MAX}`, altezza ≥ 44 px, icona `Search` a sinistra.
- **Riga rapida** (`flex flex-wrap items-center gap-2`): `ChipFilter` `Preferite` (icona `Star`, alterna `filter.favorites`), `Pranzo` e `Cena` (etichette da `MEAL_TYPE_LABELS`, alternano la presenza del valore in `filter.meals`), poi il pulsante **Filtri**: `<button type="button" aria-expanded={open} aria-controls="library-filter-panel">` con le stesse classi di un chip non selezionato, testo `Filtri` se `n === 0`, altrimenti `Filtri · ${n}`, dove `n = filter.tags.length + filter.diets.length + (filter.blocked ? 1 : 0)`; icona `ChevronDown` (ruotata se aperto).
- **Pannello** (`id="library-filter-panel"`, reso solo se `open`; stato `open` interno, inizialmente `false`): tre gruppi, ciascuno con un titolo `<p className="text-xs font-bold uppercase tracking-wider text-stone">` e i chip in `flex flex-wrap gap-2`:
  - `Tipo di pasti`: i 7 valori di `MEAL_STYLE_TAG_VALUES` con `MEAL_STYLE_TAG_LABELS` (alternano `filter.tags`);
  - `Dieta`: i 5 valori di `DIET_FLAG_VALUES` con `DIET_FLAG_LABELS` (alternano `filter.diets`);
  - `Altro`: un chip `Bloccate` (icona `Ban`, alterna `filter.blocked`).
- Ogni chip usa `isSelected` coerente con il filtro; l'alternanza aggiunge o toglie il valore senza cambiare l'ordine degli altri.

**5. `components/library/library-screen.tsx`** (`"use client"`):
```ts
export interface LibraryScreenProps {
  initialRecipes: LibraryRecipeCard[];
  persons: number;
}
export function LibraryScreen(props: LibraryScreenProps): React.JSX.Element
```
- Stato: `cards` (da `initialRecipes`, riallineato se la prop cambia identità), `query` (`''`), `filter` (`EMPTY_LIBRARY_FILTER`), `sheetRecipeId` (`null`), `toast` (`null`), e un `Set` in un ref con gli id la cui ★ è in salvataggio.
- `visible = filterLibraryCards(cards, { ...filter, q: query })` in `useMemo`.
- `hasActiveFilter` = `query.trim() !== ''` oppure un qualsiasi criterio del filtro attivo. `resetFilters()` azzera `query` e `filter`.
- Struttura: `<main className="min-h-screen px-4 py-6 max-w-xl mx-auto">`; `<h1 className="font-display text-2xl font-bold text-ink">Libreria Ricette</h1>`; sottotitolo `<p className="text-stone text-xs mt-0.5">Tutte le tue ricette, da ritrovare e giudicare</p>`.
- Se `cards.length === 0`: solo `EmptyState` con titolo `Ancora nessuna ricetta`, descrizione `Genera il primo piano e la libreria si riempie da sola.`, azione `Vai al piano` → `router.push('/')` (`useRouter` da `next/navigation`). Niente ricerca né filtri.
- Altrimenti: `LibraryFilters`; una riga con il conteggio (`1 ricetta` se `visible.length === 1`, altrimenti `${visible.length} ricette`) e, se `hasActiveFilter`, il pulsante `Azzera filtri` (`Button variant="ghost" size="sm"`); poi:
  - `visible.length === 0` e `filter.blocked` → `EmptyState` `Nessuna ricetta bloccata` / `Le ricette che segni con «Non proporre più» le ritrovi qui.` / azione `Azzera filtri`;
  - `visible.length === 0` altrimenti → `EmptyState` `Nessuna ricetta trovata` / `Prova a cambiare i filtri o il testo cercato.` / azione `Azzera filtri`;
  - altrimenti la griglia `grid grid-cols-1 gap-3 sm:grid-cols-2` di `RecipeCard`.
- **★ rapida** `handleToggleFavorite(id)`: se l'id è già in salvataggio, ignorare. `next = !card.favorite`; ottimistico: `favorite: next` sulla card; `saved = await putRecipePref(id, { favorite: next })` → card con `rating: saved.rating ?? null`, `favorite: saved.favorite`, `blocked: saved.blocked`; errore → `favorite` ripristinato e `setToast(err instanceof ApiRequestError ? err.message : "Qualcosa è andato storto. Riprova.")`. In ogni caso togliere l'id dall'insieme.
- **Dettaglio**: `<RecipeDetailSheet recipeId={sheetRecipeId} servings={persons} onClose={() => setSheetRecipeId(null)} onRecipePrefsChange={(id, prefs) => …} onNotify={setToast} />`; `onRecipePrefsChange` aggiorna `rating` (`prefs.rating ?? null`), `favorite` e `blocked` della card. Niente `initialRecipe` né `blockedMessage`.
- `<Toast message={toast} onDismiss={() => setToast(null)} />`.
- L'ordine si ricalcola a ogni cambio (una ★ sposta subito la card in alto: requirements U4). Una ricetta appena bloccata sparisce dall'elenco se *Bloccate* è spento; il dettaglio resta aperto.

**6. `docs/DESIGN.md` §4.4** — sostituire i due punti con:
```
- Ricerca (per titolo o ingrediente) + filtri a chip combinabili: sempre visibili *Preferite*, *Pranzo*, *Cena* e il pulsante *Filtri* (con contatore), che apre il pannello con tipo di pasti, dieta e *Bloccate*
- Card compatte con rating e ★, preferite in alto e poi le più recenti; le bloccate compaiono solo con il filtro *Bloccate*, da dove si sbloccano
```

**7. Test.**
- `tests/ui/shell.test.tsx`: togliere l'import di `LibraryPage`; il test "renders Library page with search and chip filters" monta `<LibraryScreen initialRecipes={[card]} persons={2} />` con una card costruita con `toLibraryCard(fixtureRecipesAsDomain()[0])` e verifica l'`h1` `Libreria Ricette` e il placeholder `Cerca ricetta o ingrediente…`. Aggiungere `refresh: vi.fn()` al router finto del file solo se serve. Nessun altro test del file cambia.
- `tests/app/library-page.test.tsx` (ambiente node; `vi.mock` di `next/server`, `@/lib/library/service`, `@/lib/settings/service`): attende `connection`, chiama i due servizi, restituisce `LibraryScreen` con `initialRecipes` e `persons` corretti.
- `tests/ui/library-filters.test.tsx`: digitare chiama `onQueryChange`; `Preferite`, `Pranzo`, `Cena` alternano i rispettivi criteri; il pannello è chiuso all'inizio e *Filtri* lo apre (`aria-expanded`); un chip del pannello aggiorna `tags` / `diets` / `blocked`; l'etichetta diventa `Filtri · 2` con un tag e una dieta attivi.
- `tests/ui/library-screen.test.tsx` (`vi.mock` di `@/lib/library/client`, `@/lib/prefs/client`, `next/navigation`; card costruite da `fixtureRecipesAsDomain()` con `toLibraryCard`):
  1. libreria vuota → `Ancora nessuna ricetta`, nessun campo di ricerca; `Vai al piano` → `router.push('/')`;
  2. ricerca per titolo e per ingrediente riducono l'elenco; il conteggio si aggiorna (`1 ricetta`);
  3. filtro senza risultati → `Nessuna ricetta trovata`; `Azzera filtri` riporta tutto;
  4. una card bloccata non si vede; con *Bloccate* si vede solo lei, con l'etichetta `Bloccata` e senza ★; nessuna bloccata + *Bloccate* → `Nessuna ricetta bloccata`;
  5. ordine: una preferita più vecchia sta sopra una non preferita più recente;
  6. ★ rapida: `putRecipePref(id, { favorite: true })`, card subito in testa; errore → torna dov'era e compare il toast;
  7. tocco su una card → `RecipeDetailSheet` chiede `fetchRecipeDetail(id)` e mostra le quantità scalate su `persons` (ricetta con `servings_base: 2`, `persons: 4` → quantità doppia);
  8. *Non proporre più* nel dettaglio → la card sparisce dall'elenco e compare il toast `Non la proporrò più.`.

### Contratti esposti
Nessuno verso altri WP.

### Dipendenze
- **WP1**: tipi, `filterLibraryCards`, `toLibraryCard` (test), `putRecipePref`.
- **WP3**: `listLibraryCards`.
- **WP5**: `RecipeDetailSheet`, `recipeChips` con parametro allargato.
- Esistente: `getSettings` (`lib/settings/service.ts`).

### Criteri di accettazione
- Sul seed (`pnpm db:seed`): filtro e ricerca funzionano; il dettaglio mostra le quantità scalate sulle persone dell'household (S2.1).
- Voto, ★ e blocco persistono al reload; le bloccate si vedono solo con *Bloccate* (S2.2).
- Nessun riferimento a `MOCK_RECIPES` resta nel repository.

### Fuori ambito
Filtri nell'URL, paginazione, generazione di ricette dalla Libreria, inserimento manuale, eliminazione di ricette.

---

## WP7 — Preferenze nel Piano (wave 3, parallelo a WP6 e WP8)

**Obiettivo:** ★ rapida sulla card-pasto e dettaglio completo (voto, preferita, blocco, 👍/👎) anche dalla pagina Piano.

### File
- `components/plan/plan-slot-card.tsx`, `components/plan/plan-screen.tsx` — **modifica**
- `tests/ui/plan-slot-card.test.tsx`, `tests/ui/plan-screen.test.tsx` — **modifica**

### Pattern di riferimento
- Aggiornamento ottimistico con ripristino: `handleToggleLock` in `components/plan/plan-screen.tsx`.
- `MealCard` mostra già la ★ (e `aria-pressed`) quando riceve `onToggleFavorite`: `components/cards/meal-card.tsx` **non si modifica**.

### Passi

**1. `components/plan/plan-slot-card.tsx`.** Nuovo parametro opzionale:
```ts
/** Alterna la preferita della ricetta dello slot. Assente → nessuna ★. */
onToggleFavorite?: (recipeId: string) => void;
```
Passare a `MealCard`: `isFavorite={slot.recipe?.prefs?.favorite ?? false}` e `onToggleFavorite` = una funzione che chiama `onToggleFavorite(slot.recipe.id)` **solo se** c'è `onToggleFavorite`, c'è `slot.recipe` e `slot.recipe.prefs?.blocked !== true`; altrimenti `undefined`. La ★ compare anche sulle card non modificabili (settimane passate): il giudizio riguarda la ricetta, non il piano. Durante lo swap e la revisione il footer è già sostituito da `actions`: nessuna modifica lì.

**2. `components/plan/plan-screen.tsx`.**
- Sostituire l'import e l'uso di `RecipeSheet` e `toRecipeDetail` con `RecipeDetailSheet`; eliminare il `useMemo` `sheetRecipe`.
- Nuova funzione di stato:
  ```ts
  /** Aggiorna le preferenze di una ricetta in tutti gli slot del piano mostrato. */
  const applyRecipePrefs = (recipeId: string, prefs: RecipePref): void => { … }
  // setScreen(prev => …): per ogni slot con slot.recipe?.id === recipeId → { ...slot, recipe: { ...slot.recipe, prefs } }
  ```
- `handleToggleFavorite(recipeId)`: trovare la ricetta nel piano; se assente o già in salvataggio (un `Set` in un ref), ignorare. `current = recipe.prefs ?? defaultRecipePref(recipeId)`; ottimistico: `applyRecipePrefs(recipeId, { ...current, ...applyRecipePrefPatch(current, { favorite: !current.favorite }) })`; `saved = await putRecipePref(recipeId, { favorite: !current.favorite })` → `applyRecipePrefs(recipeId, saved)`; errore → `applyRecipePrefs(recipeId, current)` e `setToast(err instanceof ApiRequestError ? err.message : FALLBACK_ERROR_MESSAGE)`.
- Passare `onToggleFavorite={(recipeId) => void handleToggleFavorite(recipeId)}` a ogni `PlanSlotCard`.
- Dettaglio:
  ```tsx
  <RecipeDetailSheet
    recipeId={sheetSlot?.recipe?.id ?? null}
    servings={sheetSlot?.servings ?? 1}
    initialRecipe={sheetSlot?.recipe ?? null}
    onClose={() => setSheetSlotId(null)}
    onRecipePrefsChange={applyRecipePrefs}
    onNotify={setToast}
    blockedMessage="Non la proporrò più. In questo piano resta: usa Cambia per sostituirla."
  />
  ```
- Nessuna chiamata a generazione, swap o rigenerazione in seguito a un giudizio (regola 0.3.6).

**3. Test.**
- `tests/ui/plan-slot-card.test.tsx` — aggiungere: senza `onToggleFavorite` nessuna ★; con `onToggleFavorite` la ★ c'è e il tocco passa l'**id della ricetta** (non dello slot); `aria-pressed="true"` se `recipe.prefs.favorite`; nessuna ★ se la ricetta è bloccata o lo slot non ha ricetta; la ★ c'è anche con `editable={false}`.
- `tests/ui/plan-screen.test.tsx`: aggiungere `vi.mock("@/lib/library/client", …)` (con `fetchRecipeDetail`) e `vi.mock("@/lib/prefs/client", …)` (con `putRecipePref`, `putIngredientPref`), entrambi con `importOriginal` come il mock esistente di `@/lib/plans/client`; in `beforeEach` `fetchRecipeDetail` risolve di default con `{ recipe: <ricetta richiesta da RECIPES>, ingredients: [] }`. Riscrivere il blocco "recipe sheet and preferences":
  1. tocco sul titolo → il dialog mostra subito il titolo (prima che `fetchRecipeDetail` risolva) e contiene `Non proporre più`;
  2. le card hanno il pulsante `Aggiungi ai preferiti`; il tocco chiama `putRecipePref(RECIPES[0].id, { favorite: true })` e il pulsante diventa `Rimuovi dai preferiti`; errore → torna `Aggiungi ai preferiti` e compare il toast;
  3. *Non proporre più* dal dettaglio → toast `Non la proporrò più. In questo piano resta: usa Cambia per sostituirla.`; la card resta nel piano e non ha più la ★; `requestSwapSlot` e `requestGeneratePlan` **non** sono chiamate;
  4. voto dal dettaglio → `putRecipePref(id, { rating: 5 })`.
  Il test "keeps a past week read-only…" va adeguato solo se verifica l'assenza di pulsanti nel footer: la ★ ora c'è anche lì.

### Contratti esposti
Nessuno verso altri WP.

### Dipendenze
- **WP1**: `applyRecipePrefPatch`, `defaultRecipePref`, `putRecipePref`, tipi.
- **WP5**: `RecipeDetailSheet`.

### Criteri di accettazione
- Dal Piano si può dare ★ dalla card e voto, blocco e 👍/👎 dal dettaglio; lo stato sopravvive al reload.
- Bloccare una ricetta del piano non cambia il piano (nessuna richiesta a `/api/plans/**`).
- `components/cards/meal-card.tsx` non ha modifiche.

### Fuori ambito
Contrassegni "bloccata" sulla card-pasto, swap automatico, avviso di piano superato per un giudizio.

---

## WP8 — *I miei ingredienti* nelle Impostazioni (wave 3, parallelo a WP6 e WP7)

**Obiettivo:** la vista d'insieme dei giudizi sugli ingredienti, con rimozione a un tap, al posto del segnaposto.

### File
- `components/settings/ingredient-prefs-section.tsx` — nuovo
- `components/settings/ingredient-prefs-placeholder.tsx` — **eliminato**
- `components/settings/settings-editor.tsx`, `app/(app)/impostazioni/page.tsx` — **modifica**
- `tests/ui/ingredient-prefs-section.test.tsx` — nuovo; `tests/ui/settings-editor.test.tsx`, `tests/app/settings-page.test.tsx` — **modifica**

### Pattern di riferimento
- Card e titoli come le sezioni di `components/settings/settings-editor.tsx`; messaggio d'errore `role="alert"` come quello di salvataggio nello stesso file.
- Riallineamento dello stato alla prop: `syncedInitialScreen` in `components/plan/plan-screen.tsx`.

### Passi

**1. `components/settings/ingredient-prefs-section.tsx`** (`"use client"`):
```ts
export interface IngredientPrefsSectionProps {
  initialPrefs: IngredientPrefsView;
}
export function IngredientPrefsSection(props: IngredientPrefsSectionProps): React.JSX.Element
```
- Stato: `prefs` (da `initialPrefs`, riallineato se la prop cambia identità), `removing: Set<string>` (nomi in rimozione), `error: string | null`.
- `Card className="p-4 space-y-3"` con `<h2 className="font-display text-base font-bold text-ink">I miei ingredienti</h2>`.
- Entrambe le liste vuote → solo `<p className="text-xs text-stone">Qui ritroverai gli ingredienti che segni con 👍 o 👎 nelle ricette.</p>`.
- Altrimenti due gruppi, ciascuno con `<h3 className="text-sm font-semibold text-ink">`: `Mi piacciono` (lista `likes`) e `Scartati` (lista `dislikes`). Gruppo vuoto → `<p className="text-xs text-stone">Nessuno per ora.</p>`. Ogni voce è una riga (`<li>` alta almeno 44 px) con:
  - il nome con l'iniziale maiuscola (`name.charAt(0).toUpperCase() + name.slice(1)`);
  - il conteggio in `text-xs text-stone tabular-nums`, omesso se `recipes_count === 0`: per i graditi `in 1 ricetta` / `in ${n} ricette`; per gli scartati `esclude 1 ricetta` / `esclude ${n} ricette`;
  - un pulsante 44×44 px con icona `X`, `aria-label={`Rimuovi ${name}`}`, disabilitato mentre quel nome è in rimozione.
- **Rimozione a un tap** (nessuna conferma): togliere subito la voce dalla lista e azzerare `error`; `await putIngredientPref(name, null)`; errore → rimettere la voce nella sua lista, riordinare con `localeCompare(…, 'it')` e `setError(`Non sono riuscito a rimuovere ${name}. Riprova.`)`. In ogni caso togliere il nome da `removing`.
- `error` non nullo → `<p role="alert" className="rounded-xl border border-tomato/30 bg-tomato/10 p-3 text-sm text-ink">`.

**2. `components/settings/settings-editor.tsx`.** `SettingsEditorProps` riceve `initialIngredientPrefs?: IngredientPrefsView` (opzionale). Sostituire `<IngredientPrefsPlaceholder />` con `<IngredientPrefsSection initialPrefs={initialIngredientPrefs ?? EMPTY_INGREDIENT_PREFS_VIEW} />` e togliere il vecchio import. La sezione resta **fuori** dal `fieldset` e non partecipa a *Salva*.

**3. `components/settings/ingredient-prefs-placeholder.tsx`:** eliminare il file.

**4. `app/(app)/impostazioni/page.tsx`:**
```tsx
const [settings, ingredientPrefs] = await Promise.all([getSettings(), listIngredientPrefs()]);
return <SettingsEditor initialSettings={settings} initialIngredientPrefs={ingredientPrefs} />;
```
(`listIngredientPrefs` da `@/lib/prefs/service`.)

**5. Test.**
- `tests/ui/ingredient-prefs-section.test.tsx` (`vi.mock` di `@/lib/prefs/client`): liste vuote → frase introduttiva e nessun gruppo; liste piene → titoli `Mi piacciono` e `Scartati`, nomi con l'iniziale maiuscola, conteggi nelle quattro forme e omessi a 0; un gruppo vuoto → `Nessuno per ora.`; `Rimuovi cipolla` → `putIngredientPref('cipolla', null)` e voce sparita subito; errore → voce di nuovo presente, in ordine, e `role="alert"` con il testo atteso; una nuova prop `initialPrefs` sostituisce lo stato.
- `tests/ui/settings-editor.test.tsx`: nel primo test sostituire "plus the ingredient placeholder" con "plus the ingredient section" (l'asserzione su `I miei ingredienti` resta); aggiungere un test: con `initialIngredientPrefs` contenente uno scarto, il nome compare sotto `Scartati` e *Salva* resta disabilitato.
- `tests/app/settings-page.test.tsx`: aggiungere `vi.mock("@/lib/prefs/service", () => ({ listIngredientPrefs: vi.fn() }))`; il test verifica anche che `listIngredientPrefs` sia chiamata una volta e che `element.props.initialIngredientPrefs` sia il valore restituito.

### Contratti esposti
Nessuno verso altri WP.

### Dipendenze
- **WP1**: `IngredientPrefsView`, `EMPTY_INGREDIENT_PREFS_VIEW`, `putIngredientPref`.
- **WP3**: `listIngredientPrefs`.

### Criteri di accettazione
- Un ingrediente scartato da una ricetta compare in *Scartati* dopo il reload delle Impostazioni; rimosso da lì, torna proponibile (lo copre il test d'integrazione di WP3 sul servizio).
- `tests/ui/shell.test.tsx` (che monta `SettingsEditor` senza il nuovo parametro) resta verde senza modifiche.
- Nessun riferimento a `IngredientPrefsPlaceholder` resta nel repository.

### Fuori ambito
Aggiunta di ingredienti dalle Impostazioni (i giudizi nascono solo dalle ricette), ricerca tra gli ingredienti, modifiche all'onboarding.

---

## Riuso obbligatorio (non reimplementare)
| Serve | Si usa |
|---|---|
| Normalizzare un nome d'ingrediente | `normalizeCanonicalName` (`lib/domain/recipe-text.ts`) |
| Normalizzare il testo di ricerca | `normalizeTitle` (`lib/domain/recipe-text.ts`) |
| Implicazioni tra diete | `expandDietFlags` (`lib/domain/recipe-text.ts`) |
| Insiemi di preferenze per il planner | `toIngredientPreferenceSets` (`lib/domain/planner.ts`) |
| Caricare l'household | `loadHousehold` (`lib/db/repositories/household-repo.ts`) |
| Leggere la libreria completa | `listRecipes` / `listRecipesWith` (`lib/db/repositories/recipe-repo.ts`) |
| Risposte d'errore e lettura del body | `lib/http/responses.ts` |
| Richieste dal client ed errori | `requestJson`, `ApiRequestError` (`lib/http/client.ts`) |
| Chip e quantità scalate del dettaglio | `recipeChips`, `toRecipeDetail` (`components/sheets/recipe-detail.ts`) |
| Regola "bloccare toglie dalle preferite" | `applyRecipePrefPatch` (`lib/domain/prefs.ts`, WP1) — server **e** client |
| Impatto di un ingrediente | `countRecipesByIngredient` (`lib/domain/prefs.ts`, WP1) |
| Filtro, ricerca, ordinamento | `filterLibraryCards` (`lib/domain/library.ts`, WP1) — rotta **e** schermata |
| Chip, stato vuoto, toast, card | `ChipFilter`, `EmptyState`, `Toast`, `Card`, `Badge`, `Button` esistenti |
| Ricette e household di test | `tests/helpers/{db,plans,mock-llm}.ts` |

## Contratti consegnati alle feature successive
- **F6 (lista della spesa):** i giudizi non impostano `shopping_lists.needs_regeneration` perché non modificano i piani. Se F6 introduce una canonicalizzazione dei nomi (alias risolti in scrittura, o vocabolario della libreria nel prompt), il backfill riscrive insieme `recipe_ingredients.canonical_name` e `ingredient_prefs.canonical_name`; se due righe collidono sulla chiave `(household_id, canonical_name)`, vince `dislike` (architecture review, D1-c).
- **F7 (deploy):** una migrazione in più (`0004`), applicata dallo stesso `pnpm db:migrate`.
- **v2 (uso in due):** `ingredient_prefs` è già partizionata per household.

---

## Mappa delle dipendenze

```
Wave 1:  WP1 ∥ WP2
Wave 2:  WP3 ∥ WP4 ∥ WP5
Wave 3:  WP6 ∥ WP7 ∥ WP8
```
| WP | Richiede | File condivisi con altri WP della stessa wave |
|---|---|---|
| WP1 | — | nessuno |
| WP2 | — | nessuno |
| WP3 | WP1, WP2 | nessuno |
| WP4 | WP2 | nessuno |
| WP5 | WP1 | nessuno |
| WP6 | WP1, WP3, WP5 | nessuno (`tests/ui/shell.test.tsx` è solo suo) |
| WP7 | WP1, WP5 | nessuno |
| WP8 | WP1, WP3 | nessuno |

Vincoli di ordine: le tre wave sono **strettamente sequenziali**, con il gate completo tra l'una e l'altra; dentro ogni wave i WP sono su file disgiunti e possono girare in parallelo. Nessun WP importa un file creato da un altro WP della stessa wave. Prima della wave 1 (test DB di WP2) deve essere attivo il Postgres di sviluppo (regola 0.3.7); dopo WP2 va eseguito `pnpm db:migrate`.

## Checklist finale
- [ ] **WP1** — Contratti F5 in `types.ts`, `lib/domain/library.ts`, `lib/domain/prefs.ts`, `lib/library/client.ts`, `lib/prefs/client.ts`
- [ ] **WP2** — `ingredient_prefs` + migrazione `0004`, `ingredient-pref-repo.ts`, aggiunte a `recipe-repo.ts`, `loadIngredientPreferences` reale, ARCHITECTURE §4.2 e §5.4
- [ ] **WP3** — `lib/library/service.ts`, `lib/prefs/service.ts`, rotte `GET /api/recipes`, `GET /api/recipes/:id`, `PUT /api/recipes/:id/pref`, `GET /api/ingredient-prefs`, `PUT /api/ingredient-prefs/:canonicalName`
- [ ] **WP4** — Like/dislike in `buildConstraints` e `generateAndStoreRecipes`
- [ ] **WP5** — `RecipeSheet` (aggiunte compatibili), `recipe-detail.ts`, `RecipeDetailSheet`
- [ ] **WP6** — Pagina e schermata Libreria, `RecipeCard`, `LibraryFilters`, `loading.tsx`, DESIGN §4.4
- [ ] **WP7** — ★ sulla card-pasto e dettaglio completo nel Piano
- [ ] **WP8** — Sezione *I miei ingredienti*, rimozione del segnaposto

**Chiusura della feature** (accettazioni del backlog):
- S2.1 — filtro e ricerca funzionano sul seed; il dettaglio mostra le quantità scalate (WP1, WP3, WP6).
- S2.2 — voto, ★ e blocco persistono al reload; una ricetta bloccata non è mai proposta dal planner (WP2, WP3, WP6, WP7).
- S2.3 — scartato un ingrediente, nessuna ricetta che lo contiene viene più proposta (WP2, WP3) né generata (WP4); con i gradimenti attivi le ricette che li contengono escono più spesso nel test statistico (WP2).

## Autoverifica
| Domanda di analisi | Dove trova risposta |
|---|---|
| Preferenze anche nel Piano? | U1 → WP7 |
| Cosa succede al piano in corso dopo un giudizio? | U2 → regola 0.3.6, WP5 (`blockedMessage`, `dislikedToast`), WP7 (test 3) |
| Disposizione dei filtri | U3 → WP6 passo 4 |
| Ordinamento della Libreria | U4 → WP1 `compareLibraryCards`, WP6 passo 5 |
| Chiave di `ingredient_prefs` | P2 → WP2 passi 1 e 7 |
| Come si mostra l'impatto prima della conferma | P4, P5 → WP1 (`RecipeIngredientInfo`), WP3 (`getRecipeDetail`), WP5 passi 2 e 3 |
| Semantica di `PUT …/pref` e blocco/preferita | P6, P7 → WP1 `applyRecipePrefPatch`, WP3 `updateRecipePref` |
| Filtro lato server o client | P8, P20 → WP1, WP3, WP6 |
| Cosa viaggia nella lista e cosa nel dettaglio | P9 → WP1 (`LibraryRecipeCard`, `RecipeDetailView`) |
| Regole di ricerca e di filtro | P10, P11 → WP1 passo 2 |
| Un dettaglio per due pagine senza rompere il gate tra le wave | P12, P13 → WP5 (vincolo di compatibilità) |
| Risposte fuori ordine | P14 → WP5 (`savingPrefs`, `savingIngredient`), WP6 e WP7 (insieme degli id in salvataggio) |
| Quanti like/dislike nel prompt | P16 → WP4 passo 1 |
| Dove si leggono le preferenze ingrediente | P17 → WP2 passo 5, WP4 passo 2 |
| Come entra la sezione nelle Impostazioni senza rompere i test | P18 → WP8 passo 2 |
| Errori e 404 | P19 → WP3 passo 3 |
