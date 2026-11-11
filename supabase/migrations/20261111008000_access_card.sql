-- D-121  (a) KPI library is editable by HR/Admin with the same form used to add one.
--        (b) "Who has what": the scorecard list carries each person's KPIs and attributes.
--        (c) Access card: Admin decides, per role, whose records that role can open in each data area —
--            only their own / their own team / everyone. Enforced in the central person-level gates.

-- ================================================================ (a) KPI add / edit — one function
create or replace function public.kpi_upsert(p_kpi uuid, p_department text, p_subject text, p_measure text,
    p_time_unit text default 'days', p_higher_better boolean default null, p_levels text[] default null,
    p_description text default null, p_active boolean default true) returns jsonb
language plpgsql security definer set search_path = public, app, pg_temp as $$
declare v_name text; v_unit text; v_id uuid; v_metric text;
begin
  if not app.can_manage_kpis() then raise exception 'Only HR/Admin can change the KPI library.' using errcode = '42501'; end if;
  if p_measure not in ('count','percent','time','amount','rating') then raise exception 'Pick how it is measured.' using errcode = '22023'; end if;
  if coalesce(btrim(p_department), '') = '' then raise exception 'Pick the department.' using errcode = 'P0001'; end if;
  if p_levels is not null and exists (select 1 from unnest(p_levels) x where x not in ('executive','lead','manager','head')) then
    raise exception 'Unknown level.' using errcode = '22023'; end if;
  v_name := app.kpi_std_name(p_subject, p_measure);
  if length(split_part(v_name, ' – ', 1)) < 3 then raise exception 'Say what is being measured, in a few words.' using errcode = 'P0001'; end if;
  if exists (select 1 from public.kpi_catalogue k where k.department = btrim(p_department) and lower(k.name) = lower(v_name) and k.id is distinct from p_kpi) then
    raise exception 'This department already has "%".', v_name using errcode = 'P0001'; end if;
  v_unit := case p_measure when 'count' then 'nos' when 'percent' then '%' when 'amount' then '₹' when 'rating' then '/10'
                           else case when p_time_unit = 'hours' then 'hours' else 'days' end end;
  if p_kpi is null then
    insert into public.kpi_catalogue(department, name, unit, cadence, higher_better, levels, description, active, created_by)
    values (btrim(p_department), v_name, v_unit, 'monthly', coalesce(p_higher_better, p_measure <> 'time'), coalesce(p_levels, '{}'),
            nullif(btrim(coalesce(p_description, '')), ''), coalesce(p_active, true), app.me()) returning id into v_id;
  else
    select metric into v_metric from public.kpi_catalogue where id = p_kpi;
    update public.kpi_catalogue set department = btrim(p_department), name = v_name,
       unit = case when v_metric is not null then unit else v_unit end,
       higher_better = case when v_metric is not null then true else coalesce(p_higher_better, higher_better) end,
       levels = coalesce(p_levels, levels), description = nullif(btrim(coalesce(p_description, '')), ''), active = coalesce(p_active, active)
     where id = p_kpi returning id into v_id;
    if v_id is null then raise exception 'KPI not found.' using errcode = 'P0002'; end if;
  end if;
  return jsonb_build_object('kpi_id', v_id, 'name', v_name);
end $$;

create or replace function public.kpi_catalogue(p_department text default null) returns jsonb
language plpgsql stable security definer set search_path = public, app, pg_temp as $$
begin
  if not (app.can_manage_kpis() or app.has_role('auditor') or app.has_role('leadership')
          or app.has_role('ops_head') or app.has_role('collections_head') or app.has_role('product_head')) then
    raise exception 'Not permitted.' using errcode = '42501'; end if;
  return (select coalesce(jsonb_agg(jsonb_build_object('id', k.id, 'department', k.department, 'name', k.name, 'unit', k.unit, 'cadence', k.cadence,
      'higher_better', k.higher_better, 'active', k.active, 'description', k.description, 'levels', k.levels, 'auto', k.metric is not null,
      'assignees', (select count(*) from public.kpi_assignment a where a.kpi_id = k.id and a.valid @> app.today())) order by k.department, k.name), '[]'::jsonb)
    from public.kpi_catalogue k where p_department is null or k.department = p_department);
