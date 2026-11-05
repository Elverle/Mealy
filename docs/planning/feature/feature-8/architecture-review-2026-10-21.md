# Architecture review — Feature 8 (Portate delle ricette e nuove etichette di stile)

**Data:** 2026-10-21 · **Piano esaminato:** [`plan.md`](plan.md) (+ [`requirements.md`](requirements.md), [`spec.md`](spec.md)) · **Contesto:** as-built di F1–F7 e F9 (`main`, merge `ea39c59`, v0.7.1), spunti delle feature 10 e 11 (`../feature-11/brainstorm-prompt.md`; quello della 10 non è più nel repository), `docs/DEPLOY.md`, `CLAUDE.md`.

**Esito in una riga:** niente di bloccante e nessun refactoring preliminare. Il piano poggia sui punti giusti: un solo motivo di esclusione nel planner basta per sorteggio, swap, candidate, assegnazione e conteggio delle fresche. Conviene però **dividere WP1**, che oggi concentra in un solo work package sequenziale l'intera onda d'urto del campo nuovo (R1). Conviene anche **dare a portata e vincoli un solo predicato**, che la Feature 11 cambierà di nuovo (R2), e **scrivere nella guida di deploy** che dopo questa versione si torna indietro solo ripristinando il dump (R3).

> **Nota sugli ID.** `P1…P5` e `R1…R6` sono gli ID di questa review. Le decisioni di `requirements.md` (`U1…U3`, `P1…P24`) sono citate come «req. U*n*» / «req. P*n*»; quelle della spec come «spec D*n*» / «FR-*n*».

## Metodo e prove raccolte

- **Letti per intero:** `plan.md` (7 WP, 3 wave), `spec.md`, `requirements.md`, il brainstorm della F11. Sul codice: `lib/domain/{types,planner,planner-config,library,recipe-text}.ts`, `lib/recipes/{constraints,generate,propose,store,errors}.ts`, `lib/llm/{adapter,prompts,model,errors,index}.ts`, `lib/db/{index,schema,bootstrap,seed-core,seed}.ts`, `lib/db/repositories/recipe-repo.ts`, `instrumentation.ts`, `scripts/llm-record.ts`, le parti toccate di `lib/plans/service.ts` (selezione, swap, candidate, assegnazione), `components/sheets/recipe-detail.ts`, `components/{cards/meal-card,library/recipe-card,library/library-filters,plan/plan-slot-card,sheets/recipe-sheet}.tsx`, `tests/db/bootstrap.test.ts`, `tests/instrumentation.test.ts`, `tests/helpers/{db,mock-llm}.ts`, `fixtures/{index.ts,recipes.json}`, le fixture LLM.
- **Ipotesi del piano controllate sul codice:**
  - Tutti i percorsi di ammissione passano da `exclusionReason` (`lib/domain/planner.ts:54`): `selectRecipes` (`:243`), la pre-assegnazione di *Ripeti* (`lib/plans/service.ts:328`), lo swap (via `selectRecipes`), `listSlotCandidates` (`:730`) e `assignSlotRecipe` (`:767`) tramite `manualChoiceExclusionReason`. Il motivo `course` di WP2 copre quindi davvero FR-3.1 e FR-3.2 con una riga.
  - I chip di stile delle Impostazioni iterano `MEAL_STYLE_TAG_VALUES` (`components/settings/settings-fields.tsx:270`) e `normalizeSettings` usa lo stesso elenco (`lib/settings/normalize.ts:32`): le 12 etichette arrivano senza codice nuovo.
  - Tutte le chip delle card e del dettaglio nascono da `recipeChips` (`components/sheets/recipe-detail.ts`), usata da `RecipeCard`, `PlanSlotCard`, `toRecipeDetail` e `proposalToRecipeDetail`. Il WP4 tocca il punto giusto.
  - `fixtures/index.ts` valida `recipes.json` **all'import**: senza `courses` nel file, qualunque test che importa `@/fixtures` fallisce. Il piano lo mette correttamente in WP1.
  - `tsconfig.json` include i test: un campo obbligatorio nei tipi di uscita rompe la compilazione di ogni letterale tipato (vedi P3).
  - La variante `basil-subtle` esiste ed è già usata (`components/plan/plan-screen.tsx:651`).
  - Gli elenchi "File" dei WP non si sovrappongono dentro nessuna wave.
- **Non verificato:** il gate non è stato eseguito (nessuna modifica al codice). Non ho verificato se in produzione Next condivide le istanze dei moduli tra `instrumentation.ts` e le rotte (P4). Nessuna chiamata LLM reale.

