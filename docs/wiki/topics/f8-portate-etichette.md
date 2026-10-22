---
title: F8 Portate ed Etichette — Portata delle Ricette, Dodici Etichette di Stile e Classificazione all'Avvio
type: topic
created: 2026-10-21
updated: 2026-10-21
tags: [recipes, courses, style-tags, derived-tags, classification, llm, planner, library, migrations, startup, ui, feature-8]
---

## Panoramica

La **Feature 8** (*Portate delle ricette e nuove etichette di stile*) dà a ogni ricetta una **portata** e porta le etichette di stile da 7 a 12. È la prima di tre feature che riprendono `docs/rework-catalogo.md`: 8 (portate) → 10 (pacchetto iniziale di ricette) → 11 (composizione del pasto). Questa fissa lo schema, la 10 lo popola, la 11 lo sfrutta (spec D1). Non è in `docs/BACKLOG.md` né in `execution-strategy.md`: l'unica fonte dei requisiti è `spec.md`. Per questo la pagina usa il prefisso `f8-`, come [[f9-ricette-su-richiesta]].

Cosa cambia:

1. **Portata.** Campo nuovo `courses`, elenco chiuso e multiplo: `piatto-unico`, `primo`, `secondo`, `contorno`. Vuoto vuol dire **non classificata**, e capita solo alle ricette salvate prima della feature ([[courses]]).
2. **Dodici etichette di stile.** In coda alle sette di prima: `tradizionale`, `dal-mondo`, `pochi-ingredienti`, `in-anticipo` («Si prepara in anticipo»), `piatto-freddo`. Compaiono ovunque comparivano le sette: Impostazioni, onboarding, filtro della Libreria, card, dettaglio, prompt.
3. **Due regole derivate** che vincono sul modello: `pochi-ingredienti` se e solo se la ricetta ha al massimo 6 ingredienti misurati (esclusi i *q.b.*); su una ricetta classificata, `piatto-unico` come etichetta se e solo se c'è come portata.
4. **Mai un contorno da solo nel piano.** Fino alla Feature 11 un pasto è una ricetta sola: una ricetta *solo contorno* resta fuori da sorteggio, *Cambia*, *Scegli*, assegnazione a mano e conteggio delle ricette fresche. Le non classificate restano ammesse.
5. **Classificazione automatica.** All'avvio in produzione, in background, il modello classifica le ricette senza portata a lotti di 10. In sviluppo si lancia con `pnpm recipes:classify` ([[recipe-classification]]).
6. **Interfaccia.** Badge di portata verde (`basil-subtle`) su card e dettaglio; gruppo *Portata* nel pannello *Filtri* della Libreria.

Una migrazione (`0005`), **nessuna rotta nuova**, nessuna variabile d'ambiente nuova. Cambiano le forme di rotte esistenti: `GET /api/recipes` accetta il parametro `portata` e ogni card ha `courses`; le ricette di dettaglio, piano e proposta includono `courses`; `PUT /api/settings` accetta le dodici etichette.

