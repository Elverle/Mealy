// @vitest-environment node
import { describe, it, expect } from 'vitest';
import {
  applyRecipePrefPatch,
  countRecipesByIngredient,
  defaultRecipePref,
} from '@/lib/domain/prefs';
import { RecipeSchema, type Recipe } from '@/lib/domain/types';

const HOUSEHOLD_ID = '00000000-0000-4000-8000-000000000001';

function makeRecipe(
  index: number,
  names: string[],
  blocked = false
): Recipe {
  const id = `00000000-0000-4000-8000-0000000001${String(index).padStart(2, '0')}`;
  return RecipeSchema.parse({
    id,
    household_id: HOUSEHOLD_ID,
    title: `Ricetta ${index}`,
    slug: `ricetta-${index}`,
    steps: ['Cuoci.'],
    meal_types: ['cena'],
    servings_base: 2,
    prep_minutes: 10,
    ingredients: names.map((canonical_name) => ({
      canonical_name,
      display_name: canonical_name,
      qty: 1,
      unit: 'g',
      category: 'dispensa',
    })),
    prefs: { recipe_id: id, rating: null, favorite: false, blocked, times_used: 0, last_used_at: null },
  });
}

describe('defaultRecipePref', () => {
  it('returns an empty prefs row for the recipe', () => {
    expect(defaultRecipePref('abc')).toEqual({
      recipe_id: 'abc',
      rating: null,
      favorite: false,
      blocked: false,
      times_used: 0,
      last_used_at: null,
    });
  });
});

describe('applyRecipePrefPatch', () => {
  it('starts from defaults when there is no current row', () => {
    expect(applyRecipePrefPatch(null, { rating: 3 })).toEqual({ rating: 3, favorite: false, blocked: false });
    expect(applyRecipePrefPatch(null, { favorite: true })).toEqual({ rating: null, favorite: true, blocked: false });
  });

  it('keeps favorite false when favoriting a blocked recipe', () => {
    const current = { rating: null, favorite: false, blocked: true };
    expect(applyRecipePrefPatch(current, { favorite: true })).toEqual({
      rating: null,
      favorite: false,
      blocked: true,
    });
  });

  it('unblocks without restoring the favorite', () => {
    const current = { rating: 4, favorite: false, blocked: true };
    expect(applyRecipePrefPatch(current, { blocked: false })).toEqual({
      rating: 4,
      favorite: false,
      blocked: false,
    });
  });

  it('removes the rating with rating: null', () => {
    const current = { rating: 5, favorite: true, blocked: false };
    expect(applyRecipePrefPatch(current, { rating: null })).toEqual({
      rating: null,
      favorite: true,
      blocked: false,
    });
  });

  it('clears favorite when blocking a favorite recipe', () => {
    const current = { rating: 5, favorite: true, blocked: false };
    expect(applyRecipePrefPatch(current, { blocked: true })).toEqual({
      rating: 5,
      favorite: false,
      blocked: true,
    });
  });

  it('allows blocking and favoriting in one patch only as blocked', () => {
    expect(applyRecipePrefPatch(null, { blocked: true, favorite: true }).favorite).toBe(false);
  });

  it('treats an undefined current rating as null', () => {
    expect(applyRecipePrefPatch({ rating: undefined, favorite: false, blocked: false }, { favorite: true }).rating).toBeNull();
  });
});

describe('countRecipesByIngredient', () => {
  it('counts each recipe containing the ingredient', () => {
    const counts = countRecipesByIngredient([makeRecipe(1, ['sale', 'pollo']), makeRecipe(2, ['sale'])]);
    expect(counts.get('sale')).toBe(2);
    expect(counts.get('pollo')).toBe(1);
  });

  it('does not count blocked recipes', () => {
    const counts = countRecipesByIngredient([makeRecipe(1, ['sale']), makeRecipe(2, ['sale'], true)]);
    expect(counts.get('sale')).toBe(1);
  });

  it('counts a repeated ingredient once per recipe', () => {
    const counts = countRecipesByIngredient([makeRecipe(1, ['sale', 'sale'])]);
    expect(counts.get('sale')).toBe(1);
  });

  it('merges names that differ only by case and spacing', () => {
    const counts = countRecipesByIngredient([makeRecipe(1, [' Cipolla ']), makeRecipe(2, ['cipolla'])]);
    expect(counts.get('cipolla')).toBe(2);
    expect(counts.size).toBe(1);
  });

  it('returns an empty map for no recipes', () => {
    expect(countRecipesByIngredient([]).size).toBe(0);
  });
});
