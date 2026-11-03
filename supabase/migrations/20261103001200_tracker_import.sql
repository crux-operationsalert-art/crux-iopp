-- Controlled historical import from the Live Zonewise Monthly Business Tracker (D-19, Master §16).
-- Rows land in import_rows (staging) through a short-lived upload token, are previewed/reconciled,
-- and only then committed by app.commit_tracker_batch(). Source figures are preserved as recorded.

create table public.import_batches (
  id uuid primary key default gen_random_uuid(),
  source text not null,
  file_name text not null,
  source_ref text,
  as_of date,
  status text not null default 'staged' check (status in ('staged','committed','rejected')),
  row_count integer not null default 0,
  reconciliation jsonb,
  notes text,
  created_at timestamptz not null default now(),
  committed_at timestamptz
);

create table public.import_rows (
  batch_id uuid not null references public.import_batches(id),
  row_no integer not null,
  kind text not null check (kind in ('fact','rate','exception')),
  payload jsonb not null,
  primary key (batch_id, row_no)
);

create table app.import_tokens (
  batch_id uuid primary key references public.import_batches(id),
  token_hash text not null,
  expires_at timestamptz not null
);
revoke all on app.import_tokens from public, anon, authenticated;

-- Monthly history exactly as the tracker records it (no invented Entry/Closure split).
create table public.tracker_monthly (
  id bigint generated always as identity primary key,
  batch_id uuid not null references public.import_batches(id),
  month date not null check (extract(day from month) = 1),
  as_of date,
  region text,
  zone_id uuid references public.zones(id),
  branch_id uuid references public.branches(id),
  client_id uuid references public.clients(id),
  zone_name text not null,
  location_name text not null,
  client_name text not null,
  target_cases numeric(14,2),
  actual_cases numeric(14,2),
  revenue_target numeric(16,2),
  actual_revenue numeric(16,2),
  billing_amount numeric(16,2),
  source_row integer not null,
  source_columns text not null,
  unique (month, branch_id, client_id, batch_id)
);
create index on public.tracker_monthly (month);

-- Upload path: one-time token, expires, rows only go to staging.
create or replace function public.stage_import_rows(p_batch uuid, p_token text, p_rows jsonb) returns int
language plpgsql security definer set search_path = public, app, pg_temp as $$
declare v_n int;
begin
  if not exists (select 1 from app.import_tokens t join public.import_batches b on b.id = t.batch_id
                  where t.batch_id = p_batch and b.status = 'staged' and t.expires_at > now()
                    and t.token_hash = extensions.crypt(p_token, t.token_hash)) then
    raise exception 'Invalid or expired import token.' using errcode = '42501';
  end if;
  insert into public.import_rows(batch_id, row_no, kind, payload)
  select p_batch, (r->>'row_no')::int, r->>'kind', r->'payload' from jsonb_array_elements(p_rows) r
  on conflict (batch_id, row_no) do update set kind = excluded.kind, payload = excluded.payload;
  get diagnostics v_n = row_count;
  update public.import_batches set row_count = (select count(*) from public.import_rows where batch_id = p_batch) where id = p_batch;
  return v_n;
end $$;
revoke all on function public.stage_import_rows(uuid, text, jsonb) from public;
grant execute on function public.stage_import_rows(uuid, text, jsonb) to anon, authenticated;

create or replace function app.slug(t text) returns text language sql immutable as $$
  select trim(both '-' from regexp_replace(upper(t), '[^A-Z0-9]+', '-', 'g')) $$;

-- Commit: creates masters that do not exist yet, rate cards, and the monthly history. Idempotent by name.
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
    from public.import_rows where batch_id = p_batch and kind = 'fact'
  on conflict (code) do nothing;

  insert into public.locations(code, name)
  select distinct on (app.slug(payload->>'location')) 'L-' || app.slug(payload->>'location'), payload->>'location'
    from public.import_rows where batch_id = p_batch and kind = 'fact'
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
   where r.batch_id = p_batch and r.kind = 'fact'
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
    join public.branches b on b.code = 'B-' || app.slug(p->>'location')
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
revoke all on function app.commit_tracker_batch(uuid) from public, anon, authenticated;

-- History for dashboards: leaders by scope (ZM sees own zone).
alter table public.import_batches enable row level security;
alter table public.import_rows enable row level security;
alter table public.tracker_monthly enable row level security;
create policy read_batches on public.import_batches for select to authenticated using (app.is_admin() or app.has_role('auditor'));
create policy read_import_rows on public.import_rows for select to authenticated using (app.is_admin() or app.has_role('auditor'));
create policy read_tracker on public.tracker_monthly for select to authenticated
  using (app.is_admin() or app.has_role('auditor') or app.has_role('ops_head') or app.has_role('collections_head')
         or exists (select 1 from public.role_assignments r where r.person_id = app.me() and r.role = 'zm'
                     and r.zone_id = tracker_monthly.zone_id and r.valid @> app.today()));
revoke all on public.import_batches, public.import_rows, public.tracker_monthly from anon;
grant select on public.import_batches, public.import_rows, public.tracker_monthly to authenticated;

create or replace function public.tracker_history(p_from date, p_to date, p_group text default 'month', p_month date default null)
returns table(key text, label text, target_cases numeric, actual_cases numeric, revenue_target numeric,
              actual_revenue numeric, billing_amount numeric, rows bigint)
language plpgsql stable security invoker set search_path = public, app, pg_temp as $$
begin
  if p_group not in ('month','region','zone','location','client') then raise exception 'Unsupported grouping.' using errcode = '22023'; end if;
  return query
  select case p_group when 'month' then to_char(t.month,'YYYY-MM') when 'region' then t.region when 'zone' then t.zone_name
                      when 'location' then t.location_name else t.client_name end,
         case p_group when 'month' then to_char(t.month,'Mon YYYY') when 'region' then t.region when 'zone' then t.zone_name
                      when 'location' then t.location_name else t.client_name end,
         sum(t.target_cases), sum(t.actual_cases), sum(t.revenue_target), sum(t.actual_revenue), sum(t.billing_amount), count(*)
    from public.tracker_monthly t
   where t.month between date_trunc('month', p_from) and p_to and (p_month is null or t.month = date_trunc('month', p_month))
   group by 1, 2
   order by (case when p_group = 'month' then min(t.month) end), sum(t.actual_revenue) desc nulls last;
end $$;
revoke all on function public.tracker_history(date, date, text, date) from public, anon;
grant execute on function public.tracker_history(date, date, text, date) to authenticated;
