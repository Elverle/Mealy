# Feature 10 — Pacchetto iniziale di ricette

Specifica del 23 ottobre 2026, da `/feature-brainstorm`, a partire da `brainstorm-prompt.md`. È la seconda delle tre feature che riprendono `docs/rework-catalogo.md` nella versione attuale dell'app:

| Ordine | Feature | Contenuto |
|---|---|---|
| 1 | 8 — Portate ed etichette (fatta, 0.8.0) | Portata di ogni ricetta, dodici etichette di stile, classificazione delle ricette già in libreria |
| 2 | **10 — Pacchetto iniziale** (questa) | 200 ricette dal dataset, riscritte, senza dolci, bilanciate per portata |
| 3 | 11 — Composizione del pasto | Piatto unico, primo o secondo, con o senza contorno (`../feature-11/brainstorm-prompt.md`) |

Prossimo passo: `/feature-plan 10 docs/planning/feature/feature-10/spec.md`.

## 1. Problema e obiettivo

**Problema.** Sul Raspberry la libreria si è fermata a 26 ricette e il piano ruota sempre sulle stesse. È il comportamento previsto: il planner chiama il modello solo quando le ricette "fresche" di un tipo di pasto sono meno di slot + `minPoolSize` − 1, cioè 9 su una settimana intera (`lib/domain/planner.ts`, `lib/domain/planner-config.ts`, `ARCHITECTURE §5.2`). Con 26 ricette la soglia è superata, quindi non genera più, e un piano ne usa 14: due piani di fila si sovrappongono per più di metà. Al primo avvio, con la libreria vuota, il primo piano dipendeva tutto dal modello ed è andato in timeout.

**Utente.** L'utente unico dell'app. Prepara il pacchetto una volta sola sul PC, con Claude Code; poi lo usa senza accorgersene, sul telefono, nella Libreria e nel Piano.

**Risultato atteso.**

1. In libreria ci sono 200 ricette reali in più, scritte nello stile dell'app: 50 primi, 50 secondi, 40 piatti unici e 60 contorni.
2. Il primo piano di un'installazione nuova esce senza chiamare il modello.
3. Le esigenze alimentari delle ricette del pacchetto sono ricavate per regola dagli ingredienti, non da un modello.
4. Il repository può diventare pubblico: contiene solo ricette riscritte, senza testi, link o riferimenti al sito d'origine.

## 2. Decisioni e motivazioni

