-- Milestone 4 (owner feedback 03 Nov):
--  * location_heads: who heads which location (optionally for specific clients) — Zonal Manager groups and
--    Branch Manager / BA heads. One person can head many locations; a location can have different heads per client.
--  * self-service client selection (tick active / inactive) and manager correction of a team member's entry with a note
--  * automatic attendance from reporting (no check-in), confirmed by managers with category / sub-category
--  * the Zonal Tracker produced by the tool from entered figures, scoped to each viewer's locations
--  * plain-language settings editing; copy last month's targets
-- Additive only.

-- ------------------------------------------------------------------ location heads
create table public.location_heads (
  id uuid primary key default gen_random_uuid(),
  branch_id uuid not null references public.branches(id),
  client_id uuid references public.clients(id),            -- null = every client at the location
  person_id uuid not null references public.persons(id),
  head_role text not null check (head_role in ('zonal_manager','branch_head')),
  valid daterange not null check (not isempty(valid) and lower(valid) is not null),
  reason text not null default 'set by admin',
  set_by uuid references public.persons(id),
  created_at timestamptz not null default now()
);
create index on public.location_heads (person_id);
create index on public.location_heads (branch_id);
alter table public.location_heads enable row level security;
create policy read_location_heads on public.location_heads for select to authenticated using (app.me() is not null);
revoke all on public.location_heads from anon;
revoke all on public.location_heads from authenticated;
grant select on public.location_heads to authenticated;
create trigger trg_audit after insert or update on public.location_heads for each row execute function app.audit();

create or replace function app.head_of(p_branch uuid, p_client uuid, p_role text, p_date date) returns uuid
language sql stable security definer set search_path = public, app, pg_temp as $$
  select h.person_id from public.location_heads h
   where h.branch_id = p_branch and h.head_role = p_role and h.valid @> p_date
     and (h.client_id = p_client or h.client_id is null)
   order by (h.client_id is null), h.created_at desc limit 1
$$;

create or replace function public.set_location_head(p_branch uuid, p_person uuid, p_role text, p_client uuid default null,
                                                    p_from date default null, p_reason text default null)
returns public.location_heads
language plpgsql security definer set search_path = public, app, pg_temp as $$
declare v_from date := coalesce(p_from, app.today()); v_h public.location_heads;
begin
  if not (app.is_admin() or app.has_role('hr_admin')) then raise exception 'Only Admin / HR can change location heads.' using errcode = '42501'; end if;
  if p_role not in ('zonal_manager','branch_head') then raise exception 'Unknown head type.' using errcode = '22023'; end if;
  perform set_config('app.reason', coalesce(nullif(trim(p_reason), ''), 'location head change'), true);
  -- the previous head of the same location (and client scope) ends the day before; a same-day change is re-pointed
  update public.location_heads set valid = daterange(lower(valid), v_from)
   where branch_id = p_branch and head_role = p_role and client_id is not distinct from p_client
     and upper_inf(valid) and lower(valid) < v_from;
  update public.location_heads set person_id = p_person, reason = coalesce(nullif(trim(p_reason), ''), reason), set_by = app.me()
   where branch_id = p_branch and head_role = p_role and client_id is not distinct from p_client
     and upper_inf(valid) and lower(valid) = v_from
  returning * into v_h;
  if v_h.id is not null then return v_h; end if;
  insert into public.location_heads(branch_id, client_id, person_id, head_role, valid, reason, set_by)
  values (p_branch, p_client, p_person, p_role, daterange(v_from, null), coalesce(nullif(trim(p_reason), ''), 'set by admin'), app.me())
  returning * into v_h;
  return v_h;
end $$;

create or replace function public.end_location_head(p_id uuid, p_last_day date, p_reason text) returns public.location_heads
language plpgsql security definer set search_path = public, app, pg_temp as $$
declare v_h public.location_heads;
begin
  if not (app.is_admin() or app.has_role('hr_admin')) then raise exception 'Only Admin / HR can change location heads.' using errcode = '42501'; end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'A reason is required.' using errcode = 'P0001'; end if;
  perform set_config('app.reason', p_reason, true);
  update public.location_heads set valid = daterange(lower(valid), greatest(p_last_day + 1, lower(valid) + 1))
   where id = p_id returning * into v_h;
  return v_h;
