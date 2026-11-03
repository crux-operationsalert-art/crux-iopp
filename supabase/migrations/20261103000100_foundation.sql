-- IOPP foundation: extensions, schemas, settings, clock, calendar helpers.
create schema if not exists extensions;
create extension if not exists btree_gist with schema extensions;
create schema if not exists app;

do $$ begin
  create type app.fn as enum ('operations','collections');
exception when duplicate_object then null; end $$;
do $$ begin
  create type app.role_code as enum
    ('executive','manager','bm','ba','zm','ops_head','collections_head','admin','hr_admin','auditor');
exception when duplicate_object then null; end $$;

-- Every tunable value lives here (D-T6, D-T7).
create table public.settings (
  key text primary key,
  value jsonb not null,
  description text not null,
  updated_at timestamptz not null default now()
);
insert into public.settings(key, value, description) values
 ('business_tz', '"Asia/Kolkata"', 'Business timezone for windows and dates'),
 ('grace_until', '"10:00"', 'Local time on D+1 when the grace window closes (SOW 7.3)'),
 ('target_lock_working_days', '5', 'Targets lock at end of this working day of the month (SOW 8.3)'),
 ('weekly_off_dow', '[0]', 'ISO dow numbers that are weekly off; 0 = Sunday (D-08)'),
 ('allow_fake_clock', 'false', 'TEST ONLY. Never true in staging/production (D-T7)'),
 ('absence_trigger_days', '3', 'Unplanned absence threshold (D-10)'),
 ('absence_trigger_basis', '"working_days"', 'working_days | calendar_days (D-10)'),
 ('invite_expiry_working_hours', '48', 'Activation invite validity (D-13)'),
 ('shift_start', '"10:00"', 'Default shift start (D-08)'),
 ('shift_end', '"19:00"', 'Default shift end (D-08)'),
 ('break_minutes', '60', 'Placeholder break; HR to confirm (D-08)');

create or replace function app.setting(p_key text) returns jsonb
language sql stable security definer set search_path = public, app, pg_temp as
$$ select value from public.settings where key = p_key $$;

create or replace function app.tz() returns text
language sql stable as $$ select coalesce(app.setting('business_tz') #>> '{}', 'Asia/Kolkata') $$;

-- Single source of "now". A fake clock is honoured only when the setting allows it.
create or replace function app.clock() returns timestamptz
language plpgsql stable as $$
declare v text;
begin
  if coalesce((app.setting('allow_fake_clock'))::text::boolean, false) then
    v := current_setting('app.fake_now', true);
    if v is not null and v <> '' then return v::timestamptz; end if;
  end if;
  return now();
end $$;

create or replace function app.today() returns date
language sql stable as $$ select (app.clock() at time zone app.tz())::date $$;

