import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import {
  type AiFeature,
  type AiStatusDto,
  type AiUsageStatus,
  type ContentType,
  type SystemRoleKey,
} from '@processhub/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AppException } from '../common/app-exception';
import type { AuthUser, RequestMeta } from '../common/auth-user';
import { AiProviders } from './ai-providers';
import { AiSettingsService, type StoredAiSettings } from './ai-settings.service';
import { AiError, type AiCompletion, type AiMessage } from './providers/types';

/** Thrown by a feature's output parser: the issues are sent back to the model once to fix. */
export class AiOutputInvalid extends Error {
  constructor(public readonly issues: string[]) {
    super(`Invalid AI output: ${issues.slice(0, 5).join('; ')}`);
  }
}

export interface AiCallOptions<T> {
  feature: AiFeature;
  /** Use the faster, cheaper model (translation, short summaries). */
  fast?: boolean;
  system: string;
  messages: AiMessage[];
  maxTokens: number;
  effort?: 'low' | 'medium' | 'high';
  /** Structured output: JSON schema for the provider and a validating parser. */
  output?: { schema: Record<string, unknown>; parse: (value: unknown) => T };
  /** The process or page the request is about (usage log and audit). */
  entity?: { type: ContentType; id: string };
  onText?: (delta: string) => void;
  onProgress?: (chars: number) => void;
  signal?: AbortSignal;
}

/** An authorised request: settings snapshot and the user, checked before anything is streamed. */
export interface AiSession {
  user: AuthUser;
  settings: StoredAiSettings;
  meta: RequestMeta;
}

/** Parallel AI calls per user (SEC-21). */
export const AI_MAX_IN_FLIGHT_PER_USER = 2;

const startOfUtcDay = (d = new Date()) =>
  new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
const startOfUtcMonth = (d = new Date()) =>
  new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));

const deny = (status: HttpStatus, code: string, message: string) =>
  new AppException(status, code, message);

/**
 * The only way features reach an AI provider. Checks that the assistant is enabled and the user's
 * role may use it, enforces the per-user daily and organisation monthly limits, calls the
 * provider (the API key never leaves the server), validates structured output (one repair
 * attempt) and writes every request to the usage table and the audit log.
 */
@Injectable()
export class AiGatewayService {
  private readonly logger = new Logger(AiGatewayService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly settings: AiSettingsService,
    private readonly providers: AiProviders,
  ) {}

  /** Whether the role set may use the assistant at all (settings only, no limits). */
  static allowed(s: StoredAiSettings, roles: readonly SystemRoleKey[]): boolean {
    return s.enabled && roles.some((r) => s.allowedRoles.includes(r));
  }

  async status(user: AuthUser): Promise<AiStatusDto> {
    const s = await this.settings.get();
    const reason = !s.enabled
      ? 'DISABLED'
      : !AiGatewayService.allowed(s, user.roles)
        ? 'NOT_ALLOWED'
        : !s.apiKeySealed
          ? 'NOT_CONFIGURED'
          : null;
    // Nothing about the assistant is revealed to users who cannot use it.
    if (reason) {
      return {
        available: false,
        reason,
        noticeEn: '',
        noticeAr: '',
        usedToday: 0,
        dailyLimit: 0,
        suggestions: {},
      };
    }
    return {
      available: true,
      reason: null,
      noticeEn: s.noticeEn,
      noticeAr: s.noticeAr,
      usedToday: await this.usedToday(user.id),
      dailyLimit: s.userDailyLimit,
      suggestions: s.suggestions,
    };
  }

  private usedToday(userId: string) {
    return this.prisma.aiUsage.count({
      where: { userId, createdAt: { gte: startOfUtcDay() }, feature: { not: 'TEST_CONNECTION' } },
    });
  }

