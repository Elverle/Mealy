# Feature 9 — Ricette su richiesta (LLM) e cambio con scelta dalla libreria: Requisiti e Decisioni

Memoria del "perché" dietro `plan.md`. Spec: `spec.md` di questa cartella (brainstorming del 13 ottobre 2026), con le decisioni D1–D12 recepite come definitive. Riferimenti: `docs/ARCHITECTURE.md §1.3, §5.1–§5.4, §6, §7`, `docs/DESIGN.md §3, §4.1, §4.4, §5, §6`, `docs/v2-funzionalita.md §1.2, §2.3`, `docs/planning/execution-strategy.md §4` (contratti trasversali), wiki `plan-concurrency-pattern`.

## 1. Layout e identità

- **Layout**: `docs/planning/` (da `.claude/agentic-feature-factory.local.md`), cartella `docs/planning/feature/feature-9/`.
- **Titolo**: Feature 9 — Ricette su richiesta (LLM) e cambio con scelta dalla libreria.
- **Prerequisiti**: Feature 1–7 in `main` (v0.6.1, commit `bff5cda`). Indipendente dalla Feature 8. Vale "il codice reale vince".
- **Non è nel backlog** né in `execution-strategy.md`: l'unica fonte dei requisiti è `spec.md`.

## 2. Decisioni prese con l'utente (2026-10-14)

| # | Decisione | Motivo |
|---|---|---|
| U1 | **I test usano fixture scritte a mano** in `tests/fixtures/llm/` (due risposte per la richiesta libera, testo nel piano). `pnpm llm:record` riceve l'opzione `--request`; una registrazione reale la fa l'utente a fine sviluppo, come verifica manuale archiviata in `tests/fixtures/llm/recorded/` | Gli Implementer lavorano senza rete e senza chiave. È già così oggi: nessun test legge `recorded/`, tutti leggono le fixture a mano (`valid-2-recipes.txt`, `generation-mixed.txt`). Corregge la spec §5, che parlava di una risposta registrata |
| U2 | **Ordine delle azioni sulla card: *Cambia* · *Scegli* · ★**. *Cambia* resta primo a sinistra in `tomato`, *Scegli* accanto in colore neutro, ★ a destra. Dopo un cambio: *Tieni* · 🔍 (solo icona) · *Cambia ancora* | Nessuna abitudine da reimparare: *Cambia* e ★ restano dove sono |
| U3 | Dal selettore, se la ricetta chiesta all'LLM viene **salvata ma non assegnata** per un errore che non riguarda lo stato del piano (rete, errore interno): toast di FR-7.3, la sheet di proposta si chiude, **il selettore resta aperto e ricarica l'elenco** | La ricetta appena salvata è nell'elenco: si rimette nel piano con un tap sul dettaglio, senza riaprire *Scegli* |

## 3. Decisioni prese in planning (motivate)

