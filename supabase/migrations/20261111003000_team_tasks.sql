-- D-116  Team vs individual task assignment.
-- Assigning to several people can now be either INDIVIDUAL (a separate task each, as before)
-- or TEAM (one shared task, a named lead, and an update cadence that nudges the team).

alter table public.tasks add column if not exists assignment text not null default 'individual' check (assignment in ('individual','team'));
alter table public.tasks add column if not exists lead_id uuid references public.persons(id);
alter table public.tasks add column if not exists cadence text not null default 'none' check (cadence in ('none','daily','weekly'));
alter table public.tasks add column if not exists next_update_due date;

create table if not exists public.task_members (
  task_id uuid not null references public.tasks(id) on delete cascade,
  person_id uuid not null references public.persons(id),
  is_lead boolean not null default false,
  added_at timestamptz not null default now(),
  primary key (task_id, person_id)
);
create index if not exists task_members_person on public.task_members (person_id);
alter table public.task_members enable row level security;
revoke all on public.task_members from anon, authenticated;
grant select on public.task_members to authenticated;

create or replace function app.is_task_member(p_task uuid) returns boolean
language sql stable security definer set search_path = public, app, pg_temp as $$
  select exists (select 1 from public.task_members m where m.task_id = p_task and m.person_id = app.me());
$$;
revoke all on function app.is_task_member(uuid) from public, anon;
grant execute on function app.is_task_member(uuid) to authenticated;

create policy read_task_members on public.task_members for select to authenticated
  using (app.is_task_member(task_id) or exists (select 1 from public.tasks t where t.id = task_id and app.task_visible(t.owner_id, t.subject_id)));

-- team members (and the lead) can see the shared task
alter policy read_tasks on public.tasks
  using (((select app.is_admin() or app.has_role('hr_admin')) or owner_id = (select app.me()) or created_by = (select app.me()) or app.is_task_member(id))
         or (not app.task_sensitive(kind)
             and ((select app.has_role('auditor'))
                  or owner_id = any ((select app.my_people('operations'))::uuid[]) or subject_id = any ((select app.my_people('operations'))::uuid[]))));

-- Assign a task: individual (one each) or team (one shared, with a lead and an update cadence).
drop function if exists public.assign_task(uuid[], text, text, date);
create or replace function public.assign_task(p_to uuid[], p_title text, p_detail text default null, p_due date default null,
    p_mode text default 'individual', p_lead uuid default null, p_cadence text default 'none')
