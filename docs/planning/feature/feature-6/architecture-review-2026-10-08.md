# Architecture review — Feature 6 (E4 Lista della spesa)

**Data:** 2026-10-08 · **Piano esaminato:** [`plan.md`](plan.md) (+ [`requirements.md`](requirements.md)) · **Contesto:** as-built di F1–F5 (`main`, commit `4bd46fa`, v0.4.0), `docs/ARCHITECTURE.md` (§3, §5.3, §5.5, §6), `docs/DESIGN.md` (§1, §4.3, §6), `docs/BACKLOG.md` (S4.1–S4.2), `docs/planning/execution-strategy.md` (§3 Feature 6–7, §4), spec di F7, review di F4 e F5, wiki `plan-concurrency-pattern`.

**Esito in una riga:** nessun punto bloccante. Il piano poggia sul codice reale (tutte le ipotesi della §0.2 controllate sotto) e si può implementare così com'è. Quattro correzioni piccole conviene innestarle prima (R1–R4), perché toccano contratti tra work package o tra F6 e F7; le altre sono testo o facoltative.

> **Nota sugli ID.** `P1…P4` e `R1…R7` sono gli ID di questa review. Le decisioni di `requirements.md` (che usa anch'esso `P1…P24` e `U1…U4`) sono sempre citate come «req. P*n*» / «req. U*n*».

## Metodo e prove raccolte

- **Gate completo sul codice attuale** (Postgres di sviluppo sulla 5432, `pnpm db:migrate` applicato): `lint` ✅, `typecheck` ✅, `test` ✅ **835/835** in 68 file (114 s, test DB compresi), `build` ✅ (Next 15.5.25, Vitest 4.1.11, jsdom 26.1.0). A fine review ho fermato di nuovo il container `mealy-postgres-dev`, che avevo trovato spento.
- **Porta del DB.** Anche oggi la 5432 era libera (`smart-portfolio-db` spento). La regola 0.3.8 del piano la dà per occupata: vale solo quando quel container è acceso, quindi conviene guardare `docker ps` prima di usare l'override sulla 5433.
- **Ipotesi della §0.2 verificate sul codice.**
  - *Schema, nessuna migrazione necessaria:* `shopping_lists` ha `plan_id` unico con cascade e `needs_regeneration` (`lib/db/schema.ts:201-209`); `shopping_items` ha `unit` nullable, `qty` numeric, `manual`, `recipe_ids uuid[]` (`:222-240`); `ingredient_aliases` è `alias` PK + `canonical_name` (`:252-255`).
  - *Repository dei piani:* `getPlanById`, `acquirePlanLock`, `markShoppingListStale`, `insertPlan`, `insertSlots`, `activateDraftPlan`, `updateSlotRecipe`, `updateSlotsServings` esistono con le firme usate dal piano; `PlanSlotRecord.day` è `YYYY-MM-DD`, quindi `slot.day >= today` è un confronto valido; ogni slot porta la ricetta completa di ingredienti.
  - *Lista "da aggiornare":* `markShoppingListStale` è chiamata dentro il lock da rigenerazione e *Ripeti* (`lib/plans/service.ts:476`) e dallo swap (`:698`); lo swap è ammesso sui piani confermati (`:695`), mentre la rigenerazione di un piano confermato è rifiutata (`:150`). Quindi una lista (che nasce solo su piani confermati, req. P3) diventa "da aggiornare" solo per uno swap: il percorso previsto dal piano è reale.
  - *Trasporto:* `readJsonBody`, `errorResponse`, `invalidRequestResponse`, `internalErrorResponse` (`lib/http/responses.ts`); `requestJson` passa `init` a `fetch` e trasforma ogni rigetto in `ApiRequestError(0, 'network_error')` (`lib/http/client.ts:46-51`); `PlanRequestError` estende `ApiRequestError`, quindi `apiErrorMessage` funziona nei test di WP7.
  - *UI:* `Toast` accetta `className` ed è a `z-[60]` (`components/feedback/toast.tsx:11`, `:40`); `SheetContent` ha il pulsante `Chiudi` e chiude con Esc (`components/ui/sheet.tsx:104-118`, `:152-160`); `EmptyState` e le varianti `outline` / `ghost` / `sm` di `Button` esistono; in `PlanScreen` esistono `withPlan` (`:91-102`), `navigate` (`:233-238`), `mountedRef` (`:206`) e il footer da modificare (`:637-660`).
  - *Test citati:* `tests/ui/shell.test.tsx:19` importa la pagina finta e il blocco "ShoppingItemRow" (`:328-361`) cerca l'elemento per ruolo `checkbox` e ne controlla la classe `min-h-[52px]`: resta verde con il contenitore in più di WP5. Le tre asserzioni che WP7 riscrive sono a `tests/ui/plan-screen.test.tsx:456`, `:467`, `:549`. `expect(aliasNames.size).toBe(24)` è a `tests/fixtures-data/recipes-fixtures.test.ts:166`. `tests/db/seed.test.ts:44-50` controlla ogni alias del file: resta verde con 36 voci senza modifiche, come dice il piano.
- **Conti dei test del piano rifatti.** WP3 scenario 1: 200 g × 4/2 + 150 g × 4/2 = **700 g**, cipolla 1 × 2 = **2 pz** ✅. Scenario 6: 400 + 800 = **1200 g** > 700, quindi la spunta cade ✅. Scenario 7: uno slot a 2 porzioni ⇒ 500 g (slot di A) o 550 g (slot di B) < 700, la spunta resta ✅. Tabella degli arrotondamenti di WP1 ✅ (`10,4 ml` ⇒ 20; `66,6667 g` ⇒ 70). Il 2026-09-28 è un lunedì; `WED`, `SAT`, `MON2` cadono nei giorni attesi anche in `Europe/Rome` ✅.
- **Nomi reali, con uno script di sola lettura** sulle 18 ricette di `fixtures/recipes.json` (53 nomi distinti) e sulle 4 risposte LLM in `tests/fixtures/llm/recorded/` (53 nomi distinti):
  - nessuno dei 12 alias nuovi di WP2 è il nome canonico di una fixture, nessuno è già presente, nessuno forma una catena: il test esistente "no canonical_name is an alias" e il test 13 di WP1 reggono sia con 24 sia con 36 voci, quindi il gate resta verde anche se WP1 e WP2 finiscono in ordine diverso;
  - con le 36 voci, delle varianti segnalate dalla review di F5 (P1) si fondono: olio (`olio di oliva`, `olio extravergine d'oliva`), `ceci` / `ceci cotti`, `couscous`, `paprika`, `pasta`, `pepe`. Restano distinte per scelta `cipolla rossa`, `lenticchie rosse`, `paprika affumicata`, `pasta corta`;
  - il caso più frequente nei dati reali non sono i sinonimi ma le **unità diverse per lo stesso nome**: `carota` (2 pz, 60 g, 1 pz), `cipolla` (60 g, 0,5 pz, 0,5 pz), `zucchina` (pz e g), `peperone` (1 pz, 150 g), `zenzero fresco` (5 g, 1 pz). Le regole del piano (stesso reparto per nome, righe adiacenti, req. P7) sono quelle giuste per questi dati;
  - lo stesso nome arriva con reparti diversi (`salsa di soia`: `altro` nelle fixture, `dispensa` nelle 4 occorrenze delle risposte registrate): il reparto a maggioranza (req. P7) è giustificato dai dati;
  - un alias del piano è contraddetto dai dati: vedi **R5**.
- **Non misurato:** il comportamento di una richiesta senza risposta su rete mobile attraverso Tailscale (R2) e i tempi sul Raspberry (R6). Le conclusioni su questi due punti vengono dalla lettura del codice, non da una prova.

---

## 1. Problemi attuali (ordinati per impatto)

### P1 — Le regole pure dei piani stanno dentro un modulo che importa la generazione · **da tenere d'occhio**

**File:** `lib/plans/service.ts:91-96` (`isPlanClosed`, nella sezione "Helper puri"), `:54-60` (import di `@/lib/llm/errors`, `@/lib/prefs/ingredient-prefs`, `@/lib/recipes`); `lib/recipes/generate.ts:18` (`@/lib/llm`); `lib/llm/adapter.ts:1-8` (`ai`), `lib/llm/model.ts:1-5` (quattro SDK dei provider).

- `isPlanClosed` è una funzione pura di una riga, ma si può importare solo insieme al servizio dei piani, che porta con sé `recipes` → `llm` → SDK.
- Finora non contava: nessun servizio ne importava un altro. `lib/prefs/service.ts`, `lib/library/service.ts` e `lib/settings/service.ts` importano solo repository e `lib/domain/*`.
- Perché è un problema: la regola 1 di ARCHITECTURE §3 ("`shopping-list` è funzioni pure + repository, solo `recipes` parla con l'adapter") resta vera riga per riga ma smette di esserlo nel grafo dei moduli appena qualcuno ha bisogno della regola "piano chiuso".

### P2 — Il client HTTP non ha un limite di tempo · **da tenere d'occhio**

**File:** `lib/http/client.ts:46-51` (`fetch` senza `signal`). Nel codice lato client non c'è nessun `AbortSignal` (l'unico uso è `lib/llm/adapter.ts:30`, lato server).