Per i dettagli di progetto la fonte resta `docs/ARCHITECTURE.md`: §4.2 (colonna, elenchi, regole derivate), §5.1 (*Portate nella generazione*), §5.2 (esclusione `course`, fresche), §5.3 (scelta a mano) e §7 (classificazione all'avvio). Per l'operatività: `docs/DEPLOY.md` §5 (righe `[classify]` tra le verifiche), §6 (ritorno indietro solo con il dump) e §9 (problemi frequenti).

### Decisioni della spec e dell'utente

| ID | Decisione |
|---|---|
| D3 | **Campo nuovo `courses`, chiuso e multiplo**, sul modello di `meal_types` (non dentro le etichette di stile: il planner della F11 non deve decidere da un campo di preferenza) |
| D4 | Le ricette già in libreria le classifica **il modello, da solo, all'avvio**, in background, con nuovo tentativo al riavvio |
| D5 | **«Pochi ingredienti» per regola**, mai dal modello: è un conteggio |
| D6 | **`piatto-unico` resta anche come etichetta di stile** fino alla Feature 11, legata alla portata per regola |
| D7 | Fino alla Feature 11 un pasto accetta solo **piatti unici, primi e secondi** |
| D8 | La portata **si vede, non si modifica** (la correzione a mano è `v2-funzionalita.md` §1.4) |
| U1 | La portata è un **badge colorato distinto** (`basil-subtle`) accanto al tempo, separato dai chip di stile e dieta |
| U2 | Su una ricetta classificata il chip di stile **«Piatto unico» non si mostra**: lo dice già il badge. Cambia solo la vista |
| U3 | Filtro *Portata* **in OR** tra i suoi chip, in AND con gli altri gruppi (che restano in AND anche al loro interno) |

Le decisioni di planning P1–P24 sono in `docs/planning/feature/feature-8/requirements.md`; quelle che fissano la forma del codice sono citate nelle pagine delle entità.

## Architettura del Flusso

```
Scrittura di una ricetta generata                     Ricette già in libreria (produzione)
 piano, swap, POST /api/recipes/generate               instrumentation.ts → runDbBootstrap (migrazione 0005)
   buildConstraints(…, MAIN_COURSE_VALUES)               └ void classifyPendingRecipes()   (non atteso)
 richiesta dal Piano: MAIN_COURSE_VALUES                    listUnclassifiedRecipes
 richiesta dalla Libreria: null (qualsiasi)                 classifyRecipes, lotti da 10 in sequenza
        │                                                   deriveStyleTags
        ▼                                                   setRecipeClassification (solo se ancora vuota)
 lib/llm: riga "Portata" nel prompt,                    pnpm recipes:classify: lo stesso, a mano
          courses obbligatorio nell'output (min 1)
        │
        ▼
 findConstraintViolations → coursesAllowed → «portata non adatta al pasto»
        │
        ▼
 insertGeneratedRecipe: normalizeCourses + deriveStyleTags → recipes.courses, recipes.tags

Lettura
 exclusionReason → 'course' se !isMainDish  → sorteggio, Ripeti, swap, candidate, assegnazione, needMore
 matchesLibraryFilter: Portata in OR (?portata=)  → Libreria
 courseLabel → badge basil-subtle               → RecipeCard, MealCard, RecipeSheet (dettaglio e proposta)
```

## Moduli e Componenti Introdotti o Modificati

### 1. Dominio puro (`lib/domain/`)
- [[courses]] (nuovo, `lib/domain/courses.ts`): `normalizeCourses`, `coursesAllowed`, `isMainDish`, `courseLabel`, `countMeasuredIngredients`, `deriveStyleTags`, `FEW_INGREDIENTS_MAX`.
- [[domain-types]]: `COURSE_VALUES`, `CourseSchema`, `COURSE_LABELS`, `MAIN_COURSE_VALUES`; dodici etichette di stile; `courses` su `Recipe`, `GeneratedRecipe`, `SavedRecipeInput`, `RecipeConstraints`, `LibraryFilter` e `LibraryRecipeCard`; blocco `Recipe Classification (Feature 8)` con `CLASSIFY_BATCH_SIZE`; `normalizeGeneratedRecipe` normalizza le portate.
- [[planner]]: motivo di esclusione `'course'`, subito dopo `'meal_type'`.
- [[library-service]]: filtro per portata in OR e parametro di query `portata`; `toLibraryCard` copia `courses`.

### 2. Dati (`lib/db/`)
- [[database-schema]]: colonna `recipes.courses` e migrazione `0005_add_recipe_courses`, che applica anche la regola di `pochi-ingredienti` alle ricette esistenti.
- [[recipe-repo]]: `courses` in `InsertRecipeInput`, `listUnclassifiedRecipes`, `setRecipeClassification`.
- [[fixtures-and-seed]]: portate ed etichette nuove sulle 18 ricette d'esempio; il seed applica le regole derivate e completa le ricette d'esempio già presenti ma non classificate.
- [[database-architecture]]: il pool di `lib/db/index.ts` è un singleton per processo anche in produzione.

### 3. LLM, servizi e avvio
- [[llm-adapter]]: `courses` e dodici etichette nelle istruzioni, riga *Portata* nei due prompt utente, prompt di classificazione, `runStructuredCall` generico, `classifyRecipes`, `llm:record` con le portate.
- [[recipe-generation]]: `buildConstraints` a cinque parametri, violazione «portata non adatta al pasto», `MAIN_COURSE_VALUES` per piano e swap, regole derivate in `insertGeneratedRecipe`.
- [[recipe-proposal-service]]: portate richieste solo dal Piano, etichette derivate già nella proposta.
- [[recipe-classification]] (nuovo): `lib/recipes/classify.ts`, avvio in `instrumentation.ts`, `scripts/classify-recipes.ts`.
- [[db-bootstrap]]: l'hook di avvio lancia la classificazione dopo un bootstrap riuscito.

### 4. Interfaccia
- [[recipe-sheet]]: `recipeChips` senza il doppione «Piatto unico», campo `course` in `RecipeDetail` e badge nel dettaglio e nella proposta.
- [[meal-card]] e [[plan-screen]]: prop `course` e badge sulla card del pasto, passato da `PlanSlotCard`.
- [[library-screen]]: badge sulla card della Libreria (anche nel selettore *Scegli*), gruppo *Portata* per primo nel pannello *Filtri*, gruppi di chip etichettati, contatore e `hasFilterCriteria`.
- [[settings-fields]]: i chip di "Tipo di pasti" diventano dodici senza codice nuovo.

## Regole di Dominio Principali

- **Portate scritte sempre in ordine canonico** (`COURSE_VALUES`) e senza doppioni: l'etichetta mostrata è quindi «Piatto unico · Secondo», mai il contrario (requirements P4, che corregge l'esempio di FR-6.2).
- **Ricetta da pasto** = non classificata oppure con almeno una portata principale (`isMainDish`). È la regola del planner, che vale per tutti i percorsi d'ingresso nel piano e per il conteggio delle fresche: venti contorni in libreria non impediscono la generazione di secondi (FR-3.2).
- **Portate richieste al modello**:

  | Chiamante | `constraints.courses` |
  |---|---|
  | Piano, swap, `POST /api/recipes/generate` | `MAIN_COURSE_VALUES` |
  | Richiesta dal selettore del Piano (con tipo di pasto) | `MAIN_COURSE_VALUES` |
  | Richiesta dalla Libreria (senza tipo di pasto) | `null`: anche un contorno, che entra in libreria e resta fuori dal piano |
  | Ricontrollo al salvataggio di una proposta | `null`: la proposta è già stata accettata nel suo contesto |
  | `pnpm llm:record` | Come l'app: `null` solo per `--request` senza `--meal` |

  `RecipeConstraints.courses` è `null` oppure un elenco **non vuoto** (`.min(1)`, fix della code review).
