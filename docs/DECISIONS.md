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
- Outbound calls go only to the configured provider URL (set by a Super Admin), with a timeout
  (`GIT_HTTP_TIMEOUT_MS`) and redirects refused.
- One-way only; two-way sync is in the backlog. Tests replace the HTTP layer and the providers; the suite
  never calls GitHub or GitLab.

## D-026 — In-process domain events

Modules publish small events (`process.versioned`, `page.versioned`, `page.removed`, …) through a global
`DomainEvents` service; listeners run after the request and never fail it. This keeps the wiki and models
modules independent of the Git integration.

## D-027 — Viewer role in Phase 2

As decided for Phase 2, Viewers keep full read access (repository and documentation, `docs.read`). Restricting
them to published content remains a Phase 3 task (D-006).

## D-028 — Viewers use the Knowledge Portal only (Phase 3)

Replaces D-027. The VIEWER role now has a single permission, `portal.read`. Every workspace endpoint
(processes, models, objects, spaces, pages, search, governance) answers 403 to a Viewer; the web app sends
portal-only users to `/portal` from any workspace URL. Workspace users who only read (e.g. auditors) get the
REVIEWER role. The portal endpoints (`/api/v1/portal/*`) are a separate read model that only ever returns
**current publications** of non-archived, non-deleted items (see D-031), so a Viewer cannot reach draft,
in-review, approved-but-unpublished or archived content through any endpoint. This is covered by an API test
that calls every workspace and portal route as a Viewer.

## D-029 — Lifecycle on the item, working copy vs published version

- Processes and pages carry `status` (DRAFT, IN_REVIEW, APPROVED, PUBLISHED, ARCHIVED). Allowed transitions
  are one table in `packages/shared/src/governance.ts` (`TRANSITIONS`), enforced in the API inside the same
  transaction as the change (`UPDATE … WHERE status = <expected>`), and audited (`SUBMIT`, `APPROVE`,
  `REQUEST_CHANGES`, `REJECT`, `PUBLISH`, `ARCHIVE`, …). "Changes requested" and "Rejected" return the item to
  DRAFT; the review keeps the outcome and the mandatory comment.
- A review is always for one **saved version** (`Review.versionNumber`); unsaved model changes block
  submission. While IN_REVIEW or ARCHIVED the item is locked for editing. Editing an APPROVED or PUBLISHED item
  moves it back to DRAFT (the working copy); the published version stays visible in the portal until a newer
  version is published.
- `Publication` is the published snapshot: item, version number, version label (e.g. "v2.0"), approvers and
  approval date, publisher, and the published title/description/text for search. The next review date is kept
  on the item. Exactly one row per item has `current = true` (partial unique
  index). The portal reads only these rows and the linked versions.

## D-030 — Approval workflows

- A workflow is a reusable template of up to 10 sequential steps. Each step has assignees (users, a system role
  — optionally limited to one department — or "the item's owner") and a rule: `ANY` (one approval completes the
  step) or `ALL` (everyone must approve). "Auto-publish" publishes on the last approval.
- Resolution order: the item's own workflow (a template or custom steps for that item only) → the space's (pages) or the process category's (processes) →
  the global default (Settings → Workflows). No workflow means the item cannot be submitted.
- Assignees are resolved and **snapshotted** in the review at submission, so later role or workflow changes do
  not alter a running review. The submitter never approves their own work: they are removed from a step's
  assignees; if they were the only one, that step counts as approved by submission (recorded as such).
- Job roles (repository "role" objects, e.g. "Requester") can be assigned to users. They drive "My processes"
  in the portal; they are not permissions.

## D-031 — Portal read model and search

The portal service builds its responses from `Publication` + the published version's XML/content only, never
from the working copy. Visibility rules: the portal access setting (all users, or selected departments and
system roles), Viewer/`portal.read`, and the space's view restrictions (`portalSpaceVisible`). The process tree
keeps only published nodes and re-attaches children whose parent is not published (`publishedForest`).
Search uses a generated `tsvector` on `Publication` (English + Arabic configurations, prefix matching,
`ts_headline` highlighting) with parameterised SQL. Attachments of published pages are served through
`/portal/attachments/:id/content` only when a current publication references them.

