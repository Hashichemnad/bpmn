# Import Center samples

Invented sample files for the Import Center (module M15) — no real DOF data. They are used by the API tests
(`apps/api/test/imports-*.e2e-spec.ts`), the Playwright suite (`apps/e2e/tests/imports.spec.ts`) and for demos.
Regenerate them with `node docs/samples/import/generate-samples.mjs` (uses the API's `exceljs`, `jszip`,
`docx`).

| File | Import kind | What it shows |
| ---- | ----------- | ------------- |
| `departments.xlsx` | Departments | four departments with a hierarchy (DGO → CSD, PRC, HRD) |
| `users.xlsx` | Users | three users with roles, departments and languages (no passwords — invitations) |
| `process-house.xlsx` | Process house | Management / Core / Support tree with codes `M`, `C.01.01`, `S.02` …, owners by department |
| `bpmn-diagrams.zip` | BPMN | `C.01.01 Handle enquiries.bpmn` (English, Signavio extension), `C.01.02 تسجيل الطلبات.bpmn` (Arabic labels), `S.02 Supplier onboarding (no layout).bpmn` (no diagram interchange, Camunda extensions — laid out automatically, lanes matched to roles) |
| `S.03 Leave request flowchart.vsdx` | Visio | basic flowchart with three swimlanes, a decision, start / end terminators, labelled connectors and one unmapped "Document" shape |
| `aris-procurement.xml` | ARIS (AML) | an EPC (events, functions, XOR rule, roles, an IT system), a value-added chain diagram and an organisation chart (skipped); English and Arabic names |
| `approval-authority.dmn` | DMN | a DMN 1.3 decision table |
| `C.01.01 SOP Handle enquiries (EN).docx` | Word | English SOP: title, headings, numbered steps, table, image, link — linked to process `C.01.01` by its code |
| `C.01.02 إجراء تسجيل الطلبات (AR).docx` | Word | Arabic SOP (right-to-left) |
| `S.02 Supplier onboarding guide.pdf` | PDF | a text PDF (text extracted, original attached) |
| `confluence-quality-manual.zip` | Confluence | HTML space export: three pages in a hierarchy, an image and a PDF attachment, an internal link and a broken one, a `<script>` that is removed |
| `markdown-guides.zip` | Markdown | a folder with `README.md`, a sub-folder page, an image, a table and a broken link |

Recommended demo order: departments → users → process house → BPMN ZIP → Visio → ARIS → Word SOPs (choose a
space) → migration dashboard (see `docs/MIGRATION.md`).
