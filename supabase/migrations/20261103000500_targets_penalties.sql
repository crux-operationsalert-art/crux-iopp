-- Collections day submission, targets (cascade + lock), penalty ledger, notifications.

create or replace function public.submit_collections_day(p_work_date date, p_person uuid default null,
                                                         p_reason text default null)
returns public.day_status
language plpgsql security definer set search_path = public, app, pg_temp as $$
declare v_me uuid := app.me(); v_person uuid := coalesce(p_person, app.me()); v_ds public.day_status;
begin
  if v_me is null then raise exception 'Not signed in' using errcode = '28000'; end if;
  if v_person <> v_me and not app.is_direct_report(v_person, 'collections', p_work_date) then
    raise exception 'You can only submit for your direct reports.' using errcode = '42501';
  end if;
  if v_person <> v_me and coalesce(trim(p_reason),'') = '' then
    raise exception 'A reason is required when submitting on behalf of someone.' using errcode = 'P0001';
  end if;
  perform app.require_writable(v_person, p_work_date, 'collections');
  select * into v_ds from public.day_status where person_id = v_person and work_date = p_work_date and function = 'collections';
  if v_ds.status in ('submitted','manager_entered') and not app.active_reopen(v_person, p_work_date, 'collections') then
    return v_ds;
  end if;
  perform set_config('app.reason', coalesce(p_reason, ''), true);
  insert into public.day_status as d (person_id, work_date, function, status, reason, set_by, submitted_at, late)
  values (v_person, p_work_date, 'collections', case when v_person = v_me then 'submitted' else 'manager_entered' end,
          nullif(p_reason,''), v_me, app.clock(), app.window_state(p_work_date) <> 'open')
  on conflict (person_id, work_date, function) do update
    set status = excluded.status, reason = excluded.reason, set_by = excluded.set_by,
        submitted_at = excluded.submitted_at, late = excluded.late, revision = d.revision + 1, updated_at = now()
  returning * into v_ds;
  return v_ds;
end $$;

-- ------------------------------------------------------------ targets
create table public.target_allocations (
  id uuid primary key default gen_random_uuid(),
  month date not null check (extract(day from month) = 1),
  metric text not null check (metric in ('net_actioned','entry','closure','revenue',
                                         'collections_received','collections_reconciled','bill_count','bill_amount')),
  level text not null check (level in ('org','zone','branch','person')),
  zone_id uuid references public.zones(id),
  branch_id uuid references public.branches(id),
  person_id uuid references public.persons(id),
  client_id uuid references public.clients(id),
  amount numeric(16,2) not null check (amount >= 0),
  version integer not null default 1,
  is_current boolean not null default true,
  set_by uuid references public.persons(id),
  reason text,
  after_lock boolean not null default false,
  created_at timestamptz not null default now(),
  check ((level = 'org' and zone_id is null and branch_id is null and person_id is null)
      or (level = 'zone' and zone_id is not null and branch_id is null and person_id is null)
      or (level = 'branch' and branch_id is not null and person_id is null)
      or (level = 'person' and person_id is not null))
);
create unique index target_current_uq on public.target_allocations
  (month, metric, level, coalesce(zone_id, '00000000-0000-0000-0000-000000000000'::uuid),
   coalesce(branch_id, '00000000-0000-0000-0000-000000000000'::uuid),
   coalesce(person_id, '00000000-0000-0000-0000-000000000000'::uuid),
   coalesce(client_id, '00000000-0000-0000-0000-000000000000'::uuid))
  where is_current;

-- End of the Nth working day of the month (SOW 8.3).
create or replace function app.target_lock_at(p_month date) returns timestamptz
language plpgsql stable as $$
declare d date := date_trunc('month', p_month)::date; n int := 0;
        k int := coalesce((app.setting('target_lock_working_days'))::text::int, 5);
begin
  loop
    if app.is_working_day(d) then n := n + 1; end if;
    exit when n >= k;
    d := d + 1;
  end loop;
  return ((d + 1)::timestamp) at time zone app.tz();
end $$;

