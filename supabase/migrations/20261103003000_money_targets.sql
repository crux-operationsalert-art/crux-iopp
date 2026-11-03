-- D-48: Targets in money, three ways to set them, one roll-up used everywhere.
--   1. Monthly totals: a person's revenue and collection expectation (client left to the team).
--   2. Client-wise: cases per client · location; revenue = cases × rate (computed here, never typed); collection.
--   3. Bulk: a prefilled template (people × clients × rate) uploaded through save_targets (preview, then apply).
-- A person has either totals or client-wise rows for a measure, never both (D-12); saving one style retires the other.
-- Location target = the branch-level target if one is set, else the sum of the people's client-wise targets there.
-- Person target = their total, else the sum of their client-wise rows; it covers their own team (D-06).

-- Rate for a branch · client (one rate per pair today; the highest if a pair ever has more).
create or replace function app.pair_rate(p_branch uuid, p_client uuid, p_date date)
returns numeric language sql stable security definer set search_path = public, app, pg_temp as $$
  select max(rc.rate) from public.client_locations cl
    join public.rate_cards rc on rc.client_id = cl.client_id and rc.location_id = cl.location_id and rc.process_id = cl.process_id and rc.valid @> p_date
   where cl.branch_id = p_branch and cl.client_id = p_client and cl.valid && daterange(date_trunc('month', p_date)::date, (date_trunc('month', p_date) + interval '1 month')::date)
$$;

-- Location (branch · client) targets for a month (or every month when p_month is null).
create or replace function app.loc_targets(p_month date, p_metric text)
returns table(month date, branch_id uuid, client_id uuid, amount numeric)
language sql stable security definer set search_path = public, app, pg_temp as $$
  with t as (select * from public.target_allocations t where t.is_current and t.metric = p_metric and t.client_id is not null and t.branch_id is not null
               and (p_month is null or t.month = date_trunc('month', p_month)::date))
  select b.month, b.branch_id, b.client_id, b.amount from t b where b.level = 'branch'
  union all
  select p.month, p.branch_id, p.client_id, sum(p.amount) from t p where p.level = 'person'
     and not exists (select 1 from t b where b.level = 'branch' and b.month = p.month and b.branch_id = p.branch_id and b.client_id = p.client_id)
   group by 1, 2, 3
$$;

-- A person's own target for a measure: their total row, else the sum of their client-wise rows.
create or replace function app.person_target(p_month date, p_person uuid, p_metric text)
returns numeric language sql stable security definer set search_path = public, app, pg_temp as $$
  select coalesce(
    (select t.amount from public.target_allocations t where t.is_current and t.month = date_trunc('month', p_month)::date and t.level = 'person'
        and t.person_id = p_person and t.metric = p_metric and t.client_id is null),
    (select sum(t.amount) from public.target_allocations t where t.is_current and t.month = date_trunc('month', p_month)::date and t.level = 'person'
        and t.person_id = p_person and t.metric = p_metric and t.client_id is not null))
$$;

-- Managers may set a person target for anyone in their operations or collections team.
create or replace function app.can_set_target(p_level text, p_metric text, p_zone uuid, p_branch uuid, p_person uuid, p_month date)
returns boolean language plpgsql stable security definer set search_path = public, app, pg_temp as $$
declare v_fn app.fn := app.metric_function(p_metric); v_head app.role_code; v_d date := greatest(p_month, app.today());
begin
  if app.is_admin() then return true; end if;
  v_head := case when v_fn = 'collections' then 'collections_head' else 'ops_head' end;
  if app.has_role(v_head) then return true; end if;
  if p_level in ('org','zone') then return false; end if;
  if p_level = 'branch' then
    return exists (select 1 from public.role_assignments r join public.branch_zones bz on bz.zone_id = r.zone_id
                    where r.person_id = app.me() and r.role = 'zm' and r.valid @> app.today()
                      and bz.branch_id = p_branch and bz.valid @> p_month);
  end if;
  return exists (select 1 from app.subtree(app.me(), 'operations', v_d) s where s.person_id = p_person)
      or exists (select 1 from app.subtree(app.me(), 'collections', v_d) s where s.person_id = p_person);
