-- D-58 (P1, 04 Nov): close the remaining people-data leaks and open daily collections to everyone on a client.
--
-- Leaks found in the audit and why they happened:
--   a) Salary to-dos went to the person's line manager and were visible to anyone who could see that manager or the
--      employee (BI & Growth / Leadership see everyone) — e.g. "Enter monthly salary for …" in other people's Tasks.
--   b) Line managers could read their direct reports' salaries; salary is HR's (owner, 04 Nov).
--   c) The read-only Activity log carried before/after copies of salary and HR profile rows to non-HR readers.
--   d) Partner agreements were readable by BI & Growth but not by HR.
-- Fixes: salary to-dos are owned by HR (else the Admin queue) and are visible only to their owner, HR and Admin;
-- salary is HR / Admin / the person only; HR tables never appear in the Activity log for non-HR readers.
--
-- Also: the person-level "collected this month" double-counted, because the daily entry was mirrored into two older
-- ledgers that the target maths also read. The maths now reads the daily entries only.

-- HR owner for HR to-dos: the first HR person (active before invited), else nobody → Admin queue.
create or replace function app.hr_owner() returns uuid
language sql stable security definer set search_path = public, app, pg_temp as $$
  select p.id from public.persons p join public.role_assignments r on r.person_id = p.id and r.role = 'hr_admin' and r.valid @> app.today()
   where p.status in ('active','invited') order by (p.status = 'active') desc, p.created_at limit 1
$$;

create or replace function app.task_sensitive(p_kind text) returns boolean
language sql immutable as $$ select p_kind in ('salary_missing', 'hr_document', 'police_verification_hr') $$;

create or replace function app.task_visible(p_owner uuid, p_subject uuid) returns boolean
language sql stable security definer set search_path = public, app, pg_temp as $$
  select app.me() is not null and (app.is_admin() or app.has_role('hr_admin')
    or (p_owner is not null and app.can_view_person(p_owner, app.today(), 'operations'))
    or (p_subject is not null and app.can_view_person(p_subject, app.today(), 'operations')))
$$;

-- tasks: sensitive kinds only for their owner, HR and Admin.
alter policy read_tasks on public.tasks
  using (((select app.is_admin() or app.has_role('hr_admin')) or owner_id = (select app.me()))
         or (not app.task_sensitive(kind)
             and ((select app.has_role('auditor'))
                  or owner_id = any ((select app.my_people('operations'))::uuid[]) or subject_id = any ((select app.my_people('operations'))::uuid[]))));

do $do$
declare f text; o text;
begin
  -- my_tasks: same rule
  f := pg_get_functiondef('public.my_tasks(text)'::regprocedure); o := f;
  f := replace(f, '   where app.task_visible(t.owner_id, t.subject_id)',
                  '   where app.task_visible(t.owner_id, t.subject_id)
     and (not app.task_sensitive(t.kind) or t.owner_id = v_me or v_admin or app.has_role(''hr_admin''))');
  if f = o then raise exception 'my_tasks anchor not found'; end if;
  execute f;
  -- salary to-dos go to HR
  f := pg_get_functiondef('app.sync_core(boolean)'::regprocedure); o := f;
  f := replace(f, 'perform app.task_upsert(''salary_missing'', ''task'', ''salary:'' || r.id, app.manager_of(r.id), r.id,',
                  'perform app.task_upsert(''salary_missing'', ''task'', ''salary:'' || r.id, app.hr_owner(), r.id,');
  if f = o then raise exception 'sync_core salary anchor not found'; end if;
  execute f;
  -- salary: HR / Admin only
  f := pg_get_functiondef('public.set_salary(uuid,numeric,date,text)'::regprocedure); o := f;
  f := replace(f, 'if not (app.is_admin() or app.has_role(''hr_admin'') or app.is_direct_report(p_person, ''operations'', app.today())
                 or app.is_direct_report(p_person, ''collections'', app.today())) then',
                  'if not (app.is_admin() or app.has_role(''hr_admin'')) then');
  if f = o then
    f := regexp_replace(o, 'if not \(app\.is_admin\(\) or app\.has_role\(''hr_admin''\) or app\.is_direct_report\(p_person, ''operations'', app\.today\(\)\)\s+or app\.is_direct_report\(p_person, ''collections'', app\.today\(\)\)\) then',
                           'if not (app.is_admin() or app.has_role(''hr_admin'')) then');
    if f = o then raise exception 'set_salary anchor not found'; end if;
  end if;
  execute f;
end $do$;

update public.tasks set owner_id = app.hr_owner(), updated_at = now() where kind = 'salary_missing' and status <> 'resolved';

alter policy read_salary on public.hr_compensation
  using (person_id = (select app.me()) or (select app.is_admin() or app.has_role('hr_admin')));
