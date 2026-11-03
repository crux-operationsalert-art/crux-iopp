-- P1 (03 Nov, 23:11): My day shows month-to-date so far and today's opening for operations and collections, and
-- people who work on a client they do not head see its collections (read only) instead of only a note.
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
        'prev', (select jsonb_build_object('entry', coalesce(sum(l.entry), 0), 'closure', coalesce(sum(l.closure), 0), 'cancelled', coalesce(sum(l.cancelled), 0),
                                       'revenue', coalesce(sum(l.revenue), 0))
                   from public.v_line_metrics l where l.person_id = app.me() and l.client_location_id = r.cl
                    and l.work_date >= (select m from m0) and l.work_date < (select d from d0)),
        'location', jsonb_build_object(
            'cases', (select amount from app.loc_targets((select m from m0), 'entry') t where t.branch_id = r.branch_id and t.client_id = r.client_id),
            'revenue', (select coalesce(t.amount * app.pair_rate(r.branch_id, r.client_id, (select m from m0)), 0) from app.loc_targets((select m from m0), 'entry') t where t.branch_id = r.branch_id and t.client_id = r.client_id)),
        'location_mtd', (select jsonb_build_object('cases', coalesce(sum(l.entry - l.cancelled), 0), 'revenue', coalesce(sum(l.revenue), 0))
                           from public.v_line_metrics l where l.branch_id = r.branch_id and l.client_id = r.client_id
                            and l.work_date between (select m from m0) and (select d from d0)))), '[]') from rows r))
$$;

create or replace function public.my_collection_day(p_date date default null)
returns jsonb language sql stable security definer set search_path = public, app, pg_temp as $$
  with d0 as (select coalesce(p_date, app.today()) d), m0 as (select date_trunc('month', (select d from d0))::date m),
  k as (select * from app.money_pairs(app.me(), (select d from d0))),
  lt as (select * from app.loc_targets((select m from m0), 'collections_received')),
  mtd as (select x.branch_id, x.client_id, sum(x.bill_count) bc, sum(x.bill_amount) ba,
                 sum(x.rcv_lt30) r1, sum(x.rcv_30_90) r2, sum(x.rcv_90_180) r3, sum(x.rcv_gt180) r4,
                 sum(x.rec_lt30) c1, sum(x.rec_30_90) c2, sum(x.rec_90_180) c3, sum(x.rec_gt180) c4
            from public.collection_daily x where x.entry_date between (select m from m0) and (select d from d0) group by 1, 2),
  prev as (select x.branch_id, x.client_id, sum(x.bill_count) bc, sum(x.bill_amount) ba,
                 sum(x.rcv_lt30) r1, sum(x.rcv_30_90) r2, sum(x.rcv_90_180) r3, sum(x.rcv_gt180) r4,
                 sum(x.rec_lt30) c1, sum(x.rec_30_90) c2, sum(x.rec_90_180) c3, sum(x.rec_gt180) c4
            from public.collection_daily x where x.entry_date >= (select m from m0) and x.entry_date < (select d from d0) group by 1, 2)
  select coalesce(jsonb_agg(jsonb_build_object(
    'branch_id', k.branch_id, 'branch', b.name, 'client_id', k.client_id, 'client', c.name,
    'day', (select jsonb_build_object('bill_count', x.bill_count, 'bill_amount', x.bill_amount,
              'rcv_lt30', x.rcv_lt30, 'rcv_30_90', x.rcv_30_90, 'rcv_90_180', x.rcv_90_180, 'rcv_gt180', x.rcv_gt180,
              'rec_lt30', x.rec_lt30, 'rec_30_90', x.rec_30_90, 'rec_90_180', x.rec_90_180, 'rec_gt180', x.rec_gt180)
              from public.collection_daily x where x.person_id = app.me() and x.entry_date = (select d from d0)
               and x.branch_id = k.branch_id and x.client_id = k.client_id),
    'ar', (select to_jsonb(a) - 'id' from public.collection_ar a where a.month = (select m from m0) and a.branch_id = k.branch_id and a.client_id = k.client_id),
    'target', (select lt.amount from lt where lt.branch_id = k.branch_id and lt.client_id = k.client_id),
    'mtd', (select to_jsonb(mt) - 'branch_id' - 'client_id' from mtd mt where mt.branch_id = k.branch_id and mt.client_id = k.client_id),
    'prev', (select to_jsonb(pv) - 'branch_id' - 'client_id' from prev pv where pv.branch_id = k.branch_id and pv.client_id = k.client_id))
    order by b.name, c.name), '[]')
  from k join public.branches b on b.id = k.branch_id join public.clients c on c.id = k.client_id
