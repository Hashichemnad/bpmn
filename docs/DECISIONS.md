# Technical decisions

One short entry per significant decision. Newest last. Changing the fixed stack in CLAUDE.md §4
requires an entry here.

## D-001 — Shared package: source for web, compiled CommonJS for api

`packages/shared` is built with `tsc` to CommonJS (`dist/`) for NestJS and the seed script. The web
app (Vite, Vitest) and the API's Jest config alias `@processhub/shared` to `src/index.ts`, so the
front end always uses the current source without a build step. Run `pnpm --filter @processhub/shared build`
before type-checking or running the API (the root scripts do this).

## D-002 — Validation with shared zod schemas, not class-validator

Request bodies and queries are validated by a `ZodPipe` using the same zod schemas the web forms use.
One source of truth for rules such as "a name in at least one language" or the process-code format.
Errors come back as `VALIDATION_ERROR` with per-field details.

## D-003 — Deny-by-default authorisation

A global `PermissionsGuard` rejects any route that does not declare `@Public()`, `@RequirePermissions()`,
`@RequireAnyPermission()` or `@Authenticated()`. An automated test (`route-security.e2e-spec.ts`)
enumerates every controller method and fails if one is undeclared, and pins the list of public routes.
Permissions (not role names) are checked; roles are permission bundles defined in
`packages/shared/src/constants.ts` and synced to the database by the seed.

## D-004 — Session design

- Access token: HS256 JWT, 15 minutes, `httpOnly; Secure; SameSite=Strict` cookie scoped to `/api`.
- Refresh token: random 48 bytes, stored as SHA-256 hash, rotated on every use, cookie scoped to
  `/api/v1/auth`. Tokens of one sign-in share a family; re-use of a rotated token revokes the family.
- CSRF: double-submit cookie (`ph_csrf`, readable by JS) echoed in `X-CSRF-Token` on every
  state-changing request, compared in constant time; rotated at sign-in. Applies to login too.
- The user and permissions are loaded on every request, so deactivation and role changes apply
  immediately. Access tokens issued before a password change/reset are rejected.

## D-005 — Ownership-based editing

`processes.edit` / `models.edit` allow editing any process; Process Owners hold `processes.edit_own` /
`models.edit_own`, checked against `Process.ownerId` in the service. Moving processes in the tree changes
the house structure and requires `processes.edit`. Only Admin/Super Admin can delete processes.
Owners cannot reassign ownership. Only a Super Admin can grant or modify the Super Admin role, and the
last active Super Admin cannot be removed.

## D-006 — Viewer role in Phase 1

The Viewer role has read-only access to the repository and library. Restricting Viewers to
_published_ content belongs to the Knowledge Portal (Phase 3) — see BACKLOG.

## D-007 — Bilingual BPMN labels live inside the XML

Labels are stored as extension attributes `ph:nameEn` / `ph:nameAr` (namespace
`http://processhub.io/schema/bpmn`) on each element, so a model is self-contained and exports keep
both languages. The standard `name` attribute is written English-first on save for other BPMN tools.
The editor shows the active language (falling back to the other) and stores canvas edits under the
active language in the same undoable command. Plain `name` values in imported files are assigned to a
language by script detection. No side table is needed.

## D-008 — Drill-down and object links

A call activity or sub-process links to another repository process through `ph:linkedProcessId`.
Object links (`ObjectLink`) reference BPMN element ids; links to elements that no longer exist are pruned
when the model is saved. Deleting a library object removes its links (the UI shows the usage first).
Step names for links and where-used reports are read from the saved model XML.

## D-009 — MinIO container image

MinIO stopped publishing community images on Docker Hub in 2025, and `quay.io` was not reachable from the
build environment. Docker Compose therefore defaults to `bitnamilegacy/minio:2025.4.22` (verified), which
receives no further updates. The image is configurable through `MINIO_IMAGE`, but the official image uses a
different start command and data path, so switching requires a compose change. **Needs a decision before
production** (options: official `quay.io/minio/minio` image, a self-built image, or another S3-compatible store).

## D-010 — Docker images

Both images build on `node:20-alpine` (Alpine already ships OpenSSL 3 for the Prisma engines, so no OS
packages are installed). The API runtime image keeps the build's `node_modules` so `prisma migrate deploy`
can run at start-up; slimming it is in the backlog. The web image serves the static build from nginx,
which also proxies `/api` so the browser sees a single origin (no CORS, strict cookies).

## D-011 — JWT secret generated per installation

If `JWT_ACCESS_SECRET` is empty, the API container generates a random 48-byte secret on first start and
keeps it in the `api-data` volume. This lets `docker compose up --build` work from a clean clone without
shipping a default secret. Real deployments may still set it explicitly.

## D-012 — Process code uniqueness

Codes are unique case-insensitively among non-deleted processes, enforced in the service. A partial unique
index cannot be expressed in the Prisma schema without migration drift; revisit if concurrent creation of the
same code becomes a concern.

## D-013 — Lockout message

A locked account receives `ACCOUNT_LOCKED` with the unlock time. This reveals that the account exists, a
deliberate usability trade-off for an internal system; other failures return a generic
`INVALID_CREDENTIALS`, and unknown e-mails spend the same argon2 time as real ones.

## D-014 — Process status is read-only in Phase 1

All processes are Draft. Status transitions belong to the governance workflow (Phase 3), so the update
endpoint does not accept a status.

## D-015 — Library versions

Following CLAUDE.md §4: React 18, Ant Design 5, NestJS 11, Prisma 6 (stable), Vite 6, Node 20, even where
newer majors exist. Upgrades should be planned deliberately (e.g. in Phase 6).

## D-016 — Uploaded logos

The file type is detected from magic bytes (PNG, JPEG, WebP, SVG), never from the client's MIME type.
SVGs are sanitised server-side with DOMPurify (scripts, event handlers, `foreignObject`, `use` and external
references removed) and served with `Content-Security-Policy: default-src 'none'` and `nosniff`.

## D-017 — Modeler direction

The bpmn-js canvas is always rendered LTR, also in the Arabic UI; Arabic labels render correctly inside the
SVG, and the surrounding panels follow the page direction.
