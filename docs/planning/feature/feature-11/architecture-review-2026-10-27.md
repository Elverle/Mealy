# Feature 11 — Architecture review (2026-10-27)

Review di `plan.md` (WP1–WP9) contro il codice di `main` (v0.9.0, `51f0587`), con `spec.md` e `requirements.md` di questa cartella, i piani delle Feature 8 e 10 e `docs/ARCHITECTURE.md`.

**Esito in breve.** L'architettura regge la feature senza refactoring preliminari. Il modello "uno slot per piatto" si appoggia bene a quello che esiste: swap, scelta, uso delle ricette e lista della spesa lavorano già per slot. Le regole pure sono separate dal servizio. I tipi hanno una sola fonte. Restano tre punti da correggere nel piano prima di implementare: R1, R2 e R3. Nessuno richiede di spostare codice esistente.

---

## 1. Pain point attuali del codice

### P1 — `lib/plans/service.ts` fa troppe cose · da tenere d'occhio

**Dove.** `lib/plans/service.ts`, 821 righe. Contiene la schermata (`getPlanScreen`), la costruzione del piano (`computeSelection`, `buildTargetPlan`, `generatePlan`, `repeatPlan`), la conferma, il blocco, lo swap, la scelta a mano e le candidate. Gli helper interni (`loadOpenOwnedPlan`, `loadConstraints`, `resolveClock`, `toPlanView`) li usano tutte.

**Perché è un problema.** WP7 tocca quasi ogni funzione del file e ne aggiunge tre (`fillDish`, `addSideDish`, `removeSideDish`). Così il file supera le 900 righe e chi lo modifica deve tenere in testa costruzione del piano e operazioni sui piatti insieme. Oggi però non ci sono duplicazioni gravi: l'unica è il flusso dello swap, e WP7 la risolve con `fillDish` (requirements P12).

**Proposta.** Non ora. Dividere il file in `lib/plans/build.ts` (costruzione) e `lib/plans/dishes.ts` (operazioni sui piatti), con gli helper in un modulo comune, è un refactoring medio. Toccherebbe gli import di 7 file di test e di 9 rotte, e gli implementer di questo progetto sono su haiku. Conviene farlo dopo la Feature 11, in un intervento separato, se il file continua a crescere.

### P2 — Le regole d'idoneità sono scritte due volte · da tenere d'occhio, nessuna azione

**Dove.** `exclusionReason` (`lib/domain/planner.ts:57`) per le ricette in libreria e `findConstraintViolations` (`lib/recipes/constraints.ts:59`) per quelle generate. Un commento in ciascuna rimanda all'altra.

**Perché.** È una duplicazione voluta: due tipi di input diversi (`Recipe` e `GeneratedRecipe`) e due esiti diversi (motivo singolo contro elenco di violazioni). La Feature 11 cambia solo la portata. Nel planner passa da `fitsCourse`, nei vincoli resta `coursesAllowed(courses, constraints.courses)`. Le due forme danno lo stesso risultato, perché una ricetta generata ha sempre almeno una portata (`GeneratedRecipeSchema.courses.min(1)`). WP3 passo 6 aggiorna già il commento.

**Proposta.** Nessuna.

### P3 — Due elenchi separati di "errori che rendono il piano vecchio" nella UI · da tenere d'occhio

**Dove.** `components/plan/slot-recipe-picker.tsx:48` (`STALE_PLAN_CODES`). WP8 passo 3 ne aggiunge un secondo in `plan-slot-card.tsx` (`STALE_CODES`), con i tre codici nuovi.

**Perché.** Sono lo stesso concetto: quali `PlanErrorCode` impongono di rileggere il piano. Con due elenchi, un codice aggiunto in futuro finirà in uno solo dei due. Già oggi `side_exists` servirebbe anche al selettore, se un giorno ci si potesse aggiungere un contorno da lì.

