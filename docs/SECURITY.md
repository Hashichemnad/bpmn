# Security

Security review of ProcessHub for go-live (Phase 6, part 1, October 2026). It covers what was reviewed,
what was fixed, the controls in place, every API endpoint with its guards, the remaining risks and a
checklist for an external penetration test.

Keep this file current: the endpoint table is generated from the code and checked by
`apps/api/test/route-security.e2e-spec.ts` — after adding or changing a route run
`UPDATE_SECURITY_DOC=1 pnpm --filter @processhub/api exec jest --selectProjects e2e --testPathPattern route-security`
and then `pnpm format`.

## 1. Scope and method

- **Baseline:** CLAUDE.md §6 (roles) and §7 (security requirements), OWASP Top 10 (2021).
- **Code:** the whole API (`apps/api`: guards, every controller and the services behind routes whose
  router guard is coarse, integrations, storage, AI), the web client's HTML sinks (`apps/web`), the nginx
  configuration, Docker Compose, `.env.example`, and the dependency tree (`pnpm audit`).
- **Automated evidence (new):**
  - `test/route-inventory.ts` reads every route with its access declaration, validation pipes and rate
    limit; `route-security.e2e-spec.ts` fails when a route has no access declaration, an unvalidated
    input, or is missing from the table in §5.
  - `test/authorization-matrix.e2e-spec.ts` runs against the full demo seed (content in every lifecycle
    state plus a view-restricted space with a page and an attachment). Every mutating route (90) is
    called as **Viewer, Auditor and Reviewer** with real ids and valid bodies — governance actions on
    items in every state — and must neither succeed nor change any row of 27 business tables. Every
    workspace `GET` returns 403/404 for a **Viewer**. New routes are covered automatically.
  - `test/security.e2e-spec.ts`: CSRF origin binding, security headers, cookie flags, error bodies, and
    a secrets sweep (Git token, SMTP password, AI key, user passwords never appear in API responses,
    audit entries, stored settings, sync items or logs — also when failing calls echo them).
  - `src/common/outbound.spec.ts`: SSRF guard with a real local server (blocked, allowed, redirects).

## 2. Findings and fixes

| ID     | Area (OWASP)                | Finding                                                                                                                                                                                                                                                                                                                                                                                               | Severity | Status                                                                                                                                                                       |
| ------ | --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| SEC-01 | SSRF (A10)                  | The Git integration (GitLab / GitHub Enterprise URL) and SMTP host could point at internal addresses — loopback, private networks, the cloud metadata service — giving an administrator account a way into the internal network.                                                                                                                                                                      | Medium   | **Fixed.** `src/common/outbound.ts`: internal ranges blocked unless the host is in `OUTBOUND_ALLOWED_HOSTS`; the checked address is the one connected to (no DNS rebinding). |
| SEC-02 | Transport of secrets (A02)  | A Git token could be sent to a plain `http://` URL.                                                                                                                                                                                                                                                                                                                                                   | Low      | **Fixed.** Plain HTTP only for hosts in `OUTBOUND_ALLOWED_HOSTS`.                                                                                                            |
| SEC-03 | CSRF (A01)                  | Double-submit cookie only: a sibling sub-domain able to set cookies for the parent domain ("cookie tossing") could plant a known CSRF token.                                                                                                                                                                                                                                                          | Low      | **Fixed.** `CsrfGuard` also requires `Origin` (when sent) to be in `CORS_ORIGINS` or the request's own host, and rejects `Sec-Fetch-Site: cross-site` without `Origin`.      |
| SEC-04 | Security headers (A05)      | nginx `add_header` is not inherited by a `location` that sets its own headers: `/` and `/assets/` lacked `Permissions-Policy`, `/assets/` also the CSP and frame options.                                                                                                                                                                                                                             | Low      | **Fixed.** One snippet (`apps/web/nginx-security-headers.conf`) included in every location; adds `Cross-Origin-Opener-Policy`.                                               |
| SEC-05 | Crypto (A02)                | `SecretBox.decrypt` accepted truncated AES-GCM tags (Node accepts 4–16 bytes unless the length is fixed), weakening integrity of stored secrets.                                                                                                                                                                                                                                                      | Low      | **Fixed.** Full 16-byte tag required (`authTagLength`).                                                                                                                      |
| SEC-06 | XSS / privacy (A03)         | Sanitised SVG logos kept external CSS references (`@import`, `url(https://…)`); the logo response had no `sandbox`.                                                                                                                                                                                                                                                                                   | Low      | **Fixed.** External references removed; `sandbox` added to the logo CSP.                                                                                                     |
| SEC-07 | Vulnerable components (A06) | `react-router` 6 (open redirect, constructor injection), `vitest` 3 (dev server path traversal), `js-yaml` 5.3 (CPU exhaustion, via Swagger).                                                                                                                                                                                                                                                         | Moderate | **Fixed.** `react-router-dom` 7.18, `vitest` 4.1, `js-yaml` ≥ 5.4.1 (override).                                                                                              |
| SEC-08 | Vulnerable components (A06) | `braces` (high, ReDoS/stack exhaustion) via Jest; no fixed version exists. Dev-only, but the API runtime image currently contains dev dependencies.                                                                                                                                                                                                                                                   | Low      | **Accepted** (D-054); follow-up: Jest → Vitest (BACKLOG).                                                                                                                    |
| SEC-09 | Vulnerable components (A06) | MinIO client pulls `stream-json` 1.x and `decode-uri-component` 0.2 (moderate). The vulnerable code (stream-json filters/JSONC/Assembler, decoding of crafted URIs) is not on any path ProcessHub uses. `exceljs` (reports, D-087) pulls `uuid` 8 (moderate GHSA-w5hq-g745-h8pq: missing bounds check when a caller passes an output buffer to v3/v5/v6); exceljs only calls `v4()` without a buffer. | Low      | Accepted, tracked in BACKLOG (replace when MinIO updates).                                                                                                                   |

