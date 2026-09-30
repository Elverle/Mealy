---
title: Generazione Fuori, Selezione Dentro il Lock
type: concept
created: 2026-09-29
updated: 2026-09-29
tags: [architecture, concurrency, transactions, advisory-lock, llm, planner, feature-4]
---

## Il Problema

Le operazioni sul piano (genera, rigenera, *Ripeti*, swap) hanno due parti con esigenze opposte:

- la **generazione LLM** dura da decine di secondi a qualche minuto e non deve mai stare dentro una transazione, altrimenti una connessione del pool resta occupata e i lock restano presi per tutto quel tempo (contratto R2 della review della Feature 2, [[recipe-generation]]);
- la **selezione** delle ricette decide cosa scrivere, e se la si calcola su uno stato letto prima della transazione il risultato può non essere più valido al momento della scrittura.

La prima versione del piano faceva selezione e generazione fuori, poi scriveva in transazione. La review architetturale del 2026-09-29 (R2) ha mostrato tre race con la stessa radice: due swap concorrenti potevano assegnare la **stessa ricetta** a due slot (violando l'accettazione di S3.3), due conferme sovrapposte contavano `times_used` due volte, e una rigenerazione sovrapposta a un blocco/sblocco poteva lasciare un buco o ripetere una ricetta. La code review ha aggiunto un quarto caso (M1): impostazioni salvate durante la generazione venivano ignorate dal piano ma coperte da `generated_at`, quindi il piano non risultava "superato".

## La Regola

**L'LLM sta fuori, la selezione sta dentro.** La selezione è pura e costa millisecondi: si può ripetere dentro il lock sullo stato riletto.

```
Fase 1 — fuori dalle transazioni (può durare minuti)
  leggi piano, libreria, impostazioni
  selectRecipes()  ──► serve solo a decidere SE e QUANTO generare
  generate() a lotti in parallelo ──► le ricette nuove entrano in libreria
  uscita rapida se resta uno slot vuoto (nessuna scrittura)

Fase 2 — db.transaction (millisecondi)
  acquirePlanLock(tx, household)          advisory lock per household
  rileggi con tx: piano, household, preferenze, libreria
  ricontrolla le invarianti (stato del piano, slot, locked, giorno passato)
  selectRecipes() sullo stato riletto     ──► la scelta che si scrive
  slot vuoto? rollback con llmError ?? PlanError
  scrivi (slot, generated_at, stato della lista, uso delle ricette)
```

La generazione fatta nella fase 1 non si perde anche se la fase 2 fallisce: le ricette sono già in libreria e serviranno al prossimo tentativo.

## Dove si Applica

| Operazione | Fase 1 | Fase 2 |
|---|---|---|
| `generatePlan` / `repeatPlan` ([[plan-service]], `buildTargetPlan`) | selezione e giri di generazione | rilettura di piano, household (`getHouseholdById(id, tx)`), preferenze (`loadIngredientPreferences(id, tx)`) e libreria (`listRecipesWith(tx, …)`), nuova `computeSelection`, scrittura |
| `swapSlot` | scelta di prova, eventuale generazione di 3 ricette | rilettura, nuova scelta escludendo le ricette del piano **riletto**, `updateSlotRecipe` |
| `confirmPlan` | lettura per la risposta idempotente | `activateDraftPlan` (transizione condizionata `draft → active`), uso delle ricette solo se la transizione è avvenuta |
| `setSlotLock` | — | tutto sotto lock, così una rigenerazione non cancella lo slot a metà |

Il lock è `pg_advisory_xact_lock(hashtext('mealy:plans:' + householdId))` ([[plan-repo]]): serializza le scritture sui piani di un household e si rilascia da solo a commit o rollback. Con PostgreSQL in `READ COMMITTED`, le letture fatte **dopo** il lock vedono tutto ciò che è stato committato prima.

## Conseguenze

- I repository che la fase 2 deve rileggere accettano un `executor` (`DbExecutor`, ora in `lib/db/index.ts`): `listRecipesWith` in [[recipe-repo]], `getHouseholdById(id, executor)` in [[household-repo]], `loadIngredientPreferences(id, executor)`.
- `generated_at` viene scritto con `now()` della transazione, dopo aver riletto le impostazioni: la regola `superseded = households.updated_at > generated_at` resta vera.
- I test DB verificano le race davvero nella finestra critica: una transazione tiene il lock mentre `generatePlan` è in coda (attesa rilevata su `pg_locks`), cambia lo slot e fa commit; con la selezione esterna riusata i test falliscono (fix m1 della code review).
- Le Feature 5 e 6 che scrivono su piani o liste devono seguire la stessa regola se combinano letture, decisioni e chiamate lente.

## Vedi anche

- [[plan-service]] — Implementazione di generazione, swap, conferma e blocco
- [[plan-repo]] — `acquirePlanLock`, `activateDraftPlan`
- [[planner]] — La selezione pura che si ripete dentro il lock
- [[recipe-generation]] — Contratto "LLM fuori dalle transazioni" della Feature 2
- [[database-architecture]] — Transazioni e advisory lock in PostgreSQL
- [[e3-pianificatore]] — Panoramica della Feature 4
