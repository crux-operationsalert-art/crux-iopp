-- D-143: functions Admin can pause and bring back (13 Nov 2026).
-- A paused function disappears for everyone (Admin included): its pages leave the menu and refuse to open,
-- its tasks and notifications stop, and nothing it holds is deleted. Resuming brings everything back as it was.

create table if not exists public.app_modules (
  key text primary key,
  label text not null,
  description text not null,
  pages text[] not null default '{}',          -- access_pages keys this function owns
  task_kinds text[] not null default '{}',     -- system tasks it raises
  notify_kinds text[] not null default '{}',   -- notifications it sends
  sort int not null default 0,
  paused boolean not null default false,
  updated_by uuid references public.persons(id),
  updated_at timestamptz
);
alter table public.app_modules enable row level security;
revoke all on public.app_modules from anon, authenticated;

insert into public.app_modules(key, label, description, pages, task_kinds, notify_kinds, sort) values
  ('attendance', 'Attendance & leave', 'Marking attendance, leave requests, the team calendar, and the leave and holiday set-up.',
     '{attendance,adm_policy}', '{absence_streak}', '{attendance,leave}', 10),
  ('plan', 'Check-in & day plan', 'The morning check-in, the plan for the day and its reminders.', '{plan}', '{}', '{checkin}', 20),
  ('payroll', 'Payroll, pay statements & penalties', 'Salary declaration, the payroll sheet, pay statements and the penalties page.',
     '{payroll,penalties}', '{salary_missing}', '{salary,payroll,penalty}', 30),
  ('hr_docs', 'HR repository & joining documents', 'Profile completion with ID, bank and qualification documents, document checks, police verification and the HR repository.',
     '{adm_compliance,adm_doccheck}', '{police_verification,police_verification_hr,profile_incomplete}', '{hr_document,profile,police_verification}', 40),
  ('letters', 'Letters, policies & salary slips', 'Letters to sign, policy sign-off, salary slips and their Admin section.', '{letters,adm_letters}', '{}', '{letter}', 50),
  ('chat', 'Chat', 'One-to-one, team and task chats.', '{chat}', '{}', '{chat}', 60),
  ('tasks', 'Tasks & misses', 'The task list: assigned tasks and the automatic follow-ups for missed updates.', '{tasks}', '{}', '{}', 70)
on conflict (key) do nothing;

create or replace function app.module_paused(p_key text) returns boolean
language sql stable security definer set search_path = public, app, pg_temp as $$
  select coalesce((select paused from public.app_modules where key = p_key), false);
$$;
create or replace function app.page_paused(p_page text) returns boolean
language sql stable security definer set search_path = public, app, pg_temp as $$
  select exists (select 1 from public.app_modules m where m.paused and p_page = any (m.pages));
$$;
create or replace function app.kind_paused(p_kind text) returns boolean
language sql stable security definer set search_path = public, app, pg_temp as $$
  select exists (select 1 from public.app_modules m where m.paused and (p_kind = any (m.task_kinds) or p_kind = any (m.notify_kinds)));
$$;
revoke all on function app.module_paused(text), app.page_paused(text), app.kind_paused(text) from public, anon;
grant execute on function app.module_paused(text), app.page_paused(text) to authenticated;

-- ---------------------------------------------------------------- pages: paused beats every role, Admin included
create or replace function app.page_state(p_page text, p_roles text[]) returns text
language sql stable security definer set search_path = public, app, pg_temp as $$
  with pg as (select (select base_roles from public.access_pages where key = p_page) as br),
       counted as (select m as role from unnest(p_roles) m, pg where pg.br is null or m = any (pg.br) or not (p_roles && pg.br)),
       v as (select r.scope from counted c left join public.access_rules r on r.area = 'page:' || p_page and r.role = c.role
              where coalesce(r.level, 'all') <> 'self')
  select case when app.page_paused(p_page) then 'hidden'
              when not exists (select 1 from counted) then 'full'
              when not exists (select 1 from v) then 'hidden'
              when exists (select 1 from v where scope is null) then 'full'
              when exists (select 1 from v where scope = 'team') then 'team' else 'self' end;
$$;

create or replace function app.page_hidden(p_page text) returns boolean
language sql stable security definer set search_path = public, app, pg_temp as $$
  select app.page_paused(p_page) or (not app.is_admin() and app.page_state(p_page, app.my_roles()) = 'hidden');
$$;

create or replace function app.page_enter(p_page text) returns void
language plpgsql stable security definer set search_path = public, app, pg_temp as $$
declare v text;
begin
  if app.page_paused(p_page) then raise exception 'This function is paused by Admin for now.' using errcode = '42501'; end if;
  v := case when app.is_admin() then 'full' else app.page_state(p_page, app.my_roles()) end;
  if v = 'hidden' then raise exception 'This page is turned off for your role.' using errcode = '42501'; end if;
  perform set_config('app.scope_cap', case when v in ('self', 'team') then v else '' end, true);
