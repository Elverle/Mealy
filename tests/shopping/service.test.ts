// @vitest-environment node

// Preambolo: i nomi d'ingrediente di questi test non devono essere alias del seed.
// `ingredient_aliases` è una tabella globale che `tests/db/seed.test.ts` riempie nella stessa
// esecuzione: un alias del seed cambierebbe il nome canonico atteso. I nomi usati
// (`petto di pollo`, `sale`, `cipolla`, `zucca`, `latte`, `latte intero`, `carta forno`) non lo sono.

import { readFileSync } from 'node:fs';
import { posix } from 'node:path';
import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { db, ingredient_aliases } from '@/lib/db';
import {
  activateDraftPlan,
  getPlanById,
  insertPlan,
  insertSlots,
  markShoppingListStale,
  updateSlotRecipe,
  updateSlotsServings,
  type NewSlotInput,
} from '@/lib/db/repositories/plan-repo';
import { findShoppingListByPlan } from '@/lib/db/repositories/shopping-repo';
import type { InsertIngredientInput } from '@/lib/db/repositories/recipe-repo';
import type {
  Category,
  PlanShoppingListView,
  ShoppingItemView,
  ShoppingListView,
  Unit,
} from '@/lib/domain/types';
import { ShoppingError, type ShoppingErrorCode } from '@/lib/shopping/errors';
import {
  addManualShoppingItem,
  buildPlanShoppingList,
  checkShoppingItem,
  getPlanShoppingList,
  getShoppingScreen,
  removeManualShoppingItem,
  type ShoppingServiceOptions,
} from '@/lib/shopping/service';
import {
  assertDbMigrated,
  createTestHousehold,
  deleteTestHousehold,
  isDbAvailable,
} from '@/tests/helpers/db';
import { insertTestRecipe } from '@/tests/helpers/plans';

const WED = () => new Date('2026-09-30T10:00:00Z'); // oggi 30/09, settimana del 28/09
const SAT = () => new Date('2026-10-03T09:00:00Z'); // sabato: settimana 28/09 ancora aperta
const MON2 = () => new Date('2026-10-05T08:00:00Z'); // lunedì dopo: settimana 28/09 conclusa

const WEEK = '2026-09-28';
const NEXT_WEEK = '2026-10-05';
const DAY_TUE_BEFORE = '2026-09-29';
const DAY_WED = '2026-09-30';
const DAY_THU = '2026-10-01';

const FORBIDDEN_IMPORT_PREFIXES = ['lib/plans/service', 'lib/recipes', 'lib/llm'];
const SERVICE_SOURCE = readFileSync(new URL('../../lib/shopping/service.ts', import.meta.url), 'utf8');
const IMPORT_SPECIFIER_PATTERN = /(?:\bfrom|\bimport)\s+'([^']+)'/g;

/** Percorso del modulo importato, relativo alla radice del progetto (alias `@/` o relativo a lib/shopping). */
function resolveSpecifier(specifier: string): string {
  if (specifier.startsWith('@/')) return specifier.slice(2);
  if (specifier.startsWith('.')) return posix.normalize(posix.join('lib/shopping', specifier));
  return specifier;
}

const importSpecifiers = [...SERVICE_SOURCE.matchAll(IMPORT_SPECIFIER_PATTERN)].map((match) => match[1]);

describe('lista della spesa: purezza del servizio', () => {
  it('non importa il modulo dei piani, le ricette o l\'LLM', () => {
    expect(importSpecifiers.length).toBeGreaterThan(0);
    const offending = importSpecifiers.filter((specifier) => {
      const resolved = resolveSpecifier(specifier);
      return FORBIDDEN_IMPORT_PREFIXES.some((prefix) => resolved.startsWith(prefix));
    });
    expect(offending).toEqual([]);
  });
});

const dbUp = await isDbAvailable();

type Ingredient = InsertIngredientInput;

function ing(canonicalName: string, qty: number | null, unit: Unit, category: Category): Ingredient {
  return { canonical_name: canonicalName, display_name: canonicalName, qty, unit, category };
}

function at(householdId: string, now: () => Date): ShoppingServiceOptions {
  return { householdId, now };
}

function requireList(view: PlanShoppingListView): ShoppingListView {
  if (view.list === null) throw new Error('la lista non esiste');
  return view.list;
}

