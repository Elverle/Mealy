// @vitest-environment node

import { describe, it, expect } from 'vitest';
import rawPack from '@/fixtures/recipe-pack.json';
import rawIngredients from '@/fixtures/recipe-pack-ingredients.json';
import { FIXTURE_INGREDIENT_ALIASES } from '@/fixtures';
import { RECIPE_PACK_INGREDIENTS, RECIPE_PACK_RECIPES } from '@/fixtures/recipe-pack';
import { PackIngredientsFileSchema, RecipePackFileSchema } from '@/lib/domain/types';
import { normalizeCanonicalName, normalizeTitle } from '@/lib/domain/recipe-text';
import { deriveStyleTags } from '@/lib/domain/courses';
import { deriveDietFlags, toIngredientFactsMap } from '@/lib/domain/diet-rules';
import { areTitlesSimilar } from '@/lib/domain/title-similarity';

const factsMap = toIngredientFactsMap(RECIPE_PACK_INGREDIENTS);
const aliasNames = new Set(FIXTURE_INGREDIENT_ALIASES.map((a) => normalizeCanonicalName(a.alias)));

describe('Recipe pack fixtures', () => {
  it('raw pack and ingredient table parse against their schemas', () => {
    expect(() => RecipePackFileSchema.parse(rawPack)).not.toThrow();
    expect(() => PackIngredientsFileSchema.parse(rawIngredients)).not.toThrow();
  });

  it('every ingredient fact is reviewed and has a normalized name', () => {
    for (const fact of RECIPE_PACK_INGREDIENTS) {
      expect(fact.reviewed).toBe(true);
      expect(fact.name).toBe(normalizeCanonicalName(fact.name));
    }
  });

  describe.each(RECIPE_PACK_RECIPES.map((recipe) => [recipe.title, recipe] as const))(
    'recipe "%s"',
    (_title, recipe) => {
      it('has at least one course and a base of 2 to 8 servings', () => {
        expect(recipe.courses.length).toBeGreaterThanOrEqual(1);
        expect(recipe.servings_base).toBeGreaterThanOrEqual(2);
        expect(recipe.servings_base).toBeLessThanOrEqual(8);
      });

      it('has every ingredient in the table, with the same category', () => {
        for (const ingredient of recipe.ingredients) {
          const name = normalizeCanonicalName(ingredient.canonical_name);
          const fact = factsMap.get(name);
          expect(fact, `ingrediente senza voce: ${name}`).toBeDefined();
          expect(ingredient.category).toBe(fact?.category);
        }
      });

      it('has diet flags derived from the ingredient table', () => {
        expect(recipe.diet_flags).toEqual(deriveDietFlags(recipe.ingredients, factsMap));
      });

      it('has style tags derived from courses and ingredients', () => {
        expect(recipe.tags).toEqual(deriveStyleTags(recipe.tags, recipe.courses, recipe.ingredients));
      });

      it('has no ingredient name that is an alias of another ingredient', () => {
        for (const ingredient of recipe.ingredients) {
          expect(aliasNames.has(normalizeCanonicalName(ingredient.canonical_name))).toBe(false);
        }
      });
    }
  );

  it('has no two recipes with the same or similar normalized titles', () => {
    for (let i = 0; i < RECIPE_PACK_RECIPES.length; i++) {
      for (let j = i + 1; j < RECIPE_PACK_RECIPES.length; j++) {
        const a = RECIPE_PACK_RECIPES[i]!;
        const b = RECIPE_PACK_RECIPES[j]!;
        expect(normalizeTitle(a.title), `${a.title} / ${b.title}`).not.toBe(normalizeTitle(b.title));
        expect(areTitlesSimilar(a.title, b.title), `${a.title} / ${b.title}`).toBe(false);
      }
    }
  });

  it('contains no URL or source-site name', () => {
    const text = JSON.stringify(rawPack).toLowerCase();
    expect(text).not.toContain('http');
    expect(text).not.toContain('www.');
    expect(text).not.toContain('giallozafferano');
  });
});