| # | Decisione | Alternative scartate e perché |
|---|---|---|
| D1 | **Il pacchetto è un file del repository**, `fixtures/recipe-pack.json`, letto dal bundle come gli alias. Contiene solo ricette riscritte (D7). | File solo sul Raspberry, montato in un volume: il deploy si complica e la CI non può validare il pacchetto vero. Resta la via d'uscita se un giorno si vorrà azzerare anche il rischio residuo sul dataset (§5): cambierebbe solo da dove si legge il file. |
| D2 | **Il pacchetto entra all'avvio dell'app in produzione**, dopo migrazioni e alias. Entrano le ricette il cui titolo non è già in libreria, né uguale né simile. **Nessuna modifica al modello dati.** | Comando a parte: l'immagine di produzione è standalone e non contiene gli script `tsx` (`Dockerfile`), e sul Raspberry non si lancia `pnpm` (`docs/DEPLOY.md` §1). Tabella che segna il pacchetto come caricato: servirebbe solo se le ricette si potessero cancellare, e oggi dall'interfaccia si possono solo bloccare (`app/api/recipes/[id]/route.ts` ha solo `GET`). Se la V2 introdurrà la cancellazione, servirà allora (§6). |
| D3 | **200 ricette, a quote fisse per gruppo di selezione**: primi 50, secondi 50, piatti unici 40, contorni 60. Il pranzo e la cena li assegna il modello ricetta per ricetta. | 120 o 150: meno varietà. I 60 contorni non servono al piano fino alla Feature 11, che li userà per "secondo + contorno". |
| D4 | **Prima la selezione per regola, poi la revisione dei titoli da parte dell'utente.** Lo script propone circa 1,5 candidati per posto (300 spuntati) più le riserve, in un file markdown a caselle. | Elenco di esattamente 200 titoli: ogni titolo tolto lascerebbe un buco da riempire con un secondo giro. Scelta a mano sul CSV: 2.700 righe. |
| D5 | **La conversione la fa il modello configurato via env** (`LLM_PROVIDER`, `LLM_MODEL`), attraverso l'adattatore unico `lib/llm/`, una ricetta per chiamata. Il modello si può cambiare a ogni lancio. | Un modello fisso nel codice: viola "il provider è configurazione, non codice". Più ricette per chiamata: un errore farebbe perdere tutto il lotto, e i controlli (D7) lavorano per ricetta. |
| D6 | **Le esigenze alimentari si ricavano per regola da una tabella degli ingredienti rivista dall'utente**, `fixtures/recipe-pack-ingredients.json`. Per ogni nome canonico la tabella dice carne, pesce, latticini, uova, miele, glutine e il reparto. La bozza la scrive il modello, l'utente la rivede una volta. | Parole chiave nel codice: un ingrediente non previsto, come la 'nduja, darebbe un "vegetariano" sbagliato. Diete del modello con veto a parole chiave: poco lavoro, ma un filtro vincolante non può essere probabilistico (`rework-catalogo.md` §6). |
| D7 | **Salvaguardie per un repository pubblico.** Il modello scrive passi e descrizione da capo e usa l'originale solo come informazione su tecnica, tempi e temperature. Un controllo automatico scarta i testi che condividono 8 o più parole di fila con l'originale. Nel pacchetto non ci sono link, indici del dataset o il nome del sito. | Copiare o parafrasare i procedimenti: sono il testo protetto della fonte. Nomi dei piatti, ingredienti e quantità sono fatti e restano. |
| D8 | **Nessun link all'originale.** Link e indice del dataset restano nei file di lavoro, in una cartella ignorata da git. | Campo `source_url` con link nella scheda: migrazione e UI per un'informazione che serve solo a controllare la conversione. |
| D9 | **Le ricette del pacchetto entrano con l'origine `manual`**, che esiste già, tramite un parametro `source` di `insertGeneratedRecipe`. Le regole derivate (portate normalizzate, `pochi-ingredienti`, `piatto-unico`) valgono come per ogni altra ricetta. | Valore nuovo `'pack'`: nessuno lo legge, e cambierebbe un elenco chiuso del dominio. Un percorso di scrittura separato: duplicherebbe le regole della Feature 8 (`../feature-8/plan.md`, "Contratti consegnati"). |
| D10 | **Si accetta che il modello non generi quasi più ricette da solo.** Con 140 piatti da pasto in più la soglia di generazione è quasi sempre superata. Le ricette nuove arrivano con lo swap e con le richieste della Feature 9. | Una quota di scoperte o pesi nuovi nel planner: è il catalogo della V2 (`rework-catalogo.md` §5), fuori ambito. |
| D11 | **Solo le categorie del dataset adatte a pranzo e cena**: primi, secondi, piatti unici, torte salate, insalate e contorni. Niente dolci, antipasti, lievitati, salse, bevande o conserve. | Pizze e focacce (lievitati): non richieste e con quantità spesso a pezzi. |
| D12 | **Il dataset resta fuori dal repository.** `docs/recipe.csv` è già in `.gitignore` e non è mai stato committato; i file di lavoro vanno in `.recipe-pack/`, anch'essa ignorata. | — |

## 3. Requisiti funzionali

### FR-1 — Preparazione del pacchetto (una volta sola, sul PC)

- **FR-1.1 Comando.** Un solo comando a sottocomandi, `pnpm recipes:pack <passo>`, con i passi `select`, `convert`, `ingredients`, `build` e `load`. Ogni passo legge l'output del precedente da `.recipe-pack/` e scrive il proprio lì, tranne `build`, che scrive i due file di `fixtures/`. Rilanciare un passo è sicuro: riprende da dove era arrivato e non ripete il lavoro già fatto (FR-1.4). Errori:
  - opzione o passo sconosciuto: messaggio con l'elenco dei passi, uscita 1;
  - file d'ingresso mancante: messaggio con il percorso atteso e il passo che lo produce (es. `Manca .recipe-pack/selection.md: lancia prima "pnpm recipes:pack select".`), uscita 1;
  - modello non configurato (`LlmError` di tipo `config`) in `convert` o `ingredients`: messaggio dell'errore, uscita 1.

