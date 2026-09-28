import { z } from 'zod';

// ============================================================================
// Closed Enum Constant Arrays & Schemas
// ============================================================================

export const UNIT_VALUES = ['g', 'ml', 'pz', 'qb'] as const;
export const UNIT_ENUM = UNIT_VALUES;
export const UnitSchema = z.enum(UNIT_VALUES);
export type Unit = z.infer<typeof UnitSchema>;

export const CATEGORY_VALUES = [
  'ortofrutta',
  'pane',
  'macelleria',
  'pescheria',
  'banco-frigo',
  'dispensa',
  'surgelati',
  'bevande',
  'altro',
] as const;
export const CATEGORY_ENUM = CATEGORY_VALUES;
export const CategorySchema = z.enum(CATEGORY_VALUES);
export type Category = z.infer<typeof CategorySchema>;

export const CATEGORY_LABELS: Record<Category, string> = {
  ortofrutta: 'Ortofrutta',
  pane: 'Pane e Cereali',
  macelleria: 'Macelleria',
  pescheria: 'Pescheria',
  'banco-frigo': 'Freschi & Latticini',
  dispensa: 'Dispensa',
  surgelati: 'Surgelati',
  bevande: 'Bevande',
  altro: 'Altro',
};

export const MEAL_TYPE_VALUES = ['pranzo', 'cena'] as const;
export const MEAL_TYPE_ENUM = MEAL_TYPE_VALUES;
export const MealTypeSchema = z.enum(MEAL_TYPE_VALUES);
export type MealType = z.infer<typeof MealTypeSchema>;

export const DIET_FLAG_VALUES = [
  'vegetariano',
  'vegano',
  'senza-glutine',
  'senza-lattosio',
  'pescetariano',
] as const;
export const DIET_FLAG_ENUM = DIET_FLAG_VALUES;
export const DietFlagSchema = z.enum(DIET_FLAG_VALUES);
export type DietFlag = z.infer<typeof DietFlagSchema>;

export const DIET_FLAG_LABELS: Record<DietFlag, string> = {
  vegetariano: 'Vegetariano',
  vegano: 'Vegano',
  'senza-glutine': 'Senza glutine',
  'senza-lattosio': 'Senza lattosio',
  pescetariano: 'Pescetariano',
};

export const MEAL_STYLE_TAG_VALUES = [
  'veloce',
  'salutare',
  'proteico',
  'leggero',
  'comfort-food',
  'economico',
  'piatto-unico',
] as const;
export const MEAL_STYLE_TAG_ENUM = MEAL_STYLE_TAG_VALUES;
export const MealStyleTagSchema = z.enum(MEAL_STYLE_TAG_VALUES);
export type MealStyleTag = z.infer<typeof MealStyleTagSchema>;

export const APPLIANCE_VALUES = [
  'fornelli',
  'forno',
  'microonde',
  'friggitrice-ad-aria',
  'frullatore',
] as const;
export const APPLIANCE_ENUM = APPLIANCE_VALUES;
export const ApplianceSchema = z.enum(APPLIANCE_VALUES);
export type Appliance = z.infer<typeof ApplianceSchema>;

export const APPLIANCE_LABELS: Record<Appliance, string> = {
  fornelli: 'Fornelli',
  forno: 'Forno',
  microonde: 'Microonde',
  'friggitrice-ad-aria': 'Friggitrice ad aria',
  frullatore: 'Frullatore',
};

export const PLAN_STATUS_VALUES = ['draft', 'active', 'archived'] as const;
export const PLAN_STATUS_ENUM = PLAN_STATUS_VALUES;
export const PlanStatusSchema = z.enum(PLAN_STATUS_VALUES);
export type PlanStatus = z.infer<typeof PlanStatusSchema>;

export const RECIPE_SOURCE_VALUES = ['llm', 'manual'] as const;
export const RECIPE_SOURCE_ENUM = RECIPE_SOURCE_VALUES;
export const RecipeSourceSchema = z.enum(RECIPE_SOURCE_VALUES);
export type RecipeSource = z.infer<typeof RecipeSourceSchema>;

export const INGREDIENT_PREF_VALUES = ['like', 'dislike'] as const;
export const INGREDIENT_PREF_ENUM = INGREDIENT_PREF_VALUES;
export const IngredientPrefSchema = z.enum(INGREDIENT_PREF_VALUES);
export type IngredientPref = z.infer<typeof IngredientPrefSchema>;

// ============================================================================
// Entity Schemas & Types
// ============================================================================

