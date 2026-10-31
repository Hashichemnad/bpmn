# Progress

Read this together with `CLAUDE.md` at the start of every session.

## Current state — 2026-10-31 (Import tools / migration — module M15, branch `import-tools`, in progress)

Everything up to Phase 5.2 (workflow execution) is merged into `main`. This branch builds module M15: moving DOF's
existing processes, diagrams, SOPs and lists into ProcessHub before go-live — file based only (uploads), no live
connectors (BACKLOG). The session works on `claude/laughing-franklin-koipwl` (the harness branch name) and pushes
the same commits to `import-tools`.

Technical approach (D-155 – D-162): every import is an `ImportBatch` (upload → parse job → preview with mapping and
validation → dry run → apply job → result report → undo) on the existing mining job runner (kinds `IMPORT_PARSE`,
`IMPORT_APPLY`); importers are plug-ins of one registry in `apps/api/src/imports/importers/`; `ImportItem` records
every created / updated entity (undo, re-import matching by code / external id / file name, before/after); imported
entities carry `importBatchId` (the "Imported" flag). Upload security in `apps/api/src/imports/safe-upload.ts`
(content sniffing, size / entry / ratio limits, ZIP-slip, no DTD / entities, macro formats rejected, DOMPurify /
SVG sanitising).

Local setup: as in Phase 5.2 below (PostgreSQL 16, roles / databases, build the shared package first).

Steps (tick as they are committed; a new session continues at the first unticked one):

- [x] 0. CLAUDE.md phase table (5.2 merged, Import in progress), this plan, DECISIONS D-155 – D-162.
- [x] 1. Import Center framework: schema (`ImportBatch`, `ImportFile`, `ImportItem`, `importBatchId` flags),
      permission `import.manage` (+ `export.full` for step 7), shared `imports.ts`, API module `imports` (upload
      security, batches, jobs, dry run, apply, undo, Excel result report, existing GRC / EA / KPI Excel imports as
      batch kinds), web Import Center (list, new batch, batch page), EN / AR, API + security tests, e2e.
      Done: migration `20261031150000_import_tools`; `safe-upload.ts` (+ `safe-upload.spec.ts`, 20 malicious
      samples), `imports.service.ts` (life cycle, undo, report), `importer.ts` (plug-in contract),
      `importers/module-excel.importer.ts` (GRC / EA / KPI registers); web `features/imports/` (Import Center,
      new batch dialog with per-kind options, batch page: progress / cancel, mapping, validation report, dry
      run, preview decisions and suggestions, apply, records, undo); namespace `imports` (EN / AR, generated);
      API tests `test/imports.e2e-spec.ts` (5); Playwright `imports.spec.ts` (register import as a batch).
- [x] 2. Process house, departments and users from Excel / CSV (templates, validation, invitations, 2FA rules).
      Done (D-159): `importers/tabular.ts` (Excel / CSV reader, column mapping, templates),
      `process-house.importer.ts`, `departments.importer.ts`, `users.importer.ts`; migration
      `20261031160000_user_invitations` + `users/invitations.service.ts` / `invitations.controller.ts` (public
      set-password page `/invitation/:token`, "Send invitation again" on the Users page, `UserDto.hasPassword`);
      API tests `test/imports-structure.e2e-spec.ts` (6); Playwright: process house flow in `imports.spec.ts`.
- [x] 3. Diagrams: BPMN (ZIP / files), Visio `.vsdx`, ARIS AML (EPC, value chains, objects), DMN.
      Done (D-160): `importers/bpmn-tools.ts` (vendor strip / keep, labels by script, layout when DI is
      missing), `process-target.ts` (match by code / earlier file / name, draft process creation, library
      suggestions), `bpmn.importer.ts` (models saved through `ModelsService.createVersion`), `visio-tools.ts` +
      `visio.importer.ts` (shape mapping table, swimlanes, unmapped report), `aris-tools.ts` +
      `aris.importer.ts` (roles / systems into the library, EPC and value chain diagrams with links),
      `dmn.importer.ts`; "Imported" flag (`importOrigin`) on process and diagram pages; Visio mapping card on
      the batch page; samples `docs/samples/import/` (`generate-samples.mjs`); API tests
      `test/imports-diagrams.e2e-spec.ts` (7); Playwright: BPMN ZIP and Visio flows in `imports.spec.ts`.
- [ ] 4. Documents into the wiki: Word, PDF, Confluence HTML export, Markdown folders; links to processes.
- [ ] 5. AI-assisted migration: SOP → BPMN review queue, risks / controls extraction, bulk translation.
- [ ] 6. Migration dashboard and review queue (My tasks, bulk actions).
- [ ] 7. Full export package + import into an empty installation (round-trip test).
- [ ] 8. Samples `docs/samples/import/`, screenshots, `docs/MIGRATION.md`, README, final checks, PR.

## Previous state — 2026-10-31 (Phase 5 — Part 2: Workflow execution, branch `phase-5-2-workflow-execution`, merged into `main`)

Everything up to Phase 5.1 (process mining and simulation) is merged into `main`. This branch builds module M14:
run approved processes as task flows with forms, assignments, approvals, SLAs and monitoring. The session works on
`claude/bold-carson-w7ahi4` (the harness branch name) and pushes the same commits to
`phase-5-2-workflow-execution`.

Technical approach (D-144 – D-150): own TypeScript engine (pure `step(model, state, vars, command)`) in
`packages/shared/src/workflow/` with an S-FEEL evaluator and a server-side DMN evaluator; schema-driven Ant Design
forms (no form-js); execution settings in the BPMN XML (`ph:exec` JSON + standard conditions / timers) and
operational settings in `WorkflowProcessConfig`; deployments pin the published version; cases, tasks, jobs (timers)
and the timeline in PostgreSQL with optimistic locking; business calendar = central holidays + central working week.

Local setup: PostgreSQL 16 (`service postgresql start`; create role `processhub` / `devpassword` and databases
`processhub`, `processhub_test` if missing); API suites `npx jest --runInBand test/<file> --selectProjects e2e`
(build the shared package first: `cd packages/shared && npx tsc -p tsconfig.build.json`).

Steps (tick as they are committed; a new session continues at the first unticked one):

- [x] 0. CLAUDE.md phase table (5.1 merged, 5.2 in progress), this plan, DECISIONS D-144 – D-150.
- [x] Backend for steps 1–5 (one commit; the web UI follows step by step): shared `packages/shared/src/workflow/`
      (`feel.ts` S-FEEL, `dmn.ts` server DMN, `forms.ts`, `model.ts` reader + `ph:exec` schemas, `check.ts`
      executable check, `engine.ts` pure engine, `calendar.ts`, `templates.ts`, `api.ts` DTOs; 26 unit tests in
      `workflow.test.ts`); migration `*_workflow_execution` (WorkflowProcessConfig, WorkflowDefinition,
      WorkflowCase, WorkflowTask (+Candidate), WorkflowJob, WorkflowEvent, WorkflowFile, WorkflowCaseComment,
      WorkflowCaseCounter, User out-of-office, EventLogSource WORKFLOW); permissions
      `workflow.design|start|monitor|admin` (role bundles in D-149); notification type `WORKFLOW` (EN / AR e-mail
      templates); API module `apps/api/src/workflow/` (config / check / deploy, runner with optimistic locking,
      assignment, cases, tasks, jobs + timers + reminders / escalation + retention, monitor / dashboard / Excel, live
      event log, Word documents); `WORKFLOW_POLL_SECONDS`; demo model builders `prisma/workflow-bpmn.ts`,
      `prisma/workflow-demo.ts`; API tests `test/workflow.e2e-spec.ts` (20) + authorization matrix / route security
      updated, SECURITY.md route table regenerated.
- [x] 1. Executable processes (web): `features/workflow/` — `ExecutionPanel` (modeler tab "Execution", visible
      when the process is executable: start / task forms, assignment rules, due time, four-eyes, escalation,
      approval outcome and condition / default on flows with S-FEEL syntax check and data chips, timers, boundary
      interruption, error codes, notification and document templates, set data), `FormEditor` (field list,
      drawer, bilingual preview with `LocaleOverride`), `WorkflowForm` / `FormValues` (renderer, read-only view),
      `ExecIssueList` (executable check in the Validation panel, client side; server check on deploy),
      `WorkflowConfigCard` (process page tab "Execution": executable, prefix, start rights, withdraw, monitors,
      retention, live event log, deploy, deployments); `ph:exec` in the moddle descriptor; `api/workflow.ts`;
      namespace `workflow` (EN / AR, generated from the scratch translation tables), errors, audit labels,
      `WORKFLOW` notification texts. Playwright: covered by `workflow.spec.ts` (written with step 3, see below).
- [x] 2. Assignment, tasks and inbox (web): "My tasks" → **Workflow tasks** (assigned / group, due filter, search,
      due colouring, claim) in the workspace and the portal, task page (form, approve / reject / return with a
      mandatory comment, complete, save draft, claim / give back, delegate, admin reassign, four-eyes notice,
      diagram), out of office in the profile, Settings → Workflow execution (working week, hours, zone,
      reminder, escalation). Assignment, calendar, reminders and escalation are in the backend commit.
- [x] 3. Starting and following cases (web): portal **Services** (catalogue) and start form, request page (diagram
      with current / completed steps, current steps, data per step read-only, files incl. the generated letter,
      timeline, comments with @mentions, withdraw / cancel / retry), **My requests** (portal and workspace),
      Viewers redirected to portal equivalents, navigation in both layouts.
- [x] 4. Monitoring (web): **Workflow monitor** (per process counts, stuck requests with retry / cancel, overdue
      tasks with reassign, all requests), **Workflow dashboard** (tiles, trend chart, steps SLA, workload by user /
      role / department, most overdue, Excel); live event log linked from the process page.
- [x] 5. Security and data: permissions `workflow.*` on every route (route-security table regenerated,
      authorization matrix watches the workflow tables and allows only own-data reads for Viewers), case
      visibility tests (initiator, assignees, owner, monitors, Auditors read-only), retention (D-152), template
      text-only rendering, audit of deploy / start / complete / claim / delegate / reassign / withdraw / cancel /
      retry / export.
- [x] 6. Demo data and docs: `prisma/seed-workflow.ts` (PMS-01 + DMN-002 + HR-01, five demo users, 7 requests
      through the real services, back-dated), `prisma/perf-workflow.ts` (D-153), screenshots EN / AR in
      `docs/screenshots/phase-5-2/` (`screenshots-phase-5-2.spec.ts`, `SCREENSHOTS=1`), `docs/WORKFLOWS.md`, README
      (feature table + tour), CLAUDE.md, DECISIONS D-144 – D-153, BACKLOG, DEPLOYMENT step 12, SECURITY checklist.

Measured (D-153, 10,000 open requests, 500 users): start 44 ms, completion 60 ms, inbox 18 ms, monitor 29 ms,
dashboard 633 ms, job poll 9 ms.

Verification on 2026-10-31: shared 220, web 91, API 428 tests pass (62 suites, incl. `workflow.e2e-spec.ts` 20);
Playwright `workflow.spec.ts` (4) and the screenshot spec pass locally against API + Vite dev server + a local S3
stand-in (s3rver) — no Docker daemon in this sandbox; lint, format, type-check clean; `pnpm audit --audit-level high
--prod` clean (9 moderate, as before). **Not verified here:** Docker image builds and the full Playwright suite in
Docker (CI runs both).

Product owner answers (D-154), implemented afterwards: deploy only by the process's own Process Owner and workflow
admins (Modelers set up, cannot deploy or switch a deployed process off / change its start rights); escalation
fallbacks to the process owner (unclaimed group task, assignee without a manager or who is the department head);
reminder and escalation delays per process (migration `20261031140000_workflow_delays`); seed test asserts no
workflow demo users without `SEED_DEMO_DATA=true`; Portal → My tasks keeps its tab order and opens
`?tab=workflow` (fixed the questionnaire e2e test). API `workflow.e2e-spec.ts` 21 tests.

### Next (continue here)

1. Review and merge the pull request `phase-5-2-workflow-execution` → `main` (CI: lint/test, e2e, Docker).
2. Then Phase 4.4 (integrations, incl. REST service tasks), M15 migration; final performance / polish session.

## Previous state — 2026-10-31 (Phase 5 — Part 1: Process mining and simulation, branch `phase-5-1-mining-simulation`, done — awaiting review)

Everything up to the diagram types is merged into `main`. This branch builds module M13 (process mining) and
simulation — Signavio Process Intelligence / ARIS Process Mining parity, DOF RFP analysis items. Workflow execution
(M14) is Phase 5.2; connectors that pull logs from other systems stay in BACKLOG (integrations). The session works
on `claude/lucid-dirac-tw2e44` (the harness branch) and pushes the same commits to `phase-5-1-mining-simulation`.

Technical approach (D-128): everything in TypeScript — algorithms in `packages/shared/src/mining/` with unit tests
against small published logs, no Python service; heavy work (import, analysis of large logs, simulation runs) runs as
**mining jobs** (`MiningJob`: queued / running / done / failed / cancelled, progress, cancel) off the request thread —
CPU work in worker threads that load the shared package, I/O (streaming parse, batched inserts) in async chunks —,
with a result cache per log data version and filter set.

Local setup: PostgreSQL 16 (`service postgresql start`; role `processhub` / `devpassword`, databases `processhub`,
`processhub_test`); API suites `npx jest --runInBand test/<file> --selectProjects e2e`.

Steps (tick as they are committed; a new session continues at the first unticked one):

- [x] 0. CLAUDE.md phase table (diagram types merged; Phase 5 split into 5.1 / 5.2), this plan, D-128 approach.
- [x] 1. Event logs — import and data (D-129 – D-132): `EventLog` / `MiningEvent` / `MiningActivity` /
      `EventLogGrant` / `MiningJob` / `MiningResultCache` / `MiningMappingTemplate` / `MiningFilterPreset` (migration
      `20261031080623_mining_event_logs`), permissions `mining.read` / `mining.manage` (bundles in D-131), Setting
      `mining`; shared `mining/` (timestamps with format detection and IANA zones, columnar `LogData` + binary
      snapshot, label matching, schemas, worker task registry `runMiningTask`); API module `mining`:
      `MiningJobsService` (queue, progress, cancel, long-poll `GET /mining/jobs/:id?wait=`, restart cleanup),
      `runInWorker` (inline worker loading the compiled shared package), streaming readers (csv-parse, exceljs, saxes),
      `RowNormaliser` (validation report, duplicates, pseudonyms), import / validate / delete jobs, snapshot in the
      file storage (gzip, LRU, rebuild from events), ProcessHub reviews source, activity auto-match (labels + dictionary
      synonyms) and manual mapping, grants, templates, retention via `MiningScheduler`; nginx / Caddy 210 MB on the
      upload route, `MINING_UPLOAD_MAX_MB`, `MINING_WORKERS`. Web: menu "Process mining → Event logs", logs list,
      "Create log from ProcessHub" dialog, import wizard (upload → mapping with preview, templates, delimiter / sheet,
      time zone, pseudonymise → validation report → import progress), log page (overview + report, activities ↔
      steps, access), EN / AR. Tests: shared 8 (`mining/import.test.ts`), API 7 (`mining-logs.e2e-spec.ts`),
      Playwright `mining.spec.ts` (import CSV with mapping → validation → import → Arabic → viewer denied).
      Note: API tests run the worker on `packages/shared/dist` — build the shared package after changing it.
