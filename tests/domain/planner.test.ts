// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { fixtureRecipesAsDomain } from '@/fixtures';
import {
  EMPTY_INGREDIENT_PREFERENCES,
  computeGenerationCount,
  exclusionReason,
  isFresh,
  manualChoiceExclusionReason,
  planGeneration,
  recipeWeight,
  selectRecipes,
  splitGenerationBatches,
  toIngredientPreferenceSets,
  weightedPick,
  type IngredientPreferenceSets,
  type MealTypeShortage,
  type PlannerContext,
  type PlannerInput,
  type PlannerSlot,
} from '@/lib/domain/planner';
import { PLANNER_CONFIG } from '@/lib/domain/planner-config';
import { createRng } from '@/lib/domain/rng';
import {
  DEFAULT_HOUSEHOLD,
  DEFAULT_HOUSEHOLD_ID,
  type Household,
  type Ingredient,
  type CourseFilter,
  type MealType,
  type Recipe,
  type RecipePref,
} from '@/lib/domain/types';
import { addDays } from '@/lib/domain/week';

const NOW = new Date('2026-09-30T12:00:00Z');
const MS_PER_DAY = 86_400_000;

let idCounter = 0;
function nextId(): string {
  idCounter += 1;
  return `00000000-0000-4000-8000-${String(idCounter).padStart(12, '0')}`;
}

function daysAgo(days: number): Date {
  return new Date(NOW.getTime() - days * MS_PER_DAY);
}

function makeIngredient(name: string): Ingredient {
  return { canonical_name: name, display_name: name, qty: null, unit: 'qb', category: 'dispensa' };
}

function makePrefs(recipeId: string, overrides: Partial<RecipePref> = {}): RecipePref {
  return {
    recipe_id: recipeId,
    rating: null,
    favorite: false,
    blocked: false,
    times_used: 0,
    last_used_at: null,
    ...overrides,
  };
}

function makeRecipe(overrides: Partial<Recipe> = {}): Recipe {
  const id = overrides.id ?? nextId();
  return {
    id,
    household_id: DEFAULT_HOUSEHOLD_ID,
    title: `Ricetta ${id.slice(-4)}`,
    slug: `ricetta-${id.slice(-4)}`,
    description: '',
    steps: ['Cuoci.'],
    meal_types: ['pranzo', 'cena'],
    courses: [],
    tags: [],
    diet_flags: [],
    appliances_required: [],
    servings_base: 2,
    prep_minutes: 20,
    kcal_est: null,
    macros_est: null,
    source: 'manual',
    created_at: new Date('2026-01-01T00:00:00Z'),
    ingredients: [makeIngredient('sale')],
    prefs: null,
    ...overrides,
  };
}

/** Ricetta con preferenze; `times_used: 1` di default per non attivare il bonus novità. */
function makeUsedRecipe(prefs: Partial<RecipePref> = {}, overrides: Partial<Recipe> = {}): Recipe {
  const id = overrides.id ?? nextId();
  return makeRecipe({ ...overrides, id, prefs: makePrefs(id, { times_used: 1, ...prefs }) });
}

function makeCtx(overrides: Partial<PlannerContext> = {}): PlannerContext {
  return {
    household: { diet_tags: [], appliances: ['fornelli', 'forno'] },
    ingredientPrefs: EMPTY_INGREDIENT_PREFERENCES,
    excludeRecipeIds: new Set<string>(),
    ...overrides,
  };
}

function makeInput(
  slots: PlannerSlot[],
  candidates: Recipe[],
  overrides: Partial<PlannerInput> = {}
): PlannerInput {
  return { ...makeCtx(), slots, candidates, now: NOW, rng: createRng(1), ...overrides };
}

function slotsFor(meal: MealType, count: number, course: CourseFilter = 'any-main'): PlannerSlot[] {
  return Array.from({ length: count }, (_, i) => {
    const day = addDays('2026-09-30', i);
    const key = course === 'any-main' ? `${day}|${meal}` : `${day}|${meal}|${course}`;
    return { key, day, meal, course };
  });
}

const NO_LIKES: ReadonlySet<string> = new Set();

