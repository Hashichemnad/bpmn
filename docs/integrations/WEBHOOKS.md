# Webhooks

ProcessHub can tell other systems (intranet, ticketing, a service bus, a Teams / Power Automate flow, …) when
something happens — a process is published, a review is approved, a workflow request is completed, a KPI turns
red. It sends an HTTPS `POST` with a small, signed JSON message. Design: DECISIONS D-174. Microsoft Teams
channels have their own guide: [TEAMS.md](TEAMS.md).

## 1. Set up

Settings → **Integrations** → **Webhooks** → **Add webhook** (Super Admin; Admins can see webhooks and their
delivery log).

| Field                | Meaning                                                                                          |
| -------------------- | ------------------------------------------------------------------------------------------------ |
| Target URL           | `https://…` of the receiver. It must answer `2xx` within 10 seconds. Redirects are not followed. |
| Events               | What to send (table below).                                                                      |
| Departments          | Optional: only events of items of these departments.                                             |
| Process-house branch | Optional: only events of this process and the processes below it.                                |
| Active               | Switch off to pause (nothing is queued while off).                                               |

After saving, the **signing secret** (`whsec_…`) is shown **once** — store it in the receiver's configuration.
**New secret** replaces it (the receiver must switch to the new one). **Send test event** sends a `test` event
now and shows the answer; **Delivery log** lists every delivery with status, attempts, response code and the
exact payload, with **Resend**.

Delivery settings (same tab): optional **allowed hosts** (e.g. `hooks.example.com`, `*.example.com`; empty =
any public host) and how long the delivery log is kept (default 30 days).

## 2. Events

| Event                                                      | When                                         | `data`                                                 |
| ---------------------------------------------------------- | -------------------------------------------- | ------------------------------------------------------ |
| `process.published`, `page.published`, `diagram.published` | A version became the published one           | `version`                                              |
| `process.archived`, `page.archived`, `diagram.archived`    | The item was archived (no published version) | —                                                      |
| `review.submitted`                                         | Submitted for review                         | `version`                                              |
| `review.approved`                                          | Review approved (last step)                  | `version`                                              |
| `review.rejected`                                          | Rejected or changes requested                | `version`, `status` (`REJECTED` / `CHANGES_REQUESTED`) |
| `workflow.case.started` / `.completed`                     | A request was started / finished             | `number`, `outcome`                                    |
| `workflow.case.overdue`                                    | A task of a request passed its due time      | `number`, `step`, `due`                                |
| `issue.raised` / `issue.overdue`                           | Issue created / passed its due date          | `severity`, `due`                                      |
| `kpi.red`                                                  | A value turned a KPI red for its period      | `period`, `value`                                      |
| `import.completed`                                         | An Import Center batch was applied           | `kind`, `created`, `updated`, `failed`                 |

Pages of spaces with view restrictions are never announced. Payloads never contain form data, descriptions,
comments or other personal details beyond names of items.

## 3. Payload

```http
POST /processhub-hook HTTP/1.1
Content-Type: application/json; charset=utf-8
User-Agent: ProcessHub-Webhook/1
X-ProcessHub-Event: process.published
X-ProcessHub-Delivery: 5b0f3c1e-8f0e-4f7a-9d55-0b7f8f1a2c3d
X-ProcessHub-Timestamp: 1793520000
X-ProcessHub-Signature: sha256=8d5f…
```

```json
{
  "id": "5b0f3c1e-8f0e-4f7a-9d55-0b7f8f1a2c3d",
  "type": "process.published",
  "occurredAt": "2026-11-01T08:00:00.000Z",
  "entity": {
    "type": "PROCESS",
    "id": "0c6f…",
    "code": "C.02.03",
    "nameEn": "Program request approval",
    "nameAr": "طلب البرنامج واعتماده"
  },
  "links": {
    "app": "https://processhub.example.com/processes/0c6f…",
    "portal": "https://processhub.example.com/portal/processes/0c6f…",
    "api": "https://processhub.example.com/api/public/v1/processes/0c6f…"
  },
  "data": { "version": "3 (2.0)" }
}
```

`id` (also in `X-ProcessHub-Delivery`) is the event id: it stays the same for retries and for every
destination of the same event — use it to ignore duplicates. Fetch more details with the public API
(`links.api`, see [API.md](API.md)).

## 4. Verify the signature

`X-ProcessHub-Signature` is `sha256=` + the hex HMAC-SHA256 of `<X-ProcessHub-Timestamp>.<raw body>` with the
signing secret. Check it on the **raw** body (before JSON parsing), compare in constant time, and refuse
timestamps older than 5 minutes (replays).

Node.js (Express):

```js
import crypto from 'node:crypto';
import express from 'express';

const SECRET = process.env.PROCESSHUB_WEBHOOK_SECRET; // whsec_…
const app = express();

app.post('/processhub-hook', express.raw({ type: 'application/json' }), (req, res) => {
  const ts = req.get('X-ProcessHub-Timestamp');
  const sig = req.get('X-ProcessHub-Signature') ?? '';
  const expected =
    'sha256=' + crypto.createHmac('sha256', SECRET).update(`${ts}.${req.body}`).digest('hex');
  const fresh = Math.abs(Date.now() / 1000 - Number(ts)) <= 300;
  const valid =
    fresh &&
    sig.length === expected.length &&
    crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
  if (!valid) return res.sendStatus(401);
  const event = JSON.parse(req.body.toString('utf8'));
  // … handle event.type, deduplicate on event.id …
  res.sendStatus(204);
});
```

Python (Flask):

```python
import hashlib, hmac, os, time
from flask import Flask, abort, request

SECRET = os.environ["PROCESSHUB_WEBHOOK_SECRET"].encode()
app = Flask(__name__)

@app.post("/processhub-hook")
def hook():
    ts = request.headers.get("X-ProcessHub-Timestamp", "")
    sig = request.headers.get("X-ProcessHub-Signature", "")
    body = request.get_data()  # raw bytes
    expected = "sha256=" + hmac.new(SECRET, f"{ts}.".encode() + body, hashlib.sha256).hexdigest()
    if not ts.isdigit() or abs(time.time() - int(ts)) > 300 or not hmac.compare_digest(sig, expected):
        abort(401)
    event = request.get_json()
    return "", 204
```

## 5. Retries and switch-off

A delivery succeeds with any `2xx` answer. Otherwise (other status, redirect, timeout after 10 s, network
error) it is retried after **1, 5 and 15 minutes, 1, 4, 12 and 24 hours**, then marked failed. Waiting
deliveries are stored in the database and survive restarts. After **10 failed attempts in a row** the webhook
is **switched off**: Super Admins and the person who created it get a notification (in-app and e-mail); fix
the receiver and press **Switch on again**. Failed deliveries can be sent again from the delivery log.

## 6. Security rules

- HTTPS only, no user name / password in the URL; the URL and the secret are stored encrypted.
- Internal addresses are refused (loopback, private networks, link-local and cloud metadata `169.254.169.254`,
  CGNAT, IPv6 equivalents) — when saving and before every delivery; ProcessHub connects to the address it
  checked (no DNS rebinding) and never follows redirects. Only hosts listed in `OUTBOUND_ALLOWED_HOSTS` (set by
  the server administrator, e.g. a receiver inside the company network) may be internal or use plain `http://`.
- Optional allow-list of hosts (Delivery settings). Answers are read up to 64 KB; only the first 500
  characters are kept in the log.
