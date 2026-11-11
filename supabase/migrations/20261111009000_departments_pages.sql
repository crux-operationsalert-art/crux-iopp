-- D-122  (a) Departments are first-class: HR/Admin add a department and put people in it.
--        (b) Access card also hides company-wide report pages from a role (server-enforced).

-- ================================================================ (a) departments
create table if not exists public.departments (
  name text primary key,
  created_by uuid references public.persons(id),
  created_at timestamptz not null default now()
);
alter table public.departments enable row level security;
revoke all on public.departments from anon, authenticated;

insert into public.departments(name)
select distinct d from (select department d from public.kpi_catalogue union select department from public.persons where department is not null) x
 where d is not null on conflict do nothing;

-- any department used by a KPI exists as a department
create or replace function app.kpi_department_sync() returns trigger
language plpgsql security definer set search_path = public, app, pg_temp as $$
begin
  insert into public.departments(name, created_by) values (new.department, app.me()) on conflict do nothing;
  return new;
end $$;
do $$ begin
  if not exists (select 1 from pg_trigger where tgname = 'kpi_department_sync') then
    create trigger kpi_department_sync after insert or update of department on public.kpi_catalogue
      for each row execute function app.kpi_department_sync();
  end if;
end $$;

create or replace function public.department_add(p_name text) returns jsonb
language plpgsql security definer set search_path = public, app, pg_temp as $$
declare v text := regexp_replace(btrim(coalesce(p_name, '')), '\s+', ' ', 'g'); v_old text;
begin
  if not app.can_manage_kpis() then raise exception 'Only HR/Admin can add a department.' using errcode = '42501'; end if;
  if length(v) < 2 then raise exception 'Give the department a name.' using errcode = 'P0001'; end if;
  select name into v_old from public.departments where lower(name) = lower(v);
  if v_old is not null then raise exception 'There is already a department called "%".', v_old using errcode = 'P0001'; end if;
  insert into public.departments(name, created_by) values (v, app.me());
  return jsonb_build_object('name', v);
end $$;

create or replace function public.person_set_department(p_person uuid, p_department text) returns jsonb
language plpgsql security definer set search_path = public, app, pg_temp as $$
begin
  if not app.can_setup_scorecard(p_person) then raise exception 'Only the reporting manager or HR/Admin can do this.' using errcode = '42501'; end if;
  if not exists (select 1 from public.departments where name = p_department) then raise exception 'Unknown department.' using errcode = 'P0002'; end if;
  perform set_config('app.reason', 'department set', true);
  update public.persons set department = p_department where id = p_person;
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.departments_list() returns jsonb
language plpgsql stable security definer set search_path = public, app, pg_temp as $$
begin
  if not app.can_manage_kpis() then raise exception 'Only HR/Admin can see this.' using errcode = '42501'; end if;
  return (
    with pd as (select p.id, p.full_name, p.designation, app.person_department(p.id) dept, p.department is not null as fixed
                  from public.persons p where p.status <> 'exited')
    select coalesce(jsonb_agg(jsonb_build_object('name', d.name,
             'kpis', (select count(*) from public.kpi_catalogue k where k.department = d.name and k.active),
             'people', (select coalesce(jsonb_agg(jsonb_build_object('person_id', pd.id, 'full_name', pd.full_name, 'designation', pd.designation, 'fixed', pd.fixed) order by pd.full_name), '[]'::jsonb)
                          from pd where pd.dept = d.name)) order by d.name), '[]'::jsonb)
      from public.departments d);
end $$;

-- the setup screen offers every department, including ones with no KPIs yet
do $mig$
declare f text := pg_get_functiondef('public.scorecard_person(uuid,text)'::regprocedure); o text := f;
begin
  if position('public.departments' in f) = 0 then
    f := replace(f, '(select coalesce(jsonb_agg(distinct k.department), ''[]''::jsonb) from public.kpi_catalogue k where k.active)',
                    '(select coalesce(jsonb_agg(d.name order by d.name), ''[]''::jsonb) from public.departments d)');
    if f = o then raise exception 'scorecard_person departments anchor not found'; end if;
    execute f;
  end if;
end $mig$;

-- ================================================================ (b) pages on the access card
-- For pages, level 'all' = as today, 'self' = hidden from this role. A person keeps a page if ANY of their roles keeps it.
insert into public.access_rules (area, role, level, locked)
select 'page:' || a.page, r.role, 'all', r.role = 'admin'
from (values ('tracker'),('status'),('live'),('history'),('attrition'),('targets')) a(page)
cross join (values ('executive'),('manager'),('ba'),('bm'),('zm'),('ops_head'),('collections_head'),('product_head'),('hr_admin'),('auditor'),('leadership'),('ea'),('admin')) r(role)
on conflict (area, role) do nothing;