---

## 1. Problemi attuali (ordinati per impatto)

### P1 — Le regole di ammissione esistono in due copie tenute insieme da un commento · **da tenere d'occhio**

**File:** `lib/domain/planner.ts:47-76` (`exclusionReason`), `lib/recipes/constraints.ts:43-90` (`findConstraintViolations`).

Le due funzioni applicano le stesse regole (pasto, diete, elettrodomestici, ingredienti scartati) a due forme diverse: ricette in libreria e ricette appena generate. Le lega solo il commento «se cambi una, controlla l'altra». Era già il P2 della review della F9. Questa feature aggiunge una quinta regola a entrambe, la portata. La Feature 11 la cambierà di nuovo in entrambe: da "fa da pasto" a "ha la portata dello slot" (`../feature-11/brainstorm-prompt.md`, "Modello dati proposto"). Il piano scrive la regola due volte con due semantiche: `isMainDish(recipe.courses)` nel planner e `recipe.courses.some(c => constraints.courses.includes(c))` nei vincoli. Le due formule coincidono solo perché oggi l'elenco ammesso è sempre `MAIN_COURSE_VALUES`.

### P2 — I valori degli elenchi chiusi letti dal DB sono validati in modo rigido · **da tenere d'occhio**

**File:** `lib/db/repositories/recipe-repo.ts:88` (`RecipeSchema.parse` in `toRecipeWithDetails`), `lib/db/repositories/household-repo.ts:24, 61, 123` (`HouseholdSchema.parse`).

Ogni lettura di una ricetta o dell'household valida gli array di testo del DB contro gli enum Zod. Basta un valore sconosciuto in una riga per far fallire la lettura **dell'intera libreria**, e con lei Libreria, Piano, selettore e Impostazioni (500). È una scelta coerente: rende visibile un dato sporco invece di nasconderlo. Però trasforma ogni modifica a un elenco chiuso in un cambiamento dei dati che non torna indietro:

- **aggiungere** valori (questa feature) è sicuro in avanti, ma rompe una versione precedente che rilegge quei dati (R3);
- **togliere** valori (la F11 toglierà l'etichetta `piatto-unico`) richiede una migrazione che li rimuova da `recipes.tags` e `households.meal_style_tags` nello stesso rilascio, altrimenti l'app non legge più la libreria.

Non propongo una validazione tollerante: nasconderebbe errori veri. Propongo di renderlo esplicito dove serve (R3, e il contratto per la F11 in §3).

### P3 — Dati di test costruiti a mano in decine di file · **da tenere d'occhio**

**File:** fabbriche `makeRecipe` locali in 8 file (`tests/domain/planner.test.ts:62`, `tests/domain/library.test.ts:37`, `tests/ui/recipe-detail.test.ts:18`, …) e circa 130 letterali con `meal_types:` in 38 file di `tests/`.

Non c'è una fabbrica condivisa di `Recipe`, `GeneratedRecipe` o `LibraryRecipeCard`. Ogni campo obbligatorio nuovo dei tipi di dominio deve quindi entrare a mano in decine di file. Il piano lo sa (WP1, passo 12) e dà regole chiare per i valori. Il costo però si ripresenterà alla F11 (`course` sugli slot, composizioni dell'household). Non vale una migrazione di massa ora. Conviene invece smettere di aggiungere fabbriche locali: vedi R1.

### P4 — Il pool di connessioni è un singleton solo fuori dalla produzione · **da tenere d'occhio (oggi inerte)**

**File:** `lib/db/index.ts:13-14`.

`globalForDb.conn` viene salvato solo con `NODE_ENV !== 'production'`, per l'HMR. In produzione il singleton dipende dalla cache dei moduli. Oggi nessun codice di `instrumentation.ts` importa `lib/db/index.ts`: il bootstrap usa una connessione propria e la chiude (`lib/db/bootstrap.ts:47-91`). Con WP6, `instrumentation.ts` importerà `lib/recipes/classify`, quindi `@/lib/db`. Se Next compila l'hook di avvio in un grafo di moduli separato da quello delle rotte (non verificato), in produzione nascerebbe un secondo pool. Avrebbe al più una connessione aperta e mai chiusa, perché il pool non ha `idle_timeout`. Sul Raspberry è innocuo (Postgres ne ammette 100), ma è una connessione che nessuno sa di avere.

### P5 — `tests/db/seed.test.ts` gira sui dati condivisi del DB di sviluppo · **cosmetico**

**File:** `tests/db/seed.test.ts:19-31`, nota della Feature 9 in `docs/planning/feature-index.md`.

