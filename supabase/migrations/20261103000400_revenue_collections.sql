-- Rate cards, revenue, partner share, collections, reconciliation, bills.

create table public.closed_periods (
  month date primary key check (extract(day from month) = 1),
  closed_by uuid references public.persons(id),
  closed_at timestamptz not null default now(),
  reason text
);

create table public.rate_cards (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id),
  location_id uuid not null references public.locations(id),
  process_id uuid not null references public.processes(id),
  billable_event text not null check (billable_event in ('entry','closure','net_actioned')),   -- D-03
  rate numeric(12,2) not null check (rate >= 0),
  currency text not null default 'INR',
  valid daterange not null check (not isempty(valid) and lower(valid) is not null),
  version integer not null default 1,
  reason text not null,
  created_by uuid references public.persons(id),
  approved_by uuid references public.persons(id),
  created_at timestamptz not null default now(),
  exclude using gist (client_id with =, location_id with =, process_id with =, valid with &&)
);

-- No silent rewrite of closed history (SOW 6.1, D-T5).
create or replace function app.rate_card_guard() returns trigger
language plpgsql security definer set search_path = public, app, pg_temp as $$
declare v_old daterange; v_new daterange;
begin
  v_old := case when tg_op in ('UPDATE','DELETE') then old.valid end;
  v_new := case when tg_op in ('UPDATE','INSERT') then new.valid end;
  if tg_op = 'UPDATE' and old.rate = new.rate and old.billable_event = new.billable_event
     and old.valid = new.valid then return new; end if;
  -- Any change touching a closed month is refused; correct by reopening the period with a reason.
  if exists (select 1 from public.closed_periods cp
              where (v_old is not null and daterange(cp.month, (cp.month + interval '1 month')::date) && v_old
                     and (tg_op = 'DELETE' or old.rate <> new.rate or old.billable_event <> new.billable_event
                          or (v_old * daterange(cp.month, (cp.month + interval '1 month')::date))
                             <> (v_new * daterange(cp.month, (cp.month + interval '1 month')::date))))
                 or (tg_op = 'INSERT' and daterange(cp.month, (cp.month + interval '1 month')::date) && v_new)) then
    raise exception 'This rate change affects a closed month. Reopen the period first (audited).' using errcode = 'P0001';
  end if;
  return coalesce(new, old);
end $$;
create trigger trg_rate_card_guard before insert or update or delete on public.rate_cards
  for each row execute function app.rate_card_guard();

-- Partner share (D-04): explicit percentages, versioned by validity.
create table public.partner_share_rules (
  id uuid primary key default gen_random_uuid(),
  branch_id uuid not null references public.branches(id),
  crux_share_pct numeric(5,2) not null check (crux_share_pct between 0 and 100),
  partner_share_pct numeric(5,2) not null check (partner_share_pct between 0 and 100),
  base text not null default 'gross_operational_revenue',
  valid daterange not null check (not isempty(valid) and lower(valid) is not null),
  agreement_ref text,
  reason text not null,
  created_at timestamptz not null default now(),
  check (crux_share_pct + partner_share_pct = 100),
  exclude using gist (branch_id with =, valid with &&)
);

