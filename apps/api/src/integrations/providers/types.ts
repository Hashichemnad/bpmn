import { createHash } from 'node:crypto';
import type { GitErrorCode, GitProvider } from '@processhub/shared';

export interface GitConnection {
  provider: GitProvider;
  /** API base for self-hosted instances; '' for github.com / gitlab.com. */
  baseUrl: string;
  repository: string;
  branch: string;
  token: string;
}

export interface GitUpsert {
  path: string;
  content: string;
  /** Whether the file already exists on the branch (GitLab needs create vs update). */
  exists: boolean;
}

export interface GitCommitRequest {
  message: string;
  author: { name: string; email: string };
  upserts: GitUpsert[];
  deletes: string[];
}

export interface GitCommitResult {
  sha: string;
  url: string | null;
}

export interface GitProviderClient {
  /** Verifies token, repository, push access and branch. */
  test(conn: GitConnection): Promise<{ defaultBranch: string | null }>;
  /** Blob SHA of every file under `folder` on the branch ('' = whole repository). */
  listFiles(
    conn: GitConnection,
    folder: string,
  ): Promise<{ files: Map<string, string>; complete: boolean }>;
  /** Creates exactly one commit on the branch. */
  commit(conn: GitConnection, req: GitCommitRequest): Promise<GitCommitResult>;
}

/** Provider error with a machine-readable code (translated in the UI). */
export class GitError extends Error {
  constructor(
    public readonly code: GitErrorCode,
    message: string,
  ) {
    super(message);
  }
}

/** Git's blob id for a file: sha1("blob <bytes>\0<content>"). Used to skip unchanged files. */
export function gitBlobSha(content: string): string {
  const data = Buffer.from(content, 'utf8');
  return createHash('sha1')
    .update(Buffer.concat([Buffer.from(`blob ${data.length}\0`), data]))
    .digest('hex');
}
