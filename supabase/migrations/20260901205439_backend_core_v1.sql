-- OfferFlow intelligent job-search backend core v1.
-- User-owned data is tenant-isolated. ATS catalogs are shared, browser-read-only,
-- and writable only by service-role Edge Functions.

create table public.resumes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  filename text not null check (char_length(filename) between 1 and 255),
  raw_text text not null check (char_length(raw_text) between 1 and 100000),
  parsed jsonb not null default '{}'::jsonb,
  status text not null default 'pending'
    check (status in ('pending', 'parsing', 'parsed', 'failed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index resumes_user_created_idx on public.resumes(user_id, created_at desc);

create table public.job_preferences (
  user_id uuid primary key references auth.users(id) on delete cascade,
  keywords text[] not null default '{}',
  locations text[] not null default '{}',
  job_types text[] not null default '{}',
  min_salary numeric(12,2) check (min_salary is null or min_salary >= 0),
  filter_pr_citizen boolean not null default true,
  excluded_keywords text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.job_sources (
  id uuid primary key default gen_random_uuid(),
  ats_type text not null check (ats_type in ('greenhouse', 'lever', 'ashby', 'workday')),
  company_name text not null,
  company_legal_name text,
  board_token text not null,
  board_url text not null,
  company_url text,
  enabled boolean not null default true,
  last_crawled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (ats_type, board_token)
);

create index job_sources_enabled_idx on public.job_sources(enabled, ats_type);

create table public.jobs (
  id uuid primary key default gen_random_uuid(),
  source_id uuid not null references public.job_sources(id) on delete restrict,
  external_job_id text not null,
  content_hash text not null,
  company_legal_name text,
  title text not null,
  location_city text,
  location_address text,
  salary_raw text,
  pay_disclosed boolean not null default false,
  jd_raw text not null,
  jd_summary text,
  apply_url text not null,
  source_url text not null,
  company_url text,
  contact_email_domain text,
  is_free_email boolean not null default false,
  is_im_only boolean not null default false,
  contact_channel text,
  employment_type text,
  hours_per_week numeric(5,2) check (hours_per_week is null or hours_per_week between 0 and 168),
  fee_description_raw text,
  fee_keywords_hit text[] not null default '{}',
  identity_requirements_raw text,
  status text not null default 'new' check (status in ('new', 'changed', 'closed')),
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  closed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (source_id, external_job_id)
);

create index jobs_status_seen_idx on public.jobs(status, last_seen_at desc);
create index jobs_source_idx on public.jobs(source_id);
create index jobs_title_idx on public.jobs(title);

create table public.job_matches (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.jobs(id) on delete cascade,
  resume_id uuid not null references public.resumes(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  rule_score numeric(5,2) check (rule_score is null or rule_score between 0 and 100),
  rule_passed boolean not null default false,
  llm_grade text check (llm_grade is null or llm_grade in ('A', 'B', 'C', 'D', 'E', 'F')),
  llm_score numeric(5,2) check (llm_score is null or llm_score between 0 and 100),
  gaps jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (job_id, resume_id, user_id)
);

create index job_matches_user_score_idx on public.job_matches(user_id, llm_score desc nulls last);
create index job_matches_job_idx on public.job_matches(job_id);

create table public.vetting_reviews (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.jobs(id) on delete cascade,
  reviewer uuid references auth.users(id) on delete set null,
  risk_rating text not null check (risk_rating in ('low', 'medium', 'high')),
  risk_tags text[] not null default '{}',
  risk_points text not null,
  action text not null,
  status_match text not null,
  basis text not null,
  keywords_hit jsonb not null default '{}'::jsonb,
  status text not null default 'pending'
    check (status in ('pending', 'auto_flagged', 'needs_human', 'approved', 'rejected')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index vetting_reviews_job_created_idx on public.vetting_reviews(job_id, created_at desc);
create index vetting_reviews_status_idx on public.vetting_reviews(status, risk_rating);

-- Reuse the repository's existing updated_at trigger function.
create trigger resumes_updated_at before update on public.resumes
for each row execute function public.update_profiles_updated_at();
create trigger job_preferences_updated_at before update on public.job_preferences
for each row execute function public.update_profiles_updated_at();
create trigger job_sources_updated_at before update on public.job_sources
for each row execute function public.update_profiles_updated_at();
create trigger jobs_updated_at before update on public.jobs
for each row execute function public.update_profiles_updated_at();
create trigger job_matches_updated_at before update on public.job_matches
for each row execute function public.update_profiles_updated_at();
create trigger vetting_reviews_updated_at before update on public.vetting_reviews
for each row execute function public.update_profiles_updated_at();

alter table public.resumes enable row level security;
alter table public.job_preferences enable row level security;
alter table public.job_sources enable row level security;
alter table public.jobs enable row level security;
alter table public.job_matches enable row level security;
alter table public.vetting_reviews enable row level security;

-- User-owned tables: owners have CRUD; super admins have read-only visibility.
create policy resumes_owner_all on public.resumes for all to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);
create policy resumes_super_admin_read on public.resumes for select to authenticated
using ((select public.is_super_admin()));

create policy job_preferences_owner_all on public.job_preferences for all to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);
create policy job_preferences_super_admin_read on public.job_preferences for select to authenticated
using ((select public.is_super_admin()));

create policy job_matches_owner_all on public.job_matches for all to authenticated
using ((select auth.uid()) = user_id)
with check (
  (select auth.uid()) = user_id
  and exists (
    select 1 from public.resumes r
    where r.id = resume_id and r.user_id = (select auth.uid())
  )
);
create policy job_matches_super_admin_read on public.job_matches for select to authenticated
using ((select public.is_super_admin()));

-- Shared catalogs: authenticated users can read active/open content. All writes are
-- reserved for service-role Edge Functions, which bypass RLS.
create policy job_sources_authenticated_read on public.job_sources for select to authenticated
using (enabled or (select public.is_super_admin()));
create policy jobs_authenticated_read on public.jobs for select to authenticated
using (status <> 'closed' or (select public.is_super_admin()));
create policy vetting_reviews_authenticated_read on public.vetting_reviews for select to authenticated
using (true);

grant select, insert, update, delete on public.resumes to authenticated;
grant select, insert, update, delete on public.job_preferences to authenticated;
grant select on public.job_sources to authenticated;
grant select on public.jobs to authenticated;
grant select, insert, update, delete on public.job_matches to authenticated;
grant select on public.vetting_reviews to authenticated;

comment on table public.job_sources is 'Shared ATS source catalog; service-role writes only.';
comment on table public.jobs is 'Normalized shared job catalog; jd_raw retains the source text verbatim.';
comment on table public.vetting_reviews is 'Automated and human vetting decisions; writes pass through Edge Functions.';
