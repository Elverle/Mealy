# Code review — Feature 4 (E3 Pianificatore)

**Data:** 2026-09-29 · **Branch:** `feature/4-e3-pianificatore` · **Diff:** `git diff main...HEAD` (71 file, +8705/−687, commit `9757e1e..3faefb0`)
**Revisori:** due `feature-reviewer` (opus) su insiemi disgiunti — lato server (dominio, DB, servizio, rotte API) e lato client (UI, fetch client).
**Stato all'apertura:** gate verde (`lint` + `typecheck` + `test` 543/543 + `build`); nessun blocker. Le correzioni della [architecture review](architecture-review-2026-09-29.md) (R1–R6, P3, P4, D1–D4) sono tutte presenti; regole vincolanti rispettate.

Questo documento serve a eseguire le fix in un'altra sessione. Il triage è dell'utente: la colonna **Consiglio** è solo una proposta.

---

## Riepilogo

| ID | Gravità | Area | Titolo | Consiglio |
|---|---|---|---|---|
| M1 | MAJOR | server | Piano costruito su impostazioni vecchie non risulta "superato" | Correggere ora |
| M2 | MAJOR | client | Esito di Genera/Ripeti perso se si cambia settimana durante la richiesta | Correggere ora |
| m1 | MINOR | test | I due test di concorrenza della rigenerazione non testano R2 | Correggere ora |
| m2 | MINOR | server | Rigenera/Ripeti su bozza non marca la lista della spesa come da rigenerare | Rinviabile (o contratto F6) |
| m3 | MINOR | server | `maxDuration` sotto il caso peggiore documentato | Rinviabile |
| m4 | MINOR | docs | Testo dei contratti in `plan.md` non aggiornato (R4, D2) | Correggere ora |
| m5 | MINOR | client | Doppio invio di Ripeti durante il cambio settimana | Correggere ora |
| m6 | MINOR | client | Recupero su `network_error` (R1) a colpo singolo e con orologio del telefono | Rinviabile |
| m7 | MINOR | client | Il toast copre il footer sticky e ne intercetta i tap | Correggere ora |
| m8 | MINOR | a11y | Focus perso a ogni passo dello swap | Rinviabile |
| m9 | MINOR | client | Risposte di blocco/swap applicate "ultima vince" sull'intero piano | Rinviabile |
| Q1 | QUESTION | server | Swap consentito sui giorni passati della settimana corrente? | Proposta: vietarlo |
| Q2 | QUESTION | copy | Due descrizioni di `EmptyState` non previste; azione solo JS | Da confermare |

---

## MAJOR

### M1 — Piano costruito su impostazioni vecchie non risulta "superato"
**File:** `lib/plans/service.ts:252-265` (`resolvePlanContext`), `:438-476` (transazione), `:453` (`touchPlanGeneratedAt`); `lib/db/repositories/plan-repo.ts:163-183`.

**Problema.** L'household viene letto una volta sola, prima della generazione LLM (40–180 s). Dentro la transazione `computeSelection` e i `servings` usano ancora quell'household, mentre `generated_at = now()` viene scritto all'inizio della transazione, cioè **dopo** un eventuale salvataggio delle impostazioni fatto nel frattempo. Quindi `superseded = households.updated_at > generated_at` è `false` anche se il piano ignora i vincoli nuovi.

