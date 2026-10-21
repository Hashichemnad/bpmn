# Backlog

Ideas and follow-ups noted during development, outside the current phase scope. Group by the phase
where they belong; move items into the plan when that phase starts.

## Needs a decision

- **MinIO image for production** — keep `bitnamilegacy/minio` for now, revisit in Phase 6 (D-009).
- **PDF export** — browser print is used (D-024). Decide whether direct server-side PDF downloads are needed.

## Phase 2 follow-ups (wiki, version control, Git)

- **Two-way Git sync** (import changes made in the repository; conflict handling). Phase 2 is one-way.
- Git: re-sync automatically when a process is renamed or moved without a new version (today: next version or
  "Sync now"); per-space opt-in/out of the export; sync attachments and images referenced by pages.
- Git: a persistent job queue (Redis/BullMQ) when running more than one API instance; scheduled reconcile.
- Space grants for a department could include its sub-departments.
- Move pages between spaces; copy a page; page-level permissions.
- Comments and @mentions on pages (with the Phase 3 review workflow).
- Real-time collaborative editing (TipTap collaboration / Yjs) instead of per-user drafts.
- Search: include library objects; search inside attachments (PDF/Office text extraction).
- Attachment housekeeping: report files no version references any more.
- Template variables (e.g. owner, date) filled in when a page is created.

## Phase 3 (governance, portal)

- Restrict the Viewer role to published content only (D-006).
- Status workflow and reviewer assignment; re-enable status in the process update endpoint (D-014).
- Playwright end-to-end tests in CI (browser smoke flows were run manually for Phase 1).

## Phase 6 (hardening)

- Optional TOTP two-factor authentication (CLAUDE.md §7 allowed deferral from Phase 1).
- SSO (Azure AD / OIDC).
- Slim API runtime image (`pnpm deploy --prod` plus a separate migration step); unprivileged nginx image.
- Rate-limit storage in Redis when running more than one API instance (currently in-memory).
- Password policy editable from Settings (currently environment variables).
- "My sessions" list with remote sign-out in the profile.
- Request/response schemas in Swagger (generate OpenAPI from the zod schemas).
- Code-split Ant Design to reduce the initial bundle (~370 KB gzipped).
- Track the dev-only `braces` advisory (via Jest), which has no upstream fix yet.
- Moderate production advisories (no high/critical): `react-router` 6 (fixed only in 7.x — plan the upgrade),
  `minio` → `stream-json` / `decode-uri-component`, `@nestjs/swagger` → `js-yaml`.
- Code-split the wiki editor (TipTap) and the BPMN compare into lazy chunks.

## Nice to have

- Resize external BPMN labels when switching language (text is re-rendered, bounds are kept).
- Arabic translations for the bpmn-js "change element" popup menu (palette and context pad are translated).
- Server-side BPMN validation warnings on save (rules are in `packages/shared`, already reusable).
- Show the process version label in the process header (e.g. "v1.0 – approved").
- Audit log CSV export.
- Server-side pagination for the process list page (it currently uses the full tree, fine for thousands of
  processes).
- Department manager / head-of-department field.
