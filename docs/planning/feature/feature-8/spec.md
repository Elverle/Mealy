# Feature 8 — Portate delle ricette e nuove etichette di stile

Specifica del 14 ottobre 2026, da `/feature-brainstorm`. È la prima di tre feature che riprendono il rework del catalogo nella versione attuale dell'app:

| Ordine | Feature | Contenuto |
|---|---|---|
| 1 | **8 — Portate ed etichette** (questa) | Portata di ogni ricetta, cinque etichette di stile nuove, classificazione delle ricette già in libreria |
| 2 | 10 — Pacchetto iniziale | 100–200 ricette dal dataset, senza dolci, con portata ed etichette (`../feature-10/spec.md`) |
| 3 | 11 — Composizione del pasto | Piatto unico, primo o secondo, con o senza contorno (`../feature-11/brainstorm-prompt.md`) |

Prossimo passo: `/feature-plan 8 docs/planning/feature/feature-8/spec.md`.

## 1. Problema e obiettivo

**Problema.** Una ricetta oggi non dice che portata è. L'unico indizio è l'etichetta di stile `piatto-unico` (`MEAL_STYLE_TAG_VALUES` in `lib/domain/types.ts`), che però è una preferenza e non una portata. Senza portata:

- il pacchetto iniziale (Feature 10) non può essere bilanciato tra primi, secondi, piatti unici e contorni;
- la composizione del pasto (Feature 11) non può chiedere al planner "un secondo e un contorno";
- la Libreria non si filtra per portata.

In più le sette etichette di stile (veloce, salutare, proteico, leggero, comfort food, economico, piatto unico) sono poche. Cinque nuove sono già state decise prima del seed (`docs/v2-funzionalita.md` §0), perché la pulizia del dataset le assegnerà a ogni ricetta.

**Utente.** L'utente unico dell'app, sul telefono, nella Libreria, nel Piano e nelle Impostazioni.

**Risultato atteso.**

1. Ogni ricetta ha una o più portate tra *Piatto unico*, *Primo*, *Secondo* e *Contorno*.
2. Le etichette di stile passano da 7 a 12.
3. Le ricette già in libreria, comprese le 26 sul Raspberry, ricevono portata ed etichette nuove senza nessun intervento a mano.
4. Il piano continua a mettere una sola ricetta per pasto, ma mai un contorno da solo.

## 2. Decisioni e motivazioni

| # | Decisione | Alternative scartate e perché |
|---|---|---|
| D1 | **Tre feature in catena: 8 → 10 → 11.** Questa fissa lo schema; il seed lo usa; la composizione lo sfrutta. | Seed e portate insieme: avrebbe mescolato una pulizia offline con modifiche a schema e UI. Portate e composizione insieme: la composizione sarebbe arrivata con pochi contorni in libreria. |
| D2 | **"Più tipi di pasto" significa le cinque etichette di stile** già decise. Pranzo e cena restano gli unici pasti. | Colazione o merenda: toccano settimana, piano e planner. Non richieste. |
| D3 | **Campo nuovo `courses`, elenco chiuso e multiplo** (una ricetta può essere secondo *e* piatto unico, come la parmigiana), sul modello di `meal_types`. | Portate dentro le etichette di stile: zero migrazioni, ma il planner (Feature 11) prenderebbe decisioni strutturali da un campo di preferenza. Portata singola: alcune ricette resterebbero fuori da composizioni in cui stanno bene. |
| D4 | **Le ricette già in libreria le classifica il modello, da solo, all'avvio dell'app**: in background, senza bloccare la partenza, con nuovo tentativo al riavvio successivo. | Pulsante nelle Impostazioni: più visibile, ma un passaggio in più per un'operazione che serve una volta. Script `pnpm`: sul Raspberry non si lancia `pnpm` (`docs/DEPLOY.md` §1). Script dal PC verso il DB del Pi: obbliga a esporre Postgres sulla rete. |
| D5 | **"Pochi ingredienti" si assegna per regola**: al massimo 6 ingredienti, senza contare quelli *q.b.* Si ricalcola a ogni salvataggio, e una volta sulle ricette esistenti. | Lasciarlo al modello: è un conteggio, il modello sbaglia e non serve. |
| D6 | **`piatto-unico` resta anche come etichetta di stile fino alla Feature 11**, legata per regola alla portata: l'etichetta c'è se e solo se c'è la portata. | Toglierla subito: le preferenze salvate nelle Impostazioni perderebbero la voce prima che la composizione del pasto la sostituisca. |
| D7 | **Fino alla Feature 11 un pasto del piano accetta solo piatti unici, primi e secondi.** Una ricetta che è solo contorno non entra nel piano, né per sorteggio né per scelta. | Nessun filtro: con il seed (Feature 10) arriverebbero cene fatte di sole "zucchine trifolate". |
| D8 | **La portata si vede, non si modifica**: filtro nella Libreria, etichetta sulle card (Libreria, Piano, proposta) e nel dettaglio. | Selettore di correzione nel dettaglio: è l'inizio della correzione ricette (`v2-funzionalita.md` §1.4), rinviata. |

