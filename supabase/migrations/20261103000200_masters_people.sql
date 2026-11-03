-- Organisation masters, people, effective-dated roles / reporting / allocations, scope functions.

create table public.zones (
  id uuid primary key default gen_random_uuid(),
  code text not null unique, name text not null,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.branches (
  id uuid primary key default gen_random_uuid(),
  code text not null unique, name text not null,
  branch_type text not null check (branch_type in ('own','partner')),
  state text, city text,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

-- One primary zone per branch at a time (SOW 4.3).
create table public.branch_zones (
  id uuid primary key default gen_random_uuid(),
  branch_id uuid not null references public.branches(id),
  zone_id uuid not null references public.zones(id),
  valid daterange not null check (not isempty(valid) and lower(valid) is not null),
  created_at timestamptz not null default now(),
  exclude using gist (branch_id with =, valid with &&)
);

create table public.clients (
  id uuid primary key default gen_random_uuid(),
  code text not null unique, name text not null,
  client_family text,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.locations (
  id uuid primary key default gen_random_uuid(),
  code text not null unique, name text not null,
  city text, state text,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.processes (
  id uuid primary key default gen_random_uuid(),
  code text not null unique, name text not null,
  function app.fn not null default 'operations',
  rateable boolean not null default true,
  targetable boolean not null default true,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

-- A service CRUX delivers: client + location + process, attributed to one branch at a time.
create table public.client_locations (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id),
  location_id uuid not null references public.locations(id),
  process_id uuid not null references public.processes(id),
  branch_id uuid not null references public.branches(id),
  valid daterange not null check (not isempty(valid) and lower(valid) is not null),
  created_at timestamptz not null default now(),
  exclude using gist (client_id with =, location_id with =, process_id with =, valid with &&)
);
create index on public.client_locations (branch_id);

create table public.holidays (
  id uuid primary key default gen_random_uuid(),
  holiday_date date not null,
  name text not null,
  scope text not null check (scope in ('national','public','state','regional','branch','team')),
  state text,
  branch_id uuid references public.branches(id),
  created_at timestamptz not null default now(),
  unique nulls not distinct (holiday_date, scope, state, branch_id)
);

create or replace function app.is_working_day(p_date date, p_branch uuid default null) returns boolean
language sql stable security definer set search_path = public, app, pg_temp as $$
  select not (extract(dow from p_date)::int in
               (select jsonb_array_elements_text(app.setting('weekly_off_dow'))::int))
     and not exists (
       select 1 from public.holidays h
        where h.holiday_date = p_date
          and ( (h.scope in ('national','public') and h.branch_id is null)
             or (p_branch is not null and h.branch_id = p_branch)
             or (p_branch is not null and h.scope in ('state','regional') and h.branch_id is null
                 and h.state = (select b.state from public.branches b where b.id = p_branch)) ))
$$;

create or replace function app.working_days_between(p_from date, p_to date, p_branch uuid default null)
returns int language sql stable as $$
  select count(*)::int from generate_series(p_from, p_to, interval '1 day') d
   where app.is_working_day(d::date, p_branch)
$$;

-- ---------------------------------------------------------------- people
create table public.persons (
  id uuid primary key default gen_random_uuid(),
  full_name text not null,
  mobile text unique check (mobile ~ '^[0-9+][0-9]{9,14}$'),
  personal_email text unique check (personal_email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  resource_type text not null check (resource_type in ('own_employee','partner')),
  designation text,
  status text not null default 'invited' check (status in ('invited','active','suspended','exited')),
  auth_user_id uuid unique,
  invite_expires_at timestamptz,
  joined_on date,
  exited_on date,
  created_at timestamptz not null default now(),
  check (exited_on is null or joined_on is null or exited_on >= joined_on)
);

create table public.role_assignments (
  id uuid primary key default gen_random_uuid(),
  person_id uuid not null references public.persons(id),
  role app.role_code not null,
  zone_id uuid references public.zones(id),
  branch_id uuid references public.branches(id),
  valid daterange not null check (not isempty(valid) and lower(valid) is not null),
  reason text,
  created_at timestamptz not null default now(),
  exclude using gist (person_id with =, role with =, valid with &&)
);

-- Effective-dated reporting line per function (SOW 3.4). One manager per person per function at a time.
create table public.reporting_lines (
  id uuid primary key default gen_random_uuid(),
  person_id uuid not null references public.persons(id),
  manager_id uuid not null references public.persons(id),
  function app.fn not null,
  valid daterange not null check (not isempty(valid) and lower(valid) is not null),
  reason text,
  created_at timestamptz not null default now(),
  check (person_id <> manager_id),
  exclude using gist (person_id with =, function with =, valid with &&)
);
create index on public.reporting_lines (manager_id, function);

-- Which client-location services a person may report on (SOW 4.3).
create table public.allocations (
  id uuid primary key default gen_random_uuid(),
  person_id uuid not null references public.persons(id),
  client_location_id uuid not null references public.client_locations(id),
  function app.fn not null default 'operations',
  valid daterange not null check (not isempty(valid) and lower(valid) is not null),
  created_at timestamptz not null default now(),
  exclude using gist (person_id with =, client_location_id with =, function with =, valid with &&)
);

-- ---------------------------------------------------------------- scope
create or replace function app.me() returns uuid
language sql stable security definer set search_path = public, app, pg_temp as $$
  select p.id from public.persons p
   where p.auth_user_id = auth.uid() and p.status in ('active','invited')
$$;

create or replace function app.has_role(p_role app.role_code, p_date date default null) returns boolean
language sql stable security definer set search_path = public, app, pg_temp as $$
  select exists (select 1 from public.role_assignments r
                  where r.person_id = app.me() and r.role = p_role
                    and r.valid @> coalesce(p_date, app.today()))
$$;

create or replace function app.is_admin() returns boolean
language sql stable as $$ select app.has_role('admin') $$;

-- Everyone below p_manager in function p_fn as at p_date (all levels).
create or replace function app.subtree(p_manager uuid, p_fn app.fn, p_date date)
returns table(person_id uuid, depth int)
language sql stable security definer set search_path = public, app, pg_temp as $$
  with recursive t(person_id, depth, path) as (
    select r.person_id, 1, array[p_manager, r.person_id]
      from public.reporting_lines r
     where r.manager_id = p_manager and r.function = p_fn and r.valid @> p_date
    union all
    select r.person_id, t.depth + 1, t.path || r.person_id
      from public.reporting_lines r join t on r.manager_id = t.person_id
     where r.function = p_fn and r.valid @> p_date and not r.person_id = any(t.path)
  )
  select person_id, min(depth) from t group by person_id
$$;

create or replace function app.is_direct_report(p_person uuid, p_fn app.fn, p_date date) returns boolean
language sql stable security definer set search_path = public, app, pg_temp as $$
  select exists (select 1 from public.reporting_lines r
                  where r.person_id = p_person and r.manager_id = app.me()
                    and r.function = p_fn and r.valid @> p_date)
$$;

-- Central visibility rule used by RLS (SOW 13.1). Evaluated as at the record's date.
create or replace function app.can_view_person(p_person uuid, p_date date, p_fn app.fn) returns boolean
language plpgsql stable security definer set search_path = public, app, pg_temp as $$
declare v_me uuid := app.me();
begin
  if v_me is null then return false; end if;
  if p_person = v_me then return true; end if;
  if app.has_role('admin') or app.has_role('auditor') then return true; end if;
  if app.has_role('ops_head') then return true; end if;                -- whole Operations org incl. collections (Master §4)
  if p_fn = 'collections' and app.has_role('collections_head') then return true; end if;
  return exists (select 1 from app.subtree(v_me, p_fn, coalesce(p_date, app.today())) s where s.person_id = p_person);
end $$;

-- Cycle guard: a manager may not be placed under their own subordinate.
create or replace function app.reporting_cycle_guard() returns trigger
language plpgsql security definer set search_path = public, app, pg_temp as $$
begin
  if exists (select 1 from app.subtree(new.person_id, new.function, lower(new.valid)) s
              where s.person_id = new.manager_id) then
    raise exception 'Reporting cycle: % already reports (directly or indirectly) to %', new.manager_id, new.person_id
      using errcode = 'check_violation';
  end if;
  return new;
end $$;
create trigger trg_reporting_cycle before insert or update on public.reporting_lines
  for each row execute function app.reporting_cycle_guard();

-- Link a signed-in, email-verified auth user to their invited person record (D-13).
create or replace function public.claim_my_person() returns uuid
language plpgsql security definer set search_path = public, app, pg_temp as $$
declare v_email text; v_id uuid;
begin
  if auth.uid() is null then raise exception 'Not signed in' using errcode = '28000'; end if;
  select id into v_id from public.persons where auth_user_id = auth.uid();
  if v_id is not null then return v_id; end if;
  select lower(email) into v_email from auth.users where id = auth.uid();
  update public.persons p set auth_user_id = auth.uid(), status = 'active'
   where lower(p.personal_email) = v_email and p.auth_user_id is null and p.status = 'invited'
     and (p.invite_expires_at is null or p.invite_expires_at > app.clock())
  returning p.id into v_id;
  return v_id;  -- null = no valid invitation; UI shows "ask your administrator"
end $$;
