-- D-120  Scorecards: reporting managers set 3–5 KPIs and 3–5 attributes per person from a
-- department library (operations & collections included as the worked example, fed automatically
-- from daily updates). Targets default to "for the month" but the manager picks the basis and the
-- direction. New KPIs get a standard system-built name so the catalogue stays uniform.

alter table public.persons add column if not exists department text;
alter table public.kpi_catalogue add column if not exists description text;
alter table public.kpi_catalogue add column if not exists levels text[] not null default '{}';
alter table public.kpi_catalogue add column if not exists metric text;
alter table public.kpi_catalogue add column if not exists system boolean not null default false;
alter table public.kpi_assignment add column if not exists cadence text check (cadence in ('daily','weekly','monthly'));
alter table public.kpi_assignment add column if not exists higher_better boolean;
alter table public.monthly_scores add column if not exists attr_scores jsonb;
alter table public.monthly_scores add column if not exists self_attr_scores jsonb;

create table if not exists public.attribute_catalogue (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  description text,
  levels text[] not null default '{}',
  active boolean not null default true
);
create table if not exists public.person_attributes (
  id uuid primary key default gen_random_uuid(),
  person_id uuid not null references public.persons(id),
  attribute_id uuid not null references public.attribute_catalogue(id),
  valid daterange not null default daterange(current_date, null),
  created_by uuid references public.persons(id),
  exclude using gist (person_id with =, attribute_id with =, valid with &&)
);
create index if not exists person_attributes_person on public.person_attributes (person_id);
alter table public.attribute_catalogue enable row level security;
alter table public.person_attributes enable row level security;
revoke all on public.attribute_catalogue, public.person_attributes from anon, authenticated;