- [x] 2. Discovery and analysis (D-133, D-134): shared `mining/filters.ts` (stackable case filters, variant ids),
      `mining/analysis.ts` (`analyseLog`: DFG frequency / performance with activity projection, variants, statistics,
      rework, resources, handovers, bottlenecks with slow cases), `mining/heuristics.ts` (heuristics miner, AND / XOR,
      loops, `netToStructure`); worker tasks `analyse` / `discover`. API `MiningAnalysisService`:
      `POST /mining/logs/:id/analysis` (cache `MiningResultCache`, job + 8 s wait, deduplicated), `POST …/export`
      (Excel, audited), filter presets per user (`/mining/logs/:id/presets`, `DELETE /mining/presets/:id`),
      `POST …/discover` (new draft process with lanes via `structureToBpmn`). Web: log tabs Process map (dagre SVG,
      frequency / performance, activity slider server side, path slider, zoom, variant highlight), Variants (share,
      times, expand with example cases, compare two with LCS diff, show on map), Statistics (tiles, weekly / monthly
      trend, histogram, rework, resources, handover graph + department table), Bottlenecks (slowest transitions /
      activities, waiting share, slow cases → case drawer), filter bar (8 filter types, saved filters), Excel buttons,
      "Generate BPMN" dialog. Tests: shared +9 (`mining/discovery.test.ts`: L1 DFG, projection, durations, rework,
      filters, heuristics on L1, AND / XOR, loops), API 4 (`mining-analysis.e2e-spec.ts`), Playwright `mining.spec.ts`
      extended (map, performance, attribute filter, variants on map + compare, statistics, bottlenecks).
- [x] 3. Conformance (D-135 – D-137): shared `mining/conformance.ts` (`bpmnToPetriNet`, `replayTrace`,
      `checkConformance`: fitness, conforming cases, skipped / inserted / wrong-order deviations with example cases,
      per-step stats, flow counts, unobserved steps), `mining/kpis.ts` (`miningKpiSeries`), worker tasks
      `conformance` / `miningKpis`; KPI data source `EVENT_LOG` + `Kpi.miningLogId` + `MINING_METRICS` (migration
      `20261031*_mining_kpis`). API `ConformanceService` (`POST /mining/logs/:id/conformance` cached per model hash +
      mapping, `GET /mining/processes/:id/logs`, `GET|POST /mining/logs/:id/step-suggestions[/apply]` → new process
      version via `setPhAttributes`), `MiningKpiService` (job after import / daily / `POST /mining/kpis/:id/recalculate`).
      Web: Conformance tab (fitness gauge, conforming share, deviations with example cases, unobserved steps, planned
      vs measured step times with apply + change note, "Show on the model"), modeler "Colour by → Mining: cases per
      step / measured time / deviations" (+ simulation modes prepared) with step / flow badges and flow widths
      (`applyMetricOverlays`, `useMetricValues`, `?colourBy=&log=`), KPI form "Calculated from an event log" and
      Recalculate. Tests: shared +4 (`mining/conformance.test.ts` incl. the textbook replay example), API 4
      (`mining-conformance.e2e-spec.ts`: replay, suggestions → version, mining KPIs, XML attributes), Playwright
      `mining.spec.ts` "conformance: deviations and the overlay on the BPMN model".
- [x] 4. Simulation (D-138 – D-140): shared `mining/simulation.ts` (scenario schema, Mulberry32, distributions,
      `WorkCalendar` Sun–Thu / Mon–Fri / 24·7 with holidays, `validateScenario`, `simulate`: arrivals, lanes as
      resources with FIFO queues, gateways incl. inclusive joins, planned waiting, SLA, costs, weekly series),
      `UAE_HOLIDAYS`; `Simulation` / `SimulationScenario` (migration `*_simulation`); API `/simulations` (CRUD,
      scenarios, defaults from mining, run → `SIMULATE` jobs, Excel comparison, AI explain / suggest via
      `AiGatewayService`, feature `SIMULATION`). Web: menu "Process mining → Simulations", list + new dialog, simulation
      page (scenario cards with validation messages, copy as to-be, drawer editor: general / calendar / holidays /
      steps with distributions and costs / resources / branch probabilities; run all with progress; comparison
      table + Recharts; AI explain and proposals → "Create scenario"), modeler "Colour by → Simulation: utilisation /
      waiting time". Tests: shared 8 (`mining/simulation.test.ts`: M/M/1, M/M/2, reproducibility, branching,
      fork / join, calendar, distributions, validation), API 3 (`mining-simulation.e2e-spec.ts`), Playwright
      `mining.spec.ts` "simulation: as-is and to-be scenarios, comparison and bottleneck view".