create or replace function app.metric_function(p_metric text) returns app.fn language sql immutable as $$
  select case when p_metric in ('collections_received','collections_reconciled','bill_count','bill_amount')
              then 'collections'::app.fn else 'operations'::app.fn end
$$;

create or replace function app.can_set_target(p_level text, p_metric text, p_zone uuid, p_branch uuid, p_person uuid,
                                              p_month date) returns boolean
language plpgsql stable security definer set search_path = public, app, pg_temp as $$
declare v_fn app.fn := app.metric_function(p_metric); v_head app.role_code;
begin
  if app.is_admin() then return true; end if;
  v_head := case when v_fn = 'collections' then 'collections_head' else 'ops_head' end;   -- D-05
  if app.has_role(v_head) then return true; end if;
  if p_level in ('org','zone') then return false; end if;
  if p_level = 'branch' then
    return exists (select 1 from public.role_assignments r join public.branch_zones bz on bz.zone_id = r.zone_id
                    where r.person_id = app.me() and r.role = 'zm' and r.valid @> app.today()
                      and bz.branch_id = p_branch and bz.valid @> p_month);
  end if;
  return exists (select 1 from app.subtree(app.me(), v_fn, greatest(p_month, app.today())) s where s.person_id = p_person);
end $$;

create or replace function public.set_target(p_month date, p_metric text, p_level text, p_amount numeric,
    p_zone_id uuid default null, p_branch_id uuid default null, p_person_id uuid default null,
    p_client_id uuid default null, p_reason text default null)
returns public.target_allocations
language plpgsql security definer set search_path = public, app, pg_temp as $$
declare
  v_month date := date_trunc('month', p_month)::date;
  v_locked boolean := app.clock() >= app.target_lock_at(v_month);
  v_old public.target_allocations; v_new public.target_allocations;
begin
  if app.me() is null then raise exception 'Not signed in' using errcode = '28000'; end if;
  if not app.can_set_target(p_level, p_metric, p_zone_id, p_branch_id, p_person_id, v_month) then
    raise exception 'You are not allowed to set this target.' using errcode = '42501';
  end if;
  if v_locked and not (app.is_admin() or exists (
        select 1 from public.reopen_grants g where g.kind = 'target' and g.target_month = v_month
           and g.revoked_at is null and g.expires_at > app.clock()
           and (g.person_id = app.me()))) then
    raise exception 'Targets for % locked on %. Ask an Admin to reopen.', to_char(v_month,'Mon YYYY'),
      to_char(app.target_lock_at(v_month) at time zone app.tz(), 'DD Mon HH24:MI') using errcode = 'P0001';
  end if;
  if v_locked and coalesce(trim(p_reason),'') = '' then
    raise exception 'A reason is required to change a target after lock.' using errcode = 'P0001';
  end if;
  -- D-12: a person's total target is either one row or client rows, never both.
  if p_level = 'person' and exists (select 1 from public.target_allocations t
        where t.is_current and t.month = v_month and t.metric = p_metric and t.level = 'person'
          and t.person_id = p_person_id and ((p_client_id is null) <> (t.client_id is null))) then
    raise exception 'This person already has % targets for this metric. Use one style only.',
      case when p_client_id is null then 'client-wise' else 'an overall' end using errcode = 'P0001';
  end if;

  perform set_config('app.reason', coalesce(p_reason, ''), true);
  select * into v_old from public.target_allocations t
   where t.is_current and t.month = v_month and t.metric = p_metric and t.level = p_level
     and t.zone_id is not distinct from p_zone_id and t.branch_id is not distinct from p_branch_id
     and t.person_id is not distinct from p_person_id and t.client_id is not distinct from p_client_id;
  if v_old.id is not null then
    if v_old.amount = p_amount then return v_old; end if;
    update public.target_allocations set is_current = false where id = v_old.id;
  end if;
  insert into public.target_allocations(month, metric, level, zone_id, branch_id, person_id, client_id, amount,
                                        version, set_by, reason, after_lock)
  values (v_month, p_metric, p_level, p_zone_id, p_branch_id, p_person_id, p_client_id, p_amount,
          coalesce(v_old.version, 0) + 1, app.me(), nullif(p_reason,''), v_locked)
  returning * into v_new;
  return v_new;
