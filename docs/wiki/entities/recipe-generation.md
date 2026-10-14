---
title: Servizio di Generazione e Route API (recipe-generation)
type: entity
created: 2026-09-17
updated: 2026-10-14
tags: [recipes, generation, constraints, deduplication, api-route, transactions, advisory-lock, batches, ingredient-prefs]
---

## File e Responsabilità

- **Percorsi file**:
  - `lib/recipes/constraints.ts`: aggregazione dei vincoli (`buildConstraints`) e verifica post-generazione (`findConstraintViolations`).
  - `lib/recipes/generate.ts`: logica orchestratrice del servizio `generateAndStoreRecipes`, gestione lock transazionale e pipeline di deduplicazione.
  - `lib/recipes/store.ts` (Feature 9): `insertGeneratedRecipe`, la scrittura di una ricetta generata con slug univoco, condivisa con il salvataggio delle ricette chieste ([[recipe-proposal-service]]).
  - `lib/recipes/index.ts`: modulo di esportazione del dominio ricette (riesporta `constraints` e `generate`). La Feature 9 **non** l'ha modificato: i suoi file (`propose.ts`, `store.ts`, `errors.ts`, `http.ts`) si importano direttamente, perché i test esistenti sostituiscono il barrel con un mock che elenca solo `generateAndStoreRecipes` (requirements P1 della Feature 9).
  - `app/api/recipes/generate/route.ts`: route handler Next.js `POST /api/recipes/generate` con validazione input e mappatura degli errori HTTP.
- **Scopo**: Gestire l'intero ciclo di vita della generazione ricette: tradurre il profilo del nucleo familiare e le preferenze contingenti in vincoli formali, invocare l'adapter LLM all'esterno di transazioni DB, applicare una severa cascata di filtri anti-duplicazione e persistere le nuove ricette in modo atomico.

## Gestione dei Vincoli (`constraints.ts`)

La composizione e la validazione dei vincoli operano tramite due funzioni pure:

### `buildConstraints(household, mealType, overrides?, ingredientPrefs?): RecipeConstraints`
Fonde i valori di base configurati nell'anagrafica del nucleo familiare ([[household-repo]]) con eventuali sovrascritture temporanee fornite dall'utente (`ConstraintOverrides`):
- `persons`: numero di coperti (priorità ad `overrides.persons`, altrimenti `household.persons`); ammesso in `[PERSONS_MIN, PERSONS_MAX]` (1..12, costanti condivise con le impostazioni dalla Feature 3).
- `meal_type`: pasto target (`pranzo` o `cena` o `null` per generazione mista).
- `diet_tags`: array di regimi dietetici attivi.
- `meal_style_tags`: stili desiderati (es. `veloce`, `salutare`).
- `appliances`: elettrodomestici disponibili per la preparazione.
- `ingredient_likes` e `ingredient_dislikes`: fino alla Feature 4 erano sempre liste vuote. Dalla Feature 5 arrivano dal quarto parametro opzionale `ingredientPrefs: IngredientPreferenceSets` ([[planner]]): i gradimenti in ordine alfabetico italiano, **al più `PROMPT_INGREDIENT_LIKES_MAX` = 30**; gli scarti in ordine alfabetico, **tutti**, perché servono anche a `findConstraintViolations`. Senza il parametro le due liste restano vuote. `buildConstraints` resta pura: gli insiemi li legge chi la chiama, tramite `loadIngredientPreferences` in `lib/prefs/ingredient-prefs.ts` (modulo neutro importabile sia da `recipes` sia da `plans`, proposta R4 della review architetturale di F4; v. [[prefs-service]]).

### `findConstraintViolations(recipe, constraints): string[]`
Esegue un controllo deterministico a posteriori su ciascuna ricetta generata dall'LLM per verificare che il modello non abbia ignorato i vincoli richiesti:
1. **Pasto mancante**: se `constraints.meal_type` è valorizzato ma assente in `recipe.meal_types` (es. `pasto "pranzo" mancante`).
2. **Dieta non rispettata**: verifica che ogni dieta richiesta sia coperta, calcolando la chiusura transitiva tramite `expandDietFlags` (es. una ricetta dichiarata solo `vegano` soddisfa anche `vegetariano`, `senza-lattosio` e `pescetariano`). Eventuali mancanze generano `dieta "<dieta>" non rispettata`.
3. **Elettrodomestico non disponibile**: controlla che nessun elemento di `recipe.appliances_required` sia assente da `constraints.appliances` (es. `richiede "forno" non disponibile`).
4. **Ingrediente escluso**: controlla se uno degli ingredienti coincide, per nome canonico normalizzato (`normalizeCanonicalName`), con un elemento di `constraints.ingredient_dislikes` (messaggio `contiene "<nome>" (ingrediente escluso)`). Il confronto è per **uguaglianza esatta**: scartare `cipolla` non fa rifiutare una ricetta con `cipolla rossa` (decisione D1 della Feature 5, v. [[e2-libreria-preferenze]]). La funzione non è cambiata nella Feature 5: sono cambiati i dati, che ora non sono più vuoti.

