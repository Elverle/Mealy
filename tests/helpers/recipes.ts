import {
  DEFAULT_HOUSEHOLD_ID,
  GeneratedRecipeSchema,
  LibraryRecipeCardSchema,
  RecipeSchema,
  type GeneratedRecipe,
  type LibraryRecipeCard,
  type Recipe,
} from '@/lib/domain/types';

const CREATED_AT = '2026-01-01T00:00:00.000Z';

/** Ingredienti misurati di default: tre righe in grammi, tutte in dispensa. */
const DEFAULT_INGREDIENTS = [
  { canonical_name: 'farina', display_name: 'Farina', qty: 200, unit: 'g', category: 'dispensa' },
  { canonical_name: 'zucchero', display_name: 'Zucchero', qty: 50, unit: 'g', category: 'dispensa' },
  { canonical_name: 'sale fino', display_name: 'Sale fino', qty: 5, unit: 'g', category: 'dispensa' },
] as const;

/** Ricetta di libreria valida (non classificata, senza preferenze). */
export function makeRecipe(overrides?: Partial<Recipe>): Recipe {
  return RecipeSchema.parse({
    id: crypto.randomUUID(),
    household_id: DEFAULT_HOUSEHOLD_ID,
    title: 'Ricetta di prova',
    slug: 'ricetta-di-prova',
    description: '',
    steps: ['Cuoci.'],
    meal_types: ['pranzo', 'cena'],
    courses: [],
    tags: [],
    diet_flags: [],
    appliances_required: [],
    servings_base: 2,
    prep_minutes: 20,
    kcal_est: null,
    macros_est: null,
    source: 'manual',
    created_at: CREATED_AT,
    ingredients: DEFAULT_INGREDIENTS.map((ing) => ({ ...ing, note: null })),
    prefs: null,
    ...overrides,
  });
}

/** Ricetta generata valida, portata `['secondo']`, 3 ingredienti misurati. */
export function makeGeneratedRecipe(overrides?: Partial<GeneratedRecipe>): GeneratedRecipe {
  return GeneratedRecipeSchema.parse({
    title: 'Ricetta di prova',
    description: '',
    meal_types: ['pranzo', 'cena'],
    courses: ['secondo'],
    tags: [],
    diet_flags: [],
    appliances_required: [],
    servings_base: 2,
    prep_minutes: 20,
    kcal_est: null,
    steps: ['Cuoci.'],
    ingredients: DEFAULT_INGREDIENTS.map((ing) => ({ ...ing, note: null })),
    ...overrides,
  });
}

/** Card di libreria valida (`courses: []`). */
export function makeLibraryCard(overrides?: Partial<LibraryRecipeCard>): LibraryRecipeCard {
  return LibraryRecipeCardSchema.parse({
    id: crypto.randomUUID(),
    title: 'Ricetta di prova',
    prep_minutes: 20,
    meal_types: ['pranzo', 'cena'],
    courses: [],
    tags: [],
    diet_flags: [],
    ingredient_names: DEFAULT_INGREDIENTS.map((ing) => ing.canonical_name),
    rating: null,
    favorite: false,
    blocked: false,
    created_at: CREATED_AT,
    ...overrides,
  });
}
