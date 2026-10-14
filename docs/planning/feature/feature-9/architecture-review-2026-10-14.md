# Architecture review — Feature 9 (Ricette su richiesta e cambio con scelta dalla libreria)

**Data:** 2026-10-14 · **Piano esaminato:** [`plan.md`](plan.md) (+ [`requirements.md`](requirements.md), [`spec.md`](spec.md)) · **Contesto:** as-built di F1–F7 (`main`, commit `bff5cda`, v0.6.1), spunto della Feature 8 (`../feature-8/brainstorm-prompt.md`), `CLAUDE.md`.

**Esito in una riga:** niente di bloccante e nessun refactoring preliminare: il piano poggia su fatti veri e riusa i pattern esistenti senza duplicarli. Ci sono però tre innesti piccoli che conviene fare dentro i WP già previsti: trattare la chiusura della sheet come annullamento e non come timeout (R1), non buttare via il motivo di una proposta scartata (R2), usare `dvh` nelle sheet nuove come ha fatto la 0.6.1 per le schermate (R3).

> **Nota sugli ID.** `P1…P5` e `R1…R7` sono gli ID di questa review. Le decisioni di `requirements.md` (che usa `P1…P29` e `U1…U3`) sono citate come «req. P*n*» / «req. U*n*»; quelle della spec come «spec D*n*».

## Metodo e prove raccolte

- **Letti per intero:** `plan.md` (11 WP, 4 wave), `spec.md`, `requirements.md`. Sul codice: `lib/llm/{adapter,prompts}.ts`, `lib/recipes/{generate,constraints}.ts`, `lib/plans/service.ts` (conferma, blocco, swap), `lib/http/{client,responses}.ts`, `lib/library/service.ts`, `lib/domain/{types,planner,library}.ts` (parti toccate), `lib/db/repositories/recipe-repo.ts` (firme), `components/ui/sheet.tsx`, `components/sheets/recipe-sheet.tsx`, `components/recipes/recipe-detail-sheet.tsx`, `components/plan/{plan-screen,plan-slot-card}.tsx`, le rotte `app/api/recipes/generate` e `…/slots/[slotId]/swap`, i mock dei test UI.
- **Ipotesi della §0.2 del piano controllate sul codice:**
  - `buildConstraints` accetta `mealType: null` e `overrides.meal_style_tags` (`lib/recipes/constraints.ts:23-41`); `findConstraintViolations` salta il pasto con `meal_type: null` (`:58`).
  - Il JSON di un `RecipeWithDetails` passa `RecipeSchema` sul client: date e quantità sono `z.coerce` (`lib/domain/types.ts:131`, `:153`, `:173`) e c'è già il precedente di `RecipeDetailViewSchema` (`:574-577`). `SaveRecipeResultSchema` quindi regge.
  - `toLibraryCard` e `exclusionReason` ricevono già oggi dei `RecipeWithDetails` (`lib/library/service.ts:22`, swap in `lib/plans/service.ts:627-636`).
  - L'effetto del focus di `PlanSlotCard` gira a ogni render (`components/plan/plan-slot-card.tsx:85-93`): `pendingFocus.current = "pick"` funziona senza toccarlo, come dice il WP10.
  - `tests/ui/plan-screen.test.tsx:28` e `:41` sostituiscono i client con `importOriginal`: le funzioni nuove non rompono i test esistenti.
  - `LibraryScreen` ha `setCards`, `persons`, `resetFilters` e `useRouter` (`components/library/library-screen.tsx:42-63`).
  - Gli elenchi "File" dei WP non si sovrappongono dentro nessuna wave.
- **Stima, non misura:** le tre azioni della card a 360 px occupano circa 240 px sui 296 disponibili (card `p-4` dentro `main px-4`). Resta la prova da telefono di req. §5.
- **Non verificato:** il gate non è stato eseguito (nessuna modifica al codice). Non ho provato se Next 15 in standalone abortisce `request.signal` quando il client chiude la connessione (vedi R1). Nessuna chiamata LLM reale.

