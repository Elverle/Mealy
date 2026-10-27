---
title: F10 Pacchetto Ricette — 200 Ricette dal Dataset, Diete per Regola e Caricamento all'Avvio
type: topic
created: 2026-10-26
updated: 2026-10-27
tags: [recipes, recipe-pack, dataset, llm, diet-flags, ingredients, startup, instrumentation, fixtures, cli, feature-10, feature-11]
---

## Panoramica

La **Feature 10** (*Pacchetto iniziale di ricette*) riempie la libreria con **200 ricette reali**, riscritte da un dataset di ricette italiane, prima che il modello ne generi una sola. È la seconda delle tre feature che riprendono `docs/rework-catalogo.md`: 8 (portate, [[f8-portate-etichette]]) → 10 (pacchetto) → 11 (composizione del pasto). Non è in `docs/BACKLOG.md` né in `execution-strategy.md`: l'unica fonte dei requisiti è `spec.md`. Per questo la pagina usa il prefisso `f10-`, come [[f8-portate-etichette]] e [[f9-ricette-su-richiesta]].

**Il problema.** Sul Raspberry la libreria si era fermata a 26 ricette. Con quel numero la soglia di generazione del planner (9 ricette fresche per pasto su una settimana intera, [[planner]]) è superata, quindi il modello non genera più e due piani di fila si sovrappongono per più di metà. Al primo avvio, invece, con la libreria vuota, il primo piano dipendeva tutto dal modello ed era andato in timeout (spec §1).

Cosa cambia:

1. **Il pacchetto è un file del repository.** `fixtures/recipe-pack.json` contiene 200 ricette nel formato di `GeneratedRecipeSchema`; `fixtures/recipe-pack-ingredients.json` è la tabella degli ingredienti (263 voci, tutte rivedute) da cui si ricavano reparti e diete ([[recipe-pack]]).
2. **Preparazione una volta sola, sul PC.** `pnpm recipes:pack <passo>` porta dal dataset `docs/recipe.csv` (non nel repository) al pacchetto: `select` → revisione dei titoli → `convert` → `ingredients` → revisione della tabella → `build`. `load` lo carica sul DB di sviluppo ([[recipe-pack-tools]]).
3. **Diete per regola, non dal modello.** `deriveDietFlags` le calcola dagli attributi della tabella (carne, pesce, latticini, uova, miele, glutine), rivista dall'utente ([[diet-rules]]).
4. **Caricamento all'avvio in produzione.** Dopo migrazioni e alias, e prima della classificazione della Feature 8, l'app inserisce le ricette del pacchetto il cui titolo non è già in libreria, né uguale né simile. L'avvio **aspetta** il caricamento; un errore non ferma l'app ([[recipe-pack]], [[db-bootstrap]]).
5. **Repository pubblicabile.** Passi e descrizioni sono scritti da capo dal modello; un controllo scarta i testi con 8 o più parole consecutive uguali all'originale; nel pacchetto non ci sono link, indici del dataset né il nome del sito.

**Nessuna migrazione, nessuna rotta, nessuna UI, nessuna variabile d'ambiente, nessuna dipendenza npm nuova.** Il planner, i pesi e la soglia di generazione non cambiano (spec FR-5): le ricette del pacchetto si vedono, si filtrano, si votano e si bloccano come le altre.