alter policy read_audit on public.audit_events
  using ((select app.is_admin() or app.has_role('hr_admin'))
         or ((select app.has_role('auditor')) and table_name not in ('hr_compensation', 'hr_profiles', 'person_documents', 'police_verifications')));
alter policy read_partner_agreements on public.partner_agreements using ((select app.sees_all() or app.has_role('hr_admin')));
alter policy read_partner_share on public.partner_share_rules
  using ((select app.sees_all() or app.has_role('hr_admin')) or ((select app.has_role('zm') or app.has_role('bm') or app.has_role('ba') or app.has_role('ops_head'))
                                     and branch_id = any ((select app.my_branches())::uuid[])));

-- Target maths: collections and bills from the daily entries only (no double count).
create or replace function app.metric_actual(p_metric text, p_from date, p_to date, p_level text,
                                             p_zone uuid, p_branch uuid, p_person uuid, p_client uuid)
returns numeric language plpgsql stable security definer set search_path = public, app, pg_temp as $$
declare v numeric; v_people uuid[];
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
  return v;
end $$;

-- D-59: daily collections are one figure per client · location per day. The location head is responsible (their day is
-- not complete without it); anyone who works on that client can also enter or correct it (the head is told).
create or replace function app.collection_pairs(p_person uuid, p_date date)
returns table(branch_id uuid, client_id uuid, is_head boolean)
language sql stable security definer set search_path = public, app, pg_temp as $$
  with h as (select * from app.money_pairs(p_person, p_date)),
  a as (select distinct cl.branch_id, cl.client_id from public.allocations al join public.client_locations cl on cl.id = al.client_location_id
         where al.person_id = p_person and al.function = 'operations' and al.valid @> p_date and cl.valid @> p_date)
  select h.branch_id, h.client_id, true from h
  union
  select a.branch_id, a.client_id, false from a where not exists (select 1 from h where h.branch_id = a.branch_id and h.client_id = a.client_id)
$$;
revoke all on function app.collection_pairs(uuid, date) from public, anon;

create or replace function public.my_collection_day(p_date date default null)
returns jsonb language sql stable security definer set search_path = public, app, pg_temp as $$
  with d0 as (select coalesce(p_date, app.today()) d), m0 as (select date_trunc('month', (select d from d0))::date m),
  k as (select * from app.collection_pairs(app.me(), (select d from d0))),
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
    'branch_id', k.branch_id, 'branch', b.name, 'client_id', k.client_id, 'client', c.name, 'is_head', k.is_head,
    'head', (select p.full_name from public.persons p where p.id = coalesce(app.head_of(k.branch_id, k.client_id, 'branch_head', (select d from d0)),
                                                                           app.head_of(k.branch_id, k.client_id, 'zonal_manager', (select d from d0)))),
    'day', (select jsonb_build_object('bill_count', x.bill_count, 'bill_amount', x.bill_amount,
              'rcv_lt30', x.rcv_lt30, 'rcv_30_90', x.rcv_30_90, 'rcv_90_180', x.rcv_90_180, 'rcv_gt180', x.rcv_gt180,
              'rec_lt30', x.rec_lt30, 'rec_30_90', x.rec_30_90, 'rec_90_180', x.rec_90_180, 'rec_gt180', x.rec_gt180,
              'entered_by', (select full_name from public.persons where id = coalesce(x.entered_by, x.person_id)))
              from public.collection_daily x where x.entry_date = (select d from d0)
               and x.branch_id = k.branch_id and x.client_id = k.client_id order by x.updated_at desc nulls last limit 1),
    'ar', (select to_jsonb(a) - 'id' from public.collection_ar a where a.month = (select m from m0) and a.branch_id = k.branch_id and a.client_id = k.client_id),
    'target', (select lt.amount from lt where lt.branch_id = k.branch_id and lt.client_id = k.client_id),
    'mtd', (select to_jsonb(mt) - 'branch_id' - 'client_id' from mtd mt where mt.branch_id = k.branch_id and mt.client_id = k.client_id),
    'prev', (select to_jsonb(pv) - 'branch_id' - 'client_id' from prev pv where pv.branch_id = k.branch_id and pv.client_id = k.client_id))
    order by k.is_head desc, b.name, c.name), '[]')
  from k join public.branches b on b.id = k.branch_id join public.clients c on c.id = k.client_id
$$;

create or replace function public.save_collection_day(p_date date, p_rows jsonb)
returns integer language plpgsql security definer set search_path = public, app, pg_temp as $$
declare r jsonb; v_me uuid := app.me(); n int := 0; v_b uuid; v_c uuid; f text; v_rcv numeric; v_rec numeric; v_id uuid; v_head uuid;
  req text[] := array['bill_count','bill_amount','rcv_lt30','rcv_30_90','rcv_90_180','rcv_gt180','rec_lt30','rec_30_90','rec_90_180','rec_gt180'];
