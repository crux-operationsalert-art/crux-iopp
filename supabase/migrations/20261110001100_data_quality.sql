-- D-104 Data correctness: find details that are missing, malformed or not believable, tell each person exactly what to
--  fix, and give Admin / HR a data-quality view to drive every record to correct. Covers HR / identity data (the part that
--  was typed by hand and never checked) and reports operational gaps. Nothing here invents or guesses a value — it only
--  flags what is wrong and asks the right person to correct it.

/** Everything wrong with one person's HR / identity record, as a list of {code, label, detail, severity}. */
create or replace function app.data_issues(p_person uuid) returns jsonb
language sql stable security definer set search_path = public, app, pg_temp as $$
  with x as (
    select p.full_name, p.mobile, p.personal_email, p.resource_type,
           h.date_of_birth, h.pincode, h.emergency_name, h.emergency_relation, h.emergency_phone,
           h.current_address, h.permanent_address, h.city, h.state, h.highest_qualification, h.joining_date,
           i.aadhaar_number, i.pan_number, i.bank_account_number, i.bank_ifsc, i.bank_name
      from public.persons p left join public.hr_profiles h on h.person_id = p.id left join public.hr_identity i on i.person_id = p.id
     where p.id = p_person),
  checks(code, label, detail, severity, bad) as (
    select v.code, v.label, v.detail, v.severity, v.bad from x, lateral (values
      ('aadhaar', 'Aadhaar number', 'Scan your Aadhaar card so the number can be read.', 'high',
        x.aadhaar_number is null or x.aadhaar_number !~ '^[2-9][0-9]{11}$' or not app.verhoeff_ok(x.aadhaar_number)),
      ('pan', 'PAN number', 'Scan your PAN card; the number must be 5 letters, 4 digits, 1 letter.', 'high',
        x.pan_number is null or x.pan_number !~ '^[A-Z]{5}[0-9]{4}[A-Z]$'),
      ('bank_account', 'Bank account number', 'Add a cancelled cheque or passbook; the account number is 9 to 18 digits.', 'high',
        x.bank_account_number is null or x.bank_account_number !~ '^[0-9]{9,18}$'),
      ('bank_ifsc', 'IFSC code', 'The IFSC must be 11 characters: 4 letters, 0, then 6 letters or digits.', 'high',
        x.bank_ifsc is null or x.bank_ifsc !~ '^[A-Z]{4}0[A-Z0-9]{6}$'),
      ('bank_name', 'Bank name', 'This is not a recognised bank in India — correct the IFSC or pick your bank from the list.', 'high',
        x.bank_ifsc is not null and x.bank_ifsc ~ '^[A-Z]{4}0[A-Z0-9]{6}$'
          and app.bank_for_ifsc(x.bank_ifsc) is null and not app.is_known_bank(x.bank_name)),
      ('dob', 'Date of birth', 'Add your date of birth.', 'medium',
        x.date_of_birth is null or x.date_of_birth > current_date - interval '15 years' or x.date_of_birth < current_date - interval '75 years'),
      ('mobile', 'Mobile number', 'An Indian mobile number is 10 digits starting 6, 7, 8 or 9.', 'medium',
        x.mobile is null or regexp_replace(x.mobile, '^\+?91', '') !~ '^[6-9][0-9]{9}$'),
      ('email', 'Email', 'Add a working email address.', 'low', coalesce(x.personal_email, '') = ''),
      ('pincode', 'PIN code', 'A PIN code is 6 digits.', 'low', x.pincode is null or x.pincode::text !~ '^[1-9][0-9]{5}$'),
      ('emergency', 'Emergency contact', 'Add an emergency contact — name, relation and a 10-digit mobile.', 'medium',
        coalesce(x.emergency_name, '') = '' or coalesce(x.emergency_relation, '') = '' or x.emergency_phone is null or x.emergency_phone::text !~ '^[6-9][0-9]{9}$'),
      ('emergency_self', 'Emergency contact', 'Your emergency contact number is your own number — give someone else to reach.', 'medium',
        x.emergency_phone is not null and x.mobile is not null and regexp_replace(x.emergency_phone::text, '^\+?91', '') = regexp_replace(x.mobile, '^\+?91', '')),
      ('address', 'Address', 'Add your current and permanent address, city and state.', 'low',
        coalesce(x.current_address, '') = '' or coalesce(x.permanent_address, '') = '' or coalesce(x.city, '') = '' or coalesce(x.state, '') = ''),
      ('qualification', 'Qualification', 'Add your highest qualification and upload the certificate.', 'low',
        coalesce(x.highest_qualification, '') = '' or not exists (select 1 from public.person_documents d where d.person_id = p_person and d.doc_type = 'qualification' and not d.rejected)),
      ('joining', 'Joining date', 'Add your joining / association date.', 'low', x.joining_date is null or x.joining_date > current_date)
    ) v(code, label, detail, severity, bad))
  select coalesce(jsonb_agg(jsonb_build_object('code', code, 'label', label, 'detail', detail, 'severity', severity)
                   order by case severity when 'high' then 0 when 'medium' then 1 else 2 end), '[]')
    from checks where bad
