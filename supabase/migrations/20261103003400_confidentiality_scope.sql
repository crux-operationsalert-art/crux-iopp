-- D-52 (P1 confidentiality): what you see follows your assignment, not your job title.
--   Whole business: Admin (system account) and Leadership (Chairman, MD — has_role('auditor') covers them).
--   Everyone else, including the Operations Head and Collections Head: themselves, everyone below them in the
--   reporting lines (either function), and the locations they or their team head or work on.
--   Collections money (receivables, daily collections) stays organisation-wide for the Collections Head, as agreed
--   (D-33/D-43), but people lists, attendance, operations figures, history, rates and partner terms do not.

create or replace function app.sees_all() returns boolean
language sql stable security definer set search_path = public, app, pg_temp as $$
  select app.is_admin() or app.has_role('auditor')
$$;

create or replace function app.can_view_person(p_person uuid, p_date date, p_fn app.fn)
returns boolean language plpgsql stable security definer set search_path = public, app, pg_temp as $$
declare v_me uuid := app.me();
begin
  if v_me is null then return false; end if;
  if p_person = v_me then return true; end if;
  if app.sees_all() then return true; end if;
  return exists (select 1 from app.subtree(v_me, p_fn, coalesce(p_date, app.today())) s where s.person_id = p_person);
end $$;

create or replace function app.visible_branches(p_date date)
returns setof uuid language plpgsql stable security definer set search_path = public, app, pg_temp as $$
declare v_me uuid := app.me();
begin
  if v_me is null then return; end if;
  if app.sees_all() then return query select b.id from public.branches b; return; end if;
  return query
  with people as (select v_me pid union select s.person_id from app.subtree(v_me, 'operations', p_date) s
                  union select s.person_id from app.subtree(v_me, 'collections', p_date) s)
  select distinct h.branch_id from public.location_heads h join people on people.pid = h.person_id
   where h.valid && daterange(date_trunc('month', p_date)::date, p_date + 1)
  union
  select distinct cl.branch_id from public.allocations a join people on people.pid = a.person_id
    join public.client_locations cl on cl.id = a.client_location_id
   where a.valid && daterange(date_trunc('month', p_date)::date, p_date + 1);
end $$;

-- Disputing receivables: Admin and the Collections Head (D-43); the Operations Head no longer by title.
create or replace function app.can_review_ar() returns boolean
language sql stable security definer set search_path = public, app, pg_temp as $$
  select app.is_admin() or app.has_role('collections_head')
$$;

-- Targets: org / zone numbers by the heads; branch within your locations; people within your team.
create or replace function app.can_set_target(p_level text, p_metric text, p_zone uuid, p_branch uuid, p_person uuid, p_month date)
returns boolean language plpgsql stable security definer set search_path = public, app, pg_temp as $$
declare v_fn app.fn := app.metric_function(p_metric); v_head app.role_code; v_d date := greatest(p_month, app.today());
begin
  if app.is_admin() then return true; end if;
  v_head := case when v_fn = 'collections' then 'collections_head' else 'ops_head' end;
  if p_level in ('org','zone') then return app.has_role(v_head) or app.has_role('auditor'); end if;
  if p_level = 'branch' then
    return ((app.has_role(v_head) or app.has_role('auditor')) and p_branch in (select app.visible_branches(v_d)))
        or exists (select 1 from public.role_assignments r join public.branch_zones bz on bz.zone_id = r.zone_id
                    where r.person_id = app.me() and r.role = 'zm' and r.valid @> app.today()
                      and bz.branch_id = p_branch and bz.valid @> p_month);
  end if;
  return exists (select 1 from app.subtree(app.me(), 'operations', v_d) s where s.person_id = p_person)
      or exists (select 1 from app.subtree(app.me(), 'collections', v_d) s where s.person_id = p_person);
end $$;