Restituisce l'elenco delle violazioni: un array vuoto attesta la piena conformità della ricetta.

Le stesse quattro regole sono applicate alla libreria da `exclusionReason` del planner ([[planner]]); dalla Feature 4 un commento incrociato nei due file ricorda di allinearle quando se ne modifica una (proposta P3 della review architetturale).

**Dalla Feature 9** le due funzioni servono anche le ricette chieste dall'utente ([[recipe-proposal-service]]), senza varianti (requirements P27 della Feature 9): `proposeRecipe` e `saveProposedRecipe` chiamano `buildConstraints(household, mealType, { meal_style_tags: [] })` senza il quarto parametro, quindi con `ingredient_dislikes` vuoto il controllo sugli ingredienti non scatta e una ricetta chiesta può contenere un ingrediente scartato (spec D7). Una ricetta che passa `findConstraintViolations` deve passare anche `manualChoiceExclusionReason` ([[planner]]), altrimenti il flusso *chiedi → salva → metti nel piano* fallirebbe a ogni richiesta: `tests/recipes/propose.test.ts` lo verifica per una ricetta appena salvata (innesto R6 della review architetturale della Feature 9). Le regole restano due copie tenute insieme da un commento, senza un test che le confronti per intero (osservazione P2 della stessa review).

I valori base arrivano dai vincoli che l'utente imposta nel wizard di primo avvio e in `/impostazioni` (Feature 3, [[e5-impostazioni]]); `tests/settings/service.test.ts` verifica che un salvataggio si rifletta in `buildConstraints`.

## Servizio Orchestratore (`generateAndStoreRecipes`)

La funzione `generateAndStoreRecipes` rappresenta il punto di ingresso per generare e archiviare nuove ricette nella libreria permanente:

```ts
export async function generateAndStoreRecipes(
  input: GenerateAndStoreInput,
  deps?: GenerateAndStoreDeps
): Promise<GenerateAndStoreResult>
```

### Regola Architetturale: Chiamata LLM Fuori Transazione
Per preservare le performance del database e prevenire lock prolungati sulle connessioni del pool Postgres, **la chiamata all'LLM (`generateRecipes`) avviene rigorosamente all'esterno di qualsiasi transazione database**.

Il flusso operativo si articola nelle seguenti fasi:
1. **Risoluzione Household**: `loadHousehold(input.householdId)` di [[household-repo]] carica il nucleo indicato o, se l'id è assente, il singleton di sistema; per un id inesistente lancia `Household <id> non trovato`. Dalla Feature 3 la regola, prima scritta in linea qui, è centralizzata nel repository e condivisa con il servizio impostazioni ([[settings-service]]); comportamento e messaggio sono invariati.
2. **Calcolo Vincoli**: dalla Feature 5 legge le preferenze ingrediente dell'household con `loadIngredientPreferences(household.id)` e genera l'oggetto `RecipeConstraints` con `buildConstraints(household, mealType, overrides, ingredientPrefs)`. Il prompt riporta così le righe `Ingredienti graditi: … (privilegiali quando sensato).` e `Ingredienti da non usare mai: ….`, che `lib/llm/prompts.ts` scriveva già ([[llm-adapter]], non modificato).
3. **Esclusione Titoli Recenti**: estrae dalla libreria i titoli più recenti associati all'household (`listRecipeTitles` con limite `EXCLUDED_TITLES_IN_PROMPT = 150`), iniettandoli nel prompt dell'LLM per minimizzare alla radice il rischio di ripetizioni.
4. **Invocazione LLM**: chiama `generateRecipes` ricevendo la lista di candidate normalizzate.
5. **Transazione Atomica DB (`db.transaction`)**: apre una transazione con livello di isolamento standard, all'interno della quale esegue l'elaborazione protetta. Dalla Feature 5, subito dopo il lock, **rilegge gli scarti** con `loadIngredientPreferences(household.id, tx)` e li sostituisce in una copia dei vincoli (`currentConstraints`) usata per il controllo delle violazioni: un 👎 salvato mentre la chiamata LLM era in corso vale già per le ricette appena generate (fix della code review). Il prompt, ormai inviato, resta quello costruito con i vincoli letti al passo 2.

