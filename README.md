# ProcessHub

**A bilingual (Arabic / English) business process management platform** — combining the core of ARIS and GBTEC (BIC) with a Confluence-style documentation wiki, Git-style version control and an optional GitHub / GitLab integration.

**منصة ثنائية اللغة (العربية / الإنجليزية) لإدارة العمليات المؤسسية** — تجمع بين جوهر ARIS و GBTEC (BIC) مع ويكي للتوثيق على غرار Confluence، والتحكم في الإصدارات، وتكامل اختياري مع GitHub / GitLab.

> **Status:** ✅ Phase 1 (Foundation), ✅ Phase 2 (Documentation wiki, version control, Git integration), ✅ Phase 3 (Governance, Knowledge Portal) and ✅ the AI Assistant (M16, awaiting review) — see [`docs/PROGRESS.md`](./docs/PROGRESS.md). Next: Phase 4 (GRC, EA, KPIs).

---

## What it does

| Area | Features | Phase |
|---|---|---|
| **Platform** | Users, roles & permissions, hierarchical departments, audit log, organisation settings & logo, Arabic/English with RTL | ✅ 1 |
| **Process House & Repository** | Management / Core / Support process house, drag-and-drop process tree, owners, departments | ✅ 1 |
| **Process Modeler** | BPMN 2.0 editor with bilingual labels, validation, versions, drill-down, import/export (BPMN XML, SVG, PNG) | ✅ 1 |
| **Object Repository** | Reusable roles and IT systems linked to process steps, "where used" report (documents, risks, controls, KPIs later) | ✅ 1 |
| **Documentation Wiki** | Spaces with access rules, page tree, rich-text editor (tables, checklists, callouts, images, attachments, embedded BPMN diagrams, RTL/LTR), English + Arabic versions, templates, trash, full-text search, PDF / Markdown export | ✅ 2 |
| **Version Control** | Versions with change notes for processes and pages, visual BPMN diff, side-by-side / inline text diff, restore, labels | ✅ 2 |
| **Git Integration** *(optional)* | One-way sync of BPMN models (.bpmn + .json) and pages (Markdown) to GitHub or GitLab, on every version or on demand, with a status page | ✅ 2 |
| **Governance** | Draft → In Review → Approved → Published → Archived with approval workflows (sequential steps, any-one or all approvers), review page with visual diff, threaded comments with @mentions on BPMN elements, notification centre and email, review dates with reminders, My tasks, governance dashboard | ✅ 3 |
| **Knowledge Portal** | Read-only portal for all staff with published content only: process house, step details, documentation with table of contents, English/Arabic search, "my processes", feedback to owners, PDF download, branding and access settings | ✅ 3 |
| **AI Assistant** *(optional, off by default)* | Generate a BPMN process (lanes, bilingual labels, auto-layout) from a description; refine it by chat with a visual review; SOP / work instruction from a process and a process from a page; EN↔AR translation of fields, labels and pages; analysis (missing steps, responsibilities, bottlenecks, risks, controls) and plain-language validation warnings; summaries and "what changed"; a Knowledge Portal assistant that answers only from published content with links. Anthropic Claude, encrypted key, roles, limits, usage report, full audit | ✅ AI |
| **GRC, EA & KPIs** | Risks and controls, IT landscape, KPI dashboards, Salesforce link | 4 |
| **Process Mining & Execution** | Event-log analysis, bottlenecks, running approved processes as workflows | 5 |

## Quick start (Docker)

Requirements: Docker with Compose v2.24 or newer.

```bash
git clone <this repository> processhub && cd processhub
docker compose up --build
```

Open **http://localhost:8080** and sign in with the default Super Admin:

| Email | Password |
|---|---|
| `admin@processhub.local` | `ChangeMe-Admin1` |

