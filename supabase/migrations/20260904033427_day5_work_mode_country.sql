-- Day 5: structured work mode and country filters.
-- Existing migrations remain immutable; unknown preserves jobs we cannot classify safely.

alter table public.jobs
  add column work_mode text not null default 'unknown'
    check (work_mode in ('in_person', 'remote', 'hybrid', 'unknown')),
  add column country_code text not null default 'unknown'
    check (country_code in ('US', 'CA', 'unknown'));

alter table public.job_preferences
  add column work_modes text[] not null default '{}',
  add column countries text[] not null default '{}',
  add constraint job_preferences_work_modes_valid
    check (work_modes <@ array['in_person', 'remote', 'hybrid']::text[]),
  add constraint job_preferences_countries_valid
    check (countries <@ array['US', 'CA']::text[]);

create index jobs_work_mode_idx on public.jobs(work_mode);
create index jobs_country_code_idx on public.jobs(country_code);

-- Canadian locations are checked first because US state abbreviations such as ON
-- are too ambiguous to use without a Canadian city/province context.
update public.jobs
set country_code = case
  when coalesce(location_city, '') ~* '\m(canada|canadian|ontario|toronto|mississauga|brampton|markham|vaughan|richmond hill|oakville|burlington|hamilton|ottawa|montreal|québec|quebec|vancouver|victoria|calgary|edmonton|winnipeg|halifax|kitchener|waterloo)\M'
    or coalesce(location_city, '') ~* '(^|[,[:space:]])(ON|QC|BC|AB|MB|NS|NB|NL|PE|SK)([,[:space:]]|$)'
    then 'CA'
  when coalesce(location_city, '') ~* '\m(united states|u\.s\.|usa|new york|san francisco|los angeles|seattle|boston|chicago|austin|dallas|houston|atlanta|denver|washington|portland|philadelphia|miami|palo alto|mountain view|menlo park|san jose)\M'
    or coalesce(location_city, '') ~* '(^|[,[:space:]])(AL|AK|AZ|AR|CA|CO|CT|DE|FL|GA|HI|ID|IL|IN|IA|KS|KY|LA|ME|MD|MA|MI|MN|MS|MO|MT|NE|NV|NH|NJ|NM|NY|NC|ND|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VT|VA|WA|WV|WI|WY|DC)([,[:space:]]|$)'
    then 'US'
  else 'unknown'
end;

comment on column public.jobs.work_mode is 'Normalized work arrangement: in_person, remote, hybrid, or unknown.';
comment on column public.jobs.country_code is 'Normalized job country: US, CA, or unknown.';
comment on column public.job_preferences.work_modes is 'Preferred work arrangements; empty means no preference.';
comment on column public.job_preferences.countries is 'Preferred countries (US/CA); empty means no preference.';
