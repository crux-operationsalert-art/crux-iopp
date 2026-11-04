-- D-72 "Me and my team" split (owner, 04 Nov): beside revenue / collection vs target, the sum of what is entered daily —
--   operations: received · entry · closed · cancelled · pending now, pending split by age, average and median age;
--   collections: receivables at the start of the month, bills raised, received, reconciled, outstanding;
--   people: headcount, own vs partner, by designation, by location, revenue per head and per man-hour.
-- Each person row = that person and everyone under them (as their target is). Age figures come from the age buckets
-- people enter (an exact age per case is not recorded): average uses bucket mid-points (0.5, 1.5, 3, 5.5, 11 days;
-- 15+ counted as 20); the median is the bucket that holds the middle case.

create or replace function app.ops_split(p_people uuid[], p_from date, p_to date) returns jsonb
language sql stable security definer set search_path = public, app, pg_temp as $$
  with m as (select coalesce(sum(l.entry), 0) received, coalesce(sum(l.logged), 0) logged, count(l.logged) logged_rows, count(*) lines,
                    coalesce(sum(l.closure), 0) closed, coalesce(sum(l.cancelled), 0) cancelled
               from public.productivity_lines l where l.person_id = any(p_people) and l.work_date between p_from and p_to),
  last as (select distinct on (l.person_id, l.client_location_id) l.*
             from public.productivity_lines l
            where l.person_id = any(p_people) and l.work_date <= p_to and l.work_date >= p_from - 45 and l.tat_0_1 is not null
              and exists (select 1 from public.allocations a where a.person_id = l.person_id and a.client_location_id = l.client_location_id
                           and a.function = 'operations' and a.valid @> p_to)
            order by l.person_id, l.client_location_id, l.work_date desc),
  b as (select coalesce(sum(tat_0_1), 0) b1, coalesce(sum(tat_1_2), 0) b2, coalesce(sum(tat_2_4), 0) b3, coalesce(sum(tat_4_7), 0) b4,
               coalesce(sum(tat_7_15), 0) b5, coalesce(sum(tat_15p), 0) b6 from last),
  t as (select b.*, b1 + b2 + b3 + b4 + b5 + b6 pending from b)
  select jsonb_build_object('received', m.received, 'logged', m.logged, 'logged_known', m.logged_rows = m.lines, 'closed', m.closed, 'cancelled', m.cancelled,
    'billable', m.received - m.cancelled, 'pending', t.pending,
    'buckets', jsonb_build_object('0-1', t.b1, '1-2', t.b2, '2-4', t.b3, '4-7', t.b4, '7-15', t.b5, '15+', t.b6),
    'avg_age', case when t.pending > 0 then round((0.5 * t.b1 + 1.5 * t.b2 + 3 * t.b3 + 5.5 * t.b4 + 11 * t.b5 + 20 * t.b6) / t.pending, 1) end,
    'median_bucket', case when t.pending = 0 then null
                          when t.b1 >= t.pending / 2.0 then '0-1' when t.b1 + t.b2 >= t.pending / 2.0 then '1-2'
                          when t.b1 + t.b2 + t.b3 >= t.pending / 2.0 then '2-4' when t.b1 + t.b2 + t.b3 + t.b4 >= t.pending / 2.0 then '4-7'
                          when t.pending - t.b6 >= t.pending / 2.0 then '7-15' else '15+' end)
    from m, t
$$;

create or replace function app.money_split(p_people uuid[], p_from date, p_to date) returns jsonb
language sql stable security definer set search_path = public, app, pg_temp as $$
  with d as (select coalesce(sum(x.bill_count), 0) bc, coalesce(sum(x.bill_amount), 0) ba,
                    coalesce(sum(x.rcv_lt30 + x.rcv_30_90 + x.rcv_90_180 + x.rcv_gt180), 0) rcv,
                    coalesce(sum(x.rec_lt30 + x.rec_30_90 + x.rec_90_180 + x.rec_gt180), 0) rec,
                    coalesce(sum(x.rcv_lt30), 0) r1, coalesce(sum(x.rcv_30_90), 0) r2, coalesce(sum(x.rcv_90_180), 0) r3, coalesce(sum(x.rcv_gt180), 0) r4
               from public.collection_daily x where x.person_id = any(p_people) and x.entry_date between p_from and p_to)
  select jsonb_build_object('bills', d.bc, 'billed', d.ba, 'received', d.rcv, 'reconciled', d.rec,
                            'received_by_age', jsonb_build_object('<30', d.r1, '30-90', d.r2, '90-180', d.r3, '>180', d.r4)) from d
$$;

create or replace function public.team_breakdown(p_month date, p_person uuid default null)
returns jsonb language plpgsql stable security definer set search_path = public, app, pg_temp as $$
declare v_m date := date_trunc('month', p_month)::date; v_e date; v_to date; v_p uuid := coalesce(p_person, app.me()); v_all uuid[];
        v_hours numeric; v_half numeric;
