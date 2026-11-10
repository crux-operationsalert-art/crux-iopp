-- D-97 Faster daily update: the pending-by-age split is carried forward from the person's last report (aged by the days
--      since), today's received added as new, closed + cancelled taken from the oldest first (web/src/lib/aging.ts). It is
--      filled in on the screen, marked "carried forward, edit if different", and stops updating once the person edits it.
-- D-98 Journey (gamification): on-time streak, best streak, points, level, badges and team standings. Positive only: the
--      standings list the top streaks in the person's own team (peers under the same manager, or a manager's direct team);
--      nobody is listed for missing. Points: on time 10 (+5 before 7 pm), late 4; profile complete 50 once.
-- D-99 Chat: direct, team and topic threads ("ask about this number"). You can message people in your reporting line
--      (above or below), peers under the same manager, and HR / Admin. Messages are readable by thread members only.
--      New messages notify the other members (at most once every 10 minutes per thread).

-- ------------------------------------------------------------------ D-97
create or replace function public.prev_buckets(p_date date) returns table(client_location_id uuid, work_date date, tat int[])
language sql stable security definer set search_path = public, app, pg_temp as $$
  select distinct on (l.client_location_id) l.client_location_id, l.work_date,
         array[l.tat_0_1, l.tat_1_2, l.tat_2_4, l.tat_4_7, l.tat_7_15, l.tat_15p]
    from public.productivity_lines l
   where l.person_id = app.me() and l.work_date < p_date and l.tat_0_1 is not null
   order by l.client_location_id, l.work_date desc
$$;

-- ------------------------------------------------------------------ D-98 journey
create or replace function app.day_result(p_person uuid, p_date date) returns text
language plpgsql stable security definer set search_path = public, app, pg_temp as $$
declare ds public.day_status;
begin
  if not app.is_working_day(p_date) then return 'skip'; end if;
  select * into ds from public.day_status d where d.person_id = p_person and d.work_date = p_date and d.function = 'operations';
  if ds.status = 'submitted' then return case when ds.late then 'late' else 'ontime' end; end if;
  if ds.status = 'manager_entered' then return 'manager'; end if;
  if ds.status in ('on_leave', 'absent', 'non_operational', 'exception') then return 'skip'; end if;
  if exists (select 1 from public.attendance a where a.person_id = p_person and a.work_date = p_date and a.status in ('planned_leave', 'unplanned_leave', 'holiday', 'weekly_off')) then return 'skip'; end if;
  if not exists (select 1 from public.allocations a where a.person_id = p_person and a.function = 'operations' and a.valid @> p_date) then return 'skip'; end if;
  if app.window_state(p_date) in ('open', 'grace', 'future') then return 'open'; end if;
  return 'miss';
end $$;

create or replace function app.journey_days(p_person uuid, p_days int default 90)
returns table(d date, result text, early boolean)
language sql stable security definer set search_path = public, app, pg_temp as $$
  select g::date, app.day_result(p_person, g::date),
         coalesce((select (s.submitted_at at time zone app.tz())::time < time '19:00' from public.day_status s
                    where s.person_id = p_person and s.work_date = g::date and s.function = 'operations' and s.status = 'submitted' and not s.late), false)
    from generate_series(app.today(), app.today() - p_days, interval '-1 day') g
$$;

create or replace function app.journey(p_person uuid) returns jsonb
language plpgsql stable security definer set search_path = public, app, pg_temp as $$
declare r record; v_streak int := 0; v_counting boolean := true; v_best int := 0; v_run int := 0; v_pts int := 0; v_month_pts int := 0;
        v_m date := date_trunc('month', app.today())::date; v_ontime int := 0; v_early int := 0; v_reports int := 0; v_month_days int := 0; v_month_ontime int := 0;
        v_profile boolean; v_level text; v_next int; v_floor int; v_clean boolean; v_today text;
