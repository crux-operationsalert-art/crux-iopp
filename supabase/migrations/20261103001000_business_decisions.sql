-- Business decisions confirmed by the owner on 03 Nov 2026 (DECISIONS.md D-01, D-03, D-04, D-19).
-- Written additively (no DROP) so it applies without destructive-change confirmation.
-- D-03: revenue for performance/targets = cases × rate; an entered case earns once it is in WIP or closed and a
--       cancellation reverses it  ⇒ billable_event 'entry' with reverse_cancellations = true (the default).
--       Bills raised and collections are separate money; collections are received against bills.
-- D-04: partner ratio is bookkeeping only (e.g. 80:20 = partner/BA 80, CRUX 20); never calculated into revenue.

alter table public.rate_cards add column if not exists reverse_cancellations boolean not null default true;
alter table public.rate_cards alter column billable_event set default 'entry';
comment on column public.rate_cards.billable_event is
  'Quantity the rate applies to. Default entry with reverse_cancellations = true (D-03): entered cases earn, cancelled cases are subtracted.';

-- Branches loaded from the tracker have an unknown own/partner type until Admin confirms it.
alter table public.branches add column if not exists type_confirmed boolean not null default true;
alter table public.zones add column if not exists region text;

comment on table public.partner_share_rules is
  'Bookkeeping only (D-04). partner_share_pct = Business Associate share, crux_share_pct = CRUX (80:20 means partner 80, CRUX 20). Never used in revenue calculations.';

alter table public.collection_entries add column if not exists bill_id uuid references public.bill_entries(id);

-- Same columns as before (share columns kept for compatibility but always NULL: no partner calculation).
create or replace view public.v_line_metrics with (security_invoker = true) as
select l.id, l.person_id, l.work_date, l.client_location_id, l.source,
       cl.client_id, cl.location_id, cl.process_id, cl.branch_id, bz.zone_id,
       l.entry, l.closure, l.cancelled,
       l.entry + l.closure - l.cancelled as net_actioned,
       l.entry + l.closure as gross_actions,
       rc.id as rate_card_id, rc.rate, rc.billable_event,
       q.qty as billable_qty,
       round(rc.rate * q.qty, 2) as revenue,
       null::numeric(5,2) as crux_share_pct, null::numeric(5,2) as partner_share_pct,
       null::numeric as partner_share, null::numeric as crux_share
  from public.productivity_lines l
  join public.client_locations cl on cl.id = l.client_location_id
  left join public.branch_zones bz on bz.branch_id = cl.branch_id and bz.valid @> l.work_date
  left join public.rate_cards rc on rc.client_id = cl.client_id and rc.location_id = cl.location_id
                                 and rc.process_id = cl.process_id and rc.valid @> l.work_date
  cross join lateral (select case rc.billable_event
      when 'entry' then l.entry - case when rc.reverse_cancellations then l.cancelled else 0 end
      when 'closure' then l.closure
      when 'net_actioned' then l.entry + l.closure - l.cancelled end as qty) q;

create or replace function public.ops_rollup(p_from date, p_to date, p_group text,
    p_zone_id uuid default null, p_branch_id uuid default null, p_person_id uuid default null,
    p_client_id uuid default null, p_location_id uuid default null)
returns table(key text, label text, entry bigint, closure bigint, cancelled bigint, net_actioned bigint,
              revenue numeric, crux_share numeric, partner_share numeric, lines bigint, unrated_lines bigint)
