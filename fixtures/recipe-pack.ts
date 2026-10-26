import rawPack from './recipe-pack.json';
import rawIngredients from './recipe-pack-ingredients.json';
import {
  PackIngredientsFileSchema,
  RecipePackFileSchema,
  type GeneratedRecipe,
  type PackIngredientFact,
} from '@/lib/domain/types';

// Pacchetto iniziale (Feature 10): lo scrive `pnpm recipes:pack build`, lo carica l'app all'avvio.
// Come `FIXTURE_CREATED_AT`: in Libreria sotto le ricette dell'utente, in ordine di titolo.
export const RECIPE_PACK_CREATED_AT: Date = new Date('2026-01-01T00:00:00Z');

export const RECIPE_PACK_RECIPES: GeneratedRecipe[] = RecipePackFileSchema.parse(rawPack).recipes;
export const RECIPE_PACK_INGREDIENTS: PackIngredientFact[] =
  PackIngredientsFileSchema.parse(rawIngredients).ingredients;
