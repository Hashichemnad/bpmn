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

| ID     | Area (OWASP)                | Finding                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | Severity | Status                                                                                                                                                                       |
| ------ | --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| SEC-01 | SSRF (A10)                  | The Git integration (GitLab / GitHub Enterprise URL) and SMTP host could point at internal addresses — loopback, private networks, the cloud metadata service — giving an administrator account a way into the internal network.                                                                                                                                                                                                                                                                                                                                                                                                                    | Medium   | **Fixed.** `src/common/outbound.ts`: internal ranges blocked unless the host is in `OUTBOUND_ALLOWED_HOSTS`; the checked address is the one connected to (no DNS rebinding). |
| SEC-02 | Transport of secrets (A02)  | A Git token could be sent to a plain `http://` URL.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | Low      | **Fixed.** Plain HTTP only for hosts in `OUTBOUND_ALLOWED_HOSTS`.                                                                                                            |
| SEC-03 | CSRF (A01)                  | Double-submit cookie only: a sibling sub-domain able to set cookies for the parent domain ("cookie tossing") could plant a known CSRF token.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | Low      | **Fixed.** `CsrfGuard` also requires `Origin` (when sent) to be in `CORS_ORIGINS` or the request's own host, and rejects `Sec-Fetch-Site: cross-site` without `Origin`.      |
| SEC-04 | Security headers (A05)      | nginx `add_header` is not inherited by a `location` that sets its own headers: `/` and `/assets/` lacked `Permissions-Policy`, `/assets/` also the CSP and frame options.                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | Low      | **Fixed.** One snippet (`apps/web/nginx-security-headers.conf`) included in every location; adds `Cross-Origin-Opener-Policy`.                                               |
| SEC-05 | Crypto (A02)                | `SecretBox.decrypt` accepted truncated AES-GCM tags (Node accepts 4–16 bytes unless the length is fixed), weakening integrity of stored secrets.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | Low      | **Fixed.** Full 16-byte tag required (`authTagLength`).                                                                                                                      |
| SEC-06 | XSS / privacy (A03)         | Sanitised SVG logos kept external CSS references (`@import`, `url(https://…)`); the logo response had no `sandbox`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | Low      | **Fixed.** External references removed; `sandbox` added to the logo CSP.                                                                                                     |
| SEC-07 | Vulnerable components (A06) | `react-router` 6 (open redirect, constructor injection), `vitest` 3 (dev server path traversal), `js-yaml` 5.3 (CPU exhaustion, via Swagger).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | Moderate | **Fixed.** `react-router-dom` 7.18, `vitest` 4.1, `js-yaml` ≥ 5.4.1 (override).                                                                                              |
| SEC-08 | Vulnerable components (A06) | `braces` (high, ReDoS/stack exhaustion) via Jest; no fixed version exists. Dev-only, but the API runtime image currently contains dev dependencies.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | Low      | **Accepted** (D-054); follow-up: Jest → Vitest (BACKLOG).                                                                                                                    |
| SEC-09 | Vulnerable components (A06) | MinIO client pulls `stream-json` 1.x (moderate) and `decode-uri-component` 0.2 (advisory GHSA-qr28-fpjm-wq7f raised to high in 2026; **fixed in Phase 4.1** with a pnpm override to 0.5.1 — MinIO only calls `query-string.stringify`, the patched ESM release loads through Node's `require(esm)` and is compiled for Jest). The vulnerable code (stream-json filters/JSONC/Assembler, decoding of crafted URIs) is not on any path ProcessHub uses. `exceljs` (reports, D-087) pulls `uuid` 8 (moderate GHSA-w5hq-g745-h8pq: missing bounds check when a caller passes an output buffer to v3/v5/v6); exceljs only calls `v4()` without a buffer. | Low      | Accepted, tracked in BACKLOG (replace when MinIO updates).                                                                                                                   |

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
- Images (final session, D-169): the web container runs as an unprivileged user (`nginx-unprivileged`, uid 101,
  port 8080); the API runs as `node` with production dependencies only — no compiler, no Prisma CLI, no dev
  tools; schema changes only through the one-shot `migrate` image. Precompressed assets carry the same
  security headers (one snippet in every location, including the Brotli locations).

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
- **Final session decisions (D-165, D-166):** besides the 24-hour idle limit every session ends **7 days after
  sign-in** however active (`SESSION_MAX_HOURS`, default 168; the sign-in time is stored per refresh-token
  family, rotated tokens and access tokens never outlive it; a refresh past the limit revokes the family).
  Settings → Authentication → **Require MFA from the identity provider** (default off) refuses SSO sign-ins
  whose ID token has no `mfa` in the `amr` claim (`SSO_MFA_REQUIRED`, bilingual message, audited with the
  `amr` values received; checked before any account is created or linked).

**A08 Software and data integrity** — lockfile with `--frozen-lockfile` in the images, pnpm build-script
allow-list (`onlyBuiltDependencies`), GCM-authenticated secrets.

**A09 Logging and monitoring** — audit log for every create / update / delete / publish / login / failed
login / lockout / settings change / AI call; logs contain no secrets (tested).

**A10 SSRF** — see SEC-01. The AI provider address is not configurable in the UI (only `ANTHROPIC_BASE_URL`
in the environment); the file storage and the database come from the environment.

**Import uploads (Import tools / M15, D-157)** — every file of an Import Center batch goes through
`apps/api/src/imports/safe-upload.ts` (unit tests with malicious samples in `safe-upload.spec.ts`, API tests in
`test/imports*.e2e-spec.ts`):

- **Type by content, not only the extension:** magic bytes (ZIP, PDF, OLE, images), XML root and UTF-8 / UTF-16
  text are sniffed and must agree with the extension, which must be one the import kind accepts (an
  executable renamed `.bpmn` or a ZIP renamed `.pdf` is refused with `FILE_TYPE_MISMATCH`). Old binary Office
  and Visio files (`.doc`, `.xls`, `.vsd`) are refused with a message to save them as Office Open XML.
- **Size and count limits:** 100 MB per file, 200 MB and 50 files per batch, 5,000 rows / preview items.
- **ZIP archives** are checked from the central directory **before** anything is decompressed: at most 2,000
  entries, 200 MB declared uncompressed in total, compression ratio ≤ 100:1 per entry larger than 1 MB (zip
  bomb), encrypted entries refused, and any entry with an absolute path, a drive letter, a `..` segment, a NUL
  byte or a symbolic-link mode refused (**ZIP-slip / path traversal** — entries are also never written to
  disk). While decompressing, an entry that grows beyond its declared size or the archive budget is stopped
  (lying headers).
- **XML without DTDs:** `<!DOCTYPE` / `<!ENTITY` are refused before parsing (no **XXE**, no "billion laughs");
  jsdom's XML parser never loads external resources.
- **Macros are never accepted or run:** `.docm`, `.xlsm`, `.dotm`, `.pptm` … are refused, and so is any Office
  package that contains `vbaProject.bin` / `vbaData.xml` or a macro-enabled content type (a renamed `.xlsm`).
- **HTML and SVG:** imported HTML (Word, Confluence, Markdown) goes through the wiki's DOMPurify rules
  (`sanitizeRichText`); SVG through the existing SVG sanitiser; images only as attachments with sniffed types.
- **Storage:** uploads are stored in S3 storage under `imports/<batch>/<file>` with their SHA-256 (checked when
  the job reads them again), served back only as `application/octet-stream` downloads with `nosniff`, and never
  executed. Antivirus scanning (ClamAV) is part of the final security review (BACKLOG, D-164).
- **Imported users have no password:** while password sign-in is allowed they get a set-password
  **invitation** (random 256-bit token, only its SHA-256 stored, single use, 7 days, public endpoints
  `/auth/invitations/*` with the login rate limit and the password policy). Once SSO is live and password
  sign-in is off (D-164) no invitation is sent: users get a **welcome e-mail with the "Sign in with Microsoft"
  link** (no token, nothing to set) or no e-mail at all (Import settings → "Welcome e-mail"); they sign in with
  SSO (linked by e-mail). Password invitations remain only for accounts allowed to use passwords (break-glass
  and exceptions, while password sign-in is on). An import never creates or changes Super Admins,
  the break-glass account or the importing user's own account; roles that require 2FA are flagged and enrol
  at the first sign-in; roles are only added, never removed.
- **PDF** text is extracted by pdf.js in a separate worker thread (memory limit, 30 s timeout, `eval` off).
- **Full export package** (`/repository-export`, `export.full` — Super Admin only) contains no password hashes,
  2FA secrets, SSO links or integration / e-mail / AI secrets; a **restore** checks the SHA-256 of every data
  file against the manifest and only runs into an empty installation; restored users have no password.
- **AI on imported documents** (D-164) is a **separate setting, "Allow AI on imported documents", off by
  default and independent of the general AI switch**: the text of imported documents leaves the UAE (external
  AI provider), so it needs **DOF approval** before it is turned on (Super Admin, `settings.manage`, audited).
  When it is on, each run asks the admin to confirm that the text is sent to the external provider
  (`confirmExternal`, refused without it; the audit entry records the confirmation); the server checks the
  setting again before every item. Role, daily and monthly limits of the AI settings apply; usage and audit
  logged, prompts not stored; results are proposals that a person accepts.
- **Access:** `import.manage` (Admins, Super Admins); module register kinds also need the module's own edit
  permission; the full export package and restore are Super Admin only (`export.full`). **Process Owners**
  (`import.own`, D-164) import only diagrams (BPMN, Visio) and documents (Word, PDF, Confluence, Markdown):
  into processes they own (another owner's process is an error), new processes only under one of their own
  processes and owned by them, pages only into spaces they can edit; they see, apply and undo only their own
  batches (others' batches answer 404). Structure, users, library objects, GRC and KPI imports, AI migration
  and the migration bulk actions stay with Admins. Every batch step is audited
  (`CREATE`, `IMPORT`, `UNDO`, `EXPORT`, and each created / updated entity with the batch number).

### Integrations and exports (Phase 4.4, D-172 – D-179)

New attack surface and its controls:

- **Public REST API** (`/api/public/v1`, D-173): read-only, its own prefix and guard. Only API keys
  authenticate (`X-API-Key` / `Authorization: Bearer`), session cookies are ignored there (no CSRF surface) and
  keys are never accepted on `/api/v1`. Keys carry 256 random bits; only a SHA-256 hash and a 12-character id
  are stored, compared in constant time; the full key is shown once. Every key has an owner (deactivated owner
  → key refused), an expiry (≤ `integrations.api.maxKeyDays`), optional IP / CIDR allow-list, a per-key rate
  limit, read-only scopes (one per endpoint; `route-security.e2e-spec.ts` lists every public route with its
  scope) and a content filter (published by default; drafts only for workspace keys) plus department filter;
  view-restricted wiki spaces are never served; case-level workflow data needs its own scope. Every call of a
  known key — refused ones included — is logged (route template, status, duration, address; no ids or query
  strings), kept 90 days; key create / change / rotate / revoke audited without the secret. JSON body limit
  16 KB; ETag / Last-Modified; the OpenAPI document `/api/public/docs` is off in production unless
  `ENABLE_PUBLIC_API_DOCS=true`.
- **Webhooks and Teams** (D-174, D-176): Super Admins only; URLs and signing secrets encrypted at rest
  (AES-256-GCM), URLs shown without query string. **SSRF:** HTTPS only, no credentials in URLs, Teams limited
  to Power Automate hosts, optional allow-list for webhooks, every resolved address must be public (loopback,
  private, link-local / cloud metadata, CGNAT, NAT64, IPv4-mapped and -compatible IPv6 refused; `::/96` added to
  the shared block list) — checked when saving and before every delivery; the sender connects to the checked
  address (no DNS rebinding), never follows redirects, 10 s timeout, 64 KB response limit. Only hosts in
  `OUTBOUND_ALLOWED_HOSTS` may be internal or plain http (test receivers). Payloads carry ids, names, links and
  a few facts — never form data, descriptions or secrets; HMAC-SHA256 signature over timestamp + body (replay
  window enforced by receivers, sample in `docs/integrations/WEBHOOKS.md`). Persisted retries with backoff,
  switch-off after 10 failed attempts with a notification; delivery log 30 days. Teams card texts are cleaned
  (control / bidi characters removed, Markdown links broken up; only ProcessHub links become buttons).
- **Reporting feed** (D-175): same key rules (scope `reporting:read`); workflow tables aggregated without names.
- **Renderer** (D-172): headless Chromium in its own container on an internal network (no internet, nothing
  published), shared token, read-only file system, no capabilities, `no-new-privileges`, memory / CPU / PID
  limits; every browser request is intercepted (only the bundle's own files are served, all else aborted, proxy
  to a closed port); PDFs are printed with `script-src 'none'`; per-render timeout and size limits. Chromium
  runs with **its own sandbox** when the host allows it (D-181): the seccomp profile
  `deploy/renderer-seccomp.json` adds the namespace calls the sandbox needs without any capability, the user is
  the unprivileged `node`. `RENDERER_SANDBOX=auto` (default) falls back to `--no-sandbox` with a warning where
  the host blocks user namespaces (accepted risk, §6); `on` requires the sandbox; `/health` reports the state.
  The content it draws is ProcessHub's own (BPMN / diagram JSON drawn by bpmn-js, report HTML built and
  escaped by the API).
- **Demo installations** (D-180): no fixed demo secret. The demo API key is random, shown once in the seed
  output and created only with `SEED_DEMO_DATA=true`; Admins and Super Admins see a warning banner while demo
  content, a demo user or a demo key remains, until a Super Admin confirms the removal (audited).
- **Exports** (D-177, D-178): same visibility as the screens (published by default; drafts only with workspace
  access, watermarked); offline HTML pages forbid every network request (CSP `default-src 'none'`), all text is
  escaped, wiki HTML re-sanitised, images embedded as `data:` (SVG sanitised); PowerPoint text is plain text.
  Audited (`EXPORT`).
- **Scheduled report e-mails** (D-179): built with each **recipient's** permissions at send time (no permission
  → nothing sent); role / department audiences only by Admins; by default the e-mail holds a summary and a
  secure link (sign-in as the recipient, 30 days), attachments only when Settings allow them; unsubscribe tokens
  are HMACs (`JWT_ACCESS_SECRET`), the public endpoint has the login rate limit.

## 4. Rate limits

| Scope                                                                                 | Limit (default)                                     | Setting                                                |
| ------------------------------------------------------------------------------------- | --------------------------------------------------- | ------------------------------------------------------ |
| Every endpoint, per client IP                                                         | 300 requests / 60 s                                 | `RATE_LIMIT_MAX`, `RATE_LIMIT_TTL_SECONDS`             |
| Login, 2FA steps, SSO start / callback, token refresh, change password, per client IP | 10 requests / 60 s                                  | `LOGIN_RATE_LIMIT_MAX`                                 |
| Failed logins per account (wrong password or 2FA code)                                | lock for 15 min after 5 failures                    | `LOGIN_MAX_ATTEMPTS`, `LOGIN_LOCKOUT_MINUTES`          |
| AI features                                                                           | per-user daily and organisation monthly requests    | Settings → AI                                          |
| Request bodies                                                                        | JSON 6 MB, forms 100 KB, attachments / logo by type | `BODY_LIMIT`, `ATTACHMENT_MAX_BYTES`, `LOGO_MAX_BYTES` |
| Public API, per API key (Phase 4.4)                                                   | 120 requests / minute (per key, up to 2,000)        | API key → Rate limit                                   |
| Public API request bodies                                                             | JSON 16 KB                                          | —                                                      |
| Unsubscribe link of report e-mails, per client IP                                     | as login                                            | `LOGIN_RATE_LIMIT_MAX`                                 |

Client IPs come from `X-Forwarded-For` with `TRUST_PROXY` hops — set it to the number of proxies in front
of the API, or clients can spoof their IP and evade per-IP limits.

## 5. Endpoints and their guards

"Access" is the router guard. Where it is a read permission or "authenticated" on a route that changes
data, the service checks the item (see §3 A01) — the authorisation matrix test proves read-only roles
cannot change anything through any route. "Validated input" lists the request parts that pass through a
zod / UUID pipe; file uploads are checked in the service (allow-list, content sniffing, size). Rate limit
"default" / "login" refer to §4.

<!-- route-table:start -->

| Method | Path (under `/api/v1` unless shown)                        | Access (server guard)                                          | Validated input                      | Rate limit |
| ------ | ---------------------------------------------------------- | -------------------------------------------------------------- | ------------------------------------ | ---------- |
| POST   | `/ai/analyse`                                              | authenticated                                                  | body                                 | default    |
| POST   | `/ai/control-gaps`                                         | authenticated                                                  | body                                 | default    |
| POST   | `/ai/doc-to-process`                                       | authenticated                                                  | body                                 | default    |
| POST   | `/ai/generate-doc`                                         | authenticated                                                  | body                                 | default    |
| POST   | `/ai/generate-process`                                     | authenticated                                                  | body                                 | default    |
| POST   | `/ai/portal/ask`                                           | authenticated                                                  | body                                 | default    |
| POST   | `/ai/refine-process`                                       | authenticated                                                  | body                                 | default    |
| GET    | `/ai/settings`                                             | `settings.manage`                                              | —                                    | default    |
| PUT    | `/ai/settings`                                             | `settings.manage`                                              | body                                 | default    |
| POST   | `/ai/settings/test`                                        | `settings.manage`                                              | body                                 | default    |
| GET    | `/ai/status`                                               | authenticated                                                  | —                                    | default    |
| POST   | `/ai/summarise`                                            | authenticated                                                  | body                                 | default    |
| POST   | `/ai/translate`                                            | authenticated                                                  | body                                 | default    |
| GET    | `/ai/usage`                                                | `ai.usage.read`                                                | query                                | default    |
| GET    | `/api/public/v1/applications`                              | API key, scope `ea:read`                                       | query                                | default    |
| GET    | `/api/public/v1/capabilities`                              | API key, scope `ea:read`                                       | query                                | default    |
| GET    | `/api/public/v1/controls`                                  | API key, scope `grc:read`                                      | query                                | default    |
| GET    | `/api/public/v1/diagrams`                                  | API key, scope `diagrams:read`                                 | query                                | default    |
| GET    | `/api/public/v1/diagrams/:id`                              | API key, scope `diagrams:read`                                 | param `id`                           | default    |
| GET    | `/api/public/v1/diagrams/:id/svg`                          | API key, scope `diagrams:read`                                 | param `id`, query                    | default    |
| GET    | `/api/public/v1/kpis`                                      | API key, scope `kpis:read`                                     | query                                | default    |
| GET    | `/api/public/v1/kpis/:id/measurements`                     | API key, scope `kpis:read`                                     | param `id`, query                    | default    |
| GET    | `/api/public/v1/me`                                        | API key, scope `any`                                           | —                                    | default    |
| GET    | `/api/public/v1/objects`                                   | API key, scope `objects:read`                                  | query                                | default    |
| GET    | `/api/public/v1/pages`                                     | API key, scope `pages:read`                                    | query                                | default    |
| GET    | `/api/public/v1/pages/:id`                                 | API key, scope `pages:read`                                    | param `id`, query                    | default    |
| GET    | `/api/public/v1/process-house`                             | API key, scope `processes:read`                                | —                                    | default    |
| GET    | `/api/public/v1/processes`                                 | API key, scope `processes:read`                                | query                                | default    |
| GET    | `/api/public/v1/processes/:id`                             | API key, scope `processes:read`                                | param `id`                           | default    |
| GET    | `/api/public/v1/processes/:id/bpmn`                        | API key, scope `processes:read`                                | param `id`, query                    | default    |
| GET    | `/api/public/v1/processes/:id/svg`                         | API key, scope `processes:read`                                | param `id`, query                    | default    |
| GET    | `/api/public/v1/processes/:id/versions`                    | API key, scope `processes:read`                                | param `id`                           | default    |
| GET    | `/api/public/v1/reporting`                                 | API key, scope `reporting:read`                                | —                                    | default    |
| GET    | `/api/public/v1/reporting/:table`                          | API key, scope `reporting:read`                                | param `table`, query                 | default    |
| GET    | `/api/public/v1/requirements`                              | API key, scope `grc:read`                                      | query                                | default    |
| GET    | `/api/public/v1/risks`                                     | API key, scope `grc:read`                                      | query                                | default    |
| GET    | `/api/public/v1/spaces`                                    | API key, scope `pages:read`                                    | query                                | default    |
| GET    | `/api/public/v1/workflow/cases`                            | API key, scope `workflow:cases:read`                           | query                                | default    |
| GET    | `/api/public/v1/workflow/statistics`                       | API key, scope `workflow:read`                                 | —                                    | default    |
| GET    | `/assurance/dashboard`                                     | any of `grc.read`, `audit.manage`, `issues.manage`             | query                                | default    |
| GET    | `/assurance/dashboard/export`                              | any of `grc.read`, `audit.manage`, `issues.manage`             | query                                | default    |
| DELETE | `/assurance/files/:id`                                     | authenticated                                                  | param `id`                           | default    |
| GET    | `/assurance/files/:id`                                     | authenticated                                                  | param `id`                           | default    |
| GET    | `/assurance/settings`                                      | any of `grc.read`, `issues.manage`, `audit.manage`             | —                                    | default    |
| PUT    | `/assurance/settings`                                      | `grc.admin`                                                    | body                                 | default    |
| GET    | `/assurance/tasks`                                         | authenticated                                                  | —                                    | default    |
| DELETE | `/attachments/:id`                                         | `docs.read` + `docs.edit`                                      | param `id`                           | default    |
| GET    | `/attachments/:id/content`                                 | `docs.read`                                                    | param `id`                           | default    |
| GET    | `/audit-logs`                                              | `audit.read`                                                   | query                                | default    |
| GET    | `/audits`                                                  | any of `audit.manage`, `grc.edit`, `audit.read`                | query                                | default    |
| POST   | `/audits`                                                  | `audit.manage`                                                 | body                                 | default    |
| DELETE | `/audits/:id`                                              | `audit.manage`                                                 | param `id`                           | default    |
| GET    | `/audits/:id`                                              | any of `audit.manage`, `grc.edit`, `audit.read`                | param `id`                           | default    |
| PATCH  | `/audits/:id`                                              | `audit.manage`                                                 | body, param `id`                     | default    |
| POST   | `/audits/:id/comments`                                     | `audit.manage`                                                 | body, param `id`                     | default    |
| POST   | `/audits/:id/findings`                                     | `audit.manage`                                                 | body, param `id`                     | default    |
| POST   | `/audits/:id/items`                                        | `audit.manage`                                                 | body, param `id`                     | default    |
| GET    | `/audits/:id/report`                                       | any of `audit.manage`, `grc.edit`, `audit.read`                | param `id`, query                    | default    |
| POST   | `/audits/:id/status`                                       | `audit.manage`                                                 | body, param `id`                     | default    |
| DELETE | `/audits/findings/:id`                                     | `audit.manage`                                                 | param `id`                           | default    |
| GET    | `/audits/findings/:id`                                     | authenticated                                                  | param `id`                           | default    |
| PATCH  | `/audits/findings/:id`                                     | `audit.manage`                                                 | body, param `id`                     | default    |
| POST   | `/audits/findings/:id/files`                               | `audit.manage`                                                 | file, param `id`                     | default    |
| POST   | `/audits/findings/:id/response`                            | authenticated                                                  | body, param `id`                     | default    |
| DELETE | `/audits/items/:id`                                        | `audit.manage`                                                 | param `id`                           | default    |
| PATCH  | `/audits/items/:id`                                        | `audit.manage`                                                 | body, param `id`                     | default    |
| POST   | `/audits/items/:id/files`                                  | `audit.manage`                                                 | file, param `id`                     | default    |
| GET    | `/audits/universe`                                         | any of `audit.manage`, `grc.edit`, `audit.read`                | query                                | default    |
| POST   | `/auth/change-password`                                    | authenticated                                                  | body                                 | login      |
| GET    | `/auth/csrf`                                               | **public**                                                     | —                                    | default    |
| GET    | `/auth/invitations/:token`                                 | **public**                                                     | param `token`                        | login      |
| POST   | `/auth/invitations/accept`                                 | **public**                                                     | body                                 | login      |
| POST   | `/auth/login`                                              | **public**                                                     | body                                 | login      |
| POST   | `/auth/login/mfa`                                          | **public**                                                     | body                                 | login      |
| POST   | `/auth/login/mfa/setup`                                    | **public**                                                     | —                                    | login      |
| POST   | `/auth/login/mfa/setup/confirm`                            | **public**                                                     | body                                 | login      |
| POST   | `/auth/logout`                                             | **public**                                                     | —                                    | default    |
| GET    | `/auth/me`                                                 | authenticated                                                  | —                                    | default    |
| PATCH  | `/auth/me`                                                 | authenticated                                                  | body                                 | default    |
| GET    | `/auth/mfa`                                                | authenticated                                                  | —                                    | default    |
| POST   | `/auth/mfa/disable`                                        | authenticated                                                  | body                                 | login      |
| POST   | `/auth/mfa/enable`                                         | authenticated                                                  | body                                 | login      |
| POST   | `/auth/mfa/recovery-codes`                                 | authenticated                                                  | body                                 | login      |
| POST   | `/auth/mfa/setup`                                          | authenticated                                                  | body                                 | login      |
| GET    | `/auth/options`                                            | **public**                                                     | —                                    | default    |
| POST   | `/auth/refresh`                                            | **public**                                                     | —                                    | login      |
| POST   | `/auth/sessions/revoke-all`                                | authenticated                                                  | —                                    | default    |
| GET    | `/auth/sso/callback`                                       | **public**                                                     | query                                | login      |
| GET    | `/auth/sso/start`                                          | **public**                                                     | query                                | login      |
| DELETE | `/comments/:commentId`                                     | `comments.write`                                               | param `commentId`                    | default    |
| PATCH  | `/comments/:commentId`                                     | `comments.write`                                               | body, param `commentId`              | default    |
| POST   | `/comments/:commentId/reopen`                              | `comments.write`                                               | param `commentId`                    | default    |
| POST   | `/comments/:commentId/resolve`                             | `comments.write`                                               | param `commentId`                    | default    |
| GET    | `/comments/:type/:id`                                      | any of `processes.read`, `docs.read`                           | param `id`, param `type`             | default    |
| POST   | `/comments/:type/:id`                                      | `comments.write`                                               | body, param `id`, param `type`       | default    |
| GET    | `/control-tests`                                           | `grc.read`                                                     | query                                | default    |
| POST   | `/control-tests`                                           | `grc.edit`                                                     | body                                 | default    |
| DELETE | `/control-tests/:id`                                       | `grc.edit`                                                     | param `id`                           | default    |
| GET    | `/control-tests/:id`                                       | any of `grc.read`, `controls.test`, `controls.review`          | param `id`                           | default    |
| POST   | `/control-tests/:id/close`                                 | any of `grc.edit`, `controls.review`                           | param `id`                           | default    |
| POST   | `/control-tests/:id/comments`                              | any of `grc.read`, `controls.test`, `controls.review`          | body, param `id`                     | default    |
| POST   | `/control-tests/:id/files`                                 | `controls.test`                                                | file, param `id`                     | default    |
| PUT    | `/control-tests/:id/results`                               | `controls.test`                                                | body, param `id`                     | default    |
| POST   | `/control-tests/:id/review`                                | `controls.review`                                              | body, param `id`                     | default    |
| POST   | `/control-tests/:id/start`                                 | `controls.test`                                                | param `id`                           | default    |
| POST   | `/control-tests/:id/submit`                                | `controls.test`                                                | param `id`                           | default    |
| GET    | `/control-tests/plans`                                     | `grc.read`                                                     | query                                | default    |
| POST   | `/control-tests/plans`                                     | `grc.edit`                                                     | body                                 | default    |
| DELETE | `/control-tests/plans/:id`                                 | `grc.edit`                                                     | param `id`                           | default    |
| PATCH  | `/control-tests/plans/:id`                                 | `grc.edit`                                                     | body, param `id`                     | default    |
| GET    | `/departments`                                             | `departments.read`                                             | —                                    | default    |
| POST   | `/departments`                                             | `departments.manage`                                           | body                                 | default    |
| DELETE | `/departments/:id`                                         | `departments.manage`                                           | param `id`                           | default    |
| PATCH  | `/departments/:id`                                         | `departments.manage`                                           | body, param `id`                     | default    |
| GET    | `/diagrams`                                                | `processes.read`                                               | query                                | default    |
| POST   | `/diagrams`                                                | `processes.create`                                             | body                                 | default    |
| DELETE | `/diagrams/:id`                                            | `processes.delete`                                             | param `id`                           | default    |
| GET    | `/diagrams/:id`                                            | `processes.read`                                               | param `id`                           | default    |
| PATCH  | `/diagrams/:id`                                            | any of `processes.edit`, `processes.edit_own`                  | body, param `id`                     | default    |
| GET    | `/diagrams/:id/content`                                    | `processes.read`                                               | param `id`                           | default    |
| PUT    | `/diagrams/:id/content`                                    | any of `models.edit`, `models.edit_own`                        | body, param `id`                     | default    |
| POST   | `/diagrams/:id/convert-to-bpmn`                            | `processes.create`                                             | body, param `id`                     | default    |
| GET    | `/diagrams/:id/links`                                      | `processes.read`                                               | param `id`                           | default    |
| POST   | `/diagrams/:id/links`                                      | any of `models.edit`, `models.edit_own`, `grc.edit`            | body, param `id`                     | default    |
| DELETE | `/diagrams/:id/links/:linkId`                              | any of `models.edit`, `models.edit_own`, `grc.edit`            | param `id`, param `linkId`           | default    |
| GET    | `/diagrams/:id/versions`                                   | `processes.read`                                               | param `id`                           | default    |
| POST   | `/diagrams/:id/versions`                                   | any of `models.edit`, `models.edit_own`                        | body, param `id`                     | default    |
| GET    | `/diagrams/:id/versions/:versionId`                        | `processes.read`                                               | param `id`, param `versionId`        | default    |
| PATCH  | `/diagrams/:id/versions/:versionId`                        | any of `models.edit`, `models.edit_own`                        | body, param `id`, param `versionId`  | default    |
| POST   | `/diagrams/:id/versions/:versionId/restore`                | any of `models.edit`, `models.edit_own`                        | body, param `id`, param `versionId`  | default    |
| GET    | `/diagrams/all`                                            | `processes.read`                                               | —                                    | default    |
| GET    | `/diagrams/org-source`                                     | `processes.read`                                               | —                                    | default    |
| GET    | `/diagrams/process-facts`                                  | `processes.read`                                               | query                                | default    |
| GET    | `/diagrams/role-activities/:roleId`                        | `processes.read`                                               | param `roleId`                       | default    |
| GET    | `/diagrams/where-used`                                     | `processes.read`                                               | query                                | default    |
| POST   | `/dictionary/objects/:id/rename`                           | `objects.read` + `processes.read`                              | body, param `id`                     | default    |
| POST   | `/dictionary/objects/:id/rename-preview`                   | `objects.read` + `processes.read`                              | body, param `id`                     | default    |
| GET    | `/dictionary/suggest`                                      | `objects.read`                                                 | query                                | default    |
| POST   | `/dictionary/terms`                                        | `dictionary.propose`                                           | body                                 | default    |
| PATCH  | `/dictionary/terms/:id`                                    | `dictionary.propose`                                           | body, param `id`                     | default    |
| POST   | `/dictionary/terms/:id/approve`                            | `dictionary.approve`                                           | param `id`                           | default    |
| POST   | `/dictionary/terms/:id/reject`                             | `dictionary.approve`                                           | body, param `id`                     | default    |
| GET    | `/ea/applications`                                         | `ea.read`                                                      | query                                | default    |
| POST   | `/ea/applications`                                         | `ea.edit`                                                      | body                                 | default    |
| DELETE | `/ea/applications/:id`                                     | `ea.admin`                                                     | param `id`                           | default    |
| GET    | `/ea/applications/:id`                                     | `ea.read`                                                      | param `id`                           | default    |
| PATCH  | `/ea/applications/:id`                                     | `ea.edit`                                                      | body, param `id`                     | default    |
| GET    | `/ea/applications/:id/impact`                              | `ea.read`                                                      | param `id`                           | default    |
| GET    | `/ea/applications/:id/impact/export`                       | `ea.read`                                                      | param `id`, query                    | default    |
| GET    | `/ea/capabilities`                                         | `ea.read`                                                      | —                                    | default    |
| POST   | `/ea/capabilities`                                         | `ea.edit`                                                      | body                                 | default    |
| DELETE | `/ea/capabilities/:id`                                     | `ea.admin`                                                     | param `id`                           | default    |
| GET    | `/ea/capabilities/:id`                                     | `ea.read`                                                      | param `id`                           | default    |
| PATCH  | `/ea/capabilities/:id`                                     | `ea.edit`                                                      | body, param `id`                     | default    |
| GET    | `/ea/capability-map`                                       | `ea.read`                                                      | —                                    | default    |
| GET    | `/ea/data-objects`                                         | `ea.read`                                                      | query                                | default    |
| POST   | `/ea/data-objects`                                         | `ea.edit`                                                      | body                                 | default    |
| DELETE | `/ea/data-objects/:id`                                     | `ea.admin`                                                     | param `id`                           | default    |
| GET    | `/ea/data-objects/:id`                                     | `ea.read`                                                      | param `id`                           | default    |
| PATCH  | `/ea/data-objects/:id`                                     | `ea.edit`                                                      | body, param `id`                     | default    |
| GET    | `/ea/export/:kind`                                         | `ea.read`                                                      | param `kind`, query                  | default    |
| POST   | `/ea/import/:kind`                                         | `ea.edit`                                                      | file, param `kind`, query            | default    |
| GET    | `/ea/interfaces`                                           | `ea.read`                                                      | query                                | default    |
| POST   | `/ea/interfaces`                                           | `ea.edit`                                                      | body                                 | default    |
| DELETE | `/ea/interfaces/:id`                                       | `ea.admin`                                                     | param `id`                           | default    |
| GET    | `/ea/interfaces/:id`                                       | `ea.read`                                                      | param `id`                           | default    |
| PATCH  | `/ea/interfaces/:id`                                       | `ea.edit`                                                      | body, param `id`                     | default    |
| GET    | `/ea/landscape`                                            | `ea.read`                                                      | query                                | default    |
| GET    | `/ea/template/:kind`                                       | `ea.edit`                                                      | param `kind`, query                  | default    |
| GET    | `/ea/trace`                                                | `ea.read`                                                      | query                                | default    |
| GET    | `/ea/trace/export`                                         | `ea.read`                                                      | query                                | default    |
| POST   | `/exports/html`                                            | any of `processes.read`, `portal.read`                         | body                                 | default    |
| POST   | `/exports/pptx`                                            | any of `processes.read`, `portal.read`, `kpi.read`, `grc.read` | body                                 | default    |
| GET    | `/exports/template`                                        | `settings.manage`                                              | —                                    | default    |
| PUT    | `/exports/template`                                        | `settings.manage`                                              | body                                 | default    |
| GET    | `/feedback`                                                | authenticated                                                  | query                                | default    |
| POST   | `/feedback`                                                | `portal.read`                                                  | body                                 | default    |
| PATCH  | `/feedback/:id`                                            | authenticated                                                  | body, param `id`                     | default    |
| GET    | `/governance/:type/:id`                                    | any of `processes.read`, `docs.read`                           | param `id`, param `type`             | default    |
| PATCH  | `/governance/:type/:id`                                    | any of `processes.read`, `docs.read`                           | body, param `id`, param `type`       | default    |
| POST   | `/governance/:type/:id/archive`                            | any of `processes.read`, `docs.read`                           | body, param `id`, param `type`       | default    |
| POST   | `/governance/:type/:id/confirm-review`                     | any of `processes.read`, `docs.read`                           | param `id`, param `type`             | default    |
| GET    | `/governance/:type/:id/publications`                       | any of `processes.read`, `docs.read`                           | param `id`, param `type`             | default    |
| POST   | `/governance/:type/:id/publish`                            | any of `processes.read`, `docs.read`                           | body, param `id`, param `type`       | default    |
| POST   | `/governance/:type/:id/restore`                            | any of `processes.read`, `docs.read`                           | param `id`, param `type`             | default    |
| GET    | `/governance/:type/:id/reviews`                            | any of `processes.read`, `docs.read`                           | param `id`, param `type`             | default    |
| POST   | `/governance/:type/:id/submit`                             | any of `processes.read`, `docs.read`                           | body, param `id`, param `type`       | default    |
| POST   | `/governance/:type/:id/withdraw`                           | any of `processes.read`, `docs.read`                           | param `id`, param `type`             | default    |
| GET    | `/governance/dashboard`                                    | `governance.dashboard`                                         | —                                    | default    |
| POST   | `/governance/reminders/run`                                | `governance.manage`                                            | —                                    | default    |
| GET    | `/governance/settings`                                     | any of `governance.manage`, `processes.read`, `docs.read`      | —                                    | default    |
| PUT    | `/governance/settings`                                     | `governance.manage`                                            | body                                 | default    |
| PUT    | `/governance/spaces/:spaceId/workflow`                     | any of `governance.manage`, `docs.read`                        | body, param `spaceId`                | default    |
| GET    | `/grc/changes`                                             | `grc.read`                                                     | query                                | default    |
| GET    | `/grc/changes/:id`                                         | `grc.read`                                                     | param `id`                           | default    |
| POST   | `/grc/changes/:id/decision`                                | `grc.read` + `reviews.decide`                                  | body, param `id`                     | default    |
| POST   | `/grc/changes/:id/withdraw`                                | `grc.edit`                                                     | param `id`                           | default    |
| POST   | `/grc/changes/batches/:batchId/decision`                   | `grc.read` + `reviews.decide`                                  | body, param `batchId`                | default    |
| GET    | `/grc/controls`                                            | `grc.read`                                                     | query                                | default    |
| POST   | `/grc/controls`                                            | any of `grc.edit`, `grc.propose`                               | body                                 | default    |
| DELETE | `/grc/controls/:id`                                        | any of `grc.edit`, `grc.propose`                               | param `id`                           | default    |
| GET    | `/grc/controls/:id`                                        | `grc.read`                                                     | param `id`                           | default    |
| PATCH  | `/grc/controls/:id`                                        | any of `grc.edit`, `grc.propose`                               | body, param `id`                     | default    |
| GET    | `/grc/dashboard`                                           | `grc.read`                                                     | query                                | default    |
| GET    | `/grc/dashboard/uncovered-steps`                           | `grc.read`                                                     | query                                | default    |
| GET    | `/grc/export/:kind`                                        | `grc.read`                                                     | param `kind`, query                  | default    |
| POST   | `/grc/import/:kind`                                        | `grc.edit`                                                     | file, param `kind`, query            | default    |
| POST   | `/grc/items/:id/comments`                                  | `grc.read` + `comments.write`                                  | body, param `id`                     | default    |
| GET    | `/grc/items/:id/timeline`                                  | `grc.read`                                                     | param `id`                           | default    |
| GET    | `/grc/processes/:id`                                       | `grc.read` + `processes.read`                                  | param `id`                           | default    |
| GET    | `/grc/processes/:id/gaps`                                  | `grc.read` + `processes.read`                                  | param `id`                           | default    |
| GET    | `/grc/rcm`                                                 | `grc.read`                                                     | query                                | default    |
| GET    | `/grc/requirements`                                        | `grc.read`                                                     | query                                | default    |
| POST   | `/grc/requirements`                                        | `grc.edit`                                                     | body                                 | default    |
| DELETE | `/grc/requirements/:id`                                    | `grc.admin`                                                    | param `id`                           | default    |
| GET    | `/grc/requirements/:id`                                    | `grc.read`                                                     | param `id`                           | default    |
| PATCH  | `/grc/requirements/:id`                                    | `grc.edit`                                                     | body, param `id`                     | default    |
| GET    | `/grc/risks`                                               | `grc.read`                                                     | query                                | default    |
| POST   | `/grc/risks`                                               | any of `grc.edit`, `grc.propose`                               | body                                 | default    |
| DELETE | `/grc/risks/:id`                                           | any of `grc.edit`, `grc.propose`                               | param `id`                           | default    |
| GET    | `/grc/risks/:id`                                           | `grc.read`                                                     | param `id`                           | default    |
| PATCH  | `/grc/risks/:id`                                           | any of `grc.edit`, `grc.propose`                               | body, param `id`                     | default    |
| GET    | `/grc/settings`                                            | any of `grc.read`, `processes.read`                            | —                                    | default    |
| PUT    | `/grc/settings`                                            | `grc.admin`                                                    | body                                 | default    |
| GET    | `/grc/template/:kind`                                      | `grc.edit`                                                     | param `kind`, query                  | default    |
| GET    | `/health`                                                  | **public**                                                     | —                                    | skip       |
| GET    | `/imports`                                                 | any of `import.manage`, `import.own`                           | query                                | default    |
| POST   | `/imports`                                                 | any of `import.manage`, `import.own`                           | body                                 | default    |
| DELETE | `/imports/:id`                                             | any of `import.manage`, `import.own`                           | param `id`                           | default    |
| GET    | `/imports/:id`                                             | any of `import.manage`, `import.own`                           | param `id`                           | default    |
| POST   | `/imports/:id/apply`                                       | any of `import.manage`, `import.own`                           | param `id`                           | default    |
| POST   | `/imports/:id/cancel`                                      | any of `import.manage`, `import.own`                           | param `id`                           | default    |
| GET    | `/imports/:id/files/:fileId`                               | any of `import.manage`, `import.own`                           | param `fileId`, param `id`           | default    |
| GET    | `/imports/:id/items`                                       | any of `import.manage`, `import.own`                           | param `id`, query                    | default    |
| PUT    | `/imports/:id/items/:ref`                                  | any of `import.manage`, `import.own`                           | body, param `id`, param `ref`        | default    |
| PUT    | `/imports/:id/options`                                     | any of `import.manage`, `import.own`                           | body, param `id`                     | default    |
| GET    | `/imports/:id/records`                                     | any of `import.manage`, `import.own`                           | param `id`, query                    | default    |
| GET    | `/imports/:id/report`                                      | any of `import.manage`, `import.own`                           | param `id`, query                    | default    |
| PUT    | `/imports/:id/suggestions`                                 | any of `import.manage`, `import.own`                           | body, param `id`                     | default    |
| GET    | `/imports/:id/undo`                                        | any of `import.manage`, `import.own`                           | param `id`                           | default    |
| POST   | `/imports/:id/undo`                                        | any of `import.manage`, `import.own`                           | param `id`                           | default    |
| GET    | `/imports/kinds`                                           | any of `import.manage`, `import.own`                           | —                                    | default    |
| GET    | `/imports/settings`                                        | any of `import.manage`, `import.own`, `settings.manage`        | —                                    | default    |
| PUT    | `/imports/settings`                                        | `settings.manage`                                              | body                                 | default    |
| GET    | `/imports/templates/:kind`                                 | any of `import.manage`, `import.own`                           | param `kind`, query                  | default    |
| GET    | `/integrations/api-keys`                                   | any of `settings.manage`, `integrations.read`                  | —                                    | default    |
| POST   | `/integrations/api-keys`                                   | `settings.manage`                                              | body                                 | default    |
| GET    | `/integrations/api-keys/:id`                               | any of `settings.manage`, `integrations.read`                  | param `id`                           | default    |
| PATCH  | `/integrations/api-keys/:id`                               | `settings.manage`                                              | body, param `id`                     | default    |
| POST   | `/integrations/api-keys/:id/revoke`                        | `settings.manage`                                              | param `id`                           | default    |
| POST   | `/integrations/api-keys/:id/rotate`                        | `settings.manage`                                              | param `id`                           | default    |
| GET    | `/integrations/api-keys/:id/usage`                         | any of `settings.manage`, `integrations.read`                  | param `id`, query                    | default    |
| GET    | `/integrations/api-settings`                               | any of `settings.manage`, `integrations.read`                  | —                                    | default    |
| PUT    | `/integrations/api-settings`                               | `settings.manage`                                              | body                                 | default    |
| GET    | `/integrations/git`                                        | `settings.manage`                                              | —                                    | default    |
| PUT    | `/integrations/git`                                        | `settings.manage`                                              | body                                 | default    |
| POST   | `/integrations/git/items/:id/retry`                        | `settings.manage`                                              | param `id`                           | default    |
| GET    | `/integrations/git/status`                                 | `settings.manage`                                              | —                                    | default    |
| POST   | `/integrations/git/sync`                                   | `settings.manage`                                              | body                                 | default    |
| POST   | `/integrations/git/test`                                   | `settings.manage`                                              | body                                 | default    |
| GET    | `/integrations/renderer`                                   | any of `settings.manage`, `integrations.read`                  | —                                    | default    |
| GET    | `/integrations/salesforce`                                 | any of `settings.manage`, `kpi.sync`                           | —                                    | default    |
| PUT    | `/integrations/salesforce`                                 | `settings.manage`                                              | body                                 | default    |
| GET    | `/integrations/salesforce/describe/:object`                | `settings.manage`                                              | param `object`                       | default    |
| POST   | `/integrations/salesforce/preview`                         | any of `settings.manage`, `kpi.sync`                           | —                                    | default    |
| GET    | `/integrations/salesforce/runs`                            | any of `settings.manage`, `kpi.sync`                           | —                                    | default    |
| GET    | `/integrations/salesforce/runs/:id/warnings`               | any of `settings.manage`, `kpi.sync`                           | param `id`                           | default    |
| POST   | `/integrations/salesforce/sync`                            | any of `settings.manage`, `kpi.sync`                           | —                                    | default    |
| POST   | `/integrations/salesforce/test`                            | `settings.manage`                                              | —                                    | default    |
| GET    | `/integrations/webhook-settings`                           | any of `settings.manage`, `integrations.read`                  | —                                    | default    |
| PUT    | `/integrations/webhook-settings`                           | `settings.manage`                                              | body                                 | default    |
| GET    | `/integrations/webhooks`                                   | any of `settings.manage`, `integrations.read`                  | query                                | default    |
| POST   | `/integrations/webhooks`                                   | `settings.manage`                                              | body                                 | default    |
| DELETE | `/integrations/webhooks/:id`                               | `settings.manage`                                              | param `id`                           | default    |
| GET    | `/integrations/webhooks/:id`                               | any of `settings.manage`, `integrations.read`                  | param `id`                           | default    |
| PATCH  | `/integrations/webhooks/:id`                               | `settings.manage`                                              | body, param `id`                     | default    |
| GET    | `/integrations/webhooks/:id/deliveries`                    | any of `settings.manage`, `integrations.read`                  | param `id`, query                    | default    |
| POST   | `/integrations/webhooks/:id/deliveries/:deliveryId/resend` | `settings.manage`                                              | param `deliveryId`, param `id`       | default    |
| POST   | `/integrations/webhooks/:id/secret`                        | `settings.manage`                                              | param `id`                           | default    |
| POST   | `/integrations/webhooks/:id/test`                          | `settings.manage`                                              | param `id`                           | default    |
| GET    | `/issues`                                                  | any of `grc.read`, `issues.manage`                             | query                                | default    |
| POST   | `/issues`                                                  | `issues.manage`                                                | body                                 | default    |
| DELETE | `/issues/:id`                                              | `issues.manage` + `grc.admin`                                  | param `id`                           | default    |
| GET    | `/issues/:id`                                              | authenticated                                                  | param `id`                           | default    |
| PATCH  | `/issues/:id`                                              | authenticated                                                  | body, param `id`                     | default    |
| POST   | `/issues/:id/actions`                                      | authenticated                                                  | body, param `id`                     | default    |
| POST   | `/issues/:id/comments`                                     | authenticated                                                  | body, param `id`                     | default    |
| POST   | `/issues/:id/files`                                        | authenticated                                                  | file, param `id`                     | default    |
| POST   | `/issues/:id/transition`                                   | authenticated                                                  | body, param `id`                     | default    |
| DELETE | `/issues/actions/:id`                                      | authenticated                                                  | param `id`                           | default    |
| PATCH  | `/issues/actions/:id`                                      | authenticated                                                  | body, param `id`                     | default    |
| POST   | `/issues/actions/:id/files`                                | authenticated                                                  | file, param `id`                     | default    |
| GET    | `/kpis`                                                    | `kpi.read`                                                     | query                                | default    |
| POST   | `/kpis`                                                    | `kpi.edit`                                                     | body                                 | default    |
| DELETE | `/kpis/:id`                                                | `kpi.edit`                                                     | param `id`                           | default    |
| GET    | `/kpis/:id`                                                | `kpi.read`                                                     | param `id`                           | default    |
| PATCH  | `/kpis/:id`                                                | `kpi.edit`                                                     | body, param `id`                     | default    |
| PUT    | `/kpis/:id/measurements`                                   | any of `kpi.edit`, `kpi.measure`                               | body, param `id`                     | default    |
| DELETE | `/kpis/:id/measurements/:measurementId`                    | any of `kpi.edit`, `kpi.measure`                               | param `id`, param `measurementId`    | default    |
| POST   | `/kpis/:id/recalculate`                                    | `kpi.edit`                                                     | param `id`                           | default    |
| GET    | `/kpis/export/:kind`                                       | `kpi.read`                                                     | param `kind`, query                  | default    |
| POST   | `/kpis/import/:kind`                                       | any of `kpi.edit`, `kpi.measure`                               | file, param `kind`, query            | default    |
| POST   | `/kpis/measurements/:measurementId/files`                  | any of `kpi.edit`, `kpi.measure`                               | file, param `measurementId`          | default    |
| GET    | `/kpis/objectives`                                         | `kpi.read`                                                     | —                                    | default    |
| POST   | `/kpis/objectives`                                         | `kpi.edit`                                                     | body                                 | default    |
| DELETE | `/kpis/objectives/:id`                                     | `kpi.edit`                                                     | param `id`                           | default    |
| PATCH  | `/kpis/objectives/:id`                                     | `kpi.edit`                                                     | body, param `id`                     | default    |
| GET    | `/kpis/processes/:processId`                               | `kpi.read`                                                     | param `processId`                    | default    |
| GET    | `/kpis/scorecard`                                          | `kpi.read`                                                     | query                                | default    |
| GET    | `/kpis/scorecard/export`                                   | `kpi.read`                                                     | query                                | default    |
| GET    | `/kpis/settings`                                           | any of `kpi.read`, `portal.manage`                             | —                                    | default    |
| PUT    | `/kpis/settings`                                           | `kpi.edit`                                                     | body                                 | default    |
| GET    | `/kpis/tasks`                                              | any of `kpi.edit`, `kpi.measure`                               | —                                    | default    |
| GET    | `/kpis/template/:kind`                                     | any of `kpi.edit`, `kpi.measure`                               | param `kind`, query                  | default    |
| GET    | `/migration-ai/proposals`                                  | `import.manage`                                                | query                                | default    |
| GET    | `/migration-ai/proposals/:id`                              | `import.manage`                                                | param `id`                           | default    |
| POST   | `/migration-ai/proposals/:id/accept`                       | `import.manage`                                                | body, param `id`                     | default    |
| POST   | `/migration-ai/proposals/:id/reject`                       | `import.manage`                                                | param `id`                           | default    |
| POST   | `/migration-ai/run`                                        | `import.manage`                                                | body                                 | default    |
| POST   | `/migration/bulk`                                          | `import.manage`                                                | body                                 | default    |
| GET    | `/migration/dashboard`                                     | any of `import.manage`, `governance.dashboard`                 | query                                | default    |
| GET    | `/migration/dashboard/export`                              | any of `import.manage`, `governance.dashboard`                 | query                                | default    |
| GET    | `/migration/items`                                         | any of `import.manage`, `governance.dashboard`                 | query                                | default    |
| GET    | `/migration/my-drafts`                                     | authenticated                                                  | —                                    | default    |
| GET    | `/mining/jobs/:id`                                         | `mining.read`                                                  | param `id`, query                    | default    |
| POST   | `/mining/jobs/:id/cancel`                                  | `mining.read`                                                  | param `id`                           | default    |
| POST   | `/mining/kpis/:kpiId/recalculate`                          | `kpi.edit`                                                     | param `kpiId`                        | default    |
| GET    | `/mining/logs`                                             | `mining.read`                                                  | query                                | default    |
| DELETE | `/mining/logs/:id`                                         | `mining.manage`                                                | param `id`                           | default    |
| GET    | `/mining/logs/:id`                                         | `mining.read`                                                  | param `id`                           | default    |
| PATCH  | `/mining/logs/:id`                                         | `mining.manage`                                                | body, param `id`                     | default    |
| GET    | `/mining/logs/:id/activities`                              | `mining.read`                                                  | param `id`                           | default    |
| PUT    | `/mining/logs/:id/activities`                              | `mining.manage`                                                | body, param `id`                     | default    |
| POST   | `/mining/logs/:id/activities/auto-match`                   | `mining.manage`                                                | param `id`                           | default    |
| POST   | `/mining/logs/:id/analysis`                                | `mining.read`                                                  | body, param `id`                     | default    |
| GET    | `/mining/logs/:id/cases/:caseId`                           | `mining.read`                                                  | param `caseId`, param `id`           | default    |
| POST   | `/mining/logs/:id/conformance`                             | `mining.read`                                                  | body, param `id`                     | default    |
| POST   | `/mining/logs/:id/discover`                                | `mining.manage` + `processes.create`                           | body, param `id`                     | default    |
| POST   | `/mining/logs/:id/export`                                  | `mining.read`                                                  | body, param `id`                     | default    |
| GET    | `/mining/logs/:id/grants`                                  | `mining.read`                                                  | param `id`                           | default    |
| PUT    | `/mining/logs/:id/grants`                                  | `mining.manage`                                                | body, param `id`                     | default    |
| POST   | `/mining/logs/:id/import`                                  | `mining.manage`                                                | param `id`                           | default    |
| PUT    | `/mining/logs/:id/mapping`                                 | `mining.manage`                                                | body, param `id`                     | default    |
| GET    | `/mining/logs/:id/presets`                                 | `mining.read`                                                  | param `id`                           | default    |
| POST   | `/mining/logs/:id/presets`                                 | `mining.read`                                                  | body, param `id`                     | default    |
| GET    | `/mining/logs/:id/preview`                                 | `mining.manage`                                                | param `id`, query                    | default    |
| GET    | `/mining/logs/:id/step-suggestions`                        | `mining.read`                                                  | param `id`                           | default    |
| POST   | `/mining/logs/:id/step-suggestions/apply`                  | `mining.read`                                                  | body, param `id`                     | default    |
| POST   | `/mining/logs/:id/validate`                                | `mining.manage`                                                | param `id`                           | default    |
| POST   | `/mining/logs/processhub`                                  | `mining.manage`                                                | body                                 | default    |
| POST   | `/mining/logs/upload`                                      | `mining.manage`                                                | body, file                           | default    |
| GET    | `/mining/portal/processes/:processId/performance`          | `portal.read`                                                  | param `processId`                    | default    |
| DELETE | `/mining/presets/:id`                                      | `mining.read`                                                  | param `id`                           | default    |
| GET    | `/mining/processes/:processId/logs`                        | `mining.read`                                                  | param `processId`                    | default    |
| GET    | `/mining/settings`                                         | any of `mining.read`, `settings.manage`                        | —                                    | default    |
| PUT    | `/mining/settings`                                         | `settings.manage`                                              | body                                 | default    |
| GET    | `/mining/templates`                                        | `mining.manage`                                                | —                                    | default    |
| POST   | `/mining/templates`                                        | `mining.manage`                                                | body                                 | default    |
| DELETE | `/mining/templates/:id`                                    | `mining.manage`                                                | param `id`                           | default    |
| GET    | `/notifications`                                           | authenticated                                                  | query                                | default    |
| POST   | `/notifications/:id/read`                                  | authenticated                                                  | param `id`                           | default    |
| GET    | `/notifications/preferences`                               | authenticated                                                  | —                                    | default    |
| PUT    | `/notifications/preferences`                               | authenticated                                                  | body                                 | default    |
| POST   | `/notifications/read-all`                                  | authenticated                                                  | —                                    | default    |
| GET    | `/notifications/unread-count`                              | authenticated                                                  | —                                    | default    |
| GET    | `/objects`                                                 | `objects.read`                                                 | query                                | default    |
| POST   | `/objects`                                                 | `objects.manage`                                               | body                                 | default    |
| DELETE | `/objects/:id`                                             | `objects.manage`                                               | param `id`                           | default    |
| GET    | `/objects/:id`                                             | `objects.read`                                                 | param `id`                           | default    |
| PATCH  | `/objects/:id`                                             | `objects.manage`                                               | body, param `id`                     | default    |
| GET    | `/objects/:id/pages`                                       | `docs.read` + `objects.read`                                   | param `id`                           | default    |
| GET    | `/objects/:id/usage`                                       | `objects.read` + `processes.read`                              | param `id`                           | default    |
| DELETE | `/pages/:id`                                               | `docs.read` + `docs.edit`                                      | param `id`                           | default    |
| GET    | `/pages/:id`                                               | `docs.read`                                                    | param `id`                           | default    |
| PUT    | `/pages/:id`                                               | `docs.read` + `docs.edit`                                      | body, param `id`                     | default    |
| GET    | `/pages/:id/attachments`                                   | `docs.read`                                                    | param `id`                           | default    |
| POST   | `/pages/:id/attachments`                                   | `docs.read` + `docs.edit`                                      | file, param `id`                     | default    |
| DELETE | `/pages/:id/draft`                                         | `docs.read` + `docs.edit`                                      | param `id`                           | default    |
| GET    | `/pages/:id/draft`                                         | `docs.read` + `docs.edit`                                      | param `id`                           | default    |
| PUT    | `/pages/:id/draft`                                         | `docs.read` + `docs.edit`                                      | body, param `id`                     | default    |
| GET    | `/pages/:id/export/markdown`                               | `docs.read`                                                    | param `id`, query `lang`             | default    |
| GET    | `/pages/:id/links`                                         | `docs.read`                                                    | param `id`                           | default    |
| POST   | `/pages/:id/links`                                         | `docs.read` + `docs.edit`                                      | body, param `id`                     | default    |
| DELETE | `/pages/:id/links/:linkId`                                 | `docs.read` + `docs.edit`                                      | param `id`, param `linkId`           | default    |
| POST   | `/pages/:id/move`                                          | `docs.read` + `docs.edit`                                      | body, param `id`                     | default    |
| DELETE | `/pages/:id/purge`                                         | `docs.read` + `docs.manage`                                    | param `id`                           | default    |
| POST   | `/pages/:id/restore`                                       | `docs.read` + `docs.edit`                                      | param `id`                           | default    |
| GET    | `/pages/:id/versions`                                      | `docs.read`                                                    | param `id`                           | default    |
| GET    | `/pages/:id/versions/:versionId`                           | `docs.read`                                                    | param `id`, param `versionId`        | default    |
| PATCH  | `/pages/:id/versions/:versionId`                           | `docs.read` + `docs.edit`                                      | body, param `id`, param `versionId`  | default    |
| POST   | `/pages/:id/versions/:versionId/restore`                   | `docs.read` + `docs.edit`                                      | body, param `id`, param `versionId`  | default    |
| GET    | `/portal/:type/:id/feedback`                               | `portal.read`                                                  | param `id`, param `type`             | default    |
| GET    | `/portal/attachments/:id/content`                          | `portal.read`                                                  | param `id`                           | default    |
| GET    | `/portal/diagrams`                                         | `portal.read`                                                  | query                                | default    |
| GET    | `/portal/diagrams/:id`                                     | `portal.read`                                                  | param `id`                           | default    |
| GET    | `/portal/home`                                             | `portal.read`                                                  | —                                    | default    |
| GET    | `/portal/my`                                               | `portal.read`                                                  | —                                    | default    |
| GET    | `/portal/pages/:id`                                        | `portal.read`                                                  | param `id`                           | default    |
| GET    | `/portal/processes`                                        | `portal.read`                                                  | —                                    | default    |
| GET    | `/portal/processes/:id`                                    | `portal.read`                                                  | param `id`                           | default    |
| GET    | `/portal/search`                                           | `portal.read`                                                  | query                                | default    |
| GET    | `/portal/settings`                                         | `portal.manage`                                                | —                                    | default    |
| PUT    | `/portal/settings`                                         | `portal.manage`                                                | body                                 | default    |
| GET    | `/portal/spaces`                                           | `portal.read`                                                  | —                                    | default    |
| GET    | `/portal/spaces/:id/pages`                                 | `portal.read`                                                  | param `id`                           | default    |
| GET    | `/processes`                                               | `processes.read`                                               | query                                | default    |
| POST   | `/processes`                                               | `processes.create`                                             | body                                 | default    |
| DELETE | `/processes/:id`                                           | `processes.delete`                                             | param `id`                           | default    |
| GET    | `/processes/:id`                                           | `processes.read`                                               | param `id`                           | default    |
| PATCH  | `/processes/:id`                                           | any of `processes.edit`, `processes.edit_own`                  | body, param `id`                     | default    |
| GET    | `/processes/:id/links`                                     | `processes.read`                                               | param `id`                           | default    |
| POST   | `/processes/:id/links`                                     | any of `models.edit`, `models.edit_own`, `grc.edit`            | body, param `id`                     | default    |
| DELETE | `/processes/:id/links/:linkId`                             | any of `models.edit`, `models.edit_own`, `grc.edit`            | param `id`, param `linkId`           | default    |
| GET    | `/processes/:id/model`                                     | `processes.read`                                               | param `id`                           | default    |
| PUT    | `/processes/:id/model`                                     | any of `models.edit`, `models.edit_own`                        | body, param `id`                     | default    |
| POST   | `/processes/:id/move`                                      | `processes.edit`                                               | body, param `id`                     | default    |
| GET    | `/processes/:id/pages`                                     | `docs.read` + `processes.read`                                 | param `id`                           | default    |
| GET    | `/processes/:id/versions`                                  | `processes.read`                                               | param `id`                           | default    |
| POST   | `/processes/:id/versions`                                  | any of `models.edit`, `models.edit_own`                        | body, param `id`                     | default    |
| GET    | `/processes/:id/versions/:versionId`                       | `processes.read`                                               | param `id`, param `versionId`        | default    |
| PATCH  | `/processes/:id/versions/:versionId`                       | any of `models.edit`, `models.edit_own`                        | body, param `id`, param `versionId`  | default    |
| POST   | `/processes/:id/versions/:versionId/restore`               | any of `models.edit`, `models.edit_own`                        | body, param `id`, param `versionId`  | default    |
| GET    | `/processes/tree`                                          | `processes.read`                                               | —                                    | default    |
| GET    | `/report-subscriptions`                                    | authenticated                                                  | —                                    | default    |
| POST   | `/report-subscriptions`                                    | authenticated                                                  | body                                 | default    |
| DELETE | `/report-subscriptions/:id`                                | authenticated                                                  | param `id`                           | default    |
| PUT    | `/report-subscriptions/:id`                                | authenticated                                                  | body, param `id`                     | default    |
| GET    | `/report-subscriptions/:id/deliveries`                     | authenticated                                                  | param `id`                           | default    |
| POST   | `/report-subscriptions/:id/resubscribe`                    | authenticated                                                  | param `id`                           | default    |
| POST   | `/report-subscriptions/:id/send-now`                       | authenticated                                                  | param `id`                           | default    |
| GET    | `/report-subscriptions/deliveries/:id/file`                | authenticated                                                  | param `id`                           | default    |
| GET    | `/report-subscriptions/settings`                           | any of `settings.manage`, `integrations.read`                  | —                                    | default    |
| PUT    | `/report-subscriptions/settings`                           | `settings.manage`                                              | body                                 | default    |
| POST   | `/report-subscriptions/unsubscribe`                        | **public**                                                     | body                                 | login      |
| POST   | `/reports/handbook`                                        | any of `processes.read`, `portal.read`                         | body                                 | default    |
| POST   | `/reports/handbook/plan`                                   | any of `processes.read`, `portal.read`                         | body                                 | default    |
| GET    | `/reports/objects/:id`                                     | `objects.read` + `processes.read`                              | param `id`, query                    | default    |
| GET    | `/reports/raci/:processId`                                 | any of `processes.read`, `portal.read`                         | param `processId`, query             | default    |
| GET    | `/repository-export`                                       | `export.full`                                                  | —                                    | default    |
| GET    | `/reviews/:id`                                             | authenticated                                                  | param `id`                           | default    |
| POST   | `/reviews/:id/decision`                                    | authenticated                                                  | body, param `id`                     | default    |
| GET    | `/roles`                                                   | any of `roles.read`, `users.manage`                            | —                                    | default    |
| GET    | `/search`                                                  | any of `docs.read`, `processes.read`                           | query                                | default    |
| GET    | `/settings`                                                | `settings.manage`                                              | —                                    | default    |
| PATCH  | `/settings`                                                | `settings.manage`                                              | body                                 | default    |
| GET    | `/settings/auth`                                           | `settings.manage`                                              | —                                    | default    |
| PUT    | `/settings/auth`                                           | `settings.manage`                                              | body                                 | default    |
| POST   | `/settings/auth/test`                                      | `settings.manage`                                              | body                                 | default    |
| GET    | `/settings/demo-status`                                    | any of `users.manage`, `settings.manage`                       | —                                    | default    |
| POST   | `/settings/demo-status/clear`                              | `settings.manage`                                              | —                                    | default    |
| DELETE | `/settings/diagram-theme`                                  | `settings.manage`                                              | —                                    | default    |
| PUT    | `/settings/diagram-theme`                                  | `settings.manage`                                              | body                                 | default    |
| POST   | `/settings/diagram-theme/apply`                            | `settings.manage`                                              | body                                 | default    |
| GET    | `/settings/diagram-theme/notice`                           | `settings.manage`                                              | —                                    | default    |
| POST   | `/settings/diagram-theme/notice/dismiss`                   | `settings.manage`                                              | —                                    | default    |
| GET    | `/settings/email`                                          | `settings.manage`                                              | —                                    | default    |
| PUT    | `/settings/email`                                          | `settings.manage`                                              | body                                 | default    |
| POST   | `/settings/email/test`                                     | `settings.manage`                                              | body                                 | default    |
| DELETE | `/settings/logo`                                           | `settings.manage`                                              | —                                    | default    |
| GET    | `/settings/logo`                                           | **public**                                                     | —                                    | default    |
| POST   | `/settings/logo`                                           | `settings.manage`                                              | file                                 | default    |
| GET    | `/settings/modeling-conventions`                           | `processes.read`                                               | —                                    | default    |
| PUT    | `/settings/modeling-conventions`                           | `conventions.manage`                                           | body                                 | default    |
| GET    | `/settings/public`                                         | **public**                                                     | —                                    | default    |
| GET    | `/simulations`                                             | `mining.read`                                                  | query                                | default    |
| POST   | `/simulations`                                             | `mining.manage`                                                | body                                 | default    |
| DELETE | `/simulations/:id`                                         | `mining.manage`                                                | param `id`                           | default    |
| GET    | `/simulations/:id`                                         | `mining.read`                                                  | param `id`                           | default    |
| PATCH  | `/simulations/:id`                                         | `mining.manage`                                                | body, param `id`                     | default    |
| POST   | `/simulations/:id/ai/explain`                              | `mining.read`                                                  | param `id`                           | default    |
| POST   | `/simulations/:id/ai/suggest`                              | `mining.read`                                                  | param `id`                           | default    |
| GET    | `/simulations/:id/export`                                  | `mining.read`                                                  | param `id`                           | default    |
| POST   | `/simulations/:id/run`                                     | `mining.manage`                                                | body, param `id`                     | default    |
| POST   | `/simulations/:id/scenarios`                               | `mining.manage`                                                | body, param `id`                     | default    |
| DELETE | `/simulations/:id/scenarios/:scenarioId`                   | `mining.manage`                                                | param `id`, param `scenarioId`       | default    |
| PATCH  | `/simulations/:id/scenarios/:scenarioId`                   | `mining.manage`                                                | body, param `id`, param `scenarioId` | default    |
| GET    | `/simulations/defaults`                                    | `mining.read`                                                  | query                                | default    |
| GET    | `/simulations/holidays`                                    | any of `mining.read`, `settings.manage`                        | —                                    | default    |
| PUT    | `/simulations/holidays`                                    | any of `settings.manage`, `departments.manage`                 | body                                 | default    |
| GET    | `/spaces`                                                  | `docs.read`                                                    | —                                    | default    |
| POST   | `/spaces`                                                  | `docs.manage`                                                  | body                                 | default    |
| DELETE | `/spaces/:id`                                              | `docs.manage`                                                  | param `id`                           | default    |
| GET    | `/spaces/:id`                                              | `docs.read`                                                    | param `id`                           | default    |
| PATCH  | `/spaces/:id`                                              | `docs.read`                                                    | body, param `id`                     | default    |
| GET    | `/spaces/:id/permissions`                                  | `docs.read`                                                    | param `id`                           | default    |
| PUT    | `/spaces/:id/permissions`                                  | `docs.read`                                                    | body, param `id`                     | default    |
| GET    | `/spaces/:spaceId/pages`                                   | `docs.read`                                                    | param `spaceId`                      | default    |
| POST   | `/spaces/:spaceId/pages`                                   | `docs.read` + `docs.edit`                                      | body, param `spaceId`                | default    |
| GET    | `/spaces/:spaceId/trash`                                   | `docs.read` + `docs.edit`                                      | param `spaceId`                      | default    |
| GET    | `/surveys/campaigns`                                       | any of `surveys.manage`, `processes.read`                      | query                                | default    |
| POST   | `/surveys/campaigns`                                       | `surveys.manage`                                               | body                                 | default    |
| DELETE | `/surveys/campaigns/:id`                                   | `surveys.manage`                                               | param `id`                           | default    |
| GET    | `/surveys/campaigns/:id`                                   | any of `surveys.manage`, `processes.read`                      | param `id`                           | default    |
| PATCH  | `/surveys/campaigns/:id`                                   | `surveys.manage`                                               | body, param `id`                     | default    |
| POST   | `/surveys/campaigns/:id/close`                             | any of `surveys.manage`, `processes.read`                      | param `id`                           | default    |
| GET    | `/surveys/campaigns/:id/export`                            | any of `surveys.manage`, `processes.read`                      | param `id`, query                    | default    |
| POST   | `/surveys/campaigns/:id/launch`                            | any of `surveys.manage`, `processes.read`                      | param `id`                           | default    |
| GET    | `/surveys/campaigns/:id/proposals`                         | any of `surveys.manage`, `grc.edit`                            | param `id`                           | default    |
| GET    | `/surveys/campaigns/:id/results`                           | any of `surveys.manage`, `processes.read`                      | param `id`                           | default    |
| POST   | `/surveys/feedback-requests`                               | `processes.read`                                               | body                                 | default    |
| POST   | `/surveys/proposals/:id/decision`                          | `grc.edit`                                                     | body, param `id`                     | default    |
| GET    | `/surveys/questionnaires`                                  | `surveys.manage`                                               | —                                    | default    |
| POST   | `/surveys/questionnaires`                                  | `surveys.manage`                                               | body                                 | default    |
| DELETE | `/surveys/questionnaires/:id`                              | `surveys.manage`                                               | param `id`                           | default    |
| GET    | `/surveys/questionnaires/:id`                              | `surveys.manage`                                               | param `id`                           | default    |
| PATCH  | `/surveys/questionnaires/:id`                              | `surveys.manage`                                               | body, param `id`                     | default    |
| GET    | `/surveys/responses/:id`                                   | `surveys.respond`                                              | param `id`                           | default    |
| PUT    | `/surveys/responses/:id`                                   | `surveys.respond`                                              | body, param `id`                     | default    |
| GET    | `/surveys/responses/:id/diagram`                           | `surveys.respond`                                              | param `id`                           | default    |
| POST   | `/surveys/responses/:id/files`                             | `surveys.respond`                                              | file, param `id`                     | default    |
| GET    | `/tasks`                                                   | authenticated                                                  | —                                    | default    |
| GET    | `/templates`                                               | `docs.read`                                                    | —                                    | default    |
| POST   | `/templates`                                               | `docs.manage`                                                  | body                                 | default    |
| DELETE | `/templates/:id`                                           | `docs.manage`                                                  | param `id`                           | default    |
| GET    | `/templates/:id`                                           | `docs.read`                                                    | param `id`                           | default    |
| PUT    | `/templates/:id`                                           | `docs.manage`                                                  | body, param `id`                     | default    |
| GET    | `/users`                                                   | `users.read`                                                   | query                                | default    |
| POST   | `/users`                                                   | `users.manage`                                                 | body                                 | default    |
| GET    | `/users/:id`                                               | `users.read`                                                   | param `id`                           | default    |
| PATCH  | `/users/:id`                                               | `users.manage`                                                 | body, param `id`                     | default    |
| POST   | `/users/:id/invitation`                                    | `users.manage`                                                 | param `id`                           | default    |
| POST   | `/users/:id/mfa/reset`                                     | `users.manage`                                                 | param `id`                           | default    |
| POST   | `/users/:id/reset-password`                                | `users.manage`                                                 | body, param `id`                     | default    |
| POST   | `/users/:id/sessions/revoke`                               | `users.manage`                                                 | param `id`                           | default    |
| POST   | `/users/:id/unlock`                                        | `users.manage`                                                 | param `id`                           | default    |
| GET    | `/users/directory`                                         | any of `comments.write`, `governance.manage`                   | query                                | default    |
| GET    | `/workflow/cases`                                          | authenticated                                                  | query                                | default    |
| GET    | `/workflow/cases/:id`                                      | authenticated                                                  | param `id`                           | default    |
| POST   | `/workflow/cases/:id/cancel`                               | `workflow.admin`                                               | body, param `id`                     | default    |
| POST   | `/workflow/cases/:id/comments`                             | authenticated                                                  | body, param `id`                     | default    |
| POST   | `/workflow/cases/:id/retry`                                | `workflow.admin`                                               | param `id`                           | default    |
| POST   | `/workflow/cases/:id/withdraw`                             | authenticated                                                  | body, param `id`                     | default    |
| GET    | `/workflow/catalogue`                                      | `workflow.start`                                               | —                                    | default    |
| GET    | `/workflow/catalogue/:processId`                           | `workflow.start`                                               | param `processId`                    | default    |
| POST   | `/workflow/catalogue/:processId/start`                     | `workflow.start`                                               | body, param `processId`              | default    |
| GET    | `/workflow/dashboard`                                      | any of `workflow.monitor`, `workflow.admin`                    | query                                | default    |
| GET    | `/workflow/dashboard/export`                               | any of `workflow.monitor`, `workflow.admin`                    | query                                | default    |
| GET    | `/workflow/departments`                                    | authenticated                                                  | —                                    | default    |
| POST   | `/workflow/files`                                          | authenticated                                                  | body, file                           | default    |
| GET    | `/workflow/files/:id`                                      | authenticated                                                  | param `id`                           | default    |
| GET    | `/workflow/monitor`                                        | any of `workflow.monitor`, `workflow.admin`                    | —                                    | default    |
| GET    | `/workflow/out-of-office`                                  | authenticated                                                  | —                                    | default    |
| PUT    | `/workflow/out-of-office`                                  | authenticated                                                  | body                                 | default    |
| POST   | `/workflow/processes/:id/check`                            | `processes.read`                                               | body, param `id`                     | default    |
| GET    | `/workflow/processes/:id/config`                           | `processes.read`                                               | param `id`                           | default    |
| PUT    | `/workflow/processes/:id/config`                           | any of `workflow.design`, `workflow.admin`                     | body, param `id`                     | default    |
| POST   | `/workflow/processes/:id/deploy`                           | any of `workflow.design`, `workflow.admin`                     | param `id`                           | default    |
| GET    | `/workflow/settings`                                       | any of `workflow.admin`, `workflow.design`, `workflow.monitor` | —                                    | default    |
| PUT    | `/workflow/settings`                                       | `workflow.admin`                                               | body                                 | default    |
| GET    | `/workflow/tasks`                                          | authenticated                                                  | query                                | default    |
| GET    | `/workflow/tasks/:id`                                      | authenticated                                                  | param `id`                           | default    |
| POST   | `/workflow/tasks/:id/claim`                                | authenticated                                                  | param `id`                           | default    |
| POST   | `/workflow/tasks/:id/complete`                             | authenticated                                                  | body, param `id`                     | default    |
| POST   | `/workflow/tasks/:id/delegate`                             | authenticated                                                  | body, param `id`                     | default    |
| PUT    | `/workflow/tasks/:id/draft`                                | authenticated                                                  | body, param `id`                     | default    |
| POST   | `/workflow/tasks/:id/reassign`                             | `workflow.admin`                                               | body, param `id`                     | default    |
| POST   | `/workflow/tasks/:id/unclaim`                              | authenticated                                                  | param `id`                           | default    |
| GET    | `/workflow/tasks/counts`                                   | authenticated                                                  | —                                    | default    |
| GET    | `/workflow/users`                                          | authenticated                                                  | query                                | default    |
| GET    | `/workflows`                                               | any of `governance.manage`, `processes.read`, `docs.read`      | —                                    | default    |
| POST   | `/workflows`                                               | `governance.manage`                                            | body                                 | default    |
| DELETE | `/workflows/:id`                                           | `governance.manage`                                            | param `id`                           | default    |
| GET    | `/workflows/:id`                                           | any of `governance.manage`, `processes.read`, `docs.read`      | param `id`                           | default    |
| PUT    | `/workflows/:id`                                           | `governance.manage`                                            | body, param `id`                     | default    |

<!-- route-table:end -->

## 6. Remaining risks

| Risk                                                                                                                                             | Mitigation / plan                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| ------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **SEC-08** `braces` (high) via Jest, no upstream fix; dev dependencies are in the API runtime image.                                             | Not executed at runtime. **Accepted** by the product owner (D-054); the slim runtime image and the Jest → Vitest move (BACKLOG) remove it.                                                                                                                                                                                                                                                                                                                                                                      |
| **SEC-09** The `minio` npm client's `stream-json` / `decode-uri-component` (moderate).                                                           | Code paths unused; replace the client with `@aws-sdk/client-s3` (BACKLOG) or update when it releases a fix.                                                                                                                                                                                                                                                                                                                                                                                                     |
| No second factor and no SSO yet.                                                                                                                 | **Resolved** (part 3): OIDC / Entra ID single sign-on and TOTP two-factor.                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| SSO: Entra ID "group overage" (users in more than 200 groups get no groups claim).                                                               | Roles are left unchanged and the sign-in is audited with `groupsOverage`; reading groups from Microsoft Graph is in BACKLOG.                                                                                                                                                                                                                                                                                                                                                                                    |
| SSO users skip ProcessHub's TOTP (the identity provider is responsible for MFA).                                                                 | **Policy** (D-064): Entra ID Conditional Access requires MFA for the ProcessHub application (request in DEPLOYMENT.md §6.1 step 9; go-live checklist). ProcessHub additionally refuses SSO tokens without `mfa` in the `amr` claim once **Require MFA from the identity provider** is on (D-166).                                                                                                                                                                                                               |
| Sessions are not ended when a user is disabled in Entra ID (no back-channel logout / SCIM).                                                      | Access tokens live 15 minutes; refresh tokens end after 24 hours without activity (`REFRESH_TOKEN_TTL_HOURS`, D-065) and at the latest 7 days after sign-in (`SESSION_MAX_HOURS`, D-165); an active session keeps working until then. Leaver process: deactivate the user in ProcessHub (immediate). Automatic de-provisioning in BACKLOG.                                                                                                                                                                      |
| Rate limits and lockout counters are per API instance (in memory).                                                                               | Fine for one instance; Redis storage in BACKLOG before scaling out.                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| Account lockout can be triggered by anyone who knows an email address (denial of service), and `ACCOUNT_LOCKED` reveals that the account exists. | Short lock (15 min), per-IP login limit, audit entries `LOGIN_FAILED` / `LOCKOUT`. SSO will move most users off passwords.                                                                                                                                                                                                                                                                                                                                                                                      |
| CSP allows inline styles (`style-src 'unsafe-inline'`, required by Ant Design).                                                                  | Scripts stay `'self'` only; rich text strips `style` attributes. Revisit with Ant Design's CSS-variables mode.                                                                                                                                                                                                                                                                                                                                                                                                  |
| AI: published or draft content sent to the provider could contain prompt-injection text.                                                         | Answers are text only, only from content the user may read; generated BPMN / pages are validated, sanitised and only saved after a human accepts the preview.                                                                                                                                                                                                                                                                                                                                                   |
| Logs contain recipient email addresses of failed notification emails.                                                                            | Personal data, not secrets; keep log retention short.                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| Renderer: Chromium without its own sandbox (`--no-sandbox`) where the host blocks user namespaces (`RENDERER_SANDBOX=auto` fallback or `off`).   | **Accepted risk** (product owner, D-181) — to be reviewed in Final Part B. Sandbox first (seccomp profile `deploy/renderer-seccomp.json`, no capabilities; set `RENDERER_SANDBOX=on` once the host is confirmed). Fallback container: non-root, read-only root with tmpfs `/tmp`, `cap_drop: ALL`, `no-new-privileges`, memory / CPU / process limits, internal network without outbound access, every page request intercepted, shared token, per-render timeout; draws only ProcessHub's own content (D-172). |
| Public API: a leaked key reads what its scopes allow until revoked.                                                                              | Narrow scopes, published content by default, IP allow-list, expiry, call log with last use, owner deactivation stops the key; rotate / revoke in Settings → Integrations.                                                                                                                                                                                                                                                                                                                                       |
| Per-key rate limits are in memory (one API instance).                                                                                            | Fine for one instance; Redis in BACKLOG before scaling out.                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| Webhook receivers must check signatures and timestamps themselves.                                                                               | Documented with Node / Python samples (`docs/integrations/WEBHOOKS.md`); payloads hold no sensitive data.                                                                                                                                                                                                                                                                                                                                                                                                       |
| TLS and HSTS: the trial stack (`docker-compose.yml`) serves plain HTTP on port 8080.                                                             | **Resolved for production** (part 2): `docker-compose.prod.yml` puts Caddy in front (automatic certificates, http → https, HSTS); see `docs/DEPLOYMENT.md`.                                                                                                                                                                                                                                                                                                                                                     |

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
- [ ] Import Center → Import settings: **"Allow AI on imported documents" off** (the default) unless DOF has
      approved sending imported document text outside the UAE (D-164); "Welcome e-mail for imported users"
      as agreed for the SSO roll-out.
- [ ] Settings → Authentication: two-step verification required for **Super Admin and Admin** (the default —
      check it if the settings were saved before part 4); allowed domains limited to company domains; **Update
      roles at every sign-in off** (roles managed in ProcessHub); after the SSO roll-out password sign-in
      **off** with a dedicated break-glass Super Admin created as in DEPLOYMENT.md §6.3 (2FA, password and
      recovery codes in the password manager, tested); `AUTH_FORCE_LOCAL_LOGIN` not set.
- [ ] Entra ID Conditional Access policy "Require MFA – ProcessHub" is **On** (not report-only) and a test
      sign-in asks for the second factor (DEPLOYMENT.md §6.1 step 9).
- [ ] Once IT has confirmed the policy and a test sign-in's audit entry shows `amr` with `mfa`: Settings →
      Authentication → **Require MFA from the identity provider** on (D-166, DEPLOYMENT.md §6.1 step 9).
- [ ] `REFRESH_TOKEN_TTL_HOURS=24` and `SESSION_MAX_HOURS=168` (or the agreed values); no
      `REFRESH_TOKEN_TTL_DAYS` left in `.env`.
- [ ] Leaver process includes "deactivate in ProcessHub" until automatic de-provisioning exists.
- [ ] Database, file storage and the API are not reachable from outside (only the web container is published) _(prod stack: only Caddy on 80/443; database and storage on an internal network)_.
- [ ] Daily backups with an off-site copy, and one restore tested (`docs/DEPLOYMENT.md` §7–8).
- [ ] Settings → Risk & Compliance → Approval of changes **on** for risks and controls with the workflow
      "GRC change approval", and at least two Risk & Compliance Officers (DEPLOYMENT.md §6 step 9, D-106).
- [ ] Process mining (D-143): event log retention set from the records-retention policy (suggested 24 months;
      off by default); portal "Performance" section off until real logs exist; access to event logs only by
      owner / department / explicit grant (Admins do not see all logs); the central public holiday list checked
      for the year.
- [ ] Workflow execution (D-152): form data retention set per executable process (default: keep); start rights
      and monitors reviewed; Settings → Workflow execution checked (working week, escalation).
- [ ] Settings → Knowledge Portal → Start page: empty until the real enterprise value chain is approved and
      published, then set to it (DEPLOYMENT.md §6 step 10, D-127). A production install without demo data starts
      with it off.

- [ ] **Integrations** (Phase 4.4): Settings → Integrations → API keys reviewed — the demo key revoked, every
      key with an owner, the narrowest scopes, published content unless drafts are needed, an IP allow-list for
      servers with fixed addresses, expiry ≤ 1 year; `ENABLE_PUBLIC_API_DOCS` off unless wanted.
- [ ] Webhooks: only HTTPS receivers of known systems; the optional **allowed hosts** list set if the receivers
      are known; the demo webhook deleted; `OUTBOUND_ALLOWED_HOSTS` without `webhook-receiver`.
- [ ] Microsoft Teams destinations: each workflow created with a service account, the channel and events agreed
      with the channel owner; the demo destination deleted.
- [ ] Settings → Integrations → Report e-mail settings: **"Attach PDF / Excel files" off** (the default) unless
      DOF agrees that report files may travel by e-mail; link lifetime agreed (default 30 days).
- [ ] The renderer container is running (`docker compose ps`), `RENDERER_TOKEN` generated, and Settings →
      Integrations shows "Diagram renderer: Running".
- [ ] Renderer sandbox: `docker compose exec renderer wget -qO- http://127.0.0.1:3100/health` shows
      `"sandbox":true` (seccomp profile `deploy/renderer-seccomp.json` in place); then set `RENDERER_SANDBOX=on`.
      If the host cannot provide it, the hardened `--no-sandbox` fallback is the accepted risk of §6 (D-181).
- [ ] **No demo data** (D-180): production starts from an empty database with `SEED_DEMO_DATA=false` — no demo
      key is ever created then. Where demo data was loaded: revoke the demo API key, deactivate the demo users,
      remove the demo content, then **Confirm demo removed** in the warning banner (Super Admin); the banner must
      be gone.

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
