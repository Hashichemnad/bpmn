# ProcessHub — Project Blueprint

> This file is read automatically by Claude Code at the start of every session.
> It is the single source of truth for what we are building and how.
> (ProcessHub is a working name — rename freely.)

## 1. Vision

A bilingual (Arabic + English) business process management platform combining the core of
**ARIS** and **GBTEC (BIC)** with a **Confluence-style documentation wiki**, **Git-style version
control**, and an optional **GitHub/GitLab integration**. Owned and self-hosted by the company,
with no per-user licensing. Target: 50–500 users on a single server.

## 2. Modules (full scope)

| # | Module | Summary |
|---|---|---|
| M1 | Platform | Users, roles, departments, permissions, settings, audit log, AR/EN, branding |
| M2 | Process House & Repository | Management / Core / Support hierarchy, process tree, process metadata |
| M3 | Process Modeler | BPMN 2.0 editor (bpmn-js), validation, templates, export XML/SVG/PNG/PDF |
| M4 | Object Repository | Reusable objects (roles, IT systems, documents, risks, controls, KPIs) linked to BPMN elements |
| M5 | Documentation Wiki | Confluence-style spaces & pages (TipTap), templates (SOP, policy, guide), links to processes |
| M6 | Version Control | Versions for processes and pages, visual compare (diff), restore, change notes |
| M7 | Git Integration (optional) | GitHub / GitLab sync of BPMN XML + Markdown, enabled and configured in Settings |
| M8 | Governance | Draft → In Review → Approved → Published → Archived; reviewers, comments, notifications |
| M9 | Knowledge Portal | Read-only published site for all staff: browse, search, "my processes", feedback, PDF |
| M10 | GRC | Risks, controls, compliance requirements linked to process steps |
| M11 | Enterprise Architecture | Applications / IT systems and which processes they support |
| M12 | KPIs & Dashboards | KPIs per process, dashboards, Salesforce PMS link |
| M13 | Process Mining | Import event logs (CSV), discover flows, variants, bottlenecks |
| M14 | Workflow Execution | Run approved processes as task flows (forms, assignments, approvals) |
| M15 | Migration Tools | Import existing documentation, incl. from Salesforce |
| M16 | AI Assistant | Generate a BPMN process from a text description; generate SOP/documentation from a process (and the reverse); translate EN↔AR; suggest missing steps, risks and controls and explain validation warnings; summarise processes and version changes; Q&A assistant in the Knowledge Portal answering from published content with links. Provider-agnostic (Anthropic Claude first), enabled and configured in Settings → AI with an encrypted API key, per-role access, per-user usage limits and full audit logging |

## 3. Build Phases

| Phase | Scope | Status |
|---|---|---|
| 1 | Foundation: M1 (core), M2, M3, M4 (roles & systems) | ✅ Done (merged into `main`) |
| 2 | M5 Wiki, M6 Version control, M7 Git integration | ✅ Done (merged into `main`) |
| 3 | M8 Governance, M9 Knowledge Portal | ✅ Done (merged into `main`) |
| AI | M16 AI Assistant (after Phase 3) | ✅ Done (merged into `main`) |
| 4 | M10 GRC, M11 EA, M12 KPIs + Salesforce | ⬜ |
| 5 | M13 Mining, M14 Execution, simulation | ⬜ |
| 6 | Hardening: SSO, performance, security review fixes, deployment guide | 🟡 In progress — part 1 (security review, `docs/SECURITY.md`) and part 2 (production stack, backups, `docs/DEPLOYMENT.md`) merged; part 3 (SSO with Entra ID / OIDC, TOTP two-factor) merged; part 4 (product owner decisions: 2FA for admins, break-glass, roles in ProcessHub, 24 h sessions, Node 22) done on branch `phase-6-part-4` |
| Design A | Modeler design upgrade — Part A: look and feel (colour theme as BPMN-in-Color, renderer, colour picker, fonts/RTL, apply theme) | ✅ Done (merged into `main`, D-067 – D-073) |
| Design B1 | Modeler design — Part B1: full-screen workspace and modeling productivity (palette, ready-made steps, zoom/mini-map, align, auto-layout, lane roles, badges, portal diagram, print layout) | ✅ Done (merged into `main`, D-074 – D-081); Part B2 in BACKLOG |
| Deps | zod 3 → 4 (high advisory GHSA-mrhx-c7xc-m3w5, D-082) | 🟡 Done on branch `deps-zod-4`, awaiting review |
| — | M15 Migration of existing documentation (after system is ready) | ⬜ |

Update this table and `docs/PROGRESS.md` at the end of every session.

## 4. Technology Stack (fixed — do not change without a written reason in docs/DECISIONS.md)

