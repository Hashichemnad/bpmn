import { Injectable } from '@nestjs/common';
import type { AiProvider } from '@processhub/shared';
import { AnthropicProvider } from './providers/anthropic';
import type { AiProviderClient } from './providers/types';

/** Registry of AI vendors (tests replace it with a fake: the suite never calls a real AI). */
@Injectable()
export class AiProviders {
  private readonly clients: Record<AiProvider, AiProviderClient> = {
    anthropic: new AnthropicProvider(),
  };

  client(provider: AiProvider): AiProviderClient {
    return this.clients[provider];
  }
}
