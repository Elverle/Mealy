export const LLM_ERROR_CODES = ['config', 'provider', 'timeout', 'invalid_output'] as const;
export type LlmErrorCode = (typeof LLM_ERROR_CODES)[number];

export class LlmError extends Error {
  readonly code: LlmErrorCode;

  constructor(code: LlmErrorCode, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'LlmError';
    this.code = code;
  }
}

export function isLlmError(error: unknown): error is LlmError {
  return error instanceof LlmError;
}
