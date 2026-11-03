-- Attendance & leave, manager roll-up beside own entry, daily message data, bulk uploads, daily tracker import
-- and data for the Revenue Status report (ported from the Zonal Tracker Builder). Additive only.

insert into public.settings(key, value, description) values
 ('late_grace_minutes', '15', 'Check-in after shift start + this many minutes is Late (D-08)'),
 ('half_day_hours', '4.5', 'Worked hours below this make the day a Half day (D-08)'),
 ('report_recipients', '""', 'Revenue Status email recipients, one per line'),
 ('app_url', '"https://crux-operationsalert-art.github.io/crux-iopp/"', 'Link used in onboarding messages')
on conflict (key) do nothing;

-- ------------------------------------------------------------ attendance
create table public.attendance (
  person_id uuid not null references public.persons(id),
  work_date date not null,
  status text not null check (status in ('present','late','half_day','early_leave','absent','planned_leave',
                                         'unplanned_leave','weekly_off','holiday','sunday_work')),
  check_in timestamptz,
  check_out timestamptz,
  minutes_late integer,
  minutes_early integer,
  source text not null default 'self' check (source in ('self','manager','leave','admin')),
  reason text,
  set_by uuid references public.persons(id),
  updated_at timestamptz not null default now(),
  primary key (person_id, work_date),
  check (source = 'self' or reason is not null)
);
create index on public.attendance (work_date);

create table public.leave_requests (
  id uuid primary key default gen_random_uuid(),
  person_id uuid not null references public.persons(id),
  from_date date not null,
  to_date date not null,
  leave_type text not null check (leave_type in ('planned','unplanned')),
  category text not null check (category in ('personal','sick','emergency','natural_calamity','other')),
  reason text not null,
  short_notice boolean not null default false,
  status text not null default 'pending' check (status in ('pending','approved','rejected','cancelled')),
  decided_by uuid references public.persons(id),
  decided_at timestamptz,
  decision_note text,
  created_at timestamptz not null default now(),
  check (to_date >= from_date and to_date - from_date <= 60)
);

alter table public.attendance enable row level security;
alter table public.leave_requests enable row level security;
create policy read_attendance on public.attendance for select to authenticated
  using (app.can_view_person(person_id, work_date, 'operations') or app.can_view_person(person_id, work_date, 'collections')
         or app.has_role('hr_admin'));
create policy read_leave on public.leave_requests for select to authenticated
  using (app.can_view_person(person_id, from_date, 'operations') or app.can_view_person(person_id, from_date, 'collections')
         or app.has_role('hr_admin'));
revoke all on public.attendance, public.leave_requests from anon;
revoke insert, update, delete, truncate on public.attendance, public.leave_requests from authenticated;
grant select on public.attendance, public.leave_requests to authenticated;
create trigger trg_audit after insert or update or delete on public.attendance for each row execute function app.audit();
create trigger trg_audit after insert or update or delete on public.leave_requests for each row execute function app.audit();

create or replace function app.manages(p_person uuid, p_date date) returns boolean
language sql stable security definer set search_path = public, app, pg_temp as $$
  select app.is_admin() or app.has_role('hr_admin')
      or app.is_direct_report(p_person, 'operations', p_date) or app.is_direct_report(p_person, 'collections', p_date)
$$;

