# Architecture review — Feature 4 (E3 Pianificatore)

**Data:** 2026-09-29 · **Piano esaminato:** [`plan.md`](plan.md) (+ [`requirements.md`](requirements.md)) · **Contesto:** as-built di F1–F3 (commit fino a `b0a4aad`), `docs/ARCHITECTURE.md`, `docs/planning/execution-strategy.md` (§3 Feature 4–6, §4), review di F2 e F3.

Il piano è molto preciso: contratti scritti per esteso, file per WP disgiunti, test elencati caso per caso. Questa review non ne ridiscute la forma. Cerca i punti in cui il codice reale, o il modo in cui il piano lo usa, non regge ciò che F4 ci costruisce sopra.

## Metodo e prove raccolte
- Gate completo sul codice attuale (Postgres di sviluppo attivo sulla 5432, `pnpm db:migrate` applicato): `lint` ✅, `typecheck` ✅, `test` ✅ **246/246** (compresi i test DB), `build` ✅. `pnpm drizzle-kit generate` → **"No schema changes"**: schema e snapshot coincidono, quindi la `0003` di WP2 conterrà solo i due `ADD COLUMN`.
- Next installato **15.5.25** (il piano dice 15.5 ✅; il messaggio del commit `bb5f247` dice "Next.js 16", ma è impreciso). `connection` da `next/server` è già in uso in `app/(app)/layout.tsx` ✅.
- **Le ipotesi della §0.2 del piano sono verificate sul codice**: `formatRecipe` è interna a `recipe-repo.ts`; `loadHousehold(id?)` esiste; `generateAndStoreRecipes` apre una propria transazione con advisory lock e chiama l'LLM fuori da transazioni; `RecipeSheet` scala le quantità rispetto a `recipe.servings` (quindi `toRecipeDetail(recipe, slot.servings)` di WP4 è coerente); i blocchi "MealCard"/"RecipeSheet" di `tests/ui/shell.test.tsx` passano sempre `onToggleFavorite` quando cercano la ★ (WP4 li lascia verdi).
- **Conteggi delle fixture** verificati con uno script: 18 ricette; con `DEFAULT_HOUSEHOLD` le candidate sono **9 per il pranzo, 10 per la cena, 16 distinte** (esattamente come dice il piano, §0.2 e test 8 di WP1).
- **Latenza reale della generazione** (fonte: `.env.example` e commit `b0a4aad`): circa **38 s per 3 ricette** con il modello consigliato (`z-ai/glm-5.3-flash`), circa **90 s per 3 ricette** con i modelli gratuiti di OpenRouter. `LLM_TIMEOUT_MS` vale **50 000** per chiamata (`lib/llm/model.ts:88-96`). L'adapter fa al massimo una seconda chiamata di riparazione (`lib/llm/adapter.ts:151-181`). Tutte le registrazioni reali usano `count: 3`.

---

## 1. Problemi attuali (ordinati per impatto)

### P1 — La generazione accetta fino a 10 ricette per chiamata, ma il timeout è tarato su 3 · **bloccante per F4**
**File:** `lib/domain/types.ts:323` (`GENERATE_COUNT_MAX = 10`), `lib/llm/model.ts:88-96` (timeout di 50 s), `lib/llm/adapter.ts:138-150`, `lib/recipes/generate.ts:59-72`
- Una chiamata a `generateAndStoreRecipes` equivale a **una** richiesta LLM con `n` ricette. Il tempo di risposta cresce con `n`, perché cresce l'output strutturato. Con i tempi misurati, 10 ricette richiedono circa 125 s sul modello consigliato e circa 300 s su quelli gratuiti. Entrambi i valori superano di molto il timeout di 50 s, e anche il massimo di 110 s suggerito in `.env.example`.
- Oggi non si vede perché l'unico chiamante è la rotta manuale `POST /api/recipes/generate` (default 5), usata solo nello smoke test con 3 ricette. Nessun codice limita il numero di ricette per chiamata in base alla latenza.
- Con F4 questo diventa il percorso principale (v. **R1**).

### P2 — Le preferenze ingredienti non hanno un punto di lettura condiviso · **da tenere d'occhio**
**File:** `lib/recipes/constraints.ts:25-26` (`ingredient_likes: []`, `ingredient_dislikes: []` con commento "F5"); piano WP3 passo 3 (`loadIngredientPreferences` in `lib/plans/service.ts`)
- Il gancio per F5 esiste già nel modulo `recipes`, scritto in linea dentro `buildConstraints`. Il piano ne aggiunge un secondo in `lib/plans/service.ts` e lo definisce "l'**unico** punto in cui F5 interverrà". Non è così: `execution-strategy.md §3 Feature 5` chiede anche le liste like/dislike nel prompt LLM, cioè proprio `buildConstraints`.
- Le dipendenze vanno in una sola direzione: `plans` importa `recipes`. Il modulo `recipes` quindi non può riusare un loader definito in `lib/plans/service.ts` senza creare un ciclo. F5 finirebbe per scrivere due letture di `ingredient_prefs`, con la stessa normalizzazione, in due moduli diversi.

### P3 — I filtri duri (pasto, dieta, elettrodomestici, dislike) sono implementati in due posti · **da tenere d'occhio, nessuna azione ora**
**File:** `lib/recipes/constraints.ts:36-77` (`findConstraintViolations`); piano WP1 passo 5 (`exclusionReason` in `lib/domain/planner.ts`)
- Le due funzioni applicano le stesse quattro regole: una all'output dell'LLM, l'altra alla libreria. Il rischio che divergano resta basso perché la semantica non banale è già condivisa (`expandDietFlags`, `normalizeCanonicalName`). Il resto è appartenenza a insiemi.
- Unificarle adesso vorrebbe dire toccare F2 e i suoi test per un guadagno piccolo. Basta un commento incrociato nei due file ("stesse regole di …"), così chi modifica una delle due sa che deve controllare l'altra.

