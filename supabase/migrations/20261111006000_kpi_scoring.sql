-- D-119  Department KPIs feed the monthly score, and managers get a team KPI roll-up.
-- A KPI's target is PER PERIOD (per day / per week / per month, by its cadence).
-- Month achievement for a higher-is-better KPI = total done / (target x periods elapsed).
-- For a lower-is-better KPI = target / average actual per entered period. Each KPI is capped at 200%.

create or replace function app.kpi_achievements(p_person uuid, p_month date) returns setof numeric
language plpgsql stable security definer set search_path = public, app, pg_temp as $$
declare v_m0 date := date_trunc('month', p_month)::date;
        v_upto date := least(app.today(), (v_m0 + interval '1 month - 1 day')::date);
        r record; v_from date; v_periods numeric; v_sum numeric; v_n int; v_pct numeric;
begin
  if v_upto < v_m0 then return; end if;
  for r in select a.kpi_id, a.target, k.cadence, k.higher_better, lower(a.valid) lo, upper(a.valid) hi
             from public.kpi_assignment a join public.kpi_catalogue k on k.id = a.kpi_id and k.active
            where a.person_id = p_person and a.target is not null and a.target > 0
              and a.valid && daterange(v_m0, v_upto + 1) loop
    v_from := greatest(v_m0, r.lo);
    select coalesce(sum(e.actual), 0), count(e.actual) into v_sum, v_n from public.kpi_entry e
     where e.person_id = p_person and e.kpi_id = r.kpi_id and e.period >= app.kpi_period(r.cadence, v_from) and e.period <= v_upto;
    if r.higher_better then
      v_periods := case r.cadence
        when 'daily' then app.working_days_between(v_from, v_upto)
        when 'weekly' then (select count(distinct date_trunc('week', g)) from generate_series(v_from, v_upto, interval '1 day') g)
        else 1 end;
      if coalesce(v_periods, 0) <= 0 then continue; end if;
      v_pct := v_sum / (r.target * v_periods) * 100;
    else
      if v_n = 0 then continue; end if;                       -- nothing entered yet: no evidence either way
      v_pct := case when v_sum = 0 then 200 else r.target / (v_sum / v_n) * 100 end;
    end if;
    return next least(200, round(v_pct, 1));
  end loop;
end $$;
revoke all on function app.kpi_achievements(uuid, date) from public, anon, authenticated;

-- Achievement now averages operations/collections targets AND department KPIs, item by item.
create or replace function app.person_achievement(p_person uuid, p_month date) returns numeric
language sql stable security definer set search_path = public, app, pg_temp as $$
  with m as (select date_trunc('month', p_month)::date as m0),
  t as (
    select (app.metric_actual(ta.metric, (select m0 from m),
             least(app.today(), ((select m0 from m) + interval '1 month - 1 day')::date),
             'person', ta.zone_id, ta.branch_id, ta.person_id, ta.client_id) / ta.amount * 100)::numeric as pct
      from public.target_allocations ta
     where ta.is_current and ta.level = 'person' and ta.person_id = p_person
       and ta.month = (select m0 from m) and ta.amount > 0
    union all
    select x from app.kpi_achievements(p_person, p_month) x)
  select round(avg(pct), 1) from t;
$$;

-- Manager / HR / Admin: every KPI held by people they can see, with this period's plan vs done.
create or replace function public.kpi_team(p_date date default null) returns jsonb
language plpgsql stable security definer set search_path = public, app, pg_temp as $$
declare v_d date := coalesce(p_date, app.today()); v_me uuid := app.me();
        v_all boolean := app.can_manage_kpis() or app.has_role('auditor') or app.has_role('leadership');
begin
  if v_me is null then raise exception 'Not signed in' using errcode = '28000'; end if;
  return (select coalesce(jsonb_agg(j order by dept, nm), '[]'::jsonb) from (
    select k.department dept, k.name nm, jsonb_build_object(
      'kpi_id', k.id, 'department', k.department, 'name', k.name, 'unit', k.unit, 'cadence', k.cadence,
      'higher_better', k.higher_better, 'period', app.kpi_period(k.cadence, v_d), 'rows', r.rows) j
      from public.kpi_catalogue k
      cross join lateral (
        select jsonb_agg(jsonb_build_object('person_id', a.person_id, 'full_name', p.full_name, 'target', a.target,
                 'planned', e.planned, 'actual', e.actual,
                 'commitment', case when e.planned is not null and e.planned <> 0 then round(100 * e.actual / e.planned) end) order by p.full_name) rows
          from public.kpi_assignment a join public.persons p on p.id = a.person_id
          left join public.kpi_entry e on e.person_id = a.person_id and e.kpi_id = k.id and e.period = app.kpi_period(k.cadence, v_d)
         where a.kpi_id = k.id and a.valid @> v_d and a.person_id <> v_me
           and (v_all or app.can_view_person(a.person_id, app.today(), 'operations') or app.can_view_person(a.person_id, app.today(), 'collections'))) r
     where k.active and r.rows is not null) s);
end $$;
grant execute on function public.kpi_team(date) to authenticated;