---

## 1. Problemi attuali (ordinati per impatto)

### P1 — La primitiva `Sheet` è fatta a mano e regge solo l'uso di oggi · **da tenere d'occhio**

**File:** `components/ui/sheet.tsx` (effetto "Close on Escape", `:124-125`, `:132`), `components/sheets/recipe-sheet.tsx:138`, `:180`.

- **Nessun portale.** Il pannello è `fixed inset-0 z-50` reso dove viene montato. Funziona perché oggi ogni sheet è figlia diretta della schermata (`plan-screen.tsx:750`, `library-screen.tsx:165`) e nessun antenato crea uno stacking context.
- **Effetti globali ingenui.** Ogni sheet ascolta Esc per conto suo e alla pulizia rimette `body.style.overflow = ""`. Con una sheet alla volta non si nota. Il WP3 lo corregge con la pila: la correzione è giusta e necessaria.
- **Nessuna gestione del focus.** `role="dialog" aria-modal="true"` senza spostare il focus dentro né trattenerlo. Chi usa la tastiera resta sul pulsante dietro lo sfondo.
- **Altezze in `vh`** (`max-h-[90vh]`, `max-h-[92vh]`). La 0.6.1 ha portato le schermate a `dvh` (`04a5ccd`, `cefb01b`) proprio perché `vh` sul telefono non è l'area visibile; le sheet sono rimaste fuori da quel giro.

### P2 — Le regole di vincolo esistono in due copie tenute insieme da un commento · **da tenere d'occhio**

**File:** `lib/recipes/constraints.ts:48-49`, `lib/domain/planner.ts:51-52`.

- `findConstraintViolations` (ricette generate) e `exclusionReason` (ricette in libreria) applicano le stesse regole; ognuna dice "se cambi una, controlla l'altra". Oggi coincidono: stesso controllo del pasto, stesso `expandDietFlags`, stessi elettrodomestici, stessi ingredienti scartati.
- Nessun test le confronta. Finora non serviva: una ricetta generata passava dalla prima e poi, nel planner, dalla seconda, senza che l'utente vedesse la differenza.

### P3 — L'annullamento di una chiamata LLM è classificato come timeout · **da tenere d'occhio (oggi inerte)**

**File:** `lib/llm/adapter.ts:94`, `lib/http/responses.ts:53-54`.

- `toLlmError` mappa `AbortError` e `TimeoutError` nello stesso `LlmError('timeout')`, che diventa `504 llm_timeout`.
- Oggi nessun chiamante passa un `abortSignal`: il ramo non scatta mai.

### P4 — Ogni lettura di ricette passa dall'intera libreria · **da tenere d'occhio**

**File:** `lib/library/service.ts:2`, `:21`, `:37`; `lib/plans/service.ts:639-640` (fino a tre letture per swap); `lib/db/repositories/recipe-repo.ts:264`.

- Anche il dettaglio di **una** ricetta carica tutte le ricette con ingredienti e preferenze. `getRecipeById` non accetta un executor né controlla l'household, quindi dentro una transazione non si usa.
- La nota in testa al file dice ≈ 60 ms a 300 ricette su desktop. Con 26 ricette non pesa. La Feature 8 ne porterà 100–200 su un Pi 4 da 2 GB.

### P5 — Stile non uniforme nelle rotte `/api/recipes/*`; due file oltre le 700 righe · **cosmetico**

**File:** `app/api/recipes/generate/route.ts:16-20`, `:38-39`; `lib/plans/service.ts` (735 righe); `components/plan/plan-screen.tsx` (768 righe).

- La rotta di generazione legge il corpo con `request.json()` e gestisce gli errori in linea; le rotte più recenti usano `readJsonBody` e un gestore del modulo.
- `resolveClock`, `loadOpenOwnedPlan`, `findSwappableSlot` sono private di `service.ts`: ogni operazione nuova sui piani deve nascere lì dentro.

