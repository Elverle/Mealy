import { normalizeCanonicalName } from '@/lib/domain/recipe-text';
import {
  DIET_FLAG_LABELS,
  MEAL_STYLE_TAG_LABELS,
  type DietFlag,
  type Ingredient,
  type Recipe,
  type RecipeIngredientInfo,
} from '@/lib/domain/types';
import type { RecipeDetail, RecipeIngredient } from './recipe-sheet';

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
export function recipeChips(recipe: Pick<Recipe, 'tags' | 'diet_flags'>): string[] {
  const chips = recipe.tags.slice(0, MAX_STYLE_CHIPS).map((tag) => MEAL_STYLE_TAG_LABELS[tag]);
  const diet = DIET_CHIP_PRIORITY.find((flag) => recipe.diet_flags.includes(flag));
  if (diet) chips.push(DIET_FLAG_LABELS[diet]);
  return chips;
}

/** Id di riga dell'ingrediente nella sheet: l'id dell'ingrediente o `${recipe.id}:${index}`. */
export function ingredientRowId(
  recipe: Pick<Recipe, 'id'>,
  ingredient: Pick<Ingredient, 'id'>,
  index: number
): string {
  return ingredient.id ?? `${recipe.id}:${index}`;
}

/** Ingrediente della ricetta a partire dall'id di riga; null se non c'è. */
export function findRecipeIngredient(recipe: Recipe, rowId: string): Ingredient | null {
  const ingredients = recipe.ingredients ?? [];
  const index = ingredients.findIndex((ing, i) => ingredientRowId(recipe, ing, i) === rowId);
  return index === -1 ? null : ingredients[index];
}

/**
 * Vista di dettaglio per la RecipeSheet, con quantità scalate su `servings`.
 * Solo con `ingredientInfo` ogni ingrediente riceve anche `canonicalName`, `preference` e `recipesCount`.
 */
export function toRecipeDetail(
  recipe: Recipe,
  servings: number,
  ingredientInfo?: ReadonlyMap<string, RecipeIngredientInfo>
): RecipeDetail {
  const ingredients = (recipe.ingredients ?? []).map((ing, index) => {
    const base = {
      id: ingredientRowId(recipe, ing, index),
      name: ing.display_name,
      amount:
        ing.qty == null
          ? 0
          : Math.round(((ing.qty * servings) / recipe.servings_base) * AMOUNT_DECIMALS_FACTOR) /
            AMOUNT_DECIMALS_FACTOR,
      unit: ing.unit,
    };
    if (!ingredientInfo) return base;
    const canonicalName = normalizeCanonicalName(ing.canonical_name);
    const info = ingredientInfo.get(canonicalName);
    return {
      ...base,
      canonicalName,
      preference: info?.pref === 'like' ? 'liked' : info?.pref === 'dislike' ? 'disliked' : null,
      recipesCount: info?.recipes_count,
    } satisfies RecipeIngredient;
  });
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