end $$;

-- Actuals: collections and bills now come from the daily money entries (D-43), plus any older ledger rows.
create or replace function app.metric_actual(p_metric text, p_from date, p_to date, p_level text,
                                             p_zone uuid, p_branch uuid, p_person uuid, p_client uuid)
returns numeric language plpgsql stable security definer set search_path = public, app, pg_temp as $$
declare v numeric; v2 numeric := 0; v_people uuid[];
begin
  if p_level = 'person' then
    select array_agg(x) into v_people from (
      select p_person as x union select s.person_id from app.subtree(p_person, app.metric_function(p_metric), p_to) s) z;
  end if;
  if app.metric_function(p_metric) = 'operations' then
    select coalesce(sum(case p_metric when 'net_actioned' then m.net_actioned when 'entry' then m.entry
                                      when 'closure' then m.closure when 'revenue' then m.revenue end), 0)
      into v from public.v_line_metrics m
     where m.work_date between p_from and p_to
       and (p_client is null or m.client_id = p_client)
       and case p_level when 'org' then true when 'zone' then m.zone_id = p_zone
                        when 'branch' then m.branch_id = p_branch else m.person_id = any(v_people) end;
    return v;
  end if;
  select coalesce(sum(case p_metric when 'collections_received' then d.rcv_lt30 + d.rcv_30_90 + d.rcv_90_180 + d.rcv_gt180
                                    when 'collections_reconciled' then d.rec_lt30 + d.rec_30_90 + d.rec_90_180 + d.rec_gt180
                                    when 'bill_count' then d.bill_count else d.bill_amount end), 0)
    into v from public.collection_daily d
    left join public.branch_zones bz on bz.branch_id = d.branch_id and bz.valid @> d.entry_date
   where d.entry_date between p_from and p_to and (p_client is null or d.client_id = p_client)
     and case p_level when 'org' then true when 'zone' then bz.zone_id = p_zone
                      when 'branch' then d.branch_id = p_branch else d.person_id = any(v_people) end;
  if p_metric like 'collections%' then
    select coalesce(sum(case when p_metric = 'collections_received' then amount_received else amount_reconciled end), 0)
      into v2 from public.v_collections c
     where c.collection_date between p_from and p_to and (p_client is null or c.client_id = p_client)
       and case p_level when 'org' then true when 'zone' then c.zone_id = p_zone
                        when 'branch' then c.branch_id = p_branch else c.person_id = any(v_people) end;
  else
    select coalesce(sum(case when p_metric = 'bill_count' then bill_count else bill_amount end), 0)
      into v2 from public.bill_entries b
      left join public.branch_zones bz on bz.branch_id = b.branch_id and bz.valid @> b.bill_date
     where b.bill_date between p_from and p_to and b.status <> 'cancelled' and (p_client is null or b.client_id = p_client)
       and case p_level when 'org' then true when 'zone' then bz.zone_id = p_zone
                        when 'branch' then b.branch_id = p_branch else b.person_id = any(v_people) end;
  end if;
  return v + coalesce(v2, 0);
end $$;