returns int language plpgsql security definer set search_path = public, app, pg_temp as $$
declare v_me uuid := app.me(); x uuid; n int := 0; v_for uuid; v_task uuid; v_lead uuid; v_next date;
begin
  if v_me is null then raise exception 'Not signed in' using errcode = '28000'; end if;
  if not (app.is_admin() or app.has_role('auditor') or app.has_role('hr_admin') or app.has_role('ops_head') or app.has_role('collections_head')
          or app.has_role('zm') or app.has_role('bm') or app.has_role('ba') or app.has_role('manager') or app.has_role('product_head') or app.is_ea()
          or app.has_reports(v_me, 'operations', app.today()) or app.has_reports(v_me, 'collections', app.today())) then
    raise exception 'Only managers and above can assign tasks.' using errcode = '42501';
  end if;
  if coalesce(trim(p_title), '') = '' then raise exception 'Write what needs to be done.' using errcode = 'P0001'; end if;
  if p_due is not null and p_due < app.today() then raise exception 'The due date is in the past.' using errcode = 'P0001'; end if;
  if coalesce(array_length(p_to, 1), 0) = 0 then raise exception 'Pick at least one person.' using errcode = 'P0001'; end if;
  if p_cadence not in ('none','daily','weekly') then raise exception 'Bad cadence.' using errcode = '22023'; end if;
  foreach x in array p_to loop
    if not app.can_assign_to(x) then
      raise exception 'You can assign to your team, your peers and your manager only (%).', (select full_name from public.persons where id = x) using errcode = '42501';
    end if;
  end loop;
  if app.is_ea() then select e.principal into v_for from public.ea_assignments e where e.ea_person = v_me and e.valid @> app.today() limit 1; end if;

  if p_mode = 'team' then
    v_lead := coalesce(p_lead, p_to[1]);
    if not (v_lead = any(p_to)) then raise exception 'The lead must be one of the assignees.' using errcode = 'P0001'; end if;
    v_next := case p_cadence when 'daily' then app.today() + 1 when 'weekly' then app.today() + 7 else null end;
    perform set_config('app.reason', 'team task assigned', true);
    insert into public.tasks(kind, category, dedupe_key, title, detail, owner_id, subject_id, created_by, due_date,
                             assignment, lead_id, cadence, next_update_due)
    values ('assigned', 'task', 'assigned:' || gen_random_uuid(), btrim(p_title),
            jsonb_build_object('note', nullif(btrim(coalesce(p_detail, '')), ''), 'by', (select full_name from public.persons where id = v_me),
                               'for', v_for, 'for_name', (select full_name from public.persons where id = v_for)),
            v_lead, null, v_me, p_due, 'team', v_lead, p_cadence, v_next)
    returning id into v_task;
    insert into public.task_members(task_id, person_id, is_lead)
      select v_task, u, (u = v_lead) from unnest(p_to) u;
    insert into public.task_events(task_id, actor_id, action, note, data)
      values (v_task, v_me, 'created', 'Team task assigned to ' || array_length(p_to,1) || ' people, led by ' || (select full_name from public.persons where id = v_lead) ||
              case p_cadence when 'none' then '' else ', ' || p_cadence || ' updates' end, null);
    insert into public.notifications(person_id, kind, message, link)
      select u, 'task', (select full_name from public.persons where id = v_me) || ' added you to a team task: "' || btrim(p_title) || '"'
             || case when u = v_lead then ' (you lead it)' else '' end, '/tasks'
        from unnest(p_to) u;
    return 1;
  end if;

  -- individual: one task each (unchanged behaviour)
  foreach x in array p_to loop
    perform set_config('app.reason', 'task assigned', true);
    insert into public.tasks(kind, category, dedupe_key, title, detail, owner_id, subject_id, created_by, due_date)
    values ('assigned', 'task', 'assigned:' || gen_random_uuid(), btrim(p_title),
            jsonb_build_object('note', nullif(btrim(coalesce(p_detail, '')), ''), 'by', (select full_name from public.persons where id = v_me),
                               'for', v_for, 'for_name', (select full_name from public.persons where id = v_for)),
            x, x, v_me, p_due);
    n := n + 1;
  end loop;
  if v_for is not null then
    insert into public.notifications(person_id, kind, message, link)
    values (v_for, 'task', (select full_name from public.persons where id = v_me) || ' assigned "' || btrim(p_title) || '" to ' || n || ' person(s) on your behalf.', '/tasks');
  end if;
  return n;
end $$;

-- A team member posts a progress update (resets the cadence clock).
create or replace function public.post_task_update(p_task uuid, p_note text) returns jsonb
language plpgsql security definer set search_path = public, app, pg_temp as $$
declare v_me uuid := app.me(); t public.tasks;
begin
  if v_me is null then raise exception 'Not signed in' using errcode = '28000'; end if;
  if coalesce(trim(p_note), '') = '' then raise exception 'Write the update.' using errcode = 'P0001'; end if;
  select * into t from public.tasks where id = p_task;
  if not found then raise exception 'Task not found.' using errcode = 'P0002'; end if;
  if not (app.is_task_member(p_task) or t.owner_id = v_me or app.is_admin() or app.task_visible(t.owner_id, t.subject_id)) then
    raise exception 'Not permitted.' using errcode = '42501'; end if;
  insert into public.task_events(task_id, actor_id, action, note) values (p_task, v_me, 'note', btrim(p_note));
  if t.assignment = 'team' and t.cadence <> 'none' then
    update public.tasks set next_update_due = case t.cadence when 'daily' then app.today() + 1 else app.today() + 7 end,
       updated_at = now() where id = p_task;
  else
    update public.tasks set updated_at = now() where id = p_task;
  end if;
  return jsonb_build_object('ok', true);
end $$;

