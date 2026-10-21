import { GitHttp, httpError, type HttpResponse } from './git-http';
import type { GitCommitRequest, GitCommitResult, GitConnection, GitProviderClient } from './types';
import { GitError } from './types';

/** GitLab REST API v4 (gitlab.com or self-hosted). */
export class GitLabClient implements GitProviderClient {
  constructor(private readonly http: GitHttp) {}

  private project(conn: GitConnection) {
    return `${conn.baseUrl || 'https://gitlab.com'}/api/v4/projects/${encodeURIComponent(conn.repository)}`;
  }

  private call(conn: GitConnection, path: string, method: 'GET' | 'POST' = 'GET', body?: unknown) {
    return this.http.request(`${this.project(conn)}${path}`, {
      method,
      body,
      headers: { 'PRIVATE-TOKEN': conn.token },
    });
  }

  private ok(res: HttpResponse, notFound: 'GIT_REPO_NOT_FOUND' | 'GIT_BRANCH_NOT_FOUND') {
    if (res.status < 200 || res.status >= 300) throw httpError(res, notFound);
    return res.body;
  }

  async test(conn: GitConnection) {
    const project = this.ok(await this.call(conn, ''), 'GIT_REPO_NOT_FOUND') as {
      default_branch?: string;
      permissions?: {
        project_access?: { access_level: number } | null;
        group_access?: { access_level: number } | null;
      };
    };
    const level = Math.max(
      project.permissions?.project_access?.access_level ?? 0,
      project.permissions?.group_access?.access_level ?? 0,
    );
    // 30 = Developer, the minimum role that can push.
    if (project.permissions && level < 30) {
      throw new GitError('GIT_NO_PUSH_ACCESS', 'The token needs at least the Developer role');
    }
    this.ok(
      await this.call(conn, `/repository/branches/${encodeURIComponent(conn.branch)}`),
      'GIT_BRANCH_NOT_FOUND',
    );
    return { defaultBranch: project.default_branch ?? null };
  }

  async listFiles(conn: GitConnection, folder: string) {
    const files = new Map<string, string>();
    let page = '1';
    for (let i = 0; i < 200 && page; i++) {
      const q = new URLSearchParams({ ref: conn.branch, recursive: 'true', per_page: '100', page });
      if (folder) q.set('path', folder);
      const res = await this.call(conn, `/repository/tree?${q.toString()}`);
      // An empty folder that does not exist yet is not an error.
      if (res.status === 404 && folder && page === '1') {
        const branch = await this.call(
          conn,
          `/repository/branches/${encodeURIComponent(conn.branch)}`,
        );
        this.ok(branch, 'GIT_BRANCH_NOT_FOUND');
        return { files, complete: true };
      }
      const entries = this.ok(res, 'GIT_BRANCH_NOT_FOUND') as {
        path: string;
        type: string;
        id: string;
      }[];
      for (const e of entries) if (e.type === 'blob') files.set(e.path, e.id);
      page = res.headers.get('x-next-page') ?? '';
    }
    return { files, complete: !page };
  }

  async commit(conn: GitConnection, req: GitCommitRequest): Promise<GitCommitResult> {
    const body = this.ok(
      await this.call(conn, '/repository/commits', 'POST', {
        branch: conn.branch,
        commit_message: req.message,
        author_name: req.author.name,
        author_email: req.author.email,
        actions: [
          ...req.upserts.map((u) => ({
            action: u.exists ? 'update' : 'create',
            file_path: u.path,
            content: u.content,
            encoding: 'text',
          })),
          ...req.deletes.map((path) => ({ action: 'delete', file_path: path })),
        ],
      }),
      'GIT_REPO_NOT_FOUND',
    ) as { id: string; web_url?: string };
    return { sha: body.id, url: body.web_url ?? null };
  }
}