-- People the caller can set targets for, with their clients, rate and current figures (the bulk template and the Targets page).
create or replace function public.target_template(p_month date)
returns jsonb language plpgsql stable security definer set search_path = public, app, pg_temp as $$
declare v_m date := date_trunc('month', p_month)::date; v_e date; v_d date; v_all boolean; v_pm date;
begin
  if app.me() is null then raise exception 'Not signed in' using errcode = '28000'; end if;
  v_e := (v_m + interval '1 month - 1 day')::date; v_d := greatest(v_m, least(app.today(), v_e)); v_pm := (v_m - interval '1 month')::date;
  v_all := app.is_admin() or app.has_role('ops_head') or app.has_role('collections_head');
  return (
  with ppl as (
    select p.id, p.full_name, p.designation from public.persons p
     where p.status in ('active','invited')
       and (v_all or p.id in (select s.person_id from app.subtree(app.me(), 'operations', v_d) s
                              union select s.person_id from app.subtree(app.me(), 'collections', v_d) s))
       and (p.id <> app.me() or v_all)),
  pairs as (
    select distinct a.person_id, cl.branch_id, cl.client_id from public.allocations a join public.client_locations cl on cl.id = a.client_location_id
     where a.function = 'operations' and a.valid && daterange(v_m, v_e + 1) and a.person_id in (select id from ppl)
    union
    select x.id, mp.branch_id, mp.client_id from ppl x cross join lateral app.money_pairs(x.id, v_d) mp
    union
    select t.person_id, t.branch_id, t.client_id from public.target_allocations t
     where t.is_current and t.month = v_m and t.level = 'person' and t.client_id is not null and t.person_id in (select id from ppl)),
  cur as (select t.person_id, t.branch_id, t.client_id, t.metric, t.amount from public.target_allocations t
           where t.is_current and t.month = v_m and t.level = 'person' and t.person_id in (select id from ppl)),
  last as (select l.person_id, l.branch_id, l.client_id, sum(l.entry - l.cancelled) cases, sum(coalesce(l.revenue, 0)) revenue
             from public.v_line_metrics l where l.work_date between v_pm and v_m - 1 and l.person_id in (select id from ppl) group by 1, 2, 3)
  select jsonb_build_object('month', v_m, 'locked', app.clock() >= app.target_lock_at(v_m), 'lock_at', app.target_lock_at(v_m),
    'people', (select coalesce(jsonb_agg(jsonb_build_object('person_id', x.id, 'person', x.full_name, 'designation', x.designation,
        'manager', (select m.full_name from public.reporting_lines r join public.persons m on m.id = r.manager_id
                     where r.person_id = x.id and r.function = 'operations' and r.valid @> v_d limit 1),
        'style', case when exists (select 1 from cur c where c.person_id = x.id and c.client_id is not null) then 'client'
                      when exists (select 1 from cur c where c.person_id = x.id and c.client_id is null) then 'total' end,
        'revenue', app.person_target(v_m, x.id, 'revenue'), 'collection', app.person_target(v_m, x.id, 'collections_received'),
        'cases', app.person_target(v_m, x.id, 'entry')) order by x.full_name), '[]') from ppl x),
    'rows', (select coalesce(jsonb_agg(jsonb_build_object('person_id', k.person_id, 'person', x.full_name, 'branch_id', k.branch_id, 'client_id', k.client_id,
        'location', b.name, 'client', c.name, 'zone', z.name, 'rate', app.pair_rate(k.branch_id, k.client_id, v_m),
        'cases', (select amount from cur where cur.person_id = k.person_id and cur.branch_id = k.branch_id and cur.client_id = k.client_id and cur.metric = 'entry'),
        'revenue', (select amount from cur where cur.person_id = k.person_id and cur.branch_id = k.branch_id and cur.client_id = k.client_id and cur.metric = 'revenue'),
        'collection', (select amount from cur where cur.person_id = k.person_id and cur.branch_id = k.branch_id and cur.client_id = k.client_id and cur.metric = 'collections_received'),
        'last_cases', ls.cases, 'last_revenue', ls.revenue)
        order by x.full_name, z.name nulls last, b.name, c.name), '[]')
      from pairs k join ppl x on x.id = k.person_id join public.branches b on b.id = k.branch_id join public.clients c on c.id = k.client_id
      left join public.branch_zones bz on bz.branch_id = b.id and bz.valid @> v_d left join public.zones z on z.id = bz.zone_id
      left join last ls on ls.person_id = k.person_id and ls.branch_id = k.branch_id and ls.client_id = k.client_id)));
end $$;

