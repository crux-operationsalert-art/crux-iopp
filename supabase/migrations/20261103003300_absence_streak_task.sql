-- D-51 (SOW 10.6 / acceptance 16): unplanned absence beyond the configured run of working days (setting
-- absence_trigger_days, default 3) creates an explanation task for the person's operations manager.
create or replace function app.sync_absence_streaks() returns int
language plpgsql security definer set search_path = public, app, pg_temp as $$
declare v_n int := coalesce((app.setting('absence_trigger_days') #>> '{}')::int, 3); r record; c int := 0;
        v_live date := coalesce((app.setting('go_live_date') #>> '{}')::date, app.today() - 30);
begin
  for r in
    with ppl as (select p.id, p.full_name, rl.manager_id from public.persons p
                   join public.reporting_lines rl on rl.person_id = p.id and rl.function = 'operations' and rl.valid @> app.today()
                  where p.status = 'active'),
    days as (select d::date d, row_number() over (order by d desc) k
               from generate_series(app.today() - 1, greatest(v_live, app.today() - 21), interval '-1 day') d
              where app.is_working_day(d::date)),
    st as (select pe.id, pe.full_name, pe.manager_id, dd.d, dd.k,
                  coalesce(a.status, app.auto_attendance(pe.id, dd.d)) s
             from ppl pe cross join days dd left join public.attendance a on a.person_id = pe.id and a.work_date = dd.d),
    run as (select id, full_name, manager_id,
                   coalesce(min(k) filter (where s not in ('absent','unplanned_leave')), max(k) + 1) - 1 n,
                   min(d) filter (where k < coalesce((select min(k) from st s2 where s2.id = st.id and s2.s not in ('absent','unplanned_leave')), 1e9)) since
              from st group by id, full_name, manager_id)
    select * from run where n > v_n
  loop
    perform app.task_upsert('absence_streak', 'task', 'absence_streak:' || r.id || ':' || r.since, r.manager_id, r.id,
      r.full_name || ' has been absent without approved leave for ' || r.n || ' working days (since ' || to_char(r.since, 'DD Mon') || '). Reply with the reason and next step.',
      jsonb_build_object('days', r.n, 'since', r.since), null, null, r.since, null);
    c := c + 1;
  end loop;
  return c;
end $$;
revoke all on function app.sync_absence_streaks() from public, anon, authenticated;

do $do$
declare f text;
begin
  f := pg_get_functiondef('app.sync_all()'::regprocedure);
  if position('perform app.reminders();' in f) = 0 then raise exception 'sync_all anchor not found'; end if;
  f := replace(f, 'perform app.reminders();', 'perform app.reminders();
  perform app.sync_absence_streaks();');
  execute f;
end $do$;

-- Reminders about daily figures start on the go-live date (target-lock reminders run regardless).
do $do$
declare f text; o text;
begin
  f := pg_get_functiondef('app.reminders()'::regprocedure); o := f;
  f := replace(f, 'if v_h in (20, 22) and app.is_working_day(v_d) then',
                  'if v_h in (20, 22) and app.is_working_day(v_d) and v_d >= coalesce((app.setting(''go_live_date'') #>> ''{}'')::date, v_d) then');
  f := replace(f, 'if v_h = 8 and app.is_working_day(v_d - 1) then',
                  'if v_h = 8 and app.is_working_day(v_d - 1) and v_d - 1 >= coalesce((app.setting(''go_live_date'') #>> ''{}'')::date, v_d) then');
  if f = o or position('go_live_date' in f) = 0 then raise exception 'reminders anchors not found'; end if;
  execute f;
end $do$;
