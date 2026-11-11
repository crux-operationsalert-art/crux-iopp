-- D-113 Self check-in and self-planning. Each morning a person checks in (marks they are at work), then plans the day on
--  their own KPI lines with a note, and at the end records what they did. Commitment % = what they did ÷ what they planned.
--  A "planned & committed" meter rolls this up for a team. Reminders at 9:45 and 9:55 nudge anyone who has not checked in.

create table if not exists public.day_plan (
  person_id uuid not null references public.persons(id),
  work_date date not null,
  checked_in_at timestamptz,
  planned int,                       -- a simple total planned for the day (optional)
  plan jsonb not null default '{}',  -- per client_location_id → planned count (optional)
  plan_note text,
  done_note text,
  committed_at timestamptz,          -- when the plan was first set
  closed_at timestamptz,             -- when the day was wrapped up
  updated_at timestamptz not null default now(),
  primary key (person_id, work_date)
);
alter table public.day_plan enable row level security;
revoke all on public.day_plan from anon, authenticated;   -- reached only through the functions below

-- the cases a person actually logged on a day (their "done" measure), from the daily entries
create or replace function app.day_actual(p_person uuid, p_date date) returns int
language sql stable security definer set search_path = public, app, pg_temp as $$
  select coalesce(sum(coalesce(l.entry, 0)), 0)::int from public.productivity_lines l
   where l.person_id = p_person and l.work_date = p_date
$$;
-- per client_location, what they logged (to line up with the plan)
create or replace function app.day_actual_by_cl(p_person uuid, p_date date) returns jsonb
language sql stable security definer set search_path = public, app, pg_temp as $$
  select coalesce(jsonb_object_agg(l.client_location_id, coalesce(l.entry, 0)), '{}')
    from public.productivity_lines l where l.person_id = p_person and l.work_date = p_date and coalesce(l.entry,0) > 0
$$;
revoke all on function app.day_actual(uuid, date), app.day_actual_by_cl(uuid, date) from public, anon, authenticated;

-- commitment % = logged ÷ planned (null when nothing was planned)
create or replace function app.commitment_pct(p_person uuid, p_date date) returns int
language sql stable security definer set search_path = public, app, pg_temp as $$
  select case when coalesce(dp.planned, (select sum((v)::int) from jsonb_each_text(dp.plan) e(k, v)), 0) > 0
              then round(100.0 * app.day_actual(p_person, p_date) / nullif(coalesce(dp.planned, (select sum((v)::int) from jsonb_each_text(dp.plan) e(k, v))), 0))::int
         end
    from public.day_plan dp where dp.person_id = p_person and dp.work_date = p_date
$$;
revoke all on function app.commitment_pct(uuid, date) from public, anon, authenticated;

/** Mark that I am at work today (self check-in / availability). */
create or replace function public.self_check_in(p_note text default null) returns timestamptz
language plpgsql security definer set search_path = public, app, pg_temp as $$
declare v_me uuid := app.me(); v_d date := app.today(); v_at timestamptz := app.clock();
begin
  if v_me is null then raise exception 'Not signed in' using errcode = '28000'; end if;
  insert into public.day_plan(person_id, work_date, checked_in_at, plan_note, updated_at)
  values (v_me, v_d, v_at, nullif(btrim(coalesce(p_note, '')), ''), v_at)
  on conflict (person_id, work_date) do update set checked_in_at = coalesce(public.day_plan.checked_in_at, v_at),
    plan_note = coalesce(nullif(btrim(coalesce(p_note, '')), ''), public.day_plan.plan_note), updated_at = v_at;
  -- the morning check-in reminders for today are done
  update public.notifications set read_at = v_at where person_id = v_me and kind = 'checkin' and read_at is null;
  return v_at;
end $$;