### Advisory Lock per Concorrenza
All'avvio della transazione, viene invocato `acquireRecipeGenerationLock(tx)`, che acquisisce un lock di sessione a livello di transazione Postgres tramite:
```sql
SELECT pg_advisory_xact_lock(hashtext('mealy:recipes:generate'));
```
Questo lock serializza i processi di inserimento e previene race condition nel caso in cui più client o richieste concorrenti tentino di generare e inserire ricette per lo stesso nucleo contemporaneamente. Il lock viene rilasciato in automatico al `commit` o `rollback` della transazione.

### Cascata di Deduplicazione e Scarto

All'interno della transazione, ogni ricetta generata attraversa una sequenza a 4 livelli di filtraggio:

```
[Ricetta Generata]
       │
       ▼ Livello 1: findConstraintViolations(recipe, currentConstraints)
       ├─ (Violazioni riscontrate?) ──► Registra in `skipped` (reason: 'constraint_violation')
       │
       ▼ Livello 2: Titolo Esatto (normalizeTitle) vs Set `known`
       ├─ (Già presente in DB o intra-batch?) ──► Registra in `skipped` (reason: 'duplicate', 'titolo già presente in libreria')
       │
       ▼ Livello 3: findSimilarRecipeTitle(tx, household.id, title)
       ├─ (Similarità trigrammi > 0.6?) ──► Registra in `skipped` (reason: 'duplicate', 'simile a "..."')
       │
       ▼ Livello 4: uniqueSlug(tx, slugify(title))
       ├─ Risoluzione collisioni slug globali (-2, -3, ... -hex)
       │
       ▼ Inserimento Transazionale
       └─ insertRecipeWith(tx, recipe, ingredients) ──► Aggiunta a `created` e aggiornamento Set `known`
```

1. **Verifica Vincoli**: scarta le ricette non conformi tramite `findConstraintViolations`, sui vincoli con gli scarti riletti nella transazione. È questo controllo deterministico, e non la sola obbedienza del modello al prompt, a garantire che un ingrediente scartato non venga più generato (requirements P16 della Feature 5).
2. **Deduplicazione Esatta (intra-libreria e intra-batch)**: il titolo viene normalizzato via `normalizeTitle` (senza accenti, minuscolo, spazi compatti) e confrontato con il set dei titoli già noti (`known`). Se non presente, viene aggiunto a `known`, impedendo anche duplicati all'interno dello stesso lotto generato.
3. **Similarità Trigrammi (`findSimilarRecipeTitle`)**: interroga PostgreSQL sfruttando l'estensione `pg_trgm` e l'indice GIN su `recipes.title`. Se il coefficiente `similarity()` supera la soglia `TITLE_SIMILARITY_THRESHOLD = 0.6`, la ricetta viene considerata un doppione e scartata (es. "Risotto ai Funghi Porcini" vs "Risotto con Funghi Porcini").
4. **Generazione Slug Univoco (`uniqueSlug`)**: genera lo slug tramite `slugify(title)`. Se già esistente a livello globale (`slugExists`), tenta suffissi sequenziali `-2`, `-3` fino a `-99`, ricorrendo infine a un suffisso esadecimale casuale da 6 caratteri.
5. **Persistenza**: inserisce atomisticamente ricetta e ingredienti via `insertRecipeWith`.

Dalla Feature 9 i passi 4 e 5 non sono più scritti nel ciclo: la chiamata è `insertGeneratedRecipe(tx, household.id, recipe)` di `lib/recipes/store.ts`, dove è stata spostata anche la funzione privata `uniqueSlug`. Il comportamento della generazione a lotti è invariato (stessi campi, `source: 'llm'`, `macros_est: null`); la stessa funzione scrive le ricette chieste dall'utente ([[recipe-proposal-service]]), che però saltano il livello 3: per loro la somiglianza trigram non conta (spec D11).

L'oggetto finale restituito (`GenerateAndStoreResult`) riassume:
- `requested`: numero di ricette richieste.
- `created`: array delle `RecipeWithDetails` effettivamente create e salvate.
- `skipped`: array degli scarti tipizzati (`GenerationSkip`: `{ title, reason, detail }`).

### Chiamante principale dalla Feature 4: il servizio dei piani
`lib/plans/service.ts` ([[plan-service]]) è l'unico modulo applicativo che chiama `generateAndStoreRecipes` oltre alla rotta manuale, sempre **fuori** da transazioni (contratto R2 della review di F2). Non chiede mai più di `generationBatchSize` = 3 ricette per chiamata: il numero necessario per ogni tipo di pasto viene diviso in lotti (es. 10 → 3+3+3+1) lanciati tutti in parallelo con `Promise.allSettled`, così un giro dura quanto una chiamata da 3 (circa 38 s sul modello consigliato). Lo swap chiede 3 ricette per un solo pasto.

