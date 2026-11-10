-- D-91 Daily updates as client tiles. One tile per branch × client the person or their team works on (or heads for
-- collections): own figures today + month to date, the team's roll-up today (received, entry, closed, cancelled,
-- rollover, net pending, pending by age, revenue), collections for that branch × client, and who in the team has / has
-- not reported. A manager validates a client when everyone on it has reported (or is marked absent / on leave); when
-- every client is validated the day is certified as before. Managers can remind or mark absent anyone below them.
-- Scope = the person + everyone below them in the operations line; nothing outside that scope is returned (D-52).

create table if not exists public.client_validations (
  manager_id uuid not null references public.persons(id), work_date date not null,
  branch_id uuid not null references public.branches(id), client_id uuid not null references public.clients(id),
  ops jsonb, coll jsonb, note text, validated_at timestamptz not null default now(),
  primary key (manager_id, work_date, branch_id, client_id)
);
alter table public.client_validations enable row level security;
drop policy if exists read_client_validations on public.client_validations;
create policy read_client_validations on public.client_validations for select to authenticated
  using (manager_id = (select app.me()) or (select app.is_admin()) or manager_id = any ((select app.my_people('operations'))::uuid[]));
revoke all on public.client_validations from anon, authenticated;
grant select on public.client_validations to authenticated;
create index if not exists client_validations_date on public.client_validations(work_date);

create or replace function app.line_revenue(p_cl uuid, p_date date, p_entry int, p_closure int, p_cancelled int) returns numeric
language sql stable security definer set search_path = public, app, pg_temp as $$
  select coalesce((select rc.rate * case rc.billable_event when 'closure' then coalesce(p_closure, 0)
                                                          when 'entry' then coalesce(p_entry, 0) - coalesce(p_cancelled, 0)
                                                          else coalesce(p_entry, 0) + coalesce(p_closure, 0) - coalesce(p_cancelled, 0) end
                     from public.client_locations cl join public.rate_cards rc on rc.client_id = cl.client_id and rc.location_id = cl.location_id
                                                         and rc.process_id = cl.process_id and rc.valid @> p_date
                    where cl.id = p_cl limit 1), 0)
$$;

