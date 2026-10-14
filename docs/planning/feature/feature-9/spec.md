# Feature 9 — Ricette su richiesta (LLM) e cambio con scelta dalla libreria

Specifica nata dal brainstorming del 13 ottobre 2026. Anticipa, senza aspettare il catalogo, i punti 1.2 (*Richieste libere*) e 2.3 (*Cambio ricetta: rapido o con scelta*) di `docs/v2-funzionalita.md`. Non è nel backlog né in `execution-strategy.md`; è indipendente dalla Feature 8 (pacchetto iniziale di ricette).

## 1. Overview & Problem Statement

Oggi una ricetta entra in libreria in un solo modo: la genera il planner quando il pool non basta (`ARCHITECTURE §5.2`). L'utente non può dire "voglio questa". Due conseguenze, emerse dai primi test sul Raspberry:

1. **In libreria si può solo cercare tra quello che c'è.** Il campo di ricerca filtra per titolo e ingredienti (`matchesLibraryFilter` in `lib/domain/library.ts`); se non trova nulla, la strada finisce lì. La generazione (`generateAndStoreRecipes` in `lib/recipes/generate.ts`) accetta numero, tipo di pasto e vincoli, ma nessun testo libero.
2. **Nel piano si può solo sorteggiare.** *Cambia* (`swapSlot` in `lib/plans/service.ts`) propone una ricetta scelta a caso con i pesi; per arrivare a quella voluta bisogna cambiare più volte. Non esiste un'operazione "metti questa ricetta in questo pasto": il `PATCH` dello slot gestisce solo il lucchetto.

**Utente:** l'unico utente dell'app, quasi sempre da telefono.

**Risultato atteso:**

