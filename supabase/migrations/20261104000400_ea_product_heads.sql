-- D-61 Executive Assistant (EA): works for one or more principals (e.g. the Operations Head, the MD). Sees what the
--   principal sees (dashboards, team status, tasks, targets, attendance) — never salary, HR documents, partner terms or
--   the activity log. Cannot enter or correct figures, certify, set targets or change people. Can assign and follow up
--   tasks on the principal's behalf (the principal is told). Every EA link is dated and audited.
-- D-62 Product Head: owns one or more clients (a whole client, e.g. IDBI, or a product of a client, e.g. BOM MSME = the
--   BOM MSME PRE + POST clients). Sees full data for those clients at every location, a product performance view, and
--   can correct individual entries or collections for them — the person (and their manager) is told.

create table if not exists public.ea_assignments (
  id uuid primary key default gen_random_uuid(),
  ea_person uuid not null references public.persons(id),
  principal uuid not null references public.persons(id),
  valid daterange not null check (not isempty(valid) and lower(valid) is not null),
  reason text, created_at timestamptz not null default now(),
  check (ea_person <> principal),
  exclude using gist (ea_person with =, principal with =, valid with &&)
);
create table if not exists public.product_heads (
  id uuid primary key default gen_random_uuid(),
  person_id uuid not null references public.persons(id),
  client_id uuid not null references public.clients(id),
  product text not null,
  valid daterange not null check (not isempty(valid) and lower(valid) is not null),
  reason text, created_at timestamptz not null default now(),
  exclude using gist (person_id with =, client_id with =, valid with &&)
);
alter table public.ea_assignments enable row level security;
alter table public.product_heads enable row level security;
create policy read_ea on public.ea_assignments for select to authenticated
  using ((select app.is_admin() or app.has_role('hr_admin') or app.has_role('auditor')) or ea_person = (select app.me()) or principal = (select app.me()));
create policy admin_write_ea on public.ea_assignments for all to authenticated using (app.is_admin()) with check (app.is_admin());
create policy read_product_heads on public.product_heads for select to authenticated using ((select app.me()) is not null);
create policy admin_write_product_heads on public.product_heads for all to authenticated using (app.is_admin()) with check (app.is_admin());
grant select, insert, update on public.ea_assignments, public.product_heads to authenticated;
create trigger trg_audit after insert or update on public.ea_assignments for each row execute function app.audit();
create trigger trg_audit after insert or update on public.product_heads for each row execute function app.audit();

-- The people whose view I share: myself and, as an EA, my principals.
create or replace function app.principals() returns uuid[]
language sql stable security definer set search_path = public, app, pg_temp as $$
  select array_remove(array[app.me()] || coalesce((select array_agg(e.principal) from public.ea_assignments e
                       where e.ea_person = app.me() and e.valid @> app.today()), '{}'), null)
$$;
create or replace function app.is_ea() returns boolean
language sql stable security definer set search_path = public, app, pg_temp as $$
  select exists (select 1 from public.ea_assignments e where e.ea_person = app.me() and e.valid @> app.today())
$$;
create or replace function app.my_product_clients() returns uuid[]
language sql stable security definer set search_path = public, app, pg_temp as $$
  select coalesce(array_agg(distinct p.client_id), '{}') from public.product_heads p where p.person_id = app.me() and p.valid @> app.today()
$$;
grant execute on function app.principals(), app.is_ea(), app.my_product_clients() to authenticated;
revoke all on function app.principals(), app.is_ea(), app.my_product_clients() from public, anon;

-- Whole business: Admin, BI & Growth / Leadership — and the EA of a Leadership principal.
create or replace function app.sees_all() returns boolean
language sql stable security definer set search_path = public, app, pg_temp as $$
  select app.is_admin() or app.has_role('auditor')
      or exists (select 1 from public.ea_assignments e join public.role_assignments r on r.person_id = e.principal and r.valid @> app.today()
                  where e.ea_person = app.me() and e.valid @> app.today() and r.role::text in ('leadership', 'auditor'))
$$;

create or replace function app.can_view_person(p_person uuid, p_date date, p_fn app.fn)
returns boolean language plpgsql stable security definer set search_path = public, app, pg_temp as $$
declare v_me uuid := app.me();
begin
  if v_me is null then return false; end if;
  if p_person = v_me then return true; end if;
  if app.sees_all() then return true; end if;
  return p_person = any(app.principals())
      or exists (select 1 from unnest(app.principals()) pr(id), app.subtree(pr.id, p_fn, coalesce(p_date, app.today())) s where s.person_id = p_person);
