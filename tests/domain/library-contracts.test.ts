// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { fixtureRecipesAsDomain } from '@/fixtures';
import {
  RecipeDetailViewSchema,
  SetIngredientPrefRequestSchema,
  UpdateRecipePrefRequestSchema,
} from '@/lib/domain/types';

describe('UpdateRecipePrefRequestSchema', () => {
  it.each([[{}], [{ rating: 6 }], [{ rating: 0 }], [{ foo: true }], [{ rating: 3, foo: 1 }]])(
    'rejects %j',
    (body) => {
      expect(UpdateRecipePrefRequestSchema.safeParse(body).success).toBe(false);
    }
  );

  it.each([[{ rating: null }], [{ favorite: true, blocked: false }], [{ rating: 5 }]])(
    'accepts %j',
    (body) => {
      expect(UpdateRecipePrefRequestSchema.safeParse(body).success).toBe(true);
    }
  );
});

describe('SetIngredientPrefRequestSchema', () => {
  it.each([[{ pref: 'like' }], [{ pref: 'dislike' }], [{ pref: null }]])('accepts %j', (body) => {
    expect(SetIngredientPrefRequestSchema.safeParse(body).success).toBe(true);
  });

  it.each([[{}], [{ pref: 'boh' }], [{ pref: 'like', extra: 1 }]])('rejects %j', (body) => {
    expect(SetIngredientPrefRequestSchema.safeParse(body).success).toBe(false);
  });
});

describe('RecipeDetailViewSchema', () => {
  it('accepts a serialized fixture recipe and restores dates', () => {
    const recipe = fixtureRecipesAsDomain()[0];
    const wire = JSON.parse(JSON.stringify({ recipe, ingredients: [] }));

    const parsed = RecipeDetailViewSchema.parse(wire);

    expect(parsed.recipe.id).toBe(recipe.id);
    expect(parsed.recipe.created_at).toBeInstanceOf(Date);
  });

  it('accepts an ingredient info whose canonical name exceeds 80 characters', () => {
    const recipe = fixtureRecipesAsDomain()[0];
    const longName = 'a'.repeat(81);
    const wire = JSON.parse(
      JSON.stringify({
        recipe,
        ingredients: [{ canonical_name: longName, pref: null, recipes_count: 1 }],
      })
    );

    const parsed = RecipeDetailViewSchema.parse(wire);

    expect(parsed.ingredients[0].canonical_name).toBe(longName);
  });
});