describe('lib/domain/planner', () => {
  describe('1. exclusionReason', () => {
    it('returns exactly the reason for each rule', () => {
      const ctx = makeCtx({
        household: { diet_tags: ['vegetariano'], appliances: ['fornelli'] },
        ingredientPrefs: toIngredientPreferenceSets([], ['aglio']),
        excludeRecipeIds: new Set<string>(),
      });
      const blocked = makeUsedRecipe({ blocked: true });
      const wrongMeal = makeRecipe({ meal_types: ['cena'], diet_flags: ['vegetariano'] });
      const wrongDiet = makeRecipe({ diet_flags: [] });
      const wrongAppliance = makeRecipe({
        diet_flags: ['vegetariano'],
        appliances_required: ['forno'],
      });
      const disliked = makeRecipe({
        diet_flags: ['vegetariano'],
        ingredients: [makeIngredient('aglio')],
      });
      const excluded = makeRecipe({ diet_flags: ['vegetariano'] });
      const fine = makeRecipe({ diet_flags: ['vegetariano'] });
      const withExclusion = { ...ctx, excludeRecipeIds: new Set([excluded.id]) };

      expect(exclusionReason(blocked, 'pranzo', 'any-main', withExclusion)).toBe('blocked');
      expect(exclusionReason(wrongMeal, 'pranzo', 'any-main', withExclusion)).toBe('meal_type');
      expect(exclusionReason(wrongDiet, 'pranzo', 'any-main', withExclusion)).toBe('diet');
      expect(exclusionReason(wrongAppliance, 'pranzo', 'any-main', withExclusion)).toBe('appliance');
      expect(exclusionReason(disliked, 'pranzo', 'any-main', withExclusion)).toBe('disliked_ingredient');
      expect(exclusionReason(excluded, 'pranzo', 'any-main', withExclusion)).toBe('excluded');
      expect(exclusionReason(fine, 'pranzo', 'any-main', withExclusion)).toBeNull();
    });

    it('reports "blocked" first when blocked and wrong meal type coincide', () => {
      const recipe = makeUsedRecipe({ blocked: true }, { meal_types: ['cena'] });
      expect(exclusionReason(recipe, 'pranzo', 'any-main', makeCtx())).toBe('blocked');
    });

    it('admits a vegan recipe for a vegetarian household', () => {
      const ctx = makeCtx({ household: { diet_tags: ['vegetariano'], appliances: [] } });
      expect(exclusionReason(makeRecipe({ diet_flags: ['vegano'] }), 'cena', 'any-main', ctx)).toBeNull();
    });

    it('normalizes dislike entries (" Aglio " matches "aglio")', () => {
      const ctx = makeCtx({ ingredientPrefs: toIngredientPreferenceSets([], [' Aglio '])});
      const recipe = makeRecipe({ ingredients: [makeIngredient('aglio')] });
      expect(exclusionReason(recipe, 'pranzo', 'any-main', ctx)).toBe('disliked_ingredient');
    });

    it('does not fail on a recipe without ingredients', () => {
      const ctx = makeCtx({ ingredientPrefs: toIngredientPreferenceSets([], ['aglio']) });
      expect(exclusionReason(makeRecipe({ ingredients: undefined }), 'pranzo', 'any-main', ctx)).toBeNull();
    });

    it('excludes a side-dish-only recipe with reason course, for both meals', () => {
      const sideDish = makeRecipe({ courses: ['contorno'], meal_types: ['pranzo', 'cena'] });
      expect(exclusionReason(sideDish, 'pranzo', 'any-main', makeCtx())).toBe('course');
      expect(exclusionReason(sideDish, 'cena', 'any-main', makeCtx())).toBe('course');
    });

    it('admits recipes with a main course, even together with a side dish, and unclassified ones', () => {
      const ctx = makeCtx();
      expect(exclusionReason(makeRecipe({ courses: ['secondo'] }), 'pranzo', 'any-main', ctx)).toBeNull();
      expect(exclusionReason(makeRecipe({ courses: ['secondo', 'contorno'] }), 'pranzo', 'any-main', ctx)).toBeNull();
      expect(exclusionReason(makeRecipe({ courses: ['piatto-unico'] }), 'pranzo', 'any-main', ctx)).toBeNull();
      expect(exclusionReason(makeRecipe({ courses: [] }), 'pranzo', 'any-main', ctx)).toBeNull();
    });

    it('reports "blocked" before "course" for a blocked side dish', () => {
      const recipe = makeUsedRecipe({ blocked: true }, { courses: ['contorno'] });
      expect(exclusionReason(recipe, 'pranzo', 'any-main', makeCtx())).toBe('blocked');
    });

    it('reports "meal_type" before "course" for a side dish of another meal', () => {
      const recipe = makeRecipe({ courses: ['contorno'], meal_types: ['cena'] });
      expect(exclusionReason(recipe, 'pranzo', 'any-main', makeCtx())).toBe('meal_type');
    });

    it('keeps the side dish out of manual choices too', () => {
      const household: Pick<Household, 'diet_tags' | 'appliances'> = {
        diet_tags: [],
        appliances: ['fornelli', 'forno'],
      };
      const sideDish = makeRecipe({ courses: ['contorno'], meal_types: ['cena'] });
      expect(manualChoiceExclusionReason(sideDish, 'cena', 'any-main', household)).toBe('course');
    });
  });

  describe('1c. course filter', () => {
    const HOUSEHOLD_PICK: Pick<Household, 'diet_tags' | 'appliances'> = {
      diet_tags: [],
      appliances: ['fornelli'],
    };

    it('admits a side dish only with the contorno filter', () => {
      const sideDish = makeRecipe({ courses: ['contorno'] });
      expect(exclusionReason(sideDish, 'pranzo', 'contorno', makeCtx())).toBeNull();
      expect(exclusionReason(sideDish, 'pranzo', 'primo', makeCtx())).toBe('course');
      expect(exclusionReason(sideDish, 'pranzo', 'any-main', makeCtx())).toBe('course');
    });

    it('rejects an unclassified recipe for the contorno filter', () => {
      expect(exclusionReason(makeRecipe({ courses: [] }), 'cena', 'contorno', makeCtx())).toBe('course');
    });

    it('admits a secondo + contorno recipe for the contorno filter', () => {
      const recipe = makeRecipe({ courses: ['secondo', 'contorno'] });
      expect(exclusionReason(recipe, 'cena', 'contorno', makeCtx())).toBeNull();
      expect(exclusionReason(recipe, 'cena', 'secondo', makeCtx())).toBeNull();
    });

    it('with the primo filter, rejects a secondo and admits a primo and an unclassified recipe', () => {
      expect(exclusionReason(makeRecipe({ courses: ['secondo'] }), 'pranzo', 'primo', makeCtx())).toBe('course');
      expect(exclusionReason(makeRecipe({ courses: ['primo'] }), 'pranzo', 'primo', makeCtx())).toBeNull();
      expect(exclusionReason(makeRecipe({ courses: [] }), 'pranzo', 'primo', makeCtx())).toBeNull();
    });

    it('reports "blocked" before "course" for a blocked recipe of the wrong course', () => {
      const recipe = makeUsedRecipe({ blocked: true }, { courses: ['secondo'] });
      expect(exclusionReason(recipe, 'pranzo', 'contorno', makeCtx())).toBe('blocked');
    });

    it('applies the course filter to manual choices too', () => {
      const recipe = makeRecipe({ courses: ['secondo'], meal_types: ['cena'] });
      expect(manualChoiceExclusionReason(recipe, 'cena', 'primo', HOUSEHOLD_PICK)).toBe('course');
      expect(manualChoiceExclusionReason(recipe, 'cena', 'secondo', HOUSEHOLD_PICK)).toBeNull();
    });
  });

  describe('1b. side dishes never make a meal', () => {
    it('leaves the slot empty and asks for more when the library holds only side dishes', () => {
      const candidates = Array.from({ length: 3 }, () => makeRecipe({ courses: ['contorno'] }));
      const result = selectRecipes(makeInput(slotsFor('cena', 1), candidates));

      expect(result.assignments).toEqual([{ key: slotsFor('cena', 1)[0].key, recipeId: null }]);
      expect(result.needMore).toEqual([
        {
          meal_type: 'cena',
          course: 'any-main',
          slots: 1,
          available: 0,
          required: 1 + PLANNER_CONFIG.minPoolSize - 1,
          unfilled: 1,
        },
      ]);
    });

    it('counts only main-course recipes as available (3 main courses, 20 side dishes => available 3)', () => {
      const mains = Array.from({ length: 3 }, () => makeRecipe({ courses: ['secondo'], meal_types: ['pranzo'] }));
      const sides = Array.from({ length: 20 }, () => makeRecipe({ courses: ['contorno'], meal_types: ['pranzo'] }));
      const sideIds = new Set(sides.map((r) => r.id));
      const result = selectRecipes(makeInput(slotsFor('pranzo', 5), [...mains, ...sides]));

      const filled = result.assignments.filter((a) => a.recipeId !== null);
      expect(filled).toHaveLength(3);
      expect(filled.some((a) => sideIds.has(a.recipeId!))).toBe(false);
      expect(result.needMore).toEqual([
        {
          meal_type: 'pranzo',
          course: 'any-main',
          slots: 5,
          available: 3,
          required: 5 + PLANNER_CONFIG.minPoolSize - 1,
          unfilled: 2,
        },
      ]);
    });
  });

  describe('2. recipeWeight', () => {
    it('combines all factors (rating 5, favorite, old use, 3 liked ingredients) into 2.925', () => {
      const recipe = makeUsedRecipe(
        { rating: 5, favorite: true, times_used: 3, last_used_at: daysAgo(40) },
        {
          ingredients: [makeIngredient('a'), makeIngredient('b'), makeIngredient('c')],
        }
      );
      const likes = new Set(['a', 'b', 'c']);
      expect(recipeWeight(recipe, likes, NOW)).toBeCloseTo(2.925, 6);
    });

    it('scales with rating (rating 1 => factor 0.5)', () => {
      expect(recipeWeight(makeUsedRecipe({ rating: 1 }), NO_LIKES, NOW)).toBeCloseTo(0.5, 6);
    });

    it('applies the recency floor below recencyMinDays (5 days => 0.15)', () => {
      const recipe = makeUsedRecipe({ last_used_at: daysAgo(5) });
      expect(recipeWeight(recipe, NO_LIKES, NOW)).toBeCloseTo(0.15, 6);
    });

    it('interpolates linearly between the floor and 1 (19 days => 0.575)', () => {
      const recipe = makeUsedRecipe({ last_used_at: daysAgo(19) });
      expect(recipeWeight(recipe, NO_LIKES, NOW)).toBeCloseTo(0.575, 6);
    });

    it('is full from recencyFullDays on (28 days => 1)', () => {
      const recipe = makeUsedRecipe({ last_used_at: daysAgo(28) });
      expect(recipeWeight(recipe, NO_LIKES, NOW)).toBeCloseTo(1, 6);
    });

    it('treats a future last_used_at as 0 days (floor weight)', () => {
      const recipe = makeUsedRecipe({ last_used_at: daysAgo(-3) });
      expect(recipeWeight(recipe, NO_LIKES, NOW)).toBeCloseTo(0.15, 6);
    });

    it('gives the novelty bonus to never-used recipes (1.2)', () => {
      expect(recipeWeight(makeRecipe(), NO_LIKES, NOW)).toBeCloseTo(1.2, 6);
    });

    it('does not pause favorites: used 2 days ago, weight is just the 1.5 boost', () => {
      const recipe = makeUsedRecipe({ favorite: true, last_used_at: daysAgo(2) });
      expect(recipeWeight(recipe, NO_LIKES, NOW)).toBeCloseTo(1.5, 6);
    });

    it('honours a lower favoriteRecencyFloor from config', () => {
      const recipe = makeUsedRecipe({ favorite: true, last_used_at: daysAgo(2) });
      const config = { ...PLANNER_CONFIG, favoriteRecencyFloor: 0.5 };
      expect(recipeWeight(recipe, NO_LIKES, NOW, config)).toBeCloseTo(1.5 * 0.5, 6);
    });

    it('caps the ingredient affinity at ingredientLikeMaxCount and counts distinct names once', () => {
      const recipe = makeUsedRecipe(
        {},
        { ingredients: [makeIngredient('a'), makeIngredient('A '), makeIngredient('b'), makeIngredient('c')] }
      );
      // distinti piaciuti: a, b, c => n = 3, ma il tetto è 2 => 1 + 0.15 * 2
      expect(recipeWeight(recipe, new Set(['a', 'b', 'c']), NOW)).toBeCloseTo(1.3, 6);
      // 'a' e 'A ' sono lo stesso nome => n = 1
      expect(recipeWeight(recipe, new Set(['a']), NOW)).toBeCloseTo(1.15, 6);
    });
  });

  describe('isFresh', () => {
    it('is true for never-used recipes', () => {
      expect(isFresh(makeRecipe(), NOW)).toBe(true);
    });

    it('is false when used less than recencyMinDays ago', () => {
      expect(isFresh(makeUsedRecipe({ last_used_at: daysAgo(3) }), NOW)).toBe(false);
    });

    it('is true from recencyMinDays on', () => {
      expect(isFresh(makeUsedRecipe({ last_used_at: daysAgo(10) }), NOW)).toBe(true);
    });

    it('is true for favorites even when used yesterday', () => {
      expect(isFresh(makeUsedRecipe({ favorite: true, last_used_at: daysAgo(1) }), NOW)).toBe(true);
    });
  });

  describe('3. reproducibility', () => {
    const library = fixtureRecipesAsDomain();
    const slots: PlannerSlot[] = [...slotsFor('pranzo', 5), ...slotsFor('cena', 5)];
    const ctx = makeCtx({
      household: { diet_tags: DEFAULT_HOUSEHOLD.diet_tags, appliances: DEFAULT_HOUSEHOLD.appliances },
    });

    it('gives identical assignments for the same seed, without repeats and with valid recipes', () => {
      const run = () => selectRecipes({ ...ctx, slots, candidates: library, now: NOW, rng: createRng(7) });
      const first = run();
      const second = run();
      expect(first.assignments).toEqual(second.assignments);

      const ids = first.assignments.map((a) => a.recipeId);
      expect(ids.every((id) => id !== null)).toBe(true);
      expect(new Set(ids).size).toBe(ids.length);

      for (const assignment of first.assignments) {
        const slot = slots.find((s) => s.key === assignment.key)!;
        const recipe = library.find((r) => r.id === assignment.recipeId)!;
        expect(exclusionReason(recipe, slot.meal, 'any-main', ctx)).toBeNull();
      }
    });
  });

  describe('4. input order independence', () => {
    it('gives the same result when candidates are reversed', () => {
      const library = fixtureRecipesAsDomain();
      const slots: PlannerSlot[] = [...slotsFor('pranzo', 5), ...slotsFor('cena', 5)];
      const base = makeInput(slots, library, { rng: createRng(11) });
      const reversed = makeInput(slots, [...library].reverse(), { rng: createRng(11) });
      expect(selectRecipes(reversed)).toEqual(selectRecipes(base));
    });
  });

  describe('5. recency', () => {
    it('favors the never-used recipe ~0.8 of the time over two recently used ones', () => {
      const fresh = makeRecipe();
      const recentA = makeUsedRecipe({ last_used_at: daysAgo(3) });
      const recentB = makeUsedRecipe({ last_used_at: daysAgo(3) });
      const slot = slotsFor('pranzo', 1);
      const rng = createRng(42);
      const draws = 2000;

      let freshCount = 0;
      for (let i = 0; i < draws; i++) {
        const { assignments } = selectRecipes(makeInput(slot, [recentA, fresh, recentB], { rng }));
        if (assignments[0].recipeId === fresh.id) freshCount += 1;
      }
      const frequency = freshCount / draws;
      expect(frequency).toBeGreaterThanOrEqual(0.75);
      expect(frequency).toBeLessThanOrEqual(0.85);
    });
  });

  describe('6. recently used candidates only', () => {
    it('still fills the slot and reports needMore with available 0', () => {
      const a = makeUsedRecipe({ last_used_at: daysAgo(2) });
      const b = makeUsedRecipe({ last_used_at: daysAgo(5) });
      const result = selectRecipes(makeInput(slotsFor('pranzo', 1), [a, b]));

      expect([a.id, b.id]).toContain(result.assignments[0].recipeId);
      expect(result.needMore).toHaveLength(1);
      expect(result.needMore[0]).toMatchObject({ meal_type: 'pranzo', available: 0, unfilled: 0 });
    });
  });

  describe('7. max one occurrence', () => {
    it('leaves a slot empty when candidates run out', () => {
      const candidates = [makeRecipe({ meal_types: ['cena'] }), makeRecipe({ meal_types: ['cena'] })];
      const result = selectRecipes(makeInput(slotsFor('cena', 3), candidates));

      const filled = result.assignments.filter((a) => a.recipeId !== null);
      expect(filled).toHaveLength(2);
      expect(new Set(filled.map((a) => a.recipeId)).size).toBe(2);
      expect(result.assignments.filter((a) => a.recipeId === null)).toHaveLength(1);
      expect(result.needMore[0].unfilled).toBe(1);
    });

    it('returns empty results for no slots', () => {
      expect(selectRecipes(makeInput([], [makeRecipe()]))).toEqual({ assignments: [], needMore: [] });
    });
  });

  describe('8. needMore', () => {
    const pranzoSlots = slotsFor('pranzo', 5);

    it('is empty with 5 slots and 7 fresh candidates', () => {
      const candidates = Array.from({ length: 7 }, () => makeRecipe());
      expect(selectRecipes(makeInput(pranzoSlots, candidates)).needMore).toEqual([]);
    });

    it('reports the shortage with 6 candidates', () => {
      const candidates = Array.from({ length: 6 }, () => makeRecipe());
      expect(selectRecipes(makeInput(pranzoSlots, candidates)).needMore).toEqual([
        { meal_type: 'pranzo', course: 'any-main', slots: 5, available: 6, required: 7, unfilled: 0 },
      ]);
    });

    it('counts only fresh candidates as available (7 candidates, 1 used 3 days ago)', () => {
      const candidates = [
        ...Array.from({ length: 6 }, () => makeRecipe()),
        makeUsedRecipe({ last_used_at: daysAgo(3) }),
      ];
      const result = selectRecipes(makeInput(pranzoSlots, candidates));
      expect(result.assignments.every((a) => a.recipeId !== null)).toBe(true);
      expect(result.needMore).toEqual([
        { meal_type: 'pranzo', course: 'any-main', slots: 5, available: 6, required: 7, unfilled: 0 },
      ]);
    });

    it('counts a recently used favorite as available', () => {
      const candidates = [
        ...Array.from({ length: 6 }, () => makeRecipe()),
        makeUsedRecipe({ favorite: true, last_used_at: daysAgo(3) }),
      ];
      expect(selectRecipes(makeInput(pranzoSlots, candidates)).needMore).toEqual([]);
    });

    it('fills 12 slots with the fixture library and no needMore, for 20 seeds', () => {
      // Con la regola dei contorni la libreria di esempio ha 6 ricette solo pranzo, 6 solo cena
      // e 3 per entrambi: 6 + 6 slot si riempiono sempre (con 7 + 7 un seme può lasciare uno slot vuoto).
      const library = fixtureRecipesAsDomain();
      const slots: PlannerSlot[] = [...slotsFor('pranzo', 6), ...slotsFor('cena', 6)];
      for (let seed = 1; seed <= 20; seed++) {
        const result = selectRecipes({
          ...makeCtx({
            household: {
              diet_tags: DEFAULT_HOUSEHOLD.diet_tags,
              appliances: DEFAULT_HOUSEHOLD.appliances,
            },
          }),
          slots,
          candidates: library,
          now: NOW,
          rng: createRng(seed),
        });
        expect(result.needMore).toEqual([]);
        expect(result.assignments.filter((a) => a.recipeId !== null)).toHaveLength(12);
      }
    });
  });

  describe('8b. scarcest meal type first', () => {
    it('fills all 4 slots when 2 cena-only and 2 shared recipes exist, for 20 seeds', () => {
      const candidates = [
        makeRecipe({ meal_types: ['cena'] }),
        makeRecipe({ meal_types: ['cena'] }),
        makeRecipe(),
        makeRecipe(),
      ];
      const slots = [...slotsFor('pranzo', 2), ...slotsFor('cena', 2)];
      for (let seed = 1; seed <= 20; seed++) {
        const result = selectRecipes(makeInput(slots, candidates, { rng: createRng(seed) }));
        expect(result.assignments.every((a) => a.recipeId !== null)).toBe(true);
      }
    });
  });

  describe('8c. slots by course', () => {
    const DAY = '2026-09-30';
    const courseSlot = (meal: MealType, course: CourseFilter): PlannerSlot => ({
      key: `${DAY}|${meal}|${course}`,
      day: DAY,
      meal,
      course,
    });

    it('never puts a side dish in a primo slot, nor an unclassified recipe in a contorno slot', () => {
      const primoA = makeRecipe({ courses: ['primo'] });
      const primoB = makeRecipe({ courses: ['primo'] });
      const unclassified = makeRecipe({ courses: [] });
      const sideA = makeRecipe({ courses: ['contorno'] });
      const sideB = makeRecipe({ courses: ['contorno'] });
      const primoIds = new Set([primoA.id, primoB.id, unclassified.id]);
      const sideIds = new Set([sideA.id, sideB.id]);
      const slots = [
        ...slotsFor('pranzo', 2, 'primo'),
        ...slotsFor('pranzo', 2, 'contorno'),
      ];
      const candidates = [primoA, primoB, unclassified, sideA, sideB];

      for (let seed = 1; seed <= 20; seed++) {
        const { assignments } = selectRecipes(makeInput(slots, candidates, { rng: createRng(seed) }));
        for (const assignment of assignments) {
          const slot = slots.find((s) => s.key === assignment.key)!;
          expect(assignment.recipeId).not.toBeNull();
          if (slot.course === 'primo') expect(primoIds.has(assignment.recipeId!)).toBe(true);
          else expect(sideIds.has(assignment.recipeId!)).toBe(true);
        }
        const ids = assignments.map((a) => a.recipeId);
        expect(new Set(ids).size).toBe(ids.length);
      }
    });

    it('never repeats a secondo + contorno recipe across the two slots of a meal', () => {
      const both = makeRecipe({ courses: ['secondo', 'contorno'] });
      const slots = [courseSlot('cena', 'secondo'), courseSlot('cena', 'contorno')];
      for (let seed = 1; seed <= 5; seed++) {
        const { assignments } = selectRecipes(makeInput(slots, [both], { rng: createRng(seed) }));
        const filled = assignments.filter((a) => a.recipeId !== null);
        expect(filled).toHaveLength(1);
        expect(filled[0].recipeId).toBe(both.id);
      }
    });

    it('serves the scarcer course group first, so the shared recipe goes to the rarer slot', () => {
      const onlySide = makeRecipe({ courses: ['contorno'], meal_types: ['cena'] });
      const sideAndMain = makeRecipe({ courses: ['contorno', 'secondo'], meal_types: ['cena'] });
      const slots = [courseSlot('cena', 'contorno'), courseSlot('cena', 'secondo')];
      for (let seed = 1; seed <= 5; seed++) {
        const { assignments } = selectRecipes(makeInput(slots, [onlySide, sideAndMain], { rng: createRng(seed) }));
        const byKey = new Map(assignments.map((a) => [a.key, a.recipeId]));
        expect(byKey.get(courseSlot('cena', 'secondo').key)).toBe(sideAndMain.id);
        expect(byKey.get(courseSlot('cena', 'contorno').key)).toBe(onlySide.id);
      }
    });

    it('reports needMore per (meal, course) group', () => {
      const sides = [makeRecipe({ courses: ['contorno'] }), makeRecipe({ courses: ['contorno'] })];
      const result = selectRecipes(makeInput(slotsFor('cena', 3, 'contorno'), sides));
      expect(result.needMore).toEqual([
        {
          meal_type: 'cena',
          course: 'contorno',
          slots: 3,
          available: 2,
          required: 3 + PLANNER_CONFIG.minPoolSize - 1,
          unfilled: 1,
        },
      ]);
    });

    it('stays silent for a group with enough candidates while another group is short', () => {
      const mains = Array.from({ length: 5 }, () => makeRecipe({ courses: ['secondo'], meal_types: ['cena'] }));
      const slots = [...slotsFor('cena', 3, 'secondo'), ...slotsFor('cena', 2, 'contorno')];
      const result = selectRecipes(makeInput(slots, mains));
      expect(result.needMore).toEqual([
        { meal_type: 'cena', course: 'contorno', slots: 2, available: 0, required: 2 + PLANNER_CONFIG.minPoolSize - 1, unfilled: 2 },
      ]);
    });

    it('lists needMore by meal (pranzo, cena), then course in canonical order', () => {
      const slots = [
        ...slotsFor('cena', 1, 'contorno'),
        ...slotsFor('pranzo', 1, 'secondo'),
        ...slotsFor('cena', 1, 'any-main'),
        ...slotsFor('pranzo', 1, 'any-main'),
        ...slotsFor('cena', 1, 'primo'),
        ...slotsFor('pranzo', 1, 'contorno'),
        ...slotsFor('cena', 1, 'secondo'),
        ...slotsFor('pranzo', 1, 'piatto-unico'),
        ...slotsFor('pranzo', 1, 'primo'),
        ...slotsFor('cena', 1, 'piatto-unico'),
      ];
      const result = selectRecipes(makeInput(slots, []));
      expect(result.needMore.map((n) => `${n.meal_type}|${n.course}`)).toEqual([
        'pranzo|any-main',
        'pranzo|piatto-unico',
        'pranzo|primo',
        'pranzo|secondo',
        'pranzo|contorno',
        'cena|any-main',
        'cena|piatto-unico',
        'cena|primo',
        'cena|secondo',
        'cena|contorno',
      ]);
    });

    it('gives identical assignments for the same seed with mixed courses', () => {
      const library = fixtureRecipesAsDomain();
      const slots = [
        ...slotsFor('pranzo', 3, 'primo'),
        ...slotsFor('pranzo', 3, 'contorno'),
        ...slotsFor('cena', 3, 'secondo'),
        ...slotsFor('cena', 3, 'contorno'),
      ];
      const run = () =>
        selectRecipes({
          ...makeCtx({
            household: { diet_tags: DEFAULT_HOUSEHOLD.diet_tags, appliances: DEFAULT_HOUSEHOLD.appliances },
          }),
          slots,
          candidates: library,
          now: NOW,
          rng: createRng(9),
        });
      expect(run()).toEqual(run());
    });
  });

  describe('9. favorites weight ~1.5x', () => {
    it('draws favorites about 1.5 times more often than non-favorites', () => {
      const favorites = Array.from({ length: 5 }, () => makeUsedRecipe({ favorite: true }));
      const others = Array.from({ length: 5 }, () => makeUsedRecipe());
      const favoriteIds = new Set(favorites.map((r) => r.id));
      const slot = slotsFor('pranzo', 1);
      const rng = createRng(42);

      let favoriteDraws = 0;
      let otherDraws = 0;
      for (let i = 0; i < 10_000; i++) {
        const { assignments } = selectRecipes(makeInput(slot, [...favorites, ...others], { rng }));
        if (favoriteIds.has(assignments[0].recipeId!)) favoriteDraws += 1;
        else otherDraws += 1;
      }
      const ratio = favoriteDraws / otherDraws;
      expect(ratio).toBeGreaterThanOrEqual(1.4);
      expect(ratio).toBeLessThanOrEqual(1.6);
    });

    it('a favorite used yesterday still beats a never-used recipe ~1.25x (1.5 / 1.2)', () => {
      const favorite = makeUsedRecipe({ favorite: true, last_used_at: daysAgo(1) });
      const novel = makeRecipe();
      const slot = slotsFor('pranzo', 1);
      const rng = createRng(42);

      let favoriteDraws = 0;
      let novelDraws = 0;
      for (let i = 0; i < 10_000; i++) {
        const { assignments } = selectRecipes(makeInput(slot, [favorite, novel], { rng }));
        if (assignments[0].recipeId === favorite.id) favoriteDraws += 1;
        else novelDraws += 1;
      }
      const ratio = favoriteDraws / novelDraws;
      expect(ratio).toBeGreaterThanOrEqual(1.15);
      expect(ratio).toBeLessThanOrEqual(1.35);
    });
  });

  describe('10. ingredient likes and dislikes', () => {
    function build(): { liked: Recipe[]; others: Recipe[]; prefs: IngredientPreferenceSets } {
      const liked = Array.from({ length: 5 }, () =>
        makeUsedRecipe({}, { ingredients: [makeIngredient('basilico'), makeIngredient('pomodoro')] })
      );
      const others = Array.from({ length: 5 }, () => makeUsedRecipe());
      return { liked, others, prefs: toIngredientPreferenceSets(['basilico', 'pomodoro'], []) };
    }

    it('draws recipes with 2 liked ingredients ~1.3x more often', () => {
      const { liked, others, prefs } = build();
      const likedIds = new Set(liked.map((r) => r.id));
      const slot = slotsFor('pranzo', 1);
      const rng = createRng(42);

      let likedDraws = 0;
      let otherDraws = 0;
      for (let i = 0; i < 10_000; i++) {
        const input = makeInput(slot, [...liked, ...others], { rng, ingredientPrefs: prefs });
        const { assignments } = selectRecipes(input);
        if (likedIds.has(assignments[0].recipeId!)) likedDraws += 1;
        else otherDraws += 1;
      }
      const ratio = likedDraws / otherDraws;
      expect(ratio).toBeGreaterThanOrEqual(1.2);
      expect(ratio).toBeLessThanOrEqual(1.4);
    });

    it('never draws recipes containing a disliked ingredient', () => {
      const { liked, others } = build();
      const likedIds = new Set(liked.map((r) => r.id));
      const ingredientPrefs = toIngredientPreferenceSets([], ['basilico']);
      const slot = slotsFor('pranzo', 1);
      const rng = createRng(3);
      for (let i = 0; i < 500; i++) {
        const { assignments } = selectRecipes(
          makeInput(slot, [...liked, ...others], { rng, ingredientPrefs })
        );
        expect(likedIds.has(assignments[0].recipeId!)).toBe(false);
      }
    });
  });

  describe('11. computeGenerationCount', () => {
    it('adds the extra to the deficit, within min and max', () => {
      expect(
        computeGenerationCount({ meal_type: 'pranzo', course: 'any-main', slots: 5, required: 7, available: 6, unfilled: 0 })
      ).toBe(3);
      expect(
        computeGenerationCount({ meal_type: 'pranzo', course: 'any-main', slots: 7, required: 9, available: 0, unfilled: 7 })
      ).toBe(10);
      expect(
        computeGenerationCount({ meal_type: 'cena', course: 'any-main', slots: 1, required: 3, available: 0, unfilled: 1 })
      ).toBe(5);
    });
  });

  describe('12. weightedPick', () => {
    it('throws when all weights are 0', () => {
      expect(() => weightedPick(['a', 'b'], [0, 0], createRng(1))).toThrow();
    });

    it('throws on empty items', () => {
      expect(() => weightedPick([], [], createRng(1))).toThrow();
    });

    it('never returns an item with zero weight', () => {
      const rng = createRng(5);
      for (let i = 0; i < 200; i++) {
        expect(weightedPick(['a', 'b', 'c'], [0, 2, 0], rng)).toBe('b');
      }
    });

    it('falls back to the last positive-weight item when the draw reaches the total', () => {
      expect(weightedPick(['a', 'b', 'c'], [1, 1, 0], () => 1)).toBe('b');
    });
  });

  describe('splitGenerationBatches', () => {
    it.each([
      [10, [3, 3, 3, 1]],
      [9, [3, 3, 3]],
      [3, [3]],
      [1, [1]],
      [0, []],
    ])('splits %i into %j', (count, expected) => {
      expect(splitGenerationBatches(count)).toEqual(expected);
    });

    it('honours a custom batch size and always sums to count', () => {
      const config = { ...PLANNER_CONFIG, generationBatchSize: 4 };
      expect(splitGenerationBatches(10, config)).toEqual([4, 4, 2]);
      for (let count = 0; count <= 10; count++) {
        expect(splitGenerationBatches(count).reduce((a, b) => a + b, 0)).toBe(count);
      }
    });
  });

  describe('toIngredientPreferenceSets', () => {
    it('normalizes names into new sets', () => {
      const sets = toIngredientPreferenceSets(['  Basilico'], ['AGLIO  rosso']);
      expect([...sets.likes]).toEqual(['basilico']);
      expect([...sets.dislikes]).toEqual(['aglio rosso']);
    });
  });

  describe('13. planGeneration', () => {
    // Con i default: deficit max(required - available, unfilled) + generationExtra(2) → 5 per carenza
    // (required 3, available 0), che è il valore di computeGenerationCount per questa forma.
    function shortage(overrides: Partial<MealTypeShortage> = {}): MealTypeShortage {
      return {
        meal_type: 'cena',
        course: 'any-main',
        slots: 1,
        available: 0,
        required: 3,
        unfilled: 1,
        ...overrides,
      };
    }

    it('gives no request when there is no shortage', () => {
      expect(planGeneration([])).toEqual([]);
    });

    it('gives a single group the same count as computeGenerationCount', () => {
      const single = shortage({ course: 'primo', slots: 2, required: 4, available: 1, unfilled: 0 });
      expect(planGeneration([single])).toEqual([
        { meal_type: 'cena', course: 'primo', count: computeGenerationCount(single) },
      ]);
    });

    it('caps a single group at generationMax', () => {
      const config = { ...PLANNER_CONFIG, generationMax: 4 };
      expect(planGeneration([shortage()], config)).toEqual([
        { meal_type: 'cena', course: 'any-main', count: 4 },
      ]);
    });

    it('splits 10 recipes among four dinner groups, serving the groups with empty slots first', () => {
      const needMore = [
        shortage({ course: 'primo', unfilled: 0 }),
        shortage({ course: 'any-main', unfilled: 1 }),
        shortage({ course: 'secondo', unfilled: 0 }),
        shortage({ course: 'contorno', unfilled: 1 }),
      ];
      expect(planGeneration(needMore)).toEqual([
        { meal_type: 'cena', course: 'any-main', count: 5 },
        { meal_type: 'cena', course: 'contorno', count: 5 },
      ]);
    });

    it('gives the budget to the empty-slot groups first, but returns the groups in needMore order', () => {
      const needMore = [
        shortage({ course: 'primo', unfilled: 0 }),
        shortage({ course: 'any-main', unfilled: 1 }),
        shortage({ course: 'secondo', unfilled: 0 }),
      ];
      expect(planGeneration(needMore)).toEqual([
        { meal_type: 'cena', course: 'primo', count: 5 },
        { meal_type: 'cena', course: 'any-main', count: 5 },
      ]);
    });

    it('keeps the budget independent per meal type', () => {
      const needMore = [
        shortage({ meal_type: 'pranzo', course: 'any-main', unfilled: 1 }),
        shortage({ meal_type: 'cena', course: 'any-main', unfilled: 1 }),
        shortage({ meal_type: 'cena', course: 'primo', unfilled: 0 }),
        shortage({ meal_type: 'pranzo', course: 'secondo', unfilled: 0 }),
      ];
      expect(planGeneration(needMore)).toEqual([
        { meal_type: 'pranzo', course: 'any-main', count: 5 },
        { meal_type: 'cena', course: 'any-main', count: 5 },
        { meal_type: 'cena', course: 'primo', count: 5 },
        { meal_type: 'pranzo', course: 'secondo', count: 5 },
      ]);
    });

    it('never gives one meal type more than generationMax in total', () => {
      const needMore = [
        shortage({ course: 'any-main', unfilled: 1 }),
        shortage({ course: 'primo', unfilled: 1 }),
        shortage({ course: 'secondo', unfilled: 0 }),
      ];
      const requests = planGeneration(needMore);
      expect(requests).toEqual([
        { meal_type: 'cena', course: 'any-main', count: 5 },
        { meal_type: 'cena', course: 'primo', count: 5 },
      ]);
      expect(requests.reduce((sum, request) => sum + request.count, 0)).toBe(PLANNER_CONFIG.generationMax);
    });
  });

  describe('manualChoiceExclusionReason', () => {
    const HOUSEHOLD: Pick<Household, 'diet_tags' | 'appliances'> = {
      diet_tags: [],
      appliances: ['fornelli', 'forno'],
    };

    it('returns null for a recipe that fits the meal, diets and appliances', () => {
      const recipe = makeRecipe({ meal_types: ['cena'], appliances_required: ['forno'] });
      expect(manualChoiceExclusionReason(recipe, 'cena', 'any-main', HOUSEHOLD)).toBeNull();
    });

    it('returns blocked for a blocked recipe', () => {
      const id = nextId();
      const recipe = makeRecipe({ id, meal_types: ['cena'], prefs: makePrefs(id, { blocked: true }) });
      expect(manualChoiceExclusionReason(recipe, 'cena', 'any-main', HOUSEHOLD)).toBe('blocked');
    });

    it('returns meal_type when the recipe is not for that meal', () => {
      const recipe = makeRecipe({ meal_types: ['pranzo'] });
      expect(manualChoiceExclusionReason(recipe, 'cena', 'any-main', HOUSEHOLD)).toBe('meal_type');
    });

    it('returns diet when the household diet is not met by the recipe', () => {
      const recipe = makeRecipe({ meal_types: ['cena'], diet_flags: ['vegetariano'] });
      expect(
        manualChoiceExclusionReason(recipe, 'cena', 'any-main', { diet_tags: ['vegano'], appliances: ['fornelli'] })
      ).toBe('diet');
    });

    it('returns appliance when the recipe needs an appliance the household lacks', () => {
      const recipe = makeRecipe({ meal_types: ['cena'], appliances_required: ['forno'] });
      expect(
        manualChoiceExclusionReason(recipe, 'cena', 'any-main', { diet_tags: [], appliances: ['fornelli'] })
      ).toBe('appliance');
    });

    it('ignores the ingredients the household dislikes, unlike exclusionReason', () => {
      const recipe = makeRecipe({ meal_types: ['cena'], ingredients: [makeIngredient('cipolla')] });
      const ctx = makeCtx({ ingredientPrefs: toIngredientPreferenceSets([], ['cipolla']) });

      expect(exclusionReason(recipe, 'cena', 'any-main', ctx)).toBe('disliked_ingredient');
      expect(manualChoiceExclusionReason(recipe, 'cena', 'any-main', HOUSEHOLD)).toBeNull();
    });
  });
});
