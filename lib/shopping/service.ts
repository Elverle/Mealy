// Solo lato server: importa il DB. I componenti client usano client.ts e check-queue.ts.
// `addManualShoppingItem` legge l'intera libreria e ogni lettura della lista carica il piano con le
// ricette complete: se sul Raspberry si sente, il reparto si conta in SQL su
// `recipe_ingredients_canonical_name_idx` e l'intestazione del piano si legge senza slot.

import { z } from 'zod';
import { db, type DbExecutor } from '@/lib/db';
import { loadHousehold } from '@/lib/db/repositories/household-repo';
import {
  acquirePlanLock,
  getPlanById,
  type PlanWithSlots,
} from '@/lib/db/repositories/plan-repo';
import { listRecipesWith } from '@/lib/db/repositories/recipe-repo';
import {
  deleteShoppingItems,
  findManualShoppingItem,
  findShoppingListByPlan,
  getShoppingItemContext,
  insertShoppingItems,
  insertShoppingList,
  listIngredientAliases,
  listOpenPlans,
  listRecipeRefs,
  listShoppingItems,
  markShoppingListGenerated,
  setShoppingItemChecked,
  updateGeneratedShoppingItem,
  type ShoppingItemContext,
  type ShoppingItemRecord,
} from '@/lib/db/repositories/shopping-repo';
import { isPlanClosed } from '@/lib/domain/plan-status';
import { normalizeCanonicalName } from '@/lib/domain/recipe-text';
import { APP_TIME_ZONE } from '@/lib/domain/planner-config';
import {
  buildShoppingList,
  compareShoppingItemsByAisle,
  inferShoppingCategory,
  pickDefaultShoppingPlan,
  reconcileShoppingItems,
  toAliasMap,
} from '@/lib/domain/shopping-list';
import {
  SHOPPING_ITEM_NAME_MAX,
  type PlanShoppingListView,
  type ShoppingItemView,
  type ShoppingListView,
  type ShoppingPlanRef,
  type ShoppingScreenView,
} from '@/lib/domain/types';
import { addDays, mondayOf, todayInTimeZone } from '@/lib/domain/week';
import { ShoppingError } from './errors';

const DAYS_PER_WEEK = 7;
const UuidSchema = z.guid();

export interface ShoppingServiceOptions {
  /** Default: singleton. */
  householdId?: string;
  /** Default: `() => new Date()`. */
  now?: () => Date;
}

// ============================================================================
// Helper
// ============================================================================

interface Clock {
  today: string;
  currentWeekStart: string;
}

function resolveClock(options: ShoppingServiceOptions): Clock {
  const now = (options.now ?? (() => new Date()))();
  const today = todayInTimeZone(now, APP_TIME_ZONE);
  return { today, currentWeekStart: mondayOf(today) };
}

function toItemView(record: ShoppingItemRecord): ShoppingItemView {
  return {
    id: record.id,
    canonical_name: record.canonical_name,
    qty: record.qty,
    unit: record.unit,
    category: record.category,
    checked: record.checked,
    manual: record.manual,
    recipe_ids: record.recipe_ids,
  };
}

/** Piano dell'household (404 se assente o di un altro household). */
async function loadOwnedPlan(
  executor: DbExecutor,
  planId: string,
  householdId: string
): Promise<PlanWithSlots> {
  const plan = await getPlanById(executor, planId);
  if (!plan || plan.household_id !== householdId) throw new ShoppingError('plan_not_found');
  return plan;
}

