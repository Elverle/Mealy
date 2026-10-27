---
title: Lista della Spesa — Regole Pure di Consolidamento, Riconciliazione e Formattazione (shopping-list)
type: entity
created: 2026-10-09
updated: 2026-10-27
tags: [shopping-list, domain, pure-functions, consolidation, aliases, rounding, reconciliation, sorting, formatting, feature-6]
---

## File e Responsabilità

- **Percorsi file**:
  - `lib/domain/shopping-list.ts`: regole **pure** della lista della spesa (alias, consolidamento, riconciliazione, reparto, ordinamento, raggruppamento, formattazione, scelta del piano da mostrare).
  - `lib/domain/plan-status.ts`: `isPlanClosed`, la regola "piano chiuso" condivisa con il servizio dei piani ([[plan-service]]).
- **Scopo**: trasformare gli slot di un piano negli articoli da comprare e decidere cosa cambia quando la lista si aggiorna, senza DB, rete, orologio né LLM. Le stesse funzioni servono il server ([[shopping-service]]) e il client ([[shopping-screen]]): ordinamento, raggruppamento e formattazione non sono mai riscritti nei componenti.
- **Regola di purezza** (`plan.md` §0.3.2): `shopping-list.ts` importa solo da `./types` e `./recipe-text`; `plan-status.ts` solo il tipo `PlanStatus` da `./types`. Lo verificano due test che leggono le righe `import` dei file. Il filtro "da oggi in poi" **non** sta qui: `buildShoppingList` non filtra per data, lo fa il servizio.

## Tipi del Modulo

Le interfacce di funzione vivono nel modulo; i DTO delle API (`ShoppingItemView`, `ShoppingPlanRef`, …) sono in [[domain-types]].

| Tipo | Forma |
|---|---|
| `AliasMap` | `ReadonlyMap<string, string>`: alias normalizzato → nome canonico normalizzato |
| `ShoppingSlotInput` | `{ servings, recipe: Pick<Recipe, 'id' \| 'servings_base' \| 'ingredients'> \| null }`, compatibile con `PlanSlotRecord` di [[plan-repo]] |
| `BuiltShoppingItem` | `{ canonical_name, qty: number \| null, unit: Unit, category, recipe_ids }`; `qty` è `null` se e solo se `unit === 'qb'`; `recipe_ids` distinti in ordine crescente |
| `ExistingShoppingItem` | `{ id, canonical_name, qty, unit: Unit \| null, checked }`: un articolo generato già salvato |
| `ShoppingListChanges` | `{ toInsert: BuiltShoppingItem[], toUpdate: { id, item, checked }[], toDelete: string[] }` |
| `ShoppingSection` | `{ category, label, items: ShoppingItemView[], checked, total }` |

## Alias

```ts
export function toAliasMap(aliases: readonly IngredientAlias[]): Map<string, string>;
export function resolveIngredientName(name: string, aliases: AliasMap): string;
```

- **`toAliasMap`**: normalizza alias e nome canonico con `normalizeCanonicalName` e salta le voci con un lato vuoto o con alias uguale al canonico.
- **`resolveIngredientName`**: normalizza il nome e lo risolve con **un solo passo** di alias. Le catene non si seguono: `a → b` e `b → c` portano `a` a `b`. Il file delle fixture non ne contiene, e un test lo impone ([[fixtures-and-seed]]).

## Consolidamento (`buildShoppingList`)

```ts
export function roundShoppingQuantity(value: number, unit: Unit): number | null;
export function buildShoppingList(slots: readonly ShoppingSlotInput[], aliases?: AliasMap): BuiltShoppingItem[];
```

Per ogni slot con una ricetta, `servings > 0` e `servings_base > 0` (gli altri si ignorano), con fattore `servings / servings_base`:

1. **Nome**: `resolveIngredientName(ingredient.canonical_name, aliases)`; un nome vuoto si salta.
2. **Quantità e unità**: l'ingrediente è misurato solo se `unit !== 'qb'` e `qty` è un numero maggiore di 0; altrimenti vale `qb`, anche se l'unità dichiarata era `g`, `ml` o `pz`.
3. **Somma** per nome e unità di `qty × fattore`, con l'insieme delle ricette che usano quella riga. La stessa ricetta in due slot raddoppia la quantità ma compare una volta in `recipe_ids`.
4. **Reparto per nome**: si conta il reparto di ogni ingrediente con quel nome; vince il più frequente e, a parità, il primo nell'ordine di `CATEGORY_VALUES` (il giro al supermercato). Tutte le righe dello stesso nome hanno lo stesso reparto.
5. **Assorbimento di `qb`**: se un nome ha sia una riga `qb` sia almeno una riga misurata, la riga `qb` sparisce e le sue ricette passano alla prima riga misurata presente nell'ordine `g`, `ml`, `pz`. Un nome non compare mai sia con `qb` sia con un'altra unità.
6. **Arrotondamento** con `roundShoppingQuantity`.
7. **Ordine** del risultato: reparto, nome (`localeCompare` italiano), unità nell'ordine di `UNIT_VALUES`.

