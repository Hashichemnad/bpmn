# Progress

Read this together with `CLAUDE.md` at the start of every session.

## Current state — 2026-10-21 (Phase 6 — Hardening, branch `phase-6-part-3`)

Parts 1 (security review) and 2 (production deployment) are merged into `main`.

### Part 3 — Single sign-on (OIDC / Entra ID) and TOTP two-factor (in progress)

Design (details in DECISIONS D-055 – D-060 once written):

- OIDC authorization-code flow with PKCE, state and nonce via `openid-client` 6 (OpenID-certified);
  Entra ID = issuer `https://login.microsoftonline.com/<tenant id>/v2.0`, any other provider = issuer URL
  (discovery). Settings key `auth` (Super Admin, Settings → Authentication); client secret AES-256-GCM.
  Callback `GET /api/v1/auth/sso/callback` (redirect URI `${APP_URL}/api/v1/auth/sso/callback`); flow state in
  an encrypted, 10-minute, `SameSite=Lax` cookie limited to `/api/v1/auth/sso`. IdP calls go through the
  SSRF policy (`OUTBOUND_ALLOWED_HOSTS`).
- Users matched by (issuer, subject), then linked once by e-mail; just-in-time creation with a default role
  and department; group → roles/department mapping (optional sync on every sign-in); allowed e-mail domains.
- Local (password) sign-in can be switched off except for one break-glass Super Admin; env
  `AUTH_FORCE_LOCAL_LOGIN=true` re-enables it in an emergency.
- TOTP (`otpauth`, RFC 6238, 30 s, 6 digits, ±1 step, no code reuse) for local accounts; QR code shown with
  Ant Design `QRCode`; 10 single-use recovery codes (stored as SHA-256); admin can require 2FA per role and
  reset a user's 2FA. Password sign-in then needs a second step (`ph_mfa` challenge cookie, 5 minutes).

Steps (tick as they are committed; a new session continues at the first unticked one):

- [x] 1. Shared schemas/types/constants (auth settings, MFA, login response, audit actions); Prisma migration
      (User SSO + TOTP fields, `MfaRecoveryCode`); Jest transform for ESM-only `openid-client`.
- [ ] 2. API: TOTP service, enrolment / disable / recovery-code endpoints, two-step password login,
      "required for role" setup during login, admin reset; unit + e2e tests.
- [ ] 3. API: authentication settings (Super Admin, encrypted secret), OIDC start/callback, JIT users, group
      mapping, allowed domains, local sign-in restriction + break-glass; e2e tests with a mocked identity
      provider (local discovery / JWKS / token endpoint).
- [ ] 4. Web: login page (SSO button, 2FA step, 2FA set-up step), Profile → two-factor, Settings →
      Authentication, Users (2FA status, reset, SSO badge); EN/AR translations; Vitest.
- [ ] 5. Docs (DECISIONS, SECURITY, DEPLOYMENT/README Entra ID guide, BACKLOG, CLAUDE.md), full verification,
      push.

## Phase 6 part 2 — 2026-10-21 (production deployment, merged into `main`)

Phase 6 is split into small parts, one branch each (`phase-6-part-<n>` from the latest `main`). Part 1
(security review) is merged into `main`.

### Part 2 — Production deployment, backups and storage (done, awaiting review)

Steps (tick as they are committed; a new session continues at the first unticked one):

- [x] 1. Replace the frozen MinIO image (D-009) with a maintained S3-compatible store in `docker-compose.yml`;
      migration script for files in an existing MinIO volume; DECISIONS entry. **Done:** Versity S3 Gateway
      (`versity/versitygw:v1.9.0`, objects as plain files + metadata sidecar, D-051), service `storage`, volume
      `storage-data`; `scripts/migrate-minio-storage.sh` (tested: 25 files copied, checksums and content types
      match); shared helpers in `scripts/lib.sh`.
