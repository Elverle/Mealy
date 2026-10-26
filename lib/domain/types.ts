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

export const MEAL_TYPE_LABELS: Record<MealType, string> = { pranzo: 'Pranzo', cena: 'Cena' };

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
  'tradizionale',
  'dal-mondo',
  'pochi-ingredienti',
  'in-anticipo',
  'piatto-freddo',
] as const;
export const MEAL_STYLE_TAG_ENUM = MEAL_STYLE_TAG_VALUES;
export const MealStyleTagSchema = z.enum(MEAL_STYLE_TAG_VALUES);
export type MealStyleTag = z.infer<typeof MealStyleTagSchema>;

export const MEAL_STYLE_TAG_LABELS: Record<MealStyleTag, string> = {
  veloce: 'Veloce',
  salutare: 'Salutare',
  proteico: 'Proteico',
  leggero: 'Leggero',
  'comfort-food': 'Comfort food',
  economico: 'Economico',
  'piatto-unico': 'Piatto unico',
  tradizionale: 'Tradizionale',
  'dal-mondo': 'Dal mondo',
  'pochi-ingredienti': 'Pochi ingredienti',
  'in-anticipo': 'Si prepara in anticipo',
  'piatto-freddo': 'Piatto freddo',
};

// Portata del piatto: una ricetta può averne più d'una. Vuoto = non classificata.
export const COURSE_VALUES = ['piatto-unico', 'primo', 'secondo', 'contorno'] as const;
export const COURSE_ENUM = COURSE_VALUES;
export const CourseSchema = z.enum(COURSE_VALUES);
export type Course = z.infer<typeof CourseSchema>;

export const COURSE_LABELS: Record<Course, string> = {
  'piatto-unico': 'Piatto unico',
  primo: 'Primo',
  secondo: 'Secondo',
  contorno: 'Contorno',
};

// Portate che da sole fanno un pasto (fino alla Feature 11: le sole ammesse nel piano).
export const MAIN_COURSE_VALUES: readonly Course[] = ['piatto-unico', 'primo', 'secondo'];

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
  courses: z.array(CourseSchema).default([]),
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

// Limiti di `persons`: usati da HouseholdSettingsSchema e dai contratti di
// generazione (Feature 2). `HouseholdSchema.persons` resta senza max (v. sotto).
export const PERSONS_MIN = 1;
export const PERSONS_MAX = 12;

