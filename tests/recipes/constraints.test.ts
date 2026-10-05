// @vitest-environment node

import { describe, it, expect } from 'vitest';
import {
  DEFAULT_HOUSEHOLD,
  type GeneratedRecipe,
  type Household,
  type RecipeConstraints,
} from '@/lib/domain/types';
import { toIngredientPreferenceSets } from '@/lib/domain/planner';
import {
  buildConstraints,
  findConstraintViolations,
  PROMPT_INGREDIENT_LIKES_MAX,
} from '@/lib/recipes/constraints';

describe('buildConstraints', () => {
  const testHousehold: Household = {
    ...DEFAULT_HOUSEHOLD,
    persons: 3,
    diet_tags: ['vegetariano'],
    meal_style_tags: ['veloce'],
    appliances: ['fornelli', 'forno'],
  };

  it('builds constraints using household defaults when no overrides are given', () => {
    const constraints = buildConstraints(testHousehold, 'cena');

    expect(constraints).toEqual({
      persons: 3,
      meal_type: 'cena',
      diet_tags: ['vegetariano'],
      meal_style_tags: ['veloce'],
      appliances: ['fornelli', 'forno'],
      ingredient_likes: [],
      ingredient_dislikes: [],
    });
  });

  it('supports null meal_type', () => {
    const constraints = buildConstraints(testHousehold, null);
    expect(constraints.meal_type).toBeNull();
  });

  it('applies overrides to specific fields while keeping others from household', () => {
    const constraints = buildConstraints(testHousehold, 'pranzo', {
      persons: 4,
      appliances: ['microonde'],
    });

    expect(constraints).toEqual({
      persons: 4,
      meal_type: 'pranzo',
      diet_tags: ['vegetariano'],
      meal_style_tags: ['veloce'],
      appliances: ['microonde'],
      ingredient_likes: [],
      ingredient_dislikes: [],
    });
  });

  it('applies diet_tags and meal_style_tags overrides', () => {
    const constraints = buildConstraints(testHousehold, null, {
      diet_tags: ['vegano', 'senza-glutine'],
      meal_style_tags: ['economico', 'salutare'],
    });

    expect(constraints.diet_tags).toEqual(['vegano', 'senza-glutine']);
    expect(constraints.meal_style_tags).toEqual(['economico', 'salutare']);
    expect(constraints.persons).toBe(3);
    expect(constraints.appliances).toEqual(['fornelli', 'forno']);
  });

  it('initializes ingredient_likes and ingredient_dislikes to empty arrays', () => {
    const constraints = buildConstraints(testHousehold, 'cena');
    expect(constraints.ingredient_likes).toEqual([]);
    expect(constraints.ingredient_dislikes).toEqual([]);
  });

  it('keeps both lists empty when ingredientPrefs is omitted', () => {
    const constraints = buildConstraints(testHousehold, 'cena', {}, undefined);
    expect(constraints.ingredient_likes).toEqual([]);
    expect(constraints.ingredient_dislikes).toEqual([]);
  });

  it('copies ingredient preferences into constraints sorted alphabetically', () => {
    const constraints = buildConstraints(
      testHousehold,
      'cena',
      undefined,
      toIngredientPreferenceSets(['zucchina', 'basilico'], ['cipolla', 'aglio'])
    );
    expect(constraints.ingredient_likes).toEqual(['basilico', 'zucchina']);
    expect(constraints.ingredient_dislikes).toEqual(['aglio', 'cipolla']);
  });

  it('caps ingredient_likes at PROMPT_INGREDIENT_LIKES_MAX', () => {
    const likes = Array.from({ length: 35 }, (_, i) => `ingrediente-${String(i).padStart(2, '0')}`);
    const constraints = buildConstraints(
      testHousehold,
      'cena',
      undefined,
      toIngredientPreferenceSets(likes, [])
    );
    expect(PROMPT_INGREDIENT_LIKES_MAX).toBe(30);
    expect(constraints.ingredient_likes).toHaveLength(30);
    expect(constraints.ingredient_likes).toEqual(likes.slice(0, 30));
  });

  it('keeps every ingredient dislike without capping', () => {
    const dislikes = Array.from({ length: 35 }, (_, i) => `ingrediente-${String(i).padStart(2, '0')}`);
    const constraints = buildConstraints(
      testHousehold,
      'cena',
      undefined,
      toIngredientPreferenceSets([], dislikes)
    );
    expect(constraints.ingredient_dislikes).toHaveLength(35);
  });
});

