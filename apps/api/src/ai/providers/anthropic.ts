import Anthropic from '@anthropic-ai/sdk';
import {
  AiError,
  type AiCompletion,
  type AiCompletionRequest,
  type AiConnection,
  type AiProviderClient,
} from './types';

/** Models that accept `output_config.effort` (Claude 4.5 Opus and later generations). */
export function supportsEffort(model: string): boolean {
  return /^claude-(opus|sonnet|haiku|fable|mythos)-(5|4-[5-9])/.test(model);
}

/**
 * Anthropic Claude through the official SDK. Streams the answer, asks for structured output
 * (JSON schema) when the caller needs data, and opts into the server-side refusal fallback
 * ("default" — a no-op on models without one).
 */
export class AnthropicProvider implements AiProviderClient {
  async complete(
    conn: AiConnection,
    req: AiCompletionRequest,
    onText?: (delta: string) => void,
  ): Promise<AiCompletion> {
    const client = new Anthropic({
      apiKey: conn.apiKey,
      timeout: conn.timeoutMs,
      maxRetries: 2,
    });
    try {
      const stream = client.beta.messages.stream(
        {
          model: req.model,
          max_tokens: req.maxTokens,
          betas: ['server-side-fallback-2026-07-01'],
          fallbacks: 'default',
          // The system prompt of a feature never changes between requests: cache it.
          system: [{ type: 'text', text: req.system, cache_control: { type: 'ephemeral' } }],
          messages: req.messages.map((m) => ({ role: m.role, content: m.text })),
          output_config: {
            ...(req.effort && supportsEffort(req.model) ? { effort: req.effort } : {}),
            ...(req.jsonSchema ? { format: { type: 'json_schema', schema: req.jsonSchema } } : {}),
          },
        },
        { signal: req.signal },
      );
      if (onText) stream.on('text', (delta) => onText(delta));
      const message = await stream.finalMessage();
      const usage = {
        inputTokens:
          (message.usage.input_tokens ?? 0) +
          (message.usage.cache_read_input_tokens ?? 0) +
          (message.usage.cache_creation_input_tokens ?? 0),
        outputTokens: message.usage.output_tokens ?? 0,
        model: message.model,
      };
      if (message.stop_reason === 'refusal') {
        throw new AiError('AI_REFUSED', 'The model declined this request', usage);
      }
      const text = message.content
        .map((b) => (b.type === 'text' ? b.text : ''))
        .join('')
        .trim();
      return { text, ...usage, truncated: message.stop_reason === 'max_tokens' };
    } catch (err) {
      throw toAiError(err);
    }
  }
}

/** Maps SDK errors (most specific first) to AiError codes; messages never contain the key. */
export function toAiError(err: unknown): AiError {
  if (err instanceof AiError) return err;
  if (
    err instanceof Anthropic.AuthenticationError ||
    err instanceof Anthropic.PermissionDeniedError
  )
    return new AiError('AI_AUTH_FAILED', `HTTP ${err.status}: the API key was rejected`);
  if (err instanceof Anthropic.RateLimitError)
    return new AiError('AI_RATE_LIMITED', 'The AI provider is rate limiting requests');
  if (err instanceof Anthropic.APIConnectionTimeoutError)
    return new AiError('AI_TIMEOUT', 'The AI provider did not answer in time');
  if (err instanceof Anthropic.APIUserAbortError)
    return new AiError('AI_TIMEOUT', 'The request was cancelled');
  if (err instanceof Anthropic.BadRequestError || err instanceof Anthropic.NotFoundError)
    return new AiError('AI_PROVIDER_ERROR', `HTTP ${err.status}: ${err.message}`.slice(0, 500));
  if (err instanceof Anthropic.APIError)
    return new AiError(
      'AI_PROVIDER_ERROR',
      `HTTP ${err.status ?? '-'}: ${err.message}`.slice(0, 500),
    );
  return new AiError(
    'AI_PROVIDER_ERROR',
    err instanceof Error ? err.message.slice(0, 500) : 'Unknown error',
  );
}