- Una richiesta che non riceve risposta resta in sospeso finché lo decide il browser.
- Finora è accettabile: ogni chiamata ha un indicatore di attesa, la generazione dura minuti per natura e ha già un recupero dedicato (`recoverTargetScreen`, `components/plan/plan-screen.tsx:328-362`).
- Diventa un problema quando sopra si costruisce una logica di ritentativi che conta sul fatto che ogni invio prima o poi finisca.

### P3 — Gli alias hanno un solo canale di consegna, legato ai dati di esempio · **da tenere d'occhio**

**File:** `lib/db/seed-core.ts:14-73` (household di default, 18 ricette delle fixture e alias nella stessa funzione), `package.json` (`db:seed`), `docs/planning/feature/feature-7/spec.md` (FR-2, FR-5 e §4.2 punto 4 parlano solo di migrazioni; la parola "seed" non compare).

- `ingredient_aliases` si riempie solo con `pnpm db:seed`, che inserisce anche le 18 ricette di esempio nell'household di default.
- Oggi nessun codice legge la tabella, quindi il limite non si vede.

### P4 — Schemi entità di F1 superati e nomi uguali per cose diverse · **cosmetico**

**File:** `lib/domain/types.ts:217-235` (`ShoppingListSchema` senza `needs_regeneration`; `ShoppingItemSchema` con `unit: string`), usati solo da `tests/db/schema.test.ts:35-36`, `:214`, `:227`; `components/shopping/shopping-item-row.tsx:7-14` (un altro tipo `ShoppingItem`, locale).

