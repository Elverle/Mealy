---
title: E2 Libreria e Preferenze — Libreria Reale, Giudizi su Ricette e Ingredienti
type: topic
created: 2026-10-05
updated: 2026-10-21
tags: [library, preferences, recipe-prefs, ingredient-prefs, filters, search, api, ui, e2, feature-5]
---

## Panoramica

L'iniziativa **E2 Libreria e preferenze** (Feature 5, story `S2.1`–`S2.3` del backlog) rende la libreria navigabile e giudicabile. Tre risultati:

1. **Libreria reale** al posto della pagina con dati finti della Feature 1: ricerca per titolo o ingrediente, filtri a chip, card con ★ rapida, dettaglio con le quantità scalate sulle persone dell'household ([[library-screen]], [[library-service]]).
2. **Preferenze sulla ricetta** (voto 1–5, ★ preferita, *Non proporre più*) salvate e usate dal planner, attive in Libreria **e** nel Piano tramite un unico dettaglio ([[recipe-detail-sheet]], [[prefs-service]]).
3. **Preferenze sull'ingrediente** (👍/👎 sul nome canonico): tabella `ingredient_prefs`, API, conferma di scarto con l'impatto, sezione *I miei ingredienti* nelle Impostazioni ([[ingredient-prefs-section]]) e cablaggio nel planner (scarto = esclusione, gradimento = peso maggiore) e nella generazione LLM (lo scarto non viene più né proposto né generato).

Il planner **non è stato modificato**: scarto e gradimento erano già implementati dalla Feature 4 ([[planner]]); questa feature porta i dati reali in `loadIngredientPreferences` e cambia un solo commento in `lib/domain/planner.ts`. Anche `lib/llm/` è invariato: il prompt aveva già le due righe sugli ingredienti graditi e da non usare.

### Decisioni dell'utente (requirements 2026-10-05 e Addendum della review architetturale)

| ID | Decisione |
|---|---|
| U1 | **Preferenze attive in Piano e in Libreria**: ★ rapida sulla card-pasto e sulla card di libreria; voto, *Preferita*, *Non proporre più* e 👍/👎 sugli ingredienti nel dettaglio aperto da entrambe le pagine. Chiude U4 della Feature 4 |
| U2 | **Il piano in corso non cambia**: bloccare una ricetta o scartare un ingrediente vale dalla prossima generazione, rigenerazione, *Ripeti* o *Cambia*. Un toast lo dice |
| U3 | **Filtri: riga rapida + pannello**. Sempre visibili *Preferite*, *Pranzo*, *Cena* e il pulsante *Filtri* con contatore; il pannello contiene tipo di pasti (7), dieta (5) e *Bloccate* |
| U4 | **Ordinamento: preferite in alto, poi le più recenti** (a parità, titolo A–Z); l'ordine si ricalcola subito quando una ★ cambia |
| D1 | Il giudizio su un ingrediente vale per il **nome canonico esatto** (dopo `normalizeCanonicalName`): varianti come «cipolla rossa» rispetto a «cipolla» sono ingredienti distinti e si giudicano a parte. Gli alias non si risolvono |

## Architettura del Flusso