end $$;

-- Actual for a scope and metric over a date range (RLS-independent; callers check visibility).
create or replace function app.metric_actual(p_metric text, p_from date, p_to date, p_level text,
                                             p_zone uuid, p_branch uuid, p_person uuid, p_client uuid)
returns numeric language plpgsql stable security definer set search_path = public, app, pg_temp as $$
declare v numeric; v_people uuid[];
begin
  if p_level = 'person' then
    -- Person-level target for a manager covers team + own (D-06); for an executive, own only.
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
  elsif p_metric like 'collections%' then
    select coalesce(sum(case when p_metric = 'collections_received' then amount_received else amount_reconciled end), 0)
      into v from public.v_collections c
     where c.collection_date between p_from and p_to and (p_client is null or c.client_id = p_client)
       and case p_level when 'org' then true when 'zone' then c.zone_id = p_zone
                        when 'branch' then c.branch_id = p_branch else c.person_id = any(v_people) end;
  else
    select coalesce(sum(case when p_metric = 'bill_count' then bill_count else bill_amount end), 0)
      into v from public.bill_entries b
      left join public.branch_zones bz on bz.branch_id = b.branch_id and bz.valid @> b.bill_date
     where b.bill_date between p_from and p_to and b.status <> 'cancelled' and (p_client is null or b.client_id = p_client)
       and case p_level when 'org' then true when 'zone' then bz.zone_id = p_zone
                        when 'branch' then b.branch_id = p_branch else b.person_id = any(v_people) end;
  end if;
  return v;
end $$;

-- Target vs actual (SOW 8.5). Achievement N/A when target is 0 / missing. Projection is labelled.
create or replace function public.target_progress(p_month date, p_level text default 'person',
    p_zone_id uuid default null, p_branch_id uuid default null, p_person_id uuid default null)
returns table(target_id uuid, metric text, client_id uuid, target numeric, actual numeric, achievement_pct numeric,
              remaining numeric, required_daily_run_rate numeric, projected_month_end numeric,
              working_days_total int, working_days_elapsed int, locked boolean)
language plpgsql stable security definer set search_path = public, app, pg_temp as $$
declare
  v_month date := date_trunc('month', p_month)::date;
  v_end date := (v_month + interval '1 month - 1 day')::date;
  v_today date := app.today();
  v_upto date; v_total int; v_elapsed int; v_left int;
  v_person uuid := case when p_level = 'person' then coalesce(p_person_id, app.me()) end;
begin
  if p_level = 'person' and not app.can_view_person(v_person, least(v_today, v_end), 'operations')
     and not app.can_view_person(v_person, least(v_today, v_end), 'collections') then
    raise exception 'Not permitted.' using errcode = '42501';
  end if;
  if p_level <> 'person' and not (app.is_admin() or app.has_role('auditor') or app.has_role('ops_head')
       or app.has_role('collections_head') or app.has_role('zm') or app.has_role('bm') or app.has_role('ba')) then
    raise exception 'Not permitted.' using errcode = '42501';
  end if;
  v_upto := least(v_today, v_end);
  v_total := app.working_days_between(v_month, v_end);
  v_elapsed := case when v_today < v_month then 0 else app.working_days_between(v_month, v_upto) end;
  v_left := greatest(v_total - v_elapsed + case when app.window_state(v_upto) = 'open' and app.is_working_day(v_upto) then 1 else 0 end, 0);
  return query
  select t.id, t.metric, t.client_id, t.amount, a.actual,
         case when t.amount > 0 then round(a.actual / t.amount * 100, 1) end,
         greatest(t.amount - a.actual, 0),
         case when v_left > 0 then round(greatest(t.amount - a.actual, 0) / v_left, 2) end,
         case when v_elapsed > 0 then round(a.actual / v_elapsed * v_total, 2) end,
         v_total, v_elapsed, app.clock() >= app.target_lock_at(v_month)
    from public.target_allocations t
    cross join lateral (select app.metric_actual(t.metric, v_month, v_upto, t.level, t.zone_id, t.branch_id,
                                                 t.person_id, t.client_id) as actual) a
   where t.is_current and t.month = v_month and t.level = p_level
     and t.zone_id is not distinct from case when p_level = 'zone' then p_zone_id else t.zone_id end
     and t.branch_id is not distinct from case when p_level = 'branch' then p_branch_id else t.branch_id end
     and (p_level <> 'person' or t.person_id = v_person)
   order by t.metric, t.client_id nulls first;
