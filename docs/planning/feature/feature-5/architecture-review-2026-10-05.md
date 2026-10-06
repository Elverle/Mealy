# Architecture review — Feature 5 (E2 Libreria e preferenze)

**Data:** 2026-10-05 · **Piano esaminato:** [`plan.md`](plan.md) (+ [`requirements.md`](requirements.md)) · **Contesto:** as-built di F1–F4 (`main`, commit `ffee6f3`, v0.3.0), `docs/ARCHITECTURE.md`, `docs/BACKLOG.md` (S2.1–S2.3), `docs/planning/execution-strategy.md` (§3 Feature 5–6, §4), review di F4.

**Esito in una riga:** nessun punto bloccante. Il piano si appoggia correttamente al codice reale e si può implementare così com'è; i punti sotto sono una decisione di prodotto da rendere esplicita (R1) e alcune correzioni piccole, da innestare nei WP indicati.

> **Nota sugli ID.** `P1…P3` e `R1…R6` sono gli ID di questa review. Le decisioni di `requirements.md` (che usa anch'esso `P1…P21` e `U1…U4`) sono sempre citate come «req. P*n*» / «req. U*n*».

## Metodo e prove raccolte

- **Gate completo sul codice attuale** (Postgres di sviluppo attivo sulla 5432, `pnpm db:migrate` applicato): `lint` ✅, `typecheck` ✅, `test` ✅ **571/571** in 47 file (109 s, test DB compresi), `build` ✅.
- **Porta del DB.** Oggi la 5432 era libera (il container `smart-portfolio-db` dell'altro progetto era spento) e `mealy-postgres-dev` è partito senza override. La regola 0.3.7 del piano dà la porta per occupata: vale solo quando quel container è acceso, quindi conviene controllare con `docker ps` prima di usare l'override sulla 5433.
- **`pnpm db:generate` → "No schema changes"**: schema e snapshot coincidono, quindi la `0004` di WP2 conterrà solo `ingredient_prefs` (la condizione "fermarsi e segnalarlo" del passo 2 non scatterà).
- **Versioni installate**: Next 15.5.25, zod 3.25.76, drizzle-kit 0.30.6 — come dichiara il piano (§0.2).
- **Ipotesi della §0.2 verificate sul codice**: `loadIngredientPreferences(householdId, executor = db)` esiste e restituisce insiemi vuoti (`lib/prefs/ingredient-prefs.ts:14-22`); `lib/plans/service.ts` la chiama fuori dal lock (`:264`) e dentro (`:275`, con `tx`); `exclusionReason` e `recipeWeight` gestiscono già scarti e gradimenti (`lib/domain/planner.ts:68-71`, `:125-131`); `buildConstraints` ha tre parametri e due liste vuote (`lib/recipes/constraints.ts:14-28`); `buildRecipePrompt` scrive già le due righe (`lib/llm/prompts.ts:62-70`); `RecipeSheet` mostra barra azioni e 👍/👎 solo con gli handler (`components/sheets/recipe-sheet.tsx:84`, `:233`); `MealCard` mostra la ★ solo con `onToggleFavorite` (`components/cards/meal-card.tsx:209`); `listRecipesWith(executor, …)` esiste (`recipe-repo.ts:309`); `insertRecipeWith` crea sempre la riga di `recipe_prefs` (`:153-163`).
- **I sei segnaposto "F5" nel codice sono tutti coperti dal piano**: `lib/prefs/ingredient-prefs.ts:20` (WP2), `lib/domain/planner.ts:11` (WP2), `lib/recipes/constraints.ts:25-26` (WP4), `lib/domain/types.ts:298` (WP1), `components/settings/ingredient-prefs-placeholder.tsx` (WP8). Nessun altro `TODO`/`FIXME` in `lib/`, `components/`, `app/`.
- **Conti dei test del piano rifatti sulla configurazione reale** (`PLANNER_CONFIG`: `minPoolSize 3`, `ingredientLikeStep 0.15`, `ingredientLikeMaxCount 2`, `noveltyBonus 1.2`):
  - WP2 `tests/plans/ingredient-prefs.test.ts` test 1 e WP3 `planner-integration`: 5 slot ⇒ `required = 5 + 3 − 1 = 7`; restano 7 candidate ⇒ nessun `needMore`, `generate` mai chiamata ✅. È esattamente al limite: con una ricetta in meno il generatore finto verrebbe chiamato (non rompe il test di WP3, ma romperebbe l'asserzione "mai chiamata" di WP2).
  - WP2 test statistico: due ricette mai usate, due gradimenti su A ⇒ rapporto atteso `1 + 0.15 × 2 = 1.30` ✅.
  - WP2 test 3 (swap): senza alternative `swapSlot` chiama una volta `generate`, poi lancia `PlanError('no_alternatives')` (`service.ts:660-681`) ✅.
- **Nomi canonici reali.** Estratti i `canonical_name` dalle 4 risposte LLM reali in `tests/fixtures/llm/recorded/` (108 ingredienti, 53 nomi distinti) e dalle 18 ricette di `fixtures/recipes.json` (53 nomi, tutti già normalizzati). Risultato in **P1**.
- **Costo di una lettura completa della libreria**, misurato su questa macchina (desktop, Postgres locale) con un household dedicato da 10 ingredienti per ricetta, mediana di 7 letture di `listRecipes`:

  | Ricette | `listRecipes` | di cui sola query | `countRecipesByIngredient` in memoria |
  |---|---|---|---|
  | 100 | 31 ms | 14 ms | 1 ms |
  | 300 | 57 ms | 36 ms | 2 ms |
  | 1000 | 158 ms | 103 ms | 8 ms |

  Sul Raspberry (F7) i tempi saranno più alti; **non li ho misurati**.

---

## 1. Problemi attuali (ordinati per impatto)

### P1 — `canonical_name` non è canonico nella pratica · **da tenere d'occhio** (è la chiave di F5 e di F6)

**File:** `lib/llm/prompts.ts:14` (unica regola: "minuscolo, al singolare, senza aggettivi di preparazione"), `lib/recipes/generate.ts:142-149` (i nomi si salvano così come arrivano), `lib/domain/planner.ts:68-70` e `lib/recipes/constraints.ts:66-72` (confronto per uguaglianza dopo `normalizeCanonicalName`), `fixtures/ingredient-aliases.json`, `lib/db/schema.ts:251`.

- Nelle 4 risposte reali registrate lo stesso ingrediente compare con nomi diversi: `cipolla` / `cipolla rossa`; `ceci` / `ceci cotti` (le fixture usano `ceci lessati`); `lenticchia` / `lenticchie rosse` / `lenticchie secche`; `pepe` / `pepe nero`; `paprika` / `paprika dolce` / `paprika affumicata`; `pasta` / `pasta corta` (fixture: `pasta di semola`); `olio di oliva` / `olio extravergine d'oliva` (fixture: `olio extravergine di oliva`, presente in 18 ricette su 18); `couscous` (fixture: `couscous di grano`).
- `ingredient_aliases` (24 voci) copre **una sola** di queste varianti (`pepe` → `pepe nero`), e oggi nessun codice la legge: è usata solo dal seed e dai suoi test.
- Né il prompt né l'inserimento conoscono i nomi già in libreria, quindi niente spinge il modello a riusarli.
- Perché è un problema: tutto ciò che F5 costruisce sugli ingredienti (scarto, gradimento, conteggio d'impatto) e tutto il consolidamento di F6 usa quel nome come chiave d'identità. Finora non si vedeva, perché nessuna funzione dipendeva dall'uguaglianza dei nomi.

### P2 — Ogni lettura della libreria carica e valida tutto · **da tenere d'occhio, nessuna azione ora**

**File:** `lib/db/repositories/recipe-repo.ts:73-99` (`toRecipeWithDetails`), `:309-332` (`listRecipesWith` / `listRecipes`), `:264-275` (`getRecipeById`, senza `executor` e senza controllo dell'household).

- L'unica lettura per household restituisce tutte le ricette con ingredienti e preferenze. Ogni ingrediente passa due volte per Zod (`IngredientSchema.parse` alla riga 77, poi di nuovo dentro `RecipeSchema.parse` alla riga 88), e così le preferenze.
- Il costo cresce in modo lineare (tabella sopra): circa 0,16 ms a ricetta su desktop, per due terzi nella query.
- Oggi i chiamanti sono solo generazione, *Ripeti* e *Cambia* (2–3 letture per operazione, poche volte a settimana), quindi il costo non si sente.

### P3 — Due punti cosmetici che F5 moltiplica

- **Messaggio d'errore generico ripetuto.** `"Qualcosa è andato storto. Riprova."` è scritto in `lib/http/client.ts:7`, `components/plan/plan-screen.tsx:48` e `components/plan/plan-slot-card.tsx:50`, ogni volta con lo stesso `err instanceof … ? err.message : …`. Il piano ne aggiunge altre tre copie (WP5 `FALLBACK_ERROR`, WP6 in linea, WP7).
- **Vocabolario della sheet diverso dal dominio.** `RecipeDetail` / `RecipeIngredient` (`components/sheets/recipe-sheet.tsx:26-46`) parlano di `"liked" | "disliked"`, `isFavorite`, `rating?: number`; il dominio di `'like' | 'dislike'`, `favorite`, `rating: number | null`. È un'eredità dei dati finti di F1. Il piano la incapsula bene (`recipe-detail.ts` in un verso, `RecipeDetailSheet` nell'altro) e il vincolo di compatibilità di WP5 impedisce di toccarla prima della wave 3: **nessuna azione**.

### Aree senza problemi da segnalare

- **Stratificazione.** `lib/domain/*` è puro; `plans` → `recipes` → `llm` va in una sola direzione; `lib/prefs/ingredient-prefs.ts` è importabile da `plans` e da `recipes` senza cicli (R4 della review di F4 è chiuso davvero: WP4 lo usa da `generate.ts`).
- **Il planner è pronto come promesso.** Scarto e gradimento sono già implementati e testati; F5 cabla i dati e cambia un commento.
- **Selezione dentro il lock.** `loadConstraints(householdId, tx)` rilegge le preferenze con la transazione (`service.ts:269-276`): un 👎 salvato durante una generazione lunga viene visto dalla selezione finale. Nessuna modifica necessaria.
- **Scritture su `recipe_prefs` senza aggiornamenti persi.** `incrementRecipeUsage` tocca solo `times_used` / `last_used_at` (`plan-repo.ts:303-311`), `writeRecipePref` di WP2 solo `rating` / `favorite` / `blocked`: conferma del piano e giudizi non si pestano. Il `SELECT … FOR UPDATE` di `lockRecipePref` blocca una riga sola, quindi non può formare un ciclo con la conferma.
- **Trasporto.** `lib/http/responses.ts` e `lib/http/client.ts` sono in uso su tutte le rotte e i client di F4; il piano li riusa senza una nuova gerarchia di errori (req. P19).
- **Isolamento dei test DB.** La chiave `(household_id, canonical_name)` (req. P2) e la `ON DELETE cascade` tengono i nuovi test indipendenti tra file paralleli, come quelli esistenti.
- **File disgiunti per wave.** Ho ricontrollato le liste di file degli 8 WP: nessuna sovrapposizione dentro una wave, e il gate resta verde tra una wave e l'altra (la pagina finta di F1 e `PlanScreen` continuano a compilare dopo WP5, perché le modifiche a `RecipeSheet` sono solo aggiunte).

---

## 2. Rischi introdotti o amplificati dalla feature

### R1 — "Mai più proposto né generato" vale solo per il nome esatto · **da tenere d'occhio (alto: è l'accettazione di S2.3)** — amplifica P1

**Piano:** req. P3 e P16; WP2 passo 7 (ARCHITECTURE §5.4: "gli alias non si risolvono"); WP3 (`countRecipesByIngredient`); WP5 passo 2 (testo della conferma).

- Con i nomi reali di P1, un 👎 su `cipolla` non tocca le ricette con `cipolla rossa`, e uno su `lenticchia` non tocca `lenticchie rosse`. Vale per la libreria (planner) e per il controllo dopo la generazione (`findConstraintViolations`): la garanzia "deterministica" di req. P16 copre solo il nome identico. Il prompt aiuta ("non usare mai: cipolla" verrà quasi sempre rispettato anche per la cipolla rossa), ma non è un controllo.
- Il conteggio d'impatto ("Escluderà N ricette") conta per lo stesso nome esatto, quindi può sottostimare.
- I test del piano passeranno comunque, perché usano nomi identici: l'accettazione risulterà soddisfatta mentre l'utente può ancora vedersi proporre "la cipolla" sotto un altro nome.
- Due cose rendono il rischio accettabile in v1: con req. U1 lo scarto si dà dal dettaglio anche nel Piano, quindi la variante si scarta con due tap quando compare; e risolvere gli alias non basterebbe (ne copre 1 su 8). La scelta però l'ha presa il planning (req. P3), non l'utente: va confermata da lui, e l'interfaccia non deve promettere più di quanto fa.
- Un dettaglio che oggi confonde: la conferma dice `Scartare {display_name}?` (`recipe-sheet.tsx:176`), per esempio "Scartare petto di pollo a cubetti?", mentre il giudizio e il conteggio riguardano `petto di pollo`.

### R2 — Una risposta tardiva può sovrascrivere un giudizio più recente a schermo · **cosmetico** (nessuna perdita di dati)

**Piano:** WP6 passo 5 (★ rapida: al successo copia `rating`, `favorite` e `blocked` da `saved`); WP7 passo 2 (`applyRecipePrefs(recipeId, saved)` sostituisce tutte le preferenze); WP5 (`onRecipePrefsChange(recipeId, prefs)` con la riga intera).

- Il server fonde bene gli aggiornamenti parziali (riga bloccata, req. P6). Ogni risposta però riporta **tutta** la riga com'era al proprio commit. Se la risposta della ★ sulla card arriva dopo quella di un voto dato dal dettaglio, riporta a schermo il voto vecchio fino al reload.
- Req. P14 disabilita i controlli dello stesso gruppo, ma ★ sulla card e barra azioni del dettaglio sono gruppi diversi; nel Piano il dettaglio si apre subito con la barra attiva (req. P13).
- Serve che la prima risposta arrivi dopo la seconda, cosa rara su una rete domestica e meno rara da telefono via Tailscale. È la stessa classe di problema che F4 ha chiuso con `withSlotFrom` (`plan-screen.tsx:102-121`), e si evita con una riga per handler.

### R3 — Da "una volta a settimana" a "a ogni tocco": la lettura completa della libreria · **da tenere d'occhio, nessuna azione prima** — amplifica P2

**Piano:** WP3 passi 1–2: `getRecipeDetail` (a ogni apertura del dettaglio, anche dal Piano), `setIngredientPref` (a ogni 👍/👎, per ricalcolare un solo conteggio), `listIngredientPrefs` (a ogni visita delle Impostazioni), `listLibraryCards` (a ogni visita della Libreria).

- Tutte chiamano `listRecipes`. Con i tempi misurati: 57 ms a 300 ricette e 158 ms a 1000, su desktop. La libreria cresce per principio (ARCHITECTURE §1.3).
- Non lo considero da correggere ora: oggi le ricette sono 18; gli aggiornamenti sono ottimistici, quindi l'attesa si vede solo nello scheletro del dettaglio in Libreria; la scelta di calcolare in memoria (req. P4) tiene una sola normalizzazione. Soprattutto, il costo è chiuso in due file (`lib/library/service.ts`, `lib/prefs/service.ts`) dietro contratti che non cambierebbero.
- Segnale per intervenire: scheletro del dettaglio percepibile sul Raspberry. Rimedio già pronto: conteggio in SQL sul solo nome richiesto (l'indice `recipe_ingredients_canonical_name_idx` esiste, `schema.ts:101`) e lettura per id con `executor`.

### R4 — "Household di default" nei test di WP4 è ambiguo · **cosmetico, ma può sporcare il DB di sviluppo**

**Piano:** WP4 passo 3 ("household di default, che ha il forno" + `upsertIngredientPref(db, householdId, 'zucchina', 'dislike')`).

- Nel file esistente tutti i test usano `createHousehold(…)`, cioè un household **dedicato** eliminato in `afterEach` (`tests/recipes/generate.test.ts:26-39`). "Di default" si può però leggere come il singleton `DEFAULT_HOUSEHOLD_ID`.
- In quel caso il test scriverebbe uno scarto su `zucchina` nell'household vero del DB di sviluppo (3 ricette del seed su 18 la contengono) senza nessuna pulizia. In CI l'esito dipenderebbe dall'ordine dei file: il singleton esiste solo se un altro test l'ha già creato, altrimenti l'inserimento viola la foreign key.

### R5 — I toast di F5 stanno sopra la sheet solo grazie all'ordine nel DOM · **cosmetico**

**File:** `components/feedback/toast.tsx:40` (`z-50`), `components/ui/sheet.tsx:132` e `:146` (`z-50`, senza portal).

- Tutte le conferme nuove ("Non la proporrò più.", "…vale dai prossimi piani.", gli errori di salvataggio) compaiono **mentre la sheet è aperta**: sono il modo in cui req. U2 viene comunicato.
- A parità di `z-index` vince chi viene dopo nel DOM. In `PlanScreen` il `Toast` è dopo la sheet (`plan-screen.tsx:624-635`), quindi si vede. WP6 li elenca nello stesso ordine, ma nulla dice che l'ordine sia necessario, e jsdom non ha layout: nessun test se ne accorgerebbe.

### R6 — Metà client di API che nessuno chiama · **cosmetico (unico eccesso del piano)**

**Piano:** WP1 passi 2 e 4–5: `buildLibraryQuery`, `fetchLibrary`, `fetchIngredientPrefs`, più i loro test (andata e ritorno della query, URL e metodo).

- La Libreria filtra in memoria (req. P8) e *I miei ingredienti* riceve i dati dalla pagina server (WP8): nessun componente chiama `GET /api/recipes` né `GET /api/ingredient-prefs`.
- Le due **rotte** restano giustificate: sono task di S2.1 e S2.3 e righe di ARCHITECTURE §6, e costano poco perché poggiano sulle stesse funzioni pure. Le tre funzioni **client** invece non hanno consumatore né requisito.

### Complessità e scorciatoie

A parte R6 non ho trovato complessità sproporzionata. Otto WP per tre story sono giustificati dai tre livelli toccati (dati, server, UI) su due pagine; `RecipeDetailSheet` unico per Piano e Libreria evita la duplicazione più costosa; `applyRecipePrefPatch` condivisa tra server e client evita che l'aggiornamento ottimistico diverga. Non ho trovato scorciatoie che creino debito: l'unica semplificazione consapevole, il confronto per nome esatto, è R1.

---

## 3. Proposte e punto di innesto

| ID | Proposta concreta | Dimensione | Dove si innesta | Quando |
|---|---|---|---|---|
| **R1** (+P1) | **Non cambiare il confronto in F5** (il contratto "F5 cabla, non modifica" resta valido). Tre correzioni: **(a)** `RecipeIngredient` riceve il campo opzionale `canonicalName?: string`, valorizzato da `toRecipeDetail` solo quando riceve `ingredientInfo` (aggiunta compatibile); il titolo della conferma diventa `Scartare ${pending.canonicalName ?? pending.name}?`, così nome e conteggio parlano dello stesso ingrediente. Test in `recipe-sheet.test.tsx`: `name: "Cipolla rossa di Tropea"`, `canonicalName: "cipolla rossa"` ⇒ "Scartare cipolla rossa?"; senza `canonicalName` il testo resta quello di oggi (`shell.test.tsx:312` invariato). **(b)** Nella frase aggiunta ad ARCHITECTURE §5.4 precisare: "Il confronto è sul nome canonico esatto: varianti come «cipolla rossa» sono ingredienti distinti e si giudicano a parte." **(c)** In "Contratti consegnati alle feature successive", riga F6: "Se F6 introduce una canonicalizzazione dei nomi (alias risolti in scrittura, o vocabolario della libreria nel prompt), il backfill riscrive insieme `recipe_ingredients.canonical_name` e `ingredient_prefs.canonical_name`; se due righe collidono sulla chiave, vince `dislike`." | Piccola | (a) **WP5** passi 1–2 e test; (b) **WP2** passo 7; (c) sezione "Contratti consegnati" del piano | **Prima** (a tocca i contratti di WP5; b e c sono testo) |
| **R2** | Regola unica: **ogni risposta applica solo i campi della propria richiesta** (più `favorite` quando la richiesta contiene `blocked`). WP5: `onRecipePrefsChange(recipeId, changed: Partial<Pick<RecipePref, 'rating' \| 'favorite' \| 'blocked'>>)`, con i valori presi da `saved`. WP6: al successo della ★ aggiornare solo `favorite`; `onRecipePrefsChange` fonde `changed` nella card. WP7: `applyRecipePrefs(recipeId, changed)` fonde in `slot.recipe.prefs ?? defaultRecipePref(recipeId)`. Un test in `plan-screen.test.tsx`: ★ in sospeso, voto dal dettaglio, poi la risposta della ★ ⇒ il voto resta. | Piccola | **WP5** passo 3 (firma e `savePrefs`); **WP6** passo 5; **WP7** passo 2 | **Prima** (cambia una firma esposta da WP5; dopo vorrebbe dire toccare tre componenti) |
| **R3** (+P2) | Nessuna modifica. Aggiungere una riga di commento in testa a `lib/library/service.ts` e `lib/prefs/service.ts`: "Legge l'intera libreria a ogni chiamata (≈ 60 ms a 300 ricette su desktop): se serve, il conteggio per un solo ingrediente si fa in SQL su `recipe_ingredients_canonical_name_idx`." | Minima | **WP3** passi 1–2 | Durante |
| **R4** | Riscrivere il passo: "household **dedicato** creato con `createHousehold()` (i valori di default comprendono il forno e nessuna dieta), eliminato in `afterEach` come gli altri test del file. Mai `DEFAULT_HOUSEHOLD_ID`." | Minima | **WP4** passo 3 | **Prima** (è solo testo del piano) |
| **R5** | `z-[60]` al posto di `z-50` nel contenitore di `Toast` (`components/feedback/toast.tsx:40`): il toast sta sopra la sheet qualunque sia l'ordine nel DOM. `tests/ui/toast.test.tsx` non controlla lo `z-index`. Aggiungere il file alla lista di WP5 (nessun altro WP lo tocca). | Minima | **WP5** (file in più) | Prima |
| **R6** | Togliere da WP1 `buildLibraryQuery`, `fetchLibrary`, `fetchIngredientPrefs` e i relativi test (compreso il test di andata e ritorno). Restano `parseLibraryQuery` (serve alla rotta), `fetchRecipeDetail`, `putRecipePref`, `putIngredientPref`. Se una delle due `GET` troverà un consumatore, il client si scrive in quel momento. | Piccola (in meno) | **WP1** passi 2, 4, 5 e 6 | Prima |
| **P3** | In `lib/http/client.ts` esportare `apiErrorMessage(err: unknown): string` (messaggio di `ApiRequestError`, altrimenti `UNKNOWN_ERROR_MESSAGE` già presente nel file) e usarla in WP5, WP6 e WP7 al posto delle tre copie. `plan-screen.tsx:76-78` e `plan-slot-card.tsx:112` si possono allineare in WP7 (`PlanRequestError` estende `ApiRequestError`). Il vocabolario della sheet: nessuna azione. | Minima | **WP1** (file in più: `lib/http/client.ts` + un test in `tests/http/client.test.ts`); uso in **WP5**, **WP6**, **WP7** | Prima |
| **—** | Allineare anche `docs/BACKLOG.md` S2.3, che dice ancora `ingredient_prefs (canonical_name PK, …)`: "chiave `(household_id, canonical_name)`". | Minima | **WP2** passo 7 | Durante |

### Domanda per l'utente (R1)

> **Chiusa il 2026-10-05: nome esatto.** V. Addendum, D1.

Per la v1 va bene che lo scarto valga **per il nome esatto dell'ingrediente** (👎 su "cipolla" non esclude "cipolla rossa", che si scarta a parte quando compare)?

- **Sì (consigliato):** si applicano le tre correzioni di R1 e la questione dei nomi si affronta in F6, dove il consolidamento della spesa ha lo stesso problema alla radice.
- **No, deve valere anche per le varianti:** serve un confronto "per parole" (`cipolla` ⊂ `cipolla rossa`) in `exclusionReason` e `findConstraintViolations`. Cambia il contratto del planner, non copre i plurali (`lenticchia` / `lenticchie rosse`) e produce falsi positivi (`latte` ⊂ `latte di cocco`, `burro` ⊂ `burro di arachidi`). Lo sconsiglio dentro F5: va ripianificato WP2.

---

## 4. Se potessi migliorare solo 3 cose prima di procedere

1. **R1 — Dire la verità sul nome.** È l'unico punto in cui l'accettazione di S2.3 può risultare verde nei test e falsa nell'uso, e le prove vengono dalle risposte reali dei modelli. Non chiede di cambiare l'algoritmo: basta una conferma coerente con ciò che viene scartato, una frase in ARCHITECTURE e una riga di contratto per F6, più la conferma dell'utente sulla semantica.
2. **R2 — Ogni risposta applica solo i propri campi.** Costa una riga per handler, ma tocca la firma di `onRecipePrefsChange` che WP5 espone a WP6 e WP7: adesso è una modifica al piano, dopo sarebbero tre componenti e i loro test.
3. **R4 + R5 — Due reti di sicurezza a costo quasi nullo.** Un household dedicato nei test di WP4 protegge il DB di sviluppo e la CI; `z-[60]` sul toast garantisce che i messaggi di req. U2 si vedano sopra la sheet, cosa che nessun test in jsdom può verificare.

R6 e P3 tolgono codice e conviene applicarli in WP1; R3 è solo un commento. Se il tempo stringe si possono saltare tutti e tre senza danni strutturali.

---

## Addendum (2026-10-05) — decisione dell'utente

Questa decisione **chiude** la "Domanda per l'utente (R1)" della §3 e rende definitiva la riga R1 della tabella. `/feature-dev 5` deve applicarla nei WP indicati.

### D1 — R1: lo scarto vale per il **nome canonico esatto**

**Decisione.** In v1 un giudizio su un ingrediente (👍 o 👎) riguarda solo le ricette che contengono **quel** `canonical_name`, confrontato dopo `normalizeCanonicalName`. Le varianti (`cipolla rossa` rispetto a `cipolla`, `lenticchie rosse` rispetto a `lenticchia`) sono ingredienti distinti e si giudicano a parte, dal dettaglio della ricetta in cui compaiono. Req. P3 passa così da decisione di planning a decisione dell'utente.

**Cosa non cambia**
- `exclusionReason` (`lib/domain/planner.ts`) e `findConstraintViolations` (`lib/recipes/constraints.ts`): nessuna modifica al confronto. Resta valido il contratto "F5 cabla, non modifica" (`execution-strategy.md` §4.3) e il criterio di WP2 "`planner.ts` differisce da `main` solo nel commento".
- Il confronto "per parole" (`cipolla` ⊂ `cipolla rossa`) è **scartato**: non va introdotto né nel planner né nel conteggio d'impatto.
- `ingredient_aliases` non si legge in F5 (req. P3).
- Il conteggio d'impatto (`countRecipesByIngredient`) resta per nome esatto: è coerente con ciò che lo scarto esclude davvero.
- I testi dei toast e di *I miei ingredienti*: usano già il nome canonico.

**Cosa si applica** (le tre correzioni di R1, ora obbligatorie)

| # | Modifica | WP |
|---|---|---|
| a | `RecipeIngredient.canonicalName?: string` (aggiunta compatibile), valorizzato da `toRecipeDetail` **solo** quando riceve `ingredientInfo`, con `normalizeCanonicalName(ing.canonical_name)`. Titolo della conferma: `Scartare ${pending.canonicalName ?? pending.name}?`. Senza `canonicalName` il testo resta quello di oggi, quindi `tests/ui/shell.test.tsx` e la pagina finta della Libreria non cambiano. Test nuovi: in `tests/ui/recipe-detail.test.ts`, con la mappa ogni ingrediente ha `canonicalName` normalizzato e senza mappa la chiave non c'è; in `tests/ui/recipe-sheet.test.tsx`, `name: "Cipolla rossa di Tropea"` + `canonicalName: "cipolla rossa"` ⇒ "Scartare cipolla rossa?". Lo scenario 9 di `recipe-detail-sheet.test.tsx` verifica il titolo con il nome canonico. | **WP5** passi 1, 2 e 4 |
| b | Nella frase aggiunta ad ARCHITECTURE §5.4, dopo "gli alias non si risolvono": "Il confronto è sul nome canonico esatto: varianti come «cipolla rossa» sono ingredienti distinti e si giudicano a parte." | **WP2** passo 7 |
| c | In "Contratti consegnati alle feature successive", riga F6: "Se F6 introduce una canonicalizzazione dei nomi (alias risolti in scrittura, o vocabolario della libreria nel prompt), il backfill riscrive insieme `recipe_ingredients.canonical_name` e `ingredient_prefs.canonical_name`; se due righe collidono sulla chiave `(household_id, canonical_name)`, vince `dislike`." | Piano, sezione "Contratti consegnati" (testo; nessun codice) |

**Accettazione di S2.3, da leggere così:** "scartato un ingrediente, nessuna ricetta che contiene **quel nome canonico** viene più proposta né generata". I test del piano (WP2 test 1–3, WP3 `planner-integration`, WP4 test 1) la verificano già in questa forma e non cambiano.

**Rinviato a F6.** La frammentazione dei nomi (P1) si affronta con il consolidamento della spesa, che ha lo stesso problema alla radice. `/feature-plan 6` deve partire dalle prove di P1 e dal contratto della riga c.

### Riepilogo dell'impatto sul piano

D1 è deciso dall'utente. Le altre righe sono le proposte della §3, invariate.

| WP | Cosa cambia rispetto a `plan.md` |
|---|---|
| WP1 | Senza `buildLibraryQuery`, `fetchLibrary`, `fetchIngredientPrefs` e relativi test (R6); `apiErrorMessage` in `lib/http/client.ts` (P3) |
| WP2 | Frase sul nome esatto in ARCHITECTURE §5.4 (**D1-b**); BACKLOG S2.3 con la chiave `(household_id, canonical_name)` |
| WP3 | Commento sul costo della lettura completa nei due servizi (R3) |
| WP4 | Household dedicato nei test, mai il singleton (R4) |
| WP5 | `canonicalName` e titolo della conferma (**D1-a**); `onRecipePrefsChange` con i soli campi cambiati (R2); `z-[60]` sul toast (R5); `apiErrorMessage` (P3) |
| WP6 | ★ e `onRecipePrefsChange` applicano solo i campi cambiati (R2); `apiErrorMessage` (P3) |
| WP7 | `applyRecipePrefs` fonde i soli campi cambiati (R2); `apiErrorMessage` (P3) |
| Piano | Riga F6 in "Contratti consegnati" (**D1-c**) |