end $$;

-- ================================================================ (b) who has what
create or replace function public.scorecard_team() returns jsonb
language plpgsql stable security definer set search_path = public, app, pg_temp as $$
declare v_me uuid := app.me(); v_hr boolean := app.can_manage_kpis();
begin
  if v_me is null then raise exception 'Not signed in' using errcode = '28000'; end if;
  return jsonb_build_object('hr_view', v_hr, 'rows', (
    select coalesce(jsonb_agg(jsonb_build_object('person_id', p.id, 'full_name', p.full_name, 'designation', p.designation,
             'department', app.person_department(p.id), 'kpis', jsonb_array_length(x.kl), 'attributes', jsonb_array_length(x.al),
             'kpi_list', x.kl, 'attr_list', x.al,
             'ready', jsonb_array_length(x.kl) between 3 and 5 and jsonb_array_length(x.al) between 3 and 5) order by p.full_name), '[]'::jsonb)
      from public.persons p
      cross join lateral (select
         (select coalesce(jsonb_agg(jsonb_build_object('name', k.name, 'unit', k.unit, 'target', a.target, 'cadence', coalesce(a.cadence, k.cadence)) order by k.name), '[]'::jsonb)
            from public.kpi_assignment a join public.kpi_catalogue k on k.id = a.kpi_id and k.active where a.person_id = p.id and a.valid @> app.today()) kl,
         (select coalesce(jsonb_agg(c.name order by c.name), '[]'::jsonb)
            from public.person_attributes a join public.attribute_catalogue c on c.id = a.attribute_id where a.person_id = p.id and a.valid @> app.today()) al) x
     where p.status <> 'exited' and p.id <> v_me
       and (v_hr or exists (select 1 from public.reporting_lines r where r.person_id = p.id and r.manager_id = v_me and r.valid @> app.today()))));
end $$;

-- ================================================================ (c) access card
create table if not exists public.access_rules (
  area text not null,
  role text not null,
  level text not null check (level in ('self','team','all')),
  locked boolean not null default false,
  updated_by uuid references public.persons(id),
  updated_at timestamptz,
  primary key (area, role)
);
alter table public.access_rules enable row level security;
revoke all on public.access_rules from anon, authenticated;

-- today's behaviour, written down: everyone sees their own team unless listed below
insert into public.access_rules (area, role, level, locked)
select a.area, r.role,
  case when r.role = 'admin' then 'all'
       when a.area = 'figures'   and r.role in ('auditor','leadership') then 'all'
       when a.area = 'tasks'     and r.role in ('auditor','leadership','hr_admin') then 'all'
       when a.area = 'profiles'  and r.role = 'hr_admin' then 'all'
       when a.area = 'pay'       and r.role = 'hr_admin' then 'all'
       when a.area = 'documents' and r.role = 'hr_admin' then 'all'
       when a.area = 'scores'    and r.role = 'hr_admin' then 'all'
       when a.area = 'kpis'      and r.role in ('hr_admin','auditor','leadership') then 'all'
       else 'team' end,
  r.role = 'admin' or (a.area = 'profiles' and r.role = 'hr_admin')
from (values ('figures'),('tasks'),('profiles'),('pay'),('documents'),('scores'),('kpis'),('plans')) a(area)
cross join (values ('executive'),('manager'),('ba'),('bm'),('zm'),('ops_head'),('collections_head'),('product_head'),('hr_admin'),('auditor'),('leadership'),('ea'),('admin')) r(role)
on conflict (area, role) do nothing;

