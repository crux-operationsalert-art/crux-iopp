-- Milestone 6 (owner feedback 03-Nov evening):
--  * Leadership (Chairman / MD): read access to the whole business, both functions. Collections-only people do not see operations figures.
--  * Daily collections entry by location heads: bills raised, received, reconciled, follow-ups, promises, outstanding by age.
--  * Reopen many people / locations / dates at once.
--  * Role-based Zonal Tracker export (full / zonal manager / team / own), history never re-attributed to today's heads.
--  * Month close with checklist, full backup export, attrition, leave taken, record-only missed-report penalty, scheduled task sync.

-- ------------------------------------------------------------------ roles
create or replace function app.has_role(p_role app.role_code, p_date date default null) returns boolean
language sql stable security definer set search_path = public, app, pg_temp as $$
  select exists (select 1 from public.role_assignments r
                  where r.person_id = app.me()
                    and (r.role = p_role or (p_role = 'auditor' and r.role::text = 'leadership'))
                    and r.valid @> coalesce(p_date, app.today()))
$$;

-- People whose only senior role is Collections Head see collections, not operations figures.
create or replace function app.ops_blind() returns boolean
language sql stable security definer set search_path = public, app, pg_temp as $$
  select app.has_role('collections_head')
     and not exists (select 1 from public.role_assignments r where r.person_id = app.me() and r.valid @> app.today()
                      and r.role::text in ('admin','auditor','leadership','ops_head','zm','bm','ba','manager','executive'))
$$;

create or replace function app.require_ops_view() returns void
language plpgsql stable security definer set search_path = public, app, pg_temp as $$
begin
  if app.me() is null then raise exception 'Not signed in' using errcode = '28000'; end if;
  if app.ops_blind() then raise exception 'Operations figures are not part of your access (collections only).' using errcode = '42501'; end if;
end $$;

