---
title: F11 Composizione del Pasto — Piatto Unico, Primo o Secondo, con o senza Contorno
type: topic
created: 2026-10-27
updated: 2026-10-27
tags: [planner, meal-plans, compositions, courses, side-dish, settings, onboarding, migrations, ui, feature-11]
---

## Panoramica

La **Feature 11** (*Composizione del pasto*) chiude la serie che riprende `docs/rework-catalogo.md`: 8 (portate, [[f8-portate-etichette]]) → 10 (pacchetto con 60 contorni, [[f10-pacchetto-ricette]]) → 11 (composizione). La 8 ha fissato lo schema, la 10 l'ha popolato, la 11 lo sfrutta. Non è in `docs/BACKLOG.md` né in `execution-strategy.md`: l'unica fonte dei requisiti è `spec.md`. Per questo la pagina usa il prefisso `f11-`, come [[f8-portate-etichette]], [[f9-ricette-su-richiesta]] e [[f10-pacchetto-ricette]]. Esce con la versione **0.10.0**.

**Il problema.** Fino alla 0.9 un pasto era una ricetta sola: il planner usava la portata solo per escludere i contorni (motivo `course` con `isMainDish`, [[planner]]). Una cena «secondo con contorno», la forma più comune di un pasto italiano, non si poteva pianificare, e i 60 contorni del pacchetto non entravano mai nel piano né nella lista della spesa.

Cosa cambia:

1. **Uno slot per piatto.** `plan_slots.course` dice la portata del piatto; il **pasto** è il gruppo di slot con lo stesso `(day, meal)`: un principale (`piatto-unico`, `primo` o `secondo`) e, solo con un primo o un secondo, un contorno. Un indice unico ammette al più un principale e un contorno per pasto ([[database-schema]]).
2. **Cinque composizioni**, in quest'ordine: `piatto-unico`, `primo`, `primo-contorno`, `secondo`, `secondo-contorno`. La composizione non si memorizza: si ricava dalle portate dei piatti ([[compositions]]).
3. **Composizioni ammesse per pasto** in `households.meal_compositions` (default tutte e cinque, per pranzo e per cena), scelte nel campo «Pasti da pianificare» dell'onboarding e delle Impostazioni ([[settings-fields]]).
4. ***Genera piano*** distribuisce le composizioni ammesse in modo **bilanciato** nella settimana, poi riempie ogni piatto con la selezione pesata. Carenze e generazione sono per coppia (pasto, portata), contorni compresi, con al più 10 ricette per tipo di pasto a giro ([[planner]], [[plan-service]]).
5. **Sulla card del pasto**: riga contorno con ⟳ *Cambia contorno*, lente *Scegli contorno* e ✕ *Togli contorno*, oppure il pulsante «+ Contorno» su un primo o un secondo. *Scegli* sul principale accetta qualsiasi principale e la composizione segue la ricetta. Il lucchetto blocca il pasto intero ([[plan-screen]], [[side-dish-row]], [[meal-card]]).
6. **Etichetta di stile `piatto-unico` tolta** da enum, dati, fixture, registrazioni e prompt: le etichette tornano undici. *Piatto unico* resta come portata e come composizione.

**Due migrazioni** (`0006`, `0007`), **due rotte nuove** (`POST /api/plans/:id/slots/:slotId/side`, `DELETE /api/plans/:id/slots/:slotId`), un campo nuovo nelle rotte esistenti (`meal_compositions` in `GET/PUT /api/settings`, `course` negli slot di ogni piano, `side_dish` in `POST /api/recipes/propose`). Nessuna variabile d'ambiente, nessuno script, nessuna dipendenza npm nuova.

