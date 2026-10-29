# Sample diagrams and reports

Real-world reference content for testing the modeler, viewer and imports.

| File | What it is |
|---|---|
| `PMS-01-Program-Request-Approval.bpmn` | DOF Portfolio Management System, process 1: Program / Initiative Request & Approval. 8 lanes, 27 elements, bilingual labels (`ph:nameEn` / `ph:nameAr`), step descriptions, and colours stored as BPMN-in-Color (`color:background-color` / `color:border-color`) plus `bioc:fill` / `bioc:stroke`. |
| `PMS-01-reference-colours-en.png` | How that file renders with plain bpmn-js: the reference colour scheme by element type. |
| `PMS-01-handbook-en.docx`, `PMS-01-handbook-ar.docx` | Process handbook generated from PMS-01 (working version, with step times, costs and IT systems), English and Arabic (RTL). |
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
