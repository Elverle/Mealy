// @vitest-environment node
import { describe, it, expect } from 'vitest';
import {
  appendProposedTitle,
  compareLibraryCards,
  filterLibraryCards,
  matchesLibraryFilter,
  parseLibraryQuery,
  recipeIngredientNames,
  recipeRequestText,
  toLibraryCard,
} from '@/lib/domain/library';
import {
  EMPTY_LIBRARY_FILTER,
  LIBRARY_QUERY_MAX,
  PROPOSAL_EXCLUDE_MAX,
  RecipeSchema,
  type LibraryFilter,
  type LibraryRecipeCard,
  type Recipe,
} from '@/lib/domain/types';

const HOUSEHOLD_ID = '00000000-0000-4000-8000-000000000001';
const ID_A = '00000000-0000-4000-8000-00000000000a';
const ID_B = '00000000-0000-4000-8000-00000000000b';

function ingredient(canonical_name: string) {
  return {
    canonical_name,
    display_name: canonical_name,
    qty: 1,
    unit: 'g' as const,
    category: 'dispensa' as const,
  };
}

function makeRecipe(overrides: Partial<Recipe> & { names?: string[] } = {}): Recipe {
  const { names, ...rest } = overrides;
  return RecipeSchema.parse({
    id: ID_A,
    household_id: HOUSEHOLD_ID,
    title: 'Pollo al limone',
    slug: 'pollo-al-limone',
    steps: ['Cuoci.'],
    meal_types: ['cena'],
    servings_base: 2,
    prep_minutes: 20,
    created_at: '2026-01-01T10:00:00.000Z',
    ingredients: (names ?? ['pollo', 'limone']).map(ingredient),
    ...rest,
  });
}

function makeCard(overrides: Partial<LibraryRecipeCard> = {}): LibraryRecipeCard {
  return {
    id: ID_A,
    title: 'Pollo al limone',
    prep_minutes: 20,
    meal_types: ['pranzo', 'cena'],
    courses: [],
    tags: ['veloce', 'salutare'],
    diet_flags: [],
    ingredient_names: ['pollo', 'limone'],
    rating: null,
    favorite: false,
    blocked: false,
    created_at: '2026-01-01T10:00:00.000Z',
    ...overrides,
  };
}

function filterWith(overrides: Partial<LibraryFilter>): LibraryFilter {
  return { ...EMPTY_LIBRARY_FILTER, ...overrides };
}

describe('recipeIngredientNames', () => {
  it('normalizes names and drops duplicates keeping the first occurrence', () => {
    const recipe = makeRecipe({ names: [' Cipolla ', 'Sale', 'cipolla', 'pepe'] });
    expect(recipeIngredientNames(recipe)).toEqual(['cipolla', 'sale', 'pepe']);
  });

  it('returns [] for a recipe without ingredients', () => {
    expect(recipeIngredientNames({})).toEqual([]);
    expect(recipeIngredientNames({ ingredients: [] })).toEqual([]);
  });

  it('skips names that are empty after normalization', () => {
    const recipe = { ingredients: [{ ...ingredient('x'), canonical_name: '   ' }, ingredient('sale')] };
    expect(recipeIngredientNames(recipe)).toEqual(['sale']);
  });
});

describe('toLibraryCard', () => {
  it('uses defaults when the recipe has no prefs row', () => {
    const card = toLibraryCard(makeRecipe());
    expect(card).toMatchObject({
      id: ID_A,
      title: 'Pollo al limone',
      prep_minutes: 20,
      meal_types: ['cena'],
      ingredient_names: ['pollo', 'limone'],
      rating: null,
      favorite: false,
      blocked: false,
      created_at: '2026-01-01T10:00:00.000Z',
    });
  });

  it('copies rating, favorite and blocked from prefs', () => {
    const card = toLibraryCard(
      makeRecipe({
        prefs: { recipe_id: ID_A, rating: 4, favorite: true, blocked: false, times_used: 2, last_used_at: null },
      })
    );
    expect(card).toMatchObject({ rating: 4, favorite: true, blocked: false });
  });
});

