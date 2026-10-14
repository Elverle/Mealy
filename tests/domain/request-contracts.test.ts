// @vitest-environment node
import { describe, it, expect } from 'vitest';
import {
  AssignSlotRecipeRequestSchema,
  LIBRARY_QUERY_MAX,
  PROPOSAL_EXCLUDE_MAX,
  ProposeRecipeRequestSchema,
  RECIPE_REQUEST_MIN,
  RecipeProposalSchema,
  SaveRecipeRequestSchema,
  SlotCandidatesSchema,
} from '@/lib/domain/types';

const RECIPE_ID = '00000000-0000-4000-8000-00000000000a';
const OTHER_ID = '00000000-0000-4000-8000-00000000000b';
const TITLE_MAX = 120;

const GENERATED_RECIPE = {
  title: 'Pasta al pomodoro',
  description: 'Un classico veloce.',
  meal_types: ['pranzo', 'cena'],
  tags: ['veloce'],
  diet_flags: [],
  appliances_required: ['fornelli'],
  servings_base: 2,
  prep_minutes: 20,
  kcal_est: 450,
  steps: ['Cuoci la pasta.'],
  ingredients: [
    {
      canonical_name: 'pasta',
      display_name: 'Pasta',
      qty: 200,
      unit: 'g',
      category: 'dispensa',
      note: null,
    },
  ],
};

describe('ProposeRecipeRequestSchema', () => {
  it('trims the request and fills meal_type and exclude_titles with their defaults', () => {
    expect(ProposeRecipeRequestSchema.parse({ request: '  lasagne  ' })).toEqual({
      request: 'lasagne',
      meal_type: null,
      exclude_titles: [],
    });
  });

  it.each([
    ['a request of 2 characters after trim', { request: '  ab ' }],
    ['a request longer than LIBRARY_QUERY_MAX', { request: 'a'.repeat(LIBRARY_QUERY_MAX + 1) }],
    ['an extra key', { request: 'abc', extra: 1 }],
    ['an unknown meal type', { request: 'abc', meal_type: 'colazione' }],
    [
      'more titles than PROPOSAL_EXCLUDE_MAX',
      { request: 'abc', exclude_titles: Array.from({ length: PROPOSAL_EXCLUDE_MAX + 1 }, (_, i) => `T${i}`) },
    ],
    ['an empty title', { request: 'abc', exclude_titles: [''] }],
    ['a title longer than 120 characters', { request: 'abc', exclude_titles: ['a'.repeat(TITLE_MAX + 1)] }],
  ])('rejects %s', (_label, body) => {
    expect(ProposeRecipeRequestSchema.safeParse(body).success).toBe(false);
  });

  it('accepts a request of exactly RECIPE_REQUEST_MIN and LIBRARY_QUERY_MAX characters', () => {
    expect(ProposeRecipeRequestSchema.safeParse({ request: 'a'.repeat(RECIPE_REQUEST_MIN) }).success).toBe(true);
    expect(ProposeRecipeRequestSchema.safeParse({ request: 'a'.repeat(LIBRARY_QUERY_MAX) }).success).toBe(true);
  });

  it('accepts exactly PROPOSAL_EXCLUDE_MAX titles', () => {
    const titles = Array.from({ length: PROPOSAL_EXCLUDE_MAX }, (_, i) => `Ricetta ${i}`);
    const parsed = ProposeRecipeRequestSchema.safeParse({ request: 'abc', exclude_titles: titles });
    expect(parsed.success).toBe(true);
  });
});

describe('RecipeProposalSchema', () => {
  it('accepts a proposal without a duplicate', () => {
    expect(RecipeProposalSchema.safeParse({ recipe: GENERATED_RECIPE, duplicate_of: null }).success).toBe(true);
  });

  it('accepts a proposal whose title is already in the library', () => {
    const body = {
      recipe: GENERATED_RECIPE,
      duplicate_of: { id: RECIPE_ID, title: 'Pasta al pomodoro' },
    };
    expect(RecipeProposalSchema.safeParse(body).success).toBe(true);
  });

  it('rejects a duplicate_of without an id', () => {
    const body = { recipe: GENERATED_RECIPE, duplicate_of: { title: 'Pasta al pomodoro' } };
    expect(RecipeProposalSchema.safeParse(body).success).toBe(false);
  });
});

describe('SaveRecipeRequestSchema', () => {
  it('accepts a generated recipe', () => {
    expect(SaveRecipeRequestSchema.safeParse({ recipe: GENERATED_RECIPE }).success).toBe(true);
  });

  it('rejects a recipe without ingredients', () => {
    const body = { recipe: { ...GENERATED_RECIPE, ingredients: [] } };
    expect(SaveRecipeRequestSchema.safeParse(body).success).toBe(false);
  });

  it('rejects an extra key next to the recipe', () => {
    expect(SaveRecipeRequestSchema.safeParse({ recipe: GENERATED_RECIPE, extra: true }).success).toBe(false);
  });
});

describe('AssignSlotRecipeRequestSchema', () => {
  it('accepts a recipe uuid', () => {
    expect(AssignSlotRecipeRequestSchema.safeParse({ recipe_id: RECIPE_ID }).success).toBe(true);
  });

  it.each([
    ['a non-uuid id', { recipe_id: 'x' }],
    ['a missing id', {}],
    ['an extra key', { recipe_id: RECIPE_ID, extra: 1 }],
  ])('rejects %s', (_label, body) => {
    expect(AssignSlotRecipeRequestSchema.safeParse(body).success).toBe(false);
  });
});

describe('SlotCandidatesSchema', () => {
  it('accepts an empty answer', () => {
    expect(SlotCandidatesSchema.safeParse({ recipes: [], in_plan_recipe_ids: [] }).success).toBe(true);
  });

  it('accepts uuids in in_plan_recipe_ids', () => {
    expect(SlotCandidatesSchema.safeParse({ recipes: [], in_plan_recipe_ids: [OTHER_ID] }).success).toBe(true);
  });

  it('rejects an in_plan_recipe_ids entry that is not a uuid', () => {
    expect(SlotCandidatesSchema.safeParse({ recipes: [], in_plan_recipe_ids: ['x'] }).success).toBe(false);
  });
});