È già noto che il test fallisce se una ricetta d'esempio è stata usata in un piano. WP1 vi aggiunge un caso che azzera `courses` **e** `tags` di una ricetta d'esempio sul DB di sviluppo e poi rilancia il seed. Funziona, perché il seed stesso ripristina, ma allarga la superficie dei test che dipendono dallo stato del DB condiviso. Gli altri test DB usano household dedicati e non toccano quelle ricette, quindi il rischio di interferenze tra file paralleli è basso.

### Aree senza problemi da segnalare

- **Confine LLM:** solo `lib/recipes/*` chiama `lib/llm/`. Il piano lo rispetta: la classificazione sta in `lib/recipes/classify.ts` e `instrumentation.ts` importa il servizio, non l'adapter.
- **Planner puro:** l'esclusione per portata non tocca pesi, ordinamento né `needMore`. Li eredita da `eligibleByMeal`, ed è la scelta più economica possibile.
- **Migrazioni:** drizzle-kit con journal controllato da `tests/db/bootstrap.test.ts`. Il test di WP1 su DB usa-e-getta riusa quello schema. Filtrare il journal a `idx < 5`, invece di togliere l'ultima voce, è la scelta giusta: regge le migrazioni future.
- **Concorrenza della classificazione:** la scrittura condizionata (`cardinality(courses) = 0`) basta. Le etichette sono calcolate da quelle lette prima della chiamata al modello, ma nell'app non esiste un percorso che modifichi le etichette di una ricetta esistente, quindi non ci sono aggiornamenti persi.
- **Filtro della Libreria:** una sola funzione pura (`matchesLibraryFilter`) serve sia il filtro in memoria sia `GET /api/recipes`. Il piano la estende senza duplicarla.

---

## 2. Rischi introdotti o amplificati dalla feature

### R1 — WP1 concentra in un solo WP sequenziale tutta l'onda d'urto del campo nuovo · **da tenere d'occhio** — amplifica P3

WP1 tiene insieme tre cose di natura diversa:

1. i contratti puri, cioè tipi, `courses.ts` e fixture;
2. la parte DB: colonna, migrazione con `UPDATE`, test su DB usa-e-getta, due funzioni di repository, seed con completamento;
3. il ritocco di circa 40 file di test.

Tutto il resto aspetta WP1, e l'implementer configurato è `haiku` (`.claude/agentic-feature-factory.local.md`). Se WP1 si inceppa, per esempio sulla generazione della migrazione o sul test del seed, si ferma la feature intera, compresi i WP che col DB non hanno nulla a che fare (WP3, WP4, WP5).

La divisione è possibile senza allungare la catena. Senza la colonna, le letture restano valide: `RecipeSchema.courses` ha `.default([])` e `InsertRecipeInput.courses` è opzionale. Un WP1a "solo contratti" lascia quindi il gate verde anche senza migrazione.

### R2 — La regola di portata nasce in due formule diverse che la F11 dovrà riscrivere entrambe · **da tenere d'occhio** — amplifica P1

Vedi P1. Il piano introduce `isMainDish` (planner) e un confronto inline con `constraints.courses` (vincoli). Le due formule danno lo stesso risultato solo con l'elenco `MAIN_COURSE_VALUES`. La F11 renderà l'elenco variabile per slot, e allora divergeranno se non nascono dalla stessa funzione.

### R3 — Dopo il deploy di questa versione non si torna indietro senza ripristinare il dump · **da tenere d'occhio** — attiva P2

La migrazione `0005` aggiunge una colonna, e il suo `UPDATE` scrive `pochi-ingredienti` su quasi tutte le ricette. La classificazione aggiunge poi `tradizionale`, `dal-mondo`, ecc. La 0.7.1 legge le ricette con l'enum a 7 valori: dopo il deploy, tornare all'immagine precedente (procedura di `docs/DEPLOY.md` §6) produrrebbe una Libreria e un Piano che rispondono 500. Lo stesso vale per l'household, se nel frattempo nelle Impostazioni si è scelta un'etichetta nuova.

`DEPLOY.md` §6 dice già di ripristinare il dump `predeploy` "se la versione nuova aveva cambiato lo schema". Qui lo schema cambia, quindi la regola si applica. Non è però ovvio che il motivo vero siano i **dati**: anche senza colonna nuova, tornare indietro senza dump romperebbe l'app. Il WP7 non lo prevede.

### R4 — Dettagli d'implementazione da far trovare già decisi all'implementer · **cosmetico**

