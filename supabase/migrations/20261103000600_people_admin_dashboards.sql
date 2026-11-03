-- Team setup RPCs, dashboard RPCs and roll-ups.

-- Invite validity: 48 hours that fall on working days (D-13). Non-working days are skipped whole.
create or replace function app.invite_expiry(p_from timestamptz) returns timestamptz
language plpgsql stable as $$
declare v_left interval := make_interval(hours => coalesce((app.setting('invite_expiry_working_hours'))::text::int, 48));
        v_t timestamptz := p_from; v_day_end timestamptz; v_d date;
begin
  loop
    v_d := (v_t at time zone app.tz())::date;
    v_day_end := ((v_d + 1)::timestamp) at time zone app.tz();
    if app.is_working_day(v_d) then
      if v_t + v_left <= v_day_end then return v_t + v_left; end if;
      v_left := v_left - (v_day_end - v_t);
    end if;
    v_t := v_day_end;
  end loop;
end $$;

create or replace function app.person_defaults() returns trigger language plpgsql as $$
begin
  if new.status = 'invited' and new.invite_expires_at is null then
    new.invite_expires_at := app.invite_expiry(app.clock());
  end if;
  return new;
end $$;
create trigger trg_person_defaults before insert on public.persons
  for each row execute function app.person_defaults();

-- Creation sequence (SOW 3.5): Admin/HR anyone; OH/ZM/BM/BA/managers create people under themselves or their tree.
create or replace function public.create_team_member(p_full_name text, p_email text, p_mobile text,
    p_resource_type text, p_designation text, p_role app.role_code, p_manager_id uuid,
    p_function app.fn default 'operations', p_valid_from date default null,
    p_zone_id uuid default null, p_branch_id uuid default null)
returns public.persons
language plpgsql security definer set search_path = public, app, pg_temp as $$
declare v_from date := coalesce(p_valid_from, app.today()); v_p public.persons; v_me uuid := app.me();
begin
  if v_me is null then raise exception 'Not signed in' using errcode = '28000'; end if;
  if not (app.is_admin() or app.has_role('hr_admin')) then
    if p_role in ('admin','hr_admin','auditor','ops_head','collections_head') then
      raise exception 'Only Admin/HR can create that role.' using errcode = '42501';
    end if;
    if p_manager_id is null or not (p_manager_id = v_me or exists (
         select 1 from app.subtree(v_me, p_function, v_from) s where s.person_id = p_manager_id)) then
      raise exception 'You can only add people inside your own team.' using errcode = '42501';
    end if;
    if p_role = 'zm' and not app.has_role('ops_head') then
      raise exception 'Only the Operations Head creates Zonal Managers.' using errcode = '42501';
    end if;
  end if;
  perform set_config('app.reason', 'create team member', true);
  insert into public.persons(full_name, personal_email, mobile, resource_type, designation)
  values (trim(p_full_name), lower(trim(p_email)), nullif(trim(p_mobile),''), p_resource_type, p_designation)
  returning * into v_p;
  insert into public.role_assignments(person_id, role, zone_id, branch_id, valid, reason)
  values (v_p.id, p_role, p_zone_id, p_branch_id, daterange(v_from, null), 'created');
  if p_manager_id is not null then
    insert into public.reporting_lines(person_id, manager_id, function, valid, reason)
    values (v_p.id, p_manager_id, p_function, daterange(v_from, null), 'created');
  end if;
  return v_p;
end $$;

create or replace function public.allocate(p_person uuid, p_client_location uuid, p_valid_from date,
                                           p_valid_to date default null, p_function app.fn default 'operations')
returns public.allocations
language plpgsql security definer set search_path = public, app, pg_temp as $$
declare v_a public.allocations;
begin
  if not (app.is_admin() or (p_person <> app.me() and app.can_view_person(p_person, p_valid_from, p_function)
                              and not app.has_role('auditor'))) then
    raise exception 'You can only allocate people in your team.' using errcode = '42501';
  end if;
  perform set_config('app.reason', 'allocation', true);
  insert into public.allocations(person_id, client_location_id, function, valid)
  values (p_person, p_client_location, p_function, daterange(p_valid_from, p_valid_to + 1))
  returning * into v_a;
  return v_a;
end $$;

