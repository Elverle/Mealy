---
title: Repository della Lista della Spesa (shopping-repo)
type: entity
created: 2026-10-09
updated: 2026-10-09
tags: [database, repository, shopping-lists, shopping-items, ingredient-aliases, drizzle, executor, feature-6]
---

## File e Responsabilità

- **Percorso file**: `lib/db/repositories/shopping-repo.ts`
- **Scopo**: leggere e scrivere liste (`shopping_lists`) e articoli (`shopping_items`), leggere gli alias (`ingredient_aliases`), i titoli delle ricette citate e i piani aperti di un household ([[database-schema]]). Ogni funzione riceve un `executor: DbExecutor` come **primo argomento** (il `db` globale o una transazione), sul modello di [[plan-repo]].
- Nessuna regola di dominio: cosa inserire, aggiornare o eliminare lo decide `reconcileShoppingItems` ([[shopping-list]]); chi può scrivere e su quale piano lo decide [[shopping-service]]. Il repository non normalizza i nomi e non prende lock.
- La feature non ha aggiunto migrazioni: le tabelle sono quelle della Feature 1, con la colonna `needs_regeneration` della Feature 4.

## Tipi

| Tipo | Forma |
|---|---|
| `ShoppingListRecord` | `id`, `plan_id`, `generated_at: Date`, `needs_regeneration` |
| `ShoppingItemRecord` | `id`, `list_id`, `canonical_name`, `qty: number \| null`, `unit: Unit \| null`, `category: Category`, `checked`, `manual`, `recipe_ids: string[]` |
| `NewShoppingItemInput` | come `ShoppingItemRecord` senza `id` e `list_id` |
| `GeneratedItemUpdate` | `qty`, `category`, `checked`, `recipe_ids` (nome e unità non cambiano: sono la chiave) |
| `ShoppingItemContext` | `{ item: ShoppingItemRecord, plan: { id, household_id, week_start, status } }` |
| `OpenPlanRow` | `id`, `week_start`, `status: PlanStatus`, `has_list` |

Ogni riga di `shopping_items` passa per la funzione interna `toItemRecord`: `qty` è `numeric` e il driver la restituisce come stringa, quindi viene convertita in numero (e riscritta come stringa in inserimento e aggiornamento); `unit` e `category` sono validati con `UnitSchema` e `CategorySchema`, `status` con `PlanStatusSchema`.

## Funzioni Esportate

### Lista
| Funzione | Comportamento |
|---|---|
| `findShoppingListByPlan(executor, planId)` | Lista del piano; `null` se non è mai stata creata |
| `insertShoppingList(executor, planId)` | Crea la lista (una per piano: `plan_id` è unico). Chi chiama tiene il lock dei piani |
| `markShoppingListGenerated(executor, listId)` | `generated_at = now()` del DB e `needs_regeneration = false`; lancia un errore se la lista non esiste. È il complemento di `markShoppingListStale` di [[plan-repo]] |

### Articoli
| Funzione | Comportamento |
|---|---|
| `listShoppingItems(executor, listId)` | Tutti gli articoli della lista, in ordine crescente di `id` |
| `insertShoppingItems(executor, listId, items)` | Inserimento multiplo con `returning`; array vuoto → nessuna query |
| `updateGeneratedShoppingItem(executor, itemId, values)` | Aggiorna `qty`, `category`, `checked`, `recipe_ids` di un articolo generato |
| `deleteShoppingItems(executor, itemIds)` | Elimina gli articoli indicati; array vuoto → nessuna query |
| `setShoppingItemChecked(executor, itemId, checked)` | Imposta la spunta e restituisce la riga; `null` se l'articolo non esiste più |
| `findManualShoppingItem(executor, listId, canonicalName)` | Articolo **a mano** di quella lista con quel nome (già normalizzato); il primo per `id`, `null` se assente |
| `getShoppingItemContext(executor, itemId)` | L'articolo con il piano a cui appartiene la sua lista (join `shopping_items` → `shopping_lists` → `meal_plans`); `null` se l'articolo non esiste. Serve ai controlli di appartenenza e di piano chiuso sulle rotte `/api/shopping-items/:id` |

### Alias, ricette e piani
| Funzione | Comportamento |
|---|---|
| `listIngredientAliases(executor)` | Tutti gli alias, in ordine crescente di `alias`. La tabella è **globale**, non per household |
| `listRecipeRefs(executor, recipeIds)` | `{ id, title }` delle ricette indicate **che esistono ancora**, per titolo poi id; array vuoto → nessuna query. Un id citato in `recipe_ids` di una ricetta eliminata viene semplicemente ignorato |
| `listOpenPlans(executor, householdId, currentWeekStart)` | Piani dell'household con `week_start >= currentWeekStart` e stato diverso da `archived`, per `week_start` crescente, con `has_list` (left join sulla lista). Restituisce anche le bozze: il filtro sui confermati lo applica il servizio |

## Chi lo Usa

- `lib/shopping/service.ts` ([[shopping-service]]) è l'unico modulo che importa questo repository, in parte dentro la transazione che tiene `acquirePlanLock`.
- `markShoppingListStale`, che accende il flag `needs_regeneration`, resta in [[plan-repo]] ed è chiamata dal servizio dei piani.

## Esempio d'Uso

```ts
import { db } from '@/lib/db';
import { acquirePlanLock } from '@/lib/db/repositories/plan-repo';
import {
  findShoppingListByPlan,
  insertShoppingList,
  listShoppingItems,
  markShoppingListGenerated,
} from '@/lib/db/repositories/shopping-repo';

await db.transaction(async (tx) => {
  await acquirePlanLock(tx, householdId);
  const list = (await findShoppingListByPlan(tx, planId)) ?? (await insertShoppingList(tx, planId));
  const items = await listShoppingItems(tx, list.id);
  // … riconciliazione e scritture …
  await markShoppingListGenerated(tx, list.id);
});
```

## Test

`tests/db/shopping-repo.test.ts` (node, DB reale, `describe.skipIf(!dbUp)`, household dedicati): lista assente poi creata, `markShoppingListGenerated` che azzera il flag senza far arretrare `generated_at`, `qty` convertita in numero con `null` e `recipe_ids` conservati, aggiornamento dei soli campi previsti, spunta su id esistente e inesistente, eliminazione mirata e con array vuoto, ricerca dei soli articoli a mano della lista indicata, contesto dell'articolo, `listRecipeRefs` con id sconosciuti e input vuoto, `listOpenPlans` con presenza della lista ed esclusione degli archiviati, un alias inserito dal test (nome unico, mai quelli del seed: requirements P24), eliminazione a cascata con l'household.

## Vedi anche

- [[database-schema]] — Tabelle `shopping_lists`, `shopping_items`, `ingredient_aliases`
- [[shopping-service]] — Unico chiamante del repository
- [[shopping-list]] — Regole pure che decidono le scritture
- [[plan-repo]] — `getPlanById`, `acquirePlanLock`, `markShoppingListStale`
- [[fixtures-and-seed]] — Origine delle righe di `ingredient_aliases`
- [[e4-lista-spesa]] — Panoramica della Feature 6
