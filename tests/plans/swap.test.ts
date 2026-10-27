// @vitest-environment node

import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { db, shopping_lists } from '@/lib/db';
import {
  archivePlansBefore,
  findPlanByWeek,
  getPlanById,
  insertPlan,
} from '@/lib/db/repositories/plan-repo';
import { getRecipeById } from '@/lib/db/repositories/recipe-repo';
import { updateHousehold } from '@/lib/db/repositories/household-repo';
import { createRng } from '@/lib/domain/rng';
import type { MealType } from '@/lib/domain/types';
import { LlmError } from '@/lib/llm/errors';
import {
  confirmPlan,
  generatePlan,
  setSlotLock,
  swapSlot,
  type GenerateRecipesFn,
  type PlanServiceOptions,
} from '@/lib/plans/service';
import type { GenerateAndStoreInput } from '@/lib/recipes';
import {
  isDbAvailable,
  assertDbMigrated,
  createTestHousehold,
  deleteTestHousehold,
} from '@/tests/helpers/db';
import { insertTestRecipe, insertTestRecipes } from '@/tests/helpers/plans';

const MON = () => new Date('2026-09-28T08:00:00Z'); // settimana 28/09 completa
const WED = () => new Date('2026-09-30T10:00:00Z'); // settimana 28/09, dal 30/09: 5 giorni
const SAT = () => new Date('2026-10-03T09:00:00Z'); // obiettivo: settimana 05/10
const MON2 = () => new Date('2026-10-05T08:00:00Z'); // lunedì dopo SAT

const NO_EXCLUSIONS = { exclude_recipe_ids: [] as string[] };

const DB_TEST_TIMEOUT_MS = 30_000; // setup multi-household sotto carico parallelo

const dbUp = await isDbAvailable();