-- ---------------------------------------------------------------- library (seed)
insert into public.kpi_catalogue (department, name, unit, cadence, higher_better, levels, metric, description, system)
select v.* , true from (values
  ('Operations','Cases Entered – Volume','nos','monthly',true,array['executive','lead'],'entry','Cases entered in daily updates. Counted automatically.'),
  ('Operations','Cases Closed – Volume','nos','monthly',true,array['executive','lead','manager'],'closure','Cases closed in daily updates. Counted automatically (a manager''s figure includes the team).'),
  ('Operations','Net Cases Actioned – Volume','nos','monthly',true,array['executive','lead'],'net_actioned','Net cases actioned in daily updates. Counted automatically.'),
  ('Operations','Revenue Billed – Value (₹)','₹','monthly',true,array['lead','manager','head'],'revenue','Revenue from closed cases at the client rate. Counted automatically.'),
  ('Operations','Cases Closed Within TAT – Rate %','%','monthly',true,array['executive','lead','manager','head'],null,'Share of cases closed inside the client''s turnaround time.'),
  ('Operations','Quality Errors – Rate %','%','monthly',false,array['executive','lead'],null,'Share of reports returned or corrected for errors.'),
  ('Operations','Pending Cases Over 15 Days – Volume','nos','monthly',false,array['manager','head'],null,'Cases still open beyond 15 days at month end.'),
  ('Operations','Client Escalations – Volume','nos','monthly',false,array['lead','manager','head'],null,'Escalations raised by clients in the month.'),
  ('Operations','Team Reporting On Time – Rate %','%','monthly',true,array['manager','head'],null,'Share of the team''s daily updates submitted before the deadline.'),
  ('Operations','Field Visits Completed – Volume','nos','monthly',true,array['executive'],null,'Verification visits completed in the field.'),
  ('Collections','Collections Received – Value (₹)','₹','monthly',true,array['executive','lead','manager','head'],'collections_received','Money received against bills. Counted automatically.'),
  ('Collections','Collections Reconciled – Value (₹)','₹','monthly',true,array['executive','lead','manager'],'collections_reconciled','Receipts matched to bills. Counted automatically.'),
  ('Collections','Bills Raised – Volume','nos','monthly',true,array['executive','lead'],'bill_count','Bills raised in the month. Counted automatically.'),
  ('Collections','Bills Raised – Value (₹)','₹','monthly',true,array['lead','manager','head'],'bill_amount','Value of bills raised. Counted automatically.'),
  ('Collections','Receivables Over 90 Days – Value (₹)','₹','monthly',false,array['manager','head'],null,'Outstanding older than 90 days at month end.'),
  ('Collections','Follow-ups Completed – Volume','nos','monthly',true,array['executive','lead'],null,'Client follow-ups made for payment.'),
  ('Collections','Collection Efficiency – Rate %','%','monthly',true,array['lead','manager','head'],null,'Collected in the month as a share of what was due.'),
  ('Collections','Disputed Bills Resolved – Volume','nos','monthly',true,array['executive','lead','manager'],null,'Bill disputes closed with the client.'),
  ('Business Development','New Clients Signed – Volume','nos','monthly',true,array['manager','head'],null,'New client agreements signed.'),
  ('Business Development','New Business Booked – Value (₹)','₹','monthly',true,array['manager','head'],null,'Expected monthly billing from business won.'),
  ('Business Development','Proposals Submitted – Volume','nos','monthly',true,array['executive','lead','manager'],null,'Proposals or empanelment bids submitted.'),
  ('Business Development','Client Meetings Held – Volume','nos','monthly',true,array['executive','lead','manager'],null,'Meetings with prospects and clients.'),
  ('Business Development','Lead Conversion – Rate %','%','monthly',true,array['lead','manager','head'],null,'Leads converted to signed business.'),
  ('Business Development','Client Retention – Rate %','%','monthly',true,array['manager','head'],null,'Existing clients retained.'),
  ('Business Development','Product Revenue – Value (₹)','₹','monthly',true,array['head'],null,'Revenue of the product or client line owned.'),
  ('Human Resources','Positions Closed – Volume','nos','monthly',true,array['executive','lead','manager'],null,'Open positions filled.'),
  ('Human Resources','Hiring – Turnaround Time','days','monthly',false,array['lead','manager','head'],null,'Average days from requisition to joining.'),
  ('Human Resources','Attrition – Rate %','%','monthly',false,array['manager','head'],null,'People who left as a share of headcount.'),
  ('Human Resources','Onboarding Documents Completed – Rate %','%','monthly',true,array['executive','lead'],null,'New joiners with complete, verified documents.'),
  ('Human Resources','Payroll Accuracy – Rate %','%','monthly',true,array['executive','lead','manager'],null,'Salaries processed without correction.'),
  ('Human Resources','Employee Grievances Resolved – Rate %','%','monthly',true,array['lead','manager','head'],null,'Grievances closed within the agreed time.'),
  ('Human Resources','Training Sessions Conducted – Volume','nos','monthly',true,array['executive','lead','manager'],null,'Training or induction sessions run.'),
  ('Finance & Accounts','Invoices Processed – Volume','nos','monthly',true,array['executive','lead'],null,'Client or vendor invoices processed.'),
  ('Finance & Accounts','Invoice Accuracy – Rate %','%','monthly',true,array['executive','lead','manager'],null,'Invoices issued without revision.'),
  ('Finance & Accounts','Vendor Payments On Time – Rate %','%','monthly',true,array['executive','lead','manager'],null,'Vendor and partner payments made by the due date.'),
  ('Finance & Accounts','Month Close – Turnaround Time','days','monthly',false,array['manager','head'],null,'Days taken to close the books after month end.'),
  ('Finance & Accounts','Bank Reconciliations Completed – Rate %','%','monthly',true,array['executive','lead'],null,'Bank accounts reconciled for the month.'),
  ('Finance & Accounts','Statutory Filings On Time – Rate %','%','monthly',true,array['lead','manager','head'],null,'GST, TDS, PF and other filings made on time.'),
  ('Business Intelligence & Growth','Reports Delivered On Time – Rate %','%','monthly',true,array['executive','lead','manager'],null,'MIS and reports delivered by the agreed time.'),
  ('Business Intelligence & Growth','Report Accuracy – Rate %','%','monthly',true,array['executive','lead','manager'],null,'Reports issued without correction.'),
  ('Business Intelligence & Growth','Dashboards Delivered – Volume','nos','monthly',true,array['executive','lead'],null,'New dashboards or automated reports delivered.'),
  ('Business Intelligence & Growth','Data Requests – Turnaround Time','hours','monthly',false,array['executive','lead'],null,'Average hours to answer a data request.'),
  ('Business Intelligence & Growth','Process Improvements Implemented – Volume','nos','monthly',true,array['lead','manager','head'],null,'Improvements put into practice.'),
  ('Business Intelligence & Growth','Automation Hours Saved – Volume','hours','monthly',true,array['manager','head'],null,'Working hours saved through automation.'),
  ('Quality & Audit','Audits Completed – Volume','nos','monthly',true,array['executive','lead','manager'],null,'Branch, process or sample audits completed.'),
  ('Quality & Audit','Audit Findings Closed – Rate %','%','monthly',true,array['lead','manager','head'],null,'Findings closed by their due date.'),
  ('Quality & Audit','Sample Checks Completed – Volume','nos','monthly',true,array['executive','lead'],null,'Case samples re-checked for quality.'),
  ('Quality & Audit','Repeat Findings – Rate %','%','monthly',false,array['manager','head'],null,'Findings that recur after closure.'),
  ('Quality & Audit','Audit Reports – Turnaround Time','days','monthly',false,array['executive','lead','manager'],null,'Days from audit to issued report.'),
  ('Administration & IT','Support Tickets Resolved – Volume','nos','monthly',true,array['executive','lead'],null,'IT or admin requests resolved.'),
  ('Administration & IT','Ticket Resolution – Turnaround Time','hours','monthly',false,array['executive','lead','manager'],null,'Average hours to resolve a request.'),
  ('Administration & IT','System Uptime – Rate %','%','monthly',true,array['lead','manager','head'],null,'Availability of key systems.'),
  ('Administration & IT','Asset Records Accuracy – Rate %','%','monthly',true,array['executive','lead'],null,'Assets matching the register at check.'),
  ('Administration & IT','Vendor Bills Verified – Volume','nos','monthly',true,array['executive','lead','manager'],null,'Vendor bills checked before payment.')
) as v(department, name, unit, cadence, higher_better, levels, metric, description)
where not exists (select 1 from public.kpi_catalogue k where k.department = v.department and lower(k.name) = lower(v.name));