-- One entry point for all three ways of setting targets. p_rows: [{person_id, revenue?, collection?}] for totals,
-- or [{person_id, branch_id, client_id, cases?, collection?}] for client-wise. Blank = leave as is. Preview unless p_apply.
create or replace function public.save_targets(p_month date, p_rows jsonb, p_apply boolean default false, p_reason text default null)
returns jsonb language plpgsql security definer set search_path = public, app, pg_temp as $$
declare
  v_m date := date_trunc('month', p_month)::date;
  v_locked boolean := app.clock() >= app.target_lock_at(v_m);
  v_grant boolean; r jsonb; i int := 0; v_out jsonb := '[]'; v_err text; v_warn text; v_p uuid; v_b uuid; v_c uuid;
  v_cases numeric; v_rev numeric; v_col numeric; v_rate numeric; v_mode text; n_err int := 0;
  t_rev numeric := 0; t_col numeric := 0; t_cases numeric := 0; v_reason text;
begin
  if app.me() is null then raise exception 'Not signed in' using errcode = '28000'; end if;
  if jsonb_typeof(p_rows) <> 'array' then raise exception 'Rows must be a list.' using errcode = '22023'; end if;
  v_grant := app.is_admin() or exists (select 1 from public.reopen_grants g where g.kind = 'target' and g.target_month = v_m
               and g.revoked_at is null and g.expires_at > app.clock() and g.person_id = app.me());
  v_reason := coalesce(nullif(trim(p_reason), ''), 'Targets ' || to_char(v_m, 'Mon YYYY'));
  -- validate every row first
  for r in select * from jsonb_array_elements(p_rows) loop
    i := i + 1; v_err := null; v_warn := null; v_rate := null; v_rev := null;
    begin
      v_p := nullif(r->>'person_id', '')::uuid; v_b := nullif(r->>'branch_id', '')::uuid; v_c := nullif(r->>'client_id', '')::uuid;
      v_cases := nullif(trim(r->>'cases'), '')::numeric; v_col := nullif(trim(r->>'collection'), '')::numeric;
      v_rev := case when v_c is null then nullif(trim(r->>'revenue'), '')::numeric end;
    exception when others then v_err := 'Numbers or ids are not valid'; end;
    v_mode := case when v_c is null then 'total' else 'client' end;
    if v_err is null and (v_p is null or not exists (select 1 from public.persons where id = v_p)) then v_err := 'Unknown person'; end if;
    if v_err is null and v_mode = 'client' and (v_b is null or not exists (select 1 from public.branches where id = v_b)
                                                 or not exists (select 1 from public.clients where id = v_c)) then v_err := 'Unknown location or client'; end if;
    if v_err is null and least(coalesce(v_cases, 0), coalesce(v_col, 0), coalesce(v_rev, 0)) < 0 then v_err := 'Targets cannot be negative'; end if;
    if v_err is null and (v_m < date_trunc('month', app.today())::date) and not app.is_admin() then v_err := 'Past months cannot be changed'; end if;
    if v_err is null and not (app.can_set_target('person', 'revenue', null, v_b, v_p, v_m) or app.can_set_target('person', 'collections_received', null, v_b, v_p, v_m)) then
      v_err := 'You cannot set targets for this person'; end if;
    if v_err is null and v_locked and not v_grant then v_err := 'Targets for this month are locked; ask an Admin to reopen'; end if;
    if v_err is null and v_locked and coalesce(trim(p_reason), '') = '' then v_err := 'A reason is needed after the lock'; end if;
    if v_err is null and exists (select 1 from jsonb_array_elements(p_rows) o
          where o->>'person_id' = r->>'person_id' and (nullif(o->>'client_id', '') is null) <> (v_c is null)
            and (coalesce(nullif(trim(o->>'cases'), ''), nullif(trim(o->>'collection'), ''), nullif(trim(o->>'revenue'), '')) is not null)) then
      v_err := 'Use either monthly totals or client-wise targets for a person, not both'; end if;
    if v_err is null and v_mode = 'client' and v_cases is not null then
      v_rate := app.pair_rate(v_b, v_c, v_m);
      if v_rate is null then v_warn := 'No rate for this client · location: revenue target not set'; else v_rev := round(v_cases * v_rate, 2); end if;
    end if;
    if v_err is null and v_cases is null and v_col is null and v_rev is null then v_warn := coalesce(v_warn, 'Nothing to save'); end if;
    if v_err is not null then n_err := n_err + 1;
    else t_rev := t_rev + coalesce(v_rev, 0); t_col := t_col + coalesce(v_col, 0); t_cases := t_cases + coalesce(v_cases, 0); end if;
    v_out := v_out || jsonb_build_object('i', i, 'person_id', v_p, 'person', (select full_name from public.persons where id = v_p),
      'branch_id', v_b, 'client_id', v_c, 'mode', v_mode, 'cases', v_cases, 'rate', v_rate, 'revenue', v_rev, 'collection', v_col,
      'error', v_err, 'warning', v_warn);
  end loop;
  if p_apply and n_err > 0 then raise exception '% row(s) have problems. Fix them and try again.', n_err using errcode = 'P0001'; end if;
  if p_apply then
    for r in select * from jsonb_array_elements(v_out) where value->>'error' is null loop
      v_p := (r->>'person_id')::uuid; v_b := nullif(r->>'branch_id', '')::uuid; v_c := nullif(r->>'client_id', '')::uuid;
      v_cases := (r->>'cases')::numeric; v_rev := (r->>'revenue')::numeric; v_col := (r->>'collection')::numeric;
      perform set_config('app.reason', v_reason || ' (switched style)', true);
      -- retire the other style for the measures being set (kept in history, D-12)
      update public.target_allocations t set is_current = false
       where t.is_current and t.month = v_m and t.level = 'person' and t.person_id = v_p
         and ((v_c is null) <> (t.client_id is null))
         and (((v_rev is not null or v_cases is not null) and t.metric in ('revenue', 'entry')) or (v_col is not null and t.metric = 'collections_received'));
      if v_c is null then
        if v_rev is not null then perform public.set_target(v_m, 'revenue', 'person', v_rev, null, null, v_p, null, v_reason); end if;
        if v_col is not null then perform public.set_target(v_m, 'collections_received', 'person', v_col, null, null, v_p, null, v_reason); end if;
      else
        if v_cases is not null then perform public.set_target(v_m, 'entry', 'person', v_cases, null, v_b, v_p, v_c, v_reason); end if;
        if v_rev is not null then perform public.set_target(v_m, 'revenue', 'person', v_rev, null, v_b, v_p, v_c, v_reason); end if;
        if v_col is not null then perform public.set_target(v_m, 'collections_received', 'person', v_col, null, v_b, v_p, v_c, v_reason); end if;
      end if;
    end loop;
  end if;
  return jsonb_build_object('rows', v_out, 'errors', n_err, 'applied', p_apply and n_err = 0,
                            'totals', jsonb_build_object('revenue', t_rev, 'collection', t_col, 'cases', t_cases));
