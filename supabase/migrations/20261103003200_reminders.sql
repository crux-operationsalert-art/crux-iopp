-- D-50 (SOW 16.1): reminders, sent in the app and to phones (push) by the hourly job.
--   20:00 and 22:00 on working days — "today's figures not submitted yet" to each person still pending;
--   22:00 — each manager gets the count and names of direct reports still pending;
--   08:00 — grace closes at 10:00 for yesterday's pending report;
--   10:00 on the day before targets lock and on the lock day — managers and heads: set your team's targets;
--   at once — a reopened day / target month (to the person) and a penalty proposal (record only) to the person.
-- Each reminder is sent once (de-duplicated by kind + link).
create or replace function app.reminders() returns int
language plpgsql security definer set search_path = public, app, pg_temp as $$
declare v_now timestamptz := app.clock(); v_d date := app.today(); v_h int; n int := 0; k int; v_m date; v_lock date;
begin
  v_h := extract(hour from v_now at time zone app.tz())::int;
  if v_h in (20, 22) and app.is_working_day(v_d) then
    with due as (
      select distinct a.person_id from public.allocations a join public.persons p on p.id = a.person_id
       where a.function = 'operations' and a.valid @> v_d and p.status = 'active'
         and not exists (select 1 from public.day_status s where s.person_id = a.person_id and s.work_date = v_d and s.function = 'operations'
                          and s.status in ('submitted','manager_entered','absent','on_leave','non_operational')))
    insert into public.notifications(person_id, kind, message, link)
    select d.person_id, 'deadline', 'Today''s figures are not submitted yet — the day closes at 11:59 PM.', '/productivity?date=' || v_d || '&r=' || v_h
      from due d where not exists (select 1 from public.notifications x where x.person_id = d.person_id and x.kind = 'deadline'
                                     and x.link = '/productivity?date=' || v_d || '&r=' || v_h);
    get diagnostics k = row_count; n := n + k;
    if v_h = 22 then
      with due as (
        select distinct a.person_id from public.allocations a join public.persons p on p.id = a.person_id
         where a.function = 'operations' and a.valid @> v_d and p.status = 'active'
           and not exists (select 1 from public.day_status s where s.person_id = a.person_id and s.work_date = v_d and s.function = 'operations'
                            and s.status in ('submitted','manager_entered','absent','on_leave','non_operational'))),
      mgr as (select r.manager_id, count(*) c, string_agg(p.full_name, ', ' order by p.full_name) names
                from due d join public.reporting_lines r on r.person_id = d.person_id and r.function = 'operations' and r.valid @> v_d
                join public.persons p on p.id = d.person_id group by r.manager_id)
      insert into public.notifications(person_id, kind, message, link)
      select m.manager_id, 'team_deadline', m.c || ' in your team have not submitted today: ' || left(m.names, 200), '/team?date=' || v_d
        from mgr m where not exists (select 1 from public.notifications x where x.person_id = m.manager_id and x.kind = 'team_deadline' and x.link = '/team?date=' || v_d);
      get diagnostics k = row_count; n := n + k;
    end if;
  end if;
  if v_h = 8 and app.is_working_day(v_d - 1) then
    with due as (
      select distinct a.person_id from public.allocations a join public.persons p on p.id = a.person_id
       where a.function = 'operations' and a.valid @> (v_d - 1) and p.status = 'active'
         and not exists (select 1 from public.day_status s where s.person_id = a.person_id and s.work_date = v_d - 1 and s.function = 'operations'
                          and s.status in ('submitted','manager_entered','absent','on_leave','non_operational')))
    insert into public.notifications(person_id, kind, message, link)
    select d.person_id, 'grace', 'Yesterday''s figures are still pending — you can submit until 10:00 AM today (marked late).', '/productivity?date=' || (v_d - 1)
      from due d where not exists (select 1 from public.notifications x where x.person_id = d.person_id and x.kind = 'grace' and x.link = '/productivity?date=' || (v_d - 1));
    get diagnostics k = row_count; n := n + k;
  end if;
  v_m := date_trunc('month', v_d)::date; v_lock := ((app.target_lock_at(v_m) - interval '1 second') at time zone app.tz())::date;   -- the last day targets can be set
  if v_h = 10 and v_d between v_lock - 1 and v_lock and v_now < app.target_lock_at(v_m) then
    insert into public.notifications(person_id, kind, message, link)
    select p.id, 'target_lock', 'Targets for ' || to_char(v_m, 'Mon YYYY') || ' lock at ' || to_char(app.target_lock_at(v_m) at time zone app.tz(), 'DD Mon HH24:MI') || '. Set your team''s targets.', '/targets?m=' || v_m || '&d=' || v_d
      from public.persons p where p.status = 'active'
       and (exists (select 1 from public.reporting_lines r where r.manager_id = p.id and r.valid @> v_d)
            or exists (select 1 from public.role_assignments ra where ra.person_id = p.id and ra.role in ('zm','ops_head','collections_head') and ra.valid @> v_d))
       and not exists (select 1 from public.notifications x where x.person_id = p.id and x.kind = 'target_lock' and x.link = '/targets?m=' || v_m || '&d=' || v_d);
    get diagnostics k = row_count; n := n + k;
  end if;
  return n;
end $$;

create or replace function app.notify_on_reopen() returns trigger
language plpgsql security definer set search_path = public, app, pg_temp as $$
begin
  insert into public.notifications(person_id, kind, message, link)
  values (new.person_id, 'reopen', case when new.kind = 'target' then 'Targets for ' || to_char(new.target_month, 'Mon YYYY') || ' reopened'
                                        else to_char(new.work_date, 'DD Mon') || ' reopened for correction' end
          || case when new.include_team then ' (you and your team)' else '' end
          || ' until ' || to_char(new.expires_at at time zone app.tz(), 'DD Mon HH24:MI') || '. Reason: ' || new.reason,
          case when new.kind = 'target' then '/targets' else '/productivity?date=' || new.work_date end);
  return new;
end $$;
create trigger trg_notify_on_reopen after insert on public.reopen_grants for each row execute function app.notify_on_reopen();

create or replace function app.notify_on_penalty() returns trigger
language plpgsql security definer set search_path = public, app, pg_temp as $$
begin
  insert into public.notifications(person_id, kind, message, link)
  values (new.person_id, 'penalty', 'Penalty ' || new.status || ' for ' || to_char(new.event_date, 'DD Mon') || ': ' || new.reason
          || ' (recorded only — no deduction without an approved policy). You can reply in Tasks.', '/tasks');
  return new;
end $$;
create trigger trg_notify_on_penalty after insert or update of status on public.penalty_ledger for each row execute function app.notify_on_penalty();

do $do$
declare f text;
begin
  f := pg_get_functiondef('app.sync_all()'::regprocedure);
  if position('perform app.sync_collections_misses();' in f) = 0 then raise exception 'sync_all anchor not found'; end if;
  f := replace(f, 'perform app.sync_collections_misses();', 'perform app.sync_collections_misses();
  perform app.reminders();');
  execute f;
end $do$;
revoke all on function app.reminders(), app.notify_on_reopen(), app.notify_on_penalty() from public, anon, authenticated;