end $$;

-- Branches a person may see in location-based reports: everything for leadership; otherwise locations they or
-- anyone under them head or work on.
create or replace function app.visible_branches(p_date date) returns setof uuid
language plpgsql stable security definer set search_path = public, app, pg_temp as $$
declare v_me uuid := app.me();
begin
  if v_me is null then return; end if;
  if app.is_admin() or app.has_role('auditor') or app.has_role('ops_head') or app.has_role('collections_head') then
    return query select b.id from public.branches b; return;
  end if;
  return query
  with people as (select v_me pid union select s.person_id from app.subtree(v_me, 'operations', p_date) s
                  union select s.person_id from app.subtree(v_me, 'collections', p_date) s)
  select distinct h.branch_id from public.location_heads h join people on people.pid = h.person_id
   where h.valid && daterange(date_trunc('month', p_date)::date, p_date + 1)
  union
  select distinct cl.branch_id from public.allocations a join people on people.pid = a.person_id
    join public.client_locations cl on cl.id = a.client_location_id
   where a.valid && daterange(date_trunc('month', p_date)::date, p_date + 1);
end $$;

-- ------------------------------------------------------------------ self-service client selection
-- Every active service, with whether the person currently works on it. Their own locations sort first.
create or replace function public.my_services(p_person uuid default null)
returns table(client_location_id uuid, client_id uuid, client text, location_id uuid, location text, branch_id uuid,
              zone text, active boolean, since date, my_location boolean)
language plpgsql stable security definer set search_path = public, app, pg_temp as $$
declare v_p uuid := coalesce(p_person, app.me()); v_d date := app.today();
begin
  if app.me() is null then raise exception 'Not signed in' using errcode = '28000'; end if;
  if v_p <> app.me() and not (app.is_admin() or app.has_role('hr_admin')
       or exists (select 1 from app.subtree(app.me(), 'operations', v_d) s where s.person_id = v_p)) then
    raise exception 'You can only see clients for yourself or your team.' using errcode = '42501';
  end if;
  return query
  with mine as (select a.client_location_id, lower(a.valid) since from public.allocations a
                 where a.person_id = v_p and a.function = 'operations' and a.valid @> v_d and upper_inf(a.valid)),
       locs as (select cl.location_id from mine join public.client_locations cl on cl.id = mine.client_location_id
                union select cl.location_id from public.location_heads h join public.client_locations cl on cl.branch_id = h.branch_id
                 where h.person_id = v_p and h.valid @> v_d)
  select cl.id, c.id, c.name, l.id, l.name, cl.branch_id, z.name, mine.client_location_id is not null, mine.since,
         l.id in (select locs.location_id from locs)
    from public.client_locations cl
    join public.clients c on c.id = cl.client_id join public.locations l on l.id = cl.location_id
    left join public.branch_zones bz on bz.branch_id = cl.branch_id and bz.valid @> v_d
    left join public.zones z on z.id = bz.zone_id
    left join mine on mine.client_location_id = cl.id
   where cl.valid @> v_d and c.active and l.active
   order by (mine.client_location_id is null), (l.id not in (select locs.location_id from locs)), l.name, c.name;
end $$;

-- Tick = start working on it from today; untick = stop from today (from tomorrow if figures were already entered today).
create or replace function public.set_service_active(p_client_location uuid, p_active boolean, p_person uuid default null,
                                                     p_reason text default null)