begin
  for r in select * from app.journey_days(p_person, 120) loop       -- newest first
    if r.d = app.today() then v_today := r.result; end if;
    if r.result = 'skip' or (r.result = 'open' and r.d = app.today()) then continue; end if;
    if v_counting then if r.result = 'ontime' then v_streak := v_streak + 1; else v_counting := false; end if; end if;
    if r.result in ('ontime', 'late', 'manager') then v_reports := v_reports + 1; end if;
    if r.result = 'ontime' then v_ontime := v_ontime + 1; v_pts := v_pts + 10 + case when r.early then 5 else 0 end; if r.early then v_early := v_early + 1; end if;
    elsif r.result = 'late' then v_pts := v_pts + 4; end if;
    if r.d >= v_m then
      v_month_days := v_month_days + 1;
      if r.result = 'ontime' then v_month_ontime := v_month_ontime + 1; v_month_pts := v_month_pts + 10 + case when r.early then 5 else 0 end;
      elsif r.result = 'late' then v_month_pts := v_month_pts + 4; end if;
    end if;
  end loop;
  for r in select * from app.journey_days(p_person, 120) order by d loop      -- oldest first: best run
    if r.result = 'skip' or r.result = 'open' then continue; end if;
    if r.result = 'ontime' then v_run := v_run + 1; v_best := greatest(v_best, v_run); else v_run := 0; end if;
  end loop;
  v_profile := coalesce((select completed_at is not null from public.hr_profiles where person_id = p_person), false);
  if v_profile then v_pts := v_pts + 50; end if;
  v_clean := exists (select 1 from public.productivity_lines l where l.person_id = p_person and l.tat_0_1 is not null)
         and not exists (select 1 from (select distinct on (l.client_location_id) l.tat_15p from public.productivity_lines l
                                          where l.person_id = p_person and l.tat_0_1 is not null order by l.client_location_id, l.work_date desc) x where coalesce(x.tat_15p, 0) > 0);
  select lvl, nxt, flr into v_level, v_next, v_floor from (values ('Bronze', 0, 150), ('Silver', 150, 400), ('Gold', 400, 800), ('Platinum', 800, null)) t(lvl, flr, nxt)
   where v_pts >= flr order by flr desc limit 1;
  return jsonb_build_object(
    'reports', app.reports_figures(p_person) and exists (select 1 from public.allocations a where a.person_id = p_person and a.function = 'operations' and a.valid @> app.today()),
    'today', v_today, 'streak', v_streak, 'best_streak', greatest(v_best, v_streak), 'points', v_pts, 'month_points', v_month_pts,
    'month_ontime', v_month_ontime, 'month_days', v_month_days, 'level', v_level, 'level_floor', v_floor, 'next_level_at', v_next,
    'badges', jsonb_build_array(
      jsonb_build_object('key', 'first', 'name', 'First report', 'got', v_reports > 0, 'how', 'Send your first daily update'),
      jsonb_build_object('key', 'streak5', 'name', 'Five in a row', 'got', greatest(v_best, v_streak) >= 5, 'how', 'Report on time 5 working days in a row'),
      jsonb_build_object('key', 'streak10', 'name', 'Ten in a row', 'got', greatest(v_best, v_streak) >= 10, 'how', 'Report on time 10 working days in a row'),
      jsonb_build_object('key', 'streak20', 'name', 'Twenty in a row', 'got', greatest(v_best, v_streak) >= 20, 'how', 'Report on time 20 working days in a row'),
      jsonb_build_object('key', 'early', 'name', 'Early finisher', 'got', v_early >= 5, 'how', 'Send your update before 7 pm on 5 days'),
      jsonb_build_object('key', 'profile', 'name', 'Profile complete', 'got', v_profile, 'how', 'Complete your profile'),
      jsonb_build_object('key', 'clean', 'name', 'Nothing over 15 days', 'got', v_clean, 'how', 'No case pending more than 15 days')));
end $$;