-- ------------------------------------------------------------------ collections: daily entry by location heads
create table if not exists public.collection_daily (
  id uuid primary key default gen_random_uuid(),
  person_id uuid not null references public.persons(id),
  entry_date date not null,
  branch_id uuid not null references public.branches(id),
  client_id uuid not null references public.clients(id),
  bill_count int not null check (bill_count >= 0),
  bill_amount numeric(14,2) not null check (bill_amount >= 0),
  bill_ref text,
  received numeric(14,2) not null check (received >= 0),
  reconciled numeric(14,2) not null check (reconciled >= 0),
  followups int not null check (followups >= 0),
  promised_amount numeric(14,2) not null check (promised_amount >= 0),
  promised_date date,
  out_0_30 numeric(14,2) not null check (out_0_30 >= 0),
  out_31_60 numeric(14,2) not null check (out_31_60 >= 0),
  out_61_90 numeric(14,2) not null check (out_61_90 >= 0),
  out_90p numeric(14,2) not null check (out_90p >= 0),
  note text,
  entered_by uuid references public.persons(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (person_id, entry_date, branch_id, client_id),
  check (promised_amount = 0 or promised_date is not null),
  check (bill_count = 0 or coalesce(trim(bill_ref), '') <> '')
);
create index if not exists collection_daily_date on public.collection_daily(entry_date, branch_id, client_id);
alter table public.collection_daily enable row level security;
create policy read_collection_daily on public.collection_daily for select to authenticated
  using (app.can_view_person(person_id, entry_date, 'collections') or app.can_view_person(person_id, entry_date, 'operations')
         or app.has_role('collections_head') or app.has_role('auditor') or app.has_role('ops_head') or app.is_admin());
create trigger audit_collection_daily after insert or update on public.collection_daily for each row execute function app.audit();

-- Which (location, client) pairs a person reports collections for on a day: the Branch Manager / BA heading it;
-- where no branch head exists for the pair, the Zonal Manager.
create or replace function app.money_pairs(p_person uuid, p_date date)
returns table(branch_id uuid, client_id uuid)
language sql stable security definer set search_path = public, app, pg_temp as $$
  with svc as (select distinct cl.branch_id, cl.client_id from public.client_locations cl where cl.valid @> p_date),
  own as (
    select s.branch_id, s.client_id,
           app.head_of(s.branch_id, s.client_id, 'branch_head', p_date) bh,
           app.head_of(s.branch_id, s.client_id, 'zonal_manager', p_date) zm
      from svc s)
  select o.branch_id, o.client_id from own o
   where o.bh = p_person or (o.bh is null and o.zm = p_person)
$$;

create or replace function public.my_collection_rows(p_date date default null)
returns table(branch_id uuid, branch text, client_id uuid, client text, bill_count int, bill_amount numeric, bill_ref text,
              received numeric, reconciled numeric, followups int, promised_amount numeric, promised_date date,
              out_0_30 numeric, out_31_60 numeric, out_61_90 numeric, out_90p numeric, note text,
              prev_outstanding numeric)
language sql stable security definer set search_path = public, app, pg_temp as $$
  select k.branch_id, b.name, k.client_id, c.name, d.bill_count, d.bill_amount, d.bill_ref, d.received, d.reconciled, d.followups,
         d.promised_amount, d.promised_date, d.out_0_30, d.out_31_60, d.out_61_90, d.out_90p, d.note,
         (select p.out_0_30 + p.out_31_60 + p.out_61_90 + p.out_90p from public.collection_daily p
           where p.branch_id = k.branch_id and p.client_id = k.client_id and p.entry_date < coalesce(p_date, app.today())
           order by p.entry_date desc limit 1)
    from app.money_pairs(app.me(), coalesce(p_date, app.today())) k
    join public.branches b on b.id = k.branch_id join public.clients c on c.id = k.client_id
    left join public.collection_daily d on d.person_id = app.me() and d.entry_date = coalesce(p_date, app.today())
                                       and d.branch_id = k.branch_id and d.client_id = k.client_id
   order by b.name, c.name
$$;

create or replace function app.collections_incomplete(p_person uuid, p_date date) returns boolean
language sql stable security definer set search_path = public, app, pg_temp as $$
  select exists (select 1 from app.money_pairs(p_person, p_date) k
                  where not exists (select 1 from public.collection_daily d where d.person_id = p_person and d.entry_date = p_date
                                     and d.branch_id = k.branch_id and d.client_id = k.client_id))
$$;

create or replace function public.save_collection_day(p_date date, p_rows jsonb) returns int
language plpgsql security definer set search_path = public, app, pg_temp as $$
declare r jsonb; v_me uuid := app.me(); n int := 0; v_b uuid; v_c uuid;
  f text; req text[] := array['bill_count','bill_amount','received','reconciled','followups','promised_amount','out_0_30','out_31_60','out_61_90','out_90p'];
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
      if r->>f is null or r->>f = '' then raise exception 'Every collections field is required (enter 0 if none): %', replace(f, '_', ' ') using errcode = 'P0001'; end if;
    end loop;
    if (r->>'bill_count')::int > 0 and coalesce(trim(r->>'bill_ref'), '') = '' then
      raise exception 'Enter the bill number(s) / period for the bills raised.' using errcode = 'P0001'; end if;
    if (r->>'promised_amount')::numeric > 0 and (r->>'promised_date') is null then
      raise exception 'Enter the date by which the promised amount will be paid.' using errcode = 'P0001'; end if;
    if (r->>'promised_date') is not null and (r->>'promised_date')::date < p_date then
      raise exception 'The promised date cannot be before the entry date.' using errcode = 'P0001'; end if;
    insert into public.collection_daily as d (person_id, entry_date, branch_id, client_id, bill_count, bill_amount, bill_ref, received, reconciled,
      followups, promised_amount, promised_date, out_0_30, out_31_60, out_61_90, out_90p, note, entered_by)
    values (v_me, p_date, v_b, v_c, (r->>'bill_count')::int, (r->>'bill_amount')::numeric, nullif(trim(r->>'bill_ref'), ''),
      (r->>'received')::numeric, (r->>'reconciled')::numeric, (r->>'followups')::int, (r->>'promised_amount')::numeric,
      nullif(r->>'promised_date', '')::date, (r->>'out_0_30')::numeric, (r->>'out_31_60')::numeric, (r->>'out_61_90')::numeric,
      (r->>'out_90p')::numeric, nullif(trim(r->>'note'), ''), v_me)
    on conflict (person_id, entry_date, branch_id, client_id) do update set
      bill_count = excluded.bill_count, bill_amount = excluded.bill_amount, bill_ref = excluded.bill_ref, received = excluded.received,
      reconciled = excluded.reconciled, followups = excluded.followups, promised_amount = excluded.promised_amount,
      promised_date = excluded.promised_date, out_0_30 = excluded.out_0_30, out_31_60 = excluded.out_31_60, out_61_90 = excluded.out_61_90,
      out_90p = excluded.out_90p, note = excluded.note, updated_at = now();
    -- keep the bills / collections ledgers (used by the collections reports) in step
    update public.bill_entries set bill_count = (r->>'bill_count')::int, bill_amount = (r->>'bill_amount')::numeric, remarks = nullif(trim(r->>'bill_ref'), '')
     where person_id = v_me and bill_date = p_date and branch_id = v_b and client_id = v_c and reference = 'daily';
    if not found then
      insert into public.bill_entries(person_id, bill_date, client_id, branch_id, bill_count, bill_amount, reference, remarks, entered_by)
      values (v_me, p_date, v_c, v_b, (r->>'bill_count')::int, (r->>'bill_amount')::numeric, 'daily', nullif(trim(r->>'bill_ref'), ''), v_me);
    end if;
    update public.collection_entries set amount_received = (r->>'received')::numeric, amount_reconciled = (r->>'reconciled')::numeric
     where person_id = v_me and collection_date = p_date and branch_id = v_b and client_id = v_c and reference = 'daily';
    if not found then
      insert into public.collection_entries(person_id, collection_date, client_id, branch_id, amount_received, amount_reconciled, reference, source, entered_by)
      values (v_me, p_date, v_c, v_b, (r->>'received')::numeric, (r->>'reconciled')::numeric, 'daily', 'self', v_me);
    end if;
    n := n + 1;
  end loop;
  return n;
end $$;

-- Collections view for the Collections Head, Operations Head, leadership and Admin (all locations), or a head's own scope.
create or replace function public.collections_board(p_from date, p_to date) returns jsonb
language plpgsql stable security definer set search_path = public, app, pg_temp as $$
declare v_all boolean;
begin
  if app.me() is null then raise exception 'Not signed in' using errcode = '28000'; end if;
  v_all := app.is_admin() or app.has_role('auditor') or app.has_role('ops_head') or app.has_role('collections_head');
  return (
  with vis as (select b.id from public.branches b where v_all union select * from app.visible_branches(p_to) where not v_all),
  d as (select x.* from public.collection_daily x where x.entry_date between p_from and p_to and x.branch_id in (select id from vis)),
  latest as (select distinct on (x.branch_id, x.client_id) x.branch_id, x.client_id, x.entry_date,
                    x.out_0_30, x.out_31_60, x.out_61_90, x.out_90p
               from public.collection_daily x where x.entry_date <= p_to and x.branch_id in (select id from vis)
              order by x.branch_id, x.client_id, x.entry_date desc),
  pairs as (select branch_id, client_id from d union select branch_id, client_id from latest)
  select jsonb_build_object(
    'from', p_from, 'to', p_to,
    'rows', (select coalesce(jsonb_agg(jsonb_build_object(
        'location', b.name, 'client', c.name, 'zone', z.name,
        'head', (select p.full_name from public.persons p where p.id = coalesce(app.head_of(k.branch_id, k.client_id, 'branch_head', p_to), app.head_of(k.branch_id, k.client_id, 'zonal_manager', p_to))),
        'bill_count', coalesce(s.bc, 0), 'bill_amount', coalesce(s.ba, 0), 'received', coalesce(s.rc, 0), 'reconciled', coalesce(s.rn, 0),
        'followups', coalesce(s.fu, 0), 'promised', coalesce(s.pa, 0), 'days', coalesce(s.days, 0),
        'out_0_30', l.out_0_30, 'out_31_60', l.out_31_60, 'out_61_90', l.out_61_90, 'out_90p', l.out_90p, 'as_of', l.entry_date)
        order by z.name nulls last, b.name, c.name), '[]')
      from pairs k join public.branches b on b.id = k.branch_id join public.clients c on c.id = k.client_id
      left join public.branch_zones bz on bz.branch_id = b.id and bz.valid @> p_to left join public.zones z on z.id = bz.zone_id
      left join (select branch_id, client_id, sum(bill_count) bc, sum(bill_amount) ba, sum(received) rc, sum(reconciled) rn, sum(followups) fu,
                        sum(promised_amount) pa, count(distinct entry_date) days from d group by 1, 2) s on s.branch_id = k.branch_id and s.client_id = k.client_id
      left join latest l on l.branch_id = k.branch_id and l.client_id = k.client_id),
    'daily', (select coalesce(jsonb_agg(x order by x.d), '[]') from (select entry_date d, sum(bill_amount) billed, sum(received) received, sum(reconciled) reconciled
                                                                         from d group by 1) x),
    'promises_due', (select coalesce(jsonb_agg(jsonb_build_object('date', x.promised_date, 'location', b.name, 'client', c.name, 'amount', x.promised_amount,
                                                                  'by', p.full_name, 'entered', x.entry_date) order by x.promised_date), '[]')
                       from public.collection_daily x join public.branches b on b.id = x.branch_id join public.clients c on c.id = x.client_id
                       join public.persons p on p.id = x.person_id
                      where x.promised_amount > 0 and x.promised_date between p_from and p_to + 14 and x.branch_id in (select id from vis)),
    'missing', (select coalesce(jsonb_agg(distinct jsonb_build_object('person', p.full_name, 'date', g.d::date)), '[]')
                  from generate_series(greatest(p_from, (app.setting('go_live_date') #>> '{}')::date), least(p_to, app.today() - 1), interval '1 day') g(d)
                  join public.persons p on p.status = 'active'
                 where app.is_working_day(g.d::date) and app.collections_incomplete(p.id, g.d::date)
                   and exists (select 1 from app.money_pairs(p.id, g.d::date) k where k.branch_id in (select id from vis)))));
end $$;

-- My day: daily collections rows; Submit: every collections row is required from the go-live date.
do $do$
declare d text;
begin
  d := pg_get_functiondef('public.my_day(date)'::regprocedure);
  d := replace(d, $r$'money', (select coalesce(jsonb_agg(to_jsonb(m)), '[]') from public.my_money_rows(v_d) m),$r$,
                  $r$'money', (select coalesce(jsonb_agg(to_jsonb(m)), '[]') from public.my_collection_rows(v_d) m),$r$);
  if position('my_collection_rows' in d) = 0 then raise exception 'my_day: money block not found'; end if;
  execute d;
  d := pg_get_functiondef('public.submit_day(date,uuid,text)'::regprocedure);
  d := replace(d, $r$exists (select 1 from public.my_money_rows(p_work_date) m where v_person = v_me and (m.bill_count is null or m.bill_amount is null or m.collected is null))$r$,
                  $r$v_person = v_me and app.collections_incomplete(v_me, p_work_date)$r$);
  d := replace(d, $r$Enter today''s bills raised and amount collected for each client you head (0 if none).$r$,
                  $r$Enter today''s collections for each client you head (bills raised, received, reconciled, follow-ups, promises and outstanding by age; 0 if none).$r$);
  if position('collections_incomplete' in d) = 0 then raise exception 'submit_day: money check not found'; end if;
  execute d;
end $do$;

-- ------------------------------------------------------------------ reopen many at once
create or replace function public.grant_reopen_many(p_persons uuid[], p_branches uuid[], p_from date, p_to date, p_reason text,
                                                    p_expires_at timestamptz, p_include_team boolean default false,
                                                    p_function app.fn default 'operations') returns jsonb
language plpgsql security definer set search_path = public, app, pg_temp as $$
declare v_people uuid[]; d date; p uuid; n int := 0;
begin
  if not app.is_admin() then raise exception 'Only an Admin can reopen.' using errcode = '42501'; end if;
  if p_from is null or p_to is null or p_to < p_from then raise exception 'Choose a valid date range.' using errcode = '22023'; end if;
  if p_to - p_from > 31 then raise exception 'Reopen at most 31 days at a time.' using errcode = '22023'; end if;
  select array_agg(distinct x) into v_people from (
    select unnest(coalesce(p_persons, '{}')) x
    union select a.person_id from public.allocations a join public.client_locations cl on cl.id = a.client_location_id
     where cl.branch_id = any(coalesce(p_branches, '{}')) and a.valid && daterange(p_from, p_to + 1)
    union select h.person_id from public.location_heads h
     where h.branch_id = any(coalesce(p_branches, '{}')) and h.valid && daterange(p_from, p_to + 1)) s where x is not null;
  if coalesce(array_length(v_people, 1), 0) = 0 then raise exception 'Choose at least one person or location.' using errcode = 'P0001'; end if;
  foreach p in array v_people loop
    for d in select g::date from generate_series(p_from, p_to, interval '1 day') g loop
      perform public.grant_reopen('submission', p, p_reason, p_expires_at, d, null, p_include_team, p_function);
      n := n + 1;
    end loop;
  end loop;
  return jsonb_build_object('people', array_length(v_people, 1), 'grants', n);
end $$;

-- ------------------------------------------------------------------ missed-report penalty: record only (no pay effect)
insert into public.penalty_rules(code, description, trigger_description, amount, financial_enabled, active)
select 'missed_report', 'Daily report not submitted', 'No daily figures by the reporting deadline (10:00 next day)', 5000, false, true
 where not exists (select 1 from public.penalty_rules where code = 'missed_report');

create or replace function app.penalty_on_miss() returns trigger
language plpgsql security definer set search_path = public, app, pg_temp as $$
declare v_rule uuid; v_by uuid;
begin
  if new.kind <> 'missed_submission' or new.subject_id is null or new.ref_date is null then return new; end if;
  select id into v_rule from public.penalty_rules where code = 'missed_report' and active;
  if v_rule is null then return new; end if;
  v_by := coalesce(app.manager_of(new.subject_id),
                   (select r.person_id from public.role_assignments r where r.role = 'admin' and r.valid @> app.today() order by r.created_at limit 1));
  if v_by is null then return new; end if;
  insert into public.penalty_ledger(person_id, rule_id, event_date, reason, amount, marked_by, payroll_effect)
  select new.subject_id, v_rule, new.ref_date, 'Automatic: ' || new.title, r.amount, v_by, false
    from public.penalty_rules r where r.id = v_rule
  on conflict (person_id, rule_id, event_date) do nothing;
  return new;
end $$;
create trigger trg_penalty_on_miss after insert on public.tasks for each row execute function app.penalty_on_miss();

-- ------------------------------------------------------------------ leave taken (no balances until a leave policy exists)
create or replace function public.leave_taken(p_year int, p_manager uuid default null)
returns table(person_id uuid, full_name text, month date, planned numeric, unplanned numeric, absent numeric, half_day numeric)
language plpgsql stable security definer set search_path = public, app, pg_temp as $$
declare v_me uuid := app.me(); v_from date := make_date(p_year, 1, 1); v_to date := least(make_date(p_year, 12, 31), app.today());
begin
  if v_me is null then raise exception 'Not signed in' using errcode = '28000'; end if;
  if p_manager is not null and p_manager <> v_me and not (app.is_admin() or app.has_role('hr_admin') or app.has_role('ops_head') or app.has_role('auditor'))
     and not exists (select 1 from app.subtree(v_me, 'operations', v_to) s where s.person_id = p_manager) then
    raise exception 'Not in your team.' using errcode = '42501';
  end if;
  return query
  with people as (select p.id, p.full_name from public.persons p
                   where case when p_manager is null then p.id = v_me
                              else p.id in (select s.person_id from app.subtree(p_manager, 'operations', v_to) s
                                            union select s.person_id from app.subtree(p_manager, 'collections', v_to) s) end),
  grid as (select pe.id, pe.full_name, g::date d, coalesce(a.status, app.auto_attendance(pe.id, g::date)) st
             from people pe cross join generate_series(v_from, v_to, interval '1 day') g
             left join public.attendance a on a.person_id = pe.id and a.work_date = g::date
            where app.is_working_day(g::date))
  select g.id, g.full_name, date_trunc('month', g.d)::date,
         count(*) filter (where g.st = 'planned_leave')::numeric, count(*) filter (where g.st = 'unplanned_leave')::numeric,
         count(*) filter (where g.st = 'absent')::numeric, count(*) filter (where g.st = 'half_day')::numeric
    from grid g group by 1, 2, 3 order by 2, 3;
end $$;

-- ------------------------------------------------------------------ attrition
create or replace function public.attrition(p_from date, p_to date)
returns table(month date, opening int, joined int, left_ int, closing int, attrition_pct numeric)
language plpgsql stable security definer set search_path = public, app, pg_temp as $$
begin
  if not (app.is_admin() or app.has_role('hr_admin') or app.has_role('ops_head') or app.has_role('auditor')) then
    raise exception 'Only Admin, HR, the Operations Head or leadership can see attrition.' using errcode = '42501';
  end if;
  return query
  with m as (select g::date mo from generate_series(date_trunc('month', p_from), date_trunc('month', p_to), interval '1 month') g),
  p as (select coalesce(joined_on, created_at::date) j, exited_on x from public.persons p0 where true
          and not exists (select 1 from public.role_assignments r where r.person_id = p0.id and r.role = 'admin'))
  select m.mo,
         (select count(*) from p where p.j < m.mo and (p.x is null or p.x >= m.mo))::int,
         (select count(*) from p where p.j >= m.mo and p.j < (m.mo + interval '1 month'))::int,
         (select count(*) from p where p.x >= m.mo and p.x < (m.mo + interval '1 month'))::int,
         (select count(*) from p where p.j < (m.mo + interval '1 month') and (p.x is null or p.x >= (m.mo + interval '1 month')))::int,
         case when (select count(*) from p where p.j < m.mo and (p.x is null or p.x >= m.mo)) > 0 then
           round((select count(*) from p where p.x >= m.mo and p.x < (m.mo + interval '1 month'))::numeric * 100
                 / (select count(*) from p where p.j < m.mo and (p.x is null or p.x >= m.mo)), 1) end
    from m order by m.mo;
end $$;

-- ------------------------------------------------------------------ month close
create or replace function public.month_close_check(p_month date) returns jsonb
language plpgsql stable security definer set search_path = public, app, pg_temp as $$
declare v_m date := date_trunc('month', p_month)::date; v_e date := (date_trunc('month', p_month) + interval '1 month - 1 day')::date;
begin
  if not (app.is_admin() or app.has_role('auditor') or app.has_role('ops_head')) then raise exception 'Not allowed.' using errcode = '42501'; end if;
  return jsonb_build_object(
    'month', v_m, 'closed', exists (select 1 from public.closed_periods c where c.month = v_m),
    'closed_info', (select to_jsonb(c) from public.closed_periods c where c.month = v_m),
    'open_misses', (select count(*) from public.tasks t where t.category = 'miss' and t.status <> 'resolved' and coalesce(t.ref_date, t.ref_month) between v_m and v_e),
    'missing_rates', (select count(*) from public.tasks t where t.kind = 'missing_rate' and t.status <> 'resolved'),
    'unsubmitted_days', (select count(*) from public.tasks t where t.kind = 'missed_submission' and t.status <> 'resolved' and t.ref_date between v_m and v_e),
    'uncertified', (select count(*) from public.tasks t where t.kind = 'uncertified_team' and t.status <> 'resolved' and t.ref_date between v_m and v_e),
    'collections_missing', (select count(*) from public.tasks t where t.kind = 'collections_missing' and t.status <> 'resolved' and t.ref_date between v_m and v_e),
    'open_reopens', (select count(*) from public.reopen_grants g where g.revoked_at is null and g.expires_at > app.clock() and g.work_date between v_m and v_e),
    'cases', (select coalesce(sum(l.entry - l.cancelled), 0) from public.productivity_lines l where l.work_date between v_m and v_e),
    'revenue', (select coalesce(sum(l.revenue), 0) from public.v_line_metrics l where l.work_date between v_m and v_e),
    'billed', (select coalesce(sum(d.bill_amount), 0) from public.collection_daily d where d.entry_date between v_m and v_e),
    'received', (select coalesce(sum(d.received), 0) from public.collection_daily d where d.entry_date between v_m and v_e));
end $$;

create or replace function public.close_month(p_month date, p_reason text) returns jsonb
language plpgsql security definer set search_path = public, app, pg_temp as $$
declare v_m date := date_trunc('month', p_month)::date;
begin
  if not app.is_admin() then raise exception 'Only an Admin can close a month.' using errcode = '42501'; end if;
  if v_m >= date_trunc('month', app.today())::date then raise exception 'Only a finished month can be closed.' using errcode = 'P0001'; end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'A note is required.' using errcode = 'P0001'; end if;
  perform set_config('app.reason', p_reason, true);
  insert into public.closed_periods(month, closed_by, reason) values (v_m, app.me(), p_reason) on conflict (month) do nothing;
  return public.month_close_check(v_m);
end $$;

-- ------------------------------------------------------------------ full backup (Admin), restorable into a fresh database
create or replace function public.admin_backup() returns jsonb
language plpgsql stable security definer set search_path = public, app, pg_temp as $$
declare t text; res jsonb := '{}'; v jsonb;
begin
  if not app.is_admin() then raise exception 'Only an Admin can download a backup.' using errcode = '42501'; end if;
  for t in select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
            where n.nspname = 'public' and c.relkind = 'r' and c.relname not in ('audit_events') order by c.relname loop
    execute format('select coalesce(jsonb_agg(to_jsonb(x)), ''[]'') from public.%I x', t) into v;
    res := res || jsonb_build_object(t, v);
  end loop;
  return jsonb_build_object('format', 'crux-iopp-backup-v1', 'taken_at', app.clock(), 'tables', res);
end $$;

-- ------------------------------------------------------------------ scheduled task sync (no sign-in needed)
do $do$
declare d text;
begin
  d := pg_get_functiondef('public.sync_tasks(boolean)'::regprocedure);
  d := replace(d, 'FUNCTION public.sync_tasks(', 'FUNCTION app.sync_core(');
  d := replace(d, $r$if app.me() is null then raise exception 'Not signed in' using errcode = '28000'; end if;$r$, '');
  if position('app.sync_core' in d) = 0 then raise exception 'sync_tasks not found'; end if;
  execute d;
end $do$;
create or replace function public.sync_tasks(p_force boolean default false) returns jsonb
language plpgsql security definer set search_path = public, app, pg_temp as $$
begin
  if app.me() is null then raise exception 'Not signed in' using errcode = '28000'; end if;
  return app.sync_core(p_force);
end $$;

-- Collections not reported by a head (from go-live) is a miss, like a missed daily report.
create or replace function app.sync_collections_misses() returns void
language plpgsql security definer set search_path = public, app, pg_temp as $$
declare d date; r record; v_live date := (app.setting('go_live_date') #>> '{}')::date;
begin
  for d in select g::date from generate_series(greatest(v_live, app.today() - 7), app.today() - 1, interval '1 day') g loop
    continue when not app.is_working_day(d) or app.window_state(d) <> 'closed';
    for r in select distinct p.id from public.persons p join public.location_heads h on h.person_id = p.id and h.valid @> d
              where p.status = 'active' and app.collections_incomplete(p.id, d) loop
      perform app.task_upsert('collections_missing', 'miss', 'collections_missing:' || r.id || ':' || d, r.id, r.id,
        'Collections not reported for ' || to_char(d, 'DD Mon YYYY'), jsonb_build_object('date', d), null, null, d, null);
    end loop;
  end loop;
end $$;
create or replace function app.sync_all() returns jsonb
language plpgsql security definer set search_path = public, app, pg_temp as $$
declare v jsonb;
begin
  v := app.sync_core(true);
  perform app.sync_collections_misses();
  return v;
end $$;

-- ------------------------------------------------------------------ performance dashboard v2
-- History stays with the person recorded in the source tracker; entered figures stay with the person who entered them.
create or replace function public.perf_dashboard(p_month date default null) returns jsonb
language plpgsql stable security definer set search_path = public, app, pg_temp as $$
declare v_m date := date_trunc('month', coalesce(p_month, app.today()))::date; v_today date := app.today();
begin
  perform app.require_ops_view();
  return (
  with vis as (select * from app.visible_branches(least(v_today, (v_m + interval '1 month - 1 day')::date)) b(id)),
  zm as (select distinct on (h.branch_id) h.branch_id, p.full_name from public.location_heads h join public.persons p on p.id = h.person_id
          where h.head_role = 'zonal_manager' and h.client_id is null and h.valid @> v_today order by h.branch_id, h.created_at desc),
  hist as (select m.month, m.branch_id, m.client_id, sum(m.target_cases) t, sum(m.actual_cases) a,
                  sum(m.revenue_target) rt, sum(m.actual_revenue) ra, sum(m.billing_amount) bill
             from public.tracker_monthly m where m.branch_id in (select id from vis) and m.month >= (v_m - interval '24 months')::date
            group by m.month, m.branch_id, m.client_id),
  tool as (select date_trunc('month', l.work_date)::date as month, l.branch_id, l.client_id, sum(l.entry - l.cancelled) a, sum(coalesce(l.revenue, 0)) ra
             from public.v_line_metrics l where l.branch_id in (select id from vis) and l.work_date >= (v_m - interval '24 months')::date and l.work_date <= v_today
            group by 1, 2, 3),
  bills as (select date_trunc('month', d.entry_date)::date as month, d.branch_id, d.client_id, sum(d.bill_amount) bill
              from public.collection_daily d where d.branch_id in (select id from vis) group by 1, 2, 3),
  tgt as (select t.month, t.branch_id, t.client_id, t.amount from public.target_allocations t
           where t.is_current and t.metric = 'entry' and t.level = 'branch' and t.branch_id in (select id from vis)),
  rate as (select distinct on (cl.branch_id, cl.client_id) cl.branch_id, cl.client_id, rc.rate from public.client_locations cl
             join public.rate_cards rc on rc.client_id = cl.client_id and rc.location_id = cl.location_id and rc.process_id = cl.process_id and rc.valid @> v_today
            order by cl.branch_id, cl.client_id, rc.rate desc),
  tmonths as (select distinct month from tool),
  months as (
    select coalesce(x.month, h.month) as month, coalesce(x.branch_id, h.branch_id) branch_id, coalesce(x.client_id, h.client_id) client_id,
           case when x.month is not null then 'app' else 'tracker' end src,
           coalesce(g.amount, h.t) t, coalesce(x.a, h.a) a, coalesce(g.amount * r.rate, h.rt) rt, coalesce(x.ra, h.ra) ra,
           coalesce(bl.bill, h.bill) bill
      from (select * from hist where month not in (select month from tmonths)) h
      full join tool x on x.month = h.month and x.branch_id = h.branch_id and x.client_id = h.client_id
      left join tgt g on g.month = coalesce(x.month, h.month) and g.branch_id = coalesce(x.branch_id, h.branch_id) and g.client_id = coalesce(x.client_id, h.client_id)
      left join rate r on r.branch_id = coalesce(x.branch_id, h.branch_id) and r.client_id = coalesce(x.client_id, h.client_id)
      left join bills bl on bl.month = coalesce(x.month, h.month) and bl.branch_id = coalesce(x.branch_id, h.branch_id) and bl.client_id = coalesce(x.client_id, h.client_id)
    union all  -- months with a target but no figures yet
    select g.month, g.branch_id, g.client_id, 'app', g.amount, null, g.amount * r.rate, null, null
      from tgt g left join rate r on r.branch_id = g.branch_id and r.client_id = g.client_id
     where g.month >= (v_m - interval '24 months')::date
       and not exists (select 1 from tool x where x.month = g.month and x.branch_id = g.branch_id and x.client_id = g.client_id)
       and not exists (select 1 from hist h where h.month = g.month and h.branch_id = g.branch_id and h.client_id = g.client_id and h.month not in (select month from tmonths))),
  people as (
    select m.month, m.head_name person, sum(m.actual_cases) cases, sum(m.actual_revenue) revenue
      from public.tracker_monthly m where m.branch_id in (select id from vis) and m.head_name is not null
       and m.month >= (v_m - interval '12 months')::date and m.month not in (select month from tmonths)
     group by 1, 2
    union all
    select date_trunc('month', l.work_date)::date, p.full_name, sum(l.entry - l.cancelled), sum(coalesce(l.revenue, 0))
      from public.v_line_metrics l join public.persons p on p.id = l.person_id
     where l.branch_id in (select id from vis) and l.work_date >= (v_m - interval '12 months')::date and l.work_date <= v_today
     group by 1, 2)
  select jsonb_build_object(
    'month', v_m, 'today', v_today,
    'wd_done', app.working_days_between(v_m, least(v_today, (v_m + interval '1 month - 1 day')::date)),
    'wd_total', app.working_days_between(v_m, (v_m + interval '1 month - 1 day')::date),
    'series', (select coalesce(jsonb_agg(s order by s.month), '[]') from (
        select mo.month, sum(mo.t) target, sum(mo.a) cases, sum(mo.rt) revenue_target, sum(mo.ra) revenue, sum(mo.bill) billing, max(mo.src) source
          from months mo group by mo.month) s),
    'by_stakeholder', (select coalesce(jsonb_agg(s), '[]') from (
        select mo.month, coalesce(zm.full_name, 'Unassigned') stakeholder, sum(mo.t) target, sum(mo.a) cases, sum(mo.rt) revenue_target, sum(mo.ra) revenue
          from months mo left join zm on zm.branch_id = mo.branch_id group by mo.month, 2) s),
    'by_location', (select coalesce(jsonb_agg(s), '[]') from (
        select mo.month, b.name location, coalesce(zm.full_name, 'Unassigned') stakeholder, sum(mo.t) target, sum(mo.a) cases, sum(mo.rt) revenue_target, sum(mo.ra) revenue
          from months mo join public.branches b on b.id = mo.branch_id left join zm on zm.branch_id = mo.branch_id
         where mo.month >= (v_m - interval '2 months')::date group by mo.month, b.name, 3) s),
    'by_client', (select coalesce(jsonb_agg(s), '[]') from (
        select mo.month, coalesce(c.client_family, c.name) client, sum(mo.t) target, sum(mo.a) cases, sum(mo.ra) revenue
          from months mo join public.clients c on c.id = mo.client_id where mo.month >= (v_m - interval '12 months')::date group by mo.month, 2) s),
    'by_person', (select coalesce(jsonb_agg(s), '[]') from (select pe.month, pe.person, sum(pe.cases) cases, sum(pe.revenue) revenue from people pe group by 1, 2) s),
    'daily', (select coalesce(jsonb_agg(s order by s.d), '[]') from (
        select l.work_date d, sum(l.entry - l.cancelled) cases, sum(coalesce(l.revenue, 0)) revenue from public.v_line_metrics l
         where l.branch_id in (select id from vis) and l.work_date between (v_m - interval '1 month')::date and v_today group by 1) s),
    'daily_tracker', (select coalesce(jsonb_agg(s order by s.d), '[]') from (
        select t.as_of d, sum(t.mtd_cases) mtd_cases, sum(t.mtd_revenue) mtd_revenue, sum(t.target_cases) target from public.tracker_daily t
         where t.branch_id in (select id from vis) and t.as_of >= (v_m - interval '13 months')::date group by 1) s)
  ));
end $$;

-- ------------------------------------------------------------------ Zonal Tracker export (what the downloader may see)
create or replace function public.tracker_export(p_date date default null) returns jsonb
language plpgsql stable security definer set search_path = public, app, pg_temp as $$
declare v_me uuid := app.me(); v_d date := least(coalesce(p_date, app.today()), app.today()); v_m date; v_e date; v_mode text; v_app boolean;
begin
  perform app.require_ops_view();
  v_m := date_trunc('month', v_d)::date; v_e := (v_m + interval '1 month - 1 day')::date;
  v_mode := case when app.is_admin() or app.has_role('auditor') or app.has_role('ops_head') then 'full'
                 when app.has_role('zm') or exists (select 1 from public.location_heads h where h.person_id = v_me and h.head_role = 'zonal_manager' and h.valid && daterange(v_m, v_d + 1)) then 'zm'
                 when app.has_role('bm') or app.has_role('ba') or app.has_role('manager') or app.has_reports(v_me, 'operations', v_d) then 'team'
                 else 'self' end;
  v_app := exists (select 1 from public.productivity_lines l where l.work_date between v_m and v_d);
  return (
  with scope as (  -- (branch, client-or-all) pairs in scope for the location tracker
    select b.id branch_id, null::uuid client_id from public.branches b where v_mode = 'full'
    union select h.branch_id, h.client_id from public.location_heads h
     where v_mode = 'zm' and h.person_id = v_me and h.valid && daterange(v_m, v_d + 1)),
  inscope as (select distinct x.branch_id, x.client_id from (
      select cl.branch_id, cl.client_id from public.client_locations cl where cl.valid @> v_d
      union select t.branch_id, t.client_id from public.target_allocations t where t.is_current and t.month = v_m and t.metric = 'entry' and t.level = 'branch' and t.client_id is not null
      union select l.branch_id, l.client_id from public.v_line_metrics l where l.work_date between v_m and v_d
      union select m.branch_id, m.client_id from public.tracker_monthly m where m.month in (v_m, (v_m - interval '1 month')::date) and m.branch_id is not null and m.client_id is not null) x
     where exists (select 1 from scope s where s.branch_id = x.branch_id and (s.client_id is null or s.client_id = x.client_id))),
  act as (select l.branch_id, l.client_id, sum(l.entry) e, sum(l.closure) c, sum(l.cancelled) x,
                 sum(l.entry - l.cancelled) filter (where l.work_date < v_d) prev, sum(coalesce(l.revenue, 0)) rev
            from public.v_line_metrics l where l.work_date between v_m and v_d group by 1, 2),
  snap as (select t.branch_id, t.client_id, sum(t.mtd_cases) mtd, sum(t.mtd_revenue) rev from public.tracker_daily t
            where t.as_of = (select max(as_of) from public.tracker_daily where as_of <= v_d and as_of >= v_m) group by 1, 2),
  psnap as (select t.branch_id, t.client_id, sum(t.mtd_cases) mtd from public.tracker_daily t
             where t.as_of = (select max(as_of) from public.tracker_daily where as_of < v_d and as_of >= v_m) group by 1, 2),
  hm as (select m.branch_id, m.client_id, sum(m.target_cases) t, sum(m.actual_cases) a, sum(m.actual_revenue) ra from public.tracker_monthly m
          where m.month = v_m group by 1, 2),
  tgt as (select t.branch_id, t.client_id, t.amount from public.target_allocations t
           where t.is_current and t.month = v_m and t.metric = 'entry' and t.level = 'branch' and t.client_id is not null),
  rate as (select distinct on (cl.branch_id, cl.client_id) cl.branch_id, cl.client_id, rc.rate
             from public.client_locations cl join public.rate_cards rc on rc.client_id = cl.client_id and rc.location_id = cl.location_id
              and rc.process_id = cl.process_id and rc.valid @> v_d order by cl.branch_id, cl.client_id, rc.rate desc),
  hist as (  -- 12 previous months: cases, revenue, billing
    select m.month, m.branch_id, m.client_id, sum(m.actual_cases) cases, sum(m.actual_revenue) revenue, sum(m.billing_amount) billing
      from public.tracker_monthly m where m.month between (v_m - interval '12 months')::date and (v_m - interval '1 month')::date
       and not exists (select 1 from public.productivity_lines l where date_trunc('month', l.work_date) = m.month)
     group by 1, 2, 3
    union all
    select x.month, x.branch_id, x.client_id, x.cases, x.revenue,
           (select sum(d.bill_amount) from public.collection_daily d where d.branch_id = x.branch_id and d.client_id = x.client_id
             and date_trunc('month', d.entry_date) = x.month)
      from (select date_trunc('month', l.work_date)::date as month, l.branch_id, l.client_id, sum(l.entry - l.cancelled) cases, sum(coalesce(l.revenue, 0)) revenue
              from public.v_line_metrics l where l.work_date between (v_m - interval '12 months')::date and (v_m - 1) group by 1, 2, 3) x),
  team as (select s.person_id from app.subtree(v_me, 'operations', v_d) s union select v_me),
  lines as (select l.person_id, l.branch_id, l.client_id, sum(l.entry) e, sum(l.closure) c, sum(l.cancelled) x,
                   sum(l.entry - l.cancelled) filter (where l.work_date < v_d) prev, sum(coalesce(l.revenue, 0)) rev,
                   bool_or(l.work_date = v_d) today
              from public.v_line_metrics l where l.work_date between v_m and v_d
               and l.person_id in (select person_id from team where v_mode in ('team','self'))
               and (v_mode <> 'self' or l.person_id = v_me) group by 1, 2, 3)
  select jsonb_build_object(
    'mode', v_mode, 'as_of', v_d, 'month', v_m, 'prev_as_of', case when v_d > v_m then v_d - 1 end,
    'source', case when v_app then 'app' when exists (select 1 from snap) then 'tracker_daily' else 'tracker_monthly' end,
    'wd_done', app.working_days_between(v_m, v_d), 'wd_total', app.working_days_between(v_m, v_e),
    'me', (select full_name from public.persons where id = v_me),
    'roi_exclude', coalesce(app.setting('tracker_roi_exclude') #>> '{}', 'Mumbai'),
    'rows', (select coalesce(jsonb_agg(jsonb_build_object(
        'zone', coalesce(z.name, b.name), 'zone_order', coalesce(z.sort_order, 9999), 'zone_style', z.tracker_style,
        'region', coalesce(z.region, 'Unassigned'), 'tier', coalesce(b.tier, 'Zone B'),
        'location', b.name, 'loc_order', coalesce(b.sort_order, 9999), 'client', c.name, 'client_order', coalesce(c.sort_order, 999),
        'rate', coalesce(r.rate, case when coalesce(hm.a, 0) > 0 then round(hm.ra / hm.a) end, 0),
        'target', coalesce(t.amount, hm.t, 0),
        'entry', a.e, 'closure', a.c, 'cancelled', a.x,
        'mtd', case when v_app then coalesce(a.e - a.x, 0) else coalesce(sn.mtd, hm.a, 0) end,
        'prev_mtd', case when v_app then coalesce(a.prev, 0) else coalesce(ps.mtd, 0) end,
        'revenue', case when v_app then coalesce(a.rev, 0) else coalesce(sn.rev, hm.ra, 0) end,
        'stakeholder', (select p.full_name from public.persons p where p.id = app.head_of(b.id, c.id, 'zonal_manager', v_d)),
        'head', (select p.full_name from public.persons p where p.id = app.head_of(b.id, c.id, 'branch_head', v_d)))), '[]')
      from inscope k join public.branches b on b.id = k.branch_id join public.clients c on c.id = k.client_id
      left join public.branch_zones bz on bz.branch_id = b.id and bz.valid @> v_d left join public.zones z on z.id = bz.zone_id
      left join act a on a.branch_id = k.branch_id and a.client_id = k.client_id
      left join snap sn on sn.branch_id = k.branch_id and sn.client_id = k.client_id
      left join psnap ps on ps.branch_id = k.branch_id and ps.client_id = k.client_id
      left join hm on hm.branch_id = k.branch_id and hm.client_id = k.client_id
      left join tgt t on t.branch_id = k.branch_id and t.client_id = k.client_id
      left join rate r on r.branch_id = k.branch_id and r.client_id = k.client_id),
    'history', (select coalesce(jsonb_agg(jsonb_build_object('month', h.month, 'location', b.name, 'client', c.name,
                   'cases', h.cases, 'revenue', h.revenue, 'billing', h.billing)), '[]')
                  from hist h join inscope k on k.branch_id = h.branch_id and k.client_id = h.client_id
                  join public.branches b on b.id = h.branch_id join public.clients c on c.id = h.client_id),
    'people', (select coalesce(jsonb_agg(jsonb_build_object(
                   'person', p.full_name, 'manager', (select m.full_name from public.persons m where m.id = app.manager_of(p.id)),
                   'is_me', p.id = v_me, 'location', b.name, 'client', c.name, 'zone', coalesce(z.name, b.name),
                   'rate', r.rate, 'entry', ln.e, 'closure', ln.c, 'cancelled', ln.x, 'mtd', ln.e - ln.x, 'prev_mtd', coalesce(ln.prev, 0),
                   'revenue', ln.rev, 'reported_today', ln.today) order by p.full_name, b.name, c.name), '[]')
                 from lines ln join public.persons p on p.id = ln.person_id join public.branches b on b.id = ln.branch_id
                 join public.clients c on c.id = ln.client_id
                 left join public.branch_zones bz on bz.branch_id = b.id and bz.valid @> v_d left join public.zones z on z.id = bz.zone_id
                 left join rate r on r.branch_id = ln.branch_id and r.client_id = ln.client_id),
    'team_members', (select coalesce(jsonb_agg(jsonb_build_object('person', p.full_name, 'manager', (select m.full_name from public.persons m where m.id = app.manager_of(p.id)))
                       order by p.full_name), '[]')
                       from team tm join public.persons p on p.id = tm.person_id
                      where v_mode in ('team','zm') and p.status in ('active','invited'))
  ));
end $$;

-- whoami: leadership / collections-only flags for the screens.
do $do$
declare d text;
begin
  d := pg_get_functiondef('public.whoami()'::regprocedure);
  d := replace(d, $r$'today', app.today(),$r$, $r$'leadership', app.has_role('auditor'), 'ops_blind', app.ops_blind(), 'today', app.today(),$r$);
  if position('ops_blind' in d) = 0 then raise exception 'whoami: anchor not found'; end if;
  execute d;
end $do$;

insert into public.settings(key, value, description, label, help, kind, section, editable)
select 'tracker_roi_exclude', '"Mumbai"', 'Location left out of the tracker''s ROI row', 'ROI excludes location', 'The tracker''s ROI row = Pan India minus this location.', 'text', 'Reports', true
 where not exists (select 1 from public.settings where key = 'tracker_roi_exclude');

-- ------------------------------------------------------------------ grants
revoke all on function public.my_collection_rows(date), public.save_collection_day(date, jsonb), public.collections_board(date, date),
  public.grant_reopen_many(uuid[], uuid[], date, date, text, timestamptz, boolean, app.fn), public.leave_taken(int, uuid), public.attrition(date, date),
  public.month_close_check(date), public.close_month(date, text), public.admin_backup(), public.tracker_export(date) from public, anon;
grant execute on function public.my_collection_rows(date), public.save_collection_day(date, jsonb), public.collections_board(date, date),
  public.grant_reopen_many(uuid[], uuid[], date, date, text, timestamptz, boolean, app.fn), public.leave_taken(int, uuid), public.attrition(date, date),
  public.month_close_check(date), public.close_month(date, text), public.admin_backup(), public.tracker_export(date) to authenticated;
revoke all on function app.money_pairs(uuid, date), app.collections_incomplete(uuid, date), app.penalty_on_miss(), app.sync_core(boolean),
  app.sync_collections_misses(), app.sync_all(), app.require_ops_view() from public, anon;
grant execute on function app.ops_blind() to authenticated;