- **`runStructuredCall<T>` generico (WP3, passo 4).** Con AI SDK 7, `Output.object({ schema })` deduce il tipo di `result.output` dallo schema. Su uno `z.ZodType<T>` generico, la deduzione può dare `unknown` e spingere a cast poco leggibili. Il comportamento resta corretto; è solo attrito di tipi.
- **Test di `instrumentation` (WP6).** Il piano dice giustamente di mockare `@/lib/recipes/classify`. Vitest risolve `./lib/...` e `@/lib/...` allo stesso file, come già succede per il bootstrap (`tests/instrumentation.test.ts:7-9`), quindi il caso "se Vitest non li unifica" del piano non si presenterà.

### R5 — Contesa sul modello al primo avvio sul Raspberry · **nessuna azione**

Al primo avvio dopo il deploy, la classificazione fa 3 chiamate in sequenza (26 ricette). Se nello stesso minuto l'utente genera il primo piano, le chiamate al provider si sommano: fino a 8 in parallelo per il piano, più una della classificazione. Con un limite di richieste al minuto stretto, una chiamata del piano potrebbe ricevere un 429, che l'app già gestisce come errore del provider. Il caso è improbabile e innocuo, e i lotti sequenziali sono già la mitigazione giusta (spec §5). Non propongo nulla.

### R6 — Complessità e scorciatoie · **nessun eccesso, una scorciatoia accettabile**

- **Proporzione:** il piano è proporzionato. La classificazione è un servizio con dipendenze iniettabili, come `generate.ts` e `propose.ts`; niente code, tabelle di stato o interfaccia (FR-4.8). Il flag `notConfigured` e il `logger` iniettabile servono ai test e allo script, non sono decorazione.
- **`ClassifyRecipeItemSchema` come schema Zod** si usa solo come tipo. Tenerlo in `types.ts` come schema rispetta la regola "unica fonte" del progetto, quindi va bene così.
- **Scorciatoia:** le fixture registrate in `recorded/` vengono ritoccate a mano (req. P19) e smettono di essere risposte reali al byte. È dichiarato, nessun test le legge, e la registrazione reale di chiusura ne produce una nuova. Accettabile.

---

## 3. Proposte e punto di innesto

