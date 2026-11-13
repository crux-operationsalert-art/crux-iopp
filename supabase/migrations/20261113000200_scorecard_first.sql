-- D-144..D-147 (13 Nov 2026): the scorecard is the one measure of a person; department default scorecards;
-- target achievement as an automatic KPI; managers can enter their team's KPI results; department heads.

-- ---------------------------------------------------------------- department heads + two departments (D-146)
alter table public.departments add column if not exists head_id uuid references public.persons(id);
insert into public.departments(name) values ('Legal & Compliance'), ('Training') on conflict do nothing;
insert into public.designations (name, rank, short, default_role) values
  ('Legal Manager', 12, null, 'manager'), ('Legal Officer', 16, null, 'executive'), ('Compliance Officer', 16, null, 'executive'),
  ('Training Manager', 12, null, 'manager'), ('Trainer', 16, null, 'executive')
on conflict (name) do nothing;
insert into public.designation_departments (designation, department) values
  ('Legal Manager', 'Legal & Compliance'), ('Legal Officer', 'Legal & Compliance'), ('Compliance Officer', 'Legal & Compliance'),
  ('Training Manager', 'Training'), ('Trainer', 'Training')
on conflict do nothing;

create or replace function public.department_head_set(p_department text, p_person uuid) returns jsonb
language plpgsql security definer set search_path = public, app, pg_temp as $$
begin
  if not app.can_manage_kpis() then raise exception 'Only HR/Admin can set a department head.' using errcode = '42501'; end if;
  if p_person is not null and not exists (select 1 from public.persons where id = p_person and status <> 'exited') then raise exception 'Unknown person.' using errcode = 'P0002'; end if;
  perform set_config('app.reason', 'department head set', true);
  update public.departments set head_id = p_person where name = p_department;
  if not found then raise exception 'Unknown department.' using errcode = 'P0002'; end if;
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.departments_list() returns jsonb
language plpgsql stable security definer set search_path = public, app, pg_temp as $$
begin
  if not app.can_manage_kpis() then raise exception 'Only HR/Admin can see this.' using errcode = '42501'; end if;
  return (
    with pd as (select p.id, p.full_name, p.designation, app.person_department(p.id) dept, p.department is not null as fixed
                  from public.persons p where p.status <> 'exited')
    select coalesce(jsonb_agg(jsonb_build_object('name', d.name, 'head_id', d.head_id, 'head', (select full_name from public.persons where id = d.head_id),
             'kpis', (select count(*) from public.kpi_catalogue k where k.department = d.name and k.active),
             'people', (select coalesce(jsonb_agg(jsonb_build_object('person_id', pd.id, 'full_name', pd.full_name, 'designation', pd.designation, 'fixed', pd.fixed) order by pd.full_name), '[]'::jsonb)
                          from pd where pd.dept = d.name)) order by d.name), '[]'::jsonb)
      from public.departments d);
end $$;
revoke all on function public.department_head_set(text, uuid) from public, anon;
grant execute on function public.department_head_set(text, uuid) to authenticated;

-- ---------------------------------------------------------------- target achievement as an automatic KPI (D-144)
-- Month-to-date achievement against the person's own monthly targets, as a percentage. Null when no target is set.
create or replace function app.target_pct(p_person uuid, p_from date, p_to date, p_function text) returns numeric
language sql stable security definer set search_path = public, app, pg_temp as $$
  select round(avg(app.metric_actual(ta.metric, date_trunc('month', p_from)::date, p_to, 'person', ta.zone_id, ta.branch_id, ta.person_id, ta.client_id)
                   / ta.amount * 100), 1)
    from public.target_allocations ta
   where ta.is_current and ta.level = 'person' and ta.person_id = p_person and ta.month = date_trunc('month', p_from)::date and ta.amount > 0
     and (p_function is null or app.metric_function(ta.metric)::text = p_function);
$$;
revoke all on function app.target_pct(uuid, date, date, text) from public, anon, authenticated;

