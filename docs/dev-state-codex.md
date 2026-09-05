# Codex backend development state

Updated: 2026-09-05

## Done

- Day 0 security fix accepted: commit `3751da6` removes the hardcoded debug-login backdoor.
- Isolated worktree created at `../jobtrack-backend` on `feature/backend-core`.
- API contract v1 frozen in `docs/api-contracts-v1.md` for Claude frontend integration.
- API contract/state commit `b6844ec` pushed to `origin/feature/backend-core`.
- API contract v1.1 frozen for feed refresh, paginated history, and match-status transitions.
- Day 2 frontend fixes deployed to `main` at merge commit `f33d58f` and verified on GitHub Pages with zero browser console warnings/errors.
- Five backend Edge Functions implemented with shared authenticated/service-role helpers; daily public-ATS crawl workflow added.
- All five functions deployed ACTIVE v1 with JWT verification; unauthenticated smoke test correctly returns HTTP 401.
- Seeded the first source-verified GTA/Canada ATS board: Wealthsimple via Ashby public posting API.
- Day 3: expanded to 43 verified ATS sources and persisted 5,959 deduplicated open jobs; funnel report is in `docs/day3-crawl-funnel.md`.
- GitHub Actions secrets configured; OpenAI verified by a successful minimal live request.
- Day 4: crawl workflow now isolates per-source failures and writes success/failure details to the Actions run summary.
- Day 4 production crawl run `33766630211` completed successfully: 32/43 sources succeeded, 11 resource-limited sources were isolated, 3,690 postings were fetched, and the production catalog reached 6,393 jobs.
- JWT-protected `job-feed` and `job-history` functions deployed; first feed load scores the caller's latest parsed resume on demand.
- Day 4 production smoke passed with an ephemeral Auth user: `parse-resume` persisted one parsed resume, `score-jobs` created one passing match with one LLM call, and both feed/history returned it; the test user was deleted afterward.
- Day 5 migration `20260904033427_day5_work_mode_country.sql` is applied: jobs now carry normalized `work_mode`/`country_code`, and preferences carry `work_modes[]`/`countries[]`.
- Day 5 crawl normalization and soft score bonuses are deployed (`work_mode` +8, country +10; mismatches never hard-filter).
- Day 5 authenticated feed smoke passed with `work_mode=hybrid&country=CA`; the response returned one matching row with both normalized fields, then the ephemeral user was deleted.
- Priority-employer Phase B is live: migration 0005 and a balanced 95-company seed (45 CA, 50 US) are applied in production; every employer remains on the neutral default `priority_tier=2`.
- The independent Playwright discovery pipeline is merged at `20373fc`. It runs daily in batches of 15 (manual batch defaults to 3), uses one isolated browser context per employer, obeys robots/access controls, stops at the public application destination, and uploads screenshots/redirect evidence for 14 days.
- Production workflow run `33913648483` succeeded for Gartner, TELUS, and Canadian Tire: Gartner's public Workday apply destination was confirmed; TELUS was stopped by robots policy; Canadian Tire exposed no public apply link. Failures were isolated.
- The five requested pending employers were checked with real Chromium: Gartner verified; Manulife and McKinsey stopped by robots policy; TELUS stopped by robots policy in Actions; Canadian Tire remains pending because no public apply link was exposed. No bypass was attempted.
- `job-feed` and `job-history` are deployed with API v1.4 `is_priority_employer`; an authenticated ephemeral-user smoke test confirmed both endpoints return the boolean field. The user and cascade-owned smoke data were deleted afterward.
- Claude's priority-employer badge was reviewed and merged at `37ec1bd`; absent/false fields hide cleanly.
- Resume deletion incident fixed: the personal resume list now explicitly scopes `resumes.user_id` even for super admins, and DELETE verifies an owner-scoped returned row instead of treating an RLS-blocked zero-row mutation as success. Production upload/delete/re-query smoke passed with an ephemeral user.
- Removed the two orphan smoke users and their `smoke.pdf` / `priority-smoke.pdf` rows, linked matches, and AI usage logs. Steven's real `CHIYOU (STEVEN) PENG.pdf` was preserved; no PDF objects existed in Storage because the current client sends extracted text only.
- Six-table migration validated against the linked Supabase project prerequisites (`update_profiles_updated_at` and `is_super_admin`) and prepared for deployment.
- Confirmed backend ownership boundaries: `supabase/`, `.github/workflows/`, backend client wrapper, and backend docs.

## In progress

- Phase B is complete; monitoring daily browser discovery and waiting for Phase C approval before expanding from 95 to 200 employers.

## Next

1. Phase C: expand the reviewed directory from 95 to 200 employers with the same industry-balance and URL-verification gate.
2. Promote newly verified Greenhouse/Lever/Ashby boards into the existing ATS JSON fast path.
3. Add dedicated normalized browser-job ingestion only if Phase C requires jobs not exposed by a supported public ATS API.

## Blockers / decisions

- The technical-plan sentence saying all six tables are user-owned conflicts with shared scheduled ATS catalogs. Contract v1 resolves this as: three user-owned tables (`resumes`, `job_preferences`, `job_matches`) and three system/reviewer-owned tables (`job_sources`, `jobs`, `vetting_reviews`). Shared catalogs are readable but never browser-writable. Confirm during migration review.
- GTA employer-to-ATS board mapping must be source-verified before seed insertion; unknown mappings will not be guessed.
- Existing OpenAI channel will be reused; actual secrets remain server-side and are not copied into repository files.
- Main worktree contains Claude's concurrent frontend changes. Do not edit or stage files there.

## Token discipline

- Prefer targeted reads and focused checks; avoid repeated full-repository scans.
- Run heavy service/end-to-end verification once per major milestone.
- Record material progress here before generating the next large implementation block.
- Never run smoke tests under a real user. Every test must use an ephemeral dedicated Auth user with an EXIT cleanup trap, then verify zero remaining Auth/database/Storage rows before reporting success.
