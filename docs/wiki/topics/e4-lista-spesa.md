---
title: E4 Lista della Spesa — Consolidamento dal Piano, Lista Persistente e Spunte Senza Rete
type: topic
created: 2026-10-09
updated: 2026-10-09
tags: [shopping-list, consolidation, aliases, check-queue, offline, api, ui, concurrency, e4, feature-6]
---

## Panoramica

L'iniziativa **E4 Lista della spesa** (Feature 6, story `S4.1`–`S4.2` del backlog) porta dal piano confermato alla spesa al supermercato. Quattro risultati:

1. **Consolidamento puro**: una funzione senza DB né rete che dagli slot del piano produce gli articoli da comprare, con quantità scalate, alias risolti, somme per nome e unità, arrotondamento e reparto ([[shopping-list]]).
2. **Lista persistente legata al piano**: creazione, aggiornamento che conserva spunte e articoli a mano, spunta, aggiunta e rimozione di articoli a mano, su cinque rotte API ([[shopping-service]], [[shopping-repo]]).
3. **Schermata Lista reale** al posto della pagina con dati finti della Feature 1: sezioni per reparto, riga intera come bersaglio, spuntati in fondo, avanzamento, pulsante *Aggiungi*, *Aggiorna lista* ([[shopping-screen]], [[shopping-item-row]]).
4. **Spunte che reggono la rete assente**: applicate subito, tenute in una coda salvata nel browser e ritentate da sole ([[check-queue]]).

La feature **non aggiunge migrazioni**: `shopping_lists` e `shopping_items` esistono dalla Feature 1 e la colonna `needs_regeneration` dalla Feature 4 ([[database-schema]]). `lib/llm/`, `lib/recipes/`, `lib/prefs/` e `lib/domain/planner.ts` non sono stati modificati; in `lib/plans/` cambia solo la sede di `isPlanClosed` ([[plan-service]]).

### Decisioni dell'utente (requirements 2026-10-08)

| ID | Decisione |
|---|---|
| U1 | **Gli alias si risolvono solo nella lista**, quando la si costruisce. Ricette, preferenze e planner continuano a confrontare il nome canonico esatto (decisione D1 della Feature 5). Il seed di `ingredient_aliases` passa da 24 a 35 voci |
| U2 | **Spunte con coda e ritentativi**: la spunta resta a schermo e non torna indietro; la coda ritenta a intervalli, al ritorno della rete e al ritorno in primo piano, ed è salvata nel browser. Avviso `N spunte in attesa di rete` |
| U3 | **La lista si rigenera solo con un pulsante** (*Aggiorna lista*), con conferma se ci sono spunte. Nessun pull-to-refresh personalizzato: resta quello del browser |
| U4 | **La tab *Lista* apre l'ultima lista**: il piano aperto più avanti nel tempo che ha già una lista; se nessuno ce l'ha, il piano confermato più avanti. Con due piani aperti (weekend) un selettore in alto passa dall'uno all'altro |

## Architettura del Flusso