/** Set my plan for the day — a simple total and/or per-client numbers, with a note. */
create or replace function public.save_plan(p_work_date date, p_planned int default null, p_plan jsonb default null, p_note text default null) returns void
language plpgsql security definer set search_path = public, app, pg_temp as $$
declare v_me uuid := app.me(); v_d date := coalesce(p_work_date, app.today()); v_now timestamptz := app.clock();
begin
  if v_me is null then raise exception 'Not signed in' using errcode = '28000'; end if;
  if v_d < app.today() then raise exception 'You can plan today or a future day.' using errcode = 'P0001'; end if;
  if p_planned is not null and p_planned < 0 then raise exception 'Planned cannot be negative.' using errcode = 'P0001'; end if;
  insert into public.day_plan(person_id, work_date, planned, plan, plan_note, committed_at, updated_at)
  values (v_me, v_d, p_planned, coalesce(p_plan, '{}'), nullif(btrim(coalesce(p_note, '')), ''), v_now, v_now)
  on conflict (person_id, work_date) do update set planned = coalesce(p_planned, public.day_plan.planned),
    plan = coalesce(p_plan, public.day_plan.plan), plan_note = coalesce(nullif(btrim(coalesce(p_note, '')), ''), public.day_plan.plan_note),
    committed_at = coalesce(public.day_plan.committed_at, v_now), checked_in_at = coalesce(public.day_plan.checked_in_at, v_now), updated_at = v_now;
end $$;

/** Wrap up the day: a note on what I actually did (the numbers come from my daily entries). */
create or replace function public.close_plan(p_work_date date, p_done_note text default null) returns void
language plpgsql security definer set search_path = public, app, pg_temp as $$
declare v_me uuid := app.me(); v_d date := coalesce(p_work_date, app.today()); v_now timestamptz := app.clock();
begin
  if v_me is null then raise exception 'Not signed in' using errcode = '28000'; end if;
  insert into public.day_plan(person_id, work_date, done_note, closed_at, updated_at)
  values (v_me, v_d, nullif(btrim(coalesce(p_done_note, '')), ''), v_now, v_now)
  on conflict (person_id, work_date) do update set done_note = coalesce(nullif(btrim(coalesce(p_done_note, '')), ''), public.day_plan.done_note),
    closed_at = v_now, updated_at = v_now;
end $$;

/** My plan, check-in and commitment for a day, with my KPI lines so I can plan against them. */
create or replace function public.my_plan(p_work_date date default null) returns jsonb
language plpgsql stable security definer set search_path = public, app, pg_temp as $$
declare v_me uuid := app.me(); v_d date := coalesce(p_work_date, app.today()); dp public.day_plan;
begin
  if v_me is null then raise exception 'Not signed in' using errcode = '28000'; end if;
  select * into dp from public.day_plan where person_id = v_me and work_date = v_d;
  return jsonb_build_object(
    'work_date', v_d, 'checked_in_at', dp.checked_in_at, 'planned', dp.planned, 'plan', coalesce(dp.plan, '{}'),
    'plan_note', dp.plan_note, 'done_note', dp.done_note, 'closed_at', dp.closed_at, 'committed_at', dp.committed_at,
    'planned_total', coalesce(dp.planned, (select sum((v)::int) from jsonb_each_text(coalesce(dp.plan, '{}')) e(k, v)), 0),
    'actual_total', app.day_actual(v_me, v_d), 'actual', app.day_actual_by_cl(v_me, v_d),
    'commitment_pct', app.commitment_pct(v_me, v_d),
    'lines', (select coalesce(jsonb_agg(jsonb_build_object('client_location_id', cl.id, 'client', c.name, 'location', lo.name) order by c.name, lo.name), '[]')
                from public.allocations a join public.client_locations cl on cl.id = a.client_location_id
                join public.clients c on c.id = cl.client_id join public.locations lo on lo.id = cl.location_id
               where a.person_id = v_me and a.function = 'operations' and a.valid @> v_d));
end $$;

/** A team's planning & commitment for a day (managers and above): who checked in, planned and delivered. */
create or replace function public.team_commitment(p_date date default null) returns jsonb
language plpgsql stable security definer set search_path = public, app, pg_temp as $$
declare v_d date := coalesce(p_date, app.today());
begin
  if not (app.is_admin() or app.has_role('hr_admin') or app.has_role('ops_head') or app.has_role('leadership')
          or app.has_reports(app.me(), 'operations', app.today())) then
    raise exception 'Only managers and above see team commitment.' using errcode = '42501'; end if;
  return (select coalesce(jsonb_agg(jsonb_build_object('person_id', s.person_id, 'full_name', p.full_name,
            'checked_in', dp.checked_in_at is not null, 'checked_in_at', dp.checked_in_at,
            'planned_total', coalesce(dp.planned, (select sum((v)::int) from jsonb_each_text(coalesce(dp.plan, '{}')) e(k, v)), 0),
            'actual_total', app.day_actual(s.person_id, v_d), 'commitment_pct', app.commitment_pct(s.person_id, v_d),
            'plan_note', dp.plan_note, 'done_note', dp.done_note) order by p.full_name), '[]')
    from app.subtree(app.me(), 'operations', v_d) s
    join public.persons p on p.id = s.person_id and p.status = 'active'
    left join public.day_plan dp on dp.person_id = s.person_id and dp.work_date = v_d
   where s.person_id <> app.me());
