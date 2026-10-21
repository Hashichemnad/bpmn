# Backlog

Ideas and follow-ups noted during development, outside the current phase scope. Group by the phase
where they belong; move items into the plan when that phase starts.

## Needs a decision

- **`braces` (high, dev-only, via Jest; no fixed version)** — accept until the slim API runtime image drops
  dev dependencies, or migrate the API tests from Jest to Vitest (SECURITY.md SEC-08).

## Phase 2 follow-ups (wiki, version control, Git)

- **Two-way Git sync** (import changes made in the repository; conflict handling). Phase 2 is one-way.
- Git: re-sync automatically when a process is renamed or moved without a new version (today: next version or
  "Sync now"); per-space opt-in/out of the export; sync attachments and images referenced by pages.
- Git: a persistent job queue (Redis/BullMQ) when running more than one API instance; scheduled reconcile.
- Space grants for a department could include its sub-departments.
- Move pages between spaces; copy a page; page-level permissions.
- Real-time collaborative editing (TipTap collaboration / Yjs) instead of per-user drafts.
- Search: include library objects; search inside attachments (PDF/Office text extraction).
- Attachment housekeeping: report files no version references any more.
- Template variables (e.g. owner, date) filled in when a page is created.

## Phase 3 follow-ups (governance, portal)

- Run the Playwright smoke tests (`apps/e2e`) in CI against the Docker Compose stack.
- Parallel approval steps (several groups at once) and conditional steps; delegation / out-of-office for
  approvers; escalation to a manager when a review is overdue.
- Email digest (daily summary) instead of one email per event; unsubscribe link in emails.
- Notifications in real time (Server-Sent Events) instead of polling every minute.
- Persistent job queue (Redis/BullMQ) for emails and the scheduler when running more than one API instance
  (today the scheduler runs in every instance; reminders are de-duplicated in the database).
- Comments: attachments, reactions, comment threads on document paragraphs (today: page level only).
- Portal: favourites / "follow" an item to get notified of new versions; read confirmations ("I have read
  this policy") with reports; analytics (most viewed, search terms without results).
- Portal: a public (no sign-in) mode for selected content.
- Portal search: synonyms and Arabic normalisation (hamza/alef variants, taa marbuta) beyond the built-in
  stemmer; search inside attachments.
- Feedback: attachments and a public status board.
- Bulk actions on the governance dashboard (re-assign, extend review dates).

## AI assistant follow-ups (M16)

- Portal Q&A: pgvector embeddings / hybrid search when the published corpus grows (D-045); feedback buttons
  ("helpful?") and a report of unanswered questions for content owners.
- Refine with chat: keep hand-made positions of unchanged elements instead of a full re-layout; support
  boundary events, data objects and annotations in the structure (today they are reported and dropped).
- More providers behind the same interface (Azure OpenAI, a self-hosted model for on-premises data) and a
  per-feature model choice in Settings → AI.
- A job queue for long generations (today they run in the API request, streamed); cost estimates in the usage
  report (tokens × price per model).
- Batch translation of a whole space or process tree; translation memory from approved translations.
- AI generation of risks and controls into the GRC library once Phase 4 exists.
- Playwright smoke tests for the AI screens against a mock provider (`ANTHROPIC_BASE_URL`).

## Phase 6 (hardening)

- Gotenberg service for server-generated PDFs (decided at the start of the AI phase: browser print stays
  until then, D-024/D-035).
- Optional TOTP two-factor authentication (CLAUDE.md §7 allowed deferral from Phase 1).
- SSO (Azure AD / OIDC).
- Slim API runtime image (`pnpm deploy --prod` plus a separate migration step); unprivileged nginx image.
- Rate-limit storage in Redis when running more than one API instance (currently in-memory).
- Password policy editable from Settings (currently environment variables).
- "My sessions" list with remote sign-out in the profile.
- Request/response schemas in Swagger (generate OpenAPI from the zod schemas).
- Code-split Ant Design to reduce the initial bundle (~370 KB gzipped).
- Track the dev-only `braces` advisory (via Jest), which has no upstream fix yet (see "Needs a decision").
- Moderate production advisories left after part 1: `minio` → `stream-json` / `decode-uri-component` (code
  paths unused, SECURITY.md SEC-09) — update when the MinIO client moves to fixed versions.
- External penetration test before go-live, using the checklist in `docs/SECURITY.md` §8.
- CSP without `style-src 'unsafe-inline'` (Ant Design CSS-variables mode / nonces).
- Optionally mark `ph_csrf` as a `__Host-` cookie when `COOKIE_SECURE=true` (the origin check, D-048,
  already covers cookie tossing).
- Shorter retention or masking of email addresses in API logs (failed notification emails).
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