returns text
language plpgsql security definer set search_path = public, app, pg_temp as $$
declare v_p uuid := coalesce(p_person, app.me()); v_d date := app.today(); v_a public.allocations; v_end date;
begin
  if app.me() is null then raise exception 'Not signed in' using errcode = '28000'; end if;
  if v_p <> app.me() then
    if not (app.is_admin() or app.has_role('hr_admin')
            or exists (select 1 from app.subtree(app.me(), 'operations', v_d) s where s.person_id = v_p)) then
      raise exception 'You can only change clients for yourself or your team.' using errcode = '42501';
    end if;
    if coalesce(trim(p_reason), '') = '' then raise exception 'A reason is required when changing someone else''s clients.' using errcode = 'P0001'; end if;
  end if;
  perform set_config('app.reason', coalesce(nullif(trim(p_reason), ''), case when p_active then 'started working on client' else 'stopped working on client' end), true);
  select * into v_a from public.allocations a where a.person_id = v_p and a.client_location_id = p_client_location
     and a.function = 'operations' and (a.valid @> v_d or lower(a.valid) > v_d or upper(a.valid) = v_d)
   order by lower(a.valid) desc limit 1;
  if p_active then
    if v_a.id is not null then
      update public.allocations set valid = daterange(least(lower(valid), v_d), null) where id = v_a.id;
    else
      insert into public.allocations(person_id, client_location_id, function, valid) values (v_p, p_client_location, 'operations', daterange(v_d, null));
    end if;
    return 'active';
  end if;
  if v_a.id is null or not upper_inf(v_a.valid) then return 'inactive'; end if;
  v_end := case when lower(v_a.valid) >= v_d or exists (select 1 from public.productivity_lines l where l.person_id = v_p
                  and l.work_date = v_d and l.client_location_id = p_client_location) then v_d + 1 else v_d end;
  update public.allocations set valid = daterange(lower(valid), v_end) where id = v_a.id;
  return case when v_end = v_d then 'inactive' else 'inactive from tomorrow' end;
end $$;

-- Manager edits or removes (sets to zero) a team member's entry, with a note. The person is notified; the old
-- values stay in the audit log.
create or replace function public.correct_team_line(p_person uuid, p_date date, p_client_location uuid,
    p_entry int, p_closure int, p_cancelled int, p_note text, p_remove boolean default false)
returns public.productivity_lines
language plpgsql security definer set search_path = public, app, pg_temp as $$
declare v_l public.productivity_lines; v_me uuid := app.me(); v_name text; v_mgr uuid;
begin
  if v_me is null then raise exception 'Not signed in' using errcode = '28000'; end if;
  if not (app.is_admin() or (p_person <> v_me and exists (select 1 from app.subtree(v_me, 'operations', p_date) s where s.person_id = p_person))) then
    raise exception 'You can only correct entries of people in your team.' using errcode = '42501';
  end if;
  if coalesce(trim(p_note), '') = '' then raise exception 'A note is required.' using errcode = 'P0001'; end if;
  if p_date > app.today() or (p_date < app.today() - 31 and not app.is_admin()) then
    raise exception 'Entries older than 31 days can be corrected by Admin only.' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.closed_periods cp where cp.month = date_trunc('month', p_date)::date) then
    raise exception 'That month is closed. Ask Admin to reopen the period.' using errcode = 'P0001';
  end if;
  if least(coalesce(p_entry,0), coalesce(p_closure,0), coalesce(p_cancelled,0)) < 0 then raise exception 'Figures cannot be negative.' using errcode = 'P0001'; end if;
  select full_name into v_name from public.persons where id = v_me;
  perform set_config('app.reason', p_note, true);
  update public.productivity_lines set entry = case when p_remove then 0 else coalesce(p_entry, 0) end,
         closure = case when p_remove then 0 else coalesce(p_closure, 0) end, cancelled = case when p_remove then 0 else coalesce(p_cancelled, 0) end,
         source = 'on_behalf', entered_by = v_me, updated_at = now(),
         reason = (case when p_remove then 'Removed by ' else 'Corrected by ' end) || v_name || ': ' || p_note
   where person_id = p_person and work_date = p_date and client_location_id = p_client_location
  returning * into v_l;
  if v_l.id is null then raise exception 'No entry found for that person, date and client.' using errcode = 'P0001'; end if;
  insert into public.notifications(person_id, kind, message, link)
  values (p_person, 'entry_corrected', v_name || (case when p_remove then ' removed' else ' corrected' end) || ' your entry for ' || to_char(p_date, 'DD Mon') || ': ' || p_note, '/productivity');
  select manager_id into v_mgr from public.reporting_lines where person_id = p_person and function = 'operations' and valid @> p_date;
  if v_mgr is not null and v_mgr <> v_me and exists (select 1 from public.certifications c where c.manager_id = v_mgr and c.work_date = p_date and c.function = 'operations') then
    insert into public.notifications(person_id, kind, message, link)
    values (v_mgr, 'entry_corrected', v_name || ' changed a certified entry for ' || to_char(p_date, 'DD Mon') || ': ' || p_note, '/team');
  end if;
  return v_l;
