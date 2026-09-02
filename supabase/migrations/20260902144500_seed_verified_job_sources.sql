-- Source verified 2026-09-02 against Ashby's public posting API.
insert into public.job_sources
  (ats_type, company_name, company_legal_name, board_token, board_url, company_url, enabled)
values
  ('ashby', 'Wealthsimple', 'Wealthsimple Technologies Inc.', 'wealthsimple',
   'https://api.ashbyhq.com/posting-api/job-board/wealthsimple',
   'https://www.wealthsimple.com/en-ca/careers', true)
on conflict (ats_type, board_token) do update set
  company_name = excluded.company_name,
  company_legal_name = excluded.company_legal_name,
  board_url = excluded.board_url,
  company_url = excluded.company_url,
  enabled = true,
  updated_at = now();