- Dopo F6 l'articolo della lista avrà quattro definizioni: `ShoppingItem` (F1, in `types.ts`), `ShoppingItemRecord` (repository), `ShoppingItemView` (`types.ts`), `ShoppingItem` (componente). È lo stesso schema a tre livelli già usato per i piani, quindi è coerente; restano però nella "single source of truth" due schemi che non descrivono più il DB.

### Aree senza problemi da segnalare

- **Schema del DB.** Le tabelle di F1/F4 bastano: "nessuna migrazione" (req. P2) è corretto.
- **Lock e segnalazione della lista.** Vedi le prove sopra: `needs_regeneration` viene acceso solo dentro il lock dei piani, e la costruzione della lista sotto lo stesso lock (req. P9) non può incrociarlo.
- **Errori e rotte.** `ShoppingError` ricalca `PlanError`; i due `handle…RouteError` restano due funzioni di otto righe, ma sono diversi di proposito (quello dei piani traduce anche gli errori LLM, `lib/plans/http.ts:16`): non serve unificarli.
- **Funzioni di dominio riusate.** `normalizeCanonicalName`, `todayInTimeZone`, `mondayOf`, `addDays`, `formatWeekRange`, `CATEGORY_VALUES` nell'ordine del giro: tutte esistono e sono pure.
- **Helper di test.** `createTestHousehold`, `insertTestRecipe` (`servings_base` 2, ingrediente di default `sale` q.b.) corrispondono a come li usa il piano.
- **File disgiunti per wave.** Ho ricontrollato le liste dei 7 WP: nessuna sovrapposizione dentro una wave. Le correzioni proposte sotto non la rompono (ogni file in più è toccato da un solo WP della sua wave).
- **Debito a vista.** Nessun `TODO` / `FIXME` in `lib/`, `components/`, `app/`.

---

## 2. Rischi introdotti o amplificati dalla feature