### Aree senza problemi da segnalare

- **Confini dei moduli.** `lib/domain/*` è puro; solo `lib/recipes` importa `lib/llm` (`lib/recipes/generate.ts:18`); `plans` riceve la generazione come funzione iniettata.
- **Errori.** La coppia `errors.ts` + `http.ts` per modulo e la busta `{ error: { code, message } }` sono applicate in modo uniforme da `plans` e `shopping`.
- **Tipi.** Nei file letti `lib/domain/types.ts` è l'unica fonte: nessuna ridefinizione locale di tipi di dominio (non ho fatto una ricerca su tutto il repository).
- **Concorrenza.** Lock dei piani più rilettura dello stato sotto lock (`swapSlot` fase 2, `setSlotLock`, `confirmPlan`): pattern chiaro e ripetibile.
- **Client fetch.** `requestJson` valida ogni risposta 2xx e normalizza gli errori; i componenti non conoscono `fetch`.
- **Test.** LLM registrato, DB vero, rotte con servizio sostituito: i tre livelli ci sono e non usano la rete.

---

## 2. Rischi introdotti o amplificati dalla feature

### R1 — Chiudere la sheet durante l'attesa produce un finto timeout, e in sviluppo ogni richiesta parte due volte · **da tenere d'occhio** — attiva P3

**Dove:** WP5 passo 7 (`request.signal` passato a `proposeRecipe`), WP7 (effetto che chiama `load`), req. P6.

