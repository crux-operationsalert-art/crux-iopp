-- Milestone 8 (owner feedback 03-Nov, 21:36):
--  * Collections as the owner specified:
--      monthly, per client: accounts receivable by age (< 30 days, 30–90 days, 3–6 months, > 6 months), entered by the
--        location head; the Collections Head / Operations Head / Admin can dispute and change it (original kept, head sees it);
--      monthly collection target per location × client, set by managers (read-only for the head);
--      daily, per client: bills raised (count + value), amount received and reconciled by the same age buckets;
--        month-to-date sums, balance against receivables and achievement against target are calculated.
--  * My day shows the target assigned by the manager next to each operations row (read only).
--  * Leave policy tables (monthly credits per leave type) and national / regional holidays, kept empty until a policy is given.

-- ------------------------------------------------------------------ monthly receivables
create table if not exists public.collection_ar (
  id uuid primary key default gen_random_uuid(),
  month date not null check (extract(day from month) = 1),
  branch_id uuid not null references public.branches(id),
  client_id uuid not null references public.clients(id),
  ar_lt30 numeric(16,2) not null check (ar_lt30 >= 0),
  ar_30_90 numeric(16,2) not null check (ar_30_90 >= 0),
  ar_90_180 numeric(16,2) not null check (ar_90_180 >= 0),
  ar_gt180 numeric(16,2) not null check (ar_gt180 >= 0),
  status text not null default 'entered' check (status in ('entered', 'revised')),
  original jsonb,                       -- the head's figures, kept when a reviewer changes them
  review_note text,
  entered_by uuid references public.persons(id),
  entered_at timestamptz not null default now(),
  reviewed_by uuid references public.persons(id),
  reviewed_at timestamptz,
  unique (month, branch_id, client_id)
);
alter table public.collection_ar enable row level security;
create policy read_collection_ar on public.collection_ar for select to authenticated
  using (app.is_admin() or app.has_role('auditor') or app.has_role('ops_head') or app.has_role('collections_head')
         or branch_id in (select * from app.visible_branches(app.today())));
grant select on public.collection_ar to authenticated;
create trigger audit_collection_ar after insert or update on public.collection_ar for each row execute function app.audit();

-- ------------------------------------------------------------------ daily: bucket-wise received / reconciled
alter table public.collection_daily
  add column if not exists rcv_lt30 numeric(14,2) not null default 0 check (rcv_lt30 >= 0),
  add column if not exists rcv_30_90 numeric(14,2) not null default 0 check (rcv_30_90 >= 0),
  add column if not exists rcv_90_180 numeric(14,2) not null default 0 check (rcv_90_180 >= 0),
  add column if not exists rcv_gt180 numeric(14,2) not null default 0 check (rcv_gt180 >= 0),
  add column if not exists rec_lt30 numeric(14,2) not null default 0 check (rec_lt30 >= 0),
  add column if not exists rec_30_90 numeric(14,2) not null default 0 check (rec_30_90 >= 0),
  add column if not exists rec_90_180 numeric(14,2) not null default 0 check (rec_90_180 >= 0),
  add column if not exists rec_gt180 numeric(14,2) not null default 0 check (rec_gt180 >= 0);
alter table public.collection_daily alter column followups set default 0, alter column promised_amount set default 0,
  alter column out_0_30 set default 0, alter column out_31_60 set default 0, alter column out_61_90 set default 0, alter column out_90p set default 0;

create or replace function app.can_review_ar() returns boolean
language sql stable security definer set search_path = public, app, pg_temp as $$
  select app.is_admin() or app.has_role('ops_head') or app.has_role('collections_head')
$$;

-- Daily collections count as complete only when the month's receivables are entered and today's row is saved.
create or replace function app.collections_incomplete(p_person uuid, p_date date) returns boolean
language sql stable security definer set search_path = public, app, pg_temp as $$
  select exists (select 1 from app.money_pairs(p_person, p_date) k
                  where not exists (select 1 from public.collection_daily d where d.person_id = p_person and d.entry_date = p_date
                                     and d.branch_id = k.branch_id and d.client_id = k.client_id)
                     or not exists (select 1 from public.collection_ar a where a.month = date_trunc('month', p_date)::date
                                     and a.branch_id = k.branch_id and a.client_id = k.client_id))
$$;

