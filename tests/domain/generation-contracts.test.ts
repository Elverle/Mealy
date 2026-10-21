// @vitest-environment node
import { describe, it, expect } from 'vitest';
import {
  GeneratedIngredientSchema,
  GeneratedRecipeSchema,
  GenerateRecipesOutputSchema,
  RecipeConstraintsSchema,
  ConstraintOverridesSchema,
  GenerateRecipesRequestSchema,
  GenerationSkipReasonSchema,
  GenerationSkipSchema,
  FixtureRecipeSchema,
  FixtureFileSchema,
  IngredientAliasesFileSchema,
  GENERATE_COUNT_MIN,
  GENERATE_COUNT_MAX,
  GENERATE_COUNT_DEFAULT,
} from '@/lib/domain/types';

describe('Recipe Generation Contracts (Feature 2)', () => {
  const validIngredient = {
    canonical_name: 'pasta',
    display_name: 'Pasta di semola',
    qty: 200,
    unit: 'g',
    category: 'dispensa',
    note: null,
  };

  const validRecipe = {
    title: 'Pasta al pomodoro fresco',
    description: 'Ricetta semplice e veloce',
    meal_types: ['pranzo'],
    courses: ['primo'],
    tags: ['veloce', 'economico'],
    diet_flags: ['vegetariano'],
    appliances_required: [], // valid with empty appliances
    servings_base: 2,
    prep_minutes: 15,
    kcal_est: 450,
    steps: ['Cuocere la pasta', 'Condire con sugo'],
    ingredients: [validIngredient],
  };

  describe('GeneratedIngredientSchema', () => {
    it('accepts valid generated ingredient with nullable qty and note', () => {
      const parsed = GeneratedIngredientSchema.parse(validIngredient);
      expect(parsed.canonical_name).toBe('pasta');
      expect(parsed.qty).toBe(200);

      const qbIngredient = {
        ...validIngredient,
        qty: null,
        unit: 'qb',
        note: 'a piacere',
      };
      expect(GeneratedIngredientSchema.safeParse(qbIngredient).success).toBe(true);
    });

    it('rejects invalid units or categories', () => {
      expect(
        GeneratedIngredientSchema.safeParse({
          ...validIngredient,
          unit: 'kg', // closed enum only supports g, ml, pz, qb
        }).success
      ).toBe(false);

      expect(
        GeneratedIngredientSchema.safeParse({
          ...validIngredient,
          category: 'frutta', // closed enum only supports ortofrutta, etc.
        }).success
      ).toBe(false);
    });

    it('rejects non-positive quantities when qty is not null', () => {
      expect(
        GeneratedIngredientSchema.safeParse({
          ...validIngredient,
          qty: 0,
        }).success
      ).toBe(false);

      expect(
        GeneratedIngredientSchema.safeParse({
          ...validIngredient,
          qty: -10,
        }).success
      ).toBe(false);
    });
  });

  describe('GeneratedRecipeSchema', () => {
    it('accepts valid recipe with appliances_required: []', () => {
      const parsed = GeneratedRecipeSchema.parse(validRecipe);
      expect(parsed.title).toBe('Pasta al pomodoro fresco');
      expect(parsed.appliances_required).toEqual([]);
    });

    it('rejects empty meal_types, empty steps, empty ingredients', () => {
      expect(
        GeneratedRecipeSchema.safeParse({
          ...validRecipe,
          meal_types: [],
        }).success
      ).toBe(false);

      expect(
        GeneratedRecipeSchema.safeParse({
          ...validRecipe,
          steps: [],
        }).success
      ).toBe(false);

      expect(
        GeneratedRecipeSchema.safeParse({
          ...validRecipe,
          ingredients: [],
        }).success
      ).toBe(false);
    });

    it('rejects servings_base: 0 and prep_minutes: 0', () => {
      expect(
        GeneratedRecipeSchema.safeParse({
          ...validRecipe,
          servings_base: 0,
        }).success
      ).toBe(false);

      expect(
        GeneratedRecipeSchema.safeParse({
          ...validRecipe,
          prep_minutes: 0,
        }).success
      ).toBe(false);
    });

    it('rejects invalid title length (min 3, max 120)', () => {
      expect(
        GeneratedRecipeSchema.safeParse({
          ...validRecipe,
          title: 'ab',
        }).success
      ).toBe(false);

      expect(
        GeneratedRecipeSchema.safeParse({
          ...validRecipe,
          title: 'a'.repeat(121),
        }).success
      ).toBe(false);
    });

    it('rejects recipe with invalid ingredient unit or category', () => {
      expect(
        GeneratedRecipeSchema.safeParse({
          ...validRecipe,
          ingredients: [{ ...validIngredient, unit: 'kg' }],
        }).success
      ).toBe(false);

      expect(
        GeneratedRecipeSchema.safeParse({
          ...validRecipe,
          ingredients: [{ ...validIngredient, category: 'frutta' }],
        }).success
      ).toBe(false);
    });
  });

  describe('GenerateRecipesOutputSchema', () => {
    it('accepts non-empty array of recipes', () => {
      expect(
        GenerateRecipesOutputSchema.safeParse({
          recipes: [validRecipe],
        }).success
      ).toBe(true);
    });

    it('rejects empty array of recipes', () => {
      expect(
        GenerateRecipesOutputSchema.safeParse({
          recipes: [],
        }).success
      ).toBe(false);
    });
  });

  describe('RecipeConstraintsSchema', () => {
    it('accepts valid constraints with empty lists', () => {
      const constraints = {
        persons: 2,
        meal_type: null,
        courses: null,
        diet_tags: [],
        meal_style_tags: [],
        appliances: [],
        ingredient_likes: [],
        ingredient_dislikes: [],
      };
      const parsed = RecipeConstraintsSchema.parse(constraints);
      expect(parsed.persons).toBe(2);
      expect(parsed.meal_type).toBeNull();
      expect(parsed.diet_tags).toEqual([]);
    });

    it('accepts null (any course) or a non-empty course list, and rejects an empty one', () => {
      const base = {
        persons: 2,
        meal_type: null,
        diet_tags: [],
        meal_style_tags: [],
        appliances: [],
        ingredient_likes: [],
        ingredient_dislikes: [],
      };
      expect(RecipeConstraintsSchema.safeParse({ ...base, courses: null }).success).toBe(true);
      expect(RecipeConstraintsSchema.safeParse({ ...base, courses: ['primo'] }).success).toBe(true);
      expect(RecipeConstraintsSchema.safeParse({ ...base, courses: [] }).success).toBe(false);
    });

    it('rejects persons out of 1-12 bounds', () => {
      expect(
        RecipeConstraintsSchema.safeParse({
          persons: 0,
          meal_type: null,
          courses: null,
          diet_tags: [],
          meal_style_tags: [],
          appliances: [],
          ingredient_likes: [],
          ingredient_dislikes: [],
        }).success
      ).toBe(false);

      expect(
        RecipeConstraintsSchema.safeParse({
          persons: 13,
          meal_type: null,
          courses: null,
          diet_tags: [],
          meal_style_tags: [],
          appliances: [],
          ingredient_likes: [],
          ingredient_dislikes: [],
        }).success
      ).toBe(false);
    });
  });

  describe('ConstraintOverridesSchema', () => {
    it('accepts partial overrides and rejects unknown keys', () => {
      expect(ConstraintOverridesSchema.safeParse({}).success).toBe(true);
      expect(ConstraintOverridesSchema.safeParse({ persons: 4 }).success).toBe(true);
      expect(
        ConstraintOverridesSchema.safeParse({
          household_id: 'x',
        }).success
      ).toBe(false);
    });
  });

  describe('GenerateRecipesRequestSchema', () => {
    it('applies defaults when parsing empty object', () => {
      const parsed = GenerateRecipesRequestSchema.parse({});
      expect(parsed).toEqual({
        count: 5,
        meal_type: null,
        overrides: {},
      });
      expect(GENERATE_COUNT_MIN).toBe(1);
      expect(GENERATE_COUNT_MAX).toBe(10);
      expect(GENERATE_COUNT_DEFAULT).toBe(5);
    });

    it('rejects count: 0, count: 11, and float count: 2.5', () => {
      expect(GenerateRecipesRequestSchema.safeParse({ count: 0 }).success).toBe(false);
      expect(GenerateRecipesRequestSchema.safeParse({ count: 11 }).success).toBe(false);
      expect(GenerateRecipesRequestSchema.safeParse({ count: 2.5 }).success).toBe(false);
    });

    it('rejects unknown top-level keys', () => {
      expect(
        GenerateRecipesRequestSchema.safeParse({
          foo: 1,
        }).success
      ).toBe(false);
    });

    it('rejects unknown keys in overrides', () => {
      expect(
        GenerateRecipesRequestSchema.safeParse({
          overrides: {
            household_id: 'x',
          },
        }).success
      ).toBe(false);
    });
  });

  describe('GenerationSkipSchema & GenerationSkipReasonSchema', () => {
    it('accepts valid skip reasons', () => {
      expect(GenerationSkipReasonSchema.safeParse('duplicate').success).toBe(true);
      expect(GenerationSkipReasonSchema.safeParse('constraint_violation').success).toBe(true);
      expect(GenerationSkipReasonSchema.safeParse('unknown').success).toBe(false);

      expect(
        GenerationSkipSchema.safeParse({
          title: 'Spaghetti',
          reason: 'duplicate',
          detail: 'Già presente nel database',
        }).success
      ).toBe(true);
    });
  });

  describe('Fixture Schemas', () => {
    const fixtureRecipe = {
      ...validRecipe,
      id: crypto.randomUUID(),
      slug: 'pasta-al-pomodoro-fresco',
    };

    it('validates FixtureRecipeSchema requiring id and slug', () => {
      expect(FixtureRecipeSchema.safeParse(fixtureRecipe).success).toBe(true);
      expect(FixtureRecipeSchema.safeParse(validRecipe).success).toBe(false); // missing id and slug
    });

    it('validates FixtureFileSchema bounds (15-20 recipes)', () => {
      const recipesUnder = Array.from({ length: 14 }, () => ({
        ...fixtureRecipe,
        id: crypto.randomUUID(),
      }));
      expect(FixtureFileSchema.safeParse({ recipes: recipesUnder }).success).toBe(false);

      const recipesValid = Array.from({ length: 16 }, () => ({
        ...fixtureRecipe,
        id: crypto.randomUUID(),
      }));
      expect(FixtureFileSchema.safeParse({ recipes: recipesValid }).success).toBe(true);

      const recipesOver = Array.from({ length: 21 }, () => ({
        ...fixtureRecipe,
        id: crypto.randomUUID(),
      }));
      expect(FixtureFileSchema.safeParse({ recipes: recipesOver }).success).toBe(false);
    });

    it('validates IngredientAliasesFileSchema requiring at least 15 aliases', () => {
      const validAliases = Array.from({ length: 15 }, (_, i) => ({
        alias: `alias_${i}`,
        canonical_name: `name_${i}`,
      }));
      expect(IngredientAliasesFileSchema.safeParse({ aliases: validAliases }).success).toBe(true);

      const tooFewAliases = Array.from({ length: 14 }, (_, i) => ({
        alias: `alias_${i}`,
        canonical_name: `name_${i}`,
      }));
      expect(IngredientAliasesFileSchema.safeParse({ aliases: tooFewAliases }).success).toBe(false);
    });

    it('rejects IngredientAliasesFileSchema when the same alias appears twice', () => {
      const aliases = Array.from({ length: 15 }, (_, i) => ({
        alias: `alias_${i}`,
        canonical_name: `name_${i}`,
      }));
      // Stesso alias e stesso nome canonico: il seed fallirebbe comunque (v. types.ts).
      const withDuplicate = [...aliases, { ...aliases[0] }];

      const result = IngredientAliasesFileSchema.safeParse({ aliases: withDuplicate });

      expect(result.success).toBe(false);
      expect(result.error?.issues[0].message).toBe('Lo stesso alias compare più di una volta.');
    });
  });
});