end $$;

-- Roll-up for a manager: themselves and each direct report — target vs MTD in money, and how much they have passed down.
create or replace function public.team_targets(p_month date, p_person uuid default null)
returns jsonb language plpgsql stable security definer set search_path = public, app, pg_temp as $$
declare v_m date := date_trunc('month', p_month)::date; v_e date; v_to date; v_p uuid := coalesce(p_person, app.me());
begin
  if app.me() is null then raise exception 'Not signed in' using errcode = '28000'; end if;
  v_e := (v_m + interval '1 month - 1 day')::date; v_to := least(app.today(), v_e);
  if v_p <> app.me() and not (app.can_view_person(v_p, greatest(v_m, v_to), 'operations') or app.can_view_person(v_p, greatest(v_m, v_to), 'collections')) then
    raise exception 'Not permitted.' using errcode = '42501';
  end if;
  return (
  with ppl as (
    select v_p id, 0 lvl
    union select r.person_id, 1 from public.reporting_lines r where r.manager_id = v_p and r.valid @> greatest(v_m, v_to)),
  x as (select p.id, p.full_name, k.lvl,
          app.person_target(v_m, p.id, 'revenue') rt, app.person_target(v_m, p.id, 'collections_received') ct,
          case when v_to >= v_m then app.metric_actual('revenue', v_m, v_to, 'person', null, null, p.id, null) else 0 end ra,
          case when v_to >= v_m then app.metric_actual('collections_received', v_m, v_to, 'person', null, null, p.id, null) else 0 end ca,
          (select sum(app.person_target(v_m, r.person_id, 'revenue')) from public.reporting_lines r where r.manager_id = p.id and r.function = 'operations' and r.valid @> greatest(v_m, v_to)) r_down,
          (select sum(app.person_target(v_m, r.person_id, 'collections_received')) from public.reporting_lines r where r.manager_id = p.id and r.function = 'collections' and r.valid @> greatest(v_m, v_to)) c_down,
          exists (select 1 from public.reporting_lines r where r.manager_id = p.id and r.valid @> greatest(v_m, v_to)) has_team
        from ppl k join public.persons p on p.id = k.id where p.status in ('active','invited'))
  select jsonb_build_object('month', v_m, 'as_of', v_to,
    'wd_done', case when v_to >= v_m then app.working_days_between(v_m, v_to) else 0 end, 'wd_total', app.working_days_between(v_m, v_e),
    'people', (select coalesce(jsonb_agg(jsonb_build_object('person_id', x.id, 'person', x.full_name, 'self', x.lvl = 0, 'has_team', x.has_team,
        'revenue_target', x.rt, 'revenue', x.ra, 'collection_target', x.ct, 'collection', x.ca,
        'revenue_passed_down', x.r_down, 'collection_passed_down', x.c_down) order by x.lvl, x.full_name), '[]') from x)));
