---
title: Planner Puro — Selezione Pesata, Settimane e RNG (planner)
type: entity
created: 2026-09-29
updated: 2026-10-14
tags: [planner, domain, pure-functions, weighted-selection, rng, week, recency, manual-choice, feature-4, feature-9]
---

## File e Responsabilità

- **Percorsi file**:
  - `lib/domain/planner.ts`: esclusioni, peso di una ricetta, estrazione pesata, `selectRecipes` con il protocollo `needMore`, calcolo e suddivisione in lotti delle ricette da generare.
  - `lib/domain/planner-config.ts`: `PLANNER_CONFIG` (unico posto delle costanti numeriche della selezione) e `APP_TIME_ZONE = 'Europe/Rome'`.
  - `lib/domain/rng.ts`: RNG seedabile `mulberry32` (`createRng`) e `randomSeed`.
  - `lib/domain/week.ts`: aritmetica sulle date `YYYY-MM-DD` e settimana obiettivo (`resolveTargetWeek`).
- **Scopo**: scegliere le ricette di un piano dalla **libreria** in modo pesato, riproducibile e testabile, senza DB né LLM. Il planner non genera mai: se la libreria è scarsa lo **segnala** (`needMore`) e l'orchestrazione della generazione spetta a [[plan-service]].
- **Regola di purezza** (`plan.md` §0.3.2): nessun import da `lib/db`, `lib/llm`, `lib/recipes`, `next/*`; niente `new Date()` senza argomenti né `Math.random()`. Il tempo entra come parametro `now: Date`, il caso come parametro `rng`. L'unica eccezione è `randomSeed()` (usa `crypto.getRandomValues`), chiamata solo da `lib/plans/service.ts`.

## Configurazione (`planner-config.ts`)

