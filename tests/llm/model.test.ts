// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { readLlmConfig, getModel, getLlmTimeoutMs } from '@/lib/llm/model';
import { isLlmError } from '@/lib/llm/errors';

describe('lib/llm/model', () => {
  describe('readLlmConfig', () => {
    it('defaults provider to google when LLM_PROVIDER is absent or empty', () => {
      const config = readLlmConfig({ LLM_MODEL: 'gemini-2.5-flash' });
      expect(config.provider).toBe('google');
      expect(config.model).toBe('gemini-2.5-flash');

      const configEmpty = readLlmConfig({ LLM_PROVIDER: '   ', LLM_MODEL: 'gemini-2.5-flash' });
      expect(configEmpty.provider).toBe('google');
    });

    it('throws LlmError config on unsupported provider', () => {
      expect(() =>
        readLlmConfig({ LLM_PROVIDER: 'azure', LLM_MODEL: 'gpt-4o' }),
      ).toThrowError();

      try {
        readLlmConfig({ LLM_PROVIDER: 'azure', LLM_MODEL: 'gpt-4o' });
      } catch (err) {
        expect(isLlmError(err)).toBe(true);
        if (isLlmError(err)) {
          expect(err.code).toBe('config');
          expect(err.message).toContain('azure');
        }
      }
    });

    it('throws LlmError config when LLM_MODEL is absent or empty', () => {
      try {
        readLlmConfig({ LLM_PROVIDER: 'google' });
        expect.unreachable('Should have thrown');
      } catch (err) {
        expect(isLlmError(err)).toBe(true);
        if (isLlmError(err)) {
          expect(err.code).toBe('config');
          expect(err.message).toContain('LLM_MODEL non impostato');
        }
      }

      try {
        readLlmConfig({ LLM_PROVIDER: 'google', LLM_MODEL: '   ' });
        expect.unreachable('Should have thrown');
      } catch (err) {
        expect(isLlmError(err)).toBe(true);
        if (isLlmError(err)) {
          expect(err.code).toBe('config');
        }
      }
    });
  });

  describe('getModel', () => {
    it('constructs google model when valid config and api key are provided', () => {
      const model = getModel({
        LLM_PROVIDER: 'google',
        LLM_MODEL: 'gemini-2.5-flash',
        GOOGLE_GENERATIVE_AI_API_KEY: 'test-google-key',
      }) as { modelId: string; provider: string };
      expect(model.modelId).toBe('gemini-2.5-flash');
      expect(model.provider).toContain('google');
    });

    it('throws LlmError config if GOOGLE_GENERATIVE_AI_API_KEY is missing for google', () => {
      try {
        getModel({
          LLM_PROVIDER: 'google',
          LLM_MODEL: 'gemini-2.5-flash',
        });
        expect.unreachable('Should have thrown');
      } catch (err) {
        expect(isLlmError(err)).toBe(true);
        if (isLlmError(err)) {
          expect(err.code).toBe('config');
          expect(err.message).toContain('GOOGLE_GENERATIVE_AI_API_KEY');
        }
      }
    });

    it('constructs openrouter model when valid config and api key are provided', () => {
      const model = getModel({
        LLM_PROVIDER: 'openrouter',
        LLM_MODEL: 'meta-llama/llama-3-70b-instruct',
        OPENROUTER_API_KEY: 'test-openrouter-key',
      }) as { modelId: string; provider: string };
      expect(model.modelId).toBe('meta-llama/llama-3-70b-instruct');
      expect(model.provider).toContain('openrouter');
    });

    it('throws LlmError config if OPENROUTER_API_KEY is missing for openrouter', () => {
      try {
        getModel({
          LLM_PROVIDER: 'openrouter',
          LLM_MODEL: 'meta-llama/llama-3-70b-instruct',
        });
        expect.unreachable('Should have thrown');
      } catch (err) {
        expect(isLlmError(err)).toBe(true);
        if (isLlmError(err)) {
          expect(err.code).toBe('config');
          expect(err.message).toContain('OPENROUTER_API_KEY');
        }
      }
    });

    it('constructs anthropic model when valid config and api key are provided', () => {
      const model = getModel({
        LLM_PROVIDER: 'anthropic',
        LLM_MODEL: 'claude-3-5-sonnet-20241022',
        ANTHROPIC_API_KEY: 'test-anthropic-key',
      }) as { modelId: string; provider: string };
      expect(model.modelId).toBe('claude-3-5-sonnet-20241022');
      expect(model.provider).toContain('anthropic');
    });

    it('throws LlmError config if ANTHROPIC_API_KEY is missing for anthropic', () => {
      try {
        getModel({
          LLM_PROVIDER: 'anthropic',
          LLM_MODEL: 'claude-3-5-sonnet-20241022',
        });
        expect.unreachable('Should have thrown');
      } catch (err) {
        expect(isLlmError(err)).toBe(true);
        if (isLlmError(err)) {
          expect(err.code).toBe('config');
          expect(err.message).toContain('ANTHROPIC_API_KEY');
        }
      }
    });

    it('constructs openai-compatible model when valid config and base url are provided', () => {
      const model = getModel({
        LLM_PROVIDER: 'openai-compatible',
        LLM_MODEL: 'llama3-local',
        LLM_BASE_URL: 'http://localhost:11434/v1',
        LLM_API_KEY: 'optional-key',
      }) as { modelId: string; provider: string };
      expect(model.modelId).toBe('llama3-local');
      expect(model.provider).toContain('openai-compatible');
    });

    it('throws LlmError config if LLM_BASE_URL is missing for openai-compatible', () => {
      try {
        getModel({
          LLM_PROVIDER: 'openai-compatible',
          LLM_MODEL: 'llama3-local',
        });
        expect.unreachable('Should have thrown');
      } catch (err) {
        expect(isLlmError(err)).toBe(true);
        if (isLlmError(err)) {
          expect(err.code).toBe('config');
          expect(err.message).toContain('LLM_BASE_URL');
        }
      }
    });
  });

  describe('getLlmTimeoutMs', () => {
    it('returns default 90000 when env variable is missing, non-numeric, or non-positive', () => {
      expect(getLlmTimeoutMs({})).toBe(90000);
      expect(getLlmTimeoutMs({ LLM_TIMEOUT_MS: 'abc' })).toBe(90000);
      expect(getLlmTimeoutMs({ LLM_TIMEOUT_MS: '-5' })).toBe(90000);
      expect(getLlmTimeoutMs({ LLM_TIMEOUT_MS: '0' })).toBe(90000);
      expect(getLlmTimeoutMs({ LLM_TIMEOUT_MS: '12.5' })).toBe(90000);
    });

    it('returns parsed integer timeout when valid', () => {
      expect(getLlmTimeoutMs({ LLM_TIMEOUT_MS: '1200' })).toBe(1200);
      expect(getLlmTimeoutMs({ LLM_TIMEOUT_MS: '60000' })).toBe(60000);
    });
  });
});
