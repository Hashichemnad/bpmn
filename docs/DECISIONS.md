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
_Update (Phase 6 part 2): replaced by Versity S3 Gateway, see D-051._

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

## D-040 — AI platform layer (M16)

- One NestJS module `ai`: `AiGatewayService` is the only way features reach a model. A provider
  interface (`AiProviderClient`: one `complete()` call with optional streaming text and JSON schema)
  keeps the rest provider-agnostic; `AiProviders` is the registry (tests replace it with `FakeAi`).
- First provider: **Anthropic Claude** through the official `@anthropic-ai/sdk`, streaming
  (`messages.stream` → `finalMessage()`), system prompts marked for prompt caching, `effort` per
  feature (low for translation/summaries, medium for generation) and the server-side refusal
  fallback (`fallbacks: "default"`, beta `server-side-fallback-2026-07-01`; a no-op on models
  without one). A refusal becomes `AI_REFUSED`. SDK errors are mapped to `AI_*` codes; raw provider
  messages and the key are never sent to the browser.
- Default models as decided by the product owner: `claude-sonnet-5-5` (main) and
  `claude-haiku-5-5` (fast: label/field translation). Both are free-text settings.
- Data the model returns is requested as **structured output** (`output_config.format` with a JSON
  schema), then parsed and validated on the server (zod + semantic checks). When invalid, the model
  gets **one** repair attempt with the list of problems; the attempts are logged as one request.
- Responses are streamed to the browser as **Server-Sent Events** over a POST (`fetch` reader, so
  CSRF and cookies work as usual): `progress` / `delta`, then one `result` or `error`. Access,
  permissions and limits are checked before the stream starts, so they are ordinary JSON 403/429.
  nginx has an unbuffered location for `/api/v1/ai/` with a 300 s read timeout.

## D-041 — AI settings, access, limits and logging

- Setting `ai` (Super Admin, Settings → AI): enabled (default **off**), provider, model, fast model,
  API key (AES-256-GCM with `INTEGRATIONS_ENCRYPTION_KEY`, write-only, never returned or logged),
  roles allowed to use the assistant, requests per user per UTC day, requests per organisation per
  UTC month (0 = no limit), the data notice (EN/AR) and suggestion chips per feature.
- A user may use AI when it is enabled and one of their roles is allowed. Otherwise `GET /ai/status`
  says so (the UI hides every ✨ AI entry point) and every AI endpoint returns 403
  (`AI_DISABLED` / `AI_NOT_ALLOWED`); limits return 429 (`AI_USER_LIMIT` / `AI_ORG_LIMIT`).
  Feature-specific rights still apply (e.g. editing the model you generate into).
- Every request → one `AiUsage` row (user, feature, model, input/output tokens, status, error code,
  duration, item) and an `AI_REQUEST` audit entry. The audit entry records the prompt size, never
  the prompt (it may contain confidential content). Connection tests are logged but do not count
  against the limits. New permission `ai.usage.read` (Admins, Super Admins, Auditors) for the
  **AI usage** page (totals per user, feature, model and month).

## D-042 — Generated BPMN: structure first, layout on the server

The model never writes XML or coordinates. It returns a structured process (lanes, typed nodes,
flows, bilingual labels/descriptions, IT system per step) that is validated (ids, references, one
reachable start, end events, connections). The server builds BPMN 2.0 XML with `ph:nameEn/Ar`
labels, a pool with one lane per role, and diagram interchange from a **layered (Sugiyama-style)
layout**: columns = longest path without back edges, rows per lane, orthogonal edges, loops routed
below. `bpmn-auto-layout` was evaluated and not used: it ignores lanes and is ESM-only (the API is
CommonJS). The XML is read back (jsdom XML parser) to prove it parses and is checked with the shared
validation rules; warnings are shown with the preview. Lanes and IT systems are matched to the
library by normalised name (Arabic letter variants unified) and proposed as links (PERFORMS /
SUPPORTS) that the user confirms. The result is never saved until the user accepts the preview.

## D-043 — "AI-generated" flag

`Process.aiGenerated` / `Page.aiGenerated` are set when the saved content is exactly what the
assistant produced (the client sends `aiGenerated: true` with the save) and cleared by any later
human save, by restoring a version and by an approval. While set, the process, modeler, page and
editor show "AI-generated — review before publishing". Published content is always approved, so the
portal never shows the badge.

## D-044 — Refine, summarise and documentation features

- **Refine with chat**: the client sends the diagram as shown (unsaved changes included); the server
  turns it into the structure, the model returns the complete updated structure and the server
  rebuilds the BPMN keeping element, flow and container ids (process, pool, lanes) so object links,
  comments and the visual compare stay attached. The layout is regenerated (hand-made positions are
  not kept); elements the structure cannot carry (annotations, boundary events, data objects, message
  flows, content of expanded sub-processes) are counted and the user is warned before accepting. The
  proposal is shown with the Phase 2 BPMN compare and applied only on "Accept".
- **Summaries / what changed**: the changes are computed on the server — a structural diff of the
  two versions' structures for processes (lanes, steps, connections, conditions, descriptions) and a
  line diff of the page text for pages — and the model only explains them. No changes → no AI call.
  The review screen compares like the review page: against the published version, or everything is
  new. Plain summaries use the fast model; change summaries the main model. Text is streamed.
- **Documentation from a process**: SOP or Work Instruction, following the structure of the built-in
  template, from the process outline with its linked roles, systems and documents; both languages in
  one request; sanitised; the read-only diagram is embedded at the top (which also links the page to
  the process). The page is created as a draft by the user after the preview.
- **Process from a page**: the page text (requested language, else the other) is modelled like
  feature 1; the user then completes the "New process" form and the new process is linked to the page.

## D-045 — Portal Q&A: full-text retrieval over publications, no embeddings (yet)

The portal assistant retrieves with **PostgreSQL full-text search** over the `Publication` read model (the
same generated English + Arabic `tsvector` as portal search, D-031), limited to the current publications the
user may see (`PortalAccessService.publications`: portal access, live items, space view restrictions). Natural
questions are turned into an any-term prefix query (`toAnyTsQuery`) ranked with `ts_rank_cd`; follow-up
questions also search with the previous question. The top six sources go to the model: page text as published,
and for processes an outline of the **published version's** BPMN with its published links — never the working
copy. The model must cite sources as `[n]` and start with `[[NOT_FOUND]]` when the sources do not answer;
only cited sources are returned as links. No match → no AI call. Arabic and English questions match because
publications store both languages. **pgvector embeddings are not added**: retrieval quality on the demo and
test content is good, it needs no extra extension, model or re-indexing, and embeddings would send all
published content to an embedding provider. Revisit (BACKLOG) when the published corpus grows into the
thousands of documents or users report missed answers.

## D-046 — Analyse & improve

The process outline (lanes, steps in flow order, linked roles/systems/documents, decisions) and the
modeler's validation warnings go to the main model with a structured-output schema: findings (kind, severity,
title, explanation, suggestion, element ids) and one plain-language explanation per warning. Element ids the
diagram does not contain are dropped before the result reaches the browser. Read-only users who may read
processes (e.g. Auditors) may analyse; nothing is saved.

## D-047 — SSRF protection for administrator-configured integrations

The Git (GitLab / GitHub Enterprise URL) and SMTP integrations refuse internal addresses — loopback,
private networks, link-local (incl. the cloud metadata service), CGNAT, multicast and reserved ranges, IPv4
and IPv6 (incl. IPv4-mapped) — unless the host, address or CIDR range is listed in `OUTBOUND_ALLOWED_HOSTS`
(Docker Compose default: `mailpit`). The check uses Node's built-in `net.BlockList`, no extra dependency.
The host is resolved and checked, and the connection goes to the checked address (Git: a `lookup` on
`node:https`; SMTP: nodemailer connects to the IP with `servername` set, so TLS still verifies the host
name), so DNS rebinding cannot bypass it. `GitHttp` therefore uses `node:http(s)` instead of `fetch`.
Plain `http://` Git URLs are only accepted for allowed hosts (the token would travel unencrypted);
redirects are never followed. A blocked Git server reports `GIT_HOST_BLOCKED`. The AI provider address is
not configurable in the UI, so it is not covered.

## D-048 — CSRF: double-submit cookie plus an origin check

The double-submit token alone does not stop an attacker who controls a sibling sub-domain and can set a
cookie for the parent domain. State-changing requests whose `Origin` header is present must therefore come
from `CORS_ORIGINS` or the request's own host name (so a deployment opened under another name than
`CORS_ORIGINS` keeps working through the same-origin nginx proxy); `Origin: null` and
`Sec-Fetch-Site: cross-site` without `Origin` are rejected. Non-browser clients that send no `Origin` still
need the token.

## D-049 — Security documentation generated from the code

`docs/SECURITY.md` holds the endpoint table (method, path, router guard, validated inputs, rate limit). It
is generated from Nest's route metadata (`apps/api/test/route-inventory.ts`) and a test fails when it is out
of date, when a route lacks an access declaration or when an input has no validation pipe. The same
inventory drives the authorisation matrix test, so new routes are swept as Viewer / Auditor / Reviewer
without writing a test for them.

## D-050 — Dependency updates for the security review

`react-router-dom` 6 → 7 (security fixes exist only in 7.x; the app already used all v7 future flags, so
only those flag props were removed), `vitest` 3 → 4 (dev server advisory), `js-yaml` ≥ 5.4.1 through a pnpm
override (pulled in by `@nestjs/swagger`). MinIO's transitive `stream-json` 1.x / `decode-uri-component`
0.2 are **not** overridden: the fixed versions are new majors (ESM-only / different module layout) that the
MinIO client may not load, and the vulnerable code is not on any path ProcessHub uses (SECURITY.md SEC-09).

## D-051 — File storage: Versity S3 Gateway replaces MinIO

MinIO no longer ships community images or binaries and its community edition is in maintenance mode, so
the `bitnamilegacy/minio` image (D-009) would never receive security fixes. Compared for a single server with
50–500 users: **Versity S3 Gateway** (Apache-2.0, actively released, one small container), SeaweedFS
(Apache-2.0, but its own volume format and more moving parts) and Garage (AGPL, needs a cluster layout and
key import before first use). Chosen: **Versity S3 Gateway with the POSIX backend** (`versity/versitygw`,
pinned to a release tag). Objects are stored as **plain files** (`/data/objects/<bucket>/<key>`) and metadata
(content type, ETag) in a sidecar folder (`/data/meta`) instead of extended attributes, so a backup is a plain
`tar` of the volume, files can be inspected or recovered without the gateway, and there is no lock-in.
`--fsync` makes an acknowledged upload survive a power loss. The API keeps its S3 client (`minio` npm
package, works with any S3 service) and the `MINIO_*` variable names, so existing `.env` files keep working;
only `MINIO_ENDPOINT`/`MINIO_PORT` change (Compose sets `storage:7070`). Migration from an existing MinIO
volume: `scripts/migrate-minio-storage.sh` starts the old image once on the old volume and copies every
object with rclone, then checks size and checksum per file; the old volume is kept until an admin deletes it.
Verified with the API's own client (bucket creation, upload with content type, download, delete) and a
25-file migration. Moving to another S3 service later (cloud object storage, SeaweedFS, …) works the same
way: rclone copy, then change the `MINIO_*` settings.

## D-052 — Production stack: Caddy in front, internal network, secrets required

`docker-compose.prod.yml` is a separate, complete file (not an override of the trial file), selected with
`COMPOSE_FILE` in `.env`, so operators type plain `docker compose …`. **Caddy** terminates TLS: automatic
Let's Encrypt certificates with renewal, http → https, HSTS (without `includeSubDomains`, which would affect
other company hosts) and HTTP/3; it was preferred over nginx + certbot because certificate handling needs no
extra container or cron job. `CADDY_TLS` selects ACME e-mail, `internal` or the company's certificate files
(Caddy substitutes the variable before parsing, so two file paths work). Caddy forwards everything to the
existing web nginx, which keeps the security headers and the `/api` proxy, so the trial and production paths
behave the same; `TRUST_PROXY=2`. Networks: `edge` (Caddy ↔ web), `backend` **internal** (web, API, database,
storage — no internet, nothing published), `egress` (API only, for the AI provider, Git and SMTP). Unlike the
trial stack, the JWT secret, encryption key and all passwords are **required** (`${VAR:?}`), so they live in
`.env` — one file to keep in a vault — instead of being generated inside a volume. Every service has a health
check, `restart: unless-stopped`, CPU/memory limits sized for 4 vCPU / 8 GB (overridable in `.env`) and Docker
log rotation (5 × 20 MB). Third-party images are pinned (`caddy:2.11-alpine`, `postgres:16-alpine`,
`versity/versitygw:v1.9.0`). The application images are still built on the server (no registry yet, BACKLOG).
nginx now accepts 11 MB request bodies: attachments may be 10 MB and the old 6 MB limit rejected larger ones
before the API could answer with its translated error.

## D-053 — Backups: pg_dump + storage tar, keys kept out of the backup

