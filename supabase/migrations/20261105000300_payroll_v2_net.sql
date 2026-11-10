-- 05 Nov owner decisions on payroll, and a network check.
-- D-78a Managers see the pay of their DIRECT team only (and propose for them); HR / Admin see all; a person sees their own
--   once the month is approved.
-- D-78b PF is on for everyone by default (opt-outs are recorded per person). Both employee and employer contributions are
--   deducted from the salary (cost-to-company), as per the statutory rates: PF 12% + 12% of basic (PF wage up to ₹15,000);
--   ESI 0.75% + 3.25% of gross when gross ≤ ₹21,000. PF admin / EDLI charges are a setting (0% until HR sets them).
-- D-78c Payroll covers all CRUX employees plus partner-branch staff whom their BA marks "on CRUX payroll"; it is shown in
--   two parts, Own branches and Partner branches. A BA can also run their own staff's payroll here with the same rules
--   (BA payroll, not paid by CRUX). BAs themselves are paid by a monthly claim (to be designed) and are not on payroll.
-- D-80 Network check: when the app cannot reach the server it tests the internet, the server and the name lookup, tells the
--   person what to do, and reports the result once it is back online, so blocked networks can be identified.

-- ---------------------------------------------------------------- D-80
create table if not exists public.net_events (
  id bigint generated always as identity primary key,
  person_id uuid references public.persons(id), at timestamptz not null, received_at timestamptz not null default now(),
  kind text not null, detail jsonb not null default '{}'
);
alter table public.net_events enable row level security;
revoke all on public.net_events from anon, authenticated;
grant select on public.net_events to authenticated;
create policy read_net on public.net_events for select to authenticated using ((select app.is_admin()));
create or replace function public.log_net_events(p_events jsonb) returns int
language plpgsql security definer set search_path = public, app, pg_temp as $$
declare n int;
begin
  insert into public.net_events(person_id, at, kind, detail)
  select app.me(), coalesce((e->>'at')::timestamptz, now()), left(coalesce(e->>'kind', 'unknown'), 40), coalesce(e->'detail', '{}')
    from (select e from jsonb_array_elements(coalesce(p_events, '[]')) e limit 50) z;
  get diagnostics n = row_count;
  return n;
end $$;
grant execute on function public.log_net_events(jsonb) to authenticated;
revoke all on function public.log_net_events(jsonb) from public, anon;

-- ---------------------------------------------------------------- D-78a direct team only
create or replace function app.direct_mgr(p_person uuid) returns boolean
language sql stable security definer set search_path = public, app, pg_temp as $$
  select app.me() is not null and (app.is_direct_report(p_person, 'operations', app.today()) or app.is_direct_report(p_person, 'collections', app.today()))
$$;
grant execute on function app.direct_mgr(uuid) to authenticated;

create or replace function app.can_see_pay(p_person uuid, p_month date) returns boolean
language sql stable security definer set search_path = public, app, pg_temp as $$
  select app.is_admin() or app.has_role('hr_admin') or app.direct_mgr(p_person)
      or (p_person = app.me() and exists (select 1 from public.payroll_runs r where r.month = p_month and r.status in ('approved','sent')))
$$;

-- ---------------------------------------------------------------- D-78b PF on by default
alter table public.hr_profiles alter column pf_applicable set default true;
alter table public.hr_profiles alter column pf_opted set default true;
select set_config('app.reason', 'PF on by default (D-78b)', false);
update public.hr_profiles set pf_applicable = coalesce(pf_applicable, true), pf_opted = coalesce(pf_opted, coalesce(pf_applicable, true))
 where pf_applicable is null or pf_opted is null;

insert into public.settings(key, value, description, label, help, kind, section, editable) values
  ('payroll_employer_pf_rate', '12', 'Employer PF % (D-78b)', 'Employer PF %', 'Employer PF (EPF 3.67% + EPS 8.33%) on the same PF wage. Deducted from salary (cost to company).', 'number', 'Payroll', true),
  ('payroll_pf_admin_rate', '0', 'PF admin + EDLI % (D-78b)', 'PF admin + EDLI %', 'Employer PF admin and EDLI charges on PF wage, if they are part of the salary (e.g. 1). 0 = not deducted.', 'number', 'Payroll', true),
  ('payroll_esi_wage_limit', '21000', 'ESI applies up to this gross ₹ (D-78b)', 'ESI applies when gross is up to ₹', 'Statutory ESI ceiling.', 'number', 'Payroll', true),
  ('payroll_esi_employee_rate', '0.75', 'ESI employee % (D-78b)', 'ESI employee %', 'Of earned gross.', 'number', 'Payroll', true),
  ('payroll_esi_employer_rate', '3.25', 'ESI employer % (D-78b)', 'ESI employer %', 'Of earned gross. Deducted from salary (cost to company).', 'number', 'Payroll', true)
