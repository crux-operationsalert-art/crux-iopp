-- D-102 Chat that is instant, shows who is available, and a "Need help" desk.
--  * Instant: new chat messages reach open apps at once over Supabase Realtime. Members only (row security below);
--    the app keeps a slow check as a fallback.
--  * Availability for each person: Online (app open in the last 2 minutes), On leave, Day off, Gets alerts (phone or
--    computer alerts on), Has the app (alerts off), Away, Not signed in yet — with "last seen".
--  * Need help: app questions are answered in the app; operations, HR, finance / accounts and app-support questions go to
--    the people set for that desk. Desk owners name people to answer on their behalf (delegates). Admin sets the owners.
--    Who sits on each desk is data set in the app, not in this file.

alter table public.client_seen add column if not exists last_active timestamptz;

create or replace function public.chat_ping() returns void
language sql security definer set search_path = public, app, pg_temp as $$
  insert into public.client_seen as c (person_id, last_seen, last_active) values (app.me(), now(), now())
  on conflict (person_id) do update set last_active = now(), last_seen = greatest(c.last_seen, now())
$$;

create or replace function app.availability(p_person uuid) returns jsonb
language plpgsql stable security definer set search_path = public, app, pg_temp as $$
declare p public.persons; c public.client_seen; v_online boolean; v_push text; v_state text; v_label text; v_today date := app.today();
begin
  select * into p from public.persons where id = p_person;
  if p.id is null then return null; end if;
  select * into c from public.client_seen where person_id = p_person;
  v_online := c.last_active > now() - interval '2 minutes';
  select case when bool_or(coalesce(s.user_agent, '') ~* '(android|iphone|ipad|mobile)') then 'phone' else 'computer' end into v_push
    from public.push_subscriptions s where s.person_id = p_person and s.disabled_at is null having count(*) > 0;
  if p.auth_user_id is null then v_state := 'not_joined'; v_label := 'Not signed in yet';
  elsif exists (select 1 from public.leave_requests l where l.person_id = p_person and l.status = 'approved' and v_today between l.from_date and l.to_date)
     or exists (select 1 from public.attendance a where a.person_id = p_person and a.work_date = v_today and a.status in ('planned_leave', 'unplanned_leave'))
     or exists (select 1 from public.day_status d where d.person_id = p_person and d.work_date = v_today and d.status = 'on_leave') then
    v_state := 'leave'; v_label := 'On leave today';
  elsif not app.is_working_day(v_today) or exists (select 1 from public.attendance a where a.person_id = p_person and a.work_date = v_today and a.status in ('holiday', 'weekly_off')) then
    v_state := 'off'; v_label := 'Day off';
  elsif v_online then v_state := 'online'; v_label := 'Online';
  elsif v_push is not null then v_state := 'alerts'; v_label := 'Away · gets alerts on ' || v_push;
  elsif c.last_standalone is not null then v_state := 'app'; v_label := 'Away · has the app, alerts off';
  else v_state := 'away'; v_label := 'Away · alerts off'; end if;
  return jsonb_build_object('state', v_state, 'label', v_label, 'online', coalesce(v_online, false), 'alerts', v_push,
                            'seen', greatest(c.last_active, c.last_seen));
end $$;
revoke all on function app.availability(uuid) from public, anon, authenticated;

-- ------------------------------------------------------------------ instant delivery (Realtime, members only)
grant select on public.chat_messages to authenticated;
drop policy if exists chat_messages_members on public.chat_messages;
create policy chat_messages_members on public.chat_messages for select to authenticated using (app.chat_member(thread_id));
do $do$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'chat_messages') then
    execute 'alter publication supabase_realtime add table public.chat_messages';
  end if;
end $do$;
grant execute on function app.chat_member(uuid) to authenticated;   -- used by the row policy above; it only answers "am I a member"

-- ------------------------------------------------------------------ help desks
create table if not exists public.help_desks (key text primary key, title text not null, blurb text, sort int not null default 0);
insert into public.help_desks(key, title, blurb, sort) values
  ('ops', 'Operations', 'Cases, clients, TAT, allocations, targets, field work', 1),
  ('hr', 'HR', 'Leave, salary, PF, attendance, documents, joining, policies', 2),
  ('finance', 'Finance & accounts', 'Bills, invoices, payments, collections, reimbursements', 3),
  ('app', 'App support', 'Something in the app is not working or not covered by the answers', 4)
on conflict (key) do nothing;
create table if not exists public.help_desk_people (
  desk text not null references public.help_desks(key), person_id uuid not null references public.persons(id),
  role text not null check (role in ('owner', 'delegate')), added_by uuid references public.persons(id), added_at timestamptz not null default now(),
  primary key (desk, person_id)
);
alter table public.help_desks enable row level security; alter table public.help_desk_people enable row level security;
revoke all on public.help_desks, public.help_desk_people from anon, authenticated;