`scripts/backup.sh` writes one folder per run: `pg_dump` custom format (checked with `pg_restore --list`
right away), a `tar.gz` of the storage volume (possible because objects are plain files, D-051), a manifest
and SHA-256 checksums. It runs against the live system; the database is dumped first, so a file deleted
during the few seconds in between can be missing, while new uploads after the dump are simply extra files.
The `.env` with the keys is **not** included by default — backups usually go to shared storage, and keys
there would decrypt the stored integration secrets. The manifest holds a fingerprint of the encryption key
so `restore.sh` can warn when `.env` has a different key. `restore.sh` verifies checksums, asks for a typed
confirmation, makes a `pre-restore` backup, recreates the database and replaces the files, then waits for the
API. Scheduling is a plain `/etc/cron.d` file; off-site copies use the cloud's own tools (AzCopy / AWS CLI)
documented in `docs/DEPLOYMENT.md`. Tested as a disaster drill: volumes deleted, fresh stack, restore, content
and an 8 MB attachment back byte for byte.

## D-054 — Product owner decisions for Phase 6 part 2

Decided by the product owner on 2026-10-21:

1. **File storage:** Versity S3 Gateway is confirmed as the production file storage (D-051).
2. **Backups never contain `.env`:** the default of `backup.sh` stays (no `--with-env`). The keys
   (`JWT_ACCESS_SECRET`, `INTEGRATIONS_ENCRYPTION_KEY`) and passwords are kept in the company password
   manager; a restore needs a backup folder plus that `.env` (DEPLOYMENT.md §7).
3. **Off-site backups:** Azure Blob Storage in **UAE North** (same region as the server), private container,
   soft delete + versioning, lifecycle rule deleting after **90 days**; daily `azcopy sync` with the VM's
   managed identity, 14 days kept locally. Documented as the recommended setup in DEPLOYMENT.md §7.
4. **`braces` (SEC-08):** accepted for now — high severity but dev-only (via Jest), not in the production
   code paths and no upstream fix. Follow-up in BACKLOG: move the API tests from Jest to Vitest.

## D-055 — Single sign-on with OpenID Connect via `openid-client`

**Decision:** SSO uses the OIDC authorization-code flow with PKCE, `state` and `nonce`, implemented with
`openid-client` 6 (OpenID-certified, by the author of `jose`) instead of hand-written token validation or
Passport. Microsoft Entra ID is a preset (issuer derived from the tenant ID, single tenant only — the
multi-tenant `common` endpoint is not supported because its issuer cannot be validated); any other provider
is configured by issuer URL (discovery). ID-token signatures are always verified (`enableNonRepudiationChecks`,
SEC-10). `openid-client` is ESM-only: the API (CommonJS) loads it through Node's `require(esm)` (Node ≥ 20.19)
and Jest compiles it with `ts-jest` (`transformIgnorePatterns` in `jest.config.js`). Provider requests use
`common/safe-fetch.ts`, so the SSRF policy (D-047) applies. Tests run against a local mock provider
(`test/fixtures/mock-idp.ts`), never a real tenant.

## D-056 — SSO flow state in an encrypted Lax cookie; sessions unchanged

**Decision:** `state`, `nonce`, the PKCE verifier and `returnTo` are AES-256-GCM-encrypted into a 10-minute
`ph_sso` cookie (`SameSite=Lax`, path `/api/v1/auth/sso`) instead of a database table — no cleanup job, and
a callback from another browser is rejected (login CSRF). Lax is required because the provider redirects back
cross-site; the cookie never holds a session. After a successful callback the normal session cookies
(`SameSite=Strict`) are issued, so SSO and password sessions are identical. The callback answers with a
redirect to the SPA (`/login?ssoError=<code>` on failure), never JSON.

## D-057 — Account matching, just-in-time users and group mapping

**Decision:** users are matched by `(ssoIssuer, ssoSubject)`; on the first SSO sign-in an existing account
with the same e-mail is linked once (never when it is already linked to another subject of the same issuer).
Entra ID often omits `email`, so `preferred_username` / `upn` is used for Entra only. Allowed e-mail domains
are mandatory when SSO is on. Unknown users are created just in time (can be switched off) with
`passwordHash = ''` (no local password; password sign-in for them always fails in constant time). Roles: the
union of the roles of all matching group mappings, otherwise the default role; department from the first
matching mapping with one, otherwise the default department. Optional "update roles at every sign-in" makes
the directory the source of truth, but never removes Super Admin from the break-glass account or the last
Super Admin; on Entra ID group overage roles are left unchanged.

## D-058 — Password sign-in can be turned off, with one break-glass Super Admin

**Decision:** when password sign-in is off, only the configured break-glass account (an active Super Admin
with a password, validated on save; SSO must be on) may use it. The refusal (`LOCAL_LOGIN_DISABLED`) is only
returned after a correct password, so it does not reveal which account is the break-glass one. The
environment variable `AUTH_FORCE_LOCAL_LOGIN=true` re-enables password sign-in for everyone as a documented
emergency switch (warning shown in Settings).

## D-059 — TOTP two-factor for password sign-in

**Decision:** TOTP (RFC 6238, SHA-1, 6 digits, 30 s — what every authenticator app supports) via `otpauth`;
QR code rendered in the browser with Ant Design's `QRCode` from the `otpauth://` URI (no image generation on
the server). Secret encrypted with `INTEGRATIONS_ENCRYPTION_KEY`; a time step is accepted once (stored
`totpLastStep`, updated atomically). Ten recovery codes, 80 random bits each, stored as SHA-256 in
`MfaRecoveryCode` (high entropy, so a slow hash is unnecessary). Password sign-in becomes two requests: the
password step returns `{ mfa: 'VERIFY' | 'SETUP' }` and a 5-minute signed challenge cookie; `SETUP` lets a
user whose role requires 2FA enrol before the first session. Wrong codes count towards the account lockout and
the counter is only reset after the last factor (SEC-11). 2FA applies to password sign-in only — SSO users
use the identity provider's MFA. Admins with `users.manage` can reset a user's 2FA (only a Super Admin for a
Super Admin); sessions are revoked.

## D-060 — Settings → Authentication is Super Admin only

**Decision:** stored as setting `auth` (`GET/PUT /settings/auth`, `settings.manage` = Super Admin), like the
AI and Git settings: the client secret is write-only and encrypted, changes are audited with before / after
(without the secret). The login page reads only `GET /auth/options` (SSO on, button labels, whether password
sign-in is offered).

## D-061 — 2FA required for Super Admin and Admin at go-live (product owner, Phase 6 part 4)

**Decision:** two-step verification is required for **Super Admin** and **Admin** and optional for all other
roles. `DEFAULT_MFA_REQUIRED_ROLES` (`packages/shared`) is the shipped value of Settings → Authentication →
"Require two-step verification for", so a fresh installation asks the first administrator to enrol at the
first password sign-in. The list stays editable (a Super Admin decision, audited), but the settings page warns
when either role is removed. Existing `auth` settings saved before this change keep their stored list — check
it in the go-live checklist. The API e2e helpers store an empty list so suites not about 2FA can sign in with a
password; `mfa.e2e` covers the shipped defaults.

## D-062 — Password sign-in off after SSO roll-out; one break-glass Super Admin, always with 2FA

**Decision:** once SSO is rolled out, password sign-in is switched off except for one **dedicated**
break-glass Super Admin account (D-058). That account now **always** needs 2FA (`MfaService.isRequired`:
break-glass or a required role), independent of the role list, so removing Super Admin from the list cannot
leave the only password account with one factor. The creation and storage procedure (password manager vault
with two holders, TOTP in the vault, recovery codes, quarterly test, audit review) is in DEPLOYMENT.md §6.3.

## D-063 — Roles are managed in ProcessHub, not by the directory

**Decision:** "Update roles at every sign-in" stays **off** by default; directory group mappings only set the
initial roles (and department) of a user created at the first SSO sign-in. Role changes are made under
Administration → Users and survive later sign-ins (test in `sso.e2e`). The sync option remains for
organisations that want the directory to own roles.

## D-064 — MFA for SSO users is enforced by Entra ID Conditional Access

**Decision:** ProcessHub does not add its own second factor to SSO sign-ins (D-059); the company's Entra ID
enforces MFA through a Conditional Access policy targeting the ProcessHub application (sign-in frequency
24 hours). The request text for IT is in DEPLOYMENT.md §6.1 step 9; the policy is a go-live checklist item.
ProcessHub cannot verify it technically (the `amr` claim is not checked) — see BACKLOG.

## D-065 — Refresh-token lifetime 24 hours (configurable)

**Decision:** `REFRESH_TOKEN_TTL_HOURS` (default **24**, 1 – 2160) replaces `REFRESH_TOKEN_TTL_DAYS` (default
7). Hours, so short values are possible; the API logs a warning when the old variable is still set (it is
ignored). Refresh tokens still rotate on every use, so the lifetime is an **idle** timeout: a session ends after
24 hours without activity, not 24 hours after sign-in. Deactivating a user ends access immediately (every
request reloads the user). Automatic de-provisioning (SCIM / back-channel logout) stays in BACKLOG.

## D-066 — Node 22 LTS

**Decision:** Docker images (`node:22-alpine`), CI (`node-version: 22`), `.nvmrc`, `engines` (`>=22.12`, the
first 22.x with `require(esm)` unflagged, needed for `openid-client`) and `@types/node` 22 move from Node 20,
which reached end-of-life in April 2026. No code changes were needed; Prisma's musl engine targets are the same.
CLAUDE.md §4 updated.

## D-067 — Diagram colours are standard BPMN-in-Color, applied by a theme (Modeler design, Part A)

**Decision:** Colours are stored only in the diagram, on the `BPMNShape`, as BPMN-in-Color
(`color:background-color` / `color:border-color`) **and** the older bpmn.io attributes (`bioc:fill` /
`bioc:stroke`), so other BPMN tools show them. The theme (default = the reference scheme in
`docs/samples/README.md`, editable in Settings → Branding, Setting `branding.diagramTheme`, public so every
viewer has it) only decides which colour an element gets when it is **created**, its **type changes**, or —
for automatically coloured elements — its label / step kind changes. Rules (shared code,
`packages/shared/src/diagram-theme.ts`): an element whose fill/stroke pair is a theme pair (current or default
theme) is "theme-coloured" and follows its kind; any other colour is a user choice and is never overwritten;
an element without colours is not coloured by edits. The renderer never applies the theme at display time —
what you see is what is stored and exported. Picking a theme colour in the colour picker counts as a theme
colour.

## D-068 — Approval steps: first English word or an explicit `ph:stepKind`

**Decision:** A user task is an approval step when its English label **starts with** Review, Approve, Endorse
or Confirm (whole word; "Submit for approval", "Reviewer assignment", "Approval letter archived" are not), or
when the element panel marks it `ph:stepKind="approval"`. `ph:stepKind="task"` forces a normal step even with
such a label. Only user tasks can be approval steps; the Arabic label is not used (the English label is the
stable key, as for exports). The AI refine flow keeps `ph:stepKind` and explicit colours.

## D-069 — Look by a renderer on top of `BpmnRenderer`, one diagram factory

**Decision:** A higher-priority renderer (`apps/web/src/features/modeler/renderer.ts`) lets bpmn-js draw the
standard shapes and then adjusts them: 12 px corners on activities, a soft shadow (an offset copy of the shape
body, so it survives SVG/PNG export without filters), 1.5 px borders and connections, clearer icons for user,
approval, service, send and receive tasks (script, business rule and manual keep the standard BPMN marker),
opaque alternating lane fills with a tinted header band and dark semibold names. Fonts: one stack
`Inter, 'IBM Plex Sans Arabic', …` — Latin glyphs from Inter, Arabic from Plex by per-glyph fallback, so labels
need no language switch in the renderer; fonts are loaded before import so text is measured with them. Arabic
labels get `direction="rtl"` with `text-anchor="end"` (bpmn-js positions each line by its left edge, which is
the "end" of an RTL line). Every diagram (modeler, viewer, portal, print, wiki embed, version preview, compare,
AI preview, settings preview) is created by `create-diagram.ts`. Exports embed the woff2 fonts as data URLs
(~200 KB per SVG) so the SVG and the PNG rendered from it show the right fonts anywhere.

## D-070 — Highlights over coloured fills

**Decision:** Because shapes now have coloured fills and a shadow element, every highlight (diff added /
removed / changed / layout, portal selected step, diagram-js drop feedback) targets the shape body
(`.ph-body`) instead of `:first-child`, uses saturated colours that do not occur in the theme (changed = orange,
not the amber of approval tasks) and, for compare, a halo outline outside the shape. The portal's selected
step keeps its colour and gets a blue halo. Colour-only changes show in compare as "moved, resized or
recoloured".

## D-071 — Colour picker: `bpmn-js-color-picker` with the theme palette

