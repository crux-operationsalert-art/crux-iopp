-- 05 Nov owner review.
-- D-74 Only people who report daily figures carry clients. Admin, BI & Growth, Executive Assistants, Leadership and HR
--   (unless they also hold an operating role) have their client ticks ended today and cannot be given new ones.
-- D-75 Partners (BAs) vs CRUX employees: a checklist per Business Associate (the partner, not their staff) — agreement
--   signed / received, security cheque received with amount, number, bank, date — kept by HR / Admin, with the papers.
-- D-76 Employment details kept by managers and HR: joining date, PF applicable, PF opted, UAN (last 4).
-- D-77 Salary history: every change (joining, increment, revision, correction) with its reason; managers can propose an
--   increment for their team, HR / Admin approve it.
-- D-78 Payroll (monthly): HR prepares the sheet from salary, attendance and approved adjustments; managers review their
--   team and propose incentives / deductions / arrears with a reason; HR / Admin approve, lock, download and mark it sent
--   to Accounts. Rules (Settings): per-day pay = gross ÷ days in the month; unpaid days = absent + unplanned leave (half
--   day = ½); basic = 50% of earned gross; employee PF = 12% of basic, PF wage capped at ₹15,000. The app pays nothing.
-- D-79 Team attendance calendar: managers see the month, auto-marked from daily reporting, confirm or change each day
--   (a change needs a reason).

-- ---------------------------------------------------------------- D-74
create or replace function app.reports_figures(p_person uuid, p_date date default null) returns boolean
language sql stable security definer set search_path = public, app, pg_temp as $$
  select exists (select 1 from public.role_assignments r where r.person_id = p_person and r.valid @> coalesce(p_date, app.today())
                   and r.role::text in ('executive','manager','bm','ba','zm','ops_head','collections_head','product_head'))
      or not exists (select 1 from public.role_assignments r where r.person_id = p_person and r.valid @> coalesce(p_date, app.today()))
$$;
grant execute on function app.reports_figures(uuid, date) to authenticated;

create or replace function app.no_ticks_for_non_reporters() returns trigger language plpgsql as $$
begin
  if new.function = 'operations' and upper_inf(new.valid)
     and not app.reports_figures(new.person_id, greatest(lower(new.valid), app.today())) then
    raise exception '% does not report daily figures (Admin, BI & Growth, Executive Assistant, Leadership or HR), so no clients can be given to them.',
      (select full_name from public.persons where id = new.person_id) using errcode = 'P0001';
  end if;
  return new;
end $$;
drop trigger if exists trg_no_ticks on public.allocations;
create trigger trg_no_ticks before insert or update of valid, person_id on public.allocations for each row execute function app.no_ticks_for_non_reporters();

select set_config('app.reason', 'Does not report daily figures (D-74)', false);
update public.allocations a set valid = daterange(lower(a.valid), greatest(lower(a.valid) + 1, app.today()))
 where a.function = 'operations' and upper_inf(a.valid) and not app.reports_figures(a.person_id)
   and not exists (select 1 from public.productivity_lines l where l.person_id = a.person_id and l.client_location_id = a.client_location_id and l.work_date >= app.today());

