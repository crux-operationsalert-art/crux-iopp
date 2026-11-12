-- D-135  Structure: Assistant Vice President; designations by department; an Assistant Branch Manager works as the
-- assistant of their Branch Manager (the same arrangement an Executive Assistant has with a leader).

-- AVP is Assistant Vice President here
insert into public.designations (name, rank, short, default_role)
select 'Assistant Vice President', rank, short, default_role from public.designations where name = 'Associate Vice President'
on conflict (name) do nothing;
update public.designations set active = false, short = null where name = 'Associate Vice President';
select set_config('app.reason', 'designation renamed: Assistant Vice President (D-135)', true);
update public.persons set designation = 'Assistant Vice President' where designation = 'Associate Vice President';
update public.persons set designation = 'Executive' where designation = 'Execative';

insert into public.designations (name, rank, short, default_role) values
  ('Executive Assistant', 16, 'EA', 'executive'),
  ('Field Executive', 17, null, 'executive'), ('Verification Executive', 17, null, 'executive'), ('Back Office Executive', 17, null, 'executive'),
  ('Collections Manager', 12, null, 'manager'), ('Collections Team Leader', 15, null, 'executive'), ('Collections Executive', 17, null, 'executive'),
  ('Key Account Manager', 12, null, 'manager'), ('Business Development Executive', 17, null, 'executive'),
  ('HR Manager', 12, null, 'manager'), ('HR Business Partner', 13, null, 'manager'), ('HR Executive', 17, null, 'executive'), ('Recruiter', 17, null, 'executive'),
  ('Finance Manager', 12, null, 'manager'), ('Accounts Manager', 12, null, 'manager'), ('Senior Accountant', 16, null, 'executive'), ('Accountant', 17, null, 'executive'),
  ('Accounts Executive', 17, null, 'executive'), ('Billing Executive', 17, null, 'executive'),
  ('MIS Manager', 12, null, 'manager'), ('Senior Analyst', 16, null, 'executive'), ('Data Analyst', 17, null, 'executive'), ('MIS Executive', 17, null, 'executive'),
  ('Quality Manager', 12, null, 'manager'), ('Internal Auditor', 16, null, 'executive'), ('Quality Analyst', 17, null, 'executive'),
  ('Admin Manager', 12, null, 'manager'), ('IT Manager', 12, null, 'manager'), ('IT Executive', 17, null, 'executive'), ('Admin Executive', 17, null, 'executive'), ('Office Assistant', 18, null, 'executive'),
  ('Communications Manager', 12, null, 'manager'), ('Communications Executive', 17, null, 'executive')
on conflict (name) do nothing;

-- which designations belong to which department. A designation with no department listed is common to all.
create table if not exists public.designation_departments (
  designation text not null references public.designations(name) on update cascade,
  department text not null references public.departments(name) on update cascade,
  active boolean not null default true,
  primary key (designation, department)
);
alter table public.designation_departments enable row level security;
revoke all on public.designation_departments from anon, authenticated;

insert into public.designation_departments (designation, department)
select v.designation, d.name from (values
  ('National Head', 'Operations'), ('Zonal Manager', 'Operations'), ('Branch Manager', 'Operations'), ('Assistant Branch Manager', 'Operations'), ('Team Manager', 'Operations'),
  ('Associate Manager', 'Operations'), ('Team Leader', 'Operations'), ('Client Coordinator', 'Operations'), ('Project Coordinator', 'Operations'),
  ('Field Executive', 'Operations'), ('Verification Executive', 'Operations'), ('Back Office Executive', 'Operations'), ('Business Associate', 'Operations'),
  ('Collections Manager', 'Collections'), ('Collections Team Leader', 'Collections'), ('Collections Executive', 'Collections'),
  ('Product Head', 'Business Development'), ('Business Development Manager', 'Business Development'), ('Key Account Manager', 'Business Development'), ('Business Development Executive', 'Business Development'),
  ('HR Manager', 'Human Resources'), ('HR Business Partner', 'Human Resources'), ('HR Executive', 'Human Resources'), ('Recruiter', 'Human Resources'),
  ('Finance Manager', 'Finance & Accounts'), ('Accounts Manager', 'Finance & Accounts'), ('Senior Accountant', 'Finance & Accounts'), ('Accountant', 'Finance & Accounts'),
  ('Accounts Executive', 'Finance & Accounts'), ('Billing Executive', 'Finance & Accounts'),
  ('MIS Manager', 'Business Intelligence & Growth'), ('Senior Analyst', 'Business Intelligence & Growth'), ('Data Analyst', 'Business Intelligence & Growth'), ('MIS Executive', 'Business Intelligence & Growth'),
  ('Quality Manager', 'Quality & Audit'), ('Internal Auditor', 'Quality & Audit'), ('Quality Analyst', 'Quality & Audit'),
  ('Admin Manager', 'Administration & IT'), ('IT Manager', 'Administration & IT'), ('IT Executive', 'Administration & IT'), ('Admin Executive', 'Administration & IT'), ('Office Assistant', 'Administration & IT'),
  ('Communications Manager', 'Business Communications'), ('Communications Manager', 'Business Communication'),
  ('Communications Executive', 'Business Communications'), ('Communications Executive', 'Business Communication')) v(designation, department)
