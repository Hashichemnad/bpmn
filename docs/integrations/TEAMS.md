# Microsoft Teams channel notifications

ProcessHub can post a card to a Teams channel when something happens — a process is published, a review is
waiting or approved, a request is overdue, an issue is raised, a KPI turns red. It uses a **Teams Workflows
webhook** ("When a Teams webhook request is received"), the replacement of the retired Office 365 connectors
("Incoming Webhook"). No Teams app and no Microsoft Graph permissions are needed. Design: DECISIONS D-176.

Personal notifications (to one person) stay e-mail and in-app; personal Teams chats would need a Teams app with
Graph permissions (BACKLOG).

## 1. Create the workflow in Teams

1. In the Teams channel: **… (More options) → Workflows**.
2. Choose the template **"Post to a channel when a webhook request is received"** (or create a flow in Power
   Automate with the trigger **"When a Teams webhook request is received"** and the action **"Post card in a
   chat or channel"**, card = `attachments` of the trigger body).
3. Name it e.g. "ProcessHub", pick the team and channel, **Add workflow**.
4. Copy the **HTTP POST URL** shown at the end (`https://….logic.azure.com/workflows/…/triggers/manual/paths/
invoke?…&sig=…` or `https://….environment.api.powerplatform.com/…`). Treat it like a password: anyone with
   the URL can post to the channel.

Who may trigger the workflow can be restricted in its trigger settings ("Anyone" is needed for ProcessHub,
which does not sign in to Microsoft 365). The workflow runs under the account of the person who created it —
use a service account so it keeps working when people leave.

## 2. Add the channel in ProcessHub

Settings → **Integrations** → **Microsoft Teams** → **Add Teams channel** (Super Admin):

| Field                              | Meaning                                                                                      |
| ---------------------------------- | -------------------------------------------------------------------------------------------- |
| Name                               | e.g. "Process office channel".                                                               |
| Teams Workflows webhook URL        | The URL from step 1. It is stored encrypted and shown afterwards without its signature part. |
| Events                             | What to post (same list as webhooks, see [WEBHOOKS.md](WEBHOOKS.md#2-events)).               |
| Departments / process-house branch | Optional filters (e.g. one channel per directorate).                                         |
| Card language                      | English, Arabic (right to left) or both.                                                     |

**Send test event** posts a test card at once. The **delivery log** shows every card exactly as sent, with
Teams' answer (`202 Accepted` = delivered) and **Resend**.

Only Power Automate hosts are accepted: `*.logic.azure.com`, `*.environment.api.powerplatform.com`,
`*.webhook.office.com`. If your tenant uses another host, add it under **Delivery settings → Additional Teams
hosts**.

## 3. What the card looks like

- Title of the event (e.g. "Process published" / «تم نشر عملية»), code and name of the item.
- Facts: owner, version, status / outcome, severity, period and value — depending on the event.
- Buttons: **Open in ProcessHub** and, for published content, **Open in the Knowledge Portal**.
- Arabic cards are right to left; "both" shows the English and the Arabic part one below the other.

Cards contain names and codes of items only — no descriptions, comments or form data. Names are cleaned
(no links or formatting can be injected).

## 4. Failures

Same rules as webhooks: retries after 1, 5, 15 minutes, 1, 4, 12 and 24 hours; after 10 failed attempts in a
row the channel is switched off and Super Admins get a notification. Common causes: the workflow was deleted or
turned off, the owner's account was disabled, or the flow's trigger was restricted to signed-in users. Fix it in
Teams / Power Automate (or create a new URL and edit the channel in ProcessHub), then **Switch on again**.