Per i dettagli di progetto la fonte resta `docs/ARCHITECTURE.md` §1.3 (la libreria parte dal pacchetto) e §7 (il passo `[pack]` all'avvio). Per l'operatività: `docs/DEPLOY.md` §1, §4, §5 (riga `[pack]` da cercare nel log) e §9 (`[pack] caricamento interrotto`).

### Il pacchetto committato

Convertito con `anthropic/claude-haiku-5.5` e corretto a mano (quantità, qualche passo, alcuni nomi di ingrediente) nel commit `2a573c9`.

| Gruppo di selezione (quota) | Portate nel file |
|---|---|
| Primi (50) | 49 `primo`, 1 `piatto-unico` (*Gallo pinto*) |
| Secondi (50) | 50 `secondo` |
| Piatti unici (40) | 39 `piatto-unico`, 1 `piatto-unico` + `secondo` (*Sashimi*) |
| Contorni (60) | 60 `contorno` |

Contate per portata, quindi, le ricette sono 49 primi, 51 secondi, 41 piatti unici e 60 contorni: è il conteggio del messaggio di commit. Le quote 50/50/40/60 di `ARCHITECTURE §1.3` sono quelle dei **gruppi di selezione**, che derivano dalla categoria del dataset e non dalla portata. 140 ricette sono da pasto (`isMainDish`), 60 solo contorno e quindi fuori dal piano fino alla Feature 11.

Altri numeri del file: 199 ricette per pranzo e 198 per cena; 130 pescetariane, 94 vegetariane, 46 vegane, 101 senza lattosio, 95 senza glutine; tempi fino a 30 minuti 74, da 31 a 60 92, da 61 a 120 26, oltre 120 8.

### Decisioni della spec e dell'utente

| ID | Decisione |
|---|---|
| D1 / U1 | **Pacchetto nel repository**, letto dal bundle come gli alias, caricato all'avvio per titolo, **senza modifiche allo schema** |
| D2 | Entra all'avvio in produzione, dopo migrazioni e alias: sul Raspberry non si lancia `pnpm` e l'immagine standalone non contiene `tsx`. Nessuna tabella che segni il pacchetto come caricato: servirà quando le ricette si potranno cancellare |
| D3 / U2 | **200 ricette a quote fisse per gruppo**: primi 50, secondi 50, piatti unici 40, contorni 60. Pranzo e cena li assegna il modello |
| D4 / U6 | **Selezione per regola, poi revisione dei titoli**: circa 1,5 candidati per posto spuntati, più le riserve fino al doppio della quota |
| D5 | **Conversione con il modello configurato via env**, una ricetta per chiamata, attraverso l'adattatore unico |
| D6 / U3 | **Diete per regola da una tabella degli ingredienti rivista dall'utente**: un filtro vincolante non può essere probabilistico |
| D7 / U5 | **Salvaguardie per un repository pubblico**: testo scritto da capo, controllo delle 8 parole, nessun riferimento al sito |
| D8 / U4 | **Nessun link all'originale** nel repository: link e indice restano nei file di lavoro |
| D9 | Le ricette entrano con l'origine **`manual`** (già esistente) tramite l'opzione `source` di `insertGeneratedRecipe`; le regole derivate valgono come per ogni altra ricetta |
| D10 | Si accetta che il modello non generi quasi più ricette da solo: le nuove arrivano con lo swap e con le richieste della Feature 9 |
| D11 | Solo primi, secondi, piatti unici, torte salate, insalate e contorni: niente dolci, antipasti, lievitati, salse, bevande o conserve |
| D12 | Il dataset resta fuori dal repository (`docs/recipe.csv` in `.gitignore`); i file di lavoro vanno in `.recipe-pack/`, anch'essa ignorata |

Le decisioni di planning P1–P26 sono in `docs/planning/feature/feature-10/requirements.md`; quelle che fissano la forma del codice sono citate nelle pagine delle entità. Tre correggono la spec: soglia di similarità **strettamente maggiore** di 0,6, come `findSimilarRecipeTitle` (P4); unicità dei titoli controllata da `build` e dal test del file, non dallo schema, per non creare un import circolare (P3); W3 valutato solo quando le righe di ingredienti si corrispondono (P14).

## Architettura del Flusso

```
Sul PC, una volta (pnpm recipes:pack)                     docs/recipe.csv  (fuori dal repository)
 select ──────────► .recipe-pack/candidates.json + selection.md
                     │  revisione dell'utente: togliere spunte, spuntare riserve
 convert ─► lib/llm convertDatasetRecipe (≤ 3 in parallelo, per gruppo, fino alla quota)
            postProcessConversion → E1–E3 (secondo tentativo con gli errori) → W1–W4
            ──────► .recipe-pack/converted/<codice>.json + report.md
 ingredients ─► lib/llm draftIngredientFacts (lotti da 40) ──► fixtures/recipe-pack-ingredients.json (reviewed: false)
                     │  revisione dell'utente, poi `ingredients --approve`
 build ──► reparti dalla tabella, deriveDietFlags, deriveStyleTags, controlli d'insieme
           ──────► fixtures/recipe-pack.json + tabella potata + statistiche nel report
 load ───► loadRecipePack sul DB di DATABASE_URL (sviluppo)

All'avvio in produzione (instrumentation.ts, DB_BOOTSTRAP_ON_START=true)
 runDbBootstrap (migrazioni, alias)
   └ await loadRecipePack()            ← atteso; errore → "[pack] caricamento interrotto", l'app parte lo stesso
        ensureDefaultHousehold
        db.transaction: acquireRecipeGenerationLock, listRecipeTitles
          per ricetta: titolo uguale → salta; findSimilarRecipeTitle → salta;
                       altrimenti insertGeneratedRecipe(…, { source: 'manual', createdAt: 2026-01-01 })
        "[pack] ricette del pacchetto inserite: N, già presenti o simili: M"
   └ void classifyPendingRecipes()     ← Feature 8, in background; non tocca le ricette del pacchetto
```

## Moduli e Componenti Introdotti o Modificati

### 1. Dominio puro (`lib/domain/`)
- [[diet-rules]] (nuovo): `deriveDietFlags` e `toIngredientFactsMap` (`lib/domain/diet-rules.ts`); `titleSimilarity`, `areTitlesSimilar` e `SIMILAR_TITLE_THRESHOLD` (`lib/domain/title-similarity.ts`).
- [[domain-types]]: blocco `Recipe Pack (Feature 10)` in coda a `types.ts`: gruppi, quote e codici, `RECIPE_PACK_SIZE`, ingrediente principale, riga del dataset, lettura delle quantità, candidato, voce per il modello, record di conversione, tabella degli ingredienti, file del pacchetto e statistiche.
- [[single-source-of-truth-types]]: da questa feature il lint impedisce a `lib/domain/**` di importare DB e LLM.

### 2. LLM (`lib/llm/`)
- [[llm-adapter]]: `convertDatasetRecipe` (temperatura 0,4, riparazione 0,2) e `draftIngredientFacts` (0,2 e 0,2) su `runStructuredCall`; prompt di conversione con il procedimento tra `<<<PROCEDIMENTO` e `PROCEDIMENTO>>>` e il blocco degli errori del secondo tentativo; prompt della tabella prudente («nel dubbio rispondi true»). Le righe comuni con `buildRecipeInstructions` sono costanti private condivise, senza cambiare l'output di oggi (P17).

### 3. Modulo `recipes`
- [[recipe-pack-tools]] (nuovo): gli strumenti di `lib/recipes/pack/` (`dataset`, `select`, `state`, `files`, `checks`, `convert`, `report`, `ingredients`, `build`, `command`, `paths`, `errors`) e il comando `scripts/recipe-pack.ts`.
- [[recipe-pack]] (nuovo): `fixtures/recipe-pack.{json,ts}`, `fixtures/recipe-pack-ingredients.json` e il caricatore `lib/recipes/pack/load.ts`, l'unico modulo del pacchetto che entra nel bundle dell'app.
- [[recipe-generation]] e [[recipe-proposal-service]]: `insertGeneratedRecipe(executor, householdId, recipe, options?)` con `source` (default `'llm'`) e `createdAt` (default adesso). I chiamanti di prima non cambiano.

### 4. Avvio, dati e deploy
- [[db-bootstrap]]: `register()` attende `loadRecipePack()` tra il bootstrap e la classificazione.
- [[recipe-classification]]: parte dopo il pacchetto; le ricette del pacchetto hanno sempre una portata e non la riguardano (FR-3.6).
- [[recipe-repo]] e [[household-repo]]: nuovi chiamanti (`listRecipeTitles`, `findSimilarRecipeTitle`, `acquireRecipeGenerationLock`, `ensureDefaultHousehold`), nessuna modifica.
- [[fixtures-and-seed]]: i due file nuovi stanno in `fixtures/`, ma `pnpm db:seed` non carica il pacchetto (FR-4.2).
- [[deploy-scripts]]: lo smoke si aspetta dopo il primo avvio tante ricette quante ne ha il pacchetto, e al riavvio `ricette del pacchetto inserite: 0`.
- [[production-stack]]: `.recipe-pack` fuori dal contesto di build Docker.
- Configurazione: `package.json` (`recipes:pack`), `.gitignore` (`.recipe-pack/`), `.eslintrc.json` (due `overrides` con `no-restricted-imports`).

## Regole di Dominio Principali

- **Cosa entra al caricamento**: nell'ordine del file, una ricetta si salta se il titolo normalizzato (`normalizeTitle`) è già in libreria, oppure se `findSimilarRecipeTitle` (`pg_trgm`, > 0,6) trova un titolo simile, anche tra quelle del pacchetto appena inserite. Le ricette già in libreria, del pacchetto o no, non si toccano: voti, preferite, blocchi e usi restano. Una versione nuova del file aggiunge solo i titoli nuovi.
- **Origine e data**: `source: 'manual'` e `created_at` fisso al 1° gennaio 2026 (`RECIPE_PACK_CREATED_AT`), come le ricette d'esempio del seed. In Libreria, ordinata per data decrescente ([[library-service]]), le ricette dell'utente restano in cima e il pacchetto segue in ordine di titolo; anche i 150 titoli "recenti" del prompt di generazione restano quelli dell'utente (review R2).
- **Diete**: per regola dalla tabella, contando anche gli ingredienti *q.b.*; un nome senza voce è un errore, non un "no" ([[diet-rules]]).
- **Portate ed etichette**: E2 impone `contorno` nel gruppo contorni e almeno una portata principale negli altri; `build` normalizza le portate e applica `deriveStyleTags` come ogni scrittura ([[courses]]).
- **Testo**: E3 scarta passi o descrizione che condividono 8 parole consecutive con il procedimento originale (minuscole, senza accenti né punteggiatura). `build` e il test del file rifiutano `http`, `www.` e `giallozafferano` in qualsiasi campo.
- **Effetto sul planner**: con 140 piatti da pasto la soglia di generazione è quasi sempre superata. Su uno stack di produzione locale senza chiave del modello, dopo l'onboarding, *Genera piano* produce un piano completo di 14 slot con zero giri di generazione (spec §7, punto 13).

## Innesti delle Review

**Architecture review 2026-10-23** (`docs/planning/feature/feature-10/architecture-review-2026-10-23.md`): niente di bloccante, nessun refactoring preliminare. Innestate tutte e sei le proposte:
- **R1**: `tests/recipes/pack/load.test.ts` carica **il pacchetto vero** in una libreria vuota sul Postgres reale e nomina i titoli saltati. La similarità offline (`areTitlesSimilar`, senza accenti) e quella di `pg_trgm` possono dare verdetti diversi: il test è la guardia, eseguito dopo ogni `build` (passo C5.6 del piano) e in CI.
- **R2**: opzione `createdAt` di `insertGeneratedRecipe` e costante `RECIPE_PACK_CREATED_AT`. Senza, la Libreria si sarebbe aperta con i 60 contorni (ultimi del file, quindi i più recenti) sopra le ricette dell'utente.
- **R3**: un solo lettore e scrittore dei file JSON di lavoro, `lib/recipes/pack/files.ts` (`readJsonFile`, `writeJsonFile`).
- **R4**: WP4 diviso in **WP4a** (stato, controlli, report) e **WP4b** (conversione, in parallelo a WP5); il pool di `runConvert` è fatto di `concurrency` worker su una coda condivisa invece di `Promise.race`.
- **R5**: il confine «gli strumenti non aprono il DB» è una regola di lint: `lib/recipes/pack/**` tranne `load.ts` non può importare `@/lib/db`; `lib/domain/**` non può importare `@/lib/db` né `@/lib/llm`.
- **R6**: report e revisione della tabella si verificano con `toContain` sulle parti che contano; il testo esatto resta per `selection.md`, i messaggi di `PackError` e le righe `[pack]`.

**Code review** (commit `91f6364`):
- `build` rifiuta i nomi della tabella non normalizzati o che coincidono dopo la normalizzazione, così la tabella scritta passa sempre il test del file;
- `select` scarta le righe con titolo o nome di ingrediente vuoto e porta i titoli su una riga; `select --force` avvisa se esistono già conversioni, legate ai codici;
- `convert` ignora i nomi noti vuoti e **si ferma dopo 5 errori del modello di fila** di tipo `provider` o `config` (modello sbagliato, chiave, quota);
- i file JSON di lavoro si scrivono su un file temporaneo e poi si rinominano: un `convert` interrotto non lascia record troncati;
- timeout di 30 s per il test del pacchetto vero; `.recipe-pack` fuori dal contesto Docker; `DEPLOY` non dice più che la libreria parte vuota.

**Fix dopo la prima selezione** (commit `1db233c`): parole chiave dell'ingrediente principale per carni, pesci e formaggi meno comuni. Piatti come gamberoni, abbacchio, peposo e verzini finivano tra le "verdure", e i posti a giro riservati alle verdure andavano a carne e pesce.

## Contratti Consegnati alle Feature Successive

- **Feature 11 (composizione del pasto)**: 60 ricette con portata `contorno` in libreria dopo il deploy, pronte per "secondo + contorno". Il caricatore resta invariato: una versione nuova del pacchetto aggiunge solo i titoli nuovi.
  - **Esito nella Feature 11** ([[f11-composizione-pasto]]): i 60 contorni sono la riserva dei contorni del piano. Con le cinque composizioni di default e il pacchetto vero un piano completo esce senza chiamare il modello (`tests/plans/compose.test.ts`). Il caricatore non è cambiato; `fixtures/recipe-pack.json` è stato riscritto (stesso formato, `JSON.stringify(…, null, 2) + '\n'`) solo per togliere l'etichetta di stile `piatto-unico` dai `tags`, che nessuna ricetta del file conserva; le portate non sono cambiate. Le ricette già caricate sul Raspberry perdono l'etichetta con la migrazione `0006`.
- **V2 (cancellazione delle ricette o catalogo)**: non esiste un segno di "pacchetto caricato". Prima di permettere la cancellazione va introdotto (per esempio una tabella `recipe_pack_loads`), altrimenti una ricetta del pacchetto cancellata torna al riavvio. Gli strumenti di `lib/recipes/pack/` e `deriveDietFlags` sono quelli da riusare per l'intero dataset.
- **Diete delle ricette generate** (review P3, nota per la V2): oggi convivono due fonti, il modello per le ricette generate e la tabella per quelle del pacchetto. La tabella è il primo passo verso diete per regola anche per le generate, a patto di gestire i nomi senza voce, che `deriveDietFlags` rifiuta.
- **Esito del contratto della Feature 8**: la Feature 8 indicava `insertGeneratedRecipe` come via di scrittura del pacchetto, mentre la Feature 9 avvertiva che scrive sempre `source: 'llm'`. Conciliati con l'opzione `source` (spec D9).
- **Documenti di progetto allineati dalla feature (WP8)**: `ARCHITECTURE` §1.3 e §7; `DEPLOY` §1, §4, §5, §9; `CLAUDE.md` (comando `pnpm recipes:pack`).

## Punti Aperti e Limiti Noti

- **Verifiche manuali**: alla data di questa pagina sono fatte la preparazione vera del pacchetto con le due revisioni dell'utente, lo smoke dello stack di produzione (pacchetto caricato al primo avvio, `inserite: 0` al riavvio), il piano completo senza chiave del modello e il controllo a campione di 10 ricette (corretti dosi e persone di *Hosomaki*, olio di *Uova al tegamino*, olio mancante fra gli ingredienti di 5 ricette). Restano il Raspberry dopo il deploy (riga `[pack]`, ricette = 26 + inserite, primo piano vario) e la prova da telefono a 360 px di due ricette del pacchetto (`requirements.md` §5, punto 5).
- **Ricette simili saltate**: sul Raspberry, con 26 ricette generate, alcune ricette del pacchetto si saltano perché simili; la riga `[pack]` riporta il numero ma non i titoli. Esempio visto nelle prove: *Pasta e ceci cremosa* saltata perché simile alla ricetta d'esempio *Pasta e ceci*. Quelle saltate non entrano mai nei titoli noti, quindi si ricontrollano con una query di similarità a ogni avvio: costo trascurabile, ma la frase della spec «nessuna query di similarità ai riavvii» vale solo su un'installazione pulita (review R7).
- **Correggere una ricetta del pacchetto**: si corregge `.recipe-pack/converted/<codice>.json` e si rilancia `build`, così file del pacchetto e record restano allineati. Per far riconvertire un codice al modello si cancella il suo record. Una correzione raggiunge solo le installazioni in cui quella ricetta non è ancora stata caricata: il caricatore non aggiorna le ricette già presenti.
- **Diete vere quanto la tabella**: un errore nella tabella si corregge solo rifacendo `build` e un deploy, e vale solo per le ricette non ancora caricate.
- **Due misure di similarità**: `titleSimilarity` toglie gli accenti, `pg_trgm` no. Il test R1 rende visibile ogni differenza sul pacchetto vero.
- **Il dataset non è nel repository né in CI**: rifare il pacchetto richiede `docs/recipe.csv` sul PC. Rischio residuo accettato sul diritto delle banche dati (200 ricette su 5.939, licenza "Unknown"); per azzerarlo si leggerebbe il pacchetto da un file solo sul Raspberry (spec D1, §5).
- **Libreria oltre 200 ricette**: Libreria, dettaglio, *Scegli* e giudizi sugli ingredienti leggono l'intera libreria a ogni richiesta (Feature 5, 6 e 9). Con il pacchetto la soglia che la review R7 della Feature 9 aveva fissato per togliere la lettura evitabile di `assignSlotRecipe` («oltre 200 ricette, o più di 300 ms sul Pi per aprire *Scegli*») è raggiunta per il primo criterio: i tempi vanno misurati sul Raspberry ([[recipe-repo]]). Anche la durata del caricamento al primo avvio sul Pi (la spec chiede meno di 10 s) non è ancora misurata.
- **Generazione rara**: con il pacchetto il modello genera da solo quasi solo con preferenze molto restrittive (D10); la scoperta di ricette nuove passa da swap e richieste.
- Fuori ambito (spec §6): catalogo separato dalla libreria, intero dataset, link all'originale e `source_url`, valore nuovo di `source`, cancellazione delle ricette, correzione dall'app, composizione del pasto, revisione dei titoli nell'app, dolci e antipasti, nuove dipendenze npm.

## Strategia di Test

La suite conta **113 file di test** (98 alla fine della Feature 8). Nuovi file:
- dominio puro: `tests/domain/diet-rules.test.ts` (ogni combinazione di attributi, ingredienti *q.b.*, nome senza voce), `tests/domain/title-similarity.test.ts`;
- fixture: `tests/fixtures-data/recipe-pack.test.ts`, le invarianti di FR-2.2 sul file vero (schemi, voci rivedute e normalizzate, reparto e diete dalla tabella, etichette derivate, nessun alias, nessun titolo uguale o simile, 2–8 persone, nessun link) e, dalla chiusura, 200 ricette con almeno 60 contorni e 140 piatti da pasto;
- strumenti: `tests/recipes/pack/{dataset,select,files,state,checks,convert,report,ingredients,build,command}.test.ts`, con il CSV inventato `tests/fixtures/recipe-pack/sample.csv` (mai `docs/recipe.csv`), cartelle temporanee e modello finto;
- DB reale: `tests/recipes/pack/load.test.ts` (libreria vuota, secondo caricamento, titolo uguale o simile, errore a metà annullato, pacchetto vuoto, pacchetto vero) e `tests/recipes/store.test.ts` (`source` e `createdAt` di `insertGeneratedRecipe`);
- casi aggiunti in `tests/llm/{adapter,prompts}.test.ts` e `tests/instrumentation.test.ts` (pacchetto caricato una volta dopo il bootstrap e prima della classificazione, errore non fatale, nessun caricamento se il bootstrap fallisce).

## Vedi anche

- [[recipe-pack-tools]] — `pnpm recipes:pack`: selezione, conversione, tabella e costruzione
- [[recipe-pack]] — File del pacchetto e caricamento all'avvio
- [[diet-rules]] — Diete per regola e similarità dei titoli offline
- [[llm-adapter]] — `convertDatasetRecipe`, `draftIngredientFacts` e i loro prompt
- [[db-bootstrap]] — Hook di avvio che attende il pacchetto
- [[deploy-scripts]] — Smoke con il pacchetto
- [[f8-portate-etichette]] — Feature 8: portate ed etichette derivate che il pacchetto rispetta
- [[f9-ricette-su-richiesta]] — Feature 9: richieste dell'utente, la via delle ricette nuove
- [[e3-pianificatore]] — Feature 4: il planner e la soglia di generazione
- [[e6-deploy]] — Feature 7: bootstrap all'avvio e produzione sul Raspberry
- [[f11-composizione-pasto]] — Feature 11: i contorni del pacchetto nei pasti composti