-- Everything My day needs for collections: per client the day's entry, the month's receivables, the target and the sums.
create or replace function public.my_collection_day(p_date date default null) returns jsonb
language sql stable security definer set search_path = public, app, pg_temp as $$
  with d0 as (select coalesce(p_date, app.today()) d), m0 as (select date_trunc('month', (select d from d0))::date m),
  k as (select * from app.money_pairs(app.me(), (select d from d0))),
  mtd as (select x.branch_id, x.client_id, sum(x.bill_count) bc, sum(x.bill_amount) ba,
                 sum(x.rcv_lt30) r1, sum(x.rcv_30_90) r2, sum(x.rcv_90_180) r3, sum(x.rcv_gt180) r4,
                 sum(x.rec_lt30) c1, sum(x.rec_30_90) c2, sum(x.rec_90_180) c3, sum(x.rec_gt180) c4
            from public.collection_daily x where x.entry_date between (select m from m0) and (select d from d0) group by 1, 2)
  select coalesce(jsonb_agg(jsonb_build_object(
    'branch_id', k.branch_id, 'branch', b.name, 'client_id', k.client_id, 'client', c.name,
    'day', (select jsonb_build_object('bill_count', x.bill_count, 'bill_amount', x.bill_amount,
              'rcv_lt30', x.rcv_lt30, 'rcv_30_90', x.rcv_30_90, 'rcv_90_180', x.rcv_90_180, 'rcv_gt180', x.rcv_gt180,
              'rec_lt30', x.rec_lt30, 'rec_30_90', x.rec_30_90, 'rec_90_180', x.rec_90_180, 'rec_gt180', x.rec_gt180)
              from public.collection_daily x where x.person_id = app.me() and x.entry_date = (select d from d0)
               and x.branch_id = k.branch_id and x.client_id = k.client_id),
    'ar', (select to_jsonb(a) - 'id' from public.collection_ar a where a.month = (select m from m0) and a.branch_id = k.branch_id and a.client_id = k.client_id),
    'target', (select t.amount from public.target_allocations t where t.is_current and t.month = (select m from m0) and t.metric = 'collections_received'
                and t.level = 'branch' and t.branch_id = k.branch_id and t.client_id = k.client_id),
    'mtd', (select to_jsonb(mt) - 'branch_id' - 'client_id' from mtd mt where mt.branch_id = k.branch_id and mt.client_id = k.client_id))
    order by b.name, c.name), '[]')
  from k join public.branches b on b.id = k.branch_id join public.clients c on c.id = k.client_id
$$;

-- Clients at my locations whose collections someone else reports (shown as a note in My day).
create or replace function public.collections_reported_by_others(p_date date default null) returns jsonb
language sql stable security definer set search_path = public, app, pg_temp as $$
  select coalesce(jsonb_agg(distinct jsonb_build_object('branch', b.name, 'client', c.name,
           'by', (select p.full_name from public.persons p where p.id = coalesce(app.head_of(cl.branch_id, cl.client_id, 'branch_head', coalesce(p_date, app.today())),
                                                                              app.head_of(cl.branch_id, cl.client_id, 'zonal_manager', coalesce(p_date, app.today())))))), '[]')
    from public.allocations a join public.client_locations cl on cl.id = a.client_location_id
    join public.branches b on b.id = cl.branch_id join public.clients c on c.id = cl.client_id
   where a.person_id = app.me() and a.valid @> coalesce(p_date, app.today())
     and not exists (select 1 from app.money_pairs(app.me(), coalesce(p_date, app.today())) k where k.branch_id = cl.branch_id and k.client_id = cl.client_id)
$$;