### R1 — Il servizio della lista importerebbe tutta la generazione · **da tenere d'occhio** — amplifica P1

**Piano:** WP3, helper `readPlanView` passo 1 ("import da `@/lib/plans/service`"); tabella "Riuso obbligatorio" (riga `isPlanClosed`); regola 0.3.3; criterio di accettazione di WP3 "`lib/shopping/service.ts` non importa da `lib/llm/` né da `lib/recipes/`".

- Il criterio sarebbe vero alla lettera e falso nei fatti: `shopping/service` → `plans/service` → `recipes` → `llm` → `ai` e i quattro SDK. Vale per le cinque rotte nuove e per la pagina Lista.
- Sarebbe il primo import da un servizio a un altro: un precedente che F7 e la v2 troverebbero già fatto.
- Non è un errore a runtime: il costo è il caricamento di moduli inutili e una regola di architettura che non regge più a un controllo automatico.

### R2 — Una spunta che non riceve risposta blocca la coda · **da tenere d'occhio (è lo scenario per cui req. U2 esiste)** — amplifica P2

**Piano:** WP4 passo 2 (`CheckQueue`: `pump`, `sendLatest`, `flush`); WP6 (`runBuild`, effetto di ritorno).

- `stalled` diventa `true` solo quando un invio **fallisce**. Se la richiesta resta in sospeso, l'avviso "N spunte in attesa di rete" non compare.
- Finché quell'invio è in corso, `pump` restituisce la promessa esistente: al ritorno della rete (`online`) e al ritorno in primo piano `flush()` non rimanda nulla per quell'articolo e resta in attesa.
- `runBuild` fa `await flush()` con `isBuilding = true`: *Aggiorna lista* resta disabilitato per tutto quel tempo.
- Lo scenario è plausibile proprio al supermercato: pagina aperta a casa in Wi-Fi, poi usata in 4G attraverso Tailscale, con la prima richiesta che parte su una connessione ormai morta. Quanto duri l'attesa dipende dal browser: non l'ho misurato.
- I test del piano passano comunque, perché l'invio finto si risolve o rigetta sempre.

### R3 — Una rilettura partita prima può cancellare una spunta appena confermata · **da tenere d'occhio** (lato client) / **cosmetico** (lato server)

