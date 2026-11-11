-- D-118  Cross-department KPI engine (Phase 1): define KPIs for any department, assign them with
-- targets, and let people enter plan/actual each period — the same plan→do→commitment shape as
-- operations, for Finance, HR, Sales, IT, Audit, BE, etc. (Scoring integration is a later phase.)

create table if not exists public.kpi_catalogue (
  id uuid primary key default gen_random_uuid(),
  department text not null,
  name text not null,
  unit text,
  cadence text not null check (cadence in ('daily','weekly','monthly')),
  higher_better boolean not null default true,
  active boolean not null default true,
  created_by uuid references public.persons(id),
  created_at timestamptz not null default now()
);
create index if not exists kpi_catalogue_dept on public.kpi_catalogue (department, active);

create table if not exists public.kpi_assignment (
  id uuid primary key default gen_random_uuid(),
  person_id uuid not null references public.persons(id),
  kpi_id uuid not null references public.kpi_catalogue(id),
  target numeric,
  valid daterange not null default daterange(current_date, null),
  created_by uuid references public.persons(id),
  created_at timestamptz not null default now(),
  exclude using gist (person_id with =, kpi_id with =, valid with &&)
);
create index if not exists kpi_assignment_person on public.kpi_assignment (person_id);
create index if not exists kpi_assignment_kpi on public.kpi_assignment (kpi_id);

create table if not exists public.kpi_entry (
  person_id uuid not null references public.persons(id),
  kpi_id uuid not null references public.kpi_catalogue(id),
  period date not null,
  planned numeric,
  actual numeric,
  note text,
  updated_at timestamptz not null default now(),
  primary key (person_id, kpi_id, period)
);

alter table public.kpi_catalogue enable row level security;
alter table public.kpi_assignment enable row level security;
alter table public.kpi_entry enable row level security;
revoke all on public.kpi_catalogue, public.kpi_assignment, public.kpi_entry from anon, authenticated;

-- The start date of the period that a date falls in, for a cadence.
create or replace function app.kpi_period(p_cadence text, p_date date) returns date
language sql immutable as $$
  select case p_cadence when 'daily' then p_date when 'weekly' then date_trunc('week', p_date)::date
                        else date_trunc('month', p_date)::date end;
$$;

create or replace function app.can_manage_kpis() returns boolean
language sql stable security definer set search_path = public, app, pg_temp as $$
  select app.is_admin() or app.has_role('hr_admin');
$$;

-- ---------------------------------------------------------------- admin: define & assign
create or replace function public.kpi_define(p_department text, p_name text, p_unit text, p_cadence text,
    p_higher_better boolean default true) returns uuid
language plpgsql security definer set search_path = public, app, pg_temp as $$
declare v_id uuid;
begin
  if not app.can_manage_kpis() then raise exception 'Only HR/Admin can define KPIs.' using errcode = '42501'; end if;
  if coalesce(btrim(p_department),'') = '' or coalesce(btrim(p_name),'') = '' then raise exception 'Department and name are required.' using errcode = 'P0001'; end if;
  if p_cadence not in ('daily','weekly','monthly') then raise exception 'Cadence must be daily, weekly or monthly.' using errcode = '22023'; end if;
  insert into public.kpi_catalogue(department, name, unit, cadence, higher_better, created_by)
  values (btrim(p_department), btrim(p_name), nullif(btrim(coalesce(p_unit,'')),''), p_cadence, coalesce(p_higher_better,true), app.me())
  returning id into v_id;
  return v_id;
end $$;

create or replace function public.kpi_set_active(p_kpi uuid, p_active boolean) returns void
language plpgsql security definer set search_path = public, app, pg_temp as $$
begin
  if not app.can_manage_kpis() then raise exception 'Only HR/Admin can change KPIs.' using errcode = '42501'; end if;
  update public.kpi_catalogue set active = p_active where id = p_kpi;
end $$;