**Decision:** The context-pad colour picker is `bpmn-js-color-picker` (bpmn.io, MIT, tiny), configured with
the theme colours (deduplicated) and four neutral colours, plus two ProcessHub entries: "Reset to theme"
(theme colour of each selected element's kind) and "No colour". It is part of the editable modeler only, so
read-only users never see it. The palette follows theme changes without recreating the modeler.

## D-072 — "Apply theme to existing diagrams": versions, colours-only updates of published processes

**Decision (product owner, 2026-10-23, replaces the first draft of this entry):** The Super Admin action
recolours only elements **without** colours, in every working model, after a dry run whose counts the UI shows
for confirmation. Processes in review or archived are skipped (locked).

- **Drafts:** a new version "Applied colour theme" through the normal version path (audited, Git sync).
- **Approved / published:** the recoloured model is compared with the official version (current publication,
  or the approving review) on a canonical form without colour attributes. When the change consists of colour
  attributes alone, the status stays: a new version labelled **"Theme applied (colours only)"** is created,
  the working model updated, and the current publication (or the approving review) moves to that version, so
  the portal shows the coloured published version immediately. Audited as a version plus a process update
  (from / to version, publication or review). If anything else differs (e.g. unpublished edits in the working
  model), it falls back to a new draft like any other edit.
- One summary audit entry per run.

## D-073 — Product owner decisions on Part A

- **Hand-picked theme colours** keep the current behaviour (D-067): an element painted with a theme colour in
  the picker counts as theme-coloured and follows a later type change; no extra attribute.
- **Defaults** for kinds outside the reference scheme are confirmed: intermediate events, call activities and
  sub-processes use the human-task colours; receive tasks the system-task colours.
- **No display-time colouring** (D-067) is confirmed: existing diagrams stay uncoloured until "Apply theme".
  After the upgrade Super Admins see a one-time notice "Diagrams can now be coloured: run Apply theme"
  (`GET /settings/diagram-theme/notice`, shown while uncoloured diagrams exist), which disappears when
  dismissed (audited) or once the theme has been applied (Setting `branding.diagramThemeNotice`). The upgrade
  step is in `docs/DEPLOYMENT.md` §9.

## D-074 — Modeler as a full-screen workspace route

The modeler is a route of its own, `/processes/:id/model`, outside the app layout (no sidebar, process tree or
page header): a slim top bar, the ProcessHub palette on the inline-start side, the canvas and a collapsible,
resizable side panel (Properties / Issues / Comments / AI). The process page's Model tab shows a read-only
preview with **Open modeler** (read-only, `?view=1`) and **Edit diagram**; `?tab=model&element=` deep links
keep working (highlight in the preview, passed on to the workspace). Autosave and the unsaved-changes guard are
the same code as before. Browser full screen is requested on the whole page so dialogs and menus (rendered in
`<body>`) stay visible. The same route permission as the process page (`processes.read`); editing is still
decided by `canEditModel` on the server.

## D-075 — Workspace preferences in localStorage, per user and browser

Side panel (opens on selection unless the user closed it; width), mini-map, badges, grid snapping and the
palette's icons-only mode are remembered under `ph.modeler.prefs.<userId>` in localStorage, every access in
try/catch with the defaults as fallback. They are conveniences of one browser, not settings, so they are not
stored on the server. The portal diagram shares the mini-map and badge preferences.

## D-076 — Opening view: fit to width, never above 100 %

Diagrams open fitted to the canvas width (never enlarged above 100 %), top of the diagram first. Fit page,
100 % and presets are in the zoom menu; Ctrl + wheel zooms and space + drag pans (bpmn-js). Keyboard shortcuts
are bpmn-js's, which since diagram-js 15 are bound to the focusable canvas only, so typing in fields is never
intercepted; the workspace's own keys (F focus mode, ? help, Esc) ignore fields and dialogs (`keys.ts`).

## D-077 — Palette of our own; ready-made steps are ordinary typed elements

The bpmn-js palette is hidden and replaced by a React palette (grouped, labelled, searchable in both
languages, icons-only mode, inline-start side) that starts the same bpmn-js create / tool interactions.
Ready-made steps create standard BPMN elements with both labels set (and `ph:stepKind="approval"` for the
approval steps), so the theme colours them on creation and no new element types appear in the XML: Approval
step and Manager review (user tasks), System step (service task), Notification (send task), Waiting time (timer
intermediate catch event), Link to sub-process (call activity + repository picker → `ph:linkedProcessId` and
the process name as label).

## D-078 — Auto-layout reuses the shared layered layout as one command

The AI builder's layout moved to `packages/shared/src/bpmn-layout.ts` (now also handles larger shapes such as
expanded sub-processes; AI output is unchanged byte for byte). The modeler's **Auto-layout** builds the layout
input from the diagram (flow nodes, leaf lanes, sequence flows, current sizes) and applies it with a custom
command `ph.autoLayout` that sets bounds and waypoints directly (DI updated through `bpmnUpdater`), so undo /
redo is one step and only geometry changes. Contents of expanded sub-processes and boundary events move with
their parent; other connections (message flows, associations) are re-routed by the bpmn-js layouter.
Diagrams with several pools or vertical lanes are refused with a message. A confirmation comes first.

## D-079 — Lane ↔ role link stored in the diagram (`ph:roleId`)

A lane can be linked to a Role of the object library; the link is stored on the lane as `ph:roleId` and the
lane label takes the role's English and Arabic names (a button re-applies them when the role was renamed).
Tasks in such a lane show a suggestion "<role> performs this step" in the element panel; only a click creates
the PERFORMS object link for the task (no automatic task links). The AI refine path keeps `ph:roleId`.
The XML is the source of truth (versions, compare, Git export); the server mirrors it as an object link
(D-081).

## D-080 — Badges as HTML overlays; print layout with page-wide parts

Info badges (roles, IT systems, documents, risks, controls, open comments) are diagram-js overlays built with
DOM APIs — names only go into `title` / `aria-label`, never into markup. The portal shows published links only
and adds "Highlight my steps" (published ROLE links to the reader's job roles). The print view (still browser
print, D-024) lets the reader pick A4 or A3 landscape; the diagram is scaled to the page width and, when it
would be shown below 55 %, cut into overlapping page-wide parts (one per page). Header with logo, version,
owner and approval date, a colour legend from the active theme, page numbers via `@page` margin boxes
("Page n of m" / "صفحة n من m").

## D-081 — Lane roles mirrored as PERFORMS object links (product owner, 2026-10-28)

Every save of the working model (autosave, Save version, restore — all go through `saveModel`) syncs each
lane's `ph:roleId` to an `ObjectLink` (element = lane id, relation PERFORMS) in the same transaction: a new
role adds the link, a changed role replaces it, a removed role (or removed lane) deletes it. Ids that are not
an existing, non-deleted Role are ignored and never fail the save. The role then shows in Linked objects, the
object's usage list, the published links and the portal's "My processes" (the lane is listed as the step).
Changes are part of the model's audit entry (`laneRoles: { added, removed }`). Links between a role and a
lane are owned by the diagram: one removed by hand comes back on the next save while the lane keeps the role.

## D-082 — zod 4 (2026-10-28)

zod 3 has a high advisory with no 3.x fix (GHSA-mrhx-c7xc-m3w5, memory exhaustion when a very large array fails
validation element by element); `packages/shared` and `apps/api` now use zod `^4.6.7` (fixed from 4.6.6).
The schemas were migrated to the zod 4 API without changing what they accept or return:

- `z.guid()` for ids (`uuidSchema` and the AI / SSO schemas): any 8-4-4-4-12 hex id, as zod 3's `uuid()`;
  zod 4's `z.uuid()` would also demand RFC 9562 version and variant bits.
- E-mail: `z.string().trim()[.toLowerCase()].pipe(z.email().max(254))` — in zod 4 `z.email().trim()` would
  check the format before trimming. The default e-mail pattern is equivalent to zod 3's.
- Optional bilingual text: `.nullable().transform(v => v ?? '').optional()` (zod 4 only keeps a key optional in
  the output type when the outermost schema is optional; null still clears the field, a missing key stays
  missing).
