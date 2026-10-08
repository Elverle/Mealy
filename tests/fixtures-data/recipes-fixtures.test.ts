// @vitest-environment node

import { describe, it, expect } from 'vitest';
import rawRecipes from '@/fixtures/recipes.json';
import rawAliases from '@/fixtures/ingredient-aliases.json';
import {
  FIXTURE_RECIPES,
  FIXTURE_INGREDIENT_ALIASES,
  fixtureRecipesAsDomain,
} from '@/fixtures';
import {
  FixtureFileSchema,
  IngredientAliasesFileSchema,
  APPLIANCE_VALUES,
  DEFAULT_HOUSEHOLD_ID,
  type FixtureRecipe,
  type GeneratedRecipe,
} from '@/lib/domain/types';
import {
  normalizeTitle,
  normalizeCanonicalName,
  slugify,
  normalizeGeneratedRecipe,
} from '@/lib/domain/recipe-text';

function stripIdSlug(r: FixtureRecipe): GeneratedRecipe {
  const { id: _id, slug: _slug, ...rest } = r;
  return rest;
}

describe('Fixtures Data & Validation', () => {
  it('raw fixtures parse successfully against their Zod schemas', () => {
    const parsedRecipes = FixtureFileSchema.parse(rawRecipes);
    expect(parsedRecipes.recipes).toHaveLength(18);

    const parsedAliases = IngredientAliasesFileSchema.parse(rawAliases);
    expect(parsedAliases.aliases.length).toBeGreaterThanOrEqual(15);
  });

  it('contains exactly 18 recipes with unique IDs and slugs', () => {
    expect(FIXTURE_RECIPES).toHaveLength(18);

    const ids = FIXTURE_RECIPES.map((r) => r.id);
    const slugs = FIXTURE_RECIPES.map((r) => r.slug);

    expect(new Set(ids).size).toBe(18);
    expect(new Set(slugs).size).toBe(18);

    for (const r of FIXTURE_RECIPES) {
      expect(r.slug).toBe(slugify(r.title));
    }
  });

  it('has unique normalized titles', () => {
    const normalizedTitles = FIXTURE_RECIPES.map((r) => normalizeTitle(r.title));
    expect(new Set(normalizedTitles).size).toBe(18);
  });

  it('all recipes are already normalized (normalizeGeneratedRecipe leaves them identical)', () => {
    for (const r of FIXTURE_RECIPES) {
      const stripped = stripIdSlug(r);
      const normalized = normalizeGeneratedRecipe(stripped);
      expect(normalized).toEqual(stripped);
    }
  });

  it('satisfies meal_type distribution constraints (solo-pranzo >= 5, solo-cena >= 5, both >= 3)', () => {
    const soloPranzo = FIXTURE_RECIPES.filter(
      (r) => r.meal_types.includes('pranzo') && !r.meal_types.includes('cena')
    );
    const soloCena = FIXTURE_RECIPES.filter(
      (r) => r.meal_types.includes('cena') && !r.meal_types.includes('pranzo')
    );
    const both = FIXTURE_RECIPES.filter(
      (r) => r.meal_types.includes('pranzo') && r.meal_types.includes('cena')
    );

    expect(soloPranzo.length).toBeGreaterThanOrEqual(5);
    expect(soloCena.length).toBeGreaterThanOrEqual(5);
    expect(both.length).toBeGreaterThanOrEqual(3);
  });

  it('satisfies diet flags constraints (vegano >= 5, pescetariano without vegetariano >= 3)', () => {
    const vegano = FIXTURE_RECIPES.filter((r) => r.diet_flags.includes('vegano'));
    const pescetarianoNoVeg = FIXTURE_RECIPES.filter(
      (r) => r.diet_flags.includes('pescetariano') && !r.diet_flags.includes('vegetariano')
    );

    expect(vegano.length).toBeGreaterThanOrEqual(5);
    expect(pescetarianoNoVeg.length).toBeGreaterThanOrEqual(3);
  });

  it('satisfies appliance constraints (every APPLIANCE_VALUES in >= 1 recipe, at least 1 empty)', () => {
    for (const appliance of APPLIANCE_VALUES) {
      const matching = FIXTURE_RECIPES.filter((r) =>
        r.appliances_required.includes(appliance)
      );
      expect(matching.length).toBeGreaterThanOrEqual(1);
    }

    const emptyAppliances = FIXTURE_RECIPES.filter((r) => r.appliances_required.length === 0);
    expect(emptyAppliances.length).toBeGreaterThanOrEqual(1);
  });

  it('covers at least 8 distinct categories across all ingredients', () => {
    const categories = new Set<string>();
    for (const r of FIXTURE_RECIPES) {
      for (const ing of r.ingredients) {
        categories.add(ing.category);
      }
    }
    expect(categories.size).toBeGreaterThanOrEqual(8);
  });

  it('contains olio extravergine di oliva in at least 8 recipes', () => {
    const withOlio = FIXTURE_RECIPES.filter((r) =>
      r.ingredients.some(
        (ing) =>
          ing.canonical_name === 'olio extravergine di oliva' &&
          ing.unit === 'ml' &&
          ing.category === 'dispensa'
      )
    );
    expect(withOlio.length).toBeGreaterThanOrEqual(8);
  });

  it('contains at least 6 recipes with a qb ingredient and all qb ingredients have qty === null', () => {
    const withQb = FIXTURE_RECIPES.filter((r) =>
      r.ingredients.some((ing) => ing.unit === 'qb')
    );
    expect(withQb.length).toBeGreaterThanOrEqual(6);

    for (const r of FIXTURE_RECIPES) {
      for (const ing of r.ingredients) {
        if (ing.unit === 'qb') {
          expect(ing.qty).toBeNull();
        } else {
          expect(ing.qty).toBeTypeOf('number');
          expect(ing.qty).toBeGreaterThan(0);
        }
      }
    }
  });

  it('contains at least one canonical_name used with two different units across recipes', () => {
    const unitsPerCanonical = new Map<string, Set<string>>();
    for (const r of FIXTURE_RECIPES) {
      for (const ing of r.ingredients) {
        if (!unitsPerCanonical.has(ing.canonical_name)) {
          unitsPerCanonical.set(ing.canonical_name, new Set());
        }
        unitsPerCanonical.get(ing.canonical_name)!.add(ing.unit);
      }
    }

    const multiUnitCanonicals = Array.from(unitsPerCanonical.entries()).filter(
      ([, units]) => units.size >= 2
    );

    expect(multiUnitCanonicals.length).toBeGreaterThanOrEqual(1);
    expect(unitsPerCanonical.get('pomodorino')?.has('g')).toBe(true);
    expect(unitsPerCanonical.get('pomodorino')?.has('pz')).toBe(true);
  });

  it('ensures no canonical_name is an alias from ingredient-aliases.json', () => {
    const aliasNames = new Set(FIXTURE_INGREDIENT_ALIASES.map((a) => a.alias));
    expect(aliasNames.size).toBe(35);

    for (const r of FIXTURE_RECIPES) {
      for (const ing of r.ingredients) {
        expect(aliasNames.has(ing.canonical_name)).toBe(false);
      }
    }
  });

  it('has normalized aliases without chains', () => {
    const aliasNames = new Set(FIXTURE_INGREDIENT_ALIASES.map((a) => a.alias));

    for (const entry of FIXTURE_INGREDIENT_ALIASES) {
      expect(entry.alias).toBe(normalizeCanonicalName(entry.alias));
      expect(entry.canonical_name).toBe(normalizeCanonicalName(entry.canonical_name));
      expect(entry.alias).not.toBe(entry.canonical_name);
      expect(aliasNames.has(entry.canonical_name)).toBe(false);
    }
  });

  it('kcal_est is null for recipes 04 and 16, and positive integer for others', () => {
    const recipe04 = FIXTURE_RECIPES.find((r) => r.id.endsWith('04'));
    const recipe16 = FIXTURE_RECIPES.find((r) => r.id.endsWith('16'));

    expect(recipe04).toBeDefined();
    expect(recipe04?.kcal_est).toBeNull();

    expect(recipe16).toBeDefined();
    expect(recipe16?.kcal_est).toBeNull();

    for (const r of FIXTURE_RECIPES) {
      if (r.id.endsWith('04') || r.id.endsWith('16')) {
        expect(r.kcal_est).toBeNull();
      } else {
        expect(r.kcal_est).toBeTypeOf('number');
        expect(r.kcal_est).toBeGreaterThan(0);
      }
    }
  });

  it('fixtureRecipesAsDomain returns 18 Recipe objects with default household id', () => {
    const domainRecipes = fixtureRecipesAsDomain();
    expect(domainRecipes).toHaveLength(18);

    for (const r of domainRecipes) {
      expect(r.household_id).toBe(DEFAULT_HOUSEHOLD_ID);
      expect(r.source).toBe('manual');
      expect(r.macros_est).toBeNull();
      expect(r.prefs).toBeNull();
      expect(r.ingredients).toBeDefined();
      expect(r.ingredients!.length).toBeGreaterThanOrEqual(4);
      for (const ing of r.ingredients!) {
        expect(ing.recipe_id).toBe(r.id);
      }
    }
  });
});