insert into public.attribute_catalogue (name, description, levels)
select v.* from (values
  ('Ownership & Accountability','Takes responsibility for results and closes what they start.',array['executive','lead','manager','head']),
  ('Discipline & Punctuality','On time, follows process, keeps commitments.',array['executive','lead']),
  ('Quality of Work','Accurate, complete work that rarely needs rework.',array['executive','lead','manager']),
  ('Teamwork & Collaboration','Helps colleagues and works well across teams.',array['executive','lead','manager','head']),
  ('Communication','Clear, timely updates to team, managers and clients.',array['executive','lead','manager','head']),
  ('Client Focus','Understands client needs and responds quickly.',array['executive','lead','manager','head']),
  ('Integrity & Compliance','Honest, follows policy, protects data.',array['executive','lead','manager','head']),
  ('Initiative & Problem Solving','Spots problems early and proposes fixes.',array['executive','lead','manager']),
  ('Learning & Adaptability','Picks up new work and adapts to change.',array['executive','lead']),
  ('Planning & Time Management','Plans the day and month, prioritises well.',array['lead','manager','head']),
  ('People Development','Coaches the team and builds capability.',array['manager','head']),
  ('Decision Making','Makes sound, timely decisions with the facts available.',array['manager','head']),
  ('Leadership & Results','Sets direction and delivers through others.',array['head'])
) as v(name, description, levels)
where not exists (select 1 from public.attribute_catalogue a where a.name = v.name);

-- ---------------------------------------------------------------- helpers
create or replace function app.person_level(p_person uuid) returns text
language sql stable security definer set search_path = public, app, pg_temp as $$
  select case
    when p.designation ~* '(head|vice president|\mvp\M|\mavp\M|director|chairman|national)' then 'head'
    when p.designation ~* '(manager|zonal)' or exists (select 1 from public.role_assignments r where r.person_id = p.id
           and r.role in ('zm','bm','manager','ops_head','collections_head','product_head') and r.valid @> app.today()) then 'manager'
    when p.designation ~* '(lead|coordinator|senior|supervisor)' then 'lead'
    else 'executive' end
  from public.persons p where p.id = p_person;
$$;

create or replace function app.person_department(p_person uuid) returns text
language sql stable security definer set search_path = public, app, pg_temp as $$
  select coalesce(p.department, case
    when p.designation ~* 'collection' then 'Collections'
    when p.designation ~* '(\mhr\M|human)' then 'Human Resources'
    when p.designation ~* '(business development|product head)' then 'Business Development'
    when p.designation ~* '(business intelligence|\mmis\M)' then 'Business Intelligence & Growth'
    when p.designation ~* '(finance|account)' then 'Finance & Accounts'
    when p.designation ~* '(audit|quality)' then 'Quality & Audit'
    when p.designation ~* '(\mit\M|admin)' then 'Administration & IT'
    when exists (select 1 from public.reporting_lines r where r.person_id = p.id and r.function = 'collections' and r.valid @> app.today())
     and not exists (select 1 from public.reporting_lines r where r.person_id = p.id and r.function = 'operations' and r.valid @> app.today()) then 'Collections'
    else 'Operations' end)
  from public.persons p where p.id = p_person;
$$;

create or replace function app.can_setup_scorecard(p_person uuid) returns boolean
language sql stable security definer set search_path = public, app, pg_temp as $$
  select app.can_manage_kpis() or exists (select 1 from public.reporting_lines r
           where r.person_id = p_person and r.manager_id = app.me() and r.valid @> app.today());
$$;

