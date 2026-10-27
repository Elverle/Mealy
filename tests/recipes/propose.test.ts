// @vitest-environment node

import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { db } from '@/lib/db';
import { loadHousehold } from '@/lib/db/repositories/household-repo';
import { upsertIngredientPref } from '@/lib/db/repositories/ingredient-pref-repo';
import { insertRecipe, listRecipeTitles } from '@/lib/db/repositories/recipe-repo';
import {
  exclusionReason,
  manualChoiceExclusionReason,
  toIngredientPreferenceSets,
} from '@/lib/domain/planner';
import { normalizeGeneratedRecipe } from '@/lib/domain/recipe-text';
import {
  RecipeProposalSchema,
  SaveRecipeResultSchema,
  type GeneratedRecipe,
} from '@/lib/domain/types';
import { generateRecipeFromRequest } from '@/lib/llm';
import { LlmError } from '@/lib/llm/errors';
import { RecipeError } from '@/lib/recipes/errors';
import { proposeRecipe, saveProposedRecipe } from '@/lib/recipes/propose';
import {
  isDbAvailable,
  assertDbMigrated,
  createTestHousehold,
  deleteTestHousehold,
} from '@/tests/helpers/db';
import { createRecordedModel, loadLlmRecording } from '@/tests/helpers/mock-llm';
import { makeGeneratedRecipe } from '@/tests/helpers/recipes';

const dbUp = await isDbAvailable();

/** La ricetta della fixture `request-lasagne`, normalizzata come la produce il servizio. */
function lasagne(): GeneratedRecipe {
  return normalizeGeneratedRecipe(JSON.parse(loadLlmRecording('request-lasagne')).recipes[0]);
}

/** Un contorno (solo portata `contorno`) per cena, costruito dalla lasagne: stesse diete ed elettrodomestici. */
function sideDishRecipe(): GeneratedRecipe {
  return { ...lasagne(), title: 'Zucchine croccanti', courses: ['contorno'], meal_types: ['cena'] };
}

function modelWith(name: string) {
  return createRecordedModel([loadLlmRecording(name)]);
}

async function countRecipes(householdId: string): Promise<number> {
  return (await listRecipeTitles(db, householdId)).length;
}

/**
 * Testo dei messaggi utente del prompt. Le istruzioni di sistema elencano tutti i tag
 * ammessi (anche `economico`), quindi i controlli sul contenuto guardano solo l'utente.
 */
function userPromptText(call: unknown): string {
  const messages = (call as { prompt: { role: string; content: unknown }[] }).prompt;
  return messages
    .filter((message) => message.role === 'user')
    .map((message) => JSON.stringify(message.content))
    .join('\n');
}

/** Errore con cui si rifiuta la promessa; fallisce il test se non si rifiuta. */
async function rejectionOf(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (err) {
    return err;
  }
  throw new Error('expected the promise to reject');
}