- `z.partialRecord` for notification preferences (zod 4's `z.record` with an enum key requires every key);
  `z.strictObject` for the 2FA verify union; `code: 'custom'` instead of `ZodIssueCode.custom`;
  `{ error }` instead of `{ message }`; `z.url()` for `APP_URL`; `z.ZodType` in `ZodPipe`.
- AI suggestions: the per-feature `.default([])` inside `.partial()` was dropped — in zod 3 it never applied
  (partial made the key optional first); in zod 4 it would add empty lists for every feature.

Errors: the API still answers `400 VALIDATION_ERROR` with `details: [{ path, message }]`; the web shows the
translated message for the error code (EN/AR), so nothing users read changes. Our own messages
(`NAME_REQUIRED`, `TITLE_REQUIRED`, `INVALID_CODE`, …) are unchanged; zod's built-in English texts in `details`,
in the start-up error for a bad environment and in the AI structured-output feedback to the model are zod 4's
(e.g. "Too small: expected number to be >=1"). Verified by a differential run of every shared schema, the
environment schema and the AI process-structure schema on the same ~1,500 inputs under zod 3 and zod 4: same
accept / reject, same parsed data, same custom messages.

## D-083 — Dictionary: terms as library objects, labels linked with `ph:labelRef` (Modeler design B2, 2026-10-28)

The Dictionary is a new library object type `TERM` (same table as roles and systems), so terms get "where
used", related documentation, soft delete and the audit trail for free. `RepoObject` gained `status`
(`DRAFT` | `APPROVED`, every non-term object is `APPROVED`), `category`, `synonymsEn` / `synonymsAr` (text
arrays, ≤ 20 each), `ownerId`, `approvedAt` / `approvedById`; the definition is the bilingual description.

- **Proposals:** permission `dictionary.propose` (Modeler, Process Owner, Admins) creates terms as drafts
  (`POST /dictionary/terms`); `dictionary.approve` (Process Owner, Admins) approves or rejects them (reject =
  soft delete, reason in the audit log) and is required to change, rename or delete an approved term. Drafts
  are never suggested and are not used as AI translation terminology.
- **Autocomplete:** `GET /dictionary/suggest` ranks approved terms, roles and IT systems in memory with the
  shared `rankSuggestions` (exact > prefix > word prefix > contains; active language, then the other, then
  synonyms; terms before roles before systems). Matching folds case and Arabic variants (hamza forms of alef,
  ة/ه, ى/ي, ؤ/و, ئ/ي, tashkeel, tatweel). Lanes only get roles (a lane is a role, D-079).
- **Linked labels:** choosing a suggestion fills `ph:nameEn` / `ph:nameAr` and sets `ph:labelRef` (lanes:
  `ph:roleId`). Any label typed by hand (canvas or panel) removes the reference. On save the API keeps a
  `NAMED` object link per term reference exactly in sync and adds the default PERFORMS / SUPPORTS link for a
  role / system reference (never removed by the sync, the modeler may keep it). Linked shapes show a book
  marker.
- **Rename:** `POST /dictionary/objects/:id/rename-preview` lists every process whose working model has
  linked labels, old → new labels, and whether the user may update it (edit right, not in review /
  archived); `…/rename` renames the object and creates one version per updatable process (change note
  "Dictionary: “old” renamed to “new”" in both languages, approved / published processes get a new draft like
  any edit), audited on the object with the updated and skipped processes. Works for terms, roles and systems.

## D-084 — Workspace: a click keeps the selected shape selected; the diagram stays still when the canvas moves (2026-10-28)

diagram-js deselects the only selected shape when it is clicked again. In the workspace the side panel opens
on selection, so a double-click (edit label) closed and reopened the panel between the two clicks; in Arabic
the panel sits on the left, the canvas moved and the second click hit another element (e.g. the lane). Now a
plain click on the selected shape keeps it (`keep-selection.ts`; Esc, an empty-canvas click and Shift+click
still deselect), and in Arabic, when the canvas's left edge moves (panel opening or closing on the left), the
diagram is scrolled back so it stays where it was on screen. In English only the palette sits on the left and
the diagram keeps moving with it as before.

## D-085 — Quick Model: the table edits the live diagram (Modeler design B2, 2026-10-29)

Quick Model is a second view of the same model in the workspace ("Diagram | Quick Model"), not a separate
document. Rows are read from the diagram (one per top-level flow node except start and boundary events, in
flow order: breadth-first from the start events, then the rest left to right) and written back by one
command `ph.quickModel` on the bpmn-js command stack, so a single Undo reverts it:

- lanes from the roles of the rows (a library role → lane with `ph:roleId`, text → lane named by it; an
  existing lane is reused by role id or name; a pool is created when needed; lanes left empty are removed);
- steps: existing elements keep their id (rename, type change via bpmn-js replace — also keeps the id, step
  kind for task ↔ approval, moved to their role's lane); new rows are created; rows removed from the table are
  removed from the diagram;
- sequence flows between steps follow the "next step(s)" column with bilingual condition labels; a start
  event leads to the first row;
- then the shared auto-layout (D-077) inside the same command.

Elements the table does not show (start / boundary events, data objects, annotations, message flows) are left
alone; other flow-node types (parallel gateways, intermediate events, sub-processes) appear as read-only "other"
rows. Step types are shared (`packages/shared/src/steps.ts`: task, approval, system, notification, decision,
end) and reused by "colour by", reports and conventions. The IT system column is the element's SUPPORTS link:
after "Generate diagram" the draft is saved first (links to missing elements are pruned on save), then changed
systems are linked / unlinked through the existing link API. Paste from Excel reads tab-separated rows (name EN,
name AR, performed by, IT system, type, next steps by row number or name, conditions); roles and systems are
matched to the library by name (spelling variants folded), an unknown role still becomes a lane.

## D-086 — Step attributes, "colour by" views and process totals (Modeler design B2, 2026-10-29)

- **Attributes** live in the BPMN XML as `ph:` attributes of flow nodes (no database table): times in whole
  minutes (`ph:durationMinutes`, `ph:waitingMinutes`, `ph:slaMinutes`; entered as minutes / hours / days of
  24 h), `ph:frequencyPerMonth`, `ph:costPerExecution` (organisation currency, no unit stored), bilingual
  free text `ph:inputsEn/Ar`, `ph:outputsEn/Ar`. They travel with versions, compare and Git export, and need no
  migration. Every save validates them server-side with the shared reader (non-negative numbers within limits,
  text ≤ 2,000 characters) → `400 INVALID_STEP_ATTRIBUTES` with the element and attribute in `details`.
- **Shared BPMN reader** (`bpmn-graph.ts`): a dependency-free tokenizer for server and browser that returns
  nodes (labels, lane, step type, attributes), flows and lanes. Used by the totals, the reports (Part 4) and the
  modeling conventions (Part 5).
- **Colour by** (View menu): lane / role, IT system (SUPPORTS link), step type, planned duration (none,
  < 1 h, 1–8 h, > 8 h) and missing information (no role — no lane and no PERFORMS link — or no description).
  View only: canvas marker classes plus one generated stylesheet that paints the renderer's shape body; the
  stored colours and the XML never change, the view is reapplied after every edit, other elements are dimmed;
  a legend with counts (and what is missing).
- **Totals** on the process page (working model): steps (activities), approval steps, decisions, IT systems,
  roles (lanes holding steps) and the planned time of the main path = the start-to-end path with the largest
  processing + waiting time (back edges ignored, like a critical path; without times: the path with most steps).

## D-087 — Reports and exports: handbook (.docx), RACI and object reports (.xlsx) (Modeler design B2, 2026-10-29)

- **Built on the server** with `docx` (Word) and `exceljs` (Excel): one place for permission checks, the audit
  entry and the bilingual layout. Arabic files are fully right-to-left (bidirectional paragraphs and right-to-left
  runs, visually right-to-left tables in Word; right-to-left sheet views in Excel), in Arial (installed everywhere and covers Arabic; the
  self-hosted web fonts are not embedded in Office files).
- **Diagram images are rendered in the browser** (bpmn-js viewer → embedded fonts → PNG, width by number of
  processes) and sent with the request, so the server needs no headless browser. The server accepts PNG only
  (signature and size checked, `INVALID_IMAGE`); the handbook route alone allows a 10 MB JSON body (nginx 11 MB,
  Caddy 12 MB). A branch is limited to 40 processes (`REPORT_TOO_LARGE`); the client asks for the plan first.
- **Handbook**: cover (logo when PNG / JPEG, organisation name, source, date, user), table of contents (Word fills
  the page numbers on open), per process: description, details (code, category, status, owner, department,
  version and label, approved on / by, published on), diagram on its own landscape page, step table in flow
  order (type, role, IT system, description, attributes), linked documents (library DOCUMENT objects) and the
  text of linked SOP pages; page numbers in the footer.
- **RACI**: steps × roles — a role is the step's lane role (or lane name) plus PERFORMS links; **R** = performs,
  **A** = approves (approval steps); C / I are not modelled yet (BACKLOG). Extra sheets: IT systems per step,
  steps with their attributes, legend. **Object report**: every process and step where a role, system, term,
  document, risk, control or KPI is used.
- **Permissions**: users with `processes.read` choose the working or the published version; everyone else
  (Viewers, from the portal) always gets the published version, limited to what the Knowledge Portal shows them
  (`NOT_PUBLISHED` when the root is not published; unpublished sub-processes and unreadable pages are left out).
  Object reports need `objects.read` and `processes.read`. Every download writes an `EXPORT` audit entry (report,
  source, language, processes).

## D-088 — Modeling conventions as a quality gate (Modeler design B2, 2026-10-29)

- **Rules** (shared `packages/shared/src/conventions.ts`): labels in both languages (every step), steps in a lane
  linked to a library role, user tasks described (either language), diagram size (at most N flow elements, default
  50, 5 – 1,000), no unconnected elements, approval steps followed directly by a decision (exclusive, inclusive,
  complex or event-based gateway). "Step" = activity, as in the totals and reports.
- **Setting** `modeling.conventions` per rule `{ enabled, mandatory }` (mandatory implies enabled) plus
  `maxElements`; shipped default: every rule enabled as a warning, none mandatory, so nothing changes for existing
  processes until an Admin decides. Edited in Administration → Modeling conventions by holders of the new
  permission `conventions.manage` (Super Admin and Admin — Admins manage content structure; system settings stay
  Super Admin only), audited; read by everyone with `processes.read`.
- **One check, two places**: the modeler exports its XML and runs the shared reader (`parseBpmnGraph`) and
  `checkConventions` after every change, so the Validation panel shows exactly what the server checks. The server
  runs it on "Submit for review" against the version being submitted (processes only) and refuses with
  `400 CONVENTIONS_NOT_MET` listing the failed mandatory rules and element labels (EN/AR); the panel lists them
  with a "Required" tag. Processes already in review or published are not re-checked until their next submission.
- The basic diagram check "not connected" is hidden for elements the convention already reports (no duplicates).

## D-089 — Risk & Compliance data model: detail tables beside the library object (Phase 4.1, 2026-10-30)

- **Class-table design**: every risk, control and requirement is a `RepoObject` (type `RISK`, `CONTROL`, new
  `REQUIREMENT`) holding the shared fields — code, bilingual title and description (a requirement's bilingual
  text), owner, soft delete — plus a one-to-one detail row in `Risk`, `Control` or `Requirement` (primary key =
  object id). Step links, badges, the link panel, "where used", reports and published links therefore keep using
  `ObjectLink` / `PublishedLink` unchanged; nothing is duplicated as JSON attributes.
- **Risk**: configurable category key (Setting `grc`), cause and consequence EN/AR, department, inherent and
  residual likelihood / impact 1–5 (residual null = not assessed, the inherent rating stands), response
  (accept / avoid / mitigate / transfer), status (draft / active / retired), next review date.
  **Control**: type, nature, frequency, department, key control, IT system (`SYSTEM` library object),
  design effectiveness (effective / partly / not effective / not assessed), status, next review, last assessed.
  **Requirement**: level source → section → clause (`parentId`, a clause may hang under a source directly),
  source reference, `http(s)` link only, effective date, status.
- **Relations**: `RiskControl` (risk "mitigated by" control), `RequirementControl` (requirement "satisfied by"
  control); step and process links are `ObjectLink`s (default relation `MITIGATES` for risks and controls, new
  `REQUIRES` for requirements). A link to the whole process uses the element id `#process`
  (`PROCESS_ELEMENT_ID`), which saving a model never prunes.
- **History**: `GrcActivity` rows (CREATED, ASSESSMENT, STATUS, COMMENT) with `{ field: { from, to } }`, comment,
  author and time; every change of likelihood / impact / effectiveness writes one (audit action `ASSESS`).
  Comments on GRC items live here too (not in the process/page `Comment` table, which is tied to governance).
- **Ratings are computed** (score = likelihood × impact, band from the configurable thresholds), never stored, so
  changing the matrix re-rates everything at once. Lists filter, sort and page in memory after the database
  filters — fine for the expected few thousand items; revisit with stored scores if registers grow far beyond.
- **Existing data**: the migration gives every pre-existing `RISK` object a register row (category Operational,
  3 × 3, active) and every `CONTROL` object a control row (active, not assessed). Risks, controls and
  requirements can no longer be created or changed through `/objects` (`USE_GRC_REGISTER`); the library lists
  them read-only.

## D-090 — GRC permissions and the Risk & Compliance Officer role (Phase 4.1, 2026-10-30)

- New permissions `grc.read` (registers, dashboards), `grc.propose` (create risks and controls as drafts, change
  and delete one's own drafts), `grc.edit` (create, change, assess, activate, relate and link any item; Excel
  import), `grc.admin` (settings: categories, matrix, portal visibility; delete any item). `grc.propose` was added
  to the three requested permissions so process owners and modelers can propose without edit rights on the
  registers.
- New system role **Risk & Compliance Officer** (`RISK_OFFICER`): all four GRC permissions, the rest of the
  workspace read-only (same read bundle as a Reviewer, so it may comment and be a workflow approver).
  Process Owner and Modeler: `grc.read` + `grc.propose`. Auditor: `grc.read` (no comments, as elsewhere).
  Reviewer: `grc.read` (reviewers judge processes that show their risks; read-only). Viewer: none — the portal shows
  linked risks / controls only as the portal setting allows. Super Admin and Admin: everything.
- Requirements are created and changed by `grc.edit` only. Proposers can neither set effectiveness nor map
  requirements, and relate only their own drafts.

## D-091 — Who links risks, controls and requirements to steps (Phase 4.1, 2026-10-30)

- Linking is a change of the process content (links are published with the process), so the existing link
  endpoints are used with the governance lock (not while in review or archived; an approved / published process
  gets a new draft). Allowed: model editors of the process (with `grc.propose` for GRC items) — as before — and
  additionally `grc.edit` holders for GRC items on any process, without general model edit rights.

## D-092 — Risks and controls in the modeler, portal and handbook (Phase 4.1, 2026-10-30)

- **Modeler**: side panel tab "Risks & Controls" for the selected step (or the whole process when nothing is
  selected): linked risks with residual rating, controls with key flag and effectiveness, requirements; link an
  existing item, create (or, without `grc.edit`, propose as a draft) a risk / control that is linked to the step
  at once; unlink. Hidden while the process is in review or archived (the server refuses too).
- **Warning badge** `ALERT`: a step carries a high / critical residual risk (band flagged "alert") whose own
  mitigating controls (risk ↔ control relation) include no active, (partly) effective control. Judged per risk,
  not per step, so an effective control for a different risk on the same step does not hide the warning. Shown
  in the modeler, the read-only preview and (as published links allow) the portal. Risk and control counts use
  the existing B1 badges.
- **Colour by** (view only, D-086 mechanics): "Residual risk rating" (highest residual band of the step's risks,
  band colours) and "Risks without controls" (risk but no control at the step / risk with controls / no risk).
  Offered to `grc.read` holders only. Shared `summariseSteps` computes both.
- **Portal**: Setting `grc.portalVisibility` OFF (default) / CONTROLS / ALL, applied on the server to the published
  links of the portal process page and to the portal AI assistant's sources. Behaviour change: risk and control
  links that earlier phases showed in the portal are hidden until the setting is changed.
- **Handbook**: optional "Risks and controls" section per process (step, type, item, residual rating or
  effectiveness) from the links of the chosen source (working or published). GRC readers see every item; portal
  users only what the portal setting shows.

## D-093 — Risk dashboards, coverage and the risk–control matrix (Phase 4.1, 2026-10-30)

- **Scope**: organisation, a department or a process. A department's scope is the risks / controls / requirements
  owned by the department **or** linked to one of its processes; a process scope is what is linked to it. Only
  active items count. The registers accept the same scope (`scopeDepartmentId`, `processId`) so every tile and
  heat-map cell opens the matching filtered list.
- **Heat maps**: inherent and residual (residual falls back to inherent until assessed) side by side; a cell lists
  its risks. **Drill-down**: departments (by linked processes) → processes → steps (opens the modeler at the step).
- **Coverage**: risks without controls; high / critical residual risks; of these without an effective own control;
  key controls not assessed / not effective; requirements without controls; steps and processes with risks but no
  control linked at the step; overdue reviews (risks + controls).
- **RCM export** (`GET /grc/rcm`, `grc.read`, audited `EXPORT`): one row per step × risk × mitigating control with
  the control's requirements, ratings and effectiveness; sheets "Coverage" and "Steps without controls". Arabic
  workbooks are right-to-left.

## D-094 — GRC review reminders; approval of GRC changes deferred (Phase 4.1, 2026-10-30)

- **Reminders**: the governance scheduler also runs `GrcRemindersService`: active risks, controls and requirements
  with an owner and a next review date within `reminderDaysBefore` days (Settings → Risk & Compliance, default 14) notify the owner once ("due") and once more when overdue — one new notification type `GRC_REVIEW`
  (`params.kind` due / overdue, in-app and e-mail, own preference), deduplicated per item and date. The same items
  appear under My tasks → "Risk & control reviews" (counted in the menu badge) for `grc.read` holders. Overdue
  flags show in the registers, detail pages and the dashboard tile.
- **Approval of risk / control changes through governance workflows** (optional, default off in the brief) is
  **not built in this part**: today new items proposed by process owners / modelers are drafts that only a
  Risk & Compliance editor can activate, which covers the approval of new items; routing changes of active items
  through the Phase 3 workflows needs the review model to support library objects (versions of an object, review
  rounds) and is listed in BACKLOG for Phase 4.2 — a product-owner decision is requested in the pull request.

## D-095 — Control-gap check: rules first, AI explains and proposes (Phase 4.1, 2026-10-30)

- **Rules** (shared `detectControlGaps`, run on the server: `GET /grc/processes/:id/gaps`): high / critical
  residual risk whose own controls are not effective; segregation of duties (an approval step in the same lane as
  a step leading to it, directly or through gateways / events); links to elements that are no longer in the
  diagram; requirements mapped to the process while no step has a control; linked controls never assessed or with
  an overdue review ("missing evidence of review"). They work without the AI.
- **AI** (`POST /ai/control-gaps`, feature `CONTROL_GAPS`, same access, limits and audit as the other AI features,
  plus `grc.read`): the process outline, linked items, rule gaps and the control library go to the model, which
  explains each gap, may add others (kind OTHER) and proposes an action — link an existing control to a step or
  create a new one (names EN/AR). Ids the model invents are dropped and impossible actions become "none".
- **Nothing changes automatically**: in the modeler (Risks & Controls → "Check control gaps") each suggestion has
  Accept (calls the normal link endpoint, or opens the control form prefilled and links the saved control) and
  Dismiss (client only). Proposers create drafts as usual.

## D-096 — `decode-uri-component` override (Phase 4.1, 2026-10-30)

- `pnpm audit --audit-level high --prod` reported GHSA-qr28-fpjm-wq7f (high) on `minio → query-string 7 →
decode-uri-component 0.2.2`, also on `main`; no MinIO release avoids it. Root `pnpm.overrides` forces
  `decode-uri-component@<0.5.1` to `^0.5.1` (ESM-only). MinIO uses only `query-string.stringify` (the decoder is
  never called); Node 22 loads the ES module through `require(esm)`, verified in the production API image, and the
  API Jest config compiles it like `openid-client`. Remove the override when MinIO drops `query-string` 7.

## D-097 — Product owner decisions on Phase 4.1 (2026-10-30)

1. **Approval of changes to active risks and controls** through the governance workflows moves to **Phase 4.2**;
   it is not needed before go-live (BACKLOG, Phase 4.2). Today new proposals stay drafts until a Risk & Compliance
   officer activates them (D-094).
2. **Reviewers keep `grc.read`**: they need the risk context when they approve processes (D-090).
3. **The portal hides risks and controls by default** (`grc.portalVisibility` = OFF): accepted — there is no real
   content yet and hidden is the safe default; the setting will be decided before go-live (D-092).
4. **`grc.propose` for Process Owners and Modelers** is approved: they only propose drafts; the officer activates
   them (D-090).
5. **Warning badge per risk**: confirmed — the badge checks each risk's own mitigating controls; a control on the
   same step that does not mitigate that risk must not hide the warning (D-092).

## D-098 — Approval of changes to active risks and controls (Phase 4.2, 2026-10-30)

- **Setting** `grc.changeApproval` `{ enabled, types, workflowId }`: off by default (stored settings from Phase 4.1 stay
  valid); once enabled it covers risks and controls unless one type is unticked. The workflow is the one chosen in
  Settings → Risk & Compliance, else the governance default workflow; without one the change is refused
  (`NO_WORKFLOW`).
- **What is routed**: every update of a risk / control whose status is not DRAFT (ratings, owner, description,
  relations, effectiveness, retirement via status). Drafts edit freely. Excel imports by Risk & Compliance editors
  still apply directly (bulk administration, audited `IMPORT`); deletion stays a `grc.admin` action.
- **Model**: `GrcChange` (proposed input as sent, `fields` = before / after at submission, workflow snapshot with the
  resolved assignees, current step) and `GrcChangeTask` per assignee. A separate model instead of the process / page
  `Review`, which is tied to versions and publications of content. The Phase 3 rules apply: steps in order, ANY /
  ALL, four-eyes (the submitter is never an approver; `SELF_APPROVAL_NOT_ALLOWED` / `WORKFLOW_NO_ASSIGNEES`), and
  approvers need `reviews.decide` (read-only roles never approve) plus `grc.read`.
- **In force**: the item keeps its current values until the last step approves; the stored input is then applied
  unchanged through the normal update (assessment history, audit `ASSESS` / `UPDATE`), with `SUBMIT` / `APPROVE` /
  `REJECT` / `WITHDRAW` audit entries on the risk or control. One pending change per item (`CHANGE_PENDING`); the
  submitter or a `grc.admin` may withdraw it.
- **Wiring**: the assurance module registers a change gate on `GrcService` (no module cycle between GRC and
  governance). Notification `GRC_CHANGE` (`params.kind` requested / approved / rejected) with its own preference;
  the approvals appear in My tasks ("Change approvals", `GET /assurance/tasks`).

## D-099 — Control testing and tested effectiveness (Phase 4.2, 2026-10-30)

- **Plans and tests**: a control has any number of test plans (design or operating effectiveness). Test frequency
  defaults from the control frequency (per transaction … monthly → quarterly, quarterly → every six months, annual /
  ad hoc → annually) and the sample size from common audit practice (25 / 20 / 5 / 2 / 2 / 1). Tests copy the plan's
  procedure, sample size and people when they are created, so later plan changes never alter a running test.
- **Who**: tester and reviewer are a user, everyone with a system role, or nobody (then any holder of
  `controls.test` / `controls.review`; notifications go to the Risk & Compliance editors). `grc.edit` holders manage
  plans, create tests ("Test now") and may also execute any open test. Four-eyes: the same user is never both tester
  and reviewer of a plan or test, and whoever executed a test can never review it (`403`).
- **Lifecycle**: Planned → In progress (start / first save) → Submitted (every sample has a result, a conclusion is
  chosen — `TEST_INCOMPLETE`) → Reviewed (sign off) or Returned (reason required) → Closed. Transitions are
  compare-and-set on the status (concurrent clicks get `INVALID_TRANSITION`).
- **Effectiveness**: the reviewed conclusion is written to the control's new `operatingEffectiveness` (effective →
  EFFECTIVE, with exceptions → PARTLY, not effective → NOT_EFFECTIVE) with an assessment entry in the control's GRC
  history and an `ASSESS` audit entry. The self-assessed `effectiveness` stays as it is. Wherever the system judges
  whether a control protects (risk "effectively controlled", alert badge, coverage tiles, gap rules), the tested value
  wins once there is one (`currentEffectiveness`).
- **Scheduler**: the assurance module runs its own scheduler (same interval setting as governance) to avoid a module
  cycle; it creates the test of an active plan when the next due date is within `leadDays` (one per due date, at most a
  year of catch-up per run) and moves the plan on by its frequency, then sends due / overdue reminders once per test
  (markers on the test plus dedupe keys).
- **Evidence** is stored like page attachments (same allow-list, magic-byte check, 10 MB) in a generic
  `AssuranceFile` table used by every Phase 4.2 record; downloads go through `GET /assurance/files/:id`, which asks
  the owning feature whether the caller may read the record (404 otherwise), with `Content-Disposition: attachment`
  and a sandbox CSP.

## D-100 — Issues, action plans, verification and escalation (Phase 4.2, 2026-10-30)

- **Sources**: a failed or "with exceptions" control test, a risk (assessment), an audit finding, a portal feedback item,
  or by hand. The source fills default links (test → control and department, risk → risk, feedback → process) and the
  issue keeps a link back. Creating issues needs `issues.manage` (Risk & Compliance officers, admins); accepted audit
  findings create them through the service.
- **Severity** comes from a configurable scale in the new Setting `assurance` (default Low / Medium / High / Critical,
  2–6 levels, also used to rate audit findings), together with the reminder days, escalation days and target.
- **Who works on it**: the owner edits the content of an open issue and its action plan; only issue managers change the
  owner or the severity; action owners update progress, note and evidence of their own action. People involved (owner,
  raiser, action owners) open the issue without `grc.read`; action owners without the workspace (e.g. Viewers) do it
  in the portal (`/portal/tasks`, `/portal/issues/:id`); workspace links redirect there.
- **Closing**: "Ready for verification" needs every action at 100 % (`ACTIONS_OPEN`); "Verify and close" is done by the
  raiser or a Risk & Compliance officer and never by the owner (four-eyes); "Not fixed yet" returns it with a reason.
  "Accept risk" needs `grc.edit`, a justification, and a different person than the owner; the approver and date are
  recorded. "Reopen" (reason required) for managers / officers. All transitions audited and in the history.
- **Escalation**: owners are reminded before the due date and when overdue (issues and actions); after `escalationDays`
  the issue / action is escalated once to the manager of the owner's department (new `Department.managerId`), to the
  Risk & Compliance officers, or both (setting); without a manager the officers are always told.

## D-101 — Audit management and the Internal Audit role (Phase 4.2, 2026-10-30)

- **Role**: new system role **Internal Audit** (`INTERNAL_AUDIT`) with `audit.manage`, `controls.test`,
  `controls.review`, `surveys.manage`, `grc.read` and the usual read bundle. The existing read-only **Auditor** role is
  unchanged in spirit: it reads audits (through its `audit.read`) but changes nothing.
- **Who sees audits**: `audit.manage`, Risk & Compliance editors (`grc.edit`) and `audit.read` holders. Audit content is
  more sensitive than the registers, so `grc.read` alone (process owners, modelers, reviewers) is not enough.
  A finding's **response owner** opens that one finding (`/grc/findings/:id`, or in the portal) and answers it without
  any audit permission.
- **Universe and plan**: the universe is computed (no extra table): every process (not archived) and department, with
  the highest residual score of its active risks (linked to the process, or owned by / linked to processes of the
  department) as the priority, the latest actual end of a reporting / follow-up / closed engagement covering it as
  "last audited", and the engagements of the selected year. The annual plan is the list of engagements of a year.
- **Lifecycle**: Planned → Fieldwork (sets the actual start) → Reporting (sets the actual end and asks every response
  owner for a response) → Follow-up → Closed; one stage at a time, back or forward; closing needs every finding answered.
  Closed engagements are read-only.
- **Findings → issues**: "Agree" needs an action and a target date and creates an `Issue` (source AUDIT_FINDING,
  severity = finding rating, owner = the chosen action owner, due = target date, one action) that carries the
  finding's process, step, risk, control and requirement — the root-cause trace the RFP asks for; the issue links back
  to the finding. An agreed finding can no longer be edited (`FINDING_AGREED`). "Disagree" needs a reason.
- **Report**: `.docx` generated on the server with the same `docx` library and style as the B2 handbook (cover with
  organisation name and logo, executive summary, objective, scope table, findings table coloured by rating, each finding
  with trace and management response), English or Arabic right-to-left; downloads are audited (`EXPORT`).

## D-102 — Questionnaires, campaigns, self-assessment proposals and process feedback (Phase 4.2, 2026-10-30)

- **Definition as JSON**: a questionnaire is one JSON definition (sections → questions) validated by a shared zod
  schema, not tables per question: questions are always read and written together, and campaigns keep a snapshot so a
  later edit of the questionnaire never changes a running campaign. Conditions may only refer to an earlier question.
- **Who**: `surveys.manage` (Risk & Compliance officers, Internal Audit, admins) builds questionnaires and runs
  campaigns; `surveys.respond` (every role, Viewers included) answers what was sent to them — the audience is resolved
  to active users holding `surveys.respond` when the campaign is launched and fixed from then on. Respondents only ever
  see their own response (404 otherwise). Viewers answer in the portal (`/portal/surveys/:id`).
- **Scoring**: rating = value × weight (max 5 × weight), yes / no = weight / 0 (N/A not counted), choices = option
  score × weight (max: best option, or the sum of positive options for multiple choice); hidden questions do not count.
- **Self-assessment (RCSA)**: a rating question may propose a risk's residual likelihood or impact, a single-choice
  question (options effective / partly / not effective) a control's effectiveness. Submissions create proposals; a
  Risk & Compliance officer (`grc.edit`) accepts them through the normal update (with the change approval of D-098
  when it is on; the other residual value is kept) or dismisses them. Answers never change ratings by themselves.
- **Process feedback**: "Request feedback" is open to the editors of the process (and survey managers); it uses a
  built-in four-question questionnaire, launches at once and gives recipients — also without the workspace — a
  read-only view of the working (draft) diagram through their response only. Each submission is posted as a comment
  on the process (Comments panel), authored by the respondent; the requester follows the campaign and its results.
- **Reminders**: once per recipient, `reminderDaysBefore` days before the end; campaigns close themselves the day after
  their end date (assurance scheduler).

## D-103 — Assurance dashboard and the "tested effectiveness" heat map (Phase 4.2, 2026-10-30)

- **Dashboard scope** as on the risk dashboard: organisation, a department (tests of controls owned by the department
  or linked to its processes; issues of its processes or the department; engagements and campaigns covering it) or a
  process. "Done" = tests reviewed or closed in the selected year; "due" / "overdue" = open tests (planned, in
  progress, returned) before / after their due date; % effective = reviewed tests not concluded "not effective".
  Readable by `grc.read`, `audit.manage` and `issues.manage` holders; every figure links to the matching filtered list.
- **Tested heat map**: the residual rating assumes the controls work. With "Using tested effectiveness" a risk keeps
  its residual position only while at least one active mitigating control has a reviewed test result of effective or
  partly effective; otherwise it is shown at its inherent rating. The stored ratings never change.
- **Viewer role**: Viewers stay read-only except answering questionnaires sent to them (`surveys.respond`).

## D-104 — No deletion of active risks / controls; Excel imports through change approval (Phase 4.2, 2026-10-30)

Product owner decision (PR #14, decision 1), closing the gap left in D-098:

- **Deletion**: active and retired risks and controls cannot be deleted (`409 RETIRE_INSTEAD`), by anyone; they are
  retired (status RETIRED), which goes through change approval when it is on. Drafts can still be deleted (their
  proposer or a `grc.admin`). Requirements are unchanged (`grc.admin` deletes).
- **Excel import while change approval is on** (risks / controls): rows that change an active or retired item become
  pending changes that share one **batch** (`GrcChange.batchId`); rows that change nothing are skipped; new items are
  imported as **drafts**; a row for an item that already has a pending change is refused in the validation report
  (`CHANGE_PENDING`), so nothing is imported while it is there. The report shows how many rows wait for approval
  (dry run: an estimate). Approvers get one notification per import (`GRC_CHANGE`, kind `batch`) and approve or reject
  the whole batch in My tasks (`POST /grc/changes/batches/:batchId/decision`, every change of the batch that waits for
  the caller; the per-change rules — steps, four-eyes — still apply). With approval off, imports apply directly and
  are audited as before.

## D-105 — Both effectiveness values; "test overdue" (Phase 4.2, 2026-10-30)

Product owner decision (PR #14, decision 6), confirming D-099 with two additions:

- The control page shows the **self-assessed** and the **tested** effectiveness side by side and marks which one
  counts (the tested one once a test was reviewed).
- **Test overdue**: a tested result older than one test cycle — the shortest frequency of the control's active test
  plans (monthly 1, quarterly 3, every six months 6, annually / on demand 12 months; 12 months without a plan) — still
  counts but is flagged "Test overdue" on the control, in the control register (filter `testOverdue`) and as a coverage
  tile on the risk dashboard ("Tested results older than one test cycle").

## D-106 — Product owner decisions on Phase 4.2 (2026-10-30)

1. Imports and deletions: see D-104.
2. **Change approval** stays **off by default** in the product. The **base seed** (every installation, once) creates
   the workflow **"GRC change approval"** — one step, role Risk & Compliance Officer, rule ANY — and preselects it in
   the setting. At go-live it is switched on for risks and controls (DEPLOYMENT.md §6 step 9, SECURITY.md §7).
3. **Audit visibility** stays as in D-101. Sharing the final report with the owners of the processes in scope is in
   BACKLOG.
4. **Viewers** keep `surveys.respond` and may update the issue actions assigned to them. The server checks the
   assignment, not only the permission: a response belongs to its recipient (404 for anybody else, also for uploads
   and the feedback diagram); an action is updated only by its owner, the issue owner or an issue manager (403
   otherwise; others do not see the issue at all). Permission tests cover both.
5. **Feedback-request answers** stay process comments signed by the respondent; each starts with a label naming the
   campaign — "[Feedback request] <campaign title>" (Arabic: «[طلب ملاحظات]»).
6. Tested effectiveness replaces the self-assessed one: see D-105.

## D-107 — Application catalogue on the IT system library objects (Phase 4.3, 2026-10-30)

The application catalogue (module M11) extends the existing IT system objects instead of replacing them, the same
pattern as risks and controls (D-089): a new table `Application` is one-to-one with a `RepoObject` of type `SYSTEM`
(`objectId` = the object id). Code, bilingual name and description stay on the library object; the catalogue fields
(type, vendor, version, business / IT owner, department, hosting + ISO country for data residency, lifecycle with
live / phase-out / retired dates, criticality, data classification, licence notes, URL) live on `Application`.

- **Ids, step links, badges and "where used" keep working**: the modeler still links `SYSTEM` objects (relation
  `SUPPORTS`), Risk & Compliance still points controls at them (`Control.systemId`).
- The migration creates an `Application` row for every existing `SYSTEM` object; objects created later through the
  library, the seed or an import get theirs on creation or lazily (`EaService.ensureApplicationRows`).
- The library menu item "IT systems" becomes "Applications" in the new **Architecture** menu group for users with
  `ea.read`; `/library/systems` redirects there (users without `ea.read` keep the plain library page).
- Deleting an application (soft delete, `ea.admin`) removes its step links, interfaces, CRUD usages and capability
  relations, like deleting a library object.

## D-108 — Architecture permissions and the Enterprise Architect role (Phase 4.3, 2026-10-30)

New permissions `ea.read` (catalogues, views, traceability, exports), `ea.edit` (create / change, Excel import) and
`ea.admin` (delete). New system role **Enterprise Architect** (`ENTERPRISE_ARCHITECT`): the three EA permissions, the
rest of the workspace read-only (like the Risk & Compliance Officer, D-090) plus `grc.read` for the risk columns of
the impact analysis. `ea.read` is added to every workspace role (Process Owner, Modeler, Reviewer, Auditor, Risk &
Compliance Officer, Internal Audit); Viewers (portal only) never see the architecture workspace. Demo user
`architect@processhub.local`. Every endpoint has a server guard and a permission test (`ea.e2e-spec.ts`); every write
is audited (entity types `Application`, `AppInterface`, `DataObject`, `Capability`; `EXPORT` / `IMPORT` for Excel).

## D-109 — Interfaces, data objects and the capability map (Phase 4.3, 2026-10-30)

- **Interfaces** (`AppInterface`): source → target application, direction (one way / both ways), technology (API,
  file, DB link, manual, message queue), frequency, data objects carried (`InterfaceDataObject`), owner, status
  (planned / active / retired); optional bilingual name (the list shows "Source → Target" when empty).
- **Data objects** (`DataObject`): bilingual name and definition, classification, system of record (one
  application), owner; the **CRUD matrix** is `DataObjectUsage` (application × data object with four flags), edited
  on the data object and shown as a matrix (★ = system of record).
- **Capabilities** (`Capability`): a tree of at most three levels (level stored, recomputed on a move; deeper trees
  and cycles are refused with `CAPABILITY_TOO_DEEP` / `INVALID_PARENT`; only leaves can be deleted), owner, strategic
  importance, relations to processes (`CapabilityProcess`) and applications (`CapabilityApplication`).
- **Excel** for each catalogue (`/ea/export|template|import/:kind`, kinds applications, interfaces, data-objects,
  capabilities): the Phase 4.1 pattern — upsert by code, the whole file is checked first and nothing is imported
  while it has errors; references by code (applications, capabilities, processes, data objects) or e-mail (users);
  the CRUD column reads `APP:CRUD; APP2:R`; capability parents may be defined later in the same file. Shared helpers
  in `apps/api/src/common/excel.ts` (also used by the KPI catalogue).

## D-110 — Architecture views, traceability and impact analysis (Phase 4.3, 2026-10-30)

- **Capability map** (`GET /ea/capability-map`): every capability with metrics rolled up over its sub-capabilities —
  processes, applications, applications per lifecycle, the worst lifecycle (retired > phasing out > planned >
  active) and the highest residual score / band of active risks on any step of those processes (only for users with
  `grc.read`). The web map shows level-1 columns with nested level-2 / 3 tiles and "colour by" process coverage
  (none / one / several), number of applications, application lifecycle or risk rating (GRC bands); a tile opens a
  drawer with the processes and applications and links to the landscape and the traceability of that capability.
- **Landscape** (`GET /ea/landscape`, filters department / capability (with sub-capabilities) / lifecycle, optionally
  the connected applications one hop away): drawn in the browser as SVG with a small layered layout
  (`features/ea/landscape-layout.ts`: longest-path ranks, cycles broken by DFS, two barycentre sweeps, unconnected
  applications in a last row) — no new diagram library. Right-to-left in Arabic; export SVG / PNG.
- **Traceability** (`GET /ea/trace` + `/ea/trace/export`): rows capability → process → step → application → data
  objects (CRUD, system of record), with the risks and controls linked to the same step (only with `grc.read`);
  filter by capability, process, application or data object (backwards from data to steps). Processes of a
  capability without any application on their steps still appear (one row).
- **Impact analysis** (`GET /ea/applications/:id/impact` + `/export`): supported steps with their risks and controls,
  controls affected (running in the application via `Control.systemId` or sitting on a supported step), interfaces,
  data objects, capabilities and summary counts; Excel EN / AR (summary, steps, controls, interfaces, data), audited
  `EXPORT`.
- **Modeler**: the IT system link of a step is the application catalogue (same objects); "Colour by" gains
  **Application lifecycle** (the worst lifecycle of the step's applications; steps using phasing-out systems stand
  out). **Process handbook**: optional section **"Systems and data"** (application, lifecycle, steps supported, data
  objects with CRUD and ★ for the system of record) for users with `ea.read`.

## D-111 — KPI table on the KPI library objects; objectives and relations (Phase 4.3, 2026-10-30)

The plain KPI library object type is replaced by a full KPI definition the same way as risks (D-089) and applications
(D-107): table `Kpi` one-to-one with a `RepoObject` of type `KPI`. Code, bilingual name, definition (the object's
description) and owner stay on the object; `Kpi` holds formula (EN / AR), unit, direction (higher / lower is better),
frequency (monthly / quarterly / annual), target, green and red thresholds, baseline (+ period), department, data
source (manual / Excel / Salesforce / calculated), status (draft / active / retired), the calculated metric and
process, and the Salesforce fields of step 5. The migration creates a `Kpi` row for every existing KPI object (same
id, so links stay); later ones get theirs lazily. KPI objects can no longer be created or changed through
`/objects` (`USE_KPI_REGISTER`).

- **Per-period targets** (`KpiPeriodTarget`) override target / thresholds for one period.
- **Relations**: process and step via the existing `ObjectLink` relation `MEASURES` (process-level = `#process`),
  capability (`KpiCapability`), strategic objective (`KpiObjective`; `StrategicObjective` is a simple bilingual tree
  with owner and order), risk = **key risk indicator** (`KpiRisk`).
- **Status** (shared `kpiRag`): higher is better — at or above green (default: the target) GREEN, at or below red RED,
  between AMBER; lower is better mirrored; without a red threshold everything short of green is RED; no target and no
  green threshold — no status. Computed, never stored, so a threshold change re-colours the history.
- **Calculated process KPIs** (shared `calculatedProcessKpis`, from the B2 step attributes of the working model, main
  path as in the process totals): planned duration, waiting time, cost per execution, handovers between lanes on the
  main path, automation rate (system steps ÷ steps). Shown on the process page / modeler; a KPI with data source
  "calculated" records the current value for the due period on "Record current value".

## D-112 — KPI permissions, measurements, reminders and evidence (Phase 4.3, 2026-10-30)

- Permissions `kpi.read` (catalogue, dashboards, process KPIs), `kpi.edit` (define KPIs and objectives, any value,
  Excel import of the catalogue, KPI settings) and `kpi.measure` (enter values of **the KPIs one owns** — checked on
  the server against `RepoObject.ownerId`). `kpi.read` for every workspace role, `kpi.measure` for Process Owners,
  `kpi.edit` for Admins (and Super Admins) only — a dedicated "Performance Officer" role was not requested (open
  question in the pull request).
- **Measurements** (`KpiMeasurement`, unique per KPI and period `2026-03` / `2026-Q1` / `2026`, period must match the
  frequency and have started), with comment, source and full audit history (create / update / delete, `SYNC` for
  Salesforce). Values of Salesforce KPIs cannot be entered or deleted in ProcessHub. A frequency change is refused
  once values exist.
- **Evidence** reuses the assurance file store (`AssuranceFile` owner type `KPI_MEASUREMENT`: allow-list, magic
  bytes, size limit; download `/assurance/files/:id` for `kpi.read` holders, upload / delete for whoever may enter
  the value).
- **Due values**: the last completed period of an active manual / Excel KPI without a value is "due": My tasks tab
  "KPI values to enter" (`GET /kpis/tasks`) and one reminder per KPI and period from the `KpiScheduler` (notification
  type `KPI`, kind `due`, EN / AR e-mail; Setting `kpi.reminders`).
- **Excel** (`/kpis/export|template|import/:kind`, kinds kpis, measurements, objectives): the catalogue and the
  objectives for `kpi.edit`; measurements also for owners (rows of other people's KPIs are reported `NOT_OWNER`);
  imported values have source "Excel import".

## D-113 — KPI dashboards, process performance, portal; charts with Recharts (Phase 4.3, 2026-10-30)

The web app had no chart library (Phase 4.1 / 4.2 dashboards use Ant Design tiles and bars). The KPI detail line
chart (actuals vs per-period target, green / red threshold lines, points coloured by status) uses **Recharts 2.15**
— a proven, MIT-licensed React library built on SVG (no canvas), small enough, and without new runtime services.
Arabic: the x axis is reversed and the y axis moves to the right; numbers and periods via `Intl`. Sparklines in
tables and the landscape diagram stay plain SVG.

- **KPI dashboard** (`GET /kpis/scorecard`, `/kpis/scorecard/export` EN / AR): active KPIs in scope (department,
  process — linked or calculated from it —, owner) as of a month (each KPI's latest value of a period that started by
  then), grouped by strategic objective (ancestors shown for the tree, worst status per objective, KPIs worst first,
  "without an objective" last); summary tiles open the filtered register; a KPI row opens a drawer with its chart.
- **Process performance**: the process page shows the KPIs of the process and its steps with their latest status and
  the calculated process KPIs; the modeler side panel gains a **KPIs** tab (selected step or whole process; model
  editors link / unlink KPIs — `MEASURES` links); the badges (B1) gain a KPI chip per step in the colour of the
  worst status, and "Colour by" gains **KPI status**.
- **Knowledge Portal**: Setting `kpi.showInPortal` (off by default; KPI settings, `kpi.edit`). When on, a published
  process page lists the KPIs linked to the process or to steps of the published diagram with the live latest status,
  value / target and trend (KPI values are live data, not part of the published snapshot); when off, KPI links are
  also hidden from the step details.

## D-114 — Salesforce KPI link: settings, credentials, read-only access (Phase 4.3, 2026-10-30)

- **Settings → Integrations → Salesforce** (`/settings/salesforce`, API `/integrations/salesforce`): **Super Admin
  only** (`settings.manage`), **off by default**. Instance URL (My Domain), authentication **OAuth 2.0 client
  credentials** (consumer key + secret, "Run As" integration user) or **JWT bearer** (consumer key, integration
  username, login URL, private key of the connected app certificate, RS256 signed in the API with Node `crypto`),
  API version, schedule, "import actual values".
- Secrets (consumer secret, private key) are **write-only** and stored only as **AES-256-GCM** ciphertext with
  `INTEGRATIONS_ENCRYPTION_KEY` (the Git integration's `SecretBox`); the DTO says only whether they are stored; the
  audit entry records that they changed, never the values.
- **Read-only by construction**: the transport (`SalesforceHttp`, the only network code) sends `GET` for SOQL
  queries / describes and `POST` only to `/services/oauth2/token`. SOQL is built from object / field API names
  validated against `^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z][A-Za-z0-9_]*)*$` (no free-text WHERE clauses); pages follow
  `nextRecordsUrl` only within `/services/data/vXX.X/query/`. Outbound policy as for Git: https only, internal
  addresses refused, plain http only for `OUTBOUND_ALLOWED_HOSTS` (used by the e2e mock), timeout
  `SALESFORCE_HTTP_TIMEOUT_MS`. Salesforce-side setup (integration user, read-only permission set, connected app):
  DEPLOYMENT.md §6.4.
- KPIs linked to Salesforce show "Source: Salesforce", the last sync time and a link to the record
  (`/lightning/r/<Id>/view`); the mapped definition fields (`Kpi.lockedFields`) and the values are read-only in
  ProcessHub (`SALESFORCE_OWNED`); thresholds, owner, relations and process links stay editable.

## D-115 — Salesforce field mapping, defaults and matching (Phase 4.3, 2026-10-30)

The brief described `Org_Kpi_Goal__c` as objectives, `Org_Kpi_Measure__c` as KPIs and `Org_Kpi_Process__c` as the
KPI ↔ process mapping. The documented PMS data model differs: `Org_Kpi_Goal__c` is the **KPI Description Card**
(the corporate KPI catalogue, with the strategic objective as the picklist `Department_Goal__c`),
`Org_Kpi_Measure__c` is one row per KPI and **measuring year** (yearly target / achievement), and
`Org_Kpi_Process__c` is the **period result** (quarter / half / full year, target, achievement, notes). The defaults
therefore follow the documented model, and **everything is configurable** on the mapping screen (Settings), so a
sandbox with other names or the brief's reading needs no code change:

- **Objectives**: from their own object (lookup on the KPI) or from the values of a KPI field (default
  `Department_Goal__c`; Salesforce Id stored as `<field>:<value>`), or none.
- **KPIs**: object (default `Org_Kpi_Goal__c`) and fields for code, names, definitions, unit, direction,
  frequency, target, status, objective; value lists translate Salesforce picklist values (e.g. `Increase =
HIGHER_IS_BETTER`, `Quarterly = QUARTERLY`).
- **Actual values**: object (default `Org_Kpi_Process__c`) with the KPI id path, year, period, value, target and
  comment (defaults through `Org_Kpi_Measure__r`); period values map to Q1–Q4, M01–M12 or YEAR; a period that does not
  fit the KPI's frequency is skipped with a warning; future periods are skipped; a result's target becomes the
  KPI's target of that period.
- **KPI ↔ process mapping**: optional object with the KPI id path and a field holding the ProcessHub process
  code (whole-process `MEASURES` links; unknown codes are reported). Empty by default (not in the documented model).
- **Matching** by the Salesforce Id stored on the objective (`StrategicObjective.salesforceId`) / KPI
  (`Kpi.salesforceId`) and per KPI + period for values; nothing is ever deleted by a sync.

## D-116 — Salesforce preview, sync runs, schedule and failures (Phase 4.3, 2026-10-30)

- **Preview** (`POST /integrations/salesforce/preview`) reads Salesforce and lists what a sync would create /
  change (objectives, KPIs with field-level from → to, values, process links) and the warnings; nothing is written.
- **Sync** (`POST …/sync`, manual or scheduled) applies the same differences through the KPI service (audit
  entries with action `SYNC` per objective / KPI / value) and records a **sync run** (`SalesforceSyncRun`: trigger,
  status, counts, warnings, error; one at a time) shown in the **sync log**; the run itself is audited (`SYNC`,
  entity `Integration`).
- **Schedule**: off / hourly / daily / weekly (Monday) at an hour (UTC), run by the `KpiScheduler` (the Salesforce
  module registers a job; the last slot is stored so a restart does not repeat it). Scheduled runs act as the Super
  Admin who last saved the settings.
- **Failures** (sign-in refused, query error, network) mark the run FAILED with the scrubbed message and notify
  every active Super Admin (notification `KPI`, kind `syncFailed`, EN / AR e-mail).
- **Tests** never call Salesforce: the API tests replace the transport with `FakeSalesforce` serving recorded
  fixtures (`apps/api/test/fixtures/salesforce`, invented ids and values); the Playwright test runs a mock HTTP
  server with the same fixtures, reached from the API through `host.docker.internal` (CI) / `localhost` (local).

## D-117 — Salesforce mapping confirmed by the product owner (Phase 4.3, 2026-10-31)

Answers to the open questions of D-115; supersedes its process mapping and adds what the PMS model holds.

- **Objects** (documented PMS model is the default): `Org_Kpi_Goal__c` (KPI description card) = the KPI
  definition; its strategic objective picklist `Department_Goal__c` → ProcessHub strategic objectives;
  `Org_Kpi_Measure__c` = yearly target and achieved value per KPI; `Org_Kpi_Process__c` = period results (Q1–Q4,
  half year, full year) imported as measurements.
- **Objectives**: a picklist value not yet mapped becomes an objective (matched by `<field>:<value>` as before); the
  mapping screen can link a value to an **existing** objective (`mapping.objectives.valueLinks`: value → objective
  id; a deleted objective falls back to the import).
- **Results**: only `Approved__c = true` (a `WHERE` on the validated field name); Setting
  `includeUnapproved` (off by default) imports the others too. **Causality** and **corrective actions** are added to
  the measurement comment (`Causality: …` / `Corrective actions: …`).
- **Half years**: new KPI frequency `SEMI_ANNUAL` with periods `2026-H1` / `2026-H2` (shared period helpers,
  value lists `Semi-Annual`, `First Half`, `Second Half`).
- **Yearly measures**: the yearly target becomes the target of the year's last period (Q4, H2, December or the
  year) unless a period result gives one; for annual KPIs the achieved value is the year's value when no result
  exists.
- **No KPI ↔ process mapping from Salesforce** (it has none): the `processMap` group and the preview's process
  links are removed; links are made in ProcessHub.
- Field names are to be confirmed when IT sets up the integration user (DEPLOYMENT §6.4); everything stays
  editable on the mapping screen.

## D-118 — Performance Officer role (Phase 4.3, 2026-10-31)

- New system role **Performance Officer** (Strategy Office, `PERFORMANCE_OFFICER`): `kpi.read`, `kpi.edit`,
  `kpi.measure` and the new **`kpi.sync`**, plus read access to the repository, users, governance dashboard, GRC
  and architecture. It creates and edits all KPIs, objectives and targets and enters values for any KPI.
- **`kpi.sync`**: read the Salesforce settings (never the secrets), preview, run the sync and read the sync log.
  Changing the connection, mapping, test and describe stay `settings.manage` (Super Admin). Admins keep their
  rights (`kpi.edit`) but do not get `kpi.sync` — the Salesforce link stays with Super Admins and Performance
  Officers. Process Owners still enter values only for the KPIs they own.
- Failed syncs notify Super Admins and holders of `kpi.sync`. Demo user `performance@processhub.local`.
- Confirmed by the product owner (2026-10-31): Admins stay without `kpi.sync`; Performance Officers keep the KPI
  settings (show KPIs in the portal, reminders — part of `kpi.edit`). Every change of those settings is audited
  (action `UPDATE`, entity `Setting` `kpi`, the user, before / after).

## D-119 — Scheduled Salesforce syncs run as a system actor (Phase 4.3, 2026-10-31)

Supersedes the "act as the Super Admin" rule of D-116.

- Scheduled runs use the system actor **"Salesforce sync"**: no user id on the run, on the records it creates
  (`createdById` / `updatedById` empty) or on the audit entries, so automatic changes are not attributed to a
  person. Manual runs keep the user who started them.
- Every run stores **configured by** (`SalesforceSyncRun.configuredById` = the user who last saved the Salesforce
  settings); audit entries of a sync carry `actor: "Salesforce sync"` (scheduled) and `configuredBy` (id, e-mail,
  name) in their summary. The sync log shows both.
- The schedule does not depend on that admin: it keeps running when they leave or are deactivated.
- Portal KPIs (D-113, agreed): only KPIs on steps of the published diagram, each value with its period and
  last-updated date.

## D-120 — Diagram entity: one framework for the non-BPMN notations (Diagram types, 2026-10-31)

- New table **`Diagram`**: `type` (`VALUE_CHAIN` | `ORG_CHART` | `DMN` | `EPC` | `SIPOC`), generated `code`
  (`VC-001`, `ORG-001`, `DMN-001`, `EPC-001`, `SIPOC-001`), bilingual name / description, owner, department, optional
  parent **process / process-house node** (`processId`), `status` (the process lifecycle), `workflowId`,
  `nextReviewAt`, `aiGenerated`, the usual audit columns and soft delete. The working **content** is a column on the
  diagram (`content` text): **DMN 1.3 XML** for decision tables, **versioned JSON** for the other notations
  (`{ "schema": 1, … }`). The JSON schemas live in `packages/shared/src/diagrams.ts` (zod) and the server validates
  every save with them (size limit, ids, references are UUIDs, no markup in labels); DMN XML goes through the same
  unsafe-XML checks as BPMN plus a DMN-specific sanitiser.
- **`DiagramVersion`** (number, content, change note, label, restored from) mirrors `ProcessVersion` /
  `PageVersion` — one version table per content kind is the existing pattern; the versions API, compare and restore
  behave exactly like the process ones.
- **`DiagramLink`** (diagram, element id, library object, relation) mirrors `ObjectLink` for diagram elements. A
  separate table keeps the existing `ObjectLink.processId` non-null (dozens of queries, GRC coverage, KPIs and
  reports rely on it); "where used" of a library object unions both tables. Published diagram links reuse
  `PublishedLink` (it is keyed by publication, not by process).
- **Governance is reused, not copied**: `ContentType` gains `DIAGRAM`, so reviews, workflows, publications, comments
  on elements (`Comment.bpmnElementId` holds the diagram element id), feedback, notifications, the governance
  dashboard, "My tasks" and the portal search work for diagrams through the existing services (`/governance/diagrams/:id`,
  `/comments/diagrams/:id`). Diagrams use the process workflow defaults (item → category default → global).
- **Permissions are the process ones**: read `processes.read`; create `processes.create`; metadata
  `processes.edit` / `processes.edit_own` (owner); content and links `models.edit` / `models.edit_own` (owner);
  delete `processes.delete`. The portal shows published diagrams to `portal.read` like processes.
- References from content (value-chain element → process / diagram, org-chart person → user, position → role,
  DMN ↔ BPMN business rule task `ph:decisionRef`) are ids inside the content; "where used" looks them up by
  content search (fine for the target size, D-001), so no extra reference tables.
- **Editors**: value chain, organisation chart and EPC are diagram-js editors built from one shared kit
  (`apps/web/src/features/diagrams/kit/`: generic shape / connection model, bilingual label editing as a command,
  palette, context pad, rules, renderer with theme colours, snapping, align / distribute, zoom / mini-map, undo,
  keyboard, export SVG / PNG / PDF via the print page). DMN uses dmn-js (bpmn.io, same licence as bpmn-js). SIPOC is
  a table-style diagram (an editable grid rendered as SVG for export), not a diagram-js canvas.
- The process repository tree shows diagrams under their parent process (or under "Diagrams" when they have none)
  with a type icon; the "New" menu offers each type. Git sync of diagrams is not part of this phase (BACKLOG).

## D-121 — Value chain: drill-down, process facts, colour by, generation (Diagram types, 2026-10-31)

- Notation: **chevrons** (primary activities), **blocks** (management / support, with a row `category`), **group
  frames** (other shapes can be dropped inside; frames are never nested) and **arrows**. Colours follow
  `branding.diagramTheme` (chevrons = human task colours, management blocks = approval colours, support blocks = system
  colours, frames = lane colours) unless an element has its own colour.
- Each element can link to **one process (process-house node) or one other value chain** (`processId` / `diagramId`
  in the content). Workspace: a ↗ button on linked elements opens the target. Portal: linked elements whose target is
  **published** are highlighted and clicking drills down (value chain → value chain → BPMN process page); links to
  unpublished items are not shown as drill targets (the portal never reveals unpublished content).
- **Process facts** (`GET /diagrams/process-facts?ids=…`, `processes.read`): status, owner department, worst KPI status
  (only with `kpi.read`) and the highest residual risk on the process's steps (only with `grc.read`). Badges on linked
  elements show them; **Colour by** (process status, KPI status, residual risk band colours from Settings → Risk &
  Compliance, owner department) recolours linked elements in the view only (never stored) with a legend. Badges and
  Colour by are workspace features; the portal shows the diagram with its own colours (KPI / risk visibility in the
  portal stays governed by the existing portal settings).
- **Generate from the process house** (shared `generateValueChain`, in "New → Value chain" and as a workspace tool
  that replaces the content after confirmation): one frame per category (Management above, Core in the middle,
  Support below), level-1 processes as chevrons (Core) or blocks, optionally their level-2 sub-processes stacked
  below; element ids derive from the process ids, every element is linked to its process. The created diagram gets
  version 1 "Generated from the process house".
- diagram-js cancels a create / move on any `elements.changed` that it did not cause, so view refreshes (language,
  theme, Colour by) redraw graphics directly instead of firing that event.

## D-122 — Organisation chart: generation from data, merge by id, what a position performs (Diagram types, 2026-10-31)

- Notation: **organisational units** (linked to a `Department`), **positions** (linked to a Role library object),
  **persons** (optionally linked to a user), **reporting lines** (orthogonal) and **staff lines** (dashed, from the
  context pad "Staff line"). Theme colours: units = system colours, positions = human-task colours, persons = start
  colours.
- **Source data** (`GET /diagrams/org-source`, `processes.read`): departments (hierarchy), positions = Role objects
  placed in a department by the new Role attribute **`departmentId`** (a "Department" field on the Role form in the
  library), or — when it is not set — in the departments of the users holding the job role; people = active users
  holding the role (only for users with `users.read`, which every workspace role has).
- **Generation** (shared `generateOrgChart`): top-down tree of units, each with its positions (and optionally the
  people holding them) in a column below it, "comb" reporting lines along the column so no line crosses a shape.
  Generated elements have **deterministic ids** (`GU_<department>`, `GP_<hash>_<role>`, `GM_<hash>_<user>`,
  `GR_<hash>` for lines); manual elements never use these prefixes.
- **Regeneration merges by id** (shared `mergeOrgChart`) after a **preview** (counts of added / renamed / removed /
  manual elements kept, list of removals and renames, and the merged chart): generated elements keep their position,
  size, colours and description and take the current names and references; new sources are added; generated elements
  whose source is gone are removed (with their lines); manual elements and lines stay. Applying replaces the content
  as one change (autosaved; undo by restoring a version).
- **What a position does** (`GET /diagrams/role-activities/:roleId`): the steps of the process models the Role performs
  — steps in a lane linked to the role (`ph:roleId`, D-081) and steps with a PERFORMS link — with the RACI letter of
  the B2 report (A for approval steps, R otherwise), shown in the position's side panel with links to the steps.
- The organisation chart is an optional handbook section (step 7).

## D-123 — DMN decision tables: dmn-js, bilingual names, FEEL testing, business rule task link (Diagram types, 2026-10-31)

- Editor: **dmn-js 17.12.3** (bpmn.io, same licence as bpmn-js) — decision requirements diagram (DRD), decision table
  editor (hit policies, aggregation, input expressions with type, output names / types, rule annotations) and
  literal expressions — inside the shared diagram workspace (autosave, versions, compare, export, comments). dmn-js
  stays in its own lazily loaded chunk.
- **Bilingual names**: DMN `name` / `label` / rule `description` hold **English** (so other DMN tools read the file);
  `ph:nameEn` / `ph:nameAr` (decisions, input data, knowledge sources, inputs, outputs) and `ph:annotationEn` /
  `ph:annotationAr` (rules) hold both languages (the `ph` namespace of the BPMN extension). The editor shows the
  active language (the XML is switched before import and switched back on every change); the other language is
  edited in the **Translations** panel. Output variable names and FEEL expressions are never translated.
- **Test decision**: evaluation in the browser with **feelin 8.2.0** (MIT, the FEEL interpreter from bpmn.io): every
  input entry is a FEEL unary test against the typed input value (number / boolean / string), output entries are
  FEEL expressions; all hit policies (UNIQUE with violation, FIRST, PRIORITY treated as FIRST, ANY with conflict
  check, COLLECT with SUM / MIN / MAX / COUNT, RULE ORDER, OUTPUT ORDER). Matching rules are highlighted in the table.
  Inputs are entered as values (input expressions are not evaluated against a context); PRIORITY does not use output
  value lists (documented limits).
- **Validation panel** (warnings, never blocking): missing English / Arabic names, tables without rules, invalid FEEL
  in input / output entries (feelin parser), empty outputs, duplicate input rows.
- **Import / export**: DMN XML import in the workspace (size and DMN checks in the browser, dmn-js parse) and export
  as `.dmn`. The server validates every save (`assertSafeDmnXml`: no DTD / entities, no processing instructions after
  the prolog, only local `#id` references, no script / iframe / object / embed elements, a DMN 1.x definitions root).
- **Business rule task link**: `ph:decisionRef` (DMN diagram id) and `ph:decisionId` (decision) on BPMN tasks, chosen
  in the modeler side panel ("Decision table (DMN)", with "View table"); the portal step details show the table
  read-only when it is published; "where used" of a DMN diagram lists the business rule tasks (`relation: DECISION`,
  found by content search and parsing). Sample: `docs/samples/approval-authority.dmn`.

## D-124 — EPC: ARIS notation, syntax rules as warnings, conversion to BPMN (Diagram types, 2026-10-31)

- Notation: **events** (hexagons), **functions** (rounded), **AND / OR / XOR connectors**, **process paths**,
  **organisational units**, **information systems**, **information objects** and **documents**; **control flow**
  (arrows) between events / functions / connectors / process paths, dotted **assignments** between a function and its
  resources (the rules allow nothing else). Classic ARIS colours that follow the theme: functions = start colours
  (green), connectors = gateway colours, org units = approval colours (yellow), systems = system colours,
  information objects = intermediate-event colours; events keep the ARIS magenta (the theme has no such kind).
- **Validation panel** (warnings, never blocking; elements are outlined on the canvas, clicking selects them): start /
  end events present, chains start and end with events, events and functions alternate (connectors are transparent),
  no XOR / OR split right after a single event ("events cannot decide"), a connector either splits (1 in, n out) or
  joins (n in, 1 out), branches / joins only through connectors, resources assigned to a function, no unconnected
  elements (shared `epcIssues`).
- **Convert to BPMN** (`POST /diagrams/:id/convert-to-bpmn`, `processes.create` + model rights): shared `epcToBpmn`
  maps functions → tasks (user task with an org unit, service task with only a system), process paths → call
  activities (linked process kept), events without incoming / outgoing flow → start / end events, events between
  steps are states and are dropped — after an XOR / OR split their name labels the branch —, connectors → exclusive /
  parallel / inclusive gateways, org units → lanes (linked roles become `ph:roleId`, hence PERFORMS links), systems /
  documents with a library object → SUPPORTS / INPUT links of the task. The API builds the BPMN XML with the AI
  builder's `structureToBpmn` (shared layered layout, theme colours) and creates a **new draft process** owned by the
  EPC's owner; the EPC is unchanged; the **mapping report** (every EPC element and what it became) is shown and the
  conversion is audited (`EXPORT` on the diagram). This is the path for ARIS users moving to BPMN.

## D-125 — SIPOC: table diagram generated from a process (Diagram types, 2026-10-31)

- A SIPOC is a **table-style diagram**, not a diagram-js canvas: five columns (Suppliers, Inputs, Process, Outputs,
  Customers) of bilingual items, edited in the shared workspace (add, reorder, delete, both languages per item — the
  active language first —, undo / redo, autosave, versions, compare with added / changed / removed items, comments
  and object links per item). Export SVG / PNG renders the columns as an image (Arabic: right to left); PDF via the
  print page. The process column should hold 5–7 high-level steps (a warning, not a rule).
- **Generate from process** (shared `generateSipoc`, in "New → SIPOC" and as a workspace tool for the linked
  process): process steps from the **main path** (longest start → end path, at most 7 steps, evenly sampled),
  inputs / outputs from the B2 step attributes of all steps (`ph:inputsEn/Ar`, `ph:outputsEn/Ar`, split on new
  lines, `;`, `؛`, `,` and `،`), suppliers from the lane of the start event and the pools sending messages into the
  process, customers from the lane of the end event and the pools receiving messages. The source process is stored
  in the content (`processId`); everything stays editable.
- SIPOC is an optional section of the process handbook (step 7).

## D-126 — Diagram types in reports, portal and demo data (Diagram types, 2026-10-31)

- **Process handbook** (Word, B2): four optional sections per process — _Place in the value chain_ (the path
  "value chain › frame › element (› process-house levels)" for every value chain linking the process or one of its
  ancestors), _SIPOC_ (the SIPOCs generated from / attached to the process, as a five-column table), _Decision
  tables_ (the DMN tables of its business rule tasks: inputs, outputs, rules and annotations) and _Organisation_
  (positions of the organisation charts that perform its steps — lane roles and PERFORMS links — with their unit
  and superior). The working source uses the current diagram content, the published source only published diagram
  versions. Built server-side (`DiagramReportService` in the reports module; DMN read with regular expressions,
  `readDmnTables`, since dmn-js is browser-only).
- **Knowledge Portal**: _Diagrams_ menu (browse published diagrams by type), diagram page with drill-down to
  published processes / value chains, print / PDF, feedback; Setting **portal.startDiagramId** (Portal settings →
  _Start page_): a published value chain shown first on the portal home with drill-down. Diagrams can be featured.
- **Demo seed** (demo installations only, once): VC-001 (from the process house, published, start page), ORG-001
  (from departments, roles with departments and job-role holders, published), DMN-001 approval authority
  (published) used by the business rule task of the new demo process S.01.02, EPC-001 with its conversion S.01.03,
  SIPOC-001 of S.01.01.

## D-127 — Product owner answers on diagram types (Diagram types, 2026-10-31)

- **Permissions**: diagrams use the **process permissions** (D-120) — confirmed. Diagrams are process
  documentation, so one permission model; no separate diagram roles.
- **EPC and DMN checks stay warnings** (D-123, D-124) — confirmed; they never block saving, submitting or
  publishing. Follow-up in BACKLOG: Admins can make selected EPC / DMN checks mandatory before "Submit for review"
  through the existing Modeling conventions gate (D-088).
- **Value chain portal start page off by default in production**: Setting `portal.startDiagramId` defaults to
  `null` and only the demo seed (`SEED_DEMO_DATA=true`) sets it to VC-001; the production stack ships
  `SEED_DEMO_DATA=false`. It is switched on at go-live once the real enterprise value chain is approved and
  published (DEPLOYMENT.md §6 step 10, SECURITY.md §7 checklist). Asserted in `seed.e2e-spec.ts` (a seed without
  demo data creates no diagrams and no start page).

## D-128 — Process mining and simulation in TypeScript, heavy work as jobs (Phase 5.1, 2026-10-31)

- **No Python service.** The algorithms Phase 5.1 needs are standard, well documented and small enough to implement
  and test in TypeScript: directly-follows graph with frequency / performance, variants, statistics, the
  **heuristics miner** (Weijters & van der Aalst: dependency measure with dependency / positive-observation /
  relative-to-best thresholds, length-one / length-two loops, AND / XOR splits from the AND measure), **token-based
  replay** fitness (Rozinat & van der Aalst: `½(1 − m/c) + ½(1 − r/p)`) on a Petri net translated from the BPMN
  model, and a **discrete-event simulation** engine. They live in `packages/shared/src/mining/` (pure functions, no
  I/O) with unit tests against small logs whose results are published or computed by hand. pm4py (GPL-3.0) would
  force a separate service, a second runtime in the Docker stack and a licence review for the self-hosted product;
  none of the required features needs it. Alignment-based conformance, inductive miner and object-centric mining
  are not in scope (BACKLOG) — if they are wanted later, a sidecar can be reconsidered then.
- **Jobs off the request thread.** A `MiningJob` row (kind, status `QUEUED` / `RUNNING` / `DONE` / `FAILED` /
  `CANCELLED`, progress 0–1, message, result, error, `cancelRequested`, requested by) is created for every import,
  validation, analysis of a large log, BPMN discovery, KPI calculation and simulation run. The in-process
  `MiningJobRunner` executes them one or two at a time (Setting), never inside the HTTP request: I/O-bound steps
  (streaming CSV / XLSX / XES parsing, batched `createMany` inserts of 5,000 events) are async and yield between
  chunks; CPU-bound steps (analysis, discovery, conformance, simulation) run in a **worker thread** that loads the
  compiled shared package (`new Worker(…, { eval: true })`, so it works the same under ts-node, Jest and the built
  image). Progress is written at most twice a second; a cancel request is checked between chunks / iterations; jobs
  still `RUNNING` at start-up are marked `FAILED` ("interrupted by a restart"). Small requests wait up to a few
  seconds for their job and get the result directly; otherwise the client polls `GET /mining/jobs/:id`.
- **Storage.** Events are rows of `MiningEvent` (log, case id, activity, start / end time, resource, department,
  extra attributes as JSON) with an index on `(logId, caseId, endAt)` — the source of truth and the base for case
  drill-down. For analysis each import also writes a **columnar snapshot** of the log (dictionary-encoded strings,
  typed arrays, sorted by case and time, gzip) to the existing S3-compatible file storage, keyed by the log's
  `dataVersion`; a worker decodes 1 M events in well under a second. Analysis results are cached in
  `MiningResultCache` keyed by log, data version and a hash of the request (filters, options) and dropped when the
  data version changes or the log is deleted.
