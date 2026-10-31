# Sample diagrams and reports

Real-world reference content for testing the modeler, viewer and imports.

| File | What it is |
|---|---|
| `PMS-01-Program-Request-Approval.bpmn` | DOF Portfolio Management System, process 1: Program / Initiative Request & Approval. 8 lanes, 27 elements, bilingual labels (`ph:nameEn` / `ph:nameAr`), step descriptions, and colours stored as BPMN-in-Color (`color:background-color` / `color:border-color`) plus `bioc:fill` / `bioc:stroke`. |
| `PMS-01-reference-colours-en.png` | How that file renders with plain bpmn-js: the reference colour scheme by element type. |
| `PMS-01-handbook-en.docx`, `PMS-01-handbook-ar.docx` | Process handbook generated from PMS-01 (working version, with step times, costs and IT systems), English and Arabic (RTL). |
| `S-01-handbook-diagrams-en.docx`, `S-01-handbook-diagrams-ar.docx` | Handbook of the demo branch S.01 Procure to Pay (working version, sub-processes) with the diagram sections: place in the value chain, SIPOC, linked decision tables (DMN) and organisation chart excerpt (D-126). |
| `approval-authority.dmn` | DMN 1.3 decision table "Approval authority by amount" with bilingual names (`ph:nameEn` / `ph:nameAr`); the demo DMN-001. |
| `invoice-processing-log.csv` | Event log for process mining (Phase 5.1): 200 invoices of the demo process S.01.04 Invoice processing, one row per activity instance (format below). Import it under Process mining → Event logs → Import log; link it to S.01.04 to see conformance. |
| `invoice-processing-log.xes` | 40 invoices of the same process in XES (IEEE 1849) with `lifecycle:transition` start / complete pairs, `org:resource`, `org:group` and a trace attribute `channel`. |
| `PMS-01-raci-en.xlsx`, `PMS-01-raci-ar.xlsx` | RACI matrix of PMS-01: steps × roles, IT systems per step, steps with attributes, legend. |

Colour scheme (fill / border):

| Element kind | Fill | Border |
|---|---|---|
| Start event, successful end | `#E6F4EA` | `#2E7D32` |
| End event, rejected / terminate | `#FDECEA` | `#C62828` |
| Human task | `#E8F1FB` | `#1F5FA8` |
| Approval / review task | `#FBF3E0` | `#8A6D1E` |
| System task (service, send, script, business rule) | `#EEF0F2` | `#59636E` |
| Gateway | `#FFF8E1` | `#B28704` |
| Lanes | alternating `#FFFFFF` / `#FAFBFC` | `#59636E` |

## Event log format (process mining, Phase 5.1)

CSV (UTF-8, comma, semicolon, tab or pipe; the first row holds the column names) or Excel `.xlsx` (first or chosen
worksheet), one row per event — any column names, they are mapped at import:

| Column (sample) | Required | Meaning |
|---|---|---|
| `case_id` | yes | The case (invoice, request, application …) the event belongs to. |
| `activity` | yes | What happened. Mapped to BPMN steps by label (English / Arabic) and dictionary synonyms. |
| `start_time` | one of the two | When the work started (enables waiting vs processing time). |
| `end_time` | one of the two | When it ended; with a single timestamp column, map it as the end time. |
| `resource` | no | Who did it (handovers, activities per resource). Can be pseudonymised at import. |
| `department` | no | Unit of the resource (handovers between departments, lanes of a discovered model). |
| `amount`, `channel`, … | no | Extra attributes for filters (up to 20). |

Timestamps: ISO 8601 (`2026-04-01 09:13`, `2026-04-01T09:13:00+04:00`), day first (`01/04/2026 09:13`), month
first, year first, Excel serial numbers or Unix time; the format is detected and can be chosen. Times without an
offset are read in the chosen time zone (default Asia/Dubai). The sample files were written with
`npx ts-node --transpile-only prisma/generate-mining-samples.ts` (apps/api).