create or replace function public.daily_board(p_date date default null) returns jsonb
language plpgsql stable security definer set search_path = public, app, pg_temp as $$
declare v_me uuid := app.me(); v_d date := coalesce(p_date, app.today()); v_m date; v jsonb;
begin
  if v_me is null then raise exception 'Not signed in' using errcode = '28000'; end if;
  v_m := date_trunc('month', v_d)::date;
  with recursive tr(pid, path) as (
    select r.person_id, array[r.person_id] from public.reporting_lines r
     where r.manager_id = v_me and r.function = 'operations' and r.valid @> v_d
    union all
    select r.person_id, tr.path || r.person_id from public.reporting_lines r join tr on r.manager_id = tr.pid
     where r.function = 'operations' and r.valid @> v_d and not r.person_id = any(tr.path) and array_length(tr.path, 1) < 12),
  tree as (select distinct on (pid) pid, path from tr order by pid, array_length(path, 1)),
  ppl as (select pid, path from tree union all select v_me, '{}'::uuid[]),
  alloc as (select a.person_id, cl.id cl_id, cl.branch_id, cl.client_id
              from public.allocations a join public.client_locations cl on cl.id = a.client_location_id
             where a.function = 'operations' and a.valid @> v_d and a.person_id in (select pid from ppl)),
  lines as (select l.person_id, l.client_location_id cl_id, cl.branch_id, cl.client_id, l.work_date, l.entry, coalesce(l.logged, 0) logged, l.closure, l.cancelled,
                   l.tat_0_1, l.tat_1_2, l.tat_2_4, l.tat_4_7, l.tat_7_15, l.tat_15p,
                   app.line_revenue(l.client_location_id, l.work_date, l.entry, l.closure, l.cancelled) rev
              from public.productivity_lines l join public.client_locations cl on cl.id = l.client_location_id
             where l.person_id in (select pid from ppl) and l.work_date between v_m and v_d),
  cpairs as (select * from app.collection_pairs(v_me, v_d)),
  pairs as (select distinct branch_id, client_id from alloc
            union select branch_id, client_id from lines where work_date = v_d
            union select branch_id, client_id from cpairs),
  mem as (select distinct x.person_id, x.branch_id, x.client_id from (
            select person_id, branch_id, client_id from alloc
            union select person_id, branch_id, client_id from lines where work_date = v_d) x),
  roll as (select a.person_id, a.branch_id, a.client_id, sum(coalesce(app.prev_pending(a.person_id, a.cl_id, v_d), 0)) rollover
             from alloc a group by 1, 2, 3),
  st as (select m.person_id, m.branch_id, m.client_id,
                coalesce(ds.status, case when app.is_away(m.person_id, v_d, 'operations') then 'on_leave' else 'pending' end) status
           from mem m left join public.day_status ds on ds.person_id = m.person_id and ds.work_date = v_d and ds.function = 'operations'),
  pm as (select m.person_id, m.branch_id, m.client_id, s.status,
                s.status in ('submitted','manager_entered','absent','on_leave','non_operational','exception') resolved,
                coalesce(r.rollover, 0) rollover,
                coalesce(sum(l.entry) filter (where l.work_date = v_d), 0) recv, coalesce(sum(l.logged) filter (where l.work_date = v_d), 0) logged,
                coalesce(sum(l.closure) filter (where l.work_date = v_d), 0) closed, coalesce(sum(l.cancelled) filter (where l.work_date = v_d), 0) cancelled,
                coalesce(sum(l.rev) filter (where l.work_date = v_d), 0) rev,
                coalesce(sum(l.entry), 0) mtd_recv, coalesce(sum(l.closure), 0) mtd_closed, coalesce(sum(l.cancelled), 0) mtd_cancelled, coalesce(sum(l.rev), 0) mtd_rev,
                array[coalesce(sum(l.tat_0_1) filter (where l.work_date = v_d), 0), coalesce(sum(l.tat_1_2) filter (where l.work_date = v_d), 0),
                      coalesce(sum(l.tat_2_4) filter (where l.work_date = v_d), 0), coalesce(sum(l.tat_4_7) filter (where l.work_date = v_d), 0),
                      coalesce(sum(l.tat_7_15) filter (where l.work_date = v_d), 0), coalesce(sum(l.tat_15p) filter (where l.work_date = v_d), 0)] tat,
                bool_or(l.work_date = v_d and l.tat_0_1 is not null) has_tat
           from mem m join st s using (person_id, branch_id, client_id)
           left join roll r using (person_id, branch_id, client_id)
           left join lines l using (person_id, branch_id, client_id)
          group by m.person_id, m.branch_id, m.client_id, s.status, r.rollover),
  cd as (select x.branch_id, x.client_id,
                sum(coalesce(x.rcv_lt30,0)+coalesce(x.rcv_30_90,0)+coalesce(x.rcv_90_180,0)+coalesce(x.rcv_gt180,0)) filter (where x.entry_date = v_d) rcv_today,
                sum(coalesce(x.rec_lt30,0)+coalesce(x.rec_30_90,0)+coalesce(x.rec_90_180,0)+coalesce(x.rec_gt180,0)) filter (where x.entry_date = v_d) rec_today,
                sum(x.bill_count) filter (where x.entry_date = v_d) bills_today, sum(x.bill_amount) filter (where x.entry_date = v_d) billed_today,
                sum(coalesce(x.rcv_lt30,0)+coalesce(x.rcv_30_90,0)+coalesce(x.rcv_90_180,0)+coalesce(x.rcv_gt180,0)) rcv_mtd,
                sum(coalesce(x.bill_amount,0)) billed_mtd, bool_or(x.entry_date = v_d) entered_today
           from public.collection_daily x join pairs p on p.branch_id = x.branch_id and p.client_id = x.client_id
          where x.entry_date between v_m and v_d group by 1, 2),
  lt as (select * from app.loc_targets(v_m, 'collections_received')),
  tiles as (
    select p.branch_id, p.client_id, b.name branch, c.name client,
           exists (select 1 from alloc a where a.person_id = v_me and a.branch_id = p.branch_id and a.client_id = p.client_id) mine,
           (select jsonb_build_object('recv', x.recv, 'logged', x.logged, 'closed', x.closed, 'cancelled', x.cancelled, 'rollover', x.rollover,
                                      'pending', x.rollover + x.recv - x.closed - x.cancelled, 'rev', x.rev, 'status', x.status,
                                      'mtd_recv', x.mtd_recv, 'mtd_closed', x.mtd_closed, 'mtd_cancelled', x.mtd_cancelled, 'mtd_rev', x.mtd_rev)
              from pm x where x.person_id = v_me and x.branch_id = p.branch_id and x.client_id = p.client_id) self,
           (select jsonb_build_object('people', count(*), 'reported', count(*) filter (where x.resolved),
                                      'recv', sum(x.recv), 'logged', sum(x.logged), 'closed', sum(x.closed), 'cancelled', sum(x.cancelled),
                                      'rollover', sum(x.rollover), 'pending', sum(x.rollover + x.recv - x.closed - x.cancelled), 'rev', sum(x.rev),
                                      'mtd_recv', sum(x.mtd_recv), 'mtd_closed', sum(x.mtd_closed), 'mtd_cancelled', sum(x.mtd_cancelled), 'mtd_rev', sum(x.mtd_rev),
                                      'tat', jsonb_build_array(sum(x.tat[1]), sum(x.tat[2]), sum(x.tat[3]), sum(x.tat[4]), sum(x.tat[5]), sum(x.tat[6])))
              from pm x where x.branch_id = p.branch_id and x.client_id = p.client_id) team,
           (select coalesce(jsonb_agg(jsonb_build_object('person_id', x.person_id, 'status', x.status, 'resolved', x.resolved,
                      'recv', x.recv, 'logged', x.logged, 'closed', x.closed, 'cancelled', x.cancelled, 'rollover', x.rollover,
                      'pending', x.rollover + x.recv - x.closed - x.cancelled, 'rev', x.rev, 'tat', to_jsonb(x.tat), 'has_tat', coalesce(x.has_tat, false),
                      'mtd_recv', x.mtd_recv, 'mtd_closed', x.mtd_closed, 'mtd_cancelled', x.mtd_cancelled, 'mtd_rev', x.mtd_rev)), '[]')
              from pm x where x.branch_id = p.branch_id and x.client_id = p.client_id) members,
           jsonb_build_object('is_head', coalesce((select k.is_head from cpairs k where k.branch_id = p.branch_id and k.client_id = p.client_id), false),
                              'entered_today', coalesce(cd.entered_today, false), 'received_today', coalesce(cd.rcv_today, 0), 'reconciled_today', coalesce(cd.rec_today, 0),
                              'bills_today', coalesce(cd.bills_today, 0), 'billed_today', coalesce(cd.billed_today, 0), 'collected_mtd', coalesce(cd.rcv_mtd, 0),
                              'target', (select lt.amount from lt where lt.branch_id = p.branch_id and lt.client_id = p.client_id),
                              'receivables', (select coalesce(a.ar_lt30,0)+coalesce(a.ar_30_90,0)+coalesce(a.ar_90_180,0)+coalesce(a.ar_gt180,0)
                                                from public.collection_ar a where a.month = v_m and a.branch_id = p.branch_id and a.client_id = p.client_id),
                              'billed_mtd', coalesce(cd.billed_mtd, 0)) coll,
           (select cv.validated_at from public.client_validations cv where cv.manager_id = v_me and cv.work_date = v_d
               and cv.branch_id = p.branch_id and cv.client_id = p.client_id) validated_at
      from pairs p join public.branches b on b.id = p.branch_id join public.clients c on c.id = p.client_id
      left join cd on cd.branch_id = p.branch_id and cd.client_id = p.client_id)
  select jsonb_build_object(
    'date', v_d, 'window', app.window_state(v_d), 'is_working_day', app.is_working_day(v_d),
    'manager', exists (select 1 from tree),
    'certified', exists (select 1 from public.certifications c where c.manager_id = v_me and c.work_date = v_d and c.function = 'operations'),
    'people', (select coalesce(jsonb_object_agg(pp.pid, jsonb_build_object('name', p.full_name, 'designation', p.designation, 'path', to_jsonb(pp.path),
                 'direct', array_length(pp.path, 1) = 1)), '{}') from ppl pp join public.persons p on p.id = pp.pid),
    'tiles', (select coalesce(jsonb_agg(to_jsonb(t) order by t.mine desc, t.client, t.branch), '[]') from tiles t))
  into v;
  return v;