-- whoami tells the app whether this person reports figures
do $do$
declare f text; o text;
begin
  f := pg_get_functiondef('public.whoami()'::regprocedure); o := f;
  f := replace(f, '''hr'', app.has_role(''hr_admin''),', '''hr'', app.has_role(''hr_admin''), ''reports_figures'', app.reports_figures(p.id),');
  if f = o then raise exception 'whoami anchor not found'; end if;
  execute f;
end $do$;

-- ---------------------------------------------------------------- D-75
alter table public.partner_agreements add column if not exists cheque_date date;
alter table public.person_documents drop constraint if exists person_documents_doc_type_check;
alter table public.person_documents add constraint person_documents_doc_type_check check (doc_type in
  ('aadhaar','pan','address_proof','qualification','bank','photo','police_verification','agreement','kyc_other','other',
   'security_cheque','partner_agreement','gst_certificate','cancelled_cheque','offer_letter','increment_letter'));

create or replace function public.partner_checklist()
returns table(person_id uuid, full_name text, status text, branch_id uuid, branch text, agreement_signed boolean, signed_on date,
              agreement_received boolean, received_on date, cheque_received boolean, cheque_amount numeric, cheque_number text, cheque_bank text,
              cheque_date date, note text, docs jsonb, complete boolean)
language plpgsql stable security definer set search_path = public, app, pg_temp as $$
begin
  if not (app.is_admin() or app.has_role('hr_admin')) then raise exception 'HR only.' using errcode = '42501'; end if;
  return query
  select p.id, p.full_name, p.status::text, b.id, b.name, coalesce(pa.agreement_signed, false), pa.signed_on, coalesce(pa.agreement_received, false), pa.received_on,
         coalesce(pa.cheque_received, false), pa.cheque_amount, pa.cheque_number, pa.cheque_bank, pa.cheque_date, pa.note,
         (select coalesce(jsonb_object_agg(t, n), '{}') from (select d.doc_type t, count(*) n from public.person_documents d where d.person_id = p.id and not d.rejected group by 1) z),
         coalesce(pa.agreement_signed and pa.agreement_received and pa.cheque_received, false)
           and exists (select 1 from public.person_documents d where d.person_id = p.id and d.doc_type in ('partner_agreement','agreement') and not d.rejected)
           and exists (select 1 from public.person_documents d where d.person_id = p.id and d.doc_type = 'security_cheque' and not d.rejected)
    from public.persons p
    join public.role_assignments r on r.person_id = p.id and r.role = 'ba' and r.valid @> app.today()
    left join public.location_heads h on h.person_id = p.id and h.head_role = 'branch_head' and h.valid @> app.today()
    left join public.branches b on b.id = h.branch_id
    left join public.partner_agreements pa on pa.branch_id = b.id
   where p.status <> 'exited'
   order by p.full_name, b.name;
end $$;

create or replace function public.set_partner_checklist(p_branch uuid, p jsonb)
returns void language plpgsql security definer set search_path = public, app, pg_temp as $$
begin
  if not (app.is_admin() or app.has_role('hr_admin')) then raise exception 'HR only.' using errcode = '42501'; end if;
  if coalesce((p->>'cheque_received')::boolean, false) and coalesce((p->>'cheque_amount')::numeric, 0) <= 0 then
    raise exception 'Enter the security cheque amount.' using errcode = 'P0001'; end if;
  if nullif(p->>'cheque_number', '') is not null and p->>'cheque_number' !~ '^[0-9]{6}$' then
    raise exception 'A cheque number has 6 digits.' using errcode = 'P0001'; end if;
  perform set_config('app.reason', coalesce(nullif(p->>'note', ''), 'partner checklist'), true);
  insert into public.partner_agreements as a (branch_id, agreement_signed, signed_on, agreement_received, received_on, cheque_received, cheque_amount,
                                              cheque_number, cheque_bank, cheque_date, note, updated_by, updated_at)
  values (p_branch, coalesce((p->>'agreement_signed')::boolean, false), nullif(p->>'signed_on', '')::date, coalesce((p->>'agreement_received')::boolean, false),
          nullif(p->>'received_on', '')::date, coalesce((p->>'cheque_received')::boolean, false),
          case when coalesce((p->>'cheque_received')::boolean, false) then nullif(p->>'cheque_amount', '')::numeric end,
          case when coalesce((p->>'cheque_received')::boolean, false) then nullif(p->>'cheque_number', '') end,
          case when coalesce((p->>'cheque_received')::boolean, false) then nullif(p->>'cheque_bank', '') end,
          case when coalesce((p->>'cheque_received')::boolean, false) then nullif(p->>'cheque_date', '')::date end,
          nullif(p->>'note', ''), app.me(), now())
  on conflict (branch_id) do update set agreement_signed = excluded.agreement_signed, signed_on = excluded.signed_on, agreement_received = excluded.agreement_received,
     received_on = excluded.received_on, cheque_received = excluded.cheque_received, cheque_amount = excluded.cheque_amount, cheque_number = excluded.cheque_number,
     cheque_bank = excluded.cheque_bank, cheque_date = excluded.cheque_date, note = excluded.note, updated_by = excluded.updated_by, updated_at = now();
end $$;

-- ---------------------------------------------------------------- D-76
alter table public.hr_profiles add column if not exists pf_applicable boolean;
alter table public.hr_profiles add column if not exists pf_opted boolean;
alter table public.hr_profiles add column if not exists uan_last4 text check (uan_last4 is null or uan_last4 ~ '^\d{4}$');
alter table public.hr_profiles add column if not exists employment_note text;

create or replace function public.employment_info(p_person uuid)
returns jsonb language plpgsql stable security definer set search_path = public, app, pg_temp as $$
declare v jsonb;
begin
  if not (app.is_admin() or app.has_role('hr_admin') or app.above(p_person) or p_person = app.me()) then raise exception 'Not permitted.' using errcode = '42501'; end if;
  select jsonb_build_object('person_id', p.id, 'full_name', p.full_name, 'designation', p.designation, 'resource_type', p.resource_type, 'joined_on', coalesce(h.joining_date, p.joined_on),
           'pf_applicable', h.pf_applicable, 'pf_opted', h.pf_opted, 'uan_last4', h.uan_last4, 'note', h.employment_note,
           'profile_complete', h.completed_at is not null)
    into v from public.persons p left join public.hr_profiles h on h.person_id = p.id where p.id = p_person;
  return v;
end $$;

create or replace function public.set_employment(p_person uuid, p jsonb)
returns void language plpgsql security definer set search_path = public, app, pg_temp as $$
begin
  if not (app.is_admin() or app.has_role('hr_admin') or app.above(p_person)) then
    raise exception 'Employment details are kept by the person''s managers and HR.' using errcode = '42501'; end if;
  if (p ? 'pf_opted') and coalesce((p->>'pf_opted')::boolean, false) and not coalesce((p->>'pf_applicable')::boolean, true) then
    raise exception 'PF cannot be opted when it is not applicable.' using errcode = 'P0001'; end if;
  perform set_config('app.reason', coalesce(nullif(p->>'note', ''), 'employment details'), true);
  insert into public.hr_profiles as h (person_id, joining_date, pf_applicable, pf_opted, uan_last4, employment_note)
  values (p_person, nullif(p->>'joined_on', '')::date, (p->>'pf_applicable')::boolean, (p->>'pf_opted')::boolean, nullif(p->>'uan_last4', ''), nullif(p->>'note', ''))
  on conflict (person_id) do update set
     joining_date = coalesce(excluded.joining_date, h.joining_date),
     pf_applicable = case when p ? 'pf_applicable' then excluded.pf_applicable else h.pf_applicable end,
     pf_opted = case when p ? 'pf_opted' then excluded.pf_opted else h.pf_opted end,
     uan_last4 = coalesce(excluded.uan_last4, h.uan_last4), employment_note = coalesce(excluded.employment_note, h.employment_note), updated_at = now();
end $$;

-- ---------------------------------------------------------------- D-77
alter table public.hr_compensation add column if not exists kind text not null default 'revision'
  check (kind in ('joining','increment','revision','correction'));
alter table public.hr_compensation add column if not exists reason text;

create or replace function public.set_compensation(p_person uuid, p_gross numeric, p_from date, p_kind text, p_reason text)
returns void language plpgsql security definer set search_path = public, app, pg_temp as $$
begin
  if not (app.is_admin() or app.has_role('hr_admin')) then raise exception 'Only HR / Admin change salaries (managers can propose an increment).' using errcode = '42501'; end if;
  if coalesce(p_gross, 0) <= 0 then raise exception 'Enter the monthly gross.' using errcode = 'P0001'; end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'Give the reason (e.g. annual increment 8%%).' using errcode = 'P0001'; end if;
  if exists (select 1 from public.payroll_runs r where r.status in ('approved','sent') and r.month >= date_trunc('month', p_from)::date) then
    raise exception 'Payroll from % is already approved. A change can only start after the last approved month (add the difference as arrears).', to_char(p_from, 'Mon YYYY') using errcode = 'P0001';
  end if;
  perform set_config('app.reason', p_reason, true);
  insert into public.hr_compensation(person_id, monthly_gross, effective_from, note, set_by, kind, reason)
  values (p_person, p_gross, p_from, p_reason, app.me(), p_kind, p_reason);
  insert into public.notifications(person_id, kind, message, link)
  values (p_person, 'salary', 'Your salary record was updated (' || p_kind || ', from ' || to_char(p_from, 'DD Mon YYYY') || ').', '/profile');
end $$;

create or replace function public.salary_history(p_person uuid)
returns table(effective_from date, monthly_gross numeric, kind text, reason text, set_by text, created_at timestamptz, change_pct numeric)
language plpgsql stable security definer set search_path = public, app, pg_temp as $$
begin
  if not (app.is_admin() or app.has_role('hr_admin') or app.above(p_person) or p_person = app.me()) then raise exception 'Not permitted.' using errcode = '42501'; end if;
  return query select c.effective_from, c.monthly_gross, c.kind, coalesce(c.reason, c.note), (select full_name from public.persons where id = c.set_by), c.created_at,
                      round((c.monthly_gross / nullif(lag(c.monthly_gross) over (order by c.effective_from, c.created_at), 0) - 1) * 100, 1)
                 from public.hr_compensation c where c.person_id = p_person order by c.effective_from desc, c.created_at desc;
end $$;

-- ---------------------------------------------------------------- D-78 payroll
insert into public.settings(key, value, description, label, help, kind, section, editable) values
  ('payroll_basic_pct', '50', 'Basic as % of gross (D-78)', 'Basic as % of gross', 'Used for PF. Basic = this % of the earned gross for the month.', 'number', 'Payroll', true),
  ('payroll_pf_rate', '12', 'Employee PF rate % (D-78)', 'Employee PF %', 'Deducted from basic when PF is applicable and opted.', 'number', 'Payroll', true),
  ('payroll_pf_wage_cap', '15000', 'PF wage ceiling ₹ (D-78)', 'PF wage ceiling ₹', 'PF is worked out on basic up to this amount (statutory ₹15,000). Set 0 for no cap.', 'number', 'Payroll', true),
  ('payroll_day_basis', '"calendar_days"', 'Per-day pay basis (D-78)', 'One day''s pay =', 'Gross ÷ days in the month (calendar_days), ÷ 26 (fixed_26) or ÷ working days.', 'choice:calendar_days,fixed_26,working_days', 'Payroll', true),
  ('payroll_unpaid_statuses', '"absent,unplanned_leave"', 'Attendance counted as unpaid (D-78)', 'Unpaid attendance', 'Comma list from: absent, unplanned_leave, planned_leave. Half day always counts ½.', 'text', 'Payroll', true)
on conflict (key) do nothing;

create table if not exists public.payroll_runs (
  month date primary key check (month = date_trunc('month', month)::date),
  status text not null default 'draft' check (status in ('draft','review','approved','sent')),
  prepared_by uuid references public.persons(id), prepared_at timestamptz,
  approved_by uuid references public.persons(id), approved_at timestamptz,
  sent_by uuid references public.persons(id), sent_at timestamptz, note text
);
create table if not exists public.payroll_lines (
  month date not null references public.payroll_runs(month),
  person_id uuid not null references public.persons(id),
  gross numeric(12,2) not null default 0, days_in_month int not null, day_rate numeric(12,2) not null default 0,
  present_days numeric(5,1) not null default 0, paid_leave_days numeric(5,1) not null default 0, off_days numeric(5,1) not null default 0,
  unpaid_days numeric(5,1) not null default 0, not_employed_days int not null default 0,
  unpaid_override numeric(5,1), override_reason text,
  attendance_deduction numeric(12,2) not null default 0, earned_gross numeric(12,2) not null default 0, basic numeric(12,2) not null default 0,
  pf_applicable boolean not null default false, pf_employee numeric(12,2) not null default 0,
  incentives numeric(12,2) not null default 0, arrears numeric(12,2) not null default 0, other_deductions numeric(12,2) not null default 0,
  net_pay numeric(12,2) not null default 0, flags text[] not null default '{}', computed_at timestamptz not null default now(),
  primary key (month, person_id)
);
create table if not exists public.payroll_adjustments (
  id uuid primary key default gen_random_uuid(),
  month date not null, person_id uuid not null references public.persons(id),
  kind text not null check (kind in ('incentive','arrear','deduction','increment')),
  amount numeric(12,2) not null check (amount > 0),
  reason text not null, purpose text, period_from date, period_to date,
  status text not null default 'proposed' check (status in ('proposed','approved','rejected')),
  proposed_by uuid references public.persons(id), proposed_at timestamptz not null default now(),
  decided_by uuid references public.persons(id), decided_at timestamptz, decision_note text,
  check (kind <> 'arrear' or (purpose is not null and period_from is not null))
);
alter table public.payroll_runs enable row level security;
alter table public.payroll_lines enable row level security;
alter table public.payroll_adjustments enable row level security;
revoke all on public.payroll_runs, public.payroll_lines, public.payroll_adjustments from anon, authenticated;
grant select on public.payroll_runs to authenticated;
create policy read_runs on public.payroll_runs for select to authenticated using ((select app.me()) is not null);
create trigger trg_audit after insert or update on public.payroll_runs for each row execute function app.audit();
create trigger trg_audit after insert or update on public.payroll_adjustments for each row execute function app.audit();

-- who may see a person's pay: HR / Admin, the managers above them, and the person once the month is approved
create or replace function app.can_see_pay(p_person uuid, p_month date) returns boolean
language sql stable security definer set search_path = public, app, pg_temp as $$
  select app.is_admin() or app.has_role('hr_admin') or app.above(p_person)
      or (p_person = app.me() and exists (select 1 from public.payroll_runs r where r.month = p_month and r.status in ('approved','sent')))
$$;

create or replace function app.payroll_compute(p_month date, p_person uuid) returns void
language plpgsql security definer set search_path = public, app, pg_temp as $$
declare v_e date := (p_month + interval '1 month - 1 day')::date; v_days int; v_gross numeric; v_rate numeric; v_join date; v_exit date;
        v_present numeric := 0; v_paid_leave numeric := 0; v_off numeric := 0; v_unpaid numeric := 0; v_out int := 0; d date; s text;
        v_unpaid_set text[] := string_to_array(coalesce(app.setting('payroll_unpaid_statuses') #>> '{}', 'absent,unplanned_leave'), ',');
        v_basis text := coalesce(app.setting('payroll_day_basis') #>> '{}', 'calendar_days'); v_l public.payroll_lines; v_pf boolean;
        v_earned numeric; v_basic numeric; v_cap numeric := coalesce((app.setting('payroll_pf_wage_cap') #>> '{}')::numeric, 15000);
        v_flags text[] := '{}'; v_div numeric;
begin
  select l.* into v_l from public.payroll_lines l where l.month = p_month and l.person_id = p_person;
  v_days := extract(day from v_e)::int;
  select c.monthly_gross into v_gross from public.hr_compensation c where c.person_id = p_person and c.effective_from <= v_e order by c.effective_from desc, c.created_at desc limit 1;
  if v_gross is null then v_flags := array_append(v_flags, 'no salary'); v_gross := 0; end if;
  select coalesce(h.joining_date, p.joined_on), p.exited_on into v_join, v_exit from public.persons p left join public.hr_profiles h on h.person_id = p.id where p.id = p_person;
  for d in select generate_series(p_month, v_e, interval '1 day')::date loop
    if (v_join is not null and d < v_join) or (v_exit is not null and d > v_exit) then v_out := v_out + 1; continue; end if;
    if d > app.today() then v_present := v_present + 1; continue; end if;      -- days still ahead count as worked
    s := coalesce((select a.status from public.attendance a where a.person_id = p_person and a.work_date = d), app.auto_attendance(p_person, d));
    if s in ('weekly_off','holiday') then v_off := v_off + 1;
    elsif s = 'half_day' then v_present := v_present + 0.5; v_unpaid := v_unpaid + 0.5;
    elsif s = any(v_unpaid_set) then v_unpaid := v_unpaid + 1;
    elsif s in ('planned_leave','unplanned_leave') then v_paid_leave := v_paid_leave + 1;
    elsif s = 'pending' then v_present := v_present + 1;
    else v_present := v_present + 1; end if;
  end loop;
  v_div := case v_basis when 'fixed_26' then 26 when 'working_days' then greatest(1, app.working_days_between(p_month, v_e)) else v_days end;
  v_rate := round(v_gross / v_div, 2);
  if v_l.unpaid_override is not null then v_unpaid := v_l.unpaid_override; end if;
  select coalesce(h.pf_applicable, false) and coalesce(h.pf_opted, h.pf_applicable, false) into v_pf from public.hr_profiles h where h.person_id = p_person;
  if not found then v_pf := false; v_flags := array_append(v_flags, 'PF details missing'); end if;
  v_earned := greatest(0, v_gross - round(v_rate * (v_unpaid + v_out), 2));
  v_basic := round(v_earned * coalesce((app.setting('payroll_basic_pct') #>> '{}')::numeric, 50) / 100, 2);
  insert into public.payroll_lines as l (month, person_id, gross, days_in_month, day_rate, present_days, paid_leave_days, off_days, unpaid_days, not_employed_days,
         unpaid_override, override_reason, attendance_deduction, earned_gross, basic, pf_applicable, pf_employee, incentives, arrears, other_deductions, net_pay, flags, computed_at)
  select p_month, p_person, v_gross, v_days, v_rate, v_present, v_paid_leave, v_off, v_unpaid, v_out, v_l.unpaid_override, v_l.override_reason,
         v_gross - v_earned, v_earned, v_basic, v_pf,
         case when v_pf then round(least(v_basic, case when v_cap > 0 then v_cap else v_basic end) * coalesce((app.setting('payroll_pf_rate') #>> '{}')::numeric, 12) / 100, 0) else 0 end,
         coalesce(sum(a.amount) filter (where a.kind = 'incentive'), 0), coalesce(sum(a.amount) filter (where a.kind = 'arrear'), 0),
         coalesce(sum(a.amount) filter (where a.kind = 'deduction'), 0), 0, v_flags, now()
    from (select 1) one left join public.payroll_adjustments a on a.month = p_month and a.person_id = p_person and a.status = 'approved' and a.kind <> 'increment'
  on conflict (month, person_id) do update set gross = excluded.gross, days_in_month = excluded.days_in_month, day_rate = excluded.day_rate,
     present_days = excluded.present_days, paid_leave_days = excluded.paid_leave_days, off_days = excluded.off_days, unpaid_days = excluded.unpaid_days,
     not_employed_days = excluded.not_employed_days, attendance_deduction = excluded.attendance_deduction, earned_gross = excluded.earned_gross,
     basic = excluded.basic, pf_applicable = excluded.pf_applicable, pf_employee = excluded.pf_employee, incentives = excluded.incentives,
     arrears = excluded.arrears, other_deductions = excluded.other_deductions, flags = excluded.flags, computed_at = now();
  update public.payroll_lines set net_pay = earned_gross + incentives + arrears - pf_employee - other_deductions where month = p_month and person_id = p_person;
end $$;
revoke all on function app.payroll_compute(date, uuid) from public, anon, authenticated;

create or replace function app.payroll_open(p_month date) returns void
language plpgsql security definer set search_path = public, app, pg_temp as $$
begin
  if exists (select 1 from public.payroll_runs r where r.month = p_month and r.status in ('approved','sent')) then
    raise exception 'Payroll for % is approved and locked.', to_char(p_month, 'Mon YYYY') using errcode = 'P0001';
  end if;
end $$;

create or replace function public.payroll_prepare(p_month date)
returns int language plpgsql security definer set search_path = public, app, pg_temp as $$
declare v_m date := date_trunc('month', p_month)::date; r record; n int := 0;
begin
  if not (app.is_admin() or app.has_role('hr_admin')) then raise exception 'Only HR / Admin prepare payroll.' using errcode = '42501'; end if;
  perform app.payroll_open(v_m);
  insert into public.payroll_runs(month, status, prepared_by, prepared_at) values (v_m, 'draft', app.me(), now())
  on conflict (month) do update set prepared_by = excluded.prepared_by, prepared_at = now();
  for r in select p.id from public.persons p
            where p.resource_type::text <> 'partner' and p.status in ('active','invited','exited')
              and (p.exited_on is null or p.exited_on >= v_m)
              and (exists (select 1 from public.hr_compensation c where c.person_id = p.id) or p.status = 'active') loop
    perform app.payroll_compute(v_m, r.id); n := n + 1;
  end loop;
  return n;
end $$;

create or replace function public.payroll_sheet(p_month date)
returns table(person_id uuid, full_name text, designation text, manager text, location text, status text, gross numeric, days_in_month int, day_rate numeric,
              present_days numeric, paid_leave_days numeric, off_days numeric, unpaid_days numeric, not_employed_days int, unpaid_override numeric, override_reason text,
              attendance_deduction numeric, earned_gross numeric, basic numeric, pf_applicable boolean, pf_employee numeric, incentives numeric, arrears numeric,
              other_deductions numeric, net_pay numeric, flags text[], pending_adjustments int, bank text, ifsc text, account_last4 text)
language sql stable security definer set search_path = public, app, pg_temp as $$
  select l.person_id, p.full_name, p.designation,
         (select m.full_name from public.reporting_lines r join public.persons m on m.id = r.manager_id where r.person_id = p.id and r.valid @> app.today() order by (r.function = 'operations') desc limit 1),
         (select string_agg(distinct b.name, ', ') from public.location_heads h join public.branches b on b.id = h.branch_id where h.person_id = p.id and h.valid @> app.today()),
         (select r.status from public.payroll_runs r where r.month = l.month),
         l.gross, l.days_in_month, l.day_rate, l.present_days, l.paid_leave_days, l.off_days, l.unpaid_days, l.not_employed_days, l.unpaid_override, l.override_reason,
         l.attendance_deduction, l.earned_gross, l.basic, l.pf_applicable, l.pf_employee, l.incentives, l.arrears, l.other_deductions, l.net_pay, l.flags,
         (select count(*)::int from public.payroll_adjustments a where a.month = l.month and a.person_id = l.person_id and a.status = 'proposed'),
         case when app.is_admin() or app.has_role('hr_admin') then h.bank_name end, case when app.is_admin() or app.has_role('hr_admin') then h.bank_ifsc end,
         case when app.is_admin() or app.has_role('hr_admin') then h.bank_account_last4 end
    from public.payroll_lines l join public.persons p on p.id = l.person_id left join public.hr_profiles h on h.person_id = p.id
   where l.month = date_trunc('month', p_month)::date and app.can_see_pay(l.person_id, l.month)
   order by p.full_name
$$;

create or replace function public.payroll_adjust(p_month date, p_person uuid, p_kind text, p_amount numeric, p_reason text,
                                                 p_purpose text default null, p_from date default null, p_to date default null)
returns uuid language plpgsql security definer set search_path = public, app, pg_temp as $$
declare v_m date := date_trunc('month', p_month)::date; v_hr boolean := app.is_admin() or app.has_role('hr_admin'); v_id uuid;
begin
  if not (v_hr or app.above(p_person)) then raise exception 'Only the person''s managers or HR can do this.' using errcode = '42501'; end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'Give the reason.' using errcode = 'P0001'; end if;
  if p_kind = 'arrear' and (coalesce(trim(p_purpose), '') = '' or p_from is null) then
    raise exception 'For arrears, say what it is for and the period it covers.' using errcode = 'P0001'; end if;
  if p_kind <> 'increment' then perform app.payroll_open(v_m); end if;
  perform set_config('app.reason', p_kind || ': ' || p_reason, true);
  insert into public.payroll_adjustments(month, person_id, kind, amount, reason, purpose, period_from, period_to, status, proposed_by, decided_by, decided_at)
  values (v_m, p_person, p_kind, p_amount, btrim(p_reason), nullif(btrim(coalesce(p_purpose, '')), ''), p_from, p_to,
          case when v_hr and p_kind <> 'increment' then 'approved' else 'proposed' end, app.me(),
          case when v_hr and p_kind <> 'increment' then app.me() end, case when v_hr and p_kind <> 'increment' then now() end)
  returning id into v_id;
  if v_hr and p_kind <> 'increment' and exists (select 1 from public.payroll_runs r where r.month = v_m) then perform app.payroll_compute(v_m, p_person); end if;
  if not v_hr or p_kind = 'increment' then
    insert into public.notifications(person_id, kind, message, link)
    select ra.person_id, 'payroll', (select full_name from public.persons where id = app.me()) || ' proposed ' || p_kind || ' of ₹' || p_amount || ' for '
           || (select full_name from public.persons where id = p_person) || ' (' || to_char(v_m, 'Mon YYYY') || ')', '/payroll'
      from public.role_assignments ra where ra.role = 'hr_admin' and ra.valid @> app.today();
  end if;
  return v_id;
end $$;

create or replace function public.payroll_decide(p_id uuid, p_approve boolean, p_note text default null, p_effective_from date default null)
returns void language plpgsql security definer set search_path = public, app, pg_temp as $$
declare a public.payroll_adjustments; v_cur numeric;
begin
  if not (app.is_admin() or app.has_role('hr_admin')) then raise exception 'Only HR / Admin approve.' using errcode = '42501'; end if;
  select * into a from public.payroll_adjustments where id = p_id for update;
  if a.id is null or a.status <> 'proposed' then raise exception 'Nothing to decide.' using errcode = 'P0001'; end if;
  if not p_approve and coalesce(trim(p_note), '') = '' then raise exception 'Say why it is not approved.' using errcode = 'P0001'; end if;
  if a.kind <> 'increment' then perform app.payroll_open(a.month); end if;
  update public.payroll_adjustments set status = case when p_approve then 'approved' else 'rejected' end, decided_by = app.me(), decided_at = now(), decision_note = p_note where id = p_id;
  if p_approve and a.kind = 'increment' then
    select c.monthly_gross into v_cur from public.hr_compensation c where c.person_id = a.person_id order by c.effective_from desc, c.created_at desc limit 1;
    perform public.set_compensation(a.person_id, coalesce(v_cur, 0) + a.amount, coalesce(p_effective_from, a.month), 'increment', a.reason);
  elsif p_approve and exists (select 1 from public.payroll_runs r where r.month = a.month) then
    perform app.payroll_compute(a.month, a.person_id);
  end if;
  insert into public.notifications(person_id, kind, message, link)
  values (a.proposed_by, 'payroll', initcap(a.kind) || ' for ' || (select full_name from public.persons where id = a.person_id) || ' was '
          || case when p_approve then 'approved' else 'not approved' || coalesce(': ' || p_note, '') end || '.', '/payroll');
end $$;

create or replace function public.payroll_override(p_month date, p_person uuid, p_unpaid_days numeric, p_reason text)
returns void language plpgsql security definer set search_path = public, app, pg_temp as $$
declare v_m date := date_trunc('month', p_month)::date;
begin
  if not (app.is_admin() or app.has_role('hr_admin')) then raise exception 'Only HR / Admin.' using errcode = '42501'; end if;
  perform app.payroll_open(v_m);
  if p_unpaid_days is not null and coalesce(trim(p_reason), '') = '' then raise exception 'Give the reason for changing unpaid days.' using errcode = 'P0001'; end if;
  perform set_config('app.reason', coalesce(p_reason, 'unpaid days back to attendance'), true);
  update public.payroll_lines set unpaid_override = p_unpaid_days, override_reason = case when p_unpaid_days is null then null else btrim(p_reason) end
   where month = v_m and person_id = p_person;
  perform app.payroll_compute(v_m, p_person);
end $$;

create or replace function public.payroll_set_status(p_month date, p_status text, p_note text default null)
returns void language plpgsql security definer set search_path = public, app, pg_temp as $$
declare v_m date := date_trunc('month', p_month)::date; v_r public.payroll_runs; n int;
begin
  if not (app.is_admin() or app.has_role('hr_admin')) then raise exception 'Only HR / Admin.' using errcode = '42501'; end if;
  select * into v_r from public.payroll_runs where month = v_m for update;
  if v_r.month is null then raise exception 'Prepare the payroll first.' using errcode = 'P0001'; end if;
  if p_status = 'review' then
    if v_r.status <> 'draft' then raise exception 'Only a draft can be sent for review.' using errcode = 'P0001'; end if;
    update public.payroll_runs set status = 'review', note = coalesce(p_note, note) where month = v_m;
    insert into public.notifications(person_id, kind, message, link)
    select distinct m.manager_id, 'payroll', 'Payroll for ' || to_char(v_m, 'Mon YYYY') || ' is ready for your review (your team). Propose any incentive, deduction or arrears today.', '/payroll'
      from public.payroll_lines l join public.reporting_lines m on m.person_id = l.person_id and m.valid @> app.today() where l.month = v_m;
  elsif p_status = 'approved' then
    if v_r.status not in ('draft','review') then raise exception 'Already approved.' using errcode = 'P0001'; end if;
    select count(*) into n from public.payroll_adjustments a where a.month = v_m and a.status = 'proposed' and a.kind <> 'increment';
    if n > 0 then raise exception '% proposed adjustment(s) still waiting — approve or reject them first.', n using errcode = 'P0001'; end if;
    perform public.payroll_prepare(v_m);
    update public.payroll_runs set status = 'approved', approved_by = app.me(), approved_at = now(), note = coalesce(p_note, note) where month = v_m;
    insert into public.notifications(person_id, kind, message, link)
    select l.person_id, 'payroll', 'Your pay statement for ' || to_char(v_m, 'Mon YYYY') || ' is ready.', '/payroll' from public.payroll_lines l where l.month = v_m;
  elsif p_status = 'sent' then
    if v_r.status <> 'approved' then raise exception 'Approve the payroll before sending it to Accounts.' using errcode = 'P0001'; end if;
    update public.payroll_runs set status = 'sent', sent_by = app.me(), sent_at = now(), note = coalesce(p_note, note) where month = v_m;
  elsif p_status = 'draft' then
    if not app.is_admin() then raise exception 'Only Admin can reopen an approved payroll.' using errcode = '42501'; end if;
    if coalesce(trim(p_note), '') = '' then raise exception 'Give the reason for reopening.' using errcode = 'P0001'; end if;
    perform set_config('app.reason', 'payroll reopened: ' || p_note, true);
    update public.payroll_runs set status = 'draft', approved_by = null, approved_at = null, sent_by = null, sent_at = null, note = p_note where month = v_m;
  else raise exception 'Unknown status.' using errcode = '22023';
  end if;
end $$;

create or replace function public.payroll_adjustments_list(p_month date)
returns table(id uuid, person_id uuid, full_name text, kind text, amount numeric, reason text, purpose text, period_from date, period_to date, status text,
              proposed_by text, proposed_at timestamptz, decided_by text, decision_note text)
language sql stable security definer set search_path = public, app, pg_temp as $$
  select a.id, a.person_id, p.full_name, a.kind, a.amount, a.reason, a.purpose, a.period_from, a.period_to, a.status,
         (select full_name from public.persons where id = a.proposed_by), a.proposed_at, (select full_name from public.persons where id = a.decided_by), a.decision_note
    from public.payroll_adjustments a join public.persons p on p.id = a.person_id
   where (a.month = date_trunc('month', p_month)::date or (a.kind = 'increment' and a.status = 'proposed'))
     and (app.is_admin() or app.has_role('hr_admin') or app.above(a.person_id) or a.proposed_by = app.me())
   order by (a.status = 'proposed') desc, a.proposed_at desc
$$;

-- people I may add adjustments for (and HR: everyone on payroll)
create or replace function public.payroll_people()
returns table(person_id uuid, full_name text, designation text)
language sql stable security definer set search_path = public, app, pg_temp as $$
  select p.id, p.full_name, p.designation from public.persons p
   where p.status in ('active','invited') and p.resource_type::text <> 'partner'
     and (app.is_admin() or app.has_role('hr_admin') or app.above(p.id))
   order by p.full_name
$$;

-- ---------------------------------------------------------------- D-79 attendance calendar
create or replace function public.team_attendance_month(p_month date, p_manager uuid default null)
returns table(person_id uuid, full_name text, designation text, work_date date, status text, final boolean, source text, reason text, auto text)
language plpgsql stable security definer set search_path = public, app, pg_temp as $$
declare v_m date := date_trunc('month', p_month)::date; v_e date; v_mgr uuid := coalesce(p_manager, app.me());
begin
  v_e := least((v_m + interval '1 month - 1 day')::date, app.today());
  if v_mgr <> app.me() and not (app.is_admin() or app.has_role('hr_admin') or app.above(v_mgr)) then raise exception 'Not permitted.' using errcode = '42501'; end if;
  return query
  with ppl as (select distinct r.person_id from public.reporting_lines r where r.manager_id = v_mgr and r.valid && daterange(v_m, v_e + 1)),
  days as (select generate_series(v_m, v_e, interval '1 day')::date d)
  select p.id, p.full_name, p.designation, dd.d, coalesce(a.status, x.auto), a.status is not null and a.source <> 'self', a.source, a.reason, x.auto
    from ppl k join public.persons p on p.id = k.person_id cross join days dd
    left join public.attendance a on a.person_id = p.id and a.work_date = dd.d
    cross join lateral (select app.auto_attendance(p.id, dd.d) auto) x
   where p.status in ('active','invited')
   order by p.full_name, dd.d;
end $$;

-- confirm a whole day for the team as auto-marked (no reason needed for rows left as reported)
create or replace function public.confirm_team_day(p_date date)
returns int language plpgsql security definer set search_path = public, app, pg_temp as $$
declare r record; n int := 0;
begin
  for r in select t.person_id, t.auto from public.team_attendance_month(p_date) t
            where t.work_date = p_date and not t.final and t.auto not in ('pending') loop
    perform public.set_attendance(r.person_id, p_date, r.auto, 'Confirmed as reported');
    n := n + 1;
  end loop;
  return n;
end $$;

grant execute on function public.partner_checklist(), public.set_partner_checklist(uuid, jsonb), public.employment_info(uuid), public.set_employment(uuid, jsonb),
  public.set_compensation(uuid, numeric, date, text, text), public.salary_history(uuid), public.payroll_prepare(date), public.payroll_sheet(date),
  public.payroll_adjust(date, uuid, text, numeric, text, text, date, date), public.payroll_decide(uuid, boolean, text, date), public.payroll_override(date, uuid, numeric, text),
  public.payroll_set_status(date, text, text), public.payroll_adjustments_list(date), public.payroll_people(), public.team_attendance_month(date, uuid),
  public.confirm_team_day(date) to authenticated;
revoke all on function public.partner_checklist(), public.set_partner_checklist(uuid, jsonb), public.employment_info(uuid), public.set_employment(uuid, jsonb),
  public.set_compensation(uuid, numeric, date, text, text), public.salary_history(uuid), public.payroll_prepare(date), public.payroll_sheet(date),
  public.payroll_adjust(date, uuid, text, numeric, text, text, date, date), public.payroll_decide(uuid, boolean, text, date), public.payroll_override(date, uuid, numeric, text),
  public.payroll_set_status(date, text, text), public.payroll_adjustments_list(date), public.payroll_people(), public.team_attendance_month(date, uuid),
  public.confirm_team_day(date), app.can_see_pay(uuid, date), app.payroll_open(date) from public, anon;
grant execute on function app.can_see_pay(uuid, date) to authenticated;

-- ---------------------------------------------------------------- D-75 performance by own vs partner branches
-- perf_dashboard(month, 'own' | 'partner'): the same dashboard limited to own or partner branches (null = overall).
do $do$
declare f text;
begin
  f := pg_get_functiondef('public.perf_dashboard(date)'::regprocedure);
  f := replace(f, 'public.perf_dashboard(p_month date DEFAULT NULL::date)', 'public.perf_dashboard(p_month date, p_branch_type text)');
  f := replace(f, 'with vis as (select * from app.visible_branches(least(v_today, (v_m + interval ''1 month - 1 day'')::date)) b(id)),',
                  'with vis as (select * from app.visible_branches(least(v_today, (v_m + interval ''1 month - 1 day'')::date)) b(id)
                   where p_branch_type is null or exists (select 1 from public.branches x where x.id = b.id and x.branch_type::text = p_branch_type)),');
  if position('p_branch_type text' in f) = 0 or position('x.branch_type::text = p_branch_type' in f) = 0 then raise exception 'perf_dashboard anchors not found'; end if;
  execute f;
end $do$;
grant execute on function public.perf_dashboard(date, text) to authenticated;
revoke all on function public.perf_dashboard(date, text) from public, anon;