export const IngredientSchema = z.object({
  id: z.string().uuid().optional(),
  recipe_id: z.string().uuid().optional(),
  canonical_name: z.string().min(1),
  display_name: z.string().min(1),
  qty: z.coerce.number().nullable().optional(),
  unit: UnitSchema,
  category: CategorySchema,
  note: z.string().nullable().optional(),
});
export type Ingredient = z.infer<typeof IngredientSchema>;

export const MacrosEstSchema = z
  .object({
    carbs: z.number().optional(),
    protein: z.number().optional(),
    fat: z.number().optional(),
  })
  .passthrough();
export type MacrosEst = z.infer<typeof MacrosEstSchema>;

export const RecipePrefSchema = z.object({
  recipe_id: z.string().uuid(),
  rating: z.number().int().min(1).max(5).nullable().optional(),
  favorite: z.boolean().default(false),
  blocked: z.boolean().default(false),
  times_used: z.number().int().default(0),
  last_used_at: z.coerce.date().nullable().optional(),
});
export type RecipePref = z.infer<typeof RecipePrefSchema>;

export const RecipeSchema = z.object({
  id: z.string().uuid(),
  household_id: z.string().uuid(),
  title: z.string().min(1),
  slug: z.string().min(1),
  description: z.string().default(''),
  steps: z.array(z.string()).min(1),
  meal_types: z.array(MealTypeSchema).min(1),
  tags: z.array(MealStyleTagSchema).default([]),
  diet_flags: z.array(DietFlagSchema).default([]),
  appliances_required: z.array(ApplianceSchema).default([]),
  servings_base: z.number().int().min(1),
  prep_minutes: z.number().int().min(1),
  kcal_est: z.number().int().nullable().optional(),
  macros_est: z.union([MacrosEstSchema, z.record(z.string(), z.unknown())]).nullable().optional(),
  source: RecipeSourceSchema.default('manual'),
  created_at: z.coerce.date().default(() => new Date()),
  ingredients: z.array(IngredientSchema).optional(),
  prefs: RecipePrefSchema.nullable().optional(),
});
export type Recipe = z.infer<typeof RecipeSchema>;

export const HouseholdSchema = z.object({
  id: z.string().uuid(),
  persons: z.number().int().min(1),
  meals: z.array(MealTypeSchema),
  diet_tags: z.array(DietFlagSchema).default([]),
  meal_style_tags: z.array(MealStyleTagSchema).default([]),
  appliances: z.array(ApplianceSchema).default([]),
  created_at: z.coerce.date().default(() => new Date()),
  updated_at: z.coerce.date().default(() => new Date()),
});
export type Household = z.infer<typeof HouseholdSchema>;

export const MealPlanSchema = z.object({
  id: z.string().uuid(),
  household_id: z.string().uuid(),
  week_start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  status: PlanStatusSchema.default('draft'),
  created_at: z.coerce.date().default(() => new Date()),
});
export type MealPlan = z.infer<typeof MealPlanSchema>;

export const PlanSlotSchema = z.object({
  id: z.string().uuid(),
  plan_id: z.string().uuid(),
  day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  meal: MealTypeSchema,
  recipe_id: z.string().uuid().nullable().optional(),
  servings: z.number().int().min(1),
  locked: z.boolean().default(false),
});
export type PlanSlot = z.infer<typeof PlanSlotSchema>;

export const ShoppingListSchema = z.object({
  id: z.string().uuid(),
  plan_id: z.string().uuid(),
  generated_at: z.coerce.date().default(() => new Date()),
});
export type ShoppingList = z.infer<typeof ShoppingListSchema>;

export const ShoppingItemSchema = z.object({
  id: z.string().uuid(),
  list_id: z.string().uuid(),
  canonical_name: z.string().min(1),
  qty: z.coerce.number().nullable().optional(),
  unit: z.string().nullable().optional(),
  category: CategorySchema,
  checked: z.boolean().default(false),
  manual: z.boolean().default(false),
  recipe_ids: z.array(z.string().uuid()).default([]),
});
export type ShoppingItem = z.infer<typeof ShoppingItemSchema>;

export const IngredientAliasSchema = z.object({
  alias: z.string().min(1),
  canonical_name: z.string().min(1),
});
export type IngredientAlias = z.infer<typeof IngredientAliasSchema>;

// ============================================================================
// Singleton Default Household
// ============================================================================

export const DEFAULT_HOUSEHOLD_ID = '00000000-0000-0000-0000-000000000001';

export const DEFAULT_HOUSEHOLD: Household = {
  id: DEFAULT_HOUSEHOLD_ID,
  persons: 2,
  meals: ['pranzo', 'cena'],
  diet_tags: [],
  meal_style_tags: ['veloce', 'salutare'],
  appliances: ['fornelli', 'forno', 'microonde', 'friggitrice-ad-aria'],
  created_at: new Date('2026-01-01T00:00:00Z'),
  updated_at: new Date('2026-01-01T00:00:00Z'),
};

