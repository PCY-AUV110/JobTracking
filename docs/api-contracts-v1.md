# OfferFlow Backend API Contracts v1

Status: **frozen for frontend integration**  
Date: 2026-09-02  
Transport: Supabase Edge Functions over HTTPS, JSON only  
Frontend SDK: `@supabase/supabase-js` v2

## Shared conventions

- User functions require the caller's Supabase access token. Scheduled/system functions require a service-role bearer token and are never called from the browser.
- Request and response keys use `snake_case`. Timestamps are UTC ISO-8601 strings. IDs are UUID strings.
- Successful responses use `{ "data": ..., "meta": { "request_id": "uuid" } }`.
- Errors use `{ "error": { "code": "string", "message": "string", "details": {} }, "meta": { "request_id": "uuid" } }`.
- Common HTTP statuses: `400 invalid_request`, `401 unauthenticated`, `403 forbidden`, `404 not_found`, `409 conflict`, `422 unprocessable`, `429 rate_limited`, `500 internal_error`, `502 upstream_error`.
- Unknown request keys are ignored in v1. Missing required keys or invalid enum values are rejected.
- Browser callers must not send `user_id`; user ownership is derived from the verified JWT.

## 1. `parse-resume`

Purpose: structure text already extracted client-side by pdf.js and persist a resume version.

Auth: authenticated user JWT.  
Method: `POST /functions/v1/parse-resume`

Request:

```json
{
  "filename": "resume-2026.pdf",
  "raw_text": "Jane Doe ...",
  "locale": "en-CA",
  "replace_resume_id": null
}
```

Constraints: `filename` 1-255 chars; `raw_text` 50-100000 chars; `locale` optional; `replace_resume_id` optional and must belong to the caller.

Response `200`:

```json
{
  "data": {
    "resume": {
      "id": "uuid",
      "filename": "resume-2026.pdf",
      "status": "parsed",
      "parsed": {
        "contact": { "name": "Jane Doe", "email": null, "phone": null, "location": "Toronto, ON" },
        "summary": "...",
        "skills": ["Python", "SQL"],
        "education": [{ "institution": "...", "credential": "...", "field": "...", "start_date": null, "end_date": null }],
        "experience": [{ "company": "...", "title": "...", "start_date": null, "end_date": null, "highlights": ["..."] }],
        "certifications": [],
        "languages": []
      },
      "created_at": "2026-09-02T00:00:00Z"
    },
    "tokens_used": { "prompt": 0, "completion": 0, "total": 0 }
  },
  "meta": { "request_id": "uuid" }
}
```

## 2. `crawl-jobs`

Purpose: fetch enabled ATS sources, normalize required fields, deduplicate and track `new/changed/closed` states.

Auth: service-role only; browser use forbidden.  
Method: `POST /functions/v1/crawl-jobs`

Request:

```json
{
  "source_ids": ["uuid"],
  "ats_types": ["greenhouse", "lever", "ashby"],
  "limit_per_source": 500,
  "dry_run": false,
  "close_missing": true
}
```

All keys are optional. Empty filters mean all enabled sources. `dry_run=true` performs fetch/normalization without writes.

Response `200`:

```json
{
  "data": {
    "batch_id": "uuid",
    "started_at": "2026-09-02T00:00:00Z",
    "finished_at": "2026-09-02T00:01:00Z",
    "sources": 10,
    "fetched": 420,
    "new": 30,
    "changed": 12,
    "closed": 5,
    "unchanged": 373,
    "failed": 0,
    "errors": []
  },
  "meta": { "request_id": "uuid" }
}
```

Normalized job records retain `jd_raw` verbatim and separately derive `jd_summary`. Required capture fields are company legal name; complete JD including identity/work-authorization wording; city/address; salary raw text and pay disclosure; contact domain/channel; source and official-company URLs; employment type/hours; and fee/training/deposit/background-check wording. `contact_email_domain`, `is_free_email`, `is_im_only`, and `fee_keywords_hit` are computed during normalization.

## 3. `score-jobs`

Purpose: run identity/keyword hard filters, then LLM scoring only for jobs that pass the rules.

Auth: authenticated user JWT for own resume/preferences; service role may invoke scheduled batches.  
Method: `POST /functions/v1/score-jobs`

Request:

```json
{
  "resume_id": "uuid",
  "job_ids": ["uuid"],
  "force": false,
  "limit": 100
}
```

