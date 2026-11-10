-- 10 Nov audit fixes (D-81 .. D-85).
-- D-81 Auto-attendance: a day with figures saved (draft) counts as present; people who do not report daily figures
--      (HR, Admin, auditors, BI …) are present by default; days before go-live are 'not_tracked'; holidays show as holiday.
-- D-82 Payroll deducts pay only for attendance a manager/HR has recorded. An automatic "absent" that nobody confirmed is
--      paid and flagged, never deducted (no deduction without a confirmed record).
-- D-83 Payroll: sending for review refreshes the sheet first (new joiners appear); approval is blocked while anyone on
--      CRUX payroll has no salary entered (prevents ₹0 statements).
-- D-84 The old set_salary RPC now goes through set_compensation (approved-month lock, reason, kind). Business
--      Associates (claim model) cannot be given a salary.
-- D-85 Reminder wording when figures are saved but not submitted; hygiene (fixed search_path, helper grants).

create or replace function app.auto_attendance(p_person uuid, p_date date) returns text
language sql stable security definer set search_path = public, app, pg_temp as $$
  select case
    when not app.is_working_day(p_date) then
      case when exists (select 1 from public.day_status d where d.person_id = p_person and d.work_date = p_date and d.status in ('submitted','manager_entered'))
             then 'sunday_work'
           when extract(dow from p_date)::int in (select jsonb_array_elements_text(app.setting('weekly_off_dow'))::int) then 'weekly_off'
           else 'holiday' end
    when exists (select 1 from public.day_status d where d.person_id = p_person and d.work_date = p_date
                  and d.status in ('submitted','manager_entered','non_operational'))
      or exists (select 1 from public.certifications c where c.manager_id = p_person and c.work_date = p_date)
      or exists (select 1 from public.day_status d where d.person_id = p_person and d.work_date = p_date and d.status = 'draft'
                  and exists (select 1 from public.productivity_lines l where l.person_id = p_person and l.work_date = p_date)) then 'present'
    when exists (select 1 from public.day_status d where d.person_id = p_person and d.work_date = p_date and d.status = 'on_leave') then 'unplanned_leave'
    when exists (select 1 from public.day_status d where d.person_id = p_person and d.work_date = p_date and d.status = 'absent') then 'absent'
    when p_date < coalesce((app.setting('go_live_date') #>> '{}')::date, p_date) then 'not_tracked'
    when not app.reports_figures(p_person, p_date) then 'present'
    when app.window_state(p_date) in ('open','grace','future') then 'pending'
    else 'absent' end
$$;

create or replace function public.confirm_team_day(p_date date) returns integer
language plpgsql security definer set search_path = public, app, pg_temp as $$
declare r record; n int := 0;
begin
  for r in select t.person_id, t.auto from public.team_attendance_month(p_date) t
            where t.work_date = p_date and not t.final and t.auto not in ('pending','not_tracked') loop
    perform public.set_attendance(r.person_id, p_date, r.auto, 'Confirmed as reported');
    n := n + 1;
  end loop;
  return n;
end $$;

create or replace function public.set_salary(p_person uuid, p_monthly_gross numeric, p_effective_from date, p_note text default null)
returns public.hr_compensation language plpgsql security definer set search_path = public, app, pg_temp as $$
declare v_c public.hr_compensation;
begin
  perform public.set_compensation(p_person, p_monthly_gross, p_effective_from,
    case when exists (select 1 from public.hr_compensation c where c.person_id = p_person) then 'revision' else 'joining' end,
    coalesce(nullif(trim(p_note), ''), 'Salary entered'));
  select * into v_c from public.hr_compensation c where c.person_id = p_person order by c.created_at desc limit 1;
  return v_c;
end $$;

do $mig$
declare v text; o text; missing text := '';
begin
  -- D-82: only recorded attendance deducts pay
  v := pg_get_functiondef('app.payroll_compute(date,uuid)'::regprocedure); o := v;
  v := replace(v, 'v_bt text;', 'v_bt text; v_unconf int := 0;');
  v := replace(v, 's := coalesce((select a.status from public.attendance a where a.person_id = p_person and a.work_date = d), app.auto_attendance(p_person, d));',
    's := (select a.status from public.attendance a where a.person_id = p_person and a.work_date = d);
    if s is null then
      s := app.auto_attendance(p_person, d);
      if s = ''half_day'' or s = any(v_unpaid_set) then v_unconf := v_unconf + 1; s := ''unconfirmed''; end if;
    end if;');
  v := replace(v, 'v_div := case v_basis',
    'if v_unconf > 0 then v_flags := array_append(v_flags, v_unconf || '' auto-absent day(s) not confirmed — not deducted''); end if;
  v_div := case v_basis');
  if v = o or position('v_unconf' in v) = 0 or position('not confirmed' in v) = 0 or position('s := ''unconfirmed''' in v) = 0 then missing := missing || ' payroll_compute'; end if;
  execute v;

  -- D-83: review refreshes; approval needs salaries for everyone on CRUX payroll
  v := pg_get_functiondef('public.payroll_set_status(date,text,text)'::regprocedure); o := v;
  v := replace(v, 'if v_r.status <> ''draft'' then raise exception ''Only a draft can be sent for review.'' using errcode = ''P0001''; end if;',
    'if v_r.status <> ''draft'' then raise exception ''Only a draft can be sent for review.'' using errcode = ''P0001''; end if;
    perform public.payroll_prepare(v_m);');
  v := replace(v, 'perform public.payroll_prepare(v_m);
    update public.payroll_runs set status = ''approved''',
    'perform public.payroll_prepare(v_m);
    select count(*) into n from public.payroll_lines l where l.month = v_m and l.payroll = ''crux'' and ''no salary'' = any(l.flags);
    if n > 0 then raise exception ''% person(s) on CRUX payroll have no salary entered. Enter their salary (HR → Employment) before approving.'', n using errcode = ''P0001''; end if;
    update public.payroll_runs set status = ''approved''');
  if v = o or position('no salary entered' in v) = 0 or (length(v) - length(replace(v, 'perform public.payroll_prepare(v_m);', ''))) / length('perform public.payroll_prepare(v_m);') <> 2 then missing := missing || ' payroll_set_status'; end if;
  execute v;

  -- D-84: no salary for Business Associates (claim model)
  v := pg_get_functiondef('public.set_compensation(uuid,numeric,date,text,text)'::regprocedure); o := v;
  v := replace(v, 'if coalesce(p_gross, 0) <= 0 then',
    'if app.pay_group(p_person) is null then raise exception ''Business Associates are paid by monthly claim, not salary.'' using errcode = ''P0001''; end if;
  if coalesce(p_gross, 0) <= 0 then');
  if v = o then missing := missing || ' set_compensation'; end if;
  execute v;

  -- D-85: say clearly when figures are saved but not submitted
  v := pg_get_functiondef('app.reminders()'::regprocedure); o := v;
  v := replace(v, 'select d.person_id, ''deadline'', ''Today''''s figures are not submitted yet — the day closes at 11:59 PM.'',',
    'select d.person_id, ''deadline'',
           case when exists (select 1 from public.day_status s where s.person_id = d.person_id and s.work_date = v_d and s.function = ''operations'' and s.status = ''draft'')
                then ''Your figures are saved as a draft but NOT submitted. Fill every box (including Pending by age), then tap Review and submit — the day closes at 11:59 PM.''
                else ''Today''''s figures are not submitted yet — the day closes at 11:59 PM.'' end,');
  if v = o then missing := missing || ' reminders'; end if;
  execute v;

  -- days before go-live are neither attended nor missed on the board
  v := pg_get_functiondef('public.attendance_board(date,date,uuid)'::regprocedure); o := v;
  v := replace(v, 'count(*) filter (where w.st = ''pending'')::int pe,', 'count(*) filter (where w.st in (''pending'',''not_tracked''))::int pe,');
  v := replace(v, 'w.st not in (''pending'',''weekly_off''))::int uc', 'w.st not in (''pending'',''weekly_off'',''not_tracked''))::int uc');
  v := replace(v, 'when t.st = ''pending'' then ''Auto: no report yet (window open)''',
    'when t.st = ''pending'' then ''Auto: no report yet (window open)''
              when t.st = ''not_tracked'' then ''Before go-live: not tracked''');
  if v = o or position('not_tracked' in v) = 0 then missing := missing || ' attendance_board'; end if;
  execute v;

  if missing <> '' then raise exception 'audit_fixes: anchors not found:%', missing; end if;
end $mig$;

-- hygiene
alter function app.clamp_logged() set search_path = public, app, pg_temp;
alter function app.no_ticks_for_non_reporters() set search_path = public, app, pg_temp;
alter function app.task_sensitive(text) set search_path = public, app, pg_temp;
alter function app.tidy_names() set search_path = public, app, pg_temp;
alter function app.nice_name(text, text) set search_path = public, app, pg_temp;
revoke execute on function app.direct_mgr(uuid), app.is_ba_of(uuid), app.pay_group(uuid), app.reports_figures(uuid, date) from public, anon;
grant execute on function app.direct_mgr(uuid), app.is_ba_of(uuid), app.pay_group(uuid), app.reports_figures(uuid, date) to authenticated;
