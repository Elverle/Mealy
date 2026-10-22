// Regole pure della Libreria: card, filtri, ricerca, ordinamento, query string.
// Nessuna dipendenza da DB, LLM o framework.

import type { z } from 'zod';
import { expandDietFlags, normalizeCanonicalName, normalizeTitle } from './recipe-text';
import {
  LIBRARY_QUERY_MAX,
  LibraryFilterSchema,
  PROPOSAL_EXCLUDE_MAX,
  RECIPE_REQUEST_MIN,
  type LibraryFilter,
  type LibraryRecipeCard,
  type Recipe,
} from './types';

/** Nomi canonici normalizzati degli ingredienti, distinti, nell'ordine della ricetta. */
export function recipeIngredientNames(recipe: Pick<Recipe, 'ingredients'>): string[] {
  const seen = new Set<string>();
  const names: string[] = [];
  for (const ingredient of recipe.ingredients ?? []) {
    const name = normalizeCanonicalName(ingredient.canonical_name);
    if (name === '' || seen.has(name)) continue;
    seen.add(name);
    names.push(name);
  }
  return names;
}

/** Vista leggera di una ricetta. Senza riga di preferenze: rating null, favorite e blocked false. */
export function toLibraryCard(recipe: Recipe): LibraryRecipeCard {
  return {
    id: recipe.id,
    title: recipe.title,
    prep_minutes: recipe.prep_minutes,
    meal_types: recipe.meal_types,
    courses: recipe.courses,
    tags: recipe.tags,
    diet_flags: recipe.diet_flags,
    ingredient_names: recipeIngredientNames(recipe),
    rating: recipe.prefs?.rating ?? null,
    favorite: recipe.prefs?.favorite ?? false,
    blocked: recipe.prefs?.blocked ?? false,
    created_at: recipe.created_at.toISOString(),
  };
}

/** true se la card soddisfa tutti i criteri del filtro. */
export function matchesLibraryFilter(card: LibraryRecipeCard, filter: LibraryFilter): boolean {
  if (filter.blocked ? !card.blocked : card.blocked) return false;
  if (filter.favorites && !card.favorite) return false;
  if (!filter.meals.every((meal) => card.meal_types.includes(meal))) return false;
  // Portate in OR: basta una. Una ricetta non classificata non corrisponde.
  if (filter.courses.length > 0 && !card.courses.some((course) => filter.courses.includes(course))) {
    return false;
  }
  if (!filter.tags.every((tag) => card.tags.includes(tag))) return false;
  if (filter.diets.length > 0) {
    const diets = expandDietFlags(card.diet_flags);
    if (!filter.diets.every((diet) => diets.includes(diet))) return false;
  }
  const tokens = normalizeTitle(filter.q).split(' ').filter(Boolean);
  if (tokens.length > 0) {
    const haystack = normalizeTitle([card.title, ...card.ingredient_names].join(' '));
    if (!tokens.every((token) => haystack.includes(token))) return false;
  }
  return true;
}

/** Ordine della Libreria: preferite prima, poi più recenti, poi titolo, poi id. */
export function compareLibraryCards(a: LibraryRecipeCard, b: LibraryRecipeCard): number {
  if (a.favorite !== b.favorite) return a.favorite ? -1 : 1;
  if (a.created_at !== b.created_at) return a.created_at < b.created_at ? 1 : -1;
  const byTitle = a.title.localeCompare(b.title, 'it');
  if (byTitle !== 0) return byTitle;
  if (a.id === b.id) return 0;
  return a.id < b.id ? -1 : 1;
}

/** Filtra e ordina; restituisce un array nuovo. */
export function filterLibraryCards(
  cards: readonly LibraryRecipeCard[],
  filter: LibraryFilter
): LibraryRecipeCard[] {
  return cards.filter((card) => matchesLibraryFilter(card, filter)).sort(compareLibraryCards);
}

export type LibraryQueryResult =
  | { ok: true; filter: LibraryFilter }
  | { ok: false; issues: z.ZodIssue[] };

const TRUE_VALUES = new Set(['1', 'true']);
const FALSE_VALUES = new Set(['0', 'false']);

function parseFlag(value: string | null): boolean | string {
  if (value === null) return false;
  if (TRUE_VALUES.has(value)) return true;
  if (FALSE_VALUES.has(value)) return false;
  return value; // rifiutato da Zod
}

function distinct(values: string[]): string[] {
  return [...new Set(values)];
}

/** Legge il filtro dalla query string di GET /api/recipes. */
export function parseLibraryQuery(params: URLSearchParams): LibraryQueryResult {
  const parsed = LibraryFilterSchema.safeParse({
    q: (params.get('q') ?? '').trim(),
    meals: distinct(params.getAll('pasto')),
    courses: distinct(params.getAll('portata')),
    tags: distinct(params.getAll('tag')),
    diets: distinct(params.getAll('dieta')),
    favorites: parseFlag(params.get('preferite')),
    blocked: parseFlag(params.get('bloccate')),
  });
  return parsed.success
    ? { ok: true, filter: parsed.data }
    : { ok: false, issues: parsed.error.issues };
}

/**
 * Testo da mandare al modello per una richiesta libera: il testo cercato senza spazi ai
 * bordi, oppure `null` se è più corto di RECIPE_REQUEST_MIN o più lungo di LIBRARY_QUERY_MAX.
 */
export function recipeRequestText(query: string): string | null {
  const text = query.trim();
  return text.length >= RECIPE_REQUEST_MIN && text.length <= LIBRARY_QUERY_MAX ? text : null;
}

/**
 * Sequenza di «Un'altra»: aggiunge `title` in coda ai titoli già proposti, toglie un
 * eventuale doppione (titolo normalizzato) e tiene gli ultimi PROPOSAL_EXCLUDE_MAX.
 * Restituisce un array nuovo.
 */
export function appendProposedTitle(titles: readonly string[], title: string): string[] {
  const key = normalizeTitle(title);
  return [...titles.filter((existing) => normalizeTitle(existing) !== key), title].slice(
    -PROPOSAL_EXCLUDE_MAX
  );
}