`resume_id` is required for browser calls and must belong to the caller. `job_ids` is optional; otherwise score eligible open jobs against the caller's preferences. Scheduled service-role calls may omit `resume_id` to process all active users.

Response `200`:

```json
{
  "data": {
    "batch_id": "uuid",
    "considered": 100,
    "scored": 82,
    "passed": 61,
    "hard_filtered": 18,
    "llm_calls": 61,
    "tokens_used": 24500,
    "results": [{ "job_id": "uuid", "match_id": "uuid", "rule_score": 78, "rule_passed": true, "llm_grade": "B", "llm_score": 82 }]
  },
  "meta": { "request_id": "uuid" }
}
```

Grades are `A|B|C|D|E|F`. Hard-filter reasons are stored in `gaps` and returned by job-match queries; identity signals include PR, citizen and clearance requirements.

## 4. `vetting-flags`

Purpose: apply the current bilingual red-flag dictionary and create/update automatic vetting records.

Auth: service-role only; browser use forbidden.  
Method: `POST /functions/v1/vetting-flags`

Request:

```json
{
  "job_ids": ["uuid"],
  "force": false,
  "ruleset_version": "v1.0",
  "limit": 500
}
```

Response `200`:

```json
{
  "data": {
    "batch_id": "uuid",
    "processed": 100,
    "flagged": 14,
    "auto_high": 3,
    "needs_human": 11,
    "clean": 86,
    "ruleset_version": "v1.0"
  },
  "meta": { "request_id": "uuid" }
}
```

Missing required source fields must produce at least `medium` / `needs_human`; they must not default to approved.

## 5. `vetting-review`

Purpose: persist a reviewer decision without exposing service-role credentials to the browser.

Auth: authenticated `admin`/`super_admin` reviewer JWT; the function performs the write with its server-side service role. Direct service-role batch integration is also accepted.  
Method: `POST /functions/v1/vetting-review`

Request:

```json
{
  "job_id": "uuid",
  "risk_rating": "medium",
  "risk_tags": ["free_email", "missing_legal_name"],
  "risk_points": "Contact uses a free mailbox and the legal entity is missing.",
  "action": "Verify the employer through its official corporate site before applying.",
  "status_match": "needs_human",
  "basis": "OfferFlow vetting checklist v1.0 sections 2 and 5.",
  "status": "needs_human",
  "keywords_hit": { "contact": ["gmail.com"], "fees": [] }
}
```

Required six-field review contract: `risk_rating`, `risk_tags`, `risk_points`, `action`, `status_match`, `basis`. `job_id` and `status` are also required. Enums: `risk_rating=low|medium|high`; `status=pending|auto_flagged|needs_human|approved|rejected`.

Response `200`:

```json
{
  "data": {
    "review": {
      "id": "uuid",
      "job_id": "uuid",
      "reviewer": "uuid",
      "risk_rating": "medium",
      "risk_tags": ["free_email", "missing_legal_name"],
      "risk_points": "...",
      "action": "...",
      "status_match": "needs_human",
      "basis": "...",
      "keywords_hit": { "contact": ["gmail.com"], "fees": [] },
      "status": "needs_human",
      "created_at": "2026-09-02T00:00:00Z"
    }
  },
  "meta": { "request_id": "uuid" }
}
```

## Frontend `supabase-js` client signatures

The frontend wrapper should expose these Promise-based functions. `invoke` automatically sends the active session JWT.

```ts
type ApiResult<T> = { data: T; meta: { request_id: string } };

parseResume(input: {
  filename: string;
  raw_text: string;
  locale?: string;
  replace_resume_id?: string | null;
}): Promise<ApiResult<{ resume: Resume; tokens_used: TokenUsage }>>;

scoreJobs(input: {
  resume_id: string;
  job_ids?: string[];
  force?: boolean;
  limit?: number;
}): Promise<ApiResult<ScoreJobsResult>>;

submitVettingReview(input: VettingReviewInput): Promise<ApiResult<{ review: VettingReview }>>;

listResumes(): Promise<Resume[]>;
getJobPreferences(): Promise<JobPreferences | null>;
upsertJobPreferences(input: JobPreferencesInput): Promise<JobPreferences>;
listMatchedJobs(input?: { grade?: "A"|"B"|"C"|"D"|"E"|"F"; status?: "new"|"changed"|"closed"; limit?: number; offset?: number }): Promise<JobCard[]>;
getJobCard(job_id: string): Promise<JobCard>;
```

