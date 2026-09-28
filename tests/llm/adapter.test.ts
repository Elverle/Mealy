// @vitest-environment node
import { describe, it, expect, vi, afterEach } from 'vitest';
import { APICallError } from 'ai';
import { generateRecipes } from '@/lib/llm/adapter';
import { isLlmError } from '@/lib/llm/errors';
import type { RecipeConstraints } from '@/lib/domain/types';
import { createRecordedModel, loadLlmRecording } from '@/tests/helpers/mock-llm';

describe('lib/llm/adapter', () => {
  const baseConstraints: RecipeConstraints = {
    persons: 2,
    meal_type: 'cena',
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
});