```
[ /libreria ]                    [ / (Piano) ]                [ /impostazioni ]
      │                                │                              │
      ▼                                ▼                              ▼
+───────────────────────────+  +──────────────────────+  +───────────────────────────+
| libreria/page.tsx (server)|  | PlanScreen           |  | impostazioni/page.tsx     |
| listLibraryCards()        |  |  ★ su PlanSlotCard   |  | getSettings()             |
| getSettings().persons     |  |  dettaglio dello slot|  | listIngredientPrefs()     |
| <LibraryScreen …/>        |  +──────────────────────+  | <SettingsEditor …/>       |
|  filtro e ordine in       |             │              |  └ IngredientPrefsSection |
|  memoria, ★ rapida        |             │              |     rimozione a un tap    |
+───────────────────────────+             │              +───────────────────────────+
      │                                   │                              │
      └──────────────┬────────────────────┘                              │
                     ▼                                                   │
+──────────────────────────────────────────────────────+                 │
| RecipeDetailSheet (components/recipes/)              |                 │
|  fetchRecipeDetail · putRecipePref · putIngredientPref|◄───────────────┘
+──────────────────────────────────────────────────────+   (putIngredientPref)
                     │ lib/library/client.ts · lib/prefs/client.ts (requestJson)
                     ▼
+──────────────────────────────────────────────────────────────────────+
| app/api/recipes            GET  (filtri in query string)             |
| app/api/recipes/:id        GET  (dettaglio + giudizi e impatto)      |
| app/api/recipes/:id/pref   PUT  (aggiornamento parziale)             |
| app/api/ingredient-prefs   GET  · /:canonicalName  PUT               |
+──────────────────────────────────────────────────────────────────────+
                     │
                     ▼
+──────────────────────────────────────────────────────────────────────+
| lib/library/service.ts            lib/prefs/service.ts               |
+──────────────────────────────────────────────────────────────────────+
      │ puro                                │ repository
      ▼                                     ▼
 lib/domain/library.ts, prefs.ts       recipe-repo, ingredient-pref-repo

 lib/prefs/ingredient-prefs.ts  loadIngredientPreferences(householdId, executor)
      ├─► lib/plans/service.ts     (planner: fuori e dentro il lock del piano)
      └─► lib/recipes/generate.ts  (vincoli del prompt e controllo dopo la generazione)
```

## Moduli e Componenti Introdotti

### 1. Dominio puro (`lib/domain/`)
- [[library-service]]: `lib/domain/library.ts` con `recipeIngredientNames`, `toLibraryCard`, `matchesLibraryFilter`, `compareLibraryCards`, `filterLibraryCards`, `parseLibraryQuery`. Le stesse funzioni servono la rotta `GET /api/recipes` e il filtro in memoria della schermata.
- [[prefs-service]]: `lib/domain/prefs.ts` con `defaultRecipePref`, `applyRecipePrefPatch` (bloccare toglie dalle preferite), `countRecipesByIngredient` (impatto) e `parseIngredientPrefName` (unica validazione del nome di un giudizio).
- [[domain-types]]: blocco `Library & Preferences (Feature 5)` in `types.ts` con filtro, card, dettaglio e i DTO delle preferenze.

### 2. Dati (`lib/db/`)
- [[database-schema]]: decima tabella `ingredient_prefs` con chiave `(household_id, canonical_name)` e migrazione `0004_add_ingredient_prefs`.
- [[ingredient-pref-repo]]: `listIngredientPrefRows`, `upsertIngredientPref`, `deleteIngredientPref`.
- [[recipe-repo]]: `recipeBelongsToHousehold`, `ensureRecipePrefRow`, `lockRecipePref`, `writeRecipePref`.

### 3. Servizi, API e trasporto
- [[library-service]]: `listLibraryCards`, `listLibrary`, `getRecipeDetail`; rotte `GET /api/recipes` e `GET /api/recipes/:id`; client `fetchRecipeDetail`.
- [[prefs-service]]: `updateRecipePref`, `listIngredientPrefs`, `setIngredientPref`; rotte `PUT /api/recipes/:id/pref`, `GET /api/ingredient-prefs`, `PUT /api/ingredient-prefs/:canonicalName`; client `putRecipePref` e `putIngredientPref`; `loadIngredientPreferences` ora legge il DB.
- [[recipe-generation]]: `buildConstraints` riceve gli insiemi di preferenze; `generateAndStoreRecipes` li legge prima della chiamata LLM e rilegge gli scarti dentro la transazione di salvataggio.
- [[http-helpers]]: `apiErrorMessage(err)` in `lib/http/client.ts`, usata da tutte le schermate al posto delle copie in linea.

### 4. Interfaccia
- [[library-screen]]: pagina `/libreria`, `LibraryScreen`, `LibraryFilters`, `RecipeCard`, scheletro `loading.tsx`.
- [[recipe-detail-sheet]]: dettaglio unico per Piano e Libreria, con caricamento, salvataggi ottimistici e impatto prima dello scarto.
- [[recipe-sheet]]: scheletro di caricamento, conferma di scarto con impatto e nome canonico, stati disabilitati, sincronizzazione delle porzioni per id; `recipe-detail.ts` con `ingredientRowId`, `findRecipeIngredient` e il terzo parametro di `toRecipeDetail`.
- [[plan-screen]]: ★ sulle card del piano e dettaglio completo al posto della sheet senza azioni.
- [[ingredient-prefs-section]] e [[settings-editor]]: sezione *I miei ingredienti* al posto del segnaposto.
- [[toast]]: contenitore a `z-[60]`, sopra la sheet.