-- Patch the screens that granted the whole business by title.
do $do$
declare r record; f text; o text;
begin
  for r in select * from (values
    ('public.attendance_board(date,date,uuid)',      'or app.has_role(''ops_head'') or app.has_role(''auditor'')', 'or app.has_role(''auditor'')'),
    ('public.attendance_summary(date,date,uuid)', 'or app.has_role(''ops_head'') or app.has_role(''auditor'')', 'or app.has_role(''auditor'')'),
    ('public.attrition(date,date)',        'from public.persons p0 where true',
      'from public.persons p0 where (app.sees_all() or app.has_role(''hr_admin'') or p0.id in (select s.person_id from app.subtree(app.me(), ''operations'', p_to) s union select s.person_id from app.subtree(app.me(), ''collections'', p_to) s))'),
    ('public.leave_taken(integer,uuid)',   'or app.has_role(''ops_head'') or app.has_role(''auditor'')', 'or app.has_role(''auditor'')'),
    ('public.missing_submissions(date,app.fn)', 'app.is_admin() or app.has_role(''ops_head'') or app.has_role(''auditor'')', 'app.is_admin() or app.has_role(''auditor'')'),
    ('public.month_close_check(date)',     'or app.has_role(''auditor'') or app.has_role(''ops_head''))', 'or app.has_role(''auditor''))'),
    ('public.location_targets(date)',      'or app.has_role(''ops_head'') or app.has_role(''auditor''))', 'or app.has_role(''auditor''))'),
    ('public.copy_targets(date,date,text,boolean)', 'if not (app.is_admin() or app.has_role(''ops_head'')) then raise exception ''Only Admin or the Operations Head can copy targets.''',
                                            'if not app.is_admin() then raise exception ''Only Admin can copy targets for every location.'''),
    ('public.collections_board(date,date)',     'or app.has_role(''auditor'') or app.has_role(''ops_head'') or app.has_role(''collections_head'')', 'or app.has_role(''auditor'') or app.has_role(''collections_head'')'),
    ('public.collections_view(date)',      'or app.has_role(''auditor'') or app.has_role(''ops_head'') or app.has_role(''collections_head'')', 'or app.has_role(''auditor'') or app.has_role(''collections_head'')'),
    ('public.tracker_export(date)',        'app.is_admin() or app.has_role(''auditor'') or app.has_role(''ops_head'') then ''full''', 'app.is_admin() or app.has_role(''auditor'') then ''full'''),
    ('public.target_template(date)',       'v_all := app.is_admin() or app.has_role(''ops_head'') or app.has_role(''collections_head'');', 'v_all := app.is_admin();')
  ) t(sig, a, b) loop
    f := pg_get_functiondef(r.sig::regprocedure); o := f;
    f := replace(f, r.a, r.b);
    if f = o then raise exception 'confidentiality patch: anchor not found in %', r.sig; end if;
    execute f;
  end loop;

  -- target_progress: zone / branch / org progress only within your scope.
  f := pg_get_functiondef('public.target_progress(date,text,uuid,uuid,uuid)'::regprocedure); o := f;
  f := regexp_replace(f, 'if p_level <> ''person'' and not \(app\.is_admin\(\) or app\.has_role\(''auditor''\) or app\.has_role\(''ops_head''\)\s+or app\.has_role\(''collections_head''\) or app\.has_role\(''zm''\) or app\.has_role\(''bm''\) or app\.has_role\(''ba''\)\) then',
    'if p_level <> ''person'' and not (app.sees_all()
       or (p_level = ''org'' and (app.has_role(''ops_head'') or app.has_role(''collections_head'')))
       or (p_level = ''branch'' and p_branch_id in (select app.visible_branches(least(v_today, v_end))))
       or (p_level = ''zone'' and exists (select 1 from public.branch_zones bz where bz.zone_id = p_zone_id and bz.valid @> least(v_today, v_end)
                                           and bz.branch_id in (select app.visible_branches(least(v_today, v_end)))))) then');
  if f = o then raise exception 'confidentiality patch: target_progress anchor not found'; end if;
  execute f;
end $do$;

-- Tables: tighten read rules (ALTER POLICY keeps the policy, replaces the rule).
alter policy read_collection_ar on public.collection_ar
  using (app.sees_all() or app.has_role('collections_head') or branch_id in (select app.visible_branches(app.today())));
alter policy read_collection_daily on public.collection_daily
  using (app.can_view_person(person_id, entry_date, 'collections') or app.can_view_person(person_id, entry_date, 'operations')
         or app.has_role('collections_head') or app.sees_all() or branch_id in (select app.visible_branches(app.today())));
alter policy read_tracker_daily on public.tracker_daily
  using (app.sees_all() or branch_id in (select app.visible_branches(app.today())));
alter policy read_tracker on public.tracker_monthly
  using (app.sees_all() or branch_id in (select app.visible_branches(app.today())));
alter policy read_partner_agreements on public.partner_agreements using (app.sees_all());
alter policy read_partner_share on public.partner_share_rules
  using (app.sees_all() or ((app.has_role('zm') or app.has_role('bm') or app.has_role('ba') or app.has_role('ops_head'))
                            and branch_id in (select app.visible_branches(app.today()))));
alter policy read_targets on public.target_allocations
  using ((level = 'person' and (app.can_view_person(person_id, month, 'operations') or app.can_view_person(person_id, month, 'collections')))
      or (level <> 'person' and (app.sees_all()
          or (level = 'org' and (app.has_role('ops_head') or app.has_role('collections_head')))
          or (level = 'branch' and branch_id in (select app.visible_branches(app.today())))
          or (level = 'zone' and exists (select 1 from public.branch_zones bz where bz.zone_id = target_allocations.zone_id and bz.valid @> app.today()
                                          and bz.branch_id in (select app.visible_branches(app.today())))))));
alter policy read_location_heads on public.location_heads
  using (app.sees_all() or app.has_role('hr_admin') or person_id = app.me() or branch_id in (select app.visible_branches(app.today())));
alter policy read_rate_cards on public.rate_cards
  using (app.sees_all() or exists (select 1 from public.client_locations cl where cl.client_id = rate_cards.client_id
           and cl.location_id = rate_cards.location_id and cl.process_id = rate_cards.process_id
           and cl.branch_id in (select app.visible_branches(app.today()))));

revoke all on function app.sees_all() from public, anon;
-- Policies run as the signed-in user: they may ask for their own scope.
grant execute on function app.sees_all(), app.visible_branches(date) to authenticated;
