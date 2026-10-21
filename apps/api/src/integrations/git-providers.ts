import { Injectable } from '@nestjs/common';
import type { GitProvider } from '@processhub/shared';
import { GitHttp } from './providers/git-http';
import { GitHubClient } from './providers/github';
import { GitLabClient } from './providers/gitlab';
import type { GitProviderClient } from './providers/types';

@Injectable()
export class GitProviders {
  constructor(private readonly http: GitHttp) {}

  client(provider: GitProvider): GitProviderClient {
    return provider === 'gitlab' ? new GitLabClient(this.http) : new GitHubClient(this.http);
  }
}