Limite noto (nota della code review di F4, preesistente): i titoli da escludere si calcolano prima della chiamata LLM, quindi lotti paralleli dello stesso pasto non si vedono tra loro; eventuali quasi-doppioni vengono scartati come `duplicate` dalla cascata (solo token sprecati, e può far partire il secondo giro).

## Endpoint HTTP: `POST /api/recipes/generate`

L'API route in `app/api/recipes/generate/route.ts` espone l'operazione al frontend e ai client esterni:

- **Configurazione Route**:
  - `runtime = 'nodejs'`
  - `dynamic = 'force-dynamic'`
  - `maxDuration = 300` (fino alla Feature 3 era `120`; l'Addendum D1 della review architetturale di F4 l'ha alzato perché una chiamata con riparazione può durare fino a `2 × LLM_TIMEOUT_MS`, e il timeout di default è passato a 90 s, v. [[llm-adapter]]). Sul Raspberry (Next standalone) `maxDuration` non è applicato: documenta il caso peggiore.
- **Validazione Payload**: valida il body JSON tramite `GenerateRecipesRequestSchema`:
  - `count`: numero ricette da generare (compreso tra `GENERATE_COUNT_MIN = 1` e `GENERATE_COUNT_MAX = 10`, default `GENERATE_COUNT_DEFAULT = 5`).
  - `meal_type`: `pranzo` | `cena` | `null` (default `null`).
  - `overrides`: oggetto strict opzionale con `persons`, `diet_tags`, `meal_style_tags`, `appliances`.
- **Risposta di Successo (HTTP 200 OK)**:
  Restituisce il JSON corrispondente a `GenerateAndStoreResult`.
- **Mappatura degli Errori HTTP**:

| Errore Catturato | Condizione | Status HTTP | Risposta JSON (error.code / error.message) |
|---|---|---|---|
| Richiesta malformata o Zod validation error | Body non JSON o campi errati | **400 Bad Request** | `code: 'invalid_request'` con dettagli |
| `LlmError` con `code: 'config'` | Provider non supportato o API key assente | **500 Internal Server Error** | `code: 'llm_not_configured'` |
| `LlmError` con `code: 'timeout'` | Timeout scaduto nella generazione LLM | **504 Gateway Timeout** | `code: 'llm_timeout'` |
| `LlmError` con `code: 'provider'` | Rete KO o errore fornitore (HTTP 4xx/5xx) | **502 Bad Gateway** | `code: 'llm_unavailable'` |
| `LlmError` con `code: 'invalid_output'` | Output non valido persistente dopo repair | **502 Bad Gateway** | `code: 'llm_invalid_output'` |
| Eccezione generica non gestita | Errore interno database o runtime | **500 Internal Server Error** | `code: 'internal_error'` |

Dalla Feature 4 la rotta costruisce queste risposte con gli helper condivisi di `lib/http/responses.ts` (`invalidRequestResponse`, `llmErrorResponse`, `internalErrorResponse`, v. [[http-helpers]]) invece dei blocchi `Response.json` scritti in linea; status, codici e messaggi sono invariati, il body si legge ancora con `request.json()` e l'errore si logga con `console.error('[api/recipes/generate]', err)`. La stessa mappatura degli errori LLM è usata dalle rotte dei piani.

## Vedi anche

- [[llm-adapter]] — Adapter AI SDK multi-provider, repair loop e classe `LlmError`
- [[recipe-repo]] — Metodi `insertRecipeWith`, `findSimilarRecipeTitle`, `slugExists`, `acquireRecipeGenerationLock`
- [[domain-types]] — Schemi di richiesta e risposta `GenerateRecipesRequestSchema` e `GenerationSkipSchema`
- [[e1-motore-ricette]] — Quadro complessivo dell'iniziativa Feature 2
- [[household-repo]] — `loadHousehold`, risoluzione dell'household
- [[e5-impostazioni]] — Feature 3: origine dei vincoli dell'household
- [[plan-service]] — Feature 4: chiamante a lotti da 3
- [[http-helpers]] — Helper di risposta usati dalla rotta
- [[planner]] — `exclusionReason`, le stesse regole sulla libreria
- [[prefs-service]] — `loadIngredientPreferences` e origine di scarti e gradimenti (Feature 5)
- [[e2-libreria-preferenze]] — Panoramica della Feature 5
- [[recipe-proposal-service]] — Feature 9: ricette chieste dall'utente, stessi vincoli e stessa scrittura
- [[f9-ricette-su-richiesta]] — Panoramica della Feature 9