## Regole di Dominio Principali

- **Giudizi e piani**: un giudizio (su ricetta o ingrediente) non modifica mai un piano esistente e non tocca `households.updated_at`; nessun modulo della feature chiama `lib/plans/service.ts`. Vale dalla selezione successiva: generazione, rigenerazione, *Ripeti* o *Cambia* (U2, `ARCHITECTURE §5.4`). Quindi un 👎 non rende "superato" il piano in corso e non marca la lista della spesa come da rigenerare.
- **Bloccare toglie dalle preferite**: `blocked ⇒ favorite = false`, in una sola funzione pura (`applyRecipePrefPatch`) usata dal server e dagli aggiornamenti ottimistici del client. Sbloccare non rimette la preferita.
- **Aggiornamento parziale**: `PUT /api/recipes/:id/pref` accetta `rating`, `favorite`, `blocked` (almeno uno); `rating: null` toglie il voto. Il server fonde il patch sulla riga bloccata con `SELECT … FOR UPDATE`, dopo averla creata se manca, così due prime scritture concorrenti si serializzano.
- **Nome canonico**: la chiave di un giudizio su ingrediente è `canonical_name` normalizzato; il confronto è per uguaglianza esatta in planner (`exclusionReason`), controllo dopo la generazione (`findConstraintViolations`) e conteggio d'impatto (D1).
- **Impatto** di un ingrediente (`recipes_count`): numero di ricette **non bloccate** della libreria dell'household che lo contengono, calcolato in memoria da `countRecipesByIngredient`. Arriva già con il dettaglio (`GET /api/recipes/:id`), quindi la conferma di scarto lo mostra prima di salvare.
- **Conferme**: solo lo scarto (👎) chiede conferma; 👍, rimozione di un giudizio e rimozione da *I miei ingredienti* sono a un tap.
- **Filtri della Libreria**: tutti in AND; una ricetta vegana soddisfa anche *Vegetariano* (`expandDietFlags`); *Bloccate* acceso mostra solo le bloccate, spento le nasconde. Ricerca senza accenti e maiuscole, per parole, su titolo e nomi canonici degli ingredienti.
- **Ordine**: preferite prima, poi `created_at` decrescente, poi titolo (`localeCompare` italiano), poi id.
- **Generazione LLM**: tutti gli scarti entrano nei vincoli (servono anche al controllo deterministico dopo la generazione); i gradimenti sono al più 30, in ordine alfabetico.

### Aggiornamenti ottimistici e risposte fuori ordine

Le preferenze di una ricetta si possono cambiare da due punti contemporaneamente (★ sulla card e barra azioni del dettaglio), e ogni risposta del server riporta **tutta** la riga com'era al proprio commit. Per non riportare a schermo valori vecchi vale una regola unica (proposta R2 della review architetturale): **ogni risposta applica solo i campi della propria richiesta**, più `favorite` quando la richiesta contiene `blocked`.

- `RecipeDetailSheet` chiama `onRecipePrefsChange(recipeId, changed)` con i soli campi cambiati (`RecipePrefChanges`), e li fonde nel proprio stato.
- `LibraryScreen.patchCard` e `PlanScreen.applyRecipePrefs` fondono `changed` nella card o negli slot; la ★ rapida applica solo `favorite`.
- In entrambe le schermate una ricetta bloccata non è mai mostrata come preferita, anche se arriva in ritardo la risposta di una ★ (fix della code review).
- Durante un salvataggio i controlli dello stesso gruppo sono disabilitati (barra azioni oppure 👍/👎) e un secondo tocco sulla stessa ★ è ignorato.

## Innesti delle Review

**Architecture review 2026-10-05** (`docs/planning/feature/feature-5/architecture-review-2026-10-05.md`, tabella "Riepilogo dell'impatto sul piano"): confronto sul nome esatto confermato dall'utente, con `RecipeIngredient.canonicalName` e la conferma di scarto titolata con il nome canonico (R1 / D1-a), frase in `ARCHITECTURE §5.4` (D1-b) e contratto di backfill per la Feature 6 (D1-c); `onRecipePrefsChange` con i soli campi cambiati (R2); commento sul costo della lettura completa in testa ai due servizi (R3); household dedicato nei test di generazione (R4); toast a `z-[60]` (R5); **niente** `buildLibraryQuery`, `fetchLibrary`, `fetchIngredientPrefs`, che il piano prevedeva ma nessun componente avrebbe chiamato (R6); `apiErrorMessage` in `lib/http/client.ts` (P3).

