-- Daily productivity, submission windows, statuses, manager gate and certification, WIP.

create table public.productivity_lines (
  id uuid primary key default gen_random_uuid(),
  person_id uuid not null references public.persons(id),
  work_date date not null,
  client_location_id uuid not null references public.client_locations(id),
  entry integer not null default 0 check (entry >= 0),
  closure integer not null default 0 check (closure >= 0),
  cancelled integer not null default 0 check (cancelled >= 0),
  source text not null default 'self' check (source in ('self','on_behalf','admin','import')),
  entered_by uuid references public.persons(id),
  reason text,
  import_batch_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (person_id, work_date, client_location_id),
  check (source <> 'on_behalf' or reason is not null)
);
create index on public.productivity_lines (work_date);
create index on public.productivity_lines (client_location_id, work_date);

create table public.day_status (
  person_id uuid not null references public.persons(id),
  work_date date not null,
  function app.fn not null,
  status text not null check (status in
    ('draft','submitted','manager_entered','absent','on_leave','non_operational','exception')),
  reason text,
  set_by uuid references public.persons(id),
  submitted_at timestamptz,
  late boolean not null default false,
  revision integer not null default 0,
  updated_at timestamptz not null default now(),
  primary key (person_id, work_date, function),
  check (status in ('draft','submitted') or reason is not null)
);
create index on public.day_status (work_date, function);

create table public.certifications (
  id uuid primary key default gen_random_uuid(),
  manager_id uuid not null references public.persons(id),
  work_date date not null,
  function app.fn not null,
  team_totals jsonb not null,      -- read-only roll-up snapshot (excludes the manager)
  own_totals jsonb not null,       -- manager's own lines
  calculated_total numeric(16,2) not null, -- team + own of the headline metric
  certified_value numeric(16,2),   -- optional reconciliation figure (D-06)
  variance numeric(16,2) generated always as (certified_value - calculated_total) stored,
  reason text,
  late boolean not null default false,
  revision integer not null default 0,
  certified_at timestamptz not null default now(),
  unique (manager_id, work_date, function),
  check (certified_value is null or certified_value = calculated_total or reason is not null)
);

-- Admin reopen grants (SOW 7.3). Minimum scope: a person (optionally their team), one date or one target month.
create table public.reopen_grants (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('submission','target')),
  person_id uuid not null references public.persons(id),
  include_team boolean not null default false,
  work_date date,
  target_month date,
  function app.fn not null default 'operations',
  expires_at timestamptz not null,
  reason text not null,
  granted_by uuid not null references public.persons(id),
  created_at timestamptz not null default now(),
  revoked_at timestamptz,
  check ((kind = 'submission' and work_date is not null) or (kind = 'target' and target_month is not null))
);

-- WIP seed: opening inventory at the start of as_of (D-01).
create table public.wip_openings (
  id uuid primary key default gen_random_uuid(),
  person_id uuid not null references public.persons(id),
  client_location_id uuid not null references public.client_locations(id),
  as_of date not null,
  opening integer not null check (opening >= 0),
  reason text not null,
  set_by uuid references public.persons(id),
  created_at timestamptz not null default now(),
  unique (person_id, client_location_id, as_of)
);

