import {
  generateText,
  Output,
  NoObjectGeneratedError,
  APICallError,
  RetryError,
  type LanguageModel,
} from 'ai';
import {
  GenerateRecipesOutputSchema,
  RecipeConstraintsSchema,
  type RecipeConstraints,
  type GeneratedRecipe,
  GENERATE_COUNT_MIN,
  GENERATE_COUNT_MAX,
} from '@/lib/domain/types';
import { normalizeGeneratedRecipe } from '@/lib/domain/recipe-text';
import { getModel, getLlmTimeoutMs } from './model';
import {
  buildRecipeInstructions,
  buildRecipePrompt,
  buildRecipeRequestPrompt,
  buildRepairPrompt,
  MAX_EXCLUDED_TITLES,
} from './prompts';
import { LlmError, isLlmError } from './errors';

export interface GenerateRecipesOptions {
  model?: LanguageModel;
  timeoutMs?: number;
  abortSignal?: AbortSignal;
}

/**
 * Traverses .cause chain looking for schema validation issues and formats them into a human-readable string.
 */
export function describeValidationError(cause: unknown): string {
  let curr: unknown = cause;
  let issues: unknown[] | undefined;

  for (let i = 0; i < 4 && curr != null; i++) {
    if (
      typeof curr === 'object' &&
      curr !== null &&
      'issues' in curr &&
      Array.isArray((curr as { issues: unknown }).issues)
    ) {
      issues = (curr as { issues: unknown[] }).issues;
      break;
    }
    if (typeof curr === 'object' && curr !== null && 'cause' in curr) {
      curr = (curr as { cause: unknown }).cause;
    } else {
      break;
    }
  }

  if (issues && issues.length > 0) {
    const lines = issues.slice(0, 15).map((issue) => {
      if (typeof issue === 'object' && issue !== null) {
        const issueObj = issue as { path?: unknown[]; message?: unknown };
        let pathStr = '';
        if (Array.isArray(issueObj.path) && issueObj.path.length > 0) {
          pathStr = issueObj.path
            .map((elem) => {
              if (typeof elem === 'object' && elem !== null && 'key' in elem) {
                return String((elem as { key: unknown }).key);
              }
              return String(elem);
            })
            .join('.');
        } else {
          pathStr = '(radice)';
        }
        const msg = typeof issueObj.message === 'string' ? issueObj.message : 'valore non valido';
        return `${pathStr}: ${msg}`;
      }
      return String(issue);
    });
    const result = lines.join('\n');
    return result.length > 1500 ? result.slice(0, 1500) : result;
  }

  const fallback = cause instanceof Error ? cause.message : 'JSON non valido o incompleto.';
  return fallback.length > 1500 ? fallback.slice(0, 1500) : fallback;
}

/**
 * Maps arbitrary underlying errors into typed LlmError instances.
 */
function toLlmError(err: unknown): LlmError {
  if (isLlmError(err)) {
    return err;
  }
  if (err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError')) {
    return new LlmError('timeout', 'La chiamata al modello ha superato il tempo massimo.', { cause: err });
  }
  if (RetryError.isInstance(err)) {
    return toLlmError(err.lastError);
  }
  if (APICallError.isInstance(err)) {
    const status = err.statusCode != null ? err.statusCode : 'n/d';
    return new LlmError('provider', `Errore del provider LLM (HTTP ${status}).`, { cause: err });
  }
  return new LlmError('provider', 'Errore del provider LLM.', { cause: err });
}

/**
 * Titoli senza spazi ai bordi, non vuoti, senza doppioni (vince la prima occorrenza), al più MAX_EXCLUDED_TITLES.
 */
function cleanExcludedTitles(excludeTitles: readonly string[]): string[] {
  const cleanedTitles: string[] = [];
  const seen = new Set<string>();
  for (const raw of excludeTitles) {
    const t = raw.trim();
    if (t.length > 0 && !seen.has(t)) {
      seen.add(t);
      cleanedTitles.push(t);
    }
  }
  return cleanedTitles.slice(0, MAX_EXCLUDED_TITLES);
}

