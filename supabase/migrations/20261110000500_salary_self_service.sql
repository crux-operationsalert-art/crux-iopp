-- 10 Nov owner requests (D-92 .. D-96).
-- D-92 Salary self-declaration: everyone enters either their annual CTC or their monthly in-hand pay, PF yes/no (default
--      yes; opting out only allowed above the PF wage ceiling), PLB yes/no with % (default 20% of CTC, part of CTC). The full
--      break-up is shown. HR / Admin approve; approval becomes the salary record (same rules as set_compensation).
--      Admin can switch self-declaration off (setting salary_self_service). Visible to the person, HR and Admin only.
-- D-93 One calculator for the preview and for payroll (labour codes, in force 21 Nov 2025): basic = 50% of fixed pay
--      (wages ≥ 50%), HRA 40% of basic, special allowance = rest. PF 12% + 12% on basic up to the PF wage ceiling, which is
--      ₹25,000 from 17 Sep 2026 (S.O. 5109(E)); ESI 0.75% + 3.25% when gross ≤ ₹21,000; employer PF / ESI are part of CTC.
--      PLB is part of annual CTC, paid separately (not in monthly pay). Gratuity is not part of CTC here (setting later).
-- D-94 Professional tax by state on the month's earned gross (default state Maharashtra; HR can set it per person):
--      MH ≤7,500 nil, ≤10,000 ₹175, above ₹200 (₹300 in February); women up to ₹25,000 exempt. Other states per their slabs;
--      states without PT → nil; states not configured → nil and flagged for HR.
-- D-95 Reminders: profile below 100% → 5 a day (10, 12, 2, 4, 6 o'clock); salary not declared → in the same reminder;
--      using the app in a browser without installing it → 2 a day (11, 5 o'clock). Started at once.
-- D-96 The app records whether it is used installed (home-screen app) or in a browser, to target the install reminder.

-- ------------------------------------------------------------------ settings
select set_config('app.reason', 'PF wage ceiling ₹25,000 from 17 Sep 2026 (S.O. 5109(E)); salary self-service (D-92..D-96)', false);
update public.settings set value = '25000', help = 'PF wage ceiling. ₹25,000 from 17 Sep 2026 (S.O. 5109(E); was ₹15,000).' where key = 'payroll_pf_wage_cap';
insert into public.settings(key, value, description, label, help, kind, section, editable) values
  ('salary_self_service', 'true', 'People declare their own salary (HR approves)', 'Salary self-declaration', 'When on, everyone can enter their CTC or in-hand pay, PF and PLB choices; HR / Admin approve. Turn off to let only HR enter salaries.', 'toggle', 'Payroll', true),
  ('plb_default_pct', '20', 'Performance linked bonus % of CTC', 'PLB % (default)', 'Default share of annual CTC that is performance linked bonus when someone opts in.', 'number', 'Payroll', true),
  ('payroll_hra_pct', '40', 'HRA % of basic', 'HRA % of basic', 'House rent allowance shown in the salary break-up (part of fixed pay).', 'number', 'Payroll', true),
  ('pt_default_state', '"MH"', 'Professional tax state', 'PT state (default)', 'State code used for professional tax when a person''s work state is not set (MH, KA, KL, TN, WB, GJ, TG, AP, MP, OR, DL, UP …).', 'text', 'Payroll', true)
on conflict (key) do nothing;

alter table public.hr_profiles add column if not exists plb_opted boolean, add column if not exists plb_pct numeric, add column if not exists pt_state text;
alter table public.payroll_lines add column if not exists pt numeric not null default 0;

-- ------------------------------------------------------------------ D-94 professional tax
create or replace function app.pt_monthly(p_state text, p_gross numeric, p_gender text, p_month int) returns numeric
language plpgsql immutable set search_path = pg_temp as $$
declare g numeric := coalesce(p_gross, 0); s text := upper(coalesce(p_state, '')); h numeric := coalesce(p_gross, 0) * 6;
begin
  if g <= 0 then return 0; end if;
  if s in ('MH', 'MAHARASHTRA') then
    if lower(coalesce(p_gender, '')) = 'female' and g <= 25000 then return 0; end if;
    return case when g <= 7500 then 0 when g <= 10000 then 175 when p_month = 2 then 300 else 200 end;
  elsif s in ('KA', 'KARNATAKA') then return case when g <= 25000 then 0 when g < 42000 then 150 else 200 end;
  elsif s in ('WB', 'WEST BENGAL') then return case when g <= 10000 then 0 when g <= 15000 then 110 when g <= 25000 then 130 when g <= 40000 then 150 else 200 end;
  elsif s in ('GJ', 'GUJARAT') then return case when g < 6000 then 0 when g < 9000 then 80 when g < 12000 then 150 else 200 end;
  elsif s in ('TG', 'TS', 'TELANGANA', 'AP', 'ANDHRA PRADESH') then return case when g <= 15000 then 0 when g <= 20000 then 150 else 200 end;
  elsif s in ('MP', 'MADHYA PRADESH') then return case when g <= 18750 then 0 when g <= 25000 then 125 when g <= 33333 then 167 else 208 end;
  elsif s in ('OR', 'OD', 'ODISHA') then return case when g <= 13304 then 0 when g <= 25000 then 125 when g <= 41666 then 167 else 208 end;
  elsif s in ('KL', 'KERALA') then   -- half-yearly slab on six months' pay, spread over the months
    return round((case when h < 12000 then 0 when h < 18000 then 120 when h < 30000 then 180 when h < 45000 then 300 when h < 60000 then 450
                       when h < 75000 then 600 when h < 100000 then 750 when h < 125000 then 1000 else 1250 end) / 6.0);
  elsif s in ('TN', 'TAMIL NADU') then
    return round((case when h <= 21000 then 0 when h <= 30000 then 135 when h <= 45000 then 315 when h <= 60000 then 690 when h <= 75000 then 1025 else 1250 end) / 6.0);
  elsif s in ('DL', 'DELHI', 'UP', 'UTTAR PRADESH', 'HR', 'HARYANA', 'RJ', 'RAJASTHAN', 'UK', 'UTTARAKHAND', 'HP', 'HIMACHAL PRADESH', 'AR', 'NL', 'MN', 'MZ', 'JK', 'GA', 'GOA') then
    return 0;
  end if;
  return null;    -- state not configured: HR adds PT as a deduction
end $$;

create or replace function app.pt_for(p_person uuid, p_month date, p_gross numeric) returns numeric
language sql stable security definer set search_path = public, app, pg_temp as $$
  select coalesce(app.pt_monthly(coalesce(h.pt_state, app.setting('pt_default_state') #>> '{}', 'MH'), p_gross, h.gender, extract(month from p_month)::int), 0)
    from public.persons p left join public.hr_profiles h on h.person_id = p.id where p.id = p_person
$$;

-- ------------------------------------------------------------------ D-93 the calculator
create or replace function app.salary_lines(p_gross numeric, p_pf boolean, p_gender text, p_state text, p_month date) returns jsonb
language plpgsql stable security definer set search_path = public, app, pg_temp as $$
declare g numeric := round(greatest(coalesce(p_gross, 0), 0)); b numeric; hra numeric; sp numeric; pfw numeric; pfe numeric; pfr numeric; pfa numeric;
        esie numeric := 0; esir numeric := 0; pt numeric; cap numeric := coalesce((app.setting('payroll_pf_wage_cap') #>> '{}')::numeric, 25000);
        esil numeric := coalesce((app.setting('payroll_esi_wage_limit') #>> '{}')::numeric, 21000);
begin
  b := round(g * coalesce((app.setting('payroll_basic_pct') #>> '{}')::numeric, 50) / 100);
  hra := round(b * coalesce((app.setting('payroll_hra_pct') #>> '{}')::numeric, 40) / 100);
  sp := g - b - hra;
  pfw := case when p_pf then least(b, case when cap > 0 then cap else b end) else 0 end;
  pfe := round(pfw * coalesce((app.setting('payroll_pf_rate') #>> '{}')::numeric, 12) / 100);
  pfr := round(pfw * coalesce((app.setting('payroll_employer_pf_rate') #>> '{}')::numeric, 12) / 100);
  pfa := round(pfw * coalesce((app.setting('payroll_pf_admin_rate') #>> '{}')::numeric, 0) / 100);
  if g > 0 and g <= esil then
    esie := ceil(g * coalesce((app.setting('payroll_esi_employee_rate') #>> '{}')::numeric, 0.75) / 100);
    esir := ceil(g * coalesce((app.setting('payroll_esi_employer_rate') #>> '{}')::numeric, 3.25) / 100);
  end if;
  pt := app.pt_monthly(coalesce(p_state, app.setting('pt_default_state') #>> '{}', 'MH'), g, p_gender, extract(month from coalesce(p_month, app.today()))::int);
  return jsonb_build_object('gross', g, 'basic', b, 'hra', hra, 'special', sp, 'pf_wage', pfw, 'pf_employee', pfe, 'pf_employer', pfr, 'pf_admin', pfa,
    'esi_employee', esie, 'esi_employer', esir, 'pt', coalesce(pt, 0), 'pt_known', pt is not null,
    'in_hand', g - pfe - pfr - pfa - esie - esir - coalesce(pt, 0), 'pf_cap', cap, 'esi_limit', esil);
end $$;

/** p: { mode: 'ctc' | 'inhand', amount, pf, plb, plb_pct, gender?, pt_state?, month? } → full break-up. */
create or replace function app.salary_calc(p jsonb) returns jsonb
language plpgsql stable security definer set search_path = public, app, pg_temp as $$
declare v_mode text := coalesce(p->>'mode', 'ctc'); v_amt numeric := coalesce((p->>'amount')::numeric, 0);
        v_pf boolean := coalesce((p->>'pf')::boolean, true); v_plb boolean := coalesce((p->>'plb')::boolean, false);
        v_pct numeric := case when coalesce((p->>'plb')::boolean, false) then coalesce((p->>'plb_pct')::numeric, (app.setting('plb_default_pct') #>> '{}')::numeric, 20) else 0 end;
        v_month date := coalesce(nullif(p->>'month', '')::date, app.today()); v_state text := coalesce(nullif(p->>'pt_state', ''), app.setting('pt_default_state') #>> '{}', 'MH');
        v_g numeric; lo numeric; hi numeric; mid numeric; l jsonb; i int; v_notes text[] := '{}'; v_pf_forced boolean := false;
begin
  if v_amt <= 0 then raise exception 'Enter the amount.' using errcode = '22023'; end if;
  if v_pct < 0 or v_pct >= 100 then raise exception 'PLB %% must be between 0 and 99.' using errcode = '22023'; end if;
  if v_mode = 'ctc' then
    v_g := round(v_amt * (1 - v_pct / 100) / 12);
  elsif v_mode = 'inhand' then        -- find the monthly gross whose in-hand is the amount entered
    lo := v_amt; hi := v_amt * 2 + 5000;
    for i in 1 .. 40 loop
      mid := (lo + hi) / 2;
      if (app.salary_lines(mid, v_pf, p->>'gender', v_state, v_month)->>'in_hand')::numeric >= v_amt then hi := mid; else lo := mid; end if;
    end loop;
    v_g := ceil(hi);
  else raise exception 'Choose annual CTC or monthly in-hand.' using errcode = '22023'; end if;
  l := app.salary_lines(v_g, v_pf, p->>'gender', v_state, v_month);
  -- PF can be left out only where the PF wage would be above the ceiling (an "excluded employee"); otherwise it is compulsory
  if not v_pf and (l->>'basic')::numeric <= (l->>'pf_cap')::numeric then
    v_pf_forced := true; v_pf := true;
    v_notes := array_append(v_notes, 'PF is compulsory when basic pay is ₹' || to_char((l->>'pf_cap')::numeric, 'FM99,99,999') || ' a month or less, so it has been included.');
    if v_mode = 'inhand' then return app.salary_calc(p || '{"pf": true}'::jsonb) || jsonb_build_object('pf_forced', true, 'notes', to_jsonb(v_notes)); end if;
    l := app.salary_lines(v_g, true, p->>'gender', v_state, v_month);
  end if;
  if not (l->>'pt_known')::boolean then v_notes := array_append(v_notes, 'Professional tax for state ' || v_state || ' is not set up; HR adds it as a deduction.'); end if;
  if v_plb then v_notes := array_append(v_notes, 'PLB is part of CTC and is paid on performance (not in the monthly salary).'); end if;
  return l || jsonb_build_object('mode', v_mode, 'amount', v_amt, 'pf', v_pf, 'pf_forced', v_pf_forced, 'plb', v_plb, 'plb_pct', v_pct,
    'fixed_annual', v_g * 12, 'plb_annual', round(v_g * 12 * v_pct / nullif(100 - v_pct, 0)),
    'ctc_annual', v_g * 12 + round(v_g * 12 * v_pct / nullif(100 - v_pct, 0)),
    'in_hand_annual', (l->>'in_hand')::numeric * 12, 'pt_state', v_state, 'notes', to_jsonb(v_notes),
    'pf_optout_allowed', (l->>'basic')::numeric > (l->>'pf_cap')::numeric);
end $$;

create or replace function public.salary_preview(p jsonb) returns jsonb
language plpgsql stable security definer set search_path = public, app, pg_temp as $$
declare v_me uuid := app.me(); v_for uuid := coalesce(nullif(p->>'person_id', '')::uuid, app.me());
begin
  if v_me is null then raise exception 'Not signed in' using errcode = '28000'; end if;
  if v_for <> v_me and not (app.is_admin() or app.has_role('hr_admin')) then v_for := v_me; end if;
  return app.salary_calc(p || coalesce((select jsonb_strip_nulls(jsonb_build_object('gender', h.gender, 'pt_state', h.pt_state)) from public.hr_profiles h where h.person_id = v_for), '{}'));
end $$;

-- ------------------------------------------------------------------ D-92 declarations
create table if not exists public.salary_declarations (
  id uuid primary key default gen_random_uuid(),
  person_id uuid not null references public.persons(id),
  mode text not null check (mode in ('ctc', 'inhand')), amount numeric not null check (amount > 0),
  pf_opted boolean not null, plb_opted boolean not null, plb_pct numeric not null default 0,
  effective_from date not null, calc jsonb not null,
  status text not null default 'proposed' check (status in ('proposed', 'approved', 'rejected', 'withdrawn')),
  created_at timestamptz not null default now(), decided_by uuid references public.persons(id), decided_at timestamptz, note text
);
create index if not exists salary_declarations_person on public.salary_declarations(person_id, created_at desc);
alter table public.salary_declarations enable row level security;
revoke all on public.salary_declarations from anon, authenticated;     -- read through the functions below only

create or replace function public.declare_salary(p jsonb) returns jsonb
language plpgsql security definer set search_path = public, app, pg_temp as $$
declare v_me uuid := app.me(); v_calc jsonb; v_from date := coalesce(nullif(p->>'effective_from', '')::date, date_trunc('month', app.today())::date); v_id uuid;
begin
  if v_me is null then raise exception 'Not signed in' using errcode = '28000'; end if;
  if not coalesce((app.setting('salary_self_service') #>> '{}')::boolean, false) then
    raise exception 'Salary self-declaration is switched off. HR enters salaries.' using errcode = 'P0001'; end if;
  if app.pay_group(v_me) is null then raise exception 'Business Associates are paid by monthly claim, not salary.' using errcode = 'P0001'; end if;
  v_from := date_trunc('month', v_from)::date;
  v_calc := public.salary_preview(p - 'person_id' || jsonb_build_object('month', v_from));
  perform set_config('app.reason', 'salary declared by self', true);
  update public.salary_declarations set status = 'withdrawn', decided_at = now(), note = 'replaced by a newer declaration'
   where person_id = v_me and status = 'proposed';
  insert into public.salary_declarations(person_id, mode, amount, pf_opted, plb_opted, plb_pct, effective_from, calc)
  values (v_me, v_calc->>'mode', (v_calc->>'amount')::numeric, (v_calc->>'pf')::boolean, (v_calc->>'plb')::boolean, (v_calc->>'plb_pct')::numeric, v_from, v_calc)
  returning id into v_id;
  insert into public.notifications(person_id, kind, message, link)
  select ra.person_id, 'payroll', (select full_name from public.persons where id = v_me) || ' declared their salary (CTC ₹'
         || to_char((v_calc->>'ctc_annual')::numeric, 'FM99,99,99,999') || ' a year) — please approve.', '/payroll?t=declarations'
    from public.role_assignments ra where ra.role in ('hr_admin') and ra.valid @> app.today();
  return jsonb_build_object('id', v_id, 'calc', v_calc);
end $$;

create or replace function public.my_salary() returns jsonb
language plpgsql stable security definer set search_path = public, app, pg_temp as $$
declare v_me uuid := app.me();
begin
  if v_me is null then raise exception 'Not signed in' using errcode = '28000'; end if;
  return jsonb_build_object(
    'self_service', coalesce((app.setting('salary_self_service') #>> '{}')::boolean, false),
    'eligible', app.pay_group(v_me) is not null,
    'plb_default_pct', coalesce((app.setting('plb_default_pct') #>> '{}')::numeric, 20),
    'current', (select jsonb_build_object('monthly_gross', c.monthly_gross, 'effective_from', c.effective_from) from public.hr_compensation c
                 where c.person_id = v_me order by c.effective_from desc, c.created_at desc limit 1),
    'pf_opted', (select coalesce(h.pf_opted, true) from public.hr_profiles h where h.person_id = v_me),
    'declarations', (select coalesce(jsonb_agg(to_jsonb(d) - 'person_id' order by d.created_at desc), '[]') from (select * from public.salary_declarations d
                       where d.person_id = v_me order by d.created_at desc limit 5) d));
end $$;

create or replace function public.salary_declarations_list(p_status text default 'proposed') returns table(id uuid, person_id uuid, full_name text, designation text,
  mode text, amount numeric, pf_opted boolean, plb_opted boolean, plb_pct numeric, effective_from date, calc jsonb, status text, created_at timestamptz,
  current_gross numeric, decided_by text, decided_at timestamptz, note text)
language plpgsql stable security definer set search_path = public, app, pg_temp as $$
begin
  if not (app.is_admin() or app.has_role('hr_admin')) then raise exception 'HR / Admin only.' using errcode = '42501'; end if;
  return query select d.id, d.person_id, p.full_name, p.designation, d.mode, d.amount, d.pf_opted, d.plb_opted, d.plb_pct, d.effective_from, d.calc, d.status, d.created_at,
    (select c.monthly_gross from public.hr_compensation c where c.person_id = d.person_id order by c.effective_from desc, c.created_at desc limit 1),
    (select x.full_name from public.persons x where x.id = d.decided_by), d.decided_at, d.note
    from public.salary_declarations d join public.persons p on p.id = d.person_id
   where p_status = 'all' or d.status = p_status order by d.created_at desc limit 300;
end $$;

create or replace function public.decide_salary_declaration(p_id uuid, p_approve boolean, p_note text default null) returns void
language plpgsql security definer set search_path = public, app, pg_temp as $$
declare d public.salary_declarations;
begin
  if not (app.is_admin() or app.has_role('hr_admin')) then raise exception 'HR / Admin only.' using errcode = '42501'; end if;
  select * into d from public.salary_declarations where id = p_id for update;
  if d.id is null or d.status <> 'proposed' then raise exception 'This declaration is not waiting for a decision.' using errcode = 'P0001'; end if;
  if not p_approve and coalesce(btrim(p_note), '') = '' then raise exception 'Give the reason for rejecting (the person is told).' using errcode = 'P0001'; end if;
  perform set_config('app.reason', 'salary declaration ' || case when p_approve then 'approved' else 'rejected' end, true);
  if p_approve then
    perform public.set_compensation(d.person_id, (d.calc->>'gross')::numeric, d.effective_from,
      case when exists (select 1 from public.hr_compensation c where c.person_id = d.person_id) then 'revision' else 'joining' end,
      'Self-declared (' || case d.mode when 'ctc' then 'CTC ₹' || to_char(d.amount, 'FM99,99,99,999') || ' a year' else 'in-hand ₹' || to_char(d.amount, 'FM99,99,999') || ' a month' end
      || case when d.plb_opted then ', PLB ' || d.plb_pct || '%' else '' end || '), approved' || coalesce(': ' || nullif(btrim(p_note), ''), ''));
    insert into public.hr_profiles(person_id) values (d.person_id) on conflict (person_id) do nothing;
    update public.hr_profiles set pf_applicable = true, pf_opted = d.pf_opted, plb_opted = d.plb_opted, plb_pct = d.plb_pct, updated_at = now() where person_id = d.person_id;
  end if;
  update public.salary_declarations set status = case when p_approve then 'approved' else 'rejected' end, decided_by = app.me(), decided_at = now(), note = nullif(btrim(coalesce(p_note, '')), '')
   where id = p_id;
  insert into public.notifications(person_id, kind, message, link)
  values (d.person_id, 'salary', 'Your salary declaration was ' || case when p_approve then 'approved' else 'not approved: ' || btrim(p_note) end || '.', '/profile');
end $$;

-- ------------------------------------------------------------------ payroll: professional tax deducted
do $mig$
declare v text; o text;
begin
  v := pg_get_functiondef('app.payroll_compute(date,uuid)'::regprocedure); o := v;
  v := replace(v, 'update public.payroll_lines set net_pay = earned_gross + incentives + arrears - pf_employee - pf_employer - pf_admin - esi_employee - esi_employer - other_deductions',
    'update public.payroll_lines set pt = app.pt_for(p_person, p_month, earned_gross) where month = p_month and person_id = p_person;
  update public.payroll_lines set net_pay = earned_gross + incentives + arrears - pf_employee - pf_employer - pf_admin - esi_employee - esi_employer - pt - other_deductions');
  if v = o then raise exception 'salary_self_service: payroll_compute anchor not found'; end if;
  execute v;
end $mig$;

-- payroll sheet with professional tax
drop function if exists public.payroll_sheet(date);
create function public.payroll_sheet(p_month date)
returns table(person_id uuid, full_name text, designation text, manager text, location text, status text, payroll text, branch_type text, gross numeric, days_in_month int, day_rate numeric,
              present_days numeric, paid_leave_days numeric, off_days numeric, unpaid_days numeric, not_employed_days int, unpaid_override numeric, override_reason text,
              attendance_deduction numeric, earned_gross numeric, basic numeric, pf_applicable boolean, pf_employee numeric, pf_employer numeric, pf_admin numeric,
              esi_employee numeric, esi_employer numeric, incentives numeric, arrears numeric,
              other_deductions numeric, net_pay numeric, flags text[], pending_adjustments int, bank text, ifsc text, account_last4 text, account_number text, pt numeric)
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
         case when app.is_admin() or app.has_role('hr_admin') then i.bank_account_number end,
         l.pt
    from public.payroll_lines l join public.persons p on p.id = l.person_id left join public.hr_profiles h on h.person_id = p.id
    left join public.hr_identity i on i.person_id = p.id
   where l.month = date_trunc('month', p_month)::date and app.can_see_pay(l.person_id, l.month) and not ('not on payroll' = any(l.flags))
   order by l.payroll, l.branch_type, p.full_name
$$;

-- ------------------------------------------------------------------ D-96 how the app is used
create table if not exists public.client_seen (
  person_id uuid primary key references public.persons(id), last_seen timestamptz not null default now(),
  last_standalone timestamptz, last_browser timestamptz, push_on boolean, user_agent text
);
alter table public.client_seen enable row level security;
revoke all on public.client_seen from anon, authenticated;

create or replace function public.report_client(p_standalone boolean, p_push boolean, p_user_agent text default null) returns void
language plpgsql security definer set search_path = public, app, pg_temp as $$
declare v_me uuid := app.me();
begin
  if v_me is null then return; end if;
  insert into public.client_seen as c (person_id, last_seen, last_standalone, last_browser, push_on, user_agent)
  values (v_me, now(), case when p_standalone then now() end, case when not p_standalone then now() end, p_push, left(p_user_agent, 200))
  on conflict (person_id) do update set last_seen = now(), last_standalone = coalesce(case when p_standalone then now() end, c.last_standalone),
    last_browser = coalesce(case when not p_standalone then now() end, c.last_browser), push_on = coalesce(p_push, c.push_on), user_agent = coalesce(left(p_user_agent, 200), c.user_agent);
end $$;

-- ------------------------------------------------------------------ D-95 reminders
create or replace function app.people_reminders(p_force boolean default false) returns integer
language plpgsql security definer set search_path = public, app, pg_temp as $$
declare v_h int := extract(hour from app.clock() at time zone app.tz())::int; v_d date := app.today(); n int := 0; k int;
        v_self boolean := coalesce((app.setting('salary_self_service') #>> '{}')::boolean, false); v_tag text;
begin
  if p_force or v_h in (10, 12, 14, 16, 18) then
    v_tag := '/profile?r=' || v_d || '-' || case when p_force then 'now' else v_h::text end;
    with ppl as (
      select p.id, app.profile_progress(p.id) pr,
             v_self and app.pay_group(p.id) is not null
               and not exists (select 1 from public.hr_compensation c where c.person_id = p.id)
               and not exists (select 1 from public.salary_declarations d where d.person_id = p.id and d.status in ('proposed', 'approved')) no_salary
        from public.persons p where p.status = 'active' and p.auth_user_id is not null)
    insert into public.notifications(person_id, kind, message, link)
    select x.id, 'profile',
           case when (x.pr->>'pct')::int < 100 then 'Your profile is ' || (x.pr->>'pct') || '% complete. Still needed: ' || left(array_to_string(array(select jsonb_array_elements_text(x.pr->'missing')), ', '), 160)
                || case when (x.pr->>'blocking')::boolean then '. The app is locked until it is complete.' else '. Complete it by ' || to_char(((x.pr->>'due_at')::timestamptz) at time zone app.tz(), 'DD Mon HH12:MI AM') || '.' end
                else '' end
           || case when x.no_salary then case when (x.pr->>'pct')::int < 100 then ' Also declare your salary (CTC or in-hand) in My profile.' else 'Declare your salary (CTC or in-hand) in My profile — HR approves it.' end else '' end,
           v_tag
      from ppl x
     where ((x.pr->>'pct')::int < 100 or x.no_salary)
       and not exists (select 1 from public.notifications z where z.person_id = x.id and z.kind = 'profile' and z.link = v_tag);
    get diagnostics k = row_count; n := n + k;
  end if;
  if v_h in (11, 17) then
    v_tag := '/notifications?install=' || v_d || '-' || v_h;
    insert into public.notifications(person_id, kind, message, link)
    select c.person_id, 'install', 'You are using CRUX in the browser. Install the app on your phone for quicker opening and reminders: open My alerts → Install the app.', v_tag
      from public.client_seen c join public.persons p on p.id = c.person_id and p.status = 'active'
     where c.last_seen > now() - interval '7 days' and c.last_standalone is null
       and not exists (select 1 from public.notifications z where z.person_id = c.person_id and z.kind = 'install' and z.link = v_tag);
    get diagnostics k = row_count; n := n + k;
  end if;
  return n;
end $$;

do $mig$
declare v text; o text;
begin
  v := pg_get_functiondef('app.sync_all()'::regprocedure); o := v;
  v := replace(v, 'perform app.reminders();', 'perform app.reminders();
  perform app.people_reminders();');
  if v = o then raise exception 'salary_self_service: sync_all anchor not found'; end if;
  execute v;
end $mig$;

revoke execute on function public.salary_preview(jsonb), public.declare_salary(jsonb), public.my_salary(), public.salary_declarations_list(text),
  public.decide_salary_declaration(uuid, boolean, text), public.report_client(boolean, boolean, text), public.payroll_sheet(date) from public, anon;
grant execute on function public.salary_preview(jsonb), public.declare_salary(jsonb), public.my_salary(), public.salary_declarations_list(text),
  public.decide_salary_declaration(uuid, boolean, text), public.report_client(boolean, boolean, text), public.payroll_sheet(date) to authenticated;
revoke execute on function app.pt_monthly(text, numeric, text, int), app.pt_for(uuid, date, numeric), app.salary_lines(numeric, boolean, text, text, date),
  app.salary_calc(jsonb), app.people_reminders(boolean) from public, anon, authenticated;
