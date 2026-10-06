---
title: E3 Pianificatore — Piano Settimanale, Swap e Navigatore di Settimane
type: topic
created: 2026-09-29
updated: 2026-10-05
tags: [planner, meal-plans, weighted-selection, swap, repeat, week-navigator, api, ui, e3, feature-4]
---

## Panoramica

L'iniziativa **E3 Pianificatore** (Feature 4, story `S3.1`–`S3.4` del backlog) è il cuore del prodotto: la pagina Piano smette di mostrare dati finti e diventa reale.

1. Una **funzione pura di selezione pesata** sceglie le ricette dalla libreria in modo riproducibile (RNG seedato), con esclusioni dure, pausa morbida tra un uso e l'altro, preferite, novità e affinità ingredienti ([[planner]]).
2. **Genera piano** crea il piano della settimana da pianificare e chiede nuove ricette all'LLM **solo** quando la libreria "fresca" è scarsa, a lotti da 3 in parallelo; se l'LLM fallisce ma la libreria basta, il piano si crea lo stesso ([[plan-service]]).
3. Ogni pasto si può **cambiare** (*Cambia → Tieni / Cambia ancora*, mai la stessa ricetta nella settimana), **bloccare** (long-press o lucchetto) e il piano si **conferma**, aggiornando l'uso delle ricette.
4. Un **navigatore di settimane** (`‹ settimana ›`) mostra la settimana in corso, quella da pianificare e lo storico in sola lettura; qualsiasi piano con ricette si può **ripetere** sulla settimana da pianificare ([[plan-screen]]).

Il principio guida resta `ARCHITECTURE §1.3`: le ricette generate entrano nella libreria e il piano è una selezione pesata dalla libreria.

### Decisioni dell'utente (requirements 2026-09-28 e Addendum 2026-09-29)

| ID | Decisione |
|---|---|
| U1 | **Settimana "lun–dom smart"**: da lunedì a venerdì si pianifica la settimana corrente dai giorni da oggi in poi; sabato e domenica la settimana successiva completa |
| U2 | **Generazione sincrona**, al massimo 2 giri, in parallelo per pranzo e cena; piano creato anche se l'LLM fallisce ma la libreria basta |
| U3 | Un piano **confermato** non si rigenera per intero: si cambiano i singoli pasti; lo swap su piano confermato conta l'uso della nuova ricetta |
| U4 | ★, voto, preferita e *Non proporre più* restano **nascosti fino alla Feature 5**: card e sheet li mostrano solo se ricevono un handler. **Chiuso dalla Feature 5** (decisione U1 di [[e2-libreria-preferenze]]): gli handler ora vengono passati e i controlli sono attivi anche nel Piano |
| D1 | Generazione **a lotti da 3** e `LLM_TIMEOUT_MS` di default a **90 s** |
| D2 | **Navigatore di settimane** con storico in sola lettura; si archiviano solo le settimane concluse |
| D3 | **Pausa morbida**: una ricetta usata da poco pesa 0.15 invece di 0; preferite senza pausa; ultimo uso = giorno del pasto |
| D4 | ***Ripeti***: copiare un piano (anche passato) sulla settimana da pianificare, come bozza |

## Architettura del Flusso

```
[ / ?settimana=YYYY-MM-DD ]
            │
            ▼
+──────────────────────────────────────────────────────────────+
| app/(app)/page.tsx (server)  getPlanScreen({ week })         |
|   <PlanScreen key={settimana mostrata} initialScreen=… />    |
+──────────────────────────────────────────────────────────────+
            │ lib/plans/client.ts (requestJson)
            ▼
+──────────────────────────────────────────────────────────────+
| app/api/plans/**   POST / · GET current · POST :id/confirm   |
|                    PATCH :id/slots/:slotId · POST …/swap     |
|                    POST :id/repeat      handlePlanRouteError |
+──────────────────────────────────────────────────────────────+
            │
            ▼
+──────────────────────────────────────────────────────────────+
| lib/plans/service.ts                                         |
|  fase 1 (fuori transazione): selectRecipes → needMore        |
|     └─► generateAndStoreRecipes a lotti da 3 (lib/recipes)   |
|  fase 2 (db.transaction + acquirePlanLock): rilegge piano,   |
|     household, preferenze, libreria → selectRecipes → scrive |
+──────────────────────────────────────────────────────────────+
      │ puro                              │ repository
      ▼                                   ▼
 lib/domain/planner.ts, week.ts,     lib/db/repositories/plan-repo.ts
 rng.ts, planner-config.ts           (+ recipe-repo, household-repo)
```

Le regole di concorrenza sono descritte in [[plan-concurrency-pattern]].

## Moduli e Componenti Introdotti