end $$;

-- My day: my targets in money (revenue, collection) with the client-wise breakdown and the location's target.
create or replace function public.my_targets(p_date date default null)
returns jsonb language sql stable security definer set search_path = public, app, pg_temp as $$
  with d0 as (select coalesce(p_date, app.today()) d), m0 as (select date_trunc('month', (select d from d0))::date m),
  rows as (select distinct on (cl.id) cl.id cl, cl.branch_id, cl.client_id from public.allocations a join public.client_locations cl on cl.id = a.client_location_id
            where a.person_id = app.me() and a.valid @> (select d from d0)),
  mine as (select t.branch_id, t.client_id, t.metric, t.amount, t.set_by from public.target_allocations t
            where t.is_current and t.month = (select m from m0) and t.level = 'person' and t.person_id = app.me())
  select jsonb_build_object(
    'wd_done', app.working_days_between((select m from m0), (select d from d0)),
    'wd_total', app.working_days_between((select m from m0), ((select m from m0) + interval '1 month - 1 day')::date),
    'set_by', (select p.full_name from mine join public.persons p on p.id = mine.set_by limit 1),
    'style', case when exists (select 1 from mine where client_id is not null) then 'client' when exists (select 1 from mine) then 'total' end,
    'revenue', jsonb_build_object('target', app.person_target((select m from m0), app.me(), 'revenue'),
                                  'mtd', app.metric_actual('revenue', (select m from m0), (select d from d0), 'person', null, null, app.me(), null)),
    'collection', jsonb_build_object('target', app.person_target((select m from m0), app.me(), 'collections_received'),
                                     'mtd', app.metric_actual('collections_received', (select m from m0), (select d from d0), 'person', null, null, app.me(), null)),
    'rows', (select coalesce(jsonb_agg(jsonb_build_object('client_location_id', r.cl, 'branch_id', r.branch_id, 'client_id', r.client_id,
        'rate', app.pair_rate(r.branch_id, r.client_id, (select m from m0)),
        'mine', jsonb_build_object(
            'cases', (select amount from mine where mine.branch_id = r.branch_id and mine.client_id = r.client_id and mine.metric = 'entry'),
            'revenue', (select amount from mine where mine.branch_id = r.branch_id and mine.client_id = r.client_id and mine.metric = 'revenue'),
            'collection', (select amount from mine where mine.branch_id = r.branch_id and mine.client_id = r.client_id and mine.metric = 'collections_received')),
        'my_mtd', (select jsonb_build_object('cases', coalesce(sum(l.entry - l.cancelled), 0), 'revenue', coalesce(sum(l.revenue), 0))
                     from public.v_line_metrics l where l.person_id = app.me() and l.branch_id = r.branch_id and l.client_id = r.client_id
                      and l.work_date between (select m from m0) and (select d from d0)),
        'location', jsonb_build_object(
            'cases', (select amount from app.loc_targets((select m from m0), 'entry') t where t.branch_id = r.branch_id and t.client_id = r.client_id),
            'revenue', (select coalesce(t.amount * app.pair_rate(r.branch_id, r.client_id, (select m from m0)), 0) from app.loc_targets((select m from m0), 'entry') t where t.branch_id = r.branch_id and t.client_id = r.client_id)),
        'location_mtd', (select jsonb_build_object('cases', coalesce(sum(l.entry - l.cancelled), 0), 'revenue', coalesce(sum(l.revenue), 0))
                           from public.v_line_metrics l where l.branch_id = r.branch_id and l.client_id = r.client_id
                            and l.work_date between (select m from m0) and (select d from d0)))), '[]') from rows r))