-- everyone the signed-in person (or the person they assist) has under them, in any reporting line
create or replace function app.in_my_team(p_person uuid) returns boolean
language sql stable security definer set search_path = public, app, pg_temp as $$
  with recursive t(id, path) as (
    select r.person_id, array[r.manager_id, r.person_id] from public.reporting_lines r
     where r.manager_id = any(app.principals()) and r.valid @> app.today()
    union all
    select r.person_id, t.path || r.person_id from public.reporting_lines r join t on r.manager_id = t.id
     where r.valid @> app.today() and not r.person_id = any(t.path))
  select p_person = any(app.principals()) or exists (select 1 from t where t.id = p_person);
$$;

-- the widest level any of my roles (or the roles of the person I assist) has for an area
create or replace function app.access_level(p_area text) returns text
language plpgsql stable security definer set search_path = public, app, pg_temp as $$
declare v_me text := coalesce(app.me()::text, '-'); v_key text := 'app.acl_' || p_area; v_cur text := current_setting(v_key, true); v text;
begin
  if v_cur is not null and split_part(v_cur, ':', 1) = v_me then return split_part(v_cur, ':', 2); end if;   -- looked up once per request
  v := case when app.is_admin() then 'all' else coalesce((
    select case max(case r.level when 'all' then 3 when 'team' then 2 else 1 end) when 3 then 'all' when 2 then 'team' else 'self' end
      from public.access_rules r join public.role_assignments ra on ra.role::text = r.role and ra.valid @> app.today()
     where r.area = p_area and ra.person_id = any(app.principals())), 'team') end;
  perform set_config(v_key, v_me || ':' || v, true);
  return v;
end $$;

-- may I open ANOTHER person's records in this area?  p_old = what the built-in rule says;
-- p_broad = the built-in rule is org-wide for me, so "own team" must narrow it.
create or replace function app.access_other(p_area text, p_person uuid, p_old boolean, p_broad boolean default true) returns boolean
language plpgsql stable security definer set search_path = public, app, pg_temp as $$
declare v text := app.access_level(p_area);
begin
  if v = 'all' then return true; end if;
  if v = 'team' then return coalesce(p_old, false) and (not coalesce(p_broad, true) or app.in_my_team(p_person)); end if;
  return false;
end $$;

-- ---- figures (operations & collections numbers of a person)
create or replace function app.can_view_person_old(p_person uuid, p_date date, p_fn app.fn)
returns boolean language plpgsql stable security definer set search_path = public, app, pg_temp as $$
declare v_me uuid := app.me();
begin
  if v_me is null then return false; end if;
  if p_person = v_me then return true; end if;
  if app.sees_all() then return true; end if;
  return p_person = any(app.principals())
      or exists (select 1 from unnest(app.principals()) pr(id), app.subtree(pr.id, p_fn, coalesce(p_date, app.today())) s where s.person_id = p_person);
end $$;

create or replace function app.can_view_person(p_person uuid, p_date date, p_fn app.fn)
returns boolean language plpgsql stable security definer set search_path = public, app, pg_temp as $$
declare v text;
begin
  if app.me() is null then return false; end if;
  if p_person = app.me() then return true; end if;
  v := app.access_level('figures');
  if v = 'all' then return true; end if;
  if v <> 'team' then return false; end if;
  return app.can_view_person_old(p_person, p_date, p_fn) and (not app.sees_all() or app.in_my_team(p_person));
end $$;

-- ---- tasks
create or replace function app.task_visible(p_owner uuid, p_subject uuid) returns boolean
language sql stable security definer set search_path = public, app, pg_temp as $$
  select app.me() is not null and (app.is_admin()
    or (p_owner is not null and (p_owner = app.me() or app.access_other('tasks', p_owner,
          app.has_role('hr_admin') or app.can_view_person_old(p_owner, app.today(), 'operations'), app.has_role('hr_admin') or app.sees_all())))
    or (p_subject is not null and (p_subject = app.me() or app.access_other('tasks', p_subject,
          app.has_role('hr_admin') or app.can_view_person_old(p_subject, app.today(), 'operations'), app.has_role('hr_admin') or app.sees_all()))))