create or replace function app.page_hidden(p_page text) returns boolean
language sql stable security definer set search_path = public, app, pg_temp as $$
  select not app.is_admin()
     and exists (select 1 from public.role_assignments ra where ra.person_id = app.me() and ra.valid @> app.today())
     and not exists (select 1 from public.role_assignments ra
                      left join public.access_rules r on r.area = 'page:' || p_page and r.role = ra.role::text
                      where ra.person_id = app.me() and ra.valid @> app.today() and coalesce(r.level, 'all') <> 'self');
$$;

create or replace function app.hidden_pages() returns jsonb
language sql stable security definer set search_path = public, app, pg_temp as $$
  select coalesce(jsonb_agg(x), '[]'::jsonb) from unnest(array['tracker','status','live','history','attrition','targets']) x where app.page_hidden(x);
$$;

-- put the check at the top of the one function behind each page
do $mig$
declare r record; f text; o text; g text;
begin
  for r in select * from (values
      ('tracker',   'public.tracker_export(date)'),
      ('status',    'public.zonal_tracker(date)'),
      ('live',      'public.missing_submissions(date,app.fn)'),
      ('history',   'public.tracker_history(date,date,text,date)'),
      ('attrition', 'public.attrition(date,date)'),
      ('targets',   'public.team_targets(date,uuid)')) v(page, sig) loop
    f := pg_get_functiondef(r.sig::regprocedure); o := f;
    if position('app.page_hidden' in f) > 0 then continue; end if;
    g := E'\nbegin\n  if app.page_hidden(''' || r.page || E''') then raise exception ''This page is turned off for your role.'' using errcode = ''42501''; end if;\n';
    f := regexp_replace(f, E'\nbegin\n', g);      -- first occurrence only
    if f = o then raise exception 'page guard anchor not found in %', r.sig; end if;
    execute f;
  end loop;
end $mig$;

-- the app hides those menu entries
do $mig$
declare v text := pg_get_functiondef('public.whoami()'::regprocedure); o text := v;
begin
  if position('hidden_pages' in v) = 0 then
    v := replace(v, '''reports_figures'', app.reports_figures(p.id),', '''reports_figures'', app.reports_figures(p.id), ''hidden_pages'', app.hidden_pages(),');
    if v = o then raise exception 'whoami hidden_pages anchor not found'; end if;
    execute v;
  end if;
end $mig$;

-- the card: areas stay as they were; pages are listed separately
do $mig$
declare f text := pg_get_functiondef('public.access_card()'::regprocedure); o text := f;
begin
  if position('''pages''' in f) = 0 then
    f := replace(f, '''roles'', (select jsonb_agg(jsonb_build_object(''code'', r.role',
      '''pages'', jsonb_build_array(
      jsonb_build_object(''key'',''page:tracker'',''label'',''Zonal Tracker'',''description'',''The live zone-wise monthly business tracker.''),
      jsonb_build_object(''key'',''page:status'',''label'',''Revenue Status'',''description'',''Revenue against target by zone and branch.''),
      jsonb_build_object(''key'',''page:live'',''label'',''Daily submissions'',''description'',''Who has and has not submitted today.''),
      jsonb_build_object(''key'',''page:history'',''label'',''History'',''description'',''Past months of the tracker.''),
      jsonb_build_object(''key'',''page:attrition'',''label'',''Attrition'',''description'',''Joiners and leavers report.''),
      jsonb_build_object(''key'',''page:targets'',''label'',''Targets'',''description'',''The Targets page (team targets and achievement).'')),
    ''roles'', (select jsonb_agg(jsonb_build_object(''code'', r.role');
    if f = o then raise exception 'access_card pages anchor not found'; end if;
    execute f;
  end if;
end $mig$;

create or replace function public.access_set(p_area text, p_role text, p_level text) returns jsonb
language plpgsql security definer set search_path = public, app, pg_temp as $$
declare v_locked boolean;
begin
  if not app.is_admin() then raise exception 'Only Admin can change access.' using errcode = '42501'; end if;
  if p_level not in ('self','team','all') or (p_area like 'page:%' and p_level = 'team') then raise exception 'Unknown level.' using errcode = '22023'; end if;
  select locked into v_locked from public.access_rules where area = p_area and role = p_role;
  if not found then raise exception 'Unknown area or role.' using errcode = 'P0002'; end if;
  if v_locked then raise exception 'This one is fixed and cannot be changed here.' using errcode = '42501'; end if;
  update public.access_rules set level = p_level, updated_by = app.me(), updated_at = now() where area = p_area and role = p_role;
  return jsonb_build_object('ok', true);
end $$;

grant execute on function public.department_add(text), public.person_set_department(uuid, text), public.departments_list() to authenticated;
