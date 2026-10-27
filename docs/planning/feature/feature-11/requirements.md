# Feature 11 — Composizione del pasto: Requisiti e Decisioni

Memoria del "perché" dietro `plan.md`. Spec: `spec.md` di questa cartella (brainstorming del 27 ottobre 2026), con le decisioni D1–D12 recepite come definitive. Riferimenti: `docs/ARCHITECTURE.md §4.2, §5.2, §5.3, §6`, `docs/DESIGN.md §3, §4.1, §4.5, §5, §6`, `docs/DEPLOY.md §6`.

## 1. Layout e identità

- **Layout**: `docs/planning/` (da `.claude/agentic-feature-factory.local.md`), cartella `docs/planning/feature/feature-11/` (esisteva già con `brainstorm-prompt.md` e `spec.md`).
- **Titolo**: Feature 11 — Composizione del pasto (piatto unico, primo o secondo, con o senza contorno).
- **Prerequisiti**: Feature 1–10 in `main` (v0.9.0, merge `f991e6e`, chiusura `51f0587`). Vale "il codice reale vince".
- **Non è nel backlog** né in `execution-strategy.md`: l'unica fonte dei requisiti è `spec.md`.
- **Implementer**: `haiku` (impostazioni del plugin). Il piano scrive per esteso firme, testi e casi limite.

## 2. Decisioni prese con l'utente

| # | Decisione | Motivo |
|---|---|---|
| U1 | **Il contorno è una riga dentro la stessa card del pasto**, sotto un divisore tratteggiato, con l'etichetta «Contorno», il titolo e tre icone (⟳, lente, ✕). Senza contorno, nello stesso punto c'è «+ Contorno» (27 ottobre 2026) | Un pasto è una card; il lucchetto vale per tutto il pasto (D7). La mini-card separata raddoppiava i blocchi e l'altezza |
| U2 | **Le composizioni si scelgono anche nell'onboarding**, dentro il campo «Pasti da pianificare» (D11 della spec, rivista il 27 ottobre 2026) | Richiesta dell'utente: pasto e composizione si decidono insieme |
| U3 | D4–D7 della spec: default tutte e cinque; alternanza bilanciata; cambio da *Scegli* e con «+ Contorno» / *Togli*; blocco per pasto intero | Brainstorming del 27 ottobre 2026 |

## 3. Decisioni di planning (prese leggendo codice e spec)