describe.skipIf(!dbUp)('swapSlot', { timeout: DB_TEST_TIMEOUT_MS }, () => {
  let createdHouseholdIds: string[] = [];

  beforeAll(async () => {
    await assertDbMigrated();
  });

  afterEach(async () => {
    for (const id of createdHouseholdIds) {
      await deleteTestHousehold(id);
    }
    createdHouseholdIds = [];
  });

  /** Household con solo cene e `recipes` ricette-cena in libreria. */
  async function dinnerHousehold(recipes: number): Promise<string> {
    const meals: MealType[] = ['cena'];
    const id = await createTestHousehold({ meals });
    createdHouseholdIds.push(id);
    await insertTestRecipes(id, recipes, { meal_types: ['cena'] });
    return id;
  }

  /** `generate` che non crea nulla: il piano usa solo la libreria del test. */
  function emptyGenerate() {
    return vi.fn<GenerateRecipesFn>(async (input: GenerateAndStoreInput) => ({
      requested: input.count,
      created: [],
      skipped: [],
    }));
  }

  function creatingGenerate() {
    return vi.fn<GenerateRecipesFn>(async (input: GenerateAndStoreInput) => ({
      requested: input.count,
      created: await insertTestRecipes(input.householdId!, input.count, {
        meal_types: [input.mealType ?? 'cena'],
      }),
      skipped: [],
    }));
  }

  function neverGenerate() {
    return vi
      .fn<GenerateRecipesFn>()
      .mockRejectedValue(new Error('generate non doveva essere chiamato'));
  }

  function opts(
    householdId: string,
    now: () => Date,
    generate: GenerateRecipesFn = neverGenerate()
  ): PlanServiceOptions {
    return { householdId, now, rng: createRng(1), generate };
  }

  async function createPlan(householdId: string, now: () => Date = WED) {
    const { screen } = await generatePlan(opts(householdId, now, emptyGenerate()));
    const plan = screen.view.plan;
    if (!plan) throw new Error('piano non creato');
    return plan;
  }

  const recipeIds = (plan: { slots: { recipe: { id: string } | null }[] }): string[] =>
    plan.slots.map((slot) => slot.recipe!.id);

  it('never proposes a recipe of the plan or an already discarded one across repeated swaps', async () => {
    const householdId = await dinnerHousehold(12);
    const plan = await createPlan(householdId);
    expect(plan.slots).toHaveLength(5);
    const target = plan.slots[0];
    const discarded = [target.recipe!.id];
    const generate = neverGenerate();

    for (let i = 0; i < 5; i++) {
      const result = await swapSlot(
        plan.id,
        target.id,
        { exclude_recipe_ids: [...discarded] },
        opts(householdId, WED, generate)
      );

      const swapped = result.plan.slots.find((s) => s.id === target.id)!.recipe!.id;
      const others = result.plan.slots.filter((s) => s.id !== target.id).map((s) => s.recipe!.id);
      expect(others).not.toContain(swapped);
      expect(discarded).not.toContain(swapped);
      expect(new Set(recipeIds(result.plan)).size).toBe(5);
      expect(result.generation).toEqual({ rounds: 0, created: 0, failed: false });
      discarded.push(swapped);
    }
    expect(generate).not.toHaveBeenCalled();
  });

  it('generates a batch when no alternative is left and picks one of the new recipes', async () => {
    const householdId = await dinnerHousehold(5);
    const plan = await createPlan(householdId);
    const generate = creatingGenerate();

    const result = await swapSlot(plan.id, plan.slots[2].id, NO_EXCLUSIONS, opts(householdId, WED, generate));

    expect(generate).toHaveBeenCalledTimes(1);
    expect(generate).toHaveBeenCalledWith({
      householdId,
      count: 3,
      mealType: 'cena',
      courses: ['piatto-unico'],
    });
    const createdIds = (await generate.mock.results[0].value).created.map((r: { id: string }) => r.id);
    const swapped = result.plan.slots.find((s) => s.id === plan.slots[2].id)!.recipe!.id;
    expect(createdIds).toContain(swapped);
    expect(result.generation).toEqual({ rounds: 1, created: 3, failed: false });
  });

  it('throws no_alternatives and leaves the slot untouched when generation yields nothing', async () => {
    const householdId = await dinnerHousehold(5);
    const plan = await createPlan(householdId);
    const slot = plan.slots[0];

    await expect(
      swapSlot(plan.id, slot.id, NO_EXCLUSIONS, opts(householdId, WED, emptyGenerate()))
    ).rejects.toMatchObject({ name: 'PlanError', code: 'no_alternatives' });

    const after = (await getPlanById(db, plan.id))!;
    expect(after.slots.find((s) => s.id === slot.id)!.recipe_id).toBe(slot.recipe!.id);
  });

  it('rethrows the LlmError when generation fails and no alternative is left', async () => {
    const householdId = await dinnerHousehold(5);
    const plan = await createPlan(householdId);
    const error = new LlmError('timeout', 'x');
    const generate = vi.fn<GenerateRecipesFn>().mockRejectedValue(error);

    await expect(
      swapSlot(plan.id, plan.slots[0].id, NO_EXCLUSIONS, opts(householdId, WED, generate))
    ).rejects.toBe(error);
  });

  it('rethrows a non-LLM error from generation as is', async () => {
    const householdId = await dinnerHousehold(5);
    const plan = await createPlan(householdId);
    const error = new Error('db');
    const generate = vi.fn<GenerateRecipesFn>().mockRejectedValue(error);

    await expect(
      swapSlot(plan.id, plan.slots[0].id, NO_EXCLUSIONS, opts(householdId, WED, generate))
    ).rejects.toBe(error);
  });

  it('never swaps in a side-dish-only recipe, and takes a free main course instead', async () => {
    // Piano di secondi: un contorno non entra mai in uno slot principale.
    const householdId = await createTestHousehold({
      meals: ['cena'],
      meal_compositions: { pranzo: ['piatto-unico'], cena: ['secondo'] },
    });
    createdHouseholdIds.push(householdId);
    await insertTestRecipes(householdId, 5, { meal_types: ['cena'], courses: ['secondo'] });
    const sideDish = await insertTestRecipe(householdId, { meal_types: ['cena'], courses: ['contorno'] });
    const plan = await createPlan(householdId);
    expect(recipeIds(plan)).not.toContain(sideDish.id);
    const slot = plan.slots[0];

    // Unica alternativa libera: il contorno. Niente da proporre, nessuna generazione.
    await expect(
      swapSlot(plan.id, slot.id, NO_EXCLUSIONS, opts(householdId, WED, emptyGenerate()))
    ).rejects.toMatchObject({ code: 'no_alternatives' });
    expect((await getPlanById(db, plan.id))!.slots.find((s) => s.id === slot.id)!.recipe_id).toBe(
      slot.recipe!.id
    );

    const mainCourse = await insertTestRecipe(householdId, { meal_types: ['cena'], courses: ['secondo'] });
    const result = await swapSlot(plan.id, slot.id, NO_EXCLUSIONS, opts(householdId, WED));

    expect(result.plan.slots.find((s) => s.id === slot.id)!.recipe!.id).toBe(mainCourse.id);
  });

  it('rejects locked slots, archived plans, unknown slots and foreign plans', async () => {
    const householdId = await dinnerHousehold(12);
    const otherHouseholdId = await dinnerHousehold(12);
    const plan = await createPlan(householdId);
    const slot = plan.slots[0];

    await setSlotLock(plan.id, slot.id, true, opts(householdId, WED));
    await expect(
      swapSlot(plan.id, slot.id, NO_EXCLUSIONS, opts(householdId, WED))
    ).rejects.toMatchObject({ code: 'slot_locked' });

    await expect(
      swapSlot(plan.id, crypto.randomUUID(), NO_EXCLUSIONS, opts(householdId, WED))
    ).rejects.toMatchObject({ code: 'slot_not_found' });

    await expect(
      swapSlot(plan.id, slot.id, NO_EXCLUSIONS, opts(otherHouseholdId, WED))
    ).rejects.toMatchObject({ code: 'plan_not_found' });
    await expect(
      swapSlot(crypto.randomUUID(), slot.id, NO_EXCLUSIONS, opts(householdId, WED))
    ).rejects.toMatchObject({ code: 'plan_not_found' });

    const archived = await insertPlan(db, householdId, '2026-09-14');
    await archivePlansBefore(db, householdId, '2026-09-28');
    await expect(
      swapSlot(archived.id, crypto.randomUUID(), NO_EXCLUSIONS, opts(householdId, WED))
    ).rejects.toMatchObject({ code: 'plan_archived' });
  });

  it('refuses to swap a slot of a past day, while still allowing to lock it', async () => {
    const householdId = await dinnerHousehold(12);
    const plan = await createPlan(householdId, MON);
    const pastSlot = plan.slots.find((s) => s.day === '2026-09-28')!;
    const todaySlot = plan.slots.find((s) => s.day === '2026-09-30')!;

    await expect(
      swapSlot(plan.id, pastSlot.id, NO_EXCLUSIONS, opts(householdId, WED))
    ).rejects.toMatchObject({ code: 'slot_past' });
    expect((await getPlanById(db, plan.id))!.slots.find((s) => s.id === pastSlot.id)!.recipe_id).toBe(
      pastSlot.recipe!.id
    );

    const locked = await setSlotLock(plan.id, pastSlot.id, true, opts(householdId, WED));
    expect(locked.plan.slots.find((s) => s.id === pastSlot.id)!.locked).toBe(true);

    const swapped = await swapSlot(plan.id, todaySlot.id, NO_EXCLUSIONS, opts(householdId, WED));
    expect(swapped.plan.slots.find((s) => s.id === todaySlot.id)!.recipe!.id).not.toBe(
      todaySlot.recipe!.id
    );
  });

  it('applies settings saved while the LLM is generating (household re-read inside the lock)', async () => {
    const householdId = await dinnerHousehold(5);
    const plan = await createPlan(householdId);
    const slot = plan.slots[0];

    let vegetarianId = '';
    const generate = vi.fn<GenerateRecipesFn>(async (input: GenerateAndStoreInput) => {
      await updateHousehold({ diet_tags: ['vegetariano'] }, householdId);
      const meat = await insertTestRecipes(householdId, 10, { meal_types: ['cena'] });
      const [veg] = await insertTestRecipes(householdId, 1, {
        meal_types: ['cena'],
        diet_flags: ['vegetariano'],
      });
      vegetarianId = veg.id;
      return { requested: input.count, created: [...meat, veg], skipped: [] };
    });

    const result = await swapSlot(plan.id, slot.id, NO_EXCLUSIONS, opts(householdId, WED, generate));

    expect(generate).toHaveBeenCalledTimes(1);
    expect(result.plan.slots.find((s) => s.id === slot.id)!.recipe!.id).toBe(vegetarianId);
  });

  it('on a confirmed plan counts the usage of the new recipe at the slot day, not of the replaced one', async () => {
    const householdId = await dinnerHousehold(12);
    const plan = await createPlan(householdId);
    await confirmPlan(plan.id, opts(householdId, WED));
    const slot = plan.slots[1];
    const replacedId = slot.recipe!.id;

    const result = await swapSlot(plan.id, slot.id, NO_EXCLUSIONS, opts(householdId, WED));

    expect(result.plan.status).toBe('active');
    const newId = result.plan.slots.find((s) => s.id === slot.id)!.recipe!.id;
    expect(newId).not.toBe(replacedId);
    const fresh = (await getRecipeById(newId))!;
    expect(fresh.prefs?.times_used).toBe(1);
    expect(fresh.prefs?.last_used_at?.toISOString()).toBe(`${slot.day}T12:00:00.000Z`);
    const replaced = (await getRecipeById(replacedId))!;
    expect(replaced.prefs?.times_used).toBe(1);
    expect(replaced.prefs?.last_used_at?.toISOString()).toBe(`${slot.day}T12:00:00.000Z`);
  });

  it('on a draft plan records no usage', async () => {
    const householdId = await dinnerHousehold(12);
    const plan = await createPlan(householdId);

    const result = await swapSlot(plan.id, plan.slots[0].id, NO_EXCLUSIONS, opts(householdId, WED));

    const newId = result.plan.slots.find((s) => s.id === plan.slots[0].id)!.recipe!.id;
    expect((await getRecipeById(newId))!.prefs?.times_used ?? 0).toBe(0);
  });

  it('creates no shopping list, and flags an existing one as needing regeneration', async () => {
    const householdId = await dinnerHousehold(12);
    const plan = await createPlan(householdId);

    const first = await swapSlot(plan.id, plan.slots[0].id, NO_EXCLUSIONS, opts(householdId, WED));
    expect(first.plan.shopping_list).toEqual({ exists: false, needs_regeneration: false });
    expect(await db.select().from(shopping_lists).where(eq(shopping_lists.plan_id, plan.id))).toHaveLength(0);

    await db.insert(shopping_lists).values({ plan_id: plan.id });
    const second = await swapSlot(plan.id, plan.slots[1].id, NO_EXCLUSIONS, opts(householdId, WED));
    expect(second.plan.shopping_list?.needs_regeneration).toBe(true);
  });

  it('two concurrent swaps with a single free candidate never assign the same recipe twice', async () => {
    const householdId = await dinnerHousehold(6);
    const plan = await createPlan(householdId);
    const generate = emptyGenerate();

    // Ogni swap scarta la ricetta dell'altro slot: l'unica candidata libera è la stessa per entrambi.
    const [first, second] = plan.slots;
    const results = await Promise.allSettled([
      swapSlot(
        plan.id,
        first.id,
        { exclude_recipe_ids: [second.recipe!.id] },
        opts(householdId, WED, generate)
      ),
      swapSlot(
        plan.id,
        second.id,
        { exclude_recipe_ids: [first.recipe!.id] },
        opts(householdId, WED, generate)
      ),
    ]);

    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
    expect(rejected.reason).toMatchObject({ code: 'no_alternatives' });
    const after = (await getPlanById(db, plan.id))!;
    const ids = after.slots.map((s) => s.recipe_id);
    expect(ids.every((id) => id !== null)).toBe(true);
    expect(new Set(ids).size).toBe(5);
  });

  it('keeps the previous week editable on weekends and closes it from the next Monday', async () => {
    const householdId = await dinnerHousehold(30);
    const weekPlan = await createPlan(householdId, WED);
    await generatePlan(opts(householdId, SAT, emptyGenerate()));
    expect((await findPlanByWeek(db, householdId, '2026-10-05'))!.status).toBe('draft');

    // Sabato: modificabili solo i pasti da oggi in poi (i giorni passati sono immutabili).
    const upcoming = weekPlan.slots.find((s) => s.day >= '2026-10-03')!;
    const onSaturday = await swapSlot(
      weekPlan.id,
      upcoming.id,
      NO_EXCLUSIONS,
      opts(householdId, SAT)
    );
    expect(onSaturday.plan.week_start).toBe('2026-09-28');

    await expect(
      swapSlot(weekPlan.id, weekPlan.slots[1].id, NO_EXCLUSIONS, opts(householdId, MON2))
    ).rejects.toMatchObject({ code: 'plan_archived' });
  });
});
