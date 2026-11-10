-- 10 Nov owner requests (D-86 .. D-90).
-- D-86 Collections in daily updates list only branch–client pairs someone actually serves (an open operations tick) or that
--      already have collections / receivables this month; heads no longer see every client ever set up at their branch.
-- D-87 Full Aadhaar, PAN and bank account numbers are kept (owner's decision: Aadhaar stored as is, not encrypted), in a
--      separate table read only through functions. Full numbers: the person, HR and Admin. Managers see them masked.
--      Numbers come from scanning the uploaded card on the phone; an edit after the scan is marked for HR to check.
-- D-88 Profile completion %: personal details + Aadhaar, PAN, bank proof (scanned) + qualification certificate.
--      3 days to complete (from this release, or from activation if later); after that the app is locked until done.
-- D-89 Managers (anyone above in the reporting line), HR and Admin see the full profile (emergency contact, addresses …).
-- D-90 Salary and the payroll sheet: HR and Admin only (and a BA for staff on their own BA payroll; the person sees their
--      own after approval). Managers still propose incentives / deductions / arrears / increments for their team without
--      seeing pay. Supersedes D-78a.

-- ------------------------------------------------------------------ D-86
create or replace function app.money_pairs(p_person uuid, p_date date)
returns table(branch_id uuid, client_id uuid)
language sql stable security definer set search_path = public, app, pg_temp as $$
  with svc as (
    select distinct cl.branch_id, cl.client_id from public.client_locations cl
     where cl.valid @> p_date
       and (exists (select 1 from public.allocations a join public.client_locations c2 on c2.id = a.client_location_id
                     where c2.branch_id = cl.branch_id and c2.client_id = cl.client_id and a.function = 'operations' and a.valid @> p_date)
            or exists (select 1 from public.collection_daily d where d.branch_id = cl.branch_id and d.client_id = cl.client_id
                        and d.entry_date >= date_trunc('month', p_date)::date and d.entry_date <= p_date)
            or exists (select 1 from public.collection_ar r where r.branch_id = cl.branch_id and r.client_id = cl.client_id
                        and r.month = date_trunc('month', p_date)::date))),
  own as (
    select s.branch_id, s.client_id,
           app.head_of(s.branch_id, s.client_id, 'branch_head', p_date) bh,
           app.head_of(s.branch_id, s.client_id, 'zonal_manager', p_date) zm
      from svc s)
  select o.branch_id, o.client_id from own o
   where o.bh = p_person or (o.bh is null and o.zm = p_person)
$$;

-- ------------------------------------------------------------------ D-87 identity numbers
create or replace function app.verhoeff_ok(p text) returns boolean
language plpgsql immutable set search_path = pg_temp as $$
declare
  d int[] := array[0,1,2,3,4,5,6,7,8,9, 1,2,3,4,0,6,7,8,9,5, 2,3,4,0,1,7,8,9,5,6, 3,4,0,1,2,8,9,5,6,7, 4,0,1,2,3,9,5,6,7,8,
                   5,9,8,7,6,0,4,3,2,1, 6,5,9,8,7,1,0,4,3,2, 7,6,5,9,8,2,1,0,4,3, 8,7,6,5,9,3,2,1,0,4, 9,8,7,6,5,4,3,2,1,0];
  pm int[] := array[0,1,2,3,4,5,6,7,8,9, 1,5,7,6,2,8,3,0,9,4, 5,8,0,3,7,9,6,1,4,2, 8,9,1,6,0,4,3,5,2,7,
                    9,4,5,3,1,2,6,8,7,0, 4,2,8,6,5,7,3,9,0,1, 2,7,9,3,8,0,6,4,1,5, 7,0,4,6,9,1,3,2,5,8];
  c int := 0; n int; i int;
begin
  if p is null or p !~ '^[0-9]+$' then return false; end if;
  n := length(p);
  for i in 0 .. n - 1 loop
    c := d[c * 10 + pm[(i % 8) * 10 + substr(p, n - i, 1)::int + 1] + 1];
  end loop;
  return c = 0;
end $$;

create or replace function app.mask_id(p text) returns text
language sql immutable set search_path = pg_temp as $$
  select case when p is null then null when length(p) <= 4 then p else repeat('X', length(p) - 4) || right(p, 4) end
$$;

create table if not exists public.hr_identity (
  person_id uuid primary key references public.persons(id),
  aadhaar_number text, aadhaar_name text, aadhaar_source text, aadhaar_doc uuid references public.person_documents(id),
  pan_number text, pan_name text, pan_source text, pan_doc uuid references public.person_documents(id),
  bank_account_number text, bank_ifsc text, bank_name text, bank_holder text, bank_source text, bank_doc uuid references public.person_documents(id),
  updated_by uuid references public.persons(id), updated_at timestamptz not null default now(),
  constraint hr_identity_aadhaar check (aadhaar_number is null or aadhaar_number ~ '^[2-9][0-9]{11}$'),
  constraint hr_identity_pan check (pan_number is null or pan_number ~ '^[A-Z]{3}[ABCFGHJLPT][A-Z][0-9]{4}[A-Z]$'),
  constraint hr_identity_account check (bank_account_number is null or bank_account_number ~ '^[0-9]{9,18}$'),
  constraint hr_identity_ifsc check (bank_ifsc is null or bank_ifsc ~ '^[A-Z]{4}0[A-Z0-9]{6}$'),
  constraint hr_identity_source check (coalesce(aadhaar_source, 'scan') in ('scan','edited','hr') and coalesce(pan_source, 'scan') in ('scan','edited','hr')
                                       and coalesce(bank_source, 'scan') in ('scan','edited','hr'))
);
create unique index if not exists hr_identity_aadhaar_uq on public.hr_identity(aadhaar_number) where aadhaar_number is not null;
create unique index if not exists hr_identity_pan_uq on public.hr_identity(pan_number) where pan_number is not null;
alter table public.hr_identity enable row level security;      -- no policies: read and written only through the functions below
revoke all on public.hr_identity from anon, authenticated;

-- who changed which ID field, without the values (the generic audit log would copy the numbers)
create table if not exists public.identity_log (
  id bigserial primary key, person_id uuid not null references public.persons(id), kind text not null, source text not null,
  doc_id uuid, changed_by uuid references public.persons(id), changed_at timestamptz not null default now()
);
alter table public.identity_log enable row level security;
drop policy if exists read_identity_log on public.identity_log;
create policy read_identity_log on public.identity_log for select to authenticated
  using ((select app.is_admin() or app.has_role('hr_admin')) or person_id = (select app.me()));
revoke all on public.identity_log from anon, authenticated;
grant select on public.identity_log to authenticated;
create index if not exists identity_log_person on public.identity_log(person_id);

-- ------------------------------------------------------------------ D-88 profile completion
insert into public.settings(key, value, description, label, help, kind, section, editable)
values ('profile_gate_from', to_jsonb(now()), 'Profile deadline starts', 'Profile clock starts', 'Everyone gets 3 days from this time (or from activation, if later) to complete their profile; then the app is locked until it is complete.', 'text', 'People', true),
       ('profile_grace_days', '3', 'Days to complete the profile', 'Profile grace days', 'Days allowed before the profile becomes compulsory.', 'number', 'People', true)
on conflict (key) do nothing;

create or replace function app.profile_missing(p_person uuid) returns text[]
language sql stable security definer set search_path = public, app, pg_temp as $$
  select array_remove(array[
    case when h.date_of_birth is null then 'date of birth' end, case when h.joining_date is null then 'joining / association date' end,
    case when coalesce(h.current_address, '') = '' then 'current address' end, case when coalesce(h.permanent_address, '') = '' then 'permanent address' end,
    case when coalesce(h.city, '') = '' then 'city' end, case when coalesce(h.state, '') = '' then 'state' end, case when h.pincode is null then 'PIN code' end,
    case when coalesce(h.emergency_name, '') = '' then 'emergency contact name' end, case when coalesce(h.emergency_relation, '') = '' then 'emergency contact relation' end,
    case when h.emergency_phone is null then 'emergency contact mobile' end,
    case when i.aadhaar_number is null then 'Aadhaar card (scan)' end,
    case when i.pan_number is null then 'PAN card (scan)' end,
    case when i.bank_account_number is null or i.bank_ifsc is null then 'bank proof — cancelled cheque or passbook (scan)' end,
    case when coalesce(h.highest_qualification, '') = '' then 'highest qualification' end,
    case when not exists (select 1 from public.person_documents d where d.person_id = p.id and d.doc_type = 'qualification' and not d.rejected)
         then 'qualification certificate (upload)' end,
    case when p.resource_type = 'partner' and coalesce(h.firm_name, '') = '' then 'firm name' end,
    case when coalesce(p.personal_email, '') = '' then 'email' end], null)
    from public.persons p left join public.hr_profiles h on h.person_id = p.id left join public.hr_identity i on i.person_id = p.id
   where p.id = p_person
$$;

create or replace function app.profile_progress(p_person uuid) returns jsonb
language sql stable security definer set search_path = public, app, pg_temp as $$
  with m as (select coalesce(app.profile_missing(p_person), '{}') miss),
  t as (select 15 + case when (select resource_type from public.persons where id = p_person) = 'partner' then 1 else 0 end total),
  due as (select greatest(coalesce((app.setting('profile_gate_from') #>> '{}')::timestamptz, now()),
                          coalesce((select c.used_at from app.activation_codes c where c.person_id = p_person), (select p.created_at from public.persons p where p.id = p_person)))
                 + make_interval(days => coalesce((app.setting('profile_grace_days') #>> '{}')::int, 3)) as due_at)
  select jsonb_build_object(
    'missing', to_jsonb(m.miss), 'total', t.total, 'done', t.total - coalesce(array_length(m.miss, 1), 0),
    'pct', round((t.total - coalesce(array_length(m.miss, 1), 0))::numeric * 100 / t.total),
    'due_at', due.due_at,
    'blocking', coalesce(array_length(m.miss, 1), 0) > 0 and app.clock() > due.due_at
                and not exists (select 1 from public.role_assignments r where r.person_id = p_person and r.role = 'admin' and r.valid @> app.today()))
  from m, t, due
$$;

create or replace function app.refresh_profile_complete(p_person uuid) returns void
language plpgsql security definer set search_path = public, app, pg_temp as $$
begin
  insert into public.hr_profiles(person_id) values (p_person) on conflict (person_id) do nothing;
  update public.hr_profiles set completed_at = case when coalesce(array_length(app.profile_missing(p_person), 1), 0) = 0 then coalesce(completed_at, now()) end
   where person_id = p_person;
end $$;

-- figures can be entered during the 3 days; after that only with a complete profile
create or replace function app.onboarding_ok(p_person uuid) returns boolean
language sql stable security definer set search_path = public, app, pg_temp as $$
  select app.agreement_ok(p_person) and not coalesce((app.profile_progress(p_person)->>'blocking')::boolean, false)
$$;

-- record a scanned (or HR-entered) Aadhaar / PAN / bank account
create or replace function public.save_identity(p_person uuid, p jsonb) returns jsonb
language plpgsql security definer set search_path = public, app, pg_temp as $$
declare v_me uuid := app.me(); v_hr boolean := app.is_admin() or app.has_role('hr_admin'); v_kind text := p->>'kind';
        v_src text; v_doc uuid := nullif(p->>'doc_id', '')::uuid; v_n text; v_ifsc text; v_name text := nullif(btrim(coalesce(p->>'name', '')), '');
begin
  if v_me is null then raise exception 'Not signed in' using errcode = '28000'; end if;
  if p_person <> v_me and not v_hr then raise exception 'Only the person, HR or Admin can record ID details.' using errcode = '42501'; end if;
  if v_doc is not null and not exists (select 1 from public.person_documents d where d.id = v_doc and d.person_id = p_person) then
    raise exception 'That document does not belong to this person.' using errcode = '22023'; end if;
  v_src := case when p_person <> v_me then 'hr' when coalesce((p->>'edited')::boolean, false) then 'edited' else 'scan' end;
  insert into public.hr_identity(person_id) values (p_person) on conflict (person_id) do nothing;
  insert into public.hr_profiles(person_id) values (p_person) on conflict (person_id) do nothing;
  perform set_config('app.reason', 'ID details recorded: ' || coalesce(v_kind, '?') || ' (' || v_src || ')', true);
  if v_kind = 'aadhaar' then
    v_n := regexp_replace(coalesce(p->>'number', ''), '\D', '', 'g');
    if v_n !~ '^[2-9][0-9]{11}$' or not app.verhoeff_ok(v_n) then
      raise exception 'That is not a valid Aadhaar number (12 digits, the last one is a check digit). Upload a clearer photo of the card.' using errcode = '22023'; end if;
    if exists (select 1 from public.hr_identity i where i.aadhaar_number = v_n and i.person_id <> p_person) then
      raise exception 'This Aadhaar number is already recorded for someone else. Contact HR.' using errcode = 'P0001'; end if;
    update public.hr_identity set aadhaar_number = v_n, aadhaar_name = coalesce(v_name, aadhaar_name), aadhaar_source = v_src, aadhaar_doc = coalesce(v_doc, aadhaar_doc),
           updated_by = v_me, updated_at = now() where person_id = p_person;
    update public.hr_profiles set aadhaar_last4 = right(v_n, 4),
           date_of_birth = coalesce(date_of_birth, case when coalesce(p->>'dob', '') ~ '^\d{4}-\d{2}-\d{2}$' then (p->>'dob')::date end),
           gender = coalesce(gender, nullif(p->>'gender', '')),
           permanent_address = coalesce(nullif(permanent_address, ''), nullif(btrim(coalesce(p->>'address', '')), '')),
           pincode = coalesce(pincode, case when coalesce(p->>'pincode', '') ~ '^[1-9][0-9]{5}$' then p->>'pincode' end),
           updated_at = now() where person_id = p_person;
  elsif v_kind = 'pan' then
    v_n := upper(regexp_replace(coalesce(p->>'number', ''), '[^A-Za-z0-9]', '', 'g'));
    if v_n !~ '^[A-Z]{3}[ABCFGHJLPT][A-Z][0-9]{4}[A-Z]$' then
      raise exception 'That is not a valid PAN (5 letters, 4 digits, 1 letter). Upload a clearer photo of the card.' using errcode = '22023'; end if;
    if exists (select 1 from public.hr_identity i where i.pan_number = v_n and i.person_id <> p_person) then
      raise exception 'This PAN is already recorded for someone else. Contact HR.' using errcode = 'P0001'; end if;
    update public.hr_identity set pan_number = v_n, pan_name = coalesce(v_name, pan_name), pan_source = v_src, pan_doc = coalesce(v_doc, pan_doc),
           updated_by = v_me, updated_at = now() where person_id = p_person;
    update public.hr_profiles set pan_last4 = right(v_n, 4),
           date_of_birth = coalesce(date_of_birth, case when coalesce(p->>'dob', '') ~ '^\d{4}-\d{2}-\d{2}$' then (p->>'dob')::date end),
           updated_at = now() where person_id = p_person;
  elsif v_kind = 'bank' then
    v_n := regexp_replace(coalesce(p->>'number', ''), '\D', '', 'g');
    v_ifsc := upper(regexp_replace(coalesce(p->>'ifsc', ''), '[^A-Za-z0-9]', '', 'g'));
    if v_n !~ '^[0-9]{9,18}$' then raise exception 'The bank account number must be 9 to 18 digits.' using errcode = '22023'; end if;
    if v_ifsc !~ '^[A-Z]{4}0[A-Z0-9]{6}$' then raise exception 'The IFSC must be 11 characters: 4 letters, 0, then 6 letters or digits.' using errcode = '22023'; end if;
    update public.hr_identity set bank_account_number = v_n, bank_ifsc = v_ifsc, bank_name = coalesce(nullif(btrim(coalesce(p->>'bank_name', '')), ''), bank_name),
           bank_holder = coalesce(v_name, bank_holder), bank_source = v_src, bank_doc = coalesce(v_doc, bank_doc), updated_by = v_me, updated_at = now()
     where person_id = p_person;
    update public.hr_profiles set bank_account_last4 = right(v_n, 4), bank_ifsc = v_ifsc,
           bank_name = coalesce(nullif(btrim(coalesce(p->>'bank_name', '')), ''), bank_name), updated_at = now() where person_id = p_person;
  else
    raise exception 'Unknown document kind.' using errcode = '22023';
  end if;
  insert into public.identity_log(person_id, kind, source, doc_id, changed_by) values (p_person, v_kind, v_src, v_doc, v_me);
  if v_src = 'edited' then
    insert into public.notifications(person_id, kind, message, link)
    select ra.person_id, 'hr_document', (select full_name from public.persons where id = p_person) || ' corrected the ' || v_kind
           || ' number read from the scan — please check it against the document.', '/admin?s=hr'
      from public.role_assignments ra where ra.role = 'hr_admin' and ra.valid @> app.today();
  end if;
  perform app.refresh_profile_complete(p_person);
  return app.profile_progress(p_person);
end $$;

-- documents already uploaded that can be read for numbers that are still missing (the person's own, or anyone for HR)
create or replace function public.scannable_documents(p_person uuid) returns table(id uuid, doc_type text, storage_path text, file_name text, mime text, uploaded_at timestamptz)
language plpgsql stable security definer set search_path = public, app, pg_temp as $$
begin
  if not (p_person = app.me() or app.is_admin() or app.has_role('hr_admin')) then raise exception 'Not permitted.' using errcode = '42501'; end if;
  return query
  select distinct on (d.doc_type) d.id, d.doc_type, d.storage_path, d.file_name, d.mime, d.uploaded_at
    from public.person_documents d left join public.hr_identity i on i.person_id = d.person_id
   where d.person_id = p_person and not d.rejected
     and ((d.doc_type = 'aadhaar' and i.aadhaar_number is null) or (d.doc_type = 'pan' and i.pan_number is null)
          or (d.doc_type in ('bank','cancelled_cheque') and (i.bank_account_number is null or i.bank_ifsc is null)))
   order by d.doc_type, d.uploaded_at desc;
end $$;

-- ------------------------------------------------------------------ D-89 full profile
create or replace function public.person_profile(p_person uuid) returns jsonb
language plpgsql stable security definer set search_path = public, app, pg_temp as $$
declare v_hr boolean := app.is_admin() or app.has_role('hr_admin'); v_self boolean := p_person = app.me(); v_full boolean;
begin
  if app.me() is null then raise exception 'Not signed in' using errcode = '28000'; end if;
  if not (v_hr or v_self or app.above(p_person)) then raise exception 'Not permitted.' using errcode = '42501'; end if;
  v_full := v_hr or v_self;
  return jsonb_build_object(
    'person', (select jsonb_build_object('id', p.id, 'full_name', p.full_name, 'designation', p.designation, 'mobile', p.mobile, 'email', p.personal_email,
                 'status', p.status, 'resource_type', p.resource_type, 'joined_on', p.joined_on, 'exited_on', p.exited_on) from public.persons p where p.id = p_person),
    'managers', (select coalesce(jsonb_agg(jsonb_build_object('function', r.function, 'name', m.full_name, 'designation', m.designation) order by r.function), '[]')
                   from public.reporting_lines r join public.persons m on m.id = r.manager_id where r.person_id = p_person and r.valid @> app.today()),
    'profile', (select to_jsonb(h) - 'person_id' - 'pan_last4' - 'aadhaar_last4' - 'bank_account_last4' from public.hr_profiles h where h.person_id = p_person),
    'identity', (select jsonb_build_object(
                   'aadhaar', case when v_full then i.aadhaar_number else app.mask_id(i.aadhaar_number) end, 'aadhaar_name', i.aadhaar_name, 'aadhaar_source', i.aadhaar_source,
                   'pan', case when v_full then i.pan_number else app.mask_id(i.pan_number) end, 'pan_name', i.pan_name, 'pan_source', i.pan_source,
                   'bank_account', case when v_full then i.bank_account_number else app.mask_id(i.bank_account_number) end, 'bank_ifsc', i.bank_ifsc,
                   'bank_name', i.bank_name, 'bank_holder', i.bank_holder, 'bank_source', i.bank_source, 'updated_at', i.updated_at)
                   from public.hr_identity i where i.person_id = p_person),
    'full_ids', v_full,
    'documents', (select coalesce(jsonb_agg(jsonb_build_object('doc_type', d.doc_type, 'file_name', d.file_name, 'uploaded_at', d.uploaded_at,
                    'verified', d.verified_at is not null, 'rejected', d.rejected, 'note', d.note) order by d.doc_type, d.uploaded_at desc), '[]')
                    from public.person_documents d where d.person_id = p_person),
    'progress', app.profile_progress(p_person));
end $$;

-- the person's own profile save keeps what the scans recorded
do $mig$
declare v text; o text; missing text := '';
begin
  v := pg_get_functiondef('public.save_my_profile(jsonb)'::regprocedure); o := v;
  v := replace(v, 'pan_last4 = excluded.pan_last4, aadhaar_last4 = excluded.aadhaar_last4,',
                  'pan_last4 = coalesce(excluded.pan_last4, h.pan_last4), aadhaar_last4 = coalesce(excluded.aadhaar_last4, h.aadhaar_last4),');
  v := replace(v, 'bank_name = excluded.bank_name, bank_ifsc = excluded.bank_ifsc, bank_account_last4 = excluded.bank_account_last4,',
                  'bank_name = coalesce(excluded.bank_name, h.bank_name), bank_ifsc = coalesce(excluded.bank_ifsc, h.bank_ifsc), bank_account_last4 = coalesce(excluded.bank_account_last4, h.bank_account_last4),');
  if v = o or position('coalesce(excluded.pan_last4' in v) = 0 or position('coalesce(excluded.bank_account_last4' in v) = 0 then missing := missing || ' save_my_profile'; end if;
  execute v;

  -- uploading the qualification certificate can complete the profile
  v := pg_get_functiondef('public.register_document(uuid,text,text,text,text,integer)'::regprocedure); o := v;
  v := replace(v, '  return v_id;
end', '  perform app.refresh_profile_complete(p_person);
  return v_id;
end');
  if v = o then missing := missing || ' register_document'; end if;
  execute v;

  -- whoami: completion %, deadline and whether the app is locked
  v := pg_get_functiondef('public.whoami()'::regprocedure); o := v;
  v := replace(v, '''profile_missing'', to_jsonb(coalesce(app.profile_missing(p.id), ''{}'')),',
                  '''profile_missing'', to_jsonb(coalesce(app.profile_missing(p.id), ''{}'')), ''profile'', app.profile_progress(p.id),');
  if v = o then missing := missing || ' whoami'; end if;
  execute v;

  -- ---------------------------------------------------------------- D-90 pay: HR / Admin (and a BA for their own BA payroll)
  v := pg_get_functiondef('app.can_see_pay(uuid,date)'::regprocedure); o := v;
  v := replace(v, 'or app.direct_mgr(p_person)', 'or (app.is_ba_of(p_person) and app.pay_group(p_person) = ''partner'')');
  if v = o then missing := missing || ' can_see_pay'; end if;
  execute v;

  v := pg_get_functiondef('public.salary_history(uuid)'::regprocedure); o := v;
  v := replace(v, 'or app.direct_mgr(p_person) or', 'or (app.is_ba_of(p_person) and app.pay_group(p_person) = ''partner'') or');
  if v = o then missing := missing || ' salary_history'; end if;
  execute v;

  if missing <> '' then raise exception 'identity_profile_visibility: anchors not found:%', missing; end if;
end $mig$;

-- payroll sheet: full account number for HR / Admin (for the bank transfer file); a BA sees the last 4 of their staff
drop function if exists public.payroll_sheet(date);
create function public.payroll_sheet(p_month date)
returns table(person_id uuid, full_name text, designation text, manager text, location text, status text, payroll text, branch_type text, gross numeric, days_in_month int, day_rate numeric,
              present_days numeric, paid_leave_days numeric, off_days numeric, unpaid_days numeric, not_employed_days int, unpaid_override numeric, override_reason text,
              attendance_deduction numeric, earned_gross numeric, basic numeric, pf_applicable boolean, pf_employee numeric, pf_employer numeric, pf_admin numeric,
              esi_employee numeric, esi_employer numeric, incentives numeric, arrears numeric,
              other_deductions numeric, net_pay numeric, flags text[], pending_adjustments int, bank text, ifsc text, account_last4 text, account_number text)
language sql stable security definer set search_path = public, app, pg_temp as $$
  select l.person_id, p.full_name, p.designation,
         (select m.full_name from public.reporting_lines r join public.persons m on m.id = r.manager_id where r.person_id = p.id and r.valid @> app.today() order by (r.function = 'operations') desc limit 1),
         (select string_agg(distinct b.name, ', ') from public.allocations a join public.client_locations cl on cl.id = a.client_location_id join public.branches b on b.id = cl.branch_id
           where a.person_id = p.id and a.valid @> least(app.today(), (l.month + interval '1 month - 1 day')::date)),
         (select r.status from public.payroll_runs r where r.month = l.month), l.payroll, l.branch_type,
         l.gross, l.days_in_month, l.day_rate, l.present_days, l.paid_leave_days, l.off_days, l.unpaid_days, l.not_employed_days, l.unpaid_override, l.override_reason,
         l.attendance_deduction, l.earned_gross, l.basic, l.pf_applicable, l.pf_employee, l.pf_employer, l.pf_admin, l.esi_employee, l.esi_employer,
         l.incentives, l.arrears, l.other_deductions, l.net_pay, l.flags,
         (select count(*)::int from public.payroll_adjustments a where a.month = l.month and a.person_id = l.person_id and a.status = 'proposed'),
         case when app.is_admin() or app.has_role('hr_admin') or app.is_ba_of(l.person_id) then coalesce(i.bank_name, h.bank_name) end,
         case when app.is_admin() or app.has_role('hr_admin') or app.is_ba_of(l.person_id) then coalesce(i.bank_ifsc, h.bank_ifsc) end,
         case when app.is_admin() or app.has_role('hr_admin') or app.is_ba_of(l.person_id) then coalesce(right(i.bank_account_number, 4), h.bank_account_last4) end,
         case when app.is_admin() or app.has_role('hr_admin') then i.bank_account_number end
    from public.payroll_lines l join public.persons p on p.id = l.person_id left join public.hr_profiles h on h.person_id = p.id
    left join public.hr_identity i on i.person_id = p.id
   where l.month = date_trunc('month', p_month)::date and app.can_see_pay(l.person_id, l.month) and not ('not on payroll' = any(l.flags))
   order by l.payroll, l.branch_type, p.full_name
$$;

revoke execute on function public.payroll_sheet(date), public.save_identity(uuid, jsonb), public.person_profile(uuid), public.scannable_documents(uuid) from public, anon;
grant execute on function public.payroll_sheet(date), public.save_identity(uuid, jsonb), public.person_profile(uuid), public.scannable_documents(uuid) to authenticated;
revoke execute on function app.verhoeff_ok(text), app.mask_id(text), app.profile_progress(uuid), app.refresh_profile_complete(uuid) from public, anon;
grant execute on function app.verhoeff_ok(text), app.mask_id(text), app.profile_progress(uuid) to authenticated;

-- everyone's completion is recomputed under the new rules (the scanned numbers are now part of it); old values kept
create table if not exists app.profile_completed_backup_20261110 as select person_id, completed_at from public.hr_profiles;
select set_config('app.reason', 'profile rules changed: ID numbers from scans (D-88)', false);
select app.refresh_profile_complete(p.id) from public.persons p where p.status <> 'exited';