on conflict (key) do nothing;
update public.settings set help = 'Used for PF. Basic = this % of the earned gross for the month.' where key = 'payroll_basic_pct';

-- ---------------------------------------------------------------- D-78c who is on which payroll
alter table public.persons add column if not exists on_crux_payroll boolean;
comment on column public.persons.on_crux_payroll is 'Partner-branch staff only: true when the BA has put them on CRUX payroll';
create or replace function app.pay_group(p_person uuid) returns text
language sql stable security definer set search_path = public, app, pg_temp as $$
  select case
    when exists (select 1 from public.role_assignments r where r.person_id = p.id and r.role = 'ba' and r.valid @> app.today()) then null   -- BA: monthly claim
    when p.resource_type = 'own_employee' then 'crux'
    when coalesce(p.on_crux_payroll, false) then 'crux'
    else 'partner' end
    from public.persons p where p.id = p_person
$$;
grant execute on function app.pay_group(uuid) to authenticated;
create or replace function app.is_ba_of(p_person uuid) returns boolean
language sql stable security definer set search_path = public, app, pg_temp as $$
  select app.direct_mgr(p_person) and exists (select 1 from public.role_assignments r where r.person_id = app.me() and r.role = 'ba' and r.valid @> app.today())
$$;
grant execute on function app.is_ba_of(uuid) to authenticated;

create or replace function public.set_on_crux_payroll(p_person uuid, p_on boolean, p_reason text)
returns void language plpgsql security definer set search_path = public, app, pg_temp as $$
begin
  if not (app.is_admin() or app.has_role('hr_admin') or app.is_ba_of(p_person)) then raise exception 'Only the person''s BA or HR can change this.' using errcode = '42501'; end if;
  if (select resource_type from public.persons where id = p_person) <> 'partner' then raise exception 'CRUX employees are always on CRUX payroll.' using errcode = 'P0001'; end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'Give the reason.' using errcode = 'P0001'; end if;
  perform set_config('app.reason', p_reason, true);
  update public.persons set on_crux_payroll = p_on where id = p_person;
end $$;
grant execute on function public.set_on_crux_payroll(uuid, boolean, text) to authenticated;
revoke all on function public.set_on_crux_payroll(uuid, boolean, text) from public, anon;

alter table public.payroll_lines add column if not exists payroll text not null default 'crux' check (payroll in ('crux','partner'));
alter table public.payroll_lines add column if not exists branch_type text not null default 'own' check (branch_type in ('own','partner'));
alter table public.payroll_lines add column if not exists pf_employer numeric(12,2) not null default 0;
alter table public.payroll_lines add column if not exists pf_admin numeric(12,2) not null default 0;
alter table public.payroll_lines add column if not exists esi_employee numeric(12,2) not null default 0;
alter table public.payroll_lines add column if not exists esi_employer numeric(12,2) not null default 0;

-- salary for BA payroll staff: their BA may record it (HR / Admin for everyone)
create or replace function public.set_compensation(p_person uuid, p_gross numeric, p_from date, p_kind text, p_reason text)
returns void language plpgsql security definer set search_path = public, app, pg_temp as $$
begin
  if not (app.is_admin() or app.has_role('hr_admin') or (app.is_ba_of(p_person) and app.pay_group(p_person) = 'partner')) then
    raise exception 'Only HR / Admin change salaries (managers can propose an increment; a BA records salaries of staff on BA payroll).' using errcode = '42501'; end if;
  if coalesce(p_gross, 0) <= 0 then raise exception 'Enter the monthly gross.' using errcode = 'P0001'; end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'Give the reason (e.g. annual increment 8%%).' using errcode = 'P0001'; end if;
  if exists (select 1 from public.payroll_runs r join public.payroll_lines l on l.month = r.month and l.person_id = p_person
              where r.status in ('approved','sent') and r.month >= date_trunc('month', p_from)::date and not ('not on payroll' = any(l.flags))) then
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
  if not (app.is_admin() or app.has_role('hr_admin') or app.direct_mgr(p_person) or p_person = app.me()) then raise exception 'Not permitted.' using errcode = '42501'; end if;
  return query select c.effective_from, c.monthly_gross, c.kind, coalesce(c.reason, c.note), (select full_name from public.persons where id = c.set_by), c.created_at,
                      round((c.monthly_gross / nullif(lag(c.monthly_gross) over (order by c.effective_from, c.created_at), 0) - 1) * 100, 1)
                 from public.hr_compensation c where c.person_id = p_person order by c.effective_from desc, c.created_at desc;