end $$;

-- ------------------------------------------------------------------ automatic attendance
-- Present when the person reported for the day (or certified their team); absent once the reporting window has
-- closed without a report. A manager's confirmation (attendance row) always wins.
create or replace function app.auto_attendance(p_person uuid, p_date date) returns text
language sql stable security definer set search_path = public, app, pg_temp as $$
  select case
    when not app.is_working_day(p_date) then
      case when exists (select 1 from public.day_status d where d.person_id = p_person and d.work_date = p_date and d.status in ('submitted','manager_entered'))
           then 'sunday_work' else 'weekly_off' end
    when exists (select 1 from public.day_status d where d.person_id = p_person and d.work_date = p_date
                  and d.status in ('submitted','manager_entered','non_operational'))
      or exists (select 1 from public.certifications c where c.manager_id = p_person and c.work_date = p_date) then 'present'
    when exists (select 1 from public.day_status d where d.person_id = p_person and d.work_date = p_date and d.status = 'on_leave') then 'unplanned_leave'
    when exists (select 1 from public.day_status d where d.person_id = p_person and d.work_date = p_date and d.status = 'absent') then 'absent'
    when app.window_state(p_date) in ('open','grace','future') then 'pending'
    else 'absent' end
$$;

create or replace function app.att_category(s text) returns text language sql immutable as $$
  select case when s in ('present','late','early_leave','half_day','sunday_work') then 'Present'
              when s in ('absent','planned_leave','unplanned_leave') then 'Absent'
              when s in ('weekly_off','holiday') then 'Off' else 'Not reported yet' end $$;
create or replace function app.att_sub(s text) returns text language sql immutable as $$
  select case s when 'present' then 'Full day' when 'late' then 'Full day' when 'early_leave' then 'Full day'
    when 'half_day' then 'Half day' when 'sunday_work' then 'Sunday / holiday work' when 'absent' then 'No show (not informed)'
    when 'planned_leave' then 'Planned leave' when 'unplanned_leave' then 'Unplanned leave' when 'weekly_off' then 'Weekly off'
    when 'holiday' then 'Holiday' else 'Waiting for report' end $$;

create or replace function public.attendance_board(p_from date, p_to date, p_manager uuid default null)
returns table(person_id uuid, full_name text, is_direct boolean, scheduled int, present int, half_day int, absent int,
              planned_leave int, unplanned_leave int, pending int, unconfirmed int, shrinkage_pct numeric, unplanned_streak int,
              day_status text, day_category text, day_sub text, day_confirmed boolean, day_basis text, day_reason text)