-- One uniform name for any new KPI: "<What is measured> – <how it is measured>".
create or replace function app.kpi_std_name(p_subject text, p_measure text) returns text
language plpgsql immutable as $$
declare s text := lower(btrim(coalesce(p_subject, ''))); w text;
begin
  s := regexp_replace(s, '[^a-z0-9 &/]+', ' ', 'g');
  s := regexp_replace(s, '\s+', ' ', 'g');
  s := regexp_replace(btrim(s), '^(the |a )?(number of|no of|nos of|count of|total|percentage of|percent of|rate of|time taken to|time taken for|time to|tat of|tat for|value of|amount of|score of|rating of) ', '');
  s := regexp_replace(btrim(s), ' (count|volume|rate|percentage|percent|tat|turnaround time|value|amount|score|rating|numbers?)$', '');
  s := initcap(btrim(s));
  foreach w in array array['Kyc','Tat','Mis','Hr','It','Gst','Tds','Sla','Bom','Sbi','Msme','Pf','Esic','Ba','Pan','Emi','Npa','Crm','Kpi'] loop
    s := regexp_replace(s, '\m' || w || '\M', upper(w), 'g');
  end loop;
  s := left(s, 60);
  return s || case p_measure when 'count' then ' – Volume' when 'percent' then ' – Rate %' when 'time' then ' – Turnaround Time'
                             when 'amount' then ' – Value (₹)' when 'rating' then ' – Quality Score' end;
end $$;

-- ---------------------------------------------------------------- add a KPI that is not in the library
create or replace function public.kpi_custom_add(p_department text, p_subject text, p_measure text,
    p_time_unit text default 'days', p_preview boolean default false) returns jsonb
language plpgsql security definer set search_path = public, app, pg_temp as $$
declare v_name text; v_unit text; v_hb boolean; v_id uuid; v_new boolean := false;
begin
  if not (app.can_manage_kpis() or exists (select 1 from public.reporting_lines r where r.manager_id = app.me() and r.valid @> app.today())) then
    raise exception 'Only reporting managers and HR/Admin can add KPIs.' using errcode = '42501'; end if;
  if p_measure not in ('count','percent','time','amount','rating') then raise exception 'Pick how it is measured.' using errcode = '22023'; end if;
  if coalesce(btrim(p_department), '') = '' then raise exception 'Pick the department.' using errcode = 'P0001'; end if;
  v_name := app.kpi_std_name(p_subject, p_measure);
  if length(split_part(v_name, ' – ', 1)) < 3 then raise exception 'Say what is being measured, in a few words.' using errcode = 'P0001'; end if;
  v_unit := case p_measure when 'count' then 'nos' when 'percent' then '%' when 'amount' then '₹' when 'rating' then '/10'
                           else case when p_time_unit = 'hours' then 'hours' else 'days' end end;
  v_hb := p_measure <> 'time';
  select id into v_id from public.kpi_catalogue k where k.department = btrim(p_department) and lower(k.name) = lower(v_name) limit 1;
  if v_id is null and not p_preview then
    insert into public.kpi_catalogue(department, name, unit, cadence, higher_better, created_by)
    values (btrim(p_department), v_name, v_unit, 'monthly', v_hb, app.me()) returning id into v_id;
    v_new := true;
  end if;
  return jsonb_build_object('kpi_id', v_id, 'name', v_name, 'unit', v_unit, 'higher_better', v_hb, 'exists', v_id is not null and not v_new);
end $$;

-- ---------------------------------------------------------------- the manager's setup screens
create or replace function public.scorecard_team() returns jsonb
language plpgsql stable security definer set search_path = public, app, pg_temp as $$
declare v_me uuid := app.me(); v_hr boolean := app.can_manage_kpis();
begin
  if v_me is null then raise exception 'Not signed in' using errcode = '28000'; end if;
  return jsonb_build_object('hr_view', v_hr, 'rows', (
    select coalesce(jsonb_agg(jsonb_build_object('person_id', p.id, 'full_name', p.full_name, 'designation', p.designation,
             'department', app.person_department(p.id), 'kpis', x.k, 'attributes', x.a,
             'ready', x.k between 3 and 5 and x.a between 3 and 5) order by p.full_name), '[]'::jsonb)
      from public.persons p
      cross join lateral (select
         (select count(*) from public.kpi_assignment a join public.kpi_catalogue k on k.id = a.kpi_id and k.active where a.person_id = p.id and a.valid @> app.today())::int k,
         (select count(*) from public.person_attributes a where a.person_id = p.id and a.valid @> app.today())::int a) x
     where p.status <> 'exited' and p.id <> v_me
       and (v_hr or exists (select 1 from public.reporting_lines r where r.person_id = p.id and r.manager_id = v_me and r.valid @> app.today()))));
end $$;

