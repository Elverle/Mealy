---
title: Servizio Piani, API e Client (plan-service)
type: entity
created: 2026-09-29
updated: 2026-09-29
tags: [plans, service, api-route, client-fetch, errors, generation, swap, repeat, week-navigator, feature-4]
---

## File e Responsabilità

- **Percorsi file**:
  - `lib/plans/service.ts`: orchestratore **solo lato server** (schermata, generazione, *Ripeti*, conferma, blocco, swap). Unico modulo che chiama `generateAndStoreRecipes` ([[recipe-generation]]), sempre fuori da transazioni.
  - `lib/plans/errors.ts`: codici e classe `PlanError`, tabella `PLAN_ERROR_HTTP`. Nessun import dal DB: usabile dal client.
  - `lib/plans/http.ts`: `handlePlanRouteError(err, tag)`, gestione errori comune alle rotte dei piani (solo server).
  - `lib/plans/client.ts`: funzioni fetch per i componenti client, costruite su `requestJson` di [[http-helpers]].
  - `lib/plans/format.ts`: etichette di giorni e settimane in italiano (puro, senza `Intl`, sicuro per il client).
  - `lib/prefs/ingredient-prefs.ts`: `loadIngredientPreferences(householdId, executor = db)`, punto di lettura condiviso delle preferenze ingredienti (in F4 restituisce sempre insiemi vuoti).
  - `app/api/plans/**`: route handler HTTP.
- **Regola di confine client/server** (requirements P1): i componenti `"use client"` importano da `lib/plans/` **solo** `client.ts`, `format.ts` ed `errors.ts`. Non esiste un barrel `lib/plans/index.ts`, come per `lib/settings/` ([[settings-service]]).

## Servizio (`service.ts`)

```ts
export interface PlanServiceOptions {
  householdId?: string;          // default: singleton
  now?: () => Date;              // default: () => new Date()
  rng?: Rng;                     // default: createRng(randomSeed())
  generate?: GenerateRecipesFn;  // default: generateAndStoreRecipes; mai dentro una transazione
  config?: PlannerConfig;        // default: PLANNER_CONFIG
}

export function isPlanClosed(plan: { status; week_start }, currentWeekStart: string): boolean;
export function toPlanView(plan: PlanWithSlots, household: Household): PlanView;
export async function getPlanScreen(options?: PlanServiceOptions & { week?: string }): Promise<PlanScreenView>;
export async function generatePlan(options?: PlanServiceOptions): Promise<GeneratePlanResult>;
export async function repeatPlan(sourcePlanId: string, options?: PlanServiceOptions): Promise<GeneratePlanResult>;
export async function confirmPlan(planId: string, options?: PlanServiceOptions): Promise<PlanResult>;
export async function setSlotLock(planId: string, slotId: string, locked: boolean, options?: PlanServiceOptions): Promise<PlanResult>;
export async function swapSlot(planId: string, slotId: string, request: SwapSlotRequest, options?: PlanServiceOptions): Promise<PlanMutationResult>;
```

Le opzioni esistono per i test DB (household dedicati, orologio fisso, RNG seedato, `generate` iniettato con `vi.fn`).

### Concetti comuni
- **Orologio**: `today = todayInTimeZone(now(), APP_TIME_ZONE)`, `currentWeekStart = mondayOf(today)`, `target = resolveTargetWeek(today)` ([[planner]]).
- **Piano chiuso**: `isPlanClosed` = `status === 'archived'` **oppure** `week_start < currentWeekStart`. La chiusura si calcola, non si legge dallo stato, perché `archivePlansBefore` scatta solo quando si crea un piano nuovo e un piano vecchio può restare `active` a settimana finita (Addendum D2). Blocco, conferma e swap sui piani chiusi → `plan_archived`.
- **`toPlanView`**: date in ISO; `superseded = household.updated_at > plan.generated_at` (contratto U1 della Feature 3 riferito a `generated_at`, requirements P8); slot con la ricetta completa; stato della lista.

