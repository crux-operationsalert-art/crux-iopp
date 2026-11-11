-- D-123  Approved designations with a seniority order, and department on the add-person form.
-- Admin/HR may use any designation and add new ones. Anyone else adding a person may only pick an
-- approved designation BELOW their own (and below the person's manager), inside their own department.

create table if not exists public.designations (
  name text primary key,
  rank int not null,                -- 1 = most senior
  short text,
  default_role text not null default 'executive',
  active boolean not null default true,
  created_by uuid references public.persons(id),
  created_at timestamptz not null default now()
);
alter table public.designations enable row level security;
revoke all on public.designations from anon, authenticated;

insert into public.designations (name, rank, short, default_role) values
  ('Chairman', 1, null, 'manager'), ('Managing Director', 2, 'MD', 'manager'), ('Director', 3, null, 'manager'), ('President', 4, null, 'manager'),
  ('Senior Vice President', 5, 'SVP', 'manager'), ('Vice President', 6, 'VP', 'manager'), ('National Head', 6, null, 'manager'),
  ('Associate Vice President', 7, 'AVP', 'manager'), ('General Manager', 8, 'GM', 'manager'), ('Product Head', 8, null, 'manager'),
  ('Deputy General Manager', 9, 'DGM', 'manager'), ('Zonal Manager', 9, null, 'zm'), ('Assistant General Manager', 10, 'AGM', 'manager'),
  ('Senior Manager', 11, null, 'manager'), ('Manager', 12, null, 'manager'), ('Branch Manager', 12, null, 'bm'), ('Team Manager', 12, null, 'manager'),
  ('Business Development Manager', 12, 'BDM', 'manager'), ('Deputy Manager', 13, null, 'manager'), ('Associate Manager', 13, null, 'manager'),
  ('Assistant Manager', 14, null, 'manager'), ('Assistant Branch Manager', 14, null, 'manager'), ('Team Leader', 15, null, 'executive'),
  ('Senior Executive', 16, null, 'executive'), ('Client Coordinator', 16, null, 'executive'), ('Project Coordinator', 16, null, 'executive'),
  ('Business Associate', 14, null, 'ba'), ('Executive', 17, null, 'executive'), ('Associate', 18, null, 'executive'), ('Trainee', 19, null, 'executive')
on conflict (name) do nothing;

-- seniority of any designation text (existing free-text titles included): the longest approved name it contains wins
create or replace function app.designation_match(p_text text) returns int
language sql stable security definer set search_path = public, app, pg_temp as $$
  select d.rank from public.designations d
   where d.active and (lower(coalesce(p_text, '')) like '%' || lower(d.name) || '%' or (d.short is not null and coalesce(p_text, '') ~* ('\m' || d.short || '\M')))
   order by length(d.name) desc limit 1;
$$;

create or replace function app.designation_rank(p_text text) returns int
language sql stable security definer set search_path = public, app, pg_temp as $$
  select coalesce(app.designation_match(p_text),
    case when p_text ~* '(head|president|director|chairman)' then 6 when p_text ~* 'manager' then 12
         when p_text ~* '(lead|coordinator|senior)' then 15 else 17 end);
$$;

-- a person's seniority: their designation when it is an approved one; otherwise the more senior of a guess from
-- the title and what their app role implies (so a short or unusual title such as "BM" never ranks a manager as junior staff)
create or replace function app.person_rank(p_person uuid) returns int
language sql stable security definer set search_path = public, app, pg_temp as $$
  select coalesce(app.designation_match(p.designation), least(app.designation_rank(p.designation),
    coalesce((select min(case ra.role::text when 'leadership' then 4 when 'ops_head' then 6 when 'collections_head' then 6 when 'product_head' then 8
                                             when 'zm' then 9 when 'bm' then 12 when 'manager' then 12 when 'ba' then 14 else 99 end)
                from public.role_assignments ra where ra.person_id = p.id and ra.valid @> app.today()), 99)))
    from public.persons p where p.id = p_person;
$$;

-- the rule applied whenever someone other than Admin/HR adds a person
create or replace function app.check_designation(p_designation text, p_manager uuid) returns void
language plpgsql stable security definer set search_path = public, app, pg_temp as $$
declare v_rank int;
begin
  if app.is_admin() or app.has_role('hr_admin') then return; end if;
  select rank into v_rank from public.designations where active and lower(name) = lower(btrim(coalesce(p_designation, '')));
  if v_rank is null then raise exception 'Pick a designation from the approved list. Ask HR/Admin to add a new one.' using errcode = 'P0001'; end if;
  if v_rank <= app.person_rank(app.me()) then raise exception 'You can only add designations below your own.' using errcode = '42501'; end if;
  if p_manager is not null and p_manager <> app.me() and v_rank <= app.person_rank(p_manager) then
    raise exception 'That designation is not below the person they will report to.' using errcode = '42501'; end if;
end $$;

do $mig$
declare f text := pg_get_functiondef('public.create_team_member(text,text,text,text,text,app.role_code,uuid,app.fn,date,uuid,uuid)'::regprocedure); o text := f;
begin
  if position('app.check_designation' in f) = 0 then
    f := replace(f, '  perform set_config(''app.reason'', ''create team member'', true);',
                    E'  perform app.check_designation(p_designation, p_manager_id);\n  perform set_config(''app.reason'', ''create team member'', true);');
    if f = o then raise exception 'create_team_member anchor not found'; end if;
    execute f;
  end if;
end $mig$;

-- what the add-person form may offer to the signed-in person
create or replace function public.designation_options() returns jsonb
language plpgsql stable security definer set search_path = public, app, pg_temp as $$
declare v_all boolean := app.is_admin() or app.has_role('hr_admin'); v_rank int := app.person_rank(app.me()); v_dept text := app.person_department(app.me());
begin
  if app.me() is null then raise exception 'Not signed in' using errcode = '28000'; end if;
  return jsonb_build_object('admin', v_all, 'my_department', v_dept,
    'departments', case when v_all then (select coalesce(jsonb_agg(d.name order by d.name), '[]'::jsonb) from public.departments d) else jsonb_build_array(v_dept) end,
    'designations', (select coalesce(jsonb_agg(jsonb_build_object('name', d.name, 'rank', d.rank, 'default_role', d.default_role) order by d.rank, d.name), '[]'::jsonb)
                       from public.designations d where d.active and (v_all or d.rank > v_rank)));
end $$;

create or replace function public.designation_add(p_name text, p_level_with text) returns jsonb
language plpgsql security definer set search_path = public, app, pg_temp as $$
declare v text := regexp_replace(btrim(coalesce(p_name, '')), '\s+', ' ', 'g'); v_rank int; v_role text;
begin
  if not (app.is_admin() or app.has_role('hr_admin')) then raise exception 'Only HR/Admin can add a designation.' using errcode = '42501'; end if;
  if length(v) < 2 then raise exception 'Give the designation a name.' using errcode = 'P0001'; end if;
  if exists (select 1 from public.designations where lower(name) = lower(v)) then raise exception 'That designation already exists.' using errcode = 'P0001'; end if;
  select rank, case when default_role in ('zm','bm','ba') then case when rank <= 14 then 'manager' else 'executive' end else default_role end into v_rank, v_role
    from public.designations where name = p_level_with;
  if v_rank is null then raise exception 'Pick the existing designation it is level with.' using errcode = 'P0001'; end if;
  insert into public.designations(name, rank, default_role, created_by) values (v, v_rank, v_role, app.me());
  return jsonb_build_object('name', v, 'rank', v_rank);
end $$;

-- add a person with a department. Non-admins always add into their own department.
create or replace function public.add_team_member(p_full_name text, p_email text, p_mobile text, p_resource_type text, p_designation text,
    p_role app.role_code, p_manager_id uuid, p_function app.fn default 'operations', p_valid_from date default null,
    p_zone_id uuid default null, p_branch_id uuid default null, p_department text default null) returns public.persons
language plpgsql security definer set search_path = public, app, pg_temp as $$
declare v_p public.persons; v_dept text;
begin
  v_dept := case when app.is_admin() or app.has_role('hr_admin') then nullif(btrim(coalesce(p_department, '')), '') else app.person_department(app.me()) end;
  if v_dept is not null and not exists (select 1 from public.departments where name = v_dept) then
    raise exception 'Unknown department. Add it under Admin → KPIs → Departments first.' using errcode = 'P0002'; end if;
  v_p := public.create_team_member(p_full_name, p_email, p_mobile, p_resource_type, p_designation, p_role, p_manager_id, p_function, p_valid_from, p_zone_id, p_branch_id);
  if v_dept is not null then
    perform set_config('app.reason', 'department set', true);
    update public.persons set department = v_dept where id = v_p.id returning * into v_p;
  end if;
  return v_p;
end $$;

grant execute on function public.designation_options(), public.designation_add(text, text),
  public.add_team_member(text, text, text, text, text, app.role_code, uuid, app.fn, date, uuid, uuid, text) to authenticated;
