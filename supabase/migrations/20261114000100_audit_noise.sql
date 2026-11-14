-- D-153 (14 Nov 2026): the 5-minute task check re-saved every open task even when nothing had changed, and each of
-- those no-change saves was written to the activity log (≈45,000 rows a day, most of the database's size).
-- Fix at the source: the task check only touches a task when its text, owner or details actually changed (or it has
-- to be re-armed). The activity log itself is unchanged — it still records every real change.

do $mig$
declare f text;
  a text := $a$  on conflict (dedupe_key) do update set title = excluded.title, detail = excluded.detail, owner_id = excluded.owner_id,
         condition_cleared = false, updated_at = now()
   where public.tasks.status <> 'resolved'$a$;
  b text := $b$  on conflict (dedupe_key) do update set title = excluded.title, detail = excluded.detail, owner_id = excluded.owner_id,
         condition_cleared = false,
         updated_at = case when (public.tasks.title, public.tasks.detail, public.tasks.owner_id) is distinct from (excluded.title, excluded.detail, excluded.owner_id)
                           then now() else public.tasks.updated_at end
   where public.tasks.status <> 'resolved'
     and (public.tasks.condition_cleared
          or (public.tasks.title, public.tasks.detail, public.tasks.owner_id) is distinct from (excluded.title, excluded.detail, excluded.owner_id))$b$;
begin
  select pg_get_functiondef(p.oid) into f from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'app' and p.proname = 'task_upsert';
  if f like '%is distinct from (excluded.title%' then return; end if;
  if position(a in f) = 0 then raise exception 'task_upsert: anchor not found'; end if;
  execute replace(f, a, b);
end $mig$;