describe('findConstraintViolations', () => {
  const baseConstraints: RecipeConstraints = {
    persons: 2,
    meal_type: 'cena',
    diet_tags: ['vegetariano'],
    meal_style_tags: ['veloce'],
    appliances: ['fornelli', 'forno'],
    ingredient_likes: [],
    ingredient_dislikes: ['aglio', 'peperoncino'],
  };

  const validRecipe: GeneratedRecipe = {
    title: 'Frittata di verdure',
    description: 'Frittata semplice con zucchine',
    meal_types: ['cena'],
    tags: ['veloce'],
    diet_flags: ['vegetariano'],
    appliances_required: ['fornelli'],
    servings_base: 2,
    prep_minutes: 20,
    kcal_est: 350,
    steps: ['Sbatti le uova e cuoci in padella.'],
    ingredients: [
      {
        canonical_name: 'uovo',
        display_name: 'uova',
        qty: 4,
        unit: 'pz',
        category: 'banco-frigo',
        note: null,
      },
      {
        canonical_name: 'zucchina',
        display_name: 'zucchine',
        qty: 2,
        unit: 'pz',
        category: 'ortofrutta',
        note: null,
      },
    ],
  };

  it('returns empty array when recipe meets all constraints', () => {
    const violations = findConstraintViolations(validRecipe, baseConstraints);
    expect(violations).toEqual([]);
  });

  it('detects meal_type mismatch', () => {
    const recipe: GeneratedRecipe = {
      ...validRecipe,
      meal_types: ['pranzo'],
    };
    const violations = findConstraintViolations(recipe, baseConstraints);
    expect(violations).toEqual(['pasto "cena" mancante']);
  });

  it('does not flag meal_type when constraints.meal_type is null', () => {
    const constraints: RecipeConstraints = {
      ...baseConstraints,
      meal_type: null,
    };
    const recipe: GeneratedRecipe = {
      ...validRecipe,
      meal_types: ['pranzo'],
    };
    const violations = findConstraintViolations(recipe, constraints);
    expect(violations).toEqual([]);
  });

  it('detects missing diet tags', () => {
    const constraints: RecipeConstraints = {
      ...baseConstraints,
      diet_tags: ['vegano'],
    };
    const violations = findConstraintViolations(validRecipe, constraints);
    expect(violations).toEqual(['dieta "vegano" non rispettata']);
  });

  it('satisfies vegetariano when recipe has vegano (transitive diet implication)', () => {
    const veganRecipe: GeneratedRecipe = {
      ...validRecipe,
      diet_flags: ['vegano'],
    };
    const constraints: RecipeConstraints = {
      ...baseConstraints,
      diet_tags: ['vegetariano'],
    };
    const violations = findConstraintViolations(veganRecipe, constraints);
    expect(violations).toEqual([]);
  });

  it('detects missing appliances', () => {
    const recipe: GeneratedRecipe = {
      ...validRecipe,
      appliances_required: ['microonde', 'friggitrice-ad-aria'],
    };
    const violations = findConstraintViolations(recipe, baseConstraints);
    expect(violations).toEqual([
      'richiede "microonde" non disponibile',
      'richiede "friggitrice-ad-aria" non disponibile',
    ]);
  });

  it('considers recipe with empty appliances_required as always compliant', () => {
    const noApplianceRecipe: GeneratedRecipe = {
      ...validRecipe,
      appliances_required: [],
    };
    const constraints: RecipeConstraints = {
      ...baseConstraints,
      appliances: [],
    };
    const violations = findConstraintViolations(noApplianceRecipe, constraints);
    expect(violations).toEqual([]);
  });

  it('detects disliked ingredients with normalization (trim, case-insensitive, whitespace)', () => {
    const constraints: RecipeConstraints = {
      ...baseConstraints,
      ingredient_dislikes: ['Aglio '],
    };
    const recipeWithGarlic: GeneratedRecipe = {
      ...validRecipe,
      ingredients: [
        ...validRecipe.ingredients,
        {
          canonical_name: 'aglio',
          display_name: 'spicchio di aglio',
          qty: 1,
          unit: 'pz',
          category: 'ortofrutta',
          note: null,
        },
      ],
    };
    const violations = findConstraintViolations(recipeWithGarlic, constraints);
    expect(violations).toEqual(['contiene "aglio" (ingrediente escluso)']);
  });

  it('returns violations in exact check order (meal_type, diet_tags, appliances, dislikes)', () => {
    const multiViolationRecipe: GeneratedRecipe = {
      title: 'Piatto scorretto',
      description: 'Test con violazioni multiple',
      meal_types: ['pranzo'],
      tags: [],
      diet_flags: [],
      appliances_required: ['friggitrice-ad-aria'],
      servings_base: 2,
      prep_minutes: 20,
      kcal_est: null,
      steps: ['Passo 1'],
      ingredients: [
        {
          canonical_name: 'aglio',
          display_name: 'aglio',
          qty: 1,
          unit: 'pz',
          category: 'ortofrutta',
          note: null,
        },
      ],
    };

    const constraints: RecipeConstraints = {
      persons: 2,
      meal_type: 'cena',
      diet_tags: ['vegano'],
      meal_style_tags: [],
      appliances: ['fornelli'],
      ingredient_likes: [],
      ingredient_dislikes: ['aglio'],
    };

    const violations = findConstraintViolations(multiViolationRecipe, constraints);
    expect(violations).toEqual([
      'pasto "cena" mancante',
      'dieta "vegano" non rispettata',
      'richiede "friggitrice-ad-aria" non disponibile',
      'contiene "aglio" (ingrediente escluso)',
    ]);
  });
});