end $$;

-- validate one client for the day: everyone on it (the manager + team) must have reported or be marked away
create or replace function public.validate_client(p_date date, p_branch uuid, p_client uuid, p_note text default null) returns jsonb
language plpgsql security definer set search_path = public, app, pg_temp as $$
declare v_me uuid := app.me(); b jsonb; t jsonb; v_wait text; v_left int; v_cert boolean := false;
begin
  if v_me is null then raise exception 'Not signed in' using errcode = '28000'; end if;
  if not app.has_reports(v_me, 'operations', p_date) then raise exception 'Only a manager validates team figures.' using errcode = '42501'; end if;
  if app.window_state(p_date) = 'future' then raise exception 'You cannot validate a future date.' using errcode = 'P0001'; end if;
  b := public.daily_board(p_date);
  select x into t from jsonb_array_elements(b->'tiles') x where x->>'branch_id' = p_branch::text and x->>'client_id' = p_client::text;
  if t is null then raise exception 'This client is not in your team''s work.' using errcode = '42501'; end if;
  select string_agg(b->'people'->(m->>'person_id')->>'name', ', ') into v_wait
    from jsonb_array_elements(t->'members') m where not (m->>'resolved')::boolean;
  if v_wait is not null then raise exception 'Cannot validate yet. Not reported: %', v_wait using errcode = 'P0001'; end if;
  perform set_config('app.reason', coalesce(nullif(btrim(coalesce(p_note, '')), ''), 'client validated'), true);
  insert into public.client_validations(manager_id, work_date, branch_id, client_id, ops, coll, note)
  values (v_me, p_date, p_branch, p_client, t->'team', t->'coll', nullif(btrim(coalesce(p_note, '')), ''))
  on conflict (manager_id, work_date, branch_id, client_id) do update set ops = excluded.ops, coll = excluded.coll, note = excluded.note, validated_at = now();
  -- every client with team members validated → certify the day (the usual checks apply; if they fail, the day stays open)
  select count(*) into v_left from jsonb_array_elements(b->'tiles') x
   where jsonb_array_length(x->'members') > 0 and (x->>'branch_id', x->>'client_id') <> (p_branch::text, p_client::text)
     and not exists (select 1 from public.client_validations cv where cv.manager_id = v_me and cv.work_date = p_date
                      and cv.branch_id = (x->>'branch_id')::uuid and cv.client_id = (x->>'client_id')::uuid);
  if v_left = 0 and not exists (select 1 from public.certifications c where c.manager_id = v_me and c.work_date = p_date and c.function = 'operations') then
    begin
      perform public.certify_team(p_date, 'operations', null, null);
      v_cert := true;
    exception when others then v_cert := false;
    end;
  end if;
  return jsonb_build_object('validated', true, 'clients_left', v_left, 'day_certified', v_cert);
