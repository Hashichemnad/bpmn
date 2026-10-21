# ProcessHub

**A bilingual (Arabic / English) business process management platform** — combining the core of ARIS and GBTEC (BIC) with a Confluence-style documentation wiki, Git-style version control and an optional GitHub / GitLab integration.

**منصة ثنائية اللغة (العربية / الإنجليزية) لإدارة العمليات المؤسسية** — تجمع بين جوهر ARIS و GBTEC (BIC) مع ويكي للتوثيق على غرار Confluence، والتحكم في الإصدارات، وتكامل اختياري مع GitHub / GitLab.

> **Status:** 🚧 Phase 1 (Foundation) — not started yet. See the roadmap below.

---

## What it does

| Area | Features |
|---|---|
| **Process House & Repository** | Management / Core / Support process hierarchy, process tree, owners, departments |
| **Process Modeler** | BPMN 2.0 editor, bilingual labels, validation, import/export (BPMN XML, SVG, PNG, PDF) |
| **Object Repository** | Reusable roles, IT systems, documents, risks, controls and KPIs, linked to process steps |
| **Documentation Wiki** | Confluence-style pages and spaces, SOP / policy templates, linked to processes |
| **Version Control** | Version history, visual compare, restore, change notes |
| **Git Integration** *(optional)* | Sync models and documents with GitHub or GitLab — enabled from Settings |
| **Governance** | Draft → Review → Approved → Published workflow, comments, notifications |
| **Knowledge Portal** | Read-only portal for all staff: browse, search, "my processes", feedback, PDF |
| **GRC, EA & KPIs** | Risks and controls, IT landscape, KPI dashboards, Salesforce link |
| **Process Mining & Execution** | Event-log analysis, bottlenecks, running approved processes as workflows |

## Roadmap

| Phase | Scope | Status |
|---|---|---|
| 1 | Foundation: users & roles, Arabic/English, process house, BPMN modeler, roles & systems library | ⬜ Not started |
| 2 | Documentation wiki, version control, GitHub/GitLab integration | ⬜ |
| 3 | Governance workflow, Knowledge Portal | ⬜ |
| 4 | GRC, enterprise architecture, KPIs & Salesforce | ⬜ |
| 5 | Process mining, workflow execution, simulation | ⬜ |
| 6 | Hardening: SSO, performance, security review, deployment guide | ⬜ |

## Technology

TypeScript throughout · React + Vite + Ant Design (RTL-ready) · i18next · bpmn-js · TipTap · Node.js + NestJS · Prisma · PostgreSQL · MinIO · Docker Compose

## Getting started

Setup instructions will be added here once Phase 1 is built. The goal is that the whole system starts with one command:

```bash
docker compose up --build
```

## For developers

The full blueprint — modules, tech stack, security requirements, bilingual rules, data model and conventions — is in [`CLAUDE.md`](./CLAUDE.md). Progress notes will live in `docs/PROGRESS.md`.

## License

Private — all rights reserved.
