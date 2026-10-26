# Architecture review — Feature 10 (Pacchetto iniziale di ricette)

**Data:** 2026-10-23 · **Piano esaminato:** [`plan.md`](plan.md) (+ [`requirements.md`](requirements.md), [`spec.md`](spec.md)) · **Contesto:** as-built di F1–F9 (`main`, `dfa16a6`, v0.8.0), review della F8 (`../feature-8/architecture-review-2026-10-21.md`), spunto della F11, `docs/DEPLOY.md`, `CLAUDE.md`.

**Esito in una riga:** niente di bloccante e nessun refactoring preliminare. Il piano si appoggia ai punti giusti: un solo punto di scrittura (`insertGeneratedRecipe`), la transazione con lock e titoli noti di `generate.ts`, il servizio con `deps` di `classify.ts` e l'avvio di `instrumentation.ts`. Conviene però sistemare quattro cose prima di implementare. Primo, **un test sul DB che carichi il pacchetto vero** (R1): la similarità offline e quella di `pg_trgm` possono dare verdetti diversi, e oggi il problema si vedrebbe solo nello smoke di chiusura o sul Raspberry. Secondo, **una data di creazione fissa per le ricette del pacchetto** (R2): senza, la Libreria si apre con 60 contorni sopra le ricette dell'utente. Terzo, **dividere WP4** (R4). Quarto, **un solo lettore dei file JSON di lavoro** (R3).

> **Nota sugli ID.** `P1…P4` e `R1…R7` sono gli ID di questa review. Le decisioni di `requirements.md` (`U1…U6`, `P1…P26`) sono citate come «req. U*n*» / «req. P*n*»; quelle della spec come «spec D*n*» / «FR-*n*».

## Metodo e prove raccolte

- **Letti per intero:** `plan.md` (8 WP, 5 wave, chiusura C1–C9), `spec.md`, `requirements.md`. Sul codice: `instrumentation.ts`, `lib/recipes/{store,generate,index}.ts`, le parti rilevanti di `lib/recipes/classify.ts`, `lib/db/repositories/{recipe-repo,household-repo}.ts`, `lib/domain/{library,recipe-text}.ts` (ordinamento e normalizzazioni), le prime 80 righe di `lib/llm/prompts.ts`, gli schemi di `lib/domain/types.ts` (`GeneratedRecipeSchema`, `SavedRecipeInputSchema`), `fixtures/index.ts`, `lib/db/seed-core.ts`, `tests/helpers/db.ts`, `tests/instrumentation.test.ts` (i mock), `.github/workflows/gate.yml`, `docker-compose.{dev,prod}.yml`, `.eslintrc.json`.
- **Ipotesi del piano controllate sul codice:**
  - `insertGeneratedRecipe` scrive `source: 'llm'` fisso (`lib/recipes/store.ts:66`). Il suo JSDoc cita già il pacchetto della Feature 10 come chiamante, quindi l'opzione `source` di WP1 è l'innesto previsto.
  - `insertRecipeWith` crea anche la riga di `recipe_prefs` e accetta `created_at` facoltativo (`recipe-repo.ts:137`, `:160`). Il caricatore non deve fare altro, e R2 non richiede modifiche al repository.
  - `findSimilarRecipeTitle` confronta `similarity(title, $1) > 0.6` sui titoli grezzi, per household (`recipe-repo.ts:236-255`). `acquireRecipeGenerationLock` è un advisory lock di transazione globale (`:276-278`). `slugExists` è globale, non per household (`:260`).
  - `listRecipeTitles` senza `limit` restituisce tutti i titoli. Il set `known` del caricatore è quindi completo.
  - `deleteTestHousehold` cancella in cascata ricette, ingredienti e preferenze (`schema.ts`, `onDelete: 'cascade'`). L'household usa-e-getta di WP6 è pulito.
  - CI (`gate.yml`), sviluppo e produzione usano tutti `postgres:16-alpine`. Un test DB in CI vede lo stesso `pg_trgm` e la stessa locale del Raspberry.
  - L'healthcheck dell'app ha `start_period: 60s` (`docker-compose.prod.yml:55`). Un caricamento atteso di qualche secondo non lo mette in difficoltà.
  - I mock di `tests/instrumentation.test.ts` usano `@/lib/…` mentre `instrumentation.ts` importa `./lib/…`. Vitest li unifica già per bootstrap e classificazione, quindi il mock di `@/lib/recipes/pack/load` di WP6 funziona.
  - Nessun test esistente conta le ricette dell'household di default: `pnpm recipes:pack load` sul DB di sviluppo (C7) non rompe il gate.
  - Gli elenchi "File" dei WP di wave 2 non si sovrappongono.