Per i dettagli di progetto la fonte resta `docs/ARCHITECTURE.md`: §1.1 (vincoli), §4.2 (`households.meal_compositions`, `plan_slots.course`, indice, *Composizioni del pasto*, *Migrazioni*), §5.1 (*Portate nella generazione*, *Richiesta libera*), §5.2 (composizioni dei pasti da riempire, motivo `course`, `needMore` per coppia), §5.3 (swap, scelta a mano, *Scegli sul principale*, contorno, blocco, *Ripeti*), §5.5 (lista con i contorni), §6 (rotte ed errori). La card e il campo sono in `docs/DESIGN.md` §3 e nella mappa delle schermate, i testi in §5. Per l'operatività: `docs/DEPLOY.md` §6 (dalla 0.10 il ritorno indietro passa solo dal dump `predeploy`).

### Decisioni della spec e dell'utente

| ID | Decisione |
|---|---|
| D1 | **Uno slot per piatto** (`plan_slots.course`): swap, scelta, uso delle ricette e lista lavorano già per slot. Scartati `side_recipe_id` (ogni azione scritta due volte) e una tabella figlia `slot_dishes` (riscrive tutta la logica degli slot) |
| D2 | **La composizione si ricava dalle portate dei suoi slot**: nessuna colonna, una sola fonte di verità |
| D3 | **Al più un principale e un contorno per pasto**, garantito da un indice unico |
| D4 | **Default: tutte e cinque** le composizioni, per pranzo e per cena, per un household nuovo e per quello esistente |
| D5 | **Alternanza bilanciata**: conteggi il più possibile uguali tra le composizioni ammesse, assegnati ai giorni in ordine sorteggiato, deterministici a parità di `rng` |
| D6 | **Cambio di composizione da *Scegli* e con «+ Contorno» / *Togli***: nessun selettore di composizione sulla card |
| D7 | **Blocco per pasto intero**: un lucchetto per card |
| D8 | **Piani esistenti: un piatto per pasto**, con la portata ricavata dalla ricetta; li ricompone solo *Rigenera* |
| D9 | **Porzioni del contorno = porzioni del pasto** |
| D10 | ***Ripeti* copia anche la composizione**, anche se non è più ammessa |
| D11 | **Le composizioni si scelgono dentro «Pasti da pianificare»**, nell'onboarding e nelle Impostazioni: nessun passo in più nel wizard |
| D12 | **Etichetta di stile `piatto-unico` tolta** |
| U1 | Il contorno è una **riga dentro la stessa card**, sotto un divisore tratteggiato; senza contorno, nello stesso punto, «+ Contorno» |
| U2 | Le composizioni si scelgono **anche nell'onboarding** (D11 rivista il 27 ottobre 2026) |

Le decisioni di planning P1–P22 sono in `docs/planning/feature/feature-11/requirements.md`; quelle che fissano la forma del codice sono citate nelle pagine delle entità. Le principali: due migrazioni invece di una (P2), `CourseFilter = Course | 'any-main'` (P3), seme fisso delle composizioni per tutta la costruzione del piano (P5), pasto tenuto = (giorno, pasto) con almeno un piatto passato o bloccato (P6), funzione privata `fillDish` condivisa da swap e «+ Contorno» (P12), `createTestHousehold` con il solo `piatto-unico` come composizione se non indicato (P17), un pasto tolto con zero composizioni che le riprende tutte e cinque (P18).

## Architettura del Flusso

```
Impostazioni / onboarding                          Piano
 MealsField (pasti + composizioni)                  PlanScreen → groupMealsByDay → PlanSlotCard (principale + contorno)
   PUT /api/settings { …, meal_compositions }         Cambia ─────────────► POST …/slots/:id/swap      ─┐
   normalizeSettings → households.meal_compositions   Cambia contorno ────► POST …/slots/:sideId/swap  ─┤ fillDish
   (updated_at → piano in bozza superseded)           + Contorno ─────────► POST …/slots/:mainId/side  ─┘
                                                      Togli contorno ─────► DELETE …/slots/:sideId     → removeSideDish
Genera / Rigenera / Ripeti (buildTargetPlan)          Scegli / Scegli contorno ► GET …/candidates, PUT …/recipe
 compositionSeed = rng() una volta sola              Lucchetto / long-press ─► PATCH …/slots/:id   → setMealLocked
 computeSelection:
   pasti tenuti (un piatto passato o bloccato → tutto il pasto)
   assignCompositions: preset di Ripeti, poi distributeCompositions(ammesse, n, rng)
   piatti: compositionDishes → [principale] o [principale, contorno]
   preassegnazioni di Ripeti (exclusionReason con la portata del piatto)
   selectRecipes per gruppo (pasto, portata) → needMore per gruppo
 giri di generazione: planGeneration(needMore) (≤ 10 per tipo di pasto) → lotti da 3
   generateAndStoreRecipes({ mealType, courses: filterCourses(course) })   ← anche ['contorno']
 transazione: lock, rilettura, stessa selezione con lo stesso seme, scrittura degli slot con `course`
```