create or replace function public.kpi_catalogue(p_department text default null) returns jsonb
language plpgsql stable security definer set search_path = public, app, pg_temp as $$
begin
  if not (app.can_manage_kpis() or app.has_role('auditor') or app.has_role('leadership')
          or app.has_role('ops_head') or app.has_role('collections_head') or app.has_role('product_head')) then
    raise exception 'Not permitted.' using errcode = '42501'; end if;
  return (select coalesce(jsonb_agg(jsonb_build_object(
      'id', k.id, 'department', k.department, 'name', k.name, 'unit', k.unit, 'cadence', k.cadence,
      'higher_better', k.higher_better, 'active', k.active,
      'assignees', (select count(*) from public.kpi_assignment a where a.kpi_id = k.id and a.valid @> app.today()))
      order by k.department, k.name), '[]'::jsonb)
    from public.kpi_catalogue k where p_department is null or k.department = p_department);
end $$;

-- List of departments in use.
create or replace function public.kpi_departments() returns jsonb
language sql stable security definer set search_path = public, app, pg_temp as $$
  select coalesce(jsonb_agg(distinct department order by department), '[]'::jsonb) from public.kpi_catalogue;
$$;

create or replace function public.kpi_assign(p_person uuid, p_kpi uuid, p_target numeric default null) returns uuid
language plpgsql security definer set search_path = public, app, pg_temp as $$
declare v_id uuid;
begin
  if not app.can_manage_kpis() then raise exception 'Only HR/Admin can assign KPIs.' using errcode = '42501'; end if;
  -- close any current assignment, then open a fresh one (keeps history)
  update public.kpi_assignment set valid = daterange(lower(valid), current_date)
   where person_id = p_person and kpi_id = p_kpi and valid @> app.today();
  insert into public.kpi_assignment(person_id, kpi_id, target, valid, created_by)
  values (p_person, p_kpi, p_target, daterange(current_date, null), app.me()) returning id into v_id;
  insert into public.notifications(person_id, kind, message, link)
  values (p_person, 'task', 'A new KPI was assigned to you: ' || (select name from public.kpi_catalogue where id = p_kpi), '/kpis');
  return v_id;
end $$;

create or replace function public.kpi_unassign(p_person uuid, p_kpi uuid) returns void
language plpgsql security definer set search_path = public, app, pg_temp as $$
begin
  if not app.can_manage_kpis() then raise exception 'Only HR/Admin can change assignments.' using errcode = '42501'; end if;
  update public.kpi_assignment set valid = daterange(lower(valid), current_date)
   where person_id = p_person and kpi_id = p_kpi and valid @> app.today();
end $$;

-- Who is assigned a KPI (for the admin screen).
create or replace function public.kpi_assignees(p_kpi uuid) returns jsonb
language plpgsql stable security definer set search_path = public, app, pg_temp as $$
begin
  if not app.can_manage_kpis() then raise exception 'Not permitted.' using errcode = '42501'; end if;
  return (select coalesce(jsonb_agg(jsonb_build_object('person_id', a.person_id, 'full_name', p.full_name,
            'designation', p.designation, 'target', a.target) order by p.full_name), '[]'::jsonb)
    from public.kpi_assignment a join public.persons p on p.id = a.person_id
   where a.kpi_id = p_kpi and a.valid @> app.today());
end $$;

-- ---------------------------------------------------------------- the person: enter plan / actual
create or replace function public.my_kpis(p_date date default null) returns jsonb
language plpgsql stable security definer set search_path = public, app, pg_temp as $$
declare v_me uuid := app.me(); v_d date := coalesce(p_date, app.today());
begin
  if v_me is null then raise exception 'Not signed in' using errcode = '28000'; end if;
  return (select coalesce(jsonb_agg(row order by dept, nm), '[]'::jsonb) from (
    select jsonb_build_object(
      'kpi_id', k.id, 'department', k.department, 'name', k.name, 'unit', k.unit, 'cadence', k.cadence,
      'higher_better', k.higher_better, 'target', a.target,
      'period', app.kpi_period(k.cadence, v_d),
      'planned', e.planned, 'actual', e.actual, 'note', e.note,
      'commitment', case when e.planned is not null and e.planned <> 0 then round(100 * e.actual / e.planned) end) as row, k.department as dept, k.name as nm
      from public.kpi_assignment a
      join public.kpi_catalogue k on k.id = a.kpi_id and k.active
      left join public.kpi_entry e on e.person_id = a.person_id and e.kpi_id = a.kpi_id and e.period = app.kpi_period(k.cadence, v_d)
     where a.person_id = v_me and a.valid @> v_d) s);
end $$;