Reference implementation shape:

```js
export async function parseResume(input) {
  const { data, error } = await supabase.functions.invoke("parse-resume", { body: input });
  if (error) throw error;
  return data;
}
```

`crawlJobs` and `runVettingFlags` are intentionally omitted from the browser client. `scoreJobs` is exposed only for the caller's own resume; scheduled all-user scoring remains server-only.

## Six-table field overview

| Table | Scope | Core fields |
|---|---|---|
| `resumes` | user-owned | `id uuid`, `user_id uuid`, `filename text`, `raw_text text`, `parsed jsonb`, `status text`, `created_at timestamptz`, `updated_at timestamptz` |
| `job_preferences` | one row per user | `user_id uuid PK`, `keywords text[]`, `locations text[]`, `job_types text[]`, `min_salary numeric`, `filter_pr_citizen bool default true`, `excluded_keywords text[]`, `created_at`, `updated_at` |
| `job_sources` | system catalog | `id uuid`, `ats_type text`, `company_name text`, `company_legal_name text`, `board_token text`, `board_url text`, `company_url text`, `enabled bool`, `last_crawled_at`, timestamps |
| `jobs` | system catalog | `id uuid`, `source_id uuid`, `external_job_id text`, `content_hash text`, `company_legal_name`, `title`, `location_city`, `location_address`, `salary_raw`, `pay_disclosed bool`, `jd_raw`, `jd_summary`, `apply_url`, `source_url`, `company_url`, `contact_email_domain`, `is_free_email`, `is_im_only`, `contact_channel`, `employment_type`, `hours_per_week numeric`, `fee_description_raw`, `fee_keywords_hit text[]`, `identity_requirements_raw`, `status`, `first_seen_at`, `last_seen_at`, `closed_at`, timestamps |
| `job_matches` | user-owned | `id uuid`, `job_id uuid`, `resume_id uuid`, `user_id uuid`, `rule_score numeric`, `rule_passed bool`, `llm_grade text`, `llm_score numeric`, `gaps jsonb`, `created_at`, `updated_at`; unique `(job_id,resume_id,user_id)` |
| `vetting_reviews` | system/reviewer-owned | `id uuid`, `job_id uuid`, `reviewer uuid`, `risk_rating`, `risk_tags text[]`, `risk_points text`, `action text`, `status_match text`, `basis text`, `keywords_hit jsonb`, `status text`, timestamps |

RLS target: users can read/write only their `resumes`, `job_preferences`, and `job_matches`; active authenticated users can read open `jobs` and enabled `job_sources`; only service-role jobs write system catalogs; admins can read all, while vetting writes must pass through `vetting-review`. This scope preserves tenant isolation without allowing users to modify shared crawl results.

## Addendum v1.1 (2026-09-02) — job feed refresh, history, card status

Status: **frozen for frontend integration**. Adds a per-user "have I looked at / applied to this match" state on top of v1's job/match/vetting tables. The contract is authoritative for both Edge Functions and frontend clients.

### Data model change

`job_matches` gains three columns (migration `supabase/migrations/20260902_job_match_status_v1_1.sql`, does not touch the frozen v1 migration):

```sql
alter table public.job_matches
  add column status text not null default 'new'
    check (status in ('new', 'viewed', 'applied', 'expired')),
  add column viewed_at timestamptz,
  add column applied_at timestamptz;
```