describe('matchesLibraryFilter', () => {
  it('matches everything unblocked with the empty filter', () => {
    expect(matchesLibraryFilter(makeCard(), EMPTY_LIBRARY_FILTER)).toBe(true);
  });

  it('hides blocked recipes by default and shows only them with blocked: true', () => {
    const blocked = makeCard({ blocked: true });
    expect(matchesLibraryFilter(blocked, EMPTY_LIBRARY_FILTER)).toBe(false);
    expect(matchesLibraryFilter(blocked, filterWith({ blocked: true }))).toBe(true);
    expect(matchesLibraryFilter(makeCard(), filterWith({ blocked: true }))).toBe(false);
  });

  it('keeps only favorites with favorites: true', () => {
    expect(matchesLibraryFilter(makeCard(), filterWith({ favorites: true }))).toBe(false);
    expect(matchesLibraryFilter(makeCard({ favorite: true }), filterWith({ favorites: true }))).toBe(true);
  });

  it('requires every selected meal', () => {
    const card = makeCard({ meal_types: ['cena'] });
    expect(matchesLibraryFilter(card, filterWith({ meals: ['cena'] }))).toBe(true);
    expect(matchesLibraryFilter(card, filterWith({ meals: ['pranzo'] }))).toBe(false);
    expect(matchesLibraryFilter(card, filterWith({ meals: ['pranzo', 'cena'] }))).toBe(false);
  });

  it('requires every selected tag', () => {
    const card = makeCard({ tags: ['veloce'] });
    expect(matchesLibraryFilter(card, filterWith({ tags: ['veloce'] }))).toBe(true);
    expect(matchesLibraryFilter(card, filterWith({ tags: ['veloce', 'salutare'] }))).toBe(false);
  });

  it('requires every selected diet', () => {
    const card = makeCard({ diet_flags: ['senza-glutine'] });
    expect(matchesLibraryFilter(card, filterWith({ diets: ['senza-glutine'] }))).toBe(true);
    expect(matchesLibraryFilter(card, filterWith({ diets: ['vegetariano'] }))).toBe(false);
  });

  it('lets a vegan recipe satisfy the vegetarian filter', () => {
    const card = makeCard({ diet_flags: ['vegano'] });
    expect(matchesLibraryFilter(card, filterWith({ diets: ['vegetariano'] }))).toBe(true);
  });

  it('does not let a vegetarian-only recipe satisfy the vegan filter', () => {
    const card = makeCard({ diet_flags: ['vegetariano'] });
    expect(matchesLibraryFilter(card, filterWith({ diets: ['vegano'] }))).toBe(false);
  });

  it('searches the title ignoring case and accents', () => {
    expect(matchesLibraryFilter(makeCard(), filterWith({ q: 'POLLO limòne' }))).toBe(true);
  });

  it('searches the ingredient names too', () => {
    const card = makeCard({ title: 'Pasta estiva', ingredient_names: ['pasta', 'zucchina'] });
    expect(matchesLibraryFilter(card, filterWith({ q: 'zucchina' }))).toBe(true);
  });

  it('fails when one of the search words is missing', () => {
    expect(matchesLibraryFilter(makeCard(), filterWith({ q: 'pollo funghi' }))).toBe(false);
  });

  it('treats a query without tokens as no search', () => {
    expect(matchesLibraryFilter(makeCard(), filterWith({ q: ' !! ' }))).toBe(true);
  });
});

describe('compareLibraryCards', () => {
  it('puts favorites first even when older', () => {
    const fav = makeCard({ id: ID_A, favorite: true, created_at: '2025-01-01T00:00:00.000Z' });
    const recent = makeCard({ id: ID_B, created_at: '2026-06-01T00:00:00.000Z' });
    expect(compareLibraryCards(fav, recent)).toBeLessThan(0);
    expect(compareLibraryCards(recent, fav)).toBeGreaterThan(0);
  });

  it('puts the most recent first on equal favorite', () => {
    const older = makeCard({ id: ID_A, created_at: '2026-01-01T00:00:00.000Z' });
    const newer = makeCard({ id: ID_B, created_at: '2026-02-01T00:00:00.000Z' });
    expect(compareLibraryCards(newer, older)).toBeLessThan(0);
  });

  it('orders by title on equal date', () => {
    const a = makeCard({ id: ID_B, title: 'Arrosto' });
    const b = makeCard({ id: ID_A, title: 'Zuppa' });
    expect(compareLibraryCards(a, b)).toBeLessThan(0);
  });

  it('orders by id on equal everything else', () => {
    const a = makeCard({ id: ID_A });
    const b = makeCard({ id: ID_B });
    expect(compareLibraryCards(a, b)).toBeLessThan(0);
    expect(compareLibraryCards(b, a)).toBeGreaterThan(0);
    expect(compareLibraryCards(a, a)).toBe(0);
  });
});

