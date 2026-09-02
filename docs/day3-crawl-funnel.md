# Day 3 ATS expansion and crawl funnel

Measured: 2026-09-02 (America/Toronto)

## Funnel

- Enabled, endpoint-verified sources: **43**
- Open jobs persisted after deduplication: **5,959**
- Canada/GTA location matches: **769**
- Target-role + Canada/GTA candidates: **692**
- Identity hard-filter candidates: **959 / 5,959 (16.1%)**
- Resumes persisted: **0**
- Match rows / final database feed: **0 / 0**

The current zero final feed is not caused by an overly strict score threshold: no
resume has yet been persisted in the production `resumes` table, so `score-jobs`
has no user/resume pair to score. The frontend remains in mock/localStorage mode
until its backend integration is enabled.

## Source inventory

Ashby: Wealthsimple, KOHO, Loopio, Relay Financial, Cohere, Snowflake, Notion,
Plaid, OpenAI, Vanta, Confluent.

Greenhouse: StackAdapt, Geotab, PurposeMed, Lyft, Stripe, Datadog, Okta, MongoDB,
Coursera, Twilio, Asana, Figma, Scale AI, Anthropic, Airtable, Dropbox, Pinterest,
Instacart, Coinbase, Vercel, Reddit, Affirm, Robinhood, Brex, Webflow, Databricks,
GitLab, Canonical, PagerDuty, Amplitude, Braze.

Lever: PointClickCare, Caseware.

Every seeded endpoint returned HTTP 200, a non-empty JSON jobs array, and at
least one Canada/GTA-related response record during probing. Workday sources
were not seeded because no uniform, tenant-independent public endpoint could be
validated without guessing tenant/path parameters.

## Operations findings

- A single 43-source invocation exceeded the Edge Function worker resource
  budget. Scheduler changed to one source per invocation with six-way bounded
  concurrency.
- GitHub Actions secrets were initially absent. `SUPABASE_URL` and
  `SUPABASE_SERVICE_ROLE_KEY` are now configured.
- A real minimal `parse-text` request succeeded, confirming the project's
  `OPENAI_API_KEY` currently works.