end $$;

create or replace function app.visible_branches(p_date date)
returns setof uuid language plpgsql stable security definer set search_path = public, app, pg_temp as $$
declare v_me uuid := app.me();
begin
  if v_me is null then return; end if;
  if app.sees_all() then return query select b.id from public.branches b; return; end if;
  return query
  with pr as (select unnest(app.principals()) id),
  people as (select id pid from pr
             union select s.person_id from pr, app.subtree(pr.id, 'operations', p_date) s
             union select s.person_id from pr, app.subtree(pr.id, 'collections', p_date) s)
  select distinct h.branch_id from public.location_heads h join people on people.pid = h.person_id
   where h.valid && daterange(date_trunc('month', p_date)::date, p_date + 1)
  union
  select distinct cl.branch_id from public.allocations a join people on people.pid = a.person_id
    join public.client_locations cl on cl.id = a.client_location_id
   where a.valid && daterange(date_trunc('month', p_date)::date, p_date + 1);
end $$;

create or replace function app.my_people(p_fn app.fn default null) returns uuid[]
language sql stable security definer set search_path = public, app, pg_temp as $$
  select coalesce(array_agg(distinct x), '{}') from (
    select unnest(app.principals()) x
    union select s.person_id from unnest(app.principals()) pr(id), app.subtree(pr.id, 'operations', app.today()) s where p_fn is null or p_fn = 'operations'
    union select s.person_id from unnest(app.principals()) pr(id), app.subtree(pr.id, 'collections', app.today()) s where p_fn is null or p_fn = 'collections') z where x is not null
$$;

do $do$
declare f text; o text;
begin
  -- an EA downloads the tracker for the principal's locations
  f := pg_get_functiondef('public.tracker_export(date)'::regprocedure); o := f;
  f := replace(f, 'when app.has_role(''zm'') or app.has_role(''ops_head'') or app.has_role(''collections_head'') or exists',
                  'when app.has_role(''zm'') or app.has_role(''ops_head'') or app.has_role(''collections_head'') or app.is_ea() or exists');
  if f = o then raise exception 'tracker_export anchor not found'; end if;
  execute f;
  -- product heads correct entries for their clients; the person and their manager are told
  f := pg_get_functiondef('public.correct_team_line(uuid,date,uuid,integer,integer,integer,text,boolean)'::regprocedure); o := f;
  f := replace(f, 'if not (app.is_admin() or (p_person <> v_me and exists (select 1 from app.subtree(v_me, ''operations'', p_date) s where s.person_id = p_person))) then
    raise exception ''You can only correct entries of people in your team.''',
                  'if not (app.is_admin() or (p_person <> v_me and exists (select 1 from app.subtree(v_me, ''operations'', p_date) s where s.person_id = p_person))
          or (p_person <> v_me and (select cl.client_id from public.client_locations cl where cl.id = p_client_location) = any(app.my_product_clients()))) then
    raise exception ''You can only correct entries of people in your team (or, as Product Head, for your product).''');
  f := replace(f, 'if v_mgr is not null and v_mgr <> v_me and exists (select 1 from public.certifications c where c.manager_id = v_mgr and c.work_date = p_date and c.function = ''operations'') then',
                  'if v_mgr is not null and v_mgr <> v_me and (exists (select 1 from public.certifications c where c.manager_id = v_mgr and c.work_date = p_date and c.function = ''operations'')
       or (select cl.client_id from public.client_locations cl where cl.id = p_client_location) = any(app.my_product_clients())) then');
  if f = o or position('my_product_clients' in f) = 0 then raise exception 'correct_team_line anchors not found'; end if;
  execute f;
  -- product heads may correct collections of their clients
  f := pg_get_functiondef('public.save_collection_day(date,jsonb)'::regprocedure); o := f;
  f := replace(f, 'and not app.can_review_ar() then
      raise exception ''You do not work on that client at that location.''',
                  'and not app.can_review_ar() and not (v_c = any(app.my_product_clients())) then
      raise exception ''You do not work on that client at that location.''');
  if f = o then raise exception 'save_collection_day anchor not found'; end if;
  execute f;
end $do$;

