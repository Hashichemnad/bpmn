# ProcessHub

**A bilingual (Arabic / English) business process management platform** — combining the core of ARIS and GBTEC (BIC) with a Confluence-style documentation wiki, Git-style version control and an optional GitHub / GitLab integration.

**منصة ثنائية اللغة (العربية / الإنجليزية) لإدارة العمليات المؤسسية** — تجمع بين جوهر ARIS و GBTEC (BIC) مع ويكي للتوثيق على غرار Confluence، والتحكم في الإصدارات، وتكامل اختياري مع GitHub / GitLab.

> **Status:** every feature module is built and merged — platform, process house and modeler, object
> library, documentation wiki, version control, Git sync, governance, Knowledge Portal, AI assistant, Risk &
> Compliance and assurance, enterprise architecture and KPIs, five more diagram types, process mining and
> simulation, workflow execution and the import tools. The final hardening session (performance,
> accessibility, production images, backup drill) is on branch `final-a-performance`; Phase 4.4 integrations
> follow. Details: [`docs/PROGRESS.md`](./docs/PROGRESS.md).

---

## What it does

| Area | Features | Phase |
|---|---|---|
| **Platform** | Users, roles & permissions, hierarchical departments, audit log, organisation settings & logo, Arabic/English with RTL | ✅ 1 |
| **Sign-in** | Single sign-on with Microsoft Entra ID (Azure AD) or any OpenID Connect provider (users created on first sign-in, directory groups → roles and departments, allowed domains), password sign-in can be limited to a break-glass admin, optional two-step verification with an authenticator app (required per role, recovery codes, admin reset) | ✅ 6 |
| **Process House & Repository** | Management / Core / Support process house, drag-and-drop process tree, owners, departments | ✅ 1 |
| **Process Modeler** | BPMN 2.0 editor with bilingual labels, validation, versions, drill-down, import/export (BPMN XML, SVG, PNG); enterprise look (colour theme by element type, approval steps, rounded shapes, task icons, Inter / IBM Plex Sans Arabic, right-to-left Arabic labels), colour picker, all colours stored as standard BPMN-in-Color | ✅ 1, design A, B1 |
| **Object Repository** | Reusable roles and IT systems linked to process steps, "where used" report (documents, risks, controls, KPIs later) | ✅ 1 |
| **Smarter modeling & reports** | Dictionary of approved bilingual terms with label autocomplete (terms, roles, IT systems, synonyms) and rename with preview; Quick Model (enter a process as a table or paste from Excel, generate the diagram); step attributes (times, SLA, frequency, cost, inputs / outputs) with "colour by" views and process totals; process handbook (Word) and RACI / "where used" reports (Excel) in English or Arabic (RTL); modeling conventions (house rules as warnings, selected ones required before review) | ✅ design B2 |
| **Documentation Wiki** | Spaces with access rules, page tree, rich-text editor (tables, checklists, callouts, images, attachments, embedded BPMN diagrams, RTL/LTR), English + Arabic versions, templates, trash, full-text search, PDF / Markdown export | ✅ 2 |
| **Version Control** | Versions with change notes for processes and pages, visual BPMN diff, side-by-side / inline text diff, restore, labels | ✅ 2 |
| **Git Integration** *(optional)* | One-way sync of BPMN models (.bpmn + .json) and pages (Markdown) to GitHub or GitLab, on every version or on demand, with a status page | ✅ 2 |
| **Governance** | Draft → In Review → Approved → Published → Archived with approval workflows (sequential steps, any-one or all approvers), review page with visual diff, threaded comments with @mentions on BPMN elements, notification centre and email, review dates with reminders, My tasks, governance dashboard | ✅ 3 |
| **Knowledge Portal** | Read-only portal for all staff with published content only: process house, step details, documentation with table of contents, English/Arabic search, "my processes", feedback to owners, PDF download, branding and access settings | ✅ 3 |
| **AI Assistant** *(optional, off by default)* | Generate a BPMN process (lanes, bilingual labels, auto-layout) from a description; refine it by chat with a visual review; SOP / work instruction from a process and a process from a page; EN↔AR translation of fields, labels and pages; analysis (missing steps, responsibilities, bottlenecks, risks, controls) and plain-language validation warnings; summaries and "what changed"; a Knowledge Portal assistant that answers only from published content with links. Anthropic Claude, encrypted key, roles, limits, usage report, full audit | ✅ AI |
| **Risk & Compliance (GRC core)** | Risk register (inherent / residual 5 × 5 ratings, configurable categories and rating bands), control library (type, nature, frequency, key control, IT system, design effectiveness), requirements (law → section → clause); risk ↔ control ↔ requirement relations; assessment history and comments; links to process steps with a modeler panel, warning badges and "colour by" risk views; heat maps, coverage dashboard with drill-down, risk–control matrix and Excel import / export; review reminders; portal visibility setting; handbook section; AI control-gap check | ✅ 4.1 |
| **Assurance** | Approval of changes to risks / controls, control testing with samples and four-eyes review, issues and action plans, audit universe / plan / engagements / findings / Word report, questionnaires and self-assessments, assurance dashboard | ✅ 4.2 |
| **Enterprise architecture** | Application catalogue (the IT systems linked to steps: type, vendor, owners, hosting country, lifecycle, criticality, data classification), interfaces, data objects with system of record and CRUD matrix, 3-level capability map with "colour by" (coverage, applications, lifecycle, risk), application landscape diagram (SVG / PNG), traceability capability → process → step → application → data (+ risks / controls), impact analysis of an application, Excel import / export, modeler "colour by application lifecycle", handbook "Systems and data" | ✅ 4.3 |
| **KPIs & dashboards** | KPI catalogue (formula, unit, direction, frequency, targets and green / amber / red thresholds per period, owner, data source), strategic objectives, key risk indicators, links to processes and steps; values with comment and evidence, owner reminders in My tasks, Excel import, history; KPIs calculated from step attributes (duration, waiting, cost, handovers, automation rate); KPI dashboard by objective with sparklines and drill-down chart, KPI badges and "colour by KPI status" in the modeler, process performance card, optional portal section; optional read-only **Salesforce** KPI link (mapping, preview, scheduled sync, sync log) | ✅ 4.3 |
| **More diagram types** | One framework for **value chains** (chevrons / blocks / frames, drill-down to processes and value chains, status / KPI / risk badges, "colour by", generation from the process house), **organisation charts** (units, positions, persons, reporting and staff lines; generated from departments, roles and people with merge-by-id regeneration and preview; a position shows the steps it performs with RACI), **DMN decision tables** (dmn-js, bilingual names, hit policies, typed inputs / outputs, FEEL "Test decision", validation, import / export, linked to BPMN business rule tasks), **EPC** (ARIS notation, syntax rules as warnings, conversion to a draft BPMN process with mapping report) and **SIPOC** (generated from a process); versions with visual compare, review workflow, comments on elements, object links, where used, Knowledge Portal (browse by type, value chain start page), handbook sections, export SVG / PNG / PDF | ✅ Diagrams |
| **Process mining** | Event logs from CSV / Excel / XES (streaming import, column mapping with templates, timestamp and time-zone detection, validation report, pseudonymisation, access per owner / department / grant, retention) or from ProcessHub's own reviews; process map with frequency / performance views and activity / path sliders, variants with compare, stackable saved filters, statistics (throughput, trend, rework, resources, handovers), bottlenecks with the cases behind them, Excel exports; "Generate BPMN" with the heuristics miner; conformance by token replay (fitness, skipped / inserted / wrong-order steps) with a "colour by" overlay on the BPMN model, KPIs calculated from logs, measured vs planned step times; optional portal "Performance" section and handbook section | ✅ 5.1 |
| **Simulation** | Discrete-event what-if simulation from the step attributes: distributions, lanes as resources with capacity, Sun–Thu working calendar with UAE holidays, branch probabilities (from mining), as-is and to-be scenarios on any process version, validation, side-by-side comparison with charts and Excel, bottleneck view on the model, AI explanation and proposals | ✅ 5.1 |
| **Workflow execution** | Published processes run as requests: execution settings in the modeler (forms with an editor and bilingual preview, assignment rules, due times in working time, four-eyes, approval outcomes, S-FEEL conditions, timers, DMN business rules, notifications, Word documents, call activities, error paths), executable check, deployment of the published version (cases pinned to their version), service catalogue and start forms in the portal, inbox with claim / delegate / out-of-office, approve / reject / return, case page with highlighted diagram, timeline, files and comments, reminders and escalation, workflow monitor (retry, cancel, reassign) and dashboard with Excel, live event log for process mining. See [`docs/WORKFLOWS.md`](./docs/WORKFLOWS.md) | ✅ 5.2 |
| **Import tools / migration** | Import Center: every import is a batch — upload, background read with progress and cancel, preview with column / shape mapping and a validation report, dry run, apply, Excel result report, undo while drafts, safe re-import (matching by code, e-mail, external id, file name). Process house, departments and users (invitations, no passwords) from Excel / CSV; BPMN (ZIP, Signavio / Camunda / Bizagi / ARIS exports, Arabic label detection, auto-layout), Visio `.vsdx`, ARIS AML (EPC, value chains, roles, systems), DMN; Word, PDF, Confluence HTML exports and Markdown into the wiki with process links; the existing register imports as batches; AI proposals (SOP → BPMN, risks and controls, translation) in a review queue; migration dashboard and review queue with bulk actions; full export package and restore. Upload security: content sniffing, ZIP-slip / zip-bomb limits, no XXE, macros refused. See [`docs/MIGRATION.md`](./docs/MIGRATION.md) | ✅ Import |
| **Integrations & exports** | Public REST API (`/api/public/v1`, read-only) with API keys — scopes, published or workspace content, department filter, IP allow-list, expiry, rotate / revoke, per-key rate limit, call log, OpenAPI at `/api/public/docs`; Power BI / Excel reporting feed (13 flat tables); webhooks (16 events, HMAC-signed, retries with backoff, automatic switch-off, delivery log, resend, SSRF guard); Microsoft Teams channel cards (Teams Workflows, English / Arabic RTL); offline HTML website export (process, branch, value chain, wiki space — works without network); PowerPoint export (process, value chain, KPI and risk summaries, Arabic RTL slides); scheduled report e-mails (six reports, PDF / Excel / link, Dubai time, built with each recipient's permissions, unsubscribe); internal headless-Chromium renderer for server-side diagram images and PDFs. See [`docs/integrations/`](./docs/integrations/) | ✅ 4.4 |
| **Operations & performance** | Production stack with automatic HTTPS (Caddy), slim images published to the GitHub Container Registry on every release (API, one-shot migrations, unprivileged web), checksummed backups with restore and an automated restore drill, 24-hour idle and 7-day absolute session limits, optional MFA check of single sign-on tokens; measured on a production-size volume seed (2,000 processes, 5,000 pages, 1M mining events, 10,000 requests): every screen's API call under 300 ms at P95, first page load 238 KB of JavaScript (gzip) with Brotli assets; keyboard and screen-reader support (WCAG 2.1 AA colours, skip link, announced form errors) and a CI check that English and Arabic stay complete | ✅ 6 |

## Documentation

| Document | For |
| --- | --- |
| [`docs/DEPLOYMENT.md`](./docs/DEPLOYMENT.md) | IT: server sizing, installation step by step, HTTPS, single sign-on, backups, restore and the restore drill, updates from the container registry, monitoring |
| [`docs/SECURITY.md`](./docs/SECURITY.md) | Security review, controls (OWASP Top 10), every endpoint with its guards, remaining risks, go-live checklist, penetration-test checklist |
| [`docs/WORKFLOWS.md`](./docs/WORKFLOWS.md) | Process owners and admins: making a process executable, forms, assignments, SLAs, monitoring |
| [`docs/MIGRATION.md`](./docs/MIGRATION.md) | Migration team: preparing files, import order, review queue, go-live checklist |
| [`docs/AI-DEMO.md`](./docs/AI-DEMO.md) | A guided demo of the AI assistant |
| [`docs/integrations/API.md`](./docs/integrations/API.md) · [`WEBHOOKS.md`](./docs/integrations/WEBHOOKS.md) · [`TEAMS.md`](./docs/integrations/TEAMS.md) · [`POWER-BI.md`](./docs/integrations/POWER-BI.md) | IT / integrators: API keys and endpoints (curl, Power Query), webhook payloads and signature check, Teams channel setup, Power BI reporting feed |
| [`docs/PROGRESS.md`](./docs/PROGRESS.md) · [`docs/DECISIONS.md`](./docs/DECISIONS.md) · [`docs/BACKLOG.md`](./docs/BACKLOG.md) | Developers: what is done (with measurements), why, and what comes later |

### Build phases

| Phase | Scope | Status |
| --- | --- | --- |
| 1 | Platform, process house, BPMN modeler, roles & systems | ✅ |
| 2 | Documentation wiki, version control, Git integration | ✅ |
| 3 | Governance, Knowledge Portal | ✅ |
| AI | AI assistant | ✅ |
| Design A / B1 / B2 | Modeler look and feel, full-screen workspace, smarter modeling and reports | ✅ |
| 4.1 / 4.2 | Risk & Compliance core, assurance | ✅ |
| 4.3 | Enterprise architecture, KPIs & dashboards | ✅ |
| Diagrams | Value chain, organisation chart, DMN, EPC, SIPOC | ✅ |
| 5.1 / 5.2 | Process mining and simulation, workflow execution | ✅ |
| Import | Import tools / migration | ✅ |
| 4.4 | Integrations & export: public API with keys, webhooks, Power BI feed, Teams, HTML / PowerPoint export, scheduled report e-mails | ✅ merged into `main` |
| 6 | Hardening: security review, production deployment, SSO / 2FA, performance, accessibility, images, restore drill | 🟡 final security review (part B) after 4.4 |

## Quick start (Docker)

Requirements: Docker with Compose v2.24 or newer.

> **Production / go-live:** use `docker-compose.prod.yml` (Caddy with automatic HTTPS, internal network,
> backups) and follow [`docs/DEPLOYMENT.md`](./docs/DEPLOYMENT.md) — a step-by-step guide for IT, including
> server sizing, backups and restore. The quick start below is a local trial with demo data.

```bash
git clone <this repository> processhub && cd processhub
docker compose up --build
```

`docker compose up` first runs the one-shot `migrate` service (database migrations and demo data) and starts
the API once it has finished successfully.

Open **http://localhost:8080** and sign in with the default Super Admin:

| Email | Password |
|---|---|
| `admin@processhub.local` | `ChangeMe-Admin1` |

Two-step verification is required for Super Admin and Admin, so the first sign-in asks you to scan a QR
code with an authenticator app (Microsoft Authenticator, Google Authenticator, 1Password, …) and to keep the
recovery codes. **Change this password straight away** (top-right menu → My profile). The first start applies database
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
| `auditor@processhub.local` | Auditor (Adel) | Workspace, read-only — drafts, history, reviews, audit log, AI usage, Risk & Compliance (read) |
| `risk@processhub.local` | Risk & Compliance Officer (Rana) | Risk & Compliance — registers, dashboard, settings; rest of the workspace read-only |
| `audit@processhub.local` | Internal Audit (Iman) | Audits — audit plan, engagements, findings; tests and reviews controls; rest read-only |
| `architect@processhub.local` | Enterprise Architect (Ali) | Architecture — applications, interfaces, data objects, capability map; rest read-only |
| `performance@processhub.local` | Performance Officer (Perla) | KPIs — defines KPIs, objectives and targets, enters any value, runs the Salesforce sync; rest read-only |

Demo users are only created on a demo installation (`SEED_DEMO_DATA=true`, the default). **Emails** sent by
the demo installation go to the bundled **Mailpit** at **http://localhost:8025** — nothing leaves the machine.

### A short tour of Phase 4.4 — integrations and exports

Demo installations seed a read-only API key for published content, a webhook to the local test receiver, a
switched-off Teams channel and a weekly KPI report e-mail for Perla. The demo key is **random and shown only
once**, in the seed output — find it with `docker compose logs migrate | grep -A1 "Demo API key"` (D-180).
While demo data exists, admins see a warning banner; remove the demo before go-live (go-live checklist).

1. **Public API:** `curl -H "X-API-Key: <demo key from the seed output>"
   http://localhost:8080/api/public/v1/processes?pageSize=5` — published processes with English and Arabic names;
   the interactive documentation is at <http://localhost:8080/api/public/docs>. Lost the key? Create a new one
   in Settings → Integrations → API keys.
2. Sign in as the admin → **Settings → Integrations**: API keys (create one — the secret is shown once —, call
   log, new secret, revoke), **Webhooks** (the demo receiver; "Send test event", delivery log with the payload),
   **Microsoft Teams** (card language, switched-off demo channel). Requests the receiver got:
   <http://localhost:8090/received>.
3. Publish a process (or approve a review) and watch the signed delivery arrive at the receiver.
4. On a process page (workspace or portal): **Reports → Offline website (HTML)** — unzip and open
   `index.html` without network, switch to Arabic — and **PowerPoint** in English or Arabic.
5. Sign in as `performance@processhub.local` → user menu → **My report e-mails**: the weekly KPI dashboard,
   "Send to me now", the e-mail in Mailpit (<http://localhost:8025>) with its secure link, delivery log.

### A short tour of the import tools (migration)

- As the Super Admin: **Administration → Import Center**. Import, in this order, the invented samples from
  [`docs/samples/import/`](./docs/samples/import/README.md): **Departments** `departments.xlsx`, **Process house**
  `process-house.xlsx` (the preview shows the column mapping and the validation report — try a file with a missing
  parent), **BPMN diagrams** `bpmn-diagrams.zip` (Arabic labels, a diagram laid out automatically, Camunda
  extensions removed, lane → role suggestions), **Visio** `S.03 Leave request flowchart.vsdx` (shape mapping table
  with an unmapped shape), **ARIS** `aris-procurement.xml`, **Word documents** (both SOPs, choose a space) and
  **Confluence** `confluence-quality-manual.zip`. Every batch: *Apply* → result with links → *Undo batch*.
- **Migration dashboard** (per department / process-house branch, problems, Excel), **Review queue** (bulk assign
  owner, apply theme, validate, submit for review), **AI proposals** (with the AI assistant enabled), *Full export
  (ZIP)*. Owners see their imported drafts in **My tasks**. Guide: [`docs/MIGRATION.md`](./docs/MIGRATION.md).

### A short tour of Phase 5.2 — workflow execution

- As `viewer@processhub.local`: **Portal → Services** lists **PMS-01 Program / Initiative Request & Approval** and
  **HR-01 Leave request**. Start a program request with an estimated budget of AED 150,000; the request page shows
  its number (`PMS-2026-…`), the diagram with the current step and the timeline. **My requests** lists the seven
  demo requests (one completed with its generated approval letter, one returned for correction, one rejected …).
- As `section@processhub.local` (password `SEED_DEMO_PASSWORD`): **My tasks → Workflow tasks** → open the request →
  *Approve*, *Reject* or *Return for correction* (comment required). Then `owner@` (department manager), `finance@`
  (budget approval, added by the DMN decision for AED 100,000 or more), `pmo@` (group task: *Claim*) and `dgo@`.
- As `owner@processhub.local`: the PMS-01 page → tab **Execution** (settings, deployments, live event log), the
  modeler's **Execution** tab (select a step: assignment, due time, form editor with preview), **Requests →
  Workflow monitor** and **Workflow dashboard**. Admin guide: [`docs/WORKFLOWS.md`](./docs/WORKFLOWS.md).

### A short tour of Phase 5.1 — process mining and simulation

- As `performance@processhub.local`: **Process mining → Event logs** lists **LOG-001 Invoice processing** (5,000
  generated invoices of the demo process *S.01.04 Invoice processing*). Its tabs: **Process map** (switch to
  *Performance*, move the *Activities* and *Paths* sliders), **Variants** (select two to compare, *Show on map*),
  **Statistics**, **Bottlenecks** (the finance approval waits longest — click a case to see its events),
  **Conformance** (fitness, deviations such as payments without PO matching, planned vs measured step times →
  *Update steps* saves a new process version) and **Activities and steps** (mapping to the BPMN steps).
- *Show on the model* opens S.01.04 with **Colour by → Mining: deviations / measured time / cases per step**.
- **Import log** with `docs/samples/invoice-processing-log.csv` (or `.xes`) walks through upload → mapping →
  validation report → import; **Create log from ProcessHub** turns the governance reviews into a log.
- **Process mining → Simulations → SIM-001**: as-is (one finance approver, the bottleneck at ~90 % utilisation),
  *Second finance approver* and *Automatic PO matching*; edit a scenario (durations, people, calendar, branch
  probabilities), *Run all scenarios*, compare, export to Excel, *Bottlenecks on the model*. **KPI-M01 Invoice cycle
  time** is calculated from the log (KPIs → data source *Calculated from an event log*).
- Settings (Super Admin): retention of logs and the optional portal "Performance" section on published processes.

### A short tour of the diagram types — value chain, organisation chart, DMN, EPC, SIPOC

- As `modeler@processhub.local`: the repository tree (**Processes**) shows the demo diagrams with a type icon — the
  value chain and the organisation chart under **Diagrams**, the decision table, EPC and SIPOC under *Procure to
  Pay*. **New** offers a process and each diagram type (value chain: generate from the process house; organisation
  chart: generate from departments and roles; SIPOC: generate from a process). Open **VC-001 Enterprise value
  chain** → *Open editor*: the elements are linked to processes (↗ opens them), carry status / KPI / risk badges, and
  *Colour by* recolours them by process status, KPI status, residual risk or department.
- **ORG-001**: click a position (e.g. *Procurement Officer*) — the side panel lists the steps it performs with RACI
  letters; *Regenerate* previews what changes when departments or roles changed (manual edits are kept).
- **DMN-001 Approval authority**: the decision table editor with hit policy FIRST; the **Test** tab evaluates it
  (50 000 / IT → *IT Director*, matching row highlighted), **Validation** checks the FEEL entries, **Translations**
  holds the Arabic names; export / import `.dmn`. The process *S.01.02 Purchase approval* uses it from the business
  rule task *Determine approver* (modeler side panel → *View table*).
- **EPC-001**: the ARIS chain with its **Validation** tab; *Convert to BPMN* creates a draft process with lanes,
  gateways and branch labels and shows the mapping report (the demo conversion is *S.01.03*).
- **SIPOC-001**: the five columns generated from *Purchase Requisition*, editable in both languages.
- As `viewer@processhub.local`: the portal home starts with the published value chain — click a chevron to drill
  down to the process; **Diagrams** lists the published diagrams by type. The process handbook (process page →
  *More* → *Process handbook*) can include the value chain path, SIPOC, linked decision tables and the
  organisation chart excerpt.

### A short tour of Phase 4.3 — enterprise architecture, KPIs and the Salesforce link

- As `architect@processhub.local`: **Architecture → Capabilities** shows the capability map (levels 1–3); switch
  *Colour by* between process coverage, number of applications, application lifecycle and risk rating; a tile
  opens its processes and applications. **Applications** lists the twelve demo applications (the IT systems the
  modeler links to steps); open *ERP* → **Impact analysis**: the processes, steps and controls affected if it were
  retired, with Excel export. **Landscape** draws applications and interfaces (filter by capability, department,
  lifecycle; SVG / PNG); **Data objects** has the CRUD matrix; **Traceability** follows capability → process → step →
  application → data object with the risks and controls on each step. Every catalogue has Excel export / template /
  import.
- As `owner@processhub.local`: **Performance → KPI dashboard** — two strategic objectives with eight KPIs (green,
  amber and red), sparklines, filters (department, process, owner, as-of month) and a drill-down chart; **My tasks**
  → *KPI values to enter* (KPI-06 is due): enter the value with a comment and evidence and watch the status
  change. The process *Purchase Requisition* shows a **Performance** card; in the modeler the steps carry KPI badges
  and *View → Colour by → KPI status / Application lifecycle* colours the diagram.
- As the Super Admin: **Administration → Salesforce KPI link** — connect a Salesforce org with a read-only
  integration user (DEPLOYMENT.md §6.4), map the PMS objects (defaults included), preview the differences, sync
  now or on a schedule; imported KPIs show "Source: Salesforce" and stay read-only. Scheduled syncs run as the
  system actor "Salesforce sync". As `performance@processhub.local` (Performance Officer): **Performance →
  Salesforce KPI link** previews and runs the sync (settings read-only). In the KPI settings (KPI
  catalogue → *KPI settings*) **Show KPIs in the portal** adds the KPIs to the portal page of a process.

### A short tour of Phase 4.2 — assurance (control testing, issues, audits, questionnaires)

- As `risk@processhub.local`: **Risk & Compliance → Assurance dashboard** shows control tests done / due /
  overdue and % effective by department and process, open issues by severity and age, the audit plan and survey
  response rates — every figure opens the filtered list; Excel export in English or Arabic. **Control tests** lists
  the demo tests: the failed CTL-01 test (samples, evidence, reviewed conclusion) set the control's *tested
  effectiveness* to "Not effective"; the **Risk dashboard** heat map has the toggle *Using tested effectiveness*.
  **Issues & actions** → ISS-0001 (raised from that test) with its action plan; **Questionnaires** → the purchasing
  self-assessment campaign with results, Excel export and rating proposals to accept or dismiss. Settings →
  Risk & Compliance: *Approval of changes* routes changes of active risks / controls through a workflow, and the
  issue severity scale and escalation.
- As `owner@processhub.local`: **My tasks** has a control test to perform, issue actions, an audit finding to
  answer (agreeing creates an issue) and the self-assessment questionnaire. On a process, **Request feedback**
  sends a short questionnaire with the draft diagram; answers arrive as comments on the process.
- As `audit@processhub.local`: **Audits** — the audit universe ranked by residual risk, the annual plan, and the
  engagement *Procurement and purchase approvals* (work programme, two findings, management responses, **Audit
  report** as Word in English or Arabic).
- As `viewer@processhub.local`: questionnaires and issue actions sent to Viewers appear under **My tasks** in the
  portal.

### A short tour of Phase 4.1 — Risk & Compliance

Sign in as `risk@processhub.local`. **Risk & Compliance → Risk dashboard** shows the inherent and residual heat
maps of the demo risks (purchasing and payments) — click a cell to list its risks, a tile (e.g. "High / critical
without an effective control") to open the filtered register, a department row to drill down to processes and
steps; **Risk-control matrix (Excel)** exports process → step → risk → control → requirement. The **Risk register**,
**Control library** and **Requirements** pages filter, sort, export to Excel and import from Excel (with a check
before anything is imported). Open "S.01.01 Purchase Requisition" in the modeler: the step "Approve requisition"
carries a red warning badge (a critical risk whose control is not assessed); the side panel tab **Risks &
Controls** shows the linked items and **Check control gaps** runs the rules (and, with the AI assistant on, its
explanations and suggestions). **View → Colour by → Residual risk rating**. Administration → **Risk & Compliance**
configures the categories, the 5 × 5 matrix and whether the Knowledge Portal shows controls and risks.

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

- `POSTGRES_PASSWORD`, `MINIO_SECRET_KEY`: database and file-storage passwords (the `MINIO_*` names are kept from earlier versions; the storage is now Versity S3 Gateway, DECISIONS D-051).
- `SEED_ADMIN_EMAIL`, `SEED_ADMIN_PASSWORD`: the first Super Admin. These are read only when that user does not exist yet.
- `JWT_ACCESS_SECRET`: leave it empty and the API generates a random secret on first start, kept in the `api-data` volume.
- `INTEGRATIONS_ENCRYPTION_KEY`: encrypts GitHub/GitLab tokens and the SMTP password (AES-256-GCM). Leave it empty with Docker and a key is generated and kept in the `api-data` volume.

> ⚠️ **Back up `INTEGRATIONS_ENCRYPTION_KEY` (or the `api-data` volume) together with the database.** If the key is lost or changes, stored Git tokens and the SMTP password cannot be decrypted and must be entered again.

- `APP_URL`: the address users open; used for links in emails.
- `SEED_DEMO_PASSWORD`: password of the four demo users. `SEED_SMTP_HOST`: SMTP host the demo installation is configured with (Mailpit by default; set it empty to leave email unconfigured).
- `SCHEDULER_INTERVAL_MINUTES`: how often review reminders are checked (default 60; `0` turns them off).
- `WEB_PORT`, `CORS_ORIGINS`: the port and URL users open.
- `OUTBOUND_ALLOWED_HOSTS`: internal hosts (names, IPs or CIDR ranges) the Git and SMTP integrations may reach. All other internal addresses are blocked to prevent SSRF. Docker Compose defaults to `mailpit`; add your own GitLab or SMTP server if it runs in a private network.
- `AUTH_FORCE_LOCAL_LOGIN`: emergency switch — `true` allows password sign-in for everyone even when Settings → Authentication turned it off. Keep `false`.
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

### Diagram colours

Diagrams use a colour theme by element type (start/end, rejected end, human task, approval task, system task,
gateway, lanes). The colours are written into the BPMN file as standard BPMN-in-Color attributes (plus the
bpmn.io `bioc:` attributes), so other BPMN tools show them too.

- **Settings → Diagram colours** (Super Admin, next to the organisation name and logo): change the colour of each element kind with a live
  preview, or reset to the default scheme (`docs/samples/README.md`). New elements, type changes and approval
  steps follow the theme; colours a user picked are never overwritten.
- **Apply theme to existing diagrams** colours the elements that have no colour yet in every working model,
  after a dry run with the counts; drafts get a new version "Applied colour theme". Approved and published
  processes whose change is colours only keep their status (version "Theme applied (colours only)") and the
  portal shows the colours at once; otherwise they get a new draft. After an upgrade Super Admins see a
  one-time notice to run it (DEPLOYMENT.md §9).
- In the modeler, the context-pad brush offers the theme colours, a few neutral colours, **Reset to theme**
  and **No colour**. A user task is an approval step when its English label starts with Review, Approve,
  Endorse or Confirm, or when **Step kind** in the element panel says so.
- SVG and PNG exports and the portal's PDF view contain the colours and the fonts. Sample:
  `docs/samples/PMS-01-Program-Request-Approval.bpmn`; screenshots in `docs/screenshots/modeler-design-a/`.

### Modeler workspace (design B1)

- **Edit diagram** / **Open modeler** on a process's Model tab opens the modeler full screen at
  `/processes/:id/model` (`?view=1` read-only, `?element=<id>` selects a step). Top bar: save state, Save
  version, undo / redo, zoom menu (Fit width, Fit page, 100 %, presets), find (Ctrl+F), Auto-layout, View
  (mini-map, badges, grid snapping), focus mode (**F**, Esc leaves), browser full screen, shortcuts (**?**),
  Validation, Versions, Comments, AI, import / export, side panel, Close.
- The side panel opens when you select something, can be closed and resized, and remembers this per user.
- Palette: grouped, searchable (English or Arabic), icons only on demand; **Ready-made steps** (approval step,
  manager review, system step, notification, waiting time, link to sub-process) come labelled in both languages.
- Several shapes selected → align / distribute toolbar. **Auto-layout** re-arranges the diagram (one undo step).
- A lane can be linked to a library Role (Properties of the lane): it shows in Linked objects, the role's
  usage and the portal's "My processes"; steps in the lane get a "performs" suggestion.
- Badges on steps show linked roles, systems, documents, risks, controls and open comments (hover lists them).
- Knowledge Portal: full-width diagram, zoom, mini-map, full screen, badges and **Highlight my steps**; the PDF
  view offers A4 or A3 landscape, logo header, colour legend, page-wide diagram parts and page numbers.
- Screenshots: `docs/screenshots/modeler-design-b1/` (before / after, EN and AR).

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

### Single sign-on and two-step verification

Settings → Authentication (Super Admin): Microsoft Entra ID (tenant ID, client ID, client secret — stored
encrypted) or any OpenID Connect provider (issuer URL), allowed e-mail domains, default role and department
for users created at their first sign-in, group mappings (Entra group object ID → roles / department for new
users; roles are then managed in ProcessHub — "update roles at every sign-in" is off by default), and whether password sign-in stays available (otherwise only a
break-glass Super Admin). Register `APP_URL/api/v1/auth/sso/callback` as redirect URI at the provider;
step-by-step guide for Entra ID: [`docs/DEPLOYMENT.md`](./docs/DEPLOYMENT.md) §6.1.

Users with a password can turn on two-step verification under **My profile** (QR code for an authenticator
app, ten recovery codes). It is required for Super Admin and Admin by default (Settings → Authentication can
change the roles) and always for the break-glass account; administrators can reset it
(**Administration → Users → ⋮ → Reset 2FA**). MFA for single sign-on users is enforced by Entra ID
Conditional Access (DEPLOYMENT.md §6.1). Sessions end after 24 hours without activity
(`REFRESH_TOKEN_TTL_HOURS`).

### Email

Settings → Email (Super Admin): SMTP server, port, TLS, user name, password (stored encrypted, never shown
again), sender. **Send test email** checks the settings. Emails are sent in each recipient's language; users
choose per notification type whether they also want an email (My profile). For a real installation replace
the demo Mailpit settings with your mail server and remove the `mailpit` service if you do not need it.

Data lives in the Docker volumes `postgres-data`, `storage-data` and `api-data`. `docker compose down` keeps them; `docker compose down -v` deletes them.

**Upgrading an installation that used MinIO** (before Phase 6 part 2): run `./scripts/migrate-minio-storage.sh`
once after updating; it copies every file from the old `minio-data` volume into the new storage and verifies it.
Backups: `./scripts/backup.sh` / `./scripts/restore.sh` (see [`docs/DEPLOYMENT.md`](./docs/DEPLOYMENT.md) §7–8).

## Local development (without Docker for the apps)

Requirements: Node.js 22 LTS (22.12 or later), pnpm 10 (`corepack enable`), PostgreSQL 16, and optionally an S3-compatible storage for uploads (e.g. `docker compose up -d storage` with a published port, or any S3 service).

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
node scripts/check-i18n.mjs                           # English / Arabic translations complete (also in CI)
node apps/web/scripts/bundle-report.mjs --budget=250  # after the web build: initial JavaScript ≤ 250 KB gzip
./scripts/backup-drill.sh --yes                       # backup / restore round trip on a test stack (also in CI)
```

**Performance measurements** run against a disposable production-size database: `apps/api/prisma/seed-volume.ts`
(refuses production, needs `VOLUME_SEED=yes`), then `prisma/perf-api.ts` (P50 / P95 of 38 screen endpoints)
and `prisma/perf-schedulers.ts` against a running API — usage in the file headers, results in
[`docs/PROGRESS.md`](./docs/PROGRESS.md).

The Playwright tests (`apps/e2e`) need a Chromium for Playwright 1.56 (`pnpm --filter @processhub/e2e exec
playwright install chromium` once, or `E2E_CHROMIUM_PATH` pointing at an installed Chromium). They cover
sign-in with the Super Admin's first 2FA enrolment, the process house, the full-screen modeler (import of
the PMS-01 sample, a ready-made step, Save version), submit → approve → publish, the Knowledge Portal as
Viewer and Arabic RTL. Each run creates a new process, so the suite can be re-run on the same database; the
admin's 2FA secret and unused recovery codes are kept in `apps/e2e/.auth/` (git-ignored). Every test signs
in from the same address: raise `LOGIN_RATE_LIMIT_MAX` in `.env` (e.g. 1000) on a test stack. CI runs the
suite against `docker compose up` (job "End-to-end").

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
docs/                     PROGRESS.md, DECISIONS.md, BACKLOG.md, SECURITY.md, DEPLOYMENT.md, WORKFLOWS.md,
                          MIGRATION.md, AI-DEMO.md
docker-compose.yml        local trial: postgres, storage, mailpit (demo email), migrate (one-shot), api, web
docker-compose.prod.yml   production: caddy (HTTPS), web, migrate, api, postgres, storage (images from GHCR or built)
deploy/                   Caddyfile, own certificates (optional), daily backup cron example
scripts/                  generate-secrets, backup, restore, backup-drill, migrate-minio-storage, check-i18n
```

## Security highlights

- argon2id password hashing, a configurable password policy, and account lockout after repeated failures (wrong passwords and wrong 2FA codes).
- Single sign-on: OpenID Connect code flow with PKCE, state and nonce (`openid-client`), ID-token signature, issuer, audience and expiry verified; allowed domains; no account takeover by e-mail; tests use a mock identity provider.
- TOTP two-step verification: secret encrypted, codes cannot be replayed, single-use hashed recovery codes; required for Super Admin and Admin by default, configurable per role.
- Short-lived JWT access tokens (15 minutes) and rotating refresh tokens (24-hour idle lifetime, 7-day absolute limit) in `httpOnly; Secure; SameSite=Strict` cookies, with reuse detection. Double-submit CSRF protection bound to the request origin.
- Permissions are checked on the server for every request, and routes are denied by default. The UI only hides what a user cannot do.
- Rate limiting, request size limits, helmet, strict CORS, and a CSP on the web app.
- Production stack: HTTPS with automatic certificates and HSTS (Caddy), only ports 80/443 published, database and file storage on an internal network without internet access, secrets required in `.env` (no defaults), checksummed backups.
- Uploaded logos are type-checked by content and SVGs are sanitised. BPMN imports reject DTDs and entities.
- Wiki content is sanitised with DOMPurify on the server (on save) and again in the browser (on render); images may only point at ProcessHub attachments.
- Attachments: extension allow-list plus a content check, 10 MB limit, stored in the S3-compatible file storage and delivered with a sandboxing CSP, `nosniff` and download disposition for non-images.
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
