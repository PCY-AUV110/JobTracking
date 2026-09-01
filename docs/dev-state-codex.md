# Codex backend development state

Updated: 2026-09-02

## Done

- Day 0 security fix accepted: commit `3751da6` removes the hardcoded debug-login backdoor.
- Isolated worktree created at `../jobtrack-backend` on `feature/backend-core`.
- API contract v1 frozen in `docs/api-contracts-v1.md` for Claude frontend integration.
- Confirmed backend ownership boundaries: `supabase/`, `.github/workflows/`, backend client wrapper, and backend docs.

## In progress

- Commit and push the API contract and this state file.

## Next

1. Create a migration for the six-table backend schema and RLS policies.
2. Add vetted GTA/ATS `job_sources` seed data with source evidence.
3. Implement `crawl-jobs`, then `parse-resume`, `score-jobs`, `vetting-flags`, and `vetting-review`.
4. Add the daily GitHub Actions chain and run one milestone-level integration test on port 8001.

## Blockers / decisions

- The technical-plan sentence saying all six tables are user-owned conflicts with shared scheduled ATS catalogs. Contract v1 resolves this as: three user-owned tables (`resumes`, `job_preferences`, `job_matches`) and three system/reviewer-owned tables (`job_sources`, `jobs`, `vetting_reviews`). Shared catalogs are readable but never browser-writable. Confirm during migration review.
- GTA employer-to-ATS board mapping must be source-verified before seed insertion; unknown mappings will not be guessed.
- Existing OpenAI channel will be reused; actual secrets remain server-side and are not copied into repository files.
- Main worktree contains Claude's concurrent frontend changes. Do not edit or stage files there.

## Token discipline

- Prefer targeted reads and focused checks; avoid repeated full-repository scans.
- Run heavy service/end-to-end verification once per major milestone.
- Record material progress here before generating the next large implementation block.
