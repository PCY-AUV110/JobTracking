# Codex backend development state

Updated: 2026-09-02

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
- JWT-protected `job-feed` and `job-history` functions deployed; first feed load scores the caller's latest parsed resume on demand.
- Six-table migration validated against the linked Supabase project prerequisites (`update_profiles_updated_at` and `is_super_admin`) and prepared for deployment.
- Confirmed backend ownership boundaries: `supabase/`, `.github/workflows/`, backend client wrapper, and backend docs.

## In progress

- Merge current `main`, complete final diff review, and publish backend core.

## Next

1. Add vetted GTA/ATS `job_sources` seed data with source evidence.
2. Implement `crawl-jobs`, then `parse-resume`, `score-jobs`, `vetting-flags`, and `vetting-review`.
3. Add the daily GitHub Actions chain and run one milestone-level integration test on port 8001.

## Blockers / decisions

- The technical-plan sentence saying all six tables are user-owned conflicts with shared scheduled ATS catalogs. Contract v1 resolves this as: three user-owned tables (`resumes`, `job_preferences`, `job_matches`) and three system/reviewer-owned tables (`job_sources`, `jobs`, `vetting_reviews`). Shared catalogs are readable but never browser-writable. Confirm during migration review.
- GTA employer-to-ATS board mapping must be source-verified before seed insertion; unknown mappings will not be guessed.
- Existing OpenAI channel will be reused; actual secrets remain server-side and are not copied into repository files.
- Main worktree contains Claude's concurrent frontend changes. Do not edit or stage files there.

## Token discipline

- Prefer targeted reads and focused checks; avoid repeated full-repository scans.
- Run heavy service/end-to-end verification once per major milestone.
- Record material progress here before generating the next large implementation block.