$$;
revoke all on function app.data_issues(uuid) from public, anon, authenticated;

/** My own details that need correcting (shown to the person with a Fix button). */
create or replace function public.my_data_issues() returns jsonb
language sql stable security definer set search_path = public, app, pg_temp as $$ select app.data_issues(app.me()) $$;

/** HR / Admin: everyone with details to correct, worst first, plus a breakdown by problem. */
create or replace function public.data_quality() returns jsonb
language plpgsql stable security definer set search_path = public, app, pg_temp as $$
declare v_people jsonb; v_by jsonb;
begin
  if not (app.is_admin() or app.has_role('hr_admin')) then raise exception 'Only HR and Admin can see data quality.' using errcode = '42501'; end if;
  with p as (select pr.id, pr.full_name, pr.designation, pr.resource_type, pr.status, app.data_issues(pr.id) issues
               from public.persons pr where pr.status in ('active', 'invited')),
  f as (select id, full_name, designation, resource_type, status, issues, jsonb_array_length(issues) n,
               (select count(*) from jsonb_array_elements(issues) e where e->>'severity' = 'high') high from p)
  select jsonb_agg(jsonb_build_object('person_id', id, 'full_name', full_name, 'designation', designation, 'resource_type', resource_type,
                     'status', status, 'issues', issues, 'n', n, 'high', high) order by high desc, n desc, full_name)
    into v_people from f where n > 0;
  with e as (select el->>'code' code, el->>'label' label, el->>'severity' severity
               from public.persons pr, lateral jsonb_array_elements(app.data_issues(pr.id)) el where pr.status in ('active', 'invited')),
  g as (select code, max(label) label, max(severity) severity, count(*) cnt from e group by code)
  select jsonb_agg(jsonb_build_object('code', code, 'label', label, 'severity', severity, 'count', cnt) order by cnt desc) into v_by from g;
  return jsonb_build_object('people', coalesce(v_people, '[]'), 'by_problem', coalesce(v_by, '[]'),
    'total_people', (select count(*) from public.persons where status in ('active', 'invited')),
    'clean', (select count(*) from public.persons pr where pr.status in ('active', 'invited') and jsonb_array_length(app.data_issues(pr.id)) = 0));
end $$;

/** Operational / collection gaps for a month that need a correction (read-only; managers and above). */
create or replace function public.ops_anomalies(p_month date default null) returns jsonb
language plpgsql stable security definer set search_path = public, app, pg_temp as $$
declare v_m date := coalesce(date_trunc('month', p_month)::date, date_trunc('month', app.today())::date); v_rows jsonb;
begin
  if not (app.is_admin() or app.has_role('hr_admin') or app.has_role('ops_head') or app.has_role('collections_head') or app.has_role('leadership') or app.has_reports(app.me(), 'operations', app.today())) then
    raise exception 'Only managers and above see data gaps.' using errcode = '42501'; end if;
  with scope as (
    select p.id, p.full_name from public.persons p where p.status = 'active'
       and (app.is_admin() or app.has_role('hr_admin') or app.has_role('ops_head') or app.has_role('leadership')
            or exists (select 1 from app.subtree(app.me(), 'operations', app.today()) s where s.person_id = p.id))),
  -- working days this month up to today that a person was allocated operations but did not report and is not on leave
  miss as (
    select s.id, s.full_name, g::date d
      from scope s
      join generate_series(v_m, least(app.today(), (v_m + interval '1 month - 1 day')::date), interval '1 day') g on true
     where app.is_working_day(g::date)
       and exists (select 1 from public.allocations a where a.person_id = s.id and a.function = 'operations' and a.valid @> g::date)
       and app.day_result(s.id, g::date) = 'miss'),
  -- lines submitted with a "does not tally" note (the person already explained, but Admin may want to check)
  untallied as (
    select l.person_id, p.full_name, l.work_date d, l.tat_note
      from public.productivity_lines l join public.persons p on p.id = l.person_id
     where l.work_date >= v_m and l.work_date <= app.today() and coalesce(btrim(l.tat_note), '') <> ''
       and (app.is_admin() or app.has_role('hr_admin') or app.has_role('ops_head') or app.has_role('leadership')
            or exists (select 1 from app.subtree(app.me(), 'operations', app.today()) s where s.person_id = l.person_id)))
  select jsonb_build_object(
    'month', v_m,
    'not_reported', (select coalesce(jsonb_agg(jsonb_build_object('person_id', id, 'full_name', full_name, 'date', d) order by d desc, full_name), '[]') from miss),
    'not_reported_count', (select count(*) from miss),
    'untallied', (select coalesce(jsonb_agg(jsonb_build_object('person_id', person_id, 'full_name', full_name, 'date', d, 'note', tat_note) order by d desc), '[]') from untallied)
  ) into v_rows;
  return v_rows;