## 3. Requisiti funzionali

### FR-1 — Portate

- **FR-1.1** Le portate sono un elenco chiuso di quattro valori, in quest'ordine:

  | Valore | Etichetta |
  |---|---|
  | `piatto-unico` | Piatto unico |
  | `primo` | Primo |
  | `secondo` | Secondo |
  | `contorno` | Contorno |

  *Piatto unico*, *Primo* e *Secondo* sono le **portate principali**.
- **FR-1.2** Una ricetta classificata ha da una a quattro portate distinte. Una ricetta **non classificata** ha l'elenco vuoto: può capitare solo alle ricette salvate prima di questa feature, in attesa della classificazione (FR-4).
- **FR-1.3** Ogni ricetta generata dal modello, sia per il piano sia su richiesta, arriva con almeno una portata. Il prompt chiede la portata o le portate in cui la ricetta si serve davvero, di solito una e al massimo due.

### FR-2 — Etichette di stile nuove

- **FR-2.1** Si aggiungono cinque valori in coda a `MEAL_STYLE_TAG_VALUES`:

  | Valore | Etichetta | Chi la assegna |
  |---|---|---|
  | `tradizionale` | Tradizionale | Il modello: piatti classici della cucina italiana |
  | `dal-mondo` | Dal mondo | Il modello: cucine non italiane |
  | `pochi-ingredienti` | Pochi ingredienti | La regola di FR-2.3, mai il modello |
  | `in-anticipo` | Si prepara in anticipo | Il modello: si conserva, adatta alla schiscetta |
  | `piatto-freddo` | Piatto freddo | Il modello: si mangia freddo o è estivo |

- **FR-2.2** Le dodici etichette compaiono ovunque compaiono oggi le sette: Impostazioni e onboarding (campo "Tipo di pasti"), filtro della Libreria, card e dettaglio della ricetta, prompt di generazione.
- **FR-2.3** **Regola "Pochi ingredienti".** Una ricetta ha `pochi-ingredienti` se e solo se ha al massimo 6 righe di ingredienti con unità diversa da `qb`. La regola vince sul modello: aggiunge l'etichetta quando manca, la toglie quando non spetta.
- **FR-2.4** **Regola "Piatto unico".** Su una ricetta classificata, l'etichetta di stile `piatto-unico` c'è se e solo se c'è la portata `piatto-unico`. Anche questa regola vince sul modello. Su una ricetta non classificata l'etichetta resta com'è finché non arriva la classificazione.
- **FR-2.5** Le regole di FR-2.3 e FR-2.4 si applicano a **ogni** ricetta che entra in libreria: generata per il piano o per lo swap, proposta e accettata (Feature 9), ricetta d'esempio del seed di sviluppo, ricetta del pacchetto della Feature 10. Si applicano anche alle ricette già in libreria: FR-2.3 con la migrazione (FR-5.2), FR-2.4 dopo la classificazione (FR-4.4).
- **FR-2.6** Le preferenze di stile già salvate nelle Impostazioni restano valide e invariate. Nessuna etichetta nuova viene selezionata d'ufficio.

### FR-3 — Portata nel piano (una ricetta per pasto, fino alla Feature 11)