-- End an effective-dated row from a date (transfers): never deletes history (SOW 4.3, 18).
create or replace function public.end_assignment(p_table text, p_id uuid, p_last_day date, p_reason text)
returns void language plpgsql security definer set search_path = public, app, pg_temp as $$
begin
  if not (app.is_admin() or app.has_role('hr_admin')) then raise exception 'Admin/HR only.' using errcode = '42501'; end if;
  if p_table not in ('reporting_lines','allocations','role_assignments','branch_zones','client_locations') then
    raise exception 'Unsupported table.' using errcode = '22023';
  end if;
  perform set_config('app.reason', p_reason, true);
  execute format('update public.%I set valid = daterange(lower(valid), $1 + 1) where id = $2 and lower(valid) <= $1', p_table)
    using p_last_day, p_id;
end $$;

-- Offboarding: block sign-in-linked access immediately; history stays (SOW 9.5).
create or replace function public.deactivate_person(p_person uuid, p_last_day date, p_reason text)
returns void language plpgsql security definer set search_path = public, app, pg_temp as $$
begin
  if not (app.is_admin() or app.has_role('hr_admin')) then raise exception 'Admin/HR only.' using errcode = '42501'; end if;
  perform set_config('app.reason', p_reason, true);
  update public.persons set status = 'exited', exited_on = p_last_day where id = p_person;
  update public.role_assignments set valid = daterange(lower(valid), p_last_day + 1)
   where person_id = p_person and (upper(valid) is null or upper(valid) > p_last_day + 1) and lower(valid) <= p_last_day;
  update public.reporting_lines set valid = daterange(lower(valid), p_last_day + 1)
   where person_id = p_person and (upper(valid) is null or upper(valid) > p_last_day + 1) and lower(valid) <= p_last_day;
  update public.allocations set valid = daterange(lower(valid), p_last_day + 1)
   where person_id = p_person and (upper(valid) is null or upper(valid) > p_last_day + 1) and lower(valid) <= p_last_day;
  -- Session revocation: the Edge Function admin-users signs the user out globally (needs service role).
end $$;

-- ------------------------------------------------------------ "who am I" for the app shell
create or replace function public.whoami() returns jsonb
language sql stable security definer set search_path = public, app, pg_temp as $$
  select case when app.me() is null then null else jsonb_build_object(
    'person_id', p.id, 'full_name', p.full_name, 'designation', p.designation, 'status', p.status,
    'roles', (select coalesce(jsonb_agg(distinct r.role), '[]') from public.role_assignments r
               where r.person_id = p.id and r.valid @> app.today()),
    'manages_operations', app.has_reports(p.id, 'operations', app.today()),
    'manages_collections', app.has_reports(p.id, 'collections', app.today()),
    'has_collections', exists (select 1 from public.reporting_lines r where r.person_id = p.id
                                and r.function = 'collections' and r.valid @> app.today())
                       or app.has_reports(p.id, 'collections', app.today()),
    'today', app.today(), 'tz', app.tz(), 'server_time', app.clock())
  end
  from public.persons p where p.id = app.me()
$$;

