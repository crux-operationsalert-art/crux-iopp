-- D-71 Monthly receivables are a one-time entry (owner, 04 Nov): the head enters them once for the month (changes
-- allowed the same day for typing mistakes); after that only the Collections Head can change them (with a reason, as
-- now). Outstanding then works itself out: receivables + bills raised − received. Next month starts from last month's
-- closing — last month's bills in "< 30 days", unpaid "< 30" aged into "30–90", the rest per bucket — offered pre-filled to check.
do $do$
declare f text; o text;
begin
  f := pg_get_functiondef('public.save_ar(date,jsonb)'::regprocedure); o := f;
  f := replace(f, '    insert into public.collection_ar as a (month, branch_id, client_id,',
'    if exists (select 1 from public.collection_ar a where a.month = v_m and a.branch_id = (r->>''branch_id'')::uuid and a.client_id = (r->>''client_id'')::uuid
                and (a.entered_at at time zone app.tz())::date < app.today())
       and not app.can_review_ar() then
      raise exception ''This month''''s receivables are already set (one entry a month). The Collections Head can change them with a reason.'' using errcode = ''P0001'';
    end if;
    insert into public.collection_ar as a (month, branch_id, client_id,');
  if f = o then raise exception 'save_ar anchor not found'; end if;
  execute f;
end $do$;

create or replace function public.ar_carry(p_month date)
returns table(branch_id uuid, client_id uuid, ar_lt30 numeric, ar_30_90 numeric, ar_90_180 numeric, ar_gt180 numeric)
language sql stable security definer set search_path = public, app, pg_temp as $$
  with pm as (select (date_trunc('month', p_month) - interval '1 month')::date m),
  mine as (select k.branch_id, k.client_id from app.collection_pairs(app.me(), app.today()) k),
  d as (select x.branch_id, x.client_id, sum(x.rcv_lt30) r1, sum(x.rcv_30_90) r2, sum(x.rcv_90_180) r3, sum(x.rcv_gt180) r4, sum(x.bill_amount) ba
          from public.collection_daily x, pm where x.entry_date >= pm.m and x.entry_date < (pm.m + interval '1 month')::date group by 1, 2)
  select a.branch_id, a.client_id,
         coalesce(d.ba, 0),                                                                   -- last month's bills are now < 30 days old
         greatest(0, a.ar_lt30 - coalesce(d.r1, 0)) + greatest(0, a.ar_30_90 - coalesce(d.r2, 0)),   -- unpaid < 30 has aged into 30–90
         greatest(0, a.ar_90_180 - coalesce(d.r3, 0)), greatest(0, a.ar_gt180 - coalesce(d.r4, 0))
    from public.collection_ar a join pm on a.month = pm.m
    join mine k on k.branch_id = a.branch_id and k.client_id = a.client_id
    left join d on d.branch_id = a.branch_id and d.client_id = a.client_id
$$;
grant execute on function public.ar_carry(date) to authenticated;
revoke all on function public.ar_carry(date) from public, anon;
