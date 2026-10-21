import { describe, expect, it } from 'vitest';
import {
  findRecipeIngredient,
  ingredientRowId,
  proposalToRecipeDetail,
  recipeChips,
  toRecipeDetail,
} from '@/components/sheets/recipe-detail';
import type {
  GeneratedRecipe,
  Ingredient,
  Recipe,
  RecipeIngredientInfo,
} from '@/lib/domain/types';

const ID = '11111111-1111-4111-8111-111111111111';

function makeRecipe(overrides: Partial<Recipe> = {}): Recipe {
  return {
    id: ID,
    household_id: '22222222-2222-4222-8222-222222222222',
    title: 'Pasta al pomodoro',
    slug: 'pasta-al-pomodoro',
    description: 'Semplice',
    steps: ['Cuoci', 'Servi'],
    meal_types: ['pranzo'],
    courses: [],
    tags: [],
    diet_flags: [],
    appliances_required: [],
    servings_base: 2,
    prep_minutes: 20,
    source: 'manual',
    created_at: new Date('2026-01-01'),
    ingredients: [],
    prefs: null,
    ...overrides,
  };
}

function makeIngredient(qty: number | null): Ingredient {
  return {
    canonical_name: 'farina',
    display_name: 'Farina',
    unit: 'g',
    category: 'dispensa',
    qty,
  } as Ingredient;
}

function makeProposal(overrides: Partial<GeneratedRecipe> = {}): GeneratedRecipe {
  return {
    title: 'Lasagne al forno',
    description: 'Classiche',
    meal_types: ['pranzo'],
    courses: ['primo'],
    tags: ['comfort-food', 'piatto-unico', 'veloce'],
    diet_flags: ['vegetariano'],
    appliances_required: [],
    servings_base: 2,
    prep_minutes: 60,
    kcal_est: null,
    steps: ['Stendi la sfoglia', 'Inforna'],
    ingredients: [
      { canonical_name: 'farina', display_name: 'Farina', qty: 200, unit: 'g', category: 'dispensa', note: null },
      { canonical_name: 'sale', display_name: 'Sale', qty: null, unit: 'qb', category: 'dispensa', note: null },
    ],
    ...overrides,
  };
}

describe('recipeChips', () => {
  it('returns at most 2 style tags then 1 diet label', () => {
    const chips = recipeChips(
      makeRecipe({
        tags: ['veloce', 'proteico', 'leggero'],
        diet_flags: ['vegetariano', 'pescetariano'],
      })
    );
    expect(chips).toEqual(['Veloce', 'Proteico', 'Vegetariano']);
  });

  it('picks the diet by priority, vegano first', () => {
    expect(recipeChips(makeRecipe({ diet_flags: ['senza-lattosio', 'vegano'] }))).toEqual(['Vegano']);
  });

  it('returns nothing without tags or diets', () => {
    expect(recipeChips(makeRecipe())).toEqual([]);
  });

  it('accepts an object with only tags, diet_flags and courses', () => {
    expect(recipeChips({ tags: ['veloce'], diet_flags: ['vegano'], courses: [] })).toEqual([
      'Veloce',
      'Vegano',
    ]);
  });

  it('hides Piatto unico from the style chips of a classified recipe, which the course badge shows', () => {
    const chips = recipeChips(
      makeRecipe({
        courses: ['piatto-unico'],
        tags: ['piatto-unico', 'veloce', 'salutare'],
        diet_flags: ['vegetariano'],
      })
    );
    expect(chips).toEqual(['Veloce', 'Salutare', 'Vegetariano']);
  });

  it('keeps Piatto unico among the style chips of an unclassified recipe', () => {
    expect(recipeChips(makeRecipe({ courses: [], tags: ['piatto-unico'] }))).toEqual(['Piatto unico']);
  });
});