- **FR-1.2 Selezione (`select`).** Legge il CSV (default `docs/recipe.csv`; opzione `--csv <percorso>`; se manca, `File del dataset non trovato: <percorso>`, uscita 1). Tiene una riga solo se rispetta tutti questi criteri:
  1. `Categoria` tra quelle di D11, assegnata a un gruppo di selezione: *Primi piatti* → **primi**; *Secondi piatti* → **secondi**; *Piatti Unici*, *Torte salate* e *Insalate* → **piatti unici**; *Contorni* → **contorni**;
  2. `Ingredienti` leggibile come lista di coppie `[nome, quantità]`, con almeno 2 righe; `Steps` di almeno 200 caratteri;
  3. `Persone/Pezzi` intero tra 2 e 8;
  4. ogni quantità è `q.b.` (anche `qb`, maiuscole o minuscole) oppure un numero (intero o con virgola o punto decimale) seguito facoltativamente da `g`, `kg`, `ml`, `l`, `cl` o `dl`, senza spazi rilevanti. Restano fuori le quantità con zero iniziale seguito da altre cifre (`025g`, decimale perso), le quantità concatenate (`250g1kg`) e quelle testuali;
  5. al massimo 10 ingredienti misurati (quantità diversa da `q.b.`);
  6. nessuna di queste parole in titolo o procedimento, senza distinguere maiuscole: *bimby*, *planetaria*, *impastatrice*, *barbecue*, *gelatiera*, *slow cooker*, *macchina del pane*, *essiccatore* (elettrodomestici fuori da `APPLIANCE_VALUES`).

  Con questi criteri il dataset offre 751 primi, 414 secondi, 187 piatti unici e 117 contorni (misura del 23 ottobre 2026). Le quantità senza unità restano ammesse: su `'6'` di olio decide il modello leggendo il procedimento (FR-1.4), e il caso finisce nel report (FR-1.5, W3).

  Ogni candidato riceve un **ingrediente principale**, cercato per parole chiave nei nomi degli ingredienti (minuscoli, senza accenti), con questa precedenza: **carne** (manzo, vitello, maiale, pollo, tacchino, coniglio, agnello, anatra, faraona, salsiccia, salsicce, pancetta, guanciale, prosciutto, speck, bresaola, mortadella, salame, wurstel, cotechino, lonza, arista, costine, macinato, carne) → **pesce** (pesce, tonno, salmone, merluzzo, baccala, nasello, platessa, sogliola, orata, branzino, spigola, trota, sgombro, alici, acciughe, gamberi, gamberetti, scampi, cozze, vongole, calamari, seppie, totani, polpo, surimi, bottarga) → **legumi** (ceci, lenticchie, fagioli, piselli, fave, cicerchie, edamame, tofu) → **uova** (uovo, uova, tuorlo, tuorli, albume, albumi) → **formaggi** (formaggio, mozzarella, fiordilatte, burrata, ricotta, parmigiano, grana, pecorino, gorgonzola, scamorza, provola, fontina, stracchino, robiola, taleggio, asiago, emmental, feta, mascarpone, caciocavallo, quartirolo, brie) → **verdure** (tutto il resto). Si confrontano parole intere, nella forma scritta sopra (`pollo` trova «petto di pollo», non «pollame»).

  Dentro ogni gruppo di selezione i candidati si ordinano per punteggio crescente: ingredienti misurati + ⌈caratteri del procedimento / 500⌉, a parità l'indice del dataset. La scelta segue a giro questa sequenza di 10 posti: carne, verdure, pesce, carne, legumi, verdure, pesce, uova, carne, formaggi. Da ogni ingrediente principale si prende il primo candidato non ancora preso; un ingrediente esaurito si salta. Si scarta un candidato il cui titolo è simile a uno già preso (similarità a trigrammi ≥ 0,6, la stessa misura di `findSimilarRecipeTitle`, FR-3.3). La scelta si ferma al doppio della quota o quando i candidati finiscono.

  `select` scrive due file:
  - `.recipe-pack/candidates.json`: per ogni candidato codice, gruppo, ingrediente principale, indice del dataset, link e campi grezzi;
  - `.recipe-pack/selection.md`: il file da rivedere, descritto in FR-1.3.

  Il codice di un candidato è la lettera del gruppo (P primi, S secondi, U piatti unici, C contorni) più tre cifre nell'ordine di scelta (`P001`). Se un gruppo ha meno candidati di ⌈1,5 × quota⌉, li spunta tutti e stampa un avviso con i numeri. Se `selection.md` esiste già, `select` si ferma senza sovrascriverlo, salvo con `--force`, per non perdere la revisione.

- **FR-1.3 Revisione (`selection.md`).** Un file markdown con una sezione per gruppo nell'ordine primi, secondi, piatti unici, contorni. Ogni sezione ha nel titolo la quota (`## Primi — quota 50`) e contiene:
  - i primi ⌈1,5 × quota⌉ candidati con la casella spuntata (`- [x] P001 · Pasta alla norma · 7 ingredienti · verdure`);
  - sotto `### Riserve`, i successivi fino al doppio della quota, non spuntati.

  In testa al file, tre righe spiegano come rivederlo:
  - togliere la spunta (`[ ]`) o cancellare la riga di una ricetta che non si vuole;
  - spuntare una riserva per aggiungerla;
  - conta l'ordine delle righe.

  `convert` legge solo le righe spuntate, nell'ordine del file. Ignora le righe che non riconosce, ma se un codice spuntato non esiste in `candidates.json` stampa `Codice sconosciuto in selection.md: <codice>` ed esce con 1.