-- whoami: EA principals and products
create or replace function public.whoami() returns jsonb
language sql stable security definer set search_path = public, app, pg_temp as $$
  select case when app.me() is null then null else jsonb_build_object(
    'person_id', p.id, 'full_name', p.full_name, 'designation', p.designation, 'status', p.status, 'mobile', p.mobile,
    'resource_type', p.resource_type,
    'roles', (select coalesce(jsonb_agg(distinct r.role), '[]') from public.role_assignments r where r.person_id = p.id and r.valid @> app.today()),
    'manages_operations', app.has_reports(p.id, 'operations', app.today()),
    'manages_collections', app.has_reports(p.id, 'collections', app.today()),
    'has_collections', exists (select 1 from public.reporting_lines r where r.person_id = p.id and r.function = 'collections' and r.valid @> app.today())
                       or app.has_reports(p.id, 'collections', app.today()),
    'heads_locations', exists (select 1 from public.location_heads h where h.person_id = p.id and h.valid @> app.today()),
    'agreement_version', app.setting('agreement_version') #>> '{}',
    'agreement_ok', app.agreement_ok(p.id), 'profile_missing', to_jsonb(coalesce(app.profile_missing(p.id), '{}')),
    'company', jsonb_build_object('name', app.setting('company_name') #>> '{}', 'place', app.setting('company_place') #>> '{}',
                                  'website', app.setting('company_website') #>> '{}', 'address', app.setting('company_address') #>> '{}'),
    'ea_for', (select coalesce(jsonb_agg(x.full_name), '[]') from public.ea_assignments e join public.persons x on x.id = e.principal
                where e.ea_person = p.id and e.valid @> app.today()),
    'products', (select coalesce(jsonb_agg(distinct ph.product), '[]') from public.product_heads ph where ph.person_id = p.id and ph.valid @> app.today()),
    'hr', app.has_role('hr_admin'),
    'leadership', app.has_role('auditor'), 'ops_blind', app.ops_blind(), 'today', app.today(), 'tz', app.tz(), 'server_time', app.clock())
  end
  from public.persons p where p.id = app.me()
$$;

-- Product performance: clients I head as Product Head, every location; targets, cases, revenue, collections, people, trend.
create or replace function public.product_dashboard(p_month date default null, p_product text default null)
returns jsonb language plpgsql stable security definer set search_path = public, app, pg_temp as $$
declare v_m date := date_trunc('month', coalesce(p_month, app.today()))::date; v_e date; v_cl uuid[];
begin
  if app.me() is null then raise exception 'Not signed in' using errcode = '28000'; end if;
  v_e := least((v_m + interval '1 month - 1 day')::date, app.today());
  select coalesce(array_agg(distinct ph.client_id), '{}') into v_cl from public.product_heads ph
   where ph.person_id = app.me() and ph.valid @> greatest(v_m, least(app.today(), v_e)) and (p_product is null or ph.product = p_product);
  if cardinality(v_cl) = 0 then raise exception 'You are not Product Head for any client.' using errcode = '42501'; end if;
  return (
  with lt as (select * from app.loc_targets(v_m, 'entry') where client_id = any(v_cl)),
  ct as (select * from app.loc_targets(v_m, 'collections_received') where client_id = any(v_cl)),
  ln as (select l.branch_id, l.client_id, l.person_id, sum(l.entry - l.cancelled) cases, sum(coalesce(l.revenue, 0)) rev, sum(l.entry) e, sum(l.closure) c, sum(l.cancelled) x
           from public.v_line_metrics l where l.client_id = any(v_cl) and l.work_date between v_m and v_e group by 1, 2, 3),
  co as (select d.branch_id, d.client_id, sum(d.rcv_lt30 + d.rcv_30_90 + d.rcv_90_180 + d.rcv_gt180) rcv, sum(d.rec_lt30 + d.rec_30_90 + d.rec_90_180 + d.rec_gt180) rec,
                sum(d.bill_amount) ba from public.collection_daily d where d.client_id = any(v_cl) and d.entry_date between v_m and v_e group by 1, 2),
  pairs as (select branch_id, client_id from public.client_locations where client_id = any(v_cl) and valid && daterange(v_m, v_e + 1)
            union select branch_id, client_id from ln union select branch_id, client_id from lt),
  loc as (select k.branch_id, k.client_id, b.name location, c.name client, z.name zone,
                 (select full_name from public.persons where id = coalesce(app.head_of(k.branch_id, k.client_id, 'branch_head', v_e), app.head_of(k.branch_id, k.client_id, 'zonal_manager', v_e))) head,
                 lt.amount t, lt.amount * app.pair_rate(k.branch_id, k.client_id, v_m) rt, ct.amount colt,
                 (select sum(cases) from ln where ln.branch_id = k.branch_id and ln.client_id = k.client_id) cases,
                 (select sum(rev) from ln where ln.branch_id = k.branch_id and ln.client_id = k.client_id) rev,
                 co.rcv, co.rec, co.ba
            from pairs k join public.branches b on b.id = k.branch_id join public.clients c on c.id = k.client_id
            left join public.branch_zones bz on bz.branch_id = b.id and bz.valid @> v_e left join public.zones z on z.id = bz.zone_id
            left join lt on lt.branch_id = k.branch_id and lt.client_id = k.client_id
            left join ct on ct.branch_id = k.branch_id and ct.client_id = k.client_id
            left join co on co.branch_id = k.branch_id and co.client_id = k.client_id)
  select jsonb_build_object('month', v_m, 'as_of', v_e,
    'wd_done', app.working_days_between(v_m, v_e), 'wd_total', app.working_days_between(v_m, (v_m + interval '1 month - 1 day')::date),
    'products', (select coalesce(jsonb_agg(distinct jsonb_build_object('product', ph.product, 'client', c.name)), '[]') from public.product_heads ph join public.clients c on c.id = ph.client_id
                  where ph.person_id = app.me() and ph.valid @> greatest(v_m, least(app.today(), v_e))),
    'by_location', (select coalesce(jsonb_agg(to_jsonb(l) - 'branch_id' - 'client_id' || jsonb_build_object('branch_id', l.branch_id, 'client_id', l.client_id)
                      order by l.client, l.zone nulls last, l.location), '[]') from loc l),
    'by_person', (select coalesce(jsonb_agg(jsonb_build_object('person', p.full_name, 'person_id', p.id, 'client', c.name, 'location', b.name,
                      'cases', ln.cases, 'revenue', ln.rev, 'entry', ln.e, 'closure', ln.c, 'cancelled', ln.x) order by ln.rev desc), '[]')
                   from ln join public.persons p on p.id = ln.person_id join public.clients c on c.id = ln.client_id join public.branches b on b.id = ln.branch_id),
    'trend', (select coalesce(jsonb_agg(s order by s.month), '[]') from (
        select m.month, sum(m.actual_cases) cases, sum(m.actual_revenue) revenue from public.tracker_monthly m
         where m.client_id = any(v_cl) and m.month >= (v_m - interval '12 months')::date
           and not exists (select 1 from public.productivity_lines l where date_trunc('month', l.work_date) = m.month) group by 1
        union all
        select date_trunc('month', l.work_date)::date, sum(l.entry - l.cancelled), sum(coalesce(l.revenue, 0)) from public.v_line_metrics l
         where l.client_id = any(v_cl) and l.work_date >= (v_m - interval '12 months')::date and l.work_date <= v_e group by 1) s),
    'daily', (select coalesce(jsonb_agg(s order by s.d), '[]') from (select l.work_date d, sum(l.entry - l.cancelled) cases, sum(coalesce(l.revenue, 0)) revenue
                from public.v_line_metrics l where l.client_id = any(v_cl) and l.work_date between v_m and v_e group by 1) s)));
end $$;

-- The day's entries for my products, to correct individual figures.
create or replace function public.product_lines(p_date date)
returns table(person_id uuid, person text, client_location_id uuid, client text, location text, entry int, closure int, cancelled int, source text, reason text)
language sql stable security definer set search_path = public, app, pg_temp as $$
  select l.person_id, p.full_name, l.client_location_id, c.name, b.name, l.entry, l.closure, l.cancelled, l.source, l.reason
    from public.productivity_lines l join public.client_locations cl on cl.id = l.client_location_id
    join public.clients c on c.id = cl.client_id join public.branches b on b.id = cl.branch_id join public.persons p on p.id = l.person_id
   where l.work_date = p_date and cl.client_id = any(app.my_product_clients())
   order by c.name, b.name, p.full_name
$$;
grant execute on function public.product_dashboard(date, text), public.product_lines(date) to authenticated;
revoke all on function public.product_dashboard(date, text), public.product_lines(date) from public, anon;
