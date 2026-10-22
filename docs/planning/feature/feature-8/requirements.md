# Feature 8 — Portate delle ricette e nuove etichette di stile: Requisiti e Decisioni

Memoria del "perché" dietro `plan.md`. Spec: `spec.md` di questa cartella (brainstorming del 14 ottobre 2026), con le decisioni D1–D8 recepite come definitive. Riferimenti: `docs/ARCHITECTURE.md §4, §5.1, §5.2`, `docs/DESIGN.md §5, §6`, `docs/DEPLOY.md §5, §9`, `docs/rework-catalogo.md`, `docs/v2-funzionalita.md §0`.

## 1. Layout e identità

- **Layout**: `docs/planning/` (da `.claude/agentic-feature-factory.local.md`), cartella `docs/planning/feature/feature-8/` (esisteva già con `spec.md`).
- **Titolo**: Feature 8 — Portate delle ricette e nuove etichette di stile.
- **Prerequisiti**: Feature 1–7 e 9 in `main` (v0.7.1, merge `ea39c59`). Vale "il codice reale vince".
- **Non è nel backlog** né in `execution-strategy.md`: l'unica fonte dei requisiti è `spec.md`. Seguono la Feature 10 (pacchetto iniziale) e la 11 (composizione del pasto).

## 2. Decisioni prese con l'utente (2026-10-21)

| # | Decisione | Motivo |
|---|---|---|
| U1 | **La portata è un badge colorato distinto** (`Badge variant="basil-subtle"`), accanto al badge del tempo, separato dai chip di stile e dieta. Vale su card della Libreria, card del pasto nel Piano, card del selettore, dettaglio e proposta | Più facile da scorrere a colpo d'occhio rispetto a un chip grigio in mezzo alle etichette |
| U2 | **Su una ricetta classificata il chip di stile «Piatto unico» non si mostra**: lo dice già il badge di portata. Sulle ricette non classificate resta. Cambia solo la vista, i dati restano quelli di FR-2.4 | Evita lo stesso testo due volte sulla stessa card |
| U3 | **Filtro *Portata* in OR tra i suoi chip, gli altri gruppi restano in AND come oggi** | La spec diceva "in OR… come i filtri esistenti", ma `matchesLibraryFilter` oggi usa AND dentro ogni gruppo (`every`). In AND, *Primo* + *Secondo* non mostrerebbe quasi nulla. La frase della spec va letta così |

## 3. Decisioni di planning (prese leggendo codice e spec)