create or replace function public.save_ar(p_month date, p_rows jsonb) returns int
language plpgsql security definer set search_path = public, app, pg_temp as $$
declare r jsonb; v_m date := date_trunc('month', p_month)::date; n int := 0; f text;
begin
  if app.me() is null then raise exception 'Not signed in' using errcode = '28000'; end if;
  perform set_config('app.reason', 'monthly receivables', true);
  for r in select * from jsonb_array_elements(coalesce(p_rows, '[]')) loop
    if not exists (select 1 from app.money_pairs(app.me(), greatest(v_m, least(app.today(), (v_m + interval '1 month - 1 day')::date))) k
                    where k.branch_id = (r->>'branch_id')::uuid and k.client_id = (r->>'client_id')::uuid) and not app.can_review_ar() then
      raise exception 'You do not report collections for that client at that location.' using errcode = '42501';
    end if;
    foreach f in array array['ar_lt30','ar_30_90','ar_90_180','ar_gt180'] loop
      if r->>f is null or r->>f = '' then raise exception 'All four receivable buckets are required (enter 0 if none).' using errcode = 'P0001'; end if;
    end loop;
    if exists (select 1 from public.collection_ar a where a.month = v_m and a.branch_id = (r->>'branch_id')::uuid and a.client_id = (r->>'client_id')::uuid and a.status = 'revised')
       and not app.can_review_ar() then
      raise exception 'This month''s receivables were revised by the Collections Head; ask them to change it.' using errcode = 'P0001';
    end if;
    insert into public.collection_ar as a (month, branch_id, client_id, ar_lt30, ar_30_90, ar_90_180, ar_gt180, entered_by)
    values (v_m, (r->>'branch_id')::uuid, (r->>'client_id')::uuid, (r->>'ar_lt30')::numeric, (r->>'ar_30_90')::numeric, (r->>'ar_90_180')::numeric, (r->>'ar_gt180')::numeric, app.me())
    on conflict (month, branch_id, client_id) do update set ar_lt30 = excluded.ar_lt30, ar_30_90 = excluded.ar_30_90, ar_90_180 = excluded.ar_90_180,
      ar_gt180 = excluded.ar_gt180, entered_by = excluded.entered_by, entered_at = now();
    n := n + 1;
  end loop;
  return n;
end $$;

-- Collections Head / Operations Head / Admin dispute and change a head's receivables; the original stays visible.
create or replace function public.review_ar(p_month date, p_branch uuid, p_client uuid, p_values jsonb, p_note text) returns public.collection_ar
language plpgsql security definer set search_path = public, app, pg_temp as $$
declare a public.collection_ar; v_m date := date_trunc('month', p_month)::date;
begin
  if not app.can_review_ar() then raise exception 'Only the Collections Head, Operations Head or Admin can change receivables.' using errcode = '42501'; end if;
  if coalesce(trim(p_note), '') = '' then raise exception 'Say why the figures are changed.' using errcode = 'P0001'; end if;
  perform set_config('app.reason', p_note, true);
  select * into a from public.collection_ar where month = v_m and branch_id = p_branch and client_id = p_client;
  if a.id is null then
    insert into public.collection_ar(month, branch_id, client_id, ar_lt30, ar_30_90, ar_90_180, ar_gt180, status, review_note, entered_by, reviewed_by, reviewed_at)
    values (v_m, p_branch, p_client, (p_values->>'ar_lt30')::numeric, (p_values->>'ar_30_90')::numeric, (p_values->>'ar_90_180')::numeric, (p_values->>'ar_gt180')::numeric,
            'revised', p_note, app.me(), app.me(), now()) returning * into a;
  else
    update public.collection_ar set original = coalesce(original, jsonb_build_object('ar_lt30', ar_lt30, 'ar_30_90', ar_30_90, 'ar_90_180', ar_90_180, 'ar_gt180', ar_gt180, 'entered_by', entered_by)),
      ar_lt30 = (p_values->>'ar_lt30')::numeric, ar_30_90 = (p_values->>'ar_30_90')::numeric, ar_90_180 = (p_values->>'ar_90_180')::numeric,
      ar_gt180 = (p_values->>'ar_gt180')::numeric, status = 'revised', review_note = p_note, reviewed_by = app.me(), reviewed_at = now()
     where id = a.id returning * into a;
    insert into public.notifications(person_id, kind, message, link)
    select a.entered_by, 'collections', 'Receivables for ' || (select name from public.clients where id = p_client) || ' · ' || (select name from public.branches where id = p_branch)
           || ' were changed by ' || (select full_name from public.persons where id = app.me()) || ': ' || p_note, '/productivity'
     where a.entered_by is not null and a.entered_by <> app.me();
  end if;
  return a;
end $$;

create or replace function public.save_collection_day(p_date date, p_rows jsonb) returns int
language plpgsql security definer set search_path = public, app, pg_temp as $$
declare r jsonb; v_me uuid := app.me(); n int := 0; v_b uuid; v_c uuid; f text; v_rcv numeric; v_rec numeric;
  req text[] := array['bill_count','bill_amount','rcv_lt30','rcv_30_90','rcv_90_180','rcv_gt180','rec_lt30','rec_30_90','rec_90_180','rec_gt180'];
