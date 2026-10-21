import { Inject, Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import {
  SETTING_KEYS,
  type GitProvider,
  type GitSettingsDto,
  type GitSettingsInput,
  type GitSyncTrigger,
  type GitTestResultDto,
} from '@processhub/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { APP_CONFIG, type AppConfig } from '../config/config';
import { badRequest } from '../common/app-exception';
import type { AuthUser, RequestMeta } from '../common/auth-user';
import { SecretBox } from './secret-box';
import { GitProviders } from './git-providers';
import { GitError, type GitConnection } from './providers/types';

/** Stored in Setting `integrations.git`; the token only ever as AES-256-GCM ciphertext. */
export interface StoredGitSettings {
  enabled: boolean;
  provider: GitProvider;
  baseUrl: string;
  repository: string;
  branch: string;
  folder: string;
  tokenSealed: string | null;
  syncProcesses: boolean;
  syncPages: boolean;
  trigger: GitSyncTrigger;
  /** Export only published versions (governance). */
  publishedOnly: boolean;
}

const DEFAULTS: StoredGitSettings = {
  enabled: false,
  provider: 'github',
  baseUrl: '',
  repository: '',
  branch: 'main',
  folder: '',
  tokenSealed: null,
  syncProcesses: true,
  syncPages: true,
  trigger: 'ON_VERSION',
  publishedOnly: false,
};

/** Removes the token itself from error messages, whatever the provider echoed back. */
export function scrubToken(message: string, token: string | null | undefined): string {
  return token ? message.split(token).join('***') : message;
}

@Injectable()
export class GitSettingsService {
  private readonly box: SecretBox | null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly providers: GitProviders,
    @Inject(APP_CONFIG) config: AppConfig,
  ) {
    this.box = config.INTEGRATIONS_ENCRYPTION_KEY
      ? new SecretBox(config.INTEGRATIONS_ENCRYPTION_KEY)
      : null;
  }

  async get(): Promise<StoredGitSettings> {
    const row = await this.prisma.setting.findUnique({
      where: { key: SETTING_KEYS.GIT_INTEGRATION },
    });
    return { ...DEFAULTS, ...((row?.value as Partial<StoredGitSettings> | undefined) ?? {}) };
  }

  toDto(s: StoredGitSettings): GitSettingsDto {
    return {
      enabled: s.enabled,
      provider: s.provider,
      baseUrl: s.baseUrl,
      repository: s.repository,
      branch: s.branch,
      folder: s.folder,
      hasToken: !!s.tokenSealed,
      syncProcesses: s.syncProcesses,
      syncPages: s.syncPages,
      trigger: s.trigger,
      publishedOnly: s.publishedOnly,
      encryptionAvailable: !!this.box,
    };
  }

  async getDto() {
    return this.toDto(await this.get());
  }

  private seal(token: string): string {
    if (!this.box) throw badRequest('ENCRYPTION_KEY_MISSING');
    return this.box.encrypt(token);
  }

  /** Applies the form to the stored settings; returns the merged result without saving. */
  private merge(before: StoredGitSettings, input: GitSettingsInput): StoredGitSettings {
    let tokenSealed = before.tokenSealed;
    if (input.clearToken) tokenSealed = null;
    else if (input.token?.trim()) tokenSealed = this.seal(input.token.trim());
    return {
      enabled: input.enabled,
      provider: input.provider,
      baseUrl: input.baseUrl,
      repository: input.repository,
      branch: input.branch,
      folder: input.folder,
      tokenSealed,
      syncProcesses: input.syncProcesses,
      syncPages: input.syncPages,
      trigger: input.trigger,
      publishedOnly: input.publishedOnly,
    };
  }

  async update(input: GitSettingsInput, actor: AuthUser, meta: RequestMeta) {
    const before = await this.get();
    const after = this.merge(before, input);
    if (after.enabled && !after.tokenSealed) throw badRequest('GIT_TOKEN_REQUIRED');
    const { tokenSealed: _b, ...beforePublic } = before;
    const { tokenSealed: _a, ...afterPublic } = after;
    await this.prisma.$transaction(async (tx) => {
      const value = after as unknown as Prisma.InputJsonValue;
      await tx.setting.upsert({
        where: { key: SETTING_KEYS.GIT_INTEGRATION },
        create: { key: SETTING_KEYS.GIT_INTEGRATION, value, updatedById: actor.id },
        update: { value, updatedById: actor.id },
      });
      await this.audit.log(
        {
          action: 'UPDATE',
          entityType: 'Integration',
          entityId: 'git',
          userId: actor.id,
          summary: {
            before: beforePublic,
            after: afterPublic,
            credentialChanged: before.tokenSealed !== after.tokenSealed,
          },
          meta,
        },
        tx,
      );
    });
    return this.toDto(after);
  }

  /** Decrypted connection details for a sync; throws GIT_NOT_CONFIGURED when incomplete. */
  connection(s: StoredGitSettings): GitConnection {
    if (!s.repository || !s.branch || !s.tokenSealed || !this.box) {
      throw new GitError('GIT_NOT_CONFIGURED', 'Repository, branch or access token missing');
    }
    let token: string;
    try {
      token = this.box.decrypt(s.tokenSealed);
    } catch {
      throw new GitError(
        'GIT_NOT_CONFIGURED',
        'The stored token cannot be decrypted with the current key',
      );
    }
    return {
      provider: s.provider,
      baseUrl: s.baseUrl,
      repository: s.repository,
      branch: s.branch,
      token,
    };
  }

  /** Tests the given (possibly unsaved) settings; the stored token is used unless a new one is typed. */
  async test(input: GitSettingsInput): Promise<GitTestResultDto> {
    let conn: GitConnection | null = null;
    try {
      const merged = this.merge(await this.get(), { ...input, enabled: true });
      conn = this.connection(merged);
      const { defaultBranch } = await this.providers.client(conn.provider).test(conn);
      return { ok: true, code: null, message: null, defaultBranch };
    } catch (err) {
      if (err instanceof GitError) {
        return {
          ok: false,
          code: err.code,
          message: scrubToken(err.message, conn?.token),
          defaultBranch: null,
        };
      }
      throw err;
    }
  }
}
