# Feature 4 — E3 Pianificatore: Requisiti e Decisioni

Memoria del "perché" dietro `plan.md`. Story: `docs/BACKLOG.md` S3.1–S3.4. Riferimenti: `docs/ARCHITECTURE.md §4.2, §5.2, §5.3, §6`, `docs/DESIGN.md §3, §4.1, §5, §6`, `docs/planning/execution-strategy.md §3 Feature 4 e §4`, review di F2 (`feature-2/architecture-review-2026-09-17.md`, R2) e di F3 (`feature-3/architecture-review-2026-09-28.md`, R1, R2, Q1).

## 1. Layout e identità
- **Layout**: `docs/planning/` (da `.claude/agentic-feature-factory.local.md`), cartella `docs/planning/feature/feature-4/`.
- **Titolo**: Feature 4 — E3 Pianificatore (selezione pesata, piano, swap, UI).
- **Prerequisiti**: Feature 1, 2 e 3 implementate (commit `bb5f247`, `aa5fa10`, `5e2110b`, `b0a4aad`). Vale "il codice reale vince".

## 2. Decisioni prese con l'utente (2026-09-28)
| # | Decisione | Motivo |
|---|---|---|
| U1 | **Settimana "lun–dom smart"**: da lunedì a venerdì *Genera piano* lavora sulla settimana corrente, **solo dai giorni da oggi in poi**; sabato e domenica lavora sulla **settimana successiva completa**. Il Piano mostra la settimana corrente finché la successiva non esiste | Niente slot inutili sui giorni passati; il weekend è il momento naturale per pianificare la settimana dopo |
| U2 | **Generazione sincrona, al massimo 2 giri**: `POST /api/plans` fa tutto in una richiesta; se il pool è scarso genera **in parallelo** per pranzo e cena, riprova la selezione, al massimo 2 giri. Se l'LLM fallisce ma la libreria riempie comunque tutti gli slot, il piano si crea lo stesso | Un solo flusso, una sola richiesta; la UI mostra skeleton + microcopy (DESIGN §5). La generazione è best-effort quando serve solo a dare varietà |
| U3 | **Un piano confermato non si rigenera per intero**: dopo la conferma si cambiano solo i singoli pasti; lo swap su un piano confermato conta l'uso della nuova ricetta | Nessun doppio conteggio di `times_used`, nessuna colonna di tracciamento in più |
| U4 | **★, voto, preferita e blocca restano nascosti fino a F5**: card e sheet li mostrano solo se ricevono un handler, e F4 non li passa | Il backlog li assegna a S2.2 (F5); niente bottoni che non fanno nulla |