describe('ingredientRowId and findRecipeIngredient', () => {
  const withId = { ...makeIngredient(1), id: 'ing-1' } as Ingredient;
  const withoutId = makeIngredient(2);

  it('uses the ingredient id when present', () => {
    expect(ingredientRowId({ id: ID }, withId, 3)).toBe('ing-1');
  });

  it('falls back to recipe id and index when the id is missing', () => {
    expect(ingredientRowId({ id: ID }, withoutId, 1)).toBe(`${ID}:1`);
  });

  it('finds an ingredient by real id and by synthetic id', () => {
    const recipe = makeRecipe({ ingredients: [withId, withoutId] });
    expect(findRecipeIngredient(recipe, 'ing-1')).toBe(withId);
    expect(findRecipeIngredient(recipe, `${ID}:1`)).toBe(withoutId);
  });

  it('returns null when the row id does not exist', () => {
    expect(findRecipeIngredient(makeRecipe({ ingredients: [withId] }), 'nope')).toBeNull();
  });
});

describe('toRecipeDetail', () => {
  it('scales quantities to the requested servings', () => {
    const detail = toRecipeDetail(makeRecipe({ ingredients: [makeIngredient(150)] }), 3);
    expect(detail.servings).toBe(3);
    expect(detail.ingredients[0]).toMatchObject({ name: 'Farina', amount: 225, unit: 'g' });
  });

  it('rounds scaled amounts to one decimal', () => {
    const detail = toRecipeDetail(
      makeRecipe({ servings_base: 3, ingredients: [makeIngredient(1)] }),
      1
    );
    expect(detail.ingredients[0].amount).toBe(0.3);
  });

  it('uses amount 0 when qty is null and a synthetic id when missing', () => {
    const detail = toRecipeDetail(makeRecipe({ ingredients: [makeIngredient(null)] }), 2);
    expect(detail.ingredients[0].amount).toBe(0);
    expect(detail.ingredients[0].id).toBe(`${ID}:0`);
  });

  it('shows the course label in course order, and no course for an unclassified recipe', () => {
    expect(toRecipeDetail(makeRecipe({ courses: ['secondo', 'piatto-unico'] }), 2).course).toBe(
      'Piatto unico · Secondo'
    );
    expect(toRecipeDetail(makeRecipe({ courses: [] }), 2).course).toBeUndefined();
  });

  it('defaults preference fields when prefs is null', () => {
    const detail = toRecipeDetail(makeRecipe(), 2);
    expect(detail).toMatchObject({ isFavorite: false, isBlocked: false, prepTimeMinutes: 20 });
    expect(detail.rating).toBeUndefined();
  });

  it('maps preference fields when present', () => {
    const detail = toRecipeDetail(
      makeRecipe({
        prefs: { recipe_id: ID, rating: 4, favorite: true, blocked: false, times_used: 1 },
      }),
      2
    );
    expect(detail).toMatchObject({ rating: 4, isFavorite: true, isBlocked: false });
  });

  describe('with ingredient info', () => {
    const named = (canonical_name: string, display_name: string): Ingredient =>
      ({ ...makeIngredient(100), canonical_name, display_name }) as Ingredient;
    const recipe = makeRecipe({
      ingredients: [
        named('basilico', 'Basilico'),
        named(' Cipolla Rossa ', 'Cipolla rossa di Tropea'),
        named('sale', 'Sale'),
      ],
    });
    const info = new Map<string, RecipeIngredientInfo>([
      ['basilico', { canonical_name: 'basilico', pref: 'like', recipes_count: 3 }],
      ['cipolla rossa', { canonical_name: 'cipolla rossa', pref: 'dislike', recipes_count: 8 }],
    ]);

    it('omits preference, recipesCount and canonicalName without the map', () => {
      for (const ing of toRecipeDetail(recipe, 2).ingredients) {
        expect(Object.keys(ing).sort()).toEqual(['amount', 'id', 'name', 'unit']);
      }
    });

    it('maps liked, disliked and null preferences with recipesCount', () => {
      const [basil, onion, salt] = toRecipeDetail(recipe, 2, info).ingredients;
      expect(basil).toMatchObject({ preference: 'liked', recipesCount: 3 });
      expect(onion).toMatchObject({ preference: 'disliked', recipesCount: 8 });
      expect(salt.preference).toBeNull();
      expect(salt.recipesCount).toBeUndefined();
    });

    it('gives every ingredient a normalized canonicalName', () => {
      const names = toRecipeDetail(recipe, 2, info).ingredients.map((i) => i.canonicalName);
      expect(names).toEqual(['basilico', 'cipolla rossa', 'sale']);
    });

    it('normalizes the canonical name before the lookup', () => {
      const spaced = makeRecipe({ ingredients: [named(' Basilico ', 'Basilico')] });
      expect(toRecipeDetail(spaced, 2, info).ingredients[0]).toMatchObject({
        preference: 'liked',
        recipesCount: 3,
      });
    });
  });
});