create or replace function public.save_kpi_entry(p_kpi uuid, p_period date, p_planned numeric default null,
    p_actual numeric default null, p_note text default null) returns jsonb
language plpgsql security definer set search_path = public, app, pg_temp as $$
declare v_me uuid := app.me(); v_cad text; v_period date;
begin
  if v_me is null then raise exception 'Not signed in' using errcode = '28000'; end if;
  select cadence into v_cad from public.kpi_catalogue k
    where k.id = p_kpi and k.active and exists (select 1 from public.kpi_assignment a where a.kpi_id = k.id and a.person_id = v_me and a.valid @> app.today());
  if v_cad is null then raise exception 'That KPI is not assigned to you.' using errcode = '42501'; end if;
  v_period := app.kpi_period(v_cad, coalesce(p_period, app.today()));
  if v_period > app.kpi_period(v_cad, app.today()) then raise exception 'That period has not started yet.' using errcode = 'P0001'; end if;
  insert into public.kpi_entry(person_id, kpi_id, period, planned, actual, note, updated_at)
  values (v_me, p_kpi, v_period, p_planned, p_actual, nullif(btrim(coalesce(p_note,'')),''), now())
  on conflict (person_id, kpi_id, period) do update set planned = excluded.planned, actual = excluded.actual,
     note = excluded.note, updated_at = now();
  return jsonb_build_object('ok', true);
end $$;

-- ---------------------------------------------------------------- roll-up for managers / HR / admin
create or replace function public.kpi_rollup(p_department text, p_date date default null) returns jsonb
language plpgsql stable security definer set search_path = public, app, pg_temp as $$
declare v_d date := coalesce(p_date, app.today()); v_all boolean := app.can_manage_kpis() or app.has_role('auditor') or app.has_role('leadership');
begin
  if not (v_all or app.has_role('ops_head') or app.has_role('collections_head') or app.has_role('product_head')
          or app.has_reports(app.me(), 'operations', app.today()) or app.has_reports(app.me(), 'collections', app.today())) then
    raise exception 'Not permitted.' using errcode = '42501'; end if;
  return (select coalesce(jsonb_agg(jsonb_build_object(
      'kpi_id', k.id, 'name', k.name, 'unit', k.unit, 'cadence', k.cadence, 'higher_better', k.higher_better,
      'period', app.kpi_period(k.cadence, v_d),
      'rows', (select coalesce(jsonb_agg(jsonb_build_object('person_id', a.person_id, 'full_name', p.full_name,
                 'target', a.target, 'planned', e.planned, 'actual', e.actual,
                 'commitment', case when e.planned is not null and e.planned <> 0 then round(100 * e.actual / e.planned) end) order by p.full_name), '[]'::jsonb)
                 from public.kpi_assignment a join public.persons p on p.id = a.person_id
                 left join public.kpi_entry e on e.person_id = a.person_id and e.kpi_id = k.id and e.period = app.kpi_period(k.cadence, v_d)
                where a.kpi_id = k.id and a.valid @> v_d
                  and (v_all or app.can_view_person(a.person_id, app.today(), 'operations') or app.can_view_person(a.person_id, app.today(), 'collections'))))
      order by k.name), '[]'::jsonb)
    from public.kpi_catalogue k where k.department = p_department and k.active);
end $$;

grant execute on function public.kpi_define(text, text, text, text, boolean), public.kpi_set_active(uuid, boolean),
  public.kpi_catalogue(text), public.kpi_departments(), public.kpi_assign(uuid, uuid, numeric), public.kpi_unassign(uuid, uuid),
  public.kpi_assignees(uuid), public.my_kpis(date), public.save_kpi_entry(uuid, date, numeric, numeric, text),
  public.kpi_rollup(text, date) to authenticated;

-- whoami: does this person have any KPI assigned (to show the "My KPIs" menu)?
do $mig$
declare v text := pg_get_functiondef('public.whoami()'::regprocedure); o text := v;
begin
  v := replace(v, '''reports_figures'', app.reports_figures(p.id),',
                  '''reports_figures'', app.reports_figures(p.id),
    ''has_kpis'', exists (select 1 from public.kpi_assignment a where a.person_id = p.id and a.valid @> app.today()),');
  if v = o then raise exception 'whoami has_kpis anchor not found'; end if;
  execute v;
end $mig$;