- **FR-3.1** Un pasto del piano accetta una ricetta **non classificata** oppure con **almeno una portata principale**. Una ricetta che è solo `contorno` è esclusa:
  - dal sorteggio del planner, nella generazione del piano e in *Rigenera*;
  - dal cambio rapido (*Cambia*);
  - dall'elenco del selettore *Scegli*;
  - dall'assegnazione a mano: una richiesta diretta all'API viene rifiutata come oggi per una ricetta non adatta.
- **FR-3.2** Il conteggio delle ricette fresche che decide se chiamare il modello (`needMore`) non conta le ricette escluse da FR-3.1. Venti contorni in libreria, quindi, non bloccano la generazione di secondi.
- **FR-3.3** Le ricette generate per il piano e per lo swap devono avere una portata principale. Il prompt lo chiede; una ricetta che è solo contorno viene scartata come oggi le ricette che violano un vincolo (`constraint_violation`), con il dettaglio "portata non adatta al pasto".
- **FR-3.4** **Richiesta dal selettore del Piano** (Feature 9, quella con il tipo di pasto indicato): la proposta deve avere una portata principale. Se il modello restituisce un contorno, la proposta fallisce con l'errore che c'è già per una proposta non adatta (`proposal_unsuitable`).
- **FR-3.5** **Richiesta dalla Libreria** (tipo di pasto non indicato): qualsiasi portata è ammessa, contorno compreso. Il contorno entra in libreria e resta fuori dal piano finché non arriva la Feature 11.

### FR-4 — Classificazione automatica delle ricette esistenti

- **FR-4.1** **Quando.** All'avvio dell'app in produzione, dopo migrazioni e alias (`instrumentation.ts`), parte in background la classificazione delle ricette non classificate. La partenza non la aspetta: l'app accetta richieste subito.
- **FR-4.2** **Cosa chiede al modello.** Le ricette si mandano a lotti di 10. Per ognuna il modello riceve:
  - un riferimento breve (`r1`…`r10`);
  - titolo, descrizione, pasti, etichette attuali e nomi degli ingredienti.

  Per ognuna restituisce:
  - le portate (almeno una);
  - quali tra `tradizionale`, `dal-mondo`, `in-anticipo` e `piatto-freddo` le spettano.
- **FR-4.3** **Cosa scrive.** Per ogni riferimento valido del lotto:
  - imposta le portate;
  - aggiunge le etichette ricevute a quelle che la ricetta ha già (non ne toglie nessuna);
  - applica la regola di FR-2.4.

  Scrive solo sulle ricette ancora non classificate al momento della scrittura. Le altre righe della risposta si ignorano: riferimenti sconosciuti o ripetuti, portate vuote o fuori elenco.
- **FR-4.4** **Esiti parziali.**
  - Un lotto in errore (timeout, rete, risposta non valida) lascia le sue ricette non classificate e la classificazione passa al lotto successivo.
  - Le ricette rimaste non classificate si riprovano all'avvio successivo.
  - Un lotto in cui solo alcune righe sono valide scrive quelle valide.
- **FR-4.5** **Modello non configurato** (variabili `LLM_*` mancanti o non valide): la classificazione non parte e lascia una riga di log con il numero di ricette non classificate. L'app funziona normalmente, perché le ricette non classificate restano ammesse nel piano (FR-3.1).
- **FR-4.6** **Log.** Una riga all'inizio con il numero di ricette da classificare, una per ogni lotto fallito con il motivo, una alla fine con classificate e rimaste. Il prefisso è `[classify]`, come `[bootstrap]`.
- **FR-4.7** **Sviluppo.** Lo stesso procedimento si lancia a mano con `pnpm recipes:classify`, sul DB indicato da `DATABASE_URL`. In sviluppo la classificazione all'avvio non gira, come il resto del bootstrap.
- **FR-4.8** Non c'è interfaccia: niente pulsanti, avvisi o contatori. Una ricetta non classificata, nell'app, è una ricetta senza etichetta di portata.

### FR-5 — Dati e ricette d'esempio

- **FR-5.1** Le 18 ricette d'esempio di `fixtures/recipes.json` ricevono portate e, dove spettano, le etichette nuove, assegnate a mano nel file. Dopo `pnpm db:seed` nessuna ricetta d'esempio è non classificata.
- **FR-5.2** La migrazione:
  - aggiunge la colonna delle portate, vuota per le ricette esistenti;
  - applica la regola di FR-2.3 a tutte le ricette esistenti.