La funzione non muta gli slot e senza slot restituisce `[]`.

**Dalla Feature 11** uno slot è un piatto ([[f11-composizione-pasto]]): un pasto con contorno arriva qui come due slot, con le stesse porzioni, e il contorno entra nella lista come ogni altro piatto. La funzione non è cambiata; `tests/plans/side-dish.test.ts` verifica che la lista di un piano confermato comprenda gli ingredienti del contorno, scalati sulle porzioni.

### `roundShoppingQuantity`

Il valore si arrotonda prima a 3 decimali, per togliere gli errori dei decimali binari, poi **per eccesso**:

| Unità | Regola | Esempi |
|---|---|---|
| `qb` | `null` | — |
| `pz` | intero superiore, mai meno di 1 | `0,75` → `1`, `1,5` → `2` |
| `g`, `ml` fino a 10 | intero superiore, mai meno di 1 | `2,5 g` → `3`, `10 ml` → `10` |
| `g`, `ml` oltre 10 | multiplo di 10 superiore | `10,4 ml` → `20`, `66,6667 g` → `70`, `150 g` → `150` |

Per eccesso perché si compra, non si dosa; la soglia a 10 evita che 2 g di zafferano diventino 10 g (requirements P5).

## Riconciliazione (`reconcileShoppingItems`)

```ts
export function reconcileShoppingItems(
  existing: readonly ExistingShoppingItem[],
  built: readonly BuiltShoppingItem[]
): ShoppingListChanges;
```

Confronta gli articoli **generati** già salvati con quelli appena costruiti per chiave `(canonical_name, unit)`; chi chiama passa in `existing` solo gli articoli non a mano.

- **Chiave nuova** → `toInsert` (nasce non spuntata).
- **Chiave che resta** → `toUpdate` con lo **stesso `id`** e la spunta ricalcolata: resta spuntata solo se lo era già **e** la nuova quantità è `null` (`qb`) oppure non supera quella di prima. Se la quantità cresce, o se prima non c'era quantità e ora sì, la riga torna da spuntare.
- **Chiave sparita** → `toDelete`.
- **Doppioni** tra gli esistenti (stessa chiave): si tiene quello con l'`id` più basso, gli altri vanno in `toDelete`.

`toDelete` è in ordine crescente di id. L'`id` stabile serve alla coda delle spunte: una spunta ancora in coda resta valida dopo un aggiornamento della lista ([[check-queue]]). Ogni chiave che resta finisce in `toUpdate`, anche se nulla è cambiato (v. limiti in [[e4-lista-spesa]]).

## Reparto di un Articolo a Mano (`inferShoppingCategory`)

```ts
export function inferShoppingCategory(
  name: string,
  recipes: readonly Pick<Recipe, 'ingredients'>[],
  aliases?: AliasMap
): Category;
```

Risolve il nome con gli alias e conta il reparto degli ingredienti della libreria che, risolti allo stesso modo, hanno quel nome; stessa regola di maggioranza del consolidamento. Nessuna corrispondenza, o nome vuoto, → `'altro'`. Così `latte` finisce tra i freschi senza un campo in più nel pannello di aggiunta (requirements P11).

## Ordinamento, Raggruppamento e Avanzamento

```ts
export function compareShoppingItemsByAisle(a: ShoppingItemView, b: ShoppingItemView): number;
export function groupShoppingItems(items: readonly ShoppingItemView[]): ShoppingSection[];
export function shoppingProgress(items: readonly Pick<ShoppingItemView, 'checked'>[]): { checked: number; total: number };
```