## 3. Decisioni prese in planning (motivate)
| # | Decisione | Motivo |
|---|---|---|
| P1 | Moduli: `lib/domain/{planner,planner-config,rng,week}.ts` (puri), `lib/db/repositories/plan-repo.ts` (repository), `lib/plans/service.ts` (orchestratore lato server), `lib/plans/{errors,client,format}.ts` (sicuri per il client). **Nessun barrel** `lib/plans/index.ts` | Come `lib/settings/` (F3 P10): i componenti client non devono importare per errore il DB |
| P2 | Il planner puro **non chiama mai la generazione**: restituisce `needMore`; è `lib/plans/service.ts` che chiama `generateAndStoreRecipes` (modulo `recipes`), iniettabile come dipendenza, **prima** di aprire la transazione del piano | Regola di architettura §3 e contratto R2 della review di F2 |
| P3 | Firma del planner con **preferenze ingredienti già in input** (`IngredientPreferenceSets { likes, dislikes }`), filtro `dislike` e fattore `ingredientAffinity` implementati e testati; in F4 il servizio passa insiemi vuoti tramite un'unica funzione `loadIngredientPreferences(householdId)` | Contratto trasversale §4.3: F5 cabla i dati senza toccare l'algoritmo |
| P4 | `needMore` per tipo di pasto: `available` (candidate con peso > 0) `< slots + MIN_POOL_SIZE − 1`, oppure almeno uno slot rimasto vuoto. Numero da generare `clamp(deficit + 2, 3, 10)` | La soglia "pool < 3 per slot" di §5.2 applicata slot per slot scatterebbe sempre sugli ultimi slot: così si garantisce che anche l'ultimo slot di ogni tipo abbia almeno 3 candidate. Con il seed e le impostazioni di default nessuna chiamata LLM |
| P5 | Candidate con peso 0 (usate da meno di 10 giorni) **non contano** nel pool di `needMore`; se per uno slot restano solo candidate a peso 0, il planner sceglie **quella usata meno di recente** (ripiego) invece di lasciare lo slot vuoto | Il piano si fa anche senza LLM quando la libreria c'è; la generazione resta la prima scelta |
| P6 | Campionamento pesato **deterministico**: pool ordinato per `id`, RNG `mulberry32` seedabile; si riempiono prima gli slot del tipo di pasto con **meno candidate**, poi per giorno | "RNG seedato ⇒ output riproducibile" (S3.1) indipendentemente dall'ordine delle righe del DB; le ricette valide per pranzo e cena non lasciano scoperto il tipo più scarso (con il seed: 9 candidate di pranzo contro 10 di cena) |
| P7 | `meal_style_tags` dell'household **non entrano** nella selezione (né filtro né peso) | §5.2 non li prevede: orientano la generazione LLM, quindi la libreria stessa |
| P8 | Migrazione `0003`: `meal_plans.generated_at timestamptz not null default now()` e `shopping_lists.needs_regeneration boolean not null default false` | `generated_at` si aggiorna a ogni rigenerazione: la regola U1 di F3 diventa `households.updated_at > meal_plans.generated_at` (con `created_at` il banner resterebbe anche dopo aver rigenerato). `needs_regeneration` è il flag "lista da rigenerare" di S3.3, consumato e azzerato da F6 |
| P9 | Rigenerazione (solo piani `draft`): si ricostruiscono gli slot **dal primo giorno pianificabile in poi** secondo le impostazioni correnti; restano intatti gli slot dei giorni passati e gli slot bloccati (anche se il loro pasto non è più tra le impostazioni); le porzioni di tutti gli slot futuri diventano `persons`. Le ricette già nel piano non bloccate **non** sono escluse | Regole semplici e prevedibili; il campionamento casuale dà già varietà |
| P10 | Stati del piano: `draft` alla creazione → `active` alla conferma (idempotente) → `archived` quando si crea il piano di una settimana successiva. Swap, blocco e conferma rifiutati sui piani `archived` | Uso di `PLAN_STATUS_VALUES` già esistente, senza stati nuovi |
| P11 | Conferma = `times_used + 1` e `last_used_at = now()` (orologio del DB) per ogni ricetta distinta del piano, in upsert su `recipe_prefs` | §5.2; l'upsert protegge da ricette senza riga di preferenze |
| P12 | Swap: esclude la ricetta attuale, tutte le altre del piano **e** le ricette già scartate nella stessa sequenza *Cambia ancora* (inviate dal client, max 50). Genera (3 ricette, 1 giro) **solo** se non resta nessuna candidata | "Swap ripetuti non ripropongono mai la stessa ricetta" (S3.3); lo swap deve essere veloce nel caso normale |
| P13 | Lo swap su un piano con lista della spesa esistente imposta `needs_regeneration = true`; non crea liste | S3.3; la lista è di F6 |
| P14 | Blocco dello slot: nuovo endpoint `PATCH /api/plans/:id/slots/:slotId` `{ locked }`. In UI: long-press (500 ms) sulla card **più** il pulsante lucchetto già presente come alternativa accessibile | S3.4 chiede il long-press; il pulsante resta per tastiera e lettori di schermo |
| P15 | Fuso orario dell'app **`Europe/Rome`** (`APP_TIME_ZONE`) per calcolare "oggi" e la settimana | Il container sul Raspberry (F7) può girare in UTC: la settimana non deve dipendere dal fuso del server |
| P16 | Il Piano è una pagina server (`await connection()` + `getPlanScreen()`) che passa i dati a un componente client `PlanScreen`; `GET /api/plans/current` restituisce la stessa vista | Stesso schema di `/impostazioni` (F3 P4); nessun flash di caricamento |
| P17 | Il dettaglio ricetta usa i dati già presenti nel piano (ricetta completa con ingredienti e preferenze), con quantità **scalate sulle porzioni dello slot**; nessun `GET /api/recipes/:id` in F4 | Il piano ha al massimo 14 ricette: un solo payload, zero richieste in più; il dettaglio della Libreria è di F5 |
| P18 | Errori HTTP nel formato di F2/F3 `{ error: { code, message, details? } }`; nuovo helper `lib/http/responses.ts` usato dalle rotte dei piani e dalla rotta di generazione (refactor senza cambiare comportamento) | La mappatura degli errori LLM non va copiata una terza volta |
| P19 | Toast minimale locale (`components/feedback/toast.tsx`) per "Piano generato" / "Piano confermato" e per gli errori di swap e blocco | DESIGN §5 lo richiede; non esiste ancora un sistema di toast |
| P20 | Animazione dello swap: flip `rotateY` di 320 ms; con `prefers-reduced-motion` dissolvenza di 200 ms (CSS in `app/globals.css`) | DESIGN §3 e §6 |

## 4. Punti aperti dalle review precedenti, chiusi qui
| Da | Decisione |
|---|---|
| F2 R2 (generazione dentro una transazione) | `generatePlan` e `swapSlot` chiamano la generazione **fuori** da qualsiasi transazione; la transazione del piano si apre dopo (P2) |
| F3 R1 (preferenze ingredienti e contratto U1) | **Accettato così**: un like/dislike agisce dalla prossima generazione o dal prossimo swap, senza segnare il piano come superato |
| F3 R2 (percorsi) | La pagina Piano è `app/(app)/page.tsx` |
| F3 Q1 (`React.cache` su `getSettings`) | **Non adottato**: due letture dell'household per richiesta su una LAN domestica non giustificano la modifica di F3 e dei suoi test |