**Change this password straight away** (top-right menu → My profile). The first start applies database
migrations and loads demo data: departments, 11 processes in Arabic and English, roles, IT systems, BPMN
models, six page templates, two documentation spaces with eight bilingual pages, two approval workflows,
content in every lifecycle state, comments, notifications and portal feedback.

**Demo users** (one per role; the password is `SEED_DEMO_PASSWORD`, default `Demo-Password1`):

| Email | Role | Lands on |
|---|---|---|
| `viewer@processhub.local` | Viewer (Noura) | Knowledge Portal only |
| `reviewer@processhub.local` | Reviewer (Rami) | Workspace — has reviews waiting in **My tasks** |
| `owner@processhub.local` | Process Owner (Omar) | Workspace — owns the demo processes, overdue items, feedback |
| `modeler@processhub.local` | Modeler / Editor (Maha) | Workspace — drafts and comments |
| `auditor@processhub.local` | Auditor (Adel) | Workspace, read-only — drafts, history, reviews, audit log, AI usage |

Demo users are only created on a demo installation (`SEED_DEMO_DATA=true`, the default). **Emails** sent by
the demo installation go to the bundled **Mailpit** at **http://localhost:8025** — nothing leaves the machine.

### A short tour of Phase 3 — governance and the Knowledge Portal

1. Sign in as **viewer@processhub.local**: you land on the **Knowledge Portal** (process house, featured and
   recent items, quick links, search). Open **Processes → S.01.01 Purchase Requisition**, click a step for who
   performs it, the systems and documents, and use **Download PDF**. Try **My processes**, the search (also in
   Arabic, e.g. `طلب شراء`) and **Feedback** on any item. Workspace URLs send you back to the portal.
2. Sign in as **reviewer@processhub.local** → **My tasks**: open the review of *Purchase Requisition v2*. The
   review page shows the changes against the published version (coloured diagram and change list). Approve,
   request changes (comment required) or reject.
3. Sign in as **owner@processhub.local**: the owner step of that review is now yours. Approve, then **Publish**
   with a label such as `v2.0` — the portal shows the new version with approver, approval date and next review
   date. The **Governance dashboard** shows the overdue review (Order to Cash) and the overdue periodic review
   (Strategic Planning); feedback from the portal waits in My tasks.
4. As **modeler@processhub.local**, open a process model → **Comments** tab: comment on a BPMN element and
   type `@` to mention someone. Mentioned users get a notification (bell) and, if enabled, an email.
5. As **admin**: **Settings → Workflows** (templates, defaults per process category and space, review interval),
   **Settings → Knowledge Portal** (name, tagline, featured items, quick links, who may use the portal),
   **Settings → Email** (SMTP, test email). Each user picks which notifications they also get by email under
   **My profile**.

### A short tour of Phase 2

1. **Documentation → Spaces → Quality Management → Purchase Requisition Procedure.** The page embeds the
   process diagram, lists related processes, roles and systems, and is available in both languages (use
   the EN / عربي switch above the page, or the header language toggle).
2. **History** on that page: three versions, one labelled *v1.0 – approved by committee*. Compare any two
   (side by side or inline), preview, restore (creates a new version) or edit labels.
3. **Edit**: English and Arabic tabs, page and paragraph direction, tables, checklists, info panels,
   images, attachments and diagrams. Changes are autosaved as your private draft; **Save** asks for a change
   note and creates a version.
4. **Processes → S.01.01 Purchase Requisition → Model → Versions**: compare v1 and v2 visually (added,
   removed and changed elements are coloured) and see the list of changes. The **Documentation** tab lists
   the pages about this process.
5. **Search** (header box or the Search page): English or Arabic words, partial words, filters for space
   and author.
6. **Settings → Integrations**: connect a GitHub or GitLab repository; **Sync status** shows what was synced.

### Configuration

The defaults are meant for a local trial. For anything else, create a `.env` first:

```bash
cp .env.example .env    # then edit every value marked CHANGE ME
docker compose up --build -d
```