create or replace function public.scorecard_person(p_person uuid, p_department text default null) returns jsonb
language plpgsql stable security definer set search_path = public, app, pg_temp as $$
declare v_dept text; v_level text := app.person_level(p_person);
begin
  if not app.can_setup_scorecard(p_person) then raise exception 'Only the reporting manager or HR/Admin can set this up.' using errcode = '42501'; end if;
  v_dept := coalesce(nullif(btrim(p_department), ''), app.person_department(p_person));
  return jsonb_build_object(
    'person', (select jsonb_build_object('id', p.id, 'full_name', p.full_name, 'designation', p.designation, 'level', v_level) from public.persons p where p.id = p_person),
    'department', v_dept,
    'departments', (select coalesce(jsonb_agg(distinct k.department), '[]'::jsonb) from public.kpi_catalogue k where k.active),
    'kpis', (select coalesce(jsonb_agg(jsonb_build_object('kpi_id', k.id, 'name', k.name, 'unit', k.unit, 'department', k.department,
               'description', k.description, 'auto', k.metric is not null, 'target', a.target,
               'cadence', coalesce(a.cadence, k.cadence), 'higher_better', coalesce(a.higher_better, k.higher_better)) order by k.name), '[]'::jsonb)
              from public.kpi_assignment a join public.kpi_catalogue k on k.id = a.kpi_id and k.active
             where a.person_id = p_person and a.valid @> app.today()),
    'library', (select coalesce(jsonb_agg(jsonb_build_object('kpi_id', k.id, 'name', k.name, 'unit', k.unit, 'department', k.department,
               'description', k.description, 'auto', k.metric is not null, 'cadence', k.cadence, 'higher_better', k.higher_better,
               'recommended', k.levels = '{}' or v_level = any(k.levels))
               order by (k.levels = '{}' or v_level = any(k.levels)) desc, (k.metric is not null) desc, k.name), '[]'::jsonb)
              from public.kpi_catalogue k where k.active and k.department = v_dept),
    'attributes', (select coalesce(jsonb_agg(a.attribute_id), '[]'::jsonb) from public.person_attributes a where a.person_id = p_person and a.valid @> app.today()),
    'attribute_library', (select coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name, 'description', c.description,
               'recommended', v_level = any(c.levels)) order by (v_level = any(c.levels)) desc, c.name), '[]'::jsonb)
              from public.attribute_catalogue c where c.active));
end $$;

-- Save the whole scorecard at once: 3–5 KPIs with targets and 3–5 attributes. Stays in force until changed.
create or replace function public.scorecard_save(p_person uuid, p_department text, p_kpis jsonb, p_attributes uuid[]) returns jsonb
language plpgsql security definer set search_path = public, app, pg_temp as $$
declare v_me uuid := app.me(); v_today date := app.today(); r record; cur public.kpi_assignment; v_metric text; v_cad text; v_hb boolean; v_ids uuid[];
begin
  if not app.can_setup_scorecard(p_person) then raise exception 'Only the reporting manager or HR/Admin can set this up.' using errcode = '42501'; end if;
  if jsonb_typeof(p_kpis) <> 'array' or jsonb_array_length(p_kpis) not between 3 and 5 then
    raise exception 'Choose 3 to 5 KPIs.' using errcode = 'P0001'; end if;
  if coalesce(cardinality(p_attributes), 0) not between 3 and 5 or (select count(distinct x) from unnest(p_attributes) x) <> cardinality(p_attributes) then
    raise exception 'Choose 3 to 5 attributes.' using errcode = 'P0001'; end if;
  select array_agg((e->>'kpi_id')::uuid) into v_ids from jsonb_array_elements(p_kpis) e;
  if (select count(distinct x) from unnest(v_ids) x) <> cardinality(v_ids) then raise exception 'Each KPI can be chosen once.' using errcode = 'P0001'; end if;
  if exists (select 1 from unnest(v_ids) x where not exists (select 1 from public.kpi_catalogue k where k.id = x and k.active)) then
    raise exception 'One of the KPIs is no longer available.' using errcode = 'P0001'; end if;
  if exists (select 1 from unnest(p_attributes) x where not exists (select 1 from public.attribute_catalogue c where c.id = x and c.active)) then
    raise exception 'One of the attributes is no longer available.' using errcode = 'P0001'; end if;
  if exists (select 1 from jsonb_array_elements(p_kpis) e where coalesce((e->>'target')::numeric, 0) <= 0) then
    raise exception 'Give every KPI a target above zero.' using errcode = 'P0001'; end if;

  perform set_config('app.reason', 'scorecard set up', true);
  if nullif(btrim(coalesce(p_department, '')), '') is not null then
    update public.persons set department = btrim(p_department) where id = p_person and department is distinct from btrim(p_department);
  end if;

  -- KPIs no longer chosen
  update public.kpi_assignment a set valid = daterange(lower(a.valid), v_today)
   where a.person_id = p_person and a.valid @> v_today and not (a.kpi_id = any(v_ids));
  -- chosen KPIs
  for r in select (e->>'kpi_id')::uuid kpi_id, (e->>'target')::numeric target, e->>'cadence' cadence, (e->>'higher_better')::boolean hb
             from jsonb_array_elements(p_kpis) e loop
    select k.metric into v_metric from public.kpi_catalogue k where k.id = r.kpi_id;
    v_cad := case when v_metric is not null then 'monthly' when r.cadence in ('daily','weekly','monthly') then r.cadence else 'monthly' end;
    v_hb := case when v_metric is not null then true else r.hb end;
    select * into cur from public.kpi_assignment a where a.person_id = p_person and a.kpi_id = r.kpi_id and a.valid @> v_today;
    if found then
      if cur.target is not distinct from r.target and cur.cadence is not distinct from v_cad and cur.higher_better is not distinct from v_hb then continue; end if;
      if lower(cur.valid) >= v_today then
        update public.kpi_assignment set target = r.target, cadence = v_cad, higher_better = v_hb where id = cur.id; continue;
      end if;
      update public.kpi_assignment set valid = daterange(lower(valid), v_today) where id = cur.id;
    end if;
    insert into public.kpi_assignment(person_id, kpi_id, target, cadence, higher_better, valid, created_by)
    values (p_person, r.kpi_id, r.target, v_cad, v_hb, daterange(v_today, null), v_me);
  end loop;

  -- attributes
  update public.person_attributes a set valid = daterange(lower(a.valid), v_today)
   where a.person_id = p_person and a.valid @> v_today and not (a.attribute_id = any(p_attributes));
  insert into public.person_attributes(person_id, attribute_id, valid, created_by)
    select p_person, x, daterange(v_today, null), v_me from unnest(p_attributes) x
     where not exists (select 1 from public.person_attributes a where a.person_id = p_person and a.attribute_id = x and a.valid @> v_today);

  if p_person <> v_me then
    insert into public.notifications(person_id, kind, message, link)
    values (p_person, 'task', (select full_name from public.persons where id = v_me) || ' set your KPIs and attributes. Have a look.', '/kpis');
  end if;
  return jsonb_build_object('ok', true);
