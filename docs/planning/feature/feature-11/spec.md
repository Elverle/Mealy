# Feature 11 — Composizione del pasto

Specifica del 27 ottobre 2026, da `/feature-brainstorm`. Chiude la serie che riprende il rework del catalogo:

| Ordine | Feature | Contenuto |
|---|---|---|
| 1 | 8 — Portate ed etichette | Portata di ogni ricetta (`../feature-8/spec.md`) |
| 2 | 10 — Pacchetto iniziale | 200 ricette, di cui 60 contorni (`../feature-10/spec.md`) |
| 3 | **11 — Composizione del pasto** (questa) | Piatto unico, primo o secondo, con o senza contorno |

Spunto: [`brainstorm-prompt.md`](brainstorm-prompt.md) (14 ottobre 2026). Prossimo passo: `/feature-plan 11 docs/planning/feature/feature-11/spec.md`.

## 1. Problema e obiettivo

**Problema.** Oggi un pasto è una sola ricetta. Dalla Feature 8 ogni ricetta ha una portata, ma il planner la usa solo per escludere i contorni (`exclusionReason` in `lib/domain/planner.ts`, controllo `isMainDish`). Una cena «secondo con contorno», la forma più comune di un pasto italiano, non si può pianificare. I 60 contorni del pacchetto (Feature 10) sono in libreria, ma non entrano mai nel piano né nella lista della spesa.

**Utente.** L'utente unico dell'app: sceglie le composizioni nell'onboarding o nelle Impostazioni e le ritocca sulla card del pasto, dal telefono.

**Risultato atteso.**

- Nell'onboarding e nelle Impostazioni, accanto ai pasti da pianificare, si indicano, per pranzo e per cena, le composizioni ammesse tra cinque: piatto unico, primo, primo + contorno, secondo, secondo + contorno.
- *Genera piano* distribuisce le composizioni ammesse in modo bilanciato nella settimana e riempie ogni piatto con la selezione pesata dalla libreria. Il modello interviene solo se una portata non basta, come oggi.
- Sulla card del pasto si aggiunge o si toglie il contorno. Passando da *Scegli* si cambia anche la composizione.
- Lista della spesa, conferma del piano, blocco e *Ripeti* tengono conto di tutti i piatti del pasto.
- L'etichetta di stile `piatto-unico` sparisce: la sostituisce la composizione.

## 2. Decisioni e motivazioni

| # | Decisione | Motivo |
|---|---|---|
| D1 | **Uno slot per piatto**: `plan_slots.course`, e il pasto è il gruppo di slot con lo stesso `(day, meal)` | Swap, scelta a mano, uso delle ricette e lista della spesa lavorano già per slot e restano quasi invariati. Scartati `side_recipe_id` su `plan_slots` (ogni azione andrebbe scritta due volte) e una tabella figlia `slot_dishes` (riscrive tutta la logica degli slot). Già proposto nello spunto. |
| D2 | **La composizione del pasto si ricava dalle portate dei suoi slot**: nessuna colonna «composizione» | Una sola fonte di verità: non può esserci disaccordo tra composizione dichiarata e piatti presenti. |
| D3 | **Al più un piatto principale e un contorno per pasto**, garantito da un indice unico | Rende impossibile, già nel DB, un pasto con due principali o due contorni. |
| D4 | **Default: tutte e cinque le composizioni** per pranzo e cena, sia per un household nuovo sia per quello esistente | Scelta dell'utente del 27 ottobre 2026: il contorno entra subito nei piani, e nelle Impostazioni si restringe. |
| D5 | **Alternanza bilanciata**: per ogni tipo di pasto, conteggi il più possibile uguali tra le composizioni ammesse, assegnati ai giorni in ordine sorteggiato | Scelta dell'utente. È prevedibile (niente 6 cene su 7 uguali) e deterministica a parità di `rng`, come il resto del planner. |
| D6 | **Cambio di composizione da *Scegli* e con «+ Contorno» / «Togli»**: nessun selettore di composizione sulla card | Scelta dell'utente. *Cambia* resta a un tap e tiene la portata del piatto (`DESIGN.md §3`). *Scegli* sul piatto principale mostra tutte le principali del pasto, e la composizione segue la ricetta scelta. |
| D7 | **Blocco per pasto intero**: un lucchetto per card, che blocca tutti i piatti del pasto | Scelta dell'utente. La card resta come oggi e *Rigenera* tiene il pasto bloccato con la sua composizione. |
| D8 | **Piani esistenti: un piatto per pasto**, con la portata ricavata dalla ricetta. Li ricompone solo *Rigenera* | La migrazione non sorteggia nulla e non tocca ricette scelte o confermate. |
| D9 | **Porzioni del contorno = porzioni del pasto** (`household.persons`, come gli altri slot) | Nessun caso d'uso per porzioni diverse. |
| D10 | ***Ripeti* copia anche la composizione** di ogni pasto, anche se non è più tra quelle ammesse | *Ripeti* vuol dire «rifammi quella settimana». Le composizioni ammesse guidano solo i pasti nuovi. |
| D11 | **Le composizioni si scelgono dentro il campo «Pasti da pianificare»**: sotto ogni pasto selezionato, le sue composizioni. Vale per l'onboarding e per le Impostazioni | Richiesta dell'utente del 27 ottobre 2026. Il campo è lo stesso componente nel wizard (un campo per passo, `SETTINGS_FIELD_ORDER`) e nel form delle Impostazioni, quindi non serve un passo in più. Pasto e composizione si decidono insieme. |
| D12 | **Etichetta di stile `piatto-unico` tolta** da enum, preferenze dell'household, ricette, fixture e registrazioni | Decisione dello spunto (14 ottobre 2026): la portata e la composizione ne fanno le veci. Era già un doppione della portata (Feature 8). |