interface RecipeCall {
  model: LanguageModel;
  prompt: string;
  timeoutMs: number;
  abortSignal?: AbortSignal;
}

/**
 * Chiamata al modello più un tentativo di riparazione; restituisce le ricette normalizzate.
 */
async function runRecipeGeneration(call: RecipeCall): Promise<GeneratedRecipe[]> {
  const instructions = buildRecipeInstructions();

  let result;
  try {
    result = await generateText({
      model: call.model,
      instructions,
      prompt: call.prompt,
      output: Output.object({ schema: GenerateRecipesOutputSchema }),
      temperature: 0.8,
      maxRetries: 1,
      timeout: call.timeoutMs,
      abortSignal: call.abortSignal,
    });
  } catch (err) {
    if (NoObjectGeneratedError.isInstance(err)) {
      // Attempt 2 (repair)
      const validationErrors = describeValidationError(err.cause);
      const repairPrompt = buildRepairPrompt(validationErrors);
      const messages = [
        { role: 'user' as const, content: call.prompt },
        ...(err.text && err.text.length > 0 ? [{ role: 'assistant' as const, content: err.text }] : []),
        { role: 'user' as const, content: repairPrompt },
      ];

      try {
        result = await generateText({
          model: call.model,
          instructions,
          messages,
          output: Output.object({ schema: GenerateRecipesOutputSchema }),
          temperature: 0.2,
          maxRetries: 1,
          timeout: call.timeoutMs,
          abortSignal: call.abortSignal,
        });
      } catch (err2) {
        if (NoObjectGeneratedError.isInstance(err2)) {
          throw new LlmError(
            'invalid_output',
            'Il modello non ha prodotto ricette valide dopo il tentativo di correzione.',
            { cause: err2 },
          );
        }
        throw toLlmError(err2);
      }
    } else {
      throw toLlmError(err);
    }
  }

  return result.output.recipes.map(normalizeGeneratedRecipe);
}

/**
 * Generates recipe candidates from the configured or injected LLM provider,
 * applying validation, automatic 1-step repair if needed, and normalization.
 */
export async function generateRecipes(
  constraints: RecipeConstraints,
  n: number,
  excludeTitles: readonly string[],
  options?: GenerateRecipesOptions,
): Promise<GeneratedRecipe[]> {
  if (!Number.isInteger(n) || n < GENERATE_COUNT_MIN || n > GENERATE_COUNT_MAX) {
    throw new RangeError('n must be an integer between 1 and 10');
  }

  const parsed = RecipeConstraintsSchema.parse(constraints);
  const model = options?.model ?? getModel();
  const titles = cleanExcludedTitles(excludeTitles);

  const recipes = await runRecipeGeneration({
    model,
    prompt: buildRecipePrompt(parsed, n, titles),
    timeoutMs: options?.timeoutMs ?? getLlmTimeoutMs(),
    abortSignal: options?.abortSignal,
  });

  return recipes.slice(0, n);
}

/**
 * Genera una sola ricetta a partire da una richiesta in testo libero. Stesso percorso di
 * `generateRecipes` (schema di output, riparazione, timeout, errori `LlmError`).
 * Dei vincoli usa persone, tipo di pasto, diete ed elettrodomestici.
 */
export async function generateRecipeFromRequest(
  constraints: RecipeConstraints,
  request: string,
  excludeTitles: readonly string[],
  options?: GenerateRecipesOptions,
): Promise<GeneratedRecipe> {
  if (request.trim().length === 0) {
    throw new RangeError('request must not be empty');
  }

  const parsed = RecipeConstraintsSchema.parse(constraints);
  const model = options?.model ?? getModel();
  const prompt = buildRecipeRequestPrompt(parsed, request, cleanExcludedTitles(excludeTitles));

  const [recipe] = await runRecipeGeneration({
    model,
    prompt,
    timeoutMs: options?.timeoutMs ?? getLlmTimeoutMs(),
    abortSignal: options?.abortSignal,
  });

  return recipe;
}