## Moduli e Componenti Introdotti o Modificati

### 1. Dominio puro (`lib/domain/`)
- [[compositions]] (nuovo, `lib/domain/compositions.ts`): `compositionDishes`, `mealCompositionOf`, `distributeCompositions`, `filterCourses`, `fitsCourse`, `mainCourseOf`, `mainCourseForChoice`.
- [[domain-types]]: `CourseFilter`, `MEAL_COMPOSITION_VALUES` / `MealCompositionSchema` / `MEAL_COMPOSITION_LABELS`, `MealCompositionsSchema`, `DEFAULT_MEAL_COMPOSITIONS`; `meal_compositions` su `HouseholdSchema`, `HouseholdSettingsSchema`, `SettingsViewSchema`; `course` su `PlanSlotSchema` e `PlanSlotViewSchema`; `side_dish` su `ProposeRecipeRequestSchema`; undici etichette di stile.
- [[planner]]: `exclusionReason` e `manualChoiceExclusionReason` con la portata come terzo parametro, `PlannerSlot.course`, gruppi (pasto, portata), `MealTypeShortage.course`, `planGeneration` e `GenerationRequest`.
- [[courses]]: `deriveStyleTags(tags, ingredients)` senza la regola su `piatto-unico`; `isMainDish` resta, usato solo dai test.

### 2. Dati (`lib/db/`)
- [[database-schema]]: `plan_slots.course`, indice `plan_slots_plan_day_meal_side_idx`, `households.meal_compositions`; migrazioni `0006_remove_piatto_unico_tag` e `0007_add_meal_compositions`.
- [[plan-repo]]: `course` in `PlanSlotRecord` e `NewSlotInput`, ordine principale → contorno, `updateSlotRecipe` con la portata facoltativa, `setMealLocked`.
- [[household-repo]]: `meal_compositions` nel singleton creato e negli aggiornamenti.

### 3. Servizi, rotte e client
- [[plan-service]]: costruzione del piano per composizione, *Ripeti* che copia le composizioni, `fillDish`, `addSideDish`, `removeSideDish`, blocco per pasto, scelta a mano per portata, stessa ricetta mai nei due piatti di un pasto; errori `side_not_allowed`, `side_exists`, `not_a_side_dish` e `STALE_PLAN_ERROR_CODES`; client `requestAddSideDish` e `requestRemoveSideDish`.
- [[settings-service]]: `normalizeSettings`, `settingsEqual` e `householdToSettings` con le composizioni.
- [[recipe-generation]]: `GenerateAndStoreInput.courses` (default `MAIN_COURSE_VALUES`).
- [[recipe-proposal-service]]: `side_dish` nella richiesta, portata `['contorno']` dal selettore del contorno.
- [[library-service]]: `requestRecipeProposal` con `sideDish`.
- [[llm-adapter]]: la riga `tags` dei prompt non nomina più `piatto-unico`.

### 4. Interfaccia
- [[settings-fields]]: `MealsField` con le composizioni sotto ogni pasto e `isSettingsFieldValid('meals', …)` che le controlla; [[onboarding-wizard]] e [[settings-editor]] ereditano la validazione.
- [[plan-screen]]: `groupMealsByDay`, `withMealFrom`, blocco per pasto, `PlanSlotCard` con principale e contorno, badge della portata dello slot.
- [[side-dish-row]] (nuovo, `components/plan/side-dish-row.tsx`): riga del contorno.
- [[meal-card]]: props `extra` e `actionsDisabled`.
- [[slot-recipe-picker]]: titolo e testo vuoto del contorno, proposta di un contorno, `STALE_PLAN_ERROR_CODES`.
- [[recipe-proposal-sheet]]: prop `sideDish`.
- [[recipe-sheet]]: `recipeChips` senza il filtro sul doppione *Piatto unico*.

