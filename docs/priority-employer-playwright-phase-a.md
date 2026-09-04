# Priority employer browser discovery — Phase A design

Status: **review gate** (2026-09-04). This document and the 50-company seed are
for Steven's approval. No employer rows are inserted and no browser crawler is
scheduled until approval.

## Scope and safety boundary

The browser pipeline visits public career and job-listing pages only. It may
open a public job card and follow its Apply link far enough to identify the
job-specific destination, then it stops. It must never sign in, create an
account, solve or bypass a CAPTCHA, evade access controls, fill an application,
upload a resume, or submit anything. `robots.txt`, site terms, domain rate
limits, and explicit blocks are respected. A block is recorded as a failed or
manual-review result, never treated as a challenge to circumvent.

The existing 43-source ATS JSON workflow remains unchanged. Browser discovery
is a separate workflow, concurrency budget, schedule, log, and failure domain.

## Phase A artifacts

- Schema: `supabase/migrations/20260904050000_priority_employers.sql`
- Review-only seed: `supabase/seed/priority_employers_phase_a_50.sql`
- This design document

Seed composition: 30 Canadian and 20 US employers. Forty-five career URLs
returned HTTP 200/202 in the 2026-09-04 validation pass. Five sites (Manulife,
McKinsey, TELUS, Canadian Tire, Gartner) rejected or timed out a plain HTTP
client and remain `pending` for an ordinary Playwright browser check. None is
marked failed merely for blocking curl.

## Proposed GitHub Actions architecture (Phase B)

Workflow: `.github/workflows/priority-employer-discovery.yml`

Triggers:

- daily schedule, offset from the ATS workflow;
- `workflow_dispatch` with optional employer IDs, dry-run, and batch size;
- no trigger on ordinary pushes.

Execution model:

1. Query enabled/pending or stale `priority_employers`, ordered by tier and
   oldest success time.
2. Select 10–20 employers per daily run. Use an Actions matrix with at most two
   parallel browser workers and one browser context per employer.
3. Run Playwright Chromium with a normal, identifiable OfferFlow user agent.
   Apply per-domain delay and bounded navigation/redirect timeouts.
4. Discover public listing cards, open a bounded sample, follow an Apply link,
   and stop at the job-specific destination before any login/form interaction.
5. Write one JSON result per employer. A failed employer never fails siblings.
   The workflow succeeds when at least one employer succeeds; all-failed is an
   operational failure.
6. Upload JSON, screenshots, and a Playwright trace as short-retention Actions
   artifacts. Only metadata/evidence paths are sent to Supabase; screenshots do
   not enter the `jobs` table.
7. Ingest successful results through a service-authenticated endpoint or
   Supabase REST with the Actions service-role secret. Upsert jobs by stable
   source/external ID and set `jobs.is_priority_employer=true`.
8. Update `verify_status`, `last_success_at`, `last_apply_url`, and notes. The
   run summary lists every employer, discovered listings, confirmed Apply URLs,
   redirects, failures, and reasons.

## Apply URL evidence contract

Each discovery record should contain:

```json
{
  "employer_id": "uuid",
  "career_url": "https://…",
  "listing_url": "https://…/job/123",
  "final_apply_url": "https://…/apply/123",
  "redirect_chain": [
    { "url": "https://…", "status": 302 },
    { "url": "https://…/apply/123", "status": 200 }
  ],
  "page_title": "Business Analyst Intern",
  "http_status": 200,
  "screenshot_artifact": "evidence/company/job-123.png",
  "captured_at": "ISO-8601 timestamp",
  "stopped_reason": "apply_destination_confirmed"
}
```

Allowed terminal reasons include `apply_destination_confirmed`,
`login_required_stop`, `captcha_stop`, `robots_disallow`, `rate_limited`,
`no_public_listings`, and `navigation_failed`.

## ATS fast-path promotion

Before using browser extraction, inspect public URLs and network hosts for
Greenhouse, Lever, or Ashby. Probe only their documented public job-board
endpoint. When a real board token returns HTTP 200 plus job data:

1. record the verified token and evidence;
2. upsert the company into `job_sources`;
3. switch `crawl_strategy` to `ats_api` and the corresponding `ats_type`;
4. let the existing JSON workflow own recurring collection.

Workday/custom sites remain browser-discovery candidates unless a stable,
public, unauthenticated JSON endpoint is verified. Tokens and endpoints are
never guessed.

## Selector and failure strategy

- Prefer semantic locators: role/link text containing `Apply`, `View job`, or
  the job title; use company-specific adapters only after generic locators fail.
- Cap pages and clicks per employer; reject navigation outside the observed
  career/applicant domains unless it is the Apply destination.
- Retry network/transient errors once with backoff; do not retry CAPTCHA, 401,
  403, or explicit rate-limit blocks in the same run.
- Mask query values that resemble tokens before logging URLs.
- Screenshot immediately before the Apply click and after the final public
  destination loads. Never screenshot user sessions because the crawler has no
  authenticated state.

## Secrets and operations

Actions needs `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`, already used by
the ATS workflow. No employer login credentials are permitted. Browser artifacts
use GitHub's retention control and contain public pages only.

Recommended initial limits: batch size 10, browser workers 1–2, at most five
job cards per employer, 1.5–3 seconds between navigations, 30-second navigation
timeout, and 20-minute job timeout. Increase only after the first two clean runs.

## Review checklist before Phase B

1. Steven approves/removes/adds companies and confirms tier assignments.
2. Pending career URLs are verified in an ordinary browser.
3. Legal/terms review confirms the per-domain access policy.
4. Screenshot retention and Supabase ingestion endpoint are approved.
5. Only then apply migration 0005 and the reviewed seed, and implement the
   Playwright runner/workflow.
