-- D-138  "My team" means everyone below me, in any reporting line: attendance and leave decisions.
--        Automatic tasks: no more stale or duplicate ones.
-- D-139  Activity log: who, when, from which device and network address; more tables covered; sign-in and device log.

-- ---------------------------------------------------------------- D-138 team actions
create or replace function app.in_team_any(p_person uuid, p_date date) returns boolean
language sql stable security definer set search_path = public, app, pg_temp as $$
  with recursive up as (
    select r.manager_id m, 1 d from public.reporting_lines r where r.person_id = p_person and r.valid @> p_date
    union
    select r.manager_id, up.d + 1 from up join public.reporting_lines r on r.person_id = up.m and r.valid @> p_date where up.d < 12)
  select p_person <> app.me() and exists (select 1 from up where m = app.me());
$$;
-- was: Admin/HR, or a DIRECT report in the operations or collections line only. People reporting through another line
-- (for example business intelligence) or two levels down were refused.
create or replace function app.manages(p_person uuid, p_date date) returns boolean
language sql stable security definer set search_path = public, app, pg_temp as $$
  select app.is_admin() or app.has_role('hr_admin') or app.in_team_any(p_person, least(p_date, app.today()));
$$;
do $mig$
declare f text := pg_get_functiondef('public.set_attendance(uuid,date,text,text)'::regprocedure); o text := f;
begin
  f := replace(f, 'You can only mark attendance for your direct reports.', 'You can mark attendance only for people in your team.');
  if f <> o then execute f; end if;
exception when undefined_function then raise notice 'set_attendance signature differs';
end $mig$;

-- ---------------------------------------------------------------- D-138 automatic tasks
do $mig$
declare v text; r record; n int := 0;
begin
  -- the function that raises the automatic tasks (its name has changed over time, so it is found by what it does)
  for r in select p.oid from pg_proc p where p.pronamespace = 'app'::regnamespace and p.prokind = 'f' and pg_get_functiondef(p.oid) like '%''add_team:'' || r.id%' loop
    v := pg_get_functiondef(r.oid); n := n + 1;
    if position('app.tasks_tidy()' in v) > 0 then continue; end if;
    -- "add your team" only for a manager who has nobody yet
    v := replace(v, 'and ra.role in (''zm'',''bm'',''ba'',''manager'',''ops_head'',''collections_head'') loop',
      'and ra.role in (''zm'',''bm'',''ba'',''manager'',''ops_head'',''collections_head'')' || E'\n              and not exists (select 1 from public.reporting_lines rl where rl.manager_id = p.id and rl.valid @> v_today) loop');
    -- one salary task for HR instead of one per person
    v := replace(v, 'perform app.task_upsert(''salary_missing'', ''task'', ''salary:'' || r.id, app.hr_owner(), r.id, ''Enter monthly salary for '' || r.full_name, ''{}''::jsonb);', 'null;');
    v := replace(v, E'  update public.tasks t set status = ''resolved'', resolved_at = now(), resolution_note = ''Done'', updated_at = now()\n   where t.category = ''task''',
      E'  perform app.tasks_tidy();\n  update public.tasks t set status = ''resolved'', resolved_at = now(), resolution_note = ''Done'', updated_at = now()\n   where t.category = ''task''');
    if position('app.tasks_tidy()' in v) = 0 or position('rl.manager_id = p.id' in v) = 0 or position('null;' in v) = 0 then raise exception 'task rule anchors not found'; end if;
    execute v;
  end loop;
  if n = 0 then raise exception 'the task rules function was not found'; end if;
end $mig$;