- **Language:** TypeScript everywhere (strict mode).
- **Monorepo:** pnpm workspaces — `apps/web`, `apps/api`, `packages/shared` (types, validation schemas, constants).
- **Frontend:** React 18 + Vite, React Router, TanStack Query, **Ant Design 5** (ConfigProvider `direction="rtl"` for Arabic), i18next.
- **Fonts:** IBM Plex Sans Arabic (AR) and Inter (EN), self-hosted.
- **Modeler:** bpmn-js (+ bpmn-js-properties-panel where useful).
- **Rich text (Phase 2):** TipTap.
- **Backend:** Node.js 22 LTS + **NestJS**, **Prisma** ORM (moved from Node 20, which is end-of-life — DECISIONS D-066).
- **Database:** PostgreSQL 16.
- **File storage:** S3-compatible — Versity S3 Gateway in Docker (replaced MinIO, DECISIONS D-051); the API uses the `minio` npm S3 client.
- **Validation:** zod schemas in `packages/shared`, used by both web and api.
- **Testing:** Vitest (web, shared), Jest (api), Playwright (end-to-end, from Phase 3).
- **Runtime:** Docker + Docker Compose (`docker compose up` starts everything; production: `docker-compose.prod.yml` with Caddy, see `docs/DEPLOYMENT.md`).

## 5. Bilingual Rules (Arabic + English)

- All UI text through i18next; translation files `apps/web/src/locales/{en,ar}/*.json`. **No hard-coded UI strings.**
- Each user has a preferred language; a header toggle switches instantly. Arabic = RTL layout.
- Use CSS logical properties (`margin-inline-start`, not `margin-left`).
- Business content is bilingual: entities store `nameEn`, `nameAr`, `descriptionEn`, `descriptionAr`. Show the user's language, fall back to the other if empty.
- BPMN element labels: store per-language labels; the modeler shows the active language.
- Dates, numbers: format via `Intl` with the active locale.

## 6. Roles & Permissions

System roles (extensible, permission-based underneath):

| Role | Can do |
|---|---|
| Super Admin | Everything, incl. system settings and integrations |
| Admin | Users, departments, roles, content structure |
| Process Owner | Own processes: edit, submit for review, approve where assigned |
| Modeler / Editor | Create and edit drafts |
| Reviewer | Review and comment, approve where assigned |
| Auditor | Read-only workspace: drafts, history, reviews, audit log — no edit, comment, approve or publish |
| Viewer | Knowledge Portal only (published content, read-only) |

Permissions are checked **on the server** for every request (NestJS guards). The UI hides what the user cannot do, but never relies on that for security.

## 7. Security Requirements (non-negotiable)

- Passwords hashed with **argon2id**; password policy configurable; account lockout after repeated failures.
- Auth via short-lived JWT access token + refresh token in **httpOnly, Secure, SameSite=strict cookies**. CSRF protection on state-changing requests.
- TOTP two-factor authentication and SSO (Entra ID / OIDC) — done in Phase 6 part 3 (DECISIONS D-055 – D-060). Go-live policy (D-061 – D-065): 2FA required for Super Admin and Admin, password sign-in off after SSO roll-out except one break-glass Super Admin (always 2FA), roles managed in ProcessHub, MFA for SSO users via Entra ID Conditional Access, 24-hour refresh-token lifetime.
- `helmet`, strict CORS, rate limiting (`@nestjs/throttler`), request size limits.
- All input validated with zod/class-validator; Prisma only (no raw SQL string concatenation).
- Uploaded files: type and size checks, stored in the S3-compatible file storage, never executed; sanitized SVG.
- Rich text and BPMN labels sanitized against XSS (DOMPurify on render).
- Secrets only via environment variables; integration tokens (GitHub/GitLab) encrypted at rest (AES-256-GCM, key from env).
- **Audit log** table: who, what, when, entity, before/after summary — for every create/update/delete/publish/login.
- No secrets, real data, or credentials committed. `.env.example` documents every variable.
- `pnpm audit` clean of high/critical issues before a phase is marked done.

## 8. Architecture Conventions

- API: REST under `/api/v1`, OpenAPI docs via `@nestjs/swagger` at `/api/docs` (disabled in production unless enabled).
- One NestJS module per domain (`users`, `auth`, `processes`, `models`, `objects`, `audit`, `settings`, …).
- Soft delete (`deletedAt`) for business entities; hard delete only for admins and logged.
- Every business entity has `createdAt`, `updatedAt`, `createdById`, `updatedById`.
- IDs: UUID.
- Pagination, sorting and filtering on all list endpoints.
- Frontend feature folders: `apps/web/src/features/<feature>/`.
- Keep modules independent; shared logic goes in `packages/shared`.

## 9. Core Data Model (Phase 1 — extend in later phases)

- `User` (email, nameEn, nameAr, passwordHash, locale, status, departmentId, roles)
- `Role`, `Permission`, `UserRole`
- `Department` (nameEn, nameAr, parentId)
- `ProcessCategory` (MANAGEMENT | CORE | SUPPORT)
- `Process` (code e.g. "C.02.03", nameEn, nameAr, descriptionEn, descriptionAr, category, parentId, ownerId, departmentId, status, level, sortOrder)
- `ProcessModel` (processId, bpmnXml, updatedAt) — current working model
- `ProcessVersion` (processId, versionNumber, bpmnXml, changeNote, createdById) — snapshot on each explicit save
- `RepoObject` (type: ROLE | SYSTEM | DOCUMENT | RISK | CONTROL | KPI, nameEn, nameAr, descriptionEn, descriptionAr, attributes JSON)
- `ObjectLink` (processId, bpmnElementId, repoObjectId, relation e.g. PERFORMS, SUPPORTS, INPUT, OUTPUT)
- `AuditLog`
- `Setting` (key, value JSON)

