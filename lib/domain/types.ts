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
};

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
// Tutti i criteri sono in AND. `blocked: true` mostra solo le bloccate, `false` le nasconde.
export const LIBRARY_QUERY_MAX = 100;
export const LibraryFilterSchema = z
  .object({
    q: z.string().max(LIBRARY_QUERY_MAX).default(''),
    meals: z.array(MealTypeSchema).default([]),
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
