import type { GitHttp, HttpRequest, HttpResponse } from './git-http';
import { GitHubClient } from './github';
import { GitLabClient } from './gitlab';
import { GitError, gitBlobSha, type GitConnection } from './types';

type Handler = (req: HttpRequest) => Partial<HttpResponse> & { status: number };

/** Scripted HTTP fake: routes "METHOD url" to handlers and records every call. */
class FakeHttp {
  calls: { method: string; url: string; req: HttpRequest }[] = [];
  constructor(private readonly routes: Record<string, Handler>) {}
  async request(url: string, req: HttpRequest = {}): Promise<HttpResponse> {
    const method = req.method ?? 'GET';
    this.calls.push({ method, url, req });
    const handler = this.routes[`${method} ${url}`];
    if (!handler) return { status: 404, headers: new Headers(), body: { message: 'Not Found' } };
    const res = handler(req);
    return { headers: new Headers(), body: null, ...res };
  }
}

const gh: GitConnection = {
  provider: 'github',
  baseUrl: '',
  repository: 'acme/bpm',
  branch: 'main',
  token: 'ghp_secret',
};
const GH = 'https://api.github.com/repos/acme/bpm';

const expectCode = async (p: Promise<unknown>, code: string) => {
  await expect(p).rejects.toBeInstanceOf(GitError);
  await expect(p).rejects.toMatchObject({ code });
};

describe('gitBlobSha', () => {
  it('matches git hash-object', () => {
    // printf 'hello\n' | git hash-object --stdin
    expect(gitBlobSha('hello\n')).toBe('ce013625030ba8dba906f756967f9e9ca394464a');
  });
});

describe('GitHubClient', () => {
  it('tests the connection: repo, push permission and branch', async () => {
    const http = new FakeHttp({
      [`GET ${GH}`]: () => ({
        status: 200,
        body: { default_branch: 'main', permissions: { push: true } },
      }),
      [`GET ${GH}/branches/main`]: () => ({ status: 200, body: {} }),
    });
    const client = new GitHubClient(http as unknown as GitHttp);
    await expect(client.test(gh)).resolves.toEqual({ defaultBranch: 'main' });
    expect(http.calls[0].req.headers?.Authorization).toBe('Bearer ghp_secret');
    await expectCode(client.test({ ...gh, branch: 'nope' }), 'GIT_BRANCH_NOT_FOUND');
  });

  it('maps errors', async () => {
    const make = (res: Handler) =>
      new GitHubClient(new FakeHttp({ [`GET ${GH}`]: res }) as unknown as GitHttp);
    await expectCode(make(() => ({ status: 401 })).test(gh), 'GIT_AUTH_FAILED');
    await expectCode(make(() => ({ status: 404 })).test(gh), 'GIT_REPO_NOT_FOUND');
    await expectCode(
      make(() => ({ status: 200, body: { permissions: { push: false } } })).test(gh),
      'GIT_NO_PUSH_ACCESS',
    );
    await expectCode(
      make(() => ({ status: 403, headers: new Headers({ 'x-ratelimit-remaining': '0' }) })).test(
        gh,
      ),
      'GIT_RATE_LIMITED',
    );
    await expectCode(make(() => ({ status: 502 })).test(gh), 'GIT_NETWORK');
  });

  it('commits several files and deletions in one commit with the author', async () => {
    let refUpdates = 0;
    const http = new FakeHttp({
      [`GET ${GH}/git/ref/heads/main`]: () => ({ status: 200, body: { object: { sha: 'c1' } } }),
      [`GET ${GH}/git/commits/c1`]: () => ({ status: 200, body: { tree: { sha: 't1' } } }),
      [`GET ${GH}/git/trees/t1?recursive=1`]: () => ({
        status: 200,
        body: {
          tree: [
            { path: 'bpm/a.bpmn', type: 'blob', sha: 's1' },
            { path: 'other/x', type: 'blob', sha: 's2' },
            { path: 'bpm', type: 'tree', sha: 's3' },
          ],
        },
      }),
      [`POST ${GH}/git/trees`]: () => ({ status: 201, body: { sha: 't2' } }),
      [`POST ${GH}/git/commits`]: () => ({
        status: 201,
        body: { sha: 'c2', html_url: 'https://github.com/acme/bpm/commit/c2' },
      }),
      [`PATCH ${GH}/git/refs/heads/main`]: () =>
        refUpdates++ === 0 ? { status: 422 } : { status: 200, body: {} },
    });
    const client = new GitHubClient(http as unknown as GitHttp);
    const listed = await client.listFiles(gh, 'bpm');
    expect([...listed.files]).toEqual([['bpm/a.bpmn', 's1']]);
    expect(listed.complete).toBe(true);

    const result = await client.commit(gh, {
      message: 'Update C.01 — v2: note',
      author: { name: 'Ana', email: 'ana@x.org' },
      upserts: [{ path: 'bpm/a.bpmn', content: '<xml/>', exists: true }],
      deletes: ['bpm/old.bpmn'],
    });
    expect(result).toEqual({ sha: 'c2', url: 'https://github.com/acme/bpm/commit/c2' });
    const tree = http.calls.find((c) => c.method === 'POST' && c.url.endsWith('/git/trees'))!.req
      .body as {
      base_tree: string;
      tree: unknown[];
    };
    expect(tree.base_tree).toBe('t1');
    expect(tree.tree).toEqual([
      { path: 'bpm/a.bpmn', mode: '100644', type: 'blob', content: '<xml/>' },
      { path: 'bpm/old.bpmn', mode: '100644', type: 'blob', sha: null },
    ]);
    const commit = http.calls.find((c) => c.url.endsWith('/git/commits'))!.req.body as {
      author: { name: string; email: string };
      parents: string[];
    };
    expect(commit.author).toMatchObject({ name: 'Ana', email: 'ana@x.org' });
    expect(commit.parents).toEqual(['c1']);
    // retried once after the branch moved
    expect(refUpdates).toBe(2);
  });
});