  /** Authorises a request (403 / 429 / 503 as JSON, before any streaming starts). */
  async begin(user: AuthUser, meta: RequestMeta): Promise<AiSession> {
    const s = await this.settings.get();
    if (!s.enabled) throw deny(HttpStatus.FORBIDDEN, 'AI_DISABLED', 'The AI assistant is disabled');
    if (!AiGatewayService.allowed(s, user.roles))
      throw deny(HttpStatus.FORBIDDEN, 'AI_NOT_ALLOWED', 'Your role may not use the AI assistant');
    if (!s.apiKeySealed)
      throw deny(HttpStatus.SERVICE_UNAVAILABLE, 'AI_NOT_CONFIGURED', 'No API key is configured');
    if (s.userDailyLimit > 0 && (await this.usedToday(user.id)) >= s.userDailyLimit)
      throw deny(HttpStatus.TOO_MANY_REQUESTS, 'AI_USER_LIMIT', 'Daily AI request limit reached');
    if (s.orgMonthlyLimit > 0) {
      const month = await this.prisma.aiUsage.count({
        where: { createdAt: { gte: startOfUtcMonth() }, feature: { not: 'TEST_CONNECTION' } },
      });
      if (month >= s.orgMonthlyLimit)
        throw deny(
          HttpStatus.TOO_MANY_REQUESTS,
          'AI_ORG_LIMIT',
          'The organisation’s monthly AI limit is reached',
        );
    }
    return { user, settings: s, meta };
  }

  /**
   * Runs one request. Structured output is parsed and validated; when invalid, the model gets
   * one chance to correct it. Usage of all attempts is logged as one request.
   */
  async call<T = string>(session: AiSession, opts: AiCallOptions<T>): Promise<T> {
    await this.reserveCall(session, opts.feature === 'TEST_CONNECTION');
    try {
      return await this.callReserved(session, opts);
    } finally {
      this.endCall(session.user.id);
    }
  }

  private readonly inFlight = new Map<string, number>();

  /**
   * Counts the call as running BEFORE checking the limits again (SEC-21): usage rows are written
   * when a call ends, so without this a burst of parallel requests would all pass begin()'s check
   * and overshoot the daily / monthly limits. At most AI_MAX_IN_FLIGHT_PER_USER calls per user run
   * at the same time.
   */
  private async reserveCall(session: AiSession, connectionTest = false) {
    const userId = session.user.id;
    const running = (this.inFlight.get(userId) ?? 0) + 1;
    this.inFlight.set(userId, running);
    try {
      if (running > AI_MAX_IN_FLIGHT_PER_USER)
        throw deny(
          HttpStatus.TOO_MANY_REQUESTS,
          'TOO_MANY_REQUESTS',
          'Wait until your other AI requests have finished',
        );
      const s = session.settings;
      if (connectionTest) return;
      if (s.userDailyLimit > 0 && (await this.usedToday(userId)) + running > s.userDailyLimit)
        throw deny(HttpStatus.TOO_MANY_REQUESTS, 'AI_USER_LIMIT', 'Daily AI request limit reached');
      if (s.orgMonthlyLimit > 0) {
        let all = 0;
        for (const v of this.inFlight.values()) all += v;
        const month = await this.prisma.aiUsage.count({
          where: { createdAt: { gte: startOfUtcMonth() }, feature: { not: 'TEST_CONNECTION' } },
        });
        if (month + all > s.orgMonthlyLimit)
          throw deny(
            HttpStatus.TOO_MANY_REQUESTS,
            'AI_ORG_LIMIT',
            'The organisation’s monthly AI limit is reached',
          );
      }
    } catch (e) {
      this.endCall(userId);
      throw e;
    }
  }

  private endCall(userId: string) {
    const left = (this.inFlight.get(userId) ?? 1) - 1;
    if (left > 0) this.inFlight.set(userId, left);
    else this.inFlight.delete(userId);
  }

