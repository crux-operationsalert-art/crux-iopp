-- Milestone 5 (owner feedback 03 Nov, evening). Additive only.
--  * tasks: misses (needs a reply; only Admin closes after a resolution request) and to-dos (close when the system
--    sees the condition fixed), with a full event trail
--  * TAT pending buckets on every line, compulsory, and the pending total must tally with yesterday + entry − closure − cancelled
--  * daily bills raised and collections for location heads, compulsory
--  * HR profile (masked identifiers only) + salary (set by the manager) + signed user agreement gate the tool
--  * colleagues at the same location see each other's entries; leaders may bulk-upload their own team
--  * performance dashboard data (history + this month) scoped to the viewer

-- ------------------------------------------------------------------ settings
insert into public.settings(key, value, description, label, help, kind, section, editable) values
 ('company_name', '"Crux Risk Management Pvt. Ltd."', 'Company legal name', 'Company name', 'Shown on screens, messages and the user agreement.', 'text', 'Company', true),
 ('company_place', '"Pune, Maharashtra, India"', 'Company place', 'Registered place', 'City / state shown with the company name.', 'text', 'Company', true),
 ('company_website', '"cruxindia.co.in"', 'Company website', 'Website', 'Shown under the logo.', 'text', 'Company', true),
 ('company_address', '""', 'Company address', 'Registered address', 'Full address for the agreement footer (optional).', 'text', 'Company', true),
 ('agreement_version', '"v1"', 'Current user agreement version', 'User agreement version', 'Changing this asks everyone to accept the agreement again.', 'text', 'Company', true),
 ('go_live_date', '"2026-11-04"', 'First day misses are raised', 'Misses are raised from', 'Days before this date never create a miss.', 'text', 'Daily reporting', true),
 ('task_sync_at', '"2000-01-01T00:00:00Z"', 'internal', null, null, null, 'System', false)
on conflict (key) do nothing;

-- ------------------------------------------------------------------ colleagues at the same location
create or replace function app.shares_location(p_client_location uuid, p_date date) returns boolean
language sql stable security definer set search_path = public, app, pg_temp as $$
  select exists (select 1 from public.client_locations cl
                  where cl.id = p_client_location and (
                    exists (select 1 from public.location_heads h where h.person_id = app.me() and h.branch_id = cl.branch_id and h.valid @> p_date)
                    or exists (select 1 from public.allocations a join public.client_locations c2 on c2.id = a.client_location_id
                                where a.person_id = app.me() and c2.branch_id = cl.branch_id and a.valid @> p_date)))
$$;
create policy read_lines_same_location on public.productivity_lines for select to authenticated
  using (app.shares_location(client_location_id, work_date));

-- ------------------------------------------------------------------ TAT pending buckets
alter table public.productivity_lines add column if not exists tat_0_1 int check (tat_0_1 >= 0);
alter table public.productivity_lines add column if not exists tat_1_2 int check (tat_1_2 >= 0);
alter table public.productivity_lines add column if not exists tat_2_4 int check (tat_2_4 >= 0);
alter table public.productivity_lines add column if not exists tat_4_7 int check (tat_4_7 >= 0);
alter table public.productivity_lines add column if not exists tat_7_15 int check (tat_7_15 >= 0);
alter table public.productivity_lines add column if not exists tat_15p int check (tat_15p >= 0);
alter table public.productivity_lines add column if not exists tat_note text;

-- Pending (WIP) carried in: last reported pending total, else an opening balance plus movements since, else unknown (null).
create or replace function app.prev_pending(p_person uuid, p_cl uuid, p_date date) returns int
language sql stable security definer set search_path = public, app, pg_temp as $$
  select coalesce(
    (select l.tat_0_1 + l.tat_1_2 + l.tat_2_4 + l.tat_4_7 + l.tat_7_15 + l.tat_15p
       + coalesce((select sum(x.entry - x.closure - x.cancelled) from public.productivity_lines x
                    where x.person_id = p_person and x.client_location_id = p_cl and x.work_date > l.work_date and x.work_date < p_date), 0)
       from public.productivity_lines l
      where l.person_id = p_person and l.client_location_id = p_cl and l.work_date < p_date and l.tat_0_1 is not null
      order by l.work_date desc limit 1),
    (select w.opening + coalesce((select sum(x.entry - x.closure - x.cancelled) from public.productivity_lines x
                    where x.person_id = p_person and x.client_location_id = p_cl and x.work_date >= w.as_of and x.work_date < p_date), 0)
       from public.wip_openings w where w.person_id = p_person and w.client_location_id = p_cl and w.as_of <= p_date
      order by w.as_of desc limit 1))::int
$$;

create or replace function public.save_pending(p_work_date date, p_rows jsonb, p_person uuid default null, p_reason text default null)
returns int
language plpgsql security definer set search_path = public, app, pg_temp as $$
declare v_me uuid := app.me(); v_person uuid := coalesce(p_person, app.me()); r jsonb; v_status text; n int := 0;
begin
  if v_me is null then raise exception 'Not signed in' using errcode = '28000'; end if;
  if v_person <> v_me and not app.is_direct_report(v_person, 'operations', p_work_date) then
    raise exception 'You can only enter figures for your direct reports.' using errcode = '42501';
  end if;
  perform app.require_writable(v_person, p_work_date, 'operations');
  select status into v_status from public.day_status where person_id = v_person and work_date = p_work_date and function = 'operations';
  if v_status is not null and v_status <> 'draft' and not app.active_reopen(v_person, p_work_date, 'operations') then
    raise exception 'This day is already %. Ask an Admin to reopen it to make changes.', replace(v_status, '_', ' ') using errcode = 'P0001';
  end if;
  perform set_config('app.reason', coalesce(p_reason, 'pending buckets'), true);
  for r in select * from jsonb_array_elements(coalesce(p_rows, '[]')) loop
    if not exists (select 1 from public.allocations a where a.person_id = v_person and a.function = 'operations'
                    and a.client_location_id = (r->>'client_location_id')::uuid and a.valid @> p_work_date) then
      raise exception 'Client/location is not active for this person on %.', p_work_date using errcode = '42501';
    end if;
    insert into public.productivity_lines as l (person_id, work_date, client_location_id, source, entered_by,
           tat_0_1, tat_1_2, tat_2_4, tat_4_7, tat_7_15, tat_15p, tat_note, reason)
    values (v_person, p_work_date, (r->>'client_location_id')::uuid, case when v_person = v_me then 'self' else 'on_behalf' end, v_me,
            (r->>'tat_0_1')::int, (r->>'tat_1_2')::int, (r->>'tat_2_4')::int, (r->>'tat_4_7')::int, (r->>'tat_7_15')::int, (r->>'tat_15p')::int,
            nullif(trim(r->>'tat_note'), ''), case when v_person = v_me then null else coalesce(nullif(p_reason, ''), 'entered by manager') end)
    on conflict (person_id, work_date, client_location_id) do update
      set tat_0_1 = excluded.tat_0_1, tat_1_2 = excluded.tat_1_2, tat_2_4 = excluded.tat_2_4, tat_4_7 = excluded.tat_4_7,
          tat_7_15 = excluded.tat_7_15, tat_15p = excluded.tat_15p, tat_note = excluded.tat_note, updated_at = now();
    n := n + 1;
  end loop;
  return n;
end $$;

