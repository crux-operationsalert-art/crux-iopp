-- Zonal Tracker layout attributes (owner-editable in Admin) and who-was-responsible on history rows.
alter table public.zones add column if not exists sort_order int, add column if not exists tracker_style jsonb;
comment on column public.zones.tracker_style is 'Tracker colours for this zone: {"header":"BDD7EE","leaf":"CFE2F3","total":"9FC5E8"} (hex, no #)';
alter table public.branches add column if not exists tier text check (tier in ('Zone A','Zone B')), add column if not exists sort_order int;
alter table public.clients add column if not exists sort_order int;
alter table public.tracker_monthly add column if not exists head_name text, add column if not exists stakeholder_name text;
comment on column public.tracker_monthly.head_name is 'Branch manager / BA recorded against this row in the source tracker (history is never re-attributed to today''s heads)';