begin
  if v_me is null then raise exception 'Not signed in' using errcode = '28000'; end if;
  perform app.require_writable(v_me, p_date, 'operations');
  perform set_config('app.reason', 'daily collections', true);
  for r in select * from jsonb_array_elements(coalesce(p_rows, '[]')) loop
    v_b := (r->>'branch_id')::uuid; v_c := (r->>'client_id')::uuid;
    if not exists (select 1 from app.collection_pairs(v_me, p_date) k where k.branch_id = v_b and k.client_id = v_c) and not app.can_review_ar() then
      raise exception 'You do not work on that client at that location.' using errcode = '42501';
    end if;
    foreach f in array req loop
      if r->>f is null or r->>f = '' then raise exception 'Every collections box is required (enter 0 if none): %', replace(f, '_', ' ') using errcode = 'P0001'; end if;
    end loop;
    v_rcv := (r->>'rcv_lt30')::numeric + (r->>'rcv_30_90')::numeric + (r->>'rcv_90_180')::numeric + (r->>'rcv_gt180')::numeric;
    v_rec := (r->>'rec_lt30')::numeric + (r->>'rec_30_90')::numeric + (r->>'rec_90_180')::numeric + (r->>'rec_gt180')::numeric;
    v_head := coalesce(app.head_of(v_b, v_c, 'branch_head', p_date), app.head_of(v_b, v_c, 'zonal_manager', p_date));
    select x.id into v_id from public.collection_daily x where x.entry_date = p_date and x.branch_id = v_b and x.client_id = v_c
     order by (x.person_id = v_head) desc, x.updated_at desc nulls last limit 1;
    if v_id is null then
      insert into public.collection_daily(person_id, entry_date, branch_id, client_id, bill_count, bill_amount, received, reconciled,
        rcv_lt30, rcv_30_90, rcv_90_180, rcv_gt180, rec_lt30, rec_30_90, rec_90_180, rec_gt180, entered_by)
      values (coalesce(v_head, v_me), p_date, v_b, v_c, (r->>'bill_count')::int, (r->>'bill_amount')::numeric, v_rcv, v_rec,
        (r->>'rcv_lt30')::numeric, (r->>'rcv_30_90')::numeric, (r->>'rcv_90_180')::numeric, (r->>'rcv_gt180')::numeric,
        (r->>'rec_lt30')::numeric, (r->>'rec_30_90')::numeric, (r->>'rec_90_180')::numeric, (r->>'rec_gt180')::numeric, v_me);
    else
      update public.collection_daily set bill_count = (r->>'bill_count')::int, bill_amount = (r->>'bill_amount')::numeric, received = v_rcv, reconciled = v_rec,
        rcv_lt30 = (r->>'rcv_lt30')::numeric, rcv_30_90 = (r->>'rcv_30_90')::numeric, rcv_90_180 = (r->>'rcv_90_180')::numeric, rcv_gt180 = (r->>'rcv_gt180')::numeric,
        rec_lt30 = (r->>'rec_lt30')::numeric, rec_30_90 = (r->>'rec_30_90')::numeric, rec_90_180 = (r->>'rec_90_180')::numeric, rec_gt180 = (r->>'rec_gt180')::numeric,
        entered_by = v_me, updated_at = now()
       where id = v_id;
    end if;
    if v_head is not null and v_head <> v_me then
      insert into public.notifications(person_id, kind, message, link)
      select v_head, 'collections', (select full_name from public.persons where id = v_me) || ' updated collections for '
             || (select name from public.clients where id = v_c) || ' · ' || (select name from public.branches where id = v_b) || ' on ' || to_char(p_date, 'DD Mon') || '.', '/productivity?date=' || p_date
       where not exists (select 1 from public.notifications x where x.person_id = v_head and x.kind = 'collections'
                          and x.link = '/productivity?date=' || p_date and x.created_at > now() - interval '1 hour');
    end if;
    n := n + 1;
  end loop;
  return n;
end $$;

do $do$
declare f text; o text;
begin
  f := pg_get_functiondef('public.save_ar(date,jsonb)'::regprocedure); o := f;
  f := replace(f, 'select 1 from app.money_pairs(app.me(), greatest(v_m, least(app.today(), (v_m + interval ''1 month - 1 day'')::date))) k',
                  'select 1 from app.collection_pairs(app.me(), greatest(v_m, least(app.today(), (v_m + interval ''1 month - 1 day'')::date))) k');
  if f = o then raise exception 'save_ar anchor not found'; end if;
  execute f;
end $do$;

grant execute on function app.hr_owner(), app.task_sensitive(text) to authenticated;
revoke all on function app.hr_owner() from public, anon;