language plpgsql stable security definer set search_path = public, app, pg_temp as $$
declare v_me uuid := app.me(); v_to date := least(p_to, app.today()); v_all boolean;
begin
  if v_me is null then raise exception 'Not signed in' using errcode = '28000'; end if;
  v_all := app.is_admin() or app.has_role('hr_admin') or app.has_role('ops_head') or app.has_role('auditor');
  if p_manager is not null and p_manager <> v_me and not v_all
     and not exists (select 1 from app.subtree(v_me, 'operations', v_to) s where s.person_id = p_manager) then
    raise exception 'Not in your team.' using errcode = '42501';
  end if;
  return query
  with people as (
    select p.id, p.full_name from public.persons p
     where p.status in ('active','invited')
       and case when p_manager is null then p.id = v_me
                else p.id in (select s.person_id from app.subtree(p_manager, 'operations', v_to) s
                              union select s.person_id from app.subtree(p_manager, 'collections', v_to) s) end),
  days as (select g::date d from generate_series(p_from, v_to, interval '1 day') g),
  grid as (select pe.id, pe.full_name, dd.d, a.status confirmed, a.reason, a.source,
                  coalesce(a.status, app.auto_attendance(pe.id, dd.d)) st
             from people pe cross join days dd
             left join public.attendance a on a.person_id = pe.id and a.work_date = dd.d),
  w as (select g.*, row_number() over (partition by g.id order by g.d) rn from grid g
         where app.is_working_day(g.d) or g.st = 'sunday_work'),
  agg as (select w.id, w.full_name,
            count(*) filter (where app.is_working_day(w.d))::int sch,
            count(*) filter (where w.st in ('present','late','early_leave','sunday_work'))::int pr,
            count(*) filter (where w.st = 'half_day')::int hd, count(*) filter (where w.st = 'absent')::int ab,
            count(*) filter (where w.st = 'planned_leave')::int pl, count(*) filter (where w.st = 'unplanned_leave')::int ul,
            count(*) filter (where w.st = 'pending')::int pe,
            count(*) filter (where w.confirmed is null and w.st not in ('pending','weekly_off'))::int uc
            from w group by w.id, w.full_name)
  select a.id, a.full_name,
         exists (select 1 from public.reporting_lines r where r.person_id = a.id and r.manager_id = v_me and r.valid @> v_to),
         a.sch, a.pr, a.hd, a.ab, a.pl, a.ul, a.pe, a.uc,
         case when a.sch - a.pe > 0 then round((a.ab + a.pl + a.ul + 0.5 * a.hd)::numeric / (a.sch - a.pe) * 100, 1) end,
         (select coalesce(max(cnt), 0)::int from (select count(*) cnt from (
            select w.rn - row_number() over (order by w.rn) grp from w where w.id = a.id and w.st in ('absent','unplanned_leave')) x group by grp) y),
         t.st, app.att_category(t.st), app.att_sub(t.st), t.confirmed is not null,
         case when t.confirmed is not null then 'Confirmed' || case when t.source = 'leave' then ' (approved leave)' else '' end
              when t.st = 'present' then 'Auto: reported figures'
              when t.st = 'pending' then 'Auto: no report yet (window open)'
              when t.st = 'absent' then 'Auto: no report by the deadline' else 'Auto' end,
         t.reason
    from agg a left join grid t on t.id = a.id and t.d = v_to
   order by (t.confirmed is not null), app.att_category(t.st) desc, a.full_name;
end $$;