| SEC-10 | Authentication (A07) | Part 3: `openid-client` does not check the signature of ID tokens received from the token endpoint by default (allowed by OIDC when TLS is used). A test with a token signed by a foreign key was accepted. | Low | **Fixed** before release: `enableNonRepudiationChecks` — the signature is always verified against the provider's JWKS. |
| SEC-11 | Authentication (A07) | Part 3: with two-factor sign-in, a correct password reset the failed-login counter, so codes could be guessed without limit by re-entering the password. | Medium | **Fixed** before release: the counter is reset only after every factor; wrong codes count towards the same lockout (tested). |

No authorisation gaps were found: the matrix test passes for every route without changes to the guards.

## 3. Controls in place (CLAUDE.md §7 and OWASP Top 10)

**A01 Broken access control**

- Deny by default: a global guard rejects any route without `@Public`, `@RequirePermissions`,
  `@RequireAnyPermission` or `@Authenticated` (checked by test). Permissions are checked, never role names.
- Routes with a coarse router guard (governance actions, spaces, reviews, feedback, AI features) check the
  item in the service: read access (`ContentService.load`, space restrictions), edit / manage rights, the
  user's own review task, ownership of comments and feedback. Unreadable items answer 404, not 403.
- Viewers are portal-only: the portal serves only current publications of visible spaces, and portal files
  only when referenced by the published version (D-028). Search, AI Q&A (published content the user may
  see), exports (`/pages/:id/export/markdown` needs `docs.read`), attachments and Git settings (Super Admin)
  are covered by the matrix test and the portal / AI tests.
- Only a Super Admin can grant or remove `SUPER_ADMIN`; the last active Super Admin cannot be removed. There
  are no role-editing endpoints.
- CORS: only `CORS_ORIGINS`, credentials allowed, limited methods and headers.

**A02 Cryptographic failures**

- Passwords: argon2id; refresh tokens stored as hashes, rotated on every use, reuse revokes the family,
  24-hour idle lifetime by default.
- Integration secrets (Git token, SMTP password, AI key): AES-256-GCM (`INTEGRATIONS_ENCRYPTION_KEY`),
  write-only in the API, scrubbed from error messages and logs.
- Cookies: `HttpOnly`, `Secure` (unless `COOKIE_SECURE=false`), `SameSite=Strict`; the access cookie is
  limited to `/api`, the refresh cookie to `/api/v1/auth`.

**A03 Injection / XSS**

- All input through zod schemas (`ZodPipe`, `UuidPipe`; checked by test); Prisma only. The few raw
  queries (full-text search) use tagged templates / bound parameters.
- Rich text: DOMPurify with the same allow-list on the server (every write) and in the browser (every
  render); links limited to http(s), mailto and in-app paths; images only from attachments.
- No `dangerouslySetInnerHTML` in the web app; comments, search snippets and AI answers are rendered as text.
- BPMN: DTDs / entities rejected (XXE, billion laughs); labels are rendered as SVG text by bpmn-js; AI-built
  BPMN is escaped and parsed before it is shown.
- Emails: every value HTML-escaped; links built from `APP_URL`, never from request headers.
- Files are served with `Content-Disposition: attachment` (inline only for raster images),
  `X-Content-Type-Options: nosniff` and `Content-Security-Policy: default-src 'none'; sandbox`.

**A04 Insecure design** — four-eyes principle for approvals, state machine enforced on the server, AI output
is never saved without a human accepting a preview, AI per-user and organisation limits.

**A05 Security misconfiguration**

- API: helmet (`default-src 'none'`, `frame-ancestors 'none'`, HSTS, no `X-Powered-By`), request size limits,
  Swagger off unless `ENABLE_SWAGGER=true`, errors normalised (no stack traces or internals).
- Web (nginx): CSP `script-src 'self'` (no inline scripts), `object-src 'none'`, `frame-ancestors 'none'`,
  `X-Frame-Options`, `nosniff`, `Referrer-Policy: no-referrer`, `Permissions-Policy`, COOP; `server_tokens off`.

**A06 Vulnerable components** — `pnpm audit --prod`: no high/critical (see SEC-08 / SEC-09).

**A07 Identification and authentication** — password policy, account lockout after repeated failures, a
dummy hash for unknown accounts (same timing), stricter rate limit on login / refresh / change password,
short-lived access tokens; the user is re-loaded on every request, so deactivation and role changes apply
immediately and a password change invalidates older tokens.

- **Single sign-on (Part 3, D-055 – D-058):** OpenID Connect authorization-code flow with PKCE (S256),
  `state` and `nonce` (`openid-client`, OpenID-certified). The ID token's signature (provider JWKS), issuer,
  audience, expiry and nonce are verified. The one-time checks travel in an AES-256-GCM-encrypted, 10-minute,
  `HttpOnly`, `SameSite=Lax` cookie limited to `/api/v1/auth/sso` (Lax is needed for the redirect back from
  the provider; it never holds a session). The callback URL is rebuilt from `APP_URL`; `returnTo` only
  accepts in-app paths (no open redirect). Users are matched by (issuer, subject); an e-mail match links an
  account only once and never takes over an account linked to another subject. Allowed e-mail domains are
  required; unverified addresses (`email_verified: false`) are refused. The client secret is encrypted
  and write-only; provider calls go through the SSRF policy. Group sync never removes Super Admin from the
  break-glass account or the last Super Admin.
- **Password sign-in can be switched off** except for one break-glass Super Admin; the "turned off" answer
  is only given after a correct password (does not reveal the break-glass account). `AUTH_FORCE_LOCAL_LOGIN`
  is the documented emergency switch.
