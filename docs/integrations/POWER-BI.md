# Power BI and Excel: the reporting feed

ProcessHub publishes read-only **reporting tables** for Power BI and Excel: processes and their governance
state, reviews, KPIs and their values, risks, controls and coverage, control tests, issues, audit findings,
workflow volumes and SLA per step, and process-mining logs. Every table is flat (one row per fact, plain
columns, English and Arabic names side by side) and paged. Design: DECISIONS D-175; general API rules:
[API.md](API.md).

A ready-made `.pbit` template is not shipped (see D-175); the steps below build the model in about 15 minutes
and can be saved as your own template.

## 1. Create an API key

Settings → Integrations → API keys → **Create API key** (Super Admin):

- Name e.g. "Power BI – Strategy Office", owner = the report owner;
- scope **`reporting:read`** only;
- content: **Workspace** to report on drafts and items in review too (governance reports), or **Published
  content only**;
- optional departments (e.g. one directorate's report) and the IP address of the on-premises data gateway;
- copy the key (`phk_…`) — it is shown once.

## 2. Tables

`GET /api/public/v1/reporting` lists the tables; each one is `GET /api/public/v1/reporting/<table>` with
`page` (from 1), `pageSize` (≤ 1000, default 500) and optional `updatedSince`. Answer:
`{ "items": [...], "total": 1234, "page": 1, "pageSize": 1000 }`.

| Table                    | One row per             | Main columns                                                                                                                                    |
| ------------------------ | ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `processes`              | process                 | processId, code, nameEn/Ar, category, level, parentId, status, owner, department, publishedVersion, lastApprovedAt, nextReviewAt, reviewOverdue |
| `reviews`                | review (approval round) | reviewId, itemType, itemCode, itemNameEn/Ar, status, currentStepEn/Ar, submittedAt, dueAt, completedAt, overdue, daysOpen                       |
| `kpis`                   | KPI                     | kpiId, code, nameEn/Ar, unit, direction, frequency, target, thresholds, status, owner, department                                               |
| `kpi-measurements`       | KPI value               | measurementId, kpiId, period, periodStart, value, target, rag (GREEN / AMBER / RED)                                                             |
| `risks`                  | risk                    | riskId, code, nameEn/Ar, category, status, inherent / residual likelihood, impact, score, controls, linkedProcesses                             |
| `controls`               | control                 | controlId, code, nameEn/Ar, type, nature, frequency, keyControl, design / operating effectiveness, risks, lastTestedAt                          |
| `risk-coverage`          | process                 | processId, code, risks, controls, stepsWithRisks, stepsWithControls, stepsWithRiskWithoutControl                                                |
| `control-tests`          | control test            | testId, controlId, controlCode, period, status, conclusion, dueAt, overdue                                                                      |
| `issues`                 | issue                   | issueId, code, titleEn/Ar, sourceType, severity, status, departmentId, processId, dueAt, overdue                                                |
| `audit-findings`         | audit finding           | findingId, code, titleEn/Ar, rating, responseStatus, engagement, targetDate                                                                     |
| `workflow-cases-monthly` | process × month         | processId, month, started, completed, running, avgCompletionHours                                                                               |
| `workflow-sla`           | process × workflow step | processId, stepId, stepEn/Ar, tasks, completed, completedLate, openOverdue, onTimePercent, avgHours                                             |
| `mining-logs`            | event log               | logId, code, nameEn/Ar, cases, events, activities, periodStart, periodEnd                                                                       |

Workflow tables are aggregated: no case data and no person names.

## 3. Power BI Desktop

1. **Home → Transform data → Manage parameters → New**: `ProcessHubUrl` (Text, e.g.
   `https://processhub.example.com`) and `ProcessHubKey` (Text, the `phk_…` key).
2. **New source → Blank query**, open the **Advanced editor**, paste the function below and name the query
   `ProcessHubTable`:

   ```powerquery
   // Reads all pages of one ProcessHub reporting table.
   (table as text) as table =>
   let
       PageSize = 1000,
       GetPage = (page as number) =>
           Json.Document(
               Web.Contents(ProcessHubUrl, [
                   RelativePath = "api/public/v1/reporting/" & table,
                   Query = [page = Text.From(page), pageSize = Text.From(PageSize)],
                   Headers = [#"X-API-Key" = ProcessHubKey, Accept = "application/json"]
               ])
           ),
       First = GetPage(1),
       PageCount = Number.RoundUp(First[total] / PageSize),
       Rest = List.Transform(List.Numbers(2, List.Max({PageCount - 1, 0})), each GetPage(_)[items]),
       Rows = List.Combine({First[items]} & Rest),
       Result = if List.IsEmpty(Rows) then #table({}, {}) else Table.FromRecords(Rows, null, MissingField.UseNull)
   in
       Result
   ```

3. One blank query per table, e.g. `Processes`:

   ```powerquery
   let
       Source = ProcessHubTable("processes"),
       Typed = Table.TransformColumnTypes(Source, {
           {"level", Int64.Type}, {"publishedVersion", Int64.Type},
           {"lastApprovedAt", type datetimezone}, {"nextReviewAt", type date},
           {"reviewOverdue", type logical}
       })
   in
       Typed
   ```

   and likewise `Reviews` = `ProcessHubTable("reviews")`, `Kpis` = `ProcessHubTable("kpis")`,
   `KpiValues` = `ProcessHubTable("kpi-measurements")`, `Risks`, `Controls`, `RiskCoverage`, `ControlTests`,
   `Issues`, `AuditFindings`, `WorkflowMonthly` = `ProcessHubTable("workflow-cases-monthly")`,
   `WorkflowSla` = `ProcessHubTable("workflow-sla")`, `MiningLogs`.

4. When asked for credentials choose **Anonymous** for `ProcessHubUrl` (the key travels in the header) and
   privacy level **Organizational**.
5. **Relationships** (Model view): `KpiValues[kpiId]` → `Kpis[kpiId]`; `RiskCoverage[processId]`,
   `Issues[processId]`, `WorkflowMonthly[processId]`, `WorkflowSla[processId]` → `Processes[processId]`;
   `ControlTests[controlId]` → `Controls[controlId]`. `Processes[parentId]` → `Processes[processId]` is a
   hierarchy (use `PATH()` in a calculated column for drill-down).
6. Useful measures:

   ```dax
   Overdue reviews = CALCULATE(COUNTROWS(Reviews), Reviews[overdue] = TRUE())
   Processes due for review = CALCULATE(COUNTROWS(Processes), Processes[reviewOverdue] = TRUE())
   Red KPIs (latest) = CALCULATE(DISTINCTCOUNT(KpiValues[kpiId]), KpiValues[rag] = "RED")
   On-time % (workflow) = DIVIDE(SUM(WorkflowSla[completed]) - SUM(WorkflowSla[completedLate]), SUM(WorkflowSla[completed]))
   ```

7. **File → Export → Power BI template** saves your own `.pbit` (the key is not stored in it; parameters are
   asked when the template is opened).

### Scheduled refresh (Power BI service)

Publish the report, install / use the **on-premises data gateway** that can reach ProcessHub, add the data
source `ProcessHubUrl` to the gateway with authentication **Anonymous**, and set the refresh schedule (e.g.
daily at 06:00). Because the URL is fixed and paths are passed with `RelativePath`, the service accepts the
source for scheduled refresh. Put the gateway's address in the key's IP allow-list. Rotating the key = new
secret in the `ProcessHubKey` parameter (dataset settings → Parameters).

## 4. Excel

**Data → Get data → From other sources → Blank query**, then paste the same function and table queries (Excel
asks for the two parameters as normal queries: `ProcessHubUrl = "https://…" meta [IsParameterQuery=true]`).
**Refresh all** updates the workbook.

## 5. Field names (English / Arabic)

Use these as display names (Power BI: rename the column or set it in a translation). Bilingual columns end in
`En` / `Ar`: show the one of the report language.

| Field                                                  | English                                             | العربية                                             |
| ------------------------------------------------------ | --------------------------------------------------- | --------------------------------------------------- |
| processId                                              | Process ID                                          | معرّف العملية                                       |
| code                                                   | Code                                                | الرمز                                               |
| nameEn / nameAr                                        | Name (English) / Name (Arabic)                      | الاسم (إنجليزي) / الاسم (عربي)                      |
| titleEn / titleAr                                      | Title (English) / Title (Arabic)                    | العنوان (إنجليزي) / العنوان (عربي)                  |
| category                                               | Category (Management / Core / Support)              | الفئة (إدارية / أساسية / مساندة)                    |
| level                                                  | Level                                               | المستوى                                             |
| parentId                                               | Parent process                                      | العملية الأم                                        |
| status                                                 | Status                                              | الحالة                                              |
| ownerNameEn / ownerNameAr                              | Owner                                               | المالك                                              |
| ownerEmail                                             | Owner e-mail                                        | البريد الإلكتروني للمالك                            |
| departmentEn / departmentAr                            | Department                                          | الإدارة                                             |
| publishedVersion                                       | Published version                                   | الإصدار المنشور                                     |
| lastApprovedAt                                         | Last approval                                       | آخر اعتماد                                          |
| publishedAt                                            | Published on                                        | تاريخ النشر                                         |
| nextReviewAt                                           | Next periodic review                                | المراجعة الدورية القادمة                            |
| reviewOverdue                                          | Periodic review overdue                             | المراجعة الدورية متأخرة                             |
| reviewId                                               | Review ID                                           | معرّف المراجعة                                      |
| itemType / itemCode / itemNameEn / itemNameAr          | Item type / code / name                             | نوع العنصر / رمزه / اسمه                            |
| versionNumber                                          | Version                                             | الإصدار                                             |
| workflowEn / workflowAr                                | Approval workflow                                   | سير عمل الاعتماد                                    |
| currentStepEn / currentStepAr                          | Current step                                        | المرحلة الحالية                                     |
| submittedAt                                            | Submitted on                                        | تاريخ الإرسال                                       |
| dueAt                                                  | Due                                                 | تاريخ الاستحقاق                                     |
| completedAt                                            | Completed on                                        | تاريخ الإنجاز                                       |
| overdue                                                | Overdue                                             | متأخر                                               |
| daysOpen                                               | Days open                                           | عدد الأيام المفتوحة                                 |
| kpiId                                                  | KPI ID                                              | معرّف المؤشر                                        |
| unit                                                   | Unit                                                | الوحدة                                              |
| direction                                              | Direction (higher / lower is better)                | الاتجاه (الأعلى / الأدنى أفضل)                      |
| frequency                                              | Frequency                                           | الدورية                                             |
| target                                                 | Target                                              | المستهدف                                            |
| greenThreshold / redThreshold                          | Green / red threshold                               | حد الأخضر / حد الأحمر                               |
| baseline                                               | Baseline                                            | خط الأساس                                           |
| dataSource                                             | Data source                                         | مصدر البيانات                                       |
| period / periodStart                                   | Period / period start                               | الفترة / بداية الفترة                               |
| value                                                  | Value                                               | القيمة                                              |
| rag                                                    | Status (green / amber / red)                        | الحالة (أخضر / كهرماني / أحمر)                      |
| riskId / controlId                                     | Risk ID / Control ID                                | معرّف الخطر / معرّف الضابط                          |
| response                                               | Risk response                                       | الاستجابة للخطر                                     |
| inherentLikelihood / inherentImpact / inherentScore    | Inherent likelihood / impact / score                | الاحتمالية / الأثر / الدرجة المتأصلة                |
| residualLikelihood / residualImpact / residualScore    | Residual likelihood / impact / score                | الاحتمالية / الأثر / الدرجة المتبقية                |
| controls / risks                                       | Number of controls / risks                          | عدد الضوابط / المخاطر                               |
| linkedProcesses                                        | Linked processes                                    | العمليات المرتبطة                                   |
| controlType / nature / keyControl                      | Control type / nature / key control                 | نوع الضابط / طبيعته / ضابط رئيسي                    |
| designEffectiveness / operatingEffectiveness           | Design / operating effectiveness                    | فعالية التصميم / فعالية التشغيل                     |
| stepsWithRisks / stepsWithControls                     | Steps with risks / with controls                    | خطوات بها مخاطر / بها ضوابط                         |
| stepsWithRiskWithoutControl                            | Steps with a risk but no control                    | خطوات بها خطر دون ضابط                              |
| testId / testType / conclusion / sampleSize            | Test / type / conclusion / sample size              | الاختبار / نوعه / الاستنتاج / حجم العينة            |
| issueId / severity / sourceType                        | Issue / severity / source                           | الملاحظة / الخطورة / المصدر                         |
| findingId / rating / responseStatus                    | Finding / rating / management response              | النتيجة / التصنيف / رد الإدارة                      |
| engagementCode / engagementTitleEn / engagementTitleAr | Audit engagement                                    | مهمة التدقيق                                        |
| targetDate                                             | Target date                                         | التاريخ المستهدف                                    |
| month                                                  | Month                                               | الشهر                                               |
| started / completed / running                          | Started / completed / running requests              | الطلبات المبدوءة / المكتملة / الجارية               |
| avgCompletionHours                                     | Average completion time (hours)                     | متوسط مدة الإنجاز (ساعات)                           |
| stepId / stepEn / stepAr                               | Workflow step                                       | مرحلة سير العمل                                     |
| tasks / completedLate / openOverdue                    | Tasks / completed late / open and overdue           | المهام / المنجزة متأخرة / المفتوحة والمتأخرة        |
| onTimePercent                                          | On time (%)                                         | في الوقت (%)                                        |
| avgHours                                               | Average hours per task                              | متوسط الساعات لكل مهمة                              |
| logId / cases / events / activities / resources        | Event log / cases / events / activities / resources | سجل الأحداث / الحالات / الأحداث / الأنشطة / الموارد |
| createdAt / updatedAt / closedAt                       | Created / changed / closed on                       | تاريخ الإنشاء / التعديل / الإغلاق                   |

## 6. Troubleshooting

| Symptom                      | Cause                                                                                                        |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `401`                        | Key missing, mistyped, revoked, expired or its owner deactivated (Settings → Integrations shows the status). |
| `403 API_SCOPE_MISSING`      | The key lacks `reporting:read`.                                                                              |
| `403 API_KEY_IP_NOT_ALLOWED` | The gateway's address is not in the key's allow-list.                                                        |
| `429`                        | Over the key's rate limit (raise it for large models; each page is one call).                                |
| Fewer rows than expected     | Published-content key or department filter on the key.                                                       |
