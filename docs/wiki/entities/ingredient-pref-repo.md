---
title: Repository delle Preferenze Ingrediente (ingredient-pref-repo)
type: entity
created: 2026-10-05
updated: 2026-10-05
tags: [database, repository, ingredient-prefs, drizzle, upsert, executor, feature-5]
---

## File e Responsabilità

- **Percorso file**: `lib/db/repositories/ingredient-pref-repo.ts`
- **Scopo**: leggere e scrivere la tabella `ingredient_prefs` ([[database-schema]]), che contiene i giudizi `like` / `dislike` di un household sui nomi canonici degli ingredienti. La tabella è popolata in modo *lazy*: una riga esiste solo per gli ingredienti giudicati.
- Ogni funzione riceve un `executor: DbExecutor` come **primo argomento** (il `db` globale o una transazione), sul modello di [[plan-repo]].
- Nessuna regola di dominio: il repository **non normalizza** il nome e non lo valida. Chi chiama passa un `canonical_name` già normalizzato (`parseIngredientPrefName` in [[prefs-service]]).

## Tipi

```ts
export interface IngredientPrefRow {
  canonical_name: string;
  pref: IngredientPref;   // 'like' | 'dislike'
  created_at: Date;
}
```

## Funzioni Esportate

| Funzione | Comportamento |
|---|---|
| `listIngredientPrefRows(executor, householdId)` | Giudizi dell'household in ordine crescente di `canonical_name`; ogni `pref` passa per `IngredientPrefSchema.parse`. Nessuna riga → `[]` |
| `upsertIngredientPref(executor, householdId, canonicalName, pref)` | `insert … on conflict (household_id, canonical_name) do update set pref`: passare da `like` a `dislike` lascia una sola riga e **conserva** il `created_at` del primo inserimento |
| `deleteIngredientPref(executor, householdId, canonicalName)` | Rimuove il giudizio; `true` se una riga è stata eliminata, `false` se non c'era |

La chiave `(household_id, canonical_name)` isola gli household: due nuclei con un giudizio sullo stesso nome non si vedono a vicenda, e l'eliminazione di un household elimina le sue righe (`ON DELETE CASCADE`).

## Chi lo Usa

- `lib/prefs/service.ts` ([[prefs-service]]): `listIngredientPrefs` e `setIngredientPref`.
- `lib/prefs/ingredient-prefs.ts`: `loadIngredientPreferences`, che costruisce gli insiemi per il planner ([[plan-service]]) e per la generazione ([[recipe-generation]]), anche dentro una transazione.
- `lib/library/service.ts` ([[library-service]]): `getRecipeDetail`, per il giudizio di ogni ingrediente della ricetta.

## Esempio d'Uso

```ts
import { db } from '@/lib/db';
import {
  deleteIngredientPref,
  listIngredientPrefRows,
  upsertIngredientPref,
} from '@/lib/db/repositories/ingredient-pref-repo';

await upsertIngredientPref(db, householdId, 'cipolla', 'dislike');
const rows = await listIngredientPrefRows(db, householdId); // [{ canonical_name: 'cipolla', pref: 'dislike', … }]
await deleteIngredientPref(db, householdId, 'cipolla');     // true
```

## Test

`tests/db/ingredient-pref-repo.test.ts` (node, DB reale, `describe.skipIf(!dbUp)`, household dedicati eliminati in `afterEach`): lista vuota, ordine alfabetico, sovrascrittura con una sola riga e `created_at` invariato, `deleteIngredientPref` → `true` poi `false`, isolamento tra household con lo stesso nome, eliminazione a cascata con l'household.

## Vedi anche

- [[database-schema]] — Tabella `ingredient_prefs` e migrazione `0004`
- [[prefs-service]] — Servizio, validazione del nome e lettura per planner e generazione
- [[library-service]] — Giudizi nel dettaglio della ricetta
- [[recipe-repo]] — Preferenze sulla ricetta (`recipe_prefs`)
- [[e2-libreria-preferenze]] — Panoramica della Feature 5
