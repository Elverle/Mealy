---
title: Regole Pure delle Composizioni del Pasto (compositions)
type: entity
created: 2026-10-27
updated: 2026-10-27
tags: [domain, pure-functions, compositions, courses, planner, side-dish, rng, feature-11]
---

## File e Responsabilità

- **Percorso file**: `lib/domain/compositions.ts` (nuovo nella Feature 11).
- **Scopo**: tenere in un solo posto le regole del **pasto composto**: quali piatti ha una composizione, quale composizione formano i piatti di un pasto, come si distribuiscono le composizioni nella settimana, quale ricetta sta in quale piatto e quale portata prende il principale scelto a mano. Il modulo è puro: niente DB, LLM o framework; il caso entra come parametro `rng` ([[planner]]).
- **Regola di riuso** (`plan.md` §0.3.1): le regole delle composizioni stanno qui e si riusano, mai reimplementate. Lo importano `lib/domain/planner.ts` (`fitsCourse`) e `lib/plans/service.ts` ([[plan-service]]); nessun componente lo importa.

Tipi e costanti (`MealComposition`, `MEAL_COMPOSITION_VALUES`, `CourseFilter`, `MAIN_COURSE_VALUES`, `COURSE_VALUES`) stanno in `lib/domain/types.ts` ([[domain-types]], [[single-source-of-truth-types]]); il modulo non ne definisce di nuovi esportati.

## Vocabolario

