---
title: Servizio Piani, API e Client (plan-service)
type: entity
created: 2026-09-29
updated: 2026-10-27
tags: [plans, service, api-route, client-fetch, errors, generation, swap, repeat, week-navigator, manual-choice, compositions, side-dish, feature-4, feature-8, feature-9, feature-11]
---

## File e Responsabilità

- **Percorsi file**:
  - `lib/plans/service.ts`: orchestratore **solo lato server** (schermata, generazione, *Ripeti*, conferma, blocco, swap). Unico modulo che chiama `generateAndStoreRecipes` ([[recipe-generation]]), sempre fuori da transazioni.
  - `lib/plans/errors.ts`: codici e classe `PlanError`, tabella `PLAN_ERROR_HTTP`. Nessun import dal DB: usabile dal client.
  - `lib/plans/http.ts`: `handlePlanRouteError(err, tag)`, gestione errori comune alle rotte dei piani (solo server).
  - `lib/plans/client.ts`: funzioni fetch per i componenti client, costruite su `requestJson` di [[http-helpers]].
  - `lib/plans/format.ts`: etichette di giorni e settimane in italiano (puro, senza `Intl`, sicuro per il client).
  - `lib/prefs/ingredient-prefs.ts`: `loadIngredientPreferences(householdId, executor = db)`, punto di lettura condiviso delle preferenze ingredienti. In F4 restituiva sempre insiemi vuoti; dalla Feature 5 legge la tabella `ingredient_prefs` con la stessa firma, ed è documentata in [[prefs-service]]. `lib/plans/service.ts` non è stato modificato: la chiama già fuori dal lock e di nuovo dentro la transazione (`loadConstraints`), quindi scarti e gradimenti valgono per generazione, rigenerazione, *Ripeti* e swap, e un 👎 salvato durante una generazione lunga è visto dalla selezione finale.
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