- **TOTP two-factor (D-059):** RFC 6238 (`otpauth`), secret AES-256-GCM-encrypted, ±1 time step, a used time
  step is rejected (atomic, no replay); 10 single-use recovery codes (80 bits, SHA-256). The password step
  returns only a 5-minute challenge cookie (`HttpOnly`, `SameSite=Strict`, path `/api/v1/auth/login`, not
  usable as an access token). Enrolment, turning off and new recovery codes need the password (and a code);
  admins can require 2FA per role and reset it (sessions revoked, audited as `MFA_RESET`).
- **Go-live policy (part 4, D-061 – D-065):** 2FA required by default for Super Admin and Admin (optional for
  the other roles; the settings page warns if either is removed); the break-glass account always needs 2FA;
  roles are managed in ProcessHub (directory groups set only the first role); MFA for SSO users is enforced
  by Entra ID Conditional Access; sessions (refresh tokens) end after **24 hours without activity**
  (`REFRESH_TOKEN_TTL_HOURS`, was 7 days); access tokens 15 minutes; deactivating a user ends access at once.

**A08 Software and data integrity** — lockfile with `--frozen-lockfile` in the images, pnpm build-script
allow-list (`onlyBuiltDependencies`), GCM-authenticated secrets.

**A09 Logging and monitoring** — audit log for every create / update / delete / publish / login / failed
login / lockout / settings change / AI call; logs contain no secrets (tested).

**A10 SSRF** — see SEC-01. The AI provider address is not configurable in the UI (only `ANTHROPIC_BASE_URL`
in the environment); the file storage and the database come from the environment.

## 4. Rate limits

| Scope                                                                                 | Limit (default)                                     | Setting                                                |
| ------------------------------------------------------------------------------------- | --------------------------------------------------- | ------------------------------------------------------ |
| Every endpoint, per client IP                                                         | 300 requests / 60 s                                 | `RATE_LIMIT_MAX`, `RATE_LIMIT_TTL_SECONDS`             |
| Login, 2FA steps, SSO start / callback, token refresh, change password, per client IP | 10 requests / 60 s                                  | `LOGIN_RATE_LIMIT_MAX`                                 |
| Failed logins per account (wrong password or 2FA code)                                | lock for 15 min after 5 failures                    | `LOGIN_MAX_ATTEMPTS`, `LOGIN_LOCKOUT_MINUTES`          |
| AI features                                                                           | per-user daily and organisation monthly requests    | Settings → AI                                          |
| Request bodies                                                                        | JSON 6 MB, forms 100 KB, attachments / logo by type | `BODY_LIMIT`, `ATTACHMENT_MAX_BYTES`, `LOGO_MAX_BYTES` |

Client IPs come from `X-Forwarded-For` with `TRUST_PROXY` hops — set it to the number of proxies in front
of the API, or clients can spoof their IP and evade per-IP limits.

## 5. Endpoints and their guards

"Access" is the router guard. Where it is a read permission or "authenticated" on a route that changes
data, the service checks the item (see §3 A01) — the authorisation matrix test proves read-only roles
cannot change anything through any route. "Validated input" lists the request parts that pass through a
zod / UUID pipe; file uploads are checked in the service (allow-list, content sniffing, size). Rate limit
"default" / "login" refer to §4.

<!-- route-table:start -->