-- ------------------------------------------------------------------ HR profile, salary, agreement
create table public.hr_profiles (
  person_id uuid primary key references public.persons(id),
  date_of_birth date, joining_date date, gender text,
  current_address text, permanent_address text, city text, state text, pincode text,
  emergency_name text, emergency_relation text, emergency_phone text,
  pan_last4 text, aadhaar_last4 text, bank_name text, bank_ifsc text, bank_account_last4 text,
  highest_qualification text, firm_name text,
  completed_at timestamptz, updated_at timestamptz not null default now(),
  check (pincode is null or pincode ~ '^\d{6}$'), check (emergency_phone is null or emergency_phone ~ '^\d{10}$'),
  check (pan_last4 is null or pan_last4 ~ '^[A-Z0-9]{4}$'), check (aadhaar_last4 is null or aadhaar_last4 ~ '^\d{4}$'),
  check (bank_account_last4 is null or bank_account_last4 ~ '^\d{4}$'), check (bank_ifsc is null or bank_ifsc ~ '^[A-Z]{4}0[A-Z0-9]{6}$')
);
create table public.hr_compensation (
  id uuid primary key default gen_random_uuid(),
  person_id uuid not null references public.persons(id),
  monthly_gross numeric(12,2) not null check (monthly_gross > 0),
  effective_from date not null,
  note text, set_by uuid references public.persons(id), created_at timestamptz not null default now()
);
create table public.agreement_versions (
  version text primary key, title text not null, body text not null, created_at timestamptz not null default now()
);
create table public.agreement_acceptances (
  id uuid primary key default gen_random_uuid(),
  person_id uuid not null references public.persons(id),
  version text not null references public.agreement_versions(version),
  typed_name text not null, accepted_at timestamptz not null default now(),
  ip text, user_agent text, body_md5 text not null,
  unique (person_id, version)
);
alter table public.hr_profiles enable row level security;
alter table public.hr_compensation enable row level security;
alter table public.agreement_versions enable row level security;
alter table public.agreement_acceptances enable row level security;
create policy read_hr_profile on public.hr_profiles for select to authenticated
  using (person_id = app.me() or app.is_admin() or app.has_role('hr_admin'));
create policy read_salary on public.hr_compensation for select to authenticated
  using (person_id = app.me() or app.is_admin() or app.has_role('hr_admin') or app.is_direct_report(person_id, 'operations', app.today()));
create policy read_agreements on public.agreement_versions for select to authenticated using (true);
create policy read_acceptances on public.agreement_acceptances for select to authenticated
  using (person_id = app.me() or app.is_admin() or app.has_role('hr_admin'));
revoke all on public.hr_profiles, public.hr_compensation, public.agreement_versions, public.agreement_acceptances from anon;
revoke all on public.hr_profiles, public.hr_compensation, public.agreement_versions, public.agreement_acceptances from authenticated;
grant select on public.hr_profiles, public.hr_compensation, public.agreement_versions, public.agreement_acceptances to authenticated;
create trigger trg_audit after insert or update on public.hr_profiles for each row execute function app.audit();
create trigger trg_audit after insert or update on public.hr_compensation for each row execute function app.audit();
create trigger trg_audit after insert on public.agreement_acceptances for each row execute function app.audit();

insert into public.agreement_versions(version, title, body) values ('v1', 'User agreement — confidentiality, data integrity and acceptable use',
$agr$This agreement is between you (the "User") and Crux Risk Management Pvt. Ltd. ("CRUX") for use of the CRUX Productivity application (the "App"). It applies to CRUX employees and to Business Associates / partners and their staff.

1. Confidentiality. Everything you see or handle in the App or through your work — client names, bank and customer information, case details, rates, targets, revenue, collections, colleagues' personal and salary information — is confidential. You will use it only for your CRUX work, will not copy, photograph, forward or disclose it to anyone who is not authorised, and will keep it confidential during and after your association with CRUX.

2. Truthful and complete reporting. Every figure you enter or certify (cases entered, closed, cancelled, pending by age, attendance, bills raised, collections, profile details) will be true, complete and entered on time to the best of your knowledge. You will not inflate, hide, shift or back-date figures. If you find a mistake you will correct it in the App with a note. Managers certify only what they have checked.

3. Data integrity and audit. You understand that the App records who entered or changed what and when, that records are audited, and that corrections keep the earlier values. You will not attempt to alter, remove or bypass records, controls or approvals.

4. Your account. Your login is personal. You will not share your password or one-time codes, let anyone else use your account, or use anyone else's. You will tell your manager immediately if you suspect misuse.

5. Personal data. You will handle personal data of customers and colleagues only as your work requires and in line with applicable law, including the Digital Personal Data Protection Act, 2023. Your own profile data is used by CRUX for employment / engagement, payroll / payout and compliance purposes and is visible only to you, HR and Admin (salary also to your manager).

6. Acceptable use. You will use the App only for CRUX work, will not try to access data you are not meant to see, and will not upload anything unlawful or harmful.

7. On leaving. When your employment or engagement ends you will stop using the App and keep the confidentiality obligations above.

8. Breach. Breach of this agreement may lead to disciplinary or contractual action under CRUX policy and your employment / engagement terms, and to legal remedies where applicable.

9. Electronic acceptance. Accepting below by typing your name is your electronic signature. CRUX records the date, time, network address and device of your acceptance.$agr$)
on conflict (version) do nothing;

create or replace function app.profile_missing(p_person uuid) returns text[]
language sql stable security definer set search_path = public, app, pg_temp as $$
  select array_remove(array[
    case when h.date_of_birth is null then 'date of birth' end, case when h.joining_date is null then 'joining / association date' end,
    case when coalesce(h.current_address, '') = '' then 'current address' end, case when coalesce(h.permanent_address, '') = '' then 'permanent address' end,
    case when coalesce(h.city, '') = '' then 'city' end, case when coalesce(h.state, '') = '' then 'state' end, case when h.pincode is null then 'PIN code' end,
    case when coalesce(h.emergency_name, '') = '' then 'emergency contact name' end, case when coalesce(h.emergency_relation, '') = '' then 'emergency contact relation' end,
    case when h.emergency_phone is null then 'emergency contact mobile' end, case when h.pan_last4 is null then 'PAN (last 4)' end,
    case when h.aadhaar_last4 is null then 'Aadhaar (last 4)' end, case when coalesce(h.bank_name, '') = '' then 'bank name' end,
    case when h.bank_ifsc is null then 'IFSC' end, case when h.bank_account_last4 is null then 'bank account (last 4)' end,
    case when coalesce(h.highest_qualification, '') = '' then 'highest qualification' end,
    case when p.resource_type = 'partner' and coalesce(h.firm_name, '') = '' then 'firm name' end,
    case when coalesce(p.personal_email, '') = '' then 'email' end], null)
    from public.persons p left join public.hr_profiles h on h.person_id = p.id where p.id = p_person