```
[ / (Piano) ]                               [ /lista[?piano=<id>] ]
      │                                              │
      ▼                                              ▼
+──────────────────────────────+   +─────────────────────────────────────────+
| PlanScreen (footer)          |   | lista/page.tsx (server)                 |
|  Crea lista della spesa ─────┼──►|  getShoppingScreen({ planId })          |
|  Vai alla lista / da         |   |  <ShoppingScreen key={piano} …/>        |
|  aggiornare (link)           |   |   ├ ShoppingItemRow (riga = spunta)     |
|  rilettura dello stato lista |   |   ├ AddShoppingItemSheet (Aggiungi)     |
+──────────────────────────────+   |   └ CheckQueue ──► localStorage         |
      │                            +─────────────────────────────────────────+
      │        lib/shopping/client.ts (requestJson)  │   lib/shopping/check-queue.ts
      └───────────────────────┬──────────────────────┘
                              ▼
+──────────────────────────────────────────────────────────────────────────+
| app/api/plans/:id/shopping-list         GET  · POST (crea o aggiorna)    |
| app/api/plans/:id/shopping-list/items   POST (articolo a mano)           |
| app/api/shopping-items/:id              PATCH { checked } · DELETE       |
+──────────────────────────────────────────────────────────────────────────+
                              │ handleShoppingRouteError (ShoppingError → HTTP)
                              ▼
+──────────────────────────────────────────────────────────────────────────+
| lib/shopping/service.ts                                                  |
|  getShoppingScreen · getPlanShoppingList · buildPlanShoppingList         |
|  checkShoppingItem · addManualShoppingItem · removeManualShoppingItem    |
+──────────────────────────────────────────────────────────────────────────+
      │ puro                                   │ repository
      ▼                                        ▼
 lib/domain/shopping-list.ts              shopping-repo (liste, articoli, alias)
 lib/domain/plan-status.ts                plan-repo (getPlanById, acquirePlanLock)
                                          recipe-repo (listRecipesWith), household-repo
```

## Moduli e Componenti Introdotti

### 1. Dominio puro (`lib/domain/`)
- [[shopping-list]]: `lib/domain/shopping-list.ts` con `toAliasMap`, `resolveIngredientName`, `roundShoppingQuantity`, `buildShoppingList`, `reconcileShoppingItems`, `inferShoppingCategory`, i due ordinamenti, `groupShoppingItems`, `shoppingProgress`, `formatShoppingQuantity`, `shoppingItemLabel`, `pickDefaultShoppingPlan`.
- `lib/domain/plan-status.ts`: `isPlanClosed`, spostata qui da `lib/plans/service.ts` che ora la riesporta soltanto ([[plan-service]]).
- [[domain-types]]: blocco `Shopping List (Feature 6)` in `types.ts` con le viste di articolo, lista, piano e schermata e i DTO delle richieste.

### 2. Dati (`lib/db/`, `fixtures/`)
- [[shopping-repo]]: letture e scritture di `shopping_lists` e `shopping_items`, `listIngredientAliases`, `listRecipeRefs`, `listOpenPlans`.
- [[fixtures-and-seed]]: 11 alias in più (35 in tutto), `seedIngredientAliases` in `lib/db/seed-core.ts`, script `lib/db/seed-aliases.ts` e comando `pnpm db:seed:aliases`.

### 3. Servizio, API e trasporto (`lib/shopping/`, `app/api/`)
- [[shopping-service]]: servizio solo lato server, classe `ShoppingError` con sei codici, `handleShoppingRouteError`, le cinque rotte e il client fetch (`fetchPlanShoppingList`, `requestBuildShoppingList`, `patchShoppingItem`, `postShoppingItem`, `deleteShoppingItem`).
- [[check-queue]]: classe `CheckQueue` senza React, `classifyCheckError`, storage su `localStorage` e in memoria.

### 4. Interfaccia
- [[shopping-screen]]: pagina `/lista`, scheletro `loading.tsx`, `ShoppingScreen` e pannello `AddShoppingItemSheet`.
- [[shopping-item-row]]: quantità già formattata, seconda riga, sola lettura e pulsante di rimozione, aggiunti senza rompere l'interfaccia della Feature 1.
- [[plan-screen]]: il footer del Piano crea e apre la lista, oppure porta alla lista che c'è già.

## Regole di Dominio Principali