join public.departments d on d.name = v.department
on conflict do nothing;

create or replace function app.designation_fits(p_designation text, p_department text) returns boolean
language sql stable security definer set search_path = public, app, pg_temp as $$
  select coalesce(p_department, '') = ''
      or not exists (select 1 from public.designation_departments m where m.designation = p_designation and m.active)
      or exists (select 1 from public.designation_departments m where m.designation = p_designation and m.department = p_department and m.active);
$$;

-- what the add-person form may offer: every designation carries the departments it belongs to (empty = all)
create or replace function public.designation_options() returns jsonb
language plpgsql stable security definer set search_path = public, app, pg_temp as $$
declare v_all boolean := app.is_admin() or app.has_role('hr_admin'); v_rank int := app.person_rank(app.me()); v_dept text := app.person_department(app.me());
begin
  if app.me() is null then raise exception 'Not signed in' using errcode = '28000'; end if;
  return jsonb_build_object('admin', v_all, 'my_department', v_dept,
    'departments', case when v_all then (select coalesce(jsonb_agg(d.name order by d.name), '[]'::jsonb) from public.departments d) else jsonb_build_array(v_dept) end,
    'designations', (select coalesce(jsonb_agg(jsonb_build_object('name', d.name, 'rank', d.rank, 'default_role', d.default_role,
                         'departments', (select coalesce(jsonb_agg(m.department order by m.department), '[]'::jsonb) from public.designation_departments m where m.designation = d.name and m.active))
                       order by d.rank, d.name), '[]'::jsonb)
                       from public.designations d where d.active and (v_all or (d.rank > v_rank and app.designation_fits(d.name, v_dept)))));
end $$;

create or replace function public.designation_map_set(p_designation text, p_department text, p_on boolean) returns void
language plpgsql security definer set search_path = public, app, pg_temp as $$
begin
  if not app.is_hr() then raise exception 'Only HR/Admin can change designations.' using errcode = '42501'; end if;
  insert into public.designation_departments(designation, department, active) values (p_designation, p_department, p_on)
  on conflict (designation, department) do update set active = excluded.active;
exception when foreign_key_violation then raise exception 'Unknown designation or department.' using errcode = 'P0002';
end $$;

-- a manager adding a person stays inside their own department's designations (Admin/HR are free)
do $mig$
declare f text := pg_get_functiondef('app.check_designation(text,uuid)'::regprocedure); o text := f;
begin
  if position('designation_fits' in f) = 0 then
    f := replace(f, '  if v_rank <= app.person_rank(app.me()) then',
      E'  if not app.designation_fits((select name from public.designations where lower(name) = lower(btrim(p_designation))), app.person_department(app.me())) then\n    raise exception ''That designation belongs to another department.'' using errcode = ''42501''; end if;\n  if v_rank <= app.person_rank(app.me()) then');
    if f = o then raise exception 'check_designation anchor not found'; end if; execute f;
  end if;
end $mig$;

-- An Assistant Branch Manager added under a Branch Manager becomes that manager's assistant: they see what the Branch
-- Manager sees and can assign tasks on their behalf, and remain a manager for their own work and team.
create or replace function app.link_assistant(p_person uuid) returns void
language plpgsql security definer set search_path = public, app, pg_temp as $$
declare v_bm uuid;
begin
  if not exists (select 1 from public.persons where id = p_person and designation ilike '%assistant branch manager%') then return; end if;
  select r.manager_id into v_bm from public.reporting_lines r join public.persons m on m.id = r.manager_id
   where r.person_id = p_person and r.valid @> app.today() and (m.designation ilike 'branch manager%' or exists (
           select 1 from public.role_assignments ra where ra.person_id = m.id and ra.role = 'bm' and ra.valid @> app.today()))
   order by (r.function = 'operations') desc limit 1;
  if v_bm is null or exists (select 1 from public.ea_assignments e where e.ea_person = p_person and e.principal = v_bm and e.valid @> app.today()) then return; end if;
  insert into public.ea_assignments(ea_person, principal, valid, reason) values (p_person, v_bm, daterange(app.today(), null), 'Assistant Branch Manager of this Branch Manager');
end $$;

do $mig$
declare f text := pg_get_functiondef('public.add_team_member(text,text,text,text,text,app.role_code,uuid,app.fn,date,uuid,uuid,text)'::regprocedure); o text := f;
begin
  if position('app.link_assistant' in f) = 0 then
    f := replace(f, '  return v_p;', E'  perform app.link_assistant(v_p.id);\n  return v_p;');
    if f = o then raise exception 'add_team_member anchor not found'; end if; execute f;
  end if;
end $mig$;
grant execute on function public.designation_map_set(text, text, boolean) to authenticated;
