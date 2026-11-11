-- D-126  Document check: one HR screen that puts each uploaded document next to the details recorded from it.
-- HR reads the image, types or corrects the details, and marks it checked — or sends it back with the reason.
-- Nothing new is stored: details go to hr_identity through save_identity (source 'hr'), files stay in the private bucket.

insert into public.access_pages (key, label, section, description, sort, base_roles, base_note) values
  ('adm_doccheck', 'Admin · Document check', 'Admin', 'Each uploaded document beside the details recorded from it, to compare and validate.', 315, '{hr_admin,admin}', null)
on conflict (key) do nothing;
insert into public.access_rules (area, role, level, locked)
select 'page:adm_doccheck', r.role, 'all', r.role = 'admin'
from (values ('executive'),('manager'),('ba'),('bm'),('zm'),('ops_head'),('collections_head'),('product_head'),('hr_admin'),('auditor'),('leadership'),('ea'),('admin')) r(role)
on conflict (area, role) do nothing;

create or replace function public.doc_check_queue() returns jsonb
language plpgsql stable security definer set search_path = public, app, pg_temp as $$
begin
  if not (app.is_admin() or app.has_role('hr_admin')) then raise exception 'Only HR can check documents.' using errcode = '42501'; end if;
  if app.page_hidden('adm_doccheck') then raise exception 'This page is turned off for your role.' using errcode = '42501'; end if;
  return (
  with ppl as (select p.id, p.full_name, p.designation from public.persons p where p.status in ('active', 'invited')),
  last as (  -- the latest upload of each type that has not been sent back
    select distinct on (d.person_id, d.doc_type) d.person_id, d.doc_type, d.id, d.storage_path, d.mime, d.file_name, d.uploaded_at, d.verified_at,
           (select count(*) from public.person_documents x where x.person_id = d.person_id and x.doc_type = d.doc_type) n
      from public.person_documents d where not d.rejected order by d.person_id, d.doc_type, d.uploaded_at desc),
  ids as (
    select p.id person_id, p.full_name, p.designation, k.kind, l.id doc_id, l.storage_path, l.mime, l.file_name, l.uploaded_at, l.verified_at, l.n,
           case k.kind when 'aadhaar' then i.aadhaar_number when 'pan' then i.pan_number else i.bank_account_number end number,
           case k.kind when 'aadhaar' then i.aadhaar_name when 'pan' then i.pan_name else i.bank_holder end name_on,
           case k.kind when 'aadhaar' then i.aadhaar_source when 'pan' then i.pan_source else i.bank_source end source,
           case when k.kind = 'bank' then i.bank_ifsc end ifsc, case when k.kind = 'bank' then i.bank_name end bank_name
      from ppl p cross join (values ('aadhaar'), ('pan'), ('bank')) k(kind)
      left join last l on l.person_id = p.id and l.doc_type = k.kind
      left join public.hr_identity i on i.person_id = p.id),
  items as (
    select person_id, full_name, designation, kind, doc_id, storage_path, mime, file_name, uploaded_at, verified_at, n, number, name_on, source, ifsc, bank_name,
           case when number is null then 'no_details' when coalesce(source, 'scan') <> 'hr' or (doc_id is not null and verified_at is null) then 'to_check' else 'done' end state
      from ids where doc_id is not null or number is not null
    union all
    select p.id, p.full_name, p.designation, l.doc_type, l.id, l.storage_path, l.mime, l.file_name, l.uploaded_at, l.verified_at, l.n, null, null, null, null, null,
           case when l.verified_at is null then 'to_check' else 'done' end
      from ppl p join last l on l.person_id = p.id where l.doc_type not in ('aadhaar', 'pan', 'bank'))
  select coalesce(jsonb_agg(jsonb_build_object(
           'person_id', t.person_id, 'full_name', t.full_name, 'designation', t.designation, 'kind', t.kind, 'state', t.state,
           'doc', case when t.doc_id is not null then jsonb_build_object('id', t.doc_id, 'path', t.storage_path, 'mime', t.mime, 'file_name', t.file_name,
                    'uploaded_at', t.uploaded_at, 'verified', t.verified_at is not null, 'uploads', t.n) end,
           'number', t.number, 'name_on', t.name_on, 'source', t.source, 'ifsc', t.ifsc, 'bank_name', t.bank_name,
           'dob', h.date_of_birth, 'gender', h.gender)
           order by case t.state when 'no_details' then 0 when 'to_check' then 1 else 2 end, t.full_name,
                    case t.kind when 'aadhaar' then 0 when 'pan' then 1 when 'bank' then 2 else 3 end, t.kind), '[]'::jsonb)
    from items t left join public.hr_profiles h on h.person_id = t.person_id);
end $$;

-- HR has compared the document: record the details as typed (if any), mark them checked by HR, and verify the file.
create or replace function public.doc_check_done(p_person uuid, p_kind text, p_doc uuid, p jsonb default null) returns jsonb
language plpgsql security definer set search_path = public, app, pg_temp as $$
declare v_me uuid := app.me();
begin
  if not (app.is_admin() or app.has_role('hr_admin')) then raise exception 'Only HR can check documents.' using errcode = '42501'; end if;
  if p_doc is not null and not exists (select 1 from public.person_documents d where d.id = p_doc and d.person_id = p_person and d.doc_type = p_kind and not d.rejected) then
    raise exception 'That document is not on file for this person.' using errcode = '22023'; end if;
  if p_kind in ('aadhaar', 'pan', 'bank') then
    if coalesce(p->>'number', '') <> '' then
      perform public.save_identity(p_person, coalesce(p, '{}'::jsonb) || jsonb_build_object('kind', p_kind, 'doc_id', p_doc));
    end if;
    perform public.confirm_identity(p_person, p_kind);       -- source becomes "checked by HR"; raises if there is still no number
  elsif p_doc is null then
    raise exception 'There is no document to verify.' using errcode = 'P0001';
  end if;
  if p_doc is not null then
    perform set_config('app.reason', 'document checked by HR: ' || p_kind, true);
    update public.person_documents set verified_by = v_me, verified_at = now(), rejected = false, note = null where id = p_doc and verified_at is null;
  end if;
  return jsonb_build_object('ok', true);
end $$;

grant execute on function public.doc_check_queue(), public.doc_check_done(uuid, text, uuid, jsonb) to authenticated;
