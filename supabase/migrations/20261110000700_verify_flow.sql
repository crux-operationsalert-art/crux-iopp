-- D-101: no dead ends. Every notification opens the exact place where its action is taken, and HR can verify a document
-- or confirm a scan-corrected ID number right where it is shown.

-- 1. person_profile returns each document's id (and file path for HR / the person) so the profile can open and verify it.
do $do$
declare f text := pg_get_functiondef('public.person_profile(uuid)'::regprocedure);
        a text := $a$'documents', (select coalesce(jsonb_agg(jsonb_build_object('doc_type', d.doc_type,$a$;
        b text := $b$'documents', (select coalesce(jsonb_agg(jsonb_build_object('id', d.id, 'path', case when v_full then d.storage_path end, 'verified_at', d.verified_at, 'doc_type', d.doc_type,$b$;
begin
  if position(a in f) = 0 then raise exception 'person_profile anchor not found'; end if;
  execute replace(f, a, b);
end $do$;

-- 2. HR confirms a scan-corrected (or scanned) ID number matches the document: source becomes 'hr', the linked document is verified.
create or replace function public.confirm_identity(p_person uuid, p_kind text) returns void
language plpgsql security definer set search_path = public, app, pg_temp as $$
declare v_me uuid := app.me(); v_doc uuid;
begin
  if not (app.is_admin() or app.has_role('hr_admin')) then raise exception 'Only HR can confirm ID details.' using errcode = '42501'; end if;
  if p_kind not in ('aadhaar', 'pan', 'bank') then raise exception 'Unknown document kind.' using errcode = '22023'; end if;
  perform set_config('app.reason', 'ID details confirmed against the document: ' || p_kind, true);
  if p_kind = 'aadhaar' then
    update public.hr_identity set aadhaar_source = 'hr', updated_by = v_me, updated_at = now() where person_id = p_person and aadhaar_number is not null returning aadhaar_doc into v_doc;
  elsif p_kind = 'pan' then
    update public.hr_identity set pan_source = 'hr', updated_by = v_me, updated_at = now() where person_id = p_person and pan_number is not null returning pan_doc into v_doc;
  else
    update public.hr_identity set bank_source = 'hr', updated_by = v_me, updated_at = now() where person_id = p_person and bank_account_number is not null returning bank_doc into v_doc;
  end if;
  if not found then raise exception 'There is no number recorded to confirm.' using errcode = 'P0001'; end if;
  insert into public.identity_log(person_id, kind, source, doc_id, changed_by) values (p_person, p_kind, 'hr', v_doc, v_me);
  update public.person_documents set verified_by = v_me, verified_at = now(), rejected = false where id = v_doc and verified_at is null;
  -- HR's "please check" notifications about this person are done
  update public.notifications set read_at = now()
   where kind = 'hr_document' and read_at is null and link like '%p=' || p_person::text || '%';
end $$;
revoke all on function public.confirm_identity(uuid, text) from public, anon;
grant execute on function public.confirm_identity(uuid, text) to authenticated;

-- 3. Links that now open the exact person / task.
do $do$
declare f text;
begin
  -- the person corrected a scanned number: HR repository, that person open
  f := pg_get_functiondef('public.save_identity(uuid, jsonb)'::regprocedure);
  if position($x$'/admin?s=hr'$x$ in f) = 0 then raise exception 'save_identity anchor not found'; end if;
  execute replace(f, $x$'/admin?s=hr'$x$, $x$'/admin?s=compliance&p=' || p_person::text$x$);
  -- a manager uploaded a document for someone: HR repository, that person open
  f := pg_get_functiondef('public.register_document(uuid, text, text, text, text, int)'::regprocedure);
  if position($x$' — please verify.', '/admin?s=compliance')$x$ in f) = 0 then raise exception 'register_document anchor not found'; end if;
  execute replace(f, $x$' — please verify.', '/admin?s=compliance')$x$, $x$' — please verify.', '/admin?s=compliance&p=' || p_person::text)$x$);
  -- police verification change: HR repository, police tab
  f := pg_get_functiondef('public.set_police_verification(uuid, text, date, date, text, text)'::regprocedure);
  if position($x$|| ').', '/admin?s=compliance')$x$ in f) = 0 then raise exception 'set_police_verification anchor not found'; end if;
  execute replace(f, $x$|| ').', '/admin?s=compliance')$x$, $x$|| ').', '/admin?s=compliance&t=police&p=' || p_person::text)$x$);
  -- a task or miss: that task
  f := pg_get_functiondef('app.notify_on_task()'::regprocedure);
  if position($x$new.title, '/tasks'$x$ in f) = 0 then raise exception 'notify_on_task anchor not found'; end if;
  execute replace(f, $x$new.title, '/tasks'$x$, $x$new.title, '/tasks?id=' || new.id::text$x$);
end $do$;

-- unread notifications already sent with the old, dead link: open the "to verify" queue instead
update public.notifications set link = '/admin?s=compliance&k=verify' where read_at is null and link in ('/admin?s=hr', '/admin?s=compliance') and kind = 'hr_document';