- **FR-1.4 Conversione (`convert`).** Per ogni gruppo converte le righe spuntate nell'ordine del file finché le ricette **accettate** arrivano alla quota; le righe spuntate dopo restano non convertite. Le chiamate al modello partono al più 3 alla volta (opzione `--concurrency <1–5>`). Per ogni candidato:
  1. **Ingresso al modello**:
     - titolo, gruppo e numero di persone;
     - ingredienti, ciascuno con la quantità grezza e, se il parser la capisce, la sua lettura (es. `750g → 750 g`, `1kg → 1000 g`, `2 → 2 senza unità`);
     - procedimento originale, tra delimitatori e trattato come dato, come la richiesta della Feature 9 (`RECIPE_REQUEST_OPEN`/`RECIPE_REQUEST_CLOSE` in `lib/llm/prompts.ts`);
     - nomi canonici già in uso da riusare quando l'ingrediente è lo stesso: nomi della tabella degli ingredienti, destinazioni degli alias (`fixtures/ingredient-aliases.json`), nomi delle ricette d'esempio (`fixtures/recipes.json`).
  2. **Cosa chiede il prompt** (istruzioni sulle regole degli ingredienti e delle etichette identiche a `buildRecipeInstructions`, più queste):
     - scrivere passi brevi e la descrizione (una o due frasi) **da capo, con parole proprie**, e usare il procedimento solo per tecnica, tempi, temperature e dosi;
     - tenere il nome del piatto, sistemandone maiuscole e accenti;
     - una riga per ogni ingrediente dell'originale. Convertire kg in g e l, dl e cl in ml. Per un numero senza unità, decidere dal procedimento se sono pezzi o cucchiai (1 cucchiaio = 15 ml di liquido o 10 g di solido, 1 cucchiaino = 5 ml o 5 g);
     - `servings_base` uguale al numero di persone;
     - `diet_flags` vuoto, perché le calcola l'app (FR-1.7);
     - portate, pasti, etichette, elettrodomestici, minuti e kcal stimati.
  3. **Output**: una ricetta conforme a `GeneratedRecipeSchema`, con la riparazione dello schema già usata dall'adattatore.
  4. **Post-elaborazione deterministica**:
     - `normalizeGeneratedRecipe`;
     - `servings_base` forzato al valore del dataset;
     - nomi canonici risolti con gli alias (`resolveIngredientName` con la mappa di `toAliasMap(FIXTURE_INGREDIENT_ALIASES)`).
  5. **Controlli** di FR-1.5. Se un controllo d'errore fallisce, il candidato si riconverte **una volta**, con gli errori nel prompt. Al secondo fallimento è **scartato**.
  6. **Memoria**: l'esito (accettata con ricetta e avvisi, oppure scartata con i motivi) si salva in `.recipe-pack/converted/<codice>.json`. Un rilancio salta i candidati già accettati o scartati; con `--retry-rejected` riprova anche gli scartati. Un errore del modello (timeout, provider, output non valido dopo la riparazione) non si salva come scarto: il candidato si riprova al rilancio successivo.

  Alla fine `convert` stampa per gruppo accettate/quota, scartate ed errori del modello. Se un gruppo resta sotto quota esce con 1, con il messaggio `<Gruppo>: <accettate>/<quota> — spunta altre ricette in .recipe-pack/selection.md e rilancia.` Aggiorna il report (FR-1.5) in ogni caso.

