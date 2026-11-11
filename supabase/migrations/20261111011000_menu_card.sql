-- D-124  The complete menu card: every menu entry and Admin section, per role (Shown / Hidden).
-- Hide-only, as before: it never hands a page to a role that does not have it built in.

create table if not exists public.access_pages (
  key text primary key,
  label text not null,
  section text not null,
  description text not null,
  sort int not null,
  base_roles text[],          -- roles that have this page built in; null = every role
  base_note text              -- when set, other roles can still get the page (the note says when)
);
alter table public.access_pages enable row level security;
revoke all on public.access_pages from anon, authenticated;

insert into public.access_pages (key, label, section, description, sort, base_roles, base_note) values
  ('plan',       'My plan & check-in', 'My work', 'Morning check-in and the day''s plan.', 10, '{executive,manager,bm,ba,zm,ops_head,collections_head,product_head}', null),
  ('chat',       'Chat',               'My work', 'Direct and team chat, and the help desks.', 20, null, null),
  ('tasks',      'Tasks & misses',     'My work', 'Tasks assigned to or by the person, and their misses.', 30, null, null),
  ('attendance', 'Attendance & leave', 'My work', 'Own attendance, leave requests and, for managers, the team board.', 40, null, null),
  ('kpis',       'KPIs & attributes',  'My work', 'Own KPIs and attributes; for managers, setting them for the team.', 50, '{manager,bm,ba,zm,ops_head,collections_head,hr_admin,admin}', 'Other roles get “My KPIs” once KPIs are assigned to them.'),
  ('team',       'My team',            'Team', 'Today''s review, certifying the team, and adding or editing team members.', 110, '{manager,bm,ba,zm,ops_head,collections_head,hr_admin,admin}', 'Other roles get it only when people report to them.'),
  ('reviews',    'Reviews & scores',   'Team', 'Scoring the team and weekly reviews. A person''s own “My review” link stays.', 120, '{manager,bm,ba,zm,ops_head,collections_head,hr_admin,admin}', 'Other roles get it only when people report to them.'),
  ('targets',    'Targets',            'Team', 'The Targets page (team targets and achievement).', 130, null, null),
  ('payroll',    'Payroll / My pay statement', 'Team', 'HR and Admin run payroll here; everyone else sees their own pay statement.', 140, null, null),
  ('penalties',  'Penalties',          'Team', 'Penalty rules and proposed penalties.', 150, null, null),
  ('tracker',    'Zonal Tracker',      'Reports', 'The live zone-wise monthly business tracker.', 210, null, null),
  ('status',     'Revenue Status',     'Reports', 'Revenue against target by zone and branch.', 220, null, null),
  ('live',       'Daily submissions',  'Reports', 'Who has and has not submitted today.', 230, null, null),
  ('history',    'History',            'Reports', 'Past months of the tracker.', 240, null, null),
  ('attrition',  'Attrition',          'Reports', 'Joiners and leavers report.', 250, '{admin,hr_admin,ops_head,auditor,leadership}', null),
  ('adm_people',     'Admin · People',                    'Admin', 'Add people, change roles and reporting, across the company.', 310, '{hr_admin,admin}', null),
  ('adm_compliance', 'Admin · HR repository',             'Admin', 'Everyone''s HR documents and compliance status.', 320, '{hr_admin,admin}', null),
  ('adm_quality',    'Admin · Data quality',              'Admin', 'Profile gaps and data problems across people.', 330, '{hr_admin,admin}', null),
  ('adm_usage',      'Admin · App usage report',          'Admin', 'Who uses the app, how much and when.', 340, '{hr_admin,admin}', null),
  ('adm_kpis',       'Admin · KPIs',                      'Admin', 'KPI library, departments, who has what, roll-up.', 350, '{hr_admin,admin}', null),
  ('adm_locations',  'Admin · Locations & heads',         'Admin', 'Locations and who heads them.', 360, '{hr_admin,admin}', null),
  ('adm_upload',     'Admin · Bulk upload',               'Admin', 'Upload people, rates and trackers from Excel.', 370, '{hr_admin,admin}', null),
  ('adm_policy',     'Admin · Leave, holidays & policies','Admin', 'Leave rules, holiday list and policy documents.', 380, '{hr_admin,admin}', null),
  ('adm_log',        'Activity log (read only)',          'Admin', 'The record of every change, with who made it and when.', 390, '{auditor,leadership,admin}', null)
