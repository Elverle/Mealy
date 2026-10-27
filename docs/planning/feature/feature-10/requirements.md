# Feature 10 — Pacchetto iniziale di ricette: Requisiti e Decisioni

Memoria del "perché" dietro `plan.md`. Spec: `spec.md` di questa cartella (brainstorming del 22–23 ottobre 2026), con le decisioni D1–D12 recepite come definitive. Riferimenti: `docs/ARCHITECTURE.md §1.3, §5.2, §7`, `docs/DEPLOY.md §5, §9`, `docs/rework-catalogo.md`, `../feature-8/plan.md` ("Contratti consegnati").

## 1. Layout e identità

- **Layout**: `docs/planning/` (da `.claude/agentic-feature-factory.local.md`), cartella `docs/planning/feature/feature-10/` (esisteva già con `brainstorm-prompt.md` e `spec.md`).
- **Titolo**: Feature 10 — Pacchetto iniziale di ricette.
- **Prerequisiti**: Feature 1–9 in `main` (v0.8.0, commit `dfa16a6`). Vale "il codice reale vince".
- **Non è nel backlog** né in `execution-strategy.md`: l'unica fonte dei requisiti è `spec.md`. Segue la Feature 11 (composizione del pasto).

## 2. Decisioni prese con l'utente (brainstorming, 22–23 ottobre 2026)

| # | Decisione | Motivo |
|---|---|---|
| U1 | **Pacchetto nel repository, caricato all'avvio per titolo, senza modifiche allo schema** (approccio 1 della spec) | Nessun passo manuale sul Raspberry, pacchetto validato in CI; la tabella che segna il caricamento serve solo quando esisterà la cancellazione delle ricette |
| U2 | **200 ricette**: 50 primi, 50 secondi, 40 piatti unici, 60 contorni | Scelta dell'utente tra 120, 150 e 200 |
| U3 | **Diete per regola da una tabella degli ingredienti rivista dall'utente** | Le diete sono filtri vincolanti: niente modello, niente parole chiave |
| U4 | **Nessun link all'originale nel repository**; solo nei file di lavoro | Nessun campo nuovo; il link serve solo a controllare la conversione |
| U5 | **Il repository potrà diventare pubblico**: si accettano le salvaguardie della spec (passi e descrizione scritti da capo, controllo delle 8 parole consecutive, nessun riferimento al sito) | Domanda dell'utente del 23 ottobre 2026; il CSV non è mai stato committato |
| U6 | **Circa 300 titoli da rivedere** (⌈1,5 × quota⌉ spuntati per gruppo) più le riserve fino al doppio della quota | Un titolo tolto non lascia buchi; le riserve evitano un secondo giro di `select` |

## 3. Decisioni di planning (prese leggendo codice e spec)