create or replace function app.tasks_tidy() returns void
language plpgsql security definer set search_path = public, app, pg_temp as $$
declare v_today date := app.today(); v_n int; v_names text;
begin
  select count(*), string_agg(p.full_name, ', ' order by p.full_name) into v_n, v_names from public.persons p
   where p.status in ('active', 'invited') and p.resource_type = 'own_employee' and app.manager_of(p.id) is not null
     and not exists (select 1 from public.hr_compensation h where h.person_id = p.id);
  if v_n > 0 and app.hr_owner() is not null then
    perform app.task_upsert('salary_missing', 'task', 'salary:all', app.hr_owner(), null,
      'Enter the monthly salary of ' || v_n || case when v_n = 1 then ' person' else ' people' end || ' (HR repository)', jsonb_build_object('people', left(v_names, 1500)));
  end if;
  update public.tasks t set status = 'resolved', resolved_at = now(), resolution_note = 'No longer applies', updated_at = now()
   where t.status <> 'resolved' and t.category = 'task' and (
        (t.kind = 'salary_missing' and (t.dedupe_key <> 'salary:all' or v_n = 0))
     or (t.kind = 'add_team' and (exists (select 1 from public.reporting_lines rl where rl.manager_id = t.owner_id and rl.valid @> v_today)
                               or not exists (select 1 from public.role_assignments ra where ra.person_id = t.owner_id and ra.valid @> v_today
                                               and ra.role in ('zm', 'bm', 'ba', 'manager', 'ops_head', 'collections_head'))))
     or exists (select 1 from public.persons p where p.id = t.subject_id and p.status = 'exited'));
end $$;
revoke all on function app.tasks_tidy() from public, anon, authenticated;

-- ---------------------------------------------------------------- D-139 activity log
alter table public.audit_events add column if not exists ip text;
alter table public.audit_events add column if not exists user_agent text;

create or replace function app.req_header(p_name text) returns text
language plpgsql stable set search_path = public, app, pg_temp as $$
begin return nullif(current_setting('request.headers', true), '')::json ->> p_name; exception when others then return null; end $$;
create or replace function app.req_ip() returns text language sql stable set search_path = public, app, pg_temp as $$
  select nullif(btrim(split_part(coalesce(app.req_header('x-forwarded-for'), app.req_header('x-real-ip'), ''), ',', 1)), '') $$;

create or replace function app.audit() returns trigger
language plpgsql security definer set search_path = public, app, pg_temp as $$
declare v_row jsonb := to_jsonb(coalesce(new, old));
begin
  insert into public.audit_events(actor_uid, actor_person, table_name, row_id, action, before, after, reason, ip, user_agent)
  values (auth.uid(), app.me(), tg_table_name,
          coalesce(v_row->>'id', v_row->>'person_id' || '|' || coalesce(v_row->>'work_date','') || '|' || coalesce(v_row->>'function',''),
                   v_row->>'key', v_row->>'area' || '|' || (v_row->>'role'), v_row->>'designation' || '|' || (v_row->>'department'),
                   v_row->>'person_id' || '|' || (v_row->>'month'), v_row->>'person_id' || '|' || (v_row->>'week_start'), v_row->>'name', v_row->>'person_id', v_row->>'month'),
          lower(tg_op),
          case when tg_op <> 'INSERT' then to_jsonb(old) - 'signature' - 'data_url' end,      -- images are not copied into the log
          case when tg_op <> 'DELETE' then to_jsonb(new) - 'signature' - 'data_url' end,
          nullif(current_setting('app.reason', true), ''), app.req_ip(), left(app.req_header('user-agent'), 300));
  return coalesce(new, old);
end $$;

do $$
declare t text;
begin
  foreach t in array array['monthly_scores', 'weekly_reviews', 'kpi_assignment', 'person_attributes', 'kpi_catalogue', 'attribute_catalogue', 'kpi_entry', 'scoring_config',
      'access_rules', 'access_pages', 'departments', 'designations', 'designation_departments', 'letters', 'letter_templates', 'role_profiles', 'person_responsibilities',
      'payslip_history', 'company_assets', 'day_plan', 'task_members', 'attachments', 'salary_declarations', 'payroll_lines', 'agreement_versions', 'help_desk_people'] loop
    if to_regclass('public.' || t) is not null and not exists (select 1 from pg_trigger g join pg_proc f on f.oid = g.tgfoid where g.tgrelid = to_regclass('public.' || t) and f.proname = 'audit') then
      execute format('create trigger audit_%s after insert or update or delete on public.%I for each row execute function app.audit()', t, t);
    end if;
  end loop;