  private async callReserved<T>(session: AiSession, opts: AiCallOptions<T>): Promise<T> {
    const started = Date.now();
    const model = opts.fast ? session.settings.fastModel : session.settings.model;
    const used = { inputTokens: 0, outputTokens: 0, model };
    let status: AiUsageStatus = 'SUCCESS';
    let errorCode: string | null = null;
    try {
      const conn = this.settings.connection(session.settings);
      const client = this.providers.client(conn.provider);
      const messages = [...opts.messages];
      for (let attempt = 0; ; attempt++) {
        let chars = 0;
        let completion: AiCompletion;
        try {
          completion = await client.complete(
            conn,
            {
              model,
              system: opts.system,
              messages,
              maxTokens: opts.maxTokens,
              effort: opts.effort,
              jsonSchema: opts.output?.schema,
              signal: opts.signal,
            },
            (delta) => {
              if (!opts.output) opts.onText?.(delta);
              else {
                chars += delta.length;
                opts.onProgress?.(chars);
              }
            },
          );
        } catch (err) {
          if (err instanceof AiError && err.usage) {
            used.inputTokens += err.usage.inputTokens;
            used.outputTokens += err.usage.outputTokens;
          }
          throw err;
        }
        used.inputTokens += completion.inputTokens;
        used.outputTokens += completion.outputTokens;
        used.model = completion.model || model;
        if (!opts.output) {
          if (!completion.text) throw new AiError('AI_INVALID_OUTPUT', 'Empty answer');
          return completion.text as T;
        }
        try {
          if (completion.truncated)
            throw new AiOutputInvalid(['The answer was cut off (too long)']);
          let json: unknown;
          try {
            json = JSON.parse(completion.text);
          } catch {
            throw new AiOutputInvalid(['The answer is not valid JSON']);
          }
          return opts.output.parse(json);
        } catch (err) {
          if (!(err instanceof AiOutputInvalid)) throw err;
          this.logger.warn(`${opts.feature}: ${err.message} (attempt ${attempt + 1})`);
          if (attempt >= 1 || completion.truncated) {
            throw new AiError('AI_INVALID_OUTPUT', err.message);
          }
          messages.push(
            { role: 'assistant', text: completion.text },
            {
              role: 'user',
              text:
                'Your answer could not be used because of these problems:\n- ' +
                err.issues.slice(0, 20).join('\n- ') +
                '\nReturn the complete corrected JSON document.',
            },
          );
        }
      }
    } catch (err) {
      const aiErr =
        err instanceof AiError
          ? err
          : new AiError('AI_PROVIDER_ERROR', err instanceof Error ? err.message : String(err));
      status = aiErr.code === 'AI_INVALID_OUTPUT' ? 'INVALID_OUTPUT' : 'ERROR';
      errorCode = aiErr.code;
      throw aiErr;
    } finally {
      await this.record(session, opts, used, status, errorCode, Date.now() - started);
    }
  }

  private async record(
    session: AiSession,
    opts: Pick<AiCallOptions<unknown>, 'feature' | 'entity' | 'messages'>,
    used: { inputTokens: number; outputTokens: number; model: string },
    status: AiUsageStatus,
    errorCode: string | null,
    durationMs: number,
  ) {
    try {
      const row = await this.prisma.aiUsage.create({
        data: {
          userId: session.user.id,
          feature: opts.feature,
          provider: session.settings.provider,
          model: used.model,
          inputTokens: used.inputTokens,
          outputTokens: used.outputTokens,
          status,
          errorCode,
          durationMs,
          entityType: opts.entity?.type ?? null,
          entityId: opts.entity?.id ?? null,
        },
      });
      // Never the prompt itself: only its size (it may contain confidential content).
      await this.audit.log({
        action: 'AI_REQUEST',
        entityType: 'AI',
        entityId: row.id,
        userId: session.user.id,
        summary: {
          feature: opts.feature,
          provider: session.settings.provider,
          model: used.model,
          status,
          errorCode,
          usage: { input: used.inputTokens, output: used.outputTokens },
          promptChars: opts.messages.reduce((n, m) => n + m.text.length, 0),
          durationMs,
          item: opts.entity ?? null,
        },
        meta: session.meta,
      });
    } catch (err) {
      this.logger.error(`Failed to record AI usage: ${(err as Error).message}`);
    }
  }
}
