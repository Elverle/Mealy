import fs from 'node:fs';
import path from 'node:path';
import { MockLanguageModelV4 } from 'ai/test';

/**
 * Loads a recording fixture file from tests/fixtures/llm/{name}.txt.
 */
export function loadLlmRecording(name: string): string {
  const filePath = path.resolve(__dirname, '../fixtures/llm', `${name}.txt`);
  return fs.readFileSync(filePath, 'utf-8');
}

/**
 * Creates a MockLanguageModelV4 that yields recorded responses or throws recorded errors in sequence.
 */
export function createRecordedModel(
  responses: Array<string | Error>,
): { model: MockLanguageModelV4; calls: unknown[] } {
  const calls: unknown[] = [];
  let idx = 0;
  const model = new MockLanguageModelV4({
    doGenerate: async (options) => {
      calls.push(options);
      if (idx >= responses.length) {
        throw new Error('No more recorded LLM responses');
      }
      const resp = responses[idx++];
      if (resp instanceof Error) {
        throw resp;
      }
      return {
        content: [{ type: 'text', text: resp }],
        finishReason: { unified: 'stop', raw: undefined },
        usage: {
          inputTokens: { total: 10, noCache: 10, cacheRead: undefined, cacheWrite: undefined },
          outputTokens: { total: 20, text: 20, reasoning: undefined },
        },
        warnings: [],
      };
    },
  });
  return { model, calls };
}
