# Backlog

Ideas and follow-ups noted during development, outside the current phase scope. Group by the phase
where they belong; move items into the plan when that phase starts.

## Import tools / migration (M15) — not in this phase

- **Live connectors** (Salesforce, SharePoint, Oracle): integrations phase (4.4); imports are file based.
- **OCR** for scanned PDFs (they are flagged "needs manual work").
- **Visio `.vsd`** (old binary format): users save as `.vsdx`.
- **Antivirus scanning** of uploads (e.g. a ClamAV container): decide in the final security review.
- **Bizagi `.bpm`** native format (Bizagi's BPMN export works today).
- **ARIS AML:** organisation charts (`MT_ORG_CHRT`) into the org chart type, function allocation diagrams,
  other attributes (descriptions, custom attributes) and model hierarchy (assignments) — EPCs, value chains,
  roles and systems are imported today (D-160).
- **Full export** of very large installations as a background job with a download link (today the ZIP is
  built in the request — fine for 50–500 users); restore into a non-empty installation (merge) is out of scope.
- **Import Center:** column mapping templates per organisation (like the mining mapping templates); scheduled
  re-imports from a shared folder (needs a connector).
- **Visio:** use Visio shape positions as an alternative to the auto-layout; data / document shapes as BPMN
  data objects.

## Phase 5.2 — workflow execution follow-ups (noted during the work)

- Service tasks calling external systems (REST, Salesforce, Oracle) — integrations phase (4.4).
- Case migration of running requests to a newer deployed version (today each case stays on its version).
- E-signature of approvals and generated documents; mobile app / push notifications.
- Ad-hoc (case-management) tasks added at run time; embedded sub-processes and event sub-processes; message,
  signal and conditional events; multi-instance tasks (e.g. "all department heads approve").
- Form designer: conditional sections / fields shown by an expression, repeating groups (tables), calculated
  fields, lookups from the object library; Word templates uploaded as .docx with placeholders (today: text
  templates rendered with the docx generator).
- Notification templates with rich text; SLA pause while waiting for the requester (return for correction).
- Workflow monitor: bulk retry / cancel, case search by form data; dashboard drill-down to case lists per step.
- Dashboard: a materialised daily summary when volumes grow far beyond 10,000 requests (D-153).
- A queue (instead of in-process polling) when ProcessHub runs on several API instances (jobs are already claimed
  with a conditional update, so two instances do not run the same job).

## Phase 5.1 — process mining and simulation follow-ups (noted during the work)

- Workflow execution (Phase 5.2, M14): run approved processes as task flows; its own runs then become event logs.
- Connectors that pull event logs automatically from other systems (ERP, Salesforce, ticketing) on a schedule —
  integrations phase (4.4); today logs are uploaded or built from ProcessHub reviews.
- Object-centric process mining (OCEL 2.0), predictive monitoring (remaining time, outcome), alignment-based
  conformance and the inductive miner (would need a sidecar or a larger TypeScript implementation, D-128).
- **Case animation** on the process map (replay of tokens over time) — not built.
- Import speed: PostgreSQL `COPY` instead of `createMany` (~5× faster inserts, D-141); CSV encodings other than
  UTF-8 (Windows-1256 for Arabic Excel exports).
- Process map: manual node positions, export SVG / PNG, swim lanes per department; compare two periods or two filter
  sets side by side.
- Conformance: deviations on the portal; conformance per attribute value (e.g. channel); a conformance KPI.
- Simulation: resource calendars and shifts per lane, multitasking, priorities, batch processing, case attributes
  driving branch probabilities, calibration from the log (durations per step as distributions fitted to the log),
  confidence intervals over several replications, animation.
- Simulation results in the portal (today workspace only); AI proposals that change gateways / branch
  probabilities.

## Diagram types — follow-ups (noted during the work)

- UML, ERM / data-model diagrams and customer journey maps (not in this part).
- Real-time co-editing of diagrams (today: autosave per user, last save wins like the BPMN modeler).
- Value chain: badges and "colour by" in the portal (today workspace only, portal shows drill-down); swim-lane
  value chains; arrange chevrons right to left in Arabic.
- Organisation chart: positions with several holders as one node with a count; vacancies; reporting lines from
  `Department.managerId`; automatic regeneration when departments change.
- DMN: evaluate input expressions against a context (today values are entered per input), PRIORITY with output
  value lists, decision services and boxed expressions in the test panel, DMN in the AI assistant.
- EPC: round trip BPMN → EPC; process paths that call other EPCs; object links of information objects.
- SIPOC: link items to library objects (documents, roles) by default; SIPOC from a value chain element.
- Diagram-level AI translate EN↔AR of all labels (DMN: Translations panel; graph notations: labels per element).
- Mandatory EPC / DMN checks (product owner, D-127): let Admins mark selected EPC syntax rules and DMN checks as
  **mandatory before "Submit for review"**, reusing the Modeling conventions gate (D-088: Setting
  `modeling.conventions` with `{ enabled, mandatory }` per rule, Administration → Modeling conventions,
  `400 CONVENTIONS_NOT_MET` on submit, "Required" tag in the Validation panel). Today they are warnings only.

## Phase 4.4 — Integration & export (next)

- Oracle Fusion Risk Management overlay (risks / controls from Oracle, read-only first) and other connectors.
- Public API keys and outgoing webhooks (process published, KPI turned red, sync failed).
- Word / HTML / XPDL export of processes and diagrams; Git sync of the diagram types (value chain, org chart, DMN,
  EPC, SIPOC).
- Salesforce risk link and other external connectors (KPIs and risks are managed in ProcessHub for now).

## Phase 4.3 follow-ups (noted during the work)

- KPI editors: a dedicated "Performance Officer" role with `kpi.edit` (today Admins define KPIs, owners enter
  values) — product owner decision.
- Salesforce: write-back is out of scope by design (D-114); possible later: import of `Org_Kpi_Measure__c` yearly
  targets as per-period targets of annual KPIs, the `Responsible_Department__c` / `Responsible_Person__c` mapping to
  department and owner (Contact → user by e-mail), `Risk_Kpi_Relation__c` as key risk indicators.
- Salesforce "Run As" user per sync run in the audit log instead of the Super Admin who saved the settings.
- Capability map: drag-and-drop ordering and a printable A3 export; heat-map overlay of KPI status per capability.
- Landscape: grouping by department / capability swim-lanes, saved layouts, manual node positions.
- Data objects: data lineage (interface chains) and a "who reads personal data" report for data protection.
- KPI dashboard: comparison of two periods, PDF export, KPI targets per department (cascading).
- Calculated KPIs: from process mining (Phase 5) instead of the planned step attributes.
- Portal: KPI section as a small chart per KPI (today status, value and sparkline).

## Phase 4.2 follow-ups (noted during the work)

- Change approval: a "changes" history tab listing approved / rejected proposals per item; approval of requirement changes.
- Control testing: sampling helper (random selection from an uploaded population list); copy the last test's
  samples; test plans for several controls at once; tests in the portal for testers without the workspace.
- Issues: link several risks / controls / steps to one issue; issue import / export (Excel); a "managers" view of
  the team's overdue items; SLA by severity (default due date).
- Audits: an option to **share the final audit report with the owners of the processes in scope** (product owner,
  D-106; today audits are visible to Internal Audit, Risk & Compliance editors and Auditors only); annual plan
  approval workflow; time budgets and actual hours per auditor; audit report template upload
  (company Word styles, shared with the handbook backlog item); findings repository across years; follow-up audits
  that re-test agreed actions; audit universe weighting beyond residual risk (last audit age, regulatory weight).
- Questionnaires: question library and import / export of questionnaires; anonymous surveys; scoring bands per
  questionnaire; per-department comparison of results; reminders more than once; campaigns in the portal for
  external recipients (e-mail links).
- Dashboards: trends over time (monthly snapshots); PDF export.
- Ratings are computed in memory for lists and dashboards (D-089); store scores if registers grow far beyond a few
  thousand items. Heat map of a single risk's history (trend), risk appetite per category.
- Portal: a requirement view per process (only process-level requirements; currently not shown in the portal).
- Import of risk ↔ control links from the control sheet (today: from the risk sheet's "Controls" column).

## Modeler design — after Part B2

Part A (colours, D-067 – D-073), Part B1 (full-screen workspace and productivity, D-074 – D-081) and Part B2
(Dictionary, Quick Model, step attributes and "colour by", reports, modeling conventions, D-083 – D-088) are done.
Kept out of B2 on purpose:

- Real-time co-editing.
- Other diagram types: EPC, value chain, organisation chart, DMN decision tables.
- Simulation (time and cost, using the step attributes) — with Phase 5.

B2 follow-ups noted during the work:

- Dictionary: notify the proposer when a term is approved or rejected; import / export the dictionary (Excel);
  term relations ("see also", broader / narrower); show term definitions as tooltips in the portal.
- Autocomplete for the description fields (insert a term inside a sentence); several terms in one label.
- Quick Model: spreadsheet keyboard navigation (arrows / Enter between cells, copy a block back to Excel),
  drag rows to reorder, several pools, rows for sub-processes and their content, a description column.
- Step attributes: organisation currency in Settings; working-day calendar (8-hour days) for durations; cost
  and time simulation (Phase 5); show attributes in the portal step details; colour-by views in the portal.
- Reports: handbook as PDF (server-side LibreOffice or a print stylesheet); a company Word template
  (styles, header / footer) uploaded in Settings; scheduled report e-mails; RACI with consulted / informed
  roles (C / I need a relation per step: CONSULTED / INFORMED links); handbook of a whole category (house
  column); render the diagrams server-side (headless browser) for exports without a browser; replace
  `exceljs` when it drops the `uuid` 8 dependency (moderate advisory, SECURITY SEC-09).
- Modeling conventions: rules per process category or department; naming rules (verb + noun, glossary terms
  only, maximum label length); allowed element types; exceptions per process with a reason; a conventions report
  across all processes; check pages (SOP templates) too.
- Rename: offer the update for published processes as a colours-only style "in place" change (today a new
  draft that needs approval again, like any other edit).

B1 follow-ups noted during the work:

- Auto-layout for diagrams with several pools or vertical lanes; keep the user's manual label positions.
- Search pad (Ctrl+F) in the read-only workspace (bpmn-js offers it in the modeler only).
- Lane label follows a role rename automatically (today: a button in the panel); several roles per lane.
- Portal: step details as a docked panel in full screen; badges for KPIs once M12 exists.
- Print: choose the parts manually (e.g. one part per lane group); portrait option.
- Workspace preferences on the server (follow the user across browsers).

Other ideas from Part A:

- Theme per process category or per department; dark diagram theme for presentations.
- Colour sequence flows and text annotations (the theme colours shapes only).
- Compare: list colour-only changes separately from moves ("recoloured").
- Use the actual rendered label size for external labels after a language switch (existing nice-to-have).

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
- SSO / 2FA follow-ups (part 3, D-055 – D-059): read groups from Microsoft Graph when Entra ID sends a
  "group overage" (users in > 200 groups); SCIM provisioning / de-provisioning and OIDC back-channel logout so
  disabling a user in Entra ID ends ProcessHub sessions at once; RP-initiated logout (sign out at the provider
  too); several identity providers at once; SAML 2.0 (only if a provider cannot do OIDC); private-key JWT /
  certificate client authentication instead of a client secret; WebAuthn / passkeys as a second factor;
  "remember this device" for 2FA; e-mail notice when 2FA is turned off or reset; a reminder before the Entra
  client secret expires (store the expiry date in Settings); automated browser test with the mock provider in
  the Playwright suite (needs the mock running next to the stack).
- Slim API runtime image (`pnpm deploy --prod` plus a separate migration step); unprivileged nginx image.
  (Node 22 LTS: done in part 4, D-066.)
- From the part 4 decisions (D-061 – D-065): **automatic de-provisioning** (SCIM / back-channel logout, see
  above) stays here — until then the leaver process deactivates users by hand; optionally an absolute session
  limit (e.g. sign in again every 24 hours even when active; today the 24 hours are an idle timeout); check the
  `amr` / `acrs` claim so ProcessHub refuses SSO sign-ins without MFA if Conditional Access is misconfigured;
  a quarterly reminder to test the break-glass account; an admin-side report of who has 2FA turned on.
- Production follow-ups from part 2 (D-051 – D-053): publish versioned images to a registry (GHCR / ACR /
  ECR) so servers pull instead of build; rename the `MINIO_*` variables to `STORAGE_*` (keep the old names as
  aliases); replace the `minio` npm client with `@aws-sdk/client-s3` (also clears SEC-09); run the storage
  container as a non-root user; optional encryption of backup folders (age / GPG) and a built-in off-site
  upload; an automated restore drill in CI; Prometheus metrics / Grafana dashboard; a `processhub` admin CLI
  (reset a locked-out last Super Admin, show versions); point-in-time recovery (WAL archiving) if a daily
  backup is not enough for the business.
- Rate-limit storage in Redis when running more than one API instance (currently in-memory).
- Password policy editable from Settings (currently environment variables).
- "My sessions" list with remote sign-out in the profile.
- Request/response schemas in Swagger (generate OpenAPI from the zod schemas).
- Code-split Ant Design to reduce the initial bundle (~370 KB gzipped).
- **Move the API tests from Jest to Vitest** (same runner as web and shared; removes the dev-only `braces`
  advisory, SECURITY.md SEC-08, accepted for now in D-054). Until then, track `braces` for an upstream fix.
- Moderate production advisories left after part 1: `minio` → `stream-json` / `decode-uri-component` (code
  paths unused, SECURITY.md SEC-09) — update when the MinIO client moves to fixed versions or replace the client.
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