| Termine | Significato |
|---|---|
| **Pasto** | Gli slot di un piano con lo stesso `(day, meal)`. **Principale**: lo slot con `course !== 'contorno'`; **contorno**: lo slot con `course === 'contorno'` |
| **Composizione** (`MealComposition`) | `piatto-unico` · `primo` · `primo-contorno` · `secondo` · `secondo-contorno` (`MEAL_COMPOSITION_VALUES`, in quest'ordine). Etichette in `MEAL_COMPOSITION_LABELS`: «Piatto unico», «Primo», «Primo + contorno», «Secondo», «Secondo + contorno» |
| **Filtro di portata** (`CourseFilter`) | Una `Course` oppure `'any-main'` (una qualsiasi principale). `'any-main'` è il filtro della scelta a mano del principale (requirements P3) |
| **Non classificata** | Ricetta con `courses` vuoto ([[courses]]) |

## Funzioni

| Funzione | Comportamento |
|---|---|
| `compositionDishes(composition)` | `{ main: Course; side: boolean }`: la portata del principale e se c'è il contorno (`primo-contorno` → `{ main: 'primo', side: true }`) |
| `mealCompositionOf(courses)` | Composizione formata dalle portate degli slot di un pasto, **in qualsiasi ordine**, oppure `null`: serve esattamente un principale e al più un contorno, e il contorno solo con un primo o un secondo. `['contorno', 'secondo']` → `secondo-contorno`; `['piatto-unico', 'contorno']`, `['contorno']`, due principali, due contorni e `[]` → `null` |
| `distributeCompositions(allowed, count, rng)` | `count` composizioni bilanciate tra quelle ammesse (v. sotto). `count <= 0` → `[]`; nessuna ammessa → `Error('distributeCompositions: nessuna composizione ammessa')` |
| `filterCourses(filter)` | Portate di un filtro: `'any-main'` → le tre principali (copia di `MAIN_COURSE_VALUES`), altrimenti `[filter]`. Array sempre nuovo. È anche il `courses` passato alla generazione ([[recipe-generation]]) |
| `fitsCourse(courses, filter)` | `true` se la ricetta può stare in uno slot con quel filtro. Filtro `contorno`: la ricetta deve avere `contorno` tra le portate, quindi una non classificata **non fa mai** da contorno. Altrimenti `coursesAllowed(courses, filterCourses(filter))`: una non classificata va bene in ogni principale e in `'any-main'` |
| `mainCourseOf(courses)` | Prima portata principale della ricetta nell'ordine di `COURSE_VALUES` (`piatto-unico` → `primo` → `secondo`), altrimenti `piatto-unico`. È anche la regola della migrazione `0007` per gli slot esistenti ([[database-schema]]) |
| `mainCourseForChoice(courses, currentCourse, hasSide)` | Portata che prende il principale quando l'utente ci mette a mano questa ricetta (spec FR-5.4): non classificata → `currentCourse`; la ricetta ha `currentCourse` → la tiene; con un contorno nel pasto → `primo`, poi `secondo`, se la ricetta li ha; altrimenti `mainCourseOf(courses)` |

### Bilanciamento (`distributeCompositions`)

1. Le composizioni ammesse si riducono all'ordine di `MEAL_COMPOSITION_VALUES` (doppioni e ordine di `allowed` non contano).
2. Con `k` ammesse, ognuna esce `⌊count/k⌋` volte.
3. Le `count mod k` uscite in più vanno a composizioni sorteggiate **senza ripetizioni**: le prime di un mescolamento Fisher–Yates delle ammesse.
4. L'elenco completo si mescola di nuovo con `rng`; il chiamante lo assegna ai giorni in ordine.

A parità di input e `rng` il risultato è lo stesso. Con 7 cene e le cinque composizioni di default, due composizioni escono due volte e tre una volta; con 10, due per ciascuna; con una sola ammessa, tutte uguali. Il mescolamento interno consuma una chiamata a `rng` per elemento da 1 in su.

## Chi Usa il Modulo

- **Planner** ([[planner]]): `exclusionReason(recipe, meal, course, ctx)` restituisce `'course'` quando `!fitsCourse(recipe.courses, course)`. Da lì la regola arriva a sorteggio, *Rigenera*, *Ripeti*, swap, «+ Contorno», candidate, assegnazione a mano e conteggio delle fresche.
- **Servizio dei piani** ([[plan-service]]):
  - `assignCompositions` (privata) chiama `distributeCompositions` con le composizioni ammesse dell'household (`household.meal_compositions[meal]`) e un `rng` creato dal seme unico della costruzione;
  - `computeSelection` trasforma ogni composizione in piatti con `compositionDishes`;
  - i giri di generazione e `fillDish` passano `filterCourses(course)` come `courses` a `generateAndStoreRecipes`;
  - `repeatPlan` ricava la composizione di ogni pasto d'origine con `mealCompositionOf` (una sorgente che non ne forma una non impone nulla);
  - `assignSlotRecipe` decide la portata del principale con `mainCourseForChoice`.
- **Vincoli di generazione** ([[recipe-generation]]): non usano il modulo. `findConstraintViolations` continua con `coursesAllowed(recipe.courses, constraints.courses)`, che per le ricette generate dà lo stesso risultato di `fitsCourse`: una ricetta generata ha sempre almeno una portata (review P2 della Feature 11).

### Perché `fitsCourse` e non solo `coursesAllowed`

`coursesAllowed` ammette sempre una ricetta non classificata: è la regola giusta per i principali, dove una ricetta salvata prima della Feature 8 deve poter restare nel piano. Per il contorno la spec chiede il contrario (FR-3.4): una non classificata non deve diventare il contorno di nessun pasto. `fitsCourse` aggiunge solo questa eccezione e per il resto delega a `coursesAllowed`, che resta l'unico predicato di portata ([[courses]]).

## Test

`tests/domain/compositions.test.ts`: `compositionDishes` per le cinque composizioni; `mealCompositionOf` con un principale, con il contorno in qualsiasi ordine, con `primo-contorno`, e i rifiuti (contorno con un piatto unico, solo contorno, due principali, due contorni, pasto vuoto); `distributeCompositions` (nessuna con `count <= 0`, 7 su 5 con due composizioni ripetute, 10 su 5 con due ciascuna, 3 su 5 tutte diverse, una sola ammessa, doppioni e ordine di `allowed` ignorati, stesso risultato con lo stesso seme, errore senza ammesse); `fitsCourse` (non classificata ammessa nei principali e mai come contorno, contorno solo per il filtro `contorno`, una ricetta per ognuna delle sue portate); `filterCourses`; `mainCourseOf` (ordine canonico, ripiego su `piatto-unico`); `mainCourseForChoice` in tutti i casi di FR-5.4.

## Vedi anche

- [[f11-composizione-pasto]] — Panoramica della Feature 11
- [[courses]] — `coursesAllowed`, l'unico predicato di portata
- [[planner]] — `exclusionReason` con la portata dello slot
- [[plan-service]] — Costruzione del piano per composizione, *Ripeti*, scelta a mano
- [[domain-types]] — `MEAL_COMPOSITION_VALUES`, `MealCompositionsSchema`, `CourseFilter`