end $$;

revoke all on function public.my_data_issues(), public.data_quality(), public.ops_anomalies(date) from public, anon;
grant execute on function public.my_data_issues() to authenticated;
grant execute on function public.data_quality(), public.ops_anomalies(date) to authenticated;

-- ---- daily "please correct your details" reminders folded into the existing people reminders ----
-- The reminder sync already nudges people whose profile is below 100%. Add a nudge for people whose details are present but
-- wrong (e.g. an unrecognised bank), so "complete" is not the same as "correct".
create or replace function app.remind_data_corrections() returns int
language plpgsql security definer set search_path = public, app, pg_temp as $$
declare v_n int := 0; r record; v_tag text := '/profile?fix=' || app.today();
begin
  for r in select p.id, app.data_issues(p.id) issues from public.persons p where p.status = 'active' and p.auth_user_id is not null loop
    if jsonb_array_length(r.issues) > 0
       and not exists (select 1 from public.notifications n where n.person_id = r.id and n.kind = 'data_fix' and n.link = v_tag) then
      insert into public.notifications(person_id, kind, message, link)
      values (r.id, 'data_fix', 'Some of your details need correcting: ' ||
              (select string_agg(distinct e->>'label', ', ') from jsonb_array_elements(r.issues) e) || '. Please fix them in your profile.', v_tag);
      v_n := v_n + 1;
    end if;
  end loop;
  return v_n;
end $$;
revoke all on function app.remind_data_corrections() from public, anon, authenticated;

-- fold the data-correction nudge into the people reminders (once a day per person, by the guard inside the function)
do $mig$
declare v text; o text;
begin
  v := pg_get_functiondef('app.people_reminders(boolean)'::regprocedure); o := v;
  v := replace(v, '  if v_h in (11, 17) then', '  if p_force or v_h in (10, 12, 14, 16, 18) then n := n + app.remind_data_corrections(); end if;
  if v_h in (11, 17) then');
  if v = o then raise exception 'data_quality: people_reminders anchor not found'; end if;
  execute v;
end $mig$;

-- expose each person's data issues on their profile (HR / the person see them; managers do not)
do $do$
declare f text := pg_get_functiondef('public.person_profile(uuid)'::regprocedure);
  a text := $a$    'progress', app.profile_progress(p_person));$a$;
  b text := $b$    'issues', case when v_full then app.data_issues(p_person) else '[]'::jsonb end,
    'progress', app.profile_progress(p_person));$b$;
begin
  if position(a in f) = 0 then raise exception 'person_profile progress anchor not found'; end if;
  execute replace(f, a, b);
end $do$;

/** HR / Admin: send the "please correct your details" nudge to everyone with an issue, now. */
create or replace function public.remind_corrections_now() returns int
language plpgsql security definer set search_path = public, app, pg_temp as $$
begin
  if not (app.is_admin() or app.has_role('hr_admin')) then raise exception 'Only HR and Admin.' using errcode = '42501'; end if;
  return app.remind_data_corrections();
end $$;
revoke all on function public.remind_corrections_now() from public, anon;
grant execute on function public.remind_corrections_now() to authenticated;