end $$;

-- HR's single-KPI assign keeps the 5-KPI ceiling too.
create or replace function public.kpi_assign(p_person uuid, p_kpi uuid, p_target numeric default null) returns uuid
language plpgsql security definer set search_path = public, app, pg_temp as $$
declare v_id uuid;
begin
  if not app.can_manage_kpis() then raise exception 'Only HR/Admin can assign KPIs.' using errcode = '42501'; end if;
  if (select count(*) from public.kpi_assignment a where a.person_id = p_person and a.valid @> app.today() and a.kpi_id <> p_kpi) >= 5 then
    raise exception 'A person can hold at most 5 KPIs. Remove one first.' using errcode = 'P0001'; end if;
  update public.kpi_assignment set valid = daterange(lower(valid), current_date) where person_id = p_person and kpi_id = p_kpi and valid @> app.today();
  insert into public.kpi_assignment(person_id, kpi_id, target, valid, created_by)
  values (p_person, p_kpi, p_target, daterange(current_date, null), app.me()) returning id into v_id;
  insert into public.notifications(person_id, kind, message, link)
  values (p_person, 'task', 'A new KPI was assigned to you: ' || (select name from public.kpi_catalogue where id = p_kpi), '/kpis');
  return v_id;
end $$;

-- ---------------------------------------------------------------- the person's view
create or replace function public.my_kpis(p_date date default null) returns jsonb
language plpgsql stable security definer set search_path = public, app, pg_temp as $$
declare v_me uuid := app.me(); v_d date := coalesce(p_date, app.today()); v_m0 date := date_trunc('month', coalesce(p_date, app.today()))::date;
begin
  if v_me is null then raise exception 'Not signed in' using errcode = '28000'; end if;
  return (select coalesce(jsonb_agg(row order by dept, nm), '[]'::jsonb) from (
    select jsonb_build_object('kpi_id', k.id, 'department', k.department, 'name', k.name, 'unit', k.unit, 'description', k.description,
      'cadence', c.cad, 'higher_better', coalesce(a.higher_better, k.higher_better), 'target', a.target, 'auto', k.metric is not null,
      'period', case when k.metric is not null then v_m0 else app.kpi_period(c.cad, v_d) end,
      'planned', e.planned,
      'actual', case when k.metric is not null then app.metric_actual(k.metric, v_m0, v_d, 'person', null, null, v_me, null) else e.actual end,
      'note', e.note,
      'commitment', case when k.metric is not null then case when a.target > 0 then round(100 * app.metric_actual(k.metric, v_m0, v_d, 'person', null, null, v_me, null) / a.target) end
                         when e.planned is not null and e.planned <> 0 then round(100 * e.actual / e.planned) end) as row, k.department as dept, k.name as nm
      from public.kpi_assignment a join public.kpi_catalogue k on k.id = a.kpi_id and k.active
      cross join lateral (select coalesce(a.cadence, k.cadence) cad) c
      left join public.kpi_entry e on e.person_id = a.person_id and e.kpi_id = a.kpi_id and e.period = app.kpi_period(c.cad, v_d)
     where a.person_id = v_me and a.valid @> v_d) s);
