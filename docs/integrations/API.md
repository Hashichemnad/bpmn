# ProcessHub public REST API

The public API lets other systems (intranet, Power BI, the service catalogue, scripts) **read** ProcessHub
content with an **API key**. It is versioned (`/api/public/v1`) and separate from the internal API the web app
uses, so it stays stable when the UI changes. Design and security rules: DECISIONS D-173, SECURITY.md.

Interactive documentation (OpenAPI): `https://<your ProcessHub>/api/public/docs` (machine-readable:
`/api/public/docs-json`) — available when `ENABLE_PUBLIC_API_DOCS=true` (default outside production).

## 1. API keys

Settings → **Integrations** → **API keys** (Super Admin creates and changes keys; Admins can see keys and
their call log).

| Field                | Meaning                                                                                              |
| -------------------- | ---------------------------------------------------------------------------------------------------- |
| Name, description    | What the key is for, e.g. "Power BI – Strategy Office".                                              |
| Owner                | The person responsible. The key stops working when the owner is deactivated.                         |
| Scopes               | What the key may read (table below). Read-only; grant only what is needed.                           |
| Content              | **Published content only** (default) or **Workspace** (drafts, items in review, all saved versions). |
| Departments          | Optional: only items of these departments (items without a department are left out).                 |
| Expires on           | Default one year; at most the "longest key lifetime" (Settings, default 730 days).                   |
| Rate limit           | Calls per minute for this key (default 120). Over the limit: `429` with `Retry-After`.               |
| Allowed IP addresses | Optional IP addresses / CIDR ranges (e.g. the Power BI gateway server).                              |

The full key (`phk_…`) is shown **once** when it is created or when a new secret is issued — copy it into the
other system's secret store. ProcessHub keeps only a fingerprint (SHA-256). **New secret** replaces the key at
once; **Revoke** ends it for good. Every call of a key is logged (endpoint template, status, duration, address)
and shown under **Call log** (kept 90 days by default).

### Scopes

| Scope                 | Endpoints                                                                                                                    |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `processes:read`      | `/processes`, `/processes/{id}`, `/processes/{id}/versions`, `/processes/{id}/bpmn`, `/processes/{id}/svg`, `/process-house` |
| `pages:read`          | `/spaces`, `/pages`, `/pages/{id}` (spaces with view restrictions are never returned)                                        |
| `diagrams:read`       | `/diagrams`, `/diagrams/{id}`, `/diagrams/{id}/svg`                                                                          |
| `objects:read`        | `/objects` (roles, IT systems, documents, dictionary terms)                                                                  |
| `grc:read`            | `/risks`, `/controls`, `/requirements`                                                                                       |
| `ea:read`             | `/applications`, `/capabilities`                                                                                             |
| `kpis:read`           | `/kpis`, `/kpis/{id}/measurements`                                                                                           |
| `workflow:read`       | `/workflow/statistics` (aggregated per process, no personal data)                                                            |
| `workflow:cases:read` | `/workflow/cases` (case list incl. requester names — personal data)                                                          |
| `reporting:read`      | `/reporting/…` — the Power BI / Excel feed, see [POWER-BI.md](POWER-BI.md)                                                   |
| any valid key         | `/me` (name, scopes and filters of the calling key)                                                                          |

## 2. Calling the API

Send the key in the `X-API-Key` header (or `Authorization: Bearer <key>`). Never put keys in URLs.

```bash
curl -s -H "X-API-Key: $PROCESSHUB_KEY" https://processhub.example.com/api/public/v1/me
```

```bash
curl -s -H "X-API-Key: $PROCESSHUB_KEY" \
  "https://processhub.example.com/api/public/v1/processes?category=CORE&pageSize=200&page=1"
```

```bash
curl -s -H "X-API-Key: $PROCESSHUB_KEY" -o C.02.bpmn \
  https://processhub.example.com/api/public/v1/processes/<id>/bpmn
```

```bash
curl -s -H "X-API-Key: $PROCESSHUB_KEY" -o C.02-ar.svg \
  "https://processhub.example.com/api/public/v1/processes/<id>/svg?lang=ar"
```

### Lists, filters and paging

Every list returns `{ "items": [...], "total": 123, "page": 1, "pageSize": 50 }`.

| Parameter          | Meaning                                                                                                   |
| ------------------ | --------------------------------------------------------------------------------------------------------- |
| `page`, `pageSize` | Page number (from 1) and size (1–200, default 50).                                                        |
| `updatedSince`     | ISO date-time: only items changed after it (incremental sync).                                            |
| `q`                | Text search in code and names (both languages).                                                           |
| others             | Per endpoint, e.g. `category`, `departmentId`, `status` (workspace keys), `type`, `spaceId`, `processId`. |

Texts are bilingual: `nameEn` / `nameAr`, `descriptionEn` / `descriptionAr`, `titleEn` / `titleAr`. Published
keys get the **published** title and description of a process (the draft may already differ).

### Conditional requests

Responses carry `ETag` and `Last-Modified`. Send them back as `If-None-Match` / `If-Modified-Since`; when
nothing changed the answer is `304 Not Modified` without a body.

```bash
curl -s -D - -o /dev/null -H "X-API-Key: $PROCESSHUB_KEY" \
  -H 'If-None-Match: W/"…"' https://processhub.example.com/api/public/v1/processes
```

### Errors

JSON `{ "statusCode": 403, "code": "API_SCOPE_MISSING", "message": "…" }`.

| Status | Code                                                           | Meaning                                                           |
| ------ | -------------------------------------------------------------- | ----------------------------------------------------------------- |
| 401    | `API_KEY_INVALID`                                              | Missing or unknown key.                                           |
| 401    | `API_KEY_REVOKED`, `API_KEY_EXPIRED`, `API_KEY_OWNER_INACTIVE` | The key no longer works.                                          |
| 403    | `API_KEY_IP_NOT_ALLOWED`                                       | Called from an address outside the key's allow-list.              |
| 403    | `API_SCOPE_MISSING`                                            | The key lacks the endpoint's scope.                               |
| 404    | `NOT_FOUND`                                                    | Unknown id, or not visible to this key (draft, other department). |
| 429    | `RATE_LIMITED`                                                 | Over the key's limit; retry after `Retry-After` seconds.          |
| 503    | `RENDERER_UNAVAILABLE`                                         | SVG requested but the diagram renderer is not running.            |

## 3. Power Query (Excel / Power BI)

```powerquery
let
    Key = "phk_…",                          // better: a Power BI parameter
    Base = "https://processhub.example.com",
    GetPage = (page as number) =>
        Json.Document(
            Web.Contents(Base, [
                RelativePath = "api/public/v1/processes",
                Query = [page = Text.From(page), pageSize = "200"],
                Headers = [#"X-API-Key" = Key]
            ])
        ),
    First = GetPage(1),
    Pages = List.Numbers(1, Number.RoundUp(First[total] / 200)),
    Items = List.Combine(List.Transform(Pages, each GetPage(_)[items])),
    Table = Table.FromRecords(Items)
in
    Table
```

Keep `Base` fixed and use `RelativePath` / `Query` so scheduled refresh in the Power BI service accepts the
source (credentials: **Anonymous**, the key travels in the header). The reporting feed (`reporting:read`) has
flat tables made for this — see [POWER-BI.md](POWER-BI.md).

## 4. Good practice

- One key per consuming system and owner; the narrowest scopes; an IP allow-list for servers with fixed
  addresses; published content unless drafts are really needed.
- Rotate keys yearly (or when someone with access leaves) and revoke unused ones — the key list shows the last
  use. Go-live checklist: DEPLOYMENT.md.
