# ProcessHub

**A bilingual (Arabic / English) business process management platform** — combining the core of ARIS and GBTEC (BIC) with a Confluence-style documentation wiki, Git-style version control and an optional GitHub / GitLab integration.

**منصة ثنائية اللغة (العربية / الإنجليزية) لإدارة العمليات المؤسسية** — تجمع بين جوهر ARIS و GBTEC (BIC) مع ويكي للتوثيق على غرار Confluence، والتحكم في الإصدارات، وتكامل اختياري مع GitHub / GitLab.

> **Status:** ✅ Phase 1 (Foundation) complete — see [`docs/PROGRESS.md`](./docs/PROGRESS.md). Phase 2 is next.

---

## What it does

| Area | Features | Phase |
|---|---|---|
| **Platform** | Users, roles & permissions, hierarchical departments, audit log, organisation settings & logo, Arabic/English with RTL | ✅ 1 |
| **Process House & Repository** | Management / Core / Support process house, drag-and-drop process tree, owners, departments | ✅ 1 |
| **Process Modeler** | BPMN 2.0 editor with bilingual labels, validation, versions, drill-down, import/export (BPMN XML, SVG, PNG) | ✅ 1 |
| **Object Repository** | Reusable roles and IT systems linked to process steps, "where used" report (documents, risks, controls, KPIs later) | ✅ 1 |
| **Documentation Wiki** | Confluence-style pages and spaces, SOP / policy templates, linked to processes | 2 |
| **Version Control** | Visual compare, restore, change notes | 2 |
| **Git Integration** *(optional)* | Sync models and documents with GitHub or GitLab — enabled from Settings | 2 |
| **Governance** | Draft → Review → Approved → Published workflow, comments, notifications | 3 |
| **Knowledge Portal** | Read-only portal for all staff: browse, search, "my processes", feedback, PDF | 3 |
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
migrations and loads demo data: departments, 11 processes in Arabic and English, roles, IT systems and two
BPMN models.

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
- `WEB_PORT`, `CORS_ORIGINS`: the port and URL users open.
- `COOKIE_SECURE`: keep `true`. It needs HTTPS (or `localhost`). Put a TLS reverse proxy in front for real use.
- `SEED_DEMO_DATA=false`: start with an empty repository.

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
```

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
      models/             BPMN models, versions, object links
      objects/            object library, where-used
    test/                 end-to-end tests (supertest + PostgreSQL)
  web/                    React + Vite + Ant Design client
    src/
      api/                fetch client (CSRF, token refresh) and React Query hooks
      app/ auth/ layout/  providers, theme, locale/RTL, shell
      features/           admin, settings, profile, processes, modeler, objects
      locales/{en,ar}/    translations
packages/
  shared/                 zod schemas, types, permissions & roles, bilingual helpers, BPMN validation
docs/                     PROGRESS.md, DECISIONS.md, BACKLOG.md
docker-compose.yml        postgres, minio, api, web
```

## Security highlights

- argon2id password hashing, a configurable password policy, and account lockout after repeated failures.
- Short-lived JWT access tokens and rotating refresh tokens in `httpOnly; Secure; SameSite=Strict` cookies, with reuse detection. Double-submit CSRF protection.
- Permissions are checked on the server for every request, and routes are denied by default. The UI only hides what a user cannot do.
- Rate limiting, request size limits, helmet, strict CORS, and a CSP on the web app.
- Uploaded logos are type-checked by content and SVGs are sanitised. BPMN imports reject DTDs and entities.
- An audit log records every change and every sign-in, with secrets scrubbed.

More detail in [`docs/DECISIONS.md`](./docs/DECISIONS.md).

## For developers

The full blueprint is in [`CLAUDE.md`](./CLAUDE.md): modules, tech stack, security requirements, bilingual rules, data model and conventions. Progress notes live in [`docs/PROGRESS.md`](./docs/PROGRESS.md), technical decisions in [`docs/DECISIONS.md`](./docs/DECISIONS.md), and ideas for later in [`docs/BACKLOG.md`](./docs/BACKLOG.md).

## License

Private — all rights reserved.