$$;

-- Collections: the target per client · location now uses the same roll-up.
create or replace function public.my_collection_day(p_date date default null)
returns jsonb language sql stable security definer set search_path = public, app, pg_temp as $$
  with d0 as (select coalesce(p_date, app.today()) d), m0 as (select date_trunc('month', (select d from d0))::date m),
  k as (select * from app.money_pairs(app.me(), (select d from d0))),
  lt as (select * from app.loc_targets((select m from m0), 'collections_received')),
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
    'target', (select lt.amount from lt where lt.branch_id = k.branch_id and lt.client_id = k.client_id),
    'mtd', (select to_jsonb(mt) - 'branch_id' - 'client_id' from mtd mt where mt.branch_id = k.branch_id and mt.client_id = k.client_id))
    order by b.name, c.name), '[]')
  from k join public.branches b on b.id = k.branch_id join public.clients c on c.id = k.client_id
$$;

create or replace function public.collections_view(p_month date default null)
returns jsonb language plpgsql stable security definer set search_path = public, app, pg_temp as $$
declare v_m date := date_trunc('month', coalesce(p_month, app.today()))::date; v_e date; v_all boolean;
begin
  if app.me() is null then raise exception 'Not signed in' using errcode = '28000'; end if;
  v_e := least((v_m + interval '1 month - 1 day')::date, app.today());
  v_all := app.is_admin() or app.has_role('auditor') or app.has_role('ops_head') or app.has_role('collections_head');
  return (
  with vis as (select b.id from public.branches b where v_all union select * from app.visible_branches(v_e) where not v_all),
  lt as (select * from app.loc_targets(v_m, 'collections_received')),
  pairs as (select branch_id, client_id from public.collection_ar where month = v_m
            union select branch_id, client_id from public.collection_daily where entry_date between v_m and v_e
            union select branch_id, client_id from public.client_locations where valid @> v_e
            union select branch_id, client_id from lt),
  mtd as (select x.branch_id, x.client_id, sum(x.bill_count) bc, sum(x.bill_amount) ba, sum(x.rcv_lt30) r1, sum(x.rcv_30_90) r2, sum(x.rcv_90_180) r3, sum(x.rcv_gt180) r4,
                 sum(x.rec_lt30) c1, sum(x.rec_30_90) c2, sum(x.rec_90_180) c3, sum(x.rec_gt180) c4, count(distinct x.entry_date) days
            from public.collection_daily x where x.entry_date between v_m and v_e group by 1, 2),
  cases as (select l.branch_id, l.client_id, sum(l.entry - l.cancelled) n, sum(coalesce(l.revenue, 0)) rev from public.v_line_metrics l where l.work_date between v_m and v_e group by 1, 2)
  select jsonb_build_object('month', v_m, 'as_of', v_e, 'can_review', app.can_review_ar(),
    'rows', (select coalesce(jsonb_agg(jsonb_build_object(
        'branch_id', k.branch_id, 'client_id', k.client_id, 'location', b.name, 'client', c.name, 'zone', z.name,
        'head', (select p.full_name from public.persons p where p.id = coalesce(app.head_of(k.branch_id, k.client_id, 'branch_head', v_e), app.head_of(k.branch_id, k.client_id, 'zonal_manager', v_e))),
        'ar', (select to_jsonb(a) - 'id' || jsonb_build_object('reviewer', (select full_name from public.persons where id = a.reviewed_by))
                 from public.collection_ar a where a.month = v_m and a.branch_id = k.branch_id and a.client_id = k.client_id),
        'target', (select lt.amount from lt where lt.branch_id = k.branch_id and lt.client_id = k.client_id),
        'target_is_branch', exists (select 1 from public.target_allocations t where t.is_current and t.month = v_m and t.metric = 'collections_received'
                                     and t.level = 'branch' and t.branch_id = k.branch_id and t.client_id = k.client_id),
        'mtd', (select to_jsonb(m) - 'branch_id' - 'client_id' from mtd m where m.branch_id = k.branch_id and m.client_id = k.client_id),
        'cases', coalesce((select n from cases cs where cs.branch_id = k.branch_id and cs.client_id = k.client_id), 0),
        'revenue', coalesce((select rev from cases cs where cs.branch_id = k.branch_id and cs.client_id = k.client_id), 0))
        order by z.name nulls last, b.name, c.name), '[]')
      from pairs k join public.branches b on b.id = k.branch_id join public.clients c on c.id = k.client_id
      left join public.branch_zones bz on bz.branch_id = b.id and bz.valid @> v_e left join public.zones z on z.id = bz.zone_id
     where k.branch_id in (select id from vis))));
