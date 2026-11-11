-- D-125  Report pages get a reach per role: Hidden / Only own / Own team / Full.
-- "Full" is what the role is built to see. Own / Own team narrow it; nothing here widens what a role can see.
-- Also: Admin's "View as" preview now follows the card (pages_for_roles).

alter table public.access_rules add column if not exists scope text check (scope in ('self', 'team'));
alter table public.access_pages add column if not exists scopes text[];     -- which narrower reaches the page supports
update public.access_pages set scopes = '{self,team}' where key in ('tracker', 'status', 'live', 'history', 'targets') and scopes is null;
update public.access_pages set scopes = '{team}' where key = 'attrition' and scopes is null;

-- the limit in force for the page being served ('' = none). Set at the top of each report function, for that request only.
create or replace function app.cap() returns text language sql stable as $$ select coalesce(current_setting('app.scope_cap', true), '') $$;

create or replace function app.my_roles() returns text[]
language sql stable security definer set search_path = public, app, pg_temp as $$
  select coalesce(array_agg(distinct ra.role::text), '{}') from public.role_assignments ra where ra.person_id = app.me() and ra.valid @> app.today();
$$;

-- hidden | self | team | full for a set of roles. Only roles that carry the page count (all of them if none does).
create or replace function app.page_state(p_page text, p_roles text[]) returns text
language sql stable security definer set search_path = public, app, pg_temp as $$
  with pg as (select (select base_roles from public.access_pages where key = p_page) as br),
       counted as (select m as role from unnest(p_roles) m, pg where pg.br is null or m = any (pg.br) or not (p_roles && pg.br)),
       v as (select r.scope from counted c left join public.access_rules r on r.area = 'page:' || p_page and r.role = c.role
              where coalesce(r.level, 'all') <> 'self')
  select case when not exists (select 1 from counted) then 'full'
              when not exists (select 1 from v) then 'hidden'
              when exists (select 1 from v where scope is null) then 'full'
              when exists (select 1 from v where scope = 'team') then 'team' else 'self' end;
$$;

create or replace function app.page_hidden(p_page text) returns boolean
language sql stable security definer set search_path = public, app, pg_temp as $$
  select not app.is_admin() and app.page_state(p_page, app.my_roles()) = 'hidden';
$$;

create or replace function app.page_enter(p_page text) returns void
language plpgsql stable security definer set search_path = public, app, pg_temp as $$
declare v text := case when app.is_admin() then 'full' else app.page_state(p_page, app.my_roles()) end;
begin
  if v = 'hidden' then raise exception 'This page is turned off for your role.' using errcode = '42501'; end if;
  perform set_config('app.scope_cap', case when v in ('self', 'team') then v else '' end, true);
end $$;
grant execute on function app.cap(), app.page_enter(text) to authenticated;