## 3. Requisiti funzionali

### FR-1 — Composizioni

1. Le composizioni sono cinque, in quest'ordine fisso: `piatto-unico`, `primo`, `primo-contorno`, `secondo`, `secondo-contorno`. Etichette: «Piatto unico», «Primo», «Primo + contorno», «Secondo», «Secondo + contorno».
2. Ogni composizione ha un **piatto principale** (portata `piatto-unico`, `primo` o `secondo`) e, nelle due «+ contorno», un **contorno** (portata `contorno`).
3. Un pasto del piano ha sempre una delle cinque composizioni: un principale, più al massimo un contorno, e il contorno solo con un primo o un secondo.

### FR-2 — Impostazioni e onboarding

1. Il campo «Pasti da pianificare» (`MealsField`) cresce (D11). Sotto i chip Pranzo / Cena, per ogni pasto selezionato c'è un gruppo con il nome del pasto e cinque chip a scelta multipla, uno per composizione. Un pasto non selezionato non ha il gruppo. Il gruppo compare e sparisce quando si attiva o si disattiva il pasto.
2. Il campo è valido solo se c'è almeno un pasto e ogni pasto selezionato ha almeno una composizione. Altrimenti, nell'onboarding *Avanti* è disattivato, nelle Impostazioni lo è *Salva*. Sotto il gruppo vuoto compare «Scegli almeno una composizione.», nello stile di «Scegli almeno un pasto.».
3. Il campo mantiene il suo posto nel wizard (secondo passo), senza passi in più. La descrizione del campo cita anche la composizione, per esempio «Quali pasti vuoi trovare nel piano, e come li componi?».
4. Le composizioni si salvano per entrambi i pasti anche quando un pasto non è pianificato, così lo ritrovi com'era quando lo riattivi.
5. Salvare composizioni diverse aggiorna `households.updated_at`, quindi il piano in bozza risulta superato (`superseded`) come per gli altri vincoli. I piani esistenti non cambiano finché non si rigenera.
6. Default per un household nuovo (e quindi la preselezione dell'onboarding) e per quello esistente: tutte e cinque, per pranzo e per cena (D4).
7. Il campo «Tipo di pasti» non ha più il chip «Piatto unico» (FR-8).

### FR-3 — Generazione del piano

1. Per ogni giorno da pianificare e ogni pasto pianificato si sceglie una composizione tra quelle ammesse per quel pasto, e ne nascono uno o due slot: il principale con la portata della composizione, più il contorno se previsto.
2. **Bilanciamento** (D5). Per ogni tipo di pasto, con `n` pasti da riempire e `k` composizioni ammesse, ogni composizione esce `⌊n/k⌋` volte. Le `n mod k` uscite in più vanno a composizioni sorteggiate con `rng`, senza ripetizioni. Poi le uscite si mescolano con `rng` e si assegnano ai giorni in ordine. A parità di input e di `rng` il risultato è lo stesso.
3. **Pasti tenuti** (giorni passati e pasti bloccati) restano con la loro composizione e i loro piatti, e non contano nel bilanciamento.
4. **Idoneità di una ricetta per uno slot.** Valgono le regole di oggi (blocco, tipo di pasto, diete, elettrodomestici, ingredienti scartati, esclusioni), e in più la portata:
   - slot con portata principale `c`: la ricetta ha `c` tra le portate, oppure non è classificata (`courses` vuoto);
   - slot contorno: la ricetta ha `contorno` tra le portate. Una ricetta non classificata non fa mai da contorno.
5. Una ricetta con più portate (per esempio `['secondo', 'piatto-unico']`) è candidata per ognuna di esse. Nessuna ricetta compare due volte nello stesso piano, contorni compresi.
6. **Carenze e generazione.** Il planner segnala la carenza per coppia (tipo di pasto, portata), con la stessa regola di oggi: candidate fresche `< slot + minPoolSize − 1`, oppure slot rimasti vuoti. Il servizio genera per ogni coppia carente, chiedendo al modello ricette di quella portata (contorni compresi), con gli stessi limiti di lotti e giri di oggi.
7. Se dopo la generazione resta un piatto senza ricetta, il piano non si scrive e la risposta è quella di oggi (`insufficient_recipes`, o l'errore del modello).

### FR-4 — Il pasto nel Piano

1. Una card per pasto, come oggi. Il piatto principale ha la presentazione attuale: eyebrow giorno · pasto, titolo, badge della portata, chip, *Cambia*, *Scegli*, ★ e lucchetto.
2. Se il pasto ha il contorno, sotto il principale c'è una **riga contorno** con l'etichetta «Contorno», il titolo della ricetta (il tap apre il dettaglio) e tre azioni a icona da 44 px: *Cambia contorno* (⟳), *Scegli contorno* (lente) e *Togli contorno* (×). La ★ del contorno si mette dal dettaglio.
3. Se il principale è un primo o un secondo e il pasto non ha contorno, sotto il principale c'è il pulsante secondario **«+ Contorno»**. Con un piatto unico il pulsante non c'è.
4. Su un pasto bloccato, su un giorno passato o su un piano non modificabile, la riga contorno resta in sola lettura (titolo e dettaglio) e il pulsante «+ Contorno» non c'è.
5. Mentre un'azione su un piatto è in corso, le altre azioni della stessa card sono disattivate.

### FR-5 — Azioni sui piatti

1. ***Cambia* sul principale**: come oggi (flip, *Tieni* / *Cambia ancora*, lente), e la nuova ricetta ha la stessa portata dello slot.
2. ***Cambia contorno***: sostituisce subito il contorno con un altro contorno, senza passo di revisione. I contorni scartati nella sequenza si escludono come nello swap del principale, entro `SWAP_EXCLUDE_MAX`, finché la card resta montata.
3. Entrambi seguono le regole dello swap di oggi: niente ricette già nel piano o scartate, modello solo se la libreria non offre alternative, risposta `no_alternatives` se non c'è niente.
4. ***Scegli* sul principale**: il selettore elenca le ricette idonee per il pasto con una qualsiasi portata principale (FR-3.4, senza gli ingredienti scartati e senza le esclusioni, come oggi). La ricetta scelta fissa la portata del principale:
   - se ha la portata attuale del principale, la tiene;
   - altrimenti, se il pasto ha il contorno e la ricetta è un primo o un secondo, prende quella (primo prima di secondo);
   - altrimenti prende la prima tra `piatto-unico`, `primo`, `secondo` che la ricetta ha;
   - una ricetta non classificata tiene la portata attuale.

   Se la portata risultante è `piatto-unico`, il contorno del pasto si toglie nella stessa operazione. La composizione che ne esce può anche non essere tra quelle ammesse: la scelta a mano vince sulle Impostazioni, come già vince sugli ingredienti scartati.
5. ***Scegli contorno***: il selettore elenca solo i contorni idonei (FR-3.4), con le regole della scelta a mano di oggi.
6. **Richiesta al modello dal selettore** (Feature 9): dal selettore del principale chiede una ricetta con portata principale, come oggi; da quello del contorno chiede un contorno.
7. **«+ Contorno»**: aggiunge al pasto uno slot contorno, riempito come un *Cambia* (selezione pesata, esclusioni del piano, modello solo se serve). Dopo l'aggiunta la riga contorno sostituisce il pulsante.
8. ***Togli contorno***: cancella lo slot contorno, senza conferma. Il principale non cambia.
9. Ogni azione che cambia i piatti segna la lista della spesa da rifare. Su un piano confermato, la ricetta che entra conta un uso (`times_used`, `last_used_at`) come nello swap di oggi; quella che esce non perde l'uso.

### FR-6 — Blocco

1. Il lucchetto e il long-press della card bloccano o sbloccano **tutti** i piatti del pasto (D7).
2. Un pasto bloccato rifiuta *Cambia*, *Scegli*, «+ Contorno» e *Togli contorno* (`slot_locked`).
3. *Rigenera* tiene i pasti bloccati con tutti i loro piatti.
4. I piatti di uno stesso pasto hanno sempre lo stesso stato di blocco.

### FR-7 — Piani esistenti, *Ripeti*, conferma, lista

1. **Migrazione** (D8): ogni slot esistente riceve la portata del principale, ricavata dalla ricetta: la prima tra `piatto-unico`, `primo`, `secondo` che la ricetta ha, altrimenti `piatto-unico` (ricetta non classificata o eliminata). Nessun piano esistente riceve contorni.
2. ***Ripeti*** (D10): per ogni pasto della settimana di origine, il pasto dello stesso giorno della settimana prende la stessa composizione e, per ogni piatto, la stessa ricetta se è ancora idonea per quel piatto (FR-3.4). Un piatto la cui ricetta non è più idonea si riempie con il planner nella stessa portata. I pasti che nell'origine mancano prendono le composizioni ammesse, bilanciate (FR-3.2).
3. **Conferma**: l'uso si conta per ogni piatto, contorni compresi.
4. **Lista della spesa**: consolida gli ingredienti di tutti i piatti, contorni compresi, con le porzioni dello slot. Il consolidamento per slot c'è già (`lib/domain/shopping-list.ts`): basta verificare che i contorni ci arrivino.

### FR-8 — Etichetta `piatto-unico` tolta

1. `piatto-unico` esce da `MEAL_STYLE_TAG_VALUES` e dalle etichette di stile. Resta come portata (`COURSE_VALUES`) e come composizione.
2. La migrazione la toglie da `households.meal_style_tags` e da `recipes.tags`.
3. Spariscono le regole che la tenevano allineata alla portata: `deriveStyleTags` e il filtro di `recipeChips` sul chip doppione. Nei prompt non è più tra le etichette ammesse.
4. Si aggiornano `fixtures/recipes.json`, `fixtures/recipe-pack.json` e le registrazioni in `tests/fixtures/llm/recorded/` che la contengono, togliendo il valore dai `tags`.
5. Nella Libreria resta il solo chip «Piatto unico» del filtro *Portata*.

## 4. Progettazione tecnica

### 4.1 Dominio (`lib/domain/types.ts`, unica fonte)

- `MEAL_COMPOSITION_VALUES = ['piatto-unico', 'primo', 'primo-contorno', 'secondo', 'secondo-contorno']`, `MealCompositionSchema`, `MEAL_COMPOSITION_LABELS`.
- `MealCompositionsSchema`: oggetto con una chiave per ogni `MealType` e valore `MealComposition[]`, min 1, senza doppioni. `DEFAULT_MEAL_COMPOSITIONS` con tutte e cinque per ogni pasto.
- `HouseholdSchema`, `HouseholdSettingsSchema`, `SettingsViewSchema`: campo `meal_compositions`. `DEFAULT_HOUSEHOLD` con il default.
- `PlanSlotSchema` e `PlanSlotViewSchema`: campo `course: CourseSchema`. `PlanViewSchema.slots` ordinati per giorno, poi pranzo → cena, poi principale → contorno.
- `MEAL_STYLE_TAG_VALUES` senza `piatto-unico` (FR-8).

### 4.2 Regole pure (`lib/domain/`)

Un modulo nuovo, per esempio `lib/domain/compositions.ts`, senza dipendenze da DB o LLM:

- `compositionCourses(composition)`: `{ main: Course; side: boolean }`.
- `mealComposition(portate)`, con le portate degli slot del pasto: la composizione di un pasto, oppure `null` se le portate non ne formano una.
- `distributeCompositions(allowed, count, rng)`: elenco di `count` composizioni bilanciate e mescolate (FR-3.2).
- `fitsCourse(recipeCourses, slotCourse)`: la regola di FR-3.4. Si appoggia a `coursesAllowed` per i principali e aggiunge l'esclusione dei non classificati per il contorno.
- `mainCourseForChoice(recipeCourses, currentCourse, hasSide)`: la regola di FR-5.4.

`isMainDish` e il commento «fino alla Feature 11» in `exclusionReason` spariscono: la portata dello slot entra nei parametri di `exclusionReason` e di `manualChoiceExclusionReason`. Per la scelta a mano del principale vale «una qualsiasi portata principale». `findConstraintViolations` (`lib/recipes/constraints.ts`) resta allineata, come chiede il commento in `planner.ts`.

### 4.3 Planner (`lib/domain/planner.ts`)

- `PlannerSlot` riceve `course`. La chiave diventa `${day}|${meal}|${course}`.
- Le candidate idonee si calcolano per coppia (tipo di pasto, portata). L'ordine «il gruppo con meno candidate va per primo» passa dalle coppie, così una ricetta con più portate non affama la portata più scarsa.
- `MealTypeShortage` riceve `course`, e `needMore` è ordinato per tipo di pasto, poi per portata (`COURSE_VALUES`).
- `selectRecipes` resta deterministica e senza chiamate LLM.

### 4.4 Database e migrazione

- `plan_slots.course text not null`. Valore degli slot esistenti calcolato in SQL dalla ricetta (FR-7.1).
- L'indice `plan_slots_plan_day_meal_idx` si sostituisce con un indice unico che ammette al più un principale e un contorno per `(plan_id, day, meal)`, per esempio su `(plan_id, day, meal, (course = 'contorno'))`.
- `households.meal_compositions jsonb not null` con il default di D4, validato da `MealCompositionsSchema` in lettura e in scrittura.
- `array_remove(..., 'piatto-unico')` su `households.meal_style_tags` e `recipes.tags`.
- Una sola migrazione drizzle-kit, applicata all'avvio come le altre (`lib/db/bootstrap.ts`). Il ritorno a una versione precedente passa solo dal dump, come per la 0.8 (`docs/DEPLOY.md`).

### 4.5 Servizio dei piani (`lib/plans/service.ts`) e rotte

- `desiredSlots` diventa «pasti desiderati»: per ogni (giorno, pasto) da riempire assegna una composizione con `distributeCompositions`, poi produce gli slot.
- Kept, preassegnazioni di *Ripeti*, `fills` e scrittura lavorano sulle chiavi con portata. I pasti tenuti si riconoscono per (giorno, pasto): basta un piatto passato o bloccato.
- I lotti di generazione passano la portata (`mealType` + `courses: [course]`).
- `swapSlot` e `listSlotCandidates`/`assignSlotRecipe` usano la portata dello slot (FR-5). `assignSlotRecipe` sul principale aggiorna `course` e, se diventa `piatto-unico`, cancella il contorno nella stessa transazione.
- `setSlotLock` blocca e sblocca tutti gli slot del pasto.
- Operazioni nuove, con le stesse garanzie delle altre (lock dei piani dell'household, rilettura sotto lock, `markShoppingListStale`, uso sui piani confermati):
  - `addSideDish(planId, mainSlotId, request)`: rifiuta un principale `piatto-unico` (errore nuovo `side_not_allowed`), un pasto che ha già il contorno (`side_exists`), un pasto bloccato o passato. Restituisce `PlanMutationResult`, perché può generare.
  - `removeSideDish(planId, sideSlotId)`: accetta solo uno slot contorno (`not_a_side_dish`). Restituisce `PlanResult`.
- Rotte: `POST /api/plans/[id]/slots/[slotId]/side` (con `slotId` del principale; corpo come lo swap, con `exclude_recipe_ids`) e `DELETE /api/plans/[id]/slots/[slotId]` (solo contorno). Le rotte esistenti non cambiano firma.
- Messaggi italiani dei nuovi errori in `lib/plans/errors.ts`, nel tono di `DESIGN.md §5`.

### 4.6 Modulo `recipes`

- `GenerateAndStoreInput` riceve `courses?: Course[]`, con default `MAIN_COURSE_VALUES` (comportamento di oggi per `/api/recipes/generate`).
- La proposta su richiesta (Feature 9) riceve la portata richiesta dal selettore: principale (`MAIN_COURSE_VALUES`) o `['contorno']`.
- Prompt (`lib/llm/prompts.ts`): `piatto-unico` esce dalle etichette ammesse e dalla riga che dice che la calcola l'app.

### 4.7 UI (`components/`)

- `plan-screen.tsx`: raggruppa gli slot per giorno e poi per pasto, con una `PlanSlotCard` per pasto che riceve principale e contorno opzionale.
- `plan-slot-card.tsx`: riga contorno, «+ Contorno», stato «azione in corso» condiviso nella card (FR-4, FR-5). `MealCard` resta il componente del principale; la riga contorno è un componente nuovo e piccolo.
- `slot-recipe-picker.tsx`: titolo «Scegli il contorno per ‹giorno› · ‹pasto›» per il contorno, ed elenco filtrato dal server.
- Impostazioni e onboarding (`settings-fields.tsx`): `MealsField` riceve e modifica pasti e composizioni insieme (FR-2), con un gruppo di chip a scelta multipla per ogni pasto selezionato. `isSettingsFieldValid("meals", …)` controlla anche le composizioni, così `onboarding-wizard.tsx` e `settings-editor.tsx` ereditano la validazione senza logica propria. L'ordine dei passi del wizard non cambia.
- Microcopy: «+ Contorno», «Contorno», «Cambia contorno», «Scegli contorno», «Togli contorno» (aria-label con il titolo, come *Cambia*), descrizione nuova di «Pasti da pianificare», «Scegli almeno una composizione.», nel tono di `DESIGN.md §5`.

### 4.8 Documentazione

- `docs/ARCHITECTURE.md`: modello dati (`plan_slots.course`, `households.meal_compositions`), logica del planner (composizioni, carenze per portata), API nuove.
- `docs/DESIGN.md §3` e la mappa delle schermate: card con riga contorno e «+ Contorno», campo «Pasti da pianificare» con le composizioni (Impostazioni e onboarding).
- `docs/DEPLOY.md`: nota sulla migrazione (ritorno indietro solo con il dump).
- Wiki di feature in `docs/wiki/`.

## 5. Requisiti non funzionali

- **Determinismo**: a parità di input e `rng`, la generazione del piano (composizioni comprese) produce lo stesso risultato. I test lo verificano come oggi.
- **Prestazioni**: `selectRecipes` resta lineare nel numero di candidate per coppia. Con 200 ricette e 28 piatti la generazione resta sotto i tempi di oggi. Nessuna chiamata LLM in più se la libreria basta (60 contorni per pasto nel pacchetto).
- **Concorrenza**: tutte le operazioni nuove passano dal lock dei piani dell'household e rileggono lo stato sotto lock, come swap e scelta. L'indice unico (4.4) è l'ultima difesa contro un doppio «+ Contorno».
- **Compatibilità**: migrazione in avanti senza perdita. I piani esistenti si leggono e si modificano come piani a un piatto per pasto.
- **Accessibilità** (`DESIGN.md §6`): tap target ≥ 44 px anche nella riga contorno, aria-label con il titolo del piatto, focus che torna sull'azione dopo l'aggiornamento, nessun overflow a 360 px, `prefers-reduced-motion` rispettato dal flip esistente.
- **Architettura**: planner e regole delle composizioni sono funzioni pure senza LLM. Solo `recipes` parla con `lib/llm/`. I tipi nascono in `types.ts`.

## 6. Fuori ambito

- Pasto completo primo + secondo (+ contorno).
- Abbinamenti ragionati tra contorno e principale (il contorno si sorteggia come gli altri piatti).
- Ripiego automatico su un'altra composizione ammessa quando una non si riempie: interviene la generazione per portata.
- Composizioni diverse per giorno della settimana, o ricorrenti («il venerdì pesce»).
- Selettore esplicito di composizione sulla card (D6).
- Blocco del singolo piatto (D7).
- Porzioni del contorno diverse da quelle del pasto (D9).
- Ricomposizione automatica dei piani esistenti alla migrazione (D8).

## 7. Verifica e criteri di accettazione

**Gate.** `lint + typecheck + test + build` verdi in locale e in CI, compreso il job `image`.

**Automatici.**

1. `distributeCompositions`: conteggi bilanciati (`⌊n/k⌋` o `⌈n/k⌉`) per diverse coppie `n`, `k`; stesso risultato con lo stesso seed; con una sola composizione, tutte uguali.
2. `fitsCourse` e `mainCourseForChoice`: tutti i casi di FR-3.4 e FR-5.4, compresi i non classificati.
3. `selectRecipes`: nessuna ricetta ripetuta tra principali e contorni; un contorno non va mai in uno slot principale e viceversa; carenze per (pasto, portata) con i conteggi attesi; ordine delle coppie per scarsità.
4. Servizio (DB): *Genera piano* con le composizioni di default produce pasti validi (FR-1.3) e conteggi bilanciati; *Rigenera* tiene i pasti bloccati e passati interi; con un solo tipo di composizione ammessa il piano la rispetta.
5. Generazione: una carenza di contorni chiama `generate` con `courses: ['contorno']` (LLM finto).
6. «+ Contorno» e *Togli contorno*: casi validi ed errori (`side_not_allowed`, `side_exists`, `not_a_side_dish`, `slot_locked`, giorno passato); lista segnata da rifare; uso contato sul piano confermato.
7. *Scegli* sul principale: un piatto unico al posto di un secondo + contorno toglie il contorno; un primo al posto di un secondo + contorno tiene il contorno; candidate con tutte le portate principali; candidate del contorno solo contorni.
8. Blocco: lucchetto su un piatto blocca tutto il pasto; azioni rifiutate sul pasto bloccato.
9. *Ripeti*: copia la composizione dei pasti di origine; un piatto non più idoneo si riempie nella stessa portata.
10. Migrazione: slot esistenti con la portata attesa; indice che rifiuta un secondo principale o un secondo contorno nello stesso pasto; `piatto-unico` tolta da household e ricette.
11. Lista della spesa con un contorno: i suoi ingredienti ci sono, scalati sulle porzioni.
12. Impostazioni e onboarding: validazione (almeno una composizione per pasto selezionato), salvataggio, `superseded`. In jsdom, `MealsField` mostra e nasconde il gruppo quando si attiva o si disattiva un pasto; il passo «Pasti da pianificare» del wizard blocca *Avanti* se un pasto non ha composizioni; il wizard completato salva le composizioni scelte.
13. Card: riga contorno, «+ Contorno» presente o assente secondo FR-4.3–4.4, aria-label (jsdom).

**Manuali, di chiusura.**

1. Stack di produzione locale (`scripts/smoke-prod.sh`) su un DB con piani esistenti: la migrazione passa, i piani si leggono, *Rigenera* produce pasti composti.
2. Prova da telefono a 360 px: card con contorno e senza, «+ Contorno», *Togli*, *Scegli* che cambia composizione, campo «Pasti da pianificare» senza overflow, nelle Impostazioni e in un onboarding da capo (DB nuovo).
3. Raspberry dopo il deploy: il piano della settimana si rigenera con i contorni e la lista della spesa li comprende.