- `new`: default on insert (a fresh match the user hasn't opened).
- `viewed`: set by `PATCH /job_matches/{id}/status` with `status=viewed`; server also stamps `viewed_at`.
- `applied`: set by the same endpoint with `status=applied`; server stamps `applied_at`. Frontend calls this after the existing "加入申请" write to `applications` succeeds — it is a status label on the match, not a duplicate of the applications table.
- `expired`: system-derived, not settable by the client. A background pass (part of `score-jobs`'s scheduled run) sets `status='expired'` when the underlying `jobs.status = 'closed'` and the match wasn't already `applied`. `PATCH` rejects `status=expired` from callers with `422 unprocessable`.

State machine: `new -> viewed -> applied`, and any of `new|viewed` `-> expired` (system only). `applied -> expired` is not allowed (an applied match keeps its `applied` status even if the listing later closes).

### 6. `GET /jobs/feed`

Purpose: the browsable job-card feed for the caller's default (or specified) resume, merging `jobs` + `job_matches` + `vetting_reviews`.

Auth: authenticated user JWT.

Query params: `resume_id` (optional, defaults to caller's most recently created resume), `grade` (optional `A|B|C|D|E|F` filter), `risk_rating` (optional `low|medium|high` filter), `status` (optional `new|viewed|applied|expired` filter on the match), `refresh` (optional boolean, default `false`), `limit` (default 50, max 200), `offset` (default 0).

`refresh=true` behavior: before reading, the function invokes `score-jobs` server-side (service-role, scoped to the caller's `resume_id`) so newly-crawled jobs the user hasn't been scored against yet get a `job_matches` row, then returns the feed. This is why refresh can take longer than a plain read — the frontend refresh button should show a loading state, not assume it's instant.

Response `200`:

```json
{
  "data": {
    "jobs": [
      {
        "match_id": "uuid",
        "job_id": "uuid",
        "company_legal_name": "...",
        "title": "...",
        "location_city": "...",
        "salary_raw": "...",
        "jd_summary": "...",
        "apply_url": "...",
        "employment_type": "...",
        "llm_grade": "B",
        "llm_score": 82,
        "risk_rating": "low",
        "vetting_status": "pending",
        "match_status": "new",
        "job_status": "new",
        "viewed_at": null,
        "applied_at": null
      }
    ],
    "total": 61,
    "refreshed": false
  },
  "meta": { "request_id": "uuid" }
}
```

`vetting_status` is the latest `vetting_reviews.status` for the job (`pending` if no review row exists yet — treat as unreviewed, not as a risk signal). `job_status` is the crawl-lifecycle status from `jobs.status` (`new|changed|closed`), distinct from `match_status`.

### 7. `GET /jobs/history`

Purpose: paginated list of every match the caller has ever had (including `expired`), for a "past recommendations" view. Same row shape as `/jobs/feed`, ordered by `job_matches.created_at desc`.

Auth: authenticated user JWT.

Query params: `resume_id` (optional), `status` (optional filter), `limit` (default 20, max 100), `offset` (default 0).

Response `200`: `{ "data": { "jobs": [...], "total": 214 }, "meta": {...} }` — same job-card row shape as `/jobs/feed`.

### 8. `PATCH /job_matches/{id}/status`

Purpose: record that the caller viewed or applied to a match.

Auth: authenticated user JWT; the function verifies `job_matches.user_id = auth.uid()` before writing (404, not 403, if the match isn't the caller's — avoids confirming a match id exists for another user).

Request:

```json
{ "status": "viewed" }
```

Constraints: `status` must be `viewed` or `applied`. `expired` is rejected with `422 unprocessable` (`{"error":{"code":"invalid_status_transition", ...}}`). Setting `applied` on a match that is already `expired` is also rejected — a listing that's already closed can't be freshly marked applied after the fact; the frontend should only call this immediately after the "加入申请" write succeeds, while the card is still visible in an active feed.

Response `200`:

```json
{
  "data": { "match": { "id": "uuid", "status": "applied", "viewed_at": "2026-09-02T00:00:00Z", "applied_at": "2026-09-02T00:00:10Z" } },
  "meta": { "request_id": "uuid" }
}
```

### Frontend `supabase-js` client signatures (addendum)

```ts
getJobFeed(input?: {
  resume_id?: string;
  grade?: "A"|"B"|"C"|"D"|"E"|"F";
  risk_rating?: "low"|"medium"|"high";
  status?: "new"|"viewed"|"applied"|"expired";
  refresh?: boolean;
  limit?: number;
  offset?: number;
}): Promise<ApiResult<{ jobs: JobCard[]; total: number; refreshed: boolean }>>;

getJobHistory(input?: { resume_id?: string; status?: string; limit?: number; offset?: number }): Promise<ApiResult<{ jobs: JobCard[]; total: number }>>;

updateMatchStatus(matchId: string, status: "viewed" | "applied"): Promise<ApiResult<{ match: JobMatchStatus }>>;
```

`getJobFeed`/`getJobHistory` are plain `GET` invocations (`supabase.functions.invoke` supports query params via the `method`/`body` options, or a direct `fetch` to the function URL with a query string — either is fine since both require the same Authorization header). `updateMatchStatus` is a `PATCH`.

Implementation note: `listMatchedJobs`/`getJobCard` from v1 are superseded by `getJobFeed`/`getJobHistory` for the feed/history views — the underlying job-card row shape is compatible (same fields), so existing card-rendering code should not need to change, only the fetch call.