- **Quale piano**: la lista si crea e si aggiorna **solo per piani confermati (`active`) e non chiusi**. Una bozza risponde `409 plan_not_confirmed`; un piano chiuso `409 plan_archived` e la sua lista resta in sola lettura (requirements P3). Ogni lettura e scrittura usa un `plan_id` o un id di articolo esplicito nell'URL: la regola U4 sceglie solo quale piano mostrare aprendo la tab.
- **Quali pasti**: gli slot con `day >= oggi` (fuso `Europe/Rome`) e una ricetta assegnata (requirements P4).
- **Chiave di un articolo generato**: `(canonical_name, unit)`. Unità diverse per lo stesso nome restano su righe separate, nello stesso reparto e adiacenti.
- **Alias**: un solo passo di risoluzione (nessuna catena), sul nome normalizzato con `normalizeCanonicalName`. Si risolvono negli articoli generati e nella deduzione del reparto, non nel nome di un articolo a mano.
- **Senza quantità** (`qb`, oppure `qty` assente o ≤ 0): vale `qb`. Se lo stesso nome ha anche una riga con quantità, la riga `qb` sparisce e le sue ricette passano alla riga misurata (requirements P6).
- **Arrotondamento per eccesso**: `pz` → intero; `g` e `ml` → multiplo di 10, ma fino a 10 → intero (5 g restano 5 g); mai meno di 1 (requirements P5).
- **Reparto per nome**, a maggioranza tra gli ingredienti che lo usano; a parità vince il primo nell'ordine del giro (`CATEGORY_VALUES`, requirements P7).
- **Aggiornamento**: riconciliazione sul posto per chiave. Le righe che restano tengono il loro `id`; la spunta resta se la quantità **non aumenta** (per `qb` resta sempre); gli articoli a mano non si toccano; `needs_regeneration` torna `false` (requirements P8).
- **Articolo a mano**: solo il nome (max 80 caratteri, normalizzato). Reparto dedotto dalla libreria, altrimenti `altro`; `unit` e `qty` `null`, `recipe_ids` vuoto. Aggiungere due volte lo stesso nome restituisce l'articolo esistente. Si rimuovono solo gli articoli a mano (`409 item_not_manual` per gli altri).
- **Spunta**: `PATCH { checked }` è un valore assoluto, quindi ritentare è sicuro.
- **Ordine a schermo**: reparti nell'ordine del giro; dentro il reparto prima i non spuntati, poi gli spuntati, ciascun gruppo in ordine alfabetico italiano (requirements P19).
- **Quantità mostrate**: `300 g`, `1,25 kg` (da 1000 g), `1,5 l` (da 1000 ml), `2 pz`, `q.b.`; nome con l'iniziale maiuscola (requirements P18).

Il testo di riferimento di queste regole è `ARCHITECTURE §5.5`, aggiornato dalla feature.

### Concorrenza

| Operazione | Protezione |
|---|---|
| `buildPlanShoppingList` (crea o aggiorna) | Una transazione sotto `acquirePlanLock` dell'household, lo stesso lock di swap e rigenerazione del piano: la lista si costruisce su un piano coerente e l'azzeramento di `needs_regeneration` non incrocia uno swap |
| `addManualShoppingItem` | Ricerca e inserimento in una transazione sotto lo stesso lock: due aggiunte sovrapposte dello stesso nome danno un solo articolo |
| `checkShoppingItem`, `removeManualShoppingItem` | Singole scritture, senza lock e senza transazione |

Il lock sull'aggiunta a mano è una **deroga esplicita** al requisito P9 di `requirements.md`, che prevedeva l'aggiunta senza lock: è entrata con il commit di review `e502c9b` ed è scritta in `ARCHITECTURE §5.5` (v. [[plan-concurrency-pattern]]).

### Spunte, coda e riletture

Tre fonti possono cambiare ciò che la schermata mostra: la coda delle spunte, le risposte delle singole modifiche e le riletture dell'intera lista. Le regole, tutte in [[shopping-screen]] e [[check-queue]]:

- **La spunta si vede subito**: gli articoli a schermo sono quelli del server con sopra le spunte ancora in coda. La coda tiene solo l'ultimo stato voluto per articolo e manda una richiesta alla volta per articolo.
- **Una vista intera letta dal server non si applica se nel frattempo è stata confermata una modifica.** Il contatore `mutationSeqRef` sale a ogni modifica confermata (spunta, aggiunta, rimozione, creazione o aggiornamento della lista); una rilettura che alla risposta trova il contatore cambiato scarta ciò che ha letto e riparte. È l'innesto R3-a della review architetturale (lì `checkSeqRef`, limitato alle spunte), esteso dal commit di review `a5316c7`.
- **Quando si rilegge**: al montaggio della schermata (dopo aver svuotato la coda), al ritorno in primo piano (`visibilitychange`), al ritorno della rete (`online`), dopo uno scarto definitivo dalla coda e dopo una spunta con risposta 2xx illeggibile. La rilettura al montaggio esiste perché il tasto Indietro del browser riproponeva la schermata dalla cache del router, con spunte già confermate tornate indietro.
- **Limite di tempo**: ogni invio della coda si interrompe dopo 10 s e diventa un ritentativo (innesto R2), così una richiesta senza risposta non blocca la coda né *Aggiorna lista*.
- **Aggiorna lista** svuota prima la coda; se restano spunte in attesa non parte e lo dice (`Ci sono spunte in attesa di rete: riprova quando torna la connessione.`).

## Innesti delle Review

**Architecture review 2026-10-08** (`docs/planning/feature/feature-6/architecture-review-2026-10-08.md`; tabella degli innesti in fondo a `plan.md`):

| ID | Innesto | Dove |
|---|---|---|
| R1 | `isPlanClosed` nel file puro `lib/domain/plan-status.ts`; `lib/shopping/service.ts` lo importa dal dominio e un test di purezza verifica che non importi `@/lib/plans/service`, `@/lib/recipes`, `@/lib/llm` | [[plan-service]], [[shopping-service]] |
| R2 | Limite di tempo agli invii della coda (`CHECK_SEND_TIMEOUT_MS`, `AbortController` per tentativo, `signal` in `patchShoppingItem`) | [[check-queue]] |
| R3-a | Una rilettura non cancella una spunta confermata | [[shopping-screen]] |
| R4 | `seedIngredientAliases`, `lib/db/seed-aliases.ts`, `pnpm db:seed:aliases` | [[fixtures-and-seed]] |
| R5 | La voce `lenticchie secche → lenticchia` non è stata aggiunta: 11 voci nuove, 35 in tutto | [[fixtures-and-seed]] |
| R6 | Commento in testa a `lib/shopping/service.ts` sul costo delle letture complete | [[shopping-service]] |
| R7 | Frase in `ARCHITECTURE §5.5` sul limite del confronto tra orizzonti | "Punti aperti" qui sotto |

Non applicati perché facoltativi: **R3-b** (la ricostruzione che toglie soltanto le spunte, senza mai scriverne una) e **P4** (rimozione di `ShoppingListSchema` / `ShoppingItemSchema` della Feature 1, v. [[domain-types]]).