**Proposta (piccola).** In **WP6 passo 1**, esportare da `lib/plans/errors.ts` `export const STALE_PLAN_ERROR_CODES: ReadonlySet<string> = new Set<PlanErrorCode>([...])`. Contiene i cinque codici di `slot-recipe-picker.tsx` più `side_exists`, `side_not_allowed` e `not_a_side_dish`. In **WP8**, `slot-recipe-picker.tsx` e `plan-slot-card.tsx` lo importano al posto delle costanti locali. È un'aggiunta: va fatta prima di implementare.

Nessun altro pain point degno di nota nei moduli toccati. Il repository dei piani, le impostazioni (`lib/settings/normalize.ts`) e il modulo `recipes` sono coerenti tra loro e coperti da test. I lock e le riletture sotto lock sono applicati in modo uniforme.

---

## 2. Rischi introdotti o amplificati dal piano

### R1 — Blocco del pasto durante un'azione sul contorno: la spec non è rispettata e lo stato del lucchetto può tornare indietro · alto

**Dove.** WP8 passo 3 (il lucchetto resta attivo durante le azioni) e passo 4 (`withMealFrom` sostituisce gli slot del pasto con quelli della risposta, `locked` compreso).

**Perché è un problema.**

1. La spec FR-4.5 dice che, mentre un'azione su un piatto è in corso, le altre azioni della card sono disattivate. Il piano disattiva *Cambia*, *Scegli* e la riga contorno, ma non il lucchetto né il long-press.
2. Oggi lo swap e il blocco non si pestano i piedi, perché `withSlotFrom` (`plan-screen.tsx:114`) prende dallo swap solo `recipe` e `servings`, e dal blocco solo `locked`. `withMealFrom` invece sostituisce gli slot interi. Ecco una sequenza concreta. L'utente tocca «+ Contorno» (fino a ~38 s se serve il modello), poi blocca il pasto. Arriva prima la risposta del blocco, poi quella dell'aggiunta, calcolata quando il pasto non era ancora bloccato. Il pasto appare sbloccato mentre sul server è bloccato.

**Proposta (piccola, in WP8, prima di implementare).**
- **WP8 passo 1.** `actionsDisabled` di `MealCard` disattiva anche il pulsante del lucchetto e il long-press (con `actionsDisabled`, `onLongPress` non parte).
- **WP8 passo 3.** `PlanSlotCard` passa `actionsDisabled={busy}`, cioè con lo swap del principale in corso **oppure** con un'azione sul contorno in corso, e non più solo con `sideMode !== 'idle'`. In modalità `review` il lucchetto resta attivo come oggi: lo swap è già concluso.
- **WP8 passo 4.** `withMealFrom` non decide il blocco. Dopo la sostituzione, ogni slot del pasto prende il `locked` che il principale aveva in locale prima della sostituzione. Il blocco lo cambia solo `handleToggleLock`, come oggi.
- **Test (WP8 passo 6).** Con un'aggiunta del contorno in corso, il pulsante «Blocca pasto» è disattivato. `withMealFrom` su un pasto bloccato in locale, con una risposta che ha `locked: false`, lascia il pasto bloccato.

### R2 — La generazione per (pasto, portata) può moltiplicare per quattro le chiamate al modello · medio

**Dove.** WP3 passo 3 (`needMore` per gruppo) e WP7 passo 4 (un lotto di generazione per ogni carenza, in parallelo). Il limite `generationMax` si applica per carenza (`computeGenerationCount`, `planner.ts:306`). `lib/domain/planner-config.ts:23` invece lo dichiara così: «Massimo di ricette richieste in totale **per tipo di pasto**».

