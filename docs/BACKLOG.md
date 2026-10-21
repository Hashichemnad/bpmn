# Backlog

Ideas and follow-ups noted during development, outside the current phase scope. Group by the phase
where they belong; move items into the plan when that phase starts.

## Needs a decision

- **MinIO image for production** — see DECISIONS D-009.

## Phase 2 (wiki, version control, Git)

- Visual compare and restore of model versions (version list exists).
- Encrypt GitHub/GitLab tokens with `INTEGRATIONS_ENCRYPTION_KEY` (AES-256-GCM); the Settings page already
  shows the disabled Integrations section.

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

## Nice to have

- Resize external BPMN labels when switching language (text is re-rendered, bounds are kept).
- Arabic translations for the bpmn-js "change element" popup menu (palette and context pad are translated).
- Server-side BPMN validation warnings on save (rules are in `packages/shared`, already reusable).
- Audit log CSV export.
- Server-side pagination for the process list page (it currently uses the full tree, fine for thousands of
  processes).
- Department manager / head-of-department field.