end $$;

-- ---------------------------------------------------------------- tasks and notifications of a paused function are not raised
do $mig$
declare f text;
begin
  select pg_get_functiondef(p.oid) into f from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'app' and p.proname = 'task_upsert';
  if f like '%app.kind_paused(p_kind)%' then return; end if;
  if position(E'declare v_id uuid;\nbegin\n' in f) = 0 then raise exception 'task_upsert: anchor not found'; end if;
  execute replace(f, E'declare v_id uuid;\nbegin\n', E'declare v_id uuid;\nbegin\n  if app.kind_paused(p_kind) then return; end if;   -- D-143\n');
end $mig$;

create or replace function app.notify_gate() returns trigger
language plpgsql security definer set search_path = public, app, pg_temp as $$
begin
  if app.kind_paused(new.kind) then return null; end if;
  -- a link into a paused page would only bounce the reader back to Home
  if new.kind = 'task' and new.link is not null and exists (select 1 from public.app_modules m where m.paused
       and exists (select 1 from unnest(m.pages) pg where new.link = '/' || pg or new.link like '/' || pg || '?%')) then return null; end if;
  return new;
end $$;
drop trigger if exists trg_notify_gate on public.notifications;
create trigger trg_notify_gate before insert on public.notifications for each row execute function app.notify_gate();

-- ---------------------------------------------------------------- the profile gate rests while joining documents are paused
do $mig$
declare f text; a text := $a$'profile_missing', to_jsonb(coalesce(app.profile_missing(p.id), '{}')),$a$;
begin
  select pg_get_functiondef(p.oid) into f from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'whoami';
  if f like '%paused_modules%' then return; end if;
  if position(a in f) = 0 then raise exception 'whoami: anchor not found'; end if;
  execute replace(f, a, $b$'profile_missing', to_jsonb(case when app.module_paused('hr_docs') then '{}'::text[] else coalesce(app.profile_missing(p.id), '{}') end),
    'paused_modules', (select coalesce(jsonb_agg(m.key order by m.sort), '[]'::jsonb) from public.app_modules m where m.paused),$b$);
end $mig$;

-- ---------------------------------------------------------------- Admin: list and switch
create or replace function public.modules_list() returns jsonb
language plpgsql stable security definer set search_path = public, app, pg_temp as $$
begin
  if not app.is_admin() then raise exception 'Only Admin can see this.' using errcode = '42501'; end if;
  return (select coalesce(jsonb_agg(jsonb_build_object('key', m.key, 'label', m.label, 'description', m.description, 'paused', m.paused,
            'pages', (select coalesce(jsonb_agg(p.label order by p.sort), '[]'::jsonb) from public.access_pages p where p.key = any (m.pages)),
            'updated_at', m.updated_at, 'updated_by', (select full_name from public.persons where id = m.updated_by)) order by m.sort), '[]'::jsonb)
            from public.app_modules m);
end $$;

create or replace function public.module_set(p_key text, p_paused boolean) returns jsonb
language plpgsql security definer set search_path = public, app, pg_temp as $$
declare m public.app_modules; v_tasks int := 0;
begin
  if not app.is_admin() then raise exception 'Only Admin can pause or resume a function.' using errcode = '42501'; end if;
  select * into m from public.app_modules where key = p_key;
  if not found then raise exception 'Unknown function.' using errcode = 'P0001'; end if;
  if m.paused = p_paused then return jsonb_build_object('ok', true, 'paused', p_paused, 'tasks_closed', 0); end if;
  perform set_config('app.reason', case when p_paused then 'function paused: ' else 'function resumed: ' end || m.label, true);
  update public.app_modules set paused = p_paused, updated_by = app.me(), updated_at = app.clock() where key = p_key;
  if p_paused then
    -- open system tasks of this function are closed; the key is freed so they come back by themselves on resume if still due
    update public.tasks t set status = 'resolved', resolved_at = app.clock(), resolution_note = 'Closed: ' || m.label || ' is paused by Admin.',
           dedupe_key = t.dedupe_key || ':paused:' || t.id
     where t.status <> 'resolved' and t.kind = any (m.task_kinds);
    get diagnostics v_tasks = row_count;
    update public.notifications n set read_at = app.clock() where n.read_at is null and n.kind = any (m.notify_kinds);
  end if;
  return jsonb_build_object('ok', true, 'paused', p_paused, 'tasks_closed', v_tasks);
end $$;
revoke all on function public.modules_list(), public.module_set(text, boolean) from public, anon;
grant execute on function public.modules_list(), public.module_set(text, boolean) to authenticated;

do $$ begin
  if not exists (select 1 from pg_trigger g join pg_proc f on f.oid = g.tgfoid where g.tgrelid = 'public.app_modules'::regclass and f.proname = 'audit') then
    create trigger audit_app_modules after insert or update or delete on public.app_modules for each row execute function app.audit();
  end if;
end $$;
