---
title: Repository dei Piani Settimanali (plan-repo)
type: entity
created: 2026-09-29
updated: 2026-10-27
tags: [database, repository, meal-plans, plan-slots, drizzle, advisory-lock, recipe-usage, feature-4, feature-11]
---

## File e Responsabilità

- **Percorso file**: `lib/db/repositories/plan-repo.ts`
- **Scopo**: leggere e scrivere piani (`meal_plans`), slot (`plan_slots`), uso delle ricette (`recipe_prefs.times_used` / `last_used_at`) e il flag "lista da rigenerare" (`shopping_lists.needs_regeneration`). Ogni funzione riceve un `executor: DbExecutor` come **primo argomento** (il `db` globale o una transazione), sul modello di `listRecipeTitles` e `acquireRecipeGenerationLock` di [[recipe-repo]]. `DbExecutor` è importato da `lib/db/index.ts`.
- Nessuna regola di dominio: le decisioni (cosa mantenere, quando archiviare, chi può scrivere) stanno in [[plan-service]].
- Dalla Feature 6 il repository ha un secondo chiamante: `lib/shopping/service.ts` ([[shopping-service]]) usa `getPlanById` e `acquirePlanLock`, senza modifiche a questo file. Le letture e le scritture di liste e articoli sono in [[shopping-repo]]; qui resta solo `markShoppingListStale`.

## Tipi

| Tipo | Forma |
|---|---|
| `PlanRecord` | `id`, `household_id`, `week_start` (`YYYY-MM-DD`), `status: PlanStatus`, `created_at: Date`, `generated_at: Date` |
| `PlanSlotRecord` | `id`, `plan_id`, `day`, `meal: MealType`, `recipe_id \| null`, `servings`, `locked`, `recipe: RecipeWithDetails \| null` |
| `PlanWithSlots` | `PlanRecord` + `slots` (ordinati per giorno, poi pranzo → cena) + `shopping_list: { exists, needs_regeneration }` |
| `NewSlotInput` | `day`, `meal`, `recipe_id`, `servings`, `locked` |
| `RecipeUsageInput` | `recipeId`, `day` (giorno del pasto, `YYYY-MM-DD`) |

**Dalla Feature 11** `PlanSlotRecord` e `NewSlotInput` hanno anche `course: Course`, letto con `CourseSchema`; `slots` di `PlanWithSlots` è ordinato per giorno, poi pranzo → cena, poi **principale → contorno** (`compareSlots` mette per ultimo lo slot con `course === 'contorno'`).

`status` e `meal` sono validati con `PlanStatusSchema` / `MealTypeSchema`; la ricetta di ogni slot è convertita con `toRecipeWithDetails` (esportata da [[recipe-repo]] dalla Feature 4, prima era la funzione interna `formatRecipe`).

## Funzioni Esportate

### Letture
| Funzione | Comportamento |
|---|---|
| `findPlanByWeek(executor, householdId, weekStart)` | Piano della settimana con slot, ricette complete (ingredienti + prefs) e stato della lista; `null` se assente |
| `getPlanById(executor, planId)` | Come sopra, per id |
| `listPlanWeeks(executor, householdId)` | `week_start` di tutti i piani dell'household in ordine crescente (alimenta il navigatore di settimane, Addendum D2) |

### Lock e ciclo di vita del piano
| Funzione | Comportamento |
|---|---|
| `acquirePlanLock(executor, householdId)` | `pg_advisory_xact_lock(hashtext('mealy:plans:' + householdId))`. **Solo dentro una transazione**: si rilascia a commit/rollback. Serializza generazione, *Ripeti*, swap, blocco e conferma dello stesso household e, dalla Feature 6, la creazione o l'aggiornamento della lista della spesa e l'aggiunta di un articolo a mano ([[shopping-service]]). |
| `insertPlan(executor, householdId, weekStart)` | Nuovo piano `draft`; `created_at` e `generated_at` dai default del DB |
| `touchPlanGeneratedAt(executor, planId)` | `generated_at = now()` del DB (piano rigenerato) |
| `activateDraftPlan(executor, planId)` | Transizione **condizionata** `update … set status='active' where id=$1 and status='draft' returning id`; `true` solo se questa chiamata ha attivato il piano. Sostituisce il `setPlanStatus` previsto dal piano (proposta R2): con due conferme sovrapposte l'uso si conta una volta sola. |
| `archivePlansBefore(executor, householdId, weekStart)` | Archivia i piani non archiviati con `week_start < weekStart`; restituisce quanti ne ha aggiornati |