-- Line-level metrics with revenue at the rate effective on the work date.
create or replace view public.v_line_metrics with (security_invoker = true) as
select l.id, l.person_id, l.work_date, l.client_location_id, l.source,
       cl.client_id, cl.location_id, cl.process_id, cl.branch_id, bz.zone_id,
       l.entry, l.closure, l.cancelled,
       l.entry + l.closure - l.cancelled as net_actioned,
       l.entry + l.closure as gross_actions,
       rc.id as rate_card_id, rc.rate, rc.billable_event,
       case rc.billable_event when 'entry' then l.entry when 'closure' then l.closure
            when 'net_actioned' then l.entry + l.closure - l.cancelled end as billable_qty,
       round(rc.rate * case rc.billable_event when 'entry' then l.entry when 'closure' then l.closure
            when 'net_actioned' then l.entry + l.closure - l.cancelled end, 2) as revenue,
       ps.crux_share_pct, ps.partner_share_pct,
       round(rc.rate * case rc.billable_event when 'entry' then l.entry when 'closure' then l.closure
            when 'net_actioned' then l.entry + l.closure - l.cancelled end * coalesce(ps.partner_share_pct,0) / 100, 2)
         as partner_share,
       round(rc.rate * case rc.billable_event when 'entry' then l.entry when 'closure' then l.closure
            when 'net_actioned' then l.entry + l.closure - l.cancelled end * coalesce(ps.crux_share_pct,100) / 100, 2)
         as crux_share
  from public.productivity_lines l
  join public.client_locations cl on cl.id = l.client_location_id
  left join public.branch_zones bz on bz.branch_id = cl.branch_id and bz.valid @> l.work_date
  left join public.rate_cards rc on rc.client_id = cl.client_id and rc.location_id = cl.location_id
                                 and rc.process_id = cl.process_id and rc.valid @> l.work_date
  left join public.partner_share_rules ps on ps.branch_id = cl.branch_id and ps.valid @> l.work_date;