end $$;

-- every time the app is opened: who, when, device, network address, and location only if the person has already allowed it
create table if not exists public.access_log (
  id bigint generated always as identity primary key,
  person_id uuid not null references public.persons(id),
  at timestamptz not null default now(),
  kind text not null default 'open' check (kind in ('sign_in', 'open')),
  ip text, user_agent text, device_id text, device text, platform text, screen text, tz text, lang text, app_mode text,
  lat numeric(9,6), lng numeric(9,6), accuracy_m int
);
create index if not exists access_log_person_at on public.access_log(person_id, at desc);
create index if not exists access_log_at on public.access_log(at desc);
alter table public.access_log enable row level security;
revoke all on public.access_log from anon, authenticated;

create or replace function public.log_access(p_kind text, p_info jsonb) returns void
language plpgsql security definer set search_path = public, app, pg_temp as $$
declare v_me uuid := app.me();
begin
  if v_me is null then return; end if;
  if p_kind = 'open' and exists (select 1 from public.access_log a where a.person_id = v_me and a.at > app.clock() - interval '30 minutes'
        and coalesce(a.device_id, '') = coalesce(p_info ->> 'device_id', '') and coalesce(a.ip, '') = coalesce(app.req_ip(), '')) then return; end if;
  insert into public.access_log(person_id, at, kind, ip, user_agent, device_id, device, platform, screen, tz, lang, app_mode, lat, lng, accuracy_m)
  values (v_me, app.clock(), case when p_kind = 'sign_in' then 'sign_in' else 'open' end, app.req_ip(), left(app.req_header('user-agent'), 300),
          left(p_info ->> 'device_id', 64), left(p_info ->> 'device', 120), left(p_info ->> 'platform', 60), left(p_info ->> 'screen', 30), left(p_info ->> 'tz', 60),
          left(p_info ->> 'lang', 20), left(p_info ->> 'app_mode', 20),
          case when (p_info ->> 'lat') ~ '^-?[0-9]+(\.[0-9]+)?$' then round((p_info ->> 'lat')::numeric, 6) end,
          case when (p_info ->> 'lng') ~ '^-?[0-9]+(\.[0-9]+)?$' then round((p_info ->> 'lng')::numeric, 6) end,
          case when (p_info ->> 'accuracy') ~ '^[0-9]+(\.[0-9]+)?$' then least(round((p_info ->> 'accuracy')::numeric), 100000)::int end);
end $$;

create or replace function public.access_log_list(p_from date default null, p_to date default null, p_person uuid default null) returns jsonb
language plpgsql stable security definer set search_path = public, app, pg_temp as $$
begin
  if not (app.is_admin() or app.has_role('auditor')) then raise exception 'Only Admin and the Auditor can open the sign-in log.' using errcode = '42501'; end if;
  return (select coalesce(jsonb_agg(x order by x.at desc), '[]'::jsonb) from (
    select a.at, a.kind, p.full_name person, p.designation, a.ip, a.device, a.platform, a.screen, a.tz, a.app_mode, a.device_id, a.user_agent, a.lat, a.lng, a.accuracy_m,
           (select count(distinct b.device_id) from public.access_log b where b.person_id = a.person_id and b.device_id is not null) devices
      from public.access_log a join public.persons p on p.id = a.person_id
     where a.at >= coalesce(p_from, app.today() - 7)::timestamp at time zone app.tz() and a.at < (coalesce(p_to, app.today()) + 1)::timestamp at time zone app.tz()
       and (p_person is null or a.person_id = p_person)
     order by a.at desc limit 2000) x);
end $$;
revoke all on function public.log_access(text, jsonb), public.access_log_list(date, date, uuid) from public, anon;
grant execute on function public.log_access(text, jsonb), public.access_log_list(date, date, uuid) to authenticated;