end $$;

create or replace function public.my_attributes() returns jsonb
language sql stable security definer set search_path = public, app, pg_temp as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name, 'description', c.description) order by c.name), '[]'::jsonb)
    from public.person_attributes a join public.attribute_catalogue c on c.id = a.attribute_id
   where a.person_id = app.me() and a.valid @> app.today();
$$;

create or replace function public.save_kpi_entry(p_kpi uuid, p_period date, p_planned numeric default null, p_actual numeric default null, p_note text default null) returns jsonb
language plpgsql security definer set search_path = public, app, pg_temp as $$
declare v_me uuid := app.me(); v_cad text; v_metric text; v_period date;
begin
  if v_me is null then raise exception 'Not signed in' using errcode = '28000'; end if;
  select coalesce(a.cadence, k.cadence), k.metric into v_cad, v_metric
    from public.kpi_catalogue k join public.kpi_assignment a on a.kpi_id = k.id and a.person_id = v_me and a.valid @> app.today()
   where k.id = p_kpi and k.active;
  if v_cad is null then raise exception 'That KPI is not assigned to you.' using errcode = '42501'; end if;
  if v_metric is not null then raise exception 'This KPI is counted automatically from your daily update.' using errcode = 'P0001'; end if;
  v_period := app.kpi_period(v_cad, coalesce(p_period, app.today()));
  if v_period > app.kpi_period(v_cad, app.today()) then raise exception 'That period has not started yet.' using errcode = 'P0001'; end if;
  insert into public.kpi_entry(person_id, kpi_id, period, planned, actual, note, updated_at)
  values (v_me, p_kpi, v_period, p_planned, p_actual, nullif(btrim(coalesce(p_note,'')),''), now())
  on conflict (person_id, kpi_id, period) do update set planned = excluded.planned, actual = excluded.actual, note = excluded.note, updated_at = now();
  return jsonb_build_object('ok', true);
end $$;

-- ---------------------------------------------------------------- achievement for the score
create or replace function app.kpi_achievements(p_person uuid, p_month date) returns setof numeric
language plpgsql stable security definer set search_path = public, app, pg_temp as $$
declare v_m0 date := date_trunc('month', p_month)::date;
        v_upto date := least(app.today(), (v_m0 + interval '1 month - 1 day')::date);
        r record; v_from date; v_periods numeric; v_sum numeric; v_n int; v_pct numeric;
begin
  if v_upto < v_m0 then return; end if;
  for r in select a.kpi_id, a.target, coalesce(a.cadence, k.cadence) cadence, coalesce(a.higher_better, k.higher_better) higher_better, k.metric,
                  (select min(lower(b.valid)) from public.kpi_assignment b where b.person_id = a.person_id and b.kpi_id = a.kpi_id) lo
             from public.kpi_assignment a join public.kpi_catalogue k on k.id = a.kpi_id and k.active
            where a.person_id = p_person and a.target is not null and a.target > 0 and a.valid @> v_upto loop
    if r.metric is not null then                                   -- fed from daily updates; target is for the month
      return next least(200, round(app.metric_actual(r.metric, v_m0, v_upto, 'person', null, null, p_person, null) / r.target * 100, 1));
      continue;
    end if;
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
      if v_n = 0 then continue; end if;
      v_pct := case when v_sum = 0 then 200 else r.target / (v_sum / v_n) * 100 end;
    end if;
    return next least(200, round(v_pct, 1));
  end loop;
end $$;
revoke all on function app.kpi_achievements(uuid, date) from public, anon, authenticated;

-- A scorecard KPI on the same measure replaces the old admin-set target for that person (no double counting).
create or replace function app.person_achievement(p_person uuid, p_month date) returns numeric
language sql stable security definer set search_path = public, app, pg_temp as $$
  with m as (select date_trunc('month', p_month)::date as m0,
                    least(app.today(), (date_trunc('month', p_month) + interval '1 month - 1 day')::date) as upto),
  t as (
    select (app.metric_actual(ta.metric, (select m0 from m), (select upto from m),
             'person', ta.zone_id, ta.branch_id, ta.person_id, ta.client_id) / ta.amount * 100)::numeric as pct
      from public.target_allocations ta
     where ta.is_current and ta.level = 'person' and ta.person_id = p_person
       and ta.month = (select m0 from m) and ta.amount > 0
       and not exists (select 1 from public.kpi_assignment a join public.kpi_catalogue k on k.id = a.kpi_id and k.active
                        where a.person_id = p_person and k.metric = ta.metric and a.target > 0 and a.valid @> (select upto from m))
    union all
    select x from app.kpi_achievements(p_person, p_month) x)
  select round(avg(pct), 1) from t;