-- ------------------------------------------------------------ window
create or replace function app.window_state(p_date date) returns text
language plpgsql stable as $$
declare
  v_now timestamptz := app.clock();
  v_midnight timestamptz := ((p_date + 1)::timestamp) at time zone app.tz();
  v_grace timestamptz := ((p_date + 1)::timestamp + (app.setting('grace_until') #>> '{}')::time) at time zone app.tz();
begin
  if p_date > app.today() then return 'future'; end if;
  if v_now < v_midnight then return 'open'; end if;
  if v_now < v_grace then return 'grace'; end if;
  return 'closed';
end $$;

create or replace function app.active_reopen(p_person uuid, p_date date, p_fn app.fn) returns boolean
language sql stable security definer set search_path = public, app, pg_temp as $$
  select exists (
    select 1 from public.reopen_grants g
     where g.kind = 'submission' and g.work_date = p_date and g.function = p_fn
       and g.revoked_at is null and g.expires_at > app.clock()
       and (g.person_id = p_person
            or (g.include_team and exists (select 1 from app.subtree(g.person_id, p_fn, p_date) s
                                            where s.person_id = p_person))))
$$;

create or replace function app.can_write_day(p_person uuid, p_date date, p_fn app.fn) returns boolean
language sql stable as $$
  select app.window_state(p_date) in ('open','grace') or app.active_reopen(p_person, p_date, p_fn)
$$;

create or replace function app.require_writable(p_person uuid, p_date date, p_fn app.fn) returns void
language plpgsql stable as $$
begin
  if app.window_state(p_date) = 'future' then
    raise exception 'You cannot report for a future date (%).', p_date using errcode = 'P0001';
  end if;
  if not app.can_write_day(p_person, p_date, p_fn) then
    raise exception 'The reporting window for % is closed. Ask an Admin to reopen it.', p_date using errcode = 'P0001';
  end if;
end $$;

create or replace function app.has_reports(p_person uuid, p_fn app.fn, p_date date) returns boolean
language sql stable security definer set search_path = public, app, pg_temp as $$
  select exists (select 1 from public.reporting_lines r
                  where r.manager_id = p_person and r.function = p_fn and r.valid @> p_date)
$$;

-- ------------------------------------------------------------ RPC: save lines (draft / autosave)
-- p_rows: [{client_location_id, entry, closure, cancelled}]
create or replace function public.save_productivity(p_work_date date, p_rows jsonb,
                                                    p_person uuid default null, p_reason text default null)
returns setof public.productivity_lines
language plpgsql security definer set search_path = public, app, pg_temp as $$
declare
  v_me uuid := app.me();
  v_person uuid := coalesce(p_person, v_me);
  v_source text := 'self';
  v_status text;
  r jsonb;
begin
  if v_me is null then raise exception 'Not signed in' using errcode = '28000'; end if;
  if v_person <> v_me then
    if not app.is_direct_report(v_person, 'operations', p_work_date) then
      raise exception 'You can only enter figures for your direct reports.' using errcode = '42501';
    end if;
    if coalesce(trim(p_reason), '') = '' then
      raise exception 'A reason is required when entering on behalf of someone.' using errcode = 'P0001';
    end if;
    v_source := 'on_behalf';
  end if;
  perform app.require_writable(v_person, p_work_date, 'operations');

  select status into v_status from public.day_status
   where person_id = v_person and work_date = p_work_date and function = 'operations';
  if v_status is not null and v_status <> 'draft'
     and not app.active_reopen(v_person, p_work_date, 'operations') then
    raise exception 'This day is already %. Ask an Admin to reopen it to make changes.', replace(v_status,'_',' ')
      using errcode = 'P0001';
  end if;

  perform set_config('app.reason', coalesce(p_reason, ''), true);
  for r in select * from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) loop
    if not exists (select 1 from public.allocations a
                    where a.person_id = v_person and a.function = 'operations'
                      and a.client_location_id = (r->>'client_location_id')::uuid
                      and a.valid @> p_work_date) then
      raise exception 'Client/location % is not allocated to this person on %.', r->>'client_location_id', p_work_date
        using errcode = '42501';
    end if;
    if (r->>'entry')::numeric <> trunc((r->>'entry')::numeric)
       or (r->>'closure')::numeric <> trunc((r->>'closure')::numeric)
       or (r->>'cancelled')::numeric <> trunc((r->>'cancelled')::numeric) then
      raise exception 'Counts must be whole numbers.' using errcode = '22023';
    end if;
    insert into public.productivity_lines as l
      (person_id, work_date, client_location_id, entry, closure, cancelled, source, entered_by, reason)
    values (v_person, p_work_date, (r->>'client_location_id')::uuid,
            coalesce((r->>'entry')::int, 0), coalesce((r->>'closure')::int, 0), coalesce((r->>'cancelled')::int, 0),
            v_source, v_me, nullif(p_reason, ''))
    on conflict (person_id, work_date, client_location_id) do update
      set entry = excluded.entry, closure = excluded.closure, cancelled = excluded.cancelled,
          source = case when l.source = 'self' and excluded.source = 'self' then 'self' else excluded.source end,
          entered_by = excluded.entered_by, reason = coalesce(excluded.reason, l.reason), updated_at = now()
      where (l.entry, l.closure, l.cancelled) is distinct from (excluded.entry, excluded.closure, excluded.cancelled);
  end loop;

  insert into public.day_status(person_id, work_date, function, status, set_by)
  values (v_person, p_work_date, 'operations', 'draft', v_me)
  on conflict do nothing;

  return query select * from public.productivity_lines where person_id = v_person and work_date = p_work_date;
end $$;

-- ------------------------------------------------------------ RPC: submit (idempotent)
create or replace function public.submit_day(p_work_date date, p_person uuid default null, p_reason text default null)
returns public.day_status
language plpgsql security definer set search_path = public, app, pg_temp as $$
declare
  v_me uuid := app.me();
  v_person uuid := coalesce(p_person, v_me);
  v_ds public.day_status;
  v_missing int;
  v_state text := app.window_state(p_work_date);
  v_reopen boolean := app.active_reopen(coalesce(p_person, app.me()), p_work_date, 'operations');
begin
  if v_me is null then raise exception 'Not signed in' using errcode = '28000'; end if;
  if v_person <> v_me and not app.is_direct_report(v_person, 'operations', p_work_date) then
    raise exception 'You can only submit for your direct reports.' using errcode = '42501';
  end if;
  if v_person <> v_me and coalesce(trim(p_reason), '') = '' then
    raise exception 'A reason is required when submitting on behalf of someone.' using errcode = 'P0001';
  end if;
  perform app.require_writable(v_person, p_work_date, 'operations');

  select * into v_ds from public.day_status
   where person_id = v_person and work_date = p_work_date and function = 'operations';
  if v_ds.status in ('submitted','manager_entered') and not v_reopen then
    return v_ds;  -- duplicate submit: no-op
  end if;
  if v_ds.status in ('absent','on_leave','non_operational','exception') and not v_reopen then
    raise exception 'This day is marked %. Ask your manager to change it first.', replace(v_ds.status,'_',' ')
      using errcode = 'P0001';
  end if;

  -- Every allocated client-location needs a line; zero is a valid answer (SOW 7.2).
  select count(*) into v_missing from public.allocations a
   where a.person_id = v_person and a.function = 'operations' and a.valid @> p_work_date
     and not exists (select 1 from public.productivity_lines l
                      where l.person_id = v_person and l.work_date = p_work_date
                        and l.client_location_id = a.client_location_id);
  if v_missing > 0 then
    raise exception '% assigned client/location row(s) have no figures. Enter 0 where there was no work.', v_missing
      using errcode = 'P0001';
  end if;

  perform set_config('app.reason', coalesce(p_reason, ''), true);
  insert into public.day_status as d (person_id, work_date, function, status, reason, set_by, submitted_at, late, revision)
  values (v_person, p_work_date, 'operations',
          case when v_person = v_me then 'submitted' else 'manager_entered' end,
          nullif(p_reason, ''), v_me, app.clock(), v_state <> 'open', 0)
  on conflict (person_id, work_date, function) do update
    set status = excluded.status, reason = excluded.reason, set_by = excluded.set_by,
        submitted_at = excluded.submitted_at, late = excluded.late,
        revision = d.revision + case when d.status in ('submitted','manager_entered') then 1 else 0 end,
        updated_at = now()
  returning * into v_ds;
  return v_ds;
end $$;

-- ------------------------------------------------------------ RPC: manager resolves a direct report
create or replace function public.set_member_status(p_person uuid, p_work_date date, p_status text,
                                                    p_reason text, p_function app.fn default 'operations')
returns public.day_status
language plpgsql security definer set search_path = public, app, pg_temp as $$
declare v_ds public.day_status;
begin
  if app.me() is null then raise exception 'Not signed in' using errcode = '28000'; end if;
  if p_status not in ('absent','on_leave','non_operational','exception') then
    raise exception 'Status must be absent, on leave, non-operational or exception.' using errcode = '22023';
  end if;
  if not app.is_direct_report(p_person, p_function, p_work_date) then
    raise exception 'You can only set status for your direct reports.' using errcode = '42501';
  end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'A reason is required.' using errcode = 'P0001'; end if;
  perform app.require_writable(p_person, p_work_date, p_function);
  select * into v_ds from public.day_status where person_id = p_person and work_date = p_work_date and function = p_function;
  if v_ds.status in ('submitted','manager_entered') and not app.active_reopen(p_person, p_work_date, p_function) then
    raise exception 'This person has already submitted; their submission cannot be replaced by a status.' using errcode = 'P0001';
  end if;
  perform set_config('app.reason', p_reason, true);
  insert into public.day_status as d (person_id, work_date, function, status, reason, set_by, submitted_at)
  values (p_person, p_work_date, p_function, p_status, p_reason, app.me(), app.clock())
  on conflict (person_id, work_date, function) do update
    set status = excluded.status, reason = excluded.reason, set_by = excluded.set_by,
        submitted_at = excluded.submitted_at, updated_at = now()
  returning * into v_ds;
  return v_ds;
end $$;

-- ------------------------------------------------------------ roll-up helpers
create or replace function app.ops_totals(p_people uuid[], p_date date) returns jsonb
language sql stable security definer set search_path = public, app, pg_temp as $$
  select jsonb_build_object(
    'entry', coalesce(sum(entry),0), 'closure', coalesce(sum(closure),0), 'cancelled', coalesce(sum(cancelled),0),
    'net', coalesce(sum(entry + closure - cancelled),0), 'lines', count(*))
  from public.productivity_lines where work_date = p_date and person_id = any(p_people)
$$;

-- Team status for the manager screen: one row per direct report.
create or replace function public.team_status(p_work_date date, p_function app.fn default 'operations',
                                              p_manager uuid default null)
returns table(person_id uuid, full_name text, designation text, is_manager boolean, status text, reason text,
              late boolean, submitted_at timestamptz, certified boolean, resolved boolean,
              entry bigint, closure bigint, cancelled bigint, net bigint)
language plpgsql stable security definer set search_path = public, app, pg_temp as $$
declare v_mgr uuid := coalesce(p_manager, app.me());
begin
  if v_mgr is null or not app.can_view_person(v_mgr, p_work_date, p_function) then
    raise exception 'Not permitted.' using errcode = '42501';
  end if;
  return query
  select p.id, p.full_name, p.designation,
         app.has_reports(p.id, p_function, p_work_date),
         coalesce(d.status, 'pending'), d.reason, coalesce(d.late,false), d.submitted_at,
         c.id is not null,
         case when app.has_reports(p.id, p_function, p_work_date) then c.id is not null
              else coalesce(d.status in ('submitted','manager_entered','absent','on_leave','non_operational','exception'), false) end,
         coalesce(sum(l.entry),0)::bigint, coalesce(sum(l.closure),0)::bigint, coalesce(sum(l.cancelled),0)::bigint,
         coalesce(sum(l.entry + l.closure - l.cancelled),0)::bigint
    from public.reporting_lines r
    join public.persons p on p.id = r.person_id
    left join public.day_status d on d.person_id = p.id and d.work_date = p_work_date and d.function = p_function
    left join public.certifications c on c.manager_id = p.id and c.work_date = p_work_date and c.function = p_function
    left join public.productivity_lines l on l.person_id = p.id and l.work_date = p_work_date and p_function = 'operations'
   where r.manager_id = v_mgr and r.function = p_function and r.valid @> p_work_date
   group by p.id, p.full_name, p.designation, d.status, d.reason, d.late, d.submitted_at, c.id
   order by 10, p.full_name;   -- unresolved first
end $$;

-- ------------------------------------------------------------ RPC: certify (manager gate, SOW 7.1 / 5.5)
create or replace function public.certify_team(p_work_date date, p_function app.fn default 'operations',
                                               p_certified_value numeric default null, p_reason text default null)
returns public.certifications
language plpgsql security definer set search_path = public, app, pg_temp as $$
declare
  v_me uuid := app.me();
  v_blockers text;
  v_team uuid[];
  v_team_tot jsonb; v_own_tot jsonb; v_calc numeric;
  v_c public.certifications;
  v_existing public.certifications;
begin
  if v_me is null then raise exception 'Not signed in' using errcode = '28000'; end if;
  if not app.has_reports(v_me, p_function, p_work_date) then
    raise exception 'You have no team to certify for %.', p_work_date using errcode = 'P0001';
  end if;
  perform app.require_writable(v_me, p_work_date, p_function);   -- D-07

  select * into v_existing from public.certifications
   where manager_id = v_me and work_date = p_work_date and function = p_function;
  if v_existing.id is not null and not app.active_reopen(v_me, p_work_date, p_function) then
    raise exception 'You have already certified %. Ask an Admin to reopen it to recertify.', p_work_date
      using errcode = 'P0001';
  end if;

  select string_agg(full_name || ' (' || case when is_manager then 'team not certified' else status end || ')', ', ')
    into v_blockers
    from public.team_status(p_work_date, p_function) where not resolved;
  if v_blockers is not null then
    raise exception 'Cannot certify yet. Waiting on: %', v_blockers using errcode = 'P0001';
  end if;

  -- Own figures must be submitted if the manager has their own allocations that day.
  if exists (select 1 from public.allocations a where a.person_id = v_me and a.function = p_function
                and a.valid @> p_work_date)
     and not exists (select 1 from public.day_status d where d.person_id = v_me and d.work_date = p_work_date
                        and d.function = p_function and d.status <> 'draft') then
    raise exception 'Submit your own contribution for % before certifying the team.', p_work_date using errcode = 'P0001';
  end if;

  select array_agg(person_id) into v_team from app.subtree(v_me, p_function, p_work_date);
  if p_function = 'operations' then
    v_team_tot := app.ops_totals(v_team, p_work_date);
    v_own_tot := app.ops_totals(array[v_me], p_work_date);
    v_calc := (v_team_tot->>'net')::numeric + (v_own_tot->>'net')::numeric;
  else
    select jsonb_build_object('received', coalesce(sum(amount_received),0), 'reconciled', coalesce(sum(amount_reconciled),0))
      into v_team_tot from public.collection_entries where collection_date = p_work_date and person_id = any(v_team);
    select jsonb_build_object('received', coalesce(sum(amount_received),0), 'reconciled', coalesce(sum(amount_reconciled),0))
      into v_own_tot from public.collection_entries where collection_date = p_work_date and person_id = v_me;
    v_calc := (v_team_tot->>'received')::numeric + (v_own_tot->>'received')::numeric;
  end if;

  if p_certified_value is not null and p_certified_value <> v_calc and coalesce(trim(p_reason),'') = '' then
    raise exception 'Your certified figure differs from the calculated total by %. Give a reason.',
      p_certified_value - v_calc using errcode = 'P0001';
  end if;

  perform set_config('app.reason', coalesce(p_reason, ''), true);
  insert into public.certifications as c (manager_id, work_date, function, team_totals, own_totals,
                                          calculated_total, certified_value, reason, late)
  values (v_me, p_work_date, p_function, v_team_tot, v_own_tot, v_calc, p_certified_value, nullif(p_reason,''),
          app.window_state(p_work_date) <> 'open')
  on conflict (manager_id, work_date, function) do update
    set team_totals = excluded.team_totals, own_totals = excluded.own_totals,
        calculated_total = excluded.calculated_total, certified_value = excluded.certified_value,
        reason = excluded.reason, late = excluded.late, revision = c.revision + 1, certified_at = now()
  returning * into v_c;
  return v_c;
end $$;

-- ------------------------------------------------------------ Admin reopen
create or replace function public.grant_reopen(p_kind text, p_person uuid, p_reason text, p_expires_at timestamptz,
                                               p_work_date date default null, p_target_month date default null,
                                               p_include_team boolean default false,
                                               p_function app.fn default 'operations')
returns public.reopen_grants
language plpgsql security definer set search_path = public, app, pg_temp as $$
declare g public.reopen_grants;
begin
  if not app.is_admin() then raise exception 'Only an Admin can reopen.' using errcode = '42501'; end if;
  if coalesce(trim(p_reason),'') = '' then raise exception 'A reason is required.' using errcode = 'P0001'; end if;
  if p_expires_at <= app.clock() or p_expires_at > app.clock() + interval '7 days' then
    raise exception 'Expiry must be in the future and within 7 days.' using errcode = '22023';
  end if;
  perform set_config('app.reason', p_reason, true);
  insert into public.reopen_grants(kind, person_id, include_team, work_date, target_month, function,
                                   expires_at, reason, granted_by)
  values (p_kind, p_person, p_include_team, p_work_date, date_trunc('month', p_target_month)::date, p_function,
          p_expires_at, p_reason, app.me())
  returning * into g;
  return g;
end $$;

-- ------------------------------------------------------------ WIP (D-01, provisional)
create or replace view public.v_wip with (security_invoker = true) as
with seeded as (
  select l.*, s.opening as seed, s.as_of as seed_date,
         (l.entry - l.closure - l.cancelled) as movement
    from public.productivity_lines l
    left join lateral (select w.opening, w.as_of from public.wip_openings w
                        where w.person_id = l.person_id and w.client_location_id = l.client_location_id
                          and w.as_of <= l.work_date order by w.as_of desc limit 1) s on true
)
select id, person_id, client_location_id, work_date, entry, closure, cancelled,
       seed_date is not null as seeded,
       coalesce(seed,0) + sum(movement) over w - movement as opening_wip,
       coalesce(seed,0) + sum(movement) over w as closing_wip
  from seeded
window w as (partition by person_id, client_location_id, seed_date order by work_date
             rows between unbounded preceding and current row);