end $$;

-- Parent vs children allocation check (SOW 8.4).
create or replace view public.v_target_allocation_check with (security_invoker = true) as
select p.id as parent_id, p.month, p.metric, p.level, p.zone_id, p.branch_id, p.amount as parent_amount,
       coalesce(sum(c.amount), 0) as allocated,
       p.amount - coalesce(sum(c.amount), 0) as unallocated
  from public.target_allocations p
  left join public.target_allocations c on c.is_current and c.month = p.month and c.metric = p.metric
       and ((p.level = 'org' and c.level = 'zone')
         or (p.level = 'zone' and c.level = 'branch'
             and exists (select 1 from public.branch_zones bz where bz.branch_id = c.branch_id
                            and bz.zone_id = p.zone_id and bz.valid @> p.month)))
 where p.is_current and p.level in ('org','zone')
 group by p.id;

-- ------------------------------------------------------------ penalty ledger (D-11)
create table public.penalty_rules (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  description text not null,
  trigger_description text not null,
  amount numeric(12,2) check (amount >= 0),
  financial_enabled boolean not null default false,
  active boolean not null default false,
  hr_legal_approval_ref text,
  created_at timestamptz not null default now(),
  check (not financial_enabled or hr_legal_approval_ref is not null)
);

create table public.penalty_ledger (
  id uuid primary key default gen_random_uuid(),
  person_id uuid not null references public.persons(id),
  rule_id uuid not null references public.penalty_rules(id),
  event_date date not null,
  reason text not null,
  amount numeric(12,2),
  status text not null default 'proposed'
    check (status in ('proposed','approved','waived','reversed','disputed','dispute_upheld','dispute_rejected')),
  marked_by uuid not null references public.persons(id),
  decided_by uuid references public.persons(id),
  decided_at timestamptz,
  decision_reason text,
  acknowledged_at timestamptz,
  appeal_text text,
  appealed_at timestamptz,
  payroll_effect boolean not null default false check (payroll_effect = false),  -- no payroll effect until policy approved
  created_at timestamptz not null default now(),
  unique (person_id, rule_id, event_date)
);

create or replace function public.propose_penalty(p_person uuid, p_rule_code text, p_event_date date, p_reason text)
returns public.penalty_ledger
language plpgsql security definer set search_path = public, app, pg_temp as $$
declare v_rule public.penalty_rules; v_row public.penalty_ledger;
begin
  if app.me() is null then raise exception 'Not signed in' using errcode = '28000'; end if;
  if not (app.is_admin() or app.is_direct_report(p_person, 'operations', p_event_date)
          or app.is_direct_report(p_person, 'collections', p_event_date)) then
    raise exception 'You can only mark penalties for your direct reports.' using errcode = '42501';
  end if;
  if coalesce(trim(p_reason),'') = '' then raise exception 'A reason is required.' using errcode = 'P0001'; end if;
  select * into v_rule from public.penalty_rules where code = p_rule_code and active;
  if v_rule.id is null then raise exception 'Penalty rule % is not active.', p_rule_code using errcode = 'P0001'; end if;
  perform set_config('app.reason', p_reason, true);
  insert into public.penalty_ledger(person_id, rule_id, event_date, reason, amount, marked_by)
  values (p_person, v_rule.id, p_event_date, p_reason, v_rule.amount, app.me())
  on conflict (person_id, rule_id, event_date) do nothing
  returning * into v_row;
  if v_row.id is null then raise exception 'A penalty for this rule and date already exists.' using errcode = '23505'; end if;
  return v_row;