do $mig$
declare f text; a text := E'declare v numeric; v_people uuid[];\nbegin\n';
begin
  select pg_get_functiondef(p.oid) into f from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'app' and p.proname = 'metric_actual';
  if f like '%target_pct%' then return; end if;
  if position(a in f) = 0 then raise exception 'metric_actual: anchor not found'; end if;
  execute replace(f, a, a || $b$  if p_metric like 'target\_pct%' then      -- D-144: a person's achievement against their own targets
    return case when p_level = 'person' then app.target_pct(p_person, p_from, p_to,
             case p_metric when 'target_pct_ops' then 'operations' when 'target_pct_coll' then 'collections' end) end;
  end if;
$b$);
end $mig$;

insert into public.kpi_catalogue (department, name, unit, cadence, higher_better, metric, description, system)
select v.* from (values
  ('Operations', 'Target Achievement – Rate %', '%', 'monthly', true, 'target_pct_ops',
     'Month-to-date achievement against the monthly targets set for you. Counted automatically from daily updates.', true),
  ('Operations', 'Cases Closed Beyond TAT (over 2 days) – Rate %', '%', 'monthly', false, null,
     'Share of cases closed later than 2 days after receipt. Lower is better.', true),
  ('Operations', 'Average Quality Score – Rate %', '%', 'monthly', true, null,
     'Average quality score of the cases audited in the month.', true),
  ('Collections', 'Collection Target Achievement – Rate %', '%', 'monthly', true, 'target_pct_coll',
     'Month-to-date collections against the monthly collection target set for you. Counted automatically from daily updates.', true),
  ('Collections', 'Receivables Over 90 Days – Rate %', '%', 'monthly', false, null,
     'Share of outstanding receivables that are older than 90 days. Lower is better.', true),
  ('Collections', 'Reconciliation Accuracy – Rate %', '%', 'monthly', true, null,
     'Share of receipts reconciled correctly the first time.', true)
) v(department, name, unit, cadence, higher_better, metric, description, system)
where not exists (select 1 from public.kpi_catalogue k where k.department = v.department and lower(k.name) = lower(v.name));

-- ---------------------------------------------------------------- one calculation behind every view of a person's KPIs
create or replace function app.kpi_lines(p_person uuid, p_month date) returns jsonb
language plpgsql stable security definer set search_path = public, app, pg_temp as $$
declare v_m0 date := date_trunc('month', p_month)::date;
        v_upto date := least(app.today(), (v_m0 + interval '1 month - 1 day')::date);
        r record; v_from date; v_periods numeric; v_sum numeric; v_n int; v_pct numeric; v_act numeric; o jsonb := '[]'::jsonb;
begin
  if v_upto < v_m0 then return o; end if;
  for r in select a.kpi_id, k.name, k.unit, a.target, coalesce(a.cadence, k.cadence) cadence, coalesce(a.higher_better, k.higher_better) higher_better, k.metric,
                  (select min(lower(b.valid)) from public.kpi_assignment b where b.person_id = a.person_id and b.kpi_id = a.kpi_id) lo
             from public.kpi_assignment a join public.kpi_catalogue k on k.id = a.kpi_id and k.active
            where a.person_id = p_person and a.target is not null and a.target > 0 and a.valid @> v_upto order by k.name loop
    v_pct := null; v_act := null;
    if r.metric is not null then                                   -- counted by the system; the target is for the month
      v_act := app.metric_actual(r.metric, v_m0, v_upto, 'person', null, null, p_person, null);
      v_pct := least(200, round(v_act / r.target * 100, 1));
    else
      v_from := greatest(v_m0, r.lo);
      select coalesce(sum(e.actual), 0), count(e.actual) into v_sum, v_n from public.kpi_entry e
       where e.person_id = p_person and e.kpi_id = r.kpi_id and e.period >= app.kpi_period(r.cadence, v_from) and e.period <= v_upto;
      if r.higher_better then
        v_periods := case r.cadence
          when 'daily' then app.working_days_between(v_from, v_upto)
          when 'weekly' then (select count(distinct date_trunc('week', g)) from generate_series(v_from, v_upto, interval '1 day') g)
          else 1 end;
        -- nothing entered yet is "not scored yet", not 0% (a monthly result is often entered at month end)
        if coalesce(v_periods, 0) > 0 and v_n > 0 then v_pct := least(200, round(v_sum / (r.target * v_periods) * 100, 1)); end if;
        if v_n > 0 then v_act := v_sum; end if;
      elsif v_n > 0 then
        v_act := round(v_sum / v_n, 2);
        v_pct := least(200, round(case when v_sum = 0 then 200 else r.target / (v_sum / v_n) * 100 end, 1));
      end if;
    end if;
    o := o || jsonb_build_object('kpi_id', r.kpi_id, 'name', r.name, 'unit', r.unit, 'target', r.target, 'actual', v_act, 'pct', v_pct,
                                 'auto', r.metric is not null, 'higher_better', r.higher_better, 'cadence', r.cadence);
  end loop;
  return o;