end $$;

-- Zonal Tracker and Performance read location targets through the same roll-up.
do $do$
declare f text; o text;
begin
  f := pg_get_functiondef('public.tracker_export(date)'::regprocedure); o := f;
  f := regexp_replace(f, 'tgt as \(select t\.branch_id, t\.client_id, t\.amount from public\.target_allocations t\s+where t\.is_current and t\.month = v_m and t\.metric = ''entry'' and t\.level = ''branch'' and t\.client_id is not null\)',
                         'tgt as (select t.branch_id, t.client_id, t.amount from app.loc_targets(v_m, ''entry'') t)');
  f := regexp_replace(f, 'union select t\.branch_id, t\.client_id from public\.target_allocations t where t\.is_current and t\.month = v_m and t\.metric = ''entry'' and t\.level = ''branch'' and t\.client_id is not null',
                         'union select t.branch_id, t.client_id from app.loc_targets(v_m, ''entry'') t');
  if f = o or position('app.loc_targets(v_m, ''entry'') t)' in f) = 0 or position('union select t.branch_id, t.client_id from app.loc_targets' in f) = 0 then
    raise exception 'tracker_export anchors not found'; end if;
  execute f;

  f := pg_get_functiondef('public.perf_dashboard(date)'::regprocedure); o := f;
  f := regexp_replace(f, 'tgt as \(select t\.month, t\.branch_id, t\.client_id, t\.amount from public\.target_allocations t\s+where t\.is_current and t\.metric = ''entry'' and t\.level = ''branch'' and t\.branch_id in \(select id from vis\)\)',
                         'tgt as (select t.month, t.branch_id, t.client_id, t.amount from app.loc_targets(null, ''entry'') t where t.branch_id in (select id from vis))');
  if f = o then raise exception 'perf_dashboard anchor not found'; end if;
  -- people: add revenue targets (person totals) so the dashboard can show the team view in money
  f := replace(f, '''daily'', (select coalesce(jsonb_agg(s order by s.d), ''[]'') from (',
    '''team'', public.team_targets(v_m),
    ''daily'', (select coalesce(jsonb_agg(s order by s.d), ''[]'') from (');
  if position('public.team_targets(v_m)' in f) = 0 then raise exception 'perf_dashboard team anchor not found'; end if;
  execute f;
end $do$;

revoke all on function app.pair_rate(uuid, uuid, date), app.loc_targets(date, text), app.person_target(date, uuid, text) from public, anon;
grant execute on function public.target_template(date), public.save_targets(date, jsonb, boolean, text), public.team_targets(date, uuid) to authenticated;
revoke all on function public.target_template(date), public.save_targets(date, jsonb, boolean, text), public.team_targets(date, uuid) from anon;
