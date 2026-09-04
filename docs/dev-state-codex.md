# Codex backend development state

Updated: 2026-09-04

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
- Priority-employer Phase A drafted behind a review gate: migration 0005, a 50-company US/CA seed (30 CA, 20 US), and the isolated Playwright/Actions design. Nothing has been applied or scheduled pending Steven's approval.
- Six-table migration validated against the linked Supabase project prerequisites (`update_profiles_updated_at` and `is_super_admin`) and prepared for deployment.
- Confirmed backend ownership boundaries: `supabase/`, `.github/workflows/`, backend client wrapper, and backend docs.

## In progress

- Await Steven's review of the first 50 priority employers before Phase B implementation or production insertion.

## Next

1. Incorporate Steven's additions/removals/tier changes to the 50-company review seed.
2. After approval, apply migration/seed and implement the bounded Playwright discovery workflow.
3. Promote any verified Greenhouse/Lever/Ashby boards into the existing ATS JSON fast path.

## Blockers / decisions

- The technical-plan sentence saying all six tables are user-owned conflicts with shared scheduled ATS catalogs. Contract v1 resolves this as: three user-owned tables (`resumes`, `job_preferences`, `job_matches`) and three system/reviewer-owned tables (`job_sources`, `jobs`, `vetting_reviews`). Shared catalogs are readable but never browser-writable. Confirm during migration review.
- GTA employer-to-ATS board mapping must be source-verified before seed insertion; unknown mappings will not be guessed.
- Existing OpenAI channel will be reused; actual secrets remain server-side and are not copied into repository files.
- Main worktree contains Claude's concurrent frontend changes. Do not edit or stage files there.

## Token discipline

- Prefer targeted reads and focused checks; avoid repeated full-repository scans.
- Run heavy service/end-to-end verification once per major milestone.
- Record material progress here before generating the next large implementation block.
