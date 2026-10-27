import { describe, it, expect, beforeAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import {
  isDbAvailable,
  assertDbMigrated,
  createTestHousehold,
  deleteTestHousehold,
} from '@/tests/helpers/db';
import {
  UNIT_VALUES,
  CATEGORY_VALUES,
  MEAL_TYPE_VALUES,
  DIET_FLAG_VALUES,
  MEAL_STYLE_TAG_VALUES,
  APPLIANCE_VALUES,
  PLAN_STATUS_VALUES,
  RECIPE_SOURCE_VALUES,
  INGREDIENT_PREF_VALUES,
  UnitSchema,
  CategorySchema,
  MealTypeSchema,
  DietFlagSchema,
  MealStyleTagSchema,
  ApplianceSchema,
  PlanStatusSchema,
  RecipeSourceSchema,
  IngredientPrefSchema,
  IngredientSchema,
  RecipeSchema,
  RecipePrefSchema,
  HouseholdSchema,
  MealPlanSchema,
  PlanSlotSchema,
  ShoppingListSchema,
  ShoppingItemSchema,
  IngredientAliasSchema,
  DEFAULT_HOUSEHOLD,
  DEFAULT_HOUSEHOLD_ID,
} from '@/lib/domain/types';
import * as dbSchema from '@/lib/db/schema';

describe('WP2 Domain Types & Zod Schemas', () => {
  it('defines all required closed enum constant arrays', () => {
    expect(UNIT_VALUES).toEqual(['g', 'ml', 'pz', 'qb']);
    expect(CATEGORY_VALUES).toEqual([
      'ortofrutta',
      'pane',
      'macelleria',
      'pescheria',
      'banco-frigo',
      'dispensa',
      'surgelati',
      'bevande',
      'altro',
    ]);
    expect(MEAL_TYPE_VALUES).toEqual(['pranzo', 'cena']);
    expect(DIET_FLAG_VALUES).toEqual([
      'vegetariano',
      'vegano',
      'senza-glutine',
      'senza-lattosio',
      'pescetariano',
    ]);
    expect(MEAL_STYLE_TAG_VALUES).toEqual([
      'veloce',
      'salutare',
      'proteico',
      'leggero',
      'comfort-food',
      'economico',
      'tradizionale',
      'dal-mondo',
      'pochi-ingredienti',
      'in-anticipo',
      'piatto-freddo',
    ]);
    expect(APPLIANCE_VALUES).toEqual([
      'fornelli',
      'forno',
      'microonde',
      'friggitrice-ad-aria',
      'frullatore',
    ]);
    expect(PLAN_STATUS_VALUES).toEqual(['draft', 'active', 'archived']);
    expect(RECIPE_SOURCE_VALUES).toEqual(['llm', 'manual']);
    expect(INGREDIENT_PREF_VALUES).toEqual(['like', 'dislike']);
  });

  it('validates enum schemas and rejects invalid values', () => {
    expect(UnitSchema.safeParse('g').success).toBe(true);
    expect(UnitSchema.safeParse('kg').success).toBe(false);

    expect(CategorySchema.safeParse('ortofrutta').success).toBe(true);
    expect(CategorySchema.safeParse('farmacia').success).toBe(false);

    expect(MealTypeSchema.safeParse('pranzo').success).toBe(true);
    expect(MealTypeSchema.safeParse('colazione').success).toBe(false);

    expect(DietFlagSchema.safeParse('vegetariano').success).toBe(true);
    expect(DietFlagSchema.safeParse('carnivoro').success).toBe(false);

    expect(MealStyleTagSchema.safeParse('veloce').success).toBe(true);
    expect(MealStyleTagSchema.safeParse('gourmet').success).toBe(false);

    expect(ApplianceSchema.safeParse('fornelli').success).toBe(true);
    expect(ApplianceSchema.safeParse('barbecue').success).toBe(false);

    expect(PlanStatusSchema.safeParse('active').success).toBe(true);
    expect(PlanStatusSchema.safeParse('cancelled').success).toBe(false);

    expect(RecipeSourceSchema.safeParse('llm').success).toBe(true);
    expect(RecipeSourceSchema.safeParse('crawler').success).toBe(false);

    expect(IngredientPrefSchema.safeParse('like').success).toBe(true);
    expect(IngredientPrefSchema.safeParse('neutral').success).toBe(false);
  });

  it('validates IngredientSchema', () => {
    const validIngredient = {
      canonical_name: 'petto di pollo',
      display_name: 'petto di pollo a fette',
      qty: 300,
      unit: 'g',
      category: 'macelleria',
      note: 'tagliato fine',
    };
    const parsed = IngredientSchema.parse(validIngredient);
    expect(parsed.canonical_name).toBe('petto di pollo');
    expect(parsed.qty).toBe(300);

    const qbIngredient = {
      canonical_name: 'sale fino',
      display_name: 'sale',
      unit: 'qb',
      category: 'dispensa',
    };
    expect(IngredientSchema.safeParse(qbIngredient).success).toBe(true);

    const invalid = { canonical_name: '', unit: 'invalid', category: 'unknown' };
    expect(IngredientSchema.safeParse(invalid).success).toBe(false);
  });

  it('validates RecipeSchema and RecipePrefSchema', () => {
    const validRecipe = {
      id: 'a0000000-0000-0000-0000-000000000001',
      household_id: DEFAULT_HOUSEHOLD_ID,
      title: 'Pasta al pomodoro',
      slug: 'pasta-al-pomodoro',
      description: 'Un grande classico della cucina italiana',
      steps: ['Bollire l acqua', 'Cuocere la pasta', 'Condire con sugo'],
      meal_types: ['pranzo', 'cena'],
      tags: ['veloce', 'economico'],
      diet_flags: ['vegetariano'],
      appliances_required: ['fornelli'],
      servings_base: 2,
      prep_minutes: 15,
      kcal_est: 450,
      macros_est: { carbs: 70, protein: 12, fat: 8 },
      source: 'manual',
      created_at: new Date('2026-01-01T00:00:00Z'),
    };

    const parsed = RecipeSchema.parse(validRecipe);
    expect(parsed.title).toBe('Pasta al pomodoro');
    expect(parsed.servings_base).toBe(2);

    const validPref = {
      recipe_id: validRecipe.id,
      rating: 5,
      favorite: true,
      blocked: false,
      times_used: 3,
      last_used_at: new Date(),
    };
    expect(RecipePrefSchema.safeParse(validPref).success).toBe(true);
  });

  it('validates HouseholdSchema and DEFAULT_HOUSEHOLD singleton', () => {
    expect(DEFAULT_HOUSEHOLD.id).toBe(DEFAULT_HOUSEHOLD_ID);
    expect(DEFAULT_HOUSEHOLD.persons).toBe(2);
    expect(DEFAULT_HOUSEHOLD.meals).toContain('pranzo');
    expect(DEFAULT_HOUSEHOLD.meals).toContain('cena');

    const parsed = HouseholdSchema.parse(DEFAULT_HOUSEHOLD);
    expect(parsed.id).toBe(DEFAULT_HOUSEHOLD_ID);
    expect(parsed.appliances).toContain('fornelli');
  });

  it('validates MealPlan, PlanSlot, ShoppingList, ShoppingItem and IngredientAlias schemas', () => {
    const planId = 'b0000000-0000-0000-0000-000000000001';
    const mealPlan = {
      id: planId,
      household_id: DEFAULT_HOUSEHOLD_ID,
      week_start: '2026-09-21',
      status: 'draft',
      created_at: new Date(),
    };
    expect(MealPlanSchema.safeParse(mealPlan).success).toBe(true);

    const slot = {
      id: 'c0000000-0000-0000-0000-000000000001',
      plan_id: planId,
      day: '2026-09-21',
      meal: 'pranzo',
      course: 'piatto-unico',
      recipe_id: 'a0000000-0000-0000-0000-000000000001',
      servings: 2,
      locked: false,
    };
    expect(PlanSlotSchema.safeParse(slot).success).toBe(true);
    expect(PlanSlotSchema.safeParse({ ...slot, course: undefined }).success).toBe(false);

    const listId = 'd0000000-0000-0000-0000-000000000001';
    const shoppingList = {
      id: listId,
      plan_id: planId,
      generated_at: new Date(),
    };
    expect(ShoppingListSchema.safeParse(shoppingList).success).toBe(true);

    const item = {
      id: 'e0000000-0000-0000-0000-000000000001',
      list_id: listId,
      canonical_name: 'pomodori pelati',
      qty: 400,
      unit: 'g',
      category: 'dispensa',
      checked: false,
      manual: false,
      recipe_ids: ['a0000000-0000-0000-0000-000000000001'],
    };
    expect(ShoppingItemSchema.safeParse(item).success).toBe(true);

    const alias = {
      alias: 'pelati',
      canonical_name: 'pomodori pelati',
    };
    expect(IngredientAliasSchema.safeParse(alias).success).toBe(true);
  });
});

describe('WP2 Drizzle Schema & Table Definitions', () => {
  it('exports all 10 required tables and their relations', () => {
    expect(dbSchema.households).toBeDefined();
    expect(dbSchema.recipes).toBeDefined();
    expect(dbSchema.recipe_ingredients).toBeDefined();
    expect(dbSchema.recipe_prefs).toBeDefined();
    expect(dbSchema.meal_plans).toBeDefined();
    expect(dbSchema.plan_slots).toBeDefined();
    expect(dbSchema.shopping_lists).toBeDefined();
    expect(dbSchema.shopping_items).toBeDefined();
    expect(dbSchema.ingredient_aliases).toBeDefined();
    expect(dbSchema.ingredient_prefs).toBeDefined();

    expect(dbSchema.householdsRelations).toBeDefined();
    expect(dbSchema.recipesRelations).toBeDefined();
    expect(dbSchema.recipeIngredientsRelations).toBeDefined();
    expect(dbSchema.recipePrefsRelations).toBeDefined();
    expect(dbSchema.mealPlansRelations).toBeDefined();
    expect(dbSchema.planSlotsRelations).toBeDefined();
    expect(dbSchema.shoppingListsRelations).toBeDefined();
    expect(dbSchema.shoppingItemsRelations).toBeDefined();
  });

  it('has correct columns on households table', () => {
    const cols = Object.keys(dbSchema.households);
    expect(cols).toContain('id');
    expect(cols).toContain('persons');
    expect(cols).toContain('meals');
    expect(cols).toContain('diet_tags');
    expect(cols).toContain('meal_style_tags');
    expect(cols).toContain('appliances');
    expect(cols).toContain('created_at');
    expect(cols).toContain('updated_at');
  });

  it('has correct columns on recipes table', () => {
    const cols = Object.keys(dbSchema.recipes);
    expect(cols).toContain('id');
    expect(cols).toContain('household_id');
    expect(cols).toContain('title');
    expect(cols).toContain('slug');
    expect(cols).toContain('description');
    expect(cols).toContain('steps');
    expect(cols).toContain('meal_types');
    expect(cols).toContain('tags');
    expect(cols).toContain('diet_flags');
    expect(cols).toContain('appliances_required');
    expect(cols).toContain('servings_base');
    expect(cols).toContain('prep_minutes');
    expect(cols).toContain('kcal_est');
    expect(cols).toContain('macros_est');
    expect(cols).toContain('source');
    expect(cols).toContain('created_at');
  });

  it('has correct columns on recipe_ingredients table', () => {
    const cols = Object.keys(dbSchema.recipe_ingredients);
    expect(cols).toContain('id');
    expect(cols).toContain('recipe_id');
    expect(cols).toContain('canonical_name');
    expect(cols).toContain('display_name');
    expect(cols).toContain('qty');
    expect(cols).toContain('unit');
    expect(cols).toContain('category');
    expect(cols).toContain('note');
  });

  it('has generation tracking columns on meal_plans and shopping_lists', () => {
    expect(Object.keys(dbSchema.meal_plans)).toContain('generated_at');
    expect(Object.keys(dbSchema.shopping_lists)).toContain('needs_regeneration');
  });

  it('has correct columns on recipe_prefs table', () => {
    const cols = Object.keys(dbSchema.recipe_prefs);
    expect(cols).toContain('recipe_id');
    expect(cols).toContain('rating');
    expect(cols).toContain('favorite');
    expect(cols).toContain('blocked');
    expect(cols).toContain('times_used');
    expect(cols).toContain('last_used_at');
  });

  it('has correct columns on ingredient_prefs table', () => {
    const cols = Object.keys(dbSchema.ingredient_prefs);
    expect(cols).toContain('household_id');
    expect(cols).toContain('canonical_name');
    expect(cols).toContain('pref');
    expect(cols).toContain('created_at');
  });
});

describe('WP2 Migration Generation & File Verification', () => {
  const migrationsDir = path.resolve(__dirname, '../../lib/db/migrations');
  const metaDir = path.join(migrationsDir, 'meta');

  it('produces valid migration SQL file creating all 9 tables', () => {
    const sqlFiles = fs
      .readdirSync(migrationsDir)
      .filter((f) => f.endsWith('.sql'));
    expect(sqlFiles.length).toBeGreaterThan(0);

    const mainSql = fs.readFileSync(path.join(migrationsDir, sqlFiles[0]), 'utf-8');
    expect(mainSql).toContain('CREATE TABLE "households"');
    expect(mainSql).toContain('CREATE TABLE "recipes"');
    expect(mainSql).toContain('CREATE TABLE "recipe_ingredients"');
    expect(mainSql).toContain('CREATE TABLE "recipe_prefs"');
    expect(mainSql).toContain('CREATE TABLE "meal_plans"');
    expect(mainSql).toContain('CREATE TABLE "plan_slots"');
    expect(mainSql).toContain('CREATE TABLE "shopping_lists"');
    expect(mainSql).toContain('CREATE TABLE "shopping_items"');
    expect(mainSql).toContain('CREATE TABLE "ingredient_aliases"');
  });

  it('includes required indexes and foreign keys in the migration SQL', () => {
    const sqlFiles = fs
      .readdirSync(migrationsDir)
      .filter((f) => f.endsWith('.sql'));
    const mainSql = fs.readFileSync(path.join(migrationsDir, sqlFiles[0]), 'utf-8');

    expect(mainSql).toContain('"recipes_tags_idx"');
    expect(mainSql).toContain('"recipes_diet_flags_idx"');
    expect(mainSql).toContain('"recipes_title_trgm_idx"');
    expect(mainSql).toContain('"shopping_items_list_category_idx"');
    expect(mainSql).toContain('ON DELETE cascade');
  });

  it('creates ingredient_prefs in migration 0004 with cascade on household delete', () => {
    const file = path.join(migrationsDir, '0004_add_ingredient_prefs.sql');
    expect(fs.existsSync(file)).toBe(true);
    const sql = fs.readFileSync(file, 'utf-8');
    expect(sql).toContain('CREATE TABLE "ingredient_prefs"');
    expect(sql).toContain('ON DELETE cascade');
  });

  it('produces valid Drizzle Kit metadata journal and snapshot files', () => {
    expect(fs.existsSync(path.join(metaDir, '_journal.json'))).toBe(true);
    expect(fs.existsSync(path.join(metaDir, '0000_snapshot.json'))).toBe(true);

    const journal = JSON.parse(
      fs.readFileSync(path.join(metaDir, '_journal.json'), 'utf-8')
    );
    expect(journal.version).toBe('7');
    expect(journal.entries.length).toBeGreaterThan(0);
  });
});

describe('WP2 Docker & DB Config Verification', () => {
  it('verifies docker-compose.dev.yml configuration', () => {
    const composePath = path.resolve(__dirname, '../../docker-compose.dev.yml');
    expect(fs.existsSync(composePath)).toBe(true);
    const content = fs.readFileSync(composePath, 'utf-8');
    expect(content).toContain('postgres:16-alpine');
    expect(content).toContain('mealy_dev');
    expect(content).toContain('5432:5432');
    expect(content).toContain('./docker/init-db.sql');
  });

  it('verifies docker/init-db.sql enables pg_trgm', () => {
    const initSqlPath = path.resolve(__dirname, '../../docker/init-db.sql');
    expect(fs.existsSync(initSqlPath)).toBe(true);
    const content = fs.readFileSync(initSqlPath, 'utf-8');
    expect(content).toContain('CREATE EXTENSION IF NOT EXISTS pg_trgm;');
  });

  it('verifies drizzle.config.ts configuration', () => {
    const drizzleConfigPath = path.resolve(__dirname, '../../drizzle.config.ts');
    expect(fs.existsSync(drizzleConfigPath)).toBe(true);
    const content = fs.readFileSync(drizzleConfigPath, 'utf-8');
    expect(content).toContain('./lib/db/schema.ts');
    expect(content).toContain('./lib/db/migrations');
    expect(content).toContain('postgresql');
  });
});

describe('WP2 Repository Pattern Integration & CRUD', () => {
  it('exports household repository functions', async () => {
    const householdRepo = await import('@/lib/db/repositories/household-repo');
    expect(typeof householdRepo.getDefaultHousehold).toBe('function');
    expect(typeof householdRepo.ensureDefaultHousehold).toBe('function');
    expect(typeof householdRepo.updateHousehold).toBe('function');
    expect(typeof householdRepo.getHouseholdById).toBe('function');
  });

  it('exports recipe repository functions', async () => {
    const recipeRepo = await import('@/lib/db/repositories/recipe-repo');
    expect(typeof recipeRepo.insertRecipe).toBe('function');
    expect(typeof recipeRepo.getRecipeById).toBe('function');
    expect(typeof recipeRepo.getRecipeBySlug).toBe('function');
    expect(typeof recipeRepo.deleteRecipe).toBe('function');
    expect(typeof recipeRepo.listRecipes).toBe('function');
  });
});

const dbUp = await isDbAvailable();

describe.skipIf(!dbUp)('WP2 PostgreSQL Live CRUD', () => {
  beforeAll(async () => {
    await assertDbMigrated();
  });

  it('executes live CRUD on PostgreSQL', async () => {
    const householdRepo = await import('@/lib/db/repositories/household-repo');
    const recipeRepo = await import('@/lib/db/repositories/recipe-repo');

    // 1. Ensure default household
    const household = await householdRepo.ensureDefaultHousehold();
    expect(household.id).toBe(DEFAULT_HOUSEHOLD_ID);

    // 2. Update household using an isolated test household
    const testId = await createTestHousehold();
    try {
      const updated = await householdRepo.updateHousehold({ persons: 4 }, testId);
      expect(updated.persons).toBe(4);

      // 3. Insert recipe with ingredients and preferences
      const testRecipeId = crypto.randomUUID();
      const recipe = await recipeRepo.insertRecipe(
        {
          id: testRecipeId,
          household_id: testId,
          title: 'Risotto ai funghi test',
          slug: `risotto-ai-funghi-${Date.now()}`,
          description: 'Risotto cremoso ai funghi',
          steps: ['Tostare il riso', 'Aggiungere brodo', 'Mantecare con burro e parmigiano'],
          meal_types: ['cena'],
          tags: ['comfort-food'],
          diet_flags: ['vegetariano'],
          appliances_required: ['fornelli'],
          servings_base: 2,
          prep_minutes: 30,
          kcal_est: 480,
          source: 'manual',
        },
        [
          {
            canonical_name: 'riso carnaroli',
            display_name: 'riso carnaroli',
            qty: 160,
            unit: 'g',
            category: 'dispensa',
          },
          {
            canonical_name: 'funghi porcini',
            display_name: 'funghi porcini secchi',
            qty: 30,
            unit: 'g',
            category: 'ortofrutta',
          },
        ],
        {
          rating: 5,
          favorite: true,
        }
      );

      expect(recipe.id).toBe(testRecipeId);
      expect(recipe.ingredients.length).toBe(2);
      expect(recipe.prefs?.rating).toBe(5);
      expect(recipe.prefs?.favorite).toBe(true);

      // 4. Retrieve by ID
      const fetchedById = await recipeRepo.getRecipeById(testRecipeId);
      expect(fetchedById?.title).toBe('Risotto ai funghi test');
      expect(fetchedById?.ingredients.length).toBe(2);

      // 5. Retrieve by Slug
      const fetchedBySlug = await recipeRepo.getRecipeBySlug(recipe.slug);
      expect(fetchedBySlug?.id).toBe(testRecipeId);

      // 6. Delete recipe and verify cascade delete
      const deleted = await recipeRepo.deleteRecipe(testRecipeId);
      expect(deleted).toBe(true);

      const afterDelete = await recipeRepo.getRecipeById(testRecipeId);
      expect(afterDelete).toBeNull();
    } finally {
      await deleteTestHousehold(testId);
    }
  });
});