### 1. Dominio puro (`lib/domain/`)
- [[planner]]: `selectRecipes` con protocollo `needMore`, `recipeWeight`, `isFresh`, `exclusionReason`, `computeGenerationCount`, `splitGenerationBatches`; `PLANNER_CONFIG` e `APP_TIME_ZONE`; RNG `mulberry32`; aritmetica delle settimane e `resolveTargetWeek`.
- [[domain-types]]: blocco `Meal Plans (Feature 4)` in `types.ts` con `PlanWeek`, `PlanSlotView`, `PlanView`, `PlanWeekView`, `PlanScreenView`, i DTO di generazione, swap, blocco e conferma.

### 2. Dati (`lib/db/`)
- [[database-schema]]: migrazione `0003_add_plan_generation_tracking` con `meal_plans.generated_at` e `shopping_lists.needs_regeneration`.
- [[plan-repo]]: letture complete del piano, `listPlanWeeks`, `acquirePlanLock`, `activateDraftPlan`, `incrementRecipeUsage` con il giorno del pasto, `markShoppingListStale`.
- [[recipe-repo]]: `DbExecutor` spostato in `lib/db/index.ts`, `toRecipeWithDetails` esportata, `listRecipesWith(executor, …)`.
- [[household-repo]]: `getHouseholdById(id, executor?)` per rileggere le impostazioni dentro il lock.

### 3. Servizio, API e trasporto
- [[plan-service]]: `getPlanScreen`, `generatePlan`, `repeatPlan`, `confirmPlan`, `setSlotLock`, `swapSlot`, errori `PlanError`, rotte `app/api/plans/**`, client fetch, formattazione date. `lib/prefs/ingredient-prefs.ts` con `loadIngredientPreferences` (vuota nella Feature 4; dalla Feature 5 legge `ingredient_prefs`, v. [[prefs-service]]).
- [[http-helpers]]: busta d'errore, `readJsonBody`, `llmErrorResponse` e client generico `requestJson` / `ApiRequestError`; rifattorizzate anche le rotte di generazione ricette e impostazioni.
- [[recipe-generation]] e [[llm-adapter]]: `maxDuration` della rotta di generazione a 300 s, timeout LLM di default a 90 s per un lotto da 3.

### 4. Interfaccia
- [[plan-screen]]: pagina Piano reale con navigatore, generazione con avanzamento, recupero da errori di rete, swap con flip, blocco, conferma, *Ripeti*, sheet e toast.
- [[meal-card]]: long-press, `actions` che sostituiscono il footer, ★ e *Cambia* solo con handler.
- [[recipe-sheet]]: barra azioni solo con handler; `recipeChips` e `toRecipeDetail` in `components/sheets/recipe-detail.ts`.
- [[toast]]: notifica locale con live region sempre montata.

## Regole di Dominio Principali

- **Settimana obiettivo**: feriali → settimana corrente da oggi; weekend → settimana successiva completa. Genera, Rigenera e *Ripeti* lavorano solo lì.
- **Rigenerazione** (solo bozze): restano gli slot dei giorni passati e quelli bloccati; il resto si ricostruisce dalle impostazioni correnti; porzioni degli slot futuri = `persons`.
- **Stati**: `draft` alla creazione → `active` alla conferma (idempotente) → `archived` quando si crea il piano di una settimana successiva, ma solo per le settimane **già concluse**. Un piano è **chiuso** (sola consultazione) se archiviato o di una settimana conclusa.
- **Superato**: `households.updated_at > meal_plans.generated_at` (contratto U1 della Feature 3, riferito a `generated_at` perché la rigenerazione lo aggiorna).
- **Swap**: esclude tutte le ricette del piano e quelle scartate nella sequenza; genera 3 ricette solo se non resta alternativa; vietato sui giorni passati (`slot_past`), mentre il blocco è consentito. Swap, rigenerazione e *Ripeti* su un piano con lista marcano la lista come da rigenerare.
- **Uso delle ricette**: alla conferma `times_used + 1` per ricetta e `last_used_at` = mezzogiorno UTC del giorno del pasto più recente; non torna mai indietro.

## Innesti delle Review

**Architecture review 2026-09-29** (`docs/planning/feature/feature-4/architecture-review-2026-09-29.md`): lotti da 3 e recupero su `network_error` (R1); selezione dentro la transazione e conferma condizionata (R2); archiviazione delle sole settimane concluse (R3); loader delle preferenze in `lib/prefs/` (R4); *Cambia* condizionale e long-press solo dal corpo della card (R5); `toRecipeDetail` in `components/sheets/` (R6); helper HTTP e `DbExecutor` in `lib/db` (P4); commento incrociato tra `exclusionReason` e `findConstraintViolations` (P3); Addendum D1–D4.

