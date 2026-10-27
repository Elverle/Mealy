---
title: Planner Puro — Selezione Pesata, Settimane e RNG (planner)
type: entity
created: 2026-09-29
updated: 2026-10-27
tags: [planner, domain, pure-functions, weighted-selection, rng, week, recency, manual-choice, courses, compositions, feature-4, feature-8, feature-9, feature-11]
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
| `generationExtra` / `generationMin` / `generationMax` | `2` / `3` / `GENERATE_COUNT_MAX` (10) | Ricette da generare: deficit + 2, tra 3 e 10. Dalla Feature 11 `generationMax` è il tetto **per tipo di pasto**, ripartito tra le portate da `planGeneration` (il commento del campo lo dice) |
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

**Dalla Feature 8** c'è un motivo in più, `'course'`, controllato subito dopo `'meal_type'`: scatta se `!isMainDish(recipe.courses)`, cioè per una ricetta *solo contorno* ([[courses]]). Le ricette non classificate (`courses` vuoto) e quelle con almeno una portata principale, anche insieme a `contorno`, restano ammesse. L'ordine completo è quindi `'blocked'`, `'meal_type'`, `'course'`, `'diet'`, `'appliance'`, `'disliked_ingredient'`, `'excluded'`. Con una riga il motivo copre tutti i percorsi che passano da qui: `selectRecipes` (generazione del piano, *Rigenera*, swap), la pre-assegnazione di *Ripeti*, il conteggio delle fresche di `needMore` (calcolato sulle idonee) e `manualChoiceExclusionReason` (candidate di *Scegli* e assegnazione a mano). Fino alla Feature 11 un pasto è una ricetta sola: mai un contorno da solo (spec D7). Il commento incrociato ora dice anche che la portata passa da `coursesAllowed` in entrambe le funzioni, così la Feature 11 dovrà cambiare solo l'elenco ammesso (innesto R2 della review architetturale della Feature 8).

**Dalla Feature 11** ([[f11-composizione-pasto]]) la firma è `exclusionReason(recipe, meal, course, ctx)`: la portata del piatto da riempire (`CourseFilter`, una portata oppure `'any-main'`) è il terzo parametro (requirements P8 della Feature 11). Il motivo `'course'` resta nello stesso punto dell'ordine ma scatta quando `!fitsCourse(recipe.courses, course)` ([[compositions]]): uno slot di portata principale `c` vuole `c` tra le portate o una ricetta non classificata; uno slot `contorno` vuole `contorno` tra le portate, e una non classificata non fa mai da contorno; `'any-main'` ammette una qualsiasi principale. `isMainDish` non è più importata. Il commento incrociato dice ora che la portata passa da `coursesAllowed` in entrambe le funzioni, qui tramite `fitsCourse`. Le frasi del paragrafo precedente su `isMainDish` e su «mai un contorno da solo fino alla Feature 11» descrivono la Feature 8: un contorno resta fuori da ogni slot principale, ma ha ora i suoi slot.

### `manualChoiceExclusionReason(recipe, meal, household): ExclusionReason | null` (Feature 9)
Motivo per cui una ricetta non si può mettere **a mano** in un pasto, oppure `null`. Chiama `exclusionReason` con `ingredientPrefs = EMPTY_INGREDIENT_PREFERENCES` e un insieme vuoto di id esclusi, quindi i motivi possibili sono solo `'blocked'`, `'meal_type'`, `'diet'` e `'appliance'` (dalla Feature 8 anche `'course'`): gli ingredienti «non mi piace» e la presenza in un altro pasto **non** escludono (spec D8, D10). È l'**unica** definizione di "adatta a questo pasto" per la scelta a mano, usata sia per l'elenco delle candidate sia per l'assegnazione ([[plan-service]]); servizi e componenti non ne hanno copie (requirements P9 della Feature 9). Il sorteggio (`selectRecipes`, swap, generazione, *Ripeti*) continua a usare `exclusionReason` con gli scarti: una ricetta chiesta apposta con un ingrediente scartato si può mettere nel piano a mano ma non viene mai sorteggiata (`ARCHITECTURE §5.4`).

**Dalla Feature 11** la firma è `manualChoiceExclusionReason(recipe, meal, course, household)`. Il servizio passa `'contorno'` per il contorno e `'any-main'` per il principale: sul principale si può scegliere una qualsiasi principale, e la portata dello slot la decide poi `mainCourseForChoice` ([[compositions]], [[plan-service]]).

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

**Dalla Feature 11** il planner lavora per **gruppi (pasto, portata)** invece che per tipo di pasto (spec 4.3, requirements P9):
- `PlannerSlot { key, day, meal, course }`, con `course: CourseFilter`; il servizio usa la chiave `${day}|${meal}|${course}`.
- I gruppi presenti negli slot si elencano in ordine canonico: pasto (`MEAL_TYPE_VALUES`), poi portata (`'any-main'`, poi `COURSE_VALUES`). Ogni gruppo ha le sue candidate idonee, `exclusionReason(r, meal, course, …)` ordinate per `id`.
- L'ordine di riempimento parte dal **gruppo** con meno candidate (`sort` stabile: a parità vince l'ordine canonico), poi per giorno e chiave. Una ricetta con più portate, per esempio `['secondo', 'piatto-unico']`, è candidata in entrambi i gruppi e non affama quello più scarso.
- `picked` resta unico per tutta la chiamata: nessuna ricetta compare due volte, contorni compresi.
- `MealTypeShortage` ha il campo `course` e conta `slots`, `available`, `required` e `unfilled` del solo gruppo; `needMore` è in ordine di pasto, poi di portata. Una ricetta non classificata conta tra le fresche dei principali ma non dei contorni.