-- ------------------------------------------------------------------ the Zonal Tracker, produced by the tool
create or replace function public.zonal_tracker(p_date date default null) returns jsonb
language plpgsql stable security definer set search_path = public, app, pg_temp as $$
declare v_d date := least(coalesce(p_date, app.today()), app.today()); v_m date; v_end date;
begin
  if app.me() is null then raise exception 'Not signed in' using errcode = '28000'; end if;
  v_m := date_trunc('month', v_d)::date; v_end := (v_m + interval '1 month - 1 day')::date;
  return jsonb_build_object('source', 'tool', 'as_of', v_d, 'prev_as_of', case when v_d > v_m then v_d - 1 end, 'dates', '[]'::jsonb,
    'wd_done', app.working_days_between(v_m, v_d), 'wd_total', app.working_days_between(v_m, v_end),
    'rows', (
    with vis as (select * from app.visible_branches(v_d) b(id)),
    act as (select m.branch_id, m.client_id,
                   sum(m.entry - m.cancelled) mtd_cases, sum(coalesce(m.revenue, 0)) mtd_revenue,
                   sum(m.entry - m.cancelled) filter (where m.work_date < v_d) prev_cases,
                   sum(coalesce(m.revenue, 0)) filter (where m.work_date < v_d) prev_revenue,
                   sum(m.entry) filter (where m.work_date = v_d) e_today, sum(m.closure) filter (where m.work_date = v_d) c_today,
                   sum(m.cancelled) filter (where m.work_date = v_d) x_today,
                   sum(m.entry) me, sum(m.closure) mc, sum(m.cancelled) mx, count(*) filter (where m.rate is null) unrated
              from public.v_line_metrics m where m.work_date between v_m and v_d and m.branch_id in (select id from vis)
             group by m.branch_id, m.client_id),
    tgt as (select t.branch_id, t.client_id, t.amount from public.target_allocations t
             where t.is_current and t.month = v_m and t.metric = 'entry' and t.level = 'branch' and t.client_id is not null
               and t.branch_id in (select id from vis)),
    keys as (select branch_id, client_id from act union select branch_id, client_id from tgt),
    rate as (select distinct on (cl.branch_id, cl.client_id) cl.branch_id, cl.client_id, rc.rate
               from public.client_locations cl join public.rate_cards rc on rc.client_id = cl.client_id and rc.location_id = cl.location_id
                and rc.process_id = cl.process_id and rc.valid @> v_d
              order by cl.branch_id, cl.client_id, rc.rate desc)
    select coalesce(jsonb_agg(jsonb_build_object(
             'region', coalesce(z.region, 'Unassigned'), 'zone', coalesce(z.name, b.name), 'location', b.name, 'client', c.name,
             'branch_id', b.id, 'client_id', c.id,
             'stakeholder', (select p.full_name from public.persons p where p.id = app.head_of(b.id, c.id, 'zonal_manager', v_d)),
             'head', (select p.full_name from public.persons p where p.id = app.head_of(b.id, c.id, 'branch_head', v_d)),
             'target_cases', coalesce(t.amount, 0), 'revenue_target', coalesce(t.amount, 0) * coalesce(r.rate, 0), 'rate', r.rate,
             'mtd_cases', coalesce(a.mtd_cases, 0), 'mtd_revenue', coalesce(a.mtd_revenue, 0),
             'prev_cases', coalesce(a.prev_cases, 0), 'prev_revenue', coalesce(a.prev_revenue, 0),
             'reported_added', coalesce(a.mtd_cases, 0) - coalesce(a.prev_cases, 0),
             'entry_today', coalesce(a.e_today, 0), 'closure_today', coalesce(a.c_today, 0), 'cancelled_today', coalesce(a.x_today, 0),
             'mtd_entry', coalesce(a.me, 0), 'mtd_closure', coalesce(a.mc, 0), 'mtd_cancelled', coalesce(a.mx, 0),
             'unrated_lines', coalesce(a.unrated, 0))
             order by coalesce(z.region, 'Unassigned'), coalesce(z.name, b.name), b.name, c.name), '[]'::jsonb)
      from keys k join public.branches b on b.id = k.branch_id join public.clients c on c.id = k.client_id
      left join act a on a.branch_id = k.branch_id and a.client_id = k.client_id
      left join tgt t on t.branch_id = k.branch_id and t.client_id = k.client_id
      left join rate r on r.branch_id = k.branch_id and r.client_id = k.client_id
      left join public.branch_zones bz on bz.branch_id = b.id and bz.valid @> v_d
      left join public.zones z on z.id = bz.zone_id));
end $$;