| ID | Proposta concreta | Dimensione | Dove si innesta | Quando |
|---|---|---|---|---|
| **R1** (P3) | **Dividere WP1 in due.** **WP1a — Contratti, regole pure e fixture** (wave 1, da solo): passi 1–9, 12–15 del WP1 attuale (tipi, `courses.ts` + test, `normalizeGeneratedRecipe`, `toLibraryCard`, `buildConstraints` con `courses: null`, ritocchi dei test, fixture LLM e `recipes.json` + test delle fixture). **WP1b — Colonna, migrazione, repository e seed** (wave 2, in parallelo a WP3, WP4, WP5): passi 10, 11, 16–19 (schema, `0005` + test, `InsertRecipeInput.courses`, `listUnclassifiedRecipes`, `setRecipeClassification` + test, seed con regole e completamento + test). WP2 passa in wave 3 (dipende da WP1b per scrivere `courses` nello store) insieme a WP6 (dipende da WP1b e WP3) e WP7. Le wave restano tre; i file sono disgiunti (WP1b: `lib/db/*` e `tests/db/*`, mentre `fixtures/` resta in WP1a; WP2: `planner`, `lib/recipes/*`, `tests/plans/*`, `tests/recipes/*` tranne `classify.test.ts`). In WP1a creare anche **`tests/helpers/recipes.ts`** con `makeRecipe(overrides?)`, `makeGeneratedRecipe(overrides?)` e `makeLibraryCard(overrides?)` (valori di default validi, `courses: []` per `Recipe`/card e `['secondo']` per la generata), da usare in **tutti i test nuovi** della feature. Nessuna migrazione dei test esistenti | Piccola (riorganizzazione del piano + un helper di 40 righe) | WP1 → WP1a + WP1b; mappa delle dipendenze e §0.6 | **Prima** di `/feature-dev` |
| **R2** (P1) | **Un solo predicato per la portata.** In `lib/domain/courses.ts` (WP1a): `export function coursesAllowed(courses: readonly Course[], allowed: readonly Course[] \| null): boolean`, che vale `true` se `allowed === null`, se `courses` è vuoto (non classificata) o se `courses.some(c => allowed.includes(c))`. `isMainDish(courses)` diventa `coursesAllowed(courses, MAIN_COURSE_VALUES)`. In WP2, `findConstraintViolations` usa `!coursesAllowed(recipe.courses, constraints.courses)` al posto del confronto inline. Il caso "non classificata" non può capitare nei vincoli (`GeneratedRecipeSchema.courses` ha `.min(1)`), quindi il comportamento non cambia. Test in `tests/domain/courses.test.ts`: `null` → true; `[]` con qualsiasi elenco → true; `['contorno']` con le principali → false; `['secondo','contorno']` con `['contorno']` → true. Aggiornare il commento che lega le due funzioni: «la portata passa da `coursesAllowed`: la Feature 11 cambia solo l'elenco ammesso» | Piccola | WP1a (passo 5) e WP2 (passo 2) | Durante |
| **R3** (P2) | **Rendere esplicito che questa versione non si annulla senza dump.** In WP7, `docs/DEPLOY.md` §6, dopo il paragrafo sulle migrazioni: «Anche i dati possono impedire il ritorno: dalla 0.8 le ricette e le Impostazioni contengono etichette (e portate) che le versioni precedenti non conoscono, e la Libreria non si aprirebbe. Tornando a una versione precedente alla 0.8, ripristina sempre il dump `predeploy`.» In `plan.md`, sezione "Contratti consegnati alle feature successive", alla voce Feature 11: «togliere `piatto-unico` da `MEAL_STYLE_TAG_VALUES` richiede, nello stesso rilascio, una migrazione che lo rimuova da `recipes.tags` e `households.meal_style_tags` (`toRecipeWithDetails` e `HouseholdSchema.parse` rifiutano i valori sconosciuti)» | Piccola (testo) | WP7 (passo 2) e `plan.md` "Contratti consegnati" | Durante |
| **R4** | **Due note d'implementazione in WP3 e WP6.** WP3, passo 4: se la deduzione dei tipi di `Output.object` su uno schema generico costringe a cast, `runStructuredCall` riceve lo schema come `z.ZodType<T, z.ZodTypeDef, unknown>` e restituisce `result.output as T` con un commento di una riga; non introdurre altre astrazioni. WP6, passo 5: togliere la frase "se Vitest non li unifica…" e mockare `@/lib/recipes/classify` come si fa per il bootstrap | Piccola | WP3 (passo 4), WP6 (passo 5) | Durante |
| **P4** | **Singleton del pool anche in produzione.** In `lib/db/index.ts`: `globalForDb.conn ??= postgres(connectionString); export const client = globalForDb.conn;`, togliendo la condizione su `NODE_ENV` e aggiornando il commento («un solo pool per processo, anche se Next carica il modulo da più grafi, come l'hook di avvio»). Nessun effetto sui test, che importano un solo grafo. Così la classificazione all'avvio usa sempre lo stesso pool delle rotte | Piccola | WP6 (aggiungere `lib/db/index.ts` all'elenco "File") | Durante |
| **P5** | **Il caso nuovo del seed azzera solo `courses`.** In WP1b (oggi WP1, passo 17): `update recipes set courses = '{}' where id = …` senza toccare `tags`, poi `seedDatabase()` e le stesse verifiche. Il completamento riscrive comunque le etichette dal file, quindi il caso resta significativo, e il test lascia la riga com'era anche se si interrompe a metà | Piccola | WP1b (passo 17) | Durante |

Nessuna proposta per R5 e R6.

---

## 4. Se potessi migliorare solo 3 cose prima di procedere

1. **Dividere WP1 in WP1a (contratti) e WP1b (DB) — R1.** È l'unico punto che può fermare tutta la feature: un WP sequenziale grande, affidato al tier più piccolo, che mescola un ritocco meccanico di 40 file con una migrazione e un test su DB usa-e-getta. Diviso, il ritocco dei tipi sblocca subito UI, prompt e filtro, e la parte DB procede in parallelo. Costa una riscrittura della mappa delle wave, non codice.
2. **Un solo predicato `coursesAllowed` per planner e vincoli — R2.** Costa dieci righe ora e risparmia alla F11 di riscrivere la regola in due posti con semantiche già diverse. È il primo passo concreto per chiudere il debito "regole in due copie" (P1), senza il refactoring più grande di unificare `exclusionReason` e `findConstraintViolations`, che oggi non si ripaga.
3. **Scrivere in `DEPLOY.md` che dalla 0.8 il ritorno indietro richiede il dump, e lasciare il contratto alla F11 — R3.** È la sola conseguenza di questa feature che può far male ai dati veri sul Raspberry, e oggi la guida la copre solo per caso ("se la versione nuova aveva cambiato lo schema"). È testo, non codice, ma va scritto adesso: chi tornerà indietro lo farà in fretta e leggerà solo quel paragrafo.
