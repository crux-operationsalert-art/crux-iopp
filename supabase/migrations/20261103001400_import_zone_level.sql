-- Zone-level history rows (months recorded before a zone was split into locations) stay in tracker_monthly
-- with branch_id NULL; they never create branches, locations or services.
create or replace function app.commit_tracker_batch(p_batch uuid) returns jsonb
language plpgsql security definer set search_path = public, app, extensions, pg_temp as $$
declare v_proc uuid; v_res jsonb;
begin
  if (select status from public.import_batches where id = p_batch) <> 'staged' then
    raise exception 'Batch is not in staged state.';
  end if;
  perform set_config('app.reason', 'tracker import ' || p_batch, true);

  insert into public.processes(code, name) values ('VER', 'Verification (as reported in Zonal Tracker)')
  on conflict (code) do nothing;
  select id into v_proc from public.processes where code = 'VER';

  insert into public.zones(code, name, region)
  select distinct on (app.slug(payload->>'zone')) 'Z-' || app.slug(payload->>'zone'), payload->>'zone', payload->>'region'
    from public.import_rows where batch_id = p_batch and kind = 'fact'
  on conflict (code) do update set region = coalesce(public.zones.region, excluded.region);

  insert into public.branches(code, name, branch_type, type_confirmed)
  select distinct on (app.slug(payload->>'location')) 'B-' || app.slug(payload->>'location'), payload->>'location', 'own', false
    from public.import_rows where batch_id = p_batch and kind = 'fact' and coalesce((payload->>'zone_level')::boolean, false) = false
  on conflict (code) do nothing;

  insert into public.locations(code, name)
  select distinct on (app.slug(payload->>'location')) 'L-' || app.slug(payload->>'location'), payload->>'location'
    from public.import_rows where batch_id = p_batch and kind = 'fact' and coalesce((payload->>'zone_level')::boolean, false) = false
  on conflict (code) do nothing;

  insert into public.branch_zones(branch_id, zone_id, valid)
  select distinct b.id, z.id, daterange('2025-01-01', null)
    from public.import_rows r
    join public.branches b on b.code = 'B-' || app.slug(r.payload->>'location')
    join public.zones z on z.code = 'Z-' || app.slug(r.payload->>'zone')
   where r.batch_id = p_batch and r.kind = 'fact'
     and not exists (select 1 from public.branch_zones x where x.branch_id = b.id);

  insert into public.clients(code, name)
  select distinct on (app.slug(payload->>'client')) 'C-' || app.slug(payload->>'client'), payload->>'client'
    from public.import_rows where batch_id = p_batch and kind = 'fact'
  on conflict (code) do nothing;

  insert into public.client_locations(client_id, location_id, process_id, branch_id, valid)
  select distinct c.id, l.id, v_proc, b.id, daterange('2025-01-01', null)
    from public.import_rows r
    join public.clients c on c.code = 'C-' || app.slug(r.payload->>'client')
    join public.locations l on l.code = 'L-' || app.slug(r.payload->>'location')
    join public.branches b on b.code = 'B-' || app.slug(r.payload->>'location')
   where r.batch_id = p_batch and r.kind = 'fact' and coalesce((r.payload->>'zone_level')::boolean, false) = false
     and not exists (select 1 from public.client_locations x where x.client_id = c.id and x.location_id = l.id and x.process_id = v_proc);

  insert into public.rate_cards(client_id, location_id, process_id, billable_event, rate, valid, reason)
  select c.id, l.id, v_proc, 'entry', (r.payload->>'rate')::numeric,
         daterange((r.payload->>'valid_from')::date, null),
         'Zonal Tracker ' || (r.payload->>'basis') || ' (import ' || p_batch || ')'
    from public.import_rows r
    join public.clients c on c.code = 'C-' || app.slug(r.payload->>'client')
    join public.locations l on l.code = 'L-' || app.slug(r.payload->>'location')
   where r.batch_id = p_batch and r.kind = 'rate'
     and not exists (select 1 from public.rate_cards x where x.client_id = c.id and x.location_id = l.id and x.process_id = v_proc);

  insert into public.tracker_monthly(batch_id, month, as_of, region, zone_id, branch_id, client_id, zone_name, location_name,
         client_name, target_cases, actual_cases, revenue_target, actual_revenue, billing_amount, source_row, source_columns)
  select p_batch, (p->>'month')::date, (p->>'as_of')::date, p->>'region', z.id, b.id, c.id, p->>'zone', p->>'location', p->>'client',
         (p->>'target_cases')::numeric, (p->>'actual_cases')::numeric, (p->>'revenue_target')::numeric,
         (p->>'actual_revenue')::numeric, (p->>'billing_amount')::numeric, (p->>'source_row')::int, p->>'source_columns'
    from (select payload p from public.import_rows where batch_id = p_batch and kind = 'fact') r
    join public.zones z on z.code = 'Z-' || app.slug(p->>'zone')
    left join public.branches b on b.code = 'B-' || app.slug(p->>'location')
    join public.clients c on c.code = 'C-' || app.slug(p->>'client');

  select jsonb_build_object(
    'facts', (select count(*) from public.tracker_monthly where batch_id = p_batch),
    'staged_facts', (select count(*) from public.import_rows where batch_id = p_batch and kind = 'fact'),
    'rates', (select count(*) from public.import_rows where batch_id = p_batch and kind = 'rate'),
    'exceptions', (select count(*) from public.import_rows where batch_id = p_batch and kind = 'exception'),
    'zones', (select count(*) from public.zones), 'branches', (select count(*) from public.branches),
    'clients', (select count(*) from public.clients)) into v_res;
  if (v_res->>'facts')::int <> (v_res->>'staged_facts')::int then
    raise exception 'Commit mismatch: % staged vs % committed facts', v_res->>'staged_facts', v_res->>'facts';
  end if;
  update public.import_batches set status = 'committed', committed_at = now(),
         reconciliation = coalesce(reconciliation, '{}'::jsonb) || jsonb_build_object('commit', v_res) where id = p_batch;
  update app.import_tokens set expires_at = now() where batch_id = p_batch;   -- token can never be reused
  return v_res;
end $$;
