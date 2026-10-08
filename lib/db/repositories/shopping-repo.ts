import { and, asc, eq, gte, inArray, ne, sql } from 'drizzle-orm';
import type { DbExecutor } from '../index';
import { ingredient_aliases, meal_plans, recipes, shopping_items, shopping_lists } from '../schema';
import {
  CategorySchema,
  PlanStatusSchema,
  UnitSchema,
  type Category,
  type IngredientAlias,
  type PlanStatus,
  type Unit,
} from '@/lib/domain/types';

export interface ShoppingListRecord {
  id: string;
  plan_id: string;
  generated_at: Date;
  needs_regeneration: boolean;
}

export interface ShoppingItemRecord {
  id: string;
  list_id: string;
  canonical_name: string;
  qty: number | null;
  unit: Unit | null;
  category: Category;
  checked: boolean;
  manual: boolean;
  recipe_ids: string[];
}

export interface NewShoppingItemInput {
  canonical_name: string;
  qty: number | null;
  unit: Unit | null;
  category: Category;
  checked: boolean;
  manual: boolean;
  recipe_ids: string[];
}

export interface GeneratedItemUpdate {
  qty: number | null;
  category: Category;
  checked: boolean;
  recipe_ids: string[];
}

export interface ShoppingItemContext {
  item: ShoppingItemRecord;
  plan: { id: string; household_id: string; week_start: string; status: PlanStatus };
}

export interface OpenPlanRow {
  id: string;
  week_start: string;
  status: PlanStatus;
  has_list: boolean;
}

const LIST_COLUMNS = {
  id: shopping_lists.id,
  plan_id: shopping_lists.plan_id,
  generated_at: shopping_lists.generated_at,
  needs_regeneration: shopping_lists.needs_regeneration,
};

type ShoppingItemRow = typeof shopping_items.$inferSelect;

/**
 * Mappa una riga di `shopping_items`: `qty` numeric arriva come stringa dal driver.
 */
function toItemRecord(row: ShoppingItemRow): ShoppingItemRecord {
  return {
    id: row.id,
    list_id: row.list_id,
    canonical_name: row.canonical_name,
    qty: row.qty === null ? null : Number(row.qty),
    unit: row.unit === null ? null : UnitSchema.parse(row.unit),
    category: CategorySchema.parse(row.category),
    checked: row.checked,
    manual: row.manual,
    recipe_ids: row.recipe_ids,
  };
}

/** Lista del piano; null se non è mai stata creata. */
export async function findShoppingListByPlan(
  executor: DbExecutor,
  planId: string
): Promise<ShoppingListRecord | null> {
  const [row] = await executor
    .select(LIST_COLUMNS)
    .from(shopping_lists)
    .where(eq(shopping_lists.plan_id, planId))
    .limit(1);
  return row ?? null;
}

/** Crea la lista del piano (una per piano: chi chiama tiene il lock del piano). */
export async function insertShoppingList(
  executor: DbExecutor,
  planId: string
): Promise<ShoppingListRecord> {
  const [row] = await executor
    .insert(shopping_lists)
    .values({ plan_id: planId })
    .returning(LIST_COLUMNS);
  return row;
}

/** Segna la lista come appena costruita: generated_at = now() del DB, needs_regeneration = false. */
export async function markShoppingListGenerated(
  executor: DbExecutor,
  listId: string
): Promise<ShoppingListRecord> {
  const [row] = await executor
    .update(shopping_lists)
    .set({ generated_at: sql`now()`, needs_regeneration: false })
    .where(eq(shopping_lists.id, listId))
    .returning(LIST_COLUMNS);
  if (!row) {
    throw new Error(`Lista della spesa inesistente: ${listId}`);
  }
  return row;
}

/** Tutti gli articoli della lista, in ordine di id crescente. */
export async function listShoppingItems(
  executor: DbExecutor,
  listId: string
): Promise<ShoppingItemRecord[]> {
  const rows = await executor
    .select()
    .from(shopping_items)
    .where(eq(shopping_items.list_id, listId))
    .orderBy(asc(shopping_items.id));
  return rows.map(toItemRecord);
}

/** Inserisce gli articoli e li restituisce; con array vuoto non esegue query. */
export async function insertShoppingItems(
  executor: DbExecutor,
  listId: string,
  items: NewShoppingItemInput[]
): Promise<ShoppingItemRecord[]> {
  if (items.length === 0) return [];
  const rows = await executor
    .insert(shopping_items)
    .values(
      items.map((item) => ({
        list_id: listId,
        canonical_name: item.canonical_name,
        qty: item.qty === null ? null : String(item.qty),
        unit: item.unit,
        category: item.category,
        checked: item.checked,
        manual: item.manual,
        recipe_ids: item.recipe_ids,
      }))
    )
    .returning();
  return rows.map(toItemRecord);
}