Every variable is documented in [`.env.example`](./.env.example). The ones that matter most:

- `POSTGRES_PASSWORD`, `MINIO_SECRET_KEY`: database and object-storage passwords.
- `SEED_ADMIN_EMAIL`, `SEED_ADMIN_PASSWORD`: the first Super Admin. These are read only when that user does not exist yet.
- `JWT_ACCESS_SECRET`: leave it empty and the API generates a random secret on first start, kept in the `api-data` volume.
- `INTEGRATIONS_ENCRYPTION_KEY`: encrypts GitHub/GitLab tokens and the SMTP password (AES-256-GCM). Leave it empty with Docker and a key is generated and kept in the `api-data` volume.

> ⚠️ **Back up `INTEGRATIONS_ENCRYPTION_KEY` (or the `api-data` volume) together with the database.** If the key is lost or changes, stored Git tokens and the SMTP password cannot be decrypted and must be entered again.

- `APP_URL`: the address users open; used for links in emails.
- `SEED_DEMO_PASSWORD`: password of the four demo users. `SEED_SMTP_HOST`: SMTP host the demo installation is configured with (Mailpit by default; set it empty to leave email unconfigured).
- `SCHEDULER_INTERVAL_MINUTES`: how often review reminders are checked (default 60; `0` turns them off).
- `WEB_PORT`, `CORS_ORIGINS`: the port and URL users open.
- `OUTBOUND_ALLOWED_HOSTS`: internal hosts (names, IPs or CIDR ranges) the Git and SMTP integrations may reach. All other internal addresses are blocked to prevent SSRF. Docker Compose defaults to `mailpit`; add your own GitLab or SMTP server if it runs in a private network.
- `COOKIE_SECURE`: keep `true`. It needs HTTPS (or `localhost`). Put a TLS reverse proxy in front for real use.
- `SEED_DEMO_DATA=false`: start with an empty repository.

### Git integration (optional)

Settings → Integrations (Super Admin only):

1. Create a token. **GitHub**: a fine-grained personal access token with *Contents: read and write* on the
   repository. **GitLab**: a project or personal access token with the `api` scope (Developer role or higher).
   For self-hosted GitLab enter its URL; for GitHub Enterprise `https://<host>/api/v3`.
2. Enter repository (`owner/repo` or `group/project`), an existing branch, an optional folder and the token,
   then **Test connection** and **Save**. The token is stored encrypted and never shown again.
3. Choose what to sync (processes, pages or both) and when (every new version, or only **Sync now**).

Every sync is one commit, authored as the ProcessHub user who made the change, e.g.
`Update C.02.03 Order Handling — v5: Added approval`. Layout in the repository:

```
<folder>/processes/core/C.02-order-to-cash/C.02.03-order-handling/C.02.03.bpmn   (+ C.02.03.json metadata)
<folder>/docs/QM/quality-manual-1a2b3c4d/document-control-5e6f7a8b/index.en.md   (+ index.ar.md, front-matter)
```

The sync is one-way (ProcessHub → Git). Pages of view-restricted spaces are never exported. With
**Published versions only**, only the current published version of each process and page is exported. Renames and
moves are applied with the next version or with **Sync now**, which reconciles everything in a single commit.

### AI assistant (optional)

Off by default; everything else works without it. Settings → AI (Super Admin):

1. Create an API key in the Anthropic Console (console.anthropic.com → API keys).
2. Tick **Enable the AI assistant**, keep the provider **Anthropic Claude** and the default models
   (`claude-sonnet-5-5`, fast model `claude-haiku-5-5`) or enter others, paste the key, **Test connection**,
   **Save**. The key is stored encrypted (`INTEGRATIONS_ENCRYPTION_KEY`) and never shown again.
3. Choose which roles may use it (tick **Viewer** for the portal assistant), the daily per-user and monthly
   organisation request limits, and the data notice users see.

