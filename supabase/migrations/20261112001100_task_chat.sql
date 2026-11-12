-- D-141  A chat for a task: opens (or creates) one conversation per task with the people on it.
create or replace function public.task_chat(p_task uuid) returns uuid
language plpgsql security definer set search_path = public, app, pg_temp as $$
declare v_me uuid := app.me(); t public.tasks; v_id uuid; v_people uuid[];
begin
  if v_me is null then raise exception 'Not signed in' using errcode = '28000'; end if;
  select * into t from public.tasks where id = p_task;
  if not found or not (t.owner_id = v_me or t.created_by = v_me or t.lead_id = v_me or app.is_task_member(t.id) or app.task_visible(t.owner_id, t.subject_id)) then
    raise exception 'Task not found.' using errcode = 'P0002'; end if;
  select array_agg(distinct x) into v_people from (
    select unnest(array[t.owner_id, t.created_by, t.lead_id, v_me]) x union select m.person_id from public.task_members m where m.task_id = t.id) z
   join public.persons p on p.id = z.x and p.status in ('active', 'invited');
  select c.id into v_id from public.chat_threads c where c.kind = 'topic' and c.ref ->> 'task' = p_task::text order by c.created_at limit 1;
  if v_id is null then
    insert into public.chat_threads(kind, title, ref, created_by)
    values ('topic', left('Task: ' || btrim(t.title), 120), jsonb_build_object('task', p_task, 'team', coalesce(t.assignment, '') = 'team'), v_me) returning id into v_id;
  end if;
  insert into public.chat_members(thread_id, person_id) select v_id, x from unnest(v_people) x on conflict do nothing;
  return v_id;
end $$;
revoke all on function public.task_chat(uuid) from public, anon;
grant execute on function public.task_chat(uuid) to authenticated;
