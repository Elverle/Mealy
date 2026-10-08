// Regole pure della lista della spesa (Feature 6). Nessuna dipendenza da DB, LLM o framework.

import { normalizeCanonicalName } from './recipe-text';
import { CATEGORY_LABELS, CATEGORY_VALUES, UNIT_VALUES } from './types';
import type {
  Category,
  IngredientAlias,
  Recipe,
  ShoppingItemView,
  ShoppingPlanRef,
  Unit,
} from './types';

/** Alias normalizzato → nome canonico normalizzato. */
export type AliasMap = ReadonlyMap<string, string>;

/** Uno slot del piano visto dal consolidamento (compatibile con PlanSlotRecord di plan-repo). */
export interface ShoppingSlotInput {
  servings: number;
  recipe: Pick<Recipe, 'id' | 'servings_base' | 'ingredients'> | null;
}

/** Un articolo calcolato dal piano, non ancora salvato. */
export interface BuiltShoppingItem {
  canonical_name: string;
  qty: number | null; // null se e solo se unit === 'qb'
  unit: Unit;
  category: Category;
  recipe_ids: string[]; // distinti, in ordine crescente
}

/** Un articolo generato già salvato, visto dalla riconciliazione. */
export interface ExistingShoppingItem {
  id: string;
  canonical_name: string;
  qty: number | null;
  unit: Unit | null;
  checked: boolean;
}

export interface ShoppingListChanges {
  toInsert: BuiltShoppingItem[]; // chiavi nuove: nascono non spuntate
  toUpdate: { id: string; item: BuiltShoppingItem; checked: boolean }[]; // chiavi che restano
  toDelete: string[]; // id degli articoli generati che non servono più, in ordine crescente
}

export interface ShoppingSection {
  category: Category;
  label: string; // CATEGORY_LABELS[category]
  items: ShoppingItemView[]; // non spuntati prima, poi spuntati
  checked: number;
  total: number;
}

/** Reparto di ripiego quando non c'è nessuna informazione. */
const FALLBACK_CATEGORY: Category = 'altro';
/** Precisione dei decimali binari: si arrotonda a 3 cifre prima di scalare. */
const QUANTITY_PRECISION = 1000;
/** Sotto questa soglia g e ml si arrotondano all'unità; sopra, alla decina. */
const SMALL_QUANTITY_MAX = 10;
const QUANTITY_STEP = 10;
const GRAMS_PER_KG = 1000;
const ML_PER_L = 1000;
const DISPLAY_DECIMALS = 100;
const EMPTY_ALIASES: AliasMap = new Map();

/** Mappa degli alias normalizzata; salta le voci vuote e quelle con alias uguale al canonico. */
export function toAliasMap(aliases: readonly IngredientAlias[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const entry of aliases) {
    const from = normalizeCanonicalName(entry.alias);
    const to = normalizeCanonicalName(entry.canonical_name);
    if (from === '' || to === '' || from === to) continue;
    map.set(from, to);
  }
  return map;
}

/** Nome normalizzato risolto con un solo passo di alias. */
export function resolveIngredientName(name: string, aliases: AliasMap): string {
  const normalized = normalizeCanonicalName(name);
  return aliases.get(normalized) ?? normalized;
}

/** Quantità arrotondata per eccesso alla soglia pratica del reparto; null per 'qb'. */
export function roundShoppingQuantity(value: number, unit: Unit): number | null {
  if (unit === 'qb') return null;
  const v = Math.round(value * QUANTITY_PRECISION) / QUANTITY_PRECISION;
  if (unit === 'pz') return Math.max(1, Math.ceil(v));
  if (v <= SMALL_QUANTITY_MAX) return Math.max(1, Math.ceil(v));
  return Math.ceil(v / QUANTITY_STEP) * QUANTITY_STEP;
}

interface UnitTotal {
  sum: number;
  recipeIds: Set<string>;
}

interface NameBucket {
  units: Map<Unit, UnitTotal>;
  categories: Map<Category, number>;
}

function categoryIndex(category: Category): number {
  return CATEGORY_VALUES.indexOf(category);
}

function unitIndex(unit: Unit | null): number {
  return unit === null ? UNIT_VALUES.length : UNIT_VALUES.indexOf(unit);
}