| # | Decisione | Motivo |
|---|---|---|
| P1 | **Otto work package in cinque wave**: WP1 da solo (contratti, regole pure, file vuoti del pacchetto, opzione `source`); poi WP2 (parser e selezione), WP3 (adapter LLM), WP6 (caricatore e avvio), WP8 (documenti) in parallelo; poi WP4 (conversione e controlli); poi WP5 (tabella e costruzione); infine WP7 (comando e smoke). La preparazione vera del pacchetto è un passo di chiusura dell'orchestratore con l'utente | I contratti condivisi vanno in un colpo solo a gate verde. Conversione e costruzione dipendono da parser, selezione e adapter. Il comando importa tutti i moduli. Il pacchetto vero richiede la chiave del modello e la revisione dell'utente |
| P2 | **Tutti i tipi nuovi in `lib/domain/types.ts`**, compresi quelli che servono solo agli strumenti (candidati, record di conversione, lettura delle quantità) | Regola di architettura: unica fonte dei tipi. Esiste già il precedente di `ClassifyRecipeItem` |
| P3 | **`RecipePackFileSchema` non controlla l'unicità dei titoli**; lo fanno `build` e il test del file | `normalizeTitle` sta in `recipe-text.ts`, che importa `types.ts`: importarla nello schema creerebbe un ciclo. Corregge spec §4.1 |
| P4 | **Soglia di similarità dei titoli: strettamente maggiore di 0,6**, come `findSimilarRecipeTitle` (`similarity(...) > threshold`) | Corregge il "≥ 0,6" della spec: la misura offline deve dare lo stesso verdetto del DB |
| P5 | **`titleSimilarity` in un modulo puro nuovo `lib/domain/title-similarity.ts`**, con la costante `SIMILAR_TITLE_THRESHOLD = 0.6` | Il dominio non importa da `lib/db/`; il commento lega la costante a `TITLE_SIMILARITY_THRESHOLD` di `recipe-repo.ts` |
| P6 | **`deriveDietFlags` in `lib/domain/diet-rules.ts`**, con la tabella passata come `Map` | Regola pura, testabile, usata da `build` e dal test del file. Un nome senza voce lancia un errore |
| P7 | **Gli strumenti stanno in `lib/recipes/pack/`, divisi in `paths`, `errors`, `dataset`, `select`, `checks`, `convert`, `report`, `ingredients`, `build`, `load`**; solo `load.ts` entra nel bundle dell'app; nessun modulo degli strumenti importa `@/lib/db` | Il modulo `recipes` è il solo che parla con `lib/llm/`. Gli strumenti non devono aprire connessioni al DB |
| P8 | **Errori degli strumenti come `PackError`** (classe nuova in `lib/recipes/pack/errors.ts`) con il messaggio da stampare; il comando stampa il messaggio ed esce con 1 | Messaggi esatti testabili, un solo punto che decide l'uscita |
| P9 | **Percorsi dei file di lavoro costruiti con `/`** (`${workDir}/selection.md`) | Messaggi identici su Windows e Linux; Node accetta `/` anche su Windows |
| P10 | **Gli strumenti leggono e scrivono i file JSON con `fs` e li validano con gli schemi**; solo il caricatore e i test usano il modulo `fixtures/recipe-pack.ts` | L'import di un JSON è fisso al momento del caricamento del modulo, mentre `ingredients` e `build` riscrivono i file |
| P11 | **File iniziali vuoti** (`{"recipes": []}`, `{"ingredients": []}`) committati in WP1 | L'import nel bundle e il test delle invarianti funzionano prima del pacchetto vero; con il pacchetto vuoto l'avvio scrive `inserite: 0` |
| P12 | **Con il pacchetto vuoto il caricatore non apre transazioni e non crea l'household**, ma scrive comunque la riga di log | Lo smoke e i test di oggi non vedono un household creato all'avvio finché il pacchetto non c'è |
| P13 | **Il test che conta 200 ricette (e ≥ 60 contorni, ≥ 140 piatti da pasto) si aggiunge alla chiusura**, nello stesso commit del pacchetto vero (codice esatto nel piano) | Prima della chiusura il file è vuoto: un test sul conteggio sarebbe rosso, e un `skipIf` nasconderebbe un file svuotato per errore |
| P14 | **W3 (numero senza unità su un ingrediente da cucchiai) si valuta solo quando le righe di ingredienti si corrispondono** (stesso numero); altrimenti vale solo W2 | Serve la scelta del modello sulla stessa riga. Precisa la spec FR-1.5 |
| P15 | **Concorrenza della conversione per gruppo**: i gruppi si convertono uno dopo l'altro; dentro un gruppo partono al più `concurrency` chiamate, e mai più di quante ne servono per arrivare alla quota (accettate + in corso ≤ quota) | Nessuna chiamata sprecata oltre la quota, ordine deterministico per gruppo |
| P16 | **Le prime `quota` ricette accettate di ogni gruppo nell'ordine di `selection.md`** sono quelle che entrano nella tabella e nel pacchetto (`acceptedByGroup`, unico punto) | `ingredients` e `build` vedono lo stesso insieme |
| P17 | **Prompt di conversione con istruzioni proprie**; le righe comuni con `buildRecipeInstructions` (portate, etichette, elettrodomestici, reparti) si estraggono in costanti private di `prompts.ts` senza cambiare l'output di oggi | Un solo testo per regola. I test di `tests/llm/prompts.test.ts` restano verdi così come sono |
| P18 | **Temperature**: conversione 0,4 con riparazione 0,2; tabella 0,2 e 0,2 | Testo riscritto ma fedele; la tabella deve essere stabile |
| P19 | **Il secondo tentativo di conversione passa gli errori di E1–E3 nel prompt** (`feedback`), con un blocco finale «Il tentativo precedente è stato scartato…» | Spec FR-1.4 punto 5; stesso spirito di `buildRepairPrompt` |
| P20 | **Il caricatore scrive da solo la riga `[pack] …`** (dipendenza `logger`, default `console`), come `classifyPendingRecipes`; `instrumentation.ts` scrive solo `[pack] caricamento interrotto` | Il comando `load` e l'avvio stampano la stessa riga senza duplicare codice |
| P21 | **Il caricatore accetta `insert` iniettabile** per provare in un test che un errore a metà annulla tutto | Spec §7 punto 7; nessun altro modo pulito di far fallire un inserimento |
| P22 | **Lo smoke legge il numero atteso di ricette dal JSON con `node -e`** e ricontrolla il conteggio dopo il riavvio | Lo smoke gira dalla copia del repository (CI e PC), dove c'è Node; vale sia col pacchetto vuoto sia con quello vero |
| P23 | **`lib/recipes/index.ts` non esporta il modulo `pack`** | Il barrel è importato dalle rotte: il pacchetto (circa 700 KB di JSON) deve entrare solo dove serve |
| P24 | **Il CSV di prova dei test (`tests/fixtures/recipe-pack/sample.csv`) è scritto a mano con ricette inventate** | Il dataset non è in CI e non deve entrare nel repository |
| P25 | **Versione 0.9.0** proposta alla chiusura (`version_bump: ask`) | Feature nuova con un passo nuovo all'avvio |
| P26 | **Quote iniettabili (`quotas`) in `acceptedByGroup`, `runConvert`, `renderReport`, `runIngredients`, `runBuild`**, default `PACK_GROUP_QUOTAS`; il comando non le passa mai | Con quote fisse di 40–60 i test non potrebbero provare "fermarsi alla quota" o costruire un pacchetto completo senza centinaia di record |

