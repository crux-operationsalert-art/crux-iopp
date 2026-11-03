-- Performance (final audit): scope checks in row rules are worked out once per query, not once per row.
-- (Measured before: reading the daily tracker table took 6.8 s for a manager; the same rules, evaluated once.)
create or replace function app.my_branches() returns uuid[]
language sql stable security definer set search_path = public, app, pg_temp as $$
  select coalesce(array_agg(b), '{}') from app.visible_branches(app.today()) b
$$;
grant execute on function app.my_branches() to authenticated;
revoke all on function app.my_branches() from public, anon;

alter policy read_collection_ar on public.collection_ar
  using ((select app.sees_all()) or (select app.has_role('collections_head')) or branch_id = any ((select app.my_branches())::uuid[]));
alter policy read_collection_daily on public.collection_daily
  using ((select app.sees_all()) or (select app.has_role('collections_head')) or branch_id = any ((select app.my_branches())::uuid[])
         or app.can_view_person(person_id, entry_date, 'collections') or app.can_view_person(person_id, entry_date, 'operations'));
alter policy read_tracker_daily on public.tracker_daily using ((select app.sees_all()) or branch_id = any ((select app.my_branches())::uuid[]));
alter policy read_tracker on public.tracker_monthly using ((select app.sees_all()) or branch_id = any ((select app.my_branches())::uuid[]));
alter policy read_partner_agreements on public.partner_agreements using ((select app.sees_all()));
alter policy read_partner_share on public.partner_share_rules
  using ((select app.sees_all()) or ((select app.has_role('zm') or app.has_role('bm') or app.has_role('ba') or app.has_role('ops_head'))
                                     and branch_id = any ((select app.my_branches())::uuid[])));
alter policy read_targets on public.target_allocations
  using ((level = 'person' and (app.can_view_person(person_id, month, 'operations') or app.can_view_person(person_id, month, 'collections')))
      or (level <> 'person' and ((select app.sees_all())
          or (level = 'org' and (select app.has_role('ops_head') or app.has_role('collections_head')))
          or (level = 'branch' and branch_id = any ((select app.my_branches())::uuid[]))
          or (level = 'zone' and exists (select 1 from public.branch_zones bz where bz.zone_id = target_allocations.zone_id and bz.valid @> app.today()
                                          and bz.branch_id = any ((select app.my_branches())::uuid[]))))));
alter policy read_location_heads on public.location_heads
  using ((select app.sees_all() or app.has_role('hr_admin')) or person_id = (select app.me()) or branch_id = any ((select app.my_branches())::uuid[]));
alter policy read_rate_cards on public.rate_cards
  using ((select app.sees_all()) or exists (select 1 from public.client_locations cl where cl.client_id = rate_cards.client_id
           and cl.location_id = rate_cards.location_id and cl.process_id = rate_cards.process_id and cl.branch_id = any ((select app.my_branches())::uuid[])));

-- People rules: the list of people you can see is worked out once per query.
create or replace function app.my_people(p_fn app.fn default null) returns uuid[]
language sql stable security definer set search_path = public, app, pg_temp as $$
  select coalesce(array_agg(distinct x), '{}') from (
    select app.me() x
    union select s.person_id from app.subtree(app.me(), 'operations', app.today()) s where p_fn is null or p_fn = 'operations'
    union select s.person_id from app.subtree(app.me(), 'collections', app.today()) s where p_fn is null or p_fn = 'collections') z where x is not null
$$;
grant execute on function app.my_people(app.fn) to authenticated;
revoke all on function app.my_people(app.fn) from public, anon;

alter policy read_audit on public.audit_events using ((select app.is_admin() or app.has_role('auditor')));
alter policy read_persons on public.persons
  using ((select app.sees_all() or app.has_role('hr_admin')) or id = any ((select app.my_people())::uuid[]));
alter policy read_allocations on public.allocations
  using ((select app.sees_all() or app.has_role('hr_admin')) or person_id = any ((select app.my_people())::uuid[]));
alter policy read_reporting_lines on public.reporting_lines
  using ((select app.sees_all() or app.has_role('hr_admin')) or person_id = any ((select app.my_people())::uuid[]));
alter policy read_role_assignments on public.role_assignments
  using ((select app.sees_all() or app.has_role('hr_admin')) or person_id = any ((select app.my_people())::uuid[]));
alter policy read_tasks on public.tasks
  using ((select app.is_admin() or app.has_role('hr_admin') or app.has_role('auditor'))
         or owner_id = any ((select app.my_people('operations'))::uuid[]) or subject_id = any ((select app.my_people('operations'))::uuid[]));