- **FR-1.5 Controlli e report.** Errori (la ricetta non passa):
  - **E1** la ricetta non rispetta `SavedRecipeInputSchema`, che ha gli stessi tetti di una ricetta salvata dal client;
  - **E2** la portata non corrisponde al gruppo: nel gruppo contorni `courses` deve contenere `contorno`; negli altri gruppi almeno una portata principale (`MAIN_COURSE_VALUES`);
  - **E3** un passo o la descrizione condivide con il procedimento originale una sequenza di **8 o più parole consecutive**. Le parole si confrontano minuscole, senza accenti, separate da tutto ciò che non è lettera o cifra.

  Avvisi (la ricetta passa, l'avviso va nel report):
  - **W1** un ingrediente con quantità leggibile ha nel risultato un'unità diversa, o una quantità che si discosta di oltre il 10%, dopo le conversioni di FR-1.4. Si confronta riga per riga solo se il numero di righe è lo stesso;
  - **W2** il numero di righe di ingredienti è cambiato (`8 → 7`);
  - **W3** l'originale ha un numero senza unità su un ingrediente di solito misurato a cucchiai: olio, aceto, burro, parmigiano, grana, pecorino, zucchero, farina, pangrattato, vino, latte, panna, brodo, salsa di soia, miele, capperi. Si riportano la quantità grezza e la scelta del modello;
  - **W4** `prep_minutes` oltre 120.

  Il report `.recipe-pack/report.md` elenca per gruppo le ricette accettate (codice, titolo, link, avvisi) e le scartate (codice, titolo, motivi). Dopo `build` contiene anche le statistiche di FR-1.7.

- **FR-1.6 Tabella degli ingredienti (`ingredients`).** Raccoglie i nomi canonici distinti delle ricette accettate. Li confronta con `fixtures/recipe-pack-ingredients.json`, che `ingredients` crea se manca. Per i nomi assenti chiede al modello una bozza a lotti di 40. Il prompt chiede di essere prudenti:
  - `glutine` vero se l'ingrediente può contenerne (dado, salsa di soia, pangrattato, farine non dichiarate senza glutine);
  - `latticini` vero per ogni derivato del latte, formaggi stagionati compresi;
  - `carne` e `pesce` veri anche per brodi, sughi e condimenti che li contengono.

  Le voci nuove entrano con `reviewed: false`, ordinate per nome; le voci esistenti non si toccano. Scrive inoltre `.recipe-pack/ingredients-review.md`, una tabella delle voci da rivedere: nome, reparto, i sei attributi, ricette che lo usano.

  La revisione consiste nel correggere le voci nel file JSON e segnarle `reviewed: true`. `pnpm recipes:pack ingredients --approve` le segna tutte rivedute in un colpo, dopo che l'utente ha controllato la tabella.

- **FR-1.7 Costruzione (`build`).** Richiede che ogni gruppo abbia esattamente la quota di ricette accettate (prende le prime nell'ordine di `selection.md`) e che ogni nome canonico abbia una voce riveduta. Altrimenti esce con 1 ed elenca gruppi sotto quota e nomi mancanti o non rivisti. Per ogni ricetta:
  - `category` di ogni ingrediente presa dalla tabella;
  - `diet_flags` = `deriveDietFlags` (§4.2);
  - `courses` normalizzate e `tags` = `deriveStyleTags(...)`, come all'inserimento.

  Controlli sull'insieme, che in caso di errore fermano `build` con l'elenco dei casi:
  - nessuna coppia di titoli uguali dopo `normalizeTitle`, né simili (trigrammi ≥ 0,6);
  - nessun nome canonico che sia un alias in `fixtures/ingredient-aliases.json`.

  Scrive `fixtures/recipe-pack.json`, con le ricette nell'ordine primi, secondi, piatti unici, contorni e dentro ogni gruppo nell'ordine di `selection.md`. Riscrive `fixtures/recipe-pack-ingredients.json` tenendo solo i nomi usati. Aggiunge al report:
  - ricette per portata e per pasto;
  - quota per esigenza alimentare;
  - ricette per ingrediente principale;
  - distribuzione dei minuti;
  - avvisi ancora aperti.

### FR-2 — Il pacchetto

- **FR-2.1** `fixtures/recipe-pack.json` ha la forma `{ "recipes": [ … ] }` e contiene esattamente 200 ricette nel formato di `GeneratedRecipeSchema`, con i tetti di `SavedRecipeInputSchema`. Ogni ricetta ha almeno una portata.
- **FR-2.2** Invarianti, verificate da un test sul file vero:
  - ogni nome canonico ha una voce riveduta nella tabella degli ingredienti, e `category` coincide con quella della voce;
  - `diet_flags` è uguale a `deriveDietFlags(ingredients, tabella)`;
  - `tags` è uguale a `deriveStyleTags(tags, courses, ingredients)`;
  - nessun nome canonico è un alias;
  - nessuna coppia di titoli uguali o simili;
  - `servings_base` è tra 2 e 8;
  - almeno 60 ricette hanno `contorno` e almeno 140 una portata principale (conseguenza di E2 e delle quote);
  - nessun testo contiene `http`, `www.` o `giallozafferano`, senza distinguere maiuscole.
- **FR-2.3** La tabella `fixtures/recipe-pack-ingredients.json` ha la forma `{ "ingredients": [ … ] }`. Ogni voce contiene `name` (nome canonico normalizzato, unico), `category`, i sei attributi booleani `carne`, `pesce`, `latticini`, `uova`, `miele`, `glutine` e `reviewed`. Nel file committato tutte le voci sono rivedute.

### FR-3 — Caricamento all'avvio

- **FR-3.1 Quando.** In produzione (`DB_BOOTSTRAP_ON_START=true`), in `instrumentation.ts`, subito dopo `runDbBootstrap` riuscito e prima di avviare la classificazione della Feature 8. L'avvio **aspetta** il caricamento: il server non accetta richieste prima, quindi il primo piano vede già il pacchetto. In sviluppo e nei test l'avvio non carica nulla, come oggi.
- **FR-3.2 Household.** Le ricette vanno all'household di default, creato se manca (`ensureDefaultHousehold`), anche prima dell'onboarding. L'onboarding non cambia: dipende da `onboarded_at`.
- **FR-3.3 Cosa entra.** In una sola transazione, dopo `acquireRecipeGenerationLock`, si leggono i titoli della libreria (normalizzati con `normalizeTitle`). Per ogni ricetta del pacchetto, nell'ordine del file:
  - si salta se il titolo normalizzato è già tra quelli letti;
  - altrimenti si salta se `findSimilarRecipeTitle` trova un titolo simile;
  - altrimenti si inserisce con `insertGeneratedRecipe(..., { source: 'manual' })`, e il titolo si aggiunge a quelli noti.

  Le ricette già in libreria, del pacchetto o no, non si toccano: voti, preferite, blocchi e usi restano.
- **FR-3.4 Log.** Una riga a fine caricamento: `[pack] ricette del pacchetto inserite: <n>, già presenti o simili: <m>`. Al secondo avvio `n` è 0. Sul Raspberry, con 26 ricette generate, `n` è 200 meno le ricette simili a quelle già presenti.
- **FR-3.5 Errori.** Un errore durante il caricamento annulla la transazione e scrive `[pack] caricamento interrotto` con l'errore. L'app **parte lo stesso**, senza `process.exit`, e il caricamento si ritenta al riavvio successivo. Un errore di `runDbBootstrap` continua invece a fermare l'avvio, come oggi.
- **FR-3.6 Classificazione.** Le ricette del pacchetto hanno sempre una portata, quindi la classificazione della Feature 8 non le prende mai.

### FR-4 — Sviluppo

- **FR-4.1** `pnpm recipes:pack load` carica il pacchetto sul DB di `DATABASE_URL` con la stessa funzione e la stessa regola di FR-3.3, e stampa la riga di FR-3.4. Serve a provare il pacchetto in locale, dove le 18 ricette d'esempio contano come già presenti per i titoli simili.
- **FR-4.2** `pnpm db:seed` non cambia e non carica il pacchetto. I test non lo caricano mai sul DB condiviso: lo fanno su un household usa-e-getta.

### FR-5 — Cosa non cambia

Planner, pesi, soglia di generazione, swap, scelta dalla libreria, proposta su richiesta e interfaccia restano come sono. Le ricette del pacchetto si vedono, si filtrano, si votano e si bloccano come tutte le altre. Le ricette solo contorno restano fuori dal piano fino alla Feature 11 (`isMainDish`).

## 4. Progettazione tecnica

### 4.1 Dominio (`lib/domain/types.ts`, unica fonte)

- `RecipePackFileSchema = z.object({ recipes: z.array(SavedRecipeInputSchema) })`, con un controllo che i titoli normalizzati siano distinti.
- `PackIngredientFactSchema` (`name`, `category: CategorySchema`, i sei booleani, `reviewed`) e `PackIngredientsFileSchema = z.object({ ingredients: z.array(PackIngredientFactSchema) })`, con nomi unici.
- Gruppi di selezione, quote e ingrediente principale come elenchi chiusi: `PACK_GROUP_VALUES = ['primi', 'secondi', 'piatti-unici', 'contorni']`, `PACK_GROUP_QUOTAS`, `PACK_MAIN_INGREDIENT_VALUES`. Servono solo agli strumenti, ma stanno qui come ogni tipo di dominio.
- Nessun campo nuovo su `RecipeSchema` o sullo schema del DB.

### 4.2 Regole pure (`lib/domain/`)

- `deriveDietFlags(ingredients, facts): DietFlag[]`, dove una ricetta è:
  - **pescetariana** se nessun ingrediente ha `carne`;
  - **vegetariana** se nessuno ha `carne` né `pesce`;
  - **vegana** se è vegetariana e nessuno ha `latticini`, `uova` né `miele`;
  - **senza lattosio** se nessuno ha `latticini`;
  - **senza glutine** se nessuno ha `glutine`.

  Contano anche gli ingredienti *q.b.* (la farina per infarinare). Un nome senza voce nella tabella è un errore (`throw`), non un "no". Il risultato è nell'ordine di `DIET_FLAG_VALUES` e coerente con `expandDietFlags`.
- `titleSimilarity(a, b)`: similarità a trigrammi come `pg_trgm`. Si lavora su parole minuscole senza accenti, ciascuna con due spazi prima e uno dopo, e il valore è |A∩B| / |A∪B|. La usano `select` e `build`; al caricamento resta `findSimilarRecipeTitle` sul DB. Una differenza minima tra le due misure produce al più una ricetta saltata in più, che il log di FR-3.4 rende visibile.
- Parser del dataset: CSV RFC 4180 con campi tra virgolette su più righe, lista di coppie in sintassi Python con apici singoli o doppi ed escape, quantità di FR-1.2. Sono funzioni pure, senza dipendenze nuove: oggi il progetto non ha librerie CSV e non se ne aggiungono.

### 4.3 Database

Nessuna migrazione. Il caricamento usa `listRecipeTitles`, `findSimilarRecipeTitle` e `acquireRecipeGenerationLock` (`lib/db/repositories/recipe-repo.ts`), più `ensureDefaultHousehold`. Quest'ultima oggi scrive con il `db` globale: va bene, perché in produzione il pool è singleton (Feature 8, WP6).

### 4.4 LLM (`lib/llm/`, unico adattatore)

- Due funzioni nuove in `adapter.ts`, sul modello di `classifyRecipes` (`runStructuredCall`, riparazione, `LlmError`):
  - `convertDatasetRecipe(item, options) → GeneratedRecipe`, temperatura 0,4;
  - `draftIngredientFacts(names, options) → PackIngredientFact[]`, al più 40 nomi, temperatura 0,2.
- I prompt vanno in `prompts.ts`: istruzioni e prompt utente della conversione, con il procedimento tra delimitatori e la riga degli errori del secondo tentativo (FR-1.4, punto 5); istruzioni e prompt della tabella.
- Le esporta il barrel `lib/llm/index.ts`. Timeout: `getLlmTimeoutMs()`.

### 4.5 Modulo `recipes`

- `lib/recipes/store.ts`: `insertGeneratedRecipe(executor, householdId, recipe, options?: { source?: RecipeSource })`, default `'llm'`. I chiamanti di oggi non cambiano.
- `lib/recipes/pack/`: gli strumenti (selezione, conversione con memoria e concorrenza, tabella, costruzione, report) e il caricatore `loadRecipePack(deps?)`. Il caricatore accetta un pacchetto e un household iniettabili per i test e restituisce `{ inserted, skipped }`. Solo il caricatore entra nel bundle dell'app; il resto lo importano gli script. Solo questo modulo chiama `lib/llm/`.
- `scripts/recipe-pack.ts`: il comando di FR-1.1, sottile come `scripts/classify-recipes.ts`; carica `.env.local` e `.env`.

### 4.6 Avvio

`instrumentation.ts`: dopo `runDbBootstrap` e il suo log, `await loadRecipePack()` dentro un `try/catch` proprio (FR-3.5); poi l'avvio della classificazione, invariato.

### 4.7 File e comandi

- `.gitignore`: `.recipe-pack/`.
- `package.json`: `"recipes:pack": "tsx scripts/recipe-pack.ts"`.
- `scripts/smoke-prod.sh`: il controllo "zero ricette dopo il bootstrap" diventa:
  - dopo il primo avvio, `select count(*) from recipes` uguale al numero di ricette del pacchetto;
  - dopo il riavvio, nel log la riga `ricette del pacchetto inserite: 0`.

### 4.8 Documentazione

- `ARCHITECTURE`:
  - §1.3: la libreria parte dal pacchetto, e il modello serve a completarla;
  - la sezione sull'avvio: il passo `[pack]`.
- `DEPLOY`:
  - §5: la riga `[pack]` da cercare nel log e il numero di ricette atteso;
  - §9: cosa fare se il caricamento si interrompe.
- `CLAUDE.md` (Comandi): `pnpm recipes:pack`.
- Wiki con `/feature-docs`.

## 5. Requisiti non funzionali

- **Rete nei test**: nessuna. Conversione e tabella si provano con risposte del modello scritte a mano in `tests/fixtures/llm/`. Selezione e parser si provano su un CSV di poche righe scritto per i test, mai su `docs/recipe.csv`, che in CI non c'è.
- **Avvio**: sul Raspberry (Pi 4, 2 GB) il primo caricamento delle 200 ricette resta sotto i 10 secondi. Ai riavvii successivi, con tutti i titoli già presenti, nessuna query di similarità e meno di un secondo.
- **Idempotenza e concorrenza**: rilanciare l'avvio o `load` non duplica nulla. Il lock di generazione serializza il caricamento con una generazione eventualmente in corso.
- **Affidabilità**: il caricamento è tutto o niente (una transazione). Un suo errore non impedisce all'app di partire.
- **Diritti e repository pubblico**: nel repository entrano solo ricette con passi e descrizioni scritti da capo (E3), senza link, indici del dataset o il nome del sito (FR-2.2). Il CSV e `.recipe-pack/` restano ignorati da git. Rischio residuo accettato: il diritto sulle banche dati riguarda l'estrazione di una parte sostanziale, e 200 ricette su 5.939 non lo sono; la licenza del dataset è comunque "Unknown". Per azzerarlo si passa all'alternativa di D1 (file solo sul Raspberry), che cambia solo da dove si legge il pacchetto.
- **Costo e durata della conversione**: al più circa 300 chiamate di conversione, più eventuali secondi tentativi, e circa 10 chiamate per la tabella. Con 3 chiamate in parallelo la conversione dura qualche decina di minuti. Il modello si sceglie al lancio; per la qualità del testo conviene un modello più capace di quello usato a runtime.
- **Compatibilità**: nessun cambio di schema, quindi il ritorno alla 0.8 resta possibile con il dump di `DEPLOY` §6. Le ricette del pacchetto sono righe normali, leggibili anche dalla 0.8.

## 6. Fuori ambito

- Catalogo separato dalla libreria, quota di scoperte, stile nel peso, pesi o soglie del planner (`rework-catalogo.md` §5, `v2-funzionalita.md`).
- L'intero dataset (2.578 ricette) e la classificazione con Jev.
- Link all'originale, campo `source_url`, valore nuovo di `source`.
- Cancellazione delle ricette e la tabella che segnerebbe il pacchetto come caricato: quando la V2 renderà possibile cancellare, una ricetta del pacchetto cancellata tornerebbe al riavvio, e allora servirà un segno nel DB.
- Correzione delle ricette dall'app (`v2-funzionalita.md` §1.4) e aggiornamento di ricette del pacchetto già caricate. Una versione nuova del file aggiunge solo le ricette con titolo nuovo.
- Composizione del pasto e uso dei contorni nel piano (Feature 11).
- Revisione dei titoli in una pagina web o nell'app: basta il file markdown.
- Dolci, antipasti, lievitati, salse, bevande, conserve.
- Nuove dipendenze npm.

## 7. Verifica e criteri di accettazione

Automatici (gate `lint + typecheck + test + build` verde):

1. Parser: CSV con virgolette e a capo nei campi; liste di coppie con apici misti ed escape; quantità ammesse e scartate di FR-1.2, compresi `025g`, `250g1kg` e i numeri senza unità.
2. Selezione su un CSV di prova: criteri, gruppi, ingrediente principale con la sua precedenza, punteggio, sequenza a giro, scarto dei titoli simili, ⌈1,5 × quota⌉ spuntati più le riserve, avviso per gruppo corto, `selection.md` non sovrascritto senza `--force`, lettura di `selection.md` con righe tolte, riserve spuntate e codici sconosciuti.
3. Conversione con modello finto: ingresso al modello (delimitatori, letture delle quantità, nomi in uso), post-elaborazione (`servings_base` forzato, alias risolti), E1–E3 con un secondo tentativo, W1–W4, memoria e ripresa, `--retry-rejected`, errori del modello non salvati come scarto, uscita 1 sotto quota.
4. `deriveDietFlags` su ogni combinazione di attributi, con gli ingredienti *q.b.* e l'errore sul nome assente. `titleSimilarity` su coppie note.
5. Tabella: voci nuove non rivedute, voci esistenti intatte, lotti da 40, `--approve`. `build`: quote, voci non rivedute, titoli simili, alias, reparto e diete dalla tabella, ordine del file.
6. Il file vero `fixtures/recipe-pack.json` rispetta FR-2.1 e FR-2.2.
7. Caricamento su un household usa-e-getta del DB di test:
   - libreria vuota → tutte le ricette entrano, con origine `manual`, portate ed etichette derivate e riga di preferenze;
   - secondo caricamento → 0 inserite;
   - titolo uguale o simile già presente → saltato;
   - errore a metà → nessuna ricetta inserita.
8. `instrumentation.ts`:
   - il caricamento avviene dopo il bootstrap e prima della classificazione;
   - un suo errore scrive `[pack] caricamento interrotto` e non ferma l'avvio;
   - con `DB_BOOTSTRAP_ON_START` diverso da `true` non succede nulla.
9. `insertGeneratedRecipe` scrive `'llm'` di default e `'manual'` con l'opzione.

Manuali (alla chiusura):

10. **Preparazione vera del pacchetto**:
    - `select`;
    - revisione dei titoli da parte dell'utente;
    - `convert` con il modello scelto;
    - lettura del report, con le ricette con avvisi guardate una per una;
    - `ingredients` e revisione della tabella da parte dell'utente;
    - `build`;
    - commit dei due file di `fixtures/`.
11. Controllo a campione: 10 ricette del pacchetto lette per intero (passi chiari, quantità sensate per le porzioni, diete giuste), confrontate con l'originale solo dal link nel report.
12. `docker build` + `scripts/smoke-prod.sh`: ricette caricate al primo avvio, `inserite: 0` al riavvio.
13. Stack di produzione locale senza chiave del modello: dopo l'onboarding, *Genera piano* produce un piano completo senza chiamate al modello (`generation.rounds` = 0).
14. Raspberry dopo il deploy: riga `[pack]` nel log, ricette in libreria = 26 + inserite, primo piano vario. Prova da telefono a 360 px di due ricette del pacchetto (scheda, passi, lista della spesa).