| Method | Path (under `/api/v1`)                       | Access (server guard)                                     | Validated input                     | Rate limit |
| ------ | -------------------------------------------- | --------------------------------------------------------- | ----------------------------------- | ---------- |
| POST   | `/ai/analyse`                                | authenticated                                             | body                                | default    |
| POST   | `/ai/doc-to-process`                         | authenticated                                             | body                                | default    |
| POST   | `/ai/generate-doc`                           | authenticated                                             | body                                | default    |
| POST   | `/ai/generate-process`                       | authenticated                                             | body                                | default    |
| POST   | `/ai/portal/ask`                             | authenticated                                             | body                                | default    |
| POST   | `/ai/refine-process`                         | authenticated                                             | body                                | default    |
| GET    | `/ai/settings`                               | `settings.manage`                                         | —                                   | default    |
| PUT    | `/ai/settings`                               | `settings.manage`                                         | body                                | default    |
| POST   | `/ai/settings/test`                          | `settings.manage`                                         | body                                | default    |
| GET    | `/ai/status`                                 | authenticated                                             | —                                   | default    |
| POST   | `/ai/summarise`                              | authenticated                                             | body                                | default    |
| POST   | `/ai/translate`                              | authenticated                                             | body                                | default    |
| GET    | `/ai/usage`                                  | `ai.usage.read`                                           | query                               | default    |
| DELETE | `/attachments/:id`                           | `docs.read` + `docs.edit`                                 | param `id`                          | default    |
| GET    | `/attachments/:id/content`                   | `docs.read`                                               | param `id`                          | default    |
| GET    | `/audit-logs`                                | `audit.read`                                              | query                               | default    |
| POST   | `/auth/change-password`                      | authenticated                                             | body                                | login      |
| GET    | `/auth/csrf`                                 | **public**                                                | —                                   | default    |
| POST   | `/auth/login`                                | **public**                                                | body                                | login      |
| POST   | `/auth/login/mfa`                            | **public**                                                | body                                | login      |
| POST   | `/auth/login/mfa/setup`                      | **public**                                                | —                                   | login      |
| POST   | `/auth/login/mfa/setup/confirm`              | **public**                                                | body                                | login      |
| POST   | `/auth/logout`                               | **public**                                                | —                                   | default    |
| GET    | `/auth/me`                                   | authenticated                                             | —                                   | default    |
| PATCH  | `/auth/me`                                   | authenticated                                             | body                                | default    |
| GET    | `/auth/mfa`                                  | authenticated                                             | —                                   | default    |
| POST   | `/auth/mfa/disable`                          | authenticated                                             | body                                | login      |
| POST   | `/auth/mfa/enable`                           | authenticated                                             | body                                | login      |
| POST   | `/auth/mfa/recovery-codes`                   | authenticated                                             | body                                | login      |
| POST   | `/auth/mfa/setup`                            | authenticated                                             | body                                | login      |
| GET    | `/auth/options`                              | **public**                                                | —                                   | default    |
| POST   | `/auth/refresh`                              | **public**                                                | —                                   | login      |
| GET    | `/auth/sso/callback`                         | **public**                                                | query                               | login      |
| GET    | `/auth/sso/start`                            | **public**                                                | query                               | login      |
| DELETE | `/comments/:commentId`                       | `comments.write`                                          | param `commentId`                   | default    |
| PATCH  | `/comments/:commentId`                       | `comments.write`                                          | body, param `commentId`             | default    |
| POST   | `/comments/:commentId/reopen`                | `comments.write`                                          | param `commentId`                   | default    |
| POST   | `/comments/:commentId/resolve`               | `comments.write`                                          | param `commentId`                   | default    |
| GET    | `/comments/:type/:id`                        | any of `processes.read`, `docs.read`                      | param `id`, param `type`            | default    |
| POST   | `/comments/:type/:id`                        | `comments.write`                                          | body, param `id`, param `type`      | default    |
| GET    | `/departments`                               | `departments.read`                                        | —                                   | default    |
| POST   | `/departments`                               | `departments.manage`                                      | body                                | default    |
| DELETE | `/departments/:id`                           | `departments.manage`                                      | param `id`                          | default    |
| PATCH  | `/departments/:id`                           | `departments.manage`                                      | body, param `id`                    | default    |
| POST   | `/dictionary/objects/:id/rename`             | `objects.read` + `processes.read`                         | body, param `id`                    | default    |
| POST   | `/dictionary/objects/:id/rename-preview`     | `objects.read` + `processes.read`                         | body, param `id`                    | default    |
| GET    | `/dictionary/suggest`                        | `objects.read`                                            | query                               | default    |
| POST   | `/dictionary/terms`                          | `dictionary.propose`                                      | body                                | default    |
| PATCH  | `/dictionary/terms/:id`                      | `dictionary.propose`                                      | body, param `id`                    | default    |
| POST   | `/dictionary/terms/:id/approve`              | `dictionary.approve`                                      | param `id`                          | default    |
| POST   | `/dictionary/terms/:id/reject`               | `dictionary.approve`                                      | body, param `id`                    | default    |
| GET    | `/feedback`                                  | authenticated                                             | query                               | default    |
| POST   | `/feedback`                                  | `portal.read`                                             | body                                | default    |
| PATCH  | `/feedback/:id`                              | authenticated                                             | body, param `id`                    | default    |
| GET    | `/governance/:type/:id`                      | any of `processes.read`, `docs.read`                      | param `id`, param `type`            | default    |
| PATCH  | `/governance/:type/:id`                      | any of `processes.read`, `docs.read`                      | body, param `id`, param `type`      | default    |
| POST   | `/governance/:type/:id/archive`              | any of `processes.read`, `docs.read`                      | body, param `id`, param `type`      | default    |
| POST   | `/governance/:type/:id/confirm-review`       | any of `processes.read`, `docs.read`                      | param `id`, param `type`            | default    |
| GET    | `/governance/:type/:id/publications`         | any of `processes.read`, `docs.read`                      | param `id`, param `type`            | default    |
| POST   | `/governance/:type/:id/publish`              | any of `processes.read`, `docs.read`                      | body, param `id`, param `type`      | default    |
| POST   | `/governance/:type/:id/restore`              | any of `processes.read`, `docs.read`                      | param `id`, param `type`            | default    |
| GET    | `/governance/:type/:id/reviews`              | any of `processes.read`, `docs.read`                      | param `id`, param `type`            | default    |
| POST   | `/governance/:type/:id/submit`               | any of `processes.read`, `docs.read`                      | body, param `id`, param `type`      | default    |
| POST   | `/governance/:type/:id/withdraw`             | any of `processes.read`, `docs.read`                      | param `id`, param `type`            | default    |
| GET    | `/governance/dashboard`                      | `governance.dashboard`                                    | —                                   | default    |
| POST   | `/governance/reminders/run`                  | `governance.manage`                                       | —                                   | default    |
| GET    | `/governance/settings`                       | any of `governance.manage`, `processes.read`, `docs.read` | —                                   | default    |
| PUT    | `/governance/settings`                       | `governance.manage`                                       | body                                | default    |
| PUT    | `/governance/spaces/:spaceId/workflow`       | any of `governance.manage`, `docs.read`                   | body, param `spaceId`               | default    |
| GET    | `/grc/controls`                              | `grc.read`                                                | query                               | default    |
| POST   | `/grc/controls`                              | any of `grc.edit`, `grc.propose`                          | body                                | default    |
| DELETE | `/grc/controls/:id`                          | any of `grc.edit`, `grc.propose`                          | param `id`                          | default    |
| GET    | `/grc/controls/:id`                          | `grc.read`                                                | param `id`                          | default    |
| PATCH  | `/grc/controls/:id`                          | any of `grc.edit`, `grc.propose`                          | body, param `id`                    | default    |
| GET    | `/grc/dashboard`                             | `grc.read`                                                | query                               | default    |
| GET    | `/grc/dashboard/uncovered-steps`             | `grc.read`                                                | query                               | default    |
| GET    | `/grc/export/:kind`                          | `grc.read`                                                | param `kind`, query                 | default    |
| POST   | `/grc/import/:kind`                          | `grc.edit`                                                | file, param `kind`, query           | default    |
| POST   | `/grc/items/:id/comments`                    | `grc.read` + `comments.write`                             | body, param `id`                    | default    |
| GET    | `/grc/items/:id/timeline`                    | `grc.read`                                                | param `id`                          | default    |
| GET    | `/grc/processes/:id`                         | `grc.read` + `processes.read`                             | param `id`                          | default    |
| GET    | `/grc/rcm`                                   | `grc.read`                                                | query                               | default    |
| GET    | `/grc/requirements`                          | `grc.read`                                                | query                               | default    |
| POST   | `/grc/requirements`                          | `grc.edit`                                                | body                                | default    |
| DELETE | `/grc/requirements/:id`                      | `grc.admin`                                               | param `id`                          | default    |
| GET    | `/grc/requirements/:id`                      | `grc.read`                                                | param `id`                          | default    |
| PATCH  | `/grc/requirements/:id`                      | `grc.edit`                                                | body, param `id`                    | default    |
| GET    | `/grc/risks`                                 | `grc.read`                                                | query                               | default    |
| POST   | `/grc/risks`                                 | any of `grc.edit`, `grc.propose`                          | body                                | default    |
| DELETE | `/grc/risks/:id`                             | any of `grc.edit`, `grc.propose`                          | param `id`                          | default    |
| GET    | `/grc/risks/:id`                             | `grc.read`                                                | param `id`                          | default    |
| PATCH  | `/grc/risks/:id`                             | any of `grc.edit`, `grc.propose`                          | body, param `id`                    | default    |
| GET    | `/grc/settings`                              | any of `grc.read`, `processes.read`                       | —                                   | default    |
| PUT    | `/grc/settings`                              | `grc.admin`                                               | body                                | default    |
| GET    | `/grc/template/:kind`                        | `grc.edit`                                                | param `kind`, query                 | default    |
| GET    | `/health`                                    | **public**                                                | —                                   | skip       |
| GET    | `/integrations/git`                          | `settings.manage`                                         | —                                   | default    |
| PUT    | `/integrations/git`                          | `settings.manage`                                         | body                                | default    |
| POST   | `/integrations/git/items/:id/retry`          | `settings.manage`                                         | param `id`                          | default    |
| GET    | `/integrations/git/status`                   | `settings.manage`                                         | —                                   | default    |
| POST   | `/integrations/git/sync`                     | `settings.manage`                                         | body                                | default    |
| POST   | `/integrations/git/test`                     | `settings.manage`                                         | body                                | default    |
| GET    | `/notifications`                             | authenticated                                             | query                               | default    |
| POST   | `/notifications/:id/read`                    | authenticated                                             | param `id`                          | default    |
| GET    | `/notifications/preferences`                 | authenticated                                             | —                                   | default    |
| PUT    | `/notifications/preferences`                 | authenticated                                             | body                                | default    |
| POST   | `/notifications/read-all`                    | authenticated                                             | —                                   | default    |
| GET    | `/notifications/unread-count`                | authenticated                                             | —                                   | default    |
| GET    | `/objects`                                   | `objects.read`                                            | query                               | default    |
| POST   | `/objects`                                   | `objects.manage`                                          | body                                | default    |
| DELETE | `/objects/:id`                               | `objects.manage`                                          | param `id`                          | default    |
| GET    | `/objects/:id`                               | `objects.read`                                            | param `id`                          | default    |
| PATCH  | `/objects/:id`                               | `objects.manage`                                          | body, param `id`                    | default    |
| GET    | `/objects/:id/pages`                         | `docs.read` + `objects.read`                              | param `id`                          | default    |
| GET    | `/objects/:id/usage`                         | `objects.read` + `processes.read`                         | param `id`                          | default    |
| DELETE | `/pages/:id`                                 | `docs.read` + `docs.edit`                                 | param `id`                          | default    |
| GET    | `/pages/:id`                                 | `docs.read`                                               | param `id`                          | default    |
| PUT    | `/pages/:id`                                 | `docs.read` + `docs.edit`                                 | body, param `id`                    | default    |
| GET    | `/pages/:id/attachments`                     | `docs.read`                                               | param `id`                          | default    |
| POST   | `/pages/:id/attachments`                     | `docs.read` + `docs.edit`                                 | file, param `id`                    | default    |
| DELETE | `/pages/:id/draft`                           | `docs.read` + `docs.edit`                                 | param `id`                          | default    |
| GET    | `/pages/:id/draft`                           | `docs.read` + `docs.edit`                                 | param `id`                          | default    |
| PUT    | `/pages/:id/draft`                           | `docs.read` + `docs.edit`                                 | body, param `id`                    | default    |
| GET    | `/pages/:id/export/markdown`                 | `docs.read`                                               | param `id`, query `lang`            | default    |
| GET    | `/pages/:id/links`                           | `docs.read`                                               | param `id`                          | default    |
| POST   | `/pages/:id/links`                           | `docs.read` + `docs.edit`                                 | body, param `id`                    | default    |
| DELETE | `/pages/:id/links/:linkId`                   | `docs.read` + `docs.edit`                                 | param `id`, param `linkId`          | default    |
| POST   | `/pages/:id/move`                            | `docs.read` + `docs.edit`                                 | body, param `id`                    | default    |
| DELETE | `/pages/:id/purge`                           | `docs.read` + `docs.manage`                               | param `id`                          | default    |
| POST   | `/pages/:id/restore`                         | `docs.read` + `docs.edit`                                 | param `id`                          | default    |
| GET    | `/pages/:id/versions`                        | `docs.read`                                               | param `id`                          | default    |
| GET    | `/pages/:id/versions/:versionId`             | `docs.read`                                               | param `id`, param `versionId`       | default    |
| PATCH  | `/pages/:id/versions/:versionId`             | `docs.read` + `docs.edit`                                 | body, param `id`, param `versionId` | default    |
| POST   | `/pages/:id/versions/:versionId/restore`     | `docs.read` + `docs.edit`                                 | body, param `id`, param `versionId` | default    |
| GET    | `/portal/:type/:id/feedback`                 | `portal.read`                                             | param `id`, param `type`            | default    |
| GET    | `/portal/attachments/:id/content`            | `portal.read`                                             | param `id`                          | default    |
| GET    | `/portal/home`                               | `portal.read`                                             | —                                   | default    |
| GET    | `/portal/my`                                 | `portal.read`                                             | —                                   | default    |
| GET    | `/portal/pages/:id`                          | `portal.read`                                             | param `id`                          | default    |
| GET    | `/portal/processes`                          | `portal.read`                                             | —                                   | default    |
| GET    | `/portal/processes/:id`                      | `portal.read`                                             | param `id`                          | default    |
| GET    | `/portal/search`                             | `portal.read`                                             | query                               | default    |
| GET    | `/portal/settings`                           | `portal.manage`                                           | —                                   | default    |
| PUT    | `/portal/settings`                           | `portal.manage`                                           | body                                | default    |
| GET    | `/portal/spaces`                             | `portal.read`                                             | —                                   | default    |
| GET    | `/portal/spaces/:id/pages`                   | `portal.read`                                             | param `id`                          | default    |
| GET    | `/processes`                                 | `processes.read`                                          | query                               | default    |
| POST   | `/processes`                                 | `processes.create`                                        | body                                | default    |
| DELETE | `/processes/:id`                             | `processes.delete`                                        | param `id`                          | default    |
| GET    | `/processes/:id`                             | `processes.read`                                          | param `id`                          | default    |
| PATCH  | `/processes/:id`                             | any of `processes.edit`, `processes.edit_own`             | body, param `id`                    | default    |
| GET    | `/processes/:id/links`                       | `processes.read`                                          | param `id`                          | default    |
| POST   | `/processes/:id/links`                       | any of `models.edit`, `models.edit_own`, `grc.edit`       | body, param `id`                    | default    |
| DELETE | `/processes/:id/links/:linkId`               | any of `models.edit`, `models.edit_own`, `grc.edit`       | param `id`, param `linkId`          | default    |
| GET    | `/processes/:id/model`                       | `processes.read`                                          | param `id`                          | default    |
| PUT    | `/processes/:id/model`                       | any of `models.edit`, `models.edit_own`                   | body, param `id`                    | default    |
| POST   | `/processes/:id/move`                        | `processes.edit`                                          | body, param `id`                    | default    |
| GET    | `/processes/:id/pages`                       | `docs.read` + `processes.read`                            | param `id`                          | default    |
| GET    | `/processes/:id/versions`                    | `processes.read`                                          | param `id`                          | default    |
| POST   | `/processes/:id/versions`                    | any of `models.edit`, `models.edit_own`                   | body, param `id`                    | default    |
| GET    | `/processes/:id/versions/:versionId`         | `processes.read`                                          | param `id`, param `versionId`       | default    |
| PATCH  | `/processes/:id/versions/:versionId`         | any of `models.edit`, `models.edit_own`                   | body, param `id`, param `versionId` | default    |
| POST   | `/processes/:id/versions/:versionId/restore` | any of `models.edit`, `models.edit_own`                   | body, param `id`, param `versionId` | default    |
| GET    | `/processes/tree`                            | `processes.read`                                          | —                                   | default    |
| POST   | `/reports/handbook`                          | any of `processes.read`, `portal.read`                    | body                                | default    |
| POST   | `/reports/handbook/plan`                     | any of `processes.read`, `portal.read`                    | body                                | default    |
| GET    | `/reports/objects/:id`                       | `objects.read` + `processes.read`                         | param `id`, query                   | default    |
| GET    | `/reports/raci/:processId`                   | any of `processes.read`, `portal.read`                    | param `processId`, query            | default    |
| GET    | `/reviews/:id`                               | authenticated                                             | param `id`                          | default    |
| POST   | `/reviews/:id/decision`                      | authenticated                                             | body, param `id`                    | default    |
| GET    | `/roles`                                     | any of `roles.read`, `users.manage`                       | —                                   | default    |
| GET    | `/search`                                    | any of `docs.read`, `processes.read`                      | query                               | default    |
| GET    | `/settings`                                  | `settings.manage`                                         | —                                   | default    |
| PATCH  | `/settings`                                  | `settings.manage`                                         | body                                | default    |
| GET    | `/settings/auth`                             | `settings.manage`                                         | —                                   | default    |
| PUT    | `/settings/auth`                             | `settings.manage`                                         | body                                | default    |
| POST   | `/settings/auth/test`                        | `settings.manage`                                         | body                                | default    |
| DELETE | `/settings/diagram-theme`                    | `settings.manage`                                         | —                                   | default    |
| PUT    | `/settings/diagram-theme`                    | `settings.manage`                                         | body                                | default    |
| POST   | `/settings/diagram-theme/apply`              | `settings.manage`                                         | body                                | default    |
| GET    | `/settings/diagram-theme/notice`             | `settings.manage`                                         | —                                   | default    |
| POST   | `/settings/diagram-theme/notice/dismiss`     | `settings.manage`                                         | —                                   | default    |
| GET    | `/settings/email`                            | `settings.manage`                                         | —                                   | default    |
| PUT    | `/settings/email`                            | `settings.manage`                                         | body                                | default    |
| POST   | `/settings/email/test`                       | `settings.manage`                                         | body                                | default    |
| DELETE | `/settings/logo`                             | `settings.manage`                                         | —                                   | default    |
| GET    | `/settings/logo`                             | **public**                                                | —                                   | default    |
| POST   | `/settings/logo`                             | `settings.manage`                                         | file                                | default    |
| GET    | `/settings/modeling-conventions`             | `processes.read`                                          | —                                   | default    |
| PUT    | `/settings/modeling-conventions`             | `conventions.manage`                                      | body                                | default    |
| GET    | `/settings/public`                           | **public**                                                | —                                   | default    |
| GET    | `/spaces`                                    | `docs.read`                                               | —                                   | default    |
| POST   | `/spaces`                                    | `docs.manage`                                             | body                                | default    |
| DELETE | `/spaces/:id`                                | `docs.manage`                                             | param `id`                          | default    |
| GET    | `/spaces/:id`                                | `docs.read`                                               | param `id`                          | default    |
| PATCH  | `/spaces/:id`                                | `docs.read`                                               | body, param `id`                    | default    |
| GET    | `/spaces/:id/permissions`                    | `docs.read`                                               | param `id`                          | default    |
| PUT    | `/spaces/:id/permissions`                    | `docs.read`                                               | body, param `id`                    | default    |
| GET    | `/spaces/:spaceId/pages`                     | `docs.read`                                               | param `spaceId`                     | default    |
| POST   | `/spaces/:spaceId/pages`                     | `docs.read` + `docs.edit`                                 | body, param `spaceId`               | default    |
| GET    | `/spaces/:spaceId/trash`                     | `docs.read` + `docs.edit`                                 | param `spaceId`                     | default    |
| GET    | `/tasks`                                     | authenticated                                             | —                                   | default    |
| GET    | `/templates`                                 | `docs.read`                                               | —                                   | default    |
| POST   | `/templates`                                 | `docs.manage`                                             | body                                | default    |
| DELETE | `/templates/:id`                             | `docs.manage`                                             | param `id`                          | default    |
| GET    | `/templates/:id`                             | `docs.read`                                               | param `id`                          | default    |
| PUT    | `/templates/:id`                             | `docs.manage`                                             | body, param `id`                    | default    |
| GET    | `/users`                                     | `users.read`                                              | query                               | default    |
| POST   | `/users`                                     | `users.manage`                                            | body                                | default    |
| GET    | `/users/:id`                                 | `users.read`                                              | param `id`                          | default    |
| PATCH  | `/users/:id`                                 | `users.manage`                                            | body, param `id`                    | default    |
| POST   | `/users/:id/mfa/reset`                       | `users.manage`                                            | param `id`                          | default    |
| POST   | `/users/:id/reset-password`                  | `users.manage`                                            | body, param `id`                    | default    |
| POST   | `/users/:id/unlock`                          | `users.manage`                                            | param `id`                          | default    |
| GET    | `/users/directory`                           | any of `comments.write`, `governance.manage`              | query                               | default    |
| GET    | `/workflows`                                 | any of `governance.manage`, `processes.read`, `docs.read` | —                                   | default    |
| POST   | `/workflows`                                 | `governance.manage`                                       | body                                | default    |
| DELETE | `/workflows/:id`                             | `governance.manage`                                       | param `id`                          | default    |
| GET    | `/workflows/:id`                             | any of `governance.manage`, `processes.read`, `docs.read` | param `id`                          | default    |
| PUT    | `/workflows/:id`                             | `governance.manage`                                       | body, param `id`                    | default    |

