# Progress

Read this together with `CLAUDE.md` at the start of every session.

## Current state — 2026-10-21

**Phase 1 (Foundation): complete on branch `phase-1-foundation`, awaiting review.** All items of the
Phase 1 brief are implemented, tested and verified with `docker compose up --build` from a clean clone.

### Done

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

### Verification (this session)

| Check                                                                   | Result                                                                                                                                                                                                      |
| ----------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm format:check`, `pnpm lint`, `pnpm typecheck`                      | clean                                                                                                                                                                                                       |
| `pnpm test`                                                             | 107 tests pass — shared 26, web 14, API 67 (12 suites, including e2e for every endpoint against PostgreSQL 16)                                                                                              |
| `pnpm build`                                                            | passes                                                                                                                                                                                                      |
| `pnpm audit --prod --audit-level high`                                  | clean                                                                                                                                                                                                       |
| `docker compose up --build` from a fresh clone, no `.env`               | all four services healthy; migrations + seed run; restart keeps sessions and does not duplicate seed data                                                                                                   |
| Browser (Playwright) against Vite dev server and the Docker/nginx build | sign-in, process house, tree drag-and-drop, process create, modeler edit/save/version/export, role linking, Arabic RTL, viewer read-only mode, drill-down, admin pages; no console errors or CSP violations |

Note on the Docker check: this sandbox reaches the internet only through a TLS-intercepting proxy, so the
images were built with a temporary, **uncommitted** patch that trusts the proxy's CA certificate
(`--network host` + `NODE_EXTRA_CA_CERTS`). The committed Dockerfiles contain no such patch and need none on
a normal machine. Docker itself was available, so no fallback to local PostgreSQL/Node was needed for
the compose check (the test suite runs against a PostgreSQL 16 container).

## Next

1. Review and merge `phase-1-foundation`. Decide on the MinIO image (DECISIONS D-009).
2. Start Phase 2: M5 Documentation wiki (TipTap), M6 version compare/restore, M7 GitHub/GitLab sync.
   The process detail page and Settings → Integrations are prepared for these.

## Known issues / limitations

- MinIO uses the frozen `bitnamilegacy/minio` image (D-009).
- Secure cookies (`COOKIE_SECURE=true`, the default) need HTTPS or `localhost`. When serving over plain
  HTTP on another host name, sign-in will not stick; put the app behind TLS (recommended) or set
  `COOKIE_SECURE=false`.
- The API e2e tests **truncate every table** of the database in `TEST_DATABASE_URL`
  (default `processhub_test` on localhost). Never point it at a database with real data.
- External BPMN labels keep their original size when the language is switched.
- Dev-only advisory `braces` (through Jest) has no upstream fix; production dependencies are clean.
- Swagger UI (`ENABLE_SWAGGER=true`) lists the endpoints but not the request body schemas yet.