- **`compareShoppingItemsByAisle`**: reparto, nome, unità (`null`, cioè un articolo a mano, dopo tutte le altre), id. È l'ordine della risposta delle API e, dentro un reparto, quello a schermo.
- **`groupShoppingItems`**: una sezione per reparto **non vuoto**, nell'ordine di `CATEGORY_VALUES`, con l'etichetta di `CATEGORY_LABELS` e i conteggi della sezione. Non muta l'input. Dentro la sezione l'ordine non dipende dalle spunte: una riga spuntata resta dov'è (fino alla prova da telefono del 2026-10-09 gli spuntati andavano in fondo, con un confronto dedicato poi rimosso). Un articolo a mano con lo stesso nome di uno generato compare subito dopo di lui.
- **`shoppingProgress`**: articoli spuntati sul totale.

Il server ordina per reparto e il client riordina in `groupShoppingItems`: il doppione è voluto, dà una risposta API stabile (osservazione della review architetturale).

## Formattazione

```ts
export function formatShoppingQuantity(qty: number | null, unit: Unit | null): string;
export function shoppingItemLabel(canonicalName: string): string;
```

| Ingresso | Uscita |
|---|---|
| `unit: null` (articolo a mano) | `''` |
| `unit: 'qb'` | `q.b.` |
| unità misurata con `qty: null` | `''` |
| `g` sotto 1000 / da 1000 in su | `300 g` / `1,25 kg` |
| `ml` sotto 1000 / da 1000 in su | `500 ml` / `1,5 l` |
| `pz` | `2 pz` |

I numeri hanno al più due decimali e la virgola come separatore. `shoppingItemLabel` mette in maiuscolo solo la prima lettera del nome canonico.

## Piano di Default (`pickDefaultShoppingPlan`)

```ts
export function pickDefaultShoppingPlan(plans: readonly ShoppingPlanRef[]): string | null;
```

Tra i piani con lista (`has_list`) quello con `week_start` più avanti; se nessuno ha la lista, il più avanti tra tutti; `null` senza piani. È la regola U4 della tab *Lista*: chi chiama passa i soli piani confermati e non chiusi ([[shopping-service]]).

## Piano Chiuso (`plan-status.ts`)

```ts
export function isPlanClosed(plan: { status: PlanStatus; week_start: string }, currentWeekStart: string): boolean;
```

`status === 'archived'` oppure `week_start < currentWeekStart`. La chiusura si calcola e non si legge dallo stato, perché `archivePlansBefore` scatta solo alla creazione di un piano nuovo. La funzione è nata in `lib/plans/service.ts` (Feature 4) ed è stata spostata qui dall'innesto R1 della review architetturale, perché il servizio della lista potesse usarla senza importare il servizio dei piani, che porta con sé la generazione e gli SDK dei provider LLM.

## Esempio d'Uso

```ts
import { buildShoppingList, reconcileShoppingItems, toAliasMap } from '@/lib/domain/shopping-list';

const aliases = toAliasMap([{ alias: 'cipolle', canonical_name: 'cipolla' }]);
const built = buildShoppingList(plan.slots.filter((slot) => slot.day >= today), aliases);
const changes = reconcileShoppingItems(existingGeneratedItems, built);
// changes.toInsert, changes.toUpdate (stesso id, spunta ricalcolata), changes.toDelete
```

## Test

- `tests/domain/shopping-list.test.ts` (puro): alias normalizzati e a un solo passo; tabella degli arrotondamenti; scala sulle porzioni, somma tra ricette, stessa ricetta in due slot, unione e assorbimento di `qb`, unità diverse su righe separate nello stesso reparto, ingrediente in grammi senza quantità trattato come `qb`, alias, reparto a maggioranza e spareggio, slot da ignorare, ordine, **consolidamento coerente sulle fixture**, input non mutato; riconciliazione (inserimento, eliminazione, stesso id, spunta conservata a quantità uguale o minore e tolta se cresce, `qb` sempre conservata, unità diversa come chiave diversa, doppioni); reparto dedotto; ordinamenti, sezioni e avanzamento; formattazione; piano di default; purezza degli import dei due file.
- `tests/plans/service.test.ts` continua a provare `isPlanClosed` attraverso la riesportazione di `lib/plans/service.ts`.

## Vedi anche

- [[shopping-service]] — Servizio che filtra gli slot, applica le modifiche e sceglie il piano
- [[shopping-repo]] — Persistenza di liste, articoli e alias
- [[shopping-screen]] — Schermata che raggruppa e formatta con queste funzioni
- [[domain-types]] — `ShoppingItemView`, `ShoppingPlanRef`, `IngredientAlias`, `CATEGORY_VALUES`
- [[fixtures-and-seed]] — Alias delle fixture
- [[planner]] — L'altro modulo puro di `lib/domain/`
- [[e4-lista-spesa]] — Panoramica della Feature 6