| # | Decisione | Motivo |
|---|---|---|
| P1 | Nuovi file del modulo `recipes`: `lib/recipes/errors.ts`, `http.ts`, `store.ts`, `propose.ts`. **`lib/recipes/index.ts` non cambia**: le rotte nuove importano dai file | I test esistenti sostituiscono il barrel con `vi.mock('@/lib/recipes', …)` elencando solo `generateAndStoreRecipes`: allargarlo li romperebbe |
| P2 | Errori del modulo come classe `RecipeError` con tre codici e mappa HTTP | Stessa forma di `PlanError` e `ShoppingError`; tre codici di dominio la giustificano |
| P3 | L'inserimento di una ricetta generata diventa `insertGeneratedRecipe` in `lib/recipes/store.ts` (slug univoco + `insertRecipeWith`), usata da `generateAndStoreRecipes` e da `saveProposedRecipe` | Spec §4.4: un solo percorso di scrittura, senza cambiare la generazione a lotti |
| P4 | `generateRecipeFromRequest` e `generateRecipes` condividono una funzione privata dell'adapter (chiamata, riparazione, timeout, errori). Lo schema di output resta `GenerateRecipesOutputSchema` (`{ recipes: […] }`): si chiede una ricetta e si prende la prima | Spec §4.3. Un secondo schema di output vorrebbe dire una seconda chiamata di riparazione e fixture con un'altra forma |
| P5 | Nel prompt la richiesta sta tra i delimitatori `<<<RICHIESTA` e `RICHIESTA>>>`, con gli spazi (a capo compresi) ridotti a uno e le sequenze `<<<` e `>>>` tolte dal testo | Spec §5 (sicurezza): il testo è un dato, non può chiudere il delimitatore né aggiungere righe al prompt |
| P6 | La rotta `POST /api/recipes/propose` passa `request.signal` all'adapter | Chiudere la sheet annulla la `fetch`: così si interrompe anche la chiamata al modello, che altrimenti continuerebbe a costare senza nessuno ad aspettarla |
| P7 | Per `duplicate_of` serve l'id oltre al titolo: nuova lettura `listRecipeTitleRefs` in `recipe-repo.ts` | `listRecipeTitles` restituisce solo i titoli; caricare tutta la libreria con gli ingredienti per un confronto di titoli sarebbe sprecato |
| P8 | La rotta `POST /api/recipes` valida il corpo, lo **normalizza** con `normalizeGeneratedRecipe` e lo **rivalida** (400 se dopo la normalizzazione non è più valido). Risposta `201 { recipe }` con il nuovo schema `SaveRecipeResultSchema` (non era nella tabella della spec §4.2) | Il client non è una fonte fidata (spec §5). Lo schema della risposta serve a `requestJson`, che valida ogni corpo 2xx |
| P9 | La regola di idoneità è `manualChoiceExclusionReason(recipe, meal, household)` in `lib/domain/planner.ts`: `exclusionReason` con preferenze ingredienti vuote e nessuna esclusione per id | Spec §4.5: una sola definizione di "adatta a questo pasto", usata da elenco e assegnazione |
| P10 | `assignSlotRecipe` trova la ricetta rileggendo la libreria nella transazione con `listRecipesWith` (come lo swap), senza una nuova funzione di repository | `getRecipeById` non accetta una transazione. Così WP5 e WP6 restano su file disgiunti (`recipe-repo.ts` lo tocca solo WP5) |
| P11 | Ordine dei controlli in `assignSlotRecipe`: piano → slot (`slot_not_found`, `slot_locked`, `slot_past`) → ricetta dell'household (`recipe_not_found`) → idoneità (`recipe_not_eligible`) → ricetta già nello slot (nessuna scrittura) | Spec §4.5. L'idoneità prima del "già nello slot" è innocua: una richiesta ripetuta trova la ricetta ancora adatta |
| P12 | `in_plan_recipe_ids` contiene le ricette di **tutti gli altri slot** del piano (giorni passati compresi), senza doppioni | "Già nel piano" vale per l'intera settimana mostrata |
| P13 | Client: `requestRecipeProposal` e `requestSaveRecipe` in `lib/library/client.ts`, `fetchSlotCandidates` e `requestAssignSlotRecipe` in `lib/plans/client.ts`. Una richiesta annullata arriva al chiamante come `network_error`: chi annulla controlla `signal.aborted` e ignora l'esito | Spec §4.7. `requestJson` non distingue l'annullamento dalla rete assente e non va cambiato per un solo chiamante |
| P14 | **Sheet impilate**: il selettore resta montato e il dettaglio (o la proposta) gli si apre sopra. `components/ui/sheet.tsx` tiene una pila delle sheet aperte: Esc chiude solo quella in cima e lo scroll della pagina si sblocca solo quando la pila è vuota | FR-6.2 (tornare all'elenco ritrovando testo e posizione) si ottiene gratis se l'elenco non viene smontato. Oggi Esc chiuderebbe entrambe le sheet e la chiusura della seconda sbloccherebbe lo scroll sotto la prima |
| P15 | `RecipeSheet` riceve tre proprietà facoltative: `placeholder` (titolo e contenuto al posto dello scheletro), `notice` (avviso sotto l'intestazione), `footer` (azioni sempre visibili in fondo). La sheet di proposta è una macchina a stati sopra `RecipeSheet`, non una seconda presentazione | Spec §4.7 ("riusando la parte di presentazione"). Attesa, errore e proposta restano nello stesso pannello: l'animazione d'ingresso non riparte a ogni cambio di stato |
| P16 | `proposalToRecipeDetail(recipe, servings)` in `components/sheets/recipe-detail.ts` converte un `GeneratedRecipe` nella vista della sheet, con id `proposal:<titolo>` | Una proposta non ha id né preferenze. L'id diverso per ogni proposta riallinea le porzioni quando arriva *Un'altra* |
| P17 | `RecipeDetailSheet` riceve `primaryAction` facoltativa (`{ label, onAction, busy }`) e la passa come `footer` | Spec §4.7: senza l'azione il dettaglio resta identico a oggi in Libreria e nel Piano |
| P18 | `MealCard` riceve `onPick`; `RecipeCard` rende facoltativa `onToggleFavorite` (senza: una ★ non interattiva sulle preferite) e riceve `badge` | FR-4.1, FR-5.3, FR-5.5. Aggiunte compatibili: chi non le passa non cambia |
| P19 | **Il selettore vive dentro `PlanSlotCard`** (montato solo da aperto). `PlanSlotCard` riceve `onRecipePrefsChange` e `onPlanStale`; `PlanScreen` passa `applyRecipePrefs` e `() => router.refresh()` | La card possiede già modalità, sequenza degli scarti e gestione del focus che l'assegnazione deve azzerare (FR-6.3). `router.refresh()` rilegge il piano con il meccanismo `syncedInitialScreen` che c'è già |
| P20 | Codici che indicano un **piano non più modificabile**: `slot_locked`, `slot_past`, `plan_archived`, `plan_not_found`, `slot_not_found`. Su *Metti nel piano*: toast, chiusura delle sheet, rilettura del piano. `recipe_not_eligible` e `recipe_not_found`: toast, ritorno all'elenco ricaricato. Ogni altro errore: toast, il dettaglio resta aperto | FR-8. I due codici 404 si comportano come gli altri tre perché indicano uno slot sparito (rigenerazione in un'altra scheda) |
| P21 | Se il caricamento delle candidate fallisce, il selettore mostra il messaggio dell'errore con *Riprova*, qualunque sia il codice | FR-5.8. Uno slot bloccato nel frattempo dà `slot_locked` con il suo messaggio, che già dice cosa fare |
| P22 | **Focus gestito dai componenti nuovi**, non dalla primitiva `Sheet`: alla chiusura del selettore torna su *Scegli* (meccanismo `pendingFocus` di `PlanSlotCard`); in Libreria torna sul pulsante di richiesta, oppure sul titolo della pagina dopo un salvataggio. Il campo di ricerca del selettore **non** prende il focus all'apertura | Spec §5. Un ripristino generico nella primitiva cambierebbe il comportamento di tutte le sheet esistenti. Il focus automatico sul campo aprirebbe la tastiera del telefono sopra l'elenco |
| P23 | In Libreria la nuova card si aggiunge allo stato del client con `toLibraryCard` sulla ricetta restituita dal salvataggio | FR-3.2 ("senza ricaricare la pagina"); l'ordinamento lo rifà `filterLibraryCards` |
| P24 | La sequenza di *Un'altra* è tenuta dal client con `appendProposedTitle` (ultimi `PROPOSAL_EXCLUDE_MAX` titoli distinti) e riparte da zero a ogni nuova richiesta | D3: la proposta non è salvata sul server, quindi nemmeno la sua storia |
| P25 | Ogni titolo in `exclude_titles` ha al più 120 caratteri (il massimo di `GeneratedRecipeSchema.title`) | Limita il testo che dal client arriva nel prompt: 10 × 120 caratteri |
| P26 | Con `meal_type` assente il prompt chiede di indicare in `meal_types` i pasti per cui il piatto è adatto | FR-1.4: il tipo di pasto lo decide l'LLM |
| P27 | Nessuna variante di `findConstraintViolations`: `proposeRecipe` e `saveProposedRecipe` costruiscono i vincoli con `buildConstraints` senza preferenze ingredienti e con `meal_style_tags` vuoto | Spec §4.4: con `ingredient_dislikes` vuoto il controllo sugli ingredienti non scatta (D7) |
| P28 | **Quattro wave, undici work package**. I client fetch stanno nella wave 1 con i contratti; riquadro e sheet di proposta in wave 2; Libreria e selettore in wave 3; card del Piano e documenti in wave 4 | Nessun WP importa un file creato da un altro WP della stessa wave. Pacchetti piccoli perché gli Implementer sono di fascia bassa (`models.claude.implementer: haiku`) |
| P29 | `ARCHITECTURE.md`, `DESIGN.md` e `v2-funzionalita.md` li aggiorna un WP dedicato (WP11); la wiki resta a `/feature-docs` | Come nelle feature precedenti; un solo WP tocca ogni documento |

## 4. Scostamenti dalla spec

| Punto della spec | Cosa cambia | Decisione |
|---|---|---|
| §5 "risposta registrata in `tests/fixtures/llm/recorded/`" | I test leggono fixture a mano in `tests/fixtures/llm/`; la registrazione reale è una verifica manuale | U1 |
| §4.2, tabella degli schemi | Si aggiunge `SaveRecipeResultSchema` | P8 |
| §4.4 "Recipe con ingredienti" | `saveProposedRecipe` restituisce `RecipeWithDetails`, il tipo già usato dal repository | P3 |
| §7.4 "verificato con risposte registrate" | Verificato con le due fixture a mano | U1 |

## 5. Da verificare a mano (non verificabile in jsdom)

- Prova da telefono a 360 px (criterio 15 della spec): le tre azioni della card su una riga, senza andare a capo e mai sotto i 44 px; riga *Tieni* · 🔍 · *Cambia ancora* su una riga; il selettore e la sheet di proposta scorrono e si chiudono; il footer con le azioni della proposta resta visibile mentre si scorre; il toast è leggibile sopra le sheet; chiudendo il dettaglio si ritrova l'elenco nella stessa posizione.
- Una richiesta reale: `pnpm llm:record --name <provider>-richiesta-lasagne --request "lasagne al pesto"` con la chiave in `.env.local`, e una prova dall'app (Libreria e Piano) con il modello configurato.
- Chiudere la sheet durante l'attesa e controllare nei log del server che la chiamata al modello si interrompa (P6).