Phase 2 additions (see `apps/api/prisma/schema.prisma`, DECISIONS D-018 – D-025):

- `Space` (key, nameEn/Ar, descriptionEn/Ar, icon, ownerId, departmentId, viewRestricted, editRestricted), `SpaceGrant`
- `Page` (spaceId, parentId, sortOrder, titleEn/Ar, contentEn/Ar, dirEn/Ar, textEn/Ar, version, searchVector, deletedAt, deleteBatchId)
- `PageVersion` (pageId, versionNumber, content snapshot, changeNote, label, restoredFrom), `PageDraft` (per user)
- `PageTemplate`, `PageLink` (page ↔ process / repository object), `Attachment`
- `ProcessVersion` + `label`, `restoredFrom`; `GitSyncItem` (sync state per process / page)

Phase 3 additions (DECISIONS D-028 – D-037):

- `Process` / `Page` + `status` (DRAFT | IN_REVIEW | APPROVED | PUBLISHED | ARCHIVED), `workflowId`, `nextReviewAt`; `Page.ownerId`; `Space.workflowId`
- `Workflow` (bilingual name, steps JSON: assignees USER / ROLE (+ department) / OWNER, rule ANY | ALL, autoPublish)
- `Review` (item, versionNumber, workflow name + steps snapshot, currentStep, status, note, due date), `ReviewTask` (per assignee decision + comment)
- `Publication` (item, version, label, published title/description/text, approverIds, approvedAt, publisher, `current`, searchVector), `PublishedLink` (step ↔ object links as published)
- `Comment` (item, parentId, bpmnElementId, body with `@[Name](id)` mentions, resolvedAt)
- `Notification` (userId, type, params, link, readAt, dedupeKey); `User.notificationPrefs`
- `Feedback` (item, author, kind, message, status OPEN | IN_PROGRESS | DONE, reply); `UserJobRole` (user ↔ ROLE object)

AI phase additions (DECISIONS D-038 – D-046):

- System role `AUDITOR` (read-only workspace), permissions `reviews.decide`, `ai.usage.read`
- `AiUsage` (user, feature, provider, model, input/output tokens, status, error code, duration, item); Setting `ai`
- `Process.aiGenerated`, `Page.aiGenerated` (unedited AI output, cleared by a human save or an approval)

Phase 6 part 3 additions (DECISIONS D-055 – D-060):

- `User.ssoIssuer` + `ssoSubject` (unique pair), `passwordHash = ''` for SSO-only accounts
- `User.totpSecretSealed`, `totpPendingSealed`, `totpEnabledAt`, `totpLastStep`; `MfaRecoveryCode` (SHA-256)
- Setting `auth` (SSO, group mappings, password sign-in / break-glass, roles requiring 2FA)

Modeler design Part A additions (DECISIONS D-067 – D-072):

- BPMN XML: colours on `BPMNShape` as `color:background-color` / `color:border-color` + `bioc:fill` / `bioc:stroke`;
  `ph:stepKind` (`approval` | `task`) on user tasks
- Setting `branding.diagramTheme` (colour of each element kind; part of the public settings)

Modeler design Part B1 additions (DECISIONS D-074 – D-081):

- BPMN XML: `ph:roleId` on lanes (lane linked to a library Role), mirrored on save as a PERFORMS `ObjectLink`
  from the lane (D-081); no database changes
- Shared layered layout `packages/shared/src/bpmn-layout.ts` (AI builder and modeler auto-layout)

## 10. Definition of Done (every phase)

1. Features work end to end in both Arabic (RTL) and English.
2. Server-side permission checks in place; security rules in §7 followed.
3. Unit tests for business logic; API tests for each endpoint; all tests pass.
4. `docker compose up` starts a working system from a clean clone; seed script creates demo data and an admin user (credentials from `.env`).
5. Lint and type-check pass with no errors.
6. `README.md`, `docs/PROGRESS.md`, and the phase table above are updated.
7. Work is committed in small, clearly described commits on a feature branch.

## 11. Working Rules for Claude Code sessions

- Read this file and `docs/PROGRESS.md` first. Continue from where the last session stopped.
- Stay within the current phase scope. Note ideas for later in `docs/BACKLOG.md` instead of building them.
- Prefer proven libraries over custom code. Keep the code readable for a future human developer.
- Record significant technical decisions in `docs/DECISIONS.md` (one short entry each).
- Before finishing a session: run tests, lint, type-check; update `docs/PROGRESS.md` with what is done, what is next, and any known issues.