describe.skipIf(!dbUp)('proposeRecipe and saveProposedRecipe', () => {
  let createdHouseholdIds: string[] = [];

  beforeAll(async () => {
    await assertDbMigrated();
  });

  beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    for (const id of createdHouseholdIds) {
      await deleteTestHousehold(id);
    }
    createdHouseholdIds = [];
  });

  async function createHousehold(
    overrides?: Parameters<typeof createTestHousehold>[0]
  ): Promise<string> {
    const id = await createTestHousehold(overrides);
    createdHouseholdIds.push(id);
    return id;
  }

  async function insertTitled(householdId: string, title: string): Promise<string> {
    const inserted = await insertRecipe({
      household_id: householdId,
      title,
      slug: `${title.toLowerCase().replace(/\W+/g, '-')}-${crypto.randomUUID().slice(0, 8)}`,
      steps: ['Passo unico'],
      meal_types: ['pranzo', 'cena'],
      appliances_required: ['fornelli'],
      servings_base: 2,
      prep_minutes: 20,
    });
    return inserted.id;
  }

  describe('proposeRecipe', () => {
    it('proposes the recipe for the request without writing to the library (R6 boundary)', async () => {
      const householdId = await createHousehold();
      const { model, calls } = modelWith('request-lasagne');

      const proposal = await proposeRecipe(
        { householdId, request: 'lasagne al pesto', mealType: null, excludeTitles: [] },
        { model }
      );

      expect(proposal.recipe.title).toBe('Lasagne al pesto');
      expect(proposal.duplicate_of).toBeNull();
      expect(await countRecipes(householdId)).toBe(0);
      expect(JSON.stringify(calls[0])).toContain('lasagne al pesto');
      expect(() =>
        RecipeProposalSchema.parse(JSON.parse(JSON.stringify(proposal)))
      ).not.toThrow();
    });

    it('sends the excluded titles to the model', async () => {
      const householdId = await createHousehold();
      const { model, calls } = modelWith('request-lasagne');

      await proposeRecipe(
        {
          householdId,
          request: 'lasagne al pesto',
          mealType: null,
          excludeTitles: ['Lasagne bianche ai funghi'],
        },
        { model }
      );

      expect(JSON.stringify(calls[0])).toContain('Lasagne bianche ai funghi');
    });

    it('keeps meal style and ingredient preferences out of the request prompt', async () => {
      const householdId = await createHousehold({ meal_style_tags: ['economico'] });
      await upsertIngredientPref(db, householdId, 'cipolla', 'dislike');
      await upsertIngredientPref(db, householdId, 'zucchina', 'like');
      const { model, calls } = modelWith('request-lasagne');

      await proposeRecipe(
        { householdId, request: 'lasagne al pesto', mealType: null, excludeTitles: [] },
        { model }
      );

      const userText = userPromptText(calls[0]);
      expect(userText).toContain('lasagne al pesto');
      expect(userText).not.toContain('economico');
      expect(userText).not.toContain('cipolla');
      expect(userText).not.toContain('zucchina');
    });

    it('rejects a proposal that violates the diets with proposal_unsuitable and logs the violations', async () => {
      const householdId = await createHousehold({ diet_tags: ['vegano'] });
      const { model } = modelWith('request-lasagne');

      const error = await rejectionOf(
        proposeRecipe(
          { householdId, request: 'lasagne al pesto', mealType: null, excludeTitles: [] },
          { model }
        )
      );

      expect(error).toBeInstanceOf(RecipeError);
      expect((error as RecipeError).code).toBe('proposal_unsuitable');
      expect(await countRecipes(householdId)).toBe(0);
      expect(console.warn).toHaveBeenCalledWith(
        '[recipes/propose] proposal_unsuitable',
        expect.objectContaining({
          title: 'Lasagne al pesto',
          violations: [expect.stringContaining('vegano')],
        })
      );
    });

    it('rejects a proposal that needs an appliance the household lacks', async () => {
      const householdId = await createHousehold({ appliances: ['fornelli'] });
      const { model } = modelWith('request-lasagne');

      const error = await rejectionOf(
        proposeRecipe(
          { householdId, request: 'lasagne al pesto', mealType: null, excludeTitles: [] },
          { model }
        )
      );

      expect((error as RecipeError).code).toBe('proposal_unsuitable');
      expect(console.warn).toHaveBeenCalledWith(
        '[recipes/propose] proposal_unsuitable',
        expect.objectContaining({
          violations: [expect.stringContaining('forno')],
        })
      );
    });

    it('rejects a proposal for a meal it does not cover, but accepts it without a requested meal', async () => {
      const householdId = await createHousehold();

      const error = await rejectionOf(
        proposeRecipe(
          { householdId, request: 'lasagne bianche', mealType: 'cena', excludeTitles: [] },
          { model: modelWith('request-lasagne-altra').model }
        )
      );
      expect((error as RecipeError).code).toBe('proposal_unsuitable');
      expect(console.warn).toHaveBeenCalledWith(
        '[recipes/propose] proposal_unsuitable',
        expect.objectContaining({ violations: ['pasto "cena" mancante'] })
      );

      const proposal = await proposeRecipe(
        { householdId, request: 'lasagne bianche', mealType: null, excludeTitles: [] },
        { model: modelWith('request-lasagne-altra').model }
      );
      expect(proposal.recipe.title).toBe('Lasagne bianche ai funghi');
    });

    it('returns a proposal that contains a disliked ingredient (the constraint does not apply to requests)', async () => {
      const householdId = await createHousehold();
      await upsertIngredientPref(db, householdId, 'basilico', 'dislike');

      const proposal = await proposeRecipe(
        { householdId, request: 'lasagne al pesto', mealType: null, excludeTitles: [] },
        { model: modelWith('request-lasagne').model }
      );

      expect(proposal.recipe.title).toBe('Lasagne al pesto');
    });

    it('reports the library recipe with the same normalized title as duplicate_of', async () => {
      const householdId = await createHousehold();
      const existingId = await insertTitled(householdId, 'LASAGNE al Pesto!');

      const proposal = await proposeRecipe(
        { householdId, request: 'lasagne al pesto', mealType: null, excludeTitles: [] },
        { model: modelWith('request-lasagne').model }
      );

      expect(proposal.duplicate_of).toEqual({ id: existingId, title: 'LASAGNE al Pesto!' });
    });

    it('reports no duplicate when the library only has a different recipe', async () => {
      const householdId = await createHousehold();
      await insertTitled(householdId, 'Lasagne al ragù');

      const proposal = await proposeRecipe(
        { householdId, request: 'lasagne al pesto', mealType: null, excludeTitles: [] },
        { model: modelWith('request-lasagne').model }
      );

      expect(proposal.duplicate_of).toBeNull();
    });

    it('lets the LlmError of the generator reach the caller unchanged', async () => {
      const householdId = await createHousehold();
      const timeout = new LlmError('timeout', 'x');
      const generate = vi.fn().mockRejectedValue(timeout);

      const error = await rejectionOf(
        proposeRecipe(
          { householdId, request: 'lasagne al pesto', mealType: null, excludeTitles: [] },
          { generate }
        )
      );

      expect(error).toBe(timeout);
    });

    it('passes the abort signal to the generator', async () => {
      const householdId = await createHousehold();
      const generate = vi.fn().mockResolvedValue(lasagne());
      const controller = new AbortController();

      await proposeRecipe(
        { householdId, request: 'lasagne al pesto', mealType: null, excludeTitles: [] },
        { generate, abortSignal: controller.signal }
      );

      expect(generate).toHaveBeenCalledTimes(1);
      expect(generate.mock.calls[0][3].abortSignal).toBe(controller.signal);
    });

    it('rejects from the Piano a proposal that is only a side dish, with proposal_unsuitable', async () => {
      const householdId = await createHousehold();
      const generate = vi.fn().mockResolvedValue(sideDishRecipe());

      const error = await rejectionOf(
        proposeRecipe(
          { householdId, request: 'zucchine croccanti', mealType: 'cena', excludeTitles: [] },
          { generate }
        )
      );

      expect((error as RecipeError).code).toBe('proposal_unsuitable');
      expect(console.warn).toHaveBeenCalledWith(
        '[recipes/propose] proposal_unsuitable',
        expect.objectContaining({ violations: ['portata non adatta al pasto'] })
      );
    });

    it('returns from the Libreria (no meal chosen) the same side dish, with its courses', async () => {
      const householdId = await createHousehold();

      const proposal = await proposeRecipe(
        { householdId, request: 'zucchine croccanti', mealType: null, excludeTitles: [] },
        { generate: vi.fn().mockResolvedValue(sideDishRecipe()) }
      );

      expect(proposal.recipe.title).toBe('Zucchine croccanti');
      expect(proposal.recipe.courses).toEqual(['contorno']);
    });

    it('returns the proposal with the style tags derived from the rules', async () => {
      const householdId = await createHousehold();
      // Tre ingredienti misurati: pochi-ingredienti si aggiunge alle etichette del modello.
      const recipe = makeGeneratedRecipe({
        title: 'Ceci saltati',
        courses: ['secondo'],
        tags: ['comfort-food'],
      });

      const proposal = await proposeRecipe(
        { householdId, request: 'ceci saltati', mealType: 'cena', excludeTitles: [] },
        { generate: vi.fn().mockResolvedValue(recipe) }
      );

      expect(proposal.recipe.tags).toEqual(['comfort-food', 'pochi-ingredienti']);
    });
  });

  describe('saveProposedRecipe', () => {
    it('saves the proposal as an LLM recipe with default preferences (R6 boundary)', async () => {
      const householdId = await createHousehold();

      const saved = await saveProposedRecipe({ householdId, recipe: lasagne() });

      expect(saved.source).toBe('llm');
      expect(saved.ingredients).toHaveLength(6);
      expect(saved.prefs).toMatchObject({ favorite: false, blocked: false, times_used: 0 });
      expect(await countRecipes(householdId)).toBe(1);
      expect(() =>
        SaveRecipeResultSchema.parse(JSON.parse(JSON.stringify({ recipe: saved })))
      ).not.toThrow();
    });

    it('rejects a second save of the same title with recipe_duplicate, also when spacing and punctuation differ', async () => {
      const householdId = await createHousehold();
      await saveProposedRecipe({ householdId, recipe: lasagne() });

      const same = await rejectionOf(saveProposedRecipe({ householdId, recipe: lasagne() }));
      expect((same as RecipeError).code).toBe('recipe_duplicate');

      const variant = await rejectionOf(
        saveProposedRecipe({
          householdId,
          recipe: { ...lasagne(), title: 'LASAGNE  al pesto!' },
        })
      );
      expect((variant as RecipeError).code).toBe('recipe_duplicate');
      expect(await countRecipes(householdId)).toBe(1);
    });

    it('saves a title that only resembles a library recipe (no similarity check)', async () => {
      const householdId = await createHousehold();
      await insertTitled(householdId, 'Lasagne al pesto fresco');

      const saved = await saveProposedRecipe({ householdId, recipe: lasagne() });

      expect(saved.title).toBe('Lasagne al pesto');
      expect(await countRecipes(householdId)).toBe(2);
    });

    it('rejects a recipe that violates the diets or lacks an appliance with recipe_unsuitable, writing nothing', async () => {
      const veganHousehold = await createHousehold({ diet_tags: ['vegano'] });
      const noOvenHousehold = await createHousehold({ appliances: ['fornelli'] });

      const vegan = await rejectionOf(
        saveProposedRecipe({ householdId: veganHousehold, recipe: lasagne() })
      );
      expect((vegan as RecipeError).code).toBe('recipe_unsuitable');
      expect(console.warn).toHaveBeenCalledWith(
        '[recipes/save] recipe_unsuitable',
        expect.objectContaining({
          title: 'Lasagne al pesto',
          violations: [expect.stringContaining('vegano')],
        })
      );

      const noOven = await rejectionOf(
        saveProposedRecipe({ householdId: noOvenHousehold, recipe: lasagne() })
      );
      expect((noOven as RecipeError).code).toBe('recipe_unsuitable');
      expect(console.warn).toHaveBeenCalledWith(
        '[recipes/save] recipe_unsuitable',
        expect.objectContaining({ violations: [expect.stringContaining('forno')] })
      );

      expect(await countRecipes(veganHousehold)).toBe(0);
      expect(await countRecipes(noOvenHousehold)).toBe(0);
    });

    it('saves a recipe with a disliked ingredient, which the draw still excludes (parity with the planner)', async () => {
      const householdId = await createHousehold();
      await upsertIngredientPref(db, householdId, 'basilico', 'dislike');

      const saved = await saveProposedRecipe({ householdId, recipe: lasagne() });
      const household = await loadHousehold(householdId);

      expect(
        exclusionReason(saved, 'pranzo', {
          household,
          ingredientPrefs: toIngredientPreferenceSets([], ['basilico']),
          excludeRecipeIds: new Set(),
        })
      ).toBe('disliked_ingredient');
      // R6/P2: la scelta a mano della stessa ricetta resta ammessa.
      expect(manualChoiceExclusionReason(saved, 'pranzo', household)).toBeNull();
    });

    it('lets exactly one of two overlapping saves of the same title succeed', async () => {
      const householdId = await createHousehold();

      const results = await Promise.allSettled([
        saveProposedRecipe({ householdId, recipe: lasagne() }),
        saveProposedRecipe({ householdId, recipe: lasagne() }),
      ]);

      const fulfilled = results.filter((result) => result.status === 'fulfilled');
      const rejected = results.filter(
        (result): result is PromiseRejectedResult => result.status === 'rejected'
      );
      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);
      expect((rejected[0].reason as RecipeError).code).toBe('recipe_duplicate');
      expect(await countRecipes(householdId)).toBe(1);
    });

    it('stores the same title in two households, with distinct slugs (slugs are global)', async () => {
      const first = await createHousehold();
      const second = await createHousehold();

      const savedFirst = await saveProposedRecipe({ householdId: first, recipe: lasagne() });
      const savedSecond = await saveProposedRecipe({ householdId: second, recipe: lasagne() });

      expect(savedFirst.slug).not.toBe(savedSecond.slug);
      expect(await countRecipes(first)).toBe(1);
      expect(await countRecipes(second)).toBe(1);
    });

    it('saves a side dish accepted from the Libreria with courses contorno', async () => {
      const householdId = await createHousehold();

      const saved = await saveProposedRecipe({ householdId, recipe: sideDishRecipe() });

      expect(saved.courses).toEqual(['contorno']);
      expect(await countRecipes(householdId)).toBe(1);
    });
  });
});
