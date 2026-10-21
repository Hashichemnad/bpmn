# Progress

Read this together with `CLAUDE.md` at the start of every session.

## Current state — 2026-10-21

**Phase 2 (Documentation wiki M5, Version control M6, Git integration M7): complete on branch
`phase-2-docs-versions-git`, awaiting review.** Phase 1 is merged into `main`. Every item of the Phase 2 brief
is implemented, tested and verified in the browser (English and Arabic) and with `docker compose up` from a
clean state.

Decisions taken at the start of Phase 2: keep the current MinIO image (revisit in Phase 6); Viewers keep full
read access until Phase 3 restricts them to published content (D-027).

### Phase 2 — done

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

### Verification (this session)

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

1. Review and merge `phase-2-docs-versions-git`.
2. Decisions for you: see "Needs a decision" in `docs/BACKLOG.md` (PDF export approach, MinIO image).
3. Phase 3: M8 governance workflow (Draft → In Review → Approved → Published → Archived, reviewers, comments,
   notifications) and M9 Knowledge Portal (published content only for Viewers, D-006 / D-027). Version labels
   and the wiki are ready to be tied into approval.

## Known issues / limitations

- PDF export uses the browser's print dialog ("Save as PDF"), not a direct download (D-024).
- Git sync: one-way; process renames/moves without a new version reach Git with the next version or
  "Sync now"; jobs run in-process (single API instance); pages of view-restricted spaces are not exported.
- Autosaved page drafts are per user; two people editing the same page at once get a conflict on the second
  save (no live co-editing).
- MinIO uses the frozen `bitnamilegacy/minio` image (D-009, revisit in Phase 6).
- Secure cookies (`COOKIE_SECURE=true`, the default) need HTTPS or `localhost`.
- The API e2e tests **truncate every table** of the database in `TEST_DATABASE_URL`. Never point it at real data.
- `INTEGRATIONS_ENCRYPTION_KEY` must be backed up with the data; if it changes, stored tokens must be re-entered.
- Moderate dependency advisories (react-router 6, minio, swagger transitive) — see BACKLOG.
- External BPMN labels keep their original size when the language is switched (from Phase 1).
