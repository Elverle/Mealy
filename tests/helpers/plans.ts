import {
  insertRecipe,
  type InsertIngredientInput,
  type InsertRecipePrefInput,
  type RecipeWithDetails,
} from '@/lib/db/repositories/recipe-repo';
import { slugify } from '@/lib/domain/recipe-text';
import type { Appliance, Course, DietFlag, MealType } from '@/lib/domain/types';

export interface TestRecipeSpec {
  title?: string; // default `Ricetta test ${uuid.slice(0, 8)}`
  meal_types: MealType[];
  courses?: Course[]; // default: non classificata (nessuna portata)
  diet_flags?: DietFlag[];
  appliances_required?: Appliance[];
  ingredients?: InsertIngredientInput[];
  prefs?: InsertRecipePrefInput;
}

const UUID_PREFIX_LENGTH = 8;

const DEFAULT_TEST_INGREDIENTS: InsertIngredientInput[] = [
  { canonical_name: 'sale', display_name: 'sale', qty: null, unit: 'qb', category: 'dispensa' },
];

async function insertWithTitle(
  householdId: string,
  spec: TestRecipeSpec,
  title: string,
  suffix: string
): Promise<RecipeWithDetails> {
  return insertRecipe(
    {
      household_id: householdId,
      title,
      // Gli slug sono unici a livello globale: il suffisso casuale evita collisioni.
      slug: `${slugify(title)}-${suffix}`,
      steps: ['Passo unico.'],
      meal_types: spec.meal_types,
      courses: spec.courses,
      diet_flags: spec.diet_flags ?? [],
      appliances_required: spec.appliances_required ?? [],
      servings_base: 2,
      prep_minutes: 20,
      source: 'manual',
    },
    spec.ingredients ?? DEFAULT_TEST_INGREDIENTS,
    spec.prefs
  );
}

/** Inserisce una ricetta di test completa (ingredienti e preferenze) per l'household. */
export async function insertTestRecipe(
  householdId: string,
  spec: TestRecipeSpec
): Promise<RecipeWithDetails> {
  const suffix = crypto.randomUUID().slice(0, UUID_PREFIX_LENGTH);
  return insertWithTitle(householdId, spec, spec.title ?? `Ricetta test ${suffix}`, suffix);
}

/** Inserisce `count` ricette di test; il titolo di default contiene l'indice. */
export async function insertTestRecipes(
  householdId: string,
  count: number,
  spec: TestRecipeSpec
): Promise<RecipeWithDetails[]> {
  const recipes: RecipeWithDetails[] = [];
  for (let i = 0; i < count; i++) {
    const suffix = crypto.randomUUID().slice(0, UUID_PREFIX_LENGTH);
    recipes.push(await insertWithTitle(householdId, spec, spec.title ?? `Ricetta test ${i} ${suffix}`, suffix));
  }
  return recipes;
}