-- Nudge team tasks whose update is due.
create or replace function app.task_update_reminders() returns int
language plpgsql security definer set search_path = public, app, pg_temp as $$
declare r record; n int := 0;
begin
  for r in select * from public.tasks where assignment = 'team' and cadence <> 'none'
            and status not in ('resolved','denied') and next_update_due is not null and next_update_due <= app.today() loop
    insert into public.notifications(person_id, kind, message, link)
      select m.person_id, 'task', 'Update due on team task: "' || r.title || '"'
             || case when m.is_lead then ' — you lead it' else '' end, '/tasks'
        from public.task_members m where m.task_id = r.id;
    update public.tasks set next_update_due = case r.cadence when 'daily' then app.today() + 1 else app.today() + 7 end where id = r.id;
    n := n + 1;
  end loop;
  return n;
end $$;
revoke all on function app.task_update_reminders() from public, anon, authenticated;

grant execute on function public.post_task_update(uuid, text) to authenticated;
grant execute on function public.assign_task(uuid[], text, text, date, text, uuid, text) to authenticated;

-- my_tasks: carry assignment, lead and members, and let team members see their shared tasks.
drop function if exists public.my_tasks(text);
create or replace function public.my_tasks(p_scope text default 'all')
returns table(id uuid, kind text, category text, title text, detail jsonb, status text, condition_cleared boolean,
              owner_id uuid, owner_name text, subject_name text, branch text, client text, ref_date date, ref_month date,
              created_at timestamptz, updated_at timestamptz, scope text, last_note text, last_action text, last_at timestamptz,
              assignment text, lead_name text, cadence text, next_update_due date, members jsonb)
language plpgsql stable security definer set search_path = public, app, pg_temp as $$
declare v_me uuid := app.me(); v_admin boolean := app.is_admin();
begin
  if v_me is null then raise exception 'Not signed in' using errcode = '28000'; end if;
  return query
  select t.id, t.kind, t.category, t.title, t.detail, t.status, t.condition_cleared, t.owner_id, o.full_name, s.full_name, b.name, c.name,
         t.ref_date, t.ref_month, t.created_at, t.updated_at,
         case when t.owner_id = v_me or app.is_task_member(t.id) then 'mine'
              when t.created_by = v_me then 'assigned'
              when v_admin and (t.owner_id is null or t.status = 'resolution_requested') then 'admin' else 'team' end,
         e.note, e.action, e.at,
         t.assignment, ld.full_name, t.cadence, t.next_update_due,
         case when t.assignment = 'team' then (select jsonb_agg(jsonb_build_object('name', pm.full_name, 'is_lead', m.is_lead) order by m.is_lead desc, pm.full_name)
                from public.task_members m join public.persons pm on pm.id = m.person_id where m.task_id = t.id) end
    from public.tasks t
    left join public.persons o on o.id = t.owner_id left join public.persons s on s.id = t.subject_id
    left join public.persons ld on ld.id = t.lead_id
    left join public.branches b on b.id = t.branch_id left join public.clients c on c.id = t.client_id
    left join lateral (select x.note, x.action, x.at from public.task_events x where x.task_id = t.id order by x.at desc limit 1) e on true
   where (app.task_visible(t.owner_id, t.subject_id) or t.created_by = v_me or app.is_task_member(t.id))
     and (not app.task_sensitive(t.kind) or t.owner_id = v_me or v_admin or app.has_role('hr_admin'))
     and (p_scope = 'all' or (p_scope = 'open' and t.status <> 'resolved'))
   order by (t.status = 'resolved'), (t.owner_id is distinct from v_me), t.category, t.updated_at desc
   limit 500;
end $$;
grant execute on function public.my_tasks(text) to authenticated;

-- hook the cadence nudge into the periodic sync
do $mig$
declare v text := pg_get_functiondef('app.sync_all()'::regprocedure); o text := v;
begin
  if position('app.task_update_reminders()' in v) = 0 then
    v := replace(v, '  perform app.people_reminders();', '  perform app.people_reminders();
  perform app.task_update_reminders();');
    if v = o then raise exception 'team_tasks: sync_all anchor not found'; end if;
    execute v;
  end if;
exception when undefined_function then raise notice 'sync_all not present (local)';
end $mig$;