describe('GitLabClient', () => {
  const gl: GitConnection = {
    provider: 'gitlab',
    baseUrl: 'https://git.example.com',
    repository: 'group/sub/bpm',
    branch: 'main',
    token: 'glpat-secret',
  };
  const P = 'https://git.example.com/api/v4/projects/group%2Fsub%2Fbpm';

  it('tests the connection on a self-hosted instance with the private token', async () => {
    const http = new FakeHttp({
      [`GET ${P}`]: () => ({
        status: 200,
        body: {
          default_branch: 'main',
          permissions: { project_access: { access_level: 40 }, group_access: null },
        },
      }),
      [`GET ${P}/repository/branches/main`]: () => ({ status: 200, body: {} }),
    });
    const client = new GitLabClient(http as unknown as GitHttp);
    await expect(client.test(gl)).resolves.toEqual({ defaultBranch: 'main' });
    expect(http.calls[0].req.headers?.['PRIVATE-TOKEN']).toBe('glpat-secret');
  });

  it('requires the Developer role', async () => {
    const http = new FakeHttp({
      [`GET ${P}`]: () => ({
        status: 200,
        body: { permissions: { project_access: { access_level: 20 }, group_access: null } },
      }),
    });
    await expectCode(new GitLabClient(http as unknown as GitHttp).test(gl), 'GIT_NO_PUSH_ACCESS');
  });

  it('lists files across pages and commits create/update/delete actions', async () => {
    const http = new FakeHttp({
      [`GET ${P}/repository/tree?ref=main&recursive=true&per_page=100&page=1&path=bpm`]: () => ({
        status: 200,
        headers: new Headers({ 'x-next-page': '2' }),
        body: [{ path: 'bpm/a.bpmn', type: 'blob', id: 's1' }],
      }),
      [`GET ${P}/repository/tree?ref=main&recursive=true&per_page=100&page=2&path=bpm`]: () => ({
        status: 200,
        headers: new Headers({ 'x-next-page': '' }),
        body: [
          { path: 'bpm/docs', type: 'tree', id: 'x' },
          { path: 'bpm/b.md', type: 'blob', id: 's2' },
        ],
      }),
      [`POST ${P}/repository/commits`]: () => ({
        status: 201,
        body: { id: 'abc', web_url: 'https://git.example.com/c/abc' },
      }),
    });
    const client = new GitLabClient(http as unknown as GitHttp);
    const listed = await client.listFiles(gl, 'bpm');
    expect([...listed.files.keys()]).toEqual(['bpm/a.bpmn', 'bpm/b.md']);
    const res = await client.commit(gl, {
      message: 'msg',
      author: { name: 'Ana', email: 'ana@x.org' },
      upserts: [
        { path: 'bpm/a.bpmn', content: 'x', exists: true },
        { path: 'bpm/new.md', content: 'y', exists: false },
      ],
      deletes: ['bpm/b.md'],
    });
    expect(res).toEqual({ sha: 'abc', url: 'https://git.example.com/c/abc' });
    const body = http.calls.at(-1)!.req.body as {
      actions: { action: string }[];
      author_name: string;
    };
    expect(body.actions.map((a) => a.action)).toEqual(['update', 'create', 'delete']);
    expect(body.author_name).toBe('Ana');
  });

  it('treats a missing export folder as empty', async () => {
    const http = new FakeHttp({
      [`GET ${P}/repository/branches/main`]: () => ({ status: 200, body: {} }),
    });
    const listed = await new GitLabClient(http as unknown as GitHttp).listFiles(gl, 'bpm');
    expect(listed.files.size).toBe(0);
  });
});