- **Stato del workspace:** `.claude/agentic-feature-factory.local.md` ha una modifica non committata, `implementer: haiku` al posto di `sonnet`. Ne tiene conto R4.
- **Non verificato:** il gate non è stato eseguito (nessuna modifica al codice). Non ho misurato come `pg_trgm` di `postgres:16-alpine` tratta le lettere accentate: dipende dalla locale del cluster, ed è proprio per questo che R1 propone un test invece di una stima. Non ho misurato il tempo di `tsc` con un JSON da circa 700 KB (R7).

---

## 1. Problemi attuali (ordinati per impatto)

### P1 — `created_at` fa da criterio di rilevanza in due punti · **da tenere d'occhio** (diventa visibile con R2)

**File:** `lib/domain/library.ts:70-77` (`compareLibraryCards`: preferite, poi `created_at` decrescente, poi titolo), `lib/recipes/generate.ts:66-69` (`listRecipeTitles(..., { limit: EXCLUDED_TITLES_IN_PROMPT })`, i 150 titoli più recenti nel prompt), `lib/db/repositories/recipe-repo.ts:194-218`.

Due comportamenti danno per scontato che le ricette arrivino poche alla volta, generate o salvate dall'utente: l'ordine della Libreria ("le più nuove in alto") e l'elenco dei titoli da evitare nel prompt ("le più recenti"). Oggi funziona perché le ricette entrano a gruppi di 1–5. Le sole ricette inserite in blocco, quelle d'esempio del seed, hanno già una data fissa (`FIXTURE_CREATED_AT`, `fixtures/index.ts:16`, usata da `lib/db/seed-core.ts:88`). È il precedente da seguire.

### P2 — I confini tra moduli sono regole scritte, non controllate dal lint · **da tenere d'occhio**

**File:** `.eslintrc.json` (solo `next/core-web-vitals`), `CLAUDE.md` («Regole di architettura»).

"Il dominio non importa DB né LLM" e "solo `recipes` parla con `lib/llm/`" valgono solo perché chi scrive e chi rivede ci sta attento. Oggi sono rispettate: `lib/domain/**` non importa `@/lib/db` né `@/lib/llm`. Fuori da `lib/recipes`, `lib/llm` è importato solo per `isLlmError` (`lib/http/responses.ts:5`, `lib/plans/service.ts:58`), cioè per tradurre gli errori, non per chiamare il modello. Il piano aggiunge un confine nuovo e più fragile (R5).

### P3 — Un filtro vincolante con una fonte probabilistica · **da tenere d'occhio, fuori ambito**

**File:** `lib/domain/recipe-text.ts` (`expandDietFlags`, `normalizeGeneratedRecipe`), `lib/recipes/constraints.ts` (`findConstraintViolations`), `lib/llm/prompts.ts:30` (riga `diet_flags`).

Le diete delle ricette generate le decide il modello. `expandDietFlags` ne garantisce la coerenza interna (vegano ⇒ vegetariano ⇒ pescetariano), non la correttezza. Il pacchetto introduce una seconda fonte, per regola dalla tabella degli ingredienti (spec D6). Le due convivono nello stesso filtro della Libreria e del planner. Non è un problema di questa feature, che anzi migliora 200 ricette. Va però ricordato: la tabella è il primo passo verso diete per regola anche per le ricette generate, a patto di gestire i nomi senza voce, che oggi `deriveDietFlags` rifiuta. Nessuna azione ora; nota per `docs/v2-funzionalita.md` alla chiusura.

### P4 — `lib/domain/types.ts` come contenitore unico · **cosmetico, nessuna azione**