export const HouseholdSchema = z.object({
  id: z.string().uuid(),
  persons: z.number().int().min(1),
  meals: z.array(MealTypeSchema),
  diet_tags: z.array(DietFlagSchema).default([]),
  meal_style_tags: z.array(MealStyleTagSchema).default([]),
  appliances: z.array(ApplianceSchema).default([]),
  onboarded_at: z.coerce.date().nullable().default(null),
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
  onboarded_at: null,
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
  courses: z.array(CourseSchema).min(1),
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

// Vincoli passati all'adapter. ingredient_likes/dislikes: nomi canonici normalizzati,
// letti da ingredient_prefs (Feature 5, S2.3).
export const RecipeConstraintsSchema = z.object({
  persons: z.number().int().min(PERSONS_MIN).max(PERSONS_MAX),
  meal_type: MealTypeSchema.nullable(),
  courses: z.array(CourseSchema).min(1).nullable(), // null = qualsiasi portata; mai vuoto
  diet_tags: z.array(DietFlagSchema),
  meal_style_tags: z.array(MealStyleTagSchema),
  appliances: z.array(ApplianceSchema),
  ingredient_likes: z.array(z.string().min(1)),
  ingredient_dislikes: z.array(z.string().min(1)),
});
export type RecipeConstraints = z.infer<typeof RecipeConstraintsSchema>;

export const ConstraintOverridesSchema = z
  .object({
    persons: z.number().int().min(PERSONS_MIN).max(PERSONS_MAX),
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
  aliases: z
    .array(IngredientAliasSchema)
    .min(15)
    // Il seed carica gli alias con un solo INSERT … ON CONFLICT DO UPDATE: Postgres lo rifiuta
    // se la stessa chiave compare due volte, e in produzione l'app non partirebbe.
    .refine((aliases) => new Set(aliases.map((a) => a.alias)).size === aliases.length, {
      message: 'Lo stesso alias compare più di una volta.',
    }),
});

// ============================================================================
// Household Settings (Feature 3)
// ============================================================================

export const HouseholdSettingsSchema = z
  .object({
    persons: z.number().int().min(PERSONS_MIN).max(PERSONS_MAX),
    meals: z.array(MealTypeSchema).min(1),
    meal_style_tags: z.array(MealStyleTagSchema),
    diet_tags: z.array(DietFlagSchema),
    appliances: z.array(ApplianceSchema),
  })
  .strict();
export type HouseholdSettings = z.infer<typeof HouseholdSettingsSchema>;

// Body di PUT /api/settings
export const UpdateSettingsRequestSchema = HouseholdSettingsSchema.extend({
  complete_onboarding: z.boolean().default(false),
}).strict();
export type UpdateSettingsRequest = z.input<typeof UpdateSettingsRequestSchema>;

// Risposta di GET /api/settings. updated_at (ISO) è il riferimento per F4:
// un piano è superato dai vincoli se updated_at > meal_plans.generated_at.
export const SettingsViewSchema = z.object({
  persons: z.number().int(),
  meals: z.array(MealTypeSchema),
  meal_style_tags: z.array(MealStyleTagSchema),
  diet_tags: z.array(DietFlagSchema),
  appliances: z.array(ApplianceSchema),
  onboarded: z.boolean(),
  updated_at: z.string().datetime(),
});
export type SettingsView = z.infer<typeof SettingsViewSchema>;

// Risposta di PUT /api/settings
export const SaveSettingsResultSchema = z.object({
  settings: SettingsViewSchema,
  changed: z.boolean(),
});
export type SaveSettingsResult = z.infer<typeof SaveSettingsResultSchema>;

// ============================================================================
// Meal Plans (Feature 4)
// ============================================================================

export const IsoDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

// Settimana su cui lavorano "Genera piano" / "Rigenera" (v. lib/domain/week.ts).
export const PlanWeekSchema = z.object({
  week_start: IsoDateSchema, // lunedì
  first_day: IsoDateSchema, // primo giorno pianificabile (>= week_start)
  last_day: IsoDateSchema, // domenica = week_start + 6
});
export type PlanWeek = z.infer<typeof PlanWeekSchema>;

export const PlanSlotViewSchema = z.object({
  id: z.string().uuid(),
  day: IsoDateSchema,
  meal: MealTypeSchema,
  servings: z.number().int().min(1),
  locked: z.boolean(),
  recipe: RecipeSchema.nullable(), // ricetta completa (ingredienti + prefs); null se eliminata
});
export type PlanSlotView = z.infer<typeof PlanSlotViewSchema>;

export const PlanShoppingListStateSchema = z.object({
  exists: z.boolean(),
  needs_regeneration: z.boolean(),
});
export type PlanShoppingListState = z.infer<typeof PlanShoppingListStateSchema>;

export const PlanViewSchema = z.object({
  id: z.string().uuid(),
  week_start: IsoDateSchema,
  status: PlanStatusSchema,
  created_at: z.string().datetime(),
  generated_at: z.string().datetime(),
  superseded: z.boolean(), // households.updated_at > generated_at
  slots: z.array(PlanSlotViewSchema), // ordinati per giorno, poi pranzo → cena
  shopping_list: PlanShoppingListStateSchema,
});
export type PlanView = z.infer<typeof PlanViewSchema>;

export const PLAN_ACTION_VALUES = ['generate', 'regenerate', 'none'] as const;
export const PlanActionSchema = z.enum(PLAN_ACTION_VALUES);
export type PlanAction = z.infer<typeof PlanActionSchema>;

// Una settimana mostrata nella pagina Piano (navigatore di settimane).
export const PlanWeekViewSchema = z.object({
  week: PlanWeekSchema, // per la settimana obiettivo first_day = primo giorno pianificabile; per le altre = week_start
  plan: PlanViewSchema.nullable(),
  action: PlanActionSchema, // solo la settimana obiettivo può avere generate/regenerate; le altre 'none'
  editable: z.boolean(), // plan presente e non chiuso
  can_repeat: z.boolean(), // plan con almeno una ricetta, settimana ≠ obiettivo, obiettivo non confermato
});
export type PlanWeekView = z.infer<typeof PlanWeekViewSchema>;

// Risposta di GET /api/plans/current e dato iniziale della pagina Piano.
export const PlanScreenViewSchema = z.object({
  today: IsoDateSchema,
  current_week_start: IsoDateSchema,
  target: PlanWeekSchema, // settimana di Genera/Rigenera/Ripeti
  view: PlanWeekViewSchema, // settimana mostrata
  prev_week_start: IsoDateSchema.nullable(),
  next_week_start: IsoDateSchema.nullable(),
  target_plan_status: PlanStatusSchema.nullable(), // stato del piano della settimana obiettivo; null se non esiste
  current_plan_id: z.string().uuid().nullable(), // piano della settimana corrente ripetibile sull'obiettivo (weekend); null altrimenti
});
export type PlanScreenView = z.infer<typeof PlanScreenViewSchema>;

export const PlanGenerationSummarySchema = z.object({
  rounds: z.number().int().min(0), // giri di generazione LLM eseguiti
  created: z.number().int().min(0), // ricette nuove salvate in libreria
  failed: z.boolean(), // true se almeno una chiamata LLM è fallita
});
export type PlanGenerationSummary = z.infer<typeof PlanGenerationSummarySchema>;

// Body di POST /api/plans (la settimana la calcola il server)
export const GeneratePlanRequestSchema = z.object({}).strict();
// Risposta di POST /api/plans
export const GeneratePlanResultSchema = z.object({
  screen: PlanScreenViewSchema,
  generation: PlanGenerationSummarySchema,
});
export type GeneratePlanResult = z.infer<typeof GeneratePlanResultSchema>;

// Risposta di POST /api/plans/:id/confirm e PATCH /api/plans/:id/slots/:slotId
export const PlanResultSchema = z.object({ plan: PlanViewSchema });
export type PlanResult = z.infer<typeof PlanResultSchema>;

// Body di POST /api/plans/:id/slots/:slotId/swap
export const SWAP_EXCLUDE_MAX = 50;
export const SwapSlotRequestSchema = z
  .object({
    exclude_recipe_ids: z.array(z.string().uuid()).max(SWAP_EXCLUDE_MAX).default([]),
  })
  .strict();
export type SwapSlotRequest = z.infer<typeof SwapSlotRequestSchema>;
// Risposta dello swap
export const PlanMutationResultSchema = z.object({
  plan: PlanViewSchema,
  generation: PlanGenerationSummarySchema,
});
export type PlanMutationResult = z.infer<typeof PlanMutationResultSchema>;

// Body di PATCH /api/plans/:id/slots/:slotId
export const UpdateSlotRequestSchema = z.object({ locked: z.boolean() }).strict();
export type UpdateSlotRequest = z.infer<typeof UpdateSlotRequestSchema>;

// ============================================================================
// Library & Preferences (Feature 5)
// ============================================================================

// Filtri della Libreria (GET /api/recipes e filtro in memoria della pagina).
// Tutti i criteri sono in AND; dentro `courses` basta una portata (OR).
// `blocked: true` mostra solo le bloccate, `false` le nasconde.
export const LIBRARY_QUERY_MAX = 100;
export const LibraryFilterSchema = z
  .object({
    q: z.string().max(LIBRARY_QUERY_MAX).default(''),
    meals: z.array(MealTypeSchema).default([]),
    courses: z.array(CourseSchema).default([]),
    tags: z.array(MealStyleTagSchema).default([]),
    diets: z.array(DietFlagSchema).default([]),
    favorites: z.boolean().default(false),
    blocked: z.boolean().default(false),
  })
  .strict();
export type LibraryFilter = z.infer<typeof LibraryFilterSchema>;

export const EMPTY_LIBRARY_FILTER: LibraryFilter = {
  q: '',
  meals: [],
  courses: [],
  tags: [],
  diets: [],
  favorites: false,
  blocked: false,
};

// Vista leggera di una ricetta per la griglia della Libreria.
export const LibraryRecipeCardSchema = z.object({
  id: z.string().uuid(),
  title: z.string().min(1),
  prep_minutes: z.number().int().min(1),
  meal_types: z.array(MealTypeSchema),
  courses: z.array(CourseSchema),
  tags: z.array(MealStyleTagSchema),
  diet_flags: z.array(DietFlagSchema),
  ingredient_names: z.array(z.string().min(1)), // nomi canonici normalizzati, distinti, nell'ordine della ricetta
  rating: z.number().int().min(1).max(5).nullable(),
  favorite: z.boolean(),
  blocked: z.boolean(),
  created_at: z.string().datetime(),
});
export type LibraryRecipeCard = z.infer<typeof LibraryRecipeCardSchema>;

// Risposta di GET /api/recipes
export const LibraryViewSchema = z.object({
  recipes: z.array(LibraryRecipeCardSchema), // filtrate e ordinate
  total: z.number().int().min(0), // ricette in libreria senza filtri (bloccate comprese)
});
export type LibraryView = z.infer<typeof LibraryViewSchema>;

// Giudizio e impatto di un ingrediente di una ricetta.
export const INGREDIENT_NAME_MAX = 80;
export const RecipeIngredientInfoSchema = z.object({
  canonical_name: z.string().min(1), // normalizzato; senza max: i nomi generati dall'LLM non ne hanno
  pref: IngredientPrefSchema.nullable(),
  recipes_count: z.number().int().min(0), // ricette non bloccate della libreria che lo contengono
});
export type RecipeIngredientInfo = z.infer<typeof RecipeIngredientInfoSchema>;

// Risposta di GET /api/recipes/:id
export const RecipeDetailViewSchema = z.object({
  recipe: RecipeSchema, // completa: ingredients e prefs
  ingredients: z.array(RecipeIngredientInfoSchema), // una voce per nome canonico distinto, nell'ordine della ricetta
});
export type RecipeDetailView = z.infer<typeof RecipeDetailViewSchema>;

// Body di PUT /api/recipes/:id/pref: aggiornamento parziale, almeno un campo.
// rating null = togli il voto. Bloccare toglie dalle preferite (v. lib/domain/prefs.ts).
export const UpdateRecipePrefRequestSchema = z
  .object({
    rating: z.number().int().min(1).max(5).nullable(),
    favorite: z.boolean(),
    blocked: z.boolean(),
  })
  .partial()
  .strict()
  .refine((value) => Object.keys(value).length > 0, { message: 'Indica almeno un campo.' });
export type UpdateRecipePrefRequest = z.infer<typeof UpdateRecipePrefRequestSchema>;

// Risposta di PUT /api/recipes/:id/pref
export const RecipePrefResultSchema = z.object({ prefs: RecipePrefSchema });
export type RecipePrefResult = z.infer<typeof RecipePrefResultSchema>;

// Una voce di "I miei ingredienti".
export const IngredientPrefEntrySchema = z.object({
  canonical_name: z.string().min(1).max(INGREDIENT_NAME_MAX),
  pref: IngredientPrefSchema,
  recipes_count: z.number().int().min(0),
});
export type IngredientPrefEntry = z.infer<typeof IngredientPrefEntrySchema>;

// Risposta di GET /api/ingredient-prefs: due liste in ordine alfabetico.
export const IngredientPrefsViewSchema = z.object({
  likes: z.array(IngredientPrefEntrySchema),
  dislikes: z.array(IngredientPrefEntrySchema),
});
export type IngredientPrefsView = z.infer<typeof IngredientPrefsViewSchema>;

export const EMPTY_INGREDIENT_PREFS_VIEW: IngredientPrefsView = { likes: [], dislikes: [] };

// Body di PUT /api/ingredient-prefs/:canonicalName (null = rimuovi il giudizio)
export const SetIngredientPrefRequestSchema = z
  .object({ pref: IngredientPrefSchema.nullable() })
  .strict();
export type SetIngredientPrefRequest = z.infer<typeof SetIngredientPrefRequestSchema>;

// Risposta di PUT /api/ingredient-prefs/:canonicalName
export const SetIngredientPrefResultSchema = z.object({
  canonical_name: z.string().min(1).max(INGREDIENT_NAME_MAX),
  pref: IngredientPrefSchema.nullable(),
  recipes_count: z.number().int().min(0),
});
export type SetIngredientPrefResult = z.infer<typeof SetIngredientPrefResultSchema>;

// ============================================================================
// Shopping List (Feature 6)
// ============================================================================

export const SHOPPING_ITEM_NAME_MAX = 80;

// Un articolo della lista. `unit` è null solo per gli articoli aggiunti a mano;
// `qty` è null per 'qb' e per gli articoli a mano.
export const ShoppingItemViewSchema = z.object({
  id: z.string().uuid(),
  canonical_name: z.string().min(1), // normalizzato; alias risolti negli articoli generati, non in quelli a mano
  qty: z.number().positive().nullable(),
  unit: UnitSchema.nullable(),
  category: CategorySchema,
  checked: z.boolean(),
  manual: z.boolean(),
  recipe_ids: z.array(z.string().uuid()), // ricette per cui serve; vuoto per gli articoli a mano
});
export type ShoppingItemView = z.infer<typeof ShoppingItemViewSchema>;

export const ShoppingRecipeRefSchema = z.object({
  id: z.string().uuid(),
  title: z.string().min(1),
});
export type ShoppingRecipeRef = z.infer<typeof ShoppingRecipeRefSchema>;

export const ShoppingListViewSchema = z.object({
  id: z.string().uuid(),
  generated_at: z.string().datetime(),
  needs_regeneration: z.boolean(), // il piano è cambiato dopo l'ultima costruzione
  items: z.array(ShoppingItemViewSchema), // ordinati per reparto, nome, unità
  recipes: z.array(ShoppingRecipeRefSchema), // ricette citate in recipe_ids che esistono ancora
});
export type ShoppingListView = z.infer<typeof ShoppingListViewSchema>;

export const ShoppingPlanRefSchema = z.object({
  id: z.string().uuid(),
  week_start: IsoDateSchema, // lunedì
  last_day: IsoDateSchema, // domenica = week_start + 6
  status: PlanStatusSchema,
  has_list: z.boolean(),
});
export type ShoppingPlanRef = z.infer<typeof ShoppingPlanRefSchema>;

// Risposta di GET e POST /api/plans/:id/shopping-list
export const PlanShoppingListViewSchema = z.object({
  plan: ShoppingPlanRefSchema,
  editable: z.boolean(), // piano non chiuso: spunte e articoli a mano consentiti
  can_build: z.boolean(), // piano confermato e non chiuso: la lista si può creare o aggiornare
  list: ShoppingListViewSchema.nullable(), // null: la lista non è ancora stata creata
});
export type PlanShoppingListView = z.infer<typeof PlanShoppingListViewSchema>;

// Dato iniziale della pagina Lista.
export const ShoppingScreenViewSchema = z.object({
  plans: z.array(ShoppingPlanRefSchema), // piani confermati e non chiusi, per week_start crescente
  selected: PlanShoppingListViewSchema.nullable(), // piano mostrato; null se non c'è nulla da mostrare
});
export type ShoppingScreenView = z.infer<typeof ShoppingScreenViewSchema>;

// Body di PATCH /api/shopping-items/:id
export const UpdateShoppingItemRequestSchema = z.object({ checked: z.boolean() }).strict();
export type UpdateShoppingItemRequest = z.infer<typeof UpdateShoppingItemRequestSchema>;

// Body di POST /api/plans/:id/shopping-list/items
export const AddShoppingItemRequestSchema = z
  .object({ name: z.string().trim().min(1).max(SHOPPING_ITEM_NAME_MAX) })
  .strict();
export type AddShoppingItemRequest = z.infer<typeof AddShoppingItemRequestSchema>;

// Risposta di PATCH /api/shopping-items/:id e di POST …/shopping-list/items
export const ShoppingItemResultSchema = z.object({ item: ShoppingItemViewSchema });
export type ShoppingItemResult = z.infer<typeof ShoppingItemResultSchema>;

// Risposta di DELETE /api/shopping-items/:id
export const DeleteShoppingItemResultSchema = z.object({ id: z.string().uuid() });
export type DeleteShoppingItemResult = z.infer<typeof DeleteShoppingItemResultSchema>;

// ============================================================================
// Recipe Requests & Manual Slot Choice (Feature 9)
// ============================================================================

// Lunghezza minima del testo di una richiesta libera; il massimo è LIBRARY_QUERY_MAX.
export const RECIPE_REQUEST_MIN = 3;
// Titoli già proposti nella sequenza di «Un'altra» che il client rimanda al server.
export const PROPOSAL_EXCLUDE_MAX = 10;
const PROPOSAL_TITLE_MAX = 120; // come GeneratedRecipeSchema.title

// Body di POST /api/recipes/propose. meal_type null: il tipo di pasto lo decide il modello.
export const ProposeRecipeRequestSchema = z
  .object({
    request: z.string().trim().min(RECIPE_REQUEST_MIN).max(LIBRARY_QUERY_MAX),
    meal_type: MealTypeSchema.nullable().default(null),
    exclude_titles: z
      .array(z.string().trim().min(1).max(PROPOSAL_TITLE_MAX))
      .max(PROPOSAL_EXCLUDE_MAX)
      .default([]),
  })
  .strict();
export type ProposeRecipeRequest = z.infer<typeof ProposeRecipeRequestSchema>;

// Risposta di POST /api/recipes/propose. duplicate_of: ricetta della libreria con lo stesso
// titolo normalizzato, oppure null. La proposta non è salvata sul server.
export const RecipeProposalSchema = z
  .object({
    recipe: GeneratedRecipeSchema,
    duplicate_of: z
      .object({ id: z.string().uuid(), title: z.string().min(1) })
      .strict()
      .nullable(),
  })
  .strict();
export type RecipeProposal = z.infer<typeof RecipeProposalSchema>;

// Tetti di una ricetta che arriva dal client per essere salvata: larghi rispetto a ciò che
// produce il modello, servono solo a non scrivere in libreria corpi di dimensione arbitraria.
// Restano fuori da GeneratedRecipeSchema, che è anche lo schema dell'output strutturato LLM.
export const SAVED_RECIPE_TEXT_MAX = 1000; // descrizione e singolo passo
export const SAVED_RECIPE_STEPS_MAX = 40;
export const SAVED_RECIPE_INGREDIENTS_MAX = 60;
export const SAVED_RECIPE_TAGS_MAX = 20; // tags, diet_flags, appliances_required
export const SAVED_RECIPE_COURSES_MAX = 4; // una per portata di COURSE_VALUES
const SAVED_INGREDIENT_NAME_MAX = 120;
const SAVED_INGREDIENT_NOTE_MAX = 300;

export const SavedRecipeInputSchema = GeneratedRecipeSchema.extend({
  courses: z.array(CourseSchema).min(1).max(SAVED_RECIPE_COURSES_MAX),
  description: z.string().max(SAVED_RECIPE_TEXT_MAX),
  tags: z.array(MealStyleTagSchema).max(SAVED_RECIPE_TAGS_MAX),
  diet_flags: z.array(DietFlagSchema).max(SAVED_RECIPE_TAGS_MAX),
  appliances_required: z.array(ApplianceSchema).max(SAVED_RECIPE_TAGS_MAX),
  steps: z.array(z.string().min(1).max(SAVED_RECIPE_TEXT_MAX)).min(1).max(SAVED_RECIPE_STEPS_MAX),
  ingredients: z
    .array(
      GeneratedIngredientSchema.extend({
        canonical_name: z.string().min(1).max(SAVED_INGREDIENT_NAME_MAX),
        display_name: z.string().min(1).max(SAVED_INGREDIENT_NAME_MAX),
        note: z.string().max(SAVED_INGREDIENT_NOTE_MAX).nullable(),
      })
    )
    .min(1)
    .max(SAVED_RECIPE_INGREDIENTS_MAX),
});

// Body di POST /api/recipes
export const SaveRecipeRequestSchema = z.object({ recipe: SavedRecipeInputSchema }).strict();
export type SaveRecipeRequest = z.infer<typeof SaveRecipeRequestSchema>;

// Risposta di POST /api/recipes: la ricetta salvata, completa di ingredienti e preferenze.
export const SaveRecipeResultSchema = z.object({ recipe: RecipeSchema }).strict();
export type SaveRecipeResult = z.infer<typeof SaveRecipeResultSchema>;

// Body di PUT /api/plans/:id/slots/:slotId/recipe (la risposta è PlanResultSchema)
export const AssignSlotRecipeRequestSchema = z.object({ recipe_id: z.string().uuid() }).strict();
export type AssignSlotRecipeRequest = z.infer<typeof AssignSlotRecipeRequestSchema>;

// Risposta di GET /api/plans/:id/slots/:slotId/candidates
export const SlotCandidatesSchema = z
  .object({
    recipes: z.array(LibraryRecipeCardSchema), // adatte al pasto, senza quella dello slot, nell'ordine della Libreria
    in_plan_recipe_ids: z.array(z.string().uuid()), // ricette degli altri slot dello stesso piano, senza doppioni
  })
  .strict();
export type SlotCandidates = z.infer<typeof SlotCandidatesSchema>;

// ============================================================================
// Recipe Classification (Feature 8)
// ============================================================================

// Ricette per chiamata di classificazione.
export const CLASSIFY_BATCH_SIZE = 10;

// Etichette di stile che assegna il modello nella classificazione delle ricette esistenti.
export const CLASSIFIED_STYLE_TAG_VALUES = [
  'tradizionale',
  'dal-mondo',
  'in-anticipo',
  'piatto-freddo',
] as const satisfies readonly MealStyleTag[];
export const ClassifiedStyleTagSchema = z.enum(CLASSIFIED_STYLE_TAG_VALUES);
export type ClassifiedStyleTag = z.infer<typeof ClassifiedStyleTagSchema>;

// Una ricetta da classificare, come la riceve il modello. `ref`: "r1"…"r10".
export const ClassifyRecipeItemSchema = z.object({
  ref: z.string().min(1),
  title: z.string().min(1),
  description: z.string(),
  meal_types: z.array(MealTypeSchema),
  tags: z.array(MealStyleTagSchema),
  ingredient_names: z.array(z.string().min(1)),
});
export type ClassifyRecipeItem = z.infer<typeof ClassifyRecipeItemSchema>;

// Output LLM. `courses` senza .min(1): una riga vuota si scarta senza invalidare il lotto.
export const RecipeClassificationSchema = z.object({
  ref: z.string(),
  courses: z.array(CourseSchema),
  style_tags: z.array(ClassifiedStyleTagSchema),
});
export type RecipeClassification = z.infer<typeof RecipeClassificationSchema>;
export const ClassifyRecipesOutputSchema = z.object({
  recipes: z.array(RecipeClassificationSchema),
});
export type ClassifyRecipesOutput = z.infer<typeof ClassifyRecipesOutputSchema>;

// ============================================================================
// Recipe Pack (Feature 10)
// ============================================================================

// Gruppi di selezione del pacchetto: derivano dalla categoria del dataset, non dalla portata.
export const PACK_GROUP_VALUES = ['primi', 'secondi', 'piatti-unici', 'contorni'] as const;
export const PackGroupSchema = z.enum(PACK_GROUP_VALUES);
export type PackGroup = z.infer<typeof PackGroupSchema>;

export const PACK_GROUP_LABELS: Record<PackGroup, string> = {
  primi: 'Primi',
  secondi: 'Secondi',
  'piatti-unici': 'Piatti unici',
  contorni: 'Contorni',
};
export const PACK_GROUP_QUOTAS: Record<PackGroup, number> = {
  primi: 50,
  secondi: 50,
  'piatti-unici': 40,
  contorni: 60,
};
// Prima lettera dei codici dei candidati (P001, S001, U001, C001).
export const PACK_GROUP_CODES: Record<PackGroup, string> = {
  primi: 'P',
  secondi: 'S',
  'piatti-unici': 'U',
  contorni: 'C',
};
export const RECIPE_PACK_SIZE = 200; // somma di PACK_GROUP_QUOTAS

// Ingrediente principale di un candidato: serve solo a variare la selezione.
export const PACK_MAIN_INGREDIENT_VALUES = ['carne', 'pesce', 'legumi', 'uova', 'formaggi', 'verdure'] as const;
export const PackMainIngredientSchema = z.enum(PACK_MAIN_INGREDIENT_VALUES);
export type PackMainIngredient = z.infer<typeof PackMainIngredientSchema>;

// Riga grezza del dataset CSV (campi come testo).
export const PackDatasetRowSchema = z.object({
  index: z.string(),
  title: z.string(),
  category: z.string(),
  link: z.string(),
  servings: z.string(),
  ingredients: z.string(),
  steps: z.string(),
});
export type PackDatasetRow = z.infer<typeof PackDatasetRowSchema>;

// Lettura di una quantità del dataset: g/ml/pz dopo le conversioni (kg → g, l/dl/cl → ml, numero solo → pz).
export const PackQuantityReadingSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('qb') }),
  z.object({
    kind: z.literal('measure'),
    qty: z.number().positive(),
    unit: z.enum(['g', 'ml', 'pz']),
    unitless: z.boolean(), // true: nel dataset c'era solo il numero
  }),
  z.object({ kind: z.literal('invalid') }),
]);
export type PackQuantityReading = z.infer<typeof PackQuantityReadingSchema>;