**Scenario.** Feriale, libreria scarsa: l'utente preme *Genera piano*; durante l'avanzamento apre Impostazioni, imposta `diet_tags: ['vegetariano']` e `persons: 4`, salva (T1). La transazione del piano parte a T2 > T1: piano con ricette di carne e `servings: 2`, `generated_at = T2`, nessun avviso "superato". (`generateAndStoreRecipes` rilegge l'household, quindi le ricette *nuove* rispettano la dieta; la *selezione* no.) Stesso percorso per `repeatPlan` (via `buildTargetPlan`). `swapSlot` ha la stessa lettura vecchia, ma non tocca `generated_at`, quindi lì l'avviso sopravvive.

**Fix proposta.** In `buildTargetPlan`, dopo `acquirePlanLock(tx, …)`, rileggere l'household con `tx` (READ COMMITTED dopo il lock vede le impostazioni salvate). Se `updated_at` differisce da `ctx.household.updated_at`, ricostruire il contesto con l'household fresco prima di `computeSelection` e usarlo per `servings` e per i pasti desiderati (`household.meals`). Se i vincoli nuovi lasciano uno slot vuoto, vale il rollback esistente `llmError ?? PlanError('insufficient_recipes')`. Valutare lo stesso nella fase 2 di `swapSlot` (per i filtri duri).

**Test.** DB test in `tests/plans/service.test.ts`: il `generate` finto chiama `updateHousehold({ diet_tags: ['vegetariano'], persons: 4 }, householdId)` prima di restituire; atteso: il piano rispetta la dieta e ha `servings: 4` (oppure, se si sceglie l'altra strada, `superseded: true`). Stesso caso per `repeatPlan` in `tests/plans/repeat.test.ts`.

### M2 — Esito di Genera/Ripeti perso se si cambia settimana durante la richiesta
**File:** `components/plan/plan-screen.tsx:144` (`useState(initialScreen)`), `:152-157`, `:184-192` (`adoptTargetScreen`), `:394-413` (navigatore).

**Problema.** Lo stato `screen` è inizializzato una volta da `initialScreen` e non si risincronizza quando la prop cambia a parità di `key`. Durante `isGenerating` restano attivi i link ‹ ›, la tab bar e "Pianifica la prossima settimana"; l'esito viene applicato dalla closure di un'istanza ormai smontata.

**Scenari.**
- *Genera:* sulla settimana obiettivo T l'utente preme *Genera piano* (40–90 s), va ‹ e torna ›. La nuova istanza di T è stata letta prima del commit → "Nessun piano in programma"; il `setScreen` della vecchia istanza è un no-op. Premendo di nuovo *Genera* il server rigenera la bozza mai vista (altro giro LLM).
- *Ripeti:* sulla settimana passata W1 l'utente preme *Ripeti questo piano*, poi va su T. La ripetizione termina nell'istanza smontata: imposta `pendingToast = 'Piano ripetuto'` e chiama `router.replace('/?settimana=T')`; stessa `key` T → nessun remount, `useState` ignora il nuovo `initialScreen`, lo schermo resta vecchio. `pendingToast` non viene consumato e compare al mount successivo (es. dopo ‹).

**Fix proposta.**
1. Risincronizzare lo stato quando arriva un nuovo `initialScreen` (pattern "adjust state on prop change" confrontando la prop precedente, oppure una `key` che includa anche `target_plan_status` / `view.plan?.generated_at`).
2. Durante `isGenerating` disabilitare la navigazione: link ‹ › nella variante `aria-disabled`, azione "Pianifica la prossima settimana" disabilitata.
3. Se la richiesta termina dopo lo smontaggio (ref `mounted`), chiamare `router.refresh()` invece di `setScreen`.
4. Scrivere `pendingToast` solo quando la navigazione provocherà davvero un remount (settimana mostrata ≠ obiettivo), e azzerarlo se non consumato.

**Test.** In `tests/ui/plan-screen.test.tsx`: `rerender` di `PlanScreen` con la stessa `key` e un `initialScreen` nuovo → il piano nuovo è mostrato; link ‹ › disabilitati durante la generazione; esito arrivato dopo l'unmount → `router.refresh` chiamato, nessun toast pendente al mount successivo.

---

## MINOR

### m1 — I test di concorrenza della rigenerazione non testano R2
**File:** `tests/plans/service.test.ts:556-608`.
Il blocco/sblocco avviene dentro `generate`, cioè **prima** della `select()` post-giro (`service.ts:432`), che già vede il cambiamento: i due test passerebbero anche se la transazione riusasse la selezione esterna (il bug originale di R2).
**Fix.** Cambiare lo slot nella finestra reale tra l'ultima selezione esterna e il lock: aprire una transazione che tiene `acquirePlanLock(tx, householdId)`, avviare `generatePlan` (senza generazione necessaria), attendere che sia in attesa del lock (query su `pg_locks`, o piccolo polling), sbloccare/bloccare lo slot nella transazione che tiene il lock, fare commit; verificare niente buchi e nessuna ricetta ripetuta. Verificare che il test fallisca se si rimuove la ri-selezione dentro la transazione.

### m2 — Rigenera/Ripeti su bozza non marca la lista come da rigenerare
**File:** `lib/plans/service.ts:451-476` (`buildTargetPlan`, ramo `current !== null`).
Lo swap chiama `markShoppingListStale`, `buildTargetPlan` no. F6 lega le liste a un `plan_id` esplicito (`/lista?piano=`) e nulla impedisce una lista su una bozza: sostituendo gli slot, `needs_regeneration` resta `false`.
**Fix.** `await markShoppingListStale(tx, planId)` nel ramo di aggiornamento di un piano esistente, con test (riga inserita a mano in `shopping_lists` → dopo la rigenerazione `needs_regeneration: true`). In alternativa scrivere nel contratto per F6 "liste solo su piani `active`".

### m3 — `maxDuration` sotto il caso peggiore documentato
**File:** `app/api/plans/route.ts:8-9` (il commento calcola 2 × 2 × 90 s = 360 s, il valore è 300); rotte swap e repeat a 200 mentre `.env.example` ammette `LLM_TIMEOUT_MS` fino a 120000 (2 × 120 = 240 s).
Sul Raspberry (Next standalone) `maxDuration` non è applicato; morderebbe solo sull'opzione futura Vercel, uccidendo la funzione prima della scrittura.
**Fix.** Allineare i valori (es. 360 e 240, aggiornando `tests/api/plans*.test.ts`) oppure dichiarare il limite nel commento della rotta e in `ARCHITECTURE.md §6`.

### m4 — Testo dei contratti in `plan.md` non aggiornato
**File:** `docs/planning/feature/feature-4/plan.md:602, 669, 998` (dicono che `loadIngredientPreferences` sta in `lib/plans/service.ts` ed è "l'unico punto" per F5) e `:999` (F6 punta a `/lista` invece di `/lista?piano=`).
**Fix.** Aggiornare: F5 cabla `loadIngredientPreferences` in `lib/prefs/ingredient-prefs.ts` e lo usa anche in `buildConstraints` (`lib/recipes/constraints.ts`); F6: il pulsante porta a `/lista?piano={plan.id}`; nel weekend possono esistere due piani non chiusi (Addendum D2). Aggiungere nei contratti per F6 anche `PlanScreenView.target_plan_status`/`current_plan_id` se utili. Il commento nel codice (`lib/prefs/ingredient-prefs.ts:20`) è già corretto.

### m5 — Doppio invio di Ripeti durante il cambio settimana
**File:** `components/plan/plan-screen.tsx:244-246`, `:419-428`.
`finally { setIsGenerating(false) }` scatta subito dopo `router.replace`; finché non arriva l'RSC della settimana obiettivo la vecchia settimana è di nuovo visibile (`opacity-60`) con *Ripeti questo piano* abilitato → secondo `requestRepeatPlan` e secondo toast.
**Fix.** Lasciare `isGenerating` a `true` quando l'esito è una navigazione (il remount lo azzera), oppure disabilitare anche con `isNavigating`. Test: dopo il click, finché la navigazione è pendente il pulsante resta disabilitato.

### m6 — Recupero su `network_error` (R1) a colpo singolo
**File:** `components/plan/plan-screen.tsx:195-211`, `:232-236`.
Quando la connessione cade a metà generazione, di solito il server sta ancora generando: il `fetchPlanScreen` immediato non trova un piano nuovo (o fallisce anch'esso) e l'utente vede "Connessione non disponibile.", ripreme e rilancia l'LLM. Inoltre nel ramo `baselineGeneratedAt === undefined` (bozza obiettivo esistente ma non mostrata) si confronta `generated_at` del server con `Date.now()` del client: lo sfasamento di orologio telefono/Pi può far adottare o scartare a torto; ramo non coperto da test.
**Fix.** Ritentare alcune volte con backoff (fino a circa il caso peggiore della rotta) prima di mostrare l'errore, con un messaggio di attesa; per il ramo `undefined` usare una base lato server (es. `fetchPlanScreen(target.week_start)` prima della POST, o esporre il `generated_at` del piano obiettivo). Test per entrambi.

### m7 — Il toast copre il footer sticky
**File:** `components/feedback/toast.tsx:35-37` vs `components/plan/plan-screen.tsx:456`.
Il footer occupa ~64–136 px dal fondo; il toast sta a `bottom-24` (96 px) con la pillola `pointer-events-auto`. Subito dopo "Piano confermato" copre *Crea lista della spesa* per 3 s e ne intercetta i tap.
**Fix.** Pillola `pointer-events-none` (il toast non ha azioni), oppure alzarlo quando c'è il footer. Opzionale nello stesso intervento: live region persistente e vuota a cui si assegna il testo (le live region inserite già piene sono annunciate male da VoiceOver iOS).

### m8 — Focus perso a ogni passo dello swap
**File:** `components/plan/plan-slot-card.tsx:96-101`, `:122-126`.
*Cambia* viene sostituito dal testo di stato e la `key` del wrapper cambia (idle → swapping → `review-<id>`), rimontando la `MealCard`: utenti da tastiera/screen reader finiscono su `<body>`.
**Fix.** In review portare il focus su *Tieni*; dopo *Tieni* o un errore, di nuovo su *Cambia*. Oppure tenere la `key` solo su un elemento interno animato, senza rimontare i pulsanti. Test con `document.activeElement`.

### m9 — Risposte di blocco/swap "ultima vince"
**File:** `components/plan/plan-screen.tsx:288`, `:329`.
Ogni risposta sostituisce `view.plan` con l'istantanea del server al momento della richiesta: se arrivano fuori ordine (istantanea dello swap presa prima di un blocco successivo, arrivata dopo), lo slot risulta sbloccato mentre sul server è bloccato, e la card può restare in review su uno slot bloccato. Finestra stretta.
**Fix.** Dalle risposte di swap e blocco unire solo lo slot interessato (ricetta o `locked`), oppure scartare istantanee più vecchie dell'ultima applicata.

---

## QUESTION

### Q1 — Swap sui giorni passati della settimana corrente
**File:** `lib/plans/service.ts:572-578` (`findSwappableSlot` non controlla `slot.day < today`).
Il mercoledì si può cambiare la cena di lunedì; su un piano confermato l'uso viene registrato alla data di lunedì per un pasto mai consumato, mentre la rigenerazione considera i giorni passati immutabili.
**Proposta.** Vietarlo: `slot.day < today` → errore (nuovo codice, es. `slot_past` 409 `Questo pasto è già passato.`, oppure riuso di `plan_archived`), e nella UI `PlanSlotCard` non passare `onSwap`/`onLongPress`/`onToggleLock` per gli slot passati (il dato `today` è già in `PlanScreenView`). Da decidere se il blocco resta consentito sui giorni passati.

### Q2 — Copy delle `EmptyState` e azione solo JS
**File:** `components/plan/plan-screen.tsx:366`, `:375`.
Descrizioni non presenti nel piano né nella review: `Nel weekend si pianifica la settimana che arriva.` e `Per questa settimana non c'è nessun pasto da mostrare.` Da confermare rispetto al tono di `DESIGN.md §5`. Inoltre "Pianifica la prossima settimana" è un pulsante solo JS (`EmptyState` non accetta `href`), a differenza dei link ‹ ›: accettabile, o serve una variante con link?

---

## Note non conteggiate
- **Preesistente:** `RecipeSheet` azzera lo stepper delle porzioni quando cambia l'identità di `recipe` (`components/sheets/recipe-sheet.tsx:75-80`); in `PlanScreen` qualsiasi aggiornamento del piano con la sheet aperta lo ricostruisce.
- **Preesistente, amplificato da R1:** `generateAndStoreRecipes` (`lib/recipes/generate.ts:73-81`) calcola i titoli da escludere prima della chiamata LLM; i lotti paralleli dello stesso pasto non si vedono tra loro e i quasi-duplicati vengono scartati come `duplicate` (solo token sprecati, può far partire il secondo giro).
- **Buchi di test segnalati:** settimana corrente modificabile nel weekend (swap/blocco/conferma ammessi, niente Genera); modifier-click sui link del navigatore; ramo `undefined` del recupero R1 (v. m6).
- **Non revisionato:** rendering reale su dispositivo (sovrapposizione toast/footer calcolata dalle classi); comportamento del router Next reale su `router.replace` verso lo stesso URL; `0003_snapshot.json` campo per campo (verificata solo la catena `prevId` e le due colonne).

---

## Istruzioni per la sessione di fix

**Stato del repository.**
- Branch `feature/4-e3-pianificatore`, 8 commit sopra `main` (`9757e1e` … `3faefb0`), uno per WP più `ef8e075` (contratto `target_plan_status`/`current_plan_id`).
- Modifiche **non** della feature da lasciare fuori dai commit: `.claude/agentic-feature-factory.local.md`.
- File della feature ancora da committare (vanno nel commit finale): `docs/planning/feature/feature-4/` (plan, requirements, architecture review, questo documento) e la riga di `docs/planning/feature-index.md`.
- Impostazioni pipeline: `auto_commit: true`, `commit_per_wp: true`, `version_bump: ask`.
- DB di sviluppo: `mealy-postgres-dev` sulla porta 5432 (`DATABASE_URL` di `.env`); `.env` già aggiornato a `LLM_TIMEOUT_MS=90000`.

**Procedura.**
1. Decidere il triage (e le risposte a Q1/Q2) prima di toccare codice.
2. Per ogni fix scelta: implementer mirato, test prima del codice; poi gate completo `pnpm lint && pnpm typecheck && pnpm test && pnpm build` verde; commit `fix(feature-4): <titolo>` (o raggruppati per area server/client).
3. Chiusura della feature (`/feature-dev 4`, fasi 7–9):
   - documentazione con `feature-documenter` (wiki `docs/wiki/`: nuove entità `planner`, `plan-repo`, `plan-service`, `plan-screen`; aggiornamenti `domain-types`, `database-schema`, `meal-card`, `recipe-sheet`, `recipe-generation`; README se cambia qualcosa di visibile, es. `LLM_TIMEOUT_MS`);
   - version bump (`ask`: proposta `minor`, 0.2.0 → 0.3.0, la feature aggiunge capacità utente);
   - commit finale con documentazione, planning della feature e bump; `feature-index.md` → `reviewed` o `done`;
   - verifica manuale da telefono: genera → sfoglia (sheet) → swap con flip e *Tieni / Cambia ancora* → blocco con long-press → conferma, più navigatore ‹ › e *Ripeti*.
4. Nessun push né PR senza richiesta esplicita.

---

## Esito delle fix (2026-09-29)

**Triage:** tutte le fix (M1, M2, m1–m9). **Q1:** swap vietato sui giorni passati, blocco consentito. **Q2:** copy e pulsante solo JS confermati, nessuna modifica.

| ID | Esito | Dove |
|---|---|---|
| M1 | Household e preferenze riletti con `tx` dopo il lock in `buildTargetPlan` (selezione, `servings`, pasti) e nella fase 2 di `swapSlot` (che ora calcola `superseded` con l'household riletto). `getHouseholdById` accetta un `executor`. | `lib/plans/service.ts` (`loadConstraints`), `lib/db/repositories/household-repo.ts`; test in `service`, `repeat`, `swap` |
| M2 | Stato riallineato quando arriva un nuovo `initialScreen` con la stessa `key`; frecce ‹ › disabilitate durante la generazione; esito arrivato dopo lo smontaggio → `router.refresh()`, niente toast né navigazione; toast in attesa legato alla settimana obiettivo e scartato altrove. | `components/plan/plan-screen.tsx`; `tests/ui/plan-screen.test.tsx` |
| m1 | I due test di concorrenza cambiano lo slot in una transazione che tiene il lock mentre `generatePlan` è in coda (`pg_locks`). Verificato che falliscono riusando la selezione esterna. | `tests/plans/service.test.ts` |
| m2 | `markShoppingListStale` nel ramo di aggiornamento di `buildTargetPlan` (rigenera e *Ripeti* su bozza). | `lib/plans/service.ts` |
| m3 | `maxDuration` 500 (piano) e 250 (swap, *Ripeti*): coprono `LLM_TIMEOUT_MS` = 120 s, con margine. Documentato in `ARCHITECTURE.md §6`. | rotte `app/api/plans/**`; `tests/api/plans*.test.ts` |
| m4 | Contratti F5/F6 aggiornati (`lib/prefs/ingredient-prefs.ts`, `/lista?piano=`, D2, `target_plan_status`/`current_plan_id`). | `plan.md` |
| m5 | `isGenerating` resta `true` quando l'esito è una navigazione: niente doppio invio di *Ripeti*. | `plan-screen.tsx` |
| m6 | Recupero con backoff (2 s → 30 s) fino a `maxDuration` della rotta, messaggio di attesa e *Smetti di aspettare*; base del ramo "bozza obiettivo non mostrata" letta dal server prima della POST (se non leggibile, niente recupero). | `plan-screen.tsx` |
| m7 | Toast senza `pointer-events`, alzato sopra il footer sticky; live region sempre montata e vuota a riposo. | `components/feedback/toast.tsx`, `plan-screen.tsx` |
| m8 | Focus su *Tieni* all'arrivo della proposta, su *Cambia* dopo *Tieni* o un errore (su *Cambia ancora* dopo un errore in revisione), solo se l'utente non l'ha spostato altrove. | `components/plan/plan-slot-card.tsx` |
| m9 | Risposte di swap e blocco applicate solo allo slot interessato (ricetta/porzioni + stato della lista, oppure `locked`). | `plan-screen.tsx` (`withSlotFrom`) |
| Q1 | Nuovo codice `slot_past` (409, `Questo pasto è già passato.`); nella UI niente *Cambia* sui giorni passati, blocco disponibile. Documentato in `ARCHITECTURE.md §6`. | `lib/plans/errors.ts`, `service.ts`, `plan-slot-card.tsx` |

**Gate:** `lint` ✓ · `typecheck` ✓ · `test` 571/571 ✓ · `build` ✓.