$$;

-- ---- profiles: view only. app.above() itself is left untouched because it also gates manager actions.
do $mig$
declare f text := pg_get_functiondef('public.person_profile(uuid)'::regprocedure); o text := f;
begin
  if position('access_other' in f) = 0 then
    f := replace(f, 'v_self or app.above(p_person))', 'v_self or app.access_other(''profiles'', p_person, app.above(p_person), false))');
    if f = o then raise exception 'person_profile access anchor not found'; end if;
    execute f;
  end if;
end $mig$;

-- ---- pay
-- the existing pay rule is copied as-is (never retyped) so nothing widens by accident
do $mig$
declare f text := pg_get_functiondef('app.can_see_pay(uuid,date)'::regprocedure);
begin
  if position('access_other' in f) = 0 then
    execute replace(f, 'FUNCTION app.can_see_pay(', 'FUNCTION app.can_see_pay_old(');
  end if;
end $mig$;
create or replace function app.can_see_pay(p_person uuid, p_month date) returns boolean
language sql stable security definer set search_path = public, app, pg_temp as $$
  select case when p_person = app.me() then app.can_see_pay_old(p_person, p_month)
              else app.access_other('pay', p_person, app.can_see_pay_old(p_person, p_month), app.is_admin() or app.has_role('hr_admin')) end
$$;

-- ---- documents
create or replace function app.can_read_doc(p_person uuid, p_type text) returns boolean
language sql stable security definer set search_path = public, app, pg_temp as $$
  select p_person = app.me() or app.access_other('documents', p_person,
           app.is_admin() or app.has_role('hr_admin') or (p_type = 'police_verification' and app.above(p_person)),
           app.is_admin() or app.has_role('hr_admin'))
$$;

-- ---- monthly scores list
create or replace function public.team_scores(p_month date default null) returns jsonb
language plpgsql stable security definer set search_path = public, app, pg_temp as $$
declare v_m date := date_trunc('month', coalesce(p_month, app.scoring_window(app.today()), app.today()))::date;
        v_me uuid := app.me(); v_hr boolean := app.is_admin() or app.has_role('hr_admin'); v_rows jsonb;
begin
  with team as (
    select p.id, p.full_name, p.designation from public.persons p
     where p.status in ('active','suspended') and p.id <> v_me
       and app.access_other('scores', p.id, v_hr or p.id in (select app.direct_reports(v_me, v_m)), v_hr))
  select coalesce(jsonb_agg(jsonb_build_object(
           'person_id', t.id, 'full_name', t.full_name, 'designation', t.designation,
           'status', coalesce(ms.status, 'none'),
           'self_done', ms.self_at is not null,
           'can_edit', app.direct_mgr(t.id),
           'final', ms.final, 'kpi_final', ms.kpi_final, 'attr_final', ms.attr_final) order by t.full_name), '[]'::jsonb)
    into v_rows
    from team t left join public.monthly_scores ms on ms.person_id = t.id and ms.month = v_m;
  return jsonb_build_object('month', v_m, 'rows', v_rows, 'can_lock', v_hr,
    'window_open', app.scoring_open(v_m), 'open_month', app.scoring_window(app.today()), 'hr_view', v_hr);
end $$;

-- ---- KPI roll-up
create or replace function public.kpi_team(p_date date default null) returns jsonb
language plpgsql stable security definer set search_path = public, app, pg_temp as $$
declare v_d date := coalesce(p_date, app.today()); v_me uuid := app.me(); v_m0 date := date_trunc('month', coalesce(p_date, app.today()))::date;
        v_all boolean := app.can_manage_kpis() or app.has_role('auditor') or app.has_role('leadership');