### Slot
| Funzione | Comportamento |
|---|---|
| `insertSlots(executor, planId, slots)` | Inserimento multiplo; array vuoto → nessuna query |
| `deleteSlots(executor, slotIds)` | Array vuoto → nessuna query |
| `updateSlotsServings(executor, slotIds, servings)` | Array vuoto → nessuna query |
| `updateSlotRecipe(executor, slotId, recipeId)` | Nuova ricetta dello slot (swap). Dalla Feature 11 `updateSlotRecipe(executor, slotId, recipeId, course?)`: con `course` definito cambia anche la portata dello slot (scelta a mano sul principale, [[plan-service]]) |
| `setSlotLocked(executor, slotId, locked)` | `true` se lo slot esisteva ed è stato aggiornato. Dalla Feature 11 il servizio non la usa più |
| `setMealLocked(executor, planId, day, meal, locked)` (Feature 11) | Blocca o sblocca **tutti** gli slot del pasto `(planId, day, meal)`; restituisce quanti ne ha aggiornati. È quella che usa `setSlotLock` ([[plan-service]]) |

### Uso delle ricette e lista della spesa
- **`incrementRecipeUsage(executor, usages: RecipeUsageInput[])`** (Addendum D3): raggruppa per ricetta tenendo il giorno **più recente**; un'unica `insert … on conflict (recipe_id) do update` su `recipe_prefs` con `times_used + 1` (una volta per ricetta e per chiamata, anche se la ricetta è in più slot) e `last_used_at = greatest(coalesce(recipe_prefs.last_used_at, x), x)` dove `x = '<day>T12:00:00Z'::timestamptz`. Il mezzogiorno UTC basta a contare i giorni senza aritmetica di fuso nel DB; `last_used_at` **non torna mai indietro**. Un giorno non `YYYY-MM-DD` lancia un errore; array vuoto → nessuna query.
- **`markShoppingListStale(executor, planId)`**: `needs_regeneration = true` sulla lista del piano; `true` se la lista esisteva. Non crea liste. Il flag viene rimesso a `false` da `markShoppingListGenerated` di [[shopping-repo]], a ogni creazione o aggiornamento della lista (Feature 6). Poiché le liste nascono solo su piani confermati, e la rigenerazione di un piano confermato è rifiutata, in pratica una lista diventa "da aggiornare" per uno swap; la chiamata nella rigenerazione di una bozza resta innocua.

## Esempio d'Uso

```ts
import { db } from '@/lib/db';
import { acquirePlanLock, activateDraftPlan, getPlanById, incrementRecipeUsage } from '@/lib/db/repositories/plan-repo';

await db.transaction(async (tx) => {
  await acquirePlanLock(tx, householdId);
  const plan = await getPlanById(tx, planId);
  if (plan && (await activateDraftPlan(tx, plan.id))) {
    await incrementRecipeUsage(
      tx,
      plan.slots.flatMap((s) => (s.recipe_id ? [{ recipeId: s.recipe_id, day: s.day }] : []))
    );
  }
});
```

## Test

`tests/db/plan-repo.test.ts` (node, DB reale, `describe.skipIf(!dbUp)`, household dedicati eliminati in `afterEach`): inserimento e rilettura, ordinamento degli slot, `touchPlanGeneratedAt`, `archivePlansBefore`, `listPlanWeeks`, `activateDraftPlan`, `incrementRecipeUsage` con giorni (deduplica, giorno più recente, nessun arretramento), `markShoppingListStale` con e senza lista, `setSlotLocked` su id inesistente. Dalla Feature 11: principale letto prima del contorno anche se il contorno è stato inserito prima, `updateSlotRecipe` che cambia la portata solo quando la riceve, `setMealLocked` su tutti gli slot di un pasto e non sull'altro pasto. Gli helper `insertTestRecipe` / `insertTestRecipes` sono in `tests/helpers/plans.ts`.

## Vedi anche

- [[database-schema]] — Tabelle `meal_plans`, `plan_slots`, `shopping_lists` e migrazione `0003`
- [[recipe-repo]] — `DbExecutor`, `toRecipeWithDetails`, `listRecipesWith`
- [[plan-service]] — Chiamante principale del repository (l'unico fino alla Feature 5)
- [[shopping-service]] — Secondo chiamante dalla Feature 6: `getPlanById` e `acquirePlanLock`
- [[shopping-repo]] — Repository di liste e articoli, con `markShoppingListGenerated`
- [[plan-concurrency-pattern]] — Uso del lock e delle transizioni condizionate
- [[e3-pianificatore]] — Panoramica della Feature 4
- [[f11-composizione-pasto]] — Feature 11: uno slot per piatto, blocco per pasto
