# Workflow execution — admin guide

ProcessHub runs approved processes as task flows (module M14, Phase 5.2): a published process becomes a
**service** that people start from the Knowledge Portal; each **request** (case) moves through the steps of the
process with forms, assignments, approvals, due dates, reminders and escalation, and every completed step feeds a
process mining event log. This guide explains how to set it up. Background and design decisions: `DECISIONS.md`
D-144 – D-152.

## 1. Who can do what

| Permission         | Default roles                              | What it allows                                                                                                      |
| ------------------ | ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------- |
| `workflow.design`  | Super Admin, Admin, Process Owner, Modeler | Execution settings of processes the user may edit; deployment only by the process's own Process Owner (and admins)  |
| `workflow.start`   | Every role except Auditor                  | Start requests from the service catalogue (plus each process's start rights)                                        |
| `workflow.monitor` | Super Admin, Admin, Process Owner, Auditor | Monitor and dashboard of the processes of one's department or where one is named monitor (Auditors: all, read-only) |
| `workflow.admin`   | Super Admin, Admin                         | All processes: retry stuck requests, cancel, reassign tasks; Settings → Workflow execution                          |

Working on a task needs no permission: the assignee (or a member of the group) completes it. A request is visible
to its requester, everyone who worked or works on it, the process owner, monitors of the process and Auditors —
checked on the server for every page and download.

## 2. Make a process executable

1. **Model** the process in the modeler with the supported elements: plain or timer start event, user tasks
   (approval steps are user tasks marked "Approval step"), exclusive / parallel / inclusive gateways, business rule
   task (linked DMN decision), send task (notification), service task ("set data" or "generate Word document"),
   timer events (waiting, and boundary timers on tasks), call activity (linked process), end events (normal,
   terminate, error) and error boundary events. Anything else is reported by the executable check with what to use
   instead (e.g. a plain task → user task).
2. Open the process page → tab **Execution** → switch on **Executable**, choose the **case number prefix** (e.g.
   `PMS` → `PMS-2026-00012`), who may **start** requests (everyone with the start permission, or only some roles /
   departments), whether the requester may **withdraw**, extra **monitors**, form data **retention** and the **live
   event log** (optionally pseudonymised). Save.
3. The modeler now shows the **Execution** tab in the side panel. Select an element to set how it runs (section 3).
   The **Validation** panel shows the **executable check**: errors block deployment, warnings do not.
4. Save a version, submit it for review and publish it as usual. Execution settings are part of the BPMN XML, so
   every change to a form, an assignment or a condition goes through the same review.
5. On the process page → **Execution** → **Deploy version N** — the **Process Owner of the process** or a workflow
   admin (D-154); Modelers set processes up but do not deploy, and cannot switch a deployed process off or change
   its start rights. Only the published version can be deployed; the
   server repeats the executable check, including the DMN decisions (they must be approved or published) and the
   linked processes of call activities (they must be executable and deployed).

Each request stays on the version it started with. Deploying a newer version only affects new requests (moving
running requests to a new version is not supported yet). The deployments table shows how many requests still
run on each version.

## 3. Execution settings per element

| Element              | Settings (Execution tab)                                                                                                                                                                                                       |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Start event          | **Start form**: what the requester fills in.                                                                                                                                                                                   |
| User / approval task | **Who does this step** (assignment rule), **due within** (working hours; default the step's SLA attribute), **escalation** target, **four-eyes**, **task form** (read-only fields show earlier data).                          |
| Sequence flow        | **Approval decision** (flows out of an approval step: Approve / Reject / Return for correction), **condition** (S-FEEL, e.g. `estimatedBudget >= 100000`), **default flow** (out of a gateway).                                |
| Business rule task   | Link a DMN decision in the Properties tab; its outputs (e.g. `budgetApproval`) become request data for the gateways after it.                                                                                                  |
| Send task            | **Notification**: recipients (assignment rules), bilingual subject and message with placeholders; sent in-app and by e-mail (according to each person's preferences).                                                          |
| Service task         | **Set data** (values computed with S-FEEL) or **Generate Word document** (bilingual title / text with placeholders, request data table). The document is attached to the request.                                              |
| Timer event          | ISO 8601 duration (`PT4H`, `P2D`), date, or cycle (`R3/PT1H`, start and non-interrupting boundary timers); optionally counted in working time. Boundary timers can interrupt the task or add a parallel path (reminder steps). |
| Error end / boundary | Error code: an error end event ends the request with it; an error boundary event on a task, call activity or automatic step catches errors (a failed decision or document, an error from a called process).                    |
| Call activity        | Link the process to call (Properties tab); the request waits until the called request is completed.                                                                                                                            |

**Assignment rules:** role of the lane (`Link role` on the lane), a role (optionally only in the requester's or a
given department), a specific user, the process owner, the requester, the requester's manager (department head;
the next level up if there is none), the performer of an earlier step, or a user chosen in a form field. One person
→ assigned task; several → **group task** that one of them claims. People who are **out of office** (profile →
Out of office: period and substitute) are replaced by their substitute. With **four-eyes** the requester and earlier
performers are left out and cannot complete the step.

**Forms:** fields with a data name (used in conditions, decisions and templates — the same name in two forms means
the same data), type (text, long text, number, amount, date, yes / no, dropdown, choice, multiple choice, user,
department, attachments, information text), English and Arabic label and help, required, read-only, limits and
options. **Preview** shows the form in both languages. The server validates every submission against the same
form (unknown fields, types, limits, options), so a modified browser cannot send other data.

**Expressions** use S-FEEL (the simple FEEL of the DMN standard): `budget >= 100000 and type = "digital"`,
`decision = "APPROVE"`, `days > 10`, `if amount > 5000 then "high" else "normal"`. No JavaScript is ever run.
Placeholders in templates: `{{fieldName}}`, `{{case.number}}`, `{{initiator.name}}`, `{{process.name}}` — the
result is plain text (no HTML).

## 4. Business calendar, SLAs, reminders and escalation

Settings → **Workflow execution** (`workflow.admin`): working week (Sunday–Thursday by default), working hours
(07:30–15:30), time zone (Asia/Dubai), reminder before due (default 4 working hours), default escalation target
(the assignee's manager, the process owner, both or nobody) and an optional repeat interval. Public holidays come
from the **central holiday list** (Process mining → Simulations → Public holidays, D-143). Due times are working
time: a task due in 16 working hours that starts on Thursday afternoon is due on Monday.

**Escalation fallbacks** (D-154): an unclaimed group task, and an assignee without a manager or who is the
department head, escalate to the process owner. Each process can override the reminder and the escalation delay
(process page → Execution → Reminder and escalation).

Reminders and escalations are notifications of type "Workflow tasks and requests" (in-app and e-mail per user
preference). Timers and these jobs are stored in the database and survive a restart; the API checks them every
`WORKFLOW_POLL_SECONDS` (default 15 s).

## 5. Working on requests

- **Services** (portal): start a request; the request page shows its number, status, the diagram with current and
  completed steps, the timeline (who, when, decision, comment), the data of every step, attachments and generated
  documents, and comments with @mentions. The requester can **withdraw** a running request when the process
  allows it.
- **My tasks** (workspace and portal) → **Workflow tasks**: assigned and group tasks with due-date colouring
  (amber: due within a day, red: overdue). Approval steps offer Approve / Reject / Return for correction (a comment
  is required for reject and return). Tasks can be saved without submitting, delegated to a colleague, or given
  back to the group. Two people completing the same task at the same moment: one wins, the other gets a message
  and a refreshed page.
- **My requests**: requests one started or works on.

## 6. Monitoring

- **Workflow monitor** (`workflow.monitor`): per process running / completed / cancelled requests, stuck requests
  with the problem (e.g. nobody can be assigned, a decision table without a matching rule, a document template
  error) and overdue tasks. Workflow admins can **retry** a stuck request after fixing the cause (e.g. give a user
  the job role), **cancel** a request with a reason, and **reassign** a task. Everything is in the audit log.
- **Workflow dashboard**: requests started and completed per week or month, throughput time (mean, P90, working
  hours), SLA compliance per step, workload per user / role / department, most overdue tasks; Excel export (only
  requests the user may monitor).
- **Live event log**: with "Feed a live event log" on, every completed step is an event in the process's event log
  (Process mining → Event logs, source "Live cases (workflow)"): process map, variants, conformance against the
  model and mining-based KPIs work on real executions. Pseudonymisation replaces performers with stable codes.

## 7. Data protection

Form data can contain personal data. Set a **retention** period per process (default: keep — decide at go-live,
see `DEPLOYMENT.md` go-live checklist): after it, the form data, comments and files of closed requests are removed;
case numbers, steps, dates and decisions remain for statistics and audit. Exports contain only requests the user
may see. Uploaded files are checked by content type and size (same rules as page attachments) and are only served
as downloads.

## 8. Demo data

Demo installations (`SEED_DEMO_DATA=true`) contain **PMS-01 Program / Initiative Request & Approval** (section
manager → department manager → budget approval when the estimated budget is AED 100,000 or more (DMN decision
"Program budget approval") → PMO (group task) → DG Office, return for correction, SLA per step, approval letter as
a Word document, notification) and **HR-01 Leave request** (manager approval, HR review for more than 10 working
days, set data, notification), with demo users `section@`, `pmo@`, `finance@`, `dgo@`, `hr@processhub.local`
(password `SEED_DEMO_PASSWORD`) and seven demo requests in different states. Requests are started as
`viewer@processhub.local` from the portal.
