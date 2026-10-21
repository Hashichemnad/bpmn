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
_Update (Phase 2): decided to keep this image for now and revisit in Phase 6._

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

## D-018 — Wiki content: sanitised TipTap HTML, current version on the page row

Pages store the editor's HTML per language (`contentEn` / `contentAr`) plus a page-level direction
(`dirEn` / `dirAr`). The `Page` row always holds the latest explicitly saved version; `PageVersion` rows are
immutable snapshots. HTML is sanitised with DOMPurify on the server on every write (tags, attributes and
`data-*` values from a shared allow-list, links limited to http(s)/mailto/in-app paths, images limited to
ProcessHub attachments) and again in the browser before rendering. Plain text (`textEn` / `textAr`) is
derived on save for search and snippets. Rendering uses TipTap in read-only mode with the same schema, so
embedded diagrams and callouts look identical in the editor and the reader.

## D-019 — Explicit saves are versions; autosave is a draft

Pages: every Save requires a change note and creates a version; the editor autosaves every few seconds into
a _per-user_ `PageDraft` that is never visible to others and is offered for restore when the editor opens.
A save sends the version it started from and fails with `PAGE_CHANGED` if someone saved in between
(optimistic concurrency). Processes: the existing working model (`ProcessModel`) became the autosaved draft
(shared, as in Phase 1), and the modeler's **Save** now always creates a version with a change note. The
Phase 1 "Save" + "Save as version" pair was merged into this single action.

## D-020 — Space permissions

Global permissions `docs.read`, `docs.edit` and `docs.manage` (all roles read; Modeler and Process Owner edit;
Admin/Super Admin manage). On top, a space can restrict viewing and/or editing to listed users, system roles
or departments (`SpaceGrant`, VIEW or EDIT). A grant never replaces the global permission (a Viewer with an
EDIT grant still cannot edit). Space owners and `docs.manage` holders always have full access. Users without
view access get 404 (the space's existence is not revealed). The rule is a pure function in
`packages/shared` (`spaceAccess`). Department grants match the user's own department only (no inheritance
down the tree yet — see BACKLOG). Moving pages, trash and restore need edit rights; permanent deletion needs
`docs.manage`.

## D-021 — Full-text search in PostgreSQL

`Page.searchVector` (tsvector, GIN index) is maintained by a database trigger: titles weight A, content
weight B, English and Arabic stemming (`english` / `arabic` configurations). Queries are built from letters
and digits only (no tsquery operators can be injected) as prefix terms (`word:*`), run against both
configurations; prefix matching also evens out Arabic stemming differences between word forms. Processes are
searched with vectors computed on the fly (the table is small) plus a code-prefix match. Raw SQL uses
Prisma's tagged templates (parameterised). Highlights use private-use marker characters that the client
turns into `<mark>` elements, so snippets never carry HTML.

## D-022 — Attachments

Stored in MinIO under `attachments/<pageId>/<id>`. Allowed types: images (PNG, JPEG, GIF, WebP), PDF,
DOCX/XLSX/PPTX, TXT/CSV/MD/BPMN, up to 10 MB; the extension must be on the allow-list _and_ the content must
match it (magic bytes, or valid UTF-8 for text). SVG is not accepted. Files are served with
`Content-Security-Policy: default-src 'none'; sandbox`, `nosniff` and `attachment` disposition (images
inline). Removing an attachment hides it from the list but keeps the file, because older page versions may
still show it; purging the page deletes the files.

## D-023 — Version compare

BPMN: `bpmn-js-differ` (semantic diff of two bpmn-moddle trees, including the `ph:` label attributes),
rendered in two synchronised read-only viewers with markers (added green, removed red, changed amber, moved
blue) and a change list. bpmn-js-differ 3.x reports attribute `oldValue`/`newValue` swapped; the wrapper
corrects this (covered by a test). Pages: HTML is flattened into text blocks (headings, paragraphs, list and
task items, table rows, embeds), diffed with `jsdiff` at block level, and changed blocks get a word-level
diff that tokenises on whitespace so Arabic is compared by words, not characters.

## D-024 — PDF export through the browser

A print-optimised page (`/print/pages/:id?lang=`) opens the browser's print dialog ("Save as PDF").
Browsers shape Arabic, lay out RTL and render the embedded BPMN SVGs exactly as on screen, which server-side
PDF libraries without a headless browser do not. A server-generated PDF (e.g. Gotenberg/Chromium) is in the
backlog if downloads without a dialog are needed. Markdown export is generated on the server (Turndown + GFM).

## D-025 — Git integration

- Settings live in `Setting['integrations.git']`; the token only as AES-256-GCM ciphertext (`v1.<iv>.<tag>.<data>`)
  with `INTEGRATIONS_ENCRYPTION_KEY` (generated and persisted by the Docker entrypoint when empty, like the
  JWT secret). The API never returns the token; it is scrubbed from error messages and audit summaries.
- GitHub uses the Git Data API (tree + commit + ref update), GitLab the Commits API with actions, so a sync is
  always exactly one commit with several files, authored as the ProcessHub user (GitHub keeps the token
  owner as committer). Files whose content is unchanged (git blob SHA) are skipped, so no empty commits.
- Paths mirror the process house (`processes/<category>/<code-name>/…/<code>.bpmn` + `.json`) and the space/
  page tree (`docs/<KEY>/<slug-id8>/…/index.<lang>.md`). Page segments end with 8 characters of the page id
  because titles are not unique. Previously written paths are tracked per item (`GitSyncItem.paths`) and
  removed in the same commit after renames, moves or deletions.
- Pages of view-restricted spaces are never exported (the repository may be readable by more people).
- Triggers: on every version (processes, pages; also page move/delete/restore) or manual. "Sync now"
  reconciles all items in one commit. Process metadata changes without a new version are picked up by the
  next version or "Sync now".
- Jobs run one at a time in an in-process queue (single API instance; Redis/BullMQ in the backlog for scaling).
  When the integration is disabled the event handler returns immediately, so behaviour is unchanged.
- One-way only; two-way sync is in the backlog. Tests replace the HTTP layer and the providers; the suite
  never calls GitHub or GitLab.

## D-026 — In-process domain events

Modules publish small events (`process.versioned`, `page.versioned`, `page.removed`, …) through a global
`DomainEvents` service; listeners run after the request and never fail it. This keeps the wiki and models
modules independent of the Git integration.

## D-027 — Viewer role in Phase 2

As decided for Phase 2, Viewers keep full read access (repository and documentation, `docs.read`). Restricting
them to published content remains a Phase 3 task (D-006).