// Candidato scelto da `select` (`.recipe-pack/candidates.json`).
export const PackCandidateSchema = z.object({
  code: z.string().regex(/^[PSUC]\d{3}$/),
  group: PackGroupSchema,
  main_ingredient: PackMainIngredientSchema,
  dataset_index: z.string(),
  link: z.string(),
  title: z.string().min(1),
  category: z.string(),
  servings: z.number().int().min(1).max(12),
  ingredients: z.array(z.tuple([z.string(), z.string()])).min(1), // [nome, quantità grezza]
  procedure: z.string().min(1),
  measured_count: z.number().int().min(0),
  score: z.number().int().min(0),
  checked: z.boolean(), // spunta iniziale in selection.md
});
export type PackCandidate = z.infer<typeof PackCandidateSchema>;
export const PackCandidatesFileSchema = z.object({ candidates: z.array(PackCandidateSchema) });

// Ricetta da convertire, come la riceve il modello.
export const PackConvertItemSchema = z.object({
  title: z.string().min(1),
  group: PackGroupSchema,
  servings: z.number().int().min(1).max(12),
  ingredients: z
    .array(
      z.object({
        name: z.string().min(1),
        raw_qty: z.string(),
        reading: z.string().nullable(), // es. "750 g", "2 senza unità", "q.b."; null se illeggibile
      })
    )
    .min(1),
  procedure: z.string().min(1),
  known_names: z.array(z.string().min(1)),
});
export type PackConvertItem = z.infer<typeof PackConvertItemSchema>;