### 5. Dati statici
`fixtures/recipes.json`, `fixtures/recipe-pack.json` (riscritto con `JSON.stringify(…, null, 2) + '\n'`, requirements P21) e quattro registrazioni di `tests/fixtures/llm/recorded/` perdono `piatto-unico` dai `tags`; i `courses` non cambiano ([[fixtures-and-seed]], [[recipe-pack]]).

## Regole di Dominio Principali

- **Composizione valida** (`mealCompositionOf`): esattamente un principale e al più un contorno, e il contorno solo con un primo o un secondo. *Piatto unico* + contorno non è una composizione.
- **Idoneità per portata** (`fitsCourse`): uno slot principale di portata `c` vuole una ricetta con `c` tra le portate, oppure non classificata; uno slot contorno vuole `contorno` tra le portate, e una non classificata **non fa mai** da contorno. Il filtro `'any-main'` (scelta a mano del principale) ammette una qualsiasi principale. Una ricetta con più portate è candidata per ognuna.
- **Bilanciamento** (`distributeCompositions`): con `n` pasti da riempire e `k` composizioni ammesse, ognuna esce `⌊n/k⌋` volte; le `n mod k` uscite in più vanno a composizioni sorteggiate senza ripetizioni; poi l'elenco si mescola e si assegna ai giorni in ordine. Con le cinque di default e 7 cene: due composizioni escono due volte, tre una volta.
- **Seme unico** (requirements P5): `buildTargetPlan` prende una volta `compositionSeed` da `ctx.rng` e lo usa in ogni chiamata di `computeSelection`, compresa quella sotto lock. Le composizioni restano le stesse tra un giro di generazione e l'altro, e la generazione decide sulle portate che poi si scrivono.
- **Pasti tenuti**: un pasto con un piatto passato o bloccato si tiene **per intero** e non conta nel bilanciamento.
- **Nessuna ricetta due volte** nello stesso piano generato, contorni compresi (`excludeRecipeIds` e `picked` del planner). La scelta a mano ammette una ricetta già in un altro pasto (come dalla Feature 9), ma mai la stessa nei due piatti di un pasto: esclusa dalle candidate e rifiutata con `recipe_not_eligible` (fix della code review, `028fb7d`).
- **Tetto di generazione** (`planGeneration`, innesto R2): per tipo di pasto al più `generationMax` (10) ricette a giro, divise tra le portate carenti: prima quelle con slot vuoti, poi nell'ordine di `needMore`. Prima di questo innesto i gruppi (pasto, portata) avrebbero portato il caso peggiore da 20 a 80 ricette per giro.
- ***Scegli* sul principale** (`mainCourseForChoice`): la ricetta tiene la portata attuale se ce l'ha; altrimenti, con un contorno nel pasto, `primo` prima di `secondo`; altrimenti la prima principale che ha (ordine di `COURSE_VALUES`). Una non classificata tiene la portata attuale. Se il risultato è `piatto-unico`, il contorno si toglie nella stessa transazione. La composizione che ne esce può non essere ammessa: la scelta a mano vince sulle Impostazioni.
- **Contorno** («+ Contorno», *Cambia contorno*, *Togli contorno*): stesse garanzie di swap e scelta (lock dei piani, rilettura sotto lock, lista da rifare, uso contato sul piano confermato). Il contorno prende le porzioni del principale (D9).
- **Blocco**: il pasto è l'unità. Un piatto bloccato blocca tutto il pasto per le azioni (`slot_locked`), e `setSlotLock` scrive lo stesso valore su tutti i piatti.
- ***Ripeti***: per ogni pasto della settimana d'origine, stessa composizione sullo stesso giorno della settimana (anche se non più ammessa) e, per ogni piatto, la stessa ricetta se ancora idonea a quella portata; altrimenti il planner nella stessa portata. Una sorgente con portate che non formano una composizione non ne impone una.
- **Lista della spesa**: nessuna modifica al codice. Ogni slot è un piatto, quindi il consolidamento per slot di [[shopping-list]] comprende già i contorni, alle porzioni del pasto.
- **Piani esistenti** (D8): la migrazione dà a ogni slot la portata del principale ricavata dalla ricetta (`piatto-unico` per una non classificata o eliminata). Restano piani a un piatto per pasto; un *Cambia* su uno slot `piatto-unico` dalla migrazione cerca un altro piatto unico (o una non classificata), perché lo swap tiene la portata dello slot.

