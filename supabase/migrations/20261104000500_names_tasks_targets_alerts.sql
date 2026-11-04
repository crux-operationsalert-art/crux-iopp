-- D-63 (#5) Uniform names: clients in CAPITALS (they are bank / product codes); people, designations, locations and
--   zones in Title Case with known short forms kept (BOM, MSME, ROUP, MP, MM, AVP, VP, HR, EA …). Applied to existing
--   rows and to every future insert / edit, so the screens and the Zonal Tracker always look the same.
-- D-64 (#13) Managers and above can assign tasks to their team, their peers and their own manager; the assignee is
--   told; the assigner (or Admin) closes it.
-- D-65 (#4) Person targets are set by the person's direct manager; after the lock, the manager asks Admin to reopen
--   with a reason (a request in Admin's task queue); approving it opens target editing for that manager for 48 hours.
-- D-66 (#6) Admin can add a client with an optional Product Head and send an in-app / phone alert to chosen people.

create or replace function app.nice_name(p text, p_kind text) returns text
language plpgsql immutable as $$
declare s text; a text;
  keep text[] := array['BOM','MSME','ROUP','MP','MM','UP','HL','HFL','ITR','FSL','SBI','IDBI','BOI','BOB','LIC','SVC','DNSB','TJSB','BRT','RBL','PNB',
                       'AVP','VP','HR','EA','MIS','BA','BM','ZM','CEO','MD','NCR','II','III','SYNTH','PM','QA'];
begin
  if p is null then return null; end if;
  s := regexp_replace(btrim(p), '\s+', ' ', 'g');
  if p_kind = 'client' then return upper(s); end if;
  if p_kind = 'place' then s := regexp_replace(s, '\s*\+\s*', ' + ', 'g'); end if;
  s := initcap(lower(s));
  foreach a in array keep loop
    s := regexp_replace(s, '\m' || initcap(lower(a)) || '\M', a, 'g');
  end loop;
  s := regexp_replace(s, ' Of ', ' of ', 'g'); s := regexp_replace(s, ' And ', ' and ', 'g'); s := regexp_replace(s, ' The ', ' the ', 'g');
  s := regexp_replace(s, ' In ', ' in ', 'g'); s := regexp_replace(s, ' For ', ' for ', 'g'); s := regexp_replace(s, ' To ', ' to ', 'g');
  return s;
end $$;

create or replace function app.tidy_names() returns trigger
language plpgsql as $$
begin
  if tg_table_name = 'persons' then
    new.full_name := app.nice_name(new.full_name, 'person'); new.designation := app.nice_name(new.designation, 'title');
  elsif tg_table_name = 'clients' then new.name := app.nice_name(new.name, 'client');
  else new.name := app.nice_name(new.name, 'place');
  end if;
  return new;
end $$;
create trigger trg_tidy_names before insert or update of full_name, designation on public.persons for each row execute function app.tidy_names();
create trigger trg_tidy_names before insert or update of name on public.clients for each row execute function app.tidy_names();
create trigger trg_tidy_names before insert or update of name on public.branches for each row execute function app.tidy_names();
create trigger trg_tidy_names before insert or update of name on public.locations for each row execute function app.tidy_names();
create trigger trg_tidy_names before insert or update of name on public.zones for each row execute function app.tidy_names();

select set_config('app.reason', 'Uniform name format (D-63)', false);
update public.persons set full_name = full_name, designation = designation
 where full_name is distinct from app.nice_name(full_name, 'person') or designation is distinct from app.nice_name(designation, 'title');
update public.clients set name = name where name is distinct from app.nice_name(name, 'client');
update public.branches set name = name where name is distinct from app.nice_name(name, 'place');
update public.locations set name = name where name is distinct from app.nice_name(name, 'place');
update public.zones set name = name where name is distinct from app.nice_name(name, 'place');

-- ---------------------------------------------------------------- D-64 assigned tasks
alter table public.tasks add column if not exists created_by uuid references public.persons(id);
alter table public.tasks add column if not exists due_date date;

create or replace function app.can_assign_to(p_person uuid) returns boolean
language sql stable security definer set search_path = public, app, pg_temp as $$
  select app.me() is not null and p_person <> app.me() and (
       app.is_admin() or app.has_role('auditor') or app.has_role('hr_admin')
    or p_person = any(app.my_people())                                                            -- my team (and my principal's, as EA)
    or exists (select 1 from public.reporting_lines r where r.person_id = app.me() and r.manager_id = p_person and r.valid @> app.today())   -- my manager
    or exists (select 1 from public.reporting_lines a join public.reporting_lines b on b.manager_id = a.manager_id and b.function = a.function
                where a.person_id = app.me() and b.person_id = p_person and a.valid @> app.today() and b.valid @> app.today()))       -- my peers
$$;

create or replace function public.assign_task(p_to uuid[], p_title text, p_detail text default null, p_due date default null)
returns int language plpgsql security definer set search_path = public, app, pg_temp as $$
declare v_me uuid := app.me(); x uuid; n int := 0; v_for uuid;
begin
  if v_me is null then raise exception 'Not signed in' using errcode = '28000'; end if;
  if not (app.is_admin() or app.has_role('auditor') or app.has_role('hr_admin') or app.has_role('ops_head') or app.has_role('collections_head')
          or app.has_role('zm') or app.has_role('bm') or app.has_role('ba') or app.has_role('manager') or app.has_role('product_head') or app.is_ea()
          or app.has_reports(v_me, 'operations', app.today()) or app.has_reports(v_me, 'collections', app.today())) then
    raise exception 'Only managers and above can assign tasks.' using errcode = '42501';
  end if;
  if coalesce(trim(p_title), '') = '' then raise exception 'Write what needs to be done.' using errcode = 'P0001'; end if;
  if p_due is not null and p_due < app.today() then raise exception 'The due date is in the past.' using errcode = 'P0001'; end if;
  if app.is_ea() then select e.principal into v_for from public.ea_assignments e where e.ea_person = v_me and e.valid @> app.today() limit 1; end if;
  foreach x in array coalesce(p_to, '{}') loop
    if not app.can_assign_to(x) then
      raise exception 'You can assign to your team, your peers and your manager only (%).', (select full_name from public.persons where id = x) using errcode = '42501';
    end if;
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

alter policy read_tasks on public.tasks
  using (((select app.is_admin() or app.has_role('hr_admin')) or owner_id = (select app.me()) or created_by = (select app.me()))
         or (not app.task_sensitive(kind)
             and ((select app.has_role('auditor'))
                  or owner_id = any ((select app.my_people('operations'))::uuid[]) or subject_id = any ((select app.my_people('operations'))::uuid[]))));

-- ---------------------------------------------------------------- D-65 target reopen request
create or replace function public.request_target_reopen(p_month date, p_reason text)
returns uuid language plpgsql security definer set search_path = public, app, pg_temp as $$
declare v_id uuid; v_m date := date_trunc('month', p_month)::date;
begin
  if app.me() is null then raise exception 'Not signed in' using errcode = '28000'; end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'Give the reason targets must change.' using errcode = 'P0001'; end if;
  if app.clock() < app.target_lock_at(v_m) then raise exception 'Targets for % are still open; edit them directly.', to_char(v_m, 'Mon YYYY') using errcode = 'P0001'; end if;
  perform app.task_upsert('target_reopen', 'task', 'target_reopen:' || app.me() || ':' || v_m || ':' || extract(epoch from app.clock())::bigint, null, app.me(),
    (select full_name from public.persons where id = app.me()) || ' asks to reopen ' || to_char(v_m, 'Mon YYYY') || ' targets: ' || btrim(p_reason),
    jsonb_build_object('month', v_m, 'reason', btrim(p_reason)), null, null, null, v_m);
  select id into v_id from public.tasks where kind = 'target_reopen' and subject_id = app.me() order by created_at desc limit 1;
  insert into public.notifications(person_id, kind, message, link)
  select ra.person_id, 'task', 'Target reopen requested by ' || (select full_name from public.persons where id = app.me()) || ' for ' || to_char(v_m, 'Mon YYYY'), '/tasks'
    from public.role_assignments ra where ra.role = 'admin' and ra.valid @> app.today();
  return v_id;
end $$;

do $do$
declare f text; o text;
begin
  -- the assigner (or the principal an EA worked for) can close assigned tasks; approving a target-reopen request opens editing for 48 h
  f := pg_get_functiondef('public.admin_decide_task(uuid,text,text)'::regprocedure); o := f;
  f := replace(f, '  if not app.is_admin() then raise exception ''Only Admin can decide.'' using errcode = ''42501''; end if;', '');
  f := replace(f, '  select * into v_t from public.tasks where id = p_task for update;',
'  select * into v_t from public.tasks where id = p_task for update;
  if not (app.is_admin() or coalesce(v_t.kind = ''assigned'' and (v_t.created_by = app.me() or (v_t.detail->>''for'')::uuid = app.me()), false)) then
    raise exception ''Only Admin (or the person who assigned it) can decide.'' using errcode = ''42501'';
  end if;');
  f := replace(f, '  insert into public.task_events(task_id, actor_id, action, note) values (p_task, app.me(), p_decision, p_note);',
'  if p_decision = ''resolve'' and v_t.kind = ''target_reopen'' then
    perform public.grant_reopen(''target'', v_t.subject_id, coalesce(nullif(p_note, ''''), ''Target reopen approved''), app.clock() + interval ''48 hours'', null, v_t.ref_month, false, ''operations'');
  end if;
  insert into public.task_events(task_id, actor_id, action, note) values (p_task, app.me(), p_decision, p_note);');
  if f = o or position('target_reopen' in f) = 0 or position('Only Admin (or the person who assigned it)' in f) = 0 then raise exception 'admin_decide_task anchors not found'; end if;
  execute f;
  -- "done" requests on assigned tasks go to the assigner, not Admin
  f := pg_get_functiondef('public.task_request_resolution(uuid,text,jsonb)'::regprocedure); o := f;
  f := replace(f, '  select ra.person_id, ''task_resolution'', ''Resolution requested: '' || v_t.title, ''/tasks''
    from public.role_assignments ra where ra.role = ''admin'' and ra.valid @> app.today();',
'  select ra.person_id, ''task_resolution'', ''Resolution requested: '' || v_t.title, ''/tasks''
    from public.role_assignments ra where ra.role = ''admin'' and ra.valid @> app.today() and v_t.kind <> ''assigned''
  union all
  select x, ''task_resolution'', ''Done — please check: '' || v_t.title || '' ('' || (select full_name from public.persons where id = app.me()) || '')'', ''/tasks''
    from unnest(array[v_t.created_by, (v_t.detail->>''for'')::uuid]) x where v_t.kind = ''assigned'' and x is not null;');
  if f = o then raise exception 'task_request_resolution anchor not found'; end if;
  execute f;
  -- my_tasks shows tasks I assigned
  f := pg_get_functiondef('public.my_tasks(text)'::regprocedure); o := f;
  f := replace(f, '   where app.task_visible(t.owner_id, t.subject_id)', '   where (app.task_visible(t.owner_id, t.subject_id) or t.created_by = v_me)');
  f := replace(f, 'case when t.owner_id = v_me then ''mine''', 'case when t.owner_id = v_me then ''mine'' when t.created_by = v_me then ''assigned''');
  if f = o then raise exception 'my_tasks anchors not found'; end if;
  execute f;
  -- person targets: the direct manager (either line) or Admin; heads keep org / zone / branch
  f := pg_get_functiondef('app.can_set_target(text,text,uuid,uuid,uuid,date)'::regprocedure); o := f;
  f := replace(f, '  return exists (select 1 from app.subtree(app.me(), ''operations'', v_d) s where s.person_id = p_person)
      or exists (select 1 from app.subtree(app.me(), ''collections'', v_d) s where s.person_id = p_person);',
                  '  return exists (select 1 from public.reporting_lines r where r.person_id = p_person and r.manager_id = app.me() and r.valid @> v_d);');
  if f = o then raise exception 'can_set_target anchor not found'; end if;
  execute f;
  f := pg_get_functiondef('public.target_template(date)'::regprocedure); o := f;
  f := replace(f, '       and (v_all or p.id in (select s.person_id from app.subtree(app.me(), ''operations'', v_d) s
                              union select s.person_id from app.subtree(app.me(), ''collections'', v_d) s))',
                  '       and (v_all or p.id in (select r.person_id from public.reporting_lines r where r.manager_id = app.me() and r.valid @> v_d))');
  if f = o then raise exception 'target_template anchor not found'; end if;
  execute f;
end $do$;

-- Who may act on a task (reply, ask to close): its owner, whoever assigned it, Admin / HR, and managers above the owner
-- in their own line. Seeing everything (BI & Growth, an EA) does not give the right to act; HR to-dos stay with HR.
create or replace function app.task_can_act(p_task uuid) returns boolean
language sql stable security definer set search_path = public, app, pg_temp as $$
  select exists (select 1 from public.tasks t where t.id = p_task and (
       t.owner_id = app.me() or t.created_by = app.me() or app.is_admin() or app.has_role('hr_admin')
    or (not app.task_sensitive(t.kind) and (
         (t.owner_id is not null and exists (select 1 from app.subtree(app.me(), 'operations', app.today()) s where s.person_id = t.owner_id))
      or (t.subject_id is not null and exists (select 1 from app.subtree(app.me(), 'operations', app.today()) s where s.person_id = t.subject_id))))))
$$;

-- ---------------------------------------------------------------- D-66 alerts and new clients
create or replace function public.send_alert(p_people uuid[], p_message text, p_link text default '/notifications')
returns int language plpgsql security definer set search_path = public, app, pg_temp as $$
declare n int;
begin
  if not (app.is_admin() or app.has_role('auditor') or app.has_role('ops_head') or app.has_role('collections_head') or app.has_role('hr_admin')) then
    raise exception 'Only Admin, HR and the heads can send alerts.' using errcode = '42501';
  end if;
  if coalesce(trim(p_message), '') = '' then raise exception 'Write the message.' using errcode = 'P0001'; end if;
  insert into public.notifications(person_id, kind, message, link)
  select distinct x, 'announcement', btrim(p_message) || ' — ' || (select full_name from public.persons where id = app.me()), coalesce(p_link, '/notifications')
    from unnest(p_people) x join public.persons p on p.id = x and p.status in ('active','invited');
  get diagnostics n = row_count;
  return n;
end $$;

create or replace function public.add_client(p_name text, p_code text default null, p_product_head uuid default null, p_product text default null)
returns uuid language plpgsql security definer set search_path = public, app, pg_temp as $$
declare v_id uuid;
begin
  if not app.is_admin() then raise exception 'Only Admin can add clients.' using errcode = '42501'; end if;
  if exists (select 1 from public.clients where upper(name) = upper(btrim(p_name))) then raise exception 'A client with that name already exists.' using errcode = 'P0001'; end if;
  perform set_config('app.reason', 'new client', true);
  insert into public.clients(code, name, active) values (coalesce(nullif(btrim(p_code), ''), upper(left(regexp_replace(p_name, '\W', '', 'g'), 8))), p_name, true) returning id into v_id;
  if p_product_head is not null then
    insert into public.product_heads(person_id, client_id, product, valid, reason)
    values (p_product_head, v_id, coalesce(nullif(btrim(p_product), ''), upper(btrim(p_name))), daterange(app.today(), null), 'Product Head for a new client');
    if not exists (select 1 from public.role_assignments r where r.person_id = p_product_head and r.role = 'product_head' and r.valid @> app.today()) then
      insert into public.role_assignments(person_id, role, valid, reason) values (p_product_head, 'product_head', daterange(app.today(), null), 'Product Head');
    end if;
  end if;
  return v_id;
end $$;

grant execute on function public.assign_task(uuid[], text, text, date), public.request_target_reopen(date, text), public.send_alert(uuid[], text, text),
  public.add_client(text, text, uuid, text) to authenticated;
revoke all on function public.assign_task(uuid[], text, text, date), public.request_target_reopen(date, text), public.send_alert(uuid[], text, text),
  public.add_client(text, text, uuid, text) from public, anon;
grant execute on function app.can_assign_to(uuid), app.nice_name(text, text) to authenticated;
revoke all on function app.can_assign_to(uuid) from public, anon;