Users with an allowed role then see **✨ AI** buttons: in the modeler (generate, refine with chat, analyse,
translate labels), the "New process" dialog, bilingual forms ("Translate into …"), the wiki editor, the process
and page views (summarise, documentation, process from a page), version compares and the review screen
("What changed?"), and the Knowledge Portal ("Ask"). Everything the assistant creates is shown for review first
and marked "AI-generated — review before publishing" until a person edits or approves it. Requests go from the
server to the provider (never from the browser), are limited and logged (**Administration → AI usage**, audit
log). A guided demo with sample prompts: [`docs/AI-DEMO.md`](./docs/AI-DEMO.md).

### Email

Settings → Email (Super Admin): SMTP server, port, TLS, user name, password (stored encrypted, never shown
again), sender. **Send test email** checks the settings. Emails are sent in each recipient's language; users
choose per notification type whether they also want an email (My profile). For a real installation replace
the demo Mailpit settings with your mail server and remove the `mailpit` service if you do not need it.

Data lives in the Docker volumes `postgres-data`, `minio-data` and `api-data`. `docker compose down` keeps them; `docker compose down -v` deletes them.

## Local development (without Docker for the apps)

Requirements: Node.js 20+, pnpm 10 (`corepack enable`), PostgreSQL 16, and optionally MinIO for logo uploads.

```bash
pnpm install
cp .env.example apps/api/.env      # set DATABASE_URL, JWT_ACCESS_SECRET, COOKIE_SECURE=false,
                                   # CORS_ORIGINS=http://localhost:5173, MINIO_* for your setup
pnpm --filter @processhub/shared build
pnpm db:migrate                    # prisma migrate deploy
pnpm db:seed                       # roles, Super Admin, demo data
pnpm dev:api                       # http://localhost:3000/api/v1  (Swagger at /api/docs if ENABLE_SWAGGER=true)
pnpm dev:web                       # http://localhost:5173  (proxies /api to the API)
```

A throwaway PostgreSQL for development: `docker run -d -p 5432:5432 -e POSTGRES_USER=processhub -e POSTGRES_PASSWORD=devpassword -e POSTGRES_DB=processhub postgres:16-alpine`.

### Quality checks

```bash
pnpm format:check   # Prettier
pnpm lint           # ESLint
pnpm typecheck      # TypeScript (strict)
pnpm test           # shared + web (Vitest), api unit + e2e (Jest, needs PostgreSQL)
pnpm build
pnpm e2e            # Playwright smoke tests against a running, seeded stack (E2E_BASE_URL, default http://localhost:8080)
```

The Playwright tests (`apps/e2e`) need a Chromium for Playwright 1.56 (`pnpm --filter @processhub/e2e exec
playwright install chromium` once) and only read data or add feedback, so they can be re-run.

The API end-to-end tests run against `TEST_DATABASE_URL`, which defaults to
`postgresql://processhub:devpassword@localhost:5432/processhub_test`. They **empty every table** in that
database, so never point it at real data. CI runs all of these on every push (`.github/workflows/ci.yml`).

## Project structure