-- Copy a month's location × client case targets to another month (proposal for the owner to confirm; Admin / OH).
create or replace function public.copy_targets(p_to_month date, p_from_month date, p_source text default 'targets', p_apply boolean default false)
returns jsonb
language plpgsql security definer set search_path = public, app, pg_temp as $$
declare v_to date := date_trunc('month', p_to_month)::date; v_from date := date_trunc('month', p_from_month)::date; r record; n int := 0; tot numeric := 0;
begin
  if not (app.is_admin() or app.has_role('ops_head')) then raise exception 'Only Admin or the Operations Head can copy targets.' using errcode = '42501'; end if;
  for r in
    select t.branch_id, t.client_id, t.amount from public.target_allocations t
     where p_source = 'targets' and t.is_current and t.month = v_from and t.metric = 'entry' and t.level = 'branch' and t.client_id is not null
    union all
    select m.branch_id, m.client_id, sum(m.target_cases) from public.tracker_monthly m
     where p_source = 'tracker' and m.month = v_from and m.branch_id is not null and m.client_id is not null and coalesce(m.target_cases, 0) > 0
     group by m.branch_id, m.client_id
  loop
    n := n + 1; tot := tot + r.amount;
    if p_apply then
      perform public.set_target(v_to, 'entry', 'branch', r.amount, null, r.branch_id, null, r.client_id,
                                'Copied from ' || to_char(v_from, 'Mon YYYY') || case when p_source = 'tracker' then ' Zonal Tracker' else '' end);
    end if;
  end loop;
  return jsonb_build_object('rows', n, 'target_cases', tot, 'applied', p_apply);
end $$;

-- Location × client case targets for a month, for the Admin targets grid.
create or replace function public.location_targets(p_month date)
returns table(branch_id uuid, branch text, zone text, client_id uuid, client text, rate numeric, target_cases numeric, last_month_cases numeric)
language plpgsql stable security definer set search_path = public, app, pg_temp as $$
declare v_m date := date_trunc('month', p_month)::date;
begin
  if not (app.is_admin() or app.has_role('ops_head') or app.has_role('auditor')) then raise exception 'Not allowed.' using errcode = '42501'; end if;
  return query
  select distinct on (b.id, c.id) b.id, b.name, z.name, c.id, c.name, rc.rate,
         (select t.amount from public.target_allocations t where t.is_current and t.month = v_m and t.metric = 'entry' and t.level = 'branch'
            and t.branch_id = b.id and t.client_id = c.id),
         coalesce((select t.amount from public.target_allocations t where t.is_current and t.month = (v_m - interval '1 month')::date and t.metric = 'entry'
            and t.level = 'branch' and t.branch_id = b.id and t.client_id = c.id),
                  (select sum(m.target_cases) from public.tracker_monthly m where m.month = (v_m - interval '1 month')::date and m.branch_id = b.id and m.client_id = c.id))
    from public.client_locations cl join public.branches b on b.id = cl.branch_id join public.clients c on c.id = cl.client_id
    left join public.branch_zones bz on bz.branch_id = b.id and bz.valid @> v_m
    left join public.zones z on z.id = bz.zone_id
    left join public.rate_cards rc on rc.client_id = cl.client_id and rc.location_id = cl.location_id and rc.process_id = cl.process_id and rc.valid @> v_m
   where cl.valid && daterange(v_m, (v_m + interval '1 month')::date)
   order by b.id, c.id, rc.rate desc nulls last;
end $$;

