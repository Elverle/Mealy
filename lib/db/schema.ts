import { relations, sql } from 'drizzle-orm';
import {
  boolean,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

// ============================================================================
// 1. Households Table (singleton in v1)
// ============================================================================
export const households = pgTable('households', {
  id: uuid('id').defaultRandom().primaryKey(),
  persons: integer('persons').notNull(),
  meals: text('meals').array().notNull(),
  diet_tags: text('diet_tags').array().notNull().default(sql`ARRAY[]::text[]`),
  meal_style_tags: text('meal_style_tags').array().notNull().default(sql`ARRAY[]::text[]`),
  appliances: text('appliances').array().notNull().default(sql`ARRAY[]::text[]`),
  onboarded_at: timestamp('onboarded_at', { withTimezone: true }),
  created_at: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updated_at: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

export const householdsRelations = relations(households, ({ many }) => ({
  recipes: many(recipes),
  meal_plans: many(meal_plans),
}));

// ============================================================================
// 2. Recipes Table
// ============================================================================
export const recipes = pgTable(
  'recipes',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    household_id: uuid('household_id')
      .notNull()
      .references(() => households.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    slug: text('slug').notNull().unique(),
    description: text('description').notNull().default(''),
    steps: jsonb('steps').$type<string[]>().notNull(),
    meal_types: text('meal_types').array().notNull(),
    courses: text('courses').array().notNull().default(sql`ARRAY[]::text[]`),
    tags: text('tags').array().notNull().default(sql`ARRAY[]::text[]`),
    diet_flags: text('diet_flags').array().notNull().default(sql`ARRAY[]::text[]`),
    appliances_required: text('appliances_required').array().notNull().default(sql`ARRAY[]::text[]`),
    servings_base: integer('servings_base').notNull(),
    prep_minutes: integer('prep_minutes').notNull(),
    kcal_est: integer('kcal_est'),
    macros_est: jsonb('macros_est').$type<Record<string, unknown> | null>(),
    source: text('source').notNull().default('manual'),
    created_at: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('recipes_household_id_idx').on(table.household_id),
    index('recipes_tags_idx').using('gin', table.tags),
    index('recipes_diet_flags_idx').using('gin', table.diet_flags),
    index('recipes_title_trgm_idx').using('gin', sql`${table.title} gin_trgm_ops`),
  ]
);

export const recipesRelations = relations(recipes, ({ one, many }) => ({
  household: one(households, {
    fields: [recipes.household_id],
    references: [households.id],
  }),
  ingredients: many(recipe_ingredients),
  prefs: one(recipe_prefs, {
    fields: [recipes.id],
    references: [recipe_prefs.recipe_id],
  }),
  plan_slots: many(plan_slots),
}));

// ============================================================================
// 3. Recipe Ingredients Table
// ============================================================================
export const recipe_ingredients = pgTable(
  'recipe_ingredients',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    recipe_id: uuid('recipe_id')
      .notNull()
      .references(() => recipes.id, { onDelete: 'cascade' }),
    canonical_name: text('canonical_name').notNull(),
    display_name: text('display_name').notNull(),
    qty: numeric('qty'),
    unit: text('unit').notNull(),
    category: text('category').notNull(),
    note: text('note'),
  },
  (table) => [
    index('recipe_ingredients_recipe_id_idx').on(table.recipe_id),
    index('recipe_ingredients_canonical_name_idx').on(table.canonical_name),
  ]
);

export const recipeIngredientsRelations = relations(recipe_ingredients, ({ one }) => ({
  recipe: one(recipes, {
    fields: [recipe_ingredients.recipe_id],
    references: [recipes.id],
  }),
}));

// ============================================================================
// 4. Recipe Prefs Table (1:1 with recipes in v1)
// ============================================================================
export const recipe_prefs = pgTable('recipe_prefs', {
  recipe_id: uuid('recipe_id')
    .primaryKey()
    .references(() => recipes.id, { onDelete: 'cascade' }),
  rating: integer('rating'),
  favorite: boolean('favorite').notNull().default(false),
  blocked: boolean('blocked').notNull().default(false),
  times_used: integer('times_used').notNull().default(0),
  last_used_at: timestamp('last_used_at', { withTimezone: true }),
});

export const recipePrefsRelations = relations(recipe_prefs, ({ one }) => ({
  recipe: one(recipes, {
    fields: [recipe_prefs.recipe_id],
    references: [recipes.id],
  }),
}));

// ============================================================================
// 5. Meal Plans Table
// ============================================================================
export const meal_plans = pgTable(
  'meal_plans',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    household_id: uuid('household_id')
      .notNull()
      .references(() => households.id, { onDelete: 'cascade' }),
    week_start: date('week_start').notNull(),
    status: text('status').notNull().default('draft'),
    created_at: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    generated_at: timestamp('generated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('meal_plans_household_week_idx').on(table.household_id, table.week_start),
  ]
);

export const mealPlansRelations = relations(meal_plans, ({ one, many }) => ({
  household: one(households, {
    fields: [meal_plans.household_id],
    references: [households.id],
  }),
  slots: many(plan_slots),
  shopping_list: one(shopping_lists, {
    fields: [meal_plans.id],
    references: [shopping_lists.plan_id],
  }),
}));

// ============================================================================
// 6. Plan Slots Table
// ============================================================================
export const plan_slots = pgTable(
  'plan_slots',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    plan_id: uuid('plan_id')
      .notNull()
      .references(() => meal_plans.id, { onDelete: 'cascade' }),
    day: date('day').notNull(),
    meal: text('meal').notNull(),
    recipe_id: uuid('recipe_id').references(() => recipes.id, { onDelete: 'set null' }),
    servings: integer('servings').notNull(),
    locked: boolean('locked').notNull().default(false),
  },
  (table) => [
    uniqueIndex('plan_slots_plan_day_meal_idx').on(table.plan_id, table.day, table.meal),
  ]
);

export const planSlotsRelations = relations(plan_slots, ({ one }) => ({
  plan: one(meal_plans, {
    fields: [plan_slots.plan_id],
    references: [meal_plans.id],
  }),
  recipe: one(recipes, {
    fields: [plan_slots.recipe_id],
    references: [recipes.id],
  }),
}));

// ============================================================================
// 7. Shopping Lists Table (1:1 with meal_plans)
// ============================================================================
export const shopping_lists = pgTable('shopping_lists', {
  id: uuid('id').defaultRandom().primaryKey(),
  plan_id: uuid('plan_id')
    .notNull()
    .references(() => meal_plans.id, { onDelete: 'cascade' })
    .unique(),
  generated_at: timestamp('generated_at', { withTimezone: true }).defaultNow().notNull(),
  needs_regeneration: boolean('needs_regeneration').notNull().default(false),
});

export const shoppingListsRelations = relations(shopping_lists, ({ one, many }) => ({
  plan: one(meal_plans, {
    fields: [shopping_lists.plan_id],
    references: [meal_plans.id],
  }),
  items: many(shopping_items),
}));

// ============================================================================
// 8. Shopping Items Table
// ============================================================================
export const shopping_items = pgTable(
  'shopping_items',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    list_id: uuid('list_id')
      .notNull()
      .references(() => shopping_lists.id, { onDelete: 'cascade' }),
    canonical_name: text('canonical_name').notNull(),
    qty: numeric('qty'),
    unit: text('unit'),
    category: text('category').notNull(),
    checked: boolean('checked').notNull().default(false),
    manual: boolean('manual').notNull().default(false),
    recipe_ids: uuid('recipe_ids').array().notNull().default(sql`ARRAY[]::uuid[]`),
  },
  (table) => [
    index('shopping_items_list_category_idx').on(table.list_id, table.category),
  ]
);

export const shoppingItemsRelations = relations(shopping_items, ({ one }) => ({
  list: one(shopping_lists, {
    fields: [shopping_items.list_id],
    references: [shopping_lists.id],
  }),
}));

// ============================================================================
// 9. Ingredient Aliases Table
// ============================================================================
export const ingredient_aliases = pgTable('ingredient_aliases', {
  alias: text('alias').primaryKey(),
  canonical_name: text('canonical_name').notNull(),
});

// ============================================================================
// 10. Ingredient Prefs Table (popolata lazy: solo gli ingredienti giudicati)
// ============================================================================
export const ingredient_prefs = pgTable(
  'ingredient_prefs',
  {
    household_id: uuid('household_id')
      .notNull()
      .references(() => households.id, { onDelete: 'cascade' }),
    canonical_name: text('canonical_name').notNull(), // normalizzato (normalizeCanonicalName)
    pref: text('pref').notNull(), // 'like' | 'dislike'
    created_at: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [primaryKey({ columns: [table.household_id, table.canonical_name] })]
);
