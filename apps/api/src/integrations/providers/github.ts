import { GitHttp, httpError, type HttpResponse } from './git-http';
import type { GitCommitRequest, GitCommitResult, GitConnection, GitProviderClient } from './types';
import { GitError } from './types';

interface TreeEntry {
  path: string;
  type: string;
  sha: string;
}

/** GitHub REST API (github.com or GitHub Enterprise via `https://host/api/v3`). */
export class GitHubClient implements GitProviderClient {
  constructor(private readonly http: GitHttp) {}

  private base(conn: GitConnection) {
    return `${conn.baseUrl || 'https://api.github.com'}/repos/${conn.repository
      .split('/')
      .map(encodeURIComponent)
      .join('/')}`;
  }

  private call(
    conn: GitConnection,
    path: string,
    method: 'GET' | 'POST' | 'PATCH' = 'GET',
    body?: unknown,
  ) {
    return this.http.request(`${this.base(conn)}${path}`, {
      method,
      body,
      headers: {
        Authorization: `Bearer ${conn.token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
    });
  }

  private ok(res: HttpResponse, notFound: 'GIT_REPO_NOT_FOUND' | 'GIT_BRANCH_NOT_FOUND') {
    if (res.status < 200 || res.status >= 300) throw httpError(res, notFound);
    return res.body as Record<string, unknown>;
  }

  private branchRef(conn: GitConnection) {
    return conn.branch.split('/').map(encodeURIComponent).join('/');
  }

  async test(conn: GitConnection) {
    const repo = this.ok(await this.call(conn, ''), 'GIT_REPO_NOT_FOUND') as {
      default_branch?: string;
      permissions?: { push?: boolean };
    };
    if (repo.permissions && repo.permissions.push === false) {
      throw new GitError('GIT_NO_PUSH_ACCESS', 'The token cannot push to this repository');
    }
    this.ok(await this.call(conn, `/branches/${this.branchRef(conn)}`), 'GIT_BRANCH_NOT_FOUND');
    return { defaultBranch: repo.default_branch ?? null };
  }

  private async head(conn: GitConnection) {
    const ref = this.ok(
      await this.call(conn, `/git/ref/heads/${this.branchRef(conn)}`),
      'GIT_BRANCH_NOT_FOUND',
    ) as { object: { sha: string } };
    const commit = this.ok(
      await this.call(conn, `/git/commits/${ref.object.sha}`),
      'GIT_BRANCH_NOT_FOUND',
    ) as { tree: { sha: string } };
    return { commitSha: ref.object.sha, treeSha: commit.tree.sha };
  }

  async listFiles(conn: GitConnection, folder: string) {
    const { treeSha } = await this.head(conn);
    const tree = this.ok(
      await this.call(conn, `/git/trees/${treeSha}?recursive=1`),
      'GIT_BRANCH_NOT_FOUND',
    ) as { tree: TreeEntry[]; truncated?: boolean };
    const prefix = folder ? `${folder}/` : '';
    const files = new Map<string, string>();
    for (const e of tree.tree) {
      if (e.type === 'blob' && e.path.startsWith(prefix)) files.set(e.path, e.sha);
    }
    return { files, complete: !tree.truncated };
  }

  async commit(conn: GitConnection, req: GitCommitRequest): Promise<GitCommitResult> {
    // One retry when the branch moved between reading the head and updating the ref.
    for (let attempt = 0; ; attempt++) {
      const { commitSha, treeSha } = await this.head(conn);
      const tree = this.ok(
        await this.call(conn, '/git/trees', 'POST', {
          base_tree: treeSha,
          tree: [
            ...req.upserts.map((u) => ({
              path: u.path,
              mode: '100644',
              type: 'blob',
              content: u.content,
            })),
            ...req.deletes.map((path) => ({ path, mode: '100644', type: 'blob', sha: null })),
          ],
        }),
        'GIT_REPO_NOT_FOUND',
      ) as { sha: string };
      const commit = this.ok(
        await this.call(conn, '/git/commits', 'POST', {
          message: req.message,
          tree: tree.sha,
          parents: [commitSha],
          author: { ...req.author, date: new Date().toISOString() },
        }),
        'GIT_REPO_NOT_FOUND',
      ) as { sha: string; html_url?: string };
      const update = await this.call(conn, `/git/refs/heads/${this.branchRef(conn)}`, 'PATCH', {
        sha: commit.sha,
        force: false,
      });
      if (update.status === 422 && attempt === 0) continue;
      this.ok(update, 'GIT_BRANCH_NOT_FOUND');
      return { sha: commit.sha, url: commit.html_url ?? null };
    }
  }
}