- **FR-5.3** Le preferenze di stile dell'household e le ricette restano altrimenti invariate. Nessun dato viene cancellato.

### FR-6 — Interfaccia

- **FR-6.1** **Filtro della Libreria.** Un gruppo *Portata* con quattro chip (Piatto unico, Primo, Secondo, Contorno), in AND con gli altri filtri e in OR tra i chip dello stesso gruppo, come i filtri esistenti. Una ricetta non classificata non corrisponde a nessun chip di portata.
- **FR-6.2** **Card della Libreria e card del pasto nel Piano.** Le portate compaiono come etichetta testuale (per esempio "Primo", oppure "Secondo · Piatto unico"), prima delle etichette di stile. Su una ricetta non classificata l'etichetta manca.
- **FR-6.3** **Dettaglio ricetta e proposta (Feature 9).** Le portate compaiono accanto a pasti ed etichette, in sola lettura.
- **FR-6.4** **Impostazioni e onboarding.** Il campo "Tipo di pasti" mostra le dodici etichette. Restano valide le regole di layout e accessibilità di `DESIGN.md §6`: tap target ≥ 44 px, nessun overflow orizzontale a 360 px.
- **FR-6.5** **Microcopy.** Etichette come nelle tabelle di FR-1.1 e FR-2.1. Il gruppo del filtro si chiama "Portata". Nessun testo nuovo oltre a questi.

## 4. Progettazione tecnica

### 4.1 Dominio (`lib/domain/types.ts`, unica fonte)