$$;


-- Collections at the clients I work on but do not head: read only, so everyone sees what is required and where it stands.
create or replace function public.my_collection_others(p_date date default null)
returns jsonb language sql stable security definer set search_path = public, app, pg_temp as $$
  with d0 as (select coalesce(p_date, app.today()) d), m0 as (select date_trunc('month', (select d from d0))::date m),
  k as (select distinct cl.branch_id, cl.client_id from public.allocations a join public.client_locations cl on cl.id = a.client_location_id
         where a.person_id = app.me() and a.function = 'operations' and a.valid @> (select d from d0)
        except select * from app.money_pairs(app.me(), (select d from d0))),
  lt as (select * from app.loc_targets((select m from m0), 'collections_received')),
  agg as (select x.branch_id, x.client_id,
                 sum(x.bill_count) filter (where x.entry_date = (select d from d0)) t_bc, sum(x.bill_amount) filter (where x.entry_date = (select d from d0)) t_ba,
                 sum(x.rcv_lt30 + x.rcv_30_90 + x.rcv_90_180 + x.rcv_gt180) filter (where x.entry_date = (select d from d0)) t_rcv,
                 sum(x.rec_lt30 + x.rec_30_90 + x.rec_90_180 + x.rec_gt180) filter (where x.entry_date = (select d from d0)) t_rec,
                 sum(x.rcv_lt30) filter (where x.entry_date < (select d from d0)) p1, sum(x.rcv_30_90) filter (where x.entry_date < (select d from d0)) p2,
                 sum(x.rcv_90_180) filter (where x.entry_date < (select d from d0)) p3, sum(x.rcv_gt180) filter (where x.entry_date < (select d from d0)) p4,
                 sum(x.rcv_lt30 + x.rcv_30_90 + x.rcv_90_180 + x.rcv_gt180) mtd_rcv, sum(x.rec_lt30 + x.rec_30_90 + x.rec_90_180 + x.rec_gt180) mtd_rec,
                 sum(x.bill_count) mtd_bc, sum(x.bill_amount) mtd_ba
            from public.collection_daily x where x.entry_date between (select m from m0) and (select d from d0) group by 1, 2)
  select coalesce(jsonb_agg(jsonb_build_object('branch_id', k.branch_id, 'branch', b.name, 'client_id', k.client_id, 'client', c.name,
      'head', (select p.full_name from public.persons p where p.id = coalesce(app.head_of(k.branch_id, k.client_id, 'branch_head', (select d from d0)),
                                                                             app.head_of(k.branch_id, k.client_id, 'zonal_manager', (select d from d0)))),
      'target', (select lt.amount from lt where lt.branch_id = k.branch_id and lt.client_id = k.client_id),
      'ar', (select jsonb_build_object('ar_lt30', a.ar_lt30, 'ar_30_90', a.ar_30_90, 'ar_90_180', a.ar_90_180, 'ar_gt180', a.ar_gt180)
               from public.collection_ar a where a.month = (select m from m0) and a.branch_id = k.branch_id and a.client_id = k.client_id),
      'agg', (select to_jsonb(g) - 'branch_id' - 'client_id' from agg g where g.branch_id = k.branch_id and g.client_id = k.client_id))
      order by b.name, c.name), '[]')
  from k join public.branches b on b.id = k.branch_id join public.clients c on c.id = k.client_id
$$;
grant execute on function public.my_collection_others(date) to authenticated;
revoke all on function public.my_collection_others(date) from anon;
