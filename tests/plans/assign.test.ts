// @vitest-environment node

import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { db, plan_slots, shopping_lists } from '@/lib/db';
import { getPlanById } from '@/lib/db/repositories/plan-repo';
import { loadHousehold, updateHousehold } from '@/lib/db/repositories/household-repo';
import { upsertIngredientPref } from '@/lib/db/repositories/ingredient-pref-repo';
import { getRecipeById } from '@/lib/db/repositories/recipe-repo';
import { createRng } from '@/lib/domain/rng';
import { SlotCandidatesSchema, type PlanView } from '@/lib/domain/types';
import {
  assignSlotRecipe,
  confirmPlan,
  generatePlan,
  listSlotCandidates,
  setSlotLock,
  toPlanView,
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

const WED = () => new Date('2026-09-30T10:00:00Z'); // settimana 28/09, dal 30/09: 5 giorni
const FRI_AFTER_FIRST_SLOT = () => new Date('2026-10-02T10:00:00Z'); // il 30/09 è passato
const MON2 = () => new Date('2026-10-05T08:00:00Z'); // lunedì dopo la settimana 28/09

const DB_TEST_TIMEOUT_MS = 30_000; // setup multi-household sotto carico parallelo

const dbUp = await isDbAvailable();

describe.skipIf(!dbUp)('Scelta a mano di una ricetta', { timeout: DB_TEST_TIMEOUT_MS }, () => {
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

  /** `generate` che non crea nulla: il piano usa solo la libreria del test. */
  function emptyGenerate() {
    return vi.fn<GenerateRecipesFn>(async (input: GenerateAndStoreInput) => ({
      requested: input.count,
      created: [],
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

  /**
   * Household con sole cene, dieta vegetariana (senza frullatore). Dodici ricette nella
   * libreria prima del piano, poi le ricette che devono risultare escluse o speciali.
   */
  async function scenario() {
    const householdId = await createTestHousehold({
      meals: ['cena'],
      diet_tags: ['vegetariano'],
    });
    createdHouseholdIds.push(householdId);
    await insertTestRecipes(householdId, 12, {
      meal_types: ['cena'],
      diet_flags: ['vegetariano'],
    });

    const { screen } = await generatePlan(opts(householdId, WED, emptyGenerate()));
    const plan = screen.view.plan;
    if (!plan) throw new Error('piano non creato');
    expect(plan.slots).toHaveLength(5);

    const cena = { meal_types: ['cena' as const], diet_flags: ['vegetariano' as const] };
    const recipes = {
      blocked: await insertTestRecipe(householdId, { ...cena, prefs: { blocked: true } }),
      lunch: await insertTestRecipe(householdId, {
        meal_types: ['pranzo'],
        diet_flags: ['vegetariano'],
      }),
      meat: await insertTestRecipe(householdId, { meal_types: ['cena'], diet_flags: [] }),
      blender: await insertTestRecipe(householdId, {
        ...cena,
        appliances_required: ['frullatore'],
      }),
      onion: await insertTestRecipe(householdId, {
        ...cena,
        ingredients: [
          {
            canonical_name: 'cipolla',
            display_name: 'cipolla',
            qty: null,
            unit: 'qb',
            category: 'ortofrutta',
          },
        ],
      }),
      favorite: await insertTestRecipe(householdId, { ...cena, prefs: { favorite: true } }),
    };
    await upsertIngredientPref(db, householdId, 'cipolla', 'dislike');

    return { householdId, plan, recipes };
  }

  /** Piano riletto dal DB nella forma della risposta, per le asserzioni sullo stato finale. */
  async function readPlan(planId: string, householdId: string): Promise<PlanView> {
    const plan = await getPlanById(db, planId);
    if (!plan) throw new Error(`piano ${planId} non trovato`);
    return toPlanView(plan, await loadHousehold(householdId));
  }

  const slotRecipeId = (plan: PlanView, slotId: string): string | null =>
    plan.slots.find((slot) => slot.id === slotId)?.recipe?.id ?? null;

  const recipeIdsOf = (plan: PlanView): (string | null)[] =>
    plan.slots.map((slot) => slot.recipe?.id ?? null);

  /** Id dei pasti dello stesso piano diversi dallo slot dato. */
  const otherSlotRecipeIds = (plan: PlanView, slotId: string): string[] =>
    plan.slots
      .filter((slot) => slot.id !== slotId)
      .map((slot) => slot.recipe!.id);

  describe('listSlotCandidates', () => {
    it('lists only the eligible recipes, keeps disliked ingredients and skips the slot recipe', async () => {
      const { householdId, plan, recipes } = await scenario();
      const slot = plan.slots[0];
      const generate = neverGenerate();

      const result = await listSlotCandidates(plan.id, slot.id, opts(householdId, WED, generate));

      const ids = result.recipes.map((card) => card.id);
      expect(ids).not.toContain(recipes.blocked.id);
      expect(ids).not.toContain(recipes.lunch.id);
      expect(ids).not.toContain(recipes.meat.id);
      expect(ids).not.toContain(recipes.blender.id);
      expect(ids).not.toContain(slot.recipe!.id);
      expect(ids).toContain(recipes.onion.id);
      expect(ids).toContain(recipes.favorite.id);
      for (const otherId of otherSlotRecipeIds(plan, slot.id)) {
        expect(ids).toContain(otherId);
      }
      expect(generate).not.toHaveBeenCalled();

      // Boundary con il client: la risposta del servizio è valida per lo schema condiviso.
      expect(() => SlotCandidatesSchema.parse(JSON.parse(JSON.stringify(result)))).not.toThrow();
    });

    it('puts the favorite recipe first, in the order of the library', async () => {
      const { householdId, plan, recipes } = await scenario();

      const result = await listSlotCandidates(
        plan.id,
        plan.slots[0].id,
        opts(householdId, WED)
      );

      expect(result.recipes[0].id).toBe(recipes.favorite.id);
      expect(result.recipes[0].favorite).toBe(true);
    });

    it('returns in_plan_recipe_ids with the other slots recipes only, without the slot recipe', async () => {
      const { householdId, plan } = await scenario();
      const slot = plan.slots[0];

      const result = await listSlotCandidates(plan.id, slot.id, opts(householdId, WED));

      expect([...result.in_plan_recipe_ids].sort()).toEqual(
        otherSlotRecipeIds(plan, slot.id).sort()
      );
      expect(result.in_plan_recipe_ids).not.toContain(slot.recipe!.id);
    });

    it('rejects a plan of another household, an unknown plan and an unknown slot', async () => {
      const { householdId, plan } = await scenario();
      const otherHouseholdId = await createTestHousehold();
      createdHouseholdIds.push(otherHouseholdId);
      const slot = plan.slots[0];

      await expect(
        listSlotCandidates(plan.id, slot.id, opts(otherHouseholdId, WED))
      ).rejects.toMatchObject({ code: 'plan_not_found' });
      await expect(
        listSlotCandidates(crypto.randomUUID(), slot.id, opts(householdId, WED))
      ).rejects.toMatchObject({ code: 'plan_not_found' });
      await expect(
        listSlotCandidates(plan.id, crypto.randomUUID(), opts(householdId, WED))
      ).rejects.toMatchObject({ code: 'slot_not_found' });
    });

    it('rejects a locked slot, a past slot and an archived plan', async () => {
      const { householdId, plan } = await scenario();
      const slot = plan.slots[0];

      await setSlotLock(plan.id, slot.id, true, opts(householdId, WED));
      await expect(
        listSlotCandidates(plan.id, slot.id, opts(householdId, WED))
      ).rejects.toMatchObject({ code: 'slot_locked' });
      await setSlotLock(plan.id, slot.id, false, opts(householdId, WED));

      await expect(
        listSlotCandidates(plan.id, slot.id, opts(householdId, FRI_AFTER_FIRST_SLOT))
      ).rejects.toMatchObject({ code: 'slot_past' });

      await expect(
        listSlotCandidates(plan.id, slot.id, opts(householdId, MON2))
      ).rejects.toMatchObject({ code: 'plan_archived' });
    });

    it('leaves out side-dish-only recipes and keeps the main courses of the same diet', async () => {
      const { householdId, plan } = await scenario();
      const slot = plan.slots[0];
      const vegetarianCena = { meal_types: ['cena' as const], diet_flags: ['vegetariano' as const] };
      const sideDish = await insertTestRecipe(householdId, { ...vegetarianCena, courses: ['contorno'] });
      const mainCourse = await insertTestRecipe(householdId, { ...vegetarianCena, courses: ['secondo'] });

      const result = await listSlotCandidates(plan.id, slot.id, opts(householdId, WED));

      const ids = result.recipes.map((card) => card.id);
      expect(ids).not.toContain(sideDish.id);
      expect(ids).toContain(mainCourse.id);
    });

    it('lists the candidates of a slot without recipe, with no error', async () => {
      const { householdId, plan } = await scenario();
      const slot = plan.slots[0];
      await db.update(plan_slots).set({ recipe_id: null }).where(eq(plan_slots.id, slot.id));

      const result = await listSlotCandidates(plan.id, slot.id, opts(householdId, WED));

      expect(result.recipes.length).toBeGreaterThan(0);
      expect([...result.in_plan_recipe_ids].sort()).toEqual(
        otherSlotRecipeIds(plan, slot.id).sort()
      );
    });
  });

  describe('assignSlotRecipe', () => {
    it('puts the chosen recipe in the slot on a draft plan, leaving other slots and usage untouched', async () => {
      const { householdId, plan, recipes } = await scenario();
      const slot = plan.slots[0];
      const before = recipeIdsOf(plan);
      const generate = neverGenerate();

      const result = await assignSlotRecipe(
        plan.id,
        slot.id,
        recipes.favorite.id,
        opts(householdId, WED, generate)
      );

      expect(slotRecipeId(result.plan, slot.id)).toBe(recipes.favorite.id);
      const after = recipeIdsOf(result.plan);
      expect(after.slice(1)).toEqual(before.slice(1));
      expect(generate).not.toHaveBeenCalled();
      expect((await getRecipeById(recipes.favorite.id))!.prefs?.times_used ?? 0).toBe(0);
    });

    it('on a confirmed plan with a shopping list counts the usage and flags the list', async () => {
      const { householdId, plan, recipes } = await scenario();
      await confirmPlan(plan.id, opts(householdId, WED));
      await db.insert(shopping_lists).values({ plan_id: plan.id });
      const slot = plan.slots[0];

      const result = await assignSlotRecipe(
        plan.id,
        slot.id,
        recipes.favorite.id,
        opts(householdId, WED)
      );

      expect(result.plan.status).toBe('active');
      expect(result.plan.shopping_list).toEqual({ exists: true, needs_regeneration: true });
      const fresh = (await getRecipeById(recipes.favorite.id))!;
      expect(fresh.prefs?.times_used).toBe(1);
      expect(fresh.prefs?.last_used_at?.toISOString()).toBe(`${slot.day}T12:00:00.000Z`);
    });

    it('accepts a recipe with a disliked ingredient', async () => {
      const { householdId, plan, recipes } = await scenario();
      const slot = plan.slots[0];

      const result = await assignSlotRecipe(
        plan.id,
        slot.id,
        recipes.onion.id,
        opts(householdId, WED)
      );

      expect(slotRecipeId(result.plan, slot.id)).toBe(recipes.onion.id);
    });

    it('accepts a recipe already present in another slot, giving two slots the same recipe', async () => {
      const { householdId, plan } = await scenario();
      const [first, second] = plan.slots;
      const sharedId = second.recipe!.id;

      const result = await assignSlotRecipe(plan.id, first.id, sharedId, opts(householdId, WED));

      expect(slotRecipeId(result.plan, first.id)).toBe(sharedId);
      expect(slotRecipeId(result.plan, second.id)).toBe(sharedId);
    });

    it('rejects an unknown recipe and a recipe of another household, leaving the slot unchanged', async () => {
      const { householdId, plan } = await scenario();
      const otherHouseholdId = await createTestHousehold({ meals: ['cena'] });
      createdHouseholdIds.push(otherHouseholdId);
      const foreign = await insertTestRecipe(otherHouseholdId, {
        meal_types: ['cena'],
        diet_flags: ['vegetariano'],
      });
      const slot = plan.slots[0];
      const before = slot.recipe!.id;

      await expect(
        assignSlotRecipe(plan.id, slot.id, crypto.randomUUID(), opts(householdId, WED))
      ).rejects.toMatchObject({ code: 'recipe_not_found' });
      await expect(
        assignSlotRecipe(plan.id, slot.id, foreign.id, opts(householdId, WED))
      ).rejects.toMatchObject({ code: 'recipe_not_found' });

      expect(slotRecipeId(await readPlan(plan.id, householdId), slot.id)).toBe(before);
    });

    it('rejects blocked, other-meal, non-vegetarian and appliance-missing recipes, leaving the slot unchanged', async () => {
      const { householdId, plan, recipes } = await scenario();
      const slot = plan.slots[0];
      const before = slot.recipe!.id;

      for (const notEligible of [recipes.blocked, recipes.lunch, recipes.meat, recipes.blender]) {
        await expect(
          assignSlotRecipe(plan.id, slot.id, notEligible.id, opts(householdId, WED))
        ).rejects.toMatchObject({ code: 'recipe_not_eligible' });
      }

      expect(slotRecipeId(await readPlan(plan.id, householdId), slot.id)).toBe(before);
    });

    it('rejects a side-dish-only recipe with recipe_not_eligible, leaving the slot unchanged', async () => {
      const { householdId, plan } = await scenario();
      const slot = plan.slots[0];
      const before = slot.recipe!.id;
      const sideDish = await insertTestRecipe(householdId, {
        meal_types: ['cena'],
        diet_flags: ['vegetariano'],
        courses: ['contorno'],
      });

      await expect(
        assignSlotRecipe(plan.id, slot.id, sideDish.id, opts(householdId, WED))
      ).rejects.toMatchObject({ code: 'recipe_not_eligible' });

      expect(slotRecipeId(await readPlan(plan.id, householdId), slot.id)).toBe(before);
    });

    it('on a confirmed plan, a request for the recipe already in the slot writes nothing', async () => {
      const { householdId, plan } = await scenario();
      await confirmPlan(plan.id, opts(householdId, WED));
      await db.insert(shopping_lists).values({ plan_id: plan.id });
      const slot = plan.slots[0];
      const currentId = slot.recipe!.id;
      const usedBefore = (await getRecipeById(currentId))!.prefs?.times_used;

      const result = await assignSlotRecipe(plan.id, slot.id, currentId, opts(householdId, WED));

      expect(slotRecipeId(result.plan, slot.id)).toBe(currentId);
      expect(result.plan.shopping_list).toEqual({ exists: true, needs_regeneration: false });
      expect((await getRecipeById(currentId))!.prefs?.times_used).toBe(usedBefore);
    });

    it('rejects a locked slot, a past slot, an archived plan and unknown ids, leaving the slot unchanged', async () => {
      const { householdId, plan, recipes } = await scenario();
      const slot = plan.slots[0];
      const before = slot.recipe!.id;
      const other = await createTestHousehold();
      createdHouseholdIds.push(other);

      await setSlotLock(plan.id, slot.id, true, opts(householdId, WED));
      await expect(
        assignSlotRecipe(plan.id, slot.id, recipes.favorite.id, opts(householdId, WED))
      ).rejects.toMatchObject({ code: 'slot_locked' });
      await setSlotLock(plan.id, slot.id, false, opts(householdId, WED));

      await expect(
        assignSlotRecipe(plan.id, slot.id, recipes.favorite.id, opts(householdId, FRI_AFTER_FIRST_SLOT))
      ).rejects.toMatchObject({ code: 'slot_past' });

      await expect(
        assignSlotRecipe(plan.id, slot.id, recipes.favorite.id, opts(householdId, MON2))
      ).rejects.toMatchObject({ code: 'plan_archived' });

      await expect(
        assignSlotRecipe(plan.id, crypto.randomUUID(), recipes.favorite.id, opts(householdId, WED))
      ).rejects.toMatchObject({ code: 'slot_not_found' });

      await expect(
        assignSlotRecipe(crypto.randomUUID(), slot.id, recipes.favorite.id, opts(householdId, WED))
      ).rejects.toMatchObject({ code: 'plan_not_found' });

      await expect(
        assignSlotRecipe(plan.id, slot.id, recipes.favorite.id, opts(other, WED))
      ).rejects.toMatchObject({ code: 'plan_not_found' });

      expect(slotRecipeId(await readPlan(plan.id, householdId), slot.id)).toBe(before);
    });

    it('re-reads the household inside the lock: a recipe no longer fitting the diet is rejected', async () => {
      const { householdId, plan, recipes } = await scenario();
      const slot = plan.slots[0];
      await updateHousehold({ diet_tags: ['vegano'] }, householdId);

      await expect(
        assignSlotRecipe(plan.id, slot.id, recipes.favorite.id, opts(householdId, WED))
      ).rejects.toMatchObject({ code: 'recipe_not_eligible' });
    });

    it('serves two overlapping assignments of different recipes to the same slot, one wins', async () => {
      const { householdId, plan, recipes } = await scenario();
      const slot = plan.slots[0];
      const candidates = [recipes.favorite.id, recipes.onion.id];

      const results = await Promise.all(
        candidates.map((recipeId) =>
          assignSlotRecipe(plan.id, slot.id, recipeId, opts(householdId, WED))
        )
      );

      expect(results).toHaveLength(2);
      const final = await readPlan(plan.id, householdId);
      expect(candidates).toContain(slotRecipeId(final, slot.id));
    });
  });
});

