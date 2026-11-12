-- D-130  GST certificate is not applicable: no longer offered.
-- D-131  Digital letters: templates per kind, roles & responsibilities per designation (with per-person changes),
--        issued on the company letterhead, accepted and signed on the phone, downloadable any time.
--        Exit, appraisal and salary-revision letters are kinds HR issues whenever needed.
-- D-132  Salary slips: from approved payroll, plus an upload for past months.

create or replace function app.doc_types_for(p_person uuid) returns text[]
language sql stable security definer set search_path = public, app, pg_temp as $$
  select case when (select resource_type::text from public.persons where id = p_person) = 'partner'
    then array['partner_agreement','security_cheque','aadhaar','pan','address_proof','cancelled_cheque','bank','photo','qualification','police_verification','kyc_other','other']
    else array['offer_letter','increment_letter','relieving_letter','joining_form','aadhaar','pan','address_proof','qualification','bank','photo','police_verification','kyc_other','other'] end;
$$;

create or replace function app.is_hr() returns boolean language sql stable security definer set search_path = public, app, pg_temp as $$
  select app.is_admin() or app.has_role('hr_admin') $$;
grant execute on function app.is_hr() to authenticated;

-- ---------------------------------------------------------------- letterhead
insert into public.settings(key, value, description, label, help, kind, section, editable) values
  ('company_cin', '""', 'Company CIN (D-131)', 'CIN', 'Printed in the footer of letters and salary slips (optional).', 'text', 'Company', true),
  ('letter_signatory_name', '""', 'Letter signatory (D-131)', 'Letters signed by (name)', 'The authorised signatory printed at the end of every letter.', 'text', 'Company', true),
  ('letter_signatory_title', '"Authorised Signatory"', 'Letter signatory title (D-131)', 'Letters signed by (designation)', 'Shown under the signatory''s name.', 'text', 'Company', true)
on conflict (key) do nothing;

create table if not exists public.company_assets (
  key text primary key check (key in ('letterhead', 'signature')),
  data_url text not null check (data_url like 'data:image/%' and length(data_url) <= 700000),
  updated_by uuid references public.persons(id), updated_at timestamptz not null default now()
);
alter table public.company_assets enable row level security;
revoke all on public.company_assets from anon, authenticated;

create or replace function public.company_asset_set(p_key text, p_data_url text) returns void
language plpgsql security definer set search_path = public, app, pg_temp as $$
begin
  if not app.is_hr() then raise exception 'Only HR/Admin can change the letterhead.' using errcode = '42501'; end if;
  if p_key not in ('letterhead', 'signature') then raise exception 'Unknown item.' using errcode = '22023'; end if;
  if p_data_url is null or p_data_url = '' then
    update public.company_assets set data_url = 'data:image/png;base64,', updated_by = app.me(), updated_at = now() where key = p_key;
    return;
  end if;
  if p_data_url not like 'data:image/%' or length(p_data_url) > 700000 then raise exception 'Use a PNG or JPG image under 500 KB.' using errcode = '22023'; end if;
  insert into public.company_assets(key, data_url, updated_by) values (p_key, p_data_url, app.me())
  on conflict (key) do update set data_url = excluded.data_url, updated_by = excluded.updated_by, updated_at = now();
end $$;

-- what a letter or slip is printed with (anyone signed in: it is the company's public face)
create or replace function public.letterhead() returns jsonb
language plpgsql stable security definer set search_path = public, app, pg_temp as $$
begin
  if app.me() is null then raise exception 'Not signed in' using errcode = '28000'; end if;
  return jsonb_build_object(
    'name', app.setting('company_name') #>> '{}', 'place', app.setting('company_place') #>> '{}', 'address', app.setting('company_address') #>> '{}',
    'website', app.setting('company_website') #>> '{}', 'cin', app.setting('company_cin') #>> '{}',
    'signatory_name', app.setting('letter_signatory_name') #>> '{}', 'signatory_title', app.setting('letter_signatory_title') #>> '{}',
    'letterhead', (select nullif(data_url, 'data:image/png;base64,') from public.company_assets where key = 'letterhead'),
    'signature', (select nullif(data_url, 'data:image/png;base64,') from public.company_assets where key = 'signature'));
end $$;

-- ---------------------------------------------------------------- templates and roles & responsibilities
create table if not exists public.letter_templates (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('offer','appointment','confirmation','increment','appraisal','promotion','transfer','warning','resignation_acceptance','relieving','experience','full_final','other')),
  name text not null unique,
  body text not null,
  needs_signature boolean not null default true,
  active boolean not null default true,
  updated_by uuid references public.persons(id), updated_at timestamptz not null default now()
);
create table if not exists public.role_profiles (
  id uuid primary key default gen_random_uuid(),
  designation text not null,
  department text not null default '',
  responsibilities text not null,
  updated_by uuid references public.persons(id), updated_at timestamptz not null default now(),
  unique (designation, department)
);
create table if not exists public.person_responsibilities (
  person_id uuid primary key references public.persons(id),
  responsibilities text not null,
  updated_by uuid references public.persons(id), updated_at timestamptz not null default now()
);
create sequence if not exists public.letters_ref_seq;
create table if not exists public.letters (
  id uuid primary key default gen_random_uuid(),
  ref_no text not null unique,
  person_id uuid not null references public.persons(id),
  kind text not null,
  title text not null,
  body text not null,
  body_hash text not null,
  needs_signature boolean not null default true,
  status text not null default 'issued' check (status in ('issued','signed','declined','withdrawn')),
  issued_by uuid references public.persons(id), issued_at timestamptz not null default now(),
  signed_at timestamptz, signed_name text, signature text check (signature is null or (signature like 'data:image/png;base64,%' and length(signature) <= 400000)),
  sign_ip text, sign_user_agent text,
  closed_reason text, closed_at timestamptz, closed_by uuid references public.persons(id)
);
create index if not exists letters_person_idx on public.letters(person_id, issued_at desc);
alter table public.letter_templates enable row level security;
alter table public.role_profiles enable row level security;
alter table public.person_responsibilities enable row level security;
alter table public.letters enable row level security;
revoke all on public.letter_templates, public.role_profiles, public.person_responsibilities, public.letters from anon, authenticated;
revoke all on sequence public.letters_ref_seq from anon, authenticated;