/** Vista del piano con la lista (se esiste): articoli ordinati per reparto, ricette citate. */
async function readPlanView(
  executor: DbExecutor,
  plan: PlanWithSlots,
  currentWeekStart: string
): Promise<PlanShoppingListView> {
  const closed = isPlanClosed(plan, currentWeekStart);
  const list = await findShoppingListByPlan(executor, plan.id);

  let listView: ShoppingListView | null = null;
  if (list !== null) {
    const items = (await listShoppingItems(executor, list.id))
      .map(toItemView)
      .sort(compareShoppingItemsByAisle);
    const recipeIds = [...new Set(items.flatMap((item) => item.recipe_ids))];
    listView = {
      id: list.id,
      generated_at: list.generated_at.toISOString(),
      needs_regeneration: list.needs_regeneration,
      items,
      recipes: await listRecipeRefs(executor, recipeIds),
    };
  }

  return {
    plan: {
      id: plan.id,
      week_start: plan.week_start,
      last_day: addDays(plan.week_start, DAYS_PER_WEEK - 1),
      status: plan.status,
      has_list: list !== null,
    },
    editable: !closed,
    can_build: !closed && plan.status === 'active',
    list: listView,
  };
}

/** Articolo da modificare: deve esistere, appartenere all'household e non stare in un piano chiuso. */
async function loadItemForWrite(
  itemId: string,
  householdId: string,
  currentWeekStart: string
): Promise<ShoppingItemContext> {
  const ctx = await getShoppingItemContext(db, itemId);
  if (ctx === null || ctx.plan.household_id !== householdId) {
    throw new ShoppingError('item_not_found');
  }
  if (isPlanClosed(ctx.plan, currentWeekStart)) throw new ShoppingError('plan_archived');
  return ctx;
}

// ============================================================================
// Lista del piano
// ============================================================================

/** Lista del piano (list null se non è stata creata). */
export async function getPlanShoppingList(
  planId: string,
  options: ShoppingServiceOptions = {}
): Promise<PlanShoppingListView> {
  const household = await loadHousehold(options.householdId);
  const { currentWeekStart } = resolveClock(options);

  const plan = await loadOwnedPlan(db, planId, household.id);
  return readPlanView(db, plan, currentWeekStart);
}

/** Crea la lista del piano o la aggiorna dal piano attuale, preservando spunte e articoli a mano. */
export async function buildPlanShoppingList(
  planId: string,
  options: ShoppingServiceOptions = {}
): Promise<PlanShoppingListView> {
  const household = await loadHousehold(options.householdId);
  const { today, currentWeekStart } = resolveClock(options);

  await db.transaction(async (tx) => {
    await acquirePlanLock(tx, household.id);
    const plan = await loadOwnedPlan(tx, planId, household.id);
    if (isPlanClosed(plan, currentWeekStart)) throw new ShoppingError('plan_archived');
    if (plan.status !== 'active') throw new ShoppingError('plan_not_confirmed');

    const aliases = toAliasMap(await listIngredientAliases(tx));
    const built = buildShoppingList(
      plan.slots.filter((slot) => slot.day >= today),
      aliases
    );
    const list =
      (await findShoppingListByPlan(tx, plan.id)) ?? (await insertShoppingList(tx, plan.id));
    const existing = (await listShoppingItems(tx, list.id)).filter((item) => !item.manual);
    const changes = reconcileShoppingItems(existing, built);

    await deleteShoppingItems(tx, changes.toDelete);
    for (const { id, item, checked } of changes.toUpdate) {
      await updateGeneratedShoppingItem(tx, id, {
        qty: item.qty,
        category: item.category,
        checked,
        recipe_ids: item.recipe_ids,
      });
    }
    await insertShoppingItems(
      tx,
      list.id,
      changes.toInsert.map((item) => ({ ...item, checked: false, manual: false }))
    );
    await markShoppingListGenerated(tx, list.id);
  });

  return getPlanShoppingList(planId, options);
}

// ============================================================================
// Articoli
// ============================================================================

/** Imposta la spunta di un articolo. */
export async function checkShoppingItem(
  itemId: string,
  checked: boolean,
  options: ShoppingServiceOptions = {}
): Promise<ShoppingItemView> {
  const household = await loadHousehold(options.householdId);
  const { currentWeekStart } = resolveClock(options);

  await loadItemForWrite(itemId, household.id, currentWeekStart);
  const updated = await setShoppingItemChecked(db, itemId, checked);
  if (updated === null) throw new ShoppingError('item_not_found');
  return toItemView(updated);
}

