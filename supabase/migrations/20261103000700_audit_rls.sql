-- Audit trail, Row Level Security, grants. UI hiding is never the control (SOW 13).

create table public.audit_events (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  actor_uid uuid,
  actor_person uuid,
  table_name text not null,
  row_id text,
  action text not null,
  before jsonb,
  after jsonb,
  reason text
);
create index on public.audit_events (table_name, row_id);
create index on public.audit_events (at desc);

create or replace function app.audit() returns trigger
language plpgsql security definer set search_path = public, app, pg_temp as $$
declare v_row jsonb := to_jsonb(coalesce(new, old));
begin
  insert into public.audit_events(actor_uid, actor_person, table_name, row_id, action, before, after, reason)
  values (auth.uid(), app.me(), tg_table_name,
          coalesce(v_row->>'id', v_row->>'person_id' || '|' || coalesce(v_row->>'work_date','') || '|' || coalesce(v_row->>'function',''),
                   v_row->>'key', v_row->>'month'),
          lower(tg_op),
          case when tg_op <> 'INSERT' then to_jsonb(old) end,
          case when tg_op <> 'DELETE' then to_jsonb(new) end,
          nullif(current_setting('app.reason', true), ''));
  return coalesce(new, old);
end $$;

-- Append-only: nobody (via the API) may change audit history.
create or replace function app.audit_immutable() returns trigger language plpgsql as $$
begin raise exception 'Audit records cannot be changed.' using errcode = '42501'; end $$;
create trigger trg_audit_immutable before update or delete on public.audit_events
  for each row execute function app.audit_immutable();

do $$
declare t text;
begin
  foreach t in array array['settings','zones','branches','branch_zones','clients','locations','processes',
    'client_locations','holidays','persons','role_assignments','reporting_lines','allocations',
    'productivity_lines','day_status','certifications','reopen_grants','wip_openings','closed_periods',
    'rate_cards','partner_share_rules','collection_entries','bill_entries','target_allocations',
    'penalty_rules','penalty_ledger'] loop
    execute format('create trigger trg_audit after insert or update or delete on public.%I
                    for each row execute function app.audit()', t);
  end loop;
end $$;

-- ------------------------------------------------------------ RLS
do $$
declare t text;
begin
  for t in select tablename from pg_tables where schemaname = 'public' loop
    execute format('alter table public.%I enable row level security', t);
  end loop;
end $$;

-- Reference masters: readable by any signed-in person with an identity; writable by Admin (audited).
do $$
declare t text;
begin
  foreach t in array array['zones','branches','branch_zones','clients','locations','processes','client_locations',
                           'holidays','settings','rate_cards','closed_periods','penalty_rules'] loop
    execute format('create policy read_%1$s on public.%1$I for select to authenticated using (app.me() is not null)', t);
    execute format('create policy admin_write_%1$s on public.%1$I for all to authenticated
                    using (app.is_admin()) with check (app.is_admin())', t);
  end loop;
end $$;

-- Partner commercial terms: managers and above only.
create policy read_partner_share on public.partner_share_rules for select to authenticated
  using (app.is_admin() or app.has_role('ops_head') or app.has_role('auditor') or app.has_role('zm')
         or app.has_role('ba') or app.has_role('bm') or app.has_role('collections_head'));
create policy admin_write_partner_share on public.partner_share_rules for all to authenticated
  using (app.is_admin()) with check (app.is_admin());

-- People: you, your scope (either function), HR, admin. Collections Head sees names for collection drill-down only.
create policy read_persons on public.persons for select to authenticated
  using (app.can_view_person(id, app.today(), 'operations') or app.can_view_person(id, app.today(), 'collections')
         or app.has_role('hr_admin'));
create policy hr_write_persons on public.persons for update to authenticated
  using (app.is_admin() or app.has_role('hr_admin')) with check (app.is_admin() or app.has_role('hr_admin'));

do $$
declare t text;
begin
  foreach t in array array['role_assignments','reporting_lines','allocations'] loop
    execute format('create policy read_%1$s on public.%1$I for select to authenticated
       using (app.can_view_person(person_id, app.today(), ''operations'')
              or app.can_view_person(person_id, app.today(), ''collections'') or app.has_role(''hr_admin''))', t);
    execute format('create policy admin_write_%1$s on public.%1$I for all to authenticated
       using (app.is_admin() or app.has_role(''hr_admin'')) with check (app.is_admin() or app.has_role(''hr_admin''))', t);
  end loop;
end $$;

-- Operations records: scope as at the work date. Writes only through RPCs (no write policies).
create policy read_lines on public.productivity_lines for select to authenticated
  using (app.can_view_person(person_id, work_date, 'operations'));
create policy read_day_status on public.day_status for select to authenticated
  using (app.can_view_person(person_id, work_date, function));
create policy read_certifications on public.certifications for select to authenticated
  using (app.can_view_person(manager_id, work_date, function));
create policy read_wip on public.wip_openings for select to authenticated
  using (app.can_view_person(person_id, as_of, 'operations'));
create policy admin_write_wip on public.wip_openings for all to authenticated
  using (app.is_admin()) with check (app.is_admin());
create policy read_reopen on public.reopen_grants for select to authenticated
  using (app.can_view_person(person_id, coalesce(work_date, target_month), function));

-- Collections & bills: collections scope (Collections Head and Ops Head see all via can_view_person).
create policy read_collections on public.collection_entries for select to authenticated
  using (app.can_view_person(person_id, collection_date, 'collections'));
create policy read_bills on public.bill_entries for select to authenticated
  using (app.can_view_person(person_id, bill_date, 'collections'));

-- Targets: person rows by scope; structural rows to leaders.
create policy read_targets on public.target_allocations for select to authenticated
  using ((level = 'person' and (app.can_view_person(person_id, month, 'operations')
                                or app.can_view_person(person_id, month, 'collections')))
         or (level <> 'person' and (app.is_admin() or app.has_role('auditor') or app.has_role('ops_head')
             or app.has_role('collections_head') or app.has_role('zm') or app.has_role('bm') or app.has_role('ba'))));

-- Penalties: the person, their managers in scope, Admin/HR. Peers never.
create policy read_penalties on public.penalty_ledger for select to authenticated
  using (app.can_view_person(person_id, event_date, 'operations') or app.has_role('hr_admin'));

create policy read_notifications on public.notifications for select to authenticated
  using (person_id = app.me());

create policy read_audit on public.audit_events for select to authenticated
  using (app.is_admin() or app.has_role('auditor'));

-- ------------------------------------------------------------ grants
revoke all on all tables in schema public from anon;
revoke all on all functions in schema public from anon, public;
revoke all on all functions in schema app from anon, public;
grant usage on schema app to authenticated;
grant execute on all functions in schema app to authenticated;
grant select on all tables in schema public to authenticated;
grant insert, update, delete on public.zones, public.branches, public.branch_zones, public.clients, public.locations,
  public.processes, public.client_locations, public.holidays, public.settings, public.rate_cards, public.closed_periods,
  public.penalty_rules, public.partner_share_rules, public.persons, public.role_assignments, public.reporting_lines,
  public.allocations, public.wip_openings to authenticated;   -- still gated by the admin/HR RLS policies above
grant execute on all functions in schema public to authenticated;
alter default privileges in schema public revoke all on tables from anon;
alter default privileges in schema public revoke execute on functions from anon, public;