<!-- route-table:end -->

## 6. Remaining risks

| Risk                                                                                                                                             | Mitigation / plan                                                                                                                                                                                                                                               |
| ------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **SEC-08** `braces` (high) via Jest, no upstream fix; dev dependencies are in the API runtime image.                                             | Not executed at runtime. **Accepted** by the product owner (D-054); the slim runtime image and the Jest → Vitest move (BACKLOG) remove it.                                                                                                                      |
| **SEC-09** The `minio` npm client's `stream-json` / `decode-uri-component` (moderate).                                                           | Code paths unused; replace the client with `@aws-sdk/client-s3` (BACKLOG) or update when it releases a fix.                                                                                                                                                     |
| No second factor and no SSO yet.                                                                                                                 | **Resolved** (part 3): OIDC / Entra ID single sign-on and TOTP two-factor.                                                                                                                                                                                      |
| SSO: Entra ID "group overage" (users in more than 200 groups get no groups claim).                                                               | Roles are left unchanged and the sign-in is audited with `groupsOverage`; reading groups from Microsoft Graph is in BACKLOG.                                                                                                                                    |
| SSO users skip ProcessHub's TOTP (the identity provider is responsible for MFA).                                                                 | **Policy** (D-064): Entra ID Conditional Access requires MFA for the ProcessHub application (request in DEPLOYMENT.md §6.1 step 9; go-live checklist). ProcessHub does not check the `amr` claim (BACKLOG).                                                     |
| Sessions are not ended when a user is disabled in Entra ID (no back-channel logout / SCIM).                                                      | Access tokens live 15 minutes; refresh tokens end after 24 hours without activity (`REFRESH_TOKEN_TTL_HOURS`, D-065), but an active session keeps working. Leaver process: deactivate the user in ProcessHub (immediate). Automatic de-provisioning in BACKLOG. |
| Rate limits and lockout counters are per API instance (in memory).                                                                               | Fine for one instance; Redis storage in BACKLOG before scaling out.                                                                                                                                                                                             |
| Account lockout can be triggered by anyone who knows an email address (denial of service), and `ACCOUNT_LOCKED` reveals that the account exists. | Short lock (15 min), per-IP login limit, audit entries `LOGIN_FAILED` / `LOCKOUT`. SSO will move most users off passwords.                                                                                                                                      |
| CSP allows inline styles (`style-src 'unsafe-inline'`, required by Ant Design).                                                                  | Scripts stay `'self'` only; rich text strips `style` attributes. Revisit with Ant Design's CSS-variables mode.                                                                                                                                                  |
| AI: published or draft content sent to the provider could contain prompt-injection text.                                                         | Answers are text only, only from content the user may read; generated BPMN / pages are validated, sanitised and only saved after a human accepts the preview.                                                                                                   |
| Logs contain recipient email addresses of failed notification emails.                                                                            | Personal data, not secrets; keep log retention short.                                                                                                                                                                                                           |
| TLS and HSTS: the trial stack (`docker-compose.yml`) serves plain HTTP on port 8080.                                                             | **Resolved for production** (part 2): `docker-compose.prod.yml` puts Caddy in front (automatic certificates, http → https, HSTS); see `docs/DEPLOYMENT.md`.                                                                                                     |