| # | Decisione | Motivo |
|---|---|---|
| P1 | **Nove work package in quattro wave**: WP1 da solo; WP2 da solo; poi WP3, WP4, WP5, WP6 in parallelo; poi WP7, WP8, WP9 in parallelo | WP1 cambia l'enum delle etichette (rompe dati e test in un colpo solo); WP2 aggiunge campi obbligatori a tipi letti ovunque (`PlanSlotView.course`, `HouseholdSettings.meal_compositions`). Dopo, i blocchi sono a file disgiunti |
| P2 | **Due migrazioni**: `0006_remove_piatto_unico_tag` (WP1, solo `UPDATE`) e `0007_add_meal_compositions` (WP2, colonne e indice) | Togliere `piatto-unico` dall'enum in WP1 fa fallire il parse delle righe che la contengono: la pulizia dei dati deve arrivare nello stesso WP. Le colonne nuove servono solo da WP2 |
| P3 | **`CourseFilter = Course \| 'any-main'`** in `types.ts`, con `fitsCourse(courses, filter)` in `lib/domain/compositions.ts` | `'any-main'` serve comunque: è il filtro del selettore del principale (FR-5.4). In più permette a WP3 di cambiare le firme del planner senza cambiare comportamento (il servizio passa `'any-main'` fino a WP7) |
| P4 | **Ricetta non classificata**: ammessa in ogni slot principale (e in `'any-main'`), mai come contorno | Spec FR-3.4 |
| P5 | **Le composizioni del piano si estraggono con un seme fisso per tutta la costruzione** (`compositionSeed`, preso una volta da `ctx.rng` in `buildTargetPlan`) | `computeSelection` gira più volte (giri di generazione, poi di nuovo sotto lock). Con lo stesso seme le composizioni restano le stesse tra un giro e l'altro, e la generazione decide sulle stesse portate che poi si scrivono |
| P6 | **Pasto tenuto = (giorno, pasto) con almeno uno slot passato o bloccato**: si tengono tutti i suoi slot | Con il blocco per pasto (D7) è lo stesso insieme, ma regge anche dati incoerenti |
| P7 | **Indice unico su espressione** `plan_slots_plan_day_meal_side_idx (plan_id, day, meal, (course = 'contorno'))` | Al più un principale e un contorno per pasto (D3), senza colonne in più |
| P8 | **`exclusionReason(recipe, meal, course, ctx)` e `manualChoiceExclusionReason(recipe, meal, course, household)`**: la portata è il terzo parametro, il controllo `'course'` resta nello stesso punto dell'ordine | Un solo predicato per pasto e portata; il motivo `'course'` esiste già |
| P9 | **Carenze per (pasto, filtro di portata)**: `MealTypeShortage.course: CourseFilter`; i gruppi più scarsi si riempiono per primi | Generalizza l'ordine "il tipo con meno candidate va per primo" alle portate (spec 4.3) |
| P10 | **`deriveStyleTags(tags, ingredients)`**: il parametro `courses` sparisce con la regola su `piatto-unico` | La regola rimasta (`pochi-ingredienti`) non dipende dalla portata; 5 chiamanti da aggiornare |
| P11 | **`isMainDish` resta** in `courses.ts` (lo usano i test delle fixture); il planner usa `fitsCourse` | Nessuna modifica non necessaria |
| P12 | **Swap e «+ Contorno» condividono una funzione privata `fillDish`** in `service.ts` (scelta, generazione, rilettura sotto lock, uso, lista) | Stesse garanzie (spec 4.5), una sola implementazione |
| P13 | **Errori nuovi**: `side_not_allowed` (409), `side_exists` (409), `not_a_side_dish` (409) | Spec 4.5; 409 come gli altri conflitti di stato del piano |
| P14 | **Rotte**: `POST /api/plans/{id}/slots/{slotId}/side` (corpo dello swap) e `DELETE /api/plans/{id}/slots/{slotId}` | Spec 4.5; il `DELETE` sta nella rotta che ha già il `PATCH` del blocco |
| P15 | **Proposta di un contorno**: `ProposeRecipeRequestSchema.side_dish` (boolean, default `false`); con `true` la portata richiesta è `['contorno']` | Spec FR-5.6; il client manda il campo solo quando è `true`, così i corpi esistenti non cambiano |
| P16 | **`GenerateAndStoreInput.courses?: readonly Course[]`**, default `MAIN_COURSE_VALUES` | Spec 4.6; `/api/recipes/generate` resta com'è |
| P17 | **Nei test, `createTestHousehold` scrive `meal_compositions: { pranzo: ['piatto-unico'], cena: ['piatto-unico'] }` se non indicato** | Un piatto per pasto, come oggi: i test esistenti dei piani (ricette non classificate) restano validi. I test della composizione passano le loro composizioni |
| P18 | **Nel campo «Pasti da pianificare», togliere un pasto le cui composizioni sono vuote le riporta a tutte e cinque** | Il server vuole almeno una composizione per pasto (spec FR-2.4): un pasto nascosto con zero composizioni renderebbe il salvataggio impossibile senza che l'utente veda perché |
| P19 | **Card**: `MealCard` riceve `extra?: ReactNode` (contenuto sotto il footer, dentro la card) e `actionsDisabled?: boolean`; la riga contorno è un componente nuovo `components/plan/side-dish-row.tsx` | Spec 4.7; `MealCard` resta il componente del principale |
| P20 | **Aggiornamento locale per pasto** in `plan-screen.tsx`: `withMealFrom` sostituisce tutti gli slot di (giorno, pasto) con quelli della risposta | «+ Contorno», *Togli* e *Scegli* cambiano l'insieme degli slot del pasto: fondere per slot non basta |
| P21 | **Etichetta di stile tolta dai file**: `fixtures/recipe-pack.json` riscritto con `JSON.stringify(…, null, 2) + '\n'` (è il suo formato), `fixtures/recipes.json` e le 4 registrazioni corretti a mano solo nei `tags` | I `courses` non si toccano |
| P22 | **Versione**: la decide `/feature-dev` alla chiusura (`version_bump: ask`); proposta 0.10.0 | Cambia lo schema |

## 4. Fuori ambito (dalla spec §6)

Pasto completo primo + secondo; abbinamenti ragionati tra contorno e principale; ripiego su un'altra composizione; composizioni per giorno; selettore di composizione sulla card; blocco del singolo piatto; porzioni del contorno diverse; ricomposizione dei piani esistenti alla migrazione.

## 5. Verifiche manuali di chiusura

1. `docker build` + `scripts/smoke-prod.sh` su un DB con piani esistenti: migrazioni `0006` e `0007` applicate, piani leggibili, *Rigenera* produce pasti composti.
2. Prova da telefono a 360 px: card con e senza contorno, «+ Contorno», *Togli*, *Scegli* che cambia composizione; campo «Pasti da pianificare» nelle Impostazioni e in un onboarding da capo (DB nuovo).
3. Raspberry dopo il deploy: il piano si rigenera con i contorni e la lista della spesa li comprende.
