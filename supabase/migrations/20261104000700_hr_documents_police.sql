-- D-67 (#12) HR documents: KYC, Aadhaar, PAN, address proof, qualification, bank proof, photo, agreement, police verification.
--   Files live in a PRIVATE storage bucket (hr-docs), path <person>/<type>/<file>. Only the person, HR and Admin can open
--   them (short-lived signed links); a manager can upload and open only the police-verification papers of people under
--   them. Numbers are never typed into the database — the profile keeps last-4 digits only (unchanged).
-- D-68 (#11) Police verification is compulsory for everyone. Managers (anyone above the person) record the status and
--   upload the papers; "verified" needs the papers on file. Due within the setting police_verification_days (default 30)
--   of joining or of go-live, whichever is later. The person's manager gets a to-do at once; once overdue, alarms climb
--   one level up the reporting line every week until they reach the top, and HR is told every week, until it is done.
--   HR / Admin can mark someone "not required" (e.g. the Chairman) with a reason.
-- D-69 (#8) HR repository: one HR-only screen with every person's profile, documents, police status, salary and partner terms.

insert into public.settings(key, value, description, label, help, kind, section, editable)
values ('police_verification_days', '30', 'Days allowed to complete police verification (D-68)', 'Police verification due within (days)',
        'Counted from joining, or from go-live for people already working. After this, alarms climb up the reporting line weekly and HR is told.', 'number', 'Attendance', true)
on conflict (key) do nothing;

create table if not exists public.person_documents (
  id uuid primary key default gen_random_uuid(),
  person_id uuid not null references public.persons(id),
  doc_type text not null check (doc_type in ('aadhaar','pan','address_proof','qualification','bank','photo','police_verification','agreement','kyc_other','other')),
  storage_path text not null unique,
  file_name text not null, mime text, size_bytes int check (size_bytes is null or size_bytes between 1 and 10485760),
  uploaded_by uuid references public.persons(id), uploaded_at timestamptz not null default now(),
  verified_by uuid references public.persons(id), verified_at timestamptz, rejected boolean not null default false, note text
);
create index if not exists person_documents_person on public.person_documents(person_id);

create table if not exists public.police_verifications (
  person_id uuid primary key references public.persons(id),
  status text not null default 'not_started' check (status in ('not_started','applied','verified','failed','not_required')),
  applied_on date, verified_on date, reference text, note text,
  updated_by uuid references public.persons(id), updated_at timestamptz not null default now(),
  check (status <> 'verified' or verified_on is not null)
);
create table if not exists public.police_alarms (
  person_id uuid not null references public.persons(id), week date not null, level int not null, sent_at timestamptz not null default now(),
  primary key (person_id, week)
);

-- someone above the person in either reporting line (today)
create or replace function app.above(p_person uuid) returns boolean
language sql stable security definer set search_path = public, app, pg_temp as $$
  select app.me() is not null and p_person <> app.me() and (
       exists (select 1 from app.subtree(app.me(), 'operations', app.today()) s where s.person_id = p_person)
    or exists (select 1 from app.subtree(app.me(), 'collections', app.today()) s where s.person_id = p_person))
$$;
create or replace function app.can_read_doc(p_person uuid, p_type text) returns boolean
language sql stable security definer set search_path = public, app, pg_temp as $$
  select p_person = app.me() or app.is_admin() or app.has_role('hr_admin') or (p_type = 'police_verification' and app.above(p_person))
$$;
create or replace function app.can_upload_doc(p_person uuid, p_type text) returns boolean
language sql stable security definer set search_path = public, app, pg_temp as $$
  select app.can_read_doc(p_person, p_type)
$$;
-- storage path → (person, type), null when malformed
create or replace function app.doc_path_ok(p_name text, p_write boolean) returns boolean
language plpgsql stable security definer set search_path = public, app, pg_temp as $$
declare a text[] := string_to_array(p_name, '/');
begin
  if cardinality(a) <> 3 or a[1] !~ '^[0-9a-f-]{36}$' then return false; end if;
  return case when p_write then app.can_upload_doc(a[1]::uuid, a[2]) else app.can_read_doc(a[1]::uuid, a[2]) end;
end $$;
grant execute on function app.above(uuid), app.can_read_doc(uuid, text), app.can_upload_doc(uuid, text), app.doc_path_ok(text, boolean) to authenticated;
revoke all on function app.above(uuid), app.can_read_doc(uuid, text), app.can_upload_doc(uuid, text), app.doc_path_ok(text, boolean) from public, anon;

alter table public.person_documents enable row level security;
alter table public.police_verifications enable row level security;
alter table public.police_alarms enable row level security;
create policy read_docs on public.person_documents for select to authenticated using (app.can_read_doc(person_id, doc_type));
create policy read_pv on public.police_verifications for select to authenticated
  using (person_id = (select app.me()) or (select app.is_admin() or app.has_role('hr_admin')) or app.above(person_id));
revoke all on public.person_documents, public.police_verifications, public.police_alarms from anon, authenticated;
grant select on public.person_documents, public.police_verifications to authenticated;
create trigger trg_audit after insert or update on public.person_documents for each row execute function app.audit();
create trigger trg_audit after insert or update on public.police_verifications for each row execute function app.audit();

-- Private bucket and its rules (skipped where there is no storage service, e.g. the test database).
do $do$
begin
  if to_regclass('storage.buckets') is null then return; end if;
  execute $s$insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
           values ('hr-docs', 'hr-docs', false, 10485760, array['application/pdf','image/jpeg','image/png','image/webp','image/heic'])
           on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types$s$;
  execute $s$create policy hr_docs_read on storage.objects for select to authenticated using (bucket_id = 'hr-docs' and app.doc_path_ok(name, false))$s$;
  execute $s$create policy hr_docs_write on storage.objects for insert to authenticated with check (bucket_id = 'hr-docs' and app.doc_path_ok(name, true))$s$;
end $do$;

-- Record a file after it is uploaded.
create or replace function public.register_document(p_person uuid, p_type text, p_path text, p_file_name text, p_mime text default null, p_size int default null)
returns uuid language plpgsql security definer set search_path = public, app, pg_temp as $$
declare v_id uuid; v_hr uuid := app.hr_owner();
begin
  if app.me() is null then raise exception 'Not signed in' using errcode = '28000'; end if;
  if not app.can_upload_doc(p_person, p_type) then raise exception 'You can upload only your own documents (managers: police verification papers of their team).' using errcode = '42501'; end if;
  if split_part(p_path, '/', 1) <> p_person::text or split_part(p_path, '/', 2) <> p_type then raise exception 'File path does not match the person and document type.' using errcode = '22023'; end if;
  perform set_config('app.reason', 'document uploaded: ' || p_type, true);
  insert into public.person_documents(person_id, doc_type, storage_path, file_name, mime, size_bytes, uploaded_by)
  values (p_person, p_type, p_path, left(p_file_name, 200), p_mime, p_size, app.me()) returning id into v_id;
  if v_hr is not null and v_hr <> app.me() then
    insert into public.notifications(person_id, kind, message, link)
    values (v_hr, 'hr_document', (select full_name from public.persons where id = app.me()) || ' uploaded ' || replace(p_type, '_', ' ') || ' for '
            || (select full_name from public.persons where id = p_person) || ' — please verify.', '/admin?s=compliance');
  end if;
  return v_id;
end $$;

create or replace function public.verify_document(p_id uuid, p_ok boolean, p_note text default null)
returns void language plpgsql security definer set search_path = public, app, pg_temp as $$
declare v public.person_documents;
begin
  if not (app.is_admin() or app.has_role('hr_admin')) then raise exception 'Only HR can verify documents.' using errcode = '42501'; end if;
  if not p_ok and coalesce(trim(p_note), '') = '' then raise exception 'Say what is wrong so the person can upload it again.' using errcode = 'P0001'; end if;
  update public.person_documents set verified_by = app.me(), verified_at = now(), rejected = not p_ok, note = nullif(btrim(coalesce(p_note, '')), '')
   where id = p_id returning * into v;
  if v.id is null then raise exception 'Document not found.' using errcode = 'P0001'; end if;
  insert into public.notifications(person_id, kind, message, link)
  values (v.person_id, 'hr_document', 'HR ' || case when p_ok then 'verified' else 'could not accept' end || ' your ' || replace(v.doc_type, '_', ' ')
          || coalesce(': ' || nullif(btrim(coalesce(p_note, '')), ''), '') || '.', '/profile');
end $$;

create or replace function public.set_police_verification(p_person uuid, p_status text, p_applied_on date default null, p_verified_on date default null,
                                                          p_reference text default null, p_note text default null)
returns public.police_verifications language plpgsql security definer set search_path = public, app, pg_temp as $$
declare v public.police_verifications; v_hr boolean := app.is_admin() or app.has_role('hr_admin'); v_name text;
begin
  if not (v_hr or app.above(p_person)) then raise exception 'Police verification is recorded by the person''s managers or HR.' using errcode = '42501'; end if;
  if p_status = 'not_required' and not v_hr then raise exception 'Only HR can mark police verification as not required.' using errcode = '42501'; end if;
  if p_status = 'not_required' and coalesce(trim(p_note), '') = '' then raise exception 'Give the reason it is not required.' using errcode = 'P0001'; end if;
  if p_status = 'verified' and not exists (select 1 from public.person_documents d where d.person_id = p_person and d.doc_type = 'police_verification' and not d.rejected) then
    raise exception 'Upload the police verification certificate first.' using errcode = 'P0001';
  end if;
  if p_status = 'applied' and p_applied_on is null then raise exception 'Give the date it was applied for.' using errcode = 'P0001'; end if;
  perform set_config('app.reason', 'police verification: ' || p_status, true);
  insert into public.police_verifications as pv (person_id, status, applied_on, verified_on, reference, note, updated_by, updated_at)
  values (p_person, p_status, p_applied_on, case when p_status = 'verified' then coalesce(p_verified_on, app.today()) end, nullif(btrim(coalesce(p_reference, '')), ''),
          nullif(btrim(coalesce(p_note, '')), ''), app.me(), now())
  on conflict (person_id) do update set status = excluded.status, applied_on = coalesce(excluded.applied_on, pv.applied_on),
     verified_on = excluded.verified_on, reference = coalesce(excluded.reference, pv.reference), note = excluded.note, updated_by = excluded.updated_by, updated_at = now()
  returning * into v;
  select full_name into v_name from public.persons where id = p_person;
  if p_status in ('verified','not_required') then
    update public.tasks set status = 'resolved', resolved_at = now(), resolution_note = 'Police verification ' || replace(p_status, '_', ' '), updated_at = now()
     where kind = 'police_verification' and subject_id = p_person and status <> 'resolved';
  end if;
  if app.hr_owner() is not null and app.hr_owner() <> app.me() then
    insert into public.notifications(person_id, kind, message, link)
    values (app.hr_owner(), 'police_verification', 'Police verification for ' || v_name || ': ' || replace(p_status, '_', ' ') || ' (by '
            || (select full_name from public.persons where id = app.me()) || ').', '/admin?s=compliance');
  end if;
  return v;
end $$;

-- The people whose police verification the signed-in person can see, with status and due date.
create or replace function app.pv_due(p_person uuid) returns date
language sql stable security definer set search_path = public, app, pg_temp as $$
  select greatest(coalesce(h.joining_date, p.joined_on, p.created_at::date), coalesce((app.setting('go_live_date') #>> '{}')::date, date '2026-11-04'))
         + coalesce((app.setting('police_verification_days') #>> '{}')::int, 30)
    from public.persons p left join public.hr_profiles h on h.person_id = p.id where p.id = p_person
$$;
create or replace function public.police_status(p_scope text default 'team')
returns table(person_id uuid, full_name text, designation text, manager text, status text, applied_on date, verified_on date, reference text,
              due date, overdue_days int, docs int, updated_at timestamptz)
language sql stable security definer set search_path = public, app, pg_temp as $$
  select p.id, p.full_name, p.designation,
         (select m.full_name from public.reporting_lines r join public.persons m on m.id = r.manager_id where r.person_id = p.id and r.valid @> app.today() order by (r.function = 'operations') desc limit 1),
         coalesce(v.status, 'not_started'), v.applied_on, v.verified_on, v.reference, app.pv_due(p.id),
         case when coalesce(v.status, 'not_started') in ('verified','not_required') then 0 else greatest(0, app.today() - app.pv_due(p.id)) end,
         (select count(*)::int from public.person_documents d where d.person_id = p.id and d.doc_type = 'police_verification' and not d.rejected), v.updated_at
    from public.persons p left join public.police_verifications v on v.person_id = p.id
   where p.status in ('active','invited')
     and ((p_scope = 'all' and (app.is_admin() or app.has_role('hr_admin'))) or (p_scope <> 'all' and app.above(p.id)) or p.id = app.me())
   order by (coalesce(v.status, 'not_started') in ('verified','not_required')), 10 desc, p.full_name
$$;

-- Sync: to-do for the manager; weekly alarms climbing the reporting line once overdue; weekly HR summary.
create or replace function app.sync_police_verification() returns int
language plpgsql security definer set search_path = public, app, pg_temp as $$
declare r record; c int := 0; v_week date := date_trunc('week', app.today())::date; v_hr uuid := app.hr_owner(); v_lvl int; v_m uuid; v_p uuid; i int;
        v_chain uuid[]; v_over int := 0; v_list text := '';
begin
  -- close to-dos that are done
  update public.tasks t set status = 'resolved', resolved_at = now(), resolution_note = 'Police verification done', updated_at = now()
   where t.kind = 'police_verification' and t.status <> 'resolved'
     and exists (select 1 from public.police_verifications v where v.person_id = t.subject_id and v.status in ('verified','not_required'));
  for r in
    select p.id, p.full_name, coalesce(v.status, 'not_started') st, app.pv_due(p.id) due,
           coalesce((select x.manager_id from public.reporting_lines x where x.person_id = p.id and x.function = 'operations' and x.valid @> app.today() limit 1),
                    (select x.manager_id from public.reporting_lines x where x.person_id = p.id and x.function = 'collections' and x.valid @> app.today() limit 1)) mgr
      from public.persons p left join public.police_verifications v on v.person_id = p.id
     where p.status = 'active' and coalesce(v.status, 'not_started') not in ('verified','not_required')
  loop
    if not exists (select 1 from public.tasks t where t.dedupe_key = 'police_verification:' || r.id) and coalesce(r.mgr, v_hr) is not null then
      insert into public.notifications(person_id, kind, message, link)
      values (coalesce(r.mgr, v_hr), 'police_verification', 'Police verification needed for ' || r.full_name || ' by ' || to_char(r.due, 'DD Mon') || '.', '/team?v=police');
    end if;
    perform app.task_upsert('police_verification', 'task', 'police_verification:' || r.id, coalesce(r.mgr, v_hr), r.id,
      'Police verification for ' || r.full_name || ' — ' || replace(r.st, '_', ' ') || case when app.today() > r.due then ', overdue since ' else ', due ' end || to_char(r.due, 'DD Mon YYYY'),
      jsonb_build_object('due', r.due, 'status', r.st, 'overdue_days', greatest(0, app.today() - r.due)), null, null, r.due, null);
    if app.today() > r.due then
      v_over := v_over + 1; if v_over <= 25 then v_list := v_list || r.full_name || ', '; end if;
      if not exists (select 1 from public.police_alarms a where a.person_id = r.id and a.week = v_week) then
        v_lvl := 1 + (app.today() - r.due) / 7;
        -- the chain above the person (operations line)
        v_chain := '{}'; v_p := r.id;
        for i in 1..12 loop
          select rl.manager_id into v_m from public.reporting_lines rl where rl.person_id = v_p and rl.function = 'operations' and rl.valid @> app.today() limit 1;
          exit when v_m is null; v_chain := v_chain || v_m; v_p := v_m;
        end loop;
        insert into public.notifications(person_id, kind, message, link)
        select distinct x, 'police_verification', 'OVERDUE: police verification for ' || r.full_name || ' was due ' || to_char(r.due, 'DD Mon') || ' ('
               || (app.today() - r.due) || ' days). Status: ' || replace(r.st, '_', ' ') || '.', '/team?v=police'
          from unnest(v_chain[1:least(v_lvl, cardinality(v_chain))]) x
         where x is not null;
        insert into public.police_alarms(person_id, week, level) values (r.id, v_week, v_lvl);
      end if;
    end if;
    c := c + 1;
  end loop;
  if v_hr is not null and v_over > 0 then
    perform app.task_upsert('police_verification_hr', 'task', 'police_verification_hr:' || v_week, v_hr, null,
      v_over || ' people have overdue police verification: ' || rtrim(v_list, ', ') || case when v_over > 25 then ' …' else '' end,
      jsonb_build_object('overdue', v_over), null, null, null, null);
    if not exists (select 1 from public.notifications n where n.person_id = v_hr and n.kind = 'police_verification_hr' and n.created_at >= v_week) then
      insert into public.notifications(person_id, kind, message, link)
      values (v_hr, 'police_verification_hr', v_over || ' people have overdue police verification. Open HR repository.', '/admin?s=compliance');
    end if;
  end if;
  update public.tasks set status = 'resolved', resolved_at = now(), resolution_note = 'Superseded by this week''s summary', updated_at = now()
   where kind = 'police_verification_hr' and status <> 'resolved' and dedupe_key <> 'police_verification_hr:' || v_week;
  return c;
end $$;
revoke all on function app.sync_police_verification() from public, anon, authenticated;

do $do$
declare f text;
begin
  f := pg_get_functiondef('app.sync_all()'::regprocedure);
  if position('perform app.sync_absence_streaks();' in f) = 0 then raise exception 'sync_all anchor not found'; end if;
  f := replace(f, 'perform app.sync_absence_streaks();', 'perform app.sync_absence_streaks();
  perform app.sync_police_verification();');
  execute f;
end $do$;

-- HR repository: everything HR needs per person, in one call (HR / Admin only).
create or replace function public.hr_repository()
returns table(person_id uuid, full_name text, designation text, status text, resource_type text, roles text, manager text, location text,
              joining_date date, profile_complete boolean, agreement_signed boolean, docs jsonb, police text, police_due date, salary numeric, salary_from date,
              partner jsonb)
language plpgsql stable security definer set search_path = public, app, pg_temp as $$
begin
  if not (app.is_admin() or app.has_role('hr_admin')) then raise exception 'HR only.' using errcode = '42501'; end if;
  return query
  select p.id, p.full_name, p.designation, p.status::text, p.resource_type::text,
         (select string_agg(distinct ra.role::text, ', ') from public.role_assignments ra where ra.person_id = p.id and ra.valid @> app.today()),
         (select m.full_name from public.reporting_lines r join public.persons m on m.id = r.manager_id where r.person_id = p.id and r.valid @> app.today() order by (r.function = 'operations') desc limit 1),
         (select string_agg(distinct b.name, ', ') from public.location_heads h join public.branches b on b.id = h.branch_id where h.person_id = p.id and h.valid @> app.today()),
         h.joining_date, h.completed_at is not null,
         exists (select 1 from public.agreement_acceptances a where a.person_id = p.id),
         (select coalesce(jsonb_object_agg(t, jsonb_build_object('n', n, 'verified', v, 'rejected', x)), '{}') from (
            select d.doc_type t, count(*) n, count(*) filter (where d.verified_at is not null and not d.rejected) v, count(*) filter (where d.rejected) x
              from public.person_documents d where d.person_id = p.id group by 1) s),
         coalesce(pv.status, 'not_started'), app.pv_due(p.id),
         (select c.monthly_gross from public.hr_compensation c where c.person_id = p.id order by c.effective_from desc, c.created_at desc limit 1),
         (select c.effective_from from public.hr_compensation c where c.person_id = p.id order by c.effective_from desc, c.created_at desc limit 1),
         case when p.resource_type::text = 'partner' then (
           select jsonb_agg(jsonb_build_object('location', b.name, 'agreement_signed', pa.agreement_signed, 'signed_on', pa.signed_on,
                    'cheque_received', pa.cheque_received, 'cheque_amount', pa.cheque_amount,
                    'ratio', (select s.partner_share_pct from public.partner_share_rules s where s.branch_id = b.id and s.valid @> app.today() limit 1)))
             from public.location_heads h join public.branches b on b.id = h.branch_id left join public.partner_agreements pa on pa.branch_id = b.id
            where h.person_id = p.id and h.valid @> app.today()) end
    from public.persons p left join public.hr_profiles h on h.person_id = p.id left join public.police_verifications pv on pv.person_id = p.id
   where p.status <> 'exited'
   order by p.full_name;
end $$;

grant execute on function public.register_document(uuid, text, text, text, text, int), public.verify_document(uuid, boolean, text),
  public.set_police_verification(uuid, text, date, date, text, text), public.police_status(text), public.hr_repository() to authenticated;
revoke all on function public.register_document(uuid, text, text, text, text, int), public.verify_document(uuid, boolean, text),
  public.set_police_verification(uuid, text, date, date, text, text), public.police_status(text), public.hr_repository(), app.pv_due(uuid) from public, anon;
grant execute on function app.pv_due(uuid) to authenticated;