## 7. Go-live configuration checklist

With `docker-compose.prod.yml` and `.env.example.prod` (`docs/DEPLOYMENT.md`) the items marked _(prod stack)_ are
already the default; check them anyway if you changed the setup.

- [ ] TLS on the public URL, HSTS on the TLS terminator; `APP_URL` and `CORS_ORIGINS` = the public URL _(prod stack: Caddy, from `DOMAIN`)_.
- [ ] `COOKIE_SECURE=true`; `TRUST_PROXY` = number of proxies in front of the API _(prod stack: `true`, `2`)_.
- [ ] `JWT_ACCESS_SECRET` and `INTEGRATIONS_ENCRYPTION_KEY` set (or generated) and backed up with the database _(prod stack: required, `generate-secrets.sh`; keep `.env` in a vault)_.
- [ ] Change `POSTGRES_PASSWORD`, `MINIO_SECRET_KEY`, `SEED_ADMIN_PASSWORD`; `SEED_DEMO_DATA=false`
      (demo users share one known password); remove the Mailpit service and configure real SMTP.
- [ ] `ENABLE_SWAGGER=false`.
- [ ] `OUTBOUND_ALLOWED_HOSTS` lists only the internal Git / SMTP servers that are really needed.
- [ ] Review Settings → AI (enabled roles, limits, data notice) before enabling the assistant.
- [ ] Settings → Authentication: two-step verification required for **Super Admin and Admin** (the default —
      check it if the settings were saved before part 4); allowed domains limited to company domains; **Update
      roles at every sign-in off** (roles managed in ProcessHub); after the SSO roll-out password sign-in
      **off** with a dedicated break-glass Super Admin created as in DEPLOYMENT.md §6.3 (2FA, password and
      recovery codes in the password manager, tested); `AUTH_FORCE_LOCAL_LOGIN` not set.
