# Feature 2 — E1 Motore ricette · Piano di implementazione

**Data:** 2026-09-17 · **Stato:** done · **Input di:** `/arch-review 2` → `/feature-dev 2`
**Story:** S1.1 LLM adapter · S1.2 Generazione e persistenza · S1.3 Seed e fixtures (`docs/BACKLOG.md`)
**Decisioni motivate:** [`requirements.md`](requirements.md) (U1–U4 dell'utente, P1–P20 di planning). Questo piano le recepisce come definitive.

---

## 0. Contesto per chi implementa (leggere tutto prima del proprio WP)

### 0.1 Obiettivo della feature
Dalla richiesta con vincoli alla libreria persistente: un adapter LLM provider-agnostico (unico punto che parla col provider), un servizio che genera, filtra, deduplica e salva le ricette, una route `POST /api/recipes/generate`, e fixtures + seed idempotente per lavorare senza chiavi API.

### 0.2 Stato reale del codice (as-built della Feature 1)
- Next.js **15.5** (App Router, root senza `src/`, alias `@/*` → `./*`), React 19, TypeScript strict, **zod 3.25.76**, Drizzle `0.39` con driver `postgres` (postgres.js), Vitest 3 (`vitest.config.ts`: ambiente **jsdom** globale, `globals: true`), `tsx` già installato, gestore pacchetti **pnpm**.
- `lib/domain/types.ts` — schemi Zod ed enum chiusi (`UnitSchema`, `CategorySchema`, `MealTypeSchema`, `DietFlagSchema`, `MealStyleTagSchema`, `ApplianceSchema`, `IngredientSchema`, `RecipeSchema`, `HouseholdSchema`, `IngredientAliasSchema`, `DIET_FLAG_VALUES`, `DEFAULT_HOUSEHOLD_ID`, `DEFAULT_HOUSEHOLD`, …). **È la single source of truth: nessun WP ridefinisce tipi di dominio altrove.**
- `lib/db/index.ts` — esporta `client` (postgres.js), `db` (drizzle con `schema`), `type Database`, e riesporta tutte le tabelle di `lib/db/schema.ts`.
- `lib/db/schema.ts` — tabelle `households`, `recipes` (con `slug` unico globale e indice GIN `gin_trgm_ops` su `title`), `recipe_ingredients` (`qty` è `numeric` → stringa in scrittura), `recipe_prefs`, `ingredient_aliases` (`alias` PK), ecc. L'estensione `pg_trgm` è creata dalla migrazione `0000` e da `docker/init-db.sql`.
- `lib/db/repositories/household-repo.ts` — `getHouseholdById(id)`, `ensureDefaultHousehold()`, `getDefaultHousehold()`, `updateHousehold()`.
- `lib/db/repositories/recipe-repo.ts` — `insertRecipe(recipeData, ingredientsData, prefData?)` (transazione propria: ricetta + ingredienti + pref di default), `getRecipeById`, `getRecipeBySlug`, `deleteRecipe`, `listRecipes`, tipi `InsertRecipeInput`, `InsertIngredientInput`, `InsertRecipePrefInput`, `RecipeWithDetails`.
- `tests/db/schema.test.ts` — riferimento di stile per i test (import con `@/`, `describe/it/expect` da `vitest`).
- `package.json` ha già lo script `"db:seed": "tsx lib/db/seed.ts"` (il file non esiste ancora).
- `fixtures/.gitkeep`, `lib/llm/.gitkeep` — cartelle vuote.

### 0.3 Regole vincolanti (valgono per ogni WP)
1. Tipi di dominio **solo** da `@/lib/domain/types` (contratto trasversale n.1).
2. **Solo** `lib/llm/` importa `ai` e i pacchetti provider; **solo** `lib/recipes/` importa da `@/lib/llm` (contratto n.4). La route importa `lib/recipes` e `lib/llm/errors`, mai `lib/llm/adapter` direttamente.
3. **Test senza rete** (contratto n.5): nessun test chiama un provider reale; i modelli si sostituiscono con `MockLanguageModelV4` da `ai/test`.
4. Ogni **nuovo** file di test lato server inizia con la riga `// @vitest-environment node`.
5. Identificatori e codice in inglese; testi di prompt, messaggi per l'utente e dettagli di scarto in italiano.
6. **AI SDK 7** — non usare API di versioni precedenti: `generateText` con `output: Output.object({ schema })` (non `generateObject`), `instructions` (non `system`), risultato in `result.output`. Errori: `NoObjectGeneratedError` (proprietà `text`, `cause`), `APICallError`, `RetryError`, tutti esportati da `ai`. Mock: `MockLanguageModelV4` da `ai/test`. **Il codice reale vince**: se un nome esportato differisce nella versione installata, verificarlo in `node_modules/ai` e adeguarsi mantenendo il comportamento descritto.
7. Gate per ogni wave: `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build` verdi. I test DB richiedono `docker compose -f docker-compose.dev.yml up -d` e `pnpm db:migrate`.

### 0.4 Mappa dei work package
| WP | Story | Wave | Contenuto |
|---|---|---|---|
| WP1 | trasversale | 1 (solitaria) | Dipendenze, contratti Zod nuovi, utility di normalizzazione, helper di test DB, `.env.example` |
| WP2 | S1.1 | 2 | Adapter LLM: factory `getModel`, prompt, `generateRecipes` con repair, errori tipizzati, registrazioni, script `llm:record` |
| WP3 | S1.3 | 2 | `fixtures/recipes.json` (18 ricette), alias, loader fixtures, seed idempotente |
| WP4 | S1.2 | 3 | Repository (tx, titoli, similarità, slug, lock), vincoli, servizio `generateAndStoreRecipes`, route `POST /api/recipes/generate` |

---

## WP1 — Contratti, dipendenze e utility condivise (wave 1, solitaria)

**Obiettivo:** introdurre una sola volta tutto ciò che le wave successive condividono (pacchetti, schemi Zod, funzioni di normalizzazione, helper di test), così che WP2, WP3 e WP4 siano file-disjoint.

### File
- Modifica: `package.json`, `pnpm-lock.yaml` (tramite pnpm), `lib/domain/types.ts` (solo aggiunte in coda), `.env.example`, `CLAUDE.md` (una riga nella sezione Comandi)
- Crea: `lib/domain/recipe-text.ts`, `tests/helpers/db.ts`, `tests/domain/recipe-text.test.ts`, `tests/domain/generation-contracts.test.ts`

### Pattern di riferimento
- Stile schemi/enum: `lib/domain/types.ts` (array `const` + `z.enum`, `export type X = z.infer<typeof XSchema>`).
- Controllo disponibilità DB: `tests/db/schema.test.ts` righe ~406–432 (`client\`SELECT 1\`` in `Promise.race` con timeout di 1000 ms).

### Passi
1. **Dipendenze** (dalla root):
   `pnpm add ai@^7 @ai-sdk/google@^4 @ai-sdk/anthropic@^4 @ai-sdk/openai-compatible@^3 @openrouter/ai-sdk-provider@^3`
   Non aggiornare altri pacchetti. Non cambiare la versione di `zod`.
2. **Script** in `package.json` → `scripts`: aggiungere `"llm:record": "tsx scripts/llm-record.ts"`. Lasciare invariato `"db:seed": "tsx lib/db/seed.ts"`.
3. **`CLAUDE.md`**, blocco "Comandi": aggiungere dopo la riga di `pnpm db:seed`:
   `pnpm llm:record     # registra una risposta LLM reale in tests/fixtures/llm/recorded/ (richiede chiave API)`
4. **`.env.example`** — sostituire l'intero contenuto con:
   ```dotenv
   DATABASE_URL=postgresql://mealy:mealy@localhost:5432/mealy_dev

   # Provider LLM: google | openrouter | anthropic | openai-compatible
   LLM_PROVIDER=google
   LLM_MODEL=gemini-2.5-flash
   # Timeout di una singola chiamata LLM, in millisecondi
   LLM_TIMEOUT_MS=50000

   # Serve solo la chiave del provider attivo (mai esposta al client)
   GOOGLE_GENERATIVE_AI_API_KEY=

   # Alternativa: OpenRouter (scegliere un modello ":free" con supporto structured output)
   # LLM_PROVIDER=openrouter
   # LLM_MODEL=<id modello OpenRouter>
   OPENROUTER_API_KEY=

   ANTHROPIC_API_KEY=

   # Solo per LLM_PROVIDER=openai-compatible
   LLM_BASE_URL=
   LLM_API_KEY=
   ```
5. **`lib/domain/types.ts`** — aggiungere in coda (dopo `DEFAULT_HOUSEHOLD`) una sezione `// Recipe Generation Contracts (Feature 2)` con **esattamente**:
   ```ts
   // Output LLM (ARCHITECTURE §5.1). Nessun .optional()/.default(): i provider
   // con structured output gestiscono male i campi opzionali.
   export const GeneratedIngredientSchema = z.object({
     canonical_name: z.string().min(1),
     display_name: z.string().min(1),
     qty: z.number().positive().nullable(),
     unit: UnitSchema,
     category: CategorySchema,
     note: z.string().nullable(),
   });
   export type GeneratedIngredient = z.infer<typeof GeneratedIngredientSchema>;

   export const GeneratedRecipeSchema = z.object({
     title: z.string().min(3).max(120),
     description: z.string(),
     meal_types: z.array(MealTypeSchema).min(1),
     tags: z.array(MealStyleTagSchema),
     diet_flags: z.array(DietFlagSchema),
     appliances_required: z.array(ApplianceSchema),
     servings_base: z.number().int().min(1).max(12),
     prep_minutes: z.number().int().min(1).max(600),
     kcal_est: z.number().int().positive().nullable(),
     steps: z.array(z.string().min(1)).min(1),
     ingredients: z.array(GeneratedIngredientSchema).min(1),
   });
   export type GeneratedRecipe = z.infer<typeof GeneratedRecipeSchema>;

   export const GenerateRecipesOutputSchema = z.object({
     recipes: z.array(GeneratedRecipeSchema).min(1),
   });
   export type GenerateRecipesOutput = z.infer<typeof GenerateRecipesOutputSchema>;

   // Vincoli passati all'adapter. ingredient_likes/dislikes: canonical_name,
   // vuoti fino alla Feature 5 (S2.3), che li popolerà da ingredient_prefs.
   export const RecipeConstraintsSchema = z.object({
     persons: z.number().int().min(1).max(12),
     meal_type: MealTypeSchema.nullable(),
     diet_tags: z.array(DietFlagSchema),
     meal_style_tags: z.array(MealStyleTagSchema),
     appliances: z.array(ApplianceSchema),
     ingredient_likes: z.array(z.string().min(1)),
     ingredient_dislikes: z.array(z.string().min(1)),
   });
   export type RecipeConstraints = z.infer<typeof RecipeConstraintsSchema>;

   export const ConstraintOverridesSchema = z
     .object({
       persons: z.number().int().min(1).max(12),
       diet_tags: z.array(DietFlagSchema),
       meal_style_tags: z.array(MealStyleTagSchema),
       appliances: z.array(ApplianceSchema),
     })
     .partial()
     .strict();
   export type ConstraintOverrides = z.infer<typeof ConstraintOverridesSchema>;

   // Body di POST /api/recipes/generate
   export const GENERATE_COUNT_MIN = 1;
   export const GENERATE_COUNT_MAX = 10;
   export const GENERATE_COUNT_DEFAULT = 5;
   export const GenerateRecipesRequestSchema = z
     .object({
       count: z.number().int().min(GENERATE_COUNT_MIN).max(GENERATE_COUNT_MAX).default(GENERATE_COUNT_DEFAULT),
       meal_type: MealTypeSchema.nullable().default(null),
       overrides: ConstraintOverridesSchema.default({}),
     })
     .strict();
   export type GenerateRecipesRequest = z.infer<typeof GenerateRecipesRequestSchema>;

   export const GENERATION_SKIP_REASON_VALUES = ['duplicate', 'constraint_violation'] as const;
   export const GenerationSkipReasonSchema = z.enum(GENERATION_SKIP_REASON_VALUES);
   export type GenerationSkipReason = z.infer<typeof GenerationSkipReasonSchema>;
   export const GenerationSkipSchema = z.object({
     title: z.string(),
     reason: GenerationSkipReasonSchema,
     detail: z.string(),
   });
   export type GenerationSkip = z.infer<typeof GenerationSkipSchema>;

   // Fixtures (fixtures/recipes.json, fixtures/ingredient-aliases.json)
   export const FixtureRecipeSchema = GeneratedRecipeSchema.extend({
     id: z.string().uuid(),
     slug: z.string().min(1),
   });
   export type FixtureRecipe = z.infer<typeof FixtureRecipeSchema>;
   export const FixtureFileSchema = z.object({
     recipes: z.array(FixtureRecipeSchema).min(15).max(20),
   });
   export const IngredientAliasesFileSchema = z.object({
     aliases: z.array(IngredientAliasSchema).min(15),
   });
   ```
   Non modificare nulla di ciò che esiste già nel file.
6. **`lib/domain/recipe-text.ts`** — funzioni pure, nessun import oltre a `@/lib/domain/types`:
   ```ts
   export function normalizeTitle(title: string): string
   export function slugify(title: string): string
   export function normalizeCanonicalName(name: string): string
   export function expandDietFlags(flags: readonly DietFlag[]): DietFlag[]
   export function normalizeGeneratedRecipe(recipe: GeneratedRecipe): GeneratedRecipe
   ```
   Regole esatte:
   - `normalizeTitle`: `title.normalize('NFD').replace(/\p{M}/gu, '')` → `toLowerCase()` → sostituire ogni sequenza di caratteri **non** `[a-z0-9]` con uno spazio → `trim()`. Esempi: `'Pasta al Pomodoro!'` → `'pasta al pomodoro'`; `'  Caffè   d\'orzo '` → `'caffe d orzo'`; `'!!!'` → `''`.
   - `slugify`: `normalizeTitle(title)` → spazi sostituiti da `-` → troncare a 80 caratteri → rimuovere `-` finali. Se il risultato è vuoto → `'ricetta'`. Esempio: `'Ceci croccanti in friggitrice ad aria'` → `'ceci-croccanti-in-friggitrice-ad-aria'`.
   - `normalizeCanonicalName`: `trim()` → `toLowerCase()` → sequenze di whitespace collassate in uno spazio. **Gli accenti restano** (`'Caffè'` → `'caffè'`).
   - `expandDietFlags`: chiusura delle implicazioni `vegano ⇒ vegetariano, senza-lattosio`; `vegetariano ⇒ pescetariano` (applicate fino a punto fisso, quindi `vegano` produce anche `pescetariano`). Output senza duplicati e **nell'ordine di `DIET_FLAG_VALUES`**. Esempio: `['vegano']` → `['vegetariano','vegano','senza-lattosio','pescetariano']`; `['senza-glutine','senza-glutine']` → `['senza-glutine']`; `[]` → `[]`.
   - `normalizeGeneratedRecipe` restituisce un **nuovo** oggetto (non muta l'input):
     - `title`: `trim()` e whitespace interni collassati; `description`: `trim()`.
     - `steps`: `trim()` di ciascuno, rimossi i vuoti.
     - `meal_types`, `tags`, `appliances_required`: duplicati rimossi mantenendo il primo ordine di comparsa.
     - `diet_flags`: `expandDietFlags`.
     - per ogni ingrediente: `canonical_name` → `normalizeCanonicalName`; `display_name` → `trim()`; `note` → `trim()`, stringa vuota ⇒ `null`; se `unit === 'qb'` ⇒ `qty = null`; se `qty === null` e `unit !== 'qb'` ⇒ `unit = 'qb'`.
     - tutti gli altri campi invariati.
7. **`tests/helpers/db.ts`** (modulo di supporto, non un file di test):
   ```ts
   export async function isDbAvailable(): Promise<boolean>
   export async function assertDbMigrated(): Promise<void>
   export async function createTestHousehold(
     overrides?: Partial<Pick<Household, 'persons' | 'meals' | 'diet_tags' | 'meal_style_tags' | 'appliances'>>
   ): Promise<string>
   export async function deleteTestHousehold(id: string): Promise<void>
   ```
   - `isDbAvailable`: importa `client` da `@/lib/db`, esegue `SELECT 1` in `Promise.race` con timeout di 1000 ms; `true` se riesce, `false` su qualsiasi errore. Non lancia mai.
   - `assertDbMigrated`: esegue `select to_regclass('public.recipes') as t, exists(select 1 from pg_extension where extname = 'pg_trgm') as trgm`; se `t` è `null` o `trgm` è `false` lancia `new Error('Schema DB assente o incompleto: esegui `pnpm db:migrate` prima dei test.')`.
   - `createTestHousehold`: inserisce in `households` una riga con `id = crypto.randomUUID()` e i valori di `DEFAULT_HOUSEHOLD` (persons, meals, diet_tags, meal_style_tags, appliances) sovrascritti da `overrides`; ritorna l'id.
   - `deleteTestHousehold`: `delete from households where id = $id` (ricette, ingredienti e pref spariscono per `ON DELETE CASCADE`).
   - Uso previsto nei test: `const dbUp = await isDbAvailable();` a livello di modulo, poi `describe.skipIf(!dbUp)(...)` con `beforeAll(assertDbMigrated)`.
8. **Test**:
   - `tests/domain/recipe-text.test.ts`: tutti gli esempi del passo 6 + immutabilità di `normalizeGeneratedRecipe` (l'input resta uguale, verificato con `structuredClone` prima/dopo) + regola `qb` in entrambe le direzioni + `note: '  '` ⇒ `null`.
   - `tests/domain/generation-contracts.test.ts`: `GeneratedRecipeSchema` accetta una ricetta valida con `appliances_required: []`, rifiuta `unit: 'kg'`, `category: 'frutta'`, `meal_types: []`, `steps: []`, `servings_base: 0`; `GenerateRecipesRequestSchema.parse({})` ⇒ `{ count: 5, meal_type: null, overrides: {} }`; rifiuta `count: 0`, `count: 11`, `count: 2.5`, chiavi sconosciute (`{ foo: 1 }`) e `overrides: { household_id: 'x' }`; `RecipeConstraintsSchema` accetta liste vuote.

### Contratti esposti
Tutti i simboli del passo 5 (da `@/lib/domain/types`), le cinque funzioni del passo 6 (da `@/lib/domain/recipe-text`), i quattro helper del passo 7 (da `@/tests/helpers/db` — l'alias `@/*` copre anche `tests/`), i pacchetti AI SDK installati, lo script `llm:record` (implementato da WP2).

### Dipendenze
Nessuna (primo WP).

### Criteri di accettazione
- `pnpm install` pulito; `ai` 7.x e i quattro provider presenti in `package.json`.
- I due nuovi file di test passano; gate completo verde (i test esistenti restano verdi).
- `lib/domain/types.ts`: nessuna riga preesistente modificata (`git diff` mostra solo aggiunte in coda).

### Fuori scope
Qualsiasi file sotto `lib/llm/`, `lib/recipes/`, `lib/db/`, `fixtures/`, `app/`; il file `scripts/llm-record.ts` (WP2).

---

## WP2 — LLM adapter (S1.1) (wave 2, parallelo a WP3)

**Obiettivo:** unico modulo che parla col provider: dai vincoli a `GeneratedRecipe[]` validate e normalizzate, con un retry di repair ed errori tipizzati; provider e modello scelti solo via env.

### File
- Crea: `lib/llm/errors.ts`, `lib/llm/model.ts`, `lib/llm/prompts.ts`, `lib/llm/adapter.ts`, `lib/llm/index.ts`, `scripts/llm-record.ts`
- Crea: `tests/helpers/mock-llm.ts`, `tests/llm/model.test.ts`, `tests/llm/prompts.test.ts`, `tests/llm/adapter.test.ts`
- Crea: `tests/fixtures/llm/valid-2-recipes.txt`, `tests/fixtures/llm/malformed-truncated.txt`, `tests/fixtures/llm/invalid-enum.txt`, `tests/fixtures/llm/generation-mixed.txt`, `tests/fixtures/llm/recorded/.gitkeep`
- **Non** eliminare `lib/llm/.gitkeep`: `tests/verification.test.ts` ne verifica l'esistenza.

### Pattern di riferimento
- Commenti JSDoc brevi sopra le funzioni esportate come in `lib/db/repositories/recipe-repo.ts`.
- Schemi e tipi da `lib/domain/types.ts` (WP1); normalizzazione da `lib/domain/recipe-text.ts` (WP1).

### Passi

**1. `lib/llm/errors.ts`**
```ts
export const LLM_ERROR_CODES = ['config', 'provider', 'timeout', 'invalid_output'] as const;
export type LlmErrorCode = (typeof LLM_ERROR_CODES)[number];

export class LlmError extends Error {
  readonly code: LlmErrorCode;
  constructor(code: LlmErrorCode, message: string, options?: { cause?: unknown });
  // name = 'LlmError'; passa options a super(message, options)
}
export function isLlmError(error: unknown): error is LlmError; // instanceof LlmError
```
Questo file **non** importa `ai` (la route lo importa: deve restare leggero).

**2. `lib/llm/model.ts`**
```ts
export const LLM_PROVIDER_VALUES = ['google', 'openrouter', 'anthropic', 'openai-compatible'] as const;
export type LlmProvider = (typeof LLM_PROVIDER_VALUES)[number];
export interface LlmConfig { provider: LlmProvider; model: string; }
type Env = Record<string, string | undefined>;

export function readLlmConfig(env: Env = process.env): LlmConfig;
export function getModel(env: Env = process.env): LanguageModel; // LanguageModel importato come type da 'ai'
export function getLlmTimeoutMs(env: Env = process.env): number;
```
- `readLlmConfig`: `provider = (env.LLM_PROVIDER?.trim() || 'google')`; se non è in `LLM_PROVIDER_VALUES` → `new LlmError('config', \`LLM_PROVIDER non valido: "${valore}". Valori ammessi: google, openrouter, anthropic, openai-compatible.\`)`. `model = env.LLM_MODEL?.trim()`; se vuoto/assente → `LlmError('config', 'LLM_MODEL non impostato.')`.
- `getModel`: legge la config, poi per provider (chiave letta dall'`env` passato, valori vuoti = assenti):
  | provider | variabili richieste | costruzione |
  |---|---|---|
  | `google` | `GOOGLE_GENERATIVE_AI_API_KEY` | `createGoogleGenerativeAI({ apiKey })(model)` da `@ai-sdk/google` |
  | `openrouter` | `OPENROUTER_API_KEY` | `createOpenRouter({ apiKey })(model)` da `@openrouter/ai-sdk-provider` (se l'istanza non è invocabile nella versione installata, usare `.chat(model)`) |
  | `anthropic` | `ANTHROPIC_API_KEY` | `createAnthropic({ apiKey })(model)` da `@ai-sdk/anthropic` |
  | `openai-compatible` | `LLM_BASE_URL` (obbligatoria), `LLM_API_KEY` (facoltativa) | `createOpenAICompatible({ name: 'openai-compatible', baseURL, apiKey, supportsStructuredOutputs: true })(model)` da `@ai-sdk/openai-compatible` (`apiKey` omessa se vuota) |
  Variabile obbligatoria mancante → `LlmError('config', \`${NOME_VARIABILE} non impostata per LLM_PROVIDER=${provider}.\`)`.
- `getLlmTimeoutMs`: `Number(env.LLM_TIMEOUT_MS)`; se non è un intero > 0 → `50000`.

**3. `lib/llm/prompts.ts`**
```ts
export const MAX_EXCLUDED_TITLES = 150;
export function buildRecipeInstructions(): string;
export function buildRecipePrompt(constraints: RecipeConstraints, n: number, excludeTitles: readonly string[]): string;
export function buildRepairPrompt(validationErrors: string): string;
```
- `buildRecipeInstructions()` restituisce **esattamente** questo testo (unire le righe con `\n`):
  ```
  Sei il ricettario di casa di una famiglia italiana. Proponi ricette casalinghe realistiche, con ingredienti che si trovano in un normale supermercato italiano.
  Rispondi solo con un oggetto JSON conforme allo schema richiesto, senza testo prima o dopo.

  Regole per gli ingredienti (obbligatorie):
  - canonical_name: minuscolo, al singolare, senza aggettivi di preparazione o di taglio (es. "petto di pollo", non "petti di pollo a cubetti"). La preparazione va nei passi.
  - display_name: come lo scriveresti nella ricetta (es. "petto di pollo a cubetti").
  - unit: solo "g", "ml", "pz" oppure "qb". Converti: kg in g, litri/decilitri/centilitri e cucchiai di liquidi in ml, spicchi/uova/foglie/unità in pz. Usa "qb" (quanto basta) solo per sale, pepe, spezie ed erbe a piacere.
  - qty: numero positivo riferito a servings_base porzioni; null solo quando unit è "qb".
  - category: una tra ortofrutta, pane, macelleria, pescheria, banco-frigo, dispensa, surgelati, bevande, altro.
  - note: null oppure una breve precisazione (es. "circa 2 spicchi").

  Regole per la ricetta:
  - title: nome breve e specifico in italiano, con l'iniziale maiuscola.
  - meal_types: sottoinsieme di "pranzo" e "cena".
  - tags: solo tra veloce, salutare, proteico, leggero, comfort-food, economico, piatto-unico ("veloce" solo se prep_minutes è al massimo 30).
  - diet_flags: tutte le diete che la ricetta rispetta, tra vegetariano, vegano, senza-glutine, senza-lattosio, pescetariano. Una ricetta vegana è anche vegetariana, pescetariana e senza lattosio; una ricetta vegetariana è anche pescetariana.
  - appliances_required: tutti e soli gli elettrodomestici necessari, tra fornelli, forno, microonde, friggitrice-ad-aria, frullatore. Lista vuota se non serve cuocere.
  - servings_base: uguale al numero di persone indicato.
  - prep_minutes: tempo totale realistico in minuti.
  - kcal_est: kcal stimate per porzione (numero intero) oppure null.
  - steps: passi brevi, senza numerazione nel testo.
  ```
- `buildRecipePrompt(c, n, titles)` produce le righe seguenti unite da `\n` (`{lista}` = valori uniti da `, `; `titles` già deduplicati dal chiamante, qui si prendono i primi `MAX_EXCLUDED_TITLES`):
  ```
  Genera {n} ricette diverse tra loro.

  Vincoli:
  - Persone: {c.persons} (servings_base = {c.persons}).
  - Pasto: <riga A>
  - Diete da rispettare: <riga B>
  - Elettrodomestici disponibili: <riga C>
  - Stile preferito: {lista meal_style_tags} (privilegialo quando sensato).   ← se vuoto: "nessuna preferenza."
  - Ingredienti graditi: {lista ingredient_likes} (privilegiali quando sensato).   ← se vuoto: "nessuno."
  - Ingredienti da non usare mai: {lista ingredient_dislikes}.   ← se vuoto: "nessuno."

  <blocco titoli>
  ```
  - Riga A: con `meal_type` → `{meal_type} (ogni ricetta deve includere "{meal_type}" in meal_types).`; con `null` → `pranzo o cena.`
  - Riga B: con diete → `{lista} (ogni ricetta deve rispettarle tutte e riportarle in diet_flags).`; vuoto → `nessuna.`
  - Riga C: con elettrodomestici → `{lista} (usa solo questi).`; vuoto → `nessuno (solo ricette senza cottura).`
  - Blocco titoli: con titoli → `Non proporre ricette uguali o molto simili a queste, già presenti in libreria:` seguita da una riga `- {titolo}` per titolo; senza titoli → `La libreria è vuota: nessun titolo da evitare.`
- `buildRepairPrompt(errors)`:
  ```
  La risposta precedente non rispetta lo schema JSON richiesto. Errori di validazione:
  {errors}
  Restituisci di nuovo l'oggetto JSON completo e corretto, con le stesse ricette, correggendo solo gli errori indicati.
  ```

**4. `lib/llm/adapter.ts`**
```ts
export interface GenerateRecipesOptions {
  model?: LanguageModel;      // iniezione per i test; default getModel()
  timeoutMs?: number;         // default getLlmTimeoutMs()
  abortSignal?: AbortSignal;
}
export async function generateRecipes(
  constraints: RecipeConstraints,
  n: number,
  excludeTitles: readonly string[],
  options?: GenerateRecipesOptions,
): Promise<GeneratedRecipe[]>;
export function describeValidationError(cause: unknown): string;
```
Algoritmo:
1. Se `n` non è intero in `[GENERATE_COUNT_MIN, GENERATE_COUNT_MAX]` → `throw new RangeError('n must be an integer between 1 and 10')`.
2. `const parsed = RecipeConstraintsSchema.parse(constraints)` (lo `ZodError` si propaga: è un errore del chiamante).
3. `const model = options.model ?? getModel()` (qui può uscire `LlmError('config')`).
4. Titoli: `trim()`, scartati i vuoti, deduplicati (primo mantenuto), primi `MAX_EXCLUDED_TITLES`.
5. `const instructions = buildRecipeInstructions(); const prompt = buildRecipePrompt(parsed, n, titles);`
6. **Tentativo 1**: `generateText({ model, instructions, prompt, output: Output.object({ schema: GenerateRecipesOutputSchema }), temperature: 0.8, maxRetries: 1, timeout: timeoutMs, abortSignal })`.
7. Se lancia un errore per cui `NoObjectGeneratedError.isInstance(err)` → **tentativo 2 (repair)** con gli stessi parametri tranne `prompt` (rimosso) e `temperature: 0.2`, e con
   `messages = [ { role: 'user', content: prompt }, { role: 'assistant', content: err.text }, { role: 'user', content: buildRepairPrompt(describeValidationError(err.cause)) } ]`.
   Se `err.text` è `undefined` o stringa vuota, omettere il messaggio `assistant`.
   Se anche il tentativo 2 lancia `NoObjectGeneratedError` → `throw new LlmError('invalid_output', 'Il modello non ha prodotto ricette valide dopo il tentativo di correzione.', { cause: err2 })`.
8. Qualunque altro errore (in entrambi i tentativi) passa per `toLlmError(err, abortSignal)` (funzione interna):
   - già `LlmError` → invariato;
   - `err.name === 'TimeoutError'` o `err.name === 'AbortError'` → `LlmError('timeout', 'La chiamata al modello ha superato il tempo massimo.', { cause })`;
   - `RetryError.isInstance(err)` → `return toLlmError(err.lastError, abortSignal)` (ricorsione: un `APICallError` incapsulato produce lo stesso messaggio con lo status HTTP);
   - `APICallError.isInstance(err)` → `LlmError('provider', \`Errore del provider LLM (HTTP ${err.statusCode ?? 'n/d'}).\`, { cause })`;
   - altro → `LlmError('provider', 'Errore del provider LLM.', { cause })`.
9. Successo: `result.output.recipes.map(normalizeGeneratedRecipe).slice(0, n)` (se il modello ne restituisce meno di `n` si ritornano quelle, senza errore).
- `describeValidationError(cause)`: risale la catena `.cause` per al massimo 4 livelli cercando un oggetto con array `issues` (ZodError o issue Standard Schema); se trovato → una riga per issue `"{path}: {message}"`, dove `path` unisce con `.` gli elementi del percorso (ogni elemento può essere una chiave `string | number` oppure un oggetto `{ key }`: usare `key`), path vuoto → `"(radice)"`; massimo 15 righe. Esempio atteso: `recipes.0.ingredients.0.unit: …`; altrimenti → `cause instanceof Error ? cause.message : 'JSON non valido o incompleto.'`. Risultato troncato a 1500 caratteri.

**5. `lib/llm/index.ts`** — barrel: riesporta `generateRecipes`, `GenerateRecipesOptions` da `./adapter`; `getModel`, `readLlmConfig`, `getLlmTimeoutMs`, `LLM_PROVIDER_VALUES`, `LlmProvider`, `LlmConfig` da `./model`; tutto `./errors`. Nessun altro modulo importa file interni di `lib/llm/` eccetto `app/api/recipes/generate/route.ts` che importa `@/lib/llm/errors`.

**6. Registrazioni scritte a mano** (`tests/fixtures/llm/*.txt`, contenuto = testo grezzo che il modello "risponde"; JSON su più righe ammesso):
- `valid-2-recipes.txt` — **esattamente** questo JSON:
  ```json
  {"recipes":[
   {"title":"Tofu croccante con verdure saltate","description":"Tofu dorato in padella con zucchine.","meal_types":["cena"],"tags":["veloce","proteico"],"diet_flags":["vegano"],"appliances_required":["fornelli"],"servings_base":2,"prep_minutes":25,"kcal_est":430,
    "steps":["Taglia il tofu a cubetti e rosolalo in padella.","Aggiungi le zucchine e salta a fuoco vivo.","Regola di sale e servi."],
    "ingredients":[
     {"canonical_name":"Tofu","display_name":"tofu al naturale","qty":250,"unit":"g","category":"banco-frigo","note":null},
     {"canonical_name":"zucchina","display_name":"zucchine","qty":2,"unit":"pz","category":"ortofrutta","note":null},
     {"canonical_name":"sale","display_name":"sale","qty":5,"unit":"qb","category":"dispensa","note":""}]},
   {"title":"Cosce di pollo al forno con patate","description":"Il classico della domenica, senza fatica.","meal_types":["cena"],"tags":["comfort-food"],"diet_flags":["senza-glutine","senza-glutine"],"appliances_required":["forno"],"servings_base":2,"prep_minutes":50,"kcal_est":null,
    "steps":["Condisci pollo e patate.","Inforna a 200 °C per 45 minuti."],
    "ingredients":[
     {"canonical_name":"coscia di pollo","display_name":"cosce di pollo","qty":4,"unit":"pz","category":"macelleria","note":null},
     {"canonical_name":"patata","display_name":"patate","qty":400,"unit":"g","category":"ortofrutta","note":null},
     {"canonical_name":"rosmarino","display_name":"rosmarino","qty":null,"unit":"g","category":"ortofrutta","note":null}]}
  ]}
  ```
- `malformed-truncated.txt` — esattamente: `{"recipes":[{"title":"Pasta al forno","description":"Risposta interrotta a met`
- `invalid-enum.txt` — JSON sintatticamente valido con **una** ricetta completa (tutti i campi presenti, titolo `"Macedonia di frutta"`) ma con `meal_types: ["colazione"]` e un unico ingrediente `{"canonical_name":"mela","display_name":"mele","qty":1,"unit":"kg","category":"frutta","note":null}`.
- `generation-mixed.txt` — usato da WP4. JSON valido con **5** ricette, in quest'ordine, tutte con `meal_types: ["cena"]`, `diet_flags: []`, `tags: []`, `servings_base: 2`, `prep_minutes: 20`, `kcal_est: null`, `description` non vuota, almeno un passo e almeno un ingrediente valido (`unit` e `category` dagli enum):
  | # | title | appliances_required |
  |---|---|---|
  | 0 | `Pasta al Pomodoro!` | `["fornelli"]` |
  | 1 | `Pasta al pomodoro fresco` | `["fornelli"]` |
  | 2 | `Lasagne vegetali al forno` | `["forno"]` |
  | 3 | `Ceci croccanti in friggitrice ad aria` | `["friggitrice-ad-aria"]` |
  | 4 | `ceci croccanti in friggitrice ad aria` | `["friggitrice-ad-aria"]` |
  La ricetta 3 ha esattamente 3 ingredienti: `ceci lessati` (240 g, dispensa), `olio extravergine di oliva` (10 ml, dispensa), `paprika` (qb, `qty: null`, dispensa).

**7. `tests/helpers/mock-llm.ts`**
```ts
export function loadLlmRecording(name: string): string; // legge tests/fixtures/llm/{name}.txt (utf-8) con path.resolve(__dirname, '../fixtures/llm', `${name}.txt`)
export function createRecordedModel(
  responses: Array<string | Error>,
): { model: MockLanguageModelV4; calls: unknown[] };
```
Ogni invocazione di `doGenerate` consuma la risposta successiva: se è un `Error` la lancia, altrimenti ritorna `{ content: [{ type: 'text', text }], finishReason: { unified: 'stop', raw: undefined }, usage: { inputTokens: { total: 10, noCache: 10, cacheRead: undefined, cacheWrite: undefined }, outputTokens: { total: 20, text: 20, reasoning: undefined } }, warnings: [] }`. Le opzioni ricevute da `doGenerate` vengono aggiunte a `calls`. Risposte esaurite → `throw new Error('No more recorded LLM responses')`.

**8. `scripts/llm-record.ts`** (strumento manuale, mai eseguito dai test; deve solo passare typecheck e lint)
- Avvio: `for (const f of ['.env.local', '.env']) { try { process.loadEnvFile(f); } catch { /* file assente */ } }`, poi tutto dentro `async function main()` chiamata con `main().catch((e) => { console.error(e); process.exitCode = 1; })` (niente top-level await: `tsx` esegue il file come CommonJS).
- Argomenti con `parseArgs` di `node:util`: `--name` (obbligatorio, `[a-z0-9-]+`), `--count` (default 3), `--meal` (`pranzo|cena`, facoltativo), `--persons` (default 2), `--diet` / `--appliance` / `--style` (ripetibili, `multiple: true`), `--exclude` (ripetibile). Valori non validi → messaggio d'errore e `process.exitCode = 1`. I vincoli sono validati con `RecipeConstraintsSchema` (`appliance` assente ⇒ `DEFAULT_HOUSEHOLD.appliances`).
- Esegue la stessa chiamata del tentativo 1 dell'adapter (usando `getModel`, `buildRecipeInstructions`, `buildRecipePrompt`, `getLlmTimeoutMs`) e scrive `result.text` in `tests/fixtures/llm/recorded/{name}.txt`. Se esce `NoObjectGeneratedError`, scrive `err.text ?? ''` in `tests/fixtures/llm/recorded/{name}.invalid.txt` e lo segnala. Stampa `provider/model` usati e il percorso scritto.
- Uso documentato in un commento in testa al file: `pnpm llm:record --name gemini-cena-vegano --count 3 --meal cena --diet vegano --appliance friggitrice-ad-aria`.

**9. Test** (tutti con `// @vitest-environment node`, nessuna rete):
- `tests/llm/model.test.ts` (passare oggetti `env` espliciti, non toccare `process.env`):
  - `LLM_PROVIDER` assente ⇒ provider `google`; `LLM_PROVIDER='azure'` ⇒ `LlmError` `config` con messaggio che contiene `azure`; `LLM_MODEL` assente ⇒ `config`.
  - Per ciascun provider con chiave presente: `getModel` ritorna un oggetto con `modelId === LLM_MODEL` e `provider` (stringa) che contiene rispettivamente `google`, `openrouter`, `anthropic`, `openai-compatible` (verificare il valore reale sui pacchetti installati e usare un `toContain` coerente).
  - Chiave mancante ⇒ `config` con messaggio che contiene il nome della variabile (`GOOGLE_GENERATIVE_AI_API_KEY`, `OPENROUTER_API_KEY`, `ANTHROPIC_API_KEY`, `LLM_BASE_URL`).
  - `getLlmTimeoutMs({})` = 50000; `{ LLM_TIMEOUT_MS: '1200' }` = 1200; `'abc'` e `'-5'` = 50000.
- `tests/llm/prompts.test.ts`: il prompt contiene `Genera 3 ricette`, il numero di persone, ciascuna dieta ed elettrodomestico passati, `Ingredienti da non usare mai: aglio.` quando `ingredient_dislikes: ['aglio']`; i tre segnaposto (`nessuna.`, `nessuno (solo ricette senza cottura).`, `La libreria è vuota`) con liste vuote; riga pasto nei due casi; con 200 titoli compaiono `Titolo 150` e non `Titolo 151` (titoli `Titolo 1`…`Titolo 200`; attenzione a non confondere `Titolo 15` con `Titolo 150`: cercare la riga intera `- Titolo 151`). Le istruzioni contengono `canonical_name` e `diet_flags`.
- `tests/llm/adapter.test.ts` (vincoli di base: persons 2, `meal_type: 'cena'`, tutte le liste vuote tranne `appliances: ['fornelli','forno']`):
  1. `valid-2-recipes` ⇒ 2 ricette; la prima ha `diet_flags` `['vegetariano','vegano','senza-lattosio','pescetariano']`, ingrediente `tofu` minuscolo, `sale` con `qty: null` e `note: null`; la seconda ha `diet_flags` `['senza-glutine']` e `rosmarino` con `unit: 'qb'`, `qty: null`; `calls.length === 1`.
  2. Stessa registrazione con `n = 1` ⇒ 1 ricetta.
  3. `[malformed-truncated, valid-2-recipes]` ⇒ successo, `calls.length === 2`, `JSON.stringify(calls[1])` contiene `Errori di validazione` e `Risposta interrotta`.
  4. `[invalid-enum, valid-2-recipes]` ⇒ successo; `JSON.stringify(calls[1])` contiene `ingredients.0.unit` (non basta `unit`: la parola compare già nelle istruzioni).
  5. `[invalid-enum, invalid-enum]` ⇒ `LlmError` con `code === 'invalid_output'`, `calls.length === 2`.
  6. `[new APICallError({ message: 'Service Unavailable', url: 'https://example.test', requestBodyValues: {}, statusCode: 503, isRetryable: false })]` ⇒ `LlmError` `provider`, messaggio contiene `503`.
  7. `[new DOMException('timed out', 'TimeoutError')]` ⇒ `LlmError` `timeout`.
  8. `n = 0` e `n = 11` ⇒ `RangeError`, nessuna chiamata al modello.
  9. Nessun `options.model` con `vi.stubEnv('LLM_MODEL', '')` ⇒ `LlmError` `config` (ripristinare con `vi.unstubAllEnvs()` in `afterEach`).
  10. `excludeTitles` con duplicati e stringhe vuote ⇒ nel prompt ogni titolo compare una sola volta.

### Contratti esposti (consumati da WP4 e dalle feature F4/F5)
```ts
// @/lib/llm
generateRecipes(constraints: RecipeConstraints, n: number, excludeTitles: readonly string[], options?: GenerateRecipesOptions): Promise<GeneratedRecipe[]>
getModel(env?): LanguageModel
class LlmError { code: 'config' | 'provider' | 'timeout' | 'invalid_output' }
isLlmError(e): e is LlmError
// @/tests/helpers/mock-llm
loadLlmRecording(name), createRecordedModel(responses)
```

### Dipendenze
WP1 (pacchetti, `GenerateRecipesOutputSchema`, `RecipeConstraintsSchema`, `normalizeGeneratedRecipe`, costanti `GENERATE_COUNT_*`).

### Criteri di accettazione (S1.1)
- Vincoli → `GeneratedRecipe[]` valide, oppure `LlmError` tipizzato.
- Il repair corregge nei test sia un JSON troncato sia un JSON con enum non validi.
- Nessun modulo fuori da `lib/llm/` importa `ai` o pacchetti `@ai-sdk/*` / `@openrouter/*` (verifica: `grep -rE "from '(ai|@ai-sdk|@openrouter)" app lib --include=*.ts --include=*.tsx` restituisce solo file sotto `lib/llm/`).
- Gate verde.

### Fuori scope
Persistenza, dedup, filtro vincoli (WP4); streaming; tool calling; cache delle risposte; qualsiasi UI.

---

## WP3 — Seed e fixtures (S1.3) (wave 2, parallelo a WP2)

**Obiettivo:** 18 ricette realistiche e un set di alias sotto `fixtures/`, un loader tipizzato per i test puri delle feature future e un `pnpm db:seed` idempotente (household di default, ricette, alias).

### File
- Crea: `fixtures/recipes.json`, `fixtures/ingredient-aliases.json`, `fixtures/index.ts`, `lib/db/seed-core.ts`, `lib/db/seed.ts`, `tests/fixtures-data/recipes-fixtures.test.ts`, `tests/db/seed.test.ts`
- **Non** eliminare `fixtures/.gitkeep`: `tests/verification.test.ts` ne verifica l'esistenza.

### Pattern di riferimento
- Uso dei repository: `insertRecipe`, `getRecipeById`, `getRecipeBySlug` in `lib/db/repositories/recipe-repo.ts`; `getHouseholdById`, `ensureDefaultHousehold` in `lib/db/repositories/household-repo.ts` (non modificarli: `recipe-repo.ts` è di WP4).
- Import JSON: `resolveJsonModule` è già attivo in `tsconfig.json` (`import raw from './recipes.json'`).

### Passi

**1. `fixtures/recipes.json`** — forma `{ "recipes": FixtureRecipe[] }`, 18 ricette, **già normalizzate** (cioè `normalizeGeneratedRecipe(r)` le lascia identiche). Campi fissi per ognuna:
- `id`: `00000000-0000-4000-8000-0000000001NN` con `NN` = numero a due cifre della tabella (`01`…`18`).
- `slug`: `slugify(title)`.
- `diet_flags`: **esattamente** quelli della tabella, nell'ordine di `DIET_FLAG_VALUES` (già espansi).

| NN | title | meal_types | diet_flags | appliances_required | tags | prep | servings |
|---|---|---|---|---|---|---|---|
| 01 | Pasta al pomodoro e basilico | pranzo, cena | vegetariano, vegano, senza-lattosio, pescetariano | fornelli | veloce, economico | 20 | 2 |
| 02 | Risotto alla zucca | cena | vegetariano, senza-glutine, pescetariano | fornelli | comfort-food | 35 | 2 |
| 03 | Pollo croccante in friggitrice ad aria | cena | senza-lattosio | friggitrice-ad-aria | proteico, veloce | 25 | 2 |
| 04 | Insalata di ceci, pomodorini e feta | pranzo | vegetariano, senza-glutine, pescetariano | *(vuoto)* | veloce, salutare, leggero | 15 | 2 |
| 05 | Salmone al forno con patate | cena | senza-glutine, senza-lattosio, pescetariano | forno | proteico, salutare | 40 | 2 |
| 06 | Frittata di zucchine | pranzo, cena | vegetariano, senza-glutine, pescetariano | fornelli | veloce, economico | 20 | 2 |
| 07 | Vellutata di carote e zenzero | cena | vegetariano, vegano, senza-glutine, senza-lattosio, pescetariano | fornelli, frullatore | leggero, salutare | 35 | 2 |
| 08 | Polpette al sugo | pranzo, cena | *(vuoto)* | fornelli | comfort-food | 45 | 4 |
| 09 | Poke bowl di tonno e riso | pranzo | senza-lattosio, pescetariano | fornelli | salutare, piatto-unico | 25 | 2 |
| 10 | Pasta e ceci | pranzo | vegetariano, vegano, senza-lattosio, pescetariano | fornelli | economico, comfort-food, piatto-unico | 30 | 2 |
| 11 | Tacchino alla piastra con insalata | pranzo | senza-glutine, senza-lattosio | fornelli | proteico, leggero, veloce | 15 | 2 |
| 12 | Lasagne alla bolognese | pranzo | *(vuoto)* | fornelli, forno | comfort-food | 90 | 4 |
| 13 | Patate e zucchine croccanti | cena | vegetariano, vegano, senza-glutine, senza-lattosio, pescetariano | friggitrice-ad-aria | veloce, leggero | 25 | 2 |
| 14 | Merluzzo in padella con pomodorini | cena | senza-glutine, senza-lattosio, pescetariano | fornelli | leggero, proteico, veloce | 20 | 2 |
| 15 | Uova e spinaci al microonde | cena | vegetariano, senza-glutine, pescetariano | microonde | veloce, proteico | 10 | 2 |
| 16 | Couscous di verdure | pranzo | vegetariano, vegano, senza-lattosio, pescetariano | fornelli | piatto-unico, salutare | 25 | 2 |
| 17 | Hamburger di manzo con patate al forno | cena | senza-glutine, senza-lattosio | fornelli, forno | proteico, comfort-food | 40 | 2 |
| 18 | Crema di piselli e menta | pranzo, cena | vegetariano, vegano, senza-glutine, senza-lattosio, pescetariano | fornelli, frullatore | leggero | 25 | 2 |

Contenuto da scrivere per ciascuna (italiano, realistico): `description` (1 frase), `steps` (3–6 passi senza numerazione), `kcal_est` (intero plausibile; **`null` per le ricette 04 e 16**), `ingredients` (4–9 per ricetta), rispettando le regole di `ARCHITECTURE §4.1` e questi vincoli verificati dal test:
- ingredienti coerenti con le diete (nessuna carne/pesce nelle vegetariane, nessun derivato animale nelle vegane, nessun latticino nelle `senza-lattosio`, nessun glutine nelle `senza-glutine`: la ricetta 05 non usa pangrattato, la 17 non usa pane);
- `olio extravergine di oliva` (unità `ml`, reparto `dispensa`) in almeno 8 ricette; `cipolla` (`pz` oppure `g`, `ortofrutta`) in almeno 3; `aglio` (`pz`, `ortofrutta`, nota facoltativa) in almeno 3;
- `sale` e/o `pepe nero` con `unit: "qb"`, `qty: null`, `category: "dispensa"` in almeno 6 ricette;
- `pomodorino` in `g` nella ricetta 04 e in `pz` nella ricetta 14 (caso "unità eterogenee" di `ARCHITECTURE §5.5`);
- reparti usati: almeno 8 dei 9 valori di `CATEGORY_VALUES` (es. `pane` per il pane raffermo delle polpette 08 — ricetta senza flag, quindi il glutine è ammesso; `surgelati` per i piselli surgelati della 18; `bevande` per il vino bianco del risotto 02; `pescheria` per salmone/tonno/merluzzo; `banco-frigo` per uova, feta, parmigiano reggiano);
- nessun `canonical_name` uguale a un `alias` di `fixtures/ingredient-aliases.json`.

**2. `fixtures/ingredient-aliases.json`** — `{ "aliases": [...] }` con **esattamente** queste coppie (`alias` → `canonical_name`):
`pelati`→`pomodoro pelato`; `pomodori pelati`→`pomodoro pelato`; `passata`→`passata di pomodoro`; `salsa di pomodoro`→`passata di pomodoro`; `olio evo`→`olio extravergine di oliva`; `olio d'oliva`→`olio extravergine di oliva`; `olio extravergine`→`olio extravergine di oliva`; `parmigiano`→`parmigiano reggiano`; `grana`→`grana padano`; `zucchine`→`zucchina`; `uova`→`uovo`; `patate`→`patata`; `cipolle`→`cipolla`; `cipolla dorata`→`cipolla`; `carote`→`carota`; `spicchio d'aglio`→`aglio`; `pepe`→`pepe nero`; `sale fino`→`sale`; `prezzemolo fresco`→`prezzemolo`; `basilico fresco`→`basilico`; `ceci in scatola`→`ceci lessati`; `ceci precotti`→`ceci lessati`; `tonno sott'olio`→`tonno in scatola`; `fettine di pollo`→`petto di pollo`.

**3. `fixtures/index.ts`**
```ts
export const FIXTURE_RECIPES: FixtureRecipe[];            // FixtureFileSchema.parse(raw).recipes
export const FIXTURE_INGREDIENT_ALIASES: IngredientAlias[]; // IngredientAliasesFileSchema.parse(rawAliases).aliases
export const FIXTURE_CREATED_AT: Date;                      // new Date('2026-01-01T00:00:00Z')
export function fixtureRecipesAsDomain(householdId?: string): Recipe[];
```
`fixtureRecipesAsDomain(householdId = DEFAULT_HOUSEHOLD_ID)` → per ogni fixture `RecipeSchema.parse({ ...r, household_id: householdId, source: 'manual', macros_est: null, created_at: FIXTURE_CREATED_AT, ingredients: r.ingredients.map((ing) => ({ ...ing, recipe_id: r.id })), prefs: null })`. Serve ai test puri di F4 (planner) e F6 (lista spesa) senza DB.

**4. `lib/db/seed-core.ts`**
```ts
export interface SeedReport {
  household: 'created' | 'existing';
  recipesInserted: number;
  recipesSkipped: number;
  aliasesInserted: number;
}
export async function seedDatabase(): Promise<SeedReport>;
```
1. `household`: `(await getHouseholdById(DEFAULT_HOUSEHOLD_ID)) ? 'existing' : 'created'`, poi `await ensureDefaultHousehold()`. Il seed **non** sovrascrive un household esistente.
2. Per ogni `r` di `FIXTURE_RECIPES`, in ordine: se `getRecipeById(r.id)` **oppure** `getRecipeBySlug(r.slug)` trovano una riga → `recipesSkipped++`; altrimenti `insertRecipe({ id: r.id, household_id: DEFAULT_HOUSEHOLD_ID, title, slug, description, steps, meal_types, tags, diet_flags, appliances_required, servings_base, prep_minutes, kcal_est, macros_est: null, source: 'manual', created_at: FIXTURE_CREATED_AT }, r.ingredients.map(({ canonical_name, display_name, qty, unit, category, note }) => ({ canonical_name, display_name, qty, unit, category, note })))` → `recipesInserted++` (pref di default create da `insertRecipe`).
3. Alias: `db.insert(ingredient_aliases).values(FIXTURE_INGREDIENT_ALIASES).onConflictDoNothing().returning({ alias: ingredient_aliases.alias })` → `aliasesInserted = righe.length`. Un alias già presente con un `canonical_name` diverso **non** viene sovrascritto.
4. Nessuna cancellazione di dati.

**5. `lib/db/seed.ts`** (CLI dello script `db:seed` già presente)
- Carica `.env.local` poi `.env` con `process.loadEnvFile` in `try/catch` (file assente = ignorato), **prima** di importare il DB.
- `async function main()`: `const { seedDatabase } = await import('./seed-core'); const { client } = await import('./index');` → esegue il seed → stampa `Seed completato — household: {household}, ricette inserite: {n}, già presenti: {m}, alias inseriti: {k}`; in `catch` stampa `Seed fallito:` + errore e imposta `process.exitCode = 1`; in `finally` `await client.end()`.
- Chiamata finale `void main();` (niente top-level await: il file gira come CommonJS sotto `tsx`).

**6. Test**
- `tests/fixtures-data/recipes-fixtures.test.ts` (`// @vitest-environment node`, nessun DB): il file passa `FixtureFileSchema`; 18 ricette; `id` e `slug` univoci; `slug === slugify(title)`; titoli normalizzati univoci; per ogni ricetta `normalizeGeneratedRecipe(stripIdSlug(r))` è deep-equal a `stripIdSlug(r)`; conteggi: solo-pranzo ≥ 5, solo-cena ≥ 5, entrambi ≥ 3, con `vegano` ≥ 5, con `pescetariano` e senza `vegetariano` ≥ 3, ogni valore di `APPLIANCE_VALUES` presente in almeno una ricetta, almeno una ricetta con `appliances_required` vuoto, reparti distinti ≥ 8; `olio extravergine di oliva` in ≥ 8 ricette; ≥ 6 ricette con un ingrediente `qb`; esiste un `canonical_name` con due unità diverse; ogni ingrediente `qb` ha `qty === null`; nessun `canonical_name` è un alias; `fixtureRecipesAsDomain()` ritorna 18 `Recipe` con `household_id === DEFAULT_HOUSEHOLD_ID`.
- `tests/db/seed.test.ts` (`// @vitest-environment node`; `describe.skipIf(!dbUp)` + `beforeAll(assertDbMigrated)` da `@/tests/helpers/db`):
  1. `seedDatabase()` due volte di fila: la seconda riporta `recipesInserted === 0`, `aliasesInserted === 0`, `household === 'existing'`, `recipesSkipped === 18`.
  2. Dopo il seed, ogni `id` di `FIXTURE_RECIPES` esiste con `getRecipeById`, con lo stesso numero di ingredienti della fixture, `prefs` non nullo (`favorite: false`, `times_used: 0`).
  3. Ogni alias del file esiste in `ingredient_aliases`.
  4. Nessuna coppia di titoli fixture ha `similarity > 0.6`: query `select a.title, b.title from recipes a join recipes b on a.id < b.id where a.id = any($ids) and b.id = any($ids) and similarity(a.title, b.title) > 0.6` → 0 righe (se fallisce, rinominare la ricetta in conflitto nel JSON mantenendone il senso).
  Il test **non** cancella le ricette di seed (sono i dati di sviluppo).

### Contratti esposti
`fixtures/recipes.json` e `fixtures/ingredient-aliases.json` (formati da `FixtureFileSchema` / `IngredientAliasesFileSchema`); `@/fixtures` (`FIXTURE_RECIPES`, `FIXTURE_INGREDIENT_ALIASES`, `FIXTURE_CREATED_AT`, `fixtureRecipesAsDomain`); `seedDatabase()` da `@/lib/db/seed-core`; `pnpm db:seed`.

### Dipendenze
WP1 (`FixtureFileSchema`, `IngredientAliasesFileSchema`, `slugify`, `normalizeGeneratedRecipe`, helper DB).

### Criteri di accettazione (S1.3)
- `pnpm db:migrate && pnpm db:seed` su DB vuoto inserisce household, 18 ricette e 24 alias; una seconda esecuzione non inserisce nulla e termina con codice 0.
- I test puri possono usare `fixtureRecipesAsDomain()` senza DB né chiavi API.
- Gate verde.

### Fuori scope
UI Libreria (F5); generazione LLM; modifica dei repository esistenti; reset/pulizia del DB.

---

## WP4 — Generazione e persistenza (S1.2) (wave 3)

**Obiettivo:** `POST /api/recipes/generate` chiama l'adapter con i vincoli dell'household (più override), scarta le ricette fuori vincolo e i duplicati, e salva il resto in un'unica transazione con pref di default.

### File
- Modifica: `lib/db/repositories/recipe-repo.ts`
- Crea: `lib/recipes/constraints.ts`, `lib/recipes/generate.ts`, `lib/recipes/index.ts`, `app/api/recipes/generate/route.ts`
- Crea: `tests/recipes/constraints.test.ts`, `tests/recipes/generate.test.ts`, `tests/api/recipes-generate.test.ts`

### Pattern di riferimento
- Query Drizzle e transazioni: `insertRecipe` in `lib/db/repositories/recipe-repo.ts`.
- Test DB: helper `tests/helpers/db.ts` (WP1); modello registrato: `tests/helpers/mock-llm.ts` (WP2).

### Passi

**1. `lib/db/repositories/recipe-repo.ts`** — aggiunte (le firme esistenti restano identiche):
```ts
type DbTransaction = Parameters<Parameters<Database['transaction']>[0]>[0];
export type DbExecutor = Database | DbTransaction;   // Database importato come type da '../index'

export async function insertRecipeWith(
  executor: DbExecutor,
  recipeData: InsertRecipeInput,
  ingredientsData?: InsertIngredientInput[],
  prefData?: InsertRecipePrefInput,
): Promise<RecipeWithDetails>;
export async function listRecipeTitles(
  executor: DbExecutor,
  householdId: string,
  options?: { mealType?: MealType; limit?: number },
): Promise<string[]>;
export async function findSimilarRecipeTitle(
  executor: DbExecutor,
  householdId: string,
  title: string,
  threshold?: number,               // default TITLE_SIMILARITY_THRESHOLD
): Promise<string | null>;
export async function slugExists(executor: DbExecutor, slug: string): Promise<boolean>;
export async function acquireRecipeGenerationLock(executor: DbExecutor): Promise<void>;
export const TITLE_SIMILARITY_THRESHOLD = 0.6;
```
- `insertRecipeWith`: sposta qui il corpo attuale della callback di `insertRecipe`, usando `executor` al posto di `tx`. `insertRecipe` diventa `return db.transaction((tx) => insertRecipeWith(tx, recipeData, ingredientsData, prefData));` (comportamento invariato: il test di F1 deve restare verde).
- `listRecipeTitles`: `select title from recipes where household_id = $h [and meal_types @> array[$mealType]] order by created_at desc [limit $limit]` (Drizzle: `arrayContains(recipes.meal_types, [mealType])`, `desc(recipes.created_at)`); `limit` assente = nessun limite.
- `findSimilarRecipeTitle`: `select title from recipes where household_id = $h and similarity(title, $t) > $threshold order by similarity(title, $t) desc limit 1` (con `sql\`similarity(${recipes.title}, ${title})\``); ritorna il titolo o `null`.
- `slugExists`: `select 1 from recipes where slug = $s limit 1` (globale, non per household).
- `acquireRecipeGenerationLock`: `executor.execute(sql\`select pg_advisory_xact_lock(hashtext('mealy:recipes:generate'))\`)`. Va chiamata **solo dentro una transazione** (il lock si rilascia al commit/rollback): documentarlo nel JSDoc.

**2. `lib/recipes/constraints.ts`**
```ts
export function buildConstraints(
  household: Household,
  mealType: MealType | null,
  overrides?: ConstraintOverrides,
): RecipeConstraints;
export function findConstraintViolations(recipe: GeneratedRecipe, constraints: RecipeConstraints): string[];
```
- `buildConstraints`: `persons`, `diet_tags`, `meal_style_tags`, `appliances` = override se definito, altrimenti valore dell'household; `meal_type = mealType`; `ingredient_likes = []`, `ingredient_dislikes = []` con il commento `// F5 (S2.3): popolare da ingredient_prefs`. Ritorna `RecipeConstraintsSchema.parse(risultato)`.
- `findConstraintViolations` — ritorna i messaggi nell'ordine dei controlli (lista vuota = conforme):
  1. `meal_type` non null e assente da `recipe.meal_types` → `pasto "{meal_type}" mancante`
  2. per ogni dieta di `constraints.diet_tags` assente da `expandDietFlags(recipe.diet_flags)` → `dieta "{dieta}" non rispettata`
  3. per ogni elettrodomestico di `recipe.appliances_required` assente da `constraints.appliances` → `richiede "{elettrodomestico}" non disponibile`
  4. per ogni ingrediente il cui `normalizeCanonicalName(canonical_name)` è tra gli `ingredient_dislikes` normalizzati → `contiene "{canonical_name}" (ingrediente escluso)`

**3. `lib/recipes/generate.ts`**
```ts
export const EXCLUDED_TITLES_IN_PROMPT = 150;

export interface GenerateAndStoreInput {
  householdId?: string;              // default: household di default (getDefaultHousehold)
  count: number;                     // 1..10
  mealType: MealType | null;
  overrides?: ConstraintOverrides;
}
export interface GenerateAndStoreResult {
  requested: number;
  created: RecipeWithDetails[];
  skipped: GenerationSkip[];
}
export interface GenerateAndStoreDeps {
  model?: LanguageModel;             // import type { LanguageModel } from 'ai' (solo tipo)
  generate?: typeof generateRecipes; // default: generateRecipes da '@/lib/llm'
}
export async function generateAndStoreRecipes(
  input: GenerateAndStoreInput,
  deps?: GenerateAndStoreDeps,
): Promise<GenerateAndStoreResult>;
```
Algoritmo:
1. Household: se `input.householdId` è definito → `getHouseholdById`; `null` → `throw new Error(\`Household ${id} non trovato\`)`. Altrimenti `getDefaultHousehold()`.
2. `constraints = buildConstraints(household, input.mealType, input.overrides ?? {})`.
3. `excludeTitles = await listRecipeTitles(db, household.id, { mealType: input.mealType ?? undefined, limit: EXCLUDED_TITLES_IN_PROMPT })`.
4. `generated = await (deps.generate ?? generateRecipes)(constraints, input.count, excludeTitles, { model: deps.model })` — **fuori** da qualsiasi transazione. Gli errori (`LlmError`, `RangeError`) si propagano invariati e nulla viene scritto.
5. `db.transaction(async (tx) => { ... })`:
   1. `await acquireRecipeGenerationLock(tx)`;
   2. `known = new Set((await listRecipeTitles(tx, household.id)).map(normalizeTitle))`;
   3. per ogni `r` di `generated`, **nell'ordine ricevuto**:
      - `violations = findConstraintViolations(r, constraints)`; se non vuota → `skipped.push({ title: r.title, reason: 'constraint_violation', detail: violations.join('; ') })`, `continue`;
      - `norm = normalizeTitle(r.title)`; se `known.has(norm)` → `skipped.push({ title, reason: 'duplicate', detail: 'titolo già presente in libreria' })`, `continue`;
      - `similar = await findSimilarRecipeTitle(tx, household.id, r.title)`; se non null → `skipped.push({ title, reason: 'duplicate', detail: \`simile a "${similar}"\` })`, `continue`;
      - `slug = await uniqueSlug(tx, slugify(r.title))` (funzione interna: prova `base`, poi `base-2` … `base-99` con `slugExists`; se tutti occupati → `` `${base}-${crypto.randomUUID().slice(0, 6)}` ``);
      - `created.push(await insertRecipeWith(tx, { household_id: household.id, title: r.title, slug, description: r.description, steps: r.steps, meal_types: r.meal_types, tags: r.tags, diet_flags: r.diet_flags, appliances_required: r.appliances_required, servings_base: r.servings_base, prep_minutes: r.prep_minutes, kcal_est: r.kcal_est, macros_est: null, source: 'llm' }, r.ingredients.map(({ canonical_name, display_name, qty, unit, category, note }) => ({ canonical_name, display_name, qty, unit, category, note }))))`;
      - `known.add(norm)`.
   Qualsiasi errore di inserimento annulla l'intero batch (rollback) e si propaga.
6. Ritorna `{ requested: input.count, created, skipped }`. **Nessun rabbocco** se `created.length < count` (decisione U3).

**4. `lib/recipes/index.ts`** — riesporta tutto da `./generate` e `./constraints`.

**5. `app/api/recipes/generate/route.ts`**
```ts
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;
export async function POST(request: Request): Promise<Response>;
```
Import consentiti: `@/lib/recipes`, `@/lib/llm/errors`, `@/lib/domain/types`.
1. `await request.json()` in `try`; errore → **400** `{ error: { code: 'invalid_request', message: 'Richiesta non valida.' } }`.
2. `GenerateRecipesRequestSchema.safeParse(body)`; fallimento → **400** `{ error: { code: 'invalid_request', message: 'Richiesta non valida.', details: issues.map((i) => ({ path: i.path.join('.'), message: i.message })) } }`.
3. `result = await generateAndStoreRecipes({ count, mealType: meal_type, overrides })` → **200** `Response.json({ requested, created, skipped })`.
4. Errori (`console.error('[api/recipes/generate]', err)` in ogni caso):
   | condizione | status | `error.code` | `error.message` |
   |---|---|---|---|
   | `isLlmError(err) && err.code === 'config'` | 500 | `llm_not_configured` | `Generazione non disponibile: il modello non è configurato.` |
   | `isLlmError(err) && err.code === 'timeout'` | 504 | `llm_timeout` | `La generazione non è andata a buon fine. Riprova.` |
   | `isLlmError(err) && err.code === 'provider'` | 502 | `llm_unavailable` | `La generazione non è andata a buon fine. Riprova.` |
   | `isLlmError(err) && err.code === 'invalid_output'` | 502 | `llm_invalid_output` | `La generazione non è andata a buon fine. Riprova.` |
   | qualsiasi altro errore | 500 | `internal_error` | `Qualcosa è andato storto. Riprova.` |
   Il corpo d'errore non contiene mai stack trace né messaggi del provider.

**6. Test** (tutti `// @vitest-environment node`)
- `tests/recipes/constraints.test.ts` (puro): override che sostituiscono solo i campi indicati; `ingredient_likes/dislikes` vuoti; ciascuna delle 4 violazioni con il messaggio esatto; una ricetta `['vegano']` soddisfa `diet_tags: ['vegetariano']`; dislike `'Aglio '` contro ingrediente `aglio` → violazione; ricetta con `appliances_required: []` sempre conforme sugli elettrodomestici.
- `tests/recipes/generate.test.ts` (`describe.skipIf(!dbUp)`, `beforeAll(assertDbMigrated)`; ogni test crea i propri household con `createTestHousehold` e li elimina in `afterEach` con `deleteTestHousehold`):
  1. **Batch misto**: household con `appliances: ['fornelli','friggitrice-ad-aria']`, `diet_tags: []`; pre-inserire con `insertRecipe` la ricetta `Pasta al pomodoro` (`meal_types: ['pranzo','cena']`, slug `pasta-al-pomodoro-{uuid}`); chiamare `generateAndStoreRecipes({ householdId, count: 5, mealType: 'cena' }, { model: createRecordedModel([loadLlmRecording('generation-mixed')]).model })`. Attesi: `created` = 1 ricetta con titolo `Ceci croccanti in friggitrice ad aria`, `source: 'llm'`, 3 ingredienti, `prefs` con `favorite: false`, `blocked: false`, `times_used: 0`; `skipped` esattamente, in ordine: `{ 'Pasta al Pomodoro!', duplicate, 'titolo già presente in libreria' }`, `{ 'Pasta al pomodoro fresco', duplicate, 'simile a "Pasta al pomodoro"' }`, `{ 'Lasagne vegetali al forno', constraint_violation, 'richiede "forno" non disponibile' }`, `{ 'ceci croccanti in friggitrice ad aria', duplicate, 'titolo già presente in libreria' }`. `JSON.stringify(calls[0])` contiene `Pasta al pomodoro` (exclude-list).
  2. **Due chiamate consecutive non producono duplicati**: household con tutti gli elettrodomestici; due chiamate con `count: 2`, `mealType: 'cena'`, ciascuna con un modello nuovo su `valid-2-recipes`: la prima crea 2 ricette, la seconda 0 con 2 `duplicate`; `listRecipeTitles(db, householdId)` ha lunghezza 2.
  3. **Collisione di slug**: stesso setup del test 1, più un secondo household di test che contiene una ricetta con titolo `Ricetta segnaposto` e slug `ceci-croccanti-in-friggitrice-ad-aria`; il batch misto sul primo household crea la ricetta `Ceci croccanti in friggitrice ad aria` con slug `ceci-croccanti-in-friggitrice-ad-aria-2`. Eliminare entrambi gli household in `afterEach`.
  4. **Errore LLM**: `deps.generate` che lancia `new LlmError('provider', 'x')` → la promessa rifiuta con quell'errore e il numero di ricette dell'household resta invariato.
  5. **Vincoli dall'household e override**: `deps.generate` spia (`vi.fn` che ritorna `[]`) → riceve `persons` e `appliances` dall'override `{ persons: 4, appliances: ['friggitrice-ad-aria'] }` e `diet_tags` dall'household; `n === count`; risultato `{ created: [], skipped: [] }`.
- `tests/api/recipes-generate.test.ts` (nessun DB: `vi.mock('@/lib/recipes', () => ({ generateAndStoreRecipes: vi.fn() }))`; costruire `new Request('http://localhost/api/recipes/generate', { method: 'POST', body })`):
  - body `'{'` → 400 `invalid_request`; `{ count: 0 }` → 400 con `details`; `{ foo: 1 }` → 400;
  - body `{}` → il servizio riceve `{ count: 5, mealType: null, overrides: {} }`, risposta 200 con `{ requested, created, skipped }` restituiti dal mock;
  - `{ count: 3, meal_type: 'cena', overrides: { diet_tags: ['vegano'], appliances: ['friggitrice-ad-aria'] } }` inoltrato così com'è;
  - mock che lancia `LlmError` con ciascuno dei 4 codici → status/`code`/`message` della tabella; `new Error('boom')` → 500 `internal_error` e il corpo non contiene `boom`;
  - `maxDuration === 120`, `runtime === 'nodejs'`.

### Contratti esposti (consumati da F4 Pianificatore e F5 Libreria)
```ts
// @/lib/recipes
generateAndStoreRecipes(input: GenerateAndStoreInput, deps?: GenerateAndStoreDeps): Promise<GenerateAndStoreResult>
buildConstraints(household, mealType, overrides?): RecipeConstraints
findConstraintViolations(recipe, constraints): string[]
// @/lib/db/repositories/recipe-repo (aggiunte)
DbExecutor, insertRecipeWith, listRecipeTitles, findSimilarRecipeTitle, slugExists, acquireRecipeGenerationLock, TITLE_SIMILARITY_THRESHOLD
```
**HTTP** `POST /api/recipes/generate`
- Request: `{ "count"?: 1..10 (default 5), "meal_type"?: "pranzo" | "cena" | null, "overrides"?: { "persons"?, "diet_tags"?, "meal_style_tags"?, "appliances"? } }`
- 200: `{ "requested": number, "created": RecipeWithDetails[], "skipped": [{ "title", "reason": "duplicate" | "constraint_violation", "detail" }] }`
- Errori: `{ "error": { "code", "message", "details"? } }` con i codici della tabella del passo 5.

### Dipendenze
WP1 (schemi, `recipe-text`, helper DB), WP2 (`generateRecipes`, `LlmError`, `createRecordedModel`, registrazione `generation-mixed`), WP3 non richiesto dai test (usano household dedicati), ma lo smoke test manuale parte da un DB seedato.

### Criteri di accettazione (S1.2)
- Due chiamate consecutive non producono duplicati (test 2).
- Filtro vincoli e dedup (esatto, trigram, interno al batch) verificati dal test 1.
- Errori applicativi puliti per la UI (test della route).
- **Smoke test manuale** in `/feature-dev 2` (richiede chiave API; a cura dell'utente con l'orchestratore):
  1. `.env` con `LLM_PROVIDER=google`, `LLM_MODEL=gemini-2.5-flash`, `GOOGLE_GENERATIVE_AI_API_KEY`; `pnpm db:migrate && pnpm db:seed && pnpm dev`;
  2. `curl -X POST localhost:3000/api/recipes/generate -H "content-type: application/json" -d '{"count":3,"meal_type":"cena","overrides":{"diet_tags":["vegano"],"appliances":["friggitrice-ad-aria"]}}'` → ricette vegane solo con friggitrice ad aria (o scartate con `constraint_violation`);
  3. ripetere la stessa chiamata → nessun titolo duplicato in libreria;
  4. passare a `LLM_PROVIDER=openrouter` + modello `:free` + `OPENROUTER_API_KEY`, riavviare `pnpm dev`, ripetere il passo 2 senza toccare codice.
- Gate verde.

### Fuori scope
UI di generazione/skeleton (F4, S3.4); lettura di `ingredient_prefs` (F5, S2.3); rabbocco automatico; `GET /api/recipes` (F5); rate limiting; autenticazione.

---

## Mappa delle dipendenze

```
Wave 1:  WP1 (contratti, dipendenze, utility, helper DB)      — solitaria
            │
Wave 2:  WP2 (LLM adapter)   ∥   WP3 (fixtures + seed)       — parallele, file-disjoint
            │
Wave 3:  WP4 (repo + servizio + route)                        — dopo WP2 (usa adapter, mock e registrazioni)
```

- **Parallelizzabili:** WP2 e WP3 (nessun file in comune: `lib/llm/`, `scripts/`, `tests/llm/`, `tests/helpers/mock-llm.ts`, `tests/fixtures/llm/` contro `fixtures/`, `lib/db/seed*.ts`, `tests/fixtures-data/`, `tests/db/seed.test.ts`).
- **Sequenziali obbligati:** WP1 prima di tutti (modifica `package.json`, `pnpm-lock.yaml`, `lib/domain/types.ts`, condivisi); WP4 dopo WP2.
- WP4 e WP3 non condividono file: `recipe-repo.ts` è modificato solo da WP4 e WP3 ne usa solo le funzioni esistenti, con firme invariate.
- Prima dei gate con test DB: `docker compose -f docker-compose.dev.yml up -d` e `pnpm db:migrate`.

## Checklist finale

| WP | Wave | Story | File principali | Stato |
|---|---|---|---|---|
| WP1 — Contratti, dipendenze e utility | 1 | trasversale | `package.json`, `lib/domain/types.ts`, `lib/domain/recipe-text.ts`, `tests/helpers/db.ts`, `.env.example`, `CLAUDE.md` | ☑ |
| WP2 — LLM adapter | 2 | S1.1 | `lib/llm/{errors,model,prompts,adapter,index}.ts`, `scripts/llm-record.ts`, `tests/helpers/mock-llm.ts`, `tests/fixtures/llm/*.txt`, `tests/llm/*.test.ts` | ☑ |
| WP3 — Seed e fixtures | 2 | S1.3 | `fixtures/{recipes,ingredient-aliases}.json`, `fixtures/index.ts`, `lib/db/seed-core.ts`, `lib/db/seed.ts`, `tests/fixtures-data/…`, `tests/db/seed.test.ts` | ☑ |
| WP4 — Generazione e persistenza | 3 | S1.2 | `lib/db/repositories/recipe-repo.ts`, `lib/recipes/{constraints,generate,index}.ts`, `app/api/recipes/generate/route.ts`, `tests/recipes/*`, `tests/api/recipes-generate.test.ts` | ☑ |

**Chiusura feature** (`execution-strategy.md §3`): accettazioni S1.1–S1.3 verificate; gate verde (`lint + typecheck + test + build`); due chiamate consecutive senza duplicati; smoke test su Gemini e OpenRouter solo cambiando l'env; code-review `high` gestita; wiki aggiornata dal `feature-documenter` (nuove entità: `llm-adapter`, `recipe-generation`, `fixtures-and-seed`; aggiornamento di `recipe-repo`); riga di `feature-index.md` aggiornata; commit su conferma.

**Debito aperto alla chiusura (2026-09-28):** lo smoke test reale su Gemini e OpenRouter non è stato eseguito (`tests/fixtures/llm/recorded/` contiene solo `.gitkeep`). Da fare con `pnpm llm:record` appena disponibili le chiavi API, prima che la Feature 4 (pianificatore) dipenda dalla generazione su provider reale.