- `COURSE_VALUES`, `CourseSchema`, `Course`, `COURSE_LABELS`, nello stile degli altri elenchi chiusi; `MAIN_COURSE_VALUES = ['piatto-unico', 'primo', 'secondo']`.
- `MEAL_STYLE_TAG_VALUES` e `MEAL_STYLE_TAG_LABELS` passano a 12 voci, con le nuove in coda.
- `RecipeSchema.courses: z.array(CourseSchema).default([])`. Vuoto = non classificata.
- `GeneratedRecipeSchema.courses: z.array(CourseSchema).min(1)`, senza `.optional()` (vincolo dell'output strutturato). Ne derivano da sole `FixtureRecipeSchema` e `SavedRecipeInputSchema`; in quest'ultima va un tetto `.max(...)` come per le altre liste.
- `RecipeConstraintsSchema.courses: z.array(CourseSchema).nullable()`. `null` = qualsiasi portata.
- `LibraryFilterSchema.courses`, `EMPTY_LIBRARY_FILTER.courses = []`, `LibraryRecipeCardSchema.courses`.
- Schema dell'output di classificazione, accanto ai contratti di generazione:
  - `{ recipes: [{ ref, courses, style_tags }] }`;
  - `style_tags` ristretto ai quattro valori di FR-4.2;
  - `ref` stringa.

### 4.2 Regole pure (`lib/domain/`)

In un modulo del dominio, senza I/O:

- `deriveStyleTags(tags, courses, ingredients)` applica FR-2.3 e FR-2.4 e restituisce l'elenco di etichette ordinato come `MEAL_STYLE_TAG_VALUES`, senza doppioni. Con `courses` vuoto lascia `piatto-unico` com'è.
- `isMainDish(courses)` vale `true` se la ricetta non è classificata o ha almeno una portata principale.
- Costanti `FEW_INGREDIENTS_MAX = 6` e `CLASSIFY_BATCH_SIZE = 10`; la seconda va in `planner-config.ts` o in un file di configurazione delle ricette, accanto alle costanti di generazione.

### 4.3 Database

- **Migrazione `0005`** (drizzle-kit, in `lib/db/migrations/`):
  - `recipes.courses text[] NOT NULL DEFAULT ARRAY[]::text[]`;
  - una `UPDATE` che aggiunge `pochi-ingredienti` alle ricette con al massimo 6 righe di `recipe_ingredients` con `unit <> 'qb'` e lo toglie alle altre.

  Nessun indice: il filtro della Libreria lavora in memoria.
- `lib/db/schema.ts`: colonna `courses` su `recipes`.
- Repository delle ricette:
  - lettura e scrittura di `courses`;
  - una query per le ricette non classificate dell'household, con i dati di FR-4.2;
  - un aggiornamento condizionato (`WHERE id = $1 AND courses = '{}'`) per FR-4.3.

### 4.4 Planner e vincoli

- `exclusionReason` (`lib/domain/planner.ts`) riceve un nuovo motivo `'course'`, controllato subito dopo `'meal_type'`: scatta se `!isMainDish(recipe.courses)`. Ne ereditano il comportamento:
  - il planner;
  - il conteggio delle fresche (FR-3.2);
  - lo swap;
  - `manualChoiceExclusionReason`, quindi selettore e assegnazione a mano.

  La Feature 11 trasformerà il controllo in "la ricetta ha la portata richiesta dallo slot".
- `findConstraintViolations` (`lib/recipes/constraints.ts`) riceve il controllo gemello. Se `constraints.courses` non è `null` e la ricetta non ha nessuna di quelle portate, la violazione è "portata non adatta al pasto". Va aggiornato il commento che lega le due funzioni.
- `buildConstraints` riceve `courses`:
  - **generazione per piano e swap**: `MAIN_COURSE_VALUES`;
  - **`requestConstraints` di `lib/recipes/propose.ts`**: `MAIN_COURSE_VALUES` se `mealType` non è `null` (richiesta dal Piano), altrimenti `null` (richiesta dalla Libreria);
  - **ricontrollo al salvataggio di una proposta** (`saveProposedRecipe`): `null`, perché la proposta è già stata accettata con il suo contesto.

### 4.5 LLM (`lib/llm/`, unico adattatore)

- `prompts.ts`, istruzioni di generazione:
  - riga `courses`: una o più tra `piatto-unico`, `primo`, `secondo` e `contorno`, di solito una e al massimo due, scelte tra quelle in cui il piatto si serve davvero;
  - riga `tags`: le dodici voci, con la nota che `pochi-ingredienti` e `piatto-unico` le calcola l'app.
- Prompt utente di generazione: con `constraints.courses` non `null`, una riga "Portata: ogni ricetta deve essere …".
- Prompt nuovi per la classificazione: istruzioni (definizione delle quattro portate e delle quattro etichette) e prompt utente con il lotto.
- `adapter.ts` riceve `classifyRecipes(items, options)`, sullo stesso schema di `generateRecipes`:
  - output strutturato con lo schema di §4.1;
  - timeout da `getLlmTimeoutMs`;
  - `abortSignal` opzionale;
  - modello iniettabile per i test.

### 4.6 Modulo `recipes`

- `lib/recipes/store.ts` (`insertGeneratedRecipe`): salva `courses` e applica `deriveStyleTags` prima di scrivere. È il punto unico per generazione, proposta salvata e, con la Feature 10, il pacchetto.
- **Nuovo `lib/recipes/classify.ts`** con `classifyPendingRecipes(deps?)`:
  1. legge le ricette non classificate;
  2. le divide in lotti da 10 e chiama `classifyRecipes` un lotto alla volta, in sequenza;
  3. convalida le risposte e scrive come da FR-4.3, ricetta per ricetta e senza transazione unica;
  4. restituisce un rapporto `{ pending, classified, remaining, failedBatches }`.

  Le dipendenze (modello, DB) sono iniettabili per i test, come in `generate.ts` e `propose.ts`.
- `seedDatabase` in `lib/db/seed-core.ts`, che scrive le ricette d'esempio: passa da `deriveStyleTags`, così le fixture restano coerenti con le regole anche se il file sbaglia.

### 4.7 Avvio e comandi

- `instrumentation.ts`:
  - dopo un `runDbBootstrap` riuscito, avvia `classifyPendingRecipes()` senza `await`;
  - un errore della classificazione si logga e non chiama mai `process.exit`;
  - il caso "modello non configurato" (`LlmError` con codice `config`, da `readLlmConfig`/`getModel`) si riconosce e produce la riga di FR-4.5;
  - il modulo si importa con `import()` dinamico, come il bootstrap.
- `package.json`: `"recipes:classify": "tsx scripts/classify-recipes.ts"`. Lo script stampa il rapporto ed esce con codice diverso da 0 se restano ricette e il modello non è configurato.
- `CLAUDE.md`, sezione Comandi: una riga per `pnpm recipes:classify`.

### 4.8 API

Nessuna rotta nuova. Cambiano le forme già esistenti:

- **`GET /api/recipes`**: accetta il filtro `courses`; ogni card include `courses`.
- **`GET /api/recipes/:id`, viste del piano (`PlanSlotView.recipe`), `POST /api/recipes/propose` e salvataggio della proposta**: la ricetta include `courses`, perché è `RecipeSchema` o `GeneratedRecipeSchema`.
- **`PUT /api/settings`**: accetta le dodici etichette.

Il parsing dei parametri del filtro della Libreria segue quello attuale di `meals` e `tags`.

### 4.9 UI (`components/`)

- `components/library/library-filters.tsx`: gruppo *Portata*.
- `components/library/recipe-card.tsx`, `components/plan/plan-slot-card.tsx`: etichetta di portata (FR-6.2), ricavata da `COURSE_LABELS`, mai scritta a mano.
- `components/recipes/recipe-detail-sheet.tsx`, `components/recipes/recipe-proposal-sheet.tsx`: portata in sola lettura.
- `components/settings/settings-fields.tsx` (usato da Impostazioni e onboarding): dodici chip. Va verificato il layout a 360 px.

### 4.10 Documentazione

- **`docs/ARCHITECTURE.md`**:
  - §4: campo `courses`, elenco delle portate, etichette a 12, regole derivate;
  - §5.2: motivo di esclusione `course`;
  - §5.1: `courses` nell'output di generazione e nei vincoli;
  - avvio: classificazione in background.
- **`docs/DEPLOY.md`**: righe di log `[classify]` nella tabella delle verifiche, e cosa vuol dire "modello non configurato".
- **Wiki** (`docs/wiki/`) secondo `/feature-docs`.

## 5. Requisiti non funzionali

- **Avvio.** La classificazione non allunga la partenza dell'app né la sua prima risposta: il bootstrap resta l'unica parte attesa. Un suo errore non ferma mai l'app.
- **Costo e carico.** Sul Raspberry, 26 ricette sono 3 chiamate in sequenza, mai in parallelo, per non ripetere i timeout del primo avvio. Un avvio con tutto già classificato fa una sola query e nessuna chiamata al modello.
- **Idempotenza e concorrenza.**
  - La classificazione scrive solo su ricette ancora non classificate, quindi due avvii ravvicinati o una ricetta salvata nel frattempo non producono conflitti.
  - La migrazione è idempotente rispetto alla regola di FR-2.3.
- **Coerenza delle regole.** Le regole di portata ed etichette derivate vivono in un solo posto del dominio (§4.2). `exclusionReason` e `findConstraintViolations` restano allineate e restano esplicitamente legate dai commenti.
- **Test senza rete.**
  - **Classificazione**: testata con un modello finto o con fixture scritte a mano in `tests/fixtures/llm/`.
  - **Fixture di generazione esistenti**, comprese le cinque registrate in `tests/fixtures/llm/recorded/`: aggiornate a mano con il campo `courses`, annotando nel piano che sono state ritoccate.
  - **Registrazione reale** con `pnpm llm:record`: è una verifica manuale di chiusura, come nella Feature 9.
- **Compatibilità.**
  - I piani esistenti non cambiano: una ricetta già assegnata a un pasto ci resta anche se risulta solo contorno; FR-3.1 vale per le scelte successive.
  - Le preferenze salvate restano valide.
  - Il DB del Raspberry si aggiorna con il normale `scripts/deploy.sh`.
- **Accessibilità.** I chip nuovi rispettano `DESIGN.md §6` (tap target, contrasto AA, focus visibile).

## 6. Fuori ambito

- **Composizione del pasto** (piatto unico, primo o secondo, con o senza contorno), più slot per pasto e scelta nelle Impostazioni: Feature 11.
- **Pacchetto di ricette dal dataset** e pulizia del CSV: Feature 10.
- **Rimozione dell'etichetta di stile `piatto-unico`**: Feature 11, quando la composizione la sostituisce.
- **Modifica a mano** di portata o etichette di una ricetta (`v2-funzionalita.md` §1.4).
- **Etichette di stile nel peso del planner** (`v2-funzionalita.md` §2.1). Le etichette restano un'indicazione per il modello e un filtro della Libreria.
- **Regola automatica per `veloce`** (tempo ≤ 30 minuti): resta com'è, affidata al prompt.
- **Riclassificazione** di ricette già classificate e classificazione con il modello di etichette diverse dalle quattro di FR-4.2.
- **Pasti nuovi** oltre a pranzo e cena.
- **Interfaccia** per la classificazione (avanzamento, pulsante, avvisi).

## 7. Verifica e criteri di accettazione

**Gate.** `lint + typecheck + test + build` verdi in locale e in CI, compreso il job `image`.

**Automatici.**

1. **Regole derivate** (`deriveStyleTags`):
   - 6 ingredienti non q.b. più 3 q.b. ottengono `pochi-ingredienti`; 7 non q.b. lo perdono anche se il modello l'aveva messo;
   - una portata `piatto-unico` aggiunge l'etichetta; senza quella portata, su una ricetta classificata, l'etichetta viene tolta;
   - con `courses` vuoto l'etichetta resta com'è.
2. **Planner**:
   - una ricetta con sola portata `contorno` non viene mai assegnata e non conta tra le fresche;
   - una ricetta non classificata e una `['secondo', 'contorno']` restano ammesse;
   - swap, elenco delle candidate e assegnazione a mano rifiutano la sola-contorno.
3. **Vincoli**:
   - con `courses: MAIN_COURSE_VALUES` una ricetta generata solo contorno risulta violazione;
   - con `courses: null` passa;
   - una proposta dal Piano che torna contorno fallisce con `proposal_unsuitable`; dalla Libreria viene proposta e salvata.
4. **Classificazione** (modello finto):
   - 23 ricette non classificate vanno in 3 lotti e diventano classificate, con le etichette aggiunte e la regola di FR-2.4 applicata;
   - un lotto in errore lascia non classificate solo le sue ricette;
   - righe con riferimento sconosciuto o portate vuote si ignorano;
   - una ricetta classificata nel frattempo non viene sovrascritta;
   - con il modello non configurato non si fa nessuna chiamata e il rapporto riporta le rimaste.
5. **Avvio**: un errore di `classifyPendingRecipes` non fa uscire il processo e il bootstrap non lo aspetta (test di `instrumentation` o del punto di avvio estratto).
6. **Migrazione** (DB di test):
   - dopo `0005` le ricette esistenti hanno `courses = {}`;
   - `pochi-ingredienti` corrisponde alla regola;
   - nessun'altra etichetta è cambiata.
7. **Seed**: dopo `pnpm db:seed` tutte le ricette d'esempio hanno almeno una portata; `FixtureFileSchema` le convalida.
8. **Libreria**:
   - il filtro *Portata* combina in OR al suo interno e in AND con gli altri;
   - una ricetta non classificata non compare filtrando per portata;
   - le card mostrano l'etichetta.
9. **Impostazioni**: le dodici etichette si salvano e si rileggono; `PUT /api/settings` rifiuta un valore fuori elenco.

**Manuali, di chiusura.**

10. `pnpm llm:record` con il modello di produzione: la ricetta registrata ha `courses` valide e passa lo schema.
11. **Stack di produzione locale** (`scripts/smoke-prod.sh`) con un DB che contiene ricette senza portata:
    - nei log compaiono le righe `[classify]`;
    - al riavvio successivo le ricette risultano classificate;
    - senza variabili `LLM_*` l'app parte e logga "modello non configurato".
12. **Raspberry, dopo il deploy**:
    - le 26 ricette ricevono una portata entro qualche minuto dall'avvio;
    - il piano generato non contiene contorni da soli;
    - la Libreria si filtra per portata.
13. **Prova da telefono**:
    - chip delle Impostazioni e filtro della Libreria a 360 px, senza overflow;
    - etichetta di portata leggibile su card del piano e della Libreria.