end $$;
revoke all on function app.kpi_lines(uuid, date) from public, anon, authenticated;

create or replace function app.kpi_achievements(p_person uuid, p_month date) returns setof numeric
language sql stable security definer set search_path = public, app, pg_temp as $$
  select (e->>'pct')::numeric from jsonb_array_elements(app.kpi_lines(p_person, p_month)) e where e->>'pct' is not null;
$$;
revoke all on function app.kpi_achievements(uuid, date) from public, anon, authenticated;

-- Once a person has a scorecard, the scorecard alone is their achievement (D-145). The old admin-set targets still count,
-- but only through the "Target Achievement" KPI when the manager puts it on the scorecard.
create or replace function app.person_achievement(p_person uuid, p_month date) returns numeric
language sql stable security definer set search_path = public, app, pg_temp as $$
  with m as (select date_trunc('month', p_month)::date as m0,
                    least(app.today(), (date_trunc('month', p_month) + interval '1 month - 1 day')::date) as upto),
  sc as (select exists (select 1 from public.kpi_assignment a join public.kpi_catalogue k on k.id = a.kpi_id and k.active
                         where a.person_id = p_person and a.target > 0 and a.valid @> (select upto from m)) as has),
  t as (
    select (app.metric_actual(ta.metric, (select m0 from m), (select upto from m),
             'person', ta.zone_id, ta.branch_id, ta.person_id, ta.client_id) / ta.amount * 100)::numeric as pct
      from public.target_allocations ta
     where ta.is_current and ta.level = 'person' and ta.person_id = p_person
       and ta.month = (select m0 from m) and ta.amount > 0 and not (select has from sc)
    union all
    select x from app.kpi_achievements(p_person, p_month) x)
  select round(avg(pct), 1) from t;
$$;

-- the score sheet carries each KPI line, and whether the person files a daily update at all
do $mig$
declare f text; a text := $a$'required_days', (v_disc->>'required')::int)$a$;
begin
  select pg_get_functiondef(p.oid) into f from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'app' and p.proname = 'kpi_score';
  if f like '%kpi_lines%' then return; end if;
  if position(a in f) = 0 then raise exception 'kpi_score: anchor not found'; end if;
  execute replace(f, a, $b$'required_days', (v_disc->>'required')::int,
                                   'kpi_lines', app.kpi_lines(p_person, p_month), 'figures', app.reports_figures(p_person))$b$);
end $mig$;

-- my own scorecard for Home and My day: every KPI with its target, result so far and score
create or replace function public.my_scorecard(p_month date default null) returns jsonb
language plpgsql stable security definer set search_path = public, app, pg_temp as $$
declare v_me uuid := app.me(); v_m date := date_trunc('month', coalesce(p_month, app.today()))::date;
begin
  if v_me is null then raise exception 'Not signed in' using errcode = '28000'; end if;
  return jsonb_build_object('month', v_m, 'lines', app.kpi_lines(v_me, v_m), 'achievement', app.person_achievement(v_me, v_m),
    'attributes', (select coalesce(jsonb_agg(c.name order by c.name), '[]'::jsonb) from public.person_attributes a join public.attribute_catalogue c on c.id = a.attribute_id
                    where a.person_id = v_me and a.valid @> app.today()));
end $$;
revoke all on function public.my_scorecard(date) from public, anon;
grant execute on function public.my_scorecard(date) to authenticated;