- [ ] Entra ID Conditional Access policy "Require MFA – ProcessHub" is **On** (not report-only) and a test
      sign-in asks for the second factor (DEPLOYMENT.md §6.1 step 9).
- [ ] `REFRESH_TOKEN_TTL_HOURS=24` (or the agreed value); no `REFRESH_TOKEN_TTL_DAYS` left in `.env`.
- [ ] Leaver process includes "deactivate in ProcessHub" until automatic de-provisioning exists.
- [ ] Database, file storage and the API are not reachable from outside (only the web container is published) _(prod stack: only Caddy on 80/443; database and storage on an internal network)_.
- [ ] Daily backups with an off-site copy, and one restore tested (`docs/DEPLOYMENT.md` §7–8).

## 8. External penetration test checklist

Accounts to provide: one per role (Super Admin, Admin, Process Owner, Modeler, Reviewer, Auditor, Viewer)
and two users in different departments; a view-restricted space; items in every lifecycle state (the demo
seed provides these).

**Authentication and sessions**

- [ ] Brute force and credential stuffing against `/auth/login` (rate limit, lockout, timing / message
      differences for unknown vs. known accounts).
- [ ] Refresh-token rotation and reuse detection; logout and password change invalidate sessions.
- [ ] JWT tampering (algorithm confusion, `none`, expired tokens, token of a deactivated user).
- [ ] Cookie flags over TLS; session fixation; CSRF on every state-changing route (missing / mismatched
      token, foreign `Origin`, cookie planted from a sub-domain).