create or replace function public.my_journey() returns jsonb
language plpgsql stable security definer set search_path = public, app, pg_temp as $$
declare v_me uuid := app.me(); v_mgr uuid; v_team uuid[]; v_board jsonb; v_rep int; v_tot int;
begin
  if v_me is null then raise exception 'Not signed in' using errcode = '28000'; end if;
  -- the team for standings: a manager's direct team (with the manager), otherwise peers under the same manager
  if app.has_reports(v_me, 'operations', app.today()) then
    select array_agg(r.person_id) || v_me into v_team from public.reporting_lines r where r.manager_id = v_me and r.function = 'operations' and r.valid @> app.today();
  else
    select r.manager_id into v_mgr from public.reporting_lines r where r.person_id = v_me and r.function = 'operations' and r.valid @> app.today() limit 1;
    select array_agg(r.person_id) into v_team from public.reporting_lines r where r.manager_id = v_mgr and r.function = 'operations' and r.valid @> app.today();
  end if;
  v_team := coalesce(v_team, array[v_me]);
  with j as (select p.id, p.full_name, app.journey(p.id) j from public.persons p where p.id = any(v_team) and p.status = 'active'),
  rk as (select id, full_name, (j->>'streak')::int streak, (j->>'month_points')::int pts, (j->>'reports')::boolean reports, j->>'today' today from j)
  select jsonb_build_object(
           'top', (select coalesce(jsonb_agg(jsonb_build_object('name', case when id = v_me then 'You' else full_name end, 'streak', streak, 'points', pts, 'me', id = v_me)
                                            order by streak desc, pts desc), '[]')
                     from (select * from rk where reports and streak > 0 order by streak desc, pts desc limit 5) t),
           'reported_today', (select count(*) from rk where reports and today in ('ontime', 'late', 'manager')),
           'reporting', (select count(*) from rk where reports))
    into v_board from rk limit 1;
  return app.journey(v_me) || jsonb_build_object('team', coalesce(v_board, '{}'::jsonb));
end $$;

-- ------------------------------------------------------------------ D-99 chat
create table if not exists public.chat_threads (
  id uuid primary key default gen_random_uuid(), kind text not null check (kind in ('direct', 'team', 'topic')),
  title text, ref jsonb, team_owner uuid unique references public.persons(id), created_by uuid references public.persons(id),
  created_at timestamptz not null default now(), last_message_at timestamptz
);
create table if not exists public.chat_members (
  thread_id uuid not null references public.chat_threads(id) on delete cascade, person_id uuid not null references public.persons(id),
  last_read_at timestamptz, joined_at timestamptz not null default now(), primary key (thread_id, person_id)
);
create index if not exists chat_members_person on public.chat_members(person_id);
create table if not exists public.chat_messages (
  id bigserial primary key, thread_id uuid not null references public.chat_threads(id) on delete cascade, sender_id uuid not null references public.persons(id),
  body text not null check (length(btrim(body)) between 1 and 2000), ref jsonb, created_at timestamptz not null default now()
);
create index if not exists chat_messages_thread on public.chat_messages(thread_id, id desc);
alter table public.chat_threads enable row level security; alter table public.chat_members enable row level security; alter table public.chat_messages enable row level security;
revoke all on public.chat_threads, public.chat_members, public.chat_messages from anon, authenticated;     -- through the functions below only

create or replace function app.can_chat(a uuid, b uuid) returns boolean
language sql stable security definer set search_path = public, app, pg_temp as $$
  select a is not null and b is not null and a <> b
     and exists (select 1 from public.persons p where p.id = b and p.status = 'active')
     and ( exists (select 1 from public.role_assignments r where r.person_id in (a, b) and r.role in ('admin', 'hr_admin') and r.valid @> app.today())
        or exists (select 1 from app.subtree(a, 'operations', app.today()) s where s.person_id = b)
        or exists (select 1 from app.subtree(a, 'collections', app.today()) s where s.person_id = b)
        or exists (select 1 from app.subtree(b, 'operations', app.today()) s where s.person_id = a)
        or exists (select 1 from app.subtree(b, 'collections', app.today()) s where s.person_id = a)
        or exists (select 1 from public.reporting_lines r1 join public.reporting_lines r2 on r2.manager_id = r1.manager_id and r2.function = r1.function
                    where r1.person_id = a and r2.person_id = b and r1.valid @> app.today() and r2.valid @> app.today()))