/** Aggiorna quantità, reparto, spunta e ricette di un articolo generato (nome e unità non cambiano). */
export async function updateGeneratedShoppingItem(
  executor: DbExecutor,
  itemId: string,
  values: GeneratedItemUpdate
): Promise<void> {
  await executor
    .update(shopping_items)
    .set({
      qty: values.qty === null ? null : String(values.qty),
      category: values.category,
      checked: values.checked,
      recipe_ids: values.recipe_ids,
    })
    .where(eq(shopping_items.id, itemId));
}

/** Elimina gli articoli indicati; con array vuoto non esegue query. */
export async function deleteShoppingItems(executor: DbExecutor, itemIds: string[]): Promise<void> {
  if (itemIds.length === 0) return;
  await executor.delete(shopping_items).where(inArray(shopping_items.id, itemIds));
}

/** Imposta la spunta; null se l'articolo non esiste (più). */
export async function setShoppingItemChecked(
  executor: DbExecutor,
  itemId: string,
  checked: boolean
): Promise<ShoppingItemRecord | null> {
  const [row] = await executor
    .update(shopping_items)
    .set({ checked })
    .where(eq(shopping_items.id, itemId))
    .returning();
  return row ? toItemRecord(row) : null;
}

/** Articolo a mano della lista con quel nome (già normalizzato); il primo per id, null se assente. */
export async function findManualShoppingItem(
  executor: DbExecutor,
  listId: string,
  canonicalName: string
): Promise<ShoppingItemRecord | null> {
  const [row] = await executor
    .select()
    .from(shopping_items)
    .where(
      and(
        eq(shopping_items.list_id, listId),
        eq(shopping_items.manual, true),
        eq(shopping_items.canonical_name, canonicalName)
      )
    )
    .orderBy(asc(shopping_items.id))
    .limit(1);
  return row ? toItemRecord(row) : null;
}

/** Un articolo con il piano a cui appartiene la sua lista; null se l'articolo non esiste. */
export async function getShoppingItemContext(
  executor: DbExecutor,
  itemId: string
): Promise<ShoppingItemContext | null> {
  const [row] = await executor
    .select({
      item: shopping_items,
      plan_id: meal_plans.id,
      household_id: meal_plans.household_id,
      week_start: meal_plans.week_start,
      status: meal_plans.status,
    })
    .from(shopping_items)
    .innerJoin(shopping_lists, eq(shopping_items.list_id, shopping_lists.id))
    .innerJoin(meal_plans, eq(shopping_lists.plan_id, meal_plans.id))
    .where(eq(shopping_items.id, itemId))
    .limit(1);
  if (!row) return null;
  return {
    item: toItemRecord(row.item),
    plan: {
      id: row.plan_id,
      household_id: row.household_id,
      week_start: row.week_start,
      status: PlanStatusSchema.parse(row.status),
    },
  };
}

/** Tutti gli alias (tabella globale), in ordine di alias crescente. */
export async function listIngredientAliases(executor: DbExecutor): Promise<IngredientAlias[]> {
  return executor
    .select({ alias: ingredient_aliases.alias, canonical_name: ingredient_aliases.canonical_name })
    .from(ingredient_aliases)
    .orderBy(asc(ingredient_aliases.alias));
}

/** Id e titolo delle ricette indicate che esistono ancora, per titolo crescente poi id; array vuoto → nessuna query. */
export async function listRecipeRefs(
  executor: DbExecutor,
  recipeIds: string[]
): Promise<{ id: string; title: string }[]> {
  if (recipeIds.length === 0) return [];
  return executor
    .select({ id: recipes.id, title: recipes.title })
    .from(recipes)
    .where(inArray(recipes.id, recipeIds))
    .orderBy(asc(recipes.title), asc(recipes.id));
}

/** Piani dell'household non chiusi (week_start >= currentWeekStart e status diverso da 'archived'), per week_start crescente. */
export async function listOpenPlans(
  executor: DbExecutor,
  householdId: string,
  currentWeekStart: string
): Promise<OpenPlanRow[]> {
  const rows = await executor
    .select({
      id: meal_plans.id,
      week_start: meal_plans.week_start,
      status: meal_plans.status,
      list_id: shopping_lists.id,
    })
    .from(meal_plans)
    .leftJoin(shopping_lists, eq(shopping_lists.plan_id, meal_plans.id))
    .where(
      and(
        eq(meal_plans.household_id, householdId),
        gte(meal_plans.week_start, currentWeekStart),
        ne(meal_plans.status, 'archived')
      )
    )
    .orderBy(asc(meal_plans.week_start));
  return rows.map((row) => ({
    id: row.id,
    week_start: row.week_start,
    status: PlanStatusSchema.parse(row.status),
    has_list: row.list_id !== null,
  }));
}