**Perché è un problema.** Oggi un giro di generazione chiede al massimo 2 × 10 = 20 ricette (7 chiamate da 3 in parallelo, ~38 s ciascuna). Con i gruppi (pasto, portata) le carenze possono essere fino a 2 × 4 = 8. Il tetto sale a 80 ricette e 27 chiamate parallele per giro, e i giri sono 2 (`maxGenerationRoundsPlan`). Non succede con il pacchetto e senza diete. Succede però con una libreria piccola o con una dieta stretta: per esempio vegano con pochi secondi e pochi contorni adatti. È proprio il caso in cui il modello interviene (`ARCHITECTURE §1.3`, `§7` costi e resilienza). Il piano rompe in silenzio un contratto documentato della configurazione.

**Proposta (piccola, prima di implementare).**
- **WP3, nuovo passo 4b.** Una funzione pura in `planner.ts`:
  ```ts
  export interface GenerationRequest { meal_type: MealType; course: CourseFilter; count: number }
  /**
   * Ricette da generare per carenza, con al più `config.generationMax` ricette per tipo di pasto.
   * Dentro un tipo di pasto hanno la precedenza le carenze con slot vuoti (`unfilled > 0`), poi
   * l'ordine di `needMore`. Le carenze rimaste a 0 non compaiono.
   */
  export function planGeneration(needMore: readonly MealTypeShortage[], config?: PlannerConfig): GenerationRequest[];
  ```
  Per ogni tipo di pasto si parte da `budget = config.generationMax`. Si scorrono le sue carenze, prima quelle con `unfilled > 0` e poi le altre, ciascun insieme nell'ordine di `needMore`. A ogni carenza va `count = Math.min(computeGenerationCount(s, config), budget)` e il budget scende di `count`. Si tengono solo quelle con `count > 0`. L'ordine dell'uscita è quello di `needMore`. Test: 4 carenze di cena da 5 ricette ciascuna → in totale 10, con prima i gruppi che hanno slot vuoti; un solo gruppo → identico a `computeGenerationCount`.
- **WP7 passo 4.** I lotti nascono da `planGeneration(shortagesToGenerate(...), config)`, ogni richiesta divisa con `splitGenerationBatches(r.count, config)`, al posto di `computeGenerationCount` per carenza.
- **`planner-config.ts`.** Il commento di `generationMax` resta vero. Va aggiunto in WP3: `(ripartito tra le portate da planGeneration)`.

### R3 — Il badge di portata sulla card può contraddire la composizione · medio (UX)

**Dove.** `components/plan/plan-slot-card.tsx:218` mostra `courseLabel(slot.recipe.courses)`, cioè **tutte** le portate della ricetta. WP8 non lo cambia.

**Perché.** Il pacchetto ha 41 ricette con più portate (es. `['secondo','piatto-unico']`). Se una di queste fa da secondo in un «secondo + contorno», la card mostra «Piatto unico · Secondo» proprio sopra la riga «Contorno». La card dice due cose diverse su come è composto il pasto, e la composizione non si legge da nessun'altra parte. Prima della Feature 11 non era un problema: il pasto era sempre una ricetta sola.

**Proposta (piccola, WP8 passo 3).** Sulla card del Piano il badge mostra la portata **dello slot**: `slot.recipe && slot.recipe.courses.length > 0 ? COURSE_LABELS[slot.course] : undefined`. Una ricetta non classificata resta senza badge, come oggi con `courseLabel([])`. Libreria, selettore e dettaglio continuano a mostrare tutte le portate della ricetta. Test in `plan-slot-card.test.tsx`: una ricetta `['secondo','piatto-unico']` in uno slot `secondo` mostra il badge «Secondo».

### R4 — Indice unico su espressione con drizzle-kit 0.30.6 · basso

**Dove.** WP2 passi 2–3. Il piano chiede di correggere `schema.ts` finché `pnpm db:generate` non dice «No schema changes». Un implementer su haiku può girare a vuoto su questa istruzione.

**Perché il rischio è basso.** Nel progetto c'è già un indice con un'espressione SQL, `recipes_title_trgm_idx` (`lib/db/schema.ts:67`), e drizzle-kit lo gestisce senza differenze spurie.

