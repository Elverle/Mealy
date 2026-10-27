---
title: Strumenti del Pacchetto di Ricette — pnpm recipes:pack (recipe-pack-tools)
type: entity
created: 2026-10-26
updated: 2026-10-27
tags: [recipes, recipe-pack, dataset, csv, selection, llm, conversion, checks, ingredients, build, cli, script, feature-10, feature-11]
---

## File e Responsabilità

- **Percorsi file** (`lib/recipes/pack/`, tutti nuovi):
  - `paths.ts`: percorsi di default (`DEFAULT_WORK_DIR = '.recipe-pack'`, `DEFAULT_CSV_PATH = 'docs/recipe.csv'`, `PACK_FILE_PATH`, `PACK_INGREDIENTS_FILE_PATH`), `workPaths(workDir)` e `recordPath(workDir, code)`. I percorsi sono stringhe con `/`, così i messaggi sono uguali su Windows e Linux (requirements P9).
  - `errors.ts`: `PackError` (il messaggio è quello da stampare) e `isPackError`.
  - `files.ts`: `readJsonFile` e `writeJsonFile`, unico punto di I/O JSON degli strumenti (review R3).
  - `dataset.ts`: parser puri del dataset (CSV, liste di coppie, quantità, parole senza accenti).
  - `select.ts`: criteri, ingrediente principale, selezione a giro, `selection.md` e sua lettura, `runSelect`.
  - `state.ts`: stato di lavoro (candidati, revisione, record) e `acceptedByGroup`.
  - `checks.ts`: post-elaborazione deterministica, errori E1–E3 e avvisi W1–W4.
  - `convert.ts`: `runConvert`, conversione con memoria, secondo tentativo e concorrenza.
  - `report.ts`: `.recipe-pack/report.md`.
  - `ingredients.ts`: `runIngredients`, bozza della tabella, revisione e approvazione.
  - `build.ts`: `runBuild`, costruzione del pacchetto e statistiche.
  - `command.ts`: `parsePackCommand`, lettura degli argomenti, pura.
  - `scripts/recipe-pack.ts` con `"recipes:pack": "tsx scripts/recipe-pack.ts"` in `package.json`: il comando.
  - Il caricatore `load.ts` sta nella stessa cartella ma ha una pagina sua: [[recipe-pack]].
- **Scopo**: preparare **una volta sola, sul PC**, il pacchetto iniziale di ricette a partire dal dataset `docs/recipe.csv`, che non è nel repository (spec D12). Il risultato sono i due file di `fixtures/` committati ([[recipe-pack]]).
- **Confini** (requirements P7, P23; review R5):
  - nessun modulo di `lib/recipes/pack/` tranne `load.ts` importa `@/lib/db`: gli strumenti non aprono connessioni. Lo controlla il lint (`eslint.config.mjs`, `no-restricted-imports`, messaggio «Gli strumenti del pacchetto non aprono il DB (Feature 10, req. P7).»);
  - solo il modulo `recipes` chiama `lib/llm/`: `convert.ts` e `ingredients.ts` usano `convertDatasetRecipe` e `draftIngredientFacts` ([[llm-adapter]]);
  - `lib/recipes/index.ts` non esporta il modulo `pack`: il barrel è importato dalle rotte, e il pacchetto deve entrare solo dove serve.
- **Tipi**: tutti gli schemi (candidato, record, voce per il modello, tabella, statistiche) stanno in `lib/domain/types.ts`, blocco `Recipe Pack (Feature 10)` ([[domain-types]]). Le interfacce `XxxOptions`/`XxxReport` dei servizi stanno nei loro moduli, come `ClassifyReport` in `classify.ts`.

## Il Comando (`pnpm recipes:pack <passo>`)

```
Uso: pnpm recipes:pack <passo> [opzioni]
  select [--csv <percorso>] [--force]
  convert [--concurrency <1-5>] [--retry-rejected]
  ingredients [--approve]
  build
  load
```

Sequenza di lavoro: `select` → revisione di `.recipe-pack/selection.md` → `convert` → lettura del report → `ingredients` → revisione della tabella → `ingredients --approve` → `build`. `load` carica il pacchetto sul DB di `DATABASE_URL` per provarlo in sviluppo. Ogni passo legge l'output del precedente da `.recipe-pack/` e scrive il proprio lì, tranne `build`, che scrive i due file di `fixtures/`. Rilanciare un passo è sicuro.