// ============================================================================
// Recipe Generation Contracts (Feature 2)
// ============================================================================

// Output LLM (ARCHITECTURE §5.1). Nessun .optional()/.default(): i provider
// con structured output gestiscono male i campi opzionali.
export const GeneratedIngredientSchema = z.object({
  canonical_name: z.string().min(1),
  display_name: z.string().min(1),
  qty: z.number().positive().nullable(),
  unit: UnitSchema,
  category: CategorySchema,
  note: z.string().nullable(),
});
export type GeneratedIngredient = z.infer<typeof GeneratedIngredientSchema>;

export const GeneratedRecipeSchema = z.object({
  title: z.string().min(3).max(120),
  description: z.string(),
  meal_types: z.array(MealTypeSchema).min(1),
  tags: z.array(MealStyleTagSchema),
  diet_flags: z.array(DietFlagSchema),
  appliances_required: z.array(ApplianceSchema),
  servings_base: z.number().int().min(1).max(12),
  prep_minutes: z.number().int().min(1).max(600),
  kcal_est: z.number().int().positive().nullable(),
  steps: z.array(z.string().min(1)).min(1),
  ingredients: z.array(GeneratedIngredientSchema).min(1),
});
export type GeneratedRecipe = z.infer<typeof GeneratedRecipeSchema>;

export const GenerateRecipesOutputSchema = z.object({
  recipes: z.array(GeneratedRecipeSchema).min(1),
});
export type GenerateRecipesOutput = z.infer<typeof GenerateRecipesOutputSchema>;

// Vincoli passati all'adapter. ingredient_likes/dislikes: canonical_name,
// vuoti fino alla Feature 5 (S2.3), che li popolerà da ingredient_prefs.
export const RecipeConstraintsSchema = z.object({
  persons: z.number().int().min(1).max(12),
  meal_type: MealTypeSchema.nullable(),
  diet_tags: z.array(DietFlagSchema),
  meal_style_tags: z.array(MealStyleTagSchema),
  appliances: z.array(ApplianceSchema),
  ingredient_likes: z.array(z.string().min(1)),
  ingredient_dislikes: z.array(z.string().min(1)),
});
export type RecipeConstraints = z.infer<typeof RecipeConstraintsSchema>;

export const ConstraintOverridesSchema = z
  .object({
    persons: z.number().int().min(1).max(12),
    diet_tags: z.array(DietFlagSchema),
    meal_style_tags: z.array(MealStyleTagSchema),
    appliances: z.array(ApplianceSchema),
  })
  .partial()
  .strict();
export type ConstraintOverrides = z.infer<typeof ConstraintOverridesSchema>;

// Body di POST /api/recipes/generate
export const GENERATE_COUNT_MIN = 1;
export const GENERATE_COUNT_MAX = 10;
export const GENERATE_COUNT_DEFAULT = 5;
export const GenerateRecipesRequestSchema = z
  .object({
    count: z.number().int().min(GENERATE_COUNT_MIN).max(GENERATE_COUNT_MAX).default(GENERATE_COUNT_DEFAULT),
    meal_type: MealTypeSchema.nullable().default(null),
    overrides: ConstraintOverridesSchema.default({}),
  })
  .strict();
export type GenerateRecipesRequest = z.infer<typeof GenerateRecipesRequestSchema>;

export const GENERATION_SKIP_REASON_VALUES = ['duplicate', 'constraint_violation'] as const;
export const GenerationSkipReasonSchema = z.enum(GENERATION_SKIP_REASON_VALUES);
export type GenerationSkipReason = z.infer<typeof GenerationSkipReasonSchema>;
export const GenerationSkipSchema = z.object({
  title: z.string(),
  reason: GenerationSkipReasonSchema,
  detail: z.string(),
});
export type GenerationSkip = z.infer<typeof GenerationSkipSchema>;

// Fixtures (fixtures/recipes.json, fixtures/ingredient-aliases.json)
export const FixtureRecipeSchema = GeneratedRecipeSchema.extend({
  id: z.string().uuid(),
  slug: z.string().min(1),
});
export type FixtureRecipe = z.infer<typeof FixtureRecipeSchema>;
export const FixtureFileSchema = z.object({
  recipes: z.array(FixtureRecipeSchema).min(15).max(20),
});
export const IngredientAliasesFileSchema = z.object({
  aliases: z.array(IngredientAliasSchema).min(15),
});