### `getPlanScreen` — navigatore di settimane
1. `week` richiesta (`?settimana=`): ignorata se non è una data reale o se supera la settimana obiettivo; altrimenti portata al lunedì con `mondayOf`.
2. Settimana mostrata: quella richiesta; in assenza, la corrente se ha un piano, altrimenti quella obiettivo (nei feriali coincidono).
3. `view: PlanWeekView` con `plan`, `action` (`generate` / `regenerate` / `none`, ma solo la settimana obiettivo può avere un'azione), `editable` (piano presente e non chiuso), `can_repeat` (piano con almeno una ricetta, settimana diversa dall'obiettivo, obiettivo né confermato né chiuso).
4. `prev_week_start` / `next_week_start` tra le settimane **raggiungibili** = settimane con un piano ∪ corrente ∪ obiettivo, mai oltre l'obiettivo; le settimane passate senza piano si saltano.
5. `target_plan_status` (stato del piano obiettivo o `null`) e `current_plan_id` (nel weekend, il piano della settimana corrente ripetibile sull'obiettivo): servono al pulsante *Ripeti questa settimana* e, in prospettiva, alla Feature 6.

### `generatePlan` e `repeatPlan` — costruzione del piano obiettivo
Entrambe usano la funzione interna `buildTargetPlan(ctx, { preassigned?, generation, maxRounds })`:

- **Slot desiderati**: ogni giorno da `target.first_day` a `target.last_day` per ogni pasto di `household.meals`.
- **Slot mantenuti** (`kept`): quelli dei giorni passati e quelli **bloccati** (anche se il loro pasto non è più tra le impostazioni); gli altri si ricostruiscono. Le ricette dei `kept` entrano in `excludeRecipeIds`.
- **Fase 1, fuori dalle transazioni**: selezione con [[planner]] e, se serve, generazione. Ogni `MealTypeShortage` diventa `computeGenerationCount` ricette divise in **lotti da 3** (`splitGenerationBatches`); tutti i lotti di tutti i pasti partono in un solo `Promise.allSettled`. Un `LlmError` ferma i giri ma non il piano; un errore non LLM si rilancia. Il ciclo si ferma anche se un giro non crea nulla o al tetto `maxRounds`. Se resta uno slot vuoto: `throw llmError ?? PlanError('insufficient_recipes')` e **nulla viene scritto**.
- **Fase 2, transazione**: `acquirePlanLock`, rilettura del piano obiettivo (`plan_confirmed` / `plan_archived` se nel frattempo è cambiato), rilettura di **household e preferenze** con la transazione (`loadConstraints`, fix M1 della code review: un salvataggio delle impostazioni fatto durante la generazione viene applicato, e `generated_at` copre solo le impostazioni lette qui), rilettura della libreria con `listRecipesWith(tx, …)` e **nuova selezione** sullo stato riletto (v. [[plan-concurrency-pattern]]). Poi:
  - piano assente → `insertPlan` + `archivePlansBefore(currentWeekStart)`: si archiviano solo le settimane **concluse**, così nel weekend il piano in corso resta modificabile (proposta R3);
  - piano esistente (bozza) → `touchPlanGeneratedAt`, `markShoppingListStale` (fix m2), cancellazione degli slot non mantenuti, `servings = persons` sugli slot mantenuti futuri;
  - `insertSlots` degli slot riempiti con `servings = persons`, `locked: false`.
- **`generatePlan`**: modalità `needMore` (genera finché il planner segnala carenza), al più `maxGenerationRoundsPlan` giri. Restituisce `{ screen: getPlanScreen({ week: target.week_start }), generation: { rounds, created, failed } }`: `failed: true` significa che l'LLM ha fallito ma la libreria è bastata.
- **`repeatPlan(sourcePlanId)`** (Addendum D4): sorgente di un altro household → `plan_not_found`; sorgente della settimana obiettivo → `repeat_same_week`. Ogni slot sorgente con ricetta diventa una **pre-assegnazione** sullo stesso giorno della settimana e pasto dell'obiettivo; `computeSelection` la scarta se la ricetta non è più ammessa (`exclusionReason`: bloccata, dieta o elettrodomestici cambiati, dislike) o è già usata. Il resto lo riempie il planner; l'LLM parte **solo** se resta uno slot vuoto (modalità `unfilledOnly`, al più `maxGenerationRoundsSwap` giri). Il risultato è una bozza.

### `confirmPlan`
Piano di un altro household → `plan_not_found`; chiuso → `plan_archived`; già `active` → risposta senza scritture (idempotente). Altrimenti, sotto lock, `activateDraftPlan` e, solo se ha attivato davvero, `incrementRecipeUsage` con il **giorno di ogni slot** ([[plan-repo]]).

### `setSlotLock`
Sotto lock (una rigenerazione concorrente non può cancellare lo slot a metà): verifiche di appartenenza e chiusura, `slot_not_found` se lo slot non è del piano, poi `setSlotLocked`. Consentito su `draft` e `active`, **anche sui giorni passati**.

### `swapSlot`
1. Piano aperto dell'household; slot del piano (`slot_not_found`), non bloccato (`slot_locked`), non di un giorno passato (`slot_past`, decisione Q1 della code review).
2. Esclusioni = tutte le ricette del piano (compresa quella attuale) ∪ `request.exclude_recipe_ids` (le scartate nella sequenza *Cambia ancora*, max 50).
3. Se il planner non trova nulla: una generazione di `generationMin` (3) ricette per quel pasto, fuori da transazioni. **Non** si genera se esiste un'alternativa, anche poco pesata. Se ancora nulla: `llmError ?? PlanError('no_alternatives')`.
4. Transazione: lock, rilettura di piano, slot, impostazioni e libreria, nuova scelta, `updateSlotRecipe`; su piano `active` `incrementRecipeUsage([{ recipeId: nuova, day: slot.day }])` (la sostituita **non** si decrementa); `markShoppingListStale`.
5. `{ plan, generation }`, con `superseded` calcolato sull'household riletto.

## Errori di Dominio (`errors.ts`)

| Codice | HTTP | Messaggio |
|---|---|---|
| `plan_not_found` | 404 | `Piano non trovato.` |
| `slot_not_found` | 404 | `Pasto non trovato.` |
| `plan_confirmed` | 409 | `Il piano è già confermato: puoi cambiare i singoli pasti.` |
| `plan_archived` | 409 | `Questa settimana è conclusa: il piano si può solo consultare.` |
| `slot_locked` | 409 | `Sblocca il pasto per cambiarlo.` |
| `slot_past` | 409 | `Questo pasto è già passato.` |
| `repeat_same_week` | 409 | `Questo piano è già quello della settimana da pianificare.` |
| `insufficient_recipes` | 422 | `Non ho trovato abbastanza ricette per i tuoi vincoli. Prova ad allargare le impostazioni.` |
| `no_alternatives` | 422 | `Non ci sono altre ricette adatte a questo pasto.` |

`PlanError(code)` usa il messaggio della tabella; `isPlanError(err)` è la type guard.

## API HTTP (`app/api/plans/**`)

Tutte le rotte hanno `runtime = 'nodejs'` e `dynamic = 'force-dynamic'`. Un id o uno `slotId` non UUID risponde subito `404 plan_not_found` / `slot_not_found`. Gli errori passano da `handlePlanRouteError(err, tag)`: un `PlanError` diventa la risposta della tabella **senza log**; ogni altro errore si logga con il tag (`[api/plans]`, `[api/plans/current]`, `[api/plans/confirm]`, `[api/plans/slots]`, `[api/plans/swap]`, `[api/plans/repeat]`) e diventa `llmErrorResponse(err) ?? internalErrorResponse()` ([[http-helpers]]). Il corpo non contiene mai stack trace né messaggi interni.

| Metodo e rotta | Input | Successo | Errori | `maxDuration` |
|---|---|---|---|---|
| `GET /api/plans/current[?settimana=YYYY-MM-DD]` | query opzionale | 200 `PlanScreenView` | 500 | — |
| `POST /api/plans` | body vuoto o `{}` (strict: la settimana la calcola il server) | 200 `GeneratePlanResult` | 400 `invalid_request`; 409 `plan_confirmed` / `plan_archived`; 422 `insufficient_recipes`; errori LLM (500/502/504) solo se la libreria non basta e l'LLM fallisce | 500 |
| `POST /api/plans/:id/repeat` | — | 200 `GeneratePlanResult` | 404 `plan_not_found`; 409 `repeat_same_week` / `plan_confirmed`; 422; errori LLM | 250 |
| `POST /api/plans/:id/confirm` | — | 200 `PlanResult` | 404 `plan_not_found`; 409 `plan_archived` | — |
| `PATCH /api/plans/:id/slots/:slotId` | `{ locked: boolean }` (strict, body obbligatorio) | 200 `PlanResult` | 400; 404 `plan_not_found` / `slot_not_found`; 409 `plan_archived` | — |
| `POST /api/plans/:id/slots/:slotId/swap` | `{ exclude_recipe_ids?: uuid[] }` (max 50; body vuoto ammesso) | 200 `PlanMutationResult` | 400 con `details`; 404; 409 `plan_archived` / `slot_locked` / `slot_past`; 422 `no_alternatives`; errori LLM | 250 |

**Durate**: il caso peggiore di `POST /api/plans` è `maxGenerationRoundsPlan × 2 × LLM_TIMEOUT_MS` (ogni lotto può includere la chiamata di riparazione): 6 minuti con i default, 8 con `LLM_TIMEOUT_MS = 120000`, coperti da `maxDuration = 500`; swap e *Ripeti* fanno al più un giro (`2 × LLM_TIMEOUT_MS`) con `maxDuration = 250` (fix m3 della code review, `ARCHITECTURE §6`). Sul Raspberry (Next standalone) `maxDuration` non è applicato: conta solo per l'opzione Vercel.

## Client (`client.ts`)

```ts
export class PlanRequestError extends ApiRequestError {}               // name = 'PlanRequestError'
export function fetchPlanScreen(week?: string): Promise<PlanScreenView>;               // GET  /api/plans/current[?settimana=]
export function requestGeneratePlan(): Promise<GeneratePlanResult>;                   // POST /api/plans, body '{}'
export function requestConfirmPlan(planId: string): Promise<PlanResult>;              // POST /api/plans/{id}/confirm
export function requestSlotLock(planId: string, slotId: string, locked: boolean): Promise<PlanResult>;               // PATCH
export function requestSwapSlot(planId: string, slotId: string, excludeRecipeIds: string[]): Promise<PlanMutationResult>; // POST …/swap
export function requestRepeatPlan(planId: string): Promise<GeneratePlanResult>;       // POST /api/plans/{id}/repeat
```

Ogni funzione valida la risposta 2xx con lo schema Zod corrispondente e converte ogni `ApiRequestError` in `PlanRequestError` con gli stessi `status`, `code` e `message` (rete → `0` / `network_error` / `Connessione non disponibile.`; 2xx non conforme → `invalid_response`).

## Formattazione (`format.ts`)

`IT_WEEKDAYS`, `IT_MONTHS_SHORT`, `formatDayLabel('2026-09-30')` → `'Mercoledì 30'`, `formatWeekRange('2026-09-28', '2026-10-04')` → `'28 set – 4 ott'` (sempre con entrambi i mesi). `recipeChips` e `toRecipeDetail`, previste qui dal piano, vivono invece in `components/sheets/recipe-detail.ts` ([[recipe-sheet]], proposta R6).

## Test

- `tests/plans/service.test.ts` (DB reale, household dedicati, `now` fisso su mercoledì/sabato/lunedì, `createRng(1)`, `generate` finto): libreria ricca senza LLM, DB quasi vuoto con lotti, tetto dei giri, LLM fallito con e senza libreria sufficiente, weekend e archiviazione delle sole settimane concluse, rigenerazione con slot bloccati e giorni passati, porzioni e pasti aggiornati, conferma idempotente anche in parallelo, blocco, schermata e navigatore, `superseded`, concorrenza (slot bloccato/sbloccato da una transazione che tiene il lock mentre `generatePlan` è in coda su `pg_locks`, fix m1), impostazioni salvate durante la generazione (fix M1).
- `tests/plans/swap.test.ts` e `tests/plans/repeat.test.ts` (DB): mai ripetizioni, generazione solo senza alternative, errori di dominio, uso su piano confermato, lista marcata da rigenerare, swap concorrenti, `slot_past`, pre-assegnazioni di *Ripeti*.
- `tests/api/plans.test.ts`, `tests/api/plans-swap.test.ts`, `tests/api/plans-repeat.test.ts` (servizio mockato): status, corpi, `maxDuration`, mappatura di ogni `PlanErrorCode` e degli errori LLM, nessun messaggio interno nei 500.
- `tests/plans/client.test.ts` e `tests/plans/format.test.ts`.

## Vedi anche

- [[planner]] — Selezione pesata, settimane e lotti di generazione
- [[plan-repo]] — Persistenza, lock e uso delle ricette
- [[plan-concurrency-pattern]] — Generazione fuori, selezione dentro il lock
- [[http-helpers]] — Busta d'errore, `readJsonBody`, `requestJson`
- [[plan-screen]] — Pagina Piano che usa il client
- [[recipe-generation]] — `generateAndStoreRecipes`, chiamata a lotti
- [[household-repo]] — `loadHousehold` e rilettura con `executor`
- [[e3-pianificatore]] — Panoramica della Feature 4