alter table public.chat_threads add column if not exists desk text references public.help_desks(key);
alter table public.chat_threads drop constraint if exists chat_threads_kind_check;
alter table public.chat_threads add constraint chat_threads_kind_check check (kind in ('direct', 'team', 'topic', 'help'));

create or replace function app.desk_people(p_desk text) returns uuid[]
language sql stable security definer set search_path = public, app, pg_temp as $$
  -- the desk's people; Admin as well while none of them has signed in yet, so no question waits unseen
  with d as (select h.person_id, p.auth_user_id is not null joined from public.help_desk_people h join public.persons p on p.id = h.person_id and p.status in ('active', 'invited') where h.desk = p_desk),
       a as (select distinct r.person_id from public.role_assignments r join public.persons p on p.id = r.person_id and p.status = 'active' where r.role = 'admin' and r.valid @> app.today())
  select array(select person_id from d union select person_id from a where not exists (select 1 from d where joined))
$$;
revoke all on function app.desk_people(text) from public, anon, authenticated;

create or replace function public.help_desks() returns jsonb
language sql stable security definer set search_path = public, app, pg_temp as $$
  select coalesce(jsonb_agg(jsonb_build_object('key', d.key, 'title', d.title, 'blurb', d.blurb,
           'people', (select coalesce(jsonb_agg(jsonb_build_object('person_id', p.id, 'full_name', p.full_name, 'designation', p.designation, 'role', h.role,
                                                                  'availability', app.availability(p.id)) order by h.role desc, p.full_name), '[]')
                        from public.help_desk_people h join public.persons p on p.id = h.person_id where h.desk = d.key),
           'mine', exists (select 1 from public.help_desk_people h where h.desk = d.key and h.person_id = app.me()),
           'can_manage', app.is_admin() or exists (select 1 from public.help_desk_people h where h.desk = d.key and h.person_id = app.me() and h.role = 'owner'))
         order by d.sort), '[]')
    from public.help_desks d
$$;

create or replace function public.help_ask(p_desk text, p_question text, p_ref jsonb default null) returns uuid
language plpgsql security definer set search_path = public, app, pg_temp as $$
declare v_me uuid := app.me(); v_id uuid; v_people uuid[]; v_title text; v_name text;
begin
  if v_me is null then raise exception 'Not signed in' using errcode = '28000'; end if;
  if not exists (select 1 from public.help_desks where key = p_desk) then raise exception 'Unknown help desk.' using errcode = '22023'; end if;
  if coalesce(btrim(p_question), '') = '' then raise exception 'Write your question.' using errcode = 'P0001'; end if;
  v_people := app.desk_people(p_desk);
  if coalesce(array_length(v_people, 1), 0) = 0 then raise exception 'Nobody is set up to answer this yet — ask Admin.' using errcode = 'P0001'; end if;
  select title into v_title from public.help_desks where key = p_desk;
  select full_name into v_name from public.persons where id = v_me;
  insert into public.chat_threads(kind, desk, title, ref, created_by)
  values ('help', p_desk, v_title || ' · ' || v_name || ': ' || left(regexp_replace(btrim(p_question), '\s+', ' ', 'g'), 70), p_ref, v_me) returning id into v_id;
  insert into public.chat_members(thread_id, person_id) select distinct v_id, x from unnest(v_people || v_me) x;
  perform public.chat_send(v_id, p_question, p_ref);
  return v_id;
end $$;

/** Admin sets owners; an owner adds or removes people who answer on their behalf (delegates). */
create or replace function public.help_set_person(p_desk text, p_person uuid, p_role text default 'delegate', p_on boolean default true) returns void
language plpgsql security definer set search_path = public, app, pg_temp as $$
declare v_me uuid := app.me(); v_admin boolean := app.is_admin();
        v_owner boolean := exists (select 1 from public.help_desk_people h where h.desk = p_desk and h.person_id = v_me and h.role = 'owner');