end $$;

create or replace function app.payroll_compute(p_month date, p_person uuid) returns void
language plpgsql security definer set search_path = public, app, pg_temp as $$
declare v_e date := (p_month + interval '1 month - 1 day')::date; v_days int; v_gross numeric; v_rate numeric; v_join date; v_exit date;
        v_present numeric := 0; v_paid_leave numeric := 0; v_off numeric := 0; v_unpaid numeric := 0; v_out int := 0; d date; s text;
        v_unpaid_set text[] := string_to_array(coalesce(app.setting('payroll_unpaid_statuses') #>> '{}', 'absent,unplanned_leave'), ',');
        v_basis text := coalesce(app.setting('payroll_day_basis') #>> '{}', 'calendar_days'); v_l public.payroll_lines; v_pf boolean;
        v_earned numeric; v_basic numeric; v_cap numeric := coalesce((app.setting('payroll_pf_wage_cap') #>> '{}')::numeric, 15000);
        v_flags text[] := '{}'; v_div numeric; v_pfw numeric; v_esi boolean; v_grp text := app.pay_group(p_person);
        v_bt text;
begin
  if v_grp is null then return; end if;
  select l.* into v_l from public.payroll_lines l where l.month = p_month and l.person_id = p_person;
  v_days := extract(day from v_e)::int;
  select c.monthly_gross into v_gross from public.hr_compensation c where c.person_id = p_person and c.effective_from <= v_e order by c.effective_from desc, c.created_at desc limit 1;
  if v_gross is null then v_flags := array_append(v_flags, 'no salary'); v_gross := 0; end if;
  select coalesce(h.joining_date, p.joined_on), p.exited_on, case when p.resource_type = 'partner' then 'partner' else 'own' end
    into v_join, v_exit, v_bt from public.persons p left join public.hr_profiles h on h.person_id = p.id where p.id = p_person;
  for d in select generate_series(p_month, v_e, interval '1 day')::date loop
    if (v_join is not null and d < v_join) or (v_exit is not null and d > v_exit) then v_out := v_out + 1; continue; end if;
    if d > app.today() then v_present := v_present + 1; continue; end if;
    s := coalesce((select a.status from public.attendance a where a.person_id = p_person and a.work_date = d), app.auto_attendance(p_person, d));
    if s in ('weekly_off','holiday') then v_off := v_off + 1;
    elsif s = 'half_day' then v_present := v_present + 0.5; v_unpaid := v_unpaid + 0.5;
    elsif s = any(v_unpaid_set) then v_unpaid := v_unpaid + 1;
    elsif s in ('planned_leave','unplanned_leave') then v_paid_leave := v_paid_leave + 1;
    else v_present := v_present + 1; end if;
  end loop;
  v_div := case v_basis when 'fixed_26' then 26 when 'working_days' then greatest(1, app.working_days_between(p_month, v_e)) else v_days end;
  v_rate := round(v_gross / v_div, 2);
  if v_l.unpaid_override is not null then v_unpaid := v_l.unpaid_override; end if;
  select coalesce(h.pf_applicable, true) and coalesce(h.pf_opted, h.pf_applicable, true) into v_pf from public.hr_profiles h where h.person_id = p_person;
  if not found then v_pf := true; end if;                                   -- PF on by default
  v_earned := greatest(0, v_gross - round(v_rate * (v_unpaid + v_out), 2));
  v_basic := round(v_earned * coalesce((app.setting('payroll_basic_pct') #>> '{}')::numeric, 50) / 100, 2);
  v_pfw := least(v_basic, case when v_cap > 0 then v_cap else v_basic end);
  v_esi := v_gross > 0 and v_gross <= coalesce((app.setting('payroll_esi_wage_limit') #>> '{}')::numeric, 21000);
  insert into public.payroll_lines as l (month, person_id, gross, days_in_month, day_rate, present_days, paid_leave_days, off_days, unpaid_days, not_employed_days,
         unpaid_override, override_reason, attendance_deduction, earned_gross, basic, pf_applicable, pf_employee, pf_employer, pf_admin, esi_employee, esi_employer,
         incentives, arrears, other_deductions, net_pay, flags, computed_at, payroll, branch_type)
  select p_month, p_person, v_gross, v_days, v_rate, v_present, v_paid_leave, v_off, v_unpaid, v_out, v_l.unpaid_override, v_l.override_reason,
         v_gross - v_earned, v_earned, v_basic, v_pf,
         case when v_pf then round(v_pfw * coalesce((app.setting('payroll_pf_rate') #>> '{}')::numeric, 12) / 100, 0) else 0 end,
         case when v_pf then round(v_pfw * coalesce((app.setting('payroll_employer_pf_rate') #>> '{}')::numeric, 12) / 100, 0) else 0 end,
         case when v_pf then round(v_pfw * coalesce((app.setting('payroll_pf_admin_rate') #>> '{}')::numeric, 0) / 100, 0) else 0 end,
         case when v_esi then ceil(v_earned * coalesce((app.setting('payroll_esi_employee_rate') #>> '{}')::numeric, 0.75) / 100) else 0 end,
         case when v_esi then ceil(v_earned * coalesce((app.setting('payroll_esi_employer_rate') #>> '{}')::numeric, 3.25) / 100) else 0 end,
         coalesce(sum(a.amount) filter (where a.kind = 'incentive'), 0), coalesce(sum(a.amount) filter (where a.kind = 'arrear'), 0),
         coalesce(sum(a.amount) filter (where a.kind = 'deduction'), 0), 0, v_flags, now(), v_grp, v_bt
    from (select 1) one left join public.payroll_adjustments a on a.month = p_month and a.person_id = p_person and a.status = 'approved' and a.kind <> 'increment'
  on conflict (month, person_id) do update set gross = excluded.gross, days_in_month = excluded.days_in_month, day_rate = excluded.day_rate,
     present_days = excluded.present_days, paid_leave_days = excluded.paid_leave_days, off_days = excluded.off_days, unpaid_days = excluded.unpaid_days,
     not_employed_days = excluded.not_employed_days, attendance_deduction = excluded.attendance_deduction, earned_gross = excluded.earned_gross,
     basic = excluded.basic, pf_applicable = excluded.pf_applicable, pf_employee = excluded.pf_employee, pf_employer = excluded.pf_employer, pf_admin = excluded.pf_admin,
     esi_employee = excluded.esi_employee, esi_employer = excluded.esi_employer, incentives = excluded.incentives,
     arrears = excluded.arrears, other_deductions = excluded.other_deductions, flags = excluded.flags, computed_at = now(), payroll = excluded.payroll, branch_type = excluded.branch_type;
  update public.payroll_lines set net_pay = earned_gross + incentives + arrears - pf_employee - pf_employer - pf_admin - esi_employee - esi_employer - other_deductions
   where month = p_month and person_id = p_person;
end $$;
revoke all on function app.payroll_compute(date, uuid) from public, anon, authenticated;

create or replace function public.payroll_prepare(p_month date)
returns int language plpgsql security definer set search_path = public, app, pg_temp as $$
declare v_m date := date_trunc('month', p_month)::date; r record; n int := 0;
begin
  if not (app.is_admin() or app.has_role('hr_admin')) then raise exception 'Only HR / Admin prepare payroll.' using errcode = '42501'; end if;
  perform app.payroll_open(v_m);
  insert into public.payroll_runs(month, status, prepared_by, prepared_at) values (v_m, 'draft', app.me(), now())
  on conflict (month) do update set prepared_by = excluded.prepared_by, prepared_at = now();
  -- someone who left payroll since the last preparation (e.g. became a BA) drops off the sheet
  update public.payroll_lines l set net_pay = 0, flags = array['not on payroll'] where l.month = v_m and app.pay_group(l.person_id) is null;
  for r in select p.id from public.persons p
            where p.status in ('active','invited','exited') and (p.exited_on is null or p.exited_on >= v_m)
              and app.pay_group(p.id) is not null
              and (exists (select 1 from public.hr_compensation c where c.person_id = p.id) or p.status = 'active') loop
    perform app.payroll_compute(v_m, r.id); n := n + 1;
  end loop;
  return n;
end $$;

drop function if exists public.payroll_sheet(date);
create function public.payroll_sheet(p_month date)
returns table(person_id uuid, full_name text, designation text, manager text, location text, status text, payroll text, branch_type text, gross numeric, days_in_month int, day_rate numeric,
              present_days numeric, paid_leave_days numeric, off_days numeric, unpaid_days numeric, not_employed_days int, unpaid_override numeric, override_reason text,
              attendance_deduction numeric, earned_gross numeric, basic numeric, pf_applicable boolean, pf_employee numeric, pf_employer numeric, pf_admin numeric,
              esi_employee numeric, esi_employer numeric, incentives numeric, arrears numeric,
              other_deductions numeric, net_pay numeric, flags text[], pending_adjustments int, bank text, ifsc text, account_last4 text)
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
         case when app.is_admin() or app.has_role('hr_admin') or app.is_ba_of(l.person_id) then h.bank_name end,
         case when app.is_admin() or app.has_role('hr_admin') or app.is_ba_of(l.person_id) then h.bank_ifsc end,
         case when app.is_admin() or app.has_role('hr_admin') or app.is_ba_of(l.person_id) then h.bank_account_last4 end
    from public.payroll_lines l join public.persons p on p.id = l.person_id left join public.hr_profiles h on h.person_id = p.id
   where l.month = date_trunc('month', p_month)::date and app.can_see_pay(l.person_id, l.month) and not ('not on payroll' = any(l.flags))
   order by l.payroll, l.branch_type, p.full_name
$$;

-- proposals: direct manager (a BA's own payroll staff: the BA adds directly)
create or replace function public.payroll_adjust(p_month date, p_person uuid, p_kind text, p_amount numeric, p_reason text,
                                                 p_purpose text default null, p_from date default null, p_to date default null)
returns uuid language plpgsql security definer set search_path = public, app, pg_temp as $$
declare v_m date := date_trunc('month', p_month)::date; v_hr boolean := app.is_admin() or app.has_role('hr_admin')
        or (app.is_ba_of(p_person) and app.pay_group(p_person) = 'partner'); v_id uuid;
begin
  if not (v_hr or app.direct_mgr(p_person)) then raise exception 'Only the person''s direct manager or HR can do this.' using errcode = '42501'; end if;
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

create or replace function public.payroll_adjustments_list(p_month date)
returns table(id uuid, person_id uuid, full_name text, kind text, amount numeric, reason text, purpose text, period_from date, period_to date, status text,
              proposed_by text, proposed_at timestamptz, decided_by text, decision_note text)
language sql stable security definer set search_path = public, app, pg_temp as $$
  select a.id, a.person_id, p.full_name, a.kind, a.amount, a.reason, a.purpose, a.period_from, a.period_to, a.status,
         (select full_name from public.persons where id = a.proposed_by), a.proposed_at, (select full_name from public.persons where id = a.decided_by), a.decision_note
    from public.payroll_adjustments a join public.persons p on p.id = a.person_id
   where (a.month = date_trunc('month', p_month)::date or (a.kind = 'increment' and a.status = 'proposed'))
     and (app.is_admin() or app.has_role('hr_admin') or app.direct_mgr(a.person_id) or a.proposed_by = app.me())
   order by (a.status = 'proposed') desc, a.proposed_at desc
$$;

drop function if exists public.payroll_people();
create function public.payroll_people()
returns table(person_id uuid, full_name text, designation text, pay_group text, resource_type text, on_crux_payroll boolean)
language sql stable security definer set search_path = public, app, pg_temp as $$
  select p.id, p.full_name, p.designation, app.pay_group(p.id), p.resource_type, p.on_crux_payroll from public.persons p
   where p.status in ('active','invited') and app.pay_group(p.id) is not null
     and (app.is_admin() or app.has_role('hr_admin') or app.direct_mgr(p.id))
   order by p.full_name
$$;

grant execute on function public.payroll_sheet(date), public.payroll_people() to authenticated;
revoke all on function public.payroll_sheet(date), public.payroll_people() from public, anon;
