-- Hardening after the first advisor run: pin search_path everywhere; remove default write grants
-- (Supabase grants ALL to authenticated by default) from tables that must only change through RPCs.
alter function app.tz() set search_path = public, app, pg_temp;
alter function app.clock() set search_path = public, app, pg_temp;
alter function app.today() set search_path = public, app, pg_temp;
alter function app.working_days_between(date, date, uuid) set search_path = public, app, pg_temp;
alter function app.is_admin() set search_path = public, app, pg_temp;
alter function app.window_state(date) set search_path = public, app, pg_temp;
alter function app.can_write_day(uuid, date, app.fn) set search_path = public, app, pg_temp;
alter function app.require_writable(uuid, date, app.fn) set search_path = public, app, pg_temp;
alter function app.collection_status() set search_path = public, app, pg_temp;
alter function app.can_record_collections(uuid, date) set search_path = public, app, pg_temp;
alter function app.target_lock_at(date) set search_path = public, app, pg_temp;
alter function app.metric_function(text) set search_path = public, app, pg_temp;
alter function app.invite_expiry(timestamptz) set search_path = public, app, pg_temp;
alter function app.person_defaults() set search_path = public, app, pg_temp;
alter function app.audit_immutable() set search_path = public, app, pg_temp;

revoke insert, update, delete, truncate on public.productivity_lines, public.day_status, public.certifications,
  public.reopen_grants, public.collection_entries, public.bill_entries, public.target_allocations,
  public.penalty_ledger, public.notifications, public.audit_events from authenticated;
revoke truncate, references, trigger on all tables in schema public from authenticated;

-- A fake clock must never be switchable on a live system.
create or replace function app.settings_guard() returns trigger
language plpgsql set search_path = public, app, pg_temp as $$
begin
  if new.key = 'allow_fake_clock' and new.value <> 'false'::jsonb and current_user <> 'postgres' then
    raise exception 'allow_fake_clock can only be changed by a database migration.' using errcode = '42501';
  end if;
  new.updated_at := now();
  return new;
end $$;
create trigger trg_settings_guard before insert or update on public.settings
  for each row execute function app.settings_guard();