**File:** `lib/domain/types.ts` (864 righe). Con il blocco "Recipe Pack" arriva a circa 1.030, e diversi schemi nuovi servono solo agli strumenti (`PackDatasetRowSchema`, `PackCandidateSchema`, `PackConversionRecordSchema`, `PackStatsSchema`). La regola del progetto lo chiede e req. P2 lo motiva, con il precedente di `ClassifyRecipeItem`. Spezzare il file adesso non si ripaga.

### Aree senza problemi da segnalare

- **Punto unico di scrittura delle ricette** (`insertGeneratedRecipe`): il piano lo estende con un parametro opzionale invece di aprire un secondo percorso (spec D9). I chiamanti non cambiano.
- **Transazione, lock e titoli noti**: `loadRecipePack` ricalca `generateAndStoreRecipes` (`generate.ts:80-120`) passo per passo, compreso l'aggiornamento di `known` dopo ogni inserimento.
- **Avvio**: il caricamento atteso dentro il `try` del bootstrap, con un `try/catch` proprio e senza `process.exit`, rispetta la struttura di `instrumentation.ts`. La classificazione resta in background dopo il pacchetto.
- **Adattatore LLM**: `convertDatasetRecipe` e `draftIngredientFacts` copiano `classifyRecipes` (`runStructuredCall`, riparazione, `LlmError`). Il provider resta configurazione.
- **Bundle**: solo `load.ts` entra nell'app, tramite import dinamico come la classificazione, e `lib/recipes/index.ts` non esporta `pack` (req. P23).
- **Test senza rete e senza dataset**: CSV inventato, modello finto, cartelle temporanee. Il dataset non entra mai in CI.

---

## 2. Rischi introdotti o amplificati dalla feature

### R1 — Due misure di similarità: il pacchetto può perdere ricette in silenzio · **da tenere d'occhio (il più probabile)**

`select` e `build` scartano i titoli simili con `areTitlesSimilar`, una reimplementazione offline di `pg_trgm` che toglie gli accenti (req. P5). Il caricatore invece chiede al DB `findSimilarRecipeTitle`, **anche contro le ricette del pacchetto appena inserite nella stessa transazione**. Le due misure non coincidono:
- `pg_trgm` non toglie gli accenti (req. §4 lo ammette);
- il modo in cui tratta le lettere accentate (lettera o separatore) dipende dalla locale del cluster `postgres:16-alpine`, che nessun documento fissa.

Se per `pg_trgm` due titoli del pacchetto superano 0,6 e per la misura offline no, su un'installazione pulita il secondo viene saltato. Il log riporta `già presenti o simili: 1` e nessuno lo nota. Il piano lo scopre solo in C7 (smoke: conteggio ≠ 200), cioè dopo conversione, revisione della tabella e `build`, e senza dire quale titolo è saltato. Sul Raspberry, dove i saltati sono attesi per via delle 26 ricette, non si distinguerebbe più dal caso normale.

Il test delle invarianti di WP1 usa la stessa misura offline, quindi non può accorgersene. Serve un test che chieda al DB vero.

### R2 — Il caricamento in blocco mette 200 ricette, contorni in testa, sopra quelle dell'utente · **da tenere d'occhio, visibile all'utente** — amplifica P1

Il caricatore inserisce le ricette nell'ordine del file (primi, secondi, piatti unici, contorni) con `created_at = new Date()` riga per riga (`insertRecipeWith`, `recipe-repo.ts:137`). Con `compareLibraryCards`:
- la Libreria si apre con le **60 ricette solo contorno**, che fino alla F11 il piano non usa (spec FR-5);
- seguono piatti unici, secondi e primi;
- le 26 ricette del Raspberry, le uniche con voti e usi, finiscono in fondo, dopo 200 card.

Lo stesso ordine riempie i 150 titoli "da evitare" del prompt di generazione (`generate.ts:66`) con titoli del pacchetto, contorni compresi, anche se la generazione chiede solo piatti da pasto. Il controllo di similarità in transazione resta la vera difesa contro i doppioni, ma la generazione spreca più proposte. Con D10 succede di rado.

### R3 — Quattro copie della stessa lettura di file JSON · **da tenere d'occhio**

La logica "leggi un JSON di lavoro; se manca fai X; se non è valido `PackError('File non valido: <percorso>: <primo messaggio>')`" compare in quattro punti scritti da tre WP diversi:
- `readCandidates` (WP2);
- `readRecords` (WP4);
- la lettura della tabella dentro `runConvert` (WP4, passo 4.2);
- `readIngredientsFile` (WP5).