describe('filterLibraryCards', () => {
  it('filters and sorts into a new array without mutating the input', () => {
    const a = makeCard({ id: ID_A, title: 'Alfa', created_at: '2026-01-01T00:00:00.000Z' });
    const b = makeCard({ id: ID_B, title: 'Beta', created_at: '2026-02-01T00:00:00.000Z' });
    const hidden = makeCard({ id: '00000000-0000-4000-8000-00000000000c', blocked: true });
    const input = [a, hidden, b];
    const snapshot = [...input];

    const result = filterLibraryCards(input, EMPTY_LIBRARY_FILTER);

    expect(result.map((c) => c.id)).toEqual([ID_B, ID_A]);
    expect(result).not.toBe(input);
    expect(input).toEqual(snapshot);
  });
});

describe('parseLibraryQuery', () => {
  it('returns the empty filter for an empty query', () => {
    expect(parseLibraryQuery(new URLSearchParams())).toEqual({ ok: true, filter: EMPTY_LIBRARY_FILTER });
  });

  it('reads every parameter, dedupes repeated ones and trims q', () => {
    const params = new URLSearchParams(
      'pasto=cena&pasto=cena&tag=veloce&dieta=vegano&preferite=1&bloccate=true&q=%20pollo%20'
    );
    expect(parseLibraryQuery(params)).toEqual({
      ok: true,
      filter: {
        q: 'pollo',
        meals: ['cena'],
        courses: [],
        tags: ['veloce'],
        diets: ['vegano'],
        favorites: true,
        blocked: true,
      },
    });
  });

  it('accepts 0 and false as false', () => {
    const result = parseLibraryQuery(new URLSearchParams('preferite=0&bloccate=false'));
    expect(result).toEqual({ ok: true, filter: EMPTY_LIBRARY_FILTER });
  });

  it('rejects an unknown meal', () => {
    expect(parseLibraryQuery(new URLSearchParams('pasto=colazione')).ok).toBe(false);
  });

  it('rejects a non-boolean flag', () => {
    expect(parseLibraryQuery(new URLSearchParams('preferite=forse')).ok).toBe(false);
  });

  it('rejects a q longer than the maximum', () => {
    const q = 'a'.repeat(LIBRARY_QUERY_MAX + 1);
    const result = parseLibraryQuery(new URLSearchParams({ q }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues.length).toBeGreaterThan(0);
  });

  it('ignores unknown parameters', () => {
    expect(parseLibraryQuery(new URLSearchParams('foo=bar'))).toEqual({
      ok: true,
      filter: EMPTY_LIBRARY_FILTER,
    });
  });
});

describe('recipeRequestText', () => {
  it('returns null for an empty query or one shorter than the minimum after trim', () => {
    expect(recipeRequestText('')).toBeNull();
    expect(recipeRequestText('  ab  ')).toBeNull();
  });

  it('returns the query trimmed', () => {
    expect(recipeRequestText(' abc ')).toBe('abc');
  });

  it('accepts a query of exactly LIBRARY_QUERY_MAX characters', () => {
    const text = 'a'.repeat(LIBRARY_QUERY_MAX);
    expect(recipeRequestText(text)).toBe(text);
  });

  it('returns null for a query longer than LIBRARY_QUERY_MAX', () => {
    expect(recipeRequestText('a'.repeat(LIBRARY_QUERY_MAX + 1))).toBeNull();
  });
});

describe('appendProposedTitle', () => {
  it('appends the title at the end', () => {
    expect(appendProposedTitle(['Lasagne al pesto'], 'Risotto allo zafferano')).toEqual([
      'Lasagne al pesto',
      'Risotto allo zafferano',
    ]);
  });

  it('removes a duplicate by normalized title and keeps only the new one', () => {
    expect(appendProposedTitle(['Lasagne al pesto'], 'LASAGNE  al pesto!')).toEqual(['LASAGNE  al pesto!']);
  });

  it('keeps the last PROPOSAL_EXCLUDE_MAX titles, dropping the oldest', () => {
    const titles = Array.from({ length: PROPOSAL_EXCLUDE_MAX }, (_, i) => `Ricetta ${i}`);
    const result = appendProposedTitle(titles, 'Ricetta nuova');

    expect(result).toHaveLength(PROPOSAL_EXCLUDE_MAX);
    expect(result[0]).toBe('Ricetta 1');
    expect(result[result.length - 1]).toBe('Ricetta nuova');
  });

  it('does not mutate the array it receives', () => {
    const titles = ['Lasagne al pesto'];
    const result = appendProposedTitle(titles, 'Risotto');

    expect(result).not.toBe(titles);
    expect(titles).toEqual(['Lasagne al pesto']);
  });
});