begin
  if v_me is null then raise exception 'Not signed in' using errcode = '28000'; end if;
  perform app.require_writable(v_me, p_date, 'operations');
  perform set_config('app.reason', 'daily collections', true);
  for r in select * from jsonb_array_elements(coalesce(p_rows, '[]')) loop
    v_b := (r->>'branch_id')::uuid; v_c := (r->>'client_id')::uuid;
    if not exists (select 1 from app.money_pairs(v_me, p_date) k where k.branch_id = v_b and k.client_id = v_c) then
      raise exception 'You do not report collections for that client at that location.' using errcode = '42501';
    end if;
    foreach f in array req loop
      if r->>f is null or r->>f = '' then raise exception 'Every collections box is required (enter 0 if none): %', replace(f, '_', ' ') using errcode = 'P0001'; end if;
    end loop;
    v_rcv := (r->>'rcv_lt30')::numeric + (r->>'rcv_30_90')::numeric + (r->>'rcv_90_180')::numeric + (r->>'rcv_gt180')::numeric;
    v_rec := (r->>'rec_lt30')::numeric + (r->>'rec_30_90')::numeric + (r->>'rec_90_180')::numeric + (r->>'rec_gt180')::numeric;
    insert into public.collection_daily as d (person_id, entry_date, branch_id, client_id, bill_count, bill_amount, received, reconciled,
      rcv_lt30, rcv_30_90, rcv_90_180, rcv_gt180, rec_lt30, rec_30_90, rec_90_180, rec_gt180, entered_by)
    values (v_me, p_date, v_b, v_c, (r->>'bill_count')::int, (r->>'bill_amount')::numeric, v_rcv, v_rec,
      (r->>'rcv_lt30')::numeric, (r->>'rcv_30_90')::numeric, (r->>'rcv_90_180')::numeric, (r->>'rcv_gt180')::numeric,
      (r->>'rec_lt30')::numeric, (r->>'rec_30_90')::numeric, (r->>'rec_90_180')::numeric, (r->>'rec_gt180')::numeric, v_me)
    on conflict (person_id, entry_date, branch_id, client_id) do update set bill_count = excluded.bill_count, bill_amount = excluded.bill_amount,
      received = excluded.received, reconciled = excluded.reconciled, rcv_lt30 = excluded.rcv_lt30, rcv_30_90 = excluded.rcv_30_90,
      rcv_90_180 = excluded.rcv_90_180, rcv_gt180 = excluded.rcv_gt180, rec_lt30 = excluded.rec_lt30, rec_30_90 = excluded.rec_30_90,
      rec_90_180 = excluded.rec_90_180, rec_gt180 = excluded.rec_gt180, updated_at = now();
    update public.bill_entries set bill_count = (r->>'bill_count')::int, bill_amount = (r->>'bill_amount')::numeric
     where person_id = v_me and bill_date = p_date and branch_id = v_b and client_id = v_c and reference = 'daily';
    if not found then
      insert into public.bill_entries(person_id, bill_date, client_id, branch_id, bill_count, bill_amount, reference, entered_by)
      values (v_me, p_date, v_c, v_b, (r->>'bill_count')::int, (r->>'bill_amount')::numeric, 'daily', v_me);
    end if;
    update public.collection_entries set amount_received = v_rcv, amount_reconciled = v_rec
     where person_id = v_me and collection_date = p_date and branch_id = v_b and client_id = v_c and reference = 'daily';
    if not found then
      insert into public.collection_entries(person_id, collection_date, client_id, branch_id, amount_received, amount_reconciled, reference, source, entered_by)
      values (v_me, p_date, v_c, v_b, v_rcv, v_rec, 'daily', 'self', v_me);
    end if;
    n := n + 1;
  end loop;
  return n;
end $$;

