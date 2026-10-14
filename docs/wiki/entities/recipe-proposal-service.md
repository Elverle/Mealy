---
title: Ricette su Richiesta — Proposta, Salvataggio, Errori e Rotte (recipe-proposal-service)
type: entity
created: 2026-10-14
updated: 2026-10-14
tags: [recipes, llm, proposal, service, api-route, errors, advisory-lock, validation, feature-9]
---

## File e Responsabilità

- **Percorsi file**:
  - `lib/recipes/propose.ts`: servizio **solo lato server** con `proposeRecipe` (chiede una ricetta all'LLM, non scrive) e `saveProposedRecipe` (salva in libreria una proposta accettata).
  - `lib/recipes/store.ts`: `insertGeneratedRecipe`, la scrittura in libreria di una ricetta generata (slug univoco + `insertRecipeWith`), condivisa con `generateAndStoreRecipes` ([[recipe-generation]]).
  - `lib/recipes/errors.ts`: codici, tabella `RECIPE_ERROR_HTTP`, classe `RecipeError` e `isRecipeError`. Nessun import dal DB.
  - `lib/recipes/http.ts`: `handleRecipeRouteError(err, tag)`, gestione errori comune alle rotte `/api/recipes` nuove (solo server).
  - `app/api/recipes/propose/route.ts`: `POST /api/recipes/propose`.
  - `app/api/recipes/route.ts`: `POST /api/recipes`, accanto al `GET` della Feature 5 ([[library-service]]).
- **Scopo**: la strada "inventare" della Feature 9 ([[f9-ricette-su-richiesta]]): una ricetta chiesta con un testo libero, proposta dall'LLM e salvata solo se l'utente la accetta.
- **Confini**: è il modulo `recipes` a chiamare l'LLM, tramite `generateRecipeFromRequest` di [[llm-adapter]]; `plans` non lo importa. `lib/recipes/index.ts` **non** è cambiato (requirements P1): le rotte nuove importano da `@/lib/recipes/propose` e `@/lib/recipes/http`, perché i test esistenti sostituiscono il barrel con un mock che elenca solo `generateAndStoreRecipes`. I client fetch delle due rotte sono in `lib/library/client.ts` ([[library-service]]).

## Proposta (`proposeRecipe`)

```ts
export interface ProposeRecipeInput {
  householdId?: string;                  // default: singleton
  request: string;
  mealType: MealType | null;             // null = lo decide il modello (Libreria)
  excludeTitles: readonly string[];      // titoli già proposti nella sequenza di «Un'altra»
}
export interface ProposeRecipeDeps {
  model?: GenerateRecipesOptions['model'];
  generate?: typeof generateRecipeFromRequest;   // default: l'adapter
  abortSignal?: AbortSignal;                     // chiusura della sheet lato client
}
export async function proposeRecipe(input: ProposeRecipeInput, deps?: ProposeRecipeDeps): Promise<RecipeProposal>;
```

1. `loadHousehold(input.householdId)` ([[household-repo]]) e vincoli con la funzione privata `requestConstraints(household, mealType)` = `buildConstraints(household, mealType, { meal_style_tags: [] })` **senza** preferenze ingrediente: persone, tipo di pasto, diete ed elettrodomestici; stile preferito, gradimenti e scarti vuoti (spec D7, requirements P27).
2. `generate(constraints, request, excludeTitles, { model, abortSignal })`, fuori da ogni transazione.
3. `findConstraintViolations(recipe, constraints)`: con almeno una violazione `console.warn('[recipes/propose] proposal_unsuitable', { title, violations })` e `RecipeError('proposal_unsuitable')`. Nessun secondo tentativo automatico. Con `ingredient_dislikes` vuoto il controllo sugli ingredienti non scatta: una proposta con un ingrediente scartato viene restituita.
4. Doppione: `listRecipeTitleRefs(db, household.id)` ([[recipe-repo]]) e confronto con `normalizeTitle`; la prima ricetta con lo stesso titolo normalizzato diventa `duplicate_of: { id, title }`, altrimenti `null`. Il confronto guarda tutte le ricette dell'household, bloccate comprese.
5. Restituisce `{ recipe, duplicate_of }` e **non scrive nulla**.

Un `LlmError` dell'adapter risale così com'è.

## Salvataggio (`saveProposedRecipe`)

```ts
export interface SaveProposedRecipeInput { householdId?: string; recipe: GeneratedRecipe; }
export async function saveProposedRecipe(input: SaveProposedRecipeInput): Promise<RecipeWithDetails>;
```

1. `normalizeGeneratedRecipe(recipe)` (idempotente: la rotta l'ha già applicata).
2. `db.transaction`, `acquireRecipeGenerationLock(tx)`: lo stesso advisory lock della generazione a lotti, quindi i salvataggi e le generazioni si serializzano tra loro.
3. Household **riletto** con `getHouseholdById(id, tx)`: un cambio delle impostazioni fatto durante la richiesta vale per il controllo.
4. `findConstraintViolations(recipe, requestConstraints(current, null))`: diete ed elettrodomestici, non il pasto (la richiesta l'ha già scelto). Violazione → `console.warn('[recipes/save] recipe_unsuitable', …)` e `RecipeError('recipe_unsuitable')`, senza scritture.
5. Doppione: `listRecipeTitles(tx, household.id)` confrontati con `normalizeTitle` → `RecipeError('recipe_duplicate')`. **Nessun** `findSimilarRecipeTitle`: chi chiede "lasagne al pesto" avendo "Lasagne al ragù" vuole una variante (spec D11).
6. `insertGeneratedRecipe(tx, household.id, recipe)`.

Due salvataggi sovrapposti dello stesso titolo producono una sola ricetta: il secondo, in coda sul lock, trova il titolo e riceve `recipe_duplicate`.

## Scrittura Condivisa (`store.ts`)

```ts
export async function insertGeneratedRecipe(executor: DbExecutor, householdId: string, recipe: GeneratedRecipe): Promise<RecipeWithDetails>;
```

Calcola lo slug con la funzione privata `uniqueSlug(executor, slugify(title))` (slug libero, poi suffissi `-2` … `-99`, poi 6 caratteri casuali; gli slug sono **globali**, quindi lo stesso titolo in due household ha due slug distinti) e chiama `insertRecipeWith` con `source: 'llm'`, `macros_est: null` e gli ingredienti mappati campo per campo; `insertRecipeWith` crea anche la riga di preferenze di default. Va chiamata dentro una transazione, dopo `acquireRecipeGenerationLock`. È il codice che prima della Feature 9 stava nel ciclo di `generateAndStoreRecipes`, estratto senza cambiarne il comportamento (requirements P3).

## Errori (`errors.ts`)

| Codice | HTTP | Messaggio |
|---|---|---|
| `proposal_unsuitable` | 422 | `Non sono riuscito a proporre una ricetta adatta ai tuoi vincoli. Prova a cambiare la richiesta.` |
| `recipe_unsuitable` | 422 | `La ricetta non rispetta più i vincoli delle impostazioni.` |
| `recipe_duplicate` | 409 | `Questa ricetta è già in libreria.` |

Stessa forma di `PlanError` ([[plan-service]]) e `ShoppingError` ([[shopping-service]]). `handleRecipeRouteError(err, tag)`: un `RecipeError` diventa la risposta della tabella **senza log**; ogni altro errore si logga con il tag e diventa `llmErrorResponse(err) ?? internalErrorResponse()` ([[http-helpers]]).

## API HTTP

Entrambe le rotte hanno `runtime = 'nodejs'` e `dynamic = 'force-dynamic'` e leggono il corpo con `readJsonBody(request, { allowEmpty: false })`.

| Metodo e rotta | Input | Successo | Errori | `maxDuration` |
|---|---|---|---|---|
| `POST /api/recipes/propose` | `ProposeRecipeRequest`: `{ request, meal_type?, exclude_titles? }` | 200 `RecipeProposal` | 400 `invalid_request`; 422 `proposal_unsuitable`; errori LLM (500 `llm_not_configured`, 502 `llm_unavailable` / `llm_invalid_output`, 504 `llm_timeout`); 499 senza corpo se il client ha chiuso | 250 |
| `POST /api/recipes` | `SaveRecipeRequest`: `{ recipe }` | 201 `{ recipe }` (`SaveRecipeResult`, ricetta completa con ingredienti e preferenze) | 400 `invalid_request` (anche se la ricetta non è più valida dopo la normalizzazione); 409 `recipe_duplicate`; 422 `recipe_unsuitable`; 500 | — |

- **Proposta**: `maxDuration = 250` come swap e *Ripeti*: una chiamata più l'eventuale riparazione, al più `2 × LLM_TIMEOUT_MS` (`ARCHITECTURE §6`). La rotta passa `request.signal` a `proposeRecipe` (requirements P6). Nel `catch`, se `request.signal.aborted`, risponde `new Response(null, { status: 499 })` (stato non standard di nginx, "client closed request") **senza log**: l'annullamento arriva dall'adapter come `LlmError('timeout')` e altrimenti sporcherebbe i log del Raspberry con un falso timeout (innesto R1 della review architetturale). Tag di log: `[api/recipes/propose]`.
- **Salvataggio**: il client non è una fonte fidata. La rotta valida il corpo con `SaveRecipeRequestSchema`, applica `normalizeGeneratedRecipe` e **rivalida** con `SavedRecipeInputSchema`, che aggiunge tetti di dimensione a `GeneratedRecipeSchema` (fix della code review, v. [[domain-types]]). Tag di log: `[api/recipes POST]`. `GET /api/recipes` nello stesso file è invariato.

## Test

- `tests/recipes/propose.test.ts` (DB reale, household dedicati, generatore finto o modello registrato): proposta senza scritture con l'asserzione di confine `RecipeProposalSchema.parse(JSON.parse(JSON.stringify(…)))` (innesto R6), titoli esclusi passati al modello, stile e preferenze fuori dal prompt, rifiuti per dieta, elettrodomestico e pasto con spia su `console.warn` (R2), ingrediente scartato ammesso, `duplicate_of` e sua assenza, `LlmError` che risale, segnale passato al generatore; salvataggio come ricetta `llm` con preferenze di default (confine `SaveRecipeResultSchema`), doppione anche con spaziatura e punteggiatura diverse, titolo solo simile accettato, `recipe_unsuitable` senza scritture, ricetta con ingrediente scartato salvata ma esclusa dal sorteggio e adatta per `manualChoiceExclusionReason` (parità), due salvataggi sovrapposti, stesso titolo in due household.
- `tests/api/recipes-propose.test.ts` (servizio sostituito): `runtime`, `dynamic` e `maxDuration`, 200 con il segnale passato al servizio, mappatura di `meal_type` ed `exclude_titles` e trim della richiesta, `proposal_unsuitable`, i quattro errori LLM, 500 senza messaggio interno, `499` senza `console.error` con il segnale già annullato.
- `tests/api/recipes.test.ts`: casi `POST` aggiunti (201 con la ricetta normalizzata passata al servizio; 400 per corpo vuoto, oggetto vuoto, ricetta senza ingredienti, chiave in più, unico passo vuoto dopo la normalizzazione, descrizione oltre `SAVED_RECIPE_TEXT_MAX`; 409, 422, 500 senza messaggio interno).

## Limiti Noti

- Non è verificato che Next in modalità standalone annulli `request.signal` quando il client chiude la connessione; la prova è una verifica manuale di chiusura ([[f9-ricette-su-richiesta]]).
- `insertGeneratedRecipe` scrive sempre `source: 'llm'`: non va usata per il dataset della Feature 8 né, in futuro, per l'inserimento a mano.
- Il prompt riceve i titoli di `exclude_titles` fuori dai delimitatori della richiesta, ridotti a una riga e limitati a 10 × 120 caratteri (osservazione cosmetica della review architetturale, nessuna azione).

## Vedi anche

- [[llm-adapter]] — `generateRecipeFromRequest` e prompt della richiesta libera
- [[recipe-generation]] — `buildConstraints`, `findConstraintViolations` e generazione a lotti, che usa la stessa `insertGeneratedRecipe`
- [[recipe-repo]] — `listRecipeTitleRefs`, `listRecipeTitles`, `acquireRecipeGenerationLock`
- [[library-service]] — Client `requestRecipeProposal` e `requestSaveRecipe`, `GET /api/recipes`
- [[recipe-proposal-sheet]] — Sheet che chiama le due rotte
- [[domain-types]] — Schemi della Feature 9
- [[http-helpers]] — `readJsonBody`, `llmErrorResponse`
- [[f9-ricette-su-richiesta]] — Panoramica della Feature 9