$$;

create or replace function public.chat_contacts() returns table(person_id uuid, full_name text, designation text, relation text)
language sql stable security definer set search_path = public, app, pg_temp as $$
  with me as (select app.me() id)
  select p.id, p.full_name, p.designation,
         case when exists (select 1 from app.subtree(p.id, 'operations', app.today()) s where s.person_id = (select id from me))
                or exists (select 1 from app.subtree(p.id, 'collections', app.today()) s where s.person_id = (select id from me)) then 'above'
              when exists (select 1 from app.subtree((select id from me), 'operations', app.today()) s where s.person_id = p.id)
                or exists (select 1 from app.subtree((select id from me), 'collections', app.today()) s where s.person_id = p.id) then 'team'
              when exists (select 1 from public.role_assignments r where r.person_id = p.id and r.role in ('admin', 'hr_admin') and r.valid @> app.today()) then 'hr'
              else 'peer' end
    from public.persons p
   where p.status = 'active' and p.auth_user_id is not null and app.can_chat((select id from me), p.id)
   order by 4, 2
   limit 400
$$;

create or replace function app.chat_member(p_thread uuid) returns boolean
language sql stable security definer set search_path = public, app, pg_temp as $$
  select exists (select 1 from public.chat_members m where m.thread_id = p_thread and m.person_id = app.me())
$$;

create or replace function public.chat_direct(p_person uuid) returns uuid
language plpgsql security definer set search_path = public, app, pg_temp as $$
declare v_me uuid := app.me(); v_id uuid;
begin
  if not app.can_chat(v_me, p_person) then raise exception 'You can message people in your reporting line, your peers and HR.' using errcode = '42501'; end if;
  select t.id into v_id from public.chat_threads t
   where t.kind = 'direct' and exists (select 1 from public.chat_members m where m.thread_id = t.id and m.person_id = v_me)
     and exists (select 1 from public.chat_members m where m.thread_id = t.id and m.person_id = p_person) limit 1;
  if v_id is null then
    insert into public.chat_threads(kind, created_by) values ('direct', v_me) returning id into v_id;
    insert into public.chat_members(thread_id, person_id) values (v_id, v_me), (v_id, p_person);
  end if;
  return v_id;
end $$;

create or replace function public.chat_team() returns uuid
language plpgsql security definer set search_path = public, app, pg_temp as $$
declare v_me uuid := app.me(); v_id uuid;
begin
  if not app.has_reports(v_me, 'operations', app.today()) then raise exception 'Only a manager has a team chat.' using errcode = 'P0001'; end if;
  select id into v_id from public.chat_threads where team_owner = v_me;
  if v_id is null then
    insert into public.chat_threads(kind, title, team_owner, created_by) values ('team', 'My team', v_me, v_me) returning id into v_id;
    insert into public.chat_members(thread_id, person_id) values (v_id, v_me);
  end if;
  -- keep members in step with the direct team
  insert into public.chat_members(thread_id, person_id)
  select v_id, r.person_id from public.reporting_lines r join public.persons p on p.id = r.person_id and p.status = 'active'
   where r.manager_id = v_me and r.function = 'operations' and r.valid @> app.today() on conflict do nothing;
  delete from public.chat_members m where m.thread_id = v_id and m.person_id <> v_me
     and not exists (select 1 from public.reporting_lines r where r.manager_id = v_me and r.person_id = m.person_id and r.function = 'operations' and r.valid @> app.today());
  return v_id;
end $$;