begin
  if v_me is null then raise exception 'Not signed in' using errcode = '28000'; end if;
  return (select coalesce(jsonb_agg(j order by dept, nm), '[]'::jsonb) from (
    select k.department dept, k.name nm, jsonb_build_object(
      'kpi_id', k.id, 'department', k.department, 'name', k.name, 'unit', k.unit, 'cadence', k.cadence, 'auto', k.metric is not null,
      'higher_better', k.higher_better, 'period', case when k.metric is not null then v_m0 else app.kpi_period(k.cadence, v_d) end, 'rows', r.rows) j
      from public.kpi_catalogue k
      cross join lateral (
        select jsonb_agg(jsonb_build_object('person_id', a.person_id, 'full_name', p.full_name, 'target', a.target,
                 'planned', e.planned, 'actual', x.actual,
                 'commitment', case when k.metric is not null then case when a.target > 0 then round(100 * x.actual / a.target) end
                                    when e.planned is not null and e.planned <> 0 then round(100 * e.actual / e.planned) end) order by p.full_name) rows
          from public.kpi_assignment a join public.persons p on p.id = a.person_id
          left join public.kpi_entry e on e.person_id = a.person_id and e.kpi_id = k.id and e.period = app.kpi_period(coalesce(a.cadence, k.cadence), v_d)
          cross join lateral (select case when k.metric is not null then app.metric_actual(k.metric, v_m0, v_d, 'person', null, null, a.person_id, null) else e.actual end actual) x
         where a.kpi_id = k.id and a.valid @> v_d and a.person_id <> v_me
           and app.access_other('kpis', a.person_id,
                 v_all or app.can_view_person_old(a.person_id, app.today(), 'operations') or app.can_view_person_old(a.person_id, app.today(), 'collections')
                 or exists (select 1 from public.reporting_lines rl where rl.person_id = a.person_id and rl.manager_id = v_me and rl.valid @> app.today()), v_all)) r
     where k.active and r.rows is not null) s);
end $$;

-- ---- daily check-in & plans of the team
create or replace function public.team_commitment(p_date date default null) returns jsonb
language plpgsql stable security definer set search_path = public, app, pg_temp as $$
declare v_d date := coalesce(p_date, app.today()); v_lvl text := app.access_level('plans');
begin
  if v_lvl = 'self' or not (v_lvl = 'all' or app.is_admin() or app.has_role('hr_admin') or app.has_role('ops_head') or app.has_role('leadership')
          or app.has_reports(app.me(), 'operations', app.today())) then
    raise exception 'Only managers and above see team commitment.' using errcode = '42501'; end if;
  return (select coalesce(jsonb_agg(jsonb_build_object('person_id', s.person_id, 'full_name', p.full_name,
            'checked_in', dp.checked_in_at is not null, 'checked_in_at', dp.checked_in_at,
            'planned_total', coalesce(dp.planned, (select sum((v)::int) from jsonb_each_text(coalesce(dp.plan, '{}')) e(k, v)), 0),
            'actual_total', app.day_actual(s.person_id, v_d), 'commitment_pct', app.commitment_pct(s.person_id, v_d),
            'plan_note', dp.plan_note, 'done_note', dp.done_note) order by p.full_name), '[]')
    from (select t.person_id from app.subtree(app.me(), 'operations', v_d) t where v_lvl <> 'all'
          union select q.id from public.persons q where v_lvl = 'all' and app.reports_figures(q.id)) s
    join public.persons p on p.id = s.person_id and p.status = 'active'
    left join public.day_plan dp on dp.person_id = s.person_id and dp.work_date = v_d
   where s.person_id <> app.me());
end $$;

