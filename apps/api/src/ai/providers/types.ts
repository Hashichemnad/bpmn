import type { AiErrorCode, AiProvider } from '@processhub/shared';

/** Connection details for one call (the API key is decrypted just before the call). */
export interface AiConnection {
  provider: AiProvider;
  apiKey: string;
  timeoutMs: number;
}

export interface AiMessage {
  role: 'user' | 'assistant';
  text: string;
}

export interface AiCompletionRequest {
  model: string;
  system: string;
  messages: AiMessage[];
  maxTokens: number;
  /** How much effort the model puts in (ignored by models that do not support it). */
  effort?: 'low' | 'medium' | 'high';
  /**
   * JSON schema the answer must follow (structured output). The text of the result is then
   * a JSON document; it is still validated by the caller.
   */
  jsonSchema?: Record<string, unknown>;
  /** Cancels the call when the browser disconnects. */
  signal?: AbortSignal;
}

export interface AiCompletion {
  text: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  /** True when the answer was cut off at maxTokens. */
  truncated: boolean;
}

/**
 * One AI vendor. Implementations translate their SDK's errors into AiError codes and never
 * log or echo the API key.
 */
export interface AiProviderClient {
  complete(
    conn: AiConnection,
    req: AiCompletionRequest,
    onText?: (delta: string) => void,
  ): Promise<AiCompletion>;
}

export class AiError extends Error {
  constructor(
    public readonly code: AiErrorCode,
    message: string,
    /** Usage of a call that reached the provider but whose result could not be used. */
    public readonly usage?: { inputTokens: number; outputTokens: number; model: string },
  ) {
    super(message);
  }
}
