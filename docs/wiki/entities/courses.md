---
title: Regole Pure di Portate ed Etichette Derivate (courses)
type: entity
created: 2026-10-21
updated: 2026-10-27
tags: [domain, pure-functions, courses, style-tags, derived-tags, planner, constraints, feature-8, feature-11]
---

## File e Responsabilità

- **Percorso file**: `lib/domain/courses.ts` (nuovo nella Feature 8).
- **Scopo**: tenere in un solo posto le regole sulla **portata** di una ricetta e le due **etichette di stile derivate**, che vincono sul modello. Il modulo è puro: niente DB, LLM o framework. Si importa anche dal client, perché le card calcolano da qui il testo del badge di portata.
- **Regola di riuso** (`plan.md`, "Riuso obbligatorio"): l'ordine delle portate, il controllo "fa da pasto?", il testo del badge e le regole `pochi-ingredienti` / `piatto-unico` passano **sempre** da queste funzioni. Nel codice non ci sono confronti tra elenchi di portate scritti a mano.

Tipi e costanti stanno in `lib/domain/types.ts` ([[domain-types]], [[single-source-of-truth-types]]); questo modulo li usa e non ne definisce di nuovi.

## Vocabolario

| Termine | Significato |
|---|---|
| **Portata** (`Course`) | `piatto-unico` · `primo` · `secondo` · `contorno` (`COURSE_VALUES`, in quest'ordine). Una ricetta può averne più d'una (per esempio la parmigiana: secondo *e* piatto unico) |
| **Portate principali** | `MAIN_COURSE_VALUES = ['piatto-unico', 'primo', 'secondo']`: le portate che da sole fanno un pasto |
| **Non classificata** | `courses` vuoto. Succede solo alle ricette salvate prima della Feature 8, finché la classificazione non le raggiunge ([[recipe-classification]]) |
| **Ricetta da pasto** | Non classificata, oppure con almeno una portata principale. Una ricetta *solo contorno* non lo è |
| **Ingredienti misurati** | Righe di ingredienti con `unit !== 'qb'` |

Le etichette mostrate sono in `COURSE_LABELS`: «Piatto unico», «Primo», «Secondo», «Contorno».

## Funzioni

| Funzione | Comportamento |
|---|---|
| `normalizeCourses(courses)` | Toglie i doppioni e ordina come `COURSE_VALUES`. Restituisce sempre un array nuovo. Tutte le scritture passano da qui: `normalizeGeneratedRecipe`, `insertGeneratedRecipe`, seed e classificazione (requirements P4) |
| `coursesAllowed(courses, allowed)` | `true` se `allowed` è `null` (va bene qualsiasi portata), se la ricetta non è classificata o se ha almeno una portata in comune con `allowed`. È **l'unico predicato di portata** (innesto R2 dell'architecture review) |
| `isMainDish(courses)` | `coursesAllowed(courses, MAIN_COURSE_VALUES)` |
| `courseLabel(courses)` | Etichette nell'ordine di `COURSE_VALUES`, unite da `" · "` (es. «Piatto unico · Secondo»); `null` se `courses` è vuoto |
| `countMeasuredIngredients(ingredients)` | Numero di righe con `unit !== 'qb'` |
| `deriveStyleTags(tags, courses, ingredients)` | Applica le due regole derivate e restituisce le etichette senza doppioni, nell'ordine di `MEAL_STYLE_TAG_VALUES`. **Dalla Feature 11** la firma è `deriveStyleTags(tags, ingredients)`: resta la sola regola dei pochi ingredienti (v. sotto) |

Costante: `FEW_INGREDIENTS_MAX = 6`.

### Le due regole derivate (`deriveStyleTags`)

1. **Pochi ingredienti**: `pochi-ingredienti` c'è se e solo se `countMeasuredIngredients(ingredients) <= FEW_INGREDIENTS_MAX`. La regola aggiunge l'etichetta se manca e la toglie se non spetta, qualunque cosa abbia scritto il modello. I *q.b.* non contano: 6 ingredienti misurati più 3 *q.b.* danno `pochi-ingredienti`.
2. **Piatto unico**: su una ricetta **classificata**, l'etichetta di stile `piatto-unico` c'è se e solo se tra le portate c'è `piatto-unico`. Con `courses` vuoto l'etichetta resta com'è: non viene né aggiunta né tolta.

**Dalla Feature 11** la seconda regola non esiste più: l'etichetta di stile `piatto-unico` è uscita da `MEAL_STYLE_TAG_VALUES` (spec D12), e *Piatto unico* resta solo come portata e come composizione ([[compositions]]). `deriveStyleTags(tags, ingredients)` perde il parametro `courses` (requirements P10 della Feature 11) e i cinque chiamanti della tabella qui sotto, più `lib/recipes/pack/build.ts` ([[recipe-pack-tools]]), sono stati aggiornati. La migrazione `0006` ha tolto l'etichetta dai dati ([[database-schema]]).

Dove si applica:

| Punto | File | Pagina |
|---|---|---|
| Scrittura di una ricetta generata o di una proposta salvata | `lib/recipes/store.ts` (`insertGeneratedRecipe`) | [[recipe-generation]], [[recipe-proposal-service]] |
| Risposta di una proposta, così la ricetta mostrata coincide con quella che verrà salvata | `lib/recipes/propose.ts` (`proposeRecipe`) | [[recipe-proposal-service]] |
| Classificazione delle ricette esistenti | `lib/recipes/classify.ts` | [[recipe-classification]] |
| Seed delle ricette d'esempio | `lib/db/seed-core.ts` | [[fixtures-and-seed]] |

**Non** si applica in `normalizeGeneratedRecipe`: così l'output dell'adapter non cambia e i suoi test restano gli stessi (requirements P5). La prima regola vale anche per le ricette già in libreria grazie alla migrazione `0005`, che la ripete in SQL ([[database-schema]]).

## Chi Usa il Modulo

- **Planner** ([[planner]]): `exclusionReason` restituisce `'course'` quando `!isMainDish(recipe.courses)`. Da lì l'esclusione arriva a sorteggio, *Rigenera*, *Ripeti*, swap, candidate di *Scegli*, assegnazione a mano e conteggio delle ricette fresche (`needMore`).
  - **Dalla Feature 11** il planner non usa più `isMainDish`: il motivo `'course'` scatta quando `!fitsCourse(recipe.courses, course)`, con la portata dello slot ([[compositions]]). `fitsCourse` delega a `coursesAllowed` per i principali e aggiunge solo l'esclusione delle non classificate dal contorno. `isMainDish` resta nel modulo perché la usano i test delle fixture (requirements P11 della Feature 11).
- **Vincoli di generazione** ([[recipe-generation]]): `findConstraintViolations` aggiunge la violazione «portata non adatta al pasto» quando `!coursesAllowed(recipe.courses, constraints.courses)`.
- **Solo contorni nel contorno** (correzione dopo la Feature 11): quando `allowed` non ha portate principali (cioè `['contorno']`), `coursesAllowed` vuole tutte le portate della ricetta in `allowed`, non almeno una. Una ricetta `secondo · contorno` fa da secondo e non da contorno, nel planner come nei vincoli di generazione ([[compositions]]).
- **Card e dettaglio** ([[library-screen]], [[meal-card]], [[plan-screen]], [[recipe-sheet]]): `courseLabel` dà il testo del badge di portata.
- **`normalizeGeneratedRecipe`** ([[domain-types]]): `normalizeCourses`.

### Perché un solo predicato

Prima dell'architecture review il piano scriveva la regola due volte: `isMainDish` nel planner e un confronto in linea nei vincoli. Le due formule coincidevano solo perché l'elenco ammesso era sempre `MAIN_COURSE_VALUES`. La Feature 11 (composizione del pasto) renderà l'elenco diverso per ogni slot. Con `coursesAllowed` dovrà cambiare solo l'elenco passato, non due formule. I commenti di `exclusionReason` e `findConstraintViolations` lo ricordano. Le due funzioni restano comunque due copie delle altre regole, tenute insieme da un commento (osservazione P1 della review).

**Esito nella Feature 11** ([[f11-composizione-pasto]]): è andata così. L'elenco ammesso per slot è `filterCourses(course)` e passa ancora da `coursesAllowed` dentro `fitsCourse`; i vincoli di generazione ricevono la portata del piatto da riempire in `constraints.courses`, contorni compresi. I due commenti dicono ora che la portata passa da `coursesAllowed` in entrambe le funzioni (nel planner tramite `fitsCourse`).

## Test

`tests/domain/courses.test.ts`: ordine e doppioni di `normalizeCourses` (array nuovo); `coursesAllowed` con `null`, con una ricetta non classificata, con un contorno contro le principali, con una portata in comune e con nessuna; `isMainDish`; `courseLabel` (`null`, una portata, due nell'ordine canonico); `countMeasuredIngredients`; `deriveStyleTags` (aggiunta e rimozione di `pochi-ingredienti` attorno a 6, aggiunta e rimozione di `piatto-unico` su una classificata, etichetta conservata o non aggiunta su una non classificata, ordine e doppioni). Dalla Feature 11 i casi su `piatto-unico` non ci sono più: `deriveStyleTags` ha due parametri e la regola dei pochi ingredienti è l'unica.

`tests/fixtures-data/recipes-fixtures.test.ts` controlla che le 18 ricette d'esempio siano tutte classificate, con portate già in ordine canonico ed etichette coerenti con `deriveStyleTags`, e che una sola sia solo contorno.

## Vedi anche

- [[f8-portate-etichette]] — Panoramica della Feature 8
- [[domain-types]] — `COURSE_VALUES`, `COURSE_LABELS`, `MAIN_COURSE_VALUES`, dodici etichette di stile
- [[planner]] — Motivo di esclusione `course`
- [[recipe-generation]] — Violazione «portata non adatta al pasto»
- [[recipe-classification]] — Portate assegnate dal modello alle ricette esistenti
- [[single-source-of-truth-types]] — Perché i tipi restano in `types.ts`
- [[compositions]] — `fitsCourse`, che usa `coursesAllowed` per gli slot del piano (Feature 11)
- [[f11-composizione-pasto]] — Panoramica della Feature 11