/**
 * Aggiunge un articolo a mano; se ne esiste già uno con lo stesso nome lo restituisce (created false).
 * Find e insert stanno sotto il lock dei piani dell'household: due aggiunte sovrapposte dello stesso
 * nome danno un solo articolo.
 */
export async function addManualShoppingItem(
  planId: string,
  name: string,
  options: ShoppingServiceOptions = {}
): Promise<{ item: ShoppingItemView; created: boolean }> {
  const household = await loadHousehold(options.householdId);
  const { currentWeekStart } = resolveClock(options);

  const canonical = normalizeCanonicalName(name);
  const nameIsValid = canonical !== '' && canonical.length <= SHOPPING_ITEM_NAME_MAX;

  return db.transaction(async (tx) => {
    await acquirePlanLock(tx, household.id);
    const plan = await loadOwnedPlan(tx, planId, household.id);
    if (isPlanClosed(plan, currentWeekStart)) throw new ShoppingError('plan_archived');
    const list = await findShoppingListByPlan(tx, plan.id);
    if (list === null) throw new ShoppingError('list_not_found');
    if (!nameIsValid) throw new RangeError('nome articolo non valido');

    const existing = await findManualShoppingItem(tx, list.id, canonical);
    if (existing !== null) return { item: toItemView(existing), created: false };

    const aliases = toAliasMap(await listIngredientAliases(tx));
    const category = inferShoppingCategory(
      canonical,
      await listRecipesWith(tx, { household_id: household.id }),
      aliases
    );
    const [inserted] = await insertShoppingItems(tx, list.id, [
      {
        canonical_name: canonical,
        qty: null,
        unit: null,
        category,
        checked: false,
        manual: true,
        recipe_ids: [],
      },
    ]);
    return { item: toItemView(inserted), created: true };
  });
}

/** Rimuove un articolo aggiunto a mano; restituisce il suo id. */
export async function removeManualShoppingItem(
  itemId: string,
  options: ShoppingServiceOptions = {}
): Promise<string> {
  const household = await loadHousehold(options.householdId);
  const { currentWeekStart } = resolveClock(options);

  const ctx = await loadItemForWrite(itemId, household.id, currentWeekStart);
  if (!ctx.item.manual) throw new ShoppingError('item_not_manual');
  await deleteShoppingItems(db, [itemId]);
  return itemId;
}

// ============================================================================
// Schermata Lista
// ============================================================================

/** Piano richiesto esplicitamente, se è un UUID che esiste ed è dell'household; altrimenti null. */
async function requestedPlanId(householdId: string, planId: string | undefined): Promise<string | null> {
  if (planId === undefined || !UuidSchema.safeParse(planId).success) return null;
  const plan = await getPlanById(db, planId);
  return plan !== null && plan.household_id === householdId ? plan.id : null;
}

/** Dato iniziale della pagina Lista: piani selezionabili e piano mostrato. */
export async function getShoppingScreen(
  options: ShoppingServiceOptions & { planId?: string } = {}
): Promise<ShoppingScreenView> {
  const household = await loadHousehold(options.householdId);
  const { currentWeekStart } = resolveClock(options);

  const rows = await listOpenPlans(db, household.id, currentWeekStart);
  const plans: ShoppingPlanRef[] = rows
    .filter((row) => row.status === 'active')
    .map((row) => ({
      id: row.id,
      week_start: row.week_start,
      last_day: addDays(row.week_start, DAYS_PER_WEEK - 1),
      status: row.status,
      has_list: row.has_list,
    }));

  const selectedId =
    (await requestedPlanId(household.id, options.planId)) ?? pickDefaultShoppingPlan(plans);
  const selected = selectedId === null ? null : await getPlanShoppingList(selectedId, options);
  return { plans, selected };
}
