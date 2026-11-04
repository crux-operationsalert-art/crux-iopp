-- D-60 (#1): the bottom-up chain, including absent managers.
--   • A manager cannot certify until every direct report has submitted, been entered on behalf, or been marked
--     absent / on leave / non-operational (unchanged), and every manager below has certified their team.
--   • Approved leave now counts as resolved automatically (no manual marking needed).
--   • If a middle manager M is absent, M's manager G marks M absent, then G can act for M: see M's team, enter or mark
--     M's people, and certify M's team "for M" (recorded as certified by G for M; M is told). This works through any
--     number of absent levels: a manager can act for anyone whose managers between them are all absent / on leave.

create or replace function app.is_away(p_person uuid, p_date date, p_fn app.fn) returns boolean
language sql stable security definer set search_path = public, app, pg_temp as $$
  select exists (select 1 from public.day_status d where d.person_id = p_person and d.work_date = p_date and d.function = p_fn
                  and d.status in ('absent','on_leave'))
      or exists (select 1 from public.attendance a where a.person_id = p_person and a.work_date = p_date
                  and a.status in ('planned_leave','unplanned_leave','absent'))
$$;

-- Can the signed-in person act for p_person on p_date: their direct manager, or above through absent managers only.
create or replace function app.acts_for(p_person uuid, p_date date, p_fn app.fn) returns boolean
language plpgsql stable security definer set search_path = public, app, pg_temp as $$
declare v_p uuid := p_person; v_m uuid; i int := 0;
begin
  if app.me() is null or p_person = app.me() then return false; end if;
  loop
    i := i + 1; exit when i > 12;
    select r.manager_id into v_m from public.reporting_lines r where r.person_id = v_p and r.function = p_fn and r.valid @> p_date limit 1;
    if v_m is null then return false; end if;
    if v_m = app.me() then return true; end if;
    if not app.is_away(v_m, p_date, p_fn) then return false; end if;
    v_p := v_m;
  end loop;
  return false;
end $$;
grant execute on function app.acts_for(uuid, date, app.fn), app.is_away(uuid, date, app.fn) to authenticated;
revoke all on function app.acts_for(uuid, date, app.fn), app.is_away(uuid, date, app.fn) from public, anon;

alter table public.certifications add column if not exists certified_by uuid references public.persons(id);

-- Entering for, submitting for and marking a person: direct manager, or a manager above when the managers in between are away.
do $do$
declare s text; f text; o text;
begin
  foreach s in array array['public.save_productivity(date,jsonb,uuid,text)', 'public.save_pending(date,jsonb,uuid,text)', 'public.submit_day(date,uuid,text)'] loop
    f := pg_get_functiondef(s::regprocedure); o := f;
    f := replace(f, 'app.is_direct_report(v_person, ''operations'', p_work_date)',
                    '(app.is_direct_report(v_person, ''operations'', p_work_date) or app.acts_for(v_person, p_work_date, ''operations''))');
    if f = o then raise exception 'acts_for anchor not found in %', s; end if;
    execute f;
  end loop;
  f := pg_get_functiondef('public.set_member_status(uuid,date,text,text,app.fn)'::regprocedure); o := f;
  f := replace(f, 'if not app.is_direct_report(p_person, p_function, p_work_date) then
    raise exception ''You can only set status for your direct reports.''',
                  'if not (app.is_direct_report(p_person, p_function, p_work_date) or app.acts_for(p_person, p_work_date, p_function)) then
    raise exception ''You can only set status for your direct reports (or, when their manager is away, for that manager''''s team).''');
  if f = o then raise exception 'set_member_status anchor not found'; end if;
  execute f;

  -- team_status: approved leave resolves; show it as on leave; works for any manager the caller may act for.
  f := pg_get_functiondef('public.team_status(date,app.fn,uuid)'::regprocedure); o := f;
  f := replace(f, 'if v_mgr is null or not app.can_view_person(v_mgr, p_work_date, p_function) then',
                  'if v_mgr is null or not (app.can_view_person(v_mgr, p_work_date, p_function) or app.acts_for(v_mgr, p_work_date, p_function)) then');
  f := replace(f, 'coalesce(d.status, case when p_function',
                  'coalesce(d.status, case when app.is_away(p.id, p_work_date, p_function) then ''on_leave'' when p_function');
  f := replace(f, '              when p_function = ''operations'' and not exists (select 1 from public.allocations a where a.person_id = p.id and a.function = ''operations'' and a.valid @> p_work_date) then true',
                  '              when p_function = ''operations'' and not exists (select 1 from public.allocations a where a.person_id = p.id and a.function = ''operations'' and a.valid @> p_work_date) then true
              when exists (select 1 from public.attendance a where a.person_id = p.id and a.work_date = p_work_date and a.status in (''planned_leave'',''unplanned_leave'')) then true');
  if f = o or position('app.acts_for(v_mgr' in f) = 0 or position('''planned_leave'',''unplanned_leave'')) then true' in f) = 0 then
    raise exception 'team_status anchors not found'; end if;
  execute f;
end $do$;

-- Certify an absent manager's team for them.
create or replace function public.certify_for(p_manager uuid, p_work_date date, p_function app.fn default 'operations',
                                              p_certified jsonb default null, p_reason text default null)
returns public.certifications language plpgsql security definer set search_path = public, app, pg_temp as $$
declare v_me uuid := app.me(); v_blockers text; v_team uuid[]; v_t jsonb; v_c public.certifications; v_diff text := ''; k text; v_name text;
begin
  if v_me is null then raise exception 'Not signed in' using errcode = '28000'; end if;
  select full_name into v_name from public.persons where id = p_manager;
  if not app.acts_for(p_manager, p_work_date, p_function) then
    raise exception 'You can certify for % only as their manager (or above, when the managers in between are away).', v_name using errcode = '42501';
  end if;
  if not app.is_away(p_manager, p_work_date, p_function) then
    raise exception 'Mark % absent or on leave for % first; then you can certify their team for them.', v_name, to_char(p_work_date, 'DD Mon') using errcode = 'P0001';
  end if;
  if not app.has_reports(p_manager, p_function, p_work_date) then raise exception '% has no team to certify.', v_name using errcode = 'P0001'; end if;
  perform app.require_writable(p_manager, p_work_date, p_function);
  if exists (select 1 from public.certifications c where c.manager_id = p_manager and c.work_date = p_work_date and c.function = p_function)
     and not app.active_reopen(p_manager, p_work_date, p_function) then
    raise exception '%''s team is already certified for %.', v_name, to_char(p_work_date, 'DD Mon') using errcode = 'P0001';
  end if;
  select string_agg(full_name || ' (' || case when is_manager then 'team not certified' else status end || ')', ', ') into v_blockers
    from public.team_status(p_work_date, p_function, p_manager) where not resolved;
  if v_blockers is not null then raise exception 'Cannot certify % yet. Waiting on: %', v_name, v_blockers using errcode = 'P0001'; end if;
  select array_agg(person_id) into v_team from app.subtree(p_manager, p_function, p_work_date);
  v_t := app.ops_totals(coalesce(v_team, '{}'), p_work_date);
  if p_certified is not null then
    foreach k in array array['entry','closure','cancelled'] loop
      if p_certified ? k and (p_certified->>k)::numeric <> (v_t->>k)::numeric then v_diff := v_diff || format('%s %s vs %s; ', k, p_certified->>k, v_t->>k); end if;
    end loop;
    if v_diff <> '' and coalesce(trim(p_reason), '') = '' then raise exception 'The figures differ from the team roll-up (%). Give a reason.', rtrim(v_diff, '; ') using errcode = 'P0001'; end if;
  end if;
  perform set_config('app.reason', 'certified for ' || v_name || ' (away)' || coalesce(': ' || nullif(p_reason, ''), ''), true);
  insert into public.certifications as c (manager_id, work_date, function, team_totals, own_totals, calculated_total, certified_value, reason, late, certified_detail, certified_by)
  values (p_manager, p_work_date, p_function, v_t, '{}'::jsonb, (v_t->>'net')::numeric, null,
          'Certified by ' || (select full_name from public.persons where id = v_me) || ' because ' || v_name || ' was away' || coalesce('. ' || nullif(p_reason, ''), '')
          || case when v_diff <> '' then ' [' || rtrim(v_diff, '; ') || ']' else '' end,
          app.window_state(p_work_date) <> 'open', p_certified, v_me)
  on conflict (manager_id, work_date, function) do update set team_totals = excluded.team_totals, calculated_total = excluded.calculated_total,
    reason = excluded.reason, late = excluded.late, certified_detail = excluded.certified_detail, certified_by = excluded.certified_by,
    revision = c.revision + 1, certified_at = now()
  returning * into v_c;
  insert into public.notifications(person_id, kind, message, link)
  values (p_manager, 'certified_for_you', (select full_name from public.persons where id = v_me) || ' certified your team for ' || to_char(p_work_date, 'DD Mon') || ' while you were away.', '/team');
  return v_c;
end $$;
grant execute on function public.certify_for(uuid, date, app.fn, jsonb, text) to authenticated;
revoke all on function public.certify_for(uuid, date, app.fn, jsonb, text) from public, anon;
