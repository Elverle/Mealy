// @vitest-environment node
import { describe, it, expect, vi, afterEach } from 'vitest';
import { APICallError } from 'ai';
import {
  generateRecipes,
  generateRecipeFromRequest,
  classifyRecipes,
  convertDatasetRecipe,
  draftIngredientFacts,
} from '@/lib/llm/adapter';
import { isLlmError } from '@/lib/llm/errors';
import {
  CLASSIFY_BATCH_SIZE,
  PACK_DRAFT_BATCH_SIZE,
  type ClassifyRecipeItem,
  type PackConvertItem,
  type RecipeConstraints,
} from '@/lib/domain/types';
import { createRecordedModel, loadLlmRecording } from '@/tests/helpers/mock-llm';

describe('lib/llm/adapter', () => {
  const baseConstraints: RecipeConstraints = {
    persons: 2,
    meal_type: 'cena',
    courses: null,
    diet_tags: [],
    meal_style_tags: [],
    appliances: ['fornelli', 'forno'],
    ingredient_likes: [],
    ingredient_dislikes: [],
  };

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('1. returns 2 normalized recipes from valid recording on first attempt', async () => {
    const raw = loadLlmRecording('valid-2-recipes');
    const { model, calls } = createRecordedModel([raw]);

    const recipes = await generateRecipes(baseConstraints, 2, [], { model });

    expect(recipes).toHaveLength(2);
    expect(calls).toHaveLength(1);

    const [first, second] = recipes;

    // First recipe: diet_flags expanded from ['vegano']
    expect(first.diet_flags).toEqual(['vegetariano', 'vegano', 'senza-lattosio', 'pescetariano']);
    // Ingredients normalized: tofu lowercase, sale with qty: null and note: null
    const tofu = first.ingredients.find((i) => i.canonical_name === 'tofu');
    expect(tofu).toBeDefined();
    expect(tofu?.canonical_name).toBe('tofu');

    const sale = first.ingredients.find((i) => i.canonical_name === 'sale');
    expect(sale).toBeDefined();
    expect(sale?.unit).toBe('qb');
    expect(sale?.qty).toBeNull();
    expect(sale?.note).toBeNull();

    // Second recipe: diet_flags deduplicated from ['senza-glutine', 'senza-glutine']
    expect(second.diet_flags).toEqual(['senza-glutine']);
    const rosmarino = second.ingredients.find((i) => i.canonical_name === 'rosmarino');
    expect(rosmarino).toBeDefined();
    expect(rosmarino?.unit).toBe('qb');
    expect(rosmarino?.qty).toBeNull();
  });

  it('2. returns at most n recipes when n = 1', async () => {
    const raw = loadLlmRecording('valid-2-recipes');
    const { model, calls } = createRecordedModel([raw]);

    const recipes = await generateRecipes(baseConstraints, 1, [], { model });

    expect(recipes).toHaveLength(1);
    expect(calls).toHaveLength(1);
  });

  it('3. repairs malformed truncated JSON on second attempt', async () => {
    const malformed = loadLlmRecording('malformed-truncated');
    const valid = loadLlmRecording('valid-2-recipes');
    const { model, calls } = createRecordedModel([malformed, valid]);

    const recipes = await generateRecipes(baseConstraints, 2, [], { model });

    expect(recipes).toHaveLength(2);
    expect(calls).toHaveLength(2);

    const repairCallJson = JSON.stringify(calls[1]);
    expect(repairCallJson).toContain('Errori di validazione');
    expect(repairCallJson).toContain('Risposta interrotta');
  });

  it('4. repairs schema validation failure on second attempt including issue path', async () => {
    const invalidEnum = loadLlmRecording('invalid-enum');
    const valid = loadLlmRecording('valid-2-recipes');
    const { model, calls } = createRecordedModel([invalidEnum, valid]);

    const recipes = await generateRecipes(baseConstraints, 2, [], { model });

    expect(recipes).toHaveLength(2);
    expect(calls).toHaveLength(2);

    const repairCallJson = JSON.stringify(calls[1]);
    expect(repairCallJson).toContain('ingredients.0.unit');
  });

  it('5. throws LlmError invalid_output after two failed attempts', async () => {
    const invalidEnum = loadLlmRecording('invalid-enum');
    const { model, calls } = createRecordedModel([invalidEnum, invalidEnum]);

    try {
      await generateRecipes(baseConstraints, 2, [], { model });
      expect.unreachable('Should have thrown');
    } catch (err) {
      expect(isLlmError(err)).toBe(true);
      if (isLlmError(err)) {
        expect(err.code).toBe('invalid_output');
        expect(err.message).toContain('non ha prodotto ricette valide');
      }
      expect(calls).toHaveLength(2);
    }
  });

  it('6. wraps APICallError into LlmError provider with HTTP status code', async () => {
    const apiError = new APICallError({
      message: 'Service Unavailable',
      url: 'https://example.test',
      requestBodyValues: {},
      statusCode: 503,
      isRetryable: false,
    });
    const { model } = createRecordedModel([apiError]);

    try {
      await generateRecipes(baseConstraints, 2, [], { model });
      expect.unreachable('Should have thrown');
    } catch (err) {
      expect(isLlmError(err)).toBe(true);
      if (isLlmError(err)) {
        expect(err.code).toBe('provider');
        expect(err.message).toContain('503');
      }
    }
  });

  it('7. wraps TimeoutError into LlmError timeout', async () => {
    const timeoutError = new DOMException('timed out', 'TimeoutError');
    const { model } = createRecordedModel([timeoutError]);

    try {
      await generateRecipes(baseConstraints, 2, [], { model });
      expect.unreachable('Should have thrown');
    } catch (err) {
      expect(isLlmError(err)).toBe(true);
      if (isLlmError(err)) {
        expect(err.code).toBe('timeout');
        expect(err.message).toContain('tempo massimo');
      }
    }
  });

  it('8. rejects invalid n with RangeError without invoking model', async () => {
    const { model, calls } = createRecordedModel([]);

    await expect(generateRecipes(baseConstraints, 0, [], { model })).rejects.toThrow(RangeError);
    await expect(generateRecipes(baseConstraints, 11, [], { model })).rejects.toThrow(RangeError);
    await expect(generateRecipes(baseConstraints, 2.5, [], { model })).rejects.toThrow(RangeError);

    expect(calls).toHaveLength(0);
  });

  it('9. throws LlmError config when model is not provided and env is missing LLM_MODEL', async () => {
    vi.stubEnv('LLM_MODEL', '');

    try {
      await generateRecipes(baseConstraints, 2, []);
      expect.unreachable('Should have thrown');
    } catch (err) {
      expect(isLlmError(err)).toBe(true);
      if (isLlmError(err)) {
        expect(err.code).toBe('config');
      }
    }
  });

  it('10. deduplicates excludeTitles and strips whitespace', async () => {
    const raw = loadLlmRecording('valid-2-recipes');
    const { model, calls } = createRecordedModel([raw]);

    const excludeTitles = ['Pasta al pesto', '  ', 'Pasta al pesto', 'Risotto alla milanese', ''];
    await generateRecipes(baseConstraints, 2, excludeTitles, { model });

    expect(calls).toHaveLength(1);
    const callJson = JSON.stringify(calls[0]);

    const pestoCount = (callJson.match(/- Pasta al pesto/g) || []).length;
    expect(pestoCount).toBe(1);
    expect(callJson).toContain('- Risotto alla milanese');
  });

  describe('generateRecipeFromRequest', () => {
    it('returns the single recipe proposed for the request, normalized', async () => {
      const raw = loadLlmRecording('request-lasagne');
      const { model, calls } = createRecordedModel([raw]);

      const recipe = await generateRecipeFromRequest(baseConstraints, 'lasagne al pesto', [], { model });

      expect(recipe.title).toBe('Lasagne al pesto');
      expect(calls).toHaveLength(1);
      // Diet flags expanded from ['vegetariano'], in DIET_FLAG_VALUES order
      expect(recipe.diet_flags).toEqual(['vegetariano', 'pescetariano']);

      const basilico = recipe.ingredients.find((i) => i.canonical_name === 'basilico');
      expect(basilico).toBeDefined();

      const sale = recipe.ingredients.find((i) => i.canonical_name === 'sale');
      expect(sale).toBeDefined();
      expect(sale?.qty).toBeNull();
      expect(sale?.unit).toBe('qb');
    });

    it('sends the request and the excluded titles in the prompt', async () => {
      const raw = loadLlmRecording('request-lasagne');
      const { model, calls } = createRecordedModel([raw]);

      await generateRecipeFromRequest(baseConstraints, 'lasagne al pesto', ['Lasagne bianche ai funghi'], {
        model,
      });

      const callJson = JSON.stringify(calls[0]);
      expect(callJson).toContain('lasagne al pesto');
      expect(callJson).toContain('<<<RICHIESTA');
      expect(callJson).toContain('Lasagne bianche ai funghi');
    });

    it('returns the first recipe when the model answers with several', async () => {
      const raw = loadLlmRecording('valid-2-recipes');
      const { model } = createRecordedModel([raw]);

      const recipe = await generateRecipeFromRequest(baseConstraints, 'tofu', [], { model });

      expect(recipe.title).toBe('Tofu croccante con verdure saltate');
    });

    it('repairs a malformed answer with a second call', async () => {
      const malformed = loadLlmRecording('malformed-truncated');
      const valid = loadLlmRecording('request-lasagne');
      const { model, calls } = createRecordedModel([malformed, valid]);

      const recipe = await generateRecipeFromRequest(baseConstraints, 'lasagne al pesto', [], { model });

      expect(recipe.title).toBe('Lasagne al pesto');
      expect(calls).toHaveLength(2);
    });

    it('throws LlmError invalid_output after two invalid answers', async () => {
      const invalidEnum = loadLlmRecording('invalid-enum');
      const { model, calls } = createRecordedModel([invalidEnum, invalidEnum]);

      const error = await generateRecipeFromRequest(baseConstraints, 'lasagne al pesto', [], { model }).then(
        () => null,
        (err: unknown) => err,
      );

      expect(isLlmError(error)).toBe(true);
      if (isLlmError(error)) {
        expect(error.code).toBe('invalid_output');
      }
      expect(calls).toHaveLength(2);
    });

    it('rejects an empty or blank request with RangeError without invoking the model', async () => {
      const { model, calls } = createRecordedModel([]);

      await expect(generateRecipeFromRequest(baseConstraints, '   ', [], { model })).rejects.toThrow(
        RangeError,
      );

      expect(calls).toHaveLength(0);
    });
  });

  describe('classifyRecipes', () => {
    const classifyItem = (ref: string): ClassifyRecipeItem => ({
      ref,
      title: `Ricetta ${ref}`,
      description: '',
      meal_types: ['cena'],
      tags: [],
      ingredient_names: ['pasta'],
    });
    const validClassification =
      '{"recipes":[{"ref":"r1","courses":["primo"],"style_tags":["tradizionale"]},{"ref":"r2","courses":[],"style_tags":[]}]}';
    const invalidCourse = '{"recipes":[{"ref":"r1","courses":["antipasto"],"style_tags":[]}]}';
    const twoItems = [classifyItem('r1'), classifyItem('r2')];

    it('returns the rows the model gives, without filtering them', async () => {
      const { model, calls } = createRecordedModel([validClassification]);

      const rows = await classifyRecipes(twoItems, { model });

      expect(rows).toEqual([
        { ref: 'r1', courses: ['primo'], style_tags: ['tradizionale'] },
        { ref: 'r2', courses: [], style_tags: [] },
      ]);
      expect(calls).toHaveLength(1);
    });

    it('sends the classification instructions and the numbered recipes in the prompt', async () => {
      const { model, calls } = createRecordedModel([validClassification]);

      await classifyRecipes(twoItems, { model });

      const callJson = JSON.stringify(calls[0]);
      expect(callJson).toContain('Classifichi ricette già esistenti');
      expect(callJson).toContain('[r1] Ricetta r1');
      expect(callJson).toContain('[r2] Ricetta r2');
    });

    it('repairs an unknown course with a second call', async () => {
      const { model, calls } = createRecordedModel([invalidCourse, validClassification]);

      const rows = await classifyRecipes(twoItems, { model });

      expect(rows).toHaveLength(2);
      expect(calls).toHaveLength(2);
      expect(JSON.stringify(calls[1])).toContain('courses.0');
    });

    it('throws LlmError invalid_output after two invalid answers', async () => {
      const { model, calls } = createRecordedModel([invalidCourse, invalidCourse]);

      const error = await classifyRecipes(twoItems, { model }).then(
        () => null,
        (err: unknown) => err,
      );

      expect(isLlmError(error)).toBe(true);
      if (isLlmError(error)) {
        expect(error.code).toBe('invalid_output');
        expect(error.message).toContain('non ha prodotto una classificazione valida');
      }
      expect(calls).toHaveLength(2);
    });

    it('wraps an HTTP error of the provider into LlmError provider', async () => {
      const apiError = new APICallError({
        message: 'Service Unavailable',
        url: 'https://example.test',
        requestBodyValues: {},
        statusCode: 503,
        isRetryable: false,
      });
      const { model } = createRecordedModel([apiError]);

      const error = await classifyRecipes(twoItems, { model }).then(
        () => null,
        (err: unknown) => err,
      );

      expect(isLlmError(error)).toBe(true);
      if (isLlmError(error)) {
        expect(error.code).toBe('provider');
        expect(error.message).toContain('503');
      }
    });

    it('rejects an empty batch and a batch above CLASSIFY_BATCH_SIZE with RangeError without invoking the model', async () => {
      const { model, calls } = createRecordedModel([]);
      const tooMany = Array.from({ length: CLASSIFY_BATCH_SIZE + 1 }, (_, i) => classifyItem(`r${i + 1}`));

      await expect(classifyRecipes([], { model })).rejects.toThrow(RangeError);
      await expect(classifyRecipes(tooMany, { model })).rejects.toThrow(RangeError);

      expect(calls).toHaveLength(0);
    });

    it('accepts a batch of exactly CLASSIFY_BATCH_SIZE recipes', async () => {
      const items = Array.from({ length: CLASSIFY_BATCH_SIZE }, (_, i) => classifyItem(`r${i + 1}`));
      const response = JSON.stringify({
        recipes: items.map((item) => ({ ref: item.ref, courses: ['secondo'], style_tags: [] })),
      });
      const { model, calls } = createRecordedModel([response]);

      const rows = await classifyRecipes(items, { model });

      expect(rows).toHaveLength(CLASSIFY_BATCH_SIZE);
      expect(calls).toHaveLength(1);
    });

    it('throws LlmError config when no model is injected and LLM_MODEL is missing', async () => {
      vi.stubEnv('LLM_MODEL', '');

      const error = await classifyRecipes([classifyItem('r1')]).then(
        () => null,
        (err: unknown) => err,
      );

      expect(isLlmError(error)).toBe(true);
      if (isLlmError(error)) {
        expect(error.code).toBe('config');
      }
    });
  });

  describe('convertDatasetRecipe', () => {
    const contorno: PackConvertItem = {
      title: 'Zucchine trifolate',
      group: 'contorni',
      servings: 4,
      ingredients: [
        { name: 'Zucchine', raw_qty: '3', reading: '3 senza unità' },
        { name: 'Sale', raw_qty: 'q.b.', reading: 'q.b.' },
      ],
      procedure: "Taglia le zucchine a rondelle. Falle saltare con l'olio.",
      known_names: ['zucchina'],
    };
    const convertedRecipe = {
      title: 'Zucchine trifolate',
      description: 'Zucchine saltate in padella, dorate e morbide.',
      meal_types: ['pranzo', 'cena'],
      courses: ['contorno'],
      tags: ['tradizionale'],
      diet_flags: [],
      appliances_required: ['fornelli'],
      servings_base: 4,
      prep_minutes: 20,
      kcal_est: 60,
      steps: ['  Taglia le zucchine a rondelle.  ', 'Falle saltare per cinque minuti.'],
      ingredients: [
        {
          canonical_name: 'Zucchina',
          display_name: 'zucchina',
          qty: 3,
          unit: 'pz',
          category: 'ortofrutta',
          note: null,
        },
        { canonical_name: 'sale', display_name: 'sale', qty: null, unit: 'qb', category: 'dispensa', note: null },
      ],
    };
    const validConversion = JSON.stringify(convertedRecipe);
    const invalidUnit = JSON.stringify({
      ...convertedRecipe,
      ingredients: [{ ...convertedRecipe.ingredients[0], unit: 'kg' }, convertedRecipe.ingredients[1]],
    });

    it('returns the converted recipe normalized, with one model call', async () => {
      const { model, calls } = createRecordedModel([validConversion]);

      const recipe = await convertDatasetRecipe(contorno, { model });

      expect(calls).toHaveLength(1);
      expect(recipe.title).toBe('Zucchine trifolate');
      expect(recipe.ingredients[0].canonical_name).toBe('zucchina');
      expect(recipe.steps).toEqual(['Taglia le zucchine a rondelle.', 'Falle saltare per cinque minuti.']);
    });

    it('sends the procedure of the original in the prompt', async () => {
      const { model, calls } = createRecordedModel([validConversion]);

      await convertDatasetRecipe(contorno, { model });

      const callJson = JSON.stringify(calls[0]);
      expect(callJson).toContain('Taglia le zucchine a rondelle. Falle saltare con l');
      expect(callJson).toContain('Gruppo: Contorni (in courses metti \\"contorno\\")');
    });

    it('repairs an invalid unit with a second call', async () => {
      const { model, calls } = createRecordedModel([invalidUnit, validConversion]);

      const recipe = await convertDatasetRecipe(contorno, { model });

      expect(calls).toHaveLength(2);
      expect(recipe.ingredients[0].canonical_name).toBe('zucchina');
      expect(JSON.stringify(calls[1])).toContain('ingredients.0.unit');
    });

    it('throws LlmError invalid_output after two invalid answers', async () => {
      const { model, calls } = createRecordedModel([invalidUnit, invalidUnit]);

      const error = await convertDatasetRecipe(contorno, { model }).then(
        () => null,
        (err: unknown) => err,
      );

      expect(isLlmError(error)).toBe(true);
      if (isLlmError(error)) {
        expect(error.code).toBe('invalid_output');
        expect(error.message).toContain('non ha prodotto una ricetta valida');
      }
      expect(calls).toHaveLength(2);
    });

    it('adds the feedback of the previous attempt to the prompt', async () => {
      const { model, calls } = createRecordedModel([validConversion]);

      await convertDatasetRecipe(contorno, {
        model,
        feedback: ['portata non adatta al gruppo Contorni: primo'],
      });

      expect(JSON.stringify(calls[0])).toContain('Il tentativo precedente è stato scartato');
    });

    it('rejects an invalid item with a ZodError without invoking the model', async () => {
      const { model, calls } = createRecordedModel([]);

      await expect(
        convertDatasetRecipe({ ...contorno, ingredients: [] }, { model }),
      ).rejects.toThrow();

      expect(calls).toHaveLength(0);
    });
  });

  describe('draftIngredientFacts', () => {
    const fact = (name: string) => ({
      name,
      category: 'dispensa',
      carne: false,
      pesce: false,
      latticini: false,
      uova: false,
      miele: false,
      glutine: false,
    });

    it('returns the rows the model gives, one per name', async () => {
      const response = JSON.stringify({
        ingredients: [
          { ...fact('Olio'), category: 'dispensa' },
          { ...fact('Pancetta'), category: 'macelleria', carne: true, glutine: false },
        ],
      });
      const { model, calls } = createRecordedModel([response]);

      const rows = await draftIngredientFacts(['Olio', 'Pancetta'], { model });

      expect(calls).toHaveLength(1);
      expect(rows).toEqual([
        { ...fact('Olio'), category: 'dispensa' },
        { ...fact('Pancetta'), category: 'macelleria', carne: true },
      ]);
    });

    it('sends the names in the prompt', async () => {
      const { model, calls } = createRecordedModel([JSON.stringify({ ingredients: [fact('Olio')] })]);

      await draftIngredientFacts(['Olio'], { model });

      const callJson = JSON.stringify(calls[0]);
      expect(callJson).toContain('Nel dubbio rispondi true');
      expect(callJson).toContain('Descrivi questi 1 ingredienti.');
    });

    it('rejects an empty list and a list above PACK_DRAFT_BATCH_SIZE with RangeError without invoking the model', async () => {
      const { model, calls } = createRecordedModel([]);
      const tooMany = Array.from({ length: PACK_DRAFT_BATCH_SIZE + 1 }, (_, i) => `Ingrediente ${i + 1}`);

      await expect(draftIngredientFacts([], { model })).rejects.toThrow(RangeError);
      await expect(draftIngredientFacts(tooMany, { model })).rejects.toThrow(RangeError);

      expect(calls).toHaveLength(0);
    });

    it('wraps an HTTP error of the provider into LlmError provider', async () => {
      const apiError = new APICallError({
        message: 'Service Unavailable',
        url: 'https://example.test',
        requestBodyValues: {},
        statusCode: 503,
        isRetryable: false,
      });
      const { model } = createRecordedModel([apiError]);

      const error = await draftIngredientFacts(['Olio'], { model }).then(
        () => null,
        (err: unknown) => err,
      );

      expect(isLlmError(error)).toBe(true);
      if (isLlmError(error)) {
        expect(error.code).toBe('provider');
      }
    });
  });
});