- [ ] Two-factor: code brute force (lockout), replay of a used code, reuse of the `ph_mfa` challenge as a
      session, skipping the second step, recovery-code reuse, enrolment without the password.
- [ ] Single sign-on: login CSRF (callback without / with another flow cookie), state / nonce / PKCE
      tampering, ID tokens with a wrong audience, issuer or signature, `returnTo` open redirect, account
      linking / takeover via e-mail claims of another subject or an unverified address, domain allow-list
      bypass, password sign-in when it is turned off.

**Authorisation**

- [ ] Horizontal and vertical access control on every route in §5 (IDOR with ids of other users' items,
      notifications, feedback, comments, review tasks, drafts).
- [ ] Viewer: no draft, in-review, archived or restricted content via portal, search, AI Q&A, attachments,
      Markdown export, version history, comments.
- [ ] Auditor and Reviewer: no create / edit / publish / approve outside their rights; self-approval.
- [ ] Admin cannot gain Super Admin or change integration settings.

**Input handling**

- [ ] Stored XSS: wiki pages (paste, templates, AI-generated pages), page titles, BPMN labels and step
      descriptions, comments with mentions, feedback, portal settings (quick links), SVG logo, file names.
- [ ] BPMN XML: XXE, entity expansion, very large / deeply nested models.
- [ ] Uploads: type confusion (polyglots, wrong extension), oversized files, file-name tricks, direct
      download of an attachment as HTML / SVG.
- [ ] SQL / NoSQL injection in search, filters, sorting and pagination parameters.
- [ ] SSRF via Settings → Integrations (GitLab URL) and Settings → Email (SMTP host): internal IPs, IPv6,
      IPv4-mapped IPv6, decimal / octal IPs, DNS rebinding, redirects.
- [ ] AI features: prompt injection from page content and questions; leakage of other users' data or of
      unpublished content through answers; abuse of usage limits.

**Configuration**

- [ ] Security headers on the SPA, `/assets`, the API and file downloads; CSP bypasses.
- [ ] CORS with arbitrary / `null` origins; HTTP methods; Swagger exposure.
- [ ] Error messages and logs for secrets or stack traces; directory listing; source maps.
- [ ] Denial of service: large JSON bodies, AI streaming connections, search with many terms.
- [ ] Container and network exposure (database, file storage, Mailpit ports), default credentials.
