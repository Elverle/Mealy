import type { LanguageModel } from 'ai';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import { createAnthropic } from '@ai-sdk/anthropic';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { LlmError } from './errors';

export const LLM_PROVIDER_VALUES = ['google', 'openrouter', 'anthropic', 'openai-compatible'] as const;
export type LlmProvider = (typeof LLM_PROVIDER_VALUES)[number];

export interface LlmConfig {
  provider: LlmProvider;
  model: string;
}

type Env = Record<string, string | undefined>;

/**
 * Reads and validates the LLM configuration from the environment.
 */
export function readLlmConfig(env: Env = process.env): LlmConfig {
  const rawProvider = env.LLM_PROVIDER?.trim();
  const provider = rawProvider && rawProvider.length > 0 ? rawProvider : 'google';

  if (!LLM_PROVIDER_VALUES.includes(provider as LlmProvider)) {
    throw new LlmError(
      'config',
      `LLM_PROVIDER non valido: "${provider}". Valori ammessi: google, openrouter, anthropic, openai-compatible.`,
    );
  }

  const model = env.LLM_MODEL?.trim();
  if (!model) {
    throw new LlmError('config', 'LLM_MODEL non impostato.');
  }

  return {
    provider: provider as LlmProvider,
    model,
  };
}

/**
 * Instantiates the LanguageModel according to environment configuration.
 */
export function getModel(env: Env = process.env): LanguageModel {
  const { provider, model } = readLlmConfig(env);

  switch (provider) {
    case 'google': {
      const apiKey = env.GOOGLE_GENERATIVE_AI_API_KEY?.trim();
      if (!apiKey) {
        throw new LlmError('config', `GOOGLE_GENERATIVE_AI_API_KEY non impostata per LLM_PROVIDER=${provider}.`);
      }
      return createGoogleGenerativeAI({ apiKey })(model);
    }
    case 'openrouter': {
      const apiKey = env.OPENROUTER_API_KEY?.trim();
      if (!apiKey) {
        throw new LlmError('config', `OPENROUTER_API_KEY non impostata per LLM_PROVIDER=${provider}.`);
      }
      return createOpenRouter({ apiKey })(model);
    }
    case 'anthropic': {
      const apiKey = env.ANTHROPIC_API_KEY?.trim();
      if (!apiKey) {
        throw new LlmError('config', `ANTHROPIC_API_KEY non impostata per LLM_PROVIDER=${provider}.`);
      }
      return createAnthropic({ apiKey })(model);
    }
    case 'openai-compatible': {
      const baseURL = env.LLM_BASE_URL?.trim();
      if (!baseURL) {
        throw new LlmError('config', `LLM_BASE_URL non impostata per LLM_PROVIDER=${provider}.`);
      }
      const apiKey = env.LLM_API_KEY?.trim();
      return createOpenAICompatible({
        name: 'openai-compatible',
        baseURL,
        apiKey: apiKey || undefined,
        supportsStructuredOutputs: true,
      })(model);
    }
  }
}

/**
 * Returns the configured LLM timeout in milliseconds, falling back to 90000 (per one batch of 3 recipes;
 * with the repair call a generation can last up to twice this value).
 */
export function getLlmTimeoutMs(env: Env = process.env): number {
  const val = Number(env.LLM_TIMEOUT_MS);
  if (!Number.isInteger(val) || val <= 0) {
    return 90000;
  }
  return val;
}
