-- API contract v1.1: per-user match status (new/viewed/applied/expired) on job_matches.
-- Additive only; does not modify the frozen v1 migration (20260901205439_backend_core_v1.sql).

alter table public.job_matches
  add column status text not null default 'new'
    check (status in ('new', 'viewed', 'applied', 'expired')),
  add column viewed_at timestamptz,
  add column applied_at timestamptz;

create index job_matches_user_status_idx on public.job_matches(user_id, status);

comment on column public.job_matches.status is
  'Caller-facing lifecycle: new -> viewed -> applied. expired is system-set only, via score-jobs, when jobs.status becomes closed and the match was not already applied.';