-- ---------------------------------------------------------------- the reporting manager can enter a result for their person
create or replace function public.kpi_entry_for(p_person uuid, p_kpi uuid, p_actual numeric, p_note text default null) returns jsonb
language plpgsql security definer set search_path = public, app, pg_temp as $$
declare v_cad text; v_metric text; v_period date;
begin
  if app.me() is null then raise exception 'Not signed in' using errcode = '28000'; end if;
  if not app.can_setup_scorecard(p_person) then raise exception 'Only the reporting manager or HR/Admin can enter this.' using errcode = '42501'; end if;
  select coalesce(a.cadence, k.cadence), k.metric into v_cad, v_metric
    from public.kpi_catalogue k join public.kpi_assignment a on a.kpi_id = k.id and a.person_id = p_person and a.valid @> app.today()
   where k.id = p_kpi and k.active;
  if v_cad is null then raise exception 'That KPI is not on this person''s scorecard.' using errcode = 'P0001'; end if;
  if v_metric is not null then raise exception 'This KPI is counted automatically.' using errcode = 'P0001'; end if;
  if p_actual is not null and p_actual < 0 then raise exception 'The result cannot be negative.' using errcode = 'P0001'; end if;
  v_period := app.kpi_period(v_cad, app.today());
  insert into public.kpi_entry(person_id, kpi_id, period, actual, note, updated_at)
  values (p_person, p_kpi, v_period, p_actual, nullif(btrim(coalesce(p_note, '')), ''), now())
  on conflict (person_id, kpi_id, period) do update set actual = excluded.actual, note = coalesce(excluded.note, public.kpi_entry.note), updated_at = now();
  return jsonb_build_object('ok', true, 'period', v_period);
end $$;
revoke all on function public.kpi_entry_for(uuid, uuid, numeric, text) from public, anon;
grant execute on function public.kpi_entry_for(uuid, uuid, numeric, text) to authenticated;

-- ---------------------------------------------------------------- department default scorecards (D-144)
create table if not exists public.scorecard_defaults (
  department text primary key references public.departments(name) on update cascade,
  kpis jsonb not null default '[]'::jsonb,            -- [{kpi_id, target}] in display order
  attributes uuid[] not null default '{}',
  updated_by uuid references public.persons(id),
  updated_at timestamptz
);
alter table public.scorecard_defaults enable row level security;
revoke all on public.scorecard_defaults from anon, authenticated;

insert into public.scorecard_defaults(department, kpis, attributes)
select d.name,
       (select jsonb_agg(jsonb_build_object('kpi_id', k.id, 'target', v.target) order by v.sort) from (values
          ('Operations', 'Target Achievement – Rate %', 80, 1), ('Operations', 'Cases Closed Beyond TAT (over 2 days) – Rate %', 5, 2), ('Operations', 'Average Quality Score – Rate %', 98, 3),
          ('Collections', 'Collection Target Achievement – Rate %', 80, 1), ('Collections', 'Receivables Over 90 Days – Rate %', 5, 2), ('Collections', 'Reconciliation Accuracy – Rate %', 98, 3)
        ) v(department, name, target, sort) join public.kpi_catalogue k on k.department = v.department and k.name = v.name where v.department = d.name),
       coalesce((select array_agg(c.id order by c.name) from (values
          ('Operations', 'Ownership & Accountability'), ('Operations', 'Quality of Work'), ('Operations', 'Discipline & Punctuality'), ('Operations', 'Client Focus'),
          ('Collections', 'Ownership & Accountability'), ('Collections', 'Integrity & Compliance'), ('Collections', 'Communication'), ('Collections', 'Discipline & Punctuality')
        ) v(department, name) join public.attribute_catalogue c on c.name = v.name where v.department = d.name), '{}')
  from public.departments d where d.name in ('Operations', 'Collections')
on conflict (department) do nothing;

-- the default KPIs of a department that are still in the library
create or replace function app.scorecard_default_kpis(p_department text) returns table (kpi_id uuid, target numeric, sort bigint)
language sql stable security definer set search_path = public, app, pg_temp as $$
  select k.id, (e.v->>'target')::numeric, e.ord
    from public.scorecard_defaults d, jsonb_array_elements(d.kpis) with ordinality e(v, ord)
    join public.kpi_catalogue k on k.id = (e.v->>'kpi_id')::uuid and k.active
   where d.department = p_department and (e.v->>'target')::numeric > 0;
$$;
revoke all on function app.scorecard_default_kpis(text) from public, anon, authenticated;