`scripts/recipe-pack.ts` carica `.env.local` e `.env` (`process.loadEnvFile`), poi importa in modo dinamico il modulo del passo. `load` importa anche `@/lib/db` e chiude `client` nel `finally`, come `scripts/classify-recipes.ts` ([[recipe-classification]]).

`parsePackCommand(argv)` (`command.ts`) usa `node:util` `parseArgs` in modalità stretta e lancia `PackError` con il messaggio da stampare:
- opzione sconosciuta: `Opzione non valida: …` seguito dall'uso;
- passo sconosciuto o assente: `Passo sconosciuto: "<passo>". Passi: select, convert, ingredients, build, load.` seguito dall'uso;
- opzione di un altro passo: `L'opzione --<nome> vale solo per <passo>.`;
- `--concurrency` non intero o fuori da 1–5 (default 3).

Uscita: `PackError` → messaggio ed uscita 1; `LlmError` di tipo `config` → `Modello non configurato: <messaggio>` ed uscita 1; altro → `Errore inatteso:` con l'errore ed uscita 1. `convert` sotto quota e `ingredients` con nomi senza bozza escono con 1 dopo il riepilogo (`process.exitCode`).

Il modello si sceglie al lancio, con le variabili d'ambiente (spec D5). Per esempio in PowerShell: `$env:LLM_MODEL='<id>'; pnpm recipes:pack convert`.

## `select`: dal Dataset ai Candidati

### Parser (`dataset.ts`)

Funzioni pure, senza librerie CSV (spec §4.2, nessuna dipendenza nuova):