begin
  if p_role not in ('owner', 'delegate') then raise exception 'Role must be owner or delegate.' using errcode = '22023'; end if;
  if not (v_admin or (v_owner and p_role = 'delegate')) then raise exception 'Only Admin sets desk owners; owners choose who answers on their behalf.' using errcode = '42501'; end if;
  if not v_admin and exists (select 1 from public.help_desk_people h where h.desk = p_desk and h.person_id = p_person and h.role = 'owner') then
    raise exception 'Only Admin changes a desk owner.' using errcode = '42501'; end if;
  perform set_config('app.reason', 'help desk ' || p_desk || ': ' || case when p_on then 'added ' else 'removed ' end || p_role, true);
  if p_on then
    if not exists (select 1 from public.persons where id = p_person and status in ('active', 'invited')) then raise exception 'Choose an active person.' using errcode = 'P0001'; end if;
    insert into public.help_desk_people(desk, person_id, role, added_by) values (p_desk, p_person, p_role, v_me)
    on conflict (desk, person_id) do update set role = excluded.role, added_by = excluded.added_by, added_at = now();
    -- they can answer questions already open on this desk
    insert into public.chat_members(thread_id, person_id)
    select t.id, p_person from public.chat_threads t where t.kind = 'help' and t.desk = p_desk and coalesce(t.last_message_at, t.created_at) > now() - interval '14 days'
    on conflict do nothing;
    insert into public.notifications(person_id, kind, message, link)
    values (p_person, 'chat', 'You now answer ' || (select title from public.help_desks where key = p_desk) || ' questions in Need help'
            || case when p_role = 'delegate' then ' on behalf of the desk owner' else '' end || '.', '/chat');
  else
    delete from public.help_desk_people where desk = p_desk and person_id = p_person;
    delete from public.chat_members m using public.chat_threads t
     where m.thread_id = t.id and t.kind = 'help' and t.desk = p_desk and m.person_id = p_person and t.created_by <> p_person;
  end if;
end $$;

-- thread list, contacts and members now carry availability and the desk
drop function if exists public.chat_threads();
create function public.chat_threads() returns table(id uuid, kind text, title text, ref jsonb, members int, last_body text, last_sender text,
  last_at timestamptz, unread int, desk text, other uuid, availability jsonb)
language sql stable security definer set search_path = public, app, pg_temp as $$
  select t.id, t.kind,
         case when t.kind = 'direct' then (select p.full_name from public.persons p where p.id = o.person_id) else t.title end,
         t.ref, (select count(*)::int from public.chat_members m where m.thread_id = t.id),
         lm.body, (select case when lm.sender_id = app.me() then 'You' else p.full_name end from public.persons p where p.id = lm.sender_id), coalesce(t.last_message_at, t.created_at),
         (select count(*)::int from public.chat_messages x where x.thread_id = t.id and x.sender_id <> app.me() and x.created_at > coalesce(me.last_read_at, me.joined_at)),
         t.desk, o.person_id, case when o.person_id is not null then app.availability(o.person_id) end
    from public.chat_threads t join public.chat_members me on me.thread_id = t.id and me.person_id = app.me()
    left join lateral (select m.person_id from public.chat_members m where t.kind = 'direct' and m.thread_id = t.id and m.person_id <> app.me() limit 1) o on true
    left join lateral (select x.body, x.sender_id from public.chat_messages x where x.thread_id = t.id order by x.id desc limit 1) lm on true
   where t.last_message_at is not null or t.created_by = app.me() or t.kind = 'team'
   order by coalesce(t.last_message_at, t.created_at) desc
   limit 100
$$;

drop function if exists public.chat_contacts();
create function public.chat_contacts() returns table(person_id uuid, full_name text, designation text, relation text, availability jsonb)
language sql stable security definer set search_path = public, app, pg_temp as $$
  with me as (select app.me() id)
  select p.id, p.full_name, p.designation,
         case when exists (select 1 from app.subtree(p.id, 'operations', app.today()) s where s.person_id = (select id from me))
                or exists (select 1 from app.subtree(p.id, 'collections', app.today()) s where s.person_id = (select id from me)) then 'above'
              when exists (select 1 from app.subtree((select id from me), 'operations', app.today()) s where s.person_id = p.id)
                or exists (select 1 from app.subtree((select id from me), 'collections', app.today()) s where s.person_id = p.id) then 'team'
              when exists (select 1 from public.role_assignments r where r.person_id = p.id and r.role in ('admin', 'hr_admin') and r.valid @> app.today()) then 'hr'
              else 'peer' end,
         app.availability(p.id)
    from public.persons p
   where p.status = 'active' and p.auth_user_id is not null and app.can_chat((select id from me), p.id)
   order by 4, 2
   limit 400
$$;

drop function if exists public.chat_members_of(uuid);
create function public.chat_members_of(p_thread uuid) returns table(person_id uuid, full_name text, designation text, availability jsonb)
language plpgsql stable security definer set search_path = public, app, pg_temp as $$
begin
  if not app.chat_member(p_thread) then raise exception 'Not permitted.' using errcode = '42501'; end if;
  return query select p.id, p.full_name, p.designation, app.availability(p.id) from public.chat_members m join public.persons p on p.id = m.person_id
                where m.thread_id = p_thread order by p.full_name;
end $$;

revoke execute on function public.chat_ping(), public.help_desks(), public.help_ask(text, text, jsonb), public.help_set_person(text, uuid, text, boolean),
  public.chat_threads(), public.chat_contacts(), public.chat_members_of(uuid) from public, anon;
grant execute on function public.chat_ping(), public.help_desks(), public.help_ask(text, text, jsonb), public.help_set_person(text, uuid, text, boolean),
  public.chat_threads(), public.chat_contacts(), public.chat_members_of(uuid) to authenticated;