## Innesti delle Review

**Architecture review 2026-10-27** (`docs/planning/feature/feature-11/architecture-review-2026-10-27.md`): nessun refactoring preliminare; tre correzioni al piano prima di implementare (R1–R3) e tre aggiunte da una riga (P3, R4, R5). Innestate tutte:
- **R1**: durante un'azione su un piatto, `MealCard` disattiva anche lucchetto e long-press (`actionsDisabled`), e `withMealFrom` non prende `locked` dalla risposta: ogni slot del pasto tiene il blocco che il principale aveva in locale. Senza, una risposta tardiva di «+ Contorno» poteva mostrare sbloccato un pasto bloccato sul server.
- **R2**: `planGeneration` in `planner.ts`, con al più `generationMax` ricette per tipo di pasto a giro; il commento di `generationMax` in `planner-config.ts` lo dice.
- **R3**: sulla card del Piano il badge mostra la portata **dello slot** (`COURSE_LABELS[slot.course]`), non tutte le portate della ricetta; nessun badge per una ricetta non classificata. Libreria, selettore e dettaglio continuano a mostrare tutte le portate.
- **P3**: un solo elenco dei codici che impongono di rileggere il piano, `STALE_PLAN_ERROR_CODES` in `lib/plans/errors.ts`, importato da [[slot-recipe-picker]] e da `PlanSlotCard`.
- **R4**: via d'uscita con due indici parziali se drizzle-kit non avesse gestito l'indice su espressione. Non è servita: lo schema usa l'indice su espressione, come `recipes_title_trgm_idx`.
- **R5**: un'attesa su una ricetta precisa ottenuta con un `rng` fisso può cambiare per il seme delle composizioni; nei test si aggiorna l'attesa, non il codice.
- **R6** (nessuna azione): l'household dei test ha la sola composizione `piatto-unico`; il comportamento di produzione lo coprono `compose.test.ts` e `side-dish.test.ts`.

**Code review** (commit `028fb7d`):
- la stessa ricetta non può più essere entrambi i piatti di un pasto: esclusa dalle candidate di `listSlotCandidates` e rifiutata da `assignSlotRecipe` con `recipe_not_eligible`;
- test dei piani riportati a fine riga LF; timeout più lunghi per i test di composizione e contorno, pesanti sul DB;
- test aggiunti: contorni sotto la soglia di generazione, composizioni vuote o sconosciute rifiutate da `PUT /api/settings`, lucchetto disattivato durante lo swap del principale e attivo in revisione, focus dopo le azioni sul contorno;
- `DESIGN.md`: il badge mostra la portata del principale, il contorno ha il suo eyebrow.

## Esito dei Contratti Ricevuti

