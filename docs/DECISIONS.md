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
the PERFORMS object link (no automatic links). The AI refine path keeps `ph:roleId`. Storing it in the XML
(instead of an object link on the lane) keeps it in versions, compare and Git export without API changes.

## D-080 — Badges as HTML overlays; print layout with page-wide parts

Info badges (roles, IT systems, documents, risks, controls, open comments) are diagram-js overlays built with
DOM APIs — names only go into `title` / `aria-label`, never into markup. The portal shows published links only
and adds "Highlight my steps" (published ROLE links to the reader's job roles). The print view (still browser
print, D-024) lets the reader pick A4 or A3 landscape; the diagram is scaled to the page width and, when it
would be shown below 55 %, cut into overlapping page-wide parts (one per page). Header with logo, version,
owner and approval date, a colour legend from the active theme, page numbers via `@page` margin boxes
("Page n of m" / "صفحة n من m").
