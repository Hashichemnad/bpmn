import { Inject, Injectable } from '@nestjs/common';
import * as oidc from 'openid-client';
import { APP_CONFIG, type AppConfig } from '../../config/config';
import { OutboundBlockedError, OutboundPolicy } from '../../common/outbound';
import { safeFetch } from '../../common/safe-fetch';

/** Discovery results are reused for an hour (the signing keys are refreshed by the library). */
const CACHE_MS = 60 * 60 * 1000;

export interface OidcClientSettings {
  issuer: string;
  clientId: string;
  clientSecret: string;
  /** Changes whenever the stored secret changes (cache key; never the secret itself). */
  secretVersion: string;
}

export interface AuthorizationChecks {
  state: string;
  nonce: string;
  codeVerifier: string;
}

/**
 * The only place that talks to the single sign-on identity provider (OpenID Connect
 * authorization-code flow with PKCE, via the OpenID-certified `openid-client`). Requests go
 * through the SSRF policy; plain http only for OUTBOUND_ALLOWED_HOSTS (e.g. a test provider).
 */
@Injectable()
export class OidcClient {
  private readonly policy: OutboundPolicy;
  private readonly fetch: ReturnType<typeof safeFetch>;
  private cache: { key: string; at: number; config: oidc.Configuration } | null = null;

  constructor(@Inject(APP_CONFIG) private readonly appConfig: AppConfig) {
    this.policy = new OutboundPolicy(appConfig.outboundAllowedHosts);
    this.fetch = safeFetch({ policy: this.policy, timeoutMs: appConfig.SSO_HTTP_TIMEOUT_MS });
  }

  async discover(s: OidcClientSettings, fresh = false): Promise<oidc.Configuration> {
    const key = `${s.issuer}|${s.clientId}|${s.secretVersion}`;
    if (!fresh && this.cache?.key === key && Date.now() - this.cache.at < CACHE_MS) {
      return this.cache.config;
    }
    const issuer = new URL(s.issuer);
    const insecure = issuer.protocol === 'http:';
    // Plain http only for allowed hosts (e.g. a provider on the internal network); internal
    // addresses only when listed. Every later request is checked again by `safeFetch`.
    if (insecure && !this.policy.allowsHost(issuer.hostname)) {
      throw new OutboundBlockedError(issuer.host);
    }
    await this.policy.resolve(issuer.hostname);
    const config = await oidc.discovery(
      issuer,
      s.clientId,
      s.clientSecret,
      oidc.ClientSecretPost(s.clientSecret),
      {
        [oidc.customFetch]: this.fetch as oidc.CustomFetch,
        // Also verify the ID token's signature against the provider's keys (the library would
        // otherwise rely on TLS for tokens from the token endpoint, which OIDC allows).
        execute: insecure
          ? [oidc.enableNonRepudiationChecks, oidc.allowInsecureRequests]
          : [oidc.enableNonRepudiationChecks],
        timeout: Math.ceil(this.appConfig.SSO_HTTP_TIMEOUT_MS / 1000),
      },
    );
    this.cache = { key, at: Date.now(), config };
    return config;
  }

  newChecks(): AuthorizationChecks {
    return {
      state: oidc.randomState(),
      nonce: oidc.randomNonce(),
      codeVerifier: oidc.randomPKCECodeVerifier(),
    };
  }

  async authorizationUrl(
    config: oidc.Configuration,
    redirectUri: string,
    checks: AuthorizationChecks,
  ): Promise<string> {
    return oidc
      .buildAuthorizationUrl(config, {
        redirect_uri: redirectUri,
        scope: 'openid profile email',
        response_type: 'code',
        response_mode: 'query',
        code_challenge: await oidc.calculatePKCECodeChallenge(checks.codeVerifier),
        code_challenge_method: 'S256',
        state: checks.state,
        nonce: checks.nonce,
      })
      .toString();
  }

  /** Validates the callback (state, PKCE, ID-token signature, issuer, audience, nonce, expiry). */
  async exchange(
    config: oidc.Configuration,
    callbackUrl: URL,
    checks: AuthorizationChecks,
  ): Promise<Record<string, unknown>> {
    const tokens = await oidc.authorizationCodeGrant(config, callbackUrl, {
      pkceCodeVerifier: checks.codeVerifier,
      expectedState: checks.state,
      expectedNonce: checks.nonce,
      idTokenExpected: true,
    });
    const claims = tokens.claims();
    if (!claims) throw new Error('No ID token');
    return claims as Record<string, unknown>;
  }
}