$$;
create or replace function app.agreement_ok(p_person uuid) returns boolean
language sql stable security definer set search_path = public, app, pg_temp as $$
  select exists (select 1 from public.agreement_acceptances a where a.person_id = p_person and a.version = (app.setting('agreement_version') #>> '{}'))
$$;
create or replace function app.onboarding_ok(p_person uuid) returns boolean
language sql stable security definer set search_path = public, app, pg_temp as $$
  select app.agreement_ok(p_person) and coalesce(array_length(app.profile_missing(p_person), 1), 0) = 0
$$;

create or replace function public.save_my_profile(p jsonb) returns jsonb
language plpgsql security definer set search_path = public, app, pg_temp as $$
declare v_me uuid := app.me(); v_missing text[];
begin
  if v_me is null then raise exception 'Not signed in' using errcode = '28000'; end if;
  perform set_config('app.reason', 'profile updated by self', true);
  if coalesce(p->>'email', '') <> '' then
    if (p->>'email') !~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'Enter a valid email.' using errcode = '22023'; end if;
    update public.persons set personal_email = lower(trim(p->>'email')) where id = v_me;
  end if;
  insert into public.hr_profiles as h (person_id, date_of_birth, joining_date, gender, current_address, permanent_address, city, state, pincode,
     emergency_name, emergency_relation, emergency_phone, pan_last4, aadhaar_last4, bank_name, bank_ifsc, bank_account_last4,
     highest_qualification, firm_name, updated_at)
  values (v_me, nullif(p->>'date_of_birth', '')::date, nullif(p->>'joining_date', '')::date, nullif(p->>'gender', ''),
     nullif(trim(p->>'current_address'), ''), nullif(trim(p->>'permanent_address'), ''), nullif(trim(p->>'city'), ''), nullif(trim(p->>'state'), ''),
     nullif(regexp_replace(coalesce(p->>'pincode', ''), '\D', '', 'g'), ''), nullif(trim(p->>'emergency_name'), ''), nullif(trim(p->>'emergency_relation'), ''),
     nullif(right(regexp_replace(coalesce(p->>'emergency_phone', ''), '\D', '', 'g'), 10), ''), nullif(upper(trim(p->>'pan_last4')), ''),
     nullif(trim(p->>'aadhaar_last4'), ''), nullif(trim(p->>'bank_name'), ''), nullif(upper(trim(p->>'bank_ifsc')), ''),
     nullif(trim(p->>'bank_account_last4'), ''), nullif(trim(p->>'highest_qualification'), ''), nullif(trim(p->>'firm_name'), ''), now())
  on conflict (person_id) do update set date_of_birth = excluded.date_of_birth, joining_date = excluded.joining_date, gender = excluded.gender,
     current_address = excluded.current_address, permanent_address = excluded.permanent_address, city = excluded.city, state = excluded.state,
     pincode = excluded.pincode, emergency_name = excluded.emergency_name, emergency_relation = excluded.emergency_relation,
     emergency_phone = excluded.emergency_phone, pan_last4 = excluded.pan_last4, aadhaar_last4 = excluded.aadhaar_last4,
     bank_name = excluded.bank_name, bank_ifsc = excluded.bank_ifsc, bank_account_last4 = excluded.bank_account_last4,
     highest_qualification = excluded.highest_qualification, firm_name = excluded.firm_name, updated_at = now();
  if nullif(p->>'date_of_birth', '')::date > app.today() - 18 * 365 then raise exception 'Date of birth must be at least 18 years ago.' using errcode = '22023'; end if;
  v_missing := app.profile_missing(v_me);
  update public.hr_profiles set completed_at = case when coalesce(array_length(v_missing, 1), 0) = 0 then coalesce(completed_at, now()) end where person_id = v_me;
  return jsonb_build_object('missing', to_jsonb(coalesce(v_missing, '{}')), 'complete', coalesce(array_length(v_missing, 1), 0) = 0);
end $$;

create or replace function public.accept_agreement(p_version text, p_typed_name text, p_user_agent text default null) returns public.agreement_acceptances
language plpgsql security definer set search_path = public, app, pg_temp as $$
declare v_me uuid := app.me(); v_a public.agreement_acceptances; v_body text; v_hdr json;
begin
  if v_me is null then raise exception 'Not signed in' using errcode = '28000'; end if;
  if p_version <> (app.setting('agreement_version') #>> '{}') then raise exception 'Please reload: a newer agreement is in force.' using errcode = 'P0001'; end if;
  if length(trim(coalesce(p_typed_name, ''))) < 3 then raise exception 'Type your full name to sign.' using errcode = 'P0001'; end if;
  select body into v_body from public.agreement_versions where version = p_version;
  begin v_hdr := current_setting('request.headers', true)::json; exception when others then v_hdr := null; end;
  perform set_config('app.reason', 'user agreement accepted', true);
  insert into public.agreement_acceptances(person_id, version, typed_name, ip, user_agent, body_md5)
  values (v_me, p_version, trim(p_typed_name), split_part(coalesce(v_hdr->>'x-forwarded-for', v_hdr->>'x-real-ip', ''), ',', 1), left(p_user_agent, 300), md5(v_body))
  on conflict (person_id, version) do nothing
  returning * into v_a;
  return v_a;
end $$;

create or replace function public.set_salary(p_person uuid, p_monthly_gross numeric, p_effective_from date, p_note text default null)
returns public.hr_compensation
language plpgsql security definer set search_path = public, app, pg_temp as $$
declare v_c public.hr_compensation;
begin
  if not (app.is_admin() or app.has_role('hr_admin') or app.is_direct_report(p_person, 'operations', app.today())
          or app.is_direct_report(p_person, 'collections', app.today())) then
    raise exception 'Only the person''s manager, HR or Admin can set salary.' using errcode = '42501';
  end if;
  if (select resource_type from public.persons where id = p_person) = 'partner' then
    raise exception 'Business Associates are paid by agreement, not salary.' using errcode = 'P0001';
  end if;
  perform set_config('app.reason', coalesce(p_note, 'salary set'), true);
  insert into public.hr_compensation(person_id, monthly_gross, effective_from, note, set_by)
  values (p_person, p_monthly_gross, p_effective_from, p_note, app.me()) returning * into v_c;
  return v_c;
end $$;

-- Gate: figures can only be entered by people who accepted the agreement and completed their profile.
create or replace function app.require_writable(p_person uuid, p_date date, p_fn app.fn) returns void
language plpgsql stable as $$
begin
  if p_person = app.me() and not app.onboarding_ok(p_person) then
    raise exception 'Before entering figures, accept the user agreement and complete your profile (Profile page).' using errcode = 'P0001';
  end if;
  if app.window_state(p_date) = 'future' then
    raise exception 'You cannot report for a future date (%).', p_date using errcode = 'P0001';
  end if;
  if not app.can_write_day(p_person, p_date, p_fn) then
    raise exception 'The reporting window for % is closed. Ask an Admin to reopen it.', p_date using errcode = 'P0001';
  end if;
end $$;
alter function app.require_writable(uuid, date, app.fn) set search_path = public, app, pg_temp;

create or replace function public.whoami() returns jsonb
language sql stable security definer set search_path = public, app, pg_temp as $$
  select case when app.me() is null then null else jsonb_build_object(
    'person_id', p.id, 'full_name', p.full_name, 'designation', p.designation, 'status', p.status, 'mobile', p.mobile,
    'resource_type', p.resource_type,
    'roles', (select coalesce(jsonb_agg(distinct r.role), '[]') from public.role_assignments r where r.person_id = p.id and r.valid @> app.today()),
    'manages_operations', app.has_reports(p.id, 'operations', app.today()),
    'manages_collections', app.has_reports(p.id, 'collections', app.today()),
    'has_collections', exists (select 1 from public.reporting_lines r where r.person_id = p.id and r.function = 'collections' and r.valid @> app.today())
                       or app.has_reports(p.id, 'collections', app.today()),
    'heads_locations', exists (select 1 from public.location_heads h where h.person_id = p.id and h.valid @> app.today()),
    'agreement_version', app.setting('agreement_version') #>> '{}',
    'agreement_ok', app.agreement_ok(p.id), 'profile_missing', to_jsonb(coalesce(app.profile_missing(p.id), '{}')),
    'company', jsonb_build_object('name', app.setting('company_name') #>> '{}', 'place', app.setting('company_place') #>> '{}',
                                  'website', app.setting('company_website') #>> '{}', 'address', app.setting('company_address') #>> '{}'),
    'today', app.today(), 'tz', app.tz(), 'server_time', app.clock())
  end
  from public.persons p where p.id = app.me()
$$;

-- ------------------------------------------------------------------ daily bills & collections for location heads
create or replace function public.my_money_rows(p_date date default null)
returns table(branch_id uuid, branch text, client_id uuid, client text, bill_count int, bill_amount numeric, collected numeric)
language sql stable security definer set search_path = public, app, pg_temp as $$
  with heads as (
    select distinct cl.branch_id, cl.client_id from public.location_heads h
      join public.client_locations cl on cl.branch_id = h.branch_id and (h.client_id is null or h.client_id = cl.client_id)
     where h.person_id = app.me() and h.head_role = 'branch_head' and h.valid @> coalesce(p_date, app.today()) and cl.valid @> coalesce(p_date, app.today())
       and not exists (select 1 from public.location_heads h2 where h2.branch_id = h.branch_id and h2.head_role = 'branch_head' and h2.client_id = cl.client_id
                        and h2.person_id <> app.me() and h.client_id is null and h2.valid @> coalesce(p_date, app.today())))
  select k.branch_id, b.name, k.client_id, c.name,
         (select be.bill_count from public.bill_entries be where be.person_id = app.me() and be.bill_date = coalesce(p_date, app.today()) and be.branch_id = k.branch_id and be.client_id = k.client_id and be.reference = 'daily' limit 1),
         (select be.bill_amount from public.bill_entries be where be.person_id = app.me() and be.bill_date = coalesce(p_date, app.today()) and be.branch_id = k.branch_id and be.client_id = k.client_id and be.reference = 'daily' limit 1),
         (select ce.amount_received from public.collection_entries ce where ce.person_id = app.me() and ce.collection_date = coalesce(p_date, app.today()) and ce.branch_id = k.branch_id and ce.client_id = k.client_id and ce.reference = 'daily' limit 1)
    from heads k join public.branches b on b.id = k.branch_id join public.clients c on c.id = k.client_id
   order by b.name, c.name
$$;

create or replace function public.save_money_day(p_date date, p_rows jsonb) returns int
language plpgsql security definer set search_path = public, app, pg_temp as $$
declare r jsonb; v_me uuid := app.me(); n int := 0;
begin
  if v_me is null then raise exception 'Not signed in' using errcode = '28000'; end if;
  perform app.require_writable(v_me, p_date, 'operations');
  perform set_config('app.reason', 'daily bills and collections', true);
  for r in select * from jsonb_array_elements(coalesce(p_rows, '[]')) loop
    if not exists (select 1 from public.my_money_rows(p_date) m where m.branch_id = (r->>'branch_id')::uuid and m.client_id = (r->>'client_id')::uuid) then
      raise exception 'You do not head that client at that location.' using errcode = '42501';
    end if;
    if r->>'bill_count' is null or r->>'bill_amount' is null or r->>'collected' is null then
      raise exception 'Bills raised (count and amount) and amount collected are all required; enter 0 if none.' using errcode = 'P0001';
    end if;
    update public.bill_entries set bill_count = (r->>'bill_count')::int, bill_amount = (r->>'bill_amount')::numeric
     where person_id = v_me and bill_date = p_date and branch_id = (r->>'branch_id')::uuid and client_id = (r->>'client_id')::uuid and reference = 'daily';
    if not found then
      insert into public.bill_entries(person_id, bill_date, client_id, branch_id, bill_count, bill_amount, reference, entered_by)
      values (v_me, p_date, (r->>'client_id')::uuid, (r->>'branch_id')::uuid, (r->>'bill_count')::int, (r->>'bill_amount')::numeric, 'daily', v_me);
    end if;
    update public.collection_entries set amount_received = (r->>'collected')::numeric
     where person_id = v_me and collection_date = p_date and branch_id = (r->>'branch_id')::uuid and client_id = (r->>'client_id')::uuid and reference = 'daily';
    if not found then
      insert into public.collection_entries(person_id, collection_date, client_id, branch_id, amount_received, reference, source, entered_by)
      values (v_me, p_date, (r->>'client_id')::uuid, (r->>'branch_id')::uuid, (r->>'collected')::numeric, 'daily', 'self', v_me);
    end if;
    n := n + 1;
  end loop;
  return n;
end $$;

-- ------------------------------------------------------------------ tasks (misses and to-dos)
create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  kind text not null,
  category text not null check (category in ('miss','task')),
  dedupe_key text not null unique,
  title text not null,
  detail jsonb not null default '{}',
  owner_id uuid references public.persons(id),          -- who must act / reply; null = Admin
  subject_id uuid references public.persons(id),        -- who it is about
  branch_id uuid references public.branches(id), client_id uuid references public.clients(id),
  ref_date date, ref_month date,
  status text not null default 'open' check (status in ('open','replied','resolution_requested','info_requested','denied','resolved')),
  condition_cleared boolean not null default false,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  resolved_at timestamptz, resolved_by uuid references public.persons(id), resolution_note text
);
create index on public.tasks (owner_id, status);
create index on public.tasks (status, category);
create table public.task_events (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.tasks(id),
  actor_id uuid references public.persons(id),
  action text not null check (action in ('created','reply','request_resolution','proposal','resolve','deny','ask_info','auto_resolved','reopened','note')),
  note text, data jsonb, at timestamptz not null default now()
);
create index on public.task_events (task_id, at);
create or replace function app.task_visible(p_owner uuid, p_subject uuid) returns boolean
language sql stable security definer set search_path = public, app, pg_temp as $$
  select app.me() is not null and (app.is_admin() or app.has_role('hr_admin')
    or (p_owner is not null and app.can_view_person(p_owner, app.today(), 'operations'))
    or (p_subject is not null and app.can_view_person(p_subject, app.today(), 'operations')))
$$;
alter table public.tasks enable row level security;
alter table public.task_events enable row level security;
create policy read_tasks on public.tasks for select to authenticated using (app.task_visible(owner_id, subject_id));
create policy read_task_events on public.task_events for select to authenticated
  using (exists (select 1 from public.tasks t where t.id = task_id and app.task_visible(t.owner_id, t.subject_id)));
revoke all on public.tasks, public.task_events from anon;
revoke all on public.tasks, public.task_events from authenticated;
grant select on public.tasks, public.task_events to authenticated;
create trigger trg_audit after insert or update on public.tasks for each row execute function app.audit();

create or replace function app.task_upsert(p_kind text, p_cat text, p_key text, p_owner uuid, p_subject uuid, p_title text, p_detail jsonb,
    p_branch uuid default null, p_client uuid default null, p_date date default null, p_month date default null) returns void
language plpgsql security definer set search_path = public, app, pg_temp as $$
declare v_id uuid;
begin
  insert into public.tasks(kind, category, dedupe_key, title, detail, owner_id, subject_id, branch_id, client_id, ref_date, ref_month)
  values (p_kind, p_cat, p_key, p_title, coalesce(p_detail, '{}'), p_owner, p_subject, p_branch, p_client, p_date, p_month)
  on conflict (dedupe_key) do update set title = excluded.title, detail = excluded.detail, owner_id = excluded.owner_id,
         condition_cleared = false, updated_at = now()
   where public.tasks.status <> 'resolved'
  returning id into v_id;
  if v_id is not null and not exists (select 1 from public.task_events e where e.task_id = v_id) then
    insert into public.task_events(task_id, action, note) values (v_id, 'created', p_title);
  end if;
end $$;

create or replace function app.manager_of(p_person uuid) returns uuid
language sql stable security definer set search_path = public, app, pg_temp as $$
  select r.manager_id from public.reporting_lines r where r.person_id = p_person and r.valid @> app.today()
   order by (r.function = 'operations') desc limit 1
$$;

-- Generates / refreshes tasks for the whole organisation. Cheap and idempotent; runs at most every 10 minutes.
create or replace function public.sync_tasks(p_force boolean default false) returns jsonb
language plpgsql security definer set search_path = public, app, pg_temp as $$
declare v_last timestamptz := (app.setting('task_sync_at') #>> '{}')::timestamptz; v_live date := (app.setting('go_live_date') #>> '{}')::date;
        v_today date := app.today(); v_m date := date_trunc('month', app.today())::date; d date; r record; v_wd int; v_wt int;
begin
  if app.me() is null then raise exception 'Not signed in' using errcode = '28000'; end if;
  if not p_force and v_last > app.clock() - interval '10 minutes' then return jsonb_build_object('skipped', true); end if;
  update public.settings set value = to_jsonb(app.clock()) where key = 'task_sync_at';
  perform set_config('app.reason', 'task sync', true);

  -- Misses: no report for a working day after its window closed.
  for d in select g::date from generate_series(greatest(v_live, v_today - 7), v_today - 1, interval '1 day') g loop
    continue when not app.is_working_day(d) or app.window_state(d) <> 'closed';
    for r in select p.id, p.full_name from public.persons p
              where p.status = 'active'
                and exists (select 1 from public.allocations a where a.person_id = p.id and a.function = 'operations' and a.valid @> d)
                and not exists (select 1 from public.day_status s where s.person_id = p.id and s.work_date = d and s.function = 'operations'
                                 and s.status in ('submitted','manager_entered','absent','on_leave','non_operational','exception'))
                and not exists (select 1 from public.attendance t where t.person_id = p.id and t.work_date = d
                                 and t.status in ('planned_leave','unplanned_leave','weekly_off','holiday'))
    loop
      perform app.task_upsert('missed_submission', 'miss', 'missed_submission:' || r.id || ':' || d, r.id, r.id,
        'No daily figures reported for ' || to_char(d, 'DD Mon YYYY'), jsonb_build_object('date', d), null, null, d, null);
    end loop;
    -- Managers who did not certify their team.
    for r in select distinct m.id from public.reporting_lines rl join public.persons m on m.id = rl.manager_id
              where rl.function = 'operations' and rl.valid @> d and m.status = 'active'
                and not exists (select 1 from public.certifications c where c.manager_id = m.id and c.work_date = d and c.function = 'operations')
    loop
      perform app.task_upsert('uncertified_team', 'miss', 'uncertified_team:' || r.id || ':' || d, r.id, r.id,
        'Team figures not certified for ' || to_char(d, 'DD Mon YYYY'), jsonb_build_object('date', d), null, null, d, null);
    end loop;
  end loop;

  -- Misses: location × client behind pace on its target (from the 5th working day; refreshed every sync).
  v_wd := app.working_days_between(v_m, v_today - 1); v_wt := app.working_days_between(v_m, (v_m + interval '1 month - 1 day')::date);
  if v_wd >= 5 and v_today > v_live then
    for r in select t.branch_id, t.client_id, t.amount, b.name branch, c.name client,
                    coalesce((select sum(l.entry - l.cancelled) from public.productivity_lines l join public.client_locations cl on cl.id = l.client_location_id
                               where cl.branch_id = t.branch_id and cl.client_id = t.client_id and l.work_date between v_m and v_today - 1), 0) actual
               from public.target_allocations t join public.branches b on b.id = t.branch_id join public.clients c on c.id = t.client_id
              where t.is_current and t.month = v_m and t.metric = 'entry' and t.level = 'branch' and t.amount > 0
    loop
      if r.actual < 0.9 * r.amount * v_wd / v_wt then
        perform app.task_upsert('behind_target', 'miss', 'behind_target:' || r.branch_id || ':' || r.client_id || ':' || v_m,
          coalesce(app.head_of(r.branch_id, r.client_id, 'branch_head', v_today), app.head_of(r.branch_id, r.client_id, 'zonal_manager', v_today)), null,
          r.branch || ' · ' || r.client || ' is behind target this month',
          jsonb_build_object('target', r.amount, 'actual', r.actual, 'pro_rata', round(r.amount * v_wd / v_wt), 'achievement_pct', round(r.actual / r.amount * 100, 1),
                             'elapsed_pct', round(v_wd::numeric / v_wt * 100, 1), 'working_day', v_wd, 'working_days', v_wt), r.branch_id, r.client_id, null, v_m);
      else
        update public.tasks set condition_cleared = true, updated_at = now()
         where dedupe_key = 'behind_target:' || r.branch_id || ':' || r.client_id || ':' || v_m and status <> 'resolved' and not condition_cleared;
      end if;
    end loop;
  end if;

  -- To-do: services with a target or figures this month but no rate (managers may propose one; Admin approves).
  for r in select distinct cl.branch_id, cl.client_id, b.name branch, c.name client from public.client_locations cl
             join public.branches b on b.id = cl.branch_id join public.clients c on c.id = cl.client_id
            where cl.valid @> v_today
              and not exists (select 1 from public.rate_cards rc where rc.client_id = cl.client_id and rc.location_id = cl.location_id and rc.process_id = cl.process_id and rc.valid @> v_today)
              and (exists (select 1 from public.target_allocations t where t.is_current and t.month = v_m and t.branch_id = cl.branch_id and t.client_id = cl.client_id and t.amount > 0)
                   or exists (select 1 from public.productivity_lines l where l.client_location_id = cl.id and l.work_date >= v_m and l.entry > 0))
  loop
    perform app.task_upsert('missing_rate', 'task', 'missing_rate:' || r.branch_id || ':' || r.client_id,
      app.head_of(r.branch_id, r.client_id, 'zonal_manager', v_today), null, 'No per-case rate for ' || r.client || ' at ' || r.branch,
      jsonb_build_object('branch', r.branch, 'client', r.client), r.branch_id, r.client_id, null, null);
  end loop;
  update public.tasks t set status = 'resolved', resolved_at = now(), resolution_note = 'Rate added', updated_at = now()
   where t.kind = 'missing_rate' and t.status <> 'resolved'
     and exists (select 1 from public.client_locations cl join public.rate_cards rc on rc.client_id = cl.client_id and rc.location_id = cl.location_id
                  and rc.process_id = cl.process_id and rc.valid @> v_today where cl.branch_id = t.branch_id and cl.client_id = t.client_id);

  -- To-do: get people onboarded (manager); ask leaders to add their team; salary; own profile.
  for r in select p.id, p.full_name from public.persons p where p.status = 'invited' loop
    perform app.task_upsert('onboarding', 'task', 'onboarding:' || r.id, app.manager_of(r.id), r.id,
      'Get ' || r.full_name || ' onboarded: send the activation message and make sure they sign in', '{}'::jsonb);
  end loop;
  for r in select distinct p.id, p.full_name from public.persons p join public.role_assignments ra on ra.person_id = p.id and ra.valid @> v_today
            where p.status in ('active','invited') and ra.role in ('zm','bm','ba','manager','ops_head','collections_head') loop
    perform app.task_upsert('add_team', 'task', 'add_team:' || r.id, r.id, r.id,
      'Add all your team members (one by one or by bulk upload) and tick their clients', '{}'::jsonb);
  end loop;
  for r in select p.id, p.full_name from public.persons p
            where p.status in ('active','invited') and p.resource_type = 'own_employee' and app.manager_of(p.id) is not null
              and not exists (select 1 from public.hr_compensation h where h.person_id = p.id) loop
    perform app.task_upsert('salary_missing', 'task', 'salary:' || r.id, app.manager_of(r.id), r.id, 'Enter monthly salary for ' || r.full_name, '{}'::jsonb);
  end loop;
  for r in select p.id, p.full_name from public.persons p where p.status = 'active' and not app.onboarding_ok(p.id) loop
    perform app.task_upsert('profile_incomplete', 'task', 'profile:' || r.id, r.id, r.id, 'Complete your profile and accept the user agreement', '{}'::jsonb);
  end loop;

  -- Close to-dos whose condition is now met (misses are only ever closed by Admin).
  update public.tasks t set status = 'resolved', resolved_at = now(), resolution_note = 'Done', updated_at = now()
   where t.category = 'task' and t.status <> 'resolved' and (
        (t.kind = 'onboarding' and (select status from public.persons where id = t.subject_id) = 'active')
     or (t.kind = 'salary_missing' and exists (select 1 from public.hr_compensation h where h.person_id = t.subject_id))
     or (t.kind = 'profile_incomplete' and app.onboarding_ok(t.subject_id)));
  insert into public.task_events(task_id, action, note)
  select t.id, 'auto_resolved', t.resolution_note from public.tasks t
   where t.status = 'resolved' and t.resolved_by is null and t.resolved_at > now() - interval '5 seconds'
     and not exists (select 1 from public.task_events e where e.task_id = t.id and e.action = 'auto_resolved');
  return jsonb_build_object('open', (select count(*) from public.tasks where status <> 'resolved'));
end $$;

create or replace function public.my_tasks(p_scope text default 'all')
returns table(id uuid, kind text, category text, title text, detail jsonb, status text, condition_cleared boolean,
              owner_id uuid, owner_name text, subject_name text, branch text, client text, ref_date date, ref_month date,
              created_at timestamptz, updated_at timestamptz, scope text, last_note text, last_action text, last_at timestamptz)
language plpgsql stable security definer set search_path = public, app, pg_temp as $$
declare v_me uuid := app.me(); v_admin boolean := app.is_admin();
begin
  if v_me is null then raise exception 'Not signed in' using errcode = '28000'; end if;
  return query
  select t.id, t.kind, t.category, t.title, t.detail, t.status, t.condition_cleared, t.owner_id, o.full_name, s.full_name, b.name, c.name,
         t.ref_date, t.ref_month, t.created_at, t.updated_at,
         case when t.owner_id = v_me then 'mine' when v_admin and (t.owner_id is null or t.status = 'resolution_requested') then 'admin' else 'team' end,
         e.note, e.action, e.at
    from public.tasks t
    left join public.persons o on o.id = t.owner_id left join public.persons s on s.id = t.subject_id
    left join public.branches b on b.id = t.branch_id left join public.clients c on c.id = t.client_id
    left join lateral (select x.note, x.action, x.at from public.task_events x where x.task_id = t.id order by x.at desc limit 1) e on true
   where app.task_visible(t.owner_id, t.subject_id)
     and (p_scope = 'all' or (p_scope = 'open' and t.status <> 'resolved'))
   order by (t.status = 'resolved'), (t.owner_id is distinct from v_me), t.category, t.updated_at desc
   limit 500;
end $$;

create or replace function app.task_can_act(p_task uuid) returns boolean
language sql stable security definer set search_path = public, app, pg_temp as $$
  select exists (select 1 from public.tasks t where t.id = p_task and (t.owner_id = app.me() or app.is_admin()
     or (t.owner_id is not null and app.can_view_person(t.owner_id, app.today(), 'operations') and t.owner_id <> app.me())
     or (t.subject_id is not null and app.can_view_person(t.subject_id, app.today(), 'operations'))))
$$;

create or replace function public.task_reply(p_task uuid, p_note text) returns public.tasks
language plpgsql security definer set search_path = public, app, pg_temp as $$
declare v_t public.tasks;
begin
  if not app.task_can_act(p_task) then raise exception 'Not your task.' using errcode = '42501'; end if;
  if coalesce(trim(p_note), '') = '' then raise exception 'Write the reason / reply.' using errcode = 'P0001'; end if;
  perform set_config('app.reason', 'task reply', true);
  insert into public.task_events(task_id, actor_id, action, note) values (p_task, app.me(), 'reply', p_note);
  update public.tasks set status = case when status in ('open','denied','info_requested') then 'replied' else status end, updated_at = now()
   where id = p_task and status <> 'resolved' returning * into v_t;
  return v_t;
end $$;

create or replace function public.task_request_resolution(p_task uuid, p_reason text, p_proposal jsonb default null) returns public.tasks
language plpgsql security definer set search_path = public, app, pg_temp as $$
declare v_t public.tasks;
begin
  if not app.task_can_act(p_task) then raise exception 'Not your task.' using errcode = '42501'; end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'Give the reason it can be marked resolved.' using errcode = 'P0001'; end if;
  select * into v_t from public.tasks where id = p_task;
  if v_t.kind = 'missing_rate' and p_proposal is not null then
    if coalesce((p_proposal->>'rate')::numeric, 0) <= 0 then raise exception 'Enter the per-case rate.' using errcode = 'P0001'; end if;
  end if;
  perform set_config('app.reason', 'resolution requested', true);
  insert into public.task_events(task_id, actor_id, action, note, data)
  values (p_task, app.me(), case when p_proposal is null then 'request_resolution' else 'proposal' end, p_reason, p_proposal);
  update public.tasks set status = 'resolution_requested', updated_at = now() where id = p_task and status <> 'resolved' returning * into v_t;
  insert into public.notifications(person_id, kind, message, link)
  select ra.person_id, 'task_resolution', 'Resolution requested: ' || v_t.title, '/tasks'
    from public.role_assignments ra where ra.role = 'admin' and ra.valid @> app.today();
  return v_t;
end $$;

create or replace function public.admin_decide_task(p_task uuid, p_decision text, p_note text default null) returns public.tasks
language plpgsql security definer set search_path = public, app, pg_temp as $$
declare v_t public.tasks; v_p jsonb; v_loc text; v_branch text; v_client text; v_proc text;
begin
  if not app.is_admin() then raise exception 'Only Admin can decide.' using errcode = '42501'; end if;
  if p_decision not in ('resolve','deny','ask_info') then raise exception 'Unknown decision.' using errcode = '22023'; end if;
  if p_decision <> 'resolve' and coalesce(trim(p_note), '') = '' then raise exception 'Write a note for the person.' using errcode = 'P0001'; end if;
  select * into v_t from public.tasks where id = p_task for update;
  if v_t.status = 'resolved' then raise exception 'Already resolved.' using errcode = 'P0001'; end if;
  perform set_config('app.reason', 'task ' || p_decision, true);
  if p_decision = 'resolve' and v_t.kind = 'missing_rate' then
    select e.data into v_p from public.task_events e where e.task_id = p_task and e.action = 'proposal' order by e.at desc limit 1;
    if v_p is not null then
      select b.code, c.name into v_branch, v_client from public.branches b, public.clients c where b.id = v_t.branch_id and c.id = v_t.client_id;
      select l.name, pr.code into v_loc, v_proc from public.client_locations cl join public.locations l on l.id = cl.location_id
        join public.processes pr on pr.id = cl.process_id
       where cl.branch_id = v_t.branch_id and cl.client_id = v_t.client_id limit 1;
      perform app.bulk_row('rates', jsonb_build_object('client', v_client, 'location', v_loc, 'process', v_proc, 'rate', v_p->>'rate',
        'earns_on', coalesce(v_p->>'earns_on', 'entry'), 'valid_from', coalesce(v_p->>'valid_from', app.today()::text),
        'reason', 'Approved proposal: ' || coalesce(p_note, '')));
    end if;
  end if;
  insert into public.task_events(task_id, actor_id, action, note) values (p_task, app.me(), p_decision, p_note);
  update public.tasks set status = case p_decision when 'resolve' then 'resolved' when 'deny' then 'denied' else 'info_requested' end,
         resolved_at = case when p_decision = 'resolve' then now() end, resolved_by = case when p_decision = 'resolve' then app.me() end,
         resolution_note = case when p_decision = 'resolve' then p_note end, updated_at = now()
   where id = p_task returning * into v_t;
  if v_t.owner_id is not null then
    insert into public.notifications(person_id, kind, message, link)
    values (v_t.owner_id, 'task_decision', case p_decision when 'resolve' then 'Resolved: ' when 'deny' then 'Not resolved — action still needed: ' else 'More details needed: ' end
            || v_t.title || coalesce(' — ' || p_note, ''), '/tasks');
  end if;
  return v_t;
end $$;

-- TAT tally and full-field rules at submission; a tally difference needs a note and raises a miss for the manager to see.
create or replace function public.submit_day(p_work_date date, p_person uuid default null, p_reason text default null)
returns public.day_status
language plpgsql security definer set search_path = public, app, pg_temp as $$
declare
  v_me uuid := app.me(); v_person uuid := coalesce(p_person, v_me); v_ds public.day_status; v_missing int;
  v_state text := app.window_state(p_work_date);
  v_reopen boolean := app.active_reopen(coalesce(p_person, app.me()), p_work_date, 'operations');
  r record; v_bad text := ''; v_open int; v_sum int; v_exp int; v_strict boolean := p_work_date >= (app.setting('go_live_date') #>> '{}')::date;
begin
  if v_me is null then raise exception 'Not signed in' using errcode = '28000'; end if;
  if v_person <> v_me and not app.is_direct_report(v_person, 'operations', p_work_date) then
    raise exception 'You can only submit for your direct reports.' using errcode = '42501';
  end if;
  if v_person <> v_me and coalesce(trim(p_reason), '') = '' then
    raise exception 'A reason is required when submitting on behalf of someone.' using errcode = 'P0001';
  end if;
  perform app.require_writable(v_person, p_work_date, 'operations');
  select * into v_ds from public.day_status where person_id = v_person and work_date = p_work_date and function = 'operations';
  if v_ds.status in ('submitted','manager_entered') and not v_reopen then return v_ds; end if;
  if v_ds.status in ('absent','on_leave','non_operational','exception') and not v_reopen then
    raise exception 'This day is marked %. Ask your manager to change it first.', replace(v_ds.status,'_',' ') using errcode = 'P0001';
  end if;
  select count(*) into v_missing from public.allocations a
   where a.person_id = v_person and a.function = 'operations' and a.valid @> p_work_date
     and not exists (select 1 from public.productivity_lines l where l.person_id = v_person and l.work_date = p_work_date
                      and l.client_location_id = a.client_location_id
                      and (not v_strict or (l.tat_0_1 is not null and l.tat_1_2 is not null and l.tat_2_4 is not null
                                            and l.tat_4_7 is not null and l.tat_7_15 is not null and l.tat_15p is not null)));
  if v_missing > 0 and v_strict then
    raise exception '% client row(s) are incomplete: Entry, Closure, Cancelled and every pending bucket (0-1 … 15+ days) are required. Enter 0 where none.', v_missing
      using errcode = 'P0001';
  elsif v_missing > 0 then
    raise exception '% assigned client/location row(s) have no figures. Enter 0 where there was no work.', v_missing using errcode = 'P0001';
  end if;
  for r in select l.*, c.name client, lo.name location from public.productivity_lines l
             join public.client_locations cl on cl.id = l.client_location_id join public.clients c on c.id = cl.client_id
             join public.locations lo on lo.id = cl.location_id
            where l.person_id = v_person and l.work_date = p_work_date and v_strict loop
    v_open := app.prev_pending(v_person, r.client_location_id, p_work_date);
    continue when v_open is null or r.tat_0_1 is null;
    v_sum := r.tat_0_1 + r.tat_1_2 + r.tat_2_4 + r.tat_4_7 + r.tat_7_15 + r.tat_15p;
    v_exp := v_open + r.entry - r.closure - r.cancelled;
    if v_sum <> v_exp then
      if coalesce(trim(r.tat_note), '') = '' then
        v_bad := v_bad || format('%s · %s: pending %s but expected %s (previous %s + entry %s − closure %s − cancelled %s); ',
                                 r.client, r.location, v_sum, v_exp, v_open, r.entry, r.closure, r.cancelled);
      else
        perform app.task_upsert('tat_mismatch', 'miss', 'tat_mismatch:' || v_person || ':' || r.client_location_id || ':' || p_work_date, v_person, v_person,
          'Pending cases did not tally for ' || r.client || ' · ' || r.location || ' on ' || to_char(p_work_date, 'DD Mon'),
          jsonb_build_object('reported', v_sum, 'expected', v_exp, 'previous', v_open, 'note', r.tat_note), null, null, p_work_date, null);
      end if;
    end if;
  end loop;
  if v_bad <> '' then
    raise exception 'Pending cases do not tally — %Correct the figures or add a note on the row.', v_bad using errcode = 'P0001';
  end if;
  if v_strict and exists (select 1 from public.my_money_rows(p_work_date) m where v_person = v_me and (m.bill_count is null or m.bill_amount is null or m.collected is null)) then
    raise exception 'Enter today''s bills raised and amount collected for each client you head (0 if none).' using errcode = 'P0001';
  end if;
  perform set_config('app.reason', coalesce(p_reason, ''), true);
  insert into public.day_status as d (person_id, work_date, function, status, reason, set_by, submitted_at, late, revision)
  values (v_person, p_work_date, 'operations', case when v_person = v_me then 'submitted' else 'manager_entered' end,
          nullif(p_reason, ''), v_me, app.clock(), v_state <> 'open', 0)
  on conflict (person_id, work_date, function) do update
    set status = excluded.status, reason = excluded.reason, set_by = excluded.set_by, submitted_at = excluded.submitted_at, late = excluded.late,
        revision = d.revision + case when d.status in ('submitted','manager_entered') then 1 else 0 end, updated_at = now()
  returning * into v_ds;
  return v_ds;
end $$;

-- My day: adds pending buckets, the carried-in pending, and bills / collections rows for location heads.
create or replace function public.my_day(p_work_date date default null)
returns jsonb language plpgsql stable security definer set search_path = public, app, pg_temp as $$
declare v_d date := coalesce(p_work_date, app.today()); v_me uuid := app.me();
begin
  if v_me is null then raise exception 'Not signed in' using errcode = '28000'; end if;
  return jsonb_build_object(
    'work_date', v_d, 'window', app.window_state(v_d), 'reopened', app.active_reopen(v_me, v_d, 'operations'),
    'deadline', ((v_d + 1)::timestamp) at time zone app.tz(),
    'grace_deadline', ((v_d + 1)::timestamp + (app.setting('grace_until') #>> '{}')::time) at time zone app.tz(),
    'is_working_day', app.is_working_day(v_d),
    'status', (select to_jsonb(d) from public.day_status d where d.person_id = v_me and d.work_date = v_d and d.function = 'operations'),
    'money', (select coalesce(jsonb_agg(to_jsonb(m)), '[]') from public.my_money_rows(v_d) m),
    'rows', (select coalesce(jsonb_agg(jsonb_build_object(
                'client_location_id', cl.id, 'client', c.name, 'location', lo.name, 'process', pr.name,
                'entry', l.entry, 'closure', l.closure, 'cancelled', l.cancelled, 'source', l.source,
                'tat_0_1', l.tat_0_1, 'tat_1_2', l.tat_1_2, 'tat_2_4', l.tat_2_4, 'tat_4_7', l.tat_4_7, 'tat_7_15', l.tat_7_15, 'tat_15p', l.tat_15p,
                'tat_note', l.tat_note, 'rate', rc.rate, 'billable_event', rc.billable_event,
                'opening_pending', app.prev_pending(v_me, cl.id, v_d),
                'opening_wip', coalesce(app.prev_pending(v_me, cl.id, v_d), 0), 'wip_seeded', app.prev_pending(v_me, cl.id, v_d) is not null)
                order by c.name, lo.name), '[]')
               from public.allocations a
               join public.client_locations cl on cl.id = a.client_location_id
               join public.clients c on c.id = cl.client_id join public.locations lo on lo.id = cl.location_id
               join public.processes pr on pr.id = cl.process_id
               left join public.productivity_lines l on l.person_id = v_me and l.work_date = v_d and l.client_location_id = cl.id
               left join public.rate_cards rc on rc.client_id = cl.client_id and rc.location_id = cl.location_id
                                              and rc.process_id = cl.process_id and rc.valid @> v_d
              where a.person_id = v_me and a.function = 'operations' and a.valid @> v_d));
end $$;

-- Team lines for a manager's My day expansion (whole subtree), with pending totals.
create or replace function public.team_lines(p_date date)
returns table(person_id uuid, full_name text, client_location_id uuid, client text, location text, entry int, closure int, cancelled int,
              pending int, source text, reason text, status text)
language sql stable security definer set search_path = public, app, pg_temp as $$
  select l.person_id, p.full_name, l.client_location_id, c.name, lo.name, l.entry, l.closure, l.cancelled,
         l.tat_0_1 + l.tat_1_2 + l.tat_2_4 + l.tat_4_7 + l.tat_7_15 + l.tat_15p, l.source, l.reason,
         (select s.status from public.day_status s where s.person_id = l.person_id and s.work_date = p_date and s.function = 'operations')
    from public.productivity_lines l join public.persons p on p.id = l.person_id
    join public.client_locations cl on cl.id = l.client_location_id join public.clients c on c.id = cl.client_id
    join public.locations lo on lo.id = cl.location_id
   where l.work_date = p_date and l.person_id in (select s.person_id from app.subtree(app.me(), 'operations', p_date) s)
   order by p.full_name, c.name
$$;

-- ------------------------------------------------------------------ leaders bulk-upload their own team
create or replace function public.bulk_import(p_kind text, p_rows jsonb, p_dry_run boolean default true) returns jsonb
language plpgsql security definer set search_path = public, app, extensions, pg_temp as $$
declare r jsonb; i int := 0; ok int := 0; errs jsonb := '[]'::jsonb; v_msg text; v_leader boolean; v_mobile text;
begin
  v_leader := p_kind = 'people' and exists (select 1 from public.role_assignments ra where ra.person_id = app.me() and ra.valid @> app.today()
                                             and ra.role in ('ops_head','collections_head','zm','bm','ba','manager'));
  if not (app.is_admin() or (app.has_role('hr_admin') and p_kind in ('people','allocations','holidays')) or v_leader) then
    raise exception 'Only Admin can use bulk upload.' using errcode = '42501';
  end if;
  if jsonb_array_length(coalesce(p_rows, '[]')) > 5000 then raise exception 'At most 5,000 rows per upload.' using errcode = 'P0001'; end if;
  if v_leader and not app.is_admin() then
    select mobile into v_mobile from public.persons where id = app.me();
    select coalesce(jsonb_agg(case when coalesce(x->>'reports_to_mobile', '') = '' then x || jsonb_build_object('reports_to_mobile', v_mobile) else x end), '[]')
      into p_rows from jsonb_array_elements(p_rows) x;
  end if;
  perform set_config('app.reason', 'bulk upload: ' || p_kind, true);
  begin
    for r in select * from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) loop
      i := i + 1;
      begin
        perform app.bulk_row(p_kind, r);
        ok := ok + 1;
      exception when others then
        get stacked diagnostics v_msg = message_text;
        errs := errs || jsonb_build_object('row', i, 'error', v_msg);
      end;
    end loop;
    if p_dry_run or jsonb_array_length(errs) > 0 then
      raise exception using errcode = 'P0099', message = 'undo';
    end if;
  exception when sqlstate 'P0099' then
    null;
  end;
  return jsonb_build_object('kind', p_kind, 'rows', i, 'ok', ok, 'errors', errs, 'applied', not p_dry_run and jsonb_array_length(errs) = 0);
end $$;

-- ------------------------------------------------------------------ performance dashboard data
create or replace function public.perf_dashboard(p_month date default null) returns jsonb
language plpgsql stable security definer set search_path = public, app, pg_temp as $$
declare v_m date := date_trunc('month', coalesce(p_month, app.today()))::date; v_today date := app.today();
begin
  if app.me() is null then raise exception 'Not signed in' using errcode = '28000'; end if;
  return (
  with vis as (select * from app.visible_branches(least(v_today, (v_m + interval '1 month - 1 day')::date)) b(id)),
  zm as (select distinct on (h.branch_id) h.branch_id, p.full_name from public.location_heads h join public.persons p on p.id = h.person_id
          where h.head_role = 'zonal_manager' and h.client_id is null and h.valid @> v_today order by h.branch_id, h.created_at desc),
  hist as (select m.month, m.branch_id, m.client_id, m.location_name, m.client_name, sum(m.target_cases) t, sum(m.actual_cases) a,
                  sum(m.revenue_target) rt, sum(m.actual_revenue) ra, sum(m.billing_amount) bill
             from public.tracker_monthly m where m.branch_id in (select id from vis) and m.month >= (v_m - interval '24 months')::date
            group by m.month, m.branch_id, m.client_id, m.location_name, m.client_name),
  tool as (select date_trunc('month', l.work_date)::date as month, l.branch_id, l.client_id, sum(l.entry - l.cancelled) a, sum(coalesce(l.revenue, 0)) ra
             from public.v_line_metrics l where l.branch_id in (select id from vis) and l.work_date >= (v_m - interval '24 months')::date and l.work_date <= v_today
            group by 1, 2, 3),
  tgt as (select t.month, t.branch_id, t.client_id, t.amount from public.target_allocations t
           where t.is_current and t.metric = 'entry' and t.level = 'branch' and t.branch_id in (select id from vis)),
  rate as (select distinct on (cl.branch_id, cl.client_id) cl.branch_id, cl.client_id, rc.rate from public.client_locations cl
             join public.rate_cards rc on rc.client_id = cl.client_id and rc.location_id = cl.location_id and rc.valid @> v_today order by cl.branch_id, cl.client_id, rc.rate desc),
  months as (  -- one source per month: entered figures where they exist, else tracker history
    select coalesce(x.month, h.month) as month, coalesce(x.branch_id, h.branch_id) branch_id, coalesce(x.client_id, h.client_id) client_id,
           case when x.month is not null then 'app' else 'tracker' end src,
           coalesce(g.amount, h.t) t, coalesce(x.a, h.a) a, coalesce(g.amount * r.rate, h.rt) rt, coalesce(x.ra, h.ra) ra, h.bill
      from hist h full join tool x on x.month = h.month and x.branch_id = h.branch_id and x.client_id = h.client_id
      left join tgt g on g.month = coalesce(x.month, h.month) and g.branch_id = coalesce(x.branch_id, h.branch_id) and g.client_id = coalesce(x.client_id, h.client_id)
      left join rate r on r.branch_id = coalesce(x.branch_id, h.branch_id) and r.client_id = coalesce(x.client_id, h.client_id)
     where not exists (select 1 from tool y where y.month = h.month) or x.month is not null)
  select jsonb_build_object(
    'month', v_m, 'today', v_today,
    'wd_done', app.working_days_between(v_m, least(v_today, (v_m + interval '1 month - 1 day')::date)),
    'wd_total', app.working_days_between(v_m, (v_m + interval '1 month - 1 day')::date),
    'series', (select coalesce(jsonb_agg(s order by s.month), '[]') from (
        select mo.month, sum(mo.t) target, sum(mo.a) cases, sum(mo.rt) revenue_target, sum(mo.ra) revenue, sum(mo.bill) billing, max(mo.src) source
          from months mo group by mo.month) s),
    'by_stakeholder', (select coalesce(jsonb_agg(s), '[]') from (
        select mo.month, coalesce(zm.full_name, 'Unassigned') stakeholder, sum(mo.t) target, sum(mo.a) cases, sum(mo.rt) revenue_target, sum(mo.ra) revenue
          from months mo left join zm on zm.branch_id = mo.branch_id group by mo.month, 2) s),
    'by_location', (select coalesce(jsonb_agg(s), '[]') from (
        select mo.month, b.name location, coalesce(zm.full_name, 'Unassigned') stakeholder, sum(mo.t) target, sum(mo.a) cases, sum(mo.rt) revenue_target, sum(mo.ra) revenue
          from months mo join public.branches b on b.id = mo.branch_id left join zm on zm.branch_id = mo.branch_id
         where mo.month >= (v_m - interval '2 months')::date group by mo.month, b.name, 3) s),
    'by_client', (select coalesce(jsonb_agg(s), '[]') from (
        select mo.month, coalesce(c.client_family, c.name) client, sum(mo.t) target, sum(mo.a) cases, sum(mo.ra) revenue
          from months mo join public.clients c on c.id = mo.client_id where mo.month >= (v_m - interval '12 months')::date group by mo.month, 2) s),
    'by_person', (select coalesce(jsonb_agg(s), '[]') from (
        select mo.month, p.full_name person, sum(mo.a) cases, sum(mo.ra) revenue, sum(mo.t) target
          from months mo join lateral (select app.head_of(mo.branch_id, mo.client_id, 'branch_head', v_today) pid) h on true
          join public.persons p on p.id = h.pid where mo.month >= (v_m - interval '12 months')::date group by mo.month, p.full_name) s),
    'daily', (select coalesce(jsonb_agg(s order by s.d), '[]') from (
        select l.work_date d, sum(l.entry - l.cancelled) cases, sum(coalesce(l.revenue, 0)) revenue from public.v_line_metrics l
         where l.branch_id in (select id from vis) and l.work_date between (v_m - interval '1 month')::date and v_today group by 1) s),
    'daily_tracker', (select coalesce(jsonb_agg(s order by s.d), '[]') from (
        select t.as_of d, sum(t.mtd_cases) mtd_cases, sum(t.mtd_revenue) mtd_revenue, sum(t.target_cases) target from public.tracker_daily t
         where t.branch_id in (select id from vis) and t.as_of >= (v_m - interval '13 months')::date group by 1) s)
  ));
end $$;

-- ------------------------------------------------------------------ grants
revoke all on function public.save_pending(date, jsonb, uuid, text), public.save_my_profile(jsonb), public.accept_agreement(text, text, text),
  public.set_salary(uuid, numeric, date, text), public.my_money_rows(date), public.save_money_day(date, jsonb), public.sync_tasks(boolean),
  public.my_tasks(text), public.task_reply(uuid, text), public.task_request_resolution(uuid, text, jsonb), public.admin_decide_task(uuid, text, text),
  public.team_lines(date), public.perf_dashboard(date) from public, anon;
grant execute on function public.save_pending(date, jsonb, uuid, text), public.save_my_profile(jsonb), public.accept_agreement(text, text, text),
  public.set_salary(uuid, numeric, date, text), public.my_money_rows(date), public.save_money_day(date, jsonb), public.sync_tasks(boolean),
  public.my_tasks(text), public.task_reply(uuid, text), public.task_request_resolution(uuid, text, jsonb), public.admin_decide_task(uuid, text, text),
  public.team_lines(date), public.perf_dashboard(date) to authenticated;
revoke all on function app.task_upsert(text, text, text, uuid, uuid, text, jsonb, uuid, uuid, date, date), app.prev_pending(uuid, uuid, date),
  app.shares_location(uuid, date), app.profile_missing(uuid), app.agreement_ok(uuid), app.onboarding_ok(uuid), app.manager_of(uuid),
  app.task_visible(uuid, uuid), app.task_can_act(uuid) from public, anon;
grant execute on function app.task_visible(uuid, uuid), app.shares_location(uuid, date), app.agreement_ok(uuid), app.onboarding_ok(uuid),
  app.profile_missing(uuid) to authenticated;   -- used inside row-security checks and the reporting gate