- **Dalla Feature 8** ([[f8-portate-etichette]]): `coursesAllowed` resta l'unico predicato di portata e la Feature 11 ha cambiato solo l'elenco ammesso per slot (via `fitsCourse`, che aggiunge la regola del contorno); il motivo `course` di `exclusionReason` è diventato "ha la portata dello slot", nello stesso punto dell'ordine; `RecipeConstraints.courses` serve a generare i contorni. La rimozione di `piatto-unico` da `MEAL_STYLE_TAG_VALUES` è arrivata nello stesso rilascio della migrazione che la toglie dai dati (`0006`, requirements P2), come chiedeva la review R3 della Feature 8.
- **Dalla Feature 10** ([[f10-pacchetto-ricette]]): i 60 contorni del pacchetto sono la riserva dei contorni; con le composizioni di default e la libreria del pacchetto un piano completo esce senza chiamare il modello (`compose.test.ts`, «builds a full plan from the recipe pack … zero LLM calls»). Il caricatore del pacchetto non è cambiato; il file è stato riscritto solo per togliere l'etichetta.
- **Dalla Feature 4** ([[e3-pianificatore]]): il protocollo `needMore` e il pattern "generazione fuori, selezione dentro il lock" ([[plan-concurrency-pattern]]) valgono anche per le operazioni nuove.

## Contratti Consegnati alle Feature Successive

- **Pasto completo primo + secondo** (fuori ambito, spec §6): l'indice unico ammette un solo principale per pasto e `mealCompositionOf` rifiuta due principali. Servirebbero un indice diverso, composizioni nuove e una regola per l'ordine dei principali.
- **Abbinamenti ragionati tra contorno e principale**: oggi il contorno si sorteggia come gli altri piatti; il punto d'innesto è il `pickRecipe` di `fillDish` e il gruppo `contorno` di `selectRecipes`.
- **Divisione di `lib/plans/service.ts`** (review P1): il file è a circa 1000 righe. La review propone `lib/plans/build.ts` (costruzione) e `lib/plans/dishes.ts` (operazioni sui piatti) con gli helper in un modulo comune, dopo la feature e in un intervento separato.
- **Elenchi chiusi**: `MealCompositionsSchema` è `strict` e `HouseholdSchema` rifiuta un valore sconosciuto, come per le portate. Aggiungere o togliere una composizione richiede una migrazione nello stesso rilascio.
- **Documenti di progetto allineati dalla feature (WP9)**: `ARCHITECTURE` §1.1, §4.2, §5.1, §5.2, §5.3, §5.5, §6; `DESIGN` §3, mappa delle schermate, §5; `DEPLOY` §6.

## Punti Aperti e Limiti Noti

