---
title: Libreria — Regole Pure, Servizio, API e Client (library-service)
type: entity
created: 2026-10-05
updated: 2026-10-14
tags: [library, domain, pure-functions, service, api-route, client-fetch, filters, search, recipe-requests, feature-5, feature-9]
---

## File e Responsabilità

- **Percorsi file**:
  - `lib/domain/library.ts`: regole **pure** della Libreria (card, filtro, ricerca, ordinamento, lettura della query string; dalla Feature 9 anche testo della richiesta libera e sequenza di *Un'altra*). Nessuna dipendenza da DB, LLM o framework: importabile dai componenti client.
  - `lib/library/service.ts`: servizio **solo lato server** (`listLibraryCards`, `listLibrary`, `getRecipeDetail`); importa il DB.
  - `lib/library/client.ts`: funzioni fetch per i componenti client, costruite su `requestJson` di [[http-helpers]]: `fetchRecipeDetail` e, dalla Feature 9, `requestRecipeProposal` e `requestSaveRecipe`.
  - `app/api/recipes/route.ts` e `app/api/recipes/[id]/route.ts`: route handler HTTP. Dalla Feature 9 `app/api/recipes/route.ts` contiene anche il `POST` del salvataggio di una proposta, documentato in [[recipe-proposal-service]].
- **Scopo**: esporre la libreria come elenco di card leggere e il dettaglio completo di una ricetta, con il giudizio e l'impatto di ogni suo ingrediente.
- **Regola di confine client/server** (requirements P1): i componenti `"use client"` importano da `lib/library/` **solo** `client.ts`. Non esiste un barrel `lib/library/index.ts`, come per `lib/plans/` e `lib/settings/`.

## Funzioni Pure (`lib/domain/library.ts`)

| Funzione | Comportamento |
|---|---|
| `recipeIngredientNames(recipe)` | Nomi canonici normalizzati (`normalizeCanonicalName`) degli ingredienti, distinti, nell'ordine della ricetta; scarta i nomi vuoti. Ricetta senza ingredienti → `[]` |
| `toLibraryCard(recipe)` | `LibraryRecipeCard` da una `Recipe`: `ingredient_names` da `recipeIngredientNames`, `created_at` in ISO; senza riga di preferenze `rating: null`, `favorite` e `blocked` `false` |
| `matchesLibraryFilter(card, filter)` | `true` se la card soddisfa **tutti** i criteri (v. sotto) |
| `compareLibraryCards(a, b)` | Ordine della Libreria: preferite prima, poi `created_at` decrescente (confronto tra stringhe ISO), poi titolo con `localeCompare(…, 'it')`, poi `id` |
| `filterLibraryCards(cards, filter)` | Filtra e ordina; restituisce un array nuovo, senza mutare l'input |
| `parseLibraryQuery(params)` | Legge il filtro dalla query string di `GET /api/recipes`: `{ ok: true, filter }` oppure `{ ok: false, issues }` |
| `recipeRequestText(query)` (Feature 9) | Testo da mandare al modello per una richiesta libera: il testo cercato senza spazi ai bordi, oppure `null` se è più corto di `RECIPE_REQUEST_MIN` (3) o più lungo di `LIBRARY_QUERY_MAX` (100). Decide quando compare il riquadro *Chiedi una ricetta per «…»* ([[recipe-proposal-sheet]]) |
| `appendProposedTitle(titles, title)` (Feature 9) | Sequenza di *Un'altra*: aggiunge `title` in coda, toglie un eventuale doppione per titolo normalizzato (`normalizeTitle`) e tiene gli ultimi `PROPOSAL_EXCLUDE_MAX` (10). Restituisce un array nuovo |

Dalla Feature 9 `toLibraryCard` e `compareLibraryCards` servono anche il selettore del Piano (`listSlotCandidates` in [[plan-service]]), e `filterLibraryCards` la sua ricerca ([[slot-recipe-picker]]), con le stesse regole della Libreria.

### Criteri del filtro (in AND)
1. **Bloccate**: con `filter.blocked` passano solo le bloccate; senza, le bloccate sono nascoste.
2. **Preferite**: con `filter.favorites` passano solo le preferite.
3. **Pasti** e **tag**: ogni valore selezionato deve essere presente nella card.
4. **Diete**: ogni dieta selezionata deve stare in `expandDietFlags(card.diet_flags)`, quindi una ricetta vegana soddisfa anche *Vegetariano*; non vale il contrario (stessa regola del planner, [[domain-types]]).
5. **Ricerca**: `normalizeTitle(filter.q)` spezzato in parole; ogni parola deve essere sottostringa di `normalizeTitle` di titolo + nomi canonici degli ingredienti. Quindi niente accenti né maiuscole, ordine delle parole libero, e `zucchina` trova una ricetta che la contiene anche se non è nel titolo. Senza parole la ricerca non filtra.

### Query string (`parseLibraryQuery`)
| Parametro | Campo | Regola |
|---|---|---|
| `q` | `q` | Trim; al più `LIBRARY_QUERY_MAX` (100) caratteri |
| `pasto` (ripetibile) | `meals` | Valori di `MealType`, senza doppioni |
| `tag` (ripetibile) | `tags` | Valori di `MealStyleTag`, senza doppioni |
| `dieta` (ripetibile) | `diets` | Valori di `DietFlag`, senza doppioni |
| `preferite`, `bloccate` | `favorites`, `blocked` | Assente → `false`; `1` / `true` → `true`; `0` / `false` → `false`; ogni altro valore è rifiutato |

I parametri sconosciuti sono ignorati; un valore fuori enum fa fallire la validazione di `LibraryFilterSchema`. Non esiste la funzione inversa (`buildLibraryQuery`), prevista dal piano e tolta dalla review architetturale (R6): nessun componente costruisce questa query.

## Servizio (`lib/library/service.ts`)

```ts
export async function listLibraryCards(householdId?: string): Promise<LibraryRecipeCard[]>;
export async function listLibrary(filter: LibraryFilter, householdId?: string): Promise<LibraryView>;
export async function getRecipeDetail(recipeId: string, householdId?: string): Promise<RecipeDetailView | null>;
```

Tutte risolvono l'household con `loadHousehold(householdId)` ([[household-repo]]): singleton di default se l'id è assente. Il parametro esiste per i test DB, che lavorano su household dedicati.

- **`listLibraryCards`**: `listRecipes({ household_id })` ([[recipe-repo]]) → `toLibraryCard` → `compareLibraryCards`. Restituisce anche le bloccate. È la lettura della pagina `/libreria` ([[library-screen]]).
- **`listLibrary`**: `{ recipes: filterLibraryCards(cards, filter), total: cards.length }`; `total` conta tutta la libreria, bloccate comprese.
- **`getRecipeDetail`**: cerca la ricetta nella libreria dell'household (assente o di un altro household → `null`), legge i giudizi con `listIngredientPrefRows` ([[ingredient-pref-repo]]) e calcola l'impatto con `countRecipesByIngredient` ([[prefs-service]]). Restituisce `{ recipe, ingredients }` con una voce per nome canonico distinto, nell'ordine della ricetta: `{ canonical_name, pref: 'like' | 'dislike' | null, recipes_count }`.

### Costo delle letture
Ogni chiamata legge e valida **l'intera libreria** dell'household, anche `getRecipeDetail` (che è chiamata a ogni apertura del dettaglio, pure dal Piano). Il commento in testa al file riporta la misura della review architetturale (circa 60 ms a 300 ricette su desktop) e il rimedio, da applicare se lo scheletro del dettaglio diventa percepibile sul Raspberry: conteggio in SQL per il solo ingrediente richiesto, sull'indice `recipe_ingredients_canonical_name_idx` ([[database-schema]]), e lettura della ricetta per id. I contratti del servizio non cambierebbero.

## API HTTP

Entrambe le rotte hanno `runtime = 'nodejs'` e `dynamic = 'force-dynamic'`; gli errori imprevisti si loggano con il tag (`[api/recipes]`, `[api/recipes/id]`) e diventano `internalErrorResponse()`, senza dettagli interni nel corpo ([[http-helpers]]).

| Metodo e rotta | Input | Successo | Errori |
|---|---|---|---|
| `GET /api/recipes` | query string (v. sopra) | 200 `LibraryView` (`{ recipes, total }`) | 400 `invalid_request` con `details`; 500 `internal_error` |
| `GET /api/recipes/:id` | — | 200 `RecipeDetailView` (`{ recipe, ingredients }`) | 404 `recipe_not_found` (`Ricetta non trovata.`) per id non UUID, ricetta inesistente o di un altro household; 500 |
| `POST /api/recipes` (Feature 9) | `{ recipe }` | 201 `{ recipe }` | v. [[recipe-proposal-service]] |

Un id non UUID risponde 404 senza chiamare il servizio. Nessuna classe d'errore nuova: il servizio restituisce `null` e la rotta lo traduce in 404 (requirements P19). `POST /api/recipes/generate` ([[recipe-generation]]) è un segmento statico distinto e resta com'è.

`GET /api/recipes` applica i filtri lato server con le stesse funzioni pure della schermata, ma l'interfaccia v1 **non la chiama**: la Libreria riceve tutte le card dalla pagina server e filtra in memoria (requirements P8 e P20).

## Client (`lib/library/client.ts`)

```ts
export function fetchRecipeDetail(recipeId: string): Promise<RecipeDetailView>;   // GET /api/recipes/{id}
```

Valida la risposta con `RecipeDetailViewSchema` (le date tornano `Date`) e in caso d'errore lancia `ApiRequestError` così com'è, senza sottoclasse. `fetchLibrary`, prevista dal piano, non esiste (R6).

Dalla Feature 9 (requirements P13):

```ts
export interface RecipeProposalInput {
  request: string;
  mealType: MealType | null;          // imposto dal Piano; null = lo decide il modello
  excludeTitles: readonly string[];   // titoli già proposti nella sequenza di «Un'altra»
}
export function requestRecipeProposal(input: RecipeProposalInput, signal?: AbortSignal): Promise<RecipeProposal>; // POST /api/recipes/propose
export async function requestSaveRecipe(recipe: GeneratedRecipe): Promise<Recipe>;                                // POST /api/recipes
```

- `requestRecipeProposal` invia `{ request, meal_type, exclude_titles }` e valida con `RecipeProposalSchema`. `signal` annulla la richiesta; in quel caso la promessa rigetta con `network_error` (`requestJson` non distingue l'annullamento dalla rete assente), quindi chi annulla controlla `signal.aborted` e ignora l'esito ([[recipe-proposal-sheet]]).
- `requestSaveRecipe` valida con `SaveRecipeResultSchema` e restituisce `result.recipe`, la ricetta completa con ingredienti e preferenze. La usano la Libreria ([[library-screen]]) e il selettore del Piano ([[slot-recipe-picker]]).

## Test

- `tests/domain/library.test.ts` (puro): nomi degli ingredienti, card con e senza preferenze, un caso per ogni criterio del filtro (compresi vegana → vegetariano e il caso inverso), ricerca per titolo e per ingrediente, ordinamento, immutabilità dell'input, `parseLibraryQuery` (vuota, completa, valori non validi, parametri sconosciuti).
- `tests/domain/library-contracts.test.ts`: `RecipeDetailViewSchema` su una ricetta delle fixture serializzata, nome canonico oltre gli 80 caratteri accettato nel dettaglio.
- `tests/library/service.test.ts` (DB reale, household dedicati): bloccate comprese e preferite in testa, `total`, dettaglio con giudizio e impatto, ricetta di un altro household e id inesistente → `null`.
- `tests/api/recipes.test.ts` (servizio mockato): filtro passato al servizio, 400 con `details`, 500 senza messaggio interno, 200 e 404 del dettaglio, id non UUID.
- `tests/library/client.test.ts`: URL, codifica dell'id, `ApiRequestError` con il codice del server; dalla Feature 9 corpo e `signal` di `requestRecipeProposal`, ricetta restituita da `requestSaveRecipe`, errori.
- Dalla Feature 9 `tests/domain/library.test.ts` copre anche `recipeRequestText` (vuoto, troppo corto dopo il trim, trim, esattamente 100, oltre 100) e `appendProposedTitle` (coda, doppione normalizzato, ultimi 10, input non mutato).

## Vedi anche

- [[library-screen]] — Schermata che usa `listLibraryCards` e le funzioni pure
- [[recipe-detail-sheet]] — Consumatore di `fetchRecipeDetail`
- [[prefs-service]] — `countRecipesByIngredient` e API delle preferenze
- [[recipe-repo]] — `listRecipes`, la lettura completa della libreria
- [[ingredient-pref-repo]] — Giudizi sugli ingredienti letti dal dettaglio
- [[domain-types]] — `LibraryFilter`, `LibraryRecipeCard`, `LibraryView`, `RecipeDetailView`
- [[http-helpers]] — Busta d'errore e `requestJson`
- [[e2-libreria-preferenze]] — Panoramica della Feature 5
- [[recipe-proposal-service]] — `POST /api/recipes` e `POST /api/recipes/propose` (Feature 9)
- [[f9-ricette-su-richiesta]] — Panoramica della Feature 9
