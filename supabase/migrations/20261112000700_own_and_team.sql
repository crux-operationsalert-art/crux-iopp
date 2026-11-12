-- D-136  Data access audit fixes. The rule: everyone sees their own; a person with a team sees their team's;
-- nothing company-wide unless the role is built for it.

-- 1. A person with no team, no location to head and no leader to assist is an individual contributor: no branch-level
--    business data (dashboards, trackers, branch targets, rates). Their own figures are unaffected.
create or replace function app.is_individual(p_date date default null) returns boolean
language sql stable security definer set search_path = public, app, pg_temp as $$
  select not app.sees_all()
     and cardinality(app.principals()) <= 1
     and not exists (select 1 from public.role_assignments ra where ra.person_id = app.me() and ra.valid @> app.today()
                      and ra.role::text in ('manager', 'bm', 'ba', 'zm', 'ops_head', 'collections_head', 'product_head', 'leadership', 'hr_admin'))
     and not exists (select 1 from public.reporting_lines r where r.manager_id = app.me() and r.valid @> coalesce(p_date, app.today()))
     and not exists (select 1 from public.location_heads h where h.person_id = app.me() and h.valid @> coalesce(p_date, app.today()));
$$;
grant execute on function app.is_individual(date) to authenticated;

do $mig$
declare f text; o text; r record;
begin
  f := pg_get_functiondef('app.visible_branches(date)'::regprocedure); o := f;
  if position('app.is_individual' in f) = 0 then
    f := replace(f, E'  return query\n  with pr as', E'  if app.is_individual(p_date) then return; end if;\n  return query\n  with pr as');
    if f = o then raise exception 'visible_branches anchor not found'; end if; execute f;
  end if;

  -- 2. The Home dashboard reads team targets as part of itself: the Targets page setting must not switch it off or re-scope it mid-way
  f := pg_get_functiondef('public.team_targets(date,uuid)'::regprocedure); o := f;
  if position('app.inner' in f) = 0 then
    f := replace(f, 'perform app.page_enter(''targets'');', 'if coalesce(current_setting(''app.inner'', true), '''') <> ''1'' then perform app.page_enter(''targets''); end if;');
    if f = o then raise exception 'team_targets anchor not found'; end if; execute f;
  end if;
  for r in select p.oid from pg_proc p where p.proname = 'perf_dashboard' and p.pronamespace = 'public'::regnamespace loop
    f := pg_get_functiondef(r.oid); o := f;
    if position('app.inner' in f) > 0 then continue; end if;
    f := replace(f, E'\nbegin\n  perform app.require_ops_view();', E'\nbegin\n  perform set_config(''app.inner'', ''1'', true);\n  perform app.require_ops_view();');
    if f = o then raise exception 'perf_dashboard anchor not found'; end if; execute f;
  end loop;
end $mig$;

-- 3. Colleagues at the same location no longer read each other's daily lines; the people who head the location still do
create or replace function app.shares_location(p_client_location uuid, p_date date) returns boolean
language sql stable security definer set search_path = public, app, pg_temp as $$
  select exists (select 1 from public.client_locations cl join public.location_heads h on h.branch_id = cl.branch_id
                  where cl.id = p_client_location and h.person_id = any (app.principals()) and h.valid @> p_date)
$$;

-- 4. Client list, where each client is served, and product heads: only for those who work them
create or replace function app.wide_business() returns boolean
language sql stable security definer set search_path = public, app, pg_temp as $$
  select app.sees_all() or exists (select 1 from public.role_assignments ra where ra.person_id = app.me() and ra.valid @> app.today()
                                     and ra.role::text in ('hr_admin', 'ops_head', 'collections_head', 'product_head', 'leadership'));
$$;
create or replace function app.my_client_locations() returns uuid[]
language sql stable security definer set search_path = public, app, pg_temp as $$
  select coalesce(array_agg(distinct a.client_location_id), '{}') from public.allocations a where a.person_id = any (app.my_people()) and a.valid @> app.today();
$$;
grant execute on function app.wide_business(), app.my_client_locations() to authenticated;

alter policy read_client_locations on public.client_locations
  using ((select app.wide_business()) or branch_id = any ((select app.my_branches())::uuid[]) or id = any ((select app.my_client_locations())::uuid[]));
alter policy read_clients on public.clients
  using ((select app.wide_business()) or exists (select 1 from public.client_locations cl where cl.client_id = clients.id
           and (cl.branch_id = any ((select app.my_branches())::uuid[]) or cl.id = any ((select app.my_client_locations())::uuid[]))));
alter policy read_product_heads on public.product_heads
  using ((select app.wide_business()) or person_id = (select app.me()));

-- 5. Settings: company configuration is for those who run it; everyone else gets what the app needs through whoami
alter policy read_settings on public.settings
  using ((select app.is_admin() or app.has_role('hr_admin') or app.has_role('auditor') or app.has_role('leadership') or app.has_role('ops_head'))
         or (key = 'report_recipients' and (select app.me()) is not null and not (select app.is_individual())));

-- 6. Functions are for signed-in people only
do $$
declare r record;
begin
  for r in select p.oid::regprocedure sig from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind = 'f'
            and has_function_privilege('anon', p.oid, 'execute') and has_function_privilege('authenticated', p.oid, 'execute') loop
    execute format('revoke execute on function %s from public, anon', r.sig);
    execute format('grant execute on function %s to authenticated', r.sig);
  end loop;
end $$;

-- 7. A person still sees the rate behind their own lines (their own revenue), through the services they are allocated to
alter policy read_rate_cards on public.rate_cards
  using ((select app.sees_all()) or exists (select 1 from public.client_locations cl
           where cl.client_id = rate_cards.client_id and cl.location_id = rate_cards.location_id and cl.process_id = rate_cards.process_id
             and (cl.branch_id = any ((select app.my_branches())::uuid[]) or cl.id = any ((select app.my_client_locations())::uuid[]))));

-- 8. The app is told when the person is an individual contributor, so Home shows their own month instead of a dashboard
do $mig$
declare v text := pg_get_functiondef('public.whoami()'::regprocedure); o text := v;
begin
  if position('''individual''' in v) = 0 then
    v := replace(v, '''hidden_pages'', app.hidden_pages(),', '''hidden_pages'', app.hidden_pages(), ''individual'', app.is_individual(),');
    if v = o then raise exception 'whoami anchor not found'; end if; execute v;
  end if;
end $mig$;