-- ---- the card itself
create or replace function public.access_card() returns jsonb
language plpgsql stable security definer set search_path = public, app, pg_temp as $$
begin
  if not app.is_admin() then raise exception 'Only Admin can open the access card.' using errcode = '42501'; end if;
  return jsonb_build_object(
    'areas', jsonb_build_array(
      jsonb_build_object('key','figures','label','Daily figures','description','Operations and collections numbers of a person — daily updates, productivity, performance pages.','warn','Everyone also lets this role act wherever a manager can act on someone''s figures.'),
      jsonb_build_object('key','tasks','label','Tasks & misses','description','Tasks, misses and their replies that belong to or are about a person. Pay and HR tasks stay with HR.'),
      jsonb_build_object('key','profiles','label','People profiles','description','Opening another person''s profile: work details, managers, commitment. ID and bank details stay with HR and the person.'),
      jsonb_build_object('key','pay','label','Salary & payslips','description','Another person''s salary and payslip. Managers never see pay; at "Own team" a Business Associate sees only their own partners.'),
      jsonb_build_object('key','documents','label','HR documents','description','Another person''s uploaded documents. Managers at "Own team" see only the police verification.'),
      jsonb_build_object('key','scores','label','Monthly scores','description','Seeing other people''s monthly scores. Scoring is always the direct manager; locking is always HR/Admin.'),
      jsonb_build_object('key','kpis','label','KPI roll-up','description','Other people''s KPI targets, plan and done on the KPIs page.'),
      jsonb_build_object('key','plans','label','Check-in & plans','description','Who checked in, what they planned and their Commitment % for the day.')),
    'roles', (select jsonb_agg(jsonb_build_object('code', r.role, 'label', r.label,
                 'people', (select count(distinct ra.person_id) from public.role_assignments ra join public.persons p on p.id = ra.person_id and p.status <> 'exited'
                             where ra.role::text = r.role and ra.valid @> app.today())) order by r.ord)
                from (values ('executive','Executive',1),('ba','Business Associate',2),('manager','Manager',3),('bm','Branch Manager',4),('zm','Zonal Manager',5),
                             ('ops_head','Operations Head',6),('collections_head','Collections Head',7),('product_head','Product Head',8),
                             ('hr_admin','HR',9),('auditor','Auditor',10),('leadership','Leadership',11),('ea','Executive Assistant',12),('admin','Admin',13)) r(role, label, ord)),
    'rules', (select jsonb_agg(jsonb_build_object('area', a.area, 'role', a.role, 'level', a.level, 'locked', a.locked,
                 'by', (select full_name from public.persons where id = a.updated_by), 'at', a.updated_at)) from public.access_rules a));
end $$;

create or replace function public.access_set(p_area text, p_role text, p_level text) returns jsonb
language plpgsql security definer set search_path = public, app, pg_temp as $$
declare v_locked boolean;
begin
  if not app.is_admin() then raise exception 'Only Admin can change access.' using errcode = '42501'; end if;
  if p_level not in ('self','team','all') then raise exception 'Unknown level.' using errcode = '22023'; end if;
  select locked into v_locked from public.access_rules where area = p_area and role = p_role;
  if not found then raise exception 'Unknown area or role.' using errcode = 'P0002'; end if;
  if v_locked then raise exception 'This one is fixed and cannot be changed here.' using errcode = '42501'; end if;
  update public.access_rules set level = p_level, updated_by = app.me(), updated_at = now() where area = p_area and role = p_role;
  return jsonb_build_object('ok', true);
end $$;

grant execute on function public.kpi_upsert(uuid, text, text, text, text, boolean, text[], text, boolean), public.access_card(), public.access_set(text, text, text) to authenticated;
revoke all on function app.in_my_team(uuid), app.access_level(text), app.access_other(text, uuid, boolean, boolean),
  app.can_view_person_old(uuid, date, app.fn), app.can_see_pay_old(uuid, date) from public, anon;
grant execute on function app.in_my_team(uuid), app.access_level(text), app.access_other(text, uuid, boolean, boolean),
  app.can_view_person_old(uuid, date, app.fn), app.can_see_pay_old(uuid, date) to authenticated;