-- ---------------------------------------------------------------- the limit, honoured where reach is decided
do $mig$
declare f text; o text; r record;
begin
  -- company-wide reach is off while a limit is in force
  f := pg_get_functiondef('app.sees_all()'::regprocedure);
  if position('app.cap()' in f) = 0 then
    execute replace(f, 'FUNCTION app.sees_all()', 'FUNCTION app.sees_all_base()');
    execute $f$create or replace function app.sees_all() returns boolean
      language sql stable security definer set search_path = public, app, pg_temp as $$ select app.cap() = '' and app.sees_all_base() $$$f$;
  end if;

  -- "Only own": my own locations, not my team's
  f := pg_get_functiondef('app.visible_branches(date)'::regprocedure); o := f;
  if position('app.cap()' in f) = 0 then
    f := replace(f, 'from pr, app.subtree(pr.id, ''operations'', p_date) s', 'from pr, app.subtree(pr.id, ''operations'', p_date) s where app.cap() <> ''self''');
    f := replace(f, 'from pr, app.subtree(pr.id, ''collections'', p_date) s', 'from pr, app.subtree(pr.id, ''collections'', p_date) s where app.cap() <> ''self''');
    if f = o then raise exception 'visible_branches anchor not found'; end if;
    execute f;
  end if;

  f := pg_get_functiondef('app.can_view_person(uuid,date,app.fn)'::regprocedure); o := f;
  if position('app.cap()' in f) = 0 then
    f := replace(f, E'  if p_person = app.me() then return true; end if;\n',
      E'  if p_person = app.me() then return true; end if;\n  if app.cap() = ''self'' or (app.cap() = ''team'' and not app.in_my_team(p_person)) then return false; end if;\n');
    if f = o then raise exception 'can_view_person anchor not found'; end if;
    execute f;
  end if;

  -- each report function: refuse if hidden, otherwise put the limit in force
  for r in select * from (values
      ('tracker',   'public.tracker_export(date)'),
      ('status',    'public.zonal_tracker(date)'),
      ('live',      'public.missing_submissions(date,app.fn)'),
      ('history',   'public.tracker_history(date,date,text,date)'),
      ('attrition', 'public.attrition(date,date)'),
      ('targets',   'public.team_targets(date,uuid)')) v(page, sig) loop
    f := pg_get_functiondef(r.sig::regprocedure); o := f;
    if position('app.page_enter' in f) > 0 then continue; end if;
    f := replace(f, 'if app.page_hidden(''' || r.page || ''') then raise exception ''This page is turned off for your role.'' using errcode = ''42501''; end if;',
                    'perform app.page_enter(''' || r.page || ''');');
    if f = o then raise exception 'page guard not found in %', r.sig; end if;
    execute f;
  end loop;

  -- Zonal Tracker download: a limited role drops to the matching mode
  f := pg_get_functiondef('public.tracker_export(date)'::regprocedure); o := f;
  if position('app.cap()' in f) = 0 then
    f := regexp_replace(f, E'else ''self'' end;\n',
      E'else ''self'' end;\n  v_mode := case app.cap() when ''self'' then ''self'' when ''team'' then (case when v_mode = ''full'' then ''zm'' else v_mode end) else v_mode end;\n');
    if f = o then raise exception 'tracker_export mode anchor not found'; end if;
    execute f;
  end if;

  f := pg_get_functiondef('public.missing_submissions(date,app.fn)'::regprocedure); o := f;
  if position('app.cap()' in f) = 0 then
    f := replace(f, '(v_all or p.id in (select s.person_id from app.subtree(v_me, p_function, p_work_date) s) or p.id = v_me)',
      '((v_all and app.cap() = '''') or (app.cap() <> ''self'' and p.id in (select s.person_id from app.subtree(v_me, p_function, p_work_date) s)) or p.id = v_me)');
    if f = o then raise exception 'missing_submissions anchor not found'; end if;
    execute f;
  end if;

  f := pg_get_functiondef('public.attrition(date,date)'::regprocedure); o := f;
  if position('app.cap()' in f) = 0 then
    f := replace(f, '(app.sees_all() or app.has_role(''hr_admin'') or p0.id in (', '(app.sees_all() or (app.cap() = '''' and app.has_role(''hr_admin'')) or p0.id in (');
    if f = o then raise exception 'attrition anchor not found'; end if;
    execute f;
  end if;

  f := pg_get_functiondef('public.team_targets(date,uuid)'::regprocedure); o := f;
  if position('app.cap()' in f) = 0 then
    f := replace(f, 'from public.reporting_lines r where r.manager_id = v_p and r.valid @> greatest(v_m, v_to)),',
                    'from public.reporting_lines r where r.manager_id = v_p and r.valid @> greatest(v_m, v_to) and app.cap() <> ''self''),');
    if f = o then raise exception 'team_targets anchor not found'; end if;
    execute f;
  end if;

  -- the card carries the reach
  f := pg_get_functiondef('public.access_card()'::regprocedure); o := f;
  if position('''scopes''' in f) = 0 then
    f := replace(f, '''base_note'', p.base_note)', '''base_note'', p.base_note, ''scopes'', to_jsonb(p.scopes))');
    f := replace(f, '''locked'', a.locked,', '''locked'', a.locked, ''scope'', a.scope,');
    if f = o or position('a.scope' in f) = 0 or position('p.scopes' in f) = 0 then raise exception 'access_card anchors not found'; end if;
    execute f;
  end if;
end $mig$;
revoke all on function app.sees_all_base() from public, anon;
grant execute on function app.sees_all_base() to authenticated;

-- one switch per page and role: hidden | self | team | full
create or replace function public.page_set(p_area text, p_role text, p_choice text) returns jsonb
language plpgsql security definer set search_path = public, app, pg_temp as $$
declare v_locked boolean; v_scopes text[];
begin
  if not app.is_admin() then raise exception 'Only Admin can change access.' using errcode = '42501'; end if;
  if p_choice not in ('hidden', 'self', 'team', 'full') then raise exception 'Unknown choice.' using errcode = '22023'; end if;
  select coalesce(scopes, '{}') into v_scopes from public.access_pages where 'page:' || key = p_area;
  if not found then raise exception 'Unknown page.' using errcode = 'P0002'; end if;
  if p_choice in ('self', 'team') and not (p_choice = any (v_scopes)) then raise exception 'This page cannot be limited that way.' using errcode = '22023'; end if;
  select locked into v_locked from public.access_rules where area = p_area and role = p_role;
  if not found then raise exception 'Unknown area or role.' using errcode = 'P0002'; end if;
  if v_locked then raise exception 'This one is fixed and cannot be changed here.' using errcode = '42501'; end if;
  update public.access_rules set level = case when p_choice = 'hidden' then 'self' else 'all' end,
         scope = case when p_choice in ('self', 'team') then p_choice end, updated_by = app.me(), updated_at = now()
   where area = p_area and role = p_role;
  return jsonb_build_object('ok', true);
end $$;

-- what a person holding exactly these roles gets (for Admin's "View as" preview)
create or replace function public.pages_for_roles(p_roles text[]) returns jsonb
language plpgsql stable security definer set search_path = public, app, pg_temp as $$
begin
  if not app.is_admin() then raise exception 'Only Admin can preview roles.' using errcode = '42501'; end if;
  return (select jsonb_build_object(
    'hidden', coalesce(jsonb_agg(p.key order by p.sort) filter (where app.page_state(p.key, p_roles) = 'hidden'), '[]'::jsonb),
    'limited', coalesce(jsonb_object_agg(p.key, app.page_state(p.key, p_roles)) filter (where app.page_state(p.key, p_roles) in ('self', 'team')), '{}'::jsonb))
    from public.access_pages p);
end $$;
grant execute on function public.page_set(text, text, text), public.pages_for_roles(text[]) to authenticated;