on conflict (key) do update set label = excluded.label, section = excluded.section, description = excluded.description,
  sort = excluded.sort, base_roles = excluded.base_roles, base_note = excluded.base_note;

insert into public.access_rules (area, role, level, locked)
select 'page:' || a.key, r.role, 'all', r.role = 'admin'
from public.access_pages a
cross join (values ('executive'),('manager'),('ba'),('bm'),('zm'),('ops_head'),('collections_head'),('product_head'),('hr_admin'),('auditor'),('leadership'),('ea'),('admin')) r(role)
on conflict (area, role) do nothing;

-- Hidden for me? Only the roles that carry the page count; if none of my roles carries it (I get it some other way,
-- e.g. an executive with people reporting to them) every role of mine counts. Admin is never hidden.
create or replace function app.page_hidden(p_page text) returns boolean
language sql stable security definer set search_path = public, app, pg_temp as $$
  with mine as (select ra.role::text as role from public.role_assignments ra where ra.person_id = app.me() and ra.valid @> app.today()),
       pg as (select (select base_roles from public.access_pages where key = p_page) as br),
       counted as (select m.role from mine m, pg
                    where pg.br is null or m.role = any (pg.br) or not exists (select 1 from mine x where x.role = any (pg.br)))
  select not app.is_admin()
     and exists (select 1 from counted)
     and not exists (select 1 from counted c left join public.access_rules r on r.area = 'page:' || p_page and r.role = c.role
                      where coalesce(r.level, 'all') <> 'self');
$$;

create or replace function app.hidden_pages() returns jsonb
language sql stable security definer set search_path = public, app, pg_temp as $$
  select coalesce(jsonb_agg(p.key order by p.sort), '[]'::jsonb) from public.access_pages p where app.page_hidden(p.key);
$$;

-- the same check at the top of the function behind each newly listed page
do $mig$
declare r record; f text; o text; g text;
begin
  for r in select v.page, p.oid from (values
      ('kpis', 'my_kpis'), ('reviews', 'team_scores'), ('payroll', 'payroll_sheet'), ('tasks', 'my_tasks'), ('chat', 'chat_threads'),
      ('adm_compliance', 'hr_repository'), ('adm_quality', 'data_quality'), ('adm_usage', 'usage_report'), ('adm_usage', 'adoption_report')) v(page, fn)
      join pg_proc p on p.proname = v.fn and p.pronamespace = 'public'::regnamespace
      join pg_language l on l.oid = p.prolang and l.lanname = 'plpgsql' loop   -- plain-SQL functions are left alone (menu and page still hide)
    f := pg_get_functiondef(r.oid); o := f;
    if position('app.page_hidden' in f) > 0 then continue; end if;
    g := E'\nbegin\n  if app.page_hidden(''' || r.page || E''') then raise exception ''This page is turned off for your role.'' using errcode = ''42501''; end if;\n';
    f := regexp_replace(f, E'\nbegin\n', g);
    if f = o then raise exception 'page guard anchor not found in %', r.oid::regprocedure; end if;
    execute f;
  end loop;
end $mig$;

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
    'pages', (select jsonb_agg(jsonb_build_object('key', 'page:' || p.key, 'label', p.label, 'section', p.section, 'description', p.description,
                 'base_roles', to_jsonb(p.base_roles), 'base_note', p.base_note) order by p.sort) from public.access_pages p),
    'roles', (select jsonb_agg(jsonb_build_object('code', r.role, 'label', r.label,
                 'people', (select count(distinct ra.person_id) from public.role_assignments ra join public.persons p on p.id = ra.person_id and p.status <> 'exited'
                             where ra.role::text = r.role and ra.valid @> app.today())) order by r.ord)
                from (values ('executive','Executive',1),('ba','Business Associate',2),('manager','Manager',3),('bm','Branch Manager',4),('zm','Zonal Manager',5),
                             ('ops_head','Operations Head',6),('collections_head','Collections Head',7),('product_head','Product Head',8),
                             ('hr_admin','HR',9),('auditor','Auditor',10),('leadership','Leadership',11),('ea','Executive Assistant',12),('admin','Admin',13)) r(role, label, ord)),
    'rules', (select jsonb_agg(jsonb_build_object('area', a.area, 'role', a.role, 'level', a.level, 'locked', a.locked,
                 'by', (select full_name from public.persons where id = a.updated_by), 'at', a.updated_at)) from public.access_rules a));
end $$;