| Funzione | Cosa fa |
|---|---|
| `parseCsv(text)` | Record RFC 4180: separatore `,`, campi tra virgolette anche su più righe, `""` come virgoletta, fine record `\n` o `\r\n` |
| `readDatasetRows(text)` | Righe del dataset (la prima è l'intestazione); toglie il BOM; una colonna mancante → `Il CSV non ha la colonna "<nome>".` |
| `parsePairList(text)` | Lista di coppie `[nome, quantità]` in sintassi Python, con apici singoli o doppi ed escape; `null` se illeggibile |
| `parseDatasetQuantity(raw)` | `qb` per `q.b.`/`qb`; `measure` con `g`, `ml` o `pz` dopo le conversioni (kg → g; l, dl, cl → ml; numero solo → `pz` con `unitless: true`); `invalid` per quantità con zero iniziale (`025g`), concatenate (`250g1kg`) o testuali |
| `formatQuantityReading(reading)` | `"750 g"`, `"2 senza unità"`, `"q.b."`; `null` se illeggibile |
| `normalizeDatasetText`, `datasetWords` | Testo minuscolo senza accenti e parole di lettere e cifre: li usano i filtri e il controllo E3 |

### Criteri e ingrediente principale (`select.ts`)

`evaluateRow(row)` restituisce il candidato o il primo motivo di scarto: `categoria`, `titolo`, `ingredienti` (meno di 2 coppie, lista illeggibile o nome vuoto), `procedimento` (meno di 200 caratteri), `persone` (non intero tra 2 e 8), `quantità` (una illeggibile), `troppi ingredienti` (più di 10 misurati), `elettrodomestico` (*bimby*, *planetaria*, *impastatrice*, *barbecue*, *gelatiera*, *slow cooker*, *macchina del pane*, *essiccatore* in titolo o procedimento).

Gruppi (`CATEGORY_TO_GROUP`): *Primi piatti* → primi; *Secondi piatti* → secondi; *Piatti Unici*, *Torte salate*, *Insalate* → piatti unici; *Contorni* → contorni.

`mainIngredientOf(names)` cerca parole intere nei nomi degli ingredienti, con precedenza carne → pesce → legumi → uova → formaggi; senza riscontri è `verdure`. Gli elenchi (`MAIN_INGREDIENT_KEYWORDS`) sono quelli della spec FR-1.2, allargati dopo la prima selezione con carni, pesci e formaggi meno comuni (commit `1db233c`: gamberoni, abbacchio, peposo e verzini finivano tra le verdure).

### Selezione a giro

Per ogni gruppo, i candidati di ogni ingrediente principale si ordinano per punteggio crescente (ingredienti misurati + ⌈caratteri del procedimento / 500⌉, a parità l'indice del dataset). La scelta segue a giro `PICK_SEQUENCE` (carne, verdure, pesce, carne, legumi, verdure, pesce, uova, carne, formaggi): da ogni ingrediente si prende il primo candidato con titolo non simile a uno già preso (`areTitlesSimilar`, [[diet-rules]]); un ingrediente esaurito si salta. Si ferma al doppio della quota (`selectionLimit`) o quando i candidati finiscono. I primi ⌈1,5 × quota⌉ (`checkedCount`) sono spuntati.

Codice: lettera del gruppo (`PACK_GROUP_CODES`: P, S, U, C) più tre cifre nell'ordine di scelta (`P001`).

### File scritti e revisione

- `.recipe-pack/candidates.json`: per ogni candidato codice, gruppo, ingrediente principale, indice del dataset, **link**, campi grezzi, punteggio e spunta iniziale.
- `.recipe-pack/selection.md`: tre righe di istruzioni, poi una sezione per gruppo (`## Primi — quota 50`) con le righe spuntate (`- [x] P001 · <titolo> · 7 ingredienti · verdure`) e, sotto `### Riserve`, quelle non spuntate.

`parseSelection` legge solo le righe spuntate, nell'ordine del file; ignora le righe che non riconosce e i codici ripetuti. Un codice spuntato assente da `candidates.json` → `Codice sconosciuto in selection.md: <codice>`. Il gruppo di un codice è quello del candidato, non la sezione in cui si trova la riga.

`runSelect` non sovrascrive una `selection.md` esistente senza `--force` (`Esiste già <workDir>/selection.md: per rifare la selezione, e perdere la revisione, usa --force.`). Con `--force` e conversioni già presenti avvisa che i record sono legati ai codici, che con un CSV o regole diverse possono indicare altre ricette (code review). Un gruppo con meno candidati di ⌈1,5 × quota⌉ produce `<Etichetta>: solo <n> candidati, meno dei <attesi> previsti.`. Il comando stampa per gruppo spuntati, riserve e disponibili.

## `convert`: il Modello Riscrive le Ricette

### Stato (`state.ts`)

`readWorkState(workDir)` legge candidati, revisione e record di `.recipe-pack/converted/`. `acceptedByGroup(state, quotas?)` restituisce, per gruppo, le prime `quota` ricette accettate nell'ordine di `selection.md`: è l'unico punto che decide quali ricette entrano in tabella e pacchetto (requirements P16). Le quote sono iniettabili solo nei test (P26).

### Ciclo di `runConvert`

1. Legge lo stato e la tabella degli ingredienti (se manca, vuota) e costruisce i **nomi noti** (`buildKnownNames`): voci della tabella, destinazioni degli alias, ingredienti delle ricette d'esempio, normalizzati, senza vuoti né doppioni.
2. Gruppo per gruppo, mette in coda le righe spuntate senza record (con `--retry-rejected` anche le scartate). `concurrency` worker prendono dalla coda finché `accettate + in corso < quota`: mai chiamate oltre la quota, mai più di `concurrency` in corso (review R4).
3. Per ogni candidato: `toConvertItem` (titolo, gruppo, persone, ingredienti con quantità grezza e lettura, procedimento, nomi noti) → `convertDatasetRecipe` → `postProcessConversion` → `checkConversionErrors`. Se ci sono errori, **un secondo tentativo** con gli errori nel prompt (`feedback`). Al secondo fallimento la ricetta è scartata.
4. Esito in `.recipe-pack/converted/<codice>.json` (`PackConversionRecord`: `status`, `recipe` o `null`, `errors`, `warnings`, `model`, `converted_at`). Log `[pack] <codice> accettata` o `[pack] <codice> scartata: <errori>`.
5. Un `LlmError` (timeout, provider, output non valido) **non** si salva: `[pack] <codice> non convertita: <codice>: <messaggio>`, e il candidato si riprova al rilancio. Dopo `MAX_CONSECUTIVE_MODEL_ERRORS` = 5 errori di fila di tipo `provider` o `config` la corsa si ferma con un avviso (code review). Un errore che non viene dal modello ferma ogni nuova chiamata e risale.
6. Alla fine riscrive il report e restituisce, per gruppo, accettate/quota, scartate ed errori del modello. Il comando stampa `Conversione completa` oppure, per ogni gruppo sotto quota, `<Gruppo>: <accettate>/<quota> — spunta altre ricette in .recipe-pack/selection.md e rilancia.`

**Rifare una conversione**: cancellare `.recipe-pack/converted/<codice>.json` e rilanciare `convert`, che rifà quel codice. Per correggere a mano una ricetta accettata si modifica il suo record e si rilancia `build`: pacchetto e record restano allineati.

### Post-elaborazione e controlli (`checks.ts`)

`postProcessConversion(recipe, candidate, aliases)`: `normalizeGeneratedRecipe`, `servings_base` forzato al numero di persone del dataset, nomi canonici risolti con gli alias delle fixture (`resolveIngredientName`).

| Codice | Tipo | Regola | Testo |
|---|---|---|---|
| E1 | errore | La ricetta non rispetta `SavedRecipeInputSchema` (al più 5 problemi) | `schema: <percorso>: <messaggio>` |
| E2 | errore | Nei contorni `courses` deve contenere `contorno`; negli altri gruppi almeno una portata principale | `portata non adatta al gruppo <Gruppo>: <portate>` |
| E3 | errore | Descrizione o un passo condivide 8 o più parole consecutive con il procedimento originale (`findSharedWordRun`, `COPIED_RUN_WORDS = 8`) | `testo copiato dall'originale: "<8 parole>"` |
| W1 | avviso | Unità diversa o quantità oltre il 10% da quella letta, riga per riga | `quantità di "<nome>": "<grezza>" → <qty> <unit>` |
| W2 | avviso | Numero di righe di ingredienti cambiato (allora W1 e W3 non si valutano) | `ingredienti: <n> → <m>` |
| W3 | avviso | Numero senza unità su un ingrediente da cucchiai (`SPOON_KEYWORDS`: olio, aceto, burro, parmigiano, …) | `numero senza unità su "<nome>": "<grezza>" → <qty> <unit>` |
| W4 | avviso | `prep_minutes` oltre 120 | `tempo lungo: <minuti> minuti` |

### Report (`report.ts`)

`.recipe-pack/report.md`: per gruppo `accettate n/quota`, le accettate (codice, titolo, **link all'originale**, avvisi) e le scartate (codice, titolo, motivi). Dopo `build` anche le statistiche: per portata, per pasto, per dieta, per ingrediente principale e per fasce di minuti. Il link serve solo a controllare la conversione e non esce mai da `.recipe-pack/` (spec D8).

## `ingredients`: la Tabella degli Ingredienti

`runIngredients` raccoglie i nomi canonici delle ricette accettate (`acceptedInOrder`, `ingredientNames`) e li confronta con `fixtures/recipe-pack-ingredients.json`, creato se manca.

- Per i nomi senza voce chiede una bozza al modello a lotti di `PACK_DRAFT_BATCH_SIZE` = 40 (`draftIngredientFacts`). Tiene solo le voci dei nomi richiesti, una per nome, e le aggiunge con `reviewed: false`. Un lotto che fallisce con `LlmError` si salta con un avviso; i nomi restano in `missing` e il comando chiede di rilanciare (`Nomi senza bozza: …`).
- Le voci esistenti non si toccano. Il file si scrive con `formatIngredientsFile`: voci ordinate per nome, **una per riga**, chiavi in ordine fisso, così la revisione a mano e i diff restano leggibili.
- Scrive `.recipe-pack/ingredients-review.md`: tabella delle voci usate e non rivedute (nome, reparto, i sei attributi in sì/no, ricette che lo usano, le prime tre).
- La revisione consiste nel correggere le voci nel JSON. `pnpm recipes:pack ingredients --approve` segna **tutte** le voci come rivedute, senza modello: va lanciato solo dopo aver controllato la tabella.

## `build`: il Pacchetto

`runBuild` raccoglie in un solo `PackError` (`Il pacchetto non si può costruire:` più una riga per problema):
- gruppi sotto quota;
- nomi della tabella non normalizzati o doppi dopo la normalizzazione (code review);
- ingredienti senza voce (con questi la costruzione si ferma subito) o non riveduti;
- nomi canonici che sono alias in `fixtures/ingredient-aliases.json`;
- dopo la costruzione: coppie di titoli uguali o simili, testo con `http`, `www.` o `giallozafferano`, ricetta che non rispetta `RecipePackFileSchema`.

Per ogni ricetta: `category` di ogni ingrediente dalla tabella, `diet_flags = deriveDietFlags(...)` ([[diet-rules]]), portate normalizzate e `tags = deriveStyleTags(...)` ([[courses]]; dalla Feature 11 `deriveStyleTags(recipe.tags, ingredients)`, senza la regola su `piatto-unico`). Scrive `fixtures/recipe-pack.json` (ordine primi, secondi, piatti unici, contorni e, nel gruppo, quello di `selection.md`), riscrive la tabella tenendo solo i nomi usati e aggiunge le statistiche (`computePackStats`) al report.

Dopo `build` va lanciato `pnpm test tests/recipes/pack/load.test.ts`: carica il pacchetto vero sul Postgres e nomina i titoli che `pg_trgm` giudica simili mentre la misura offline no (review R1, [[recipe-pack]]).

## I/O dei File di Lavoro (`files.ts`)

```ts
readJsonFile<T>(filePath, schema, onMissing: () => T): Promise<T>;
writeJsonFile(filePath, value): Promise<void>;
```

- `readJsonFile`: file assente → `onMissing()`, che può lanciare il proprio errore (es. `Manca <percorso>: lancia prima "pnpm recipes:pack <passo>".`); JSON o schema non validi → `PackError('File non valido: <percorso>: <primo problema>')`.
- `writeJsonFile`: crea le cartelle, scrive JSON a 2 spazi con `\n` finale su `<file>.tmp` e poi lo rinomina: un'interruzione non lascia file troncati (code review).

## Test

Tutti senza rete e senza `docs/recipe.csv`: CSV inventato `tests/fixtures/recipe-pack/sample.csv` (requirements P24), cartelle temporanee (`mealy-pack-*`), modello finto (`createRecordedModel`) o funzioni iniettate, quote ridotte.

- `tests/recipes/pack/dataset.test.ts`: virgolette e a capo nei campi, BOM, colonne mancanti, coppie con apici misti ed escape, quantità ammesse e scartate (`025g`, `250g1kg`, numeri senza unità).
- `tests/recipes/pack/select.test.ts`: criteri e motivi, gruppi, ingrediente principale e precedenza, punteggio, sequenza a giro, titoli simili, spunte e riserve, gruppo corto, `selection.md` non sovrascritto senza `--force`, avviso con conversioni presenti, lettura con righe tolte, riserve spuntate e codici sconosciuti.
- `tests/recipes/pack/{files,state}.test.ts`: lettura e scrittura JSON, file assente o non valido, scrittura atomica; record e `acceptedByGroup`.
- `tests/recipes/pack/checks.test.ts`: E1–E3, W1–W4, `findSharedWordRun`, `postProcessConversion`.
- `tests/recipes/pack/convert.test.ts`: ingresso al modello, secondo tentativo, memoria e ripresa, `--retry-rejected`, errori del modello non salvati, arresto dopo 5 errori di fila, quota mai superata, uscita sotto quota.
- `tests/recipes/pack/report.test.ts`: parti essenziali del report con `toContain` (review R6).
- `tests/recipes/pack/ingredients.test.ts`: voci nuove non rivedute, esistenti intatte, lotti da 40, lotto fallito, `--approve`, revisione.
- `tests/recipes/pack/build.test.ts`: quote, voci mancanti o non rivedute, nomi non normalizzati o doppi, alias, titoli simili, testo vietato, reparto e diete dalla tabella, ordine del file, tabella potata.
- `tests/recipes/pack/command.test.ts`: passi, opzioni, opzioni del passo sbagliato, `--concurrency`.

Non coperto da test: `scripts/recipe-pack.ts` (le righe stampate), la conversione con un modello reale e la qualità del testo, verificate a mano alla chiusura.

## Vedi anche

- [[f10-pacchetto-ricette]] — Panoramica della Feature 10
- [[recipe-pack]] — File del pacchetto e caricatore `loadRecipePack`
- [[diet-rules]] — `deriveDietFlags`, `areTitlesSimilar`
- [[llm-adapter]] — `convertDatasetRecipe`, `draftIngredientFacts` e i prompt
- [[domain-types]] — Schemi `Pack*`
- [[courses]] — `deriveStyleTags`, `normalizeCourses`, `MAIN_COURSE_VALUES`
- [[fixtures-and-seed]] — Alias e ricette d'esempio usati come nomi noti
- [[recipe-classification]] — `pnpm recipes:classify`, il comando su cui è modellato questo
- [[f11-composizione-pasto]] — Feature 11: `deriveStyleTags` con due parametri