## 4. Note e limiti accettati

- Quando la V2 introdurrà la cancellazione delle ricette, una ricetta del pacchetto cancellata tornerà al riavvio: servirà una tabella che segni il pacchetto come caricato (spec §6).
- La similarità dei titoli offline (`titleSimilarity`) toglie gli accenti, `pg_trgm` no: una differenza minima può far saltare all'avvio una ricetta in più, e la riga `[pack]` lo rende visibile.
- Le diete delle ricette sono vere quanto la tabella degli ingredienti rivista: un errore lì si corregge solo rifacendo `build` e un deploy, e vale solo per le ricette non ancora caricate.
- Con 140 piatti da pasto in più il modello genera raramente da solo (D10): le ricette nuove arrivano con lo swap e con le richieste della Feature 9.

## 5. Verifiche manuali di chiusura (dalla spec §7, punti 10–14)

1. Preparazione vera del pacchetto con l'utente (passi C1–C6 del piano).
2. Controllo a campione di 10 ricette.
3. `docker build` + `scripts/smoke-prod.sh`.
4. Stack di produzione locale senza chiave del modello: primo piano completo con `generation.rounds` = 0.
5. Raspberry dopo il deploy e prova da telefono a 360 px. **Fatta il 27 ottobre 2026** dall'utente, dopo il deploy di `f991e6e` (merge della PR #17): tutto confermato.
