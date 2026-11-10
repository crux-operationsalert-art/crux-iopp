-- D-86b Collections rows in daily updates. The location head (or the zonal manager where there is no head) gets the
-- branch × client pairs they are responsible for (D-86). Anyone else who works on the client may still enter (D-59), but
-- only clients they actually work on now: ticked today AND with figures entered in the last 30 days (or collections they
-- already entered this month). A tick on a client nobody works on no longer adds a collections row.
create or replace function app.collection_pairs(p_person uuid, p_date date)
returns table(branch_id uuid, client_id uuid, is_head boolean)
language sql stable security definer set search_path = public, app, pg_temp as $$
  with h as (select * from app.money_pairs(p_person, p_date)),
  a as (select distinct cl.branch_id, cl.client_id from public.allocations al join public.client_locations cl on cl.id = al.client_location_id
         where al.person_id = p_person and al.function = 'operations' and al.valid @> p_date and cl.valid @> p_date
           and exists (select 1 from public.productivity_lines l join public.client_locations c2 on c2.id = l.client_location_id
                        where l.person_id = p_person and c2.branch_id = cl.branch_id and c2.client_id = cl.client_id
                          and l.work_date between p_date - 30 and p_date)
        union
        select distinct d.branch_id, d.client_id from public.collection_daily d
         where coalesce(d.entered_by, d.person_id) = p_person and d.entry_date between date_trunc('month', p_date)::date and p_date)
  select h.branch_id, h.client_id, true from h
  union
  select a.branch_id, a.client_id, false from a where not exists (select 1 from h where h.branch_id = a.branch_id and h.client_id = a.client_id)
$$;
