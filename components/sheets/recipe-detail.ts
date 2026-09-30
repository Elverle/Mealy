import {
  DIET_FLAG_LABELS,
  MEAL_STYLE_TAG_LABELS,
  type DietFlag,
  type Recipe,
} from '@/lib/domain/types';
import type { RecipeDetail } from './recipe-sheet';

const MAX_STYLE_CHIPS = 2;
const AMOUNT_DECIMALS_FACTOR = 10;
const DIET_CHIP_PRIORITY: readonly DietFlag[] = [
  'vegano',
  'vegetariano',
  'pescetariano',
  'senza-glutine',
  'senza-lattosio',
];

/** Fino a 2 tag di stile (ordine della ricetta) + al massimo 1 dieta per priorità. */
export function recipeChips(recipe: Recipe): string[] {
  const chips = recipe.tags.slice(0, MAX_STYLE_CHIPS).map((tag) => MEAL_STYLE_TAG_LABELS[tag]);
  const diet = DIET_CHIP_PRIORITY.find((flag) => recipe.diet_flags.includes(flag));
  if (diet) chips.push(DIET_FLAG_LABELS[diet]);
  return chips;
}

/** Vista di dettaglio per la RecipeSheet, con quantità scalate su `servings`. */
export function toRecipeDetail(recipe: Recipe, servings: number): RecipeDetail {
  const ingredients = (recipe.ingredients ?? []).map((ing, index) => ({
    id: ing.id ?? `${recipe.id}:${index}`,
    name: ing.display_name,
    amount:
      ing.qty == null
        ? 0
        : Math.round(((ing.qty * servings) / recipe.servings_base) * AMOUNT_DECIMALS_FACTOR) /
          AMOUNT_DECIMALS_FACTOR,
    unit: ing.unit,
  }));
  return {
    id: recipe.id,
    title: recipe.title,
    description: recipe.description,
    prepTimeMinutes: recipe.prep_minutes,
    servings,
    tags: recipeChips(recipe),
    ingredients,
    steps: recipe.steps,
    rating: recipe.prefs?.rating ?? undefined,
    isFavorite: recipe.prefs?.favorite ?? false,
    isBlocked: recipe.prefs?.blocked ?? false,
  };
}