- [x] 2. `docker-compose.prod.yml` + `deploy/Caddyfile`: Caddy with automatic HTTPS (only 80/443 published),
      internal network for database and storage, health checks, restart policies, resource limits, log rotation.
      **Done** and tested in Docker (DOMAIN=localhost, `CADDY_TLS=internal`): all five services healthy, only
      80/443 published, http → https (308), HSTS + CSP, postgres/storage have no internet and no host ports, the
      API resolves external hosts; sign-in, Arabic page and an 8 MB attachment work over HTTPS; audit log shows
      the client IP (`TRUST_PROXY=2`). **Fixed on the way:** nginx `client_max_body_size` 6m → 11m (attachments
      may be 10 MB; 6–10 MB uploads used to fail with nginx's untranslated 413).
- [x] 3. `.env.example.prod` with secure defaults + `scripts/generate-secrets.sh`. **Done:** secrets are
      required in production (Compose refuses to start without them, so they live in `.env` and are backed up
      with it); `COMPOSE_FILE` in `.env` makes plain `docker compose` use the production file; the script
      only fills `__GENERATE__` values (safe to re-run), sets `chmod 600`, prints the first admin password once.
- [x] 4. `scripts/backup.sh` / `scripts/restore.sh` (PostgreSQL dump + file storage + key fingerprint), daily
      schedule example; restore tested end to end on the production stack. **Done:** `backup.sh` (dump checked
      with `pg_restore --list`, storage volume as `tar.gz`, `MANIFEST.txt` with the encryption-key fingerprint,
      `SHA256SUMS`, retention `BACKUP_KEEP_DAYS`, optional `--with-env`), `restore.sh` (checksums, key
      fingerprint warning, typed confirmation, automatic `pre-restore` backup, drop/recreate database, replace
      files, wait for the API), `deploy/processhub-backup.cron` (02:30 daily). **Disaster drill passed:**
      `docker compose down -v` → fresh empty stack → restore (33 s) → the Arabic page and the 8 MB attachment
      are back byte for byte. Damaged backup, different key and "no" at the prompt are refused/warned.
      Migration script also verified on the production stack (internal network). `shellcheck` clean.
- [x] 5. `docs/DEPLOYMENT.md` for a non-developer IT person. **Done:** architecture, sizing (≤250 / 250–500
      users, Azure UAE North / AWS me-central-1 instance types), VM creation (portal / console), data disk,
      firewall, Docker install, configure, DNS, start, first sign-in, HTTPS options (Let's Encrypt, company
      certificate, internal — the latter two verified in Docker), backups incl. off-site copies, restore incl.
      new server, updates (incl. MinIO migration and trial → production), monitoring, troubleshooting, reference.
- [x] 6. Verification, docs (DECISIONS D-051 – D-053, BACKLOG, README, SECURITY §6/§7, CLAUDE.md phase table and
      stack), CI (production compose file validated, `shellcheck` on `scripts/`), push.

#### Verification (part 2)

| Check                                              | Result                                                                                                                                  |
| -------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm format:check`, `pnpm lint`, `pnpm typecheck` | clean                                                                                                                                   |
| `pnpm test`                                        | **332 tests pass** — shared 64, web 31, API 237 (no application code changed in this part)                                              |
| `pnpm build`                                       | passes                                                                                                                                  |
| `pnpm audit --prod`                                | no high/critical; the same 4 moderate as part 1 (`minio` client, SEC-09)                                                                |
| Trial stack (`docker-compose.yml`, clean clone)    | five services healthy with the new `storage` service; 8 Playwright smoke tests pass on `http://localhost:8080`                          |
| Production stack (`docker-compose.prod.yml`)       | see steps 2 and 4: HTTPS (internal CA and company certificate), isolation, 8 MB upload, backup, disaster-drill restore, MinIO migration |
| `shellcheck -s sh scripts/*.sh`                    | clean                                                                                                                                   |

Docker in the sandbox: as before, base images from `mirror.gcr.io` (re-tagged locally) and the app images built
from the committed Dockerfiles with an uncommitted CA line and `docker build --network host`.
Let's Encrypt itself could not be tested here (no public DNS); the Caddyfile path is the same as for
`internal` and company certificates, which were both verified.

### Next (continue here)

1. Review and merge `phase-6-part-2`. Existing installations: after updating, run
   `./scripts/migrate-minio-storage.sh` once (copies files from the old `minio-data` volume).
2. Decisions taken by the product owner (D-054): Versity S3 Gateway confirmed; backups never include `.env`
   (keys in the password manager); off-site backups to Azure Blob Storage, UAE North, 90 days (DEPLOYMENT.md
   §7); `braces` accepted, Jest → Vitest added to BACKLOG.
3. Next Phase 6 parts (suggested order): TOTP two-factor and SSO (Azure AD / OIDC); slim API runtime image and
   images in a registry; performance; external penetration test with `docs/SECURITY.md` §8.

## Phase 6 part 1 — 2026-10-21 (security review, merged into `main`)

Phase 6 is split into small parts, one branch each (`phase-6-part-<n>` from the latest `main`). The AI phase
is merged into `main`.

### Part 1 — Security review and fixes (done, awaiting review)

Steps (tick as they are committed; a new session continues at the first unticked one):

- [x] 1. Route inventory (`apps/api/test/route-inventory.ts`) and authorisation matrix
      (`test/authorization-matrix.e2e-spec.ts`): every mutating route called as Viewer / Auditor / Reviewer
      on the demo seed (items in every state, a view-restricted space) changes nothing; Viewers get 403/404 on
      every workspace GET. No gaps found.
- [x] 2. Headers / CSP, CORS, cookies, CSRF: the CSRF guard also checks `Origin` (CORS_ORIGINS or the
      request host; blocks sub-domain cookie tossing); nginx security headers moved into one snippet
      included by every location (`/` and `/assets/` had lost `Permissions-Policy`), plus COOP.
      Tests: `test/security.e2e-spec.ts`.
- [x] 3. XSS: rich text (DOMPurify server + client, same allow-list), BPMN (DTD/entities rejected,
      labels rendered as SVG text), comments / search snippets / AI answers (React text only, no
      `dangerouslySetInnerHTML` anywhere), emails (escaped, links from `APP_URL`), downloads
      (`attachment`, `nosniff`, `sandbox` CSP). Fixed: SVG logos lose external CSS references
      (`@import`, `url(https://…)`), logo response gets `sandbox`; more SVG vectors in the unit test.
- [x] 4. Uploads (allow-list + magic bytes + size limits — fine), path traversal (process codes / space
      keys are regex-checked, Git paths drop `..`, storage keys are UUIDs — fine). **SSRF fixed**:
      `src/common/outbound.ts` blocks internal addresses for Git (GitLab / GitHub Enterprise URL) and SMTP
      unless listed in the new `OUTBOUND_ALLOWED_HOSTS` (Compose default `mailpit`); the checked address is
      the one connected to (no DNS rebinding); plain `http://` Git URLs only for allowed hosts; redirects are
      never followed; new error code `GIT_HOST_BLOCKED` (EN/AR). The AI provider URL is not configurable in
      the UI (only `ANTHROPIC_BASE_URL` in the environment).
- [x] 5. Secrets: Git token, SMTP password and AI key are write-only, encrypted (AES-256-GCM) and
      scrubbed from error messages; a new cross-cutting test configures all three plus user passwords,
      triggers failing Git / email calls and checks API responses, audit entries, stored settings, sync
      items and log output for any plaintext secret or password hash; refresh tokens stored hashed.
      **Fixed:** `SecretBox.decrypt` now requires a full 16-byte GCM tag (Node accepted truncated tags).
- [x] 6. Dependencies: `react-router-dom` 6 → 7.18 (two advisories; the app already used every v7 future
      flag, so only the flag props were removed), `vitest` 3 → 4.1 (path traversal in the dev server),
      `js-yaml` ≥ 5.4.1 via an override (from `@nestjs/swagger`). `pnpm audit --prod`: no high/critical,
      4 moderate in MinIO's `stream-json` / `decode-uri-component` (code paths not used — SECURITY.md).
      Full audit: 1 high, `braces` via Jest (dev-only, no fixed version exists) — decision needed.
- [x] 7. `docs/SECURITY.md`: scope and method, findings SEC-01 – SEC-09 with status, controls per OWASP
      category, rate limits, the endpoint table (generated; `route-security.e2e-spec.ts` fails when it is out
      of date, when an input is unvalidated or a route lacks an access declaration), remaining risks, go-live
      configuration checklist and an external penetration-test checklist. DECISIONS D-047 – D-050, BACKLOG,
      README (security highlights, `OUTBOUND_ALLOWED_HOSTS`), CLAUDE.md phase table updated.

#### Verification (part 1)

| Check                                              | Result                                                                                                                                                                         |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `pnpm format:check`, `pnpm lint`, `pnpm typecheck` | clean (lint found `react-refresh` warnings hidden by the removed `ROUTER_FUTURE` export; fixed by moving the route guard components to `apps/web/src/app/RouteGuards.tsx`)     |
| `pnpm test`                                        | **332 tests pass** — shared 64, web 31, API 237 (34 suites; new: `authorization-matrix`, `security` e2e, `outbound` unit, route-security extended, SVG and GCM-tag unit tests) |
| `pnpm build`                                       | passes                                                                                                                                                                         |
| `pnpm e2e` (Playwright, Vite dev + built API)      | 8 smoke tests pass on React Router 7 (also exercises the CSRF origin check through the Vite proxy)                                                                             |
| nginx                                              | `nginx -t` passes in `nginx:1.27-alpine`; `/`, `/assets/…` and SPA routes all return CSP, Permissions-Policy, COOP, X-Frame-Options                                            |
| SMTP through the SSRF guard                        | real delivery to Mailpit when allowed (connects to the checked IP with `servername`); refused when not listed                                                                  |
| `pnpm audit --prod`                                | no high/critical; 4 moderate (MinIO transitive, unused paths — SEC-09). Full audit: 1 high `braces` (dev-only via Jest, no fix — SEC-08)                                       |

Docker: as in earlier phases the sandbox reaches the internet only through a TLS-intercepting proxy, so base
images came from `mirror.gcr.io` and the two app images were built from the committed Dockerfiles in a clean
clone with an uncommitted CA line and `docker build --network host`, then started with `docker compose up`.
Result: five services healthy, demo seeded; nginx sends the full header set on SPA routes; the 8 Playwright
smoke tests pass against `http://localhost:8080`; Settings → Email test mail reaches Mailpit through the SSRF
guard (`OUTBOUND_ALLOWED_HOSTS=mailpit`); a foreign `Origin` gets `CSRF_INVALID`. This check found that the
web image no longer type-checked after the Vitest 4 upgrade (Node types were only pulled in transitively):
`@types/node` is now a web dev dependency and listed in the web tsconfig.

### Next (at the end of that part — superseded)

1. Review and merge `phase-6-part-1` (new env var `OUTBOUND_ALLOWED_HOSTS`: add internal Git / SMTP servers
   to it on existing installations, otherwise they are blocked).
2. Decisions for you: `braces` (BACKLOG "Needs a decision"); whether TLS/HSTS will be handled by your own
   reverse proxy (the deployment guide part will document it either way).
3. Next Phase 6 parts (suggested order): TOTP two-factor and SSO (Azure AD / OIDC); slim API runtime image
   (removes dev dependencies, SEC-08); performance; deployment guide; external penetration test with
   `docs/SECURITY.md` §8.

## AI phase — 2026-10-21 (merged into `main`)

**Phase "AI" (M16 AI Assistant) is complete on branch `phase-ai-assistant`, awaiting review.** Phases 1–3 are
merged into `main`. The brief was built in three parts, committed separately (A, B, C) — all done, documented in
`docs/AI-DEMO.md` (manual demo script with a real key) and DECISIONS D-038 – D-046.

### Done in this phase

**Phase 3 open items (decided by the product owner)** — commit "Governance: block self-approval…"

- Four-eyes principle: a submitter who is the only possible approver of a step cannot submit
  (`SELF_APPROVAL_NOT_ALLOWED`, bilingual message with the step name) (D-038).
- New system role **Auditor**: read-only workspace (drafts, history, reviews, audit log, dashboard,
  AI usage), no edit/comment/approve/publish; new permission `reviews.decide` keeps read-only users out of
  approval steps (D-039). Demo user `auditor@processhub.local`. Viewers stay portal-only.
- PDF stays browser print (Gotenberg remains in the Phase 6 backlog).

**Part A — AI platform, generate process from text, translate EN ↔ AR**

- `apps/api/src/ai`: provider interface + Anthropic Claude (`@anthropic-ai/sdk`, streaming, structured
  output, refusal fallback), gateway with access checks, per-user daily and organisation monthly limits,
  one repair attempt for invalid output, usage table + audit log (D-040, D-041). SSE streaming to the UI.
- Settings → AI (Super Admin): enable, provider, model / fast model, encrypted API key (write-only),
  test connection, allowed roles, limits, data notice EN/AR, suggestion chips per feature.
  **AI usage** page (Administration menu): totals per user, feature, model, 12-month trend.
- Feature 1 — generate a process from a description (Arabic or English): in the modeler (✨ AI menu →
  replaces the diagram, saved as draft) and in the "New process" dialog (fills names/descriptions, saves the
  diagram as the new process's draft model). Server builds BPMN with lanes per role and a layered layout
  (D-042), validates it, proposes links to library roles/IT systems (user confirms), lists roles/systems not in
  the library, shows validation warnings. Preview with a read-only diagram before anything is saved.
- Feature 4 — translate: form fields (every bilingual form except people's names: "✨ Translate into …"
  fills the empty language), BPMN labels and step descriptions in the modeler (only missing ones, editable
  review table, applied as undoable edits), wiki pages (preview, then fills the other language tab). The
  library's EN/AR names are sent as a glossary.
- "AI-generated — review before publishing" badge on processes/pages until a human edits or approves (D-043).
- Suggestion chips: seeded demo prompts for every feature (Settings → AI → Suggestion chips).
- Tests: `FakeAi` replaces the provider in every test; `test/ai.e2e-spec.ts` (settings & key never
  returned, roles, limits, generate with library links, malformed fixtures → repair / rejection, provider
  errors, permissions, AI flag, translate fields/BPMN/page with sanitising, usage report),
  `src/ai/bpmn/structure-to-bpmn.spec.ts` (layout without overlaps, round trip, escaping).
- Also fixed: the modeler's "fit" now centres the diagram right of the palette (it used to sit off-centre).

**Part C — analyse & improve, portal Q&A** (D-045, D-046)

- Feature 5 — modeler ✨ AI → "Analyse & improve" (also for read-only users) and "Explain with AI" in the
  Validation tab: drawer with an assessment, findings (missing step, unclear responsibility, bottleneck, risk,
  control, improvement; severity; explanation; suggestion; clickable steps) and plain-language warnings.
- Feature 7 — Knowledge Portal: "✨ Ask" in the header and "Ask the assistant" + sample questions on the portal
  home. Answers stream, cite numbered sources (links to the published process/page with version label), say
  clearly when the published content does not cover the question. Retrieval: full-text search over current
  publications the user may see (no pgvector, D-045); processes contribute their published version only.
- Seed: published page "Requesting IT Equipment" (IT Policies) so the demo question has an answer.
- Tests: `test/ai-portal.e2e-spec.ts` (analysis with unknown ids dropped and repair; Q&A uses published content
  only — never drafts, restricted spaces without a grant, or the working copy of a process; grants; not-found
  without an AI call; AI roles and portal access), `toAnyTsQuery` unit test.

### Next (at the end of that part — superseded)

1. Review and merge `phase-ai-assistant`; run `docs/AI-DEMO.md` once with a real API key before the management
   demo (the suite only uses a fake provider).
2. Decisions for you: see "Needs a decision" in `docs/BACKLOG.md` and the AI follow-ups listed there.
3. Then Phase 4: GRC, EA, KPIs + Salesforce.

### Verification (AI phase)

| Check                                                                                                                                       | Result                                                                                                                                                                                                                                                                                                                                                                                                              |
| ------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm format:check`, `pnpm lint`, `pnpm typecheck`                                                                                          | clean                                                                                                                                                                                                                                                                                                                                                                                                               |
| `pnpm test`                                                                                                                                 | **286 tests pass** — shared 64, web 31, API 191 (31 suites; new: `ai`, `ai-features`, `ai-portal`, `auditor` e2e, layout/outline/diff unit tests). The AI provider is always the fake `FakeAi`; malformed-output fixtures prove validation and the single repair attempt                                                                                                                                            |
| `pnpm build`                                                                                                                                | passes                                                                                                                                                                                                                                                                                                                                                                                                              |
| `pnpm audit --prod --audit-level high`                                                                                                      | no high/critical (7 moderate, pre-existing; the Anthropic SDK adds none). Full audit: only the known dev-only `braces` advisory (BACKLOG)                                                                                                                                                                                                                                                                           |
| `docker compose up` from a clean clone                                                                                                      | five services healthy; all 4 migrations applied; full demo seeded incl. AI demo settings (disabled) and the "Requesting IT Equipment" page; with AI disabled `/ai/status` says DISABLED, AI endpoints 403 and no ✨ buttons render; after enabling (key via API) generation streams through nginx unbuffered (SSE chunks arrive progressively) and the portal assistant answers with its source                     |
| Browser (Playwright, dev servers; the real `AnthropicProvider` against a local mock of the Messages streaming API via `ANTHROPIC_BASE_URL`) | Settings → AI save + test connection; New process → generate → preview → create; modeler label translation; page and form-field translation; refine with chat → compare → accept; summary, "what changed" on the review screen; SOP generation → page created; process from page; analyse drawer with clickable steps; portal assistant EN/AR incl. "not covered"; AI usage page; Arabic RTL and 390 px phone width |

Docker note: as in earlier phases the sandbox reaches the internet only through a TLS-intercepting proxy, so the
base images came from `mirror.gcr.io` and the two app images were built from the committed Dockerfiles in a clean
clone with an uncommitted CA line and `docker build --network host`, then started with `docker compose up`.

Also found and fixed while testing in the browser: the modeler's fit-to-screen placed diagrams under the palette
(now centred in the free area); the Settings → AI form dropped the suggestion chips when saved with the panel
collapsed; generated diagrams got new process/pool ids on every refinement (now kept, so the compare matches).

## Phase 3 — 2026-10-21 (merged into `main`)

**Phase 3 (Governance M8, Knowledge Portal M9): complete, merged into `main`.** Phases 1 and 2 are merged into `main`. Every item of the Phase 3 brief is implemented, covered by
API tests (including a Viewer sweep over every route) and Playwright smoke tests, and verified in the browser
(English and Arabic, desktop and phone width) and with `docker compose up` from a clean clone.

Decisions taken at the start of Phase 3 (by the product owner): keep `bitnamilegacy/minio` (Phase 6); keep
browser "Save as PDF" (D-024/D-035, Gotenberg noted for Phase 6); never export pages of view-restricted spaces;
warn about backing up `INTEGRATIONS_ENCRYPTION_KEY` (Settings → Integrations and README); Viewers see
published content only, through the portal (D-028). The blueprint gained **M16 AI Assistant**, planned after
Phase 3 (not built).

### Phase 3 — done

**Governance (M8)**

- Lifecycle Draft → In Review → Approved → Published → Archived, plus "Changes requested" / "Rejected" back to
  Draft, for processes and pages. Transitions enforced on the server (one table in `packages/shared`), atomic,
  audited (D-029). In-review and archived items are locked; editing an approved/published item makes a new
  working copy (Draft) while the published version stays live in the portal.
- Publications: each publication is linked to a saved version and its label (e.g. `v2.0`), records approvers,
  approval date and publisher; the item gets its next review date. History of reviews and publications per item.
- Workflows (Settings → Workflows): templates with sequential steps; assignees are users, a system role
  (optionally within a department) or the item owner; rule "any one of" or "all"; optional auto-publish.
  Defaults globally, per process category and per space; per-item template or custom steps (D-030). Assignees
  are snapshotted at submission; submitters never approve their own items.
- Review page: visual BPMN diff (or page text diff) against the published version, change list, the
  submitter's note, step progress; approve, request changes (comment required) or reject (comment required).
- Comments: threaded, on processes and pages, anchored to BPMN elements (💬 badges on the canvas, Comments tab
  in the modeler), @mentions with autocomplete, resolve/reopen, edit/delete own (D-032).
- Notifications: bell with unread count, notification centre, per-user preferences for email by type. Events:
  review requested, changes requested, rejected, approved, published, mentioned, reply, review due/overdue,
  feedback received/updated. Email via SMTP settings (Settings → Email, encrypted password, test email),
  bilingual HTML templates; Mailpit in Docker Compose; tests use a fake transport (D-033).
- Review dates: next review on publication (default 12 months), reminders before and after the due date by a
  scheduler, overdue flags, "confirm still valid"; review due dates for running reviews (D-034).
- My tasks (reviews to do, returned items, items to publish, due periodic reviews, mentions, feedback) and
  the Governance dashboard (counts per state, running reviews with their age, overdue and soon-due periodic
  reviews, recent publications, open feedback).
- Documents library (repository object type DOCUMENT) so steps can link to documents shown in the portal;
  step descriptions (EN/AR) in the modeler side panel; job roles on users (for "My processes").

**Knowledge Portal (M9)** at `/portal`, the home of Viewers

- Home: portal name/tagline and logo, search hero, process house, featured and recently published items,
  quick links. Process browser (tree per category) and process page: diagram with clickable steps (performers,
  systems, documents, description), drill-down into sub-processes, linked documentation.
- Documentation: spaces, page tree, page with table of contents, embedded diagrams, related processes.
- Search in English and Arabic with type/category/space filters and highlighted snippets (D-031).
- "My processes": items owned by me, of my department or performed by my job roles (with "your steps").
- Every item shows version label, approval date, approver(s), owner, next review date and an "Official" badge.
- Feedback on any item, routed to the owner (status Open / In progress / Done, reply, notifications);
  "My feedback" page.
- Download PDF: print-optimised view (diagram + step details / page content, metadata, Arabic RTL) that opens
  the print dialog (D-035).
- Settings → Knowledge Portal: name and tagline EN/AR, featured items, quick links, access (all users or
  selected departments and roles).
- Viewers cannot reach draft, in-review, approved-unpublished or archived content via any endpoint (D-028);
  workspace URLs redirect them to the portal.
- Git: "Published versions only" option (D-036).

**Seed data** (demo installation)

- Demo users per role: viewer / reviewer / owner / modeler `@processhub.local`, password `SEED_DEMO_PASSWORD`
  (default `Demo-Password1`); email settings pointing at Mailpit.
- Two workflows ("Standard approval (two steps)": Quality review by any Reviewer → Owner approval; "Policy
  review (any one reviewer)").
- Content in every state: S.01.01 published v1 with v2 in review; C.02 in review with the overdue owner step;
  C.03 approved, waiting for publication; M.01 published 13 months ago (periodic review overdue); M.02
  archived; S.02 changes requested; pages published / in review / approved.
- Comments with replies and mentions, notifications, two feedback items, portal settings with featured items
  and quick links.

### Verification (Phase 3 session)

| Check                                              | Result                                                                                                                                                                                                                 |
| -------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm format:check`, `pnpm lint`, `pnpm typecheck` | clean                                                                                                                                                                                                                  |
| `pnpm test`                                        | **238 tests pass** — shared 61, web 31, API 146 (25 suites; new: governance, portal incl. Viewer sweep and Git published-only, comments and notifications, email templates)                                            |
| `pnpm e2e` (Playwright)                            | 8 smoke tests pass against the Vite dev server and against the Docker stack                                                                                                                                            |
| `pnpm build`                                       | passes                                                                                                                                                                                                                 |
| `pnpm audit --prod --audit-level high`             | no high/critical (nodemailer upgraded to 10.0.16); 7 moderate, pre-existing. The full audit still lists the dev-only `braces` advisory (no upstream fix, see BACKLOG)                                                  |
| `docker compose up` from a clean clone             | five services healthy (postgres, minio, mailpit, api, web); migrations and full demo seeded; test email and a scheduler reminder delivered to Mailpit                                                                  |
| Browser (Playwright screenshots)                   | portal home/process/page/search/print (EN + AR RTL, 390 px phone), review page with BPMN diff, approve → approve → publish v2.0 flow, feedback, @mention comment, My tasks, dashboard, workflows/portal/email settings |

Docker note: as in earlier phases this sandbox reaches the internet only through a TLS-intercepting proxy and
Docker Hub rate-limited it, so the base images were pulled from `mirror.gcr.io` and the two app images were
built from the committed Dockerfiles in a clean clone, with an uncommitted CA line and `docker build --network
host`, then started with `docker compose up`. The committed Dockerfiles need no change.

### Phase 2 (Documentation wiki, version control, Git) — done, merged into `main`

**Documentation wiki (M5)**

- Spaces: bilingual name/description, icon, owner, department, immutable key (used in Git paths). Per-space
  view/edit restrictions with grants for users, system roles and departments, on top of the new global
  permissions `docs.read` / `docs.edit` / `docs.manage` (D-020). Owners manage their space.
- Pages: hierarchical tree per space with drag-and-drop re-order/re-parent, breadcrumbs, sub-page list,
  soft delete into a per-space trash (page + sub-pages as one batch), restore (to the top level when the
  parent is gone), permanent deletion for administrators.
- Editor (TipTap 3): headings, bold/italic/underline/strike/code, bullet/numbered/check lists, tables,
  code blocks, quotes, five callout types, horizontal rule, links (safe URLs only), images and file
  attachments (MinIO, type + size checked, D-022), embedded read-only BPMN diagrams of repository processes,
  page-level and paragraph-level LTR/RTL. English and Arabic tabs.
- Bilingual reading: the reader's language with fallback and a notice, an "available in" indicator, a
  language switch per page; untranslated pages are marked in the tree.
- Templates: SOP, Policy, Work Instruction, Guide, Meeting Notes, Blank — bilingual, built-in, editable by
  administrators (who can also add their own); picked when creating a page.
- Links: pages ↔ processes and repository objects (roles, systems). Embedding a diagram links the process
  automatically. "Related documentation" tab on processes and card on library objects; "Related processes &
  objects" panel on pages.
- Search: PostgreSQL full-text search over page titles/content (English + Arabic stemming, prefix matching)
  and processes, permission-filtered, with highlighted snippets and filters for type, space and author
  (D-021). Header quick search and a search page.
- Export: Markdown with front-matter (server) and PDF through a print layout (D-024).
- Sanitisation: DOMPurify on the server on every write and in the browser on render (D-018).

**Version control (M6)**

- Pages: every Save creates a version with change note, author, time; autosave keeps a private draft that is
  never a version and can be restored or discarded; conflicting saves are detected (D-019).
- Processes: the working model autosaves as a draft; Save creates a version with a change note.
- History for both: list, preview, restore (always as a new version, `restoredFrom` recorded), labels such as
  "v1.0 – approved by committee". Restores and labels are audited (`RESTORE`, `LABEL`).
- Compare: BPMN visual diff with bpmn-js-differ — two synchronised canvases, coloured markers, clickable
  change list, compare any two versions or the current draft (D-023); pages: side-by-side and inline diff with
  word-level highlights, per language.

**Git integration (M7)**

- Settings → Integrations (Super Admin): enable/disable, GitHub or GitLab (self-hosted URL), repository,
  branch, folder, token encrypted with AES-256-GCM and never returned, "Test connection", what to sync
  (processes / pages) and when (every version / manual) (D-025).
- Export: processes as `.bpmn` + `.json` metadata, pages as Markdown with front-matter (id, title, space,
  language, version, author, updated); folders mirror the process house and the space/page tree.
- One commit per sync, authored as the user, e.g. `Update C.02.03 Order Handling — v5: <note>`; "Sync now"
  reconciles everything in one commit; renamed/moved/deleted items are removed from their old paths;
  unchanged files are skipped.
- Sync status page: last sync, counts, per-item status with translated error codes, commit links, retry.
- With the integration disabled nothing happens. Tests mock the providers; no real service is called.

**Seed data**

- Six built-in templates (created when missing, never overwritten).
- Spaces "Quality Management" (QM) and "IT Policies" (ITP) with 8 bilingual pages from the templates, linked
  to demo processes, roles and systems, two with embedded diagrams. "Purchase Requisition Procedure" has
  three versions (one labelled). The Purchase Requisition model gets a second version (budget check added,
  review step renamed) for compare/restore.
- Only on a demo installation: skipped when spaces exist or the demo processes are missing.

### Verification (Phase 2 session)

| Check                                                            | Result                                                                                                                                                                                                                                                                                                                                                                           |
| ---------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm format:check`, `pnpm lint`, `pnpm typecheck`               | clean                                                                                                                                                                                                                                                                                                                                                                            |
| `pnpm test`                                                      | **192 tests pass** — shared 44, web 31, API 117 (21 suites: unit + e2e for every endpoint against PostgreSQL 16, Git providers and sync with mocked HTTP)                                                                                                                                                                                                                        |
| `pnpm build`                                                     | passes                                                                                                                                                                                                                                                                                                                                                                           |
| `pnpm audit --prod --audit-level high`                           | no high/critical; 7 moderate, all pre-existing transitive (see BACKLOG)                                                                                                                                                                                                                                                                                                          |
| `docker compose up` from clean volumes                           | all four services healthy; both migrations, templates and docs demo seeded; restart keeps generated secrets and does not duplicate data                                                                                                                                                                                                                                          |
| Browser (Playwright, Vite dev server and the Docker/nginx build) | spaces, page tree, reader EN/AR, editor (text, callout, image upload, diagram embed, RTL paragraph), save as version, autosaved draft, history diff side-by-side/inline, restore, labels, trash/restore, permissions drawer (Arabic), search EN/AR, process Documentation tab, BPMN visual compare, settings integrations, sync status, templates, print view; no CSP violations |

Two editor bugs found in the browser run were fixed and covered by tests (atom nodes being replaced by the
next insert; paragraph direction leaking to the containing callout).

Note on the Docker check: as in Phase 1, this sandbox reaches the internet only through a TLS-intercepting
proxy, so the images were built with a temporary, **uncommitted** Dockerfile copy that trusts the proxy's CA
(`docker build --network host`), then started with `docker compose up --no-build`. The committed Dockerfiles
need no such change.

### Phase 1 (Foundation) — done, merged into `main`

**Project setup**

- pnpm monorepo: `apps/web` (React 18 + Vite + Ant Design 5), `apps/api` (NestJS 11 + Prisma 6),
  `packages/shared` (zod schemas, types, constants, pure business rules).
- Docker Compose: PostgreSQL 16, MinIO, API, web (nginx). Works without a `.env` for a local trial.
- `.env.example` documents every variable. Strict TypeScript, ESLint (flat config), Prettier.
- GitHub Actions CI: format, lint, type-check, all tests against PostgreSQL, build, prod audit, Docker build.

**Platform core (M1)**

- Sign-in/out, argon2id, JWT access + rotating refresh tokens in httpOnly cookies, double-submit CSRF,
  rate limiting (global + stricter on auth), account lockout, helmet, strict CORS, request size limits.
- Six system roles with permission bundles (CLAUDE.md §6), enforced by deny-by-default guards.
- Admin: users (create, edit, deactivate/activate, roles, reset password, unlock), hierarchical
  departments, filterable audit log (action, entity, date range, search) with before/after details.
- Settings (Super Admin): organisation name EN/AR, logo upload (MinIO, sanitised), default language,
  Integrations placeholder (GitHub/GitLab disabled, Phase 2).
- Audit entries for every create/update/delete/move/version and for sign-in, failed sign-in, lockout,
  sign-out, password change/reset.
- Profile: name, preferred language, change password (signs out other sessions).

**Arabic / English**

- i18next with complete `en` and `ar` files (`apps/web/src/locales/{en,ar}/*.json`), Arabic plurals.
- Header language toggle; Arabic switches the whole layout to RTL (ConfigProvider + logical CSS
  properties). Self-hosted Inter and IBM Plex Sans Arabic. Dates/numbers via `Intl`.
- Bilingual business fields everywhere with fallback to the other language.
- A test fails if any translation key is missing in either language, if a key used in code does not
  exist, or if an API error code has no translation.

**Process House & Repository (M2)**

- Process house landing page (Management / Core / Support bands with tiles).
- Process tree on the inline-start side (left in LTR, right in RTL): drag-and-drop re-order and
  re-parent (category and level cascade), search with highlighting, breadcrumbs.
- Process detail: code, names, descriptions, category, owner, department, status (Draft), sub-processes,
  linked objects, model tab. Create / edit / soft-delete with server-side permission checks.

**Process Modeler (M3)**

- bpmn-js editor in the process page; read-only viewer for users without edit rights.
- Bilingual labels stored in the XML (`ph:nameEn` / `ph:nameAr`), active language shown on the canvas.
- Save (working model) and Save as version (change note); version list with read-only preview.
- Export BPMN XML, SVG, PNG; import `.bpmn`. Validation panel (start/end events, unconnected elements,
  missing flows, unnamed activities, non-branching gateways, unlinked call activities).
- Drill-down: call activities / sub-processes link to another process (overlay button + panel link).
- Unsaved-changes guard (route change and browser close), Ctrl/⌘+S.

**Object Repository (M4)**

- Roles and IT Systems libraries (bilingual name/description, code, free attributes).
- Link tasks to roles (PERFORMS) and systems (SUPPORTS) from the modeler side panel; count badges on
  the canvas. Object page with "where used" report linking to the exact step.
- Data model supports DOCUMENT, RISK, CONTROL, KPI already.

**Seed data & docs**

- Idempotent seed: roles/permissions, Super Admin from env, 7 departments, 11 bilingual processes,
  6 roles + 5 IT systems, 2 bilingual BPMN models with links (one with a drill-down call activity).
- README, this file, DECISIONS.md, BACKLOG.md.

## Next

See "Next (continue here)" at the top. After the AI phase: Phase 4 (GRC, EA, KPIs + Salesforce).

## Known issues / limitations

- AI: tested only against a mocked provider (no real API calls in the suite); run `docs/AI-DEMO.md` with a
  real key before a demo. Generating into an existing process replaces its diagram (the layout is
  automatic; hand-made positions are not kept) — save a version first. Requests run in the API process
  (no queue); the per-user/organisation limits are counted from the usage table.

- PDF export uses the browser's print dialog ("Save as PDF"), not a direct download (D-024, D-035).
- Emails and reminders run in-process; with several API instances the scheduler runs in each (reminders are
  de-duplicated in the database, but a queue is in the backlog). Notifications refresh every minute (polling).
- The Playwright smoke tests are not yet in CI (they need the whole stack).
- Git sync: one-way; process renames/moves without a new version reach Git with the next version or
  "Sync now"; jobs run in-process (single API instance); pages of view-restricted spaces are not exported.
- Autosaved page drafts are per user; two people editing the same page at once get a conflict on the second
  save (no live co-editing).
- MinIO uses the frozen `bitnamilegacy/minio` image (D-009, revisit in Phase 6).
- Secure cookies (`COOKIE_SECURE=true`, the default) need HTTPS or `localhost`.
- The API e2e tests **truncate every table** of the database in `TEST_DATABASE_URL`. Never point it at real data.
- `INTEGRATIONS_ENCRYPTION_KEY` must be backed up with the data; if it changes, stored Git tokens and the SMTP
  password must be re-entered.
- Moderate dependency advisories (react-router 6, minio, swagger transitive) — see BACKLOG.
- External BPMN labels keep their original size when the language is switched (from Phase 1).
