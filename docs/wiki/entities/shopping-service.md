---
title: Servizio Lista della Spesa, Errori, API e Client (shopping-service)
type: entity
created: 2026-10-09
updated: 2026-10-09
tags: [shopping-list, service, api-route, client-fetch, errors, advisory-lock, manual-items, feature-6]
---

## File e Responsabilità

- **Percorsi file**:
  - `lib/shopping/service.ts`: servizio **solo lato server** (schermata, lettura, creazione e aggiornamento della lista, spunta, articoli a mano).
  - `lib/shopping/errors.ts`: codici e classe `ShoppingError`, tabella `SHOPPING_ERROR_HTTP`. Nessun import dal DB.
  - `lib/shopping/http.ts`: `handleShoppingRouteError(err, tag)`, gestione errori comune alle rotte (solo server).
  - `lib/shopping/client.ts`: funzioni fetch per i componenti client, costruite su `requestJson` di [[http-helpers]].
  - `lib/shopping/check-queue.ts`: coda delle spunte, documentata in [[check-queue]].
  - `app/api/plans/[id]/shopping-list/route.ts`, `app/api/plans/[id]/shopping-list/items/route.ts`, `app/api/shopping-items/[id]/route.ts`: route handler HTTP.
- **Scopo**: legare una lista della spesa a un piano confermato, tenerla allineata al piano senza perdere spunte e articoli a mano, e servire la schermata Lista.
- **Confine client/server** (`plan.md` §0.3.4): i componenti `"use client"` importano da `lib/shopping/` **solo** `client.ts` e `check-queue.ts`; mai `service.ts`, `errors.ts`, `http.ts`. Nessun barrel `lib/shopping/index.ts`, come per `lib/plans/` e `lib/prefs/`.
- **Regola di architettura**: il modulo non chiama l'LLM e non importa `@/lib/plans/service`, `@/lib/recipes` né `@/lib/llm` (innesto R1 della review architetturale; un test di purezza legge le righe `import` del file). La regola "piano chiuso" arriva da `lib/domain/plan-status.ts` ([[shopping-list]]).
- **Costo delle letture** (innesto R6, commento in testa al file): `addManualShoppingItem` legge l'intera libreria e ogni lettura della lista carica il piano con le ricette complete. Se sul Raspberry si sente, il reparto si conta in SQL su `recipe_ingredients_canonical_name_idx` e l'intestazione del piano si legge senza slot.

## Servizio (`service.ts`)

```ts
export interface ShoppingServiceOptions {
  householdId?: string;   // default: singleton
  now?: () => Date;       // default: () => new Date()
}

export async function getShoppingScreen(options?: ShoppingServiceOptions & { planId?: string }): Promise<ShoppingScreenView>;
export async function getPlanShoppingList(planId: string, options?: ShoppingServiceOptions): Promise<PlanShoppingListView>;
export async function buildPlanShoppingList(planId: string, options?: ShoppingServiceOptions): Promise<PlanShoppingListView>;
export async function checkShoppingItem(itemId: string, checked: boolean, options?: ShoppingServiceOptions): Promise<ShoppingItemView>;
export async function addManualShoppingItem(planId: string, name: string, options?: ShoppingServiceOptions): Promise<{ item: ShoppingItemView; created: boolean }>;
export async function removeManualShoppingItem(itemId: string, options?: ShoppingServiceOptions): Promise<string>;
```

Le opzioni esistono per i test DB (household dedicati, orologio fisso).

### Concetti comuni
- **Household**: `loadHousehold(options.householdId)` ([[household-repo]]).
- **Orologio**: `today = todayInTimeZone(now(), APP_TIME_ZONE)` e `currentWeekStart = mondayOf(today)`, come in [[plan-service]].
- **Appartenenza**: un piano assente o di un altro household → `plan_not_found`; un articolo assente o di un altro household → `item_not_found`.
- **Vista del piano** (`PlanShoppingListView`): `editable = piano non chiuso`; `can_build = piano non chiuso e status === 'active'`; `list` è `null` finché la lista non è stata creata. Gli articoli sono ordinati con `compareShoppingItemsByAisle`; `recipes` contiene id e titolo delle ricette citate in `recipe_ids` che esistono ancora (`listRecipeRefs`, [[shopping-repo]]).