- [x] 5. Portal, reports, demo data, tests, docs (D-141, D-142):
  - Portal "Performance" section on published processes (Setting `mining.portalPerformance`, off by default;
    `GET /mining/portal/processes/:id/performance`, aggregated only) and the mining settings dialog (retention,
    portal, concurrency, time zone; Super Admin) on the event log list.
  - Handbook option "Performance analysis" (`includePerformance`, `MiningReportService`: mining summary of the most
    recent visible log + the latest simulation's scenarios).
  - Demo seed `prisma/seed-mining.ts` (demo installations only, once): process **S.01.04 Invoice processing**
    (lanes, step attributes), **LOG-001** 5,000 generated cases / 27,585 events (`prisma/demo-event-log.ts`: rework
    loop, finance approval bottleneck, payments without PO matching, late approvals) with mapped activities,
    **KPI-M01 Invoice cycle time** (EVENT_LOG, monthly values), **SIM-001** with as-is, _Second finance approver_
    and _Automatic PO matching_ (results computed in the seed). Asserted in `seed.e2e-spec.ts`.
  - `docs/samples/invoice-processing-log.csv` (200 cases) / `.xes` (40 cases, start / complete) + README section on
    the column format (`prisma/generate-mining-samples.ts`).
  - Authorization matrix: watches the mining / simulation tables, fills the routes with the demo log, simulation and
    scenario; read-only POSTs (analysis, conformance, export, own filters, AI explanations) are allowed for readers.
    `docs/SECURITY.md` route table regenerated; route-security allow-list has the upload route.
  - Performance script `prisma/perf-mining.ts` (timings below, D-141); screenshots EN / AR in
    `docs/screenshots/phase-5-1/` (spec `screenshots-phase-5-1.spec.ts`, `SCREENSHOTS=1`): import mapping, process
    map, variants, statistics, conformance, conformance overlay on BPMN, simulation scenarios, comparison, bottleneck
    view.
  - Docs: README (feature table, Phase 5.1 tour), CLAUDE.md (phase table, data model), DECISIONS D-128 – D-142,
    BACKLOG (Phase 5.1 follow-ups), DEPLOYMENT.md (sizing / upload limit / retention note), `.env.example*`.
    csv-parse upgraded to 7.0.2 (GHSA-8cw4-87c7-c6xx).

Measured timings (D-141, `npx ts-node --transpile-only prisma/perf-mining.ts 180000` in this sandbox, PostgreSQL 16
local, Node 22): 994,022 events / 180,000 cases (CSV 92 MB) — import (stream parse + validate + batched inserts)
115 s, of which inserts 96 s; snapshot 39 MB (6 MB gzip) in 1.8 s, decode < 0.1 s; analysis bundle 1.2 s (with a
filter and the activity slider 0.2 s); heuristics miner < 0.1 s; token replay 0.6 s; case drill-down 0.1 s; delete
8.9 s. Simulation: 90 days of the demo (≈ 2,100 cases) in well under a second; the M/M/1 unit test (~110,000 cases)
in a few seconds.

Verification on 2026-10-31: shared 192, web 91, API 407 tests pass (64 suites; the only failure of the first full
run was the regenerated SECURITY.md table, fixed); Playwright `mining.spec.ts` (import → map / filters / variants /
statistics / bottlenecks; conformance → overlay; simulation → comparison → bottleneck view) passes locally; lint,
format, type-check clean; `pnpm build` succeeds; `pnpm audit --audit-level high --prod` clean (9 moderate, as
before). **Not verified here:** Docker image builds and the full Playwright suite in Docker (CI runs both).

Product owner answers (D-143), implemented afterwards: event log access stays narrow (owner / department / grants
/ Super Admins); retention off by default, set at go-live (suggested 24 months, DEPLOYMENT §6 step 11, SECURITY §7);
portal "Performance" off until real logs exist; **central public holiday list** (Setting `mining.holidays`,
`GET|PUT /simulations/holidays`, editor in Simulations → _Public holidays_ and Settings, Islamic holidays
"expected (moon sighting)" until confirmed) used by every scenario unless it switches to its own list
(`calendar.useCentralHolidays`); a change marks results that used it as stale. Tests: shared +2, API +1.

### Next (continue here)

1. Review and merge the pull request `phase-5-1-mining-simulation` → `main`.
2. Then Phase 5.2 (workflow execution), Phase 4.4 (integrations, incl. log connectors), M15 migration; final
   performance / polish session last.

## Previous state — 2026-10-31 (More diagram types, branch `diagram-types`, done — awaiting review)

Everything up to Phase 4.3 (GRC, EA, KPIs) is merged into `main`. The Salesforce KPI sync stays in the code but is not
used (DOF manages KPIs and risks inside ProcessHub). External integrations (API keys, webhooks, Salesforce risk /
Oracle connectors, XPDL) stay in BACKLOG (Phase 4.4). This branch adds more diagram types (ARIS / GBTEC / Signavio
parity, DOF RFP modeling items) on one shared diagram framework (D-120). The session works on
`claude/tender-mccarthy-pqtk1j` (the harness branch) and pushes the same commits to `diagram-types`.

Local setup: PostgreSQL 16 (`service postgresql start`; role `processhub` / `devpassword`, databases `processhub`,
`processhub_test`); API suites `npx jest --runInBand test/<file> --selectProjects e2e`.

Steps (tick as they are committed; a new session continues at the first unticked one):

- [x] 0. CLAUDE.md phase table (4.3 merged, row "Diagrams"), this plan, D-120 design.
- [x] 1. Shared diagram framework (D-120): `Diagram` / `DiagramVersion` / `DiagramLink` (migration
      `20261031023651_diagram_types`), `ContentType` `DIAGRAM` through governance (reviews, workflows, publications,
      dashboard, My tasks, reminders), comments on elements, feedback, notifications, portal (list, view, search,
      home counts) and the review compare (`kind: 'DIAGRAM'`); shared `diagrams.ts` (types, zod content schemas for
      graph JSON / SIPOC, DMN checks, element / text / reference helpers, DTOs); API `/diagrams` (CRUD with generated
      codes VC-001 …, content with validation + link pruning, versions / restore / label, links, where used),
      `/portal/diagrams`, DMN XML safety checks; permissions as processes. Web: shared diagram-js kit
      (`features/diagrams/kit/`: notations, shapes, renderer with theme colours and bilingual labels, rules, layout +
      cropping, undoable property command, direct label editing in the active language, keyboard, context pad,
      import / export JSON, SVG export), `DiagramWorkspace` shell (autosave, Save version, undo / redo, versions
      drawer with view / compare / label / restore, export SVG / PNG / PDF, Links and Comments tabs), `GraphEditor`
      (palette, properties, zoom / fit / mini-map, align / distribute), `DiagramView` / `DiagramCompare`
      (side by side with added / changed / removed markers), diagram page `/diagrams/:id` (preview, governance,
      details, links, where used, comments), workspace `/diagrams/:id/edit`, print `/print/diagrams/:id` and
      `/portal/print/diagrams/:id`, portal `/portal/diagrams` (+ `:id` with drill-down), repository tree with type
      icons and a "Diagrams" group, "New" menu (process + each type). dmn-js 17.12.3, feelin 8.2.0 added (used in
      step 4). Tests: shared +3, web +3, API 3 (`diagrams.e2e-spec.ts`).
- [x] 2. Value chain (D-121): notation (chevrons, blocks with row, group frames, arrows, theme colours), element
      link to a process or another value chain (properties panel, ↗ open button), process facts API
      `GET /diagrams/process-facts` (status, department, KPI worst status with `kpi.read`, highest residual risk with
      `grc.read`), badges, "Colour by" (status / KPI / residual risk / department, view only, legend), "Generate from
      process house" (shared `generateValueChain`, New dialog + workspace tool), portal drill-down to published
      processes / value chains. Fix: view refreshes no longer fire `elements.changed` (it cancelled create drags);
      initial import runs once per editor instance. Tests: shared +2 (`value-chain.test.ts`), web +2 (colour by),
      API +1 (process facts), Playwright `diagrams-value-chain.spec.ts` (create from house → edit → version → submit →
      approve ×2 → publish → portal drill-down → Arabic).
- [x] 3. Organisation chart (D-122): units / positions / persons, reporting and staff lines; `GET /diagrams/org-source`
      (departments, positions from Role `departmentId` attribute or job-role holders, people), shared
      `generateOrgChart` (comb layout, deterministic ids) and `mergeOrgChart` (merge by id, manual edits kept);
      New dialog option + workspace "Regenerate" with preview (counts, removals / renames, merged chart); position
      panel with the steps it performs and RACI letters (`GET /diagrams/role-activities/:roleId`); unit → department,
      person → user fields; Role form "Department" field; demo roles get departments. Tests: shared +2, API +1,
      Playwright `diagrams-org-chart.spec.ts` (generate → position RACI → edit → regenerate → version → publish via
      API → portal). Handbook section: step 7.
- [x] 4. DMN decision tables (D-123): dmn-js 17.12.3 editor in the shared workspace (DRD + decision tables, view
      switcher, import / export `.dmn`), bilingual names (`ph:nameEn` / `ph:nameAr`, annotations
      `ph:annotationEn` / `ar`; active language in the editor, other language in the Translations panel), Test panel
      (feelin 8.2.0, all hit policies, matching rows highlighted), Validation panel, read-only `DmnView` in the active
      language; BPMN business rule task → `ph:decisionRef` / `ph:decisionId` (modeler panel with "View table"),
      portal step shows the published table, where used lists the steps (`DECISION`); sample
      `docs/samples/approval-authority.dmn`. ph namespace aligned with the BPMN extension
      (`http://processhub.io/schema/bpmn`). Tests: web +4 (`dmn-model.test.ts`), API +1, Playwright
      `diagrams-dmn.spec.ts` (import → test decision → version → link from a business rule task → publish → portal).
- [x] 5. EPC (D-124): ARIS notation and rules (assignments only between functions and resources), Validation panel
      with the syntax rules (shared `epcIssues`, warnings outlined on the canvas, click selects), resource → library
      object and process path → process fields, "Convert to BPMN" (`POST /diagrams/:id/convert-to-bpmn`, shared
      `epcToBpmn` + the AI builder's `structureToBpmn` layout) creating a new draft process with lanes, gateways,
      branch labels and object links, mapping report in the dialog. Kit: imported connections without waypoints are
      laid out and cropped at the outlines (also in viewers). Tests: shared +3 (`epc.test.ts`), API +1, Playwright
      `diagrams-epc.spec.ts` (warnings → version → convert → BPMN model → publish → portal in Arabic).
- [x] 6. SIPOC (D-125): editable five-column table in the shared workspace (bilingual items, add / reorder /
      delete, undo / redo, step-count warning), SVG / PNG export (`sipoc-svg.ts`, RTL in Arabic), shared
      `generateSipoc` (main path, step attributes, lanes and pools) in the New dialog and as a workspace tool.
      Tests: shared +2 (`sipoc.test.ts`), Playwright `diagrams-sipoc.spec.ts` (generate from PMS-01 → add a customer →
      version → publish → portal). Handbook section: step 7.
- [x] 7. Reports, portal, demo data, tests, docs:
  - [x] 7a. Handbook sections (D-126): options "Place in the value chain", "SIPOC", "Linked decision tables (DMN)",
        "Organisation chart excerpt" (`handbookSchema` flags, `DiagramReportService` in the reports module — working
        or published diagram content —, docx sections EN / AR, shared `readDmnTables`); portal start page
        (Setting `portal.startDiagramId`: a published value chain first on the portal home, with drill-down;
        `PortalDiagramCanvas`), diagrams in "Featured" and in the home counts. Tests: API +1 (handbook sections).
  - [x] 7b. Demo seed (`prisma/seed-diagrams.ts`, demo installations only, once): VC-001 enterprise value chain
        (generated from the process house, published, portal start page), ORG-001 generated from the demo
        departments / roles / people (published), DMN-001 approval authority (`prisma/demo-dmn.ts` = the docs
        sample, published) linked to the business rule task of the new demo process S.01.02 Purchase approval,
        EPC-001 purchase request with its conversion S.01.03, SIPOC-001 of S.01.01; demo roles R-02 – R-06 get a
        department. Asserted in `seed.e2e-spec.ts`.
  - [x] 7c. Permission tests: the authorization matrix watches `Diagram` / `DiagramVersion` / `DiagramLink` and sweeps
        every `/diagrams` write route (incl. `convert-to-bpmn`) and the governance routes with `:type = diagrams` as a
        Viewer / Auditor; `docs/SECURITY.md` route table regenerated. Full test run (below).
  - [x] 7d. Screenshots EN / AR of every type in the editor and the portal (`docs/screenshots/diagram-types/`, spec
        `screenshots-diagram-types.spec.ts`, `SCREENSHOTS=1`); sample handbook of S.01 Procure to Pay with the new
        sections (`docs/samples/S-01-handbook-diagrams-en|ar.docx`). Fixed on the way: the read-only workspace
        (`?view=1`) failed with "No provider for commandStack"; Arabic labels on graph shapes were drawn leftwards
        from the line start (now `text-anchor: end` with `direction: rtl`).
  - [x] 7e. Docs (README tour, CLAUDE.md phase table + data model, BACKLOG diagram follow-ups, DECISIONS D-120 –
        D-126, SECURITY route table), audit, build, pull request.

Verification on 2026-10-31: shared 163, web 91, API 387 tests pass (57 suites; the API `test` scripts now run
Jest with `--max-old-space-size=4096` — the in-band run reached Node's default 2 GB heap after ~55 suites);
Playwright diagram specs (value chain 5, org chart 3, DMN 3, EPC 3, SIPOC 2) and `reports.spec.ts` pass locally;
lint, format and type-check clean; `pnpm build` succeeds; `pnpm audit --audit-level high --prod` clean (9 moderate,
unchanged). **Not verified here:** Docker image builds and the full Playwright suite in Docker (no Docker daemon in
this sandbox; CI runs both).

### Next (continue here)

1. Review and merge the pull request `diagram-types` → `main`.
2. Product owner answers recorded (D-127): process permissions for diagrams and warning-only EPC / DMN checks
   confirmed (mandatory checks via the conventions gate in BACKLOG); the value chain portal start page stays off in
   production until the real value chain is published (DEPLOYMENT.md §6 step 10). CI fix after the first PR run:
   the value chain / EPC e2e specs clicked the canvas within diagram-js's 400 ms ghost-click trap after a palette
   create (fast CI runner) — they now end label editing with Enter.
3. Then Phase 4.4 (Integration & export — BACKLOG), M15 migration, Phase 5; final performance / polish session last.

## Previous state — 2026-10-31 (Phase 4 — Part 3: EA, KPIs and the Salesforce KPI link, branch `phase-4-3-ea-kpi`, merged into `main`)

Everything up to Phase 4.2 (GRC core and assurance) is merged into `main`. This branch builds module M11 (enterprise
architecture: application catalogue, interfaces, data objects, capability map, traceability) and M12 (KPIs,
measurements, dashboards, Salesforce KPI link) — DOF RFP §4.4 / §4.6. Oracle Fusion overlay and other connectors stay
in BACKLOG (Phase 4.4). The session works on `claude/amazing-meitner-tj41n1` (the harness branch) and pushes the same
commits to `phase-4-3-ea-kpi`.

Local setup: PostgreSQL 16 (`service postgresql start`; role `processhub` / `devpassword`, databases `processhub`,
`processhub_test`); API suites `npx jest --runInBand test/<file> --selectProjects e2e`.

Steps (tick as they are committed; a new session continues at the first unticked one):

- [x] 0. CLAUDE.md phase table (4.1 / 4.2 merged, 4.4 added), this plan.
- [x] 1. IT architecture data model and workspace (M11, D-107 – D-109): `Application` 1:1 on the SYSTEM library
      objects (migration backfills rows; ids / links / badges kept; `/library/systems` → `/ea/applications`),
      `AppInterface` (+ data objects carried), `DataObject` + `DataObjectUsage` (CRUD matrix, system of record),
      `Capability` (levels 1–3, moves recompute levels) with `CapabilityProcess` / `CapabilityApplication`;
      permissions `ea.read` / `ea.edit` / `ea.admin`, role `ENTERPRISE_ARCHITECT` (+ demo user
      `architect@processhub.local`); API `/ea/applications|interfaces|data-objects|capabilities` (+ Excel
      export / template / import per catalogue, shared `common/excel.ts`), all audited. Web: Architecture menu
      (Capabilities with list + basic map, Applications list / detail, Interfaces, Data objects with CRUD matrix),
      generic `components/ExcelMenu.tsx`. Tests: API 4 (`ea.e2e-spec.ts`), Playwright 1 (`ea.spec.ts`).
- [x] 2. EA views and traceability (D-110): `GET /ea/capability-map` (roll-up metrics: processes, applications,
      lifecycles, highest residual risk), `/ea/landscape` (filters + neighbours), `/ea/trace` (+ Excel),
      `/ea/applications/:id/impact` (+ Excel EN / AR). Web: capability map with colour-by (coverage, number of
      applications, lifecycle, risk rating) and detail drawer; Landscape page (SVG, layered layout
      `landscape-layout.ts`, RTL, export SVG / PNG); Traceability page; "Impact analysis" tab on the application;
      modeler "Colour by → Application lifecycle"; handbook option "Systems and data". Tests: API +1, web +3
      (layout 2, colour-by 1), Playwright +1.
- [x] 3. KPIs (M12, D-111 – D-113): `Kpi` 1:1 on the KPI library objects (migration backfills; `/objects` refuses
      KPI), `KpiPeriodTarget`, `KpiMeasurement`, `StrategicObjective`, `KpiObjective` / `KpiCapability` / `KpiRisk`
      (key risk indicators); step / process links via `MEASURES`; shared `kpi.ts` (periods, `kpiRag`, calculated
      process KPIs); permissions `kpi.read` / `kpi.edit` / `kpi.measure` (owners); API `/kpis` (catalogue, values,
      evidence via the assurance file store, recalculate, objectives, process view, tasks, settings, Excel for
      kpis / measurements / objectives), `KpiScheduler` reminders (notification `KPI`). Web: Performance menu
      (KPIs register with status + sparkline, KPI page with Recharts chart, value entry with status preview and
      evidence, objectives tree, settings modal), My tasks "KPI values to enter". Demo seed `seed-ea-kpi.ts`
      (12 applications, 10 interfaces, 7 data objects, 17 capabilities, 2 objectives, 8 KPIs × 12 months, KRI on
      RSK-03) — pulled forward from step 6 for the e2e tests. Tests: shared 3, API 5 (`kpi.e2e-spec.ts`),
      Playwright 1 (`kpi.spec.ts`).
- [x] 4. KPI dashboards (D-113): `GET /kpis/scorecard` (+ Excel; filters department / process / owner / as-of
      month), KPI dashboard page (tiles → filtered register, scorecard by objective with status, value, target,
      sparkline, drill-down drawer with the chart); process page "Performance" card (KPIs + calculated process
      KPIs); modeler "KPIs" tab (link / unlink), KPI badge (worst status), "Colour by → KPI status" (also in the
      preview); portal KPI section behind Setting `kpi.showInPortal` (live links, published steps only). Tests: API
      +1, Playwright +1 (helper `loginAdmin` with the stored TOTP secret).
- [x] 5. Salesforce KPI link (D-114 – D-116): module `salesforce` — `SalesforceHttp` (read-only transport),
      `SalesforceClient` (client credentials / JWT bearer, SOQL with paging, describe), settings with sealed
      secrets (Super Admin only), configurable mapping (defaults = documented PMS model), preview / sync by
      Salesforce Id, `SalesforceSyncRun` log, schedule via `KpiScheduler`, failure notifications to Super Admins;
      read-only Salesforce fields / values on KPIs. Web: `/settings/salesforce` (connection, test, schedule,
      mapping with "Load fields", preview, sync, log), admin menu item, link card on Settings. DEPLOYMENT.md §6.4
      (integration user, read-only permission set, connected app). CI: e2e `.env` gets an encryption key and
      `OUTBOUND_ALLOWED_HOSTS=…,host.docker.internal`; compose `extra_hosts` for the API. Tests: API 3
      (`salesforce.e2e-spec.ts`, fixtures), Playwright 1 (`salesforce.spec.ts` + `salesforce-mock.ts`).
- [x] 6. Demo data, permission tests, e2e, screenshots, docs: demo seed (step 3) asserted in `seed.e2e-spec.ts`;
      authorization matrix watches the new tables and sweeps every `/ea`, `/kpis` and `/integrations/salesforce` write
      route as a Modeler; screenshots EN / AR in `docs/screenshots/phase-4-3/` (spec `screenshots-phase-4-3.spec.ts`,
      `SCREENSHOTS=1`); e2e helper `loginAdmin` (stored TOTP secret, waits for a fresh code); README tour, CLAUDE.md
      (roles, data model, phase table), BACKLOG (4.3 follow-ups, Phase 4.4), DEPLOYMENT.md §6.4; Recharts in its own
      chunk.
- [x] 7. Product owner answers (D-117 – D-119): Salesforce mapping per the documented PMS model —
      `Org_Kpi_Measure__c` yearly targets (target of the year's last period; annual KPIs also the value),
      `Org_Kpi_Process__c` results only with `Approved__c = true` (Setting `includeUnapproved`, off), causality and
      corrective actions in the comment, half years (`SEMI_ANNUAL`, `2026-H1`), picklist values linkable to existing
      objectives, process mapping removed; role **Performance Officer** (`PERFORMANCE_OFFICER`, permission
      `kpi.sync`: settings read-only, preview, sync, log; demo user `performance@processhub.local`; Admins do not
      get `kpi.sync`); scheduled syncs by the system actor "Salesforce sync" (no user id on runs / records / audit
      entries) with **configured by** on the run and in the audit summaries, independent of that admin being active;
      failure notices to Super Admins + `kpi.sync` holders; portal KPI values show period and last-updated date.
      Migration `20261031011406_kpi_owner_answers`. DEPLOYMENT §6.4 (read access to the three objects, field names
      to be confirmed with IT). Tests: shared +1 (half years), API +2 (`salesforce.e2e-spec.ts` unapproved / value
      links / half years / system actor / Performance Officer; `kpi.e2e-spec.ts` Performance Officer permissions),
      Playwright `salesforce.spec.ts` now runs the second sync as the Performance Officer.

Verification of step 7 on 2026-10-31: shared 151, web 82, API 379 tests pass (56 suites); Playwright
`salesforce.spec.ts` and `kpi.spec.ts` pass locally; lint, format, type-check clean; `docs/SECURITY.md` route table
regenerated (`any of settings.manage, kpi.sync` on the sync routes).

Verification on 2026-10-31 (steps 0–6): shared 151, web 82, API 377 tests pass (56 suites); Playwright 44 tests — full run 36
passed / 4 skipped (screenshot specs) / 4 failed on the 30 s budget and on the admin's language left in Arabic by
the screenshot run (fixed: 90 s budget for the multi-sign-in specs, screenshots reset the language, `loginAdmin`
waits for a fresh TOTP window); the affected specs (auth, ea, kpi, salesforce) then pass. Lint, format and
type-check clean; `pnpm build` succeeds (Vite warns that the main chunk is > 1.5 MB — route-level code splitting is
for the final polish session); `pnpm audit --audit-level high --prod` clean (9 moderate in exceljs / minio /
nodemailer dependencies, none new from this phase). **Not verified here:** Docker image builds (no Docker daemon
in this sandbox; CI builds them). Local e2e: `E2E_SALESFORCE_MOCK_HOST=localhost` and the API with
`OUTBOUND_ALLOWED_HOSTS=localhost`.

### Next (continue here)

1. Review and merge the pull request `phase-4-3-ea-kpi` → `main` (CI builds the images and runs the e2e suite with
   the mock Salesforce on `host.docker.internal`).
2. When IT sets up the Salesforce integration user: confirm the field names of the three PMS objects against the
   default mapping (D-117, DEPLOYMENT §6.4).
3. Then Phase 4.4 (Integration & export — BACKLOG).

## Previous state — 2026-10-30 (Phase 4 — Part 2: GRC assurance, branch `phase-4-2-grc-assurance`, done — awaiting review)

Everything up to Phase 4.1 (GRC core) is merged into `main`. This branch builds module M10 assurance (DOF RFP §4.5,
compliance items 32–36): approval of changes to active risks / controls, control testing, issues and action plans,
audit management, questionnaires and the assurance dashboard. Phase 4.3 (EA, KPIs, Salesforce, Oracle overlay) stays
in BACKLOG. The session works on `claude/eager-dirac-5r1gd8` (the harness branch) and pushes the same commits to
`phase-4-2-grc-assurance`.

Local setup used by this session: PostgreSQL 16 (`service postgresql start`; role `processhub` / `devpassword`,
databases `processhub`, `processhub_test`); S3 for the dev stack: `moto_server -p 7070` from a Python venv (Docker
Hub pulls of the Versity image hit the rate limit); API from `apps/api/dist` with `SCHEDULER_INTERVAL_MINUTES=0`,
Vite on 5173; Playwright with `E2E_BASE_URL=http://localhost:5173` and
`E2E_CHROMIUM_PATH=/opt/pw-browsers/chromium-1243/chrome-linux64/chrome`. Run single API suites with
`npx jest --runInBand test/<file> --selectProjects e2e` (the path must come before `--selectProjects`).

Steps (tick as they are committed; a new session continues at the first unticked one):

- [x] 0. Approval of changes to active risks and controls (D-098): Settings → Risk & Compliance → "Approval of
      changes" (off by default; once on: risks and controls, workflow = chosen one or the governance default).
      An update of a non-draft risk / control becomes a `GrcChange` (proposed input + before / after) routed through
      the workflow steps (`GrcChangeTask`, ANY / ALL, four-eyes, approvers need `grc.read` + `reviews.decide`); the
      current values stay in force until the last approval applies the input unchanged; reject / withdraw; one
      pending change per item (`CHANGE_PENDING`). API `/grc/changes` (list, mine, detail, decision, withdraw), detail
      `pendingChange`, notification `GRC_CHANGE` (requested / approved / rejected, e-mail EN/AR), My tasks tab
      "Change approvals" (`GET /assurance/tasks`, new module `assurance`). Web: before / after card with steps and
      Approve / Reject / Withdraw on the risk / control page. Tests: shared 2, API 4 (`grc-changes.e2e-spec.ts`),
      Playwright 1 (`assurance.spec.ts`).
- [x] 1. Control testing (D-099): `ControlTestPlan` per control (bilingual steps, design / operating, sample size and
      test frequency suggested from the control frequency, tester / reviewer = user or role, next due, lead days),
      `ControlTest` (Planned → In progress → Submitted → Reviewed / Returned → Closed; samples × steps, conclusion,
      comments), evidence `AssuranceFile` (attachment allow-list + magic bytes, `GET /assurance/files/:id` checked
      per owner), history `AssuranceEvent`. Four-eyes (tester ≠ reviewer, executor never reviews). Signing off sets
      `Control.operatingEffectiveness` + `lastTestedAt` with a GRC assessment entry; `isEffectiveControl` uses the
      tested value when there is one (warnings, coverage, alert badge). `AssuranceScheduler` (own interval) creates
      scheduled tests within the lead time and sends `CONTROL_TEST` reminders (assigned / due / overdue / submitted /
      returned / reviewed, EN/AR e-mail). New permissions `controls.test`, `controls.review`, `issues.manage`,
      `audit.manage`, `surveys.manage`, `surveys.respond` and role `INTERNAL_AUDIT` (bundles in D-101, mapped now).
      Web: "Control tests" register (`/grc/tests`, URL filters), test page (procedure, samples grid, suggested
      conclusion, evidence, history, Start / Save / Submit / Sign off / Return / Close), "Testing" card on the control
      (plans, history, Test now), My tasks tabs "Control tests to perform / review". Tests: shared 4, API 3
      (`control-tests.e2e-spec.ts`), Playwright 1.
- [x] 2. Issues and action plans (D-100): `Issue` (ISS-0001 …, bilingual, source CONTROL_TEST / RISK_ASSESSMENT /
      AUDIT_FINDING / FEEDBACK / MANUAL with a link back, severity from the new Setting `assurance` scale, owner, due,
      links to process / step / risk / control / requirement / department) and `IssueAction` (owner, due, progress %,
      evidence). Open → In progress → Ready for verification (all actions at 100 %, `ACTIONS_OPEN`) → Closed (raiser or
      a GRC officer verifies, never the owner) or Accepted risk (officer, justification). Reminders, overdue and
      escalation after `escalationDays` to the owner's department manager (new `Department.managerId`, field in Admin →
      Departments) and / or the Risk & Compliance officers; ageing (days, buckets). Notification `ISSUE` (13 kinds,
      EN/AR e-mail). Web: register `/grc/issues` (filters in the URL), issue page with action plan (progress slider,
      evidence per action), lifecycle buttons, history; "Raise issue" on failed tests, risks and portal feedback;
      Settings card "Issues"; My tasks tabs (my issues / my actions / to verify); portal "My tasks" + `/portal/issues/:id`
      for action owners without the workspace (workspace links redirect there). Tests: API 3 (`issues.e2e-spec.ts`),
      Playwright 1.
- [x] 3. Audit management (D-101): audit universe (`GET /audits/universe?year`: processes and departments ranked by the
      highest residual score of their active risks, last audited, engagements of the year), `AuditEngagement`
      (AUD-YYYY-NN, bilingual title / objective / scope / summary, scope = processes, departments, risks, controls,
      requirements, lead + team, planned / actual dates, Planned → Fieldwork → Reporting → Follow-up → Closed, one step
      at a time, closing needs every finding answered), `AuditWorkItem` (checklist / test steps, "test a control" copies
      its current test procedure, status, result, working notes, evidence), `AuditFinding` (F-01 …, rating from the
      severity scale, condition / criteria (+ requirement) / cause / effect / recommendation, trace to process, step,
      risk, control, work item; management response owner). Responses: agree (action + target date → an `Issue`
      with the action, source AUDIT_FINDING, same trace) or disagree (reason). Audit report `.docx` (cover, summary,
      objective, scope, findings table, findings with trace and management responses; Arabic right-to-left), audited
      `EXPORT`. Role `INTERNAL_AUDIT` (+ demo user `audit@processhub.local`); audits readable by `audit.manage`,
      `grc.edit` and `audit.read` (Auditors). Notification `AUDIT` (team / response / agreed / disagreed). Web: Audits
      (plan + universe with "Plan engagement"), engagement page (overview, work programme, findings, report EN / AR,
      status steps), finding page for response owners (`/grc/findings/:id`, portal `/portal/findings/:id`), My tasks
      "Audit findings to answer". Tests: API 1 (`audits.e2e-spec.ts`, incl. report in both languages and the universe),
      e-mail templates 1, Playwright 1.
- [x] 4. Questionnaires and surveys (D-102): `Questionnaire` (bilingual, purpose GENERAL / RCSA / COMPLIANCE /
      PROCESS_FEEDBACK, definition = sections of questions: single / multiple choice, rating 1–5, yes/no/NA, text,
      number, date, file upload; required, scoring weights and option scores, conditional show/hide on an earlier
      answer, RCSA link to a risk's residual likelihood / impact or a control's effectiveness), `SurveyCampaign`
      (definition snapshot, audience users / roles / departments limited to `surveys.respond` holders, dates, reminder
      days, department or process assessed; Draft → Open → Closed, closes itself after the end date),
      `SurveyResponse` (Sent → Opened → Submitted, answers, weighted score, file answers as `AssuranceFile`),
      `SurveyProposal` (RCSA answers → proposals a GRC officer accepts — applied through the normal risk / control
      update, so the change approval applies — or dismisses). Results per question (counts, averages, texts), Excel
      export EN / AR (responses + summary sheets, right-to-left), audited `EXPORT`. "Request feedback" on a process
      (editors of the process or survey managers): built-in short questionnaire, launched at once, recipients see the
      read-only working (draft) diagram, each submission becomes a comment on the process. Notification `SURVEY`
      (invited / reminder). Web: Questionnaires (campaigns + questionnaires), builder with preview, campaign page
      (launch / close, tracking, results, proposals, Excel), response page in the workspace (`/surveys/:id`) and the
      portal (`/portal/surveys/:id`), My tasks / portal tasks "Questionnaires to answer", "Request feedback" on the
      process page. Tests: shared 5, API 2 (`surveys.e2e-spec.ts`), Playwright 1.
- [x] 5. Assurance dashboard (D-103): `GET /assurance/dashboard` (scope organisation / department / process, year):
      control tests done / due / overdue / awaiting review, % tested effective, by department and by process; open
      and overdue issues, by severity and age (0–30 / 31–60 / 61–90 / 90+ days), overdue actions, accepted risks;
      audit plan progress (engagements per status, late), findings by rating and pending responses; campaign
      response rates. Every tile / bar opens the filtered list; Excel export EN / AR (`/assurance/dashboard/export`,
      audited). Risk dashboard heat map toggle "Using tested effectiveness" (`/grc/dashboard?tested=true`, register
      filter `matrix=tested`, shared `testedResidual`). Web: "Assurance dashboard" in the Risk & Compliance menu.
      Tests: shared 2, API 1 (`assurance-dashboard.e2e-spec.ts`), Playwright 1.
- [x] 6. Permissions, demo data, docs: authorisation matrix with real assurance records + a Modeler sweep over every
      assurance write endpoint; route table in SECURITY.md regenerated; demo seed `seed-assurance.ts` (2 test plans,
      the failed CTL-01 test → ISS-0001 with two actions, an overdue and a planned test, engagement AUD-YYYY-01 with
      F-01 agreed → ISS-0002 and F-02 waiting for the response, RCSA campaign with two answers / four proposals; demo
      user `audit@processhub.local`); screenshots EN / AR in `docs/screenshots/phase-4-2/` (spec
      `screenshots-phase-4-2.spec.ts`, run with `SCREENSHOTS=1`), sample audit reports
      `docs/samples/sample-audit-report-{en,ar}.docx`; README tour, CLAUDE.md (roles, data model, phase table),
      BACKLOG (4.2 follow-ups, 4.3), DECISIONS D-098 – D-103.

Verification on 2026-10-30: shared 147, web 79, API 359 tests pass; Playwright 35 tests (8 new in `assurance.spec.ts`)
— 34 passed in the full run, the Phase 4.1 portal test hit the 30 s default budget with six sign-ins and now has 60 s
(passes alone in 28 s); lint, format and type-check clean; `pnpm build` succeeds; `pnpm audit --audit-level high
--prod` clean (7 moderate, unchanged). **Not verified here:** the Docker image builds — Docker Hub answered
429 Too Many Requests for the base images in this sandbox (the build steps themselves, `pnpm build`, pass).

- [x] 7. Product owner decisions on the pull request (D-104 – D-106): active / retired risks and controls cannot be
      deleted (retire instead); Excel imports with change approval on → one batch of pending changes (approve /
      reject together in My tasks, one notification), new rows as drafts, `CHANGE_PENDING` rows refused; base-seed
      workflow "GRC change approval" (preselected, approval still off) + go-live step in DEPLOYMENT.md / SECURITY.md;
      Viewer assignment checks with permission tests; feedback comments labelled "[Feedback request] <campaign>";
      control page shows self-assessed and tested effectiveness, "Test overdue" flag, register filter and coverage
      tile. Tests: shared 1, API +4 (grc-changes 2, issues 1, control-tests / surveys / grc / seed extended),
      Playwright assertion for the two values.

### Next (continue here)

1. Review and merge the pull request `phase-4-2-grc-assurance` → `main` (CI builds the Docker images).
2. Then Phase 4.3 (EA, KPIs, Salesforce, Oracle overlay — BACKLOG).

## Previous state — 2026-10-30 (Phase 4 — Part 1: GRC core, branch `phase-4-1-grc`, done — awaiting review)

Everything up to Modeler design Part B2 is merged into `main`. This branch builds module M10 core: risks,
controls and requirements linked to process steps (DOF RFP §4.5). Phase 4.2 / 4.3 items are in BACKLOG.

Local setup used by this session: PostgreSQL 16 (`service postgresql start`; role `processhub` /
`devpassword`, databases `processhub`, `processhub_test`).

Steps (tick as they are committed; a new session continues at the first unticked one):

- [x] 0. CLAUDE.md phase table (B2 and Phase 6 part 4 merged; Phase 6 remainder moved to the end), this plan.
- [x] 1. Data model and permissions (D-089 – D-091): `Risk`, `Control`, `Requirement` detail tables 1:1 with
      a `RepoObject` (types RISK / CONTROL / new REQUIREMENT), `RiskControl`, `RequirementControl`,
      `GrcActivity` (assessment history + comments); process-level links (`#process`, kept on save);
      permissions `grc.read` / `grc.propose` / `grc.edit` / `grc.admin`, role `RISK_OFFICER`; API `/grc/*`
      (registers with filters incl. rating / heat-map cell / coverage, details with linked steps, timeline,
      comments, settings, per-process view); GRC editors link GRC items without model rights; `/objects` refuses
      GRC types (`USE_GRC_REGISTER`). Shared `grc.ts` (schemas, ratings, settings). Tests: shared 7, API 6 (+
      authorisation matrix covers the new tables), SECURITY.md route table regenerated.
- [x] 2. GRC workspace: menu "Risk & Compliance" (dashboard link lands in step 4), risk register, control
      library, requirements (filters in the URL: search, status, category, rating, department, owner, overdue,
      coverage toggles, heat-map cell, process; sorting; paging), detail pages (ratings, both matrices,
      relations, linked steps → modeler deep link, assessment timeline + comments), create / edit / propose
      forms EN/AR, Excel export / template / import with validation report (API `/grc/export|template|import`,
      audited `EXPORT` / `IMPORT`), Settings → Risk & Compliance (bands, matrix labels, categories, portal
      visibility, reminder days, live preview). Library objects of GRC types redirect to their GRC page. Demo
      seed `seed-grc.ts` (10 risks, 12 controls, 6 requirements, links incl. published links; demo user
      `risk@processhub.local`) — done early to have data for the UI. Tests: API import / export 1, seed, i18n keys.
- [x] 3. Modeler and portal (D-092): side panel tab "Risks & Controls" (link / unlink, create or propose a
      linked draft, ratings and effectiveness, alert), warning badge `ALERT` (modeler + preview), colour-by
      "Residual risk rating" and "Risks without controls", portal visibility setting enforced on the server
      (portal page + portal AI sources), handbook option "Risks and controls". Tests: shared 1, API 2 (portal
      setting, handbook section).
- [x] 4. Dashboards (D-093): Risk dashboard (scope organisation / department / process with breadcrumb), inherent
      and residual heat maps (cell → risk list), eight coverage tiles linking to filtered registers, breakdown
      department → process → step, steps with risks but no control, RCM Excel export (`/grc/rcm`, + coverage
      sheets). Registers gained `scopeDepartmentId` and `alert` filters. Tests: API 1 (dashboard, scopes,
      uncovered steps, RCM workbook).
- [x] 5. Reviews and notifications (D-094): due / overdue reminders (`GRC_REVIEW`, scheduler, dedupe, e-mail
      template EN/AR, preference), My tasks tab "Risk & control reviews" + menu count, overdue flags. Optional
      approval of GRC changes through governance workflows deferred to BACKLOG (decision requested). Tests: API 1.
- [x] 6. AI control-gap check (D-095): shared rules `detectControlGaps` + `GET /grc/processes/:id/gaps`, AI feature
      `CONTROL_GAPS` (`POST /ai/control-gaps`, mocked provider in tests), modeler drawer "Check control gaps" with
      Accept (link / create control) and Dismiss. Tests: shared 1, API 1.
- [x] 7. Demo data (seed `seed-grc.ts`: 10 risks, 12 controls, 6 requirements on S.01 / S.01.01 / C.01.01, incl.
      the critical RSK-02 whose only control is not assessed; demo user `risk@processhub.local`), Playwright
      `grc.spec.ts` (3 tests: create risk → link in modeler → heat map and coverage; portal setting OFF / CONTROLS /
      ALL; Excel import validation), screenshots EN/AR in `docs/screenshots/phase-4-1/` (register, risk detail,
      modeler panel with badges, heat map, coverage dashboard, portal step), docs (README, CLAUDE.md, DECISIONS
      D-089 – D-096, BACKLOG, SECURITY), dependency fix D-096.

Verification on 2026-10-30: shared 134, web 79, API 343 tests pass; Playwright 29 tests pass (3.9 min, against the
dev stack: API from `apps/api/dist`, Vite on 5173, `E2E_BASE_URL=http://localhost:5173`); lint, format and
type-check clean; `pnpm audit --audit-level high --prod` clean (7 moderate); API and web Docker images build
(built with the sandbox proxy CA through scratch Dockerfile copies — repository Dockerfiles unchanged).

### Next (continue here)

1. Review and merge the pull request `phase-4-1-grc` → `main`. The product owner answered the five open decisions
   (D-097): workflow approval of GRC changes → Phase 4.2; Reviewers keep `grc.read`; portal default OFF accepted
   (decide per process before go-live); `grc.propose` approved; warning badge per risk confirmed.
2. Then Phase 4.2 (control testing, issues, audits — BACKLOG) or 4.3 (EA, KPIs, Salesforce).

## Previous state — 2026-10-29 (Modeler design — Part B2: smarter modeling and reports, branch `modeler-design-b2`)

Everything up to Modeler design Part B1 and the zod 4 upgrade is merged into `main`. Part B2 adds browser
tests in CI, a Dictionary with label autocomplete, Quick Model (table entry), step attributes with "colour by"
views, reports (handbook .docx, RACI .xlsx, object reports) and modeling conventions as a quality gate. Main
test diagram: `docs/samples/PMS-01-Program-Request-Approval.bpmn`.

Local setup used by this session: PostgreSQL 16 (role `processhub` / `devpassword`, databases `processhub`,
`processhub_test`); the Docker daemon works in this sandbox, so the e2e suite ran against
`docker compose up` (images built with the sandbox proxy CA through a scratch Dockerfile copy — the
repository Dockerfiles are unchanged); `.env` with `LOGIN_RATE_LIMIT_MAX=1000`.

Steps (tick as they are committed; a new session continues at the first unticked one):

- [x] 0. Playwright smoke tests in CI (job "End-to-end": `docker compose up --build --wait`, Chromium,
      artifacts on failure): sign-in incl. wrong password and the Super Admin's first 2FA enrolment (TOTP from
      the shown key, recovery codes kept in `apps/e2e/.auth/` for re-runs), process house → new process,
      workspace → import PMS-01 → ready-made "Approval step" → Save version, submit → reviewer and owner
      approve → owner publishes, viewer opens it in the portal, Arabic workspace RTL (palette on the right).
      17 tests, ≈ 40 s locally.
- [x] 1. Dictionary (D-083, D-084): library type `TERM` with definition, synonyms EN/AR, category, owner,
      status (draft / approved); Dictionary page (Library → Dictionary: approved terms, proposals with approve /
      reject), term fields in the object form, term details on the object page; label autocomplete on the
      canvas (direct editing, ↑ ↓ Enter Esc) and in the panel's name fields — approved terms, roles and IT
      systems, both languages and synonyms, Arabic spelling variants; choosing one fills both labels and sets
      `ph:labelRef` (lanes: role); book marker on linked shapes; "Propose as dictionary term" from the panel;
      Rename with preview (affected processes / labels, skipped ones and why, one version per process,
      audited) for terms, roles and systems; API keeps NAMED links in sync on save; demo terms in the seed;
      approved terms only as AI translation terminology. Fixes: a click keeps the selected shape selected and
      the diagram stays still when the Arabic panel opens (double-click label editing hit the wrong shape);
      Ant Design's Arabic "(optional)". Tests: shared 9, API e2e 6 (+ seed), web 6, Playwright 4.
- [x] 2. Quick Model (D-085): "Diagram | Quick Model" switch in the workspace; table with step EN/AR, performed
      by (library role or free text → lane), IT system, step type (shared `steps.ts`), next step(s) with
      bilingual condition labels; add / insert / move / delete rows, validation (errors block, warnings
      shown); Paste from Excel (TSV, header detection, row numbers or names, library matching); "Generate
      diagram" = one undoable command (ids kept, lanes from roles, pool when needed, auto-layout) + save +
      SUPPORTS links; "Read from diagram". Fixes: English inputs stay LTR in the Arabic UI (Ant Design's
      `.ant-input-rtl`). Tests: shared 2, web 8, Playwright 2 (EN paste → generate → edit keeps the id;
      Arabic-only rows).
- [x] 3. Step attributes and "colour by" (D-086): side panel "Step attributes" (processing / waiting time and SLA
      in minutes / hours / days, frequency per month, cost per execution, inputs / outputs EN/AR) stored as
      `ph:` attributes, validated on every save (`INVALID_STEP_ATTRIBUTES`); shared BPMN reader
      `bpmn-graph.ts`; View → Colour by (lane / role, IT system, step type, duration band, missing
      information) as markers + generated CSS with a legend, view only; totals card on the process page
      (steps, approvals, decisions, systems, roles, planned time of the main path). Tests: shared 7, API 3,
      web 5, Playwright 1.
- [x] 4. Reports and exports (D-087): process handbook (.docx) for a process or its branch — cover with logo,
      contents, per process description, details (owner, version, approval), diagram on a landscape page, step
      table in flow order, linked documents and SOP page text — fully RTL in Arabic; RACI (.xlsx: RACI, IT
      systems, steps with attributes, legend; Arabic sheets right-to-left); object report "where used"
      (.xlsx) on the object page. Process page → More (workspace: working or published version, language,
      sub-processes), portal process page → Reports (published only), workspace import / export menu.
      Diagrams drawn in the browser (PNG), documents built on the server (`docx`, `exceljs`), `EXPORT`
      audit entry, Viewers published content only (`NOT_PUBLISHED`), 40-process limit. Samples:
      `docs/samples/PMS-01-handbook-{en,ar}.docx`, `PMS-01-raci-{en,ar}.xlsx`. Tests: shared 1, API 6
      (+ authorisation matrix: the RACI route serves the portal), Playwright 1.
- [x] 5. Modeling conventions (D-088): Administration → Modeling conventions (permission `conventions.manage`:
      Super Admin, Admin) with six rules — both-language labels, steps in a lane linked to a role, user tasks
      described, maximum elements, no unconnected elements, approval followed by a decision — each "Check" and
      "Required before review"; Validation panel section "Modeling conventions" (Required / Convention tags, click
      selects the element) from the shared `checkConventions`; server refuses "Submit for review" with
      `CONVENTIONS_NOT_MET` and the list (EN/AR dialog). Default: all warnings, none required. Tests: shared 5,
      API 3, web 1 (+ i18n keys), Playwright 1 (+ settings page view in the admin sign-in test).
- [x] 6. Screenshots EN/AR (`docs/screenshots/modeler-design-b2/`, prefix = part), samples from PMS-01
      (`docs/samples/PMS-01-handbook-{en,ar}.docx`, `PMS-01-raci-{en,ar}.xlsx`), docs (README, CLAUDE.md phase
      table and data model, DECISIONS D-083 – D-088, BACKLOG, SECURITY), verification, pull request.
      Verification on 2026-10-29: shared 125, web 79, API 332 tests pass; Playwright 26 tests pass in 2.7 min
      (now one worker: the specs share the demo users' saved language); lint, format and type-check clean;
      `pnpm audit --audit-level high` clean (8 moderate, 1 low: `minio` → stream-json / decode-uri-component,
      `nodemailer` 3 new moderate advisories already on `main`, `exceljs` → `uuid` 8 — see SECURITY SEC-09).

### Next (continue here)

1. Review and merge the pull request `modeler-design-b2` → `main` (decisions for the product owner are listed
   in the pull request: default conventions, RACI R / A only, Admins managing conventions, the e2e suite on one
   worker).
2. Then: update `nodemailer` (moderate advisories, separate dependency branch), Phase 6 part 4 step 6 and
   Phase 4 (GRC, EA, KPIs + Salesforce) as before.

## Previous state — 2026-10-28 (dependency upgrade: zod 3 → 4, branch `deps-zod-4`)

Modeler design Part B1 is merged into `main`. This branch only upgrades zod (product owner decision 1 of
2026-10-28) and closes the high advisory GHSA-mrhx-c7xc-m3w5 that has no zod 3 fix. Decision: DECISIONS D-082.

What changed:

- `packages/shared` and `apps/api`: zod `^3.25.76` → `^4.6.7` (the web uses zod only through `@processhub/shared`;
  `@anthropic-ai/sdk` accepts zod 3 or 4 as peer).
- Schemas migrated to the zod 4 API with the same behaviour: `z.guid()` for ids, e-mail as
  `trim[/toLowerCase] → z.email()`, optional bilingual text `.nullable().transform().optional()`,
  `z.partialRecord` (notification preferences), `z.strictObject` (2FA verify), `code: 'custom'`, `{ error }`,
  `z.url()` (`APP_URL`), `z.ZodType` in `ZodPipe`; AI suggestion lists no longer carry a never-applied default.
- API error responses unchanged (`400 VALIDATION_ERROR`, `details: [{ path, message }]`; the web translates the
  code in EN/AR). Our own codes in `details` are unchanged; zod's built-in English texts (in `details`, the
  start-up config error and the AI output feedback to the model) are now zod 4's.
- Removed the stray `shellcheck_py-*.whl` from the repository root; `*.whl` added to `.gitignore`.

#### Verification (zod 4)

| Check                                              | Result                                                                                                                                                                              |
| -------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Differential run zod 3 (main) vs zod 4 (branch)    | ~1,500 inputs through every shared schema, the environment schema and the AI process-structure schema: same accept / reject, same parsed data, same custom error codes in all cases |
| `pnpm format:check`, `pnpm lint`, `pnpm typecheck` | clean                                                                                                                                                                               |
| `pnpm test`                                        | **473 tests pass** — shared 103 (5 new zod 4 compatibility tests), web 59, API 311                                                                                                  |
| `pnpm audit --audit-level high`                    | clean (7 moderate, 1 low remain; no high / critical)                                                                                                                                |

### Next (continue here)

1. Review and merge `deps-zod-4`.
2. Modeler design Part B2 (BACKLOG). Phase 6 part 4 step 6 and Phase 4 as before.

## Previous state — 2026-10-28 (Modeler design — Part B1: full-screen workspace and productivity, merged into `main`)

Everything up to Modeler design Part A is merged into `main`. This branch turns the modeler into a full-screen
workspace (like ARIS / BIC / Signavio) and adds modeling productivity tools. Main test diagram:
`docs/samples/PMS-01-Program-Request-Approval.bpmn` (8 lanes, 27 elements). Part B2 items are in BACKLOG.

Local dev setup used by this session (no Docker daemon in the sandbox): PostgreSQL 16 cluster, role
`processhub` / `devpassword`, databases `processhub` and `processhub_test`; API from `apps/api/dist` with a
dev `.env`; Vite on 5173; a script creates the published process C.09 from the PMS-01 sample (links, a comment,
job roles) for screenshots.

Steps (tick as they are committed; a new session continues at the first unticked one):

- [x] 0. "Before" screenshots of PMS-01 (modeler tab, portal, print; EN/AR) in `docs/screenshots/modeler-design-b1/`;
      `diagram-js-minimap` added.
- [x] 1. Shared: layered layout builder moved to `packages/shared/src/bpmn-layout.ts` (also variable shape sizes);
      the AI builder uses it; tests.
- [x] 2. Web: route `/processes/:id/model` (workspace without app chrome): top bar, canvas, collapsible /
      resizable side panel (state per user in localStorage), focus mode, browser full screen; Model tab =
      read-only preview + Open modeler / Edit diagram; deep links `?element=`; autosave and unsaved guard.
- [x] 3. Web: navigation — fit width on open (max 100 %), zoom menu with presets, Ctrl+wheel, space+drag,
      mini-map toggle (RTL), keyboard on the canvas only, Ctrl+F search, shortcuts dialog, grid snapping toggle.
- [x] 4. Web: grouped searchable palette on the inline-start side (collapsible) + ready-made steps.
- [x] 5. Web: align / distribute toolbar; auto-layout command (one undo step, confirmation); lanes: role link
      (`ph:roleId`), label from the role, PERFORMS suggestion for tasks in the lane.
- [x] 6. Web: info badges (roles, systems, documents, risks, controls, comments) in modeler, preview and portal;
      toggle.
- [x] 7. Portal: taller diagram, fit width, mini-map, full screen, "highlight my steps"; print layout (A4/A3
      landscape, logo header, legend, scaled / multi-page diagram, page numbers, RTL).
- [x] 8. 200+ element performance test, "after" screenshots, docs (PROGRESS, DECISIONS, BACKLOG B2, README,
      CLAUDE.md), verification, push, pull request.

What changed:

- **Workspace** `/processes/:id/model` (`ModelerWorkspacePage`, `BpmnEditor`): no app chrome; top bar with code,
  name, status, save state, Save version, undo / redo, zoom menu, find, auto-layout, View (mini-map, badges,
  grid snapping), focus mode, full screen, shortcuts, Validation, Versions, Comments, AI, import / export,
  panel toggle, Close. Side panel (Properties / Issues / Comments / AI) closed until something is selected,
  closable, resizable (mouse and arrow keys); state per user in localStorage (`workspace-prefs.ts`,
  `panel-state.ts`). Model tab = read-only preview (`ModelPreview`) with Open modeler / Edit diagram; deep
  links `?tab=model&element=` highlight in the preview and are passed on. Autosave + unsaved guard unchanged.
- **View**: fit width on open (≤ 100 %, `view.ts`), presets, Ctrl+wheel, space+drag, mini-map
  (`diagram-js-minimap` 5.6.0, bottom inline-end, above the bpmn.io mark), Ctrl+F search, shortcuts dialog,
  F / ? / Esc ignored in fields (`keys.ts`); bpmn-js keys are bound to the canvas (diagram-js 15).
- **Palette** (`Palette.tsx`, `palette-entries.ts`): grouped, searchable EN/AR, icons-only, inline-start;
  ready-made steps incl. "Link to sub-process" with a process picker.
- **Layout**: align / distribute toolbar for ≥ 2 shapes; auto-layout command `ph.autoLayout`
  (`auto-layout.ts`, shared `bpmn-layout.ts`), confirmation, one undo step.
- **Lanes**: link to a library Role (`ph:roleId`, label from the role, "Use the role's name"), PERFORMS
  suggestion for tasks in the lane; kept by AI refine.
- **Badges** (`badges.ts`, `useDiagramOverlays.ts`): roles, systems, documents, risks, controls, open comments;
  hover list, click → panel; toggle; also in the preview and the portal (published links).
- **Portal**: full-width diagram with zoom menu, mini-map, full screen, badges, "Highlight my steps"; step
  details over the diagram. **Print**: A4 / A3 landscape, logo header, version / owner / approval, colour
  legend, page-wide parts when the diagram would be < 55 % (`print-layout.ts`), "Page n of m" (EN/AR).
- Screenshots `docs/screenshots/modeler-design-b1/`: before (modeler tab, portal, print) and after
  (workspace, selected + panel, focus mode, model tab, portal, print page, PDF pages 1–2), EN and AR.

#### Verification (design B1)

| Check                                                   | Result                                                                                                                                                                                                                                                                                                                                |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm format:check`, `pnpm lint`, `pnpm typecheck`      | clean                                                                                                                                                                                                                                                                                                                                 |
| `pnpm test`                                             | **468 tests pass** — shared 98, web 59, API 311 (new: lane-role link sync and portal "My processes" via a lane role, shared layout ×4, auto-layout on PMS-01 incl. undo/redo ×3, keyboard scope on the canvas, workspace keys, panel state / prefs ×7, badges ×2, print layout ×5, 250-step performance, lane role kept by AI refine) |
| `pnpm build` (web)                                      | passes                                                                                                                                                                                                                                                                                                                                |
| `pnpm audit --prod --audit-level high`                  | body-parser (2.4.0) and multer (2.5.0) advisories of 2026-10-23 fixed via overrides; **zod 3 high advisory remains** (no 3.x fix; decision in BACKLOG)                                                                                                                                                                                |
| Performance, Chromium, 250 steps (584 diagram elements) | workspace open 1.2 s incl. login redirect, Ctrl+wheel zoom ≈ 50 ms per two frames, auto-layout 0.4 s, undo 60 ms; jsdom test as regression guard                                                                                                                                                                                      |
| Browser                                                 | PMS-01 EN/AR: workspace, selection → panel, focus mode, ready-made step + process picker, search, auto-layout, lane role + suggestion, preview with deep link, portal with highlight, print + PDF A4 (5 pages, 2 diagram parts)                                                                                                       |
| Docker                                                  | not run in this session: the sandbox has no Docker daemon. Dockerfiles unchanged; the only new runtime dependency is the web package `diagram-js-minimap` (bundled by Vite, build passes)                                                                                                                                             |

### Product owner decisions (2026-10-28)

1. zod 4 migration: separate change right after this PR (stays in BACKLOG).
2. Docker: CI "Docker images" job passed; compose run locally after merging.
3. Lane–role link also server-side (D-081): `saveModel` syncs `ph:roleId` to PERFORMS object links (add /
   replace / remove, invalid ids ignored, audited). Tests: API e2e (sync, usage, replace, remove, invalid and
   deleted roles, audit), portal "My processes" via a lane role, shared `extractLaneRoles`.
4. Auto-layout limits (one pool, horizontal lanes) accepted.

### Next (continue here)

1. Review and merge `modeler-design-b1`; decide on the zod 4 migration (BACKLOG "Needs a decision").
2. Modeler design Part B2 (BACKLOG). Phase 6 part 4 step 6 and Phase 4 as before.

## Previous state — 2026-10-23 (Modeler design upgrade — Part A: look and feel, branch `modeler-design-a`)

Phases 1–3, the AI Assistant and Phase 6 parts 1–4 are merged into `main`. This branch makes diagrams look like
an enterprise BPM product while staying 100 % standard BPMN 2.0 (colours stored as BPMN-in-Color +
`bioc:`). Reference: `docs/samples/README.md` (colour scheme) and `docs/samples/PMS-01-Program-Request-Approval.bpmn`.
Decisions: DECISIONS D-067 – D-072. Part B (palette/toolbar, templates, badges, mini-map, alignment, auto-layout,
print layout with logo) is in BACKLOG.

Steps (tick as they are committed; a new session continues at the first unticked one):

- [x] 0. "Before" screenshots of PMS-01 (modeler, portal, 100 % detail; EN/AR) in `docs/screenshots/modeler-design-a/`.
- [x] 1. Shared: `packages/shared/src/diagram-theme.ts` — theme type, default (reference scheme), zod schema,
      element-kind classification (approval tasks by first English word or `ph:stepKind`), theme-colour detection;
      Setting key `branding.diagramTheme`, public settings carry the theme. Unit tests.
- [x] 2. API: theme in public settings, `PUT/DELETE /settings/diagram-theme` (Super Admin, audited),
      `POST /settings/diagram-theme/apply` (dry run + apply: recolours uncoloured elements in all working models as a
      new version "Applied colour theme", audited); server-side XML recolouring with tests.
- [x] 3. API: AI generator / refine (`structure-to-bpmn.ts`) writes theme colours and places gateway branch labels
      on their own branch (`BPMNLabel` bounds); refine keeps existing explicit colours. Tests.
- [x] 4. Web: bpmn-js modules — theme on `shape.create` / `shape.replace` / label or step-kind change (never over
      user colours), custom renderer (rounded corners, shadow, 1.5 px borders, task icons, lane header band,
      fonts, Arabic RTL labels), one diagram factory used by modeler, viewers, portal, print, compare.
- [x] 5. Web: colour picker (`bpmn-js-color-picker`, theme palette + neutrals + "reset to theme"), approval-step
      setting in the element panel (`ph:stepKind`), exports with colours and embedded fonts.
- [x] 6. Web: Settings → Branding diagram theme card (live preview, reset, apply to existing diagrams with dry run).
- [x] 7. Round-trip test of the PMS-01 sample (import → save → compare colours and `ph:` attributes), compare
      highlights, EN/AR checks; "after" screenshots.
- [x] 8. Docs (PROGRESS, DECISIONS, BACKLOG Part B items, README, CLAUDE.md, SECURITY route list),
      verification (format, lint, typecheck, tests, build, audit, Docker), push, pull request.

What changed:

- **Theme** (`packages/shared/src/diagram-theme.ts`): default = reference scheme; kinds start, successful end,
  rejected/terminate end (terminate / error / cancel / escalation definition or a "rejected / declined /
  cancelled" label), human task (user, manual, plain task, call activity, sub-process), approval task, system
  task (service, send, receive, script, business rule), gateway, intermediate event, lanes (alternating).
  Approval = user task whose English label starts with Review / Approve / Endorse / Confirm, or
  `ph:stepKind="approval"` (element panel "Step kind": automatic / approval / normal).
- **Stored as BPMN-in-Color + bioc** everywhere: modeler (theme behaviour on create, type change, label /
  step-kind change; never over explicit colours; one undo step), AI generate / refine / document-to-process,
  "Apply theme to existing diagrams", seed demo diagrams (`prisma/bpmn-builder.ts`).
- **Renderer** (`apps/web/src/features/modeler/renderer.ts`) and one factory (`create-diagram.ts`) for every
  diagram: rounded activities, soft shadow, 1.5 px borders, user / approval / service / send / receive icons,
  lane header band, dark semibold lane names, opaque alternating lane fills, Inter + IBM Plex Sans Arabic,
  Arabic labels right-to-left. Fonts load before import; SVG/PNG exports and the portal print view embed them.
- **Colour picker** (`bpmn-js-color-picker`) in the editable modeler's context pad: theme palette, neutrals,
  "Reset to theme", "No colour"; Arabic labels.
- **Settings → Diagram colours** (Super Admin): colour per kind with live preview (EN/AR), save, discard, reset
  (`PUT/DELETE /settings/diagram-theme`, audited); **Apply theme to existing diagrams**
  (`POST /settings/diagram-theme/apply`, dry run → confirmation with counts → new versions "Applied colour
  theme"; locked processes skipped; audited).
- **AI layout**: gateway branch labels at the start of their own branch (`BPMNLabel` bounds), others above the
  longest horizontal segment.
- **Highlights**: diff (saturated + halo, orange for "changed"), portal selected step (halo), drop feedback and
  hover all target the shape body; compare reports colour-only changes as "moved, resized or recoloured".
- Screenshots: `docs/screenshots/modeler-design-a/` — `before-*` / `after-*` for the modeler, portal and
  100 % details (EN/AR), plus `after-compare-en.png`.

#### Verification (design A)

| Check                                              | Result                                                                                                                                                                                                                                                                                                                                                                      |
| -------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm format:check`, `pnpm lint`, `pnpm typecheck` | clean                                                                                                                                                                                                                                                                                                                                                                       |
| `pnpm test`                                        | **435 tests pass** — shared 93, web 39, API 303 (new: theme classification ×19, XML recolouring ×4, theme settings / apply e2e ×3, AI colours / refine / branch labels ×4, PMS-01 round trip through the real modeler, modeler theme behaviour, colour diff, font embedding)                                                                                                |
| `pnpm build`                                       | passes                                                                                                                                                                                                                                                                                                                                                                      |
| `pnpm audit --prod --audit-level high`             | no high/critical; the same 4 moderate as before (`minio` client, SEC-09)                                                                                                                                                                                                                                                                                                    |
| Docker                                             | both images build from the committed Dockerfiles (sandbox-only CA copy, as before); `docker compose up` from clean volumes: all five services healthy, demo diagrams seeded with colours; Playwright smoke suite 8/8 against it; modeler, SVG/PNG export with fonts, no CSP errors                                                                                          |
| Browser (Vite dev, Chromium)                       | PMS-01 imported, rendered with its colours, EN ↔ AR, autosave, reload, export SVG/PNG/BPMN (35 colour pairs, 54 Arabic labels kept); append task → human colours, replace → system colours, picker purple kept on replace, reset to theme, rename "Review …" → approval colours; Settings card EN/AR; apply dry-run dialog; compare highlights; portal and print view EN/AR |

### Product owner decisions (2026-10-23) — implemented

1. **Apply theme on approved / published processes** (D-072): recoloured in place when the change is colour
   attributes only (verified against the official version on a canonical, colour-free comparison): status
   kept, new version "Theme applied (colours only)", publication (or approving review) moved to it, audited;
   the portal shows the colours at once. Anything else → new draft.
2. Hand-picked theme colours: current behaviour kept (D-073).
3. Defaults for intermediate events, call activities and sub-processes confirmed (D-073).
4. No display-time colouring confirmed; one-time Super Admin notice "Diagrams can now be coloured: run Apply
   theme" (dismiss or apply closes it, audited); upgrade step in DEPLOYMENT.md §9 (D-073).

Verification of this round: API e2e for in-place recolouring (published, approved-then-published), the
draft fallback and the notice; unit tests for the colour-only comparison; full `pnpm test`, lint, typecheck,
format, build; browser check of the notice (EN/AR), the confirmation dialog and "apply" on the demo data (5
published demo processes kept their status, portal versions coloured).

### Next (continue here)

1. Review and merge `modeler-design-a`; after deploying follow DEPLOYMENT.md §9 (run **Apply theme**).
2. Modeler design — Part B (BACKLOG).
3. Phase 6 part 4 step 6 scope and Phase 4 as before.

## Previous state — 2026-10-21 (Phase 6 — Hardening, branch `phase-6-part-4`)

Parts 1 (security review), 2 (production deployment) and 3 (SSO + two-factor) are merged into `main`.

### Part 4 — Performance, reliability and polish (decisions block done, awaiting review)

First block: the product owner's decisions on the part 3 questions (DECISIONS D-061 – D-066):

1. 2FA required at go-live for Super Admin and Admin; optional for all other roles.
2. After the SSO roll-out password sign-in is off except for one break-glass Super Admin with 2FA
   (procedure in DEPLOYMENT.md).
3. Roles are managed in ProcessHub: "update roles at every sign-in" off by default; directory groups only set
   the initial role on first sign-in.
4. MFA for SSO users is enforced by Entra ID Conditional Access (request to IT in DEPLOYMENT.md).
5. Default refresh-token lifetime 24 hours (configurable); automatic de-provisioning stays in BACKLOG.
6. Node 20 → Node 22 LTS in Docker images, CI and docs.

Steps (tick as they are committed; a new session continues at the first unticked one):

- [x] 1. API/shared defaults: `mfaRequiredRoles` = Super Admin + Admin, refresh token lifetime
      `REFRESH_TOKEN_TTL_HOURS` (default 24), roles from the directory only on first sign-in; tests.
- [x] 2. Web: Settings → Authentication hints for the new defaults; EN/AR.
- [x] 3. Node 22 LTS: Dockerfiles, CI, `.nvmrc`, `engines`, `@types/node`, README, CLAUDE.md §4.
- [x] 4. Docs: DECISIONS D-061 – D-066, DEPLOYMENT.md (break-glass procedure, Conditional Access request),
      SECURITY.md, BACKLOG, CLAUDE.md phase table.
- [x] 5. Verification (format, lint, typecheck, tests, build, audit), push.
- [ ] 6. Performance / reliability / polish items — scope to be confirmed by the product owner (the part 4
      brief lists only the decisions above). Candidates from BACKLOG: slim API runtime image and images in a
      registry; database indexes / query review for the large lists (process tree, search, audit log) with a
      500-user data set; API response compression and web bundle splitting (bpmn-js, TipTap); a job queue for
      Git sync, e-mail and reminders; Playwright smoke tests in CI.

What changed (steps 1–5):

- `DEFAULT_MFA_REQUIRED_ROLES` (Super Admin, Admin) is the shipped Settings → Authentication value; a fresh
  installation asks the first administrator to enrol at the first password sign-in (README, DEPLOYMENT §6).
  The break-glass account always needs 2FA (`MfaService.isRequired(user)`). Settings page warns when either
  admin role is removed from the list; hints describe the policy (EN/AR).
- `REFRESH_TOKEN_TTL_HOURS` (default 24, max 2160) replaces `REFRESH_TOKEN_TTL_DAYS`; the API logs a warning
  when the old variable is still set (it is ignored). The lifetime is an idle timeout (rotation on every use).
- "Update roles at every sign-in" was already off by default; a test now shows a role changed in ProcessHub
  survives the next SSO sign-in.
- Node 22 LTS: `node:22-alpine`, CI `node-version: 22`, `.nvmrc` 22, `engines >=22.12`, `@types/node` 22.
- Docs: DECISIONS D-061 – D-066; DEPLOYMENT §6 (2FA at first sign-in), §6.1 (roles in ProcessHub, step 8
  passwords off, step 9 Conditional Access request text for IT), §6.2 (policy, sessions, leavers), new §6.3
  (break-glass account procedure); SECURITY controls / risks / go-live checklist; BACKLOG; README; CLAUDE.md.
- Test helpers: `resetDb` stores the `auth` setting with an empty 2FA list so suites not about 2FA can sign in
  with a password; `withDefaultAuthSettings` restores the shipped defaults (`mfa.e2e` "shipped defaults").

#### Verification (part 4)

| Check                                              | Result                                                                                                                                                                                                   |
| -------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm format:check`, `pnpm lint`, `pnpm typecheck` | clean                                                                                                                                                                                                    |
| `pnpm test`                                        | **401 tests pass** — shared 74, web 35, API 292 (new: shipped 2FA defaults ×3, break-glass always 2FA, 24-hour refresh cookie / token, role kept after SSO sign-in, default role list unit test)         |
| `pnpm build`                                       | passes                                                                                                                                                                                                   |
| `pnpm audit --prod`                                | no high/critical; the same 4 moderate as before (`minio` client, SEC-09)                                                                                                                                 |
| Docker images on Node 22                           | both images build from the committed Dockerfiles (sandbox-only CA line added in a scratch copy); API container: Node 22.23, migrations + seed, `openid-client` loads, fresh admin sign-in → `mfa: SETUP` |

Not re-run in this session: the full `docker compose up` stack and the Playwright smoke suite (they sign in
as viewer / reviewer / owner, which the new default does not affect).

### Next (continue here)

1. Review and merge `phase-6-part-4`. After deploying: an existing `auth` setting saved before this change
   keeps its stored 2FA list — check Settings → Authentication (go-live checklist); replace
   `REFRESH_TOKEN_TTL_DAYS` with `REFRESH_TOKEN_TTL_HOURS=24` in `.env`.
2. Product owner: confirm the scope of part 4 step 6 (performance / reliability / polish) and whether the
   24-hour lifetime should also be an absolute limit (today: idle timeout; see D-065, BACKLOG).
3. Send the Conditional Access request (DEPLOYMENT.md §6.1 step 9) to IT; create the break-glass account
   (§6.3) when SSO is rolled out.

### Part 3 — Single sign-on (OIDC / Entra ID) and TOTP two-factor (done, awaiting review)

Design (details in DECISIONS D-055 – D-060 once written):

- OIDC authorization-code flow with PKCE, state and nonce via `openid-client` 6 (OpenID-certified);
  Entra ID = issuer `https://login.microsoftonline.com/<tenant id>/v2.0`, any other provider = issuer URL
  (discovery). Settings key `auth` (Super Admin, Settings → Authentication); client secret AES-256-GCM.
  Callback `GET /api/v1/auth/sso/callback` (redirect URI `${APP_URL}/api/v1/auth/sso/callback`); flow state in
  an encrypted, 10-minute, `SameSite=Lax` cookie limited to `/api/v1/auth/sso`. IdP calls go through the
  SSRF policy (`OUTBOUND_ALLOWED_HOSTS`).
- Users matched by (issuer, subject), then linked once by e-mail; just-in-time creation with a default role
  and department; group → roles/department mapping (optional sync on every sign-in); allowed e-mail domains.
- Local (password) sign-in can be switched off except for one break-glass Super Admin; env
  `AUTH_FORCE_LOCAL_LOGIN=true` re-enables it in an emergency.
- TOTP (`otpauth`, RFC 6238, 30 s, 6 digits, ±1 step, no code reuse) for local accounts; QR code shown with
  Ant Design `QRCode`; 10 single-use recovery codes (stored as SHA-256); admin can require 2FA per role and
  reset a user's 2FA. Password sign-in then needs a second step (`ph_mfa` challenge cookie, 5 minutes).

Steps (tick as they are committed; a new session continues at the first unticked one):

- [x] 1. Shared schemas/types/constants (auth settings, MFA, login response, audit actions); Prisma migration
      (User SSO + TOTP fields, `MfaRecoveryCode`); Jest transform for ESM-only `openid-client`.
- [x] 2. API: TOTP service, enrolment / disable / recovery-code endpoints, two-step password login,
      "required for role" setup during login, admin reset; unit + e2e tests. **Done:** `src/auth/totp.ts`
      (+ spec), `MfaService`, `AuthSettingsService` (settings key `auth`, `GET/PUT /settings/auth`, public
      `GET /auth/options`), login returns `{ mfa: 'VERIFY' | 'SETUP' }` + `ph_mfa` cookie; endpoints
      `POST /auth/login/mfa`, `/auth/login/mfa/setup[/confirm]`, `GET /auth/mfa`, `POST /auth/mfa/{setup,enable,
disable,recovery-codes}`, `POST /users/:id/mfa/reset`. A wrong code counts towards the password lockout
      and a correct password no longer resets the counter while the code is pending. Accounts without a
      password (`passwordHash = ''`, SSO) cannot use password sign-in (same timing as a wrong password).
      `test/mfa.e2e-spec.ts` (10 tests); route-security lists and SECURITY.md route table updated.
- [x] 3. API: authentication settings (Super Admin, encrypted secret), OIDC start/callback, JIT users, group
      mapping, allowed domains, local sign-in restriction + break-glass; e2e tests with a mocked identity
      provider (local discovery / JWKS / token endpoint). **Done:** `src/auth/sso/` (`OidcClient` — the only
      code talking to the provider, through `common/safe-fetch.ts` + SSRF policy; `SsoService`; pure
      `sso-claims.ts` + spec; `SsoController`: `GET /auth/sso/start`, `GET /auth/sso/callback`,
      `POST /settings/auth/test`). ID-token signatures are verified even from the token endpoint
      (`enableNonRepudiationChecks` — found by the "foreign key" test). Mock provider
      `test/fixtures/mock-idp.ts`; `test/sso.e2e-spec.ts` (26 tests); SSO client secret and TOTP secret added
      to the cross-cutting secret-leak test. Env `AUTH_FORCE_LOCAL_LOGIN`, `SSO_HTTP_TIMEOUT_MS` (both Compose
      files, `.env.example*`). API: 289 tests pass.
- [x] 4. Web: login page (SSO button, 2FA step, 2FA set-up step), Profile → two-factor, Settings →
      Authentication, Users (2FA status, reset, SSO badge); EN/AR translations; Vitest. **Done:**
      `features/auth/LoginPage.tsx` (SSO button → `/api/v1/auth/sso/start?returnTo=…`, `?ssoError=` alert,
      password form hidden behind "Administrator sign-in" when password sign-in is off, verify / set-up /
      recovery-codes steps), `MfaParts.tsx` (Ant Design `Input.OTP` + `QRCode`, recovery codes copy/download),
      `features/profile/TwoFactorCard.tsx`, `features/settings/AuthSettingsCard.tsx` (on the Settings page),
      Users page tags + "Reset 2FA", `api/auth.ts`; `LoginPage.test.tsx` (4 tests); i18n test covers the new
      dynamic keys.
- [x] 5. Docs (DECISIONS, SECURITY, DEPLOYMENT/README Entra ID guide, BACKLOG, CLAUDE.md), full verification,
      push. **Done:** DECISIONS D-055 – D-060; SECURITY.md SEC-10 / SEC-11 (both found and fixed in this part),
      A07 controls, rate limits, risks, go-live and pen-test checklists, route table regenerated;
      DEPLOYMENT.md §6.1 (Entra ID step by step, other providers, secret renewal, emergency switch), §6.2 (2FA),
      troubleshooting rows; README (features, configuration, security highlights); BACKLOG; CLAUDE.md phase
      table, §7, §9.

#### Verification (part 3)

| Check                                                 | Result                                                                                                                                                                                                                                    |
| ----------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm format:check`, `pnpm lint`, `pnpm typecheck`    | clean                                                                                                                                                                                                                                     |
| `pnpm test`                                           | **397 tests pass** — shared 73, web 35, API 289 (38 suites; new: `mfa.e2e` 10, `sso.e2e` 26, `totp` + `sso-claims` unit, `LoginPage.test.tsx` 4, schema tests 9; secret-leak test extended with the SSO secret and TOTP secret)           |
| `pnpm build`                                          | passes; the built API loads the ESM-only `openid-client` through `require(esm)`                                                                                                                                                           |
| `pnpm audit --prod`                                   | no high/critical; the same 4 moderate as before (`minio` client, SEC-09)                                                                                                                                                                  |
| Browser walkthrough (built API + Vite + mock OIDC)    | Playwright script: Settings → Authentication filled via the UI, Test connection, save; 2FA enrolment with QR code and recovery codes; Arabic login page with SSO button; Arabic 2FA step; JIT SSO user with mapped role; Arabic SSO error |
| Playwright smoke suite (`pnpm e2e`, Vite + built API) | 8 pass                                                                                                                                                                                                                                    |

The walkthrough found and fixed three UI bugs before commit: the settings form dropped fields that were not
shown (tenant ID vs issuer) and was refused by the API; the SSO error on the login page did not follow the
language toggle; the six 2FA code boxes ran right-to-left in Arabic. Docker was **not** available in this
session (no daemon), so `docker compose up` from a clean clone was not re-run; the only container-relevant
changes are two new environment variables passed through in both Compose files (YAML validated) and the
`openid-client` runtime requirement Node ≥ 20.19 (`node:20-alpine` currently resolves to 20.19+).

### Next after part 3 (historical)

1. Review and merge `phase-6-part-3` (new migration `20261021180000_sso_mfa` runs automatically at start).
   Before relying on it in production: one real sign-in against your Entra ID tenant (DEPLOYMENT.md §6.1) —
   the tests use a mock provider.
2. Decisions for the product owner — see the session summary / D-055 – D-060: roles that must use 2FA at
   go-live; whether password sign-in is switched off after SSO roll-out; whether the directory manages roles
   ("update roles at every sign-in"); Entra ID Conditional Access MFA for SSO users.
3. Next Phase 6 parts (suggested order): slim API runtime image and images in a registry (also Node 22 LTS —
   Node 20 is end-of-life); performance; external penetration test with `docs/SECURITY.md` §8.

## Phase 6 part 2 — 2026-10-21 (production deployment, merged into `main`)

Phase 6 is split into small parts, one branch each (`phase-6-part-<n>` from the latest `main`). Part 1
(security review) is merged into `main`.

### Part 2 — Production deployment, backups and storage (done, awaiting review)

Steps (tick as they are committed; a new session continues at the first unticked one):

- [x] 1. Replace the frozen MinIO image (D-009) with a maintained S3-compatible store in `docker-compose.yml`;
      migration script for files in an existing MinIO volume; DECISIONS entry. **Done:** Versity S3 Gateway
      (`versity/versitygw:v1.9.0`, objects as plain files + metadata sidecar, D-051), service `storage`, volume
      `storage-data`; `scripts/migrate-minio-storage.sh` (tested: 25 files copied, checksums and content types
      match); shared helpers in `scripts/lib.sh`.
- [x] 2. `docker-compose.prod.yml` + `deploy/Caddyfile`: Caddy with automatic HTTPS (only 80/443 published),
      internal network for database and storage, health checks, restart policies, resource limits, log rotation.
      **Done** and tested in Docker (DOMAIN=localhost, `CADDY_TLS=internal`): all five services healthy, only
      80/443 published, http → https (308), HSTS + CSP, postgres/storage have no internet and no host ports, the
      API resolves external hosts; sign-in, Arabic page and an 8 MB attachment work over HTTPS; audit log shows
      the client IP (`TRUST_PROXY=2`). **Fixed on the way:** nginx `client_max_body_size` 6m → 11m (attachments
      may be 10 MB; 6–10 MB uploads used to fail with nginx's untranslated 413).
- [x] 3. `.env.example.prod` with secure defaults + `scripts/generate-secrets.sh`. **Done:** secrets are
      required in production (Compose refuses to start without them, so they live in `.env` and are backed up
      with it); `COMPOSE_FILE` in `.env` makes plain `docker compose` use the production file; the script
      only fills `__GENERATE__` values (safe to re-run), sets `chmod 600`, prints the first admin password once.
- [x] 4. `scripts/backup.sh` / `scripts/restore.sh` (PostgreSQL dump + file storage + key fingerprint), daily
      schedule example; restore tested end to end on the production stack. **Done:** `backup.sh` (dump checked
      with `pg_restore --list`, storage volume as `tar.gz`, `MANIFEST.txt` with the encryption-key fingerprint,
      `SHA256SUMS`, retention `BACKUP_KEEP_DAYS`, optional `--with-env`), `restore.sh` (checksums, key
      fingerprint warning, typed confirmation, automatic `pre-restore` backup, drop/recreate database, replace
      files, wait for the API), `deploy/processhub-backup.cron` (02:30 daily). **Disaster drill passed:**
      `docker compose down -v` → fresh empty stack → restore (33 s) → the Arabic page and the 8 MB attachment
      are back byte for byte. Damaged backup, different key and "no" at the prompt are refused/warned.
      Migration script also verified on the production stack (internal network). `shellcheck` clean.
- [x] 5. `docs/DEPLOYMENT.md` for a non-developer IT person. **Done:** architecture, sizing (≤250 / 250–500
      users, Azure UAE North / AWS me-central-1 instance types), VM creation (portal / console), data disk,
      firewall, Docker install, configure, DNS, start, first sign-in, HTTPS options (Let's Encrypt, company
      certificate, internal — the latter two verified in Docker), backups incl. off-site copies, restore incl.
      new server, updates (incl. MinIO migration and trial → production), monitoring, troubleshooting, reference.
- [x] 6. Verification, docs (DECISIONS D-051 – D-053, BACKLOG, README, SECURITY §6/§7, CLAUDE.md phase table and
      stack), CI (production compose file validated, `shellcheck` on `scripts/`), push.

#### Verification (part 2)

| Check                                              | Result                                                                                                                                  |
| -------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm format:check`, `pnpm lint`, `pnpm typecheck` | clean                                                                                                                                   |
| `pnpm test`                                        | **332 tests pass** — shared 64, web 31, API 237 (no application code changed in this part)                                              |
| `pnpm build`                                       | passes                                                                                                                                  |
| `pnpm audit --prod`                                | no high/critical; the same 4 moderate as part 1 (`minio` client, SEC-09)                                                                |
| Trial stack (`docker-compose.yml`, clean clone)    | five services healthy with the new `storage` service; 8 Playwright smoke tests pass on `http://localhost:8080`                          |
| Production stack (`docker-compose.prod.yml`)       | see steps 2 and 4: HTTPS (internal CA and company certificate), isolation, 8 MB upload, backup, disaster-drill restore, MinIO migration |
| `shellcheck -s sh scripts/*.sh`                    | clean                                                                                                                                   |

Docker in the sandbox: as before, base images from `mirror.gcr.io` (re-tagged locally) and the app images built
from the committed Dockerfiles with an uncommitted CA line and `docker build --network host`.
Let's Encrypt itself could not be tested here (no public DNS); the Caddyfile path is the same as for
`internal` and company certificates, which were both verified.

### Next after part 2 (historical)

1. Review and merge `phase-6-part-2`. Existing installations: after updating, run
   `./scripts/migrate-minio-storage.sh` once (copies files from the old `minio-data` volume).
2. Decisions taken by the product owner (D-054): Versity S3 Gateway confirmed; backups never include `.env`
   (keys in the password manager); off-site backups to Azure Blob Storage, UAE North, 90 days (DEPLOYMENT.md
   §7); `braces` accepted, Jest → Vitest added to BACKLOG.
3. Next Phase 6 parts (suggested order): TOTP two-factor and SSO (Azure AD / OIDC); slim API runtime image and
   images in a registry; performance; external penetration test with `docs/SECURITY.md` §8.

## Phase 6 part 1 — 2026-10-21 (security review, merged into `main`)

Phase 6 is split into small parts, one branch each (`phase-6-part-<n>` from the latest `main`). The AI phase
is merged into `main`.

### Part 1 — Security review and fixes (done, awaiting review)

Steps (tick as they are committed; a new session continues at the first unticked one):

- [x] 1. Route inventory (`apps/api/test/route-inventory.ts`) and authorisation matrix
      (`test/authorization-matrix.e2e-spec.ts`): every mutating route called as Viewer / Auditor / Reviewer
      on the demo seed (items in every state, a view-restricted space) changes nothing; Viewers get 403/404 on
      every workspace GET. No gaps found.
- [x] 2. Headers / CSP, CORS, cookies, CSRF: the CSRF guard also checks `Origin` (CORS_ORIGINS or the
      request host; blocks sub-domain cookie tossing); nginx security headers moved into one snippet
      included by every location (`/` and `/assets/` had lost `Permissions-Policy`), plus COOP.
      Tests: `test/security.e2e-spec.ts`.
- [x] 3. XSS: rich text (DOMPurify server + client, same allow-list), BPMN (DTD/entities rejected,
      labels rendered as SVG text), comments / search snippets / AI answers (React text only, no
      `dangerouslySetInnerHTML` anywhere), emails (escaped, links from `APP_URL`), downloads
      (`attachment`, `nosniff`, `sandbox` CSP). Fixed: SVG logos lose external CSS references
      (`@import`, `url(https://…)`), logo response gets `sandbox`; more SVG vectors in the unit test.
- [x] 4. Uploads (allow-list + magic bytes + size limits — fine), path traversal (process codes / space
      keys are regex-checked, Git paths drop `..`, storage keys are UUIDs — fine). **SSRF fixed**:
      `src/common/outbound.ts` blocks internal addresses for Git (GitLab / GitHub Enterprise URL) and SMTP
      unless listed in the new `OUTBOUND_ALLOWED_HOSTS` (Compose default `mailpit`); the checked address is
      the one connected to (no DNS rebinding); plain `http://` Git URLs only for allowed hosts; redirects are
      never followed; new error code `GIT_HOST_BLOCKED` (EN/AR). The AI provider URL is not configurable in
      the UI (only `ANTHROPIC_BASE_URL` in the environment).
- [x] 5. Secrets: Git token, SMTP password and AI key are write-only, encrypted (AES-256-GCM) and
      scrubbed from error messages; a new cross-cutting test configures all three plus user passwords,
      triggers failing Git / email calls and checks API responses, audit entries, stored settings, sync
      items and log output for any plaintext secret or password hash; refresh tokens stored hashed.
      **Fixed:** `SecretBox.decrypt` now requires a full 16-byte GCM tag (Node accepted truncated tags).
- [x] 6. Dependencies: `react-router-dom` 6 → 7.18 (two advisories; the app already used every v7 future
      flag, so only the flag props were removed), `vitest` 3 → 4.1 (path traversal in the dev server),
      `js-yaml` ≥ 5.4.1 via an override (from `@nestjs/swagger`). `pnpm audit --prod`: no high/critical,
      4 moderate in MinIO's `stream-json` / `decode-uri-component` (code paths not used — SECURITY.md).
      Full audit: 1 high, `braces` via Jest (dev-only, no fixed version exists) — decision needed.
- [x] 7. `docs/SECURITY.md`: scope and method, findings SEC-01 – SEC-09 with status, controls per OWASP
      category, rate limits, the endpoint table (generated; `route-security.e2e-spec.ts` fails when it is out
      of date, when an input is unvalidated or a route lacks an access declaration), remaining risks, go-live
      configuration checklist and an external penetration-test checklist. DECISIONS D-047 – D-050, BACKLOG,
      README (security highlights, `OUTBOUND_ALLOWED_HOSTS`), CLAUDE.md phase table updated.

#### Verification (part 1)

| Check                                              | Result                                                                                                                                                                         |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `pnpm format:check`, `pnpm lint`, `pnpm typecheck` | clean (lint found `react-refresh` warnings hidden by the removed `ROUTER_FUTURE` export; fixed by moving the route guard components to `apps/web/src/app/RouteGuards.tsx`)     |
| `pnpm test`                                        | **332 tests pass** — shared 64, web 31, API 237 (34 suites; new: `authorization-matrix`, `security` e2e, `outbound` unit, route-security extended, SVG and GCM-tag unit tests) |
| `pnpm build`                                       | passes                                                                                                                                                                         |
| `pnpm e2e` (Playwright, Vite dev + built API)      | 8 smoke tests pass on React Router 7 (also exercises the CSRF origin check through the Vite proxy)                                                                             |
| nginx                                              | `nginx -t` passes in `nginx:1.27-alpine`; `/`, `/assets/…` and SPA routes all return CSP, Permissions-Policy, COOP, X-Frame-Options                                            |
| SMTP through the SSRF guard                        | real delivery to Mailpit when allowed (connects to the checked IP with `servername`); refused when not listed                                                                  |
| `pnpm audit --prod`                                | no high/critical; 4 moderate (MinIO transitive, unused paths — SEC-09). Full audit: 1 high `braces` (dev-only via Jest, no fix — SEC-08)                                       |

Docker: as in earlier phases the sandbox reaches the internet only through a TLS-intercepting proxy, so base
images came from `mirror.gcr.io` and the two app images were built from the committed Dockerfiles in a clean
clone with an uncommitted CA line and `docker build --network host`, then started with `docker compose up`.
Result: five services healthy, demo seeded; nginx sends the full header set on SPA routes; the 8 Playwright
smoke tests pass against `http://localhost:8080`; Settings → Email test mail reaches Mailpit through the SSRF
guard (`OUTBOUND_ALLOWED_HOSTS=mailpit`); a foreign `Origin` gets `CSRF_INVALID`. This check found that the
web image no longer type-checked after the Vitest 4 upgrade (Node types were only pulled in transitively):
`@types/node` is now a web dev dependency and listed in the web tsconfig.

### Next (at the end of that part — superseded)

1. Review and merge `phase-6-part-1` (new env var `OUTBOUND_ALLOWED_HOSTS`: add internal Git / SMTP servers
   to it on existing installations, otherwise they are blocked).
2. Decisions for you: `braces` (BACKLOG "Needs a decision"); whether TLS/HSTS will be handled by your own
   reverse proxy (the deployment guide part will document it either way).
3. Next Phase 6 parts (suggested order): TOTP two-factor and SSO (Azure AD / OIDC); slim API runtime image
   (removes dev dependencies, SEC-08); performance; deployment guide; external penetration test with
   `docs/SECURITY.md` §8.

## AI phase — 2026-10-21 (merged into `main`)

**Phase "AI" (M16 AI Assistant) is complete on branch `phase-ai-assistant`, awaiting review.** Phases 1–3 are
merged into `main`. The brief was built in three parts, committed separately (A, B, C) — all done, documented in
`docs/AI-DEMO.md` (manual demo script with a real key) and DECISIONS D-038 – D-046.

### Done in this phase

**Phase 3 open items (decided by the product owner)** — commit "Governance: block self-approval…"

- Four-eyes principle: a submitter who is the only possible approver of a step cannot submit
  (`SELF_APPROVAL_NOT_ALLOWED`, bilingual message with the step name) (D-038).
- New system role **Auditor**: read-only workspace (drafts, history, reviews, audit log, dashboard,
  AI usage), no edit/comment/approve/publish; new permission `reviews.decide` keeps read-only users out of
  approval steps (D-039). Demo user `auditor@processhub.local`. Viewers stay portal-only.
- PDF stays browser print (Gotenberg remains in the Phase 6 backlog).

**Part A — AI platform, generate process from text, translate EN ↔ AR**

- `apps/api/src/ai`: provider interface + Anthropic Claude (`@anthropic-ai/sdk`, streaming, structured
  output, refusal fallback), gateway with access checks, per-user daily and organisation monthly limits,
  one repair attempt for invalid output, usage table + audit log (D-040, D-041). SSE streaming to the UI.
- Settings → AI (Super Admin): enable, provider, model / fast model, encrypted API key (write-only),
  test connection, allowed roles, limits, data notice EN/AR, suggestion chips per feature.
  **AI usage** page (Administration menu): totals per user, feature, model, 12-month trend.
- Feature 1 — generate a process from a description (Arabic or English): in the modeler (✨ AI menu →
  replaces the diagram, saved as draft) and in the "New process" dialog (fills names/descriptions, saves the
  diagram as the new process's draft model). Server builds BPMN with lanes per role and a layered layout
  (D-042), validates it, proposes links to library roles/IT systems (user confirms), lists roles/systems not in
  the library, shows validation warnings. Preview with a read-only diagram before anything is saved.
- Feature 4 — translate: form fields (every bilingual form except people's names: "✨ Translate into …"
  fills the empty language), BPMN labels and step descriptions in the modeler (only missing ones, editable
  review table, applied as undoable edits), wiki pages (preview, then fills the other language tab). The
  library's EN/AR names are sent as a glossary.
- "AI-generated — review before publishing" badge on processes/pages until a human edits or approves (D-043).
- Suggestion chips: seeded demo prompts for every feature (Settings → AI → Suggestion chips).
- Tests: `FakeAi` replaces the provider in every test; `test/ai.e2e-spec.ts` (settings & key never
  returned, roles, limits, generate with library links, malformed fixtures → repair / rejection, provider
  errors, permissions, AI flag, translate fields/BPMN/page with sanitising, usage report),
  `src/ai/bpmn/structure-to-bpmn.spec.ts` (layout without overlaps, round trip, escaping).
- Also fixed: the modeler's "fit" now centres the diagram right of the palette (it used to sit off-centre).

**Part C — analyse & improve, portal Q&A** (D-045, D-046)

- Feature 5 — modeler ✨ AI → "Analyse & improve" (also for read-only users) and "Explain with AI" in the
  Validation tab: drawer with an assessment, findings (missing step, unclear responsibility, bottleneck, risk,
  control, improvement; severity; explanation; suggestion; clickable steps) and plain-language warnings.
- Feature 7 — Knowledge Portal: "✨ Ask" in the header and "Ask the assistant" + sample questions on the portal
  home. Answers stream, cite numbered sources (links to the published process/page with version label), say
  clearly when the published content does not cover the question. Retrieval: full-text search over current
  publications the user may see (no pgvector, D-045); processes contribute their published version only.
- Seed: published page "Requesting IT Equipment" (IT Policies) so the demo question has an answer.
- Tests: `test/ai-portal.e2e-spec.ts` (analysis with unknown ids dropped and repair; Q&A uses published content
  only — never drafts, restricted spaces without a grant, or the working copy of a process; grants; not-found
  without an AI call; AI roles and portal access), `toAnyTsQuery` unit test.

### Next (at the end of that part — superseded)

1. Review and merge `phase-ai-assistant`; run `docs/AI-DEMO.md` once with a real API key before the management
   demo (the suite only uses a fake provider).
2. Decisions for you: see "Needs a decision" in `docs/BACKLOG.md` and the AI follow-ups listed there.
3. Then Phase 4: GRC, EA, KPIs + Salesforce.

### Verification (AI phase)

| Check                                                                                                                                       | Result                                                                                                                                                                                                                                                                                                                                                                                                              |
| ------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm format:check`, `pnpm lint`, `pnpm typecheck`                                                                                          | clean                                                                                                                                                                                                                                                                                                                                                                                                               |
| `pnpm test`                                                                                                                                 | **286 tests pass** — shared 64, web 31, API 191 (31 suites; new: `ai`, `ai-features`, `ai-portal`, `auditor` e2e, layout/outline/diff unit tests). The AI provider is always the fake `FakeAi`; malformed-output fixtures prove validation and the single repair attempt                                                                                                                                            |
| `pnpm build`                                                                                                                                | passes                                                                                                                                                                                                                                                                                                                                                                                                              |
| `pnpm audit --prod --audit-level high`                                                                                                      | no high/critical (7 moderate, pre-existing; the Anthropic SDK adds none). Full audit: only the known dev-only `braces` advisory (BACKLOG)                                                                                                                                                                                                                                                                           |
| `docker compose up` from a clean clone                                                                                                      | five services healthy; all 4 migrations applied; full demo seeded incl. AI demo settings (disabled) and the "Requesting IT Equipment" page; with AI disabled `/ai/status` says DISABLED, AI endpoints 403 and no ✨ buttons render; after enabling (key via API) generation streams through nginx unbuffered (SSE chunks arrive progressively) and the portal assistant answers with its source                     |
| Browser (Playwright, dev servers; the real `AnthropicProvider` against a local mock of the Messages streaming API via `ANTHROPIC_BASE_URL`) | Settings → AI save + test connection; New process → generate → preview → create; modeler label translation; page and form-field translation; refine with chat → compare → accept; summary, "what changed" on the review screen; SOP generation → page created; process from page; analyse drawer with clickable steps; portal assistant EN/AR incl. "not covered"; AI usage page; Arabic RTL and 390 px phone width |

Docker note: as in earlier phases the sandbox reaches the internet only through a TLS-intercepting proxy, so the
base images came from `mirror.gcr.io` and the two app images were built from the committed Dockerfiles in a clean
clone with an uncommitted CA line and `docker build --network host`, then started with `docker compose up`.

Also found and fixed while testing in the browser: the modeler's fit-to-screen placed diagrams under the palette
(now centred in the free area); the Settings → AI form dropped the suggestion chips when saved with the panel
collapsed; generated diagrams got new process/pool ids on every refinement (now kept, so the compare matches).

## Phase 3 — 2026-10-21 (merged into `main`)

**Phase 3 (Governance M8, Knowledge Portal M9): complete, merged into `main`.** Phases 1 and 2 are merged into `main`. Every item of the Phase 3 brief is implemented, covered by
API tests (including a Viewer sweep over every route) and Playwright smoke tests, and verified in the browser
(English and Arabic, desktop and phone width) and with `docker compose up` from a clean clone.

Decisions taken at the start of Phase 3 (by the product owner): keep `bitnamilegacy/minio` (Phase 6); keep
browser "Save as PDF" (D-024/D-035, Gotenberg noted for Phase 6); never export pages of view-restricted spaces;
warn about backing up `INTEGRATIONS_ENCRYPTION_KEY` (Settings → Integrations and README); Viewers see
published content only, through the portal (D-028). The blueprint gained **M16 AI Assistant**, planned after
Phase 3 (not built).

### Phase 3 — done

**Governance (M8)**

- Lifecycle Draft → In Review → Approved → Published → Archived, plus "Changes requested" / "Rejected" back to
  Draft, for processes and pages. Transitions enforced on the server (one table in `packages/shared`), atomic,
  audited (D-029). In-review and archived items are locked; editing an approved/published item makes a new
  working copy (Draft) while the published version stays live in the portal.
- Publications: each publication is linked to a saved version and its label (e.g. `v2.0`), records approvers,
  approval date and publisher; the item gets its next review date. History of reviews and publications per item.
- Workflows (Settings → Workflows): templates with sequential steps; assignees are users, a system role
  (optionally within a department) or the item owner; rule "any one of" or "all"; optional auto-publish.
  Defaults globally, per process category and per space; per-item template or custom steps (D-030). Assignees
  are snapshotted at submission; submitters never approve their own items.
- Review page: visual BPMN diff (or page text diff) against the published version, change list, the
  submitter's note, step progress; approve, request changes (comment required) or reject (comment required).
- Comments: threaded, on processes and pages, anchored to BPMN elements (💬 badges on the canvas, Comments tab
  in the modeler), @mentions with autocomplete, resolve/reopen, edit/delete own (D-032).
- Notifications: bell with unread count, notification centre, per-user preferences for email by type. Events:
  review requested, changes requested, rejected, approved, published, mentioned, reply, review due/overdue,
  feedback received/updated. Email via SMTP settings (Settings → Email, encrypted password, test email),
  bilingual HTML templates; Mailpit in Docker Compose; tests use a fake transport (D-033).
- Review dates: next review on publication (default 12 months), reminders before and after the due date by a
  scheduler, overdue flags, "confirm still valid"; review due dates for running reviews (D-034).
- My tasks (reviews to do, returned items, items to publish, due periodic reviews, mentions, feedback) and
  the Governance dashboard (counts per state, running reviews with their age, overdue and soon-due periodic
  reviews, recent publications, open feedback).
- Documents library (repository object type DOCUMENT) so steps can link to documents shown in the portal;
  step descriptions (EN/AR) in the modeler side panel; job roles on users (for "My processes").

**Knowledge Portal (M9)** at `/portal`, the home of Viewers

- Home: portal name/tagline and logo, search hero, process house, featured and recently published items,
  quick links. Process browser (tree per category) and process page: diagram with clickable steps (performers,
  systems, documents, description), drill-down into sub-processes, linked documentation.
- Documentation: spaces, page tree, page with table of contents, embedded diagrams, related processes.
- Search in English and Arabic with type/category/space filters and highlighted snippets (D-031).
- "My processes": items owned by me, of my department or performed by my job roles (with "your steps").
- Every item shows version label, approval date, approver(s), owner, next review date and an "Official" badge.
- Feedback on any item, routed to the owner (status Open / In progress / Done, reply, notifications);
  "My feedback" page.
- Download PDF: print-optimised view (diagram + step details / page content, metadata, Arabic RTL) that opens
  the print dialog (D-035).
- Settings → Knowledge Portal: name and tagline EN/AR, featured items, quick links, access (all users or
  selected departments and roles).
- Viewers cannot reach draft, in-review, approved-unpublished or archived content via any endpoint (D-028);
  workspace URLs redirect them to the portal.
- Git: "Published versions only" option (D-036).

**Seed data** (demo installation)

- Demo users per role: viewer / reviewer / owner / modeler `@processhub.local`, password `SEED_DEMO_PASSWORD`
  (default `Demo-Password1`); email settings pointing at Mailpit.
- Two workflows ("Standard approval (two steps)": Quality review by any Reviewer → Owner approval; "Policy
  review (any one reviewer)").
- Content in every state: S.01.01 published v1 with v2 in review; C.02 in review with the overdue owner step;
  C.03 approved, waiting for publication; M.01 published 13 months ago (periodic review overdue); M.02
  archived; S.02 changes requested; pages published / in review / approved.
- Comments with replies and mentions, notifications, two feedback items, portal settings with featured items
  and quick links.

### Verification (Phase 3 session)

| Check                                              | Result                                                                                                                                                                                                                 |
| -------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm format:check`, `pnpm lint`, `pnpm typecheck` | clean                                                                                                                                                                                                                  |
| `pnpm test`                                        | **238 tests pass** — shared 61, web 31, API 146 (25 suites; new: governance, portal incl. Viewer sweep and Git published-only, comments and notifications, email templates)                                            |
| `pnpm e2e` (Playwright)                            | 8 smoke tests pass against the Vite dev server and against the Docker stack                                                                                                                                            |
| `pnpm build`                                       | passes                                                                                                                                                                                                                 |
| `pnpm audit --prod --audit-level high`             | no high/critical (nodemailer upgraded to 10.0.16); 7 moderate, pre-existing. The full audit still lists the dev-only `braces` advisory (no upstream fix, see BACKLOG)                                                  |
| `docker compose up` from a clean clone             | five services healthy (postgres, minio, mailpit, api, web); migrations and full demo seeded; test email and a scheduler reminder delivered to Mailpit                                                                  |
| Browser (Playwright screenshots)                   | portal home/process/page/search/print (EN + AR RTL, 390 px phone), review page with BPMN diff, approve → approve → publish v2.0 flow, feedback, @mention comment, My tasks, dashboard, workflows/portal/email settings |

Docker note: as in earlier phases this sandbox reaches the internet only through a TLS-intercepting proxy and
Docker Hub rate-limited it, so the base images were pulled from `mirror.gcr.io` and the two app images were
built from the committed Dockerfiles in a clean clone, with an uncommitted CA line and `docker build --network
host`, then started with `docker compose up`. The committed Dockerfiles need no change.

### Phase 2 (Documentation wiki, version control, Git) — done, merged into `main`

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

### Verification (Phase 2 session)

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

See "Next (continue here)" at the top. After the AI phase: Phase 4 (GRC, EA, KPIs + Salesforce).

## Known issues / limitations

- AI: tested only against a mocked provider (no real API calls in the suite); run `docs/AI-DEMO.md` with a
  real key before a demo. Generating into an existing process replaces its diagram (the layout is
  automatic; hand-made positions are not kept) — save a version first. Requests run in the API process
  (no queue); the per-user/organisation limits are counted from the usage table.

- PDF export uses the browser's print dialog ("Save as PDF"), not a direct download (D-024, D-035).
- Emails and reminders run in-process; with several API instances the scheduler runs in each (reminders are
  de-duplicated in the database, but a queue is in the backlog). Notifications refresh every minute (polling).
- The Playwright smoke tests are not yet in CI (they need the whole stack).
- Git sync: one-way; process renames/moves without a new version reach Git with the next version or
  "Sync now"; jobs run in-process (single API instance); pages of view-restricted spaces are not exported.
- Autosaved page drafts are per user; two people editing the same page at once get a conflict on the second
  save (no live co-editing).
- MinIO uses the frozen `bitnamilegacy/minio` image (D-009, revisit in Phase 6).
- Secure cookies (`COOKIE_SECURE=true`, the default) need HTTPS or `localhost`.
- The API e2e tests **truncate every table** of the database in `TEST_DATABASE_URL`. Never point it at real data.
- `INTEGRATIONS_ENCRYPTION_KEY` must be backed up with the data; if it changes, stored Git tokens and the SMTP
  password must be re-entered.
- Moderate dependency advisories (react-router 6, minio, swagger transitive) — see BACKLOG.
- External BPMN labels keep their original size when the language is switched (from Phase 1).