describe('proposalToRecipeDetail', () => {
  it('uses the title as id prefix and carries the proposal fields', () => {
    const recipe = makeProposal();
    const detail = proposalToRecipeDetail(recipe, 2);
    expect(detail).toMatchObject({
      id: 'proposal:Lasagne al forno',
      title: 'Lasagne al forno',
      description: 'Classiche',
      prepTimeMinutes: 60,
      servings: 2,
      steps: ['Stendi la sfoglia', 'Inforna'],
    });
  });

  it('scales quantities from servings_base to the requested servings', () => {
    const detail = proposalToRecipeDetail(makeProposal(), 4);
    expect(detail.servings).toBe(4);
    expect(detail.ingredients[0]).toMatchObject({ name: 'Farina', amount: 400, unit: 'g' });
  });

  it('uses amount 0 when qty is null', () => {
    const detail = proposalToRecipeDetail(makeProposal(), 4);
    expect(detail.ingredients[1]).toMatchObject({ name: 'Sale', amount: 0, unit: 'qb' });
  });

  it('gives the same chips as the library recipe', () => {
    const recipe = makeProposal();
    expect(proposalToRecipeDetail(recipe, 2).tags).toEqual(recipeChips(recipe));
  });

  it('carries the course label of the proposal', () => {
    expect(proposalToRecipeDetail(makeProposal(), 2).course).toBe('Primo');
  });

  it('shows no course for an unclassified proposal, and drops Piatto unico from the chips of a classified one', () => {
    const unclassified = proposalToRecipeDetail(
      makeProposal({ courses: [], tags: ['piatto-unico'], diet_flags: [] }),
      2
    );
    expect(unclassified.course).toBeUndefined();
    expect(unclassified.tags).toEqual(['Piatto unico']);

    const classified = proposalToRecipeDetail(
      makeProposal({ courses: ['piatto-unico'], tags: ['piatto-unico', 'veloce'], diet_flags: [] }),
      2
    );
    expect(classified.course).toBe('Piatto unico');
    expect(classified.tags).toEqual(['Veloce']);
  });

  it('has no judgements: not favorite, not blocked, no rating', () => {
    const detail = proposalToRecipeDetail(makeProposal(), 2);
    expect(detail.isFavorite).toBe(false);
    expect(detail.isBlocked).toBe(false);
    expect(detail.rating).toBeUndefined();
  });

  it('gives each ingredient a synthetic id from the proposal title and its index', () => {
    const detail = proposalToRecipeDetail(makeProposal(), 2);
    expect(detail.ingredients.map((ing) => ing.id)).toEqual([
      'proposal:Lasagne al forno:0',
      'proposal:Lasagne al forno:1',
    ]);
    expect(detail.ingredients.every((ing) => ing.preference === undefined)).toBe(true);
  });

  it('changes the id with the title, so a new proposal resets the servings', () => {
    const first = proposalToRecipeDetail(makeProposal(), 2);
    const second = proposalToRecipeDetail(makeProposal({ title: 'Lasagne verdi' }), 2);
    expect(second.id).not.toBe(first.id);
  });
});