// Esito salvato della conversione di un candidato (`.recipe-pack/converted/<codice>.json`).
export const PackConversionRecordSchema = z.object({
  code: z.string().regex(/^[PSUC]\d{3}$/),
  status: z.enum(['accepted', 'rejected']),
  recipe: GeneratedRecipeSchema.nullable(), // null se rejected
  errors: z.array(z.string()),
  warnings: z.array(z.string()),
  model: z.string(),
  converted_at: z.string().datetime(),
});
export type PackConversionRecord = z.infer<typeof PackConversionRecordSchema>;

// Tabella degli ingredienti del pacchetto: bozza del modello, poi riveduta.
export const PACK_DRAFT_BATCH_SIZE = 40;
export const PackIngredientFactDraftSchema = z.object({
  name: z.string().min(1),
  category: CategorySchema,
  carne: z.boolean(),
  pesce: z.boolean(),
  latticini: z.boolean(),
  uova: z.boolean(),
  miele: z.boolean(),
  glutine: z.boolean(),
});
export type PackIngredientFactDraft = z.infer<typeof PackIngredientFactDraftSchema>;
export const PackIngredientFactSchema = PackIngredientFactDraftSchema.extend({ reviewed: z.boolean() });
export type PackIngredientFact = z.infer<typeof PackIngredientFactSchema>;
export const PackIngredientsFileSchema = z.object({
  ingredients: z
    .array(PackIngredientFactSchema)
    .refine((items) => new Set(items.map((i) => i.name)).size === items.length, {
      message: 'Lo stesso ingrediente compare più di una volta.',
    }),
});
// Output LLM della bozza.
export const DraftIngredientFactsOutputSchema = z.object({
  ingredients: z.array(PackIngredientFactDraftSchema),
});

// File del pacchetto (`fixtures/recipe-pack.json`). Unicità dei titoli: la controllano `build` e il test del file.
export const RecipePackFileSchema = z.object({ recipes: z.array(SavedRecipeInputSchema) });

// Statistiche del pacchetto nel report di `build`.
export const PackStatsSchema = z.object({
  total: z.number().int(),
  by_course: z.record(CourseSchema, z.number().int()),
  by_meal_type: z.record(MealTypeSchema, z.number().int()),
  by_diet: z.record(DietFlagSchema, z.number().int()),
  by_main_ingredient: z.record(PackMainIngredientSchema, z.number().int()),
  prep_minutes: z.object({
    up_to_30: z.number().int(),
    up_to_60: z.number().int(),
    up_to_120: z.number().int(),
    over_120: z.number().int(),
  }),
});
export type PackStats = z.infer<typeof PackStatsSchema>;