| Campo | Default | Significato |
|---|---|---|
| `recencyMinDays` | `10` | Sotto questa soglia di giorni dall'ultimo uso il peso scende a `recencyFloor` |
| `recencyFullDays` | `28` | Da qui la recency non riduce più il peso |
| `recencyFloor` | `0.15` | Peso di una ricetta usata da meno di `recencyMinDays` giorni (non 0: resta sorteggiabile) |
| `favoriteRecencyFloor` | `1` | Le preferite non hanno pausa (`max(1, decadimento)`); abbassarlo se si ripetono troppo |
| `favoriteBoost` | `1.5` | Moltiplicatore delle preferite |
| `noveltyBonus` | `1.2` | Moltiplicatore delle ricette mai usate (`times_used = 0`) |
| `ingredientLikeStep` / `ingredientLikeMaxCount` | `0.15` / `2` | Affinità: `1 + 0.15 × min(2, n)` ingredienti graditi |
| `minPoolSize` | `3` | Candidate minime per l'ultimo slot di ogni tipo di pasto |
| `generationExtra` / `generationMin` / `generationMax` | `2` / `3` / `GENERATE_COUNT_MAX` (10) | Ricette da generare: deficit + 2, tra 3 e 10 |
| `generationBatchSize` | `3` | Ricette per singola chiamata LLM (latenza reale ~38 s per 3 ricette) |
| `maxGenerationRoundsPlan` / `maxGenerationRoundsSwap` | `2` / `1` | Tetto ai giri di generazione per piano e per swap/*Ripeti* |

La formula completa del peso è in `ARCHITECTURE §5.2` ed è quella qui implementata; i parametri si tarano senza toccare la logica.

## Settimane (`week.ts`)

Tutte le date sono stringhe `YYYY-MM-DD`; l'aritmetica usa `Date.UTC`, mai il fuso locale del server.

| Funzione | Comportamento |
|---|---|
| `todayInTimeZone(now, timeZone)` | Data odierna nel fuso indicato, composta dalle parti di `Intl.DateTimeFormat('en-CA')` (es. `2026-09-27T22:30Z` a Roma → `'2026-09-28'`) |
| `addDays(isoDate, days)` | Somma giorni (anche negativi), attraversando mesi e anni |
| `isoWeekday(isoDate)` | 1 = lunedì … 7 = domenica |
| `mondayOf(isoDate)` | Lunedì della settimana che contiene la data |
| `listDays(first, last)` | Elenco inclusivo; `[]` se `first > last` |
| `resolveTargetWeek(today)` | **Settimana obiettivo** di *Genera*/*Rigenera*/*Ripeti*: da lunedì a venerdì la settimana corrente con `first_day = today`; sabato e domenica la settimana successiva completa (`first_day = week_start`). `last_day` è sempre la domenica. |

Il fuso `Europe/Rome` (`APP_TIME_ZONE`) protegge dal container del Raspberry che può girare in UTC (requirements P15).

## RNG (`rng.ts`)

`createRng(seed)` implementa `mulberry32`: stesso seed ⇒ stessa sequenza di numeri in `[0, 1)`. In produzione il seed viene da `randomSeed()`; nei test si passa `createRng(n)` per ottenere piani riproducibili.

## API del Planner (`planner.ts`)

### Preferenze ingredienti
`IngredientPreferenceSets { likes, dislikes }` (nomi canonici già normalizzati), `EMPTY_INGREDIENT_PREFERENCES` e `toIngredientPreferenceSets(likes, dislikes)` (applica `normalizeCanonicalName`). In F4 gli insiemi erano sempre vuoti. Dalla Feature 5 li popola `loadIngredientPreferences` (`lib/prefs/ingredient-prefs.ts`, [[prefs-service]]) leggendo la tabella `ingredient_prefs`, **senza cambiare l'algoritmo**: in `planner.ts` è cambiato solo il commento sopra `IngredientPreferenceSets`. Uno scarto è un'esclusione dura (`'disliked_ingredient'`), un gradimento entra in `ingredientAffinity`. Il confronto è sul nome canonico esatto: scartare `cipolla` non esclude le ricette con `cipolla rossa` (decisione D1, v. [[e2-libreria-preferenze]]). Anche `blocked`, `favorite` e `rating`, già letti da `recipe.prefs`, sono ora davvero impostabili dall'utente.

### `exclusionReason(recipe, meal, ctx): ExclusionReason | null`
Filtri duri, in quest'ordine (vince il primo che scatta): `'blocked'` (`prefs.blocked`), `'meal_type'`, `'diet'` (ogni dieta dell'household deve stare in `expandDietFlags(recipe.diet_flags)`), `'appliance'`, `'disliked_ingredient'`, `'excluded'` (id in `ctx.excludeRecipeIds`). Un commento incrociato ricorda che le stesse regole vivono in `findConstraintViolations` ([[recipe-generation]]), applicate all'output dell'LLM: chi modifica una deve controllare l'altra (proposta P3 della review architetturale).

### `manualChoiceExclusionReason(recipe, meal, household): ExclusionReason | null` (Feature 9)
Motivo per cui una ricetta non si può mettere **a mano** in un pasto, oppure `null`. Chiama `exclusionReason` con `ingredientPrefs = EMPTY_INGREDIENT_PREFERENCES` e un insieme vuoto di id esclusi, quindi i motivi possibili sono solo `'blocked'`, `'meal_type'`, `'diet'` e `'appliance'`: gli ingredienti «non mi piace» e la presenza in un altro pasto **non** escludono (spec D8, D10). È l'**unica** definizione di "adatta a questo pasto" per la scelta a mano, usata sia per l'elenco delle candidate sia per l'assegnazione ([[plan-service]]); servizi e componenti non ne hanno copie (requirements P9 della Feature 9). Il sorteggio (`selectRecipes`, swap, generazione, *Ripeti*) continua a usare `exclusionReason` con gli scarti: una ricetta chiesta apposta con un ingrediente scartato si può mettere nel piano a mano ma non viene mai sorteggiata (`ARCHITECTURE §5.4`).

### `recipeWeight(recipe, ingredientLikes, now, config?)`
Prodotto di `ratingFactor × favoriteBoost × recencyDecay × noveltyBonus × ingredientAffinity`. Il `recencyDecay` è misurato in giorni (virgola mobile, mai negativi) da `prefs.last_used_at`:
- mai usata → `1`;
- non preferita: `< recencyMinDays` → `recencyFloor`; `>= recencyFullDays` → `1`; in mezzo interpolazione lineare da `recencyFloor` a `1`;
- preferita: `max(favoriteRecencyFloor, decadimento)`, cioè `1` con i default.

Poiché `last_used_at` è il **giorno del pasto** (v. [[plan-repo]]), una ricetta pianificata nel futuro ha `days = 0` e pesa `recencyFloor`.

### `isFresh(recipe, now, config?)`
"Fresca" = mai usata, usata da almeno `recencyMinDays` giorni, oppure preferita. Le fresche sono le sole contate in `available` di `needMore`: la generazione scatta quando la libreria *nuova* è scarsa, anche se le ricette recenti restano sorteggiabili.

### `weightedPick(items, weights, rng)`
Estrazione sulla somma cumulata dei pesi; lancia `weightedPick: nessun elemento con peso positivo` se la lista è vuota o il totale è `<= 0` (possibile solo con una configurazione di test).

### `selectRecipes(input): PlannerResult`
Input: `slots` (`PlannerSlot { key, day, meal }`), `candidates` (libreria con `ingredients` e `prefs`), `household` (`diet_tags`, `appliances`), `ingredientPrefs`, `excludeRecipeIds`, `now`, `rng`, `config?`.

1. Peso calcolato una volta per ricetta; per ogni tipo di pasto presente, le candidate idonee (`exclusionReason === null`) **ordinate per `id`**, così il risultato non dipende dall'ordine delle righe del DB.
2. Gli slot si riempiono partendo dal tipo di pasto con **meno candidate** (a parità, ordine di `MEAL_TYPE_VALUES`), poi per giorno: le ricette valide per pranzo e cena non lasciano scoperto il tipo più scarso (con le fixture: 9 candidate di pranzo contro 10 di cena).
3. Per ogni slot `weightedPick` sulle idonee non ancora scelte; una ricetta compare **al massimo una volta** nel risultato. Pool vuoto → `recipeId: null`. Non esiste più un ramo di "ripiego" (Addendum D3): con `recencyFloor > 0` ogni idonea ha peso positivo.
4. `needMore`: per ogni tipo di pasto (ordine `MEAL_TYPE_VALUES`) un `MealTypeShortage { meal_type, slots, available, required, unfilled }` se `available < slots + minPoolSize − 1` oppure se resta uno slot vuoto.
5. `assignments` nello stesso ordine di `input.slots`; con `slots` vuoto `{ assignments: [], needMore: [] }`.

### Quanto generare
- `computeGenerationCount(shortage, config?)` = `min(generationMax, max(generationMin, max(required − available, unfilled) + generationExtra))`.
- `splitGenerationBatches(count, config?)` divide il conteggio in lotti da al più `generationBatchSize` (es. 10 → `[3, 3, 3, 1]`): ogni lotto è **una** chiamata LLM, e [[plan-service]] li lancia tutti in parallelo (proposta R1 della review architetturale).

## Test

Tutti puri, senza DB (`tests/domain/`):
- `rng.test.ts`: stesso seed ⇒ stessa sequenza, seed diversi ⇒ sequenze diverse, valori in `[0, 1)`.
- `week.test.ts`: fuso orario, cambi di mese/anno, `resolveTargetWeek` da lunedì a domenica.
- `planner.test.ts`: ordine delle esclusioni, pesi attesi (incluse pausa morbida e preferite senza pausa), riproducibilità e indipendenza dall'ordine di input, max 1 occorrenza, `needMore` (anche sulle 18 fixture con 20 seed), tipo più scarso per primo, test statistici su 10 000 estrazioni (preferite ~1.5×, like ingredienti ~1.3×, preferita usata ieri contro mai usata ~1.25×), `computeGenerationCount`, lotti.
- `plan-contracts.test.ts`: parse degli schemi del piano in `types.ts` ([[domain-types]]).

Dalla Feature 9 `planner.test.ts` ha un blocco `manualChoiceExclusionReason`: `null` per una ricetta adatta, `blocked`, `meal_type`, `diet`, `appliance`, e un ingrediente scartato ignorato a differenza di `exclusionReason`.

Dalla Feature 5 il cablaggio con i dati reali è verificato su DB, senza toccare i test puri: `tests/prefs/ingredient-prefs.test.ts` (4000 estrazioni con due gradimenti letti dal DB, rapporto atteso 1.3), `tests/plans/ingredient-prefs.test.ts` e `tests/prefs/planner-integration.test.ts` (scarti e blocchi mai presenti in 20 piani seedati).

## Vedi anche

- [[plan-service]] — Orchestratore che chiama il planner, genera e scrive
- [[domain-types]] — `Recipe`, `Household`, `PlanWeek` e contratti del piano
- [[plan-concurrency-pattern]] — Perché la selezione si ripete dentro il lock
- [[recipe-generation]] — `findConstraintViolations`, le stesse regole sull'output LLM
- [[prefs-service]] — `loadIngredientPreferences`, origine di scarti e gradimenti (Feature 5)
- [[e3-pianificatore]] — Panoramica della Feature 4
- [[f9-ricette-su-richiesta]] — Feature 9: scelta a mano con `manualChoiceExclusionReason`