- dalla Libreria, scrivendo un nome o una breve descrizione, l'utente riceve dall'LLM una proposta di ricetta e decide se aggiungerla;
- dal Piano, accanto a *Cambia* (che resta com'è), un secondo pulsante *Scegli* apre la libreria filtrata per quel pasto; se la ricetta voluta non c'è, la si chiede all'LLM da lì e la si mette nel piano.

Resta valido il principio di `ARCHITECTURE §1.3`: una ricetta accettata entra in libreria e ci resta.

## 2. Decisions & Rationale

| # | Decisione | Perché |
|---|---|---|
| D1 | **Una sola feature** per ricerca con LLM e cambio con scelta | Il selettore del piano riusa sia il filtro della libreria sia la richiesta all'LLM: separarle vorrebbe dire costruire la seconda metà due volte. |
| D2 | **Proposta, poi salvataggio**: l'LLM propone, in libreria entra solo ciò che l'utente accetta | Scelta dell'utente. Con il salvataggio immediato ogni tentativo sbagliato resterebbe in libreria e il planner lo pescherebbe; e oggi non esiste un'eliminazione. |
| D3 | La proposta **non è salvata sul server**: vive nel browser finché non viene accettata | Nessuna migrazione, nessuna bozza da ripulire. Chiudere la sheet o perdere la connessione non lascia residui. |
| D4 | **Una proposta per richiesta**, con *Un'altra* | L'utente ha chiesto "una ricetta". Una sola ricetta è anche la chiamata LLM più breve. |
| D5 | In Libreria l'ingresso è **il campo di ricerca esistente** | Scelta dell'utente. Un solo campo: prima si vede cosa c'è, poi con lo stesso testo si chiede. |
| D6 | Sulla card del piano **tre azioni**: ★, *Scegli*, *Cambia* | Scelta dell'utente. *Cambia* resta a un tap, quindi il principio di `DESIGN §3` ("un tap, non un menù") vale ancora per il cambio rapido. |
| D7 | Una richiesta esplicita rispetta **diete ed elettrodomestici**, ma **ignora gli ingredienti «non mi piace»** | Scelta dell'utente. Stile preferito e ingredienti graditi non entrano nel prompt: guida il testo della richiesta. |
| D8 | Lo stesso criterio di D7 vale per **la scelta a mano dal piano** | Coerenza: una ricetta chiesta apposta deve poter essere messa nel piano. Il sorteggio (*Cambia*, generazione, *Ripeti*) continua a escludere le ricette con un ingrediente scartato. |
| D9 | Nel selettore il tap su una ricetta apre **prima il dettaglio**, con *Metti nel piano* | Scelta dell'utente: si vede cosa si sta scegliendo. |
| D10 | Una ricetta **già presente in un altro pasto** della settimana resta selezionabile, con l'etichetta *Già nel piano* | Scelta dell'utente (cucinare doppio). Il sorteggio continua a non ripetere. |
| D11 | Nessun controllo di **somiglianza** (`pg_trgm`) sulle ricette chieste a mano; solo il titolo identico è un doppione | Chi chiede "lasagne al pesto" avendo già "Lasagne al ragù" vuole proprio una variante. |
| D12 | `planner` e `plans` restano **senza LLM** | Regola vincolante del progetto. Nel flusso dal piano è il client a concatenare: proposta e salvataggio (`recipes`), poi assegnazione (`plans`). |

Approcci scartati per la proposta: **salvataggio immediato** (meno codice, ma sporca la libreria; vedi D2) e **bozza nel DB** con uno stato `draft` (proposta persistente, ma migrazione, pulizia delle bozze abbandonate e un filtro in più ovunque si legge la libreria).

## 3. Functional Requirements

### FR-1 — Libreria: chiedere una ricetta dal campo di ricerca

1. Quando il testo cercato, senza spazi ai bordi, ha almeno `RECIPE_REQUEST_MIN` (3) caratteri, sotto l'elenco compare un riquadro: testo *Non c'è quello che cerchi?* e pulsante *Chiedi una ricetta per «‹testo›»*.
2. Il riquadro compare sia quando ci sono risultati sia nello stato vuoto *Nessuna ricetta trovata*. Non compare con meno di 3 caratteri.
3. Il testo inviato è quello del campo, senza spazi ai bordi. Il campo accetta al più `LIBRARY_QUERY_MAX` caratteri, che è anche il massimo della richiesta.
4. I chip di filtro (pasto, etichette, diete, preferite, bloccate) **non** entrano nella richiesta: conta solo il testo. Il tipo di pasto lo decide l'LLM.
5. Con la libreria vuota la schermata resta com'è oggi (nessun campo di ricerca, quindi nessuna richiesta).

### FR-2 — La proposta

1. Il tap sul pulsante apre una sheet in attesa, con i messaggi a rotazione già usati per la generazione (`GENERATION_MESSAGES`), preceduti da *Cerco una ricetta…*.
2. All'arrivo la sheet mostra la ricetta come un dettaglio in sola lettura: titolo, tempo, etichette, descrizione, ingredienti con le quantità per le persone dell'household, passi. **Senza** voto, ★, *Non proporre più* e giudizi sugli ingredienti: la ricetta non è ancora in libreria.
3. Azioni: *Aggiungi alla libreria* (primaria), *Un'altra* (secondaria), chiusura della sheet.
4. *Un'altra* rifà la richiesta con lo stesso testo, indicando i titoli già proposti in questa sequenza (al più `PROPOSAL_EXCLUDE_MAX` = 10, i più recenti). La proposta precedente sparisce.
5. Chiudere la sheet durante l'attesa annulla la richiesta lato client. Niente viene salvato.
6. Se il titolo proposto coincide (titolo normalizzato) con una ricetta già in libreria, la sheet mostra la proposta con l'avviso *Questa ce l'hai già: «‹titolo›»* e nasconde l'azione primaria. Restano *Un'altra* e la chiusura.

### FR-3 — Aggiungere la proposta alla libreria

1. *Aggiungi alla libreria* salva la ricetta con origine `llm`. Durante il salvataggio il pulsante è disattivato (nessun doppio invio).
2. A salvataggio riuscito: la sheet si chiude, il campo di ricerca e i filtri si azzerano, compare il toast *«‹titolo›» è in libreria* e la nuova card è visibile nell'elenco senza ricaricare la pagina.
3. La ricetta salvata è da quel momento una ricetta come le altre: si giudica, si blocca, il planner la può sorteggiare (se non contiene ingredienti scartati, vedi D8).

### FR-4 — Piano: il pulsante *Scegli*

1. La card del pasto ha, accanto a *Cambia*, il pulsante *Scegli* (icona lente + testo; `aria-label` *Scegli un'altra ricetta per ‹titolo›*).
2. *Scegli* compare esattamente quando compare *Cambia*: piano aperto, giorno non passato. È disattivato quando lo slot è bloccato.
3. *Cambia* non cambia comportamento: un tap, sorteggio, *Tieni / Cambia ancora*.
4. Nella riga *Tieni / Cambia ancora* compare anche *Scegli*, come pulsante con la sola icona (44 × 44 px, `aria-label` *Scegli dalla libreria*).
5. Durante un sorteggio in corso (*Cerco un'alternativa…*) nessuna azione è disponibile, come oggi.
6. Uno slot senza ricetta (*Ricetta non disponibile*) ha *Scegli* come ha *Cambia*.

### FR-5 — Il selettore

1. *Scegli* apre una sheet intitolata *Scegli per ‹giorno› · ‹pasto›* con un campo di ricerca e l'elenco delle ricette **adatte a quel pasto**.
2. Una ricetta è adatta se: non è bloccata, ha quel tipo di pasto, rispetta tutte le diete dell'household, richiede solo elettrodomestici disponibili. Gli ingredienti «non mi piace» **non** la escludono (D8).
3. La ricetta attualmente nello slot non compare. Quelle presenti in altri pasti dello stesso piano compaiono con l'etichetta *Già nel piano* e restano selezionabili (D10).
4. Ordine: lo stesso della Libreria (preferite prima, poi più recenti). La ricerca usa le stesse regole della Libreria (titolo e ingredienti, tutte le parole).
5. Nel selettore non ci sono chip di filtro e la ★ delle card non è un comando.
6. Sotto l'elenco, con almeno 3 caratteri cercati, compare lo stesso riquadro di FR-1 (*Chiedi una ricetta per «‹testo›»*). Compare anche quando la ricerca non trova nulla.
7. Se non c'è nessuna ricetta adatta, la sheet mostra *Nessun'altra ricetta adatta a questo pasto* e il campo di ricerca resta disponibile per chiederne una.
8. Durante il caricamento dell'elenco la sheet mostra un segnaposto; se il caricamento fallisce, un messaggio con *Riprova*.

### FR-6 — Dettaglio e *Metti nel piano*

1. Il tap su una ricetta del selettore apre il suo dettaglio completo (lo stesso della Libreria, giudizi compresi) con in più l'azione primaria *Metti nel piano*.
2. Dal dettaglio si torna all'elenco ritrovando testo cercato e posizione.
3. *Metti nel piano* assegna la ricetta allo slot. A operazione riuscita: le sheet si chiudono, la card mostra la nuova ricetta in stato normale (niente *Tieni / Cambia ancora*), la sequenza di ricette scartate dello slot si azzera, il focus torna sul pulsante *Scegli* della card.
4. Effetti sul piano, uguali a quelli di *Cambia*: se il piano è confermato si aggiornano `times_used` e `last_used_at` della nuova ricetta; se esiste una lista della spesa, viene segnata da aggiornare.

### FR-7 — Chiedere una ricetta dal selettore

1. Il riquadro di FR-5.6 apre la stessa sheet di proposta di FR-2, ma la richiesta porta il tipo di pasto dello slot: la ricetta proposta è valida per quel pasto.
2. L'azione primaria è *Metti nel piano*: salva la ricetta in libreria e la assegna allo slot, in sequenza. Il risultato è quello di FR-6.3.
3. Se il salvataggio riesce e l'assegnazione fallisce, la ricetta resta in libreria e il toast lo dice: *Ricetta aggiunta alla libreria, ma non sono riuscito a metterla nel piano.*
4. Con il titolo già in libreria vale FR-2.6 (solo *Un'altra* e chiusura): la ricetta esistente si trova cercandola nel selettore.

### FR-8 — Errori e casi limite

| Caso | Comportamento |
|---|---|
| L'LLM non risponde, va in timeout o restituisce un output non valido (dopo il tentativo di riparazione) | La sheet di proposta mostra il messaggio dell'errore con *Riprova*. Niente è salvato. |
| LLM non configurato | Stesso trattamento, con il messaggio *Generazione non disponibile: il modello non è configurato.* |
| La proposta viola diete, elettrodomestici o (dal piano) il tipo di pasto | Il server non la restituisce: `422 proposal_unsuitable`, *Non sono riuscito a proporre una ricetta adatta ai tuoi vincoli. Prova a cambiare la richiesta.* con *Riprova*. Nessun secondo tentativo automatico. |
| Al salvataggio il titolo è nel frattempo entrato in libreria | `409 recipe_duplicate`, toast *Questa ricetta è già in libreria.*; la sheet resta aperta. |
| Al salvataggio la ricetta non rispetta più i vincoli (impostazioni cambiate nel frattempo) | `422 recipe_unsuitable`, toast *La ricetta non rispetta più i vincoli delle impostazioni.* |
| *Metti nel piano* su uno slot nel frattempo bloccato, passato, o su un piano chiuso | Gli errori già esistenti (`slot_locked`, `slot_past`, `plan_archived`) come toast; le sheet si chiudono e il piano viene riletto. |
| *Metti nel piano* con una ricetta nel frattempo bloccata o non più adatta | `422 recipe_not_eligible`, toast *Questa ricetta non è adatta a questo pasto.*; si torna all'elenco, che viene ricaricato. |
| La ricetta scelta è già quella dello slot (richiesta ripetuta) | `200` senza scritture. |
| Testo della richiesta fuori dai limiti (meno di 3 caratteri, più di `LIBRARY_QUERY_MAX`) | `400 invalid_request`; la UI non permette di arrivarci. |
| Richiesta che non descrive un piatto | Nessun riconoscimento: l'LLM propone comunque una ricetta e l'utente la scarta. |

## 4. Architectural & Technical Design

### 4.1 Moduli e confini

```
Libreria (UI) ──► POST /api/recipes/propose ──► lib/recipes ──► lib/llm
              └─► POST /api/recipes          ──► lib/recipes ──► DB

Piano (UI)    ──► GET  …/slots/:slotId/candidates ──► lib/plans ──► DB
              ├─► POST /api/recipes/propose   (come sopra, con meal_type)
              ├─► POST /api/recipes           (come sopra)
              └─► PUT  …/slots/:slotId/recipe ──► lib/plans ──► DB
```

- Solo `lib/recipes` parla con `lib/llm`. `lib/plans` riceve soltanto un `recipe_id` (D12).
- Nessuna modifica al modello dati, **nessuna migrazione**.
- Le rotte esistenti (`POST /api/recipes/generate`, `POST …/swap`, `PATCH …/slots/:slotId`) non cambiano.

### 4.2 Tipi di dominio (`lib/domain/types.ts`)

Nuove costanti: `RECIPE_REQUEST_MIN = 3`, `PROPOSAL_EXCLUDE_MAX = 10`. Il massimo della richiesta è `LIBRARY_QUERY_MAX`, già esistente.

Nuovi schemi Zod (tutti `.strict()`):

| Schema | Forma |
|---|---|
| `ProposeRecipeRequestSchema` | `{ request: string` (trim, 3…`LIBRARY_QUERY_MAX`)`, meal_type: MealType \| null` (default `null`)`, exclude_titles: string[]` (max `PROPOSAL_EXCLUDE_MAX`, default `[]`) `}` |
| `RecipeProposalSchema` | `{ recipe: GeneratedRecipe, duplicate_of: { id: uuid, title: string } \| null }` |
| `SaveRecipeRequestSchema` | `{ recipe: GeneratedRecipe }` |
| `AssignSlotRecipeRequestSchema` | `{ recipe_id: uuid }` |
| `SlotCandidatesSchema` | `{ recipes: LibraryRecipeCard[], in_plan_recipe_ids: uuid[] }` |

`GeneratedRecipeSchema` e `LibraryRecipeCard` sono quelli esistenti, riusati senza varianti.

### 4.3 Adapter LLM (`lib/llm/`)

- Nuova funzione `generateRecipeFromRequest(constraints, request, excludeTitles, options?) → GeneratedRecipe`. Condivide con `generateRecipes` la chiamata, lo schema di output, il tentativo di riparazione, il timeout e la mappatura degli errori (`LlmError`); chiede una sola ricetta.
- Nuovo prompt in `lib/llm/prompts.ts`, accanto a `buildRecipePrompt`. Le istruzioni di sistema restano `buildRecipeInstructions()`. Il prompt contiene:
  - la richiesta dell'utente, riportata come dato tra delimitatori e con l'indicazione di trattarla solo come descrizione del piatto;
  - persone (`servings_base`), tipo di pasto (se indicato), diete da rispettare, elettrodomestici disponibili;
  - se presenti, i titoli da non riproporre (*Hai già proposto queste, proponine una diversa*);
  - l'indicazione di adattare il piatto ai vincoli quando la richiesta li violerebbe (es. variante vegetariana).
- **Non** contiene stile preferito, ingredienti graditi, ingredienti scartati, né l'elenco dei titoli della libreria (D7, D11).

### 4.4 Modulo `recipes` (`lib/recipes/`)

- `proposeRecipe({ request, mealType, excludeTitles, householdId? }) → RecipeProposal`
  1. carica l'household e costruisce i vincoli con `buildConstraints`, senza preferenze sugli ingredienti e con `meal_style_tags` vuoto;
  2. chiama `generateRecipeFromRequest`;
  3. controlla la ricetta con `findConstraintViolations` (tipo di pasto se indicato, diete, elettrodomestici; con `ingredient_dislikes` vuoto il controllo sugli ingredienti non scatta). Una violazione → errore `proposal_unsuitable`;
  4. cerca in libreria una ricetta con lo stesso titolo normalizzato (`normalizeTitle`) e valorizza `duplicate_of`;
  5. non scrive nulla.
- `saveProposedRecipe({ recipe, householdId? }) → Recipe con ingredienti`
  1. in transazione, sotto `acquireRecipeGenerationLock`;
  2. ricontrolla diete ed elettrodomestici sull'household riletto → `recipe_unsuitable`;
  3. titolo normalizzato già presente → `recipe_duplicate`; nessun controllo `findSimilarRecipeTitle` (D11);
  4. inserisce con `source: 'llm'` e slug univoco.
- L'inserimento di una ricetta generata (slug univoco + `insertRecipeWith` + mappatura degli ingredienti) oggi è dentro il ciclo di `generateAndStoreRecipes`: va estratto in una funzione condivisa dai due percorsi, senza cambiare il comportamento della generazione a lotti.
- Nuovi errori di dominio del modulo, con la busta standard `{ error: { code, message } }`: `proposal_unsuitable` (422), `recipe_unsuitable` (422), `recipe_duplicate` (409).

### 4.5 Modulo `plans` (`lib/plans/`) e dominio

- Regola di idoneità per la scelta a mano: funzione pura in `lib/domain/planner.ts` che riusa `exclusionReason` con preferenze sugli ingredienti vuote e nessuna esclusione per id. È l'unica definizione di "adatta a questo pasto", usata sia dall'elenco sia dall'assegnazione.
- `listSlotCandidates(planId, slotId, options?) → SlotCandidates`: carica piano e slot con gli stessi controlli dello swap (`loadOpenOwnedPlan`, `findSwappableSlot`), legge la libreria, tiene le ricette adatte tranne quella dello slot, le trasforma con `toLibraryCard`, le ordina con `compareLibraryCards`; `in_plan_recipe_ids` sono le ricette degli altri slot del piano.
- `assignSlotRecipe(planId, slotId, recipeId, options?) → PlanResult`: in transazione sotto `acquirePlanLock`, rilegge piano, slot, household e ricetta; controlla che la ricetta sia dell'household (`recipe_not_found`) e adatta (`recipe_not_eligible`); se è già quella dello slot risponde senza scrivere; altrimenti `updateSlotRecipe`, `incrementRecipeUsage` se il piano è `active`, `markShoppingListStale`. Nessuna chiamata LLM, nessun `rng`.
- Nuovi codici in `lib/plans/errors.ts`: `recipe_not_found` (404, *Ricetta non trovata.*), `recipe_not_eligible` (422, *Questa ricetta non è adatta a questo pasto.*).

### 4.6 Superficie API

| Metodo | Rotta | Corpo | Risposta | Errori propri |
|---|---|---|---|---|
| POST | `/api/recipes/propose` | `ProposeRecipeRequest` | `200 RecipeProposal` | `400 invalid_request`, `422 proposal_unsuitable`, errori LLM esistenti (`llm_not_configured`, `llm_timeout`, `llm_unavailable`, `llm_invalid_output`) |
| POST | `/api/recipes` | `SaveRecipeRequest` | `201 { recipe }` | `400 invalid_request`, `409 recipe_duplicate`, `422 recipe_unsuitable` |
| GET | `/api/plans/:id/slots/:slotId/candidates` | — | `200 SlotCandidates` | `404 plan_not_found`, `404 slot_not_found`, `409 plan_archived`, `409 slot_locked`, `409 slot_past` |
| PUT | `/api/plans/:id/slots/:slotId/recipe` | `AssignSlotRecipeRequest` | `200 { plan }` | quelli della riga sopra, più `400 invalid_request`, `404 recipe_not_found`, `422 recipe_not_eligible` |

`POST /api/recipes/propose` ha `runtime = 'nodejs'`, `dynamic = 'force-dynamic'` e `maxDuration = 250`, come lo swap: una chiamata più l'eventuale riparazione, cioè al più `2 × LLM_TIMEOUT_MS`.

### 4.7 Interfaccia

| Elemento | Dove | Cosa cambia |
|---|---|---|
| Riquadro *Chiedi una ricetta per «…»* | nuovo componente condiviso | Usato da `components/library/library-screen.tsx` e dal selettore. |
| Sheet di proposta | nuovo componente condiviso | Stati: attesa, proposta, doppione, errore. Riceve l'etichetta e il gestore dell'azione primaria (*Aggiungi alla libreria* oppure *Metti nel piano*). Presenta la ricetta in sola lettura riusando la parte di presentazione di `components/sheets/recipe-sheet.tsx`. |
| Selettore | nuovo componente in `components/plan/` | Elenco con ricerca, etichetta *Già nel piano*, riquadro di richiesta. Filtra il testo con `filterLibraryCards`. |
| Dettaglio con azione | `components/recipes/recipe-detail-sheet.tsx` | Accetta un'azione primaria facoltativa (*Metti nel piano*). In Libreria e nel Piano, senza l'azione, resta identico a oggi. |
| Card del pasto | `components/cards/meal-card.tsx`, `components/plan/plan-slot-card.tsx` | Nuova azione *Scegli* nel footer e nella riga *Tieni / Cambia ancora*. |
| Client HTTP | `lib/library/client.ts`, `lib/plans/client.ts` | Funzioni per le quattro rotte nuove; la richiesta di proposta accetta un `AbortSignal`. |

### 4.8 Documenti da allineare

`ARCHITECTURE.md` §5.1 (richiesta libera), §5.3 (scelta a mano e regola di idoneità), §5.4 (un ingrediente scartato non blocca la scelta esplicita), §6 (quattro rotte); `DESIGN.md` §3 (tre azioni sulla card), mappa schermate e microcopy; `docs/v2-funzionalita.md` §1.2 e §2.3 (cosa è stato anticipato e cosa resta per il catalogo); wiki in `docs/wiki/`.

## 5. Non-Functional Requirements

- **Tempi.** Una proposta richiede di norma 10–30 s (`ARCHITECTURE §7`), al più `2 × LLM_TIMEOUT_MS`. La UI mostra sempre uno stato di attesa e resta chiudibile. Elenco delle candidate e assegnazione non chiamano l'LLM: rispondono nei tempi di una lettura della libreria (≈ 60 ms a 300 ricette, secondo la nota in `lib/library/service.ts`).
- **Affidabilità.** La chiamata LLM sta fuori da ogni transazione. Una proposta abbandonata non lascia nulla sul server. Il salvataggio è una sola transazione sotto il lock di generazione; l'assegnazione una sola transazione sotto il lock del piano, sullo stato riletto.
- **Concorrenza.** Due salvataggi sovrapposti dello stesso titolo ne producono uno solo (il secondo riceve `recipe_duplicate`). Un'assegnazione sovrapposta a una rigenerazione o a uno swap vede lo stato già aggiornato.
- **Sicurezza.** Il testo della richiesta ha lunghezza limitata, entra nel prompt come dato delimitato e non viene mai eseguito né reso come HTML. La ricetta che torna dal browser al salvataggio è rivalidata per intero (`GeneratedRecipeSchema` più vincoli duri): il client non è una fonte fidata. Nessuna chiave API raggiunge il client.
- **Costi.** Una ricetta per chiamata, avviata solo da un gesto esplicito dell'utente.
- **Test senza rete.** L'adapter si prova con una risposta registrata per la richiesta libera, in `tests/fixtures/llm/recorded/` (`pnpm llm:record`); servizi e rotte con l'LLM iniettato; il DB sul Postgres Docker locale.
- **Accessibilità e design.** Tap target ≥ 44 px anche con tre azioni sulla card a 360 px di larghezza, contrasto AA, `prefers-reduced-motion` rispettato, focus gestito all'apertura e alla chiusura delle sheet, stati di attesa annunciati (`role="status"`). Microcopy in italiano, nel tono di `DESIGN.md §5`.
- **Compatibilità.** Nessuna migrazione, nessuna variabile d'ambiente nuova, nessun cambiamento al deploy sul Raspberry.

## 6. Out of Scope

- Più proposte per richiesta, o una scelta tra alternative affiancate.
- Modifica a mano della ricetta proposta e inserimento manuale di una ricetta (`v2-funzionalita.md` §1.3, §1.4).
- Eliminazione di una ricetta dalla libreria.
- Ricerca "intelligente" nella libreria (pertinenza, sinonimi, LLM che ordina i risultati): la libreria resta ricerca testuale.
- Ricerca nel catalogo del dataset (`v2-funzionalita.md` §1.1, §1.5).
- Chip di filtro nel selettore e uso dei chip della Libreria nella richiesta all'LLM.
- Richiesta all'LLM con la libreria vuota.
- Segnale implicito dello swap o della scelta nel peso del planner (`v2-funzionalita.md` §2.5).
- Proposta che sopravvive alla chiusura della sheet o al ricaricamento della pagina.
- Secondo tentativo automatico quando la proposta viola i vincoli.
- Riconoscimento delle richieste che non descrivono un piatto.
- LLM opzionale a runtime, cioè nascondere la richiesta quando il modello non è configurato (`v2-funzionalita.md` §2.6).
- Etichetta o avviso sulle ricette che contengono un ingrediente scartato.

## 7. Verification & Acceptance Criteria

1. In Libreria, con tre o più caratteri nel campo di ricerca, compare *Chiedi una ricetta per «…»*, sia con risultati sia senza; con due caratteri non compare.
2. La richiesta mostra una proposta completa e **non** crea righe in `recipes` finché non si tocca *Aggiungi alla libreria*. Chiudere la sheet in qualunque momento lascia la libreria invariata.
3. Dopo *Aggiungi alla libreria* la ricetta è in libreria con origine `llm`, la card è visibile senza ricaricare e il dettaglio si apre con ingredienti e passi.
4. *Un'altra* invia i titoli già proposti nella sequenza e mostra una proposta con un titolo diverso (verificato con risposte registrate).
5. Con un household vegetariano, una proposta che non dichiara `vegetariano` non arriva mai all'utente (`422 proposal_unsuitable`); lo stesso per un elettrodomestico non disponibile.
6. Una proposta che contiene un ingrediente «non mi piace» viene restituita e si può salvare; dopo il salvataggio il sorteggio continua a non proporla.
7. Una proposta con il titolo di una ricetta già in libreria mostra l'avviso e non offre l'azione primaria; `POST /api/recipes` con lo stesso titolo risponde `409 recipe_duplicate`.
8. Sulla card del piano compaiono ★, *Scegli* e *Cambia*; *Cambia* funziona esattamente come prima (i test esistenti di `tests/ui/plan-slot-card.test.tsx` restano verdi senza modificarne le attese sul sorteggio).
9. Il selettore elenca solo ricette non bloccate, del tipo di pasto dello slot, che rispettano diete ed elettrodomestici; non contiene la ricetta dello slot; marca *Già nel piano* quelle degli altri slot.
10. Dal selettore, tap su una ricetta → dettaglio → *Metti nel piano*: lo slot mostra quella ricetta, la card è in stato normale, la lista della spesa esistente risulta da aggiornare, e su un piano confermato `times_used` della ricetta aumenta di uno.
11. `PUT …/recipe` rifiuta: ricetta inesistente o di un altro household (`404`), bloccata o non adatta (`422`), slot bloccato o passato e piano chiuso (`409`).
12. Dal selettore, una richiesta all'LLM seguita da *Metti nel piano* lascia la ricetta sia in libreria sia nello slot, con il tipo di pasto dello slot tra i suoi `meal_types`.
13. `listSlotCandidates` e `assignSlotRecipe` non chiamano né `lib/llm` né la generazione di `lib/recipes`; `lib/domain/planner.ts` resta senza dipendenze da DB, LLM e framework.
14. Gate completo verde: `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`. Nessun test usa la rete.
15. Prova da telefono (360 px): le tre azioni della card stanno su una riga senza andare a capo né scendere sotto i 44 px; il selettore e la sheet di proposta scorrono e si chiudono correttamente; il toast è leggibile sopra le sheet.
