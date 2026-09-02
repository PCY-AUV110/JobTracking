-- Additive Day 3 preference fields. Empty arrays mean "no preference".
alter table public.job_preferences
  add column internship_duration text[] not null default '{}'
    check (internship_duration <@ array['4m','8m','12m']::text[]),
  add column start_season text[] not null default '{}'
    check (start_season <@ array['fall','winter','summer']::text[]);

comment on column public.job_preferences.internship_duration is
  'Preferred internship lengths: 4m, 8m, 12m. Soft-scored, never a hard filter.';
comment on column public.job_preferences.start_season is
  'Preferred start seasons: fall, winter, summer. Soft-scored, never a hard filter.';