function compareIds(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

/**
 * Categoria più frequente; a parità vince quella con l'indice più basso in CATEGORY_VALUES
 * (il giro al supermercato). `null` se la mappa è vuota.
 */
function dominantCategory(counts: ReadonlyMap<Category, number>): Category | null {
  let best: Category | null = null;
  let bestCount = 0;
  for (const category of CATEGORY_VALUES) {
    const count = counts.get(category) ?? 0;
    if (count > bestCount) {
      best = category;
      bestCount = count;
    }
  }
  return best;
}

function bucketFor(buckets: Map<string, NameBucket>, name: string): NameBucket {
  const existing = buckets.get(name);
  if (existing) return existing;
  const created: NameBucket = { units: new Map(), categories: new Map() };
  buckets.set(name, created);
  return created;
}

function unitTotalFor(bucket: NameBucket, unit: Unit): UnitTotal {
  const existing = bucket.units.get(unit);
  if (existing) return existing;
  const created: UnitTotal = { sum: 0, recipeIds: new Set() };
  bucket.units.set(unit, created);
  return created;
}

/**
 * Assorbe la riga `qb` del nome nella prima riga misurata (g, ml, pz), se esiste.
 * Dopo l'assorbimento un nome non compare mai sia con `qb` sia con un'altra unità.
 */
function absorbQualitative(bucket: NameBucket): void {
  const qualitative = bucket.units.get('qb');
  if (!qualitative) return;
  const target = (['g', 'ml', 'pz'] as const)
    .map((unit) => bucket.units.get(unit))
    .find((total) => total !== undefined);
  if (!target) return;
  for (const id of qualitative.recipeIds) target.recipeIds.add(id);
  bucket.units.delete('qb');
}

/**
 * Consolida gli slot del piano in articoli da comprare: quantità scalate sulle porzioni,
 * alias risolti, somme per nome e unità, arrotondamento, reparto. Non filtra per data.
 * Non muta gli slot.
 */
export function buildShoppingList(
  slots: readonly ShoppingSlotInput[],
  aliases: AliasMap = EMPTY_ALIASES
): BuiltShoppingItem[] {
  const buckets = new Map<string, NameBucket>();

  for (const slot of slots) {
    const r = slot.recipe;
    if (r === null || !(r.servings_base > 0) || !(slot.servings > 0)) continue;
    const factor = slot.servings / r.servings_base;

    for (const ingredient of r.ingredients ?? []) {
      const name = resolveIngredientName(ingredient.canonical_name, aliases);
      if (name === '') continue;

      const qty =
        ingredient.unit !== 'qb' && typeof ingredient.qty === 'number' && ingredient.qty > 0
          ? ingredient.qty
          : null;
      const unit: Unit = qty !== null ? ingredient.unit : 'qb';

      const bucket = bucketFor(buckets, name);
      const total = unitTotalFor(bucket, unit);
      if (qty !== null) total.sum += qty * factor;
      total.recipeIds.add(r.id);
      bucket.categories.set(
        ingredient.category,
        (bucket.categories.get(ingredient.category) ?? 0) + 1
      );
    }
  }

  const built: BuiltShoppingItem[] = [];
  for (const [name, bucket] of buckets) {
    const category = dominantCategory(bucket.categories) ?? FALLBACK_CATEGORY;
    absorbQualitative(bucket);
    for (const [unit, total] of bucket.units) {
      built.push({
        canonical_name: name,
        qty: roundShoppingQuantity(total.sum, unit),
        unit,
        category,
        recipe_ids: [...total.recipeIds].sort(),
      });
    }
  }

  return built.sort(
    (a, b) =>
      categoryIndex(a.category) - categoryIndex(b.category) ||
      a.canonical_name.localeCompare(b.canonical_name, 'it') ||
      unitIndex(a.unit) - unitIndex(b.unit)
  );
}

/**
 * Confronta gli articoli generati salvati con quelli appena costruiti per chiave
 * `(canonical_name, unit)`. Le spunte si conservano se la quantità non cresce.
 * `existing` contiene solo articoli generati.
 */
export function reconcileShoppingItems(
  existing: readonly ExistingShoppingItem[],
  built: readonly BuiltShoppingItem[]
): ShoppingListChanges {
  const keyOf = (canonicalName: string, unit: Unit | null): string => `${canonicalName}|${unit ?? ''}`;

  const index = new Map<string, ExistingShoppingItem>();
  const toDelete: string[] = [];
  const byId = [...existing].sort((a, b) => compareIds(a.id, b.id));
  for (const item of byId) {
    const key = keyOf(item.canonical_name, item.unit);
    if (index.has(key)) {
      toDelete.push(item.id);
    } else {
      index.set(key, item);
    }
  }

  const toInsert: BuiltShoppingItem[] = [];
  const toUpdate: ShoppingListChanges['toUpdate'] = [];
  const matchedIds = new Set<string>();
  for (const item of built) {
    const found = index.get(keyOf(item.canonical_name, item.unit));
    if (!found) {
      toInsert.push(item);
      continue;
    }
    matchedIds.add(found.id);
    const checked =
      found.checked && (item.qty === null || (found.qty !== null && item.qty <= found.qty));
    toUpdate.push({ id: found.id, item, checked });
  }

  for (const item of index.values()) {
    if (!matchedIds.has(item.id)) toDelete.push(item.id);
  }

  return { toInsert, toUpdate, toDelete: toDelete.sort(compareIds) };
}

/**
 * Reparto di un articolo aggiunto a mano: quello più frequente tra gli ingredienti delle
 * ricette con lo stesso nome (alias risolti). Nessuna corrispondenza → 'altro'.
 */
export function inferShoppingCategory(
  name: string,
  recipes: readonly Pick<Recipe, 'ingredients'>[],
  aliases: AliasMap = EMPTY_ALIASES
): Category {
  const target = resolveIngredientName(name, aliases);
  if (target === '') return FALLBACK_CATEGORY;

  const counts = new Map<Category, number>();
  for (const recipe of recipes) {
    for (const ingredient of recipe.ingredients ?? []) {
      if (resolveIngredientName(ingredient.canonical_name, aliases) !== target) continue;
      counts.set(ingredient.category, (counts.get(ingredient.category) ?? 0) + 1);
    }
  }
  return dominantCategory(counts) ?? FALLBACK_CATEGORY;
}

/** Ordine del giro al supermercato: reparto, nome, unità (null dopo tutte), id. */
export function compareShoppingItemsByAisle(a: ShoppingItemView, b: ShoppingItemView): number {
  return (
    categoryIndex(a.category) - categoryIndex(b.category) ||
    a.canonical_name.localeCompare(b.canonical_name, 'it') ||
    unitIndex(a.unit) - unitIndex(b.unit) ||
    compareIds(a.id, b.id)
  );
}

/** Ordine di visualizzazione dentro un reparto: non spuntati prima, poi nome, unità, id. */
export function compareShoppingItemsForDisplay(a: ShoppingItemView, b: ShoppingItemView): number {
  return (
    Number(a.checked) - Number(b.checked) ||
    a.canonical_name.localeCompare(b.canonical_name, 'it') ||
    unitIndex(a.unit) - unitIndex(b.unit) ||
    compareIds(a.id, b.id)
  );
}

/** Sezioni per reparto, solo quelle non vuote, nell'ordine del giro. Non muta l'input. */
export function groupShoppingItems(items: readonly ShoppingItemView[]): ShoppingSection[] {
  return CATEGORY_VALUES.flatMap((category) => {
    const inCategory = items.filter((item) => item.category === category);
    if (inCategory.length === 0) return [];
    const sorted = inCategory.sort(compareShoppingItemsForDisplay);
    const { checked, total } = shoppingProgress(sorted);
    return [{ category, label: CATEGORY_LABELS[category], items: sorted, checked, total }];
  });
}

/** Avanzamento: articoli spuntati sul totale. */
export function shoppingProgress(
  items: readonly Pick<ShoppingItemView, 'checked'>[]
): { checked: number; total: number } {
  return { checked: items.filter((item) => item.checked).length, total: items.length };
}

function formatNumber(value: number): string {
  return String(Math.round(value * DISPLAY_DECIMALS) / DISPLAY_DECIMALS).replace('.', ',');
}

/** Quantità in forma leggibile: '300 g', '1,25 kg', '2 pz', 'q.b.'; stringa vuota se manca. */
export function formatShoppingQuantity(qty: number | null, unit: Unit | null): string {
  if (unit === null) return '';
  if (unit === 'qb') return 'q.b.';
  if (qty === null) return '';
  if (unit === 'g') {
    return qty >= GRAMS_PER_KG
      ? `${formatNumber(qty / GRAMS_PER_KG)} kg`
      : `${formatNumber(qty)} g`;
  }
  if (unit === 'ml') {
    return qty >= ML_PER_L ? `${formatNumber(qty / ML_PER_L)} l` : `${formatNumber(qty)} ml`;
  }
  return `${formatNumber(qty)} pz`;
}

/** Nome dell'articolo con la prima lettera maiuscola. */
export function shoppingItemLabel(canonicalName: string): string {
  return canonicalName.charAt(0).toUpperCase() + canonicalName.slice(1);
}

/**
 * Piano da mostrare di default: tra quelli con lista il più avanti nel tempo; se nessuno ha
 * la lista, il più avanti tra tutti. Restituisce l'id, o null se non ci sono piani.
 */
export function pickDefaultShoppingPlan(plans: readonly ShoppingPlanRef[]): string | null {
  const withList = plans.filter((plan) => plan.has_list);
  const pool = withList.length > 0 ? withList : plans;
  let latest: ShoppingPlanRef | undefined;
  for (const plan of pool) {
    if (latest === undefined || plan.week_start > latest.week_start) latest = plan;
  }
  return latest?.id ?? null;
}