-- ------------------------------------------------------------ collections
create table public.collection_entries (
  id uuid primary key default gen_random_uuid(),
  person_id uuid not null references public.persons(id),
  collection_date date not null,
  client_id uuid not null references public.clients(id),
  location_id uuid references public.locations(id),
  branch_id uuid references public.branches(id),
  amount_received numeric(14,2) not null check (amount_received >= 0),
  amount_reconciled numeric(14,2) not null default 0 check (amount_reconciled >= 0),
  reconciled_on date,
  recon_status text not null default 'pending'
    check (recon_status in ('pending','partially_reconciled','reconciled','mismatch','reopened')),
  txn_count integer check (txn_count >= 0),
  reference text,
  remarks text,
  source text not null default 'self' check (source in ('self','on_behalf','admin','import')),
  entered_by uuid references public.persons(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on public.collection_entries (collection_date);
create index on public.collection_entries (person_id, collection_date);

create or replace function app.collection_status() returns trigger language plpgsql as $$
begin
  if new.recon_status not in ('mismatch','reopened') then
    new.recon_status := case when new.amount_reconciled = 0 then 'pending'
                             when new.amount_reconciled < new.amount_received then 'partially_reconciled'
                             when new.amount_reconciled = new.amount_received then 'reconciled'
                             else 'mismatch' end;
  end if;
  new.updated_at := now();
  return new;
end $$;
create trigger trg_collection_status before insert or update on public.collection_entries
  for each row execute function app.collection_status();

create table public.bill_entries (
  id uuid primary key default gen_random_uuid(),
  person_id uuid not null references public.persons(id),
  bill_date date not null,
  client_id uuid not null references public.clients(id),
  location_id uuid references public.locations(id),
  branch_id uuid references public.branches(id),
  bill_count integer not null check (bill_count >= 0),
  bill_amount numeric(14,2) not null check (bill_amount >= 0),
  period_from date, period_to date,
  reference text,
  status text not null default 'raised' check (status in ('raised','sent','cancelled')),
  sent_on date,
  remarks text,
  source text not null default 'self' check (source in ('self','on_behalf','admin','import')),
  entered_by uuid references public.persons(id),
  created_at timestamptz not null default now(),
  check (period_to is null or period_from is null or period_to >= period_from)
);
create index on public.bill_entries (bill_date);

create or replace function app.can_record_collections(p_person uuid, p_date date) returns boolean
language sql stable as $$
  select p_person = app.me() or app.is_direct_report(p_person, 'collections', p_date) or app.is_admin()
$$;

create or replace function public.save_collection(p_collection_date date, p_client_id uuid, p_amount_received numeric,
    p_amount_reconciled numeric default 0, p_location_id uuid default null, p_branch_id uuid default null,
    p_reference text default null, p_remarks text default null, p_person uuid default null, p_id uuid default null,
    p_reason text default null)
returns public.collection_entries
language plpgsql security definer set search_path = public, app, pg_temp as $$
declare v_person uuid := coalesce(p_person, app.me()); v_row public.collection_entries;
begin
  if app.me() is null then raise exception 'Not signed in' using errcode = '28000'; end if;
  if not app.can_record_collections(v_person, p_collection_date) then
    raise exception 'You can only record collections for yourself or your direct reports.' using errcode = '42501';
  end if;
  if v_person <> app.me() and coalesce(trim(p_reason),'') = '' then
    raise exception 'A reason is required when recording on behalf of someone.' using errcode = 'P0001';
  end if;
  if p_id is null then
    perform app.require_writable(v_person, p_collection_date, 'collections');
  end if;
  perform set_config('app.reason', coalesce(p_reason, ''), true);
  if p_id is null then
    insert into public.collection_entries(person_id, collection_date, client_id, location_id, branch_id,
           amount_received, amount_reconciled, reconciled_on, reference, remarks, source, entered_by)
    values (v_person, p_collection_date, p_client_id, p_location_id, p_branch_id, p_amount_received,
            coalesce(p_amount_reconciled,0), case when coalesce(p_amount_reconciled,0) > 0 then app.today() end,
            p_reference, p_remarks, case when v_person = app.me() then 'self' else 'on_behalf' end, app.me())
    returning * into v_row;
  else
    -- Reconciliation updates may happen after the day closes (separate reconciliation date), audited.
    update public.collection_entries
       set amount_reconciled = coalesce(p_amount_reconciled, amount_reconciled),
           reconciled_on = case when p_amount_reconciled is distinct from amount_reconciled then app.today() else reconciled_on end,
           remarks = coalesce(p_remarks, remarks), reference = coalesce(p_reference, reference)
     where id = p_id and (app.can_record_collections(person_id, collection_date) or app.has_role('collections_head'))
    returning * into v_row;
    if v_row.id is null then raise exception 'Not found or not permitted.' using errcode = '42501'; end if;
  end if;
  return v_row;
end $$;

create or replace function public.save_bill(p_bill_date date, p_client_id uuid, p_bill_count int, p_bill_amount numeric,
    p_location_id uuid default null, p_branch_id uuid default null, p_reference text default null,
    p_period_from date default null, p_period_to date default null, p_remarks text default null,
    p_person uuid default null, p_reason text default null)
returns public.bill_entries
language plpgsql security definer set search_path = public, app, pg_temp as $$
declare v_person uuid := coalesce(p_person, app.me()); v_row public.bill_entries;
begin
  if app.me() is null then raise exception 'Not signed in' using errcode = '28000'; end if;
  if not app.can_record_collections(v_person, p_bill_date) then
    raise exception 'You can only record bills for yourself or your direct reports.' using errcode = '42501';
  end if;
  if v_person <> app.me() and coalesce(trim(p_reason),'') = '' then
    raise exception 'A reason is required when recording on behalf of someone.' using errcode = 'P0001';
  end if;
  perform app.require_writable(v_person, p_bill_date, 'collections');
  perform set_config('app.reason', coalesce(p_reason, ''), true);
  insert into public.bill_entries(person_id, bill_date, client_id, location_id, branch_id, bill_count, bill_amount,
         period_from, period_to, reference, remarks, source, entered_by)
  values (v_person, p_bill_date, p_client_id, p_location_id, p_branch_id, p_bill_count, p_bill_amount,
          p_period_from, p_period_to, p_reference, p_remarks,
          case when v_person = app.me() then 'self' else 'on_behalf' end, app.me())
  returning * into v_row;
  return v_row;
end $$;

create or replace view public.v_collections with (security_invoker = true) as
select c.*, c.amount_received - c.amount_reconciled as unreconciled, bz.zone_id
  from public.collection_entries c
  left join public.branch_zones bz on bz.branch_id = c.branch_id and bz.valid @> c.collection_date;