**Code review** (fix nei commit `e502c9b` e `a5316c7`; nella cartella della feature non c'è un file di review). Sono comportamenti che `plan.md` non descrive:
- lato server: `addManualShoppingItem` atomica sotto il lock dei piani; il test del seed degli alias fallisce se il seed tocca il repository delle ricette; i test del servizio non usano alias del seed come nomi d'ingrediente; `ARCHITECTURE §5.3` rimanda alla chiave di §5.5;
- lato interfaccia: rilettura della lista al montaggio della schermata; rilettura del solo stato della lista nel footer del Piano; rilettura dopo una spunta con risposta 2xx illeggibile; `mutationSeqRef` che copre anche aggiunte, rimozioni e ricostruzioni; nella coda, un invio riuscito fa ripartire subito le spunte ferme; il pannello di aggiunta conserva il testo digitato durante un salvataggio; l'avviso delle spunte in attesa è una live region sempre montata; il pulsante di creazione nello stato vuoto mostra l'etichetta di attesa.

## Contratti Consegnati alle Feature Successive

- **Feature 7 (deploy)**: nessuna migrazione nuova. Il deploy esegue `pnpm db:migrate` e poi `pnpm db:seed:aliases` (idempotente); **mai** `pnpm db:seed`, che inserisce anche le 18 ricette di esempio. La coda delle spunte usa `localStorage` del browser: nessuna configurazione lato server.
- **Canonicalizzazione dei nomi (futura)**: resta valido il contratto di backfill scritto in [[e2-libreria-preferenze]]. Se un giorno gli alias si risolvono in scrittura, `buildShoppingList` continua a funzionare senza modifiche: la risoluzione diventa un'operazione senza effetto.
- **v2 (uso condiviso)**: la lista è per piano, quindi già per household; `ingredient_aliases` resta globale.
- **Documenti di progetto allineati dalla feature**: `ARCHITECTURE §4.2` (`shopping_items.unit` nullable), `§5.3` (rimando alla chiave di §5.5), `§5.5` (consolidamento, creazione e aggiornamento, articoli a mano, spunte senza rete, alias) e `§6` (cinque rotte e codici `409`); `DESIGN §4.3` (lista legata al piano, selettore, `Per: …`, *Aggiorna lista* al posto del pull-to-refresh, spunte senza rete); `CLAUDE.md` (comando `db:seed:aliases`).
- **Punti aperti delle feature precedenti chiusi qui** (`requirements.md §4`):
  - `needs_regeneration` "consumato e azzerato dalla Feature 6" (P8 e P13 della Feature 4): lo azzera `markShoppingListGenerated` a ogni creazione o aggiornamento; lo mostrano l'avviso nella Lista e l'etichetta del footer del Piano;
  - "la lista si lega sempre a un `plan_id` esplicito" (Addendum D2 della review della Feature 4): rispettato da tutte le rotte;
  - lista su una bozza (m2 della code review della Feature 4): le liste nascono solo su piani confermati; `markShoppingListStale` nella rigenerazione di una bozza resta innocuo;
  - frammentazione dei nomi e backfill (P1 e riga c della review della Feature 5): nessuna canonicalizzazione in scrittura e nessun backfill (U1);
  - "gli alias servono al consolidamento della spesa" (P3 della Feature 5): `ingredient_aliases` è letta da `listIngredientAliases` di [[shopping-repo]], chiamata da `lib/shopping/service.ts`.

## Punti Aperti e Limiti Noti

- **Confronto tra orizzonti diversi** (R7, `ARCHITECTURE §5.5`): la spunta conservata confronta la quantità di prima con quella dei soli pasti che restano. Dopo un cambio a metà settimana può restare spuntato un articolo di cui serve ancora una parte.
- **Solo le spunte hanno un limite di tempo** (10 s). Aggiunta, rimozione, ricostruzione e rilettura chiamano `requestJson` senza `signal`: una richiesta che non riceve risposta resta in sospeso finché lo decide il browser.
- **La coda protegge una pagina già aperta**. Senza service worker la Lista non si carica senza rete, e se il browser scarta la scheda in background il ritorno richiede la connessione (osservazione della review architetturale; la PWA è fuori ambito per U2).
- **`pnpm db:seed:aliases` inserisce soltanto** (`onConflictDoNothing`): una voce corretta o tolta in `fixtures/ingredient-aliases.json` non raggiunge un database già popolato. Da decidere prima della Feature 7.
- **La ricostruzione fa un `UPDATE` per articolo** anche quando nulla è cambiato: `reconcileShoppingItems` mette in `toUpdate` ogni chiave che resta.
- **Finestra residua lato server** (R3, parte server, cosmetica per la review): la ricostruzione legge gli articoli e poi riscrive `checked` per ognuno; una spunta salvata tra i due passi viene sovrascritta. R3-b, che la chiudeva, non è stato applicato.
- **Letture complete** (R6): ogni articolo a mano legge l'intera libreria per dedurre il reparto, e ogni lettura della lista carica il piano con le ricette complete. Il rimedio è annotato in testa a `lib/shopping/service.ts`; sul Raspberry non è stato misurato.
- **Footer del Piano e tasto Indietro**: la rilettura dello stato della lista al montaggio è coperta dai test (`tests/ui/plan-screen.test.tsx`) ma, a differenza del difetto sulla Lista, la variante sul footer non è stata riprodotta in un browser.
- **Unità eterogenee** per lo stesso ingrediente (es. `pz` e `g`) restano su due righe: caso limite accettato in v1 (`ARCHITECTURE §5.5`).
- **Da verificare dal telefono a fine v1** (`requirements.md §5`, non verificabile in jsdom): spunte in modalità aereo e loro invio al ritorno della rete; stato al ritorno dal background; pulsante *Aggiungi* raggiungibile col pollice e non coperto dal toast; tastiera che non copre il campo del pannello di aggiunta; rimozione a un tap degli articoli a mano.
- Fuori ambito per decisione: *Azzera spunte* della pagina finta della Feature 1 (requirements P22), modifica del nome di un articolo a mano (si rimuove e si riaggiunge, P12), aggiunta e rimozione nella coda offline (P12).

## Strategia di Test

I file di test passano da 68 a **80**. Nuovi file:
- dominio puro: `tests/domain/{shopping-list,shopping-contracts}.test.ts` (compresi i test di purezza degli import di `shopping-list.ts` e `plan-status.ts` e il consolidamento sulle fixture);
- DB reale: `tests/db/shopping-repo.test.ts`, `tests/shopping/service.test.ts` (household dedicati, `now` fisso, alias inseriti dal test con nomi unici; nessuna chiamata di rete);
- rotte con servizio mockato: `tests/api/{shopping-list,shopping-items}.test.ts`;
- client e coda: `tests/shopping/{client,check-queue}.test.ts` (timer finti);
- pagina server: `tests/app/shopping-page.test.tsx`;
- UI (jsdom): `tests/ui/{shopping-screen,shopping-item-row,add-item-sheet}.test.tsx`.

Adeguati: `tests/db/seed.test.ts` (`seedIngredientAliases` idempotente e senza ricette), `tests/fixtures-data/recipes-fixtures.test.ts` (35 alias, normalizzati e senza catene), `tests/ui/plan-screen.test.tsx` (footer), `tests/ui/shell.test.tsx` (rende `ShoppingScreen` con un fixture al posto della pagina finta).

Le accettazioni del backlog sono coperte così: `buildShoppingList` pura e verde sulle fixture, con somma tra ricette, `qb`, unità eterogenee su righe separate, `recipe_ids` e alias (`tests/domain/shopping-list.test.ts`); aggiornamento che conserva spunte e articoli a mano e azzera `needs_regeneration`, due costruzioni concorrenti senza doppioni, due aggiunte a mano sovrapposte con un solo articolo (`tests/shopping/service.test.ts`); spunta immediata, coda, avviso e riletture (`tests/ui/shopping-screen.test.tsx`, `tests/shopping/check-queue.test.ts`). L'uso reale al supermercato resta alla verifica dal telefono.

## Vedi anche

- [[shopping-list]] — Regole pure di consolidamento, riconciliazione, reparto e formattazione
- [[shopping-service]] — Servizio, errori, API e client della lista
- [[shopping-repo]] — Repository di liste, articoli e alias
- [[check-queue]] — Coda delle spunte con ritentativi
- [[shopping-screen]] — Pagina e schermata Lista, pannello di aggiunta
- [[shopping-item-row]] — Riga dell'articolo
- [[plan-screen]] — Footer del Piano che crea e apre la lista
- [[plan-concurrency-pattern]] — Uso del lock dei piani nella costruzione della lista
- [[fixtures-and-seed]] — Alias e comando `pnpm db:seed:aliases`
- [[e3-pianificatore]] — Feature 4: piano, conferma e flag `needs_regeneration`
- [[e2-libreria-preferenze]] — Feature 5: nome canonico esatto e contratto di backfill
