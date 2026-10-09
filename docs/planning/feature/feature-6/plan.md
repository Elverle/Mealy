# Feature 6 — E4 Lista della spesa · Piano di implementazione

**Data:** 2026-10-08 · **Stato:** planned · **Input di:** `/arch-review 6` → `/feature-dev 6`
**Story:** S4.1 Consolidamento · S4.2 UI Lista spesa (`docs/BACKLOG.md`)
**Decisioni motivate:** [`requirements.md`](requirements.md) (U1–U4 dell'utente, P1–P24 di planning), recepite qui come definitive.

---

## 0. Contesto per chi implementa (leggere tutto prima del proprio WP)

### 0.1 Obiettivo
Dal piano confermato alla spesa al supermercato. Quattro risultati:
1. **Consolidamento puro**: una funzione senza DB né rete che dagli slot del piano produce gli articoli da comprare (quantità scalate, alias risolti, somme per nome e unità, arrotondamento, reparto).
2. **Lista persistente legata al piano**: creazione, aggiornamento che preserva spunte e articoli a mano, spunta, aggiunta e rimozione di articoli a mano, attraverso cinque rotte API.
3. **Schermata Lista reale** al posto dei dati finti: sezioni per reparto, riga intera come bersaglio, spuntati in fondo, avanzamento, pulsante *Aggiungi*, *Aggiorna lista*.
4. **Spunte che reggono la rete assente**: applicate subito, tenute in una coda salvata nel browser e ritentate da sole.

### 0.2 Stato del codice su cui si lavora
Se un nome qui sotto differisce nel codice reale, **vince il codice reale**: adeguarsi mantenendo il comportamento descritto.
- Next.js **15.5** App Router (root senza `src/`, alias `@/*` → `./*`), React 19, zod **3.25**, drizzle-orm **0.45** + postgres.js, Vitest **4.1** (ambiente globale **jsdom**; i test lato server iniziano con `// @vitest-environment node`), Testing Library, Tailwind v4 con token `paper / ink / basil / tomato / saffron / stone`, icone `lucide-react`.
- **Rotte dinamiche Next 15**: `{ params }: { params: Promise<{ id: string }> }`, da attendere. Modello: `app/api/plans/[id]/slots/[slotId]/route.ts`.
- `lib/domain/types.ts` — schemi Zod e tipi. Esistono già: `UNIT_VALUES` (`g, ml, pz, qb`) / `UnitSchema` / `Unit`; `CATEGORY_VALUES` (**già nell'ordine del giro al supermercato**: `ortofrutta, pane, macelleria, pescheria, banco-frigo, dispensa, surgelati, bevande, altro`) / `CategorySchema` / `Category` / `CATEGORY_LABELS`; `PlanStatusSchema` / `PlanStatus` (`draft, active, archived`); `IsoDateSchema`; `Recipe`, `Ingredient` (`qty` è `number | null | undefined`); `IngredientAlias` (`{ alias, canonical_name }`); `INGREDIENT_NAME_MAX = 80`; `PlanView.shopping_list` = `{ exists, needs_regeneration }`. Esistono anche `ShoppingListSchema` e `ShoppingItemSchema` (di F1): **non si toccano e non si usano**.
- `lib/domain/recipe-text.ts` — `normalizeCanonicalName(name)` (trim, minuscolo, spazi compressi; conserva gli accenti).
- `lib/domain/week.ts` — `todayInTimeZone(now, timeZone)`, `addDays(isoDate, days)`, `mondayOf(isoDate)`. `lib/domain/planner-config.ts` — `APP_TIME_ZONE` (`Europe/Rome`).
- `lib/db/schema.ts` — tabelle già presenti (nessuna migrazione in questa feature):
  - `shopping_lists`: `id`, `plan_id` (unico, FK a `meal_plans` con cascade), `generated_at` (timestamptz, default now), `needs_regeneration` (boolean, default false);
  - `shopping_items`: `id`, `list_id` (FK con cascade), `canonical_name` (text), `qty` (**numeric**: il driver la restituisce come stringa), `unit` (text, **nullable**), `category` (text), `checked`, `manual` (boolean), `recipe_ids` (`uuid[]`);
  - `ingredient_aliases`: `alias` (PK), `canonical_name`. È **globale** (non per household).
- `lib/db/index.ts` esporta `db`, `client`, `DbExecutor` (il `db` o una transazione) e riesporta lo schema.
- `lib/db/repositories/plan-repo.ts` — `getPlanById(executor, planId)` → `PlanWithSlots | null` (campi `id, household_id, week_start, status, created_at, generated_at, slots, shopping_list`; ogni slot ha `id, day, meal, recipe_id, servings, locked, recipe` con la ricetta completa di ingredienti, oppure `null`), `acquirePlanLock(executor, householdId)` (advisory lock di transazione), `markShoppingListStale(executor, planId)` (già chiamata da swap, rigenerazione e *Ripeti*), `insertPlan`, `insertSlots`, `activateDraftPlan`, `updateSlotRecipe` (utili nei test).
- `lib/db/repositories/recipe-repo.ts` — `listRecipes({ household_id })` → ricette complete; `lib/db/repositories/household-repo.ts` — `loadHousehold(id?)` (id assente → singleton di default; id sconosciuto → `Error`).
- `lib/plans/service.ts` — `isPlanClosed(plan, currentWeekStart)` (puro: `status === 'archived' || week_start < currentWeekStart`). `lib/plans/errors.ts` + `lib/plans/http.ts` — **modello** per classe d'errore e gestione degli errori di rotta. `lib/plans/format.ts` — `formatWeekRange(first, last)` (`'28 set – 4 ott'`).
- `lib/http/responses.ts` (server) — `errorResponse(status, code, message, details?)`, `invalidRequestResponse(issues?)`, `internalErrorResponse()`, `readJsonBody(request, { allowEmpty })`. `lib/http/client.ts` (client) — `requestJson(url, init, schema)`, `ApiRequestError(status, code, message)` (rete: `status 0`, `network_error`; risposta 2xx non valida: `invalid_response`), `apiErrorMessage(err)`.
- `lib/prefs/client.ts` — **modello** per i client fetch (senza sottoclasse d'errore).
- UI: `components/shopping/shopping-item-row.tsx` (`ShoppingItemRow` presentazionale, tipo locale `ShoppingItem { id, name, amount?, unit?, category?, isChecked }`), `components/ui/sheet.tsx` (`Sheet`, `SheetContent`, `SheetHeader`, `SheetTitle`), `components/ui/button.tsx` (`Button`, `buttonVariants`), `components/feedback/{toast,empty-state}.tsx`, `components/plan/plan-screen.tsx` (footer con il link `/lista?piano=<id>` per i piani confermati).
- `app/(app)/lista/page.tsx` — **pagina finta** (`"use client"`, dati `INITIAL_SHOPPING_ITEMS`): si sostituisce in wave 3. `app/(app)/page.tsx` e `app/(app)/libreria/page.tsx` — modelli di pagina server. `app/(app)/libreria/loading.tsx` — modello di scheletro.
- `fixtures/ingredient-aliases.json` (24 alias), `fixtures/index.ts` (`FIXTURE_INGREDIENT_ALIASES`, `fixtureRecipesAsDomain()`), `lib/db/seed-core.ts` (inserisce gli alias con `onConflictDoNothing`).
- Helper di test: `tests/helpers/db.ts` (`isDbAvailable`, `assertDbMigrated`, `createTestHousehold(overrides?)`, `deleteTestHousehold(id)`), `tests/helpers/plans.ts` (`insertTestRecipe(householdId, spec)`: `servings_base` è sempre **2**, ingrediente di default `sale` `qb` `dispensa`). Modello di test DB: `tests/plans/service.test.ts` (`const dbUp = await isDbAvailable(); describe.skipIf(!dbUp)`, household dedicati eliminati in `afterEach`, `now` iniettato). Modello di test di rotta: `tests/api/plans.test.ts` (`vi.mock` del servizio). Modello di test di pagina server: `tests/app/library-page.test.tsx`. Modello di test di client fetch: `tests/plans/client.test.ts`. Modello di test di schermata con client finti: `tests/ui/plan-screen.test.tsx`.
- Test esistenti coinvolti: `tests/ui/shell.test.tsx` (blocco "ShoppingItemRow" e test "renders Shopping list page with sections and progress"), `tests/ui/plan-screen.test.tsx` (blocco "confirmation and footer" e test "keeps a past week read-only…"), `tests/fixtures-data/recipes-fixtures.test.ts` (`expect(aliasNames.size).toBe(24)`).

### 0.3 Regole vincolanti
1. Tipi e schemi di dominio e i DTO delle API **solo** in `lib/domain/types.ts`. Le interfacce di funzione e i tipi riga dei repository vivono nei rispettivi moduli.
2. `lib/domain/*` è **puro**: nessun import da `lib/db`, `lib/llm`, `lib/recipes`, `lib/shopping`, `next/*`; niente rete, orologio o `Math.random()`.
3. Nessun modulo di questa feature importa da `lib/llm/` o `lib/recipes/`. `lib/llm/`, `lib/recipes/`, `lib/domain/planner.ts`, `lib/prefs/` **non si modificano**. Gli alias si risolvono **solo** nella costruzione della lista (requirements U1): ricette e preferenze restano com'erano.
4. I componenti client (`"use client"`) importano da `lib/shopping/` **solo** `client.ts` e `check-queue.ts`; mai `service.ts`, `errors.ts`, `http.ts`. Non creare `index.ts` in `lib/shopping/`.
5. **Nessuna migrazione** e nessuna modifica a `lib/db/schema.ts`.
6. UI copy in italiano, **esattamente** come scritta nel piano (compresi `…` U+2026, `–` U+2013 e `·` U+00B7). Tap target ≥ 44 px, focus visibile (`focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-basil`), animazioni con `motion-reduce:animate-none`.
7. Mai `window.confirm` / `alert`: le conferme sono riquadri nella pagina.
8. Gate per ogni wave: `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build` verdi. Test DB: Postgres di `docker-compose.dev.yml` attivo e `pnpm db:migrate`. **Porta del DB**: controllare `docker ps`; solo se il container `smart-portfolio-db` è acceso (5432 occupata) avviare il Postgres di Mealy sulla 5433 con un override (`services.postgres.ports: !override ["5433:5432"]`) e lanciare migrate/test/build con `DATABASE_URL=postgresql://mealy:mealy@localhost:5433/mealy_dev`.

### 0.4 Glossario
- **Articolo**: una riga di `shopping_items`. **Generato** (`manual = false`): viene dal piano, ha `unit` tra `g, ml, pz, qb`. **A mano** (`manual = true`): aggiunto dall'utente, `unit` e `qty` `null`, `recipe_ids` vuoto.
- **Chiave** di un articolo generato: `(canonical_name, unit)`.
- **Piano chiuso**: `isPlanClosed(plan, lunedì della settimana corrente)`. **Piano confermato**: `status === 'active'`.
- **Lista da aggiornare**: `shopping_lists.needs_regeneration = true` (il piano è cambiato dopo l'ultima costruzione).
- **Oggi**: `todayInTimeZone(now, APP_TIME_ZONE)`.

### 0.5 Mappa dei work package
| WP | Wave | Story | Contenuto |
|---|---|---|---|
| WP1 | 1 | S4.1 | Tipi in `types.ts` e funzioni pure `lib/domain/shopping-list.ts` |
| WP2 | 1 | S4.1 (alias) + S4.2 (dati) | Repository `shopping-repo.ts`, seed degli alias ampliato |
| WP3 | 2 | S4.2 (server) | Errori, servizio, 5 rotte API, ARCHITECTURE |
| WP4 | 2 | S4.2 (client) | Client fetch e coda delle spunte |
| WP5 | 2 | S4.2 (mattoni UI) | `ShoppingItemRow` (aggiunte), `AddShoppingItemSheet` |
| WP6 | 3 | S4.2 | Pagina e schermata Lista, DESIGN §4.3 |
| WP7 | 3 | S4.2 | Footer del Piano: crea / apri la lista |

---

## WP1 — Contratti e funzioni pure (wave 1, parallelo a WP2)

**Obiettivo:** scrivere i contratti di F6 in `types.ts` e tutte le regole pure della lista: consolidamento, riconciliazione, reparto di un articolo a mano, ordinamento, raggruppamento, formattazione.

### File
- `lib/domain/types.ts` — **modifica** (solo un blocco in coda)
- `lib/domain/shopping-list.ts` — nuovo
- `tests/domain/shopping-list.test.ts`, `tests/domain/shopping-contracts.test.ts` — nuovi

### Pattern di riferimento
- Blocchi commentati e `XxxSchema` + `type Xxx = z.infer<…>` come "Library & Preferences (Feature 5)" in `lib/domain/types.ts`.
- Funzioni pure con JSDoc in italiano come `lib/domain/prefs.ts` e `lib/domain/library.ts`; test puri come `tests/domain/prefs.test.ts`.

### Passi

**1. `lib/domain/types.ts`.** Aggiungere in coda al file (nessuno schema esistente cambia):
```ts
// ============================================================================
// Shopping List (Feature 6)
// ============================================================================

export const SHOPPING_ITEM_NAME_MAX = 80;

// Un articolo della lista. `unit` è null solo per gli articoli aggiunti a mano;
// `qty` è null per 'qb' e per gli articoli a mano.
export const ShoppingItemViewSchema = z.object({
  id: z.string().uuid(),
  canonical_name: z.string().min(1), // normalizzato, alias già risolti
  qty: z.number().positive().nullable(),
  unit: UnitSchema.nullable(),
  category: CategorySchema,
  checked: z.boolean(),
  manual: z.boolean(),
  recipe_ids: z.array(z.string().uuid()), // ricette per cui serve; vuoto per gli articoli a mano
});
export type ShoppingItemView = z.infer<typeof ShoppingItemViewSchema>;

export const ShoppingRecipeRefSchema = z.object({
  id: z.string().uuid(),
  title: z.string().min(1),
});
export type ShoppingRecipeRef = z.infer<typeof ShoppingRecipeRefSchema>;

export const ShoppingListViewSchema = z.object({
  id: z.string().uuid(),
  generated_at: z.string().datetime(),
  needs_regeneration: z.boolean(), // il piano è cambiato dopo l'ultima costruzione
  items: z.array(ShoppingItemViewSchema), // ordinati per reparto, nome, unità
  recipes: z.array(ShoppingRecipeRefSchema), // ricette citate in recipe_ids che esistono ancora
});
export type ShoppingListView = z.infer<typeof ShoppingListViewSchema>;

export const ShoppingPlanRefSchema = z.object({
  id: z.string().uuid(),
  week_start: IsoDateSchema, // lunedì
  last_day: IsoDateSchema, // domenica = week_start + 6
  status: PlanStatusSchema,
  has_list: z.boolean(),
});
export type ShoppingPlanRef = z.infer<typeof ShoppingPlanRefSchema>;

// Risposta di GET e POST /api/plans/:id/shopping-list
export const PlanShoppingListViewSchema = z.object({
  plan: ShoppingPlanRefSchema,
  editable: z.boolean(), // piano non chiuso: spunte e articoli a mano consentiti
  can_build: z.boolean(), // piano confermato e non chiuso: la lista si può creare o aggiornare
  list: ShoppingListViewSchema.nullable(), // null: la lista non è ancora stata creata
});
export type PlanShoppingListView = z.infer<typeof PlanShoppingListViewSchema>;

// Dato iniziale della pagina Lista.
export const ShoppingScreenViewSchema = z.object({
  plans: z.array(ShoppingPlanRefSchema), // piani confermati e non chiusi, per week_start crescente
  selected: PlanShoppingListViewSchema.nullable(), // piano mostrato; null se non c'è nulla da mostrare
});
export type ShoppingScreenView = z.infer<typeof ShoppingScreenViewSchema>;

// Body di PATCH /api/shopping-items/:id
export const UpdateShoppingItemRequestSchema = z.object({ checked: z.boolean() }).strict();
export type UpdateShoppingItemRequest = z.infer<typeof UpdateShoppingItemRequestSchema>;

// Body di POST /api/plans/:id/shopping-list/items
export const AddShoppingItemRequestSchema = z
  .object({ name: z.string().trim().min(1).max(SHOPPING_ITEM_NAME_MAX) })
  .strict();
export type AddShoppingItemRequest = z.infer<typeof AddShoppingItemRequestSchema>;

// Risposta di PATCH /api/shopping-items/:id e di POST …/shopping-list/items
export const ShoppingItemResultSchema = z.object({ item: ShoppingItemViewSchema });
export type ShoppingItemResult = z.infer<typeof ShoppingItemResultSchema>;

// Risposta di DELETE /api/shopping-items/:id
export const DeleteShoppingItemResultSchema = z.object({ id: z.string().uuid() });
export type DeleteShoppingItemResult = z.infer<typeof DeleteShoppingItemResultSchema>;
```

**2. `lib/domain/shopping-list.ts`** (puro; importa **solo** da `./types` e `./recipe-text`). Esportare esattamente:
```ts
/** Alias normalizzato → nome canonico normalizzato. */
export type AliasMap = ReadonlyMap<string, string>;

/** Uno slot del piano visto dal consolidamento (compatibile con PlanSlotRecord di plan-repo). */
export interface ShoppingSlotInput {
  servings: number;
  recipe: Pick<Recipe, 'id' | 'servings_base' | 'ingredients'> | null;
}

/** Un articolo calcolato dal piano, non ancora salvato. */
export interface BuiltShoppingItem {
  canonical_name: string;
  qty: number | null; // null se e solo se unit === 'qb'
  unit: Unit;
  category: Category;
  recipe_ids: string[]; // distinti, in ordine crescente
}

/** Un articolo generato già salvato, visto dalla riconciliazione. */
export interface ExistingShoppingItem {
  id: string;
  canonical_name: string;
  qty: number | null;
  unit: Unit | null;
  checked: boolean;
}

export interface ShoppingListChanges {
  toInsert: BuiltShoppingItem[]; // chiavi nuove: nascono non spuntate
  toUpdate: { id: string; item: BuiltShoppingItem; checked: boolean }[]; // chiavi che restano
  toDelete: string[]; // id degli articoli generati che non servono più, in ordine crescente
}

export interface ShoppingSection {
  category: Category;
  label: string; // CATEGORY_LABELS[category]
  items: ShoppingItemView[]; // non spuntati prima, poi spuntati
  checked: number;
  total: number;
}

export function toAliasMap(aliases: readonly IngredientAlias[]): Map<string, string>
export function resolveIngredientName(name: string, aliases: AliasMap): string
export function roundShoppingQuantity(value: number, unit: Unit): number | null
export function buildShoppingList(slots: readonly ShoppingSlotInput[], aliases?: AliasMap): BuiltShoppingItem[]
export function reconcileShoppingItems(
  existing: readonly ExistingShoppingItem[],
  built: readonly BuiltShoppingItem[]
): ShoppingListChanges
export function inferShoppingCategory(
  name: string,
  recipes: readonly Pick<Recipe, 'ingredients'>[],
  aliases?: AliasMap
): Category
export function compareShoppingItemsByAisle(a: ShoppingItemView, b: ShoppingItemView): number
export function compareShoppingItemsForDisplay(a: ShoppingItemView, b: ShoppingItemView): number
export function groupShoppingItems(items: readonly ShoppingItemView[]): ShoppingSection[]
export function shoppingProgress(items: readonly Pick<ShoppingItemView, 'checked'>[]): { checked: number; total: number }
export function formatShoppingQuantity(qty: number | null, unit: Unit | null): string
export function shoppingItemLabel(canonicalName: string): string
export function pickDefaultShoppingPlan(plans: readonly ShoppingPlanRef[]): string | null
```
Dove un parametro `aliases` è opzionale, il default è una mappa vuota.

Regole esatte.

- **`toAliasMap`**: per ogni voce `a = normalizeCanonicalName(alias)`, `c = normalizeCanonicalName(canonical_name)`; saltare la voce se `a === ''`, `c === ''` o `a === c`; altrimenti `map.set(a, c)` (una voce successiva con lo stesso alias sovrascrive).
- **`resolveIngredientName`**: `n = normalizeCanonicalName(name)`; restituire `aliases.get(n) ?? n`. **Un solo passo**: il risultato non si risolve di nuovo.
- **`roundShoppingQuantity`** (per eccesso):
  - `unit === 'qb'` → `null`;
  - `v = Math.round(value * 1000) / 1000` (toglie il rumore dei decimali binari);
  - `pz` → `Math.max(1, Math.ceil(v))`;
  - `g` e `ml` → se `v <= 10`: `Math.max(1, Math.ceil(v))`; altrimenti `Math.ceil(v / 10) * 10`.

  | value, unit | risultato |
  |---|---|
  | `66.6667, 'g'` | `70` |
  | `150, 'g'` | `150` |
  | `200.0000001, 'g'` | `200` |
  | `2.5, 'g'` | `3` |
  | `10, 'ml'` | `10` |
  | `10.4, 'ml'` | `20` |
  | `0.75, 'pz'` | `1` |
  | `1.5, 'pz'` | `2` |
  | `3.0000001, 'pz'` | `3` |
  | `5, 'qb'` | `null` |
- **`buildShoppingList`**:
  1. Saltare lo slot se `slot.recipe === null`, se `!(slot.recipe.servings_base > 0)` o se `!(slot.servings > 0)`.
  2. `factor = slot.servings / slot.recipe.servings_base`.
  3. Per ogni ingrediente di `slot.recipe.ingredients ?? []`:
     - `name = resolveIngredientName(ing.canonical_name, aliases)`; se `name === ''` saltarlo;
     - `quantified = ing.unit !== 'qb' && typeof ing.qty === 'number' && ing.qty > 0`;
     - `unit = quantified ? ing.unit : 'qb'`;
     - nel secchio di `name` (struttura: per nome, una mappa `unit → { sum, recipeIds: Set<string> }` più una mappa `category → conteggio`): sommare `ing.qty * factor` a `sum` se `quantified` (per `qb` `sum` resta 0), aggiungere `slot.recipe.id` a `recipeIds`, incrementare di 1 il conteggio di `ing.category`.
  4. **Reparto del nome**: la `category` con il conteggio più alto; a parità quella con l'indice più basso in `CATEGORY_VALUES`. Tutte le righe dello stesso nome hanno lo stesso reparto.
  5. **Assorbimento di `qb`**: se il nome ha la voce `qb` **e** almeno una tra `g`, `ml`, `pz`, la voce `qb` si elimina e i suoi `recipeIds` si aggiungono alla prima voce presente nell'ordine `g`, `ml`, `pz`.
  6. Per ogni voce rimasta produrre `{ canonical_name: name, qty: roundShoppingQuantity(sum, unit), unit, category, recipe_ids: [...recipeIds].sort() }`.
  7. Ordinare il risultato per: indice del reparto in `CATEGORY_VALUES`; poi `canonical_name.localeCompare(altro, 'it')`; poi indice dell'unità in `UNIT_VALUES`.

  La funzione non filtra per data: lo fa chi chiama.
- **`reconcileShoppingItems`** (`existing` contiene solo articoli generati):
  - chiave: `` `${canonical_name}|${unit ?? ''}` ``;
  - scorrere `existing` in ordine di `id` crescente (confronto tra stringhe): la prima occorrenza di ogni chiave entra nell'indice, le successive (doppioni) vanno in `toDelete`;
  - per ogni articolo di `built`, nell'ordine dato: se la chiave non è nell'indice → `toInsert`; altrimenti → `toUpdate` con `{ id: trovato.id, item: built, checked }` dove `checked = trovato.checked && (built.qty === null || (trovato.qty !== null && built.qty <= trovato.qty))`;
  - gli articoli dell'indice senza corrispondenza in `built` → `toDelete`;
  - `toDelete` ordinato per `id` crescente.
- **`inferShoppingCategory`**: `target = resolveIngredientName(name, aliases)`; se `target === ''` → `'altro'`. Contare la `category` di ogni ingrediente di ogni ricetta (`recipe.ingredients ?? []`) per cui `resolveIngredientName(ing.canonical_name, aliases) === target`. Nessuna corrispondenza → `'altro'`; altrimenti la più frequente, a parità l'indice più basso in `CATEGORY_VALUES`.
- **`compareShoppingItemsByAisle`**: indice del reparto → `canonical_name.localeCompare(…, 'it')` → indice dell'unità in `UNIT_VALUES` (`unit === null` vale `UNIT_VALUES.length`, cioè dopo tutte) → `id` (confronto tra stringhe).
- **`compareShoppingItemsForDisplay`**: `Number(a.checked) - Number(b.checked)` (non spuntati prima) → nome → unità → `id`, come sopra.
- **`groupShoppingItems`**: per ogni reparto di `CATEGORY_VALUES` che ha almeno un articolo, nell'ordine di `CATEGORY_VALUES`: `{ category, label: CATEGORY_LABELS[category], items: [...articoli del reparto].sort(compareShoppingItemsForDisplay), checked, total }`. Non muta l'input.
- **`shoppingProgress`**: `{ checked: quanti hanno checked true, total: items.length }`.
- **`formatShoppingQuantity`**, con `fmt(n) = String(Math.round(n * 100) / 100).replace('.', ',')`:
  - `unit === null` → `''`; `unit === 'qb'` → `'q.b.'`; `qty === null` → `''`;
  - `g`: `qty >= 1000` → `` `${fmt(qty / 1000)} kg` ``, altrimenti `` `${fmt(qty)} g` ``;
  - `ml`: `qty >= 1000` → `` `${fmt(qty / 1000)} l` ``, altrimenti `` `${fmt(qty)} ml` ``;
  - `pz`: `` `${fmt(qty)} pz` ``.

  Esempi: `(300,'g')` → `300 g`; `(1000,'g')` → `1 kg`; `(1250,'g')` → `1,25 kg`; `(1500,'ml')` → `1,5 l`; `(2,'pz')` → `2 pz`; `(null,'qb')` → `q.b.`; `(null,null)` → stringa vuota.
- **`shoppingItemLabel`**: `canonicalName.charAt(0).toUpperCase() + canonicalName.slice(1)` (`'petto di pollo'` → `'Petto di pollo'`).
- **`pickDefaultShoppingPlan`**: tra i piani con `has_list` quello con `week_start` maggiore (confronto tra stringhe ISO); se nessuno ha la lista, tra tutti quello con `week_start` maggiore; lista vuota → `null`. Restituisce l'`id`.

**3. Test.**
- `tests/domain/shopping-list.test.ts`:
  - `toAliasMap`: normalizza entrambe le parti (`' Pelati '` → `'pelati'`), salta voci vuote e voci con alias uguale al canonico.
  - `resolveIngredientName`: nome con alias; nome senza alias; normalizza prima di cercare; **un solo passo** (con `a→b` e `b→c`, `a` dà `b`).
  - `roundShoppingQuantity`: tutte le righe della tabella sopra.
  - `buildShoppingList`:
    1. **scala**: ricetta `servings_base: 2` con `petto di pollo 200 g`, slot `servings: 3` → `300 g`;
    2. **somma tra ricette**: due ricette con `petto di pollo` `200 g` e `150 g`, slot con `servings` uguale a `servings_base` → una riga `350 g` con entrambi gli id in `recipe_ids`, in ordine crescente;
    3. **stessa ricetta in due slot** → quantità doppia, un solo id in `recipe_ids`;
    4. **`qb`**: due ricette con `sale` `qb` → una riga `{ qty: null, unit: 'qb' }` con due id;
    5. **`qb` assorbito**: `olio extravergine di oliva` `qb` in una ricetta e `30 ml` in un'altra → una sola riga `30 ml` con entrambi gli id;
    6. **unità eterogenee**: `limone` `1 pz` e `limone` `50 g` → due righe con lo **stesso** reparto, `g` prima di `pz`;
    7. **quantità assente con unità `g`** (`qty: null`) → trattata come `qb`;
    8. **alias**: mappa `pelati → pomodoro pelato`; ricette con `pelati 400 g` e `pomodoro pelato 400 g` → una riga `pomodoro pelato` `800 g`;
    9. **reparto a maggioranza**: `uovo` in `banco-frigo` due volte e in `dispensa` una → `banco-frigo`; parità `dispensa`/`banco-frigo` → `banco-frigo` (viene prima nel giro);
    10. **arrotondamento**: `100 g` con `servings_base: 3` e `servings: 2` → `70 g`;
    11. slot con `recipe: null`, con `servings: 0` o con `servings_base: 0` → ignorati; nessuno slot → `[]`;
    12. **ordine**: reparti nell'ordine di `CATEGORY_VALUES`, poi alfabetico;
    13. **sulle fixture**: `slots = fixtureRecipesAsDomain().map((recipe) => ({ servings: recipe.servings_base, recipe }))` e `aliases = toAliasMap(FIXTURE_INGREDIENT_ALIASES)` → l'insieme dei `canonical_name` prodotti è uguale all'insieme dei nomi normalizzati di tutti gli ingredienti delle fixture; nessuna coppia `(canonical_name, unit)` ripetuta; ogni articolo con `unit !== 'qb'` ha `qty` intero > 0; ogni articolo `qb` ha `qty === null`; nessun nome compare sia con `qb` sia con un'altra unità; `carota` compare con `g` e con `pz` nello stesso reparto;
    14. l'input non viene mutato (confronto con una copia `structuredClone` fatta prima).
  - `reconcileShoppingItems`: chiave nuova → `toInsert`; chiave sparita → `toDelete`; chiave che resta → `toUpdate` con lo stesso `id`; spunta conservata con quantità uguale o minore; spunta tolta con quantità maggiore; `qb` spuntato resta spuntato; non spuntato resta non spuntato; stessa `canonical_name` con unità diversa non corrisponde (una in `toInsert`, l'altra in `toDelete`); due esistenti con la stessa chiave → quello con l'`id` minore si aggiorna, l'altro va in `toDelete`; `existing` vuoto → tutto in `toInsert`; `built` vuoto → tutto in `toDelete`.
  - `inferShoppingCategory`: nome presente in libreria → il suo reparto; nome scritto come alias (`'pelati'` con la mappa) → reparto di `pomodoro pelato`; nome sconosciuto → `'altro'`; stringa di soli spazi → `'altro'`; maggioranza e parità come sopra.
  - `groupShoppingItems`: solo i reparti non vuoti, nell'ordine del giro; dentro il reparto i non spuntati prima; conteggi `checked` / `total`; un articolo a mano (`unit: null`) sta dopo l'omonimo generato; input non mutato.
  - `compareShoppingItemsByAisle`: reparto, poi nome, poi unità, poi id.
  - `shoppingProgress`, `formatShoppingQuantity` (tutti gli esempi), `shoppingItemLabel`.
  - `pickDefaultShoppingPlan`: vuoto → `null`; uno senza lista → il suo id; due senza lista → il più avanti; due di cui solo il primo con lista → il primo; due con lista → il più avanti.
  - **purezza**: leggere `lib/domain/shopping-list.ts` con `readFileSync` e verificare che ogni riga `import … from '…'` importi solo da `./types` o `./recipe-text`.
- `tests/domain/shopping-contracts.test.ts`: `UpdateShoppingItemRequestSchema` accetta `{ checked: true }`, rifiuta `{}`, `{ checked: 'si' }` e un campo in più; `AddShoppingItemRequestSchema` accetta `{ name: ' latte ' }` e restituisce `name: 'latte'`, rifiuta `{ name: '   ' }`, un nome di 81 caratteri e un campo in più, accetta un nome di 80; `ShoppingItemViewSchema` accetta un articolo generato e uno a mano (`unit: null`, `qty: null`, `recipe_ids: []`), rifiuta `qty: 0` e `unit: 'kg'`; `PlanShoppingListViewSchema` accetta `list: null`; `ShoppingScreenViewSchema` accetta `{ plans: [], selected: null }`.

### Contratti esposti
Tutto quanto ai passi 1 e 2, con queste firme. WP3 usa tipi e funzioni pure; WP4 gli schemi; WP5 `SHOPPING_ITEM_NAME_MAX`; WP6 tipi, `groupShoppingItems`, `shoppingProgress`, `formatShoppingQuantity`, `shoppingItemLabel`.

### Dipendenze
Nessuna (solo codice esistente).

### Criteri di accettazione
- `lib/domain/shopping-list.ts` importa solo da `./types` e `./recipe-text` (test di purezza verde).
- I test elencati sono verdi senza DB e senza rete; `pnpm typecheck` verde.
- Nessuno schema preesistente di `types.ts` è cambiato.

### Fuori ambito
Repository, servizi, rotte, componenti. Conversioni tra unità (`pz` ↔ `g`). Catene di alias. Modifiche a `ShoppingListSchema` / `ShoppingItemSchema` di F1.

---

## WP2 — Repository della lista e alias del seed (wave 1, parallelo a WP1)

**Obiettivo:** dare alle tabelle della lista un repository tipato e ampliare il seed degli alias con le varianti viste nelle risposte reali dei modelli.

### File
- `lib/db/repositories/shopping-repo.ts` — nuovo
- `fixtures/ingredient-aliases.json` — **modifica** (12 voci in più)
- `tests/db/shopping-repo.test.ts` — nuovo
- `tests/fixtures-data/recipes-fixtures.test.ts` — **modifica**

### Pattern di riferimento
- Repository con `executor: DbExecutor` come primo argomento, JSDoc in italiano e mappatura delle righe: `lib/db/repositories/plan-repo.ts` e `lib/db/repositories/ingredient-pref-repo.ts`.
- Test DB: `tests/db/plan-repo.test.ts` (household dedicati, eliminati in `afterEach`).

### Passi

**1. `lib/db/repositories/shopping-repo.ts`.** Usa solo tipi **già esistenti** in `lib/domain/types.ts` (`Unit`, `UnitSchema`, `Category`, `CategorySchema`, `PlanStatus`, `PlanStatusSchema`, `IngredientAlias`): non dipende da WP1.
```ts
export interface ShoppingListRecord {
  id: string;
  plan_id: string;
  generated_at: Date;
  needs_regeneration: boolean;
}

export interface ShoppingItemRecord {
  id: string;
  list_id: string;
  canonical_name: string;
  qty: number | null;
  unit: Unit | null;
  category: Category;
  checked: boolean;
  manual: boolean;
  recipe_ids: string[];
}

export interface NewShoppingItemInput {
  canonical_name: string;
  qty: number | null;
  unit: Unit | null;
  category: Category;
  checked: boolean;
  manual: boolean;
  recipe_ids: string[];
}

export interface GeneratedItemUpdate {
  qty: number | null;
  category: Category;
  checked: boolean;
  recipe_ids: string[];
}

export interface ShoppingItemContext {
  item: ShoppingItemRecord;
  plan: { id: string; household_id: string; week_start: string; status: PlanStatus };
}

export interface OpenPlanRow {
  id: string;
  week_start: string;
  status: PlanStatus;
  has_list: boolean;
}

/** Lista del piano; null se non è mai stata creata. */
export async function findShoppingListByPlan(executor: DbExecutor, planId: string): Promise<ShoppingListRecord | null>

/** Crea la lista del piano (una per piano: chi chiama tiene il lock del piano). */
export async function insertShoppingList(executor: DbExecutor, planId: string): Promise<ShoppingListRecord>

/** Segna la lista come appena costruita: generated_at = now() del DB, needs_regeneration = false. */
export async function markShoppingListGenerated(executor: DbExecutor, listId: string): Promise<ShoppingListRecord>

/** Tutti gli articoli della lista, in ordine di id crescente. */
export async function listShoppingItems(executor: DbExecutor, listId: string): Promise<ShoppingItemRecord[]>

/** Inserisce gli articoli e li restituisce; con array vuoto non esegue query. */
export async function insertShoppingItems(
  executor: DbExecutor,
  listId: string,
  items: NewShoppingItemInput[]
): Promise<ShoppingItemRecord[]>

/** Aggiorna quantità, reparto, spunta e ricette di un articolo generato (nome e unità non cambiano). */
export async function updateGeneratedShoppingItem(
  executor: DbExecutor,
  itemId: string,
  values: GeneratedItemUpdate
): Promise<void>

/** Elimina gli articoli indicati; con array vuoto non esegue query. */
export async function deleteShoppingItems(executor: DbExecutor, itemIds: string[]): Promise<void>

/** Imposta la spunta; null se l'articolo non esiste (più). */
export async function setShoppingItemChecked(
  executor: DbExecutor,
  itemId: string,
  checked: boolean
): Promise<ShoppingItemRecord | null>

/** Articolo a mano della lista con quel nome (già normalizzato); il primo per id, null se assente. */
export async function findManualShoppingItem(
  executor: DbExecutor,
  listId: string,
  canonicalName: string
): Promise<ShoppingItemRecord | null>

/** Un articolo con il piano a cui appartiene la sua lista; null se l'articolo non esiste. */
export async function getShoppingItemContext(executor: DbExecutor, itemId: string): Promise<ShoppingItemContext | null>

/** Tutti gli alias (tabella globale), in ordine di alias crescente. */
export async function listIngredientAliases(executor: DbExecutor): Promise<IngredientAlias[]>

/** Id e titolo delle ricette indicate che esistono ancora, per titolo crescente poi id; array vuoto → nessuna query. */
export async function listRecipeRefs(executor: DbExecutor, recipeIds: string[]): Promise<{ id: string; title: string }[]>

/** Piani dell'household non chiusi (week_start >= currentWeekStart e status diverso da 'archived'), per week_start crescente. */
export async function listOpenPlans(
  executor: DbExecutor,
  householdId: string,
  currentWeekStart: string
): Promise<OpenPlanRow[]>
```
Regole:
- Mappatura di una riga di `shopping_items` (una sola funzione interna `toItemRecord`): `qty = row.qty === null ? null : Number(row.qty)`; `unit = row.unit === null ? null : UnitSchema.parse(row.unit)`; `category = CategorySchema.parse(row.category)`; gli altri campi copiati.
- In scrittura `qty` va convertita: `qty === null ? null : String(qty)`.
- `markShoppingListGenerated`: `set({ generated_at: sql\`now()\`, needs_regeneration: false })` con `returning()`.
- `updateGeneratedShoppingItem`: `set({ qty, category, checked, recipe_ids })` con `where(eq(shopping_items.id, itemId))`.
- `deleteShoppingItems`: `inArray(shopping_items.id, itemIds)`.
- `findManualShoppingItem`: `where(and(eq(list_id), eq(manual, true), eq(canonical_name)))`, `orderBy(asc(id))`, `limit(1)`.
- `getShoppingItemContext`: `shopping_items` `innerJoin` `shopping_lists` (su `list_id`) `innerJoin` `meal_plans` (su `plan_id`); `status` passa per `PlanStatusSchema.parse`.
- `listRecipeRefs`: `select({ id, title }).from(recipes).where(inArray(recipes.id, recipeIds)).orderBy(asc(recipes.title), asc(recipes.id))`.
- `listOpenPlans`: `meal_plans` `leftJoin` `shopping_lists` (su `plan_id`); `where(and(eq(household_id), gte(week_start, currentWeekStart), ne(status, 'archived')))`; `has_list` = la riga di `shopping_lists` non è null; `orderBy(asc(week_start))`.
- Il repository **non** normalizza i nomi e non decide nulla: lo fa chi chiama.

**2. `fixtures/ingredient-aliases.json`.** Aggiungere in coda all'array `aliases`, in quest'ordine, queste 12 voci (le 24 esistenti non cambiano):
```json
{ "alias": "olio di oliva", "canonical_name": "olio extravergine di oliva" },
{ "alias": "olio extravergine d'oliva", "canonical_name": "olio extravergine di oliva" },
{ "alias": "olio extra vergine di oliva", "canonical_name": "olio extravergine di oliva" },
{ "alias": "ceci", "canonical_name": "ceci lessati" },
{ "alias": "ceci cotti", "canonical_name": "ceci lessati" },
{ "alias": "couscous", "canonical_name": "couscous di grano" },
{ "alias": "cous cous", "canonical_name": "couscous di grano" },
{ "alias": "paprika", "canonical_name": "paprika dolce" },
{ "alias": "pasta", "canonical_name": "pasta di semola" },
{ "alias": "lenticchie", "canonical_name": "lenticchia" },
{ "alias": "lenticchie secche", "canonical_name": "lenticchia" },
{ "alias": "pomodorini", "canonical_name": "pomodorino" }
```
Non aggiungere altre voci: varianti come `cipolla rossa`, `lenticchie rosse`, `pasta corta`, `paprika affumicata` sono prodotti diversi e restano distinte.

**3. Test.**
- `tests/fixtures-data/recipes-fixtures.test.ts`: nel test "ensures no canonical_name is an alias from ingredient-aliases.json" cambiare `expect(aliasNames.size).toBe(24)` in `toBe(36)`. Aggiungere un test "has normalized aliases without chains": per ogni voce di `FIXTURE_INGREDIENT_ALIASES`, `alias` e `canonical_name` sono uguali al proprio `normalizeCanonicalName`, `alias !== canonical_name`, e `canonical_name` non è a sua volta un `alias` di un'altra voce.
- `tests/db/shopping-repo.test.ts` (DB; ogni test crea un household con `createTestHousehold`, un piano con `insertPlan(db, householdId, '2026-09-28')` e lo elimina in `afterEach` tramite `deleteTestHousehold`):
  1. `findShoppingListByPlan` → `null`; dopo `insertShoppingList` restituisce la riga con `needs_regeneration: false`;
  2. `markShoppingListGenerated` dopo `markShoppingListStale(db, planId)` → `needs_regeneration: false` e `generated_at` non precedente a quello di prima;
  3. `insertShoppingItems` + `listShoppingItems`: `qty: 250.5` torna come **numero** `250.5`; `qty: null` e `unit: null` restano `null`; `recipe_ids` torna come array di stringhe; array vuoto → `[]` senza errori;
  4. `updateGeneratedShoppingItem` cambia `qty`, `category`, `checked`, `recipe_ids` e lascia `canonical_name`, `unit`, `manual`;
  5. `setShoppingItemChecked` → riga aggiornata; con un id inesistente (`crypto.randomUUID()`) → `null`;
  6. `deleteShoppingItems` elimina solo gli id indicati; array vuoto non fallisce;
  7. `findManualShoppingItem` trova solo gli articoli con `manual: true` (un articolo generato con lo stesso nome non conta) e solo nella lista indicata;
  8. `getShoppingItemContext` → articolo e piano (`household_id`, `week_start`, `status: 'draft'`); id inesistente → `null`;
  9. `listRecipeRefs` (due ricette inserite con `insertTestRecipe`, titoli `B test` e `A test`) → ordinate per titolo; un id inesistente viene ignorato; `[]` → `[]`;
  10. `listOpenPlans` con piani `2026-09-21` (attivato con `activateDraftPlan`), `2026-09-28` (bozza), `2026-10-05` (attivato e con lista) e `currentWeekStart = '2026-09-28'` → restituisce `2026-09-28` e `2026-10-05` in quest'ordine, con `has_list` `false` e `true`; un piano con `status` portato a `archived` (aggiornando `meal_plans` nel test) viene escluso;
  11. `listIngredientAliases` contiene un alias inserito dal test con nome unico (`` `alias-test-${crypto.randomUUID()}` `` → `` `canonico-test-…` ``), poi eliminato in `afterEach` con `db.delete(ingredient_aliases).where(eq(ingredient_aliases.alias, …))`;
  12. eliminare l'household elimina lista e articoli (cascade).

### Contratti esposti
Le 13 funzioni e i 6 tipi del passo 1; il file degli alias con 36 voci.

### Dipendenze
Nessuna da WP1.

### Criteri di accettazione
- I 12 test del repository sono verdi sul Postgres locale; `tests/db/seed.test.ts` resta verde senza modifiche.
- `lib/db/schema.ts` e `lib/db/migrations/` non hanno modifiche.
- `fixtures/ingredient-aliases.json` ha 36 voci, nessuna catena.

### Fuori ambito
Servizi, rotte, UI. Risoluzione degli alias nelle ricette o nelle preferenze. Indici o vincoli nuovi sul DB. Una UI per gestire gli alias.

**Nota operativa:** sui database già popolati le voci nuove arrivano con `pnpm db:seed:aliases` (idempotente, solo alias: vedi innesto R4 in fondo al piano); in sviluppo va bene anche `pnpm db:seed`.

---

## WP3 — Errori, servizio e rotte API (wave 2, parallelo a WP4 e WP5)

**Obiettivo:** creare, aggiornare e leggere la lista di un piano e gestire spunte e articoli a mano attraverso un servizio lato server e cinque rotte.

### File
- `lib/shopping/errors.ts`, `lib/shopping/http.ts`, `lib/shopping/service.ts` — nuovi
- `app/api/plans/[id]/shopping-list/route.ts`, `app/api/plans/[id]/shopping-list/items/route.ts`, `app/api/shopping-items/[id]/route.ts` — nuovi
- `docs/ARCHITECTURE.md` — **modifica** (§4.2, §5.5, §6)
- `tests/shopping/service.test.ts`, `tests/api/shopping-list.test.ts`, `tests/api/shopping-items.test.ts` — nuovi

### Pattern di riferimento
- Errori: `lib/plans/errors.ts`; gestione degli errori di rotta: `lib/plans/http.ts`.
- Servizio con opzioni iniettabili e transazione sotto lock: `lib/plans/service.ts` (`confirmPlan`).
- Rotte: `app/api/plans/[id]/confirm/route.ts` e `app/api/plans/[id]/slots/[slotId]/route.ts`.
- Test di rotta: `tests/api/plans.test.ts`. Test DB: `tests/plans/service.test.ts`.

### Passi

**1. `lib/shopping/errors.ts`** (nessun import dal DB):
```ts
export const SHOPPING_ERROR_CODES = [
  'plan_not_found',
  'list_not_found',
  'item_not_found',
  'plan_not_confirmed',
  'plan_archived',
  'item_not_manual',
] as const;
export type ShoppingErrorCode = (typeof SHOPPING_ERROR_CODES)[number];

export const SHOPPING_ERROR_HTTP: Record<ShoppingErrorCode, { status: number; message: string }> = {
  plan_not_found: { status: 404, message: 'Piano non trovato.' },
  list_not_found: { status: 404, message: 'Lista della spesa non trovata.' },
  item_not_found: { status: 404, message: 'Articolo non trovato.' },
  plan_not_confirmed: { status: 409, message: 'Conferma il piano per creare la lista della spesa.' },
  plan_archived: { status: 409, message: 'Questa settimana è conclusa: la lista si può solo consultare.' },
  item_not_manual: { status: 409, message: 'Si possono rimuovere solo gli articoli aggiunti a mano.' },
};

export class ShoppingError extends Error {
  readonly code: ShoppingErrorCode;
  constructor(code: ShoppingErrorCode) // super(SHOPPING_ERROR_HTTP[code].message); name = 'ShoppingError'
}
export function isShoppingError(error: unknown): error is ShoppingError
```

**2. `lib/shopping/http.ts`** (prima riga: `// Solo lato server: gestione comune degli errori delle rotte della lista della spesa.`):
```ts
/** ShoppingError → risposta col suo status e codice, senza log; il resto si logga e diventa 500 senza dettagli. */
export function handleShoppingRouteError(err: unknown, tag: string): Response
// isShoppingError → errorResponse(status, err.code, message); altrimenti console.error(tag, err); return internalErrorResponse();
```

**3. `lib/shopping/service.ts`** (prima riga: `// Solo lato server: importa il DB. I componenti client usano client.ts e check-queue.ts.`).
```ts
export interface ShoppingServiceOptions {
  /** Default: singleton. */
  householdId?: string;
  /** Default: `() => new Date()`. */
  now?: () => Date;
}

/** Lista del piano (list null se non è stata creata). */
export async function getPlanShoppingList(planId: string, options?: ShoppingServiceOptions): Promise<PlanShoppingListView>

/** Crea la lista del piano o la aggiorna dal piano attuale, preservando spunte e articoli a mano. */
export async function buildPlanShoppingList(planId: string, options?: ShoppingServiceOptions): Promise<PlanShoppingListView>

/** Imposta la spunta di un articolo. */
export async function checkShoppingItem(itemId: string, checked: boolean, options?: ShoppingServiceOptions): Promise<ShoppingItemView>

/** Aggiunge un articolo a mano; se ne esiste già uno con lo stesso nome lo restituisce (created false). */
export async function addManualShoppingItem(
  planId: string,
  name: string,
  options?: ShoppingServiceOptions
): Promise<{ item: ShoppingItemView; created: boolean }>

/** Rimuove un articolo aggiunto a mano; restituisce il suo id. */
export async function removeManualShoppingItem(itemId: string, options?: ShoppingServiceOptions): Promise<string>

/** Dato iniziale della pagina Lista: piani selezionabili e piano mostrato. */
export async function getShoppingScreen(
  options?: ShoppingServiceOptions & { planId?: string }
): Promise<ShoppingScreenView>
```
Helper interni (non esportati):
- `resolveClock(options)`: `now = (options.now ?? (() => new Date()))()`; `today = todayInTimeZone(now, APP_TIME_ZONE)`; `currentWeekStart = mondayOf(today)`; restituisce `{ today, currentWeekStart }`.
- `toItemView(record: ShoppingItemRecord): ShoppingItemView`: gli stessi campi **senza** `list_id`.
- `loadOwnedPlan(executor, planId, householdId)`: `plan = await getPlanById(executor, planId)`; se `null` o `plan.household_id !== householdId` → `throw new ShoppingError('plan_not_found')`; restituisce `plan`.
- `readPlanView(executor, plan, currentWeekStart): Promise<PlanShoppingListView>`:
  1. `closed = isPlanClosed(plan, currentWeekStart)` (import da `@/lib/plans/service`);
  2. `list = await findShoppingListByPlan(executor, plan.id)`;
  3. se `list` esiste: `items = (await listShoppingItems(executor, list.id)).map(toItemView).sort(compareShoppingItemsByAisle)`; `recipes = await listRecipeRefs(executor, id distinti di tutti i recipe_ids)`;
  4. restituire
     ```ts
     {
       plan: { id: plan.id, week_start: plan.week_start, last_day: addDays(plan.week_start, 6), status: plan.status, has_list: list !== null },
       editable: !closed,
       can_build: !closed && plan.status === 'active',
       list: list === null ? null : { id: list.id, generated_at: list.generated_at.toISOString(), needs_regeneration: list.needs_regeneration, items, recipes },
     }
     ```
- `loadItemForWrite(itemId, householdId, currentWeekStart)`: `ctx = await getShoppingItemContext(db, itemId)`; `null` o `ctx.plan.household_id !== householdId` → `ShoppingError('item_not_found')`; `isPlanClosed(ctx.plan, currentWeekStart)` → `ShoppingError('plan_archived')`; restituisce `ctx`.

Funzioni esportate, passo per passo. Tutte iniziano con `household = await loadHousehold(options.householdId)` e `{ today, currentWeekStart } = resolveClock(options)`.
- **`getPlanShoppingList`**: `plan = await loadOwnedPlan(db, planId, household.id)`; `return readPlanView(db, plan, currentWeekStart)`.
- **`buildPlanShoppingList`**: dentro `db.transaction(async (tx) => { … })`, in quest'ordine:
  1. `await acquirePlanLock(tx, household.id)`;
  2. `plan = await loadOwnedPlan(tx, planId, household.id)`;
  3. `isPlanClosed(plan, currentWeekStart)` → `throw new ShoppingError('plan_archived')`;
  4. `plan.status !== 'active'` → `throw new ShoppingError('plan_not_confirmed')`;
  5. `aliases = toAliasMap(await listIngredientAliases(tx))`;
  6. `built = buildShoppingList(plan.slots.filter((slot) => slot.day >= today), aliases)`;
  7. `list = (await findShoppingListByPlan(tx, plan.id)) ?? (await insertShoppingList(tx, plan.id))`;
  8. `existing = (await listShoppingItems(tx, list.id)).filter((item) => !item.manual)`;
  9. `changes = reconcileShoppingItems(existing, built)`;
  10. `await deleteShoppingItems(tx, changes.toDelete)`;
  11. per ogni voce di `changes.toUpdate`: `await updateGeneratedShoppingItem(tx, id, { qty: item.qty, category: item.category, checked, recipe_ids: item.recipe_ids })`;
  12. `await insertShoppingItems(tx, list.id, changes.toInsert.map((item) => ({ ...item, checked: false, manual: false })))`;
  13. `await markShoppingListGenerated(tx, list.id)`.

  Dopo la transazione: `return getPlanShoppingList(planId, options)`. Gli articoli a mano non vengono mai letti né scritti da questi passi. Nessuna chiamata LLM, nessuna scrittura su `meal_plans` o `plan_slots`.
- **`checkShoppingItem`**: `await loadItemForWrite(itemId, household.id, currentWeekStart)`; `updated = await setShoppingItemChecked(db, itemId, checked)`; `null` → `ShoppingError('item_not_found')` (rimosso nel frattempo); `return toItemView(updated)`.
- **`addManualShoppingItem`**:
  1. `plan = await loadOwnedPlan(db, planId, household.id)`; chiuso → `plan_archived`;
  2. `list = await findShoppingListByPlan(db, plan.id)`; `null` → `ShoppingError('list_not_found')`;
  3. `canonical = normalizeCanonicalName(name)`; se `canonical === ''` o `canonical.length > SHOPPING_ITEM_NAME_MAX` → `throw new RangeError('nome articolo non valido')` (la rotta lo impedisce a monte con lo schema);
  4. `existing = await findManualShoppingItem(db, list.id, canonical)`; se c'è → `return { item: toItemView(existing), created: false }`;
  5. `aliases = toAliasMap(await listIngredientAliases(db))`; `category = inferShoppingCategory(canonical, await listRecipes({ household_id: household.id }), aliases)`;
  6. `[inserted] = await insertShoppingItems(db, list.id, [{ canonical_name: canonical, qty: null, unit: null, category, checked: false, manual: true, recipe_ids: [] }])`; `return { item: toItemView(inserted), created: true }`.

  Il nome salvato è `canonical` così com'è: **non** si sostituisce con l'alias risolto (l'alias serve solo a dedurre il reparto).
- **`removeManualShoppingItem`**: `ctx = await loadItemForWrite(…)`; `!ctx.item.manual` → `ShoppingError('item_not_manual')`; `await deleteShoppingItems(db, [itemId])`; `return itemId`.
- **`getShoppingScreen`**:
  1. `rows = await listOpenPlans(db, household.id, currentWeekStart)`;
  2. `plans: ShoppingPlanRef[] = rows.filter((row) => row.status === 'active').map((row) => ({ id: row.id, week_start: row.week_start, last_day: addDays(row.week_start, 6), status: row.status, has_list: row.has_list }))`;
  3. piano richiesto: se `options.planId` è definito **e** `z.string().uuid().safeParse(options.planId).success`, leggere `getPlanById(db, options.planId)`; vale solo se esiste e `household_id === household.id` (qualunque sia il suo stato: bozza, confermato, chiuso). In ogni altro caso si ignora, senza errori;
  4. `selectedId = idDelPianoRichiesto ?? pickDefaultShoppingPlan(plans)`;
  5. `selected = selectedId === null ? null : await getPlanShoppingList(selectedId, options)`;
  6. `return { plans, selected }`.

**4. Rotte.** Tutte con `export const runtime = 'nodejs'` e `export const dynamic = 'force-dynamic'`; `const UuidSchema = z.string().uuid()`; ogni chiamata al servizio in `try/catch` → `handleShoppingRouteError(err, TAG)`.

| File · metodo | Ingresso | Risposta |
|---|---|---|
| `app/api/plans/[id]/shopping-list/route.ts` · `GET` | `id` non UUID → `handleShoppingRouteError(new ShoppingError('plan_not_found'), TAG)` | `200` `PlanShoppingListView` da `getPlanShoppingList(id)` |
| stesso file · `POST` | come sopra; il body non si legge | `200` `PlanShoppingListView` da `buildPlanShoppingList(id)` |
| `app/api/plans/[id]/shopping-list/items/route.ts` · `POST` | `id` non UUID → `plan_not_found`; `readJsonBody(request, { allowEmpty: false })` fallito → `invalidRequestResponse()`; `AddShoppingItemRequestSchema.safeParse` fallito → `invalidRequestResponse(issues)` | `{ item }` da `addManualShoppingItem(id, parsed.data.name)`: status `201` se `created`, `200` altrimenti |
| `app/api/shopping-items/[id]/route.ts` · `PATCH` | `id` non UUID → `item_not_found`; body come sopra con `UpdateShoppingItemRequestSchema` | `200` `{ item }` da `checkShoppingItem(id, parsed.data.checked)` |
| stesso file · `DELETE` | `id` non UUID → `item_not_found` | `200` `{ id }` da `removeManualShoppingItem(id)` |

`TAG`: `'[api/plans/shopping-list]'`, `'[api/plans/shopping-list/items]'`, `'[api/shopping-items]'`.

**5. `docs/ARCHITECTURE.md`.**
- §4.2, blocco `shopping_items`: sostituire la riga `canonical_name text, qty numeric null, unit text, category text,` con `canonical_name text, qty numeric null, unit text null, category text,   -- unit null = articolo aggiunto a mano`.
- §5.5: sostituire **tutta** la sezione (dal titolo fino alla riga dei "Casi limite", compresa) con:
  ```markdown
  ### 5.5 Consolidamento lista della spesa

  Funzione pura `buildShoppingList(slots, aliases) → items` (`lib/domain/shopping-list.ts`). La lista copre i pasti **da oggi in poi** del piano confermato:

  1. **Scala** le quantità di ogni ricetta: `qty × servings_slot / servings_base`
  2. **Risolve gli alias** via `ingredient_aliases` (un solo passo) e **aggrega** per chiave `(canonical_name, unit)` sommando le quantità; gli item senza quantità (`qb`) si uniscono in una riga sola, che sparisce se lo stesso nome ha anche una riga con quantità
  3. **Arrotonda** per eccesso: `pz` → intero; `g` e `ml` → multipli di 10 (fino a 10 → intero)
  4. **Raggruppa** per `category` (decisa per nome, a maggioranza tra le ricette che lo usano) nell'ordine tipico del giro al supermercato: ortofrutta → pane → macelleria → pescheria → banco-frigo → dispensa → surgelati → bevande → altro
  5. Mantiene `recipe_ids` per item (sotto il nome: "Per: X, Y")

  **Creazione e aggiornamento.** Solo per piani confermati e non chiusi, in una transazione sotto il lock del piano. L'aggiornamento riconcilia per `(canonical_name, unit)`: le righe che restano tengono il loro id; la spunta resta se la quantità non aumenta (per `qb` resta sempre); gli articoli aggiunti a mano non si toccano; `needs_regeneration` torna `false`.

  **Articoli a mano.** Solo il nome (normalizzato, senza risolvere l'alias); il reparto si deduce dalla libreria (stesso nome, alias risolti), altrimenti `altro`; `unit` e `qty` restano `null`.

  **Spunte senza rete.** La spunta è un valore assoluto (`PATCH { checked }`): il client la applica subito, la tiene in una coda salvata in `localStorage` e la ritenta finché il server risponde.

  **Alias.** Si risolvono solo qui: ricette, preferenze ingrediente e planner continuano a confrontare il nome canonico esatto (§5.4).

  Casi limite accettati in v1: unità eterogenee per lo stesso ingrediente (es. "pz" e "g" di limone) restano su due righe; la tabella alias riduce il fenomeno nel tempo.
  ```
- §6: sostituire le tre righe della tabella che riguardano la lista (`POST /api/plans/:id/shopping-list`, `GET /api/plans/:id/shopping-list`, `PATCH /api/shopping-items/:id`) con queste cinque:
  ```markdown
  | POST | `/api/plans/:id/shopping-list` | Crea o aggiorna la lista dal piano (solo piani confermati e non chiusi); preserva spunte e articoli a mano |
  | GET | `/api/plans/:id/shopping-list` | Lista del piano (`list: null` se non è stata creata) |
  | POST | `/api/plans/:id/shopping-list/items` | Aggiunge un articolo a mano (`{ name }`); idempotente sul nome |
  | PATCH | `/api/shopping-items/:id` | Spunta o toglie la spunta (`{ checked }`) |
  | DELETE | `/api/shopping-items/:id` | Rimuove un articolo aggiunto a mano |
  ```
  e aggiungere in fondo al paragrafo che inizia con "Tutte le request/response validate": ` Le liste dei piani chiusi sono in sola lettura (`409 plan_archived` su spunta, aggiunta, rimozione e aggiornamento); la lista di una bozza non si può creare (`409 plan_not_confirmed`).`

**6. Test.**
- `tests/shopping/service.test.ts` (DB). Costanti: `WED = () => new Date('2026-09-30T10:00:00Z')` (oggi 30/09, settimana del 28/09), `SAT = () => new Date('2026-10-03T09:00:00Z')`, `MON2 = () => new Date('2026-10-05T08:00:00Z')`. Helper locale `activePlan(householdId, weekStart, slots)`: `insertPlan` + `insertSlots` (ogni slot `{ day, meal: 'cena', recipe_id, servings, locked: false }`) + `activateDraftPlan`; restituisce l'id del piano (gli id degli slot si leggono poi con `getPlanById(db, planId)`). Le ricette si creano con `insertTestRecipe(householdId, { meal_types: ['cena'], ingredients: […] })` (`servings_base` 2). Tutte le chiamate al servizio passano `{ householdId, now }`.
  1. **creazione**: ricetta A (`petto di pollo` 200 g `macelleria`, `sale` qb `dispensa`), ricetta B (`petto di pollo` 150 g `macelleria`, `cipolla` 1 pz `ortofrutta`); slot `2026-09-30` → A e `2026-10-01` → B, entrambi `servings: 4`; `buildPlanShoppingList(planId, { householdId, now: WED })` → `list.items` nell'ordine: `cipolla` `2 pz` `ortofrutta`; `petto di pollo` `700 g` `macelleria` con `recipe_ids` = id di A e B in ordine crescente; `sale` `qty null` `unit 'qb'` `dispensa`. Tutti `checked: false`, `manual: false`. `list.needs_regeneration === false`, `plan.has_list === true`, `can_build === true`, `editable === true`, `list.recipes` contiene i titoli di A e B;
  2. **pasti passati esclusi**: uno slot in più il `2026-09-29` con una ricetta C (`zucca` 500 g `ortofrutta`) → con `now: WED` nessun articolo `zucca`;
  3. **bozza**: piano non attivato → `buildPlanShoppingList` rigetta con `ShoppingError` di codice `plan_not_confirmed` e `findShoppingListByPlan(db, planId)` resta `null`; `getPlanShoppingList` → `list: null`, `can_build: false`, `editable: true`;
  4. **piano chiuso**: lista creata con `now: WED`, poi con `now: MON2`: `buildPlanShoppingList` → `plan_archived`; `getPlanShoppingList` → `editable: false`, `can_build: false`, `list` presente;
  5. **piano di un altro household o id inesistente** (`crypto.randomUUID()`) → `plan_not_found` da `getPlanShoppingList` e da `buildPlanShoppingList`;
  6. **aggiornamento che preserva**: dopo il caso 1 spuntare `petto di pollo` e `sale` con `checkShoppingItem`, aggiungere `latte` con `addManualShoppingItem` e spuntarlo; poi `updateSlotRecipe(db, slotIdDiB, idRicettaD)` con D (`petto di pollo` 400 g `macelleria`) e `markShoppingListStale(db, planId)`; `getPlanShoppingList` → `needs_regeneration: true`; `buildPlanShoppingList` → `petto di pollo` vale `1200 g`, ha **lo stesso id** di prima ed è `checked: false` (la quantità è aumentata); `sale` resta `checked: true`; `cipolla` non c'è più; `latte` c'è ancora, `manual: true`, `checked: true`, stesso id; `needs_regeneration: false`;
  7. **spunta conservata se la quantità non aumenta**: dopo il caso 1 spuntare `petto di pollo`, portare a 2 le porzioni di uno slot (`updateSlotsServings(db, [slotId], 2)`), ricostruire → `petto di pollo` meno di 700 g e ancora `checked: true`;
  8. **alias**: inserire in `ingredient_aliases` una voce con nomi unici (`` `alias-test-${uuid}` `` → `` `canonico-test-${uuid}` ``, eliminata in `afterEach`); ricette con i due nomi (100 g ciascuna, `dispensa`), slot con `servings: 2` → una sola riga con il nome canonico e `200 g`;
  9. **spunta**: `checkShoppingItem(id, true, …)` → `checked: true` anche rileggendo; `false` la toglie; id inesistente → `item_not_found`; articolo di un altro household → `item_not_found`; con `now: MON2` → `plan_archived`;
  10. **articolo a mano**: libreria con una ricetta che contiene `latte intero` (`banco-frigo`); `addManualShoppingItem(planId, '  Latte   Intero ', …)` → `created: true`, `canonical_name: 'latte intero'`, `category: 'banco-frigo'`, `manual: true`, `unit: null`, `qty: null`, `recipe_ids: []`; stessa chiamata di nuovo → `created: false` e lo stesso id; un nome mai visto → `category: 'altro'`; piano senza lista → `list_not_found`; con `now: MON2` → `plan_archived`; piano di un altro household → `plan_not_found`;
  11. **rimozione**: articolo a mano → sparisce e la funzione restituisce il suo id; articolo generato → `item_not_manual` e l'articolo resta; id inesistente → `item_not_found`;
  12. **schermata**: household senza piani → `{ plans: [], selected: null }`; con `now: WED` e un piano confermato senza lista → `plans` ha quel piano (`has_list: false`) e `selected.plan.id` è il suo, `selected.list === null`; con `now: SAT`, piano confermato del `2026-09-28` **con** lista e piano confermato del `2026-10-05` **senza** → `selected` è quello del 28/09 e `plans` li contiene entrambi in ordine; dopo aver creato anche la lista del 05/10 → `selected` è quello del 05/10; `planId` di una bozza → `selected.plan.id` è la bozza (`can_build: false`) e `plans` non la contiene; `planId: 'abc'` e `planId` inesistente → come senza `planId`; un piano del `2026-09-21` non compare in `plans` con `now: WED`;
  13. **due costruzioni insieme**: `await Promise.all([buildPlanShoppingList(…), buildPlanShoppingList(…)])` non fallisce e la lista ha gli stessi articoli del caso 1, senza doppioni.
- `tests/api/shopping-list.test.ts` (`vi.mock('@/lib/shopping/service', …)` con le sei funzioni finte): `runtime` e `dynamic` esportati da entrambi i file; `GET` → 200 con il valore del servizio; id `abc` → `404 plan_not_found` senza chiamare il servizio; `ShoppingError('plan_not_found')` dal servizio → 404 con messaggio `Piano non trovato.`; errore generico → `500 internal_error` senza il messaggio originale; `POST` → 200; `plan_not_confirmed` → 409 con il suo messaggio; `plan_archived` → 409. `POST …/items`: `{ name: 'latte' }` con `created: true` → **201** e `{ item }`; `created: false` → **200**; servizio chiamato con `(id, 'latte')` anche se il body è `{ name: '  latte ' }`; body vuoto → 400; `{}` → 400 con `details`; nome di 81 caratteri → 400; campo in più → 400; `list_not_found` → 404.
- `tests/api/shopping-items.test.ts`: `PATCH` con `{ checked: true }` → 200 `{ item }` e servizio chiamato con `(id, true)`; body vuoto → 400; `{ checked: 'si' }` → 400; id non UUID → `404 item_not_found` senza chiamare il servizio; `item_not_found` dal servizio → 404; `plan_archived` → 409; errore generico → 500. `DELETE` → 200 `{ id }`; `item_not_manual` → 409 con messaggio `Si possono rimuovere solo gli articoli aggiunti a mano.`; id non UUID → 404. Per ogni codice di `SHOPPING_ERROR_CODES` lo status della risposta è quello di `SHOPPING_ERROR_HTTP`.

### Contratti esposti
- `ShoppingError`, `isShoppingError`, `SHOPPING_ERROR_CODES`, `SHOPPING_ERROR_HTTP`, `handleShoppingRouteError`.
- Le sei funzioni del servizio. WP6 usa `getShoppingScreen`.
- Le cinque rotte della tabella (consumate dal client di WP4).

### Dipendenze
- **WP1**: tipi, `toAliasMap`, `buildShoppingList`, `reconcileShoppingItems`, `inferShoppingCategory`, `compareShoppingItemsByAisle`, `pickDefaultShoppingPlan`, `SHOPPING_ITEM_NAME_MAX`.
- **WP2**: tutte le funzioni di `shopping-repo.ts`.

### Criteri di accettazione
- I 13 scenari del servizio sono verdi sul DB reale.
- L'aggiornamento preserva le spunte per `(canonical_name, unit)` e gli articoli a mano, e azzera `needs_regeneration` (S4.2).
- Tutte le risposte d'errore hanno la forma `{ error: { code, message, details? } }`.
- `lib/shopping/service.ts` non importa da `lib/llm/` né da `lib/recipes/`.

### Fuori ambito
UI e client. Modifiche a `lib/plans/`, `lib/db/schema.ts`, `plan-repo.ts`. Modifica del nome o della quantità di un articolo. Coda lato server. Creazione automatica della lista alla conferma del piano.

---

## WP4 — Client fetch e coda delle spunte (wave 2, parallelo a WP3 e WP5)

**Obiettivo:** dare alla UI le funzioni per chiamare le cinque rotte e una coda che fa arrivare al server ogni spunta, anche se la rete manca per un po'.

### File
- `lib/shopping/client.ts`, `lib/shopping/check-queue.ts` — nuovi
- `tests/shopping/client.test.ts`, `tests/shopping/check-queue.test.ts` — nuovi

### Pattern di riferimento
- Client fetch: `lib/prefs/client.ts` (si lancia `ApiRequestError` così com'è); test: `tests/plans/client.test.ts` (`vi.stubGlobal('fetch', …)`).
- Attesa crescente tra i tentativi: `recoveryDelayMs` in `components/plan/plan-screen.tsx`.

### Passi

**1. `lib/shopping/client.ts`** (prime righe: `// Funzioni client per le API della lista della spesa. Importabile dai componenti "use client".` e `// In caso di errore lanciano ApiRequestError (lib/http/client.ts).`):
```ts
/** GET /api/plans/{planId}/shopping-list */
export function fetchPlanShoppingList(planId: string): Promise<PlanShoppingListView>
// requestJson(listPath(planId), { method: 'GET' }, PlanShoppingListViewSchema)

/** POST /api/plans/{planId}/shopping-list — crea la lista o la aggiorna dal piano. */
export function requestBuildShoppingList(planId: string): Promise<PlanShoppingListView>
// requestJson(listPath(planId), { method: 'POST' }, PlanShoppingListViewSchema)

/** PATCH /api/shopping-items/{itemId} — restituisce l'articolo salvato. */
export async function patchShoppingItem(itemId: string, checked: boolean): Promise<ShoppingItemView>
// (await requestJson(itemPath(itemId), { method: 'PATCH', body: JSON.stringify({ checked }) }, ShoppingItemResultSchema)).item

/** POST /api/plans/{planId}/shopping-list/items — restituisce l'articolo (nuovo o già presente). */
export async function postShoppingItem(planId: string, name: string): Promise<ShoppingItemView>
// (await requestJson(`${listPath(planId)}/items`, { method: 'POST', body: JSON.stringify({ name }) }, ShoppingItemResultSchema)).item

/** DELETE /api/shopping-items/{itemId} */
export async function deleteShoppingItem(itemId: string): Promise<void>
// await requestJson(itemPath(itemId), { method: 'DELETE' }, DeleteShoppingItemResultSchema)
```
con `listPath(planId) = \`/api/plans/${encodeURIComponent(planId)}/shopping-list\`` e `itemPath(itemId) = \`/api/shopping-items/${encodeURIComponent(itemId)}\`` (funzioni interne).

**2. `lib/shopping/check-queue.ts`** (nessun import da React, dal DB o da `next/*`). Scrivere il file così:
```ts
// Coda delle spunte della lista della spesa. Importabile dai componenti "use client".
// Tiene solo l'ultimo stato voluto per articolo, manda una richiesta alla volta per articolo
// e ritenta da sola finché il server risponde.

import { z } from 'zod';
import { ApiRequestError } from '@/lib/http/client';

export const CHECK_RETRY_FIRST_DELAY_MS = 2_000;
export const CHECK_RETRY_MAX_DELAY_MS = 30_000;

const STORAGE_PREFIX = 'mealy:shopping:pending:';
const PendingSchema = z.record(z.string().uuid(), z.boolean());

const HTTP_REQUEST_TIMEOUT = 408;
const HTTP_TOO_MANY_REQUESTS = 429;

export interface CheckQueueStorage {
  load(): Record<string, boolean>;
  save(pending: Record<string, boolean>): void;
}

export interface CheckQueueState {
  /** Stati voluti non ancora confermati dal server: id articolo → spuntato. */
  pending: ReadonlyMap<string, boolean>;
  /** true dopo un invio fallito per la rete, finché un invio riesce o la coda si svuota. */
  stalled: boolean;
}

export interface CheckQueueOptions {
  /** Manda lo stato al server; rigetta con ApiRequestError. */
  send: (itemId: string, checked: boolean) => Promise<void>;
  storage: CheckQueueStorage;
  /** Dopo ogni cambiamento di `pending` o di `stalled`. */
  onChange?: (state: CheckQueueState) => void;
  /** Errore definitivo: la spunta è stata tolta dalla coda senza essere applicata. */
  onDropped?: (itemId: string, error: unknown) => void;
}

export type CheckSendOutcome = 'done' | 'retry' | 'drop';

/** Come trattare un invio fallito. */
export function classifyCheckError(err: unknown): CheckSendOutcome {
  if (!(err instanceof ApiRequestError)) return 'retry';
  const { status } = err;
  // Risposta 2xx non leggibile: il server ha comunque applicato la spunta.
  if (status >= 200 && status < 300) return 'done';
  if (
    status === 0 ||
    status === HTTP_REQUEST_TIMEOUT ||
    status === HTTP_TOO_MANY_REQUESTS ||
    status >= 500
  ) {
    return 'retry';
  }
  return 'drop';
}

/** Coda salvata in localStorage, una chiave per piano. Non lancia mai. */
export function createLocalCheckStorage(planId: string): CheckQueueStorage {
  const key = `${STORAGE_PREFIX}${planId}`;
  return {
    load() {
      try {
        const raw = window.localStorage.getItem(key);
        if (raw === null) return {};
        const parsed = PendingSchema.safeParse(JSON.parse(raw));
        return parsed.success ? parsed.data : {};
      } catch {
        return {};
      }
    },
    save(pending) {
      try {
        if (Object.keys(pending).length === 0) window.localStorage.removeItem(key);
        else window.localStorage.setItem(key, JSON.stringify(pending));
      } catch {
        // Storage non disponibile (es. navigazione privata): la coda resta in memoria.
      }
    },
  };
}

/** Storage in memoria (test e ambienti senza localStorage). */
export function createMemoryCheckStorage(initial: Record<string, boolean> = {}): CheckQueueStorage {
  let current = { ...initial };
  return {
    load: () => ({ ...current }),
    save: (pending) => {
      current = { ...pending };
    },
  };
}

export class CheckQueue {
  private readonly desired = new Map<string, boolean>();
  private readonly inFlight = new Map<string, Promise<void>>();
  private stalled = false;
  private attempt = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private disposed = false;

  constructor(private readonly options: CheckQueueOptions) {
    for (const [itemId, checked] of Object.entries(options.storage.load())) {
      this.desired.set(itemId, checked);
    }
  }

  get state(): CheckQueueState {
    return { pending: new Map(this.desired), stalled: this.stalled };
  }

  /** Registra lo stato voluto e prova subito a mandarlo. */
  enqueue(itemId: string, checked: boolean): void {
    if (this.disposed) return;
    this.desired.set(itemId, checked);
    this.persist();
    this.notify();
    void this.pump(itemId);
  }

  /** Prova a mandare ora tutto ciò che è in coda; si risolve quando gli invii in corso sono finiti. */
  async flush(): Promise<void> {
    this.clearTimer();
    await Promise.all([...this.desired.keys()].map((itemId) => this.pump(itemId)));
  }

  /** Ferma i ritentativi (smontaggio del componente). */
  dispose(): void {
    this.disposed = true;
    this.clearTimer();
  }

  private pump(itemId: string): Promise<void> {
    const running = this.inFlight.get(itemId);
    if (running) return running;
    if (this.disposed || !this.desired.has(itemId)) return Promise.resolve();
    const run = this.sendLatest(itemId);
    this.inFlight.set(itemId, run);
    return run;
  }

  /** Manda lo stato voluto e ripete finché quello mandato è ancora quello voluto. */
  private async sendLatest(itemId: string): Promise<void> {
    try {
      for (;;) {
        const value = this.desired.get(itemId);
        if (value === undefined) return;
        let outcome: CheckSendOutcome = 'done';
        let error: unknown;
        try {
          await this.options.send(itemId, value);
        } catch (err) {
          error = err;
          outcome = classifyCheckError(err);
        }
        if (this.disposed) return;
        if (outcome === 'retry') {
          this.stalled = true;
          this.notify();
          this.scheduleRetry();
          return;
        }
        if (outcome === 'drop') {
          this.desired.delete(itemId);
          this.settle();
          this.options.onDropped?.(itemId, error);
          return;
        }
        this.attempt = 0;
        this.stalled = false;
        if (this.desired.get(itemId) === value) {
          this.desired.delete(itemId);
          this.settle();
          return;
        }
        // Nel frattempo l'utente ha toccato di nuovo: si manda il valore più recente.
        this.notify();
      }
    } finally {
      this.inFlight.delete(itemId);
    }
  }

  private settle(): void {
    if (this.desired.size === 0) this.stalled = false;
    this.persist();
    this.notify();
  }

  private scheduleRetry(): void {
    if (this.timer !== null || this.disposed) return;
    this.attempt += 1;
    const delay = Math.min(
      CHECK_RETRY_FIRST_DELAY_MS * 2 ** (this.attempt - 1),
      CHECK_RETRY_MAX_DELAY_MS
    );
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.flush();
    }, delay);
  }

  private clearTimer(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  private persist(): void {
    this.options.storage.save(Object.fromEntries(this.desired));
  }

  private notify(): void {
    this.options.onChange?.(this.state);
  }
}
```
Il codice sopra **è** il contratto: se in implementazione serve cambiarne una riga (per esempio per una regola di lint), il comportamento descritto dai test del passo 3 deve restare identico. Il costruttore **non** manda nulla: è chi crea la coda a chiamare `flush()`.

**3. Test.**
- `tests/shopping/client.test.ts` (`fetch` finto): per ognuna delle cinque funzioni URL, metodo e body; `encodeURIComponent` sugli id; `patchShoppingItem` e `postShoppingItem` restituiscono l'oggetto `item`; `postShoppingItem` accetta una risposta `201`; `deleteShoppingItem` si risolve con `undefined`; risposta `409` con `{ error: { code: 'plan_archived', message: '…' } }` → `ApiRequestError` con quel `code` e quel `message`; `fetch` che rigetta → `ApiRequestError` con `status 0` e `code 'network_error'`.
- `tests/shopping/check-queue.test.ts` (id articolo: UUID fissi; `send` è un `vi.fn` che restituisce promesse controllate dal test; `vi.useFakeTimers()` dove servono i ritentativi; storage: `createMemoryCheckStorage()` salvo dove indicato):
  1. `enqueue(id, true)` chiama subito `send(id, true)`; prima della risposta `state.pending` contiene `id → true`, `stalled` è `false` e lo storage contiene `{ [id]: true }`; dopo la risposta `pending` è vuoto e lo storage è `{}`;
  2. **un solo invio per volta**: `enqueue(id, true)` e, mentre è in corso, `enqueue(id, false)` → `send` chiamata una sola volta; quando la prima si risolve parte `send(id, false)`; in totale due chiamate, in quest'ordine;
  3. **solo l'ultimo stato**: `true`, `false`, `true` mentre la prima è in corso → una sola chiamata (`true`), poi coda vuota;
  4. articoli diversi partono in parallelo (due chiamate a `send` prima che una si risolva);
  5. **rete assente** (`new ApiRequestError(0, 'network_error', 'Connessione non disponibile.')`): `pending` resta, `stalled` diventa `true`, `onChange` viene chiamata, `onDropped` no; dopo `2000` ms riparte `send`; se fallisce ancora il tentativo successivo parte dopo `4000` ms, poi `8000`, `16000` e, dal quinto fallimento consecutivo in poi, `30000` ms (tetto); quando un invio riesce `stalled` torna `false`, `pending` si svuota, e un fallimento successivo riparte da `2000` ms;
  6. **errore definitivo** (`ApiRequestError(404, 'item_not_found', …)` e `ApiRequestError(409, 'plan_archived', …)`): l'articolo esce da `pending`, `onDropped(id, errore)` viene chiamata, nessun timer resta attivo (`vi.getTimerCount() === 0`), lo storage è `{}`;
  7. `ApiRequestError(200, 'invalid_response', …)` → trattata come riuscita (coda vuota, `onDropped` non chiamata);
  8. un errore che non è `ApiRequestError` (`new Error('boom')`) → ritentato come la rete assente;
  9. `flush()` con un invio in corso si risolve **solo dopo** che quell'invio è finito; `flush()` durante l'attesa di un ritentativo annulla il timer e rimanda subito;
  10. **ripristino**: `new CheckQueue({ storage: createMemoryCheckStorage({ [id]: true }), … })` → `state.pending` contiene l'articolo e `send` non è stata chiamata; dopo `flush()` sì;
  11. `dispose()` annulla il timer; un `enqueue` successivo non fa nulla; un invio che si risolve dopo `dispose()` non chiama `onChange`;
  12. `classifyCheckError`: `0`, `408`, `429`, `500`, `503` → `'retry'`; `400`, `404`, `409`, `422` → `'drop'`; `200` → `'done'`; `new Error('x')` → `'retry'`;
  13. `createLocalCheckStorage('<planId>')`: `save` poi `load` restituisce lo stesso oggetto, sotto la chiave `mealy:shopping:pending:<planId>`; `save({})` rimuove la chiave; JSON non valido o di forma sbagliata (`'{"a":1}'`, `'boh'`) → `load()` dà `{}`; se `Storage.prototype.getItem` / `setItem` lanciano (spiati con `vi.spyOn`), `load()` dà `{}` e `save()` non lancia.

### Contratti esposti
Le cinque funzioni del client; `CheckQueue`, `CheckQueueState`, `CheckQueueStorage`, `CheckQueueOptions`, `createLocalCheckStorage`, `createMemoryCheckStorage`, `classifyCheckError`, le due costanti di attesa. WP6 usa tutto; WP7 usa `requestBuildShoppingList`.

### Dipendenze
- **WP1**: `PlanShoppingListViewSchema`, `ShoppingItemResultSchema`, `DeleteShoppingItemResultSchema` e i relativi tipi.

### Criteri di accettazione
- Due tocchi rapidi sullo stesso articolo non producono mai due richieste contemporanee né un ordine sbagliato (test 2 e 3).
- Senza rete la spunta resta in coda, salvata nello storage, e parte da sola (test 5, 10, 13).
- I due file non importano da `lib/db`, `lib/shopping/service`, `react`, `next/*`.

### Fuori ambito
Componenti React. Coda per aggiunta e rimozione degli articoli a mano (requirements P12). Service worker, `navigator.onLine`, sincronizzazione in background.

---

## WP5 — Mattoni UI: riga e pannello di aggiunta (wave 2, parallelo a WP3 e WP4)

**Obiettivo:** preparare i due componenti presentazionali della schermata: la riga dell'articolo (con seconda riga, sola lettura e rimozione) e il pannello per aggiungere un articolo a mano.

### File
- `components/shopping/shopping-item-row.tsx` — **modifica** (solo aggiunte compatibili)
- `components/shopping/add-item-sheet.tsx` — nuovo
- `tests/ui/shopping-item-row.test.tsx`, `tests/ui/add-item-sheet.test.tsx` — nuovi

### Pattern di riferimento
- Pannello dal basso: `components/ui/sheet.tsx`, usato in `components/sheets/recipe-sheet.tsx`.
- Pulsante di rimozione a 44 px con `aria-label`: `components/settings/ingredient-prefs-section.tsx`.

### Vincolo di compatibilità
`app/(app)/lista/page.tsx` (pagina finta, sostituita in wave 3) e `tests/ui/shell.test.tsx` usano `ShoppingItemRow` e il tipo `ShoppingItem` di oggi e **non si toccano in questo WP**: devono continuare a compilare e a passare. Quindi nessun campo o parametro esistente cambia nome, tipo o obbligatorietà; l'elemento con `role="checkbox"` resta, con la classe `min-h-[52px]` e `aria-checked`; lo `<span>` del nome resta un elemento a sé con le classi attuali (`line-through text-stone` quando spuntato).

### Passi

**1. `components/shopping/shopping-item-row.tsx`.**
```ts
export interface ShoppingItem {
  id: string;
  name: string;
  amount?: number;
  unit?: string;
  category?: string;
  isChecked: boolean;
  /** Quantità già formattata (es. "1,25 kg"). Se definita, anche vuota, sostituisce amount/unit. */
  quantityLabel?: string;
  /** Seconda riga sotto il nome (es. "Per: Pasta al pomodoro"). */
  detail?: string;
}

export interface ShoppingItemRowProps {
  item: ShoppingItem;
  onToggle: (id: string) => void;
  className?: string;
  /** Sola lettura: la riga non risponde a tap e tastiera. */
  disabled?: boolean;
  /** Se presente, accanto alla riga compare il pulsante di rimozione. */
  onRemove?: (id: string) => void;
}
```
Markup (un pulsante **non** può stare dentro l'elemento `role="checkbox"`: il pulsante di rimozione è un fratello):
```tsx
<div className="flex items-center">
  <div
    role="checkbox"
    aria-checked={item.isChecked}
    aria-disabled={disabled ? true : undefined}
    tabIndex={0}
    onClick={handleClick}
    onKeyDown={handleKeyDown}
    className={cn(
      "group flex min-h-[52px] min-w-0 flex-1 cursor-pointer items-center justify-between rounded-xl px-2 py-1 transition-colors hover:bg-stone/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-basil select-none",
      item.isChecked && "opacity-60",
      disabled && "cursor-default hover:bg-transparent",
      className
    )}
  >
    {/* sinistra: quadratino 44×44 come oggi, poi nome e dettaglio */}
    {/* destra: quantità */}
  </div>
  {onRemove && (
    <button
      type="button"
      aria-label={`Rimuovi ${item.name}`}
      onClick={() => onRemove(item.id)}
      className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-stone transition-colors hover:bg-stone/15 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-basil"
    >
      <X className="h-4 w-4" aria-hidden="true" />
    </button>
  )}
</div>
```
- Rispetto a oggi la classe `w-full` della riga diventa `min-w-0 flex-1`; il resto delle classi resta.
- Nome e dettaglio: il quadratino resta com'è; accanto, un contenitore `<span className="flex min-w-0 flex-col">` con lo `<span>` del nome (classi di oggi, compreso `truncate`) e, **solo se** `item.detail` è una stringa non vuota, `<span className="truncate text-xs text-stone">{item.detail}</span>`.
- Quantità: `const quantity = item.quantityLabel !== undefined ? item.quantityLabel : <testo di oggi da amount e unit>`. Con `quantityLabel` definita lo `<span>` della quantità si mostra solo se `quantityLabel.trim() !== ''`; senza `quantityLabel` vale la condizione di oggi (`item.amount !== undefined || item.unit`) e il contenuto di oggi, invariati.
- `disabled`: `handleClick` e `handleKeyDown` non chiamano `onToggle` (per i tasti Spazio e Invio si chiama comunque `preventDefault`).

**2. `components/shopping/add-item-sheet.tsx`** (`"use client"`):
```ts
export interface AddShoppingItemSheetProps {
  open: boolean;
  onClose: () => void;
  /**
   * Aggiunge l'articolo. Si risolve con l'etichetta da confermare (es. "Latte");
   * rigetta con un errore il cui messaggio si può mostrare.
   */
  onAdd: (name: string) => Promise<string>;
}
export function AddShoppingItemSheet(props: AddShoppingItemSheetProps): React.JSX.Element
```
- Struttura: `<Sheet open={open} onOpenChange={(next) => { if (!next) onClose(); }}>` → `<SheetContent side="bottom">` → `<SheetHeader><SheetTitle>Aggiungi alla lista</SheetTitle></SheetHeader>` → `<form>`.
- Form: `<label htmlFor="shopping-add-input" className="block text-xs font-bold uppercase tracking-wider text-stone">Cosa manca?</label>`; `<input id="shopping-add-input" type="text" autoFocus autoComplete="off" enterKeyHint="done" maxLength={SHOPPING_ITEM_NAME_MAX} placeholder="Es. latte, carta forno…">` con classi `min-h-[44px] w-full rounded-xl border border-stone/30 bg-white px-3 py-2 text-base text-ink placeholder:text-stone/60 focus:border-basil focus:outline-none focus:ring-1 focus:ring-basil` (`text-base` = 16 px: evita lo zoom automatico di iOS); `<Button type="submit" disabled={saving || name.trim() === ""}>Aggiungi</Button>`.
- Stato locale: `name`, `saving`, `added: string | null`, `error: string | null`. Un ref sull'input.
- Invio: `trimmed = name.trim()`; se vuoto o `saving` → nulla. `setSaving(true)`, `setError(null)`; `label = await onAdd(trimmed)` → `setAdded(label)`, `setName("")`, riportare il focus sull'input; in `catch` → `setError(apiErrorMessage(err))` (da `@/lib/http/client`) e il testo scritto resta; in `finally` `setSaving(false)`. **Il pannello resta aperto** dopo un'aggiunta riuscita, così se ne possono inserire più di fila.
- Sotto il form, sempre montato: `<p role="status" className="min-h-5 text-sm text-basil">{added !== null ? \`Aggiunto: ${added}\` : ""}</p>`; e, solo se `error !== null`: `<p role="alert" className="rounded-xl border border-tomato/30 bg-tomato/10 p-3 text-sm text-ink">{error}</p>`.
- Quando `open` passa da `false` a `true`: azzerare `name`, `added`, `error` (effetto con dipendenza `open`).
- `onAdd` e `onClose` vanno letti da ref aggiornati a ogni render solo se servono dentro un effetto; negli handler si usano direttamente.

**3. Test.**
- `tests/ui/shopping-item-row.test.tsx`:
  1. senza i campi nuovi la riga si comporta come oggi: `role="checkbox"`, `min-h-[52px]`, click → `onToggle(id)`, quantità `150 g` da `amount` e `unit`, nessun pulsante `Rimuovi …`;
  2. `quantityLabel: "1,25 kg"` → testo `1,25 kg` e nessun `150`; `quantityLabel: ""` con `amount: 150` → nessuna quantità mostrata;
  3. `detail: "Per: Pasta al pomodoro"` → testo presente; senza `detail` nessun elemento in più;
  4. `disabled` → `aria-disabled="true"`, click e tasto Spazio non chiamano `onToggle`;
  5. `onRemove` → pulsante `Rimuovi Latte`; il click chiama `onRemove(id)` e **non** `onToggle`; il pulsante non è discendente dell'elemento `role="checkbox"`;
  6. tasti Invio e Spazio sulla riga chiamano `onToggle`.
- `tests/ui/add-item-sheet.test.tsx`:
  1. `open: false` → nessun `dialog`; `open: true` → `dialog` con titolo `Aggiungi alla lista`, campo con etichetta `Cosa manca?`, pulsante `Aggiungi` disabilitato a campo vuoto e con soli spazi;
  2. scrivo ` latte ` e invio → `onAdd("latte")`; alla risoluzione con `"Latte"` compare `Aggiunto: Latte` (`role="status"`), il campo è vuoto e il pannello è ancora aperto;
  3. durante il salvataggio il pulsante è disabilitato e un secondo invio non richiama `onAdd`;
  4. `onAdd` rigetta con `new ApiRequestError(0, "network_error", "Connessione non disponibile.")` → `role="alert"` con quel testo e il campo conserva `latte`;
  5. il campo ha `maxLength` 80;
  6. il pulsante `Chiudi` e il tasto Esc chiamano `onClose`;
  7. chiuso e riaperto (prop `open` `true → false → true`): testo, conferma ed errore sono azzerati.

### Contratti esposti
- `ShoppingItemRow` con `quantityLabel`, `detail`, `disabled`, `onRemove` (tutti opzionali).
- `AddShoppingItemSheet` e `AddShoppingItemSheetProps`.

### Dipendenze
- **WP1**: `SHOPPING_ITEM_NAME_MAX`.

### Criteri di accettazione
- `tests/ui/shell.test.tsx` e `app/(app)/lista/page.tsx` non sono stati modificati e il gate è verde.
- Nessun elemento interattivo è annidato dentro l'elemento `role="checkbox"`.
- Tap target della riga ≥ 52 px e del pulsante di rimozione 44 px.

### Fuori ambito
Schermata, sezioni, avanzamento, toast (WP6). Chiamate di rete (i due componenti ricevono solo callback). Campi quantità e reparto nel pannello.

---

## WP6 — Pagina e schermata Lista (wave 3, parallelo a WP7)

**Obiettivo:** sostituire la Lista finta con quella reale: dati dal server, spunte immediate attraverso la coda, aggiornamento dal piano, articoli a mano, selettore di settimana.

### File
- `app/(app)/lista/page.tsx` — **sostituzione completa**; `app/(app)/lista/loading.tsx` — nuovo
- `components/shopping/shopping-screen.tsx` — nuovo
- `docs/DESIGN.md` — **modifica** (§4.3)
- `tests/ui/shell.test.tsx` — **modifica** (solo import e test della pagina Lista); `tests/ui/shopping-screen.test.tsx`, `tests/app/shopping-page.test.tsx` — nuovi

### Pattern di riferimento
- Pagina server con `searchParams` e `key`: `app/(app)/page.tsx`; test: `tests/app/library-page.test.tsx`.
- Riallineamento dello stato quando arrivano dati nuovi dal server (`syncedInitial…`) e guardia di smontaggio (`mountedRef`): `components/plan/plan-screen.tsx`.
- Callback tenute in un ref per non rilanciare gli effetti: `components/feedback/toast.tsx` (`onDismissRef`).
- Riquadri di avviso (zafferano) ed errore (pomodoro): `components/plan/plan-screen.tsx`.
- Test con client finti: `tests/ui/plan-screen.test.tsx` (`vi.mock` con `importOriginal`).

### Passi

**1. `app/(app)/lista/page.tsx`** (server, senza `"use client"`):
```tsx
import { connection } from "next/server";
import { ShoppingScreen } from "@/components/shopping/shopping-screen";
import { getShoppingScreen } from "@/lib/shopping/service";

interface ShoppingListPageProps {
  searchParams: Promise<{ piano?: string | string[] }>;
}

export default async function ShoppingListPage({ searchParams }: ShoppingListPageProps) {
  await connection();
  const { piano } = await searchParams;
  const planId = Array.isArray(piano) ? piano[0] : piano;
  const screen = await getShoppingScreen({ planId });
  // La key azzera lo stato locale (e la coda delle spunte) quando cambia il piano mostrato.
  return <ShoppingScreen key={screen.selected?.plan.id ?? "none"} initialScreen={screen} />;
}
```

**2. `app/(app)/lista/loading.tsx`:** `<main aria-busy="true" className="min-h-screen px-4 py-6 max-w-xl mx-auto">` con `<h1 className="font-display text-2xl font-bold text-ink">Lista della Spesa</h1>` e, in un `<div className="mt-5 space-y-2">`, 8 `<div className="h-12 rounded-xl bg-stone/15 animate-pulse motion-reduce:animate-none" />`.

**3. `components/shopping/shopping-screen.tsx`** (`"use client"`):
```ts
export interface ShoppingScreenProps {
  initialScreen: ShoppingScreenView;
}
export function ShoppingScreen(props: ShoppingScreenProps): React.JSX.Element
```
Costanti di testo:
```ts
const TOAST_CREATED = "Lista creata";
const TOAST_UPDATED = "Lista aggiornata";
const TOAST_PENDING_BLOCK = "Ci sono spunte in attesa di rete: riprova quando torna la connessione.";
const STALE_NOTICE = "Il piano è cambiato: aggiorna la lista per allinearla.";
const REBUILD_CONFIRM =
  "Aggiorno la lista dal piano di adesso? Le spunte restano dove la quantità non aumenta; gli articoli aggiunti a mano non cambiano.";
const READ_ONLY_NOTICE = "Questa settimana è conclusa: la lista si può solo consultare.";
const EMPTY_ITEMS = "Niente da comprare per i pasti che restano.";
const ALL_DONE = "Hai preso tutto.";
const MANUAL_DETAIL = "Aggiunto a mano";
const pendingLabel = (count: number) =>
  count === 1 ? "1 spunta in attesa di rete" : `${count} spunte in attesa di rete`;
const HTTP_NOT_FOUND = 404;
```

**Stato.**
- `view: PlanShoppingListView | null`, iniziale `initialScreen.selected`, con il riallineamento di `plan-screen.tsx` (`syncedInitialScreen`): se arriva una nuova prop `initialScreen` (stessa `key`), `view` diventa `initialScreen.selected`.
- `queueState: CheckQueueState`, iniziale `{ pending: new Map(), stalled: false }`.
- `toast: string | null`, `isBuilding: boolean`, `confirmingRebuild: boolean`, `addOpen: boolean`.
- `mountedRef` (come in `plan-screen.tsx`), `queueRef: React.useRef<CheckQueue | null>(null)`.
- `planId = view?.plan.id ?? null`.

**Funzioni interne.**
- `applyServerItem(item: ShoppingItemView)` (in `useCallback`, senza dipendenze): `setView((prev) => (prev && prev.list ? { ...prev, list: { ...prev.list, items: prev.list.items.map((it) => (it.id === item.id ? item : it)) } } : prev))`.
- `refresh()` (async): se `planId === null` non fa nulla; `fresh = await fetchPlanShoppingList(planId)`; se montato `setView(fresh)`; in `catch` non fa nulla (senza rete si riproverà al prossimo evento). Tenerla in un ref (`refreshRef.current = refresh` a ogni render) per usarla negli effetti.
- **Effetto della coda** (dipendenze: `planId` e `applyServerItem`, che è stabile): se `planId === null` esce. Crea
  ```ts
  const queue = new CheckQueue({
    storage: createLocalCheckStorage(planId),
    send: async (itemId, checked) => {
      applyServerItem(await patchShoppingItem(itemId, checked));
    },
    onChange: setQueueState,
    onDropped: (_itemId, err) => {
      if (!(err instanceof ApiRequestError && err.status === HTTP_NOT_FOUND)) setToast(apiErrorMessage(err));
      void refreshRef.current();
    },
  });
  queueRef.current = queue;
  setQueueState(queue.state);
  void queue.flush();
  return () => {
    queue.dispose();
    queueRef.current = null;
  };
  ```
  La coda si crea **solo** nell'effetto (mai durante il render: `localStorage` non esiste sul server).
- **Effetto di ritorno** (dipendenza: `planId`): se `planId === null` esce. Un solo handler `resync = () => { void (async () => { await queueRef.current?.flush(); await refreshRef.current(); })(); }`; registrarlo su `document` per `visibilitychange` (eseguendo `resync` solo se `document.visibilityState === "visible"`) e su `window` per `online`; rimuoverli nella pulizia.
- **Articoli mostrati** (`useMemo`): `(view?.list?.items ?? []).map((item) => (queueState.pending.has(item.id) ? { ...item, checked: queueState.pending.get(item.id) as boolean } : item))`. Da questi: `sections = groupShoppingItems(items)`, `progress = shoppingProgress(items)`, `titles = new Map(view.list.recipes.map((r) => [r.id, r.title]))`.
- `handleToggle(id)`: se `!view?.editable` non fa nulla; `current = items.find((it) => it.id === id)`; se manca non fa nulla; `queueRef.current?.enqueue(id, !current.checked)`.
- `runBuild()` (async): se `planId === null`, `!view` o `isBuilding` non fa nulla. `hadList = view.list !== null`; `setIsBuilding(true)`; `try`: `await queueRef.current?.flush()`; se `(queueRef.current?.state.pending.size ?? 0) > 0` → `setToast(TOAST_PENDING_BLOCK)` e `return`; `fresh = await requestBuildShoppingList(planId)`; se montato `setView(fresh)` e `setToast(hadList ? TOAST_UPDATED : TOAST_CREATED)`; `catch (err)` → `setToast(apiErrorMessage(err))`; `finally` (se montato) `setIsBuilding(false)` e `setConfirmingRebuild(false)`.
- `handleRebuildClick()`: se `items.some((it) => it.checked && !it.manual)` → `setConfirmingRebuild(true)`; altrimenti `void runBuild()`.
- `handleAdd(name): Promise<string>`: `item = await postShoppingItem(planId, name)` (gli errori **non** si catturano: li mostra il pannello); `setView` aggiungendo `item` a `list.items` se non c'è già un articolo con lo stesso `id`, altrimenti sostituendolo; `return shoppingItemLabel(item.canonical_name)`.
- `handleRemove(id)` (async): `removed = view.list.items.find((it) => it.id === id)`; se manca non fa nulla; togliere subito l'articolo da `view.list.items`; `try { await deleteShoppingItem(id) } catch (err)`: se `err instanceof ApiRequestError && err.status === HTTP_NOT_FOUND` non fa nulla (era già stato rimosso); altrimenti, se montato, rimettere `removed` in `list.items` (se non c'è già) e `setToast(apiErrorMessage(err))`.
- `toRow(item): ShoppingItem` (tipo di `shopping-item-row.tsx`):
  ```ts
  {
    id: item.id,
    name: shoppingItemLabel(item.canonical_name),
    isChecked: item.checked,
    quantityLabel: formatShoppingQuantity(item.qty, item.unit),
    detail: item.manual ? MANUAL_DETAIL : perLabel(item.recipe_ids),
  }
  ```
  con `perLabel(ids)`: i titoli trovati in `titles`, nell'ordine di `ids`; nessuno trovato → `undefined`; altrimenti `` `Per: ${titoli.join(", ")}` ``.

**Render**, dentro `<main className={cn("mx-auto min-h-screen max-w-xl px-4 py-6", showFab && "pb-24")}>`, in quest'ordine (`showFab = view !== null && view.list !== null && view.editable`):
1. **Intestazione** (`<header className="mb-5 flex items-start justify-between gap-3">`): a sinistra `<h1 className="font-display text-2xl font-bold text-ink">Lista della Spesa</h1>` e `<p className="mt-0.5 text-xs text-stone">` con `` `Settimana ${formatWeekRange(view.plan.week_start, view.plan.last_day)}` `` se `view` esiste, altrimenti `Consolidata dal piano settimanale`. A destra, **solo se** `view?.list` esiste, `view.can_build` è vero e `view.list.needs_regeneration` è falso: `<Button variant="outline" size="sm" onClick={handleRebuildClick} disabled={isBuilding}>` con icona `RefreshCw` (`h-4 w-4`, `aria-hidden`) e testo `Aggiorna lista`.
2. **Selettore**, solo se `initialScreen.plans.length >= 2`: `<nav aria-label="Liste della spesa" className="mb-4 flex gap-2">` con, per ogni piano, un `Link` di `next/link` verso `` `/lista?piano=${plan.id}` ``, testo `formatWeekRange(plan.week_start, plan.last_day)`, classi `flex min-h-[44px] flex-1 items-center justify-center rounded-xl border px-3 text-sm font-medium` più il focus visibile; il piano mostrato (`plan.id === planId`) ha `aria-current="page"` e `border-basil bg-basil text-paper`, gli altri `border-stone/30 text-ink hover:bg-stone/10`.
3. Se `view === null`: `<EmptyState title="Nessuna lista della spesa" description="Conferma il piano della settimana: da lì crei la lista con un tocco." actionLabel="Vai al piano" onAction={() => router.push("/")} />`.
4. Altrimenti, se `view.list === null`:
   - `view.can_build` → `<EmptyState title="Lista da creare" description={`Raccolgo gli ingredienti del piano ${range} e li ordino per reparto.`} actionLabel="Crea lista della spesa" onAction={() => void runBuild()} />` (`range` = `formatWeekRange(…)` come sopra);
   - `!view.can_build && view.editable` (bozza) → `<EmptyState title="Piano non ancora confermato" description="Conferma il piano per creare la lista della spesa." actionLabel="Vai al piano" onAction={() => router.push(`/?settimana=${view.plan.week_start}`)} />`;
   - `!view.editable` (piano chiuso) → `<EmptyState title="Nessuna lista per questa settimana" description="Questa settimana è conclusa e non aveva una lista." />`.
5. Altrimenti (la lista esiste), in quest'ordine:
   1. se `!view.editable`: `<p className="mb-4 rounded-xl border border-stone/30 bg-stone/10 p-3 text-sm text-ink">{READ_ONLY_NOTICE}</p>`;
   2. se `view.list.needs_regeneration && view.can_build`: riquadro `mb-4 flex flex-col items-start gap-2 rounded-xl border border-saffron/40 bg-saffron/10 p-3 text-sm text-ink` con `<p>{STALE_NOTICE}</p>` e `<Button size="sm" onClick={handleRebuildClick} disabled={isBuilding}>Aggiorna lista</Button>`. In ogni momento a schermo c'è **al più un** pulsante `Aggiorna lista` (questo oppure quello dell'intestazione);
   3. se `confirmingRebuild`: riquadro `mb-4 rounded-xl border border-stone/30 bg-white p-3 text-sm text-ink` con `<p>{REBUILD_CONFIRM}</p>` e due pulsanti: `<Button size="sm" onClick={() => void runBuild()} disabled={isBuilding}>Aggiorna</Button>` e `<Button size="sm" variant="ghost" onClick={() => setConfirmingRebuild(false)}>Annulla</Button>`;
   4. se `queueState.stalled && queueState.pending.size > 0`: `<p role="status" className="mb-4 rounded-xl border border-stone/30 bg-stone/10 p-3 text-sm text-ink">{pendingLabel(queueState.pending.size)}</p>`;
   5. se `progress.total > 0`: scheda `mb-5 rounded-xl border border-stone/20 bg-white p-3.5` con la riga `<span className="text-stone">Progresso spesa</span>` e `<span className="text-basil tabular-nums">{progress.checked}/{progress.total}</span>` (riga `flex items-center justify-between text-xs font-semibold mb-1.5`), e sotto la barra: `<div role="progressbar" aria-label="Articoli presi" aria-valuemin={0} aria-valuemax={progress.total} aria-valuenow={progress.checked} className="h-2 w-full overflow-hidden rounded-full bg-stone/15">` con dentro `<div className="h-full bg-basil transition-all duration-300 motion-reduce:transition-none" style={{ width: `${Math.round((progress.checked / progress.total) * 100)}%` }} />`;
   6. se `progress.total === 0`: `<p className="py-8 text-center text-sm text-stone">{EMPTY_ITEMS}</p>`;
   7. le sezioni, in `<div className="space-y-6">`: per ogni `section` una `<section key={section.category} className="space-y-1.5">` con intestazione `flex items-center justify-between px-1` (`<h2 className="font-display text-base font-bold text-ink tracking-tight">{section.label}</h2>` e `<span className="text-xs text-stone tabular-nums">{section.checked}/{section.total}</span>`) e un contenitore `divide-y divide-stone/15 rounded-xl border border-stone/20 bg-white p-1` con una `<ShoppingItemRow key={item.id} item={toRow(item)} onToggle={handleToggle} disabled={!view.editable} onRemove={item.manual && view.editable ? (id) => void handleRemove(id) : undefined} />` per articolo;
   8. se `progress.total > 0 && progress.checked === progress.total`: `<p className="mt-8 rounded-xl bg-basil/10 p-4 text-center text-sm font-semibold text-basil">{ALL_DONE}</p>`;
   9. se `showFab`: `<Button aria-label="Aggiungi un articolo alla lista" onClick={() => setAddOpen(true)} className="fixed right-4 bottom-[calc(5.5rem+env(safe-area-inset-bottom))] z-40 h-14 rounded-full px-5 text-base font-semibold shadow-lg">` con icona `Plus` (`h-5 w-5`, `aria-hidden`) e `<span>Aggiungi</span>`; e `<AddShoppingItemSheet open={addOpen} onClose={() => setAddOpen(false)} onAdd={handleAdd} />`.
6. `<Toast message={toast} onDismiss={() => setToast(null)} className={showFab ? "bottom-[calc(9.5rem+env(safe-area-inset-bottom))]" : undefined} />` (sopra il pulsante *Aggiungi*).

**4. `docs/DESIGN.md`**, §4.3: sostituire i quattro punti elenco con:
```markdown
- Legata a un piano confermato: si crea dal footer del Piano (*Crea lista della spesa*). La tab *Lista* apre l'ultima lista dei piani aperti; quando i piani aperti sono due (weekend) un selettore in alto passa da una settimana all'altra
- Sezioni per reparto nell'ordine del giro al supermercato (vedi ARCHITECTURE §5.5)
- Riga item: checkbox 44×44 px a sinistra, nome + quantità e, sotto il nome, le ricette per cui serve ("Per: …"); tap sulla riga = spunta (tutta la riga è target)
- Item spuntati: barrati e ammassati in fondo alla sezione; progress "12/23" nell'header e per sezione
- Pulsante flottante *Aggiungi* per gli articoli a mano: solo il nome (il reparto si deduce dalla libreria, altrimenti *Altro*); si rimuovono con ✕
- *Aggiorna lista* rigenera dalla versione corrente del piano, con conferma se ci sono spunte: sta nell'avviso "Il piano è cambiato" quando serve, altrimenti nell'header. Nessun gesto personalizzato: il pull-to-refresh resta quello del browser
- Senza rete le spunte restano a schermo e partono da sole quando la connessione torna ("N spunte in attesa di rete")
```

**5. Test.**
- `tests/app/shopping-page.test.tsx` (`// @vitest-environment node`; `vi.mock("next/server", () => ({ connection: vi.fn() }))`, `vi.mock("@/lib/shopping/service", () => ({ getShoppingScreen: vi.fn() }))`): la pagina attende `connection`, chiama `getShoppingScreen({ planId: "<uuid>" })` con `searchParams: Promise.resolve({ piano: "<uuid>" })`, con `{ planId: undefined }` senza parametro e con il primo valore se `piano` è un array; l'elemento restituito è `ShoppingScreen` con `props.initialScreen` uguale al valore del servizio e `key` uguale a `selected.plan.id`, oppure `"none"` se `selected` è `null`.
- `tests/ui/shell.test.tsx`: togliere `import ShoppingListPage from "@/app/(app)/lista/page";` e aggiungere `import { ShoppingScreen } from "@/components/shopping/shopping-screen";`. Riscrivere **solo** il test "renders Shopping list page with sections and progress": monta `<ShoppingScreen initialScreen={…} />` con un piano confermato e una lista con un articolo `{ canonical_name: "zucchina", qty: 2, unit: "pz", category: "ortofrutta", checked: false, manual: false, recipe_ids: [] }`; verifica il titolo di livello 1 `Lista della Spesa` e il testo `Ortofrutta`. Il blocco "ShoppingItemRow" e tutti gli altri test del file restano invariati.
- `tests/ui/shopping-screen.test.tsx` (`vi.mock("next/navigation", …)` con `useRouter` che restituisce un oggetto con `push` e `refresh` finti; `vi.mock("@/lib/shopping/client", …)` con le cinque funzioni finte; `window.localStorage.clear()` in `beforeEach`; la `CheckQueue` è quella vera). Fabbrica locale `makeScreen(overrides)` con un piano confermato `PLAN_ID`, settimana `2026-09-28`…`2026-10-04`, e una lista con: `cipolla` `2 pz` `ortofrutta` (non spuntata), `zucchina` `300 g` `ortofrutta` (spuntata), `petto di pollo` `700 g` `macelleria` (non spuntata, `recipe_ids` di due ricette presenti in `recipes` con titoli `Pollo al limone` e `Insalata di pollo`).
  1. intestazione `Lista della Spesa`, sottotitolo `Settimana 28 set – 4 ott`, sezioni `Ortofrutta` e `Macelleria` in quest'ordine, contatori di sezione `1/2` e `0/1`, avanzamento `1/3`, `progressbar` con `aria-valuenow="1"` e `aria-valuemax="3"`;
  2. in `Ortofrutta` la riga `Cipolla` precede `Zucchina` (spuntata, barrata); quantità `2 pz`, `300 g`, `700 g`; sotto `Petto di pollo` il testo `Per: Pollo al limone, Insalata di pollo`;
  3. **spunta immediata**: `patchShoppingItem` restituisce una promessa in sospeso; tocco `Cipolla` → `aria-checked="true"` subito e avanzamento `2/3`, `patchShoppingItem(idCipolla, true)` chiamata; alla risoluzione lo stato resta;
  4. **due tocchi rapidi**: tocco, poi di nuovo mentre la prima è in sospeso → una sola chiamata; alla risoluzione parte `patchShoppingItem(idCipolla, false)`; in totale due chiamate;
  5. **senza rete** (timer finti): `patchShoppingItem` rigetta con `new ApiRequestError(0, "network_error", "Connessione non disponibile.")` → la riga resta spuntata, compare `1 spunta in attesa di rete`, `localStorage.getItem("mealy:shopping:pending:" + PLAN_ID)` contiene l'id; avanzando di 2000 ms con `patchShoppingItem` che ora riesce → l'avviso sparisce e la chiave non c'è più;
  6. **ripristino**: con la chiave di `localStorage` già valorizzata (`{ [idCipolla]: true }`) prima del montaggio → `Cipolla` è spuntata e `patchShoppingItem(idCipolla, true)` viene chiamata senza alcun tocco;
  7. **errore definitivo**: `patchShoppingItem` rigetta con `new ApiRequestError(409, "plan_archived", "Questa settimana è conclusa: la lista si può solo consultare.")` → toast con quel testo, `fetchPlanShoppingList(PLAN_ID)` chiamata, la riga torna allo stato del server; con un `404` nessun toast ma la rilettura sì;
  8. **ritorno in primo piano**: `document.dispatchEvent(new Event("visibilitychange"))` (con `visibilityState` `"visible"`) → `fetchPlanShoppingList(PLAN_ID)` chiamata e i dati nuovi a schermo; lo stesso con `window.dispatchEvent(new Event("online"))`;
  9. **lista da aggiornare** (`needs_regeneration: true`, nessun articolo generato spuntato): testo `Il piano è cambiato: aggiorna la lista per allinearla.` e **un solo** pulsante `Aggiorna lista`; click → `requestBuildShoppingList(PLAN_ID)` senza conferma; con la risposta (`needs_regeneration: false`) toast `Lista aggiornata` e avviso sparito;
  10. **conferma con spunte** (fabbrica di base, `Zucchina` spuntata): click su `Aggiorna lista` → compare il testo di conferma e nessuna chiamata; `Annulla` → il riquadro sparisce, nessuna chiamata; di nuovo `Aggiorna lista` poi `Aggiorna` → `requestBuildShoppingList` chiamata una volta;
  11. lista aggiornata (`needs_regeneration: false`): un solo pulsante `Aggiorna lista`, nell'intestazione; nessun avviso;
  12. **aggiornamento bloccato dalle spunte in coda**: `patchShoppingItem` rigetta sempre con l'errore di rete; tocco `Cipolla`, poi `Aggiorna lista` (e `Aggiorna` se compare la conferma) → toast `Ci sono spunte in attesa di rete: riprova quando torna la connessione.` e `requestBuildShoppingList` mai chiamata;
  13. **lista da creare** (`list: null`, `can_build: true`): titolo `Lista da creare`; `Crea lista della spesa` → `requestBuildShoppingList(PLAN_ID)`; con la risposta toast `Lista creata` e sezioni a schermo;
  14. **bozza** (`list: null`, `can_build: false`, `editable: true`): `Piano non ancora confermato`; `Vai al piano` → `router.push("/?settimana=2026-09-28")`;
  15. **nessun piano** (`selected: null`): `Nessuna lista della spesa`; `Vai al piano` → `router.push("/")`;
  16. **piano chiuso senza lista** (`list: null`, `editable: false`): `Nessuna lista per questa settimana`, nessun pulsante d'azione;
  17. **sola lettura** (`editable: false`, `can_build: false`, lista presente): testo `Questa settimana è conclusa: la lista si può solo consultare.`, righe con `aria-disabled="true"`, un tocco non chiama `patchShoppingItem`, nessun pulsante `Aggiungi un articolo alla lista`, nessun `Aggiorna lista`, nessun `Rimuovi …`;
  18. **aggiunta a mano**: `Aggiungi un articolo alla lista` apre il `dialog`; scrivo `latte`, invio → `postShoppingItem(PLAN_ID, "latte")`; con la risposta (`canonical_name: "latte"`, `category: "banco-frigo"`, `manual: true`, `unit: null`, `qty: null`) compare la sezione `Freschi & Latticini` con la riga `Latte` e il dettaglio `Aggiunto a mano`, nel pannello `Aggiunto: Latte`, avanzamento `1/4`;
  19. **rimozione**: lista con un articolo a mano `latte`; `Rimuovi Latte` → la riga sparisce subito e `deleteShoppingItem(idLatte)` viene chiamata; se rigetta con un `500` la riga torna e compare il toast col messaggio; se rigetta con un `404` la riga resta rimossa e nessun toast; gli articoli generati non hanno il pulsante `Rimuovi …`;
  20. **selettore**: `plans` con due piani → `navigation` di nome `Liste della spesa` con due link (`28 set – 4 ott`, `5 ott – 11 ott`) verso `/lista?piano=<id>`, quello mostrato con `aria-current="page"`; con un solo piano nessuna `navigation` con quel nome;
  21. tutti spuntati → `Hai preso tutto.`; lista con `items: []` → `Niente da comprare per i pasti che restano.`, nessuna scheda di avanzamento, pulsante *Aggiungi* presente;
  22. una nuova prop `initialScreen` (stessa `key`, altri articoli) sostituisce lo stato.

### Contratti esposti
`ShoppingScreen` e `ShoppingScreenProps`. Nessuno verso altri WP.

### Dipendenze
- **WP1**: tipi, `groupShoppingItems`, `shoppingProgress`, `formatShoppingQuantity`, `shoppingItemLabel`.
- **WP3**: `getShoppingScreen` (pagina).
- **WP4**: le cinque funzioni del client, `CheckQueue`, `createLocalCheckStorage`.
- **WP5**: `ShoppingItemRow` con i campi nuovi, `AddShoppingItemSheet`.

### Criteri di accettazione
- La spunta compare prima della risposta del server e non torna indietro per un errore di rete (test 3 e 5): "spunte immediate anche con rete lenta" (S4.2).
- Al ritorno in primo piano la lista viene riletta e le spunte in coda inviate (test 6 e 8): "stato preservato al ritorno dall'app in background" (S4.2).
- Sezioni per reparto, riga intera come bersaglio, spuntati in fondo, avanzamento per sezione, articoli a mano dal pulsante flottante (test 1, 2, 18).
- Nessun riferimento a `INITIAL_SHOPPING_ITEMS` resta nel repository.
- Il componente non importa da `lib/shopping/service`, `lib/shopping/errors`, `lib/db`.

### Fuori ambito
Footer del Piano (WP7). Pull-to-refresh personalizzato. *Azzera spunte*. Modifica di nome o quantità. Annulla della rimozione. Filtri o ricerca nella lista. Badge sulla tab *Lista*.

---

## WP7 — Footer del Piano: crea e apri la lista (wave 3, parallelo a WP6)

**Obiettivo:** dal Piano confermato un tap crea la lista e la apre; se la lista esiste, il footer la apre e dice se è da aggiornare.

### File
- `components/plan/plan-screen.tsx` — **modifica** (solo footer e relativo handler)
- `tests/ui/plan-screen.test.tsx` — **modifica**

### Pattern di riferimento
- `handleConfirm` e l'uso di `mountedRef`, `navigate` e `setToast` nello stesso file.

### Passi

**1. `components/plan/plan-screen.tsx`.**
- Import: `import { requestBuildShoppingList } from "@/lib/shopping/client";`.
- Costanti accanto alle altre `TOAST_…`:
  ```ts
  const LIST_CREATE_LABEL = "Crea lista della spesa";
  const LIST_CREATING_LABEL = "Creo la lista…";
  const LIST_OPEN_LABEL = "Vai alla lista della spesa";
  const LIST_STALE_LABEL = "Lista della spesa da aggiornare";
  ```
- Stato: `const [isCreatingList, setIsCreatingList] = React.useState(false);`.
- Handler:
  ```ts
  const handleCreateList = async (): Promise<void> => {
    if (!plan || isCreatingList) return;
    const planId = plan.id;
    setIsCreatingList(true);
    try {
      await requestBuildShoppingList(planId);
      if (!mountedRef.current) return;
      setScreen((prev) =>
        prev.view.plan && prev.view.plan.id === planId
          ? withPlan(prev, {
              ...prev.view.plan,
              shopping_list: { exists: true, needs_regeneration: false },
            })
          : prev
      );
      navigate(`/lista?piano=${planId}`);
    } catch (err) {
      if (mountedRef.current) setToast(apiErrorMessage(err));
    } finally {
      if (mountedRef.current) setIsCreatingList(false);
    }
  };
  ```
- Footer: il ramo `plan.status === "draft"` (pulsante *Conferma piano*) **non cambia**. Il ramo dei piani non in bozza diventa:
  - se `!plan.shopping_list.exists`: `<Button className="h-12 w-full gap-2 text-base font-semibold shadow-md" onClick={() => void handleCreateList()} disabled={isCreatingList}>` con l'icona `ShoppingBag` di oggi e `<span>{isCreatingList ? LIST_CREATING_LABEL : LIST_CREATE_LABEL}</span>`;
  - altrimenti il `Link` di oggi (stesso `href` `` `/lista?piano=${plan.id}` ``, stesse classi, stessa icona) con testo `plan.shopping_list.needs_regeneration ? LIST_STALE_LABEL : LIST_OPEN_LABEL`.
- Nient'altro cambia in questo file: `showFooter`, la posizione del toast, `withSlotFrom` (che già porta `shopping_list` dopo uno swap) restano come sono.

**2. `tests/ui/plan-screen.test.tsx`.**
- Aggiungere il mock, accanto agli altri:
  ```ts
  vi.mock("@/lib/shopping/client", async (importOriginal) => {
    const original = await importOriginal<typeof import("@/lib/shopping/client")>();
    return { ...original, requestBuildShoppingList: vi.fn() };
  });
  ```
  e l'import `import { requestBuildShoppingList } from "@/lib/shopping/client";`.
- `makePlan`: aggiungere a `PlanOptions` il campo opzionale `shoppingList?: PlanView["shopping_list"]` (default `{ exists: false, needs_regeneration: false }`) e usarlo per `shopping_list`.
- Blocco "confirmation and footer":
  - nel test "shows Rigenera and Conferma piano on a draft, and confirming activates the plan" sostituire l'asserzione sul link con `expect(screen.getByRole("button", { name: "Crea lista della spesa" })).toBeInTheDocument();`;
  - sostituire il test "shows the shopping-list link for an already confirmed plan" con tre test:
    1. "creates the list and opens it": piano `active` senza lista; `requestBuildShoppingList` risolve (il valore non viene letto: basta `mockResolvedValueOnce({} as never)`); click su `Crea lista della spesa` → `requestBuildShoppingList` chiamata con `PLAN_ID` e `router.push` con `` `/lista?piano=${PLAN_ID}` ``;
    2. "shows a busy label and toasts the error when creating the list fails": promessa in sospeso → pulsante disabilitato con testo `Creo la lista…`; rigetto con `new PlanRequestError(409, "plan_archived", "Questa settimana è conclusa.")` → toast con quel testo, pulsante di nuovo `Crea lista della spesa` e attivo, `router.push` mai chiamata;
    3. "links to an existing list and flags a stale one": `shoppingList: { exists: true, needs_regeneration: false }` → link `Vai alla lista della spesa` con `href` `` `/lista?piano=${PLAN_ID}` `` e nessun pulsante `Crea lista della spesa`; `shoppingList: { exists: true, needs_regeneration: true }` → link `Lista della spesa da aggiornare` con lo stesso `href`.
- Test "keeps a past week read-only…": sostituire `expect(screen.queryByRole("link", { name: "Crea lista della spesa" })).toBeNull();` con le due righe `expect(screen.queryByRole("button", { name: "Crea lista della spesa" })).toBeNull();` e `expect(screen.queryByRole("link", { name: /lista della spesa/i })).toBeNull();`.
- Tutti gli altri test del file restano invariati.

### Contratti esposti
Nessuno verso altri WP.

### Dipendenze
- **WP4**: `requestBuildShoppingList`.

### Criteri di accettazione
- Da un piano confermato senza lista un tap crea la lista e porta a `/lista?piano=<id>`.
- Con la lista esistente il footer è un link; dopo uno swap (lista da aggiornare) il testo lo dice.
- `tests/ui/shell.test.tsx` (che monta `PlanScreen` con un piano in bozza) resta verde senza modifiche da parte di questo WP.

### Fuori ambito
Creazione automatica della lista alla conferma. Avvisi nel Piano oltre al testo del link. Modifiche a `lib/plans/`, a `PlanSlotCard` e alla schermata Lista.

---

## Riuso obbligatorio (non reimplementare)
| Serve | Si usa |
|---|---|
| Normalizzare un nome d'ingrediente o di articolo | `normalizeCanonicalName` (`lib/domain/recipe-text.ts`) |
| Ordine ed etichette dei reparti | `CATEGORY_VALUES`, `CATEGORY_LABELS` (`lib/domain/types.ts`) |
| "Oggi" e settimana corrente | `todayInTimeZone`, `mondayOf`, `addDays` (`lib/domain/week.ts`), `APP_TIME_ZONE` (`lib/domain/planner-config.ts`) |
| Sapere se un piano è chiuso | `isPlanClosed` (`lib/domain/plan-status.ts`, creato da WP1 per l'innesto R1; `lib/plans/service.ts` lo riesporta soltanto) |
| Leggere piano, slot e ricette | `getPlanById` (`lib/db/repositories/plan-repo.ts`) |
| Lock dei piani dell'household | `acquirePlanLock` (`lib/db/repositories/plan-repo.ts`) |
| Caricare l'household | `loadHousehold` (`lib/db/repositories/household-repo.ts`) |
| Leggere la libreria completa | `listRecipes` (`lib/db/repositories/recipe-repo.ts`) |
| Risposte d'errore e lettura del body | `lib/http/responses.ts` |
| Richieste dal client, errori e messaggi | `requestJson`, `ApiRequestError`, `apiErrorMessage` (`lib/http/client.ts`) |
| Intervallo di date della settimana | `formatWeekRange` (`lib/plans/format.ts`) |
| Consolidamento, riconciliazione, reparto | `buildShoppingList`, `reconcileShoppingItems`, `inferShoppingCategory` (`lib/domain/shopping-list.ts`, WP1) |
| Raggruppare, ordinare, formattare | `groupShoppingItems`, `shoppingProgress`, `formatShoppingQuantity`, `shoppingItemLabel` (WP1) — mai riscritti nei componenti |
| Stato vuoto, toast, pannello, pulsanti | `EmptyState`, `Toast`, `Sheet`, `Button` esistenti |
| Household, piani e ricette di test | `tests/helpers/{db,plans}.ts`, `insertPlan` / `insertSlots` / `activateDraftPlan` |

## Contratti consegnati alle feature successive
- **F7 (deploy):** nessuna migrazione nuova. Gli alias sono 35 (11 in più): il deploy esegue `pnpm db:migrate` e poi `pnpm db:seed:aliases` (idempotente); **mai** `pnpm db:seed`, che inserisce anche le 18 ricette di esempio. `/feature-plan 7` deve mettere quel passo nello script di deploy. La coda delle spunte usa `localStorage` del browser: nessuna configurazione lato server.
- **Verifica dal telefono a fine v1:** i punti di `requirements.md §5`.
- **Canonicalizzazione dei nomi (futura):** la riga c della review di F5 resta valida; se un giorno gli alias si risolvono in scrittura, `buildShoppingList` continua a funzionare senza modifiche (la risoluzione diventa un'operazione senza effetto).
- **v2 (uso in due):** la lista è per piano, quindi già per household; `ingredient_aliases` resta globale.

---

## Mappa delle dipendenze

```
Wave 1:  WP1 ∥ WP2
Wave 2:  WP3 ∥ WP4 ∥ WP5
Wave 3:  WP6 ∥ WP7
```
| WP | Richiede | File condivisi con altri WP della stessa wave |
|---|---|---|
| WP1 | — | nessuno |
| WP2 | — | nessuno |
| WP3 | WP1, WP2 | nessuno (`docs/ARCHITECTURE.md` è solo suo) |
| WP4 | WP1 | nessuno (in `lib/shopping/` crea file diversi da quelli di WP3) |
| WP5 | WP1 | nessuno |
| WP6 | WP1, WP3, WP4, WP5 | nessuno (`tests/ui/shell.test.tsx` e `docs/DESIGN.md` sono solo suoi) |
| WP7 | WP4 | nessuno |

Vincoli di ordine: le tre wave sono **strettamente sequenziali**, con il gate completo tra l'una e l'altra; dentro ogni wave i WP sono su file disgiunti e possono girare in parallelo. Nessun WP importa un file creato da un altro WP della stessa wave. Prima della wave 1 (test DB di WP2) deve essere attivo il Postgres di sviluppo (regola 0.3.8), già migrato: questa feature non aggiunge migrazioni.

## Checklist finale
- [x] **WP1** — Contratti F6 in `types.ts`, `lib/domain/shopping-list.ts` (consolidamento, riconciliazione, reparto, ordinamento, formattazione)
- [x] **WP2** — `lib/db/repositories/shopping-repo.ts`, 11 alias in più in `fixtures/ingredient-aliases.json` (R5), `pnpm db:seed:aliases` (R4)
- [x] **WP3** — `lib/shopping/{errors,http,service}.ts`, rotte `GET`/`POST /api/plans/:id/shopping-list`, `POST /api/plans/:id/shopping-list/items`, `PATCH`/`DELETE /api/shopping-items/:id`, ARCHITECTURE §4.2, §5.5, §6
- [x] **WP4** — `lib/shopping/client.ts`, `lib/shopping/check-queue.ts`
- [x] **WP5** — `ShoppingItemRow` (aggiunte compatibili), `AddShoppingItemSheet`
- [x] **WP6** — Pagina e schermata Lista, `loading.tsx`, DESIGN §4.3
- [x] **WP7** — Footer del Piano: crea e apri la lista

**Chiusura della feature** (accettazioni del backlog):
- S4.1 — `buildShoppingList` è una funzione pura, verde sulle fixture, senza accesso a rete, DB o LLM (WP1); somma tra ricette, `qb`, unità eterogenee su righe separate, tracciabilità `recipe_ids`, alias (WP1, WP2).
- S4.2 — rotte della lista (WP3); sezioni per reparto, riga intera come bersaglio, spuntati in fondo, avanzamento per sezione, articoli a mano, aggiornamento che preserva le spunte, spunta immediata (WP3–WP7). L'uso reale al supermercato si verifica dal telefono a fine v1 (`requirements.md §5`).

## Autoverifica
| Domanda di analisi | Dove trova risposta |
|---|---|
| Fin dove si risolvono gli alias? | U1 → regola 0.3.3, WP1 (`resolveIngredientName`, `buildShoppingList`), WP2 passo 2, WP3 (`buildPlanShoppingList` passo 5) |
| Cosa succede a una spunta senza rete? | U2 → WP4 (`CheckQueue`), WP6 (effetto della coda, test 5–7) |
| Come si rigenera la lista? | U3 → WP6 (render 5.2–5.3, `runBuild`), DESIGN §4.3 |
| Quale lista apre la tab? | U4 → WP1 `pickDefaultShoppingPlan`, WP3 `getShoppingScreen`, WP6 (selettore) |
| Serve una migrazione? | P2 → regola 0.3.5 |
| Su quali piani si può creare la lista? | P3 → WP3 (`buildPlanShoppingList` passi 3–4, errori), WP6 (stati vuoti) |
| Quali pasti entrano nella lista? | P4 → WP3 (`buildPlanShoppingList` passo 6) |
| Regole di arrotondamento, `qb`, reparto | P5–P7 → WP1 passo 2 |
| Come si preservano le spunte? | P8 → WP1 `reconcileShoppingItems`, WP3 passi 8–12 |
| Concorrenza con swap e rigenerazione del piano | P9 → WP3 (`acquirePlanLock`), test 13 |
| Dove si vede "serve per"? | P10 → WP5 (`detail`), WP6 (`toRow`) |
| Cosa si inserisce per un articolo a mano e come si toglie? | P11, P12 → WP3 (`addManualShoppingItem`, `removeManualShoppingItem`), WP5, WP6 |
| Ritorno dal background | P14 → WP6 (effetto di ritorno, test 8) |
| Come nasce la lista dal Piano? | P15 → WP7 |
| Errori e codici HTTP | P16, P17 → WP3 passi 1, 2, 4 |
| Formato delle quantità e ordine | P18, P19 → WP1 (`formatShoppingQuantity`, `groupShoppingItems`) |
| Come resta verde il gate tra le wave con la pagina finta? | P21 → WP5 (vincolo di compatibilità), WP6 (sostituzione) |
| Test di alias senza dipendere dal seed | P24 → WP2 test 11, WP3 test 8 |

---

## Innesti dalla architecture review (2026-10-08), applicati da `/feature-dev 6`

Dove questa sezione e il testo di un WP divergono, **vale questa sezione**. Dettaglio e motivazioni in [`architecture-review-2026-10-08.md`](architecture-review-2026-10-08.md).

| ID | WP | Innesto |
|---|---|---|
| R1 | WP1, WP3 | `isPlanClosed` si sposta nel file puro nuovo `lib/domain/plan-status.ts`; `lib/plans/service.ts` lo importa da lì e lo riesporta (unica modifica a `lib/plans/`, fatta da WP1). `lib/shopping/service.ts` lo importa dal dominio; un test di purezza verifica che non importi da `@/lib/plans/service`, `@/lib/recipes`, `@/lib/llm` |
| R2 | WP4, WP6 | Limite di tempo agli invii della coda: `CHECK_SEND_TIMEOUT_MS = 10_000`, `send(itemId, checked, signal)`, un `AbortController` per tentativo, `dispose()` interrompe gli invii in corso; `patchShoppingItem(itemId, checked, signal?)`. Test 14 della coda |
| R3-a | WP6 | Una vista intera letta dal server non si applica se nel frattempo è stata confermata una spunta (`checkSeqRef`); test 23 della schermata |
| R4 | WP2 | `seedIngredientAliases(executor)` in `lib/db/seed-core.ts`, script `lib/db/seed-aliases.ts` e comando `pnpm db:seed:aliases`; test di idempotenza in `tests/db/seed.test.ts`; riga in `CLAUDE.md` |
| R5 | WP2 | La voce `lenticchie secche → lenticchia` non si aggiunge: 11 voci nuove, 35 in tutto (`toBe(35)`) |
| R6 | WP3 | Commento in testa a `lib/shopping/service.ts` sul costo delle letture complete |
| R7 | WP3 | Frase sul limite del confronto tra orizzonti in ARCHITECTURE §5.5 |
| — | WP3 | Preambolo dei test del servizio: i nomi d'ingrediente dei test non devono essere alias del seed |
| — | WP6 | DESIGN §4.3, ultimo punto: "Senza rete, a pagina già aperta, le spunte restano a schermo…" |

Non applicati perché facoltativi per la review: **R3-b** (la ricostruzione che toglie soltanto le spunte) e **P4** (rimozione degli schemi `ShoppingListSchema` / `ShoppingItemSchema` di F1).
