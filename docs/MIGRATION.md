# Migration guide — moving existing content into ProcessHub

This guide is for the team that moves DOF's existing processes, diagrams, SOPs and lists into ProcessHub before
go-live (module M15, Import Center). Everything is file based: you upload files, check a preview, apply, and
review the result. Nothing is published automatically.

## 1. How an import works

Every import is a **batch** (Administration → **Import Center**, permission `import.manage`: Admins and Super
Admins):

1. **Upload** one or more files of one kind (the kind decides what the files may contain).
2. **Read** — a background job checks and reads the files (progress bar, _Cancel_).
3. **Preview and check** — every item (row, diagram, page …) with its planned action: _Create_, _Update_ (with the
   changed fields) or _Skip_; the **validation report** lists errors (they block the apply) and warnings (they
   don't). Excel / CSV files show the **column mapping** (change it and _Apply mapping_); Visio files show the
   **shape mapping**. Exclude items with the _Include_ switch; accept or reject **suggestions** (lanes → roles,
   labels → dictionary terms, documents → processes). _Dry-run report_ downloads the preview as Excel.
4. **Apply** — a second job writes the items, each in its own transaction (a failed item does not stop the
   batch). Everything is created as a **Draft**, marked **Imported · IMP-…** with the source file, and owned by
   the owner in the file or the batch's _Default owner_.
5. **Result** — applied items with links, before / after of updates, _Result report_ (Excel).
6. **Undo** — while every item the batch created is still a Draft and nothing was added to it by hand, _Undo
   batch_ removes them (soft delete, audited). Updates of existing items are not reverted (their before / after
   is kept in the result).

Running the same import again is safe: items are matched by **code** (processes, departments, diagrams by file
name code), **e-mail** (users), **external id** (ARIS GUIDs, Confluence page ids) or **file name** of an earlier
batch, and **updated** instead of duplicated — but only while they are Drafts (published content is skipped
with a warning).

## 2. Recommended order

| Step | Kind                                                                                       | Why first                                                                                            |
| ---- | ------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------- |
| 1    | **Departments** (Excel / CSV)                                                              | owners, processes and users refer to departments                                                     |
| 2    | **Users** (Excel / CSV)                                                                    | owners in the next files are matched by e-mail; users get an invitation e-mail (or sign in with SSO) |
| 3    | **Process house** (Excel / CSV)                                                            | builds the Management / Core / Support tree that diagrams and documents attach to                    |
| 4    | **Library**: roles and IT systems (ARIS objects or the module registers), dictionary terms | lanes and labels of diagrams are matched to them                                                     |
| 5    | **Diagrams**: BPMN, Visio, ARIS, DMN                                                       | attached to processes by the code in the file name                                                   |
| 6    | **Documents**: Word, PDF, Confluence, Markdown                                             | linked to processes by codes / names in the file name, title or text                                 |
| 7    | **Registers**: risks, controls, requirements, applications, KPIs (module Excel templates)  | link to processes and objects that now exist                                                         |
| 8    | **AI-assisted migration** (optional) and **review**                                        | see sections 5 and 6                                                                                 |

## 3. Preparing the files

**Excel / CSV** — download the template from the Import Center (download icon next to the kind; headers in
English or Arabic, a _Lists_ sheet with allowed values). Other headers work too: map them in the preview.
CSV: UTF-8, separator `,` `;` tab or `|`.

- _Process house_: process code (e.g. `C.02.03`), names EN / AR, descriptions, category (Management / Core /
  Support — or `إدارية` / `رئيسية` / `مساندة`), parent code, level (checked against the tree), owner e-mail,
  department code or name, sort order. Parents may be in the file or already in ProcessHub. Existing processes
  are not moved by an import (move them in the tree).
- _Departments_: code, names, parent code, head e-mail.
- _Users_: e-mail, names, department, roles (`;`-separated keys or names), job roles (Roles library), language.
  **No passwords**: new users get a single-use _set password_ link by e-mail (7 days; _Send invitation again_ on
  the Users page) or sign in with SSO when password sign-in is off. Imports never create Super Admins and never
  change the break-glass account; Admin roles must enrol in two-step verification at the first sign-in.

**Diagrams**

- _BPMN 2.0_ (`.bpmn` / `.xml`, or a ZIP of them) from Signavio, Camunda, Bizagi (BPMN export), ARIS or other
  tools. Name the files with the process code (`C.01.02 Register requests.bpmn`) so they attach to the right
  process; otherwise choose _Always create new processes_ and a parent. Vendor extensions are removed by default.
  Labels are put into the Arabic or English slot by their script. Files without a layout are laid out
  automatically (data objects and annotations are then not kept).
- _Visio_ (`.vsdx` only — open old `.vsd` files in Visio and _Save as_ `.vsdx`): basic flowchart, cross-functional
  (swimlanes) and BPMN stencil shapes. Check the **shape mapping** (master → BPMN type) and fix unmapped shapes.
  One process per page; the layout is generated.
- _ARIS_: export the models as **AML (XML)**. EPCs become EPC diagrams (convert them to BPMN on the diagram page
  when ready), value-added chain diagrams become value chains, roles / org units and application systems go to
  the library (existing ones with the same name are reused). Other model types are listed and skipped.
- _DMN_: `.dmn` files (DMN 1.3).

**Documents** (choose the target **space**, optionally a parent page and a template)

- _Word_ (`.docx`; `.docm` and other macro files are refused): headings, lists, tables, links and images are
  kept; Arabic paragraphs stay right-to-left. _One page per Heading 1_ splits long manuals. With a template
  (SOP / policy / guide) the template's sections that the document lacks are added as empty headings.
- _PDF_: the text becomes the page and the original PDF is attached; scanned PDFs (no text) are flagged _needs
  manual work_ (no OCR yet).
- _Confluence_: Space tools → Export → **HTML** → upload the ZIP. Page tree, attachments and links between the
  exported pages are kept; links to pages outside the export are removed and listed.
- _Markdown_: `.md` files or a ZIP of a folder (`README.md` / `index.md` is the folder's page).
- Salesforce documents (e.g. PMS user guides, BRDs): save them as Word or PDF and import them the same way.

**Limits and safety** — 100 MB per file, 200 MB / 50 files per batch, 5,000 rows or items per batch; ZIPs up to
2,000 entries and 200 MB unpacked. Files are checked by their content (not only the extension); archives with
unsafe paths, encryption or extreme compression, XML with DTDs, and macro files are refused (see
`docs/SECURITY.md`).

## 4. Matching and re-imports

- Fix the source file and import it again: the new batch updates the drafts created by the first one.
- To start over: _Undo batch_ (while everything is still Draft), then import again.
- Existing published content is never changed by an import.

## 5. AI-assisted migration (optional)

When the AI assistant is enabled for your role, an applied batch offers _AI assistant for this batch_:

- **Draft BPMN from SOP pages** — a BPMN draft per imported SOP, shown side by side with the document.
- **Find risks and controls** — risks and controls mentioned in policies / SOPs (with the quoted sentence), for
  the Risk & Compliance Officer (needs `grc.propose`).
- **Translate missing language** — names, descriptions, BPMN labels and pages that exist in one language only.

Results are **proposals** in _Import Center → AI proposals_. _Accept_ creates drafts marked as AI output (or
fills the missing language, marked for a check); _Reject_ discards. AI usage limits and the audit log apply.

## 6. Tracking and review

- **Migration dashboard** (Administration → Migration dashboard): imported content per department and
  process-house branch — drafts, in review, approved, published; items without owner, without Arabic or
  English, failing the mandatory modeling conventions, processes without a diagram. Numbers link into the queue.
  _Export to Excel_ for the weekly content meeting.
- **Review queue**: filter, select and act in bulk — _Assign owner_, _Apply colour theme_, _Run validation_,
  _Submit for review_ (the normal approval workflows run; nothing is published without approval).
- **Owners** see their imported drafts under _My tasks → Imported drafts_.

## 7. Go-live content checklist

- [ ] Departments, users (invitations sent or SSO tested) and the process house imported and checked.
- [ ] Every imported process has an owner and a diagram; no item without Arabic or English names.
- [ ] Mandatory modeling conventions pass (dashboard column _Failing conventions_ is 0).
- [ ] Documents imported into the right spaces, linked to their processes; scanned PDFs re-typed or attached.
- [ ] Registers (risks, controls, requirements, applications, KPIs) imported and linked.
- [ ] AI proposals reviewed (none left _To review_), AI-generated items checked by their owners.
- [ ] All migrated content submitted for review, approved and published (dashboard: published = total).
- [ ] A **full export** downloaded and stored safely (Import Center → _Full export (ZIP)_, Super Admin) as the
      go-live baseline.

## 8. Full export and moving servers

_Full export (ZIP)_ (Super Admin) downloads the whole repository: JSON per table (for a restore), BPMN / DMN /
diagram files per item and version, pages as HTML and Markdown with attachments, Excel lists and a manifest with
checksums. No passwords or secrets are included. To move to a new server, install ProcessHub there and import
the package in the Import Center as _ProcessHub export package_ — only into an **empty** installation. Users get
new invitations (or use SSO); configure e-mail, SSO, AI and integrations again.