- **Verifiche manuali di chiusura** (`requirements.md` §5), da fare alla data di questa pagina: stack di produzione locale su un DB con piani esistenti (`0006` e `0007` applicate, piani leggibili, *Rigenera* con pasti composti); prova da telefono a 360 px (card con e senza contorno, «+ Contorno», *Togli*, *Scegli* che cambia composizione, campo «Pasti da pianificare» nelle Impostazioni e in un onboarding da capo); Raspberry dopo il deploy (piano rigenerato con i contorni, lista della spesa che li comprende).
- **Ritorno indietro**: dalla 0.10 solo con il dump `predeploy` (`DEPLOY §6`). Le versioni precedenti non scrivono `plan_slots.course`, che è `not null` senza default, e leggerebbero due slot per lo stesso pasto nei piani con un contorno.
- **Nessuna ricomposizione automatica** dei piani esistenti (D8): restano a un piatto per pasto fino a *Rigenera*.
- **Nessun ripiego su un'altra composizione** (spec §6): se una portata non si riempie, interviene la generazione per portata; se fallisce, il piano non si scrive (`insufficient_recipes` o l'errore del modello).
- **`'any-main'` solo per la scelta a mano**: la costruzione del piano usa sempre la portata concreta del piatto; il ramo `'any-main'` di `selectRecipes` (primo nell'ordine dei gruppi) non è usato dal servizio, che lo passava solo durante la transizione tra WP3 e WP7 (requirements P3).
- **Ripartizione del tetto di generazione**: con il budget quasi esaurito una carenza può ricevere meno di `generationMin` ricette, o nessuna in quel giro (`planGeneration`).
- **`lib/plans/service.ts`** è cresciuto a circa 1000 righe (review P1, v. sopra).
- **Regole in due copie**: `exclusionReason` e `findConstraintViolations` restano tenute insieme da un commento; per la portata danno lo stesso risultato perché una ricetta generata ha sempre almeno una portata (review P2).
- Fuori ambito (spec §6): pasto completo primo + secondo, abbinamenti ragionati, ripiego automatico, composizioni per giorno della settimana o ricorrenti, selettore di composizione sulla card, blocco del singolo piatto, porzioni del contorno diverse, ricomposizione dei piani esistenti.

## Strategia di Test

La suite conta **120 file di test** (113 alla fine della Feature 10). Nuovi file:
- dominio puro: `tests/domain/compositions.test.ts` (`compositionDishes`, `mealCompositionOf` in ogni ordine e con le portate che non formano una composizione, bilanciamento di `distributeCompositions` per diverse coppie `n`, `k` e determinismo, `fitsCourse` e `mainCourseForChoice` in tutti i casi della spec, non classificate comprese);
- migrazioni su DB usa-e-getta: `tests/db/piatto-unico-tag-migration.test.ts` (journal filtrato a `idx < 6`: etichetta tolta da household e ricette, altre conservate, idempotenza) e `tests/db/meal-compositions-migration.test.ts` (journal filtrato a `idx < 7`: portata di ogni slot esistente, composizioni di default, secondo principale e secondo contorno rifiutati dall'indice, contorno accanto a un principale accettato);
- servizio su DB reale: `tests/plans/compose.test.ts` (cene bilanciate senza chiamate al modello, una sola composizione ammessa, generazione dei soli contorni, tetto per tipo di pasto, pasto bloccato con contorno tenuto intero, piano completo dal pacchetto vero) e `tests/plans/side-dish.test.ts` (aggiunta, uso sul piano confermato, `side_not_allowed`, `side_exists`, `slot_locked`, `slot_past`, generazione con `courses: ['contorno']`, rimozione e `not_a_side_dish`, *Scegli* che toglie o tiene il contorno, candidate per portata, blocco del pasto dal contorno, *Cambia contorno*, stessa ricetta nei due piatti rifiutata, lista della spesa con il contorno);
- rotte con servizio mockato: `tests/api/plans-side.test.ts`;
- UI (jsdom): `tests/ui/side-dish-row.test.tsx`.

Casi aggiunti in `tests/domain/{planner,courses,request-contracts}.test.ts` (gruppi per portata, `planGeneration`), `tests/plans/{repeat,service,swap,client}.test.ts` (composizioni copiate da *Ripeti*, contorno non più idoneo sostituito), `tests/db/plan-repo.test.ts`, `tests/settings/{normalize,service,client}.test.ts`, `tests/api/{settings,recipes-propose}.test.ts`, `tests/recipes/{generate,propose,classify}.test.ts`, `tests/library/client.test.ts` e nelle UI `tests/ui/{plan-slot-card,plan-screen,settings-fields,settings-editor,onboarding-wizard,slot-recipe-picker,recipe-proposal-sheet}.test.tsx`. `tests/helpers/db.ts` esporta `TEST_MEAL_COMPOSITIONS` (`{ pranzo: ['piatto-unico'], cena: ['piatto-unico'] }`), che `createTestHousehold` scrive se le composizioni non sono indicate (requirements P17).

## Vedi anche

- [[compositions]] — Regole pure delle composizioni
- [[planner]] — Gruppi (pasto, portata) e `planGeneration`
- [[plan-service]] — Costruzione per composizione, contorni, blocco per pasto
- [[plan-screen]] — Card del pasto con il contorno
- [[side-dish-row]] — Riga del contorno
- [[settings-fields]] — Composizioni nel campo «Pasti da pianificare»
- [[database-schema]] — `plan_slots.course`, `households.meal_compositions`, migrazioni `0006` e `0007`
- [[f8-portate-etichette]] — Feature 8: le portate che la composizione sfrutta
- [[f10-pacchetto-ricette]] — Feature 10: i 60 contorni del pacchetto
- [[e3-pianificatore]] — Feature 4: il planner e il servizio dei piani
- [[e5-impostazioni]] — Feature 3: impostazioni e onboarding