create or replace function public.chat_topic(p_people uuid[], p_title text, p_ref jsonb default null) returns uuid
language plpgsql security definer set search_path = public, app, pg_temp as $$
declare v_me uuid := app.me(); v_id uuid; v_bad text;
begin
  if v_me is null then raise exception 'Not signed in' using errcode = '28000'; end if;
  if coalesce(array_length(p_people, 1), 0) = 0 then raise exception 'Choose who to ask.' using errcode = 'P0001'; end if;
  select string_agg(x::text, ',') into v_bad from unnest(p_people) x where x <> v_me and not app.can_chat(v_me, x);
  if v_bad is not null then raise exception 'You can message people in your reporting line, your peers and HR.' using errcode = '42501'; end if;
  -- reuse an open topic on the same subject with the same people
  select t.id into v_id from public.chat_threads t
   where t.kind = 'topic' and t.ref is not distinct from p_ref and p_ref is not null and t.created_at > now() - interval '7 days'
     and (select array_agg(m.person_id order by m.person_id) from public.chat_members m where m.thread_id = t.id)
       = (select array_agg(distinct x order by x) from unnest(p_people || v_me) x) limit 1;
  if v_id is null then
    insert into public.chat_threads(kind, title, ref, created_by) values ('topic', left(btrim(coalesce(p_title, 'Question')), 120), p_ref, v_me) returning id into v_id;
    insert into public.chat_members(thread_id, person_id) select distinct v_id, x from unnest(p_people || v_me) x;
  end if;
  return v_id;
end $$;

create or replace function public.chat_threads() returns table(id uuid, kind text, title text, ref jsonb, members int, last_body text, last_sender text,
  last_at timestamptz, unread int)
language sql stable security definer set search_path = public, app, pg_temp as $$
  select t.id, t.kind,
         case when t.kind = 'direct' then (select p.full_name from public.chat_members m join public.persons p on p.id = m.person_id where m.thread_id = t.id and m.person_id <> app.me() limit 1)
              else t.title end,
         t.ref, (select count(*)::int from public.chat_members m where m.thread_id = t.id),
         lm.body, (select case when lm.sender_id = app.me() then 'You' else p.full_name end from public.persons p where p.id = lm.sender_id), coalesce(t.last_message_at, t.created_at),
         (select count(*)::int from public.chat_messages x where x.thread_id = t.id and x.sender_id <> app.me() and x.created_at > coalesce(me.last_read_at, me.joined_at))
    from public.chat_threads t join public.chat_members me on me.thread_id = t.id and me.person_id = app.me()
    left join lateral (select x.body, x.sender_id from public.chat_messages x where x.thread_id = t.id order by x.id desc limit 1) lm on true
   where t.last_message_at is not null or t.created_by = app.me() or t.kind = 'team'
   order by coalesce(t.last_message_at, t.created_at) desc
   limit 100
$$;

create or replace function public.chat_messages(p_thread uuid, p_before bigint default null) returns table(id bigint, sender_id uuid, sender text, body text, ref jsonb, created_at timestamptz, mine boolean)
language plpgsql stable security definer set search_path = public, app, pg_temp as $$
begin
  if not app.chat_member(p_thread) then raise exception 'Not permitted.' using errcode = '42501'; end if;
  return query select x.id, x.sender_id, p.full_name, x.body, x.ref, x.created_at, x.sender_id = app.me()
    from (select * from public.chat_messages m where m.thread_id = p_thread and (p_before is null or m.id < p_before) order by m.id desc limit 60) x
    join public.persons p on p.id = x.sender_id order by x.id;
end $$;

create or replace function public.chat_members_of(p_thread uuid) returns table(person_id uuid, full_name text, designation text)
language plpgsql stable security definer set search_path = public, app, pg_temp as $$
begin
  if not app.chat_member(p_thread) then raise exception 'Not permitted.' using errcode = '42501'; end if;
  return query select p.id, p.full_name, p.designation from public.chat_members m join public.persons p on p.id = m.person_id where m.thread_id = p_thread order by p.full_name;
end $$;