create or replace function public.check_in() returns public.attendance
language plpgsql security definer set search_path = public, app, pg_temp as $$
declare v_me uuid := app.me(); v_d date := app.today(); v_now timestamptz := app.clock();
        v_start timestamptz := (v_d + (app.setting('shift_start') #>> '{}')::time) at time zone app.tz();
        v_late int; v_a public.attendance;
begin
  if v_me is null then raise exception 'Not signed in' using errcode = '28000'; end if;
  select * into v_a from public.attendance where person_id = v_me and work_date = v_d;
  if v_a.check_in is not null then return v_a; end if;
  v_late := greatest(0, floor(extract(epoch from (v_now - v_start)) / 60))::int;
  insert into public.attendance as a (person_id, work_date, status, check_in, minutes_late, source, set_by)
  values (v_me, v_d,
          case when not app.is_working_day(v_d) then 'sunday_work'
               when v_late > coalesce((app.setting('late_grace_minutes'))::text::int, 15) then 'late' else 'present' end,
          v_now, v_late, 'self', v_me)
  on conflict (person_id, work_date) do update set check_in = excluded.check_in, minutes_late = excluded.minutes_late,
     status = case when a.status in ('absent','unplanned_leave') then excluded.status else a.status end, updated_at = now()
  returning * into v_a;
  return v_a;
end $$;

create or replace function public.check_out() returns public.attendance
language plpgsql security definer set search_path = public, app, pg_temp as $$
declare v_me uuid := app.me(); v_d date := app.today(); v_now timestamptz := app.clock();
        v_end timestamptz := (v_d + (app.setting('shift_end') #>> '{}')::time) at time zone app.tz();
        v_a public.attendance; v_hours numeric; v_early int;
begin
  if v_me is null then raise exception 'Not signed in' using errcode = '28000'; end if;
  select * into v_a from public.attendance where person_id = v_me and work_date = v_d;
  if v_a.check_in is null then raise exception 'Check in first.' using errcode = 'P0001'; end if;
  v_hours := extract(epoch from (v_now - v_a.check_in)) / 3600;
  v_early := greatest(0, floor(extract(epoch from (v_end - v_now)) / 60))::int;
  update public.attendance set check_out = v_now, minutes_early = v_early, updated_at = now(),
         status = case when status = 'sunday_work' then status
                       when v_hours < coalesce((app.setting('half_day_hours'))::text::numeric, 4.5) then 'half_day'
                       when v_early > 0 and status = 'present' then 'early_leave' else status end
   where person_id = v_me and work_date = v_d returning * into v_a;
  return v_a;
end $$;

-- Manager (direct line), HR or Admin sets / corrects a day, with a reason (audited).
create or replace function public.set_attendance(p_person uuid, p_date date, p_status text, p_reason text)
returns public.attendance
language plpgsql security definer set search_path = public, app, pg_temp as $$
declare v_a public.attendance;
begin
  if app.me() is null then raise exception 'Not signed in' using errcode = '28000'; end if;
  if not app.manages(p_person, p_date) then raise exception 'You can only mark attendance for your direct reports.' using errcode = '42501'; end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'A reason is required.' using errcode = 'P0001'; end if;
  if p_date > app.today() then raise exception 'Attendance cannot be marked for a future date.' using errcode = 'P0001'; end if;
  if p_date < app.today() - 31 and not (app.is_admin() or app.has_role('hr_admin')) then
    raise exception 'Only HR / Admin can correct attendance older than 31 days.' using errcode = 'P0001';
  end if;
  perform set_config('app.reason', p_reason, true);
  insert into public.attendance as a (person_id, work_date, status, source, reason, set_by)
  values (p_person, p_date, p_status, case when app.is_admin() then 'admin' else 'manager' end, p_reason, app.me())
  on conflict (person_id, work_date) do update set status = excluded.status, source = excluded.source,
         reason = excluded.reason, set_by = excluded.set_by, updated_at = now()
  returning * into v_a;
  return v_a;
end $$;

create or replace function public.request_leave(p_from date, p_to date, p_type text, p_category text, p_reason text)
returns public.leave_requests
language plpgsql security definer set search_path = public, app, pg_temp as $$
declare v_l public.leave_requests; v_mgr uuid;
begin
  if app.me() is null then raise exception 'Not signed in' using errcode = '28000'; end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'A reason is required.' using errcode = 'P0001'; end if;
  if p_type = 'planned' and p_from < app.today() then raise exception 'Planned leave cannot start in the past.' using errcode = 'P0001'; end if;
  if p_type = 'unplanned' and p_from < app.today() - 30 then raise exception 'Unplanned leave older than 30 days must be entered by HR.' using errcode = 'P0001'; end if;
  insert into public.leave_requests(person_id, from_date, to_date, leave_type, category, reason, short_notice)
  values (app.me(), p_from, p_to, p_type, p_category, p_reason, p_type = 'planned' and p_from < app.today() + 7)
  returning * into v_l;
  select manager_id into v_mgr from public.reporting_lines where person_id = app.me() and valid @> app.today()
   order by function limit 1;
  if v_mgr is not null then
    insert into public.notifications(person_id, kind, message, link)
    select v_mgr, 'leave_request', p.full_name || ' requested ' || p_type || ' leave ' || to_char(p_from,'DD Mon') ||
           case when p_to > p_from then '–' || to_char(p_to,'DD Mon') else '' end || '.', '/attendance'
      from public.persons p where p.id = app.me();
  end if;
  return v_l;
end $$;

create or replace function public.decide_leave(p_id uuid, p_approve boolean, p_note text default null)
returns public.leave_requests
language plpgsql security definer set search_path = public, app, pg_temp as $$
declare v_l public.leave_requests; d date;
begin
  select * into v_l from public.leave_requests where id = p_id for update;
  if v_l.id is null then raise exception 'Not found.' using errcode = 'P0001'; end if;
  if not app.manages(v_l.person_id, v_l.from_date) or v_l.person_id = app.me() then
    raise exception 'Only the person''s manager, HR or Admin can decide.' using errcode = '42501';
  end if;
  if v_l.status <> 'pending' then raise exception 'This request is already %.', v_l.status using errcode = 'P0001'; end if;
  if not p_approve and coalesce(trim(p_note), '') = '' then raise exception 'Give a reason for rejecting.' using errcode = 'P0001'; end if;
  perform set_config('app.reason', coalesce(p_note, 'leave decision'), true);
  update public.leave_requests set status = case when p_approve then 'approved' else 'rejected' end,
         decided_by = app.me(), decided_at = app.clock(), decision_note = p_note where id = p_id returning * into v_l;
  if p_approve then
    for d in select g::date from generate_series(v_l.from_date, v_l.to_date, interval '1 day') g loop
      continue when not app.is_working_day(d);
      insert into public.attendance as a (person_id, work_date, status, source, reason, set_by)
      values (v_l.person_id, d, case when v_l.leave_type = 'planned' then 'planned_leave' else 'unplanned_leave' end,
              'leave', 'Approved leave: ' || v_l.category, app.me())
      on conflict (person_id, work_date) do update set status = excluded.status, source = 'leave', reason = excluded.reason,
             set_by = excluded.set_by, updated_at = now()
       where a.check_in is null;
    end loop;
  end if;
  insert into public.notifications(person_id, kind, message, link)
  values (v_l.person_id, 'leave_decision', 'Your leave ' || to_char(v_l.from_date,'DD Mon') || ' was ' || v_l.status ||
          coalesce('. Note: ' || p_note, '') || '.', '/attendance');
  return v_l;
end $$;

create or replace function public.cancel_leave(p_id uuid) returns public.leave_requests
language plpgsql security definer set search_path = public, app, pg_temp as $$
declare v_l public.leave_requests;
begin
  update public.leave_requests set status = 'cancelled' where id = p_id and person_id = app.me() and status = 'pending'
  returning * into v_l;
  if v_l.id is null then raise exception 'Only your own pending requests can be cancelled.' using errcode = 'P0001'; end if;
  return v_l;
end $$;

-- Day-based shrinkage (until hours are configured): unavailable = absent + leave + ½ half-day, over scheduled working days.
create or replace function public.attendance_summary(p_from date, p_to date, p_manager uuid default null)
returns table(person_id uuid, full_name text, scheduled int, present int, late int, half_day int, early_leave int,
              absent int, planned_leave int, unplanned_leave int, not_marked int, shrinkage_pct numeric,
              unplanned_streak int, today_status text, today_in timestamptz, today_out timestamptz)
language plpgsql stable security definer set search_path = public, app, pg_temp as $$
declare v_me uuid := app.me(); v_to date := least(p_to, app.today()); v_all boolean;
begin
  if v_me is null then raise exception 'Not signed in' using errcode = '28000'; end if;
  v_all := app.is_admin() or app.has_role('hr_admin') or app.has_role('ops_head') or app.has_role('auditor');
  return query
  with people as (
    select p.id, p.full_name from public.persons p
     where p.status in ('active','invited')
       and case when p_manager is not null then
                  p.id in (select s.person_id from app.subtree(p_manager, 'operations', v_to) s
                           union select s.person_id from app.subtree(p_manager, 'collections', v_to) s)
                  and (v_all or p_manager = v_me or p_manager in (select s.person_id from app.subtree(v_me, 'operations', v_to) s))
                when v_all then true
                else p.id = v_me or p.id in (select s.person_id from app.subtree(v_me, 'operations', v_to) s
                                             union select s.person_id from app.subtree(v_me, 'collections', v_to) s) end
  ), days as (select g::date d from generate_series(p_from, v_to, interval '1 day') g where app.is_working_day(g::date)),
  grid as (select pe.id, pe.full_name, dd.d, a.status, row_number() over (partition by pe.id order by dd.d) rn
             from people pe cross join days dd
             left join public.attendance a on a.person_id = pe.id and a.work_date = dd.d),
  agg as (
    select g.id, g.full_name, count(*)::int sch,
           count(*) filter (where g.status = 'present')::int pr, count(*) filter (where g.status = 'late')::int lt,
           count(*) filter (where g.status = 'half_day')::int hd, count(*) filter (where g.status = 'early_leave')::int el,
           count(*) filter (where g.status = 'absent')::int ab, count(*) filter (where g.status = 'planned_leave')::int pl,
           count(*) filter (where g.status = 'unplanned_leave')::int ul, count(*) filter (where g.status is null)::int nm
      from grid g group by g.id, g.full_name)
  select a.id, a.full_name, a.sch, a.pr, a.lt, a.hd, a.el, a.ab, a.pl, a.ul, a.nm,
         case when a.sch > 0 then round((a.ab + a.pl + a.ul + 0.5 * a.hd)::numeric / a.sch * 100, 1) end,
         (select coalesce(max(cnt), 0)::int from (select count(*) cnt from (
            select g.rn - row_number() over (order by g.rn) grp
              from grid g where g.id = a.id and g.status in ('absent','unplanned_leave')) x group by grp) y),
         t.status, t.check_in, t.check_out
    from agg a left join public.attendance t on t.person_id = a.id and t.work_date = app.today()
   order by a.full_name;
end $$;

-- ------------------------------------------------------------ roll-up beside own entry + daily message data
-- One row per location × client for the caller (scope 'me') or their whole team excluding themselves (scope 'team').
create or replace function public.day_report(p_date date, p_scope text default 'me')
returns table(zone text, location text, client text, client_location_id uuid, entry bigint, closure bigint, cancelled bigint,
              mtd_entry bigint, mtd_closure bigint, mtd_cancelled bigint, people bigint)
language plpgsql stable security definer set search_path = public, app, pg_temp as $$
declare v_me uuid := app.me(); v_people uuid[];
begin
  if v_me is null then raise exception 'Not signed in' using errcode = '28000'; end if;
  if p_scope = 'team' then
    select array_agg(distinct s.person_id) into v_people from app.subtree(v_me, 'operations', p_date) s;
  else v_people := array[v_me]; end if;
  return query
  select coalesce(z.name, '—'), lo.name, c.name, cl.id,
         coalesce(sum(l.entry) filter (where l.work_date = p_date), 0)::bigint,
         coalesce(sum(l.closure) filter (where l.work_date = p_date), 0)::bigint,
         coalesce(sum(l.cancelled) filter (where l.work_date = p_date), 0)::bigint,
         coalesce(sum(l.entry), 0)::bigint, coalesce(sum(l.closure), 0)::bigint, coalesce(sum(l.cancelled), 0)::bigint,
         count(distinct l.person_id)::bigint
    from public.productivity_lines l
    join public.client_locations cl on cl.id = l.client_location_id
    join public.clients c on c.id = cl.client_id
    join public.locations lo on lo.id = cl.location_id
    left join public.branch_zones bz on bz.branch_id = cl.branch_id and bz.valid @> p_date
    left join public.zones z on z.id = bz.zone_id
   where l.person_id = any(coalesce(v_people, '{}')) and l.work_date between date_trunc('month', p_date)::date and p_date
   group by z.name, lo.name, c.name, cl.id
   order by 1, 2, 3;
end $$;

-- Certification with per-measure figures: any difference from team + own needs a reason (SOW 5.5).
alter table public.certifications add column if not exists certified_detail jsonb;
create or replace function public.certify_team_detail(p_work_date date, p_function app.fn, p_certified jsonb default null,
                                                      p_reason text default null)
returns public.certifications
language plpgsql security definer set search_path = public, app, pg_temp as $$
declare v_me uuid := app.me(); v_team uuid[]; v_t jsonb; v_o jsonb; v_diff text := ''; k text; v_c public.certifications;
        v_net numeric;
begin
  if v_me is null then raise exception 'Not signed in' using errcode = '28000'; end if;
  select array_agg(person_id) into v_team from app.subtree(v_me, p_function, p_work_date);
  if p_function = 'operations' and p_certified is not null then
    v_t := app.ops_totals(v_team, p_work_date); v_o := app.ops_totals(array[v_me], p_work_date);
    foreach k in array array['entry','closure','cancelled'] loop
      if p_certified ? k and (p_certified->>k)::numeric <> (v_t->>k)::numeric + (v_o->>k)::numeric then
        v_diff := v_diff || format('%s %s vs %s; ', k, p_certified->>k, (v_t->>k)::numeric + (v_o->>k)::numeric);
      end if;
    end loop;
    if v_diff <> '' and coalesce(trim(p_reason), '') = '' then
      raise exception 'Your figures differ from team roll-up + your own (%). Give a reason.', rtrim(v_diff, '; ') using errcode = 'P0001';
    end if;
    v_net := coalesce((p_certified->>'entry')::numeric, (v_t->>'entry')::numeric + (v_o->>'entry')::numeric)
           + coalesce((p_certified->>'closure')::numeric, (v_t->>'closure')::numeric + (v_o->>'closure')::numeric)
           - coalesce((p_certified->>'cancelled')::numeric, (v_t->>'cancelled')::numeric + (v_o->>'cancelled')::numeric);
  elsif p_certified ? 'received' then
    v_net := (p_certified->>'received')::numeric;
  end if;
  v_c := public.certify_team(p_work_date, p_function,
           case when v_diff = '' and p_function = 'operations' then null else v_net end,
           nullif(coalesce(p_reason, '') || case when v_diff <> '' then ' [' || rtrim(v_diff, '; ') || ']' else '' end, ''));
  update public.certifications set certified_detail = p_certified where id = v_c.id returning * into v_c;
  return v_c;
end $$;

-- ------------------------------------------------------------ daily Zonal Tracker import (report source until direct entry)
create table public.tracker_daily (
  id bigint generated always as identity primary key,
  batch_id uuid references public.import_batches(id),
  as_of date not null,
  month date not null,
  region text, zone_name text not null, location_name text not null, client_name text not null, stakeholder text,
  zone_id uuid references public.zones(id), branch_id uuid references public.branches(id), client_id uuid references public.clients(id),
  target_cases numeric(14,2), revenue_target numeric(16,2), mtd_cases numeric(14,2), mtd_revenue numeric(16,2),
  reported_added numeric(14,2),
  source_row integer,
  unique (as_of, location_name, client_name)
);
create index on public.tracker_daily (month, as_of);
alter table public.tracker_daily enable row level security;
create policy read_tracker_daily on public.tracker_daily for select to authenticated
  using (app.is_admin() or app.has_role('auditor') or app.has_role('ops_head') or app.has_role('collections_head')
         or exists (select 1 from public.role_assignments r where r.person_id = app.me() and r.role = 'zm'
                     and r.zone_id = tracker_daily.zone_id and r.valid @> app.today()));
revoke all on public.tracker_daily from anon;
revoke insert, update, delete, truncate on public.tracker_daily from authenticated;
grant select on public.tracker_daily to authenticated;

create or replace function public.import_tracker_day(p_as_of date, p_file text, p_rows jsonb, p_check jsonb default null)
returns jsonb
language plpgsql security definer set search_path = public, app, extensions, pg_temp as $$
declare v_b uuid; v_proc uuid; v_n int; v_month date := date_trunc('month', p_as_of)::date;
begin
  if not app.is_admin() then raise exception 'Only Admin can import the tracker.' using errcode = '42501'; end if;
  if jsonb_array_length(coalesce(p_rows, '[]')) = 0 then raise exception 'No rows to import.' using errcode = 'P0001'; end if;
  perform set_config('app.reason', 'daily tracker import ' || p_as_of, true);
  insert into public.import_batches(source, file_name, as_of, status, row_count, reconciliation, committed_at)
  values ('zonal_tracker_daily', p_file, p_as_of, 'committed', jsonb_array_length(p_rows), p_check, now()) returning id into v_b;
  insert into public.processes(code, name) values ('VER', 'Verification (as reported in Zonal Tracker)') on conflict (code) do nothing;
  select id into v_proc from public.processes where code = 'VER';
  insert into public.zones(code, name, region)
  select distinct on (app.slug(r->>'zone')) 'Z-' || app.slug(r->>'zone'), r->>'zone', r->>'region' from jsonb_array_elements(p_rows) r
  on conflict (code) do update set region = coalesce(public.zones.region, excluded.region);
  insert into public.branches(code, name, branch_type, type_confirmed)
  select distinct on (app.slug(r->>'location')) 'B-' || app.slug(r->>'location'), r->>'location', 'own', false from jsonb_array_elements(p_rows) r
  on conflict (code) do nothing;
  insert into public.locations(code, name)
  select distinct on (app.slug(r->>'location')) 'L-' || app.slug(r->>'location'), r->>'location' from jsonb_array_elements(p_rows) r
  on conflict (code) do nothing;
  insert into public.branch_zones(branch_id, zone_id, valid)
  select distinct b.id, z.id, daterange(v_month, null) from jsonb_array_elements(p_rows) r
    join public.branches b on b.code = 'B-' || app.slug(r->>'location') join public.zones z on z.code = 'Z-' || app.slug(r->>'zone')
   where not exists (select 1 from public.branch_zones x where x.branch_id = b.id);
  insert into public.clients(code, name)
  select distinct on (app.slug(r->>'client')) 'C-' || app.slug(r->>'client'), r->>'client' from jsonb_array_elements(p_rows) r
  on conflict (code) do nothing;
  insert into public.client_locations(client_id, location_id, process_id, branch_id, valid)
  select distinct c.id, l.id, v_proc, b.id, daterange(v_month, null) from jsonb_array_elements(p_rows) r
    join public.clients c on c.code = 'C-' || app.slug(r->>'client') join public.locations l on l.code = 'L-' || app.slug(r->>'location')
    join public.branches b on b.code = 'B-' || app.slug(r->>'location')
   where not exists (select 1 from public.client_locations x where x.client_id = c.id and x.location_id = l.id and x.process_id = v_proc);
  -- a clean per-case rate (revenue target ÷ target cases) for location × client pairs that have no rate yet
  insert into public.rate_cards(client_id, location_id, process_id, billable_event, rate, valid, reason)
  select c.id, l.id, v_proc, 'entry', round((r->>'revenue_target')::numeric / (r->>'target_cases')::numeric),
         daterange(v_month, null), 'Zonal Tracker ' || p_as_of || ' revenue target ÷ target cases'
    from jsonb_array_elements(p_rows) r
    join public.clients c on c.code = 'C-' || app.slug(r->>'client') join public.locations l on l.code = 'L-' || app.slug(r->>'location')
   where coalesce((r->>'target_cases')::numeric, 0) > 0
     and abs((r->>'revenue_target')::numeric / (r->>'target_cases')::numeric - round((r->>'revenue_target')::numeric / (r->>'target_cases')::numeric)) < 0.01
     and not exists (select 1 from public.rate_cards x where x.client_id = c.id and x.location_id = l.id and x.process_id = v_proc);
  insert into public.tracker_daily as t (batch_id, as_of, month, region, zone_name, location_name, client_name, stakeholder,
         zone_id, branch_id, client_id, target_cases, revenue_target, mtd_cases, mtd_revenue, reported_added, source_row)
  select v_b, p_as_of, v_month, r->>'region', r->>'zone', r->>'location', r->>'client', r->>'stakeholder',
         z.id, b.id, c.id, (r->>'target_cases')::numeric, (r->>'revenue_target')::numeric, (r->>'mtd_cases')::numeric,
         (r->>'mtd_revenue')::numeric, (r->>'reported_added')::numeric, (r->>'source_row')::int
    from jsonb_array_elements(p_rows) r
    left join public.zones z on z.code = 'Z-' || app.slug(r->>'zone')
    left join public.branches b on b.code = 'B-' || app.slug(r->>'location')
    left join public.clients c on c.code = 'C-' || app.slug(r->>'client')
  on conflict (as_of, location_name, client_name) do update set batch_id = excluded.batch_id, region = excluded.region,
     zone_name = excluded.zone_name, stakeholder = excluded.stakeholder, target_cases = excluded.target_cases,
     revenue_target = excluded.revenue_target, mtd_cases = excluded.mtd_cases, mtd_revenue = excluded.mtd_revenue,
     reported_added = excluded.reported_added, source_row = excluded.source_row;
  get diagnostics v_n = row_count;
  return jsonb_build_object('batch', v_b, 'rows', v_n, 'as_of', p_as_of);
end $$;

-- Data behind the Revenue Status report (the verdict, scorecards and email are computed in the page, like the Builder).
create or replace function public.revenue_status_data(p_as_of date default null) returns jsonb
language plpgsql stable security invoker set search_path = public, app, pg_temp as $$
declare v_d date; v_prev date; v_m date;
begin
  v_d := coalesce(p_as_of, (select max(as_of) from public.tracker_daily));
  if v_d is null then return jsonb_build_object('dates', '[]'::jsonb); end if;
  v_m := date_trunc('month', v_d)::date;
  select max(as_of) into v_prev from public.tracker_daily where month = v_m and as_of < v_d;
  return jsonb_build_object(
    'as_of', v_d, 'prev_as_of', v_prev,
    'dates', (select coalesce(jsonb_agg(distinct as_of order by as_of desc), '[]') from public.tracker_daily),
    'wd_done', app.working_days_between(v_m, v_d), 'wd_total', app.working_days_between(v_m, (v_m + interval '1 month - 1 day')::date),
    'rows', (select coalesce(jsonb_agg(jsonb_build_object(
               'region', t.region, 'zone', t.zone_name, 'location', t.location_name, 'client', t.client_name, 'stakeholder', t.stakeholder,
               'target_cases', t.target_cases, 'revenue_target', t.revenue_target, 'mtd_cases', t.mtd_cases, 'mtd_revenue', t.mtd_revenue,
               'reported_added', t.reported_added, 'prev_cases', p.mtd_cases, 'prev_revenue', p.mtd_revenue, 'row', t.source_row)
               order by t.source_row), '[]')
               from public.tracker_daily t
               left join public.tracker_daily p on p.as_of = v_prev and p.location_name = t.location_name and p.client_name = t.client_name
              where t.as_of = v_d));
end $$;

-- ------------------------------------------------------------ bulk uploads (Admin; HR for people / allocations / holidays)
create or replace function app.v(r jsonb, k text) returns text language sql immutable as $$ select nullif(trim(r->>k), '') $$;
create or replace function app.to_date(t text) returns date language plpgsql immutable as $$
begin
  if t is null then return null; end if;
  if t ~ '^\d{4}-\d{2}-\d{2}' then return left(t, 10)::date; end if;
  if t ~ '^\d{1,2}[-/.]\d{1,2}[-/.]\d{4}$' then return to_date(regexp_replace(t, '[/.]', '-', 'g'), 'DD-MM-YYYY'); end if;
  raise exception 'Date "%" not understood (use YYYY-MM-DD or DD-MM-YYYY).', t;
end $$;
create or replace function app.find(p_table text, p_val text, p_required boolean default true) returns uuid
language plpgsql stable security definer set search_path = public, app, pg_temp as $$
declare v uuid; n int;
begin
  if p_val is null then
    if p_required then raise exception '% is required.', initcap(rtrim(p_table, 's')); end if;
    return null;
  end if;
  if p_table = 'persons' then
    select id into v from public.persons where right(regexp_replace(mobile, '\D', '', 'g'), 10) = right(regexp_replace(p_val, '\D', '', 'g'), 10)
       or lower(personal_email) = lower(p_val) limit 1;
  else
    execute format('select count(*), min(id::text)::uuid from public.%I where lower(code) = lower($1) or lower(name) = lower($1)', p_table)
      into n, v using p_val;
    if n > 1 then raise exception '"%" matches more than one % — use the code.', p_val, rtrim(p_table, 's'); end if;
  end if;
  if v is null then raise exception '% "%" not found.', initcap(rtrim(p_table, 's')), p_val; end if;
  return v;
end $$;

create or replace function app.bulk_row(p_kind text, r jsonb) returns void
language plpgsql security definer set search_path = public, app, extensions, pg_temp as $$
declare v_id uuid; v_cl uuid; v_from date := coalesce(app.to_date(app.v(r,'valid_from')), app.today()); v_to date := app.to_date(app.v(r,'valid_to'));
        v_proc uuid;
begin
  case p_kind
  when 'zones' then
    insert into public.zones(code, name, region) values (coalesce(app.v(r,'code'), 'Z-' || app.slug(app.v(r,'name'))), app.v(r,'name'), app.v(r,'region'))
    on conflict (code) do update set name = excluded.name, region = coalesce(excluded.region, public.zones.region);
  when 'branches' then
    insert into public.branches(code, name, branch_type, type_confirmed, state, city)
    values (coalesce(app.v(r,'code'), 'B-' || app.slug(app.v(r,'name'))), app.v(r,'name'), coalesce(lower(app.v(r,'type')), 'own'),
            app.v(r,'type') is not null, app.v(r,'state'), app.v(r,'city'))
    on conflict (code) do update set name = excluded.name, branch_type = excluded.branch_type, type_confirmed = excluded.type_confirmed,
       state = coalesce(excluded.state, public.branches.state), city = coalesce(excluded.city, public.branches.city)
    returning id into v_id;
    if app.v(r,'zone') is not null and not exists (select 1 from public.branch_zones where branch_id = v_id and valid @> v_from) then
      insert into public.branch_zones(branch_id, zone_id, valid) values (v_id, app.find('zones', app.v(r,'zone')), daterange(v_from, null));
    end if;
  when 'locations' then
    insert into public.locations(code, name, city, state) values (coalesce(app.v(r,'code'), 'L-' || app.slug(app.v(r,'name'))), app.v(r,'name'), app.v(r,'city'), app.v(r,'state'))
    on conflict (code) do update set name = excluded.name, city = coalesce(excluded.city, public.locations.city), state = coalesce(excluded.state, public.locations.state);
  when 'clients' then
    insert into public.clients(code, name, client_family) values (coalesce(app.v(r,'code'), 'C-' || app.slug(app.v(r,'name'))), app.v(r,'name'), app.v(r,'family'))
    on conflict (code) do update set name = excluded.name, client_family = coalesce(excluded.client_family, public.clients.client_family);
  when 'services' then
    v_proc := coalesce(app.find('processes', app.v(r,'process'), false), (select id from public.processes where code = 'VER'));
    insert into public.client_locations(client_id, location_id, process_id, branch_id, valid)
    values (app.find('clients', app.v(r,'client')), app.find('locations', app.v(r,'location')), v_proc,
            app.find('branches', coalesce(app.v(r,'branch'), app.v(r,'location'))), daterange(v_from, case when v_to is null then null else v_to + 1 end));
  when 'rates' then
    v_proc := coalesce(app.find('processes', app.v(r,'process'), false), (select id from public.processes where code = 'VER'));
    insert into public.rate_cards(client_id, location_id, process_id, billable_event, rate, valid, reason)
    values (app.find('clients', app.v(r,'client')), app.find('locations', app.v(r,'location')), v_proc,
            coalesce(lower(app.v(r,'earns_on')), 'entry'), app.v(r,'rate')::numeric,
            daterange(v_from, case when v_to is null then null else v_to + 1 end), coalesce(app.v(r,'reason'), 'bulk upload'));
  when 'people' then
    if app.v(r,'mobile') is not null and exists (select 1 from public.persons where right(regexp_replace(mobile, '\D', '', 'g'), 10) = right(regexp_replace(app.v(r,'mobile'), '\D', '', 'g'), 10)) then
      raise exception 'Mobile % already exists.', app.v(r,'mobile');
    end if;
    perform public.create_team_member(app.v(r,'full_name'), app.v(r,'email'), app.v(r,'mobile'),
      case when lower(coalesce(app.v(r,'type'), 'own')) like 'partner%' then 'partner' else 'own_employee' end,
      app.v(r,'designation'), lower(coalesce(app.v(r,'role'), 'executive'))::app.role_code,
      app.find('persons', app.v(r,'reports_to_mobile'), false), lower(coalesce(app.v(r,'function'), 'operations'))::app.fn, v_from,
      app.find('zones', app.v(r,'zone'), false), app.find('branches', app.v(r,'branch'), false));
  when 'allocations' then
    v_proc := coalesce(app.find('processes', app.v(r,'process'), false), (select id from public.processes where code = 'VER'));
    select id into v_cl from public.client_locations where client_id = app.find('clients', app.v(r,'client'))
       and location_id = app.find('locations', app.v(r,'location')) and process_id = v_proc and valid @> v_from;
    if v_cl is null then raise exception 'No service for % at % on % — add it under Services first.', app.v(r,'client'), app.v(r,'location'), v_from; end if;
    perform public.allocate(app.find('persons', app.v(r,'mobile')), v_cl, v_from, v_to, lower(coalesce(app.v(r,'function'), 'operations'))::app.fn);
  when 'targets' then
    perform public.set_target(app.to_date(app.v(r,'month') || case when app.v(r,'month') ~ '^\d{4}-\d{2}$' then '-01' else '' end),
      lower(app.v(r,'metric')), lower(app.v(r,'level')), app.v(r,'amount')::numeric,
      app.find('zones', app.v(r,'zone'), false), app.find('branches', app.v(r,'branch'), false),
      app.find('persons', app.v(r,'mobile'), false), app.find('clients', app.v(r,'client'), false), coalesce(app.v(r,'reason'), 'bulk upload'));
  when 'holidays' then
    insert into public.holidays(holiday_date, name, scope, state, branch_id)
    values (app.to_date(app.v(r,'date')), app.v(r,'name'), coalesce(lower(app.v(r,'scope')), 'national'), app.v(r,'state'),
            app.find('branches', app.v(r,'branch'), false))
    on conflict do nothing;
  when 'partner_ratios' then
    insert into public.partner_share_rules(branch_id, partner_share_pct, crux_share_pct, valid, agreement_ref, reason)
    values (app.find('branches', app.v(r,'branch')), app.v(r,'partner_pct')::numeric, 100 - app.v(r,'partner_pct')::numeric,
            daterange(v_from, null), app.v(r,'agreement_ref'), coalesce(app.v(r,'reason'), 'bulk upload'));
  when 'wip_openings' then
    select id into v_cl from public.client_locations where client_id = app.find('clients', app.v(r,'client'))
       and location_id = app.find('locations', app.v(r,'location')) and valid @> v_from limit 1;
    if v_cl is null then raise exception 'No service for % at %.', app.v(r,'client'), app.v(r,'location'); end if;
    insert into public.wip_openings(person_id, client_location_id, as_of, opening, reason, set_by)
    values (app.find('persons', app.v(r,'mobile')), v_cl, v_from, app.v(r,'opening')::int, coalesce(app.v(r,'reason'), 'bulk upload'), app.me())
    on conflict (person_id, client_location_id, as_of) do update set opening = excluded.opening, reason = excluded.reason;
  else raise exception 'Unknown upload type %.', p_kind;
  end case;
end $$;

create or replace function public.bulk_import(p_kind text, p_rows jsonb, p_dry_run boolean default true) returns jsonb
language plpgsql security definer set search_path = public, app, extensions, pg_temp as $$
declare r jsonb; i int := 0; ok int := 0; errs jsonb := '[]'::jsonb; v_msg text;
begin
  if not (app.is_admin() or (app.has_role('hr_admin') and p_kind in ('people','allocations','holidays'))) then
    raise exception 'Only Admin can use bulk upload.' using errcode = '42501';
  end if;
  if jsonb_array_length(coalesce(p_rows, '[]')) > 5000 then raise exception 'At most 5,000 rows per upload.' using errcode = 'P0001'; end if;
  perform set_config('app.reason', 'bulk upload: ' || p_kind, true);
  begin
    for r in select * from jsonb_array_elements(coalesce(p_rows, '[]')) loop
      i := i + 1;
      begin
        perform app.bulk_row(p_kind, r);
        ok := ok + 1;
      exception when others then
        get stacked diagnostics v_msg = message_text;
        errs := errs || jsonb_build_object('row', i, 'error', v_msg);
      end;
    end loop;
    if p_dry_run or jsonb_array_length(errs) > 0 then
      raise exception using errcode = 'P0099', message = 'undo';
    end if;
  exception when sqlstate 'P0099' then
    null;   -- nothing is kept: a check run, or a file with errors, writes nothing
  end;
  return jsonb_build_object('kind', p_kind, 'rows', i, 'ok', ok, 'errors', errs,
                            'applied', not p_dry_run and jsonb_array_length(errs) = 0);
end $$;

-- ------------------------------------------------------------ grants for new functions
revoke all on function public.check_in(), public.check_out(), public.set_attendance(uuid, date, text, text),
  public.request_leave(date, date, text, text, text), public.decide_leave(uuid, boolean, text), public.cancel_leave(uuid),
  public.attendance_summary(date, date, uuid), public.day_report(date, text),
  public.certify_team_detail(date, app.fn, jsonb, text), public.import_tracker_day(date, text, jsonb, jsonb),
  public.revenue_status_data(date), public.bulk_import(text, jsonb, boolean) from public, anon;
grant execute on function public.check_in(), public.check_out(), public.set_attendance(uuid, date, text, text),
  public.request_leave(date, date, text, text, text), public.decide_leave(uuid, boolean, text), public.cancel_leave(uuid),
  public.attendance_summary(date, date, uuid), public.day_report(date, text),
  public.certify_team_detail(date, app.fn, jsonb, text), public.import_tracker_day(date, text, jsonb, jsonb),
  public.revenue_status_data(date), public.bulk_import(text, jsonb, boolean) to authenticated;
revoke all on function app.bulk_row(text, jsonb), app.find(text, text, boolean) from public, anon, authenticated;
alter function app.v(jsonb, text) set search_path = public, app, pg_temp;
alter function app.to_date(text) set search_path = public, app, pg_temp;
