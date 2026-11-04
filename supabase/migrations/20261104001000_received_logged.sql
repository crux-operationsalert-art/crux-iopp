-- D-70 Daily operations fields (owner, 04 Nov):
--   Rollover (yesterday's net pending, not editable) · Received · Entry (logged in the client portal; never more than
--   received) · Closed · Cancelled.  Net pendency = Rollover + Received − Closed − Cancelled, split by age.
--   Revenue = (Received − Cancelled) × rate.
-- The existing column `entry` already carries every incoming-case calculation in the tool (revenue, MTD, Zonal Tracker
-- "Incoming", targets, pending tally), so it now holds RECEIVED and keeps all of them correct; the new column `logged`
-- holds Entry. History before today has no Entry figure (shown blank).
alter table public.productivity_lines add column if not exists logged int check (logged is null or logged >= 0);
comment on column public.productivity_lines.entry is 'Received: cases received from the client that day (basis of revenue, MTD and pendency)';
comment on column public.productivity_lines.logged is 'Entry: of the cases received that day, how many were logged in the client portal (never more than received)';

-- a correction that lowers Received never leaves Entry above it
create or replace function app.clamp_logged() returns trigger language plpgsql as $$
begin
  if new.logged is not null and new.logged > new.entry then new.logged := new.entry; end if;
  return new;
end $$;
create trigger trg_clamp_logged before insert or update of entry, logged on public.productivity_lines for each row execute function app.clamp_logged();
alter table public.productivity_lines add constraint logged_le_received check (logged is null or logged <= entry);

do $do$
declare f text; o text;
begin
  f := pg_get_functiondef('public.save_productivity(date,jsonb,uuid,text)'::regprocedure); o := f;
  f := replace(f, '    insert into public.productivity_lines as l
      (person_id, work_date, client_location_id, entry, closure, cancelled, source, entered_by, reason)',
'    if (r->>''logged'') is not null and (r->>''logged'')::int > greatest(coalesce((r->>''entry'')::int, 0), 0) then
      raise exception ''Entry (%) cannot be more than Received (%).'', r->>''logged'', coalesce(r->>''entry'', ''0'') using errcode = ''22023'';
    end if;
    if app.prev_pending(v_person, (r->>''client_location_id'')::uuid, p_work_date) is not null
       and coalesce((r->>''closure'')::int, 0) + coalesce((r->>''cancelled'')::int, 0)
           > app.prev_pending(v_person, (r->>''client_location_id'')::uuid, p_work_date) + coalesce((r->>''entry'')::int, 0) then
      raise exception ''Closed + cancelled (%) cannot be more than rollover + received (%).'',
        coalesce((r->>''closure'')::int, 0) + coalesce((r->>''cancelled'')::int, 0),
        app.prev_pending(v_person, (r->>''client_location_id'')::uuid, p_work_date) + coalesce((r->>''entry'')::int, 0) using errcode = ''22023'';
    end if;
    insert into public.productivity_lines as l
      (person_id, work_date, client_location_id, entry, closure, cancelled, source, entered_by, reason, logged)');
  f := replace(f, '            v_source, v_me, nullif(p_reason, ''''))',
                  '            v_source, v_me, nullif(p_reason, ''''), (r->>''logged'')::int)');
  f := replace(f, '      set entry = excluded.entry, closure = excluded.closure, cancelled = excluded.cancelled,',
                  '      set entry = excluded.entry, closure = excluded.closure, cancelled = excluded.cancelled, logged = excluded.logged,');
  f := replace(f, '      where (l.entry, l.closure, l.cancelled) is distinct from (excluded.entry, excluded.closure, excluded.cancelled);',
                  '      where (l.entry, l.closure, l.cancelled, l.logged) is distinct from (excluded.entry, excluded.closure, excluded.cancelled, excluded.logged);');
  if f = o or position('logged = excluded.logged' in f) = 0 or position('(r->>''logged'')::int)' in f) = 0 or position('rollover + received' in f) = 0 then
    raise exception 'save_productivity anchors not found'; end if;
  execute f;

  f := pg_get_functiondef('public.my_day(date)'::regprocedure); o := f;
  f := replace(f, '''entry'', l.entry, ''closure'', l.closure', '''entry'', l.entry, ''logged'', l.logged, ''closure'', l.closure');
  if f = o then raise exception 'my_day anchor not found'; end if;
  execute f;
end $do$;