### P4 — Pezzi di trasporto duplicati o nel posto sbagliato · **cosmetico, ma F5/F6 li moltiplicano**
**File:** `app/api/settings/route.ts:12-66` e `app/api/recipes/generate/route.ts:10-110` (buste d'errore scritte in linea); `lib/settings/client.ts:28-70` (gestione degli errori di fetch); `lib/db/repositories/recipe-repo.ts:24-25` (`DbExecutor`); `lib/db/repositories/household-repo.ts:84-88` e `lib/domain/types.ts:378-379` (commenti sul contratto U1 con `meal_plans.created_at`)
- Il piano estrae `lib/http/responses.ts` (bene) ma rifattorizza solo la rotta di generazione. La rotta settings resta con le sue copie di `invalid_request` e `internal_error`.
- `lib/plans/client.ts` è costruito **copiando** `lib/settings/client.ts` (WP3 passo 5). F5 (libreria, preferenze) e F6 (lista, spunte ottimistiche) avranno bisogno dello stesso client: sarebbero la terza e la quarta copia.
- `DbExecutor` è definito nel repository delle ricette. `plan-repo` lo importerà da lì, e lo stesso faranno i repository di F5 e F6.
- Due commenti descrivono ancora il contratto U1 con `created_at`. Con P8 dei requirements il riferimento diventa `generated_at`, e WP2 aggiorna solo `ARCHITECTURE.md`.

### Aree senza problemi da segnalare
- **Planner puro e deterministico** (WP1): configurazione unica, RNG iniettato, pool ordinato per `id`, tipo di pasto più scarso servito per primo. È il design giusto, e l'ordinamento è già provato sulle fixture reali (9/10/16). Non è over-engineering: ogni regola ha un test che la motiva.
- **Generazione fuori dalle transazioni** (contratto R2 di F2): il piano la rispetta in `generatePlan` e in `swapSlot`.
- **Repository con `executor` come primo argomento**, advisory lock per household, migrazione additiva `0003` con default: coerenti con F2/F3.
- **Separazione client/server** in `lib/plans/` (nessun barrel, `service.ts` mai importato dal client) e pagina server + componente client come `/impostazioni`: coerenti con F3.
- **Stesso orologio** per `superseded`: `generated_at` e `households.updated_at` vengono entrambi da `now()` del DB, quindi il P2 della review di F3 resta chiuso.

---

## 2. Rischi introdotti o amplificati dalla feature

### R1 — Con impostazioni normali la generazione del piano andrà in timeout · **bloccante** (amplifica P1)
**Piano:** WP1 passo 2 (`generationMax: GENERATE_COUNT_MAX`), passo 5 (`computeGenerationCount`); WP3 passo 3.6 (una chiamata per tipo di pasto)
- `computeGenerationCount` restituisce spesso 9 o 10 (i test 11 di WP1 e 2 di WP3 lo mostrano), e ognuno diventa **una sola** chiamata LLM. Non è un caso raro:
  - **Dalla seconda settimana, con le impostazioni di default.** La conferma porta `last_used_at = now()` sulle 14 ricette del piano. Il piano successivo si genera 5–7 giorni dopo, quindi quelle ricette hanno peso 0 (meno di 10 giorni). Delle 16 candidate ne restano 2 a peso positivo, e scattano due chiamate da 10 ricette ciascuna.
  - **Al primo piano, con una dieta restrittiva** scelta nell'onboarding (es. vegano): le fixture compatibili sono poche, quindi `count` arriva a 9–10 subito.
- Esito con i tempi misurati: `LlmError('timeout')` su entrambe le chiamate. Alla seconda settimana il piano si crea lo stesso con il ripiego P5, cioè le ricette della settimana prima, con `failed: true`. **La libreria non cresce mai** e il principio guida del prodotto (§1.3) si svuota senza errori visibili. Al primo piano con dieta restrittiva, invece, il piano **non si crea affatto**.
- C'è un effetto secondario. Una `POST /api/plans` sincrona di 1–3 minuti su un telefono può perdere la connessione (schermo spento, tab in background) mentre il server finisce e salva il piano. La UI mostra "Connessione non disponibile." e l'utente, premendo di nuovo, rilancia l'LLM.

### R2 — Le invarianti del piano si controllano fuori dalla transazione che scrive · **da tenere d'occhio (alto)**
**Piano:** WP3 passo 3 (`generatePlan` punti 5–8, `confirmPlan`), WP5 passo 1 (punti 2–6); **codice:** `lib/db/repositories/recipe-repo.ts:318-333` (`listRecipes` usa sempre il `db` globale, non accetta un `executor`)
- **Swap concorrenti su slot diversi.** `PlanSlotCard` ha uno stato per card e niente impedisce di premere *Cambia* su due card di fila. Ogni swap calcola `exclude` e sceglie la ricetta **prima** del lock. Nella transazione rilegge il piano ma controlla solo `archived`, lo slot e `locked`, non se la ricetta scelta è entrata nel frattempo in un altro slot. Due swap possono quindi assegnare la **stessa** ricetta a due slot, violando proprio l'accettazione di S3.3 ("mai la stessa ricetta nella settimana"). Con un pool di circa 8 candidate la collisione ha una probabilità dell'ordine di 1/8 per coppia di swap sovrapposti. La finestra si allarga molto quando uno dei due swap genera.
- **Doppia conferma.** `confirmPlan` legge `status === 'draft'` fuori dalla transazione e poi esegue `setPlanStatus` + `incrementRecipeUsage` senza lock e senza rileggere. Due richieste sovrapposte (doppio tap, retry di rete) contano `times_used` due volte. Il piano la dichiara "idempotente", ma lo è solo in sequenza.
- **Rigenerazione e blocco sovrapposti.** `toFill` si calcola sugli slot `kept` letti fuori dalla transazione, mentre `keptNow` si ricalcola dentro. Se uno slot viene sbloccato nel frattempo, la transazione lo cancella ma nessuna assegnazione lo riempie, e il piano resta con un buco. Se invece viene bloccato, la sua ricetta non era in `exclude` e può comparire due volte. È poco probabile, perché durante la generazione la UI mostra solo lo skeleton, ma la stessa radice produce il caso dello swap.
- Tutte e tre derivano dalla stessa scelta: la **selezione** avviene fuori dalla transazione insieme alla generazione. La generazione deve stare fuori (R2 di F2), la selezione no. È pura, costa millisecondi e può girare dentro il lock sullo stato riletto. Oggi lo impedisce solo `listRecipes`, che non accetta un `executor`.

### R3 — Il sabato, generare la settimana dopo archivia il weekend in corso · **da tenere d'occhio**
**Piano:** requirements P10, WP3 passo 3.8 (`archivePlansBefore(tx, household.id, target.week_start)`), glossario 0.4 ("Piano mostrato")
- Nel weekend `target.week_start` è il lunedì successivo, quindi `archivePlansBefore(…, target.week_start)` archivia il piano della settimana **in corso**. Sabato cena e domenica, però, devono ancora arrivare. Da quel momento non si possono più cambiare né bloccare (P10 rifiuta swap e blocco sui piani `archived`). La pagina Piano, che mostra il piano della settimana obiettivo, non li fa più vedere.
- Il sabato sera, quindi, l'app non risponde più a "cosa mangio oggi?". L'archiviazione è una scelta di planning (P10), non dell'utente, e si corregge a costo zero. La **visualizzazione** discende invece da U1, una decisione dell'utente: v. la domanda nella proposta di R3.

### R4 — La promessa "F5 cabla un solo punto" non regge (amplifica P2) · **da tenere d'occhio**
**Piano:** WP3 passo 3 (`loadIngredientPreferences` in `lib/plans/service.ts`), WP1 "Per F5", "Contratti consegnati" (F5)
- La definizione di "unico punto" finisce nei contratti consegnati a F5 e da lì nel brief di `/feature-dev 5`. F5 partirebbe con un'informazione sbagliata. Il posto scelto per il loader, poi, non è raggiungibile dal secondo consumatore (P2).

### R5 — Lacuna tra WP4 e WP6 sulla `MealCard` non modificabile, e long-press sui pulsanti interni · **cosmetico (ma farebbe fallire un test di WP6)**
**Piano:** WP4 passo 4; WP6 passo 2 (`onSwap` solo se `editable`) e test 5 di `plan-slot-card.test.tsx` ("`editable: false` → nessun `Cambia …`"); **codice:** `components/cards/meal-card.tsx:113-131`
- La `MealCard` attuale mostra **sempre** il pulsante *Cambia*, anche senza `onSwap` (`onSwap?.(id)`). WP4 rende condizionale solo la ★. Senza una modifica, un piano archiviato mostra un *Cambia* che non fa nulla, e il test 5 di WP6 fallisce. Il piano lascia all'implementer di WP6 un file (`meal-card.tsx`) che appartiene a WP4.
- Il long-press si aggancia al `Card` radice, quindi scatta anche tenendo premuto il lucchetto o *Cambia*. `suppressNextClick` blocca solo `onSelect`, non il click del pulsante. Tenendo premuto il lucchetto, il long-press blocca e il click subito dopo sblocca: il risultato finale è nessun cambiamento, con due richieste PATCH.

### R6 — `toRecipeDetail` e `recipeChips` nascono nel modulo sbagliato · **cosmetico**
**Piano:** WP4 passo 1 (`lib/plans/format.ts`, che importa il tipo `RecipeDetail` da `@/components/sheets/recipe-sheet`)
- Le due funzioni non riguardano i piani: convertono una `Recipe` nella vista della sheet. F5 (S2.1 "RecipeSheet completo, quantità scalate") ne avrà bisogno per la Libreria e dovrebbe importarle da `lib/plans/`. In più `lib/` dipenderebbe da `components/`, cioè i livelli sarebbero invertiti.

### Over-engineering o scorciatoie
Non ho trovato complessità sproporzionata. Il toast locale (P19), il flag `needs_regeneration` (P13) e `PlanGenerationSummary` hanno ognuno un consumatore esplicito. L'unica scorciatoia che crea debito è la copia del client fetch (P4).

---

## 3. Proposte e punto di innesto

| ID | Proposta concreta | Dimensione | Dove si innesta | Quando |
|---|---|---|---|---|
| **R1** (+P1) | **Generare a lotti.** Aggiungere a `PlannerConfig` `generationBatchSize: 3` (la dimensione usata in tutte le misure reali). Nel ciclo di `generatePlan`, dividere il `count` di ogni `MealTypeShortage` in lotti di ≤ 3 (es. 10 → 3+3+3+1) e lanciare **tutti** i lotti di tutti i tipi in un solo `Promise.allSettled`. `created` somma gli esiti; la semantica degli errori per singola chiamata non cambia (un `LlmError` imposta `llmError`, altri errori si rilanciano). Così il tempo di un giro resta quello di **una** chiamata da 3 (circa 40 s col modello consigliato). Aggiornare i test 2 e 3 di WP3 (es. test 2: 6 chiamate da 3 invece di 2 da 9) e aggiungere un test "10 ⇒ 4 lotti, somma = 10". Contropartita: fino a 8 chiamate in parallelo. Se il piano gratuito di un provider ha limiti per minuto stretti, aggiungere `generationMaxParallel` e un `Promise.allSettled` a finestre. **Recupero dalla rete persa:** in `PlanScreen`, se `requestGeneratePlan` fallisce con `network_error`, chiamare `fetchPlanScreen()` e, se il piano obiettivo ora esiste, adottarlo con il toast `Piano generato`. Commento in `.env.example`: il timeout vale per un lotto da 3. | Piccola | Config in **WP1** passo 2; ciclo in **WP3** passo 3.6 e test 2–3; recupero in **WP6** passo 3 ("Genera/Rigenera") | **Prima** (è il percorso principale del prodotto) |
| **R2** | **"LLM fuori, selezione dentro".** (a) **WP2**: aggiungere `listRecipesWith(executor, filter)` in `recipe-repo.ts`, con `listRecipes` che la usa (nessun cambiamento di comportamento). (b) **WP3 `generatePlan`**: la fase fuori dalla transazione (selezione, `needMore`, generazione) resta com'è, ma serve solo a **decidere se generare**. Dentro la transazione, dopo il lock: rileggere `current`, ricalcolare `kept`/`toFill`/`exclude` da `current`, rileggere la libreria con `listRecipesWith(tx, …)`, rieseguire `selectRecipes` con lo stesso `rng` e, se resta uno slot `null`, lanciare `llmError ?? PlanError('insufficient_recipes')` (rollback). Il controllo del punto 7 fuori dalla transazione può restare come uscita rapida. (c) **WP5 `swapSlot`**: stessa cosa, con la selezione ripetuta dentro la transazione su `exclude` = ricette del piano **riletto** ∪ `request.exclude_recipe_ids`. (d) **WP2/WP3 conferma**: sostituire `setPlanStatus(tx, id, 'active')` con `activateDraftPlan(tx, id): Promise<boolean>` (`update … set status='active' where id=$1 and status='draft' returning id`) e chiamare `incrementRecipeUsage` solo se restituisce `true`. **Test nuovi:** `Promise.all` di due swap su slot diversi con una sola candidata libera ⇒ le ricette del piano restano distinte; `Promise.all([confirmPlan(id), confirmPlan(id)])` ⇒ `times_used` +1. | Piccola–media | **WP2** passo 3–4 (`listRecipesWith`, `activateDraftPlan` al posto di `setPlanStatus` per la conferma); **WP3** passo 3.8 e `confirmPlan`; **WP5** passo 1.6 | **Prima** (cambia i contratti di WP2 e WP3; dopo, vorrebbe dire riscrivere il servizio) |
| **R3** | **Archiviare solo le settimane concluse**: `archivePlansBefore(tx, household.id, currentWeekStart)` con `currentWeekStart = mondayOf(today)` al posto di `target.week_start`. Nel weekend il piano in corso resta `draft`/`active` e si può ancora modificare. Adeguare il test 8 di WP3: il piano del 28/09 **non** si archivia con `SAT`; se ne aggiunge uno del 21/09 che invece si archivia. **Domanda per l'utente (U1):** dopo aver generato la settimana dopo, il sabato e la domenica la pagina Piano deve continuare a mostrare i pasti rimasti del weekend? Opzione economica: "piano mostrato" = piano della settimana corrente finché ha slot da oggi in poi, con un link o una sezione "Prossima settimana". Se la risposta è sì, cambiano solo `getPlanScreen` (WP3) e l'intestazione di `PlanScreen` (WP6). | Piccola (archiviazione); piccola–media (visualizzazione) | **WP3** passo 3.8 e test 8 (archiviazione); **WP3** `getPlanScreen` + **WP6** passo 3 (visualizzazione, se l'utente la vuole) | **Prima** (l'archiviazione non si annulla senza una migrazione dei dati) |
| **R4** (+P2) | Spostare il loader in un modulo neutro che sia `plans` sia `recipes` possano importare: `lib/prefs/ingredient-prefs.ts` con `loadIngredientPreferences(householdId, executor = db)`, che in F4 restituisce `EMPTY_INGREDIENT_PREFERENCES` con il commento F5. `lib/plans/service.ts` lo importa. **Non** toccare `buildConstraints` in F4, ma correggere il testo dei contratti: "F5 cabla `loadIngredientPreferences` (`lib/prefs/`) e lo usa anche in `buildConstraints` (`lib/recipes/constraints.ts:25-26`)". Il modulo `prefs` è già previsto da `ARCHITECTURE §3` e da `CLAUDE.md` ("planner, shopping-list, prefs"). | Piccola | **WP3** passo 3 (posizione e firma), "Contratti esposti" di WP1/WP3 e "Contratti consegnati" (F5) | **Prima** (è solo la posizione di un file) |
| **R5** | In **WP4** passo 4, oltre alla ★: il pulsante *Cambia* si mostra **solo se `onSwap` è definito**, e se non ci sono né `onSwap` né `onToggleFavorite` né `actions` il footer non si renderizza. Long-press: ignorare i `pointerdown` il cui `e.target.closest('button')` è interno alla card, così il long-press parte solo dal corpo della card. Aggiungere a `tests/ui/meal-card-plan.test.tsx`: "senza `onSwap` nessun `Cambia …`" e "`pointerDown` sul lucchetto + 500 ms ⇒ nessun `onLongPress`". | Piccola | **WP4** passo 4 e passo 7 | **Prima** (evita che WP6 debba toccare un file di WP4) |
| **R6** | Mettere `recipeChips` e `toRecipeDetail` in `components/sheets/recipe-detail.ts`, accanto al tipo `RecipeDetail` che producono. `lib/plans/format.ts` tiene solo le date (`formatDayLabel`, `formatWeekRange`, `IT_WEEKDAYS`, `IT_MONTHS_SHORT`). F5 le riusa per la Libreria senza importare da `plans`, e `lib/` non dipende più da `components/`. | Piccola | **WP4** passo 1 (e import in **WP6**) | Prima (costo nullo adesso) |
| **P4** | (a) In **WP3** passo 2 rifattorizzare anche `app/api/settings/route.ts` su `invalidRequestResponse` / `internalErrorResponse` (`tests/api/settings.test.ts` deve restare verde senza modifiche). (b) In **WP3** passo 5 scrivere il `requestJson` come helper generico `lib/http/client.ts` (`ApiRequestError(status, code, message)`, `requestJson(url, init, schema)`), su cui costruire `lib/plans/client.ts`. `PlanRequestError` può restare come sottoclasse per non cambiare i test. `lib/settings/client.ts` resta com'è, e F5/F6 usano l'helper. (c) In **WP2** spostare `DbExecutor` in `lib/db/index.ts`, riesportandolo da `recipe-repo.ts` per compatibilità. (d) In **WP2** passo 7 aggiornare anche i commenti U1 in `household-repo.ts:84-88` e `types.ts:378-379` (`created_at` → `generated_at`). | Piccola | **WP2** passi 3 e 7; **WP3** passi 2 e 5 | Prima (tutto additivo) |
| **P3** | Solo un commento incrociato "stesse regole di …" in `exclusionReason` (WP1) e in `findConstraintViolations` (F2). Nessun refactoring. | Minima | **WP1** passo 5 | Durante |

---

## 4. Se potessi migliorare solo 3 cose prima di procedere

1. **R1 — Generazione a lotti da 3.** È l'unico punto che rompe il prodotto con impostazioni normali: dalla seconda settimana, o al primo piano con una dieta, la generazione va in timeout. La libreria smette di crescere senza errori visibili, oppure il piano non si crea. Costa un campo di config e un ciclo in più, e i dati per tararlo ci sono già (38 s per 3 ricette).
2. **R2 — Selezione dentro la transazione, conferma con transizione condizionata.** Chiude in un colpo tre race (swap duplicati, doppio `times_used`, buchi nella rigenerazione), di cui una viola un'accettazione di S3.3 con un'interazione naturale da telefono. Farlo dopo vorrebbe dire riscrivere `generatePlan`, `swapSlot` e i loro test; adesso richiede una funzione di repository in più e lo spostamento di una chiamata.
3. **R3 — Archiviare solo le settimane concluse.** Ogni sabato, dopo aver pianificato la settimana dopo, l'app smetterebbe di rispondere alla domanda che le dà il nome. La correzione è un argomento diverso passato a una funzione. La visualizzazione del weekend è decisa nell'Addendum (D2).

R4, R5, R6 e P4 costano pochi minuti ciascuno e conviene applicarli nei rispettivi WP. Se il tempo stringe si possono rimandare senza danni strutturali, tranne la correzione del testo dei contratti per F5 (R4), che è gratuita.

---

## Addendum (2026-09-29) — decisioni dell'utente

Queste decisioni **sostituiscono** le parti corrispondenti delle righe R1 e R3 della §3 (compresa la "domanda per l'utente" di R3, ora chiusa). `/feature-dev 4` deve applicarle nei WP indicati.

### D1 — R1: lotti da 3 **e** timeout più alto
Oltre ai lotti da `generationBatchSize: 3` (§3, R1):
- **`lib/llm/model.ts`**: il default di `getLlmTimeoutMs` passa da `50000` a **`90000`**. Copre i ~38 s misurati per 3 ricette sul modello consigliato e lascia margine per i modelli gratuiti di OpenRouter (~90 s). Aggiornare il JSDoc e le attese di `tests/llm/model.test.ts:165-170` (`50000` → `90000`).
- **`.env.example`**: `LLM_TIMEOUT_MS=90000`. Il commento va riscritto: il timeout vale **per un lotto da 3 ricette**; con la chiamata di riparazione una generazione può durare fino a 2 × timeout; si alza fino a `120000` solo con modelli lenti. Il vecchio vincolo "deve restare sotto il limite di 120 s della route" non vale più (v. sotto).
- **`app/api/recipes/generate/route.ts`**: `maxDuration` passa da `120` a **`300`**, coerente con `POST /api/plans` (una chiamata con riparazione arriva a 180 s). `tests/api/recipes-generate.test.ts:19` controlla `maxDuration` (`toBe(120)` → `toBe(300)`): è l'**unica** eccezione alla regola "test invariato" di WP3 passo 2. La rotta dello swap (WP5) passa da `120` a **`200`** (un lotto con riparazione), con l'attesa corrispondente in `tests/api/plans-swap.test.ts`. Sul Raspberry (F7) Next standalone non applica `maxDuration`, ma il valore resta la documentazione del caso peggiore.
- Caso peggiore di `POST /api/plans`, da documentare in `ARCHITECTURE.md §6` (WP3 passo 7): `maxGenerationRoundsPlan × 2 × LLM_TIMEOUT_MS`, circa 6 minuti con i default. È tollerabile solo perché il recupero su `network_error` in `PlanScreen` (R1) adotta il piano che il server ha comunque salvato.
- **Dove:** WP3 (aggiungere alla lista file `lib/llm/model.ts`, `tests/llm/model.test.ts`, `.env.example`, `tests/api/recipes-generate.test.ts`); WP5 per il `maxDuration` dello swap. Chi ha già un `.env` locale con `LLM_TIMEOUT_MS=50000` deve aggiornarlo a mano.

### D2 — R3: **navigatore di settimane** nel Piano, con storico in sola lettura
Sostituisce sia la proposta di visualizzazione della §3 (R3) sia il "selettore a due segmenti" discusso prima. La regola U1 (nei feriali si genera la settimana corrente, nel weekend la successiva) **non cambia**. Cambia cosa si può **vedere**: la settimana in corso resta sempre raggiungibile e le settimane passate diventano consultabili. Nessuna tab e nessuna rotta nuova.

**Comportamento**
- Intestazione del Piano: `‹  {range}  [Bozza|Confermato]  ›`. `‹` e `›` sono `Link` veri (`<a>`, tap target ≥ 44 px, `aria-label` `Settimana precedente` / `Settimana successiva`, focus visibile) verso `/?settimana=YYYY-MM-DD`. Se non c'è una settimana in quella direzione, il pulsante resta disabilitato (`aria-disabled`, non focalizzabile). URL condivisibili, che sopravvivono al refresh e funzionano senza JavaScript.
- **Settimane raggiungibili** = settimane con un piano ∪ settimana corrente (`mondayOf(today)`) ∪ settimana obiettivo (`resolveTargetWeek(today).week_start`, cioè la successiva nel weekend). Non si va oltre la settimana obiettivo. Le settimane passate senza piano si saltano.
- **Settimana iniziale** (senza `?settimana`): la corrente se ha un piano, altrimenti quella obiettivo. Nei feriali sono la stessa settimana.
- `?settimana` non valido (non una data, o oltre la settimana obiettivo) → si ignora. Una data che non è un lunedì → `mondayOf`.
- **Cosa si può fare in ogni settimana:**
  - **obiettivo**: Genera/Rigenera (`action`), swap, blocco, conferma;
  - **corrente, nel weekend**: swap, blocco, conferma; niente Genera/Rigenera;
  - **passate**: sola lettura (card e sheet, niente *Cambia*, lucchetto e long-press) più *Ripeti* (D4).
- Settimana corrente senza piano nel weekend: `EmptyState` `Nessun piano per questa settimana` con `actionLabel="Pianifica la prossima settimana"`, che porta alla settimana obiettivo.
- Il testo `Prossima settimana: {range}` sotto il pulsante (WP6 passo 3.2) si **elimina**: il navigatore lo rende superfluo.

**Piano "chiuso"** (regola nuova, sostituisce l'uso diretto di `status === 'archived'`)
- `isPlanClosed(plan, currentWeekStart) = plan.status === 'archived' || plan.week_start < currentWeekStart`. `archivePlansBefore` scatta solo quando si crea un piano nuovo, quindi un piano vecchio può restare `active` anche a settimana finita. La chiusura va perciò **calcolata**, non letta dallo stato.
- `swapSlot`, `setSlotLock` e `confirmPlan` rifiutano i piani chiusi con `PlanError('plan_archived')`. Nuovo messaggio in `PLAN_ERROR_HTTP`: `Questa settimana è conclusa: il piano si può solo consultare.`
- `archivePlansBefore(tx, household.id, mondayOf(today))`: si archiviano solo le settimane concluse (§3, R3); resta una scrittura di pulizia.

**Contratti (WP1 passo 1, al posto di `PlanScreenViewSchema`)**
```ts
export const PlanWeekViewSchema = z.object({
  week: PlanWeekSchema,             // per la settimana obiettivo first_day = primo giorno pianificabile; per le altre = week_start
  plan: PlanViewSchema.nullable(),
  action: PlanActionSchema,         // solo la settimana obiettivo può avere generate/regenerate; le altre 'none'
  editable: boolean,                // plan presente e non chiuso
  can_repeat: boolean,              // D4: plan con almeno una ricetta, settimana ≠ obiettivo, obiettivo non confermato
});
export type PlanWeekView = z.infer<typeof PlanWeekViewSchema>;

export const PlanScreenViewSchema = z.object({
  today: IsoDateSchema,
  current_week_start: IsoDateSchema,
  target: PlanWeekSchema,                   // settimana di Genera/Rigenera/Ripeti
  view: PlanWeekViewSchema,                 // settimana mostrata
  prev_week_start: IsoDateSchema.nullable(),
  next_week_start: IsoDateSchema.nullable(),
});
export type PlanScreenView = z.infer<typeof PlanScreenViewSchema>;
```

**Repository (WP2)**
- `listPlanWeeks(executor, householdId): Promise<string[]>`: i `week_start` dei piani dell'household, in ordine crescente. Test: tre piani inseriti in ordine sparso → restituiti ordinati.

**Servizio e rotte (WP3)**
- `getPlanScreen(options?: PlanServiceOptions & { week?: string })`:
  1. calcola `today`, `current_week_start` e `target`;
  2. normalizza `week` (regole sopra) e legge il piano della settimana mostrata e, se diverso, quello della settimana obiettivo (serve per `can_repeat`);
  3. calcola `prev`/`next` da `listPlanWeeks` ∪ {corrente, obiettivo}.
- `GET /api/plans/current?settimana=YYYY-MM-DD` (parametro opzionale) → `PlanScreenView`.
- `generatePlan` restituisce `screen` calcolato sulla **settimana obiettivo** (`getPlanScreen({ week: target.week_start })`).

**Pagina e UI (WP6)**
- `app/(app)/page.tsx` riceve `searchParams: Promise<{ settimana?: string }>` (Next 15) e chiama `getPlanScreen({ week: settimana })`. Renderizza `<PlanScreen key={screen.view.week.week_start} initialScreen={screen} />`: la `key` azzera lo stato locale quando si cambia settimana.
- Navigazione: i `Link` ‹ › rieseguono la pagina server. Durante la transizione il contenuto resta visibile con `opacity-60` (via `useTransition` + `router.push`, oppure `useLinkStatus` se disponibile in 15.5). Nessuno skeleton per un cambio di settimana.
- Dopo *Genera*/*Rigenera*/*Ripeti* (D4): `router.replace('/?settimana=' + target.week_start)` se la settimana mostrata era un'altra, altrimenti si aggiorna lo stato con il `screen` ricevuto.
- `editable` della `PlanSlotCard` = `view.editable`. Badge e avviso "superato" solo se c'è un piano (l'avviso solo se `editable`).
- Footer del piano `active` e non chiuso: `Link` a **`/lista?piano={plan.id}`**.
- `DESIGN.md §4.1`: "Header: navigatore ‹ settimana › (storico in sola lettura) + CTA *Genera piano* / *Rigenera* sulla settimana da pianificare". La tab bar resta a 4 voci.

**Test da adeguare o aggiungere**
- WP1 `plan-contracts.test.ts`: `PlanScreenView` di esempio con `prev/next` null e valorizzati.
- WP3 `service.test.ts`:
  - test 8: con `SAT` il piano del 28/09 **resta** non archiviato, mentre un piano del 21/09 diventa `archived`;
  - test 14 riscritto: `WED` senza piani → `view.week.week_start '2026-09-28'`, `action 'generate'`, `prev/next` null; `SAT` senza piani → vista iniziale = obiettivo `2026-10-05`; `SAT` con piano del 28/09 → vista iniziale 28/09, `action 'none'`, `editable true`, `next_week_start '2026-10-05'`; con piani del 14/09 e 28/09, `week: '2026-09-28'` → `prev_week_start '2026-09-14'` (il 21/09 senza piano si salta); `week: '2026-10-12'` con `SAT` → normalizzato sull'obiettivo;
  - **nuovo:** con `SAT`, dopo aver generato il 05/10, `swapSlot` e `setSlotLock` sul piano del 28/09 riescono; con `MON` della settimana dopo, lo stesso piano (ancora `active` nel DB) è chiuso → `plan_archived`.
- WP6 `plan-screen.test.tsx` (test 5 riscritto): link ‹ › con gli `href` attesi e disabilitati quando `prev/next` sono null; settimana passata → nessun *Cambia*, nessun lucchetto, nessun *Conferma piano*, sheet apribile; settimana corrente nel weekend senza piano → `Pianifica la prossima settimana` con link all'obiettivo. `tests/home.test.tsx`: la pagina passa `settimana` a `getPlanScreen` e usa la `key` della settimana.

**Contratto per F6:** nel weekend possono esistere due piani non chiusi (settimana in corso e successiva). La lista della spesa si lega sempre a un `plan_id` esplicito (`/lista?piano=<id>`), mai a un "piano attivo" dedotto.

**Dimensione e innesto:** media. **WP1** passo 1; **WP2** (`listPlanWeeks`); **WP3** `getPlanScreen`, guardie di chiusura, passo 3.8, rotta `current`, test 8/14; **WP6** passi 1–3 e test. Va fatto **prima**, perché cambia un contratto di WP1.

### D3 — Pausa tra un uso e l'altro: più morbida, preferite senza pausa, misurata dal giorno del pasto
Modifica la formula di `ARCHITECTURE §5.2` e le regole di WP1 passo 5. `ARCHITECTURE.md §5.2` si aggiorna in **WP3** (con §6), non in WP1: WP2 tocca lo stesso file nella stessa wave.

**Configurazione (WP1 passo 2)**, al posto dei soli `recencyMinDays`/`recencyFullDays`:
```ts
recencyMinDays: 10,        // sotto: peso ridotto a recencyFloor (non più 0)
recencyFullDays: 28,       // da qui: peso pieno
recencyFloor: 0.15,        // peso di una ricetta usata da meno di recencyMinDays
favoriteRecencyFloor: 1,   // le preferite non hanno pausa (1 = decadimento annullato); abbassarlo se si ripetono troppo
```

**`recipeWeight`, nuovo fattore `recencyDecay`** (`days` come prima, negativo → 0):
- `last_used_at` null → `1`;
- non preferita: `days < recencyMinDays` → `recencyFloor`; `days >= recencyFullDays` → `1`; in mezzo `recencyFloor + (1 − recencyFloor) × (days − recencyMinDays) / (recencyFullDays − recencyMinDays)`;
- preferita (`prefs.favorite`): `max(favoriteRecencyFloor, decadimento come sopra)`, quindi `1` con i default. `favoriteBoost` ×1.5 si applica comunque.

**`needMore` sulle ricette "fresche"** (sostituisce P4/P5 dei requirements):
- `isFresh(recipe, now, cfg)` = mai usata, oppure `days >= recencyMinDays`, oppure preferita. `available_m` = candidate idonee e **fresche**; `required_m` e `computeGenerationCount` restano invariati. In questo modo la generazione continua a scattare quando la libreria "nuova" è scarsa, anche se le ricette recenti restano sorteggiabili.
- Il ramo di **ripiego** del passo 3 di `selectRecipes` si **elimina**: con `recencyFloor > 0` ogni candidata idonea ha peso > 0, quindi si usa sempre `weightedPick`. Da `PlannerAssignment` si toglie `fallback`. `weightedPick` mantiene l'errore per pesi tutti a 0, che resta possibile con una configurazione di test.
- Doc di `MealTypeShortage.available`: "candidate idonee e fresche (mai usate, usate da almeno `recencyMinDays` giorni, o preferite)".

**Ultimo uso = giorno del pasto (WP2 + WP3 + WP5)**
- `incrementRecipeUsage(executor, usages: { recipeId: string; day: string }[])`: raggruppa per ricetta e prende il giorno **più recente**; `times_used + 1` per ricetta (una volta per piano, come prima); `last_used_at = greatest(coalesce(recipe_prefs.last_used_at, x), x)` con `x = '${day}T12:00:00Z'::timestamptz` (mezzogiorno UTC: sufficiente per contare i giorni, senza aritmetica di fuso nel DB). Non torna mai indietro nel tempo.
- `confirmPlan`: `usages` = slot con ricetta. `swapSlot` su piano confermato: `[{ recipeId: nuova, day: slot.day }]`.
- Una ricetta pianificata nel futuro ha `days` negativo → 0 → peso `recencyFloor` (o 1 se preferita): corretto per "l'ho appena programmata".

**Test (WP1 `planner.test.ts`)**
- test 2 (peso): 5 giorni prima → `0.15`; 19 giorni prima con `times_used: 1` → `0.575`; 28 giorni prima → `1`; preferita usata 2 giorni prima con `times_used: 1` e rating null → `1.5`.
- test 5 (recency, riscritto): tre candidate per uno slot, due usate 3 giorni prima e una mai usata → su 2000 estrazioni con un unico `createRng(42)` la mai usata esce con frequenza in `[0.75, 0.85]` (attesa `1.2 / (1.2 + 0.15 + 0.15) = 0.8`).
- test 6 (riscritto): uno slot, due candidate usate 2 e 5 giorni prima → lo slot è riempito e `needMore` contiene il tipo con `available: 0`.
- test 8: con 7 candidate di cui 1 usata 3 giorni prima → `available: 6`, `needMore` presente.
- **nuovo:** preferita usata ieri e non preferita mai usata, un solo slot, 10 000 estrazioni → rapporto preferita/altra in `[1.15, 1.35]` (`1.5 / 1.2 = 1.25`).
- WP2 `plan-repo.test.ts` test 5: `incrementRecipeUsage([{a,'2026-10-01'},{a,'2026-10-03'},{b,'2026-10-01'}])` → `a` `times_used` +1 e `last_used_at` = 03/10 12:00Z; una seconda chiamata con un giorno precedente non fa arretrare `last_used_at`.
- WP3 test 12: dopo la conferma, `last_used_at` di ogni ricetta = il giorno del suo slot più recente alle 12:00Z.

**Dimensione e innesto:** piccola. **WP1** passi 2 e 5 + test; **WP2** `incrementRecipeUsage` + test; **WP3** `confirmPlan` + `ARCHITECTURE §5.2`; **WP5** swap su piano confermato. Da fare **prima** (cambia contratti di WP1 e WP2). **Per F5:** la ★ attiva automaticamente `favoriteRecencyFloor`; nessuna modifica all'algoritmo.

### D4 — *Ripeti*: copiare un piano sulla settimana da pianificare
**Comportamento**
- In una settimana con `view.can_repeat`, sotto l'intestazione, un `Button` `outline` **`Ripeti questo piano`** (icona `Copy`), con sotto `text-xs text-stone`:
  - `Nella settimana {formatWeekRange(target.first_day, target.last_day)}`;
  - se la settimana obiettivo ha già una bozza, anche `Sostituirà i pasti non bloccati della bozza.`
- In più, nell'`EmptyState` della settimana obiettivo senza piano, se la settimana corrente ha un piano: un secondo pulsante `outline` **`Ripeti questa settimana`**, che copia il piano corrente. `EmptyState` oggi ha una sola azione: il pulsante va sotto il componente, non dentro.
- Esito: si passa alla settimana obiettivo (`router.replace`), toast **`Piano ripetuto`**. Il piano copiato è una **bozza**: lo si modifica con *Cambia* e lo si conferma come gli altri.

**Regole (servizio)**
- `repeatPlan(sourcePlanId, options?) → GeneratePlanResult`, in **WP5** (`lib/plans/service.ts`):
  1. il piano sorgente deve appartenere all'household (`plan_not_found`) e non essere della settimana obiettivo (nuovo codice `repeat_same_week`, 409, `Questo piano è già quello della settimana da pianificare.`);
  2. la settimana obiettivo si tratta come in `generatePlan`: `active` → `plan_confirmed`, stessi slot `kept` (giorni passati e bloccati);
  3. **pre-assegnazioni**: per ogni slot desiderato `(day, meal)` non mantenuto, la ricetta dello slot sorgente con lo **stesso giorno della settimana** (`isoWeekday`) e lo stesso pasto. Si scarta se è null, se `exclusionReason(r, meal, ctx)` ≠ null (bloccata, dieta o elettrodomestici cambiati, dislike) oppure se è già in uno slot mantenuto o già pre-assegnata;
  4. gli slot senza pre-assegnazione si riempiono con `selectRecipes`, escludendo le ricette pre-assegnate e mantenute. La generazione LLM parte **solo** se resta uno slot `null` (non per il semplice `needMore`), con al massimo `maxGenerationRoundsSwap` giri;
  5. la scrittura è quella di `generatePlan`, dentro la stessa transazione con la selezione rifatta dentro il lock (§3, R2).
- Per non duplicare il codice, **WP3** scrive `generatePlan` sopra una funzione interna `buildTargetPlan(ctx, { preassigned?: ReadonlyMap<string, string>, generation: 'needMore' | 'unfilledOnly' })`. WP5 la riusa per `repeatPlan`. Il planner resta puro: le pre-assegnazioni escono da `toFill` ed entrano in `excludeRecipeIds`.
- Rotta: `POST /api/plans/:id/repeat` (`runtime`, `dynamic`, `maxDuration = 200`) → 200 `GeneratePlanResult`; id non UUID → `plan_not_found`; errori con `handlePlanRouteError(err, '[api/plans/repeat]')`. Client: `requestRepeatPlan(planId)` in `lib/plans/client.ts` (**WP3**, come `requestSwapSlot`).

**Test**
- WP5 `tests/plans/repeat.test.ts` (DB):
  - con `SAT`, piano del 28/09 (14 slot) ripetuto → bozza 05/10 con la stessa ricetta per giorno della settimana e pasto, `generate` mai chiamato;
  - una ricetta sorgente bloccata dopo il piano → quel solo slot è riempito dal planner;
  - `updateHousehold({ meals: ['cena'] })` prima di ripetere → solo le cene;
  - sorgente = obiettivo → `repeat_same_week`; obiettivo confermato → `plan_confirmed`; piano di un altro household → `plan_not_found`;
  - obiettivo in bozza con uno slot bloccato → lo slot bloccato resta intatto.
- WP5 `tests/api/plans-repeat.test.ts` (servizio mockato), come per lo swap.
- WP6: pulsante visibile solo con `can_repeat`; microcopy con la bozza esistente; click → `requestRepeatPlan(planId)`, toast `Piano ripetuto`; `EmptyState` dell'obiettivo con `Ripeti questa settimana` quando la corrente ha un piano.

**Dimensione e innesto:** piccola–media. **WP3** (funzione interna `buildTargetPlan`, `requestRepeatPlan`, codice d'errore in `lib/plans/errors.ts`); **WP5** (`repeatPlan`, rotta, test); **WP6** (pulsanti e test). `ARCHITECTURE.md §6`: nuova riga `POST /api/plans/:id/repeat` (WP3, insieme alle altre). `BACKLOG.md`: aggiungere a S3.3 un punto "Ripeti un piano (anche passato) sulla settimana da pianificare", per tracciabilità.

### Riepilogo dell'impatto sul piano
| WP | Cosa cambia rispetto a `plan.md` |
|---|---|
| WP1 | Contratti `PlanWeekView`/`PlanScreenView` (D2); config e formula della pausa, `isFresh`, niente ripiego (D3); lotti in config (R1) |
| WP2 | `listRecipesWith` e `activateDraftPlan` (R2); `listPlanWeeks` (D2); `incrementRecipeUsage` con giorni (D3); `DbExecutor` in `lib/db` (P4) |
| WP3 | Selezione dentro la transazione (R2); lotti + timeout 90 s + `maxDuration` (R1/D1); `getPlanScreen` con settimana, piano chiuso, archiviazione corretta (D2); `buildTargetPlan`, `requestRepeatPlan` (D4); loader in `lib/prefs` (R4); helper HTTP (P4); `ARCHITECTURE §5.2/§6` |
| WP4 | *Cambia* condizionale e long-press solo sul corpo della card (R5); `toRecipeDetail` in `components/sheets` (R6) |
| WP5 | Swap con selezione nella transazione e uso = giorno dello slot; `repeatPlan` + rotta (D4); `maxDuration` 200 |
| WP6 | Navigatore ‹ ›, sola lettura sulle settimane passate, *Ripeti*, recupero su `network_error`, link `/lista?piano=` |