```
apps/
  api/                    NestJS REST API (/api/v1)
    prisma/               schema, migrations, seed (+ BPMN builder for demo models)
    src/
      auth/               sign-in, tokens, lockout, password hashing
      common/             guards (JWT, CSRF, permissions), zod pipe, error filter
      users/ roles/ departments/ audit/ settings/ storage/
      processes/          process tree, move planning
      models/             BPMN models, versions (restore, labels), object links
      objects/            object library, where-used
      docs/               wiki: spaces, pages, versions, drafts, templates, attachments, links,
                          sanitising, Markdown export
      search/             PostgreSQL full-text search (English + Arabic)
      integrations/       Git sync: encrypted settings, GitHub/GitLab clients, export, sync queue
      events/             in-process domain events (e.g. "new version" → Git sync)
      governance/         lifecycle, workflows, reviews, publications, tasks, dashboard, feedback,
                          portal access rules, reminder scheduler
      comments/           threaded comments with @mentions and BPMN element anchors
      notifications/      notification centre, preferences, SMTP settings, bilingual email templates
      portal/             Knowledge Portal read model (published content only) and search
    test/                 end-to-end tests (supertest + PostgreSQL)
  web/                    React + Vite + Ant Design client
    src/
      api/                fetch client (CSRF, token refresh) and React Query hooks
      app/ auth/ layout/  providers, theme, locale/RTL, shell
      features/           admin, settings, profile, processes, modeler, objects,
                          docs (wiki, TipTap editor, history), versions (BPMN compare), search,
                          governance, comments, notifications, portal (Knowledge Portal + print views)
      locales/{en,ar}/    translations
packages/
  shared/                 zod schemas, types, permissions & roles, bilingual helpers, BPMN validation,
                          lifecycle transitions and portal visibility rules
  e2e/ (in apps/)         Playwright smoke tests
docs/                     PROGRESS.md, DECISIONS.md, BACKLOG.md
docker-compose.yml        postgres, minio, mailpit (demo email), api, web
```

## Security highlights

- argon2id password hashing, a configurable password policy, and account lockout after repeated failures.
- Short-lived JWT access tokens and rotating refresh tokens in `httpOnly; Secure; SameSite=Strict` cookies, with reuse detection. Double-submit CSRF protection bound to the request origin.
- Permissions are checked on the server for every request, and routes are denied by default. The UI only hides what a user cannot do.
- Rate limiting, request size limits, helmet, strict CORS, and a CSP on the web app.
- Uploaded logos are type-checked by content and SVGs are sanitised. BPMN imports reject DTDs and entities.
- Wiki content is sanitised with DOMPurify on the server (on save) and again in the browser (on render); images may only point at ProcessHub attachments.
- Attachments: extension allow-list plus a content check, 10 MB limit, stored in MinIO and delivered with a sandboxing CSP, `nosniff` and download disposition for non-images.
- Per-space view/edit restrictions apply everywhere, including search and "related documentation".
- GitHub/GitLab tokens are encrypted at rest (AES-256-GCM), write-only in the API and scrubbed from errors and the audit log.
- Viewers can only use the Knowledge Portal; its endpoints return current published versions only (never drafts, reviews or archived content). Tested for every route.
- Lifecycle transitions are checked on the server and audited; submitters never approve their own items (four-eyes: a submission is refused when the submitter would be a step's only approver). Auditors and Viewers can never approve.
- AI assistant: off by default; API key encrypted and write-only; every call goes through the server with role checks and limits, is logged without the prompt text, and structured output is validated (BPMN parsed and checked, rich text sanitised) before anything is shown. The portal assistant only reads current publications the user may see. Tests use a fake provider.
- The SMTP password is encrypted like the Git tokens; email content is HTML-escaped; tests never send email.
- An audit log records every change and every sign-in, with secrets scrubbed.
- The Git and SMTP integrations cannot reach internal addresses (loopback, private networks, cloud metadata) unless allowed with `OUTBOUND_ALLOWED_HOSTS`.

The security review, the table of every endpoint with its guards, remaining risks and a penetration-test
checklist are in [`docs/SECURITY.md`](./docs/SECURITY.md). More detail in [`docs/DECISIONS.md`](./docs/DECISIONS.md).

## For developers

The full blueprint is in [`CLAUDE.md`](./CLAUDE.md): modules, tech stack, security requirements, bilingual rules, data model and conventions. Progress notes live in [`docs/PROGRESS.md`](./docs/PROGRESS.md), technical decisions in [`docs/DECISIONS.md`](./docs/DECISIONS.md), and ideas for later in [`docs/BACKLOG.md`](./docs/BACKLOG.md).

## License

Private — all rights reserved.