-- Collections next to operations performance, for everyone in their scope (Collections Head / Ops Head / leadership: all).
create or replace function public.collections_view(p_month date default null) returns jsonb
language plpgsql stable security definer set search_path = public, app, pg_temp as $$
declare v_m date := date_trunc('month', coalesce(p_month, app.today()))::date; v_e date; v_all boolean;
begin
  if app.me() is null then raise exception 'Not signed in' using errcode = '28000'; end if;
  v_e := least((v_m + interval '1 month - 1 day')::date, app.today());
  v_all := app.is_admin() or app.has_role('auditor') or app.has_role('ops_head') or app.has_role('collections_head');
  return (
  with vis as (select b.id from public.branches b where v_all union select * from app.visible_branches(v_e) where not v_all),
  pairs as (select branch_id, client_id from public.collection_ar where month = v_m
            union select branch_id, client_id from public.collection_daily where entry_date between v_m and v_e
            union select branch_id, client_id from public.target_allocations where is_current and month = v_m and metric = 'collections_received' and level = 'branch' and client_id is not null),
  mtd as (select x.branch_id, x.client_id, sum(x.bill_count) bc, sum(x.bill_amount) ba, sum(x.rcv_lt30) r1, sum(x.rcv_30_90) r2, sum(x.rcv_90_180) r3, sum(x.rcv_gt180) r4,
                 sum(x.rec_lt30) c1, sum(x.rec_30_90) c2, sum(x.rec_90_180) c3, sum(x.rec_gt180) c4, count(distinct x.entry_date) days
            from public.collection_daily x where x.entry_date between v_m and v_e group by 1, 2),
  cases as (select l.branch_id, l.client_id, sum(l.entry - l.cancelled) n from public.v_line_metrics l where l.work_date between v_m and v_e group by 1, 2)
  select jsonb_build_object('month', v_m, 'as_of', v_e, 'can_review', app.can_review_ar(),
    'rows', (select coalesce(jsonb_agg(jsonb_build_object(
        'branch_id', k.branch_id, 'client_id', k.client_id, 'location', b.name, 'client', c.name, 'zone', z.name,
        'head', (select p.full_name from public.persons p where p.id = coalesce(app.head_of(k.branch_id, k.client_id, 'branch_head', v_e), app.head_of(k.branch_id, k.client_id, 'zonal_manager', v_e))),
        'ar', (select to_jsonb(a) - 'id' || jsonb_build_object('reviewer', (select full_name from public.persons where id = a.reviewed_by))
                 from public.collection_ar a where a.month = v_m and a.branch_id = k.branch_id and a.client_id = k.client_id),
        'target', (select t.amount from public.target_allocations t where t.is_current and t.month = v_m and t.metric = 'collections_received'
                    and t.level = 'branch' and t.branch_id = k.branch_id and t.client_id = k.client_id),
        'mtd', (select to_jsonb(m) - 'branch_id' - 'client_id' from mtd m where m.branch_id = k.branch_id and m.client_id = k.client_id),
        'cases', coalesce((select n from cases cs where cs.branch_id = k.branch_id and cs.client_id = k.client_id), 0))
        order by z.name nulls last, b.name, c.name), '[]')
      from pairs k join public.branches b on b.id = k.branch_id join public.clients c on c.id = k.client_id
      left join public.branch_zones bz on bz.branch_id = b.id and bz.valid @> v_e left join public.zones z on z.id = bz.zone_id
     where k.branch_id in (select id from vis))));
end $$;

