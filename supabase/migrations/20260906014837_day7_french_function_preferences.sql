-- Preference signals v1.5 (migration 0006): French-language exclusion and
-- soft job-function targeting. Existing migrations remain immutable.

alter table public.jobs
  add column requires_french boolean not null default false,
  add column job_function text,
  add constraint jobs_job_function_valid check (
    job_function is null or job_function in (
      'business_analysis', 'operations', 'public_affairs', 'market_research',
      'marketing', 'sales', 'finance', 'data_analysis', 'consulting', 'hr',
      'supply_chain', 'product'
    )
  );

alter table public.job_preferences
  add column exclude_french boolean not null default false,
  add column preferred_functions text[] not null default '{}',
  add constraint job_preferences_preferred_functions_valid check (
    preferred_functions <@ array[
      'business_analysis', 'operations', 'public_affairs', 'market_research',
      'marketing', 'sales', 'finance', 'data_analysis', 'consulting', 'hr',
      'supply_chain', 'product'
    ]::text[]
  );

create index jobs_requires_french_open_idx
  on public.jobs(requires_french, status)
  where status <> 'closed';
create index jobs_job_function_open_idx
  on public.jobs(job_function, status)
  where status <> 'closed';

-- French-language requirement: do not infer from location. In Canada,
-- bilingual/bilingue is treated as English/French; in the US it is not.
update public.jobs
set requires_french = case
  when concat_ws(' ', title, jd_raw) ~* '\m(french|français|francais)\M' then true
  when country_code = 'CA'
    and concat_ws(' ', title, jd_raw) ~* '\m(bilingual|bilingue)\M' then true
  else false
end;

-- Title-only classifier. Ordering is intentional: specific ambiguous titles
-- (Business Development, Data Analyst, Business Analyst, Policy/Regulatory)
-- are resolved before broader sales/operations/product terms.
update public.jobs
set job_function = case
  when title ~* '\m(data (analyst|analytics|analysis|science)|business intelligence|bi analyst)\M' then 'data_analysis'
  when title ~* '\m(business development|account executive|sales|revenue|partnerships?)\M' then 'sales'
  when title ~* '\m(business (analyst|analysis|analytics)|strategy analyst|process analyst)\M' then 'business_analysis'
  when title ~* '\m(public affairs?|government (affairs?|relations?)|policy|regulatory|advocacy|legislative)\M' then 'public_affairs'
  when title ~* '\m(market research|consumer insights?|customer insights?|research analyst)\M' then 'market_research'
  when title ~* '\m(supply chain|procurement|sourcing|logistics|inventory|distribution)\M' then 'supply_chain'
  when title ~* '\m(human resources?|people (operations?|partner)|talent acquisition|recruit(er|ing)|hr)\M' then 'hr'
  when title ~* '\m(consult(ant|ing)|advisory)\M' then 'consulting'
  when title ~* '\m(product (manager|management|operations?|analyst|marketing)|product owner)\M' then 'product'
  when title ~* '\m(finance|financial|accounting|accountant|audit|treasury|tax)\M' then 'finance'
  when title ~* '\m(marketing|brand|communications?|growth|content|social media)\M' then 'marketing'
  when title ~* '\m(operations?|operational|program (manager|management|coordinator)|project coordinator)\M' then 'operations'
  else null
end;

comment on column public.jobs.requires_french is
  'True when title/JD explicitly requires French; CA bilingual signals count, US bilingual alone does not.';
comment on column public.jobs.job_function is
  'Title-derived v1.5 job function; null means unclassified.';
comment on column public.job_preferences.exclude_french is
  'When true, French-required jobs are excluded from recommendation feed only.';
comment on column public.job_preferences.preferred_functions is
  'Preferred job functions; matching is a +12 soft score and never a hard filter.';