end $$;

create or replace function public.decide_penalty(p_id uuid, p_status text, p_reason text)
returns public.penalty_ledger
language plpgsql security definer set search_path = public, app, pg_temp as $$
declare v_row public.penalty_ledger;
begin
  if not (app.is_admin() or app.has_role('hr_admin')) then
    raise exception 'Only Admin or HR can decide penalties.' using errcode = '42501';
  end if;
  if p_status not in ('approved','waived','reversed','dispute_upheld','dispute_rejected') then
    raise exception 'Invalid decision.' using errcode = '22023';
  end if;
  if coalesce(trim(p_reason),'') = '' then raise exception 'A reason is required.' using errcode = 'P0001'; end if;
  perform set_config('app.reason', p_reason, true);
  update public.penalty_ledger set status = p_status, decided_by = app.me(), decided_at = app.clock(),
         decision_reason = p_reason where id = p_id returning * into v_row;
  return v_row;
end $$;

create or replace function public.respond_penalty(p_id uuid, p_acknowledge boolean, p_appeal_text text default null)
returns public.penalty_ledger
language plpgsql security definer set search_path = public, app, pg_temp as $$
declare v_row public.penalty_ledger;
begin
  update public.penalty_ledger
     set acknowledged_at = case when p_acknowledge then app.clock() else acknowledged_at end,
         appeal_text = coalesce(nullif(p_appeal_text,''), appeal_text),
         appealed_at = case when nullif(p_appeal_text,'') is not null then app.clock() else appealed_at end,
         status = case when nullif(p_appeal_text,'') is not null then 'disputed' else status end
   where id = p_id and person_id = app.me()
  returning * into v_row;
  if v_row.id is null then raise exception 'Not found.' using errcode = '42501'; end if;
  return v_row;
end $$;

-- ------------------------------------------------------------ in-app notifications
create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  person_id uuid not null references public.persons(id),
  kind text not null,
  message text not null,
  link text,
  created_at timestamptz not null default now(),
  read_at timestamptz
);
create index on public.notifications (person_id, created_at desc);

create or replace function app.notify_on_behalf() returns trigger
language plpgsql security definer set search_path = public, app, pg_temp as $$
begin
  if new.status = 'manager_entered' and (tg_op = 'INSERT' or old.status is distinct from new.status) then
    insert into public.notifications(person_id, kind, message, link)
    values (new.person_id, 'manager_entry',
            'Your manager entered your ' || new.function || ' figures for ' || to_char(new.work_date,'DD Mon') ||
            '. Reason: ' || coalesce(new.reason,''), '/productivity?date=' || new.work_date);
  elsif new.status in ('absent','non_operational','exception','on_leave')
        and (tg_op = 'INSERT' or old.status is distinct from new.status) then
    insert into public.notifications(person_id, kind, message, link)
    values (new.person_id, 'status_set', 'You were marked ' || replace(new.status,'_',' ') || ' for ' ||
            to_char(new.work_date,'DD Mon') || '. Reason: ' || new.reason, '/productivity?date=' || new.work_date);
  end if;
  return new;
end $$;
create trigger trg_notify_day_status after insert or update on public.day_status
  for each row execute function app.notify_on_behalf();

create or replace function app.notify_penalty() returns trigger
language plpgsql security definer set search_path = public, app, pg_temp as $$
begin
  insert into public.notifications(person_id, kind, message, link)
  values (new.person_id, 'penalty', 'Penalty record ' || new.status || ' for ' || to_char(new.event_date,'DD Mon') ||
          ': ' || new.reason, '/penalties');
  return new;
end $$;
create trigger trg_notify_penalty after insert or update of status on public.penalty_ledger
  for each row execute function app.notify_penalty();

create or replace function public.mark_notifications_read(p_ids uuid[] default null) returns int
language sql security definer set search_path = public, app, pg_temp as $$
  with u as (update public.notifications set read_at = now()
              where person_id = app.me() and read_at is null and (p_ids is null or id = any(p_ids)) returning 1)
  select count(*)::int from u
$$;