insert into public.letter_templates (kind, name, needs_signature, body) values
('offer', 'Offer letter', true,
'Dear {{name}},

We are pleased to offer you the position of {{designation}} in the {{department}} department of {{company_name}}, reporting to {{reporting_manager}}.

Date of joining: {{joining_date}}
Place of posting: {{place_of_posting}}
Monthly gross salary: {{monthly_salary}} (annual {{annual_salary}}), subject to statutory deductions as applicable.

This offer is subject to satisfactory verification of your documents and references, and to your accepting the terms of the appointment letter that will follow.

Please accept this offer by signing below within {{acceptance_days}} days.

We look forward to having you with us.'),
('appointment', 'Appointment letter with roles and responsibilities', true,
'Dear {{name}},

With reference to your application and the discussions held with you, we are pleased to appoint you as {{designation}} in the {{department}} department of {{company_name}} with effect from {{joining_date}}, on the following terms.

1. Reporting. You will report to {{reporting_manager}}, or any other person the company may name from time to time.

2. Remuneration. Your monthly gross salary will be {{monthly_salary}} (annual {{annual_salary}}), subject to statutory deductions as applicable. Your salary is confidential and is not to be discussed with other employees.

3. Probation. You will be on probation for {{probation_months}} months from the date of joining. On satisfactory completion you will be confirmed in writing.

4. Working hours and leave. Working hours, weekly offs, holidays and leave will be as per the company''s policies in force, available in the CRUX app.

5. Roles and responsibilities.
{{responsibilities}}
The company may add to or change these responsibilities according to business needs.

6. Confidentiality. You will keep confidential all information about the company, its clients and their customers that you come across in your work, during and after your employment.

7. Notice. Either side may end this employment by giving {{notice_days}} days'' written notice or salary in lieu, subject to the company''s policy.

8. Conduct. You will follow the company''s code of conduct, data security and client compliance requirements at all times.

Please sign below to confirm that you have read, understood and accept these terms.'),
('confirmation', 'Confirmation of employment', true,
'Dear {{name}},

We are pleased to inform you that, on satisfactory completion of your probation, your employment as {{designation}} with {{company_name}} is confirmed with effect from {{effective_date}}.

All other terms of your appointment remain unchanged.

We thank you for your contribution and wish you continued success.'),
('increment', 'Salary revision letter', true,
'Dear {{name}},

In recognition of your performance and contribution, your salary has been revised with effect from {{effective_date}}.

Current monthly gross salary: {{monthly_salary}}
Revised monthly gross salary: {{revised_monthly_salary}}

All other terms of your employment remain unchanged. Please keep the contents of this letter confidential.

We appreciate your efforts and look forward to your continued contribution.'),
('appraisal', 'Appraisal letter', true,
'Dear {{name}},

Your performance for the period {{review_period}} has been reviewed.

Overall rating: {{rating}}
Key strengths: {{strengths}}
Areas to improve: {{improvement_areas}}

{{appraisal_outcome}}

Please sign below to acknowledge that this appraisal has been discussed with you.'),
('promotion', 'Promotion letter', true,
'Dear {{name}},

We are pleased to inform you that you are promoted to {{new_designation}} with effect from {{effective_date}}.

Your revised monthly gross salary will be {{revised_monthly_salary}}. Your revised roles and responsibilities are:
{{responsibilities}}

All other terms of your employment remain unchanged. Congratulations, and we wish you success in your new role.'),
('transfer', 'Transfer letter', true,
'Dear {{name}},

This is to inform you that you are transferred to {{new_location}} with effect from {{effective_date}}. You will report to {{new_reporting_manager}}.

All other terms of your employment remain unchanged.'),
('warning', 'Warning letter', true,
'Dear {{name}},

This letter is a formal warning regarding: {{concern}}.

You are advised to correct this immediately. Any repetition may lead to further disciplinary action as per company policy.

Please sign below to acknowledge receipt of this letter.'),
('resignation_acceptance', 'Acceptance of resignation', true,
'Dear {{name}},

This is with reference to your resignation dated {{resignation_date}} from the position of {{designation}}. Your resignation is accepted and you will be relieved from your duties at the close of working hours on {{last_working_day}}.

Before your last working day, please hand over all company property, documents and data in your possession and complete the handover to {{handover_to}}. Your full and final settlement will be processed as per company policy after the clearance is complete.

We thank you for your contribution and wish you the very best.'),
('relieving', 'Relieving letter', false,
'To whomsoever it may concern,

This is to certify that {{name}} was employed with {{company_name}} from {{joining_date}} to {{last_working_day}} and last held the position of {{designation}}.

{{name}} has been relieved from the services of the company at the close of working hours on {{last_working_day}}.

We wish {{name}} every success in future endeavours.'),
('experience', 'Experience letter', false,
'To whomsoever it may concern,

This is to certify that {{name}} worked with {{company_name}} from {{joining_date}} to {{last_working_day}} as {{designation}} in the {{department}} department.

During this period we found {{name}} to be {{conduct_remark}}.

We wish {{name}} every success in future endeavours.'),
('full_final', 'Full and final settlement', true,
'Dear {{name}},

With reference to your separation from the company on {{last_working_day}}, your full and final settlement has been worked out as below.

Amount payable to you: {{settlement_amount}}
Details: {{settlement_details}}

On receipt of this amount you confirm that you have no further claim of any kind against the company.

Please sign below to accept this settlement.')
on conflict (name) do nothing;

insert into public.role_profiles (designation, department, responsibilities) values
('Executive', '',
'- Complete the cases allocated each day within the client''s turnaround time and quality standards.
- Record accurate and complete information; never report a visit or a finding that did not happen.
- Update the day''s entry, closure and pending figures in the CRUX app before the day closes.
- Keep customer, bank and client information strictly confidential.
- Report any difficulty, delay or suspected fraud to the reporting manager the same day.'),
('Client Coordinator', '',
'- Be the daily point of contact for the client for the cases handled at the location.
- Allocate incoming cases, follow them up and make sure they are closed within the turnaround time.
- Resolve client queries and escalations, and record them.
- Share the agreed reports with the client accurately and on time.
- Keep case information and client data strictly confidential.'),
('Team Leader', '',
'- Plan and allocate the day''s work for the team and follow it through to closure.
- Check the quality of the team''s work and correct errors before they reach the client.
- Review and certify the team''s daily figures in the CRUX app.
- Coach team members and report attendance, performance and concerns to the manager.'),
('Assistant Manager', '',
'- Support the manager in running daily operations at the location.
- Monitor turnaround time, pendency and quality, and act on shortfalls the same day.
- Review the team''s daily figures and attendance in the CRUX app.
- Handle first-level client queries and escalations.
- Train new team members and maintain discipline and compliance.'),
('Branch Manager', '',
'- Own the business, service delivery and compliance of the branch.
- Achieve the monthly case, revenue and collection targets of the branch.
- Maintain the client relationships of the branch and resolve escalations.
- Lead, review and develop the branch team; certify the team''s daily figures.
- Control costs, safeguard company assets and ensure billing data is accurate and on time.
- Ensure all client, statutory and company policies are followed at the branch.'),
('Zonal Manager', '',
'- Own the business, service delivery and compliance of all locations in the zone.
- Achieve the monthly case, revenue and collection targets of the zone.
- Review each location''s performance and take corrective action.
- Manage key client relationships and escalations for the zone.
- Develop Branch Managers and build the team''s capability.
- Ensure audit readiness and adherence to client and company policies across the zone.'),
('Manager', '',
'- Plan, run and review the work of the team to meet agreed targets and quality.
- Report performance, risks and issues to the reporting manager on time.
- Lead, coach and review team members.
- Ensure company policies and client requirements are followed.')
on conflict (designation, department) do nothing;

-- the responsibilities that apply to a person: their own text if HR wrote one, else their designation's (their department's version first)
create or replace function app.responsibilities_of(p_person uuid) returns text
language sql stable security definer set search_path = public, app, pg_temp as $$
  select coalesce(
    (select responsibilities from public.person_responsibilities where person_id = p_person),
    (select r.responsibilities from public.role_profiles r, public.persons p
      where p.id = p_person and lower(coalesce(p.designation, '')) like '%' || lower(r.designation) || '%'
        and (r.department = '' or r.department = coalesce(p.department, ''))
      order by (r.department <> '') desc, length(r.designation) desc limit 1));
$$;

create or replace function app.fmt_money(p numeric) returns text language sql immutable as $$
  select 'Rs. ' || trim(to_char(round(p), 'FM99,99,99,99,990')) $$;
create or replace function app.fmt_date(p date) returns text language sql immutable as $$ select to_char(p, 'FMDD Mon YYYY') $$;

-- fill a template for a person. p_extra supplies or overrides any field. Returns the text and the fields still to be filled.
create or replace function app.letter_merge(p_body text, p_person uuid, p_extra jsonb) returns jsonb
language plpgsql stable security definer set search_path = public, app, pg_temp as $$
declare v jsonb; k text; b text := p_body; v_gross numeric; v_missing text[];
begin
  select c.monthly_gross into v_gross from public.hr_compensation c where c.person_id = p_person and c.effective_from <= app.today()
   order by c.effective_from desc, c.created_at desc limit 1;
  select jsonb_strip_nulls(jsonb_build_object(
      'name', p.full_name, 'designation', nullif(p.designation, ''), 'department', app.person_department(p.id),
      'joining_date', app.fmt_date(coalesce(h.joining_date, p.joined_on)),
      'reporting_manager', (select m.full_name from public.reporting_lines r join public.persons m on m.id = r.manager_id
                             where r.person_id = p.id and r.valid @> app.today() order by (r.function = 'operations') desc limit 1),
      'monthly_salary', case when v_gross is not null then app.fmt_money(v_gross) end,
      'annual_salary', case when v_gross is not null then app.fmt_money(v_gross * 12) end,
      'address', nullif(h.current_address, ''), 'mobile', p.mobile,
      'responsibilities', app.responsibilities_of(p.id),
      'today', app.fmt_date(app.today()),
      'company_name', app.setting('company_name') #>> '{}', 'company_address', nullif(app.setting('company_address') #>> '{}', '')))
    into v from public.persons p left join public.hr_profiles h on h.person_id = p.id where p.id = p_person;
  if v is null then raise exception 'Unknown person.' using errcode = 'P0002'; end if;
  v := v || coalesce((select jsonb_object_agg(e.key, e.value) from jsonb_each_text(coalesce(p_extra, '{}'::jsonb)) e where btrim(e.value) <> ''), '{}'::jsonb);
  for k in select jsonb_object_keys(v) loop b := replace(b, '{{' || k || '}}', v ->> k); end loop;
  select coalesce(array_agg(distinct m[1]), '{}') into v_missing from regexp_matches(b, '\{\{([a-z_0-9]+)\}\}', 'g') m;
  return jsonb_build_object('body', b, 'missing', to_jsonb(v_missing));
end $$;

create or replace function public.letter_setup() returns jsonb
language plpgsql stable security definer set search_path = public, app, pg_temp as $$
begin
  if not app.is_hr() then raise exception 'HR only.' using errcode = '42501'; end if;
  return jsonb_build_object(
    'templates', (select coalesce(jsonb_agg(jsonb_build_object('id', t.id, 'kind', t.kind, 'name', t.name, 'body', t.body, 'needs_signature', t.needs_signature, 'active', t.active) order by t.active desc, t.name), '[]'::jsonb) from public.letter_templates t),
    'roles', (select coalesce(jsonb_agg(jsonb_build_object('id', r.id, 'designation', r.designation, 'department', r.department, 'responsibilities', r.responsibilities) order by r.designation, r.department), '[]'::jsonb) from public.role_profiles r),
    'designations', (select coalesce(jsonb_agg(d.name order by d.rank, d.name), '[]'::jsonb) from public.designations d where d.active),
    'departments', (select coalesce(jsonb_agg(d.name order by d.name), '[]'::jsonb) from public.departments d),
    'people', (select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'name', p.full_name, 'designation', p.designation, 'department', app.person_department(p.id),
                 'partner', p.resource_type::text = 'partner', 'own_text', exists (select 1 from public.person_responsibilities x where x.person_id = p.id)) order by p.full_name), '[]'::jsonb)
                from public.persons p where p.status in ('active', 'invited')));
end $$;

create or replace function public.letter_template_save(p_id uuid, p_kind text, p_name text, p_body text, p_needs_signature boolean, p_active boolean) returns uuid
language plpgsql security definer set search_path = public, app, pg_temp as $$
declare v_id uuid;
begin
  if not app.is_hr() then raise exception 'HR only.' using errcode = '42501'; end if;
  if length(btrim(coalesce(p_name, ''))) < 3 then raise exception 'Give the template a name.' using errcode = 'P0001'; end if;
  if length(btrim(coalesce(p_body, ''))) < 20 then raise exception 'Write the letter text.' using errcode = 'P0001'; end if;
  if p_id is null then
    insert into public.letter_templates(kind, name, body, needs_signature, active, updated_by) values (p_kind, btrim(p_name), p_body, coalesce(p_needs_signature, true), coalesce(p_active, true), app.me()) returning id into v_id;
  else
    update public.letter_templates set kind = p_kind, name = btrim(p_name), body = p_body, needs_signature = coalesce(p_needs_signature, true), active = coalesce(p_active, true),
           updated_by = app.me(), updated_at = now() where id = p_id returning id into v_id;
    if v_id is null then raise exception 'Template not found.' using errcode = 'P0002'; end if;
  end if;
  return v_id;
exception when unique_violation then raise exception 'Another template already has that name.' using errcode = 'P0001';
end $$;

create or replace function public.role_profile_save(p_designation text, p_department text, p_responsibilities text) returns void
language plpgsql security definer set search_path = public, app, pg_temp as $$
begin
  if not app.is_hr() then raise exception 'HR only.' using errcode = '42501'; end if;
  if length(btrim(coalesce(p_designation, ''))) < 2 then raise exception 'Pick the designation.' using errcode = 'P0001'; end if;
  if length(btrim(coalesce(p_responsibilities, ''))) < 10 then raise exception 'Write the roles and responsibilities.' using errcode = 'P0001'; end if;
  insert into public.role_profiles(designation, department, responsibilities, updated_by) values (btrim(p_designation), coalesce(btrim(p_department), ''), p_responsibilities, app.me())
  on conflict (designation, department) do update set responsibilities = excluded.responsibilities, updated_by = excluded.updated_by, updated_at = now();
end $$;

-- a person's own roles & responsibilities (empty text = go back to the designation's)
create or replace function public.person_responsibilities_save(p_person uuid, p_responsibilities text) returns void
language plpgsql security definer set search_path = public, app, pg_temp as $$
begin
  if not app.is_hr() then raise exception 'HR only.' using errcode = '42501'; end if;
  insert into public.person_responsibilities(person_id, responsibilities, updated_by) values (p_person, coalesce(p_responsibilities, ''), app.me())
  on conflict (person_id) do update set responsibilities = excluded.responsibilities, updated_by = excluded.updated_by, updated_at = now();
end $$;
create or replace function app.responsibilities_of(p_person uuid) returns text
language sql stable security definer set search_path = public, app, pg_temp as $$
  select coalesce(
    (select nullif(btrim(responsibilities), '') from public.person_responsibilities where person_id = p_person),
    (select r.responsibilities from public.role_profiles r, public.persons p
      where p.id = p_person and lower(coalesce(p.designation, '')) like '%' || lower(r.designation) || '%'
        and (r.department = '' or r.department = coalesce(p.department, ''))
      order by (r.department <> '') desc, length(r.designation) desc limit 1));
$$;
create or replace function public.person_responsibilities_get(p_person uuid) returns jsonb
language plpgsql stable security definer set search_path = public, app, pg_temp as $$
begin
  if not (app.is_hr() or p_person = app.me()) then raise exception 'Not permitted.' using errcode = '42501'; end if;
  return jsonb_build_object('text', app.responsibilities_of(p_person),
    'own', exists (select 1 from public.person_responsibilities where person_id = p_person and btrim(responsibilities) <> ''));
end $$;

create or replace function public.letter_preview(p_person uuid, p_template uuid, p_extra jsonb default '{}') returns jsonb
language plpgsql stable security definer set search_path = public, app, pg_temp as $$
declare t public.letter_templates;
begin
  if not app.is_hr() then raise exception 'HR only.' using errcode = '42501'; end if;
  select * into t from public.letter_templates where id = p_template;
  if not found then raise exception 'Template not found.' using errcode = 'P0002'; end if;
  return app.letter_merge(t.body, p_person, p_extra) || jsonb_build_object('title', t.name, 'kind', t.kind, 'needs_signature', t.needs_signature);
end $$;

create or replace function app.letter_insert(p_person uuid, p_kind text, p_title text, p_body text, p_needs_signature boolean) returns uuid
language plpgsql security definer set search_path = public, app, pg_temp as $$
declare v_id uuid; v_ref text;
begin
  v_ref := 'CRUX/' || upper(left(p_kind, 3)) || '/' || to_char(app.today(), 'YYYY') || '/' || lpad(nextval('public.letters_ref_seq')::text, 4, '0');
  insert into public.letters(ref_no, person_id, kind, title, body, body_hash, needs_signature, issued_by)
  values (v_ref, p_person, p_kind, btrim(p_title), p_body, md5(p_body), coalesce(p_needs_signature, true), app.me()) returning id into v_id;
  insert into public.notifications(person_id, kind, message, link)
  values (p_person, 'letter', 'You have a new letter from HR: ' || btrim(p_title) || case when coalesce(p_needs_signature, true) then '. Please read and sign it.' else '.' end, '/letters');
  return v_id;
end $$;

create or replace function public.letter_issue(p_person uuid, p_kind text, p_title text, p_body text, p_needs_signature boolean default true) returns jsonb
language plpgsql security definer set search_path = public, app, pg_temp as $$
declare v_id uuid;
begin
  if not app.is_hr() then raise exception 'HR only.' using errcode = '42501'; end if;
  if not exists (select 1 from public.persons where id = p_person and status <> 'exited') and p_kind not in ('relieving', 'experience', 'full_final') then
    raise exception 'That person has left. Only relieving, experience and settlement letters can be issued.' using errcode = 'P0001'; end if;
  if length(btrim(coalesce(p_title, ''))) < 3 or length(btrim(coalesce(p_body, ''))) < 20 then raise exception 'The letter needs a title and text.' using errcode = 'P0001'; end if;
  if p_body ~ '\{\{[a-z_0-9]+\}\}' then raise exception 'Some fields are still blank: %', (select string_agg(distinct m[1], ', ') from regexp_matches(p_body, '\{\{([a-z_0-9]+)\}\}', 'g') m) using errcode = 'P0001'; end if;
  v_id := app.letter_insert(p_person, p_kind, p_title, p_body, p_needs_signature);
  return (select jsonb_build_object('id', id, 'ref_no', ref_no) from public.letters where id = v_id);
end $$;

-- the same template to many people; anyone with a blank field is skipped and listed
create or replace function public.letter_issue_bulk(p_template uuid, p_people uuid[], p_extra jsonb default '{}') returns jsonb
language plpgsql security definer set search_path = public, app, pg_temp as $$
declare t public.letter_templates; v_p uuid; m jsonb; v_done int := 0; v_skip jsonb := '[]'::jsonb;
begin
  if not app.is_hr() then raise exception 'HR only.' using errcode = '42501'; end if;
  select * into t from public.letter_templates where id = p_template and active;
  if not found then raise exception 'Template not found.' using errcode = 'P0002'; end if;
  foreach v_p in array coalesce(p_people, '{}') loop
    m := app.letter_merge(t.body, v_p, p_extra);
    if jsonb_array_length(m -> 'missing') > 0 then
      v_skip := v_skip || jsonb_build_object('name', (select full_name from public.persons where id = v_p), 'missing', m -> 'missing');
    else
      perform app.letter_insert(v_p, t.kind, t.name, m ->> 'body', t.needs_signature); v_done := v_done + 1;
    end if;
  end loop;
  return jsonb_build_object('issued', v_done, 'skipped', v_skip);
end $$;

create or replace function public.letters_list(p_person uuid default null) returns jsonb
language plpgsql stable security definer set search_path = public, app, pg_temp as $$
declare v_hr boolean := app.is_hr();
begin
  if app.me() is null then raise exception 'Not signed in' using errcode = '28000'; end if;
  return (select coalesce(jsonb_agg(jsonb_build_object('id', l.id, 'ref_no', l.ref_no, 'person_id', l.person_id, 'person', p.full_name, 'designation', p.designation,
            'kind', l.kind, 'title', l.title, 'status', l.status, 'needs_signature', l.needs_signature, 'issued_at', l.issued_at, 'signed_at', l.signed_at,
            'closed_reason', l.closed_reason) order by l.issued_at desc), '[]'::jsonb)
            from public.letters l join public.persons p on p.id = l.person_id
           where case when v_hr and p_person is null then true when v_hr then l.person_id = p_person
                      else l.person_id = app.me() and l.status <> 'withdrawn' end);
end $$;

create or replace function public.letter_get(p_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public, app, pg_temp as $$
declare l public.letters;
begin
  select * into l from public.letters where id = p_id;
  if not found or not (app.is_hr() or (l.person_id = app.me() and l.status <> 'withdrawn')) then raise exception 'Letter not found.' using errcode = 'P0002'; end if;
  return to_jsonb(l) - 'sign_ip' - 'sign_user_agent'
    || jsonb_build_object('person', (select full_name from public.persons where id = l.person_id), 'designation', (select designation from public.persons where id = l.person_id),
         'address', (select nullif(current_address, '') from public.hr_profiles where person_id = l.person_id),
         'issued_by_name', (select full_name from public.persons where id = l.issued_by), 'intact', md5(l.body) = l.body_hash);
end $$;

create or replace function public.letter_sign(p_id uuid, p_typed_name text, p_signature text, p_user_agent text default null) returns jsonb
language plpgsql security definer set search_path = public, app, pg_temp as $$
declare l public.letters; v_hdr json; v_ip text;
begin
  select * into l from public.letters where id = p_id for update;
  if not found or l.person_id <> app.me() then raise exception 'Letter not found.' using errcode = 'P0002'; end if;
  if l.status <> 'issued' then raise exception 'This letter is already %.', l.status using errcode = 'P0001'; end if;
  if length(btrim(coalesce(p_typed_name, ''))) < 3 then raise exception 'Type your full name to sign.' using errcode = 'P0001'; end if;
  if l.needs_signature and (p_signature is null or p_signature not like 'data:image/png;base64,%' or length(p_signature) < 400) then
    raise exception 'Draw your signature in the box.' using errcode = 'P0001'; end if;
  if length(coalesce(p_signature, '')) > 400000 then raise exception 'The signature image is too large. Clear and sign again.' using errcode = '22023'; end if;
  begin v_hdr := current_setting('request.headers', true)::json; exception when others then v_hdr := null; end;
  v_ip := split_part(coalesce(v_hdr ->> 'x-forwarded-for', ''), ',', 1);
  update public.letters set status = 'signed', signed_at = now(), signed_name = btrim(p_typed_name), signature = p_signature,
         sign_ip = nullif(v_ip, ''), sign_user_agent = left(p_user_agent, 300) where id = p_id;
  if l.issued_by is not null and l.issued_by <> app.me() then
    insert into public.notifications(person_id, kind, message, link)
    values (l.issued_by, 'letter', (select full_name from public.persons where id = l.person_id) || ' signed: ' || l.title || ' (' || l.ref_no || ').', '/admin?s=letters');
  end if;
  return jsonb_build_object('ok', true);
end $$;

-- the person does not accept (with a reason), or HR takes an unsigned letter back
create or replace function public.letter_close(p_id uuid, p_reason text) returns void
language plpgsql security definer set search_path = public, app, pg_temp as $$
declare l public.letters; v_mine boolean;
begin
  select * into l from public.letters where id = p_id for update;
  v_mine := found and l.person_id = app.me();
  if not found or not (v_mine or app.is_hr()) then raise exception 'Letter not found.' using errcode = 'P0002'; end if;
  if l.status <> 'issued' then raise exception 'This letter is already % and cannot be changed.', l.status using errcode = 'P0001'; end if;
  if length(btrim(coalesce(p_reason, ''))) < 3 then raise exception 'Give the reason.' using errcode = 'P0001'; end if;
  update public.letters set status = case when v_mine then 'declined' else 'withdrawn' end, closed_reason = btrim(p_reason), closed_at = now(), closed_by = app.me() where id = p_id;
  if v_mine and l.issued_by is not null then
    insert into public.notifications(person_id, kind, message, link)
    values (l.issued_by, 'letter', (select full_name from public.persons where id = l.person_id) || ' has not accepted: ' || l.title || ' — ' || btrim(p_reason), '/admin?s=letters');
  elsif not v_mine then
    insert into public.notifications(person_id, kind, message, link) values (l.person_id, 'letter', 'HR has withdrawn the letter: ' || l.title || '.', '/letters');
  end if;
end $$;

-- ---------------------------------------------------------------- salary slips
create table if not exists public.payslip_history (
  person_id uuid not null references public.persons(id),
  month date not null check (month = date_trunc('month', month)::date),
  paid_days numeric(5,1), days_in_month int,
  earnings jsonb not null default '[]', deductions jsonb not null default '[]',
  gross numeric(12,2) not null, deductions_total numeric(12,2) not null, net numeric(12,2) not null,
  uploaded_by uuid references public.persons(id), uploaded_at timestamptz not null default now(),
  primary key (person_id, month)
);
alter table public.payslip_history enable row level security;
revoke all on public.payslip_history from anon, authenticated;

create or replace function app.payslip_ok(p_person uuid, p_month date) returns boolean
language sql stable security definer set search_path = public, app, pg_temp as $$
  select p_person = app.me() or app.is_hr() or app.can_see_pay(p_person, p_month) $$;

create or replace function public.payslips(p_person uuid default null) returns jsonb
language plpgsql stable security definer set search_path = public, app, pg_temp as $$
declare v_p uuid := coalesce(p_person, app.me());
begin
  if app.me() is null then raise exception 'Not signed in' using errcode = '28000'; end if;
  if not app.payslip_ok(v_p, app.today()) then raise exception 'Not permitted.' using errcode = '42501'; end if;
  return (select coalesce(jsonb_agg(jsonb_build_object('month', x.month, 'net', x.net, 'source', x.source) order by x.month desc), '[]'::jsonb) from (
    select h.month, h.net, 'uploaded' source from public.payslip_history h where h.person_id = v_p
    union all
    select l.month, l.net_pay, 'payroll' from public.payroll_lines l join public.payroll_runs r on r.month = l.month and r.status in ('approved', 'sent')
     where l.person_id = v_p and not exists (select 1 from public.payslip_history h where h.person_id = v_p and h.month = l.month)) x);
end $$;

create or replace function public.payslip(p_person uuid, p_month date) returns jsonb
language plpgsql stable security definer set search_path = public, app, pg_temp as $$
declare v_p uuid := coalesce(p_person, app.me()); v_m date := date_trunc('month', p_month)::date; h public.payslip_history; l public.payroll_lines; v_head jsonb; v_e jsonb; v_d jsonb; v_et numeric; v_dt numeric;
begin
  if app.me() is null then raise exception 'Not signed in' using errcode = '28000'; end if;
  if not app.payslip_ok(v_p, v_m) then raise exception 'Not permitted.' using errcode = '42501'; end if;
  select jsonb_build_object('person', p.full_name, 'designation', p.designation, 'department', app.person_department(p.id), 'mobile', p.mobile,
           'joining_date', coalesce(hp.joining_date, p.joined_on), 'pan_last4', hp.pan_last4, 'uan_last4', hp.uan_last4,
           'bank_name', hp.bank_name, 'bank_account_last4', hp.bank_account_last4, 'month', v_m)
    into v_head from public.persons p left join public.hr_profiles hp on hp.person_id = p.id where p.id = v_p;
  select * into h from public.payslip_history where person_id = v_p and month = v_m;
  if found then
    return v_head || jsonb_build_object('source', 'uploaded', 'paid_days', h.paid_days, 'days_in_month', coalesce(h.days_in_month, extract(day from (v_m + interval '1 month - 1 day'))::int),
      'earnings', h.earnings, 'deductions', h.deductions, 'gross', h.gross, 'deductions_total', h.deductions_total, 'net', h.net);
  end if;
  select pl.* into l from public.payroll_lines pl join public.payroll_runs r on r.month = pl.month and r.status in ('approved', 'sent') where pl.person_id = v_p and pl.month = v_m;
  if not found then raise exception 'There is no salary slip for that month yet.' using errcode = 'P0002'; end if;
  v_e := (select jsonb_agg(jsonb_build_object('label', x.label, 'amount', x.amount)) from (values
            ('Basic', l.basic), ('Other allowances', l.earned_gross - l.basic), ('Incentives', l.incentives), ('Arrears', l.arrears)) x(label, amount) where x.amount <> 0);
  v_et := l.earned_gross + l.incentives + l.arrears;
  v_d := (select jsonb_agg(jsonb_build_object('label', x.label, 'amount', x.amount)) from (values
            ('Provident fund', l.pf_employee), ('ESI', l.esi_employee), ('Professional tax', coalesce(l.pt, 0)), ('Other deductions', l.other_deductions)) x(label, amount) where x.amount <> 0);
  v_dt := l.pf_employee + l.esi_employee + coalesce(l.pt, 0) + l.other_deductions;
  if round(v_et - v_dt - l.net_pay, 2) <> 0 then      -- anything else between earnings and net pay is shown, so the slip always adds up
    v_d := coalesce(v_d, '[]'::jsonb) || jsonb_build_object('label', 'Employer contributions and other adjustments', 'amount', round(v_et - v_dt - l.net_pay, 2));
    v_dt := v_et - l.net_pay;
  end if;
  return v_head || jsonb_build_object('source', 'payroll', 'paid_days', l.days_in_month - coalesce(l.unpaid_override, l.unpaid_days) - l.not_employed_days, 'days_in_month', l.days_in_month,
    'earnings', coalesce(v_e, '[]'::jsonb), 'deductions', coalesce(v_d, '[]'::jsonb), 'gross', v_et, 'deductions_total', v_dt, 'net', l.net_pay);
end $$;

-- Past months from a sheet. Each row: mobile or name, month (YYYY-MM), paid_days, then amounts. p_apply = false only checks.
create or replace function public.payslip_history_upload(p_rows jsonb, p_apply boolean default false) returns jsonb
language plpgsql security definer set search_path = public, app, pg_temp as $$
declare r jsonb; i int := 0; v_p uuid; v_n int; v_m date; v_ok int := 0; v_bad jsonb := '[]'::jsonb; v_e jsonb; v_d jsonb; v_et numeric; v_dt numeric; v_net numeric; v_why text; v_mob text;
  num constant text := '^-?[0-9]+(\.[0-9]+)?$';
begin
  if not app.is_hr() then raise exception 'HR only.' using errcode = '42501'; end if;
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) = 0 then raise exception 'The sheet has no rows.' using errcode = 'P0001'; end if;
  if jsonb_array_length(p_rows) > 5000 then raise exception 'Upload at most 5,000 rows at a time.' using errcode = 'P0001'; end if;
  for r in select * from jsonb_array_elements(p_rows) loop
    i := i + 1; v_why := null; v_p := null;
    v_mob := right(regexp_replace(coalesce(r ->> 'mobile', ''), '\D', '', 'g'), 10);
    if length(v_mob) = 10 then select id into v_p from public.persons where right(regexp_replace(mobile, '\D', '', 'g'), 10) = v_mob limit 1; end if;
    if v_p is null and btrim(coalesce(r ->> 'name', '')) <> '' then
      select count(*), min(id::text)::uuid into v_n, v_p from public.persons where lower(btrim(full_name)) = lower(btrim(r ->> 'name'));
      if v_n > 1 then v_p := null; v_why := 'More than one person has this name; give the mobile number.'; end if;
    end if;
    if v_p is null then v_why := coalesce(v_why, 'Person not found (check the mobile number or name).'); end if;
    if v_why is null then
      begin v_m := to_date(left(btrim(r ->> 'month'), 7) || '-01', 'YYYY-MM-DD'); exception when others then v_why := 'Month must look like 2025-04.'; end;
      if v_why is null and (v_m is null or v_m >= date_trunc('month', app.today())::date) then v_why := 'Month must be a past month, like 2025-04.'; end if;
    end if;
    if v_why is null and exists (select 1 from jsonb_each_text(r - 'mobile' - 'name' - 'month') e where btrim(e.value) <> '' and btrim(e.value) !~ num) then
      v_why := 'Amounts and days must be numbers.'; end if;
    if v_why is null and exists (select 1 from public.payroll_lines l join public.payroll_runs x on x.month = l.month and x.status in ('approved', 'sent') where l.person_id = v_p and l.month = v_m) then
      v_why := 'This month''s salary was run in the app; its slip comes from there.'; end if;
    if v_why is null then
      v_e := (select coalesce(jsonb_agg(jsonb_build_object('label', x.label, 'amount', x.amount)), '[]'::jsonb) from (values
                ('Basic', nullif(btrim(r ->> 'basic'), '')::numeric), ('House rent allowance', nullif(btrim(r ->> 'hra'), '')::numeric),
                ('Other allowances', nullif(btrim(r ->> 'allowances'), '')::numeric), ('Incentives', nullif(btrim(r ->> 'incentive'), '')::numeric),
                ('Arrears', nullif(btrim(r ->> 'arrears'), '')::numeric)) x(label, amount) where coalesce(x.amount, 0) <> 0);
      v_d := (select coalesce(jsonb_agg(jsonb_build_object('label', x.label, 'amount', x.amount)), '[]'::jsonb) from (values
                ('Provident fund', nullif(btrim(r ->> 'pf'), '')::numeric), ('ESI', nullif(btrim(r ->> 'esi'), '')::numeric),
                ('Professional tax', nullif(btrim(r ->> 'pt'), '')::numeric), ('Income tax (TDS)', nullif(btrim(r ->> 'tds'), '')::numeric),
                ('Other deductions', nullif(btrim(r ->> 'other_deductions'), '')::numeric)) x(label, amount) where coalesce(x.amount, 0) <> 0);
      v_et := (select coalesce(sum((x ->> 'amount')::numeric), 0) from jsonb_array_elements(v_e) x);
      v_dt := (select coalesce(sum((x ->> 'amount')::numeric), 0) from jsonb_array_elements(v_d) x);
      v_net := coalesce(nullif(btrim(r ->> 'net'), '')::numeric, v_et - v_dt);
      if v_et <= 0 then v_why := 'No earnings given (basic, HRA, allowances…).';
      elsif abs(v_et - v_dt - v_net) > 1 then v_why := 'Earnings minus deductions (' || (v_et - v_dt) || ') does not equal net pay (' || v_net || ').'; end if;
    end if;
    if v_why is not null then v_bad := v_bad || jsonb_build_object('row', i, 'who', coalesce(nullif(r ->> 'name', ''), r ->> 'mobile'), 'month', r ->> 'month', 'why', v_why); continue; end if;
    v_ok := v_ok + 1;
    if p_apply then
      insert into public.payslip_history(person_id, month, paid_days, days_in_month, earnings, deductions, gross, deductions_total, net, uploaded_by)
      values (v_p, v_m, nullif(btrim(r ->> 'paid_days'), '')::numeric, extract(day from (v_m + interval '1 month - 1 day'))::int, v_e, v_d, v_et, v_dt, v_net, app.me())
      on conflict (person_id, month) do update set paid_days = excluded.paid_days, earnings = excluded.earnings, deductions = excluded.deductions,
        gross = excluded.gross, deductions_total = excluded.deductions_total, net = excluded.net, uploaded_by = excluded.uploaded_by, uploaded_at = now();
    end if;
  end loop;
  return jsonb_build_object('ok', v_ok, 'problems', v_bad, 'applied', p_apply and v_ok > 0);
end $$;

create or replace function public.payslip_history_summary() returns jsonb
language plpgsql stable security definer set search_path = public, app, pg_temp as $$
begin
  if not app.is_hr() then raise exception 'HR only.' using errcode = '42501'; end if;
  return (select coalesce(jsonb_agg(jsonb_build_object('month', m.month, 'people', m.n, 'net', m.net) order by m.month desc), '[]'::jsonb)
            from (select month, count(*) n, sum(net) net from public.payslip_history group by month) m);
end $$;

-- ---------------------------------------------------------------- menu card entries
insert into public.access_pages (key, label, section, description, sort, base_roles, base_note) values
  ('letters', 'My letters & salary slips', 'My work', 'Letters from HR to read, sign and download, and the person''s own salary slips.', 45, null, null),
  ('adm_letters', 'Admin · Letters & salary slips', 'Admin', 'Letter templates, roles and responsibilities, issuing letters, and past salary slips.', 325, '{hr_admin,admin}', null)
on conflict (key) do nothing;
insert into public.access_rules (area, role, level, locked)
select 'page:' || a.key, r.role, 'all', r.role = 'admin'
from public.access_pages a
cross join (values ('executive'),('manager'),('ba'),('bm'),('zm'),('ops_head'),('collections_head'),('product_head'),('hr_admin'),('auditor'),('leadership'),('ea'),('admin')) r(role)
where a.key in ('letters', 'adm_letters')
on conflict (area, role) do nothing;

grant execute on function public.company_asset_set(text, text), public.letterhead(), public.letter_setup(),
  public.letter_template_save(uuid, text, text, text, boolean, boolean), public.role_profile_save(text, text, text),
  public.person_responsibilities_save(uuid, text), public.person_responsibilities_get(uuid), public.letter_preview(uuid, uuid, jsonb),
  public.letter_issue(uuid, text, text, text, boolean), public.letter_issue_bulk(uuid, uuid[], jsonb), public.letters_list(uuid), public.letter_get(uuid),
  public.letter_sign(uuid, text, text, text), public.letter_close(uuid, text), public.payslips(uuid), public.payslip(uuid, date),
  public.payslip_history_upload(jsonb, boolean), public.payslip_history_summary() to authenticated;