-- ------------------------------------------------------------------ My day: target assigned by the manager, read only
create or replace function public.my_targets(p_date date default null) returns jsonb
language sql stable security definer set search_path = public, app, pg_temp as $$
  with d0 as (select coalesce(p_date, app.today()) d), m0 as (select date_trunc('month', (select d from d0))::date m),
  rows as (select cl.id cl, cl.branch_id, cl.client_id from public.allocations a join public.client_locations cl on cl.id = a.client_location_id
            where a.person_id = app.me() and a.valid @> (select d from d0))
  select jsonb_build_object(
    'wd_done', app.working_days_between((select m from m0), (select d from d0)),
    'wd_total', app.working_days_between((select m from m0), ((select m from m0) + interval '1 month - 1 day')::date),
    'person_total', (select jsonb_build_object('metric', t.metric, 'amount', t.amount, 'by', (select full_name from public.persons where id = t.set_by))
                       from public.target_allocations t where t.is_current and t.month = (select m from m0) and t.level = 'person' and t.person_id = app.me()
                        and t.client_id is null and t.metric in ('entry', 'net_actioned', 'closure') order by t.created_at desc limit 1),
    'my_mtd', (select jsonb_build_object('entry', coalesce(sum(l.entry), 0), 'closure', coalesce(sum(l.closure), 0), 'cancelled', coalesce(sum(l.cancelled), 0))
                 from public.productivity_lines l where l.person_id = app.me() and l.work_date between (select m from m0) and (select d from d0)),
    'rows', (select coalesce(jsonb_agg(jsonb_build_object('client_location_id', r.cl,
        'mine', (select jsonb_build_object('metric', t.metric, 'amount', t.amount, 'by', (select full_name from public.persons where id = t.set_by))
                   from public.target_allocations t where t.is_current and t.month = (select m from m0) and t.level = 'person' and t.person_id = app.me()
                    and t.client_id = r.client_id and t.metric in ('entry', 'net_actioned', 'closure') order by t.created_at desc limit 1),
        'location', (select t.amount from public.target_allocations t where t.is_current and t.month = (select m from m0) and t.metric = 'entry'
                       and t.level = 'branch' and t.branch_id = r.branch_id and t.client_id = r.client_id),
        'my_mtd', (select jsonb_build_object('entry', coalesce(sum(l.entry), 0), 'closure', coalesce(sum(l.closure), 0), 'cancelled', coalesce(sum(l.cancelled), 0))
                     from public.productivity_lines l where l.person_id = app.me() and l.client_location_id = r.cl and l.work_date between (select m from m0) and (select d from d0)),
        'location_mtd', (select coalesce(sum(l.entry - l.cancelled), 0) from public.v_line_metrics l where l.branch_id = r.branch_id and l.client_id = r.client_id
                          and l.work_date between (select m from m0) and (select d from d0)))), '[]') from rows r))
$$;

-- My day's collections block now uses the monthly + daily model.
do $do$
declare d text;
begin
  d := pg_get_functiondef('public.my_day(date)'::regprocedure);
  d := replace(d, $r$'money', (select coalesce(jsonb_agg(to_jsonb(m)), '[]') from public.my_collection_rows(v_d) m),$r$,
                  $r$'money', public.my_collection_day(v_d), 'money_others', public.collections_reported_by_others(v_d),$r$);
  if position('my_collection_day' in d) = 0 then raise exception 'my_day: money block not found'; end if;
  execute d;
  d := pg_get_functiondef('public.submit_day(date,uuid,text)'::regprocedure);
  d := replace(d, $r$(bills raised, received, reconciled, follow-ups, promises and outstanding by age; 0 if none)$r$,
                  $r$(this month''s receivables by age, then today''s bills raised and amounts received / reconciled by age; 0 if none)$r$);
  execute d;
end $do$;

-- ------------------------------------------------------------------ leave policy (empty until the owner sets it)
create table if not exists public.leave_types (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  monthly_credit numeric(5,2) not null default 0 check (monthly_credit >= 0),
  max_per_year numeric(6,2),
  carry_forward_max numeric(6,2),
  applies_to text not null default 'all' check (applies_to in ('all', 'own_employee', 'partner')),
  active boolean not null default true,
  created_at timestamptz not null default now()
);
alter table public.leave_types enable row level security;
create policy read_leave_types on public.leave_types for select to authenticated using (true);
create policy admin_write_leave_types on public.leave_types for all to authenticated using (app.is_admin() or app.has_role('hr_admin')) with check (app.is_admin() or app.has_role('hr_admin'));
grant select, insert, update on public.leave_types to authenticated;
create trigger audit_leave_types after insert or update on public.leave_types for each row execute function app.audit();

do $do$ begin
  if not exists (select 1 from pg_policy where polrelid = 'public.holidays'::regclass and polname = 'hr_write_holidays') then
    create policy hr_write_holidays on public.holidays for all to authenticated using (app.is_admin() or app.has_role('hr_admin')) with check (app.is_admin() or app.has_role('hr_admin'));
  end if;
end $do$;
grant select, insert, update on public.holidays to authenticated;

-- ------------------------------------------------------------------ grants
revoke all on function public.my_collection_day(date), public.collections_reported_by_others(date), public.save_ar(date, jsonb),
  public.review_ar(date, uuid, uuid, jsonb, text), public.collections_view(date), public.my_targets(date) from public, anon;
grant execute on function public.my_collection_day(date), public.collections_reported_by_others(date), public.save_ar(date, jsonb),
  public.review_ar(date, uuid, uuid, jsonb, text), public.collections_view(date), public.my_targets(date) to authenticated;
grant execute on function app.can_review_ar() to authenticated;
