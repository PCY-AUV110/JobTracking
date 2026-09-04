-- Phase A/B schema for the curated priority-employer catalog.
-- The reviewed 50-company seed remains separate until Steven approves it.

alter table public.jobs
  add column is_priority_employer boolean not null default false;

create index jobs_priority_open_idx
  on public.jobs(is_priority_employer, last_seen_at desc)
  where is_priority_employer = true;

create table public.priority_employers (
  id uuid primary key default gen_random_uuid(),
  company_name text not null check (char_length(company_name) between 1 and 200),
  country text not null check (country in ('US', 'CA')),
  gta_relevance text not null check (gta_relevance in ('high', 'medium', 'low')),
  industry text not null,
  career_url text not null check (career_url ~ '^https://'),
  ats_type text not null check (ats_type in ('greenhouse', 'lever', 'ashby', 'workday', 'custom', 'browser_only')),
  crawl_strategy text not null check (crawl_strategy in ('ats_api', 'playwright_click')),
  priority_tier smallint not null default 2 check (priority_tier between 1 and 3),
  verify_status text not null default 'pending' check (verify_status in ('pending', 'verified', 'failed')),
  last_success_at timestamptz,
  last_apply_url text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index priority_employers_company_country_uidx
  on public.priority_employers(lower(company_name), country);
create index priority_employers_queue_idx
  on public.priority_employers(verify_status, priority_tier, gta_relevance, updated_at);

create trigger priority_employers_updated_at
  before update on public.priority_employers
  for each row execute function public.update_profiles_updated_at();

alter table public.priority_employers enable row level security;

create policy priority_employers_authenticated_read
  on public.priority_employers for select to authenticated
  using (true);

grant select on public.priority_employers to authenticated;
revoke insert, update, delete on public.priority_employers from anon, authenticated;

comment on table public.priority_employers is
  'Curated US/Canada employers for a separately scheduled, public-page-only discovery pipeline.';
comment on column public.priority_employers.last_apply_url is
  'Last publicly reachable job-specific Apply URL; discovery stops before login or submission.';