- Con l'annullamento l'adapter lancia `LlmError('timeout')`; `handleRecipeRouteError` lo scrive con `console.error` e costruisce un `504` che nessuno legge. Chiudere la sheet è un gesto normale in un'attesa di 10–30 s: ogni chiusura lascia nei log del Raspberry un errore identico a un timeout vero. E i timeout veri ci sono già stati (primo avvio sul Pi).
- È il primo uso lato server di `request.signal` in tutto il codice. Se Next in standalone non lo abortisce alla disconnessione, req. P6 non ha effetto e la chiamata continua fino in fondo. Il piano lo lascia come verifica manuale di chiusura (req. §5).
- In sviluppo React StrictMode (attivo di default con l'App Router; `next.config.ts` non lo spegne) esegue l'effetto due volte: due `POST /api/recipes/propose` per ogni apertura, la prima annullata subito. Con una chiave vera in `.env.local` sono due chiamate al modello, a meno che l'annullamento arrivi davvero al server. In produzione non succede.

### R2 — `proposal_unsuitable` butta via il motivo · **da tenere d'occhio**

**Dove:** WP5 passo 6 (`proposeRecipe` punto 4, `saveProposedRecipe` punto 3.3), WP5 passo 2 («I `RecipeError` non si loggano»).

- `findConstraintViolations` restituisce l'elenco delle violazioni; il piano ne guarda solo la lunghezza. Né il log né la risposta dicono quale vincolo è saltato.
- La generazione a lotti quel dettaglio lo conserva (`lib/recipes/generate.ts:105-112`, campo `skipped[].detail`).
- Senza secondo tentativo automatico (scelta della spec, sensata), l'unica leva dell'utente è *Riprova* a 10–30 s per volta. Se con un household vegetariano il modello dimentica `diet_flags`, il sintomo è "non funziona mai" e non c'è modo di capire perché.

### R3 — Sheet nuove in `vh`, una ad altezza fissa e con le azioni in fondo · **da tenere d'occhio** — amplifica P1

**Dove:** WP9 (`h-[92vh] max-h-[92vh]` sul selettore), WP3 passo 2 (footer `sticky bottom-0` dentro `max-h-[92vh]`).

- Le sheet esistenti sono alte quanto il contenuto: il limite in `vh` si tocca solo con ricette lunghe. Il selettore è **sempre** al massimo, e la sheet di proposta lo è quasi sempre.
- Dove `vh` è l'area con le barre del browser nascoste, la sheet ancorata in basso sporge in alto: titolo e ✕ (a 16 px dal bordo) finiscono fuori dall'area visibile. È la stessa classe di difetto corretta due giorni fa per le schermate.

### R4 — Il selettore è la prima sheet montata dentro l'elenco · **da tenere d'occhio** — amplifica P1

**Dove:** WP10 passo 1 (selettore nel frammento di `PlanSlotCard`), req. P19; `components/plan/plan-screen.tsx:662-665`, `:493`; `components/navigation/bottom-nav.tsx:49`.

- Le card stanno dentro il contenitore `transition-opacity` che durante una navigazione riceve `opacity-60`. Il dettaglio di oggi è fuori da quel contenitore (`:750`); il selettore, con dettaglio e proposta, ci finisce dentro.
- A riposo nessun antenato crea uno stacking context: funziona. Con `opacity-60` sì: la sheet diventa semitrasparente e la barra di navigazione (`z-40`) passa sopra la striscia in basso, dove sta *Metti nel piano*. Caso concreto: *Crea lista della spesa* che risponde mentre il selettore è aperto.
- È raro e dura un attimo. Il punto è che "nessun antenato con opacità, trasformazioni o filtri" diventa una regola da cui la feature dipende, e non è scritta da nessuna parte.

### R5 — Un `recipe_duplicate` dal selettore lascia in un vicolo cieco · **da tenere d'occhio**

**Dove:** WP9 `acceptProposal` (ramo del salvataggio fallito), caso di test 14; spec FR-7.4, FR-8.

- Se il salvataggio va a buon fine sul server ma la risposta si perde (telefono, Tailscale), il secondo tap su *Metti nel piano* riceve `409 recipe_duplicate`. La sheet resta aperta con un pulsante che fallirà sempre.
- FR-7.4 dice che la ricetta "si trova cercandola nel selettore", ma l'elenco è stato caricato prima del salvataggio e in questo ramo non viene ricaricato: la ricetta non c'è finché non si chiude e riapre *Scegli*.
- In Libreria vale lo stesso per `cards`, ma lì basta ricaricare la pagina e non c'è un'azione a metà.

### R6 — Nessun test attraversa il confine tra servizio e schema del client · **da tenere d'occhio** — amplifica P2

**Dove:** WP1 (test dei client con risposte scritte a mano), WP5 e WP6 (test di rotta con servizio sostituito, test di servizio sugli oggetti).

- I tre schemi di risposta nuovi sono `.strict()` e `requestJson` rifiuta ciò che non li rispetta. Ho controllato a mano che oggi combacino. Nessun test lo garantisce domani.
- Il caso peggiore è il salvataggio: ricetta scritta, il client mostra *Risposta del server non valida*, il nuovo tentativo dà 409 (e si ricade in R5).
- Stesso discorso per P2: il percorso proposta → salvataggio → assegnazione funziona solo se una ricetta che passa `findConstraintViolations` passa anche `manualChoiceExclusionReason`. Se le due regole divergono, il sintomo è il toast *Ricetta aggiunta alla libreria, ma non sono riuscito a metterla nel piano* a ogni richiesta.

### R7 — Tre letture complete della libreria per ogni scelta a mano, di cui una evitabile · **da tenere d'occhio** — amplifica P4

**Dove:** WP6 `listSlotCandidates`, `assignSlotRecipe` (req. P10); dettaglio via `getRecipeDetail` (`lib/library/service.ts:37`).

Il percorso *Scegli* → dettaglio → *Metti nel piano* fa tre richieste, e ognuna carica tutte le ricette dell'household con ingredienti e preferenze:

1. **Apertura del selettore** (`GET …/candidates`): legge la libreria per elencare le ricette adatte. Necessaria: è un elenco.
2. **Apertura del dettaglio** (`GET /api/recipes/:id`, codice esistente): legge la libreria per trovare la ricetta e per contare, per ogni ingrediente, quante ricette lo contengono (il numero mostrato nella conferma di scarto). Giustificata dal conteggio; la nota in testa a `lib/library/service.ts` indica già come farlo in SQL se servirà.
3. **Assegnazione** (`PUT …/recipe`): legge la libreria dentro la transazione che tiene il lock dei piani, solo per trovare **una** ricetta per id e controllarne l'idoneità. È l'unica evitabile: basterebbe leggere quella ricetta.

- req. P10 sceglie la lettura completa perché `getRecipeById` non accetta una transazione e aggiungerla toccherebbe `recipe-repo.ts`, che nella stessa wave è di WP5. Compromesso ragionevole ai numeri di oggi.

### Complessità e scorciatoie

- **Nessun eccesso di ingegneria.** La pila delle sheet (una ventina di righe) serve davvero: con l'effetto di oggi Esc chiuderebbe entrambe le sheet e la chiusura della seconda sbloccherebbe lo scroll. `placeholder` / `notice` / `footer` evitano un secondo componente di presentazione. La sequenza salva-poi-assegna lato client è il prezzo giusto di spec D12.
- **Undici WP in quattro wave** sono proporzionati a implementer di fascia bassa: ogni WP ha file, pattern e test nominati.
- **Scorciatoia accettabile:** `lib/recipes/index.ts` resta congelato per non rompere i mock dei test (req. P1). Il modulo avrà due stili di import (`@/lib/recipes` per la generazione, `@/lib/recipes/propose` per il resto). Cosmetico; `plans` è già senza barrel.
- **Scorciatoia accettabile:** `POST /api/recipes` scrive sempre `source: 'llm'`. Quando arriverà l'inserimento a mano servirà distinguere l'origine.
- **Nota di sicurezza, cosmetica:** i titoli di `exclude_titles` arrivano dal client ed entrano nel prompt fuori dai delimitatori (WP2 passo 1, riga 15), ridotti a una riga e limitati a 10 × 120 caratteri. La spec §5 parla di "dato delimitato" solo per la richiesta. Con un solo utente e nessuna autenticazione chi può sfruttarlo è l'utente stesso: nessuna azione.

---

## 3. Proposte e punto di innesto

Tutte piccole. Nessuna richiede lavoro prima della wave 1.

| ID | Proposta | Taglia | Dove | Quando |
|---|---|---|---|---|
| R1 | Nel `catch` di `POST /api/recipes/propose`, prima di `handleRecipeRouteError`: `if (request.signal.aborted) return new Response(null, { status: 499 });` senza log. Test di rotta in più: richiesta con segnale già abortito e servizio che rigetta con `LlmError('timeout')` → stato 499, `console.error` mai chiamata. | piccola | **WP5** passo 7 e `tests/api/recipes-propose.test.ts` | durante |
| R1 | Anticipare la verifica manuale di req. §5 ("chiudere la sheet e guardare i log") a **fine wave 3**, appena la Libreria è cablata: se `request.signal` non scatta, lo si sa prima della chiusura e si decide se tenere req. P6. | piccola (processo) | gate tra wave 3 e wave 4 | durante |
| R2 | In `proposeRecipe` e `saveProposedRecipe` tenere l'elenco delle violazioni e scriverlo prima di lanciare: `console.warn('[recipes/propose] proposal_unsuitable', { title: recipe.title, violations })` (e l'analogo per `recipe_unsuitable`). Nei casi di test 4–6 e 14 una spia su `console.warn` controlla che il motivo ci sia. La risposta HTTP non cambia. | piccola | **WP5** passo 6 e `tests/recipes/propose.test.ts` | durante |
| R3 | Selettore: `h-[92dvh] max-h-[92dvh]`. `RecipeSheet`: i due `max-h-[92vh]` diventano `max-h-[92dvh]` (`recipe-sheet.tsx:138`, `:180`). Nessun test guarda quelle classi. Facoltativo nello stesso WP3: `90vh` → `90dvh` in `sheet.tsx:124-125`. | piccola | **WP9** (render) e **WP3** passo 2 | durante |
| R4 | Scelta consigliata: nessun refactoring; aggiungere a req. §5 la prova "aprire *Scegli* e controllare che la barra di navigazione resti sotto la sheet" e un commento sul contenitore di `plan-screen.tsx:662`. Alternativa più robusta, se si vuole chiudere P1 alla radice: `createPortal(…, document.body)` in `SheetContent`, insieme alla pila. Tocca tutte le sheet, quindi va fatta solo con l'intera suite UI verde. | piccola | **WP10** passo 2 (commento) oppure **WP3** passo 1 (portale) | durante |
| R5 | In `acceptProposal`, se il salvataggio fallisce con `recipe_duplicate`: toast, `setRequestText(null)`, `load()` e **non** rilanciare, come nel ramo di req. U3. Il caso di test 14 cambia attesa: proposta chiusa, `fetchSlotCandidates` chiamata una seconda volta. **È uno scostamento da FR-8** (che tiene aperta la sheet), limitato al selettore: **confermato dall'utente il 2026-10-14**. In Libreria FR-8 resta com'è. | piccola | **WP9** `acceptProposal` e caso 14 | durante |
| R6 | Tre asserzioni di confine: `RecipeProposalSchema.parse(JSON.parse(JSON.stringify(proposal)))` nel caso 1 di `propose.test.ts`; `SaveRecipeResultSchema.parse(JSON.parse(JSON.stringify({ recipe: saved })))` nel caso 11; `SlotCandidatesSchema.parse(JSON.parse(JSON.stringify(result)))` nel caso 1 di `assign.test.ts`. | piccola | **WP5** e **WP6**, test | durante |
| R6 / P2 | Una asserzione di parità nel caso 15 di `propose.test.ts`: per la ricetta appena salvata, `manualChoiceExclusionReason(saved, 'pranzo', household)` vale `null`. | piccola | **WP5**, test | durante |
| R7 / P4 | Niente ora. Soglia per intervenire: libreria oltre le 200 ricette dopo la Feature 8, oppure più di 300 ms sul Pi per aprire *Scegli*. Allora `getRecipeById(id, executor = db)` con controllo dell'household, usata da `assignSlotRecipe` (toglie la lettura 3). Per il dettaglio (lettura 2) serve invece il conteggio per ingrediente in SQL, come già annotato in `lib/library/service.ts`. | piccola | fuori dalla Feature 9 | dopo |
| P1 (focus) | Niente ora: req. P22 gestisce il ritorno del focus nei componenti nuovi, che è ciò che serve su telefono. Il focus iniziale dentro la sheet resta debito noto della primitiva. | — | — | dopo |
| P5 | Niente: non allineare la rotta di generazione dentro questa feature (regola 0.3.6 del piano). | — | — | — |

---

## 4. Se potessi migliorare solo 3 cose prima di procedere

1. **R1 — l'annullamento non è un timeout (WP5).** Tre righe nella rotta e un test. Senza, ogni sheet chiusa in attesa sporca i log del Raspberry con un errore indistinguibile dai timeout veri, che su quella macchina sono il problema reale da riconoscere. E va saputo presto se `request.signal` funziona: è l'unico meccanismo nuovo della feature che nessun test può provare.
2. **R2 — il motivo dello scarto nei log (WP5).** Una riga per servizio. È il percorso infelice più probabile della feature (il modello che non rispetta una dieta) e oggi il piano lo rende muto: l'utente vedrebbe solo *Riprova* che non funziona.
3. **R3 — `dvh` nelle sheet nuove (WP3, WP9).** Tre stringhe. Il selettore è la prima sheet sempre ad altezza massima e porta le azioni in fondo: è il punto in cui il difetto appena corretto per le schermate ha più probabilità di ripresentarsi sul telefono.

Se avanza tempo, la quarta è R6: quattro asserzioni che fissano nei test ciò che oggi ho verificato solo leggendo.