export function isPlanClosed(plan: { status; week_start }, currentWeekStart: string): boolean; // dalla Feature 6 riesportata da lib/domain/plan-status.ts
export function toPlanView(plan: PlanWithSlots, household: Household): PlanView;
export async function getPlanScreen(options?: PlanServiceOptions & { week?: string }): Promise<PlanScreenView>;
export async function generatePlan(options?: PlanServiceOptions): Promise<GeneratePlanResult>;
export async function repeatPlan(sourcePlanId: string, options?: PlanServiceOptions): Promise<GeneratePlanResult>;
export async function confirmPlan(planId: string, options?: PlanServiceOptions): Promise<PlanResult>;
export async function setSlotLock(planId: string, slotId: string, locked: boolean, options?: PlanServiceOptions): Promise<PlanResult>;
export async function swapSlot(planId: string, slotId: string, request: SwapSlotRequest, options?: PlanServiceOptions): Promise<PlanMutationResult>;
export async function listSlotCandidates(planId: string, slotId: string, options?: PlanServiceOptions): Promise<SlotCandidates>;          // Feature 9
export async function assignSlotRecipe(planId: string, slotId: string, recipeId: string, options?: PlanServiceOptions): Promise<PlanResult>; // Feature 9
export async function addSideDish(planId: string, mainSlotId: string, request: SwapSlotRequest, options?: PlanServiceOptions): Promise<PlanMutationResult>; // Feature 11
export async function removeSideDish(planId: string, sideSlotId: string, options?: PlanServiceOptions): Promise<PlanResult>;                            // Feature 11
```

Le opzioni esistono per i test DB (household dedicati, orologio fisso, RNG seedato, `generate` iniettato con `vi.fn`).

### Concetti comuni
- **Orologio**: `today = todayInTimeZone(now(), APP_TIME_ZONE)`, `currentWeekStart = mondayOf(today)`, `target = resolveTargetWeek(today)` ([[planner]]).
- **Piano chiuso**: `isPlanClosed` = `status === 'archived'` **oppure** `week_start < currentWeekStart`. La chiusura si calcola, non si legge dallo stato, perché `archivePlansBefore` scatta solo quando si crea un piano nuovo e un piano vecchio può restare `active` a settimana finita (Addendum D2). Blocco, conferma e swap sui piani chiusi → `plan_archived`.
  - **Dalla Feature 6** la funzione è definita in `lib/domain/plan-status.ts` (file puro, [[shopping-list]]); `lib/plans/service.ts` la importa da lì e la **riesporta soltanto** (`export { isPlanClosed }`), quindi chi la importava dal servizio continua a funzionare. Lo spostamento (innesto R1 della review architetturale della Feature 6) permette al servizio della lista di usare la regola senza importare questo modulo, che porta con sé `lib/recipes` e `lib/llm`. È l'unica modifica della Feature 6 a `lib/plans/`.
- **`toPlanView`**: date in ISO; `superseded = household.updated_at > plan.generated_at` (contratto U1 della Feature 3 riferito a `generated_at`, requirements P8); slot con la ricetta completa; stato della lista.

### `getPlanScreen` — navigatore di settimane
1. `week` richiesta (`?settimana=`): ignorata se non è una data reale o se supera la settimana obiettivo; altrimenti portata al lunedì con `mondayOf`.
2. Settimana mostrata: quella richiesta; in assenza, la corrente se ha un piano, altrimenti quella obiettivo (nei feriali coincidono).
3. `view: PlanWeekView` con `plan`, `action` (`generate` / `regenerate` / `none`, ma solo la settimana obiettivo può avere un'azione), `editable` (piano presente e non chiuso), `can_repeat` (piano con almeno una ricetta, settimana diversa dall'obiettivo, obiettivo né confermato né chiuso).
4. `prev_week_start` / `next_week_start` tra le settimane **raggiungibili** = settimane con un piano ∪ corrente ∪ obiettivo, mai oltre l'obiettivo; le settimane passate senza piano si saltano.
5. `target_plan_status` (stato del piano obiettivo o `null`) e `current_plan_id` (nel weekend, il piano della settimana corrente ripetibile sull'obiettivo): servono al pulsante *Ripeti questa settimana* e, in prospettiva, alla Feature 6. La Feature 6 non li ha poi usati: la tab *Lista* sceglie il piano con `getShoppingScreen` e `pickDefaultShoppingPlan` ([[shopping-service]]).

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

### Scelta a mano (Feature 9)
Accanto allo swap, l'utente può mettere in uno slot una ricetta precisa della libreria ([[f9-ricette-su-richiesta]], [[slot-recipe-picker]]). Le due funzioni stanno in `service.ts` perché riusano le funzioni private `resolveClock`, `loadOpenOwnedPlan` e `findSwappableSlot` dello swap. **Non** chiamano mai `generate` né l'LLM, non usano `rng` e non aggiungono a `service.ts` import da `lib/llm` o `lib/recipes` (spec D12); l'unica regola di idoneità è `manualChoiceExclusionReason` ([[planner]]). Se la ricetta voluta non c'è, è il client a chiederla e salvarla con `lib/recipes` ([[recipe-proposal-service]]) e poi ad assegnarla.

**`listSlotCandidates(planId, slotId)`**:
1. `loadHousehold`, orologio, `loadOpenOwnedPlan(db, …)` (`plan_not_found`, `plan_archived`) e `findSwappableSlot` (`slot_not_found`, `slot_locked`, `slot_past`): gli stessi controlli dello swap, senza transazione.
2. `listRecipesWith(db, { household_id })`, poi le ricette con `manualChoiceExclusionReason(recipe, slot.meal, household) === null` tranne quella dello slot, trasformate con `toLibraryCard` e ordinate con `compareLibraryCards` ([[library-service]]): preferite prima, poi le più recenti. Gli ingredienti «non mi piace» non escludono.
3. `in_plan_recipe_ids`: le ricette degli **altri** slot del piano, giorni passati compresi, senza doppioni (requirements P12).

Uno slot senza ricetta ha le sue candidate come gli altri.

**`assignSlotRecipe(planId, slotId, recipeId)`**: una transazione con `acquirePlanLock`, sullo stato riletto ([[plan-concurrency-pattern]]). Ordine dei controlli (requirements P11):
1. piano aperto dell'household (`plan_not_found`, `plan_archived`);
2. slot del piano, non bloccato, non passato (`slot_not_found`, `slot_locked`, `slot_past`);
3. household riletto con `getHouseholdById(id, tx)`; libreria riletta con `listRecipesWith(tx, …)`: ricetta assente o di un altro household → `recipe_not_found`;
4. `manualChoiceExclusionReason(recipe, slot.meal, household riletto)` non nullo (bloccata, altro pasto, dieta, elettrodomestico) → `recipe_not_eligible`;
5. ricetta già nello slot (richiesta ripetuta) → risposta con il piano, **senza scritture**;
6. altrimenti `updateSlotRecipe`, `incrementRecipeUsage([{ recipeId, day: slot.day }])` solo se il piano è `active`, `markShoppingListStale`, rilettura con `getPlanById`.

Restituisce `{ plan: toPlanView(updated, household riletto) }`. Gli effetti sono quelli dello swap; la ricetta tolta non si decrementa. Due assegnazioni sovrapposte sullo stesso slot si serializzano sul lock: entrambe rispondono 200 e nello slot resta una delle due ricette, quella dell'ultima transazione. È il punto in cui, in futuro, registrare il segnale implicito "scelta a mano" (`v2-funzionalita.md` §2.5); oggi non lo registra.

### Composizione del pasto (Feature 11)

Dalla Feature 11 ([[f11-composizione-pasto]]) uno slot è un **piatto** e il pasto è il gruppo di slot con lo stesso `(day, meal)`: un principale e, solo con un primo o un secondo, un contorno. Le regole pure stanno in [[compositions]] e nel [[planner]]; il servizio le applica. Le sezioni precedenti restano valide per i piani a un piatto per pasto; quello che cambia è qui.

**Chiavi.** `mealKey(day, meal)` = `${day}|${meal}` identifica il pasto; `slotKey(day, meal, course)` = `${day}|${meal}|${course}` il piatto (prima della Feature 11 la chiave dello slot era `${day}|${meal}`). `sameMeal(a, b)` confronta giorno e pasto. `courseFilterOf(slot)` dà il filtro della scelta a mano: `'contorno'` per il contorno, `'any-main'` per il principale.

**Costruzione del piano** (`buildTargetPlan` e `computeSelection`):
1. **Seme unico** (requirements P5): all'inizio di `buildTargetPlan` si prende una volta sola `compositionSeed = Math.floor(ctx.rng() * 0x1_0000_0000)`, e ogni `computeSelection` (giri di generazione e transazione finale) lo usa. Le composizioni restano le stesse tra un giro e l'altro, quindi la generazione chiede le portate che poi si scrivono. Il seme consuma una chiamata di `ctx.rng` prima di `selectRecipes`: per questo alcune attese dei test su una ricetta precisa con `rng` fisso sono cambiate (review R5).
2. **Pasti tenuti** (requirements P6): un pasto con almeno un piatto passato o bloccato si tiene **per intero** (`kept` = tutti i suoi slot) e non conta nel bilanciamento.
3. **Composizioni** (`assignCompositions`, privata): per ogni tipo di pasto, i pasti con una composizione imposta (`presetCompositions` di *Ripeti*) la tengono; gli altri ricevono `distributeCompositions(household.meal_compositions[meal], n, rng)` con `rng = createRng(compositionSeed)`, in ordine di giorno.
4. **Piatti** (`DishSlot`, uno `PlannerSlot` con la portata concreta): `compositionDishes` dà `[principale]` oppure `[principale, contorno]`.
5. **Pre-assegnazioni** di *Ripeti*: chiave `slotKey` con la portata; una ricetta si tiene solo se `exclusionReason(recipe, meal, course, …)` è nullo.
6. **Selezione** con `selectRecipes` sui piatti non pre-assegnati; `excludeRecipeIds` contiene le ricette dei pasti tenuti e delle pre-assegnazioni: nessuna ricetta compare due volte, contorni compresi.
7. **Generazione**: ogni giro calcola le richieste con `planGeneration(shortagesToGenerate(...), config)` (al più `generationMax` ricette per tipo di pasto, innesto R2), le divide in lotti con `splitGenerationBatches` e li lancia tutti in parallelo; ogni lotto chiama `generate({ householdId, count, mealType, courses: filterCourses(request.course) })`, quindi anche `['contorno']` ([[recipe-generation]]). Prima della Feature 11 ogni carenza riceveva `computeGenerationCount` ricette.
8. **Scrittura**: `insertSlots` con `course` per ogni piatto, `servings = persons`, `locked: false`.

***Ripeti*** (`repeatPlan`, spec D10): per ogni slot della sorgente raccoglie le portate del pasto e pre-assegna la ricetta sulla chiave con la portata. `mealCompositionOf` trasforma le portate di ogni pasto in una composizione imposta, **anche se non è più tra quelle ammesse**; una sorgente con portate che non formano una composizione non ne impone una. Un piatto la cui ricetta non è più idonea si riempie con il planner nella stessa portata; i pasti che mancano nell'origine prendono le composizioni ammesse, bilanciate.

**Blocco per pasto** (`setSlotLock`, spec D7): sotto lock trova lo slot (`slot_not_found`) e chiama `setMealLocked(tx, planId, slot.day, slot.meal, locked)` ([[plan-repo]]): tutti i piatti del pasto prendono lo stesso valore. `findSwappableSlot` considera bloccato uno slot se **un qualsiasi piatto del suo pasto** è bloccato (`slot_locked`), così regge anche dati incoerenti.

**`fillDish`** (privata, requirements P12): il flusso dello swap estratto in una funzione, condivisa da `swapSlot` e `addSideDish`. Riceve un `DishFill { check, course, write }`:
- `check(plan, slot)`: controlli in più sullo slot di partenza, ripetuti dopo ogni rilettura;
- `course(slot)`: portata del piatto da riempire;
- `write(tx, slot, recipeId)`: la scrittura dentro la transazione.

Fase 1, fuori da transazioni: piano aperto, `findSwappableSlot`, `check`, scelta con `selectRecipes` su uno slot con quella portata ed esclusioni = tutte le ricette del piano ∪ `exclude_recipe_ids`. Se non c'è nulla: una generazione di `generationMin` ricette con `courses: filterCourses(course)`, poi rilettura e nuovo tentativo; ancora nulla → `llmError ?? no_alternatives`. Fase 2, sotto `acquirePlanLock`: rilettura di piano, slot e vincoli, `check`, nuova scelta, `write`, `incrementRecipeUsage` se il piano è `active`, `markShoppingListStale`. Restituisce `{ plan, generation }`.

- **`swapSlot`** = `fillDish` con `check` vuoto, `course = slot.course` e `write = updateSlotRecipe`: il piatto **tiene la sua portata**, un principale cambia con un principale della stessa portata, un contorno con un contorno (*Cambia contorno* è uno swap sullo slot del contorno). Conseguenza per i piani migrati: uno slot che la migrazione `0007` ha messo a `piatto-unico` perché la ricetta non era classificata si cambia con un altro piatto unico (o una non classificata).
- **`addSideDish(planId, mainSlotId, request)`** = `fillDish` con `check = assertCanAddSide`, `course = 'contorno'` e `write` che inserisce uno slot `contorno` nello stesso giorno e pasto, con le **porzioni del principale** (spec D9) e `locked: false`. `assertCanAddSide` rifiuta uno slot che non sia `primo` o `secondo` (`side_not_allowed`: un piatto unico, o lo slot di un contorno) e un pasto che ha già un contorno (`side_exists`). Valgono anche `slot_locked`, `slot_past` e `plan_archived`. L'indice unico del DB è l'ultima difesa contro due aggiunte concorrenti.
- **`removeSideDish(planId, sideSlotId)`**: una sola transazione sotto lock; `findSwappableSlot` (`slot_locked`, `slot_past`), poi `not_a_side_dish` se lo slot non è un contorno; `deleteSlots`, `markShoppingListStale`, household riletto con `getHouseholdById(…, tx)`. Restituisce `{ plan }`, senza conferma (spec FR-5.8). L'uso della ricetta tolta non si decrementa.

**Scelta a mano per portata:**
- `listSlotCandidates` filtra con `manualChoiceExclusionReason(recipe, slot.meal, courseFilterOf(slot), household)`: sul principale una qualsiasi principale, sul contorno solo i contorni (spec FR-5.4, FR-5.5). Esclude, oltre alla ricetta dello slot, quella **dell'altro piatto dello stesso pasto** (fix della code review, `028fb7d`). Una ricetta di un altro pasto resta ammessa e compare in `in_plan_recipe_ids`, come dalla Feature 9.
- `assignSlotRecipe` controlla l'idoneità con lo stesso filtro, poi rifiuta con `recipe_not_eligible` la ricetta già nell'altro piatto dello stesso pasto (fix della code review). Sul principale la portata la decide `mainCourseForChoice(recipe.courses, slot.course, hasSide)` ([[compositions]]); `updateSlotRecipe(tx, slotId, recipeId, course)` la scrive insieme alla ricetta e, se diventa `piatto-unico`, il contorno del pasto si cancella nella stessa transazione. La composizione che ne esce può non essere tra quelle ammesse: la scelta a mano vince sulle Impostazioni. Una richiesta ripetuta (stessa ricetta e stessa portata) non scrive nulla.

**Lista della spesa**: nessuna modifica. Ogni slot è un piatto, quindi la lista consolida già i contorni alle porzioni del pasto ([[shopping-service]]); `tests/plans/side-dish.test.ts` lo verifica su un piano confermato.

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
| `recipe_not_found` | 404 | `Ricetta non trovata.` (Feature 9) |
| `recipe_not_eligible` | 422 | `Questa ricetta non è adatta a questo pasto.` (Feature 9) |
| `side_not_allowed` | 409 | `Questo pasto non prevede un contorno.` (Feature 11) |
| `side_exists` | 409 | `Questo pasto ha già un contorno.` (Feature 11) |
| `not_a_side_dish` | 409 | `Si può togliere solo il contorno.` (Feature 11) |

`PlanError(code)` usa il messaggio della tabella; `isPlanError(err)` è la type guard. Dalla Feature 11 `errors.ts` esporta anche `STALE_PLAN_ERROR_CODES: ReadonlySet<string>`, l'unico elenco dei codici che impongono al client di rileggere il piano mostrato: `slot_locked`, `slot_past`, `plan_archived`, `plan_not_found`, `slot_not_found`, `side_exists`, `side_not_allowed`, `not_a_side_dish` (proposta P3 della review architetturale della Feature 11). Lo importano [[slot-recipe-picker]] e `PlanSlotCard` ([[plan-screen]]) al posto delle costanti locali. `recipe_not_found` ha lo stesso codice e messaggio della risposta 404 di `GET /api/recipes/:id` ([[library-service]]), che però non passa da `PlanError`.

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
| `GET /api/plans/:id/slots/:slotId/candidates` (Feature 9) | — | 200 `SlotCandidates` | 404 `plan_not_found` / `slot_not_found`; 409 `plan_archived` / `slot_locked` / `slot_past`; 500 | — |
| `PUT /api/plans/:id/slots/:slotId/recipe` (Feature 9) | `{ recipe_id: uuid }` (strict, body obbligatorio) | 200 `PlanResult` | 400 con `details`; 404 `plan_not_found` / `slot_not_found` / `recipe_not_found`; 409 `plan_archived` / `slot_locked` / `slot_past`; 422 `recipe_not_eligible`; 500 | — |
| `POST /api/plans/:id/slots/:slotId/side` (Feature 11) | `{ exclude_recipe_ids?: uuid[] }` (lo stesso `SwapSlotRequestSchema` dello swap; body vuoto ammesso); `slotId` è il **principale** | 200 `PlanMutationResult` | 400 con `details`; 404; 409 `plan_archived` / `slot_locked` / `slot_past` / `side_not_allowed` / `side_exists`; 422 `no_alternatives`; errori LLM | 250 |
| `DELETE /api/plans/:id/slots/:slotId` (Feature 11) | nessun corpo; `slotId` è il **contorno**; stessa rotta del `PATCH` | 200 `PlanResult` | 404 `plan_not_found` / `slot_not_found`; 409 `plan_archived` / `slot_locked` / `slot_past` / `not_a_side_dish` | — |

Dalla Feature 11 il `PATCH` blocca o sblocca il **pasto** dello slot (tutti i suoi piatti) e lo swap tiene la portata del piatto; le firme delle rotte esistenti non cambiano. Tag di log: `[api/plans/side]` per l'aggiunta; il `DELETE` usa quello della rotta, `[api/plans/slots]`.

Tag di log delle due rotte della Feature 9: `[api/plans/candidates]` e `[api/plans/slot-recipe]`. Passano da `handlePlanRouteError` come le altre, quindi un errore LLM verrebbe mappato anche qui, ma il servizio non ne produce.

**Durate**: il caso peggiore di `POST /api/plans` è `maxGenerationRoundsPlan × 2 × LLM_TIMEOUT_MS` (ogni lotto può includere la chiamata di riparazione): 6 minuti con i default, 8 con `LLM_TIMEOUT_MS = 120000`, coperti da `maxDuration = 500`; swap, *Ripeti* e (dalla Feature 11) aggiunta del contorno fanno al più un giro (`2 × LLM_TIMEOUT_MS`) con `maxDuration = 250` (fix m3 della code review, `ARCHITECTURE §6`). Sul Raspberry (Next standalone) `maxDuration` non è applicato: conta solo per l'opzione Vercel.

## Client (`client.ts`)

```ts
export class PlanRequestError extends ApiRequestError {}               // name = 'PlanRequestError'
export function fetchPlanScreen(week?: string): Promise<PlanScreenView>;               // GET  /api/plans/current[?settimana=]
export function requestGeneratePlan(): Promise<GeneratePlanResult>;                   // POST /api/plans, body '{}'
export function requestConfirmPlan(planId: string): Promise<PlanResult>;              // POST /api/plans/{id}/confirm
export function requestSlotLock(planId: string, slotId: string, locked: boolean): Promise<PlanResult>;               // PATCH
export function requestSwapSlot(planId: string, slotId: string, excludeRecipeIds: string[]): Promise<PlanMutationResult>; // POST …/swap
export function requestRepeatPlan(planId: string): Promise<GeneratePlanResult>;       // POST /api/plans/{id}/repeat
export function fetchSlotCandidates(planId: string, slotId: string): Promise<SlotCandidates>;                        // Feature 9: GET …/candidates
export function requestAssignSlotRecipe(planId: string, slotId: string, recipeId: string): Promise<PlanResult>;      // Feature 9: PUT …/recipe
export function requestAddSideDish(planId: string, mainSlotId: string, excludeRecipeIds: string[]): Promise<PlanMutationResult>; // Feature 11: POST …/side
export function requestRemoveSideDish(planId: string, sideSlotId: string): Promise<PlanResult>;                        // Feature 11: DELETE, senza corpo
```

Ogni funzione valida la risposta 2xx con lo schema Zod corrispondente e converte ogni `ApiRequestError` in `PlanRequestError` con gli stessi `status`, `code` e `message` (rete → `0` / `network_error` / `Connessione non disponibile.`; 2xx non conforme → `invalid_response`).

## Formattazione (`format.ts`)

`IT_WEEKDAYS`, `IT_MONTHS_SHORT`, `formatDayLabel('2026-09-30')` → `'Mercoledì 30'`, `formatWeekRange('2026-09-28', '2026-10-04')` → `'28 set – 4 ott'` (sempre con entrambi i mesi). `recipeChips` e `toRecipeDetail`, previste qui dal piano, vivono invece in `components/sheets/recipe-detail.ts` ([[recipe-sheet]], proposta R6).

## Test

- `tests/plans/service.test.ts` (DB reale, household dedicati, `now` fisso su mercoledì/sabato/lunedì, `createRng(1)`, `generate` finto): libreria ricca senza LLM, DB quasi vuoto con lotti, tetto dei giri, LLM fallito con e senza libreria sufficiente, weekend e archiviazione delle sole settimane concluse, rigenerazione con slot bloccati e giorni passati, porzioni e pasti aggiornati, conferma idempotente anche in parallelo, blocco, schermata e navigatore, `superseded`, concorrenza (slot bloccato/sbloccato da una transazione che tiene il lock mentre `generatePlan` è in coda su `pg_locks`, fix m1), impostazioni salvate durante la generazione (fix M1).
- `tests/plans/swap.test.ts` e `tests/plans/repeat.test.ts` (DB): mai ripetizioni, generazione solo senza alternative, errori di dominio, uso su piano confermato, lista marcata da rigenerare, swap concorrenti, `slot_past`, pre-assegnazioni di *Ripeti*.
- `tests/api/plans.test.ts`, `tests/api/plans-swap.test.ts`, `tests/api/plans-repeat.test.ts` (servizio mockato): status, corpi, `maxDuration`, mappatura di ogni `PlanErrorCode` e degli errori LLM, nessun messaggio interno nei 500.
- `tests/plans/client.test.ts` e `tests/plans/format.test.ts`.
- `tests/plans/assign.test.ts` (Feature 9, DB): candidate solo adatte con ingredienti scartati ammessi e senza la ricetta dello slot, preferite prima, `in_plan_recipe_ids` senza la ricetta dello slot, rifiuti di piano e slot, slot senza ricetta; assegnazione su bozza senza toccare l'uso, su piano confermato con lista (uso contato, lista segnata), ingrediente scartato ammesso, ricetta già in un altro slot, ricetta inesistente o di un altro household, bloccata, di un altro pasto, non vegetariana o con un elettrodomestico mancante, richiesta ripetuta senza scritture, household riletto sotto lock, due assegnazioni sovrapposte. L'asserzione di confine `SlotCandidatesSchema.parse(JSON.parse(JSON.stringify(…)))` fissa la compatibilità con lo schema del client (innesto R6). `tests/api/plans-assign.test.ts` (servizio mockato) e casi aggiunti in `tests/plans/client.test.ts`.
- Feature 8 (nessuna modifica a `lib/plans/`: la regola sta nel planner, [[planner]]): `tests/plans/service.test.ts` (una libreria di soli contorni non riempie mai uno slot e risulta insufficiente; un piano con un contorno assegnato prima della regola si legge senza errori), `tests/plans/swap.test.ts` (lo swap non propone mai un contorno e prende un secondo libero), `tests/plans/assign.test.ts` (candidate senza i contorni, con i secondi della stessa dieta; assegnazione di un contorno rifiutata con `recipe_not_eligible` e slot invariato). I piani esistenti non cambiano: una ricetta assegnata prima resta nel suo slot anche se è solo contorno.
- Feature 11 (DB reale): `tests/plans/compose.test.ts` (cene composte con le composizioni ammesse e bilanciate senza chiamate al modello, una sola composizione `secondo-contorno`, generazione dei soli contorni quando mancano, al più `generationMax` ricette per tipo di pasto con più gruppi carenti, pasto bloccato con contorno tenuto identico da *Rigenera*, piano completo dal pacchetto vero senza il modello) e `tests/plans/side-dish.test.ts` (aggiunta nello stesso giorno e pasto con le stesse porzioni e la lista segnata; uso contato sul piano confermato; `side_not_allowed` su un piatto unico e su un contorno; `side_exists`; `slot_locked` e `slot_past`; generazione con `courses: ['contorno']`; rimozione e `not_a_side_dish`; *Scegli* di un piatto unico che toglie il contorno e di un primo che lo tiene; candidate per portata; blocco del pasto dal contorno; *Cambia contorno* che lascia il principale; stessa ricetta nei due piatti rifiutata ed esclusa dalle candidate; ricetta di un altro pasto ammessa e segnata; lista della spesa con il contorno). Casi aggiunti in `tests/plans/repeat.test.ts` (composizione e ricetta copiate anche se non più ammesse, contorno non più idoneo sostituito da un altro contorno) e ritocchi a `service.test.ts` e `swap.test.ts`; nella code review i file di test dei piani sono tornati a fine riga LF. Rotte: `tests/api/plans-side.test.ts` (`maxDuration` 250, corpo vuoto, 400, 404 senza chiamare il servizio, `side_exists` 409, `no_alternatives` 422, errore LLM 502, `DELETE` 200 e `not_a_side_dish` 409). Client ed errori: casi in `tests/plans/client.test.ts` (`requestAddSideDish`, `requestRemoveSideDish`, mappatura di `side_exists` e `not_a_side_dish`, messaggi italiani, contenuto di `STALE_PLAN_ERROR_CODES`).
- `tests/plans/ingredient-prefs.test.ts` (Feature 5, DB): con uno scarto attivo 20 piani seedati non contengono mai le ricette con quell'ingrediente e `generate` non viene chiamata; controprova senza lo scarto; swap senza alternative dopo uno scarto → `no_alternatives`. `tests/prefs/planner-integration.test.ts` fa lo stesso passando dai servizi delle preferenze, anche per una ricetta bloccata.

## Vedi anche

- [[planner]] — Selezione pesata, settimane e lotti di generazione
- [[plan-repo]] — Persistenza, lock e uso delle ricette
- [[plan-concurrency-pattern]] — Generazione fuori, selezione dentro il lock
- [[http-helpers]] — Busta d'errore, `readJsonBody`, `requestJson`
- [[plan-screen]] — Pagina Piano che usa il client
- [[recipe-generation]] — `generateAndStoreRecipes`, chiamata a lotti
- [[household-repo]] — `loadHousehold` e rilettura con `executor`
- [[prefs-service]] — `loadIngredientPreferences` e origine di scarti, gradimenti e blocchi (Feature 5)
- [[shopping-list]] — `isPlanClosed` in `lib/domain/plan-status.ts` (Feature 6)
- [[shopping-service]] — Servizio della lista della spesa, che consuma `needs_regeneration` e usa lo stesso lock dei piani (Feature 6)
- [[e3-pianificatore]] — Panoramica della Feature 4
- [[slot-recipe-picker]] — Selettore che usa candidate e assegnazione (Feature 9)
- [[f9-ricette-su-richiesta]] — Panoramica della Feature 9
- [[f8-portate-etichette]] — Feature 8: nessun contorno da solo nel piano
- [[compositions]] — Regole pure delle composizioni (Feature 11)
- [[f11-composizione-pasto]] — Panoramica della Feature 11
