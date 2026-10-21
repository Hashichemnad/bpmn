import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createHash, randomBytes } from 'node:crypto';
import { SignJWT, exportJWK, generateKeyPair, type CryptoKey, type JWK } from 'jose';

interface PendingCode {
  clientId: string;
  redirectUri: string;
  nonce: string;
  challenge: string;
  claims: Record<string, unknown>;
}

/**
 * A minimal OpenID Connect provider on 127.0.0.1 standing in for Entra ID / any OIDC server:
 * discovery, JWKS, an authorize step driven by the test and a token endpoint that checks the
 * client secret, redirect URI and PKCE verifier and returns an RS256-signed ID token.
 */
export class MockIdp {
  readonly clientId = 'processhub-test-client';
  readonly clientSecret = 'idp-client-secret-value';
  issuer = '';
  /** Claims for the next sign-in (merged over `sub`, `email`, `name`). */
  claims: Record<string, unknown> = {};
  /** Make the next ID token invalid in one way. */
  tamper: 'audience' | 'issuer' | 'nonce' | 'expired' | 'foreign-key' | null = null;
  tokenRequests: URLSearchParams[] = [];

  private server!: Server;
  private key!: CryptoKey;
  private foreignKey!: CryptoKey;
  private jwk!: JWK;
  private codes = new Map<string, PendingCode>();

  async start(port = 0) {
    const pair = await generateKeyPair('RS256', { extractable: true });
    this.key = pair.privateKey;
    this.foreignKey = (await generateKeyPair('RS256')).privateKey;
    this.jwk = { ...(await exportJWK(pair.publicKey)), kid: 'k1', alg: 'RS256', use: 'sig' };
    this.server = createServer((req, res) => void this.handle(req, res));
    await new Promise<void>((resolve) => this.server.listen(port, '127.0.0.1', resolve));
    this.issuer = `http://127.0.0.1:${(this.server.address() as AddressInfo).port}`;
    return this;
  }

  async stop() {
    await new Promise((resolve) => this.server.close(resolve));
  }

  /**
   * The user signs in at the provider: takes the authorization URL ProcessHub redirected to and
   * returns the redirect back to ProcessHub (`<redirect_uri>?code=…&state=…`).
   */
  authorize(authorizationUrl: string, claims: Record<string, unknown> = {}): URL {
    const url = new URL(authorizationUrl);
    const p = url.searchParams;
    if (url.origin + url.pathname !== `${this.issuer}/authorize`) throw new Error('wrong endpoint');
    if (p.get('client_id') !== this.clientId) throw new Error('wrong client');
    if (p.get('response_type') !== 'code') throw new Error('not the code flow');
    if (p.get('code_challenge_method') !== 'S256') throw new Error('no PKCE');
    const code = randomBytes(16).toString('hex');
    this.codes.set(code, {
      clientId: p.get('client_id')!,
      redirectUri: p.get('redirect_uri')!,
      nonce: p.get('nonce')!,
      challenge: p.get('code_challenge')!,
      claims: { ...this.claims, ...claims },
    });
    const back = new URL(p.get('redirect_uri')!);
    back.searchParams.set('code', code);
    back.searchParams.set('state', p.get('state')!);
    return back;
  }

  /** The user cancelled at the provider. */
  deny(authorizationUrl: string): URL {
    const p = new URL(authorizationUrl).searchParams;
    const back = new URL(p.get('redirect_uri')!);
    back.searchParams.set('error', 'access_denied');
    back.searchParams.set('state', p.get('state')!);
    return back;
  }

  private async handle(req: IncomingMessage, res: ServerResponse) {
    const url = new URL(req.url ?? '/', this.issuer);
    const json = (status: number, body: unknown) => {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(body));
    };
    if (url.pathname === '/.well-known/openid-configuration') {
      return json(200, {
        issuer: this.issuer,
        authorization_endpoint: `${this.issuer}/authorize`,
        token_endpoint: `${this.issuer}/token`,
        jwks_uri: `${this.issuer}/jwks`,
        response_types_supported: ['code'],
        subject_types_supported: ['public'],
        id_token_signing_alg_values_supported: ['RS256'],
        token_endpoint_auth_methods_supported: ['client_secret_post', 'client_secret_basic'],
        code_challenge_methods_supported: ['S256'],
        scopes_supported: ['openid', 'profile', 'email'],
      });
    }
    if (url.pathname === '/jwks') return json(200, { keys: [this.jwk] });
    if (url.pathname === '/authorize') {
      // A real browser reached the provider (manual / Playwright checks): sign in at once.
      res.writeHead(302, { location: this.authorize(url.toString()).toString() });
      return res.end();
    }
    if (url.pathname === '/token' && req.method === 'POST') {
      const chunks: Buffer[] = [];
      for await (const c of req) chunks.push(c as Buffer);
      const form = new URLSearchParams(Buffer.concat(chunks).toString('utf8'));
      this.tokenRequests.push(form);
      const pending = this.codes.get(form.get('code') ?? '');
      this.codes.delete(form.get('code') ?? '');
      if (!pending) return json(400, { error: 'invalid_grant' });
      if (
        form.get('client_id') !== this.clientId ||
        form.get('client_secret') !== this.clientSecret
      ) {
        return json(401, { error: 'invalid_client' });
      }
      if (form.get('redirect_uri') !== pending.redirectUri) {
        return json(400, { error: 'invalid_grant', error_description: 'redirect_uri' });
      }
      const verifier = form.get('code_verifier') ?? '';
      if (createHash('sha256').update(verifier).digest('base64url') !== pending.challenge) {
        return json(400, { error: 'invalid_grant', error_description: 'PKCE' });
      }
      return json(200, {
        access_token: randomBytes(16).toString('hex'),
        token_type: 'Bearer',
        expires_in: 3600,
        id_token: await this.idToken(pending),
      });
    }
    json(404, { error: 'not_found' });
  }

  private async idToken(p: PendingCode) {
    const tamper = this.tamper;
    this.tamper = null;
    const now = Math.floor(Date.now() / 1000);
    return new SignJWT({
      sub: 'subject-1',
      email: 'new.user@example.com',
      name: 'New User',
      ...p.claims,
      nonce: tamper === 'nonce' ? 'other-nonce' : p.nonce,
    })
      .setProtectedHeader({ alg: 'RS256', kid: 'k1' })
      .setIssuer(tamper === 'issuer' ? 'https://evil.example' : this.issuer)
      .setAudience(tamper === 'audience' ? 'another-client' : p.clientId)
      .setIssuedAt(tamper === 'expired' ? now - 7200 : now)
      .setExpirationTime(tamper === 'expired' ? now - 3600 : now + 600)
      .sign(tamper === 'foreign-key' ? this.foreignKey : this.key);
  }
}