$$;

-- roll-ups read the manager-chosen basis and the automatic figures
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
           and (v_all or app.can_view_person(a.person_id, app.today(), 'operations') or app.can_view_person(a.person_id, app.today(), 'collections')
                or exists (select 1 from public.reporting_lines rl where rl.person_id = a.person_id and rl.manager_id = v_me and rl.valid @> app.today()))) r
     where k.active and r.rows is not null) s);
end $$;

-- ---------------------------------------------------------------- per-attribute scoring in the review
create or replace function app.attr_avg(p_person uuid, p_scores jsonb) returns numeric
language plpgsql stable security definer set search_path = public, app, pg_temp as $$
declare x uuid; v numeric; s numeric := 0; n int := 0;
begin
  for x in select attribute_id from public.person_attributes where person_id = p_person and valid @> app.today() loop
    v := (p_scores ->> x::text)::numeric;
    if v is null or v < 0 or v > 10 then raise exception 'Score every attribute from 0 to 10.' using errcode = '22023'; end if;
    s := s + v; n := n + 1;
  end loop;
  return case when n > 0 then round(s / n, 1) end;
end $$;

create or replace function app.person_attr_list(p_person uuid) returns jsonb
language sql stable security definer set search_path = public, app, pg_temp as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name, 'description', c.description) order by c.name), '[]'::jsonb)
    from public.person_attributes a join public.attribute_catalogue c on c.id = a.attribute_id
   where a.person_id = p_person and a.valid @> app.today();
$$;

-- Per-attribute scoring wraps the existing score functions: the attribute score is the average of the ratings.
create or replace function public.self_score_attrs(p_month date, p_kpi numeric, p_scores jsonb, p_note text default null) returns jsonb
language plpgsql security definer set search_path = public, app, pg_temp as $$
declare v_avg numeric := app.attr_avg(app.me(), p_scores); v_res jsonb;
begin
  if v_avg is null then raise exception 'No attributes are set for you yet. Ask your manager to set them.' using errcode = 'P0001'; end if;
  v_res := public.self_score(p_month, p_kpi, v_avg, p_note);
  update public.monthly_scores set self_attr_scores = p_scores where person_id = app.me() and month = date_trunc('month', p_month)::date;
  return v_res;
end $$;

create or replace function public.save_score_attrs(p_person uuid, p_month date, p_kpi_given numeric, p_scores jsonb, p_note text default null) returns jsonb
language plpgsql security definer set search_path = public, app, pg_temp as $$
declare v_avg numeric; v_res jsonb;
begin
  if not app.direct_mgr(p_person) then raise exception 'Only the direct manager can score this person.' using errcode = '42501'; end if;
  v_avg := app.attr_avg(p_person, p_scores);
  if v_avg is null then raise exception 'Set this person''s attributes first.' using errcode = 'P0001'; end if;
  v_res := public.save_score(p_person, p_month, p_kpi_given, v_avg, p_note);
  update public.monthly_scores set attr_scores = p_scores where person_id = p_person and month = date_trunc('month', p_month)::date;
  return v_res;
end $$;

-- previews carry the person's attributes and any per-attribute scores already given
do $mig$
declare f text; o text;
begin
  f := pg_get_functiondef('public.my_review(date)'::regprocedure); o := f;
  f := replace(f, '''self_done'', row.self_at is not null,',
    '''self_done'', row.self_at is not null, ''attributes'', app.person_attr_list(v_me), ''self_attr_scores'', row.self_attr_scores,');
  if f = o then raise exception 'my_review anchor not found'; end if;
  execute f;
  f := pg_get_functiondef('public.score_preview(uuid,date,numeric,numeric)'::regprocedure); o := f;
  f := replace(f, '''self_done'', row.self_at is not null,',
    '''self_done'', row.self_at is not null, ''attributes'', app.person_attr_list(p_person), ''self_attr_scores'', row.self_attr_scores, ''attr_scores'', row.attr_scores,');
  if f = o then raise exception 'score_preview anchor not found'; end if;
  execute f;
end $mig$;

grant execute on function public.kpi_custom_add(text, text, text, text, boolean), public.scorecard_team(), public.scorecard_person(uuid, text),
  public.scorecard_save(uuid, text, jsonb, uuid[]), public.my_attributes(),
  public.self_score_attrs(date, numeric, jsonb, text), public.save_score_attrs(uuid, date, numeric, jsonb, text) to authenticated;