**Code review** (fix nei commit `0045d78` e `aa38826`; non c'è un file di review nella cartella della feature):
- lato server: `ensureRecipePrefRow` crea la riga di `recipe_prefs` prima di `lockRecipePref`; `parseIngredientPrefName` è l'unica validazione del nome per rotta e servizio e rifiuta i caratteri di controllo; la rotta `[canonicalName]` non decodifica più il parametro; `generateAndStoreRecipes` rilegge gli scarti dentro la transazione di salvataggio; `RecipeIngredientInfoSchema.canonical_name` non ha lunghezza massima;
- lato interfaccia: `RecipeSheet` riallinea porzioni e conferma in sospeso durante il render e non in un effetto; una ricetta bloccata non torna preferita per una risposta tardiva; la conferma di scarto è un `alertdialog` che porta il focus su *Annulla*; *I miei ingredienti* sposta il focus dopo una rimozione e la annuncia ai lettori di schermo; nella card di libreria titolo e badge stanno fuori dal pulsante, che copre la card con uno pseudo-elemento.

## Contratti Consegnati alle Feature Successive

- **Feature 6 (lista della spesa)**: i giudizi non impostano `shopping_lists.needs_regeneration`, perché non modificano i piani. Se la Feature 6 introduce una canonicalizzazione dei nomi (alias risolti in scrittura, o vocabolario della libreria nel prompt), il backfill deve riscrivere insieme `recipe_ingredients.canonical_name` e `ingredient_prefs.canonical_name`; se due righe collidono sulla chiave `(household_id, canonical_name)`, vince `dislike` (sezione "Contratti consegnati" del piano, D1-c).
  - **Esito nella Feature 6** ([[e4-lista-spesa]]): la Feature 6 **non** ha introdotto una canonicalizzazione in scrittura, quindi nessun backfill (decisione U1 dei suoi requirements). Gli alias si risolvono solo quando si costruisce la lista della spesa ([[shopping-list]]); ricette, preferenze e planner confrontano ancora il nome canonico esatto, e la regola D1 di questa feature resta com'è. Il contratto di backfill resta valido per una feature futura. I giudizi continuano a non impostare `needs_regeneration`.
- **Feature 7 (deploy)**: una migrazione in più (`0004`), applicata dallo stesso `pnpm db:migrate`.
  - **Esito nella Feature 7** ([[e6-deploy]]): in produzione `pnpm db:migrate` non gira. La `0004` la applica l'app all'avvio, insieme alle altre, con il migratore di `drizzle-orm` ([[db-bootstrap]]). In sviluppo e nel gate CI resta `pnpm db:migrate`.
- **v2 (uso condiviso)**: `ingredient_prefs` è già partizionata per household.
- **Sviluppi nella Feature 9** ([[f9-ricette-su-richiesta]]): la Libreria offre *Chiedi una ricetta per «…»* sotto i risultati della ricerca; `RecipeCard` accetta un `badge` e una ★ non interattiva; `RecipeDetailSheet` accetta un'azione primaria; il filtro e l'ordine di `lib/domain/library.ts` servono anche il selettore del Piano. La regola "uno scarto è un'esclusione dura" vale ora per il **sorteggio**: una ricetta chiesta apposta o scelta a mano si può salvare e mettere nel piano anche se contiene un ingrediente scartato, e il sorteggio continua a non proporla (`ARCHITECTURE §5.4`, spec D7–D8 della Feature 9).
- **Sviluppi nella Feature 8** ([[f8-portate-etichette]]): il pannello *Filtri* ha per primo il gruppo *Portata* (in OR al suo interno, in AND con gli altri gruppi, che restano in AND anche al loro interno); il gruppo *Tipo di pasti* ha dodici chip; ogni gruppo è etichettato dal suo titolo. Le card mostrano la portata in un badge `basil-subtle` e, su una ricetta classificata, non ripetono *Piatto unico* tra i chip. `GET /api/recipes` accetta il parametro `portata` ([[library-service]], [[library-screen]]).
- **Documenti di progetto allineati dalla feature**: `ARCHITECTURE §4.2` (chiave `(household_id, canonical_name)`) e `§5.4` (bloccare toglie dalle preferite, il giudizio vale dalla selezione successiva, impatto sulle ricette non bloccate, nome canonico esatto), `BACKLOG` S2.3 (chiave della tabella), `DESIGN §4.4` (ricerca per titolo o ingrediente, riga rapida e pannello *Filtri*, ordine delle card, bloccate solo con il filtro dedicato).
- **Punti aperti delle feature precedenti chiusi qui**: U4 della Feature 4 (★, voto e blocco nascosti) attivato passando gli handler; P17 della Feature 4 (nessun `GET /api/recipes/:id`) con la nuova rotta, mentre il Piano continua a mostrare subito la ricetta che ha già; R1 della Feature 3 (le preferenze ingrediente non toccano `households.updated_at`) **confermato** dall'utente con U2 ([[settings-service]]); R4 della review della Feature 4 (un solo punto di lettura delle preferenze ingrediente) con `lib/prefs/ingredient-prefs.ts`, usato da `lib/plans/service.ts` e `lib/recipes/generate.ts`.

## Punti Aperti e Limiti Noti

- **Nome esatto (D1)**: scartare `cipolla` non esclude le ricette con `cipolla rossa`, e il conteggio d'impatto conta per lo stesso nome esatto. Nelle risposte LLM registrate (`tests/fixtures/llm/recorded/`) e nelle fixture lo stesso ingrediente compare sotto nomi diversi (`ceci` / `ceci cotti` / `ceci lessati`, `pepe` / `pepe nero`, `olio di oliva` / `olio extravergine d'oliva` / `olio extravergine di oliva`), e `ingredient_aliases` non è letta da nessun codice applicativo (solo dal seed). La frammentazione dei nomi è rinviata alla Feature 6, con il contratto di backfill scritto sopra. **Esito**: la Feature 6 l'ha affrontata solo per la lista della spesa, dove gli alias (35 voci, comprese le varianti di olio e ceci citate qui) fondono i nomi; per i giudizi e per il planner il limite resta, e `ingredient_aliases` è ora letta dal servizio della lista ([[shopping-service]]).
- **Lettura completa della libreria (R3)**: `getRecipeDetail` (ogni apertura del dettaglio, anche dal Piano), `setIngredientPref` (ogni 👍/👎), `listIngredientPrefs` (ogni visita delle Impostazioni) e `listLibraryCards` (ogni visita della Libreria) chiamano `listRecipes` sull'intera libreria. Misure della review su desktop con 10 ingredienti per ricetta: 31 ms a 100 ricette, 57 ms a 300, 158 ms a 1000; sul Raspberry non misurato. Nessuna azione ora; il rimedio è annotato in testa a `lib/library/service.ts` e `lib/prefs/service.ts`: conteggio in SQL per il solo ingrediente richiesto, sull'indice `recipe_ingredients_canonical_name_idx`.
- **Nomi che non compaiono in nessuna ricetta**: `PUT /api/ingredient-prefs/:canonicalName` accetta qualsiasi nome valido, anche se nessuna ricetta lo contiene (`recipes_count: 0`). Lasciato così per la v1; da rivedere per l'uso condiviso della v2.
- **Rimozione senza annulla**: in *I miei ingredienti* la rimozione è a un tap, senza conferma né annulla, per decisione di planning (requirements P15); da rivalutare nel test da telefono di fine v1.
- **`GET /api/recipes` e `GET /api/ingredient-prefs` senza consumatore**: le due rotte esistono (task di S2.1 e S2.3, `ARCHITECTURE §6`), ma l'interfaccia v1 non le chiama: la Libreria filtra in memoria e *I miei ingredienti* riceve i dati dalla pagina server. I client corrispondenti non sono stati scritti (R6).
- **Non verificato su un dispositivo reale** (jsdom non ha layout): il toast sopra la sheet, il pulsante esteso della card di libreria sotto la ★ e sotto l'etichetta *Bloccata*, la posizione di scorrimento della conferma di scarto su una ricetta lunga, le dimensioni dei tap target.
- **Preesistente, non affrontato qui**: `components/ui/sheet.tsx` non gestisce il focus (nessun focus iniziale, nessuna trappola, nessun ritorno al controllo che ha aperto la sheet); chiude con `Esc` e blocca lo scorrimento del `body`. **Dalla Feature 9** la primitiva tiene una pila delle sheet aperte (Esc chiude solo l'ultima, lo scorrimento torna a pila vuota); il focus resta non gestito ([[sheet-primitive]]).
- Fuori ambito per decisione: paginazione, filtri nell'URL e contrassegno "contiene un ingrediente scartato" sulle card (requirements P21); inserimento manuale, modifica o eliminazione di ricette dalla Libreria (sezioni "Fuori ambito" del piano).

## Strategia di Test

La suite conta **835 test** in 68 file (571 in 47 file alla fine della Feature 4). Nuovi file:
- dominio puro: `tests/domain/{library,prefs,library-contracts}.test.ts`;
- DB reale: `tests/db/{ingredient-pref-repo,recipe-pref-repo}.test.ts`, `tests/library/service.test.ts`, `tests/prefs/{service,ingredient-prefs,planner-integration}.test.ts`, `tests/plans/ingredient-prefs.test.ts` (household dedicati eliminati a fine test; dove si genera un piano, `now` fisso, RNG seedato e `generate` iniettato; nessuna chiamata di rete);
- rotte con servizio mockato: `tests/api/{recipes,recipe-pref,ingredient-prefs}.test.ts`;
- client: `tests/library/client.test.ts`, `tests/prefs/client.test.ts`;
- pagina server: `tests/app/library-page.test.tsx`;
- UI (jsdom): `tests/ui/{library-screen,library-filters,recipe-detail-sheet,recipe-sheet,ingredient-prefs-section}.test.tsx`.

Le accettazioni del backlog sono coperte così: una ricetta bloccata tramite il servizio non compare mai in 20 piani seedati e ricompare dopo lo sblocco (`planner-integration`); con uno scarto attivo 20 piani seedati non contengono mai le ricette con quell'ingrediente e lo swap fallisce con `no_alternatives` (`tests/plans/ingredient-prefs.test.ts`); una ricetta registrata che contiene uno scarto non entra in libreria, anche se lo scarto arriva durante la chiamata LLM (`tests/recipes/generate.test.ts`); con due gradimenti la ricetta esce più spesso in un'estrazione statistica (`tests/prefs/ingredient-prefs.test.ts`).

Adeguati: `tests/db/schema.test.ts` (10 tabelle, colonne di `ingredient_prefs`, file della migrazione `0004`), `tests/http/client.test.ts` (`apiErrorMessage`), `tests/recipes/{constraints,generate}.test.ts`, `tests/ui/{plan-screen,plan-slot-card,settings-editor,shell}.test.tsx`, `tests/ui/recipe-detail.test.ts`, `tests/app/settings-page.test.tsx`.

## Vedi anche

- [[library-screen]] — Pagina e schermata Libreria, filtri e card
- [[recipe-detail-sheet]] — Dettaglio ricetta con preferenze, per Piano e Libreria
- [[library-service]] — Regole pure, servizio, API e client della libreria
- [[prefs-service]] — Regole pure, servizio, API e client delle preferenze
- [[ingredient-pref-repo]] — Repository di `ingredient_prefs`
- [[ingredient-prefs-section]] — Sezione *I miei ingredienti*
- [[planner]] — Scarto e gradimento nella selezione pesata
- [[e3-pianificatore]] — Feature 4: planner e pagina Piano su cui si innestano le preferenze
- [[e5-impostazioni]] — Feature 3: pagina Impostazioni e punto aperto R1
- [[e1-motore-ricette]] — Feature 2: generazione delle ricette, ora con gli scarti nei vincoli
- [[e4-lista-spesa]] — Feature 6: alias risolti solo nella lista della spesa
- [[e6-deploy]] — Feature 7: migrazioni applicate all'avvio in produzione
- [[f9-ricette-su-richiesta]] — Feature 9: richiesta di una ricetta dalla Libreria e scelta a mano nel Piano
- [[f8-portate-etichette]] — Feature 8: filtro *Portata* e badge sulle card