**Piano:** WP6 (`refresh`, `runBuild`: `setView(fresh)` con l'intera vista); WP3 `buildPlanShoppingList` passi 8 e 11; req. P9 (le spunte sono scritture senza lock) e req. U2 ("la spunta non torna mai indietro").

- **Client.** Al ritorno in primo piano parte `refresh()`. Se l'utente tocca una riga mentre la lettura è in viaggio e la conferma della spunta arriva per prima, la riga esce dalla coda; poi arriva la lettura, fatta dal server prima della spunta, e `setView(fresh)` la rimette non spuntata fino alla rilettura successiva. Sul server la spunta c'è: a schermo no. Lo stesso vale per la risposta di *Aggiorna lista*.
- È la stessa classe di problema che F4 ha chiuso con `withSlotFrom` (`plan-screen.tsx:104-123`) e F5 con R2 della sua review. Qui la finestra è più larga: la lettura porta tutta la lista, la spunta poche decine di byte.
- **Server.** La ricostruzione legge gli articoli (passo 8) e poi riscrive `checked` per ognuno (passo 11). Una spunta salvata tra i due passi viene sovrascritta con il valore letto prima. La finestra è di pochi millisecondi: improbabile con un solo utente, ma si evita con una riga.

### R4 — In produzione gli alias non ci saranno · **da tenere d'occhio** — amplifica P3

**Piano:** req. U1; WP2 "Nota operativa"; "Contratti consegnati alle feature successive", riga F7 ("`pnpm db:seed` va eseguito").

- Lo spec di F7 esegue solo le migrazioni. Senza il seed `listIngredientAliases` restituisce un elenco vuoto e la lista funziona senza fondere nulla: `olio extravergine d'oliva` e `olio extravergine di oliva` su due righe (il secondo è in 18 fixture su 18, il primo in 8 ingredienti delle risposte registrate).
- Il difetto sarebbe silenzioso: tutti i test restano verdi, perché inseriscono alias propri (req. P24).
- Eseguire `db:seed` in produzione, come dice la riga F7, metterebbe 18 ricette di esempio nella libreria vera.

### R5 — Un alias del piano unisce due prodotti diversi · **cosmetico**

**Piano:** WP2 passo 2, voce `lenticchie secche → lenticchia`.

- Nelle risposte registrate `lenticchie secche` è "lenticchie rosse", 150 g a secco; `lenticchia` è "lenticchie cotte", 250 g. Fuse darebbero "Lenticchia 400 g", che non corrisponde a nessun acquisto.
- Lo stesso piano tiene distinta `lenticchie rosse`, che nei dati è lo stesso prodotto di `lenticchie secche`.

### R6 — Un'altra lettura completa di libreria e piano · **da tenere d'occhio, nessuna azione** — amplifica P2/R3 della review di F5

**Piano:** WP3: `addManualShoppingItem` passo 5 (`listRecipes` dell'household); `getPlanShoppingList` → `loadOwnedPlan` → `getPlanById`.

- Ogni articolo aggiunto a mano legge tutta la libreria per dedurre un reparto. Con i tempi misurati nella review di F5 (desktop): 31 ms a 100 ricette, 57 ms a 300, 158 ms a 1000.
- Ogni lettura della lista carica il piano con le ricette complete (ingredienti e preferenze validati) per usarne quattro campi; `getShoppingScreen` lo fa due volte, `buildPlanShoppingList` due. Con al più 14 ricette il costo è piccolo; non l'ho misurato.
- Non lo considero da correggere ora: le aggiunte a mano sono poche per spesa, il pannello mostra l'attesa, e il costo è chiuso in `lib/shopping/service.ts` dietro contratti che non cambierebbero.

### R7 — La spunta conservata confronta due orizzonti diversi · **cosmetico (limite da scrivere)**

**Piano:** req. P4 (la lista copre i pasti da oggi in poi) insieme a req. P8 (la spunta resta se la quantità non aumenta).

- La quantità "di prima" copre i pasti dal giorno della costruzione precedente; quella "di adesso" solo i pasti che restano. Esempio: 3 cipolle comprate lunedì (lunedì, giovedì, sabato), una usata lunedì; mercoledì si cambia il pasto di giovedì con uno che ne chiede 2. Servono 3 cipolle, in casa ce ne sono 2, ma 3 ≤ 3 e la riga resta spuntata.
- Per essere esatti servirebbe ricordare il contributo di ogni pasto: sproporzionato per la v1. Basta che il limite sia scritto.

### Complessità e scorciatoie

Non ho trovato complessità sproporzionata. La `CheckQueue` è giustificata da una decisione dell'utente (req. U2) ed è separata da React, quindi si prova con timer finti; sette WP per due story coprono tre livelli (dati, server, UI) più la coda. L'unico doppione è l'ordinamento: il server ordina gli articoli per reparto (`readPlanView`) e il client li riordina in `groupShoppingItems`. Costa dieci righe e dà una risposta API stabile: nessuna azione.

Una scorciatoia consapevole va detta com'è: la coda protegge una pagina **già aperta**. Senza service worker la Lista non si carica senza rete, e se il browser scarta la scheda in background il ritorno richiede la connessione. Req. U2 lo ha escluso di proposito (la PWA è una feature a parte) e `requirements.md §5` lo mette tra le prove da telefono: l'accettazione di S4.2 dipende da quella prova, non dai test.

---

## 3. Proposte e punto di innesto

| ID | Proposta concreta | Dimensione | Dove si innesta | Quando |
|---|---|---|---|---|
| **R1** (+P1) | Spostare `isPlanClosed` in un file puro nuovo, `lib/domain/plan-status.ts` (importa solo il tipo `PlanStatus`). In `lib/plans/service.ts` il corpo sparisce e restano `import { isPlanClosed } from '@/lib/domain/plan-status'` ed `export { isPlanClosed }`: `tests/plans/service.test.ts:23` non cambia. `lib/shopping/service.ts` lo importa dal dominio. In `tests/shopping/service.test.ts` un test di purezza come quello di WP1: nessuna riga `import` di `lib/shopping/service.ts` punta a `@/lib/plans/service`, `@/lib/recipes` o `@/lib/llm`. Aggiornare la riga di "Riuso obbligatorio" e, nel "Fuori ambito" di WP3, precisare che l'unica modifica a `lib/plans/` è questa, fatta da WP1. | Piccola | **WP1** (file nuovo e `lib/plans/service.ts`; i test esistenti di `isPlanClosed` restano dove sono); **WP3** (import e test di purezza) | **Prima** (WP3 nasce già con l'import giusto) |
| **R2** (+P2) | Dare un limite di tempo a ogni invio della coda. In `check-queue.ts`: `export const CHECK_SEND_TIMEOUT_MS = 10_000`; `send: (itemId, checked, signal: AbortSignal) => Promise<void>`; in `sendLatest` un `AbortController` per tentativo, con `setTimeout(() => controller.abort(), CHECK_SEND_TIMEOUT_MS)` annullato nel `finally`; `dispose()` interrompe anche gli invii in corso. In `client.ts`: `patchShoppingItem(itemId, checked, signal?)` passa `signal` a `requestJson`, che trasforma l'interruzione in `network_error` (`lib/http/client.ts:46-51`) e quindi in un ritentativo. Test 14 in `check-queue.test.ts`: un `send` che rigetta solo all'interruzione ⇒ dopo 10 000 ms `stalled` è `true` e il ritentativo parte dopo altri 2000 ms. In WP6 l'effetto della coda passa il `signal` a `patchShoppingItem`. | Piccola | **WP4** passi 1–3; **WP6** (effetto della coda) | **Prima** (cambia la firma di `send`, contratto tra WP4 e WP6) |
| **R3-a** | Regola unica lato client: **una vista intera letta dal server non si applica se nel frattempo è stata confermata una spunta**. `checkSeqRef` (numero) incrementato in `send` appena `patchShoppingItem` si risolve; `refresh()` e `runBuild()` ne leggono il valore prima della richiesta e, se alla risposta è cambiato, scartano la vista (dopo *Aggiorna lista*: la applicano) e richiamano `refresh()`. Test 23 in `shopping-screen.test.tsx`: lettura in sospeso dopo `online`, tocco su `Cipolla` confermato subito, poi la lettura si risolve con `Cipolla` non spuntata ⇒ la riga resta spuntata e `fetchPlanShoppingList` viene chiamata una seconda volta. | Piccola | **WP6** passo 3 (`refresh`, `runBuild`, effetto della coda) e passo 5 | Durante |
| **R3-b** | La ricostruzione non scrive mai una spunta, la toglie soltanto. `reconcileShoppingItems` restituisce `toUpdate: { id, item, uncheck }` con `uncheck = built.qty !== null && (trovato.qty === null \|\| built.qty > trovato.qty)`; `GeneratedItemUpdate` diventa `{ qty, category, recipe_ids, uncheck }` e `updateGeneratedShoppingItem` aggiunge `checked: false` al `set` solo se `uncheck`. I test di WP1 (spunta conservata / tolta), il test 4 di WP2 e il passo 11 di WP3 si adeguano; gli scenari 6 e 7 di WP3 restano identici. | Piccola | **WP1** passo 2 (`ShoppingListChanges`, regola e test); **WP2** passo 1; **WP3** passo 11 | Prima (cambia un contratto tra WP1, WP2 e WP3). Facoltativa: se si salta, nessun danno strutturale |
| **R4** (+P3) | Separare gli alias dal seed di sviluppo. In `lib/db/seed-core.ts` esportare `seedIngredientAliases(executor: DbExecutor = db): Promise<number>` (lo stesso `insert … onConflictDoNothing` di oggi) e farla chiamare da `seedDatabase`; nuovo `lib/db/seed-aliases.ts` sul modello di `lib/db/seed.ts` e script `"db:seed:aliases": "tsx lib/db/seed-aliases.ts"`; una riga nei comandi di `CLAUDE.md`. Un test in `tests/db/seed.test.ts`: la funzione è idempotente e non inserisce ricette. Riscrivere la "Nota operativa" di WP2 e la riga F7 dei "Contratti consegnati": "il deploy esegue `pnpm db:migrate` e poi `pnpm db:seed:aliases`; mai `pnpm db:seed`, che inserisce anche le 18 ricette di esempio". `/feature-plan 7` deve mettere quel passo nello script di deploy. | Piccola | **WP2** (file in più: `lib/db/seed-core.ts`, `lib/db/seed-aliases.ts`, `package.json`, `tests/db/seed.test.ts`, `CLAUDE.md`); sezione "Contratti consegnati" del piano | **Prima** (è il contratto che F7 leggerà) |
| **R5** | Togliere la voce `lenticchie secche → lenticchia`: restano 11 voci nuove, 35 in tutto, e il test passa a `toBe(35)`. `lenticchie → lenticchia` (solo plurale) resta. | Minima | **WP2** passi 2 e 3, criteri di accettazione | Prima (è testo del piano) |
| **R6** | Nessuna modifica. Una riga di commento in testa a `lib/shopping/service.ts`, come in F5: "`addManualShoppingItem` legge l'intera libreria e ogni lettura della lista carica il piano con le ricette complete: se sul Raspberry si sente, il reparto si conta in SQL su `recipe_ingredients_canonical_name_idx` e l'intestazione del piano si legge senza slot." | Minima | **WP3** passo 3 | Durante |
| **R7** | Una frase nel testo di ARCHITECTURE §5.5, in coda a "Creazione e aggiornamento": "Il confronto è tra la quantità di prima e quella dei soli pasti che restano: dopo un cambio a metà settimana può restare spuntato un articolo di cui serve ancora una parte." | Minima | **WP3** passo 5 | Durante |
| **P4** | Togliere `ShoppingListSchema` / `ShoppingItemSchema` e i relativi tipi da `types.ts`, con le quattro righe che li usano in `tests/db/schema.test.ts`: `ShoppingItemView` e i tipi del repository li sostituiscono, e sparisce l'omonimia con il tipo del componente. Corregge la frase "non si toccano" della §0.2 e del "Fuori ambito" di WP1. | Minima | **WP1** passo 1 (file in più: `tests/db/schema.test.ts`) | Durante. Facoltativa |
| **—** | Nel preambolo dei test di WP3: "i nomi d'ingrediente dei test non devono essere alias del seed (`ingredient_aliases` è globale e `tests/db/seed.test.ts` la riempie nella stessa esecuzione)". I nomi scelti dal piano (`petto di pollo`, `sale`, `cipolla`, `zucca`, `latte`, `latte intero`) rispettano già la regola: serve a chi aggiunge casi. | Minima | **WP3** passo 6 | Durante |
| **—** | Nell'ultimo punto del nuovo DESIGN §4.3 precisare: "Senza rete, **a pagina già aperta**, le spunte restano a schermo…". | Minima | **WP6** passo 4 | Durante |
| **—** | Regola 0.3.8: "controllare `docker ps`: l'override sulla 5433 serve solo se `smart-portfolio-db` è acceso". | Minima | §0.3 del piano | Prima (è testo) |

---

## 4. Se potessi migliorare solo 3 cose prima di procedere

1. **R2 — Un limite di tempo agli invii della coda.** La coda esiste per la rete del supermercato, e il suo unico punto cieco è proprio la richiesta che non torna: niente avviso, niente ritentativo, *Aggiorna lista* bloccato. Nessun test in jsdom lo mostrerebbe. Costa una costante e un `AbortController`, ma cambia la firma di `send` che WP4 consegna a WP6: adesso è una riga del piano, dopo sono due moduli e i loro test.
2. **R4 — Far arrivare gli alias in produzione.** È il meccanismo scelto dall'utente (req. U1) per chiudere la frammentazione dei nomi rinviata da F5. Senza un comando separato dal seed di sviluppo, sul Raspberry la tabella resta vuota e nessun test se ne accorge; l'alternativa scritta oggi nel piano porterebbe le ricette di esempio nella libreria vera. Va deciso prima di `/feature-plan 7`.
3. **R3-a — Una rilettura non cancella una spunta confermata.** È l'unico modo rimasto in cui una spunta può "tornare indietro", cioè quello che req. U2 promette di evitare, e capita nel momento più frequente d'uso: telefono tirato fuori dalla tasca e tocco immediato. Un contatore e un test.

**R1** viene subito dopo e conviene farla comunque: è un file di dieci righe in WP1, e tiene vera la regola "la lista non conosce l'LLM" senza dover rimettere mano a WP3. R5 è una riga di dati. R3-b, R6, R7 e P4 si possono saltare senza danni strutturali.