### Quanto generare
- `computeGenerationCount(shortage, config?)` = `min(generationMax, max(generationMin, max(required − available, unfilled) + generationExtra))`.
- `splitGenerationBatches(count, config?)` divide il conteggio in lotti da al più `generationBatchSize` (es. 10 → `[3, 3, 3, 1]`): ogni lotto è **una** chiamata LLM, e [[plan-service]] li lancia tutti in parallelo (proposta R1 della review architetturale).
- **`planGeneration(needMore, config?)`** (Feature 11, innesto R2 della sua review architetturale): restituisce `GenerationRequest { meal_type, course, count }[]` con **al più `generationMax` ricette per tipo di pasto**. Per ogni tipo di pasto parte da `budget = generationMax` e scorre le sue carenze, prima quelle con slot vuoti (`unfilled > 0`) e poi le altre, ciascun insieme nell'ordine di `needMore`; a ogni carenza va `min(computeGenerationCount(s), budget)` e il budget scende. Le carenze rimaste a 0 non compaiono; l'uscita è nell'ordine di `needMore`. Con una sola carenza per pasto il risultato coincide con `computeGenerationCount`. Senza questo tetto i gruppi (pasto, portata), fino a 2 × 4, avrebbero portato il caso peggiore da 20 a 80 ricette per giro. Con il budget quasi finito una carenza può ricevere meno di `generationMin` ricette, o nessuna in quel giro.

## Test

Tutti puri, senza DB (`tests/domain/`):
- `rng.test.ts`: stesso seed ⇒ stessa sequenza, seed diversi ⇒ sequenze diverse, valori in `[0, 1)`.
- `week.test.ts`: fuso orario, cambi di mese/anno, `resolveTargetWeek` da lunedì a domenica.
- `planner.test.ts`: ordine delle esclusioni, pesi attesi (incluse pausa morbida e preferite senza pausa), riproducibilità e indipendenza dall'ordine di input, max 1 occorrenza, `needMore` (anche sulle 18 fixture con 20 seed), tipo più scarso per primo, test statistici su 10 000 estrazioni (preferite ~1.5×, like ingredienti ~1.3×, preferita usata ieri contro mai usata ~1.25×), `computeGenerationCount`, lotti.
- `plan-contracts.test.ts`: parse degli schemi del piano in `types.ts` ([[domain-types]]).

Dalla Feature 9 `planner.test.ts` ha un blocco `manualChoiceExclusionReason`: `null` per una ricetta adatta, `blocked`, `meal_type`, `diet`, `appliance`, e un ingrediente scartato ignorato a differenza di `exclusionReason`.

Dalla Feature 8 `planner.test.ts` copre il motivo `course` (contorno escluso a pranzo e a cena; ammesse le ricette con una portata principale, anche insieme a `contorno`, e quelle non classificate; `blocked` e `meal_type` prima di `course`; contorno escluso anche dalla scelta a mano) e un blocco "side dishes never make a meal": una libreria di soli contorni lascia lo slot vuoto e chiede generazione; con 3 secondi e 20 contorni `available` vale 3. Il caso sulle 18 ricette d'esempio senza `needMore` riempie ora **6 + 6** slot invece di 7 + 7: la ricetta d'esempio solo contorno esce dalle candidate di cena (scostamento accettato dal piano della Feature 8).

Dalla Feature 11 `planner.test.ts` passa la portata a `exclusionReason` e a `manualChoiceExclusionReason` e copre il filtro di portata (blocco `1c`: contorno ammesso solo con il filtro `contorno`, non classificata rifiutata come contorno, `blocked` prima di `course`, scelta a mano), i gruppi (blocco `8c`: nessun contorno in uno slot di primo né una non classificata in uno di contorno, nessuna ricetta ripetuta nei due piatti di un pasto, gruppo più scarso servito per primo, `needMore` per gruppo e nel suo ordine, stesso risultato con lo stesso seme) e `planGeneration` (blocco `13`: nessuna carenza, un gruppo solo come `computeGenerationCount`, tetto a `generationMax`, 10 ricette divise tra quattro gruppi di cena con prima quelli con slot vuoti, uscita nell'ordine di `needMore`, budget indipendente per tipo di pasto). Le regole delle composizioni sono in `tests/domain/compositions.test.ts` ([[compositions]]).

Dalla Feature 5 il cablaggio con i dati reali è verificato su DB, senza toccare i test puri: `tests/prefs/ingredient-prefs.test.ts` (4000 estrazioni con due gradimenti letti dal DB, rapporto atteso 1.3), `tests/plans/ingredient-prefs.test.ts` e `tests/prefs/planner-integration.test.ts` (scarti e blocchi mai presenti in 20 piani seedati).

## Vedi anche

- [[plan-service]] — Orchestratore che chiama il planner, genera e scrive
- [[domain-types]] — `Recipe`, `Household`, `PlanWeek` e contratti del piano
- [[plan-concurrency-pattern]] — Perché la selezione si ripete dentro il lock
- [[recipe-generation]] — `findConstraintViolations`, le stesse regole sull'output LLM
- [[prefs-service]] — `loadIngredientPreferences`, origine di scarti e gradimenti (Feature 5)
- [[e3-pianificatore]] — Panoramica della Feature 4
- [[f9-ricette-su-richiesta]] — Feature 9: scelta a mano con `manualChoiceExclusionReason`
- [[courses]] — `isMainDish` e `coursesAllowed`, origine del motivo `course` (Feature 8)
- [[f8-portate-etichette]] — Panoramica della Feature 8
- [[compositions]] — `fitsCourse` e le regole delle composizioni (Feature 11)
- [[f11-composizione-pasto]] — Panoramica della Feature 11