language plpgsql stable security invoker set search_path = public, app, pg_temp as $$
begin
  if p_group not in ('zone','branch','person','client','location','date') then
    raise exception 'Unsupported grouping.' using errcode = '22023';
  end if;
  if p_to - p_from > 400 then raise exception 'Date range too long (max 400 days).' using errcode = '22023'; end if;
  return query
  select g.k, g.l, sum(m.entry)::bigint, sum(m.closure)::bigint, sum(m.cancelled)::bigint, sum(m.net_actioned)::bigint,
         coalesce(sum(m.revenue),0), null::numeric, null::numeric,
         count(*), count(*) filter (where m.rate_card_id is null)
    from public.v_line_metrics m
    left join public.zones z on z.id = m.zone_id
    left join public.branches b on b.id = m.branch_id
    left join public.persons p on p.id = m.person_id
    left join public.clients c on c.id = m.client_id
    left join public.locations lo on lo.id = m.location_id
    cross join lateral (select case p_group when 'zone' then m.zone_id::text when 'branch' then m.branch_id::text
                                  when 'person' then m.person_id::text when 'client' then m.client_id::text
                                  when 'location' then m.location_id::text else m.work_date::text end as k,
                               case p_group when 'zone' then coalesce(z.name,'(no zone)') when 'branch' then b.name
                                  when 'person' then p.full_name when 'client' then c.name
                                  when 'location' then lo.name else to_char(m.work_date,'DD Mon') end as l) g
   where m.work_date between p_from and p_to
     and (p_zone_id is null or m.zone_id = p_zone_id) and (p_branch_id is null or m.branch_id = p_branch_id)
     and (p_person_id is null or m.person_id = p_person_id) and (p_client_id is null or m.client_id = p_client_id)
     and (p_location_id is null or m.location_id = p_location_id)
   group by g.k, g.l
   order by case when p_group = 'date' then g.k end, sum(m.net_actioned) desc;
end $$;

-- Billed vs collected vs outstanding (D-03): outstanding = bills raised − collections received.
create or replace function public.collections_summary(p_from date, p_to date, p_group text,
    p_zone_id uuid default null, p_branch_id uuid default null, p_client_id uuid default null)
returns table(key text, label text, received numeric, reconciled numeric, unreconciled numeric, entries bigint,
              bill_count bigint, bill_amount numeric, outstanding numeric)
language plpgsql stable security invoker set search_path = public, app, pg_temp as $$
begin
  if p_group not in ('zone','branch','person','client','date') then
    raise exception 'Unsupported grouping.' using errcode = '22023';
  end if;
  return query
  with c as (
    select case p_group when 'zone' then v.zone_id::text when 'branch' then v.branch_id::text
                        when 'person' then v.person_id::text when 'client' then v.client_id::text
                        else v.collection_date::text end as k,
           v.amount_received r, v.amount_reconciled rc, 0 bc, 0::numeric ba
      from public.v_collections v
     where v.collection_date between p_from and p_to and (p_zone_id is null or v.zone_id = p_zone_id)
       and (p_branch_id is null or v.branch_id = p_branch_id) and (p_client_id is null or v.client_id = p_client_id)
    union all
    select case p_group when 'zone' then bz.zone_id::text when 'branch' then b.branch_id::text
                        when 'person' then b.person_id::text when 'client' then b.client_id::text
                        else b.bill_date::text end,
           0, 0, b.bill_count, b.bill_amount
      from public.bill_entries b
      left join public.branch_zones bz on bz.branch_id = b.branch_id and bz.valid @> b.bill_date
     where b.bill_date between p_from and p_to and b.status <> 'cancelled' and (p_zone_id is null or bz.zone_id = p_zone_id)
       and (p_branch_id is null or b.branch_id = p_branch_id) and (p_client_id is null or b.client_id = p_client_id)
  )
  select c.k, coalesce(z.name, br.name, p.full_name, cl.name, c.k),
         sum(c.r), sum(c.rc), sum(c.r) - sum(c.rc), count(*) filter (where c.r > 0 or c.rc > 0),
         sum(c.bc)::bigint, sum(c.ba), sum(c.ba) - sum(c.r)
    from c
    left join public.zones z on p_group = 'zone' and z.id::text = c.k
    left join public.branches br on p_group = 'branch' and br.id::text = c.k
    left join public.persons p on p_group = 'person' and p.id::text = c.k
    left join public.clients cl on p_group = 'client' and cl.id::text = c.k
   group by c.k, z.name, br.name, p.full_name, cl.name
   order by case when p_group = 'date' then c.k end, sum(c.ba) desc;
end $$;
revoke all on function public.collections_summary(date, date, text, uuid, uuid, uuid) from anon, public;
grant execute on function public.collections_summary(date, date, text, uuid, uuid, uuid) to authenticated;