end $$;

/** The "how planned & committed we are" meter for the viewer's scope (their team, or themselves). */
create or replace function public.commitment_meter(p_date date default null) returns jsonb
language plpgsql stable security definer set search_path = public, app, pg_temp as $$
declare v_d date := coalesce(p_date, app.today()); v_me uuid := app.me(); v_ids uuid[];
begin
  if app.has_reports(v_me, 'operations', v_d) then
    select array_agg(s.person_id) into v_ids from app.subtree(v_me, 'operations', v_d) s
      join public.persons p on p.id = s.person_id and p.status = 'active' where s.person_id <> v_me;
  else
    v_ids := array[v_me];
  end if;
  v_ids := coalesce(v_ids, array[v_me]);
  return (select jsonb_build_object('n', count(*),
            'checked_in', count(*) filter (where dp.checked_in_at is not null),
            'planned', count(*) filter (where coalesce(dp.planned, (select sum((v)::int) from jsonb_each_text(coalesce(dp.plan, '{}')) e(k, v)), 0) > 0),
            'avg_commitment', round(avg(app.commitment_pct(id, v_d)) filter (where app.commitment_pct(id, v_d) is not null))::int)
    from unnest(v_ids) id left join public.day_plan dp on dp.person_id = id and dp.work_date = v_d);
end $$;

revoke all on function public.self_check_in(text), public.save_plan(date, int, jsonb, text), public.close_plan(date, text),
  public.my_plan(date), public.team_commitment(date), public.commitment_meter(date) from public, anon;
grant execute on function public.self_check_in(text), public.save_plan(date, int, jsonb, text), public.close_plan(date, text),
  public.my_plan(date), public.team_commitment(date), public.commitment_meter(date) to authenticated;

-- ---- check-in reminders at 9:45 and 9:55 (needs the sync to run more often than hourly) ----
create or replace function app.checkin_reminders() returns int
language plpgsql security definer set search_path = public, app, pg_temp as $$
declare v_now timestamptz := app.clock(); v_h int := extract(hour from v_now at time zone app.tz())::int;
        v_min int := extract(minute from v_now at time zone app.tz())::int; v_slot text; v_tag text; n int := 0;
begin
  if v_h = 9 and v_min between 45 and 54 then v_slot := '0945';
  elsif v_h = 9 and v_min >= 55 then v_slot := '0955';
  else return 0; end if;
  v_tag := '/plan?c=' || app.today() || '-' || v_slot;
  insert into public.notifications(person_id, kind, message, link)
  select p.id, 'checkin', case when v_slot = '0945' then 'Good morning — please check in to mark you are at work today, and plan your day.'
                               else 'Reminder: you have not checked in yet. Tap to check in and plan your day.' end, v_tag
    from public.persons p
   where p.status = 'active' and p.auth_user_id is not null
     and app.day_result(p.id, app.today()) = 'open'                               -- expected to work today and not done
     and not exists (select 1 from public.day_plan dp where dp.person_id = p.id and dp.work_date = app.today() and dp.checked_in_at is not null)
     and not exists (select 1 from public.notifications n where n.person_id = p.id and n.kind = 'checkin' and n.link = v_tag);
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function app.checkin_reminders() from public, anon, authenticated;

-- fold into the sync, and run the sync every 5 minutes so 9:45/9:55 can fire (hourly reminders stay once-per-slot via their tags)
do $mig$
declare v text; o text;
begin
  v := pg_get_functiondef('app.sync_all()'::regprocedure); o := v;
  if position('app.checkin_reminders()' in v) = 0 then
    v := replace(v, '  perform app.people_reminders();', '  perform app.people_reminders();
  perform app.checkin_reminders();');
    if v = o then raise exception 'checkin_plan: sync_all anchor not found'; end if;
    execute v;
  end if;
exception when undefined_function then raise notice 'sync_all not present (local)';
end $mig$;

do $cron$
begin
  perform cron.unschedule('iopp-sync-tasks');
  perform cron.schedule('iopp-sync-tasks', '*/5 * * * *', 'select app.sync_all()');
exception when others then raise notice 'pg_cron not available: %', sqlerrm;
end $cron$;