| # | Decisione | Motivo |
|---|---|---|
| P1 | **Otto work package in tre wave** (dopo l'architecture review del 2026-10-21, R1): WP1a da solo (contratti, regole pure, fixture, ritocchi dei test); poi WP1b (colonna, migrazione, repository, seed), WP3, WP4, WP5 in parallelo; poi WP2, WP6, WP7 in parallelo | Il campo `courses` obbligatorio nei tipi di uscita rompe la compilazione di decine di test e la validazione delle fixture: va introdotto in un colpo solo, a gate verde, prima di tutto il resto. La parte DB non serve a UI, prompt e filtro, quindi si sposta nella wave 2 |
| P2 | **Nuovo modulo puro `lib/domain/courses.ts`** con `normalizeCourses`, `isMainDish`, `courseLabel`, `countMeasuredIngredients`, `deriveStyleTags`, `FEW_INGREDIENTS_MAX` | Spec §4.2: le regole vivono in un solo posto del dominio, importabile anche dal client (serve a `courseLabel` nelle card) |
| P3 | **`CLASSIFY_BATCH_SIZE = 10` in `lib/domain/types.ts`**, accanto allo schema di classificazione, come `GENERATE_COUNT_MAX` | Lo usano sia l'adapter (tetto del lotto) sia `classify.ts`; `planner-config.ts` è del planner |
| P4 | **Portate scritte sempre in ordine canonico e senza doppioni** (`normalizeCourses`): in `normalizeGeneratedRecipe`, nello store, nella classificazione, nel seed. L'etichetta mostrata segue `COURSE_VALUES`: «Piatto unico · Secondo» | Un ordine solo, deterministico. Corregge l'esempio di FR-6.2 («Secondo · Piatto unico»), che non indicava un ordine |
| P5 | **`deriveStyleTags` si applica in `insertGeneratedRecipe`, nella risposta di `proposeRecipe`, nel seed e nella classificazione; non in `normalizeGeneratedRecipe`** | Lo store è il punto unico di scrittura (spec §4.6). Applicarla anche in `proposeRecipe` fa coincidere la proposta mostrata con la ricetta salvata. Tenerla fuori da `normalizeGeneratedRecipe` non cambia l'output dell'adapter e i suoi test, così WP2 e WP3 restano indipendenti |
| P6 | **`deriveStyleTags` restituisce le etichette nell'ordine di `MEAL_STYLE_TAG_VALUES`**; la migrazione SQL invece aggiunge `pochi-ingredienti` in coda | Come da spec §4.2. L'ordine nel DB non ha effetti: la classificazione riscrive comunque le etichette ordinate |
| P7 | **`buildConstraints` riceve un quinto parametro `courses: readonly Course[] \| null`**, obbligatorio (i due parametri intermedi diventano `T \| undefined` espliciti: TypeScript non ammette un obbligatorio dopo un opzionale). `generateAndStoreRecipes` passa sempre `MAIN_COURSE_VALUES` (piano, swap e anche `POST /api/recipes/generate`); `requestConstraints` passa `MAIN_COURSE_VALUES` se `mealType !== null`, altrimenti `null`; il ricontrollo di `saveProposedRecipe` passa `null` | Spec §4.4. La rotta `/api/recipes/generate` genera per la libreria con un tipo di pasto: ricette da pasto, quindi portata principale. Obbligatorio per non dimenticarlo in un chiamante |
| P8 | **In WP1 `buildConstraints` mette provvisoriamente `courses: null`**; WP2 introduce il parametro | `RecipeConstraintsSchema.courses` è obbligatorio: senza il valore il `parse` fallirebbe e il gate di WP1 non sarebbe verde |
| P9 | **Schema di output della classificazione**: `courses: z.array(CourseSchema)` **senza** `.min(1)`, `style_tags` ristretto ai 4 valori, `ref: z.string()` | Una riga con portate vuote non deve invalidare tutto il lotto (FR-4.3/FR-4.4): si scarta in `classify.ts`. Un valore fuori elenco invece fa fallire lo schema → una chiamata di riparazione → se resta invalido il lotto fallisce (FR-4.4). Gli enum guidano il modello |
| P10 | **La classificazione usa la stessa coppia chiamata + riparazione della generazione**, estratta in un helper privato generico dell'adapter; temperatura 0,2 in entrambe le chiamate | Un solo percorso di errori `LlmError`; la classificazione deve essere stabile, non creativa |
| P11 | **I log `[classify]` e il caso "modello non configurato" vivono in `classifyPendingRecipes`**, non in `instrumentation.ts` | Lo script `pnpm recipes:classify` e l'avvio stampano le stesse righe senza duplicare codice. `instrumentation.ts` cattura solo errori inattesi |
| P12 | **Con zero ricette da classificare** si stampa `[classify] nessuna ricetta da classificare` e non si risolve il modello | FR-4.6 chiede una riga iniziale; uno stack appena installato o senza chiave non deve loggare "modello non configurato" se non c'è nulla da fare |
| P13 | **`classifyPendingRecipes` accetta `householdId`** (default: household singleton) | I test girano in parallelo sullo stesso DB con household dedicati: senza filtro una classificazione toccherebbe ricette di altri test |
| P14 | **La scrittura condizionata usa `cardinality(courses) = 0`** e restituisce se ha scritto | Equivale a `courses = '{}'` della spec, ma non dipende dal letterale di array; serve a contare le classificate davvero |
| P15 | **Nel prompt di classificazione la descrizione è tagliata a 300 caratteri** e titolo e descrizione passano su una riga sola | Lotti da 10 restano brevi anche con descrizioni lunghe; niente a capo che rompano il formato |
| P16 | **`pnpm db:seed` completa anche le ricette d'esempio già presenti e non classificate** (per id, con portate ed etichette del file) e il rapporto conta `recipesClassified` | FR-5.1 ("dopo `pnpm db:seed` nessuna ricetta d'esempio è non classificata") vale anche per il DB di sviluppo già popolato, dove il seed oggi salta le ricette esistenti |
| P17 | **Portate ed etichette nuove delle 18 ricette d'esempio fissate nel piano** (tabella di WP1), con una sola ricetta solo contorno (*Patate e zucchine croccanti*) | Gli Implementer non devono inventare classificazioni; una ricetta solo contorno nel seed rende visibile FR-3.1 in sviluppo. I test del planner che la contavano tra le candidate si aggiornano in WP2 |
| P18 | **Le etichette delle fixture rispettano già le regole** (FR-2.3, FR-2.4): un test lo controlla come insieme | Il seed applica comunque `deriveStyleTags`, ma un file coerente evita differenze tra file e DB |
| P19 | **Fixture LLM**: `valid-2-recipes`, `generation-mixed`, `request-lasagne`, `request-lasagne-altra` ricevono `courses` (portata principale); `invalid-enum` e `malformed-truncated` restano come sono. Le cinque registrate in `recorded/` ricevono `courses` a mano: sono ritoccate, non più risposte reali al byte | Spec §5. I test leggono solo le fixture scritte a mano; le registrate sono documentazione |
| P20 | **I nuovi test di classificazione usano un `classify` finto iniettato**, più un test dell'adapter con risposte scritte a mano nel codice del test | Test senza rete (regola di CLAUDE.md); nessuna fixture file nuova necessaria |
| P21 | **`courseLabel` e il badge di portata si calcolano dai dati, mai testo scritto a mano** (`COURSE_LABELS`) | FR-6.5, spec §4.9 |
| P22 | **Gruppo *Portata* nel pannello *Filtri*, come primo gruppo; conta nel numero di "Filtri · N"**; parametro di query `portata` | Spec FR-6.1. La riga rapida (Preferite, Pranzo, Cena, Filtri) a 360 px non regge altri quattro chip |
| P23 | **`scripts/llm-record.ts` costruisce i vincoli con `courses` come l'app**: generazione → `MAIN_COURSE_VALUES`; richiesta con `--meal` → `MAIN_COURSE_VALUES`; richiesta senza `--meal` → `null` | Altrimenti `RecipeConstraintsSchema` rifiuta i vincoli e la verifica manuale di chiusura non parte |
| P24 | **Lo script `pnpm recipes:classify` esce con codice 1 solo se restano ricette e il modello non è configurato**; un errore inatteso stampa e esce con 1 | Spec §4.7. I lotti falliti per rete non cambiano il codice d'uscita: si riprova lanciandolo di nuovo |

## 4. Note e limiti accettati

- La correzione a mano di portate ed etichette resta fuori (`v2-funzionalita.md §1.4`): un errore del modello nella classificazione si vede in Libreria ma non si corregge dall'app.
- *Ripeti* usa le regole di ammissione: una ricetta solo contorno di un piano vecchio non viene ricopiata. I piani esistenti non cambiano.
- Il contrasto AA di `basil-subtle` (testo `basil` su `basil/15`) va guardato nella prova da telefono; la variante esiste già ed è usata altrove.

## 5. Verifiche manuali di chiusura (dalla spec §7, punti 10–13)

1. `pnpm llm:record` con il modello di produzione: la ricetta registrata ha `courses` valide.
2. Stack di produzione locale (`scripts/smoke-prod.sh`) con ricette senza portata: righe `[classify]` nei log, ricette classificate dopo l'avvio; senza `LLM_*` l'app parte e logga "modello non configurato".
3. Raspberry dopo il deploy: le 26 ricette ricevono una portata entro qualche minuto; il piano non contiene contorni da soli; la Libreria si filtra per portata.
4. Prova da telefono: chip delle Impostazioni e filtro della Libreria a 360 px senza overflow; badge di portata leggibile su card del Piano e della Libreria.