**Code review 2026-09-29** (`code-review-2026-09-29.md`, sezione "Esito delle fix"): household e preferenze riletti sotto lock (M1); stato della pagina riallineato e navigazione bloccata durante la generazione (M2); test di concorrenza sulla finestra reale (m1); lista marcata da rigenerare anche su rigenerazione e *Ripeti* (m2); `maxDuration` 500/250 (m3); niente doppio invio di *Ripeti* (m5); recupero con backoff e *Smetti di aspettare* (m6); toast senza `pointer-events` e live region sempre montata (m7); focus nello swap (m8); risposte di swap e blocco unite per slot (m9); `slot_past` (Q1).

## Contratti Consegnati alle Feature Successive

- **Feature 5 (preferenze)**: like/dislike si cablano in `loadIngredientPreferences` (`lib/prefs/ingredient-prefs.ts`), da usare anche in `buildConstraints` (`lib/recipes/constraints.ts`); il servizio dei piani la rilegge già sotto lock. `blocked`, `favorite` e `rating` sono già letti dal planner tramite `recipe.prefs` (una ★ attiva automaticamente `favoriteRecencyFloor`). ★ e controlli della sheet si attivano passando gli handler a `MealCard` / `RecipeSheet` in `PlanSlotCard` / `PlanScreen`.
  - **Esito nella Feature 5** ([[e2-libreria-preferenze]]): contratto rispettato senza modifiche a `lib/plans/service.ts` né all'algoritmo del planner. `loadIngredientPreferences` legge `ingredient_prefs` ed è usata anche da `generateAndStoreRecipes`, che passa gli insiemi a `buildConstraints`; la ★ è attiva sulle card del piano; al posto di `RecipeSheet` la pagina monta [[recipe-detail-sheet]], che passa tutti gli handler. Un giudizio non modifica il piano in corso: vale dalla selezione successiva.
- **Feature 6 (lista della spesa)**: stato della lista in `PlanView.shopping_list`; `shopping_lists.needs_regeneration` va rimesso a `false` alla rigenerazione della lista. Il pulsante *Crea lista della spesa* porta a `/lista?piano={plan.id}`: la lista si lega sempre a un piano esplicito, perché nel weekend possono esistere due piani non chiusi. Per scegliere il piano di default di `/lista` ci sono `PlanScreenView.target_plan_status` e `current_plan_id`.
- **Punti aperti di F3 chiusi qui**: R1 (le preferenze ingredienti non rendono "superato" un piano: accettato), R2 (la pagina Piano è `app/(app)/page.tsx`), Q1 (`React.cache()` su `getSettings` **non adottato**: due letture dell'household per richiesta su una LAN domestica non ne giustificano il costo).

## Strategia di Test

Il gate chiude a **571 test** verdi (`lint`, `typecheck`, `test`, `build`). Nuovi file:
- dominio puro: `tests/domain/{rng,week,planner,plan-contracts}.test.ts`;
- DB reale: `tests/db/plan-repo.test.ts`, `tests/plans/{service,swap,repeat}.test.ts` (household dedicati, `now` fisso, RNG seedato, `generate` iniettato; nessuna chiamata di rete);
- rotte con servizio mockato: `tests/api/{plans,plans-swap,plans-repeat}.test.ts`;
- trasporto e client: `tests/http/{responses,client}.test.ts`, `tests/plans/{client,format}.test.ts`;
- UI (jsdom): `tests/ui/{plan-screen,plan-slot-card,meal-card-plan,generation-progress,toast}.test.tsx` e `tests/ui/recipe-detail.test.ts`;
- helper `tests/helpers/plans.ts` (`insertTestRecipe`, `insertTestRecipes`).

Adeguati: `tests/home.test.tsx` (pagina server), `tests/ui/shell.test.tsx` (rende `PlanScreen` con un fixture), `tests/db/schema.test.ts` (nuove colonne), `tests/llm/model.test.ts` (timeout 90000), `tests/api/recipes-generate.test.ts` (`maxDuration` 300).

## Vedi anche

- [[planner]] — Algoritmo di selezione pesata
- [[plan-service]] — Servizio, API e client dei piani
- [[plan-repo]] — Repository dei piani
- [[plan-screen]] — Pagina Piano
- [[plan-concurrency-pattern]] — Generazione fuori, selezione dentro il lock
- [[http-helpers]] — Helper di trasporto condivisi
- [[e5-impostazioni]] — Feature 3: vincoli e contratto U1
- [[e1-motore-ricette]] — Feature 2: generazione delle ricette usata dal planner
- [[e2-libreria-preferenze]] — Feature 5: preferenze su ricette e ingredienti cablate nel planner e nel Piano
