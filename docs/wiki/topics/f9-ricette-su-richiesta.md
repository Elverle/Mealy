---
title: F9 Ricette su Richiesta — Chiedere una Ricetta all'LLM e Sceglierla dal Piano
type: topic
created: 2026-10-14
updated: 2026-10-14
tags: [recipes, llm, library, plans, manual-choice, proposal, picker, sheet, api, ui, feature-9]
---

## Panoramica

La **Feature 9** (*Ricette su richiesta (LLM) e cambio con scelta dalla libreria*) aggiunge due modi di far entrare una ricetta dove serve, senza toccare quelli esistenti. Non appartiene a un epic del backlog: è nata dai primi test sul Raspberry (il solo cambio casuale non basta, e non c'era modo di chiedere una ricetta precisa) e anticipa senza il catalogo i punti 1.2 e 2.3 di `docs/v2-funzionalita.md`. Non è in `docs/BACKLOG.md` né in `execution-strategy.md`; per questo la pagina usa il prefisso `f9-` invece della sigla di un epic.

1. **Libreria — chiedere una ricetta.** Con almeno 3 caratteri nel campo di ricerca compare il riquadro *Chiedi una ricetta per «…»*. L'LLM propone **una** ricetta, mostrata in sola lettura; in libreria entra solo con *Aggiungi alla libreria*. La proposta non è mai salvata sul server prima di allora ([[recipe-proposal-sheet]], [[recipe-proposal-service]], [[library-screen]]).
2. **Piano — scegliere una ricetta.** Sulla card del pasto, accanto a *Cambia* (invariato), il pulsante *Scegli* apre un selettore con le ricette della libreria adatte a quel pasto. Il tap su una ricetta apre il dettaglio con *Metti nel piano*; se la ricetta voluta non c'è, dal selettore si chiede all'LLM e la si mette nel piano ([[slot-recipe-picker]], [[plan-service]]).

Quattro rotte nuove, **nessuna migrazione**, nessuna variabile d'ambiente nuova, nessun cambiamento al deploy. `planner` e `plans` restano senza LLM: nel flusso dal Piano è il client a concatenare proposta e salvataggio (`recipes`) e poi assegnazione (`plans`).

Il principio di `ARCHITECTURE §1.3` resta: una ricetta accettata entra in libreria e ci resta. Cambia invece la frase "l'LLM interviene solo quando il pool è insufficiente": dalla Feature 9 l'LLM si chiama anche su un gesto esplicito dell'utente, una ricetta per volta (`ARCHITECTURE §5.1`, paragrafo *Richiesta libera*).

### Decisioni della spec e dell'utente

| ID | Decisione |
|---|---|
| D2, D3 | **Proposta, poi salvataggio**: l'LLM propone, in libreria entra solo ciò che l'utente accetta; la proposta vive nel browser (nessuna bozza nel DB, nessuna migrazione) |
| D4 | **Una proposta per richiesta**, con *Un'altra* che rimanda i titoli già proposti nella sequenza |
| D6, U2 | Sulla card del piano **tre azioni** nell'ordine *Cambia* · *Scegli* · ★; dopo un cambio *Tieni* · 🔍 · *Cambia ancora* |
| D7, D8 | Una richiesta esplicita e una scelta a mano rispettano **diete ed elettrodomestici** ma **ignorano gli ingredienti «non mi piace»**; il sorteggio continua a escluderli |
| D9 | Nel selettore il tap apre **prima il dettaglio**, con *Metti nel piano* |
| D10 | Una ricetta già in un altro pasto della settimana resta selezionabile, con l'etichetta *Già nel piano* |
| D11 | Nessun controllo di **somiglianza** (`pg_trgm`) sulle ricette chieste: solo il titolo identico (normalizzato) è un doppione |
| D12 | `planner` e `plans` restano **senza LLM** |
| U1 | I test usano **fixture scritte a mano** (`tests/fixtures/llm/request-lasagne.txt`, `request-lasagne-altra.txt`); `pnpm llm:record` riceve `--request`; la registrazione reale è una verifica manuale di chiusura |
| U3 | Dal selettore, ricetta **salvata ma non assegnata** per un errore che non riguarda il piano: toast, la proposta si chiude, il selettore resta aperto e ricarica l'elenco |

Le decisioni di planning P1–P29 sono in `docs/planning/feature/feature-9/requirements.md`; quelle che fissano la forma del codice sono citate nelle pagine delle entità.

## Architettura del Flusso

```
[ /libreria ]                                   [ / (Piano) ]
LibraryScreen                                   PlanScreen → PlanSlotCard
 ├ RecipeRequestBox (≥ 3 caratteri)              ├ MealCard: Cambia · Scegli · ★
 └ RecipeProposalSheet                           └ SlotRecipePicker (montato solo da aperto)
     acceptLabel "Aggiungi alla libreria"            ├ elenco candidate + ricerca + RecipeRequestBox
                                                     ├ RecipeDetailSheet + primaryAction "Metti nel piano"
                                                     └ RecipeProposalSheet, acceptLabel "Metti nel piano"
        │ lib/library/client.ts                          │ lib/library/client.ts · lib/plans/client.ts
        ▼                                                ▼
+───────────────────────────────────────────────────────────────────────────+
| POST /api/recipes/propose  → proposeRecipe       (lib/recipes/propose.ts) |
| POST /api/recipes          → saveProposedRecipe  (lib/recipes/propose.ts) |
| GET  /api/plans/:id/slots/:slotId/candidates → listSlotCandidates         |
| PUT  /api/plans/:id/slots/:slotId/recipe     → assignSlotRecipe           |
+───────────────────────────────────────────────────────────────────────────+
        │                                                │
        ▼                                                ▼
 lib/llm: generateRecipeFromRequest              lib/plans/service.ts (nessun import nuovo
 lib/recipes/constraints.ts (findConstraintViolations)   da lib/llm o lib/recipes)
 lib/recipes/store.ts: insertGeneratedRecipe     lib/domain/planner.ts: manualChoiceExclusionReason
 sotto acquireRecipeGenerationLock               sotto acquirePlanLock, stato riletto
```

Sequenza dal Piano con richiesta all'LLM: `POST /api/recipes/propose` (con `meal_type` dello slot) → `POST /api/recipes` → `PUT …/slots/:slotId/recipe`. Ogni passo è una richiesta separata; se l'assegnazione fallisce la ricetta resta in libreria (U3).

## Moduli e Componenti Introdotti o Modificati

### 1. Dominio puro (`lib/domain/`)
- [[domain-types]]: blocco `Recipe Requests & Manual Slot Choice (Feature 9)` in coda a `types.ts`: `RECIPE_REQUEST_MIN`, `PROPOSAL_EXCLUDE_MAX`, `ProposeRecipeRequestSchema`, `RecipeProposalSchema`, `SavedRecipeInputSchema` con i tetti `SAVED_RECIPE_*`, `SaveRecipeRequestSchema`, `SaveRecipeResultSchema`, `AssignSlotRecipeRequestSchema`, `SlotCandidatesSchema`.
- [[planner]]: `manualChoiceExclusionReason(recipe, meal, household)`, unica definizione di "adatta a questo pasto" per la scelta a mano.
- [[library-service]]: `recipeRequestText(query)` e `appendProposedTitle(titles, title)` in `lib/domain/library.ts`.

### 2. Dati (`lib/db/`)
- [[recipe-repo]]: `listRecipeTitleRefs(executor, householdId)` (id e titolo, per `duplicate_of`). Nessuna migrazione, nessuna modifica a `lib/db/schema.ts`.

### 3. LLM, servizi, API e trasporto
- [[llm-adapter]]: `generateRecipeFromRequest`, prompt `buildRecipeRequestPrompt` con i delimitatori `<<<RICHIESTA` / `RICHIESTA>>>`, funzione privata `runRecipeGeneration` condivisa con `generateRecipes`, opzione `--request` di `pnpm llm:record`.
- [[recipe-proposal-service]]: `lib/recipes/{propose,store,errors,http}.ts`, `proposeRecipe`, `saveProposedRecipe`, `insertGeneratedRecipe`, `RecipeError`, rotte `POST /api/recipes/propose` e `POST /api/recipes`.
- [[recipe-generation]]: l'inserimento è estratto in `insertGeneratedRecipe` (`lib/recipes/store.ts`), senza cambiare la generazione a lotti; `lib/recipes/index.ts` non è cambiato.
- [[plan-service]]: `listSlotCandidates`, `assignSlotRecipe`, codici `recipe_not_found` (404) e `recipe_not_eligible` (422), rotte `GET …/candidates` e `PUT …/recipe`, client `fetchSlotCandidates` e `requestAssignSlotRecipe`.
- [[library-service]]: client `requestRecipeProposal` (con `AbortSignal`) e `requestSaveRecipe`.
- [[http-helpers]]: nessuna modifica; nuovi usi di `readJsonBody`, `invalidRequestResponse`, `llmErrorResponse` e di `signal` in `requestJson`.

### 4. Interfaccia
- [[sheet-primitive]]: pila delle sheet aperte (Esc solo sulla sheet in cima, scroll del `body` sbloccato a pila vuota), altezze in `dvh`.
- [[recipe-sheet]]: proprietà `placeholder`, `notice`, `footer`; `proposalToRecipeDetail`; altezze in `dvh`.
- [[recipe-detail-sheet]]: `primaryAction` facoltativa (*Metti nel piano*).
- [[recipe-proposal-sheet]]: `RecipeRequestBox` e `RecipeProposalSheet`, gli stessi in Libreria e nel selettore.
- [[slot-recipe-picker]]: `SlotRecipePicker`, il selettore del Piano.
- [[meal-card]]: `onPick` e il pulsante *Scegli*.
- [[plan-screen]]: `PlanSlotCard` monta il selettore, *Scegli* nella riga di revisione, focus `pick`; `PlanScreen` passa `applyRecipePrefs` e `router.refresh()`.
- [[library-screen]]: riquadro e sheet di proposta, nuova card senza ricaricare; `RecipeCard` con `badge` e ★ facoltativa.

## Regole di Dominio Principali

- **Richiesta valida**: testo senza spazi ai bordi, da `RECIPE_REQUEST_MIN` (3) a `LIBRARY_QUERY_MAX` (100) caratteri. Il riquadro compare solo con una richiesta valida (`recipeRequestText`), sia con risultati sia con *Nessuna ricetta trovata*; con la libreria vuota non c'è campo di ricerca e quindi nessuna richiesta. I chip di filtro della Libreria non entrano nella richiesta.
- **Vincoli di una richiesta**: persone, tipo di pasto (solo dal Piano), diete, elettrodomestici. Niente stile preferito, ingredienti graditi o scartati, titoli della libreria (`buildConstraints(household, mealType, { meal_style_tags: [] })` senza preferenze ingrediente).
- **Proposta non adatta**: una proposta che viola diete, elettrodomestici o (dal Piano) il tipo di pasto non arriva al client: `422 proposal_unsuitable`, senza secondo tentativo. Le violazioni si scrivono nel log del server con `console.warn` (innesto R2).
- **Doppione**: titolo normalizzato (`normalizeTitle`) uguale a una ricetta dell'household. Alla proposta valorizza `duplicate_of` (la sheet mostra l'avviso e nasconde l'azione primaria); al salvataggio dà `409 recipe_duplicate`. La somiglianza trigram non conta (D11).
- **Salvataggio**: il client non è una fonte fidata. La rotta valida il corpo, lo normalizza (`normalizeGeneratedRecipe`) e lo rivalida con `SavedRecipeInputSchema` (tetti su testi e liste, fix della code review). Il servizio, sotto `acquireRecipeGenerationLock`, rilegge l'household e ricontrolla diete ed elettrodomestici (`422 recipe_unsuitable`), poi il doppione; scrive con `source: 'llm'`.
- **Adatta a un pasto** (scelta a mano): non bloccata, con quel tipo di pasto, con tutte le diete dell'household, con soli elettrodomestici disponibili (`manualChoiceExclusionReason`). Gli ingredienti «non mi piace» e la presenza in un altro pasto **non** escludono.
- **Assegnazione**: transazione sotto `acquirePlanLock`, sullo stato riletto. Ordine dei controlli: piano (`plan_not_found`, `plan_archived`) → slot (`slot_not_found`, `slot_locked`, `slot_past`) → ricetta dell'household (`recipe_not_found`) → idoneità (`recipe_not_eligible`) → ricetta già nello slot (risposta senza scritture). Effetti come lo swap: `incrementRecipeUsage` sul piano confermato, `markShoppingListStale`. Nessun `rng`, nessuna chiamata LLM.
- **Candidate**: stessi controlli di piano e slot dello swap; ricette adatte tranne quella dello slot, nell'ordine della Libreria; `in_plan_recipe_ids` = ricette degli altri slot del piano (giorni passati compresi), senza doppioni.
- **Annullamento**: chiudere la sheet di proposta interrompe la `fetch` (`AbortController`); la rotta passa `request.signal` all'adapter e, se il client ha chiuso, risponde `499` senza log (innesto R1).

## Innesti delle Review

**Architecture review 2026-10-14** (`docs/planning/feature/feature-9/architecture-review-2026-10-14.md`): nessun problema bloccante.
- **R1**: chiusura della sheet trattata come annullamento, non come timeout: `499` senza log in `POST /api/recipes/propose` ([[recipe-proposal-service]]).
- **R2**: motivo di `proposal_unsuitable` e `recipe_unsuitable` nel log (`console.warn` con le violazioni).
- **R3**: `dvh` al posto di `vh` nel selettore, in `RecipeSheet` e nella primitiva `Sheet`.
- **R4**: nessun portale; commento in `plan-screen.tsx` sulla regola "nessun antenato delle card in `opacity`, `transform` o `filter` a riposo", da cui dipende il selettore montato dentro la card ([[plan-screen]]).
- **R5**: nel selettore un `recipe_duplicate` al salvataggio chiude la proposta, mostra il toast e ricarica le candidate (scostamento da FR-8 confermato dall'utente il 2026-10-14; in Libreria FR-8 resta: la sheet resta aperta).
- **R6**: asserzioni di confine `Schema.parse(JSON.parse(JSON.stringify(…)))` sui tre schemi di risposta nuovi e parità tra `findConstraintViolations` e `manualChoiceExclusionReason` per una ricetta appena salvata.
- **R7**: tre letture complete della libreria per una scelta a mano, di cui una evitabile in `assignSlotRecipe`; rinviata (soglia: oltre 200 ricette o più di 300 ms sul Pi per aprire *Scegli*).

**Code review** (fix nel commit `9cf6948`; non c'è un file di review nella cartella della feature):
- `RecipeProposalSheet` ignora ✕, Esc e sfondo finché `onAccept` è in corso: l'esito tardivo di un salvataggio non può più chiudere o azzerare la proposta successiva, in Libreria e nel selettore.
- `POST /api/recipes` valida con `SavedRecipeInputSchema` (tetti su descrizione, passi, ingredienti, nomi e note, liste di etichette); `GeneratedRecipeSchema`, che è anche lo schema dell'output LLM, non è cambiato.

## Contratti Consegnati alle Feature Successive

- **Feature 8 (pacchetto iniziale di ricette)**: indipendente. Le ricette del dataset entrano nel selettore come le altre se hanno `meal_types`, `diet_flags` e `appliances_required` valorizzati. `insertGeneratedRecipe` scrive sempre `source: 'llm'` e **non** va usata per caricare il dataset.
- **Catalogo (v2, `v2-funzionalita.md` §1.1, §1.5)**: il selettore è il punto in cui aggiungere la ricerca nel catalogo; `RecipeRequestBox` è il punto d'ingresso di una richiesta; `proposeRecipe` resta la strada "inventare".
- **Segnale implicito (v2 §2.5)**: `assignSlotRecipe` è il punto in cui registrare che una ricetta è stata scelta a mano; oggi non lo registra.
- **Deploy**: nessuna migrazione, nessuna variabile d'ambiente, nessun cambiamento a `docker-compose` o `scripts/deploy.sh`.
- **Documenti di progetto allineati dalla feature (WP11)**: `ARCHITECTURE §5.1` (*Richiesta libera*), `§5.3` (*Scelta a mano*), `§5.4` (lo scarto vale per il sorteggio), `§6` (quattro rotte, errori, durata); `DESIGN §3` (tre azioni), `§4.1`, `§4.4`, `§5`; `v2-funzionalita.md` §1.2 e §2.3.

## Punti Aperti e Limiti Noti

- **Verifiche manuali non ancora fatte** (`requirements.md` §5): prova da telefono a 360 px (tre azioni della card su una riga e mai sotto i 44 px, riga *Tieni* · 🔍 · *Cambia ancora*, scorrimento e chiusura di selettore e proposta, footer visibile mentre si scorre, toast sopra le sheet, posizione dell'elenco ritrovata chiudendo il dettaglio); una registrazione reale con `pnpm llm:record --request` (in `tests/fixtures/llm/recorded/` non c'è ancora una richiesta libera); la prova che chiudere la sheet interrompa davvero la chiamata al modello.
- **`request.signal` in Next standalone**: è il primo uso lato server di `request.signal`. Se Next non lo annulla alla disconnessione, la chiamata al modello continua fino in fondo; `ARCHITECTURE §6` afferma che viene interrotta, ma la cosa non è stata verificata (review R1).
- **Doppia richiesta in sviluppo**: con React StrictMode l'effetto di apertura della proposta gira due volte, quindi in `pnpm dev` partono due `POST /api/recipes/propose` per apertura, la prima annullata subito. In produzione non succede.
- **`duplicate_of` di una ricetta non selezionabile**: il controllo del doppione guarda tutte le ricette dell'household, bloccate comprese e di qualunque pasto. Dal selettore, se il doppione è bloccato o non adatto al pasto, la ricetta esistente non compare tra le candidate, mentre FR-7.4 dice che "si trova cercandola nel selettore".
- **Letture complete della libreria**: candidate, dettaglio e assegnazione leggono ciascuno l'intera libreria (R7, v. sopra).
- **Focus**: i componenti nuovi riportano il focus sul controllo che ha aperto la sheet (*Scegli*, pulsante di richiesta) o sul titolo della Libreria dopo un salvataggio (req. P22); la primitiva `Sheet` continua a non spostare il focus all'interno all'apertura né a trattenerlo. La spec §5 chiedeva "focus gestito all'apertura e alla chiusura delle sheet": l'apertura resta debito noto.
- **Due stili di import nel modulo `recipes`**: `@/lib/recipes` per la generazione, `@/lib/recipes/propose` per il resto (req. P1: il barrel non cambia perché i test esistenti lo sostituiscono elencando solo `generateAndStoreRecipes`).
- **Origine sempre `llm`**: `POST /api/recipes` non distingue l'origine; servirà con l'inserimento a mano (v2 §1.3, §1.4).
- **Nessun portale nelle sheet**: il selettore, il suo dettaglio e la proposta sono `fixed` dentro la card; durante una navigazione il contenitore delle card ha `opacity-60` e la sheet diventa semitrasparente, con la tab bar (`z-40`) sopra la striscia in basso. Raro e breve (R4).
- Fuori ambito per decisione (spec §6): più proposte per richiesta, modifica della proposta, eliminazione di ricette, ricerca "intelligente", chip di filtro nel selettore, richiesta con la libreria vuota, secondo tentativo automatico, riconoscimento delle richieste che non descrivono un piatto, avviso sulle ricette con un ingrediente scartato.

## Strategia di Test

La suite conta **94 file di test e 1399 casi** (84 file alla fine della Feature 7), tutti verdi nel gate del 14 ottobre 2026 dopo i fix della code review. Nuovi file:
- dominio puro: `tests/domain/request-contracts.test.ts` (i cinque schemi di richiesta e risposta); casi aggiunti in `tests/domain/library.test.ts` (`recipeRequestText`, `appendProposedTitle`) e `tests/domain/planner.test.ts` (`manualChoiceExclusionReason`);
- LLM: casi aggiunti in `tests/llm/{adapter,prompts}.test.ts` con le fixture a mano `tests/fixtures/llm/request-lasagne.txt` e `request-lasagne-altra.txt` (U1);
- DB reale con LLM iniettato: `tests/recipes/propose.test.ts` (18 casi: proposta senza scritture, vincoli, doppione, segnale passato all'adapter, salvataggio, doppione con spaziatura diversa, nessun controllo di somiglianza, `recipe_unsuitable`, parità con il planner, due salvataggi sovrapposti, stesso titolo in due household con slug distinti);
- DB reale: `tests/plans/assign.test.ts` (16 casi: candidate, ordine, `in_plan_recipe_ids`, controlli di piano e slot, assegnazione su bozza e su piano confermato con lista, ingrediente scartato ammesso, ricetta già in un altro slot, rifiuti, richiesta ripetuta senza scritture, household riletto sotto lock, assegnazioni sovrapposte);
- rotte con servizio sostituito: `tests/api/{recipes-propose,plans-assign}.test.ts`, casi aggiunti in `tests/api/recipes.test.ts` (`POST`);
- client: casi aggiunti in `tests/library/client.test.ts` e `tests/plans/client.test.ts`;
- UI (jsdom): `tests/ui/{sheet-stack,recipe-card,recipe-request-box,recipe-proposal-sheet,slot-recipe-picker}.test.tsx`; casi aggiunti in `tests/ui/{library-screen,meal-card-plan,plan-screen,plan-slot-card,recipe-detail-sheet,recipe-sheet}.test.tsx` e `tests/ui/recipe-detail.test.ts`.

Come da regola del piano (0.3.6), i test esistenti restano verdi senza modificarne le attese su *Cambia*.

## Vedi anche

- [[recipe-proposal-service]] — Proposta e salvataggio di una ricetta chiesta, rotte e errori
- [[slot-recipe-picker]] — Selettore del Piano
- [[recipe-proposal-sheet]] — Riquadro di richiesta e sheet di proposta
- [[sheet-primitive]] — Pila delle sheet aperte
- [[plan-service]] — Candidate e assegnazione
- [[llm-adapter]] — Prompt e funzione della richiesta libera
- [[library-screen]] — Libreria con la richiesta all'LLM
- [[plan-screen]] — Card del Piano con *Scegli*
- [[plan-concurrency-pattern]] — Assegnazione sotto il lock dei piani
- [[e1-motore-ricette]] — Feature 2: la generazione da cui la richiesta riusa adapter e scrittura
- [[e2-libreria-preferenze]] — Feature 5: Libreria, dettaglio e preferenze
- [[e3-pianificatore]] — Feature 4: Piano, swap e card