end $$;

-- remind people below me to report (at most once every 30 minutes per person)
create or replace function public.nudge_people(p_people uuid[], p_date date) returns int
language plpgsql security definer set search_path = public, app, pg_temp as $$
declare v_me uuid := app.me(); n int; v_bad text;
begin
  if v_me is null then raise exception 'Not signed in' using errcode = '28000'; end if;
  select string_agg(x::text, ', ') into v_bad from unnest(p_people) x where x not in (select s.person_id from app.subtree(v_me, 'operations', p_date) s);
  if v_bad is not null then raise exception 'You can remind only people in your team.' using errcode = '42501'; end if;
  insert into public.notifications(person_id, kind, message, link)
  select x, 'nudge', (select full_name from public.persons where id = v_me) || ' reminds you to enter and submit your figures for ' || to_char(p_date, 'DD Mon') || '.',
         '/productivity?date=' || p_date
    from unnest(p_people) x
   where not exists (select 1 from public.notifications n2 where n2.person_id = x and n2.kind = 'nudge' and n2.link = '/productivity?date=' || p_date
                      and n2.created_at > now() - interval '30 minutes');
  get diagnostics n = row_count;
  return n;
end $$;

-- mark someone below me absent for the day (direct or indirect); their own manager is told
create or replace function public.team_mark_absent(p_person uuid, p_date date, p_reason text) returns void
language plpgsql security definer set search_path = public, app, pg_temp as $$
declare v_me uuid := app.me(); v_ds public.day_status; v_mgr uuid;
begin
  if v_me is null then raise exception 'Not signed in' using errcode = '28000'; end if;
  if not exists (select 1 from app.subtree(v_me, 'operations', p_date) s where s.person_id = p_person) then
    raise exception 'You can mark only people in your team.' using errcode = '42501'; end if;
  if coalesce(btrim(p_reason), '') = '' then raise exception 'A reason is required.' using errcode = 'P0001'; end if;
  if app.window_state(p_date) = 'future' then raise exception 'You cannot mark a future date.' using errcode = 'P0001'; end if;
  if not app.can_write_day(p_person, p_date, 'operations') then raise exception 'The day is closed. Ask Admin to reopen it.' using errcode = 'P0001'; end if;
  select * into v_ds from public.day_status where person_id = p_person and work_date = p_date and function = 'operations';
  if v_ds.status in ('submitted','manager_entered') and not app.active_reopen(p_person, p_date, 'operations') then
    raise exception 'This person has already submitted.' using errcode = 'P0001'; end if;
  perform set_config('app.reason', p_reason, true);
  insert into public.day_status as d (person_id, work_date, function, status, reason, set_by, submitted_at)
  values (p_person, p_date, 'operations', 'absent', btrim(p_reason), v_me, app.clock())
  on conflict (person_id, work_date, function) do update set status = 'absent', reason = excluded.reason, set_by = excluded.set_by,
         submitted_at = excluded.submitted_at, updated_at = now();
  select r.manager_id into v_mgr from public.reporting_lines r where r.person_id = p_person and r.function = 'operations' and r.valid @> p_date limit 1;
  if v_mgr is not null and v_mgr <> v_me then
    insert into public.notifications(person_id, kind, message, link)
    values (v_mgr, 'team', (select full_name from public.persons where id = v_me) || ' marked ' || (select full_name from public.persons where id = p_person)
            || ' absent for ' || to_char(p_date, 'DD Mon') || ': ' || btrim(p_reason), '/productivity?date=' || p_date);
  end if;
end $$;

revoke execute on function public.daily_board(date), public.validate_client(date, uuid, uuid, text), public.nudge_people(uuid[], date),
  public.team_mark_absent(uuid, date, text), app.line_revenue(uuid, date, int, int, int) from public, anon;
grant execute on function public.daily_board(date), public.validate_client(date, uuid, uuid, text), public.nudge_people(uuid[], date),
  public.team_mark_absent(uuid, date, text) to authenticated;