### `getShoppingScreen` — dato iniziale della pagina Lista
1. `plans`: i piani dell'household **confermati e non chiusi** (`listOpenPlans` filtrato su `status === 'active'`), per `week_start` crescente, ciascuno con `last_day` (domenica) e `has_list`.
2. Piano mostrato: quello richiesto con `planId` se è un UUID, esiste ed è dell'household; altrimenti `pickDefaultShoppingPlan(plans)` (regola U4, [[shopping-list]]). Un `planId` non valido o sconosciuto è ignorato senza errori.
3. `selected`: la vista di quel piano, o `null` se non c'è nulla da mostrare.

Un piano richiesto esplicitamente viene mostrato anche se è una **bozza** o un piano **chiuso**, senza entrare in `plans`: la bozza avrà `can_build: false` e nessuna lista, il piano chiuso `editable: false`.

### `getPlanShoppingList`
Legge il piano (`getPlanById`, [[plan-repo]]) e restituisce la sua vista. Nessuna scrittura.

### `buildPlanShoppingList` — crea o aggiorna
In **una transazione sotto `acquirePlanLock`** dell'household (requirements P9):
1. rilegge il piano con la transazione; chiuso → `plan_archived`; non `active` → `plan_not_confirmed` (in quest'ordine);
2. legge gli alias (`listIngredientAliases` → `toAliasMap`);
3. `buildShoppingList` sugli slot con `day >= today`: la lista copre i pasti da oggi in poi;
4. trova la lista del piano o la crea (`insertShoppingList`);
5. `reconcileShoppingItems` tra gli articoli **non a mano** già salvati e quelli costruiti;
6. applica le modifiche: `deleteShoppingItems`, un `updateGeneratedShoppingItem` per ogni chiave che resta, `insertShoppingItems` dei nuovi (non spuntati, `manual: false`);
7. `markShoppingListGenerated`: `generated_at = now()` e `needs_regeneration = false`.

Dopo il commit restituisce `getPlanShoppingList(planId)`. Gli articoli a mano non vengono mai letti dalla riconciliazione, quindi restano com'erano. Due costruzioni concorrenti dello stesso piano si serializzano sul lock e non producono doppioni.

### `checkShoppingItem`
Controlla appartenenza e piano chiuso (`plan_archived`), poi `setShoppingItemChecked`; se nel frattempo l'articolo è sparito → `item_not_found`. Singola scrittura, **senza lock e senza transazione**: `checked` è un valore assoluto e ripetere la richiesta è sicuro.

### `addManualShoppingItem`
Normalizza il nome con `normalizeCanonicalName`, poi **in una transazione sotto `acquirePlanLock`**:
1. piano dell'household (`plan_not_found`), non chiuso (`plan_archived`);
2. la lista deve esistere (`list_not_found`): l'aggiunta non crea liste;
3. nome vuoto o più lungo di `SHOPPING_ITEM_NAME_MAX` (80) dopo la normalizzazione → `RangeError('nome articolo non valido')`. La rotta lo valida prima con lo schema, quindi il caso riguarda solo chi chiama il servizio direttamente;
4. `findManualShoppingItem`: se esiste già un articolo a mano con quel nome lo restituisce con `created: false`;
5. altrimenti deduce il reparto con `inferShoppingCategory` sulla libreria dell'household letta con la transazione (`listRecipesWith(tx, …)`, [[recipe-repo]]) e sugli alias, e inserisce l'articolo con `qty: null`, `unit: null`, `checked: false`, `manual: true`, `recipe_ids: []`.

Il nome dell'articolo a mano **non** passa dagli alias: resta quello digitato, normalizzato. Gli alias servono solo a dedurre il reparto.

Ricerca e inserimento sotto lock sono un fix della code review (commit `e502c9b`): `shopping_items` non ha un vincolo di unicità sul nome, e due aggiunte sovrapposte dello stesso nome potevano creare due righe. Ora la seconda trova l'articolo della prima. Il requisito P9, che in origine prevedeva l'aggiunta senza lock, è stato aggiornato di conseguenza; `ARCHITECTURE §5.5` riporta il comportamento. Il piano prevedeva inoltre `listRecipes`: nel codice è `listRecipesWith`, perché la lettura avviene dentro la transazione.

### `removeManualShoppingItem`
Controlla appartenenza e piano chiuso, poi `item_not_manual` se l'articolo viene dal piano; altrimenti lo elimina e restituisce il suo id. Senza lock.

## Errori di Dominio (`errors.ts`)

| Codice | HTTP | Messaggio |
|---|---|---|
| `plan_not_found` | 404 | `Piano non trovato.` |
| `list_not_found` | 404 | `Lista della spesa non trovata.` |
| `item_not_found` | 404 | `Articolo non trovato.` |
| `plan_not_confirmed` | 409 | `Conferma il piano per creare la lista della spesa.` |
| `plan_archived` | 409 | `Questa settimana è conclusa: la lista si può solo consultare.` |
| `item_not_manual` | 409 | `Si possono rimuovere solo gli articoli aggiunti a mano.` |

`ShoppingError(code)` usa il messaggio della tabella; `isShoppingError(err)` è la type guard; `SHOPPING_ERROR_CODES` elenca i sei codici. Stessa forma di `PlanError` ([[plan-service]]): sei codici di dominio giustificano la classe, che la Feature 5 non aveva (requirements P16). `plan_not_found` e `plan_archived` esistono anche tra i codici dei piani, con un messaggio diverso per `plan_archived`.

## API HTTP

Tutte le rotte hanno `runtime = 'nodejs'` e `dynamic = 'force-dynamic'`. Un id non UUID risponde subito 404 (`plan_not_found` per le rotte del piano, `item_not_found` per quelle dell'articolo) senza chiamare il servizio. Gli errori passano da `handleShoppingRouteError(err, tag)`: uno `ShoppingError` diventa la risposta della tabella **senza log**; ogni altro errore si logga con il tag (`[api/plans/shopping-list]`, `[api/plans/shopping-list/items]`, `[api/shopping-items]`) e diventa `internalErrorResponse()`, senza dettagli interni ([[http-helpers]]).

| Metodo e rotta | Input | Successo | Errori |
|---|---|---|---|
| `GET /api/plans/:id/shopping-list` | — | 200 `PlanShoppingListView` (`list: null` se la lista non è stata creata) | 404 `plan_not_found`; 500 |
| `POST /api/plans/:id/shopping-list` | nessuno (il body è ignorato) | 200 `PlanShoppingListView` con la lista creata o aggiornata | 404 `plan_not_found`; 409 `plan_not_confirmed` / `plan_archived`; 500 |
| `POST /api/plans/:id/shopping-list/items` | `{ name }` strict, 1–80 caratteri dopo il trim, body obbligatorio | **201** `{ item }` se creato, **200** `{ item }` se esisteva già | 400 `invalid_request` (body vuoto o non JSON; validazione con `details`); 404 `plan_not_found` / `list_not_found`; 409 `plan_archived`; 500 |
| `PATCH /api/shopping-items/:id` | `{ checked: boolean }` strict, body obbligatorio | 200 `{ item }` | 400 `invalid_request`; 404 `item_not_found`; 409 `plan_archived`; 500 |
| `DELETE /api/shopping-items/:id` | — | 200 `{ id }` | 404 `item_not_found`; 409 `item_not_manual` / `plan_archived`; 500 |

`ARCHITECTURE §6` prevedeva tre rotte, con "spunta / modifica / aggiunta manuale" su una sola `PATCH`: la feature le ha separate in cinque (requirements P17) e ha aggiornato il documento.

## Client (`client.ts`)

```ts
export function fetchPlanShoppingList(planId: string): Promise<PlanShoppingListView>;       // GET  /api/plans/{id}/shopping-list
export function requestBuildShoppingList(planId: string): Promise<PlanShoppingListView>;    // POST /api/plans/{id}/shopping-list, senza body
export async function patchShoppingItem(itemId: string, checked: boolean, signal?: AbortSignal): Promise<ShoppingItemView>; // PATCH → .item
export async function postShoppingItem(planId: string, name: string): Promise<ShoppingItemView>;  // POST …/items → .item (nuovo o già presente)
export async function deleteShoppingItem(itemId: string): Promise<void>;                    // DELETE /api/shopping-items/{id}
```

Gli id sono codificati con `encodeURIComponent`; ogni risposta 2xx è validata con lo schema Zod corrispondente e gli errori sono `ApiRequestError` così com'è, senza sottoclassi (come `lib/prefs/client.ts`). `patchShoppingItem` riceve il `signal` dal chiamante: la coda lo usa per il limite di tempo, e una richiesta interrotta diventa `network_error` con `status 0`, cioè un ritentativo ([[check-queue]]). Le altre quattro si danno da sole un limite di 10 s (`SHOPPING_REQUEST_TIMEOUT_MS`, un `AbortController` per richiesta con il timer annullato alla risposta): allo scadere lanciano lo stesso `network_error`, che la schermata mostra come errore di rete. Non c'è ritentativo automatico: l'utente ripete il gesto.

Li usano [[shopping-screen]] (tutte) e [[plan-screen]] (`fetchPlanShoppingList` e `requestBuildShoppingList`, per il footer).

## Test

- `tests/shopping/service.test.ts`: test di purezza degli import (senza DB); con DB reale, lista creata dal piano confermato con quantità, reparti e ricette; pasti passati esclusi; bozza rifiutata senza creare la lista; piano chiuso consultabile ma non modificabile; altro household e id inesistenti; aggiornamento che conserva spunte e articoli a mano e azzera `needs_regeneration`; spunta conservata se la quantità non aumenta; alias a un solo passo sommati sotto il nome canonico; spunta con i controlli di appartenenza e stato; articolo a mano con reparto dalla libreria e idempotente sul nome; rifiuti dell'aggiunta; rimozione dei soli articoli a mano; scelta del piano della schermata (compresi bozza richiesta, `planId` non valido, piani conclusi); **due costruzioni concorrenti** senza doppioni; **due aggiunte a mano sovrapposte** dello stesso nome con un solo articolo. I nomi d'ingrediente dei test non sono alias del seed, perché `ingredient_aliases` è globale.
- `tests/api/shopping-list.test.ts`, `tests/api/shopping-items.test.ts` (servizio mockato): `runtime` e `dynamic`, status e corpi, 201 e 200 dell'aggiunta, nome passato già rifilato, body vuoto o con campi in più, id non UUID senza chiamare il servizio, ogni `ShoppingErrorCode` con lo status della tabella, nessun messaggio interno nei 500.
- `tests/shopping/client.test.ts`: URL, metodi e body, `signal` passato o assente, 200 per un articolo già presente, codifica degli id, mappatura degli errori, `network_error` anche per una richiesta interrotta, limite di tempo delle quattro chiamate senza coda (timer finti) e nessun timer lasciato dopo la risposta.
- `tests/domain/shopping-contracts.test.ts`: schemi delle richieste e delle viste.

## Vedi anche

- [[shopping-list]] — Funzioni pure usate dal servizio
- [[shopping-repo]] — Persistenza di liste, articoli e alias
- [[check-queue]] — Coda che chiama `patchShoppingItem`
- [[shopping-screen]] — Pagina che usa servizio e client
- [[plan-repo]] — `getPlanById` e `acquirePlanLock`
- [[plan-concurrency-pattern]] — Perché costruzione e aggiunta stanno sotto il lock dei piani
- [[http-helpers]] — Busta d'errore, `readJsonBody`, `requestJson`
- [[domain-types]] — Contratti `Shopping List (Feature 6)`
- [[e4-lista-spesa]] — Panoramica della Feature 6
