# AI Assistant — demo and manual test script

A 15-minute guided demo of the AI Assistant (M16) on the demo installation, with a real API key. Every step
names what to click, what to expect and what to check. The automated test suite never calls a real AI (it uses
a fake provider), so run this script before a demo or a release.

## 0. Prepare (5 minutes, once)

1. Start a fresh demo installation: `docker compose up --build` (or keep an existing one). Open
   http://localhost:8080.
2. Get an Anthropic API key (console.anthropic.com → API keys). The demo uses a few dozen requests.
3. Sign in as **admin@processhub.local** (`SEED_ADMIN_PASSWORD`, default `ChangeMe-Admin1`) →
   **Settings** → card **AI assistant**:
   - tick **Enable the AI assistant**; provider **Anthropic Claude**; models `claude-sonnet-5-5` and
     `claude-haiku-5-5` (defaults);
   - paste the key → **Test connection** → expect "Connection works (claude-sonnet-5-5)";
   - all roles are ticked by default (keep **Viewer** for the portal assistant); limits 50 per user per day and
     5,000 per month; open **Suggestion chips** to see the seeded sample prompts (one per feature);
   - **Save**. Check: reload — the key field shows "A key is stored (encrypted)"; the key is never displayed.
4. Optional: **Administration → Audit log**, filter entity _Setting_: the change is logged with
   `credentialChanged: true` and without the key.

Demo users (password `SEED_DEMO_PASSWORD`, default `Demo-Password1`): `modeler@`, `reviewer@`, `owner@`,
`viewer@`, `auditor@processhub.local`.

## 1. Generate a process from text (feature 1) — modeler

1. Sign in as **modeler@processhub.local** → **Processes** → **New process**.
2. Click **✨ Generate from a description** → click the chip _"Build a process for employee onboarding with HR,
   IT and the line manager"_ (or type your own, Arabic works too) → **Generate**.
3. Expect within ~30–60 s: a preview with a BPMN diagram in **lanes per role**, bilingual labels, an
   explanation, validation hints, **Links to the library** (roles/IT systems that exist in the library, ticked)
   and **Not in the library yet**.
4. Switch the UI to **عربي** in the header while the preview is open: the diagram labels switch to Arabic.
5. **Use for the new process** → the form is filled (names, descriptions in both languages); enter a code, e.g.
   `S.09`, category _Support_ → **Save**. The process opens on the **Model** tab, saved as a draft, with the
   badge **"AI-generated — review before publishing"**. Linked steps show count badges.
6. Check: move one element and wait 3 s (autosave) → reload: the badge is gone (a person edited it).

## 2. Translate EN ↔ AR (feature 4)

1. Same process → **Edit** → clear the Arabic name → **✨ Translate into Arabic** → the empty field is filled;
   review, **Save**.
2. Modeler → **✨ AI → Translate missing labels into Arabic**: only labels missing in Arabic are listed with an
   editable translation → **Apply** → undoable edits in the diagram.
3. **Spaces → Quality Management →** any page → **Edit** → tab **العربية** → **✨ Translate from English**:
   preview of the Arabic page with the same structure → **Use this translation** → **Save**. The page shows the
   AI badge until someone edits it.

## 3. Refine with chat (feature 2)

1. Modeler → right panel tab **✨ Assistant** → click the chip _"Add an approval step by the finance manager
   after step 3"_ (or type a change).
2. Expect an answer explaining the change and **Review changes**: a side-by-side compare (current vs proposal)
   with added elements in green and removed ones in red.
3. **Accept and apply** → the diagram is replaced and saved as a draft; links on unchanged steps are kept.
   Ask a follow-up ("Rename the gateway to 'Budget approved?'") — the chat keeps context.

## 4. Summaries and "what changed" (feature 6)

1. On the process page click **✨ Summarise**: a short summary streams in; click the chip _"Summarise in three
   bullet points for a new employee"_ for a different audience.
2. Modeler → **Save** twice with a change in between (two versions) → **Versions** → compare the two →
   **✨ What changed?**: a plain-language list of changes. Comparing identical versions says "Nothing changed"
   (no AI request is made).
3. Sign in as **reviewer@processhub.local** → **My tasks** → open the review of _S.01.01 Purchase Requisition
   v2_ → card **AI summary of the changes** → **What changed?**: explains v2 against the published v1.

## 5. Documentation ↔ process (feature 3)

1. As modeler, process **S.01.01 Purchase Requisition** → tab **Documentation** → **✨ Generate documentation**
   → _Standard Operating Procedure_, space _Quality Management_, chip _"Write it for new employees…"_ →
   **Generate** → preview in English and Arabic (responsibilities from lanes/roles, steps in order, systems) →
   **Create page**. The page opens as a draft with the embedded diagram, linked to the process, with the AI
   badge.
2. On any procedure page (e.g. _Purchase Requisition Procedure_) → **✨ Create a process from this page** →
   **Generate** → preview → **Continue to the new process** → enter a code → **Save**: the new process has the
   draft model and appears under the page's related processes.

## 6. Analyse & improve (feature 5)

1. Modeler of any process → **✨ AI → Analyse & improve** (or **Validation** tab → **Explain with AI** when there
   are warnings).
2. Expect a short assessment and findings tagged _Missing step / Unclear responsibility / Bottleneck / Risk /
   Control / Improvement_ with severity, explanation and suggestion; clicking a step name selects it on the
   canvas. Validation warnings are explained in plain language. Try the chip _"Focus on approval controls and
   segregation of duties"_.
3. Read-only users (e.g. **auditor@**) can analyse too (from the read-only modeler).

## 7. Knowledge Portal assistant (feature 7)

1. Sign in as **viewer@processhub.local** (lands on the portal) → home page → chip _"How do I request a new
   laptop?"_ (or **✨ Ask** in the header).
2. Expect a short answer with numbered citations and **Sources**: _Requesting IT Equipment (v1.0)_ — click it to
   open the published page.
3. Ask _"Who approves a purchase requisition?"_ → answered from the published _Purchase Requisition_ process.
4. Ask something not covered (_"What is the parking policy?"_) → "The published content does not answer this
   question", no sources.
5. Switch to **عربي** and ask _«كيف أطلب حاسوبًا محمولًا جديدًا؟»_ → Arabic answer, same source.
6. Check (privacy): drafts and view-restricted spaces never appear in answers or sources.

## 8. Limits, roles and the usage report

1. As admin → **Administration → AI usage**: requests, input/output tokens and errors per user, feature, model
   and the last 12 months.
2. Settings → AI → untick **Viewer**, **Save** → as viewer the **✨ Ask** button disappears; the API answers 403
   `AI_NOT_ALLOWED`.
3. Set **Requests per user per day** to 1 → the second request of a user shows "You have reached your daily
   limit of AI requests".
4. Untick **Enable the AI assistant** → every ✨ button disappears; the rest of ProcessHub works unchanged.

## Troubleshooting

| Message                                            | Cause                                                                           |
| -------------------------------------------------- | ------------------------------------------------------------------------------- |
| "The AI provider rejected the API key"             | wrong or revoked key — Settings → AI → paste a new one → Test connection        |
| "The AI provider is busy"                          | provider rate limit — wait and retry; consider a higher Anthropic tier          |
| "The AI produced an answer that could not be used" | the output failed validation twice — retry or rephrase                          |
| "The AI provider did not answer in time"           | `AI_HTTP_TIMEOUT_MS` (default 180 s) or the nginx `/api/v1/ai/` timeout (300 s) |
| Buttons do not appear                              | AI disabled, or the user's role is not ticked in Settings → AI                  |