## D-032 — Comments

Comments are threaded (one level of replies), attached to a process or page and optionally to a BPMN element
id. Mentions are stored inline as `@[Name](userId)` and resolved on the server; only users who may see the
item are notified. Threads can be resolved and reopened. Authors may edit/delete their own comments;
`governance.manage` may delete any.

## D-033 — Notifications and email

- In-app notifications are rows (`Notification`) with a type, a link and bilingual parameters; the text is
  rendered by the web app in the reader's language. Users choose per type whether they also get email.
- Email goes through SMTP configured in Settings → Email (password AES-256-GCM-encrypted like the Git token,
  never returned). Templates are bilingual (the recipient's language), HTML-escaped. Sending runs in an
  in-process queue after the request; failures are logged and never fail the request.
- `MailTransport` is the only class that talks SMTP. Tests replace it with a fake, so the suite never sends
  email. Docker Compose includes **Mailpit** (UI on port 8025) and the seed points the demo installation at it.
- A scheduler in the API (`SCHEDULER_INTERVAL_MINUTES`, default 60; disabled in tests) sends "review due" and
  "review overdue" reminders for running reviews and periodic review dates. A `dedupeKey` per user and event
  prevents duplicates across restarts.

## D-034 — Review dates

Publishing sets `nextReviewAt` (publication date + the organisation's review interval, default 12 months);
the owner can change it in the item's governance settings. Items are DUE within the reminder window (default 14 days) and OVERDUE after the
date; the owner gets reminders, the governance dashboard and My tasks list them. Confirming "still valid"
moves the date forward without a new version. Running reviews also have a due date (default 5 days).

## D-035 — Portal PDF stays browser print

As decided (D-024), the portal's "Download PDF" opens a print-optimised view (diagram rendered to SVG with
bpmn-js, step details, metadata, correct Arabic RTL) and calls the browser's print dialog. No headless browser
in the API; a Gotenberg service is a Phase 6 option (BACKLOG).

## D-036 — Git "published versions only"

With the option on, the Git export writes only the current published version of each process and page and
removes items that are not (or no longer) published. Publishing and archiving raise `content.published` /
`content.unpublished` domain events that trigger the sync. Pages of view-restricted spaces are still never
exported (D-025).

## D-037 — Playwright smoke tests run against a running stack

`apps/e2e` holds Playwright smoke tests (portal, Viewer restrictions, Arabic RTL, print view, review page,
dashboard, notifications). They run against a seeded installation (`E2E_BASE_URL`, default
http://localhost:8080) and only read data or add feedback, so they can be re-run. They are not part of
`pnpm test` because they need the whole stack; CI integration is in the backlog. `@playwright/test` is pinned
to the version whose Chromium build is installed in the development containers.

## D-038 — Four-eyes principle: self-approval is never allowed

Decided by the product owner at the start of the AI phase, replacing the "approved by submitting" rule of
D-030. The submitter is always removed from a step's assignees. When they are the **only** possible approver
of a step, the submission is refused with `SELF_APPROVAL_NOT_ALLOWED` (HTTP 400, the step's bilingual name in
the details) and the item stays in Draft, so the submitter asks for another approver to be added. Reviews
submitted earlier keep their `approvedBySubmitter` steps (shown as such on the review page).

## D-039 — Auditor system role and `reviews.decide`

A new system role **Auditor** gets read-only access to the workspace: processes and their working drafts,
version history, pages, reviews, comments (read), the governance dashboard, users (read) and the audit log,
plus the portal. It has no edit, comment, approve or publish permissions. Viewers stay portal-only (D-028).
A new permission `reviews.decide` (all roles except Auditor and Viewer) is required to be resolved as a
workflow approver and to record a decision, so read-only users can never approve — even when named in a
workflow. Read-only roles cannot be a workflow role assignee (schema check). Space view restrictions still
apply to Auditors; administrators grant the Auditor role access to restricted spaces where needed.