La terza e la quarta sono **la stessa funzione scritta due volte**: WP4 viene prima di WP5 e non può importarla. Con implementer diversi e in wave diverse, il primo messaggio di zod, il caso di `JSON.parse` e l'`ENOENT` divergeranno nei dettagli, e i test a messaggio esatto lo fisseranno.

### R4 — WP4 è il work package più grande e il più delicato · **da tenere d'occhio**

WP4 crea quattro moduli (`state`, `checks`, `convert`, `report`) e tre file di test, ed è l'unico punto con logica concorrente: il pool con `Promise.race` su un insieme di promesse, il tetto `accepted + inFlight < quota` e il secondo tentativo. È anche l'unico WP della wave 3, quindi blocca da solo WP5 e WP7. Con `implementer: haiku` (modifica non committata della configurazione) è il WP con la probabilità più alta di un gate rosso o di un pool sottilmente sbagliato, per esempio chiamate oltre la quota o un'attesa che non termina. WP5, però, non dipende da `convert.ts`: gli servono solo `state.ts` e `report.ts`.

### R5 — "Gli strumenti non aprono il DB" senza guardia · **cosmetico** — amplifica P2

Req. P7 vieta `@/lib/db` in `lib/recipes/pack/**` tranne `load.ts`. Se un implementer ci importasse anche solo un tipo con un import non `type`, il modulo `lib/db/index.ts` aprirebbe il pool in `select`, `convert` o `build`. Lo script non chiuderebbe `client` e resterebbe appeso a fine comando. I criteri di accettazione lo controllano a occhio ("nessun import di `@/lib/db`").

### R6 — Complessità · **proporzionata nel complesso; un eccesso cosmetico**

Il piano è lungo (1.600 righe) per strumenti che girano una volta, ma la lunghezza viene dalle salvaguardie del repository pubblico (E3, nessun link), dalla revisione dell'utente in due punti e dal riuso dichiarato per la V2 (intero dataset). La rete di sicurezza vera è il test delle invarianti sul file committato (FR-2.2), e il piano ce l'ha.