-- Gives one person their department's default scorecard, only if they have no KPIs yet. Never overwrites a manager's choice.
create or replace function app.scorecard_default_apply(p_person uuid) returns boolean
language plpgsql security definer set search_path = public, app, pg_temp as $$
declare v_dept text; v_today date := app.today();
begin
  if exists (select 1 from public.kpi_assignment a where a.person_id = p_person and a.valid @> v_today) then return false; end if;
  v_dept := app.person_department(p_person);
  if v_dept is null or not exists (select 1 from app.scorecard_default_kpis(v_dept)) then return false; end if;
  insert into public.kpi_assignment(person_id, kpi_id, target, valid, created_by)
    select p_person, d.kpi_id, d.target, daterange(v_today, null), app.me() from app.scorecard_default_kpis(v_dept) d;
  if not exists (select 1 from public.person_attributes a where a.person_id = p_person and a.valid @> v_today) then
    insert into public.person_attributes(person_id, attribute_id, valid, created_by)
      select p_person, c.id, daterange(v_today, null), app.me()
        from public.scorecard_defaults d join public.attribute_catalogue c on c.id = any (d.attributes) and c.active where d.department = v_dept;
  end if;
  insert into public.notifications(person_id, kind, message, link)
  values (p_person, 'task', 'Your KPIs and attributes for ' || v_dept || ' are set. Have a look.', '/kpis');
  return true;
end $$;
revoke all on function app.scorecard_default_apply(uuid) from public, anon, authenticated;