-- ------------------------------------------------------------------ plain-language settings
alter table public.settings add column if not exists label text;
alter table public.settings add column if not exists help text;
alter table public.settings add column if not exists kind text;
alter table public.settings add column if not exists section text;
alter table public.settings add column if not exists editable boolean not null default true;
update public.settings s set label = v.label, help = v.help, kind = v.kind, section = v.section, editable = v.editable
  from (values
  ('shift_start', 'Shift starts at', 'Normal start of the working day.', 'time', 'Working hours', true),
  ('shift_end', 'Shift ends at', 'Normal end of the working day.', 'time', 'Working hours', true),
  ('break_minutes', 'Break (minutes)', 'Lunch / break time inside the shift.', 'number', 'Working hours', true),
  ('late_grace_minutes', 'Late after (minutes)', 'Kept for reference; attendance is now marked from daily reporting.', 'number', 'Working hours', true),
  ('half_day_hours', 'Half day below (hours)', 'Kept for reference; managers mark half days when confirming attendance.', 'number', 'Working hours', true),
  ('weekly_off_dow', 'Weekly off', 'Days that are not working days (Sunday by default).', 'weekdays', 'Working hours', true),
  ('grace_until', 'Late reporting allowed until (next morning)', 'Daily figures are due by midnight; late entry is allowed until this time the next day.', 'time', 'Daily reporting', true),
  ('target_lock_working_days', 'Targets lock after working day', 'Targets for a month can be changed until the end of this working day; after that only Admin can reopen.', 'number', 'Targets', true),
  ('absence_trigger_days', 'Flag unplanned absence after (working days in a row)', 'People absent unplanned for more than this many working days in a row are flagged for HR.', 'number', 'Attendance', true),
  ('absence_trigger_basis', 'Count absence in', 'working_days or calendar_days.', 'choice:working_days,calendar_days', 'Attendance', true),
  ('invite_expiry_working_hours', 'Activation code valid for (working hours)', 'How long a new joiner''s one-time code works.', 'number', 'Sign-in', true),
  ('report_recipients', 'Revenue Status email goes to', 'Email addresses, one per line or separated by commas.', 'emails', 'Reports', true),
  ('app_url', 'App link shown in messages', 'The address people open on their phone.', 'text', 'Reports', true),
  ('business_tz', 'Business time zone', 'Fixed: India Standard Time.', 'text', 'System', false),
  ('allow_fake_clock', 'Test clock', 'Testing only — always off in the live system.', 'toggle', 'System', false)
  ) v(key, label, help, kind, section, editable)
 where s.key = v.key;

create or replace function public.set_setting(p_key text, p_value jsonb) returns public.settings
language plpgsql security definer set search_path = public, app, pg_temp as $$
declare v_s public.settings;
begin
  if not app.is_admin() then raise exception 'Only Admin can change settings.' using errcode = '42501'; end if;
  select * into v_s from public.settings where key = p_key;
  if v_s.key is null then raise exception 'Unknown setting.' using errcode = '22023'; end if;
  if not v_s.editable then raise exception 'This setting cannot be changed here.' using errcode = 'P0001'; end if;
  if jsonb_typeof(p_value) <> jsonb_typeof(v_s.value) then raise exception 'That value is not the right type for "%".', coalesce(v_s.label, p_key) using errcode = '22023'; end if;
  if v_s.kind = 'time' and not ((p_value #>> '{}') ~ '^([01]\d|2[0-3]):[0-5]\d$') then raise exception 'Use a time like 09:30.' using errcode = '22023'; end if;
  if v_s.kind = 'number' and (p_value::text)::numeric < 0 then raise exception 'Use a number of 0 or more.' using errcode = '22023'; end if;
  perform set_config('app.reason', 'setting changed: ' || p_key, true);
  update public.settings set value = p_value, updated_at = now() where key = p_key returning * into v_s;
  return v_s;
end $$;

-- ------------------------------------------------------------------ grants
revoke all on function public.set_location_head(uuid, uuid, text, uuid, date, text), public.end_location_head(uuid, date, text),
  public.my_services(uuid), public.set_service_active(uuid, boolean, uuid, text),
  public.correct_team_line(uuid, date, uuid, int, int, int, text, boolean), public.attendance_board(date, date, uuid),
  public.zonal_tracker(date), public.copy_targets(date, date, text, boolean), public.location_targets(date),
  public.set_setting(text, jsonb) from public, anon;
grant execute on function public.set_location_head(uuid, uuid, text, uuid, date, text), public.end_location_head(uuid, date, text),
  public.my_services(uuid), public.set_service_active(uuid, boolean, uuid, text),
  public.correct_team_line(uuid, date, uuid, int, int, int, text, boolean), public.attendance_board(date, date, uuid),
  public.zonal_tracker(date), public.copy_targets(date, date, text, boolean), public.location_targets(date),
  public.set_setting(text, jsonb) to authenticated;
revoke all on function app.visible_branches(date), app.head_of(uuid, uuid, text, date), app.auto_attendance(uuid, date) from public, anon, authenticated;