create or replace function public.chat_send(p_thread uuid, p_body text, p_ref jsonb default null) returns bigint
language plpgsql security definer set search_path = public, app, pg_temp as $$
declare v_me uuid := app.me(); v_id bigint; v_title text;
begin
  if not app.chat_member(p_thread) then raise exception 'Not permitted.' using errcode = '42501'; end if;
  if coalesce(btrim(p_body), '') = '' then raise exception 'Write a message.' using errcode = 'P0001'; end if;
  insert into public.chat_messages(thread_id, sender_id, body, ref) values (p_thread, v_me, left(btrim(p_body), 2000), p_ref) returning id into v_id;
  update public.chat_threads set last_message_at = now() where id = p_thread;
  update public.chat_members set last_read_at = now() where thread_id = p_thread and person_id = v_me;
  select case when kind = 'direct' then null else title end into v_title from public.chat_threads where id = p_thread;
  insert into public.notifications(person_id, kind, message, link)
  select m.person_id, 'chat', (select full_name from public.persons where id = v_me) || coalesce(' in ' || v_title, '') || ': ' || left(btrim(p_body), 140), '/chat?t=' || p_thread
    from public.chat_members m
   where m.thread_id = p_thread and m.person_id <> v_me
     and not exists (select 1 from public.notifications n where n.person_id = m.person_id and n.kind = 'chat' and n.link = '/chat?t=' || p_thread
                      and n.read_at is null and n.created_at > now() - interval '10 minutes');
  return v_id;
end $$;

create or replace function public.chat_read(p_thread uuid) returns void
language plpgsql security definer set search_path = public, app, pg_temp as $$
begin
  if not app.chat_member(p_thread) then raise exception 'Not permitted.' using errcode = '42501'; end if;
  update public.chat_members set last_read_at = now() where thread_id = p_thread and person_id = app.me();
  update public.notifications set read_at = now() where person_id = app.me() and kind = 'chat' and link = '/chat?t=' || p_thread and read_at is null;
end $$;

create or replace function public.chat_unread() returns int
language sql stable security definer set search_path = public, app, pg_temp as $$
  select count(*)::int from public.chat_messages x join public.chat_members m on m.thread_id = x.thread_id and m.person_id = app.me()
   where x.sender_id <> app.me() and x.created_at > coalesce(m.last_read_at, m.joined_at)
$$;

revoke execute on function public.prev_buckets(date), public.my_journey(), public.chat_contacts(), public.chat_direct(uuid), public.chat_team(),
  public.chat_topic(uuid[], text, jsonb), public.chat_threads(), public.chat_messages(uuid, bigint), public.chat_members_of(uuid), public.chat_send(uuid, text, jsonb),
  public.chat_read(uuid), public.chat_unread() from public, anon;
grant execute on function public.prev_buckets(date), public.my_journey(), public.chat_contacts(), public.chat_direct(uuid), public.chat_team(),
  public.chat_topic(uuid[], text, jsonb), public.chat_threads(), public.chat_messages(uuid, bigint), public.chat_members_of(uuid), public.chat_send(uuid, text, jsonb),
  public.chat_read(uuid), public.chat_unread() to authenticated;
revoke execute on function app.day_result(uuid, date), app.journey_days(uuid, int), app.journey(uuid), app.can_chat(uuid, uuid), app.chat_member(uuid) from public, anon, authenticated;

-- "Ask my manager" from a figure: a topic thread with my direct manager (operations first, then collections).
create or replace function public.chat_ask_manager(p_title text, p_ref jsonb default null) returns uuid
language plpgsql security definer set search_path = public, app, pg_temp as $$
declare v_me uuid := app.me(); v_mgr uuid;
begin
  if v_me is null then raise exception 'Not signed in' using errcode = '28000'; end if;
  select r.manager_id into v_mgr from public.reporting_lines r
   where r.person_id = v_me and r.valid @> app.today() and r.manager_id <> v_me order by (r.function = 'operations') desc limit 1;
  if v_mgr is null then raise exception 'No manager is set for you — ask HR to set your reporting line.' using errcode = 'P0001'; end if;
  return public.chat_topic(array[v_mgr], p_title, p_ref);
end $$;
revoke all on function public.chat_ask_manager(text, jsonb) from public, anon;
grant execute on function public.chat_ask_manager(text, jsonb) to authenticated;