-- What is due today for me (SOW 11.2 "Today").
create or replace function public.my_day(p_work_date date default null)
returns jsonb language plpgsql stable security definer set search_path = public, app, pg_temp as $$
declare v_d date := coalesce(p_work_date, app.today()); v_me uuid := app.me();
begin
  if v_me is null then raise exception 'Not signed in' using errcode = '28000'; end if;
  return jsonb_build_object(
    'work_date', v_d,
    'window', app.window_state(v_d),
    'reopened', app.active_reopen(v_me, v_d, 'operations'),
    'deadline', ((v_d + 1)::timestamp) at time zone app.tz(),
    'grace_deadline', ((v_d + 1)::timestamp + (app.setting('grace_until') #>> '{}')::time) at time zone app.tz(),
    'is_working_day', app.is_working_day(v_d),
    'status', (select to_jsonb(d) from public.day_status d where d.person_id = v_me and d.work_date = v_d and d.function = 'operations'),
    'rows', (select coalesce(jsonb_agg(jsonb_build_object(
                'client_location_id', cl.id, 'client', c.name, 'location', lo.name, 'process', pr.name,
                'entry', l.entry, 'closure', l.closure, 'cancelled', l.cancelled, 'source', l.source,
                'rate', rc.rate, 'billable_event', rc.billable_event,
                'opening_wip', (coalesce(s.opening,0) + coalesce((select sum(x.entry - x.closure - x.cancelled)
                                  from public.productivity_lines x
                                 where x.person_id = v_me and x.client_location_id = cl.id and x.work_date < v_d
                                   and x.work_date >= coalesce(s.as_of, '-infinity'::date)), 0))::int,
                'wip_seeded', s.opening is not null) order by c.name, lo.name), '[]')
               from public.allocations a
               join public.client_locations cl on cl.id = a.client_location_id
               join public.clients c on c.id = cl.client_id
               join public.locations lo on lo.id = cl.location_id
               join public.processes pr on pr.id = cl.process_id
               left join public.productivity_lines l on l.person_id = v_me and l.work_date = v_d and l.client_location_id = cl.id
               left join public.rate_cards rc on rc.client_id = cl.client_id and rc.location_id = cl.location_id
                                              and rc.process_id = cl.process_id and rc.valid @> v_d
               left join lateral (select w0.opening, w0.as_of from public.wip_openings w0
                                   where w0.person_id = v_me and w0.client_location_id = cl.id and w0.as_of <= v_d
                                   order by w0.as_of desc limit 1) s on true
              where a.person_id = v_me and a.function = 'operations' and a.valid @> v_d)
  );
end $$;

-- Generic, permission-aware roll-up for dashboards and drill-down (SOW 11). SECURITY INVOKER => RLS applies.
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
         coalesce(sum(m.revenue),0), coalesce(sum(m.crux_share),0), coalesce(sum(m.partner_share),0),
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

create or replace function public.collections_rollup(p_from date, p_to date, p_group text,
    p_zone_id uuid default null, p_branch_id uuid default null, p_client_id uuid default null)
returns table(key text, label text, received numeric, reconciled numeric, unreconciled numeric, entries bigint,
              bill_count bigint, bill_amount numeric)
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
         sum(c.bc)::bigint, sum(c.ba)
    from c
    left join public.zones z on p_group = 'zone' and z.id::text = c.k
    left join public.branches br on p_group = 'branch' and br.id::text = c.k
    left join public.persons p on p_group = 'person' and p.id::text = c.k
    left join public.clients cl on p_group = 'client' and cl.id::text = c.k
   group by c.k, z.name, br.name, p.full_name, cl.name
   order by case when p_group = 'date' then c.k end, sum(c.r) desc;
end $$;

-- Missing submissions within my scope for a date, with deadline (SOW 11 "Missing submission countdown").
create or replace function public.missing_submissions(p_work_date date, p_function app.fn default 'operations')
returns table(person_id uuid, full_name text, manager_name text, status text, deadline timestamptz, required_action text)
language plpgsql stable security definer set search_path = public, app, pg_temp as $$
declare v_me uuid := app.me(); v_all boolean := app.is_admin() or app.has_role('ops_head') or app.has_role('auditor')
                                              or (p_function = 'collections' and app.has_role('collections_head'));
begin
  if v_me is null then raise exception 'Not signed in' using errcode = '28000'; end if;
  return query
  select p.id, p.full_name, m.full_name, coalesce(d.status, 'pending'),
         case app.window_state(p_work_date) when 'open' then ((p_work_date + 1)::timestamp) at time zone app.tz()
              else ((p_work_date + 1)::timestamp + (app.setting('grace_until') #>> '{}')::time) at time zone app.tz() end,
         case when app.window_state(p_work_date) = 'closed' then 'Admin reopen needed'
              else 'Submit figures, or manager marks absent / non-operational with reason' end
    from public.persons p
    join public.allocations a on a.person_id = p.id and a.function = p_function and a.valid @> p_work_date
    left join public.reporting_lines r on r.person_id = p.id and r.function = p_function and r.valid @> p_work_date
    left join public.persons m on m.id = r.manager_id
    left join public.day_status d on d.person_id = p.id and d.work_date = p_work_date and d.function = p_function
   where p.status in ('active','invited')
     and (d.status is null or d.status = 'draft')
     and (v_all or p.id in (select s.person_id from app.subtree(v_me, p_function, p_work_date) s) or p.id = v_me)
   group by p.id, p.full_name, m.full_name, d.status
   order by m.full_name nulls first, p.full_name;
end $$;