function itemNamed(items: ShoppingItemView[], name: string): ShoppingItemView {
  const found = items.find((item) => item.canonical_name === name);
  if (!found) throw new Error(`articolo assente: ${name}`);
  return found;
}

function summary(items: ShoppingItemView[]) {
  return items.map((item) => ({
    canonical_name: item.canonical_name,
    qty: item.qty,
    unit: item.unit,
    category: item.category,
  }));
}

/** Atteso per lo scenario 1 (e per la costruzione concorrente dello scenario 13). */
const SCENARIO_ONE_SUMMARY = [
  { canonical_name: 'cipolla', qty: 2, unit: 'pz', category: 'ortofrutta' },
  { canonical_name: 'petto di pollo', qty: 700, unit: 'g', category: 'macelleria' },
  { canonical_name: 'sale', qty: null, unit: 'qb', category: 'dispensa' },
];

async function expectShoppingError(promise: Promise<unknown>, code: ShoppingErrorCode): Promise<void> {
  const error = await promise.then(
    () => null,
    (err: unknown) => err
  );
  expect(error).toBeInstanceOf(ShoppingError);
  expect((error as ShoppingError).code).toBe(code);
}

describe.skipIf(!dbUp)('lista della spesa: servizio', () => {
  let createdHouseholdIds: string[] = [];
  let createdAliases: string[] = [];

  beforeAll(async () => {
    await assertDbMigrated();
  });

  afterEach(async () => {
    for (const id of createdHouseholdIds) {
      await deleteTestHousehold(id);
    }
    createdHouseholdIds = [];
    for (const alias of createdAliases) {
      await db.delete(ingredient_aliases).where(eq(ingredient_aliases.alias, alias));
    }
    createdAliases = [];
  });

  async function newHousehold(): Promise<string> {
    const id = await createTestHousehold();
    createdHouseholdIds.push(id);
    return id;
  }

  /** Piano con slot (pasto cena, porzioni indicate); `activate` lo rende confermato. */
  async function createPlan(
    householdId: string,
    weekStart: string,
    slots: { day: string; recipeId: string; servings: number }[],
    activate: boolean
  ): Promise<string> {
    const plan = await insertPlan(db, householdId, weekStart);
    await insertSlots(
      db,
      plan.id,
      slots.map(
        (slot): NewSlotInput => ({
          day: slot.day,
          meal: 'cena',
          course: 'piatto-unico',
          recipe_id: slot.recipeId,
          servings: slot.servings,
          locked: false,
        })
      )
    );
    if (activate) await activateDraftPlan(db, plan.id);
    return plan.id;
  }

  function activePlan(
    householdId: string,
    weekStart: string,
    slots: { day: string; recipeId: string; servings: number }[]
  ): Promise<string> {
    return createPlan(householdId, weekStart, slots, true);
  }

  /**
   * Scenario 1: A (petto di pollo 200 g, sale qb) il mercoledì; B (petto di pollo 150 g,
   * cipolla 1 pz) il giovedì; entrambi 4 porzioni su ricette da 2.
   */
  async function scenarioOne(householdId: string) {
    const a = await insertTestRecipe(householdId, {
      meal_types: ['cena'],
      ingredients: [ing('petto di pollo', 200, 'g', 'macelleria'), ing('sale', null, 'qb', 'dispensa')],
    });
    const b = await insertTestRecipe(householdId, {
      meal_types: ['cena'],
      ingredients: [ing('petto di pollo', 150, 'g', 'macelleria'), ing('cipolla', 1, 'pz', 'ortofrutta')],
    });
    const planId = await activePlan(householdId, WEEK, [
      { day: DAY_WED, recipeId: a.id, servings: 4 },
      { day: DAY_THU, recipeId: b.id, servings: 4 },
    ]);
    return { planId, a, b };
  }

  it('crea la lista dal piano confermato con quantità, reparti e ricette', async () => {
    const householdId = await newHousehold();
    const { planId, a, b } = await scenarioOne(householdId);

    const view = await buildPlanShoppingList(planId, at(householdId, WED));

    const list = requireList(view);
    expect(summary(list.items)).toEqual(SCENARIO_ONE_SUMMARY);
    for (const item of list.items) {
      expect(item).toMatchObject({ checked: false, manual: false });
    }
    expect(itemNamed(list.items, 'petto di pollo').recipe_ids).toEqual([a.id, b.id].sort());
    expect(list.needs_regeneration).toBe(false);
    expect(view.plan.has_list).toBe(true);
    expect(view.can_build).toBe(true);
    expect(view.editable).toBe(true);
    expect(list.recipes).toHaveLength(2);
    expect(list.recipes).toEqual(
      expect.arrayContaining([
        { id: a.id, title: a.title },
        { id: b.id, title: b.title },
      ])
    );
  });

  it('esclude i pasti passati della settimana', async () => {
    const householdId = await newHousehold();
    const { planId } = await scenarioOne(householdId);
    const zucchini = await insertTestRecipe(householdId, {
      meal_types: ['cena'],
      ingredients: [ing('zucca', 500, 'g', 'ortofrutta')],
    });
    await insertSlots(db, planId, [
      { day: DAY_TUE_BEFORE, meal: 'cena', course: 'piatto-unico', recipe_id: zucchini.id, servings: 2, locked: false },
    ]);

    const list = requireList(await buildPlanShoppingList(planId, at(householdId, WED)));

    expect(list.items.some((item) => item.canonical_name === 'zucca')).toBe(false);
  });

  it('rifiuta la lista di una bozza e non la crea', async () => {
    const householdId = await newHousehold();
    const recipe = await insertTestRecipe(householdId, {
      meal_types: ['cena'],
      ingredients: [ing('petto di pollo', 200, 'g', 'macelleria')],
    });
    const planId = await createPlan(
      householdId,
      WEEK,
      [{ day: DAY_WED, recipeId: recipe.id, servings: 2 }],
      false
    );

    await expectShoppingError(
      buildPlanShoppingList(planId, at(householdId, WED)),
      'plan_not_confirmed'
    );
    expect(await findShoppingListByPlan(db, planId)).toBeNull();

    const view = await getPlanShoppingList(planId, at(householdId, WED));
    expect(view.list).toBeNull();
    expect(view.can_build).toBe(false);
    expect(view.editable).toBe(true);
  });

  it('blocca creazione e aggiornamento su un piano chiuso, ma lascia consultare la lista', async () => {
    const householdId = await newHousehold();
    const { planId } = await scenarioOne(householdId);
    await buildPlanShoppingList(planId, at(householdId, WED));

    await expectShoppingError(
      buildPlanShoppingList(planId, at(householdId, MON2)),
      'plan_archived'
    );

    const view = await getPlanShoppingList(planId, at(householdId, MON2));
    expect(view.editable).toBe(false);
    expect(view.can_build).toBe(false);
    expect(view.list).not.toBeNull();
  });

  it('nega piani di un altro household e id inesistenti', async () => {
    const owner = await newHousehold();
    const stranger = await newHousehold();
    const { planId } = await scenarioOne(owner);

    await expectShoppingError(getPlanShoppingList(planId, at(stranger, WED)), 'plan_not_found');
    await expectShoppingError(buildPlanShoppingList(planId, at(stranger, WED)), 'plan_not_found');
    await expectShoppingError(
      getPlanShoppingList(crypto.randomUUID(), at(owner, WED)),
      'plan_not_found'
    );
    await expectShoppingError(
      buildPlanShoppingList(crypto.randomUUID(), at(owner, WED)),
      'plan_not_found'
    );
  });

  it('aggiorna preservando spunte e articoli a mano, e azzera needs_regeneration', async () => {
    const householdId = await newHousehold();
    const { planId } = await scenarioOne(householdId);
    const first = requireList(await buildPlanShoppingList(planId, at(householdId, WED)));
    const petto = itemNamed(first.items, 'petto di pollo');
    const sale = itemNamed(first.items, 'sale');
    await checkShoppingItem(petto.id, true, at(householdId, WED));
    await checkShoppingItem(sale.id, true, at(householdId, WED));
    const { item: latte } = await addManualShoppingItem(planId, 'latte', at(householdId, WED));
    await checkShoppingItem(latte.id, true, at(householdId, WED));

    const plan = await getPlanById(db, planId);
    const slotOfB = plan!.slots.find((slot) => slot.day === DAY_THU);
    const d = await insertTestRecipe(householdId, {
      meal_types: ['cena'],
      ingredients: [ing('petto di pollo', 400, 'g', 'macelleria')],
    });
    await updateSlotRecipe(db, slotOfB!.id, d.id);
    await markShoppingListStale(db, planId);

    const stale = await getPlanShoppingList(planId, at(householdId, WED));
    expect(requireList(stale).needs_regeneration).toBe(true);

    const rebuilt = requireList(await buildPlanShoppingList(planId, at(householdId, WED)));
    const petto2 = itemNamed(rebuilt.items, 'petto di pollo');
    expect(petto2).toMatchObject({ id: petto.id, qty: 1200, unit: 'g', checked: false });
    expect(itemNamed(rebuilt.items, 'sale')).toMatchObject({ id: sale.id, checked: true });
    expect(rebuilt.items.some((item) => item.canonical_name === 'cipolla')).toBe(false);
    expect(itemNamed(rebuilt.items, 'latte')).toMatchObject({
      id: latte.id,
      manual: true,
      checked: true,
    });
    expect(rebuilt.needs_regeneration).toBe(false);
  });

  it('conserva la spunta se la quantità non aumenta', async () => {
    const householdId = await newHousehold();
    const { planId } = await scenarioOne(householdId);
    const first = requireList(await buildPlanShoppingList(planId, at(householdId, WED)));
    const petto = itemNamed(first.items, 'petto di pollo');
    await checkShoppingItem(petto.id, true, at(householdId, WED));

    const plan = await getPlanById(db, planId);
    const slotOfA = plan!.slots.find((slot) => slot.day === DAY_WED);
    await updateSlotsServings(db, [slotOfA!.id], 2);

    const rebuilt = requireList(await buildPlanShoppingList(planId, at(householdId, WED)));
    expect(itemNamed(rebuilt.items, 'petto di pollo')).toMatchObject({
      id: petto.id,
      qty: 500,
      checked: true,
    });
  });

  it('risolve gli alias in un solo passo e somma sotto il nome canonico', async () => {
    const householdId = await newHousehold();
    const suffix = crypto.randomUUID();
    const alias = `alias-test-${suffix}`;
    const canonical = `canonico-test-${suffix}`;
    await db.insert(ingredient_aliases).values({ alias, canonical_name: canonical });
    createdAliases.push(alias);
    const withAlias = await insertTestRecipe(householdId, {
      meal_types: ['cena'],
      ingredients: [ing(alias, 100, 'g', 'dispensa')],
    });
    const withCanonical = await insertTestRecipe(householdId, {
      meal_types: ['cena'],
      ingredients: [ing(canonical, 100, 'g', 'dispensa')],
    });
    const planId = await activePlan(householdId, WEEK, [
      { day: DAY_WED, recipeId: withAlias.id, servings: 2 },
      { day: DAY_THU, recipeId: withCanonical.id, servings: 2 },
    ]);

    const list = requireList(await buildPlanShoppingList(planId, at(householdId, WED)));

    expect(summary(list.items)).toEqual([
      { canonical_name: canonical, qty: 200, unit: 'g', category: 'dispensa' },
    ]);
  });

  it('spunta e toglie la spunta di un articolo, con i controlli di appartenenza e stato', async () => {
    const householdId = await newHousehold();
    const { planId } = await scenarioOne(householdId);
    const list = requireList(await buildPlanShoppingList(planId, at(householdId, WED)));
    const sale = itemNamed(list.items, 'sale');

    const checked = await checkShoppingItem(sale.id, true, at(householdId, WED));
    expect(checked).toMatchObject({ id: sale.id, checked: true });
    const reread = requireList(await getPlanShoppingList(planId, at(householdId, WED)));
    expect(itemNamed(reread.items, 'sale').checked).toBe(true);

    const unchecked = await checkShoppingItem(sale.id, false, at(householdId, WED));
    expect(unchecked.checked).toBe(false);

    await expectShoppingError(
      checkShoppingItem(crypto.randomUUID(), true, at(householdId, WED)),
      'item_not_found'
    );

    const stranger = await newHousehold();
    await expectShoppingError(
      checkShoppingItem(sale.id, true, at(stranger, WED)),
      'item_not_found'
    );

    await expectShoppingError(checkShoppingItem(sale.id, true, at(householdId, MON2)), 'plan_archived');
  });

  it('aggiunge un articolo a mano con reparto dalla libreria, idempotente sul nome', async () => {
    const householdId = await newHousehold();
    const libraryRecipe = await insertTestRecipe(householdId, {
      meal_types: ['cena'],
      ingredients: [ing('latte intero', 200, 'ml', 'banco-frigo'), ing('sale', null, 'qb', 'dispensa')],
    });
    const planId = await activePlan(householdId, WEEK, [
      { day: DAY_WED, recipeId: libraryRecipe.id, servings: 2 },
    ]);
    await buildPlanShoppingList(planId, at(householdId, WED));

    const created = await addManualShoppingItem(planId, '  Latte   Intero ', at(householdId, WED));
    expect(created.created).toBe(true);
    expect(created.item).toMatchObject({
      canonical_name: 'latte intero',
      category: 'banco-frigo',
      manual: true,
      unit: null,
      qty: null,
      recipe_ids: [],
    });

    const again = await addManualShoppingItem(planId, 'latte intero', at(householdId, WED));
    expect(again.created).toBe(false);
    expect(again.item.id).toBe(created.item.id);

    const unknown = await addManualShoppingItem(planId, 'zafferano misterioso', at(householdId, WED));
    expect(unknown.item.category).toBe('altro');
  });

  it('rifiuta aggiunte senza lista, su piani chiusi e di altri household', async () => {
    const householdId = await newHousehold();
    const recipe = await insertTestRecipe(householdId, {
      meal_types: ['cena'],
      ingredients: [ing('sale', null, 'qb', 'dispensa')],
    });
    const planId = await activePlan(householdId, WEEK, [
      { day: DAY_WED, recipeId: recipe.id, servings: 2 },
    ]);

    await expectShoppingError(addManualShoppingItem(planId, 'carta forno', at(householdId, WED)), 'list_not_found');

    await buildPlanShoppingList(planId, at(householdId, WED));
    await expectShoppingError(addManualShoppingItem(planId, 'carta forno', at(householdId, MON2)), 'plan_archived');

    const stranger = await newHousehold();
    await expectShoppingError(
      addManualShoppingItem(planId, 'carta forno', at(stranger, WED)),
      'plan_not_found'
    );
  });

  it('rimuove solo gli articoli aggiunti a mano', async () => {
    const householdId = await newHousehold();
    const { planId } = await scenarioOne(householdId);
    const list = requireList(await buildPlanShoppingList(planId, at(householdId, WED)));
    const { item: added } = await addManualShoppingItem(planId, 'carta forno', at(householdId, WED));

    const removedId = await removeManualShoppingItem(added.id, at(householdId, WED));
    expect(removedId).toBe(added.id);
    const afterRemoval = requireList(await getPlanShoppingList(planId, at(householdId, WED)));
    expect(afterRemoval.items.some((item) => item.id === added.id)).toBe(false);

    const sale = itemNamed(list.items, 'sale');
    await expectShoppingError(
      removeManualShoppingItem(sale.id, at(householdId, WED)),
      'item_not_manual'
    );
    const stillThere = requireList(await getPlanShoppingList(planId, at(householdId, WED)));
    expect(itemNamed(stillThere.items, 'sale').id).toBe(sale.id);

    await expectShoppingError(
      removeManualShoppingItem(crypto.randomUUID(), at(householdId, WED)),
      'item_not_found'
    );
  });

  it('sceglie il piano da mostrare nella schermata Lista', async () => {
    const empty = await newHousehold();
    expect(await getShoppingScreen(at(empty, WED))).toEqual({ plans: [], selected: null });

    const householdId = await newHousehold();
    const recipe = await insertTestRecipe(householdId, {
      meal_types: ['cena'],
      ingredients: [ing('sale', null, 'qb', 'dispensa')],
    });
    const confirmedWithoutList = await activePlan(householdId, WEEK, [
      { day: DAY_WED, recipeId: recipe.id, servings: 2 },
    ]);
    const onlyPlan = await getShoppingScreen(at(householdId, WED));
    expect(onlyPlan.plans).toEqual([
      expect.objectContaining({ id: confirmedWithoutList, has_list: false }),
    ]);
    expect(onlyPlan.selected?.plan.id).toBe(confirmedWithoutList);
    expect(onlyPlan.selected?.list).toBeNull();
  });

  it('sceglie il piano con lista più avanti e rispetta planId solo se valido e proprio', async () => {
    const householdId = await newHousehold();
    const recipe = await insertTestRecipe(householdId, {
      meal_types: ['cena'],
      ingredients: [ing('sale', null, 'qb', 'dispensa')],
    });
    const current = await activePlan(householdId, WEEK, [
      { day: '2026-10-03', recipeId: recipe.id, servings: 2 },
    ]);
    const next = await activePlan(householdId, NEXT_WEEK, [
      { day: '2026-10-05', recipeId: recipe.id, servings: 2 },
    ]);
    await buildPlanShoppingList(current, at(householdId, SAT));

    const beforeNextList = await getShoppingScreen(at(householdId, SAT));
    expect(beforeNextList.plans.map((plan) => plan.id)).toEqual([current, next]);
    expect(beforeNextList.plans.map((plan) => plan.has_list)).toEqual([true, false]);
    expect(beforeNextList.selected?.plan.id).toBe(current);

    await buildPlanShoppingList(next, at(householdId, SAT));
    const afterNextList = await getShoppingScreen(at(householdId, SAT));
    expect(afterNextList.selected?.plan.id).toBe(next);
  });

  it('mostra la bozza richiesta senza inserirla tra i piani selezionabili', async () => {
    const householdId = await newHousehold();
    const recipe = await insertTestRecipe(householdId, {
      meal_types: ['cena'],
      ingredients: [ing('sale', null, 'qb', 'dispensa')],
    });
    const draftId = await createPlan(
      householdId,
      NEXT_WEEK,
      [{ day: '2026-10-05', recipeId: recipe.id, servings: 2 }],
      false
    );
    const confirmedId = await activePlan(householdId, WEEK, [
      { day: DAY_WED, recipeId: recipe.id, servings: 2 },
    ]);

    const screen = await getShoppingScreen({ ...at(householdId, WED), planId: draftId });

    expect(screen.selected?.plan.id).toBe(draftId);
    expect(screen.selected?.can_build).toBe(false);
    expect(screen.plans.map((plan) => plan.id)).toEqual([confirmedId]);
  });

  it('ignora planId non valido o inesistente e non mostra piani già conclusi', async () => {
    const householdId = await newHousehold();
    const recipe = await insertTestRecipe(householdId, {
      meal_types: ['cena'],
      ingredients: [ing('sale', null, 'qb', 'dispensa')],
    });
    const confirmedId = await activePlan(householdId, WEEK, [
      { day: DAY_WED, recipeId: recipe.id, servings: 2 },
    ]);
    const oldId = await activePlan(householdId, '2026-09-21', [
      { day: '2026-09-22', recipeId: recipe.id, servings: 2 },
    ]);
    const baseline = await getShoppingScreen(at(householdId, WED));

    expect(await getShoppingScreen({ ...at(householdId, WED), planId: 'abc' })).toEqual(baseline);
    expect(
      await getShoppingScreen({ ...at(householdId, WED), planId: crypto.randomUUID() })
    ).toEqual(baseline);
    expect(baseline.plans.map((plan) => plan.id)).toEqual([confirmedId]);
    expect(baseline.plans.map((plan) => plan.id)).not.toContain(oldId);
  });

  it('non fallisce con due costruzioni concorrenti e non crea doppioni', async () => {
    const householdId = await newHousehold();
    const { planId } = await scenarioOne(householdId);

    const [first, second] = await Promise.all([
      buildPlanShoppingList(planId, at(householdId, WED)),
      buildPlanShoppingList(planId, at(householdId, WED)),
    ]);

    const items = requireList(second).items;
    expect(summary(items)).toEqual(SCENARIO_ONE_SUMMARY);
    expect(new Set(items.map((item) => item.id)).size).toBe(items.length);
    expect(requireList(first).items).toHaveLength(items.length);
    expect(await findShoppingListByPlan(db, planId)).not.toBeNull();
  });

  it('non crea doppioni con due aggiunte a mano sovrapposte dello stesso nome', async () => {
    const householdId = await newHousehold();
    const { planId } = await scenarioOne(householdId);
    await buildPlanShoppingList(planId, at(householdId, WED));
    // Pool caldo: a connessioni fredde la sovrapposizione può non riprodursi.
    await db.execute(sql`select 1`);

    for (const name of ['carta forno', 'spago da cucina', 'ghiaccio secco']) {
      const [first, second] = await Promise.all([
        addManualShoppingItem(planId, name, at(householdId, WED)),
        addManualShoppingItem(planId, name, at(householdId, WED)),
      ]);

      expect(second.item.id).toBe(first.item.id);
      expect([first.created, second.created].filter(Boolean)).toHaveLength(1);
      const rows = requireList(await getPlanShoppingList(planId, at(householdId, WED))).items.filter(
        (item) => item.manual && item.canonical_name === name
      );
      expect(rows).toHaveLength(1);
    }
  });
});