begin
  if app.me() is null then raise exception 'Not signed in' using errcode = '28000'; end if;
  v_e := (v_m + interval '1 month - 1 day')::date; v_to := least(app.today(), v_e);
  if v_p <> app.me() and not (app.can_view_person(v_p, greatest(v_m, v_to), 'operations') or app.can_view_person(v_p, greatest(v_m, v_to), 'collections')) then
    raise exception 'Not permitted.' using errcode = '42501';
  end if;
  v_hours := extract(epoch from ((app.setting('shift_end') #>> '{}')::time - (app.setting('shift_start') #>> '{}')::time)) / 3600
             - coalesce((app.setting('break_minutes') #>> '{}')::numeric, 0) / 60;
  v_half := coalesce((app.setting('half_day_hours') #>> '{}')::numeric, v_hours / 2);
  select array_agg(distinct x) into v_all from (select v_p x union select s.person_id from app.subtree(v_p, 'operations', v_to) s
                                                 union select s.person_id from app.subtree(v_p, 'collections', v_to) s) z;
  return (
  with ppl as (select v_p id, 0 lvl union select r.person_id, 1 from public.reporting_lines r where r.manager_id = v_p and r.valid @> v_to),
  grp as (select k.id, k.lvl, (select array_agg(distinct y) from (select k.id y union select s.person_id from app.subtree(k.id, 'operations', v_to) s
                                                                  union select s.person_id from app.subtree(k.id, 'collections', v_to) s) q) mem
            from ppl k join public.persons p on p.id = k.id where p.status in ('active','invited')),
  hr as (select p.id, p.designation, p.resource_type::text rt from public.persons p where p.id = any(v_all) and p.status in ('active','invited')),
  loc as (select distinct a.person_id, b.name, b.branch_type from public.allocations a join public.client_locations cl on cl.id = a.client_location_id
            join public.branches b on b.id = cl.branch_id where a.person_id = any(v_all) and a.valid @> v_to),
  days as (select coalesce(sum(case when a.status = 'half_day' then 0.5 when a.status in ('present','late','early_leave') then 1 else 0 end), 0) att,
                  coalesce(sum(case when a.status = 'half_day' then 1 else 0 end), 0) halves
             from public.attendance a where a.person_id = any(v_all) and a.work_date between v_m and v_to),
  auto as (select count(*) n from public.day_status d where d.person_id = any(v_all) and d.work_date between v_m and v_to and d.function = 'operations'
             and d.status in ('submitted','manager_entered')
             and not exists (select 1 from public.attendance a where a.person_id = d.person_id and a.work_date = d.work_date)),
  rev as (select coalesce(sum(m.revenue), 0) r from public.v_line_metrics m where m.person_id = any(v_all) and m.work_date between v_m and v_to),
  pairs as (select distinct cl.branch_id, cl.client_id from public.location_heads h
              join public.client_locations cl on cl.branch_id = h.branch_id and (h.client_id is null or h.client_id = cl.client_id) and cl.valid @> v_to
             where h.person_id = any(v_all) and h.head_role = 'branch_head' and h.valid @> v_to),
  ar as (select coalesce(sum(a.ar_lt30 + a.ar_30_90 + a.ar_90_180 + a.ar_gt180), 0) s, count(*) n from public.collection_ar a join pairs k using (branch_id, client_id) where a.month = v_m),
  pd as (select coalesce(sum(x.bill_amount), 0) ba, coalesce(sum(x.rcv_lt30 + x.rcv_30_90 + x.rcv_90_180 + x.rcv_gt180), 0) rcv
           from public.collection_daily x join pairs k using (branch_id, client_id) where x.entry_date between v_m and v_to)
  select jsonb_build_object('month', v_m, 'as_of', v_to, 'hours_per_day', v_hours,
    'scope', app.ops_split(v_all, v_m, v_to) || jsonb_build_object('money', app.money_split(v_all, v_m, v_to)),
    'receivables', jsonb_build_object('start', (select s from ar), 'pairs_with_receivables', (select n from ar), 'pairs', (select count(*) from pairs),
                                      'billed', (select ba from pd), 'received', (select rcv from pd),
                                      'outstanding', (select s from ar) + (select ba from pd) - (select rcv from pd)),
    'people', (select coalesce(jsonb_agg(jsonb_build_object('person_id', g.id, 'self', g.lvl = 0, 'ops', app.ops_split(g.mem, v_m, v_to),
                                                            'money', app.money_split(g.mem, v_m, v_to), 'headcount', cardinality(g.mem))), '[]') from grp g),
    'hr', jsonb_build_object(
      'headcount', (select count(*) from hr), 'own', (select count(*) from hr where rt = 'own_employee'), 'partner', (select count(*) from hr where rt = 'partner'),
      'by_designation', (select coalesce(jsonb_agg(jsonb_build_object('designation', d, 'n', n) order by n desc, d), '[]')
                           from (select coalesce(designation, 'Not set') d, count(*) n from hr group by 1) z),
      'by_location', (select coalesce(jsonb_agg(jsonb_build_object('location', name, 'type', branch_type, 'n', n) order by n desc, name), '[]')
                        from (select name, branch_type, count(distinct person_id) n from loc group by 1, 2) z),
      'locations_own', (select count(distinct name) from loc where branch_type = 'own'), 'locations_partner', (select count(distinct name) from loc where branch_type = 'partner'),
      'man_days', (select att from days) + (select n from auto),
      'man_hours', round(((select att - 0.5 * halves from days) + (select n from auto)) * v_hours + (select halves from days) * v_half, 1),
      'revenue', (select r from rev),
      'revenue_per_head', case when (select count(*) from hr) > 0 then round((select r from rev) / (select count(*) from hr), 0) end,
      'revenue_per_man_hour', case when ((select att from days) + (select n from auto)) > 0
        then round((select r from rev) / nullif(((select att - 0.5 * halves from days) + (select n from auto)) * v_hours + (select halves from days) * v_half, 0), 0) end)));
end $$;
grant execute on function public.team_breakdown(date, uuid) to authenticated;
revoke all on function public.team_breakdown(date, uuid), app.ops_split(uuid[], date, date), app.money_split(uuid[], date, date) from public, anon;