**Proposta (piccola, WP2 passo 3).** Una via d'uscita esplicita. Se dopo due tentativi `db:generate` segnala ancora differenze sull'indice, si sostituisce l'indice su espressione con due indici unici parziali equivalenti:
- `plan_slots_plan_day_meal_main_idx` su `(plan_id, day, meal)` con `.where(sql\`${table.course} <> 'contorno'\`)`;
- `plan_slots_plan_day_meal_side_idx` sulle stesse colonne con `.where(sql\`${table.course} = 'contorno'\`)`.

La migrazione cambia di conseguenza e il test di migrazione resta identico, perché controlla i vincoli e non il nome dell'indice.

### R5 — Il seme delle composizioni cambia la sequenza casuale dei test esistenti · basso

**Dove.** WP7 passo 4: `compositionSeed` consuma una chiamata di `ctx.rng` prima di `selectRecipes`.

**Perché.** I test di `tests/plans/` che controllano *quale* ricetta finisce in quale slot con un `rng` fisso possono cambiare risultato senza che ci sia un errore. Un implementer potrebbe scambiarlo per una regressione.

**Proposta.** Una frase in più in **WP7 passo 13**: «Un'attesa su una ricetta precisa ottenuta con un `rng` fisso può cambiare per il seme delle composizioni: si aggiorna l'attesa, non il codice, purché le proprietà controllate (nessun doppione, pasti pieni, ricette idonee) restino vere».

### R6 — L'household dei test non usa le composizioni di default · basso, nessuna azione

**Dove.** requirements P17: `createTestHousehold` scrive un solo `'piatto-unico'` per pasto, mentre in produzione il default è tutte e cinque.

**Perché non serve un'azione.** È voluto: tiene validi senza ritocchi una trentina di test dei piani. Il comportamento di produzione lo coprono `tests/plans/compose.test.ts` (5 composizioni) e `side-dish.test.ts`.

---

## 3. Il piano contro il codice: cosa va già bene

- **Si appoggia ai pattern esistenti.** Elenchi chiusi nello stile `X_VALUES` / `XSchema` / `X_LABELS`. Regole pure in `lib/domain/`. Due fasi con lock e rilettura (`swapSlot`). Test di migrazione su DB usa-e-getta (`recipe-courses-migration.test.ts`). Client con una funzione per rotta.
- **Nessun refactoring preliminare necessario.** Le modifiche transitorie di WP2 e WP3 (portata dedotta dalla ricetta, `'any-main'` nel servizio) costano poche righe e tengono verde il gate di ogni wave. WP7 le sostituisce.
- **Nessuna complessità sproporzionata.** `CourseFilter` con `'any-main'` serve comunque al selettore del principale. Il seme unico delle composizioni risolve un problema reale (requirements P5). `fillDish` toglie una duplicazione invece di crearne una.
- **Nessuna scorciatoia che crea debito**, a parte quelle già segnalate in R1–R3.

---

## 4. Se potessi migliorare solo 3 cose prima di procedere

1. **R1: lucchetto disattivato durante le azioni e `withMealFrom` che non tocca il blocco** (WP8). È l'unico punto in cui il piano, così com'è, produce uno stato sbagliato visibile all'utente. In più non rispetta la spec FR-4.5. Costa poche righe.
2. **R2: tetto di generazione per tipo di pasto con `planGeneration`** (WP3 + WP7). Senza, la feature quadruplica in silenzio il caso peggiore di costo e latenza del modello. È anche un contratto già scritto in `planner-config.ts`. Va deciso ora, perché cambia l'interfaccia tra planner e servizio.
3. **R3: badge della portata dello slot sulla card** (WP8). Con i contorni nel piano la card è l'unico posto dove si legge la composizione, e oggi la contraddirebbe in 41 ricette del pacchetto.

P3 (elenco unico degli errori "piano vecchio"), R4 (via d'uscita per l'indice) e R5 (frase sui test con `rng` fisso) costano una riga ciascuno: conviene innestarli insieme ai tre.
