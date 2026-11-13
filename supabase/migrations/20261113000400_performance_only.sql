-- D-150 (13 Nov 2026): the tool is used only for performance management for now. Everything a paused function
-- has already said disappears too: its alerts are hidden (not deleted), including generic "task" alerts that belong to it.

alter table public.app_modules add column if not exists notify_patterns text[] not null default '{}';

update public.app_modules set
  pages = array(select distinct unnest(pages || '{adm_quality}'::text[])),
  notify_kinds = array(select distinct unnest(notify_kinds || '{data_fix}'::text[])),
  notify_patterns = '{"Police verification%","Complete your profile%","Some of your details need correcting%","%document%verif%"}',
  description = 'Profile completion with ID, bank and qualification documents, data-quality chasing, document checks, police verification and the HR repository.'
 where key = 'hr_docs';
update public.app_modules set notify_patterns = '{"Enter monthly salary%","%monthly salary%","%salary declaration%","%pay sheet%","%payroll%"}' where key = 'payroll';
update public.app_modules set notify_patterns = '{"%leave request%","%leave was%","%attendance%"}', notify_kinds = array(select distinct unnest(notify_kinds || '{leave_request,leave_decision}'::text[])) where key = 'attendance';
update public.app_modules set notify_patterns = '{"%letter%to sign%","%policy%sign%"}' where key = 'letters';
update public.app_modules set notify_kinds = array(select distinct unnest(notify_kinds || '{nudge}'::text[])) where key = 'plan';

insert into public.app_modules(key, label, description, pages, sort) values
  ('people_reports', 'Attrition report', 'Joiners and leavers by month, location and designation.', '{attrition}', 80)
on conflict (key) do nothing;

-- one test for "does this alert belong to a paused function"
create or replace function app.notice_paused(p_kind text, p_message text, p_link text) returns boolean
language sql stable security definer set search_path = public, app, pg_temp as $$
  select exists (select 1 from public.app_modules m where m.paused and (
           p_kind = any (m.task_kinds) or p_kind = any (m.notify_kinds)
        or exists (select 1 from unnest(m.notify_patterns) pt where p_message ilike pt)
        or (p_link is not null and exists (select 1 from unnest(m.pages) pg where p_link = '/' || pg or p_link like '/' || pg || '?%'))))
      or (p_link like '/profile%' and app.module_paused('hr_docs'));
$$;
revoke all on function app.notice_paused(text, text, text) from public, anon;
grant execute on function app.notice_paused(text, text, text) to authenticated;

create or replace function app.notify_gate() returns trigger
language plpgsql security definer set search_path = public, app, pg_temp as $$
begin
  if app.notice_paused(new.kind, new.message, new.link) then return null; end if;
  return new;
end $$;

-- alerts already sent by a paused function are not shown (they come back if it is resumed)
alter policy read_notifications on public.notifications using (person_id = app.me() and not app.notice_paused(kind, message, link));

create or replace function public.modules_list() returns jsonb
language plpgsql stable security definer set search_path = public, app, pg_temp as $$
begin
  if not app.is_admin() then raise exception 'Only Admin can see this.' using errcode = '42501'; end if;
  return (select coalesce(jsonb_agg(jsonb_build_object('key', m.key, 'label', m.label, 'description', m.description, 'paused', m.paused, 'page_keys', to_jsonb(m.pages),
            'pages', (select coalesce(jsonb_agg(p.label order by p.sort), '[]'::jsonb) from public.access_pages p where p.key = any (m.pages)),
            'updated_at', m.updated_at, 'updated_by', (select full_name from public.persons where id = m.updated_by)) order by m.sort), '[]'::jsonb)
            from public.app_modules m);
end $$;

-- the unread count (chat badge aside) and push only consider alerts that are shown
do $mig$
declare f text;
begin
  select pg_get_functiondef(p.oid) into f from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'mark_notifications_read';
  -- nothing to change there: marking read is harmless for hidden alerts
end $mig$;