- **Regole derivate**: si applicano a ogni ricetta che entra in libreria (store, seed, classificazione) e alla risposta della proposta. La migrazione `0005` applica la regola dei pochi ingredienti alle ricette esistenti.
- **Filtro *Portata***: una ricetta non classificata non corrisponde a nessun chip di portata.
- **Piani esistenti**: non cambiano. Una ricetta già assegnata resta nel suo slot anche se risulta solo contorno; la regola vale per le scelte successive. *Ripeti* applica le regole di ammissione e non ricopia un contorno da un piano vecchio.

## Innesti delle Review

**Architecture review 2026-10-21** (`docs/planning/feature/feature-8/architecture-review-2026-10-21.md`): niente di bloccante, nessun refactoring preliminare.
- **R1**: WP1 diviso in **WP1a** (contratti, regole pure, fixture, ritocco dei test esistenti) e **WP1b** (colonna, migrazione, repository, seed), così il campo nuovo sblocca subito prompt, UI e filtro. Nuovo `tests/helpers/recipes.ts` con `makeRecipe`, `makeGeneratedRecipe` e `makeLibraryCard`, da usare nei test nuovi (i test esistenti non sono stati migrati).
- **R2**: un solo predicato di portata, `coursesAllowed`, per planner e vincoli ([[courses]]).
- **R3**: `docs/DEPLOY.md` §6 dice che dalla 0.8 si torna a una versione precedente **solo ripristinando il dump `predeploy`**. Le versioni vecchie validano gli elenchi chiusi letti dal DB e rifiuterebbero le etichette nuove: la Libreria non si aprirebbe. Il contratto per la Feature 11 è più sotto.
- **R4**: `runStructuredCall` resta l'unica astrazione nuova dell'adapter; il test di `instrumentation` mocka `@/lib/recipes/classify` come il bootstrap.
- **P4**: il pool di `lib/db/index.ts` è un singleton anche in produzione, perché l'hook di avvio ora importa `@/lib/db`.
- **P5**: il caso nuovo di `tests/db/seed.test.ts` azzera solo `courses` di una ricetta d'esempio, non le sue etichette.