-- New joiners get the default by themselves when Admin has switched that on (setting scorecard_defaults_auto).
create or replace function app.scorecard_defaults_run() returns int
language plpgsql security definer set search_path = public, app, pg_temp as $$
declare r record; n int := 0;
begin
  if coalesce(app.setting('scorecard_defaults_auto') #>> '{}', 'false') <> 'true' then return 0; end if;
  for r in select p.id from public.persons p where p.status <> 'exited'
              and not exists (select 1 from public.kpi_assignment a where a.person_id = p.id and a.valid @> app.today()) loop
    if app.scorecard_default_apply(r.id) then n := n + 1; end if;
  end loop;
  return n;
end $$;
revoke all on function app.scorecard_defaults_run() from public, anon, authenticated;

do $mig$
declare f text;
begin
  select pg_get_functiondef(p.oid) into f from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'app' and p.proname = 'performance_reminders';
  if f like '%scorecard_defaults_run%' then return; end if;
  if position(E'\nbegin\n' in f) = 0 then raise exception 'performance_reminders: anchor not found'; end if;
  execute regexp_replace(f, E'\nbegin\n', E'\nbegin\n  perform app.scorecard_defaults_run();   -- D-144\n');
end $mig$;

create or replace function public.scorecard_defaults() returns jsonb
language plpgsql stable security definer set search_path = public, app, pg_temp as $$
begin
  if not app.can_manage_kpis() then raise exception 'Only HR/Admin can see this.' using errcode = '42501'; end if;
  return jsonb_build_object(
    'auto', coalesce(app.setting('scorecard_defaults_auto') #>> '{}', 'false') = 'true',
    'departments', (select coalesce(jsonb_agg(jsonb_build_object('department', d.name,
        'kpis', (select coalesce(jsonb_agg(jsonb_build_object('kpi_id', k.id, 'name', k.name, 'target', s.target, 'higher_better', k.higher_better, 'auto', k.metric is not null) order by s.sort), '[]'::jsonb)
                   from app.scorecard_default_kpis(d.name) s join public.kpi_catalogue k on k.id = s.kpi_id),
        'attributes', (select coalesce(jsonb_agg(c.name order by c.name), '[]'::jsonb) from public.scorecard_defaults s join public.attribute_catalogue c on c.id = any (s.attributes) and c.active where s.department = d.name),
        'without', (select count(*) from public.persons p where p.status <> 'exited' and app.person_department(p.id) = d.name
                       and not exists (select 1 from public.kpi_assignment a where a.person_id = p.id and a.valid @> app.today())),
        'ready', (select coalesce(jsonb_agg(jsonb_build_object('person_id', p.id, 'full_name', p.full_name) order by p.full_name), '[]'::jsonb) from public.persons p
                   where p.status <> 'exited' and app.person_department(p.id) = d.name
                     and (select count(*) from public.kpi_assignment a join public.kpi_catalogue k on k.id = a.kpi_id and k.active and k.department = d.name
                           where a.person_id = p.id and a.valid @> app.today() and a.target > 0) between 3 and 5)) order by d.name), '[]'::jsonb)
      from public.departments d));
end $$;

-- The department default becomes a copy of one person's scorecard (the quickest way to set or change it).
create or replace function public.scorecard_default_from(p_person uuid) returns jsonb
language plpgsql security definer set search_path = public, app, pg_temp as $$
declare v_dept text := app.person_department(p_person); v_today date := app.today(); v_k jsonb;
begin
  if not app.can_manage_kpis() then raise exception 'Only HR/Admin can set a default scorecard.' using errcode = '42501'; end if;
  if v_dept is null or not exists (select 1 from public.departments where name = v_dept) then raise exception 'This person has no department.' using errcode = 'P0001'; end if;
  select jsonb_agg(jsonb_build_object('kpi_id', a.kpi_id, 'target', a.target) order by k.name) into v_k
    from public.kpi_assignment a join public.kpi_catalogue k on k.id = a.kpi_id and k.active
   where a.person_id = p_person and a.valid @> v_today and a.target > 0 and k.department = v_dept;
  if coalesce(jsonb_array_length(v_k), 0) not between 3 and 5 then raise exception 'Choose a person who holds 3 to 5 KPIs of their own department.' using errcode = 'P0001'; end if;
  perform set_config('app.reason', 'default scorecard set for ' || v_dept, true);
  insert into public.scorecard_defaults(department, kpis, attributes, updated_by, updated_at)
  values (v_dept, v_k, coalesce((select array_agg(a.attribute_id) from public.person_attributes a where a.person_id = p_person and a.valid @> v_today), '{}'), app.me(), app.clock())
  on conflict (department) do update set kpis = excluded.kpis, attributes = excluded.attributes, updated_by = excluded.updated_by, updated_at = excluded.updated_at;
  return jsonb_build_object('ok', true, 'department', v_dept, 'kpis', jsonb_array_length(v_k));
end $$;

create or replace function public.scorecard_defaults_apply(p_department text) returns jsonb
language plpgsql security definer set search_path = public, app, pg_temp as $$
declare r record; n int := 0;
begin
  if not app.can_manage_kpis() then raise exception 'Only HR/Admin can apply a default scorecard.' using errcode = '42501'; end if;
  perform set_config('app.reason', 'default scorecard applied: ' || p_department, true);
  for r in select p.id from public.persons p where p.status <> 'exited' and app.person_department(p.id) = p_department loop
    if app.scorecard_default_apply(r.id) then n := n + 1; end if;
  end loop;
  return jsonb_build_object('ok', true, 'applied', n);
end $$;

create or replace function public.scorecard_defaults_auto(p_on boolean) returns jsonb
language plpgsql security definer set search_path = public, app, pg_temp as $$
begin
  if not app.is_admin() then raise exception 'Only Admin can change this.' using errcode = '42501'; end if;
  insert into public.settings(key, value, description) values ('scorecard_defaults_auto', to_jsonb(p_on::text), 'New people get their department''s default scorecard by themselves')
  on conflict (key) do update set value = excluded.value;
  return jsonb_build_object('ok', true, 'auto', p_on);
end $$;
revoke all on function public.scorecard_defaults(), public.scorecard_default_from(uuid), public.scorecard_defaults_apply(text), public.scorecard_defaults_auto(boolean) from public, anon;
grant execute on function public.scorecard_defaults(), public.scorecard_default_from(uuid), public.scorecard_defaults_apply(text), public.scorecard_defaults_auto(boolean) to authenticated;

do $$ declare t text; begin
  foreach t in array array['scorecard_defaults', 'departments'] loop
    if not exists (select 1 from pg_trigger g join pg_proc f on f.oid = g.tgfoid where g.tgrelid = to_regclass('public.' || t) and f.proname = 'audit') then
      execute format('create trigger audit_%s after insert or update or delete on public.%I for each row execute function app.audit()', t, t);
    end if;
  end loop;
end $$;

-- KPI assignment dates follow the app's own day (IST), like everything else, not the database server's date.
do $mig$
declare r record;
begin
  for r in select p.oid, pg_get_functiondef(p.oid) f from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname in ('kpi_assign', 'kpi_unassign') and pg_get_functiondef(p.oid) like '%current_date%' loop
    execute replace(r.f, 'current_date', 'app.today()');
  end loop;
end $mig$;
