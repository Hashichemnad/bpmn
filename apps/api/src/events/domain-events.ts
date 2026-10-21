import { Global, Injectable, Logger, Module } from '@nestjs/common';

/** Events other modules (e.g. the Git integration) react to. Payloads carry ids only. */
export type DomainEvent =
  | { type: 'process.versioned'; processId: string; versionNumber: number; actorId: string }
  | { type: 'process.removed'; processId: string; actorId: string }
  | { type: 'page.versioned'; pageId: string; versionNumber: number; actorId: string }
  | { type: 'page.removed'; pageIds: string[]; actorId: string }
  | { type: 'page.restored'; pageIds: string[]; actorId: string };

type Listener = (event: DomainEvent) => void | Promise<void>;

/**
 * Minimal in-process event bus. Listeners run after the emitting request's transaction
 * and never fail it: errors are logged.
 */
@Injectable()
export class DomainEvents {
  private readonly logger = new Logger(DomainEvents.name);
  private readonly listeners = new Set<Listener>();

  on(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  emit(event: DomainEvent): void {
    for (const listener of this.listeners) {
      Promise.resolve()
        .then(() => listener(event))
        .catch((err: Error) =>
          this.logger.error(`Listener failed for ${event.type}: ${err.message}`),
        );
    }
  }
}

@Global()
@Module({ providers: [DomainEvents], exports: [DomainEvents] })
export class EventsModule {}