**Code review** (fix nel commit `bfbb3a4`; nella cartella della feature non c'è un file di review):
- nel pannello *Filtri* ogni gruppo di chip è un `role="group"` etichettato dal suo titolo, così i due chip «Piatto unico» (gruppo *Portata* e gruppo *Tipo di pasti*) si distinguono con il lettore di schermo;
- sulla card della Libreria i badge di tempo, portata e stato stanno in una riga flessibile che va a capo, senza rientri;
- `RecipeConstraintsSchema.courses` rifiuta l'elenco vuoto (`null` = qualsiasi portata);
- ritocchi ai test (espressione regolare più stretta nel selettore, un'asserzione positiva sulla card non classificata, un commento superato tolto).

## Contratti Consegnati alle Feature Successive

- **Feature 10 (pacchetto iniziale)**: ricette con almeno una portata e le dodici etichette; scrittura con `insertGeneratedRecipe`, che applica le regole derivate; `FixtureRecipeSchema` ha `courses`. Attenzione: `insertGeneratedRecipe` scrive sempre `source: 'llm'` (contratto della Feature 9, [[recipe-proposal-service]]).
- **Feature 11 (composizione del pasto)**: `Course`, `COURSE_VALUES`, `MAIN_COURSE_VALUES`; `coursesAllowed` come unico predicato (la F11 cambia solo l'elenco ammesso per slot); il motivo `course` di `exclusionReason` da trasformare in "ha la portata dello slot"; `RecipeConstraints.courses` per generare contorni. **Togliere `piatto-unico` da `MEAL_STYLE_TAG_VALUES` richiede, nello stesso rilascio, una migrazione che lo tolga da `recipes.tags` e `households.meal_style_tags`**: `toRecipeWithDetails` e `HouseholdSchema.parse` rifiutano i valori sconosciuti e la Libreria non si aprirebbe (review R3).
- **Correzione a mano (v2 §1.4)**: oggi un errore del modello nella classificazione si vede in Libreria ma non si corregge dall'app.
- **Documenti di progetto allineati dalla feature (WP7)**: `ARCHITECTURE` §4.2, §5.1, §5.2, §5.3, §7; `DEPLOY` §5, §6, §9; `CLAUDE.md` (comando `pnpm recipes:classify`).

## Punti Aperti e Limiti Noti

- **Verifiche manuali di chiusura** (`requirements.md` §5), da fare al momento di questa pagina: registrazione reale con `pnpm llm:record` (la ricetta deve avere `courses` valide); stack di produzione locale con ricette senza portata (righe `[classify]`, ricette classificate, avvio senza `LLM_*` con "modello non configurato"); Raspberry dopo il deploy (le 26 ricette classificate in pochi minuti, nessun contorno da solo nel piano, filtro per portata); prova da telefono (chip a 360 px senza overflow, badge leggibile, contrasto AA di `basil-subtle`).
- **Ritorno indietro**: dalla 0.8 serve il dump `predeploy` (R3, `DEPLOY §6`).
- **Regole in due copie**: `exclusionReason` e `findConstraintViolations` restano due funzioni tenute insieme da un commento; la portata è l'unica regola già condivisa (`coursesAllowed`) (review P1).
- **Lettura rigida degli elenchi chiusi**: un valore sconosciuto in una riga di `recipes` o `households` fa fallire la lettura dell'intera libreria o delle impostazioni. È una scelta voluta (rende visibile il dato sporco), ma rende irreversibile ogni modifica agli elenchi (review P2).
- **Fixture registrate ritoccate a mano**: le cinque risposte di `tests/fixtures/llm/recorded/` hanno ricevuto `courses` a mano e non sono più risposte reali al byte. Nessun test le legge (requirements P19).
- **Factory di test**: `tests/helpers/recipes.ts` serve i test nuovi; le fabbriche locali dei test esistenti restano, e il prossimo campo obbligatorio dei tipi di dominio dovrà entrare di nuovo in molti file (review P3).
- **`tests/db/seed.test.ts`** continua a girare sui dati condivisi del DB di sviluppo (review P5, nota della Feature 9 in `feature-index.md`).
- **Contesa sul modello al primo avvio**: se l'utente genera un piano mentre gira la classificazione, le chiamate al provider si sommano. È improbabile e un 429 è già gestito come errore del provider (review R5, nessuna azione).
- **Solo il singleton**: avvio e script classificano le ricette dell'household di default; altri household (solo nei test) si classificano passando `householdId`.
- **Test del planner sulle fixture**: con la regola dei contorni il caso "libreria d'esempio senza `needMore`" ora riempie 6 + 6 slot invece di 7 + 7 (scostamento accettato dal piano).
- Fuori ambito (spec §6): composizione del pasto e più ricette per pasto, pacchetto di ricette, rimozione dell'etichetta `piatto-unico`, modifica a mano di portate ed etichette, etichette di stile nel peso del planner, regola automatica per `veloce`, riclassificazione delle ricette già classificate, pasti oltre pranzo e cena, interfaccia per la classificazione.

## Strategia di Test

La suite conta **98 file di test** (94 alla fine della Feature 9). Nuovi file:
- dominio puro: `tests/domain/courses.test.ts`; casi aggiunti in `tests/domain/planner.test.ts` (motivo `course`, ordine dei motivi, contorni fuori dal conteggio delle fresche), `tests/domain/library.test.ts` (OR dentro il gruppo, AND con gli altri, non classificata, parametro `portata`), `tests/domain/generation-contracts.test.ts`;
- fixture: casi aggiunti in `tests/fixtures-data/recipes-fixtures.test.ts` (tutte classificate, regole derivate rispettate, un solo contorno);
- DB reale: `tests/db/recipe-courses-migration.test.ts` (migrazione `0005` su un database usa-e-getta fermo alla `0004`: colonna vuota, regola dei pochi ingredienti, idempotenza), `tests/db/recipe-classification-repo.test.ts`, casi aggiunti in `tests/db/seed.test.ts`;
- LLM: casi aggiunti in `tests/llm/{adapter,prompts}.test.ts` (classificazione con risposte scritte nel test, riga *Portata*, dodici etichette);
- servizi con DB reale: `tests/recipes/classify.test.ts` (classificazione con `classify` finto); casi aggiunti in `tests/recipes/{constraints,generate,propose}.test.ts` e `tests/plans/{service,swap,assign}.test.ts` (nessun contorno nel piano, swap, candidate e assegnazione; piano con un contorno assegnato prima della regola letto senza errori);
- avvio: casi aggiunti in `tests/instrumentation.test.ts`;
- rotte: casi aggiunti in `tests/api/{recipes,settings}.test.ts` (parametro `portata`, dodici etichette);
- UI (jsdom): casi aggiunti in `tests/ui/{library-filters,library-screen,recipe-card,meal-card-plan,plan-slot-card,recipe-sheet,settings-fields}.test.tsx` e `tests/ui/recipe-detail.test.ts`.

## Vedi anche

- [[courses]] — Regole pure di portata ed etichette derivate
- [[recipe-classification]] — Classificazione all'avvio e `pnpm recipes:classify`
- [[planner]] — Motivo di esclusione `course`
- [[recipe-generation]] — Vincoli con le portate e scrittura con le regole derivate
- [[llm-adapter]] — Prompt con le portate, `classifyRecipes`
- [[library-screen]] — Badge e filtro *Portata*
- [[database-schema]] — Colonna `courses` e migrazione `0005`
- [[e1-motore-ricette]] — Feature 2: la generazione che ora chiede le portate
- [[e3-pianificatore]] — Feature 4: il planner da cui restano fuori i contorni
- [[e6-deploy]] — Feature 7: bootstrap all'avvio, su cui poggia la classificazione
- [[f9-ricette-su-richiesta]] — Feature 9: richiesta dalla Libreria e dal Piano