L'eccesso sta nei test a **testo esatto** dei file che solo l'utente legge: `renderReport` («confrontato con il testo atteso»), `ingredients-review.md` e le righe stampate dal comando. Il testo esatto serve dove il file si rilegge (`selection.md`, con l'andata e ritorno di `parseSelection`) o dove un messaggio dice all'utente cosa fare (`PackError`). Per il report basta verificare le parti che contano.

### R7 — Punti controllati senza azione

- **Tempo d'avvio**: circa 5–6 query per ricetta (slug, similarità, tre inserimenti), circa 1.200 in una transazione locale. Sotto i 10 s della spec anche sul Pi, e l'healthcheck concede 60 s.
- **"Nessuna query di similarità ai riavvii" (spec §5)** non vale sul Raspberry: le ricette del pacchetto saltate perché simili alle 26 non entrano mai in `known` e si ricontrollano a ogni avvio. Costo trascurabile; la riga `[pack]` di DEPLOY §5 resta corretta.
- **Copertura per pasto**: il primo piano senza modello richiede almeno 9 piatti da pasto freschi per pasto dopo i filtri. Con 140 piatti è quasi certo, e le statistiche di `build` e la verifica C7.4 lo mostrano.
- **`tsc` sul JSON da circa 700 KB** (`resolveJsonModule`): da misurare in C7. Se il typecheck rallenta in modo evidente, se ne riparla allora.
- **Diete con ingredienti `q.b.`**: contano (spec §4.2). È la scelta prudente giusta.

---

## 3. Proposte e punto di innesto

| ID | Proposta concreta | Dimensione | Dove si innesta | Quando |
|---|---|---|---|---|
| **R1** | **Il pacchetto vero entra tutto in una libreria vuota, verificato sul DB.** In `tests/recipes/pack/load.test.ts`, caso nuovo: household usa-e-getta, `loadRecipePack({ householdId, logger })` con le ricette di default (`RECIPE_PACK_RECIPES`). Poi si leggono i titoli inseriti (`listRecipeTitles(db, householdId)`) e `expect(RECIPE_PACK_RECIPES.map((r) => r.title).filter((t) => !inserted.has(t))).toEqual([])`: un errore nomina i titoli saltati. Con il pacchetto vuoto passa senza `skipIf`, perché l'elenco è vuoto. Gira in CI con lo stesso `postgres:16-alpine` di produzione. In **C5**, aggiungere dopo `build`: «lancia `pnpm test tests/recipes/pack/load.test.ts`; se nomina titoli saltati, trattali come i titoli simili di `build`: togli la spunta a uno dei due, poi `convert` → `ingredients` → `build`». Non serve rendere più prudente `areTitlesSimilar`: il test è la guardia, e rende inutile indovinare la locale del DB | Piccola (un caso di test + una riga in C5) | **WP6** (test) e **C5** | Durante |
| **R2** (P1) | **Data di creazione fissa per le ricette del pacchetto**, come le ricette d'esempio del seed. In **WP1**: `InsertGeneratedRecipeOptions` riceve anche `createdAt?: Date`, passato come `created_at: options.createdAt` a `insertRecipeWith`, che fa già `?? new Date()`. In `fixtures/recipe-pack.ts`: `export const RECIPE_PACK_CREATED_AT: Date = new Date('2026-01-01T00:00:00Z');`, con il commento «come `FIXTURE_CREATED_AT`: in Libreria sotto le ricette dell'utente, in ordine di titolo». Un caso in più in `tests/recipes/store.test.ts` (`createdAt` passato → `created_at` uguale). In **WP6**: il caricatore chiama `insert(tx, householdId, recipe, { source: 'manual', createdAt: RECIPE_PACK_CREATED_AT })`; `load.test.ts` verifica `created_at` sul primo caso. In **WP8**: nel punto di ARCHITECTURE §7, «con origine `manual` e data di creazione fissa (in Libreria sotto le ricette dell'utente)». Effetto: le ricette dell'utente, vecchie e nuove, restano in cima; il pacchetto segue in ordine alfabetico; i titoli recenti del prompt sono quelli dell'utente | Piccola | **WP1** (passi 4 e 8, test store), **WP6** (passo 1, test), **WP8** (passo 2) | Durante |
| **R3** | **Un solo lettore e scrittore dei file JSON di lavoro.** In **WP1**, nuovo `lib/recipes/pack/files.ts`: `readJsonFile<T>(filePath: string, schema: z.ZodType<T, z.ZodTypeDef, unknown>, onMissing: () => T): Promise<T>`. Su `ENOENT` restituisce `onMissing()`, che può anche lanciare la `PackError` «Manca …». Su JSON o schema non validi lancia `PackError(\`File non valido: ${filePath}: ${primo messaggio}\`)`, dove il primo messaggio è quello di `JSON.parse` o del primo issue zod, come `path: messaggio`. Accanto, `writeJsonFile(filePath, value)`: crea la cartella del file, scrive JSON a 2 spazi e `\n` finale. Test in `tests/recipes/pack/files.test.ts`: assente, JSON rotto, schema rotto, andata e ritorno. Lo usano: `readCandidates` e la scrittura dei candidati (WP2); `readRecords`, `writeRecord` e la lettura della tabella in `runConvert`, che diventa `readJsonFile(file, PackIngredientsFileSchema, () => ({ ingredients: [] }))` (WP4); `readIngredientsFile` (WP5). La scrittura della tabella resta `formatIngredientsFile` (formato a una voce per riga) | Piccola | **WP1** (file nuovo + test), poi WP2 passo 7, WP4 `state.ts` e passo 4.2, WP5 passo 2 | Durante |
| **R4** | **Dividere WP4 e semplificare il pool.** **WP4a — Stato, controlli e report** (wave 3): `state.ts`, `checks.ts`, `report.ts` con `checks.test.ts` e `report.test.ts`. **WP4b — Conversione** (wave 4, **in parallelo a WP5**): `convert.ts` + `convert.test.ts`. WP5 dipende da WP3 e WP4a, non da WP4b; WP7 dipende da WP2, WP4b, WP5 e WP6. Le wave restano cinque e i file di WP4b e WP5 sono disgiunti. Il pool di `runConvert`, al posto di `Promise.race` su un insieme, diventa `concurrency` worker su una coda condivisa: `const worker = async () => { while (queue.length > 0 && accepted + inFlight < quota) { const code = queue.shift()!; inFlight++; try { if ((await convertCandidate(code)) === 'accepted') accepted++; } finally { inFlight--; } } }; await Promise.all(Array.from({ length: concurrency }, worker));`. La semantica di req. P15 resta: mai oltre la quota, mai più di `concurrency` in corso. Dopo uno scarto il parallelismo può scendere sotto `concurrency`, ma il worker che ha visto lo scarto continua: va detto in un commento di una riga | Piccola (riorganizzazione del piano; codice più corto) | §0.6, WP4 → WP4a + WP4b, "Dipende da" di WP5 e WP7, mappa delle dipendenze | **Prima** di `/feature-dev` |
| **R5** (P2) | **Il confine come regola di lint.** In `.eslintrc.json`, un `overrides` con `files: ["lib/recipes/pack/**/*.ts"]`, `excludedFiles: ["lib/recipes/pack/load.ts"]` e `"no-restricted-imports": ["error", { "patterns": [{ "group": ["@/lib/db", "@/lib/db/*"], "message": "Gli strumenti del pacchetto non aprono il DB (Feature 10, req. P7)." }] }]`. Nello stesso `overrides`, una voce per `lib/domain/**/*.ts` con i gruppi `@/lib/db`, `@/lib/db/*`, `@/lib/llm`, `@/lib/llm/*`: oggi è già rispettata, quindi non rompe nulla. Il criterio di accettazione "nessun import di `@/lib/db`" di WP2, WP4 e WP5 diventa automatico | Piccola | **WP1** (aggiungere `.eslintrc.json` all'elenco "File") | Durante |
| **R6** | **Testo esatto solo dove serve.** In WP4 (`report.test.ts`) e WP5 (`ingredients.test.ts`, review md) le asserzioni diventano `toContain` sulle parti che contano: intestazione del gruppo con `accettate n/quota`, riga della ricetta con codice e link, `- avviso: …`, `Nessuna.`, le tabelle delle statistiche con i totali. Il testo esatto resta per `selection.md` (andata e ritorno), per i messaggi di `PackError` e per i log `[pack]` | Piccola (riduce lavoro) | WP4 (test di `report.ts`), WP5 (test della review) | Durante |

Nessuna proposta per P3 (nota per la V2 alla chiusura), P4 e R7.

---

## 4. Se potessi migliorare solo 3 cose prima di procedere

1. **Il test che carica il pacchetto vero sul DB — R1.** È l'unico punto in cui la feature può fallire il suo scopo senza che nessuno se ne accorga: ricette saltate in silenzio su un'installazione pulita, per una differenza tra due misure di similarità che nessuno sa prevedere senza provarla. Costa un caso di test. Sposta la scoperta da C7 (smoke, dopo ore di conversione e revisione, senza nomi) al primo `pnpm test` dopo `build`, con l'elenco dei titoli da sistemare. Resta poi a guardia di ogni versione futura del pacchetto.
2. **La data di creazione fissa — R2.** È la sola conseguenza della feature che l'utente vede al primo sguardo dopo il deploy: la Libreria che si apre con 60 contorni non pianificabili sopra le sue 26 ricette, le uniche con voti e usi. Costa un'opzione e una costante, segue un precedente che esiste già (`FIXTURE_CREATED_AT`) e sistema anche l'elenco dei titoli recenti del prompt. Dopo il deploy va corretto con una migrazione dei dati: farlo adesso costa dieci righe.
3. **Dividere WP4 e scrivere il pool come worker su una coda — R4.** WP4 è il collo di bottiglia del piano (unico WP della wave 3) e contiene l'unica logica concorrente, affidata al tier più piccolo. Diviso, la parte pura arriva prima e WP5 parte insieme alla conversione invece di aspettarla. La forma a worker è più corta e più facile da verificare di `Promise.race` su un insieme. Costa una riscrittura della mappa delle wave, non codice in più.

R3 (un solo lettore dei file) è la quarta: vale la pena innestarla in WP1 insieme alle altre, perché costa poco e toglie una funzione scritta due volte.
